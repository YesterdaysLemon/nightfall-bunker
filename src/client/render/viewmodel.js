// First-person weapon and hands, rendered in their own pass after clearing
// depth so they never clip into walls.
//
// Motion comes from three layers on top of the hip / aim pose:
//   - springs: recoil kicks the gun back and up and it settles with a little overshoot
//   - cycles: after a shot, the bolt, pump, slide or crank (reloads.js CYCLES)
//   - reloads: keyframed per style (reloads.js RELOADS). Both hands leave the gun
//     to fetch magazines, shells, clips, rockets and jars, and spent cases fly.

import * as THREE from 'three';
import { WEAPONS, reloadStyle } from '../../shared/weapons.js';
import { buildWeaponModel, buildHand, buildKnife, buildGrenade } from './weapons3d.js';
import { buildPerkBottle } from './machines.js';
import { RELOADS, CYCLES, STYLE_CYCLES, sampleTrack, sampleSteps } from './reloads.js';

const HIP = new THREE.Vector3(0.16, -0.19, -0.34);
const HIP_LEYDEN = new THREE.Vector3(0.17, -0.24, -0.44);   // lower and wider: the jar rack stays clear of the sights
const HIP_PISTOL = new THREE.Vector3(0.13, -0.15, -0.3);
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _o = new THREE.Vector3(), _e = new THREE.Euler(), _ej = new THREE.Vector3();
const _k6 = new Array(6).fill(0), _k7 = new Array(7).fill(0);

// Recoil springs: stiffness and damping (a little under critical, so it overshoots).
const SPRING_K = 320, SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.6;
// Where a hand goes to fetch something: below and behind, out of view.
const POCKET = { left: new THREE.Vector3(-0.14, -0.4, 0.22), right: new THREE.Vector3(0.12, -0.4, 0.22) };
// Default hold offset on a part used as a hand place (in the part's frame).
const PART_HOLD = { mag: [0, -0.07, 0.012] };

// Point a hand's grip axis (local +Y) along `grip` with its forearm (local +Z)
// running toward `forearm`.
function orient(q, grip, forearm) {
  _by.set(...grip).normalize();
  _bz.set(...forearm);
  _bz.addScaledVector(_by, -_bz.dot(_by)).normalize();
  _bx.crossVectors(_by, _bz);
  return q.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}
const ease = (t) => t * t * (3 - 2 * t);
const backOut = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

