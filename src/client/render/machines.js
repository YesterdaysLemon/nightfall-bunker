// World props for the new systems: the perk machines, the Forge (the upgrade
// press), the Magic Lantern teleporter and its pads, spark-gate traps and their
// switches, the main breaker and the box token.
//
// Every builder returns a THREE.Group in metres with its origin on the floor,
// centred, front facing +Z. Wall-mounted pieces (trap switch, breaker) keep the
// origin on the floor at the wall plane (z = 0) and stand out along +Z.
// `group.userData` holds the controls. Everything animates inside
// update(dt, t), which the game calls each frame; setCalm(on) (the player's
// reduce-flashing setting) turns every flicker and flash into a soft fade.
//
// Static parts are merged per material, and their geometry is built once and
// shared between instances; only materials that change with a machine's state
// are its own. Each machine has at most one small PointLight (userData.light,
// dark while unpowered); the game may remove it to save a light.
//
// The look follows art/STYLE.md: faceted parts with hard normals, and painted
// pages with small hue-shifted ramps and hard texels. Like the guns' pages
// (weapons3d.js) they are painted at "1997" resolution already, so they are not
// passed through retro.js.

import * as THREE from 'three';
import { PERKS } from '../../shared/perks.js';
import { mulberry32 } from '../../shared/rng.js';
import { PERK_SYMBOLS, perkRamp } from '../perk-icons.js';
import { Batch, mat } from './geo.js';
import { chamferBox, hull, prism } from './level.js';

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// A transform relative to another: m, then (x, y, z) with yaw/pitch/roll.
const at = (m, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => m.clone().multiply(mat(x, y, z, ry, rx, rz, s));

// --- Painted pages ---------------------------------------------------------------------------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const dith = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

// World ramps (textures.js, weapons3d.js), dark to light: cool shadows, warm highlights.
const RAMP = {
  steel: [[24, 25, 27], [36, 37, 39], [50, 51, 52], [66, 66, 66], [84, 83, 80], [104, 102, 96], [128, 124, 114], [156, 150, 136], [184, 176, 158]],
  iron: [[14, 14, 15], [22, 21, 21], [31, 30, 29], [42, 40, 38], [55, 52, 48], [70, 66, 60], [88, 82, 74]],
  brass: [[46, 36, 22], [70, 55, 32], [96, 76, 42], [122, 98, 54], [148, 122, 70], [174, 147, 90], [198, 172, 116], [222, 202, 156]],
  copper: [[46, 18, 11], [72, 30, 16], [102, 45, 23], [130, 63, 32], [158, 85, 46], [184, 112, 66], [206, 140, 92]],
  brick: [[38, 24, 22], [58, 33, 28], [80, 43, 34], [100, 55, 41], [120, 68, 50], [140, 84, 62], [160, 106, 82]],
  mortar: [[40, 41, 38], [62, 61, 55], [86, 84, 75], [110, 106, 94]],
  wood: [[22, 16, 13], [30, 22, 18], [46, 34, 26], [64, 48, 34], [86, 66, 46], [108, 84, 58], [132, 104, 72], [156, 128, 92]],
  leather: [[20, 13, 10], [30, 19, 14], [42, 27, 19], [56, 37, 25], [72, 48, 32], [90, 61, 41]],
  cream: [[70, 64, 52], [98, 90, 72], [128, 118, 94], [158, 146, 116], [186, 174, 140], [208, 198, 164], [226, 218, 188]],
  porcelain: [[74, 78, 78], [104, 108, 104], [136, 138, 130], [166, 166, 154], [192, 190, 176], [214, 210, 194], [232, 228, 212]],
  plush: [[58, 48, 48], [84, 70, 68], [110, 94, 88], [136, 118, 108], [160, 142, 128], [182, 164, 146], [200, 184, 164]],
  soot: [[8, 8, 9], [14, 13, 13], [20, 19, 18], [28, 26, 24]],
  hazard: [[70, 56, 16], [120, 96, 26], [168, 136, 40], [200, 166, 60]],
  fire: [[40, 10, 6], [110, 30, 10], [190, 70, 20], [240, 130, 40], [255, 200, 110], [255, 238, 196]],
};

const pick = (ramp, v) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
const hexRGB = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixRGB = (a, b, u) => a.map((v, i) => Math.round(v + (b[i] - v) * u));
const scaleRGB = (a, k) => a.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

// fn(x, y) with y = 0 at the top returns [r, g, b(, a)] in 0..255.
function page(w, h, fn, wrap = true, linear = false) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = ((h - 1 - y) * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] ?? 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Periodic value noise in 0..1 on a cx x cy lattice.
function vnoise(w, h, cx, cy, R) {
  const g = Array.from({ length: cx * cy }, () => R());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cx, fy = (y / h) * cy;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const sx = ease(fx - x0), sy = ease(fy - y0);
      const G = (i, j) => g[((y0 + j) % cy) * cx + ((x0 + i) % cx)];
      const top = lerp(G(0, 0), G(1, 0), sx), bot = lerp(G(0, 1), G(1, 1), sx);
      out[y * w + x] = lerp(top, bot, sy);
    }
  }
  return out;
}

// Short straight marks (scratches, fur) into a wrap-around mask.
function marks(S, R, count, min, max, slope = 0) {
  const m = new Uint8Array(S * S);
  for (let k = 0; k < count; k++) {
    const x = Math.floor(R() * S), y = Math.floor(R() * S), len = min + Math.floor(R() * (max - min));
    const s = slope && R() < 0.5 ? slope : 0;
    for (let j = 0; j < len; j++) m[((y + Math.floor(j * s)) % S) * S + ((x + j) % S)] = 1;
  }
  return m;
}

function metalPage(ramp, seed, base = 0.5, wear = 0.3) {
  const S = 64, R = mulberry32(seed);
  const soft = vnoise(S, S, 4, 4, R), brush = vnoise(S, S, 2, 32, R), blot = vnoise(S, S, 8, 8, R);
  const scr = marks(S, R, 9, 4, 12, 0.3);
  return page(S, S, (x, y) => {
    const i = y * S + x;
    let v = base + (soft[i] - 0.5) * 0.22 + (brush[i] - 0.5) * 0.12;
    if (blot[i] > 1 - wear * 0.5) v += 0.1;   // rubbed bright
    if (blot[i] < 0.13) v -= 0.14;            // grime in clusters
    if (scr[i]) v += 0.2;
    return pick(ramp, v);
  });
}

// Painted enamel: chipped to the iron in places, with rust weeps and scratches.
function enamelPage(ramp, seed) {
  const S = 64, R = mulberry32(seed);
  const soft = vnoise(S, S, 3, 3, R), fine = vnoise(S, S, 12, 12, R), chip = vnoise(S, S, 9, 9, R);
  const weep = new Float32Array(S * S);
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(R() * S), y0 = Math.floor(R() * S), len = 8 + R() * 26;
    for (let t = 0; t < len; t++) weep[((y0 + t) % S) * S + x] = 1 - t / len;
  }
  const scr = marks(S, R, 7, 3, 9, 0.4);
  return page(S, S, (x, y) => {
    const i = y * S + x, c = chip[i];
    if (c > 0.84) return pick(RAMP.iron, c > 0.88 ? 0.3 : 0.55);
    let v = 0.6 + (soft[i] - 0.5) * 0.2 + (fine[i] > 0.7 ? 0.05 : fine[i] < 0.3 ? -0.05 : 0);
    if (c > 0.81) v -= 0.14;   // the broken edge of the paint
    v -= weep[i] * 0.16;
    if (scr[i]) v += 0.14;
    return pick(ramp, v);
  });
}

function brickPage(seed) {
  const S = 64, R = mulberry32(seed), n = vnoise(S, S, 8, 8, R);
  const tone = Array.from({ length: 32 }, () => 0.34 + R() * 0.3);
  return page(S, S, (x, y) => {
    const row = y >> 3, off = row & 1 ? 8 : 0, col = ((x + off) >> 4) & 3, i = y * S + x;
    if (y % 8 === 7 || (x + off) % 16 === 15) return pick(RAMP.mortar, 0.25 + n[i] * 0.35);
    let v = tone[(row * 4 + col) % 32] + (n[i] - 0.5) * 0.25;
    if (y % 8 === 0) v += 0.12;
    return pick(RAMP.brick, v);
  });
}

function woodPage(seed) {
  const R = mulberry32(seed), g = vnoise(32, 64, 16, 3, R), tone = [0.45, 0.55, 0.4, 0.5].map((v) => v + R() * 0.1);
  return page(32, 64, (x, y) => {
    if (x % 8 === 7) return pick(RAMP.wood, 0.12);
    return pick(RAMP.wood, tone[x >> 3] + (g[y * 32 + x] - 0.5) * 0.3 + (x % 8 === 0 ? 0.1 : 0));
  });
}

function leatherPage(seed) {
  const R = mulberry32(seed), n = vnoise(32, 32, 6, 6, R);
  return page(32, 32, (x, y) => {
    let v = 0.5 + (n[y * 32 + x] - 0.5) * 0.35;
    if (y % 8 === 0) v -= 0.32;
    else if (y % 8 === 1) v += 0.22;   // the pleat's lit lip
    return pick(RAMP.leather, v);
  });
}

// Moth-eaten felt: fur strokes, threadbare patches and holes with fluffy rims.
function plushPage(seed) {
  const S = 64, R = mulberry32(seed), a = vnoise(S, S, 4, 4, R), b = vnoise(S, S, 16, 16, R);
  const holes = Array.from({ length: 6 }, () => [R() * S, R() * S, 1.2 + R() * 1.6]);
  const fur = marks(S, R, 60, 2, 4, 0.5);
  return page(S, S, (x, y) => {
    const i = y * S + x;
    let v = 0.55 + (a[i] - 0.5) * 0.3 + (b[i] > 0.7 ? 0.08 : b[i] < 0.3 ? -0.08 : 0);
    if (fur[i]) v -= 0.12;
    for (const [hx, hy, hr] of holes) {
      const d = Math.hypot(x - hx, y - hy);
      if (d < hr) return pick(RAMP.plush, 0);
      if (d < hr + 1.3) v += 0.22;
    }
    return pick(RAMP.plush, v);
  });
}

function glazePage(seed) {
  const R = mulberry32(seed), n = vnoise(32, 32, 4, 4, R), cr = marks(32, R, 5, 3, 8, 0.5);
  return page(32, 32, (x, y) => {
    let v = 0.62 + (n[y * 32 + x] - 0.5) * 0.2;
    if (x === 5 || x === 6) v += 0.2;
    if (cr[y * 32 + x]) v -= 0.18;
    return pick(RAMP.porcelain, v);
  });
}

function hazardPage(seed) {
  const R = mulberry32(seed), n = vnoise(32, 32, 4, 4, R);
  return page(32, 32, (x, y) => {
    const v = n[y * 32 + x];
    return ((x + y) >> 3) & 1 ? pick(RAMP.hazard, 0.6 + (v - 0.5) * 0.7) : pick(RAMP.soot, 0.5 + (v - 0.5));
  });
}

// Gauge face: cream with ticks and a red zone; the needle is geometry.
function dialPage() {
  return page(32, 32, (x, y) => {
    const dx = x + 0.5 - 16, dy = y + 0.5 - 16, r = Math.hypot(dx, dy) / 16, a = Math.atan2(dx, -dy);
    if (r > 0.92 || r < 0.13) return [30, 26, 22];
    if (r > 0.64 && r < 0.86) {
      for (let k = 0; k <= 10; k++) if (Math.abs(a - (-2.3 + k * 0.46)) < 0.08) return [36, 30, 26];
      if (a > 1.25 && a < 2.3 && r > 0.72) return [150, 40, 30];
    }
    return pick(RAMP.cream, 0.82 - r * 0.25 + dith(x, y) * 0.1);
  }, false);
}

// The teleporter pads' top: brass rings, a copper star inlay, engraved ticks.
function padPage() {
  const S = 64;
  return page(S, S, (x, y) => {
    const dx = x + 0.5 - 32, dy = y + 0.5 - 32, r = Math.hypot(dx, dy) / 32, a = Math.atan2(dy, dx);
    const lit = (-dx - dy) / 90, d = dith(x, y) * 0.1;
    if (r < 0.13) return pick(RAMP.copper, 0.72 - r * 2 + lit + d);
    if (r < 0.155 || (r > 0.585 && r < 0.615) || (r > 0.83 && r < 0.855)) return pick(RAMP.brass, 0.06);
    if (r < 0.585) {
      const star = 0.16 + 0.42 * Math.pow(Math.abs(Math.cos(a * 4)), 5);
      const star2 = 0.16 + 0.26 * Math.pow(Math.abs(Math.cos(a * 4 + Math.PI / 4)), 5);
      if (r < star) return pick(RAMP.copper, 0.6 + lit + d);
      if (r < star2) return pick(RAMP.copper, 0.4 + lit + d);
      return pick(RAMP.brass, 0.42 + lit + d);
    }
    if (r < 0.83) {
      const tick = Math.abs(((a / TAU) * 32 + 64) % 1 - 0.5) > 0.42;
      return pick(RAMP.brass, (tick ? 0.18 : 0.56) + lit + d);
    }
    return pick(RAMP.brass, 0.66 + lit + d);
  }, false);
}

// A chromatrope slide: a painted-glass spiral that swirls when it turns.
function chromaPage() {
  const C = [[150, 52, 40], [196, 150, 64], [52, 82, 150], [60, 130, 82]];
  return page(32, 32, (x, y) => {
    const dx = x + 0.5 - 16, dy = y + 0.5 - 16, r = Math.hypot(dx, dy) / 16, a = Math.atan2(dy, dx);
    if (r > 0.86) return pick(RAMP.brass, 0.6 - (dx + dy) / 60);
    if (r < 0.14) return pick(RAMP.brass, 0.5);
    const band = Math.floor(((a / TAU) * 3 + r * 2.4) * 4 + 64) % 4;
    return scaleRGB(C[band], 0.8 + 0.25 * (1 - r));
  }, false);
}

function coilPage() {
  return page(16, 32, (x, y) => pick(RAMP.copper, [0.18, 0.82, 0.55][y % 3] + (x === 3 || x === 4 ? 0.14 : x > 10 ? -0.14 : 0)));
}

function firePage(seed) {
  const R = mulberry32(seed), A = vnoise(32, 32, 5, 2, R), B = vnoise(32, 32, 10, 5, R);
  return page(32, 32, (x, y) => { const i = y * 32 + x; return pick(RAMP.fire, (A[i] * 0.65 + B[i] * 0.35 - 0.22) * 1.9); });
}

// A projector beam: bright at the lens (v = 1), fading, with streaks around it.
function beamPage() {
  const R = mulberry32(171), streak = Array.from({ length: 32 }, () => 0.5 + 0.5 * R());
  return page(32, 64, (x, y) => {
    const u = 1 - y / 64, k = (Math.pow(u, 1.5) * 0.9 + 0.1 * u) * streak[x];
    return [255 * k, 238 * k, 206 * k].map(Math.round);
  }, true, true);
}

// A soft round glow for additive sprites and points.
function dotPage() {
  return page(32, 32, (x, y) => {
    const a = Math.max(0, 1 - Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16);
    return [255, 255, 255, Math.round(255 * a * a)];
  }, false, true);
}

// --- Sign lettering ----------------------------------------------------------------------------
// A 5 x 7 pixel font (two hex digits per row, 5 bits wide), drawn as lit tubes.

const FONT = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1e11111111111e', E: '1f10101e10101f',
  F: '1f10101e101010', G: '0e11101711110f', H: '1111111f111111', I: '0e04040404040e', J: '0702020202120c',
  K: '11121418141211', L: '1010101010101f', M: '111b1515111111', N: '11111915131111', O: '0e11111111110e',
  P: '1e11111e101010', Q: '0e11111115120d', R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404',
  U: '1111111111110e', V: '11111111110a04', W: '1111111515150a', X: '11110a040a1111', Y: '11110a04040404',
  Z: '1f01020408101f', 0: '0e11131519110e', 1: '040c040404040e', 2: '0e11010204081f', 3: '1e01010e01011e',
  4: '02060a121f0202', 5: '1f101e0101110e', 6: '0608101e11110e', 7: '1f010204080808', 8: '0e11110e11110e',
  9: '0e11110f01020c', '-': '0000001f000000', '.': '00000000000c0c', '!': '04040404040004', ' ': '00000000000000',
};

