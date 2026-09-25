// Hand-drawn chalk / blood art rendered to 2D canvases: wall-buy weapon
// outlines, the round tally, chalk labels and dripping wall scrawls.
// Weapon outlines are traced from the actual 3D models (side view from +X,
// muzzle to the right), so they always match the in-game silhouettes.

import { buildWeaponModel } from './weapons3d.js';

const TAU = Math.PI * 2;

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

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function parseColor(color) {
  const ctx = mkCanvas(1, 1).getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  const s = ctx.fillStyle;
  if (s[0] === '#') {
    const n = parseInt(s.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = s.match(/[\d.]+/g) || [255, 255, 255, 1];
  return [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1];
}

// ---------------------------------------------------------------------------
// Weapon silhouettes
// ---------------------------------------------------------------------------

const CLASS = { metal: 1, wood: 2, dark: 3, hole: 4, glass: 5, glow: 6, skin: 1, cloth: 1 };

/** Rasterise the model side-on into id/depth/class buffers (software z-buffer). */
function rasterize(id, W, H, margin) {
  const group = buildWeaponModel(id);
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  // world-space positions per mesh
  const polys = [];
  let zmin = Infinity;
  let zmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const e = mesh.matrixWorld.elements;
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      out[i * 3] = wx;
      out[i * 3 + 1] = wy;
      out[i * 3 + 2] = wz;
      if (wz < zmin) zmin = wz;
      if (wz > zmax) zmax = wz;
      if (wy < ymin) ymin = wy;
      if (wy > ymax) ymax = wy;
    }
    const cls = CLASS[mesh.material.userData?.chalk] ?? 1;
    polys.push({ out, cls, glass: cls === CLASS.glass });
  }
  const s = Math.min((W - 2 * margin) / (zmax - zmin), (H - 2 * margin) / (ymax - ymin));
  const ox = (W - (zmax - zmin) * s) / 2;
  const oy = (H - (ymax - ymin) * s) / 2;
  const depth = new Float32Array(W * H).fill(-1e9);
  const ids = new Uint16Array(W * H);
  const cls = new Uint8Array(W * H);

  const drawTri = (ax, ay, ad, bx, by, bd, cx, cy, cd, idv, c, onlyEmpty) => {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-6) return;
    const inv = 1 / area;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        if (w0 < -1e-4) continue;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        if (w1 < -1e-4) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -1e-4) continue;
        const d = w0 * ad + w1 * bd + w2 * cd;
        const i = y * W + x;
        if (onlyEmpty ? ids[i] === 0 : d > depth[i]) {
          if (!onlyEmpty) depth[i] = d;
          ids[i] = idv;
          cls[i] = c;
        }
      }
    }
  };
  const pass = (glassPass) => {
    polys.forEach((p, k) => {
      if (p.glass !== glassPass) return;
      const o = p.out;
      for (let i = 0; i < o.length; i += 9) {
        drawTri(
          ox + (zmax - o[i + 2]) * s, oy + (ymax - o[i + 1]) * s, o[i],
          ox + (zmax - o[i + 5]) * s, oy + (ymax - o[i + 4]) * s, o[i + 3],
          ox + (zmax - o[i + 8]) * s, oy + (ymax - o[i + 7]) * s, o[i + 6],
          k + 1, p.cls, glassPass,
        );
      }
    });
  };
  pass(false);
  pass(true);
  return { depth, ids, cls, scale: s };
}

/**
 * Chalk outline of a weapon, side view, muzzle to the right.
 * @returns {HTMLCanvasElement} 512x256, transparent background
 */
