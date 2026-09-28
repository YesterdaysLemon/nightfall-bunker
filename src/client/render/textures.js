// Procedural canvas textures for the bunker / airfield setting.
// Everything is generated at runtime from a seeded PRNG so the world looks
// identical on every load. Tiling textures wrap seamlessly: noise lattices
// are periodic and every drawn feature near an edge is repeated on the
// opposite side (see wrap9).

import * as THREE from 'three';
import { mulberry32 } from '../../shared/rng.js';

let maxAniso = 8;

/** Wrap a canvas in a THREE.CanvasTexture with the project's defaults. */
export function makeCanvasTexture(canvas, { repeat = true, anisotropy } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.anisotropy = anisotropy ?? maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function mkCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Periodic fractal value noise. Returns Float32Array(w*h) in [0,1].
 * The lattice wraps, so the field tiles seamlessly.
 */
function fbm(w, h, seed, { cells = 4, cellsY = null, octaves = 4, gain = 0.5 } = {}) {
  const rand = mulberry32(seed);
  const out = new Float32Array(w * h);
  let cx = cells;
  let cy = cellsY ?? Math.max(1, Math.round((cells * h) / w));
  let amp = 1;
  const sx = new Float32Array(w);
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    for (let x = 0; x < w; x++) {
      const f = (x / w) * cx;
      const i = Math.floor(f);
      const t = f - i;
      sx[x] = t * t * (3 - 2 * t);
      x0[x] = i % cx;
      x1[x] = (i + 1) % cx;
    }
    for (let y = 0; y < h; y++) {
      const f = (y / h) * cy;
      const j = Math.floor(f);
      let t = f - j;
      t = t * t * (3 - 2 * t);
      const r0 = (j % cy) * cx;
      const r1 = ((j + 1) % cy) * cx;
      let idx = y * w;
      for (let x = 0; x < w; x++, idx++) {
        const s = sx[x];
        const a = lat[r0 + x0[x]];
        const b = lat[r0 + x1[x]];
        const c = lat[r1 + x0[x]];
        const d = lat[r1 + x1[x]];
        const top = a + (b - a) * s;
        const bot = c + (d - c) * s;
        out[idx] += (top + (bot - top) * t) * amp;
      }
    }
    amp *= gain;
    cx = Math.min(cx * 2, w);
    cy = Math.min(cy * 2, h);
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

/** Grayscale opaque canvas from a field (0.5 maps to mid grey). */
function grayCanvas(field, w, h, contrast = 1) {
  const c = mkCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    let v = 128 + (field[i] - 0.5) * 255 * contrast;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** White canvas whose alpha is driven by fn(value). Used for erasing / masks. */
function alphaCanvas(field, w, h, fn) {
  const c = mkCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    d[p] = d[p + 1] = d[p + 2] = 255;
    d[p + 3] = 255 * clamp01(fn(field[i], i));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Shared noise set: built once per createTextures call. */
function makeNoiseSet() {
  const S = 256;
  const low = fbm(S, S, 101, { cells: 4, octaves: 5 });
  const mid = fbm(S, S, 202, { cells: 16, octaves: 3 });
  const streak = fbm(S, S, 303, { cells: 48, cellsY: 3, octaves: 3 });
  const grain = new Float32Array(S * S);
  const r = mulberry32(404);
  for (let i = 0; i < grain.length; i++) grain[i] = r();
  return {
    S,
    low,
    mid,
    streak,
    grain,
    cLow: grayCanvas(low, S, S),
    cMid: grayCanvas(mid, S, S),
    cStreak: grayCanvas(streak, S, S, 1.4),
    cGrain: grayCanvas(grain, S, S, 0.9),
    aGrain: alphaCanvas(grain, S, S, (v) => (v - 0.35) * 1.6),
    aBlotch: alphaCanvas(low, S, S, (v) => smoothstep(0.58, 0.8, v)),
  };
}

const sampleF = (f, x, y) => f[((y & 255) << 8) | (x & 255)];

/** Fill the whole canvas with a (tileable) pattern using a blend mode. */
function layer(ctx, src, { mode = 'overlay', alpha = 0.5, scale = 1, sx, sy, ox = 0, oy = 0, rot = 0 } = {}) {
  const { width: W, height: H } = ctx.canvas;
  const p = ctx.createPattern(src, 'repeat');
  const m = new DOMMatrix();
  m.translateSelf(ox, oy);
  if (rot) m.rotateSelf(rot);
  m.scaleSelf(sx ?? scale, sy ?? scale);
  p.setTransform(m);
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function fillAll(ctx, color, mode = 'source-over', alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Call fn(dx,dy) for every periodic copy of a bbox that touches the canvas. */
function wrap9(W, H, minx, miny, maxx, maxy, fn) {
  for (let dx = -W; dx <= W; dx += W) {
    if (maxx + dx < 0 || minx + dx > W) continue;
    for (let dy = -H; dy <= H; dy += H) {
      if (maxy + dy < 0 || miny + dy > H) continue;
      fn(dx, dy);
    }
  }
}

function blot(ctx, W, H, x, y, r, rgb, a) {
  wrap9(W, H, x - r, y - r, x + r, y + r, (dx, dy) => {
    const X = x + dx;
    const Y = y + dy;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.55, `rgba(${rgb},${a * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(X - r, Y - r, r * 2, r * 2);
  });
}

/** Vertical fading streak (water / rust run-off). */
function streak(ctx, W, H, x, y, w, len, rgb, a) {
  wrap9(W, H, x - w, y, x + w, y + len, (dx, dy) => {
    const X = x + dx;
    const Y = y + dy;
    const g = ctx.createLinearGradient(0, Y, 0, Y + len);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.3, `rgba(${rgb},${a * 0.7})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(X - w / 2, Y, w, len);
    ctx.fillRect(X - w / 4, Y, w / 2, len * 1.15);
  });
}

function walk(r, x, y, steps, step, ang, wander) {
  const pts = [x, y];
  for (let i = 0; i < steps; i++) {
    ang += (r() - 0.5) * wander;
    const s = step * (0.6 + r() * 0.8);
    x += Math.cos(ang) * s;
    y += Math.sin(ang) * s;
    pts.push(x, y);
  }
  return pts;
}

function strokeWrapped(ctx, W, H, pts, ox = 0, oy = 0) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i]);
    maxx = Math.max(maxx, pts[i]);
    miny = Math.min(miny, pts[i + 1]);
    maxy = Math.max(maxy, pts[i + 1]);
  }
  const pad = ctx.lineWidth + 2;
  wrap9(W, H, minx - pad, miny - pad, maxx + pad, maxy + pad, (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(pts[0] + dx + ox, pts[1] + dy + oy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx + ox, pts[i + 1] + dy + oy);
    ctx.stroke();
  });
}

function cracks(ctx, W, H, r, n, { steps = 24, step = 7, wander = 0.9, lw = 1.2, color = 'rgba(20,18,16,0.6)', light = 'rgba(190,185,170,0.14)', branches = 2 } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const pts = walk(r, r() * W, r() * H, steps, step, r() * TAU, wander);
    ctx.strokeStyle = light;
    ctx.lineWidth = lw;
    strokeWrapped(ctx, W, H, pts, 0.9, 0.9);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    strokeWrapped(ctx, W, H, pts);
    for (let b = 0; b < branches; b++) {
      const j = 2 * (1 + Math.floor(r() * (pts.length / 2 - 2)));
      const sub = walk(r, pts[j], pts[j + 1], Math.floor(steps / 3), step * 0.8, r() * TAU, wander * 1.2);
      ctx.lineWidth = lw * 0.6;
      strokeWrapped(ctx, W, H, sub);
    }
  }
  ctx.restore();
}

/** Dark gradients inside a rect's edges (edge darkening / ambient occlusion). */
function edgeShade(ctx, x, y, w, h, size, alpha, sides = 'tblr') {
  const mk = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  };
  if (sides.includes('t')) { ctx.fillStyle = mk(0, y, 0, y + size); ctx.fillRect(x, y, w, size); }
  if (sides.includes('b')) { ctx.fillStyle = mk(0, y + h, 0, y + h - size); ctx.fillRect(x, y + h - size, w, size); }
  if (sides.includes('l')) { ctx.fillStyle = mk(x, 0, x + size, 0); ctx.fillRect(x, y, size, h); }
  if (sides.includes('r')) { ctx.fillStyle = mk(x + w, 0, x + w - size, 0); ctx.fillRect(x + w - size, y, size, h); }
}

