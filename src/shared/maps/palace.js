// "The Aurora Picture Palace": a boarded-up 1960s movie theatre at night. The
// second map, and the big one: a ring of rooms around the auditorium.
//
//   Foyer (start) ──750── Stair Hall ─(stairs up)─1000── Dressing Rooms (upper) ─1000─┐
//     │                                                                                 ├─ Auditorium + Stage
//     └──750── Box Office ──1000── Alley (outdoors) ─────────────1000─ side door ───────┘
//   Stage ──750── Backstage (the Main Breaker)      Stage alcove (behind a curtain): the Forge
//   Magic Lantern teleporter: link a pad (dressing rooms, alley) at the lantern on stage,
//   then ride it for 1500: everyone on the pad spends 30 s in the Projection Booth above
//   the foyer and comes back on the stage. The first ride opens the curtain on the Forge.
//
// Axes: +x east, +z south (the street), +y up. Metres. Floors: the ground (0), the
// stage and backstage (1.2), the dressing rooms (3.6) and the booth (7.2).

import { box, wallRun, slabWithHoles, makeWindows, windowHoles, windowBlockers, stairBoxes, rampHeight, stairFootprint, defineMap } from '../mapkit.js';

const T = 0.3;
const STAGE_Y = 1.2, UP_Y = 3.6, BOOTH_Y = 7.2;

export const ZONES = ['start', 'stairhall', 'dressing', 'boxoffice', 'alley', 'theatre', 'backstage', 'forge', 'booth'];

// Where a spot belongs (wall buys, the box, perks, spawns).
export function zoneAt(x, y, z) {
  if (y > BOOTH_Y - 0.8 && x > -5 && x < 5 && z > 6 && z < 10) return 'booth';
  if (x < -12 && z < 6) return 'dressing';
  if (x < -11 && z >= 6) return 'stairhall';
  if (x > 11 && z >= 6) return 'boxoffice';
  if (x > 12 && z < 6) return 'alley';
  if (z < -22 && z > -25.6 && x > -2.5 && x < 2.5) return 'forge';
  if (z < -22) return 'backstage';
  if (z < 6) return 'theatre';
  return 'start';
}

// --- Windows (boarded barriers) ------------------------------------------------------------
export const WINDOWS = makeWindows([
  // The street front: two boarded ticket windows and the boarded front doors.
  { id: 0, zone: 'start', x: -6, z: 20, n: [0, 1] },
  { id: 1, zone: 'start', x: 6, z: 20, n: [0, 1] },
  { id: 2, zone: 'start', x: 0, z: 20, n: [0, 1], width: 2.0, sill: 0.5, top: 2.4 },
  { id: 3, zone: 'stairhall', x: -18, z: 8, n: [-1, 0] },
  { id: 4, zone: 'stairhall', x: -14.5, z: 20, n: [0, 1] },
  { id: 5, zone: 'boxoffice', x: 18, z: 12, n: [1, 0] },
  // Dressing rooms: onto the fire escape.
  { id: 6, zone: 'dressing', x: -18, z: -2, n: [-1, 0], base: UP_Y },
  { id: 7, zone: 'dressing', x: -18, z: -16, n: [-1, 0], base: UP_Y },
  // Auditorium: from the old cellar passage under the dressing rooms.
  { id: 8, zone: 'theatre', x: -12, z: -3, n: [-1, 0] },
  { id: 9, zone: 'theatre', x: -12, z: -10, n: [-1, 0] },
  // Alley: the derelict building next door.
  { id: 10, zone: 'alley', x: 18, z: -3, n: [1, 0] },
  { id: 11, zone: 'alley', x: 18, z: -17, n: [1, 0] },
  // Backstage: the loading dock.
  { id: 12, zone: 'backstage', x: -6, z: -30, n: [0, -1], base: STAGE_Y },
  { id: 13, zone: 'backstage', x: 6, z: -30, n: [0, -1], base: STAGE_Y },
]);

