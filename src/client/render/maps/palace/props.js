// Furniture and small props the palace's rooms share: instanced pieces with baked
// per-instance light, turned balusters, crates, costume rails, trunks, velvet ropes,
// film cans and the like. Every piece stands on the floor at its origin.

import * as THREE from 'three';
import { chamferBox, hull, prism, sackGeo } from '../../level.js';
import { V3, at, mat, bbox, bgeo, beam, bake } from './kit.js';
import { zonesTouching } from './zones.js';

const TAU = Math.PI * 2;

// A run of instances of geo in material `key`, one per matrix, each lit by the bake at its
// position (times tint(i) when given), added to ctx.instances for palace.js to turn into an
// InstancedMesh (with the zones it stands in). geo gets white vertex colours if it has none.
// The matrix and colour attributes are built once here and shared by every level of the palace.
export function instanced(ctx, geo, key, mats, tint = null) {
  if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  const matrices = new Float32Array(mats.length * 16), colors = new Float32Array(mats.length * 3);
  const p = new THREE.Vector3();
  geo.computeBoundingSphere();
  const reach = geo.boundingSphere.radius;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  mats.forEach((m, i) => {
    m.toArray(matrices, i * 16);
    p.setFromMatrixPosition(m);
    box[0] = Math.min(box[0], p.x - reach); box[1] = Math.min(box[1], p.y - reach); box[2] = Math.min(box[2], p.z - reach);
    box[3] = Math.max(box[3], p.x + reach); box[4] = Math.max(box[4], p.y + reach); box[5] = Math.max(box[5], p.z + reach);
    const k = bake(p.x, p.y + 0.5, p.z, 0, 0.7, 0.7);
    const t = tint ? tint(i) : [1, 1, 1];
    colors[i * 3] = k[0] * t[0]; colors[i * 3 + 1] = k[1] * t[1]; colors[i * 3 + 2] = k[2] * t[2];
  });
  ctx.instances.push({ name: `inst:${key}`, key, geo, zones: zonesTouching(box, 0), count: mats.length, matrices: new THREE.InstancedBufferAttribute(matrices, 16), colors: new THREE.InstancedBufferAttribute(colors, 3) });
}

// Merge several (geometry, matrix, colour) parts into one geometry with vertex colours.
export function merged(parts) {
  const pos = [], nrm = [], uv = [], col = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), m3 = new THREE.Matrix3();
  for (const [g0, m, c] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    m3.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const cc = typeof c === 'number' ? [c, c, c] : c;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      n.fromBufferAttribute(N, i).applyMatrix3(m3).normalize();
      pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z);
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      // a little painted occlusion toward the floor
      const ao = 0.62 + 0.38 * Math.min(1, Math.max(0, v.y / 0.9));
      col.push(cc[0] * ao, cc[1] * ao, cc[2] * ao);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// A turned baluster (6 facets, open at both ends: one stands on a step and the other is under
