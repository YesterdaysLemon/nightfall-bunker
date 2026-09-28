// Hound rounds: every few rounds the zombies stop and a pack of hellhounds warps
// in on lightning strikes inside the bunker. Random drops are off, and the last
// hound of the pack always drops a Max Ammo. (The client rolls in the fog.)
//
// An encounter for GameSim (see "Encounters" in sim.js). Its state lives on the
// sim: houndRng (its own random stream, so hound scheduling never disturbs the
// zombies), houndRound (this round is a hound round) and nextHoundRound.

import { ZC, ZS, PS } from '../protocol.js';
import { enemy } from '../enemies.js';
import { roundHealth } from '../rounds.js';
import { mulberry32 } from '../rng.js';
import { r2 } from '../wire.js';

export function houndCount(r, players) {
  return Math.round((7 + Math.floor(r / 4)) * (1 + 0.6 * (Math.max(1, players) - 1)));
}

export function houndHealth(r) {
  return Math.max(150, Math.round(roundHealth(r) * 0.45));
}

export const HOUND_ROUNDS = {
  id: 'hounds',
  noDrops: true,

  init(sim, { seed, firstHoundRound }) {
    sim.houndRng = mulberry32(seed ^ 0x9e3779b9);
    sim.houndRound = false;
    sim.nextHoundRound = firstHoundRound ?? 5 + Math.floor(sim.houndRng() * 3);
  },

  claimsRound(sim, players) {
    sim.houndRound = sim.round === sim.nextHoundRound;
    if (!sim.houndRound) return false;
    sim.nextHoundRound = sim.round + 4 + Math.floor(sim.houndRng() * 2);
    sim.toSpawn = houndCount(sim.round, players);
    sim.spawnT = 3.5; // let the fog roll in and the howls finish first
    return true;
  },

  roundStarted(sim) { sim.emit(['hounds', sim.round]); },

  spawnStep(sim, dt) {
    sim.spawnT -= dt;
    const cap = Math.min(sim.maxAlive, 2 + 2 * sim.activePlayers().length);
    let hounds = 0;
    for (const z of sim.zombies.values()) if (z.cls === ZC.HOUND) hounds++;
    if (sim.spawnT <= 0 && hounds < cap) {
      if (spawnHound(sim)) sim.toSpawn--;
      sim.spawnT = 0.7 + sim.houndRng() * 1.1;
    }
  },

  roundEnded(sim) { sim.houndRound = false; },

  onKill(sim, z) {
    if (z.cls !== ZC.HOUND) return false;
    // The last hound of the pack always leaves a Max Ammo behind.
    const packLeft = sim.toSpawn > 0 || [...sim.zombies.values()].some((q) => q.cls === ZC.HOUND);
    if (sim.houndRound && !packLeft) sim.dropPowerup('maxammo', z.x, z.y, z.z);
    return true;
  },

  snapshot(sim, out) { out.hr = sim.houndRound ? 1 : 0; },
  welcome(sim, out) { out.hounds = sim.houndRound; },
};

// A hound appears on a walkable cell a few metres from a random living player,
// on their floor, out of arm's reach of everyone. Returns false if nowhere fits.
export function spawnHound(sim) {
  const alive = sim.activePlayers().filter((p) => p.state === PS.ALIVE);
  if (!alive.length) return false;
  const target = alive[Math.floor(sim.houndRng() * alive.length)];
  const nav = sim.nav;
  const pick = (near, far) => {
    const out = [];
    for (let i = 0; i < nav.walk.length; i++) {
      if (!nav.walk[i]) continue;
      const c = nav.center(i);
      if (sim.map.stairHeightAt(c[0], c[2]) !== null || Math.abs(c[1] - target.y) > 0.8) continue;
      if (!sim.zones.has(sim.map.zoneAt(c[0], c[1] + 0.1, c[2]))) continue;
      const d = Math.hypot(c[0] - target.x, c[2] - target.z);
      if (d < near || d > far) continue;
      if (alive.some((p) => Math.hypot(c[0] - p.x, c[2] - p.z) < 3.2 && Math.abs(c[1] - p.y) < 1)) continue;
      out.push(c);
    }
    return out;
  };
  let cands = pick(4.5, 10);
  if (!cands.length) cands = pick(3.3, 16);
  if (!cands.length) return false;
  const c = cands[Math.floor(sim.houndRng() * cands.length)];
  const hp = houndHealth(sim.round);
  const E = enemy(ZC.HOUND);
  const h = {
    id: sim.nextZid++, cls: ZC.HOUND, speed: E.speed[0] + sim.houndRng() * E.speed[1] + Math.min(0.8, Math.max(0, sim.round - 6) * 0.08),
    hp, maxHp: hp, x: c[0], y: c[1], z: c[2], yaw: Math.atan2(target.x - c[0], target.z - c[2]),
    state: ZS.WARP, t: E.warpTime, win: null, lv: c[1] > 1 ? 1 : 0, atk: 0, cell: -1, stuck: 0, cool: 0.4,
  };
  sim.zombies.set(h.id, h);
  sim.emit(['strike', r2(h.x), r2(h.y), r2(h.z)]);
  sim.emit(['zspawn', h.id, ZC.HOUND, 0]);
  return true;
}
