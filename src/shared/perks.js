// Perk machines: tonics a player buys once per life (lost when they go down).
// Effects are applied by the rules (GameSim) and, for feel, by the client
// (reload speed, fire rate). A map places machines in map.PERKS; they need the
// power on (map.POWER) when the map has a breaker.
//
// Adding a perk: an entry here, its effect where the field is read (grep the
// field name), a machine look in client/render/machines.js (PERK_LOOKS) and an
// icon in client/perk-icons.js. tests/perks.test.js checks the pieces agree.
//
// Fields:
//   name, cost, color (HUD and machine light), blurb (what the player reads)
//   hp          maximum health while you have it
//   reviveMult  multiplies the time it takes you to revive a teammate
//   solo        { cost, uses }: alone, it revives you instead (the machine closes after `uses`)
//   reloadMult  multiplies reload time
//   rateMult    multiplies fire rate

export const PERKS = {
  ironclad: {
    name: 'Ironclad Tonic', cost: 2500, color: '#d8342c',
    blurb: 'Take far more punishment before you go down.',
    hp: 250,
  },
  lazarus: {
    name: 'Lazarus Draught', cost: 1500, color: '#3f8fe0',
    blurb: 'Revive teammates in half the time. Alone, it gets you back up.',
    reviveMult: 0.5, solo: { cost: 500, uses: 3 },
  },
  quicksilver: {
    name: 'Quicksilver Cola', cost: 3000, color: '#3dbb5a',
    blurb: 'Reload in half the time.',
    reloadMult: 0.5,
  },
  hairtrigger: {
    name: 'Hair Trigger Stout', cost: 2000, color: '#e0b22c',
    blurb: 'Your guns fire a third faster.',
    rateMult: 1.33,
  },
};

export const PERK_IDS = Object.keys(PERKS);
export const BASE_HP = 100;

// A player's maximum health, fire-rate and reload multipliers from their perks.
export function maxHp(perks) {
  let hp = BASE_HP;
  for (const id of perks || []) hp = Math.max(hp, PERKS[id]?.hp ?? 0);
  return hp;
}

export function perkMult(perks, field) {
  let m = 1;
  for (const id of perks || []) m *= PERKS[id]?.[field] ?? 1;
  return m;
}

// What a perk costs this player: Lazarus is cheap alone.
export function perkCost(id, solo) {
  const P = PERKS[id];
  return solo && P.solo ? P.solo.cost : P.cost;
}