/** Wavy wood grain lines, periodic along their length. */
function grainLines(ctx, r, a0, span, length, n, rgb, horizontal = false) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const base = a0 + r() * span;
    const amp = 0.8 + r() * 3.5;
    const k = 1 + Math.floor(r() * 3);
    const k2 = 3 + Math.floor(r() * 5);
    const amp2 = r() * 1.4;
    const ph = r() * TAU;
    ctx.strokeStyle = `rgba(${rgb},${0.12 + r() * 0.25})`;
    ctx.lineWidth = 0.6 + r() * 1.3;
    ctx.beginPath();
    for (let t = 0; t <= length; t += 8) {
      const u = t / length;
      const o = base + Math.sin(u * TAU * k + ph) * amp + Math.sin(u * TAU * k2 + ph * 1.7) * amp2;
      if (horizontal) (t === 0 ? ctx.moveTo(t, o) : ctx.lineTo(t, o));
      else (t === 0 ? ctx.moveTo(o, t) : ctx.lineTo(o, t));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function knot(ctx, x, y, rx, ry, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(18,10,5,0.9)');
  g.addColorStop(0.5, 'rgba(40,24,12,0.6)');
  g.addColorStop(1, 'rgba(40,24,12,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 0.9;
  for (let k = 1; k <= 3; k++) {
    ctx.strokeStyle = `rgba(25,14,6,${0.28 - k * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * (1 + k * 0.45), rx * (1 + k * 0.75), 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function nail(ctx, W, H, x, y, rad, rustAmt = 0.35, drip = true) {
  if (rustAmt > 0) {
    blot(ctx, W, H, x, y, rad * 3.2, '96,44,18', rustAmt);
    if (drip) streak(ctx, W, H, x, y, rad * 1.1, rad * 9, '80,38,16', rustAmt * 0.8);
  }
  ctx.fillStyle = '#1b1917';
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(170,160,150,0.35)';
  ctx.beginPath();
  ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.45, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Individual textures
// ---------------------------------------------------------------------------

function texConcrete(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(1001);
  fillAll(ctx, '#77756e');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.42 });
  layer(ctx, N.cMid, { alpha: 0.35, ox: 37, oy: 91 });
  for (let i = 0; i < 16; i++) {
    blot(ctx, S, S, r() * S, r() * S, 40 + r() * 100, r() < 0.6 ? '52,50,44' : '150,146,134', 0.06 + r() * 0.08);
  }
  // board-formed casting seams
  for (let y = 0; y < S; y += 128) {
    const yy = y + 20 + r() * 8;
    ctx.fillStyle = 'rgba(28,26,22,0.22)';
    ctx.fillRect(0, yy, S, 2);
    ctx.fillStyle = 'rgba(210,205,190,0.07)';
    ctx.fillRect(0, yy + 2, S, 1);
  }
  for (let i = 0; i < 22; i++) {
    streak(ctx, S, S, r() * S, r() * S, 2 + r() * 9, 60 + r() * 220, '40,37,31', 0.1 + r() * 0.16);
  }
  for (let i = 0; i < 500; i++) {
    const x = 3 + r() * (S - 6);
    const y = 3 + r() * (S - 6);
    const rad = 0.6 + r() * r() * 2.4;
    ctx.fillStyle = 'rgba(20,19,17,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(205,200,188,0.16)';
    ctx.fillRect(x - rad, y + rad * 0.7, rad * 2, 1);
  }
  cracks(ctx, S, S, r, 5, { steps: 26, step: 7, lw: 1.1, branches: 2 });
  layer(ctx, N.cGrain, { alpha: 0.28 });
  layer(ctx, N.cLow, { alpha: 0.22, mode: 'multiply', ox: 120, oy: 40 });
  return c;
}

function drawBrickWall(ctx, N, r, { mortar = '#5d574d', soot = 0.35 } = {}) {
  const S = ctx.canvas.width;
  fillAll(ctx, mortar);
  layer(ctx, N.cMid, { alpha: 0.5, ox: 11, oy: 3 });
  layer(ctx, N.cGrain, { alpha: 0.4 });
  const rows = 8;
  const cols = 4;
  const bh = S / rows;
  const bw = S / cols;
  const m = 5;
  for (let row = 0; row < rows; row++) {
    const off = row & 1 ? bw / 2 : 0;
    for (let col = 0; col < cols; col++) {
      const x = col * bw + off + m / 2;
      const y = row * bh + m / 2;
      const w = bw - m;
      const h = bh - m;
      const burnt = r() < 0.14;
      const pale = !burnt && r() < 0.12;
      const v = 0.8 + r() * 0.32;
      const warm = (r() - 0.5) * 10;
      let R = 118 * v + warm;
      let G = 62 * v + warm * 0.4 + (r() - 0.5) * 4;
      let B = 45 * v + (r() - 0.5) * 4;
      if (burnt) { R *= 0.58; G *= 0.6; B *= 0.66; }
      if (pale) { R += 22; G += 22; B += 18; }
      const fill = `rgb(${R | 0},${G | 0},${B | 0})`;
      const j = Array.from({ length: 8 }, () => (r() - 0.5) * 2.4);
      const specks = Array.from({ length: 16 }, () => [r() * w, r() * h, 0.5 + r() * 1.7, r() < 0.55]);
      const chip = r() < 0.4 ? [r() < 0.5 ? 0 : w, r() < 0.5 ? 0 : h, 3 + r() * 7] : null;
      wrap9(S, S, x - 3, y - 3, x + w + 3, y + h + 3, (dx, dy) => {
        const X = x + dx;
        const Y = y + dy;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(X + j[0], Y + j[1]);
        ctx.lineTo(X + w + j[2], Y + j[3]);
        ctx.lineTo(X + w + j[4], Y + h + j[5]);
        ctx.lineTo(X + j[6], Y + h + j[7]);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,215,180,0.08)';
        ctx.fillRect(X + 1, Y, w - 2, 2);
        edgeShade(ctx, X, Y, w, h, 7, 0.32, 'br');
        edgeShade(ctx, X, Y, w, h, 3, 0.18, 'tl');
        for (const [sx, sy, sr, dark] of specks) {
          ctx.fillStyle = dark ? 'rgba(30,14,10,0.45)' : 'rgba(190,140,110,0.22)';
          ctx.fillRect(X + sx, Y + sy, sr, sr);
        }
        if (chip) {
          ctx.fillStyle = mortar;
          ctx.beginPath();
          ctx.arc(X + chip[0], Y + chip[1], chip[2], 0, TAU);
          ctx.fill();
        }
      });
    }
  }
  layer(ctx, N.cMid, { alpha: 0.35, ox: 90, oy: 17 });
  layer(ctx, N.cGrain, { alpha: 0.3, ox: 7 });
  layer(ctx, N.cLow, { scale: 2, alpha: soot, mode: 'multiply', ox: 60, oy: 200 });
}

function texBrick(N) {
  const c = mkCanvas(512);
  const ctx = c.getContext('2d');
  const r = mulberry32(2002);
  drawBrickWall(ctx, N, r);
  for (let i = 0; i < 10; i++) streak(ctx, 512, 512, r() * 512, r() * 512, 3 + r() * 10, 80 + r() * 200, '25,22,18', 0.12);
  return c;
}

function texPlaster(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(3003);
  drawBrickWall(ctx, N, r, { mortar: '#58524a', soot: 0.45 });

  // plaster layer
  const pl = mkCanvas(S);
  const p = pl.getContext('2d');
  fillAll(p, '#8f8a7a');
  layer(p, N.cLow, { scale: 2, alpha: 0.45, ox: 50 });
  layer(p, N.cMid, { alpha: 0.3, ox: 13, oy: 70 });
  for (let i = 0; i < 12; i++) blot(p, S, S, r() * S, r() * S, 30 + r() * 80, '120,100,60', 0.14);
  for (let i = 0; i < 26; i++) streak(p, S, S, r() * S, r() * S, 3 + r() * 12, 60 + r() * 240, '70,64,48', 0.1 + r() * 0.14);
  cracks(p, S, S, r, 4, { steps: 18, step: 6, lw: 0.9, color: 'rgba(40,36,30,0.5)', branches: 1 });
  layer(p, N.cGrain, { alpha: 0.3, ox: 3, oy: 9 });

  // peel mask from shifted low-frequency noise
  const low = N.low;
  const mask = mkCanvas(256);
  const mctx = mask.getContext('2d');
  const img = mctx.createImageData(256, 256);
  for (let y = 0, q = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++, q += 4) {
      const n = sampleF(low, x + 97, y + 41) * 0.85 + sampleF(N.mid, x, y) * 0.15;
      img.data[q] = img.data[q + 1] = img.data[q + 2] = 255;
      img.data[q + 3] = 255 * smoothstep(0.3, 0.335, n);
    }
  }
  mctx.putImageData(img, 0, 0);
  p.globalCompositeOperation = 'destination-in';
  p.drawImage(mask, 0, 0, S, S);
  p.globalCompositeOperation = 'source-over';

  // drop shadow under the plaster edge
  const sh = mkCanvas(S);
  const s = sh.getContext('2d');
  s.drawImage(mask, 0, 0, S, S);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = 'rgba(12,10,8,1)';
  s.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.55;
  for (const [dx, dy] of [[0, 0], [-S, 0], [0, -S], [-S, -S]]) ctx.drawImage(sh, dx + 3, dy + 4);
  ctx.globalAlpha = 1;
  ctx.drawImage(pl, 0, 0);
  layer(ctx, N.cLow, { alpha: 0.2, mode: 'multiply', ox: 33, oy: 150 });
  return c;
}

function texWoodWall(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(4004);
  fillAll(ctx, '#140d08');
  // plank widths summing to S
  const raw = Array.from({ length: 6 }, () => 70 + r() * 36);
  const tot = raw.reduce((a, b) => a + b, 0);
  let x0 = 0;
  const railY = [70, 326];
  for (let i = 0; i < raw.length; i++) {
    const w = i === raw.length - 1 ? S - x0 : Math.round((raw[i] / tot) * S);
    const grey = r() < 0.35;
    const v = 0.82 + r() * 0.3;
    const base = grey ? [96, 90, 79] : [106, 83, 60];
    const R = base[0] * v + (r() - 0.5) * 5;
    const G = base[1] * v + (r() - 0.5) * 4;
    const B = base[2] * v + (r() - 0.5) * 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 1.5, 0, w - 3, S);
    ctx.clip();
    ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
    ctx.fillRect(x0, 0, w, S);
    layer(ctx, N.cStreak, { alpha: 0.5, sx: 1, sy: 2, ox: r() * 256 });
    layer(ctx, N.cLow, { alpha: 0.3, sx: 0.5, sy: 2, ox: r() * 256, oy: r() * 256 });
    grainLines(ctx, r, x0, w, S, 16, '30,20,12');
    grainLines(ctx, r, x0, w, S, 5, '190,170,140');
    const knots = Math.floor(r() * 2.4);
    for (let k = 0; k < knots; k++) {
      const kx = x0 + 12 + r() * (w - 24);
      const ky = r() * S;
      const rx = 4 + r() * 5;
      const ry = rx * (1.4 + r() * 0.4);
      for (const dy of [-S, 0, S]) knot(ctx, kx, ky + dy, rx, ry);
    }
    // butt joint
    if (r() < 0.5) {
      const jy = 140 + r() * 60 + (r() < 0.5 ? 0 : 200);
      ctx.fillStyle = 'rgba(12,8,5,0.9)';
      ctx.fillRect(x0, jy, w, 2.5);
      edgeShade(ctx, x0, jy - 8, w, 8, 8, 0.35, 'b');
      edgeShade(ctx, x0, jy + 2.5, w, 8, 8, 0.35, 't');
    }
    edgeShade(ctx, x0 + 1.5, 0, w - 3, S, 12, 0.5, 'lr');
    for (const ry of railY) {
      nail(ctx, S, S, x0 + w * 0.3, ry, 2.6, 0.3);
      nail(ctx, S, S, x0 + w * 0.7, ry + 4, 2.6, 0.3);
    }
    ctx.restore();
    x0 += w;
  }
  // splits and scratches
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(15,10,6,0.45)' : 'rgba(200,180,150,0.12)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y + 10 + r() * 50);
    ctx.stroke();
  }
  ctx.restore();
  layer(ctx, N.cLow, { scale: 2, alpha: 0.35, mode: 'multiply', ox: 20, oy: 80 });
  layer(ctx, N.cGrain, { alpha: 0.22 });
  return c;
}

function texFloorBoards(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(5005);
  fillAll(ctx, '#0e0906');
  const rows = 8;
  const bh = S / rows;
  for (let row = 0; row < rows; row++) {
    const y0 = row * bh;
    const j1 = r() * S;
    const j2 = j1 + 180 + r() * 150;
    const segs = [[j1, j2], [j2, j1 + S]];
    for (const [a, b] of segs) {
      const v = 0.82 + r() * 0.32;
      const R = 82 * v + (r() - 0.5) * 4;
      const G = 59 * v + (r() - 0.5) * 3;
      const B = 41 * v + (r() - 0.5) * 3;
      const ox = r() * 256;
      const seed = Math.floor(r() * 1e9);
      for (const dx of [-S, 0]) {
        const xa = a + dx;
        const xb = b + dx;
        if (xb < 0 || xa > S) continue;
        const rr = mulberry32(seed);
        ctx.save();
        ctx.beginPath();
        ctx.rect(xa + 1, y0 + 1.5, xb - xa - 2, bh - 3);
        ctx.clip();
        ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
        ctx.fillRect(xa, y0, xb - xa, bh);
        layer(ctx, N.cStreak, { alpha: 0.55, rot: 90, sx: 1, sy: 2, ox: 0, oy: ox });
        grainLines(ctx, rr, y0, bh, S, 12, '20,12,6', true);
        grainLines(ctx, rr, y0, bh, S, 4, '150,120,90', true);
        if (rr() < 0.35) knot(ctx, xa + 30 + rr() * (xb - xa - 60), y0 + 12 + rr() * (bh - 24), 5, 3.5, 0);
        edgeShade(ctx, xa + 1, y0 + 1.5, xb - xa - 2, bh - 3, 7, 0.45, 'tb');
        edgeShade(ctx, xa + 1, y0 + 1.5, xb - xa - 2, bh - 3, 10, 0.4, 'lr');
        ctx.restore();
        nail(ctx, S, S, xa + 8, y0 + 14, 2.2, 0.2, false);
        nail(ctx, S, S, xa + 8, y0 + bh - 14, 2.2, 0.2, false);
      }
    }
    for (const jx of [128, 384]) {
      nail(ctx, S, S, jx, y0 + 14, 2.2, 0.15, false);
      nail(ctx, S, S, jx + 3, y0 + bh - 14, 2.2, 0.15, false);
    }
  }
  // scuffs along the grain
  for (let i = 0; i < 30; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.fillStyle = `rgba(160,130,100,${0.03 + r() * 0.05})`;
    ctx.fillRect(x, y, 30 + r() * 120, 1 + r() * 2);
  }
  layer(ctx, N.cLow, { scale: 2, alpha: 0.35, mode: 'multiply', ox: 10, oy: 30 });
  layer(ctx, N.cGrain, { alpha: 0.2 });
  return c;
}

function texDirt(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(6006);
  fillAll(ctx, '#4b3c2c');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.75 });
  layer(ctx, N.cMid, { alpha: 0.45, ox: 70, oy: 20 });
  for (let i = 0; i < 18; i++) blot(ctx, S, S, r() * S, r() * S, 30 + r() * 70, '30,23,16', 0.35);
  for (let i = 0; i < 12; i++) blot(ctx, S, S, r() * S, r() * S, 20 + r() * 60, '112,96,74', 0.18);
  // pebbles
  for (let i = 0; i < 260; i++) {
    const x = 4 + r() * (S - 8);
    const y = 4 + r() * (S - 8);
    const rad = 1 + r() * r() * 4.5;
    const v = 70 + r() * 60;
    ctx.fillStyle = 'rgba(15,11,8,0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 1.2, rad, rad * 0.75, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgb(${v | 0},${(v * 0.92) | 0},${(v * 0.8) | 0})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * 0.75, r() * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,210,190,0.18)';
    ctx.fillRect(x - rad * 0.4, y - rad * 0.5, rad * 0.6, rad * 0.35);
  }
  // straw / twigs
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = 10 + r() * (S - 20);
    const y = 10 + r() * (S - 20);
    const a = r() * TAU;
    const l = 3 + r() * 9;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(120,104,72,0.55)' : 'rgba(40,30,20,0.6)';
    ctx.lineWidth = 0.8 + r() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  layer(ctx, N.cGrain, { alpha: 0.35 });
  layer(ctx, N.cLow, { alpha: 0.25, mode: 'multiply', ox: 99, oy: 13 });
  return c;
}

function texGrass(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(7007);
  fillAll(ctx, '#40372a');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.65, ox: 40 });
  layer(ctx, N.cMid, { alpha: 0.4, ox: 5, oy: 60 });
  for (let i = 0; i < 14; i++) blot(ctx, S, S, r() * S, r() * S, 30 + r() * 80, '24,20,14', 0.3);
  const colors = ['#27321a', '#334020', '#3f4a24', '#4c5029', '#5d5834', '#6a6040'];
  const paths = colors.map(() => new Path2D());
  let tufts = 0;
  for (let tries = 0; tries < 6000 && tufts < 1100; tries++) {
    const x = r() * S;
    const y = r() * S;
    const dens = sampleF(N.low, (x / 2) | 0, (y / 2) | 0);
    if (r() > smoothstep(0.3, 0.7, dens)) continue;
    tufts++;
    const blades = 4 + Math.floor(r() * 7);
    const dead = r() < 0.25;
    for (let b = 0; b < blades; b++) {
      const a = r() * TAU;
      const l = 4 + r() * 11;
      const ci = dead ? 3 + Math.floor(r() * 3) : Math.floor(r() * 4);
      const bx = x + (r() - 0.5) * 3;
      const by = y + (r() - 0.5) * 3;
      const ex = bx + Math.cos(a) * l;
      const ey = by + Math.sin(a) * l;
      const cxp = bx + Math.cos(a + 0.4) * l * 0.5;
      const cyp = by + Math.sin(a + 0.4) * l * 0.5;
      wrap9(S, S, Math.min(bx, ex) - 2, Math.min(by, ey) - 2, Math.max(bx, ex) + 2, Math.max(by, ey) + 2, (dx, dy) => {
        paths[ci].moveTo(bx + dx, by + dy);
        paths[ci].quadraticCurveTo(cxp + dx, cyp + dy, ex + dx, ey + dy);
      });
    }
  }
  ctx.lineCap = 'round';
  // shadow pass then colour
  ctx.strokeStyle = 'rgba(10,8,5,0.5)';
  ctx.lineWidth = 2.2;
  ctx.save();
  ctx.translate(1, 1.5);
  for (const p of paths) ctx.stroke(p);
  ctx.restore();
  paths.forEach((p, i) => {
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1.3;
    ctx.stroke(p);
  });
  layer(ctx, N.cGrain, { alpha: 0.22 });
  layer(ctx, N.cLow, { alpha: 0.2, mode: 'multiply', ox: 130, oy: 70 });
  return c;
}

function texTarmac(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(8008);
  fillAll(ctx, '#3b3b39');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.5, ox: 77 });
  layer(ctx, N.cMid, { alpha: 0.3, ox: 20, oy: 20 });
  // repair patches
  for (let i = 0; i < 3; i++) {
    const x = r() * S;
    const y = r() * S;
    const w = 60 + r() * 110;
    const h = 40 + r() * 90;
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const cx = k === 1 || k === 2 ? w : 0;
      const cy = k >= 2 ? h : 0;
      pts.push(cx + (r() - 0.5) * 12, cy + (r() - 0.5) * 12);
    }
    const tone = r() < 0.5 ? 'rgba(22,22,22,0.55)' : 'rgba(95,95,90,0.25)';
    wrap9(S, S, x - 10, y - 10, x + w + 10, y + h + 10, (dx, dy) => {
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.moveTo(x + dx + pts[0], y + dy + pts[1]);
      for (let k = 2; k < 8; k += 2) ctx.lineTo(x + dx + pts[k], y + dy + pts[k + 1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,10,10,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }
  // aggregate
  for (let i = 0; i < 2600; i++) {
    const v = r() < 0.6 ? 110 + r() * 80 : 15 + r() * 20;
    ctx.fillStyle = `rgba(${v | 0},${v | 0},${(v * 0.96) | 0},${0.25 + r() * 0.45})`;
    const s = r() < 0.85 ? 1 : 2;
    ctx.fillRect(r() * S, r() * S, s, s);
  }
  for (let i = 0; i < 6; i++) blot(ctx, S, S, r() * S, r() * S, 25 + r() * 60, '8,8,10', 0.35);
  // tar-sealed cracks
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const pts = walk(r, r() * S, r() * S, 40, 8, r() * TAU, 0.7);
    ctx.strokeStyle = 'rgba(16,16,15,0.55)';
    ctx.lineWidth = 3.5 + r() * 2.5;
    strokeWrapped(ctx, S, S, pts);
    ctx.strokeStyle = 'rgba(120,120,125,0.08)';
    ctx.lineWidth = 1.5;
    strokeWrapped(ctx, S, S, pts, -1.5, -1.5);
  }
  ctx.restore();
  cracks(ctx, S, S, r, 7, { steps: 40, step: 7, wander: 1.0, lw: 1.8, color: 'rgba(10,10,9,0.85)', light: 'rgba(140,140,135,0.18)', branches: 3 });
  // weeds in cracks
  for (let i = 0; i < 60; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.fillStyle = `rgba(${40 + r() * 20},${55 + r() * 20},${25},0.5)`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + r() * 1.6, 0, TAU);
    ctx.fill();
  }
  layer(ctx, N.cGrain, { alpha: 0.4 });
  layer(ctx, N.cLow, { alpha: 0.2, mode: 'multiply', ox: 45, oy: 190 });
  return c;
}

function texMetal(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(9009);
  fillAll(ctx, '#535838');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.35, ox: 10, oy: 60 });
  layer(ctx, N.cMid, { alpha: 0.2, ox: 100, oy: 12 });
  // paint chips clusters
  for (let cl = 0; cl < 14; cl++) {
    const cx = r() * S;
    const cy = r() * S;
    const n = 4 + Math.floor(r() * 12);
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 50;
      const y = cy + (r() - 0.5) * 50;
      const rad = 1.5 + r() * 5;
      const pts = [];
      const k = 5 + Math.floor(r() * 3);
      for (let q = 0; q < k; q++) {
        const a = (q / k) * TAU;
        const rr = rad * (0.5 + r() * 0.7);
        pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      const rust = r() < 0.4;
      wrap9(S, S, x - rad * 2, y - rad * 2, x + rad * 2, y + rad * 2, (dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx + pts[0], y + dy + pts[1]);
        for (let q = 2; q < pts.length; q += 2) ctx.lineTo(x + dx + pts[q], y + dy + pts[q + 1]);
        ctx.closePath();
        ctx.fillStyle = rust ? '#6a3a1c' : '#77776f';
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,26,18,0.6)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });
    }
  }
  // scratches
  ctx.lineCap = 'round';
  for (let i = 0; i < 320; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = (r() - 0.5) * 1.2 + (r() < 0.3 ? Math.PI / 2 : 0);
    const l = 4 + r() * r() * 50;
    ctx.strokeStyle = r() < 0.8 ? `rgba(175,175,160,${0.12 + r() * 0.25})` : 'rgba(20,20,14,0.3)';
    ctx.lineWidth = 0.5 + r() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) streak(ctx, S, S, r() * S, r() * S, 3 + r() * 7, 40 + r() * 140, '92,46,20', 0.18 + r() * 0.15);
  for (let i = 0; i < 10; i++) blot(ctx, S, S, r() * S, r() * S, 30 + r() * 70, '28,28,20', 0.2);
  layer(ctx, N.cGrain, { alpha: 0.2 });
  return c;
}

function texRust(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(10010);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const ramp = [
    [0, [40, 22, 13]],
    [0.35, [92, 46, 22]],
    [0.62, [140, 72, 32]],
    [0.85, [168, 104, 58]],
    [1, [150, 120, 90]],
  ];
  const lerpRamp = (t) => {
    for (let i = 1; i < ramp.length; i++) {
      if (t <= ramp[i][0]) {
        const [t0, c0] = ramp[i - 1];
        const [t1, c1] = ramp[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return ramp[ramp.length - 1][1];
  };
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const n = N.low[i] * 0.55 + sampleF(N.mid, x + 31, y + 77) * 0.3 + N.grain[i] * 0.15;
      const col = lerpRamp(clamp01((n - 0.15) * 1.35));
      const pit = N.grain[(i * 7 + 13) & 65535] < 0.04 ? 0.55 : 1;
      const q = i * 4;
      d[q] = col[0] * pit;
      d[q + 1] = col[1] * pit;
      d[q + 2] = col[2] * pit;
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 10; i++) streak(ctx, S, S, r() * S, r() * S, 2 + r() * 6, 30 + r() * 100, '50,24,10', 0.25);
  for (let i = 0; i < 8; i++) blot(ctx, S, S, r() * S, r() * S, 10 + r() * 30, '30,15,8', 0.35);
  // flaky scale edges
  cracks(ctx, S, S, r, 6, { steps: 12, step: 5, wander: 1.6, lw: 0.9, color: 'rgba(25,12,6,0.6)', light: 'rgba(200,140,90,0.2)', branches: 1 });
  return c;
}

function texSandbag(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(11011);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const P = 4;
  const colV = new Float32Array(S / P);
  const rowV = new Float32Array(S / P);
  for (let i = 0; i < colV.length; i++) { colV[i] = 0.78 + r() * 0.35; rowV[i] = 0.78 + r() * 0.35; }
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const cx = (x / P) | 0;
      const cy = (y / P) | 0;
      const tx = (x % P + 0.5) / P;
      const ty = (y % P + 0.5) / P;
      const warp = ((cx + cy) & 1) === 0;
      let v = warp ? Math.sin(Math.PI * tx) * colV[cx] : Math.sin(Math.PI * ty) * rowV[cy];
      v = 0.45 + 0.55 * v;
      if (x % P === P - 1 && y % P === P - 1) v *= 0.45;
      const n = 0.62 + 0.5 * N.low[i];
      const g = 0.9 + 0.2 * N.grain[i];
      const k = v * n * g;
      const q = i * 4;
      d[q] = 142 * k;
      d[q + 1] = 120 * k;
      d[q + 2] = 82 * k;
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 9; i++) blot(ctx, S, S, r() * S, r() * S, 16 + r() * 40, '52,40,26', 0.35);
  for (let i = 0; i < 5; i++) blot(ctx, S, S, r() * S, r() * S, 20 + r() * 40, '28,24,18', 0.3);
  ctx.lineCap = 'round';
  for (let i = 0; i < 25; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * TAU;
    ctx.strokeStyle = 'rgba(180,160,120,0.35)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * 5 + 2, y + Math.sin(a) * 5, x + Math.cos(a) * 10, y + Math.sin(a) * 10);
    ctx.stroke();
  }
  return c;
}

function texPlank(N) {
  const W = 256;
  const H = 64;
  const c = mkCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = mulberry32(12012);
  ctx.fillStyle = '#7d654b';
  ctx.fillRect(0, 0, W, H);
  layer(ctx, N.cStreak, { alpha: 0.6, rot: 90, sx: 0.5, sy: 1.5, oy: 30 });
  layer(ctx, N.cLow, { alpha: 0.3, sx: 1, sy: 0.25 });
  grainLines(ctx, r, 2, H - 4, W, 14, '35,22,12', true);
  grainLines(ctx, r, 2, H - 4, W, 4, '200,175,140', true);
  knot(ctx, 150, 22, 4, 3, 0.2);
  // split from the left end
  ctx.strokeStyle = 'rgba(15,9,5,0.8)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 40);
  ctx.bezierCurveTo(20, 41, 40, 38, 70, 39);
  ctx.stroke();
  // end grain & edges
  const endL = ctx.createLinearGradient(0, 0, 14, 0);
  endL.addColorStop(0, 'rgba(20,12,6,0.65)');
  endL.addColorStop(1, 'rgba(20,12,6,0)');
  ctx.fillStyle = endL;
  ctx.fillRect(0, 0, 14, H);
  const endR = ctx.createLinearGradient(W, 0, W - 14, 0);
  endR.addColorStop(0, 'rgba(20,12,6,0.65)');
  endR.addColorStop(1, 'rgba(20,12,6,0)');
  ctx.fillStyle = endR;
  ctx.fillRect(W - 14, 0, 14, H);
  edgeShade(ctx, 0, 0, W, H, 7, 0.5, 'tb');
  ctx.fillStyle = 'rgba(230,210,180,0.12)';
  ctx.fillRect(0, 1, W, 1);
  // scratches
  for (let i = 0; i < 18; i++) {
    const x = r() * W;
    const y = 4 + r() * (H - 8);
    ctx.strokeStyle = r() < 0.5 ? 'rgba(220,200,170,0.2)' : 'rgba(20,12,6,0.35)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 + r() * 20, y + (r() - 0.5) * 3);
    ctx.stroke();
  }
  for (const nx of [13, W - 13]) {
    for (const ny of [18, 46]) nail(ctx, W, H, nx + (r() - 0.5) * 3, ny, 3.2, 0.4, false);
  }
  layer(ctx, N.cGrain, { alpha: 0.25 });
  layer(ctx, N.cLow, { alpha: 0.25, mode: 'multiply', ox: 77 });
  return c;
}

/** Text drawn onto its own layer, stencil-cut and worn, then multiplied on. */
function stencil(ctx, N, lines, { color = '#16140f', alpha = 0.85, wear = 0.55, glow = null } = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const t = mkCanvas(W, H);
  const tc = t.getContext('2d');
  tc.textAlign = 'center';
  tc.textBaseline = 'middle';
  for (const L of lines) {
    tc.save();
    tc.translate(L.x, L.y);
    if (L.rot) tc.rotate(L.rot);
    tc.font = `${L.weight ?? 900} ${L.size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
    tc.fillStyle = L.color ?? color;
    tc.fillText(L.text, 0, 0);
    // stencil bridges
    tc.globalCompositeOperation = 'destination-out';
    tc.fillRect(-W, -L.size * 0.04, W * 2, Math.max(1.5, L.size * 0.06));
    tc.restore();
  }
  // wear: blotchy + grainy erasure
  tc.globalCompositeOperation = 'destination-out';
  tc.globalAlpha = wear;
  tc.fillStyle = tc.createPattern(N.aBlotch, 'repeat');
  tc.fillRect(0, 0, W, H);
  tc.globalAlpha = wear * 0.7;
  tc.fillStyle = tc.createPattern(N.aGrain, 'repeat');
  tc.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
  }
  ctx.drawImage(t, 0, 0);
  ctx.restore();
}

function woodBoards(ctx, N, r, x, y, w, h, n, base, horizontal = true) {
  const bs = (horizontal ? h : w) / n;
  for (let i = 0; i < n; i++) {
    const bx = horizontal ? x : x + i * bs;
    const by = horizontal ? y + i * bs : y;
    const bw = horizontal ? w : bs;
    const bh = horizontal ? bs : h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.clip();
    const v = 0.85 + r() * 0.3;
    ctx.fillStyle = `rgb(${(base[0] * v) | 0},${(base[1] * v) | 0},${(base[2] * v) | 0})`;
    ctx.fillRect(bx, by, bw, bh);
    layer(ctx, N.cStreak, { alpha: 0.5, rot: horizontal ? 90 : 0, sx: 1, sy: 2, ox: r() * 256, oy: r() * 256 });
    if (horizontal) grainLines(ctx, r, by, bh, ctx.canvas.width, 10, '25,15,8', true);
    else grainLines(ctx, r, bx, bw, ctx.canvas.height, 10, '25,15,8');
    edgeShade(ctx, bx + 1, by + 1, bw - 2, bh - 2, 8, 0.45);
    ctx.restore();
  }
}

function texCrate(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(13013);
  fillAll(ctx, '#1a120b');
  woodBoards(ctx, N, r, 0, 0, S, S, 4, [128, 100, 66]);
  // frame battens
  const F = 46;
  const battens = [
    [0, 0, S, F, true], [0, S - F, S, F, true],
    [0, F, F, S - 2 * F, false], [S - F, F, F, S - 2 * F, false],
  ];
  for (const [x, y, w, h, hor] of battens) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#6f5436';
    ctx.fillRect(x, y, w, h);
    layer(ctx, N.cStreak, { alpha: 0.5, rot: hor ? 90 : 0, sx: 1, sy: 2, ox: r() * 256 });
    if (hor) grainLines(ctx, r, y, h, S, 6, '25,15,8', true);
    else grainLines(ctx, r, x, w, S, 6, '25,15,8');
    edgeShade(ctx, x, y, w, h, 9, 0.6);
    ctx.restore();
  }
  // diagonal brace shadow + corner nails
  for (const [x, y] of [[F / 2, F / 2], [S - F / 2, F / 2], [F / 2, S - F / 2], [S - F / 2, S - F / 2]]) {
    nail(ctx, S, S, x - 8, y - 6, 3, 0.25, false);
    nail(ctx, S, S, x + 7, y + 7, 3, 0.25, false);
  }
  stencil(ctx, N, [
    { text: 'MUNITION', x: 256, y: 150, size: 56 },
    { text: '7,92 mm  S.m.K.', x: 256, y: 232, size: 36 },
    { text: '1500 PATR.', x: 256, y: 296, size: 38 },
    { text: 'LOS 17-1943', x: 256, y: 372, size: 28, weight: 700 },
  ], { color: '#15130e', alpha: 0.82, wear: 0.6 });
  stencil(ctx, N, [{ text: '↑', x: 440, y: 120, size: 60 }], { color: '#15130e', alpha: 0.6, wear: 0.5 });
  layer(ctx, N.cLow, { scale: 2, alpha: 0.35, mode: 'multiply', ox: 20 });
  layer(ctx, N.cGrain, { alpha: 0.2 });
  return c;
}

function texBoxLid(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(14014);
  fillAll(ctx, '#0b0705');
  woodBoards(ctx, N, r, 0, 0, S, S, 5, [52, 37, 26]);
  // iron corner brackets
  const B = 70;
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [S, 0, -1, 1], [0, S, 1, -1], [S, S, -1, -1]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.fillStyle = '#1e1d1b';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(B, 0);
    ctx.lineTo(B, 16);
    ctx.lineTo(16, 16);
    ctx.lineTo(16, B);
    ctx.lineTo(0, B);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,110,100,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const [x, y] of [[8, 8], [B - 8, 8], [8, B - 8]]) {
      ctx.fillStyle = '#0c0b0a';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,150,140,0.3)';
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  // faint glowing stencilled question mark
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 230);
  g.addColorStop(0, 'rgba(120,255,215,0.10)');
  g.addColorStop(1, 'rgba(120,255,215,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  stencil(ctx, N, [{ text: '?', x: 256, y: 268, size: 330, weight: 900 }], {
    color: '#cfe9df', alpha: 0.55, wear: 0.45, glow: 'rgba(110,255,210,0.38)',
  });
  for (const [x, y, rot] of [[110, 110, -0.3], [402, 402, 0.25]]) {
    stencil(ctx, N, [{ text: '?', x, y, size: 64, rot }], { color: '#bfe6da', alpha: 0.35, wear: 0.55 });
  }
  layer(ctx, N.cGrain, { alpha: 0.18 });
  return c;
}

