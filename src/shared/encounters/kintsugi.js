// The Kintsugi easter egg: shoot the three gold-mended teacups, touch the
// figurine, and the porcelain boss steps out of the air. She is slow while
// anyone watches her and fast when nobody does, shatters and re-forms behind a
// player, and drops Gold Leaf: the Arc Pistol for the grabber, gold for everyone.
//
// An encounter for GameSim (see "Encounters" in sim.js). Its state lives on the
// sim: egg ({ cups, stage: cups|ready|awake|done, spawnT }) and boss (her enemy).
// Places come from the map (map.EGG).

import { ZC, ZS, PS } from '../protocol.js';
import { enemy } from '../enemies.js';
import { raySphere } from '../world.js';
import { GRENADE } from '../weapons.js';
import { r2, vec3 } from '../wire.js';

const GOLD_LEAF_WEAPON = 'arcpistol';

export function bossHealth(r, players) {
  return Math.round(1800 + 1800 * Math.max(1, players) + 150 * r);
}

export const KINTSUGI_EGG = {
  id: 'kintsugi',

  init(sim) {
    sim.egg = { cups: sim.map.EGG.cups.map(() => false), stage: 'cups', spawnT: 0 };
    sim.boss = null;
  },

  handle(sim, p, m) {
    if (m.t === 'cup') { onCup(sim, p, m); return true; }
    if (m.t === 'egg') { onFigurine(sim, p); return true; }
    return false;
  },

  step(sim, dt) {
    if (sim.egg.spawnT <= 0) return;
    sim.egg.spawnT -= dt;
    if (sim.egg.spawnT <= 0) spawnBoss(sim);
  },

  ai: { boss: zBoss },

  onDamaged(sim, z) { if (z === sim.boss) bossDamaged(sim, z); },

  onKill(sim, z) {
    if (z.cls !== ZC.KINTSUGI) return false;
    sim.boss = null;
    sim.egg.stage = 'done';
    sim.dropPowerup('goldleaf', z.x, z.y, z.z, 90);
    return true;
  },

  // Blasts shatter teacups too.
  onBlast(sim, x, y, z, radius, owner) {
    if (sim.egg.stage !== 'cups') return;
    sim.map.EGG.cups.forEach((c, i) => {
      if (sim.egg.cups[i] || Math.hypot(c.pos[0] - x, c.pos[1] - y, c.pos[2] - z) > radius * 0.6) return;
      if (sim.world.lineOfSight(x, y, z, c.pos[0], c.pos[1] + 0.05, c.pos[2])) breakCup(sim, i, owner ? owner.id : null);
    });
  },

  // The porcelain boss's gift: the Arc Pistol for whoever grabs it, gold for everyone.
  applyPowerup(sim, pu, p) {
    if (pu.type !== 'goldleaf') return false;
    if (p.weapons.includes(GOLD_LEAF_WEAPON)) sim.emit(['ammo', p.id, GOLD_LEAF_WEAPON]);
    else { sim.giveWeapon(p, GOLD_LEAF_WEAPON); sim.emit(['give', p.id, GOLD_LEAF_WEAPON, p.weapons.join(',')]); }
    for (const q of sim.activePlayers()) {
      if (q.state === PS.DEAD) continue;
      q.grenades = GRENADE.max;
      sim.addPoints(q, 1000, 2);
    }
    return true;
  },

  snapshot(sim, out) {
    const b = sim.boss;
    // Boss: [id, health per mille, damage stage, watched].
    out.kb = b ? [b.id, Math.max(0, Math.round((b.hp / b.maxHp) * 1000)), b.stage, b.watched ? 1 : 0] : 0;
  },
  welcome(sim, out) { out.egg = { cups: [...sim.egg.cups], stage: sim.egg.stage }; },
};

// A client claims its shot hit teacup `i`; check the ray and the line of sight.
function onCup(sim, p, m) {
  if (sim.egg.stage !== 'cups' || p.state !== PS.ALIVE) return;
  const i = m.i | 0;
  const cup = sim.map.EGG.cups[i];
  if (!cup || sim.egg.cups[i]) return;
  const o = vec3(m.o), d = vec3(m.d);
  if (!o || !d) return;
  if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2 || Math.abs(o[1] - (p.y + 1.4)) > 1.4) return;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const [cx, cy, cz] = [cup.pos[0], cup.pos[1] + 0.05, cup.pos[2]];
  const t = raySphere(o[0], o[1], o[2], d[0] / len, d[1] / len, d[2] / len, cx, cy, cz, sim.map.EGG.cupRadius * 1.6);
  if (t < 0 || t > 90) return;
  if (!sim.world.lineOfSight(o[0], o[1], o[2], cx, cy, cz)) return;
  breakCup(sim, i, p.id);
}

function breakCup(sim, i, by) {
  if (sim.egg.stage !== 'cups' || sim.egg.cups[i]) return;
  sim.egg.cups[i] = true;
  sim.emit(['cup', i, by]);
  if (sim.egg.cups.every(Boolean)) {
    sim.egg.stage = 'ready';
    sim.emit(['egg', 'ready']);
  }
}

