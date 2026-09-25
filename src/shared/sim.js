// Authoritative game simulation. Runtime-agnostic: runs in the browser for
// solo play, inside a Cloudflare Durable Object, and in the Node fallback.
//
// Clients own their own movement and claim hits; the sim owns zombies,
// health, points, purchases, rounds and everything that others must agree on.

import {
  WINDOWS, MAX_BOARDS, DOORS, WALL_BUYS, MYSTERY_BOX, SPAWNS, PLAYER_SPAWNS,
  IX0, IX1, IZ0, IZ1, LOFT_Y, stairHeightAt, RADIO,
} from './map.js';
import { World, zombieHitTest } from './world.js';
import { NavGrid } from './nav.js';
import {
  WEAPONS, BOX_POOL, BOX_COST, WALL_PRICES, START_WEAPON, KNIFE, GRENADE, MAX_PRIMARIES,
} from './weapons.js';
import { ZS, PS, POWERUPS } from './protocol.js';

export const TICK = 1 / 20;
const MAX_ALIVE = 24;
const START_POINTS = 500;
const BOX_ROLL = 4.2, BOX_OFFER = 12;
const BLEED_OUT = 30, REVIVE_TIME = 3;
const POWERUP_LIFE = 26;

export function roundHealth(r) {
  if (r < 10) return 150 + (r - 1) * 100;
  return Math.round(950 * Math.pow(1.1, r - 9));
}

export function roundCount(r, players) {
  const table = [6, 8, 13, 18, 24, 27, 28, 28, 29, 33];
  const solo = r <= 10 ? table[r - 1] : 33 + (r - 10) * 4;
  return Math.round(solo * (1 + 0.5 * (Math.max(1, players) - 1)));
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v) => Math.round(v * 100);

export class GameSim {
  constructor({ seed = Date.now() & 0xffffffff, solo = false } = {}) {
    this.rng = mulberry(seed);
    this.solo = solo;
    this.world = new World();
    this.nav = new NavGrid();
    this.time = 0;
    this.tick = 0;
    this.events = [];
    this.players = new Map();
    this.zombies = new Map();
    this.nextZid = 1;
    this.windows = WINDOWS.map((w) => ({ id: w.id, boards: MAX_BOARDS, occupant: 0, queue: [] }));
    this.openDoors = new Set();
    this.zones = new Set(['start']);
    this.round = 0;
    this.phase = 'pre';
    this.phaseT = 5;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.killsThisRound = 0;
    this.dropsThisRound = 0;
    this.powerups = [];
    this.nextPu = 1;
    this.insta = 0;
    this.double = 0;
    this.box = { state: 'idle', weapon: null, owner: null, t: 0 };
    this.grenades = [];
    this.projectiles = [];
    this.nextProj = 1;
    this.navT = 0;
    this.radioT = 0;
    this.stats = { zombies: 0 };
  }

  // --- Players ---------------------------------------------------------------
  addPlayer(id, name, slot) {
    let p = this.players.get(id);
    if (p) { p.connected = true; p.name = name || p.name; return p; }
    const used = new Set([...this.players.values()].map((q) => q.slot));
    if (slot == null || used.has(slot)) { slot = 0; while (used.has(slot)) slot++; }
    const sp = PLAYER_SPAWNS[slot % PLAYER_SPAWNS.length];
    p = {
      id, name: String(name || 'Survivor').slice(0, 16), slot, connected: true,
      x: sp[0], y: sp[1], z: sp[2], yaw: sp[3], pitch: 0, flags: 0,
      hp: 100, hurtT: 0, state: PS.ALIVE, bleed: 0, revive: 0, reviver: null,
      points: START_POINTS, kills: 0, headshots: 0, downs: 0, revives: 0,
      weapons: [START_WEAPON], cur: START_WEAPON, grenades: GRENADE.start,
      tokens: 3, lastFire: 0, knifeT: 0, boardPts: 0, repairT: 0, useHeld: false,
      lastIn: this.time,
    };
    this.players.set(id, p);
    this.emit(['join', id, p.name, slot]);
    return p;
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    this.emit(['leave', id]);
  }

  removePlayer(id) {
    this.players.delete(id);
    this.emit(['leave', id]);
  }

  activePlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // --- Input ------------------------------------------------------------------
  handle(id, m) {
    const p = this.players.get(id);
    if (!p || !m || typeof m.t !== 'string') return;
    if (this.phase === 'over' && m.t !== 'chat') return;
    switch (m.t) {
      case 'in': return this.onInput(p, m);
      case 'fire': return this.onFire(p, m);
      case 'proj': return this.onProjectile(p, m);
      case 'knife': return this.onKnife(p, m);
      case 'nade': return this.onGrenade(p, m);
      case 'buy': return this.onBuy(p, m);
      case 'switch':
        if (p.weapons.includes(m.w) || (m.w === START_WEAPON && p.state === PS.DOWN)) p.cur = m.w;
        return;
      case 'radio': return this.onRadio(p);
      case 'chat':
        if (typeof m.m === 'string' && m.m.trim()) this.emit(['chat', p.id, m.m.trim().slice(0, 120)]);
        return;
      default:
    }
  }