// Spawn points outside each window. Upper windows (dressing rooms, dock) get a
// ladder climb instead of rising out of the dirt.
export const SPAWNS = (() => {
  const out = [];
  const far = { 0: [6.5, 8.5], 1: [6.5, 8.5], 2: [7, 9.5], 3: [5, 7], 4: [5, 7], 5: [5, 7], 8: [2.2, 3.6], 9: [2.2, 3.6], 10: [2.4, 3.6], 11: [2.4, 3.6] };
  for (const w of WINDOWS) {
    const [nx, nz] = w.n, tx = -nz, tz = nx;
    if (w.base > 0.5) {
      out.push({ window: w.id, zone: w.zone, rise: true, ladder: true, pos: [w.x + nx * 1.6 + tx * 1.2, w.base, w.z + nz * 1.6 + tz * 1.2] });
      out.push({ window: w.id, zone: w.zone, rise: true, ladder: true, pos: [w.x + nx * 1.6 - tx * 1.2, w.base, w.z + nz * 1.6 - tz * 1.2] });
      continue;
    }
    const [d0, d1] = far[w.id];
    out.push({ window: w.id, zone: w.zone, rise: true, pos: [w.x + nx * d0 + tx * 1.3, 0, w.z + nz * d0 + tz * 1.3] });
    out.push({ window: w.id, zone: w.zone, rise: true, pos: [w.x + nx * d1 - tx * 1.1, 0, w.z + nz * d1 - tz * 1.1] });
  }
  return out;
})();

// --- Stairs ------------------------------------------------------------------------------------
export const STAIRS = [
  // Stair hall: up from the ground to the landing, climbing north.
  { id: 'hall', axis: 'z', dir: -1, start: 18, a0: -17.5, a1: -15.5, steps: 18, run: 0.4, rise: 0.2, rail: 'a1' },
  // Dressing rooms down to the stage wing, climbing west from the stage.
  { id: 'wing', axis: 'x', dir: -1, start: -12, a0: -19.6, a1: -18.1, steps: 12, run: 0.35, rise: 0.2, y0: STAGE_Y },
  // Up onto the stage from the auditorium floor.
  { id: 'stageW', axis: 'z', dir: -1, start: -11.9, a0: -9.5, a1: -8, steps: 6, run: 0.35, rise: 0.2 },
  { id: 'stageE', axis: 'z', dir: -1, start: -11.9, a0: 8, a1: 9.5, steps: 6, run: 0.35, rise: 0.2 },
];

// --- Doors and debris ---------------------------------------------------------------------------
export const DOORS = [
  {
    id: 'hallDebris', name: 'Debris', cost: 750, opens: ['stairhall'], kind: 'debris',
    box: [-11.9, 0, 13, -10.1, 2.2, 16],
    use: [[-9.3, 0, 14.5], [-12.8, 0, 14.5]],
  },
  {
    id: 'dressDoor', name: 'Door', cost: 1000, opens: ['dressing'], kind: 'door', axis: 'x',
    box: [-17.4, UP_Y, 6 - T / 2, -15.6, UP_Y + 2.4, 6 + T / 2],
    use: [[-16.5, UP_Y, 7.2], [-16.5, UP_Y, 4.8]],
  },
  {
    id: 'wingDebris', name: 'Debris', cost: 1000, opens: ['theatre'], kind: 'debris',
    box: [-11.9, STAGE_Y, -19.7, -10.6, STAGE_Y + 2.0, -18.0],
    use: [[-9.9, STAGE_Y, -18.85], [-13.6, 2.1, -18.85]],
  },
  {
    id: 'boxDoor', name: 'Door', cost: 750, opens: ['boxoffice'], kind: 'door',
    box: [11 - T / 2, 0, 12.8, 11 + T / 2, 2.4, 15.2],
    use: [[10, 0, 14], [12, 0, 14]],
  },
  {
    id: 'alleyDoor', name: 'Door', cost: 1000, opens: ['alley'], kind: 'door', axis: 'x',
    box: [14, 0, 6 - T / 2, 16, 2.4, 6 + T / 2],
    use: [[15, 0, 7.2], [15, 0, 4.8]],
  },
  {
    id: 'sideDoor', name: 'Door', cost: 1000, opens: ['theatre'], kind: 'door',
    box: [12 - T / 2, 0, -6, 12 + T / 2, 2.4, -4],
    use: [[13.2, 0, -5], [10.8, 0, -5]],
  },
  {
    id: 'backDoor', name: 'Door', cost: 750, opens: ['backstage'], kind: 'door', axis: 'x',
    box: [-9, STAGE_Y, -22 - T / 2, -7, STAGE_Y + 2.4, -22 + T / 2],
    use: [[-8, STAGE_Y, -20.8], [-8, STAGE_Y, -23.2]],
  },
  {
    id: 'backDebris', name: 'Debris', cost: 750, opens: ['backstage'], kind: 'debris',
    box: [7, STAGE_Y, -22.6, 9, STAGE_Y + 2.0, -21.4],
    use: [[8, STAGE_Y, -20.6], [8, STAGE_Y, -23.4]],
  },
  // The curtain over the Forge's alcove: no price, the first teleport opens it.
  {
    id: 'curtain', name: 'Curtain', cost: null, opens: ['forge'], kind: 'curtain', hidden: true,
    box: [-2.5, STAGE_Y, -22.35, 2.5, STAGE_Y + 3.6, -21.95],
    use: [],
  },
];

