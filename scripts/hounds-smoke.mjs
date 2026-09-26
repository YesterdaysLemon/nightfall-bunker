// Headless, muted check of the hound round and the Kintsugi easter egg in the
// real client (solo mode, local sim). Screenshots go to output/hounds/.
//
//   npm run build && node scripts/hounds-smoke.mjs
//   node scripts/hounds-smoke.mjs --url http://127.0.0.1:5173

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const quick = args.includes('--quick') || !!process.env.CI;
const outDir = path.resolve(opt('--out', 'output/hounds'));
mkdirSync(outDir, { recursive: true });

let server = null;
let base = opt('--url', null);
if (!base) {
  const port = 18990 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const errors = [];
const results = {};
const check = (name, ok, detail) => { results[name] = ok ? 'ok' : `FAIL ${detail ?? ''}`; if (!ok) errors.push(`${name}: ${detail ?? ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: quick ? { width: 800, height: 450 } : { width: 1280, height: 720 } });
if (quick) await page.addInitScript(() => { try { localStorage.setItem('nb_settings', JSON.stringify({ quality: 'low' })); } catch { /* ignore */ } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const game = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

// Put the local player somewhere and aim the camera at a point.
const stand = (x, y, z, look) => game(([x, y, z, look]) => {
  const g = window.__game;
  Object.assign(g.p, { x, y, z, vx: 0, vy: 0, vz: 0 });
  if (look) {
    const ex = x, ey = y + g.p.eye, ez = z;
    const dx = look[0] - ex, dy = look[1] - ey, dz = look[2] - ez;
    g.p.yaw = Math.atan2(-dx, -dz);
    g.p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}, [x, y, z, look]);

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await waitFor(() => window.__game && document.getElementById('loading').classList.contains('done'), null, 30000);
  await page.click('#btnSolo');
  await waitFor(() => window.__game.mode === 'play');
  await game(() => { const g = window.__game; g.input.fallback = true; g.input.setLocked(true); });
  const sim = '(window.__game.conn.room.sim)';

  // --- Hound round -----------------------------------------------------------------------
  await game(`${sim}.nextHoundRound = 1`);
  await game(`${sim}.players.forEach((p) => { p.hp = 1e9; })`); // keep the test player standing
  await stand(-1.5, 0, 1.5, [2, 1, -2]);
  await waitFor(() => window.__game.rig.dread > 0.5);
  check('hound round: fog rolls in', await game(() => window.__game.rig.scene.fog.density > 0.05));
  check('hound round: banner', await game(() => /hounds are loose/i.test(document.getElementById('center').textContent)));
  await waitFor(() => [...window.__game.zombies.list.values()].some((z) => z.cls === 3 && z.state === 4), null, 25000);
  await page.waitForTimeout(600);
  await shot('01-hounds');
  const hounds = await game(() => [...window.__game.zombies.list.values()].filter((z) => z.cls === 3).length);
  check('hounds rendered', hounds > 0, `${hounds}`);
  // Turn to face the closest hound for a close look.
  const h = await game(() => {
    const g = window.__game;
    const list = [...g.zombies.list.values()].filter((z) => z.cls === 3).sort((a, b) => Math.hypot(a.x - g.p.x, a.z - g.p.z) - Math.hypot(b.x - g.p.x, b.z - g.p.z));
    return list[0] ? [list[0].x, list[0].y, list[0].z] : null;
  });
  if (h) {
    await stand(-1.5, 0, 1.5, [h[0], h[1] + 0.5, h[2]]);
    await page.waitForTimeout(250);
    await shot('01b-hound-close');
  }
  // Kill the pack as it arrives (server side), then wait for the round to end.
  await waitFor(() => {
    const s = window.__game.conn.room.sim;
    for (const z of [...s.zombies.values()]) if (z.state !== 6 && z.cls === 3) s.killZombie(z, [...s.players.keys()][0], 'head', [0, 0, 1]);
    return s.phase === 'break';
  }, null, 60000);
  await page.waitForTimeout(300);
  await shot('02-hound-deaths');
  check('last hound drops max ammo', await game(() => [...window.__game.fx.powerups.values()].length > 0 || window.__game.conn.room.sim.powerups.some((u) => u.type === 'maxammo')));
  await waitFor(() => window.__game.rig.dread < 0.6, null, 15000);
  check('fog lifts after the pack', true);

  // --- Easter egg: shoot the three cups for real -------------------------------------------
  await game(`${sim}.openDoor('helpDoor'); ${sim}.openDoor('debrisA'); ${sim}.phase = 'break'; ${sim}.phaseT = 9999; ${sim}.zombies.clear()`);
  // Cup positions mirror EGG.cups in src/shared/map.js; stand where each is in view.
  const cupPos = [[6.52, 0.85, -4.85], [-0.55, 4.0, -4.55], [12.6, 1.05, 1.3]];
  const spots = [[4, 0, -3], [-2, 3.2, -2], [6.8, 0, -1]]; // start room, loft, by the east window
  for (let i = 0; i < cupPos.length; i++) {
    const [x, y, z] = spots[i];
    const c = cupPos[i];
    await stand(x, y, z, [c[0], c[1] + 0.05, c[2]]);
    // The server clamps teleports to running speed; let it catch up before shooting.
    await page.waitForTimeout(1300);
    await stand(x, y, z, [c[0], c[1] + 0.05, c[2]]);
    await page.waitForTimeout(200);
    if (i === 2) await shot('03-courtyard-cup');
    // A dead-accurate pistol so the aimed shot goes exactly where the camera looks.
    await game(() => {
      const g = window.__game;
      g.fire({ spread: 0, aimSpread: 0, pellets: 1, range: 120, kick: 0, rpm: 400, sound: 'pistol', kind: 'pistol', auto: false });
    });
    await page.waitForTimeout(350);
  }
  check('all three cups broken by aimed shots', await game(() => window.__game.conn.room.sim.egg.stage === 'ready'), await game(() => JSON.stringify(window.__game.conn.room.sim.egg)));
  await stand(-13.9, 0, 4.6, [-15.4, 2.0, 4.6]);
  await page.waitForTimeout(2000);
  await shot('04-figurine-glow');
  check('figurine prompt', await game(() => window.__game.target?.kind === 'egg'));
  await game(() => window.__game.conn.send({ t: 'egg' }));
  await waitFor(() => !!window.__game.conn.room.sim.boss, null, 8000);
  await stand(-5, 0, 0, [-10.4, 1.2, -1.4]);
  await waitFor(() => [...window.__game.zombies.list.values()].some((z) => z.cls === 4 && z.state === 4), null, 8000);
  await page.waitForTimeout(700);
  await shot('05-kintsugi');
  check('boss bar shown', await game(() => !document.getElementById('bossBar')?.hidden));
  // Break a stage: she shatters and re-forms.
  await game(`(() => { const s = ${sim}; const k = s.boss; s.damageZombie(k, k.maxHp * 0.3, [...s.players.values()][0], 'body', [0,0,1]); })()`);
  await page.waitForTimeout(250);
  await shot('06-shatter');
  await waitFor(() => window.__game.conn.room.sim.boss?.state === 4, null, 6000);
  await page.waitForTimeout(200);
  await shot('07-reformed');
  // Finish her.
  await game(`(() => { const s = ${sim}; const k = s.boss; s.damageZombie(k, k.hp + 1, [...s.players.values()][0], 'head', [0,0,1]); })()`);
  await page.waitForTimeout(700);
  await shot('08-broken');
  check('boss killed, gold leaf dropped or already grabbed', await game(() => { const s = window.__game.conn.room.sim; return s.egg.stage === 'done' && (s.powerups.some((u) => u.type === 'goldleaf') || [...s.players.values()][0].weapons.includes('arcpistol')); }));
  const gold = await game(() => { const u = window.__game.conn.room.sim.powerups.find((q) => q.type === 'goldleaf'); return u && [u.x, u.y, u.z]; });
  if (gold) {
    await stand(gold[0] + 2, gold[1], gold[2], [gold[0], gold[1] + 0.8, gold[2]]);
    await page.waitForTimeout(500);
    await shot('09-gold-leaf');
    await stand(gold[0], gold[1], gold[2]);
    await waitFor(() => window.__game.p.weapons.includes('arcpistol'), null, 5000);
    check('gold leaf grants the Arc Pistol', true);
  }
} catch (err) {
  errors.push(`harness: ${err.message}`);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server?.kill();
}
console.log(JSON.stringify({ ok: errors.length === 0, results, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