// Hand poses other than each hand's grip on the current gun.
const POSES = {
  post: orient(new THREE.Quaternion(), [0, 1, 0.1], [-0.35, -0.5, 0.8]),     // around a magazine or foregrip
  over: orient(new THREE.Quaternion(), [0.9, -0.2, -0.3], [-0.6, 0.1, 0.8]), // from above: clips, shells, jars
  crank: orient(new THREE.Quaternion(), [1, 0.2, 0], [-0.4, -0.6, 0.7]),     // pinching a crank knob
  side: orient(new THREE.Quaternion(), [0, 0.3, -1], [-0.9, -0.4, 0.15]),    // from the left, fist pointing forward: a revolver's cylinder, a speedloader
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    // No environment map: every gun, hand and world material is painted
    // Lambert/Phong (the 1997 look), which ignores one. Building it cost half a
    // second of boot for nothing.
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    // The models carry painted light (weapons3d.js): a soft, nearly neutral
    // fill plus a warm overhead key that agrees with the painted one, both
    // following the brightness where the player stands.
    this.hemi = new THREE.HemisphereLight(0xd2cdc4, 0x30261e, 1.2);
    this.key = new THREE.DirectionalLight(0xffe0bc, 1.0);
    this.key.position.set(-0.2, 1, 0.15);
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
    // Drinking a perk: a hand of its own brings the bottle up while the gun dips away.
    this.drinkHand = buildHand('left');
    this.drinkHand.visible = false;
    this.root.add(this.drinkHand);
    this.bottles = new Map();
    this.props = buildProps();
    for (const p of Object.values(this.props)) { p.visible = false; this.leftHand.add(p); }
    // Spent cases: a pool of slots, each with a rifle case, a shotgun shell and a 40 mm case.
    const proto = { case: casingMesh('case'), shell: casingMesh('shell'), case40: casingMesh('case40') };
    this.cases = Array.from({ length: 14 }, () => {
      const meshes = Object.fromEntries(Object.entries(proto).map(([k, m]) => [k, m.clone()]));
      for (const m of Object.values(meshes)) { m.visible = false; this.scene.add(m); }
      return { meshes, mesh: null, t: 0, v: new THREE.Vector3(), spin: new THREE.Vector3() };
    });

    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.muzzle.visible = false;
    this.muzzleT = 0;

    this.ads = 0;
    this.bobT = 0;
    this.bobAmt = 0;
    this.motion = 1;        // 0..1: bob, sway and breathing (reduced by the Reduce motion setting)
    this.sway = new THREE.Vector2();
    this.rec = new Float32Array(8);   // recoil springs: [z, vz, rx, vrx, ry, vry, rz, vrz]
    this.anim = null;       // {kind, t, dur, style}
    this.cycle = null;      // after-shot cycle {kind, t}
    this.switching = null;
    this.sprint = 0;
    this.down = 0;
    this.rounds = 1;        // rounds in the magazine (jar lights, the rocket, the slide lock)
    this.freezeU = null;    // tests: pin the reload at this progress
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
    // Both hands ride on the gun; their holds are their rest poses in its frame.
    this.current.add(this.rightHand, this.leftHand);
    this.hands = {
      right: { obj: this.rightHand, pos: new THREE.Vector3(0.004, -0.035, 0.01), quat: orient(new THREE.Quaternion(), [0, 1, 0.18], [0.3, -0.45, 0.85]) },
      left: { obj: this.leftHand, pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    };
    const L = this.hands.left;
    const g = WEAPONS[id]?.grip || 'rail';
    if (ud.leftHand) L.pos.copy(ud.leftHand.position);
    if (g === 'post') {        // vertical foregrip / magazine
      L.pos.y -= 0.06;
      orient(L.quat, [0, 1, 0.1], [-0.35, -0.5, 0.8]);
    } else if (g === 'cup') {  // pistol support hand
      L.pos.x -= 0.012; L.pos.y += 0.005;
      orient(L.quat, [0, 1, 0.2], [-0.45, -0.35, 0.8]);
    } else {                   // cradle a handguard from below
      L.pos.x -= 0.012; L.pos.y -= 0.05;
      orient(L.quat, [0.25, 0.1, -1], [-0.3, -0.95, 0.2]);
    }
    this.leftHand.visible = !!ud.leftHand;
    const mz = ud.muzzle;
    if (mz) mz.add(this.muzzle);
    this.sight = ud.sight ? ud.sight.position.clone() : new THREE.Vector3(0, 0.06, 0);
    this.parts = ud.parts || {};
    // Cache the authored pose once, never an interrupted reload/cycle pose.
    ud.rest ||= Object.fromEntries(Object.entries(this.parts).map(([k, p]) => [k, { pos: p.position.clone(), rot: p.rotation.clone() }]));
    this.rest = ud.rest;
    // The Leyden Rifle's jar cores: lit while charged.
    // Keep the original charged material across switches, even after a jar went dark.
    if (!ud.cores) {
      ud.cores = [];
      for (let i = 0; this.parts[`core${i}`]; i++) {
        const meshes = [];
        this.parts[`core${i}`].traverse((o) => { if (o.isMesh) meshes.push({ o, lit: o.material }); });
        ud.cores.push(meshes);
      }
    }
    this.cores = ud.cores;
  }

  fire(id, left = 1) {
    const W = WEAPONS[id];
    const r = this.rec, a = 1 - this.ads * 0.45;
    r[1] += W.kick * 26 * a;
    r[3] += W.kick * 75 * (1 - this.ads * 0.5);
    r[5] += (Math.random() - 0.5) * W.kick * 25;
    r[7] += (Math.random() - 0.5) * W.kick * 40;
    this.muzzle.visible = W.kind !== 'wonder';
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.muzzle.scale.setScalar(W.kind === 'shotgun' || W.kind === 'lmg' ? 1.6 : W.kind === 'pistol' ? 0.8 : 1.1);
    this.muzzleT = 0.045;
    this.flash.intensity = W.kind === 'wonder' ? (W.chain ? 4 : 0.6) : 3;
    this.flash.color.set(W.kind === 'wonder' ? 0x7ffcff : 0xffc27a);
    this.rounds = left;
    const cyc = STYLE_CYCLES[reloadStyle(W)] || (W.kind === 'bolt' ? 'bolt' : W.pump ? 'pump' : W.chain ? 'crank' : this.parts.slide ? 'slide' : null);
    if (cyc && !(cyc === 'slide' && left <= 0)) this.cycle = { kind: cyc, t: -CYCLES[cyc].delay, ejected: false };
    else if (cyc === 'slide') this.eject('case', 1);   // the last round: the slide locks back
    // Everything else with a bolt throws its brass (or a semi-auto shotgun's hull) straight out.
    if (!cyc && this.parts.bolt && W.kind !== 'rocket' && W.kind !== 'wonder') this.eject(W.kind === 'shotgun' ? 'shell' : 'case', 1);
  }

  reload(dur, style) {
    this.anim = { kind: 'reload', t: 0, dur, style: RELOADS[style] ? style : 'mag', ejected: false, empty: this.rounds <= 0 };
    this.cycle = null;
  }

  cancel() { if (this.anim?.kind === 'reload') this.anim = null; }
  knife() { this.anim = { kind: 'knife', t: 0, dur: 0.42 }; this.knifeModel.visible = true; }
  grenade() { this.anim = { kind: 'nade', t: 0, dur: 0.55 }; this.nadeModel.visible = true; }

  // Drink a perk: about two seconds with the bottle tipped back.
  drink(perk) {
    let b = this.bottles.get(perk);
    if (!b) {
      b = buildPerkBottle(perk);
      b.position.set(0.02, -0.06, -0.05);
      b.rotation.set(0.2, 0, -0.15);
      b.scale.setScalar(0.72);
      this.drinkHand.add(b);
      this.bottles.set(perk, b);
    }
    for (const [id, m] of this.bottles) m.visible = id === perk;
    this.anim = { kind: 'drink', t: 0, dur: 2.1 };
    this.drinkHand.visible = true;
  }

  get drinking() { return this.anim?.kind === 'drink'; }

  // Rounds in the magazine (set every frame by the game).
  setRounds(n) { this.rounds = n; }

  get busy() { return !!this.anim || !!this.switching; }

  update(dt, s) {
    // s: { moving (0..1), sprint (bool), ads (bool), dx, dy, light, down (bool), fov }
    if (this.switching) {
      const sw = this.switching;
      sw.t += dt;
      if (sw.t > 0.2 && !sw.swapped) { this.attach(sw.to); sw.swapped = true; }
      if (sw.t > 0.5) this.switching = null;
    }
    const adsTarget = s.ads && !this.anim && !this.switching ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 14);
    this.sprint += ((s.sprint && !s.ads ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    this.down += ((s.down ? 1 : 0) - this.down) * Math.min(1, dt * 5);
    this.bobAmt += (s.moving - this.bobAmt) * Math.min(1, dt * 8);
    this.bobT += dt * (6.5 + this.sprint * 4) * Math.max(0.2, s.moving);
    this.sway.x += (THREE.MathUtils.clamp(-s.dx * 0.0009, -0.06, 0.06) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(s.dy * 0.0009, -0.06, 0.06) - this.sway.y) * Math.min(1, dt * 10);
    this.springs(dt);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) { this.muzzle.visible = false; } }
    this.flash.intensity *= Math.exp(-dt * 40);

    const a = 1 - this.ads * 0.85;
    const m = this.motion;
    const bobX = Math.sin(this.bobT) * 0.011 * this.bobAmt * a * (1 + this.sprint) * m;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * this.bobAmt * a * (1 + this.sprint) * m;
    const breathe = Math.sin(performance.now() / 900) * 0.002 * a * m;

    // Base position: hip vs aim-down-sights.
    const sx = this.sight?.x ?? 0, sy = this.sight?.y ?? 0.06, sz = this.sight?.z ?? 0;
    const adsPos = this._v.set(-sx, -sy, -0.24 - sz * 0.25);
    const p = this.gunHolder.position;
    p.lerpVectors(WEAPONS[this.id]?.grip === 'cup' ? HIP_PISTOL : WEAPONS[this.id]?.chain ? HIP_LEYDEN : HIP, adsPos, ease(this.ads));
    const R = this.rec;
    p.x += bobX + this.sway.x * a * m;
    p.y += bobY + breathe + this.sway.y * a * m - this.sprint * 0.06 - this.down * 0.05;
    p.z += R[0];
    const r = this.gunHolder.rotation;
    r.set(
      R[2] * (1 - this.ads * 0.6) + this.sprint * -0.35 + this.sway.y * 2,
      R[4] + this.sway.x * 3 + this.sprint * 0.49,
      R[6] + this.sprint * 0.35 + bobX * 2,
    );

    // Switching: drop and roll away, then the new gun comes up with a small overshoot.
    if (this.switching) {
      const t = this.switching.t;
      const k = t < 0.2 ? ease(t / 0.2) : 1 - backOut(Math.min(1, (t - 0.2) / 0.3));
      p.y -= k * 0.3;
      p.x += k * 0.04;
      r.x -= k * 0.6;
      r.z -= k * 0.5;
    }
    this.animate(dt, p, r);
    this.updateCases(dt);
    this.hemi.intensity = 0.5 + s.light * 0.75;
    this.key.intensity = 0.3 + s.light * 0.8;
    this.camera.fov = 58 - this.ads * 8;
    this.camera.updateProjectionMatrix();
  }

  springs(dt) {
    const R = this.rec;
    const n = dt > 1 / 45 ? 2 : 1, h = Math.min(dt, 0.1) / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 8; i += 2) {
        R[i + 1] += (-SPRING_K * R[i] - SPRING_C * R[i + 1]) * h;
        R[i] += R[i + 1] * h;
      }
    }
    R[0] = Math.min(0.1, R[0]);
    R[2] = Math.min(0.4, R[2]);
  }

  animate(dt, p, r) {
    const P = this.parts, rest = this.rest;
    for (const [k, part] of Object.entries(P)) {
      if (part && rest[k]) { part.position.copy(rest[k].pos); part.rotation.copy(rest[k].rot); part.visible = true; }
    }
    // Magazine state at rest: a spent rocket tube is empty, a pistol's slide locks back.
    const reloading = this.anim?.kind === 'reload';
    // Parts that turn on their own (userData.spin, rad/s about Z: the Gale Cannon's
    // turbine) whirl after a shot, stall through a reload and spin up as it ends.
    for (const part of Object.values(P)) {
      const ud = part.userData;
      if (!ud.spin) continue;
      const k = this.cycle ? 8 : reloading ? (this.anim.t / this.anim.dur > 0.85 ? 5 : 0) : 1;
      ud.rate = (ud.rate ?? ud.spin) + (ud.spin * k - (ud.rate ?? ud.spin)) * Math.min(1, dt * 3);
      ud.angle = ((ud.angle || 0) + ud.rate * dt) % (Math.PI * 2);
      part.rotation.z += ud.angle;
    }
    if (!reloading && WEAPONS[this.id]?.kind === 'rocket' && P.mag) P.mag.visible = this.rounds > 0;
    if (P.slide && this.rounds <= 0 && !this.cycle) P.slide.position.z = rest.slide.pos.z + 0.03;
    const hands = { left: 'grip', right: 'grip' };
    let prop = null;

    if (this.cycle) {
      const c = this.cycle, C = CYCLES[c.kind];
      c.t += dt;
      const u = Math.max(0, Math.min(1, c.t / C.dur));
      if (c.t >= 0) {
        this.play(C, u, p, r, hands);
        if (C.eject && !c.ejected && u >= C.eject[0]) { c.ejected = true; this.eject(C.eject[1], C.eject[2]); }
      }
      if (c.t >= C.dur) this.cycle = null;
    }

    const A = this.anim;
    if (A) {
      A.t += dt;
      if (this.freezeU != null && A.kind === 'reload') A.t = this.freezeU * A.dur;
      const u = Math.min(1, A.t / A.dur);
      if (A.kind === 'reload') {
        const S = RELOADS[A.style];
        this.play(S, u, p, r, hands);
        if (S.prop) prop = sampleSteps(S.prop, u).a;
        if (S.eject && !A.ejected && u >= S.eject[0]) { A.ejected = true; this.eject(S.eject[1], S.eject[2], S.eject[3] === 'drop'); }
        if (A.style === 'jar') this.showCharge(u < 0.15 ? this.rounds : u < 0.72 ? 0 : Math.min(this.cores.length, Math.floor((u - 0.72) / 0.05) + 1));
      } else if (A.kind === 'knife') {
        const thrust = Math.sin(u * Math.PI);
        p.x += thrust * 0.12; p.y -= thrust * 0.12; r.z -= thrust * 0.5;
        this.knifeModel.position.set(0.12 - thrust * 0.1, -0.16 + thrust * 0.04, -0.2 - thrust * 0.28);
        this.knifeModel.rotation.set(-0.2, 0.3 - thrust * 0.5, -0.6 + thrust * 0.3);
      } else if (A.kind === 'drink') {
        // The gun dips out of sight, the bottle comes up to the mouth and tips back.
        const down = Math.min(1, u / 0.18, (1 - u) / 0.15);
        p.y -= down * 0.45; r.x -= down * 0.7;
        const up = Math.min(1, Math.max(0, (u - 0.1) / 0.25)) * Math.min(1, Math.max(0, (0.92 - u) / 0.2));
        const e = up * up * (3 - 2 * up);
        const tip = Math.min(1, Math.max(0, (u - 0.4) / 0.2)) * Math.min(1, Math.max(0, (0.8 - u) / 0.12));
        const glug = Math.sin(A.t * 11) * 0.012 * tip;
        this.drinkHand.position.set(-0.04 + (1 - e) * -0.1, -0.44 + e * 0.33 + glug, -0.34 - e * 0.02);
        this.drinkHand.rotation.set(-0.4 + e * 0.4 + tip * 1.25, 0.3, 0.2 - tip * 0.15);
      } else if (A.kind === 'nade') {
        p.y -= Math.sin(u * Math.PI) * 0.18; r.x -= Math.sin(u * Math.PI) * 0.4;
        const k = u < 0.5 ? u / 0.5 : 1;
        this.nadeModel.position.set(-0.15 + k * 0.05, -0.1 + Math.sin(k * Math.PI) * 0.16, -0.25 - k * 0.3);
        this.nadeModel.rotation.x = k * 6;
        if (u > 0.55) this.nadeModel.visible = false;
      }
      if (A.t >= A.dur && this.freezeU == null) {
        this.anim = null;
        this.knifeModel.visible = false;
        this.nadeModel.visible = false;
        this.drinkHand.visible = false;
      }
    }
    if (!reloading || this.anim?.style !== 'jar') this.showCharge(this.rounds);
    for (const [name, obj] of Object.entries(this.props)) obj.visible = name === prop;
    if (this.hands) {
      this.placeHand('right', hands.right);
      this.placeHand('left', hands.left);
    }
  }

  // Apply one choreography (a reload style or a cycle) at progress u.
  play(S, u, p, r, hands) {
    if (S.gun) {
      sampleTrack(S.gun, u, _k6, 6);
      const m = this.motion < 1 ? 0.6 : 1;   // reduced motion: smaller swings
      p.x += _k6[0] * m; p.y += _k6[1] * m; p.z += _k6[2] * m;
      r.x += _k6[3] * m; r.y += _k6[4] * m; r.z += _k6[5] * m;
    }
    for (const [name, keys] of Object.entries(S.parts || {})) {
      const part = this.parts[name], rest = this.rest[name];
      if (!part || !rest || (S.emptyOnly?.includes(name) && !this.anim?.empty)) continue;
      const i = sampleTrack(keys, u, _k7, 6);
      part.position.set(rest.pos.x + _k7[0], rest.pos.y + _k7[1], rest.pos.z + _k7[2]);
      part.rotation.set(rest.rot.x + _k7[3], rest.rot.y + _k7[4], rest.rot.z + _k7[5], rest.rot.order);
      const shown = keys[Math.max(0, i)][1][6];
      if (shown !== undefined) part.visible = shown > 0.5;
    }
    if (S.left) hands.left = sampleSteps(S.left, u);
    if (S.right) hands.right = sampleSteps(S.right, u);
  }

  // Put a hand at a place, or between two ({ a, b, t } from sampleSteps).
  placeHand(side, spec) {
    const H = this.hands[side];
    if (typeof spec === 'string' || Array.isArray(spec)) {
      this.handPlace(side, spec, H.obj.position, H.obj.quaternion);
      return;
    }
    this.handPlace(side, spec.a, _pa, _qa);
    this.handPlace(side, spec.b, _pb, _qb);
    H.obj.position.lerpVectors(_pa, _pb, spec.t);
    H.obj.quaternion.slerpQuaternions(_qa, _qb, spec.t);
  }

  handPlace(side, spec, pos, quat) {
    const H = this.hands[side];
    const [name, off, pose] = Array.isArray(spec) ? spec : [spec, null, null];
    const part = this.parts[name];
    if (name === 'pocket') {
      pos.copy(H.pos).add(POCKET[side]);
      quat.copy(H.quat);
    } else if (name === 'at') {
      pos.set(...off);
      quat.copy(POSES[pose] || H.quat);
    } else if (part && name !== 'grip') {
      _o.set(...(off || PART_HOLD[name] || [0, 0, 0])).applyEuler(_e.copy(part.rotation));
      pos.copy(part.position).add(_o);
      quat.copy(POSES[pose || (name === 'mag' ? 'post' : '')] || H.quat);
    } else {
      pos.copy(H.pos);
      quat.copy(H.quat);
      // The support hand rides the pump.
      if (side === 'left' && this.parts.pump) pos.z += this.parts.pump.position.z - this.rest.pump.pos.z;
    }
  }

  // Light the first n Leyden jars; the rest go dark.
  showCharge(n) {
    this.cores?.forEach((meshes, i) => {
      for (const m of meshes) {
        const lit = i < n;
        if (m.lit.transparent) m.o.visible = lit;
        else m.o.material = lit ? m.lit : DIM_CORE;
      }
    });
  }

  // Throw spent cases out of the gun's ejection port (or breech), to the right and up;
  // `drop` lets a revolver's empties fall out of its cylinder ('rounds') instead.
  eject(kind, count = 1, drop = false) {
    if (!this.current) return;
    const src = (drop && this.parts.rounds) || this.parts.bolt || this.parts.slide || this.parts.pump || this.parts.barrels;
    this.current.updateWorldMatrix(true, true);
    const at = src ? this.current.worldToLocal(src.getWorldPosition(_ej)) : _o.set(0, 0.06, -0.05);
    for (let i = 0; i < count; i++) {
      const c = this.cases.find((q) => q.t <= 0) || this.cases.reduce((x, y) => (y.t < x.t ? y : x));
      if (c.mesh) c.mesh.visible = false;
      c.mesh = c.meshes[kind];
      c.mesh.visible = true;
      if (drop) _pa.set(at.x + Math.cos(i * 1.05) * 0.011, at.y + Math.sin(i * 1.05) * 0.011, at.z);
      else _pa.set(at.x + 0.02, at.y + 0.015, at.z + i * 0.02);
      this.current.localToWorld(_pa);
      this.scene.worldToLocal(_pa);
      c.mesh.position.copy(_pa);
      const back = kind === 'shell' && this.anim?.style === 'break';
      // Keep cases away from the camera plane; crossing it magnifies a shell
      // to fill the screen. Break-action empties flick sideways and down.
      if (drop) c.v.set((Math.random() - 0.5) * 0.3, -0.3 - Math.random() * 0.4, -0.1);
      else c.v.set(back ? 0.65 + i * 0.18 : 1.1 + Math.random() * 0.5, back ? 0.35 : 1.3 + Math.random() * 0.5, -0.35);
      c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      c.t = 0.7;
    }
  }

  updateCases(dt) {
    for (const c of this.cases) {
      if (c.t <= 0) continue;
      c.t -= dt;
      c.v.y -= 7 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.t <= 0 || c.mesh.position.z > -0.12) { c.t = 0; c.mesh.visible = false; c.mesh = null; }
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
    return out.applyMatrix4(mainCamera.matrixWorld);
  }
}