// --- Wall buys ----------------------------------------------------------------------------------
export const WALL_BUYS = [
  { id: 'wb_m14', weapon: 'm14', pos: [-10.85, 1.55, 18.2], face: [1, 0] },
  { id: 'wb_db', weapon: 'doublebarrel', pos: [-8, 1.55, 6.15], face: [0, 1] },
  { id: 'wb_mp5k', weapon: 'mp5k', pos: [-11.15, 1.55, 10.4], face: [-1, 0] },
  { id: 'wb_ak', weapon: 'ak74u', pos: [-12.15, UP_Y + 1.55, -2], face: [-1, 0] },
  { id: 'wb_mp40', weapon: 'mp40', pos: [14.5, 1.55, 19.85], face: [0, -1] },
  { id: 'wb_spas', weapon: 'spas12', pos: [12.15, 1.55, -1], face: [1, 0] },
  { id: 'wb_thompson', weapon: 'thompson', pos: [11.85, 1.55, 2], face: [-1, 0] },
  { id: 'wb_carbine', weapon: 'm1carbine', pos: [-11.85, STAGE_Y + 1.55, -26], face: [1, 0] },
].map((b) => ({ ...b, zone: zoneAt(b.pos[0], b.pos[1], b.pos[2]) }));

// --- The moving mystery box ----------------------------------------------------------------------
// A box's front (the side you open it from) is its local -Z, turned by yaw, like the bunker's.
export const BOX_SPOTS = [
  { id: 'foyer', pos: [10.25, 0, 17], yaw: Math.PI / 2 },
  { id: 'stairhall', pos: [-11.75, 0, 7.6], yaw: Math.PI / 2 },
  { id: 'dressing', pos: [-17.25, UP_Y, 2], yaw: -Math.PI / 2 },
  { id: 'boxoffice', pos: [17.25, 0, 17], yaw: Math.PI / 2 },
  { id: 'alley', pos: [12.75, 0, -15], yaw: -Math.PI / 2 },
  { id: 'theatre', pos: [0, 0, -12.9], yaw: Math.PI },
  { id: 'backstage', pos: [9, STAGE_Y, -29.25], yaw: Math.PI },
].map((s) => ({ ...s, size: [1.5, 0.62, 0.7], zone: zoneAt(s.pos[0], s.pos[1] + 0.1, s.pos[2]) }));

// What the box offers here (weights). The Leyden Rifle stays in the bunker; the Gale
// Cannon is this map's wonder weapon.
export const BOX_POOL = {
  galil: 6, hk21: 5, dragunov: 3, python: 4, chinalake: 3, ak74u: 3, mp5k: 3, spas12: 3,
  stg44: 3, ppsh: 3, mg42: 2, panzerschreck: 2, arcpistol: 2, galecannon: 2,
};

// --- Machines ------------------------------------------------------------------------------------
// pos: the floor under the machine's centre; yaw turns its front (+Z) to face the room;
// use: where a player stands to use it. Sizes follow the models in client/render/machines.js.
const ahead = (pos, yaw, d) => [pos[0] + Math.sin(yaw) * d, pos[1], pos[2] + Math.cos(yaw) * d];
export const PERKS = [
  { perk: 'lazarus', pos: [-10.2, 0, 9], yaw: Math.PI / 2 },
  { perk: 'ironclad', pos: [-17.2, UP_Y, -12], yaw: Math.PI / 2 },
  { perk: 'quicksilver', pos: [17.25, 0, 1], yaw: -Math.PI / 2 },
  { perk: 'hairtrigger', pos: [-11.2, 0, 4.4], yaw: Math.PI / 2 },
].map((m) => ({ ...m, use: ahead(m.pos, m.yaw, 1.25), zone: zoneAt(m.pos[0], m.pos[1] + 0.1, m.pos[2]) }));

