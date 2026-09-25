import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/shared/protocol.js';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;

function client(path) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws, inbox,
    send: async (o) => { await opened; ws.send(JSON.stringify(o)); },
    wait: (pred, ms = 4000, label = String(pred)) => new Promise((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit);
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${label}; got ${inbox.map((m) => m.t).slice(-8).join(',')}`)), ms);
      waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    }),
  };
}

test('party -> match handoff with two players over the origin server', async (t) => {
  const srv = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'pipe' });
  t.after(() => srv.kill());
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.ok, true);

  const { code } = await (await fetch(`${base}/net/party`, { method: 'POST', body: '{}' })).json();
  assert.match(code, /^[A-Z]{4}$/);

  const a = client(`/net/party/${code}`);
  const b = client(`/net/party/${code}`);
  await a.send({ t: 'hello', v: PROTOCOL, token: 'tokenAAAAAAAA', name: 'Alice', pings: { origin: 20 } });
  await a.wait((m) => m.t === 'lobby');
  await b.send({ t: 'hello', v: PROTOCOL, token: 'tokenBBBBBBBB', name: 'Bob', pings: { origin: 30 } });
  const lobby = await a.wait((m) => m.t === 'lobby' && m.members.length === 2);
  assert.equal(lobby.members[0].host, true);
  assert.equal(lobby.region, 'origin');

  // Only the host may start.
  await b.send({ t: 'start' });
  await a.send({ t: 'start' });
  const go = await b.wait((m) => m.t === 'go');
  assert.match(go.match, /^[0-9a-f]{64}$/);

  const ma = client(`/net/match/${go.match}`);
  const mb = client(`/net/match/${go.match}`);
  await ma.send({ t: 'hello', v: PROTOCOL, token: 'tokenAAAAAAAA', name: 'Alice' });
  await mb.send({ t: 'hello', v: PROTOCOL, token: 'tokenBBBBBBBB', name: 'Bob' });
  const wa = await ma.wait((m) => m.t === 'welcome');
  const wb = await mb.wait((m) => m.t === 'welcome');
  assert.notEqual(wa.id, wb.id);
  const snap = await ma.wait((m) => m.t === 's' && m.p.length === 2);
  assert.equal(snap.ph, 'pre');

  // A third and fourth join; a fifth is turned away.
  const extra = [];
  for (const n of ['C', 'D', 'E']) {
    const c = client(`/net/match/${go.match}`);
    await c.send({ t: 'hello', v: PROTOCOL, token: `token${n.repeat(8)}`, name: n });
    extra.push(c);
  }
  await extra[1].wait((m) => m.t === 'welcome');
  const rej = await extra[2].wait((m) => m.t === 'reject');
  assert.equal(rej.code, 'full');

  // Inputs flow back out in snapshots.
  await ma.send({ t: 'in', x: -1, y: 0, z: 1.5, yaw: 1, pitch: 0, f: 0 });
  const moved = await mb.wait((m) => m.t === 's' && m.p.some((r) => r[0] === wa.id && r[1] === -100), 4000, 'moved ' + JSON.stringify(mb.inbox.filter((m) => m.t === 's').pop()?.p.map((r) => r.slice(0, 4))) + ' wa=' + wa.id);
  assert.ok(moved);

  // Reconnect with the same token keeps identity.
  ma.ws.close();
  const again = client(`/net/match/${go.match}`);
  await again.send({ t: 'hello', v: PROTOCOL, token: 'tokenAAAAAAAA', name: 'Alice' });
  const w2 = await again.wait((m) => m.t === 'welcome');
  assert.equal(w2.id, wa.id);

  for (const c of [again, mb, a, b, ...extra]) c.ws.close();
});
