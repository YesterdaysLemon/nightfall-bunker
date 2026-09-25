// Headless, muted phone play-test: landscape phone viewport with real
// multi-touch (CDP Input.dispatchTouchEvent). Checks stick, look, fire,
// the context button, auto-fire + aim assist, portrait prompt and the editor.
//
//   npm run build && node scripts/touch-smoke.mjs [--url <site>]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const ui = args.indexOf('--url');
let base = ui >= 0 ? args[ui + 1] : null;
let server = null;
if (!base) {
  const port = 18800 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}
mkdirSync('output/touch', { recursive: true });

const errors = [];
const results = {};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|pointer lock|fullscreen|orientation/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `output/touch/${n}.png` });
const G = (fn, a) => page.evaluate(fn, a);
const check = (name, ok, detail) => { results[name] = ok ? 'ok' : `FAIL ${detail ?? ''}`; if (!ok) errors.push(`${name}: ${detail ?? ''}`); };

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('done'), null, { timeout: 30000 });
  check('touch mode detected', await G(() => document.body.classList.contains('touch') && window.__game.input.touchMode));
  await sleep(900);
  await shot('01-menu');
  await page.tap('#btnSolo');
  await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 10000 });
  await sleep(600);
  check('controls visible', await G(() => !document.getElementById('touch').hidden && window.__game.input.locked));
  await G(() => { const g = window.__game, sim = g.conn.room.sim; sim.phase = 'break'; sim.phaseT = 9999; });
  await shot('02-hud');

  // Stick: push forward for a second.
  const p0 = await G(() => ({ x: window.__game.p.x, z: window.__game.p.z, yaw: window.__game.p.yaw }));
  await touch('touchStart', [[110, 290, 1]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[110, 290 - i * 8, 1]]); await sleep(16); }
  await sleep(900);
  const p1 = await G(() => ({ x: window.__game.p.x, z: window.__game.p.z }));
  await touch('touchEnd', []);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('stick moves the player', moved > 1.5, `moved ${moved.toFixed(2)} m`);

  // Look: drag on the right side.
  await touch('touchStart', [[560, 150, 2]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[560 - i * 12, 150, 2]]); await sleep(16); }
  await touch('touchEnd', []);
  await sleep(100);
  const yaw1 = await G(() => window.__game.p.yaw);
  check('drag turns the view', Math.abs(yaw1 - p0.yaw) > 0.1, `yaw change ${(yaw1 - p0.yaw).toFixed(3)}`);

  // Both thumbs at once.
  const q0 = await G(() => ({ x: window.__game.p.x, z: window.__game.p.z, yaw: window.__game.p.yaw }));
  await touch('touchStart', [[110, 290, 3], [560, 160, 4]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[110, 290 - Math.min(i, 6) * 8, 3], [560 + i * 10, 160, 4]]); await sleep(20); }
  await sleep(500);
  const q1 = await G(() => ({ x: window.__game.p.x, z: window.__game.p.z, yaw: window.__game.p.yaw }));
  await touch('touchEnd', []);
  check('move and look together', Math.hypot(q1.x - q0.x, q1.z - q0.z) > 0.5 && Math.abs(q1.yaw - q0.yaw) > 0.05);

  // Fire button spends a round.
  const fire = await page.$eval('.tb-fire', (b) => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const ammo0 = await G(() => window.__game.p.ammo[window.__game.p.cur].mag);
  await touch('touchStart', [[fire[0], fire[1], 5]]);
  await sleep(120);
  await touch('touchEnd', []);
  await sleep(100);
  const ammo1 = await G(() => window.__game.p.ammo[window.__game.p.cur].mag);
  check('fire button shoots', ammo1 === ammo0 - 1, `${ammo0} -> ${ammo1}`);

  // Context button buys the Kar98k off the wall.
  await G(() => {
    const g = window.__game, sim = g.conn.room.sim;
    sim.players.get(g.me).points = 5000;
    Object.assign(g.p, { x: 1.0, y: 0, z: -4.6, yaw: 0, pitch: 0 });
  });
  await sleep(600);
  const useText = await page.$eval('.tb-use', (b) => (b.classList.contains('off') ? '' : b.textContent));
  check('context button offers the wall buy', /Kar98k/.test(useText), `label "${useText}"`);
  await shot('03-context-button');
  const use = await page.$eval('.tb-use', (b) => { const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await touch('touchStart', [[use[0], use[1], 6]]);
  await sleep(80);
  await touch('touchEnd', []);
  await sleep(400);
  check('context button buys', await G(() => window.__game.p.weapons.includes('kar98k')));

  // Auto-fire + aim assist: a zombie slightly off the crosshair gets pulled in and shot.
  await G(() => {
    const g = window.__game, sim = g.conn.room.sim;
    g.switchTo('m1911', true);
    Object.assign(g.p, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
    const id = sim.nextZid++;
    sim.zombies.set(id, { id, cls: 0, speed: 0, hp: 1e6, maxHp: 1e6, x: 0.45, y: 0, z: -3, yaw: 0, state: 4, t: 99, win: null, lv: 0, atk: 0, cell: -1, stuck: 0, cool: 99 });
    window.__pts0 = sim.players.get(g.me).points;
  });
  // Drag toward it the way a player would; the assist finishes the job.
  await touch('touchStart', [[560, 200, 7]]);
  for (let i = 1; i <= 14; i++) { await touch('touchMove', [[560 + i * 1.5, 200, 7]]); await sleep(40); }
  await touch('touchEnd', []);
  await sleep(1500);
  const pts = await G(() => window.__game.conn.room.sim.players.get(window.__game.me).points - window.__pts0);
  check('auto-fire with aim assist hits', pts > 0, `points +${pts}`);
  await shot('04-autofire');

  // Layout editor.
  await G(() => window.__game.touch.edit(true));
  await sleep(200);
  await shot('05-editor');
  await G(() => window.__game.touch.edit(false));

  // Portrait asks to rotate.
  await G(() => (document.fullscreenElement ? document.exitFullscreen() : null));
  await sleep(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
  check('portrait shows rotate prompt', await G(() => getComputedStyle(document.getElementById('rotate')).display !== 'none'));
  await shot('06-portrait');
} catch (err) {
  errors.push(`harness: ${err.message}`);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server?.kill();
}
console.log(JSON.stringify({ ok: errors.length === 0, results, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
