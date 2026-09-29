// Shared sub-assemblies for the Cold War guns (guns/*.js). Every helper takes the
// weapons3d Builder B, its materials M and kit K, and only uses materials from M.

/**
 * Start an animated part pivoting at `origin` (gun coordinates) whose geometry is
 * then drawn in gun coordinates too, so a part reads like the static model around
 * it. With a parent, `parentAt` is the parent's origin. Close with endPart(B).
 */
export function partAt(B, K, name, origin, rot = [0, 0, 0], parent = null, parentAt = [0, 0, 0]) {
  B.part(name, origin.map((v, i) => v - parentAt[i]), rot, 'XYZ', parent);
  B.xf = new K.THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]);
}

export function endPart(B) {
  B.xf = null;
  B.sel();
}

/**
 * Box magazine as an extruded side profile with the centre of its top at (y, z):
 * `len` long, `d` front to back, `w` across, bending forward by `sweep` at the
 * bottom (0 for a straight box). Adds a floorplate and stamped ribs; returns the
 * bottom centre { y, z } and its tilt.
 */
export function boxMag(B, M, K, mat, { y, z, len, d, w, sweep = 0, n = 8, plate = mat, ribs = 0 }) {
  const L = [];
  const R = [];
  const at = (t) => [-z + sweep * t * t, y - len * t];
  for (let i = 0; i <= n; i++) {
    const [u, v] = at(i / n);
    L.push([u - d / 2, v]);
    R.push([u + d / 2, v]);
  }
  const bev = 0.0015;
  B.ext(mat, K.shapeFrom([...L, ...R.reverse()]), w - 2 * bev, 0, bev);
  const tilt = Math.atan2(2 * sweep, len);
  const [ub, vb] = at(1);
  B.bx(plate, w + 0.003, 0.007, d + 0.008, 0, vb - 0.001, -ub, tilt);
  for (let k = 0; k < ribs; k++) {
    const t0 = 0.12 + (k * 0.72) / ribs;
    const [ua, va] = at(t0);
    const [uc, vc] = at(t0 + 0.6 / ribs);
    for (const s of [-1, 1]) B.rod(mat, 0.0016, [s * (w / 2 + 0.0004), va, -ua], [s * (w / 2 + 0.0004), vc, -uc], 4);
  }
  return { y: vb, z: -ub, tilt };
}

/** Rear aperture sight: base, two protective ears and a ring centred at (y, z). */
export function aperture(B, M, K, mat, y, z, { R = 0.0045, base = 0.012, w = 0.02, ears = true } = {}) {
  B.bx(mat, w, base, 0.014, 0, y - R - base / 2 - 0.001, z);
  B.tor(mat, R, 0.0017, K.TAU, 0, y, z, 0, 0, 0, 4, 10);
  if (ears) for (const s of [-1, 1]) B.bx(mat, 0.003, base + R * 2 + 0.004, 0.012, s * (w / 2 - 0.0015), y - base / 2 + 0.001, z);
}

/** Rotary drum rear sight (HK style): two side cheeks and the aperture ring between them. */
export function drumSight(B, M, K, mat, y, z, R = 0.0105) {
  B.bx(mat, 0.022, 0.012, 0.024, 0, y - R - 0.004, z);
  for (const s of [-1, 1]) B.tx(mat, R, 0.004, s * 0.009, y, z, 8);
  B.tor(mat, 0.0045, 0.0018, K.TAU, 0, y, z, 0, 0, 0, 4, 10);
  B.bx(mat, 0.014, 0.004, 0.012, 0, y - 0.0068, z);
}

/** Hooded front post with its tip at (y, z) standing on a base at yBase. */
export function hoodedPost(B, M, K, mat, y, z, yBase, hoodR = 0.0095) {
  B.bx(mat, 0.012, Math.max(0.004, y - yBase - 0.004), 0.014, 0, (y + yBase) / 2 - 0.004, z);
  B.bx(mat, 0.0026, 0.012, 0.003, 0, y - 0.006, z);
  B.tor(mat, hoodR, 0.0019, K.PI, 0, y - 0.004, z, 0, 0, 0, 4, 6);
}

/** Front post between two protective ears (AK / Dragunov / M14 style). */
export function earPost(B, M, K, mat, y, z, yBase, spread = 0.0075) {
  B.bx(mat, 0.014, 0.006, 0.016, 0, yBase + 0.003, z);
  B.bx(mat, 0.0028, y - yBase, 0.003, 0, (y + yBase) / 2, z);
  for (const s of [-1, 1]) B.bx(mat, 0.0024, y - yBase + 0.002, 0.012, s * spread, (y + yBase) / 2 + 0.001, z);
}

/** Slotted flash hider: a faceted tube with `n` dark slots around it. */
export function slottedHider(B, M, K, mat, r, y, zF, zB, n = 5, slotLen = 0.7) {
  B.tz(mat, r, r, zF, zB, 0, y, 8);
  B.tz(M.black, r * 0.62, r * 0.62, zF - 0.0008, zF + 0.004, 0, y, 8);
  const len = (zB - zF) * slotLen;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * K.TAU + 0.3;
    B.bx(M.black, 0.0022, 0.0022, len, Math.sin(a) * (r + 0.0003), y + Math.cos(a) * (r + 0.0003), zF + len / 2 + 0.003, 0, 0, -a);
  }
}

/** Raked polymer or wooden pistol grip with a heel and a few finger grooves. */
export function pistolGrip(B, M, K, mat, { rake = 0.25, c = [0, -0.028, 0.018], w = 0.03, h = 0.1, d = 0.038, grooves = 3 } = {}) {
  B.bx(mat, w, h, d, ...c, -rake);
  B.bx(mat, w + 0.002, 0.008, d + 0.006, ...K.along(...c, rake, -h / 2 + 0.002), -rake);
  for (let i = 0; i < grooves; i++) B.bx(M.black, w + 0.001, 0.0022, 0.004, ...K.along(...c, rake, -0.025 + i * 0.019, -d / 2 + 0.0014), -rake);
}

/** A row of dark slots along Z on one side (x), for vents and ejection ports. */
export function slots(B, M, x, y, z0, z1, n, h = 0.006, len = 0.018) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
    B.bx(M.black, 0.0016, h, len, x, y, z);
  }
}
