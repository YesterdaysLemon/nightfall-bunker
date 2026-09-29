// Cold War guns for the Aurora Picture Palace. Each builder is (B, M, K) => length:
// B is the weapons3d Builder, M its materials, K its kit (THREE, G, shapeFrom,
// along, triggerGuard, perforate, frontPost, buttPlate, PI, HALF, TAU).
// Conventions are the ones at the top of weapons3d.js: origin at the pistol grip,
// barrel toward -Z, anchors muzzle / sight / leftHand, and animated parts named
// for what their reload style moves (reloads.js):
//   mag   the magazine (the M14's box, the Python's crane and cylinder, the HK21's
//         belt box, the Gale Cannon's pressure canister)
//   bolt  the charging handle; its origin sits at the ejection port, where spent
//         cases fly from (the Gale Cannon's valve wheel)
//   pump  the slide-action fore-end (SPAS-12, China Lake)
// plus a few of their own (see each gun): the HK21's feed cover and belt, the
// Python's cylinder, ejector, rounds and hammer, the Gale Cannon's turbine fan.

import { partAt, endPart, boxMag, aperture, drumSight, hoodedPost, earPost, slottedHider, pistolGrip, slots } from './cw-kit.js';
import { spas12, hk21, chinalake, python } from './cw-heavy.js';
import { galecannon } from './galecannon.js';

// M14: a walnut one-piece stock with a half pistol grip, parkerized receiver with
// the bolt showing through its open top, the op-rod handle on the right ('bolt'),
// a short ventilated upper handguard, gas cylinder and front band, and the
// flash suppressor carrying the front sight between its ears.
function m14(B, M, K) {
  const by = 0.05;
  B.ext(M.wood, K.shapeFrom([
    [0.475, 0.036], [0.2, 0.042], [0.02, 0.044], [-0.03, 0.036], [-0.08, 0.026], [-0.2, 0.031], [-0.338, 0.037],
    [-0.346, 0.031], [-0.349, -0.03], [-0.344, -0.105], [-0.31, -0.106], [-0.13, -0.05], [-0.065, -0.04],
    [-0.035, -0.056], [0.0, -0.062], [0.02, -0.05], [0.028, -0.024], [0.075, -0.017], [0.16, -0.009],
    [0.45, 0.004], [0.475, 0.02],
  ]), 0.04);
  K.buttPlate(B, M.park, 0.14, -0.034, 0.351, 0.046);
  K.triggerGuard(B, M.park, -0.018, -0.046, 0.018, M.worn);
  B.tor(M.park, 0.008, 0.0016, K.TAU, 0, -0.09, 0.3, 0, K.HALF, 0, 4, 8);
  // receiver: solid rear with the aperture sight, open-topped middle, round front ring
  B.bx(M.park, 0.03, 0.03, 0.09, 0, 0.058, -0.015);
  for (const s of [-1, 1]) B.bx(M.park, 0.005, 0.022, 0.1, s * 0.0125, 0.054, -0.11);
  B.bx(M.park, 0.03, 0.006, 0.1, 0, 0.046, -0.11);
  B.tz(M.park, 0.0165, 0.0165, -0.19, -0.16, 0, by, 10);
  aperture(B, M, K, M.park, 0.09, 0.02, { w: 0.022 });
  for (const s of [-1, 1]) B.tx(M.worn, 0.005, 0.005, s * 0.0135, 0.078, 0.022, 8);
  // upper handguard, barrel, gas cylinder, front band
  B.tz(M.wood, 0.0155, 0.0155, -0.43, -0.195, 0, by + 0.004, 8, false, 0.95, 1);
  for (const s of [-1, 1]) slots(B, M, s * 0.0148, 0.059, -0.41, -0.22, 4, 0.004, 0.024);
  B.tz(M.park, 0.0165, 0.0165, -0.44, -0.43, 0, by + 0.003, 8);
  B.tz(M.steel, 0.0085, 0.0105, -0.705, -0.19, 0, by, 10);
  B.tz(M.park, 0.0105, 0.0105, -0.6, -0.475, 0, 0.026, 8);
  B.tz(M.park, 0.0078, 0.009, -0.615, -0.6, 0, 0.026, 8);
  B.bx(M.park, 0.03, 0.05, 0.02, 0, 0.034, -0.48);
  B.bx(M.park, 0.022, 0.036, 0.022, 0, 0.038, -0.59);
  B.bx(M.park, 0.008, 0.01, 0.03, 0, 0.012, -0.61);
  B.tor(M.park, 0.008, 0.0016, K.TAU, 0, -0.006, -0.44, 0, K.HALF, 0, 4, 8);
  // flash suppressor and front sight
  slottedHider(B, M, K, M.park, 0.0125, by, -0.765, -0.703, 5);
  earPost(B, M, K, M.park, 0.09, -0.738, by + 0.012);
  // magazine
  partAt(B, K, 'mag', [0, 0.035, -0.1]);
  boxMag(B, M, K, M.park, { y: 0.035, z: -0.1, len: 0.135, d: 0.058, w: 0.024, sweep: 0.008, ribs: 2 });
  endPart(B);
  // bolt and op-rod handle (right); cases leave from the open top
  partAt(B, K, 'bolt', [0.012, 0.062, -0.1]);
  B.tz(M.worn, 0.0092, 0.0092, -0.155, -0.065, 0, by, 8);
  B.bx(M.worn, 0.006, 0.006, 0.012, 0.006, by + 0.009, -0.1);
  B.bx(M.worn, 0.008, 0.016, 0.034, 0.021, 0.052, -0.135);
  B.bx(M.worn, 0.012, 0.009, 0.012, 0.027, 0.058, -0.126);
  B.rod(M.worn, 0.0035, [0.018, 0.045, -0.15], [0.016, 0.038, -0.3]);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.767);
  B.anchor('sight', 0, 0.09, 0.02);
  B.anchor('leftHand', 0, 0.012, -0.33);
  return 1.12;
}

