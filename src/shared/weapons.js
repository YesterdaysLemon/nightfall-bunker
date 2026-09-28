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
//             'jar'; defaults from kind and pump
//   projectile   { speed, radius (blast), gravity, look: 'rocket' | 'orb', blast: 'fire' | 'arc', shake }
//   chain     chain lightning instead of a bullet: { hops, reach (m), delay (s per hop),
//             aim (m of aim forgiveness), bossDamage }. The bolt strikes the enemy
//             nearest the aim line and leaps to the nearest enemy it can see within
//             reach, up to `hops` enemies. It kills anything but a boss outright.

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
    projectile: { speed: 30, radius: 4.2, gravity: 2, look: 'rocket', blast: 'fire', shake: 0.7 },
  },
  arcpistol: {
    name: 'Arc Pistol', kind: 'wonder', sound: 'arc', auto: false, box: 2, grip: 'cup', reloadStyle: 'pistol',
    damage: 1100, headMult: 1, rpm: 190, mag: 20, reserve: 160,
    reload: 2.4, spread: 0.01, aimSpread: 0.004, range: 120, pellets: 1,
    kick: 0.05, adsFov: 58, moveMult: 1.0,
    projectile: { speed: 42, radius: 2.8, gravity: 0, look: 'orb', blast: 'arc', shake: 0.2 },
  },
  leyden: {
    name: 'Leyden Rifle', kind: 'wonder', sound: 'tesla', auto: false, box: 3, reloadStyle: 'jar',
    damage: 1000, headMult: 1, rpm: 75, mag: 3, reserve: 9,
    reload: 3.2, spread: 0.008, aimSpread: 0.003, range: 60, pellets: 1,
    kick: 0.1, adsFov: 55, moveMult: 0.92,
    chain: { hops: 10, reach: 6.5, delay: 0.085, aim: 1.1, bossDamage: 1500 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

// Mystery box odds (weights, not percentages) and wall-buy prices, from the table.
export const BOX_POOL = Object.fromEntries(WEAPON_IDS.filter((id) => WEAPONS[id].box).map((id) => [id, WEAPONS[id].box]));
export const WALL_PRICES = Object.fromEntries(WEAPON_IDS.filter((id) => WEAPONS[id].price).map((id) => [id, WEAPONS[id].price]));

export const START_WEAPON = 'm1911';
export const KNIFE = { damage: 150, range: 1.7, cooldown: 0.65, lunge: 0.35 };
export const GRENADE = { damage: 420, radius: 4.5, fuse: 2.4, max: 4, start: 2, perRound: 2 };
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