// the rail), h tall, standing at the origin.
export function balusterGeo(h = 0.8, r = 0.045) {
  const prof = [[r * 1.25, 0], [r * 1.25, 0.08 * h], [r * 0.8, 0.12 * h], [r * 1.35, 0.3 * h], [r * 0.55, 0.7 * h], [r * 1.0, 0.8 * h], [r * 1.2, 0.92 * h], [r * 1.2, h]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 6).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// The faces of a non-indexed (or indexed) geometry whose normal passes keep(nx, ny, nz):
// what a piece shows once the sides that lie against something are left out.
export function trimFaces(geo, keep) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const pos = [], nrm = [], uv = [];
  for (let i = 0; i < P.count; i += 3) {
    if (!keep(N.getX(i), N.getY(i), N.getZ(i))) continue;
    for (let k = i; k < i + 3; k++) {
      pos.push(P.getX(k), P.getY(k), P.getZ(k));
      nrm.push(N.getX(k), N.getY(k), N.getZ(k));
      uv.push(U ? U.getX(k) : 0, U ? U.getY(k) : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

// A lopsided lump of a block (rubble, plaster, a torn mattress), 12 triangles: the top
// corners are pulled in a little, by amounts that depend only on its size (so it takes
// nothing from the build's random stream).
export function rubble(sx, sy, sz) {
  const j = (i) => { const v = Math.sin((i + 1) * 12.9898 + sx * 78.233 + sy * 37.719 + sz * 11.13) * 43758.5453; return v - Math.floor(v) - 0.5; };
  const pts = [];
  let i = 0;
  for (const y of [-0.5, 0.5]) {
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.5, 0.5]) {
        const top = y > 0;
        pts.push(V3((x + (top ? -x * 0.3 * (0.5 + j(i)) : 0)) * sx, (y + (top ? j(i + 8) * 0.3 : 0)) * sy, (z + (top ? -z * 0.3 * (0.5 + j(i + 16)) : 0)) * sz));
        i++;
      }
    }
  }
  return hull(pts, [sx, sy, sz]);
}

// A newel post: a square panelled shaft with a cap and a ball finial.
export function newel(g, gilt, x, y, z, h = 1.25) {
  bgeo(g, chamferBox(0.2, 0.18, 0.2, 0.02), mat(x, y + 0.09, z), 0.85);
  bgeo(g, chamferBox(0.16, h - 0.3, 0.16, 0.02), mat(x, y + 0.18 + (h - 0.3) / 2, z), 0.95);
  bgeo(g, chamferBox(0.22, 0.08, 0.22, 0.02), mat(x, y + h - 0.08, z), 1);
  bgeo(gilt, hull(Array.from({ length: 16 }, (_, k) => { const a = (k % 8) / 8 * TAU, yy = k < 8 ? 0 : 0.14; const r = k < 8 ? 0.05 : 0.08; return V3(Math.cos(a) * r, yy, Math.sin(a) * r); }).concat([V3(0, 0.22, 0)])), mat(x, y + h - 0.04, z), 1);
}

// Stacked shipping crates filling a collider box b.
export function crateStack(batch, b, R, stencil = null) {
  const g = batch.get('woodWall'), dark = batch.get('dark');
  const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2], h = b[4] - b[1];
  const crate = (x, y, z, w, hh, d, yaw) => {
    const m = mat(x, y + hh / 2, z, yaw);
    bgeo(g, chamferBox(w, hh, d, 0.02, [w, hh, d]), m, 0.75);
    // battens round each face
    for (const s of [-1, 1]) {
      bbox(g, at(m, 0, s * (hh / 2 - 0.05), d / 2 + 0.012), w + 0.01, 0.08, 0.025, 0.55, 0.6);
      bbox(g, at(m, 0, s * (hh / 2 - 0.05), -d / 2 - 0.012), w + 0.01, 0.08, 0.025, 0.55, 0.6);
      bbox(g, at(m, s * (w / 2 + 0.012), s * (hh / 2 - 0.05), 0), 0.025, 0.08, d + 0.01, 0.55, 0.6);
    }
    bbox(dark, at(m, 0, 0, d / 2 + 0.03), w * 0.8, 0.03, 0.01, 0.8, 0.5);
    if (stencil) stencil(at(m, 0, 0.02, d / 2 + 0.026), w * 0.7, hh * 0.35);
  };
  const w1 = Math.min(sx, 1.2) * 0.9, d1 = Math.min(sz, 1.2) * 0.9;
  crate(b[0] + w1 / 2 + 0.03, b[1], b[2] + d1 / 2 + 0.03, w1, Math.min(h, 1.0) * 0.72, d1, 0.05);
  if (sx > 1.4) crate(b[3] - w1 / 2, b[1], b[5] - d1 / 2, w1 * 0.95, Math.min(h, 1.0) * 0.8, d1 * 0.95, -0.08);
  if (sz > 1.4) crate(b[0] + w1 / 2, b[1], b[5] - d1 / 2, w1 * 0.9, h * 0.55, d1 * 0.85, 0.12);
  crate(cx - 0.05, b[1] + Math.min(h, 1.0) * 0.72, cz - 0.05, w1 * 0.75, h - Math.min(h, 1.0) * 0.72 - 0.02, d1 * 0.7, 0.3 + R() * 0.2);
}

// A costume on a hanger: shoulders, a body that flares, sleeves; tinted cloth.
export function costumeGeo(kind, R) {
  const long = kind === 'gown' ? 1.25 : kind === 'coat' ? 1.0 : 0.7;
  const flare = kind === 'gown' ? 0.34 : 0.22;
  const pts = [
    V3(-0.2, 0, -0.04), V3(0.2, 0, -0.04), V3(-0.2, 0, 0.04), V3(0.2, 0, 0.04),
    V3(-0.16, -0.3, -0.07), V3(0.16, -0.3, -0.07), V3(-0.16, -0.3, 0.07), V3(0.16, -0.3, 0.07),
    V3(-flare, -long, -0.1 - R() * 0.05), V3(flare, -long, -0.1), V3(-flare, -long, 0.1), V3(flare + R() * 0.05, -long, 0.1),
    V3(0, 0.05, 0),
  ];
  return hull(pts, [0.6, 0.6, 0.6]);
}

