// What the camera can see of the palace: portal culling. The building is a set of rooms
// (kit.js ROOMS, plus "out": everything that is not in a room) joined by openings, the
// holes the map's walls have for doors, windows, the proscenium arch and the stairwells.
// Frustum culling alone still draws every room of a wide view, because nothing is ever
// hidden behind a wall; here the rooms the camera can reach through openings inside its
// frustum are found each frame, each with the part of the screen it can be seen through,
// and a chunk is only drawn if it is in one of its rooms and inside that part of the screen.
//
// Everything is derived from the map: the openings by sampling each room's faces against
// the drawn walls and slabs (doors count as open), the rooms of a triangle by the room it
// faces. So moving a wall or adding a room needs no list kept up to date here.

import * as THREE from 'three';
import { buildStaticBoxes } from '../../../../shared/maps/palace.js';
import { ROOMS } from './kit.js';

export const OUT = ROOMS.length;   // the zone of everything that is not inside a room
export const ZONE_NAMES = [...ROOMS.map((r) => r.id), 'out'];

// A zone is its room's box, except that the auditorium also holds the headroom above its
// ceiling line (over the dome and the proscenium's crest, which are seen from inside; the
// lighting keeps the room's own box), and the cellar reaches up through the slab to the
// dressing rooms' floor (so the slab is not a pocket of "outdoors" inside the building).
const SKY = 14;   // the alley is open sky above this: nothing stands higher, and it is outdoors
const HOUSE = ROOMS.findIndex((r) => r.id === 'house');
const BOXES = ROOMS.map((r) => (r.id === 'cellar' ? [r.b[0], r.b[1], r.b[2], r.b[3], 3.6, r.b[5]] : [r.b[0], r.b[1], r.b[2], r.b[3], Math.min(r.b[4], SKY), r.b[5]]));
const HEADROOM = [[-6.6, 11, -10.6, 6.6, 13.6, 2.6], [-3, 11, -14.6, 3, 12.6, -13.2]];

// The zone holding a point (a room, or OUT); eps grows the rooms.
export function zoneAt(x, y, z, eps = 0.02) {
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (x > b[0] - eps && x < b[3] + eps && y > b[1] - eps && y < b[4] + eps && z > b[2] - eps && z < b[5] + eps) return i;
  }
  for (const h of HEADROOM) if (x > h[0] && x < h[3] && y > h[1] && y < h[4] && z > h[2] && z < h[5]) return HOUSE;
  return OUT;
}

// Add to list the zones a point belongs to: its zone, and OUT too where it is up in the
// auditorium's dome headroom, whose outside can be seen from the street.
export function pushZones(list, x, y, z, outdoors = true) {
  const zn = zoneAt(x, y, z);
  if ((outdoors || zn !== OUT) && !list.includes(zn)) list.push(zn);
  if (zn === HOUSE && y > ROOMS[HOUSE].b[4] && !list.includes(OUT)) list.push(OUT);
}

// The zones a box [x0, y0, z0, x1, y1, z1] touches (rooms grown by margin), OUT when none.
export function zonesTouching(b, margin = 0.3) {
  const out = [];
  for (let i = 0; i < ROOMS.length; i++) {
    const r = BOXES[i];
    if (b[0] < r[3] + margin && b[3] > r[0] - margin && b[1] < r[4] + margin && b[4] > r[1] - margin && b[2] < r[5] + margin && b[5] > r[2] - margin) out.push(i);
  }
  return out.length ? out : [OUT];
}

// --- Openings -----------------------------------------------------------------------------------

const SOLID_TAGS = new Set(['ext', 'int', 'roof', 'floor0', 'slab', 'stage', 'step', 'pillar']);

