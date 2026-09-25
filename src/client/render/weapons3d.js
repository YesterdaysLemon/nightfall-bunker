// Procedural low-poly first-person models: weapons, knife, grenade, hands and
// power-ups. Built from primitives, then merged per material so each model is
// a handful of draw calls (one per material for static geometry, plus one per
// material inside each animated part).
//
// Weapon conventions (meters): origin = trigger-hand / pistol-grip position,
// barrel toward -Z, +Y up, centred on X = 0.
//   userData.muzzle / sight / leftHand : Object3D anchors (direct children)
//   userData.parts : { mag, bolt, pump, slide, barrels } animated sub-groups
//                    (each carries userData.restPosition / restRotation)
//   userData.length : overall length in meters

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from '../../shared/weapons.js';

const PI = Math.PI;
const HALF = PI / 2;
const TAU = PI * 2;

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

let MATS = null;

function mats() {
  if (MATS) return MATS;
  const std = (name, chalk, color, roughness, metalness, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    m.userData.chalk = chalk;
    return m;
  };
  const lam = (name, chalk, params) => {
    const m = new THREE.MeshLambertMaterial(params);
    m.name = name;
    m.userData.chalk = chalk;
    return m;
  };
  const basic = (name, chalk, params) => {
    const m = new THREE.MeshBasicMaterial(params);
    m.name = name;
    m.userData.chalk = chalk;
    return m;
  };
  MATS = {
    steel: std('bluedSteel', 'metal', 0x353a42, 0.42, 0.55),
    worn: std('wornSteel', 'metal', 0x74767a, 0.46, 0.6),
    wood: std('walnut', 'wood', 0x58311b, 0.55, 0.0),
    woodLight: std('lightWood', 'wood', 0x94643a, 0.65, 0.0),
    bakelite: std('bakelite', 'dark', 0x2a1c15, 0.42, 0.0),
    olive: std('olivePaint', 'metal', 0x4d5428, 0.7, 0.15),
    oliveDS: std('olivePaintDS', 'metal', 0x4d5428, 0.7, 0.15, { side: THREE.DoubleSide }),
    brass: std('brass', 'metal', 0xb08a38, 0.32, 0.75),
    copper: std('copper', 'metal', 0xa4582c, 0.36, 0.7),
    black: std('blackHole', 'hole', 0x060606, 0.9, 0.0),
    glass: std('glass', 'glass', 0xa8fff0, 0.08, 0.1, {
      transparent: true, opacity: 0.32, emissive: 0x1f7a66, emissiveIntensity: 0.7, depthWrite: false,
    }),
    glow: basic('glow', 'glow', { color: 0x74ffd8 }),
    glowSoft: basic('glowSoft', 'glow', {
      color: 0x3de8b8, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    // hands
    skin: lam('handSkin', 'skin', { color: 0xc1906f }),
    sleeve: lam('sleeveOD', 'cloth', { color: 0x4b5030 }),
    cuff: lam('sleeveCuff', 'cloth', { color: 0x5b6039 }),
    // power-ups
    pBody: lam('powerBody', 'glow', { color: 0xb9cc52, emissive: 0x6f8f16, emissiveIntensity: 1.0 }),
    pGold: lam('powerGold', 'glow', { color: 0xe6c85a, emissive: 0x9a7c12, emissiveIntensity: 1.0 }),
    pBright: basic('powerBright', 'glow', { color: 0xeeffa0 }),
    pDark: basic('powerDark', 'dark', { color: 0x141b08 }),
  };
  return MATS;
}

// ---------------------------------------------------------------------------
// Cached primitive geometry
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
const G = {
  box: (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, seg = 10, open = false) =>
    cached(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  tor: (R, r, arc = TAU, rs = 6, ts = 12) =>
    cached(`t${R},${r},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
  sph: (r, ws = 10, hs = 8) => cached(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
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

  bx(mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(G.box(w, h, d), mat, x, y, z, rx, ry, rz);
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
   * u = -z (forward positive) and v = y. Centred on x.
   */
  ext(mat, shape, depth, x = 0, bevel = 0.003, curveSegments = 4) {
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

const KEEP_ATTRS = new Set(['position', 'normal', 'uv']);

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

function bake(items) {
  const byMat = new Map();
  for (const { geom, mat, m } of items) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.has(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  }
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
  for (const [name, p] of B.parts) {
    parts.push({ name, pos: p.pos.clone(), rot: p.rot.clone(), meshes: bake(p.items), userData: { ...p.userData } });
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
  B.tor(mat, R, 0.0024, PI, 0, y, z, 0, HALF, PI, 5, 10);
  B.bx(trigMat, 0.005, R * 0.95, 0.004, 0, y - R * 0.45, z + R * 0.12, 0.3);
}

/** Row(s) of dark holes on a Z-axis cylinder surface. angles: 0 = top, +x side positive. */
function perforate(B, r, y, z0, z1, n, angles, holeR, stretch = 1.6, x = 0) {
  const M = mats();
  const g = G.cyl(holeR, holeR, 0.0025, 8);
  for (const th of angles) {
    for (let i = 0; i < n; i++) {
      const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
      B.add(g, M.black, x + (r + 0.0006) * Math.sin(th), y + (r + 0.0006) * Math.cos(th), z, 0, 0, -th, 1, 1, stretch);
    }
  }
}

function frontPost(B, z, yBase, yTop, hoodR = 0) {
  const M = mats();
  B.bx(M.steel, 0.0024, yTop - yBase, 0.003, 0, (yBase + yTop) / 2, z);
  if (hoodR) B.tor(M.steel, hoodR, 0.0016, PI, 0, yBase, z, 0, 0, 0, 4, 8);
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
  B.ext(M.wood, shapeFrom([
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
  B.bx(M.wood, 0.03, 0.016, 0.23, 0, 0.053, -0.225);
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
  for (let i = 0; i < 8; i++) B.tor(M.wood, 0.021, 0.0022, TAU, 0, 0, -0.088 + i * 0.019, 0, 0, 0, 4, 12);
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
  B.ext(M.wood, shapeFrom([
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
    for (let i = 0; i < 7; i++) B.tx(M.black, 0.0068, 0.002, -0.0232, y, -0.3 - i * 0.058, 10, 1, 1.9);
  }
  B.bx(M.black, 0.002, 0.024, 0.34, 0.0232, 0.06, -0.52);
  for (let i = 0; i < 8; i++) B.cy(M.black, 0.005, 0.005, 0.002, 0, 0.0852, -0.3 - i * 0.055, 0, 0, 0, 8);
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
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  B.add(lathe, M.brass, 0, 0.065, 0.065, -HALF, 0, 0);
  for (let i = 0; i < 4; i++) B.tor(M.copper, 0.03 + i * 0.0015, 0.0026, TAU, 0, 0.065, 0.05 - i * 0.009, 0, 0, 0, 4, 16);
  B.tor(M.copper, 0.037, 0.003, TAU, 0, 0.065, -0.02, 0, 0, 0, 4, 16);
  // glass coil chamber
  B.tz(M.glass, 0.024, 0.024, -0.19, -0.095, 0, 0.065, 14);
  B.tor(M.brass, 0.025, 0.005, TAU, 0, 0.065, -0.095, 0, 0, 0, 6, 16);
  B.tor(M.brass, 0.025, 0.005, TAU, 0, 0.065, -0.19, 0, 0, 0, 6, 16);
  B.add(new THREE.TubeGeometry(new HelixCurve(0.0155, 6, -0.1, -0.185), 96, 0.0022, 5, false), M.glow, 0, 0.065, 0);
  B.tz(M.copper, 0.004, 0.004, -0.19, -0.095, 0, 0.065, 6);
  for (const s of [-1, 1]) B.tz(M.brass, 0.003, 0.003, -0.25, -0.09, s * 0.024, 0.045, 6);
  // emitter rings and prongs
  const rings = [[-0.205, 0.03], [-0.226, 0.025], [-0.245, 0.02]];
  for (const [z, R] of rings) {
    B.tor(M.copper, R, 0.0042, TAU, 0, 0.065, z, 0, 0, 0, 6, 18);
    B.tor(M.glow, R - 0.0045, 0.0014, TAU, 0, 0.065, z, 0, 0, 0, 4, 18);
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
  B.tx(M.glowSoft, 0.011, 0.002, -0.0415, 0.07, 0.02, 14);
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
  // rounded back of the hand / palm mass (hides the finger roots)
  B.sp(M.skin, 1, 0.021, 0.0, 0.017, 0.0175, 0.045, 0.041, 12, 10);
  B.sp(M.skin, 1, 0.012, -0.004, 0.028, 0.014, 0.04, 0.03, 10, 8);
  const fingers = [[0.029, 0.024, 0.0088], [0.0095, 0.025, 0.0093], [-0.0095, 0.024, 0.0089], [-0.028, 0.021, 0.0079]];
  const g0 = 0.3;
  const arc = 3.4;
  for (const [y, R, r] of fingers) {
    B.tor(M.skin, R, r, arc, 0.0, y, -0.002, -HALF, 0, g0, 6, 10);
    const a1 = g0 + arc;
    B.sp(M.skin, r * 1.02, Math.cos(a1) * R, y, -0.002 - Math.sin(a1) * R, 1, 1, 1, 8, 6);
    B.sp(M.skin, r * 1.12, Math.cos(g0) * R + 0.002, y, -0.002 - Math.sin(g0) * R, 1, 1, 1, 8, 6);
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
  B.tor(M.cuff, 0.041, 0.0065, TAU, 0.018, 0.0, 0.13, 0, 0, 0, 5, 14);
  B.tor(M.cuff, 0.043, 0.005, TAU, 0.018, 0.0, 0.175, 0, 0, 0, 5, 14);
  B.tz(M.sleeve, 0.043, 0.05, 0.175, 0.38, 0.018, 0.002, 12);
  B.tor(M.sleeve, 0.046, 0.004, TAU, 0.018, 0.001, 0.24, 0, 0, 0, 4, 14);
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
      B.add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 16), pBody);
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
}