// A rolling rail of costumes, len long, its rail at `top`, along its local x.
export function costumeRail(batch, m, len, top, R, colors) {
  const metal = batch.get('dark');
  for (const s of [-1, 1]) {
    beam(metal, at(m, s * len / 2, 0.05, 0).elements.slice(12, 15), at(m, s * len / 2, top, 0).elements.slice(12, 15), 0.035, 0.035, 0.8, 0.3);
    beam(metal, at(m, s * len / 2, 0.06, -0.3).elements.slice(12, 15), at(m, s * len / 2, 0.06, 0.3).elements.slice(12, 15), 0.04, 0.03, 0.8, 0.3);
    for (const z of [-0.28, 0.28]) bgeo(metal, prism(0.03, 0.03, 0.05, 6), at(m, s * len / 2, 0.025, z), 0.7);
  }
  beam(metal, at(m, -len / 2, top, 0).elements.slice(12, 15), at(m, len / 2, top, 0).elements.slice(12, 15), 0.03, 0.03, 0.9, 0.3);
  const kinds = ['gown', 'coat', 'jacket'];
  const n = Math.floor(len / 0.16);
  for (let i = 0; i < n; i++) {
    if (R() < 0.12) continue;
    const x = -len / 2 + 0.12 + (i / n) * (len - 0.2);
    const kind = kinds[Math.floor(R() * 3)];
    const [key, tint] = colors[Math.floor(R() * colors.length)];
    const cm = at(m, x, top - 0.06, (R() - 0.5) * 0.04, Math.PI / 2 + (R() - 0.5) * 0.4);
    bgeo(batch.get(key), costumeGeo(kind, R), cm, tint.map((v) => v * (0.8 + R() * 0.3)));
    beam(metal, at(cm, 0, 0.02, 0).elements.slice(12, 15), at(m, x, top + 0.04, 0).elements.slice(12, 15), 0.01, 0.01, 1, 0.1);
  }
}
// Costume colours: [material, tint].
export const COSTUME_COLORS = [
  ['plush', [1, 1, 1]], ['linen', [0.55, 0.62, 0.9]], ['linen', [0.9, 0.82, 0.5]], ['linen', [0.35, 0.55, 0.4]],
  ['linen', [0.95, 0.92, 0.88]], ['linen', [0.3, 0.28, 0.32]], ['plush', [0.6, 0.7, 1.1]], ['gilt', [0.8, 0.8, 0.8]],
];

// A steamer trunk filling collider b (long axis along x or z).
export function trunk(batch, b, R) {
  const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2], h = b[4] - b[1];
  const alongX = sx >= sz;
  const L = (alongX ? sx : sz) - 0.04, D = (alongX ? sz : sx) - 0.04;
  const m = mat(cx, b[1], cz, alongX ? 0 : Math.PI / 2);
  const leather = batch.get('mahogany'), brass = batch.get('gilt'), dark = batch.get('dark');
  bgeo(leather, chamferBox(L, h * 0.62, D, 0.03), at(m, 0, h * 0.31, 0), [0.55, 0.62, 0.5]);
  // the domed lid
  const pts = [];
  for (const x of [-L / 2, L / 2]) for (const [y, z] of [[0, -D / 2], [0, D / 2], [0.16, -D / 2 + 0.06], [0.16, D / 2 - 0.06], [0.24, 0]]) pts.push(V3(x, y, z));
  bgeo(leather, hull(pts, [L, 0.5, D]), at(m, 0, h * 0.62, 0), [0.6, 0.66, 0.54]);
  for (const x of [-L * 0.3, L * 0.3]) {
    bbox(dark, at(m, x, h * 0.45, D / 2 + 0.01), 0.07, h * 0.9, 0.012, 0.8, 0.3);
    bbox(dark, at(m, x, h * 0.45, -D / 2 - 0.01), 0.07, h * 0.9, 0.012, 0.8, 0.3);
  }
  for (const sX of [-1, 1]) for (const sZ of [-1, 1]) bbox(brass, at(m, sX * (L / 2 - 0.03), h * 0.3, sZ * (D / 2 - 0.03)), 0.08, h * 0.62, 0.08, 0.9, 0.3);
  bbox(brass, at(m, 0, h * 0.62, D / 2 + 0.01), 0.1, 0.1, 0.02, 1, 0.3);
  // travel labels
  for (let k = 0; k < 3; k++) bbox(batch.get('paper'), at(m, (R() - 0.5) * L * 0.6, h * (0.25 + R() * 0.25), D / 2 + 0.006, 0, 0, (R() - 0.5) * 0.5), 0.14 + R() * 0.08, 0.1, 0.004, [0.9, 0.8 + R() * 0.1, 0.6], 0.3);
}

