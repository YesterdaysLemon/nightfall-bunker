// Remote teammates: a soldier rig holding their current weapon.
//
// With the exported survivor model (public/models/survivor.json, built by
// art/zombies/z_survivor.py) each avatar is the painted low-poly Survivor: one
// mesh per part on the model's joints, sharing one Lambert material. The parts
// listed in meta.tint (helmet band, armbands, neckerchief) are painted neutral
// near-white and get a per-avatar material whose colour (and a faint glow) is the
// player's PLAYER_COLORS entry, so teammates read at a distance in the dark.
// The arms hang in the model's rest pose; setWeapon() places the gun in the arms
// group and solves both arms onto it (two-bone IK: right hand on the grip, left
// hand on the weapon's leftHand anchor, sliding back along the gun if out of reach).
//
// Without the model (null: missing file, load error) the procedural box soldier
// below is used. Both share the same joint roles (hips, spine, neck, arms, legs),
// so update() animates either one.

import * as THREE from 'three';
import { buildWeaponModel } from './weapons3d.js';
import { buildJoints } from './models.js';
import { PLAYER_COLORS, PS, IN } from '../../shared/protocol.js';

function box(sx, sy, sz, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  return m;
}

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '32px "Special Elite", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.1, 0.275, 1);
  s.renderOrder = 10;
  return s;
}

// --- arm IK helpers (all vectors in the "arms" joint's space: +X left, +Y up, +Z forward) ---

const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