/**
 * A sign atlas: lit tubes on a dark backing. `regions` are { rect: [x, y, w, h]
 * (top-left origin), lines: [{ text, y, s (pixel scale), gap, vertical }],
 * bulbs } and each gets a UV rectangle. Returns { map, emissive, uvs }.
 */
function signAtlas(N, regions, tube) {
  const m = new Uint8Array(N * N); // 1 tube, 3 bulb, 4 border
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < N && y < N) m[y * N + x] = v; };
  const glyph = (ch, x0, y0, s) => {
    const g = FONT[ch] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = parseInt(g.substr(row * 2, 2), 16);
      for (let col = 0; col < 5; col++) {
        if ((bits >> (4 - col)) & 1) for (let k = 0; k < s * s; k++) set(x0 + col * s + (k % s), y0 + row * s + Math.floor(k / s), 1);
      }
    }
  };
  const uvs = [];
  for (const r of regions) {
    const [rx, ry, rw, rh] = r.rect;
    for (let x = rx; x < rx + rw; x++) { set(x, ry, 4); set(x, ry + rh - 1, 4); }
    for (let y = ry; y < ry + rh; y++) { set(rx, y, 4); set(rx + rw - 1, y, 4); }
    if (r.bulbs) {
      for (let x = rx + 3; x < rx + rw - 2; x += 5) { set(x, ry + 2, 3); set(x, ry + rh - 3, 3); }
      for (let y = ry + 7; y < ry + rh - 6; y += 5) { set(rx + 2, y, 3); set(rx + rw - 3, y, 3); }
    }
    for (const L of r.lines) {
      const s = L.s ?? 2, gap = L.gap ?? s, n = L.text.length, gw = 5 * s, gh = 7 * s;
      if (L.vertical) {
        const step = gh + gap * 2, total = n * step - gap * 2;
        const x0 = rx + Math.round((rw - gw) / 2), y0 = ry + (L.y ?? Math.round((rh - total) / 2));
        for (let i = 0; i < n; i++) glyph(L.text[i], x0, y0 + i * step, s);
      } else {
        const total = n * gw + (n - 1) * gap;
        const x0 = rx + Math.round((rw - total) / 2), y0 = ry + (L.y ?? Math.round((rh - gh) / 2));
        for (let i = 0; i < n; i++) glyph(L.text[i], x0 + i * (gw + gap), y0, s);
      }
    }
    uvs.push([rx / N, 1 - (ry + rh) / N, (rx + rw) / N, 1 - ry / N]);
  }
  const halo = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m[(y + dy) * N + x + dx] === 1) return true;
    return false;
  };
  const back = mixRGB([20, 19, 21], tube, 0.07);
  const map = page(N, N, (x, y) => {
    const v = m[y * N + x];
    if (v === 1) return scaleRGB(mixRGB(tube, [255, 255, 255], 0.2), 0.6);
    if (v === 3) return [196, 186, 156];
    if (v === 4) return pick(RAMP.steel, 0.55);
    return halo(x, y) ? mixRGB(back, tube, 0.2) : scaleRGB(back, 1 + dith(x, y) * 0.3);
  }, false);
  const emissive = page(N, N, (x, y) => {
    const v = m[y * N + x];
    if (v === 1) return tube;
    if (v === 3) return [255, 206, 140];
    return halo(x, y) ? scaleRGB(tube, 0.32) : [0, 0, 0];
  }, false);
  return { map, emissive, uvs };
}

// --- Shared kit --------------------------------------------------------------------------------

let KIT = null;

function kit() {
  if (KIT) return KIT;
  const T = {
    steel: metalPage(RAMP.steel, 101, 0.5, 0.35),
    iron: metalPage(RAMP.iron, 103, 0.55, 0.2),
    brass: metalPage(RAMP.brass, 107, 0.55, 0.4),
    copper: metalPage(RAMP.copper, 109, 0.55, 0.35),
    cream: enamelPage(RAMP.cream, 113),
    porcelain: glazePage(127),
    brick: brickPage(131),
    wood: woodPage(137),
    leather: leatherPage(139),
    plush: plushPage(149),
    hazard: hazardPage(151),
    fire: firePage(157),
    dial: dialPage(),
    pad: padPage(),
    chroma: chromaPage(),
    coil: coilPage(),
    beam: beamPage(),
    dot: dotPage(),
  };
  const phong = (name, map, specular, shininess) => Object.assign(new THREE.MeshPhongMaterial({ map, vertexColors: true, flatShading: true, specular, shininess }), { name });
  const lambert = (name, map) => Object.assign(new THREE.MeshLambertMaterial({ map, vertexColors: true, flatShading: true }), { name });
  KIT = {
    T,
    steel: phong('mSteel', T.steel, 0x2c2c2c, 20),
    iron: lambert('mIron', T.iron),
    brass: phong('mBrass', T.brass, 0x4a3a1c, 18),
    copper: phong('mCopper', T.copper, 0x40261a, 16),
    cream: phong('mCream', T.cream, 0x262420, 24),
    porcelain: phong('mPorcelain', T.porcelain, 0x3c3c3a, 36),
    brick: lambert('mBrick', T.brick),
    wood: lambert('mWood', T.wood),
    leather: lambert('mLeather', T.leather),
    plush: lambert('mPlush', T.plush),
    hazard: lambert('mHazard', T.hazard),
    dial: lambert('mDial', T.dial),
    pad: phong('mPad', T.pad, 0x4a3a1c, 18),
    chroma: lambert('mChroma', T.chroma),
    glass: Object.assign(new THREE.MeshPhongMaterial({
      color: 0x6a8088, transparent: true, opacity: 0.13, depthWrite: false, specular: 0x404040, shininess: 70, flatShading: true,
    }), { name: 'mGlass' }),
  };
  return KIT;
}

// A painted part that also glows through `emissiveMap` (intensity driven by state).
function litMat(map, emissiveMap) {
  return new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0, vertexColors: true, flatShading: true });
}

// Lamp glass and glowing bits: unlit colour, set per frame.
function lampMat(hex = 0x101010, vertexColors = true) {
  return new THREE.MeshBasicMaterial({ color: hex, vertexColors });
}

// Additive light (beams, rays, flashes): brightness through opacity.
function addMat(map, hex) {
  return new THREE.MeshBasicMaterial({
    map, color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
}

function glowSprite(hex, sx, sy) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: kit().T.dot, color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  s.scale.set(sx, sy, 1);
  return s;
}

// --- Geometry helpers --------------------------------------------------------------------------

const F1 = [1, 1, 1], F2 = [2, 2, 2];
const KEYS = ['enamel', 'steel', 'iron', 'brass', 'copper', 'cream', 'porcelain', 'brick', 'wood', 'leather', 'plush',
  'hazard', 'dial', 'pad', 'chroma', 'coil', 'sign', 'glow', 'glass', 'bottle', 'fire', 'hot', 'ring', 'lens', 'lamp'];
const NO_AO = new Set(['sign', 'glow', 'glass', 'bottle', 'fire', 'ring', 'lens', 'lamp', 'coil']);

const newBatch = () => new Batch(Object.fromEntries(KEYS.map((k) => [k, true])));

function shadeGeo(g, fn) {
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

// Painted light (art/STYLE.md): occlusion toward the floor, a little lift up top.
const floorAO = (x, y) => (0.6 + 0.4 * smooth(0, 0.8, y)) * (0.94 + 0.1 * smooth(1.0, 2.2, y));

// Build a batch's geometry once: { materialKey: BufferGeometry }.
function bake(batch, ao = floorAO) {
  const out = {};
  for (const [k, b] of Object.entries(batch.builders)) {
    if (b.empty) continue;
    const g = b.build();
    if (ao && !NO_AO.has(k)) shadeGeo(g, ao);
    out[k] = g;
  }
  return out;
}

function addMeshes(parent, geos, mats) {
  const out = {};
  for (const [k, g] of Object.entries(geos)) {
    if (!mats[k]) throw new Error(`machines: no material for ${k}`);
    const m = new THREE.Mesh(g, mats[k]);
    m.name = k;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    parent.add(m);
    out[k] = m;
  }
  return out;
}

const CACHE = new Map();
const once = (key, fn) => { if (!CACHE.has(key)) CACHE.set(key, fn()); return CACHE.get(key); };

const cbox = (g, sx, sy, sz, b, m, c = 1, fit = F1) => g.geo(chamferBox(sx, sy, sz, b, fit), m, c);

/** A quad w x h facing +Z, UVs over r = [u0, v0, u1, v1]. */
function quadGeo(w, h, r = [0, 0, 1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(r[0], r[2], uv.getX(i)), lerp(r[1], r[3], uv.getY(i)));
  return g;
}

/** A flat polygon facing +Z; a page spans `span` metres across it, centred, so it keeps its aspect. */
function polyGeo(pts, span) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + (p.getX(i) - cx) / span, 0.5 + (p.getY(i) - cy) / span);
  return g;
}

/** n points round a circle of radius r (x, y), the first at angle `rot` from +y. */
const ngon = (r, n, rot = Math.PI / n) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TAU;
  return [Math.sin(a) * r, Math.cos(a) * r];
});

/** A convex outline (x, y) extruded d along z, centred. */
const slab = (pts, d, fit = F1) => hull(pts.flatMap(([x, y]) => [V3(x, y, -d / 2), V3(x, y, d / 2)]), fit);

/** A polygonal ring in the XY plane (bezels, collars), depth d along z, merged into g at m. */
function ring(g, m, rIn, rOut, d, n, c, rot = Math.PI / n) {
  for (let i = 0; i < n; i++) {
    const pts = [];
    for (const a of [rot + (i / n) * TAU, rot + ((i + 1) / n) * TAU]) {
      for (const r of [rIn, rOut]) for (const z of [-d / 2, d / 2]) pts.push(V3(Math.sin(a) * r, Math.cos(a) * r, z));
    }
    g.geo(hull(pts), m, c);
  }
}

/** A bar from 2D point a to b in m's XY plane, t thick, standing d out along +Z. */
function bar(g, m, a, b, t, d, c, ext = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  g.tbox(at(m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / 2, 0, 0, Math.atan2(dy, dx)), Math.hypot(dx, dy) + ext, t, d, c, 0.5);
}

/** A square bar t thick from point a to point b (Vector3s). */
function rod(g, a, b, t, c) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), d.normalize()), V3(1, 1, 1));
  g.tbox(m, len, t, t, c, 0.5);
}

/** Bars round a closed outline, pushed out by half their thickness. */
function outline(g, m, pts, t, d, c) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    let nx = b[1] - a[1], ny = a[0] - b[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const o = t / 2;
    bar(g, m, [a[0] + nx * o, a[1] + ny * o], [b[0] + nx * o, b[1] + ny * o], t, d, c, t);
  });
}

/** Four bars round a w x h rectangle, standing d out along +Z. */
function frame(g, m, w, h, t, d, c) {
  outline(g, m, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], t, d, c);
}

let PARTS = null;
// Small shared parts: rivets and bolts point along +Y.
function parts() {
  if (!PARTS) {
    PARTS = {
      rivet: prism(0.011, 0.019, 0.016, 6),
      bolt: prism(0.022, 0.022, 0.022, 6),
      bulb: hull([...ngon(0.034, 6).map(([x, z]) => V3(x, 0, z)), ...ngon(0.028, 6).map(([x, z]) => V3(x, 0.03, z)), V3(0, 0.048, 0)]),
    };
  }
  return PARTS;
}
const rivetZ = (g, m, c = 1.1) => g.geo(parts().rivet, at(m, 0, 0, 0, 0, Math.PI / 2), c);
const boltZ = (g, m, c = 1.1) => g.geo(parts().bolt, at(m, 0, 0, 0, 0, Math.PI / 2), c);

/** A faceted bottle turned from a profile [[r, y], ...]; v runs up its height. */
function bottleGeo(profile) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 8).toNonIndexed();
  g.computeVertexNormals();
  const p = g.attributes.position, uv = g.attributes.uv, top = Math.max(...profile.map((q) => q[1]));
  for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / top);
  return g;
}

// --- Animation helpers ---------------------------------------------------------------------------

/**
 * A lamp or neon tube's brightness 0..1: stutters when switched on, hums, and
 * now and then sputters. Calm (reduce flashing) turns every stutter into a
 * soft fade and a sputter into a shallow dip.
 */
class Neon {
  constructor(seed, { boot = 0.8, sputter = 0.35, hum = 0.06 } = {}) {
    this.seed = seed;
    this.R = mulberry32(seed * 7919 + 1);
    this.on = false;
    this.v = 0;
    this.bootT = 0;
    this.boot = boot;
    this.sputter = sputter;
    this.hum = hum;
    this.next = 3 + this.R() * 9;
    this.sput = 0;
  }

  set(on) {
    on = !!on;
    if (on && !this.on) this.bootT = this.boot;
    this.on = on;
  }

  step(dt, t, calm) {
    let target = 0;
    if (this.on) {
      target = 1 - this.hum * (0.5 + 0.5 * Math.sin(t * 5.3 + this.seed) * Math.sin(t * 1.9 + this.seed * 1.7));
      if (this.bootT > 0) {
        this.bootT -= dt;
        const u = 1 - Math.max(0, this.bootT) / this.boot;
        target *= calm ? u : hash(Math.floor(t * 16) + this.seed) < 0.2 + u * 0.75 ? 1 : 0.06;
      } else if (this.sputter > 0) {
        this.next -= dt;
        if (this.next <= 0) { this.sput = this.sputter; this.next = 5 + this.R() * 11; }
        if (this.sput > 0) {
          this.sput -= dt;
          const u = 1 - Math.max(0, this.sput) / this.sputter;
          target *= calm ? 1 - 0.15 * Math.sin(Math.PI * u) : hash(Math.floor(t * 24) + this.seed * 3) < 0.45 ? 0.12 : 1;
        }
      }
    }
    const rate = calm ? 5 : target > this.v ? 40 : 25;
    this.v += (target - this.v) * Math.min(1, dt * rate);
    if (!this.on && this.v < 0.004) this.v = 0;
    return this.v;
  }
}

/** Sparks as short additive streaks (one pixel wide in the low-res frame), in the parent's space. */
class Sparks {
  constructor(cap = 64, color = [1, 0.72, 0.32]) {
    this.cap = cap;
    this.n = 0;
    this.color = color;
    this.p = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.pos = new Float32Array(cap * 6);
    this.col = new Float32Array(cap * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sparks';
  }

  emit(x, y, z, vx, vy, vz, life) {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.life[i] = this.max[i] = life;
  }

  // n sparks from (x, y, z), thrown along dir (roughly) at `speed`.
  burst(n, x, y, z, dir, speed, spread = 1) {
    for (let k = 0; k < n; k++) {
      const s = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z,
        (dir[0] + (Math.random() - 0.5) * spread) * s, (dir[1] + Math.random() * 0.6 * spread) * s, (dir[2] + (Math.random() - 0.5) * spread) * s,
        0.25 + Math.random() * 0.45);
    }
  }

  update(dt) {
    let n = this.n;
    const P = this.p, V = this.v;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) {
          P.copyWithin(i * 3, n * 3, n * 3 + 3);
          V.copyWithin(i * 3, n * 3, n * 3 + 3);
          this.life[i] = this.life[n];
          this.max[i] = this.max[n];
        }
        i--;
        continue;
      }
      V[i * 3 + 1] -= 9.8 * dt;
      for (let k = 0; k < 3; k++) P[i * 3 + k] += V[i * 3 + k] * dt;
      if (P[i * 3 + 1] < 0.01) { P[i * 3 + 1] = 0.01; V[i * 3] *= 0.4; V[i * 3 + 1] *= -0.3; V[i * 3 + 2] *= 0.4; }
    }
    this.n = n;
    const [r, g, b] = this.color;
    for (let i = 0; i < n; i++) {
      const u = this.life[i] / this.max[i];
      for (let k = 0; k < 3; k++) {
        this.pos[i * 6 + k] = P[i * 3 + k];
        this.pos[i * 6 + 3 + k] = P[i * 3 + k] - V[i * 3 + k] * 0.03;
      }
      const hot = u * u;
      this.col.set([r + hot * 0.3, g * u + hot * 0.3, b * u * u + hot * 0.3, r * 0.5 * u, g * 0.3 * u, b * 0.2 * u], i * 6);
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}

