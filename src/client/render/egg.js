// The Kintsugi easter egg's props: three gold-mended teacups (one on a post out
// in the courtyard) and the porcelain figurine on the help-room cabinet.

import * as THREE from 'three';
import { EGG } from '../../shared/map.js';
import { raySphere } from '../../shared/world.js';
import { buildFigurine, buildTeacup } from './kintsugi.js';

export class EggProps {
  constructor(rig, tex) {
    this.rig = rig;
    this.group = new THREE.Group();
    rig.scene.add(this.group);
    this.cups = EGG.cups.map((c) => {
      const g = buildTeacup();
      g.position.set(c.pos[0], c.pos[1], c.pos[2]);
      g.rotation.y = c.id * 1.7;
      this.group.add(g);
      return { g, broken: false };
    });
    // A lone fence post out in the courtyard for the third cup.
    const post = EGG.cups.find((c) => c.post);
    if (post) {
      const map = tex.plank.clone();
      map.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, post.pos[1], 0.12), new THREE.MeshLambertMaterial({ map, color: 0x8a7a66 }));
      m.position.set(post.pos[0], post.pos[1] / 2, post.pos[2]);
      m.rotation.y = 0.4;
      this.group.add(m);
    }
    this.figurine = buildFigurine();
    const f = EGG.figurine.pos;
    this.figurine.position.set(f[0], f[1], f[2]);
    this.figurine.rotation.y = Math.PI / 2; // faces into the room (+x)
    this.group.add(this.figurine);
    this.stage = 'cups';
    this.glow = 0;
    this.time = 0;
  }

  // Match the server's state (session start / late join).
  reset(state) {
    const cups = state?.cups || EGG.cups.map(() => false);
    this.cups.forEach((c, i) => {
      c.broken = !!cups[i];
      c.g.visible = !c.broken;
    });
    this.setStage(state?.stage || 'cups');
  }

  breakCup(i) {
    const c = this.cups[i];
    if (!c || c.broken) return null;
    c.broken = true;
    c.g.userData.shatter?.();
    c.g.visible = false;
    return EGG.cups[i].pos;
  }

  setStage(stage) {
    this.stage = stage;
    this.figurine.visible = stage === 'cups' || stage === 'ready';
    if (stage !== 'ready') {
      this.figurine.userData.setGlow?.(0);
      this.rig.eggLight.intensity = 0;
    }
  }

  // Index of the first intact cup the ray hits before `maxDist`, or -1.
  hitTest(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist, hit = -1;
    EGG.cups.forEach((c, i) => {
      if (this.cups[i].broken) return;
      const t = raySphere(ox, oy, oz, dx, dy, dz, c.pos[0], c.pos[1] + 0.05, c.pos[2], EGG.cupRadius);
      if (t >= 0 && t < best) { best = t; hit = i; }
    });
    return hit;
  }

  update(dt) {
    this.time += dt;
    const target = this.stage === 'ready' ? 1 : 0;
    this.glow += (target - this.glow) * Math.min(1, dt * 1.5);
    if (this.glow > 0.01) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 2.4);
      this.figurine.userData.setGlow?.(this.glow * pulse);
      const f = EGG.figurine.pos;
      this.rig.eggLight.position.set(f[0] + 0.25, f[1] + 0.3, f[2]);
      this.rig.eggLight.intensity = 6 * this.glow * pulse;
    }
    this.figurine.userData.update?.(dt, this.time);
  }
}
