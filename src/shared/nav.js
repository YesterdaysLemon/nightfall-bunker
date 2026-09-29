// Navigation grid: one layer of 0.5 m cells per floor level of a map, plus a
// multi-source Dijkstra flow field toward the nearest living player.
//
// Built from a map (mapkit.js defineMap): map.NAV_LEVELS are the floor heights,
// lowest first; a cell on level k is walkable when map.walkable(x, z, k) says the
// spot belongs to that level, a floor surface (the ground, a floor box's top or a
// stair ramp) lies in the level's height band, and there is headroom above it.
// Neighbouring cells connect when their floors differ by at most a step, on any
// level, so stairs join floors by themselves (no hand-made portals).

import { BUNKER } from './map.js';
import { FLOOR_TAGS } from './mapkit.js';

export const CELL = 0.5;
const INFLATE = 0.3;
const STEP = 0.5;          // the most a zombie climbs between neighbouring cells
const BAND = 0.6;          // a level's floors start this far below its height
const SQ2 = Math.SQRT2;

export class NavGrid {
  constructor(map = BUNKER) {
    this.map = map;
    const [x0, z0, x1, z1] = map.navBounds;
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.round((x1 - x0) / CELL);
    this.nz = Math.round((z1 - z0) / CELL);
    this.per = this.nx * this.nz;
    this.levels = map.NAV_LEVELS;
    this.L = this.levels.length;
    const cells = this.per * this.L;
    this.walk = new Uint8Array(cells);
    this.height = new Float32Array(cells);
    this.dist = new Float32Array(cells).fill(Infinity);
    this.openDoors = new Set();
    this.static = map.buildStaticBoxes();
    this.floors = this.static.filter((b) => FLOOR_TAGS.has(b.tag));
    this.surf = null;      // per column: its floor surfaces (doors never change them)
    this.heap = new MinHeap(cells * 4);
    this.build();
  }

  setDoorOpen(id) {
    this.openDoors.add(id);
    this.build();
  }

  index(level, ix, iz) { return level * this.per + iz * this.nx + ix; }
  levelOf(i) { return Math.floor(i / this.per); }
  center(i) {
    const j = i % this.per;
    const ix = j % this.nx, iz = (j / this.nx) | 0;
    return [this.x0 + (ix + 0.5) * CELL, this.height[i], this.z0 + (iz + 0.5) * CELL];
  }

  // The level a floor at height h belongs to.
  bandOf(h) {
    let k = 0;
    while (k + 1 < this.L && h >= this.levels[k + 1] - BAND) k++;
    return k;
  }

  // Every floor surface at (x, z): the ground, floor-box tops that aren't buried
  // inside another floor, or the continuous ramp over a stair flight.
  surfaces(x, z) {
    const ramp = this.map.stairHeightAt(x, z);
    if (ramp !== null) return [ramp];
    const inside = (y) => this.floors.some(({ b }) => x > b[0] && x < b[3] && z > b[2] && z < b[5] && y > b[1] + 1e-3 && y < b[4] - 1e-3);
    const out = [];
    if (!inside(0.05)) out.push(0);
    for (const { b, tag } of this.floors) {
      if (tag === 'step' || !(x > b[0] && x < b[3] && z > b[2] && z < b[5])) continue;
      if (!inside(b[4] + 0.05)) out.push(b[4]);
    }
    return out;
  }