export const POWER = { pos: [0, STAGE_Y, -29.85], yaw: 0, use: [0, STAGE_Y, -28.95], zone: 'backstage' };

// The Forge is 3.25 m wide; its tray (where a gun goes in) is 0.63 m right of centre.
export const FORGE = { pos: [-0.63, STAGE_Y, -24.45], yaw: 0, use: [0, STAGE_Y, -22.7], zone: 'forge' };

// The Magic Lantern: link a pad at the lantern, then stand on the pad and pay to ride.
export const TELEPORT = {
  cost: 1500, boothTime: 30, linkWindow: 30, cooldown: 30,
  // The lantern stands at the back of its round pad (1.16 m behind the pad's centre).
  core: { pos: [0, STAGE_Y, -18.06], pad: [0, STAGE_Y, -16.9], radius: 1.4, use: [0.9, STAGE_Y, -17.2], zone: 'theatre' },
  // Pads face +Z; the lever pedestal is front-right (use is in front of it).
  pads: [
    { id: 'west', pos: [-15, UP_Y, -22.3], yaw: 0, radius: 0.95, use: [-14.28, UP_Y, -21.18], zone: 'dressing' },
    { id: 'east', pos: [15, 0, -21.3], yaw: 0, radius: 0.95, use: [15.72, 0, -20.18], zone: 'alley' },
  ],
  // Where riders stand in the booth, and where they come back on the stage.
  booth: [[-2.5, BOOTH_Y, 8.2, 0], [2.5, BOOTH_Y, 8.2, 0], [-1, BOOTH_Y, 9.2, 0], [1, BOOTH_Y, 9.2, 0]],
  back: [[-0.8, STAGE_Y, -16.3, 0], [0.8, STAGE_Y, -16.3, 0], [-0.8, STAGE_Y, -15.6, 0], [0.8, STAGE_Y, -15.6, 0]],
};

// Spark Gates: electric traps across a doorway. area: [x0, y0, z0, x1, y1, z1] where they fry.
export const TRAPS = [
  {
    id: 'dressingGate', cost: 1000, time: 25, cooldown: 40, zone: 'dressing',
    gate: { a: [-15.2, UP_Y, -8], b: [-12.8, UP_Y, -8] },
    switch: { pos: [-16.6, UP_Y + 1.3, -7.8], face: [0, 1], use: [-16.6, UP_Y, -7] },
    area: [-15.2, UP_Y - 0.2, -8.8, -12.8, UP_Y + 2.2, -7.2],
  },
  {
    id: 'alleyGate', cost: 1000, time: 25, cooldown: 40, zone: 'alley',
    gate: { a: [12.15, 0, -10], b: [14.6, 0, -10] },
    switch: { pos: [16, 1.3, -9.8], face: [0, 1], use: [16, 0, -9] },
    area: [12.15, -0.2, -10.8, 14.6, 2.2, -9.2],
  },
];

export const PLAYER_SPAWNS = [
  [-1.5, 0, 11.2, Math.PI], [1.5, 0, 11.2, Math.PI], [-1.5, 0, 13.4, Math.PI], [1.5, 0, 13.4, Math.PI],
];

