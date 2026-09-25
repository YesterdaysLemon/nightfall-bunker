// "The Bunker" — a two-storey airfield command post surrounded by a dead
// courtyard. Pure data plus deterministic builders so the client renderer,
// the client physics and the authoritative simulation all read one source.
//
// Axes: +x east, +z south, +y up. Metres.

export const T = 0.3;                 // wall thickness
export const LOFT_Y = 3.2;            // loft floor top
export const SLAB_BOTTOM = 3.0;       // ground-floor ceiling
export const ROOF_Y = 6.2;            // loft ceiling / roof slab bottom
export const ROOF_TOP = 6.5;

// Outer wall centre lines.
export const BX0 = -16, BX1 = 8, BZ0 = -6, BZ1 = 6;
// Interior faces.
export const IX0 = BX0 + T / 2, IX1 = BX1 - T / 2, IZ0 = BZ0 + T / 2, IZ1 = BZ1 - T / 2;

const WIN_W = 1.4;
const SILL = 0.9;
const WIN_TOP = 2.2;

export const ZONES = ['start', 'help', 'loft'];

// Windows zombies tear into. `n` is the outward normal.
export const WINDOWS = [
  { id: 0, zone: 'start', level: 0, x: -2.5, z: BZ0, n: [0, -1] },
  { id: 1, zone: 'start', level: 0, x: 4.5, z: BZ0, n: [0, -1] },
  { id: 2, zone: 'start', level: 0, x: BX1, z: -1.0, n: [1, 0] },
  { id: 3, zone: 'start', level: 0, x: -3.0, z: BZ1, n: [0, 1] },
  { id: 4, zone: 'help', level: 0, x: BX0, z: 1.0, n: [-1, 0] },
  { id: 5, zone: 'help', level: 0, x: -11.0, z: BZ1, n: [0, 1] },
  { id: 6, zone: 'help', level: 0, x: -14.2, z: BZ0, n: [0, -1] },
  { id: 7, zone: 'loft', level: 1, x: -3.0, z: BZ0, n: [0, -1] },
  { id: 8, zone: 'loft', level: 1, x: 4.0, z: BZ0, n: [0, -1] },
].map((w) => {
  const base = w.level ? LOFT_Y : 0;
  const nx = w.n[0], nz = w.n[1];
  return {
    ...w,
    width: WIN_W,
    base,
    sill: base + SILL,
    top: base + WIN_TOP,
    // Where a zombie stands to tear boards, and where it lands inside.
    outside: [w.x + nx * 0.75, base, w.z + nz * 0.75],
    inside: [w.x - nx * 0.9, base, w.z - nz * 0.9],
    // Players must stand here-ish to rebuild.
    repair: [w.x - nx * 1.1, base, w.z - nz * 1.1],
    boards: 6,
  };
});

export const MAX_BOARDS = 6;

// Stairs: solid step columns. `dir` is the direction of ascent along `axis`.
export const STAIRS = [
  { id: 'A', axis: 'x', dir: 1, start: 0.6, a0: IZ1 - 1.5, a1: IZ1, steps: 16, run: 0.3, rise: 0.2 },
  { id: 'B', axis: 'x', dir: -1, start: -8.0, a0: IZ0, a1: IZ0 + 1.5, steps: 16, run: 0.3, rise: 0.2 },
];

// Purchasable blockers.
export const DOORS = [
  {
    id: 'helpDoor', name: 'Door', cost: 1000, opens: ['help'], kind: 'door',
    box: [-6 - T / 2, 0, -1.1, -6 + T / 2, 2.4, 1.1],
    use: [[-5.2, 0, 0], [-6.8, 0, 0]],
  },
  {
    id: 'debrisA', name: 'Debris', cost: 1000, opens: ['loft'], kind: 'debris',
    box: [-0.6, 0, IZ1 - 1.5, 0.6, 2.0, IZ1],
    use: [[-1.2, 0, IZ1 - 0.75], [5.9, LOFT_Y, IZ1 - 0.75]],
  },
  {
    id: 'debrisB', name: 'Debris', cost: 1000, opens: ['loft'], kind: 'debris',
    box: [-8.0, 0, IZ0, -6 - T / 2, 2.0, IZ0 + 1.5],
    use: [[-7.0, 0, IZ0 + 2.3], [-13.3, LOFT_Y, IZ0 + 0.75]],
  },
];