// ==============================================================================================
// Perk machines
// ==============================================================================================
// Four original 1950s-60s vending machines. Each look builds its cabinet into a
// batch and returns where its bottles stand, where a dispensed bottle lands
// (slot), where the light hangs, its depth and height.

// The dispenser: a dark mouth under a hood, and the tray a bottle rolls out onto.
function dispenser(b, x, y, zf, w = 0.34, h = 0.2) {
  const S = b.get('steel');
  S.tbox(mat(x, y + h / 2, zf + 0.003), w, h, 0.006, 0.05, 1);                          // the dark mouth
  cbox(S, w + 0.08, 0.035, 0.18, 0.01, mat(x, y + 0.0175, zf + 0.09), 0.72);             // tray floor
  S.tbox(mat(x, y + 0.05, zf + 0.175), w + 0.08, 0.07, 0.015, 0.62, 1);                  // tray lip
  for (const s of [-1, 1]) cbox(S, 0.035, h + 0.05, 0.18, 0.008, mat(x + s * (w / 2 + 0.0225), y + h / 2 + 0.01, zf + 0.09), 0.66);
  cbox(S, w + 0.12, 0.07, 0.2, 0.02, mat(x, y + h + 0.035, zf + 0.1), 0.9);              // hood
  return { x, y: y + 0.035, z: zf + 0.09, zIn: zf - 0.14, yIn: y + h * 0.6 };
}

const SHIELD = [[-0.13, 0.16], [0.13, 0.16], [0.13, 0.02], [0.07, -0.1], [0, -0.17], [-0.07, -0.1], [-0.13, 0.02]];

// Ironclad Tonic: a squat riveted safe with side armour, a domed crown and a
// bolted porthole.
function lookIronclad(b, sign) {
  const W = 1.22, D = 0.84, zf = D / 2;
  const E = b.get('enamel'), S = b.get('steel');
  cbox(S, W + 0.1, 0.1, D + 0.1, 0.025, mat(0, 0.05, 0), 0.4);
  cbox(E, W, 1.5, D, 0.06, mat(0, 0.85, 0), 1, F2);
  cbox(S, W + 0.1, 0.36, D + 0.08, 0.05, mat(0, 1.78, 0), 0.62);
  const dome = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU, c = Math.cos(a), s = Math.sin(a);
    dome.push(V3(c * 0.6, 0, s * 0.42), V3(c * 0.53, 0.17, s * 0.37), V3(c * 0.36, 0.33, s * 0.25), V3(c * 0.13, 0.42, s * 0.09));
  }
  E.geo(hull(dome, F2), mat(0, 1.96, 0), 1.05);
  // a riveted comb over the crown, front to back, like a helmet's
  const comb = mat(0, 2.2, 0, Math.PI / 2);
  S.geo(slab([[-0.36, 0], [0.36, 0], [0.26, 0.2], [0.08, 0.27], [-0.08, 0.27], [-0.26, 0.2]], 0.06), comb, 0.7);
  for (const x of [-0.2, 0, 0.2]) for (const s of [-1, 1]) S.geo(parts().rivet, at(comb, x, 0.13, s * 0.03, 0, s * Math.PI / 2), 1.1);
  // the name in a heavy bolted frame on the cornice
  const zs = (D + 0.08) / 2;
  b.get('sign').geo(quadGeo(1.08, 0.27, sign.uvs[0]), mat(0, 1.78, zs + 0.004), 0.3);
  frame(S, mat(0, 1.78, zs), 1.08, 0.27, 0.035, 0.04, 0.9);
  for (const x of [-0.585, 0.585]) boltZ(S, mat(x, 1.78, zs + 0.045));
  // bands with rivet rows
  for (const y of [0.24, 1.52]) {
    cbox(S, W + 0.04, 0.09, 0.03, 0.01, mat(0, y, zf + 0.012), 0.72);
    for (let x = -0.54; x <= 0.55; x += 0.12) rivetZ(S, mat(x, y, zf + 0.03));
  }
  // side armour: riveted plates with a shield boss
  for (const s of [-1, 1]) {
    cbox(S, 0.05, 1.28, 0.66, 0.015, mat(s * (W / 2 + 0.02), 0.85, 0), 0.6);
    for (let y = 0.28; y < 1.5; y += 0.3) for (const z of [-0.29, 0.29]) S.geo(parts().rivet, mat(s * (W / 2 + 0.05), y, z, 0, 0, -s * Math.PI / 2), 1.1);
    E.geo(slab(SHIELD, 0.03), mat(s * (W / 2 + 0.06), 0.95, 0, s * Math.PI / 2), 0.85);
  }
  // porthole: a deep bolted bezel round the lit window
  const wy = 1.03, port = ngon(0.28, 8);
  ring(S, mat(0, wy, zf + 0.09), 0.27, 0.37, 0.18, 8, 0.8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    boltZ(S, mat(Math.sin(a) * 0.32, wy + Math.cos(a) * 0.32, zf + 0.19));
  }
  b.get('glow').geo(polyGeo(port, 0.62), mat(0, wy, zf + 0.004), 0.18);
  b.get('glass').geo(polyGeo(port, 0.62), mat(0, wy, zf + 0.17), 1);
  S.tbox(mat(0, 0.845, zf + 0.08), 0.46, 0.02, 0.15, 0.7, 1);
  const slot = dispenser(b, 0, 0.4, zf, 0.36, 0.19);
  const bz = zf + 0.085;
  return { bottles: [[-0.14, 0.855, bz], [0, 0.855, bz], [0.14, 0.855, bz]], slot, light: [0, 1.05, zf + 0.5], depth: D, height: 2.48 };
}

// Lazarus Draught: tall and narrow under a pointed gable with a rose window,
// a tall arched window, and a blade sign standing off the front corner.
function lookLazarus(b, sign) {
  const W = 0.8, D = 0.7, zf = D / 2;
  const E = b.get('enamel'), S = b.get('steel');
  cbox(S, W + 0.1, 0.12, D + 0.1, 0.025, mat(0, 0.06, 0), 0.4);
  cbox(E, W, 1.72, D, 0.04, mat(0, 0.98, 0), 1, F2);
  E.geo(slab([[-0.4, 0], [0.4, 0], [0.4, 0.14], [0, 0.52], [-0.4, 0.14]], D, F2), mat(0, 1.84, 0), 1.02);
  for (const s of [-1, 1]) S.tbox(mat(s * 0.2, 2.175, 0, 0, 0, -s * 0.76), 0.6, 0.05, D + 0.04, 0.8, 1);
  S.geo(prism(0.05, 0.05, 0.06, 6), mat(0, 2.39, 0), 0.9);
  S.geo(prism(0.0, 0.04, 0.22, 4), mat(0, 2.53, 0), 1);
  // rose window in the gable
  const ry = 2.07;
  b.get('glow').geo(polyGeo(ngon(0.11, 8), 0.3), mat(0, ry, zf + 0.004), 0.18);
  ring(S, mat(0, ry, zf + 0.02), 0.105, 0.14, 0.04, 8, 0.85);
  for (let k = 0; k < 3; k++) S.tbox(mat(0, ry, zf + 0.014, 0, 0, (k * Math.PI) / 3 + Math.PI / 6), 0.22, 0.012, 0.012, 0.6, 1);
  // tall arched window in a deep frame
  const wy = 0.8, arch = [[-0.2, 0], [0.2, 0], [0.2, 0.72], [0, 0.92], [-0.2, 0.72]];
  b.get('glow').geo(polyGeo(arch, 0.92), mat(0, wy, zf + 0.004), 0.18);
  b.get('glass').geo(polyGeo(arch, 0.92), mat(0, wy, zf + 0.15), 1);
  outline(S, mat(0, wy, zf), arch, 0.045, 0.16, 0.8);
  cbox(S, 0.54, 0.05, 0.2, 0.012, mat(0, wy - 0.03, zf + 0.09), 0.72);
  S.geo(prism(0.06, 0.07, 0.16, 6), mat(0, wy + 0.08, zf + 0.085), 0.66);
  b.get('sign').geo(quadGeo(0.4, 0.067, sign.uvs[1]), mat(0, 1.8, zf + 0.004), 0.3);
  // the blade sign off the front-left corner, turned to the room
  const bm = mat(-0.57, 1.3, zf - 0.07, -0.55);
  cbox(S, 0.3, 1.2, 0.08, 0.02, bm, 0.75);
  S.geo(slab([[-0.15, 0], [0.15, 0], [0, 0.18]], 0.08), at(bm, 0, 0.6, 0), 0.75);
  S.geo(slab([[-0.15, 0], [0.15, 0], [0, -0.12]], 0.08), at(bm, 0, -0.6, 0), 0.75);
  S.geo(prism(0.0, 0.03, 0.14, 4), at(bm, 0, 0.84, 0), 1);
  b.get('sign').geo(quadGeo(0.2, 1.07, sign.uvs[0]), at(bm, 0, 0, 0.042), 0.3);
  frame(S, at(bm, 0, 0, 0.04), 0.2, 1.07, 0.025, 0.02, 0.9);
  for (const y of [0.42, -0.42]) S.tbox(at(bm, 0.18, y, -0.03), 0.14, 0.05, 0.03, 0.6, 1);
  const slot = dispenser(b, 0, 0.36, zf, 0.3, 0.19);
  const bz = zf + 0.08;
  return { bottles: [[-0.12, wy + 0.02, bz, 0.9], [0, wy + 0.16, bz, 1.05], [0.12, wy + 0.02, bz, 0.9]], slot, light: [0, 1.25, zf + 0.5], depth: D, height: 2.64 };
}

// Quicksilver Cola: a streamlined two-tone cabinet with a raked face, tail fins,
// chrome spears, a bulb-lit roof sign and a silver mercury-drop badge.
function lookQuicksilver(b, sign) {
  const W = 1.0, D = 0.76, E = b.get('enamel'), S = b.get('steel'), C = b.get('cream');
  const zAt = (y) => 0.38 - (y - 0.1) * 0.105, rake = Math.atan(0.105);
  const sect = (y, i = 0) => {
    const h = W / 2 - i, zf = zAt(y) - i, zb = -D / 2 + i, c = 0.07;
    return [[-h, zb + c], [-h + c, zb], [h - c, zb], [h, zb + c], [h, zf - c], [h - c, zf], [-h + c, zf], [-h, zf - c]].map(([x, z]) => V3(x, y, z));
  };
  cbox(S, W + 0.08, 0.1, D + 0.08, 0.025, mat(0, 0.05, 0), 0.42);
  C.geo(hull([...sect(0.1), ...sect(0.62)], F2), new THREE.Matrix4(), 1);
  E.geo(hull([...sect(0.62), ...sect(1.8), ...sect(1.9, 0.07)], F2), new THREE.Matrix4(), 1);
  // chrome: the belt line and a spear sweeping up each side
  S.tbox(mat(0, 0.62, zAt(0.62) + 0.01, 0, -rake), W - 0.1, 0.05, 0.03, 1, 1);
  for (const s of [-1, 1]) {
    S.tbox(mat(s * (W / 2 + 0.01), 0.62, -0.02), 0.03, 0.05, D - 0.14, 1, 1);
    S.tbox(mat(s * (W / 2 + 0.012), 1.06, -0.03, 0, 0.2), 0.025, 0.035, 0.64, 1.15, 1);
    // a tail fin flaring out past the cabinet, a chrome leading edge and a lamp in its tip
    E.geo(hull([
      V3(s * 0.45, 1.45, -0.38), V3(s * 0.5, 1.45, -0.38), V3(s * 0.45, 1.86, 0.06), V3(s * 0.5, 1.86, 0.06), V3(s * 0.45, 1.9, -0.38),
      V3(s * 0.6, 2.18, -0.3), V3(s * 0.64, 2.18, -0.3), V3(s * 0.62, 2.18, -0.4), V3(s * 0.66, 2.18, -0.4),
    ], F2), new THREE.Matrix4(), 1.04);
    rod(S, V3(s * 0.51, 1.86, 0.06), V3(s * 0.64, 2.19, -0.3), 0.035, 1.15);
    b.get('glow').geo(prism(0.03, 0.03, 0.08, 6), mat(s * 0.64, 2.19, -0.39, 0, Math.PI / 2), 0.18);
  }
  // the roof sign, tipped back, on two posts
  const sm = mat(0, 2.1, 0.0, 0, -0.18);
  for (const x of [-0.3, 0.3]) S.geo(prism(0.02, 0.02, 0.24, 6), mat(x, 1.95, 0.02), 0.6);
  cbox(S, 0.94, 0.3, 0.14, 0.03, sm, 0.82);
  b.get('sign').geo(quadGeo(0.86, 0.215, sign.uvs[0]), at(sm, 0, 0, 0.072), 0.3);
  // the display window on the raked face
  const wm = mat(0, 1.2, zAt(1.2), 0, -rake), c = 0.07, hw = 0.36, hh = 0.25;
  const win = [[-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c]];
  b.get('glow').geo(polyGeo(win, 0.72), at(wm, 0, 0, 0.004), 0.18);
  b.get('glass').geo(polyGeo(win, 0.72), at(wm, 0, 0, 0.14), 1);
  outline(S, wm, win, 0.045, 0.15, 1);
  S.tbox(at(wm, 0, -0.21, 0.07), 0.66, 0.02, 0.12, 0.75, 1);
  // the mercury-drop badge over the dispenser
  const mm = mat(0, 0.8, zAt(0.8), 0, -rake);
  S.geo(polyGeo(ngon(0.105, 10), 0.22), at(mm, 0, 0, 0.006), 0.2);
  ring(S, at(mm, 0, 0, 0.018), 0.1, 0.13, 0.036, 10, 1.05);
  const drop = [];
  for (let k = 0; k <= 8; k++) {
    const a = -0.72 * Math.PI + (k / 8) * 1.44 * Math.PI;
    drop.push(V3(Math.sin(a) * 0.05, -0.02 - Math.cos(a) * 0.05, 0), V3(Math.sin(a) * 0.043, -0.02 - Math.cos(a) * 0.043, 0.022));
  }
  drop.push(V3(0, 0.085, 0), V3(0, 0.072, 0.022));
  S.geo(hull(drop), at(mm, 0, 0, 0.008), 1.5);
  const slot = dispenser(b, 0, 0.28, zAt(0.28), 0.34, 0.19);
  const bz = zAt(1.05) + 0.08;
  return { bottles: [-0.25, -0.085, 0.085, 0.25].map((x) => [x, 1.0, bz, 0.95]), slot, light: [0, 1.2, 0.8], depth: D, height: 2.34 };
}

