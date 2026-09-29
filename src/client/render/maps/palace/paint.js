// The picture palace's own textures: velvet, carpet, gilt, damask, panelling,
// mahogany, cream plaster, glazed terracotta, linen and the tattered screen, plus
// canvas atlases of original posters and signs. Every tiling page is painted twice
// from one resolution-free function: a small page with hard, quantised ramp steps
// (the "1997" page, userData.painted) and a smooth page twice the size for the
// plain look. retro.js swaps between them like the world's own textures.

import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/rng.js';
import { prepareRetroTextures, setRetroTextures } from '../../retro.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);

// Ramps run dark to light, cool shadows to warm highlights (art/STYLE.md), no more
// saturated than the chalk red. Wood, plaster and brick match textures.js.
const RAMPS = {
  velvet: [[26, 11, 13], [42, 15, 17], [60, 20, 21], [82, 26, 25], [106, 34, 31], [130, 45, 38], [152, 60, 48], [172, 80, 62]],
  dust: [[52, 44, 44], [74, 64, 62], [98, 86, 80], [122, 108, 98]],
  carpet: [[38, 14, 16], [56, 20, 20], [76, 27, 25], [98, 36, 31], [120, 47, 38], [140, 60, 46]],
  gold: [[44, 32, 16], [66, 50, 24], [92, 70, 34], [120, 94, 46], [148, 118, 62], [174, 144, 82], [198, 172, 110], [218, 198, 144]],
  bole: [[52, 22, 16], [76, 34, 22], [98, 48, 30]],
  teal: [[18, 34, 34], [26, 48, 46], [36, 64, 60], [50, 82, 74], [68, 100, 88]],
  rose: [[56, 36, 37], [76, 50, 49], [98, 65, 61], [120, 81, 73], [140, 97, 85], [158, 113, 97], [174, 130, 110], [190, 148, 126]],
  night: [[12, 16, 28], [18, 24, 40], [26, 34, 54], [36, 46, 70], [48, 60, 86], [62, 76, 102], [78, 92, 116]],
  plaster: [[40, 43, 38], [57, 59, 51], [76, 77, 66], [96, 95, 81], [116, 113, 96], [136, 132, 112], [156, 150, 128]],
  wood: [[22, 16, 13], [30, 22, 18], [46, 34, 26], [64, 48, 34], [86, 66, 46], [108, 84, 58], [132, 104, 72]],
  mahog: [[18, 9, 8], [28, 14, 11], [40, 20, 15], [54, 28, 20], [70, 37, 25], [88, 48, 32], [108, 62, 41], [128, 78, 52]],
  cream: [[58, 54, 44], [78, 72, 58], [100, 92, 74], [122, 112, 90], [142, 131, 106], [160, 148, 120], [176, 164, 134], [190, 178, 148]],
  terra: [[44, 42, 36], [62, 58, 48], [82, 76, 62], [102, 94, 77], [122, 112, 92], [140, 129, 106], [158, 146, 120], [174, 162, 134]],
  linen: [[64, 62, 56], [86, 83, 75], [108, 104, 94], [130, 125, 113], [150, 144, 130], [168, 161, 146], [184, 177, 160]],
  soot: [[14, 13, 13], [22, 20, 19], [32, 29, 27]],
  screen: [[70, 70, 66], [96, 95, 88], [122, 120, 110], [146, 143, 130], [168, 164, 148], [186, 182, 164]],
};

// --- Periodic value noise (u, v in 0..1 wrap) ------------------------------------------------

