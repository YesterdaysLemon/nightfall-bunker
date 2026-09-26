// Kintsugi: the secret porcelain boss. A 1940s lady as a glazed figurine,
// broken and mended with glowing gold. Built from ~25 pre-fractured chunks
// (plain Meshes, one shared glaze material) posed by a small joint rig, so she
// can walk like a doll, jitter in stop-motion, swipe, burst apart, reform and
// finally shatter across the floor. Also: her tiny figurine and the cracked
// teacup props for the easter egg. Everything is procedural (canvas textures).

import * as THREE from 'three';
import { ZS as ZSP } from '../../shared/protocol.js';

const ZS = { CHASE: ZSP.CHASE ?? 4, ATTACK: ZSP.ATTACK ?? 5, SHATTER: ZSP.SHATTER ?? 7, REFORM: ZSP.REFORM ?? 8 };
const TAU = Math.PI * 2;
const DENS = 1.5;          // print tiles per metre on the boss
// Plain texel patches (uv) for unprinted parts: glossy glaze / matte hollow.
const FLAT = { gloss: [0.031, 0.969], matte: [0.094, 0.969] };
const ATTACK_T = 0.45, REFORM_T = 0.6, BURST_FADE = 0.52;
const STOP_FPS = 7;

const PC = {
  glaze: [0.9, 0.92, 0.95], socket: [0.03, 0.028, 0.034], tooth: [0.93, 0.9, 0.8], cobalt: [0.34, 0.45, 0.95],
  shoe: [0.36, 0.46, 0.95], gold: [1, 0.8, 0.42], cuff: [0.72, 0.8, 1], lip: [0.85, 0.42, 0.5],
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function hash1(n) { const h = Math.sin(n * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); }
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Shared kit: glaze textures, environment, materials --------------------------------
let KIT = null;

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Crack network (tileable): branching random walks in texture space.
function makeSeams(S, R, count) {
  const out = [];
  const walk = (x, y, a, steps, w) => {
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      a += (R() - 0.5) * 0.9;
      const st = S * (0.012 + R() * 0.02);
      x += Math.cos(a) * st; y += Math.sin(a) * st;
      pts.push([x, y]);
      if (R() < 0.09 && w > 1.5) walk(x, y, a + (R() < 0.5 ? 1 : -1) * (0.8 + R() * 0.7), 4 + Math.floor(R() * steps * 0.5), w * 0.65);
    }
    out.push({ pts, w });
  };
  for (let i = 0; i < count; i++) walk(R() * S, R() * S, R() * TAU, 14 + Math.floor(R() * 22), S * (0.0036 + R() * 0.003));
  return out;
}

function strokeSeams(ctx, S, seams, style, wMul, blur = 0) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = style;
  if (blur) { ctx.shadowColor = style; ctx.shadowBlur = blur; }
  for (const s of seams) {
    ctx.lineWidth = Math.max(1, s.w * wMul);
    for (let ox = -S; ox <= S; ox += S) {
      for (let oy = -S; oy <= S; oy += S) {
        ctx.beginPath();
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// Draw fn at (x, y) and at every wrapped copy that touches the tile.
function wrapAt(S, x, y, r, fn) {
  for (let ox = -S; ox <= S; ox += S) {
    for (let oy = -S; oy <= S; oy += S) {
      const px = x + ox, py = y + oy;
      if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
      fn(px, py);
    }
  }
}

const GLAZE_BG = '#eef1f6';

function rose(ctx, x, y, r, rot) {
  for (let j = 0; j < 7; j++) {
    const a = rot + (j / 7) * TAU;
    ctx.fillStyle = j % 2 ? '#2456cc' : '#1d4bbd';
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56, r * 0.47, r * 0.37, a, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = '#0c2378'; ctx.lineWidth = r * 0.05;
  for (let j = 0; j < 7; j++) {
    const a = rot + (j / 7) * TAU;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56, r * 0.47, r * 0.37, a, -1.25, 1.25);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.64);
  g.addColorStop(0, '#0b2785'); g.addColorStop(1, '#1b48be');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 0.64, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(238,241,246,0.9)'; ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const rr = r * (0.52 - k * 0.14), n = 3 + k;
    ctx.lineWidth = r * (0.05 - k * 0.008);
    for (let j = 0; j < n; j++) {
      const a = rot * 1.7 + (j / n) * TAU + k * 0.9;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rr * 0.28, y + Math.sin(a) * rr * 0.28, rr, a + 0.2, a + 2.1);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#081c66';
  ctx.beginPath(); ctx.arc(x, y, r * 0.09, 0, TAU); ctx.fill();
}

function leaf(ctx, x, y, len, ang) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = '#1f4ec2';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -len * 0.34, len, 0);
  ctx.quadraticCurveTo(len * 0.45, len * 0.34, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(238,241,246,0.85)'; ctx.lineWidth = Math.max(1, len * 0.035);
  ctx.beginPath(); ctx.moveTo(len * 0.05, 0); ctx.lineTo(len * 0.88, 0);
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.1), -len * 0.12);
    ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.1), len * 0.12);
  }
  ctx.stroke();
  ctx.restore();
}

