// Two-level navigation grid for the building interior with stair portals,
// plus a multi-source Dijkstra flow field toward the nearest living player.

import {
  BX0, BZ0, BX1, BZ1, IX0, IX1, IZ0, IZ1, LOFT_Y, STAIRS, stairFootprint, stairHeightAt,
  buildStaticBoxes, DOORS,
} from './map.js';

export const CELL = 0.5;
const NX = Math.round((BX1 - BX0) / CELL);
const NZ = Math.round((BZ1 - BZ0) / CELL);
const PER = NX * NZ;
const INFLATE = 0.3;
const SQ2 = Math.SQRT2;

export class NavGrid {
  constructor() {
    this.nx = NX; this.nz = NZ;
    this.walk = new Uint8Array(PER * 2);
    this.height = new Float32Array(PER * 2);
    this.dist = new Float32Array(PER * 2).fill(Infinity);
    this.portals = new Map();
    this.openDoors = new Set();
    this.static = buildStaticBoxes();
    this.heap = new MinHeap(PER * 2 * 4);
    this.build();
  }

  setDoorOpen(id) {
    this.openDoors.add(id);
    this.build();
  }

  index(level, ix, iz) { return level * PER + iz * NX + ix; }
  center(i) {
    const level = i >= PER ? 1 : 0;
    const j = i - level * PER;
    const ix = j % NX, iz = (j / NX) | 0;
    return [BX0 + (ix + 0.5) * CELL, this.height[i], BZ0 + (iz + 0.5) * CELL];
  }

  build() {
    const blockers = [
      ...this.static.filter((b) => b.tag !== 'step' && b.tag !== 'floor0' && b.tag !== 'roof'),
      ...DOORS.filter((d) => !this.openDoors.has(d.id)).map((d) => ({ b: d.box, tag: d.kind })),
    ];
    const slabs = this.static.filter((b) => b.tag === 'slab');
    for (let level = 0; level < 2; level++) {
      for (let iz = 0; iz < NZ; iz++) {
        for (let ix = 0; ix < NX; ix++) {
          const i = this.index(level, ix, iz);
          const x = BX0 + (ix + 0.5) * CELL, z = BZ0 + (iz + 0.5) * CELL;
          let ok = x > IX0 && x < IX1 && z > IZ0 && z < IZ1;
          let h = level ? LOFT_Y : 0;
          if (ok && level === 0) {
            const sh = stairHeightAt(x, z);
            if (sh !== null) h = sh;
          }
          if (ok && level === 1) {
            ok = slabs.some(({ b }) => x > b[0] && x < b[3] && z > b[2] && z < b[5]);
          }
          if (ok) {
            const y0 = h + 0.3, y1 = h + 1.7;
            for (const { b } of blockers) {
              if (b[4] <= y0 || b[1] >= y1) continue;
              if (x > b[0] - INFLATE && x < b[3] + INFLATE && z > b[2] - INFLATE && z < b[5] + INFLATE) { ok = false; break; }
            }
          }
          this.walk[i] = ok ? 1 : 0;
          this.height[i] = h;
        }
      }
    }
    // Stair-top portals: top column of each flight <-> first loft cell beyond it.
    this.portals.clear();
    for (const s of STAIRS) {
      const [x0, z0, x1, z1] = stairFootprint(s);
      const topX = s.dir > 0 ? x1 - CELL / 2 : x0 + CELL / 2;
      const loftX = topX + s.dir * CELL;
      for (let z = z0 + CELL / 2; z < z1; z += CELL) {
        const a = this.locateLevel(0, topX, z);
        const b = this.locateLevel(1, loftX, z);
        if (a < 0 || b < 0 || !this.walk[a] || !this.walk[b]) continue;
        this.link(a, b); this.link(b, a);
      }
    }
  }

  link(a, b) {
    let l = this.portals.get(a);
    if (!l) this.portals.set(a, l = []);
    if (!l.includes(b)) l.push(b);
  }

  locateLevel(level, x, z) {
    const ix = Math.floor((x - BX0) / CELL), iz = Math.floor((z - BZ0) / CELL);
    if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return -1;
    return this.index(level, ix, iz);
  }

  // Exact cell under a position (no neighbour fallback), or -1.
  locateStrict(x, y, z) {
    const tryLevels = y > LOFT_Y - 0.6 ? [1, 0] : [0, 1];
    for (const level of tryLevels) {
      const i = this.locateLevel(level, x, z);
      if (i >= 0 && this.walk[i] && Math.abs(this.height[i] - y) < 1.2) return i;
    }
    return -1;
  }

  // Cell for a world position. Stairs belong to level 0. Falls back to the
  // nearest walkable cell within one ring so wall-huggers still resolve.
  locate(x, y, z) {
    const tryLevels = y > LOFT_Y - 0.6 ? [1, 0] : [0, 1];
    for (const level of tryLevels) {
      const i = this.locateLevel(level, x, z);
      if (i >= 0 && this.walk[i] && Math.abs(this.height[i] - y) < 1.2) return i;
    }
    const level = y > LOFT_Y - 0.6 ? 1 : 0;
    let best = -1, bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const lv of [level, 1 - level]) {
          const i = this.locateLevel(lv, x + dx * CELL, z + dz * CELL);
          if (i < 0 || !this.walk[i] || Math.abs(this.height[i] - y) > 1.2) continue;
          const c = this.center(i);
          const d = (c[0] - x) ** 2 + (c[2] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best;
  }

  // Calls fn(neighbour, cost) for every traversable edge out of i.
  neighbours(i, fn) {
    const level = i >= PER ? 1 : 0;
    const j = i - level * PER;
    const ix = j % NX, iz = (j / NX) | 0;
    const h = this.height[i];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= NX || z >= NZ) continue;
        const n = level * PER + z * NX + x;
        if (!this.walk[n] || Math.abs(this.height[n] - h) > 0.5) continue;
        if (dx && dz) {
          const a = level * PER + iz * NX + x, b = level * PER + z * NX + ix;
          if (!this.walk[a] || !this.walk[b]) continue;
        }
        fn(n, dx && dz ? SQ2 : 1);
      }
    }
    const p = this.portals.get(i);
    if (p) for (const n of p) fn(n, 1);
  }

  // targets: array of world positions. Fills this.dist.
  computeFlow(targets) {
    const dist = this.dist;
    dist.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    for (const t of targets) {
      const i = this.locate(t[0], t[1], t[2]);
      if (i < 0) continue;
      dist[i] = 0;
      heap.push(i, 0);
    }
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > dist[i]) continue;
      this.neighbours(i, (n, c) => {
        const nd = d + c;
        if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
      });
    }
  }

  // Best neighbour toward the targets (-1 when already there or unreachable).
  next(i) {
    let best = -1, bd = this.dist[i];
    this.neighbours(i, (n) => {
      if (this.dist[n] < bd) { bd = this.dist[n]; best = n; }
    });
    return best;
  }

  levelOf(i) { return i >= PER ? 1 : 0; }
}

class MinHeap {
  constructor(cap) {
    this.ids = new Int32Array(cap);
    this.keys = new Float32Array(cap);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(id, key) {
    if (this.size >= this.ids.length) return; // bounded; duplicates beyond cap are harmless
    let i = this.size++;
    const ids = this.ids, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const id = ids[0], key = keys[0];
    const lid = ids[--this.size], lkey = keys[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= lkey) break;
      ids[i] = ids[c]; keys[i] = keys[c]; i = c;
    }
    ids[i] = lid; keys[i] = lkey;
    return [id, key];
  }
}
