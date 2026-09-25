// Weapon table shared by the client (feel, ammo, visuals) and the server
// (damage, fire-rate validation, purchases). Damage is always computed on
// the authoritative side from this table; clients only claim hits.

export const WEAPONS = {
  m1911: {
    name: 'M1911', kind: 'pistol', sound: 'pistol', auto: false,
    damage: 50, headMult: 2.5, rpm: 420, mag: 8, reserve: 32,
    reload: 1.6, spread: 0.012, aimSpread: 0.004, range: 45, pellets: 1,
    kick: 0.035, adsFov: 58, moveMult: 1.0,
  },
  kar98k: {
    name: 'Kar98k', kind: 'bolt', sound: 'bolt', auto: false,
    damage: 220, headMult: 4, rpm: 52, mag: 5, reserve: 50,
    reload: 2.9, spread: 0.02, aimSpread: 0.0005, range: 120, pellets: 1,
    kick: 0.09, adsFov: 45, moveMult: 0.95, penetrate: 2,
  },
  m1carbine: {
    name: 'M1 Carbine', kind: 'rifle', sound: 'rifle', auto: false,
    damage: 95, headMult: 3, rpm: 480, mag: 15, reserve: 120,
    reload: 2.0, spread: 0.014, aimSpread: 0.002, range: 90, pellets: 1,
    kick: 0.03, adsFov: 50, moveMult: 0.97,
  },
  thompson: {
    name: 'Thompson', kind: 'smg', sound: 'smg', auto: true,
    damage: 75, headMult: 2.5, rpm: 720, mag: 30, reserve: 240,
    reload: 2.4, spread: 0.03, aimSpread: 0.012, range: 60, pellets: 1,
    kick: 0.018, adsFov: 58, moveMult: 1.0,
  },
  mp40: {
    name: 'MP40', kind: 'smg', sound: 'smg', auto: true,
    damage: 72, headMult: 2.5, rpm: 540, mag: 32, reserve: 192,
    reload: 2.2, spread: 0.028, aimSpread: 0.01, range: 60, pellets: 1,
    kick: 0.016, adsFov: 58, moveMult: 1.0,
  },
  doublebarrel: {
    name: 'Double-Barrel', kind: 'shotgun', sound: 'shotgun', auto: false,
    damage: 55, headMult: 1.5, rpm: 240, mag: 2, reserve: 60,
    reload: 2.6, spread: 0.075, aimSpread: 0.06, range: 22, pellets: 8,
    kick: 0.11, adsFov: 62, moveMult: 0.97,
  },
  trenchgun: {
    name: 'Trench Gun', kind: 'shotgun', sound: 'shotgun', auto: false,
    damage: 60, headMult: 1.5, rpm: 100, mag: 6, reserve: 60,
    reload: 3.2, spread: 0.065, aimSpread: 0.05, range: 25, pellets: 7,
    kick: 0.1, adsFov: 62, moveMult: 0.95, pump: true,
  },
  bar: {
    name: 'BAR', kind: 'lmg', sound: 'lmg', auto: true,
    damage: 140, headMult: 3, rpm: 450, mag: 20, reserve: 160,
    reload: 2.8, spread: 0.022, aimSpread: 0.006, range: 110, pellets: 1,
    kick: 0.03, adsFov: 50, moveMult: 0.9, penetrate: 1,
  },
  stg44: {
    name: 'StG 44', kind: 'rifle', sound: 'smg', auto: true,
    damage: 105, headMult: 3, rpm: 600, mag: 30, reserve: 240,
    reload: 2.5, spread: 0.022, aimSpread: 0.006, range: 90, pellets: 1,
    kick: 0.022, adsFov: 52, moveMult: 0.97,
  },
  ppsh: {
    name: 'PPSh-41', kind: 'smg', sound: 'smg', auto: true,
    damage: 64, headMult: 2.5, rpm: 980, mag: 71, reserve: 284,
    reload: 3.0, spread: 0.034, aimSpread: 0.014, range: 55, pellets: 1,
    kick: 0.012, adsFov: 58, moveMult: 1.0,
  },
  mg42: {
    name: 'MG 42', kind: 'lmg', sound: 'lmg', auto: true,
    damage: 125, headMult: 3, rpm: 1150, mag: 125, reserve: 500,
    reload: 5.2, spread: 0.035, aimSpread: 0.015, range: 110, pellets: 1,
    kick: 0.02, adsFov: 55, moveMult: 0.8, penetrate: 1,
  },
  panzerschreck: {
    name: 'Panzerschreck', kind: 'rocket', sound: 'rocket', auto: false,
    damage: 1400, headMult: 1, rpm: 50, mag: 1, reserve: 14,
    reload: 3.4, spread: 0.01, aimSpread: 0.004, range: 120, pellets: 1,
    kick: 0.14, adsFov: 50, moveMult: 0.85,
    projectile: { speed: 30, radius: 4.2, gravity: 2 },
  },
  arcpistol: {
    name: 'Arc Pistol', kind: 'wonder', sound: 'arc', auto: false,
    damage: 1100, headMult: 1, rpm: 190, mag: 20, reserve: 160,
    reload: 2.4, spread: 0.01, aimSpread: 0.004, range: 120, pellets: 1,
    kick: 0.05, adsFov: 58, moveMult: 1.0,
    projectile: { speed: 42, radius: 2.8, gravity: 0 },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

// Mystery box odds. Weights, not percentages.
export const BOX_POOL = {
  stg44: 10, ppsh: 9, mg42: 6, mp40: 5, thompson: 5, trenchgun: 5,
  bar: 5, doublebarrel: 4, kar98k: 3, m1carbine: 3,
  panzerschreck: 3, arcpistol: 2,
};

export const START_WEAPON = 'm1911';
export const KNIFE = { damage: 150, range: 1.7, cooldown: 0.65, lunge: 0.35 };
export const GRENADE = { damage: 420, radius: 4.5, fuse: 2.4, max: 4, start: 2, perRound: 2 };
export const MAX_PRIMARIES = 2;

export function weaponCost(id) {
  return WALL_PRICES[id] ?? null;
}

// Wall-buy prices. Ammo refill is half price.
export const WALL_PRICES = {
  kar98k: 200, m1carbine: 600, thompson: 1200, doublebarrel: 1200,
  mp40: 1000, trenchgun: 1500, bar: 1800,
};

export const BOX_COST = 950;

export function shotInterval(id) {
  return 60 / WEAPONS[id].rpm;
}
