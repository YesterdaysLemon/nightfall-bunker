// Weapon table shared by the client (feel, ammo, visuals) and the server
// (damage, fire-rate validation, purchases). Damage is always computed on
// the authoritative side from this table; clients only claim hits.
//
// Adding a gun (see docs/EXTENDING.md): one entry here, one model builder in
// client/render/weapons3d.js (WEAPON_BUILDERS), and a place on a wall in the map
// if it is a wall buy. tests/weapons.test.js checks the pieces agree.
//
// Fields:
//   kind      pistol | bolt | rifle | smg | shotgun | lmg | rocket | wonder: sets the
//             muzzle flash and the default reload and cycling animation
//   sound     a gun sound recipe in client/audio.js (GUN_SOUNDS)
//   price     wall-buy price (ammo is half); omit if it is not sold on a wall
//   box       mystery box weight; omit to keep it out of the box
//   grip      where the left hand goes: 'rail' (default), 'post' (foregrip/magazine), 'cup' (pistol)
//   reloadStyle  the reload animation (client/render/reloads.js): 'mag' | 'pistol' |
//             'bolt' (stripper clip) | 'pump' (shell by shell) | 'break' | 'rocket' |
//             'jar' | 'revolver' | 'belt' | 'launcher' | 'canister'; defaults from kind and pump
//   projectile   { speed, radius (blast), gravity, look: 'rocket' | 'orb' | 'grenade',
//             blast: 'fire' | 'arc', shake, cripple (chance a survivor loses its legs),
//             stun (seconds a survivor is slowed) }
//   chain     chain lightning instead of a bullet: { hops, reach (m), delay (s per hop),
//             aim (m of aim forgiveness), bossDamage }. The bolt strikes the enemy
//             nearest the aim line and leaps to the nearest enemy it can see within
//             reach, up to `hops` enemies. It kills anything but a boss outright.
//   cone      a blast of air instead of a bullet: { reach (m), angle (half-angle, rad),
//             bossDamage }. Kills every enemy it can see inside the cone and throws
//             the bodies; a boss takes bossDamage.
//
// The Cold War guns further down are not in the default (bunker) box: a map lists
// its own box pool and wall buys (map.BOX_POOL, map.WALL_BUYS).