// Chalk outlines on the walls. `face` is the wall normal pointing into the room.
export const WALL_BUYS = [
  { id: 'wb_kar', weapon: 'kar98k', pos: [1.0, 1.55, IZ0], face: [0, 1] },
  { id: 'wb_carbine', weapon: 'm1carbine', pos: [IX1, 1.55, 3.3], face: [-1, 0] },
  { id: 'wb_thompson', weapon: 'thompson', pos: [IX0, 1.55, -2.6], face: [1, 0] },
  { id: 'wb_db', weapon: 'doublebarrel', pos: [-14.0, 1.55, IZ1], face: [0, -1] },
  { id: 'wb_mp40', weapon: 'mp40', pos: [-10.0, LOFT_Y + 1.55, IZ1], face: [0, -1] },
  { id: 'wb_trench', weapon: 'trenchgun', pos: [IX0, LOFT_Y + 1.55, 2.2], face: [1, 0] },
  { id: 'wb_bar', weapon: 'bar', pos: [IX1, LOFT_Y + 1.55, 0.4], face: [-1, 0] },
].map((b) => ({ ...b, zone: zoneAt(b.pos[0], b.pos[1], b.pos[2]) }));

export const MYSTERY_BOX = { id: 'box', pos: [-3.2, LOFT_Y, IZ1 - 0.45], yaw: 0, size: [1.5, 0.62, 0.7], zone: 'loft' };

export const PLAYER_SPAWNS = [
  [-1.5, 0, 1.5, Math.PI], [1.5, 0, 1.5, Math.PI], [-1.5, 0, -1.5, 0], [1.5, 0, -1.5, 0],
];

export const RADIO = { pos: [7.05, 0.86, -5.2] };

export function zoneAt(x, y, z) {
  if (y > SLAB_BOTTOM - 0.4) return 'loft';
  if (x < -6) return 'help';
  return 'start';
}

// Balcony along the north face, outside the loft windows.
export const BALCONY = { x0: -5.6, x1: 6.6, z0: -8.9, z1: BZ0 - T / 2, y: LOFT_Y };

// Spawn points. Ground windows: zombies claw out of the dirt in the courtyard.
// Loft windows: zombies climb a ladder onto the balcony.
export const SPAWNS = (() => {
  const out = [];
  for (const w of WINDOWS) {
    if (w.level === 0) {
      const [nx, nz] = w.n;
      const tx = -nz, tz = nx; // tangent
      for (const [d, s] of [[7.5, -1.6], [9.5, 1.8]]) {
        out.push({ window: w.id, zone: w.zone, rise: true, pos: [w.x + nx * d + tx * s, 0, w.z + nz * d + tz * s] });
      }
    }
  }
  out.push({ window: 7, zone: 'loft', rise: true, ladder: true, pos: [BALCONY.x0 + 0.5, LOFT_Y, -7.9] });
  out.push({ window: 8, zone: 'loft', rise: true, ladder: true, pos: [BALCONY.x1 - 0.5, LOFT_Y, -7.9] });
  return out;
})();

// Warm bulbs and fires. Constant count keeps the shader stable.
export const LIGHTS = [
  { pos: [-2.4, 2.55, -0.6], color: 0xffc98f, intensity: 26, distance: 13, flicker: 0.25 },
  { pos: [4.6, 2.55, 1.6], color: 0xffbd7a, intensity: 22, distance: 12, flicker: 0.6 },
  { pos: [-11, 2.55, 0.4], color: 0xffb370, intensity: 22, distance: 12, flicker: 1.0 },
  { pos: [-10.5, 5.75, 0.8], color: 0xffc98f, intensity: 22, distance: 13, flicker: 0.4 },
  { pos: [2.5, 5.75, -0.8], color: 0xffbd7a, intensity: 22, distance: 13, flicker: 0.2 },
  { pos: [1.5, 1.6, -21], color: 0xff6a1f, intensity: 60, distance: 30, flicker: 1.6, fire: true },
];