export function drawChalkWeapon(id) {
  const W = 512;
  const H = 256;
  const { depth, ids, cls, scale } = rasterize(id, W, H, 26);
  const r = mulberry32(hashStr(`chalk:${id}`));
  const A = new Float32Array(W * H);
  const depthThr = Math.max(0.006, 2.2 / scale);

  const dab = (x, y, a, size) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    for (let dy = 0; dy < size; dy++) {
      const yy = yi + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = 0; dx < size; dx++) {
        const xx = xi + dx;
        if (xx < 0 || xx >= W) continue;
        const i = yy * W + xx;
        A[i] = 1 - (1 - A[i]) * (1 - a);
      }
    }
  };

  const outline = [];
  const inner = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!ids[i]) continue;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      let edge = false;
      let seam = false;
      for (const j of nb) {
        if (j < 0 || !ids[j]) {
          edge = true;
          break;
        }
        if (ids[j] !== ids[i] && (cls[j] !== cls[i] || Math.abs(depth[j] - depth[i]) > depthThr * 0.5)) seam = true;
        else if (Math.abs(depth[j] - depth[i]) > depthThr) seam = true;
      }
      if (edge) outline.push(x, y);
      else if (seam) inner.push(x, y);
    }
  }

  // outline: three wobbly, slightly offset passes
  for (let pass = 0; pass < 3; pass++) {
    const ph = r() * TAU;
    const amp = pass === 0 ? 0.5 : 1.3;
    const size = pass === 0 ? 2 : 1;
    for (let k = 0; k < outline.length; k += 2) {
      if (r() < 0.1) continue;
      const x = outline[k];
      const y = outline[k + 1];
      const wx = Math.sin(y * 0.09 + x * 0.013 + ph) * amp + (r() - 0.5) * 0.9;
      const wy = Math.sin(x * 0.07 + ph * 1.3) * amp + (r() - 0.5) * 0.9;
      dab(x + wx - (size > 1 ? 0.5 : 0), y + wy - (size > 1 ? 0.5 : 0), 0.35 + r() * 0.45, size);
    }
  }
  // inner detail lines
  for (let pass = 0; pass < 2; pass++) {
    const ph = r() * TAU;
    for (let k = 0; k < inner.length; k += 2) {
      if (r() < 0.2) continue;
      const x = inner[k];
      const y = inner[k + 1];
      dab(x + Math.sin(y * 0.1 + ph) * 0.7 + (r() - 0.5) * 0.8, y + (r() - 0.5) * 0.8, 0.22 + r() * 0.3, 1);
    }
  }
  // shading inside: wood hatching, metal stipple, glow fill
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = cls[i];
      if (!c) continue;
      const wob = Math.sin(x * 0.05 + y * 0.03) * 1.5;
      if (c === CLASS.wood) {
        if ((x + y + wob + 100) % 7 < 1.1 && r() < 0.8) dab(x, y, 0.2 + r() * 0.25, 1);
      } else if (c === CLASS.dark) {
        if ((x - y + wob + 1000) % 6 < 1.0 && r() < 0.6) dab(x, y, 0.12 + r() * 0.15, 1);
      } else if (c === CLASS.glow || c === CLASS.glass) {
        if (r() < 0.45) dab(x, y, 0.18 + r() * 0.25, 1);
      } else if (c === CLASS.metal) {
        if (r() < 0.04) dab(x, y, 0.2 + r() * 0.25, 1);
        A[i] = 1 - (1 - A[i]) * 0.95;
      }
    }
  }

  // chalk grain
  const c = mkCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0, p = 0; i < A.length; i++, p += 4) {
    let a = A[i];
    if (a <= 0) continue;
    const g = r();
    a *= g < 0.1 ? 0.15 : 0.6 + 0.5 * g;
    d[p] = 242;
    d[p + 1] = 241;
    d[p + 2] = 232;
    d[p + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);

  // smudges: faint smeared copy and dusty clouds
  const copy = mkCanvas(W, H);
  copy.getContext('2d').drawImage(c, 0, 0);
  ctx.globalAlpha = 0.06;
  for (let k = 1; k <= 4; k++) ctx.drawImage(copy, k * 1.6, k * 0.8);
  ctx.globalAlpha = 1;
  for (let k = 0; k < 4; k++) {
    const x = 60 + r() * (W - 120);
    const y = 50 + r() * (H - 100);
    const rad = 25 + r() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(235,235,225,0.07)');
    g.addColorStop(1, 'rgba(235,235,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Stroke primitives
// ---------------------------------------------------------------------------

/** Chalky stroke along a polyline: faint core line + many jittered dabs. */
function chalkStroke(ctx, pts, lw, rgb, r) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgb(${rgb})`;
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = lw * (pass ? 0.45 : 0.75);
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * lw * 0.3;
      const jy = y + (r() - 0.5) * lw * 0.3;
      i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy);
    });
    ctx.stroke();
  }
  ctx.fillStyle = `rgb(${rgb})`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.ceil(len / Math.max(0.6, lw * 0.18));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (let k = 0; k < 2; k++) {
        const off = (r() - 0.5) * lw;
        const sz = lw * (0.18 + r() * 0.3);
        ctx.globalAlpha = 0.2 + r() * 0.6;
        ctx.fillRect(x0 + dx * t + nx * off - sz / 2, y0 + dy * t + ny * off - sz / 2, sz, sz);
      }
    }
  }
  ctx.restore();
}

/** A blood drip running down from (x, y). */
function drip(ctx, x, y, len, w, r, dark = '#5c0605', light = '#8e0e0a') {
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.9;
  const wob = (r() - 0.5) * w * 0.8;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.bezierCurveTo(x - w * 0.3, y + len * 0.4, x - w * 0.25 + wob, y + len * 0.75, x - w * 0.28 + wob, y + len);
  ctx.lineTo(x + w * 0.28 + wob, y + len);
  ctx.bezierCurveTo(x + w * 0.25 + wob, y + len * 0.75, x + w * 0.3, y + len * 0.4, x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x + wob, y + len, w * 0.5, w * 0.62, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Rough hand-drawn numerals in a unit box (x 0..1, y 0..1 top-down).
const DIGITS = {
  0: [[[0.5, 0], [0.16, 0.1], [0.02, 0.48], [0.14, 0.88], [0.5, 1], [0.86, 0.86], [0.98, 0.46], [0.84, 0.1], [0.5, 0], [0.42, 0.05]]],
  1: [[[0.18, 0.24], [0.56, 0], [0.56, 1]], [[0.2, 1], [0.9, 0.99]]],
  2: [[[0.04, 0.26], [0.24, 0.04], [0.6, 0], [0.9, 0.18], [0.9, 0.4], [0.05, 1], [0.98, 0.98]]],
  3: [[[0.05, 0.1], [0.45, 0], [0.88, 0.12], [0.9, 0.32], [0.42, 0.48]], [[0.42, 0.48], [0.92, 0.62], [0.95, 0.86], [0.55, 1], [0.04, 0.9]]],
  4: [[[0.72, 1], [0.72, 0], [0.02, 0.68], [1, 0.68]]],
  5: [[[0.92, 0], [0.14, 0.01], [0.07, 0.46], [0.5, 0.38], [0.92, 0.56], [0.94, 0.83], [0.55, 1], [0.04, 0.92]]],
  6: [[[0.86, 0.04], [0.45, 0.04], [0.12, 0.35], [0.05, 0.72], [0.25, 0.98], [0.65, 0.98], [0.92, 0.76], [0.8, 0.52], [0.42, 0.48], [0.08, 0.66]]],
  7: [[[0.02, 0.02], [0.98, 0], [0.34, 1]], [[0.32, 0.5], [0.8, 0.5]]],
  8: [[[0.5, 0.47], [0.15, 0.35], [0.14, 0.1], [0.5, 0], [0.86, 0.1], [0.84, 0.34], [0.5, 0.47], [0.1, 0.62], [0.08, 0.88], [0.5, 1], [0.92, 0.88], [0.9, 0.62], [0.5, 0.47]]],
  9: [[[0.9, 0.36], [0.55, 0.5], [0.15, 0.44], [0.06, 0.2], [0.3, 0], [0.7, 0.02], [0.92, 0.25], [0.88, 0.62], [0.5, 1]]],
};

/**
 * Draw the round counter in dripping blood-red chalk.
 * (x, y) is the top-left corner, hTotal the total height (strokes + drips).
 * Deterministic per round.
 * Rounds 1-10 are tally marks (groups of five), above 10 rough numerals.
 * @returns {number} drawn width in px
 */
export function drawTally(ctx, round, x, y, hTotal) {
  const n = Math.max(0, Math.floor(round));
  // strokes use the top ~78% of the box, drips stay inside the remainder
  const h = hTotal * 0.78;
  const dripMax = hTotal - h;
  const r = mulberry32((0x9e3779b9 ^ Math.imul(n + 1, 2654435761)) >>> 0);
  const rgb = '150,14,10';
  const lw = Math.max(2, h * 0.08);
  const strokes = [];
  let width = 0;
  if (n <= 10) {
    const gap = h * 0.2;
    let cx = x + lw + gap * 0.6;
    let left = n;
    while (left > 0) {
      const g = Math.min(5, left);
      const verts = Math.min(4, g);
      const gx0 = cx;
      for (let i = 0; i < verts; i++) {
        const tx = cx + (r() - 0.5) * h * 0.04;
        const tilt = (r() - 0.5) * h * 0.07;
        strokes.push({ pts: [[tx + tilt, y + r() * h * 0.05], [tx + (r() - 0.5) * lw * 0.4, y + h * 0.5], [tx - tilt, y + h - r() * h * 0.05]], drip: true });
        cx += gap;
      }
      if (g === 5) {
        strokes.push({ pts: [[gx0 - gap * 0.55, y + h * 0.82], [cx - gap * 0.3, y + h * 0.18 + (r() - 0.5) * h * 0.08]], drip: r() < 0.5 });
      }
      left -= g;
      cx += left > 0 ? h * 0.3 : 0;
    }
    width = cx - x;
  } else {
    const digits = String(n).split('');
    const dw = h * 0.6;
    const spacing = h * 0.16;
    let cx = x + lw;
    for (const ch of digits) {
      const polys = DIGITS[ch];
      const jit = () => (r() - 0.5) * h * 0.05;
      const slant = (r() - 0.5) * 0.08;
      for (const poly of polys) {
        const pts = poly.map(([u, v]) => [cx + u * dw + (1 - v) * h * slant + jit(), y + v * h + jit()]);
        strokes.push({ pts, drip: true, digit: true });
      }
      cx += dw + spacing;
    }
    width = cx - x;
  }
  ctx.save();
  for (const s of strokes) {
    chalkStroke(ctx, s.pts, lw, rgb, r);
    chalkStroke(ctx, s.pts, lw * 0.6, '105,6,4', r);
  }
  for (const s of strokes) {
    if (!s.drip) continue;
    // drip from the lowest point(s) of the stroke
    let low = s.pts[0];
    for (const p of s.pts) if (p[1] > low[1]) low = p;
    const room = y + hTotal - low[1] - lw * 0.5;
    if (r() < (s.digit ? 0.6 : 0.75)) {
      const w = lw * (0.35 + r() * 0.3);
      drip(ctx, low[0], low[1] - lw * 0.2, Math.max(2, Math.min(room - w * 0.6, dripMax * (0.35 + r() * 0.65) + lw)), w, r);
    }
    if (s.digit && r() < 0.35) {
      const p = s.pts[(r() * s.pts.length) | 0];
      const w = lw * 0.35;
      drip(ctx, p[0], p[1], Math.max(2, Math.min(y + hTotal - p[1] - w, h * (0.08 + r() * 0.25))), w, r);
    }
  }
  ctx.restore();
  return width;
}

// ---------------------------------------------------------------------------
// Labels and wall scrawls
// ---------------------------------------------------------------------------

const HAND_FONT = '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive';

/** Chalk text on a transparent canvas (e.g. a door price). */
export function drawChalkLabel(text, opts = {}) {
  const { width = 256, height = 128, color = 'rgba(240,240,230,0.9)' } = opts;
  const str = String(text);
  const c = mkCanvas(width, height);
  const ctx = c.getContext('2d');
  const r = mulberry32(hashStr(`label:${str}`));
  const [cr, cg, cb, ca] = parseColor(color);

  const m = mkCanvas(width, height);
  const mc = m.getContext('2d', { willReadFrequently: true });
  let size = height * 0.62;
  mc.font = `700 ${size}px ${HAND_FONT}`;
  const tw = mc.measureText(str).width;
  if (tw > width * 0.9) size *= (width * 0.9) / tw;
  mc.font = `700 ${size}px ${HAND_FONT}`;
  mc.textAlign = 'center';
  mc.textBaseline = 'middle';
  mc.fillStyle = '#fff';
  mc.strokeStyle = '#fff';
  for (let k = 0; k < 3; k++) {
    mc.globalAlpha = 0.5;
    mc.fillText(str, width / 2 + (r() - 0.5) * 2.5, height / 2 + (r() - 0.5) * 2.5);
  }
  mc.globalAlpha = 0.5;
  mc.lineWidth = Math.max(1, size * 0.03);
  mc.strokeText(str, width / 2 + (r() - 0.5) * 1.5, height / 2 + (r() - 0.5) * 1.5);

  const src = mc.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const s = src.data;
  const d = out.data;
  const ph = r() * TAU;
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p += 4) {
      let a = s[p + 3] / 255;
      if (a <= 0) continue;
      const g = r();
      const drag = 0.72 + 0.28 * Math.sin(x * 0.9 + y * 0.4 + Math.sin(y * 0.2 + ph) * 3);
      a *= (g < 0.13 ? 0.15 : 0.5 + 0.6 * g) * drag;
      d[p] = cr;
      d[p + 1] = cg;
      d[p + 2] = cb;
      d[p + 3] = Math.min(255, a * 255 * ca);
    }
  }
  ctx.putImageData(out, 0, 0);
  // smudge halo
  const copy = mkCanvas(width, height);
  copy.getContext('2d').drawImage(c, 0, 0);
  ctx.globalAlpha = 0.07;
  for (const [dx, dy] of [[2, 1], [-2, 1], [3, 2], [1, -2]]) ctx.drawImage(copy, dx, dy);
  ctx.globalAlpha = 1;
  return c;
}

/** Dripping blood-red painted text for horror wall messages. */
export function drawWallScrawl(text, opts = {}) {
  const { width = 1024, height = 256 } = opts;
  const str = String(text);
  const c = mkCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = mulberry32(hashStr(`scrawl:${str}`));
  const font = (sz) => `900 ${sz}px Impact, "Haettenschweiler", "Arial Black", "Helvetica Neue", sans-serif`;
  let size = height * 0.5;
  ctx.font = font(size);
  const spacing = size * 0.04;
  const measure = () => [...str].reduce((a, ch) => a + ctx.measureText(ch).width + spacing, -spacing);
  let total = measure();
  if (total > width * 0.92) {
    size *= (width * 0.92) / total;
    ctx.font = font(size);
    total = measure();
  }
  const base = height * 0.42;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  let x = (width - total) / 2;
  for (const ch of str) {
    const w = ctx.measureText(ch).width;
    const cx = x + w / 2;
    const cy = base + (r() - 0.5) * size * 0.1;
    const rot = (r() - 0.5) * 0.14;
    const sx = 1 + (r() - 0.5) * 0.14;
    const sy = 1 + (r() - 0.5) * 0.18;
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.translate(cx + (r() - 0.5) * size * 0.03, cy + (r() - 0.5) * size * 0.03);
      ctx.rotate(rot + (r() - 0.5) * 0.03);
      ctx.scale(sx, sy);
      ctx.fillStyle = k === 2 ? '#7e0a07' : '#620604';
      ctx.globalAlpha = k === 2 ? 0.85 : 0.6;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
    x += w + spacing;
  }
  // dry-brush streaks
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    ctx.globalAlpha = 0.15 + r() * 0.35;
    ctx.fillRect(r() * width, r() * height, 12 + r() * 90, 0.8 + r() * 1.5);
  }
  ctx.restore();

  // drips from the bottom edges of the letters
  const img = ctx.getImageData(0, 0, width, height).data;
  const alphaAt = (xx, yy) => (yy >= height ? 0 : img[(yy * width + xx) * 4 + 3]);
  const drips = [];
  for (let xx = 2; xx < width - 2; xx += 2) {
    for (let yy = 4; yy < height - 6; yy++) {
      if (alphaAt(xx, yy) > 150 && alphaAt(xx, yy + 3) < 20 && r() < 0.045) {
        drips.push([xx, yy]);
        yy += 6;
      }
    }
  }
  for (const [dx, dy] of drips) {
    const maxLen = height - dy - 8;
    const len = Math.min(maxLen, 6 + r() * r() * height * 0.55);
    if (len > 4) drip(ctx, dx, dy - 1, len, 2 + r() * 4, r, '#4a0403', '#700806');
  }
  // splatter
  for (let i = 0; i < 70; i++) {
    const px = r() * width;
    const py = base + (r() - 0.5) * size * 1.6;
    ctx.fillStyle = r() < 0.5 ? '#6a0605' : '#4c0403';
    ctx.globalAlpha = 0.5 + r() * 0.4;
    ctx.beginPath();
    ctx.arc(px, py, 0.8 + r() * r() * 4, 0, TAU);
    ctx.fill();
  }
  // wet shading: darker toward the bottom, a faint sheen at the top
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, base - size * 0.5, 0, height);
  g.addColorStop(0, 'rgba(160,30,20,0.25)');
  g.addColorStop(0.45, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}