// MP5K: a stamped receiver with the round cocking tube on top, polymer trigger
// group and grip, a stubby vertical foregrip with a hand stop, the curved 30-round
// magazine, the rotary drum rear sight and hooded front post, and the charging
// handle on the left of the tube ('bolt', racked HK-style).
function mp5k(B, M, K) {
  const by = 0.046;
  const ty = 0.066;
  const sy = 0.103;
  B.tz(M.steel, 0.0165, 0.0165, -0.19, 0.05, 0, ty, 10);
  B.tz(M.steel, 0.012, 0.0165, -0.2, -0.19, 0, ty, 10);
  B.bx(M.steel, 0.031, 0.034, 0.16, 0, 0.04, -0.04);
  B.bx(M.polymer, 0.034, 0.05, 0.012, 0, 0.054, 0.056);
  B.tor(M.steel, 0.009, 0.0022, K.TAU, 0, 0.058, 0.07, 0, K.HALF, 0, 4, 8);
  B.bx(M.black, 0.0016, 0.013, 0.035, 0.0158, 0.058, -0.035);
  B.bx(M.black, 0.0016, 0.004, 0.075, -0.0166, ty, -0.145);
  for (const z of [-0.03, 0.01]) B.bx(M.black, 0.012, 0.0016, 0.004, 0, ty + 0.0163, z);
  drumSight(B, M, K, M.steel, sy, 0.03);
  hoodedPost(B, M, K, M.steel, sy, -0.19, ty + 0.0165);
  // barrel with the three-lug nut
  B.tz(M.steel, 0.0085, 0.0095, -0.255, -0.18, 0, by, 10);
  B.tz(M.steel, 0.011, 0.011, -0.232, -0.212, 0, by, 8);
  B.tz(M.black, 0.0048, 0.0048, -0.2558, -0.25, 0, by, 8);
  // handguard, foregrip and hand stop
  B.bx(M.polymer, 0.034, 0.036, 0.085, 0, 0.038, -0.1625);
  B.ext(M.polymer, K.shapeFrom([
    [0.158, 0.022], [0.186, 0.022], [0.188, 0.006], [0.192, -0.008], [0.188, -0.02], [0.195, -0.034], [0.19, -0.047],
    [0.197, -0.06], [0.194, -0.076], [0.186, -0.085], [0.172, -0.085], [0.166, -0.07], [0.16, -0.03], [0.157, 0.0],
  ]), 0.026, 0, 0.003);
  B.bx(M.polymer, 0.03, 0.022, 0.012, 0, 0.012, -0.212);
  // trigger group, grip, mag well
  B.bx(M.polymer, 0.03, 0.022, 0.09, 0, 0.012, 0.0);
  pistolGrip(B, M, K, M.polymer, { rake: 0.22, c: [0, -0.03, 0.022], w: 0.03, h: 0.095, d: 0.04 });
  K.triggerGuard(B, M.polymer, 0.001, -0.028, 0.016, M.steel);
  B.bx(M.steel, 0.003, 0.012, 0.004, -0.0165, 0.012, 0.02);
  B.bx(M.steel, 0.03, 0.03, 0.046, 0, 0.012, -0.085);
  B.bx(M.steel, 0.016, 0.004, 0.01, 0, -0.004, -0.06);
  partAt(B, K, 'mag', [0, 0.01, -0.087]);
  boxMag(B, M, K, M.steel, { y: 0.01, z: -0.087, len: 0.175, d: 0.034, w: 0.023, sweep: 0.05, ribs: 2 });
  endPart(B);
  partAt(B, K, 'bolt', [0.016, 0.058, -0.035]);
  B.bx(M.worn, 0.018, 0.006, 0.008, -0.024, ty + 0.003, -0.175);
  B.sp(M.worn, 0.0056, -0.034, ty + 0.004, -0.177, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.256);
  B.anchor('sight', 0, sy, 0.03);
  B.anchor('leftHand', 0, 0.028, -0.172);
  return 0.33;
}

