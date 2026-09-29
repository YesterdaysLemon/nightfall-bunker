// The building's machines, for maps that have them (maps/palace.js): the Main
// Breaker, perk machines, the Forge, the Magic Lantern teleporter and the Spark
// Gates. Everything but the breaker waits for the power.
//
// An encounter for GameSim (see "Encounters" in sim.js). Clients buy with
// { t: 'buy', k: 'power' | 'perk' | 'forge' | 'forgeTake' | 'link' | 'tele' | 'trap', id }.
// Events: ['power'], ['perk', pid, perkId, bits], ['forge', state, pid, gun],
// ['tele', what, pad], ['warp', pid, x, y, z, yaw], ['trap', i, state].

import { PS, ZS } from '../protocol.js';
import { PERKS, PERK_IDS, perkCost } from '../perks.js';
import { FORGE_COST, upgradedId } from '../weapons.js';
import { enemy } from '../enemies.js';

export const FORGE_WORK = 3.6, FORGE_OFFER = 12;
const TRAP_HURT = 45, TRAP_HURT_EVERY = 0.6;

// A perk list as bits (PERK_IDS order), for the snapshot.
export function perkBits(perks) {
  let b = 0;
  for (const id of perks) { const i = PERK_IDS.indexOf(id); if (i >= 0) b |= 1 << i; }
  return b;
}

const near = (p, pos, r, dy = 1.6) => Math.hypot(p.x - pos[0], p.z - pos[2]) <= r && Math.abs(p.y - pos[1]) < dy;