export const WEAPONS = {
  m1911: {
    name: 'M1911', kind: 'pistol', sound: 'pistol', auto: false, grip: 'cup',
    damage: 50, headMult: 2.5, rpm: 420, mag: 8, reserve: 32,
    reload: 1.6, spread: 0.012, aimSpread: 0.004, range: 45, pellets: 1,
    kick: 0.035, adsFov: 58, moveMult: 1.0,
  },
  kar98k: {
    name: 'Kar98k', kind: 'bolt', sound: 'bolt', auto: false, price: 200, box: 3,
    damage: 220, headMult: 4, rpm: 52, mag: 5, reserve: 50,
    reload: 2.9, spread: 0.02, aimSpread: 0.0005, range: 120, pellets: 1,
    kick: 0.09, adsFov: 45, moveMult: 0.95, penetrate: 2,
  },
  m1carbine: {
    name: 'M1 Carbine', kind: 'rifle', sound: 'rifle', auto: false, price: 600, box: 3,
    damage: 95, headMult: 3, rpm: 480, mag: 15, reserve: 120,
    reload: 2.0, spread: 0.014, aimSpread: 0.002, range: 90, pellets: 1,
    kick: 0.03, adsFov: 50, moveMult: 0.97,
  },
  thompson: {
    name: 'Thompson', kind: 'smg', sound: 'smg', auto: true, price: 1200, box: 5, grip: 'post',
    damage: 75, headMult: 2.5, rpm: 720, mag: 30, reserve: 240,
    reload: 2.4, spread: 0.03, aimSpread: 0.012, range: 60, pellets: 1,
    kick: 0.018, adsFov: 58, moveMult: 1.0,
  },
  mp40: {
    name: 'MP40', kind: 'smg', sound: 'smg', auto: true, price: 1000, box: 5, grip: 'post',
    damage: 72, headMult: 2.5, rpm: 540, mag: 32, reserve: 192,
    reload: 2.2, spread: 0.028, aimSpread: 0.01, range: 60, pellets: 1,
    kick: 0.016, adsFov: 58, moveMult: 1.0,
  },
  doublebarrel: {
    name: 'Double-Barrel', kind: 'shotgun', sound: 'shotgun', auto: false, price: 1200, box: 4, reloadStyle: 'break',
    damage: 55, headMult: 1.5, rpm: 240, mag: 2, reserve: 60,
    reload: 2.6, spread: 0.075, aimSpread: 0.06, range: 22, pellets: 8,
    kick: 0.11, adsFov: 62, moveMult: 0.97,
  },
  trenchgun: {
    name: 'Trench Gun', kind: 'shotgun', sound: 'shotgun', auto: false, price: 1500, box: 5,
    damage: 60, headMult: 1.5, rpm: 100, mag: 6, reserve: 60,
    reload: 3.2, spread: 0.065, aimSpread: 0.05, range: 25, pellets: 7,
    kick: 0.1, adsFov: 62, moveMult: 0.95, pump: true,
  },
  bar: {
    name: 'BAR', kind: 'lmg', sound: 'lmg', auto: true, price: 1800, box: 5,
    damage: 140, headMult: 3, rpm: 450, mag: 20, reserve: 160,
    reload: 2.8, spread: 0.022, aimSpread: 0.006, range: 110, pellets: 1,
    kick: 0.03, adsFov: 50, moveMult: 0.9, penetrate: 1,
  },
  stg44: {
    name: 'StG 44', kind: 'rifle', sound: 'smg', auto: true, box: 10,
    damage: 105, headMult: 3, rpm: 600, mag: 30, reserve: 240,
    reload: 2.5, spread: 0.022, aimSpread: 0.006, range: 90, pellets: 1,
    kick: 0.022, adsFov: 52, moveMult: 0.97,
  },
  ppsh: {
    name: 'PPSh-41', kind: 'smg', sound: 'smg', auto: true, box: 9,
    damage: 64, headMult: 2.5, rpm: 980, mag: 71, reserve: 284,
    reload: 3.0, spread: 0.034, aimSpread: 0.014, range: 55, pellets: 1,
    kick: 0.012, adsFov: 58, moveMult: 1.0,
  },
  mg42: {
    name: 'MG 42', kind: 'lmg', sound: 'lmg', auto: true, box: 6,
    damage: 125, headMult: 3, rpm: 1150, mag: 125, reserve: 500,
    reload: 5.2, spread: 0.035, aimSpread: 0.015, range: 110, pellets: 1,
    kick: 0.02, adsFov: 55, moveMult: 0.8, penetrate: 1,
  },
  panzerschreck: {
    name: 'Panzerschreck', kind: 'rocket', sound: 'rocket', auto: false, box: 3,
    damage: 1400, headMult: 1, rpm: 50, mag: 1, reserve: 14,
    reload: 3.4, spread: 0.01, aimSpread: 0.004, range: 120, pellets: 1,
    kick: 0.14, adsFov: 50, moveMult: 0.85,
    projectile: { speed: 30, radius: 4.2, gravity: 2, look: 'rocket', blast: 'fire', shake: 0.7, cripple: 0.35 },
  },
  arcpistol: {
    name: 'Arc Pistol', kind: 'wonder', sound: 'arc', auto: false, box: 2, grip: 'cup', reloadStyle: 'pistol',
    damage: 1100, headMult: 1, rpm: 190, mag: 20, reserve: 160,
    reload: 2.4, spread: 0.01, aimSpread: 0.004, range: 120, pellets: 1,
    kick: 0.05, adsFov: 58, moveMult: 1.0,
    projectile: { speed: 42, radius: 2.8, gravity: 0, look: 'orb', blast: 'arc', shake: 0.2, cripple: 0.5, stun: 3.5 },
  },
  leyden: {
    name: 'Leyden Rifle', kind: 'wonder', sound: 'tesla', auto: false, box: 3, reloadStyle: 'jar',
    damage: 1000, headMult: 1, rpm: 75, mag: 3, reserve: 9,
    reload: 3.2, spread: 0.008, aimSpread: 0.003, range: 60, pellets: 1,
    kick: 0.1, adsFov: 55, moveMult: 0.92,
    chain: { hops: 10, reach: 6.5, delay: 0.085, aim: 1.1, bossDamage: 1500 },
  },

  // --- Cold War guns (the Aurora Picture Palace) ---------------------------------------
  m14: {
    name: 'M14', kind: 'rifle', sound: 'rifle', auto: false, price: 500,
    damage: 120, headMult: 3, rpm: 450, mag: 8, reserve: 96,
    reload: 2.0, spread: 0.012, aimSpread: 0.002, range: 100, pellets: 1,
    kick: 0.035, adsFov: 48, moveMult: 0.96,
  },
  mp5k: {
    name: 'MP5K', kind: 'smg', sound: 'smg', auto: true, grip: 'post', price: 1000,
    damage: 70, headMult: 2.5, rpm: 900, mag: 30, reserve: 150,
    reload: 2.1, spread: 0.03, aimSpread: 0.012, range: 55, pellets: 1,
    kick: 0.014, adsFov: 58, moveMult: 1.0,
  },
  ak74u: {
    name: 'AK-74u', kind: 'smg', sound: 'smg', auto: true, price: 1200,
    damage: 90, headMult: 2.5, rpm: 750, mag: 20, reserve: 160,
    reload: 2.2, spread: 0.028, aimSpread: 0.01, range: 60, pellets: 1,
    kick: 0.018, adsFov: 56, moveMult: 1.0,
  },
  galil: {
    name: 'Galil', kind: 'rifle', sound: 'rifle', auto: true,
    damage: 110, headMult: 3, rpm: 650, mag: 35, reserve: 315,
    reload: 2.8, spread: 0.024, aimSpread: 0.006, range: 90, pellets: 1,
    kick: 0.02, adsFov: 52, moveMult: 0.96,
  },
  spas12: {
    name: 'SPAS-12', kind: 'shotgun', sound: 'shotgun', auto: false, reloadStyle: 'pump', price: 1500,
    damage: 55, headMult: 1.5, rpm: 240, mag: 8, reserve: 32,
    reload: 3.4, spread: 0.07, aimSpread: 0.055, range: 24, pellets: 8,
    kick: 0.1, adsFov: 60, moveMult: 0.95,
  },
  hk21: {
    name: 'HK21', kind: 'lmg', sound: 'lmg', auto: true, reloadStyle: 'belt',
    damage: 130, headMult: 3, rpm: 700, mag: 125, reserve: 500,
    reload: 5.0, spread: 0.034, aimSpread: 0.014, range: 110, pellets: 1,
    kick: 0.022, adsFov: 52, moveMult: 0.82, penetrate: 1,
  },
  dragunov: {
    name: 'Dragunov', kind: 'rifle', sound: 'bolt', auto: false,
    damage: 280, headMult: 4, rpm: 200, mag: 10, reserve: 40,
    reload: 2.8, spread: 0.03, aimSpread: 0.0004, range: 140, pellets: 1,
    kick: 0.07, adsFov: 30, moveMult: 0.92, penetrate: 2,
  },
  python: {
    name: 'Python', kind: 'pistol', sound: 'magnum', auto: false, grip: 'cup', reloadStyle: 'revolver',
    damage: 180, headMult: 2.5, rpm: 170, mag: 6, reserve: 60,
    reload: 3.0, spread: 0.014, aimSpread: 0.004, range: 50, pellets: 1,
    kick: 0.06, adsFov: 56, moveMult: 1.0,
  },
  chinalake: {
    name: 'China Lake', kind: 'rocket', sound: 'rocket', auto: false, pump: true, reloadStyle: 'launcher',
    damage: 900, headMult: 1, rpm: 60, mag: 2, reserve: 20,
    reload: 3.2, spread: 0.01, aimSpread: 0.004, range: 90, pellets: 1,
    kick: 0.1, adsFov: 52, moveMult: 0.9,
    projectile: { speed: 26, radius: 3.8, gravity: 9, look: 'grenade', blast: 'fire', shake: 0.5, cripple: 0.4 },
  },
  galecannon: {
    name: 'Gale Cannon', kind: 'wonder', sound: 'gale', auto: false, grip: 'post', reloadStyle: 'canister',
    damage: 5000, headMult: 1, rpm: 70, mag: 2, reserve: 12,
    reload: 3.0, spread: 0.01, aimSpread: 0.01, range: 11, pellets: 1,
    kick: 0.16, adsFov: 56, moveMult: 0.92,
    cone: { reach: 11, angle: 0.5, bossDamage: 2000 },
  },
};