// ---------------------------------------------------------------------------
// Geometry builders. Boxes are [x0,y0,z0,x1,y1,z1] plus tags.

function box(x0, y0, z0, x1, y1, z1, tag) {
  return { b: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag };
}

// A wall between p0 and p1 along one axis with rectangular holes.
// holes: [{a, b, y0, y1}] positions along the axis.
function wallRun(axis, c, p0, p1, y0, y1, holes, tag, thick = T) {
  const out = [];
  const mk = (a, b, ya, yb) => {
    if (b - a < 1e-3 || yb - ya < 1e-3) return;
    out.push(axis === 'x'
      ? box(a, ya, c - thick / 2, b, yb, c + thick / 2, tag)
      : box(c - thick / 2, ya, a, c + thick / 2, yb, b, tag));
  };
  const hs = holes.filter((h) => h.b > p0 && h.a < p1).sort((m, n) => m.a - n.a);
  let cur = p0;
  for (const h of hs) {
    mk(cur, h.a, y0, y1);
    mk(h.a, h.b, y0, Math.max(y0, h.y0));
    mk(h.a, h.b, Math.min(y1, h.y1), y1);
    cur = h.b;
  }
  mk(cur, p1, y0, y1);
  return out;
}

function windowHoles(filter) {
  return WINDOWS.filter(filter).map((w) => {
    const along = w.n[0] === 0 ? w.x : w.z;
    return { a: along - w.width / 2, b: along + w.width / 2, y0: w.sill, y1: w.top };
  });
}

function slabWithHoles(x0, z0, x1, z1, y0, y1, holes, tag) {
  // Split a rectangle by hole rectangles into non-overlapping boxes using x-cuts.
  const xs = new Set([x0, x1]);
  for (const h of holes) { xs.add(Math.max(x0, Math.min(x1, h[0]))); xs.add(Math.max(x0, Math.min(x1, h[2]))); }
  const xa = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xa.length - 1; i++) {
    const a = xa[i], b = xa[i + 1];
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const cuts = holes.filter((h) => mid > h[0] && mid < h[2]).map((h) => [h[1], h[3]]).sort((m, n) => m[0] - n[0]);
    let cz = z0;
    for (const [h0, h1] of cuts) {
      if (h0 > cz) out.push(box(a, y0, cz, b, y1, h0, tag));
      cz = Math.max(cz, h1);
    }
    if (z1 > cz) out.push(box(a, y0, cz, b, y1, z1, tag));
  }
  return out;
}

export function stairFootprint(s) {
  const len = s.steps * s.run;
  const x0 = s.dir > 0 ? s.start : s.start - len;
  const x1 = s.dir > 0 ? s.start + len : s.start;
  return [x0, s.a0, x1, s.a1];
}

// Continuous ramp height used for smooth zombie movement on stairs.
export function stairHeightAt(x, z) {
  for (const s of STAIRS) {
    const [x0, z0, x1, z1] = stairFootprint(s);
    if (x >= x0 - 0.05 && x <= x1 + 0.05 && z >= z0 && z <= z1) {
      const u = s.dir > 0 ? (x - s.start) : (s.start - x);
      return Math.max(0, Math.min(LOFT_Y, (u / (s.steps * s.run)) * LOFT_Y));
    }
  }
  return null;
}

function buildStairs() {
  const out = [];
  for (const s of STAIRS) {
    for (let i = 0; i < s.steps; i++) {
      const a = s.dir > 0 ? s.start + i * s.run : s.start - (i + 1) * s.run;
      const top = (i + 1) * s.rise;
      out.push(box(a, 0, s.a0, a + s.run, top, s.a1, 'step'));
      // Side balustrade on the open side of the flight (full height collider).
      const side = s.a0 < 0 ? s.a1 : s.a0; // open side faces the room centre
      const sz0 = s.a0 < 0 ? side : side - 0.1;
      const sz1 = s.a0 < 0 ? side + 0.1 : side;
      out.push(box(a - (i === 0 && s.dir > 0 ? 0.05 : 0), 0, sz0, a + s.run + (i === 0 && s.dir < 0 ? 0.05 : 0), top + 1.0, sz1, 'rail'));
    }
  }
  return out;
}

