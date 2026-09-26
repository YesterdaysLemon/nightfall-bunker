// The client game: owns rendering systems, the local player, weapons,
// interaction and the network message handling.

import * as THREE from 'three';
import { World, enemyHitTest } from '../shared/world.js';
import {
  WINDOWS, DOORS, WALL_BUYS, MYSTERY_BOX, RADIO, LOFT_Y, MAX_BOARDS, PLAYER_SPAWNS, EGG,
} from '../shared/map.js';
import { WEAPONS, WALL_PRICES, BOX_COST, BOX_POOL, START_WEAPON, KNIFE, GRENADE } from '../shared/weapons.js';
import { PS, ZS, ZC, IN, PROTOCOL, PLAYER_COLORS, REGIONS } from '../shared/protocol.js';
import { EggProps } from './render/egg.js';
import { buildTeacup } from './render/kintsugi.js';
import { SceneRig } from './render/scene.js';
import { createTextures } from './render/textures.js';
import { Level } from './render/level.js';
import { Exterior } from './render/exterior.js';
import { Zombies } from './render/zombies.js';
import { Avatars } from './render/avatars.js';
import { FX } from './render/fx.js';
import { ViewModel } from './render/viewmodel.js';
import { HUD, escapeHtml } from './hud.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';

const EYE = 1.62, CROUCH_EYE = 1.08, DOWN_EYE = 0.55;
const WALK = 4.2, SPRINT = 6.3;
const INPUT_RATE = 1 / 20;
const POWERUP_NAMES = { maxammo: 'Max Ammo', instakill: 'Insta-Kill', doublepoints: 'Double Points', nuke: 'Kaboom', carpenter: 'Carpenter', goldleaf: 'Gold Leaf' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3();

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.rig = new SceneRig(canvas, settings.quality);
    this.tex = createTextures(this.rig.renderer);
    this.muted = !!settings.muted;
    this.audio = new AudioEngine({ masterVolume: this.muted ? 0 : settings.volume, hrtf: settings.hrtf !== false });
    this.audio.occlusion = (x, y, z) => this.occlusionAt(x, y, z);
    this.level = new Level(this.rig, this.tex);
    this.exterior = new Exterior(this.rig, this.level.mats, this.tex);
    this.world = new World();
    this.fx = new FX(this.rig, this.tex, this.world, this.audio);
    this.zombies = new Zombies(this.rig, this.tex, this.audio, this.fx);
    this.zombies.onSpawn = (z) => this.onZombieSpawn(z);
    this.egg = new EggProps(this.rig, this.tex);
    this.fx.goldModel = () => { const g = buildTeacup(); g.scale.setScalar(3.4); g.position.y = -0.15; return g; };
    this.avatars = new Avatars(this.rig.scene, this.tex);
    this.vm = new ViewModel(this.rig.renderer, this.rig.scene);
    this.hud = new HUD();
    this.input = new Input(canvas);
    this.clock = new THREE.Clock();
    this.mode = 'menu';
    this.conn = null;
    this.onEvent = () => {};
    this.time = 0;
    this.resetState();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.warmup();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // Compile shaders once up front so the first zombie (or hound, or her) doesn't stutter.
  warmup() {
    const r = this.rig.renderer;
    this.rig.camera.position.set(0, 1.6, 0);
    const fake = (cls, state) => ({ id: -1, seed: 1, cls, x: 0, y: 0, z: -3, yaw: 0, speed: 0, phase: 0, state, stateT: 0.5, killed: false, deadT: 0, stage: 0, hpFrac: 1 });
    const Z = this.zombies;
    Z.hounds.begin(); Z.hounds.draw(fake(ZC.HOUND, ZS.CHASE), 0.016, 0); Z.hounds.end();
    Z.boss.draw(fake(ZC.KINTSUGI, ZS.CHASE), 0.016, 0);
    r.compile(this.rig.scene, this.rig.camera);
    Z.hounds.begin(); Z.hounds.end();
    Z.boss.hide();
    for (const id of Object.keys(WEAPONS)) this.vm.model(id);
    r.compile(this.vm.scene, this.vm.camera);
  }

  resetState() {
    this.me = null;
    this.players = new Map();  // id -> {name, slot, points, state, row}
    const sp = PLAYER_SPAWNS[0];
    this.p = {
      x: sp[0], y: 0, z: sp[2], vx: 0, vy: 0, vz: 0, onGround: true, height: 1.75,
      yaw: sp[3], pitch: 0, eye: EYE, eyeSmooth: 0, crouch: 0,
      hp: 100, state: PS.ALIVE, points: 500, grenades: GRENADE.start,
      weapons: [START_WEAPON], cur: START_WEAPON, ammo: {},
      fireT: 0, reloadT: 0, reloadDur: 0, reloadEvents: [], switchT: 0, knifeT: 0, nadeT: 0, nadePending: 0,
      bloom: 0, stamina: 3, sprinting: false, lastStep: 0, recoilPitch: 0,
    };
    this.giveAmmo(START_WEAPON);
    this.round = 0;
    this.phase = 'pre';
    this.boxState = { state: 'idle', owner: null, weapon: null };
    this.openDoors = new Set();
    this.boards = WINDOWS.map(() => MAX_BOARDS);
    this.inputT = 0;
    this.lastSnapK = 0;
    this.clockOffset = null;
    this.rtt = 0;
    this.pingT = 0;
    this.shake = 0;
    this.hurtLevel = 0;
    this.insta = 0; this.dbl = 0;
    this.target = null;
    this.over = null;
    this.snapRows = [];
    this.eggStage = 'cups';
    this.bossId = null;
    this.bossMusic?.stop?.();
    this.bossMusic = null;
    if (this.zombies) this.zombies.bossInfo = { stage: 0, hpFrac: 1 };
    this.rig?.setDread(false);
  }

  // 0..1: how much level geometry sits between the camera and a sound. Two rays (the source and
  // a little above it) so a zombie crouched below a sill is only partly muffled.
  occlusionAt(x, y, z) {
    const o = this.rig.camera.position;
    let blocked = 0;
    for (const dy of [0, 0.6]) {
      const dx = x - o.x, dyy = y + dy - o.y, dz = z - o.z;
      const len = Math.hypot(dx, dyy, dz);
      if (len < 0.8) continue;
      const hit = this.world.raycast(o.x, o.y, o.z, dx / len, dyy / len, dz / len, len);
      if (hit < len - 0.35) blocked++;
    }
    return blocked / 2;
  }

  resize() {
    this.rig.resize();
    this.vm.resize(innerWidth / innerHeight);
  }

  applySettings(s) {
    this.settings = s;
    this.rig.setQuality(s.quality);
    this.audio.setMasterVolume(this.muted ? 0 : s.volume);
    this.audio.hrtf = s.hrtf !== false;
  }

  setMuted(on) {
    this.muted = !!on;
    this.audio.setMasterVolume(this.muted ? 0 : this.settings.volume);
  }

  // --- Session lifecycle ---------------------------------------------------------------
  start(conn, { name, token, local }) {
    this.stop();
    this.resetState();
    this.world = new World();
    this.fx.world = this.world;
    this.conn = conn;
    this.local = !!local;
    this.zombies.interpDelay = local ? 70 : 110;
    this.mode = 'connecting';
    conn.onmessage = (m) => this.onMessage(m);
    conn.onclose = () => { if (this.mode === 'play') this.onEvent({ type: 'disconnected' }); };
    conn.send({ t: 'hello', v: PROTOCOL, token, name });
    this.hud.reset();
    this.level.resetBoards(this.boards);
    this.rebuildDoorVisuals();
    this.level.setBox('idle');
    this.egg.reset(null);
  }

  rebuildDoorVisuals() {
    // Door pieces animate away; recreate them fresh for a new session.
    for (const v of this.level.doorVis.values()) this.level.group.remove(v.group);
    this.level.buildDoors();
  }

  stop() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    this.bossMusic?.stop?.();
    this.bossMusic = null;
    this.rig.setDread(false);
    this.zombies.clear();
    this.avatars.clear();
    this.fx.clear();
    this.hud.show(false);
    this.mode = 'menu';
    this.input.enabled = false;
    this.input.unlock();
  }

  pause(on) {
    if (this.conn?.kind === 'local') this.conn.pause(on);
  }

  // --- Network -----------------------------------------------------------------------------
  onMessage(m) {
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 's': return this.onSnapshot(m);
      case 'pong': this.rtt = performance.now() - m.c; return;
      case 'reject': this.onEvent({ type: 'error', message: m.message }); return;
      case 'end': this.onEvent({ type: 'ended', reason: m.reason, over: this.over }); return;
      default:
    }
  }

  onWelcome(m) {
    this.me = m.id;
    this.region = m.region;
    this.matchId = m.match;
    for (const [id, name, slot] of m.players) this.addPlayer(id, name, slot);
    for (const id of m.doors) this.doorOpened(id, true);
    this.boards = m.boards;
    this.level.resetBoards(m.boards);
    if (m.box) { this.boxState = m.box; if (m.box.state !== 'idle') this.level.setBox(m.box.state, m.box.weapon, m.box.owner, Object.keys(BOX_POOL)); }
    for (const [id, type, x, y, z] of m.powerups) this.fx.spawnPowerup(id, type, x / 100, y / 100, z / 100);
    if (m.egg) { this.eggStage = m.egg.stage; this.egg.reset(m.egg); }
    this.rig.setDread(!!m.hounds);
    const me = m.me;
    if (me) {
      Object.assign(this.p, { x: me.x, y: me.y, z: me.z, yaw: me.yaw, points: me.points, grenades: me.grenades, state: me.state, hp: me.hp });
      this.p.weapons = [...me.weapons];
      for (const w of me.weapons) this.giveAmmo(w);
      this.p.cur = me.cur;
      this.vm.setWeapon(me.cur, true);
    }
    this.round = m.round;
    this.hud.setRound(m.round, false);
    this.mode = 'play';
    this.input.enabled = true;
    this.hud.show(true);
    this.audio.startAmbience();
    this.onEvent({ type: 'started' });
  }

  addPlayer(id, name, slot) {
    if (this.players.has(id)) return;
    this.players.set(id, { id, name, slot, points: 500, state: PS.ALIVE, kills: 0, headshots: 0, downs: 0, revives: 0 });
    if (id !== this.me) this.avatars.create(id, name, slot);
    this.hud.setPlayer(id, name, slot, 500, id === this.me);
  }

  onSnapshot(m) {
    const now = performance.now();
    const serverMs = m.k * 50;
    const off = now - serverMs;
    if (this.clockOffset === null || off < this.clockOffset) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * 0.02;
    const t = serverMs + this.clockOffset;
    for (const e of m.e) this.onGameEvent(e);
    this.zombies.applySnapshot(m.z, t);
    this.snapRows = m.p;
    for (const r of m.p) {
      const pl = this.players.get(r[0]);
      if (!pl) continue;
      pl.points = r[9]; pl.state = r[7]; pl.revive = r[11]; pl.bleed = r[12];
      pl.kills = r[13]; pl.headshots = r[14]; pl.downs = r[15]; pl.revives = r[16];
      pl.x = r[1] / 100; pl.y = r[2] / 100; pl.z = r[3] / 100;
      this.hud.setPlayer(r[0], pl.name, pl.slot, r[9], r[0] === this.me);
      if (r[0] === this.me) {
        this.p.hp = r[6];
        this.p.points = r[9];
        if (r[7] !== this.p.state) this.setMyState(r[7]);
        this.p.grenades = r[18];
        this.myRevive = r[11];
        this.myBleed = r[12];
      } else {
        this.avatars.sample(r[0], r, t);
      }
    }
    if (this.round !== m.r) { this.round = m.r; }
    this.phase = m.ph;
    this.phaseT = m.pt;
    this.insta = m.ik; this.dbl = m.dp;
    if (m.hr !== undefined && !!m.hr !== (this.rig.dreadTarget > 0)) this.rig.setDread(!!m.hr);
    if (m.kb) {
      const [id, hp, stage] = m.kb;
      this.bossId = id;
      this.zombies.bossInfo = { stage, hpFrac: hp / 1000 };
      this.hud.boss(hp / 1000);
      if (!this.bossMusic && this.phase !== 'over') this.bossMusic = this.audio.bossMusic?.() || null;
    } else if (this.bossId !== null) {
      this.bossId = null;
      this.hud.boss(null);
      this.bossMusic?.stop?.();
      this.bossMusic = null;
    }
  }

  setMyState(s) {
    const p = this.p;
    const prev = p.state;
    p.state = s;
    if (s === PS.DOWN) {
      p.preDown = p.cur;
      this.switchTo(START_WEAPON, true);
      if (!p.ammo[START_WEAPON]) this.giveAmmo(START_WEAPON);
      this.hud.downed(true, 1);
    } else if (s === PS.ALIVE && prev === PS.DOWN) {
      this.hud.downed(false);
      if (p.preDown && p.weapons.includes(p.preDown)) this.switchTo(p.preDown, true);
    } else if (s === PS.DEAD) {
      this.hud.downed(false);
      this.hud.center('You bled out', 'You will respawn next round', 4000);
    }
  }

  onGameEvent(e) {
    const [type] = e;
    const me = this.me;
    switch (type) {
      case 'join': this.addPlayer(e[1], e[2], e[3]); if (e[1] !== me && this.mode === 'play') this.hud.center(`${e[2]} joined`, '', 1800); break;
      case 'leave': {
        const pl = this.players.get(e[1]);
        this.avatars.remove(e[1]);
        this.hud.removePlayer(e[1]);
        this.players.delete(e[1]);
        if (pl && e[1] !== me) this.hud.center(`${pl.name} left`, '', 1800);
        break;
      }
      case 'shot': if (e[1] !== me) this.remoteShot(e); break;
      case 'proj': this.fx.projectile(e[1], e[3], e[4] / 100, e[5] / 100, e[6] / 100, e[7] / 100, e[8] / 100, e[9] / 100); if (e[2] !== me) this.remoteShot([0, e[2], e[3], e[4], e[5], e[6], e[7] * 10, e[8] * 10, e[9] * 10]); break;
      case 'boom': {
        const x = e[1] / 100, y = e[2] / 100, z = e[3] / 100;
        if (e[4] === 'nade') this.fx.removeGrenade(e[5]); else this.fx.removeProjectile(e[5]);
        this.fx.explosion(x, y, z, e[4]);
        if (e[4] === 'arcpistol') this.audio.gunshot('arc', { x, y, z }); else this.audio.explosion({ x, y, z });
        const d = Math.hypot(x - this.p.x, y - this.p.y, z - this.p.z);
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 14) * (e[4] === 'arcpistol' ? 0.2 : 0.7));
        break;
      }
      case 'nade': this.fx.throwGrenade(e[1], e[3] / 100, e[4] / 100, e[5] / 100, e[6] / 100, e[7] / 100, e[8] / 100); if (e[2] === me) this.p.grenades = e[9]; break;
      case 'knife': if (e[1] !== me) { const pl = this.players.get(e[1]); if (pl) this.audio.knifeSwing(); } break;
      case 'kill': this.onKill(e); break;
      case 'pts': {
        const pl = this.players.get(e[1]);
        if (pl) { pl.points = e[3]; this.hud.setPlayer(e[1], pl.name, pl.slot, e[3], e[1] === me); this.hud.popPoints(e[1], e[2]); }
        if (e[1] === me) { this.p.points = e[3]; if (e[2] < 0) this.audio.purchase(); }
        break;
      }
      case 'deny': if (e[1] === me) { this.audio.denied(); this.denyT = 1.2; } break;
      case 'give': if (e[1] === me) this.onGive(e[2], e[3].split(',')); break;
      case 'ammo': if (e[1] === me) { const W = WEAPONS[e[2]]; this.p.ammo[e[2]] = { mag: W.mag, res: W.reserve }; } break;
      case 'door': this.doorOpened(e[1], false); break;
      case 'board': this.onBoard(e[1], e[2], e[3]); break;
      case 'box': this.onBox(e); break;
      case 'pu': this.fx.spawnPowerup(e[1], e[2], e[3] / 100, e[4] / 100, e[5] / 100); this.audio.powerupSpawn({ x: e[3] / 100, y: e[4] / 100, z: e[5] / 100 }); break;
      case 'pug': this.onPowerup(e[1], e[2], e[3]); break;
      case 'pux': this.fx.removePowerup(e[1]); break;
      case 'hurt': if (e[1] === me) this.onHurt(e[2], e[3] / 100, e[4] / 100); break;
      case 'down': {
        const pl = this.players.get(e[1]);
        if (e[1] !== me && pl) this.hud.center(`${pl.name} is down!`, 'Hold F near them to revive', 2500);
        break;
      }
      case 'revived': {
        if (e[1] === me) { this.hud.downed(false); }
        break;
      }
      case 'bled': break;
      case 'respawn': if (e[1] === me) this.respawn(e[2] / 100, e[3] / 100, e[4] / 100); break;
      case 'round':
        this.round = e[1];
        this.hud.setRound(e[1], true);
        this.audio.roundStart(e[1]);
        break;
      case 'rend':
        if (e[2]) { this.rig.setDread(false); (this.audio.houndRoundEnd || this.audio.roundEnd).call(this.audio, e[1]); }
        else this.audio.roundEnd(e[1]);
        break;
      case 'hounds':
        this.rig.setDread(true);
        this.audio.houndRoundStart?.();
        this.hud.center('The hounds are loose', 'Back to a wall. Watch each other.', 3600, 'dread');
        this.shake = Math.max(this.shake, 0.2);
        break;
      case 'strike': {
        const x = e[1] / 100, y = e[2] / 100, z = e[3] / 100;
        this.fx.lightning(x, y, z);
        this.audio.lightning?.({ x, y: y + 1, z });
        const d = Math.hypot(x - this.p.x, z - this.p.z);
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 12) * 0.35);
        break;
      }
      case 'zatk': {
        const z = this.zombies.get(e[1]);
        if (!z) break;
        if (z.cls === ZC.HOUND) z.voice = z.state === ZS.WARP ? this.audio.houndBark?.({ x: z.x, y: z.y + 0.6, z: z.z }, z.seed) : this.audio.houndBite?.({ x: z.x, y: z.y + 0.6, z: z.z });
        else if (z.cls === ZC.KINTSUGI) this.audio.bossAttack?.({ x: z.x, y: z.y + 1.5, z: z.z });
        else z.voice = this.audio.zombieAttack({ x: z.x, y: z.y + 1.5, z: z.z }, z.seed);
        break;
      }
      case 'zspawn':
        if (e[2] === ZC.KINTSUGI) {
          this.hud.center('Kintsugi', 'Broken things were mended with gold', 4200, 'gold');
          if (!this.bossMusic) this.bossMusic = this.audio.bossMusic?.() || null;
        }
        break;
      case 'cup': {
        const pos = this.egg.breakCup(e[1]);
        if (pos) {
          this.fx.porcelain(pos[0], pos[1] + 0.06, pos[2], 0.25, 0.35);
          this.audio.teacupBreak?.({ x: pos[0], y: pos[1], z: pos[2] }, e[1]);
        }
        break;
      }
      case 'egg': {
        const f = EGG.figurine.pos;
        const fp = { x: f[0], y: f[1] + 0.15, z: f[2] };
        if (e[1] === 'ready') {
          this.eggStage = 'ready';
          this.egg.setStage('ready');
          this.audio.figurineChime?.(fp);
          this.chimeT = 2.7;
        } else if (e[1] === 'wake') {
          this.eggStage = 'awake';
          this.egg.setStage('awake');
          this.fx.porcelain(fp.x, fp.y, fp.z, 0.5, 0.5);
          this.audio.figurineWake?.(fp);
          this.hud.center('Something stirs…', '', 3000, 'gold');
          this.flashWhite = Math.max(this.flashWhite || 0, 0.25);
        }
        break;
      }
      case 'kshatter': {
        const x = e[2] / 100, y = e[3] / 100, z = e[4] / 100;
        this.fx.porcelain(x, y + 1.0, z, 1.2, 1.3);
        this.audio.bossShatter?.({ x, y: y + 1, z });
        break;
      }
      case 'kreform': {
        const x = e[2] / 100, y = e[3] / 100, z = e[4] / 100;
        this.fx.reform(x, y, z);
        this.audio.bossReform?.({ x, y: y + 1, z });
        break;
      }
      case 'kstage': {
        const z = this.zombies.get(e[1]);
        if (z) {
          this.fx.porcelain(z.x, z.y + 1.4, z.z, 0.6, 0.8);
          this.audio.bossScream?.({ x: z.x, y: z.y + 1.6, z: z.z });
        }
        break;
      }
      case 'chat': { const pl = this.players.get(e[1]); if (pl) this.hud.chat(pl.name, e[2], PLAYER_COLORS[pl.slot % 4]); break; }
      case 'radio': this.radio?.stop?.(); this.radio = this.audio.radioSong({ x: RADIO.pos[0], y: RADIO.pos[1], z: RADIO.pos[2] }); break;
      case 'over': this.onOver(e[1], e[2]); break;
      default:
    }
  }

  // --- Event handlers ------------------------------------------------------------------------
  onZombieSpawn(z) {
    if (z.state !== ZS.RISE) return;
    const ground = Math.max(0, z.y + 1.7) > 2 ? LOFT_Y : 0;
    this.fx.dirt(z.x, ground, z.z);
    this.audio.zombieSpawn({ x: z.x, y: ground, z: z.z });
  }

  onKill(e) {
    const [, zid, by, kind, x100, y100, z100, ang] = e;
    const z = this.zombies.kill(zid, kind, ang / 100);
    const x = x100 / 100, y = y100 / 100, zz = z100 / 100;
    const dx = Math.sin(ang / 100), dz = Math.cos(ang / 100);
    if (z?.cls === ZC.HOUND) {
      this.fx.houndBurst(x, y, zz);
      this.audio.houndDeath?.({ x, y: y + 0.6, z: zz }, z.seed);
      if (kind === 1 && by === this.me) this.audio.headshot({ x, y: y + 0.6, z: zz });
      return;
    }
    if (z?.cls === ZC.KINTSUGI) {
      this.fx.porcelain(x, y + 1.0, zz, 2.5, 1.6);
      this.audio.bossDeath?.({ x, y: y + 1, z: zz });
      this.bossMusic?.stop?.();
      this.bossMusic = null;
      this.bossId = null;
      this.hud.boss(null);
      this.eggStage = 'done';
      this.hud.center('Kintsugi is broken', 'Something golden fell where she stood', 4500, 'gold');
      this.shake = Math.max(this.shake, 0.5);
      return;
    }
    if (kind === 1) {
      this.fx.blood(x, y + 1.65, zz, dx * 0.5, 0.6, dz * 0.5, 2.5);
      if (by === this.me) this.audio.headshot({ x, y: y + 1.6, z: zz });
    } else if (kind === 2) {
      this.fx.blood(x, y + 1.0, zz, dx, 0.8, dz, 2.5);
    } else if (kind === 3) {
      this.fx.blood(x, y + 1.2, zz, 0, 1, 0, 1);
    }
    this.audio.zombieDeath({ x, y: y + 1.4, z: zz }, z ? z.seed : zid);
  }

  onGive(w, list) {
    const p = this.p;
    p.weapons = list.filter((id) => WEAPONS[id]);
    for (const id of Object.keys(p.ammo)) if (!p.weapons.includes(id) && id !== START_WEAPON) delete p.ammo[id];
    this.giveAmmo(w);
    this.switchTo(w);
  }

  onBoard(id, count, repaired) {
    const w = WINDOWS[id];
    this.boards[id] = count;
    this.level.setBoards(id, count);
    const pos = { x: w.x, y: w.sill + 0.6, z: w.z };
    if (repaired) {
      this.audio.boardRepair(pos);
    } else {
      this.audio.boardBreak(pos);
      for (let i = 0; i < 8; i++) {
        this.fx.alpha.emit(w.x + w.n[0] * 0.3, w.sill + 0.3 + Math.random() * 1.1, w.z + w.n[1] * 0.3,
          w.n[0] * 2 + (Math.random() - 0.5) * 2, Math.random() * 2, w.n[1] * 2 + (Math.random() - 0.5) * 2,
          0.35, 0.25, 0.14, 1, 0.04, 0.8, 9, 0.5);
      }
    }
  }

  onBox(e) {
    const kind = e[1];
    if (kind === 'open') {
      this.boxState = { state: 'rolling', owner: e[2], weapon: e[3] };
      this.level.setBox('rolling', e[3], e[2], Object.keys(BOX_POOL));
      const pos = { x: MYSTERY_BOX.pos[0], y: MYSTERY_BOX.pos[1] + 0.5, z: MYSTERY_BOX.pos[2] };
      this.audio.boxOpen(pos);
      this.audio.boxJingle(pos, 4.2);
    } else if (kind === 'ready') {
      this.boxState = { state: 'ready', owner: e[2], weapon: e[3] };
      this.level.setBox('ready', e[3], e[2]);
      this.audio.boxLand({ x: MYSTERY_BOX.pos[0], y: MYSTERY_BOX.pos[1] + 0.8, z: MYSTERY_BOX.pos[2] });
    } else {
      this.boxState = { state: 'idle', owner: null, weapon: null };
      this.level.setBox('idle');
    }
  }

  onPowerup(id, type, pid) {
    this.fx.removePowerup(id);
    if (type === 'goldleaf' && this.audio.goldLeaf) this.audio.goldLeaf();
    else this.audio.powerupGrab(type);
    if (!this.muted) this.audio.announce(POWERUP_NAMES[type] || type);
    this.hud.center(POWERUP_NAMES[type] || type, '', 1800);
    if (type === 'maxammo') {
      for (const w of Object.keys(this.p.ammo)) this.p.ammo[w].res = WEAPONS[w].reserve;
    } else if (type === 'nuke') {
      this.flashWhite = 1;
      this.shake = Math.max(this.shake, 0.5);
    }
  }

  onHurt(hp, zx, zz) {
    this.p.hp = hp;
    this.hurtLevel = Math.min(1, this.hurtLevel + 0.55);
    this.shake = Math.max(this.shake, 0.25);
    this.audio.playerHurt();
    // Direction indicator relative to view.
    const ang = Math.atan2(zx - this.p.x, zz - this.p.z);
    const rel = -(ang - (this.p.yaw + Math.PI));
    this.hud.hurtFrom(rel);
  }

  onOver(round, stats) {
    this.over = { round, stats };
    this.bossMusic?.stop?.();
    this.bossMusic = null;
    this.hud.boss(null);
    this.audio.gameOver();
    this.hud.center('Game over', `You survived ${round} round${round === 1 ? '' : 's'}`, 6000);
    setTimeout(() => { if (this.over) this.onEvent({ type: 'over', over: this.over }); }, 3500);
  }

  respawn(x, y, z) {
    Object.assign(this.p, { x, y, z, vx: 0, vy: 0, vz: 0, state: PS.ALIVE, hp: 100, weapons: [START_WEAPON], ammo: {}, grenades: GRENADE.start });
    this.giveAmmo(START_WEAPON);
    this.switchTo(START_WEAPON, true);
  }

  doorOpened(id, instant) {
    if (this.openDoors.has(id)) return;
    this.openDoors.add(id);
    this.world.setDoorOpen(id);
    this.level.openDoor(id, instant);
    if (!instant) {
      const d = DOORS.find((q) => q.id === id);
      const b = d.box;
      this.fx.dust((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2, b[3] - b[0] + 0.5, b[5] - b[2] + 0.5);
      this.audio.doorOpen({ x: (b[0] + b[3]) / 2, y: 1, z: (b[2] + b[5]) / 2 });
    }
  }

  remoteShot(e) {
    const [, pid, w, ox, oy, oz, dx, dy, dz] = e;
    const W = WEAPONS[w];
    if (!W) return;
    const o = _v.set(ox / 100, oy / 100, oz / 100);
    const d = _dir.set(dx / 1000, dy / 1000, dz / 1000).normalize();
    const muzzle = this.avatars.muzzlePos(pid, _v2) || o;
    this.fx.muzzleWorld(muzzle.x, muzzle.y, muzzle.z);
    this.audio.gunshot(W.sound, { x: muzzle.x, y: muzzle.y, z: muzzle.z });
    if (W.projectile) return;
    const n = [0, 0, 0];
    for (let i = 0; i < Math.min(W.pellets, 4); i++) {
      const s = W.spread;
      const ddx = d.x + (Math.random() - 0.5) * s, ddy = d.y + (Math.random() - 0.5) * s, ddz = d.z + (Math.random() - 0.5) * s;
      const len = Math.hypot(ddx, ddy, ddz);
      const t = this.world.raycast(o.x, o.y, o.z, ddx / len, ddy / len, ddz / len, W.range, n);
      const ex = o.x + (ddx / len) * t, ey = o.y + (ddy / len) * t, ez = o.z + (ddz / len) * t;
      if (Math.random() < 0.5) this.fx.tracer(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez);
      if (t < W.range) this.fx.impact(ex, ey, ez, n[0], n[1], n[2]);
    }
  }

  // --- Weapons -----------------------------------------------------------------------------
  giveAmmo(w) {
    const W = WEAPONS[w];
    if (W) this.p.ammo[w] = { mag: W.mag, res: W.reserve };
  }

  switchTo(w, instant = false) {
    const p = this.p;
    if (!WEAPONS[w]) return;
    if (p.cur === w && !instant) return;
    p.cur = w;
    p.reloadT = 0;
    this.vm.cancel();
    this.vm.setWeapon(w, instant);
    p.switchT = instant ? 0 : 0.45;
    if (!instant) this.audio.weaponSwitch();
    this.conn?.send({ t: 'switch', w });
  }

  cycleWeapon(dir) {
    const p = this.p;
    if (p.state !== PS.ALIVE || p.weapons.length < 2) return;
    const i = p.weapons.indexOf(p.cur);
    this.switchTo(p.weapons[(i + dir + p.weapons.length) % p.weapons.length]);
  }

  reload() {
    const p = this.p;
    const W = WEAPONS[p.cur];
    const a = p.ammo[p.cur];
    if (!a || p.reloadT > 0 || a.mag >= W.mag || a.res <= 0 || p.switchT > 0) return;
    const dur = W.reload;
    p.reloadT = dur;
    p.reloadDur = dur;
    const style = W.kind === 'bolt' ? 'bolt' : p.cur === 'doublebarrel' ? 'break' : W.pump ? 'pump' : 'mag';
    this.vm.reload(dur, style);
    const snd = style === 'bolt' ? ['bolt', 'shell', 'shell', 'bolt'] : style === 'pump' ? ['shell', 'shell', 'shell', 'bolt'] : style === 'break' ? ['out', 'shell', 'in'] : ['out', 'in', 'bolt'];
    p.reloadEvents = snd.map((s, i) => ({ at: dur * (0.2 + (i / Math.max(1, snd.length - 1)) * 0.7), s }));
  }

  finishReload() {
    const p = this.p;
    const W = WEAPONS[p.cur];
    const a = p.ammo[p.cur];
    const need = W.mag - a.mag;
    const take = Math.min(need, a.res);
    a.mag += take;
    a.res -= take;
  }

  canAct() {
    const p = this.p;
    return this.mode === 'play' && (p.state === PS.ALIVE || p.state === PS.DOWN) && this.input.locked;
  }

  updateWeapons(dt) {
    const p = this.p, I = this.input;
    p.fireT = Math.max(0, p.fireT - dt);
    p.switchT = Math.max(0, p.switchT - dt);
    p.knifeT = Math.max(0, p.knifeT - dt);
    p.bloom = Math.max(0, p.bloom - dt * 2.2);
    if (p.reloadT > 0) {
      const before = p.reloadDur - p.reloadT;
      p.reloadT -= dt;
      const after = p.reloadDur - p.reloadT;
      for (const ev of p.reloadEvents) if (ev.at > before && ev.at <= after) this.audio.reload(ev.s);
      if (p.reloadT <= 0) { p.reloadT = 0; this.finishReload(); }
    }
    if (p.nadePending > 0) {
      p.nadePending -= dt;
      if (p.nadePending <= 0) this.throwGrenade();
    }
    if (!this.canAct()) return;
    const down = p.state === PS.DOWN;
    if (!down) {
      if (I.hit('Digit1') && p.weapons[0]) this.switchTo(p.weapons[0]);
      if (I.hit('Digit2') && p.weapons[1]) this.switchTo(p.weapons[1]);
      if (I.mouse.wheel) this.cycleWeapon(I.mouse.wheel > 0 ? 1 : -1);
      if (I.hit('KeyV') || I.hit('KeyE')) this.knife();
      if (I.hit('KeyG') && p.grenades > 0 && p.nadePending <= 0 && !this.vm.busy) {
        this.vm.grenade();
        p.nadePending = 0.28;
        p.reloadT = 0;
      }
    }
    if (I.hit('KeyR')) this.reload();
    const W = WEAPONS[p.cur];
    const a = p.ammo[p.cur];
    if (!W || !a) return;
    const auto = I.touchMode && this.settings.touchAutoFire !== false && this.crosshairOnZombie(W);
    const trigger = (W.auto ? I.mouse.left : I.hit('Mouse0')) || auto;
    if (!trigger) return;
    if (p.switchT > 0 || p.reloadT > 0 || p.fireT > 0 || p.knifeT > 0.3 || p.nadePending > 0) return;
    if (p.sprinting) { p.sprinting = false; }
    if (a.mag <= 0) {
      if (I.hit('Mouse0')) this.audio.dryFire();
      if (a.res > 0) this.reload();
      return;
    }
    a.mag--;
    p.fireT = 60 / W.rpm;
    this.fire(W);
  }

  fire(W) {
    const p = this.p;
    const cam = this.rig.camera;
    const ads = this.vm.ads;
    const moving = Math.hypot(p.vx, p.vz) / WALK;
    let spread = W.spread + (W.aimSpread - W.spread) * ads;
    spread *= 1 + moving * 0.9 + (p.onGround ? 0 : 1.5) + p.crouch * -0.25;
    spread += p.bloom * W.spread * 0.8;
    p.bloom = Math.min(3, p.bloom + 0.45);
    const o = cam.position;
    cam.getWorldDirection(_dir);
    const muzzle = this.vm.muzzleWorld(cam, _v2);
    this.vm.fire(p.cur);
    this.audio.gunshot(W.sound);
    this.rig.muzzleFlash(muzzle, W.kind === 'wonder' ? 0.3 : 1);
    p.recoilPitch += W.kick * (1 - ads * 0.5) * 0.9;
    if (W.projectile) {
      this.conn.send({ t: 'proj', w: p.cur, o: [o.x + _dir.x * 0.4, o.y + _dir.y * 0.4 - 0.05, o.z + _dir.z * 0.4], d: [_dir.x, _dir.y, _dir.z] });
      return;
    }
    const hits = [];
    const n = [0, 0, 0];
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    for (let k = 0; k < W.pellets; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const dx = _dir.x + right.x * Math.cos(a) * r + up.x * Math.sin(a) * r;
      const dy = _dir.y + right.y * Math.cos(a) * r + up.y * Math.sin(a) * r;
      const dz = _dir.z + right.z * Math.cos(a) * r + up.z * Math.sin(a) * r;
      const len = Math.hypot(dx, dy, dz);
      const ux = dx / len, uy = dy / len, uz = dz / len;
      const wallT = this.world.raycast(o.x, o.y, o.z, ux, uy, uz, W.range, n);
      const zh = [];
      this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw) => {
        if (Math.abs(zx - o.x) > W.range || Math.abs(zz - o.z) > W.range) return;
        const h = enemyHitTest(cls, o.x, o.y, o.z, ux, uy, uz, zx, zy, zz, yaw, wallT);
        if (h) zh.push([h.t, id, h.part]);
      });
      zh.sort((q, r2) => q[0] - r2[0]);
      // A teacup in the line of fire (only the first pellet can claim one).
      if (k === 0 && this.eggStage === 'cups') {
        const cup = this.egg.hitTest(o.x, o.y, o.z, ux, uy, uz, Math.min(wallT, zh.length ? zh[0][0] : Infinity));
        if (cup >= 0) this.conn.send({ t: 'cup', i: cup, o: [o.x, o.y, o.z], d: [ux, uy, uz] });
      }
      const maxPen = 1 + (W.penetrate || 0);
      let endT = wallT;
      for (let i = 0; i < Math.min(maxPen, zh.length); i++) {
        const [t, id, part] = zh[i];
        hits.push([id, part]);
        const hx = o.x + ux * t, hy = o.y + uy * t, hz = o.z + uz * t;
        const hitCls = this.zombies.get(id)?.cls;
        if (hitCls === ZC.KINTSUGI) this.fx.porcelain(hx, hy, hz, 0.12, 0.25);
        else if (hitCls === ZC.HOUND) { this.fx.blood(hx, hy, hz, ux, uy, uz, 0.5); this.fx.add.emit(hx, hy, hz, ux, 1, uz, 1, 0.5, 0.1, 1, 0.08, 0.3, 2, 1); }
        else this.fx.blood(hx, hy, hz, ux, uy, uz, part === 0 ? 1.4 : 0.8);
        this.audio.impactFlesh({ x: hx, y: hy, z: hz });
        if (i === maxPen - 1) endT = t;
      }
      if (zh.length < maxPen && wallT < W.range) this.fx.impact(o.x + ux * wallT, o.y + uy * wallT, o.z + uz * wallT, n[0], n[1], n[2]);
      if (W.pellets === 1 || k < 3) {
        if (!W.auto || Math.random() < 0.6) this.fx.tracer(muzzle.x, muzzle.y, muzzle.z, o.x + ux * endT, o.y + uy * endT, o.z + uz * endT);
      }
    }
    this.conn.send({ t: 'fire', w: p.cur, o: [o.x, o.y, o.z], d: [_dir.x, _dir.y, _dir.z], h: hits });
  }

  knife() {
    const p = this.p;
    if (p.knifeT > 0 || this.vm.switching) return;
    p.knifeT = KNIFE.cooldown;
    p.reloadT = 0;
    this.vm.knife();
    this.audio.knifeSwing();
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    let best = null, bd = KNIFE.range + 0.3;
    this.zombies.forEachTarget((id, zx, zy, zz, st) => {
      const dx = zx - p.x, dz = zz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(zy - p.y) > 1.3 || st === ZS.RISE || st === ZS.WARP) return;
      const dot = (dx * _dir.x + dz * _dir.z) / (d * Math.hypot(_dir.x, _dir.z) || 1);
      if (dot < 0.55 && d > 0.6) return;
      best = { id, zx, zy, zz }; bd = d;
    });
    if (best) {
      this.fx.blood(best.zx, best.zy + 1.3, best.zz, _dir.x, 0.2, _dir.z, 1.2);
      this.audio.knifeHit({ x: best.zx, y: best.zy + 1.3, z: best.zz });
      // Lunge a little toward the target.
      p.vx += _dir.x * 3; p.vz += _dir.z * 3;
    }
    this.conn.send({ t: 'knife', z: best ? best.id : -1 });
  }

  throwGrenade() {
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    const o = cam.position;
    const v = [_dir.x * 15 + this.p.vx * 0.5, _dir.y * 15 + 3.5, _dir.z * 15 + this.p.vz * 0.5];
    this.conn.send({ t: 'nade', o: [o.x + _dir.x * 0.4, o.y - 0.1, o.z + _dir.z * 0.4], v });
  }

  // --- Interaction ------------------------------------------------------------------------------
  findTarget() {
    const p = this.p;
    if (p.state !== PS.ALIVE) return null;
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    const near = (x, y, z, r) => Math.hypot(p.x - x, p.z - z) <= r && Math.abs(p.y - y) < 1.4;
    for (const pl of this.players.values()) {
      if (pl.id === this.me || pl.state !== PS.DOWN) continue;
      if (near(pl.x, pl.y, pl.z, 1.6)) return { kind: 'revive', hold: true, label: `Hold <b>F</b> to revive ${escapeHtml(pl.name)}`, short: `Revive ${pl.name}`, pl };
    }
    const B = MYSTERY_BOX;
    if (this.openDoors.has('debrisA') || this.openDoors.has('debrisB')) {
      if (near(B.pos[0], B.pos[1], B.pos[2], 2.1)) {
        const bs = this.boxState;
        if (bs.state === 'ready' && bs.owner === this.me) return { kind: 'boxTake', label: `Press <b>F</b> to take the ${WEAPONS[bs.weapon].name}`, short: `Take ${WEAPONS[bs.weapon].name}` };
        if (bs.state === 'idle') return { kind: 'box', label: `Press <b>F</b> for a random weapon <span class="cost">[Cost: ${BOX_COST}]</span>`, short: `Mystery box · ${BOX_COST}`, cost: BOX_COST };
      }
    }
    for (const wb of WALL_BUYS) {
      const fy = wb.pos[1] - 1.55;
      if (!near(wb.pos[0], fy, wb.pos[2], 1.7)) continue;
      const facing = -(_dir.x * wb.face[0] + _dir.z * wb.face[1]);
      if (facing < 0.2) continue;
      const W = WEAPONS[wb.weapon];
      const price = WALL_PRICES[wb.weapon];
      if (p.weapons.includes(wb.weapon)) {
        return { kind: 'wall', id: wb.id, label: `Press <b>F</b> to buy ${W.name} ammo <span class="cost">[Cost: ${Math.round(price / 2)}]</span>`, short: `Ammo · ${Math.round(price / 2)}`, cost: Math.round(price / 2) };
      }
      return { kind: 'wall', id: wb.id, label: `Press <b>F</b> to buy ${W.name} <span class="cost">[Cost: ${price}]</span>`, short: `${W.name} · ${price}`, cost: price };
    }
    for (const d of DOORS) {
      if (this.openDoors.has(d.id)) continue;
      if (d.use.some((u) => near(u[0], u[1], u[2], 2.3))) {
        const verb = d.kind === 'door' ? 'open the door' : 'clear the debris';
        return { kind: 'door', id: d.id, label: `Press <b>F</b> to ${verb} <span class="cost">[Cost: ${d.cost}]</span>`, short: `${d.kind === 'door' ? 'Open door' : 'Clear debris'} · ${d.cost}`, cost: d.cost };
      }
    }
    for (const w of WINDOWS) {
      if (this.boards[w.id] >= MAX_BOARDS) continue;
      if (near(w.repair[0], w.repair[1], w.repair[2], 1.3)) return { kind: 'repair', hold: true, label: 'Hold <b>F</b> to rebuild the barrier', short: 'Hold to rebuild' };
    }
    if (near(RADIO.pos[0], 0, RADIO.pos[2], 1.6)) return { kind: 'radio', label: '', short: 'Radio' };
    // The figurine only answers once all three teacups are broken.
    if (this.eggStage === 'ready') {
      const f = EGG.figurine.pos;
      if (near(f[0], 0, f[2], 2.0)) return { kind: 'egg', label: 'Press <b>F</b> to touch the figurine', short: 'Touch the figurine' };
    }
    return null;
  }

  updateInteraction(dt) {
    const t = this.findTarget();
    this.target = t;
    let label = t ? t.label : '';
    if (this.denyT > 0) { this.denyT -= dt; label = 'Not enough points'; }
    this.hud.prompt(this.input.touchMode ? '' : label);
    this.touch?.setUse(this.canAct() ? t : null);
    if (t && this.canAct() && this.input.hit('KeyF') && !t.hold) {
      if (t.kind === 'radio') this.conn.send({ t: 'radio' });
      else if (t.kind === 'egg') this.conn.send({ t: 'egg' });
      else if (t.kind === 'box') this.conn.send({ t: 'buy', k: 'box' });
      else if (t.kind === 'boxTake') this.conn.send({ t: 'buy', k: 'boxTake' });
      else this.conn.send({ t: 'buy', k: t.kind, id: t.id });
    }
    // Revive progress bar.
    if (t?.kind === 'revive' && this.input.down('KeyF')) this.hud.revive(`Reviving ${t.pl.name}…`, (t.pl.revive || 0) / 100);
    else if (this.p.state === PS.DOWN && this.myRevive > 0) this.hud.revive('Being revived…', this.myRevive / 100);
    else this.hud.revive(null);
  }

  // Touch aim assist: a little friction and pull when the crosshair is near a
  // zombie in view. Returns look friction and a yaw/pitch nudge for this frame.
  aimAssist(dt) {
    const p = this.p, I = this.input;
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    const o = cam.position;
    const CONE = 0.13;
    let best = null, bestAng = CONE;
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls) => {
      if (st === ZS.RISE) return;
      const vx = zx - o.x, vy = zy + (cls === ZC.HOUND ? 0.55 : 1.35) - o.y, vz = zz - o.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > 28 || d < 0.5) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * _dir.x + vy * _dir.y + vz * _dir.z) / d)));
      if (ang >= bestAng) return;
      if (!this.world.lineOfSight(o.x, o.y, o.z, zx, zy + (cls === ZC.HOUND ? 0.55 : 1.35), zz)) return;
      bestAng = ang;
      best = { vx, vy, vz };
    });
    if (!best) return { friction: 1, dyaw: 0, dpitch: 0 };
    let ey = Math.atan2(-best.vx, -best.vz) - p.yaw;
    while (ey > Math.PI) ey -= Math.PI * 2;
    while (ey < -Math.PI) ey += Math.PI * 2;
    const ep = Math.atan2(best.vy, Math.hypot(best.vx, best.vz)) - p.pitch;
    const moving = I.lookActive || Math.abs(I.move.x) + Math.abs(I.move.y) > 0.2;
    const pull = (I.mouse.left ? 8 : moving ? 4 : 0) * (1 - 0.6 * bestAng / CONE);
    const k = Math.min(1, pull * dt);
    return { friction: 0.55 + 0.45 * (bestAng / CONE), dyaw: ey * k, dpitch: ep * k };
  }

  // Is the crosshair ray on a zombie within this weapon's range (and not behind a wall)?
  crosshairOnZombie(W) {
    if (!W || W.projectile || this.p.reloadT > 0) return false;
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    const o = cam.position;
    const range = Math.min(W.range, 35);
    const wall = this.world.raycast(o.x, o.y, o.z, _dir.x, _dir.y, _dir.z, range);
    let hit = false;
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw) => {
      if (hit || st === ZS.RISE) return;
      if (enemyHitTest(cls, o.x, o.y, o.z, _dir.x, _dir.y, _dir.z, zx, zy, zz, yaw, wall)) hit = true;
    });
    return hit;
  }

  // --- Movement --------------------------------------------------------------------------------
  updatePlayer(dt) {
    const p = this.p, I = this.input, S = this.settings;
    const cam = this.rig.camera;
    const active = this.canAct();
    const zoom = 1 - this.vm.ads * 0.35;
    if (active) {
      const assist = I.touchMode && S.touchAssist !== false ? this.aimAssist(dt) : null;
      const friction = assist ? assist.friction : 1;
      p.yaw -= I.mouse.dx * 0.0022 * S.sensitivity * zoom * friction;
      p.pitch -= I.mouse.dy * 0.0022 * S.sensitivity * zoom * friction * (S.invert ? -1 : 1);
      p.yaw += I.lookRad.yaw;
      p.pitch += I.lookRad.pitch * (S.invert ? -1 : 1);
      if (assist) { p.yaw += assist.dyaw; p.pitch += assist.dpitch; }
      p.pitch = Math.max(-1.52, Math.min(1.52, p.pitch));
    }
    const down = p.state === PS.DOWN, dead = p.state === PS.DEAD;
    let fx = 0, fz = 0;
    if (active && !dead) {
      if (I.down('KeyW')) fz -= 1;
      if (I.down('KeyS')) fz += 1;
      if (I.down('KeyA')) fx -= 1;
      if (I.down('KeyD')) fx += 1;
      if (I.move.x || I.move.y) { fx = I.move.x; fz = I.move.y; }
    }
    // Keyboard diagonals normalise to 1; a half-pushed stick walks slower.
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const crouchKey = active && (I.down('KeyC') || I.down('ControlLeft'));
    p.crouch += ((crouchKey || down ? 1 : 0) - p.crouch) * Math.min(1, dt * 10);
    const W = WEAPONS[p.cur];
    const ads = active && I.mouse.right && !down;
    p.sprinting = active && !down && (I.down('ShiftLeft') || I.touchSprint) && fz < 0 && !ads && p.stamina > 0 && p.reloadT <= 0;
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - dt);
    else p.stamina = Math.min(4, p.stamina + dt * (I.down('ShiftLeft') ? 0.3 : 0.9));
    let speed = p.sprinting ? SPRINT : WALK;
    if (ads) speed *= 0.55;
    speed *= 1 - p.crouch * 0.5;
    speed *= W ? W.moveMult : 1;
    if (down) speed = 0.9;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const wx = (fx * cos + fz * sin) * speed;
    const wz = (-fx * sin + fz * cos) * speed;
    const accel = p.onGround ? 14 : 2.5;
    p.vx += (wx - p.vx) * Math.min(1, accel * dt);
    p.vz += (wz - p.vz) * Math.min(1, accel * dt);
    if (active && !down && !dead && I.hit('Space') && p.onGround) { p.vy = 5.4; p.onGround = false; }
    p.height = down ? 0.8 : 1.75 - p.crouch * 0.6;

    if (!dead) {
      // Zombies are solid.
      this.zombies.forEachTarget((id, zx, zy, zz, st) => {
        if (st === ZS.RISE || st === ZS.CLIMB) return;
        const dx = p.x - zx, dz = p.z - zz;
        const d = Math.hypot(dx, dz);
        if (d < 0.6 && d > 1e-4 && Math.abs(zy - p.y) < 1.2) { p.x += (dx / d) * (0.6 - d); p.z += (dz / d) * (0.6 - d); }
      });
      const wasGround = p.onGround, vyBefore = p.vy;
      const stepped = this.world.moveCharacter(p, dt);
      p.eyeSmooth = Math.max(-0.5, p.eyeSmooth - stepped);
      if (!wasGround && p.onGround && vyBefore < -4) { this.audio.jumpLand(); this.shake = Math.max(this.shake, 0.08); }
    }
    p.eyeSmooth *= Math.exp(-dt * 14);

    // Footsteps.
    const hs = Math.hypot(p.vx, p.vz);
    if (p.onGround && hs > 1 && !down) {
      p.lastStep += dt * hs;
      if (p.lastStep > (p.sprinting ? 2.4 : 1.9)) { p.lastStep = 0; this.audio.footstep(p.y > 0.05 && p.y < LOFT_Y - 0.1 ? 'wood' : 'wood'); }
    }

    // Camera.
    const eye = down ? DOWN_EYE : EYE - p.crouch * (EYE - CROUCH_EYE);
    p.eye += (eye - p.eye) * Math.min(1, dt * 12);
    p.recoilPitch *= Math.exp(-dt * 9);
    const bob = p.onGround ? Math.sin(performance.now() / 1000 * (p.sprinting ? 13 : 9)) * 0.025 * Math.min(1, hs / WALK) * (1 - this.vm.ads) : 0;
    const shake = this.shake * this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    cam.position.set(p.x, p.y + p.eye + p.eyeSmooth + bob, p.z);
    cam.rotation.set(
      p.pitch + p.recoilPitch + (Math.random() - 0.5) * shake * 0.08,
      p.yaw + (Math.random() - 0.5) * shake * 0.08,
      down ? 0.25 : (Math.random() - 0.5) * shake * 0.04,
    );
    const baseFov = S.fov;
    const W2 = WEAPONS[p.cur];
    const adsFov = W2 ? Math.min(baseFov, baseFov * (W2.adsFov / 70)) : baseFov;
    const fovTarget = baseFov + (adsFov - baseFov) * this.vm.ads + (p.sprinting ? 5 : 0);
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 12);
    cam.updateProjectionMatrix();

    this.vmState = {
      moving: Math.min(1, hs / WALK), sprint: p.sprinting, ads, dx: active ? I.mouse.dx : 0, dy: active ? I.mouse.dy : 0,
      light: this.rig.lightAt(cam.position), down,
    };
    this.crossSpread = (() => {
      if (!W) return 6;
      const s = W.spread + (W.aimSpread - W.spread) * this.vm.ads;
      return 4 + s * (1 + Math.min(1, hs / WALK) * 0.9 + p.bloom * 0.8) * (innerHeight / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    })();
  }

  sendInput(dt) {
    this.inputT += dt;
    if (this.inputT < INPUT_RATE || !this.conn) return;
    this.inputT = 0;
    const p = this.p, I = this.input;
    let f = 0;
    if (this.canAct() && I.down('KeyF')) f |= IN.USE;
    if (p.sprinting) f |= IN.SPRINT;
    if (p.crouch > 0.5) f |= IN.CROUCH;
    if (this.vm.ads > 0.5) f |= IN.ADS;
    if (p.reloadT > 0) f |= IN.RELOAD;
    this.conn.send({ t: 'in', x: round3(p.x), y: round3(p.y), z: round3(p.z), yaw: round3(p.yaw), pitch: round3(p.pitch), f });
    this.pingT -= INPUT_RATE;
    if (this.pingT <= 0 && this.conn.kind === 'ws') { this.pingT = 2; this.conn.send({ t: 'ping', c: performance.now() }); }
  }

  // --- Frame -------------------------------------------------------------------------------------
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.input.beginFrame(dt);
    const now = performance.now();
    if (this.mode === 'play') this.frame(dt, now);
    else this.attract(dt);
    this.rig.update(dt, this.time);
    this.level.update(dt);
    this.egg.update(dt);
    this.exterior.update(dt);
    this.zombies.update(dt, now, this.rig.camera.position);
    this.avatars.update(dt, now, this.zombies.interpDelay);
    this.fx.update(dt, this.mode === 'play' ? this.rig.camera.position : null);
    const cam = this.rig.camera;
    cam.getWorldDirection(_dir);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, _dir.x, _dir.y, _dir.z, _up.x, _up.y, _up.z);
    this.audio.update(dt);
    this.render();
    this.rig.adapt(dt);
    this.input.endFrame();
  }

  frame(dt, now) {
    this.updatePlayer(dt);
    this.updateWeapons(dt);
    this.updateInteraction(dt);
    this.sendInput(dt);
    const p = this.p;
    const W = WEAPONS[p.cur];
    const a = p.ammo[p.cur] || { mag: 0, res: 0 };
    this.vm.update(dt, this.vmState);
    this.hud.setAmmo(W ? W.name : '', a.mag, a.res, W ? W.mag : 1);
    this.hud.setGrenades(p.grenades);
    this.hud.crosshair(this.crossSpread, this.vm.ads < 0.4 && p.state !== PS.DEAD && !p.sprinting);
    this.hud.powerups(this.insta, this.dbl);
    const low = p.state === PS.ALIVE ? Math.max(0, 1 - p.hp / 60) : p.state === PS.DOWN ? 0.9 : 0;
    this.hurtLevel = Math.max(low, this.hurtLevel - dt * 0.8);
    this.hud.hurt(this.hurtLevel);
    this.audio.setHeartbeat(p.state === PS.ALIVE ? Math.max(0, 1 - p.hp / 45) : p.state === PS.DOWN ? 0.8 : 0);
    if (p.state === PS.DOWN && this.phase !== 'over') this.hud.downed(true, Math.max(0, (this.myBleed ?? 30) / 30));
    else if (this.phase === 'over') this.hud.downed(false);
    const showBoard = this.input.down('Tab');
    if (showBoard !== this.boardShown || showBoard) {
      this.boardShown = showBoard;
      this.hud.scoreboard(showBoard, [...this.players.values()], this.round);
    }
    if (this.conn?.kind === 'ws') {
      const rn = REGIONS[this.region] || this.region || '';
      this.hud.netinfo(`${rn} · ${Math.round(this.rtt)} ms`);
    } else {
      this.hud.netinfo('');
    }
    if (this.flashWhite > 0) this.flashWhite = Math.max(0, this.flashWhite - dt * 1.5);
    // Unbroken teacups catch the light now and then: a faint gold glint to find them by.
    if (this.eggStage === 'cups' && Math.random() < dt * 0.9) {
      const i = Math.floor(Math.random() * EGG.cups.length);
      if (!this.egg.cups[i].broken) {
        const c = EGG.cups[i].pos;
        this.fx.add.emit(c[0] + (Math.random() - 0.5) * 0.06, c[1] + 0.07, c[2] + (Math.random() - 0.5) * 0.06, 0, 0.05, 0, 1, 0.82, 0.4, 1, 0.05, 0.35, 0, 0, 1.5);
      }
    }
    // The primed figurine keeps chiming for anyone close enough to hear it.
    if (this.eggStage === 'ready') {
      this.chimeT = (this.chimeT ?? 0) - dt;
      const f = EGG.figurine.pos;
      if (this.chimeT <= 0 && Math.hypot(p.x - f[0], p.z - f[2]) < 16) {
        this.chimeT = 2.7;
        this.audio.figurineChime?.({ x: f[0], y: f[1] + 0.15, z: f[2] });
      }
    }
  }

  attract(dt) {
    const cam = this.rig.camera;
    const t = this.time * 0.05;
    const r = 24;
    cam.position.set(-4 + Math.cos(t) * r, 6.5 + Math.sin(t * 0.7) * 1.5, Math.sin(t) * r);
    cam.lookAt(-4, 2.2, 0);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }

  render() {
    const r = this.rig.renderer;
    r.toneMappingExposure = 1.15 + (this.flashWhite || 0) * 4;
    r.clear();
    r.render(this.rig.scene, this.rig.camera);
    if (this.mode === 'play' && this.p.state !== PS.DEAD) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }
}

function round3(v) { return Math.round(v * 1000) / 1000; }