function blossom(ctx, x, y, r, rot) {
  ctx.fillStyle = '#2a5bd2';
  for (let j = 0; j < 5; j++) {
    const a = rot + (j / 5) * TAU;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.48, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = GLAZE_BG;
  ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0e2c8c';
  ctx.beginPath(); ctx.arc(x, y, r * 0.1, 0, TAU); ctx.fill();
}

function buildGlaze() {
  const S = 1024;
  const R = rng(19450815);
  const cc = canvas(S), ce = canvas(S), cr = canvas(S);
  const c = cc.getContext('2d'), e = ce.getContext('2d'), m = cr.getContext('2d');
  // Glaze body with a soft pooled tone.
  c.fillStyle = GLAZE_BG; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const x = R() * S, y = R() * S, r = 60 + R() * 160;
    wrapAt(S, x, y, r, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, R() < 0.5 ? 'rgba(214,224,240,0.18)' : 'rgba(255,250,236,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  // Cobalt print: vines first, then leaves, roses, blossoms and dots.
  const roses = [];
  for (let i = 0; i < 9; i++) {
    let x, y, ok = false, tries = 0;
    while (!ok && tries++ < 40) {
      x = R() * S; y = R() * S;
      ok = roses.every((q) => {
        const dx = Math.min(Math.abs(q.x - x), S - Math.abs(q.x - x)), dy = Math.min(Math.abs(q.y - y), S - Math.abs(q.y - y));
        return Math.hypot(dx, dy) > 230;
      });
    }
    roses.push({ x, y, r: 62 + R() * 38, rot: R() * TAU });
  }
  c.strokeStyle = '#2150c2'; c.lineCap = 'round';
  for (const q of roses) {
    for (let v = 0; v < 3; v++) {
      const a = R() * TAU, len = 150 + R() * 170;
      const x1 = q.x + Math.cos(a) * len, y1 = q.y + Math.sin(a) * len;
      const bx = (q.x + x1) / 2 + (R() - 0.5) * 160, by = (q.y + y1) / 2 + (R() - 0.5) * 160;
      c.lineWidth = 3 + R() * 3;
      wrapAt(S, q.x, q.y, len + 160, (px, py) => {
        const ox = px - q.x, oy = py - q.y;
        c.beginPath(); c.moveTo(q.x + ox, q.y + oy); c.quadraticCurveTo(bx + ox, by + oy, x1 + ox, y1 + oy); c.stroke();
        // Tendril curl at the end.
        c.lineWidth = 2;
        c.beginPath(); c.arc(x1 + ox + 8, y1 + oy, 8, Math.PI, Math.PI * 2.6); c.stroke();
      });
      for (let l = 0; l < 3; l++) {
        const t = 0.3 + l * 0.25;
        const lx = (1 - t) * (1 - t) * q.x + 2 * (1 - t) * t * bx + t * t * x1;
        const ly = (1 - t) * (1 - t) * q.y + 2 * (1 - t) * t * by + t * t * y1;
        const la = a + (l % 2 ? 1 : -1) * (0.7 + R() * 0.5), ll = 32 + R() * 26;
        wrapAt(S, lx, ly, ll, (px, py) => leaf(c, px, py, ll, la));
      }
      const bx2 = x1 + (R() - 0.5) * 30, by2 = y1 + (R() - 0.5) * 30, br = 12 + R() * 9, brot = R() * TAU;
      wrapAt(S, bx2, by2, br * 1.2, (px, py) => blossom(c, px, py, br, brot));
    }
  }
  for (const q of roses) {
    for (let l = 0; l < 4; l++) {
      const a = q.rot + l * 1.6 + R() * 0.4, ll = q.r * (0.8 + R() * 0.4);
      const lx = q.x + Math.cos(a) * q.r * 0.75, ly = q.y + Math.sin(a) * q.r * 0.75;
      wrapAt(S, lx, ly, ll, (px, py) => leaf(c, px, py, ll, a));
    }
    wrapAt(S, q.x, q.y, q.r * 1.2, (px, py) => rose(c, px, py, q.r, q.rot));
  }
  for (let i = 0; i < 40; i++) {
    const x = R() * S, y = R() * S, r = 10 + R() * 12, rot = R() * TAU;
    wrapAt(S, x, y, r * 1.2, (px, py) => blossom(c, px, py, r, rot));
  }
  c.fillStyle = '#2352c4';
  for (let i = 0; i < 220; i++) {
    const x = R() * S, y = R() * S, r = 2 + R() * 3.5;
    wrapAt(S, x, y, r, (px, py) => { c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill(); });
  }
  // Fine crazing in the glaze.
  c.strokeStyle = 'rgba(120,110,95,0.10)'; c.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    let x = R() * S, y = R() * S, a = R() * TAU;
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 6; k++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * 14; y += Math.sin(a) * 14; c.lineTo(x, y); }
    c.stroke();
  }
  // Gold kintsugi seams.
  const seams = makeSeams(S, R, 10);
  strokeSeams(c, S, seams, 'rgba(92,64,20,0.55)', 1.9);
  strokeSeams(c, S, seams, '#c99633', 1.0);
  strokeSeams(c, S, seams, '#ffe7a3', 0.35);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  strokeSeams(e, S, seams, 'rgb(130,75,15)', 2.0, 6);
  strokeSeams(e, S, seams, 'rgb(255,190,80)', 1.1, 4);
  strokeSeams(e, S, seams, 'rgb(255,240,190)', 0.4);
  // Clearcoat (R) / roughness (G) / metalness (B): glossy glaze, metallic gold.
  m.fillStyle = 'rgb(255,52,0)'; m.fillRect(0, 0, S, S);
  strokeSeams(m, S, seams, 'rgb(255,95,255)', 1.3);
  // Plain patches (see FLAT): unprinted glaze and a matte, unglazed hollow.
  c.fillStyle = GLAZE_BG; c.fillRect(0, 0, 128, 64);
  e.fillStyle = '#000'; e.fillRect(0, 0, 128, 64);
  m.fillStyle = 'rgb(255,40,0)'; m.fillRect(0, 0, 64, 64);
  m.fillStyle = 'rgb(0,235,0)'; m.fillRect(64, 0, 64, 64);

  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(cc, true), emissive: tex(ce, true), rm: tex(cr, false) };
}