export const STAIR_HOLES = STAIRS.map(stairFootprint);

export function buildStaticBoxes() {
  const out = [];
  // Exterior walls: ground band then loft band so window holes don't overlap.
  const bands = [[0, LOFT_Y, 0], [LOFT_Y, ROOF_Y, 1]];
  for (const [y0, y1, lv] of bands) {
    out.push(...wallRun('x', BZ0, BX0 - T / 2, BX1 + T / 2, y0, y1, windowHoles((w) => w.level === lv && w.z === BZ0), 'ext'));
    out.push(...wallRun('x', BZ1, BX0 - T / 2, BX1 + T / 2, y0, y1, windowHoles((w) => w.level === lv && w.z === BZ1), 'ext'));
    out.push(...wallRun('z', BX0, IZ0, IZ1, y0, y1, windowHoles((w) => w.level === lv && w.x === BX0), 'ext'));
    out.push(...wallRun('z', BX1, IZ0, IZ1, y0, y1, windowHoles((w) => w.level === lv && w.x === BX1), 'ext'));
  }
  // Interior partition between start room and help room (door hole is filled by the door blocker).
  out.push(...wallRun('z', -6, IZ0, IZ1, 0, SLAB_BOTTOM, [{ a: -1.1, b: 1.1, y0: 0, y1: 2.4 }], 'int'));
  // Loft partition with a wide central opening.
  out.push(...wallRun('z', -6, IZ0, IZ1, LOFT_Y, ROOF_Y, [{ a: -2.4, b: 2.4, y0: LOFT_Y, y1: LOFT_Y + 2.5 }], 'loftwall'));
  // Ground floor (thin, visual) and loft slab with stair holes.
  out.push(box(IX0, -0.12, IZ0, IX1, 0, IZ1, 'floor0'));
  out.push(...slabWithHoles(IX0, IZ0, IX1, IZ1, SLAB_BOTTOM, LOFT_Y, STAIR_HOLES, 'slab'));
  out.push(box(BX0 - T / 2 - 0.25, ROOF_Y, BZ0 - T / 2 - 0.25, BX1 + T / 2 + 0.25, ROOF_TOP, BZ1 + T / 2 + 0.25, 'roof'));
  out.push(...buildStairs());
  // Loft railings around the stairwell holes, leaving the stair-top ends open.
  const [ax0, az0, ax1, az1] = STAIR_HOLES[0];
  out.push(box(ax0 - 0.1, LOFT_Y, az0 - 0.1, ax1, LOFT_Y + 1.0, az0, 'rail'));
  out.push(box(ax0 - 0.1, LOFT_Y, az0, ax0, LOFT_Y + 1.0, az1, 'rail'));
  const [bx0, bz0, bx1, bz1] = STAIR_HOLES[1];
  out.push(box(bx0, LOFT_Y, bz1, bx1 + 0.1, LOFT_Y + 1.0, bz1 + 0.1, 'rail'));
  out.push(box(bx1, LOFT_Y, bz0, bx1 + 0.1, LOFT_Y + 1.0, bz1, 'rail'));
  // Loft support pillars.
  for (const [px, pz] of [[-11, 1.8], [2.2, 1.6]]) {
    out.push(box(px - 0.2, LOFT_Y, pz - 0.2, px + 0.2, ROOF_Y, pz + 0.2, 'pillar'));
  }
  // Furniture that blocks movement.
  for (const p of FURNITURE) if (p.solid) out.push(box(...p.solid, 'prop'));
  return out;
}

// Window blockers: players can never pass a window; zombies climb through.
export function windowBlockers() {
  return WINDOWS.map((w) => {
    const hx = w.n[0] === 0 ? w.width / 2 : T / 2 + 0.05;
    const hz = w.n[0] === 0 ? T / 2 + 0.05 : w.width / 2;
    return box(w.x - hx, w.sill, w.z - hz, w.x + hx, w.top, w.z + hz, 'window');
  });
}

