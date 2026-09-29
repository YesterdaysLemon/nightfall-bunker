// Spatial chunks. A Batch merges every material's geometry into one mesh, so nothing in
// the palace was ever culled: the whole building drew from everywhere. Here each material's
// triangles are grouped by the zone (room, or outdoors) they face, and each group is split
// (a k-d split on the triangles' centres) into compact chunks of a couple of thousand, so
// the camera can drop the ones behind it, out of its frustum or in a room it cannot see
// into (zones.js).

import * as THREE from 'three';
import { pushZones } from './zones.js';

// Partial sort: leave the k-th smallest (by key) of order[lo, hi) at k, smaller ones before it.
function select(order, lo, hi, k, key) {
  while (hi - lo > 1) {
    const pivot = key[order[(lo + hi) >> 1]];
    let i = lo, j = hi - 1;
    while (i <= j) {
      while (key[order[i]] < pivot) i++;
      while (key[order[j]] > pivot) j--;
      if (i <= j) { const t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
    }
    if (k <= j) hi = j + 1; else if (k >= i) lo = i; else return;
  }
}

// Split n items, given their centres, into k-d leaves of at most maxItems each, never
// splitting a group whose centres already fit in a minSize cube. Returns the items'
// order and the [lo, hi) ranges of it that are the leaves.
export function kdLeaves(cx, cy, cz, maxItems, minSize) {
  const n = cx.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const leaves = [];
  const rec = (lo, hi) => {
    const count = hi - lo;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = lo; k < hi; k++) {
      const t = order[k];
      if (cx[t] < x0) x0 = cx[t]; if (cx[t] > x1) x1 = cx[t];
      if (cy[t] < y0) y0 = cy[t]; if (cy[t] > y1) y1 = cy[t];
      if (cz[t] < z0) z0 = cz[t]; if (cz[t] > z1) z1 = cz[t];
    }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    if (count <= maxItems || Math.max(ex, ey, ez) <= minSize) { leaves.push([lo, hi]); return; }
    const axis = ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
    const mid = lo + (count >> 1);
    select(order, lo, hi, mid, axis);
    rec(lo, mid);
    rec(mid, hi);
  };
  if (n) rec(0, n);
  return { order, leaves };
}

// Materials seen from both sides, whose triangles belong to the zones on both.
const DOUBLE_SIDED = new Set(['screen', 'chainlink']);

// One GeoBuilder's triangles as chunks: [{ geo, zones }].
export function chunkBuilder(b, key, maxTris = 6000, minSize = 12) {
  const idx = b.idx, pos = b.pos, T = idx.length / 3;
  const cx = new Float32Array(T), cy = new Float32Array(T), cz = new Float32Array(T);
  const groups = new Map();   // zone key -> triangle ids
  const seen = [];
  const double = DOUBLE_SIDED.has(key);
  for (let t = 0; t < T; t++) {
    const a = idx[t * 3] * 3, c = idx[t * 3 + 1] * 3, d = idx[t * 3 + 2] * 3;
    const x = (pos[a] + pos[c] + pos[d]) / 3, y = (pos[a + 1] + pos[c + 1] + pos[d + 1]) / 3, z = (pos[a + 2] + pos[c + 2] + pos[d + 2]) / 3;
    cx[t] = x; cy[t] = y; cz[t] = z;
    // The zones a triangle faces: the one just off its front at its centre (both sides when it is
    // seen from both). A triangle that straddles a wall or floor, or faces into one, is also seen
    // from the rooms round its corners and just above and below its centre, but never from
    // outdoors on their account.
    const nx = b.nrm[idx[t * 3] * 3], ny = b.nrm[idx[t * 3] * 3 + 1], nz = b.nrm[idx[t * 3] * 3 + 2];
    seen.length = 0;
    pushZones(seen, x + nx * 0.07, y + ny * 0.07, z + nz * 0.07);
    if (double) pushZones(seen, x - nx * 0.07, y - ny * 0.07, z - nz * 0.07);
    pushZones(seen, x, y + 0.03, z, false);
    pushZones(seen, x, y - 0.03, z, false);
    for (const v of [a, c, d]) pushZones(seen, x + (pos[v] - x) * 0.85 + nx * 0.07, y + (pos[v + 1] - y) * 0.85 + ny * 0.07, z + (pos[v + 2] - z) * 0.85 + nz * 0.07, false);
    const gk = seen.sort((p, q) => p - q).join(',');
    let g = groups.get(gk);
    if (!g) groups.set(gk, g = []);
    g.push(t);
  }
  const V = pos.length / 3;
  const remap = new Int32Array(V).fill(-1);
  const out = [];
  for (const [gk, tris] of groups) {
    const zones = [...new Set(gk.split(',').map(Number))];
    const gx = new Float32Array(tris.length), gy = new Float32Array(tris.length), gz = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i++) { gx[i] = cx[tris[i]]; gy[i] = cy[tris[i]]; gz[i] = cz[tris[i]]; }
    const { order, leaves } = kdLeaves(gx, gy, gz, maxTris, minSize);
    for (const [lo, hi] of leaves) {
      const used = [];
      const ii = new Uint32Array((hi - lo) * 3);
      for (let k = lo; k < hi; k++) {
        const t = tris[order[k]];
        for (let q = 0; q < 3; q++) {
          const v = idx[t * 3 + q];
          if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
          ii[(k - lo) * 3 + q] = remap[v];
        }
      }
      const n = used.length;
      const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = used[i];
        p[i * 3] = pos[v * 3]; p[i * 3 + 1] = pos[v * 3 + 1]; p[i * 3 + 2] = pos[v * 3 + 2];
        nr[i * 3] = b.nrm[v * 3]; nr[i * 3 + 1] = b.nrm[v * 3 + 1]; nr[i * 3 + 2] = b.nrm[v * 3 + 2];
        uv[i * 2] = b.uv[v * 2]; uv[i * 2 + 1] = b.uv[v * 2 + 1];
        col[i * 3] = b.col[v * 3]; col[i * 3 + 1] = b.col[v * 3 + 1]; col[i * 3 + 2] = b.col[v * 3 + 2];
        remap[v] = -1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(n > 65535 ? ii : Uint16Array.from(ii), 1));
      g.computeBoundingSphere();
      out.push({ geo: g, zones });
    }
  }
  return out;
}

