// Hellhounds: skeletal, charred hounds with glowing ember cracks and burning
// eyes. One template quadruped rig drives 13 InstancedMeshes (11 lit body
// parts + 2 unlit ember parts), so the whole pack costs a fixed 13 draw calls.
// Procedural animation: warp-in, trot, rotary gallop, lunge-bite, burn-out.
//
//   const h = new Hounds(scene, tex);
//   h.begin(); for (const d of hounds) h.draw(d, dt, time); h.end();
//
// draw() advances d.phase (gait) and caches a little scratch on d (d._hk).

import * as THREE from 'three';
import { ZS as ZSP } from '../../shared/protocol.js';

const ZS = { CHASE: ZSP.CHASE ?? 4, ATTACK: ZSP.ATTACK ?? 5, WARP: ZSP.WARP ?? 6 };
const CAP = 32;
const TAU = Math.PI * 2;
const FLESH = 0, BONE = 1;
const WARP_T = 0.9, ATTACK_T = 0.35, DEATH_T = 0.72;

// Palette carried in vertex colours; the atlas adds char, ash and cracks.
const COL = {
  char: [0.15, 0.14, 0.135], ash: [0.24, 0.225, 0.21], bone: [0.4, 0.36, 0.3], boneDk: [0.19, 0.17, 0.155],
  socket: [0.02, 0.015, 0.012], tooth: [0.8, 0.74, 0.6], claw: [0.07, 0.06, 0.055], gum: [0.3, 0.06, 0.03],
  eye: [1.05, 0.55, 0.14], core: [0.75, 0.17, 0.02], hot: [0.95, 0.36, 0.05],
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash1(n) { const h = Math.sin(n * 127.1 + 311.7) * 43758.5453; return h - Math.floor(h); }
function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
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

// --- Geometry -----------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// Organic part: primitives -> transformed, lumpy, vertex-coloured, atlas UVs
// (flesh on the left half of the atlas, bone on the right).
// spec: { t: 'cyl'|'sph'|'box'|'cone'|'tor'|'seg', d, p, r, s, m: FLESH|BONE, c, lump, a, b }
function partGeo(specs) {
  const geos = specs.map((sp) => {
    let g;
    const d = sp.d;
    let p = sp.p || [0, 0, 0], q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(sp.r || [0, 0, 0])));
    if (sp.t === 'cyl') g = new THREE.CylinderGeometry(d[0], d[1], d[2], d[3] ?? 8, 2);
    else if (sp.t === 'sph') g = new THREE.SphereGeometry(d[0], d[1] ?? 10, d[2] ?? 7, 0, Math.PI * 2, 0, d[3] ?? Math.PI);
    else if (sp.t === 'cone') g = new THREE.ConeGeometry(d[0], d[1], d[2] ?? 5, 1);
    else if (sp.t === 'tor') g = new THREE.TorusGeometry(d[0], d[1], d[2] ?? 4, d[3] ?? 14, d[4] ?? Math.PI * 2);
    else if (sp.t === 'seg') {
      // Tapered limb between two points.
      _a.set(...sp.a); _b.set(...sp.b);
      const len = _a.distanceTo(_b);
      g = new THREE.CylinderGeometry(d[1], d[0], len, d[2] ?? 6, 1);
      p = [(_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2];
      q = new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
    } else g = new THREE.BoxGeometry(d[0], d[1], d[2], 2, 1, 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...(sp.s || [1, 1, 1])));
    g.applyMatrix4(m);
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const lump = sp.lump ?? (sp.m === BONE ? 0.002 : 0.005);
    const col = new Float32Array(pos.count * 3);
    const c = sp.c || (sp.m === BONE ? COL.bone : COL.char);
    const uo = sp.m === BONE ? 0.5 : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = hash3(Math.round(x * 45), Math.round(y * 45), Math.round(z * 45)) - 0.5;
      pos.setXYZ(i, x + nrm.getX(i) * n * lump * 2, y + nrm.getY(i) * n * lump * 2, z + nrm.getZ(i) * n * lump * 2);
      const k = 0.82 + n * 0.36;
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
      uv.setX(i, 0.01 + uv.getX(i) * 0.48 + uo);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
  return geos.reduce((acc, g) => (acc ? mergeSimple(acc, g) : g), null);
}

// Unlit ember geometry: plain vertex colours, no lumps.
function glowGeo(specs) {
  const geos = specs.map((sp) => {
    const d = sp.d;
    const g = sp.t === 'box' ? new THREE.BoxGeometry(d[0], d[1], d[2]) : new THREE.SphereGeometry(d[0], d[1] ?? 8, d[2] ?? 6);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...(sp.p || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(sp.r || [0, 0, 0]))),
      new THREE.Vector3(...(sp.s || [1, 1, 1])),
    ));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(sp.c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return geos.reduce((acc, g) => (acc ? mergeSimple(acc, g) : g), null);
}

// --- Atlas: charred hide with ember cracks (left) and scorched bone (right) --------
let ATLAS = null;
function makeAtlas() {
  if (ATLAS) return ATLAS;
  const W = 512, H = 256;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const cc = mk(), ce = mk();
  const x = cc.getContext('2d'), e = ce.getContext('2d');
  const R = rng(6661);
  // Value noise for the char / bone grain.
  const img = x.createImageData(W, H);
  const grid = 24, gv = [];
  for (let i = 0; i < (grid + 1) * (grid + 1); i++) gv.push(R());
  const vn = (u, v) => {
    const gx = u * grid, gy = v * grid, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const g = (a, b) => gv[(b % grid) * (grid + 1) + (a % grid)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(g(ix, iy), g(ix + 1, iy), sx), lerp(g(ix, iy + 1), g(ix + 1, iy + 1), sx), sy);
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const bone = px >= 256;
      const u = (px % 256) / 256, v = py / 256;
      const n = vn(u, v) * 0.55 + vn(u * 3.1 % 1, v * 3.1 % 1) * 0.3 + R() * 0.15;
      const i = (py * W + px) * 4;
      if (bone) {
        const b = 115 + n * 85;
        img.data[i] = b; img.data[i + 1] = b * 0.93; img.data[i + 2] = b * 0.84;
      } else {
        const b = 70 + n * 120;
        img.data[i] = b; img.data[i + 1] = b * 0.96; img.data[i + 2] = b * 0.93;
      }
      img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  // Ember cracks on the hide: branching random walks, dark on the colour map,
  // hot on the emissive map.
  const cracks = [];
  const walk = (px, py, ang, steps, w) => {
    const pts = [[px, py]];
    for (let s = 0; s < steps; s++) {
      ang += (R() - 0.5) * 1.1;
      px += Math.cos(ang) * (5 + R() * 7); py += Math.sin(ang) * (5 + R() * 7);
      px = Math.max(2, Math.min(252, px)); py = Math.max(2, Math.min(252, py));
      pts.push([px, py]);
      if (R() < 0.12 && w > 1) walk(px, py, ang + (R() < 0.5 ? 1 : -1) * (0.7 + R() * 0.6), steps >> 1, w * 0.6);
    }
    cracks.push({ pts, w });
  };
  for (let i = 0; i < 11; i++) walk(R() * 256, R() * 256, R() * TAU, 7 + Math.floor(R() * 12), 0.9 + R() * 1.1);
  const stroke = (ctx, style, wMul, blur = 0) => {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = style; ctx.shadowColor = style; ctx.shadowBlur = blur;
    for (const c of cracks) {
      ctx.lineWidth = c.w * wMul;
      ctx.beginPath();
      c.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
    ctx.restore();
  };
  stroke(x, 'rgba(8,5,4,0.95)', 3.2);
  stroke(x, 'rgba(150,55,18,0.9)', 0.9);
  stroke(e, 'rgb(110,26,4)', 2.6, 5);
  stroke(e, 'rgb(255,105,22)', 1.0, 2);
  stroke(e, 'rgb(255,200,110)', 0.3);
  // A few smouldering patches.
  for (let i = 0; i < 7; i++) {
    const px = R() * 256, py = R() * 256, r = 4 + R() * 8;
    const g = e.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(230,80,15,0.35)'); g.addColorStop(1, 'rgba(120,20,0,0)');
    e.fillStyle = g; e.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // Scorch pits and hairline cracks on the bone half.
  x.save();
  x.beginPath(); x.rect(256, 0, 256, 256); x.clip();
  for (let i = 0; i < 70; i++) {
    const px = 256 + R() * 256, py = R() * 256, r = 1 + R() * 5;
    x.fillStyle = `rgba(30,22,16,${0.25 + R() * 0.4})`;
    x.beginPath(); x.ellipse(px, py, r * 1.6, r, R() * 3, 0, TAU); x.fill();
  }
  x.strokeStyle = 'rgba(25,18,12,0.6)'; x.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    let px = 256 + R() * 256, py = R() * 256, a = R() * TAU;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 6; s++) { a += (R() - 0.5); px += Math.cos(a) * 6; py += Math.sin(a) * 6; x.lineTo(px, py); }
    x.stroke();
  }
  x.restore();
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  ATLAS = { map: tex(cc), emissive: tex(ce) };
  return ATLAS;
}

// --- Renderer -------------------------------------------------------------------------
export class Hounds {
  constructor(scene, tex) {
    this.scene = scene;
    this.tex = tex;
    this.n = 0;
    const atlas = makeAtlas();
    this.material = new THREE.MeshLambertMaterial({
      map: atlas.map, vertexColors: true,
      emissive: new THREE.Color(1, 0.45, 0.14), emissiveMap: atlas.emissive, emissiveIntensity: 1.25,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.9, 1.05, 0.6) });

    const P = partGeo, F = FLESH, B = BONE;
    const spikes = (zs, y, h, tilt = -0.65) => zs.map((z, i) => ({
      t: 'cone', d: [0.017, h * (0.8 + 0.4 * hash1(i * 3.3 + z * 10)), 4], p: [0, y, z], r: [tilt, 0, 0], m: B, c: COL.boneDk,
    }));
    const claws = (y, z) => [-0.022, -0.008, 0.008, 0.022].map((x) => ({
      t: 'cone', d: [0.006, 0.036, 4], p: [x, y, z], r: [1.95, 0, 0], m: B, c: COL.claw, lump: 0,
    }));
    const ribs = [];
    const ribR = [0.114, 0.127, 0.132, 0.128, 0.117, 0.102];
    for (let i = 0; i < 6; i++) {
      ribs.push({ t: 'tor', d: [ribR[i], 0.012, 4, 14], p: [0, -0.1, 0.13 - i * 0.052], r: [0.28, 0, 0], s: [0.8, 1, 1], m: B, c: i % 2 ? COL.bone : COL.boneDk });
    }
    const tailPts = [[0, 0, 0], [0, 0.02, -0.1], [0, 0.005, -0.2], [0, -0.04, -0.3], [0, -0.11, -0.385], [0, -0.2, -0.44]];
    const tailR = [0.022, 0.017, 0.013, 0.01, 0.0075, 0.005];
    const tail = [];
    for (let i = 0; i < tailPts.length - 1; i++) tail.push({ t: 'seg', a: tailPts[i], b: tailPts[i + 1], d: [tailR[i], tailR[i + 1], 6], m: F, lump: 0.002 });
    tail.push({ t: 'seg', a: [0, -0.2, -0.44], b: [0, -0.27, -0.47], d: [0.018, 0.001, 4], m: B, c: COL.boneDk, lump: 0 });

    const defs = {
      torso: P([
        { t: 'sph', d: [0.17, 12, 7, Math.PI * 0.56], p: [0, -0.06, -0.01], s: [0.82, 0.9, 1.3], m: F },
        ...ribs,
        { t: 'box', d: [0.032, 0.024, 0.28], p: [0, -0.228, 0.02], r: [-0.1, 0, 0], m: B },
        { t: 'sph', d: [0.085, 10, 7], p: [0, -0.11, 0.17], s: [0.95, 1.3, 0.8], m: F },
        { t: 'sph', d: [0.08, 8, 6], p: [0.09, -0.03, 0.085], r: [0.3, 0, 0.1], s: [0.45, 1.3, 1], m: F },
        { t: 'sph', d: [0.08, 8, 6], p: [-0.09, -0.03, 0.085], r: [0.3, 0, -0.1], s: [0.45, 1.3, 1], m: F },
        ...spikes([0.16, 0.1, 0.04, -0.02, -0.08, -0.14], 0.085, 0.08),
      ]),
      hind: P([
        { t: 'cyl', d: [0.066, 0.078, 0.27, 9], p: [0, -0.01, 0.075], r: [Math.PI / 2, 0, 0], s: [0.9, 1, 1.25], m: F },
        { t: 'sph', d: [0.108, 11, 8], p: [0, -0.01, -0.13], s: [0.85, 0.92, 1.12], m: F },
        { t: 'sph', d: [0.028, 6, 5], p: [0.066, 0.06, -0.07], m: B },
        { t: 'sph', d: [0.028, 6, 5], p: [-0.066, 0.06, -0.07], m: B },
        { t: 'sph', d: [0.03, 6, 5], p: [0, 0.04, -0.23], s: [1, 0.8, 1.3], m: B, c: COL.boneDk },
        { t: 'box', d: [0.026, 0.02, 0.26], p: [0, 0.058, 0.08], m: B, c: COL.boneDk },
        ...spikes([0.19, 0.13, 0.07, 0.01, -0.05, -0.11, -0.17], 0.07, 0.055, -0.8),
      ]),
      neck: P([
        { t: 'cyl', d: [0.056, 0.088, 0.26, 9], p: [0, 0, 0.1], r: [Math.PI / 2, 0, 0], s: [1, 1, 1.18], m: F },
        { t: 'box', d: [0.022, 0.02, 0.22], p: [0, 0.064, 0.1], m: B, c: COL.boneDk },
        ...spikes([0.0, 0.06, 0.12, 0.17], 0.07, 0.06, -0.9),
        { t: 'cyl', d: [0.012, 0.016, 0.2, 5], p: [0, -0.05, 0.11], r: [Math.PI / 2 + 0.1, 0, 0], m: B, c: COL.boneDk },
      ]),
      head: P([
        { t: 'sph', d: [0.07, 12, 8], p: [0, 0.025, 0.02], s: [0.95, 0.85, 1.2], m: F },
        { t: 'cyl', d: [0.026, 0.048, 0.2, 9], p: [0, 0.0, 0.15], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.78], m: F },
        { t: 'box', d: [0.016, 0.012, 0.15], p: [0, 0.03, 0.14], r: [0.13, 0, 0], m: B, c: COL.boneDk },
        { t: 'sph', d: [0.02, 7, 5], p: [0, 0.006, 0.25], s: [1.15, 0.8, 0.9], m: F, c: COL.socket, lump: 0 },
        { t: 'box', d: [0.04, 0.014, 0.04], p: [0.035, 0.06, 0.078], r: [0.2, 0, -0.45], m: F },
        { t: 'box', d: [0.04, 0.014, 0.04], p: [-0.035, 0.06, 0.078], r: [0.2, 0, 0.45], m: F },
        { t: 'sph', d: [0.022, 7, 5], p: [0.042, 0.036, 0.086], s: [1.25, 0.8, 1], m: F, c: COL.socket, lump: 0 },
        { t: 'sph', d: [0.022, 7, 5], p: [-0.042, 0.036, 0.086], s: [1.25, 0.8, 1], m: F, c: COL.socket, lump: 0 },
        { t: 'sph', d: [0.022, 6, 5], p: [0.052, 0.0, 0.07], s: [0.7, 0.7, 1.7], m: B },
        { t: 'sph', d: [0.022, 6, 5], p: [-0.052, 0.0, 0.07], s: [0.7, 0.7, 1.7], m: B },
        { t: 'cone', d: [0.028, 0.12, 5], p: [0.046, 0.1, -0.02], r: [-0.6, 0, -0.35], s: [1, 1, 0.55], m: F },
        { t: 'cone', d: [0.028, 0.12, 5], p: [-0.046, 0.1, -0.02], r: [-0.6, 0, 0.35], s: [1, 1, 0.55], m: F },
        { t: 'box', d: [0.07, 0.012, 0.19], p: [0, -0.02, 0.135], m: F, c: COL.gum, lump: 0.001 },
        { t: 'cone', d: [0.009, 0.05, 4], p: [0.022, -0.042, 0.205], r: [Math.PI, 0, 0], m: B, c: COL.tooth, lump: 0 },
        { t: 'cone', d: [0.009, 0.05, 4], p: [-0.022, -0.042, 0.205], r: [Math.PI, 0, 0], m: B, c: COL.tooth, lump: 0 },
        ...[0.17, 0.135, 0.1, 0.07].flatMap((z) => [1, -1].map((sx) => ({
          t: 'cone', d: [0.0055, 0.024, 4], p: [sx * 0.03, -0.031, z], r: [Math.PI, 0, 0], m: B, c: COL.tooth, lump: 0,
        }))),
      ]),
      jaw: P([
        { t: 'cyl', d: [0.02, 0.036, 0.22, 8], p: [0, -0.018, 0.11], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.5], m: F },
        { t: 'box', d: [0.026, 0.008, 0.17], p: [0, -0.033, 0.12], m: B, c: COL.boneDk, lump: 0.001 },
        { t: 'sph', d: [0.03, 7, 5], p: [0.035, -0.012, 0.02], s: [0.8, 1, 1.3], m: F },
        { t: 'sph', d: [0.03, 7, 5], p: [-0.035, -0.012, 0.02], s: [0.8, 1, 1.3], m: F },
        { t: 'cone', d: [0.008, 0.042, 4], p: [0.017, -0.0, 0.195], m: B, c: COL.tooth, lump: 0 },
        { t: 'cone', d: [0.008, 0.042, 4], p: [-0.017, -0.0, 0.195], m: B, c: COL.tooth, lump: 0 },
        ...[0.155, 0.12, 0.085].flatMap((z) => [1, -1].map((sx) => ({
          t: 'cone', d: [0.005, 0.02, 4], p: [sx * 0.022, -0.008, z], m: B, c: COL.tooth, lump: 0,
        }))),
      ]),
      foreUpper: P([
        { t: 'sph', d: [0.066, 9, 7], p: [0, -0.06, 0], s: [0.74, 1.45, 1.1], m: F },
        { t: 'cyl', d: [0.033, 0.026, 0.24, 7], p: [0, -0.17, 0], m: F },
        { t: 'sph', d: [0.024, 6, 5], p: [0, -0.29, -0.018], m: B },
      ]),
      foreLower: P([
        { t: 'cyl', d: [0.021, 0.016, 0.24, 6], p: [0, -0.13, 0], m: B, c: COL.boneDk },
        { t: 'cyl', d: [0.013, 0.009, 0.2, 5], p: [0, -0.12, -0.016], m: F },
        { t: 'sph', d: [0.02, 6, 5], p: [0, -0.255, 0], m: B },
        { t: 'sph', d: [0.036, 8, 6], p: [0, -0.29, 0.018], s: [0.95, 0.5, 1.3], m: F },
        ...claws(-0.3, 0.062),
      ]),
      hindThigh: P([
        { t: 'sph', d: [0.086, 10, 8], p: [0, -0.1, 0], s: [0.72, 1.55, 1.12], m: F },
        { t: 'cyl', d: [0.03, 0.024, 0.12, 7], p: [0, -0.2, 0], m: F },
        { t: 'sph', d: [0.024, 6, 5], p: [0, -0.255, 0.012], m: B },
      ]),
      hindShin: P([
        { t: 'cyl', d: [0.024, 0.017, 0.24, 6], p: [0, -0.12, 0], m: B, c: COL.boneDk },
        { t: 'sph', d: [0.032, 8, 6], p: [0, -0.075, -0.016], s: [0.7, 1.8, 0.9], m: F },
        { t: 'sph', d: [0.02, 6, 5], p: [0, -0.24, -0.008], m: B },
        { t: 'cone', d: [0.01, 0.04, 4], p: [0, -0.235, -0.03], r: [-2.0, 0, 0], m: B, c: COL.boneDk, lump: 0 },
      ]),
      hindFoot: P([
        { t: 'cyl', d: [0.018, 0.015, 0.14, 6], p: [0, -0.075, 0], m: B, c: COL.boneDk },
        { t: 'sph', d: [0.033, 8, 6], p: [0, -0.155, 0.018], s: [0.95, 0.5, 1.3], m: F },
        ...claws(-0.163, 0.056),
      ]),
      tail: P(tail),
      headGlow: glowGeo([
        { t: 'sph', d: [0.012, 8, 6], p: [0.043, 0.037, 0.105], r: [0, 0, -0.35], s: [1.5, 0.6, 0.7], c: COL.eye },
        { t: 'sph', d: [0.012, 8, 6], p: [-0.043, 0.037, 0.105], r: [0, 0, 0.35], s: [1.5, 0.6, 0.7], c: COL.eye },
        { t: 'sph', d: [0.03, 8, 6], p: [0, -0.03, 0.1], s: [0.85, 0.42, 2.6], c: COL.core },
        { t: 'sph', d: [0.007, 5, 4], p: [0.008, 0.006, 0.264], c: COL.hot },
        { t: 'sph', d: [0.007, 5, 4], p: [-0.008, 0.006, 0.264], c: COL.hot },
      ]),
      chestGlow: glowGeo([
        { t: 'sph', d: [0.11, 12, 8], p: [0, -0.11, 0.0], s: [0.72, 0.95, 1.42], c: COL.core },
        { t: 'sph', d: [0.055, 8, 6], p: [0, -0.13, 0.05], s: [0.8, 1, 1.2], c: COL.hot },
      ]),
    };

    const HS = 1.14;
    defs.head.scale(HS, HS, HS); defs.jaw.scale(HS, HS, HS); defs.headGlow.scale(HS, HS, HS);

    // Template rig (metres; facing +Z; feet on y = 0).
    const J = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; };
    const root = new THREE.Object3D();
    const body = J('body', root, 0, 0, 0);
    const spine = J('spine', body, 0, 0.64, -0.04);
    const fore = J('fore', spine, 0, 0.02, 0.2);
    const hind = J('hind', spine, 0, 0, -0.2);
    const neck = J('neck', fore, 0, 0.05, 0.17);
    const head = J('head', neck, 0, 0, 0.22);
    const jaw = J('jaw', head, 0, -0.02 * HS, 0.0);
    const shL = J('shL', fore, 0.095, -0.05, 0.07), shR = J('shR', fore, -0.095, -0.05, 0.07);
    const elL = J('elL', shL, 0, -0.3, 0), elR = J('elR', shR, 0, -0.3, 0);
    const hipL = J('hipL', hind, 0.09, -0.02, -0.13), hipR = J('hipR', hind, -0.09, -0.02, -0.13);
    const stL = J('stL', hipL, 0, -0.26, 0), stR = J('stR', hipR, 0, -0.26, 0);
    const hkL = J('hkL', stL, 0, -0.24, 0), hkR = J('hkR', stR, 0, -0.24, 0);
    const tailJ = J('tail', hind, 0, 0.035, -0.24);
    this.J = { root, body, spine, fore, hind, neck, head, jaw, shL, shR, elL, elR, hipL, hipR, stL, stR, hkL, hkR, tail: tailJ };

    const parts = [
      ['torso', [fore]], ['hind', [hind]], ['neck', [neck]], ['head', [head]], ['jaw', [jaw]],
      ['foreUpper', [shL, shR]], ['foreLower', [elL, elR]],
      ['hindThigh', [hipL, hipR]], ['hindShin', [stL, stR]], ['hindFoot', [hkL, hkR]],
      ['tail', [tailJ]], ['headGlow', [head]], ['chestGlow', [fore]],
    ];
    this.parts = parts.map(([name, joints]) => {
      const glow = name.endsWith('Glow');
      const n = CAP * joints.length;
      const im = new THREE.InstancedMesh(defs[name], glow ? this.glowMaterial : this.material, n);
      im.name = `hound-${name}`;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      return { im, joints, glow, breathe: name === 'torso' || name === 'chestGlow' };
    });
    this._m = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._c = new THREE.Color();
    this._g = new THREE.Color();
  }

  begin() { this.n = 0; }

  end() {
    for (const p of this.parts) {
      p.im.count = this.n * p.joints.length;
      p.im.instanceMatrix.needsUpdate = true;
      p.im.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0;
    for (const p of this.parts) p.im.count = 0;
  }

  // Pose and write one hound (live or dying).
  draw(d, dt, time) {
    if (this.n >= CAP) return;
    if (d.killed && (d.deadT ?? 0) > DEATH_T) return;
    let k = d._hk;
    if (!k) {
      const R = rng((d.seed ?? d.id ?? 1) * 7919 + 13);
      k = d._hk = {
        size: 0.94 + R() * 0.12, tint: 0.85 + R() * 0.3, ember: [1, 0.78 + R() * 0.3, 0.7 + R() * 0.45],
        off: R() * 50, lean: (R() - 0.5) * 0.12,
      };
      if (!Number.isFinite(d.phase)) d.phase = R() * TAU;
    }
    const vis = this.pose(d, k, Math.min(0.1, Math.max(0, dt || 0)), time);
    if (vis.scale <= 0.001) return;
    this.write(d, this.n++, vis);
  }

  rest() {
    const J = this.J;
    J.body.position.set(0, 0, 0); J.body.rotation.set(0, 0, 0);
    J.spine.rotation.set(0, 0, 0); J.fore.rotation.set(0, 0, 0); J.hind.rotation.set(0, 0, 0);
    J.neck.rotation.set(-0.55, 0, 0); J.head.rotation.set(0.55, 0, 0); J.jaw.rotation.set(0.04, 0, 0);
    J.shL.rotation.set(0.12, 0, 0); J.shR.rotation.set(0.12, 0, 0);
    J.elL.rotation.set(-0.12, 0, 0); J.elR.rotation.set(-0.12, 0, 0);
    J.hipL.rotation.set(-0.35, 0, 0); J.hipR.rotation.set(-0.35, 0, 0);
    J.stL.rotation.set(0.9, 0, 0); J.stR.rotation.set(0.9, 0, 0);
    J.hkL.rotation.set(-0.55, 0, 0); J.hkR.rotation.set(-0.55, 0, 0);
    J.tail.rotation.set(-0.15, 0, 0);
  }

  // sw: -1 (reaching forward) .. +1 (pushed back); lift: 0..1 while the paw is in the air.
  front(sh, el, sw, lift, amp) {
    sh.rotation.x = 0.12 + sw * amp;
    el.rotation.x = -0.12 + lift * 1.7 - Math.max(0, -sw) * 0.25 * amp;
  }

  back(hip, st, hk, sw, lift, amp) {
    hip.rotation.x = -0.35 + sw * amp;
    st.rotation.x = 0.9 + lift * 0.75 + Math.max(0, sw) * 0.15;
    hk.rotation.x = -0.55 - lift * 0.95 + Math.max(0, sw) * 0.35;
  }

  // Returns { scale, tint, glow, roll }.
  pose(d, k, dt, time) {
    const J = this.J;
    this.rest();
    const t = time + k.off;
    const sp = d.speed || 0;
    const out = { scale: k.size, tint: k.tint, glow: 1, roll: 0 };
    this.breathe = 1;

    if (d.killed) return this.poseDead(d, k, out);

    if (d.state === ZS.WARP) {
      const u = Math.min(1, (d.stateT || 0) / WARP_T);
      const down = 1 - smooth(0.25, 0.95, u);
      J.body.position.y = -0.33 * down;
      this.front(J.shL, J.elL, 0, 0, 0); this.front(J.shR, J.elR, 0, 0, 0);
      J.shL.rotation.x += 0.95 * down; J.shR.rotation.x += 0.95 * down;
      J.elL.rotation.x -= 1.7 * down; J.elR.rotation.x -= 1.7 * down;
      J.hipL.rotation.x -= 0.95 * down; J.hipR.rotation.x -= 0.95 * down;
      J.stL.rotation.x += 1.25 * down; J.stR.rotation.x += 1.25 * down;
      J.hkL.rotation.x -= 0.55 * down; J.hkR.rotation.x -= 0.55 * down;
      J.hind.rotation.x = -0.2 * down;
      J.neck.rotation.x = -0.55 + 0.75 * down - 0.25 * Math.sin(Math.PI * u);
      J.head.rotation.x = 0.55 + 0.1 * down;
      J.jaw.rotation.x = 0.05 + 0.55 * Math.sin(Math.PI * smooth(0.45, 1, u));
      J.tail.rotation.x = -0.5 * down;
      J.body.rotation.z = Math.sin(t * 37) * 0.05 * down;
      // Materialise out of nothing: grow, with a hard flicker while unstable.
      let s = 0.04 + 0.96 * smooth(0, 0.62, u);
      const fl = hash1(Math.floor(time * 26) + (d.seed || 0) * 13.1);
      if (u < 0.8 && fl < 0.45 * (1 - u / 0.8)) s *= 0.35 + fl;
      out.scale *= s;
      out.tint *= 0.45 + 0.55 * u;
      out.glow = 1.9 - 0.9 * u;
      return out;
    }

    if (d.state === ZS.ATTACK) {
      const u = Math.min(1, (d.stateT || 0) / ATTACK_T);
      if (u < 0.25) {
        // Gather: crouch onto the haunches, head down, lips peeling back.
        const c = smooth(0, 0.25, u);
        J.body.position.y = -0.1 * c;
        J.body.rotation.x = 0.06 * c;
        this.front(J.shL, J.elL, -0.2 * c, 0, 0.6); this.front(J.shR, J.elR, -0.1 * c, 0, 0.6);
        this.back(J.hipL, J.stL, J.hkL, -0.6 * c, 0.4 * c, 0.7); this.back(J.hipR, J.stR, J.hkR, -0.5 * c, 0.4 * c, 0.7);
        J.hind.rotation.x = -0.18 * c;
        J.neck.rotation.x = -0.3 + 0.25 * c; J.head.rotation.x = 0.4;
        J.jaw.rotation.x = 0.1 + 0.35 * c;
        J.tail.rotation.x = -0.1;
      } else if (u < 0.72) {
        // Launch: fly forward, forelegs reaching, jaws wide.
        const l = (u - 0.25) / 0.47;
        const e = smooth(0, 1, l);
        J.body.position.y = -0.1 + 0.4 * Math.sin(Math.PI * l);
        J.body.position.z = 0.5 * e;
        J.body.rotation.x = -0.32 * Math.sin(Math.PI * l);
        this.front(J.shL, J.elL, -1.4 * e, 0, 1); this.front(J.shR, J.elR, -1.3 * e, 0, 1);
        J.elL.rotation.x -= 0.3 * e; J.elR.rotation.x -= 0.25 * e;
        this.back(J.hipL, J.stL, J.hkL, 1.1 * e, 0, 0.8); this.back(J.hipR, J.stR, J.hkR, 1.0 * e, 0, 0.8);
        J.hind.rotation.x = 0.15 * e;
        J.neck.rotation.x = -0.05 - 0.2 * e; J.head.rotation.x = 0.35 - 0.15 * e;
        J.jaw.rotation.x = 0.45 + 0.6 * smooth(0, 0.6, l);
        J.tail.rotation.x = 0.35 * e;
      } else {
        // Snap shut and land, shaking the bite.
        const s = (u - 0.72) / 0.28;
        const r = smooth(0, 1, s);
        J.body.position.z = 0.5 * (1 - r);
        J.body.position.y = -0.06 * Math.sin(Math.PI * s);
        J.body.rotation.x = 0.1 * Math.sin(Math.PI * s);
        this.front(J.shL, J.elL, lerp(-1.4, -0.3, r), 0, 1); this.front(J.shR, J.elR, lerp(-1.3, -0.2, r), 0, 1);
        this.back(J.hipL, J.stL, J.hkL, lerp(1.1, 0.2, r), 0, 0.8); this.back(J.hipR, J.stR, J.hkR, lerp(1.0, 0.1, r), 0, 0.8);
        J.neck.rotation.x = -0.25 + 0.1 * r;
        J.neck.rotation.y = Math.sin(s * 42) * 0.16 * (1 - s);
        J.head.rotation.z = Math.sin(s * 42 + 1) * 0.22 * (1 - s);
        J.head.rotation.x = 0.25;
        J.jaw.rotation.x = 1.05 * (1 - smooth(0, 0.3, s)) + 0.02;
        J.tail.rotation.x = 0.2;
      }
      out.glow = 1 + 0.5 * Math.sin(Math.PI * u);
      return out;
    }

    // Locomotion.
    if (sp >= 2.5) {
      // Rotary gallop: LH, RH, RF, LF with a gathered suspension; spine flexes.
      const f = 1.55 + sp * 0.16;
      d.phase += dt * TAU * f;
      const p = d.phase / TAU;
      const a = Math.min(1, 0.55 + sp * 0.07);
      const duty = 0.3;
      const hl = cycle(p, duty), hr = cycle(p + 0.9, duty), fr = cycle(p + 0.52, duty), fl = cycle(p + 0.42, duty);
      this.front(J.shL, J.elL, fl[0], fl[1], 0.82 * a); this.front(J.shR, J.elR, fr[0], fr[1], 0.82 * a);
      this.back(J.hipL, J.stL, J.hkL, hl[0], hl[1], 0.72 * a); this.back(J.hipR, J.stR, J.hkR, hr[0], hr[1], 0.72 * a);
      const gather = -(hl[0] + hr[0]) * 0.5;
      J.hind.rotation.x = -0.26 * gather * a;
      J.fore.rotation.x = 0.1 * gather * a;
      const w = TAU * p;
      J.body.position.y = -0.035 + 0.055 * a * Math.max(0, Math.sin(w + 0.9));
      J.body.rotation.x = 0.09 * a * Math.sin(w + 2.3);
      J.body.rotation.z = k.lean * 0.3;
      J.neck.rotation.x = -0.06 + 0.1 * a * Math.sin(w + 0.6);
      J.head.rotation.x = 0.26 - 0.06 * Math.sin(w + 0.6);
      J.jaw.rotation.x = 0.2 + 0.12 * Math.max(0, Math.sin(w * 1 + 1.2));
      J.tail.rotation.x = 0.28 + 0.12 * Math.sin(w + 1.5);
      J.tail.rotation.y = 0.18 * Math.sin(w * 0.5 + t);
      out.glow = 1.05 + 0.15 * Math.sin(w);
    } else if (sp >= 0.35) {
      // Trot: diagonal pairs, low head, stalking.
      const f = 1.1 + sp * 0.55;
      d.phase += dt * TAU * f;
      const p = d.phase / TAU;
      const a = Math.min(1, 0.45 + sp * 0.28);
      const duty = 0.55;
      const A = cycle(p, duty), Bc = cycle(p + 0.5, duty);
      const hA = cycle(p + 0.04, duty), hB = cycle(p + 0.54, duty);
      this.front(J.shL, J.elL, A[0], A[1], 0.45 * a); this.back(J.hipR, J.stR, J.hkR, hA[0], hA[1], 0.42 * a);
      this.front(J.shR, J.elR, Bc[0], Bc[1], 0.45 * a); this.back(J.hipL, J.stL, J.hkL, hB[0], hB[1], 0.42 * a);
      const w = TAU * p;
      J.body.position.y = -0.02 + 0.018 * Math.abs(Math.sin(w));
      J.body.rotation.z = 0.025 * Math.sin(w);
      J.neck.rotation.x = -0.28 + 0.05 * Math.sin(w * 2);
      J.head.rotation.x = 0.5;
      J.head.rotation.y = 0.12 * Math.sin(t * 0.9);
      J.jaw.rotation.x = 0.1 + 0.1 * Math.max(0, Math.sin(t * 2.3)) ** 3;
      J.tail.rotation.x = -0.05 + 0.05 * Math.sin(w * 2);
      J.tail.rotation.y = 0.3 * Math.sin(w);
    } else {
      // Standing: hackles up, head low, snarl-breathing.
      const br = Math.sin(t * 3.4);
      this.breathe = 1 + 0.035 * br;
      J.body.position.y = -0.04 + 0.006 * br;
      J.shL.rotation.z = 0.08; J.shR.rotation.z = -0.08;
      J.hipL.rotation.z = 0.05; J.hipR.rotation.z = -0.05;
      this.back(J.hipL, J.stL, J.hkL, -0.12, 0.12, 1); this.back(J.hipR, J.stR, J.hkR, -0.1, 0.12, 1);
      J.hind.rotation.x = -0.08;
      J.neck.rotation.x = -0.18 + 0.03 * br;
      J.head.rotation.x = 0.55;
      J.head.rotation.y = 0.2 * Math.sin(t * 0.7) + 0.05 * Math.sin(t * 5.3);
      const snarl = Math.max(0, Math.sin(t * 1.6)) ** 2;
      J.jaw.rotation.x = 0.04 + 0.24 * snarl + 0.03 * Math.sin(t * 31) * snarl;
      J.tail.rotation.x = -0.35 + 0.05 * Math.sin(t * 2);
      J.tail.rotation.y = 0.12 * Math.sin(t * 1.3);
      out.glow = 0.9 + 0.2 * (0.5 + 0.5 * br);
    }
    return out;
  }

  // Burst into flames: legs buckle, the body slumps, chars black and burns away.
  poseDead(d, k, out) {
    const J = this.J;
    const t = d.deadT || 0;
    const e = smooth(0, 0.42, t);
    J.body.position.y = -0.42 * e;
    J.shL.rotation.set(0.12 - 0.6 * e, 0, 0.9 * e); J.shR.rotation.set(0.12 - 0.5 * e, 0, -0.9 * e);
    J.elL.rotation.set(-0.12 + 1.2 * e, 0, 0); J.elR.rotation.set(-0.12 + 1.0 * e, 0, 0);
    J.hipL.rotation.set(-0.35 - 0.6 * e, 0, 0.8 * e); J.hipR.rotation.set(-0.35 - 0.5 * e, 0, -0.8 * e);
    J.stL.rotation.x = 0.9 + 1.0 * e; J.stR.rotation.x = 0.9 + 1.0 * e;
    J.hkL.rotation.x = -0.55 - 0.6 * e; J.hkR.rotation.x = -0.55 - 0.6 * e;
    J.neck.rotation.set(-0.55 + 0.9 * e, 0.3 * e, 0);
    J.head.rotation.set(0.55 + 0.2 * e, 0, 0.3 * e);
    J.jaw.rotation.x = 0.5 * Math.sin(Math.PI * Math.min(1, t / 0.5));
    J.hind.rotation.x = -0.15 * e;
    J.tail.rotation.set(-0.6 * e, 0.4 * e, 0);
    // Crumble to ash: shrink with a little jitter.
    const sh = 1 - smooth(0.28, DEATH_T, t);
    out.scale *= sh * (1 + 0.04 * Math.sin(t * 60));
    out.tint *= lerp(1, 0.12, smooth(0, 0.35, t));
    out.glow = t < 0.12 ? 1 + t * 12 : Math.max(0, 2.4 * (1 - smooth(0.12, 0.65, t)));
    out.roll = 0.5 * e;
    return out;
  }

  write(d, i, vis) {
    const J = this.J;
    this._qy.setFromAxisAngle(_up, d.yaw || 0);
    if (vis.roll) {
      const a = d.fallDir ?? (d.yaw || 0) + Math.PI / 2;
      this._axis.set(Math.cos(a), 0, -Math.sin(a));
      this._q.setFromAxisAngle(this._axis, vis.roll).multiply(this._qy);
      J.root.quaternion.copy(this._q);
    } else J.root.quaternion.copy(this._qy);
    J.root.position.set(d.x, d.y, d.z);
    J.root.scale.setScalar(vis.scale);
    J.root.updateMatrixWorld(true);
    const k = d._hk;
    this._c.setScalar(vis.tint);
    const gl = Math.max(0, vis.glow);
    this._g.setRGB(k.ember[0] * gl, k.ember[1] * gl, k.ember[2] * gl);
    const br = this.breathe;
    if (br !== 1) this._s.makeScale(1 + (br - 1) * 0.6, br, 1 + (br - 1) * 0.3);
    for (const p of this.parts) {
      const nj = p.joints.length;
      for (let j = 0; j < nj; j++) {
        let m = p.joints[j].matrixWorld;
        if (p.breathe && br !== 1) m = this._m.multiplyMatrices(m, this._s);
        p.im.setMatrixAt(i * nj + j, m);
        p.im.setColorAt(i * nj + j, p.glow ? this._g : this._c);
      }
    }
  }
}

// Leg cycle: stance (duty fraction) sweeps the paw back along the ground;
// swing brings it forward in the air. Returns [sw, lift].
function cycle(p, duty) {
  p -= Math.floor(p);
  if (p < duty) return [-1 + 2 * (p / duty), 0];
  const u = (p - duty) / (1 - duty);
  return [1 - 2 * (0.5 - 0.5 * Math.cos(Math.PI * u)), Math.sin(Math.PI * u)];
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