// Hair Trigger Stout: a painted steel keg with iron hoops, a stepped crown with
// a sight blade, an arrow-topped marquee, a tap handle and black chevrons.
function lookHairTrigger(b, sign) {
  const E = b.get('enamel'), S = b.get('steel'), Br = b.get('brass');
  const r = 0.56, ap = r * Math.cos(Math.PI / 8);
  S.geo(prism(0.64, 0.66, 0.12, 8), mat(0, 0.06, 0), 0.35);
  E.geo(prism(r, r - 0.05, 0.26, 8, F2), mat(0, 0.25, 0), 0.95);
  E.geo(prism(r, r, 0.9, 8, F2), mat(0, 0.83, 0), 1);
  E.geo(prism(r - 0.05, r, 0.26, 8, F2), mat(0, 1.41, 0), 1.03);
  for (const y of [0.2, 0.62, 1.3]) S.geo(prism(r + 0.02, r + 0.02, 0.07, 8), mat(0, y, 0), 0.28);
  // stepped crown and the sight blade
  S.geo(prism(0.6, 0.6, 0.05, 8), mat(0, 1.565, 0), 0.45);
  E.geo(prism(0.46, 0.5, 0.14, 8, F2), mat(0, 1.66, 0), 1.05);
  S.geo(prism(0.34, 0.37, 0.12, 8), mat(0, 1.79, 0), 0.25);
  E.geo(prism(0.2, 0.23, 0.1, 8, F2), mat(0, 1.9, 0), 1.08);
  // the arrow-topped marquee standing on the crown
  const board = [[-0.42, -0.17], [0.42, -0.17], [0.42, 0.13], [0, 0.31], [-0.42, 0.13]];
  const bm = mat(0, 2.12, 0.06);
  for (const x of [-0.28, 0.28]) S.geo(prism(0.022, 0.022, 0.12, 6), mat(x, 1.9, 0.06), 0.4);
  S.geo(slab(board, 0.05), bm, 0.22);
  outline(Br, at(bm, 0, 0, 0.0), board, 0.03, 0.04, 1.05);
  b.get('sign').geo(quadGeo(0.64, 0.32, sign.uvs[0]), at(bm, 0, -0.01, 0.027), 0.3);
  // arched window on the front stave
  const wy = 0.7, arch = [[-0.16, 0], [0.16, 0], [0.16, 0.36], [0, 0.48], [-0.16, 0.36]];
  b.get('glow').geo(polyGeo(arch, 0.5), mat(0, wy, ap + 0.004), 0.18);
  b.get('glass').geo(polyGeo(arch, 0.5), mat(0, wy, ap + 0.13), 1);
  outline(Br, mat(0, wy, ap), arch, 0.04, 0.14, 0.95);
  S.tbox(mat(0, wy + 0.01, ap + 0.07), 0.3, 0.02, 0.12, 0.7, 1);
  // tap on the right-front stave, chevrons on the left-front one
  const tm = mat(Math.sin(Math.PI / 4) * ap, 0.92, Math.cos(Math.PI / 4) * ap, Math.PI / 4);
  cbox(Br, 0.1, 0.12, 0.07, 0.015, at(tm, 0, 0, 0.035), 1);
  Br.geo(prism(0.018, 0.026, 0.14, 6), at(tm, 0, -0.1, 0.09), 1);
  Br.geo(prism(0.03, 0.03, 0.05, 6), at(tm, 0, 0.08, 0.08), 1.1);
  S.geo(prism(0.02, 0.04, 0.4, 6), at(tm, 0, 0.3, 0.08, 0, -0.1), 0.2);
  cbox(Br, 0.06, 0.06, 0.06, 0.018, at(tm, 0, 0.51, 0.06), 1.15);
  const cm = mat(-Math.sin(Math.PI / 4) * ap, 0.95, Math.cos(Math.PI / 4) * ap, -Math.PI / 4);
  for (const y of [0, 0.15, 0.3]) {
    S.tbox(at(cm, -0.075, y, 0.008, 0, 0, 0.7), 0.2, 0.05, 0.014, 0.18, 1);
    S.tbox(at(cm, 0.075, y, 0.008, 0, 0, -0.7), 0.2, 0.05, 0.014, 0.18, 1);
  }
  const slot = dispenser(b, 0, 0.27, ap, 0.28, 0.18);
  const bz = ap + 0.07;
  return { bottles: [[-0.075, wy + 0.02, bz, 0.9], [0.075, wy + 0.02, bz, 0.9]], slot, light: [0, 1.0, 1.0], depth: 2 * r, height: 2.45 };
}

/**
 * Per-perk look: the cabinet builder, the bottle (profile, cap, label rows on
 * its 16 x 32 page) and the sign atlas regions. perks.js lists the perks; a
 * new perk needs an entry here (see the note at the top of perks.js).
 */
export const PERK_LOOKS = {
  ironclad: {
    build: lookIronclad,
    bottle: [[0, 0], [0.06, 0], [0.074, 0.018], [0.076, 0.1], [0.066, 0.14], [0.036, 0.165], [0.026, 0.18], [0.026, 0.205], [0.032, 0.21], [0.032, 0.232], [0, 0.232]],
    cap: 'iron', capRows: 4, label: [12, 22],
    sign: [{ rect: [0, 0, 128, 32], lines: [{ text: 'IRONCLAD', y: 3 }, { text: 'TONIC', y: 21, s: 1 }] }],
  },
  lazarus: {
    build: lookLazarus,
    bottle: [[0, 0], [0.042, 0], [0.048, 0.02], [0.048, 0.16], [0.034, 0.2], [0.017, 0.22], [0.017, 0.27], [0.025, 0.275], [0.02, 0.3], [0, 0.31]],
    cap: 'cork', capRows: 4, label: [14, 23],
    sign: [
      { rect: [0, 0, 24, 128], lines: [{ text: 'LAZARUS', vertical: true }] },
      { rect: [32, 0, 96, 16], lines: [{ text: 'DRAUGHT', s: 1 }] },
    ],
  },
  quicksilver: {
    build: lookQuicksilver,
    bottle: [[0, 0], [0.036, 0], [0.058, 0.025], [0.064, 0.065], [0.056, 0.11], [0.034, 0.155], [0.02, 0.19], [0.018, 0.225], [0.024, 0.23], [0.024, 0.25], [0, 0.25]],
    cap: 'steel', capRows: 3, label: [17, 24],
    sign: [{ rect: [0, 0, 128, 32], bulbs: true, lines: [{ text: 'QUICKSILVER', y: 4, gap: 1 }, { text: 'COLA', y: 21, s: 1 }] }],
  },
  hairtrigger: {
    build: lookHairTrigger,
    bottle: [[0, 0], [0.052, 0], [0.056, 0.012], [0.056, 0.15], [0.046, 0.18], [0.022, 0.2], [0.02, 0.255], [0.026, 0.26], [0.026, 0.28], [0, 0.28]],
    cap: 'gold', capRows: 3, label: [15, 25],
    sign: [{ rect: [0, 0, 96, 48], bulbs: true, lines: [{ text: 'HAIR', y: 5 }, { text: 'TRIGGER', y: 21 }, { text: 'STOUT', y: 37, s: 1 }] }],
  },
};

// A lit panel behind the bottles with the perk's symbol stencilled on it.
function backlightPage(id) {
  const base = mixRGB(hexRGB(PERKS[id].color), [240, 230, 200], 0.5), sym = PERK_SYMBOLS[id];
  return page(64, 64, (x, y) => {
    let k = 0.72 + 0.28 * (1 - ((y - 34) / 34) ** 2);
    if (y % 8 === 7) k *= 0.84;
    k *= 0.78 + 0.22 * smooth(0, 12, Math.min(x, 63 - x));
    const sx = (x - 16) >> 1, sy = (y - 3) >> 1;
    if (sx >= 0 && sx < 16 && sy >= 0 && sy < 16) {
      const c = sym[sy][sx];
      if (c !== '.') k *= c === '+' ? 1.08 : c === 'o' ? 0.42 : 0.58;
    }
    return scaleRGB(base, k + dith(x, y) * 0.05);
  }, false);
}

function bottlePage(id, look) {
  const rgb = hexRGB(PERKS[id].color);
  const glass = perkRamp(PERKS[id].color, 6, { lo: 0.06, hi: 0.42, sat: 0.9 });
  const cap = { iron: RAMP.iron, steel: RAMP.steel, cork: RAMP.wood, gold: RAMP.brass }[look.cap] || RAMP.steel;
  const [l0, l1] = look.label;
  return page(16, 32, (x, y) => {
    const hl = x === 2 || x === 3 ? 0.3 : x >= 9 && x <= 12 ? -0.15 : 0;
    if (y < look.capRows) return pick(cap, 0.6 + hl + (y === look.capRows - 1 ? -0.3 : 0));
    if (y >= l0 && y < l1) {
      if (y === l0 || y === l1 - 1) return scaleRGB(rgb, 0.7);
      if ((x === 7 || x === 8) && Math.abs(y + 0.5 - (l0 + l1) / 2) < 2) return rgb;
      return pick(RAMP.cream, 0.72 + hl * 0.5);
    }
    return pick(glass, 0.45 + hl);
  });
}

function perkKit(id) {
  return once(`perk:${id}`, () => {
    const P = PERKS[id], look = PERK_LOOKS[id];
    const tube = mixRGB(hexRGB(P.color), [255, 255, 255], 0.35);
    const T = {
      enamel: enamelPage(perkRamp(P.color, 8, { lo: 0.06, hi: 0.58, sat: 0.72 }), 200 + Object.keys(PERK_LOOKS).indexOf(id) * 7),
      glow: backlightPage(id),
      bottle: bottlePage(id, look),
      sign: signAtlas(128, look.sign, tube),
    };
    const enamel = new THREE.MeshPhongMaterial({ map: T.enamel, vertexColors: true, flatShading: true, specular: 0x2a2a2a, shininess: 26 });
    const b = newBatch();
    const lay = look.build(b, T.sign);
    const bottle = bottleGeo(look.bottle);
    for (const [x, y, z, s = 1] of lay.bottles) b.get('bottle').geo(bottle, mat(x, y, z, 0.35, 0, 0, s), 1);
    const top = Math.max(...look.bottle.map((q) => q[1])), rad = Math.max(...look.bottle.map((q) => q[0]));
    return { T, enamel, geos: bake(b), lay, bottle, top, rad };
  });
}

/**
 * One perk bottle (the machine's own), for the first-person drink: origin at its
 * base, neck up +Y, about 0.25-0.31 m tall.
 */
export function buildPerkBottle(perkId) {
  const pk = perkKit(PERK_LOOKS[perkId] ? perkId : 'ironclad');
  const m = new THREE.Mesh(pk.bottle, new THREE.MeshLambertMaterial({ map: pk.T.bottle, flatShading: true }));
  m.name = `bottle:${perkId}`;
  return m;
}

/**
 * A perk machine for `perkId` (a key of PERKS).
 * userData: setPower(on), vend(), setCalm(on), update(dt, t), use (Vector3,
 * local: where the buyer stands), light, perk, height.
 */
export function buildPerkMachine(perkId) {
  const P = PERKS[perkId];
  if (!P || !PERK_LOOKS[perkId]) throw new Error(`machines: no perk machine for "${perkId}"`);
  const K = kit(), pk = perkKit(perkId), lay = pk.lay;
  const sign = litMat(pk.T.sign.map, pk.T.sign.emissive);
  const glow = litMat(pk.T.glow, pk.T.glow);
  const bottle = new THREE.MeshPhongMaterial({
    map: pk.T.bottle, emissive: 0xffffff, emissiveMap: pk.T.bottle, emissiveIntensity: 0, specular: 0x606060, shininess: 60, flatShading: true,
  });
  const g = new THREE.Group();
  g.name = `perk:${perkId}`;
  addMeshes(g, pk.geos, { enamel: pk.enamel, steel: K.steel, cream: K.cream, brass: K.brass, sign, glow, glass: K.glass, bottle });
  const drop = new THREE.Mesh(pk.bottle, bottle);
  drop.name = 'vendBottle';
  drop.visible = false;
  g.add(drop);
  const light = new THREE.PointLight(new THREE.Color(P.color).lerp(new THREE.Color(0xffe2b8), 0.3), 0, 4.5, 1.6);
  light.position.set(...lay.light);
  g.add(light);

  const seed = 17 + Object.keys(PERK_LOOKS).indexOf(perkId) * 31;
  const tube = new Neon(seed, { boot: 0.9, sputter: 0.3 });
  const lamp = new Neon(seed + 1, { boot: 0.5, sputter: 0, hum: 0.03 });
  const S = lay.slot, rest = S.y + pk.rad, x0 = S.x + pk.top / 2;
  let calm = false, vendT = -1;
  Object.assign(g.userData, {
    kind: 'perk', perk: perkId, light, height: lay.height,
    use: V3(0, 0, lay.depth / 2 + 0.85),
    setPower(on) { tube.set(on); lamp.set(on); },
    setCalm(on) { calm = !!on; },
    // A bottle drops out of the mouth onto the tray, rolls, and is taken away.
    vend() { vendT = 0; drop.visible = true; },
    update(dt, t) {
      const s = tube.step(dt, t, calm), w = lamp.step(dt, t, calm);
      sign.emissiveIntensity = 1.5 * s;
      glow.emissiveIntensity = 1.15 * w;
      bottle.emissiveIntensity = 0.3 * w;
      light.intensity = 8 * (0.35 * s + 0.65 * w);
      if (vendT < 0) return;
      vendT += dt;
      drop.rotation.set(0, 0, Math.PI / 2);
      drop.scale.setScalar(1);
      if (vendT < 0.3) {
        const u = vendT / 0.3;
        drop.position.set(x0, lerp(S.yIn, rest, u * u), lerp(S.zIn, S.z, ease(u)));
      } else if (vendT < 0.6) {
        const u = (vendT - 0.3) / 0.3;
        drop.position.set(x0, rest + 0.04 * Math.sin(Math.PI * u) * (1 - u), S.z + 0.015 * u);
        drop.rotation.x = u * 0.9;
      } else if (vendT < 2.6) {
        drop.position.set(x0, rest, S.z + 0.015);
        drop.rotation.x = 0.9;
      } else if (vendT < 2.9) {
        drop.rotation.x = 0.9;
        drop.scale.setScalar(1 - (vendT - 2.6) / 0.3);
      } else {
        drop.visible = false;
        vendT = -1;
      }
    },
  });
  g.userData.update(0, 0);
  return g;
}

// ==============================================================================================
// The Forge: the upgrade press
// ==============================================================================================
// Left to right: bellows on a trestle, a brick furnace with a barred, glowing
// mouth and a flue, then the press: two riveted I-beam columns, a crossbeam, a
// screw-driven head over an anvil bed, and a roller conveyor running out to the
// front. The gun rides a tray (userData.slot) in under the head and back out.

// Machine paint for the press: the steel page, tinted a worn engine green.
const GREEN = [0.5, 0.64, 0.52], GREEN_DARK = [0.36, 0.46, 0.38];
const FORGE = { OX: 0.275, REST: 1.5, LOW: 1.055, IN: 0, OUT: 0.66, SLAMS: [0.75, 1.55, 2.35], WORK: 3.5 };
const BELLOWS = [[0, -0.05], [-0.14, -0.17], [-0.44, -0.21], [-0.6, -0.14], [-0.63, 0], [-0.6, 0.14], [-0.44, 0.21], [-0.14, 0.17], [0, 0.05]];
const BELLOWS_REF = 0.3; // the leather's modelled opening (radians)

