// Shared tools for the picture palace's dressing: faceted pieces placed relative to
// each other, quads and subdivided box faces for the batch, and the baked light
// (vertex colours) that gives each room its dark corners and warm pools. The
// rig's pooled lamps light only what is near the camera; the bake keeps every room
// shaped, near or far.

import * as THREE from 'three';
import { mat } from '../../geo.js';
import { LIGHTS } from '../../../../shared/maps/palace.js';

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// A transform relative to another: m, then (x, y, z) turned by yaw/pitch/roll, scaled.
export const at = (m, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => m.clone().multiply(mat(x, y, z, ry, rx, rz, s));
export { mat };

// --- Rooms and the baked light -------------------------------------------------------------
// Each room's box, the lamps (LIGHTS indices) that light it, and its fill: how bright a
// corner far from any lamp stays (0..1 of the scene's ambient); gain (default 1) scales the
// whole baked light of a room (the foyer, where the game starts, is lifted).
export const ROOMS = [
  { id: 'foyer', b: [-11, 0, 6, 11, 6, 20], lights: [0, 1, 2, 20, 21], fill: 0.6, gain: 1.6 },
  { id: 'stair', b: [-18, 0, 6, -11, 7, 20], lights: [4, 5], fill: 0.46 },
  { id: 'boxoffice', b: [11, 0, 6, 18, 3.2, 20], lights: [8], fill: 0.46 },
  { id: 'dressing', b: [-18, 3.6, -24, -12, 6.6, 6], lights: [5, 6, 7], fill: 0.44 },
  { id: 'cellar', b: [-18, 0, -24, -12, 3.4, 6], lights: [], fill: 0.36 },
  // (moon: where the shaft through the broken dome lands, and its radius)
  { id: 'house', b: [-12, 0, -14, 12, 11, 6], lights: [11, 12, 13, 14], fill: 0.5, moon: [1.9, 0.25, 3.2] },
  { id: 'stage', b: [-12, 1.2, -22, 12, 11, -14], lights: [14, 15, 11, 12, 19], fill: 0.42 },
  { id: 'alcove', b: [-2.5, 1.2, -25.6, 2.5, 4.8, -22], lights: [19], fill: 0.45 },
  { id: 'back', b: [-12, 1.2, -30, 12, 6.2, -22], lights: [16, 17], fill: 0.42 },
  { id: 'booth', b: [-5, 7.2, 6, 5, 10, 10], lights: [18], fill: 0.45 },
  { id: 'alley', b: [12, 0, -24, 18, 60, 6], lights: [9, 10], fill: 0.62, out: true },
  // The derelict building next door, seen through its boarded windows: dark.
  { id: 'derelict', b: [18, 0, -24, 24, 3.8, 6], lights: [], fill: 0.3 },
];
const OUT_LIGHTS = [3, 9, 10];

export function roomAt(x, y, z, eps = 0.02) {
  for (const r of ROOMS) {
    const b = r.b;
    if (x > b[0] - eps && x < b[3] + eps && y > b[1] - eps && y < b[4] + eps && z > b[2] - eps && z < b[5] + eps) return r;
  }
  return null;
}

// How much of lamp l reaches (x, y, z) facing n: soft distance falloff, half-wrapped.
function lampAt(l, x, y, z, nx, ny, nz) {
  const dx = l.pos[0] - x, dy = l.pos[1] - y, dz = l.pos[2] - z;
  const d = Math.hypot(dx, dy, dz) || 1e-3;
  const f = clamp01(1 - d / (l.distance * 1.15));
  const facing = 0.35 + 0.65 * clamp01((dx * nx + dy * ny + dz * nz) / d);
  // Lamps on the breaker only glow once it's thrown, so they bake in softer.
  return Math.pow(f, 1.5) * facing * Math.min(1.6, l.intensity / 18) * (l.power ? 0.7 : 1);
}

// The baked colour of a surface point: occlusion at the floor, ceiling and corners of
// its room, times the pools of that room's lamps (warm) over its fill (cool).
export function bake(x, y, z, nx = 0, ny = 1, nz = 0, extra = 1) {
  const px = x + nx * 0.06, py = y + ny * 0.06, pz = z + nz * 0.06;
  const room = roomAt(px, py, pz);
  if (!room || room.out) {
    // Outdoors: contact shadow at the ground, the street lamps' pools, cool moonlight.
    let L = 0;
    for (const i of room ? room.lights : OUT_LIGHTS) L += lampAt(LIGHTS[i], x, y, z, nx, ny, nz);
    const ao = (0.62 + 0.38 * smooth(0, 1.6, y)) * (ny < -0.5 ? 0.6 : 1);
    const v = ao * (0.66 + 0.5 * Math.min(1, L)) * extra;
    return [v * (0.93 + 0.1 * Math.min(1, L)), v * 0.98, v * (1.02 - 0.08 * Math.min(1, L))];
  }
  const [x0, y0, z0, x1, y1, z1] = room.b;
  const up = py - y0, down = y1 - py;
  // Walls darken toward the floor and the ceiling; floors and ceilings only at the edges.
  let ao = Math.abs(ny) < 0.7 ? (0.55 + 0.45 * smooth(0, 1.1, up)) * (0.66 + 0.34 * smooth(0, 1.6, down)) : 1;
  // Corners: distance to the walls this surface is not on.
  const dx = Math.min(px - x0, x1 - px), dz = Math.min(pz - z0, z1 - pz);
  const cd = Math.abs(nx) > 0.7 ? dz : Math.abs(nz) > 0.7 ? dx : Math.min(dx, dz);
  ao *= 0.6 + 0.4 * smooth(0, 1.4, cd);
  if (ny > 0.7) ao *= 0.92;
  if (ny < -0.7) ao *= 0.72;
  let L = 0;
  for (const i of room.lights) L += lampAt(LIGHTS[i], x, y, z, nx, ny, nz);
  L = Math.min(1, L);
  const v = ao * (room.fill + (1.18 - room.fill) * L) * (room.gain ?? 1) * extra;
  const out = [v * (0.94 + 0.14 * L), v * (0.95 + 0.03 * L), v * (1.0 - 0.16 * L)];
  if (room.moon) {
    const [mx, mz, mr] = room.moon;
    const m = Math.pow(clamp01(1 - Math.hypot(px - mx, pz - mz) / mr), 1.5) * (0.35 + 0.65 * Math.max(0, ny)) * 0.5 * ao * extra;
    out[0] += m * 0.72; out[1] += m * 0.88; out[2] += m * 1.15;
  }
  return out;
}

// --- Quads and subdivided faces ------------------------------------------------------------

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

// One quad (corners counter-clockwise seen from the front) with its own UVs and colours:
// col is a grey level, [r, g, b], or a function (x, y, z, nx, ny, nz) => grey | [r, g, b].
export function quad(g, p, uv, col = 1) {
  _a.set(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
  _b.set(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]);
  _n.crossVectors(_a, _b).normalize();
  const base = g.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    const [x, y, z] = p[k];
    g.pos.push(x, y, z);
    g.nrm.push(_n.x, _n.y, _n.z);
    g.uv.push(uv[k][0], uv[k][1]);
    let c = typeof col === 'function' ? col(x, y, z, _n.x, _n.y, _n.z) : col;
    if (Array.isArray(c) && Array.isArray(c[0])) c = c[k];
    if (typeof c === 'number') g.col.push(c, c, c); else g.col.push(c[0], c[1], c[2]);
  }
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Cut positions from a to b: every `step` plus the given extra lines inside.
function cuts(a, b, step, extra) {
  const s = new Set([a, b]);
  const n = Math.max(1, Math.round((b - a) / step));
  for (let i = 1; i < n; i++) s.add(a + ((b - a) * i) / n);
  for (const e of extra) if (e > a + 0.05 && e < b - 0.05) s.add(e);
  return [...s].sort((m, k) => m - k).filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.04);
}