function texCloth(N, seed, base) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(seed);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const colV = new Float32Array(S);
  const rowV = new Float32Array(S);
  for (let i = 0; i < S; i++) { colV[i] = 0.92 + r() * 0.16; rowV[i] = 0.92 + r() * 0.16; }
  const ox = (r() * 256) | 0;
  const oy = (r() * 256) | 0;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const tw = ((x + y) >> 1) & 3;
      const t = tw === 0 ? 1.06 : tw === 1 ? 1.0 : tw === 2 ? 0.9 : 0.84;
      const th = (x & 1) ? colV[x] : rowV[y];
      const n = sampleF(N.low, x + ox, y + oy);
      const m = sampleF(N.mid, x + oy, y + ox);
      const k = t * th * (0.7 + 0.5 * n) * (0.9 + 0.2 * m) * (0.93 + 0.14 * N.grain[i]);
      const q = i * 4;
      d[q] = base[0] * k;
      d[q + 1] = base[1] * k;
      d[q + 2] = base[2] * k;
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 8; i++) blot(ctx, S, S, r() * S, r() * S, 14 + r() * 36, '58,44,28', 0.25 + r() * 0.2);
  for (let i = 0; i < 4; i++) blot(ctx, S, S, r() * S, r() * S, 10 + r() * 26, '26,20,16', 0.35);
  for (let i = 0; i < 3; i++) blot(ctx, S, S, r() * S, r() * S, 6 + r() * 16, '70,10,8', 0.45);
  for (let i = 0; i < 5; i++) blot(ctx, S, S, r() * S, r() * S, 20 + r() * 30, '170,170,150', 0.06);
  // tears / holes with frayed edges
  for (let i = 0; i < 3; i++) {
    const x = 20 + r() * (S - 40);
    const y = 20 + r() * (S - 40);
    const rad = 3 + r() * 6;
    ctx.fillStyle = 'rgba(10,8,6,0.85)';
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      const rr = rad * (0.5 + r() * 0.8);
      const px = x + Math.cos(a) * rr * 1.4;
      const py = y + Math.sin(a) * rr;
      k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(${base[0] + 30},${base[1] + 30},${base[2] + 25},0.5)`;
    ctx.lineWidth = 0.6;
    for (let k = 0; k < 8; k++) {
      const a = r() * TAU;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad * 0.7);
      ctx.lineTo(x + Math.cos(a) * rad * 0.4, y + Math.sin(a) * rad * 0.3);
      ctx.stroke();
    }
  }
  return c;
}

function texSkin(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(15015);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const base = [112, 124, 96];
  const bruise = [86, 64, 76];
  const yellow = [146, 140, 92];
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const n = N.low[i];
      const m = sampleF(N.mid, x + 50, y + 90);
      let R = base[0];
      let G = base[1];
      let B = base[2];
      if (n > 0.64) {
        const t = smoothstep(0.64, 0.9, n) * 0.85;
        R += (bruise[0] - R) * t; G += (bruise[1] - G) * t; B += (bruise[2] - B) * t;
      } else if (n < 0.3) {
        const t = smoothstep(0.3, 0.08, n) * 0.8;
        R += (yellow[0] - R) * t; G += (yellow[1] - G) * t; B += (yellow[2] - B) * t;
      }
      let k = 0.82 + 0.32 * m;
      const g = N.grain[i];
      if (g < 0.07) k *= 0.78;
      else k *= 0.95 + 0.1 * g;
      const q = i * 4;
      d[q] = R * k;
      d[q + 1] = G * k;
      d[q + 2] = B * k;
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // veins
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(40,30,70,0.6)';
  ctx.shadowBlur = 3;
  for (let i = 0; i < 12; i++) {
    const pts = walk(r, r() * S, r() * S, 16, 5, r() * TAU, 0.8);
    ctx.strokeStyle = 'rgba(58,44,82,0.55)';
    ctx.lineWidth = 1.4;
    strokeWrapped(ctx, S, S, pts);
    for (let b = 0; b < 3; b++) {
      const j = 2 * (1 + Math.floor(r() * 12));
      const sub = walk(r, pts[j], pts[j + 1], 6, 4, r() * TAU, 1.0);
      ctx.lineWidth = 0.7;
      strokeWrapped(ctx, S, S, sub);
    }
  }
  ctx.restore();
  // lesions and wounds
  for (let i = 0; i < 6; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 3 + r() * 9;
    blot(ctx, S, S, x, y, rad * 2, '60,40,34', 0.35);
    blot(ctx, S, S, x, y, rad, '72,12,10', 0.7);
    blot(ctx, S, S, x, y, rad * 0.45, '25,6,5', 0.8);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(40,34,26,0.4)';
    ctx.beginPath();
    ctx.arc(4 + r() * (S - 8), 4 + r() * (S - 8), 0.6 + r() * 1.4, 0, TAU);
    ctx.fill();
  }
  return c;
}

function texPlayerSkin(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(16016);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const n = sampleF(N.low, x + 140, y + 12);
      const m = sampleF(N.mid, x + 9, y + 200);
      const g = N.grain[i];
      const k = 0.93 + 0.1 * n + 0.04 * m + (g < 0.05 ? -0.06 : 0.02 * g);
      const red = 0.03 * m;
      const q = i * 4;
      d[q] = Math.min(255, 196 * k * (1 + red));
      d[q + 1] = 148 * k;
      d[q + 2] = 118 * k * (1 - red);
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 6; i++) blot(ctx, S, S, r() * S, r() * S, 20 + r() * 40, '90,70,50', 0.12);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(140,90,60,0.25)';
    ctx.beginPath();
    ctx.arc(4 + r() * (S - 8), 4 + r() * (S - 8), 0.6 + r() * 1.1, 0, TAU);
    ctx.fill();
  }
  return c;
}

function texBlood() {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(17017);
  const cx = 256;
  const cy = 210;
  const cols = ['rgba(98,8,6,0.95)', 'rgba(74,5,4,0.95)', 'rgba(120,14,10,0.9)'];
  // main pool
  ctx.fillStyle = cols[0];
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU;
    const d = r() * 45;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 22 + r() * 36, 0, TAU);
    ctx.fill();
  }
  // lobes
  for (let i = 0; i < 22; i++) {
    const a = r() * TAU;
    const d = 55 + r() * 35;
    ctx.fillStyle = cols[i % 3];
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 6 + r() * 14, 0, TAU);
    ctx.fill();
  }
  // spatter droplets streaking outward
  for (let i = 0; i < 90; i++) {
    const a = r() * TAU;
    const d = 90 + r() * r() * 140;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.85;
    if (x < 14 || x > S - 14 || y < 14 || y > S - 14) continue;
    const rad = 1 + r() * r() * 7;
    ctx.fillStyle = cols[(r() * 3) | 0];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, rad * (1.5 + r()), rad, 0, 0, TAU);
    ctx.fill();
    // tail
    ctx.beginPath();
    ctx.moveTo(rad * 0.5, -rad * 0.5);
    ctx.lineTo(rad * (4 + r() * 4), 0);
    ctx.lineTo(rad * 0.5, rad * 0.5);
    ctx.fill();
    ctx.restore();
  }
  // drips running down
  for (let i = 0; i < 8; i++) {
    const x = cx - 80 + r() * 160;
    const y0 = cy + 25 + r() * 40;
    const len = Math.min(60 + r() * 200, S - 20 - y0);
    const w = 3 + r() * 5;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, cols[0]);
    g.addColorStop(1, cols[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y0);
    ctx.bezierCurveTo(x - w * 0.35, y0 + len * 0.5, x - w * 0.25, y0 + len * 0.8, x - w * 0.3, y0 + len);
    ctx.lineTo(x + w * 0.3, y0 + len);
    ctx.bezierCurveTo(x + w * 0.25, y0 + len * 0.8, x + w * 0.35, y0 + len * 0.5, x + w / 2, y0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y0 + len, w * 0.55, 0, TAU);
    ctx.fill();
  }
  // darker congealed core and a faint wet highlight
  ctx.globalCompositeOperation = 'source-atop';
  const core = ctx.createRadialGradient(cx, cy, 5, cx, cy, 110);
  core.addColorStop(0, 'rgba(30,0,0,0.55)');
  core.addColorStop(1, 'rgba(30,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,190,180,0.06)';
  ctx.beginPath();
  ctx.ellipse(cx - 30, cy - 30, 40, 16, -0.4, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function texScorch(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      const dx = (x - 128) / 128;
      const dy = (y - 128) / 128;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      const ray = sampleF(N.streak, ((ang / TAU) * 256 + 256) | 0, (dist * 60) | 0);
      const n = N.low[i];
      const edge = 0.58 + (n - 0.5) * 0.45 + (ray - 0.5) * 0.18;
      let a = 1 - smoothstep(edge * 0.3, edge, dist);
      a = Math.pow(a, 1.2) * (1 - smoothstep(0.86, 0.99, dist));
      const g = N.grain[i];
      a *= 0.82 + 0.18 * g;
      const t = clamp01(dist / edge);
      const q = i * 4;
      d[q] = 12 + 46 * t;
      d[q + 1] = 10 + 30 * t;
      d[q + 2] = 8 + 18 * t;
      d[q + 3] = 235 * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const r = mulberry32(18018);
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU;
    const dd = 60 + r() * 55;
    ctx.fillStyle = `rgba(10,8,6,${0.3 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(128 + Math.cos(a) * dd, 128 + Math.sin(a) * dd, 0.8 + r() * 2, 0, TAU);
    ctx.fill();
  }
  return c;
}

function texPaper(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(19019);
  fillAll(ctx, '#c7b68d');
  layer(ctx, N.cLow, { scale: 2, alpha: 0.35 });
  layer(ctx, N.cMid, { alpha: 0.18 });
  // printed notice
  ctx.fillStyle = 'rgba(28,24,20,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 64px "Times New Roman", Georgia, serif';
  ctx.fillText('NOTICE', 256, 78);
  ctx.fillRect(60, 118, 392, 4);
  ctx.font = '700 26px "Times New Roman", Georgia, serif';
  ctx.fillText('AIRFIELD PERSONNEL ONLY', 256, 146);
  ctx.fillRect(60, 170, 392, 2);
  for (let line = 0; line < 11; line++) {
    let x = 64;
    const y = 196 + line * 22;
    const end = line === 10 ? 280 : 448;
    while (x < end) {
      const w = 10 + r() * 38;
      ctx.fillStyle = `rgba(35,30,25,${0.45 + r() * 0.3})`;
      ctx.fillRect(x, y, Math.min(w, end - x), 7);
      x += w + 6;
    }
  }
  ctx.font = 'italic 700 20px "Times New Roman", Georgia, serif';
  ctx.fillStyle = 'rgba(28,24,20,0.8)';
  ctx.fillText('BY ORDER OF THE COMMANDANT', 256, 460);
  // rubber stamp
  ctx.save();
  ctx.translate(372, 408);
  ctx.rotate(-0.28);
  ctx.strokeStyle = 'rgba(140,25,20,0.55)';
  ctx.fillStyle = 'rgba(140,25,20,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 50, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 42, 0, TAU);
  ctx.stroke();
  ctx.font = '900 18px Arial, sans-serif';
  ctx.fillText('PASSED', 0, 0);
  ctx.restore();
  // foxing, stains, water rings
  for (let i = 0; i < 40; i++) blot(ctx, S, S, 10 + r() * (S - 20), 10 + r() * (S - 20), 2 + r() * 8, '120,80,40', 0.3);
  for (let i = 0; i < 6; i++) blot(ctx, S, S, r() * S, r() * S, 40 + r() * 80, '130,100,50', 0.18);
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = 'rgba(110,80,40,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(80 + r() * 350, 80 + r() * 350, 30 + r() * 30, r() * 3, r() * 3 + 4.5);
    ctx.stroke();
  }
  // fold creases
  for (const [x0, y0, x1, y1] of [[256, 0, 258, S], [0, 250, S, 254]]) {
    ctx.strokeStyle = 'rgba(80,60,40,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,220,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 1.5, y0 + 1.5);
    ctx.lineTo(x1 + 1.5, y1 + 1.5);
    ctx.stroke();
  }
  // grime vignette
  const v = ctx.createRadialGradient(256, 256, 150, 256, 256, 380);
  v.addColorStop(0, 'rgba(60,40,20,0)');
  v.addColorStop(1, 'rgba(60,40,20,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  layer(ctx, N.cGrain, { alpha: 0.18 });
  return c;
}

function texBark(N) {
  const S = 256;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const warp = fbm(S, S, 20020, { cells: 4, cellsY: 3, octaves: 3 });
  const plates = fbm(S, S, 20021, { cells: 14, cellsY: 6, octaves: 2 });
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const K = 7;
  for (let y = 0, i = 0; y < S; y++) {
    for (let x = 0; x < S; x++, i++) {
      // vertical fissures, wobbling with a periodic warp so the tile wraps
      const fx = (x / S) * K + (warp[i] - 0.5) * 0.9 + (plates[i] - 0.5) * 0.3;
      const v = Math.abs(Math.sin(fx * Math.PI));
      // wide dark fissures between narrower raised plates, broken by cross cracks
      let cr = smoothstep(0.2, 0.85, v);
      const brk = smoothstep(0.08, 0.02, Math.abs(plates[i] - 0.5)) * 0.6;
      cr *= (1 - brk) * (0.75 + 0.25 * smoothstep(0.25, 0.7, plates[i]));
      let R = 24 + (96 - 24) * cr;
      let G = 20 + (86 - 20) * cr;
      let B = 17 + (74 - 17) * cr;
      const lich = smoothstep(0.66, 0.8, sampleF(N.low, x + 60, y + 30)) * (N.grain[i] > 0.4 ? 1 : 0.3) * cr;
      R += (128 - R) * lich * 0.6;
      G += (136 - G) * lich * 0.6;
      B += (108 - B) * lich * 0.6;
      const k = 0.88 + 0.24 * N.grain[i] * (0.6 + 0.4 * sampleF(N.streak, x, y));
      const q = i * 4;
      d[q] = R * k;
      d[q + 1] = G * k;
      d[q + 2] = B * k;
      d[q + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texCeiling(N) {
  const S = 512;
  const c = mkCanvas(S);
  const ctx = c.getContext('2d');
  const r = mulberry32(21021);
  fillAll(ctx, '#0d0906');
  woodBoards(ctx, N, r, 0, 0, S, S, 8, [92, 73, 54]);
  // soot and water stains on boards
  for (let i = 0; i < 10; i++) blot(ctx, S, S, r() * S, r() * S, 40 + r() * 90, '15,12,9', 0.35);
  for (let i = 0; i < 4; i++) blot(ctx, S, S, r() * S, r() * S, 30 + r() * 50, '100,80,50', 0.15);
  // heavy beam across the tile (wraps at x = 0)
  const BW = 92;
  const bx = S - BW / 2;
  for (const dx of [0, -S]) {
    const x = bx + dx;
    // shadows cast on the boards beside the beam
    const sl = ctx.createLinearGradient(x - 40, 0, x, 0);
    sl.addColorStop(0, 'rgba(0,0,0,0)');
    sl.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = sl;
    ctx.fillRect(x - 40, 0, 40, S);
    const sr = ctx.createLinearGradient(x + BW + 40, 0, x + BW, 0);
    sr.addColorStop(0, 'rgba(0,0,0,0)');
    sr.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = sr;
    ctx.fillRect(x + BW, 0, 40, S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, BW, S);
    ctx.clip();
    ctx.fillStyle = '#3a2c20';
    ctx.fillRect(x, 0, BW, S);
    layer(ctx, N.cStreak, { alpha: 0.6, sx: 1, sy: 2, ox: 40 });
    const rr = mulberry32(21022);
    grainLines(ctx, rr, x + 6, BW - 12, S, 14, '18,10,5');
    const side = ctx.createLinearGradient(x, 0, x + BW, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.65)');
    side.addColorStop(0.16, 'rgba(0,0,0,0.25)');
    side.addColorStop(0.17, 'rgba(255,220,180,0.06)');
    side.addColorStop(0.83, 'rgba(0,0,0,0)');
    side.addColorStop(0.84, 'rgba(0,0,0,0.3)');
    side.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = side;
    ctx.fillRect(x, 0, BW, S);
    ctx.restore();
    for (let y = 40; y < S; y += 128) {
      nail(ctx, S, S, x + BW * 0.5, y, 3.5, 0.3, false);
    }
    // cobwebs where beam meets boards
    ctx.strokeStyle = 'rgba(210,210,200,0.12)';
    ctx.lineWidth = 0.6;
    for (let k = 0; k < 4; k++) {
      const y = rr() * S;
      const wx = k % 2 ? x + BW : x;
      const dir = k % 2 ? 1 : -1;
      for (let s = 0; s < 6; s++) {
        ctx.beginPath();
        ctx.moveTo(wx, y + s * 5);
        ctx.quadraticCurveTo(wx + dir * 12, y + s * 5 + 12, wx + dir * (20 + s * 4), y + s * 5 - 4);
        ctx.stroke();
      }
    }
  }
  layer(ctx, N.cLow, { scale: 2, alpha: 0.3, mode: 'multiply', ox: 5, oy: 99 });
  layer(ctx, N.cGrain, { alpha: 0.18 });
  return c;
}

// ---------------------------------------------------------------------------
// Painted low-res pages for the "1997 look" (art/STYLE.md)
// ---------------------------------------------------------------------------
// retro.js swaps each world texture for `userData.painted` when present. These
// pages are painted the way late-90s artists did it: a few hue-shifted ramps per
// material, value clusters and deliberate strokes (a seam is a dark line with a
// light edge, a nail is two pixels, peeling plaster has its shadow under the
// lip), never per-pixel noise. Every stroke wraps, so tiling pages tile.

// Ramps run dark to light: cool shadows, warm highlights. Concrete, wood and
// chalk follow RAMPS in art/zombies/z_ps1b.py (extended upward to the bunker's
// exposure); the others extend the table in the same spirit.
const RAMPS = {
  concrete: [[26, 30, 28], [36, 40, 37], [46, 50, 45], [58, 62, 55], [72, 75, 66], [88, 90, 79], [106, 106, 93], [126, 124, 108]],
  wood: [[22, 16, 13], [30, 22, 18], [46, 34, 26], [64, 48, 34], [86, 66, 46], [108, 84, 58], [132, 104, 72], [156, 128, 92]],
  woodGrey: [[28, 27, 25], [44, 42, 37], [62, 59, 51], [82, 78, 67], [104, 99, 84], [128, 121, 103]],
  plaster: [[40, 43, 38], [57, 59, 51], [76, 77, 66], [96, 95, 81], [116, 113, 96], [136, 132, 112], [156, 150, 128], [176, 168, 144]],
  brick: [[38, 24, 22], [58, 33, 28], [80, 43, 34], [100, 55, 41], [120, 68, 50], [140, 84, 62], [160, 106, 82]],
  mortar: [[40, 41, 38], [62, 61, 55], [86, 84, 75], [110, 106, 94]],
  olive: [[30, 32, 28], [46, 50, 38], [64, 68, 48], [84, 88, 60], [106, 110, 76], [134, 136, 96]],
  steel: [[34, 35, 36], [56, 57, 56], [84, 84, 80], [118, 116, 106], [160, 156, 140]],
  iron: [[16, 16, 17], [30, 29, 28], [50, 48, 45], [80, 76, 70], [120, 114, 104]],
  rust: [[34, 19, 15], [56, 29, 19], [82, 41, 23], [108, 55, 29], [132, 72, 38], [152, 96, 56], [170, 126, 84]],
  burlap: [[50, 40, 30], [72, 60, 42], [96, 82, 58], [120, 104, 74], [144, 126, 90], [166, 148, 108], [186, 170, 128]],
  dirt: [[24, 21, 19], [38, 33, 29], [54, 46, 37], [72, 62, 48], [92, 80, 61], [114, 100, 77]],
  grassDead: [[38, 42, 30], [58, 62, 40], [82, 84, 54], [106, 104, 68]],
  chalk: [[120, 30, 26], [170, 52, 40]],
  teal: [[64, 112, 102], [130, 192, 176], [196, 238, 226]],
  tealDim: [[30, 44, 40], [42, 64, 58]],
};

// Big wall and ground ramps also get the half-steps between their colours, so
// broad value clusters stay calm; on these a shift of 1 is a half step.
const FINE = new Set(['plaster', 'concrete', 'olive', 'dirt', 'burlap']);

class Page {
  constructor(w, h = w) {
    this.w = w;
    this.h = h;
    this.pal = [];
    this.own = [];
    this.reg = {};
    this.px = new Uint16Array(w * h);
  }

  /** Palette index `k` steps up ramp `name` (clamped; half steps on fine ramps). */
  c(name, k) {
    let r = this.reg[name];
    if (!r) {
      const src = RAMPS[name];
      const cols = FINE.has(name)
        ? src.flatMap((c, i) => (i ? [c.map((v, j) => (v + src[i - 1][j]) / 2), c] : [c]))
        : src;
      r = this.reg[name] = { i0: this.pal.length, n: cols.length, f: FINE.has(name) ? 2 : 1 };
      for (const col of cols) { this.pal.push(col); this.own.push(r); }
    }
    return r.i0 + Math.max(0, Math.min(r.n - 1, Math.round(k * r.f)));
  }

  i(x, y) {
    const { w, h } = this;
    x = Math.round(x);
    y = Math.round(y);
    return (((y % h) + h) % h) * w + (((x % w) + w) % w);
  }

  get(x, y) { return this.px[this.i(x, y)]; }

  set(x, y, c) { this.px[this.i(x, y)] = c; }

  /** Step a pixel lighter (+) or darker (-) along its own ramp. */
  shift(x, y, d) {
    const i = this.i(x, y);
    const c = this.px[i];
    const r = this.own[c];
    if (r) this.px[i] = Math.max(r.i0, Math.min(r.i0 + r.n - 1, c + d));
  }

  fill(x, y, w, h, c) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c);
  }

  line(x0, y0, x1, y1, fn) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }

  /** Every pixel inside a ragged ellipse. */
  blob(cx, cy, rx, ry, R, fn, jag = 0.3) {
    const k1 = 2 + Math.floor(R() * 3), k2 = 5 + Math.floor(R() * 3), p1 = R() * TAU, p2 = R() * TAU;
    const X = Math.ceil(rx * (1 + jag)), Y = Math.ceil(ry * (1 + jag));
    const ix = Math.round(cx), iy = Math.round(cy);
    for (let y = -Y; y <= Y; y++) {
      for (let x = -X; x <= X; x++) {
        const a = Math.atan2(y / ry, x / rx);
        const m = 1 + jag * (0.65 * Math.sin(a * k1 + p1) + 0.35 * Math.sin(a * k2 + p2));
        if ((x / rx) ** 2 + (y / ry) ** 2 <= m * m) fn(ix + x, iy + y);
      }
    }
  }

  /** A wandering one-pixel stroke. */
  walk(x, y, ang, steps, R, fn, wander = 0.5) {
    for (let s = 0; s < steps; s++) {
      fn(Math.round(x), Math.round(y), s);
      x += Math.cos(ang);
      y += Math.sin(ang);
      ang += (R() - 0.5) * wander;
    }
  }

  /** Base fill from two periodic fields quantised into value clusters. */
  clusters(ramp, base, seed, { cells = 3, hi = 0.76, lo = 0.24, fine = 8, fhi = 0.84, flo = 0.16, stretch = 1 } = {}) {
    const { w, h } = this;
    const A = fbm(w, h, seed, { cells, cellsY: Math.max(1, Math.round(cells * stretch)), octaves: 2 });
    const B = fbm(w, h, seed + 1, { cells: fine, cellsY: Math.max(1, Math.round(fine * stretch)), octaves: 2 });
    for (let i = 0; i < w * h; i++) {
      const a = A[i], b = B[i];
      const t = (a > hi ? 1 : a < lo ? -1 : 0) + (b > fhi ? 1 : b < flo ? -1 : 0);
      this.px[i] = this.c(ramp, base + Math.max(-1, Math.min(1, t)) * (FINE.has(ramp) ? 0.5 : 1));
    }
    return B;
  }

  /** Nail head: a lit pixel and its shadow, with an optional rust tear. */
  nail(x, y, rust = 0, lit = 3) {
    this.set(x, y, this.c('iron', lit));
    this.set(x + 1, y, this.c('iron', 1));
    this.set(x, y + 1, this.c('iron', 0));
    this.set(x + 1, y + 1, this.c('iron', 1));
    for (let k = 0; k < rust; k++) this.set(x + (k & 1), y + 2 + k, this.c('rust', 2));
  }

  meanLuma() {
    let s = 0;
    for (let i = 0; i < this.px.length; i++) {
      const c = this.pal[this.px[i]];
      s += 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    }
    return s / this.px.length;
  }

  /** Canvas of the page; `gain` scales the palette (keeps the colour count). */
  canvas(gain = 1) {
    const c = mkCanvas(this.w, this.h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    const pal = this.pal.map((col) => col.map((v) => Math.max(0, Math.min(255, Math.round(v * gain)))));
    for (let i = 0, q = 0; i < this.px.length; i++, q += 4) {
      const col = pal[this.px[i]];
      img.data[q] = col[0]; img.data[q + 1] = col[1]; img.data[q + 2] = col[2]; img.data[q + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

/** One-bit mask of stencil text (thresholded, no anti-aliased fringe). */
function textMask(W, H, lines) {
  const c = mkCanvas(W, H);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const L of lines) {
    x.save();
    x.translate(L.x, L.y);
    if (L.rot) x.rotate(L.rot);
    if (L.sx) x.scale(L.sx, 1);
    x.font = `${L.weight ?? 900} ${L.size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
    x.fillText(L.text, 0, 0);
    x.restore();
  }
  const d = x.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 120 ? 1 : 0;
  return m;
}

function paintPlaster() {
  const S = 128, p = new Page(S), R = mulberry32(3103);
  p.clusters('plaster', 3.5, 3104, { cells: 3 });
  // smoke-stained under the ceiling (row ~40 is 3 m up) and damp at the foot
  for (let x = 0; x < S; x++) {
    const a = 50 + Math.round(3 * Math.sin((x / S) * TAU * 2 + 2) + 2 * Math.sin((x / S) * TAU * 5));
    for (let y = 0; y < a; y++) p.shift(x, y, y > a - 3 ? -1 : -2);
    const top = 112 + Math.round(2.5 * Math.sin((x / S) * TAU * 3 + 1) + 1.5 * Math.sin((x / S) * TAU * 7));
    p.shift(x, top, -2);
    for (let y = top + 1; y < S; y++) p.shift(x, y, -1);
  }
  // water stains run down from the ceiling line
  for (let s = 0; s < 7; s++) {
    const x0 = R() * S, y0 = 44 + R() * 20, len = 14 + R() * 40, w0 = 2 + R() * 4;
    for (let t = 0; t < len; t++) {
      const w = Math.max(1, Math.round(w0 * (1 - (t / len) * 0.7) + Math.sin(t * 0.7 + s) * 0.7));
      const xc = x0 + Math.sin(t * 0.15 + s) * 1.2;
      for (let k = 0; k < w; k++) p.shift(xc - w / 2 + k, y0 + t, t > len - 3 || k === 0 ? -3 : -2);
    }
  }
  // grime clusters
  for (let s = 0; s < 5; s++) p.blob(R() * S, 60 + R() * 60, 6 + R() * 10, 4 + R() * 6, R, (x, y) => p.shift(x, y, -1), 0.4);
  // peeling patches: brick shows through, with the plaster lip's shadow painted in
  const hole = new Uint8Array(S * S);
  for (const [cx, cy, rx, ry] of [[24, 76, 11, 7], [90, 100, 13, 7], [104, 58, 6, 9]]) {
    p.blob(cx, cy, rx, ry, R, (x, y) => { hole[p.i(x, y)] = 1; }, 0.25);
    p.blob(cx + rx * 0.6, cy + ry * 0.5, rx * 0.6, ry * 0.6, R, (x, y) => { hole[p.i(x, y)] = 1; }, 0.3);
    p.blob(cx - rx * 0.5, cy - ry * 0.4, rx * 0.5, ry * 0.5, R, (x, y) => { hole[p.i(x, y)] = 1; }, 0.3);
  }
  const H = (x, y) => hole[p.i(x, y)] === 1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!H(x, y)) continue;
      const row = Math.floor(y / 8), off = row & 1 ? 8 : 0, bx = (x + off) % 16, by = y % 8;
      const v = ((row * 7 + Math.floor((x + off) / 16) * 13) % 3) - 1;
      p.set(x, y, by === 7 || bx === 15 ? p.c('mortar', 1) : p.c('brick', 2 + (v > 0 ? 1 : 0) + (by === 0 ? 1 : 0)));
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (H(x, y)) {
        if (!H(x, y - 1)) p.shift(x, y, -2);
        else if (!H(x, y - 2)) p.shift(x, y, -1);
        if (!H(x - 1, y)) p.shift(x, y, -1);
      } else if (H(x, y - 1)) {
        p.shift(x, y, 3); // the broken edge below a hole faces up and catches the bulb
      } else if (H(x, y + 1) || H(x + 1, y)) {
        p.shift(x, y, 1);
      }
    }
  }
  // hairline cracks: a dark line with a light pixel under it
  for (let k = 0; k < 3; k++) {
    p.walk(R() * S, 55 + R() * 50, (R() - 0.5) * 2.4 + (R() < 0.5 ? 0 : Math.PI), 16 + R() * 18, R, (x, y) => {
      if (H(x, y)) return;
      p.shift(x, y, -3);
      if (!H(x, y + 1)) p.shift(x, y + 1, 1);
    }, 0.9);
  }
  return p;
}

function paintBrick() {
  const S = 128, p = new Page(S), R = mulberry32(2102);
  p.fill(0, 0, S, S, p.c('mortar', 1));
  const bh = 16, bw = 32;
  const brick = new Uint8Array(S * S);
  for (let row = 0; row < 8; row++) {
    const off = row & 1 ? 16 : 0;
    for (let col = 0; col < 4; col++) {
      const x0 = col * bw + off, y0 = row * bh, w = bw - 2, h = bh - 2;
      const burnt = R() < 0.14, pale = !burnt && R() < 0.1;
      const k = 3 + (R() < 0.3 ? -1 : R() < 0.3 ? 1 : 0) + (burnt ? -2 : 0) + (pale ? 1 : 0);
      const c = p.c('brick', k);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) { p.set(x0 + x, y0 + y, c); brick[p.i(x0 + x, y0 + y)] = 1; }
      }
      for (let x = 0; x < w; x++) { p.shift(x0 + x, y0, 1); p.shift(x0 + x, y0 + h - 1, -1); }
      for (let y = 1; y < h - 1; y++) p.shift(x0 + w - 1, y0 + y, -1);
      // a couple of fired clusters in the face
      for (let b = 0; b < 2; b++) {
        const d = R() < 0.5 ? -1 : 1;
        p.blob(x0 + 4 + R() * (w - 8), y0 + 3 + R() * (h - 6), 2 + R() * 3, 1 + R() * 1.5, R, (x, y) => {
          const dx = ((x - x0) % S + S) % S, dy = ((y - y0) % S + S) % S;
          if (dx > 0 && dx < w - 1 && dy > 0 && dy < h - 1) p.shift(x, y, d);
        });
      }
      // chipped corner
      if (R() < 0.3) {
        const cx = R() < 0.5 ? x0 : x0 + w - 3, cy = R() < 0.5 ? y0 : y0 + h - 2;
        p.fill(cx, cy, 3, 2, p.c('mortar', 2));
        brick[p.i(cx, cy)] = 0;
      }
    }
  }
  // recessed mortar: shadow under each brick's bottom edge
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!brick[p.i(x, y)] && brick[p.i(x, y - 1)]) p.set(x, y, p.c('mortar', 0));
  // soot runs down from the eaves
  for (let s = 0; s < 4; s++) {
    const x0 = R() * S, len = 30 + R() * 60, w0 = 3 + R() * 6;
    for (let t = 0; t < len; t++) {
      const w = Math.max(1, Math.round(w0 * (1 - t / len)));
      for (let k = 0; k < w; k++) p.shift(x0 + k - w / 2 + Math.sin(t * 0.2 + s) * 1.5, t, -1);
    }
  }
  return p;
}

function paintConcrete() {
  const S = 128, p = new Page(S), R = mulberry32(1102);
  p.clusters('concrete', 5, 1103, { cells: 3 });
  // board-formed casting seams: a dark line with a lit lip, and faint board grain
  for (let i = 0; i < 4; i++) {
    const y = 32 * i + 6 + (i & 1);
    for (let x = 0; x < S; x++) { p.set(x, y, p.c('concrete', 2.5)); p.shift(x, y + 1, 2); }
    for (let g = 0; g < 6; g++) {
      const yy = y + 4 + Math.floor(R() * 24), xx = R() * S, len = 8 + R() * 34;
      for (let t = 0; t < len; t++) if (t % 13 !== 12) p.shift(xx + t, yy, -1);
    }
    // water runs from the seam
    for (let s = 0; s < 2; s++) {
      const xx = R() * S, len = 6 + R() * 16, w = 1 + Math.floor(R() * 3);
      for (let t = 0; t < len; t++) for (let k = 0; k < w - (t > len * 0.6 ? 1 : 0); k++) p.shift(xx + k, y + 2 + t, -2);
    }
  }
  // blowholes in clusters: a dark pixel with a lit lower rim
  for (let cl = 0; cl < 14; cl++) {
    const cx = R() * S, cy = R() * S, n = 3 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const x = cx + (R() - 0.5) * 10, y = cy + (R() - 0.5) * 8;
      p.set(x, y, p.c('concrete', 1));
      if (R() < 0.4) p.set(x + 1, y, p.c('concrete', 2));
      p.shift(x, y + 1, 2);
    }
  }
  for (let k = 0; k < 2; k++) {
    p.walk(R() * S, R() * S, R() * TAU, 30 + R() * 25, R, (x, y) => { p.set(x, y, p.c('concrete', 1.5)); p.shift(x + 1, y + 1, 2); }, 0.8);
  }
  return p;
}

function paintFloorBoards() {
  const S = 128, p = new Page(S), R = mulberry32(5105);
  const bh = 16;
  for (let row = 0; row < 8; row++) {
    const y0 = row * bh;
    const j1 = Math.floor(R() * S), j2 = j1 + 45 + Math.floor(R() * 40);
    for (const [a, b] of [[j1, j2], [j2, j1 + S]]) {
      const k = 3 + (R() < 0.3 ? 1 : 0) - (R() < 0.25 ? 1 : 0);
      p.fill(a, y0, b - a, bh, p.c('wood', k));
      for (let g = 0; g < 7; g++) {
        const gy = y0 + 2 + Math.floor(R() * 11), gx = a + R() * (b - a), len = 6 + R() * 30, d = R() < 0.25 ? 1 : -1;
        for (let t = 0; t < len && gx + t < b - 1; t++) p.shift(gx + t, gy, d);
      }
      if (R() < 0.45) {
        const kx = Math.round(a + 6 + R() * (b - a - 12)), ky = Math.round(y0 + 5 + R() * 6);
        p.shift(kx, ky, -2); p.shift(kx + 1, ky, -2);
        for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 1], [1, 1]]) p.shift(kx + dx, ky + dy, -1);
      }
      // butt joint and its two nails
      for (let y = y0; y < y0 + bh; y++) { p.set(a, y, p.c('wood', 0)); p.shift(a + 1, y, 1); }
      p.nail(a + 3, y0 + 4, 0, 2);
      p.nail(a + 3, y0 + 10, 0, 2);
    }
    for (let x = 0; x < S; x++) {
      p.shift(x, y0, 1);
      p.shift(x, y0 + bh - 2, -1);
      p.set(x, y0 + bh - 1, p.c('wood', 0));
    }
    if (row & 1) p.nail(66, y0 + 6, 0, 2);
  }
  // stains soaked into the boards, one old and dark
  for (let s = 0; s < 4; s++) {
    const cx = R() * S, cy = R() * S, rx = 5 + R() * 9, ry = 3 + R() * 5;
    p.blob(cx, cy, rx, ry, R, (x, y) => p.shift(x, y, -1), 0.4);
    if (s === 0) p.blob(cx, cy, rx * 0.5, ry * 0.5, R, (x, y) => p.shift(x, y, -1), 0.4);
  }
  // scuffed along the grain where people walk
  for (let s = 0; s < 7; s++) {
    const x0 = R() * S, y = Math.floor(R() * 8) * bh + 3 + Math.floor(R() * 9), len = 10 + R() * 26;
    for (let t = 0; t < len; t++) p.shift(x0 + t, y, 1);
  }
  return p;
}

function paintWoodWall() {
  const S = 128, p = new Page(S), R = mulberry32(4104);
  const widths = [22, 20, 23, 21, 20, 22];
  let x0 = 0;
  for (const w of widths) {
    const grey = R() < 0.35;
    const ramp = grey ? 'woodGrey' : 'wood';
    const k = (grey ? 3 : 4) + (R() < 0.3 ? -1 : 0);
    p.fill(x0, 0, w, S, p.c(ramp, k));
    const inside = (x) => { const d = ((x - x0) % S + S) % S; return d >= 1 && d <= w - 2; };
    for (let b = 0; b < 3; b++) {
      const d = b < 2 ? -1 : 1, bx = x0 + 3 + R() * (w - 6), by = R() * S, rx = 2 + R() * 3, ry = 10 + R() * 18;
      if (d < 0 || !grey) p.blob(bx, by, rx, ry, R, (x, y) => { if (inside(x)) p.shift(x, y, d); }, 0.3);
    }
    for (let g = 0; g < 10; g++) {
      const gx = x0 + 2 + Math.floor(R() * (w - 4)), gy = R() * S, len = 8 + R() * 44, d = g < 8 ? -1 : 1;
      for (let t = 0; t < len; t++) p.shift(gx + (t > len / 2 && g & 1 ? 1 : 0), gy + t, d);
    }
    const knots = Math.floor(R() * 2.4);
    for (let n = 0; n < knots; n++) {
      const kx = Math.round(x0 + 5 + R() * (w - 10)), ky = Math.round(R() * S);
      p.shift(kx, ky, -2); p.shift(kx, ky + 1, -2);
      for (const [dx, dy] of [[0, -1], [0, 2], [-1, 0], [1, 0], [-1, 1], [1, 1]]) p.shift(kx + dx, ky + dy, -1);
    }
    if (R() < 0.5) {
      const jy = Math.floor(30 + R() * 70);
      for (let x = x0; x < x0 + w; x++) { p.set(x, jy, p.c(ramp, 0)); p.shift(x, jy + 1, 1); p.shift(x, jy - 1, -1); }
    }
    for (let y = 0; y < S; y++) {
      p.shift(x0, y, 1);
      p.shift(x0 + w - 2, y, -1);
      p.set(x0 + w - 1, y, p.c('wood', 0));
    }
    p.nail(x0 + 5, 18, 2);
    p.nail(x0 + w - 7, 20, 1);
    p.nail(x0 + 5, 82, 1);
    p.nail(x0 + w - 7, 84, 2);
    x0 += w;
  }
  return p;
}

function paintCeiling() {
  const S = 128, p = new Page(S), R = mulberry32(21121);
  for (let row = 0; row < 8; row++) {
    const y0 = row * 16;
    p.fill(0, y0, S, 16, p.c('wood', 2 + (R() < 0.35 ? 1 : 0)));
    for (let g = 0; g < 8; g++) {
      const gy = y0 + 2 + Math.floor(R() * 12), gx = R() * S, len = 10 + R() * 40;
      for (let t = 0; t < len; t++) p.shift(gx + t, gy, R() < 0.9 ? -1 : 0);
    }
    for (let x = 0; x < S; x++) { p.set(x, y0, p.c('wood', 0)); p.shift(x, y0 + 1, -1); p.shift(x, y0 + 15, 1); }
  }
  for (let s = 0; s < 6; s++) p.blob(R() * S, R() * S, 8 + R() * 12, 5 + R() * 8, R, (x, y) => p.shift(x, y, -1), 0.4);
  // the heavy beam across the tile (wraps at x = 0), shading painted on its sides
  const bx = 116, BW = 24;
  for (let y = 0; y < S; y++) {
    for (let k = 1; k <= 4; k++) { p.shift(bx - k, y, k < 3 ? -2 : -1); p.shift(bx + BW - 1 + k, y, k < 3 ? -2 : -1); }
    for (let x = 0; x < BW; x++) {
      const edge = x < 2 ? 0 : x < 4 ? 1 : x >= BW - 2 ? 1 : 2;
      p.set(bx + x, y, p.c('wood', edge));
    }
  }
  for (let g = 0; g < 10; g++) {
    const gx = bx + 5 + Math.floor(R() * (BW - 9)), gy = R() * S, len = 10 + R() * 40;
    for (let t = 0; t < len; t++) p.shift(gx, gy + t, g < 7 ? -1 : 1);
  }
  for (let y = 10; y < S; y += 32) p.nail(bx + 11, y);
  // cobwebs where the beam meets the boards
  for (const [x, y, dir] of [[bx - 1, 30, -1], [bx + BW, 86, 1]]) {
    for (let s = 0; s < 4; s++) p.line(x, y + s * 3, x + dir * (5 + s * 3), y + s * 3 - 4 + s, (a, b) => p.set(a, b, p.c('woodGrey', 4)));
  }
  return p;
}

function paintPlank() {
  const W = 128, H = 32, p = new Page(W, H), R = mulberry32(12112);
  p.fill(0, 0, W, H, p.c('wood', 5));
  for (let b = 0; b < 3; b++) p.blob(10 + R() * 108, 6 + R() * 20, 12 + R() * 16, 3 + R() * 3, R, (x, y) => { if (y > 0 && y < H - 1) p.shift(x, y, b === 1 ? 1 : -1); }, 0.3);
  for (let g = 0; g < 14; g++) {
    const gy = 3 + Math.floor(R() * (H - 6)), gx = R() * W, len = 14 + R() * 60, d = g < 10 ? -1 : 1;
    for (let t = 0; t < len && gx + t < W - 3; t++) p.shift(gx + t, gy + (t > len * 0.6 ? 1 : 0), d);
  }
  const kx = 76, ky = 12;
  p.shift(kx, ky, -3); p.shift(kx + 1, ky, -3);
  for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [1, -1], [0, 1], [1, 1], [-2, 0], [3, 0]]) p.shift(kx + dx, ky + dy, -1);
  // split from the left end, lit on its lower lip
  p.line(0, 21, 36, 20, (x, y) => { p.set(x, y, p.c('wood', 1)); p.shift(x, y + 1, 1); });
  // end grain and edges
  for (let y = 0; y < H; y++) {
    for (const [x, d] of [[0, -2], [1, -1], [2, -1], [W - 1, -2], [W - 2, -1], [W - 3, -1]]) p.shift(x, y, d);
  }
  for (let x = 0; x < W; x++) { p.shift(x, 0, 1); p.shift(x, 1, 1); p.shift(x, H - 2, -1); p.set(x, H - 1, p.c('wood', 2)); }
  for (const nx of [6, W - 8]) for (const ny of [7, 22]) p.nail(nx + Math.floor(R() * 2), ny, 2);
  return p;
}

function paintCrate() {
  const S = 128, p = new Page(S), R = mulberry32(13113);
  for (let b = 0; b < 4; b++) {
    const y0 = b * 32;
    p.fill(0, y0, S, 32, p.c('wood', 5 - (b & 1) - (R() < 0.3 ? 1 : 0)));
    for (let g = 0; g < 9; g++) {
      const gy = y0 + 3 + Math.floor(R() * 26), gx = R() * S, len = 10 + R() * 50;
      for (let t = 0; t < len; t++) p.shift(gx + t, gy, g < 7 ? -1 : 1);
    }
    for (let x = 0; x < S; x++) { p.shift(x, y0 + 1, 1); p.shift(x, y0 + 30, -1); p.set(x, y0 + 31, p.c('wood', 1)); }
  }
  // stencilled lot marking, worn away in clusters
  const m = textMask(S, S, [
    { text: '7,92 S.m.K.', x: 64, y: 21, size: 10, weight: 700 },
    { text: 'MUNITION', x: 64, y: 47, size: 16, sx: 0.9 },
    { text: '1500 PATR.', x: 64, y: 79, size: 12, sx: 0.9 },
    { text: 'LOS 17-43', x: 64, y: 105, size: 9, weight: 700 },
  ]);
  const wear = fbm(S, S, 13114, { cells: 10, octaves: 2 });
  for (let i = 0; i < m.length; i++) if (m[i] && wear[i] < 0.78 && (i >> 7) % 32 < 30) p.px[i] = p.c('iron', 1);
  // frame battens: lit on their top/left edges, casting a shadow onto the boards
  const F = 12;
  const batten = (x, y, w, h, vert) => {
    p.fill(x, y, w, h, p.c('wood', 3));
    for (let g = 0; g < 4; g++) {
      if (vert) { const gx = x + 2 + Math.floor(R() * (w - 4)); for (let t = 0; t < h; t++) if ((t + g * 7) % 23 < 15) p.shift(gx, y + t, -1); }
      else { const gy = y + 2 + Math.floor(R() * (h - 4)); for (let t = 0; t < w; t++) if ((t + g * 11) % 37 < 26) p.shift(x + t, gy, -1); }
    }
    for (let t = 0; t < w; t++) { p.shift(x + t, y, 2); p.set(x + t, y + h - 1, p.c('wood', 1)); }
    for (let t = 0; t < h; t++) { p.shift(x, y + t, 1); p.shift(x + w - 1, y + t, -1); }
  };
  batten(0, 0, S, F, false);
  batten(0, S - F, S, F, false);
  batten(0, F, F, S - 2 * F, true);
  batten(S - F, F, F, S - 2 * F, true);
  for (let t = F; t < S - F; t++) { p.shift(t, F, -2); p.shift(t, F + 1, -1); p.shift(F, t, -1); }
  for (const [x, y] of [[4, 4], [S - 7, 4], [4, S - 7], [S - 7, S - 7], [4, 60], [S - 7, 60], [60, 4], [60, S - 7]]) p.nail(x, y, 1);
  // somebody counted these in red chalk
  for (let k = 0; k < 3; k++) p.line(92 + k * 3, 97, 91 + k * 3, 105, (x, y) => p.set(x, y, p.c('chalk', (x + y) & 1)));
  p.line(89, 104, 101, 98, (x, y) => p.set(x, y, p.c('chalk', 1)));
  return p;
}

function paintBoxLid() {
  const S = 128, p = new Page(S), R = mulberry32(14114);
  const rows = [0, 26, 52, 77, 103, 128];
  for (let b = 0; b < 5; b++) {
    const y0 = rows[b], h = rows[b + 1] - y0;
    p.fill(0, y0, S, h, p.c('wood', 2 + (b & 1)));
    for (let g = 0; g < 8; g++) {
      const gy = y0 + 2 + Math.floor(R() * (h - 4)), gx = R() * S, len = 10 + R() * 50;
      for (let t = 0; t < len; t++) p.shift(gx + t, gy, g < 6 ? -1 : 1);
    }
    for (let x = 0; x < S; x++) { p.shift(x, y0 + 1, 1); p.set(x, y0 + h - 1, p.c('wood', 0)); }
  }
  // the question mark, painted in pale glowing teal with a halo on the wood
  const m = textMask(S, S, [{ text: '?', x: 64, y: 68, size: 92 }]);
  const small = textMask(S, S, [{ text: '?', x: 27, y: 30, size: 24, rot: -0.3 }, { text: '?', x: 101, y: 98, size: 24, rot: 0.25 }]);
  const M = (x, y) => m[p.i(x, y)] === 1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (M(x, y)) p.set(x, y, p.c('teal', !M(x, y - 1) || !M(x - 1, y) ? 2 : !M(x, y + 2) || !M(x + 2, y) ? 0 : 1));
      else if (small[p.i(x, y)]) p.set(x, y, p.c('teal', 0));
      else {
        let near = 9;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (M(x + dx, y + dy)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
        if (near <= 1) p.set(x, y, p.c('tealDim', 1));
        else if (near <= 3) p.set(x, y, p.c('tealDim', 0));
      }
    }
  }
  // iron corner brackets with rivets
  const B = 20, T = 5;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const X = (v) => (sx > 0 ? v : S - 1 - v), Y = (v) => (sy > 0 ? v : S - 1 - v);
    for (let a = 0; a < B; a++) {
      for (let b = 0; b < T; b++) {
        p.set(X(a), Y(b), p.c('iron', b === 0 || a === 0 ? 3 : 2));
        p.set(X(b), Y(a), p.c('iron', b === 0 || a === 0 ? 3 : 2));
      }
      p.set(X(a), Y(T), p.c('iron', 0));
      p.set(X(T), Y(a), p.c('iron', 0));
    }
    for (const [a, b] of [[2, 2], [B - 3, 2], [2, B - 3]]) { p.set(X(a), Y(b), p.c('iron', 4)); p.set(X(a), Y(b + 1), p.c('iron', 0)); }
  }
  return p;
}

function paintMetal() {
  const S = 128, p = new Page(S), R = mulberry32(9109);
  p.clusters('olive', 3, 9110, { cells: 3 });
  // panel seams with rivet rows
  for (let y = 0; y < S; y++) { p.shift(0, y, -3); p.shift(1, y, 2); p.shift(64, y, -3); p.shift(65, y, 2); }
  for (let x = 0; x < S; x++) { p.shift(x, 44, -3); p.shift(x, 45, 2); }
  const rivets = [];
  for (let y = 4; y < S; y += 8) rivets.push([4, y], [68, y]);
  for (let x = 8; x < S; x += 8) if (x % 64 > 6) rivets.push([x, 48]);
  for (const [x, y] of rivets) { p.shift(x, y, 3); p.shift(x, y + 1, -3); }
  // rust weeps under a few rivets
  for (let s = 0; s < 6; s++) {
    const [x, y] = rivets[Math.floor(R() * rivets.length)], len = 6 + R() * 16;
    for (let t = 2; t < len; t++) p.set(x + (t > len * 0.5 && s & 1 ? 1 : 0), y + t, p.c('rust', t < len * 0.4 ? 3 : 2));
  }
  // paint chips in clusters: bare steel, shadowed under the paint's edge
  const chip = new Uint8Array(S * S);
  for (let cl = 0; cl < 11; cl++) {
    const cx = R() * S, cy = R() * S, n = 2 + Math.floor(R() * 4);
    const kind = R() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) p.blob(cx + (R() - 0.5) * 18, cy + (R() - 0.5) * 14, 1 + R() * 2.5, 1 + R() * 2, R, (x, y) => { chip[p.i(x, y)] = kind; }, 0.5);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!chip[p.i(x, y)]) continue;
      p.set(x, y, p.c(chip[p.i(x, y)] === 2 ? 'rust' : 'steel', !chip[p.i(x, y - 1)] || !chip[p.i(x - 1, y)] ? 1 : 3));
      if (!chip[p.i(x, y + 1)]) p.shift(x, y + 1, 2);
    }
  }
  for (let s = 0; s < 9; s++) {
    const x = R() * S, y = R() * S, a = (R() - 0.5) * 1.4;
    p.line(x, y, x + Math.cos(a) * (3 + R() * 6), y + Math.sin(a) * (3 + R() * 6), (a2, b2) => p.set(a2, b2, p.c('steel', 3)));
  }
  return p;
}

function paintRust() {
  const S = 128, p = new Page(S), R = mulberry32(10110);
  const A = fbm(S, S, 10111, { cells: 3, octaves: 2 }), B = fbm(S, S, 10112, { cells: 9, octaves: 2 });
  for (let i = 0; i < S * S; i++) p.px[i] = p.c('rust', 1 + Math.min(4, Math.floor(A[i] * 5)) + (B[i] > 0.74 ? 1 : B[i] < 0.26 ? -1 : 0));
  // remnant paint islands
  for (let s = 0; s < 5; s++) {
    const cx = R() * S, cy = R() * S;
    p.blob(cx, cy, 4 + R() * 7, 3 + R() * 5, R, (x, y) => p.set(x, y, p.c('olive', 2)), 0.5);
  }
  // lifted scale: lit on top, a shadow under
  for (let s = 0; s < 16; s++) {
    const set = new Set();
    p.blob(R() * S, R() * S, 2 + R() * 4, 1.5 + R() * 2.5, R, (x, y) => set.add(p.i(x, y)), 0.45);
    for (const i of set) {
      const x = i % S, y = (i / S) | 0;
      p.px[i] = p.c('rust', set.has(p.i(x, y - 1)) ? 4 : 6);
      if (!set.has(p.i(x, y + 1))) p.set(x, y + 1, p.c('rust', 0));
    }
  }
  for (let cl = 0; cl < 10; cl++) {
    const cx = R() * S, cy = R() * S;
    for (let k = 0; k < 4; k++) p.set(cx + (R() - 0.5) * 8, cy + (R() - 0.5) * 6, p.c('rust', 0));
  }
  for (let s = 0; s < 5; s++) {
    const x = R() * S, y = R() * S, len = 10 + R() * 24;
    for (let t = 0; t < len; t++) p.shift(x, y + t, -1);
  }
  return p;
}

function paintSandbag() {
  const S = 64, p = new Page(S), R = mulberry32(11111);
  p.clusters('burlap', 3, 11112, { cells: 2, fine: 5 });
  // threads: short broken strokes, the weave's direction
  for (let s = 0; s < 34; s++) {
    const x = R() * S, y = R() * S, len = 3 + R() * 6, horiz = R() < 0.6;
    for (let t = 0; t < len; t++) p.shift(horiz ? x + t : x, horiz ? y : y + t, -1);
  }
  // creases: a dark fold with a lit ridge above
  for (let s = 0; s < 3; s++) {
    const x = 6 + R() * 44, y = 10 + R() * 34, a = (R() - 0.5) * 1.2, len = 10 + R() * 16;
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    p.line(x, y, x1, y1, (a2, b2) => { p.shift(a2, b2, -3); p.shift(a2, b2 - 1, 2); });
  }
  // stitched seam at one end, tied end at the other
  for (let y = 0; y < S; y++) { p.set(57, y, p.c('burlap', 1)); p.shift(58, y, 2); if (y % 4 < 2) p.set(56, y, p.c('burlap', 5)); }
  for (let y = 0; y < S; y++) p.shift(2, y, -2);
  // mud caked on the lower third
  for (let x = 0; x < S; x++) {
    const top = 49 + Math.round(2 * Math.sin((x / S) * TAU * 2) + 1.2 * Math.sin((x / S) * TAU * 5 + 1));
    for (let y = top; y < S; y++) p.set(x, y, p.c('dirt', y === top ? 4 : y > 58 ? 2 : 3));
  }
  for (let s = 0; s < 2; s++) p.blob(R() * S, 10 + R() * 30, 4 + R() * 5, 3 + R() * 3, R, (x, y) => p.shift(x, y, -2), 0.4);
  return p;
}

function paintDirt() {
  const S = 128, p = new Page(S), R = mulberry32(6106);
  p.clusters('dirt', 3, 6107, { cells: 3, fine: 7 });
  for (let s = 0; s < 6; s++) p.blob(R() * S, R() * S, 6 + R() * 10, 4 + R() * 8, R, (x, y) => p.shift(x, y, -2), 0.45);
  // pebbles: lit on top, a shadow pixel underneath
  for (let s = 0; s < 46; s++) {
    const x = Math.round(R() * S), y = Math.round(R() * S), big = R() < 0.3;
    const k = 3 + Math.floor(R() * 2);
    p.set(x, y, p.c('concrete', k + 1));
    if (big) { p.set(x + 1, y, p.c('concrete', k)); p.set(x, y + 1, p.c('concrete', k - 1)); p.set(x + 1, y + 1, p.c('concrete', k - 1)); }
    p.set(x + (big ? 1 : 0), y + (big ? 2 : 1), p.c('dirt', 0));
  }
  // tufts of dead grass
  for (let s = 0; s < 14; s++) {
    const x = R() * S, y = R() * S;
    for (let b = 0; b < 4; b++) {
      const a = -Math.PI / 2 + (b - 1.5) * 0.45 + (R() - 0.5) * 0.3, len = 2 + R() * 4;
      p.line(x + b - 1.5, y, x + b - 1.5 + Math.cos(a) * len, y + Math.sin(a) * len, (a2, b2) => p.set(a2, b2, p.c('grassDead', b & 1 ? 1 : 2)));
    }
  }
  return p;
}

function paintTarmac() {
  const S = 128, p = new Page(S), R = mulberry32(8108);
  p.clusters('concrete', 2, 8109, { cells: 3 });
  // tar-sealed repair patches with a lit edge
  for (let s = 0; s < 3; s++) {
    const x0 = Math.round(R() * S), y0 = Math.round(R() * S), w = 16 + Math.round(R() * 26), h = 12 + Math.round(R() * 20);
    p.fill(x0, y0, w, h, p.c('concrete', 1));
    for (let x = 0; x < w; x++) { p.shift(x0 + x, y0, 2); p.set(x0 + x, y0 + h, p.c('concrete', 3)); }
    for (let y = 0; y < h; y++) p.set(x0 + w, y0 + y, p.c('concrete', 3));
  }
  for (let k = 0; k < 5; k++) {
    p.walk(R() * S, R() * S, R() * TAU, 20 + R() * 40, R, (x, y) => { p.set(x, y, p.c('concrete', 0.5)); p.shift(x + 1, y + 1, 2); }, 1.0);
  }
  for (let s = 0; s < 30; s++) p.set(R() * S, R() * S, p.c('concrete', 4));
  return p;
}

function paintBark() {
  const S = 64, p = new Page(S), R = mulberry32(20120);
  p.fill(0, 0, S, S, p.c('woodGrey', 1));
  // raised plates between dark fissures, lit on the left
  let x = 0;
  while (x < S) {
    const w = 5 + Math.floor(R() * 4);
    let y = 0;
    while (y < S) {
      const h = 8 + Math.floor(R() * 14), dx = Math.floor(R() * 2);
      for (let yy = 0; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx++) p.set(x + xx + dx, y + yy, p.c('woodGrey', xx === 1 ? 4 : xx === w - 2 ? 2 : 3));
      }
      y += h;
    }
    x += w;
  }
  for (let s = 0; s < 4; s++) p.blob(R() * S, R() * S, 2 + R() * 3, 3 + R() * 4, R, (a, b) => { if (p.get(a, b) !== p.c('woodGrey', 1)) p.set(a, b, p.c('grassDead', 1)); }, 0.4);
  return p;
}

function meanLumaCanvas(src) {
  const c = mkCanvas(32);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / 1024;
}

const PAINTERS = {
  plaster: paintPlaster, brick: paintBrick, concrete: paintConcrete, floorBoards: paintFloorBoards,
  woodWall: paintWoodWall, ceiling: paintCeiling, plank: paintPlank, crate: paintCrate, boxLid: paintBoxLid,
  metal: paintMetal, rust: paintRust, sandbag: paintSandbag, dirt: paintDirt, tarmac: paintTarmac, bark: paintBark,
};

/**
 * Painted low-res pages keyed like the hi-res canvases. Each palette is scaled
 * so the page's mean brightness sits near its hi-res original, which keeps the
 * lighting tuned for either setting.
 */
// The plaster reads cleaner than its soot-washed original at the same mean, so
// it sits a little lower to keep the walls murky behind the characters.
const EXPOSURE = { plaster: 0.88 };

function paintPages(hiCanvases) {
  const out = {};
  for (const [name, paint] of Object.entries(PAINTERS)) {
    const page = paint();
    const hi = hiCanvases[name];
    const gain = (EXPOSURE[name] ?? 1) * (hi ? Math.max(0.75, Math.min(1.4, meanLumaCanvas(hi) / page.meanLuma())) : 1);
    out[name] = page.canvas(gain);
  }
  return out;
}

// ---------------------------------------------------------------------------

const NON_TILING = new Set(['plank', 'crate', 'boxLid', 'bloodDecal', 'scorch', 'paper']);

/**
 * Build every procedural texture. Returns { name: THREE.CanvasTexture }.
 * @param {THREE.WebGLRenderer} renderer used only to query max anisotropy
 */
export function createTextures(renderer) {
  try {
    const m = renderer?.capabilities?.getMaxAnisotropy?.();
    if (m) maxAniso = Math.min(8, m);
  } catch {
    /* keep default */
  }
  const N = makeNoiseSet();
  const canvases = {
    concrete: texConcrete(N),
    brick: texBrick(N),
    plaster: texPlaster(N),
    woodWall: texWoodWall(N),
    floorBoards: texFloorBoards(N),
    dirt: texDirt(N),
    grass: texGrass(N),
    tarmac: texTarmac(N),
    metal: texMetal(N),
    rust: texRust(N),
    sandbag: texSandbag(N),
    plank: texPlank(N),
    crate: texCrate(N),
    boxLid: texBoxLid(N),
    uniform: texCloth(N, 22022, [92, 97, 80]),
    uniformDark: texCloth(N, 23023, [52, 55, 46]),
    skin: texSkin(N),
    playerSkin: texPlayerSkin(N),
    bloodDecal: texBlood(N),
    scorch: texScorch(N),
    paper: texPaper(N),
    bark: texBark(N),
    ceiling: texCeiling(N),
  };
  const painted = paintPages(canvases);
  const out = {};
  for (const [name, canvas] of Object.entries(canvases)) {
    const t = makeCanvasTexture(canvas, { repeat: !NON_TILING.has(name) });
    t.name = name;
    // The hand-painted page the "1997 look" swaps in (retro.js).
    if (painted[name]) t.userData.painted = painted[name];
    out[name] = t;
  }
  return out;
}
