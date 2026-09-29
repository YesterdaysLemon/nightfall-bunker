// The client game: owns rendering systems, the local player, weapons,
// interaction and the network message handling.

import * as THREE from 'three';
import { World, enemyHitTest } from '../shared/world.js';
import { enemy, enemyFor } from '../shared/enemies.js';
import { lookOf } from './enemy-looks.js';
import { powerupName } from '../shared/powerups.js';
import { CORE_EVENTS, HOUND_EVENTS, KINTSUGI_EVENTS, MACHINE_EVENTS, eventTable } from './events.js';
import { TEXT, SOUND_CAPTIONS } from './text.js';
import { DEFAULT_MAP, mapById } from '../shared/map.js';
import {
  WEAPONS, WALL_PRICES, BOX_COST, BOX_POOL, START_WEAPON, KNIFE, GRENADE, FORGE_COST, shotInterval, reloadStyle, upgradedId,
} from '../shared/weapons.js';
import { PERKS, PERK_IDS, perkMult, perkCost } from '../shared/perks.js';
import { UPGRADED_AMMO } from '../shared/sim.js';
import { PS, ZS, ZC, IN, PROTOCOL, REGIONS, ZF } from '../shared/protocol.js';
import { ACTIONS, bindingsOf, keyLabel } from './settings.js';
import { EggProps } from './render/egg.js';
import { prepareRetroTextures, setRetroTextures } from './render/retro.js';
import { buildTeacup } from './render/kintsugi.js';
import { SceneRig } from './render/scene.js';
import { createTextures } from './render/textures.js';
import { Level } from './render/level.js';
import { DRESSING } from './render/maps/index.js';
import { MachineProps } from './render/machine-props.js';
import { buildBoxToken } from './render/machines.js';
import { Zombies } from './render/zombies.js';
import { Avatars } from './render/avatars.js';
import { FX } from './render/fx.js';
import { ViewModel } from './render/viewmodel.js';
import { reloadCues } from './render/reloads.js';
import { HUD, escapeHtml } from './hud.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';

const EYE = 1.62, CROUCH_EYE = 1.08, DOWN_EYE = 0.55;
const LOOK_SCALE = 0.0022;     // radians of turn per pixel of mouse travel at sensitivity 1
const PITCH_LIMIT = 1.52;      // just short of straight up or down
const WALK = 4.2, SPRINT = 6.3;
const INPUT_RATE = 1 / 20;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3();

// Sound captions point with one of eight arrows, clockwise from straight ahead.
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

export class Game {
  constructor(canvas, settings, models = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.models = models;
    this.rig = new SceneRig(canvas, settings.quality);
    this.tex = createTextures(this.rig.renderer);
    // The 1997 look (art/STYLE.md): small-palette textures and the TV pass.
    prepareRetroTextures(this.tex);
    this.setCrt(settings.crt);
    this.muted = !!settings.muted;
    this.audio = new AudioEngine({ masterVolume: this.muted ? 0 : settings.volume, hrtf: settings.hrtf !== false });
    this.audio.occlusion = (x, y, z) => this.occlusionAt(x, y, z);
    this.map = mapById(settings.map || DEFAULT_MAP);
    this.world = new World(this.map);
    this.fx = new FX(this.rig, this.tex, this.world, this.audio);
    this.zombies = new Zombies(this.rig, this.tex, this.audio, this.fx, models);
    this.zombies.onSpawn = (z) => this.onZombieSpawn(z);
    this.eventHandlers = eventTable(CORE_EVENTS, HOUND_EVENTS, KINTSUGI_EVENTS, MACHINE_EVENTS);
    this.zombies.onSound = (kind, z) => {
      if (Math.hypot(z.x - this.p.x, z.z - this.p.z) < 14) this.caption(kind, SOUND_CAPTIONS[kind], z.x, z.z);
    };
    this.egg = null;
    this.setMap(this.map.id);
    this.fx.goldModel = () => { const g = buildTeacup(this.models.kintsugi); g.scale.setScalar(3.4); g.position.y = -0.15; return g; };
    this.avatars = new Avatars(this.rig.scene, this.tex, models.survivor || null);
    this.vm = new ViewModel();
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
    this.ready = this.warmup();
    this.applySettings(settings); // after warmup: every gun model exists now
    this.loop = this.loop.bind(this);
    // Draw once the shaders are compiled, so the first frame doesn't stall on them.
    this.ready.then(() => requestAnimationFrame(this.loop));
  }

  // Compile every shader before the first frame, in parallel where the browser
  // can (KHR_parallel_shader_compile), so neither the menu nor the first zombie,
  // hound or boss stalls on one. Resolves when they are all ready.
  warmup() {
    this.rig.camera.position.set(0, 1.6, 0);
    for (const id of Object.keys(WEAPONS)) this.vm.model(id);
    this.standIns(true);
    const done = this.compileFor([[this.rig.scene, this.rig.camera], [this.vm.scene, this.vm.camera]]);
    this.standIns(false);   // compile() has already collected their materials
    return done.catch((err) => console.warn('shader warm-up:', err));
  }

  // Compile shaders for the render target the frames really draw into. The TV
  // look draws into a small offscreen target, and shaders for a target differ
  // from shaders for the screen: compiling the screen's versions would waste the
  // warm-up and leave the first frame compiling everything again.
  compileFor(pairs) {
    const r = this.rig.renderer;
    this.rig.beginFrame();
    const done = pairs.map(([scene, camera]) => r.compileAsync(scene, camera));
    r.setRenderTarget(null);
    // The TV pass itself draws to the screen.
    if (this.rig.tv) done.push(r.compileAsync(this.rig.tv.scene, this.rig.tv.camera));
    return Promise.all(done);
  }