// Portals between zones: { from, to, box } with box the bounding box of one connected
// opening. Each face of each room is checked against the drawn walls and slabs: what they do
// not cover is open, and leads to whichever zone lies just past it. (The face is cut on the
// edges of the walls in the way and of the rooms beside it, so each piece leads to one place.)
// Both directions are listed, each with the side of its plane the camera must be on to look
// through (ax, plane, s: the camera's coordinate on ax, minus plane, times s, must not be
// positive), so a window is only seen from the side it faces; doors count as open.
export function buildPortals() {
  const solids = buildStaticBoxes().filter((q) => SOLID_TAGS.has(q.tag)).map((q) => q.b);
  const inSolid = (list, x, y, z) => {
    for (const s of list) if (x > s[0] + 1e-3 && x < s[3] - 1e-3 && y > s[1] + 1e-3 && y < s[4] - 1e-3 && z > s[2] + 1e-3 && z < s[5] - 1e-3) return true;
    return false;
  };
  const found = [];
  BOXES.forEach((_, from) => {
    const R = ROOMS[from].b;
    const room = [R[0], R[1], R[2], R[3], Math.min(R[4], SKY), R[5]];   // the lighting's box, not the dome's headroom
    for (let f = 0; f < 6; f++) {
      const ax = f >> 1, dir = f & 1 ? -1 : 1;
      const plane = dir > 0 ? room[ax + 3] : room[ax];
      const probe = plane + dir * 0.05;
      const [ua, va] = ax === 0 ? [2, 1] : ax === 1 ? [0, 2] : [0, 1];
      // what covers the face: the walls and slabs whose thickness holds the probe plane
      const cover = [];
      for (const s of solids) if (s[ax] + 1e-3 < probe && probe < s[ax + 3] - 1e-3) cover.push([s[ua], s[va], s[ua + 3], s[va + 3]]);
      const near = solids.filter((s) => s[ax] < plane + 0.5 && s[ax + 3] > plane - 0.5);
      const cuts = (lo, hi, pick) => {
        const set = new Set([lo, hi]);
        const add = (v) => { if (v > lo + 1e-4 && v < hi - 1e-4) set.add(v); };
        for (const c of cover) { add(c[pick]); add(c[pick + 2]); }
        for (let i = 0; i < BOXES.length; i++) {
          const q = BOXES[i];
          if (i === from || q[ax] > plane + 0.5 || q[ax + 3] < plane - 0.5) continue;
          add(q[pick === 0 ? ua : va]); add(q[(pick === 0 ? ua : va) + 3]);
        }
        return [...set].sort((p, q) => p - q);
      };
      const us = cuts(room[ua], room[ua + 3], 0), vs = cuts(room[va], room[va + 3], 1);
      const nu = us.length - 1, nv = vs.length - 1;
      const grid = new Int16Array(nu * nv).fill(-1);
      const p = [0, 0, 0];
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const cu = (us[i] + us[i + 1]) / 2, cv = (vs[j] + vs[j + 1]) / 2;
          if (cover.some((c) => cu > c[0] && cu < c[2] && cv > c[1] && cv < c[3])) continue;
          p[ua] = cu; p[va] = cv; p[ax] = probe;
          let to = zoneAt(p[0], p[1], p[2]);
          if (to === from) { p[ax] = plane + dir * 0.4; to = inSolid(near, p[0], p[1], p[2]) ? -1 : zoneAt(p[0], p[1], p[2]); }
          if (to >= 0 && to !== from) grid[j * nu + i] = to;
        }
      }
      const seen = new Uint8Array(nu * nv);
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const to = grid[j * nu + i];
          if (to < 0 || seen[j * nu + i]) continue;
          const stack = [i, j];
          seen[j * nu + i] = 1;
          let i0 = i, i1 = i, j0 = j, j1 = j;
          while (stack.length) {
            const cj = stack.pop(), ci = stack.pop();
            if (ci < i0) i0 = ci; if (ci > i1) i1 = ci; if (cj < j0) j0 = cj; if (cj > j1) j1 = cj;
            for (let k = 0; k < 4; k++) {
              const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
              if (ni < 0 || nj < 0 || ni >= nu || nj >= nv || seen[nj * nu + ni] || grid[nj * nu + ni] !== to) continue;
              seen[nj * nu + ni] = 1;
              stack.push(ni, nj);
            }
          }
          const box = [0, 0, 0, 0, 0, 0];
          box[ax] = plane - 0.05; box[ax + 3] = plane + 0.05;
          box[ua] = us[i0] - 0.02; box[ua + 3] = us[i1 + 1] + 0.02;
          box[va] = vs[j0] - 0.02; box[va + 3] = vs[j1 + 1] + 0.02;
          found.push({ from, to, box, ax, plane, dir });
        }
      }
    }
  });
  const out = [];
  for (const q of found) out.push({ from: q.from, to: q.to, box: q.box, ax: q.ax, plane: q.plane, s: q.dir }, { from: q.to, to: q.from, box: q.box, ax: q.ax, plane: q.plane, s: -q.dir });
  return out;
}

// --- The culler -------------------------------------------------------------------------------------

const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const MARGIN = 0.03;   // NDC: slack for a camera that moves between the update and the draw
const NEAR = 0.02;
const SIDE = 0.35;     // m: a camera this close to an opening's plane, in the wall, sees either way

