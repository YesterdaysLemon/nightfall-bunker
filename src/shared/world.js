// Collision world: axis-aligned boxes in a coarse spatial hash. Used by the
// client for the local player and by the simulation for grenades,
// projectiles and zombie line-of-sight.

import { buildStaticBoxes, windowBlockers, DOORS } from './map.js';

const CELL = 2;
const GX0 = -24, GZ0 = -14, GW = 22, GH = 14; // hash covers x [-24, 20], z [-14, 14]

export const PLAYER_RADIUS = 0.32;
export const STEP_HEIGHT = 0.45;
export const GRAVITY = 19;

export class World {
  constructor() {
    this.static = buildStaticBoxes();
    this.windows = windowBlockers();
    this.doors = DOORS.map((d) => ({ b: [...d.box], tag: d.kind, door: d.id }));
    this.openDoors = new Set();
    this.version = 0;
    this.rebuild();
  }

  setDoorOpen(id) {
    if (this.openDoors.has(id)) return;
    this.openDoors.add(id);
    this.rebuild();
  }

  rebuild() {
    const doors = this.doors.filter((d) => !this.openDoors.has(d.door));
    // Movement colliders (players): everything, including window blockers.
    this.solid = pack([...this.static, ...this.windows, ...doors]);
    // Bullets and grenades pass through window openings.
    this.ray = pack([...this.static, ...doors]);
    this.solidHash = hash(this.solid);
    this.rayHash = hash(this.ray);
    this.version++;
  }

  // --- Character movement -------------------------------------------------
  // s: {x,y,z,vx,vy,vz,onGround,height}. Mutates s. Returns stepped-up amount.
  moveCharacter(s, dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    let stepped = 0;
    for (let i = 0; i < steps; i++) stepped += this._moveStep(s, h);
    return stepped;
  }

  _moveStep(s, dt) {
    const r = PLAYER_RADIUS;
    const wasGround = s.onGround;
    s.vy -= GRAVITY * dt;
    let x = s.x + s.vx * dt;
    let z = s.z + s.vz * dt;
    const feet = s.y, head = s.y + s.height;
    for (let it = 0; it < 3; it++) {
      const p = this._pushOut(x, z, feet + STEP_HEIGHT, head, r);
      if (!p) break;
      x = p[0]; z = p[1];
    }
    s.x = x; s.z = z;

    let y = s.y + s.vy * dt;
    const ground = this.groundHeight(x, z, s.y + STEP_HEIGHT, r * 0.72);
    let stepped = 0;
    if (y <= ground) {
      if (ground > s.y + 1e-3) stepped = ground - s.y;
      y = ground; s.vy = 0; s.onGround = true;
    } else if (wasGround && s.vy <= 0 && s.y - ground < STEP_HEIGHT + 0.05) {
      y = ground; s.vy = 0; s.onGround = true; // stick to stairs going down
    } else {
      s.onGround = false;
    }
    const ceil = this.ceilingHeight(x, z, y + STEP_HEIGHT, r * 0.72);
    if (y + s.height > ceil) { y = Math.max(ground, ceil - s.height); if (s.vy > 0) s.vy = 0; }
    s.y = y;
    return stepped;
  }