// AK-74u: stamped receiver and dust cover, laminated (birch-red) handguards on the
// gas tube, the fat cylindrical muzzle booster, the triangular folding stock
// (extended), the plum grip and the curved plum 5.45 magazine, the long safety
// lever and the charging handle on the right ('bolt').
function ak74u(B, M, K) {
  const by = 0.05;
  B.bx(M.steel, 0.03, 0.044, 0.24, 0, 0.036, -0.06);
  B.tz(M.steel, 0.0155, 0.0155, -0.1, 0.058, 0, 0.056, 8, false, 1, 0.8);
  B.sp(M.worn, 0.005, 0, 0.062, 0.062, 1, 1, 1, 6, 4);
  // rear sight block and flip notch
  B.bx(M.steel, 0.024, 0.02, 0.03, 0, 0.068, -0.115);
  B.bx(M.steel, 0.022, 0.009, 0.004, 0, 0.0835, -0.104);
  for (const s of [-1, 1]) B.bx(M.steel, 0.006, 0.012, 0.004, s * 0.008, 0.088, -0.104);
  // handguards
  B.tz(M.steel, 0.009, 0.009, -0.29, -0.13, 0, 0.074, 8);
  B.tz(M.woodRed, 0.0135, 0.0125, -0.25, -0.13, 0, 0.073, 8);
  B.ext(M.woodRed, K.shapeFrom([
    [0.18, 0.06], [0.285, 0.06], [0.296, 0.046], [0.29, 0.026], [0.272, 0.019], [0.24, 0.024],
    [0.22, 0.019], [0.19, 0.018], [0.18, 0.03],
  ]), 0.034);
  B.bx(M.steel, 0.036, 0.006, 0.012, 0, 0.059, -0.178);
  // gas block, front sight, muzzle booster
  B.tz(M.steel, 0.0085, 0.0095, -0.33, -0.18, 0, by, 10);
  B.bx(M.steel, 0.024, 0.042, 0.025, 0, 0.061, -0.302);
  earPost(B, M, K, M.steel, 0.0905, -0.305, 0.082);
  B.tz(M.worn, 0.0125, 0.0125, -0.335, -0.325, 0, by, 8);
  B.tz(M.steel, 0.0165, 0.0165, -0.39, -0.333, 0, by, 10);
  B.tz(M.steel, 0.02, 0.0165, -0.405, -0.39, 0, by, 10);
  B.tz(M.black, 0.012, 0.012, -0.4058, -0.4, 0, by, 8);
  // grip, guard, mag catch, safety lever
  pistolGrip(B, M, K, M.plum, { rake: 0.32, c: [0, -0.025, 0.022], w: 0.028, h: 0.095, d: 0.036 });
  K.triggerGuard(B, M.steel, 0.012, -0.03, 0.017, M.worn);
  B.bx(M.steel, 0.012, 0.012, 0.004, 0, 0.008, -0.07);
  B.bx(M.steel, 0.003, 0.012, 0.075, 0.0165, 0.046, -0.012, 0.1);
  B.bx(M.steel, 0.004, 0.016, 0.01, 0.017, 0.037, -0.048);
  B.bx(M.black, 0.0014, 0.013, 0.05, 0.0152, 0.052, -0.045);
  // folding stock, extended: hinge block, two struts and the butt plate
  B.bx(M.steel, 0.034, 0.05, 0.02, 0, 0.036, 0.068);
  B.cy(M.worn, 0.005, 0.005, 0.054, -0.017, 0.036, 0.072, 0, 0, 0, 6);
  B.bx(M.steel, 0.018, 0.016, 0.25, 0, 0.046, 0.2);
  B.rod(M.steel, 0.0065, [0, 0.018, 0.078], [0, -0.058, 0.32]);
  B.bx(M.steel, 0.036, 0.13, 0.012, 0, -0.008, 0.33);
  B.bx(M.steel, 0.03, 0.012, 0.03, 0, 0.052, 0.318);
  partAt(B, K, 'mag', [0, 0.018, -0.095]);
  boxMag(B, M, K, M.plum, { y: 0.018, z: -0.095, len: 0.2, d: 0.038, w: 0.024, sweep: 0.075, ribs: 1 });
  endPart(B);
  partAt(B, K, 'bolt', [0.0155, 0.05, -0.05]);
  B.bx(M.worn, 0.004, 0.01, 0.07, 0.0165, 0.05, -0.06);
  B.bx(M.worn, 0.014, 0.006, 0.008, 0.023, 0.05, -0.09);
  B.sp(M.worn, 0.0055, 0.031, 0.05, -0.09, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.406);
  B.anchor('sight', 0, 0.0905, -0.104);
  B.anchor('leftHand', 0, 0.032, -0.235);
  return 0.74;
}