  // A stand-in hound and boss, so their shaders compile with everything else.
  standIns(on) {
    const h = this.zombies.drawers.hound, b = this.zombies.drawers.kintsugi;
    const fake = (cls) => ({ id: -1, seed: 1, cls, x: 0, y: 0, z: -3, yaw: 0, speed: 0, phase: 0, state: ZS.CHASE, stateT: 0.5, killed: false, deadT: 0, stage: 0, hpFrac: 1 });
    h?.begin();
    if (on) h?.draw(fake(ZC.HOUND), 0.016, 0);
    h?.end();
    if (on) b?.draw(fake(ZC.KINTSUGI), 0.016, 0);
    else b?.hide();
  }

  // Models that arrive after the menu (hounds, the Kintsugi set, other players'
  // avatar): swap them in and compile their shaders in the background.
  useModels(models) {
    Object.assign(this.models, models);
    this.zombies.useModels(models);
    this.egg?.setModel(models.kintsugi);
    this.avatars.useModel(models.survivor);
    this.standIns(true);
    this.compileFor([[this.rig.scene, this.rig.camera]]).catch(() => {});
    this.standIns(false);
  }

  // Build the world for a map (its level, dressing, machines and lamps), replacing
  // the last one. Everything else (enemies, guns, effects) is shared by every map.
  setMap(id) {
    const map = mapById(id);
    if (this.level && this.map === map) return;
    this.level?.dispose();
    this.machines?.dispose();
    this.egg?.dispose?.();
    this.map = map;
    this.rig.setLights(map.LIGHTS, !map.POWER);
    this.rig.setFog(map.fog);
    this.level = new Level(this.rig, this.tex, map, DRESSING[map.id] || DRESSING.bunker);
    this.level.makeToken = () => buildBoxToken();
    this.machines = new MachineProps(this.rig, map);
    const culler = this.level.palace?.culler;
    if (culler) this.machines.sees = (x, y, z, r) => culler.enabled === false || culler.sees(x, y, z, r);
    this.zombies.mapId = map.id;
    this.machines.setCalm(!!this.settings.reduceFlashing);
    this.egg = map.EGG ? new EggProps(this.rig, this.tex, this.models.kintsugi) : null;
    this.world = new World(map);
    if (this.fx) {
      this.fx.world = this.world;
      this.fx.fireAt = map.LIGHTS.filter((l) => l.fire).map((l) => new THREE.Vector3(...l.pos));
    }
    this.boards = map.WINDOWS.map(() => map.MAX_BOARDS);
    this.ready?.then(() => this.compileFor([[this.rig.scene, this.rig.camera]]).catch(() => {}));
  }