// Lights. `power`: waits for the breaker (at `dim` of its strength until then). The renderer lights the few
// nearest the camera (a fixed number of lights keeps every shader compiled once).
export const LIGHTS = [
  { pos: [0, 5.2, 13], color: 0xffd9a0, intensity: 30, distance: 17, flicker: 0.1, power: true, dim: 0.45 },
  { pos: [-10.3, 3.0, 17], color: 0xffc98f, intensity: 18, distance: 11, flicker: 0.8 },
  { pos: [10.3, 3.0, 9.5], color: 0xffc98f, intensity: 18, distance: 11, flicker: 0.5 },
  { pos: [0, 5.5, 25], color: 0x9fb8ff, intensity: 30, distance: 18, flicker: 0 },
  { pos: [-14.5, 6.4, 13], color: 0xffbd7a, intensity: 18, distance: 12, flicker: 0.6 },
  { pos: [-15, 6.0, 4], color: 0xffc98f, intensity: 14, distance: 9, flicker: 0.2, power: true },
  { pos: [-16.8, 5.4, -4], color: 0xfff0c0, intensity: 16, distance: 10, flicker: 0.1, power: true },
  { pos: [-15, 6.0, -18], color: 0xffc98f, intensity: 14, distance: 10, flicker: 1.0 },
  { pos: [14.5, 2.9, 13], color: 0xffbd7a, intensity: 12, distance: 9, flicker: 0.9 },
  { pos: [17, 5.5, -2], color: 0xa8c0ff, intensity: 26, distance: 16, flicker: 0 },
  { pos: [13.5, 4.5, -20], color: 0xffb070, intensity: 16, distance: 12, flicker: 1.2 },
  { pos: [-7, 9.5, -2], color: 0xffc98f, intensity: 24, distance: 18, flicker: 0.1, power: true },
  { pos: [7, 9.5, -2], color: 0xffc98f, intensity: 24, distance: 18, flicker: 0.1, power: true },
  { pos: [0, 3.0, 5.5], color: 0xff4030, intensity: 6, distance: 8, flicker: 0 },
  { pos: [0, 8, -12], color: 0xffe0b0, intensity: 40, distance: 16, flicker: 0, power: true },
  { pos: [-9, 4.5, -19], color: 0xffbd7a, intensity: 14, distance: 10, flicker: 0.7 },
  { pos: [-6, 5.2, -26], color: 0xffc98f, intensity: 18, distance: 12, flicker: 0.2, power: true },
  { pos: [6, 4.0, -27], color: 0xff5030, intensity: 10, distance: 10, flicker: 0 },
  { pos: [0, 9.6, 8], color: 0xffd9a0, intensity: 14, distance: 7, flicker: 0.3 },
  { pos: [0, 2.8, -23.2], color: 0xff7a30, intensity: 12, distance: 6, flicker: 0.4, power: true },
  // The foyer's other two sconces (the start room shouldn't be pitch black).
  { pos: [-10.3, 3.0, 9.5], color: 0xffc98f, intensity: 14, distance: 10, flicker: 0.3 },
  { pos: [10.3, 3.0, 17], color: 0xffc98f, intensity: 14, distance: 10, flicker: 0.6 },
];

// --- Furniture (solid props) ------------------------------------------------------------------------
// `solid` is the collider; `kind` tells the renderer what to draw there.
export const FURNITURE = (() => {
  const out = [
    { kind: 'ticketBooth', pos: [0, 0, 16.5], solid: [-1.1, 0, 15.4, 1.1, 2.6, 17.6] },
    { kind: 'concession', pos: [0, 0, 6.8], solid: [-4, 0, 6.15, 4, 1.1, 7.4] },
    { kind: 'bench', pos: [-7, 0, 13], yaw: Math.PI / 2, solid: [-7.4, 0, 12, -6.6, 0.5, 14] },
    { kind: 'bench', pos: [7, 0, 13], yaw: Math.PI / 2, solid: [6.6, 0, 12, 7.4, 0.5, 14] },
    { kind: 'plinth', pos: [-13.5, 0, 17.5], solid: [-14.1, 0, 16.9, -12.9, 1.2, 18.1] },
    { kind: 'counter', pos: [14.5, 0, 9], solid: [12.2, 0, 8.6, 16.8, 1.1, 9.4] },
    { kind: 'vanity', pos: [-17.5, UP_Y, -4], yaw: Math.PI / 2, solid: [-17.85, UP_Y, -5.2, -17.1, UP_Y + 0.8, -2.8] },
    { kind: 'vanity', pos: [-17.5, UP_Y, 1.5], yaw: Math.PI / 2, solid: [-17.85, UP_Y, 0.3, -17.1, UP_Y + 0.8, 0.9] },
    { kind: 'rack', pos: [-13, UP_Y, -14], solid: [-13.5, UP_Y, -15.5, -12.5, UP_Y + 1.7, -12.5] },
    { kind: 'trunk', pos: [-17.4, UP_Y, -23.2], solid: [-17.85, UP_Y, -23.85, -16.9, UP_Y + 0.7, -22.6] },
    { kind: 'dumpster', pos: [17, 0, -7.6], solid: [16.2, 0, -8.8, 17.85, 1.4, -6.4] },
    { kind: 'fence', pos: [16.3, 0, -10], solid: [14.6, 0, -10.1, 17.85, 2.4, -9.9] },
    { kind: 'crates', pos: [13, 0, -23], solid: [12.15, 0, -23.85, 13.9, 1.3, -22.2] },
    { kind: 'piano', pos: [5, STAGE_Y, -18.5], solid: [3.8, STAGE_Y, -19.3, 6.2, STAGE_Y + 1.2, -17.7] },
    { kind: 'crates', pos: [-10, STAGE_Y, -28.5], solid: [-11.85, STAGE_Y, -29.85, -9.2, STAGE_Y + 1.4, -27.4] },
    { kind: 'costumeRack', pos: [4, STAGE_Y, -26], solid: [2.8, STAGE_Y, -26.4, 5.2, STAGE_Y + 1.7, -25.6] },
    { kind: 'lanternBase', pos: TELEPORT.core.pos, solid: [-0.35, STAGE_Y, -18.4, 0.35, STAGE_Y + 2.7, -17.72] },
    // The pads' lever pedestals.
    ...TELEPORT.pads.map((p) => ({ kind: 'padPedestal', pos: p.pos, solid: [p.pos[0] + 0.78, p.pos[1], p.pos[2] + 0.22, p.pos[0] + 1.18, p.pos[1] + 1.1, p.pos[2] + 0.62] })),
  ];
  // Auditorium seats: three blocks of rows with aisles between and around them.
  for (let r = 0; r < 12; r++) {
    const z = -9.6 + r * 1.1;
    for (const [x0, x1] of [[-10.3, -6.2], [-4.2, 4.2], [6.2, 10.3]]) {
      out.push({ kind: 'seats', pos: [(x0 + x1) / 2, 0, z + 0.25], row: r, solid: [x0, 0, z, x1, 0.9, z + 0.5] });
    }
  }
  // Machines are solid too.
  for (const m of PERKS) out.push({ kind: 'perk', perk: m.perk, pos: m.pos, solid: footprint(m.pos, m.yaw, 1.3, 2.4, 1.15) });
  out.push({ kind: 'forge', pos: FORGE.pos, solid: [FORGE.pos[0] - 1.74, STAGE_Y, FORGE.pos[2] - 0.54, FORGE.pos[0] + 1.51, STAGE_Y + 3.1, FORGE.pos[2] + 1.03] });
  return out;
})();

