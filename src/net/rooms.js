// Transport-agnostic rooms. A "socket" is anything with send(string) and
// close(code, reason). Hosts (Durable Objects, the Node server, the browser
// for solo play) feed messages in and wire timers.

import { GameSim, TICK } from '../shared/sim.js';
import { MAX_PLAYERS, PROTOCOL, chooseRegion } from '../shared/protocol.js';

const MAX_MSG = 8192;

function parse(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MSG) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

function cleanName(n) {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16);
  return s || 'Survivor';
}

function cleanToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t) ? t : null;
}

// --- Match ------------------------------------------------------------------------------
export class MatchRoom {
  constructor({ id = 'local', region = 'local', seed, timers = globalThis, onEnded, log = () => {} } = {}) {
    this.id = id;
    this.region = region;
    this.sim = new GameSim({ seed: seed ?? (Math.random() * 2 ** 32) >>> 0 });
    this.timers = timers;
    this.onEnded = onEnded;
    this.log = log;
    this.sockets = new Map(); // socket -> { id }
    this.tokens = new Map();  // token -> public id
    this.nextId = 1;
    this.loop = null;
    this.ended = false;
    this.emptySince = 0;
  }

  get playerCount() { return this.sim.activePlayers().length; }

  open(socket) {
    this.sockets.set(socket, { id: null });
  }

  message(socket, raw) {
    const s = this.sockets.get(socket);
    const m = parse(raw);
    if (!s || !m) return;
    if (m.t === 'ping') { safeSend(socket, JSON.stringify({ t: 'pong', c: m.c })); return; }
    if (!s.id) {
      if (m.t !== 'hello') return;
      this.hello(socket, s, m);
      return;
    }
    this.sim.handle(s.id, m);
  }

  hello(socket, s, m) {
    if (m.v !== PROTOCOL) return reject(socket, 'version', 'Please reload: the game was updated.');
    if (this.ended) return reject(socket, 'ended', 'That match has ended.');
    const token = cleanToken(m.token);
    if (!token) return reject(socket, 'token', 'Bad session token.');
    let id = this.tokens.get(token);
    const known = id && this.sim.players.has(id);
    if (!known && this.playerCount >= MAX_PLAYERS) return reject(socket, 'full', 'That match is full (4 players).');
    // One live socket per player.
    for (const [sock, other] of this.sockets) {
      if (other.id && other.id === id && sock !== socket) { this.sockets.delete(sock); safeClose(sock, 4001, 'replaced'); }
    }
    if (!id) { id = `p${this.nextId++}`; this.tokens.set(token, id); }
    s.id = id;
    this.sim.addPlayer(id, cleanName(m.name));
    safeSend(socket, JSON.stringify({ ...this.sim.welcome(id), region: this.region, match: this.id }));
    this.start();
  }

  close(socket) {
    const s = this.sockets.get(socket);
    this.sockets.delete(socket);
    if (s?.id && ![...this.sockets.values()].some((o) => o.id === s.id)) this.sim.disconnect(s.id);
  }

  start() {
    if (this.loop || this.ended) return;
    this.loop = this.timers.setInterval(() => this.tick(), TICK * 1000);
  }

  stop() {
    if (this.loop) this.timers.clearInterval(this.loop);
    this.loop = null;
  }

  tick() {
    const sim = this.sim;
    sim.step(TICK);
    const snap = sim.snapshot();
    snap.e = sim.drainEvents();
    const msg = JSON.stringify(snap);
    for (const [sock, s] of this.sockets) if (s.id) safeSend(sock, msg);
    const now = sim.time;
    if (this.sockets.size === 0) {
      if (!this.emptySince) this.emptySince = now;
      // Keep state for reconnects briefly, then end.
      if (now - this.emptySince > 90) this.end('empty');
    } else {
      this.emptySince = 0;
    }
    if (sim.phase === 'over' && sim.phaseT <= 0) this.end('over');
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const msg = JSON.stringify({ t: 'end', reason });
    for (const sock of this.sockets.keys()) safeSend(sock, msg);
    this.onEnded?.(reason);
  }
}

// --- Party (pre-game lobby) ----------------------------------------------------------------
export class PartyRoom {
  constructor({ code, isPublic = false, regions = ['local'], createMatch, onChange = () => {}, log = () => {} }) {
    this.code = code;
    this.isPublic = isPublic;
    this.regions = regions;
    this.createMatch = createMatch;
    this.onChange = onChange;
    this.log = log;
    this.members = new Map(); // socket -> member
    this.state = 'waiting';
    this.match = null;
    this.starting = false;
    this.created = Date.now();
  }

