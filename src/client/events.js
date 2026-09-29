// Server events -> what the client shows and plays. Handlers are grouped by what
// they belong to (the core game, the hound rounds, the Kintsugi easter egg), so a
// new mode or encounter registers its own group instead of growing one switch.
// Each handler runs with `this` as the Game: handler(e, me), where e is the event
// array exactly as GameSim.emit() built it and me is the local player's id.
// Several groups may handle the same event type; they run in registration order.

import { WEAPONS, GRENADE_BLAST } from '../shared/weapons.js';
import { ZC, ZF, KILL, PLAYER_COLORS } from '../shared/protocol.js';
import { PERKS } from '../shared/perks.js';
import { lookOf } from './enemy-looks.js';
import { TEXT, SOUND_CAPTIONS } from './text.js';

export const CORE_EVENTS = {
  join(e, me) {
    this.addPlayer(e[1], e[2], e[3]);
    if (e[1] !== me && this.mode === 'play') this.hud.center(TEXT.joined(e[2]), '', 1800);
  },
  leave(e, me) {
    const pl = this.players.get(e[1]);
    this.avatars.remove(e[1]);
    this.hud.removePlayer(e[1]);
    this.players.delete(e[1]);
    if (pl && e[1] !== me) this.hud.center(TEXT.left(pl.name), '', 1800);
  },
  shot(e, me) { if (e[1] !== me) this.remoteShot(e); },
  chain(e, me) { this.onChain(e, me); },
  proj(e, me) {
    this.fx.projectile(e[1], e[3], e[4] / 100, e[5] / 100, e[6] / 100, e[7] / 100, e[8] / 100, e[9] / 100);
    if (e[2] !== me) this.remoteShot([0, e[2], e[3], e[4], e[5], e[6], e[7] * 10, e[8] * 10, e[9] * 10]);
  },
  boom(e) {
    const x = e[1] / 100, y = e[2] / 100, z = e[3] / 100;
    if (e[4] === 'nade') this.fx.removeGrenade(e[5]); else this.fx.removeProjectile(e[5]);
    const B = WEAPONS[e[4]]?.projectile || GRENADE_BLAST;
    this.fx.explosion(x, y, z, B.blast);
    if (B.blast === 'arc') this.audio.gunshot('arc', { x, y, z }); else this.audio.explosion({ x, y, z });
    const d = Math.hypot(x - this.p.x, y - this.p.y, z - this.p.z);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / 14) * B.shake);
  },
  nade(e, me) {
    this.fx.throwGrenade(e[1], e[3] / 100, e[4] / 100, e[5] / 100, e[6] / 100, e[7] / 100, e[8] / 100);
    if (e[2] === me) this.p.grenades = e[9];
  },
  knife(e, me) { if (e[1] !== me && this.players.get(e[1])) this.audio.knifeSwing(); },
  kill(e) { this.onKill(e); },
  // A blast took a zombie's legs: it drops and crawls from now on.
  crip(e) {
    const z = this.zombies.get(e[1]);
    if (!z) return;
    z.flags |= ZF.CRAWL;
    lookOf(z.cls).cripple?.(this, z);
  },
  pts(e, me) {
    const pl = this.players.get(e[1]);
    if (pl) { pl.points = e[3]; this.hud.setPlayer(e[1], pl.name, pl.slot, e[3], e[1] === me); this.hud.popPoints(e[1], e[2]); }
    if (e[1] === me) { this.p.points = e[3]; if (e[2] < 0) this.audio.purchase(); }
  },
  deny(e, me) { if (e[1] === me) { this.audio.denied(); this.denyT = 1.2; } },
  give(e, me) { if (e[1] === me) this.onGive(e[2], e[3].split(',')); },
  ammo(e, me) { if (e[1] === me) { const W = WEAPONS[e[2]]; this.p.ammo[e[2]] = { mag: W.mag, res: W.reserve }; } },
  door(e) { this.doorOpened(e[1], false); },
  board(e) { this.onBoard(e[1], e[2], e[3]); },
  box(e) { this.onBox(e); },
  pu(e) {
    this.fx.spawnPowerup(e[1], e[2], e[3] / 100, e[4] / 100, e[5] / 100);
    this.audio.powerupSpawn({ x: e[3] / 100, y: e[4] / 100, z: e[5] / 100 });
  },
  pug(e) { this.onPowerup(e[1], e[2], e[3]); },
  pux(e) { this.fx.removePowerup(e[1]); },
  hurt(e, me) { if (e[1] === me) this.onHurt(e[2], e[3] / 100, e[4] / 100); },
  down(e, me) {
    const pl = this.players.get(e[1]);
    if (e[1] !== me && pl) this.hud.center(TEXT.down(pl.name), TEXT.reviveHint(this.keyName('use')), 2500);
  },
  revived(e, me) { if (e[1] === me) this.hud.downed(false); },
  respawn(e, me) { if (e[1] === me) this.respawn(e[2] / 100, e[3] / 100, e[4] / 100); },
  round(e) {
    this.round = e[1];
    this.hud.setRound(e[1], true);
    this.audio.roundStart(e[1]);
  },
  rend(e) { if (!e[2]) this.audio.roundEnd(e[1]); },   // special rounds play their own end
  zatk(e) {
    const z = this.zombies.get(e[1]);
    if (!z) return;
    const kind = lookOf(z.cls).attack(this, z);
    this.caption(kind, SOUND_CAPTIONS[kind], z.x, z.z);
  },
  chat(e) {
    const pl = this.players.get(e[1]);
    if (pl) this.hud.chat(pl.name, e[2], PLAYER_COLORS[pl.slot % 4]);
  },
  radio() {
    const R = this.map.RADIO;
    if (!R) return;
    this.radio?.stop?.();
    this.radio = this.audio.radioSong({ x: R.pos[0], y: R.pos[1], z: R.pos[2] });
  },
  over(e) { this.onOver(e[1], e[2]); },
};