  onInput(p, m) {
    if (p.state === PS.DEAD) return;
    const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    // Coarse sanity clamp: the client owns movement but cannot teleport.
    const x = n(m.x, p.x), y = n(m.y, p.y), z = n(m.z, p.z);
    const dt = Math.max(0.05, this.time - p.lastIn);
    const maxD = 9 * dt + 0.6;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= maxD || p.state !== PS.ALIVE) {
      if (p.state === PS.ALIVE || p.state === PS.DOWN) {
        p.x = Math.max(IX0 - 0.5, Math.min(IX1 + 0.5, x));
        p.z = Math.max(IZ0 - 0.5, Math.min(IZ1 + 0.5, z));
        p.y = Math.max(-0.5, Math.min(LOFT_Y + 3, y));
      }
    } else {
      p.x += ((x - p.x) / d) * maxD;
      p.z += ((z - p.z) / d) * maxD;
    }
    p.yaw = n(m.yaw, p.yaw);
    p.pitch = n(m.pitch, p.pitch);
    p.flags = m.f | 0;
    p.useHeld = !!(p.flags & 1);
    p.lastIn = this.time;
  }

  canUseWeapon(p, w) {
    if (!WEAPONS[w]) return false;
    if (p.state === PS.DOWN) return w === START_WEAPON;
    return p.state === PS.ALIVE && p.weapons.includes(w);
  }

  takeToken(p, w) {
    const iv = 60 / WEAPONS[w].rpm;
    p.tokens = Math.min(3, p.tokens + (this.time - p.lastFire) / iv);
    p.lastFire = this.time;
    if (p.tokens < 0.999) return false;
    p.tokens -= 1;
    return true;
  }

  onFire(p, m) {
    const w = m.w;
    if (!this.canUseWeapon(p, w) || !this.takeToken(p, w)) return;
    const W = WEAPONS[w];
    const o = vec3(m.o), d = vec3(m.d);
    if (o && d) this.emit(['shot', p.id, w, r2(o[0]), r2(o[1]), r2(o[2]), Math.round(d[0] * 1000), Math.round(d[1] * 1000), Math.round(d[2] * 1000)]);
    if (!Array.isArray(m.h)) return;
    const maxHits = W.pellets * (1 + (W.penetrate || 0));
    const hits = m.h.slice(0, maxHits);
    for (const h of hits) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      if (!z || z.hp <= 0) continue;
      const part = Math.max(0, Math.min(2, h[1] | 0));
      const dist = Math.hypot(z.x - p.x, z.y - p.y, z.z - p.z);
      if (dist > W.range + 4) continue;
      let dmg = W.damage * (part === 0 ? W.headMult : part === 2 ? 0.8 : 1);
      if (W.pellets > 1) dmg *= Math.max(0.3, Math.min(1, 1.25 - dist / W.range));
      this.damageZombie(z, dmg, p, part === 0 ? 'head' : 'body', d);
    }
  }

  onProjectile(p, m) {
    const w = m.w;
    const W = WEAPONS[w];
    if (!W || !W.projectile || !this.canUseWeapon(p, w) || !this.takeToken(p, w)) return;
    const o = vec3(m.o), d = vec3(m.d);
    if (!o || !d) return;
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    // Clamp the origin near the player's reported eye.
    if (Math.hypot(o[0] - p.x, o[2] - p.z) > 2) { o[0] = p.x; o[1] = p.y + 1.5; o[2] = p.z; }
    const s = W.projectile.speed;
    const pr = {
      id: this.nextProj++, w, owner: p.id, x: o[0], y: o[1], z: o[2],
      vx: (d[0] / len) * s, vy: (d[1] / len) * s, vz: (d[2] / len) * s, t: 0,
    };
    this.projectiles.push(pr);
    this.emit(['proj', pr.id, p.id, w, r2(pr.x), r2(pr.y), r2(pr.z), r2(pr.vx), r2(pr.vy), r2(pr.vz)]);
  }

  onKnife(p, m) {
    if (p.state !== PS.ALIVE || this.time - p.knifeT < KNIFE.cooldown * 0.8) return;
    p.knifeT = this.time;
    this.emit(['knife', p.id]);
    const z = this.zombies.get(m.z | 0);
    if (!z || z.hp <= 0) return;
    if (Math.hypot(z.x - p.x, z.z - p.z) > KNIFE.range + 1.2 || Math.abs(z.y - p.y) > 1.6) return;
    this.damageZombie(z, KNIFE.damage, p, 'knife', [z.x - p.x, 0, z.z - p.z]);
  }

  onGrenade(p, m) {
    if (p.state !== PS.ALIVE || p.grenades <= 0) return;
    const o = vec3(m.o), v = vec3(m.v);
    if (!o || !v) return;
    const sp = Math.hypot(v[0], v[1], v[2]);
    if (sp > 22) { v[0] *= 22 / sp; v[1] *= 22 / sp; v[2] *= 22 / sp; }
    p.grenades--;
    const g = { id: this.nextProj++, owner: p.id, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], t: 0 };
    this.grenades.push(g);
    this.emit(['nade', g.id, p.id, r2(g.x), r2(g.y), r2(g.z), r2(g.vx), r2(g.vy), r2(g.vz), p.grenades]);
  }

  onRadio(p) {
    if (this.time < this.radioT) return;
    if (Math.hypot(p.x - RADIO.pos[0], p.z - RADIO.pos[2]) > 2.4 || p.y > 1.5) return;
    this.radioT = this.time + 20;
    this.emit(['radio']);
  }

  // --- Purchases --------------------------------------------------------------
  spend(p, cost) {
    if (p.points < cost) { this.emit(['deny', p.id]); return false; }
    p.points -= cost;
    this.emit(['pts', p.id, -cost, p.points, 0]);
    return true;
  }

  giveWeapon(p, w) {
    if (p.weapons.includes(w)) { p.cur = w; return; }
    if (p.weapons.length >= MAX_PRIMARIES) {
      const i = Math.max(0, p.weapons.indexOf(p.cur));
      p.weapons[i] = w;
    } else {
      p.weapons.push(w);
    }
    p.cur = w;
  }

  onBuy(p, m) {
    if (p.state !== PS.ALIVE) return;
    const near = (pos, r) => Math.hypot(p.x - pos[0], p.z - pos[2]) <= r && Math.abs(p.y - pos[1]) < 1.6;
    if (m.k === 'wall') {
      const wb = WALL_BUYS.find((b) => b.id === m.id);
      if (!wb || !this.zones.has(wb.zone) || !near([wb.pos[0], wb.pos[1] - 1.55, wb.pos[2]], 2.0)) return;
      const price = WALL_PRICES[wb.weapon];
      if (p.weapons.includes(wb.weapon)) {
        if (!this.spend(p, Math.round(price / 2))) return;
        this.emit(['ammo', p.id, wb.weapon]);
      } else {
        if (!this.spend(p, price)) return;
        this.giveWeapon(p, wb.weapon);
        this.emit(['give', p.id, wb.weapon, p.weapons.join(',')]);
      }
    } else if (m.k === 'door') {
      const d = DOORS.find((q) => q.id === m.id);
      if (!d || this.openDoors.has(d.id) || !d.use.some((u) => near(u, 2.4))) return;
      if (!this.spend(p, d.cost)) return;
      this.openDoor(d.id);
    } else if (m.k === 'box') {
      if (this.box.state !== 'idle' || !this.zones.has(MYSTERY_BOX.zone) || !near(MYSTERY_BOX.pos, 2.2)) return;
      if (!this.spend(p, BOX_COST)) return;
      const pool = Object.entries(BOX_POOL).filter(([w]) => !p.weapons.includes(w));
      let total = pool.reduce((s, [, n]) => s + n, 0);
      let roll = this.rng() * total, pick = pool[0][0];
      for (const [w, n] of pool) { roll -= n; if (roll <= 0) { pick = w; break; } }
      this.box = { state: 'rolling', weapon: pick, owner: p.id, t: BOX_ROLL };
      this.emit(['box', 'open', p.id, pick]);
    } else if (m.k === 'boxTake') {
      if (this.box.state !== 'ready' || this.box.owner !== p.id || !near(MYSTERY_BOX.pos, 2.4)) return;
      this.giveWeapon(p, this.box.weapon);
      this.emit(['give', p.id, this.box.weapon, p.weapons.join(',')]);
      this.box = { state: 'idle', weapon: null, owner: null, t: 0 };
      this.emit(['box', 'close']);
    }
  }

  openDoor(id) {
    const d = DOORS.find((q) => q.id === id);
    if (!d || this.openDoors.has(id)) return;
    this.openDoors.add(id);
    this.world.setDoorOpen(id);
    this.nav.setDoorOpen(id);
    for (const z of d.opens) this.zones.add(z);
    this.emit(['door', id]);
  }

  // --- Damage & points -----------------------------------------------------------
  addPoints(p, n, reason = 0) {
    if (!p) return;
    const v = this.double > 0 ? n * 2 : n;
    p.points += v;
    this.emit(['pts', p.id, v, p.points, reason]);
  }

  damageZombie(z, dmg, p, kind, dir) {
    if (z.hp <= 0) return;
    if (this.insta > 0) dmg = z.hp + 1;
    z.hp -= dmg;
    if (z.hp > 0) {
      this.addPoints(p, 10);
      this.emit(['zhit', z.id, kind === 'head' ? 0 : 1]);
      return;
    }
    const pts = kind === 'head' ? 100 : kind === 'knife' ? 130 : 50;
    this.addPoints(p, pts);
    if (p) { p.kills++; if (kind === 'head') p.headshots++; }
    this.killZombie(z, p ? p.id : null, kind, dir);
  }

  killZombie(z, by, kind, dir) {
    z.hp = 0;
    this.zombies.delete(z.id);
    this.releaseWindow(z);
    this.killsThisRound++;
    this.stats.zombies++;
    const dx = dir ? dir[0] : 0, dz = dir ? dir[2] : 0;
    this.emit(['kill', z.id, by, kind === 'head' ? 1 : kind === 'explode' ? 2 : kind === 'nuke' ? 3 : 0, r2(z.x), r2(z.y), r2(z.z), Math.round(Math.atan2(dx, dz) * 100)]);
    if (kind !== 'nuke') this.maybeDrop(z);
  }

  maybeDrop(z) {
    if (this.dropsThisRound >= 4) return;
    if (z.x < IX0 + 0.3 || z.x > IX1 - 0.3 || z.z < IZ0 + 0.3 || z.z > IZ1 - 0.3) return;
    if (this.rng() > 0.03 + Math.min(0.03, this.killsThisRound * 0.0015)) return;
    const missing = this.windows.some((w) => w.boards < MAX_BOARDS);
    const types = POWERUPS.filter((t) => t !== 'carpenter' || missing);
    const type = types[Math.floor(this.rng() * types.length)];
    const pu = { id: this.nextPu++, type, x: z.x, y: z.y, z: z.z, t: POWERUP_LIFE };
    this.powerups.push(pu);
    this.dropsThisRound++;
    this.emit(['pu', pu.id, type, r2(pu.x), r2(pu.y), r2(pu.z)]);
  }

  applyPowerup(pu, p) {
    this.emit(['pug', pu.id, pu.type, p.id]);
    switch (pu.type) {
      case 'maxammo':
        for (const q of this.players.values()) q.grenades = GRENADE.max;
        break;
      case 'instakill': this.insta = 30; break;
      case 'doublepoints': this.double = 30; break;
      case 'nuke': {
        for (const z of [...this.zombies.values()]) this.killZombie(z, null, 'nuke', null);
        for (const q of this.activePlayers()) if (q.state !== PS.DEAD) this.addPoints(q, 400, 2);
        break;
      }
      case 'carpenter': {
        for (const w of this.windows) {
          if (w.boards < MAX_BOARDS) { w.boards = MAX_BOARDS; this.emit(['board', w.id, w.boards, 1]); }
        }
        for (const q of this.activePlayers()) if (q.state !== PS.DEAD) this.addPoints(q, 200, 2);
        break;
      }
      default:
    }
  }

  hurtPlayer(p, dmg, z) {
    if (p.state !== PS.ALIVE) return;
    p.hp -= dmg;
    p.hurtT = this.time;
    this.emit(['hurt', p.id, Math.max(0, p.hp), r2(z.x), r2(z.z)]);
    if (p.hp > 0) return;
    p.hp = 0;
    p.downs++;
    const others = this.activePlayers().filter((q) => q !== p && q.state === PS.ALIVE);
    if (others.length === 0) {
      p.state = PS.DOWN;
      this.emit(['down', p.id]);
      this.gameOver();
      return;
    }
    p.state = PS.DOWN;
    p.bleed = BLEED_OUT;
    p.revive = 0;
    this.emit(['down', p.id]);
  }

  gameOver() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.phaseT = 12;
    const stats = [...this.players.values()].map((p) => [p.id, p.name, p.slot, p.points, p.kills, p.headshots, p.downs, p.revives]);
    this.emit(['over', this.round, stats]);
  }

  // --- Windows ----------------------------------------------------------------
  releaseWindow(z) {
    if (z.win == null) return;
    const w = this.windows[z.win];
    if (w.occupant === z.id) w.occupant = 0;
    const i = w.queue.indexOf(z.id);
    if (i >= 0) w.queue.splice(i, 1);
  }

  // --- Spawning ---------------------------------------------------------------------
  startRound() {
    this.round++;
    this.phase = 'round';
    this.toSpawn = roundCount(this.round, this.activePlayers().length);
    this.spawnT = 1.5;
    this.killsThisRound = 0;
    this.dropsThisRound = 0;
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      if (p.state === PS.DEAD) {
        const sp = PLAYER_SPAWNS[p.slot % PLAYER_SPAWNS.length];
        Object.assign(p, { state: PS.ALIVE, hp: 100, x: sp[0], y: sp[1], z: sp[2], weapons: [START_WEAPON], cur: START_WEAPON, grenades: GRENADE.start });
        this.emit(['respawn', p.id, r2(sp[0]), r2(sp[1]), r2(sp[2])]);
      } else if (this.round > 1) {
        p.grenades = Math.min(GRENADE.max, p.grenades + GRENADE.perRound);
      }
      p.boardPts = 0;
    }
    this.emit(['round', this.round, this.toSpawn]);
  }

  pickSpawn() {
    const targets = this.activePlayers().filter((p) => p.state === PS.ALIVE);
    const options = SPAWNS.filter((s) => this.zones.has(s.zone));
    let total = 0;
    const weights = options.map((s) => {
      const w = WINDOWS[s.window];
      let best = Infinity;
      for (const p of targets) best = Math.min(best, Math.hypot(w.x - p.x, w.z - p.z) + Math.abs(w.base - p.y) * 3);
      const q = this.windows[s.window].queue.length;
      const wt = (1 / (1 + best * 0.25)) / (1 + q * 0.8);
      total += wt;
      return wt;
    });
    let r = this.rng() * total;
    for (let i = 0; i < options.length; i++) { r -= weights[i]; if (r <= 0) return options[i]; }
    return options[options.length - 1];
  }

  spawnZombie() {
    const s = this.pickSpawn();
    if (!s) return;
    const r = this.round;
    const run = Math.min(0.95, Math.max(0, (r - 4) * 0.2));
    const jog = Math.min(1, Math.max(0, (r - 2) * 0.3));
    const roll = this.rng();
    const cls = roll < run ? 2 : roll < run + (1 - run) * jog ? 1 : 0;
    const speed = cls === 2 ? 3.9 + this.rng() * 0.5 : cls === 1 ? 2.2 + this.rng() * 0.4 : 1.0 + this.rng() * 0.35;
    const hp = roundHealth(r);
    const jitter = () => (this.rng() - 0.5) * 1.2;
    const z = {
      id: this.nextZid++, cls, speed, hp, maxHp: hp,
      x: s.pos[0] + jitter(), y: s.pos[1], z: s.pos[2] + jitter(), yaw: 0,
      state: ZS.RISE, t: s.ladder ? 1.2 : 1.7, win: s.window, lv: WINDOWS[s.window].level,
      atk: 0, atkTarget: null, tear: 0, cell: -1, stuck: 0, ladder: !!s.ladder,
    };
    const w = WINDOWS[s.window];
    z.yaw = Math.atan2(w.outside[0] - z.x, w.outside[2] - z.z);
    this.zombies.set(z.id, z);
    this.windows[s.window].queue.push(z.id);
    this.emit(['zspawn', z.id, cls, s.ladder ? 1 : 0]);
  }

  // --- Main step -------------------------------------------------------------------------
  step(dt = TICK) {
    this.time += dt;
    this.tick++;
    if (this.insta > 0) this.insta = Math.max(0, this.insta - dt);
    if (this.double > 0) this.double = Math.max(0, this.double - dt);

    const active = this.activePlayers();
    if (active.length === 0) return;

    if (this.phase === 'over') {
      this.phaseT -= dt;
      return;
    }

    this.stepPhase(dt);
    this.stepPlayers(dt);
    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.25;
      const targets = active.filter((p) => p.state === PS.ALIVE).map((p) => [p.x, p.y, p.z]);
      this.nav.computeFlow(targets);
    }
    this.stepZombies(dt);
    this.stepGrenades(dt);
    this.stepProjectiles(dt);
    this.stepPowerups(dt);
    this.stepBox(dt);
  }

  stepPhase(dt) {
    if (this.phase === 'pre' || this.phase === 'break') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startRound();
      return;
    }
    if (this.phase === 'round') {
      if (this.toSpawn > 0) {
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.zombies.size < MAX_ALIVE) {
          this.spawnZombie();
          this.toSpawn--;
          this.spawnT = Math.max(0.3, 2.2 * Math.pow(0.93, this.round - 1)) * (0.6 + this.rng() * 0.8);
        }
      } else if (this.zombies.size === 0) {
        this.phase = 'break';
        this.phaseT = 10;
        this.emit(['rend', this.round]);
      }
    }
  }

  stepPlayers(dt) {
    const alive = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      if (p.state === PS.ALIVE) {
        alive.push(p);
        if (p.hp < 100 && this.time - p.hurtT > 2.6) p.hp = Math.min(100, p.hp + 55 * dt);
      }
    }
    for (const p of this.players.values()) {
      if (!p.connected || p.state !== PS.DOWN) continue;
      // Revive: an alive teammate holding use nearby.
      const helper = alive.find((q) => q.useHeld && Math.hypot(q.x - p.x, q.z - p.z) < 1.8 && Math.abs(q.y - p.y) < 1.2);
      if (helper) {
        if (p.reviver !== helper.id) { p.reviver = helper.id; p.revive = 0; }
        p.revive += dt;
        if (p.revive >= REVIVE_TIME) {
          p.state = PS.ALIVE; p.hp = 100; p.revive = 0; p.reviver = null;
          helper.revives++;
          this.emit(['revived', p.id, helper.id]);
          continue;
        }
      } else {
        p.revive = 0; p.reviver = null;
        p.bleed -= dt;
        if (p.bleed <= 0) {
          p.state = PS.DEAD;
          p.weapons = [START_WEAPON]; p.cur = START_WEAPON;
          this.emit(['bled', p.id]);
        }
      }
    }
    if (alive.length === 0 && this.phase !== 'over' && [...this.players.values()].some((p) => p.connected)) {
      this.gameOver();
      return;
    }
    // Board repair: hold use near a damaged window.
    for (const p of alive) {
      if (!p.useHeld) { p.repairT = 0; continue; }
      const w = WINDOWS.find((q) => Math.hypot(q.repair[0] - p.x, q.repair[2] - p.z) < 1.3 && Math.abs(q.base - p.y) < 1);
      if (!w) { p.repairT = 0; continue; }
      const ws = this.windows[w.id];
      if (ws.boards >= MAX_BOARDS) continue;
      const occ = this.zombies.get(ws.occupant);
      if (occ && occ.state === ZS.CLIMB) continue;
      p.repairT += dt;
      if (p.repairT >= 0.85) {
        p.repairT = 0;
        ws.boards++;
        this.emit(['board', w.id, ws.boards, 1]);
        if (p.boardPts < 500) { p.boardPts += 10; this.addPoints(p, 10, 1); }
      }
    }
  }

  nearestAlive(x, y, z) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (!p.connected || p.state !== PS.ALIVE) continue;
      const d = Math.hypot(p.x - x, p.z - z) + Math.abs(p.y - y) * 2;
      if (d < bd) { bd = d; best = p; }
    }
    return [best, bd];
  }

  stepZombies(dt) {
    const list = [...this.zombies.values()];
    for (const z of list) {
      z.t -= dt;
      switch (z.state) {
        case ZS.RISE:
          if (z.t <= 0) z.state = ZS.WINDOW_WALK;
          break;
        case ZS.WINDOW_WALK: this.zWindowWalk(z, dt); break;
        case ZS.TEAR: this.zTear(z, dt); break;
        case ZS.CLIMB: this.zClimb(z, dt); break;
        case ZS.CHASE: this.zChase(z, dt); break;
        case ZS.ATTACK: this.zAttack(z, dt); break;
        default:
      }
    }
    // Separation: inside chasers push each other, outside walkers likewise.
    const grp = (s) => (s === ZS.CHASE || s === ZS.ATTACK ? 1 : s === ZS.WINDOW_WALK ? 2 : 0);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ga = grp(a.state);
      if (!ga) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (grp(b.state) !== ga) continue;
        if (Math.abs(a.y - b.y) > 1) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.42 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (0.65 - d) * 0.5;
        const ux = dx / d, uz = dz / d;
        this.tryMove(a, -ux * push, -uz * push);
        this.tryMove(b, ux * push, uz * push);
      }
    }
  }

  windowSlot(z) {
    const W = WINDOWS[z.win];
    const ws = this.windows[z.win];
    const k = Math.max(0, ws.queue.indexOf(z.id));
    const [nx, nz] = W.n;
    const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
    const back = k === 0 ? 0 : 0.9 + (k > 2 ? 0.7 : 0);
    return [W.outside[0] + nx * back + -nz * side, W.outside[2] + nz * back + nx * side];
  }

  zWindowWalk(z, dt) {
    const ws = this.windows[z.win];
    const [tx, tz] = this.windowSlot(z);
    const dx = tx - z.x, dz = tz - z.z;
    const d = Math.hypot(dx, dz);
    const sp = z.speed * (z.cls === 2 ? 0.9 : 1);
    if (d > 0.08) {
      const s = Math.min(d, sp * dt);
      z.x += (dx / d) * s; z.z += (dz / d) * s;
      z.yaw = turnToward(z.yaw, Math.atan2(dx, dz), dt * 6);
    }
    if (ws.queue[0] === z.id && d < 0.25) {
      ws.occupant = z.id;
      z.state = ZS.TEAR;
      z.tear = 0.6;
      const W = WINDOWS[z.win];
      z.yaw = Math.atan2(-W.n[0], -W.n[1]);
    }
  }

  zTear(z, dt) {
    const W = WINDOWS[z.win];
    const ws = this.windows[z.win];
    z.yaw = Math.atan2(-W.n[0], -W.n[1]);
    // Swipe through the window at anyone standing right there.
    const [p] = this.nearestAlive(W.x, W.base, W.z);
    if (p && Math.hypot(p.x - W.x, p.z - W.z) < 1.35 && Math.abs(p.y - W.base) < 1) {
      z.atk -= dt;
      if (z.atk <= 0) {
        z.atk = 1.3;
        this.emit(['zatk', z.id]);
        this.hurtPlayer(p, 40, z);
      }
    }
    if (ws.boards > 0) {
      z.tear -= dt;
      if (z.tear <= 0) {
        ws.boards--;
        z.tear = z.cls === 2 ? 0.75 : z.cls === 1 ? 1.0 : 1.35;
        this.emit(['board', W.id, ws.boards, 0]);
      }
      return;
    }
    z.state = ZS.CLIMB;
    z.t = z.cls === 2 ? 0.8 : 1.25;
    z.climb0 = [z.x, z.z];
  }

  zClimb(z, dt) {
    const W = WINDOWS[z.win];
    const dur = z.cls === 2 ? 0.8 : 1.25;
    const u = Math.min(1, 1 - z.t / dur);
    const [x0, z0] = z.climb0;
    z.x = x0 + (W.inside[0] - x0) * u;
    z.z = z0 + (W.inside[2] - z0) * u;
    z.y = W.base + Math.sin(Math.PI * u) * 0.95;
    if (u >= 1) {
      z.y = W.base;
      this.releaseWindow(z);
      z.win = null;
      z.state = ZS.CHASE;
      z.lv = W.level;
      z.cell = -1;
    }
  }

  tryMove(z, dx, dz) {
    if (z.state === ZS.WINDOW_WALK || z.state === ZS.RISE) { z.x += dx; z.z += dz; return true; }
    const nav = this.nav;
    const nx = z.x + dx, nz = z.z + dz;
    const ok = (x, zz) => {
      const i = nav.locateStrict(x, z.y, zz);
      return i >= 0 && Math.abs(nav.height[i] - z.y) < 0.7;
    };
    let moved = true;
    if (ok(nx, nz)) { z.x = nx; z.z = nz; }
    else if (ok(nx, z.z)) z.x = nx;
    else if (ok(z.x, nz)) z.z = nz;
    else moved = false;
    // Keep bodies out of walls and furniture.
    const p = this.world._pushOut(z.x, z.z, z.y + 0.55, z.y + 1.6, 0.26);
    if (p && ok(p[0], p[1])) { z.x = p[0]; z.z = p[1]; }
    return moved;
  }

  zChase(z, dt) {
    const [p, pd] = this.nearestAlive(z.x, z.y, z.z);
    if (!p) return;
    const nav = this.nav;
    const cell = nav.locate(z.x, z.y, z.z);
    let tx = p.x, tz = p.z;
    const direct = pd < 2.2 && Math.abs(p.y - z.y) < 0.8;
    if (!direct && cell >= 0) {
      const n1 = nav.next(cell);
      if (n1 >= 0) {
        const n2 = nav.next(n1);
        const c = nav.center(n2 >= 0 && nav.levelOf(n2) === nav.levelOf(cell) ? n2 : n1);
        tx = c[0]; tz = c[2];
      }
    }
    const dx = tx - z.x, dz = tz - z.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.02) {
      const s = Math.min(d, z.speed * dt);
      if (!this.tryMove(z, (dx / d) * s, (dz / d) * s)) z.stuck += dt; else z.stuck = 0;
      z.yaw = turnToward(z.yaw, Math.atan2(dx, dz), dt * (z.cls === 2 ? 9 : 5));
    }
    // Height follows the floor: stairs are a smooth ramp.
    const sh = stairHeightAt(z.x, z.z);
    const ci = nav.locate(z.x, z.y, z.z);
    if (sh !== null && ci >= 0 && nav.levelOf(ci) === 0) z.y = sh;
    else if (ci >= 0) z.y = nav.height[ci];
    if (z.stuck > 3) { // unstick by nudging to the current cell centre
      const c = ci >= 0 ? nav.center(ci) : null;
      if (c) { z.x = c[0]; z.z = c[2]; z.y = c[1]; }
      z.stuck = 0;
    }
    z.cool = Math.max(0, (z.cool || 0) - dt);
    if (z.cool <= 0 && Math.hypot(p.x - z.x, p.z - z.z) < 1.05 && Math.abs(p.y - z.y) < 1.2) {
      z.state = ZS.ATTACK;
      z.t = z.cls === 2 ? 0.28 : 0.4;
      z.atkTarget = p.id;
      this.emit(['zatk', z.id]);
    }
  }

  zAttack(z, dt) {
    const p = this.players.get(z.atkTarget);
    if (p) z.yaw = turnToward(z.yaw, Math.atan2(p.x - z.x, p.z - z.z), dt * 8);
    if (z.t > 0) return;
    if (p && p.state === PS.ALIVE && Math.hypot(p.x - z.x, p.z - z.z) < 1.45 && Math.abs(p.y - z.y) < 1.3) {
      this.hurtPlayer(p, z.cls === 2 ? 45 : 40, z);
    }
    z.state = ZS.CHASE;
    z.t = 0;
    z.stuck = 0;
    z.cool = z.cls === 2 ? 0.65 : 0.95;
  }

  stepGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t += dt;
      stepBody(this.world, g, dt);
      if (g.t >= GRENADE.fuse) {
        this.grenades.splice(i, 1);
        this.explode(g.x, g.y + 0.2, g.z, GRENADE.radius, GRENADE.damage, this.players.get(g.owner), 'nade', g.id);
      }
    }
  }

  stepProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const W = WEAPONS[pr.w];
      pr.t += dt;
      pr.vy -= W.projectile.gravity * dt;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
      const step = sp * dt;
      const dx = pr.vx / sp, dy = pr.vy / sp, dz = pr.vz / sp;
      let hitT = this.world.raycast(pr.x, pr.y, pr.z, dx, dy, dz, step);
      for (const z of this.zombies.values()) {
        if (z.state === ZS.RISE && z.t > 0.8) continue;
        const h = zombieHitTest(pr.x, pr.y, pr.z, dx, dy, dz, z.x, z.y, z.z, hitT);
        if (h) hitT = h.t;
      }
      if (hitT < step || pr.t > 4) {
        const t = Math.min(hitT, step);
        this.projectiles.splice(i, 1);
        this.explode(pr.x + dx * t, pr.y + dy * t, pr.z + dz * t, W.projectile.radius, W.damage, this.players.get(pr.owner), pr.w, pr.id);
        continue;
      }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
    }
  }

  explode(x, y, z, radius, damage, owner, kind, projId = 0) {
    this.emit(['boom', r2(x), r2(y), r2(z), kind, projId]);
    for (const zb of [...this.zombies.values()]) {
      const d = Math.hypot(zb.x - x, zb.y + 0.9 - y, zb.z - z);
      if (d > radius) continue;
      if (!this.world.lineOfSight(x, y, z, zb.x, zb.y + 1.0, zb.z) && d > 1.2) continue;
      const dmg = damage * (1 - (d / radius) * 0.6);
      if (zb.hp - (this.insta > 0 ? Infinity : dmg) <= 0) {
        this.addPoints(owner, 50);
        if (owner) owner.kills++;
        this.killZombie(zb, owner ? owner.id : null, 'explode', [zb.x - x, 0, zb.z - z]);
      } else {
        zb.hp -= dmg;
        this.addPoints(owner, 10);
      }
    }
  }

  stepPowerups(dt) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      pu.t -= dt;
      if (pu.t <= 0) { this.powerups.splice(i, 1); this.emit(['pux', pu.id]); continue; }
      for (const p of this.players.values()) {
        if (!p.connected || p.state !== PS.ALIVE) continue;
        if (Math.hypot(p.x - pu.x, p.z - pu.z) < 1.15 && Math.abs(p.y - pu.y) < 1.6) {
          this.powerups.splice(i, 1);
          this.applyPowerup(pu, p);
          break;
        }
      }
    }
  }

  stepBox(dt) {
    const b = this.box;
    if (b.state === 'idle') return;
    b.t -= dt;
    if (b.state === 'rolling' && b.t <= 0) {
      b.state = 'ready'; b.t = BOX_OFFER;
      this.emit(['box', 'ready', b.owner, b.weapon]);
    } else if (b.state === 'ready' && b.t <= 0) {
      this.box = { state: 'idle', weapon: null, owner: null, t: 0 };
      this.emit(['box', 'close']);
    }
  }

  // --- Output -----------------------------------------------------------------------------
  emit(e) { this.events.push(e); }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // Compact per-tick state. Positions are centimetres, angles milliradians.
  snapshot() {
    const z = [];
    for (const q of this.zombies.values()) {
      const lift = q.state === ZS.RISE ? -Math.max(0, q.t) / (q.ladder ? 1.2 : 1.7) : 0;
      z.push([q.id, r2(q.x), r2(q.y + lift * 1.7), r2(q.z), Math.round(q.yaw * 1000), q.state, q.cls]);
    }
    const p = [];
    for (const q of this.players.values()) {
      if (!q.connected) continue;
      p.push([q.id, r2(q.x), r2(q.y), r2(q.z), Math.round(q.yaw * 1000), Math.round(q.pitch * 1000),
        Math.round(q.hp), q.state, q.cur, q.points, q.flags, Math.round((q.revive / REVIVE_TIME) * 100), Math.round(q.bleed),
        q.kills, q.headshots, q.downs, q.revives, q.slot, q.grenades]);
    }
    return {
      t: 's', k: this.tick, r: this.round, ph: this.phase, pt: Math.max(0, Math.round(this.phaseT * 10) / 10),
      ik: Math.ceil(this.insta), dp: Math.ceil(this.double), z, p,
    };
  }

  // Full state for a joining client: doors, boards, box, power-ups, owned weapons.
  welcome(id) {
    const p = this.players.get(id);
    return {
      t: 'welcome', id, round: this.round, phase: this.phase,
      doors: [...this.openDoors],
      boards: this.windows.map((w) => w.boards),
      box: { state: this.box.state, weapon: this.box.weapon, owner: this.box.owner },
      powerups: this.powerups.map((u) => [u.id, u.type, r2(u.x), r2(u.y), r2(u.z)]),
      players: [...this.players.values()].map((q) => [q.id, q.name, q.slot]),
      me: p && { x: p.x, y: p.y, z: p.z, yaw: p.yaw, weapons: p.weapons, cur: p.cur, points: p.points, grenades: p.grenades, state: p.state, hp: p.hp },
    };
  }
}

