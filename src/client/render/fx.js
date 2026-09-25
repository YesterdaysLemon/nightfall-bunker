// Pooled effects: particles, tracers, decals, explosions, projectiles,
// grenades and power-ups. Nothing here allocates per frame.

import * as THREE from 'three';
import { EXTERIOR, LIGHTS } from '../../shared/map.js';
import { stepBody } from '../../shared/sim.js';
import { buildGrenade, buildPowerupModel } from './weapons3d.js';

class Particles {
  constructor(scene, cap, additive) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.alpha = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), scale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float alpha; attribute float size;
        varying float vA; varying vec3 vC;
        uniform float scale;
        #include <fog_pars_vertex>
        void main() {
          vA = alpha; vC = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec3 vC;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vC, vA * (1.0 - r));
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.material = mat;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 0, grow = 0) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.alpha[i] = a; this.a0[i] = a; this.size[i] = size;
    this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    let n = this.n;
    const P = this.pos, V = this.vel;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this.move(n, i);
        i--;
        continue;
      }
      const k = 1 - this.drag[i] * dt;
      V[i * 3] *= k; V[i * 3 + 1] = V[i * 3 + 1] * k - this.grav[i] * dt; V[i * 3 + 2] *= k;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0.01 && this.grav[i] > 0) { P[i * 3 + 1] = 0.01; V[i * 3] *= 0.5; V[i * 3 + 1] = 0; V[i * 3 + 2] *= 0.5; }
      const u = this.life[i] / this.max[i];
      this.alpha[i] = this.a0[i] * Math.min(1, u * 2.5);
      this.size[i] += this.grow[i] * dt;
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'alpha', 'size']) this.geo.attributes[k].needsUpdate = true;
  }

  move(from, to) {
    for (const arr of [this.pos, this.vel, this.col]) {
      arr[to * 3] = arr[from * 3]; arr[to * 3 + 1] = arr[from * 3 + 1]; arr[to * 3 + 2] = arr[from * 3 + 2];
    }
    for (const arr of [this.alpha, this.size, this.life, this.max, this.grav, this.drag, this.grow, this.a0]) arr[to] = arr[from];
  }
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.25, 'rgba(10,8,6,0.95)');
  grd.addColorStop(0.45, 'rgba(40,34,28,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Decals {
  constructor(scene, map, cap, tint = 0xffffff) {
    this.cap = cap;
    this.i = 0;
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, color: tint, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      cap,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._z = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._r = new THREE.Quaternion();
  }
  add(x, y, z, nx, ny, nz, size) {
    this._n.set(nx, ny, nz);
    this._q.setFromUnitVectors(this._z, this._n);
    this._r.setFromAxisAngle(this._n, Math.random() * 6.28);
    this._q.premultiply(this._r);
    this._p.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    this._s.set(size, size, size);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this.i, this._m);
    this.i = (this.i + 1) % this.cap;
    this.mesh.count = Math.min(this.cap, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.i = 0; }
}