export const MACHINES = {
  id: 'machines',

  init(sim) {
    const M = sim.map;
    sim.power = false;
    sim.perkUses = {};   // solo Lazarus: how many times its machine has sold
    sim.forge = { state: 'idle', owner: null, weapon: null, t: 0 };
    sim.tele = {
      used: false,
      pads: (M.TELEPORT?.pads || []).map(() => ({ linked: false, waiting: 0, cool: 0 })),
      trips: [],   // { riders: [pid], t, pad }
    };
    sim.traps = (M.TRAPS || []).map(() => ({ state: 'ready', t: 0, hurtT: {} }));
  },

  handle(sim, p, m) {
    if (m.t !== 'buy' || p.state !== PS.ALIVE) return false;
    const M = sim.map;
    switch (m.k) {
      case 'power': {
        if (!M.POWER || sim.power || !sim.zones.has(M.POWER.zone) || !near(p, M.POWER.use, 1.8)) return true;
        sim.power = true;
        sim.emit(['power']);
        return true;
      }
      case 'perk': {
        const mc = (M.PERKS || []).find((q) => q.perk === m.id);
        if (!mc || !sim.power || !sim.zones.has(mc.zone) || p.perks.includes(mc.perk)) return true;
        if (!near(p, mc.use, 1.5)) return true;
        const solo = sim.activePlayers().length === 1;
        const P = PERKS[mc.perk];
        if (solo && P.solo && (sim.perkUses[mc.perk] || 0) >= P.solo.uses) return true;
        if (!sim.spend(p, perkCost(mc.perk, solo))) return true;
        if (solo && P.solo) sim.perkUses[mc.perk] = (sim.perkUses[mc.perk] || 0) + 1;
        sim.givePerk(p, mc.perk);
        return true;
      }
      case 'forge': {
        const F = M.FORGE;
        if (!F || !sim.power || sim.forge.state !== 'idle' || !sim.zones.has(F.zone) || !near(p, F.use, 1.8)) return true;
        const up = upgradedId(p.cur);
        // The Forge keeps your gun while it works: you need another in hand meanwhile.
        if (!up || p.weapons.length < 2 || !p.weapons.includes(p.cur)) { sim.emit(['deny', p.id]); return true; }
        if (!sim.spend(p, FORGE_COST)) return true;
        const gun = p.cur;
        p.weapons = p.weapons.filter((w) => w !== gun);
        p.cur = p.weapons[0];
        sim.forge = { state: 'working', owner: p.id, weapon: up, t: FORGE_WORK };
        sim.emit(['give', p.id, p.cur, p.weapons.join(',')]);
        sim.emit(['forge', 'working', p.id, gun]);
        return true;
      }
      case 'forgeTake': {
        const F = M.FORGE;
        if (!F || sim.forge.state !== 'ready' || sim.forge.owner !== p.id || !near(p, F.use, 2.2)) return true;
        sim.giveWeapon(p, sim.forge.weapon);
        sim.emit(['give', p.id, sim.forge.weapon, p.weapons.join(',')]);
        sim.forge = { state: 'idle', owner: null, weapon: null, t: 0 };
        sim.emit(['forge', 'idle', p.id, '']);
        return true;
      }
      case 'link': {
        // At a pad: pull its lever (then link it at the lantern). At the lantern: link.
        const TP = M.TELEPORT;
        if (!TP || !sim.power) return true;
        const i = TP.pads.findIndex((pad) => pad.id === m.id);
        if (i >= 0) {
          const pad = TP.pads[i], st = sim.tele.pads[i];
          if (!sim.zones.has(pad.zone) || !near(p, pad.use, 1.8) || st.linked || st.cool > 0) return true;
          st.waiting = TP.linkWindow;
          sim.emit(['tele', 'lever', i]);
        } else if (m.id === 'core') {
          if (!sim.zones.has(TP.core.zone) || !near(p, TP.core.use, 1.8)) return true;
          const j = sim.tele.pads.findIndex((st) => st.waiting > 0);
          if (j < 0) return true;
          sim.tele.pads[j].waiting = 0;
          sim.tele.pads[j].linked = true;
          sim.emit(['tele', 'linked', j]);
        }
        return true;
      }
      case 'tele': {
        const TP = M.TELEPORT;
        const i = TP ? TP.pads.findIndex((pad) => pad.id === m.id) : -1;
        if (i < 0 || !sim.power) return true;
        const pad = TP.pads[i], st = sim.tele.pads[i];
        if (!st.linked || !near(p, pad.pos, pad.radius + 0.2)) return true;
        if (!sim.spend(p, TP.cost)) return true;
        st.linked = false;
        st.cool = TP.cooldown;
        const riders = sim.activePlayers().filter((q) => q.state === PS.ALIVE && near(q, pad.pos, pad.radius + 0.2));
        riders.forEach((q, k) => {
          const b = TP.booth[k % TP.booth.length];
          sim.warpPlayer(q, b);
          q.away = true;
        });
        sim.tele.trips.push({ riders: riders.map((q) => q.id), t: TP.boothTime, pad: i });
        sim.emit(['tele', 'fire', i]);
        if (!sim.tele.used) {
          sim.tele.used = true;
          if (M.DOORS.some((d) => d.id === 'curtain')) sim.openDoor('curtain');
          sim.emit(['tele', 'reveal', i]);
        }
        return true;
      }
      case 'trap': {
        const i = (M.TRAPS || []).findIndex((t) => t.id === m.id);
        if (i < 0 || !sim.power) return true;
        const T = M.TRAPS[i], st = sim.traps[i];
        if (st.state !== 'ready' || !sim.zones.has(T.zone) || !near(p, T.switch.use, 1.8)) return true;
        if (!sim.spend(p, T.cost)) return true;
        Object.assign(st, { state: 'active', t: T.time, hurtT: {} });
        sim.emit(['trap', i, 'active']);
        return true;
      }
      default:
        return false;
    }
  },

  step(sim, dt) {
    const M = sim.map;
    // The Forge at work, then offering the upgraded gun for a while.
    const F = sim.forge;
    if (F.state !== 'idle') {
      F.t -= dt;
      if (F.state === 'working' && F.t <= 0) {
        Object.assign(F, { state: 'ready', t: FORGE_OFFER });
        sim.emit(['forge', 'ready', F.owner, F.weapon]);
      } else if (F.state === 'ready' && F.t <= 0) {
        sim.forge = { state: 'idle', owner: null, weapon: null, t: 0 };
        sim.emit(['forge', 'idle', '', '']);
      }
    }
    // The teleporter: link windows, cooldowns, and riders coming back from the booth.
    for (let i = 0; i < sim.tele.pads.length; i++) {
      const st = sim.tele.pads[i];
      if (st.waiting > 0 && (st.waiting -= dt) <= 0) sim.emit(['tele', 'unlinked', i]);
      if (st.cool > 0 && (st.cool -= dt) <= 0) sim.emit(['tele', 'ready', i]);
    }
    for (let k = sim.tele.trips.length - 1; k >= 0; k--) {
      const trip = sim.tele.trips[k];
      if ((trip.t -= dt) > 0) continue;
      sim.tele.trips.splice(k, 1);
      trip.riders.forEach((id, j) => {
        const q = sim.players.get(id);
        if (!q) return;
        q.away = false;
        if (q.state === PS.DEAD) return;
        sim.warpPlayer(q, M.TELEPORT.back[j % M.TELEPORT.back.length]);
      });
      sim.emit(['tele', 'return', trip.pad]);
    }
    // Spark Gates: fry what walks through, burn players who do, then cool down.
    (M.TRAPS || []).forEach((T, i) => {
      const st = sim.traps[i];
      if (st.state === 'ready') return;
      st.t -= dt;
      if (st.state === 'active') {
        const a = T.area;
        const inside = (x, y, z) => x > a[0] && x < a[3] && y > a[1] && y < a[4] && z > a[2] && z < a[5];
        for (const z of [...sim.zombies.values()]) {
          if (!sim.vulnerable(z) || z.state === ZS.RISE || !inside(z.x, z.y + 0.3, z.z)) continue;
          const E = enemy(z.cls);
          if (E.boss) sim.damageZombie(z, 400 * dt, null, 'shock', [0, 0, 1]);
          else sim.killZombie(z, null, 'shock', [z.x - (a[0] + a[3]) / 2, 0, z.z - (a[2] + a[5]) / 2]);
        }
        for (const q of sim.players.values()) {
          if (!q.connected || q.state !== PS.ALIVE || !inside(q.x, q.y + 0.3, q.z)) continue;
          if (sim.time - (st.hurtT[q.id] ?? -9) < TRAP_HURT_EVERY) continue;
          st.hurtT[q.id] = sim.time;
          sim.hurtPlayer(q, TRAP_HURT, { x: (a[0] + a[3]) / 2, z: (a[2] + a[5]) / 2 });
        }
        if (st.t <= 0) { Object.assign(st, { state: 'cooldown', t: T.cooldown }); sim.emit(['trap', i, 'cooldown']); }
      } else if (st.t <= 0) {
        st.state = 'ready';
        sim.emit(['trap', i, 'ready']);
      }
    });
  },

  welcome(sim, out) {
    out.power = sim.power;
    out.forge = { state: sim.forge.state, owner: sim.forge.owner, weapon: sim.forge.weapon };
    out.tele = { used: sim.tele.used, pads: sim.tele.pads.map((st) => (st.linked ? 'linked' : st.waiting > 0 ? 'lever' : st.cool > 0 ? 'cooldown' : 'ready')) };
    out.traps = sim.traps.map((t) => t.state);
    out.perkUses = { ...sim.perkUses };
  },
};