// --- The Forge's upgrades --------------------------------------------------------------------
// Every gun can go through the Forge (maps with one, see maps/palace.js FORGE) and
// comes back as `<id>_up`: a new name, a camo (client/render/weapons3d.js), twice the
// damage, a bigger magazine and a fuller reserve. `extra` adds or replaces fields.
export const FORGE_COST = 5000;
export const UPGRADES = {
  m1911: { name: 'Brimstone', extra: { projectile: { speed: 60, radius: 2.4, gravity: 3, look: 'grenade', blast: 'fire', shake: 0.25, cripple: 0.3 }, damage: 420, mag: 6, reserve: 48 } },
  kar98k: { name: 'Nightingale' },
  m1carbine: { name: 'Dawnbreaker' },
  thompson: { name: 'Chicago Rattler' },
  mp40: { name: 'Wolfsbane' },
  doublebarrel: { name: 'Grave Digger' },
  trenchgun: { name: 'Gutter Sweeper' },
  bar: { name: 'Iron Lung' },
  stg44: { name: 'Sturmvogel' },
  ppsh: { name: 'Red Reaper' },
  mg42: { name: 'Bone Saw' },
  panzerschreck: { name: 'Hellmouth' },
  arcpistol: { name: 'Storm Caller' },
  leyden: { name: 'Leyden Tempest' },
  m14: { name: "Marksman's Oath" },
  mp5k: { name: "Hornet's Nest" },
  ak74u: { name: 'Comrade Carver' },
  galil: { name: "Lion's Roar" },
  spas12: { name: 'Doorbreaker' },
  hk21: { name: 'Hammerfall' },
  dragunov: { name: 'Night Owl' },
  python: { name: "Cobra's Fang" },
  chinalake: { name: 'Big Muddy' },
  galecannon: { name: 'Tempest Cannon' },
};