function forgeGeos() {
  return once('forge', () => {
    const { OX, REST } = FORGE, fx = -0.75 + OX, px = 0.35 + OX, zf = 0.5;
    const b = newBatch(), I = b.get('iron'), Bk = b.get('brick'), Br = b.get('brass'), S = b.get('steel'), Wd = b.get('wood');
    // --- furnace ---
    cbox(Bk, 0.9, 1.3, 1.0, 0.04, mat(fx, 0.77, 0), 1, F1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) I.tbox(mat(fx + sx * 0.44, 0.77, sz * 0.49), 0.07, 1.32, 0.07, 0.8, 1);
    cbox(I, 0.98, 0.1, 1.08, 0.02, mat(fx, 1.47, 0), 0.85);
    I.geo(hull([
      V3(-0.46, 0, -0.52), V3(0.46, 0, -0.52), V3(-0.46, 0, 0.52), V3(0.46, 0, 0.52),
      V3(-0.2, 0.38, -0.3), V3(0.2, 0.38, -0.3), V3(-0.2, 0.38, 0.1), V3(0.2, 0.38, 0.1),
    ]), mat(fx, 1.52, 0), 0.8);
    I.geo(prism(0.14, 0.16, 0.9, 8), mat(fx, 2.35, -0.1), 0.85);
    for (const y of [2.2, 2.6]) I.geo(prism(0.18, 0.18, 0.05, 8), mat(fx, y, -0.1), 0.7);
    I.geo(prism(0.24, 0.16, 0.07, 8), mat(fx, 2.835, -0.1), 0.75);
    // the mouth: fire behind a bar grate in an iron arch
    const mouth = [[-0.26, 0], [0.26, 0], [0.26, 0.34], [0.18, 0.44], [0, 0.49], [-0.18, 0.44], [-0.26, 0.34]];
    const mm = mat(fx, 0.52, zf);
    b.get('fire').geo(polyGeo(mouth, 0.6), at(mm, 0, 0, 0.004), 1);
    const R = mulberry32(61);
    for (let k = 0; k < 7; k++) {
      const pts = [];
      for (let j = 0; j < 6; j++) pts.push(V3((R() - 0.5) * 0.09, R() * 0.05, (R() - 0.5) * 0.06));
      b.get('fire').geo(hull(pts), at(mm, -0.21 + k * 0.07, 0.01, 0.03), 1.3);
    }
    outline(I, mm, mouth, 0.06, 0.1, 0.7);
    for (let k = 0; k < 5; k++) I.geo(prism(0.012, 0.012, 0.44, 6), at(mm, -0.2 + k * 0.1, 0.23, 0.035), 0.6);
    I.tbox(at(mm, 0, 0.1, 0.035), 0.5, 0.025, 0.025, 0.6, 1);
    cbox(I, 0.66, 0.08, 0.16, 0.02, at(mm, 0, -0.03, 0.06), 0.72);
    cbox(Br, 0.08, 0.1, 0.05, 0.01, at(mm, 0, 0.54, 0.07), 1);
    // the furnace door, swung open on its hinge
    const dm = mat(fx + 0.31, 0.77, zf + 0.03, -1.25);
    cbox(I, 0.52, 0.5, 0.04, 0.012, at(dm, 0.26, 0, 0), 0.72);
    for (const y of [-0.18, 0.18]) I.tbox(at(dm, 0.02, y, 0.03), 0.06, 0.06, 0.03, 0.5, 1);
    cbox(Br, 0.05, 0.05, 0.06, 0.012, at(dm, 0.45, 0, 0.04), 1);
    // ash pit
    S.tbox(mat(fx, 0.29, zf + 0.003), 0.42, 0.14, 0.006, 0.05, 1);
    outline(I, mat(fx, 0.29, zf), [[-0.21, -0.07], [0.21, -0.07], [0.21, 0.07], [-0.21, 0.07]], 0.04, 0.06, 0.6);
    // --- bellows (the bottom board, trestle and nozzle; the top and leather move) ---
    const bm = mat(fx - 0.49, 0.5, 0.12);
    Wd.geo(slab(BELLOWS, 0.03).rotateX(Math.PI / 2), bm, 1.1);
    Wd.tbox(at(bm, -0.3, -0.035, 0), 0.52, 0.04, 0.3, 0.8, 1);
    for (const x of [-0.08, -0.52]) for (const z of [-0.12, 0.12]) Wd.geo(prism(0.02, 0.026, 0.46, 4), at(bm, x, -0.28, z), 0.75);
    Wd.tbox(at(bm, -0.7, 0, 0), 0.14, 0.025, 0.05, 0.6, 1);
    I.geo(prism(0.025, 0.045, 0.14, 6), at(bm, 0.06, 0.02, 0, 0, 0, -Math.PI / 2), 0.7);
    // --- the press ---
    cbox(S, 0.8, 0.8, 0.7, 0.04, mat(px, 0.52, 0), 0.45);
    cbox(S, 0.74, 0.035, 0.62, 0.01, mat(px, 0.9375, 0), 0.9);
    for (const s of [-1, 1]) {
      const cx = px + s * 0.56;
      S.tbox(mat(cx, 1.37, 0), 0.05, 2.5, 0.16, GREEN_DARK, 1);
      for (const z of [-0.095, 0.095]) S.tbox(mat(cx, 1.37, z), 0.16, 2.5, 0.03, GREEN, 1);
      cbox(S, 0.26, 0.14, 0.34, 0.03, mat(cx, 0.07, 0), GREEN_DARK);
      for (let y = 0.4; y < 2.5; y += 0.3) for (const dx of [-0.055, 0.055]) rivetZ(S, mat(cx + dx, y, 0.112), 0.9);
      // chain and counterweight off the beam end
      I.tbox(mat(px + s * 0.76, 2.62, 0), 0.16, 0.05, 0.08, 0.7, 1);
      let k = 0;
      for (let y = 2.56; y > 1.3; y -= 0.07, k++) I.tbox(mat(px + s * 0.82, y, 0), k & 1 ? 0.045 : 0.016, 0.08, k & 1 ? 0.016 : 0.045, 0.85, 1);
      cbox(I, 0.14, 0.22, 0.14, 0.02, mat(px + s * 0.82, 1.16, 0), 0.62);
    }
    cbox(S, 1.42, 0.32, 0.4, 0.05, mat(px, 2.74, 0), GREEN);
    Br.tbox(mat(px, 2.74, 0.206), 0.56, 0.13, 0.012, 1, 1);
    for (const x of [-0.25, 0.25]) for (const y of [-0.04, 0.04]) rivetZ(Br, mat(px + x, 2.74 + y, 0.214), 1.2);
    // gauges on the left column with a pipe into the furnace hood
    const gx = px - 0.56;
    cbox(I, 0.26, 0.48, 0.03, 0.01, mat(gx, 1.5, 0.14), 0.62);
    for (const y of [1.61, 1.39]) {
      b.get('dial').geo(polyGeo(ngon(0.095, 10), 0.19), mat(gx, y, 0.158), 1);
      ring(Br, mat(gx, y, 0.166), 0.093, 0.118, 0.03, 10, 1);
    }
    I.tbox(at(mat(gx, 1.39, 0.162), 0, 0, 0, 0, 0, -0.6).multiply(mat(0, 0.035, 0)), 0.01, 0.075, 0.004, 0.3, 1);
    S.geo(prism(0.024, 0.024, 0.14, 6), mat(gx, 1.8, 0.14), 0.7);
    S.geo(prism(0.024, 0.024, gx - (fx + 0.2), 6), mat((gx + fx + 0.2) / 2, 1.87, 0.13, 0, 0, Math.PI / 2), 0.7);
    cbox(Br, 0.07, 0.07, 0.07, 0.015, mat(gx, 1.87, 0.135), 1);
    cbox(Br, 0.05, 0.09, 0.09, 0.015, mat(fx + 0.25, 1.87, 0.13), 1);
    // conveyor out to the front
    for (const s of [-1, 1]) {
      I.tbox(mat(px + s * 0.36, 0.925, 0.64), 0.04, 0.07, 0.74, 0.75, 1);
      I.tbox(mat(px + s * 0.36, 0.46, 0.96), 0.05, 0.92, 0.05, 0.6, 1);
    }
    I.tbox(mat(px, 0.25, 0.96), 0.72, 0.04, 0.04, 0.55, 1);
    I.tbox(mat(px, 0.975, 1.0), 0.76, 0.08, 0.03, 0.7, 1);
    for (let z = 0.38; z < 1.0; z += 0.14) S.geo(prism(0.032, 0.032, 0.68, 8), mat(px, 0.925, z, 0, 0, Math.PI / 2), 0.85);
    const geos = bake(b, (x, y) => floorAO(x, y) * (0.85 + 0.15 * smooth(1.6, 1.0, y)));
    shadeGeo(geos.fire, (x, y) => 0.55 + 0.75 * smooth(1.02, 0.52, y));

    // --- moving parts ---
    const hb = newBatch(), HI = hb.get('steel');
    cbox(HI, 0.92, 0.42, 0.62, 0.05, mat(0, 0.21, 0), GREEN);
    HI.tbox(mat(0, 0.02, 0), 0.8, 0.04, 0.5, 0.9, 1);
    for (const s of [-1, 1]) cbox(HI, 0.1, 0.32, 0.26, 0.02, mat(s * 0.5, 0.21, 0), [1.25, 0.95, 0.55]);
    HI.geo(prism(0.06, 0.06, 1.2, 8), mat(0, 1.02, 0), 1.05);
    for (let y = 0.5; y < 1.6; y += 0.09) HI.geo(prism(0.068, 0.068, 0.025, 8), mat(0, y, 0), 0.7);
    hb.get('hazard').tbox(mat(0, 0.3, 0.315), 0.84, 0.1, 0.008, 1, 0.3);
    const top = newBatch(), TW = top.get('wood');
    TW.geo(slab(BELLOWS, 0.03).rotateX(Math.PI / 2), mat(0, 0.03, 0), 1.2);
    TW.tbox(mat(-0.7, 0.03, 0), 0.14, 0.025, 0.05, 0.6, 1);
    for (const [x, z] of [[-0.3, 0], [-0.45, 0.1], [-0.45, -0.1]]) TW.geo(parts().rivet, mat(x, 0.05, z), [1.8, 1.4, 0.7]);
    const lb = newBatch(), pts = [];
    for (const [x, z] of BELLOWS) pts.push(V3(x * 0.95, 0.015, z * 0.92), V3(x * 0.95, 0.015 + -x * Math.tan(BELLOWS_REF), z * 0.92));
    lb.get('leather').geo(hull(pts, [0.25, 0.25, 0.25]), new THREE.Matrix4(), 1);
    const nb = newBatch();
    nb.get('iron').tbox(mat(0, 0.035, 0.002), 0.012, 0.085, 0.004, 0.25, 1);
    const cb = newBatch(), H = cb.get('hot');
    cbox(H, 0.84, 0.025, 0.4, 0.008, mat(0, 0.0125, 0), 0.8);
    for (const s of [-1, 1]) H.tbox(mat(0, 0.03, s * 0.2), 0.84, 0.035, 0.015, 0.7, 1);
    for (const s of [-1, 1]) H.tbox(mat(s * 0.43, 0.03, 0), 0.02, 0.03, 0.12, 0.6, 1);
    return {
      fx, px, zf, gx, geos,
      head: bake(hb, null), top: bake(top, null), leather: bake(lb, null), needle: bake(nb, null), pan: bake(cb, null),
    };
  });
}

/**
 * The Forge (upgrade machine).
 * userData: setPower(on), setState('idle' | 'working' | 'ready'), setCalm(on),
 * update(dt, t), slot (Object3D on the tray: attach the gun here; the tray
 * surface is its y = 0 and the conveyor runs along z, so lay the gun along x),
 * use, light, workTime (seconds the 'working' animation runs), height.
 */
export function buildForge() {
  const K = kit(), F = forgeGeos(), { REST, LOW, IN, OUT, SLAMS, WORK } = FORGE;
  const fireTex = K.T.fire.clone();
  fireTex.needsUpdate = true;
  const fire = new THREE.MeshBasicMaterial({ map: fireTex, vertexColors: true, color: 0x000000 });
  const hot = new THREE.MeshLambertMaterial({ map: K.T.steel, vertexColors: true, flatShading: true, emissive: 0xff7424, emissiveIntensity: 0 });
  const g = new THREE.Group();
  g.name = 'forge';
  addMeshes(g, F.geos, { iron: K.iron, brick: K.brick, brass: K.brass, steel: K.steel, wood: K.wood, dial: K.dial, fire });
  const head = new THREE.Group();
  head.position.set(F.px, REST, 0);
  addMeshes(head, F.head, { steel: K.steel, hazard: K.hazard });
  const bellows = new THREE.Group();
  bellows.position.set(F.fx - 0.49, 0.5, 0.12);
  const lid = new THREE.Group();
  addMeshes(lid, F.top, { wood: K.wood });
  const leather = new THREE.Group();
  addMeshes(leather, F.leather, { leather: K.leather });
  bellows.add(lid, leather);
  const needle = new THREE.Group();
  needle.position.set(F.gx, 1.61, 0.162);
  addMeshes(needle, F.needle, { iron: K.iron });
  const carrier = new THREE.Group();
  carrier.position.set(F.px, 0.96, OUT);
  addMeshes(carrier, F.pan, { hot });
  const slot = new THREE.Object3D();
  slot.name = 'forgeSlot';
  slot.position.set(0, 0.025, 0);
  // heat rising off the tray while the gun is ready: two crossed glowing sheets
  const heatMat = addMat(K.T.beam, 0xffa040);
  const heatGeo = new THREE.BufferGeometry();
  const hq = [quadGeo(0.9, 0.55, [0, 1, 1, 0]).translate(0, 0.3, 0), quadGeo(0.9, 0.55, [0, 1, 1, 0]).translate(0, 0.3, 0).rotateY(Math.PI / 2).scale(0.45, 1, 1)];
  const heatB = newBatch();
  for (const q of hq) heatB.get('lens').geo(q, new THREE.Matrix4(), 1);
  heatGeo.copy(heatB.builders.lens.build());
  const heatSheet = new THREE.Mesh(heatGeo, heatMat);
  heatSheet.name = 'heat';
  carrier.add(slot, heatSheet);
  const sparks = new Sparks(96);
  const halo = glowSprite(0xffa050, 1.25, 0.5);
  g.add(head, bellows, needle, carrier, sparks.mesh, halo);
  const light = new THREE.PointLight(0xff7a2a, 0, 4.5, 1.6);
  light.position.set(F.fx, 0.8, 0.95);
  g.add(light);

  const fireOn = new Neon(301, { boot: 1.2, sputter: 0, hum: 0 });
  let calm = false, state = 'idle', st = 0, flare = 0, heat = 0, breath = 0, needleV = 0, needleA = 0, kick = 0;
  const impact = () => {
    const n = calm ? 14 : 34;
    for (const s of [-1, 1]) sparks.burst(n / 2, F.px + s * 0.38, 1.02, 0.1, [s * 1.2, 0.8, 0.5], calm ? 2.5 : 3.6, 0.9);
    sparks.burst(n / 3, F.px, 1.02, 0.25, [0, 0.9, 1], calm ? 2 : 3, 1.2);
    flare = 1;
    kick = 0.25;
  };
  Object.assign(g.userData, {
    kind: 'forge', slot, light, height: 3.14, workTime: WORK,
    use: V3(F.px, 0, 1.75),
    setPower(on) { fireOn.set(on); },
    setState(s) { if (s !== state) { state = s; st = 0; } },
    setCalm(on) { calm = !!on; },
    update(dt, t) {
      const prev = st;
      st += dt;
      const pw = fireOn.step(dt, t, calm);
      // tray and press
      let cz = OUT, hy = REST;
      if (state === 'working') {
        cz = st < 0.45 ? lerp(OUT, IN, ease(st / 0.45)) : st < 2.95 ? IN : lerp(IN, OUT, ease((st - 2.95) / 0.45));
        for (const T of SLAMS) {
          const d = st - T;
          if (d > -0.16 && d < 0) hy = lerp(REST, LOW, ((d + 0.16) / 0.16) ** 2);
          else if (d >= 0 && d < 0.1) hy = LOW;
          else if (d >= 0.1 && d < 0.6) hy = lerp(LOW, REST, ease((d - 0.1) / 0.5));
          if (prev < T && st >= T) impact();
        }
      }
      carrier.position.z = cz;
      head.position.y = hy;
      // fire: drifting flames, flaring at each blow
      flare = Math.max(0, flare - dt * (calm ? 1.2 : 2.2));
      const work = state === 'working' && st < WORK ? 1 : 0;
      fireTex.offset.y = -((t * (calm ? 0.25 : 0.45)) % 1);
      fireTex.offset.x = Math.sin(t * 0.7) * 0.05;
      const flick = calm ? 0.95 + 0.05 * Math.sin(t * 2.1) : 0.86 + 0.1 * Math.sin(t * 11.3) * Math.sin(t * 4.1) + 0.06 * hash(Math.floor(t * 18));
      const burn = (0.06 + 0.94 * pw) * flick * (1 + work * 0.25 + flare * (calm ? 0.2 : 0.6));
      fire.color.setRGB(burn, burn * 0.94, burn * 0.9);
      // the tray: glowing while the gun is ready
      const want = state === 'ready' ? 1 : state === 'working' && st > 1.2 ? 0.45 : 0;
      heat += (want - heat) * Math.min(1, dt * (want > heat ? 2 : 0.8));
      const pulse = calm ? 1 : 0.85 + 0.15 * Math.sin(t * 4.2);
      hot.emissiveIntensity = heat * 0.9 * pulse;
      halo.material.opacity = heat * 0.8 * pulse;
      heatMat.opacity = heat * (state === 'ready' ? 0.55 : 0.2) * pulse;
      heatSheet.visible = heatMat.opacity > 0.005;
      halo.visible = halo.material.opacity > 0.005;
      halo.position.set(F.px, 1.06, cz);
      if (state === 'ready' && !calm && Math.random() < dt * 5) sparks.emit(F.px + (Math.random() - 0.5) * 0.7, 1.0, cz + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5), 1.2 + Math.random(), (Math.random() - 0.5), 0.4);
      // the light sits in the furnace mouth, drifting to the tray when the gun is ready
      const h = heat * (state === 'ready' ? 1 : 0.3);
      light.position.set(lerp(F.fx, F.px, h), lerp(0.8, 1.35, h), lerp(0.95, cz + 0.45, h));
      light.color.setRGB(1, lerp(0.48, 0.66, h), lerp(0.16, 0.3, h));
      light.intensity = pw * (2.6 + work * 0.8 + flare * (calm ? 0.8 : 3.5)) * flick + heat * 4;
      // bellows breathe: slow when lit, quick while working
      const rate = pw * (work ? 1.5 : 0.3);
      breath += dt * rate * TAU;
      const open = 0.06 + (rate > 0 ? 0.22 * (0.5 + 0.5 * Math.sin(breath)) : 0);
      lid.rotation.z += (-open - lid.rotation.z) * Math.min(1, dt * 8);
      leather.scale.y = Math.max(0.05, Math.tan(-lid.rotation.z) / Math.tan(BELLOWS_REF));
      // pressure gauge: settles on a spring, kicks at each blow
      kick = Math.max(0, kick - dt * 0.5);
      const target = pw * (0.3 + work * 0.4 + kick) + (pw > 0.5 ? 0.02 * Math.sin(t * 7) : 0);
      needleV += ((target - needleA) * 60 - needleV * 9) * dt;
      needleA += needleV * dt;
      needle.rotation.z = 2.3 - clamp01(needleA) * 4.6;
      sparks.update(dt);
    },
  });
  g.userData.update(0, 0);
  return g;
}