  build() {
    const { DOORS } = this.map;
    const NX = this.nx, NZ = this.nz, X0 = this.x0, Z0 = this.z0;
    const blockers = [
      ...this.static.filter((b) => !FLOOR_TAGS.has(b.tag) && b.tag !== 'roof'),
      ...DOORS.filter((d) => !this.openDoors.has(d.id)).map((d) => ({ b: d.box, tag: d.kind })),
    ];
    if (!this.surf) {
      // Floors (per column) and each level's floor height never change with doors.
      this.surf = new Array(this.per);
      this.floorAt = new Float32Array(this.per * this.L).fill(NaN);
      for (let iz = 0; iz < NZ; iz++) {
        for (let ix = 0; ix < NX; ix++) {
          const x = X0 + (ix + 0.5) * CELL, z = Z0 + (iz + 0.5) * CELL;
          const surf = (this.surf[iz * NX + ix] = this.surfaces(x, z));
          for (let level = 0; level < this.L; level++) {
            if (!this.map.walkable(x, z, level)) continue;
            let h = -Infinity;
            for (const s of surf) if (this.bandOf(s) === level && s > h) h = s;
            if (h > -Infinity) this.floorAt[level * this.per + iz * NX + ix] = h;
          }
        }
      }
    }
    // Every floor cell is walkable until an obstacle (inflated) sits in its headroom.
    for (let i = 0; i < this.per * this.L; i++) {
      const h = this.floorAt[i];
      this.walk[i] = Number.isNaN(h) ? 0 : 1;
      this.height[i] = Number.isNaN(h) ? this.levels[Math.floor(i / this.per)] : h;
    }
    for (const { b } of blockers) {
      const ix0 = Math.max(0, Math.floor((b[0] - INFLATE - X0) / CELL)), ix1 = Math.min(NX - 1, Math.floor((b[3] + INFLATE - X0) / CELL));
      const iz0 = Math.max(0, Math.floor((b[2] - INFLATE - Z0) / CELL)), iz1 = Math.min(NZ - 1, Math.floor((b[5] + INFLATE - Z0) / CELL));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = Z0 + (iz + 0.5) * CELL;
        if (!(z > b[2] - INFLATE && z < b[5] + INFLATE)) continue;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = X0 + (ix + 0.5) * CELL;
          if (!(x > b[0] - INFLATE && x < b[3] + INFLATE)) continue;
          for (let level = 0; level < this.L; level++) {
            const i = level * this.per + iz * NX + ix;
            if (!this.walk[i]) continue;
            const h = this.height[i];
            if (b[4] > h + 0.3 && b[1] < h + 1.7) this.walk[i] = 0;
          }
        }
      }
    }
  }

  locateLevel(level, x, z) {
    const ix = Math.floor((x - this.x0) / CELL), iz = Math.floor((z - this.z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return this.index(level, ix, iz);
  }

  // The walkable cell under (x, z) whose floor is nearest y (within 1.2 m), or -1.
  cellAt(x, z, y) {
    let best = -1, bd = 1.2;
    for (let level = 0; level < this.L; level++) {
      const i = this.locateLevel(level, x, z);
      if (i < 0 || !this.walk[i]) continue;
      const d = Math.abs(this.height[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Exact cell under a position (no neighbour fallback), or -1.
  locateStrict(x, y, z) { return this.cellAt(x, z, y); }

  // Cell for a world position. Falls back to the nearest walkable cell within one
  // ring so wall-huggers still resolve.
  locate(x, y, z) {
    const i = this.cellAt(x, z, y);
    if (i >= 0) return i;
    let best = -1, bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const j = this.cellAt(x + dx * CELL, z + dz * CELL, y);
        if (j < 0) continue;
        const c = this.center(j);
        const d = (c[0] - x) ** 2 + (c[2] - z) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
    }
    return best;
  }

  // The walkable cell in column (x, z) within a step of height h, or -1.
  stepTo(ix, iz, h) {
    for (let level = 0; level < this.L; level++) {
      const n = level * this.per + iz * this.nx + ix;
      if (this.walk[n] && Math.abs(this.height[n] - h) <= STEP) return n;
    }
    return -1;
  }

  // Calls fn(neighbour, cost) for every traversable edge out of i.
  neighbours(i, fn) {
    const NX = this.nx, NZ = this.nz;
    const j = i % this.per;
    const ix = j % NX, iz = (j / NX) | 0;
    const h = this.height[i];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= NX || z >= NZ) continue;
        const n = this.stepTo(x, z, h);
        if (n < 0) continue;
        if (dx && dz && (this.stepTo(x, iz, h) < 0 || this.stepTo(ix, z, h) < 0)) continue;
        fn(n, dx && dz ? SQ2 : 1);
      }
    }
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
