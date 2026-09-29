// Headless, muted camera tour of a map's dressing: boots the real client on the menu
// (no match), opens every door, throws the breaker, then flies the camera through a
// list of spots and screenshots each one through the game's own renderer and TV
// look. Prints the world's draw calls and triangles at each spot.
//
//   npx vite build --outDir output/dist-palace
//   NB_DIST=output/dist-palace node scripts/palace-tour.mjs [--out output/palace-tour]
//     [--only foyer,stage] [--map bunker] [--dark] [--size 960x540] [--stats] [--timing]
//     [--json out.json] [--frame] [--still] [--nocull]
//
// Each spot prints the frame's draw calls and triangles as the renderer counts them, then
// what the map's own level group contributes to that (frustum-visible meshes only), so the
// numbers move when the dressing is culled or thinned. --frame times Level.update; --still
// holds the lamps steady so two tours can be compared pixel for pixel; --nocull draws the
// palace whole (no portal culling) to compare against.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(opt('--out', 'output/palace-tour'));
const only = opt('--only', null)?.split(',');
const mapId = opt('--map', 'palace');
const dark = args.includes('--dark');
const still = args.includes('--still');
const nocull = args.includes('--nocull');
const crt = opt('--crt', null);
const [W, H] = opt('--size', '960x540').split('x').map(Number);
mkdirSync(outDir, { recursive: true });

// name: [camera position, look-at point]
const SPOTS = {
  palace: {
    'street': [[0, 1.7, 33], [0, 4.2, 20]],
    'street-west': [[-14, 1.7, 31], [2, 4, 21]],
    'street-east': [[16, 2.2, 30], [-2, 3.5, 21]],
    'foyer-south': [[0, 1.62, 11.5], [0, 1.9, 19]],
    'foyer-north': [[3.2, 1.62, 18.9], [-1.5, 2.0, 6.2]],
    'attract': [[8.5, 6.5, -6], [0, 3.5, -6]],
    'attract-2': [[-6, 5.5, 0.5], [0, 3.5, -6]],
    'foyer-corner': [[9.4, 1.62, 18.6], [-6, 2.2, 8]],
    'foyer-west': [[8, 1.62, 11], [-11, 2, 15.5]],
    'stairhall': [[-12.2, 1.62, 7.2], [-16, 2.6, 18]],
    'stairhall-up': [[-12.5, 1.62, 19.2], [-16, 3.8, 8]],
    'landing': [[-13, 5.22, 7.2], [-15.5, 2.2, 17]],
    'boxoffice': [[12, 1.62, 18.8], [17, 1.2, 8]],
    'boxoffice-back': [[17.3, 1.62, 7], [11.5, 1.4, 17]],
    'alley': [[15, 1.62, 4.5], [15, 2.2, -18]],
    'alley-back': [[14.4, 1.62, -22.5], [15.5, 2.5, 4]],
    'alley-up': [[13, 1.62, -8], [18, 7, -4]],
    'auditorium': [[0, 1.62, 4.5], [0, 3.2, -16]],
    'auditorium-side': [[-9.6, 1.62, 2.8], [6, 3.8, -12]],
    'auditorium-back': [[0, 2.82, -15.5], [0, 4, 6]],
    'dome': [[0, 1.62, -1], [0, 11, -4.5]],
    'seats': [[-5.2, 1.62, -12.5], [-2, 0.6, 2]],
    'stage': [[0, 2.82, -14.8], [0, 4.2, -22]],
    'stage-wing': [[10.8, 2.82, -15.5], [-6, 3.2, -20]],
    'backstage': [[-10.8, 2.82, -23], [6, 2.2, -29]],
    'backstage-east': [[10.6, 2.82, -23.2], [-6, 3.4, -29]],
    'forge-alcove': [[0, 2.82, -20.4], [0, 2.4, -25]],
    'dressing': [[-15, 5.22, 5], [-15, 4.6, -10]],
    'dressing-south': [[-13.2, 5.22, -9.5], [-17, 4.2, -21]],
    'vanity': [[-14.6, 5.22, -1.8], [-18, 4.8, -4]],
    'booth': [[0, 8.82, 9.6], [0, 8.4, 5]],
    'booth-back': [[-0.4, 8.82, 6.6], [3.5, 8.3, 9.8]],
    'fire-escape': [[-14.2, 5.22, -2], [-22, 4.6, -2]],
    'cellar': [[-10.6, 1.62, -3], [-16, 1.4, -3]],
    'dock': [[-6, 2.82, -27.6], [-6, 2.2, -35]],
    'west-lot': [[-14.8, 1.62, 8], [-24, 2, 8]],
    'east-lot': [[15.2, 1.62, 12], [25, 2, 12]],
    'derelict': [[14.2, 1.62, -3], [22, 1.6, -3]],
    'front-window': [[-6, 1.62, 18.5], [-6, 2, 28]],
    // Close on the seats, the balusters and the chandelier (the thinned geometry).
    'seat-aisle': [[-5.2, 1.4, -3], [-8.4, 0.8, -3.6]],
    'seat-row': [[-1.4, 1.5, -8.5], [-3.4, 0.7, -5.5]],
    'stair-rail': [[-13.6, 1.62, 8.6], [-12.2, 1.5, 12.8]],
    'chandelier': [[3.5, 1.62, 15.5], [0, 4.6, 13]],
    // Outside, where no player stands (the zombies' side), for review.
    'out-fire-escape': [[-24.5, 2.6, -2], [-18, 4.2, -9]],
    'out-dock': [[3, 3.2, -41], [-2, 2, -30]],
    'out-derelict': [[22.5, 1.6, 0], [18, 1.6, -3]],
    'out-marquee': [[-4, 2.4, 26.5], [1, 4.4, 21]],
    'out-cellar': [[-13, 1.6, 4.5], [-15, 1.2, -12]],
  },
  bunker: {
    'bunker-main': [[0, 1.62, 3], [-6, 1.6, -4]],
    'bunker-other': [[-8, 1.62, -3], [6, 1.8, 3]],
    'bunker-loft': [[2, 5, 3], [-8, 3, -3]],
  },
};

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
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|WrongDocument|fonts\.g/i.test(m.text())) errors.push(`console: ${m.text()}`); });