// Room boundaries: faces are cut along them so each part takes its own room's look.
const EXTRA = {
  x: [-18, -12, -11, -5, -2.5, 2.5, 5, 11, 12, 18, 24],
  y: [0.12, 1.0, 1.2, 3.2, 3.4, 3.6, 3.8, 4.8, 6, 6.2, 6.3, 6.6, 7, 7.2, 10, 11],
  z: [-30, -25.6, -24, -22, -14, -8, 6, 10, 10.8, 20],
};

// Face f (geo.js order: +x, -x, +y, -y, +z, -z) of box b, cut into cells of about
// `step` m. style(cx, cy, cz, n) picks each cell's [materialKey, metresPerRepeat] (or
// null to skip it); shade(x, y, z, nx, ny, nz) colours its corners. UVs follow
// GeoBuilder.boxFace, so textures run on across neighbouring boxes.
//
// The cells exist to sample the baked light, so where the light is smooth they are merged:
// blocks of cells in one material become a few triangles, as long as the fine grid's
// colours stay within MERGE_EPS of a bilinear ramp between the block's corners. A block
// keeps a vertex wherever another block has a corner on its edge, and every vertex on the
// face's own outline, so the mesh has no T-junctions to crack.
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MERGE_EPS = 0.02;
const MERGE_SPAN = 9;
export function shellFace(batch, b, f, style, shade = bake, step = 1.3) {
  const n = NORMALS[f];
  const ax = n[0] ? 0 : n[1] ? 1 : 2;        // the axis the face is flat in
  const c = n[ax] > 0 ? b[ax + 3] : b[ax];
  const [ua, va] = ax === 0 ? [2, 1] : ax === 1 ? [0, 2] : [0, 1];
  const key = (i) => ['x', 'y', 'z'][i];
  const us = cuts(b[ua], b[ua + 3], step, EXTRA[key(ua)]);
  const vs = cuts(b[va], b[va + 3], step, EXTRA[key(va)]);
  const nu = us.length - 1, nv = vs.length - 1;
  if (nu < 1 || nv < 1) return;
  const W = nu + 1;
  const P = (u, v) => { const p = [0, 0, 0]; p[ax] = c; p[ua] = u; p[va] = v; return p; };
  const uvOf = (p) => {
    const [x, y, z] = p;
    if (n[0]) return [-z * n[0], y];
    if (n[1]) return [x, -z * n[1]];
    return [x * n[2], y];
  };
  // Which way round the (u, v) grid faces: flip the winding if it points away from n.
  const eu = [0, 0, 0], ev = [0, 0, 0];
  eu[ua] = 1; ev[va] = 1;
  const flip = (eu[1] * ev[2] - eu[2] * ev[1]) * n[0] + (eu[2] * ev[0] - eu[0] * ev[2]) * n[1] + (eu[0] * ev[1] - eu[1] * ev[0]) * n[2] < 0;
  const cell = new Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const mid = P((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2);
      cell[j * nu + i] = style(mid[0], mid[1], mid[2], n) || null;
    }
  }
  const same = (p, q) => p && q && p[0] === q[0] && p[1] === q[1] && (p[2] || 0) === (q[2] || 0);
  // The baked colour at each grid vertex, taken once.
  const vsh = new Array(W * (nv + 1));
  const S = (i, j) => {
    const k = j * W + i;
    let col = vsh[k];
    if (!col) {
      const p = P(us[i], vs[j]);
      col = shade(p[0], p[1], p[2], n[0], n[1], n[2]);
      if (typeof col === 'number') col = [col, col, col];
      vsh[k] = col;
    }
    return col;
  };
  // Does a block of cells i0..i1 x j0..j1 stay within MERGE_EPS of a bilinear ramp?
  const fits = (i0, i1, j0, j1) => {
    const u0 = us[i0], du = us[i1 + 1] - u0, v0 = vs[j0], dv = vs[j1 + 1] - v0;
    const s00 = S(i0, j0), s10 = S(i1 + 1, j0), s01 = S(i0, j1 + 1), s11 = S(i1 + 1, j1 + 1);
    for (let k = 0; k < 3; k++) if (Math.abs(s00[k] - s10[k] - s01[k] + s11[k]) > MERGE_EPS) return false;
    for (let j = j0; j <= j1 + 1; j++) {
      const tv = (vs[j] - v0) / dv;
      for (let i = i0; i <= i1 + 1; i++) {
        const tu = (us[i] - u0) / du;
        const s = S(i, j);
        const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
        for (let k = 0; k < 3; k++) if (Math.abs(s[k] - (s00[k] * w00 + s10[k] * w10 + s01[k] * w01 + s11[k] * w11)) > MERGE_EPS) return false;
      }
    }
    return true;
  };
  // Grow blocks: along u first, then whole rows along v.
  const used = new Uint8Array(nu * nv);
  const blocks = [];
  const corner = new Uint8Array(W * (nv + 1));
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const sty = cell[j * nu + i];
      if (!sty || used[j * nu + i]) continue;
      let i1 = i;
      while (i1 + 1 < nu && !used[j * nu + i1 + 1] && same(sty, cell[j * nu + i1 + 1]) && us[i1 + 2] - us[i] <= MERGE_SPAN && fits(i, i1 + 1, j, j)) i1++;
      let j1 = j;
      while (j1 + 1 < nv && vs[j1 + 2] - vs[j] <= MERGE_SPAN) {
        let ok = true;
        for (let q = i; q <= i1 && ok; q++) ok = !used[(j1 + 1) * nu + q] && same(sty, cell[(j1 + 1) * nu + q]);
        if (!ok || !fits(i, i1, j, j1 + 1)) break;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) used[jj * nu + q] = 1;
      blocks.push([i, i1, j, j1, sty]);
      corner[j * W + i] = corner[j * W + i1 + 1] = corner[(j1 + 1) * W + i] = corner[(j1 + 1) * W + i1 + 1] = 1;
    }
  }
  const kept = (i, j) => corner[j * W + i] || i === 0 || i === nu || j === 0 || j === nv;
  for (const [i0, i1, j0, j1, sty] of blocks) {
    const [k, scale, off = 0] = sty;
    const g = batch.get(k);
    // The block's outline, counter-clockwise from its (i0, j0) corner, with the vertices that
    // must stay: its corners and any other block's corner (or the face's outline) on an edge.
    const ring = [];
    for (let i = i0; i <= i1 + 1; i++) if (i === i0 || i === i1 + 1 || kept(i, j0)) ring.push(i, j0);
    for (let j = j0 + 1; j <= j1 + 1; j++) if (j === j1 + 1 || kept(i1 + 1, j)) ring.push(i1 + 1, j);
    for (let i = i1; i >= i0; i--) if (i === i0 || kept(i, j1 + 1)) ring.push(i, j1 + 1);
    for (let j = j1; j > j0; j--) if (kept(i0, j)) ring.push(i0, j);
    const count = ring.length / 2;
    const base = g.pos.length / 3;
    for (let q = 0; q < count; q++) {
      const ii = ring[2 * q], jj = ring[2 * q + 1];
      const p = P(us[ii], vs[jj]);
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(n[0], n[1], n[2]);
      const [u, v] = uvOf(p);
      g.uv.push(u / scale + off, v / scale);
      const col = S(ii, jj);
      g.col.push(col[0], col[1], col[2]);
    }
    // A fan from the first vertex; the triangles along the two edges through it are flat.
    for (let q = 1; q < count - 1; q++) {
      const ja = ring[2 * q + 1], jb = ring[2 * q + 3], ia = ring[2 * q], ib = ring[2 * q + 2];
      if ((ja === j0 && jb === j0) || (ia === i0 && ib === i0)) continue;
      if (flip) g.idx.push(base, base + q + 1, base + q); else g.idx.push(base, base + q, base + q + 1);
    }
  }
}