// Galil: a milled parkerized receiver, ribbed polymer handguard with the folded
// bipod beneath, tall front sight on the gas block, birdcage flash hider, the long
// 35-round magazine, the tubular folding stock (extended) and the charging handle
// bent up on the right ('bolt') so the left hand can work it over the top.
function galil(B, M, K) {
  const by = 0.05;
  B.bx(M.park, 0.032, 0.05, 0.27, 0, 0.037, -0.07);
  B.tz(M.park, 0.0165, 0.0165, -0.19, 0.06, 0, 0.056, 8, false, 1, 0.75);
  aperture(B, M, K, M.park, 0.09, 0.045, { base: 0.018, w: 0.022 });
  B.bx(M.black, 0.0014, 0.014, 0.05, 0.0162, 0.05, -0.05);
  B.bx(M.park, 0.003, 0.01, 0.045, 0.0175, 0.03, 0.0, 0.2);
  // barrel, gas block, front sight
  B.tz(M.steel, 0.009, 0.0105, -0.64, -0.2, 0, by, 10);
  B.bx(M.park, 0.022, 0.04, 0.028, 0, 0.058, -0.5);
  earPost(B, M, K, M.park, 0.09, -0.505, 0.078, 0.008);
  B.tz(M.park, 0.008, 0.008, -0.49, -0.2, 0, 0.072, 8);
  // ribbed handguard with its cap
  B.bx(M.polymer, 0.04, 0.05, 0.235, 0, 0.052, -0.3225);
  for (const y of [0.036, 0.052, 0.068]) B.bx(M.polymer, 0.0445, 0.006, 0.215, 0, y, -0.3225);
  for (const s of [-1, 1]) for (const y of [0.044, 0.06]) slots(B, M, s * 0.0203, y, -0.42, -0.225, 5, 0.004, 0.026);
  B.bx(M.park, 0.042, 0.052, 0.01, 0, 0.052, -0.445);
  slottedHider(B, M, K, M.park, 0.012, by, -0.695, -0.64, 6);
  // folded bipod
  B.bx(M.park, 0.034, 0.012, 0.02, 0, 0.034, -0.49);
  for (const s of [-1, 1]) {
    B.rod(M.park, 0.0042, [s * 0.012, 0.034, -0.49], [s * 0.02, 0.022, -0.28]);
    B.bx(M.park, 0.008, 0.006, 0.02, s * 0.02, 0.02, -0.272);
  }
  // grip, guard, mag catch
  pistolGrip(B, M, K, M.polymer, { rake: 0.28, c: [0, -0.028, 0.02], w: 0.03, h: 0.1, d: 0.04 });
  K.triggerGuard(B, M.park, 0.01, -0.032, 0.017, M.worn);
  B.bx(M.park, 0.014, 0.012, 0.006, 0, 0.006, -0.07);
  // tubular folding stock, extended
  B.bx(M.park, 0.034, 0.05, 0.02, 0, 0.037, 0.075);
  B.rod(M.steel, 0.0065, [0, 0.05, 0.085], [0, 0.046, 0.33]);
  B.rod(M.steel, 0.0065, [0, 0.015, 0.085], [0, -0.06, 0.32]);
  B.bx(M.polymer, 0.04, 0.125, 0.018, 0, -0.008, 0.335);
  partAt(B, K, 'mag', [0, 0.015, -0.1]);
  boxMag(B, M, K, M.steel, { y: 0.015, z: -0.1, len: 0.235, d: 0.038, w: 0.024, sweep: 0.05, ribs: 2 });
  endPart(B);
  partAt(B, K, 'bolt', [0.017, 0.05, -0.05]);
  B.bx(M.worn, 0.004, 0.01, 0.07, 0.018, 0.048, -0.06);
  B.bx(M.worn, 0.012, 0.005, 0.008, 0.024, 0.048, -0.085);
  B.bx(M.worn, 0.005, 0.03, 0.008, 0.03, 0.062, -0.085);
  B.sp(M.worn, 0.006, 0.03, 0.078, -0.085, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.697);
  B.anchor('sight', 0, 0.09, 0.045);
  B.anchor('leftHand', 0, 0.04, -0.33);
  return 0.98;
}

