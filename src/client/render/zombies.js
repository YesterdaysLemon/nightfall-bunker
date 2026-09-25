// Zombies: one template rig drives 12 InstancedMeshes (one per body part)
// so every zombie on screen costs 13 draw calls total. Procedural animation;
// snapshot interpolation; death falls and headshot gore.

import * as THREE from 'three';
import { GeoBuilder, rng } from './geo.js';
import { ZS } from '../../shared/protocol.js';

const CAP = 48;
const CLOTH = 0, SKIN = 1;

// Palette carried in vertex colours; textures add grime and weave.
const COL = {
  cloth: [0.6, 0.64, 0.64], dark: [0.17, 0.15, 0.13], skin: [0.8, 0.83, 0.72],
  gore: [0.42, 0.06, 0.05], socket: [0.08, 0.06, 0.05], steel: [0.34, 0.37, 0.35],
};

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// Organic part: primitives -> transformed, lumpy, vertex-coloured, atlas UVs.
// spec: { t: 'cyl'|'sph'|'box', d: dims, p: [x,y,z], r: [rx,ry,rz], s: [sx,sy,sz], m: CLOTH|SKIN, c: colour, lump }
function partGeo(specs) {
  const geos = specs.map((sp) => {
    let g;
    const d = sp.d;
    if (sp.t === 'cyl') g = new THREE.CylinderGeometry(d[0], d[1], d[2], d[3] ?? 10, 3);
    else if (sp.t === 'sph') g = new THREE.SphereGeometry(d[0], d[1] ?? 12, d[2] ?? 9, 0, Math.PI * 2, 0, d[3] ?? Math.PI);
    else g = new THREE.BoxGeometry(d[0], d[1], d[2], 2, 2, 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(sp.p || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(sp.r || [0, 0, 0]))),
      new THREE.Vector3(...(sp.s || [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const lump = sp.lump ?? 0.006;
    const col = new Float32Array(pos.count * 3);
    const c = sp.c || (sp.m === SKIN ? COL.skin : COL.cloth);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = hash3(Math.round(x * 40), Math.round(y * 40), Math.round(z * 40)) - 0.5;
      pos.setXYZ(i, x + nrm.getX(i) * n * lump * 2, y + nrm.getY(i) * n * lump * 2, z + nrm.getZ(i) * n * lump * 2);
      const k = 0.85 + n * 0.3;
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
      uv.setX(i, uv.getX(i) * 0.5 + (sp.m === SKIN ? 0.5 : 0));
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
  return geos.reduce((acc, g) => (acc ? mergeSimple(acc, g) : g), null);
}

function makeAtlas(tex) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.drawImage(tex.uniform.image, 0, 0, 256, 256);
  ctx.drawImage(tex.skin.image, 256, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Zombies {
  constructor(rig, tex, audio, fx) {
    this.rig = rig;
    this.audio = audio;
    this.fx = fx;
    this.list = new Map();   // id -> zombie
    this.dying = [];
    this.time = 0;
    this.interpDelay = 110;

    const atlas = makeAtlas(tex);
    const material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
    const P = (specs) => partGeo(specs);
    const C = CLOTH, S = SKIN;
    const defs = {
      pelvis: P([
        { t: 'cyl', d: [0.165, 0.158, 0.22, 12], s: [1, 1, 0.7], m: C },
        { t: 'cyl', d: [0.172, 0.172, 0.05, 12], p: [0, 0.1, 0], s: [1, 1, 0.72], m: C, c: COL.dark, lump: 0.002 },
      ]),
      torso: P([
        { t: 'cyl', d: [0.205, 0.165, 0.56, 12], p: [0, 0.28, 0], s: [1, 1, 0.62], m: C, lump: 0.009 },
        { t: 'cyl', d: [0.075, 0.1, 0.07, 10], p: [0, 0.57, 0.01], m: C, lump: 0.004 },
        { t: 'sph', d: [0.075, 10, 8], p: [0.07, 0.25, 0.1], s: [1, 1.3, 0.35], m: S, c: COL.gore, lump: 0.01 },
        { t: 'box', d: [0.07, 0.34, 0.012], p: [-0.06, 0.3, 0.1], m: C, c: [0.45, 0.47, 0.46], lump: 0.002 },
      ]),
      head: P([
        { t: 'sph', d: [0.115, 14, 10], p: [0, 0.15, 0], s: [0.92, 1.12, 1.02], m: S, lump: 0.006 },
        { t: 'box', d: [0.13, 0.05, 0.1], p: [0, 0.035, 0.055], r: [0.35, 0, 0], m: S, lump: 0.004 },
        { t: 'box', d: [0.15, 0.025, 0.04], p: [0, 0.2, 0.095], m: S, lump: 0.003 },
        { t: 'box', d: [0.028, 0.045, 0.03], p: [0, 0.14, 0.115], m: S, lump: 0.002 },
        { t: 'sph', d: [0.028, 8, 6], p: [0.045, 0.165, 0.093], m: S, c: COL.socket, lump: 0 },
        { t: 'sph', d: [0.028, 8, 6], p: [-0.045, 0.165, 0.093], m: S, c: COL.socket, lump: 0 },
        { t: 'box', d: [0.1, 0.02, 0.02], p: [0, 0.06, 0.085], m: S, c: COL.gore, lump: 0 },
      ]),
      helmet: P([
        { t: 'sph', d: [0.135, 14, 7, Math.PI / 2], p: [0, 0.19, -0.005], s: [1, 0.95, 1.08], m: C, c: COL.steel, lump: 0.002 },
        { t: 'cyl', d: [0.14, 0.168, 0.06, 14], p: [0, 0.18, -0.012], s: [1, 1, 1.08], r: [-0.12, 0, 0], m: C, c: COL.steel, lump: 0.001 },
      ]),
      upperArm: P([{ t: 'cyl', d: [0.066, 0.055, 0.34, 9], p: [0, -0.165, 0], m: C }]),
      lowerArm: P([
        { t: 'cyl', d: [0.056, 0.047, 0.2, 9], p: [0, -0.1, 0], m: C },
        { t: 'cyl', d: [0.04, 0.034, 0.1, 8], p: [0, -0.24, 0], m: S },
        { t: 'box', d: [0.075, 0.09, 0.035], p: [0, -0.33, 0.01], m: S, lump: 0.004 },
        { t: 'box', d: [0.07, 0.07, 0.02], p: [0, -0.4, 0.03], r: [-0.55, 0, 0], m: S, lump: 0.004 },
      ]),
      upperLeg: P([{ t: 'cyl', d: [0.088, 0.07, 0.47, 10], p: [0, -0.23, 0], m: C }]),
      lowerLeg: P([
        { t: 'cyl', d: [0.072, 0.062, 0.36, 10], p: [0, -0.18, 0], m: C, c: COL.dark, lump: 0.003 },
        { t: 'box', d: [0.1, 0.075, 0.23], p: [0, -0.41, 0.045], m: C, c: COL.dark, lump: 0.003 },
      ]),
      eyes: new THREE.BoxGeometry(0.03, 0.018, 0.02).translate(0.045, 0.165, 0.11),
    };
    // Second eye merged in.
    const e2 = defs.eyes.clone().translate(-0.09, 0, 0);
    defs.eyes = mergeSimple(defs.eyes, e2);

    // Template rig.
    const J = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; };
    const root = new THREE.Object3D();
    const body = J('body', root, 0, 0, 0);
    const hips = J('hips', body, 0, 0.95, 0);
    const spine = J('spine', hips, 0, 0.06, 0);
    const neck = J('neck', spine, 0, 0.55, 0.02);
    const shL = J('shL', spine, 0.27, 0.49, 0), shR = J('shR', spine, -0.27, 0.49, 0);
    const elL = J('elL', shL, 0, -0.33, 0), elR = J('elR', shR, 0, -0.33, 0);
    const hipL = J('hipL', hips, 0.1, -0.04, 0), hipR = J('hipR', hips, -0.1, -0.04, 0);
    const knL = J('knL', hipL, 0, -0.46, 0), knR = J('knR', hipR, 0, -0.46, 0);
    this.rigJ = { root, body, hips, spine, neck, shL, shR, elL, elR, hipL, hipR, knL, knR };

    const parts = [
      ['pelvis', hips], ['torso', spine], ['head', neck], ['eyes', neck], ['helmet', neck],
      ['upperArm', shL], ['upperArm', shR], ['lowerArm', elL], ['lowerArm', elR],
      ['upperLeg', hipL], ['upperLeg', hipR], ['lowerLeg', knL], ['lowerLeg', knR],
    ];
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    this.parts = parts.map(([geoName, joint], i) => {
      const im = new THREE.InstancedMesh(defs[geoName], geoName === 'eyes' ? eyeMat : material, CAP);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      if (geoName !== 'eyes') {
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      }
      rig.scene.add(im);
      return { im, joint, name: geoName, head: geoName === 'head' || geoName === 'eyes' || geoName === 'helmet', skin: geoName === 'head' };
    });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
  }

  // --- Network sync -----------------------------------------------------------------
  // rows: [id, x, y, z, yaw, state, cls] in cm / milliradians. t = sample time (ms, local clock).
  applySnapshot(rows, t) {
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (const r of rows) {
      const id = r[0];
      seen.add(id);
      let z = this.list.get(id);
      if (!z) {
        z = this.create(id, r);
        this.list.set(id, z);
        this.onSpawn?.(z);
      }
      const s = z.samples;
      s.push({ t, x: r[1] / 100, y: r[2] / 100, z: r[3] / 100, yaw: r[4] / 1000, state: r[5] });
      if (s.length > 5) s.shift();
      if (z.state !== r[5]) { z.state = r[5]; z.stateT = 0; }
      z.cls = r[6];
    }
    for (const [id, z] of this.list) {
      if (!seen.has(id) && !z.killed) this.list.delete(id); // vanished without a kill event (e.g. nuke timing)
    }
  }

  create(id, r) {
    const R = rng(id * 7919);
    const tint = 0.8 + R() * 0.3;
    const hue = R();
    return {
      id, seed: id, samples: [], state: r[5], cls: r[6], stateT: 0, phase: R() * 6, speed: 0,
      x: r[1] / 100, y: r[2] / 100, z: r[3] / 100, yaw: r[4] / 1000,
      cloth: [tint * (0.92 + hue * 0.12), tint * (0.95 + 0.05 * R()), tint * (0.9 + (1 - hue) * 0.12)],
      skin: [0.85 + R() * 0.15, 0.85 + R() * 0.12, 0.8 + R() * 0.15],
      helmet: R() < 0.45,
      armDrop: R() * 0.5, limp: R() < 0.35 ? 0.25 + R() * 0.3 : 0, headTilt: (R() - 0.5) * 0.7,
      nextGroan: 1 + R() * 5, killed: false, headless: false,
    };
  }

  // Kill: freeze the current pose and play a fall.
  kill(id, kind, angle) {
    const z = this.list.get(id);
    if (!z) return null;
    this.list.delete(id);
    z.killed = true;
    z.deadT = 0;
    z.kind = kind;
    z.fallDir = angle;
    z.headless = kind === 1 && Math.random() < 0.7;
    z.fallSpeed = kind === 2 ? 2.5 : 1;
    this.dying.push(z);
    return z;
  }

  // Interpolated positions for hit tests.
  forEachTarget(fn) {
    for (const z of this.list.values()) fn(z.id, z.x, z.y, z.z, z.state);
  }

  get(id) { return this.list.get(id); }

  // --- Frame update -----------------------------------------------------------------------
  update(dt, now, listener) {
    this.time += dt;
    const rt = now - this.interpDelay;
    let n = 0;
    for (const z of this.list.values()) {
      this.interpolate(z, rt, dt);
      z.stateT += dt;
      this.pose(z, dt);
      this.write(z, n++);
      this.voice(z, dt, listener);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const z = this.dying[i];
      z.deadT += dt;
      if (z.deadT > 4.5) { this.dying.splice(i, 1); continue; }
      this.poseDead(z, dt);
      if (n < CAP) this.write(z, n++);
    }
    for (const p of this.parts) {
      p.im.count = n;
      p.im.instanceMatrix.needsUpdate = true;
      if (p.im.instanceColor) p.im.instanceColor.needsUpdate = true;
    }
  }

  interpolate(z, rt, dt) {
    const s = z.samples;
    if (!s.length) return;
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].t <= rt && s[i + 1].t >= rt) { a = s[i]; b = s[i + 1]; break; }
    }
    let u = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
    u = Math.max(0, Math.min(rt > b.t ? 1 + Math.min(0.5, (rt - b.t) / 100) : 1, u));
    const px = z.x, pz = z.z;
    z.x = a.x + (b.x - a.x) * u;
    z.y = a.y + (b.y - a.y) * u;
    z.z = a.z + (b.z - a.z) * u;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    z.yaw = a.yaw + dy * Math.min(1, u);
    const v = dt > 0 ? Math.hypot(z.x - px, z.z - pz) / dt : 0;
    z.speed += (Math.min(6, v) - z.speed) * Math.min(1, dt * 8);
  }

  pose(z, dt) {
    const J = this.rigJ;
    for (const k of ['body', 'hips', 'spine', 'neck', 'shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR']) J[k].rotation.set(0, 0, 0);
    J.body.position.set(0, 0, 0);
    const t = this.time + z.seed;
    const st = z.state;
    const moving = z.speed > 0.25;
    const run = z.cls === 2, jog = z.cls === 1;
    z.phase += dt * (moving ? z.speed * (run ? 2.3 : jog ? 2.6 : 3.4) : 0);
    const ph = z.phase;
    const sway = Math.sin(t * 1.3) * 0.05;

    if (st === ZS.RISE) {
      J.shL.rotation.x = -2.7 + Math.sin(t * 7) * 0.35;
      J.shR.rotation.x = -2.5 + Math.sin(t * 7 + 2) * 0.35;
      J.elL.rotation.x = -0.4; J.elR.rotation.x = -0.3;
      J.spine.rotation.x = 0.35 + Math.sin(t * 5) * 0.1;
      J.spine.rotation.z = Math.sin(t * 4) * 0.2;
      J.hipL.rotation.x = -0.5; J.knL.rotation.x = 0.9;
      J.neck.rotation.x = -0.3;
      return;
    }
    if (st === ZS.TEAR) {
      const k = z.stateT * (run ? 9 : 6);
      J.shL.rotation.x = -1.65 + Math.sin(k) * 0.45;
      J.shR.rotation.x = -1.65 + Math.sin(k + Math.PI) * 0.45;
      J.elL.rotation.x = -0.3 - Math.max(0, Math.sin(k)) * 0.8;
      J.elR.rotation.x = -0.3 - Math.max(0, Math.sin(k + Math.PI)) * 0.8;
      J.spine.rotation.x = 0.3 + Math.sin(k) * 0.05;
      J.spine.rotation.y = Math.sin(k) * 0.15;
      J.neck.rotation.set(0.15, 0, z.headTilt * 0.5);
      J.hipL.rotation.x = -0.15; J.knL.rotation.x = 0.25;
      return;
    }
    if (st === ZS.CLIMB) {
      const u = Math.min(1, z.stateT / (run ? 0.8 : 1.25));
      J.spine.rotation.x = 0.9 - u * 0.6;
      J.hipL.rotation.x = -1.3 * Math.sin(u * Math.PI); J.knL.rotation.x = 1.5 * Math.sin(u * Math.PI);
      J.hipR.rotation.x = -0.6 * Math.sin(Math.min(1, u * 1.3) * Math.PI); J.knR.rotation.x = 1.0 * Math.sin(u * Math.PI);
      J.shL.rotation.x = -1.2; J.shR.rotation.x = -1.0; J.elL.rotation.x = -0.6; J.elR.rotation.x = -0.5;
      J.neck.rotation.x = -0.4;
      return;
    }
    if (st === ZS.ATTACK) {
      const u = Math.min(1, z.stateT / (run ? 0.28 : 0.4));
      const swing = u < 0.7 ? -2.5 + u * 0.4 : -2.2 + (u - 0.7) / 0.3 * 1.8;
      J.shL.rotation.x = swing; J.shR.rotation.x = swing + 0.3;
      J.shL.rotation.z = 0.2; J.shR.rotation.z = -0.2;
      J.elL.rotation.x = -0.5; J.elR.rotation.x = -0.4;
      J.spine.rotation.x = 0.2 + u * 0.35;
      J.neck.rotation.x = -0.2;
      return;
    }
    // Locomotion (walking to a window or chasing).
    const amp = run ? 0.95 : jog ? 0.7 : 0.42;
    const s = Math.sin(ph), c = Math.cos(ph);
    if (moving) {
      J.hipL.rotation.x = s * amp;
      J.hipR.rotation.x = -s * amp * (1 - z.limp);
      J.knL.rotation.x = Math.max(0, -c) * amp * 1.4 + 0.05;
      J.knR.rotation.x = Math.max(0, c) * amp * 1.4 * (1 - z.limp * 0.5) + 0.05;
      J.body.position.y = Math.abs(c) * (run ? 0.07 : 0.035) - (run ? 0.05 : 0);
    }
    if (run) {
      J.spine.rotation.x = 0.45;
      J.shL.rotation.x = -0.35 - s * 0.9; J.shR.rotation.x = -0.35 + s * 0.9;
      J.elL.rotation.x = -1.3; J.elR.rotation.x = -1.3;
      J.neck.rotation.x = -0.35;
    } else {
      J.spine.rotation.x = (jog ? 0.3 : 0.16) + sway;
      J.spine.rotation.z = moving ? s * 0.07 : sway;
      J.shL.rotation.x = -1.4 + z.armDrop * 0.6 + Math.sin(t * 1.7) * 0.08;
      J.shR.rotation.x = -1.35 + Math.cos(t * 1.9) * 0.08;
      J.shL.rotation.z = 0.1; J.shR.rotation.z = -0.1;
      J.elL.rotation.x = -0.15; J.elR.rotation.x = -0.3;
      J.neck.rotation.set(-0.1 + Math.sin(t * 2.1) * 0.08, Math.sin(t * 0.7) * 0.2, z.headTilt);
    }
  }

  poseDead(z) {
    const J = this.rigJ;
    const u = Math.min(1, z.deadT * 2.2 * z.fallSpeed);
    const ease = u * u;
    J.body.rotation.set(0, 0, 0);
    J.body.position.set(0, 0, 0);
    J.spine.rotation.set(-0.2 * ease, 0, 0);
    J.shL.rotation.set(-2.4 * ease, 0, 0.4); J.shR.rotation.set(-2.0 * ease, 0, -0.5);
    J.elL.rotation.set(-0.3, 0, 0); J.elR.rotation.set(-0.8, 0, 0);
    J.hipL.rotation.set(-0.2, 0, 0.1); J.hipR.rotation.set(0.3, 0, -0.1);
    J.knL.rotation.set(0.4, 0, 0); J.knR.rotation.set(0.2, 0, 0);
    J.neck.rotation.set(-0.6 * ease, 0.5, 0);
    J.hips.rotation.set(0, 0, 0);
    z.fall = ease * (Math.PI / 2 - 0.08);
    z.sink = Math.max(0, z.deadT - 3.2) * 0.35;
  }

  write(z, i) {
    const J = this.rigJ;
    this._qy.setFromAxisAngle(this._up, z.yaw);
    if (z.killed) {
      // Fall away from the shot: rotate around a horizontal axis.
      const a = z.fallDir ?? z.yaw + Math.PI;
      this._axis.set(Math.cos(a), 0, -Math.sin(a));
      this._q.setFromAxisAngle(this._axis, z.fall || 0).multiply(this._qy);
      J.root.position.set(z.x, z.y - (z.sink || 0), z.z);
      J.root.quaternion.copy(this._q);
    } else {
      J.root.position.set(z.x, z.y, z.z);
      J.root.quaternion.copy(this._qy);
    }
    J.root.updateMatrixWorld(true);
    const c = this._c;
    for (const p of this.parts) {
      if ((p.head && z.headless) || (p.name === 'helmet' && !z.helmet)) {
        p.im.setMatrixAt(i, this._m.makeScale(0, 0, 0));
      } else {
        p.im.setMatrixAt(i, p.joint.matrixWorld);
      }
      if (p.im.instanceColor) {
        const col = p.skin ? z.skin : z.cloth;
        c.setRGB(col[0], col[1], col[2]);
        if (z.killed && z.kind === 2) c.multiplyScalar(0.35);
        p.im.setColorAt(i, c);
      }
    }
  }

  voice(z, dt, listener) {
    z.nextGroan -= dt;
    if (z.nextGroan > 0) return;
    const d = listener ? Math.hypot(listener.x - z.x, listener.z - z.z) : 0;
    z.nextGroan = 2.5 + Math.random() * 6 + d * 0.08;
    const pos = { x: z.x, y: z.y + 1.6, z: z.z };
    if (z.cls === 2 && z.state === ZS.CHASE && Math.random() < 0.5) this.audio.zombieScream(pos, z.seed);
    else this.audio.zombieGroan(pos, z.seed);
  }

  clear() {
    this.list.clear();
    this.dying.length = 0;
    for (const p of this.parts) p.im.count = 0;
  }
}

function mergeSimple(a, b) {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(a.attributes).filter((n) => b.attributes[n])) {
    const A = a.attributes[name], B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array); arr.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index.array, ib = b.index.array, off = a.attributes.position.count;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