// A box of size (sx, sy, sz) at matrix m into builder g, every face baked at its world
// position (like GeoBuilder.tbox, with UVs per face scaled by `scale`).
const _v = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const TB = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
// Faces that point down and rest on their room's floor are never seen: a box standing on
// the boards, a prism's bottom cap.
function onFloor(x, y, z) {
  const r = roomAt(x, y + 0.05, z, 0.02);
  return Math.abs(y - (r ? r.b[1] : 0)) < 0.02;
}

// A slab (one side of 4.5 cm or less) keeps its two big faces and drops the rim; a rod (two
// sides that thin) drops its end caps. At the game's resolution the missing sliver is
// under a pixel, and these are most of the palace's boxes.
const THIN = 0.045;
export function bbox(g, m, sx, sy, sz, tint = 1, scale = 1, skip = null) {
  const b = [-sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2];
  _m3.getNormalMatrix(m);
  const tx = sx <= THIN, ty = sy <= THIN, tz = sz <= THIN, nThin = tx + ty + tz;
  const axis = nThin === 1 ? (tx ? 0 : ty ? 1 : 2) : nThin === 2 ? (!tx ? 0 : !ty ? 1 : 2) : -1;
  const t0 = typeof tint === 'number' ? tint : tint[0], t1 = typeof tint === 'number' ? tint : tint[1], t2 = typeof tint === 'number' ? tint : tint[2];
  for (let fi = 0; fi < 6; fi++) {
    if (skip && skip(fi)) continue;
    if (axis >= 0 && ((fi >> 1) === axis) !== (nThin === 1)) continue;
    const F = TB[fi];
    _n.set(F.n[0], F.n[1], F.n[2]).applyMatrix3(_m3).normalize();
    if (fi === 3 && _n.y < -0.9) {
      _v.set(0, b[1], 0).applyMatrix4(m);
      if (onFloor(_v.x, _v.y, _v.z)) continue;
    }
    const base = g.pos.length / 3;
    for (const c of F.c) {
      _v.set(c[0] ? b[3] : b[0], c[1] ? b[4] : b[1], c[2] ? b[5] : b[2]);
      let u, v;
      if (F.n[0]) { u = _v.z; v = _v.y; } else if (F.n[1]) { u = _v.x; v = _v.z; } else { u = _v.x; v = _v.y; }
      _v.applyMatrix4(m);
      g.pos.push(_v.x, _v.y, _v.z);
      g.nrm.push(_n.x, _n.y, _n.z);
      g.uv.push(u / scale + 0.5, v / scale + 0.5);
      const k = bake(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z);
      g.col.push(k[0] * t0, k[1] * t1, k[2] * t2);
    }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// Merge geometry at matrix m, every vertex baked where it lands, times tint. Triangles that
// face down on the floor are left out.
export function bgeo(g, geo, m, tint = 1) {
  const p = geo.attributes.position, nr = geo.attributes.normal, uv = geo.attributes.uv;
  _m3.getNormalMatrix(m);
  const base = g.pos.length / 3;
  const t0 = typeof tint === 'number' ? tint : tint[0], t1 = typeof tint === 'number' ? tint : tint[1], t2 = typeof tint === 'number' ? tint : tint[2];
  const count = p.count;
  const wy = new Float32Array(count), wny = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(p, i).applyMatrix4(m);
    g.pos.push(_v.x, _v.y, _v.z);
    wy[i] = _v.y;
    if (nr) _n.fromBufferAttribute(nr, i).applyMatrix3(_m3).normalize(); else _n.set(0, 1, 0);
    g.nrm.push(_n.x, _n.y, _n.z);
    wny[i] = _n.y;
    if (uv) g.uv.push(uv.getX(i), uv.getY(i)); else g.uv.push(0, 0);
    const k = bake(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z);
    g.col.push(k[0] * t0, k[1] * t1, k[2] * t2);
  }
  const tri = (a, b, c) => {
    if (wny[a] < -0.9 && wny[b] < -0.9 && wny[c] < -0.9 && Math.abs(wy[a] - wy[b]) < 1e-4 && Math.abs(wy[a] - wy[c]) < 1e-4) {
      const o = a * 3;
      if (onFloor(g.pos[base * 3 + o], g.pos[base * 3 + o + 1], g.pos[base * 3 + o + 2])) return;
    }
    g.idx.push(base + a, base + b, base + c);
  };
  if (geo.index) for (let i = 0; i < geo.index.count; i += 3) tri(geo.index.getX(i), geo.index.getX(i + 1), geo.index.getX(i + 2));
  else for (let i = 0; i < count; i += 3) tri(i, i + 1, i + 2);
}

// A flat rectangle w x h centred at matrix m (facing its +Z) showing the sub-rectangle
// [u0, v0, u1, v1] of an atlas (v up, 0..1).
export function atlasQuad(g, m, w, h, rect, tint = 1, lit = true) {
  const [u0, v0, u1, v1] = rect;
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => {
    _v.set(x, y, 0).applyMatrix4(m);
    return [_v.x, _v.y, _v.z];
  });
  const t = typeof tint === 'number' ? [tint, tint, tint] : tint;
  quad(g, pts, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], lit
    ? (x, y, z, nx, ny, nz) => bake(x, y, z, nx, ny, nz).map((v, i) => v * t[i])
    : t);
}

// A strip of boxes between two points (rails, pipes, ropes as thin boxes).
export function beam(g, a, b, w, h, tint = 1, scale = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / len, dy / len, dz / len));
  const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
  // a long rod's ends are hidden or a few centimetres wide
  bbox(g, m, w, h, len, tint, scale, len > 6 * Math.max(w, h) ? (f) => f >= 4 : null);
}