// Dragunov: the long receiver and dust cover, ventilated laminated handguard, the
// thin barrel with its long slotted flash hider, the laminated skeleton stock with
// a cheek rest, a 10-round magazine and the PSO-1 style scope on a left side mount.
// The scope is open tubes (nothing opaque on its axis); the eyecup and eyepiece are
// lined with inward-facing black, with a chevron reticle in the lining. Aiming puts the eye 6 cm behind
// the eyecup (the sight anchor's depth sets that: the viewmodel holds a sight
// 0.24 m + a quarter of its z ahead of the eye), so the eyecup and lining frame a
// round window onto the zoomed world, and the turrets sit just outside that window.
function dragunov(B, M, K) {
  const by = 0.05;
  const sx = -0.012;
  const sy = 0.114;
  B.bx(M.steel, 0.03, 0.044, 0.25, 0, 0.036, -0.065);
  B.tz(M.steel, 0.0155, 0.0155, -0.17, 0.06, 0, 0.056, 8, false, 1, 0.8);
  B.bx(M.steel, 0.003, 0.012, 0.08, 0.0165, 0.046, 0.0, 0.1);
  B.bx(M.black, 0.0014, 0.013, 0.05, 0.0152, 0.052, -0.045);
  // iron sights under the scope
  B.bx(M.steel, 0.02, 0.012, 0.024, 0, 0.066, -0.155);
  // scope mount on the left side rail
  B.bx(M.steel, 0.006, 0.044, 0.13, -0.019, 0.052, -0.06);
  B.bx(M.steel, 0.008, 0.034, 0.025, sx - 0.004, 0.08, 0.034);
  B.bx(M.worn, 0.004, 0.012, 0.03, -0.0235, 0.056, -0.02);
  // scope: eyecup, eyepiece, tube, turrets, objective bell
  B.tz(M.polymer, 0.0178, 0.022, 0.048, 0.078, sx, sy, 10, true);
  B.tor(M.polymer, 0.0215, 0.0026, K.TAU, sx, sy, 0.078, 0, 0, 0, 4, 10);
  B.tz(M.steel, 0.0172, 0.0172, -0.02, 0.048, sx, sy, 10, true);
  const lining = new K.THREE.CylinderGeometry(0.017, 0.0212, 0.048, 10, 1, true);
  const ix = lining.index.array;
  for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
  B.add(lining, M.black, sx, sy, 0.054, -K.HALF, 0, 0);
  B.tz(M.steel, 0.0135, 0.0135, -0.2, -0.02, sx, sy, 10, true);
  B.cy(M.steel, 0.0105, 0.0105, 0.016, sx, sy + 0.0255, 0.03, 0, 0, 0, 10);
  B.cy(M.worn, 0.008, 0.0105, 0.004, sx, sy + 0.0355, 0.03, 0, 0, 0, 10);
  B.tx(M.steel, 0.0095, 0.016, sx - 0.0255, sy, 0.03, 10);
  B.tx(M.worn, 0.0075, 0.004, sx - 0.0355, sy, 0.03, 8);
  B.tz(M.steel, 0.021, 0.0135, -0.25, -0.2, sx, sy, 10, true);
  B.tz(M.steel, 0.021, 0.021, -0.282, -0.25, sx, sy, 10, true);
  B.tor(M.steel, 0.021, 0.0024, K.TAU, sx, sy, -0.282, 0, 0, 0, 4, 10);
  // PSO-1 chevrons and the horizontal stadia, in the lining
  const rz = 0.034;
  for (const [cy, s] of [[0, 1], [-0.0034, 0.8], [-0.0062, 0.8], [-0.009, 0.8]]) {
    for (const k of [-1, 1]) B.bx(M.black, 0.0026 * s, 0.0006, 0.0004, sx + k * 0.001 * s, sy + cy - 0.0009 * s, rz, 0, 0, k * 0.75);
  }
  for (const k of [-1, 1]) {
    B.bx(M.black, 0.0068, 0.0006, 0.0004, sx + k * 0.0058, sy, rz);
    for (let i = 1; i <= 3; i++) B.bx(M.black, 0.0006, 0.0014, 0.0004, sx + k * (0.0022 + i * 0.0014), sy + 0.0006, rz);
  }
  // handguard, gas block, barrel, flash hider
  B.bx(M.woodRed, 0.038, 0.046, 0.26, 0, 0.054, -0.32);
  for (const s of [-1, 1]) slots(B, M, s * 0.0192, 0.064, -0.43, -0.22, 5, 0.006, 0.024);
  B.bx(M.steel, 0.04, 0.05, 0.01, 0, 0.054, -0.455);
  B.bx(M.steel, 0.022, 0.04, 0.03, 0, 0.058, -0.475);
  B.bx(M.steel, 0.008, 0.012, 0.03, 0, 0.032, -0.49);
  B.tz(M.steel, 0.0085, 0.0105, -0.83, -0.19, 0, by, 10);
  earPost(B, M, K, M.steel, 0.066, -0.8, by + 0.009, 0.007);
  slottedHider(B, M, K, M.steel, 0.012, by, -0.9, -0.83, 5, 0.8);
  // skeleton stock with a cheek rest
  const stock = K.shapeFrom([
    [-0.058, 0.058], [-0.2, 0.06], [-0.38, 0.062], [-0.396, 0.06], [-0.405, 0.048], [-0.408, -0.02], [-0.402, -0.08],
    [-0.37, -0.086], [-0.2, -0.078], [-0.07, -0.086], [-0.035, -0.097], [0.0, -0.092], [0.018, -0.06],
    [0.024, -0.02], [0.022, 0.014], [-0.058, 0.014],
  ]);
  stock.holes.push(new K.THREE.Path(K.shapeFrom([
    [-0.075, 0.026], [-0.33, 0.029], [-0.35, 0.013], [-0.352, -0.04], [-0.335, -0.053], [-0.1, -0.056],
    [-0.05, -0.058], [-0.036, -0.045], [-0.034, -0.01], [-0.046, 0.013],
  ]).getPoints()));
  B.ext(M.woodRed, stock, 0.034);
  B.bx(M.bakelite, 0.04, 0.018, 0.14, 0, 0.069, 0.23);
  for (const z of [0.18, 0.28]) B.bx(M.steel, 0.042, 0.02, 0.006, 0, 0.066, z);
  K.buttPlate(B, M.steel, 0.15, -0.014, 0.41, 0.042);
  K.triggerGuard(B, M.steel, 0.012, -0.036, 0.018, M.worn);
  partAt(B, K, 'mag', [0, 0.018, -0.095]);
  boxMag(B, M, K, M.steel, { y: 0.018, z: -0.095, len: 0.125, d: 0.052, w: 0.024, sweep: 0.02, ribs: 3 });
  endPart(B);
  partAt(B, K, 'bolt', [0.0155, 0.05, -0.05]);
  B.bx(M.worn, 0.004, 0.01, 0.07, 0.0165, 0.05, -0.07);
  B.bx(M.worn, 0.014, 0.006, 0.008, 0.023, 0.05, -0.1);
  B.sp(M.worn, 0.0055, 0.031, 0.05, -0.1, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.9);
  B.anchor('sight', sx, sy, -0.4);
  B.anchor('leftHand', 0, 0.043, -0.33);
  return 1.22;
}

export const COLD_WAR_BUILDERS = { m14, mp5k, ak74u, galil, spas12, hk21, dragunov, python, chinalake, galecannon };