// ==============================================================================================
// The Magic Lantern teleporter
// ==============================================================================================
// The core: a round brass pad ringed with marquee bulbs, and behind it a fluted
// column holding an ornate magic lantern (chimney crown, jewel side windows, a
// chromatrope slide) whose lens barrel turns down through an elbow to shine on
// the pad. The pads: smaller brass discs with a ring of copper coils and a
// pedestal with the link lever.

const TELE_R = 1.4, PAD_R = 0.75, BULBS = 20;
const LANTERN = { LS: 1.25, LY: 2.08, LZ: -1.1 }; // the lantern's scale and the cradle it sits on

function teleCoreGeos() {
  return once('teleCore', () => {
    const b = newBatch(), Br = b.get('brass'), I = b.get('iron');
    // the pad
    Br.geo(prism(TELE_R - 0.04, TELE_R + 0.04, 0.1, 16), mat(0, 0.05, 0), 0.8);
    I.geo(prism(TELE_R + 0.07, TELE_R + 0.08, 0.03, 16), mat(0, 0.015, 0), 0.6);
    b.get('pad').geo(polyGeo(ngon(TELE_R - 0.04, 16), 2 * (TELE_R - 0.04)).rotateX(-Math.PI / 2), mat(0, 0.1015, 0), 1);
    b.get('ring').geo(new THREE.RingGeometry(0.98, 1.06, 32).rotateX(-Math.PI / 2), mat(0, 0.104, 0), 1);
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * TAU;
      Br.geo(prism(0.045, 0.05, 0.02, 6), mat(Math.sin(a) * 1.22, 0.11, Math.cos(a) * 1.22), 0.6);
    }
    // the column: black iron with brass collars, braced up to the lantern's cradle
    const cz = -1.16, { LS, LY, LZ } = LANTERN;
    Br.geo(prism(0.28, 0.33, 0.06, 8), mat(0, 0.13, cz), 0.9);
    I.geo(prism(0.22, 0.27, 0.18, 8), mat(0, 0.25, cz), 0.9);
    I.geo(prism(0.1, 0.13, 1.5, 8), mat(0, 1.09, cz), 1);
    for (const y of [0.45, 1.0, 1.55]) Br.geo(prism(0.15, 0.15, 0.05, 8), mat(0, y, cz), 1.05);
    Br.geo(prism(0.2, 0.12, 0.14, 8), mat(0, 1.91, cz), 1);
    Br.geo(prism(0.08, 0.08, 0.06, 8), mat(0, 2.01, cz), 1);
    cbox(Br, 0.56, 0.04, 0.62, 0.012, mat(0, LY - 0.02, LZ), 0.9);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(Br, V3(sx * 0.1, 1.72, cz + sz * 0.06), V3(sx * 0.22, LY - 0.04, LZ + sz * 0.26), 0.025, 0.95);
    // the lantern, built at its own scale: a black japanned body trimmed in brass
    const LF = mat(0, LY, LZ, 0, 0, 0, LS), L = (x, y, z, ry = 0, rx = 0, rz = 0) => at(LF, x, y, z, ry, rx, rz);
    cbox(I, 0.62, 0.48, 0.66, 0.035, L(0, 0.24, 0), 1.25);
    for (const x of [-0.31, 0.31]) for (const z of [-0.33, 0.33]) Br.tbox(L(x, 0.24, z), 0.045, 0.5, 0.045, 1.05, 1);
    for (const y of [0.02, 0.465]) Br.tbox(L(0, y, 0), 0.66, 0.035, 0.7, 0.95, 1);
    for (const x of [-0.26, 0.26]) for (const z of [-0.28, 0.28]) cbox(Br, 0.06, 0.05, 0.06, 0.015, L(x, -0.02, z), 0.9);
    for (const sx of [-1, 1]) {
      b.get('glow').geo(polyGeo(ngon(0.1, 8), 0.2), L(sx * 0.312, 0.24, 0, sx * Math.PI / 2), 1);
      ring(Br, L(sx * 0.322, 0.24, 0, sx * Math.PI / 2), 0.1, 0.14, 0.03, 8, 1.1);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * TAU;
        Br.tbox(L(sx * 0.316, 0.24 + Math.cos(ang) * 0.19, Math.sin(ang) * 0.19, sx * Math.PI / 2, 0, -ang), 0.02, 0.06, 0.012, 1.1, 1);
      }
      for (const y of [0.12, 0.36]) Br.tbox(L(sx * 0.318, y, -0.26), 0.02, 0.05, 0.05, 1, 1);
    }
    Br.geo(hull([
      V3(-0.34, 0, -0.36), V3(0.34, 0, -0.36), V3(-0.34, 0, 0.36), V3(0.34, 0, 0.36),
      V3(-0.14, 0.12, -0.14), V3(0.14, 0.12, -0.14), V3(-0.14, 0.12, 0.14), V3(0.14, 0.12, 0.14),
    ]), L(0, 0.48, 0), 0.9);
    for (const x of [-0.31, 0.31]) for (const z of [-0.33, 0.33]) Br.geo(prism(0.0, 0.03, 0.08, 4), L(x, 0.54, z), 1.15);
    I.geo(prism(0.1, 0.12, 0.22, 8), L(0, 0.71, 0), 1.2);
    for (const y of [0.64, 0.8]) Br.geo(prism(0.135, 0.135, 0.03, 8), L(0, y, 0), 1.1);
    Br.geo(prism(0.19, 0.11, 0.08, 8), L(0, 0.86, 0), 1.05);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU + Math.PI / 8;
      cbox(Br, 0.05, 0.06, 0.05, 0.01, L(Math.sin(ang) * 0.16, 0.93, Math.cos(ang) * 0.16, ang), 1.1);
    }
    Br.geo(prism(0.0, 0.04, 0.12, 4), L(0, 1.0, 0), 1.2);
    // the slide stage (the chromatrope turns in it), barrel, bellows, and the elbow down to the lens
    frame(Br, L(0, 0.21, 0.335), 0.5, 0.5, 0.04, 0.03, 1);
    Br.geo(prism(0.17, 0.17, 0.06, 8), L(0, 0.21, 0.4, 0, Math.PI / 2), 1);
    b.get('leather').geo(prism(0.15, 0.15, 0.16, 8, [0.25, 0.25, 0.25]), L(0, 0.21, 0.51, 0, Math.PI / 2), 0.8);
    for (const z of [0.47, 0.51, 0.55]) Br.geo(prism(0.158, 0.158, 0.012, 8), L(0, 0.21, z, 0, Math.PI / 2), 0.9);
    Br.geo(prism(0.13, 0.13, 0.2, 8), L(0, 0.21, 0.69, 0, Math.PI / 2), 1);
    Br.geo(prism(0.145, 0.145, 0.03, 8), L(0, 0.21, 0.79, 0, Math.PI / 2), 1.1);
    cbox(Br, 0.28, 0.28, 0.28, 0.06, L(0, 0.21, 0.92), 1);
    Br.geo(prism(0.11, 0.13, 0.18, 8), L(0, -0.02, 0.92), 1);
    ring(Br, L(0, -0.11, 0.92, 0, Math.PI / 2), 0.09, 0.14, 0.03, 8, 1.15);
    b.get('lens').geo(polyGeo(ngon(0.09, 8), 0.18).rotateX(Math.PI / 2), L(0, -0.113, 0.92), 1);
    const geos = bake(b);
    const cb = newBatch();
    cb.get('chroma').geo(polyGeo(ngon(0.24, 12), 0.48), mat(0, 0, 0.004), 1);
    cb.get('chroma').geo(polyGeo(ngon(0.24, 12), 0.48).rotateY(Math.PI), mat(0, 0, -0.004), 1);
    // eight projected rays standing round the pad for the burst, bright at the floor
    const rb = newBatch();
    for (let k = 0; k < 8; k++) {
      const q = quadGeo(1.3, 2.4, [0, 1, 1, 0]).translate(0.65, 1.2, 0);
      rb.get('lens').geo(q, mat(0, 0, 0, (k / 8) * TAU), 1);
    }
    return { geos, chroma: bake(cb, null), rays: bake(rb, null), lens: V3(0, LY - 0.12 * LS, LZ + 0.92 * LS) };
  });
}

// Marquee bulbs round a pad: one instanced mesh.
function bulbRing(n, r, y) {
  const m = new THREE.InstancedMesh(parts().bulb, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const M = new THREE.Matrix4(), c = new THREE.Color(0.1, 0.1, 0.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    m.setMatrixAt(i, M.makeTranslation(Math.sin(a) * r, y, Math.cos(a) * r));
    m.setColorAt(i, c);
  }
  m.name = 'bulbs';
  return m;
}

/**
 * The Magic Lantern (teleporter core). Players stand on its pad (radius
 * userData.radius, centred on the origin).
 * userData: setPower(on), setLinked(on), setCharge(u 0..1), fire(), setCalm(on),
 * update(dt, t), radius, use (the pad centre), light, height.
 */
export function buildTeleCore() {
  const K = kit(), C = teleCoreGeos();
  const glow = lampMat(), ring = lampMat(), lens = lampMat();
  const g = new THREE.Group();
  g.name = 'teleCore';
  addMeshes(g, C.geos, { brass: K.brass, iron: K.iron, leather: K.leather, pad: K.pad, glow, ring, lens });
  const { LS, LY, LZ } = LANTERN;
  const stage = new THREE.Group();
  stage.applyMatrix4(mat(0, LY + 0.21 * LS, LZ + 0.345 * LS, 0, 0, 0, LS));
  const chroma = new THREE.Group();
  stage.add(chroma);
  addMeshes(chroma, C.chroma, { chroma: K.chroma });
  const bulbs = bulbRing(BULBS, 1.22, 0.12);
  const beamMat = addMat(K.T.beam, 0xfff0d8);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.02, C.lens.y - 0.11, 16, 1, true), beamMat);
  beam.position.set(0, (C.lens.y + 0.11) / 2, C.lens.z);
  beam.name = 'beam';
  const rayMat = addMat(K.T.beam, 0xd8ecff);
  const rays = new THREE.Group();
  rays.position.y = 0.1;
  addMeshes(rays, C.rays, { lens: rayMat });
  const flashMat = addMat(K.T.dot, 0xdff0ff);
  const flash = new THREE.Mesh(new THREE.CircleGeometry(TELE_R * 1.1, 24).rotateX(-Math.PI / 2), flashMat);
  flash.position.y = 0.12;
  const flare = glowSprite(0xfff2d0, 0.7, 0.7);
  flare.position.copy(C.lens);
  const lamp = new THREE.Mesh(parts().bulb, lampMat(0x200000, false));
  lamp.position.set(0, LY + 0.53 * LS, LZ + 0.24 * LS);
  lamp.rotation.x = 0.55;
  lamp.scale.setScalar(1.3);
  g.add(stage, bulbs, beam, rays, flash, flare, lamp);
  const light = new THREE.PointLight(0xcfe0ff, 0, 5, 1.6);
  light.position.set(0, 1.3, 0);
  g.add(light);
  return teleControls(g, {
    kind: 'teleCore', radius: TELE_R, use: V3(0, 0, 0), height: 3.4,
    glow, ring, lens, bulbs, beamMat, rayMat, rays, flashMat, flare, lamp, light, spin: chroma,
  });
}

function telePadGeos() {
  return once('telePad', () => {
    const b = newBatch(), Br = b.get('brass'), I = b.get('iron'), S = b.get('steel');
    Br.geo(prism(PAD_R - 0.03, PAD_R + 0.03, 0.08, 12), mat(0, 0.04, 0), 0.8);
    I.geo(prism(PAD_R + 0.06, PAD_R + 0.07, 0.025, 12), mat(0, 0.0125, 0), 0.6);
    b.get('pad').geo(polyGeo(ngon(PAD_R - 0.03, 12), 2 * (PAD_R - 0.03)).rotateX(-Math.PI / 2), mat(0, 0.0815, 0), 1);
    b.get('ring').geo(new THREE.RingGeometry(0.46, 0.51, 24).rotateX(-Math.PI / 2), mat(0, 0.084, 0), 1);
    // six coils round the rim, clear of the pedestal side
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6, x = Math.sin(a) * 0.64, z = Math.cos(a) * 0.64;
      Br.geo(prism(0.075, 0.085, 0.05, 8), mat(x, 0.105, z), 0.8);
      b.get('coil').geo(prism(0.058, 0.058, 0.42, 8, [0.2, 0.2, 0.2]), mat(x, 0.34, z), 1);
      Br.geo(prism(0.07, 0.07, 0.03, 8), mat(x, 0.565, z), 1);
      Br.geo(hull([...ngon(0.05, 6).map(([u, v]) => V3(u, 0, v)), ...ngon(0.035, 6).map(([u, v]) => V3(u, 0.05, v)), V3(0, 0.075, 0)]), mat(x, 0.58, z), 1.1);
    }
    // the pedestal off the front-right with its lever and lamp
    const pm = mat(0.98, 0, 0.42, -0.35);
    I.geo(prism(0.16, 0.2, 0.08, 8), at(pm, 0, 0.04, 0), 0.65);
    I.geo(prism(0.07, 0.09, 0.85, 8), at(pm, 0, 0.5, 0), 0.8);
    Br.geo(prism(0.1, 0.1, 0.04, 8), at(pm, 0, 0.3, 0), 1);
    const tp = at(pm, 0, 0.95, 0.02, 0, 0.35);
    cbox(Br, 0.3, 0.06, 0.26, 0.015, tp, 0.95);
    cbox(S, 0.07, 0.03, 0.15, 0.01, at(tp, 0, 0.04, 0.02), 0.3);
    ring(Br, at(tp, 0.09, 0.04, -0.07, 0, -Math.PI / 2), 0.026, 0.036, 0.03, 6, 1);
    const geos = bake(b);
    const lb = newBatch();
    lb.get('steel').geo(prism(0.012, 0.016, 0.2, 6), mat(0, 0.1, 0), 0.9);
    cbox(lb.get('steel'), 0.045, 0.06, 0.045, 0.012, mat(0, 0.22, 0), [0.35, 0.3, 0.28]);
    return { geos, lever: bake(lb, null), tp };
  });
}

/**
 * A teleporter pad: players stand on it (radius userData.radius); the pedestal
 * holds the link lever (use is in front of it).
 * userData: setPower(on), setLinked(on), setCharge(u 0..1), fire(), setCalm(on),
 * update(dt, t), radius, use, light, height.
 */