// Interior furniture. `solid` is the collider; `kind` drives the visual.
export const FURNITURE = [
  { kind: 'table', pos: [6.7, 0, 1.5], yaw: Math.PI / 2, solid: [6.1, 0, 0.6, 7.3, 0.82, 2.4] },
  { kind: 'radioTable', pos: [7.05, 0, -5.2], yaw: 0, solid: [6.3, 0, -5.85, 7.85, 0.85, -4.6] },
  { kind: 'crates', pos: [-4.9, 0, -4.8], yaw: 0.3, solid: [-5.85, 0, -5.85, -4.1, 1.2, -3.9] },
  { kind: 'chair', pos: [5.6, 0, 1.2], yaw: 1.4 },
  { kind: 'chairFallen', pos: [-1.2, 0, 3.2], yaw: 0.8 },
  { kind: 'shelf', pos: [7.4, 0, 5.2], yaw: -Math.PI / 2, solid: [7.0, 0, 4.2, 7.85, 2.0, 5.85] },
  { kind: 'operatingTable', pos: [-11.8, 0, 2.6], yaw: 0, solid: [-13.0, 0, 2.1, -10.6, 0.9, 3.1] },
  { kind: 'cabinet', pos: [-15.4, 0, 4.6], yaw: Math.PI / 2, solid: [-15.85, 0, 3.8, -14.9, 1.9, 5.4] },
  { kind: 'cot', pos: [-8.2, LOFT_Y, 4.6], yaw: 0, solid: [-9.3, LOFT_Y, 4.1, -7.1, LOFT_Y + 0.5, 5.1] },
  { kind: 'cot', pos: [-13.8, LOFT_Y, 4.6], yaw: 0, solid: [-14.9, LOFT_Y, 4.1, -12.7, LOFT_Y + 0.5, 5.1] },
  { kind: 'sandbags', pos: [6.8, LOFT_Y, -4.6], yaw: 0, solid: [5.9, LOFT_Y, -5.85, 7.85, LOFT_Y + 0.9, -3.9] },
  { kind: 'crates', pos: [-15.0, LOFT_Y, -1.6], yaw: 0.1, solid: [-15.85, LOFT_Y, -2.6, -14.1, LOFT_Y + 1.2, -0.7] },
  { kind: 'desk', pos: [0.2, LOFT_Y, -4.9], yaw: 0, solid: [-0.8, LOFT_Y, -5.85, 1.2, LOFT_Y + 0.8, -4.3] },
];

// Outside set dressing (render only). Zombies never path near these.
export const EXTERIOR = {
  plane: { pos: [1.5, 0, -22], yaw: 0.35 },
  truck: { pos: [18, 0, 9], yaw: -1.2 },
  tower: { pos: [-26, 0, -16] },
  trees: [
    [-30, -4], [-24, 14], [-8, 22], [14, 24], [26, -2], [22, -18], [-18, -26], [8, -34],
    [-36, 8], [32, 14], [-12, -34], [34, -22], [-40, -14], [0, 30], [-28, 26],
  ],
  sandbags: [
    [-9, -16, 0.2, 4], [11, -14, -0.3, 4], [15, 3.5, 1.3, 3], [-21, 6, 1.6, 4], [-5, 20, 0, 5], [-18, -9, 0.9, 3],
  ],
  wire: [
    [[-32, -30], [32, -30]], [[32, -30], [32, 26]], [[32, 26], [-32, 26]], [[-32, 26], [-32, -30]],
  ],
  barrels: [[12, -8], [12.8, -7.4], [-20, -3], [-6, 13], [10.5, 11]],
  crates: [[16, -5, 0.4], [-22, 10, 1.1], [3, 15, 0.2]],
  runway: { z0: 30, z1: 46, x0: -120, x1: 120 },
  hangar: { pos: [-40, 0, 52], size: [34, 14, 22] },
};
