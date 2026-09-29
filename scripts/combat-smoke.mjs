// Headless, muted look at blast aftermath in the real client (solo, local sim):
// crawlers (a blast took their legs), the Arc Pistol's stun, and the bigger
// hounds. Checks that an aimed shot at a crawler's raised head is a headshot and
// that a shot at standing head height passes over it. Screenshots: output/combat/.
//
//   npm run build && node scripts/combat-smoke.mjs [--debug] (draws the hit volumes)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const debug = args.includes('--debug');
const outDir = path.resolve(opt('--out', 'output/combat'));
mkdirSync(outDir, { recursive: true });

let server = null;
let base = opt('--url', null);
if (!base) {
  const port = 18800 + Math.floor(Math.random() * 90);
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

const stand = (x, y, z, look) => game(([x, y, z, look]) => {
  const g = window.__game;
  Object.assign(g.p, { x, y, z, vx: 0, vy: 0, vz: 0 });
  const ey = y + g.p.eye;
  const dx = look[0] - x, dy = look[1] - ey, dz = look[2] - z;
  g.p.yaw = Math.atan2(-dx, -dz);
  g.p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}, [x, y, z, look]);

// Place still zombies (speed 0) facing the player (+z); some crawl, some are stunned.
const place = (list) => game((list) => {
  const s = window.__game.conn.room.sim;
  for (const [id, x, z, cls, crawl, stun] of list) {
    const zb = { id, cls, speed: 0, hp: 1e7, maxHp: 1e7, x, y: 0, z, yaw: 0, state: 4, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0, cool: 99 };
    s.zombies.set(id, zb);
    if (crawl) { s.cripple(zb); zb.speed = 0; zb.cool = 99; }
    if (stun) zb.slowT = 999;
  }
}, list);

// Freeze the rules' AI for placed zombies: they keep still and keep facing +z.
const freeze = () => game(() => {
  const s = window.__game.conn.room.sim;
  if (s.__frozen) return;
  s.__frozen = true;
  s.stepZombies = function () { for (const z of this.zombies.values()) { z.yaw = z.fixYaw ?? 0; if (z.slowT > 0) z.slowT = 999; } };
});

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await waitFor(() => window.__game && document.getElementById('loading').classList.contains('done'), null, 30000);
  await page.click('#btnSolo');
  await waitFor(() => window.__game.mode === 'play');
  await game(() => {
    const g = window.__game;
    g.input.fallback = true; g.input.setLocked(true);
    const s = g.conn.room.sim;
    s.phase = 'break'; s.phaseT = 1e9; s.zombies.clear();
    s.players.forEach((p) => { p.hp = 1e9; });
    // Record what the rules say about every hit.
    const emit = s.emit.bind(s);
    window.__ev = [];
    s.emit = (e) => { window.__ev.push(e); emit(e); };
  });
  await freeze();
  // Start room: the player at z = 3 looking toward -z; zombies about 3.5 m away, facing the player.
  await stand(0, 0, 3, [0, 0.4, -1]);
  await place([[901, -1.2, -0.4, 0, true, false], [902, 0.3, -0.6, 1, true, true], [903, 1.6, -0.2, 2, false, true], [904, -2.6, -1.2, 0, false, false]]);
  await page.waitForTimeout(900);
  const flags = await game(() => [...window.__game.zombies.list.values()].map((z) => [z.id, z.flags]));
  const f = Object.fromEntries(flags);
  check('clients see crawlers', (f[901] & 1) && (f[902] & 1), JSON.stringify(flags));
  check('clients see the stun', (f[902] & 2) && (f[903] & 2) && !(f[904] & 2), JSON.stringify(flags));
  if (debug) {
    await game(() => {
      const { THREE, enemyFor } = window.__dev;
      const g = window.__game;
      const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false });
      for (const z of g.zombies.list.values()) {
        const E = enemyFor(z.cls, z.flags);
        const fx = Math.sin(z.yaw) * E.scale, fz = Math.cos(z.yaw) * E.scale;
        for (const v of E.hit) {
          if (v[1] !== 'sphere') continue;
          const m = new THREE.Mesh(new THREE.SphereGeometry(v[4] * E.scale, 10, 6), mat);
          m.position.set(z.x + fx * v[2], z.y + v[3] * E.scale, z.z + fz * v[2]);
          m.renderOrder = 999;
          g.rig.scene.add(m);
        }
      }
    });
    await page.waitForTimeout(200);
  }
  await shot('01-crawlers-and-stun');
  // From the side, low: the crawl pose.
  await stand(1.3, 0, 0.2, [-1.2, 0.3, -0.2]);
  await page.waitForTimeout(400);
  await shot('02-crawler-side');

  // Aimed shots through the real client hit test.
  const fireAt = async (target) => {
    await stand(0, 0, 3, target);
    await page.waitForTimeout(150);
    await game(() => { window.__ev.length = 0; window.__game.p.reloadT = 0; });
    await game(() => window.__game.fire({ spread: 0, aimSpread: 0, pellets: 1, range: 120, kick: 0, rpm: 400, sound: 'pistol', kind: 'pistol', auto: false }));
    await page.waitForTimeout(250);
    return game(() => window.__ev.filter((e) => e[0] === 'zhit').map((e) => [e[1], e[2]]));
  };
  const head = await game(() => {
    const z = window.__game.zombies.get(901);
    return [z.x + Math.sin(z.yaw) * 0.7, z.y + 0.36, z.z + Math.cos(z.yaw) * 0.7];
  });
  const hHead = await fireAt(head);
  check('a shot at a crawler\'s raised head is a headshot', hHead.some(([id, part]) => id === 901 && part === 0), JSON.stringify(hHead));
  const over = await fireAt([-1.2, 1.63, -0.4]);
  check('a head-high shot passes over a crawler', !over.some(([id]) => id === 901), JSON.stringify(over));
  const stand4 = await fireAt([-2.6, 1.63, -1.2]);
  check('a standing zombie is still hit at head height', stand4.some(([id, part]) => id === 904 && part === 0), JSON.stringify(stand4));

  // A real grenade into a crowd: some survive as crawlers.
  await game(() => { window.__game.conn.room.sim.zombies.clear(); });
  const crowd = [];
  for (let i = 0; i < 16; i++) crowd.push([1000 + i, -2 + (i % 4) * 1.2, -2 - Math.floor(i / 4) * 1.0, i % 3, false, false]);
  await place(crowd);
  await game(() => { const s = window.__game.conn.room.sim; for (const z of s.zombies.values()) z.hp = 900; });
  await stand(0, 0, 3, [0, 0.8, -3]);
  await page.waitForTimeout(300);
  await game(() => { const s = window.__game.conn.room.sim; const p = [...s.players.values()][0]; s.explode(-0.2, 0.3, -3.4, 4.5, 420, p, 'nade', 0); });
  await page.waitForTimeout(700);
  const crawling = await game(() => [...window.__game.zombies.list.values()].filter((z) => z.flags & 1).length);
  check('a grenade leaves crawlers', crawling > 0, `${crawling}`);
  await shot('03-grenade-crawlers');

  // Hounds at their new size, beside a standing zombie for scale.
  await game(() => { window.__game.conn.room.sim.zombies.clear(); });
  await place([[1101, -0.9, -0.5, 3, false, false], [1102, 0.8, -0.5, 0, false, false]]);
  await game(() => { window.__game.conn.room.sim.zombies.get(1101).fixYaw = Math.PI / 2; });
  await stand(0, 0, 3.2, [0, 0.8, -0.5]);
  await page.waitForTimeout(900);
  await shot('04-hound-scale');
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