try {
  await page.goto(`${base}/?mute&test`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('done'), null, { timeout: 30000, polling: 100 });
  if (args.includes('--timing')) {
    // How long building each map's world takes (level, dressing, machines), a few times over.
    const t = await page.evaluate(() => {
      const g = window.__game, out = { bunker: [], palace: [] };
      for (let k = 0; k < 3; k++) {
        for (const id of ['palace', 'bunker']) {
          const t0 = performance.now();
          g.setMap(id);
          out[id].push(Math.round(performance.now() - t0));
        }
      }
      return out;
    });
    console.log(`setMap ms: palace ${t.palace.join(', ')}; bunker ${t.bunker.join(', ')}`);
  }
  if (mapId !== 'bunker') {
    await page.evaluate((id) => {
      const btns = [...document.querySelectorAll('#mapPick button')];
      (btns.find((b) => b.textContent.toLowerCase().includes(id === 'palace' ? 'palace' : id)) || btns[1]).click();
    }, mapId);
    await page.waitForFunction((id) => window.__game.map.id === id, mapId, { timeout: 20000 });
  }
  const info = await page.evaluate(({ dark, crt, still, nocull }) => {
    const g = window.__game;
    if (still) for (const b of g.rig.bulbs) b.flicker = 0;
    if (nocull && g.level.palace?.culler) g.level.palace.culler.enabled = false;
    document.getElementById('menu').style.display = 'none';
    g.attract = () => {};
    if (crt != null) g.setCrt(Number(crt));
    const cam = g.rig.camera;
    cam.fov = g.settings.fov || 80;
    cam.updateProjectionMatrix();
    for (const d of g.map.DOORS) if (d.cost) g.level.openDoor(d.id, true);
    if (!dark && g.map.POWER) {
      g.power = true;
      g.rig.setPower(true);
      g.machines.setPower(true);
    }
    let tris = 0, meshes = 0;
    const by = {};
    g.level.group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      tris += t;
      by[o.name || o.type] = (by[o.name || o.type] || 0) + t;
    });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
    return { meshes, tris: Math.round(tris), top };
  }, { dark, crt, still, nocull });
  console.log(`${mapId}: level meshes ${info.meshes}, level triangles ${info.tris}`);
  // Let the breaker's lamps warm up (frames are slow headless, and the game clamps dt).
  if (!dark) await page.waitForTimeout(4000);
  if (args.includes('--stats')) console.log(info.top);
  if (args.includes('--frame')) {
    // The per-frame CPU cost of the world's update (the dressing's part, then the whole).
    const ms = await page.evaluate(() => {
      // (the camera drifts a hair each call, as a moving player's does, so nothing is skipped as unchanged)
      const g = window.__game, N = 400, cam = g.rig.camera, time = (f) => { const t0 = performance.now(); for (let i = 0; i < N; i++) { cam.position.x += (i & 1 ? -0.002 : 0.002); f(); } return (performance.now() - t0) / N; };
      return { dress: time(() => g.level.dress.update(g.level, 0.016)), level: time(() => g.level.update(0.016)) };
    });
    console.log(`per-frame update: dressing ${ms.dress.toFixed(3)} ms, Level.update ${ms.level.toFixed(3)} ms`);
  }
  const results = [];
  const spots = Object.entries(SPOTS[mapId]).filter(([name]) => !only || only.includes(name));
  for (const [name, [pos, look]] of spots) {
    await page.evaluate(([pos, look]) => {
      const cam = window.__game.rig.camera;
      cam.position.set(...pos);
      cam.lookAt(...look);
    }, [pos, look]);
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const g = window.__game, rd = g.rig.renderer;
      g.rig.beginFrame();
      rd.render(g.rig.scene, g.rig.camera);
      const out = { calls: rd.info.render.calls, tris: rd.info.render.triangles };
      g.rig.endFrame();
      // What the frame drew, by source: the level's meshes that survive frustum culling (the
      // same test three.js makes), the machines, and the rest (zombies, effects).
      const cam = g.rig.camera;
      cam.updateMatrixWorld();
      const e = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements;
      const planes = [[3, 0, -1], [3, 0, 1], [3, 1, 1], [3, 1, -1], [3, 2, -1], [3, 2, 1]].map(([a, b, s]) => {
        const p = [e[a] + s * e[b], e[a + 4] + s * e[b + 4], e[a + 8] + s * e[b + 8], e[a + 12] + s * e[b + 12]];
        const l = Math.hypot(p[0], p[1], p[2]);
        return p.map((v) => v / l);
      });
      const inView = (o) => {
        const bs = o.boundingSphere || (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
        if (!bs) return true;
        const sp = bs.clone().applyMatrix4(o.matrixWorld);
        return planes.every((p) => p[0] * sp.center.x + p[1] * sp.center.y + p[2] * sp.center.z + p[3] >= -sp.radius);
      };
      const trisOf = (o) => {
        const gm = o.geometry;
        let n = gm.index ? gm.index.count : gm.attributes.position.count;
        if (Number.isFinite(gm.drawRange.count)) n = Math.min(n, gm.drawRange.count);
        return (n / 3) * (o.isInstancedMesh ? o.count : 1);
      };
      const cat = { level: [0, 0], machines: [0, 0], other: [0, 0] };
      const lvlMat = {};
      g.rig.scene.traverseVisible((o) => {
        if (!o.isMesh) return;
        if (o.frustumCulled && !inView(o)) return;
        if (o.isInstancedMesh && o.count === 0) return;
        let top = o;
        while (top.parent && top.parent !== g.rig.scene) top = top.parent;
        const k = top === g.level.group ? 'level' : top.name === 'machines' ? 'machines' : 'other';
        const t = trisOf(o);
        cat[k][0] += 1; cat[k][1] += t;
        if (k === 'level') { const key = o.name || o.type; lvlMat[key] = (lvlMat[key] || 0) + t; }
      });
      out.cat = cat;
      out.top = Object.entries(lvlMat).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + ' ' + Math.round(v)).join(', ');
      return out;
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    const L = r.cat.level, M = r.cat.machines, O = r.cat.other;
    results.push({ name, calls: r.calls, tris: r.tris, levelCalls: L[0], levelTris: Math.round(L[1]), machineCalls: M[0], machineTris: Math.round(M[1]), otherCalls: O[0], otherTris: Math.round(O[1]) });
    console.log(`${name.padEnd(18)} calls ${String(r.calls).padStart(4)}  tris ${String(r.tris).padStart(6)}   level ${String(L[0]).padStart(3)} calls ${String(Math.round(L[1])).padStart(6)} tris   machines ${M[0]}/${Math.round(M[1])}   other ${O[0]}/${Math.round(O[1])}${args.includes('--stats') ? `
    ${r.top}` : ''}`);
  }
  if (results.length) {
    const col = (k) => results.map((r) => r[k]).sort((a, b) => a - b);
    const mean = (k) => Math.round(results.reduce((t, r) => t + r[k], 0) / results.length);
    const med = (k) => col(k)[Math.floor(results.length / 2)];
    const max = (k) => col(k)[results.length - 1];
    console.log(`summary over ${results.length} spots  tris mean ${mean('tris')} median ${med('tris')} max ${max('tris')}  |  calls mean ${mean('calls')} median ${med('calls')} max ${max('calls')}  |  level tris mean ${mean('levelTris')} max ${max('levelTris')}, calls mean ${mean('levelCalls')} max ${max('levelCalls')}`);
    const jf = opt('--json', null);
    if (jf) { const { writeFileSync } = await import('node:fs'); writeFileSync(path.resolve(jf), JSON.stringify(results, null, 1)); }
  }
  // The Forge's curtain drawing back (the palace's custom door), mid-way and open.
  if (mapId === 'palace' && (!only || only.includes('forge-open'))) {
    await page.evaluate(() => {
      const g = window.__game, cam = g.rig.camera;
      cam.position.set(0, 2.82, -19.6);
      cam.lookAt(0, 2.6, -25);
      g.level.openDoor('curtain');
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, 'forge-opening.png') });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(outDir, 'forge-open.png') });
    console.log('forge-open        (curtain drawn back)');
  }
} catch (e) {
  errors.push(`script: ${e.message}`);
} finally {
  await browser.close();
  server?.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`screenshots in ${outDir}`);
