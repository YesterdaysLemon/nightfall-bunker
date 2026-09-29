// Words the player reads, in one place: a re-theme (or a translation) changes
// them here without touching game code. Names of enemies, guns and power-ups
// live with their data (shared/enemies.js, weapons.js, powerups.js).

export const TEXT = {
  joined: (name) => `${name} joined`,
  left: (name) => `${name} left`,
  down: (name) => `${name} is down!`,
  reviveHint: (key) => `Hold ${key} near them to revive`,
  soundToggle: (on, key) => [on ? 'Sound on' : 'Sound off', `Press ${key} to toggle`],

  houndsTitle: 'The hounds are loose',
  houndsSub: 'Back to a wall. Watch each other.',
  bossTitle: 'Kintsugi',
  bossSub: 'Broken things were mended with gold',
  bossKilled: 'Kintsugi is broken',
  bossKilledSub: 'Something golden fell where she stood',
  eggWake: 'Something stirs…',

  // Interaction prompts (key is the player's "use" key).
  revive: (key, name) => `Hold <b>${key}</b> to revive ${name}`,
  boxTake: (key, gun) => `Press <b>${key}</b> to take the ${gun}`,
  box: (key, cost) => `Press <b>${key}</b> for a random weapon <span class="cost">[Cost: ${cost}]</span>`,
  buyAmmo: (key, gun, cost) => `Press <b>${key}</b> to buy ${gun} ammo <span class="cost">[Cost: ${cost}]</span>`,
  buyGun: (key, gun, cost) => `Press <b>${key}</b> to buy ${gun} <span class="cost">[Cost: ${cost}]</span>`,
  openDoor: (key, verb, cost) => `Press <b>${key}</b> to ${verb} <span class="cost">[Cost: ${cost}]</span>`,
  rebuild: (key) => `Hold <b>${key}</b> to rebuild the barrier`,
  figurine: (key) => `Press <b>${key}</b> to touch the figurine`,

  // The building's machines.
  needPower: 'The power is off',
  power: (key) => `Press <b>${key}</b> to throw the Main Breaker`,
  powerOn: 'The power is on',
  powerOnSub: 'Somewhere, machines are waking up',
  perk: (key, name, cost) => `Press <b>${key}</b> to buy ${name} <span class="cost">[Cost: ${cost}]</span>`,
  forge: (key, gun, cost) => `Press <b>${key}</b> to put the ${gun} in the Forge <span class="cost">[Cost: ${cost}]</span>`,
  forgeBusy: 'The Forge is working',
  forgeNo: 'The Forge has done all it can for this gun',
  forgeSpare: 'Carry a second gun: the Forge keeps this one while it works',
  forgeReady: (key) => `Your gun is ready. Press ${key} at the Forge`,
  coreLink: (key) => `Press <b>${key}</b> to link the teleporter`,
  padLever: (key) => `Press <b>${key}</b> to pull the teleporter's lever`,
  padLeverDone: 'Now link it at the lantern on the stage',
  padWaiting: 'Link it at the lantern on the stage',
  padLinked: 'The teleporter is linked',
  padCooling: 'The teleporter is cooling down',
  teleRide: (key, cost) => `Press <b>${key}</b> to use the teleporter <span class="cost">[Cost: ${cost}]</span>`,
  curtain: 'The curtain rises',
  curtainSub: 'Something waits on the stage',
  trap: (key, cost) => `Press <b>${key}</b> to switch on the Spark Gate <span class="cost">[Cost: ${cost}]</span>`,
  trapCooling: 'The Spark Gate is cooling down',
  boxMoved: 'The box has moved',
};

// Sound captions (Accessibility): what a sound was; an arrow shows where.
export const SOUND_CAPTIONS = {
  groan: 'Zombie groans', scream: 'Zombie screams', swipe: 'Zombie swipes', growl: 'Hound growls', bark: 'Hound barks',
  bite: 'Hound snaps', howl: 'Hound howls', strike: 'Thunder cracks', porcelain: 'Porcelain grinds', cup: 'Porcelain shatters',
  chime: 'A soft chime', music: '♪ A music box plays',
  power: 'Machines hum to life', vend: 'A bottle drops', forge: 'The Forge roars', teleport: 'A projector whirs',
  jingle: '♪ A perk machine plays', boxFly: 'The box flies away',
};
