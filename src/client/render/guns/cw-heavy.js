// Cold War guns, heavier half: SPAS-12, HK21, China Lake and the Python revolver.
// Builders are (B, M, K) => length; see coldwar.js for the conventions.

import { partAt, endPart, aperture, drumSight, hoodedPost, earPost, slottedHider, pistolGrip, slots } from './cw-kit.js';

// SPAS-12: a tall parkerized receiver, the perforated heat shield over the top of
// the barrel, the magazine tube and its clamp, the deep-ribbed polymer pump
// ('pump'), a polymer grip and the pressed-steel folding stock (extended) with its
// arm hook. The bolt in the ejection port ('bolt') is where the hulls fly from.
export function spas12(B, M, K) {
  const by = 0.058;
  const ty = 0.022;
  B.bx(M.park, 0.042, 0.07, 0.2, 0, 0.035, -0.08);
  B.bx(M.park, 0.036, 0.008, 0.19, 0, 0.073, -0.085);
  B.bx(M.black, 0.0014, 0.022, 0.07, 0.0212, 0.05, -0.08);
  B.bx(M.black, 0.026, 0.0016, 0.08, 0, -0.0005, -0.125);
  for (const z of [-0.02, -0.165]) B.tx(M.worn, 0.003, 0.043, 0, 0.012, z, 6);
  aperture(B, M, K, M.park, 0.092, 0.005, { w: 0.02, base: 0.01 });
  // trigger group, grip
  B.bx(M.polymer, 0.036, 0.016, 0.07, 0, -0.006, 0.0);
  pistolGrip(B, M, K, M.polymer, { rake: 0.26, c: [0, -0.03, 0.02], w: 0.032, h: 0.1, d: 0.042 });
  K.triggerGuard(B, M.polymer, -0.012, -0.05, 0.018, M.steel);
  // barrel, perforated heat shield over its top, magazine tube, clamp, front sight
  B.tz(M.steel, 0.0115, 0.0125, -0.625, -0.18, 0, by, 10);
  B.tz(M.steel, 0.0135, 0.0135, -0.632, -0.605, 0, by, 10);
  B.tz(M.black, 0.0095, 0.0095, -0.6328, -0.627, 0, by, 8);
  const shield = new K.THREE.CylinderGeometry(0.018, 0.018, 0.27, 10, 1, true, -1.25, 2.5);
  B.add(shield, M.steel, 0, by, -0.315, -K.HALF, 0, 0);
  K.perforate(B, 0.018, by, -0.445, -0.19, 8, [-0.72, 0, 0.72], 0.0034, 1.3);
  for (const z of [-0.182, -0.448]) B.tz(M.steel, 0.0195, 0.0195, z - 0.004, z + 0.004, 0, by, 10);
  B.tz(M.steel, 0.011, 0.011, -0.56, -0.18, 0, ty, 10);
  B.tz(M.worn, 0.0115, 0.012, -0.586, -0.56, 0, ty, 10);
  B.bx(M.park, 0.026, 0.05, 0.016, 0, 0.04, -0.552);
  B.tor(M.park, 0.007, 0.0016, K.TAU, 0, 0.004, -0.575, 0, K.HALF, 0, 4, 8);
  B.bx(M.park, 0.01, 0.012, 0.016, 0, 0.074, -0.614);
  B.bx(M.park, 0.003, 0.018, 0.004, 0, 0.083, -0.614);
  // folding stock, extended: pressed strut, brace, butt and the arm hook
  B.bx(M.park, 0.018, 0.02, 0.3, 0, 0.052, 0.175, 0.07);
  B.rod(M.park, 0.0055, [0, 0.002, 0.035], [0, -0.05, 0.31]);
  B.bx(M.polymer, 0.044, 0.13, 0.016, 0, -0.004, 0.332);
  B.tor(M.park, 0.028, 0.0045, K.PI, 0, -0.07, 0.3, 0, -K.HALF, 0, 4, 6);
  partAt(B, K, 'pump', [0, 0.03, -0.3]);
  B.bx(M.polymer, 0.054, 0.056, 0.19, 0, 0.03, -0.3);
  for (let i = 0; i < 7; i++) B.bx(M.black, 0.0572, 0.036, 0.005, 0, 0.028, -0.225 - i * 0.025);
  for (const s of [-1, 1]) B.bx(M.steel, 0.004, 0.008, 0.12, s * 0.013, 0.02, -0.15);
  endPart(B);
  partAt(B, K, 'bolt', [0.018, 0.05, -0.08]);
  B.bx(M.worn, 0.004, 0.018, 0.06, 0.019, 0.05, -0.08);
  B.bx(M.worn, 0.012, 0.006, 0.008, 0.026, 0.05, -0.058);
  B.sp(M.worn, 0.005, 0.032, 0.05, -0.058, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.633);
  B.anchor('sight', 0, 0.092, 0.005);
  B.anchor('leftHand', 0, 0.03, -0.3);
  return 0.97;
}

