// Wire constants shared by clients, the browser-local sim and both servers.

export const PROTOCOL = 1;
export const MAX_PLAYERS = 4;

// Zombie states.
export const ZS = { RISE: 0, WINDOW_WALK: 1, TEAR: 2, CLIMB: 3, CHASE: 4, ATTACK: 5 };
// Player states.
export const PS = { ALIVE: 0, DOWN: 1, DEAD: 2 };

export const POWERUPS = ['maxammo', 'instakill', 'doublepoints', 'nuke', 'carpenter'];

// Input flag bits.
export const IN = { USE: 1, SPRINT: 2, CROUCH: 4, ADS: 8, RELOAD: 16, FIRE: 32 };

export const PLAYER_COLORS = ['#f2efe6', '#6aa9ff', '#ffd24a', '#6fdc7a'];

// Cloudflare Durable Object location hints and friendly names.
export const REGIONS = {
  wnam: 'Western North America',
  enam: 'Eastern North America',
  sam: 'South America',
  weur: 'Western Europe',
  eeur: 'Eastern Europe',
  apac: 'Asia-Pacific',
  oc: 'Oceania',
  afr: 'Africa',
  me: 'Middle East',
};

// Pick the region that minimises the worst player's latency, breaking ties
// by the mean. `pings` is an array of {region: ms} tables (missing = unknown).
export function chooseRegion(pings, regions) {
  let best = null, bestWorst = Infinity, bestMean = Infinity;
  for (const r of regions) {
    let worst = 0, sum = 0, n = 0;
    for (const table of pings) {
      const v = table && Number.isFinite(table[r]) ? table[r] : 400;
      worst = Math.max(worst, v); sum += v; n++;
    }
    const mean = n ? sum / n : 0;
    if (worst < bestWorst - 5 || (Math.abs(worst - bestWorst) <= 5 && mean < bestMean)) {
      best = r; bestWorst = worst; bestMean = mean;
    }
  }
  return { region: best, worst: bestWorst, mean: bestMean };
}

export function randomCode(rand = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