  get size() { return [...this.members.values()].filter((m) => m.id).length; }

  open(socket) {
    this.members.set(socket, { id: null });
  }

  message(socket, raw) {
    const mem = this.members.get(socket);
    const m = parse(raw);
    if (!mem || !m) return;
    if (m.t === 'ping') { safeSend(socket, JSON.stringify({ t: 'pong', c: m.c })); return; }
    if (!mem.id) {
      if (m.t !== 'hello') return;
      if (m.v !== PROTOCOL) return reject(socket, 'version', 'Please reload: the game was updated.');
      const token = cleanToken(m.token);
      if (!token) return reject(socket, 'token', 'Bad session token.');
      for (const [sock, other] of this.members) {
        if (other.token === token && sock !== socket) { this.members.delete(sock); safeClose(sock, 4001, 'replaced'); }
      }
      if (this.size >= MAX_PLAYERS) return reject(socket, 'full', 'That lobby is full (4 players).');
      Object.assign(mem, {
        id: token.slice(0, 6), token, name: cleanName(m.name), pings: cleanPings(m.pings, this.regions),
        joined: Date.now(),
      });
      if (m.back && this.match && m.back === this.match.id) { this.match = null; this.state = 'waiting'; }
      this.broadcast();
      if (this.state === 'ingame' && this.match) safeSend(socket, JSON.stringify({ t: 'go', ...this.match }));
      return;
    }
    if (m.t === 'pings') { mem.pings = cleanPings(m.pings, this.regions); this.broadcast(); return; }
    if (m.t === 'back') {
      if (this.match && m.match === this.match.id) { this.match = null; this.state = 'waiting'; this.broadcast(); }
      return;
    }
    if (m.t === 'chat' && typeof m.m === 'string' && m.m.trim()) {
      const msg = JSON.stringify({ t: 'chat', from: mem.name, m: m.m.trim().slice(0, 120) });
      for (const sock of this.members.keys()) safeSend(sock, msg);
      return;
    }
    if (m.t === 'start' && this.host() === mem && this.state === 'waiting' && !this.starting) {
      this.start().catch((err) => {
        this.starting = false;
        this.log('start failed', String(err));
        const msg = JSON.stringify({ t: 'error', message: 'Could not start the match. Try again.' });
        for (const sock of this.members.keys()) safeSend(sock, msg);
      });
    }
  }

  host() {
    let best = null;
    for (const m of this.members.values()) if (m.id && (!best || m.joined < best.joined)) best = m;
    return best;
  }

  choice() {
    const pings = [...this.members.values()].filter((m) => m.id).map((m) => m.pings);
    return chooseRegion(pings, this.regions);
  }

  async start() {
    this.starting = true;
    const { region } = this.choice();
    const id = await this.createMatch(region, { code: this.code });
    this.match = { match: id, id, region };
    this.state = 'ingame';
    this.starting = false;
    const msg = JSON.stringify({ t: 'go', ...this.match });
    for (const sock of this.members.keys()) safeSend(sock, msg);
    this.broadcast();
  }

  close(socket) {
    this.members.delete(socket);
    this.broadcast();
  }

  meta() {
    return { code: this.code, public: this.isPublic, state: this.state, size: this.size, region: this.choice().region, match: this.match };
  }

  broadcast() {
    const host = this.host();
    const ch = this.choice();
    const members = [...this.members.values()].filter((m) => m.id).map((m) => ({
      id: m.id, name: m.name, host: m === host, ping: Number.isFinite(m.pings?.[ch.region]) ? Math.round(m.pings[ch.region]) : null,
    }));
    const msg = JSON.stringify({ t: 'lobby', code: this.code, public: this.isPublic, state: this.state, members, region: ch.region, worst: Math.round(ch.worst), match: this.match });
    for (const [sock, m] of this.members) if (m.id) safeSend(sock, msg);
    this.onChange(this.meta());
  }
}

function cleanPings(p, regions) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const r of regions) {
    const v = Number(p[r]);
    if (Number.isFinite(v) && v >= 0 && v < 5000) out[r] = v;
  }
  return out;
}

function reject(socket, code, message) {
  safeSend(socket, JSON.stringify({ t: 'reject', code, message }));
  safeClose(socket, 4000, code);
}

export function safeSend(socket, msg) {
  try { socket.send(msg); } catch { /* socket already gone */ }
}

function safeClose(socket, code, reason) {
  try { socket.close(code, reason); } catch { /* ignore */ }
}
