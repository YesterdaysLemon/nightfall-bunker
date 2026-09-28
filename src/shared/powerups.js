// Power-ups, in one list: what players see, whether it drops at random, and how
// long a timed one lasts. Effects are applied by the rules (GameSim.applyPowerup);
// the floating model comes from client/render/weapons3d.js (buildPowerupModel).
//
// Adding one: an entry here, a case in GameSim.applyPowerup, and a model.
// tests/sim.test.js checks every random power-up can be applied.

export const POWERUP_TYPES = {
  maxammo: { name: 'Max Ammo', random: true },
  instakill: { name: 'Insta-Kill', random: true, seconds: 30 },
  doublepoints: { name: 'Double Points', random: true, seconds: 30 },
  nuke: { name: 'Kaboom', random: true },
  carpenter: { name: 'Carpenter', random: true, needsBrokenBoards: true },
  goldleaf: { name: 'Gold Leaf', random: false },   // only Kintsugi drops it
};

export const RANDOM_POWERUPS = Object.keys(POWERUP_TYPES).filter((t) => POWERUP_TYPES[t].random);

export function powerupName(type) {
  return POWERUP_TYPES[type]?.name || type;
}