// A camera's view of the palace: which zones it can see and through what part of the screen.
// Meshes are registered with the zones they can be seen from; update(camera) then sets
// their `visible`.
export class Culler {
  constructor(portals) {
    this.byZone = Array.from({ length: OUT + 1 }, () => []);
    for (const p of portals) this.byZone[p.from].push(p);
    this.items = [];   // { mesh, zones, cx, cy, cz, r }
    const n = OUT + 1;
    this.rect = new Float32Array(n * 4);      // per zone: NDC x0, y0, x1, y1 of where it can be seen
    this.plane = new Float32Array(n * 16);    // per zone: the four planes of that sub-frustum
    this.on = new Uint8Array(n);
    this.pv = new THREE.Matrix4();
    this.last = new Float64Array(16);
    this.queue = new Int32Array(n * 64);
    this.stale = true;
    this.enabled = true;
  }

  add(mesh, zones) {
    this.stale = true;
    const g = mesh.geometry;
    if (!mesh.boundingSphere && !g.boundingSphere) g.computeBoundingSphere();
    const bs = mesh.isInstancedMesh ? (mesh.boundingSphere || (mesh.computeBoundingSphere(), mesh.boundingSphere)) : g.boundingSphere;
    this.items.push({ mesh, zones, cx: bs.center.x, cy: bs.center.y, cz: bs.center.z, r: bs.radius });
  }

