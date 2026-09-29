// The map's machines in the world (models from machines.js, placed from the map's
// data): perk machines, the Forge, the Magic Lantern and its pads, the Spark Gates
// and their switches, the main breaker. The game drives their states from server
// events (events.js MACHINE_EVENTS); update() animates them every frame.

import * as THREE from 'three';
import {
  buildPerkMachine, buildForge, buildTeleCore, buildTelePad, buildSparkGate, buildTrapSwitch, buildBreaker,
} from './machines.js';
import { buildWeaponModel } from './weapons3d.js';

// Machines bring their own small lights; the scene's pooled lamps do the lighting,
// so these stay off (a fixed light count keeps every shader compiled once).
function place(g, pos, yaw = 0) {
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.y = yaw;
  if (g.userData.light) { g.userData.light.parent?.remove(g.userData.light); g.userData.light = null; }
  return g;
}

export class MachineProps {
  constructor(rig, map) {
    this.group = new THREE.Group();
    this.group.name = 'machines';
    rig.scene.add(this.group);
    this.all = [];
    const add = (g) => { this.group.add(g); this.all.push(g); return g; };
    this.perks = new Map();
    for (const m of map.PERKS || []) this.perks.set(m.perk, add(place(buildPerkMachine(m.perk), m.pos, m.yaw)));
    this.forge = map.FORGE ? add(place(buildForge(), map.FORGE.pos, map.FORGE.yaw)) : null;
    this.forgeGun = null;
    this.breaker = map.POWER ? add(place(buildBreaker(), map.POWER.pos, map.POWER.yaw)) : null;
    const TP = map.TELEPORT;
    this.core = TP ? add(place(buildTeleCore(), TP.core.pad, 0)) : null;
    this.pads = TP ? TP.pads.map((p) => add(place(buildTelePad(), p.pos, p.yaw || 0))) : [];
    this.gates = [];
    this.switches = [];
    for (const T of map.TRAPS || []) {
      const [ax, ay, az] = T.gate.a, [bx, , bz] = T.gate.b;
      const w = Math.hypot(bx - ax, bz - az) - 0.3;
      const gate = buildSparkGate(w, 2.4);
      place(gate, [(ax + bx) / 2, ay, (az + bz) / 2], -Math.atan2(bz - az, bx - ax));
      this.gates.push(add(gate));
      const sw = buildTrapSwitch();
      const floorY = T.switch.use[1];
      place(sw, [T.switch.pos[0], floorY, T.switch.pos[2]], Math.atan2(T.switch.face[0], T.switch.face[1]));
      this.switches.push(add(sw));
    }
    this.setPower(false);
    for (const s of this.switches) s.userData.setState?.('off');
  }

  setCalm(on) { for (const g of this.all) g.userData.setCalm?.(on); }

  // instant: a late joiner's world (the breaker snaps over without sparks).
  setPower(on, instant = false) {
    this.power = on;
    for (const g of this.all) g.userData.setPower?.(on);
    this.breaker?.userData.setOn?.(on, instant);
    for (const s of this.switches) if (!on) s.userData.setState?.('off');
    if (on) for (const s of this.switches) s.userData.setState?.('ready');
  }

  vend(perk) { this.perks.get(perk)?.userData.vend?.(); }

  // The Forge: 'working' (the gun is in), 'ready' (the upgraded gun on the tray), 'idle'.
  setForge(state, gun) {
    const F = this.forge;
    if (!F) return;
    F.userData.setState?.(state);
    if (this.forgeGun) { this.forgeGun.parent?.remove(this.forgeGun); this.forgeGun = null; }
    if (gun && (state === 'working' || state === 'ready') && F.userData.slot) {
      const m = buildWeaponModel(gun);
      const s = Math.min(1, 0.9 / (m.userData.length || 1));
      m.scale.setScalar(s);
      m.rotation.y = Math.PI / 2;   // the tray runs along z; lay the gun along x
      F.userData.slot.add(m);
      this.forgeGun = m;
    }
  }

  // Teleporter pads: 'ready' | 'lever' | 'linked' | 'cooldown'; fire() flashes.
  setPad(i, state) {
    const p = this.pads[i];
    if (!p) return;
    p.userData.linkedState = state === 'linked';
    p.userData.setLinked?.(state === 'linked');
    p.userData.setCharge?.(state === 'lever' ? 0.5 : state === 'linked' ? 1 : 0);
    this.core?.userData.setLinked?.(this.pads.some((q) => q.userData.linkedState));
  }

  firePad(i) {
    this.pads[i]?.userData.fire?.();
    this.core?.userData.fire?.();
  }

  setTrap(i, state) {
    this.gates[i]?.userData.setActive?.(state === 'active');
    this.switches[i]?.userData.setState?.(this.power ? state : 'off');
  }

  // sees(x, y, z, r): the map's visibility test (the palace's portal culler), if it has
  // one: machines out of sight skip drawing but keep animating.
  update(dt, t) {
    for (const g of this.all) {
      if (this.sees) g.visible = this.sees(g.position.x, g.position.y + 1.2, g.position.z, 2.3);
      g.userData.update?.(dt, t);
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    if (this.forgeGun) this.forgeGun.parent?.remove(this.forgeGun);
  }
}
