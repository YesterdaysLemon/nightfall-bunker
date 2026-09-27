// Procedural first-person models (weapons, knife, grenade, hands, power-ups)
// in the 1997 look of art/STYLE.md: sharp faceted primitives (6-10 sided
// barrels, receivers with bevelled long edges, hard per-face normals), small
// painted texture pages sampled nearest, and painted light baked into vertex
// colours (top-front key, cool shadows, warm bounce, creases darkened, worn
// bright chamfers on steel). Textures are painted in software from seeded
// noise and quantised onto hue-shifted ramps, so tones sit in flat clusters.
// Built from primitives, then merged per material so each model is a handful
// of draw calls (one per material for static geometry, plus one per material
// inside each animated part).
//
// Weapon conventions (meters): origin = trigger-hand / pistol-grip position,
// barrel toward -Z, +Y up, centred on X = 0.
//   userData.muzzle / sight / leftHand : Object3D anchors (direct children)
//   userData.parts : { mag, bolt, pump, slide, barrels } animated sub-groups
//                    (each carries userData.restPosition / restRotation)
//   userData.length : overall length in meters
// Every material carries userData.chalk (metal/wood/dark/hole/glass/glow/skin/
// cloth): chalk.js traces wall-buy outlines from these classes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../../shared/weapons.js';

const PI = Math.PI;
const HALF = PI / 2;
const TAU = PI * 2;

// ---------------------------------------------------------------------------
// Painted texture pages
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise on a (w/cx) x (h/cy) lattice, smoothly interpolated.
function noise(w, h, cx, cy, r) {
  const gw = Math.max(1, Math.round(w / cx));
  const gh = Math.max(1, Math.round(h / cy));
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const out = new Float32Array(w * h);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * gh;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    const r0 = (y0 % gh) * gw;
    const r1 = ((y0 + 1) % gh) * gw;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      const a = x0 % gw;
      const b = (x0 + 1) % gw;
      const top = grid[r0 + a] + (grid[r0 + b] - grid[r0 + a]) * tx;
      const bot = grid[r1 + a] + (grid[r1 + b] - grid[r1 + a]) * tx;
      out[y * w + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

// World ramps (art/STYLE.md, z_ps1b.py RAMPS): dark to light, cool shadows,
// warm highlights. Metals and wood extend the table in the same value range.
const RAMP = {
  blued: [[14, 15, 18], [21, 23, 27], [30, 32, 37], [40, 43, 49], [52, 55, 61], [66, 69, 74], [85, 87, 90], [110, 109, 108], [140, 136, 128]],
  worn: [[30, 31, 36], [43, 44, 50], [58, 59, 64], [75, 76, 79], [95, 94, 94], [117, 115, 111], [142, 138, 130], [172, 165, 152]],
  walnut: [[24, 14, 11], [36, 21, 15], [50, 30, 20], [66, 40, 26], [84, 52, 33], [102, 66, 42], [122, 82, 54], [146, 104, 72]],
  beech: [[46, 30, 19], [66, 44, 28], [88, 60, 38], [110, 77, 49], [132, 96, 62], [154, 117, 79], [176, 140, 100]],
  birch: [[38, 18, 12], [58, 29, 17], [80, 42, 24], [104, 57, 32], [128, 75, 43], [150, 96, 58], [172, 120, 78]],
  bakelite: [[12, 8, 7], [20, 13, 11], [29, 19, 15], [40, 27, 21], [53, 36, 28], [68, 47, 36], [88, 64, 50]],
  olive: [[26, 28, 22], [36, 39, 28], [47, 51, 35], [59, 63, 43], [72, 76, 52], [88, 91, 63], [108, 110, 80]],
  brass: [[46, 36, 22], [70, 55, 32], [96, 76, 42], [122, 98, 54], [148, 122, 70], [174, 147, 90], [198, 172, 116], [222, 202, 156]],
  copper: [[46, 18, 11], [72, 30, 16], [102, 45, 23], [130, 63, 32], [158, 85, 46], [184, 112, 66], [206, 140, 92]],
  skin: [[62, 42, 36], [88, 60, 48], [114, 81, 63], [140, 103, 80], [164, 125, 98], [186, 148, 118], [206, 172, 142]],
  grime: [[36, 30, 26], [52, 44, 36], [70, 60, 48], [92, 80, 63]],
  wool: [[30, 32, 28], [40, 44, 34], [52, 56, 40], [64, 68, 48], [76, 80, 55], [90, 94, 64], [108, 112, 78], [134, 136, 96]],
  webbing: [[36, 40, 35], [50, 55, 43], [65, 71, 54], [82, 88, 66], [102, 107, 80], [126, 128, 98]],
  pgreen: [[64, 84, 16], [96, 124, 28], [132, 162, 46], [168, 196, 70], [200, 222, 104], [228, 240, 150]],
  pgold: [[92, 60, 10], [134, 94, 22], [176, 132, 36], [210, 168, 62], [234, 202, 104], [250, 230, 156]],
};

// fn(i, x, y) -> [ramp, value 0..1]; values snap to the ramp's entries.
function paintPage(w, h, fn) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [ramp, v] = fn(i, x, y);
      const c = ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Short straight marks (scratches, stitches) into a wrap-around mask.
function marks(W, H, r, count, minLen, maxLen, slope = 0) {
  const m = new Uint8Array(W * H);
  for (let k = 0; k < count; k++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * H);
    const len = minLen + Math.floor(r() * (maxLen - minLen));
    const s = slope && r() < 0.4 ? slope : 0;
    for (let j = 0; j < len; j++) m[((y + Math.floor(j * s)) % H) * W + ((x + j) % W)] = 1;
  }
  return m;
}

function paintSteel(ramp, seed, base, wear) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const brush = noise(W, H, 64, 1, r); // one value per row: long brushed lines
  const n6 = noise(W, H, 6, 4, r);
  const pit = noise(W, H, 3, 3, r);
  const scr = marks(W, H, r, 6, 5, 14, 0.25);
  return paintPage(W, H, (i) => {
    let v = base + 0.07 * (n16[i] - 0.5) + 0.14 * (brush[i] - 0.5);
    if (n6[i] > 1 - wear) v += 0.1; // rubbed-bright streaks
    if (pit[i] < 0.08) v -= 0.14; // pitting and dirt
    if (scr[i]) v += 0.24;
    return [ramp, v];
  });
}

function paintWood(ramp, seed) {
  const W = 128;
  const H = 64;
  const r = mulberry32(seed);
  const warp = noise(W, H, 64, 10, r);
  const tone = noise(W, H, 32, 16, r);
  const fig = noise(W, H, 16, 4, r);
  const wear = noise(W, H, 16, 16, r);
  const spacing = H / 11;
  const kx = r() * W;
  const ky = r() * H;
  return paintPage(W, H, (i, x, y) => {
    let dx = x - kx;
    dx -= Math.round(dx / W) * W;
    let dy = y - ky;
    dy -= Math.round(dy / H) * H;
    const kd = Math.hypot(dx * 0.45, dy);
    const yy = y + warp[i] * 10 + (kd < 7 ? (7 - kd) * Math.sign(dy || 1) * 0.7 : 0);
    const g = (((yy / spacing) % 1) + 1) % 1;
    let v = 0.46 + 0.16 * (tone[i] - 0.5) + 0.08 * (fig[i] - 0.5);
    if (g < 0.2) v -= 0.16; // dark late-wood line
    else if (g > 0.55 && g < 0.72) v += 0.06;
    if (wear[i] > 0.82) v += 0.09; // hand-polished
    if (kd < 2.2) v -= 0.25; // knot
    return [ramp, v];
  });
}

function paintBakelite(seed) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n8 = noise(W, H, 8, 8, r);
  const n4 = noise(W, H, 4, 6, r);
  const n16 = noise(W, H, 16, 16, r);
  return paintPage(W, H, (i) => {
    let v = 0.42 + 0.14 * (n8[i] - 0.5) + 0.1 * (n4[i] - 0.5);
    if (n16[i] > 0.8) v += 0.12;
    return [RAMP.bakelite, v];
  });
}

function paintOlive(seed) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const brush = noise(W, H, 16, 2, r);
  const chip = noise(W, H, 3, 3, r);
  const scr = marks(W, H, r, 4, 3, 8, 0.5);
  return paintPage(W, H, (i) => {
    if (chip[i] > 0.9 || scr[i]) return [RAMP.blued, 0.4]; // chipped to bare steel
    let v = 0.52 + 0.08 * (n16[i] - 0.5) + 0.08 * (brush[i] - 0.5);
    if (chip[i] > 0.84) v += 0.15; // raised paint lip around a chip
    return [RAMP.olive, v];
  });
}

function paintBrass(ramp, seed) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const streak = noise(W, H, 32, 4, r);
  const n8 = noise(W, H, 8, 8, r);
  const n6 = noise(W, H, 6, 6, r);
  return paintPage(W, H, (i) => {
    let v = 0.56 + 0.1 * (n16[i] - 0.5) + 0.1 * (streak[i] - 0.5);
    if (n8[i] > 0.74) v -= 0.15; // tarnish
    if (n6[i] < 0.12) v += 0.2; // polished glint
    return [ramp, v];
  });
}

function paintSkin(seed, grime) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const n8 = noise(W, H, 8, 8, r);
  const n4 = noise(W, H, 4, 4, r);
  const crease = marks(W, H, r, 6, 3, 7, 0.34);
  return paintPage(W, H, (i) => {
    const gr = 0.6 * n8[i] + 0.4 * n16[i];
    if (gr > 1 - grime) return [RAMP.grime, 0.3 + 0.5 * n4[i]];
    let v = 0.54 + 0.16 * (n16[i] - 0.5) + 0.08 * (n4[i] - 0.5);
    if (crease[i]) v -= 0.2;
    return [RAMP.skin, v];
  });
}

function paintCloth(ramp, seed, stitch) {
  const W = 64;
  const H = 64;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const warp = noise(W, H, 32, 16, r);
  const mud = noise(W, H, 8, 8, r);
  return paintPage(W, H, (i, x, y) => {
    let v = 0.5 + 0.16 * (n16[i] - 0.5);
    if (((x + y) >> 1) % 3 === 0) v -= 0.07; // twill
    const f = Math.sin(((y + warp[i] * 12) / H) * TAU * 2);
    if (f > 0.86) v += 0.14; // fold crest
    else if (f < -0.8) v -= 0.16; // fold crease
    if (stitch && y % 16 === 3 && x % 4 < 2) v += 0.3;
    if (mud[i] > 0.8) return [RAMP.grime, 0.45 + 0.3 * n16[i]];
    return [ramp, v];
  });
}