// One 7.62 round lying along Z in a belt (case, bullet and its link).
function cartridge(B, M, x, y, z0) {
  B.tz(M.brass, 0.0055, 0.0058, z0 - 0.05, z0, x, y, 6);
  B.tz(M.copper, 0.0016, 0.0046, z0 - 0.071, z0 - 0.05, x, y, 6);
  B.bx(M.steel, 0.0125, 0.0035, 0.009, x, y + 0.0048, z0 - 0.02);
}

// HK21: the roller-delayed receiver with the cocking tube running forward over a
// vented handguard, drum rear sight and hooded front post, folded bipod, the G3
// polymer stock, and a belt feed: the feed cover on top ('cover', hinged at its
// rear), the 100-round box under the receiver ('mag') and the belt ('belt', riding
// on the box) that climbs the left side into the feed tray. The charging handle
// is on the left of the tube ('bolt'; its origin is the ejection port).
export function hk21(B, M, K) {
  const by = 0.05;
  const ty = 0.078;
  const sy = 0.106;
  B.bx(M.steel, 0.034, 0.056, 0.3, 0, 0.044, -0.1);
  B.bx(M.steel, 0.036, 0.06, 0.012, 0, 0.042, 0.055);
  B.bx(M.steel, 0.026, 0.014, 0.05, 0, 0.079, 0.025);
  drumSight(B, M, K, M.steel, sy, 0.035);
  B.bx(M.black, 0.0014, 0.014, 0.05, 0.0172, 0.05, -0.07);
  B.bx(M.worn, 0.03, 0.002, 0.16, 0, 0.0725, -0.115);
  B.bx(M.steel, 0.01, 0.028, 0.06, -0.021, 0.058, -0.12);
  // cocking tube, front sight, vented handguard, barrel, flash hider
  B.tz(M.steel, 0.0145, 0.0145, -0.56, -0.24, 0, ty, 10);
  B.tz(M.steel, 0.012, 0.0145, -0.572, -0.56, 0, ty, 10);
  hoodedPost(B, M, K, M.steel, sy, -0.555, ty + 0.0145);
  B.bx(M.black, 0.0016, 0.004, 0.1, -0.0148, ty, -0.44);
  B.bx(M.polymer, 0.042, 0.04, 0.26, 0, 0.045, -0.385);
  for (const s of [-1, 1]) for (const y of [0.036, 0.054]) slots(B, M, s * 0.0212, y, -0.5, -0.27, 6, 0.006, 0.02);
  B.tz(M.steel, 0.0095, 0.011, -0.74, -0.25, 0, by, 10);
  slottedHider(B, M, K, M.steel, 0.013, by, -0.8, -0.74, 4);
  B.bx(M.steel, 0.034, 0.012, 0.024, 0, 0.066, -0.535);
  for (const s of [-1, 1]) {
    B.rod(M.worn, 0.0042, [s * 0.014, 0.062, -0.535], [s * 0.026, 0.03, -0.32]);
    B.bx(M.steel, 0.01, 0.008, 0.018, s * 0.026, 0.028, -0.31);
  }
  // trigger group, grip, stock
  B.bx(M.polymer, 0.032, 0.022, 0.1, 0, 0.008, 0.0);
  pistolGrip(B, M, K, M.polymer, { rake: 0.25, c: [0, -0.032, 0.022], w: 0.03, h: 0.1, d: 0.04 });
  K.triggerGuard(B, M.polymer, -0.003, -0.03, 0.017, M.steel);
  B.ext(M.polymer, K.shapeFrom([
    [-0.05, 0.07], [-0.37, 0.058], [-0.378, 0.052], [-0.38, -0.02], [-0.374, -0.085], [-0.34, -0.088],
    [-0.12, 0.002], [-0.06, 0.012], [-0.05, 0.02],
  ]), 0.04);
  B.bx(M.bakelite, 0.046, 0.15, 0.012, 0, -0.016, 0.386);
  // belt box
  const bo = [-0.02, 0.012, -0.125];
  partAt(B, K, 'mag', bo);
  B.bx(M.olive, 0.07, 0.084, 0.11, -0.02, -0.031, -0.125);
  B.bx(M.olive, 0.074, 0.006, 0.114, -0.02, 0.008, -0.125);
  for (const x of [-0.057, 0.017]) B.bx(M.worn, 0.004, 0.02, 0.016, x, -0.01, -0.125);
  for (const z of [-0.085, -0.165]) B.bx(M.olive, 0.072, 0.07, 0.004, -0.02, -0.036, z);
  B.tor(M.worn, 0.016, 0.0024, K.PI, -0.057, -0.045, -0.125, 0, -K.HALF, K.HALF, 4, 6);
  // the belt: three rounds in the tray, the rest draped down the left side into the box
  const beltAt = [-0.02, 0.078, -0.11];
  partAt(B, K, 'belt', beltAt, [0, 0, 0], 'mag', bo);
  for (const [x, y] of [[0.004, 0.078], [-0.008, 0.078], [-0.02, 0.078], [-0.032, 0.075], [-0.042, 0.066], [-0.049, 0.054], [-0.052, 0.04], [-0.05, 0.026]]) {
    cartridge(B, M, x, y, -0.075);
  }
  endPart(B);
  // feed cover, hinged at its rear
  partAt(B, K, 'cover', [0, 0.072, -0.03]);
  B.bx(M.steel, 0.038, 0.016, 0.175, 0, 0.08, -0.1175);
  for (const z of [-0.07, -0.11, -0.15]) B.bx(M.steel, 0.028, 0.003, 0.005, 0, 0.0895, z);
  B.bx(M.worn, 0.02, 0.008, 0.01, 0, 0.083, -0.207);
  B.tx(M.steel, 0.0055, 0.038, 0, 0.074, -0.03, 8);
  endPart(B);
  partAt(B, K, 'bolt', [0.018, 0.05, -0.07]);
  B.bx(M.worn, 0.02, 0.006, 0.008, -0.024, ty + 0.002, -0.47, 0, 0.3, 0);
  B.sp(M.worn, 0.0058, -0.034, ty + 0.003, -0.476, 1, 1, 1, 8, 6);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.802);
  B.anchor('sight', 0, sy, 0.035);
  B.anchor('leftHand', 0, 0.037, -0.37);
  return 1.2;
}