export class FX {
  constructor(rig, tex, world, audio) {
    this.rig = rig;
    this.scene = rig.scene;
    this.world = world;
    this.audio = audio;
    this.add = new Particles(this.scene, 3000, true);
    this.alpha = new Particles(this.scene, 2500, false);
    this.holes = new Decals(this.scene, holeTexture(), 160);
    this.splats = new Decals(this.scene, tex.bloodDecal, 90, 0xaa2222);
    this.scorch = new Decals(this.scene, tex.scorch, 20);

    // Tracers.
    this.tracerCap = 48;
    this.tracerPos = new Float32Array(this.tracerCap * 6);
    this.tracerLife = new Float32Array(this.tracerCap);
    this.tracerData = new Float32Array(this.tracerCap * 7);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    this.tracerI = 0;

    this.grenades = new Map();
    this.projectiles = new Map();
    this.powerups = new Map();
    this.flashes = [];
    this.time = 0;
    this.fireAt = LIGHTS.filter((l) => l.fire).map((l) => new THREE.Vector3(...l.pos));
    this.shake = 0;
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x9ffcff });
    this.rocketMat = new THREE.MeshLambertMaterial({ color: 0x3d4430 });
    this.flashMat = new THREE.SpriteMaterial({ color: 0xffd08a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.glowMat = new THREE.SpriteMaterial({ color: 0x66ff88, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
    this.flashPool = Array.from({ length: 8 }, () => {
      const s = new THREE.Sprite(this.flashMat);
      s.visible = false; s.scale.setScalar(0.4);
      this.scene.add(s);
      return { s, t: 0 };
    });
  }

  // --- Impacts -----------------------------------------------------------------------
  blood(x, y, z, dx, dy, dz, amount = 1) {
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const s = 1.5 + Math.random() * 2.5;
      this.alpha.emit(x, y, z,
        dx * s + (Math.random() - 0.5) * 2, dy * s + Math.random() * 1.5, dz * s + (Math.random() - 0.5) * 2,
        0.35 + Math.random() * 0.15, 0.02, 0.02, 0.95, 0.05 + Math.random() * 0.06, 0.5 + Math.random() * 0.4, 9, 1.5);
    }
    for (let i = 0; i < 3 * amount; i++) {
      this.alpha.emit(x, y, z, dx * 0.4, 0.2, dz * 0.4, 0.3, 0.02, 0.02, 0.5, 0.12, 0.35, 0, 3, 0.9);
    }
    if (Math.random() < 0.35 * amount) {
      // Splat on whatever is behind the zombie.
      const n3 = [0, 0, 0];
      const t = this.world.raycast(x, y, z, dx, dy - 0.3, dz, 3, n3);
      if (t < 3) this.splats.add(x + dx * t, y + (dy - 0.3) * t, z + dz * t, n3[0], n3[1], n3[2], 0.5 + Math.random() * 0.6);
      else if (y < 2 && Math.random() < 0.5) this.splats.add(x + dx, 0.012, z + dz, 0, 1, 0, 0.6 + Math.random() * 0.5);
    }
  }

  impact(x, y, z, nx, ny, nz) {
    for (let i = 0; i < 5; i++) {
      this.add.emit(x, y, z, nx * 3 + (Math.random() - 0.5) * 4, ny * 3 + Math.random() * 3, nz * 3 + (Math.random() - 0.5) * 4,
        1, 0.75, 0.35, 1, 0.035, 0.15 + Math.random() * 0.15, 12, 1);
    }
    for (let i = 0; i < 3; i++) {
      this.alpha.emit(x, y, z, nx * 0.6 + (Math.random() - 0.5) * 0.3, ny * 0.6 + 0.2, nz * 0.6 + (Math.random() - 0.5) * 0.3,
        0.45, 0.42, 0.38, 0.45, 0.12, 0.7 + Math.random() * 0.4, 0, 2, 0.5);
    }
    this.holes.add(x, y, z, nx, ny, nz, 0.07 + Math.random() * 0.04);
  }

  tracer(ax, ay, az, bx, by, bz) {
    const i = this.tracerI;
    this.tracerI = (i + 1) % this.tracerCap;
    const d = this.tracerData;
    d.set([ax, ay, az, bx, by, bz, 0], i * 7);
    this.tracerLife[i] = 0.07;
  }

  muzzleWorld(x, y, z) {
    const f = this.flashPool.find((p) => !p.s.visible) || this.flashPool[0];
    f.s.position.set(x, y, z);
    f.s.visible = true;
    f.s.material.rotation = Math.random() * 6;
    f.t = 0.05;
  }

  dirt(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = Math.random() * 1.8;
      this.alpha.emit(x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3, Math.cos(a) * s, 1 + Math.random() * 2.5, Math.sin(a) * s,
        0.2, 0.16, 0.11, 0.9, 0.05 + Math.random() * 0.05, 0.8, 9, 0.5);
    }
    for (let i = 0; i < 4; i++) {
      this.alpha.emit(x, y + 0.1, z, (Math.random() - 0.5) * 0.5, 0.4, (Math.random() - 0.5) * 0.5, 0.25, 0.22, 0.18, 0.35, 0.4, 1.4, 0, 1, 0.6);
    }
  }

  dust(x, y, z, sx, sz) {
    for (let i = 0; i < 40; i++) {
      this.alpha.emit(x + (Math.random() - 0.5) * sx, y + Math.random() * 2, z + (Math.random() - 0.5) * sz,
        (Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6,
        0.42, 0.4, 0.36, 0.35, 0.5 + Math.random() * 0.4, 1.8 + Math.random(), 0, 0.6, 0.35);
    }
  }

  explosion(x, y, z, kind) {
    const arc = kind === 'arcpistol';
    if (arc) {
      for (let i = 0; i < 70; i++) {
        const v = randDir(4 + Math.random() * 6);
        this.add.emit(x, y, z, v[0], v[1], v[2], 0.45, 1, 0.95, 1, 0.06 + Math.random() * 0.05, 0.3 + Math.random() * 0.3, 2, 2);
      }
      this.add.emit(x, y, z, 0, 0, 0, 0.5, 1, 0.9, 0.9, 1.6, 0.18, 0, 0, 6);
    } else {
      for (let i = 0; i < 45; i++) {
        const v = randDir(3 + Math.random() * 7);
        this.add.emit(x, y, z, v[0], Math.abs(v[1]) * 0.8, v[2], 1, 0.55 + Math.random() * 0.2, 0.2, 1, 0.3 + Math.random() * 0.4, 0.25 + Math.random() * 0.3, 1, 3, 1.5);
      }
      for (let i = 0; i < 26; i++) {
        const v = randDir(1 + Math.random() * 2);
        this.alpha.emit(x, y + 0.3, z, v[0], Math.abs(v[1]) + 0.8, v[2], 0.16, 0.15, 0.14, 0.7, 0.8 + Math.random() * 0.6, 1.8 + Math.random() * 1.5, -0.3, 1.2, 1.2);
      }
      for (let i = 0; i < 30; i++) {
        const v = randDir(6 + Math.random() * 8);
        this.add.emit(x, y, z, v[0], Math.abs(v[1]) + 2, v[2], 1, 0.7, 0.3, 1, 0.04, 0.6 + Math.random() * 0.6, 12, 0.5);
      }
      if (y < 0.6) this.scorch.add(x, 0.015, z, 0, 1, 0, 2.4);
      else {
        const n = [0, 0, 0];
        const t = this.world.raycast(x, y, z, 0, -1, 0, 3.5, n);
        if (t < 3.5) this.scorch.add(x, y - t + 0.012, z, 0, 1, 0, 2.2);
      }
    }
    this.rig.explosionFlash(new THREE.Vector3(x, y + 0.5, z));
  }

  // --- Grenades ----------------------------------------------------------------------
  throwGrenade(id, x, y, z, vx, vy, vz) {
    const mesh = buildGrenade();
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.grenades.set(id, { mesh, body: { x, y, z, vx, vy, vz }, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0), t: 0 });
  }

  // --- Projectiles -------------------------------------------------------------------
  projectile(id, weapon, x, y, z, vx, vy, vz) {
    let mesh;
    if (weapon === 'arcpistol') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.orbMat);
    } else {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8).rotateX(Math.PI / 2), this.rocketMat);
    }
    mesh.position.set(x, y, z);
    mesh.lookAt(x + vx, y + vy, z + vz);
    this.scene.add(mesh);
    const grav = weapon === 'arcpistol' ? 0 : 2;
    this.projectiles.set(id, { mesh, weapon, vx, vy, vz, grav, t: 0 });
  }

  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.projectiles.delete(id);
  }

  // --- Power-ups -------------------------------------------------------------------------
  spawnPowerup(id, type, x, y, z) {
    const g = new THREE.Group();
    const model = buildPowerupModel(type);
    g.add(model);
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(1.3);
    g.add(glow);
    g.position.set(x, y + 0.8, z);
    this.scene.add(g);
    this.powerups.set(id, { g, model, t: 0, life: 26, y: y + 0.8 });
  }

  removePowerup(id) {
    const p = this.powerups.get(id);
    if (!p) return;
    this.scene.remove(p.g);
    this.powerups.delete(id);
  }

  // --- Frame --------------------------------------------------------------------------------
  update(dt, camPos) {
    this.time += dt;
    // Burning wreck.
    for (const f of this.fireAt) {
      for (let i = 0; i < 2; i++) {
        this.add.emit(f.x + (Math.random() - 0.5) * 1.6, f.y - 0.6 + Math.random() * 0.3, f.z + (Math.random() - 0.5) * 1.2,
          (Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.4,
          1, 0.45 + Math.random() * 0.25, 0.12, 0.8, 0.35 + Math.random() * 0.35, 0.5 + Math.random() * 0.5, -0.5, 0.8, -0.3);
      }
      if (Math.random() < 0.5) {
        this.alpha.emit(f.x + (Math.random() - 0.5), f.y + 0.8, f.z + (Math.random() - 0.5), 0.3, 1.2 + Math.random(), 0.2,
          0.08, 0.08, 0.08, 0.5, 1.0, 4 + Math.random() * 2, -0.1, 0.1, 0.8);
      }
      if (Math.random() < 0.15) {
        this.add.emit(f.x, f.y, f.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2, 1, 0.6, 0.2, 1, 0.04, 2, 0.5, 0.3);
      }
    }
    // Floating dust near the player.
    if (camPos && Math.random() < 0.5) {
      this.alpha.emit(camPos.x + (Math.random() - 0.5) * 8, camPos.y + (Math.random() - 0.5) * 3, camPos.z + (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.05, 0.8, 0.75, 0.6, 0.25, 0.018, 6, 0, 0);
    }
    this.add.update(dt);
    this.alpha.update(dt);

    // Tracers.
    const d = this.tracerData;
    for (let i = 0; i < this.tracerCap; i++) {
      let life = this.tracerLife[i];
      const o = i * 6, q = i * 7;
      if (life <= 0) { this.tracerPos.fill(0, o, o + 6); continue; }
      life -= dt;
      this.tracerLife[i] = life;
      const u = 1 - Math.max(0, life) / 0.07;
      const ax = d[q], ay = d[q + 1], az = d[q + 2], bx = d[q + 3], by = d[q + 4], bz = d[q + 5];
      const a = Math.min(1, u * 1.2), b = Math.min(1, u * 1.2 + 0.35);
      this.tracerPos[o] = ax + (bx - ax) * a; this.tracerPos[o + 1] = ay + (by - ay) * a; this.tracerPos[o + 2] = az + (bz - az) * a;
      this.tracerPos[o + 3] = ax + (bx - ax) * b; this.tracerPos[o + 4] = ay + (by - ay) * b; this.tracerPos[o + 5] = az + (bz - az) * b;
    }
    this.tracers.geometry.attributes.position.needsUpdate = true;

    for (const f of this.flashPool) {
      if (!f.s.visible) continue;
      f.t -= dt;
      if (f.t <= 0) f.s.visible = false;
    }

    for (const [id, g] of this.grenades) {
      g.t += dt;
      const was = g.body.bounced;
      g.body.bounced = false;
      stepBody(this.world, g.body, dt);
      if (g.body.bounced && Math.hypot(g.body.vx, g.body.vy, g.body.vz) > 1.5) this.audio.grenadeBounce(g.body);
      g.body.bounced = was;
      g.mesh.position.set(g.body.x, g.body.y, g.body.z);
      g.mesh.rotation.x += g.spin.x * dt * Math.min(1, Math.hypot(g.body.vx, g.body.vz) / 3);
      g.mesh.rotation.y += g.spin.y * dt * 0.2;
      if (g.t > 4) this.removeGrenade(id);
    }

    for (const p of this.projectiles.values()) {
      p.t += dt;
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      const m = p.mesh.position;
      if (p.weapon === 'arcpistol') {
        this.add.emit(m.x, m.y, m.z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.4, 1, 0.9, 1, 0.14, 0.25, 0, 1, -0.3);
      } else {
        this.alpha.emit(m.x, m.y, m.z, (Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3, 0.55, 0.53, 0.5, 0.5, 0.25, 1.2, -0.1, 1, 0.8);
        this.add.emit(m.x, m.y, m.z, 0, 0, 0, 1, 0.6, 0.2, 1, 0.18, 0.05, 0, 0);
      }
      if (p.t > 5) p.mesh.visible = false;
    }

    for (const [id, p] of this.powerups) {
      p.t += dt;
      p.g.position.y = p.y + Math.sin(p.t * 2.2) * 0.12;
      p.model.rotation.y += dt * 1.6;
      const left = p.life - p.t;
      p.g.visible = left > 6 || Math.sin(p.t * (left < 3 ? 22 : 12)) > 0;
      if (Math.random() < 0.3) this.add.emit(p.g.position.x + (Math.random() - 0.5) * 0.6, p.g.position.y - 0.3, p.g.position.z + (Math.random() - 0.5) * 0.6, 0, 0.6, 0, 0.4, 1, 0.5, 0.8, 0.05, 0.8, 0, 0);
      if (left < -1) this.removePowerup(id);
    }
  }

  removeGrenade(id) {
    const g = this.grenades.get(id);
    if (!g) return;
    this.scene.remove(g.mesh);
    this.grenades.delete(id);
  }

  clear() {
    for (const id of [...this.grenades.keys()]) this.removeGrenade(id);
    for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
    for (const id of [...this.powerups.keys()]) this.removePowerup(id);
    this.holes.clear(); this.splats.clear(); this.scorch.clear();
  }
}

function randDir(s) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [Math.cos(a) * r * s, u * s, Math.sin(a) * r * s];
}

export { EXTERIOR };