function upgrade(id, W, U) {
  const out = { ...W, name: U.name, upgradeOf: id };
  delete out.price;
  delete out.box;
  out.damage = W.damage * 2;
  out.mag = Math.max(W.mag + 1, Math.round(W.mag * 1.5));
  out.reserve = W.reserve * 2;
  out.reload = W.reload * 0.85;
  out.spread = W.spread * 0.8;
  if (W.projectile) out.projectile = { ...W.projectile, radius: W.projectile.radius * 1.3, stun: W.projectile.stun ? W.projectile.stun * 1.4 : undefined };
  if (W.chain) out.chain = { ...W.chain, hops: W.chain.hops + 6, reach: W.chain.reach + 2, bossDamage: W.chain.bossDamage * 2 };
  if (W.cone) out.cone = { ...W.cone, reach: W.cone.reach + 3, angle: W.cone.angle + 0.1, bossDamage: W.cone.bossDamage * 2 };
  return Object.assign(out, U.extra || {});
}

for (const [id, U] of Object.entries(UPGRADES)) if (WEAPONS[id]) WEAPONS[`${id}_up`] = upgrade(id, WEAPONS[id], U);

// The upgraded version of a gun, or null (already upgraded, or none).
export function upgradedId(id) {
  return WEAPONS[id] && !WEAPONS[id].upgradeOf && WEAPONS[`${id}_up`] ? `${id}_up` : null;
}

// The gun a wall buy or model stands for (an upgrade shares its base's).
export function baseId(id) {
  return WEAPONS[id]?.upgradeOf || id;
}

export const WEAPON_IDS = Object.keys(WEAPONS);

// Mystery box odds (weights, not percentages) and wall-buy prices, from the table.
export const BOX_POOL = Object.fromEntries(WEAPON_IDS.filter((id) => WEAPONS[id].box).map((id) => [id, WEAPONS[id].box]));
export const WALL_PRICES = Object.fromEntries(WEAPON_IDS.filter((id) => WEAPONS[id].price).map((id) => [id, WEAPONS[id].price]));

export const START_WEAPON = 'm1911';
export const KNIFE = { damage: 150, range: 1.7, cooldown: 0.65, lunge: 0.35 };
// cripple: the chance a zombie that survives the blast loses its legs.
export const GRENADE = { damage: 420, radius: 4.5, fuse: 2.4, max: 4, start: 2, perRound: 2, cripple: 0.3 };
// Grenade blasts look and shake like rockets.
export const GRENADE_BLAST = { blast: 'fire', shake: 0.7 };
export const MAX_PRIMARIES = 2;
export const BOX_COST = 950;

// Seconds between shots.
export function shotInterval(id) {
  return 60 / WEAPONS[id].rpm;
}

export function reloadStyle(w) {
  return w.reloadStyle || (w.kind === 'bolt' ? 'bolt' : w.pump ? 'pump' : w.kind === 'pistol' ? 'pistol' : w.kind === 'rocket' ? 'rocket' : 'mag');
}