// Shared grenade physics so clients can predict the arc identically.
export function stepBody(world, g, dt) {
  const n = [0, 0, 0];
  g.vy -= 14 * dt;
  const sp = Math.hypot(g.vx, g.vy, g.vz);
  if (sp < 1e-4) return;
  const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp;
  const dist = sp * dt;
  const t = world.raycast(g.x, g.y, g.z, dx, dy, dz, dist + 0.08, n);
  if (t < dist + 0.08) {
    const tt = Math.max(0, t - 0.08);
    g.x += dx * tt; g.y += dy * tt; g.z += dz * tt;
    const dot = g.vx * n[0] + g.vy * n[1] + g.vz * n[2];
    g.vx = (g.vx - 2 * dot * n[0]) * 0.45;
    g.vy = (g.vy - 2 * dot * n[1]) * 0.45;
    g.vz = (g.vz - 2 * dot * n[2]) * 0.45;
    g.bounced = true;
    if (n[1] > 0.5 && Math.abs(g.vy) < 1.2) { g.vy = 0; g.vx *= 0.8; g.vz *= 0.8; }
  } else {
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
  }
  if (g.y < 0.06) { g.y = 0.06; if (g.vy < 0) g.vy = -g.vy * 0.3; g.vx *= 0.85; g.vz *= 0.85; }
}

function vec3(a) {
  if (!Array.isArray(a) || a.length !== 3) return null;
  const v = a.map(Number);
  return v.every(Number.isFinite) ? v : null;
}

function turnToward(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
