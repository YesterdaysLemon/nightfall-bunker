// Remote teammates: a soldier rig holding their current weapon.

import * as THREE from 'three';
import { buildWeaponModel } from './weapons3d.js';
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

export class Avatars {
  constructor(scene, tex) {
    this.scene = scene;
    this.tex = tex;
    this.map = new Map();
    this.jacket = new THREE.MeshLambertMaterial({ map: tex.uniform, color: 0x7d8457 });
    this.trousers = new THREE.MeshLambertMaterial({ map: tex.uniform, color: 0x6a6a4c });
    this.skin = new THREE.MeshLambertMaterial({ map: tex.playerSkin });
    this.boots = new THREE.MeshLambertMaterial({ color: 0x2a2118 });
    this.helmet = new THREE.MeshLambertMaterial({ map: tex.metal, color: 0x6d7352 });
  }

  create(id, name, slot) {
    const color = PLAYER_COLORS[slot % 4];
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
    const tag = nameSprite(name, color);
    tag.position.y = 2.15;
    root.add(tag);
    this.scene.add(root);
    const a = { id, name, slot, root, hips, spine, neck, arms, gun, legs, tag, weapon: null, samples: [], phase: 0, speed: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, state: 0, flags: 0 };
    this.map.set(id, a);
    return a;
  }

  remove(id) {
    const a = this.map.get(id);
    if (!a) return;
    this.scene.remove(a.root);
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
        continue;
      }
      a.hips.rotation.x = 0;
      a.hips.position.y = 0.95 - crouch * 0.35;
      const sw = Math.sin(a.phase) * Math.min(1, a.speed / 3) * 0.7;
      a.legs[0].hip.rotation.x = sw - crouch * 0.9;
      a.legs[1].hip.rotation.x = -sw - crouch * 0.9;
      a.legs[0].knee.rotation.x = Math.max(0, -Math.cos(a.phase)) * 0.8 * Math.min(1, a.speed / 3) + crouch * 1.6;
      a.legs[1].knee.rotation.x = Math.max(0, Math.cos(a.phase)) * 0.8 * Math.min(1, a.speed / 3) + crouch * 1.6;
      a.spine.rotation.x = (a.flags & IN.SPRINT ? 0.25 : 0.05);
      a.arms.rotation.x = -a.pitch * 0.9 + (a.flags & IN.SPRINT ? 0.7 : 0);
      a.neck.rotation.x = -a.pitch * 0.5;
      a.root.position.y += Math.abs(Math.cos(a.phase)) * 0.03 * Math.min(1, a.speed / 3);
    }
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}
