// Silent spatial-audio regression check. Renders the real engine through an
// OfflineAudioContext in headless Chromium (nothing reaches a speaker) and
// asserts that direction, distance and wall occlusion are audible.
//
//   npm run audio-check

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>audio</title>'); }
  if (url.pathname !== '/src/client/audio.js') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/javascript' });
  res.end(await readFile(path.join(root, 'src/client/audio.js')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base);
const m = await page.evaluate(async (url) => {
  const SR = 48000;
  class Offline extends OfflineAudioContext {
    constructor() { super(2, SR * 1.6, SR); }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); }
  }
  window.AudioContext = Offline;
  const { AudioEngine } = await import(url);
  const render = async (setup) => {
    const e = new AudioEngine({ masterVolume: 0.8 });
    e.unlock();
    e.setListener(0, 1.6, 0, 0, 0, -1, 0, 1, 0);   // facing -Z, right is +X
    setup(e);
    const b = await e.ctx.startRendering();
    const L = b.getChannelData(0), R = b.getChannelData(1);
    let e2 = 0, hl = 0, hr = 0, hf = 0;
    for (let i = 2; i < L.length; i++) {
      e2 += L[i] * L[i] + R[i] * R[i];
      const a = L[i] - 2 * L[i - 1] + L[i - 2], c = R[i] - 2 * R[i - 1] + R[i - 2];
      hl += a * a; hr += c * c; hf += a * a + c * c;
    }
    return { rms: Math.sqrt(e2), hl: Math.sqrt(hl), hr: Math.sqrt(hr), bright: Math.sqrt(hf) / Math.sqrt(e2) };
  };
  const shot = (pos, occ = 0) => (e) => { e.occlusion = () => occ; e.gunshot('rifle', pos); };
  const db = (a, b) => 20 * Math.log10(a / b);
  const right = await render(shot({ x: 5, y: 1.6, z: 0 }));
  const left = await render(shot({ x: -5, y: 1.6, z: 0 }));
  const near = await render(shot({ x: 0, y: 1.6, z: -3 }));
  const far = await render(shot({ x: 0, y: 1.6, z: -20 }));
  const open = await render(shot({ x: 0, y: 1.6, z: -8 }, 0));
  const wall = await render(shot({ x: 0, y: 1.6, z: -8 }, 1));
  let tracked = 0;
  await render((e) => { const h = e.zombieGroan({ x: 2, y: 1.6, z: -2 }, 3); if (h && typeof h.move === 'function') { h.move(-2, 1.6, -2); tracked = 1; } });
  return {
    rightEarHighs_dB: db(right.hr, right.hl),
    leftEarHighs_dB: db(left.hl, left.hr),
    near3m_vs_far20m_dB: db(near.rms, far.rms),
    behindWall_quieter_dB: db(open.rms, wall.rms),
    behindWall_duller_dB: db(open.bright, wall.bright),
    zombieVoicesFollow: tracked,
  };
}, `${base}/src/client/audio.js`);
await browser.close();
server.close();

const checks = [
  ['sound to the right is louder in the right ear', m.rightEarHighs_dB >= 12],
  ['sound to the left is louder in the left ear', m.leftEarHighs_dB >= 12],
  ['far sounds are much quieter than near ones', m.near3m_vs_far20m_dB >= 17],
  ['walls make sounds quieter', m.behindWall_quieter_dB >= 5],
  ['walls make sounds duller', m.behindWall_duller_dB >= 6],
  ['zombie voices can follow a moving zombie', m.zombieVoicesFollow === 1],
];
const round = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10) / 10]));
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, failed, metrics: round }, null, 2));
process.exit(failed.length ? 1 : 0);
