// Procedural canvas textures for the bunker / airfield setting.
// Everything is generated at runtime from a seeded PRNG so the world looks
// identical on every load. Tiling textures wrap seamlessly: noise lattices
// are periodic and every drawn feature near an edge is repeated on the
// opposite side (see wrap9).

import * as THREE from 'three';

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const out = {};
  for (const [name, canvas] of Object.entries(canvases)) {
    const t = makeCanvasTexture(canvas, { repeat: !NON_TILING.has(name) });
    t.name = name;
    out[name] = t;
  }
  return out;
}