  // Where a zone's screen rectangle grows to take in a portal (clipped to the rectangle it
  // is seen through): the portal's box projected, its edges clipped at the near plane.
  portalRect(box, r0, r1, r2, r3, out) {
    const e = this.pv.elements;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    const cx = this._cx, cy = this._cy, cw = this._cw;
    for (let k = 0; k < 8; k++) {
      const x = k & 1 ? box[3] : box[0], y = k & 2 ? box[4] : box[1], z = k & 4 ? box[5] : box[2];
      cx[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
      cy[k] = e[1] * x + e[5] * y + e[9] * z + e[13];
      cw[k] = e[3] * x + e[7] * y + e[11] * z + e[15];
    }
    for (let k = 0; k < 8; k++) {
      if (cw[k] > NEAR) {
        const x = cx[k] / cw[k], y = cy[k] / cw[k];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        any = true;
      }
    }
    for (const [i, j] of EDGES) {
      if ((cw[i] > NEAR) === (cw[j] > NEAR)) continue;
      const t = (NEAR - cw[i]) / (cw[j] - cw[i]);
      const x = (cx[i] + (cx[j] - cx[i]) * t) / NEAR, y = (cy[i] + (cy[j] - cy[i]) * t) / NEAR;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      any = true;
    }
    if (!any) return false;
    out[0] = Math.max(x0 - MARGIN, r0); out[1] = Math.max(y0 - MARGIN, r1); out[2] = Math.min(x1 + MARGIN, r2); out[3] = Math.min(y1 + MARGIN, r3);
    return out[0] < out[2] && out[1] < out[3];
  }

  // Which zones the camera is in: the rooms that hold it, or (in a wall or outside) the rooms
  // near it and OUT.
  start(x, y, z, mark) {
    let any = false;
    for (let i = 0; i < ROOMS.length; i++) {
      const b = ROOMS[i].b;
      if (x > b[0] && x < b[3] && y > b[1] && y < Math.min(b[4], SKY) && z > b[2] && z < b[5]) { mark(i); any = true; }
    }
    if (any) return;
    for (let i = 0; i < ROOMS.length; i++) {
      const b = ROOMS[i].b;
      if (x > b[0] - 0.5 && x < b[3] + 0.5 && y > b[1] - 0.5 && y < Math.min(b[4], SKY) + 0.5 && z > b[2] - 0.5 && z < b[5] + 0.5) mark(i);
    }
    mark(OUT);
  }

  update(camera) {
    if (!this.enabled) {
      // (switched off, for comparing pictures with and without: everything is drawn)
      if (!this.stale) { for (const it of this.items) it.mesh.visible = true; this.stale = true; }
      return;
    }
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = this.pv.elements;
    let same = !this.stale;
    for (let i = 0; i < 16 && same; i++) if (e[i] !== this.last[i]) same = false;
    if (same) return;
    this.last.set(e);
    this.stale = false;
    this._cx ||= new Float64Array(8); this._cy ||= new Float64Array(8); this._cw ||= new Float64Array(8);
    const n = OUT + 1, rect = this.rect, on = this.on, queue = this.queue;
    on.fill(0);
    let head = 0, tail = 0;
    let overflow = false;
    const push = (z) => { if (tail < queue.length) queue[tail++] = z; else overflow = true; };
    const setRect = (z, x0, y0, x1, y1) => { rect[z * 4] = x0; rect[z * 4 + 1] = y0; rect[z * 4 + 2] = x1; rect[z * 4 + 3] = y1; };
    const me = camera.matrixWorld.elements;
    this.start(me[12], me[13], me[14], (z) => { if (!on[z]) { on[z] = 1; setRect(z, -1, -1, 1, 1); push(z); } });
    const tmp = this._tmp ||= new Float64Array(4);
    const cam = this._cam ||= new Float64Array(3);
    cam[0] = me[12]; cam[1] = me[13]; cam[2] = me[14];
    while (head < tail) {
      const z = queue[head++];
      const r0 = rect[z * 4], r1 = rect[z * 4 + 1], r2 = rect[z * 4 + 2], r3 = rect[z * 4 + 3];
      for (const p of this.byZone[z]) {
        if ((cam[p.ax] - p.plane) * p.s > SIDE) continue;
        if (!this.portalRect(p.box, r0, r1, r2, r3, tmp)) continue;
        const t = p.to;
        if (!on[t]) { on[t] = 1; setRect(t, tmp[0], tmp[1], tmp[2], tmp[3]); push(t); continue; }
        // seen through another opening too: grow the rectangle, and pass the growth on
        const a = rect[t * 4], b = rect[t * 4 + 1], c = rect[t * 4 + 2], d = rect[t * 4 + 3];
        const na = Math.min(a, tmp[0]), nb = Math.min(b, tmp[1]), nc = Math.max(c, tmp[2]), nd = Math.max(d, tmp[3]);
        if (na < a - 1e-4 || nb < b - 1e-4 || nc > c + 1e-4 || nd > d + 1e-4) { setRect(t, na, nb, nc, nd); push(t); }
      }
    }
    if (overflow) for (let z = 0; z < n; z++) { on[z] = 1; setRect(z, -1, -1, 1, 1); }   // (never seen: then everything is seen)
    // the four planes of each seen zone's sub-frustum (x >= x0, x <= x1, y >= y0, y <= y1)
    const pl = this.plane;
    for (let z = 0; z < n; z++) {
      if (!on[z]) continue;
      const x0 = rect[z * 4], y0 = rect[z * 4 + 1], x1 = rect[z * 4 + 2], y1 = rect[z * 4 + 3];
      const put = (k, a, b, c, d) => { const l = Math.hypot(a, b, c) || 1; pl[z * 16 + k * 4] = a / l; pl[z * 16 + k * 4 + 1] = b / l; pl[z * 16 + k * 4 + 2] = c / l; pl[z * 16 + k * 4 + 3] = d / l; };
      put(0, e[0] - x0 * e[3], e[4] - x0 * e[7], e[8] - x0 * e[11], e[12] - x0 * e[15]);
      put(1, x1 * e[3] - e[0], x1 * e[7] - e[4], x1 * e[11] - e[8], x1 * e[15] - e[12]);
      put(2, e[1] - y0 * e[3], e[5] - y0 * e[7], e[9] - y0 * e[11], e[13] - y0 * e[15]);
      put(3, y1 * e[3] - e[1], y1 * e[7] - e[5], y1 * e[11] - e[9], y1 * e[15] - e[13]);
    }
    for (const it of this.items) {
      let vis = false;
      for (const z of it.zones) {
        if (!on[z]) continue;
        const o = z * 16;
        let inside = true;
        for (let k = 0; k < 4 && inside; k++) {
          const q = o + k * 4;
          if (pl[q] * it.cx + pl[q + 1] * it.cy + pl[q + 2] * it.cz + pl[q + 3] < -it.r) inside = false;
        }
        if (inside) { vis = true; break; }
      }
      it.mesh.visible = vis;
    }
  }

  // Can a sphere at (x, y, z) be seen: is it in a seen zone, and in the part of the screen that
  // zone is seen through? (For things that are not palace meshes, such as the machines.)
  sees(x, y, z, r = 0) {
    const pl = this.plane, m = r + 0.3;
    const test = (zn) => {
      if (!this.on[zn]) return false;
      for (let k = 0; k < 4; k++) {
        const q = zn * 16 + k * 4;
        if (pl[q] * x + pl[q + 1] * y + pl[q + 2] * z + pl[q + 3] < -r) return false;
      }
      return true;
    };
    // in a room: only that room can show it; in a wall or outside: the rooms near it, or OUT
    let strict = false;
    for (let i = 0; i < ROOMS.length; i++) {
      const b = ROOMS[i].b;
      if (x > b[0] + r && x < b[3] - r && y > b[1] && y < Math.min(b[4], SKY) && z > b[2] + r && z < b[5] - r) { strict = true; if (test(i)) return true; }
    }
    if (strict) return false;
    for (let i = 0; i < ROOMS.length; i++) {
      const b = ROOMS[i].b;
      if (x > b[0] - m && x < b[3] + m && y > b[1] - m && y < Math.min(b[4], SKY) + m && z > b[2] - m && z < b[5] + m && test(i)) return true;
    }
    return test(OUT);
  }
}
