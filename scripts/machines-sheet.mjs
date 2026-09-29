// Headless, muted contact sheet of the world props in src/client/render/machines.js:
// the perk machines, the Forge, the Magic Lantern teleporter and its pad, the
// spark gate and its switch, the main breaker and the box token, each in its
// states (unpowered, powered, mid-animation), lit like the bunker at night and
// presented through the 1997 TV pass (retro.js). Also the four perk icons.
// No server or build needed: machines.js is bundled with esbuild into one page.
//
//   node scripts/machines-sheet.mjs [--only perks,forge,tele,traps,breaker,token,lineup]
//
// Output (output/machines/): sheet.png (every cell), <cell>.png close-ups at
// 800 x 600, lineup*.png at game distance, icons.png, and stats.json (draw
// calls, triangles and lights per machine).

import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(root, opt('--out', 'output/machines'));
const only = opt('--only', '').split(',').filter(Boolean);
mkdirSync(outDir, { recursive: true });

// --- the page -----------------------------------------------------------------------------------
// window.render(groups) renders every cell and returns data URLs plus stats.
const entry = /* js */`
import * as THREE from 'three';
import * as M from './src/client/render/machines.js';
import { perkIcon } from './src/client/perk-icons.js';
import { makeTvPass, prepareRetroTextures, setRetroTextures } from './src/client/render/retro.js';
import { createTextures } from './src/client/render/textures.js';
import { buildWeaponModel } from './src/client/render/weapons3d.js';
import { PERKS, PERK_IDS } from './src/shared/perks.js';

const W = 800, H = 600, LINES = 300;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const rt = new THREE.WebGLRenderTarget(Math.round(LINES * W / H), LINES, { type: THREE.HalfFloatType });
rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
const tv = makeTvPass();
tv.material.uniforms.tScene.value = rt.texture;
tv.material.uniforms.uRes.value.set(rt.width, rt.height);
tv.material.uniforms.uScan.value = 0.16;

// the bunker's night rig (scene.js): fog, moon and sky fill, warm bulbs
const scene = new THREE.Scene();
const fog = new THREE.Color(0x0d1117);
scene.background = fog.clone();
scene.fog = new THREE.FogExp2(fog, 0.032);
scene.add(new THREE.HemisphereLight(0x6f84aa, 0x2a231b, 1.1));
const moon = new THREE.DirectionalLight(0x9fb4e0, 1.3);
moon.position.set(-30, 60, -40);
scene.add(moon, new THREE.AmbientLight(0x3a342c, 0.6));
const key = new THREE.PointLight(0xffc98f, 24, 12.5, 1.6);
const back = new THREE.PointLight(0xffbd7a, 20, 12, 1.6);
scene.add(key, back);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd7a0 }));
scene.add(bulb);

const tex = createTextures(renderer);
prepareRetroTextures(tex);
setRetroTextures(tex, true);
const plane = (w, h, t, rep) => {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / rep, uv.getY(i) * h / rep);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t }));
};
const floor = plane(40, 40, tex.floorBoards, 2.5);
floor.rotation.x = -Math.PI / 2;
const wall = plane(40, 9, tex.plaster, 4.5);
wall.position.y = 4.5;
scene.add(floor, wall);

const camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 200);

function run(g, secs, from = 0) {
  const u = g.userData;
  let t = from;
  for (let s = 0; s < secs; s += 1 / 60) { t += 1 / 60; u.update(1 / 60, t); }
  return t;
}

function frame(objs, o) {
  for (const obj of objs) scene.add(obj);
  wall.position.z = o.wall ?? -1.3;
  camera.fov = o.fov ?? 50;
  camera.updateProjectionMatrix();
  const tg = new THREE.Vector3(...(o.target ?? [0, 1.1, 0]));
  const yaw = o.yaw ?? 0.3, dist = o.dist ?? 4;
  camera.position.set(tg.x + Math.sin(yaw) * dist, o.eye ?? 1.6, tg.z + Math.cos(yaw) * dist);
  camera.lookAt(tg);
  // a bulb up and to the left of the camera, another further off to the right
  const kp = o.key ?? [tg.x - 1.8, 2.55, tg.z + 2.2];
  key.position.set(...kp);
  bulb.position.set(...kp);
  back.position.set(...(o.back ?? [tg.x + 4, 2.55, tg.z + 1]));
  key.intensity = o.dark ? 0 : 24;
  bulb.visible = !o.dark;
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(tv.scene, tv.camera);
  const url = renderer.domElement.toDataURL('image/png');
  for (const obj of objs) scene.remove(obj);
  return url;
}

function stats(g) {
  let draws = 0, tris = 0, lights = 0;
  g.traverse((o) => {
    if (o.isLight) lights++;
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    draws++;
    const geo = o.geometry;
    if (o.isMesh && geo) tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  });
  return { draws, tris: Math.round(tris), lights };
}

const CELLS = [];
const cell = (group, name, label, objs, o) => CELLS.push({ group, name, label, objs, o });

function perks() {
  for (const id of PERK_IDS) {
    const view = { target: [0, 1.15, 0], dist: 3.9, yaw: 0.32, wall: -0.75 };
    const a = M.buildPerkMachine(id);
    run(a, 0.5);
    cell('perks', id + '-off', PERKS[id].name + ': unpowered', [a], view);
    const b = M.buildPerkMachine(id);
    b.userData.setPower(true);
    run(b, 2.5);
    cell('perks', id + '-on', PERKS[id].name + ': powered', [b], view);
    const c = M.buildPerkMachine(id);
    c.userData.setPower(true);
    let t = run(c, 2.5);
    c.userData.vend();
    run(c, 0.42, t);
    cell('perks', id + '-vend', PERKS[id].name + ': vending', [c], { target: [0, 0.55, 0.4], dist: 1.6, yaw: 0.35, eye: 1.2, wall: -0.75, fov: 50 });
  }
  const side = M.buildPerkMachine('lazarus');
  side.userData.setPower(true);
  run(side, 2.5);
  cell('perks', 'lazarus-side', 'Lazarus Draught: from the left', [side], { target: [0, 1.3, 0], dist: 3.6, yaw: -0.9, wall: -0.75 });
}

function lineup() {
  const make = (on) => PERK_IDS.map((id, i) => {
    const m = M.buildPerkMachine(id);
    m.position.set(-3.45 + i * 2.3, 0, 0);
    if (on) m.userData.setPower(true);
    run(m, 2.5);
    return m;
  });
  const view = { target: [0, 1.2, 0], dist: 6.5, yaw: 0, fov: 75, wall: -0.75, key: [-2, 2.55, 3.2], back: [3, 2.55, 3] };
  cell('lineup', 'lineup-on', 'Perk machines, powered, at 6.5 m (game FOV)', make(true), view);
  cell('lineup', 'lineup-off', 'Perk machines, unpowered, at 6.5 m', make(false), view);
  cell('lineup', 'lineup-dark', 'Powered, no bulb nearby', make(true), { ...view, dark: true });
}

function forge() {
  const view = { target: [0.2, 1.3, 0.1], dist: 5.4, yaw: 0.28, fov: 55, wall: -0.75 };
  const a = M.buildForge();
  run(a, 0.5);
  cell('forge', 'forge-off', 'Forge: unpowered', [a], view);
  const b = M.buildForge();
  b.userData.setPower(true);
  run(b, 3);
  cell('forge', 'forge-idle', 'Forge: powered, idle', [b], view);
  const c = M.buildForge();
  c.userData.setPower(true);
  let t = run(c, 3);
  c.userData.setState('working');
  run(c, 0.3, t);
  cell('forge', 'forge-in', 'Forge: working, tray going in', [c], view);
  const d = M.buildForge();
  d.userData.setPower(true);
  t = run(d, 3);
  d.userData.setState('working');
  run(d, 1.6, t);
  cell('forge', 'forge-slam', 'Forge: working, the press strikes', [d], view);
  const e = M.buildForge();
  e.userData.setPower(true);
  t = run(e, 3);
  const gun = buildWeaponModel('kar98k');
  const s = Math.min(1, 0.95 / (gun.userData.length || 1));
  gun.scale.setScalar(s);
  gun.rotation.y = Math.PI / 2;
  e.userData.slot.add(gun);
  e.userData.setState('ready');
  run(e, 1.5, t);
  cell('forge', 'forge-ready', 'Forge: ready (gun glowing on the tray)', [e], view);
  cell('forge', 'forge-ready-close', 'Forge: ready, close', [e], { target: [0.62, 1.0, 0.5], dist: 1.9, yaw: 0.2, eye: 1.55, wall: -0.75 });
  const f = M.buildForge();
  f.userData.setPower(true);
  run(f, 3);
  cell('forge', 'forge-game', 'Forge at 7 m (game FOV)', [f], { target: [0, 1.2, 0], dist: 7, yaw: 0.15, fov: 75, wall: -0.75 });
}

function tele() {
  const view = { target: [0, 1.45, -0.2], dist: 5.6, yaw: 0.42, fov: 55, eye: 1.75, wall: -1.9 };
  const a = M.buildTeleCore();
  run(a, 0.5);
  cell('tele', 'core-off', 'Magic Lantern: unpowered', [a], view);
  const b = M.buildTeleCore();
  b.userData.setPower(true);
  b.userData.setLinked(true);
  b.userData.setCharge(0.55);
  run(b, 3);
  cell('tele', 'core-charging', 'Magic Lantern: linked, charging', [b], view);
  const c = M.buildTeleCore();
  c.userData.setPower(true);
  c.userData.setLinked(true);
  c.userData.setCharge(1);
  let t = run(c, 3);
  c.userData.fire();
  run(c, 0.12, t);
  cell('tele', 'core-fire', 'Magic Lantern: firing', [c], view);
  const d = M.buildTeleCore();
  d.userData.setPower(true);
  d.userData.setLinked(true);
  d.userData.setCharge(1);
  d.userData.setCalm(true);
  t = run(d, 3);
  d.userData.fire();
  run(d, 0.5, t);
  cell('tele', 'core-fire-calm', 'Magic Lantern: firing (reduce flashing)', [d], view);
  const e = M.buildTelePad();
  run(e, 0.5);
  const padView = { target: [0.3, 0.55, 0.2], dist: 3.3, yaw: 0.35, fov: 50, wall: -1.2 };
  cell('tele', 'pad-off', 'Pad: unpowered', [e], padView);
  const f = M.buildTelePad();
  f.userData.setPower(true);
  f.userData.setLinked(true);
  f.userData.setCharge(0.7);
  run(f, 3);
  cell('tele', 'pad-linked', 'Pad: linked, charged', [f], padView);
  const g = M.buildTelePad();
  g.userData.setPower(true);
  g.userData.setLinked(true);
  g.userData.setCharge(1);
  t = run(g, 3);
  g.userData.fire();
  run(g, 0.12, t);
  cell('tele', 'pad-fire', 'Pad: firing', [g], padView);
}

function traps() {
  const view = { target: [0, 1.3, 0], dist: 4.4, yaw: 0.35, fov: 55, wall: -0.6 };
  const a = M.buildSparkGate(2, 2.4);
  run(a, 0.3);
  cell('traps', 'gate-off', 'Spark gate (2 m): off', [a], view);
  const b = M.buildSparkGate(2, 2.4);
  b.userData.setActive(true);
  run(b, 0.5);
  cell('traps', 'gate-on', 'Spark gate: active', [b], view);
  const c = M.buildSparkGate(2, 2.4);
  c.userData.setCalm(true);
  c.userData.setActive(true);
  run(c, 0.5);
  cell('traps', 'gate-calm', 'Spark gate: active (reduce flashing)', [c], view);
  const sv = { target: [0, 1.3, 0.1], dist: 1.5, yaw: 0.35, eye: 1.5, wall: 0 };
  for (const s of ['off', 'ready', 'active', 'cooldown']) {
    const m = M.buildTrapSwitch();
    m.userData.setState(s);
    run(m, 0.37);
    cell('traps', 'switch-' + s, 'Trap switch: ' + s, [m], sv);
  }
}

function breaker() {
  const view = { target: [0, 1.55, 0.1], dist: 2.5, yaw: 0.35, eye: 1.6, wall: 0, fov: 55 };
  const a = M.buildBreaker();
  run(a, 0.5);
  cell('breaker', 'breaker-off', 'Breaker: off', [a], view);
  const b = M.buildBreaker();
  let t = run(b, 0.5);
  b.userData.setOn(true);
  run(b, 0.3, t);
  cell('breaker', 'breaker-throw', 'Breaker: throwing', [b], view);
  const c = M.buildBreaker();
  t = run(c, 0.5);
  c.userData.setOn(true);
  run(c, 0.56, t);
  cell('breaker', 'breaker-contact', 'Breaker: contact (sparks)', [c], view);
  const d = M.buildBreaker();
  t = run(d, 0.5);
  d.userData.setOn(true);
  run(d, 2.5, t);
  cell('breaker', 'breaker-on', 'Breaker: on', [d], view);
  cell('breaker', 'breaker-on-close', 'Breaker: on, close', [d], { target: [0, 1.75, 0.1], dist: 1.2, yaw: -0.3, eye: 1.7, wall: 0, fov: 50 });
}

function token() {
  const view = { target: [0, 0.4, 0], dist: 1.35, yaw: 0.2, eye: 0.85, fov: 50, wall: -1 };
  for (const [t, name] of [[0.3, 'token-a'], [1.25, 'token-b']]) {
    const m = M.buildBoxToken();
    m.userData.update(0, t);
    cell('token', name, 'Box token (t = ' + t + ' s)', [m], view);
  }
}

async function icons() {
  const c = document.createElement('canvas');
  c.width = 720; c.height = 250;
  const x = c.getContext('2d');
  x.fillStyle = '#15171a'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = false;
  x.font = '14px monospace';
  let i = 0;
  for (const id of PERK_IDS) {
    for (const [size, y] of [[64, 20], [128, 100]]) {
      const img = new Image();
      img.src = perkIcon(id, size);
      await img.decode();
      x.drawImage(img, 20 + i * 175 + (128 - size) / 2, y);
    }
    x.fillStyle = '#ccc'; x.fillText(PERKS[id].name, 20 + i * 175, 245);
    i++;
  }
  return c.toDataURL('image/png');
}

window.render = async (only) => {
  const all = { perks, lineup, forge, tele, traps, breaker, token };
  for (const [k, fn] of Object.entries(all)) if (!only.length || only.includes(k)) fn();
  const out = [];
  for (const c of CELLS) out.push({ group: c.group, name: c.name, label: c.label, url: frame(c.objs, c.o) });
  const machines = {
    perk: M.buildPerkMachine('ironclad'), forge: M.buildForge(), teleCore: M.buildTeleCore(), telePad: M.buildTelePad(),
    sparkGate: M.buildSparkGate(2, 2.4), trapSwitch: M.buildTrapSwitch(), breaker: M.buildBreaker(), boxToken: M.buildBoxToken(),
  };
  for (const id of PERK_IDS) machines['perk:' + id] = M.buildPerkMachine(id);
  const st = {};
  for (const [k, g] of Object.entries(machines)) st[k] = stats(g);
  // the sheet: every cell at half size with its label
  const cols = 5, cw = 400, ch = 300, lh = 22;
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = Math.ceil(out.length / cols) * (ch + lh);
  const sx = sheet.getContext('2d');
  sx.fillStyle = '#0b0c0e'; sx.fillRect(0, 0, sheet.width, sheet.height);
  sx.font = '13px monospace';
  for (let i = 0; i < out.length; i++) {
    const img = new Image();
    img.src = out[i].url;
    await img.decode();
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + lh);
    sx.drawImage(img, cx, cy + lh, cw, ch);
    sx.fillStyle = '#d8d2c0'; sx.fillText(out[i].label, cx + 6, cy + 15);
  }
  return { cells: out, sheet: sheet.toDataURL('image/png'), icons: await icons(), stats: st, info: renderer.info.render };
};
window.ready = true;
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'machines-sheet-entry.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
});
const html = `<!doctype html><html><head><meta charset="utf-8"><title>machines</title></head>
<body style="margin:0;background:#111"><script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
const htmlPath = path.join(outDir, 'sheet.html');
writeFileSync(htmlPath, html);

const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const res = await page.evaluate((o) => window.render(o), only);
  const png = (url) => Buffer.from(url.split(',')[1], 'base64');
  for (const c of res.cells) writeFileSync(path.join(outDir, `${c.name}.png`), png(c.url));
  writeFileSync(path.join(outDir, 'sheet.png'), png(res.sheet));
  writeFileSync(path.join(outDir, 'icons.png'), png(res.icons));
  writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(res.stats, null, 2));
  console.log(`${res.cells.length} cells -> ${path.relative(root, outDir)}/sheet.png`);
  for (const [k, s] of Object.entries(res.stats)) console.log(`  ${k.padEnd(18)} draws ${String(s.draws).padStart(3)}  tris ${String(s.tris).padStart(5)}  lights ${s.lights}`);
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
