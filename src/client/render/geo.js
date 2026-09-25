// Geometry batching: accumulate many boxes/primitives per material into one
// BufferGeometry so the whole level renders in a handful of draw calls.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

// Face order: +x, -x, +y, -y, +z, -z
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
  }

  get empty() { return this.pos.length === 0; }

  // One quad of an axis-aligned box [x0,y0,z0,x1,y1,z1] with world-space UVs.
  // `scale` = metres per texture repeat. `shade(x,y,z,face)` returns a grey level.
  boxFace(b, f, scale = 2, shade = null, uvOff = 0) {
    const F = FACES[f];
    const base = this.pos.length / 3;
    for (const c of F.c) {
      const x = c[0] ? b[3] : b[0], y = c[1] ? b[4] : b[1], z = c[2] ? b[5] : b[2];
      this.pos.push(x, y, z);
      this.nrm.push(...F.n);
      let u, v;
      if (F.n[0]) { u = -z * F.n[0]; v = y; }
      else if (F.n[1]) { u = x; v = -z * F.n[1]; }
      else { u = x * F.n[2]; v = y; }
      this.uv.push(u / scale + uvOff, v / scale);
      const s = shade ? shade(x, y, z, f) : 1;
      this.col.push(s, s, s);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(b, scale = 2, shade = null, skip = null) {
    for (let f = 0; f < 6; f++) if (!skip || !skip(f)) this.boxFace(b, f, scale, shade);
  }

  // A box of size (sx,sy,sz) centred at the origin, transformed by matrix.
  // UVs are per-face, scaled by the face's real size so textures don't stretch.
  tbox(matrix, sx, sy, sz, color = 1, scale = 1) {
    const b = [-sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2];
    _m3.getNormalMatrix(matrix);
    const col = typeof color === 'number' ? [color, color, color] : color;
    for (const F of FACES) {
      const base = this.pos.length / 3;
      for (const c of F.c) {
        _v.set(c[0] ? b[3] : b[0], c[1] ? b[4] : b[1], c[2] ? b[5] : b[2]);
        let u, v;
        if (F.n[0]) { u = _v.z; v = _v.y; } else if (F.n[1]) { u = _v.x; v = _v.z; } else { u = _v.x; v = _v.y; }
        _v.applyMatrix4(matrix);
        this.pos.push(_v.x, _v.y, _v.z);
        _n.set(...F.n).applyMatrix3(_m3).normalize();
        this.nrm.push(_n.x, _n.y, _n.z);
        this.uv.push(u / scale + 0.5, v / scale + 0.5);
        this.col.push(col[0], col[1], col[2]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // Merge an arbitrary geometry (with position/normal/uv) transformed by matrix.
  geo(g, matrix, color = 1) {
    const src = g.index ? g : g;
    const p = src.attributes.position, n = src.attributes.normal, uv = src.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const base = this.pos.length / 3;
    const col = typeof color === 'number' ? [color, color, color] : color;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) { _n.fromBufferAttribute(n, i).applyMatrix3(_m3).normalize(); this.nrm.push(_n.x, _n.y, _n.z); } else this.nrm.push(0, 1, 0);
      if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
      this.col.push(col[0], col[1], col[2]);
    }
    if (src.index) for (let i = 0; i < src.index.count; i++) this.idx.push(base + src.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Builders keyed by material name; produces one mesh per non-empty builder.
export class Batch {
  constructor(materials) {
    this.materials = materials;
    this.builders = {};
  }
  get(key) {
    if (!this.materials[key]) throw new Error(`no material ${key}`);
    return this.builders[key] || (this.builders[key] = new GeoBuilder());
  }
  meshes() {
    const out = [];
    for (const [key, b] of Object.entries(this.builders)) {
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.build(), this.materials[key]);
      mesh.name = key;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.push(mesh);
    }
    return out;
  }
}

export const M4 = () => new THREE.Matrix4();

export function mat(x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
  return m;
}

// Deterministic PRNG for set dressing.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