function hash(ix, iy, s) {
  let h = (ix * 374761393 + iy * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vn(u, v, cx, cy, s) {
  const fx = fract(u) * cx, fy = fract(v) * cy;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const sx = fx - x0, sy = fy - y0;
  const ex = sx * sx * (3 - 2 * sx), ey = sy * sy * (3 - 2 * sy);
  const x1 = (x0 + 1) % cx, y1 = (y0 + 1) % cy;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * ex + (c - a) * ey + (a - b - c + d) * ex * ey;
}
export function fbm(u, v, cx, cy, s, oct = 3) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += vn(u, v, cx << o, cy << o, s + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// --- The painter -----------------------------------------------------------------------------
// fn(u, v, tone, px) -> [r, g, b(, a)]. tone(ramp, value 0..1) is quantised to the ramp's
// steps on the small page and interpolated on the big one; px is one texel in u.

function toneFn(quant) {
  return (name, v) => {
    const r = RAMPS[name];
    const t = clamp01(v) * (r.length - 1);
    if (quant) return r[Math.round(t)];
    const i = Math.min(r.length - 2, Math.floor(t)), f = t - i;
    return r[i].map((c, k) => c + (r[i + 1][k] - c) * f);
  };
}

function canvasOf(w, h, fn, quant) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const tone = toneFn(quant);
  const px = 1 / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn((x + 0.5) / w, (y + 0.5) / h, tone, px);
      const i = (y * w + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Blend two colours.
const mixc = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);

// --- Pages -----------------------------------------------------------------------------------

// Theatre drapes: deep folds down the cloth, crushed pile, dust on the crests, moth holes.
function drape(u, v, tone) {
  const w = 0.08 * Math.sin(TAU * (v * 1 + u * 0.3));
  const f = 0.5 + 0.5 * Math.sin(TAU * (u * 3 + w));
  const g = 0.5 + 0.5 * Math.sin(TAU * (u * 7 + 0.3 + w * 2));
  const crush = fbm(u, v, 6, 3, 11, 2);
  let val = 0.1 + 0.62 * Math.pow(f, 1.4) + 0.12 * g * f + (crush - 0.5) * 0.18;
  const dust = fbm(u, v, 3, 2, 12, 2);
  const hole = fbm(u, v, 24, 16, 13, 1);
  if (hole > 0.9) return tone('velvet', 0);
  let c = tone('velvet', val);
  if (f > 0.75 && dust > 0.6) c = mixc(c, tone('dust', val * 0.9), 0.45);
  return c;
}

// Seat plush: worn shiny where people sat, stained in clusters.
function plush(u, v, tone) {
  const a = fbm(u, v, 3, 3, 21, 2), b = fbm(u, v, 12, 12, 22, 1);
  let val = 0.46 + (a - 0.5) * 0.3 + (b > 0.66 ? 0.08 : b < 0.33 ? -0.08 : 0);
  const worn = fbm(u, v, 2, 2, 23, 2);
  const stain = fbm(u, v, 5, 5, 24, 2);
  if (stain < 0.28) val -= 0.18;
  let c = tone('velvet', val);
  if (worn > 0.68) c = mixc(c, tone('dust', 0.45 + (worn - 0.68)), 0.5);
  return c;
}

// Foyer carpet: a burgundy ground with a gold diamond lattice, teal-and-gold rosettes and
// dots at the crossings, trodden pale and grey along the paths, with old stains.
function carpet(u, v, tone) {
  const N = 3;
  const p = fract(u * N) - 0.5, q = fract(v * N) - 0.5;
  const r = Math.hypot(p, q), th = Math.atan2(q, p);
  const diag = Math.min(Math.abs(Math.abs(p) + Math.abs(q) - 0.5), 1);
  let c;
  const petal = 0.2 + 0.08 * Math.cos(4 * th);
  if (diag < 0.035) c = tone('gold', 0.55);
  else if (r < 0.06) c = tone('gold', 0.8);
  else if (r < petal && r > petal - 0.05) c = tone('gold', 0.45);
  else if (r < petal - 0.05) c = tone('teal', 0.5 + 0.3 * Math.cos(4 * th));
  else if (Math.hypot(Math.abs(p) - 0.5, Math.abs(q)) < 0.06 || Math.hypot(Math.abs(p), Math.abs(q) - 0.5) < 0.06) c = tone('teal', 0.7);
  else {
    const scroll = Math.sin(TAU * (p * 4 + q * 4)) * Math.sin(TAU * (p * 4 - q * 4));
    c = tone('carpet', 0.42 + (scroll > 0.55 ? 0.22 : 0) + (fbm(u, v, 8, 8, 31, 1) - 0.5) * 0.18);
  }
  const worn = fbm(u, v, 2, 2, 32, 3);
  if (worn > 0.6) c = mixc(c, tone('dust', 0.3 + (worn - 0.6) * 1.2), clamp01((worn - 0.6) * 3));
  const stain = fbm(u, v, 4, 4, 33, 2);
  if (stain < 0.26) c = c.map((x) => x * 0.62);
  return c;
}

// Tarnished gold leaf: dark in the crevices, rubbed bright on the high spots, flaked
// back to the red bole in places.
function gilt(u, v, tone) {
  const a = fbm(u, v, 4, 4, 41, 3), b = fbm(u, v, 16, 16, 42, 1);
  let val = 0.4 + (a - 0.5) * 0.5 + (b - 0.5) * 0.14;
  if (a < 0.32) val -= 0.2;
  if (b > 0.78) val += 0.16;
  const flake = fbm(u, v, 7, 7, 43, 2);
  if (flake > 0.7) return tone('bole', 0.4 + (b - 0.5));
  return tone('gold', val);
}

// Damask wallpaper: dusty rose, a darker damask motif in a half-drop repeat, soot at the
// top, water runs from the ceiling, grime at the foot, peeling back to plaster.
function damask(u, v, tone) {
  // Two motifs across a tile, half-dropped.
  const col = Math.floor(u * 2);
  const cx = fract(u * 2) * 2 - 1;
  const cy = fract(v * 2 + (col ? 0.5 : 0)) * 2 - 1;
  const x = Math.abs(cx), y = cy;
  const ell = (ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2;
  const body = ell(0, 0.05, 0.22, 0.6) < 1;
  const eye = ell(0, 0.0, 0.1, 0.3) < 1;
  const scroll = Math.abs(Math.sqrt(ell(0.42, -0.35, 1, 1)) - 0.2) < 0.06;
  const leaf = ell(0.34, 0.38, 0.14, 0.26) < 1;
  const tip = ell(0, -0.78, 0.08, 0.14) < 1 || ell(0, 0.82, 0.12, 0.1) < 1;
  const motif = (body && !eye) || scroll || leaf || tip;
  let val = 0.46 + (fbm(u, v, 4, 4, 51, 2) - 0.5) * 0.14;
  if (motif) val -= 0.18;
  if (eye) val += 0.04;
  // soot along the top of the tile row (tiles repeat every 2 m; this reads as a patina)
  val -= 0.1 * smooth01(0.4, 0, v) + 0.12 * (fbm(u, v, 3, 1, 52, 2) > 0.62 ? 1 : 0) * smooth01(0.6, 0.1, v);
  // water runs
  const run = fbm(u, 0, 9, 1, 53, 1);
  if (run > 0.72 && fbm(u, v, 9, 3, 54, 1) > 0.35) val -= 0.14;
  // peeling patches
  const peel = fbm(u, v, 3, 3, 55, 3);
  if (peel > 0.7) return tone('plaster', 0.35 + (fbm(u, v, 10, 10, 56, 1) - 0.5) * 0.2 + (peel < 0.72 ? -0.2 : 0));
  if (peel > 0.67) val += 0.14;   // the lifted edge catches the light
  return tone('rose', val);
}
function smooth01(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

// Raised panelling in dark varnished wood: frame, bevel (lit top-left), flat field.
function panel(u, v, tone) {
  const fx = Math.min(u, 1 - u), fy = Math.min(v, 1 - v);
  const grainV = fbm(u * 1, v, 2, 12, 61, 2), grainH = fbm(u, v, 12, 2, 62, 2);
  const frame = fx < 0.12 || fy < 0.12;
  let val;
  if (frame) val = 0.42 + (fx < 0.12 && fy >= 0.12 ? grainV - 0.5 : grainH - 0.5) * 0.3;
  else {
    const bx = fx - 0.12, by = fy - 0.12;
    if (bx < 0.06 || by < 0.06) val = (u < 0.5 && bx < by) || (v < 0.5 && by <= bx) ? 0.62 : 0.2;
    else val = 0.36 + (grainV - 0.5) * 0.28;
  }
  if (fx < 0.02 || fy < 0.02) val = 0.12;
  return tone('mahog', val + (fbm(u, v, 3, 3, 63, 2) - 0.5) * 0.12);
}

// Polished mahogany: long grain along u, dark streaks, a soft sheen band.
function mahogany(u, v, tone) {
  const g = fbm(u, v, 2, 14, 71, 3);
  const streak = fract(v * 9 + g * 1.8);
  let val = 0.4 + (g - 0.5) * 0.4 + (streak < 0.12 ? -0.14 : 0);
  val += 0.1 * Math.sin(TAU * (v * 2 + g));
  return tone('mahog', val);
}

// Ornamental cream plaster: soft clusters, cracks with a lit lip, water rings and soot.
function cream(u, v, tone) {
  const a = fbm(u, v, 3, 3, 81, 2), b = fbm(u, v, 10, 10, 82, 1);
  let val = 0.55 + (a - 0.5) * 0.24 + (b > 0.68 ? 0.05 : b < 0.32 ? -0.05 : 0);
  const ring = fbm(u, v, 3, 3, 83, 3);
  if (ring > 0.66 && ring < 0.69) val -= 0.22;
  else if (ring > 0.69) val -= 0.1;
  const crack = Math.abs(fbm(u, v, 5, 5, 84, 3) - 0.5);
  if (crack < 0.012) val -= 0.3;
  else if (crack < 0.022) val += 0.08;
  if (fbm(u, v, 2, 2, 85, 2) < 0.3) val -= 0.12;
  return tone('cream', val);
}

// Glazed terracotta blocks (0.6 x 0.4 m; the page is 2.4 x 1.6 m): crazed glaze, dark
// joints, grime running down from each joint, a few blocks lost to the frost.
function terracotta(u, v, tone) {
  const bx = u * 4, by = v * 4;
  const row = Math.floor(by), col = Math.floor(bx + (row & 1 ? 0.5 : 0));
  const fx = fract(bx + (row & 1 ? 0.5 : 0)), fy = fract(by);
  const id = hash(col & 7, row & 3, 91);
  if (fx < 0.03 || fy < 0.045) return tone('terra', 0.08);
  let val = 0.62 + (id - 0.5) * 0.16 + (fbm(u, v, 12, 12, 92, 1) - 0.5) * 0.1;
  if (fy < 0.12) val += 0.08;              // the lit top edge
  if (fy > 0.9 || fx > 0.96) val -= 0.1;   // the shadowed lower edge
  const craze = Math.abs(fbm(u, v, 16, 16, 93, 2) - 0.5);
  if (craze < 0.015) val -= 0.14;
  // grime runs down from the joint above
  const run = fbm(u, 0, 24, 1, 94, 1);
  if (run > 0.55) val -= (1 - fy) * 0.22 * (run - 0.55) * 3;
  if (id > 0.93) return tone('terra', 0.18 + (fbm(u, v, 20, 20, 95, 1) - 0.5) * 0.2);   // a spalled block
  val -= 0.1 * smooth01(0.3, 1, v) * (fbm(u, v, 3, 2, 96, 2) > 0.5 ? 1 : 0.4);
  return tone('terra', val);
}

// Pale linen that vertex colours can tint: a weave, soft folds, stains.
function linen(u, v, tone) {
  const weave = (Math.floor(u * 64) + Math.floor(v * 64)) & 1 ? 0.03 : -0.03;
  const fold = Math.sin(TAU * (u * 2 + fbm(u, v, 2, 4, 101, 2) * 0.8));
  let val = 0.6 + weave + fold * 0.14 + (fbm(u, v, 6, 6, 102, 2) - 0.5) * 0.14;
  if (fbm(u, v, 4, 4, 103, 2) < 0.28) val -= 0.16;
  return tone('linen', val);
}

// The screen: once white, now grey-brown, torn open in long rips with hanging flaps.
function screen(u, v, tone) {
  // Long ragged rips (narrow, jagged, running down the cloth) and a torn-away corner.
  const rip = (x0, y0, x1, y1, w) => {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const t = clamp01(((u - x0) * dx + (v - y0) * dy) / L);
    const d = Math.abs((u - x0 - dx * t) * 2);
    const jag = 0.5 + fbm(u * 3, v, 30, 30, 111, 1);
    return t > 0 && t < 1 && d < w * Math.pow(Math.sin(Math.PI * t), 0.5) * jag;
  };
  if (rip(0.22, 0.05, 0.26, 0.8, 0.012) || rip(0.61, 0.0, 0.66, 0.62, 0.02) || rip(0.83, 0.3, 0.8, 0.95, 0.01) || rip(0.45, 0.55, 0.43, 1.0, 0.016)) return [0, 0, 0, 0];
  if (u > 0.86 && v > 0.78 && (u - 0.86) * 1.6 + (v - 0.78) > 0.18 + fbm(u, v, 24, 24, 116, 1) * 0.08) return [0, 0, 0, 0];
  if (v > 0.965 && fbm(u, 0, 40, 1, 112, 1) > 0.55) return [0, 0, 0, 0];
  let val = 0.6 + (fbm(u, v, 4, 2, 113, 3) - 0.5) * 0.3;
  val -= 0.25 * smooth01(0.4, 1, v) * fbm(u, v, 8, 2, 114, 1);   // damp rising from the bottom
  val -= 0.2 * (fbm(u, v, 2, 1, 115, 2) < 0.35 ? 1 : 0);
  const seam = fract(u * 6);
  if (seam < 0.01) val -= 0.1;
  return [...tone('screen', val), 255];
}

// Chain-link: galvanised wire diamonds, rusted in places; the gaps are cut out.
function chainlink(u, v, tone) {
  const a = fract((u + v) * 8), b = fract((u - v) * 8);
  const wire = Math.min(Math.abs(a - 0.5), Math.abs(b - 0.5)) > 0.42;
  if (!wire) return [0, 0, 0, 0];
  const rust = fbm(u, v, 3, 3, 121, 2) > 0.62;
  const c = rust ? tone('bole', 0.5) : tone('screen', 0.3 + (a > 0.96 || b > 0.96 ? 0.3 : 0));
  return [...c, 255];
}

// A ghost sign: an old painted advertisement, faded into the brick (alpha is the paint).
function ghostSign() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const R = mulberry32(99);
  ctx.fillStyle = 'rgba(214, 200, 160, 0.85)';
  ctx.fillRect(12, 12, 488, 232);
  ctx.fillStyle = 'rgba(120, 36, 28, 0.95)';
  ctx.fillRect(24, 24, 464, 96);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236, 224, 190, 1)';
  ctx.font = `900 76px ${CONDENSED}`;
  ctx.fillText('AURORA', 256, 74, 440);
  ctx.fillStyle = 'rgba(60, 40, 30, 1)';
  ctx.font = `bold 34px ${SERIF}`;
  ctx.fillText('PICTURES · VAUDEVILLE', 256, 152, 460);
  ctx.font = `bold 26px ${SERIF}`;
  ctx.fillText('REFRIGERATED AIR — ALWAYS COOL INSIDE', 256, 204, 470);
  // weathered: paint lost in blotches and along the mortar lines
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 260; k++) { ctx.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.6})`; ctx.beginPath(); ctx.arc(R() * 512, R() * 256, 3 + R() * 22, 0, TAU); ctx.fill(); }
  for (let y = 0; y < 256; y += 16) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, y, 512, 3); }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

// The dome's painted night sky: deepening toward the rim, wisps of cloud, gilt stars
// (u runs round the dome, v from the rim (0) to the crown (1)).
function domeSky(u, v, tone) {
  const star = hash(Math.floor(u * 96), Math.floor(v * 40), 131);
  if (star > 0.993 && v > 0.08) return tone('gold', 0.9);
  const cloud = fbm(u, v * 0.5, 6, 2, 132, 3);
  let val = 0.18 + v * 0.5 + (cloud > 0.58 ? (cloud - 0.58) * 1.2 : 0);
  if (v < 0.22 && fbm(u, v, 14, 3, 133, 2) > 0.6) val -= 0.14;   // damp stains at the rim
  if (Math.abs(fbm(u, v, 5, 3, 134, 3) - 0.5) < 0.012) val -= 0.2;   // cracks
  return tone('night', val);
}

// --- Atlases (drawn with the canvas; retro.js reduces them to small palettes) ------------------

const SERIF = 'Georgia, "Times New Roman", serif';
const BLOCK = '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
const CONDENSED = 'Impact, "Arial Narrow", "Arial Black", sans-serif';

// Invented films of 1958-1964. [title lines, tagline, palette [bg, ink, accent], art]
const POSTERS = [
  [['THE HOLLOW', 'TIDE'], 'NOTHING RETURNS FROM THE SEA', ['#1d3a46', '#e8d9a8', '#c2442e'], 'wave'],
  [['NIGHT OF THE', 'LANTERN'], 'ONE LIGHT. ONE WAY OUT.', ['#231a2e', '#f0c060', '#d8d0b8'], 'lantern'],
  [['CRIMSON', 'MERIDIAN'], 'A WESTERN IN BLAZING COLOR', ['#7a2418', '#f2dfb0', '#1c1410'], 'sun'],
  [['ATOMIC', 'SWEETHEARTS'], 'THEY FELL IN LOVE AT GROUND ZERO', ['#e0c060', '#2a1c16', '#b8352a'], 'atom'],
  [['THE GLASS', 'CATHEDRAL'], 'IN WIDE-SCREEN AURORAVISION', ['#16283a', '#dfe6e0', '#c9a24c'], 'arch'],
  [['BRIDE OF THE', 'DEEP WOODS'], 'SHE WAITS WHERE THE PATH ENDS', ['#14261c', '#d9ccaa', '#a33a30'], 'trees'],
  [['ROCKET', 'TO VENUS'], 'COMING SOON', ['#2d1f40', '#f4e0a0', '#e06a3a'], 'rocket'],
  [['LAST SHOW', 'AT MIDNIGHT'], 'DON\'T TURN AROUND', ['#101010', '#e6e0d0', '#b02a24'], 'eyes'],
];

function drawArt(ctx, kind, x, y, w, h, ink, accent, R) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = accent; ctx.strokeStyle = ink; ctx.lineWidth = w * 0.02;
  const cx = w / 2, cy = h / 2;
  if (kind === 'wave') {
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const px = (i / 20) * w, py = cy + k * h * 0.14 + Math.sin(i * 0.9 + k) * h * 0.06; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.globalAlpha = 0.35 + k * 0.15; ctx.fillStyle = k & 1 ? ink : accent; ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(cx, cy * 0.7, w * 0.12, 0, TAU); ctx.fill();
  } else if (kind === 'lantern') {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy, w * 0.34, 0, TAU); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = ink; ctx.fillRect(cx - w * 0.12, cy - h * 0.2, w * 0.24, h * 0.4);
    ctx.fillStyle = '#fff1c0'; ctx.fillRect(cx - w * 0.08, cy - h * 0.14, w * 0.16, h * 0.28);
    ctx.fillStyle = ink; ctx.fillRect(cx - w * 0.02, cy - h * 0.34, w * 0.04, h * 0.14);
    ctx.fillStyle = '#000'; ctx.fillRect(cx + w * 0.22, cy + h * 0.05, w * 0.07, h * 0.35); ctx.beginPath(); ctx.arc(cx + w * 0.255, cy, w * 0.05, 0, TAU); ctx.fill();
  } else if (kind === 'sun') {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy + h * 0.15, w * 0.3, Math.PI, 0); ctx.fill();
    ctx.fillStyle = ink; ctx.fillRect(0, cy + h * 0.15, w, h * 0.35);
    ctx.fillStyle = accent;
    for (const px of [0.2, 0.7]) { ctx.fillRect(w * px, cy - h * 0.05, w * 0.05, h * 0.2); ctx.beginPath(); ctx.arc(w * px + w * 0.025, cy - h * 0.08, w * 0.04, 0, TAU); ctx.fill(); }
  } else if (kind === 'atom') {
    ctx.lineWidth = w * 0.025;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.38, h * 0.1, (k * Math.PI) / 3, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy, w * 0.06, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - w * 0.1, cy + h * 0.28); ctx.bezierCurveTo(cx - w * 0.3, cy + h * 0.1, cx - w * 0.02, cy + h * 0.05, cx, cy + h * 0.2);
    ctx.bezierCurveTo(cx + w * 0.02, cy + h * 0.05, cx + w * 0.3, cy + h * 0.1, cx + w * 0.1, cy + h * 0.28); ctx.lineTo(cx, cy + h * 0.38); ctx.closePath(); ctx.fill();
  } else if (kind === 'arch') {
    ctx.fillStyle = accent;
    for (let k = 0; k < 5; k++) { const ax = w * (0.1 + k * 0.17); ctx.fillRect(ax, cy - h * 0.1, w * 0.1, h * 0.45); ctx.beginPath(); ctx.arc(ax + w * 0.05, cy - h * 0.1, w * 0.05, Math.PI, 0); ctx.fill(); }
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.42); ctx.lineTo(cx + w * 0.3, cy - h * 0.1); ctx.lineTo(cx - w * 0.3, cy - h * 0.1); ctx.closePath(); ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
  } else if (kind === 'trees') {
    ctx.fillStyle = ink;
    for (let k = 0; k < 7; k++) { const tx = w * (0.05 + k * 0.15) + (R() - 0.5) * w * 0.05; ctx.beginPath(); ctx.moveTo(tx, h); ctx.lineTo(tx + w * 0.06, h * (0.05 + R() * 0.2)); ctx.lineTo(tx + w * 0.12, h); ctx.fill(); }
    ctx.fillStyle = accent; ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.2, w * 0.07, h * 0.18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e0d0'; ctx.beginPath(); ctx.arc(cx, cy - h * 0.02, w * 0.045, 0, TAU); ctx.fill();
  } else if (kind === 'rocket') {
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.4); ctx.lineTo(cx + w * 0.1, cy + h * 0.1); ctx.lineTo(cx - w * 0.1, cy + h * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillRect(cx - w * 0.1, cy + h * 0.1, w * 0.2, h * 0.14);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(cx - w * 0.1, cy + h * 0.24); ctx.lineTo(cx, cy + h * 0.46); ctx.lineTo(cx + w * 0.1, cy + h * 0.24); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.8, h * 0.2, w * 0.12, 0, TAU); ctx.fill();
  } else if (kind === 'eyes') {
    ctx.fillStyle = accent;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * w * 0.18, cy, w * 0.13, h * 0.06, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#000';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * w * 0.18, cy, w * 0.04, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

// Eight posters, 256 x 384 each, in a 1024 x 768 atlas (4 x 2). Aged: faded, foxed,
// torn corners, tape.
export function posterRect(i) {
  const c = i % 4, r = Math.floor(i / 4) % 2;
  return [c / 4, 1 - (r + 1) / 2, (c + 1) / 4, 1 - r / 2];
}
function posterAtlas() {
  const W = 1024, H = 768, pw = 256, ph = 384;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const R = mulberry32(777);
  POSTERS.forEach(([title, tag, [bg, ink, accent], art], i) => {
    const x = (i % 4) * pw, y = Math.floor(i / 4) * ph;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.clip();
    ctx.fillStyle = bg; ctx.fillRect(x, y, pw, ph);
    drawArt(ctx, art, x + 16, y + 110, pw - 32, 180, ink, accent, R);
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    title.forEach((t, k) => {
      const size = k === title.length - 1 ? 44 : 26;
      ctx.font = `900 ${size}px ${k === title.length - 1 ? CONDENSED : BLOCK}`;
      ctx.fillText(t, x + pw / 2, y + 36 + k * 40, pw - 20);
    });
    ctx.font = `italic 700 15px ${SERIF}`; ctx.fillStyle = accent;
    ctx.fillText(tag, x + pw / 2, y + 312, pw - 24);
    ctx.font = `700 11px ${SERIF}`; ctx.fillStyle = ink;
    ctx.fillText('AN AURORA PICTURES RELEASE', x + pw / 2, y + 340, pw - 24);
    ctx.fillRect(x + 40, y + 352, pw - 80, 2);
    // Age: fade toward yellow, foxing, a torn corner, tape.
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(220, 196, 150, 0.55)'; ctx.fillRect(x, y, pw, ph);
    for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(120, 90, 60, ${0.08 + R() * 0.2})`; ctx.beginPath(); ctx.arc(x + R() * pw, y + R() * ph, 2 + R() * 10, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(x, y + ph, x, y + ph * 0.6);
    g.addColorStop(0, 'rgba(40, 30, 20, 0.45)'); g.addColorStop(1, 'rgba(40, 30, 20, 0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, pw, ph);
    ctx.fillStyle = '#0e0c0a';
    const corner = R() < 0.5;
    ctx.beginPath();
    if (corner) { ctx.moveTo(x + pw, y); ctx.lineTo(x + pw - 50 - R() * 40, y); ctx.lineTo(x + pw - 20, y + 30 + R() * 30); ctx.lineTo(x + pw, y + 60 + R() * 50); }
    else { ctx.moveTo(x, y + ph); ctx.lineTo(x + 60 + R() * 40, y + ph); ctx.lineTo(x + 20, y + ph - 40); ctx.lineTo(x, y + ph - 80 - R() * 40); }
    ctx.fill();
    ctx.fillStyle = 'rgba(210, 200, 160, 0.6)';
    ctx.fillRect(x + 6, y + 4, 34, 12); ctx.fillRect(x + pw - 40, y + ph - 16, 34, 12);
    ctx.restore();
  });
  return c;
}

// Signs, 1024 x 1024 in a grid of 128 x 64 cells (8 x 16); a sign takes a run of cells.
// SIGNS[name] = [col, row, cols, rows]; signRect(name) gives its UV rectangle.
export const SIGNS = {
  exit: [0, 0, 2, 1],
  boxOffice: [2, 0, 3, 1],
  refresh: [5, 0, 3, 1],
  prices: [0, 1, 2, 3],
  menu: [2, 1, 3, 2],
  noSmoking: [5, 1, 2, 1],
  stageDoor: [5, 2, 2, 1],
  dressing: [0, 4, 3, 1],
  projection: [3, 4, 3, 1],
  keepOff: [6, 4, 2, 1],
  shop1: [0, 5, 4, 1],
  shop2: [4, 5, 4, 1],
  shop3: [0, 6, 4, 1],
  shop4: [4, 6, 4, 1],
  line1: [0, 7, 8, 1],
  line2: [0, 8, 8, 1],
  line3: [0, 9, 8, 1],
  now: [0, 10, 3, 1],
  closed: [3, 10, 3, 1],
  cast: [0, 11, 2, 3],
  fire: [2, 11, 2, 1],
  danger: [4, 11, 2, 1],
  loading: [6, 11, 2, 1],
  letters: [0, 14, 8, 1],
  bill: [2, 12, 3, 2],
  bill2: [5, 12, 3, 2],
  stencil: [2, 3, 3, 1],
  tickets: [5, 3, 2, 1],
  facade: [0, 15, 8, 1],
};
export function signRect([c, r, w, h]) {
  return [c / 8, 1 - (r + h) / 16, (c + w) / 8, 1 - r / 16];
}
// Loose marquee letters: cell k of the letters strip (16 of them, 64 x 64 each).
export const LETTERS = 'AURONTHEWDLICSMG';
export function letterRect(ch) {
  const k = Math.max(0, LETTERS.indexOf(ch));
  return [k / 16, 1 - 15 / 16, (k + 1) / 16, 1 - 14 / 16];
}

function signAtlas() {
  const S = 1024, cw = 128, ch = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const R = mulberry32(4242);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, S, S);
  const cell = ([cx, cy, w, h]) => [cx * cw, cy * ch, w * cw, h * ch];
  const text = (t, x, y, size, font, color, maxW) => { ctx.font = `bold ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y, maxW); };
  const board = (name, bg, fg, lines, { font = BLOCK, frame = null, size = 30 } = {}) => {
    const [x, y, w, h] = cell(SIGNS[name]);
    ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
    if (frame) { ctx.strokeStyle = frame; ctx.lineWidth = 4; ctx.strokeRect(x + 4, y + 4, w - 8, h - 8); }
    lines.forEach((t, k) => text(t, x + w / 2, y + (h * (k + 0.5)) / lines.length, size, font, fg, w - 16));
  };
  // EXIT: red glass letters on black (the bulb shines through them).
  board('exit', '#140606', '#ff3a26', ['EXIT'], { size: 48, frame: '#401010' });
  board('boxOffice', '#1d1a14', '#d9b25c', ['BOX OFFICE'], { font: SERIF, size: 34, frame: '#7a6030' });
  board('refresh', '#1d1a14', '#d9b25c', ['REFRESHMENTS'], { font: SERIF, size: 30, frame: '#7a6030' });
  board('prices', '#101010', '#e8e2d0', ['ADMISSION', 'ADULTS  50¢', 'CHILDREN  25¢', 'BALCONY  65¢', 'MATINEE DAILY', 'LAST SHOW 11:40'], { font: CONDENSED, size: 20, frame: '#6a5a3a' });
  board('menu', '#131a16', '#e4dcc4', ['POPCORN 15¢  25¢', 'CANDY 10¢', 'COLA 10¢  15¢', 'HOT DOGS 20¢'], { font: CONDENSED, size: 22, frame: '#4a5a40' });
  board('noSmoking', '#e0d8c0', '#8a2018', ['NO SMOKING'], { size: 28 });
  board('stageDoor', '#1a1a1a', '#d8d0b8', ['STAGE DOOR'], { size: 28, frame: '#888' });
  board('dressing', '#222018', '#d8ceb0', ['DRESSING ROOMS'], { font: SERIF, size: 28 });
  board('projection', '#222018', '#d8ceb0', ['PROJECTION'], { font: SERIF, size: 28 });
  board('keepOff', '#e0d8c0', '#1a1a1a', ['KEEP CLEAR'], { size: 26 });
  board('shop1', '#1a2830', '#d8e0d0', ['HOLLIS DRUGS & SODA'], { font: SERIF, size: 34 });
  board('shop2', '#2a1812', '#e6c878', ['BLUE MOON DINER'], { font: CONDENSED, size: 40 });
  board('shop3', '#15151a', '#c8c0a8', ['OTTO\'S RADIO & TV'], { font: BLOCK, size: 30 });
  board('shop4', '#20281c', '#d0c8a0', ['PAWN  ·  LOANS'], { font: SERIF, size: 36 });
  // Marquee letterboard lines: white plastic letters on a pale board, some fallen.
  const lineBoard = (name, t) => {
    const [x, y, w, h] = cell(SIGNS[name]);
    ctx.fillStyle = '#cfc8b4'; ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 3; k++) { ctx.fillStyle = '#b8b09a'; ctx.fillRect(x, y + 6 + k * 20, w, 2); }
    ctx.font = `900 44px ${CONDENSED}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let cx = x + 18;
    for (const chr of t) {
      const lw = ctx.measureText(chr).width + 6;
      if (chr !== ' ' && R() > 0.14) {
        ctx.save(); ctx.translate(cx + lw / 2, y + h / 2 + (R() < 0.12 ? 8 : 0)); ctx.rotate(R() < 0.12 ? (R() - 0.5) * 0.9 : 0);
        ctx.fillStyle = R() < 0.1 ? '#6a2018' : '#141210'; ctx.textAlign = 'center'; ctx.fillText(chr, 0, 0); ctx.restore();
      }
      cx += lw;
    }
    ctx.fillStyle = 'rgba(30, 24, 18, 0.35)'; ctx.fillRect(x, y + h - 14, w, 14);
  };
  lineBoard('line1', 'NOW  THE HOLLOW TIDE');
  lineBoard('line2', 'ALSO  ROCKET TO VENUS');
  lineBoard('line3', 'MIDNITE SHOW  FRI & SAT');
  board('now', '#8a2018', '#f0e0b0', ['NOW SHOWING'], { size: 30 });
  board('closed', '#1a1a1a', '#e0d8c0', ['CLOSED'], { size: 40, frame: '#aa3020' });
  board('cast', '#1c1612', '#d8c89c', ['TONIGHT', 'IN PERSON', '———', 'THE GREAT', 'MARVELLO', '& COMPANY'], { font: SERIF, size: 26, frame: '#8a6a30' });
  board('fire', '#8a1a14', '#f0e0d0', ['FIRE HOSE'], { size: 26 });
  board('danger', '#d0b030', '#141210', ['HIGH VOLTAGE'], { size: 24 });
  board('loading', '#303030', '#e0d8c0', ['LOADING DOCK'], { size: 24 });
  board('bill', '#d8c8a0', '#3a1c14', ['VAUDEVILLE', 'EVERY SUNDAY'], { font: SERIF, size: 40, frame: '#3a1c14' });
  board('bill2', '#c8d0c0', '#16203a', ['GRAND', 'RE-OPENING'], { font: BLOCK, size: 40, frame: '#16203a' });
  board('tickets', '#1d1a14', '#d9b25c', ['TICKETS'], { font: SERIF, size: 34, frame: '#7a6030' });
  // Stencilled on the prop crates: pale ink on bare pine.
  board('stencil', '#8a6a44', '#231a12', ['AURORA PICTURE PALACE', 'PROPS · HANDLE WITH CARE'], { font: CONDENSED, size: 22 });
  // The name in the facade's crest: cream letters raised on terracotta.
  board('facade', '#6a5a46', '#e2d6b4', ['A U R O R A   P I C T U R E   P A L A C E'], { font: SERIF, size: 44 });
  // Loose letters: a 64 x 64 tile each.
  for (let k = 0; k < LETTERS.length; k++) {
    const x = k * 64, y = 14 * ch;
    ctx.fillStyle = '#cfc8b4'; ctx.fillRect(x, y, 64, 64);
    ctx.fillStyle = '#141210'; ctx.font = `900 54px ${CONDENSED}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(LETTERS[k], x + 32, y + 34);
  }
  // Grime over everything.
  ctx.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 500; k++) { ctx.fillStyle = `rgba(110, 96, 80, ${0.05 + R() * 0.12})`; ctx.beginPath(); ctx.arc(R() * S, R() * S, 3 + R() * 14, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

// --- The set -----------------------------------------------------------------------------------
// Pages are painted once and kept for later visits to the map, and so are the THREE textures
// made from them: every level of the palace shares one set (palaceTextures), whose GPU copies
// are freed when the map is left (releaseTextures) and upload again on the next visit. The
// "1997" pages come first; the smooth pages for the plain look are only painted the first
// time the TV look is off.
const PAGES = {
  drape: [64, 64, drape], plush: [64, 64, plush], carpet: [96, 96, carpet], gilt: [64, 64, gilt],
  damask: [128, 128, damask], panel: [64, 64, panel], mahogany: [64, 64, mahogany], cream: [128, 128, cream],
  terracotta: [128, 96, terracotta], linen: [64, 64, linen], screen: [128, 64, screen, false],
  chainlink: [32, 32, chainlink], dome: [128, 64, domeSky],
};
const ATLASES = { ghost: ghostSign, posters: posterAtlas, signs: signAtlas };
const cache = {};

// An atlas's "1997" page: a quarter of its size, box-filtered (like retro.js does before
// its palette pass; the TV pass does the rest).
function quarter(src) {
  let cur = src;
  const w = Math.max(64, Math.round(src.width / 4)), h = Math.max(32, Math.round(src.height / 4));
  while (cur.width / 2 >= w) {
    const c = document.createElement('canvas');
    c.width = Math.max(w, Math.round(cur.width / 2)); c.height = Math.max(h, Math.round(cur.height / 2));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  return cur;
}

function texture(name, image, painted, repeat) {
  const t = new THREE.CanvasTexture(image);
  t.name = `palace:${name}`;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.userData.painted = painted;
  return t;
}

let SET = null;

// The pages, painted one at a time: paintNext() paints the next one still missing (false when
// there are none), so the game can do it in idle moments; palaceTextures() paints what is left.
function* painting() {
  for (const [name, [w, h, fn]] of Object.entries(PAGES)) {
    if (!cache[name]) cache[name] = { lo: canvasOf(w, h, fn, true), hi: null };
    yield name;
  }
  for (const [name, draw] of Object.entries(ATLASES)) {
    if (!cache[name]) { const hi = draw(); cache[name] = { hi, lo: quarter(hi) }; }
    yield name;
  }
}
let paintJob = null;
export function paintNext() {
  return !(paintJob ||= painting()).next().done;
}

export function palaceTextures() {
  if (SET) return SET;
  while (paintNext());
  const tex = {};
  for (const [name, [, , , repeat = true]] of Object.entries(PAGES)) {
    const c = cache[name];
    tex[name] = texture(name, c.hi || c.lo, c.lo, repeat);
    tex[name].userData.page = name;
  }
  for (const name of Object.keys(ATLASES)) {
    const c = cache[name];
    tex[name] = texture(name, c.hi, c.lo, false);
  }
  // The world textures' treatment: userData.lo is the painted page, userData.hi the plain one.
  prepareRetroTextures(tex);
  return (SET = tex);
}

// Free the set's GPU memory (the pages stay, and a texture that is used again uploads again).
export function releaseTextures() {
  if (SET) for (const t of Object.values(SET)) t.dispose();
}

// Follow the game's TV-look setting (it swaps the shared textures; these follow them).
const retroState = new WeakMap();
export function syncRetro(tex, shared) {
  const probe = shared.plaster;
  const on = !!probe && probe.image === probe.userData.lo;
  if (retroState.get(tex) === on) return;
  retroState.set(tex, on);
  if (!on) {
    for (const t of Object.values(tex)) {
      const name = t.userData.page;
      if (!name) continue;
      const c = cache[name];
      if (!c.hi) { const [w, h, fn] = PAGES[name]; c.hi = canvasOf(w * 2, h * 2, fn, false); }
      t.userData.hi = c.hi;
    }
  }
  setRetroTextures(tex, on);
  // setRetroTextures skips a texture already showing the wanted image (a page shows its
  // "1997" page until the plain one is first needed), so set the filters here: painted
  // pages stay crisp, the atlases blend like the world's palette-reduced textures.
  for (const t of Object.values(tex)) {
    if (on) {
      t.magFilter = t.userData.page ? THREE.NearestFilter : THREE.LinearFilter;
      t.minFilter = THREE.NearestMipmapLinearFilter;
      t.anisotropy = 1;
    } else [t.magFilter, t.minFilter, t.anisotropy] = t.userData.hiFilter;
    t.needsUpdate = true;
  }
}