// China Lake: a pump-action 40 mm launcher. A tall slab-sided receiver, the fat
// barrel with its gaping bore over a matching magazine tube, a wooden pump
// ('pump'), the raised ladder rear sight and tall front post, and a wooden stock.
// The breech bolt in the ejection port ('bolt') is where empties are thrown from.
export function chinalake(B, M, K) {
  const by = 0.066;
  const ty = 0.014;
  const sy = 0.126;
  B.bx(M.steel, 0.052, 0.102, 0.21, 0, 0.041, -0.095);
  B.bx(M.black, 0.002, 0.034, 0.08, 0.0262, 0.064, -0.1);
  B.bx(M.black, 0.03, 0.002, 0.09, 0, -0.0105, -0.13);
  for (const z of [-0.02, -0.17]) B.tx(M.worn, 0.004, 0.054, 0, 0.004, z, 6);
  B.bx(M.worn, 0.004, 0.014, 0.01, -0.027, 0.012, -0.04);
  B.bx(M.steel, 0.034, 0.014, 0.08, 0, -0.016, -0.03);
  K.triggerGuard(B, M.steel, -0.02, -0.05, 0.018, M.worn);
  B.ext(M.wood, K.shapeFrom([
    [0.012, 0.09], [-0.07, 0.068], [-0.34, 0.056], [-0.346, 0.05], [-0.348, -0.03], [-0.342, -0.112],
    [-0.31, -0.112], [-0.08, -0.042], [-0.02, -0.03], [0.012, -0.012],
  ]), 0.044);
  K.buttPlate(B, M.bakelite, 0.162, -0.028, 0.349, 0.05);
  // barrel, magazine tube, band
  B.tz(M.steel, 0.025, 0.025, -0.515, -0.2, 0, by, 10);
  B.tz(M.steel, 0.027, 0.027, -0.53, -0.505, 0, by, 10);
  B.tz(M.black, 0.02, 0.02, -0.5308, -0.522, 0, by, 10);
  B.tz(M.steel, 0.022, 0.022, -0.46, -0.2, 0, ty, 10);
  B.tz(M.worn, 0.019, 0.022, -0.475, -0.46, 0, ty, 10);
  B.bx(M.steel, 0.036, 0.075, 0.018, 0, 0.04, -0.445);
  // tall front post, raised ladder rear sight
  earPost(B, M, K, M.steel, sy, -0.49, by + 0.025, 0.008);
  B.bx(M.steel, 0.03, 0.008, 0.024, 0, 0.096, -0.17);
  for (const s of [-1, 1]) B.bx(M.steel, 0.003, 0.042, 0.005, s * 0.012, 0.119, -0.17);
  for (const y of [0.104, 0.112, 0.138]) B.bx(M.steel, 0.024, 0.0025, 0.004, 0, y, -0.17);
  B.bx(M.worn, 0.02, 0.006, 0.006, 0, sy - 0.0075, -0.17);
  B.tor(M.steel, 0.0042, 0.0016, K.TAU, 0, sy, -0.17, 0, 0, 0, 4, 10);
  partAt(B, K, 'pump', [0, ty, -0.32]);
  B.tz(M.wood, 0.031, 0.031, -0.4, -0.235, 0, ty, 10);
  for (let i = 0; i < 6; i++) B.tor(M.wood, 0.0308, 0.0024, K.TAU, 0, ty, -0.385 + i * 0.026, 0, 0, 0, 4, 10);
  for (const s of [-1, 1]) B.bx(M.steel, 0.004, 0.008, 0.1, s * 0.024, ty + 0.012, -0.19);
  endPart(B);
  partAt(B, K, 'bolt', [0.022, 0.066, -0.1]);
  B.bx(M.worn, 0.006, 0.028, 0.07, 0.023, 0.066, -0.1);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.531);
  B.anchor('sight', 0, sy, -0.17);
  B.anchor('leftHand', 0, 0.0, -0.32);
  return 0.9;
}

