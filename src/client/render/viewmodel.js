// First-person weapon and hands, rendered in their own pass after clearing
// depth so they never clip into walls.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS } from '../../shared/weapons.js';
import { buildWeaponModel, buildHand, buildKnife, buildGrenade } from './weapons3d.js';

const HIP = new THREE.Vector3(0.16, -0.19, -0.34);
const HIP_PISTOL = new THREE.Vector3(0.13, -0.15, -0.3);
const GRIP = { thompson: 'post', mp40: 'post', m1911: 'cup', arcpistol: 'cup' };
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();

// Point a hand's grip axis (local +Y) along `grip` with its forearm (local +Z)
// running toward `forearm`.
function orient(hand, grip, forearm) {
  _by.set(...grip).normalize();
  _bz.set(...forearm);
  _bz.addScaledVector(_by, -_bz.dot(_by)).normalize();
  _bx.crossVectors(_by, _bz);
  hand.quaternion.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}
const ease = (t) => t * t * (3 - 2 * t);

export class ViewModel {
  constructor(renderer, mainScene) {
    this.scene = new THREE.Scene();
    // Metals need something to reflect or they render black.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    if (mainScene) { mainScene.environment = env; mainScene.environmentIntensity = 0.18; }
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xb8c4e0, 0x2a2018, 0.9);
    this.key = new THREE.DirectionalLight(0xffd7a8, 1.4);
    this.key.position.set(0.6, 1, 0.4);
    this.flash = new THREE.PointLight(0xffc27a, 0, 2.5, 1.5);
    this.flash.position.set(0.1, -0.05, -0.8);
    this.scene.add(this.hemi, this.key, this.flash);