  _pushOut(x, z, y0, y1, r) {
    const B = this.solid;
    let moved = false;
    for (const i of query(this.solidHash, x - r, z - r, x + r, z + r)) {
      const o = i * 6;
      if (B[o + 4] <= y0 || B[o + 1] >= y1) continue;
      const cx = x < B[o] ? B[o] : x > B[o + 3] ? B[o + 3] : x;
      const cz = z < B[o + 2] ? B[o + 2] : z > B[o + 5] ? B[o + 5] : z;
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the shallowest axis.
        const l = x - B[o], rr = B[o + 3] - x, n = z - B[o + 2], f = B[o + 5] - z;
        const m = Math.min(l, rr, n, f);
        if (m === l) x = B[o] - r; else if (m === rr) x = B[o + 3] + r;
        else if (m === n) z = B[o + 2] - r; else z = B[o + 5] + r;
      }
      moved = true;
    }
    return moved ? [x, z] : null;
  }

  // Highest walkable top at or below maxY under a disc.
  groundHeight(x, z, maxY, r = 0.2) {
    const B = this.solid;
    let g = 0;
    for (const i of query(this.solidHash, x - r, z - r, x + r, z + r)) {
      const o = i * 6;
      const top = B[o + 4];
      if (top > maxY || top <= g) continue;
      if (x + r < B[o] || x - r > B[o + 3] || z + r < B[o + 2] || z - r > B[o + 5]) continue;
      g = top;
    }
    return g;
  }

  ceilingHeight(x, z, minY, r = 0.2) {
    const B = this.solid;
    let c = Infinity;
    for (const i of query(this.solidHash, x - r, z - r, x + r, z + r)) {
      const o = i * 6;
      const bot = B[o + 1];
      if (bot < minY || bot >= c) continue;
      if (x + r < B[o] || x - r > B[o + 3] || z + r < B[o + 2] || z - r > B[o + 5]) continue;
      c = bot;
    }
    return c;
  }

  // --- Raycast --------------------------------------------------------------
  // Returns distance to the first hit (walls, floors, doors, ground plane) or
  // maxDist. Normal of the hit is written to `outN` when provided.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, outN) {
    if (dx === 0) dx = 1e-9;
    if (dy === 0) dy = 1e-9;
    if (dz === 0) dz = 1e-9;
    let best = maxDist;
    let nx = 0, ny = 0, nz = 0;
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t >= 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; }
    }
    const B = this.ray;
    const ex = ox + dx * best, ez = oz + dz * best;
    const idx = query(this.rayHash, Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    for (const i of idx) {
      const o = i * 6;
      let t0 = (B[o] - ox) * ix, t1 = (B[o + 3] - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      let ax = 0;
      t0 = (B[o + 1] - oy) * iy; t1 = (B[o + 4] - oy) * iy;
      let a = Math.min(t0, t1), b = Math.max(t0, t1);
      if (a > tmin) { tmin = a; ax = 1; }
      if (b < tmax) tmax = b;
      t0 = (B[o + 2] - oz) * iz; t1 = (B[o + 5] - oz) * iz;
      a = Math.min(t0, t1); b = Math.max(t0, t1);
      if (a > tmin) { tmin = a; ax = 2; }
      if (b < tmax) tmax = b;
      if (tmax < 0 || tmin > tmax || tmin >= best) continue;
      if (tmin < 0) continue; // origin inside a box: ignore it
      best = tmin;
      nx = ax === 0 ? -Math.sign(dx) : 0;
      ny = ax === 1 ? -Math.sign(dy) : 0;
      nz = ax === 2 ? -Math.sign(dz) : 0;
    }
    if (outN) { outN[0] = nx; outN[1] = ny; outN[2] = nz; }
    return best;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len) >= len - 1e-3;
  }
}

// --- Hitboxes ----------------------------------------------------------------
// Zombie hit volumes relative to its feet. `lift` shifts them (rising out of
// the ground is negative). Parts: 0 head, 1 torso, 2 legs.
export function zombieHitTest(ox, oy, oz, dx, dy, dz, zx, zy, zz, maxDist) {
  // Head sphere.
  let best = maxDist, part = -1;
  let t = raySphere(ox, oy, oz, dx, dy, dz, zx, zy + 1.63, zz, 0.17);
  if (t >= 0 && t < best) { best = t; part = 0; }
  t = rayCapsuleY(ox, oy, oz, dx, dy, dz, zx, zz, zy + 0.95, zy + 1.35, 0.24);
  if (t >= 0 && t < best) { best = t; part = 1; }
  t = rayCapsuleY(ox, oy, oz, dx, dy, dz, zx, zz, zy + 0.08, zy + 0.95, 0.2);
  if (t >= 0 && t < best) { best = t; part = 2; }
  return part < 0 ? null : { t: best, part };
}