export function buildTelePad() {
  const K = kit(), P = telePadGeos();
  const ring = lampMat(), coil = litMat(K.T.coil, K.T.coil);
  const g = new THREE.Group();
  g.name = 'telePad';
  addMeshes(g, P.geos, { brass: K.brass, iron: K.iron, steel: K.steel, pad: K.pad, ring, coil });
  const mount = new THREE.Group();
  mount.applyMatrix4(at(P.tp, 0, 0.05, 0.02));
  const lever = new THREE.Group();
  mount.add(lever);
  addMeshes(lever, P.lever, { steel: K.steel });
  const lamp = new THREE.Mesh(parts().bulb, lampMat(0x200000, false));
  lamp.applyMatrix4(at(P.tp, 0.09, 0.03, -0.07));
  const beamMat = addMat(K.T.beam, 0xd8ecff);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R * 0.9, PAD_R * 0.9, 2.8, 16, 1, true), beamMat);
  const uv = beam.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  beam.position.y = 1.48;
  beam.name = 'beam';
  const flashMat = addMat(K.T.dot, 0xdff0ff);
  const flash = new THREE.Mesh(new THREE.CircleGeometry(PAD_R * 1.3, 20).rotateX(-Math.PI / 2), flashMat);
  flash.position.y = 0.1;
  g.add(mount, lamp, beam, flash);
  const light = new THREE.PointLight(0xcfe0ff, 0, 3.5, 1.6);
  light.position.set(0, 0.9, 0);
  g.add(light);
  const use = V3(0.98, 0, 0.42).add(V3(0, 0, 0.75).applyAxisAngle(V3(0, 1, 0), -0.35));
  return teleControls(g, {
    kind: 'telePad', radius: PAD_R, use, height: 1.1,
    ring, coil, beamMat, flashMat, lamp, light, lever, pad: true,
  });
}

// Shared behaviour for the lantern and the pads.
function teleControls(g, o) {
  const power = new Neon(o.pad ? 503 : 401, { boot: 1.0, sputter: 0, hum: 0.02 });
  const flame = new Neon(o.pad ? 509 : 409, { boot: 0.6, sputter: 0.25, hum: 0.12 });
  const off = new THREE.Color(0.08, 0.08, 0.08), dim = new THREE.Color(0.22, 0.2, 0.16), lit = new THREE.Color(1, 0.8, 0.5);
  const tmp = new THREE.Color();
  let calm = false, linked = false, charge = 0, shown = 0, fireT = -1, spin = 0, leverA = 0;
  Object.assign(g.userData, {
    kind: o.kind, radius: o.radius, use: o.use, light: o.light, height: o.height,
    setPower(on) { power.set(on); flame.set(on); },
    setLinked(on) { linked = !!on; },
    setCharge(u) { charge = clamp01(u); },
    fire() { fireT = 0; },
    setCalm(on) { calm = !!on; },
    update(dt, t) {
      const pw = power.step(dt, t, calm), fl = flame.step(dt, t, calm);
      shown += (charge - shown) * Math.min(1, dt * 6);
      const cs = shown * pw;
      // the burst: a hard white flash that falls away, or a soft swell when calm
      let f = 0;
      if (fireT >= 0) {
        fireT += dt;
        f = calm ? Math.sin(Math.PI * Math.min(1, fireT / 1.2)) * 0.4 : fireT < 0.06 ? fireT / 0.06 : Math.exp(-(fireT - 0.06) * 4);
        if (fireT > 1.3) fireT = -1;
      }
      o.ring.color.setRGB(0.1 + pw * (0.12 + 0.75 * cs) + f, 0.1 + pw * (0.2 + 0.72 * cs) + f, 0.12 + pw * (0.3 + 0.62 * cs) + f);
      if (o.glow) o.glow.color.setRGB(0.12 + fl * 0.95, 0.08 + fl * 0.6, 0.05 + fl * 0.25);
      if (o.lens) { const k = 0.08 + pw * (linked ? 0.35 + 0.65 * cs : 0.15) + f; o.lens.color.setRGB(k, k * 0.96, k * 0.88); }
      if (o.coil) o.coil.emissiveIntensity = pw * (0.08 + 0.9 * cs) + f * 1.5;
      o.lamp.material.color.setRGB(pw * (linked ? 0.2 : 0.95) + 0.05, pw * (linked ? 0.9 : 0.12) + 0.03, pw * (linked ? 0.3 : 0.08) + 0.03);
      // bulbs: lit up to the charge, the last one blinking; full charge chases
      if (o.bulbs) {
        const n = BULBS, litN = Math.floor(cs * n + 1e-4);
        for (let i = 0; i < n; i++) {
          let k = 0;
          if (i < litN) k = cs >= 0.999 && !calm ? (Math.floor(t * 8) % 3 === i % 3 ? 1 : 0.55) : 1;
          else if (i === litN && cs > 0) k = calm ? 0.5 : Math.sin(t * 12) > 0 ? 0.9 : 0.2;
          if (pw < 0.05) tmp.copy(off);
          else tmp.copy(dim).lerp(lit, k).multiplyScalar(0.3 + 0.7 * pw);
          if (f > 0) tmp.lerp(new THREE.Color(1, 1, 1), f * 0.8);
          o.bulbs.setColorAt(i, tmp);
        }
        o.bulbs.instanceColor.needsUpdate = true;
      }
      // the chromatrope turns while linked; the pad lever throws
      spin += ((linked ? pw * 2.6 : 0) - spin) * Math.min(1, dt * 1.5);
      if (o.spin) o.spin.rotation.z += spin * dt;
      if (o.lever) {
        leverA += ((linked ? 0.7 : -0.7) - leverA) * Math.min(1, dt * 10);
        o.lever.rotation.x = leverA;
      }
      // light: the projector's beam, the burst's rays and flash
      o.beamMat.opacity = (o.pad ? f * 0.9 : pw * (linked ? 0.05 + 0.2 * cs : 0) + f * 0.75) * (calm ? 0.7 : 1);
      o.flashMat.opacity = f * (calm ? 0.6 : 1);
      if (o.rayMat) {
        o.rayMat.opacity = f * (calm ? 0.35 : 0.8);
        o.rays.visible = f > 0.002;
        o.rays.rotation.y = t * 0.8;
        o.rays.scale.set(0.8 + 0.5 * (1 - f), 0.6 + 0.5 * (1 - f), 0.8 + 0.5 * (1 - f));
      }
      if (o.flare) o.flare.material.opacity = pw * (linked ? 0.15 + 0.5 * cs : 0.06) + f;
      o.light.intensity = pw * (0.6 + 3 * cs) + f * (calm ? 8 : 26);
      // skip the draw of any additive layer that is dark
      for (const m of [o.beamMat, o.flashMat, o.flare?.material]) if (m) m.visible = m.opacity > 0.003;
    },
  });
  g.userData.update(0, 0);
  return g;
}

// ==============================================================================================
// Traps
// ==============================================================================================

const ARC_SEG = 16, ARC_QUADS = 4; // per segment: a thin core and a wide glow, each as two crossed ribbons

/**
 * An electric gate across a doorway: two insulated electrode posts at
 * x = +-width/2 (height tall), with jagged arcs between them when active.
 * userData: setActive(on), setCalm(on), update(dt, t), light, width, height.
 */
