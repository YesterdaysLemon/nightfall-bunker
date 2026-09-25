// Connections: solo runs the real match room in the page; multiplayer talks
// to edge Durable Objects (or the origin fallback) over WebSockets.

import { MatchRoom } from '../net/rooms.js';

const BASE = '';

export function sessionToken() {
  const key = 'nb_token';
  try {
    let t = sessionStorage.getItem(key);
    if (!t) {
      const a = new Uint8Array(18);
      crypto.getRandomValues(a);
      t = btoa(String.fromCharCode(...a)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
      sessionStorage.setItem(key, t);
    }
    return t;
  } catch {
    return `anon${Math.random().toString(36).slice(2, 14)}`;
  }
}

export class LocalConnection {
  constructor() {
    this.kind = 'local';
    this.room = new MatchRoom({ id: 'solo', region: 'local' });
    this.sock = { send: (s) => this.onmessage?.(JSON.parse(s)), close: () => {} };
    this.room.open(this.sock);
    this.paused = false;
  }
  send(obj) { this.room.message(this.sock, JSON.stringify(obj)); }
  pause(on) {
    if (on === this.paused) return;
    this.paused = on;
    if (on) this.room.stop(); else this.room.start();
  }
  close() { this.room.end('quit'); this.room.close(this.sock); this.onmessage = null; }
}

export class WsConnection {
  constructor(path) {
    this.kind = 'ws';
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}${BASE}${path}`);
    this.open = false;
    this.queue = [];
    this.ws.onopen = () => {
      this.open = true;
      for (const m of this.queue) this.ws.send(m);
      this.queue.length = 0;
      this.onopen?.();
    };
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onmessage?.(m);
    };
    this.ws.onclose = (e) => { this.open = false; this.onclose?.(e); };
    this.ws.onerror = () => {};
  }
  send(obj) {
    const s = JSON.stringify(obj);
    if (this.open) this.ws.send(s); else this.queue.push(s);
  }
  pause() {}
  close() {
    this.onclose = null;
    this.onmessage = null;
    try { this.ws.close(1000, 'bye'); } catch { /* ignore */ }
  }
}

async function getJSON(path, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 8000);
  try {
    const r = await fetch(`${BASE}${path}`, { cache: 'no-store', ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export const lobbyApi = {
  regions: () => getJSON('/net/regions'),
  createParty: (isPublic) => getJSON('/net/party', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ public: !!isPublic }) }),
  quick: (pings) => getJSON(`/net/quick?p=${encodeURIComponent(JSON.stringify(pings || {}))}`),

  // Round trip to each region's beacon: one warm-up, then best of two.
  async probe(regions, onUpdate) {
    const out = {};
    const one = async (r) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        try { await getJSON(`/net/ping/${r}`, { timeout: 4000 }); } catch { break; }
        const ms = performance.now() - t0;
        if (i > 0) best = Math.min(best, ms);
      }
      if (Number.isFinite(best)) { out[r] = Math.round(best); onUpdate?.({ ...out }); }
    };
    const queue = [...regions];
    const workers = Array.from({ length: 3 }, async () => { while (queue.length) await one(queue.shift()); });
    await Promise.all(workers);
    return out;
  },
};
