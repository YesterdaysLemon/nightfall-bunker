// Headless, silent end-to-end check in Chromium: boots the built game,
// plays round 1 with an aim bot, fails on console errors, and writes
// screenshots for review to output/smoke/.
//
//   npm run build && npm run smoke            (serves dist/ itself)
//   node scripts/smoke.mjs --url http://127.0.0.1:5173   (against a dev server)
//   node scripts/smoke.mjs --shots-only       (views only, no gameplay)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shotsOnly = args.includes('--shots-only');
// CI runners render with a slow software GPU: use a small low-quality view and
// only require that zombies arrive and die, not that round 1 is cleared.
const quick = args.includes('--quick') || !!process.env.CI;
const outDir = path.resolve(opt('--out', 'output/smoke'));
mkdirSync(outDir, { recursive: true });

let server = null;
let base = opt('--url', null);
if (!base) {
  const port = 18900 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: quick ? { width: 800, height: 450 } : { width: 1280, height: 720 } });
if (quick) await page.addInitScript(() => { try { localStorage.setItem('nb_settings', JSON.stringify({ quality: 'low' })); } catch { /* ignore */ } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`); });

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const game = (fn, arg) => page.evaluate(fn, arg);
const results = {};

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('01-menu');

  await page.click('#btnSolo');
  await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 10000 });
  // Headless has no real pointer: drive the game through its free-look path.
  await game(() => { const g = window.__game; g.input.fallback = true; g.input.setLocked(true); });
  await page.waitForTimeout(500);

  // Staged views for visual review.
  const view = async (name, setup, wait = 700) => {
    await game(setup);
    await page.waitForTimeout(wait);
    await shot(name);
  };
  const freeze = () => {
    const g = window.__game, sim = g.conn.room.sim;
    sim.phase = 'break'; sim.phaseT = 9999;
    for (const d of ['helpDoor', 'debrisA', 'debrisB']) sim.openDoor(d);
  };
  if (shotsOnly) await game(freeze);
  await view('02-start-room', () => Object.assign(window.__game.p, { x: 0.5, y: 0, z: 3.5, yaw: 0, pitch: 0 }));
  await view('03-help-room', () => Object.assign(window.__game.p, { x: -8, y: 0, z: 2, yaw: Math.PI / 2, pitch: 0 }));
  await view('04-loft', () => Object.assign(window.__game.p, { x: 6, y: 3.2, z: 3, yaw: Math.PI / 2 + 0.3, pitch: -0.05 }));
  await view('05-box', () => Object.assign(window.__game.p, { x: -3.2, y: 3.2, z: 3.2, yaw: Math.PI, pitch: -0.3 }));
  await view('06-window-out', () => Object.assign(window.__game.p, { x: -2.5, y: 0, z: -4.8, yaw: 0, pitch: 0.02 }));

  if (!shotsOnly) {
    // Fresh game for the gameplay check.
    await game(() => { document.getElementById('btnSolo').click(); });
    await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 10000 });
    await game(() => { const g = window.__game; g.input.fallback = true; g.input.setLocked(true); });
    const t0 = Date.now();
    // Aim bot: keeps the player in the middle of the start room, aims at the
    // nearest zombie that is inside or climbing, fires and reloads.
    await game(() => {
      const g = window.__game;
      window.__botStats = { shots: 0 };
      window.__bot = setInterval(() => {
        const p = g.p;
        Object.assign(p, { x: 1, z: 0.5 });
        let best = null, bd = 1e9;
        for (const z of g.zombies.list.values()) {
          if (z.state < 2) continue;
          const d = Math.hypot(z.x - p.x, z.z - p.z);
          if (d < bd) { bd = d; best = z; }
        }
        const a = p.ammo[p.cur];
        if (a && a.mag === 0) { g.input.pressed.add('KeyR'); return; }
        if (!best || bd > 12) return;
        const ex = p.x, ey = p.y + p.eye, ez = p.z;
        const dx = best.x - ex, dy = best.y + 1.35 - ey, dz = best.z - ez;
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        g.input.pressed.add('Mouse0');
        window.__botStats.shots++;
      }, 120);
    });
    let sawZombies = false, sawCombat = false;
    while (Date.now() - t0 < 150000) {
      await page.waitForTimeout(1000);
      const s = await game(() => {
        const g = window.__game;
        return { round: g.round, phase: g.phase, alive: g.zombies.list.size, points: g.p.points, state: g.p.state, hp: g.p.hp, fps: 0 };
      });
      if (s.alive > 0) sawZombies = true;
      if (!sawCombat && s.alive > 0 && s.round === 1) {
        const near = await game(() => [...window.__game.zombies.list.values()].some((z) => z.state >= 3));
        if (near) { sawCombat = true; await page.waitForTimeout(300); await shot('07-combat'); }
      }
      results.last = s;
      if (s.round >= 2 || s.state !== 0) break;
      if (quick && s.points >= 600) break;
    }
    await shot('08-after-round');
    results.botShots = await game(() => window.__botStats.shots);
    results.sawZombies = sawZombies;
    const fps = await game(async () => {
      let n = 0; const t = performance.now();
      await new Promise((r) => { const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
      return n / 2;
    });
    results.headlessFps = fps;
    if (!sawZombies) errors.push('no zombies appeared');
    if (!quick && results.last.round < 2) errors.push(`round 1 not cleared (round ${results.last.round}, phase ${results.last.phase}, state ${results.last.state})`);
    if (results.last.points < 600) errors.push(`too few points earned (${results.last.points})`);
    results.mode = quick ? 'quick' : 'full';
  }
} catch (err) {
  errors.push(`harness: ${err.message}`);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server?.kill();
}

console.log(JSON.stringify({ ok: errors.length === 0, errors, results, screenshots: outDir }, null, 2));
process.exit(errors.length ? 1 : 0);