// A machine's collider: w wide, h tall, d deep, centred on pos, facing yaw.
function footprint(pos, yaw, w, h, d) {
  const fx = Math.abs(Math.sin(yaw)), fz = Math.abs(Math.cos(yaw));
  const hx = fx * d / 2 + fz * w / 2, hz = fz * d / 2 + fx * w / 2;
  return [pos[0] - hx, pos[1], pos[2] - hz, pos[0] + hx, pos[1] + h, pos[2] + hz];
}

// --- Geometry ---------------------------------------------------------------------------------------
const STAIR_HOLES = [stairFootprint(STAIRS[1])];

export function buildStaticBoxes() {
  const out = [];
  const holes = (f) => windowHoles(WINDOWS, f);
  // Street front (z = 20): stair hall, foyer, box office.
  out.push(...wallRun('x', 20, -18 - T / 2, 18 + T / 2, 0, 7.5, holes((w) => w.z === 20), 'ext'));
  // West outside wall (x = -18): stair hall, the cellar passage and the dressing rooms.
  out.push(...wallRun('z', -18, -24, 20, 0, 7, holes((w) => w.x === -18), 'ext'));
  // East outside walls: box office (x = 18) and the building beside the alley.
  out.push(...wallRun('z', 18, 6, 20, 0, 4.5, holes((w) => w.x === 18 && w.z > 6), 'ext'));
  out.push(...wallRun('z', 18, -24, 6, 0, 8, holes((w) => w.x === 18 && w.z < 6), 'ext'));
  // North ends: the dressing column, the alley's dead end, backstage.
  out.push(...wallRun('x', -24, -18 - T / 2, -12, 0, 7, [], 'ext'));
  out.push(...wallRun('x', -24, 12, 18 + T / 2, 0, 4, [], 'ext'));
  out.push(...wallRun('x', -30, -12 - T / 2, 12 + T / 2, 0, 6.2, holes((w) => w.z === -30), 'ext'));
  out.push(...wallRun('z', -12, -30, -24, 0, 6.2, [], 'ext'));
  out.push(...wallRun('z', 12, -30, -24, 0, 6.2, [], 'ext'));
  // Auditorium west wall (x = -12): cellar windows below, the dressing rooms above, the wing stair.
  out.push(...wallRun('z', -12, -24, 6, 0, 11, [
    ...holes((w) => w.x === -12),
    { a: -19.6, b: -18.1, y0: STAGE_Y, y1: 3.8 },
  ], 'int'));
  // Auditorium east wall (x = 12): the side door from the alley.
  out.push(...wallRun('z', 12, -24, 6, 0, 11, [{ a: -6, b: -4, y0: 0, y1: 2.4 }], 'int'));
  // z = 6: the foyer side of the auditorium, the dressing-room door, the alley door.
  out.push(...wallRun('x', 6, -18, -12, 0, 7, [{ a: -17.4, b: -15.6, y0: UP_Y, y1: UP_Y + 2.4 }], 'int'));
  out.push(...wallRun('x', 6, -12, 12, 0, 11, [{ a: -3, b: -1.5, y0: 8.1, y1: 8.8 }, { a: 1.5, b: 3, y0: 8.1, y1: 8.8 }], 'int'));
  out.push(...wallRun('x', 6, 12, 18, 0, 4.5, [{ a: 14, b: 16, y0: 0, y1: 2.4 }], 'int'));
  // Foyer sides: the stair hall debris and the box office door.
  out.push(...wallRun('z', -11, 6, 20, 0, 7, [{ a: 13, b: 16, y0: 0, y1: 2.6 }], 'int'));
  out.push(...wallRun('z', 11, 6, 20, 0, 6, [{ a: 12.8, b: 15.2, y0: 0, y1: 2.4 }], 'int'));
  // Stage back wall (z = -22): two doors to backstage and the curtained alcove.
  out.push(...wallRun('x', -22, -12, 12, STAGE_Y, 11, [
    { a: -9, b: -7, y0: STAGE_Y, y1: STAGE_Y + 2.4 },
    { a: 7, b: 9, y0: STAGE_Y, y1: STAGE_Y + 2.4 },
    { a: -2.5, b: 2.5, y0: STAGE_Y, y1: STAGE_Y + 3.6 },
  ], 'int'));
  // The Forge's alcove.
  out.push(...wallRun('z', -2.5, -25.6, -22, STAGE_Y, 6.2, [], 'int'));
  out.push(...wallRun('z', 2.5, -25.6, -22, STAGE_Y, 6.2, [], 'int'));
  out.push(...wallRun('x', -25.6, -2.65, 2.65, STAGE_Y, 6.2, [], 'int'));
  out.push(box(-2.5, STAGE_Y + 3.6, -25.6, 2.5, STAGE_Y + 4.0, -22, 'roof'));
  // Dressing rooms: the partition with the Spark Gate doorway.
  out.push(...wallRun('x', -8, -18, -12, UP_Y, 6.6, [{ a: -15.2, b: -12.8, y0: UP_Y, y1: UP_Y + 2.6 }], 'int'));
  // The projection booth, above the foyer's north end.
  out.push(...wallRun('z', -5, 6, 10, BOOTH_Y, 10, [], 'int'));
  out.push(...wallRun('z', 5, 6, 10, BOOTH_Y, 10, [], 'int'));
  out.push(...wallRun('x', 10, -5 - T / 2, 5 + T / 2, BOOTH_Y, 10, [], 'int'));
  // Proscenium pillars either side of the stage opening.
  out.push(box(-12, 0, -14.3, -10.6, 7.5, -13.7, 'pillar'), box(10.6, 0, -14.3, 12, 7.5, -13.7, 'pillar'));

  // Floors.
  out.push(box(-18, -0.12, 6, 18, 0, 20, 'floor0'));
  out.push(box(-12, -0.12, -14, 12, 0, 6, 'floor0'));
  out.push(box(12, -0.12, -24, 18, 0, 6, 'floor0'));
  out.push(box(-18, -0.12, -24, -12, 0, 6, 'floor0'));
  out.push(box(-12, 0, -22, 12, STAGE_Y, -14, 'stage'));
  out.push(box(-12, 0, -30, 12, STAGE_Y, -22, 'stage'));
  out.push(...slabWithHoles(-18, -24, -12, 6, UP_Y - 0.2, UP_Y, STAIR_HOLES, 'slab'));
  out.push(box(-18, UP_Y - 0.2, 6, -11, UP_Y, 10.8, 'slab'));
  out.push(box(-5, BOOTH_Y - 0.2, 6, 5, BOOTH_Y, 10, 'slab'));
  out.push(...stairBoxes(STAIRS));
  // Rails: the landing's open edge and the dressing rooms around the wing stairwell.
  out.push(box(-15.5, UP_Y, 10.7, -11.15, UP_Y + 1.0, 10.8, 'rail'));
  out.push(box(-16.2, UP_Y, -18.1, -12.15, UP_Y + 1.0, -18.0, 'rail'));
  out.push(box(-16.2, UP_Y, -19.7, -12.15, UP_Y + 1.0, -19.6, 'rail'));

  // Ceilings.
  out.push(box(-11, 6.0, 6, 11, 6.3, 20, 'roof'));
  out.push(box(-18, 7.0, 6, -11, 7.3, 20, 'roof'));
  out.push(box(11, 3.2, 6, 18, 3.5, 20, 'roof'));
  out.push(box(-18, 6.6, -24, -12, 6.9, 6, 'roof'));
  out.push(box(-12, 11, -22, 12, 11.3, 6, 'roof'));
  out.push(box(-12, 6.2, -30, 12, 6.5, -22, 'roof'));
  out.push(box(-5, 10, 6, 5, 10.3, 10, 'roof'));

  for (const p of FURNITURE) if (p.solid) out.push(box(...p.solid, 'prop'));
  return out;
}

