// The Gale Cannon: an original wonder weapon that fires a cone of hurricane air.
// A brass-and-copper blunderbuss built like a gramophone crossed with a forge
// bellows. Air comes in through a grilled intake in the back of the ten-sided brass
// breech (its fan, 'intake', faces the player), past two pressure gauges on the
// breech's shoulders, through pleated oxblood-leather bellows into a caged turbine
// drum (its fan, 'fan', shows through the bars) and out of a petalled horn that
// flares to a rolled lip. Both fans spin on their own (userData.spin, driven by
// the viewmodel). The pressure canister slung under the bellows is the magazine
// ('mag'); the valve wheel on the left of the breech ('bolt') is cranked open
// after a fresh canister goes in. The sights ride high on a brass bar, clear of
// the horn. A walnut grip, a brass crutch stock with a leather pad, and a turned
// walnut handle under the drum for the left hand.

import { partAt, endPart, pistolGrip } from './cw-kit.js';

export function galecannon(B, M, K) {
  const { THREE, TAU, HALF, PI } = K;
  const by = 0.075;
  const sy = 0.1715;
  // grip, frame, and a slim brass crutch stock with a leather pad, hung low so the
  // intake at the back of the breech stays in view
  pistolGrip(B, M, K, M.wood, { rake: 0.26, c: [0, -0.03, 0.02], w: 0.03, h: 0.1, d: 0.04, grooves: 0 });
  B.bx(M.brass, 0.034, 0.01, 0.046, ...K.along(0, -0.03, 0.02, 0.26, -0.052), -0.26);
  K.triggerGuard(B, M.brass, 0.012, -0.034, 0.017, M.copper);
  B.bx(M.brass, 0.034, 0.03, 0.1, 0, 0.022, -0.01);
  B.rod(M.brass, 0.0048, [0, 0.026, 0.04], [0, 0.03, 0.25], 6);
  B.rod(M.brass, 0.0048, [0, -0.004, 0.035], [0, -0.058, 0.245], 6);
  B.rod(M.copper, 0.0035, [0, 0.028, 0.14], [0, -0.03, 0.14], 5);
  B.bx(M.brass, 0.04, 0.11, 0.01, 0, -0.014, 0.25);
  B.bx(M.plum, 0.044, 0.114, 0.016, 0, -0.014, 0.262);
  // breech: ten-sided brass drum with copper bands and rivets
  B.tz(M.brass, 0.042, 0.04, -0.055, 0.035, 0, by, 10);
  for (const z of [0.028, -0.048]) B.tor(M.copper, 0.0425, 0.0038, TAU, 0, by, z, 0, 0, 0, 4, 10);
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) * TAU) / 6;
    B.sp(M.copper, 0.0028, Math.sin(a) * 0.0415, by + Math.cos(a) * 0.0415, -0.01, 1, 1, 1, 6, 4);
  }
  // the intake in its back: a flared copper mouth over a dark throat, a brass grille
  // across it and the intake fan ('intake') whirling behind the grille
  B.tz(M.copper, 0.042, 0.047, 0.035, 0.05, 0, by, 10, true);
  B.tor(M.copper, 0.047, 0.0035, TAU, 0, by, 0.05, 0, 0, 0, 4, 10);
  B.add(new THREE.CircleGeometry(0.041, 10), M.black, 0, by, 0.0356);
  for (const a of [0, HALF]) B.rod(M.brass, 0.0022, [Math.cos(a) * 0.045, by + Math.sin(a) * 0.045, 0.0505], [-Math.cos(a) * 0.045, by - Math.sin(a) * 0.045, 0.0505], 5);
  B.tor(M.brass, 0.022, 0.0022, TAU, 0, by, 0.0505, 0, 0, 0, 3, 10);
  // pressure gauges on the breech's shoulders, faces turned up toward the eye
  const gauge = (pos, n, r) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n).normalize());
    B.xf = new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
    B.cy(M.brass, r, r * 1.05, 0.012, 0, 0, 0, 0, 0, 0, 10);
    B.tor(M.copper, r, 0.0022, TAU, 0, 0.006, 0, HALF, 0, 0, 3, 10);
    B.add(K.G.hex(r * 0.82), M.glowSoft, 0, 0.0064, 0);
    B.bx(M.black, 0.0014, 0.0008, r * 0.8, 0.002, 0.0068, -0.002, 0, 0.9, 0);
    B.xf = null;
  };
  gauge([0.029, by + 0.033, -0.012], [0.6, 0.75, 0.3], 0.0135);
  gauge([-0.032, by + 0.028, -0.022], [-0.7, 0.65, 0.25], 0.011);
  // pleated leather bellows between brass collars
  const N = 6;
  const z0 = -0.055;
  const zl = 0.145;
  const zs = Array.from({ length: 2 * N + 1 }, (_, i) => z0 - (i * zl) / (2 * N));
  for (let i = 0; i < 2 * N; i++) {
    const rBack = i % 2 ? 0.047 : 0.036;
    const rFront = i % 2 ? 0.036 : 0.047;
    B.tz(M.plum, rFront, rBack, zs[i + 1], zs[i], 0, by, 10);
  }
  B.tz(M.brass, 0.05, 0.05, -0.212, -0.2, 0, by, 10);
  // turbine drum: copper rims, a cage of brass bars, a dark lining seen through them
  const d0 = -0.212;
  const d1 = -0.3;
  const dr = 0.058;
  const lining = new THREE.CylinderGeometry(dr - 0.004, dr - 0.004, d0 - d1, 12, 1, true);
  const ix = lining.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const t = ix[i + 1];
    ix[i + 1] = ix[i + 2];
    ix[i + 2] = t;
  }
  B.add(lining, M.black, 0, by, (d0 + d1) / 2, -HALF, 0, 0);
  for (const z of [d0, d1]) B.tor(M.copper, dr, 0.0055, TAU, 0, by, z, 0, 0, 0, 4, 12);
  for (let k = 0; k < 14; k++) {
    const a = ((k + 0.5) * TAU) / 14;
    B.rod(M.brass, 0.0026, [Math.sin(a) * dr, by + Math.cos(a) * dr, d0], [Math.sin(a) * dr, by + Math.cos(a) * dr, d1], 5);
  }
  B.tz(M.brass, dr, dr, d1 - 0.006, d1, 0, by, 10);
  // the horn: an eight-petalled brass flare with a copper throat and a rolled lip
  const hz = d1 - 0.006;
  const hl = 0.26;
  const r0 = 0.034;
  const r1 = 0.078;
  const flare = (t) => r0 + (r1 - r0) * t ** 2.6;
  const prof = Array.from({ length: 9 }, (_, i) => new THREE.Vector2(flare(i / 8), (i / 8) * hl));
  B.add(new THREE.LatheGeometry(prof, 8, PI / 8), M.brass, 0, by, hz, -HALF, 0, 0);
  B.add(new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x - 0.0025, v.y)).reverse(), 8, PI / 8), M.copper, 0, by, hz, -HALF, 0, 0);
  B.tor(M.brass, r1, 0.0055, TAU, 0, by, hz - hl, 0, 0, 0, 4, 10);
  for (const t of [0.42, 0.74]) B.tor(M.copper, flare(t) + 0.0012, 0.0028, TAU, 0, by, hz - t * hl, 0, 0, 0, 3, 10);
  B.tor(M.glowSoft, 0.026, 0.004, TAU, 0, by, hz - 0.02, 0, 0, 0, 4, 10);
  // turned walnut handle under the drum
  B.bx(M.brass, 0.02, 0.022, 0.03, 0, by - 0.062, -0.256);
  B.cy(M.wood, 0.0155, 0.0175, 0.092, 0, -0.043, -0.256, 0, 0, 0, 8);
  B.tor(M.brass, 0.0168, 0.003, TAU, 0, 0.0, -0.256, HALF, 0, 0, 3, 8);
  B.cy(M.brass, 0.012, 0.0175, 0.008, 0, -0.092, -0.256, 0, 0, 0, 8);
  // sights on a brass bar, standing clear of the horn
  for (const [zb, zt, yb] of [[0.0, 0.0, by + 0.04], [-0.214, -0.236, by + 0.057]]) {
    for (const s of [-1, 1]) B.rod(M.brass, 0.0022, [s * 0.014, yb, zb], [s * 0.004, sy - 0.012, zt], 5);
  }
  B.bx(M.brass, 0.01, 0.005, 0.262, 0, sy - 0.0115, -0.12);
  B.bx(M.brass, 0.004, 0.006, 0.004, 0, sy - 0.0068, 0.005);
  B.tor(M.brass, 0.0052, 0.0017, TAU, 0, sy, 0.005, 0, 0, 0, 4, 10);
  B.bx(M.brass, 0.0028, 0.01, 0.004, 0, sy - 0.004, -0.245);
  B.sp(M.glow, 0.0024, 0, sy, -0.245, 1, 1, 1, 6, 4);
  // canister clip at the drum collar
  B.bx(M.brass, 0.012, 0.03, 0.01, 0, 0.026, -0.2);
  // valve stem on the left of the breech, where the eye sees it (the wheel itself is 'bolt')
  const vw = [-0.056, by - 0.012, -0.045];
  B.tx(M.brass, 0.0045, 0.018, -0.047, vw[1], vw[2], 6);
  // the turbine in the drum ('fan') and the intake fan behind the grille ('intake');
  // both spin on their own (userData.spin, see viewmodel.js)
  const fan = (name, z, n, r, depth, hub, spin) => {
    B.part(name, [0, by, z]);
    B.tz(M.copper, hub, hub, -depth / 2 - 0.004, depth / 2 + 0.004, 0, 0, 8);
    B.tz(M.glow, hub * 0.65, hub * 0.65, -depth / 2 - 0.006, depth / 2 + 0.006, 0, 0, 6);
    for (let k = 0; k < n; k++) {
      B.xf = new THREE.Matrix4().makeRotationZ((k * TAU) / n);
      B.bx(M.steel, r - hub, 0.004, depth, (r + hub) / 2, 0, 0, 0.55, 0, 0);
      B.xf = null;
    }
    B.parts.get(name).userData.spin = spin;
  };
  fan('fan', (d0 + d1) / 2, 8, 0.053, 0.05, 0.011, 3);
  B.sp(M.glowSoft, 0.02, 0, 0, 0, 1, 1, 1.6, 8, 6);
  fan('intake', 0.042, 7, 0.039, 0.01, 0.009, -4);
  B.sel();
  // the pressure canister (magazine)
  const co = [0, 0.012, -0.13];
  partAt(B, K, 'mag', co);
  B.tz(M.copper, 0.019, 0.019, -0.19, -0.075, 0, co[1], 10);
  B.tz(M.brass, 0.011, 0.019, -0.205, -0.19, 0, co[1], 10);
  B.tz(M.brass, 0.019, 0.013, -0.075, -0.062, 0, co[1], 10);
  B.tz(M.brass, 0.006, 0.006, -0.062, -0.05, 0, co[1], 6);
  for (const z of [-0.1, -0.165]) B.tor(M.brass, 0.0195, 0.0025, TAU, 0, co[1], z, 0, 0, 0, 3, 10);
  B.bx(M.glass, 0.004, 0.012, 0.055, 0.018, co[1], -0.1325);
  B.bx(M.glow, 0.002, 0.007, 0.052, 0.0172, co[1], -0.1325);
  endPart(B);
  // valve wheel
  partAt(B, K, 'bolt', vw);
  B.tor(M.copper, 0.018, 0.0028, TAU, ...vw, 0, HALF, 0, 4, 10);
  B.tx(M.brass, 0.0055, 0.008, ...vw, 8);
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3;
    B.rod(M.brass, 0.0018, vw, [vw[0], vw[1] + Math.cos(a) * 0.017, vw[2] + Math.sin(a) * 0.017], 5);
  }
  B.sp(M.wood, 0.0045, vw[0] - 0.004, vw[1] + 0.018, vw[2], 1, 1, 1, 6, 4);
  endPart(B);
  B.anchor('muzzle', 0, by, hz - hl);
  B.anchor('sight', 0, sy, 0.005);
  B.anchor('leftHand', 0, 0.018, -0.256);
  return 0.86;
}