// A dim bunker reflection: dark walls, warm bulbs, a cold window band.
function buildEnv() {
  const W = 512, H = 256;
  const cv = canvas(W, H);
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#07080b'); g.addColorStop(0.42, '#1b1813'); g.addColorStop(0.52, '#231a12'); g.addColorStop(1, '#0a0806');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(70,90,130,0.35)';
  c.fillRect(40, 105, 70, 22); c.fillRect(300, 108, 50, 18);
  const R = rng(77);
  for (let i = 0; i < 6; i++) {
    const x = (i / 6) * W + R() * 50, y = 40 + R() * 50, r = 14 + R() * 16;
    const b = c.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, 'rgba(255,245,215,1)'); b.addColorStop(0.18, 'rgba(255,200,120,0.9)'); b.addColorStop(1, 'rgba(255,140,50,0)');
    c.fillStyle = b; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Soft overhead strip so tops of forms catch a sheen.
  const top = c.createLinearGradient(0, 0, 0, 40);
  top.addColorStop(0, 'rgba(120,110,95,0.35)'); top.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = top; c.fillRect(0, 0, W, 40);
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function getKit() {
  if (KIT) return KIT;
  const tx = buildGlaze();
  const env = buildEnv();
  const glaze = new THREE.MeshPhysicalMaterial({
    map: tx.map, vertexColors: true,
    roughnessMap: tx.rm, metalnessMap: tx.rm, roughness: 1, metalness: 1,
    clearcoat: 1, clearcoatRoughness: 0.05, clearcoatMap: tx.rm,
    emissive: new THREE.Color(1, 0.72, 0.3), emissiveMap: tx.emissive, emissiveIntensity: 0.5,
    envMap: env, envMapIntensity: 1.1, side: THREE.DoubleSide,
  });
  // Unglazed bisque for the hollow inside and broken stumps.
  const bc = canvas(128);
  const bx = bc.getContext('2d');
  bx.fillStyle = '#c9b597'; bx.fillRect(0, 0, 128, 128);
  const R = rng(5);
  for (let i = 0; i < 900; i++) {
    bx.fillStyle = `rgba(${R() < 0.5 ? '90,70,50' : '240,228,205'},${0.08 + R() * 0.15})`;
    bx.fillRect(R() * 128, R() * 128, 1 + R() * 2, 1 + R() * 2);
  }
  const bt = new THREE.CanvasTexture(bc);
  bt.colorSpace = THREE.SRGBColorSpace;
  bt.wrapS = bt.wrapT = THREE.RepeatWrapping;
  const bisque = new THREE.MeshStandardMaterial({ map: bt, color: 0xb9a78c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const bisqueIn = bisque.clone();
  bisqueIn.side = THREE.BackSide;
  bisqueIn.color.setRGB(0.3, 0.26, 0.22);
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd9a443, metalness: 1, roughness: 0.28, envMap: env, envMapIntensity: 1.4,
    emissive: new THREE.Color(1, 0.7, 0.28), emissiveIntensity: 0.6,
  });
  KIT = { tx, env, glaze, bisque, bisqueIn, gold };
  return KIT;
}

// --- Geometry --------------------------------------------------------------------------
// Porcelain part: smooth primitives, vertex colours, print UVs scaled to a
// constant density (whole tiles around closed surfaces so the print wraps cleanly).
// spec: { t: 'sph'|'cyl'|'cap'|'tor'|'box'|'raw', d, p, r, s, c, g, su, sv }
function pgeo(specs, D = DENS, seed = 1) {
  const R = rng(seed * 131 + 7);
  const geos = specs.map((sp) => {
    const d = sp.d || [];
    const s = sp.s || [1, 1, 1];
    const sxz = (s[0] + s[2]) / 2;
    let g, su = 1, sv = 1, wrap = false;
    if (sp.t === 'sph') {
      const [r, ws = 16, hs = 12, ps = 0, pl = TAU, ts = 0, tl = Math.PI] = d;
      g = new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl);
      su = pl * r * sxz * D; sv = tl * r * s[1] * D; wrap = pl >= TAU - 1e-3;
    } else if (sp.t === 'cyl') {
      const [rt, rb, h, rs = 12, hs = 1, open = false, ts = 0, tl = TAU] = d;
      g = new THREE.CylinderGeometry(rt, rb, h, rs, hs, open, ts, tl);
      su = tl * Math.max(rt, rb) * sxz * D; sv = h * s[1] * D; wrap = tl >= TAU - 1e-3;
    } else if (sp.t === 'cap') {
      const [r, len, cs = 4, rs = 12] = d;
      g = new THREE.CapsuleGeometry(r, len, cs, rs);
      su = TAU * r * sxz * D; sv = (len + 2 * r) * s[1] * D; wrap = true;
    } else if (sp.t === 'tor') {
      const [Rr, tube, rs = 6, ts = 18, arc = TAU] = d;
      g = new THREE.TorusGeometry(Rr, tube, rs, ts, arc);
      su = arc * Rr * D; sv = TAU * tube * D;
    } else if (sp.t === 'lathe') {
      const [pts, segs = 12, ps = 0, pl = TAU] = d;
      g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs, ps, pl);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      su = pl * Math.max(...pts.map((q) => q[0])) * sxz * D; sv = len * s[1] * D; wrap = pl >= TAU - 1e-3;
    } else if (sp.t === 'raw') {
      g = sp.g; su = sp.su ?? 1; sv = sp.sv ?? 1;
    } else {
      g = new THREE.BoxGeometry(d[0], d[1], d[2]);
      su = sv = Math.max(d[0], d[1], d[2]) * D;
    }
    if (wrap) su = Math.max(1, Math.round(su));
    su = Math.max(0.12, su); sv = Math.max(0.12, sv);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...(sp.p || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(sp.r || [0, 0, 0]))),
      new THREE.Vector3(...s),
    ));
    const pos = g.attributes.position, uv = g.attributes.uv;
    const ou = R(), ov = R();
    const col = new Float32Array(pos.count * 3);
    const cc = sp.c || PC.glaze;
    const flat = sp.flat && FLAT[sp.flat];
    for (let i = 0; i < pos.count; i++) {
      col[i * 3] = cc[0]; col[i * 3 + 1] = cc[1]; col[i * 3 + 2] = cc[2];
      if (flat) uv.setXY(i, flat[0], flat[1]);
      else uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.index) {
      const idx = new Uint32Array(pos.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    return g;
  });
  return geos.reduce((acc, g) => (acc ? mergeSimple(acc, g) : g), null);
}

// One sector of the flared, fluted skirt with a broken hem.
function skirtShard(i, n, R) {
  const th = (i / n) * TAU, dt = TAU / n;
  const top = 0.148, bot = 0.33, h = 0.5;
  const g = new THREE.CylinderGeometry(top, bot, h, 6, 5, true, th + 0.004, dt - 0.008);
  const pos = g.attributes.position;
  const jag = [];
  for (let k = 0; k <= 6; k++) jag.push((R() - 0.3) * 0.055);
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const down = (h / 2 - y) / h;             // 0 at the waist, 1 at the hem
    const a = Math.atan2(x, z);
    const flute = 1 + 0.075 * Math.sin(a * 16) * down;
    let ny = y;
    if (down > 0.99) ny += jag[Math.round(((a - th + TAU * 2) % TAU) / dt * 6) % 7];
    pos.setXYZ(v, x * flute, ny, z * flute);
  }
  g.computeVertexNormals();
  g.translate(0, -0.045 - h / 2, 0);
  return { g, mid: th + dt / 2, su: dt * bot * DENS, sv: h * DENS };
}