// A draw call costs about as much as a thousand triangles or so, so a handful of signs or
// rivets spread over the rooms is not worth a chunk each. A material with few triangles in all
// is one chunk; otherwise small chunks are merged in pairs, the pair with the fewest rooms
// between them first, while the result stays small (so drawing it for the sake of one room's
// share costs little) and compact.
const MERGE_SMALL = 800;
const MERGE_TOTAL = 2000;
const MERGE_RADIUS = 30;
const ONE_CHUNK = 1800;   // a material with fewer triangles than this in all is one chunk

function joined(a, b) {
  const cat = (name, n) => {
    const out = new Float32Array((a.attributes[name].count + b.attributes[name].count) * n);
    out.set(a.attributes[name].array, 0);
    out.set(b.attributes[name].array, a.attributes[name].count * n);
    return new THREE.BufferAttribute(out, n);
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', cat('position', 3));
  g.setAttribute('normal', cat('normal', 3));
  g.setAttribute('uv', cat('uv', 2));
  g.setAttribute('color', cat('color', 3));
  const na = a.attributes.position.count, ia = a.index.count, ib = b.index.count;
  const ii = new Uint32Array(ia + ib);
  ii.set(a.index.array, 0);
  for (let i = 0; i < ib; i++) ii[ia + i] = b.index.array[i] + na;
  g.setIndex(new THREE.BufferAttribute(na + b.attributes.position.count > 65535 ? ii : Uint16Array.from(ii), 1));
  g.computeBoundingSphere();
  return g;
}

function* consolidate(chunks) {
  const byKey = new Map();
  for (const c of chunks) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push({ ...c, tris: c.geo.index.count / 3 });
  }
  const out = [];
  for (const [key, live] of byKey) {
    const total = live.reduce((t, c) => t + c.tris, 0);
    for (;;) {
      if (total < ONE_CHUNK && live.length > 1) {
        const p = live[0], q = live[1];
        live.splice(0, 2, { key, geo: joined(p.geo, q.geo), zones: [...new Set([...p.zones, ...q.zones])].sort((m, n) => m - n), tris: p.tris + q.tris });
        continue;
      }
      let best = null, bi = -1, bj = -1;
      for (let i = 0; i < live.length; i++) {
        if (live[i].tris >= MERGE_SMALL) continue;
        for (let j = 0; j < live.length; j++) {
          if (j === i || live[j].tris >= MERGE_SMALL || live[i].tris + live[j].tris > MERGE_TOTAL || (j < i && live[j].tris < MERGE_SMALL)) continue;
          const si = live[i].geo.boundingSphere, sj = live[j].geo.boundingSphere;
          const reach = (si.center.distanceTo(sj.center) + si.radius + sj.radius) / 2;
          if (reach > MERGE_RADIUS) continue;
          const zones = new Set([...live[i].zones, ...live[j].zones]).size;
          const cost = zones * 1000 + reach;
          if (!best || cost < best) { best = cost; bi = i; bj = j; }
        }
      }
      if (!best) break;
      const p = live[bi], q = live[bj];
      const merged = { key, geo: joined(p.geo, q.geo), zones: [...new Set([...p.zones, ...q.zones])].sort((m, n) => m - n), tris: p.tris + q.tris };
      live.splice(Math.max(bi, bj), 1);
      live[Math.min(bi, bj)] = merged;
    }
    for (const c of live) out.push({ key, geo: c.geo, zones: c.zones });
    yield;
  }
  return out;
}

// Every non-empty builder of a batch as { key, geo, zones } chunks (the batch is emptied). A
// generator, one step a material, that returns the chunks.
export function* chunkBatch(batch, maxTris, minSize) {
  const out = [];
  for (const [key, b] of Object.entries(batch.builders)) {
    if (b.empty) continue;
    for (const c of chunkBuilder(b, key, maxTris, minSize)) out.push({ key, ...c });
    yield;
  }
  batch.builders = {};
  return yield* consolidate(out);
}