// Python: a blued .357 with a six-inch barrel under a ventilated rib, the full
// underlug shrouding the ejector rod and walnut target grips. The cylinder swings
// out to the left on its crane: 'mag' is the crane (pivoting about Z), carrying
// 'cylinder' (indexes 60 degrees a shot), which carries 'ejector' (rod and star,
// pushed back to kick the empties out) and 'rounds' (the six case heads).
// 'hammer' rests cocked and drops on each shot.
export function python(B, M, K) {
  const by = 0.058;
  const ca = 0.047;
  const cz = -0.029;
  const pv = [-0.008, 0.026, cz];
  const cyl = [0, ca, cz];
  // walnut target grip (a plough-handle profile with finger swells) and the steel
  // frame behind the cylinder that sweeps up into the hammer hump
  B.ext(M.wood, K.shapeFrom([
    [0.012, 0.02], [0.008, 0.0], [0.004, -0.018], [0.007, -0.03], [0.0, -0.042], [0.002, -0.054], [-0.005, -0.066],
    [-0.01, -0.081], [-0.022, -0.089], [-0.042, -0.088], [-0.05, -0.078], [-0.047, -0.05], [-0.039, -0.02],
    [-0.032, 0.004], [-0.026, 0.02],
  ]), 0.028, 0, 0.002);
  B.ext(M.steel, K.shapeFrom([
    [0.013, 0.03], [0.013, 0.018], [-0.028, 0.018], [-0.033, 0.034], [-0.03, 0.052], [-0.021, 0.064],
    [-0.006, 0.068], [0.004, 0.068],
  ]), 0.02, 0, 0.0015);
  // frame: recoil shield, top strap, under the cylinder and the front
  B.bx(M.steel, 0.028, 0.044, 0.008, 0, 0.049, -0.001);
  B.bx(M.steel, 0.022, 0.009, 0.07, 0, 0.0715, -0.03);
  B.bx(M.steel, 0.022, 0.01, 0.056, 0, 0.023, -0.026);
  B.bx(M.steel, 0.022, 0.05, 0.014, 0, 0.051, -0.059);
  B.bx(M.worn, 0.004, 0.009, 0.012, -0.012, 0.05, 0.01);
  for (const [y, z] of [[0.03, 0.0], [0.05, 0.022]]) B.sp(M.worn, 0.0026, -0.011, y, z, 1, 1, 1, 6, 4);
  K.triggerGuard(B, M.steel, 0.018, -0.03, 0.017, M.worn);
  // rear sight on the top strap
  B.bx(M.steel, 0.012, 0.004, 0.014, 0, 0.078, 0.0);
  for (const s of [-1, 1]) B.bx(M.steel, 0.004, 0.005, 0.006, s * 0.0042, 0.0825, 0.003);
  // barrel, underlug round the ejector rod, vent rib flush with the top strap, front ramp
  B.tz(M.steel, 0.0095, 0.0105, -0.216, -0.066, 0, by, 10);
  B.tz(M.steel, 0.0075, 0.0075, -0.216, -0.066, 0, 0.044, 8);
  B.bx(M.steel, 0.012, 0.008, 0.15, 0, 0.049, -0.141);
  B.bx(M.steel, 0.008, 0.0085, 0.15, 0, 0.0718, -0.141);
  for (let i = 0; i < 6; i++) B.bx(M.black, 0.0086, 0.0035, 0.013, 0, 0.0725, -0.084 - i * 0.022);
  B.bx(M.steel, 0.004, 0.008, 0.018, 0, 0.078, -0.205, 0.25);
  B.bx(M.copper, 0.0044, 0.003, 0.004, 0, 0.0815, -0.199);
  B.tz(M.black, 0.0056, 0.0056, -0.2168, -0.21, 0, by, 8);
  // crane, cylinder, ejector and rounds
  partAt(B, K, 'mag', pv);
  B.bx(M.steel, 0.012, 0.026, 0.005, -0.004, 0.036, -0.0555);
  B.tz(M.steel, 0.0038, 0.0038, -0.058, -0.004, pv[0], pv[1], 6);
  endPart(B);
  partAt(B, K, 'cylinder', cyl, [0, 0, 0], 'mag', pv);
  B.add(new K.THREE.CylinderGeometry(0.0195, 0.0195, 0.045, 12), M.steel, 0, ca, cz, -K.HALF, 0, 0);
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) * K.PI) / 3;
    B.bx(M.black, 0.004, 0.0016, 0.026, Math.sin(a) * 0.0192, ca + Math.cos(a) * 0.0192, cz - 0.005, 0, 0, -a);
    const b = (k * K.PI) / 3;
    B.add(K.G.hex(0.0045), M.black, Math.sin(b) * 0.0115, ca + Math.cos(b) * 0.0115, cz - 0.0228, -K.HALF, 0, 0);
  }
  endPart(B);
  partAt(B, K, 'ejector', cyl, [0, 0, 0], 'cylinder', cyl);
  B.tz(M.worn, 0.0032, 0.0032, -0.118, -0.051, 0, ca, 6);
  B.tz(M.worn, 0.0048, 0.0048, -0.124, -0.118, 0, ca, 8);
  B.tz(M.worn, 0.0125, 0.0125, -0.0068, -0.0054, 0, ca, 6);
  endPart(B);
  partAt(B, K, 'rounds', cyl, [0, 0, 0], 'cylinder', cyl);
  for (let k = 0; k < 6; k++) {
    const b = (k * K.PI) / 3;
    const x = Math.sin(b) * 0.0115;
    const y = ca + Math.cos(b) * 0.0115;
    B.tz(M.brass, 0.0053, 0.0053, -0.0066, -0.0048, x, y, 6);
    B.tz(M.worn, 0.0017, 0.0017, -0.0048, -0.0044, x, y, 6);
  }
  endPart(B);
  partAt(B, K, 'hammer', [0, 0.058, 0.01], [0.75, 0, 0]);
  B.bx(M.steel, 0.0075, 0.024, 0.008, 0, 0.069, 0.008, 0.1);
  B.bx(M.worn, 0.0095, 0.006, 0.015, 0, 0.08, 0.013, 0.35);
  endPart(B);
  B.anchor('muzzle', 0, by, -0.217);
  B.anchor('sight', 0, 0.082, 0.003);
  B.anchor('leftHand', 0, -0.05, 0.035);
  return 0.29;
}