// Pre-fractured chunk list. joint: rig joint the chunk rides on. drop: which
// damage stage removes it. fig: dainty figurine face instead of the skull.
function chunkDefs(fig = false) {
  const C = [];
  const add = (name, joint, specs, extra = {}) => C.push({ name, joint, specs, ...extra });
  const K = PC.socket;
  // Head (joint 'head' sits at the skull base). Cranium, a long skull face,
  // victory rolls on top; the cap chunk is the upper front-left of the cranium.
  const cr = [0, 0.125, -0.008], crS = [0.92, 1.0, 1.02], R0 = 0.09;
  const capT = 1.05, capP = Math.PI * 0.58, capL = Math.PI * 0.62;   // upper front-left
  const face = [
    { t: 'sph', d: [R0, 20, 9, 0, TAU, capT, Math.PI - capT], p: cr, s: crS },
    { t: 'sph', d: [R0, 14, 5, capP + capL, TAU - capL, 0, capT], p: cr, s: crS },
    { t: 'sph', d: [0.058, 14, 10], p: [0, 0.078, 0.03], s: [0.9, 1.3, 0.95] },
    { t: 'sph', d: [0.048, 10, 8], p: [0.079, 0.108, -0.022], s: [0.6, 1.05, 1.15] },
    { t: 'sph', d: [0.048, 10, 8], p: [-0.079, 0.108, -0.022], s: [0.6, 1.05, 1.15] },
    { t: 'cap', d: [0.031, 0.05, 4, 10], p: [0, 0.184, 0.062], r: [0, 0, Math.PI / 2] },
  ];
  if (fig) {
    face.push(
      { t: 'box', d: [0.022, 0.005, 0.006], p: [0.03, 0.114, 0.083], r: [0, 0, -0.18], c: PC.cobalt, flat: 'gloss' },
      { t: 'box', d: [0.022, 0.005, 0.006], p: [-0.03, 0.114, 0.083], r: [0, 0, 0.18], c: PC.cobalt, flat: 'gloss' },
      { t: 'sph', d: [0.011, 8, 6], p: [0, 0.05, 0.08], s: [1.4, 0.6, 0.6], c: PC.lip, flat: 'gloss' },
      { t: 'sph', d: [0.009, 6, 5], p: [0, 0.085, 0.086] },
    );
  } else {
    const skull = (sx) => [
      { t: 'sph', d: [0.022, 12, 8], p: [sx * 0.03, 0.114, 0.066], s: [1.12, 1.18, 0.8], c: K, flat: 'matte' },
      { t: 'sph', d: [0.019, 8, 6], p: [sx * 0.047, 0.094, 0.058], s: [1.3, 0.75, 0.95] },
    ];
    face.push(
      ...skull(1), ...skull(-1),
      { t: 'cap', d: [0.011, 0.066, 3, 8], p: [0, 0.137, 0.068], r: [0, 0, Math.PI / 2] },
      { t: 'sph', d: [0.01, 6, 5], p: [0, 0.087, 0.08], s: [0.9, 1.4, 0.6], c: K, flat: 'matte' },
      { t: 'box', d: [0.046, 0.032, 0.014], p: [0, 0.049, 0.068], c: K, flat: 'matte' },
      { t: 'sph', d: [0.024, 10, 7], p: [0, 0.012, 0.052], s: [1.2, 0.85, 0.95] },
    );
    for (let i = 0; i < 6; i++) {
      const x = -0.019 + i * 0.0076;
      face.push({ t: 'box', d: [0.0064, 0.013, 0.006], p: [x, 0.058, 0.077 - x * x * 4], c: PC.tooth, flat: 'gloss' });
      face.push({ t: 'box', d: [0.006, 0.011, 0.006], p: [x, 0.04, 0.075 - x * x * 4], c: PC.tooth, flat: 'gloss' });
    }
  }
  add('face', 'head', face);
  add('cap', 'head', [{ t: 'sph', d: [R0, 9, 5, capP, capL, 0, capT], p: cr, s: crS }], { drop: 1 });
  const roll = (sx) => [{ t: 'cap', d: [0.041, 0.07, 4, 12], p: [sx * 0.043, 0.192, 0.0], r: [Math.PI / 2 - 0.3, 0, sx * 0.05] }];
  add('rollL', 'head', roll(1), { drop: 1 });   // breaks away with the cap
  add('rollR', 'head', roll(-1));
  const back = [{ t: 'sph', d: [0.085, 14, 9], p: [0, 0.085, -0.035], s: [1.05, 0.85, 0.95] }];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i - 2) * 0.42;
    back.push({ t: 'tor', d: [0.017, 0.0095, 5, 12], p: [Math.sin(a) * 0.082, 0.03, Math.cos(a) * 0.078 - 0.025], r: [0, a, 0] });
  }
  add('hairBack', 'head', back);

  // Bodice: front and back plates of a lathed torso (nipped waist, padded
  // shoulders), with the neck, bust, collar and buttons.
  const torso = [[0.092, 0], [0.1, 0.035], [0.12, 0.09], [0.14, 0.15], [0.15, 0.2], [0.149, 0.235], [0.134, 0.262],
    [0.102, 0.283], [0.064, 0.297], [0.04, 0.303]];
  const rAt = (y) => { for (let i = 1; i < torso.length; i++) if (y <= torso[i][1]) return lerp(torso[i - 1][0], torso[i][0], (y - torso[i - 1][1]) / (torso[i][1] - torso[i - 1][1])); return 0.04; };
  const btn = [0.21, 0.16, 0.11].map((y) => ({ t: 'sph', d: [0.0075, 6, 5], p: [0, y, rAt(y) * 0.68 + 0.003], c: PC.gold, flat: 'gloss' }));
  add('chestF', 'chest', [
    { t: 'lathe', d: [torso, 12, -Math.PI / 2, Math.PI], s: [1, 1, 0.68] },
    { t: 'sph', d: [0.05, 12, 8], p: [0.046, 0.155, 0.074], s: [1, 0.9, 0.75] },
    { t: 'sph', d: [0.05, 12, 8], p: [-0.046, 0.155, 0.074], s: [1, 0.9, 0.75] },
    { t: 'cyl', d: [0.034, 0.042, 0.14, 12], p: [0, 0.33, 0] },
    { t: 'sph', d: [0.036, 10, 6], p: [0.03, 0.272, 0.06], r: [-0.95, 0, 0.45], s: [1, 0.16, 0.8] },
    { t: 'sph', d: [0.036, 10, 6], p: [-0.03, 0.272, 0.06], r: [-0.95, 0, -0.45], s: [1, 0.16, 0.8] },
    ...btn,
  ]);
  add('chestB', 'chest', [{ t: 'lathe', d: [torso, 12, Math.PI / 2, Math.PI], s: [1, 1, 0.68] }]);
  add('waist', 'spine', [
    { t: 'cyl', d: [0.093, 0.094, 0.15, 14], p: [0, 0.07, 0], s: [1, 1, 0.72] },
    { t: 'cyl', d: [0.098, 0.097, 0.034, 16], p: [0, 0.02, 0], s: [1, 1, 0.74], c: PC.cobalt },
    { t: 'box', d: [0.032, 0.026, 0.008], p: [0, 0.02, 0.073], c: PC.gold, flat: 'gloss' },
  ]);
  add('yoke', 'hips', [{ t: 'cyl', d: [0.098, 0.15, 0.13, 16, 1], p: [0, 0.01, 0], s: [1, 1, 0.8] }]);
  const R = rng(31);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const sh = skirtShard(i, N, R);
    add(`skirt${i}`, 'hips', [{ t: 'raw', g: sh.g, su: sh.su, sv: sh.sv, s: [1, 1, 0.82] }],
      { drop: i === 1 || i === 4 || i === 6 ? 3 : 0, skirt: sh.mid });
  }
  // Arms (sx = +1 her left).
  for (const [sx, L] of [[1, 'L'], [-1, 'R']]) {
    add(`upper${L}`, `sh${L}`, [
      { t: 'sph', d: [0.058, 12, 9], p: [0, -0.02, 0], s: [1.05, 0.9, 1] },
      { t: 'tor', d: [0.043, 0.01, 5, 14], p: [0, -0.07, 0], r: [Math.PI / 2, 0, 0], c: PC.cuff },
      { t: 'cyl', d: [0.036, 0.03, 0.21, 10], p: [0, -0.165, 0] },
      { t: 'sph', d: [0.03, 10, 7], p: [0, -0.27, 0] },
    ]);
    const hand = [
      { t: 'cyl', d: [0.029, 0.021, 0.22, 10], p: [0, -0.11, 0] },
      { t: 'sph', d: [0.021, 8, 6], p: [0, -0.222, 0] },
      { t: 'box', d: [0.018, 0.07, 0.048], p: [0, -0.262, 0.004] },
      { t: 'cyl', d: [0.0065, 0.005, 0.048, 6], p: [-sx * 0.004, -0.262, 0.034], r: [-0.7, 0, 0] },
    ];
    for (let f = 0; f < 4; f++) {
      const z = -0.018 + f * 0.012, len = f === 0 || f === 3 ? 0.062 : 0.074;
      hand.push({ t: 'cyl', d: [0.0062, 0.0045, len, 6], p: [sx * 0.002, -0.297 - len / 2, z + 0.004], r: [-0.18, 0, sx * 0.08] });
    }
    add(`fore${L}`, `el${L}`, hand, { drop: L === 'L' ? 2 : 0 });
  }
  // Legs with low-heeled pumps.
  for (const L of ['L', 'R']) {
    add(`thigh${L}`, `hip${L}`, [
      { t: 'cyl', d: [0.066, 0.05, 0.42, 12], p: [0, -0.21, 0] },
      { t: 'sph', d: [0.049, 10, 8], p: [0, -0.438, 0.004] },
    ]);
    add(`shin${L}`, `kn${L}`, [
      { t: 'sph', d: [0.049, 12, 9], p: [0, -0.12, -0.008], s: [0.85, 1.9, 0.92] },
      { t: 'cyl', d: [0.043, 0.027, 0.36, 12], p: [0, -0.19, 0] },
      { t: 'sph', d: [0.026, 8, 6], p: [0, -0.385, -0.004] },
      { t: 'sph', d: [0.043, 12, 8], p: [0, -0.44, 0.05], r: [0.42, 0, 0], s: [0.72, 0.5, 1.6], c: PC.shoe },
      { t: 'sph', d: [0.035, 10, 7], p: [0, -0.418, -0.012], s: [0.9, 0.8, 1.05], c: PC.shoe },
      { t: 'cyl', d: [0.017, 0.021, 0.055, 8], p: [0, -0.472, -0.032], s: [1, 1, 0.9], c: PC.shoe },
      { t: 'tor', d: [0.029, 0.0045, 4, 14], p: [0, -0.396, 0.006], r: [Math.PI / 2 - 0.25, 0, 0], c: PC.gold },
    ]);
  }
  return C;
}