// Hound rounds: fog and dimmed bulbs, lightning where each hound warps in.
export const HOUND_EVENTS = {
  hounds() {
    this.rig.setDread(true);
    this.audio.houndRoundStart();
    this.hud.center(TEXT.houndsTitle, TEXT.houndsSub, 3600, 'dread');
    this.shake = Math.max(this.shake, 0.2);
  },
  strike(e) {
    const x = e[1] / 100, y = e[2] / 100, z = e[3] / 100;
    this.fx.lightning(x, y, z);
    this.caption('strike', SOUND_CAPTIONS.strike, x, z);
    this.audio.lightning({ x, y: y + 1, z });
    const d = Math.hypot(x - this.p.x, z - this.p.z);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / 12) * 0.35);
  },
  rend(e) {
    if (!e[2]) return;
    this.rig.setDread(false);
    this.audio.houndRoundEnd(e[1]);
  },
};

// The Kintsugi easter egg: teacups, the figurine, then the porcelain boss.
export const KINTSUGI_EVENTS = {
  zspawn(e) {
    if (e[2] !== ZC.KINTSUGI) return;
    this.hud.center(TEXT.bossTitle, TEXT.bossSub, 4200, 'gold');
    if (!this.bossMusic) this.bossMusic = this.audio.bossMusic() || null;
    this.caption('music', SOUND_CAPTIONS.music);
  },
  cup(e) {
    const pos = this.egg?.breakCup(e[1]);
    if (!pos) return;
    this.fx.porcelain(pos[0], pos[1] + 0.06, pos[2], 0.25, 0.35);
    this.audio.teacupBreak({ x: pos[0], y: pos[1], z: pos[2] }, e[1]);
    this.caption('cup', SOUND_CAPTIONS.cup, pos[0], pos[2]);
  },
  egg(e) {
    if (!this.egg) return;
    const f = this.map.EGG.figurine.pos;
    const fp = { x: f[0], y: f[1] + 0.15, z: f[2] };
    if (e[1] === 'ready') {
      this.eggStage = 'ready';
      this.egg.setStage('ready');
      this.audio.figurineChime(fp);
      this.chimeT = 2.7;
    } else if (e[1] === 'wake') {
      this.eggStage = 'awake';
      this.egg.setStage('awake');
      this.fx.porcelain(fp.x, fp.y, fp.z, 0.5, 0.5);
      this.audio.figurineWake(fp);
      this.hud.center(TEXT.eggWake, '', 3000, 'gold');
      this.flashWhite = Math.max(this.flashWhite || 0, 0.25);
    }
  },
  kshatter(e) {
    const x = e[2] / 100, y = e[3] / 100, z = e[4] / 100;
    this.fx.porcelain(x, y + 1.0, z, 1.2, 1.3);
    this.audio.bossShatter({ x, y: y + 1, z });
  },
  kreform(e) {
    const x = e[2] / 100, y = e[3] / 100, z = e[4] / 100;
    this.fx.reform(x, y, z);
    this.audio.bossReform({ x, y: y + 1, z });
  },
  kstage(e) {
    const z = this.zombies.get(e[1]);
    if (!z) return;
    this.fx.porcelain(z.x, z.y + 1.4, z.z, 0.6, 0.8);
    this.audio.bossScream({ x: z.x, y: z.y + 1.6, z: z.z });
  },
};