export function buildSparkGate(width = 2, height = 2.4) {
  const K = kit(), w2 = width / 2;
  const levels = [0.3, 0.55, 0.8].map((k) => k * height);
  const geos = once(`gate:${width.toFixed(2)}:${height.toFixed(2)}`, () => {
    const b = newBatch(), I = b.get('iron'), P = b.get('porcelain'), Cu = b.get('copper'), H = b.get('hazard'), S = b.get('steel');
    for (const s of [-1, 1]) {
      const x = s * w2;
      cbox(I, 0.26, 0.1, 0.26, 0.02, mat(x, 0.05, 0), 0.7);
      H.tbox(mat(x, 0.13, 0), 0.2, 0.06, 0.2, 1, 0.3);
      I.geo(prism(0.035, 0.04, height - 0.2, 6), mat(x, 0.1 + (height - 0.2) / 2, 0), 0.7);
      for (let y = 0.22; y < height - 0.22; y += 0.075) P.geo(prism(0.095, 0.06, 0.05, 8), mat(x, y, 0), [0.78, 0.52, 0.38]);
      Cu.geo(prism(0.06, 0.09, 0.08, 8), mat(x, height - 0.12, 0), 1);
      Cu.geo(prism(0.018, 0.024, 0.42, 6), mat(x - s * 0.12, height + 0.07, 0, 0, 0, s * 0.72), 1);
      for (const y of levels) {
        Cu.geo(prism(0.014, 0.014, 0.16, 6), mat(x - s * 0.1, y, 0, 0, 0, Math.PI / 2), 1);
        cbox(Cu, 0.055, 0.055, 0.055, 0.018, mat(x - s * 0.19, y, 0), 1.2);
      }
      S.geo(prism(0.025, 0.025, 0.8, 6), mat(x + s * 0.4, 0.03, 0, 0, 0, Math.PI / 2), 0.35);
    }
    return bake(b);
  });
  const g = new THREE.Group();
  g.name = 'sparkGate';
  addMeshes(g, geos, { iron: K.iron, porcelain: K.porcelain, copper: K.copper, hazard: K.hazard, steel: K.steel });
  // arcs: electrode tips at each level plus the horn tips on top
  const ends = levels.map((y) => [V3(-w2 + 0.22, y, 0), V3(w2 - 0.22, y, 0)]);
  const horn = 0.12 + Math.sin(0.72) * 0.21;
  ends.push([V3(-w2 + horn, height + 0.07 + Math.cos(0.72) * 0.21, 0), V3(w2 - horn, height + 0.07 + Math.cos(0.72) * 0.21, 0)]);
  // each bolt has a fork: bolts 0..n-1 run tip to tip, n..2n-1 split off them
  const nMain = ends.length, nArc = nMain * 2, vPerArc = ARC_SEG * ARC_QUADS * 4;
  const pos = new Float32Array(nArc * vPerArc * 3), col = new Float32Array(nArc * vPerArc * 3), idx = [];
  for (let q = 0; q < nArc * ARC_SEG * ARC_QUADS; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  for (let v = 0; v < nArc * vPerArc; v++) {
    const core = Math.floor(v / 4) % ARC_QUADS < 2, fork = v >= nMain * vPerArc;
    col.set(core ? (fork ? [0.6, 0.72, 0.95] : [0.88, 0.94, 1]) : (fork ? [0.08, 0.14, 0.4] : [0.16, 0.26, 0.62]), v * 3);
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  ag.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ag.setIndex(idx);
  const arcMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const arcs = new THREE.Mesh(ag, arcMat);
  arcs.name = 'arcs';
  arcs.frustumCulled = false;
  arcs.visible = false;
  const tips = new THREE.Points(new THREE.BufferGeometry().setFromPoints(ends.flat()), new THREE.PointsMaterial({
    map: K.T.dot, color: 0x9fc4ff, size: 0.38, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  tips.name = 'tips';
  tips.visible = false;
  g.add(arcs, tips);
  const light = new THREE.PointLight(0x9fc4ff, 0, 5, 1.6);
  light.position.set(0, height * 0.55, 0.3);
  g.add(light);

  const pts = Array.from({ length: ARC_SEG + 1 }, () => V3(0, 0, 0)), A = V3(0, 0, 0), B = V3(0, 0, 0);
  const R = Math.random;
  // Midpoint displacement: a jagged bolt pinned at both ends, kinked at every joint.
  const bolt = (from, to, amp) => {
    pts[0].copy(from); pts[ARC_SEG].copy(to);
    let step = ARC_SEG, a = amp;
    while (step > 1) {
      const h = step / 2;
      for (let i = h; i < ARC_SEG; i += step) {
        pts[i].lerpVectors(pts[i - h], pts[i + h], 0.5);
        pts[i].y += (R() - 0.5) * a;
        pts[i].z += (R() - 0.5) * a;
      }
      step = h;
      a *= 0.64;
    }
  };
  const write = (arc) => {
    let v = arc * vPerArc;
    const put = (p, ax, o) => { pos[v * 3] = p.x; pos[v * 3 + 1] = p.y + (ax === 1 ? o : 0); pos[v * 3 + 2] = p.z + (ax === 2 ? o : 0); v++; };
    for (let j = 0; j < ARC_SEG; j++) {
      const p = pts[j], q = pts[j + 1];
      for (const [wd, ax] of [[0.012, 1], [0.012, 2], [0.06, 1], [0.06, 2]]) {
        put(p, ax, -wd); put(p, ax, wd); put(q, ax, wd); put(q, ax, -wd);
      }
    }
  };
  const reroll = (amp, forks) => {
    ends.forEach(([from, to], i) => {
      bolt(from, to, amp);
      write(i);
      A.copy(pts[4 + Math.floor(R() * 9)]);
      B.set(A.x + (R() - 0.5) * 0.6, A.y - 0.05 - R() * 0.3, A.z + (R() - 0.5) * 0.3);
      if (forks) bolt(A, B, amp * 0.45);
      else for (const p of pts) p.copy(A);
      write(nMain + i);
    });
    ag.attributes.position.needsUpdate = true;
  };
  let calm = false, active = false, next = 0, level = 0, glowK = 1;
  Object.assign(g.userData, {
    kind: 'sparkGate', light, width, height,
    setActive(on) { active = !!on; if (active) next = 0; },
    setCalm(on) { calm = !!on; },
    update(dt, t) {
      level += ((active ? 1 : 0) - level) * Math.min(1, dt * (active ? 20 : 8));
      arcs.visible = tips.visible = level > 0.02;
      if (!arcs.visible) { light.intensity = 0; return; }
      next -= dt;
      if (next <= 0) {
        reroll((calm ? 0.16 : 0.3) * Math.sqrt(width), !calm);
        next = calm ? 0.28 : 0.045;
        glowK = calm ? 0.6 : 0.55 + 0.45 * R();
      }
      arcMat.color.setScalar(level * glowK);
      tips.material.opacity = level * (calm ? 0.55 : 0.6 + 0.4 * glowK);
      light.intensity = level * (calm ? 3 : 2 + 4 * glowK);
    },
  });
  return g;
}

/**
 * A trap's wall switch: a steel box with a lever and two lamps (green ready,
 * red cooldown). The origin is on the floor at the wall (its back), the box
 * centred 1.3 m up, standing out along +Z.
 * userData: setState('off' | 'ready' | 'active' | 'cooldown'), setCalm(on),
 * update(dt, t), use.
 */
export function buildTrapSwitch() {
  const K = kit(), Y = 1.3;
  const geos = once('trapSwitch', () => {
    const b = newBatch(), S = b.get('steel'), H = b.get('hazard');
    const paint = [0.58, 0.7, 0.6];
    cbox(S, 0.4, 0.62, 0.02, 0.008, mat(0, Y, 0.01), 0.42);
    cbox(S, 0.32, 0.46, 0.13, 0.02, mat(0, Y, 0.085), paint);
    H.tbox(mat(0, Y - 0.19, 0.152), 0.28, 0.06, 0.006, 1, 0.25);
    S.tbox(mat(0, Y - 0.03, 0.152), 0.05, 0.24, 0.006, 0.06, 1);
    S.geo(prism(0.035, 0.035, 0.03, 8), mat(0, Y + 0.08, 0.16, 0, Math.PI / 2), 0.9);
    for (const x of [-0.09, 0.09]) ring(S, mat(x, Y + 0.17, 0.16), 0.026, 0.038, 0.03, 6, 0.8);
    for (const [x, y] of [[-0.17, 0.27], [0.17, 0.27], [-0.17, -0.27], [0.17, -0.27]]) boltZ(S, mat(x, Y + y, 0.022), 0.9);
    S.geo(prism(0.022, 0.022, 0.7, 6), mat(0.1, Y + 0.58, 0.035), 0.55);
    cbox(S, 0.07, 0.05, 0.07, 0.01, mat(0.1, Y + 0.25, 0.04), 0.7);
    const lb = newBatch();
    lb.get('steel').geo(prism(0.012, 0.016, 0.2, 6), mat(0, 0.1, 0), 0.95);
    cbox(lb.get('steel'), 0.05, 0.075, 0.05, 0.015, mat(0, 0.22, 0), [1.5, 0.32, 0.26]);
    return { geos: bake(b, null), lever: bake(lb, null) };
  });
  const g = new THREE.Group();
  g.name = 'trapSwitch';
  addMeshes(g, geos.geos, { steel: K.steel, hazard: K.hazard });
  const lever = new THREE.Group();
  lever.position.set(0, Y + 0.08, 0.175);
  addMeshes(lever, geos.lever, { steel: K.steel });
  const lamps = new THREE.InstancedMesh(parts().bulb, new THREE.MeshBasicMaterial({ color: 0xffffff }), 2);
  const M = new THREE.Matrix4();
  [-0.09, 0.09].forEach((x, i) => {
    lamps.setMatrixAt(i, M.compose(V3(x, Y + 0.17, 0.165), new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), Math.PI / 2), V3(0.8, 0.8, 0.8)));
    lamps.setColorAt(i, new THREE.Color(0, 0, 0));
  });
  lamps.name = 'lamps';
  g.add(lever, lamps);
  const green = new THREE.Color(), red = new THREE.Color();
  let calm = false, state = 'off', st = 0, angle = 0.3;
  Object.assign(g.userData, {
    kind: 'trapSwitch', use: V3(0, 0, 0.8), mount: 'wall',
    setState(s) { if (s !== state) { state = s; st = 0; } },
    setCalm(on) { calm = !!on; },
    update(dt, t) {
      st += dt;
      // up for off/ready, thrown down while active, easing back up over the cooldown
      const down = state === 'active';
      const rate = down ? 14 : state === 'cooldown' ? 1.6 : 6;
      angle += ((down ? 2.5 : 0.3) - angle) * Math.min(1, dt * rate);
      lever.rotation.x = angle;
      const blink = calm ? 1 : Math.sin(st * TAU * 2.5) > -0.2 ? 1 : 0.15;
      const gk = state === 'ready' ? 1 : 0, rk = state === 'cooldown' ? 1 : state === 'active' ? blink : 0;
      green.setRGB(0.05 + 0.4 * gk, 0.08 + 0.92 * gk, 0.05 + 0.4 * gk);
      red.setRGB(0.1 + 0.9 * rk, 0.04 + 0.2 * rk, 0.03 + 0.14 * rk);
      lamps.setColorAt(0, green);
      lamps.setColorAt(1, red);
      lamps.instanceColor.needsUpdate = true;
    },
  });
  g.userData.update(0, 0);
  return g;
}

// ==============================================================================================
// The main breaker
// ==============================================================================================

/**
 * The main power breaker: a big double-pole knife switch in an open iron
 * cabinet, a MAIN POWER plate with two lamps, a voltmeter and conduits. The
 * origin is on the floor at the wall, the cabinet centred 1.35 m up.
 * userData: setOn(on, instant = false) (the lever throws over ~0.5 s, sparks,
 * lamps light), setCalm(on), update(dt, t), use, light.
 */
export function buildBreaker() {
  const K = kit(), Y = 1.35;
  const B = once('breaker', () => {
    const sign = signAtlas(64, [{ rect: [0, 0, 64, 32], lines: [{ text: 'MAIN', y: 2 }, { text: 'POWER', y: 17 }] }], [255, 214, 150]);
    const b = newBatch(), S = b.get('steel'), I = b.get('iron'), P = b.get('porcelain'), Cu = b.get('copper'), H = b.get('hazard'), Br = b.get('brass');
    const paint = [0.5, 0.58, 0.5];
    S.tbox(mat(0, Y, 0.015), 0.8, 1.05, 0.03, paint.map((v) => v * 0.7), 1);
    for (const s of [-1, 1]) {
      S.tbox(mat(s * 0.385, Y, 0.13), 0.03, 1.05, 0.26, paint, 1);
      S.tbox(mat(0, Y + s * 0.51, 0.13), 0.8, 0.03, 0.26, paint, 1);
    }
    I.tbox(mat(0, Y - 0.03, 0.04), 0.66, 0.9, 0.02, 0.55, 1);
    for (const x of [-0.12, 0.12]) {
      for (const y of [0.3, -0.26]) cbox(P, 0.1, 0.08, 0.05, 0.012, mat(x, Y + y, 0.075), 0.9);
      for (const d of [-0.02, 0.02]) {
        Cu.tbox(mat(x + d, Y + 0.32, 0.12), 0.008, 0.09, 0.05, 1, 0.5);
        Cu.tbox(mat(x + d, Y - 0.26, 0.12), 0.008, 0.07, 0.04, 1, 0.5);
      }
      Cu.geo(prism(0.018, 0.018, 0.2, 6), mat(x, Y + 0.44, 0.075), 0.8);
    }
    // the door, swung open on its left hinge
    const dm = mat(-0.4, Y, 0.26, -2.0);
    cbox(S, 0.8, 1.04, 0.03, 0.01, at(dm, 0.4, 0, 0), paint);
    H.tbox(at(dm, 0.4, -0.4, 0.017), 0.7, 0.08, 0.006, 1, 0.25);
    cbox(S, 0.03, 0.12, 0.05, 0.01, at(dm, 0.74, 0, -0.03), 0.9);
    // voltmeter
    b.get('dial').geo(polyGeo(ngon(0.065, 10), 0.13), mat(0.24, Y + 0.36, 0.053), 1);
    ring(Br, mat(0.24, Y + 0.36, 0.06), 0.064, 0.082, 0.025, 10, 1);
    // MAIN POWER plate, lamp cages and conduits
    const pm = mat(0, Y + 0.72, 0.03);
    cbox(S, 0.74, 0.26, 0.03, 0.01, pm, 0.45);
    b.get('sign').geo(quadGeo(0.44, 0.22, sign.uvs[0]), at(pm, 0, 0, 0.0165), 0.45);
    for (const x of [-0.29, 0.29]) ring(S, mat(x, Y + 0.72, 0.06), 0.044, 0.058, 0.03, 6, 0.45);
    for (const x of [-0.42, 0.42]) S.geo(prism(0.03, 0.03, 1.3, 6), mat(x, Y + 0.45 + 0.65, 0.05), 0.55);
    const geos = bake(b, null);
    const lb = newBatch(), L = lb.get('copper');
    for (const x of [-0.12, 0.12]) L.tbox(mat(x, 0.28, 0), 0.012, 0.58, 0.03, 1.1, 0.5);
    L.tbox(mat(0, 0.5, 0), 0.34, 0.06, 0.06, 0.2, 1);
    L.geo(prism(0.026, 0.034, 0.24, 6), mat(0, 0.5, 0.13, 0, Math.PI / 2), [0.95, 0.3, 0.26]);
    cbox(L, 0.09, 0.09, 0.09, 0.025, mat(0, 0.5, 0.27), [1.05, 0.32, 0.28]);
    const nb = newBatch();
    nb.get('iron').tbox(mat(0, 0.026, 0.002), 0.01, 0.06, 0.004, 0.25, 1);
    return { sign, geos, lever: bake(lb, null), needle: bake(nb, null) };
  });
  const sign = litMat(B.sign.map, B.sign.emissive);
  const g = new THREE.Group();
  g.name = 'breaker';
  addMeshes(g, B.geos, { steel: K.steel, iron: K.iron, porcelain: K.porcelain, copper: K.copper, hazard: K.hazard, brass: K.brass, dial: K.dial, sign });
  const lever = new THREE.Group();
  lever.position.set(0, Y - 0.26, 0.12);
  addMeshes(lever, B.lever, { copper: K.copper });
  const needle = new THREE.Group();
  needle.position.set(0.24, Y + 0.36, 0.056);
  addMeshes(needle, B.needle, { iron: K.iron });
  const lamps = new THREE.InstancedMesh(parts().bulb, new THREE.MeshBasicMaterial({ color: 0xffffff }), 2);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), Math.PI / 2);
  [-0.29, 0.29].forEach((x, i) => { lamps.setMatrixAt(i, M.compose(V3(x, Y + 0.72, 0.045), q, V3(1.25, 1.25, 1.25))); lamps.setColorAt(i, new THREE.Color(0, 0, 0)); });
  lamps.name = 'lamps';
  const sparks = new Sparks(60, [0.75, 0.85, 1]);
  g.add(lever, needle, lamps, sparks.mesh);
  const light = new THREE.PointLight(0xcfe0ff, 0, 4, 1.6);
  light.position.set(0, Y + 0.3, 0.55);
  g.add(light);

  const OFF = 1.95, lampOn = new Neon(601, { boot: 0.5, sputter: 0.4, hum: 0.04 });
  const amber = new THREE.Color();
  let calm = false, on = false, angle = OFF, from = OFF, throwT = -1, flash = 0, needleA = 0, needleV = 0;
  Object.assign(g.userData, {
    kind: 'breaker', use: V3(0, 0, 0.85), light, mount: 'wall',
    setOn(v, instant = false) {
      v = !!v;
      if (v === on && throwT < 0) return;
      on = v;
      if (instant) { angle = on ? 0 : OFF; throwT = -1; lampOn.set(on); if (on) lampOn.bootT = 0; return; }
      from = angle;
      throwT = 0;
      if (!on) lampOn.set(false);
    },
    setCalm(c) { calm = !!c; },
    update(dt, t) {
      if (throwT >= 0) {
        // a heavy lever: slow to start, then it falls into the jaws
        throwT += dt;
        const u = Math.min(1, throwT / 0.5);
        angle = lerp(from, on ? 0 : OFF, u * u);
        if (u >= 1) {
          throwT = -1;
          const n = on ? (calm ? 10 : 26) : 6;
          for (const x of [-0.12, 0.12]) sparks.burst(n / 2, x, Y + 0.32, 0.14, [0, 0.4, 1], on ? 2.2 : 1.4, 1.4);
          if (on) { flash = 1; lampOn.set(true); }
        }
      }
      lever.rotation.x = angle;
      flash = Math.max(0, flash - dt * (calm ? 1.5 : 3));
      const lv = lampOn.step(dt, t, calm);
      amber.setRGB(0.05 + 0.95 * lv, 0.03 + 0.42 * lv, 0.02 + 0.08 * lv);
      lamps.setColorAt(0, amber);
      lamps.setColorAt(1, amber);
      lamps.instanceColor.needsUpdate = true;
      sign.emissiveIntensity = lv * 0.9;
      light.color.setRGB(1, lerp(0.75, 0.9, flash), lerp(0.45, 1, flash));
      light.intensity = lv * 1.4 + flash * (calm ? 2.5 : 8);
      needleV += (((on && throwT < 0 ? 0.72 : 0) - needleA) * 50 - needleV * 6) * dt;
      needleA += needleV * dt;
      needle.rotation.z = 2.3 - clamp01(needleA) * 4.6;
      sparks.update(dt);
    },
  });
  g.userData.update(0, 0);
  return g;
}

// ==============================================================================================
// The box token
// ==============================================================================================

/**
 * A moth-eaten plush rabbit with one button eye, one stitched-shut eye and a
 * flopped ear, hovering and turning (shown over the mystery box when it moves
 * away). Origin at its feet.
 * userData: update(dt, t), setCalm(on).
 */
export function buildBoxToken() {
  const K = kit();
  const geos = once('token', () => {
    const b = newBatch(), P = b.get('plush'), C = b.get('cream'), S = b.get('steel');
    const R = mulberry32(77);
    const FIT = [0.3, 0.3, 0.3];
    const blob = (cx, cy, cz, rx, ry, rz, n = 7) => {
      const pts = [];
      for (const [t, k] of [[-1, 0.4], [-0.55, 0.86], [0, 1], [0.55, 0.86], [1, 0.4]]) {
        for (let i = 0; i < n; i++) {
          const a = ((i + (R() - 0.5) * 0.3) / n) * TAU, j = 1 + (R() - 0.5) * 0.12;
          pts.push(V3(cx + Math.sin(a) * rx * k * j, cy + t * ry, cz + Math.cos(a) * rz * k * j));
        }
      }
      return hull(pts, FIT);
    };
    const pink = [1.18, 0.86, 0.84];
    P.geo(blob(0, 0.105, 0, 0.1, 0.105, 0.085), new THREE.Matrix4(), 1);                      // body
    P.geo(blob(0, 0.265, 0.01, 0.085, 0.075, 0.075), new THREE.Matrix4(), 1.05);               // head
    P.geo(blob(0, 0.245, 0.07, 0.042, 0.03, 0.028, 6), new THREE.Matrix4(), 1.2);              // muzzle
    P.geo(blob(0, 0.262, 0.098, 0.014, 0.01, 0.01, 5), new THREE.Matrix4(), pink);             // nose
    for (const s of [-1, 1]) {
      P.geo(blob(s * 0.1, 0.13, 0.03, 0.032, 0.055, 0.032, 6), mat(0, 0, 0, 0, 0, s * 0.35), 0.95);   // arms
      P.geo(blob(s * 0.055, 0.03, 0.08, 0.042, 0.03, 0.058, 6), new THREE.Matrix4(), 0.98);          // feet
      C.geo(polyGeo(ngon(0.03, 6), 0.06), mat(s * 0.055, 0.03, 0.14), pink.map((v) => v * 0.8));      // soles
    }
    C.geo(blob(0, 0.065, -0.09, 0.03, 0.03, 0.025, 5), new THREE.Matrix4(), 1);                // tail
    // ears: the left one up, the right one flopped over with stuffing showing
    const ear = [[-0.026, 0], [0.026, 0], [0.032, 0.08], [0.014, 0.16], [-0.014, 0.16], [-0.032, 0.08]];
    const lm = mat(-0.035, 0.32, 0, 0, 0, 0.22);
    P.geo(slab(ear, 0.02, FIT), lm, 1);
    P.geo(slab(ear.map(([x, y]) => [x * 0.55, y * 0.8 + 0.02]), 0.01, FIT), at(lm, 0, 0, 0.011), pink);
    const rm = mat(0.035, 0.32, 0, 0, 0, -0.28);
    P.geo(slab([[-0.026, 0], [0.026, 0], [0.024, 0.075], [-0.024, 0.075]], 0.02, FIT), rm, 1);
    P.geo(slab(ear.map(([x, y]) => [x, y * 0.7]), 0.02, FIT), at(rm, 0, 0.07, 0, 0, 0, -2.1), 0.92);
    C.geo(blob(0.06, 0.39, 0.0, 0.018, 0.016, 0.018, 5), new THREE.Matrix4(), 1.15);
    // one button eye, one stitched shut, a stitched mouth; a patch on the belly
    S.geo(prism(0.017, 0.017, 0.01, 8), mat(-0.032, 0.28, 0.081, 0, Math.PI / 2 - 0.25), 0.18);
    C.tbox(mat(-0.032, 0.28, 0.087, 0, -0.25, 0.8), 0.018, 0.004, 0.002, 0.9, 0.2);
    for (const r of [0.8, -0.8]) S.tbox(mat(0.033, 0.28, 0.081, 0, -0.25, r), 0.028, 0.005, 0.004, 0.12, 1);
    S.tbox(mat(0, 0.232, 0.092, 0, -0.4), 0.004, 0.02, 0.004, 0.12, 1);
    for (const r of [0.5, -0.5]) S.tbox(mat(r * 0.02, 0.224, 0.09, 0, -0.4, r * 1.6), 0.018, 0.004, 0.004, 0.12, 1);
    const pm = mat(0.025, 0.1, 0.082, 0.2, -0.1, 0.15);
    P.geo(slab([[-0.035, -0.035], [0.035, -0.035], [0.035, 0.035], [-0.035, 0.035]], 0.008, [0.1, 0.1, 0.1]), pm, [0.55, 0.66, 0.9]);
    for (let k = 0; k < 4; k++) C.tbox(at(pm, -0.03 + k * 0.02, 0.037, 0.005), 0.004, 0.012, 0.003, 0.9, 0.2);
    return bake(b, null);
  });
  const g = new THREE.Group();
  g.name = 'boxToken';
  const toy = new THREE.Group();
  toy.scale.setScalar(1.35);
  addMeshes(toy, geos, { plush: K.plush, cream: K.cream, steel: K.steel });
  const halo = glowSprite(0x8cbfff, 0.75, 0.75);
  halo.material.opacity = 0.3;
  g.add(toy, halo);
  Object.assign(g.userData, {
    kind: 'boxToken',
    setCalm() {},
    update(dt, t) {
      toy.rotation.y = t * 1.8;
      toy.rotation.z = 0.08 * Math.sin(t * 1.7);
      toy.position.y = 0.08 + 0.04 * Math.sin(t * 2.3);
      halo.position.y = toy.position.y + 0.3;
    },
  });
  g.userData.update(0, 0);
  return g;
}