function makeRig() {
  const J = {};
  const j = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); if (parent) J[parent].add(o); J[name] = o; return o; };
  j('root', null, 0, 0, 0);
  j('body', 'root', 0, 0, 0);
  j('hips', 'body', 0, 0.97, 0);
  j('spine', 'hips', 0, 0.08, 0);
  j('chest', 'spine', 0, 0.13, 0);
  j('neck', 'chest', 0, 0.27, 0);
  j('head', 'neck', 0, 0.085, 0.01);
  j('shL', 'chest', 0.172, 0.232, -0.005); j('shR', 'chest', -0.172, 0.232, -0.005);
  j('elL', 'shL', 0, -0.275, 0); j('elR', 'shR', 0, -0.275, 0);
  j('hipL', 'hips', 0.085, -0.03, 0); j('hipR', 'hips', -0.085, -0.03, 0);
  j('knL', 'hipL', 0, -0.44, 0); j('knR', 'hipR', 0, -0.44, 0);
  return J;
}

const ANIM = ['body', 'hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR'];
function restPose(J) {
  for (const k of ANIM) J[k].rotation.set(0, 0, 0);
  J.body.position.set(0, 0, 0);
  J.shL.rotation.z = 0.1; J.shR.rotation.z = -0.1;
  J.elL.rotation.x = -0.15; J.elR.rotation.x = -0.15;
}

// Graceful little dancing pose for the figurine.
function dancePose(J) {
  restPose(J);
  J.hips.rotation.y = 0.28;
  J.spine.rotation.x = -0.1; J.chest.rotation.set(-0.06, -0.12, 0.05);
  J.hipR.rotation.x = 0.85; J.knR.rotation.x = 0.75;
  J.hipL.rotation.set(-0.05, 0, 0.03);
  J.shL.rotation.set(-2.75, 0, 0.3); J.elL.rotation.x = -0.65;
  J.shR.rotation.set(-0.25, 0, -1.3); J.elR.rotation.x = -0.4;
  J.neck.rotation.z = -0.18; J.head.rotation.set(-0.15, 0.3, -0.05);
}

// Skirt shard hinge: rotate about the waistline tangent so the hem flares out.
const _hv = new THREE.Vector3(), _hm = new THREE.Matrix4(), _ht = new THREE.Matrix4();
function skirtLocal(out, mid, angle) {
  _hv.set(-Math.cos(mid), 0, Math.sin(mid));
  _hm.makeRotationAxis(_hv, angle);
  _ht.makeTranslation(0, 0.045, 0);
  out.makeTranslation(0, -0.045, 0).multiply(_hm).multiply(_ht);
  return out;
}

// --- The boss ------------------------------------------------------------------------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _w = new THREE.Vector3();