function onFigurine(sim, p) {
  if (sim.egg.stage !== 'ready' || p.state !== PS.ALIVE) return;
  const f = sim.map.EGG.figurine.pos;
  if (Math.hypot(p.x - f[0], p.z - f[2]) > 2.2 || p.y > 1.2) return;
  sim.egg.stage = 'awake';
  sim.egg.spawnT = 3.6;
  sim.emit(['egg', 'wake', p.id]);
}

// Kintsugi steps out of the air in the help room, where her figurine stood watch.
export function spawnBoss(sim) {
  const [bx, by, bz] = sim.map.EGG.boss;
  let i = sim.nav.locateStrict(bx, by, bz);
  if (i < 0) i = sim.nav.locate(bx, by, bz);
  const c = i >= 0 ? sim.nav.center(i) : [bx, by, bz];
  const hp = bossHealth(sim.round, sim.activePlayers().length);
  const k = {
    id: sim.nextZid++, cls: ZC.KINTSUGI, speed: enemy(ZC.KINTSUGI).speed[0], hp, maxHp: hp, x: c[0], y: c[1], z: c[2], yaw: -Math.PI / 2,
    state: ZS.REFORM, t: 1.4, win: null, lv: 0, atk: 0, cell: -1, stuck: 0, cool: 1, shT: 9, stage: 0, watched: false,
  };
  sim.zombies.set(k.id, k);
  sim.boss = k;
  sim.emit(['zspawn', k.id, ZC.KINTSUGI, 0]);
  sim.emit(['kreform', k.id, r2(k.x), r2(k.y), r2(k.z)]);
}

// Her AI (enemies.js ai: 'boss'): slow while watched, a rush when not, and
// every few seconds she shatters and re-forms near someone.
function zBoss(sim, z, dt) {
  switch (z.state) {
    case ZS.REFORM:
      if (z.t <= 0) { z.state = ZS.CHASE; z.cool = 0.2; }
      return;
    case ZS.SHATTER:
      if (z.t <= 0) bossReform(sim, z);
      return;
    case ZS.ATTACK:
      sim.zAttack(z, dt);
      return;
    default: {
      z.watched = bossWatched(sim, z);
      const E = enemy(z.cls);
      z.speed = z.watched ? E.speed[0] : E.rushSpeed;
      z.shT -= dt;
      const [p, pd] = sim.nearestAlive(z.x, z.y, z.z);
      if (z.shT <= 0 && p && pd > 2.5) { bossShatter(sim, z); return; }
      sim.zChase(z, dt);
    }
  }
}

export function bossWatched(sim, z) {
  for (const p of sim.players.values()) {
    if (!p.connected || p.state !== PS.ALIVE) continue;
    const ex = p.x, ey = p.y + 1.55, ez = p.z;
    const vx = z.x - ex, vy = z.y + 1.2 - ey, vz = z.z - ez;
    const d = Math.hypot(vx, vy, vz);
    if (d > 40 || d < 1e-3) continue;
    const cp = Math.cos(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;
    if ((vx * fx + vy * fy + vz * fz) / d < 0.8) continue;
    if (sim.world.lineOfSight(ex, ey, ez, z.x, z.y + 1.2, z.z)) return true;
  }
  return false;
}

// Every quarter of her health that breaks off, she shatters.
function bossDamaged(sim, z) {
  const stage = Math.min(3, Math.floor((1 - z.hp / z.maxHp) * 4));
  if (stage <= z.stage) return;
  z.stage = stage;
  sim.emit(['kstage', z.id, stage]);
  if (z.state === ZS.CHASE || z.state === ZS.ATTACK) bossShatter(sim, z);
}

function bossShatter(sim, z) {
  const alive = sim.activePlayers().filter((p) => p.state === PS.ALIVE);
  z.state = ZS.SHATTER;
  z.t = enemy(z.cls).shatterTime;
  z.shT = 8 + sim.rng() * 5;
  z.shTarget = alive.length ? alive[Math.floor(sim.rng() * alive.length)].id : null;
  sim.emit(['kshatter', z.id, r2(z.x), r2(z.y), r2(z.z)]);
}

function bossReform(sim, z) {
  const p = sim.players.get(z.shTarget);
  if (p && p.state === PS.ALIVE) {
    // Behind them first, then to the sides, then anywhere close.
    const bx = Math.sin(p.yaw), bz = Math.cos(p.yaw); // "behind" = opposite of view (-sin, -cos)
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = bx * ca - bz * sa, dz = bx * sa + bz * ca;
      const x = p.x + dx * 1.7, zz = p.z + dz * 1.7;
      const i = sim.nav.locateStrict(x, p.y, zz);
      if (i < 0 || Math.abs(sim.nav.height[i] - p.y) > 0.6) continue;
      if (!sim.world.lineOfSight(p.x, p.y + 1, p.z, x, p.y + 1, zz)) continue;
      z.x = x; z.z = zz; z.y = sim.nav.height[i];
      break;
    }
    z.yaw = Math.atan2(p.x - z.x, p.z - z.z);
  }
  z.state = ZS.REFORM;
  z.t = enemy(z.cls).reformTime;
  z.stuck = 0;
  sim.emit(['kreform', z.id, r2(z.x), r2(z.y), r2(z.z)]);
}
