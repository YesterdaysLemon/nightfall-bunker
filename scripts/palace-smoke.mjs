// Headless, muted play-through of the Aurora Picture Palace in the real client
// (solo, local sim): pick the map, throw the breaker, buy a perk, ride the Magic
// Lantern to the booth and back, forge a gun, run a Spark Gate, and fire the Gale
// Cannon into a crowd. Screenshots go to output/palace/.
//
//   npm run build && node scripts/palace-smoke.mjs

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(opt('--out', 'output/palace'));
mkdirSync(outDir, { recursive: true });

let server = null;
let base = opt('--url', null);
if (!base) {
  const port = 18700 + Math.floor(Math.random() * 90);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const game = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

// Put the local player (client and server) somewhere, looking at a point.
const stand = (pos, look) => game(([pos, look]) => {
  const g = window.__game, s = g.conn.room.sim, me = s.players.get(g.me);
  Object.assign(g.p, { x: pos[0], y: pos[1], z: pos[2], vx: 0, vy: 0, vz: 0 });
  Object.assign(me, { x: pos[0], y: pos[1], z: pos[2], lastIn: s.time });
  if (look) {
    const dx = look[0] - pos[0], dy = look[1] - (pos[1] + g.p.eye), dz = look[2] - pos[2];
    g.p.yaw = Math.atan2(-dx, -dz);
    g.p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}, [pos, look]);
const buy = (k, id) => game(([k, id]) => window.__game.conn.send({ t: 'buy', k, id }), [k, id]);
const sim = (fn, arg) => game(`(${fn})(window.__game.conn.room.sim, window.__game, ${JSON.stringify(arg ?? null)})`);

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await waitFor(() => window.__game && document.getElementById('loading').classList.contains('done'), null, 30000);
  // Pick the palace in the menu, then play solo.
  await page.click('#mapPick button:nth-child(2)');
  await waitFor(() => window.__game.map.id === 'palace');
  await page.waitForTimeout(500);
  await shot('00-menu');
  await page.click('#btnSolo');
  await waitFor(() => window.__game.mode === 'play');
  check('solo starts on the chosen map', await game(() => window.__game.conn.room.sim.map.id === 'palace'));
  await game(() => { const g = window.__game; g.input.fallback = true; g.input.setLocked(true); });
  await sim((s) => { s.phase = 'break'; s.phaseT = 1e9; s.players.forEach((p) => { p.points = 1e6; p.hp = 1e9; }); });
  const M = await game(() => { const m = window.__game.map; return { POWER: m.POWER, PERKS: m.PERKS, FORGE: m.FORGE, TELEPORT: m.TELEPORT, TRAPS: m.TRAPS, DOORS: m.DOORS.map((d) => d.id) }; });

  await stand([0, 0, 12.5], [0, 1.4, 19]);
  await page.waitForTimeout(600);
  await shot('01-foyer');

  // Ordinary bullets: a zombie outside a street window, shot through it.
  const hitOutside = await game(async () => {
    const g = window.__game, s = g.conn.room.sim, W = s.map.WINDOWS[0];
    const emit = s.emit.bind(s), ev = [];
    s.emit = (e) => { ev.push(e); emit(e); };
    s.zombies.set(4001, { id: 4001, cls: 0, speed: 0, hp: 1e6, maxHp: 1e6, x: W.x + W.n[0] * 2.5, y: 0, z: W.z + W.n[1] * 2.5, yaw: Math.PI, state: 1, t: 9, win: W.id, lv: 0, atk: 0, cell: -1, stuck: 0 });
    const me = s.players.get(g.me);
    Object.assign(g.p, { x: W.repair[0], y: 0, z: W.repair[2], vx: 0, vy: 0, vz: 0 }); Object.assign(me, { x: W.repair[0], y: 0, z: W.repair[2] });
    const dx = W.n[0] * 3.6, dz = W.n[1] * 3.6;
    g.p.yaw = Math.atan2(-dx, -dz); g.p.pitch = Math.atan2(1.3 - g.p.eye, Math.hypot(dx, dz));
    await new Promise((r) => setTimeout(r, 500));
    g.p.fireT = 0;
    g.fire({ spread: 0, aimSpread: 0, pellets: 1, range: 120, kick: 0, rpm: 400, sound: 'pistol', kind: 'pistol', auto: false });
    await new Promise((r) => setTimeout(r, 300));
    s.emit = emit;
    s.zombies.delete(4001);
    return ev.some((e) => e[0] === 'zhit' && e[1] === 4001);
  });
  check('bullets hit a zombie through a window', hitOutside);
  await stand([0, 0, 9], [0, 2, 0]);
  await page.waitForTimeout(300);
  await shot('01b-foyer-north');

  // Open the building (the rules' own door code) and walk the routes.
  await sim((s) => { for (const d of s.map.DOORS) if (d.cost) s.openDoor(d.id); });
  await page.waitForTimeout(300);
  await stand([0, 0, 4], [0, 2, -16]);
  await page.waitForTimeout(500);
  await shot('02-auditorium');
  await stand([-15, 3.6, 2], [-15, 4.8, -10]);
  await page.waitForTimeout(400);
  await shot('03-dressing-rooms');
  await stand([15, 0, 4], [15, 1.4, -12]);
  await page.waitForTimeout(400);
  await shot('04-alley');

  // Power: dark machines until the breaker is thrown backstage.
  await stand(M.POWER.use, [M.POWER.pos[0], M.POWER.pos[1] + 1.6, M.POWER.pos[2]]);
  await page.waitForTimeout(400);
  check('prompt at the breaker', await game(() => window.__game.target?.kind === 'power'), await game(() => JSON.stringify(window.__game.target)));
  await shot('05-breaker');
  await buy('power');
  await waitFor(() => window.__game.power === true, null, 5000);
  await page.waitForTimeout(1800);
  check('the power comes on', await game(() => window.__game.conn.room.sim.power && window.__game.rig.bulbs.some((b) => b.needsPower && b.on > 0.5)));
  await shot('06-power-on');

  // A perk: prompt, purchase, the HUD icon.
  const laz = M.PERKS.find((m) => m.perk === 'hairtrigger');
  await stand(laz.use, [laz.pos[0], laz.pos[1] + 1.4, laz.pos[2]]);
  await page.waitForTimeout(400);
  check('prompt at a perk machine', await game(() => window.__game.target?.kind === 'perk'), await game(() => JSON.stringify(window.__game.target)));
  await shot('07-perk-machine');
  await buy('perk', 'hairtrigger');
  await waitFor(() => window.__game.p.perks.includes('hairtrigger'), null, 5000);
  await page.waitForTimeout(700);
  check('drinking the perk', await game(() => window.__game.vm.drinking));
  await shot('07b-drinking');
  check('the perk shows on the HUD', await game(() => document.querySelectorAll('#perks img').length === 1));
  for (const m of M.PERKS) {
    await stand(m.use, [m.pos[0], m.pos[1] + 1.2, m.pos[2]]);
    await page.waitForTimeout(250);
    await shot(`08-perk-${m.perk}`);
  }

  // The Magic Lantern: lever at the alley pad, link at the lantern, ride.
  const TP = M.TELEPORT, pad = TP.pads[1];
  await stand(pad.use, [pad.pos[0], pad.pos[1] + 0.5, pad.pos[2]]);
  await page.waitForTimeout(300);
  await buy('link', pad.id);
  await waitFor(() => window.__game.pads[1] === 'lever', null, 4000);
  await stand(TP.core.use, [TP.core.pos[0], TP.core.pos[1] + 2, TP.core.pos[2]]);
  await page.waitForTimeout(300);
  await shot('09-lantern');
  await buy('link', 'core');
  await waitFor(() => window.__game.pads[1] === 'linked', null, 4000);
  await stand(pad.pos, [pad.pos[0], pad.pos[1] + 1, pad.pos[2] + 3]);
  await page.waitForTimeout(300);
  await buy('tele', pad.id);
  await waitFor(() => window.__game.p.y > 6, null, 5000);
  check('the teleporter takes you to the booth', await game(() => window.__game.p.y > 6 && window.__game.conn.room.sim.players.get(window.__game.me).away));
  await page.waitForTimeout(900);
  await game(() => { const g = window.__game; g.p.yaw = 0; g.p.pitch = -0.15; });
  await page.waitForTimeout(300);
  await shot('10-booth');
  check('the curtain opens', await game(() => window.__game.openDoors.has('curtain')));
  await sim((s) => { for (const t of s.tele.trips) t.t = 0.05; });
  await waitFor(() => window.__game.p.y < 3 && Math.abs(window.__game.p.y - 1.2) < 0.3, null, 5000);
  check('and brings you back to the stage', true);

  // The Forge: the M14 goes in and comes out upgraded.
  await sim((s, g) => { const p = s.players.get(g.me); s.giveWeapon(p, 'm14'); s.emit(['give', p.id, 'm14', p.weapons.join(',')]); });
  await page.waitForTimeout(400);
  await stand(M.FORGE.use, [M.FORGE.pos[0] + 0.63, M.FORGE.pos[1] + 1.2, M.FORGE.pos[2]]);
  await page.waitForTimeout(500);
  check('prompt at the Forge', await game(() => window.__game.target?.kind === 'forge'), await game(() => JSON.stringify(window.__game.target)));
  await shot('11-forge');
  await buy('forge');
  await page.waitForTimeout(1500);
  await shot('12-forge-working');
  await waitFor(() => window.__game.forge.state === 'ready', null, 8000);
  await page.waitForTimeout(300);
  await shot('13-forge-ready');
  await buy('forgeTake');
  await waitFor(() => window.__game.p.weapons.includes('m14_up'), null, 4000);
  await page.waitForTimeout(700);
  check('the upgraded gun is in hand', await game(() => window.__game.p.cur === 'm14_up'));
  await shot('14-forged-gun');

  // A Spark Gate in the alley fries a zombie walking through.
  const T = M.TRAPS[1];
  await stand(T.switch.use, [T.switch.pos[0], T.switch.pos[1], T.switch.pos[2]]);
  await page.waitForTimeout(300);
  await buy('trap', T.id);
  await waitFor(() => window.__game.traps[1] === 'active', null, 4000);
  await sim((s, g, a) => {
    const zb = { id: 5001, cls: 0, speed: 1, hp: 5000, maxHp: 5000, x: (a[0] + a[3]) / 2, y: 0, z: (a[2] + a[5]) / 2, yaw: 0, state: 4, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0 };
    s.zombies.set(zb.id, zb);
  }, T.area);
  await stand([13.4, 0, -6.5], [13.4, 1.2, -10]);
  await page.waitForTimeout(300);
  await shot('15-spark-gate');
  check('the gate fries it', await sim((s) => !s.zombies.has(5001)));

  // The Gale Cannon into a crowd in the auditorium.
  await sim((s, g) => {
    const p = s.players.get(g.me);
    s.zombies.clear();
    for (let i = 0; i < 8; i++) s.zombies.set(6000 + i, { id: 6000 + i, cls: i % 3, speed: 0, hp: 5000, maxHp: 5000, x: -3 + (i % 4) * 2, y: 0, z: -4 - Math.floor(i / 4) * 1.6, yaw: 0, state: 4, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 99, cool: 99 });
    s.giveWeapon(p, 'galecannon');
    s.emit(['give', p.id, 'galecannon', p.weapons.join(',')]);
  });
  await stand([0, 0, 4], [0, 1.1, -5]);
  await page.waitForTimeout(800);
  await shot('16-gale-cannon');
  await game(() => { const g = window.__game; g.p.fireT = 0; g.p.reloadT = 0; g.p.switchT = 0; g.fire(window.__weapons.WEAPONS.galecannon); });
  await page.waitForTimeout(350);
  await shot('17-gale-blast');
  check('the Gale Cannon flings the crowd', await sim((s) => [...s.zombies.keys()].filter((id) => id >= 6000).length <= 2), await sim((s) => s.zombies.size));
} catch (e) {
  errors.push(`script: ${e.message}`);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
  server?.kill();
}
console.log(JSON.stringify(results, null, 2));
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`screenshots in ${outDir}`);