export class KintsugiBoss {
  constructor(scene, tex) {
    this.scene = scene;
    this.tex = tex;
    const kit = getKit();
    this.mat = kit.glaze.clone();
    this.group = new THREE.Group();
    this.group.name = 'kintsugi';
    this.group.visible = false;
    scene.add(this.group);
    this.J = makeRig();
    this.chunks = chunkDefs(false).map((def, i) => {
      const geo = pgeo(def.specs, DENS, i + 1);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.name = `kintsugi-${def.name}`;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return {
        name: def.name, mesh, joint: this.J[def.joint], drop: def.drop || 0, skirt: def.skirt,
        c: geo.boundingSphere.center.clone(), r: geo.boundingSphere.radius,
        w0: new THREE.Vector3(), q0: new THREE.Quaternion(), v: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), rate: 0,
        w: new THREE.Vector3(), q: new THREE.Quaternion(), off: new THREE.Vector3(), qr: new THREE.Quaternion(), delay: 0,
        rest: false, live: true,
      };
    });
    const byName = Object.fromEntries(this.chunks.map((c) => [c.name, c]));
    // Hollow skull (seen once the cap is gone) and the bisque forearm stump.
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.083, 16, 10).scale(0.92, 1.0, 1.02).translate(0, 0.125, -0.008), kit.bisqueIn);
    inner.matrixAutoUpdate = false;
    byName.face.mesh.add(inner);
    const sg = new THREE.CylinderGeometry(0.028, 0.029, 0.05, 10, 1);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0) sp.setY(i, sp.getY(i) - hash1(i * 7.7) * 0.03);
    sg.computeVertexNormals();
    sg.translate(0, -0.3, 0);
    const stump = new THREE.Mesh(sg, kit.bisque);
    stump.matrixAutoUpdate = false;
    byName.upperL.mesh.add(stump);
    this.inner = inner;
    this.stump = stump;
    this._d = null;
    this._flash = 0;
  }

  hide() { this.group.visible = false; }

  reset(d) {
    this._d = d;
    this._state = -1;
    this._stateT = 0;
    this._dead = false;
    this._posed = false;
    this._fi = -1;
    this._flash = 0;
    this._burstN = (this._burstN || 0) + 1;
    for (const ch of this.chunks) { ch.live = true; ch.rest = false; }
  }

  draw(d, dt, time) {
    if (d !== this._d) this.reset(d);
    dt = Math.min(0.1, Math.max(0, dt || 0));
    this.group.visible = true;
    const entered = d.state !== this._state || (d.stateT || 0) + 1e-6 < this._stateT;
    this._state = d.state;
    this._stateT = d.stateT || 0;
    const stage = Math.max(0, Math.min(3, d.stage | 0));
    this.inner.visible = stage >= 1;
    this.stump.visible = stage >= 2;
    this._flash *= Math.exp(-dt * 3.5);

    if (d.killed) {
      if (!this._dead) this.startDeath(d, stage);
      this.stepDeath(d, dt);
      const dT = d.deadT || 0;
      this.mat.emissiveIntensity = 2.6 * (1 - smooth(0, 1.6, dT)) + 0.06;
      if (dT > 5) this.group.visible = false;
      return;
    }
    this._dead = false;

    if (d.state === ZS.SHATTER) {
      if (entered || !this._burstReady) this.startBurst(d, stage, time);
      this.poseBurst(d.stateT || 0);
      this.mat.emissiveIntensity = 3.2 * (1 - smooth(0, 0.6, d.stateT || 0)) + 0.1;
      return;
    }
    this._burstReady = false;

    this.pose(d, dt, time);
    this.placeRoot(d);
    if (d.state === ZS.REFORM) {
      if (entered || !this._reformReady) this.startReform(d);
      const u = clamp01((d.stateT || 0) / REFORM_T);
      this.poseReform(u, stage);
      this._flash = Math.max(this._flash, 2.6 * smooth(0.78, 1, u));
    } else {
      this._reformReady = false;
      this.assemble(stage);
    }
    this.glow(d, stage, time);
  }

  glow(d, stage, time) {
    const hp = d.hpFrac ?? 1;
    const base = 0.55 + 0.45 * stage;
    let pulse = 0.78 + 0.22 * Math.sin(time * 2.1);
    if (hp < 0.25) pulse = 0.95 + 0.9 * Math.pow(0.5 + 0.5 * Math.sin(time * 6.5), 3);
    this.mat.emissiveIntensity = base * pulse + this._flash;
  }

  placeRoot(d) {
    const J = this.J;
    J.root.position.set(d.x, d.y, d.z);
    J.root.quaternion.setFromAxisAngle(_up, d.yaw || 0);
    J.root.updateMatrixWorld(true);
  }

  dropped(ch, stage) { return ch.drop > 0 && stage >= ch.drop; }

  // Assembled matrix for a chunk from the current rig pose.
  target(ch, out) {
    out.copy(ch.joint.matrixWorld);
    if (ch.skirt !== undefined) out.multiply(skirtLocal(_m, ch.skirt, this.skirtAngle(ch.skirt)));
    return out;
  }

  skirtAngle(mid) {
    const J = this.J;
    const fl = -J.hipL.rotation.x, fr = -J.hipR.rotation.x;
    const cz = Math.cos(mid), sx = Math.sin(mid);
    const fwd = Math.max(0, cz) * Math.max(0, sx > 0 ? fl : fr, Math.max(fl, fr) * 0.6);
    const bwd = Math.max(0, -cz) * Math.max(0, -Math.min(fl, fr));
    return 0.03 + this._flare + fwd * 0.75 + bwd * 0.45 + this._sway * Math.sin(mid * 2 + this._swayPh);
  }

  assemble(stage) {
    for (const ch of this.chunks) {
      const vis = !this.dropped(ch, stage);
      ch.mesh.visible = vis;
      if (!vis) continue;
      this.target(ch, ch.mesh.matrix);
      ch.mesh.matrixWorldNeedsUpdate = true;
    }
    this._posed = true;
  }

  setChunk(ch, w, q, s) {
    _v.copy(ch.c).multiplyScalar(s).applyQuaternion(q);
    _v2.copy(w).sub(_v);
    _s.setScalar(Math.max(1e-4, s));
    ch.mesh.matrix.compose(_v2, q, _s);
    ch.mesh.matrixWorldNeedsUpdate = true;
  }

  // Capture the current pose of every live chunk and give it a kick.
  capture(d, stage, R, speed, up) {
    if (!this._posed) {
      restPose(this.J); this._flare = 0; this._sway = 0; this._swayPh = 0;
      this.placeRoot(d); this.assemble(stage);
    }
    const cx = d.x, cy = (d.y || 0) + 1.0, cz = d.z;
    for (const ch of this.chunks) {
      ch.live = !this.dropped(ch, stage);
      ch.mesh.visible = ch.live;
      if (!ch.live) continue;
      ch.w0.copy(ch.c).applyMatrix4(ch.mesh.matrix);
      ch.mesh.matrix.decompose(_v, ch.q0, _s);
      _v.set(ch.w0.x - cx, (ch.w0.y - cy) * 0.6, ch.w0.z - cz);
      if (_v.lengthSq() < 1e-4) _v.set(R() - 0.5, 0.2, R() - 0.5);
      _v.normalize();
      _v.x += (R() - 0.5) * 0.7; _v.z += (R() - 0.5) * 0.7; _v.y += up[0] + R() * up[1];
      _v.normalize();
      ch.v.copy(_v).multiplyScalar(speed[0] + R() * speed[1]);
      ch.ax.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      ch.rate = 4 + R() * 10;
      ch.w.copy(ch.w0); ch.q.copy(ch.q0); ch.rest = false;
    }
  }

  startBurst(d, stage, time) {
    this.capture(d, stage, rng(this._burstN++ * 977 + 5), [2.6, 2.8], [0.3, 0.5]);
    this._burstReady = true;
  }

  poseBurst(t) {
    const s = 1 - smooth(BURST_FADE * 0.5, BURST_FADE, t);
    for (const ch of this.chunks) {
      if (!ch.live) continue;
      ch.mesh.visible = t < BURST_FADE;
      if (!ch.mesh.visible) continue;
      _v.copy(ch.v).multiplyScalar(t).add(ch.w0);
      _v.y -= 4.5 * t * t;
      ch.w.copy(_v);
      _q.setFromAxisAngle(ch.ax, ch.rate * t).multiply(ch.q0);
      this.setChunk(ch, ch.w, _q, s);
    }
    this._posed = false;
  }

  startReform() {
    const R = rng(this._burstN++ * 613 + 11);
    for (const ch of this.chunks) {
      const a = R() * TAU, dist = 1.3 + R() * 1.2;
      ch.off.set(Math.cos(a) * dist, 0.1 + R() * 1.1, Math.sin(a) * dist);
      ch.qr.set(R() - 0.5, R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      ch.delay = R() * 0.32;
    }
    this._reformReady = true;
  }

  poseReform(u, stage) {
    for (const ch of this.chunks) {
      const vis = !this.dropped(ch, stage);
      const ui = clamp01((u - ch.delay) / (1 - ch.delay));
      ch.mesh.visible = vis && ui > 0;
      if (!ch.mesh.visible) continue;
      this.target(ch, _m);
      if (ui >= 1) { ch.mesh.matrix.copy(_m); ch.mesh.matrixWorldNeedsUpdate = true; continue; }
      const e = Math.pow(ui, 2.3);
      _v2.copy(ch.c).applyMatrix4(_m);
      _m.decompose(_v, _q2, _s);
      ch.w.copy(ch.off).multiplyScalar(1 - e).add(_v2);
      _q.copy(ch.qr).slerp(_q2, e);
      this.setChunk(ch, ch.w, _q, 0.25 + 0.75 * smooth(0, 0.55, ui));
    }
    this._posed = u >= 1;
  }

  startDeath(d, stage) {
    this.capture(d, stage, rng(this._burstN++ * 389 + 3), [1.2, 2.3], [0.5, 0.9]);
    this._dead = true;
    this._flash = 0;
  }

  // Simple rigid-body tumble: gravity, a floor at d.y, lossy bounces, then rest.
  stepDeath(d, dt) {
    const floor = d.y || 0;
    const T = d.deadT || 0;
    const steps = 3, h = dt / steps;
    for (const ch of this.chunks) {
      if (!ch.live) continue;
      for (let i = 0; i < steps && !ch.rest; i++) {
        ch.v.y -= 9.8 * h;
        ch.w.addScaledVector(ch.v, h);
        _q.setFromAxisAngle(ch.ax, ch.rate * h);
        ch.q.premultiply(_q);
        const lo = floor + ch.r * 0.38;
        if (ch.w.y < lo) {
          ch.w.y = lo;
          if (ch.v.y < 0) ch.v.y *= -0.3;
          ch.v.x *= 0.62; ch.v.z *= 0.62;
          ch.rate *= 0.5;
          if (Math.abs(ch.v.y) < 0.35 && ch.v.x * ch.v.x + ch.v.z * ch.v.z < 0.05) ch.rest = true;
        }
      }
      const sink = Math.max(0, T - 4);
      _w.copy(ch.w); _w.y -= sink * 0.22;
      ch.mesh.visible = T < 5;
      this.setChunk(ch, _w, ch.q, 1 - smooth(4.2, 5, T));
    }
    this._posed = false;
  }

  // --- Animation ------------------------------------------------------------------------
  pose(d, dt, time) {
    const J = this.J;
    restPose(J);
    this._flare = 0; this._sway = 0; this._swayPh = 0;
    const sp = d.speed || 0;
    if (!Number.isFinite(d.phase)) d.phase = 0;
    if (d.state === ZS.ATTACK) return this.poseAttack(d, time);
    if (sp >= 2.5) {
      // Stop-motion: the pose only updates ~7 times a second, with twitches.
      d.phase += dt * sp * 2.5;
      const fi = Math.floor(time * STOP_FPS);
      if (fi !== this._fi) {
        this._fi = fi;
        this._qph = d.phase;
        const h = (k) => hash1(fi * 3.17 + k * 11.3) - 0.5;
        this._tw = { hy: h(1) * 0.9, hz: h(2) * 1.1, hx: h(3) * 0.4, aL: h(4) * 0.7, aR: h(5) * 0.7, sp: h(6) * 0.3, el: h(7) * 0.8 };
      }
      const tw = this._tw, ph = this._qph;
      const s = Math.sin(ph), c = Math.cos(ph);
      J.hipL.rotation.x = s * 0.62; J.hipR.rotation.x = -s * 0.62;
      J.knL.rotation.x = Math.max(0, -c) * 1.15 + 0.08; J.knR.rotation.x = Math.max(0, c) * 1.15 + 0.08;
      J.body.position.y = -0.045 + Math.abs(c) * 0.05;
      J.spine.rotation.set(0.3 + tw.sp * 0.3, tw.sp * 0.4, 0);
      J.chest.rotation.x = 0.1;
      J.shL.rotation.set(-1.45 + tw.aL, 0, 0.3 + tw.aR * 0.3);
      J.shR.rotation.set(-1.3 + tw.aR, 0, -0.3 + tw.aL * 0.3);
      J.elL.rotation.x = -0.15 + tw.el * 0.3; J.elR.rotation.x = -0.25 - tw.el * 0.3;
      J.neck.rotation.set(-0.3 + tw.hx, tw.hy * 0.5, 0.35 + tw.hz * 0.6);
      J.head.rotation.set(tw.hx * 0.5, tw.hy, tw.hz * 0.4);
      this._flare = 0.14; this._sway = 0.06; this._swayPh = ph;
      return;
    }
    const t = time;
    if (sp > 0.15) {
      // Graceful doll walk: small steps, stiff arms held out, head cocked.
      d.phase += dt * sp * 3.6;
      const ph = d.phase, s = Math.sin(ph), c = Math.cos(ph);
      J.hipL.rotation.x = s * 0.34; J.hipR.rotation.x = -s * 0.34;
      J.knL.rotation.x = Math.max(0, -c) * 0.5 + 0.03; J.knR.rotation.x = Math.max(0, c) * 0.5 + 0.03;
      J.body.position.y = -Math.abs(c) * 0.012;
      J.hips.rotation.set(0, s * 0.1, c * 0.045);
      J.spine.rotation.set(0.04, -s * 0.14, -c * 0.045);
      J.shL.rotation.set(-0.28 - s * 0.12, 0, 0.26); J.shR.rotation.set(-0.28 + s * 0.12, 0, -0.26);
      J.elL.rotation.x = -0.45; J.elR.rotation.x = -0.4;
      J.neck.rotation.set(-0.05, 0.08 * Math.sin(t * 0.4), 0.24 + 0.05 * Math.sin(t * 0.7));
      J.head.rotation.set(-0.06 + 0.03 * Math.sin(ph * 2), 0.12 * Math.sin(t * 0.33), 0.06);
      this._sway = 0.035; this._swayPh = ph;
      return;
    }
    // Standing: slow porcelain head tilts with the odd sharp twitch.
    const k = Math.floor(t * 1.3), fr = t * 1.3 - k;
    const tw = hash1(k) > 0.72 && fr < 0.14 ? (hash1(k + 9) - 0.5) : 0;
    J.hips.rotation.z = 0.025 * Math.sin(t * 0.8);
    J.shL.rotation.z = 0.2; J.shR.rotation.z = -0.2;
    J.elL.rotation.x = -0.3; J.elR.rotation.x = -0.25;
    J.neck.rotation.set(0.05 * Math.sin(t * 0.6), 0.1 * Math.sin(t * 0.35), 0.28 * Math.sin(t * 0.45));
    J.head.rotation.set(0.05, tw * 1.1, tw * 0.6);
    this._sway = 0.02; this._swayPh = t;
  }

  poseAttack(d, time) {
    const J = this.J;
    const u = clamp01((d.stateT || 0) / ATTACK_T);
    J.hipL.rotation.x = -0.28; J.hipR.rotation.x = 0.3; J.knR.rotation.x = 0.2;
    let shx, shz, el, sy, sx, bz = 0;
    if (u < 0.5) {
      const w = smooth(0, 0.5, u);
      shx = lerp(-0.3, -2.85, w); shz = lerp(-0.1, -0.65, w); el = -0.9 * w;
      sy = -0.45 * w; sx = -0.08 * w;
      J.shL.rotation.set(-0.5 * w, 0, 0.35 * w);
      J.head.rotation.set(0.1 * w, 0, -0.1 * w + Math.sin(time * 40) * 0.03 * w);
    } else if (u < 0.72) {
      const s = smooth(0.5, 0.72, u);
      shx = lerp(-2.85, -0.55, s); shz = lerp(-0.65, 0.6, s); el = lerp(-0.9, -0.08, s);
      sy = lerp(-0.45, 0.5, s); sx = lerp(-0.08, 0.35, s); bz = 0.16 * s;
      J.shL.rotation.set(lerp(-0.5, 0.2, s), 0, lerp(0.35, 0.5, s));
      J.head.rotation.set(0.15, 0.2 * s, 0);
    } else {
      const r = smooth(0.72, 1, u);
      shx = lerp(-0.55, -0.3, r); shz = lerp(0.6, -0.1, r); el = lerp(-0.08, -0.2, r);
      sy = lerp(0.5, 0, r); sx = lerp(0.35, 0.05, r); bz = 0.16 * (1 - r);
      J.shL.rotation.set(0.2 * (1 - r), 0, lerp(0.5, 0.1, r));
      J.head.rotation.set(0.15 * (1 - r), 0.2 * (1 - r), 0);
    }
    J.shR.rotation.set(shx, 0, shz);
    J.elR.rotation.x = el;
    J.spine.rotation.set(sx, sy, 0);
    J.body.position.z = bz;
    J.neck.rotation.z = 0.15;
    this._flare = 0.05;
  }
}

