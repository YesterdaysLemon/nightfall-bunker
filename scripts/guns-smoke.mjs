// Headless, muted look at the guns: every gun's reload frozen at several points
// (a contact sheet), then the Leyden Rifle firing chain lightning down a row of
// zombies in the real client (solo, local sim). Output goes to output/guns/.
//
//   npm run build && node scripts/guns-smoke.mjs [--only kar98k,leyden] [--url http://127.0.0.1:5173]

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(opt('--out', 'output/guns'));
const only = opt('--only', '').split(',').filter(Boolean);
const FRAMES = [0, 0.12, 0.25, 0.36, 0.48, 0.6, 0.72, 0.86];
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
const results = {};
const check = (name, ok, detail) => { results[name] = ok ? 'ok' : `FAIL ${detail ?? ''}`; if (!ok) errors.push(`${name}: ${detail ?? ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`); });
const game = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await waitFor(() => window.__game && document.getElementById('loading').classList.contains('done'), null, 30000);
  await page.click('#btnSolo');
  await waitFor(() => window.__game.mode === 'play');
  await game(() => {
    const g = window.__game;
    g.input.fallback = true;
    g.input.setLocked(true);
    const sim = g.conn.room.sim;
    sim.players.forEach((p) => { p.hp = 1e9; });
    sim.phaseT = 1e9;                 // hold the pre-round: no zombies during the sheet
    Object.assign(g.p, { x: 0, y: 0, z: 0.5, yaw: Math.PI, pitch: -0.05 });
    document.getElementById('hud')?.style.setProperty('visibility', 'hidden');
  });

  // --- Reload contact sheet ---------------------------------------------------------------
  // Forge upgrades share their base gun's model and reload: one shows the camo.
  const ids = await game(() => Object.entries(window.__weapons.WEAPONS).filter(([id, W]) => !W.upgradeOf || id === 'm14_up').map(([id]) => id));
  const guns = (only.length ? only : ids);
  const sheet = [];
  for (const id of guns) {
    const row = { id, frames: [] };
    await game((id) => {
      const g = window.__game;
      g.vm.freezeU = null;
      g.vm.anim = null;
      g.vm.setWeapon(id, true);
    }, id);
    await page.waitForTimeout(120);
    for (const u of FRAMES) {
      await game(([id, u]) => {
        const g = window.__game;
        const { WEAPONS, reloadStyle } = window.__weapons;
        g.vm.freezeU = u;
        if (!g.vm.anim) g.vm.reload(2, reloadStyle(WEAPONS[id]));
      }, [id, u]);
      await page.waitForTimeout(90);
      const buf = await page.screenshot({ clip: { x: 240, y: 90, width: 720, height: 450 } });
      row.frames.push(buf.toString('base64'));
    }
    await game(() => { const g = window.__game; g.vm.freezeU = null; g.vm.anim = null; });
    sheet.push(row);
  }
  const html = `<html><body style="margin:0;background:#111;color:#ddd;font:12px monospace">${sheet.map((r) => `
    <div style="display:flex;align-items:center"><div style="width:90px;padding:4px">${r.id}</div>${r.frames.map((f, i) => `
      <div style="position:relative"><img src="data:image/png;base64,${f}" style="width:192px;height:120px;display:block;border:1px solid #222">
      <span style="position:absolute;left:3px;top:2px;color:#ff8">${FRAMES[i]}</span></div>`).join('')}</div>`).join('')}</body></html>`;
  const sp = await browser.newPage({ viewport: { width: 90 + 194 * FRAMES.length, height: 122 * sheet.length + 4 } });
  await sp.setContent(html);
  await sp.screenshot({ path: path.join(outDir, 'reloads.png'), fullPage: true });
  await sp.close();
  check('every gun rendered a reload', sheet.length === guns.length && sheet.every((r) => r.frames.length === FRAMES.length));

  // --- The Leyden Rifle in action ---------------------------------------------------------
  if (!only.length || only.includes('leyden')) {
    await game(() => {
      const g = window.__game;
      const sim = g.conn.room.sim;
      const sp = [...sim.players.values()][0];
      Object.assign(sp, { x: 0, y: 0, z: 2 });
      Object.assign(g.p, { x: 0, y: 0, z: 2, yaw: 0, pitch: -0.08 });
      sim.giveWeapon(sp, 'leyden');
      sim.emit(['give', sp.id, 'leyden', sp.weapons.join(',')]);
      // A loose row of walkers across the room, out of reach of each other's arms.
      const row = [[-2.5, -2], [-0.5, -2.6], [1.5, -2.2], [3.2, -3], [4.4, -4.5]];
      row.forEach(([x, z], i) => {
        const id = 900 + i;
        sim.zombies.set(id, { id, cls: 0, speed: 0.01, hp: 3000, maxHp: 3000, x, y: 0, z, yaw: 0, state: 4, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0, atkT: 99 });
      });
    });
    await waitFor(() => window.__game.p.cur === 'leyden' && window.__game.zombies.list.size >= 5, null, 5000);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, 'leyden-01-ready.png') });
    await game(() => {
      const g = window.__game;
      const t = g.zombies.get(901);
      g.p.yaw = Math.atan2(-(t.x - g.p.x), -(t.z - g.p.z));
      g.p.pitch = Math.atan2(t.y + 1.1 - (g.p.y + 1.62), Math.hypot(t.x - g.p.x, t.z - g.p.z));
    });
    await page.waitForTimeout(150);
    await game(() => { const g = window.__game; const W = window.__weapons.WEAPONS.leyden; g.p.ammo.leyden.mag--; g.fire(W); });
    for (const [i, ms] of [[2, 60], [3, 140], [4, 200]]) {
      await page.waitForTimeout(ms);
      await page.screenshot({ path: path.join(outDir, `leyden-0${i}-chain.png`) });
    }
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, 'leyden-05-after.png') });
    const left = await game(() => [900, 901, 902, 903, 904].filter((id) => window.__game.conn.room.sim.zombies.has(id)).length);
    check('the chain killed the row', left === 0, `${left} still standing`);
    const lit = await game(() => window.__game.vm.cores.map((m) => m[0].o.material === m[0].lit));
    check('a spent jar goes dark', lit.filter(Boolean).length === 2, JSON.stringify(lit));
  }
} catch (e) {
  errors.push(`harness: ${e.message}`);
} finally {
  await browser.close();
  server?.kill();
}
const report = { ok: errors.length === 0, results, errors };
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
