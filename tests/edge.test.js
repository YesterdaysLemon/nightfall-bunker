// End-to-end check of the edge Worker. Skipped unless NB_EDGE_URL is set,
// e.g. NB_EDGE_URL=http://127.0.0.1:8787 (wrangler dev) or the live site.
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { PROTOCOL } from '../src/shared/protocol.js';

const base = process.env.NB_EDGE_URL;
const wsBase = base?.replace(/^http/, 'ws');

const sockets = [];
function client(path) {
  const ws = new WebSocket(`${wsBase}${path}`);
  sockets.push(ws);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const opened = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return {
    ws, inbox,
    send: async (o) => { await opened; ws.send(JSON.stringify(o)); },
    wait: (pred, label, ms = 8000) => new Promise((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit);
      const t = setTimeout(() => rej(new Error(`timeout: ${label}; got ${inbox.map((m) => m.t).join(',')}`)), ms);
      waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    }),
  };
}

test('edge: regions, beacons, party, region choice and match handoff', { skip: !base }, async (t) => {
  t.after(() => { for (const ws of sockets) ws.terminate(); });
  const regions = await (await fetch(`${base}/net/regions`)).json();
  assert.ok(regions.regions.includes('weur'));
  const pings = {};
  for (const r of regions.regions) {
    const t0 = performance.now();
    const res = await (await fetch(`${base}/net/ping/${r}`)).json();
    assert.equal(res.region, r);
    pings[r] = performance.now() - t0;
  }
  const { code } = await (await fetch(`${base}/net/party`, { method: 'POST', body: '{}' })).json();
  assert.match(code, /^[A-Z]{4}$/);

  const a = client(`/net/party/${code}`);
  const b = client(`/net/party/${code}`);
  // Alice is near western Europe, Bob near eastern North America.
  await a.send({ t: 'hello', v: PROTOCOL, token: 'edgeAAAAAAAA', name: 'Alice', pings: { weur: 15, enam: 60, wnam: 160 } });
  await b.send({ t: 'hello', v: PROTOCOL, token: 'edgeBBBBBBBB', name: 'Bob', pings: { weur: 110, enam: 25, wnam: 70 } });
  const lobby = await a.wait((m) => m.t === 'lobby' && m.members.length === 2, 'lobby with two');
  assert.equal(lobby.region, 'enam', 'minimises the worst ping');
  await a.send({ t: 'start' });
  const go = await b.wait((m) => m.t === 'go', 'go');
  assert.equal(go.region, 'enam');

  const ma = client(`/net/match/${go.match}`);
  const mb = client(`/net/match/${go.match}`);
  await ma.send({ t: 'hello', v: PROTOCOL, token: 'edgeAAAAAAAA', name: 'Alice' });
  await mb.send({ t: 'hello', v: PROTOCOL, token: 'edgeBBBBBBBB', name: 'Bob' });
  const w = await ma.wait((m) => m.t === 'welcome', 'welcome');
  assert.equal(w.region, 'enam');
  await mb.wait((m) => m.t === 's' && m.p.length === 2, 'snapshot with two players');

  // A late joiner using the lobby code is redirected into the running match.
  const c = client(`/net/party/${code}`);
  await c.send({ t: 'hello', v: PROTOCOL, token: 'edgeCCCCCCCC', name: 'Cleo', pings: {} });
  const go2 = await c.wait((m) => m.t === 'go', 'late go');
  assert.equal(go2.match, go.match);

  const status = await new Promise((res) => {
    const ws = new WebSocket(`${wsBase}/net/match/${'0'.repeat(64)}`);
    sockets.push(ws);
    ws.on('unexpected-response', (req, r) => res(r.statusCode));
    ws.on('open', () => res(101));
    ws.on('error', () => res(-1));
  });
  assert.notEqual(status, 101, 'bogus match ids are refused');

});