// --- Easter-egg props ---------------------------------------------------------------------
const FIG_H = 0.25;       // figurine height without its base

export function buildFigurine() {
  const kit = getKit();
  const mat = kit.glaze.clone();
  mat.emissiveIntensity = 0.05;
  const J = makeRig();
  dancePose(J);
  J.root.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  const geos = chunkDefs(true).map((def, i) => {
    const g = pgeo(def.specs, DENS * 0.5, i + 101);
    m.copy(J[def.joint].matrixWorld);
    if (def.skirt !== undefined) m.multiply(skirtLocal(new THREE.Matrix4(), def.skirt, 0.22 + 0.1 * Math.sin(def.skirt * 3)));
    return g.applyMatrix4(m);
  });
  const body = geos.reduce((a, g) => mergeSimple(a, g));
  body.computeBoundingBox();
  const S = FIG_H / 1.77;
  const baseH = 0.022;
  body.applyMatrix4(new THREE.Matrix4().makeScale(S, S, S));
  body.translate(0, baseH - body.boundingBox.min.y * S, 0);
  body.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'kintsugi-figurine';
  const lady = new THREE.Mesh(body, mat);
  group.add(lady);
  const baseMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b2a6a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMap: kit.env, envMapIntensity: 1.1,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, baseH, 28).translate(0, baseH / 2, 0), baseMat);
  group.add(base);
  const goldMat = kit.gold.clone();
  goldMat.emissiveIntensity = 0.15;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0465, 0.0022, 6, 36).rotateX(Math.PI / 2).translate(0, baseH, 0), goldMat);
  group.add(rim);
  // Faint golden aura (additive sprite), only visible while primed.
  const ac = canvas(128);
  const ax = ac.getContext('2d');
  const gr = ax.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,120,0.9)'); gr.addColorStop(0.35, 'rgba(255,170,60,0.35)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
  ax.fillStyle = gr; ax.fillRect(0, 0, 128, 128);
  const at = new THREE.CanvasTexture(ac);
  at.colorSpace = THREE.SRGBColorSpace;
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: at, color: 0xffc766, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  aura.scale.set(0.34, 0.4, 1);
  aura.position.y = baseH + FIG_H * 0.55;
  aura.visible = false;
  group.add(aura);
  let glow = 0;
  group.userData.setGlow = (k) => {
    glow = clamp01(k);
    mat.emissiveIntensity = 0.05 + glow * 3.2;
    goldMat.emissiveIntensity = 0.15 + glow * 1.8;
    aura.material.opacity = glow * 0.7;
    aura.visible = glow > 0.001;
  };
  group.userData.update = (dt, time) => {
    if (glow <= 0.001) return;
    const sh = 0.82 + 0.12 * Math.sin(time * 5.3) + 0.06 * Math.sin(time * 13.7);
    mat.emissiveIntensity = (0.05 + glow * 3.2) * sh;
    aura.material.opacity = glow * (0.6 + 0.15 * Math.sin(time * 2.4));
    aura.material.rotation = time * 0.25;
    const k = 1 + 0.05 * Math.sin(time * 1.9);
    aura.scale.set(0.34 * k, 0.4 * k, 1);
  };
  return group;
}

