// Edge multiplayer for Nightfall Bunker.
//
//  /net/regions          Durable Object location hints the client should probe
//  /net/ping/<region>    round trip to a beacon object pinned in that region
//  POST /net/party       create a lobby code (party object lives near the creator)
//  /net/party/<CODE>     lobby WebSocket
//  /net/quick            find (or create) a public lobby with room
//  /net/match/<id>       match WebSocket; the match object is created in the
//                        region that minimises the worst player's latency

import { DurableObject } from 'cloudflare:workers';
import { MatchRoom, PartyRoom } from '../src/net/rooms.js';
import { REGIONS, randomCode, chooseRegion } from '../src/shared/protocol.js';

const REGION_KEYS = Object.keys(REGIONS);
const PARTY_TTL = 6 * 3600 * 1000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function cryptoRand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

function isUpgrade(req) {
  return req.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function acceptSocket(room) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  room.open(server);
  server.addEventListener('message', (e) => { if (typeof e.data === 'string') room.message(server, e.data); });
  server.addEventListener('close', () => room.close(server));
  server.addEventListener('error', () => room.close(server));
  return new Response(null, { status: 101, webSocket: client });
}

async function createParty(env, isPublic) {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(cryptoRand);
    if (await env.PARTY.getByName(code).init(code, isPublic)) return code;
  }
  throw new Error('no free lobby code');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/net/health') return json({ ok: true, edge: true, colo: req.cf?.colo ?? null });
      if (p === '/net/regions') {
        return json({ regions: REGION_KEYS, names: REGIONS, colo: req.cf?.colo ?? null, continent: req.cf?.continent ?? null });
      }
      let m = p.match(/^\/net\/ping\/([a-z]+)$/);
      if (m) {
        if (!REGIONS[m[1]]) return json({ error: 'unknown region' }, 404);
        const stub = env.BEACON.get(env.BEACON.idFromName(m[1]), { locationHint: m[1] });
        return json(await stub.ping(m[1]));
      }
      if (p === '/net/party' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json({ code: await createParty(env, !!body.public) });
      }
      m = p.match(/^\/net\/party\/([A-Z]{4})$/);
      if (m) {
        if (!isUpgrade(req)) return json({ error: 'expected websocket' }, 426);
        return env.PARTY.getByName(m[1]).fetch(req);
      }
      if (p === '/net/quick') {
        let pings = {};
        try { pings = JSON.parse(url.searchParams.get('p') || '{}'); } catch { /* none */ }
        const code = await env.DIRECTORY.getByName('global').find(pings);
        return json({ code: code || await createParty(env, true) });
      }
      m = p.match(/^\/net\/match\/([0-9a-f]{64})$/);
      if (m) {
        if (!isUpgrade(req)) return json({ error: 'expected websocket' }, 426);
        let id;
        try { id = env.MATCH.idFromString(m[1]); } catch { return json({ error: 'bad match id' }, 404); }
        return env.MATCH.get(id).fetch(req);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'edge request failed', path: p, err: String(err) }));
      return json({ error: 'internal error' }, 500);
    }
  },
};

// Tiny object pinned to one region; clients time a round trip to it.
export class Beacon extends DurableObject {
  async ping(region) {
    return { region, t: Date.now() };
  }
}

export class Party extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
  }

  async init(code, isPublic) {
    const meta = await this.ctx.storage.get('meta');
    if (meta && Date.now() - meta.created < PARTY_TTL) return false;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('meta', { code, isPublic, created: Date.now() });
    this.room = null;
    return true;
  }

  async ensureRoom() {
    if (this.room) return this.room;
    const meta = await this.ctx.storage.get('meta');
    if (!meta || Date.now() - meta.created > PARTY_TTL) return null;
    const saved = await this.ctx.storage.get('state');
    const room = new PartyRoom({
      code: meta.code,
      isPublic: meta.isPublic,
      regions: REGION_KEYS,
      createMatch: async (region) => {
        const id = this.env.MATCH.newUniqueId();
        await this.env.MATCH.get(id, { locationHint: region }).setup(region, meta.code);
        return id.toString();
      },
      onChange: (m) => {
        this.ctx.waitUntil(this.ctx.storage.put('state', { state: m.state, match: m.match }));
        if (meta.isPublic) this.ctx.waitUntil(this.env.DIRECTORY.getByName('global').update(m));
      },
      log: (...a) => console.log(JSON.stringify({ level: 'info', party: meta.code, msg: a.join(' ') })),
    });
    if (saved?.state === 'ingame' && saved.match) { room.state = 'ingame'; room.match = saved.match; }
    this.room = room;
    return room;
  }

  async fetch(req) {
    const room = await this.ensureRoom();
    if (!room) return json({ error: 'no such lobby' }, 404);
    return acceptSocket(room);
  }
}

export class Match extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
  }

  async setup(region, code) {
    await this.ctx.storage.put('info', { region, code, created: Date.now() });
    return true;
  }

  async fetch(req) {
    if (!this.room) {
      const info = await this.ctx.storage.get('info');
      if (!info) return json({ error: 'no such match' }, 404);
      this.room = new MatchRoom({
        id: this.ctx.id.toString(),
        region: info.region,
        timers: { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h) },
        onEnded: () => { this.ctx.waitUntil(this.ctx.storage.deleteAll()); },
        log: (...a) => console.log(JSON.stringify({ level: 'info', match: info.code, msg: a.join(' ') })),
      });
    }
    if (this.room.ended) return json({ error: 'match ended' }, 410);
    return acceptSocket(this.room);
  }
}

// Public lobbies waiting for players. Small and in-memory by design.
export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.open = new Map();
  }

  async update(meta) {
    if (meta.public && meta.state === 'waiting' && meta.size > 0 && meta.size < 4) {
      this.open.set(meta.code, { ...meta, seen: Date.now() });
    } else {
      this.open.delete(meta.code);
    }
  }

  async find(pings) {
    const now = Date.now();
    let best = null, bestWorst = Infinity;
    for (const [code, m] of this.open) {
      if (now - m.seen > 10 * 60_000) { this.open.delete(code); continue; }
      const { worst } = chooseRegion([pings || {}], [m.region]);
      if (worst < bestWorst) { best = code; bestWorst = worst; }
    }
    return best;
  }
}