const DIM_CORE = new THREE.MeshBasicMaterial({ color: 0x1c3530 });

// What the left hand carries during reloads (in the hand's frame: fingers wrap
// toward -Z, so a held object sits just in front of the palm).
function buildProps() {
  const brass = new THREE.MeshLambertMaterial({ color: 0xc9a14a, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0x9a2a1c, flatShading: true });
  const steel = new THREE.MeshLambertMaterial({ color: 0x55585c, flatShading: true });
  const shell = () => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 7), red);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 7), brass);
    base.position.y = -0.03;
    g.add(hull, base);
    g.rotation.x = Math.PI / 2;
    return g;
  };
  const one = new THREE.Group();
  one.add(shell());
  one.position.set(0, 0.01, -0.03);
  const two = new THREE.Group();
  const s1 = shell(), s2 = shell();
  s1.position.x = -0.011; s2.position.x = 0.011;
  two.add(s1, s2);
  two.position.set(0, 0.01, -0.03);
  const clip = new THREE.Group();
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.058), steel);
  clip.add(strip);
  for (let i = 0; i < 5; i++) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.005, 0.055, 6), brass);
    r.position.set(0, 0.034, -0.022 + i * 0.011);
    clip.add(r);
  }
  clip.position.set(0, -0.01, -0.035);
  // A revolver speedloader held by its knob in the fist ('side' pose), six rounds in
  // a ring pointing out of the top of the fist.
  const speedloader = new THREE.Group();
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0095, 0.02, 6), steel);
  knob.position.y = -0.014;
  speedloader.add(new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 8), steel), knob);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.005, 0.03, 6), brass);
    r.position.set(Math.cos(a) * 0.0115, 0.018, Math.sin(a) * 0.0115);
    speedloader.add(r);
  }
  speedloader.position.set(0, 0.034, 0);
  // A 40 mm grenade held by its case in the fist ('side' pose), nose out of the top.
  const g40 = new THREE.Group();
  const olive = new THREE.MeshLambertMaterial({ color: 0x4f5634, flatShading: true });
  const c40 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.038, 8), brass);
  c40.position.y = -0.019;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.02, 0.044, 8), olive);
  nose.position.y = 0.022;
  g40.add(c40, nose);
  g40.position.set(0, 0.02, 0);
  return { shell: one, shells: two, clip, speedloader, shell40: g40 };
}

function casingMesh(kind) {
  if (kind === 'shell') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 7), new THREE.MeshLambertMaterial({ color: 0x9a2a1c, flatShading: true })));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 7), new THREE.MeshLambertMaterial({ color: 0xc9a14a, flatShading: true }));
    b.position.y = -0.03;
    g.add(b);
    return g;
  }
  if (kind === 'case40') return new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.038, 8), new THREE.MeshLambertMaterial({ color: 0xc9a14a, flatShading: true }));
  return new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.005, 0.03, 6), new THREE.MeshLambertMaterial({ color: 0xd8b25a, flatShading: true }));
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
