// Pooled effects: particles, tracers, decals, explosions, projectiles,
// grenades and power-ups. Nothing here allocates per frame.

import * as THREE from 'three';
import { stepBody } from '../../shared/sim.js';
import { WEAPONS } from '../../shared/weapons.js';
import { HOUND_SCALE as HS, HOUND_MID } from '../../shared/enemies.js';
import { buildGrenade, buildPowerupModel } from './weapons3d.js';

const _zap = new THREE.Vector3();

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

// Soft round falloff for additive sprites (without a map they draw as squares).
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
    this.fireAt = [];   // setMap: the map's open fires (embers drift from them)
    this.shake = 0;
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x9ffcff });
    this.rocketMat = new THREE.MeshLambertMaterial({ color: 0x3d4430 });
    const glow = glowTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: glow, color: 0xffd08a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.glowMat = new THREE.SpriteMaterial({ map: glow, color: 0x66ff88, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    this.flashPool = Array.from({ length: 8 }, () => {
      const s = new THREE.Sprite(this.flashMat);
      s.visible = false; s.scale.setScalar(0.4);
      this.scene.add(s);
      return { s, t: 0 };
    });
    this.goldGlowMat = new THREE.SpriteMaterial({ map: glow, color: 0xffc34a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
    this.goldModel = null; // set by the game: () => THREE.Object3D for the gold-leaf pickup
    // Lightning bolts (pool of 3 line strips) and queued hellfire patches.
    const boltMat = new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.bolts = Array.from({ length: 3 }, () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 32), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.LineSegments(g, boltMat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      return { line, life: 0 };
    });
    this.fires = [];
    // Chain lightning: every live chain's bolts, re-jagged each frame, in one line buffer.
    this.chainCap = 2400;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.chainCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.chainLines = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({
      color: 0xc8f4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.chainLines.frustumCulled = false;
    this.chainLines.visible = false;
    this.scene.add(this.chainLines);
    this.chains = [];
  }

  // --- Chain lightning ---------------------------------------------------------------
  // n points; at(i) -> [x, y, z] (re-read every frame so bolts follow moving enemies).
  // Bolt i runs from point from[i] (default i) to point i + 1 and strikes `delay` s
  // after bolt i - 1;
  // onHop(i, [x, y, z]) fires as it lands. `skip` bolts at the start are not drawn
  // (the shooter already drew the first one).
  chain(n, at, delay, onHop, skip = 0, from = null) {
    if (this.chains.length >= 4) this.chains.shift();
    this.chains.push({ t: 0, n, at, delay, onHop, skip, from, landed: 0 });
  }

  updateChains(dt) {
    const LIFE = 0.24;
    const pos = this.chainLines.geometry.attributes.position.array;
    let k = 0;
    const seg = (ax, ay, az, bx, by, bz) => {
      if (k + 6 > pos.length) return;
      pos[k++] = ax; pos[k++] = ay; pos[k++] = az; pos[k++] = bx; pos[k++] = by; pos[k++] = bz;
    };
    for (let c = this.chains.length - 1; c >= 0; c--) {
      const ch = this.chains[c];
      ch.t += dt;
      for (let i = 0; i < ch.n - 1; i++) {
        const t0 = i * ch.delay;
        if (ch.t < t0 || ch.t > t0 + LIFE) continue;
        const a = ch.at(ch.from?.[i] ?? i), b = ch.at(i + 1);
        if (i < ch.skip) continue;
        if (ch.landed <= i) {
          ch.landed = i + 1;
          ch.onHop?.(i, b);
          this.zapSparks(b[0], b[1], b[2], i === ch.n - 2 ? 1.4 : 1);
        }
        // Flicker: blink off for a frame now and then (unless flashing is reduced).
        if (!this.rig.calm && Math.random() < 0.18) continue;
        this.jagged(a, b, seg, 1 - (ch.t - t0) / LIFE);
      }
      if (ch.t > (ch.n - 1) * ch.delay + LIFE) this.chains.splice(c, 1);
    }
    this.chainLines.geometry.setDrawRange(0, k / 3);
    this.chainLines.geometry.attributes.position.needsUpdate = true;
    this.chainLines.visible = k > 0;
  }

  // A jagged bolt from a to b: a main strand, a thinner twin around it (so it reads
  // thick at 240 lines), a forked branch or two, and glow beads along it.
  jagged(a, b, seg, strength) {
    this.strand(a, b, seg, strength, 1, true);
    this.strand(a, b, seg, strength, 0.45, false);
  }

  strand(a, b, seg, strength, scale, main) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const pieces = Math.max(4, Math.min(14, Math.round(len / 0.35)));
    const amp = Math.min(0.5, len * 0.07) * (0.6 + 0.4 * strength) * scale;
    let px = a[0], py = a[1], pz = a[2];
    for (let j = 1; j <= pieces; j++) {
      const u = j / pieces, w = j === pieces ? 0 : Math.sin(u * Math.PI) * amp;
      const nx = a[0] + dx * u + (Math.random() - 0.5) * 2 * w;
      const ny = a[1] + dy * u + (Math.random() - 0.5) * 2 * w;
      const nz = a[2] + dz * u + (Math.random() - 0.5) * 2 * w;
      seg(px, py, pz, nx, ny, nz);
      if (main && j > 1 && j < pieces - 1 && Math.random() < 0.14) {
        seg(nx, ny, nz, nx + (Math.random() - 0.5) * amp * 3, ny - Math.random() * amp * 2, nz + (Math.random() - 0.5) * amp * 3);
      }
      if (main) this.add.emit(nx, ny, nz, 0, 0, 0, 0.5, 0.85, 1, 0.9, 0.11 + Math.random() * 0.05, 0.05, 0, 0);
      px = nx; py = ny; pz = nz;
    }
  }

  // Blue-white sparks and a flash where a bolt lands.
  zapSparks(x, y, z, n = 1) {
    for (let i = 0; i < 22 * n; i++) {
      const v = randDir(2 + Math.random() * 5);
      this.add.emit(x, y, z, v[0], v[1] + 1, v[2], 0.6, 0.9, 1, 1, 0.035, 0.2 + Math.random() * 0.35, 9, 1);
    }
    this.add.emit(x, y, z, 0, 0, 0, 0.5, 0.85, 1, 0.7, 0.35 * n, 0.08, 0, 0, 2);
    this.rig.muzzleFlash(_zap.set(x, y, z), 1.2, 0x8fd8ff, 0.09);
  }

  // An electrocuted body: sparks crawling over it (called each frame while it fries).
  shockCrawl(x, y, z, h = 1.7) {
    const yy = y + Math.random() * h;
    const v = randDir(1.5);
    this.add.emit(x + v[0] * 0.15, yy, z + v[2] * 0.15, v[0], v[1] + 0.5, v[2], 0.55, 0.85, 1, 1, 0.03, 0.12 + Math.random() * 0.12, 4, 1);
    if (Math.random() < 0.3) this.alpha.emit(x, yy, z, 0, 0.5, 0, 0.12, 0.12, 0.13, 0.4, 0.2, 1.2, -0.1, 1, 0.8);
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

  // blast: 'arc' (an electric burst) or 'fire' (rockets and grenades).
  explosion(x, y, z, blast) {
    const arc = blast === 'arc';
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

  // The Gale Cannon's blast of air: a cone of pale streaks and dust off the muzzle.
  gust(from, dir, reach = 11, angle = 0.5) {
    const d = dir.clone ? dir.clone().normalize() : new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, d);
    const v = new THREE.Vector3();
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.tan(angle);
      v.copy(d).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const sp = reach * (1.6 + Math.random() * 1.4);
      const o = 0.2 + Math.random() * 0.6;
      this.alpha.emit(from.x + v.x * o, from.y + v.y * o, from.z + v.z * o, v.x * sp, v.y * sp, v.z * sp,
        0.78, 0.8, 0.84, 0.08 + Math.random() * 0.1, 0.05 + Math.random() * 0.07, 0.3 + Math.random() * 0.25, 0, 2.6, 1.4);
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * Math.tan(angle) * 0.6;
      v.copy(d).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const sp = 10 + Math.random() * 14;
      this.add.emit(from.x, from.y, from.z, v.x * sp, v.y * sp, v.z * sp, 0.85, 0.9, 1, 0.8, 0.03, 0.3 + Math.random() * 0.2, 0, 2.5);
    }
    // Dust kicked off the floor along the blast.
    const n = [0, 0, 0];
    for (let k = 2; k < reach; k += 1.6) {
      const px = from.x + d.x * k, pz = from.z + d.z * k, py = from.y + d.y * k;
      const t = this.world.raycast(px, py, pz, 0, -1, 0, 3, n);
      if (t >= 3) continue;
      for (let i = 0; i < 4; i++) {
        this.alpha.emit(px + (Math.random() - 0.5) * k * 0.4, py - t + 0.05, pz + (Math.random() - 0.5) * k * 0.4,
          d.x * 6 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), d.z * 6 + (Math.random() - 0.5) * 2,
          0.3, 0.27, 0.23, 0.5, 0.3 + Math.random() * 0.3, 0.9 + Math.random() * 0.6, -0.2, 2, 1.4);
      }
    }
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
    const P = WEAPONS[weapon]?.projectile || {};
    let mesh;
    if (P.look === 'orb') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.orbMat);
    } else {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8).rotateX(Math.PI / 2), this.rocketMat);
    }
    mesh.position.set(x, y, z);
    mesh.lookAt(x + vx, y + vy, z + vz);
    this.scene.add(mesh);
    this.projectiles.set(id, { mesh, look: P.look, vx, vy, vz, grav: P.gravity ?? 2, t: 0 });
  }

  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.projectiles.delete(id);
  }

  // --- Hounds & porcelain ----------------------------------------------------------------
  // A jagged bolt from the sky to (x, y, z), a ground flash, sparks and a
  // lingering ring of hellfire where the hound will stand up.
  lightning(x, y, z) {
    const b = this.bolts.find((q) => q.life <= 0) || this.bolts[0];
    const pts = [];
    let px = x + (Math.random() - 0.5) * 3, py = y + 16, pz = z + (Math.random() - 0.5) * 3;
    const n = 14;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const nx = x + (px - x) * 0.25 * (1 - u) + (Math.random() - 0.5) * 0.9 * (1 - u * 0.8);
      const ny = y + 16 * (1 - u);
      const nz = z + (pz - z) * 0.25 * (1 - u) + (Math.random() - 0.5) * 0.9 * (1 - u * 0.8);
      pts.push(px, py, pz, nx, ny, nz);
      if (i > 3 && i < n - 2 && Math.random() < 0.35) {
        pts.push(nx, ny, nz, nx + (Math.random() - 0.5) * 2.2, ny - 1 - Math.random() * 1.5, nz + (Math.random() - 0.5) * 2.2);
      }
      px = nx; py = ny; pz = nz;
    }
    const pos = b.line.geometry.attributes.position;
    pos.array.fill(0);
    pos.array.set(pts.slice(0, pos.array.length));
    pos.needsUpdate = true;
    b.line.geometry.setDrawRange(0, Math.min(pts.length, pos.array.length) / 3);
    b.line.visible = true;
    b.life = 0.32;
    for (let i = 0; i < 40; i++) {
      const v = randDir(3 + Math.random() * 5);
      this.add.emit(x, y + 0.1, z, v[0], Math.abs(v[1]) + 1, v[2], 0.75, 0.85, 1, 1, 0.04, 0.3 + Math.random() * 0.4, 10, 1);
    }
    if (!this.rig.calm) this.add.emit(x, y + 0.3 * HS, z, 0, 0, 0, 0.7, 0.8, 1, 1, 2.2 * HS, 0.16, 0, 0, 4);
    this.houndFire(x, y, z, 0.9);
    this.scorch.add(x, y + 0.015, z, 0, 1, 0, 1.4 * HS);
    this.rig.lightning(new THREE.Vector3(x, y, z));
  }

  // Hellfire licking up from the ground for `dur` seconds (queued, drained in update).
  houndFire(x, y, z, dur = 0.8) {
    this.fires.push({ x, y, z, t: dur });
  }

  // A hound bursting into flame as it dies.
  houndBurst(x, y, z) {
    for (let i = 0; i < 34; i++) {
      const v = randDir(1.5 + Math.random() * 3);
      this.add.emit(x, y + HOUND_MID, z, v[0], Math.abs(v[1]) * 1.2 + 0.8, v[2], 1, 0.4 + Math.random() * 0.3, 0.08, 1, (0.22 + Math.random() * 0.25) * HS, 0.35 + Math.random() * 0.35, -0.6, 2.2, 1.2);
    }
    for (let i = 0; i < 14; i++) {
      const v = randDir(0.8);
      this.alpha.emit(x, y + HOUND_MID + 0.1, z, v[0], Math.abs(v[1]) + 0.9, v[2], 0.07, 0.06, 0.05, 0.75, (0.45 + Math.random() * 0.3) * HS, 1.6 + Math.random(), -0.2, 1, 0.9);
    }
    for (let i = 0; i < 16; i++) {
      const v = randDir(3 + Math.random() * 3);
      this.add.emit(x, y + HOUND_MID, z, v[0], Math.abs(v[1]) + 2, v[2], 1, 0.6, 0.2, 1, 0.035, 0.8 + Math.random() * 0.8, 9, 0.4);
    }
    this.scorch.add(x, y + 0.015, z, 0, 1, 0, 1.1 * HS);
    this.rig.explosionFlash(new THREE.Vector3(x, y + HOUND_MID, z));
  }

  // Glazed shards (white with blue flecks) and gold dust. `n` scales the burst.
  porcelain(x, y, z, n = 1, spread = 1) {
    for (let i = 0; i < 34 * n; i++) {
      const v = randDir((2 + Math.random() * 4) * spread);
      const blue = Math.random() < 0.18;
      this.alpha.emit(x + (Math.random() - 0.5) * 0.3 * spread, y + (Math.random() - 0.3) * 0.6 * spread, z + (Math.random() - 0.5) * 0.3 * spread,
        v[0], Math.abs(v[1]) + 1.2, v[2], blue ? 0.3 : 0.95, blue ? 0.42 : 0.94, blue ? 0.85 : 0.9, 1,
        0.012 + Math.random() * 0.022, 0.8 + Math.random() * 0.8, 11, 0.6);
    }
    for (let i = 0; i < 26 * n; i++) {
      const v = randDir((1 + Math.random() * 3) * spread);
      this.add.emit(x, y, z, v[0], v[1] + 0.8, v[2], 1, 0.78, 0.3, 1, 0.015 + Math.random() * 0.02, 0.6 + Math.random() * 0.9, 1.5, 1.5);
    }
    this.add.emit(x, y, z, 0, 0, 0, 1, 0.8, 0.45, 0.45, 0.45 * spread, 0.18, 0, 0, 2);
  }

  // Gold motes streaming inward while she re-forms.
  reform(x, y, z) {
    for (let i = 0; i < 50; i++) {
      const v = randDir(1);
      const r = 1.2 + Math.random() * 0.8;
      const sx = x + v[0] * r, sy = y + 0.9 + v[1] * r, sz = z + v[2] * r;
      this.add.emit(sx, sy, sz, (x - sx) * 2.2, (y + 0.9 - sy) * 2.2, (z - sz) * 2.2, 1, 0.8, 0.35, 1, 0.04, 0.45, 0, 0);
    }
  }

  // --- Power-ups -------------------------------------------------------------------------
  spawnPowerup(id, type, x, y, z) {
    const g = new THREE.Group();
    const gold = type === 'goldleaf';
    const model = gold && this.goldModel ? this.goldModel() : buildPowerupModel(type);
    g.add(model);
    const glow = new THREE.Sprite(gold ? this.goldGlowMat : this.glowMat);
    glow.scale.setScalar(gold ? 1.8 : 1.3);
    g.add(glow);
    g.position.set(x, y + 0.8, z);
    this.scene.add(g);
    this.powerups.set(id, { g, model, t: 0, life: gold ? 90 : 26, y: y + 0.8, gold });
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
    // Point sprites are sized in pixels: keep them world-sized whatever the
    // render height (the retro frame is only ~300 lines tall).
    const rig = this.rig;
    const h = rig.retro && rig.rt ? rig.rt.height : rig.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y;
    const ps = h / (2 * Math.tan(THREE.MathUtils.degToRad(rig.camera.fov) / 2));
    this.add.material.uniforms.scale.value = ps;
    this.alpha.material.uniforms.scale.value = ps;
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
    // Hellfire patches under warping hounds.
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) { this.fires.splice(i, 1); continue; }
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * 6.28, r = (0.25 + Math.random() * 0.35) * HS;
        this.add.emit(f.x + Math.cos(a) * r, f.y + 0.05, f.z + Math.sin(a) * r, 0, 1.2 + Math.random() * 1.4, 0,
          1, 0.35 + Math.random() * 0.3, 0.06, 0.9, 0.16 + Math.random() * 0.18, 0.35 + Math.random() * 0.3, -0.4, 1, -0.2);
      }
    }
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      // The bolt blinks twice; with reduced flashing it simply fades.
      b.line.material.opacity = this.rig.calm ? Math.max(0, b.life / 0.32) * 0.7 : b.life > 0.2 ? 1 : b.life > 0.14 ? 0.15 : Math.max(0, b.life / 0.14);
      if (b.life <= 0) b.line.visible = false;
    }
    this.updateChains(dt);
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
      if (p.look === 'orb') {
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
      if (Math.random() < 0.3) {
        const [r, g, b] = p.gold ? [1, 0.8, 0.35] : [0.4, 1, 0.5];
        this.add.emit(p.g.position.x + (Math.random() - 0.5) * 0.6, p.g.position.y - 0.3, p.g.position.z + (Math.random() - 0.5) * 0.6, 0, 0.6, 0, r, g, b, 0.8, 0.05, 0.8, 0, 0);
      }
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
    this.fires.length = 0;
    for (const b of this.bolts) { b.life = 0; b.line.visible = false; }
    this.chains.length = 0;
    this.chainLines.visible = false;
  }
}

function randDir(s) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [Math.cos(a) * r * s, u * s, Math.sin(a) * r * s];
}