export function buildTeacup() {
  const kit = getKit();
  const mat = kit.glaze.clone();
  mat.emissiveIntensity = 0.3;
  const D = 11;   // print tiles per metre: bold flowers on a small cup
  const lathe = (pts, segs) => {
    const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const rmax = Math.max(...pts.map((p) => p[0]));
    return { t: 'raw', g, su: Math.max(1, Math.round(TAU * rmax * D)), sv: len * D };
  };
  const saucer = lathe([[0.0005, 0], [0.03, 0], [0.032, 0.003], [0.037, 0.0065], [0.058, 0.011], [0.066, 0.015], [0.0655, 0.0172],
    [0.057, 0.014], [0.036, 0.0098], [0.024, 0.0088], [0.0005, 0.0088]], 32);
  const cupPts = [[0.0005, 0.0088], [0.02, 0.0088], [0.0215, 0.0115], [0.0205, 0.0135], [0.03, 0.021], [0.037, 0.034], [0.041, 0.05],
    [0.0425, 0.058], [0.0405, 0.0588], [0.0385, 0.0515], [0.0345, 0.036], [0.027, 0.0245], [0.013, 0.0185], [0.0005, 0.0175]];
  const cup = lathe(cupPts, 32);
  const handle = new THREE.TorusGeometry(0.0125, 0.0034, 6, 14, Math.PI * 1.2);
  handle.rotateZ(-Math.PI * 0.6).translate(0.0445, 0.037, 0);
  const geo = pgeo([saucer, cup, { t: 'raw', g: handle, su: 0.5, sv: 0.3 }], D, 404);
  geo.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'kintsugi-teacup';
  group.add(new THREE.Mesh(geo, mat));
  // A bold mended crack down the cup and across the saucer rim: the hint.
  const rAt = (y) => {
    for (let i = 1; i < 8; i++) {
      const [x0, y0] = cupPts[i - 1], [x1, y1] = cupPts[i];
      if (y >= y0 && y <= y1) return x0 + (x1 - x0) * ((y - y0) / Math.max(1e-6, y1 - y0));
    }
    return 0.04;
  };
  const R = rng(99);
  const pts = [];
  let a = 0.35;
  for (let i = 0; i <= 12; i++) {
    const y = 0.058 - i * 0.0032;
    a += (R() - 0.5) * 0.22;
    const r = rAt(y) + 0.0009;
    pts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
  }
  const sPts = [];
  let sa = 0.9;
  for (let i = 0; i <= 8; i++) {
    const r = 0.0655 - i * 0.0036;
    sa += (R() - 0.5) * 0.25;
    const y = r > 0.058 ? 0.0152 + (r - 0.058) * 0.25 : 0.0102 + (r - 0.036) * 0.2;
    sPts.push(new THREE.Vector3(Math.sin(sa) * r, y + 0.0014, Math.cos(sa) * r));
  }
  const gold = kit.gold.clone();
  gold.emissiveIntensity = 0.7;
  const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0011, 5);
  const seam2 = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sPts), 24, 0.001, 5);
  group.add(new THREE.Mesh(mergeSimple(seam, seam2), gold));
  group.userData.shatter = () => { group.visible = false; };
  group.userData.restore = () => { group.visible = true; };
  return group;
}

function mergeSimple(a, b) {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(a.attributes).filter((n) => b.attributes[n])) {
    const A = a.attributes[name], B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array); arr.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index.array, ib = b.index.array, off = a.attributes.position.count;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