export const PALACE = defineMap({
  id: 'palace', name: 'Aurora Picture Palace', blurb: 'A dead movie palace. Power, perks, the Forge and the Magic Lantern.',
  encounters: ['hounds', 'machines'],
  T, LOFT_Y: UP_Y, STAGE_Y, UP_Y, BOOTH_Y,
  ZONES, WINDOWS, SPAWNS, STAIRS, DOORS, WALL_BUYS, BOX_SPOTS, BOX_POOL, PERKS, POWER, FORGE, TELEPORT, TRAPS,
  PLAYER_SPAWNS, LIGHTS, FURNITURE, STAIR_HOLES,
  MYSTERY_BOX: BOX_SPOTS[0],
  NAV_LEVELS: [0, UP_Y, BOOTH_Y],
  NAV_REGIONS: [
    [
      [-10.85, 6.15, 10.85, 19.85],       // foyer
      [-17.85, 6.15, -11.15, 19.85],      // stair hall (and the foot of its stairs)
      [11.15, 6.15, 17.85, 19.85],        // box office
      [12.15, -23.85, 17.85, 5.85],       // alley
      [-11.85, -21.85, 11.85, 5.85],      // auditorium and stage
      [-16.2, -19.6, -11.85, -18.1],      // the wing stair's lower half
      [-11.85, -29.85, 11.85, -22.15],    // backstage
      [-2.35, -25.45, 2.35, -21.9],       // the Forge's alcove
      [-11.3, 12.9, -10.7, 16.1],         // through the stair hall doorway
      [10.7, 12.7, 11.3, 15.3],           // through the box office door
      [14, 5.7, 16, 6.3],                 // through the alley door
      [11.7, -6.1, 12.3, -3.9],           // through the side door
      [-9.1, -22.3, -6.9, -21.7], [6.9, -22.3, 9.1, -21.7],   // backstage doors
    ],
    [
      [-17.85, 6.15, -11.15, 10.8],       // landing
      [-17.5, 10.7, -15.5, 18],           // the stair hall stairs' upper half
      [-17.85, -23.85, -12.15, 5.85],     // dressing rooms
      [-17.4, 5.7, -15.6, 6.3],           // through the dressing-room door
      [-16.2, -19.6, -11.85, -18.1],      // the wing stair's upper half
    ],
    [[-4.85, 6.15, 4.85, 9.85]],          // projection booth
  ],
  navBounds: [-19, -31, 19, 21],
  playBounds: [-18, -30, 18, 20, BOOTH_Y + 3],
  worldBounds: [-30, -40, 30, 32],
  attract: { center: [0, 3.5, -6], radius: 8.5, height: 6.5 },
  fog: 0.026,
  zoneAt,
  stairHeightAt: (x, z) => rampHeight(STAIRS, x, z),
  buildStaticBoxes,
  windowBlockers: () => [
    ...windowBlockers(WINDOWS, T),
    // The booth's projection ports: glass nobody climbs through.
    box(-3, 8.1, 5.8, -1.5, 8.8, 6.2, 'window'), box(1.5, 8.1, 5.8, 3, 8.8, 6.2, 'window'),
  ],
});