function paintGlow(ramp, seed) {
  const W = 32;
  const H = 32;
  const r = mulberry32(seed);
  const n16 = noise(W, H, 16, 16, r);
  const n6 = noise(W, H, 6, 6, r);
  const n8 = noise(W, H, 8, 8, r);
  return paintPage(W, H, (i) => {
    let v = 0.6 + 0.2 * (n16[i] - 0.5) + 0.1 * (n6[i] - 0.5);
    if (n8[i] > 0.78) v += 0.22;
    return [ramp, v];
  });
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

let MATS = null;
let TEX = null;

// Per-material painted-light recipe: light = strength of the baked key/shadow
// ramp, edge = brightening of bevelled chamfers (worn edges), ao = crease
// darkening, texel = metres per texel (1997 density: ~1-2 screen px at hip).
const P_STEEL = { light: 0.9, edge: 0.85, ao: 0.38, texel: 0.0025 };
const P_WORN = { light: 0.85, edge: 0.6, ao: 0.34, texel: 0.0025 };
const P_WOOD = { light: 0.8, edge: 0.18, ao: 0.34, texel: 0.0021 };
const P_DARK = { light: 0.85, edge: 0.5, ao: 0.3, texel: 0.0025 };
const P_BRASS = { light: 0.7, edge: 0.4, ao: 0.3, texel: 0.0022 };
const P_SKIN = { light: 0.55, edge: 0, ao: 0.12, texel: 0.0018 };
const P_CLOTH = { light: 0.65, edge: 0, ao: 0.2, texel: 0.0026 };
const P_GLOW = { light: 0.5, edge: 0.3, ao: 0.15, texel: 0.012 };

function textures() {
  if (TEX) return TEX;
  TEX = {
    blued: paintSteel(RAMP.blued, 11, 0.42, 0.12),
    worn: paintSteel(RAMP.worn, 23, 0.46, 0.14),
    walnut: paintWood(RAMP.walnut, 37),
    beech: paintWood(RAMP.beech, 41),
    birch: paintWood(RAMP.birch, 43),
    bakelite: paintBakelite(53),
    olive: paintOlive(61),
    brass: paintBrass(RAMP.brass, 71),
    copper: paintBrass(RAMP.copper, 73),
    skin: paintSkin(83, 0.2),
    grimy: paintSkin(89, 0.52),
    wool: paintCloth(RAMP.wool, 97, false),
    cuff: paintCloth(RAMP.webbing, 101, true),
    pgreen: paintGlow(RAMP.pgreen, 107),
    pgold: paintGlow(RAMP.pgold, 109),
  };
  return TEX;
}

function mats() {
  if (MATS) return MATS;
  const T = textures();
  const make = (Cls, name, chalk, paint, params) => {
    const m = new Cls(params);
    m.name = name;
    m.userData.chalk = chalk;
    m.userData.paint = paint;
    return m;
  };
  // Metals: Phong with a low, broad specular so facets glint as the gun sways.
  const metal = (name, chalk, map, paint, specular, shininess, extra = {}) => make(THREE.MeshPhongMaterial, name, chalk, paint, {
    map, vertexColors: true, flatShading: true, specular, shininess, ...extra,
  });
  const matte = (name, chalk, map, paint, extra = {}) => make(THREE.MeshLambertMaterial, name, chalk, paint, {
    map, vertexColors: true, flatShading: true, ...extra,
  });
  const basic = (name, chalk, params) => make(THREE.MeshBasicMaterial, name, chalk, null, params);
  MATS = {
    steel: metal('bluedSteel', 'metal', T.blued, P_STEEL, 0x383c44, 14),
    worn: metal('wornSteel', 'metal', T.worn, P_WORN, 0x454545, 18),
    wood: matte('walnut', 'wood', T.walnut, P_WOOD),
    woodLight: matte('lightWood', 'wood', T.beech, P_WOOD),
    woodRed: matte('birchStock', 'wood', T.birch, P_WOOD),
    bakelite: metal('bakelite', 'dark', T.bakelite, P_DARK, 0x201a16, 22),
    olive: matte('olivePaint', 'metal', T.olive, P_WORN),
    oliveDS: matte('olivePaintDS', 'metal', T.olive, P_WORN, { side: THREE.DoubleSide }),
    brass: metal('brass', 'metal', T.brass, P_BRASS, 0x5a4420, 16),
    copper: metal('copper', 'metal', T.copper, P_BRASS, 0x4a2a1c, 14),
    black: basic('blackHole', 'hole', { color: 0x060606 }),
    glass: make(THREE.MeshPhongMaterial, 'glass', 'glass', null, {
      color: 0xa8fff0, transparent: true, opacity: 0.32, emissive: 0x1f7a66, emissiveIntensity: 0.7, depthWrite: false,
      specular: 0x2a4a44, shininess: 60, flatShading: true,
    }),
    glow: basic('glow', 'glow', { color: 0x74ffd8 }),
    glowSoft: basic('glowSoft', 'glow', {
      color: 0x3de8b8, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    // hands
    skin: matte('handSkin', 'skin', T.skin, P_SKIN),
    grime: matte('handGrime', 'skin', T.grimy, P_SKIN),
    sleeve: matte('sleeveOD', 'cloth', T.wool, P_CLOTH),
    cuff: matte('sleeveCuff', 'cloth', T.cuff, P_CLOTH),
    // power-ups: painted, lit, and glowing through their own page
    pBody: matte('powerBody', 'glow', T.pgreen, P_GLOW, { emissive: 0x8fb02a, emissiveIntensity: 0.75, emissiveMap: T.pgreen }),
    pGold: matte('powerGold', 'glow', T.pgold, P_GLOW, { emissive: 0xc09a30, emissiveIntensity: 0.75, emissiveMap: T.pgold }),
    pBright: basic('powerBright', 'glow', { color: 0xeeffa0 }),
    pDark: basic('powerDark', 'dark', { color: 0x141b08 }),
  };
  return MATS;
}

// ---------------------------------------------------------------------------
// Cached primitive geometry (faceted: few sides, a flat on top of every barrel)
// ---------------------------------------------------------------------------

const GEO = new Map();
function cached(key, make) {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    GEO.set(key, g);
  }
  return g;
}

const sidesFor = (r, seg) => Math.max(3, Math.min(seg, r >= 0.04 ? 10 : r >= 0.014 ? 8 : 6));

/**
 * Box with its four long edges bevelled (an octagonal prism along the longest
 * axis). Chamfer faces carry an `edge` attribute so they bake as worn edges.
 */
function chamferBox(w, h, d, c) {
  const dims = [w, h, d];
  let L = 0;
  if (dims[1] > dims[L]) L = 1;
  if (dims[2] > dims[L]) L = 2;
  const A = (L + 1) % 3;
  const Bx = (L + 2) % 3;
  const ha = dims[A] / 2;
  const hb = dims[Bx] / 2;
  const hl = dims[L] / 2;
  const oct = [[ha, hb - c], [ha - c, hb], [-ha + c, hb], [-ha, hb - c], [-ha, -hb + c], [-ha + c, -hb], [ha - c, -hb], [ha, -hb + c]];
  const P = (ab, l) => {
    const v = [0, 0, 0];
    v[A] = ab[0];
    v[Bx] = ab[1];
    v[L] = l;
    return v;
  };
  const pos = [];
  const edge = [];
  const tri = (p, q, s, e) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [s[0] - p[0], s[1] - p[1], s[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = n[0] * (p[0] + q[0] + s[0]) + n[1] * (p[1] + q[1] + s[1]) + n[2] * (p[2] + q[2] + s[2]);
    if (out < 0) pos.push(...p, ...s, ...q);
    else pos.push(...p, ...q, ...s);
    edge.push(e, e, e);
  };
  for (let i = 0; i < 8; i++) {
    const a = oct[i];
    const b = oct[(i + 1) % 8];
    const e = i % 2 === 0 ? 1 : 0;
    tri(P(a, -hl), P(b, -hl), P(b, hl), e);
    tri(P(a, -hl), P(b, hl), P(a, hl), e);
  }
  for (const l of [-hl, hl]) for (let i = 1; i < 7; i++) tri(P(oct[0], l), P(oct[i], l), P(oct[i + 1], l), 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

const G = {
  box: (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cbox: (w, h, d, c) => cached(`cb${w},${h},${d},${c}`, () => chamferBox(w, h, d, c)),
  cyl: (rt, rb, h, seg = 10, open = false) => {
    const n = sidesFor(Math.max(rt, rb), seg);
    return cached(`c${rt},${rb},${h},${n},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, n, 1, open, PI / n));
  },
  tor: (R, r, arc = TAU, rs = 6, ts = 12) => {
    const a = Math.min(rs, 5);
    const b = Math.min(ts, arc >= TAU - 1e-6 ? 10 : 6);
    return cached(`t${R},${r},${arc},${a},${b}`, () => new THREE.TorusGeometry(R, r, a, b, arc));
  },
  sph: (r, ws = 10, hs = 8) => {
    const a = Math.min(ws, r < 0.012 ? 6 : 8);
    const b = Math.min(hs, r < 0.012 ? 4 : 6);
    return cached(`s${r},${a},${b}`, () => new THREE.SphereGeometry(r, a, b));
  },
  // flat hexagonal disc facing +Y (perforations, gauge faces)
  hex: (r) => cached(`h${r}`, () => new THREE.CircleGeometry(r, 6).rotateX(-HALF)),
};

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  return s;
}

class HelixCurve extends THREE.Curve {
  constructor(radius, turns, z0, z1) {
    super();
    this.radius = radius;
    this.turns = turns;
    this.z0 = z0;
    this.z1 = z1;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * this.turns * TAU;
    return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, this.z0 + (this.z1 - this.z0) * t);
  }
}

// Point on a grip raked by `rake` (rotation.x = -rake) at local (0, t, dz).
function along(cx, cy, cz, rake, t, dz = 0) {
  const c = Math.cos(rake);
  const s = Math.sin(rake);
  return [cx, cy + t * c + dz * s, cz - t * s + dz * c];
}

// ---------------------------------------------------------------------------
// Builder: collects transformed primitives per part, then bakes/merges them
// ---------------------------------------------------------------------------

const _up = new THREE.Vector3(0, 1, 0);

class Builder {
  constructor() {
    this.parts = new Map();
    this.parts.set('static', { pos: new THREE.Vector3(), rot: new THREE.Euler(), items: [], userData: {} });
    this.cur = this.parts.get('static');
    this.anchors = {};
    this.xf = null;
  }

  part(name, pos = [0, 0, 0], rot = [0, 0, 0], order = 'XYZ') {
    const p = { pos: new THREE.Vector3(...pos), rot: new THREE.Euler(rot[0], rot[1], rot[2], order), items: [], userData: {} };
    this.parts.set(name, p);
    this.cur = p;
    return this;
  }

  sel(name = 'static') {
    this.cur = this.parts.get(name);
    return this;
  }

  addMatrix(geom, mat, m) {
    if (this.xf) m.premultiply(this.xf);
    this.cur.items.push({ geom, mat, m });
    return this;
  }

  add(geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    return this.addMatrix(geom, mat, m);
  }

  /** Box; chunky boxes get their long edges bevelled (worn chamfers). */
  bx(mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const s = [w, h, d].sort((a, b) => a - b);
    const geo = mat.userData.paint && s[0] >= 0.009 && s[1] >= 0.014
      ? G.cbox(w, h, d, Math.min(0.0055, s[0] * 0.22))
      : G.box(w, h, d);
    return this.add(geo, mat, x, y, z, rx, ry, rz);
  }

  /** Cylinder along Z from zF (front, more negative) to zB; sx/sy squash the section. */
  tz(mat, rF, rB, zF, zB, x = 0, y = 0, seg = 10, open = false, sx = 1, sy = 1) {
    return this.add(G.cyl(rF, rB, zB - zF, seg, open), mat, x, y, (zF + zB) / 2, -HALF, 0, 0, sx, 1, sy);
  }

  /** Cylinder along X; sy/sz scale the section (oval holes etc.). */
  tx(mat, r, len, x, y, z, seg = 10, sy = 1, sz = 1) {
    return this.add(G.cyl(r, r, len, seg), mat, x, y, z, 0, 0, HALF, sy, 1, sz);
  }

  /** Generic Y-axis cylinder. */
  cy(mat, rT, rB, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) {
    return this.add(G.cyl(rT, rB, h, seg), mat, x, y, z, rx, ry, rz);
  }

  tor(mat, R, r, arc, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, rs = 6, ts = 12) {
    return this.add(G.tor(R, r, arc, rs, ts), mat, x, y, z, rx, ry, rz);
  }

  sp(mat, r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8) {
    return this.add(G.sph(r, ws, hs), mat, x, y, z, 0, 0, 0, sx, sy, sz);
  }

  /** Rod (cylinder) between two points. */
  rod(mat, r, a, b, seg = 8) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.addMatrix(G.cyl(r, r, len, seg), mat, m);
  }

  /**
   * Side profile extruded across X. Shape coordinates are (u, v) with
   * u = -z (forward positive) and v = y. Centred on x. The single-step bevel
   * gives the profile hard chamfered edges.
   */
  ext(mat, shape, depth, x = 0, bevel = 0.003, curveSegments = 3) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments,
    });
    const m = new THREE.Matrix4().makeRotationY(HALF);
    m.premultiply(new THREE.Matrix4().makeTranslation(x - depth / 2, 0, 0));
    return this.addMatrix(geo, mat, m);
  }

  anchor(name, x, y, z) {
    this.anchors[name] = new THREE.Vector3(x, y, z);
    return this;
  }
}

function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const n = a.itemSize;
    const arr = a.array;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (i + 1) * n + k;
        const i2 = (i + 2) * n + k;
        const t = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = t;
      }
    }
    a.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Baking: planar UVs at a fixed texel density + painted light in vertex colours
// ---------------------------------------------------------------------------

// Key from above and slightly in front, leaning to the side the player sees.
const KEY = new THREE.Vector3(-0.3, 1, -0.25).normalize();
// Hue-shifted light ramp: cool shadow -> neutral -> warm highlight.
const LIGHT_STOPS = [
  [0.0, 0.42, 0.45, 0.55],
  [0.42, 0.74, 0.75, 0.79],
  [0.72, 1.0, 0.98, 0.95],
  [1.0, 1.2, 1.12, 1.0],
];

function lightColor(n, paint, out) {
  const t = 0.5 + 0.5 * n.dot(KEY);
  let i = 1;
  while (i < LIGHT_STOPS.length - 1 && t > LIGHT_STOPS[i][0]) i++;
  const a = LIGHT_STOPS[i - 1];
  const b = LIGHT_STOPS[i];
  const u = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
  let r = a[1] + (b[1] - a[1]) * u;
  let g = a[2] + (b[2] - a[2]) * u;
  let bl = a[3] + (b[3] - a[3]) * u;
  if (n.y < 0) { // faint warm bounce from below
    r += 0.1 * -n.y;
    g += 0.06 * -n.y;
    bl += 0.03 * -n.y;
  }
  const s = paint.light;
  out[0] = 0.9 + (r - 0.9) * s;
  out[1] = 0.9 + (g - 0.9) * s;
  out[2] = 0.9 + (bl - 0.9) * s;
  return out;
}

const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _box = new THREE.Box3();
const _lc = [0, 0, 0];

function bake(items, seed = 1) {
  const rnd = mulberry32(seed);
  // Part-space boxes of solid primitives: a vertex nudged outward that lands
  // inside another primitive sits in a crease and gets occlusion painted in.
  const occ = items.map(({ geom, mat, m }) => {
    if (!mat.userData.paint || mat.transparent) return null;
    if (!geom.boundingBox) geom.computeBoundingBox();
    return geom.boundingBox.clone().applyMatrix4(m);
  });
  const byMat = new Map();
  items.forEach(({ geom, mat, m }, k) => {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'edge') g.deleteAttribute(name);
    g.morphAttributes = {};
    g.clearGroups();
    const pos = g.attributes.position;
    const n = pos.count;
    const paint = mat.userData.paint;
    const uv = new Float32Array(n * 2);
    const ou = rnd();
    const ov = rnd();
    const tint = 1 + (rnd() - 0.5) * 0.1;
    if (paint && mat.map) {
      // Primitive-local metric frame; the longest extent carries the grain (u).
      m.decompose(_t, _q, _s);
      const sc = [_s.x, _s.y, _s.z];
      const lp = new Float32Array(n * 3);
      _box.makeEmpty();
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) lp[i * 3 + a] = pos.array[i * 3 + a] * sc[a];
        _box.expandByPoint(_p.fromArray(lp, i * 3));
      }
      const ext = [_box.max.x - _box.min.x, _box.max.y - _box.min.y, _box.max.z - _box.min.z];
      const ax = [0, 1, 2].sort((i, j) => ext[j] - ext[i]);
      const img = mat.map.image;
      const su = 1 / (img.width * paint.texel);
      const sv = 1 / (img.height * paint.texel);
      for (let f = 0; f < n; f += 3) {
        const o = f * 3;
        const ux = lp[o + 3] - lp[o];
        const uy = lp[o + 4] - lp[o + 1];
        const uz = lp[o + 5] - lp[o + 2];
        const vx = lp[o + 6] - lp[o];
        const vy = lp[o + 7] - lp[o + 1];
        const vz = lp[o + 8] - lp[o + 2];
        const nn = [Math.abs(uy * vz - uz * vy), Math.abs(uz * vx - ux * vz), Math.abs(ux * vy - uy * vx)];
        const dom = nn[0] >= nn[1] && nn[0] >= nn[2] ? 0 : nn[1] >= nn[2] ? 1 : 2;
        let uA;
        let vA;
        if (dom === ax[0]) { uA = ax[1]; vA = ax[2]; } else { uA = ax[0]; vA = dom === ax[1] ? ax[2] : ax[1]; }
        for (let j = 0; j < 3; j++) {
          uv[(f + j) * 2] = lp[o + j * 3 + uA] * su + ou;
          uv[(f + j) * 2 + 1] = lp[o + j * 3 + vA] * sv + ov;
        }
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    g.computeVertexNormals(); // non-indexed: one hard normal per triangle
    const col = new Float32Array(n * 3).fill(1);
    if (paint) {
      const nrm = g.attributes.normal;
      const edge = g.attributes.edge;
      for (let f = 0; f < n; f += 3) {
        _n.fromBufferAttribute(nrm, f);
        lightColor(_n, paint, _lc);
        const e = edge ? edge.getX(f) * paint.edge : 0;
        const r0 = _lc[0] * (1 + e) * tint;
        const g0 = _lc[1] * (1 + e * 0.9) * tint;
        const b0 = _lc[2] * (1 + e * 0.75) * tint;
        for (let j = 0; j < 3; j++) {
          _p.fromBufferAttribute(g.attributes.position, f + j).addScaledVector(_n, 0.005);
          let ao = 1;
          if (paint.ao) {
            for (let o = 0; o < occ.length; o++) {
              if (o !== k && occ[o] && occ[o].containsPoint(_p)) { ao = 1 - paint.ao; break; }
            }
          }
          const i3 = (f + j) * 3;
          col[i3] = r0 * ao;
          col[i3 + 1] = g0 * ao;
          col[i3 + 2] = b0 * (ao + (1 - ao) * 0.3); // occlusion stays cool
        }
      }
    }
    if (g.attributes.edge) g.deleteAttribute('edge');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  });
  const out = [];
  for (const [material, list] of byMat) {
    const geometry = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) list.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    out.push({ geometry, material });
  }
  return out;
}

function finalize(B, id, length) {
  const parts = [];
  let seed = 7;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (const [name, p] of B.parts) {
    parts.push({ name, pos: p.pos.clone(), rot: p.rot.clone(), meshes: bake(p.items, seed++), userData: { ...p.userData } });
  }
  return { id, parts, anchors: { ...B.anchors }, length };
}

function instantiate(bp) {
  const group = new THREE.Group();
  group.name = bp.id;
  const parts = {};
  let drawCalls = 0;
  for (const part of bp.parts) {
    let target = group;
    if (part.name !== 'static') {
      const pg = new THREE.Group();
      pg.name = part.name;
      pg.position.copy(part.pos);
      pg.rotation.copy(part.rot);
      pg.userData = {
        restPosition: part.pos.toArray(),
        restRotation: [part.rot.x, part.rot.y, part.rot.z],
        restRotationOrder: part.rot.order,
        ...part.userData,
      };
      group.add(pg);
      parts[part.name] = pg;
      target = pg;
    }
    for (const { geometry, material } of part.meshes) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${bp.id}:${part.name}:${material.name}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      target.add(mesh);
      drawCalls++;
    }
  }
  const ud = { id: bp.id, length: bp.length, parts, drawCalls };
  for (const [name, v] of Object.entries(bp.anchors)) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(v);
    group.add(o);
    ud[name] = o;
  }
  group.userData = ud;
  return group;
}

// ---------------------------------------------------------------------------
// Shared sub-assemblies
// ---------------------------------------------------------------------------

/** U-shaped trigger guard hanging below (y, z) plus a trigger blade. */
function triggerGuard(B, mat, y, z, R = 0.016, trigMat = mat) {
  B.tor(mat, R, 0.0026, PI, 0, y, z, 0, HALF, PI, 4, 6);
  B.bx(trigMat, 0.005, R * 0.95, 0.004, 0, y - R * 0.45, z + R * 0.12, 0.3);
}

/** Row(s) of dark holes on a Z-axis cylinder surface. angles: 0 = top, +x side positive. */
function perforate(B, r, y, z0, z1, n, angles, holeR, stretch = 1.6, x = 0) {
  const M = mats();
  const g = G.hex(holeR);
  for (const th of angles) {
    for (let i = 0; i < n; i++) {
      const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
      B.add(g, M.black, x + (r + 0.0008) * Math.sin(th), y + (r + 0.0008) * Math.cos(th), z, 0, 0, -th, 1, 1, stretch);
    }
  }
}

function frontPost(B, z, yBase, yTop, hoodR = 0) {
  const M = mats();
  B.bx(M.steel, 0.0026, yTop - yBase, 0.003, 0, (yBase + yTop) / 2, z);
  if (hoodR) B.tor(M.steel, hoodR, 0.0018, PI, 0, yBase, z, 0, 0, 0, 4, 6);
}

function buttPlate(B, mat, h, y, z, w = 0.044) {
  B.bx(mat, w, h, 0.007, 0, y, z);
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function m1911(B, M) {
  const rake = 0.22;
  // frame
  B.bx(M.steel, 0.024, 0.02, 0.15, 0, 0.032, -0.083);
  B.bx(M.steel, 0.024, 0.02, 0.052, 0, 0.034, 0.012);
  B.bx(M.steel, 0.02, 0.008, 0.022, 0, 0.034, 0.045, -0.3);
  B.bx(M.steel, 0.002, 0.006, 0.03, -0.0125, 0.036, -0.04);
  // hammer
  B.bx(M.steel, 0.007, 0.014, 0.007, 0, 0.062, 0.044, -0.45);
  B.sp(M.steel, 0.0045, 0, 0.068, 0.049, 1, 1, 1, 8, 6);
  // grip & panels
  B.bx(M.steel, 0.024, 0.105, 0.034, 0, -0.022, 0.017, -rake);
  B.bx(M.wood, 0.029, 0.082, 0.028, 0, -0.019, 0.016, -rake);
  triggerGuard(B, M.steel, 0.024, -0.03, 0.016, M.worn);
  // barrel visible through the bushing
  B.tz(M.worn, 0.0058, 0.0058, -0.172, -0.12, 0, 0.052, 10);
  B.tz(M.black, 0.0036, 0.0036, -0.1728, -0.168, 0, 0.052, 8);
  // slide
  B.part('slide', [0, 0.056, 0]);
  B.bx(M.steel, 0.025, 0.028, 0.205, 0, 0, -0.063);
  B.bx(M.steel, 0.019, 0.006, 0.2, 0, 0.016, -0.063);
  for (let i = 0; i < 7; i++) B.bx(M.steel, 0.0262, 0.02, 0.0015, 0, 0.001, 0.014 + i * 0.0036);
  B.bx(M.steel, 0.0035, 0.008, 0.006, 0, 0.022, -0.155);
  B.bx(M.steel, 0.006, 0.008, 0.007, -0.0065, 0.022, 0.03);
  B.bx(M.steel, 0.006, 0.008, 0.007, 0.0065, 0.022, 0.03);
  B.tz(M.steel, 0.0088, 0.0088, -0.171, -0.163, 0, -0.004, 10);
  // magazine (drops along the raked grip axis)
  B.part('mag', along(0, -0.022, 0.017, rake, -0.0525), [-rake, 0, 0]);
  B.bx(M.worn, 0.02, 0.09, 0.03, 0, 0.042, 0);
  B.bx(M.worn, 0.025, 0.006, 0.036, 0, -0.001, 0.001);
  B.sel();
  B.anchor('muzzle', 0, 0.052, -0.174);
  B.anchor('sight', 0, 0.081, 0.03);
  B.anchor('leftHand', 0, -0.05, 0.035);
  return 0.22;
}

function kar98k(B, M) {
  B.ext(M.wood, shapeFrom([
    [0.8, 0.04], [0.26, 0.04], [0.03, 0.03], [-0.03, 0.022], [-0.1, 0.028], [-0.25, 0.036],
    [-0.258, 0.03], [-0.262, -0.03], [-0.256, -0.098], [-0.22, -0.096], [-0.05, -0.034],
    [0.02, -0.027], [0.14, -0.016], [0.45, 0.004], [0.78, 0.018], [0.805, 0.03],
  ]), 0.04);
  buttPlate(B, M.steel, 0.13, -0.031, 0.264);
  // receiver & barrel
  B.tz(M.steel, 0.0155, 0.0155, -0.235, 0.012, 0, 0.047, 12);
  B.tz(M.steel, 0.0172, 0.0172, -0.245, -0.2, 0, 0.047, 12);
  B.tz(M.steel, 0.0082, 0.0115, -0.862, -0.245, 0, 0.046, 10);
  B.tz(M.black, 0.0045, 0.0045, -0.8628, -0.858, 0, 0.046, 8);
  // upper handguard, bands, nose cap, cleaning rod, lug
  B.tz(M.wood, 0.0125, 0.0138, -0.62, -0.31, 0, 0.049, 8);
  B.bx(M.steel, 0.046, 0.042, 0.012, 0, 0.034, -0.56);
  B.bx(M.steel, 0.042, 0.036, 0.022, 0, 0.036, -0.785);
  B.tz(M.worn, 0.003, 0.003, -0.874, -0.6, 0, 0.024, 6);
  B.bx(M.steel, 0.008, 0.01, 0.03, 0, 0.016, -0.8);
  // sights
  B.tz(M.steel, 0.012, 0.012, -0.852, -0.835, 0, 0.047, 10);
  frontPost(B, -0.845, 0.057, 0.073, 0.012);
  B.bx(M.steel, 0.022, 0.01, 0.075, 0, 0.058, -0.29);
  B.bx(M.steel, 0.02, 0.006, 0.014, 0, 0.066, -0.262);
  B.bx(M.steel, 0.006, 0.006, 0.006, -0.0065, 0.072, -0.262);
  B.bx(M.steel, 0.006, 0.006, 0.006, 0.0065, 0.072, -0.262);
  triggerGuard(B, M.steel, -0.022, -0.036, 0.018, M.worn);
  // floorplate
  B.part('mag', [0, -0.02, -0.1]);
  B.bx(M.steel, 0.03, 0.006, 0.085, 0, 0, 0);
  // bolt: sleeve, cocking piece, safety and turned-down handle
  B.part('bolt', [0, 0.047, 0.012]);
  B.tz(M.worn, 0.0112, 0.0112, -0.012, 0.03, 0, 0, 10);
  B.tz(M.worn, 0.0075, 0.009, 0.03, 0.047, 0, 0, 8);
  B.bx(M.worn, 0.002, 0.014, 0.01, 0, 0.012, 0.022);
  B.rod(M.worn, 0.0036, [0.008, 0, -0.012], [0.05, -0.027, -0.004]);
  B.sp(M.worn, 0.0095, 0.054, -0.031, -0.002, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.046, -0.864);
  B.anchor('sight', 0, 0.073, -0.262);
  B.anchor('leftHand', 0, 0.012, -0.4);
  return 1.13;
}

function m1carbine(B, M) {
  B.ext(M.woodLight, shapeFrom([
    [0.36, 0.034], [0.1, 0.034], [0.02, 0.028], [-0.03, 0.02], [-0.1, 0.026], [-0.3, 0.034],
    [-0.306, 0.028], [-0.31, -0.03], [-0.305, -0.098], [-0.27, -0.098], [-0.06, -0.032],
    [0.0, -0.026], [0.16, -0.014], [0.34, 0.008], [0.365, 0.02],
  ]), 0.04);
  buttPlate(B, M.steel, 0.128, -0.032, 0.311);
  B.bx(M.steel, 0.03, 0.028, 0.16, 0, 0.044, -0.03);
  B.tz(M.steel, 0.0145, 0.0145, 0.0, 0.052, 0, 0.046, 10);
  B.bx(M.black, 0.002, 0.012, 0.04, 0.0152, 0.048, -0.05);
  // rear aperture
  B.bx(M.steel, 0.016, 0.014, 0.012, 0, 0.064, 0.04);
  B.tor(M.steel, 0.0045, 0.0016, TAU, 0, 0.0745, 0.04, 0, 0, 0, 4, 10);
  // handguard, barrel, band, front sight
  B.bx(M.woodLight, 0.03, 0.016, 0.23, 0, 0.053, -0.225);
  B.tz(M.steel, 0.0085, 0.0095, -0.605, -0.11, 0, 0.042, 10);
  B.tz(M.black, 0.0045, 0.0045, -0.6058, -0.6, 0, 0.042, 8);
  B.bx(M.steel, 0.038, 0.04, 0.02, 0, 0.038, -0.35);
  B.tz(M.steel, 0.011, 0.011, -0.6, -0.585, 0, 0.042, 10);
  frontPost(B, -0.593, 0.05, 0.073);
  B.bx(M.steel, 0.002, 0.022, 0.008, -0.0068, 0.062, -0.593);
  B.bx(M.steel, 0.002, 0.022, 0.008, 0.0068, 0.062, -0.593);
  triggerGuard(B, M.steel, -0.022, -0.03, 0.016, M.worn);
  // magazine
  B.part('mag', [0, -0.02, -0.075]);
  B.bx(M.steel, 0.02, 0.085, 0.04, 0, -0.028, 0);
  B.bx(M.steel, 0.021, 0.003, 0.036, 0, -0.045, 0);
  B.bx(M.steel, 0.022, 0.006, 0.042, 0, -0.07, 0);
  // operating slide handle (right)
  B.part('bolt', [0.017, 0.04, -0.08]);
  B.bx(M.worn, 0.012, 0.008, 0.016, 0.004, 0, 0);
  B.bx(M.worn, 0.004, 0.006, 0.12, -0.001, -0.004, -0.07);
  B.sel();
  B.anchor('muzzle', 0, 0.042, -0.607);
  B.anchor('sight', 0, 0.0745, 0.04);
  B.anchor('leftHand', 0, 0.005, -0.24);
  return 0.92;
}

function thompson(B, M) {
  const rake = 0.25;
  B.bx(M.wood, 0.03, 0.1, 0.04, 0, -0.03, 0.014, -rake);
  B.bx(M.steel, 0.036, 0.03, 0.2, 0, 0.018, -0.045);
  B.bx(M.steel, 0.044, 0.05, 0.25, 0, 0.055, -0.07);
  B.bx(M.black, 0.002, 0.014, 0.05, 0.0222, 0.06, -0.085);
  B.bx(M.worn, 0.002, 0.012, 0.012, -0.0222, 0.035, -0.02);
  // rear sight
  B.bx(M.steel, 0.02, 0.012, 0.03, 0, 0.086, 0.035);
  B.bx(M.steel, 0.005, 0.01, 0.006, -0.006, 0.095, 0.035);
  B.bx(M.steel, 0.005, 0.01, 0.006, 0.006, 0.095, 0.035);
  // finned barrel + Cutts compensator
  B.tz(M.steel, 0.0105, 0.012, -0.49, -0.195, 0, 0.05, 10);
  for (let i = 0; i < 14; i++) {
    const z = -0.212 - i * 0.0105;
    B.tz(M.steel, 0.019, 0.019, z - 0.0018, z + 0.0018, 0, 0.05, 12);
  }
  B.bx(M.steel, 0.026, 0.026, 0.055, 0, 0.05, -0.515);
  for (let i = 0; i < 3; i++) B.bx(M.black, 0.018, 0.002, 0.004, 0, 0.0632, -0.502 - i * 0.011);
  B.tz(M.black, 0.0062, 0.0062, -0.5435, -0.54, 0, 0.05, 8);
  B.bx(M.steel, 0.008, 0.012, 0.02, 0, 0.069, -0.5);
  B.bx(M.steel, 0.002, 0.02, 0.006, 0, 0.085, -0.5);
  // vertical fore-grip
  B.bx(M.steel, 0.02, 0.014, 0.035, 0, 0.032, -0.3);
  B.ext(M.wood, shapeFrom([
    [0.278, 0.03], [0.322, 0.03], [0.326, 0.0], [0.318, -0.012], [0.33, -0.026], [0.318, -0.04],
    [0.33, -0.054], [0.318, -0.068], [0.328, -0.08], [0.316, -0.092], [0.29, -0.094], [0.282, -0.08], [0.276, -0.02],
  ]), 0.03, 0, 0.002);
  // butt stock
  B.bx(M.steel, 0.03, 0.05, 0.02, 0, 0.05, 0.062);
  B.ext(M.wood, shapeFrom([
    [-0.055, 0.075], [-0.33, 0.045], [-0.336, 0.04], [-0.338, -0.03], [-0.332, -0.085],
    [-0.3, -0.085], [-0.12, -0.005], [-0.07, 0.01], [-0.055, 0.03],
  ]), 0.04);
  buttPlate(B, M.steel, 0.13, -0.02, 0.338);
  triggerGuard(B, M.steel, 0.003, -0.035, 0.015, M.worn);
  B.bx(M.steel, 0.03, 0.028, 0.045, 0, 0.004, -0.105);
  // stick magazine
  B.part('mag', [0, -0.01, -0.105]);
  B.bx(M.steel, 0.022, 0.18, 0.034, 0, -0.07, 0);
  B.bx(M.steel, 0.0225, 0.003, 0.03, 0, -0.03, 0);
  B.bx(M.steel, 0.0225, 0.003, 0.03, 0, -0.1, 0);
  B.bx(M.steel, 0.024, 0.006, 0.036, 0, -0.16, 0);
  // top cocking knob
  B.part('bolt', [0, 0.08, -0.06]);
  B.bx(M.worn, 0.006, 0.006, 0.012, 0, 0.002, 0);
  B.sp(M.worn, 0.0065, 0, 0.007, 0, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.05, -0.545);
  B.anchor('sight', 0, 0.096, 0.035);
  B.anchor('leftHand', 0, -0.03, -0.3);
  return 0.885;
}

function mp40(B, M) {
  const rake = 0.2;
  B.tz(M.steel, 0.0175, 0.0175, -0.245, 0.07, 0, 0.047, 12);
  B.tz(M.steel, 0.016, 0.018, 0.07, 0.086, 0, 0.047, 12);
  for (let i = 0; i < 4; i++) B.tz(M.worn, 0.0182, 0.0182, -0.23 + i * 0.012, -0.226 + i * 0.012, 0, 0.047, 12);
  B.bx(M.black, 0.002, 0.006, 0.13, -0.0172, 0.047, -0.05);
  B.bx(M.bakelite, 0.03, 0.035, 0.17, 0, 0.018, 0);
  B.bx(M.bakelite, 0.03, 0.1, 0.04, 0, -0.035, 0.018, -rake);
  triggerGuard(B, M.steel, 0.0, -0.035, 0.015, M.worn);
  // magazine housing
  B.bx(M.steel, 0.03, 0.075, 0.045, 0, -0.005, -0.12);
  B.bx(M.worn, 0.031, 0.004, 0.046, 0, -0.03, -0.12);
  B.bx(M.worn, 0.031, 0.004, 0.046, 0, 0.0, -0.12);
  // barrel, nut, rest bar, front hood
  B.tz(M.steel, 0.016, 0.016, -0.27, -0.245, 0, 0.047, 12);
  B.tz(M.steel, 0.009, 0.0105, -0.405, -0.27, 0, 0.047, 10);
  B.tz(M.black, 0.005, 0.005, -0.4058, -0.4, 0, 0.047, 8);
  B.bx(M.bakelite, 0.012, 0.024, 0.03, 0, 0.026, -0.29);
  B.tz(M.steel, 0.012, 0.012, -0.4, -0.385, 0, 0.047, 10);
  frontPost(B, -0.392, 0.058, 0.071, 0.01);
  // rear sight
  B.bx(M.steel, 0.018, 0.008, 0.026, 0, 0.068, 0.035);
  B.bx(M.steel, 0.005, 0.006, 0.006, -0.0065, 0.075, 0.035);
  B.bx(M.steel, 0.005, 0.006, 0.006, 0.0065, 0.075, 0.035);
  // folding stock (extended)
  B.bx(M.steel, 0.036, 0.022, 0.03, 0, 0.012, 0.095);
  for (const s of [-1, 1]) {
    B.rod(M.steel, 0.0045, [s * 0.013, 0.012, 0.1], [s * 0.013, 0.0, 0.4]);
  }
  B.bx(M.steel, 0.05, 0.1, 0.008, 0, -0.03, 0.404);
  B.bx(M.steel, 0.034, 0.012, 0.02, 0, 0.012, 0.396);
  B.bx(M.steel, 0.034, 0.012, 0.02, 0, -0.072, 0.396);
  // magazine
  B.part('mag', [0, -0.04, -0.12]);
  B.bx(M.steel, 0.022, 0.2, 0.034, 0, -0.08, 0);
  B.bx(M.steel, 0.0225, 0.14, 0.004, 0, -0.08, -0.0155);
  B.bx(M.steel, 0.025, 0.006, 0.037, 0, -0.18, 0);
  // cocking handle (left)
  B.part('bolt', [-0.018, 0.047, 0]);
  B.bx(M.worn, 0.02, 0.005, 0.006, -0.009, 0, 0);
  B.sp(M.worn, 0.0056, -0.02, 0, 0, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.047, -0.406);
  B.anchor('sight', 0, 0.074, 0.035);
  B.anchor('leftHand', 0, -0.005, -0.12);
  return 0.82;
}

function doubleBarrel(B, M) {
  // action
  B.bx(M.worn, 0.05, 0.04, 0.1, 0, 0.032, -0.04);
  for (const s of [-1, 1]) B.tz(M.worn, 0.0135, 0.0135, -0.098, -0.086, s * 0.0125, 0.04, 10);
  B.bx(M.steel, 0.008, 0.005, 0.03, 0.006, 0.055, 0.02, 0, 0.35, 0);
  triggerGuard(B, M.steel, 0.0, -0.035, 0.019, M.worn);
  B.bx(M.worn, 0.005, 0.017, 0.004, 0, -0.008, -0.043, 0.3);
  // stock
  B.ext(M.wood, shapeFrom([
    [0.005, 0.052], [-0.06, 0.035], [-0.37, 0.045], [-0.376, 0.04], [-0.378, -0.03], [-0.372, -0.1],
    [-0.34, -0.1], [-0.08, -0.032], [-0.03, -0.018], [0.005, 0.012],
  ]), 0.042);
  buttPlate(B, M.bakelite, 0.145, -0.028, 0.378);
  // barrels (break action: pivot at hinge pin). The group is yawed 180 deg with
  // Euler order YXZ so that a POSITIVE rotation.x drops the muzzles (opens);
  // geometry is pre-rotated by the same yaw, so the rest pose is unchanged.
  B.part('barrels', [0, 0.014, -0.09], [0, PI, 0], 'YXZ');
  B.xf = new THREE.Matrix4().makeRotationY(PI);
  for (const s of [-1, 1]) {
    B.tz(M.steel, 0.0115, 0.0128, -0.66, 0.0, s * 0.0125, 0.026, 12);
  }
  B.bx(M.steel, 0.009, 0.006, 0.65, 0, 0.04, -0.33);
  B.bx(M.steel, 0.008, 0.012, 0.6, 0, 0.012, -0.32);
  B.sp(M.steel, 0.0026, 0, 0.0445, -0.652, 1, 1, 1, 6, 4);
  B.bx(M.steel, 0.018, 0.016, 0.05, 0, 0.004, -0.03);
  B.ext(M.wood, shapeFrom([
    [0.02, 0.018], [0.26, 0.018], [0.268, 0.004], [0.258, -0.016], [0.06, -0.02], [0.022, -0.006],
  ]), 0.044);
  B.xf = null;
  B.parts.get('barrels').userData.openAngle = 0.6;
  B.sel();
  B.anchor('muzzle', 0, 0.04, -0.752);
  B.anchor('sight', 0, 0.06, -0.09);
  B.anchor('leftHand', 0, 0.012, -0.24);
  return 1.13;
}

function trenchGun(B, M) {
  B.bx(M.steel, 0.04, 0.058, 0.17, 0, 0.03, -0.1);
  B.bx(M.black, 0.002, 0.02, 0.06, 0.0202, 0.04, -0.1);
  B.bx(M.steel, 0.007, 0.018, 0.009, 0, 0.058, -0.012, -0.5);
  B.bx(M.steel, 0.012, 0.004, 0.012, 0, 0.066, -0.006, -0.5);
  // rear groove sight block
  B.bx(M.steel, 0.012, 0.012, 0.02, 0, 0.065, -0.035);
  B.bx(M.steel, 0.004, 0.006, 0.02, -0.004, 0.073, -0.035);
  B.bx(M.steel, 0.004, 0.006, 0.02, 0.004, 0.073, -0.035);
  // stock
  B.ext(M.wood, shapeFrom([
    [0.02, 0.058], [-0.06, 0.04], [-0.33, 0.046], [-0.336, 0.04], [-0.338, -0.03], [-0.332, -0.1],
    [-0.3, -0.1], [-0.07, -0.03], [0.0, -0.012], [0.02, 0.002],
  ]), 0.042);
  buttPlate(B, M.bakelite, 0.148, -0.027, 0.338);
  triggerGuard(B, M.steel, -0.002, -0.05, 0.017, M.worn);
  // barrel, magazine tube
  B.tz(M.steel, 0.0105, 0.012, -0.705, -0.185, 0, 0.045, 10);
  B.tz(M.black, 0.0085, 0.0085, -0.7058, -0.7, 0, 0.045, 8);
  B.tz(M.steel, 0.0088, 0.0088, -0.64, -0.185, 0, 0.016, 10);
  B.tz(M.steel, 0.0098, 0.0098, -0.655, -0.64, 0, 0.016, 10);
  // ventilated heat shield
  B.tz(M.steel, 0.0195, 0.0195, -0.6, -0.25, 0, 0.047, 12);
  B.tz(M.worn, 0.0212, 0.0212, -0.605, -0.593, 0, 0.047, 12);
  B.tz(M.worn, 0.0212, 0.0212, -0.257, -0.245, 0, 0.047, 12);
  perforate(B, 0.0195, 0.047, -0.59, -0.26, 9, [-1.05, 0, 1.05], 0.0042, 1.5);
  // bayonet adapter + lug + bead
  B.bx(M.steel, 0.02, 0.042, 0.045, 0, 0.03, -0.68);
  B.bx(M.steel, 0.006, 0.01, 0.025, 0, 0.004, -0.685);
  B.bx(M.steel, 0.004, 0.012, 0.006, 0, 0.064, -0.688);
  B.sp(M.brass, 0.0032, 0, 0.0715, -0.688, 1, 1, 1, 6, 4);
  // slide-action fore-end
  B.part('pump', [0, 0.016, -0.3]);
  B.tz(M.wood, 0.021, 0.021, -0.1, 0.06, 0, 0, 10);
  for (let i = 0; i < 8; i++) B.tor(M.wood, 0.0212, 0.0024, TAU, 0, 0, -0.088 + i * 0.019, 0, 0, 0, 3, 8);
  B.sel();
  B.anchor('muzzle', 0, 0.045, -0.706);
  B.anchor('sight', 0, 0.074, -0.035);
  B.anchor('leftHand', 0, 0.016, -0.32);
  return 1.045;
}

function bar(B, M) {
  B.bx(M.steel, 0.044, 0.062, 0.33, 0, 0.038, -0.15);
  B.bx(M.black, 0.002, 0.016, 0.07, 0.0222, 0.05, -0.12);
  B.bx(M.worn, 0.002, 0.006, 0.2, -0.0222, 0.03, -0.18);
  B.bx(M.steel, 0.034, 0.03, 0.1, 0, -0.005, -0.03);
  triggerGuard(B, M.steel, -0.02, -0.04, 0.017, M.worn);
  B.ext(M.wood, shapeFrom([
    [0.015, 0.062], [-0.07, 0.048], [-0.3, 0.052], [-0.306, 0.046], [-0.308, -0.03], [-0.302, -0.105],
    [-0.265, -0.105], [-0.075, -0.034], [-0.03, -0.022], [0.015, -0.005],
  ]), 0.042);
  buttPlate(B, M.steel, 0.16, -0.027, 0.307);
  // forearm around the gas tube
  B.ext(M.wood, shapeFrom([
    [0.33, 0.038], [0.6, 0.038], [0.61, 0.02], [0.6, -0.004], [0.34, -0.004], [0.33, 0.01],
  ]), 0.046);
  for (let i = 0; i < 5; i++) B.bx(M.bakelite, 0.0475, 0.003, 0.02, 0, 0.018, -0.37 - i * 0.045);
  B.tz(M.steel, 0.009, 0.009, -0.77, -0.6, 0, 0.018, 10);
  B.bx(M.steel, 0.02, 0.05, 0.03, 0, 0.034, -0.765);
  B.tz(M.steel, 0.0105, 0.013, -0.885, -0.315, 0, 0.05, 10);
  B.tz(M.steel, 0.0145, 0.012, -0.925, -0.885, 0, 0.05, 10);
  B.tz(M.black, 0.0095, 0.0095, -0.9258, -0.92, 0, 0.05, 8);
  // sights
  B.bx(M.steel, 0.012, 0.018, 0.02, 0, 0.069, -0.878);
  B.bx(M.steel, 0.0024, 0.014, 0.006, 0, 0.085, -0.878);
  B.bx(M.steel, 0.024, 0.012, 0.04, 0, 0.075, 0.0);
  B.bx(M.steel, 0.004, 0.012, 0.006, -0.008, 0.086, 0.0);
  B.bx(M.steel, 0.004, 0.012, 0.006, 0.008, 0.086, 0.0);
  B.tor(M.steel, 0.0055, 0.0018, TAU, 0, 0.089, 0.0, 0, 0, 0, 4, 10);
  // folded bipod
  B.bx(M.steel, 0.034, 0.012, 0.02, 0, 0.036, -0.86);
  for (const s of [-1, 1]) {
    B.rod(M.worn, 0.0042, [s * 0.012, 0.03, -0.86], [s * 0.022, 0.012, -0.6]);
    B.bx(M.steel, 0.01, 0.006, 0.02, s * 0.022, 0.01, -0.592);
  }
  // box magazine
  B.part('mag', [0, 0.008, -0.13]);
  B.bx(M.steel, 0.03, 0.095, 0.08, 0, -0.045, 0);
  B.bx(M.steel, 0.031, 0.004, 0.07, 0, -0.03, 0);
  B.bx(M.steel, 0.032, 0.006, 0.082, 0, -0.094, 0);
  // charging handle (left)
  B.part('bolt', [-0.022, 0.03, -0.2]);
  B.bx(M.worn, 0.018, 0.008, 0.012, -0.009, 0, 0);
  B.sp(M.worn, 0.006, -0.019, 0, 0, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.05, -0.926);
  B.anchor('sight', 0, 0.089, 0.0);
  B.anchor('leftHand', 0, 0.012, -0.46);
  return 1.235;
}

function stg44(B, M) {
  const rake = 0.22;
  B.bx(M.steel, 0.036, 0.04, 0.3, 0, 0.05, -0.12);
  B.tz(M.steel, 0.018, 0.018, -0.27, 0.03, 0, 0.066, 10);
  B.bx(M.steel, 0.034, 0.05, 0.02, 0, 0.058, 0.04);
  B.bx(M.black, 0.002, 0.015, 0.06, 0.0182, 0.06, -0.1);
  B.bx(M.steel, 0.03, 0.03, 0.15, 0, 0.018, -0.02);
  B.bx(M.wood, 0.03, 0.095, 0.04, 0, -0.03, 0.016, -rake);
  triggerGuard(B, M.steel, 0.0, -0.035, 0.016, M.worn);
  B.ext(M.wood, shapeFrom([
    [-0.045, 0.078], [-0.37, 0.058], [-0.376, 0.052], [-0.378, -0.02], [-0.372, -0.09],
    [-0.34, -0.09], [-0.1, 0.0], [-0.06, 0.012], [-0.045, 0.03],
  ]), 0.04);
  buttPlate(B, M.steel, 0.15, -0.016, 0.378);
  B.bx(M.steel, 0.032, 0.035, 0.05, 0, 0.005, -0.105);
  // handguard, gas cylinder, barrel
  B.bx(M.steel, 0.034, 0.042, 0.16, 0, 0.062, -0.35);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) B.bx(M.black, 0.002, 0.005, 0.03, s * 0.0172, 0.064, -0.3 - i * 0.045);
  }
  B.tz(M.steel, 0.0115, 0.0115, -0.52, -0.43, 0, 0.072, 10);
  B.tz(M.steel, 0.0095, 0.0105, -0.575, -0.43, 0, 0.045, 10);
  B.tz(M.steel, 0.011, 0.011, -0.59, -0.575, 0, 0.045, 10);
  B.tz(M.black, 0.0055, 0.0055, -0.5908, -0.586, 0, 0.045, 8);
  B.bx(M.steel, 0.02, 0.04, 0.03, 0, 0.066, -0.525);
  frontPost(B, -0.525, 0.086, 0.098, 0.01);
  // rear tangent sight
  B.bx(M.steel, 0.022, 0.01, 0.06, 0, 0.088, -0.22);
  B.bx(M.steel, 0.02, 0.006, 0.012, 0, 0.095, -0.2);
  // curved magazine
  B.part('mag', [0, -0.012, -0.105]);
  const L = [];
  const R = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const v = 0.03 - 0.26 * t;
    const u = 0.055 * t * t;
    L.push([u - 0.018, v]);
    R.push([u + 0.018, v]);
  }
  B.ext(M.steel, shapeFrom([...L, ...R.reverse()]), 0.022, 0, 0.0015);
  B.bx(M.steel, 0.026, 0.006, 0.042, 0, -0.232, -0.055, 0.42);
  // cocking handle (left)
  B.part('bolt', [-0.019, 0.066, -0.17]);
  B.bx(M.worn, 0.016, 0.007, 0.01, -0.008, 0, 0);
  B.sp(M.worn, 0.006, -0.017, 0, 0, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.045, -0.591);
  B.anchor('sight', 0, 0.098, -0.2);
  B.anchor('leftHand', 0, 0.03, -0.34);
  return 0.97;
}

function ppsh(B, M) {
  B.bx(M.steel, 0.036, 0.04, 0.2, 0, 0.045, -0.075);
  B.tz(M.steel, 0.018, 0.018, -0.175, 0.025, 0, 0.06, 12);
  B.bx(M.black, 0.002, 0.014, 0.06, 0.0182, 0.05, -0.1);
  // perforated barrel shroud + slanted compensator
  B.tz(M.steel, 0.02, 0.02, -0.44, -0.175, 0, 0.047, 12);
  perforate(B, 0.02, 0.047, -0.43, -0.19, 7, [-HALF, -0.8, 0, 0.8, HALF], 0.0042, 2.2);
  B.tz(M.steel, 0.0085, 0.0085, -0.45, -0.43, 0, 0.047, 8);
  B.bx(M.steel, 0.042, 0.05, 0.005, 0, 0.049, -0.452, -0.55);
  B.tz(M.black, 0.005, 0.005, -0.4555, -0.45, 0, 0.047, 8);
  frontPost(B, -0.425, 0.066, 0.082, 0.011);
  B.bx(M.steel, 0.016, 0.008, 0.02, 0, 0.078, -0.05);
  B.bx(M.steel, 0.004, 0.006, 0.006, -0.005, 0.084, -0.05);
  B.bx(M.steel, 0.004, 0.006, 0.006, 0.005, 0.084, -0.05);
  // wooden stock
  B.ext(M.woodRed, shapeFrom([
    [0.175, 0.03], [0.03, 0.028], [-0.02, 0.022], [-0.1, 0.032], [-0.38, 0.044], [-0.386, 0.038],
    [-0.388, -0.03], [-0.382, -0.105], [-0.345, -0.105], [-0.06, -0.034], [0.0, -0.026],
    [0.03, -0.012], [0.175, 0.008], [0.185, 0.02],
  ]), 0.04);
  buttPlate(B, M.steel, 0.15, -0.03, 0.388);
  triggerGuard(B, M.steel, -0.02, -0.012, 0.014, M.worn);
  // drum magazine
  B.part('mag', [0, -0.078, -0.105]);
  B.tx(M.steel, 0.07, 0.052, 0, 0, 0, 20);
  for (const s of [-1, 1]) B.tor(M.steel, 0.056, 0.0032, TAU, s * 0.026, 0, 0, 0, HALF, 0, 4, 20);
  B.tx(M.steel, 0.02, 0.058, 0, 0, 0, 10);
  B.bx(M.steel, 0.024, 0.03, 0.04, 0, 0.075, 0);
  B.bx(M.steel, 0.004, 0.012, 0.012, -0.03, 0.05, 0.03);
  // cocking handle (right)
  B.part('bolt', [0.018, 0.05, -0.08]);
  B.bx(M.worn, 0.014, 0.006, 0.01, 0.007, 0, 0);
  B.sp(M.worn, 0.0055, 0.015, 0, 0, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.047, -0.456);
  B.anchor('sight', 0, 0.084, -0.05);
  B.anchor('leftHand', 0, 0.005, -0.2);
  return 0.845;
}

function mg42(B, M) {
  const rake = 0.3;
  B.bx(M.steel, 0.05, 0.07, 0.29, 0, 0.058, -0.115);
  B.bx(M.steel, 0.052, 0.018, 0.17, 0, 0.1, -0.17);
  B.bx(M.worn, 0.074, 0.02, 0.06, 0, 0.078, -0.14);
  B.bx(M.steel, 0.034, 0.03, 0.08, 0, 0.012, -0.02);
  B.bx(M.bakelite, 0.03, 0.1, 0.042, 0, -0.03, 0.016, -rake);
  triggerGuard(B, M.steel, -0.004, -0.04, 0.016, M.worn);
  B.ext(M.bakelite, shapeFrom([
    [-0.03, 0.09], [-0.36, 0.066], [-0.366, 0.06], [-0.368, 0.0], [-0.362, -0.07],
    [-0.33, -0.07], [-0.13, 0.02], [-0.05, 0.03], [-0.03, 0.035],
  ]), 0.044);
  buttPlate(B, M.steel, 0.14, -0.002, 0.368, 0.046);
  // perforated barrel jacket
  B.bx(M.steel, 0.046, 0.05, 0.5, 0, 0.06, -0.51);
  for (const y of [0.05, 0.07]) {
    for (let i = 0; i < 7; i++) B.add(G.hex(0.0068), M.black, -0.0238, y, -0.3 - i * 0.058, 0, 0, HALF, 1, 1, 1.9);
  }
  B.bx(M.black, 0.002, 0.024, 0.34, 0.0232, 0.06, -0.52);
  for (let i = 0; i < 8; i++) B.add(G.hex(0.005), M.black, 0, 0.0856, -0.3 - i * 0.055);
  // muzzle booster
  B.tz(M.steel, 0.024, 0.026, -0.8, -0.76, 0, 0.06, 12);
  B.tz(M.steel, 0.018, 0.022, -0.84, -0.8, 0, 0.06, 12);
  B.tz(M.black, 0.01, 0.01, -0.8408, -0.835, 0, 0.06, 10);
  // sights
  B.bx(M.steel, 0.012, 0.008, 0.012, 0, 0.089, -0.745);
  B.bx(M.steel, 0.003, 0.028, 0.004, 0, 0.1, -0.745);
  B.bx(M.steel, 0.024, 0.018, 0.026, 0, 0.094, -0.275);
  B.bx(M.steel, 0.02, 0.01, 0.004, 0, 0.108, -0.275);
  // folded bipod
  B.bx(M.steel, 0.052, 0.014, 0.03, 0, 0.03, -0.735);
  for (const s of [-1, 1]) {
    B.rod(M.worn, 0.0048, [s * 0.014, 0.026, -0.735], [s * 0.026, 0.004, -0.43]);
    B.bx(M.steel, 0.014, 0.006, 0.03, s * 0.026, 0.002, -0.42);
  }
  // 50-round belt drum on the left
  B.part('mag', [-0.062, 0.03, -0.14]);
  B.tx(M.olive, 0.052, 0.05, 0, 0, 0, 16);
  B.tor(M.olive, 0.05, 0.0032, TAU, -0.025, 0, 0, 0, HALF, 0, 4, 16);
  B.tx(M.olive, 0.014, 0.054, 0, 0, 0, 8);
  B.bx(M.olive, 0.01, 0.02, 0.012, -0.027, 0.03, 0);
  // charging handle (right)
  B.part('bolt', [0.026, 0.04, -0.13]);
  B.bx(M.worn, 0.02, 0.012, 0.014, 0.01, 0, 0);
  B.bx(M.worn, 0.006, 0.02, 0.016, 0.02, 0, 0);
  B.sel();
  B.anchor('muzzle', 0, 0.06, -0.842);
  B.anchor('sight', 0, 0.113, -0.275);
  B.anchor('leftHand', 0, 0.02, -0.34);
  return 1.21;
}

function panzerschreck(B, M) {
  const ty = 0.1;
  B.tz(M.oliveDS, 0.046, 0.046, -1.09, 0.55, 0, ty, 18, true);
  B.tor(M.steel, 0.047, 0.004, TAU, 0, ty, -1.087, 0, 0, 0, 5, 18);
  B.tor(M.steel, 0.047, 0.004, TAU, 0, ty, 0.547, 0, 0, 0, 5, 18);
  B.tor(M.steel, 0.047, 0.003, TAU, 0, ty, -0.3, 0, 0, 0, 4, 18);
  B.tor(M.steel, 0.047, 0.003, TAU, 0, ty, 0.2, 0, 0, 0, 4, 18);
  // rear wire guard ring
  B.tor(M.steel, 0.062, 0.0035, TAU, 0, ty, 0.6, 0, 0, 0, 5, 18);
  for (let k = 0; k < 3; k++) {
    const a = HALF + (k * TAU) / 3;
    B.rod(M.steel, 0.003, [Math.cos(a) * 0.046, ty + Math.sin(a) * 0.046, 0.52], [Math.cos(a) * 0.062, ty + Math.sin(a) * 0.062, 0.6], 6);
  }
  // blast shield with sighting window
  const sz = -0.24;
  B.bx(M.olive, 0.3, 0.16, 0.006, -0.06, 0.06, sz);
  B.bx(M.olive, 0.3, 0.07, 0.006, -0.06, 0.225, sz);
  B.bx(M.olive, 0.1, 0.05, 0.006, -0.16, 0.165, sz);
  B.bx(M.olive, 0.13, 0.05, 0.006, 0.025, 0.165, sz);
  B.bx(M.olive, 0.3, 0.006, 0.03, -0.06, 0.258, sz + 0.014);
  B.bx(M.glass, 0.07, 0.05, 0.002, -0.075, 0.165, sz);
  // sights on the left of the tube
  B.bx(M.steel, 0.035, 0.008, 0.02, -0.06, 0.118, 0.05);
  B.bx(M.steel, 0.024, 0.042, 0.004, -0.075, 0.14, 0.05);
  B.bx(M.steel, 0.006, 0.01, 0.004, -0.084, 0.166, 0.05);
  B.bx(M.steel, 0.006, 0.01, 0.004, -0.066, 0.166, 0.05);
  B.bx(M.steel, 0.035, 0.008, 0.02, -0.06, 0.118, -0.6);
  B.bx(M.steel, 0.003, 0.05, 0.003, -0.075, 0.143, -0.6);
  // rear grip, trigger
  B.bx(M.steel, 0.028, 0.03, 0.09, 0, 0.042, -0.01);
  B.bx(M.wood, 0.03, 0.1, 0.04, 0, -0.012, 0.01, -0.2);
  triggerGuard(B, M.steel, 0.024, -0.045, 0.015, M.worn);
  // front grip
  B.bx(M.steel, 0.024, 0.022, 0.05, 0, 0.045, -0.45);
  B.bx(M.wood, 0.03, 0.09, 0.036, 0, -0.005, -0.45, 0.08);
  // shoulder rest
  B.bx(M.steel, 0.012, 0.05, 0.012, 0, 0.035, 0.24);
  B.bx(M.wood, 0.04, 0.022, 0.16, 0, 0.006, 0.28);
  // ignition box and cable
  B.bx(M.olive, 0.036, 0.04, 0.12, 0, 0.04, -0.14);
  B.tz(M.steel, 0.004, 0.004, -0.08, 0.45, 0.048, 0.09, 6);
  B.bx(M.steel, 0.02, 0.025, 0.035, 0.05, 0.1, 0.46);
  // rocket (loaded; nose visible in the front opening)
  B.part('mag', [0, ty, 0]);
  B.tz(M.worn, 0.006, 0.028, -1.076, -1.035, 0, 0, 12);
  B.tz(M.worn, 0.028, 0.041, -1.035, -1.0, 0, 0, 12);
  B.tz(M.worn, 0.041, 0.041, -1.0, -0.94, 0, 0, 12);
  B.tz(M.worn, 0.041, 0.02, -0.94, -0.9, 0, 0, 12);
  B.tz(M.worn, 0.018, 0.018, -0.9, -0.6, 0, 0, 8);
  B.tz(M.worn, 0.038, 0.038, -0.6, -0.55, 0, 0, 12, true);
  B.sel();
  B.anchor('muzzle', 0, ty, -1.09);
  B.anchor('sight', -0.075, 0.165, 0.05);
  B.anchor('leftHand', 0, -0.005, -0.45);
  return 1.69;
}

function arcPistol(B, M) {
  const rake = 0.25;
  const gc = [0, -0.025, 0.018];
  B.bx(M.bakelite, 0.032, 0.1, 0.042, ...gc, -rake);
  for (let i = 0; i < 4; i++) B.bx(M.copper, 0.034, 0.005, 0.006, ...along(...gc, rake, -0.032 + i * 0.02, -0.021), -rake);
  B.bx(M.brass, 0.036, 0.01, 0.046, ...along(...gc, rake, -0.052), -rake);
  B.bx(M.bakelite, 0.03, 0.03, 0.09, 0, 0.028, -0.02);
  triggerGuard(B, M.brass, 0.013, -0.04, 0.016, M.copper);
  // lathe-turned brass body
  const prof = [[0.0, 0], [0.018, 0], [0.026, 0.012], [0.034, 0.035], [0.036, 0.07], [0.033, 0.11], [0.026, 0.14], [0.024, 0.16], [0, 0.16]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 8);
  B.add(lathe, M.brass, 0, 0.065, 0.065, -HALF, 0, 0);
  for (let i = 0; i < 3; i++) B.tor(M.copper, 0.03 + i * 0.002, 0.003, TAU, 0, 0.065, 0.048 - i * 0.012, 0, 0, 0, 4, 8);
  B.tor(M.copper, 0.037, 0.003, TAU, 0, 0.065, -0.02, 0, 0, 0, 4, 16);
  // glass coil chamber
  B.tz(M.glass, 0.024, 0.024, -0.19, -0.095, 0, 0.065, 14);
  B.tor(M.brass, 0.025, 0.005, TAU, 0, 0.065, -0.095, 0, 0, 0, 4, 8);
  B.tor(M.brass, 0.025, 0.005, TAU, 0, 0.065, -0.19, 0, 0, 0, 4, 8);
  B.add(new THREE.TubeGeometry(new HelixCurve(0.0155, 6, -0.1, -0.185), 36, 0.0028, 3, false), M.glow, 0, 0.065, 0);
  B.tz(M.copper, 0.004, 0.004, -0.19, -0.095, 0, 0.065, 6);
  for (const s of [-1, 1]) B.tz(M.brass, 0.003, 0.003, -0.25, -0.09, s * 0.024, 0.045, 6);
  // emitter rings and prongs
  const rings = [[-0.205, 0.03], [-0.226, 0.025], [-0.245, 0.02]];
  for (const [z, R] of rings) {
    B.tor(M.copper, R, 0.0042, TAU, 0, 0.065, z, 0, 0, 0, 4, 8);
    B.tor(M.glow, R - 0.0045, 0.0016, TAU, 0, 0.065, z, 0, 0, 0, 3, 8);
  }
  for (let k = 0; k < 3; k++) {
    const a = HALF + (k * TAU) / 3;
    B.rod(M.brass, 0.0022, [Math.cos(a) * 0.025, 0.065 + Math.sin(a) * 0.025, -0.19], [Math.cos(a) * 0.02, 0.065 + Math.sin(a) * 0.02, -0.245], 6);
  }
  B.sp(M.glow, 0.008, 0, 0.065, -0.256, 1, 1, 1, 10, 8);
  B.sp(M.glowSoft, 0.015, 0, 0.065, -0.256, 1, 1, 1, 10, 8);
  // vacuum tube on top-right
  B.cy(M.bakelite, 0.009, 0.01, 0.012, 0.022, 0.1, -0.01);
  B.sp(M.glass, 0.011, 0.022, 0.118, -0.01, 1, 1.4, 1, 10, 8);
  B.cy(M.glow, 0.0025, 0.0025, 0.018, 0.022, 0.118, -0.01, 0, 0, 0, 6);
  // pressure gauge on the left
  B.tx(M.brass, 0.014, 0.01, -0.036, 0.07, 0.02, 14);
  B.add(G.hex(0.011), M.glowSoft, -0.0412, 0.07, 0.02, 0, 0, HALF);
  B.bx(M.black, 0.001, 0.009, 0.0015, -0.0428, 0.073, 0.018, 0.6);
  // sights
  B.bx(M.brass, 0.018, 0.01, 0.01, 0, 0.1, 0.05);
  B.bx(M.brass, 0.005, 0.008, 0.008, -0.006, 0.109, 0.05);
  B.bx(M.brass, 0.005, 0.008, 0.008, 0.006, 0.109, 0.05);
  B.bx(M.brass, 0.003, 0.012, 0.004, 0, 0.105, -0.205);
  // power cell (magazine) in the grip heel
  B.part('mag', along(...gc, rake, -0.058), [-rake, 0, 0]);
  B.cy(M.glow, 0.0075, 0.0075, 0.03, 0, -0.012, 0, 0, 0, 0, 10);
  B.cy(M.brass, 0.0135, 0.0135, 0.007, 0, -0.03, 0, 0, 0, 0, 10);
  for (const s of [-1, 1]) B.cy(M.brass, 0.0016, 0.0016, 0.03, s * 0.0095, -0.014, 0, 0, 0, 0, 5);
  // charging lever (right rear)
  B.part('bolt', [0.028, 0.075, 0.055]);
  B.bx(M.copper, 0.005, 0.006, 0.04, 0.004, 0, 0.01);
  B.sp(M.copper, 0.007, 0.006, 0, 0.03, 1, 1, 1, 8, 6);
  B.sel();
  B.anchor('muzzle', 0, 0.065, -0.262);
  B.anchor('sight', 0, 0.11, 0.05);
  B.anchor('leftHand', 0, -0.055, 0.035);
  return 0.33;
}

const WEAPON_BUILDERS = {
  m1911, kar98k, m1carbine, thompson, mp40, doublebarrel: doubleBarrel, trenchgun: trenchGun,
  bar, stg44, ppsh, mg42, panzerschreck, arcpistol: arcPistol,
};

// ---------------------------------------------------------------------------
// Knife, grenade, hands, power-ups
// ---------------------------------------------------------------------------

function knifeBP() {
  const B = new Builder();
  const M = mats();
  B.tz(M.wood, 0.0125, 0.014, -0.05, 0.055, 0, 0, 10, false, 0.75, 1);
  for (let i = 0; i < 5; i++) B.tz(M.bakelite, 0.0132, 0.0138, -0.04 + i * 0.02, -0.036 + i * 0.02, 0, 0, 10, false, 0.78, 1);
  for (const z of [-0.025, 0.025]) B.tx(M.brass, 0.003, 0.021, 0, 0, z, 6);
  B.tz(M.steel, 0.013, 0.01, 0.055, 0.07, 0, 0, 10, false, 0.8, 1);
  B.bx(M.steel, 0.016, 0.056, 0.008, 0, -0.004, -0.054);
  B.ext(M.worn, shapeFrom([
    [0.05, 0.012], [0.2, 0.012], [0.255, 0.004], [0.268, -0.002], [0.24, -0.009], [0.18, -0.013], [0.05, -0.013],
  ]), 0.002, 0, 0.0015);
  B.bx(M.steel, 0.0055, 0.004, 0.1, 0, 0.004, -0.12);
  B.anchor('tip', 0, -0.002, -0.268);
  return finalize(B, 'knife', 0.34);
}

function grenadeBP() {
  const B = new Builder();
  const M = mats();
  B.cy(M.woodLight, 0.0125, 0.0125, 0.12, 0, 0, 0, 0, 0, 0, 10);
  B.cy(M.steel, 0.0138, 0.0138, 0.014, 0, -0.066, 0, 0, 0, 0, 10);
  B.cy(M.steel, 0.016, 0.016, 0.01, 0, 0.062, 0, 0, 0, 0, 10);
  B.cy(M.olive, 0.031, 0.02, 0.01, 0, 0.072, 0, 0, 0, 0, 14);
  B.cy(M.olive, 0.031, 0.031, 0.06, 0, 0.107, 0, 0, 0, 0, 14);
  B.cy(M.olive, 0.027, 0.031, 0.008, 0, 0.141, 0, 0, 0, 0, 14);
  B.bx(M.steel, 0.004, 0.05, 0.012, 0.033, 0.1, 0);
  B.anchor('top', 0, 0.145, 0);
  return finalize(B, 'grenade', 0.22);
}

function mirrorGeometryX(src) {
  const g = src.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  flipWinding(g);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function handBP(side) {
  const B = new Builder();
  const M = mats();
  // Built as a right hand: grip channel along Y through the origin, palm on
  // the +X side, fingers wrapping around the front (-Z) to the left side.
  // faceted back of the hand / palm mass (hides the finger roots); grimy knuckles
  B.sp(M.skin, 1, 0.021, 0.0, 0.017, 0.0175, 0.045, 0.041, 12, 10);
  B.sp(M.skin, 1, 0.012, -0.004, 0.028, 0.014, 0.04, 0.03, 10, 8);
  const fingers = [[0.029, 0.024, 0.0088], [0.0095, 0.025, 0.0093], [-0.0095, 0.024, 0.0089], [-0.028, 0.021, 0.0079]];
  const g0 = 0.3;
  const arc = 3.4;
  for (const [y, R, r] of fingers) {
    B.tor(M.skin, R, r, arc, 0.0, y, -0.002, -HALF, 0, g0, 6, 10);
    const a1 = g0 + arc;
    B.sp(M.skin, r * 1.02, Math.cos(a1) * R, y, -0.002 - Math.sin(a1) * R, 1, 1, 1, 8, 6);
    B.sp(M.grime, r * 1.12, Math.cos(g0) * R + 0.002, y, -0.002 - Math.sin(g0) * R, 1, 1, 1, 8, 6);
  }
  // thumb over the left side
  B.sp(M.skin, 0.02, 0.012, 0.03, 0.03, 1, 0.9, 1.2, 8, 6);
  B.rod(M.skin, 0.0098, [0.012, 0.04, 0.03], [-0.016, 0.046, 0.012], 8);
  B.rod(M.skin, 0.0088, [-0.016, 0.046, 0.012], [-0.024, 0.048, -0.016], 8);
  B.sp(M.skin, 0.0098, -0.016, 0.046, 0.012, 1, 1, 1, 8, 6);
  B.sp(M.skin, 0.0088, -0.024, 0.048, -0.016, 1, 1, 1, 8, 6);
  // wrist and forearm
  B.tz(M.skin, 0.024, 0.03, 0.04, 0.14, 0.018, -0.002, 10, false, 0.85, 1.05);
  B.tz(M.cuff, 0.041, 0.043, 0.13, 0.175, 0.018, 0.0, 12);
  B.tor(M.cuff, 0.041, 0.0065, TAU, 0.018, 0.0, 0.13, 0, 0, 0, 4, 10);
  B.tor(M.cuff, 0.043, 0.005, TAU, 0.018, 0.0, 0.175, 0, 0, 0, 4, 10);
  B.tz(M.sleeve, 0.043, 0.05, 0.175, 0.38, 0.018, 0.002, 12);
  B.tor(M.sleeve, 0.048, 0.004, TAU, 0.018, 0.002, 0.31, 0, 0, 0, 4, 14);
  const bp = finalize(B, `hand_${side}`, 0.38);
  if (side === 'left') {
    for (const part of bp.parts) {
      part.meshes = part.meshes.map(({ geometry, material }) => {
        const m = mirrorGeometryX(geometry);
        geometry.dispose();
        return { geometry: m, material };
      });
    }
  }
  return bp;
}

function powerupBP(type) {
  const B = new Builder();
  const M = mats();
  const { pBody, pGold, pBright, pDark } = M;
  switch (type) {
    case 'instakill': {
      B.sp(pBody, 0.16, 0, 0.05, -0.01, 1, 0.95, 1.1, 14, 12);
      B.bx(pBody, 0.19, 0.1, 0.14, 0, -0.07, 0.05);
      B.bx(pBody, 0.15, 0.06, 0.12, 0, -0.15, 0.06);
      for (const s of [-1, 1]) B.sp(pDark, 0.046, s * 0.064, 0.0, 0.13, 1, 0.9, 0.55, 10, 8);
      B.cy(pDark, 0.0, 0.026, 0.045, 0, -0.058, 0.142, -0.25, 0, 0, 3);
      for (let i = 0; i < 6; i++) B.bx(pBright, 0.018, 0.034, 0.02, -0.05 + i * 0.02, -0.12, 0.118);
      B.bx(pDark, 0.13, 0.008, 0.02, 0, -0.139, 0.118);
      break;
    }
    case 'doublepoints': {
      B.bx(pBody, 0.055, 0.24, 0.06, -0.14, -0.02, 0, 0, 0, 0.7);
      B.bx(pBody, 0.055, 0.24, 0.06, -0.14, -0.02, 0, 0, 0, -0.7);
      B.tor(pBody, 0.075, 0.028, 3.7, 0.08, 0.06, 0, 0, 0, -0.75, 6, 14);
      B.sp(pBody, 0.028, 0.08 + 0.075 * Math.cos(2.95), 0.06 + 0.075 * Math.sin(2.95), 0, 1, 1, 1, 8, 6);
      B.rod(pBody, 0.028, [0.135, 0.009, 0], [0.012, -0.12, 0], 8);
      B.bx(pBody, 0.17, 0.056, 0.056, 0.09, -0.13, 0);
      B.sp(pBright, 0.02, -0.14, -0.02, 0.028, 1, 1, 0.3, 8, 6);
      break;
    }
    case 'nuke': {
      B.xf = new THREE.Matrix4().makeRotationZ(0.55);
      const prof = [[0, -0.22], [0.04, -0.21], [0.075, -0.17], [0.09, -0.1], [0.09, 0.06], [0.07, 0.12], [0.04, 0.16], [0.03, 0.2], [0, 0.2]];
      B.add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 8), pBody);
      for (let k = 0; k < 4; k++) {
        const a = (k * PI) / 2;
        B.bx(pGold, 0.1, 0.11, 0.006, Math.cos(a) * 0.055, 0.2, Math.sin(a) * 0.055, 0, -a, 0);
      }
      B.tor(pBright, 0.075, 0.007, TAU, 0, 0.24, 0, HALF, 0, 0, 5, 18);
      B.tor(pBright, 0.092, 0.007, TAU, 0, -0.02, 0, HALF, 0, 0, 5, 18);
      B.tor(pDark, 0.0905, 0.006, TAU, 0, 0.03, 0, HALF, 0, 0, 5, 18);
      break;
    }
    case 'carpenter': {
      B.xf = new THREE.Matrix4().makeRotationZ(-0.5);
      B.cy(pGold, 0.02, 0.024, 0.4, 0, -0.06, 0, 0, 0, 0, 10);
      B.cy(pBody, 0.027, 0.027, 0.12, 0, -0.2, 0, 0, 0, 0, 10);
      B.bx(pBody, 0.2, 0.055, 0.055, 0, 0.16, 0);
      B.cy(pBright, 0.034, 0.03, 0.04, 0.12, 0.16, 0, 0, 0, HALF, 12);
      for (const s of [-1, 1]) B.bx(pBody, 0.1, 0.025, 0.018, -0.14, 0.14, s * 0.014, 0, 0, 0.45);
      break;
    }
    case 'maxammo':
    default: {
      B.bx(pBody, 0.4, 0.2, 0.24, 0, -0.06, 0);
      B.bx(pDark, 0.404, 0.028, 0.244, 0, -0.06, 0);
      for (const s of [-1, 1]) B.bx(pBright, 0.03, 0.02, 0.1, s * 0.215, -0.02, 0);
      B.bx(pGold, 0.41, 0.022, 0.25, 0, 0.045, 0);
      for (let i = 0; i < 5; i++) {
        const x = -0.14 + i * 0.07;
        B.cy(pGold, 0.022, 0.022, 0.12, x, 0.1, 0, 0, 0, 0, 10);
        B.cy(pBright, 0.004, 0.022, 0.05, x, 0.185, 0, 0, 0, 0, 10);
      }
      break;
    }
  }
  return finalize(B, `powerup_${type}`, 0.5);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const BP = new Map();

function blueprint(key, make) {
  let bp = BP.get(key);
  if (!bp) {
    bp = make();
    BP.set(key, bp);
  }
  return bp;
}

/** Build a weapon model for any id in WEAPONS. */
export function buildWeaponModel(id) {
  let key = id;
  if (!WEAPON_BUILDERS[key]) {
    console.warn(`[weapons3d] unknown weapon id "${id}", using m1911`);
    key = 'm1911';
  }
  const bp = blueprint(`w:${key}`, () => {
    const B = new Builder();
    const length = WEAPON_BUILDERS[key](B, mats());
    return finalize(B, key, length);
  });
  const g = instantiate(bp);
  g.userData.name = WEAPONS[key]?.name ?? key;
  return g;
}

/** Trench knife: grip at origin, blade toward -Z, edge down. userData.tip at the point. */
export function buildKnife() {
  return instantiate(blueprint('knife', knifeBP));
}

/** Stick grenade (~0.21 m): long axis +Y, head up, origin at the middle of the handle. */
export function buildGrenade() {
  return instantiate(blueprint('grenade', grenadeBP));
}

/**
 * First-person forearm + gripping hand. Origin = centre of the fist's grip
 * channel (palm centre); the channel runs along Y, fingers wrap -Z side,
 * forearm extends to +Z (~0.38 m). Left hand is the exact mirror in X.
 */
export function buildHand(side = 'right') {
  const s = side === 'left' ? 'left' : 'right';
  const g = instantiate(blueprint(`hand:${s}`, () => handBP(s)));
  g.userData.side = s;
  return g;
}

/** Glowing power-up pickup (~0.4–0.5 m), centred at origin, faces +Z. */
export function buildPowerupModel(type) {
  const known = ['maxammo', 'instakill', 'doublepoints', 'nuke', 'carpenter'];
  const t = known.includes(type) ? type : 'maxammo';
  const g = instantiate(blueprint(`p:${t}`, () => powerupBP(t)));
  g.userData.type = t;
  return g;
}

/** Dispose every cached geometry and material. Existing models become invalid. */
export function disposeShared() {
  for (const bp of BP.values()) {
    for (const part of bp.parts) for (const { geometry } of part.meshes) geometry.dispose();
  }
  BP.clear();
  for (const g of GEO.values()) g.dispose();
  GEO.clear();
  if (MATS) for (const m of Object.values(MATS)) m.dispose();
  MATS = null;
  if (TEX) for (const t of Object.values(TEX)) t.dispose();
  TEX = null;
}