function basis(m, axis, side) {
  _x.copy(axis).normalize();
  _y.copy(side).addScaledVector(_x, -side.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  return m.makeBasis(_x, _y, _z);
}

// Rotation taking the frame (a0, p0) onto (a1, p1): axis a exactly, p as close as possible.
function frameQuat(a0, p0, a1, p1, out = new THREE.Quaternion()) {
  basis(_m0, a0, p0);
  basis(_m1, a1, p1);
  return out.setFromRotationMatrix(_m1.multiply(_m0.transpose()));
}

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
// Hand targets per hold: long axis (wrist -> knuckles), palm normal, elbow pole.
const HOLDS = {
  rifle: {
    R: { axis: V(0, -0.35, 1), palm: V(1, 0, 0), pole: V(-1, -0.7, -0.2) },
    L: { axis: V(-0.75, 0.05, 0.66), palm: V(0, 1, 0.1), pole: V(0.35, -1, 0) },
    grip: new THREE.Vector3(-0.12, -0.085, 0.30),
  },
  pistol: {
    R: { axis: V(0, -0.3, 1), palm: V(1, 0, 0), pole: V(-0.6, -1, -0.1) },
    L: { axis: V(-0.3, -0.35, 1), palm: V(-1, 0.25, 0), pole: V(0.6, -1, 0) },
    grip: new THREE.Vector3(-0.05, -0.075, 0.43),
  },
};
const FORWARD = new THREE.Vector3(0, 0, 1);
const FRONT = new THREE.Vector3(0, 0, 1);

export class Avatars {
  constructor(scene, tex, model = null) {
    this.scene = scene;
    this.tex = tex;
    this.model = model || null;
    this.map = new Map();
    if (this.model) this.initModel(this.model);
    else {
      this.jacket = new THREE.MeshLambertMaterial({ map: tex.uniform, color: 0xd8dcb0 });
      this.trousers = new THREE.MeshLambertMaterial({ map: tex.uniform, color: 0xb4b490 });
      this.skin = new THREE.MeshLambertMaterial({ map: tex.playerSkin });
      this.boots = new THREE.MeshLambertMaterial({ color: 0x2a2118 });
      this.helmet = new THREE.MeshLambertMaterial({ map: tex.metal, color: 0xa8b08a });
    }
  }

  // --- the exported Survivor --------------------------------------------------------------

  initModel(model) {
    const parts = [...model.parts.values()];
    this.vcol = parts.some((p) => p.hasColor);
    this.body = new THREE.MeshLambertMaterial({ map: model.texture, vertexColors: this.vcol });
    this.tint = new Set(model.meta.tint || ['helmband', 'band.L', 'band.R', 'scarf']);
    const J = model.joints;
    const v = (n) => new THREE.Vector3().fromArray(J[n].pos);
    const hands = model.meta.hands || {};
    this.rest = {};
    for (const s of ['L', 'R']) {
      const h = hands[s] || {};
      const upper = v('el' + s), fore = v('wr' + s);
      this.rest[s] = {
        upper, fore, l1: upper.length(), l2: fore.length(),
        u0: upper.clone().normalize(), v0: fore.clone().normalize(),
        axis: new THREE.Vector3().fromArray(h.axis || [0, -1, 0]).normalize(),
        palm: new THREE.Vector3().fromArray(h.palm || [s === 'L' ? -1 : 1, 0, 0]).normalize(),
        grip: new THREE.Vector3().fromArray(h.grip || [0, -0.08, 0]),
      };
    }
  }

  buildModelRig(color) {
    const root = new THREE.Group();
    const n = buildJoints(this.model, root);
    const band = new THREE.MeshLambertMaterial({
      map: this.model.texture, vertexColors: this.vcol,
      color, emissive: color, emissiveMap: this.model.texture, emissiveIntensity: 0.3,
    });
    for (const part of this.model.parts.values()) {
      const joint = n[part.joint];
      if (!joint) continue;
      joint.add(new THREE.Mesh(part.geometry, this.tint.has(part.name) ? band : this.body));
    }
    const gun = new THREE.Group();
    n.arms.add(gun);
    return {
      root, hips: n.hips, spine: n.spine, neck: n.neck, arms: n.arms, gun, band,
      legs: [{ hip: n.hipL, knee: n.knL }, { hip: n.hipR, knee: n.knR }],
      arm: { L: { sh: n.shL, el: n.elL, wr: n.wrL }, R: { sh: n.shR, el: n.elR, wr: n.wrR } },
    };
  }

  // Two-bone IK in the arms joint's space: put the hand's grip channel on `target`
  // with the hand turned to (axis, palm); `slide` lets the hand move back along a
  // direction (the gun) when the target is out of reach.
  solveArm(a, s, target, hold, slide = null) {
    const r = this.rest[s], j = a.arm[s];
    const qHand = frameQuat(r.axis, r.palm, hold.axis, hold.palm);
    const S = j.sh.position;
    const W = target.clone().sub(r.grip.clone().applyQuaternion(qHand));
    const reach = (r.l1 + r.l2) * 0.985;
    const D = W.clone().sub(S);
    if (slide && D.length() > reach) {
      const b = D.dot(slide), c = D.lengthSq() - reach * reach;
      W.addScaledVector(slide, -(b - Math.sqrt(Math.max(0, b * b - c))));
    }
    D.subVectors(W, S);
    const d = THREE.MathUtils.clamp(D.length(), Math.abs(r.l1 - r.l2) + 1e-3, reach);
    const dir = D.normalize();
    W.copy(S).addScaledVector(dir, d);
    const along = (r.l1 * r.l1 - r.l2 * r.l2 + d * d) / (2 * d);
    const up = Math.sqrt(Math.max(0, r.l1 * r.l1 - along * along));
    const pole = hold.pole.clone().addScaledVector(dir, -hold.pole.dot(dir)).normalize();
    const E = S.clone().addScaledVector(dir, along).addScaledVector(pole, up);
    const u = E.clone().sub(S).normalize();
    const fDir = W.clone().sub(E).normalize();
    const front = fDir.clone().addScaledVector(u, -fDir.dot(u));
    if (front.lengthSq() < 1e-6) front.copy(pole).multiplyScalar(-1);
    const qSh = frameQuat(r.u0, FRONT, u, front);
    const qEl = new THREE.Quaternion().setFromUnitVectors(r.v0, fDir.applyQuaternion(qSh.clone().invert()));
    j.sh.quaternion.copy(qSh);
    j.el.quaternion.copy(qEl);
    j.wr.quaternion.copy(qSh.clone().multiply(qEl).invert().multiply(qHand));
  }

  poseArms(a, m) {
    for (const s of ['L', 'R']) for (const k of ['sh', 'el', 'wr']) a.arm[s][k].quaternion.identity();
    if (!m) return;
    const hold = (m.userData.length ?? 0.6) < 0.45 ? HOLDS.pistol : HOLDS.rifle;
    a.gun.position.copy(hold.grip);
    a.gun.rotation.set(0, Math.PI, 0); // barrel (-Z in the weapon) to the rig's forward (+Z)
    a.gun.updateMatrix();
    const lh = m.userData.leftHand;
    const left = lh ? lh.position.clone().applyMatrix4(a.gun.matrix) : hold.grip.clone().add(new THREE.Vector3(0, 0.01, 0.22));
    this.solveArm(a, 'R', hold.grip, hold.R);
    this.solveArm(a, 'L', left, hold.L, hold === HOLDS.rifle ? FORWARD : null);
  }

  // --- the procedural fallback ------------------------------------------------------------

  buildBoxRig(color) {
    const band = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
    const root = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    hips.add(box(0.34, 0.2, 0.22, this.trousers));
    const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    spine.add(box(0.44, 0.56, 0.26, this.jacket, 0, 0.28, 0));
    spine.add(box(0.46, 0.06, 0.28, this.boots, 0, 0.03, 0));
    const neck = new THREE.Group(); neck.position.y = 0.58; spine.add(neck);
    neck.add(box(0.21, 0.24, 0.23, this.skin, 0, 0.13, 0));
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.helmet);
    helm.position.y = 0.2; helm.scale.set(1, 0.85, 1.1);
    neck.add(helm);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14), this.helmet);
    brim.position.y = 0.2; neck.add(brim);
    const arms = new THREE.Group(); arms.position.set(0, 0.48, 0); spine.add(arms);
    const armR = box(0.12, 0.12, 0.42, this.jacket, -0.2, -0.08, 0.16); armR.rotation.x = 0.2;
    const armL = box(0.12, 0.12, 0.5, this.jacket, 0.16, -0.1, 0.24); armL.rotation.set(0.15, -0.35, 0);
    const bandM = box(0.13, 0.06, 0.13, band, 0.27, -0.02, 0);
    arms.add(armR, armL);
    spine.add(bandM);
    const handR = box(0.08, 0.1, 0.1, this.skin, -0.14, -0.13, 0.36);
    const handL = box(0.08, 0.1, 0.1, this.skin, 0.02, -0.14, 0.46);
    arms.add(handR, handL);
    const gun = new THREE.Group(); gun.position.set(-0.12, -0.12, 0.36); gun.rotation.y = Math.PI; arms.add(gun);
    const legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.1, -0.05, 0); hips.add(hip);
      hip.add(box(0.16, 0.46, 0.17, this.trousers, 0, -0.23, 0));
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      knee.add(box(0.14, 0.34, 0.15, this.trousers, 0, -0.17, 0));
      knee.add(box(0.15, 0.13, 0.26, this.boots, 0, -0.39, 0.04));
      legs.push({ hip, knee });
    }
    return { root, hips, spine, neck, arms, gun, legs, band, arm: null };
  }

  // --- public API -------------------------------------------------------------------------

  create(id, name, slot) {
    const color = PLAYER_COLORS[slot % 4];
    const rig = this.model ? this.buildModelRig(color) : this.buildBoxRig(color);
    const tag = nameSprite(name, color);
    tag.position.y = 2.15;
    rig.root.add(tag);
    this.scene.add(rig.root);
    const a = { id, name, slot, ...rig, tag, weapon: null, samples: [], phase: 0, speed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, state: 0, flags: 0 };
    this.map.set(id, a);
    return a;
  }

  remove(id) {
    const a = this.map.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    a.band?.dispose();
    a.tag.material.map?.dispose();
    a.tag.material.dispose();
    this.map.delete(id);
  }

  sample(id, row, t) {
    const a = this.map.get(id);
    if (!a) return;
    a.samples.push({ t, x: row[1] / 100, y: row[2] / 100, z: row[3] / 100, yaw: row[4] / 1000, pitch: row[5] / 1000 });
    if (a.samples.length > 5) a.samples.shift();
    a.state = row[7];
    a.flags = row[10];
    if (a.weapon !== row[8]) this.setWeapon(a, row[8]);
  }

  setWeapon(a, id) {
    a.weapon = id;
    a.gun.clear();
    const m = buildWeaponModel(id);
    a.gun.add(m);
    a.muzzle = m.userData.muzzle;
    if (a.arm) this.poseArms(a, m);
  }

  muzzlePos(id, out) {
    const a = this.map.get(id);
    if (!a?.muzzle) return null;
    a.root.updateMatrixWorld(true);
    return a.muzzle.getWorldPosition(out);
  }

  update(dt, now, delay) {
    const rt = now - delay;
    for (const a of this.map.values()) {
      const s = a.samples;
      if (!s.length) continue;
      let p = s[0], q = s[s.length - 1];
      for (let i = 0; i < s.length - 1; i++) if (s[i].t <= rt && s[i + 1].t >= rt) { p = s[i]; q = s[i + 1]; break; }
      const u = q.t > p.t ? Math.max(0, Math.min(1, (rt - p.t) / (q.t - p.t))) : 1;
      const px = a.x, pz = a.z;
      a.x = p.x + (q.x - p.x) * u; a.y = p.y + (q.y - p.y) * u; a.z = p.z + (q.z - p.z) * u;
      let dyaw = q.yaw - p.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      a.yaw = p.yaw + dyaw * u;
      a.pitch = p.pitch + (q.pitch - p.pitch) * u;
      const v = dt > 0 ? Math.hypot(a.x - px, a.z - pz) / dt : 0;
      a.speed += (Math.min(7, v) - a.speed) * Math.min(1, dt * 8);
      a.phase += dt * a.speed * 2.6;
      this.pose(a);
    }
  }

  // Pose one avatar from its interpolated state (position, yaw, pitch, speed, phase, flags).
  pose(a) {
    a.root.visible = a.state !== PS.DEAD;
    a.root.position.set(a.x, a.y, a.z);
    // Player yaw 0 looks toward -Z; the rig faces +Z.
    a.root.rotation.set(0, a.yaw + Math.PI, 0);
    const crouch = a.flags & IN.CROUCH ? 1 : 0;
    if (a.state === PS.DOWN) {
      a.hips.position.y = 0.25;
      a.hips.rotation.x = -1.35;
      a.arms.rotation.x = 1.2;
      for (const l of a.legs) { l.hip.rotation.x = 0.2; l.knee.rotation.x = 0.4; }
      return;
    }
    a.hips.rotation.x = 0;
    a.hips.position.y = 0.95 - crouch * (a.arm ? 0.31 : 0.35);
    const k = Math.min(1, a.speed / 3);
    const sw = Math.sin(a.phase) * k * 0.7;
    a.legs[0].hip.rotation.x = sw - crouch * 0.9;
    a.legs[1].hip.rotation.x = -sw - crouch * 0.9;
    a.legs[0].knee.rotation.x = Math.max(0, -Math.cos(a.phase)) * 0.8 * k + crouch * 1.6;
    a.legs[1].knee.rotation.x = Math.max(0, Math.cos(a.phase)) * 0.8 * k + crouch * 1.6;
    a.spine.rotation.x = (a.flags & IN.SPRINT ? 0.25 : 0.05);
    a.arms.rotation.x = -a.pitch * 0.9 + (a.flags & IN.SPRINT ? 0.7 : 0);
    a.neck.rotation.x = -a.pitch * 0.5;
    a.root.position.y += Math.abs(Math.cos(a.phase)) * 0.03 * k;
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}
