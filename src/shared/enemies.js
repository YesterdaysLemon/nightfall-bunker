// Enemy types: what the rules, hit tests and renderers need to know about each
// class, in one table keyed by the protocol class id (ZC). Shared by the browser,
// the Node server and the Cloudflare Worker, so keep it plain data.
//
// Adding an enemy type (see docs/EXTENDING.md):
//   1. give it an id in ZC (protocol.js) and an entry here;
//   2. pick or add its look on the client (client/enemy-looks.js) and, if it
//      draws itself, register its renderer in render/zombies.js (Zombies.drawers);
//   3. if it moves or spawns differently from window zombies, add its AI in sim.js.
// Everything below is read through `enemy(cls)`; nothing else should branch on
// class ids for these values.

import { ZC, ZS } from './protocol.js';

// States in which no enemy can be hurt or targeted: warping in, shattered, re-forming.
export const UNTOUCHABLE = new Set([ZS.WARP, ZS.SHATTER, ZS.REFORM]);

// Hit volumes, in model metres relative to the feet, facing +Z (they turn with
// the enemy's yaw). Each is [part, 'sphere', forward, up, radius] or
// [part, 'capsule', forward, bottom, top, radius] (a vertical capsule).
// Parts: 0 head (headshot damage), 1 body, 2 limbs (80% damage).
const HUMANOID = [
  [0, 'sphere', 0, 1.63, 0.17],
  [1, 'capsule', 0, 0.95, 1.35, 0.24],
  [2, 'capsule', 0, 0.08, 0.95, 0.2],
];

// Hellhounds are drawn at 1.3x the exported model; the volumes are fitted around
// the model standing and padded past its thin body so hits feel fair at a sprint.
export const HOUND_SCALE = 1.3;
const HOUND = [
  [0, 'sphere', 0.6, 0.84, 0.2], [0, 'sphere', 0.72, 0.78, 0.13], [0, 'sphere', 0.46, 0.92, 0.14],
  [1, 'sphere', 0.4, 0.74, 0.18], [1, 'sphere', 0.2, 0.6, 0.25], [1, 'sphere', -0.06, 0.62, 0.23], [1, 'sphere', -0.3, 0.62, 0.21],
  [2, 'capsule', 0.21, 0.04, 0.46, 0.17], [2, 'capsule', -0.34, 0.04, 0.5, 0.18],
];
export const HOUND_MID = 0.62 * HOUND_SCALE;

// Shared by the window zombies (walker, jogger, runner).
const ZOMBIE = {
  hit: HUMANOID, scale: 1,
  mid: 0.95,                 // body centre: splash, line of sight
  aimY: 1.35,                // where aim assist pulls toward
  fxY: 1.3,                  // where hit blood and sounds come from
  body: [0.26, 0.55, 1.6],   // [radius, bottom, top] for keeping out of walls
  turn: 5, directDist: 2.2,  // turn rate (rad/s); chase straight at a player within this many metres
  melee: { start: 1.05, windup: 0.4, reach: 1.45, dmg: 40, cool: 0.95 },
  windowSwipe: { dmg: 40, cool: 1.3 },
  windowSpeed: 1, tearTime: 1.35, climbTime: 1.25,
  killPoints: 50, corpseLife: 4.5, ai: 'window', look: 'zombie',
};

export const ENEMIES = {
  [ZC.WALKER]: { ...ZOMBIE, key: 'walker', name: 'Zombie', speed: [1.0, 0.35] },
  [ZC.JOGGER]: { ...ZOMBIE, key: 'jogger', name: 'Zombie', speed: [2.2, 0.4], tearTime: 1.0 },
  [ZC.RUNNER]: {
    ...ZOMBIE, key: 'runner', name: 'Zombie', speed: [3.9, 0.5], turn: 9, windowSpeed: 0.9, tearTime: 0.75, climbTime: 0.8,
    melee: { start: 1.05, windup: 0.28, reach: 1.45, dmg: 45, cool: 0.65 },
  },
  [ZC.HOUND]: {
    key: 'hound', name: 'Hellhound', ai: 'warp', look: 'hound', burns: true,
    hit: HOUND, scale: HOUND_SCALE, mid: HOUND_MID, aimY: HOUND_MID, fxY: HOUND_MID,
    body: [0.28, 0.3, 1.1], turn: 11, directDist: 3,
    melee: { start: 1.7, windup: 0.3, reach: 1.9, dmg: 25, cool: 0.75 },
    speed: [5.3, 0.9], warpTime: 0.9,   // lightning strike -> on its feet
    leap: 1.3,                          // closes in at 1.3x speed during the bite wind-up
    killPoints: 50, corpseLife: 1.2, noDrops: true,
  },
  [ZC.KINTSUGI]: {
    key: 'kintsugi', name: 'Kintsugi', ai: 'boss', look: 'kintsugi',
    hit: HUMANOID, scale: 1, mid: 1.0, aimY: 1.35, fxY: 1.3,
    body: [0.26, 0.55, 1.6], turn: 5, directDist: 2.2,
    melee: { start: 1.3, windup: 0.45, reach: 1.7, dmg: 50, cool: 1.2 },
    speed: [1.35, 0], rushSpeed: 4.4,   // slow while watched, fast when not
    shatterTime: 1.3, reformTime: 0.6,
    boss: true, instaImmune: true, nukeImmune: true, splash: 0.5,
    killPoints: 500, corpseLife: 5.5, noDrops: true,
  },
};

export function enemy(cls) {
  return ENEMIES[cls] || ENEMIES[ZC.WALKER];
}