// The building's machines (maps with a breaker): power, perks, the Forge, the Magic
// Lantern and the Spark Gates.
export const MACHINE_EVENTS = {
  power() {
    this.power = true;
    const B = this.map.POWER?.pos;
    this.rig.setPower(true, B ? this.rig.camera.position.clone().set(B[0], B[1], B[2]) : null);
    this.machines.setPower(true);
    this.audio.powerOn();
    this.hud.center(TEXT.powerOn, TEXT.powerOnSub, 3200);
    this.caption('power', SOUND_CAPTIONS.power);
    this.shake = Math.max(this.shake, 0.25);
  },
  perk(e, me) {
    const [, pid, perk] = e;
    if (!perk) return;   // perks lost (down): the snapshot clears the HUD
    this.machines.vend(perk);
    const m = this.map.PERKS?.find((q) => q.perk === perk);
    if (pid === me) {
      this.audio.perkDrink();
      this.vm.drink(perk);
      this.p.reloadT = 0;
      this.hud.center(PERKS[perk].name, PERKS[perk].blurb, 2600);
      if (perk === 'lazarus' && this.players.size <= 1) this.perkUses.lazarus = (this.perkUses.lazarus || 0) + 1;
    }
    if (m) this.caption('vend', SOUND_CAPTIONS.vend, m.pos[0], m.pos[2]);
  },
  forge(e, me) {
    const [, state, pid, gun] = e;
    this.forge = { state, owner: pid || null, weapon: state === 'ready' ? gun : null };
    const F = this.map.FORGE;
    const pos = F && { x: F.pos[0], y: F.pos[1] + 1.2, z: F.pos[2] };
    this.machines.setForge(state, gun || null);
    if (state === 'working') { this.audio.forge('take', pos); setTimeout(() => this.audio.forge('work', pos), 250); this.caption('forge', SOUND_CAPTIONS.forge, pos.x, pos.z); }
    else if (state === 'ready') { this.audio.forge('done', pos); if (pid === me) this.hud.center(TEXT.forgeReady(this.keyName('use')), '', 2400, 'gold'); }
  },
  tele(e) {
    const [, what, i] = e;
    const TP = this.map.TELEPORT;
    if (!TP) return;
    const pad = TP.pads[i];
    const at = (p) => ({ x: p[0], y: p[1] + 1, z: p[2] });
    if (what === 'lever') {
      this.pads[i] = 'lever';
      this.audio.teleport('link', at(pad.use));
      this.hud.center(TEXT.padLeverDone, '', 2600);
    } else if (what === 'linked') {
      this.pads[i] = 'linked';
      this.audio.teleport('linked', at(TP.core.pos));
      this.hud.center(TEXT.padLinked, '', 2400);
    } else if (what === 'unlinked' || what === 'ready') {
      this.pads[i] = 'ready';
    } else if (what === 'fire') {
      this.pads[i] = 'cooldown';
      this.machines.firePad(i);
      this.audio.teleport('warp', at(pad.pos));
      this.caption('teleport', SOUND_CAPTIONS.teleport, pad.pos[0], pad.pos[2]);
    } else if (what === 'return') {
      this.machines.firePad(i);
      this.audio.teleport('return', at(TP.core.pad));
    } else if (what === 'reveal') {
      this.hud.center(TEXT.curtain, TEXT.curtainSub, 3600, 'gold');
    }
    this.machines.setPad(i, this.pads[i]);
  },
  // The server moved a player (the teleporter).
  warp(e, me) {
    const [, pid, x100, y100, z100, yaw1000] = e;
    const x = x100 / 100, y = y100 / 100, z = z100 / 100;
    if (pid === me) {
      Object.assign(this.p, { x, y, z, vx: 0, vy: 0, vz: 0, yaw: yaw1000 / 1000, pitch: 0 });
      this.flashWhite = Math.max(this.flashWhite || 0, this.settings.reduceFlashing ? 0.2 : 0.8);
      this.shake = Math.max(this.shake, 0.3);
    } else {
      this.avatars.snap?.(pid, x, y, z);
    }
  },
  trap(e) { this.onTrap(e[1], e[2]); },
  kill(e) {
    // Something fried in a running Spark Gate.
    if (e[3] !== KILL.SHOCK || !this.traps?.includes('active')) return;
    const x = e[4] / 100, z = e[6] / 100;
    const hit = (this.map.TRAPS || []).some((T, i) => this.traps[i] === 'active' && x > T.area[0] - 0.5 && x < T.area[3] + 0.5 && z > T.area[2] - 0.5 && z < T.area[5] + 0.5);
    if (hit) this.audio.trapZap({ x, y: e[5] / 100 + 1, z });
  },
};

// type -> [handlers], built from groups in order.
export function eventTable(...groups) {
  const table = new Map();
  for (const g of groups) {
    for (const [type, fn] of Object.entries(g)) {
      if (!table.has(type)) table.set(type, []);
      table.get(type).push(fn);
    }
  }
  return table;
}