  resetState() {
    this.me = null;
    this.players = new Map();  // id -> {name, slot, points, state, row}
    const sp = this.map.PLAYER_SPAWNS[0];
    this.p = {
      x: sp[0], y: 0, z: sp[2], vx: 0, vy: 0, vz: 0, onGround: true, height: 1.75,
      yaw: sp[3], pitch: 0, eye: EYE, eyeSmooth: 0, crouch: 0,
      hp: 100, state: PS.ALIVE, points: 500, grenades: GRENADE.start,
      weapons: [START_WEAPON], cur: START_WEAPON, ammo: {},
      fireT: 0, reloadT: 0, reloadDur: 0, reloadEvents: [], switchT: 0, knifeT: 0, nadeT: 0, nadePending: 0,
      bloom: 0, stamina: 3, sprinting: false, lastStep: 0, recoilPitch: 0, perks: [],
    };
    this.power = !this.map.POWER;
    this.forge = { state: 'idle', owner: null, weapon: null };
    this.pads = (this.map.TELEPORT?.pads || []).map(() => 'ready');
    this.traps = (this.map.TRAPS || []).map(() => 'ready');
    for (const h of this.trapSounds || []) h?.stop?.();
    this.trapSounds = [];
    this.perkUses = {};
    this.jingleT = 12;
    this.hud?.perks([]);
    this.giveAmmo(START_WEAPON);
    this.round = 0;
    this.phase = 'pre';
    this.boxState = { state: 'idle', owner: null, weapon: null };
    this.openDoors = new Set();
    this.boards = this.map.WINDOWS.map(() => this.map.MAX_BOARDS);
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
    this.eggStage = this.map.EGG ? 'cups' : 'none';   // only the bunker has the teacups
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

  // The 1997 look: small-palette world textures and the TV pass, at a strength
  // of 0 (off) to 100. (Models and guns are always the painted low-poly versions.)
  setCrt(strength) {
    const amt = Math.max(0, Math.min(100, Number(strength) || 0)) / 100;
    setRetroTextures(this.tex, amt > 0);
    this.rig.setCrt(amt);
  }

  applySettings(s) {
    this.settings = s;
    this.rig.setQuality(s.quality);
    this.setCrt(s.crt);
    this.audio.setMasterVolume(this.muted ? 0 : s.volume);
    this.audio.setMusicVolume(s.music ?? 0.6);
    this.audio.hrtf = s.hrtf !== false;
    // Accessibility: calmer flashes, less camera and weapon motion.
    this.rig.calm = !!s.reduceFlashing;
    this.zombies.setCalm(!!s.reduceFlashing);
    this.machines?.setCalm(!!s.reduceFlashing);
    this.vm.motion = s.reduceMotion ? 0.2 : 1;
    this.input.setBindings(bindingsOf(s), Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys])));
    this.input.setToggles({ aim: !!s.toggleAim, sprint: !!s.toggleSprint, crouch: !!s.toggleCrouch });
    this.hud.crosshairStyle(s.crosshair, s.crossColor, s.crossDot);
  }

  // The label of the first key bound to an action ('use' -> "F"), for prompts.
  keyName(action) {
    const keys = bindingsOf(this.settings)[action];
    return keys?.length ? keyLabel(keys[0]) : '?';
  }

  setMuted(on) {
    this.muted = !!on;
    this.audio.setMasterVolume(this.muted ? 0 : this.settings.volume);
  }

  // --- Session lifecycle ---------------------------------------------------------------
  start(conn, { name, token, local, map }) {
    this.stop();
    if (map) this.setMap(map);
    this.resetState();
    this.world = new World(this.map);
    this.fx.world = this.world;
    this.conn = conn;
    this.local = !!local;
    this.zombies.interpDelay = local ? 70 : 110;
    this.mode = 'connecting';
    conn.onmessage = (m) => this.onMessage(m);
    conn.onclose = () => { if (this.mode === 'play') this.onEvent({ type: 'disconnected' }); };
    conn.send({ t: 'hello', v: PROTOCOL, token, name });
    this.hud.reset();
    this.freshWorld();
  }

  // A new session's world: boards up, doors shut, the box home, machines dark.
  freshWorld() {
    this.level.resetBoards(this.boards);
    this.level.rebuildDoors();
    this.level.setBox('idle');
    this.level.setBoxSpot(0, true);
    this.egg?.reset(null);
    this.rig.setPower(this.power);
    this.machines.setPower(this.power, true);
    this.machines.setForge('idle');
    this.pads.forEach((st, i) => this.machines.setPad(i, st));
    this.traps.forEach((st, i) => this.machines.setTrap(i, st));
  }

  // Leave the match completely: nothing of it (sounds, timers, enemies, effects)
  // carries into the menu or the next match.
  stop() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    clearTimeout(this.overTimer);
    this.over = null;
    this.bossMusic?.stop?.();
    this.bossMusic = null;
    this.radio?.stop?.();
    this.radio = null;
    this.audio.silence();
    this.zombies.quiet = false;
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
    // A lobby's match may be on another map than the one showing.
    if (m.map && m.map !== this.map.id) {
      this.setMap(m.map);
      this.boards = this.map.WINDOWS.map(() => this.map.MAX_BOARDS);
      this.power = !this.map.POWER;
      this.pads = (this.map.TELEPORT?.pads || []).map(() => 'ready');
      this.traps = (this.map.TRAPS || []).map(() => 'ready');
      this.eggStage = this.map.EGG ? 'cups' : 'none';
      this.freshWorld();
    }
    this.me = m.id;
    this.region = m.region;
    this.matchId = m.match;
    for (const [id, name, slot] of m.players) this.addPlayer(id, name, slot);
    for (const id of m.doors) this.doorOpened(id, true);
    this.boards = m.boards;
    this.level.resetBoards(m.boards);
    if (m.box) {
      this.boxState = m.box;
      this.level.setBoxSpot(m.box.spot || 0, true);
      if (m.box.state !== 'idle') this.level.setBox(m.box.state, m.box.weapon, m.box.owner, this.boxPool());
    }
    if (m.power !== undefined) { this.power = m.power; this.rig.setPower(m.power); this.machines.setPower(m.power, true); }
    if (m.forge) { this.forge = m.forge; this.machines.setForge(m.forge.state, m.forge.weapon); }
    if (m.tele) m.tele.pads.forEach((st, i) => { this.pads[i] = st; this.machines.setPad(i, st); });
    if (m.traps) m.traps.forEach((st, i) => this.onTrap(i, st, true));
    if (m.perkUses) this.perkUses = m.perkUses;
    for (const [id, type, x, y, z] of m.powerups) this.fx.spawnPowerup(id, type, x / 100, y / 100, z / 100);
    if (m.egg && this.egg) { this.eggStage = m.egg.stage; this.egg.reset(m.egg); }
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
    this.audio.startAmbience(this.map.id);
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
        const perks = PERK_IDS.filter((id, i) => (r[19] | 0) & (1 << i));
        if (perks.join() !== this.p.perks.join()) { this.p.perks = perks; this.hud.perks(perks); }
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

  // Server events go to the handler groups in events.js.
  onGameEvent(e) {
    const handlers = this.eventHandlers.get(e[0]);
    if (handlers) for (const fn of handlers) fn.call(this, e, this.me);
  }

  // --- Event handlers ------------------------------------------------------------------------
  onZombieSpawn(z) {
    if (z.state !== ZS.RISE) return;
    const ground = Math.max(0, Math.round((z.y + 1.7) * 10) / 10);   // it rises out of this floor
    this.fx.dirt(z.x, ground, z.z);
    this.audio.zombieSpawn({ x: z.x, y: ground, z: z.z });
  }

  onKill(e) {
    const [, zid, by, kind, x100, y100, z100, ang] = e;
    const z = this.zombies.kill(zid, kind, ang / 100);
    const cls = z ? z.cls : ZC.WALKER;
    lookOf(cls).kill(this, {
      x: x100 / 100, y: y100 / 100, z: z100 / 100, kind, dx: Math.sin(ang / 100), dz: Math.cos(ang / 100),
      mine: by === this.me, seed: z ? z.seed : zid, low: !!(z && z.flags & ZF.CRAWL),
    });
    if (enemy(cls).boss) this.onBossKilled();
  }

  // The Kintsugi fight ends: music, boss bar, the easter egg is done.
  onBossKilled() {
    this.bossMusic?.stop();
    this.bossMusic = null;
    this.bossId = null;
    this.hud.boss(null);
    this.eggStage = 'done';
    this.hud.center(TEXT.bossKilled, TEXT.bossKilledSub, 4500, 'gold');
    this.shake = Math.max(this.shake, 0.5);
  }

  onGive(w, list) {
    const p = this.p;
    p.weapons = list.filter((id) => WEAPONS[id]);
    for (const id of Object.keys(p.ammo)) if (!p.weapons.includes(id) && id !== START_WEAPON) delete p.ammo[id];
    this.giveAmmo(w);
    this.switchTo(w);
  }

  onBoard(id, count, repaired) {
    const w = this.map.WINDOWS[id];
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

  boxPool() { return Object.keys(this.map.BOX_POOL || BOX_POOL); }

  onBox(e) {
    const kind = e[1];
    const B = this.level.boxSpotPos();
    const pos = { x: B[0], y: B[1] + 0.5, z: B[2] };
    if (kind === 'open') {
      this.boxState = { state: 'rolling', owner: e[2], weapon: e[3] };
      this.level.setBox('rolling', e[3], e[2], this.boxPool());
      this.audio.boxOpen(pos);
      this.audio.boxJingle(pos, 4.2);
    } else if (kind === 'ready') {
      this.boxState = { state: 'ready', owner: e[2], weapon: e[3] };
      this.level.setBox('ready', e[3], e[2]);
      this.audio.boxReady({ ...pos, y: pos.y + 0.3 });
    } else if (kind === 'leave') {
      // A toy instead of a gun: the box is about to move.
      this.boxState = { state: 'leaving', owner: e[2], weapon: null };
      this.level.setBox('leaving', null, e[2], this.boxPool());
      this.audio.boxOpen(pos);
      this.audio.boxJingle(pos, 3.2);
      setTimeout(() => { if (this.boxState.state === 'leaving') this.audio.boxLeave(pos); }, 3200);
    } else if (kind === 'fly') {
      this.boxState = { state: 'moving', owner: null, weapon: null };
      this.level.setBox('moving');
      this.caption('box', SOUND_CAPTIONS.boxFly, pos.x, pos.z);
      if (e[2] === undefined && this.boxState) this.hud.center(TEXT.boxMoved, '', 2200);
    } else if (kind === 'move') {
      this.boxState = { state: 'idle', owner: null, weapon: null };
      this.level.setBoxSpot(e[2]);
      this.level.setBox('idle');
      const N = this.level.boxSpotPos();
      setTimeout(() => this.audio.boxLand({ x: N[0], y: N[1] + 0.3, z: N[2] }), 500);
    } else {
      this.boxState = { state: 'idle', owner: null, weapon: null };
      this.level.setBox('idle');
    }
  }

  // A Spark Gate changes: its switch lamps, its arcs and their buzz.
  onTrap(i, state, quiet = false) {
    this.traps[i] = state;
    this.machines.setTrap(i, state);
    const T = this.map.TRAPS?.[i];
    if (!T) return;
    if (state === 'active' && !this.trapSounds[i] && !quiet) {
      const [a, b] = [T.gate.a, T.gate.b];
      this.trapSounds[i] = this.audio.trap({ x: (a[0] + b[0]) / 2, y: a[1] + 1.2, z: (a[2] + b[2]) / 2 });
    } else if (state !== 'active' && this.trapSounds[i]) {
      this.trapSounds[i].stop();
      this.trapSounds[i] = null;
    }
  }

  // A caption for a sound, with an arrow toward it (relative to where the player
  // faces). Each kind shows at most every 1.8 s so a horde does not flood the screen.
  caption(key, text, x, z) {
    if (!this.settings.captions || this.mode !== 'play') return;
    const now = performance.now(), last = (this._capT ||= {});
    if (now - (last[key] || 0) < 1800) return;
    last[key] = now;
    let arrow = '';
    if (x != null) {
      const dx = x - this.p.x, dz = z - this.p.z, s = Math.sin(this.p.yaw), c = Math.cos(this.p.yaw);
      const ahead = -dx * s - dz * c, right = dx * c - dz * s;
      arrow = ARROWS[((Math.round(Math.atan2(right, ahead) / (Math.PI / 4)) % 8) + 8) % 8];
    }
    this.hud.caption(text, arrow);
  }

  onPowerup(id, type, pid) {
    this.fx.removePowerup(id);
    if (type === 'goldleaf' && this.audio.goldLeaf) this.audio.goldLeaf();
    else this.audio.powerupGrab(type);
    if (!this.muted) this.audio.announce(powerupName(type));
    this.hud.center(powerupName(type), '', 1800);
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
    // The world goes quiet behind the game-over sting: no heartbeat, wind or groans.
    this.audio.stopAmbience(3);
    this.radio?.stop?.();
    this.radio = null;
    this.zombies.quiet = true;
    this.audio.gameOver();
    this.hud.center('Game over', `You survived ${round} round${round === 1 ? '' : 's'}`, 6000);
    clearTimeout(this.overTimer);
    this.overTimer = setTimeout(() => { if (this.over) this.onEvent({ type: 'over', over: this.over }); }, 3500);
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
      const d = this.map.DOORS.find((q) => q.id === id);
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
    this.audio.gunshot(W.sound, { x: muzzle.x, y: muzzle.y, z: muzzle.z }, !!W.upgradeOf);
    if (W.cone) { this.fx.gust?.(muzzle, d, W.cone.reach, W.cone.angle); return; }
    if (W.projectile || W.chain) return;   // their own events draw them ('proj', 'chain')
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
    const dur = W.reload * perkMult(p.perks, 'reloadMult');
    p.reloadT = dur;
    p.reloadDur = dur;
    const style = reloadStyle(W);
    this.vm.reload(dur, style);
    p.reloadEvents = reloadCues(style).map(([u, s]) => ({ at: dur * u, s }));
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
    if (p.switchT > 0 || p.reloadT > 0 || p.fireT > 0 || p.knifeT > 0.3 || p.nadePending > 0 || this.vm.drinking) return;
    if (p.sprinting) { p.sprinting = false; }
    if (a.mag <= 0) {
      if (I.hit('Mouse0')) this.audio.dryFire();
      if (a.res > 0) this.reload();
      return;
    }
    a.mag--;
    p.fireT = shotInterval(p.cur) / perkMult(p.perks, 'rateMult');
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
    this.vm.fire(p.cur, p.ammo[p.cur]?.mag ?? 1);
    this.audio.gunshot(W.sound, null, !!W.upgradeOf);
    if (W.cone) this.rig.muzzleFlash(muzzle, 0.5, 0xdfe8ff, 0.06);
    else if (W.kind === 'wonder') this.rig.muzzleFlash(muzzle, W.chain ? 1.6 : 0.4, 0x8fd8ff, W.chain ? 0.1 : 0.05);
    else this.rig.muzzleFlash(muzzle, 1);
    p.recoilPitch += W.kick * (1 - ads * 0.5) * 0.9;
    if (W.projectile) {
      this.conn.send({ t: 'proj', w: p.cur, o: [o.x + _dir.x * 0.4, o.y + _dir.y * 0.4 - 0.05, o.z + _dir.z * 0.4], d: [_dir.x, _dir.y, _dir.z] });
      return;
    }
    if (W.chain) return this.fireChain(W, o, _dir, muzzle);
    if (W.cone) return this.fireCone(W, o, _dir, muzzle);
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
      this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw, fl) => {
        if (Math.abs(zx - o.x) > W.range || Math.abs(zz - o.z) > W.range) return;
        const h = enemyHitTest(cls, o.x, o.y, o.z, ux, uy, uz, zx, zy, zz, yaw, wallT, fl);
        if (h) zh.push([h.t, id, h.part]);
      });
      zh.sort((q, r2) => q[0] - r2[0]);
      // A teacup in the line of fire (only the first pellet can claim one).
      if (k === 0 && this.egg && this.eggStage === 'cups') {
        const cup = this.egg.hitTest(o.x, o.y, o.z, ux, uy, uz, Math.min(wallT, zh.length ? zh[0][0] : Infinity));
        if (cup >= 0) this.conn.send({ t: 'cup', i: cup, o: [o.x, o.y, o.z], d: [ux, uy, uz] });
      }
      const maxPen = 1 + (W.penetrate || 0);
      let endT = wallT;
      for (let i = 0; i < Math.min(maxPen, zh.length); i++) {
        const [t, id, part] = zh[i];
        hits.push([id, part]);
        const hx = o.x + ux * t, hy = o.y + uy * t, hz = o.z + uz * t;
        lookOf(this.zombies.get(id)?.cls).hit(this, hx, hy, hz, [ux, uy, uz], part);
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

  // Chain lightning: claim the enemy nearest the aim line (W.chain.aim metres of
  // forgiveness, never through walls) and draw the first bolt at once. The server
  // picks the hops and sends the whole path back (onChain).
  fireChain(W, o, d, muzzle) {
    const wallT = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, W.range);
    let best = null, bs = Infinity;
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw, fl) => {
      const my = zy + enemyFor(cls, fl).mid;
      const vx = zx - o.x, vy = my - o.y, vz = zz - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t < 0.3 || t > W.range) return;
      const direct = enemyHitTest(cls, o.x, o.y, o.z, d.x, d.y, d.z, zx, zy, zz, yaw, wallT, fl);
      const off = direct ? 0 : Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t);
      if (off > W.chain.aim + t * 0.02) return;
      const score = off + t * 0.01;   // direct hits first, then whoever is nearest the line
      if (score >= bs || (!direct && !this.world.lineOfSight(o.x, o.y, o.z, zx, my, zz))) return;
      bs = score;
      best = [id, zx, my, zz];
    });
    if (this.egg && this.eggStage === 'cups') {
      const cup = this.egg.hitTest(o.x, o.y, o.z, d.x, d.y, d.z, wallT);
      if (cup >= 0) this.conn.send({ t: 'cup', i: cup, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] });
    }
    const from = [muzzle.x, muzzle.y, muzzle.z];
    const to = best ? best.slice(1) : [o.x + d.x * wallT, o.y + d.y * wallT, o.z + d.z * wallT];
    this.chainClaim = best ? best[0] : 0;
    this.fx.chain(2, (i) => (i ? to : from), 0, (i, b) => this.audio.zap({ x: b[0], y: b[1], z: b[2] }, 0));
    this.conn.send({ t: 'fire', w: this.p.cur, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], h: best ? [[best[0], 1]] : [] });
  }

  // A blast of air: the server decides who it flings; the shooter sees the gust at once.
  fireCone(W, o, d, muzzle) {
    this.fx.gust?.(muzzle, d, W.cone.reach, W.cone.angle);
    this.shake = Math.max(this.shake, 0.35);
    this.conn.send({ t: 'fire', w: this.p.cur, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], h: [] });
  }

  // The server's chain-lightning path: bolts fork enemy to enemy, `delay` apart,
  // following each enemy while it still stands. The local shooter already drew
  // the first bolt when it claimed the same enemy (or hit nothing).
  onChain(e, me) {
    const [, pid, w, ids, pts, from] = e;
    const C = WEAPONS[w]?.chain;
    if (!C || !Array.isArray(ids) || !Array.isArray(pts) || pts.length < 6) return;
    const P = [];
    for (let i = 0; i + 2 < pts.length; i += 3) P.push([pts[i] / 100, pts[i + 1] / 100, pts[i + 2] / 100]);
    const mine = pid === me;
    const m = mine ? this.vm.muzzleWorld(this.rig.camera, _v2) : this.avatars.muzzlePos(pid, _v2);
    if (m) P[0] = [m.x, m.y, m.z];
    const at = (i) => {
      const z = i > 0 ? this.zombies.get(ids[i - 1]) : null;
      return z ? [z.x, z.y + enemyFor(z.cls, z.flags).mid, z.z] : P[i];
    };
    const skip = mine && (!ids.length || ids[0] === this.chainClaim) ? 1 : 0;
    this.fx.chain(P.length, at, C.delay, (i, b) => this.audio.zap({ x: b[0], y: b[1], z: b[2] }, i), skip, Array.isArray(from) ? from : null);
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
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw, fl) => {
      const dx = zx - p.x, dz = zz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(zy - p.y) > 1.3 || st === ZS.RISE) return;
      const dot = (dx * _dir.x + dz * _dir.z) / (d * Math.hypot(_dir.x, _dir.z) || 1);
      if (dot < 0.55 && d > 0.6) return;
      best = { id, zx, zy, zz, cls, fl }; bd = d;
    });
    if (best) {
      const fy = best.zy + enemyFor(best.cls, best.fl).fxY;
      this.fx.blood(best.zx, fy, best.zz, _dir.x, 0.2, _dir.z, 1.2);
      this.audio.knifeHit({ x: best.zx, y: fy, z: best.zz });
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
      if (near(pl.x, pl.y, pl.z, 1.6)) return { kind: 'revive', hold: true, label: TEXT.revive(this.keyName('use'), escapeHtml(pl.name)), short: `Revive ${pl.name}`, pl };
    }
    const M = this.map, key = this.keyName('use');
    const zones = M.openZones(this.openDoors);   // the same rule as the server's
    const B = M.BOX_SPOTS[this.level.box.spot] || M.BOX_SPOTS[0];
    if (zones.has(B.zone) && near(B.pos[0], B.pos[1], B.pos[2], 2.1)) {
      const bs = this.boxState;
      if (bs.state === 'ready' && bs.owner === this.me) return { kind: 'boxTake', label: TEXT.boxTake(key, WEAPONS[bs.weapon].name), short: `Take ${WEAPONS[bs.weapon].name}` };
      if (bs.state === 'idle') return { kind: 'box', label: TEXT.box(key, BOX_COST), short: `Mystery box · ${BOX_COST}`, cost: BOX_COST };
    }
    const machine = this.machineTarget(near, zones, key);
    if (machine) return machine;
    for (const wb of M.WALL_BUYS) {
      const fy = wb.pos[1] - 1.55;
      if (!near(wb.pos[0], fy, wb.pos[2], 1.7)) continue;
      const facing = -(_dir.x * wb.face[0] + _dir.z * wb.face[1]);
      if (facing < 0.2) continue;
      const W = WEAPONS[wb.weapon];
      const price = WALL_PRICES[wb.weapon];
      const up = `${wb.weapon}_up`;
      if (p.weapons.includes(up)) {
        return { kind: 'wall', id: wb.id, label: TEXT.buyAmmo(this.keyName('use'), WEAPONS[up].name, UPGRADED_AMMO), short: `Ammo · ${UPGRADED_AMMO}`, cost: UPGRADED_AMMO };
      }
      if (p.weapons.includes(wb.weapon)) {
        return { kind: 'wall', id: wb.id, label: TEXT.buyAmmo(this.keyName('use'), W.name, Math.round(price / 2)), short: `Ammo · ${Math.round(price / 2)}`, cost: Math.round(price / 2) };
      }
      return { kind: 'wall', id: wb.id, label: TEXT.buyGun(this.keyName('use'), W.name, price), short: `${W.name} · ${price}`, cost: price };
    }
    for (const d of M.DOORS) {
      if (this.openDoors.has(d.id) || d.hidden || !d.use.length) continue;
      if (d.use.some((u) => near(u[0], u[1], u[2], 2.3))) {
        const verb = d.kind === 'door' ? 'open the door' : 'clear the debris';
        return { kind: 'door', id: d.id, label: TEXT.openDoor(this.keyName('use'), verb, d.cost), short: `${d.kind === 'door' ? 'Open door' : 'Clear debris'} · ${d.cost}`, cost: d.cost };
      }
    }
    for (const w of M.WINDOWS) {
      if (this.boards[w.id] >= M.MAX_BOARDS) continue;
      if (near(w.repair[0], w.repair[1], w.repair[2], 1.3)) return { kind: 'repair', hold: true, label: TEXT.rebuild(this.keyName('use')), short: 'Hold to rebuild' };
    }
    if (M.RADIO && near(M.RADIO.pos[0], 0, M.RADIO.pos[2], 1.6)) return { kind: 'radio', label: '', short: 'Radio' };
    // The figurine only answers once all three teacups are broken.
    if (M.EGG && this.eggStage === 'ready') {
      const f = M.EGG.figurine.pos;
      if (near(f[0], 0, f[2], 2.0)) return { kind: 'egg', label: TEXT.figurine(this.keyName('use')), short: 'Touch the figurine' };
    }
    return null;
  }

  // The machines: perks, the breaker, the Forge, the teleporter and the Spark Gates.
  machineTarget(near, zones, key) {
    const M = this.map, p = this.p;
    const off = { label: TEXT.needPower, short: 'No power' };
    if (M.POWER && !this.power && zones.has(M.POWER.zone) && near(...M.POWER.use, 1.6)) {
      return { kind: 'power', label: TEXT.power(key), short: 'Throw the breaker' };
    }
    for (const m of M.PERKS || []) {
      if (!zones.has(m.zone) || !near(...m.use, 1.4)) continue;
      const P = PERKS[m.perk];
      if (!this.power) return { kind: 'none', ...off };
      if (p.perks.includes(m.perk)) return null;
      const solo = this.players.size <= 1;
      if (solo && P.solo && (this.perkUses[m.perk] || 0) >= P.solo.uses) return null;
      const cost = perkCost(m.perk, solo);
      return { kind: 'perk', id: m.perk, label: TEXT.perk(key, P.name, cost), short: `${P.name} · ${cost}`, cost };
    }
    const F = M.FORGE;
    if (F && zones.has(F.zone) && near(...F.use, 1.7)) {
      if (!this.power) return { kind: 'none', ...off };
      const fs = this.forge;
      if (fs.state === 'ready' && fs.owner === this.me) return { kind: 'forgeTake', label: TEXT.boxTake(key, WEAPONS[fs.weapon].name), short: `Take ${WEAPONS[fs.weapon].name}` };
      if (fs.state !== 'idle') return { kind: 'none', label: TEXT.forgeBusy, short: 'The Forge is working' };
      const up = upgradedId(p.cur);
      if (!up) return { kind: 'none', label: TEXT.forgeNo, short: 'Already forged' };
      if (p.weapons.length < 2) return { kind: 'none', label: TEXT.forgeSpare, short: 'Carry a second gun' };
      return { kind: 'forge', label: TEXT.forge(key, WEAPONS[p.cur].name, FORGE_COST), short: `Forge · ${FORGE_COST}`, cost: FORGE_COST };
    }
    const TP = M.TELEPORT;
    if (TP) {
      if (zones.has(TP.core.zone) && near(...TP.core.use, 1.6) && this.pads.some((s) => s === 'lever')) {
        return { kind: 'link', id: 'core', label: TEXT.coreLink(key), short: 'Link the teleporter' };
      }
      for (let i = 0; i < TP.pads.length; i++) {
        const pad = TP.pads[i], st = this.pads[i];
        if (!zones.has(pad.zone)) continue;
        if (near(...pad.pos, pad.radius + 0.1)) {
          if (!this.power) return { kind: 'none', ...off };
          if (st === 'linked') return { kind: 'tele', id: pad.id, label: TEXT.teleRide(key, TP.cost), short: `Teleport · ${TP.cost}`, cost: TP.cost };
        }
        if (near(...pad.use, 1.3)) {
          if (!this.power) return { kind: 'none', ...off };
          if (st === 'ready') return { kind: 'link', id: pad.id, label: TEXT.padLever(key), short: 'Pull the lever' };
          if (st === 'lever') return { kind: 'none', label: TEXT.padWaiting, short: 'Link it at the lantern' };
          if (st === 'cooldown') return { kind: 'none', label: TEXT.padCooling, short: 'Cooling down' };
        }
      }
    }
    for (let i = 0; i < (M.TRAPS || []).length; i++) {
      const T = M.TRAPS[i];
      if (!zones.has(T.zone) || !near(...T.switch.use, 1.4)) continue;
      if (!this.power) return { kind: 'none', ...off };
      if (this.traps[i] === 'ready') return { kind: 'trap', id: T.id, label: TEXT.trap(key, T.cost), short: `Spark Gate · ${T.cost}`, cost: T.cost };
      return { kind: 'none', label: this.traps[i] === 'active' ? '' : TEXT.trapCooling, short: 'Spark Gate' };
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
      if (t.kind === 'none') { /* a label only */ }
      else if (t.kind === 'radio') this.conn.send({ t: 'radio' });
      else if (t.kind === 'egg') this.conn.send({ t: 'egg' });
      else if (t.kind === 'box') this.conn.send({ t: 'buy', k: 'box' });
      else if (t.kind === 'boxTake') this.conn.send({ t: 'buy', k: 'boxTake' });
      else this.conn.send({ t: 'buy', k: t.kind, id: t.id });
    }
    // Revive progress bar.
    if (t?.kind === 'revive' && this.input.down('KeyF')) this.hud.revive(`Reviving ${t.pl.name}…`, (t.pl.revive || 0) / 100);
    else if (this.p.state === PS.DOWN && this.myRevive > 0) this.hud.revive(this.players.size <= 1 ? 'Getting back up…' : 'Being revived…', this.myRevive / 100);
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
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw, fl) => {
      if (st === ZS.RISE) return;
      const aimY = enemyFor(cls, fl).aimY;
      const vx = zx - o.x, vy = zy + aimY - o.y, vz = zz - o.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > 28 || d < 0.5) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * _dir.x + vy * _dir.y + vz * _dir.z) / d)));
      if (ang >= bestAng) return;
      if (!this.world.lineOfSight(o.x, o.y, o.z, zx, zy + aimY, zz)) return;
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
    this.zombies.forEachTarget((id, zx, zy, zz, st, cls, yaw, fl) => {
      if (hit || st === ZS.RISE) return;
      if (enemyHitTest(cls, o.x, o.y, o.z, _dir.x, _dir.y, _dir.z, zx, zy, zz, yaw, wall, fl)) hit = true;
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
      p.yaw -= I.mouse.dx * LOOK_SCALE * S.sensitivity * zoom * friction;
      p.pitch -= I.mouse.dy * LOOK_SCALE * S.sensitivity * zoom * friction * (S.invert ? -1 : 1);
      p.yaw += I.lookRad.yaw;
      p.pitch += I.lookRad.pitch * (S.invert ? -1 : 1);
      if (assist) { p.yaw += assist.dyaw; p.pitch += assist.dpitch; }
      p.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p.pitch));
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
    const crouchKey = active && I.crouchHeld();
    p.crouch += ((crouchKey || down ? 1 : 0) - p.crouch) * Math.min(1, dt * 10);
    const W = WEAPONS[p.cur];
    const ads = active && I.aiming() && !down;
    if (fz >= 0) I.endSprint();
    p.sprinting = active && !down && I.sprintHeld() && fz < 0 && !ads && p.stamina > 0 && p.reloadT <= 0;
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - dt);
    else p.stamina = Math.min(4, p.stamina + dt * (I.sprintHeld() ? 0.3 : 0.9));
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
      if (p.lastStep > (p.sprinting ? 2.4 : 1.9)) { p.lastStep = 0; this.audio.footstep('wood'); }
    }

    // Camera.
    const eye = down ? DOWN_EYE : EYE - p.crouch * (EYE - CROUCH_EYE);
    p.eye += (eye - p.eye) * Math.min(1, dt * 12);
    p.recoilPitch *= Math.exp(-dt * 9);
    const still = S.reduceMotion ? 0 : 1;
    const bob = still * (p.onGround ? Math.sin(performance.now() / 1000 * (p.sprinting ? 13 : 9)) * 0.025 * Math.min(1, hs / WALK) * (1 - this.vm.ads) : 0);
    const shake = still * this.shake * this.shake;
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
    const fovTarget = baseFov + (adsFov - baseFov) * this.vm.ads + (p.sprinting ? 5 * still : 0);
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
    this.egg?.update(dt);
    this.machines.update(dt, this.time);
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
    this.vm.setRounds(a.mag);
    this.vm.update(dt, this.vmState);
    this.hud.setAmmo(W ? W.name : '', a.mag, a.res, W ? W.mag : 1);
    this.hud.setGrenades(p.grenades);
    this.hud.crosshair(this.crossSpread, this.vm.ads < 0.4 && p.state !== PS.DEAD && !p.sprinting);
    this.hud.powerups(this.insta, this.dbl);
    const low = p.state === PS.ALIVE ? Math.max(0, 1 - p.hp / 60) : p.state === PS.DOWN ? 0.9 : 0;
    this.hurtLevel = Math.max(low, this.hurtLevel - dt * 0.8);
    this.hud.hurt(this.hurtLevel);
    this.audio.setHeartbeat(this.over ? 0 : p.state === PS.ALIVE ? Math.max(0, 1 - p.hp / 45) : p.state === PS.DOWN ? 0.8 : 0);
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
    this.perkJingles(dt);
    const EGG = this.map.EGG;
    if (!EGG) return;
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
        this.caption('chime', SOUND_CAPTIONS.chime, f[0], f[2]);
      }
    }
  }

  // Powered perk machines play their tune now and then to whoever is close.
  perkJingles(dt) {
    if (!this.power || !this.map.PERKS) return;
    this.jingleT -= dt;
    if (this.jingleT > 0) return;
    this.jingleT = 30 + Math.random() * 40;
    const p = this.p;
    const m = this.map.PERKS.find((q) => Math.hypot(q.pos[0] - p.x, q.pos[2] - p.z) < 10 && Math.abs(q.pos[1] - p.y) < 2);
    if (!m) return;
    this.audio.perkJingle(m.perk, { x: m.pos[0], y: m.pos[1] + 1.6, z: m.pos[2] });
    this.caption('jingle', SOUND_CAPTIONS.jingle, m.pos[0], m.pos[2]);
  }

  attract(dt) {
    const cam = this.rig.camera;
    const t = this.time * 0.05;
    const A = this.map.attract || { center: [0, 2, 0], radius: 20, height: 6 };
    const [cx, cy, cz] = A.center, r = A.radius;
    cam.position.set(cx + Math.cos(t) * r, A.height + Math.sin(t * 0.7) * 1.5, cz + Math.sin(t) * r);
    cam.lookAt(cx, cy, cz);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }

  render() {
    const r = this.rig.renderer;
    const S = this.settings;
    r.toneMappingExposure = 1.15 * (S.brightness ?? 1) + (this.flashWhite || 0) * (S.reduceFlashing ? 0.6 : 4);
    this.rig.beginFrame();
    r.render(this.rig.scene, this.rig.camera);
    if (this.mode === 'play' && this.p.state !== PS.DEAD) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
    this.rig.endFrame();
  }
}

function round3(v) { return Math.round(v * 1000) / 1000; }