// Hound hit volumes: a skull sphere out front and three spheres along the body,
// all following the hound's yaw (facing +Z rotated by yaw). Parts: 0 head, 1 body.
export function houndHitTest(ox, oy, oz, dx, dy, dz, hx, hy, hz, yaw, maxDist) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = maxDist, part = -1;
  let t = raySphere(ox, oy, oz, dx, dy, dz, hx + fx * 0.6, hy + 0.62, hz + fz * 0.6, 0.16);
  if (t >= 0 && t < best) { best = t; part = 0; }
  for (const [f, y, r] of [[0.28, 0.55, 0.22], [-0.05, 0.52, 0.21], [-0.38, 0.5, 0.19]]) {
    t = raySphere(ox, oy, oz, dx, dy, dz, hx + fx * f, hy + y, hz + fz * f, r);
    if (t >= 0 && t < best) { best = t; part = 1; }
  }
  return part < 0 ? null : { t: best, part };
}

// Any enemy by class: hounds are quadrupeds, everything else is humanoid.
export function enemyHitTest(cls, ox, oy, oz, dx, dy, dz, x, y, z, yaw, maxDist) {
  return cls === 3
    ? houndHitTest(ox, oy, oz, dx, dy, dz, x, y, z, yaw, maxDist)
    : zombieHitTest(ox, oy, oz, dx, dy, dz, x, y, z, maxDist);
}

// Exported for small props (the easter-egg teacups).
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  return t >= 0 ? t : (-b + s >= 0 ? 0 : -1);
}

// Vertical capsule: infinite cylinder clipped to [y0,y1] plus end spheres.
function rayCapsuleY(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r) {
  let best = -1;
  const lx = ox - cx, lz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = lx * dx + lz * dz;
    const c = lx * lx + lz * lz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

// --- Packing & spatial hash ------------------------------------------------------
function pack(list) {
  const a = new Float32Array(list.length * 6);
  list.forEach((bx, i) => a.set(bx.b, i * 6));
  return a;
}

function hash(B) {
  const cells = Array.from({ length: GW * GH }, () => []);
  const n = B.length / 6;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const c0 = clampI(Math.floor((B[o] - GX0) / CELL), GW), c1 = clampI(Math.floor((B[o + 3] - GX0) / CELL), GW);
    const r0 = clampI(Math.floor((B[o + 2] - GZ0) / CELL), GH), r1 = clampI(Math.floor((B[o + 5] - GZ0) / CELL), GH);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * GW + c].push(i);
  }
  return { cells, n, seen: new Uint32Array(n), stamp: 1, out: [] };
}

function clampI(v, n) { return v < 0 ? 0 : v >= n ? n - 1 : v; }

// Deduplicated box indices overlapping an xz rectangle. The returned array is
// reused between calls: consume it before querying again.
function query(h, x0, z0, x1, z1) {
  const out = h.out; out.length = 0;
  if (x1 < GX0 || z1 < GZ0 || x0 > GX0 + GW * CELL || z0 > GZ0 + GH * CELL) return out;
  const stamp = ++h.stamp;
  if (stamp > 0xfffffff0) { h.seen.fill(0); h.stamp = 1; }
  const c0 = clampI(Math.floor((x0 - GX0) / CELL), GW), c1 = clampI(Math.floor((x1 - GX0) / CELL), GW);
  const r0 = clampI(Math.floor((z0 - GZ0) / CELL), GH), r1 = clampI(Math.floor((z1 - GZ0) / CELL), GH);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const i of h.cells[r * GW + c]) {
        if (h.seen[i] === stamp) continue;
        h.seen[i] = stamp; out.push(i);
      }
    }
  }
  return out;
}