// A brass stanchion with a weighted base and a ball top; `fallen` lays it over.
export function stanchion(batch, x, z, fallen = 0, y = 0) {
  const g = batch.get('gilt');
  const m = fallen ? mat(x, y + 0.06, z, fallen, 0, Math.PI / 2) : mat(x, y, z);
  const o = fallen ? -0.45 : 0;
  bgeo(g, prism(0.17, 0.19, 0.04, 8), at(m, fallen ? o : 0, fallen ? 0 : 0.02, 0), 0.9);
  bgeo(g, prism(0.025, 0.03, 0.9, 8), at(m, fallen ? o + 0.45 : 0, fallen ? 0 : 0.47, 0, 0, 0, fallen ? Math.PI / 2 : 0), 1);
  bgeo(g, prism(0.05, 0.05, 0.06, 8), at(m, fallen ? o + 0.9 : 0, fallen ? 0 : 0.93, 0, 0, 0, fallen ? Math.PI / 2 : 0), 1);
}

// A velvet rope sagging between two points (with brass ends).
export function rope(batch, a, b, sag = 0.18) {
  const g = batch.get('plush');
  let prev = a;
  for (let k = 1; k <= 8; k++) {
    const u = k / 8;
    const q = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * sag, a[2] + (b[2] - a[2]) * u];
    beam(g, prev, q, 0.045, 0.045, [1.05, 0.9, 0.9], 0.3);
    prev = q;
  }
}

// A film can (a flat octagonal tin, 24 triangles: top and sides) lying flat.
let CAN = null;
export function filmCan(g, x, y, z, r = 0.19, yaw = 0) {
  CAN ||= trimFaces(prism(0.19, 0.19, 0.057, 8), (nx, ny) => ny > -0.7);
  bgeo(g, CAN, mat(x, y + 0.0285, z, yaw, 0, 0, r / 0.19), 0.85);
}

// A pile of sandbags along a line, `n` bags, 1-2 courses.
export function sandbags(batch, x, y, z, yaw, n, R) {
  const sand = batch.get('sandbag');
  const sacks = [0, 1, 2].map(() => sackGeo(0.5, 0.2, 0.32, R));
  for (let i = 0; i < n; i++) {
    const course = i >= Math.ceil(n * 0.6) ? 1 : 0;
    const k = course ? i - Math.ceil(n * 0.6) : i;
    const along = (k - (course ? (n - Math.ceil(n * 0.6)) : Math.ceil(n * 0.6)) / 2 + 0.5) * 0.48;
    const m = mat(x + Math.cos(yaw) * along, y + 0.09 + course * 0.18, z - Math.sin(yaw) * along, yaw + (R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.1);
    bgeo(sand, sacks[i % 3], m, 0.7 + R() * 0.2);
  }
}

// A coil of rope on the floor.
export function ropeCoil(batch, x, y, z, r = 0.3) {
  const g = batch.get('linen');
  for (let turn = 0; turn < 3; turn++) {
    const rr = r - turn * 0.05;
    let prev = null;
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * TAU;
      const q = [x + Math.cos(a) * rr, y + 0.03 + turn * 0.04, z + Math.sin(a) * rr];
      if (prev) beam(g, prev, q, 0.045, 0.04, [0.62, 0.55, 0.42], 0.3);
      prev = q;
    }
  }
}

// Scattered paper and rubbish on a floor at height y inside [x0, z0, x1, z1].
export function litter(batch, rect, y, n, R, keys = ['paper']) {
  const [x0, z0, x1, z1] = rect;
  for (let i = 0; i < n; i++) {
    const key = keys[Math.floor(R() * keys.length)];
    const g = batch.get(key);
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    if (key === 'paper') bbox(g, mat(x, y + 0.004, z, R() * TAU, (R() - 0.5) * 0.08), 0.2 + R() * 0.2, 0.004, 0.28 + R() * 0.12, 0.7 + R() * 0.2, 0.3);
    else bbox(g, mat(x, y + 0.03, z, R() * TAU, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3), 0.08 + R() * 0.15, 0.05, 0.08 + R() * 0.2, 0.6 + R() * 0.3, 0.3);
  }
}