    this.root = new THREE.Group();   // sway/bob
    this.scene.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);
    this.models = new Map();
    this.current = null;
    this.id = null;
    this.rightHand = buildHand('right');
    this.leftHand = buildHand('left');
    this.knifeModel = buildKnife();
    this.knifeModel.visible = false;
    this.root.add(this.knifeModel);
    this.nadeModel = buildGrenade();
    this.nadeModel.visible = false;
    this.root.add(this.nadeModel);

    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.muzzle.visible = false;
    this.muzzleT = 0;

    this.ads = 0;
    this.bobT = 0;
    this.bobAmt = 0;
    this.sway = new THREE.Vector2();
    this.kick = 0;
    this.kickRot = 0;
    this.anim = null;       // {kind, t, dur}
    this.cycle = null;      // bolt/pump/slide cycle after a shot
    this.switching = null;
    this.sprint = 0;
    this.down = 0;
    this._v = new THREE.Vector3();
  }

  model(id) {
    let m = this.models.get(id);
    if (!m) {
      m = buildWeaponModel(id);
      m.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
      m.visible = false;
      this.gunHolder.add(m);
      this.models.set(id, m);
    }
    return m;
  }

  setWeapon(id, instant = false) {
    if (this.id === id && !this.switching) return;
    if (instant || !this.current) {
      this.attach(id);
      return;
    }
    this.switching = { t: 0, to: id, swapped: false };
    this.anim = null;
    this.cycle = null;
  }

  attach(id) {
    if (this.current) this.current.visible = false;
    this.current = this.model(id);
    this.current.visible = true;
    this.id = id;
    const ud = this.current.userData;
    this.current.add(this.rightHand);
    this.rightHand.position.set(0.004, -0.035, 0.01);
    orient(this.rightHand, [0, 1, 0.18], [0.3, -0.45, 0.85]);
    const lh = ud.leftHand;
    if (lh) {
      lh.add(this.leftHand);
      const g = GRIP[id] || 'rail';
      if (g === 'post') {        // vertical foregrip / magazine
        this.leftHand.position.set(0, -0.06, 0);
        orient(this.leftHand, [0, 1, 0.1], [-0.35, -0.5, 0.8]);
      } else if (g === 'cup') {  // pistol support hand
        this.leftHand.position.set(-0.012, 0.005, 0);
        orient(this.leftHand, [0, 1, 0.2], [-0.45, -0.35, 0.8]);
      } else {                   // cradle a handguard from below
        this.leftHand.position.set(-0.012, -0.05, 0);
        orient(this.leftHand, [0.25, 0.1, -1], [-0.3, -0.95, 0.2]);
      }
    }
    const mz = ud.muzzle;
    if (mz) mz.add(this.muzzle);
    this.sight = ud.sight ? ud.sight.position.clone() : new THREE.Vector3(0, 0.06, 0);
    if (ud.sight) { this._v.set(0, 0, 0); ud.sight.localToWorld(this._v); this.current.worldToLocal(this._v); this.sight.copy(this._v); }
    this.parts = ud.parts || {};
    this.rest = {};
    for (const [k, p] of Object.entries(this.parts)) if (p) this.rest[k] = { pos: p.position.clone(), rot: p.rotation.clone() };
  }

  fire(id) {
    const W = WEAPONS[id];
    this.kick = Math.min(0.09, this.kick + W.kick * 0.9);
    this.kickRot = Math.min(0.35, this.kickRot + W.kick * 2.2);
    this.muzzle.visible = W.kind !== 'wonder';
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.muzzle.scale.setScalar(W.kind === 'shotgun' || W.kind === 'lmg' ? 1.6 : W.kind === 'pistol' ? 0.8 : 1.1);
    this.muzzleT = 0.045;
    this.flash.intensity = W.kind === 'wonder' ? 0.6 : 3;
    this.flash.color.set(W.kind === 'wonder' ? 0x7ffcff : 0xffc27a);
    if (W.kind === 'bolt') this.cycle = { kind: 'bolt', t: -0.12, dur: 0.75 };
    else if (W.pump) this.cycle = { kind: 'pump', t: -0.08, dur: 0.5 };
    else if (W.kind === 'pistol') this.cycle = { kind: 'slide', t: 0, dur: 0.09 };
  }

  reload(dur, kind) {
    this.anim = { kind: 'reload', t: 0, dur, style: kind };
    this.cycle = null;
  }

  cancel() { if (this.anim?.kind === 'reload') this.anim = null; }
  knife() { this.anim = { kind: 'knife', t: 0, dur: 0.42 }; this.knifeModel.visible = true; }
  grenade() { this.anim = { kind: 'nade', t: 0, dur: 0.55 }; this.nadeModel.visible = true; }

  get busy() { return !!this.anim || !!this.switching; }

  update(dt, s) {
    // s: { moving (0..1), sprint (bool), ads (bool), dx, dy, light, down (bool), fov }
    if (this.switching) {
      const sw = this.switching;
      sw.t += dt;
      if (sw.t > 0.2 && !sw.swapped) { this.attach(sw.to); sw.swapped = true; }
      if (sw.t > 0.48) this.switching = null;
    }
    const adsTarget = s.ads && !this.anim && !this.switching ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 14);
    this.sprint += ((s.sprint && !s.ads ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.down += ((s.down ? 1 : 0) - this.down) * Math.min(1, dt * 5);
    this.bobAmt += (s.moving - this.bobAmt) * Math.min(1, dt * 8);
    this.bobT += dt * (6.5 + this.sprint * 4) * Math.max(0.2, s.moving);
    this.sway.x += (THREE.MathUtils.clamp(-s.dx * 0.0009, -0.06, 0.06) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(s.dy * 0.0009, -0.06, 0.06) - this.sway.y) * Math.min(1, dt * 10);
    this.kick *= Math.exp(-dt * 16);
    this.kickRot *= Math.exp(-dt * 12);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) { this.muzzle.visible = false; } }
    this.flash.intensity *= Math.exp(-dt * 40);

    const a = 1 - this.ads * 0.85;
    const bobX = Math.sin(this.bobT) * 0.011 * this.bobAmt * a * (1 + this.sprint);
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * this.bobAmt * a * (1 + this.sprint);
    const breathe = Math.sin(performance.now() / 900) * 0.002 * a;

    // Base position: hip vs aim-down-sights.
    const sx = this.sight?.x ?? 0, sy = this.sight?.y ?? 0.06, sz = this.sight?.z ?? 0;
    const adsPos = this._v.set(-sx, -sy, -0.24 - sz * 0.25);
    const p = this.gunHolder.position;
    p.lerpVectors(GRIP[this.id] === 'cup' ? HIP_PISTOL : HIP, adsPos, ease(this.ads));
    p.x += bobX + this.sway.x * a;
    p.y += bobY + breathe + this.sway.y * a - this.sprint * 0.06 - this.down * 0.05;
    p.z += this.kick * (1 - this.ads * 0.5);
    const r = this.gunHolder.rotation;
    r.set(this.kickRot * (1 - this.ads * 0.6) + this.sprint * -0.35 + this.sway.y * 2, this.sway.x * 3 + this.sprint * 0.7 * 0.7, this.sprint * 0.35 + bobX * 2);

    // Switch dip.
    if (this.switching) {
      const u = this.switching.t < 0.2 ? this.switching.t / 0.2 : 1 - (this.switching.t - 0.2) / 0.28;
      p.y -= ease(Math.max(0, u)) * 0.3;
      r.x -= ease(Math.max(0, u)) * 0.7;
    }
    this.animate(dt, p, r);
    this.hemi.intensity = 0.35 + s.light * 0.55;
    this.key.intensity = 0.4 + s.light * 1.1;
    this.scene.environmentIntensity = 0.12 + s.light * 0.3;
    this.camera.fov = 58 - this.ads * 8;
    this.camera.updateProjectionMatrix();
  }

  animate(dt, p, r) {
    const P = this.parts, rest = this.rest;
    for (const [k, part] of Object.entries(P)) {
      if (part && rest[k]) { part.position.copy(rest[k].pos); part.rotation.copy(rest[k].rot); part.visible = true; }
    }
    if (this.cycle) {
      const c = this.cycle;
      c.t += dt;
      const u = Math.max(0, Math.min(1, c.t / c.dur));
      if (c.kind === 'bolt' && P.bolt && c.t > 0) {
        const lift = u < 0.25 ? u / 0.25 : u > 0.75 ? (1 - u) / 0.25 : 1;
        const back = u < 0.25 ? 0 : u < 0.5 ? (u - 0.25) / 0.25 : u < 0.75 ? 1 - (u - 0.5) / 0.25 : 0;
        P.bolt.rotation.z = rest.bolt.rot.z + lift * 1.3;
        P.bolt.position.z = rest.bolt.pos.z + back * 0.09;
        r.z += lift * 0.12; p.y -= lift * 0.01;
      } else if (c.kind === 'pump' && P.pump && c.t > 0) {
        P.pump.position.z = rest.pump.pos.z + Math.sin(u * Math.PI) * 0.1;
        r.x += Math.sin(u * Math.PI) * 0.05;
      } else if (c.kind === 'slide' && P.slide) {
        P.slide.position.z = rest.slide.pos.z + Math.sin(u * Math.PI) * 0.035;
      }
      if (c.t >= c.dur) this.cycle = null;
    }
    const A = this.anim;
    if (!A) return;
    A.t += dt;
    const u = Math.min(1, A.t / A.dur);
    if (A.kind === 'reload') {
      const dip = Math.sin(u * Math.PI);
      p.y -= dip * 0.07; p.x -= dip * 0.03;
      r.x += dip * 0.35; r.z += dip * 0.55; r.y += dip * 0.2;
      if (A.style === 'bolt' && P.bolt) {
        const k = (u * 5) % 1;
        P.bolt.rotation.z = rest.bolt.rot.z + (u > 0.05 && u < 0.95 ? 1.3 : 0);
        P.bolt.position.z = rest.bolt.pos.z + (u > 0.12 && u < 0.88 ? 0.09 : 0);
        r.z += Math.sin(k * Math.PI) * 0.04;
      } else if (A.style === 'break' && P.barrels) {
        P.barrels.rotation.x = rest.barrels.rot.x + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 0.55;
      } else if (A.style === 'pump' && P.pump) {
        P.pump.position.z = rest.pump.pos.z + (u > 0.85 ? Math.sin((u - 0.85) / 0.15 * Math.PI) * 0.1 : 0);
        r.z += Math.sin(u * 30) * 0.02;
      } else if (P.mag) {
        const out = u < 0.2 ? 0 : u < 0.4 ? (u - 0.2) / 0.2 : u < 0.6 ? 1 : u < 0.8 ? 1 - (u - 0.6) / 0.2 : 0;
        P.mag.position.y = rest.mag.pos.y - out * 0.28;
        P.mag.visible = out < 0.95;
        if (P.bolt && u > 0.82) P.bolt.position.z = rest.bolt.pos.z + Math.sin((u - 0.82) / 0.18 * Math.PI) * 0.05;
        if (P.slide && u > 0.85) P.slide.position.z = rest.slide.pos.z + Math.sin((u - 0.85) / 0.15 * Math.PI) * 0.03;
      }
    } else if (A.kind === 'knife') {
      const thrust = Math.sin(u * Math.PI);
      p.x += thrust * 0.12; p.y -= thrust * 0.12; r.z -= thrust * 0.5;
      this.knifeModel.position.set(0.12 - thrust * 0.1, -0.16 + thrust * 0.04, -0.2 - thrust * 0.28);
      this.knifeModel.rotation.set(-0.2, 0.3 - thrust * 0.5, -0.6 + thrust * 0.3);
      if (u >= 1) this.knifeModel.visible = false;
    } else if (A.kind === 'nade') {
      p.y -= Math.sin(u * Math.PI) * 0.18; r.x -= Math.sin(u * Math.PI) * 0.4;
      const k = u < 0.5 ? u / 0.5 : 1;
      this.nadeModel.position.set(-0.15 + k * 0.05, -0.1 + Math.sin(k * Math.PI) * 0.16, -0.25 - k * 0.3);
      this.nadeModel.rotation.x = k * 6;
      if (u > 0.55) this.nadeModel.visible = false;
    }
    if (A.t >= A.dur) {
      this.anim = null;
      this.knifeModel.visible = false;
      this.nadeModel.visible = false;
    }
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // Muzzle position in main-world space (for tracers), given the main camera.
  muzzleWorld(mainCamera, out) {
    const mz = this.current?.userData.muzzle;
    if (!mz) return out.set(0, 0, -1).applyMatrix4(mainCamera.matrixWorld);
    this.scene.updateMatrixWorld();
    mz.getWorldPosition(out);            // viewmodel camera space (camera sits at origin)
    out.z *= 1.0;
    return out.applyMatrix4(mainCamera.matrixWorld);
  }
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.translate(32, 32);
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(-4, 0); g.lineTo(0, -30); g.lineTo(4, 0);
    g.fill();
  }
  g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
