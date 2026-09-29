// The auditorium and everything behind the proscenium: the seats (instanced, one per
// seat collider row), carpeted aisles, the gilded proscenium arch and its columns, the
// opera boxes, the painted dome, the orchestra rail, the stage with its footlights,
// drapes, rigging, the torn screen and the piano, backstage's catwalk, flats and junk,
// and the projection booth's carbon-arc projectors.

import * as THREE from 'three';
import { FURNITURE } from '../../../../shared/maps/palace.js';
import { rng } from '../../geo.js';
import { chamferBox, hull, prism, sackGeo } from '../../level.js';
import { V3, at, mat, bbox, bgeo, beam, bake, quad, shellFace, atlasQuad } from './kit.js';
import { runMoulding } from './shell.js';
import { instanced, merged, trimFaces, rubble, crateStack, costumeRail, COSTUME_COLORS, sandbags, ropeCoil, filmCan, litter } from './props.js';
import { posterRect, signRect, SIGNS } from './paint.js';
import { zonesTouching } from './zones.js';

const TAU = Math.PI * 2;
const STAGE_Y = 1.2;
const HOUSE = [-11.85, -14, 11.85, 5.85];
const DOME = { x: 0, z: -4, r: 6, y: 11, h: 2.2 };
const ARCH = { half: 10.6, spring: 7.5, rise: 1.5, z0: -14.35, z1: -13.65 };
const archY = (x) => ARCH.spring + ARCH.rise * Math.sqrt(Math.max(0, 1 - (x / ARCH.half) ** 2));
// A few panels of the dome have fallen in (segments of its lowest rings), and the moon
// shines through: the rig's moon sits at (-30, 60, -40), so its light runs along MOON_DIR.
const HOLE = (r, s) => (r === 0 && (s === 14 || s === 15)) || (r === 1 && s === 14);
const MOON_DIR = new THREE.Vector3(30, -60, 40).normalize();

// A folded sheet of cloth between plan points a and b (y0 up to y1): zig-zag folds with
// their light painted into the vertex colours. `out` is the side the folds bulge to.
export function drapeSheet(g, a, b, y0, y1, folds, depth, out, tint = 1, hem = 0.1) {
  const n = Math.max(2, Math.round(folds * 4));
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, ph = u * folds * TAU;
    pts.push([a[0] + dx * u + out[0] * Math.sin(ph) * depth, a[1] + dz * u + out[1] * Math.sin(ph) * depth, 0.5 + 0.5 * Math.cos(ph)]);
  }
  const t = typeof tint === 'number' ? [tint, tint, tint] : tint;
  const rows = Math.max(1, Math.round((y1 - y0) / 1.6));
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1];
    for (let r = 0; r < rows; r++) {
      const ya = y0 + ((y1 - y0) * r) / rows, yb = y0 + ((y1 - y0) * (r + 1)) / rows;
      const ha = r === 0 ? Math.sin(i * 1.7) * hem : 0, hb = r === 0 ? Math.sin((i + 1) * 1.7) * hem : 0;
      const corners = [[p[0], ya + ha, p[1]], [q[0], ya + hb, q[1]], [q[0], yb, q[1]], [p[0], yb, p[1]]];
      const uu = (k) => (Math.hypot(pts[k][0] - a[0], pts[k][1] - a[1]) / 1.2);
      const uv = [[uu(i), ya / 2.2], [uu(i + 1), ya / 2.2], [uu(i + 1), yb / 2.2], [uu(i), yb / 2.2]];
      const shade = (k, y) => {
        const f = pts[k][2];
        const c = bake(pts[k][0], y, pts[k][1], out[0], 0, out[1]);
        const l = 0.45 + 0.55 * f;
        return [c[0] * l * t[0], c[1] * l * t[1], c[2] * l * t[2]];
      };
      // Face the side the folds bulge toward.
      const front = [[p[0], ya + ha, p[1]], [q[0], ya + hb, q[1]]];
      const e = [front[1][0] - front[0][0], front[1][2] - front[0][2]];
      const nrm = [-e[1], e[0]];   // this winding's normal in plan: (-dz, dx)
      const flip = nrm[0] * out[0] + nrm[1] * out[1] < 0;
      const cols = [shade(i, ya), shade(i + 1, ya), shade(i + 1, yb), shade(i, yb)];
      if (!flip) quad(g, corners, uv, cols);
      else quad(g, [corners[1], corners[0], corners[3], corners[2]], [uv[1], uv[0], uv[3], uv[2]], [cols[1], cols[0], cols[3], cols[2]]);
    }
  }
}

// --- Seats ---------------------------------------------------------------------------------------
// Local frame: x across the row, z from the collider's front (0) to its back (0.5), facing -z.

// Only what shows is modelled: each piece drops the faces that lie against its neighbours
// or face the floor, and the thin plates keep just their two sides.
function seatParts(w, R) {
  const front = (nx, ny, nz) => nz < 0.7 && ny > -0.7;
  const back = trimFaces(hull([
    V3(-w / 2 + 0.03, 0.44, 0.36), V3(w / 2 - 0.03, 0.44, 0.36), V3(-w / 2 + 0.03, 0.44, 0.44), V3(w / 2 - 0.03, 0.44, 0.44),
    V3(-w / 2 + 0.04, 0.86, 0.4), V3(w / 2 - 0.04, 0.86, 0.4), V3(-w / 2 + 0.04, 0.84, 0.48), V3(w / 2 - 0.04, 0.84, 0.48),
    V3(-w / 2 + 0.1, 0.9, 0.44), V3(w / 2 - 0.1, 0.9, 0.44),
  ], [0.5, 0.5, 0.5]), front);
  const up = trimFaces(hull([
    V3(-w / 2 + 0.04, 0.34, 0.25), V3(w / 2 - 0.04, 0.34, 0.25), V3(-w / 2 + 0.04, 0.34, 0.34), V3(w / 2 - 0.04, 0.34, 0.34),
    V3(-w / 2 + 0.05, 0.76, 0.27), V3(w / 2 - 0.05, 0.76, 0.27), V3(-w / 2 + 0.05, 0.76, 0.35), V3(w / 2 - 0.05, 0.76, 0.35),
  ], [0.5, 0.5, 0.5]), front);
  const down = trimFaces(hull([
    V3(-w / 2 + 0.04, 0.38, 0.02), V3(w / 2 - 0.04, 0.38, 0.02), V3(-w / 2 + 0.04, 0.38, 0.38), V3(w / 2 - 0.04, 0.38, 0.38),
    V3(-w / 2 + 0.05, 0.48, 0.0), V3(w / 2 - 0.05, 0.48, 0.0), V3(-w / 2 + 0.05, 0.5, 0.36), V3(w / 2 - 0.05, 0.5, 0.36),
  ], [0.5, 0.5, 0.5]), (nx, ny, nz) => nz < 0.7 && ny > -0.7);
  const pan = trimFaces(new THREE.BoxGeometry(w - 0.1, 0.4, 0.02), (nx, ny, nz) => Math.abs(nz) > 0.7);
  const shell = trimFaces(hull([
    V3(-w / 2 + 0.02, 0.42, 0.45), V3(w / 2 - 0.02, 0.42, 0.45), V3(-w / 2 + 0.02, 0.42, 0.48), V3(w / 2 - 0.02, 0.42, 0.48),
    V3(-w / 2 + 0.03, 0.88, 0.49), V3(w / 2 - 0.03, 0.88, 0.49), V3(-w / 2 + 0.03, 0.88, 0.51), V3(w / 2 - 0.03, 0.88, 0.51),
  ], [0.5, 0.5, 0.5]), (nx, ny, nz) => nz > -0.7 && ny > -0.7);
  const arm = trimFaces(new THREE.BoxGeometry(0.06, 0.04, 0.44), (nx, ny, nz) => ny > -0.7 && Math.abs(nz) < 0.7);
  const std = trimFaces(hull([
    V3(-0.018, 0, 0.06), V3(0.018, 0, 0.06), V3(-0.018, 0, 0.46), V3(0.018, 0, 0.46),
    V3(-0.018, 0.68, 0.46), V3(0.018, 0.68, 0.46), V3(-0.018, 0.66, 0.12), V3(0.018, 0.66, 0.12),
    V3(-0.018, 0.4, 0.04), V3(0.018, 0.4, 0.04),
  ], [0.5, 0.5, 0.5]), (nx) => Math.abs(nx) > 0.7);
  const plushUp = merged([[back, new THREE.Matrix4(), 1], [up, new THREE.Matrix4(), 0.92]]);
  const plushDown = merged([[back, new THREE.Matrix4(), 1], [down, new THREE.Matrix4(), 1.05]]);
  const wood = merged([[shell, new THREE.Matrix4(), 0.85], [arm, mat(-w / 2, 0.7, 0.24), 1]]);
  const iron = merged([[std, mat(-w / 2, 0, 0), 0.7], [pan, mat(0, 0.55, 0.245), 0.5]]);
  return { plushUp, plushDown, wood, iron, R };
}

function buildSeats(ctx, batch, R) {
  const rows = FURNITURE.filter((p) => p.kind === 'seats');
  const w = 0.52;
  const geos = seatParts(w, R);
  const up = [], down = [], wood = [], iron = [], ends = [];
  const tintUp = [], tintDown = [], tintWood = [];
  const fallen = [];
  for (const p of rows) {
    const [x0, , z0, x1] = p.solid;
    const n = Math.round((x1 - x0) / w);
    const sw = (x1 - x0) / n;
    for (let k = 0; k < n; k++) {
      const x = x0 + sw * (k + 0.5);
      const roll = R();
      const m = mat(x, 0, z0, 0, 0, 0);
      m.scale(new THREE.Vector3(sw / w, 1, 1));
      iron.push(m);
      if (roll < 0.04) { fallen.push([x, z0]); continue; }   // a missing seat
      const tilt = roll > 0.97 ? mat(x, 0, z0, (R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.25) : m;
      const fade = 0.78 + R() * 0.3;
      (roll < 0.62 ? up : down).push(tilt);
      (roll < 0.62 ? tintUp : tintDown).push([fade * (1 + (R() - 0.5) * 0.12), fade, fade]);
      wood.push(tilt);
      tintWood.push([0.9 + R() * 0.2, 0.9 + R() * 0.2, 0.9 + R() * 0.2]);
    }
    // Aisle-end standards: a solid panel with a gilt boss, at both ends of the block.
    ends.push(mat(x0, 0, z0), mat(x1, 0, z0));
  }
  instanced(ctx, geos.plushUp, 'plush', up, (i) => tintUp[i]);
  instanced(ctx, geos.plushDown, 'plush', down, (i) => tintDown[i]);
  instanced(ctx, geos.wood, 'mahogany', wood, (i) => tintWood[i]);
  instanced(ctx, geos.iron, 'dark', iron);
  // The standards at the block ends are few enough to go in the batch (one draw fewer each).
  const endGeo = trimFaces(hull([V3(-0.03, 0, 0.02), V3(0.03, 0, 0.02), V3(-0.03, 0, 0.48), V3(0.03, 0, 0.48), V3(-0.03, 0.74, 0.48), V3(0.03, 0.74, 0.48), V3(-0.03, 0.74, 0.1), V3(0.03, 0.74, 0.1), V3(-0.03, 0.5, 0.0), V3(0.03, 0.5, 0.0)], [0.5, 0.5, 0.5]), (nx, ny) => Math.abs(nx) > 0.5 || ny > 0.7);
  const boss = hull([...Array.from({ length: 8 }, (_, k) => V3(0, Math.cos((k / 8) * TAU) * 0.09, Math.sin((k / 8) * TAU) * 0.09)), V3(0.035, 0, 0), V3(-0.035, 0, 0)]);
  const dark = batch.get('dark'), gilt = batch.get('gilt');
  for (const m of ends) {
    bgeo(dark, endGeo, m, 0.75);
    bgeo(gilt, boss, m.clone().multiply(mat(0, 0.42, 0.26)), 1);
  }
  // Missing seats: a cushion or a back lying on the floor nearby.
  const plush = batch.get('plush');
  for (const [x, z] of fallen) {
    bgeo(plush, chamferBox(0.44, 0.1, 0.4, 0.03), mat(x + (R() - 0.5) * 0.3, 0.05, z + 0.75, R() * TAU, 0, (R() - 0.5) * 0.2), 0.85);
  }
}

// --- The auditorium --------------------------------------------------------------------------------

function buildCeiling(batch, R) {
  const cream = batch.get('cream'), gilt = batch.get('gilt');
  const [x0, z0, x1, z1] = HOUSE;
  const Y = DOME.y;
  // The flat ceiling round the dome: rays from the dome's rim out to the room's edge.
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => Math.atan2(z - DOME.z, x - DOME.x));
  const angles = [...Array.from({ length: 48 }, (_, k) => (k / 48) * TAU - Math.PI), ...corners].sort((a, b) => a - b);
  const edge = (a) => {
    const dx = Math.cos(a), dz = Math.sin(a);
    const ts = [];
    if (dx > 1e-6) ts.push((x1 - DOME.x) / dx); if (dx < -1e-6) ts.push((x0 - DOME.x) / dx);
    if (dz > 1e-6) ts.push((z1 - DOME.z) / dz); if (dz < -1e-6) ts.push((z0 - DOME.z) / dz);
    const t = Math.min(...ts);
    return [DOME.x + dx * t, DOME.z + dz * t];
  };
  const ringR = DOME.r + 0.35;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i], b = angles[(i + 1) % angles.length] + (i + 1 === angles.length ? TAU : 0);
    if (b - a < 1e-4) continue;
    const ea = edge(a), eb = edge(b);
    for (let s = 0; s < 3; s++) {
      const u0 = s / 3, u1 = (s + 1) / 3;
      const P = (ang, e, u) => [DOME.x + Math.cos(ang) * ringR + (e[0] - DOME.x - Math.cos(ang) * ringR) * u, Y, DOME.z + Math.sin(ang) * ringR + (e[1] - DOME.z - Math.sin(ang) * ringR) * u];
      const pts = [P(a, ea, u0), P(b, eb, u0), P(b, eb, u1), P(a, ea, u1)];
      // facing down: reverse if the winding points up
      const e1 = [pts[1][0] - pts[0][0], pts[1][2] - pts[0][2]], e2 = [pts[3][0] - pts[0][0], pts[3][2] - pts[0][2]];
      const ny = e1[1] * e2[0] - e1[0] * e2[1];
      const q = ny > 0 ? [pts[0], pts[3], pts[2], pts[1]] : pts;
      quad(cream, q, q.map((p) => [p[0] / 3, p[2] / 3]), (x, y, z) => bake(x, y, z, 0, -1, 0));
    }
  }
  // Coffer beams on the flat ceiling, clear of the dome.
  const clear = (x, z) => Math.hypot(x - DOME.x, z - DOME.z) > ringR + 0.3;
  for (let z = -11; z <= 4; z += 3) {
    for (let x = -10.35; x < 10.4; x += 1.5) if (clear(x, z) && clear(x + 1.5, z)) bbox(cream, mat(x + 0.75, Y - 0.1, z), 1.5, 0.2, 0.22, 0.85, 1.5);
  }
  for (let x = -10.5; x <= 10.5; x += 3) {
    for (let z = -13.9; z < 5.8; z += 1.5) { const z2 = Math.min(5.85, z + 1.5); if (clear(x, z) && clear(x, z2)) bbox(cream, mat(x, Y - 0.1, (z + z2) / 2), 0.22, 0.2, z2 - z, 0.85, 1.5); }
  }
  for (let z = -11; z <= 4; z += 3) for (let x = -10.5; x <= 10.5; x += 3) if (clear(x, z)) bgeo(gilt, prism(0.14, 0.1, 0.08, 8), mat(x, Y - 0.24, z), 1);
  // The dome: a faceted spherical cap painted night blue, gilt ribs and stars, a rosette.
  const Rs = (DOME.r ** 2 + DOME.h ** 2) / (2 * DOME.h), cy = Y + DOME.h - Rs;
  const th0 = Math.asin(DOME.r / Rs);
  const seg = 24, rings = 5;
  const P = (th, ph) => [DOME.x + Rs * Math.sin(th) * Math.cos(ph), cy + Rs * Math.cos(th), DOME.z + Rs * Math.sin(th) * Math.sin(ph)];
  const sky = batch.get('dome');
  for (let r = 0; r < rings; r++) {
    const ta = th0 * (1 - r / rings), tb = th0 * (1 - (r + 1) / rings);
    for (let s = 0; s < seg; s++) {
      const pa = (s / seg) * TAU, pb = ((s + 1) / seg) * TAU;
      if (HOLE(r, s)) continue;
      const pts = [P(ta, pa), P(ta, pb), P(tb, pb), P(tb, pa)];
      if (r === rings - 1) pts[3] = pts[2];
      // facing inward and down, toward the house; u round the dome, v rim to crown
      const uv = [[(s / seg) * 4, 1 - ta / th0], [((s + 1) / seg) * 4, 1 - ta / th0], [((s + 1) / seg) * 4, 1 - tb / th0], [(s / seg) * 4, 1 - tb / th0]];
      quad(sky, pts, uv, (x, y, z) => {
        const n = [DOME.x - x, cy - y, DOME.z - z], l = Math.hypot(...n);
        return bake(x, y - 1.2, z, n[0] / l, n[1] / l, n[2] / l).map((v) => v * 1.3);
      });
    }
  }
  for (let k = 0; k < 12; k++) {
    const ph = (k / 12) * TAU;
    for (let r = 0; r < rings; r++) {
      if (k === 7 && r === 0) continue;   // this rib broke with the plaster
      const ta = th0 * (1 - r / rings), tb = th0 * (1 - (r + 1) / rings);
      const a = P(ta - 0.004, ph), b = P(tb, ph);
      beam(gilt, [a[0], a[1] - 0.06, a[2]], [b[0], b[1] - 0.06, b[2]], 0.2, 0.1, 0.85, 0.4);
    }
  }
  // Broken laths across the hole, and one hanging down.
  const wood = batch.get('woodWall');
  for (let k = 0; k < 5; k++) {
    const t0 = th0 * (0.62 + k * 0.08), p0 = P(t0, (14 / seg) * TAU - 0.05), p1 = P(t0 + (R() - 0.5) * 0.05, (16 / seg) * TAU + 0.05);
    if (k === 2) { beam(wood, p0, [p0[0] + 0.5, p0[1] - 1.4, p0[2] + 0.3], 0.05, 0.02, 0.5, 0.5); continue; }
    beam(wood, p0, [p0[0] + (p1[0] - p0[0]) * (0.4 + R() * 0.5), p0[1] + (p1[1] - p0[1]) * 0.5, p0[2] + (p1[2] - p0[2]) * (0.4 + R() * 0.5)], 0.05, 0.02, 0.5, 0.5);
  }
  // Rim: a gilt band and a stepped cream cornice; the apex rosette.
  for (let s = 0; s < 32; s++) {
    const a = (s / 32) * TAU, b = ((s + 1) / 32) * TAU;
    const pa = [DOME.x + Math.cos(a) * (DOME.r + 0.18), Y - 0.12, DOME.z + Math.sin(a) * (DOME.r + 0.18)];
    const pb = [DOME.x + Math.cos(b) * (DOME.r + 0.18), Y - 0.12, DOME.z + Math.sin(b) * (DOME.r + 0.18)];
    beam(gilt, pa, pb, 0.34, 0.24, 0.85, 0.5);
    beam(cream, [pa[0], Y - 0.3, pa[2]], [pb[0], Y - 0.3, pb[2]], 0.5, 0.14, 0.8, 1);
  }
  const apex = [DOME.x, Y + DOME.h - 0.02, DOME.z];
  bgeo(gilt, prism(0.7, 0.55, 0.1, 12), mat(apex[0], apex[1] - 0.05, apex[2]), 1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    bgeo(gilt, hull([V3(0, 0, 0), V3(0.5, -0.02, -0.14), V3(0.5, -0.02, 0.14), V3(0.9, -0.05, 0), V3(0.45, -0.12, 0)]), mat(apex[0], apex[1] - 0.08, apex[2], a), 0.95);
  }
  bgeo(gilt, hull([...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU) * 0.2, 0, Math.sin((k / 8) * TAU) * 0.2)), V3(0, -0.4, 0)]), mat(apex[0], apex[1] - 0.1, apex[2]), 1.1);
  // Ceiling roses for the two big chandeliers.
  for (const x of [-7, 7]) {
    bgeo(gilt, prism(0.55, 0.45, 0.06, 12), mat(x, Y - 0.03, -2), 0.9);
    for (let k = 0; k < 8; k++) bgeo(cream, hull([V3(0, 0, 0), V3(0.7, 0, -0.12), V3(0.7, 0, 0.12), V3(1.0, 0, 0), V3(0.5, -0.08, 0)]), mat(x, Y - 0.02, -2, (k / 8) * TAU + 0.2), 0.9);
  }
}

function buildHouseWalls(batch, R) {
  const cream = batch.get('cream'), gilt = batch.get('gilt'), mahog = batch.get('mahogany'), dark = batch.get('dark');
  const r = HOUSE;
  // Skirting, the wainscot's cap rail, and the cornice under the ceiling.
  for (const side of ['x0', 'x1', 'z1']) {
    runMoulding(mahog, r, side, 0, [[0.16, 0.04]], 0.8);
    runMoulding(mahog, r, side, 1.14, [[0.06, 0.05], [0.04, 0.07]], 0.9);
    runMoulding(cream, r, side, 10.3, [[0.2, 0.08], [0.16, 0.18], [0.12, 0.3]], 0.85);
    runMoulding(gilt, r, side, 10.24, [[0.06, 0.1]], 0.9);
  }
  // Pilasters with gilt capitals, between the windows, doors and boxes.
  const pil = (x, z, n, y0 = 1.2, y1 = 10.2) => {
    const w = 0.6, d = 0.16;
    const m = mat(x + n[0] * d / 2, 0, z + n[1] * d / 2, Math.atan2(n[0], n[1]));
    bbox(cream, at(m, 0, (y0 + y1) / 2, 0), w, y1 - y0, d, 0.9, 1.5);
    for (const fx of [-0.18, 0, 0.18]) bbox(gilt, at(m, fx, (y0 + y1) / 2, d / 2 + 0.01), 0.05, y1 - y0 - 0.6, 0.02, 0.75, 1);
    bgeo(gilt, hull([V3(-w / 2, 0, 0), V3(w / 2, 0, 0), V3(-w / 2, 0, d + 0.04), V3(w / 2, 0, d + 0.04), V3(-w / 2 - 0.12, 0.35, 0), V3(w / 2 + 0.12, 0.35, 0), V3(-w / 2 - 0.12, 0.35, d + 0.16), V3(w / 2 + 0.12, 0.35, d + 0.16)]), at(m, 0, y1, -d / 2), 1);
    bbox(mahog, at(m, 0, y0 - 0.5, 0.02), w + 0.08, 1.0, d + 0.06, 0.8, 1);
  };
  for (const z of [-8.2, -0.9, 3.8]) { pil(-11.85, z, [1, 0]); pil(11.85, z, [-1, 0]); }
  for (const x of [-10.2, 10.2]) pil(x, 5.85, [0, -1]);
  // Opera boxes: a bowed gilt parapet on a corbel, a dark opening framed in velvet.
  for (const side of [-1, 1]) {
    for (const zc of [-11.2, -4.55]) {
      const wx = side * 11.85, n = -side;   // wall face, inward normal (x)
      const fy = 4.4, W = zc < -10 ? 2.8 : 3.4, D = 1.15;
      // the opening in the wall behind, dark, with a velvet swag each side
      bbox(dark, mat(wx + n * 0.01, fy + 1.3, zc), 0.02, 2.6, W - 0.2, 0.35, 1);
      for (const s of [-1, 1]) drapeSheet(batch.get('drape'), [wx + n * 0.12, zc + s * (W / 2 + 0.05)], [wx + n * 0.12, zc + s * (W / 2 - 0.7)], fy - 0.2, fy + 2.9, 2, 0.07, [n, 0], 1.15);
      drapeSheet(batch.get('drape'), [wx + n * 0.08, zc - W / 2], [wx + n * 0.08, zc + W / 2], fy + 2.3, fy + 2.95, 4, 0.05, [n, 0], 0.85, 0.12);
      bbox(gilt, mat(wx + n * 0.08, fy + 3.0, zc), 0.16, 0.12, W + 0.3, 0.9, 0.5);
      // floor slab and bowed parapet (five facets)
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const u = k / 5, zz = zc - W / 2 + u * W;
        pts.push([wx + n * (0.1 + D * Math.sin(u * Math.PI) * 0.35 + D * 0.65), zz]);
      }
      for (let k = 0; k < 5; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const midx = (ax + bx) / 2, midz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
        bbox(cream, mat(midx, fy + 0.5, midz, yaw), 0.1, 1.0, len + 0.02, 0.8, 1);
        bbox(batch.get('plush'), mat(midx, fy + 1.04, midz, yaw), 0.18, 0.08, len + 0.02, 0.9, 0.5);
        for (const by of [0.1, 0.9]) bbox(gilt, mat(midx + n * 0.02, fy + by, midz, yaw), 0.1, 0.06, len + 0.02, 0.8, 0.3);
        bgeo(gilt, prism(0.13, 0.1, 0.05, 8), at(mat(midx + n * 0.06, fy + 0.5, midz, yaw), 0, 0, 0, Math.PI / 2, 0, Math.PI / 2), 0.9);
        // the underside of the box's floor
        const floor = [[wx, fy, az], [wx, fy, bz], [bx, fy, bz], [ax, fy, az]];
        quad(cream, n > 0 ? floor : [floor[1], floor[0], floor[3], floor[2]], floor.map((p) => [p[0] / 2, p[2] / 2]), (x, y, z) => bake(x, y, z, 0, -1, 0));
      }
      // the corbel under it: a stepped, tapering bracket
      bgeo(cream, hull([V3(0, 0, -W / 2 + 0.2), V3(0, 0, W / 2 - 0.2), V3(D * 0.9, 0, -W / 2 + 0.4), V3(D * 0.9, 0, W / 2 - 0.4), V3(0, -1.1, -0.3), V3(0, -1.1, 0.3), V3(0.15, -1.3, 0)]), mat(wx, fy - 0.02, zc, n > 0 ? 0 : Math.PI), 0.8);
      bgeo(gilt, hull([V3(0, 0, -0.14), V3(0, 0, 0.14), V3(0.12, -0.1, 0), V3(0, -0.3, 0), V3(0.2, 0.1, 0)]), mat(wx + n * 0.5, fy - 0.45, zc, n > 0 ? 0 : Math.PI), 1);
    }
  }
  // The back wall: three pairs of padded doors (sealed), chained; frames on the ports.
  for (const x of [-6.2, 0, 6.2]) {
    const zf = 5.85;
    for (const s of [-1, 1]) {
      const cx = x + s * 0.45;
      bbox(batch.get('plush'), mat(cx, 1.2, zf - 0.04), 0.86, 2.36, 0.06, 0.55, 0.5);
      for (let bi = 0; bi < 12; bi++) bbox(gilt, mat(cx - 0.3 + (bi % 3) * 0.3, 0.45 + Math.floor(bi / 3) * 0.55, zf - 0.08), 0.03, 0.03, 0.02, 1, 0.2);
      bbox(gilt, mat(cx - s * 0.32, 1.1, zf - 0.09), 0.08, 0.36, 0.02, 1, 0.3);
    }
    bbox(mahog, mat(x, 2.46, zf - 0.05), 2.1, 0.14, 0.1, 0.9, 1);
    for (const s of [-1, 1]) bbox(mahog, mat(x + s * 0.97, 1.2, zf - 0.05), 0.14, 2.5, 0.1, 0.9, 1);
    // a chain through the push bars, and a padlock
    for (let k = 0; k < 8; k++) bbox(dark, mat(x - 0.35 + k * 0.1, 1.1 + Math.sin(k * 0.45) * -0.05, zf - 0.12, 0, 0, k % 2 ? 0.4 : -0.4), 0.09, 0.03, 0.03, 0.6, 0.2);
    bbox(batch.get('metal'), mat(x, 0.98, zf - 0.13), 0.08, 0.1, 0.04, 0.6, 0.2);
  }
  for (const x of [-2.25, 2.25]) {
    const zf = 5.85;
    bbox(gilt, mat(x, 8.86, zf - 0.04), 1.8, 0.1, 0.08, 0.9, 0.5);
    bbox(gilt, mat(x, 8.04, zf - 0.04), 1.8, 0.1, 0.08, 0.9, 0.5);
    for (const s of [-1, 1]) bbox(gilt, mat(x + s * 0.85, 8.45, zf - 0.04), 0.1, 0.9, 0.08, 0.9, 0.5);
  }
  // Wall posters in gilt frames by the doors.
  const frame = (x, y, z, yaw, idx) => {
    const m = mat(x, y, z, yaw);
    bbox(gilt, at(m, 0, 0, 0.03), 0.94, 1.34, 0.05, 0.9, 0.5);
    atlasQuad(batch.get('posters'), at(m, 0, 0, 0.061), 0.8, 1.2, posterRect(idx), 0.95);
    atlasQuad(batch.get('mirror'), at(m, 0, 0, 0.07), 0.82, 1.22, [0, 0, 1, 1], 0.6);
  };
  frame(-9.6, 1.95, 5.8, Math.PI, 4);
  frame(9.6, 1.95, 5.8, Math.PI, 6);
  frame(-3.2, 1.95, 5.8, Math.PI, 2);
  frame(3.2, 1.95, 5.8, Math.PI, 7);
}

// Carpet runners down the aisles and across the back, with brass edge strips.
function buildAisles(batch) {
  const gilt = batch.get('gilt');
  const runs = [[-6.15, -13.95, -4.25, 3.55], [4.25, -13.95, 6.15, 3.55], [-11.8, -13.95, -10.35, 3.55], [10.35, -13.95, 11.8, 3.55], [-11.8, 3.55, 11.8, 5.8], [-4.2, -13.95, 4.2, -9.65], [-10.3, -13.95, -6.2, -9.65], [6.2, -13.95, 10.3, -9.65]];
  for (const [x0, z0, x1, z1] of runs) {
    shellFace(batch, [x0, 0, z0, x1, 0.012, z1], 2, () => ['carpet', 1.4], (x, y, z, nx, ny, nz) => bake(x, y, z, nx, ny, nz).map((v) => v * 0.95));
    if (z1 - z0 > 3) for (const x of [x0, x1]) bbox(gilt, mat(x, 0.012, (z0 + z1) / 2), 0.04, 0.012, z1 - z0, 0.7, 1);
  }
}

// The stage's front: a gilt nosing, footlights in a trough, the orchestra rail.
function buildStageFront(batch, R) {
  const gilt = batch.get('gilt'), dark = batch.get('dark'), metal = batch.get('metal');
  bbox(gilt, mat(0, STAGE_Y - 0.03, -14.0), 21.2, 0.08, 0.08, 0.9, 0.5);
  bbox(gilt, mat(0, 0.1, -13.98), 21.2, 0.2, 0.05, 0.8, 0.5);
  // Footlights: a sunk trough with hooded lamps.
  bbox(dark, mat(0, STAGE_Y + 0.02, -14.3), 16, 0.04, 0.3, 0.8, 0.5);
  for (let x = -7.6; x <= 7.6; x += 0.4) {
    const m = mat(x, STAGE_Y + 0.05, -14.3, 0, 0.5);
    bbox(metal, m, 0.26, 0.06, 0.18, 0.5, 0.3);
    if (R() < 0.75) bbox(batch.get('glass'), at(m, 0, -0.01, -0.09), 0.22, 0.05, 0.02, 0.9, 0.3);
  }
  // Orchestra rail: brass posts and rail with a velvet skirt, in front of the apron.
  for (let x = -7.8; x <= 7.81; x += 1.3) {
    bgeo(gilt, prism(0.03, 0.035, 0.95, 8), mat(x, 0.475, -13.8), 1);
    bgeo(gilt, prism(0.05, 0.05, 0.05, 8), mat(x, 0.97, -13.8), 1);
  }
  beam(gilt, [-7.8, 0.95, -13.8], [7.8, 0.95, -13.8], 0.05, 0.05, 1, 0.3);
  drapeSheet(batch.get('drape'), [-7.8, -13.83], [7.8, -13.83], 0.02, 0.9, 20, 0.03, [0, 1], 0.8, 0.02);
}

// The proscenium: gilt-and-cream columns on the pillar colliders, the elliptical arch
// with its archivolt and sunburst crest, the velvet valance and the gathered tabs.
function buildProscenium(batch, R) {
  const cream = batch.get('cream'), gilt = batch.get('gilt'), mahog = batch.get('mahogany'), brick = batch.get('brick');
  const { z0, z1 } = ARCH;
  for (const s of [-1, 1]) {
    const x = s * 11.3;
    bbox(mahog, mat(x, 0.45, -14), 1.6, 0.9, 0.8, 0.8, 1);
    bbox(gilt, mat(x, 0.93, -14), 1.66, 0.08, 0.86, 0.9, 0.5);
    bbox(cream, mat(x, 3.9, -14), 1.4, 6.0, 0.62, 0.9, 1.5);
    for (const fx of [-0.45, -0.15, 0.15, 0.45]) bbox(gilt, mat(x + fx, 3.9, z1 + 0.02), 0.08, 5.4, 0.03, 0.8, 1);
    for (const fz of [-0.2, 0.2]) bbox(gilt, mat(x - s * 0.71, 3.9, -14 + fz), 0.03, 5.4, 0.08, 0.8, 1);
    bgeo(gilt, hull([V3(-0.7, 0, -0.31), V3(0.7, 0, -0.31), V3(-0.7, 0, 0.31), V3(0.7, 0, 0.31), V3(-0.85, 0.6, -0.4), V3(0.85, 0.6, -0.4), V3(-0.85, 0.6, 0.4), V3(0.85, 0.6, 0.4)]), mat(x, 6.9, -14), 1);
    // gathered house tabs, just behind the column
    for (let k = 0; k < 4; k++) {
      const fx = s * (10.2 + k * 0.14), top = archY(10.2) + 0.1;
      bgeo(batch.get('drape'), prism(0.1, 0.13, top - STAGE_Y, 5), mat(fx, (top + STAGE_Y) / 2, -14.5 - (k % 2) * 0.05), 0.7 + 0.1 * (k % 2));
    }
    bgeo(gilt, prism(0.09, 0.09, 0.62, 6), mat(s * 10.4, 2.6, -14.5, 0, 0, Math.PI / 2), 1);
  }
  // Arch face (house side), soffit and back, in vertical strips.
  const N = 40;
  for (let i = 0; i < N; i++) {
    const xa = -12 + (24 * i) / N, xb = -12 + (24 * (i + 1)) / N;
    const ya = Math.abs(xa) < ARCH.half ? archY(xa) : 7.5, yb = Math.abs(xb) < ARCH.half ? archY(xb) : 7.5;
    const f = [[xa, ya, z1], [xb, yb, z1], [xb, 11, z1], [xa, 11, z1]];
    quad(cream, f, f.map((p) => [p[0] / 2.2, p[1] / 2.2]), (x, y, z) => bake(x, y, z + 0.1, 0, 0, 1));
    const bk = [[xb, yb, z0], [xa, ya, z0], [xa, 11, z0], [xb, 11, z0]];
    quad(brick, bk, bk.map((p) => [-p[0] / 2, p[1] / 2]), (x, y, z) => bake(x, y, z - 0.1, 0, 0, -1));
    if (Math.abs((xa + xb) / 2) < ARCH.half + 0.3) {
      const so = [[xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]];
      quad(gilt, so, so.map((p) => [p[0] / 1.2, p[2] / 1.2]), (x, y, z) => bake(x, y - 0.1, z, 0, -1, 0).map((v) => v * 0.9));
    }
  }
  // Archivolt: a gilt band following the arch, with bosses; a frieze of modillions above.
  const band = (d0, d1, zf, tint) => {
    const M = 48;
    for (let k = 0; k < M; k++) {
      const ta = Math.PI * (k / M), tb = Math.PI * ((k + 1) / M);
      const pt = (t, d) => [(ARCH.half + d) * Math.cos(t), ARCH.spring + (ARCH.rise + d) * Math.sin(t), zf];
      const q = [pt(tb, d0), pt(ta, d0), pt(ta, d1), pt(tb, d1)];
      quad(gilt, q, q.map((p) => [p[0] / 1.5, p[1] / 1.5]), (x, y, z) => bake(x, y, z + 0.1, 0, 0, 1).map((v) => v * tint));
    }
  };
  band(0.02, 0.5, z1 + 0.04, 0.9);
  band(0.62, 0.74, z1 + 0.03, 1.05);
  for (let k = 1; k < 12; k++) {
    const t = Math.PI * (k / 12);
    bgeo(gilt, prism(0.13, 0.1, 0.1, 8), mat(10.86 * Math.cos(t), ARCH.spring + 1.76 * Math.sin(t), z1 + 0.09, 0, Math.PI / 2), 1.1);
  }
  bbox(gilt, mat(0, 10.55, z1 + 0.05), 24, 0.14, 0.1, 0.85, 0.6);
  for (let x = -11.5; x <= 11.5; x += 0.8) bbox(gilt, mat(x, 10.4, z1 + 0.08), 0.14, 0.16, 0.16, 0.9, 0.3);
  // The crest: a rising sun, rays fanning out over the arch's crown.
  const cz = z1 + 0.12, cy = archY(0) + 0.72;
  bgeo(gilt, hull([...Array.from({ length: 9 }, (_, k) => V3(Math.cos((k / 8) * Math.PI) * 0.6, Math.sin((k / 8) * Math.PI) * 0.6, 0)), ...Array.from({ length: 9 }, (_, k) => V3(Math.cos((k / 8) * Math.PI) * 0.5, Math.sin((k / 8) * Math.PI) * 0.5, 0.12))]), mat(0, cy, cz), 1.15);
  for (let k = 0; k < 11; k++) {
    const a = (k / 10) * Math.PI, len = k % 2 ? 1.1 : 1.6;
    bgeo(gilt, hull([V3(-0.09, 0, 0), V3(0.09, 0, 0), V3(-0.05, 0, 0.06), V3(0.05, 0, 0.06), V3(0, len, 0.02)]), mat(Math.cos(a) * 0.7, cy + Math.sin(a) * 0.7, cz, 0, 0, a - Math.PI / 2), k % 2 ? 0.8 : 1);
  }
  for (const s of [-1, 1]) {
    bgeo(gilt, prism(0.3, 0.24, 0.08, 10), mat(s * 6.8, 10.0, z1 + 0.05, 0, Math.PI / 2), 1);
    bgeo(gilt, prism(0.22, 0.18, 0.08, 10), mat(s * 11.2, 9.0, z1 + 0.05, 0, Math.PI / 2), 1);
  }
  // The valance: pleated velvet following the arch, scalloped, with a gilt fringe.
  const drape = batch.get('drape');
  const M = 44;
  for (let k = 0; k < M; k++) {
    const xa = -ARCH.half + (2 * ARCH.half * k) / M, xb = -ARCH.half + (2 * ARCH.half * (k + 1)) / M;
    const ta = archY(xa) + 0.05, tb = archY(xb) + 0.05;
    const hem = (x) => 0.95 + 0.14 * Math.abs(Math.sin((x * Math.PI) / 1.6));
    const za = -14.45 + (k % 2 ? 0.07 : 0), zb = -14.45 + ((k + 1) % 2 ? 0.07 : 0);
    const q = [[xa, ta - hem(xa), za], [xb, tb - hem(xb), zb], [xb, tb, zb], [xa, ta, za]];
    const l = (z) => (z > -14.42 ? 1.0 : 0.62);
    quad(drape, q, q.map((p) => [p[0] / 1.2, p[1] / 2.2]), (x, y, z) => bake(x, y, z + 0.1, 0, 0, 1).map((v) => v * l(z)));
    bbox(gilt, mat((xa + xb) / 2, (ta + tb) / 2 - (hem(xa) + hem(xb)) / 2 - 0.05, (za + zb) / 2 + 0.02), Math.abs(xb - xa) * 0.8, 0.12, 0.03, 0.9, 0.3);
  }
}

// The torn screen high on the stage's back wall, in its black masking.
function buildScreen(batch, R) {
  const scr = batch.get('screen'), dark = batch.get('dark');
  const x0 = -6, x1 = 6, y0 = 5.3, y1 = 10.3, z = -21.8;
  const nx = 8, ny = 4;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const ua = i / nx, ub = (i + 1) / nx, va = j / ny, vb = (j + 1) / ny;
      const P = (u, v) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v + Math.sin(u * 9) * 0.02, z + Math.sin(u * 13 + v * 3) * 0.03 + (1 - v) * 0.05];
      const q = [P(ua, va), P(ub, va), P(ub, vb), P(ua, vb)];
      quad(scr, q, [[ua, 1 - va], [ub, 1 - va], [ub, 1 - vb], [ua, 1 - vb]].map(([u, v]) => [u, 1 - v]), (x, y, zz) => bake(x, y, zz + 0.1, 0, 0, 1).map((v) => v * 1.05));
    }
  }
  bbox(dark, mat(0, (y0 + y1) / 2, z - 0.05), 12.1, 5.1, 0.02, 0.15, 1);
  // masking: black borders and a dark frame
  bbox(dark, mat(0, y1 + 0.35, z - 0.04), 13.2, 0.7, 0.06, 0.6, 1);
  bbox(dark, mat(0, y0 - 0.3, z - 0.04), 13.2, 0.6, 0.06, 0.6, 1);
  for (const s of [-1, 1]) bbox(dark, mat(s * 6.4, (y0 + y1) / 2, z - 0.04), 0.8, y1 - y0 + 1.3, 0.06, 0.6, 1);
  // loose flaps hanging from the rips
  for (const [u, v, w, h, rz] of [[0.28, 0.55, 0.5, 1.2, 0.35], [0.66, 0.42, 0.6, 1.5, -0.25], [0.88, 0.7, 0.35, 0.9, 0.5]]) {
    const cx = x0 + (x1 - x0) * u, cy = y0 + (y1 - y0) * v;
    atlasQuad(scr, mat(cx, cy - h / 2, z + 0.15, 0.3 * rz, -0.25, rz), w, h, [u - 0.03, 0.2, u + 0.03, 0.6], 0.8);
  }
}

// Drapes along the stage's side walls, borders overhead, battens, the pin rail and its
// ropes and sandbag counterweights.
function buildRigging(batch, R) {
  const drape = batch.get('drape'), dark = batch.get('dark'), wood = batch.get('woodWall');
  // Legs hugging the side walls (clear of the wing stair's opening on the west).
  for (const [z0, z1] of [[-15.9, -14.6], [-17.8, -16.6], [-21.8, -20.1]]) drapeSheet(drape, [-11.84, z0], [-11.84, z1], STAGE_Y, 9.6, 3, 0.1, [1, 0], [0.35, 0.3, 0.32], 0.04);
  for (const [z0, z1] of [[-15.9, -14.6], [-19.2, -17.9], [-21.8, -20.4]]) drapeSheet(drape, [11.84, z1], [11.84, z0], STAGE_Y, 9.6, 3, 0.1, [-1, 0], [0.35, 0.3, 0.32], 0.04);
  // Black borders high over the stage.
  for (const z of [-17.0, -20.6]) drapeSheet(drape, [-11.8, z], [11.8, z], 9.9, 10.95, 16, 0.06, [0, 1], [0.28, 0.24, 0.26], 0.05);
  // Battens: pipes on lines, with lanterns and a strip light.
  for (const [z, y] of [[-16.0, 8.4], [-19.6, 9.1]]) {
    beam(dark, [-11, y, z], [11, y, z], 0.05, 0.05, 0.8, 0.3);
    for (const x of [-9, -3, 3, 9]) beam(dark, [x, y, z], [x, 11, z], 0.015, 0.015, 1, 0.2);
  }
  for (const x of [-8, -5, -2, 1, 4, 7]) {
    const m = mat(x, 8.15, -16, (R() - 0.5) * 0.4, -0.7 + (R() - 0.5) * 0.3);
    const body = prism(0.12, 0.15, 0.42, 8);
    body.rotateX(Math.PI / 2);
    bgeo(batch.get('metal'), body, m, 0.45);
  }
  bbox(batch.get('metal'), mat(0, 8.95, -19.6), 9, 0.2, 0.25, 0.4, 1);
  // The pin rail on the east wall, with rope lines up into the fly and counterweights.
  bbox(wood, mat(11.7, 2.3, -18.2), 0.18, 0.2, 5.8, 0.7, 1);
  for (const z of [-20.8, -18.2, -15.6]) bbox(dark, mat(11.78, 2.0, z), 0.12, 0.5, 0.08, 0.8, 0.3);
  const lin = batch.get('linen');
  for (let z = -20.9; z <= -15.5; z += 0.36) {
    bgeo(wood, prism(0.018, 0.022, 0.32, 6), mat(11.7, 2.45, z), 0.8);
    if (R() < 0.8) {
      beam(lin, [11.7, 2.55, z], [11.62 - R() * 0.1, 11, z + (R() - 0.5) * 0.4], 0.02, 0.02, [0.55, 0.5, 0.4], 0.3);
      // a loop hanging off the pin
      beam(lin, [11.7, 2.4, z], [11.66, 1.7 - R() * 0.3, z + 0.05], 0.02, 0.02, [0.5, 0.45, 0.36], 0.3);
    }
  }
  const sack = sackGeo(0.3, 0.46, 0.3, R);
  for (const [z, y] of [[-20.2, 4.2], [-19.1, 5.1], [-17.3, 3.7], [-16.2, 4.8]]) {
    bgeo(batch.get('sandbag'), sack, mat(11.55, y, z, 0, 0, Math.PI / 2), 0.7);
    beam(lin, [11.55, y + 0.2, z], [11.55, 11, z], 0.02, 0.02, [0.5, 0.45, 0.36], 0.3);
  }
  ropeCoil(batch, 11.3, STAGE_Y, -21.3, 0.32);
  ropeCoil(batch, 11.35, STAGE_Y, -14.9, 0.26);
}

// A baby grand on the stage (FURNITURE 'piano'), its lid propped open.
function buildPiano(batch, p) {
  const [x0, y0, z0, x1, , z1] = p.solid;
  const ebony = batch.get('mahogany'), gilt = batch.get('gilt'), dark = batch.get('dark');
  const tint = [0.34, 0.3, 0.3];
  const L = x1 - x0, Wd = z1 - z0;
  // the case in plan: straight side along z0, the bentside curving in to the tail at x1
  const plan = [[0, 0], [0, Wd], [L * 0.35, Wd], [L * 0.6, Wd * 0.72], [L * 0.8, Wd * 0.6], [L, Wd * 0.4], [L * 0.98, 0.1], [L * 0.9, 0]];
  const top = y0 + 0.98, bot = y0 + 0.66;
  const pts = [];
  for (const [px, pz] of plan) pts.push(V3(x0 + px, bot, z0 + pz), V3(x0 + px, top, z0 + pz));
  bgeo(ebony, hull(pts, [1, 1, 1]), new THREE.Matrix4(), tint);
  // legs and the pedal lyre
  for (const [px, pz] of [[0.2, 0.15], [0.2, Wd - 0.15], [L * 0.85, Wd * 0.42]]) bgeo(ebony, prism(0.05, 0.07, 0.66, 6), mat(x0 + px, y0 + 0.33, z0 + pz), tint);
  bbox(ebony, mat(x0 + 0.3, y0 + 0.25, z0 + Wd / 2), 0.05, 0.5, 0.2, tint, 0.3);
  bbox(gilt, mat(x0 + 0.24, y0 + 0.06, z0 + Wd / 2), 0.1, 0.02, 0.2, 1, 0.3);
  // keyboard: the key bed, white keys and black keys, the fallboard
  bbox(ebony, mat(x0 - 0.12, y0 + 0.7, z0 + Wd / 2), 0.3, 0.1, Wd, tint, 0.5);
  bbox(batch.get('linen'), mat(x0 - 0.13, y0 + 0.765, z0 + Wd / 2), 0.26, 0.03, Wd - 0.12, [1, 0.96, 0.84], 0.3);
  for (let k = 0; k < 24; k++) if (k % 7 !== 2 && k % 7 !== 6) bbox(dark, mat(x0 - 0.08, y0 + 0.79, z0 + 0.12 + k * ((Wd - 0.24) / 24)), 0.14, 0.03, 0.025, 0.9, 0.2);
  bbox(ebony, mat(x0 + 0.08, y0 + 1.05, z0 + Wd / 2), 0.06, 0.14, Wd - 0.1, tint, 0.3);
  // the lid, hinged along the straight side and propped up
  const lid = mat(x0, top + 0.01, z0, 0, 0, 0);
  const lidPts = [];
  for (const [px, pz] of plan) lidPts.push(V3(px, 0, pz), V3(px, 0.03, pz));
  const g = hull(lidPts, [1, 1, 1]);
  g.rotateX(-0.62);
  bgeo(ebony, g, lid, tint.map((v) => v * 1.15));
  beam(ebony, [x0 + L * 0.55, top, z0 + Wd * 0.82], [x0 + L * 0.55, top + 0.62, z0 + Wd * 0.22], 0.025, 0.025, tint, 0.3);
  // a candelabrum and some sheet music
  bbox(batch.get('paper'), mat(x0 + 0.5, top + 0.005, z0 + Wd * 0.6, 0.3), 0.3, 0.004, 0.4, 0.8, 0.3);
}

// --- Backstage -------------------------------------------------------------------------------------

function buildBackstage(batch, R) {
  const dark = batch.get('dark'), wood = batch.get('woodWall'), metal = batch.get('metal');
  const Y = STAGE_Y;
  // The catwalk: a grating deck on channels, railings, hangers to the ceiling, a ladder.
  const cy = 4.4, cz0 = -27.6, cz1 = -26.6, xa = -11.85, xb = 11.85;
  for (const z of [cz0, cz1]) bbox(metal, mat(0, cy - 0.1, z), xb - xa, 0.2, 0.06, 0.4, 1);
  for (let x = xa + 0.1; x < xb; x += 0.25) bbox(dark, mat(x, cy - 0.02, (cz0 + cz1) / 2), 0.04, 0.03, cz1 - cz0, 0.8, 0.3);
  for (const z of [cz0, cz1]) {
    beam(dark, [xa, cy + 1.0, z], [xb, cy + 1.0, z], 0.045, 0.045, 0.8, 0.3);
    beam(dark, [xa, cy + 0.5, z], [xb, cy + 0.5, z], 0.03, 0.03, 0.8, 0.3);
    for (let x = xa + 0.3; x < xb; x += 1.9) beam(dark, [x, cy, z], [x, cy + 1.0, z], 0.04, 0.04, 0.8, 0.3);
  }
  for (let x = xa + 1.5; x < xb; x += 3.5) for (const z of [cz0, cz1]) beam(dark, [x, cy, z], [x, 6.2, z], 0.02, 0.02, 1, 0.3);
  for (const s of [-0.22, 0.22]) beam(dark, [-11.6, Y, -27.1 + s], [-11.6, cy + 1.0, -27.1 + s], 0.04, 0.04, 0.8, 0.3);
  for (let y = Y + 0.3; y < cy + 0.9; y += 0.3) beam(dark, [-11.6, y, -27.32], [-11.6, y, -26.88], 0.025, 0.025, 0.8, 0.3);
  // Old scenery flats leaning on the walls: canvas painted with sky and hills, battened.
  const flat = (x, z, yaw, w, h, lean, scene) => {
    const m = mat(x, Y, z, yaw, lean);
    const lin = batch.get('linen');
    if (scene) {
      // the painted face (toward +z of the flat's frame): sky above, hills, a painted arch
      bbox(lin, at(m, 0, h * 0.72, 0), w, h * 0.56, 0.02, scene[0], 1.5);
      bbox(lin, at(m, 0, h * 0.22, 0), w, h * 0.44, 0.02, scene[1], 1.5);
      bgeo(lin, hull([V3(-w / 2, 0, 0.015), V3(w / 2, 0, 0.015), V3(-w / 2, h * 0.3, 0.015), V3(w * 0.1, h * 0.52, 0.015), V3(w / 2, h * 0.36, 0.015), V3(-w / 2, 0, 0.02), V3(w / 2, 0, 0.02)]), at(m, 0, h * 0.2, 0), scene[2]);
    } else bbox(lin, at(m, 0, h / 2, 0), w, h, 0.02, [0.62, 0.58, 0.5], 1.5);
    for (const fx of [-w / 2 + 0.04, w / 2 - 0.04]) bbox(wood, at(m, fx, h / 2, -0.04), 0.07, h, 0.06, 0.7, 1);
    for (const fy of [0.05, h * 0.5, h - 0.05]) bbox(wood, at(m, 0, fy, -0.04), w, 0.07, 0.06, 0.7, 1);
    beam(wood, at(m, w * 0.3, h * 0.7, -0.07).elements.slice(12, 15), [at(m, w * 0.3, 0, -0.9).elements[12], Y, at(m, w * 0.3, 0, -0.9).elements[14]], 0.05, 0.05, 0.6, 0.5);
  };
  const skies = [[[0.45, 0.55, 0.8], [0.4, 0.55, 0.35], [0.3, 0.42, 0.28]], [[0.8, 0.55, 0.45], [0.5, 0.42, 0.3], [0.62, 0.5, 0.35]], [[0.35, 0.4, 0.62], [0.28, 0.3, 0.42], [0.2, 0.22, 0.3]]];
  flat(11.6, -28.6, -Math.PI / 2, 1.3, 3.6, -0.12, skies[0]);
  flat(11.55, -27.2, -Math.PI / 2, 1.3, 3.4, -0.1, null);
  flat(11.6, -25.0, -Math.PI / 2, 1.4, 3.8, -0.13, skies[1]);
  flat(-5.4, -22.35, Math.PI, 1.3, 3.2, -0.1, skies[2]);
  flat(-4.1, -22.4, Math.PI, 1.2, 3.0, -0.12, null);
  // Sandbags, rope, a road case, an A-frame ladder, spare seats.
  sandbags(batch, 6.2, Y, -29.5, 0, 5, R);
  sandbags(batch, -3.6, Y, -29.55, 0, 4, R);
  ropeCoil(batch, 2.2, Y, -29.3, 0.34);
  ropeCoil(batch, -8.2, Y, -23, 0.3);
  const rc = mat(-6.8, Y, -29.35, 0.1);
  bgeo(dark, chamferBox(1.1, 0.7, 0.6, 0.04), at(rc, 0, 0.35, 0), 0.8);
  for (const s of [-1, 1]) bbox(metal, at(rc, s * 0.54, 0.35, 0), 0.03, 0.72, 0.62, 0.5, 0.3);
  for (const s of [-1, 1]) {
    beam(wood, [3.2 + s * 0.25, Y, -23.1], [3.2 + s * 0.2, Y + 2.2, -23.45], 0.06, 0.04, 0.7, 0.5);
    beam(wood, [3.2 + s * 0.25, Y, -23.9], [3.2 + s * 0.2, Y + 2.2, -23.5], 0.06, 0.04, 0.7, 0.5);
  }
  for (let y = Y + 0.4; y < Y + 2.1; y += 0.4) beam(wood, [2.97, y, -23.2 - (y - Y) * 0.12], [3.43, y, -23.2 - (y - Y) * 0.12], 0.04, 0.03, 0.7, 0.3);
  // Crates (the FURNITURE box) and the costume rail.
  for (const p of FURNITURE) {
    if (p.kind === 'crates' && p.pos[1] > 1) crateStack(batch, p.solid, R, (m, w, h) => atlasQuad(batch.get('signs'), m, w, h, signRect(SIGNS.stencil), 0.9));
    if (p.kind === 'costumeRack') {
      const [x0, , z0, x1, , z1] = p.solid;
      costumeRail(batch, mat((x0 + x1) / 2, Y, (z0 + z1) / 2), x1 - x0 - 0.1, 1.65, R, COSTUME_COLORS);
    }
  }
  // Bills pasted on the brick, a "keep clear" by the breaker.
  atlasQuad(batch.get('signs'), mat(-1.6, Y + 1.8, -29.84, 0), 0.8, 0.4, signRect(SIGNS.keepOff), 0.9);
  atlasQuad(batch.get('signs'), mat(-9.4, Y + 2.2, -22.16, Math.PI), 1.4, 0.95, signRect(SIGNS.bill), 0.8);
  atlasQuad(batch.get('signs'), mat(5.2, Y + 2.1, -22.16, Math.PI), 1.2, 0.8, signRect(SIGNS.bill2), 0.8);
  atlasQuad(batch.get('signs'), mat(11.84, Y + 2.0, -23.2, -Math.PI / 2), 0.7, 1.05, signRect(SIGNS.cast), 0.8);
  litter(batch, [-11, -29.5, 11, -22.6], Y, 18, R, ['paper', 'woodWall']);
}

// --- The projection booth ---------------------------------------------------------------------------

function projector(batch, x, R) {
  const metal = batch.get('metal'), dark = batch.get('dark'), glass = batch.get('glass');
  const Y = 7.2;
  // pedestal
  bbox(dark, mat(x, Y + 0.03, 6.95), 0.6, 0.06, 0.9, 0.7, 0.5);
  bgeo(dark, prism(0.16, 0.2, 0.85, 8), mat(x, Y + 0.48, 6.95), 0.75);
  bbox(dark, mat(x, Y + 0.92, 6.95), 0.5, 0.05, 0.8, 0.8, 0.5);
  // mechanism head and lens barrel toward the port
  bgeo(metal, chamferBox(0.34, 0.5, 0.52, 0.03), mat(x, Y + 1.2, 6.62), 0.7);
  const lens = prism(0.07, 0.075, 0.3, 8);
  lens.rotateX(Math.PI / 2);
  bgeo(dark, lens, mat(x, Y + 1.25, 6.25), 0.9);
  const lg = prism(0.05, 0.05, 0.01, 8);
  lg.rotateX(Math.PI / 2);
  bgeo(glass, lg, mat(x, Y + 1.25, 6.095), 1);
  // the lamphouse behind, with its chimney to the ceiling and a motor at the side
  bgeo(metal, chamferBox(0.46, 0.58, 0.72, 0.04), mat(x, Y + 1.24, 7.25), 0.55);
  for (let k = 0; k < 5; k++) bbox(dark, mat(x - 0.235, Y + 1.1 + k * 0.06, 7.25), 0.01, 0.025, 0.5, 1, 0.3);
  bgeo(metal, prism(0.1, 0.1, 10 - (Y + 1.53), 8), mat(x, (Y + 1.53 + 10) / 2, 7.35), 0.5);
  const motor = prism(0.1, 0.1, 0.22, 8);
  motor.rotateZ(Math.PI / 2);
  bgeo(dark, motor, mat(x + 0.28, Y + 1.05, 6.7), 0.8);
  // film magazines, above and below, and a reel on the floor
  for (const [my, mr] of [[Y + 1.95, 0.42], [Y + 0.5, 0.36]]) {
    const mag = prism(mr, mr, 0.14, 10);
    mag.rotateZ(Math.PI / 2);
    bgeo(metal, mag, mat(x, my, 6.7), 0.62);
    const hub = prism(0.06, 0.06, 0.16, 6);
    hub.rotateZ(Math.PI / 2);
    bgeo(dark, hub, mat(x, my, 6.7), 1);
  }
  bbox(dark, mat(x, Y + 1.55, 6.66), 0.08, 0.2, 0.08, 0.8, 0.3);
  filmCan(batch.get('metal'), x + (R() - 0.5) * 0.3, Y, 7.75, 0.2, R());
}

function buildBooth(batch, R) {
  const metal = batch.get('metal'), dark = batch.get('dark'), wood = batch.get('woodWall'), paper = batch.get('paper');
  const Y = 7.2;
  for (const x of [-2.25, 2.25]) projector(batch, x, R);
  // port glass and the fire shutters above them
  for (const x of [-2.25, 2.25]) {
    atlasQuad(batch.get('mirror'), mat(x, 8.45, 6.0, 0), 1.5, 0.7, [0, 0, 1, 1], 0.5);
    bbox(metal, mat(x, 8.95, 6.2), 1.7, 0.18, 0.06, 0.45, 0.5);
    beam(dark, [x - 0.8, 9.05, 6.22], [x - 0.8, 9.9, 6.22], 0.015, 0.015, 1, 0.2);
  }
  // rewind bench along the back wall, with reels and a splicer
  bbox(wood, mat(0, Y + 0.9, 9.6), 3.4, 0.05, 0.5, 0.7, 1);
  for (const x of [-1.6, 1.6]) for (const z of [9.4, 9.8]) bbox(dark, mat(x, Y + 0.45, z), 0.05, 0.88, 0.05, 0.8, 0.3);
  for (const x of [-1.1, 1.1]) {
    bbox(dark, mat(x, Y + 1.05, 9.6), 0.08, 0.25, 0.08, 0.8, 0.3);
    const reel = prism(0.3, 0.3, 0.04, 10);
    reel.rotateZ(Math.PI / 2);
    bgeo(metal, reel, mat(x, Y + 1.25, 9.6), 0.75);
  }
  bbox(metal, mat(0, Y + 0.97, 9.55), 0.3, 0.08, 0.14, 0.6, 0.3);
  // shelves of film cans on the side walls
  for (const s of [-1, 1]) {
    const x = s * 4.6;
    for (const y of [0.1, 0.7, 1.3, 1.9]) bbox(wood, mat(x, Y + y, 8.1), 0.45, 0.04, 2.6, 0.6, 1);
    for (const z of [6.85, 9.35]) bbox(dark, mat(x, Y + 1.0, z), 0.45, 2.0, 0.04, 0.6, 0.5);
    for (const y of [0.12, 0.72, 1.32, 1.92]) {
      for (let k = 0; k < 5; k++) {
        if (R() < 0.25) continue;
        const n = 1 + Math.floor(R() * 5);
        for (let j = 0; j < n; j++) filmCan(metal, x, Y + y + j * 0.05, 7.1 + k * 0.5, 0.19, R());
      }
    }
  }
  // a chair, a fire bucket, posters and a calendar taped up
  const ch = mat(-1.2, Y, 8.6, 0.6);
  bbox(wood, at(ch, 0, 0.45, 0), 0.42, 0.04, 0.42, 0.7, 0.5);
  for (const [cx, cz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) bbox(dark, at(ch, cx, 0.22, cz), 0.03, 0.44, 0.03, 0.8, 0.3);
  bbox(wood, at(ch, 0, 0.75, 0.2), 0.42, 0.3, 0.03, 0.7, 0.5);
  bgeo(batch.get('rust'), prism(0.14, 0.11, 0.26, 8), mat(3.7, Y + 0.13, 9.5), 0.8);
  atlasQuad(batch.get('posters'), mat(-3.4, Y + 1.7, 9.84, Math.PI), 0.6, 0.9, posterRect(1), 0.8);
  atlasQuad(batch.get('posters'), mat(0.2, Y + 1.8, 9.84, Math.PI), 0.55, 0.82, posterRect(3), 0.8);
  atlasQuad(batch.get('signs'), mat(3.5, Y + 2.1, 9.84, Math.PI), 0.9, 0.45, signRect(SIGNS.projection), 0.8);
  // a sealed steel door on the back wall
  bbox(metal, mat(3.5, Y + 1.05, 9.83), 0.95, 2.1, 0.04, 0.5, 1);
  bbox(dark, mat(3.15, Y + 1.0, 9.8), 0.04, 0.2, 0.04, 1, 0.2);
  litter(batch, [-4.6, 6.4, 4.6, 9.6], Y, 12, R, ['paper']);
  bbox(paper, mat(-2.6, Y + 0.005, 7.9, 0.3), 0.8, 0.003, 0.1, 0.4, 0.3);   // a strip of film
}

// A faint shaft of moonlight from the hole in the dome down onto the seats: the shaft
// itself is a mesh made per level (attachTheatre); here, where it stands, and the plaster
// it lights on the seats and the floor.
function buildMoonbeam(batch, R) {
  const Rs = (DOME.r ** 2 + DOME.h ** 2) / (2 * DOME.h), cy = DOME.y + DOME.h - Rs, th = Math.asin(DOME.r / Rs) * 0.85, ph = (14.8 / 24) * Math.PI * 2;
  const top = new THREE.Vector3(DOME.x + Rs * Math.sin(th) * Math.cos(ph), cy + Rs * Math.cos(th), DOME.z + Rs * Math.sin(th) * Math.sin(ph));
  const len = top.y / -MOON_DIR.y;
  const foot = top.clone().addScaledVector(MOON_DIR, len);
  const shaft = { len, position: top.clone().add(foot).multiplyScalar(0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), MOON_DIR) };
  shaft.zones = zonesTouching([Math.min(top.x, foot.x) - 1.5, 0, Math.min(top.z, foot.z) - 1.5, Math.max(top.x, foot.x) + 1.5, top.y, Math.max(top.z, foot.z) + 1.5], 0);
  // plaster fallen on the seats and the floor under the hole
  const cream = batch.get('cream');
  for (let k = 0; k < 26; k++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 2.4;
    const x = foot.x + Math.cos(a) * d, z = foot.z + Math.sin(a) * d;
    const row = FURNITURE.find((p) => p.kind === 'seats' && x > p.solid[0] && x < p.solid[3] && z > p.solid[2] && z < p.solid[5]);
    const y = row ? 0.9 : 0.02;
    bgeo(cream, rubble(0.1 + R() * 0.3, 0.06 + R() * 0.08, 0.1 + R() * 0.25), mat(x, y + 0.04, z, R() * 6, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5), [0.5, 0.52, 0.56]);
  }
  for (let k = 0; k < 4; k++) bbox(batch.get('woodWall'), mat(foot.x + (R() - 0.5) * 2, 0.95, foot.z + (R() - 0.5) * 2, R() * 6, 0.3, 0.2), 1.1, 0.02, 0.05, 0.5, 0.5);
  return shaft;
}

// The moonbeam's shaft for a level: a faint additive cone, its own material.
export function attachTheatre(level, shaft, reg) {
  const geo = new THREE.CylinderGeometry(1.0, 1.5, shaft.len, 8, 1, true);
  const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vFade; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = exp(-length(mv.xyz) * 0.03);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vFade; varying vec3 vN; varying vec3 vV;
      void main() {
        float a = smoothstep(0.0, 0.3, vUv.y) * (0.3 + 0.7 * vUv.y);
        a *= 0.7 + 0.3 * sin(vUv.x * 37.0 + vUv.y * 9.0);
        float face = abs(dot(normalize(vN), normalize(vV)));
        a *= face * face;   // soft at the edges of the shaft
        gl_FragColor = vec4(vec3(0.3, 0.38, 0.52) * a * 0.055 * vFade, 1.0);
      }`,
  }));
  m.position.copy(shaft.position);
  m.quaternion.copy(shaft.quaternion);
  m.renderOrder = 3;
  m.name = 'moonbeam';
  level.group.add(m);
  reg(m, shaft.zones);
  return {};
}

export function* buildTheatre(ctx) {
  const R = rng(1962), batch = ctx.batch;
  const moon = buildMoonbeam(batch, R);
  buildSeats(ctx, batch, R);
  yield;
  buildCeiling(batch, R);
  yield;
  buildHouseWalls(batch, R);
  yield;
  buildAisles(batch);
  buildStageFront(batch, R);
  yield;
  buildProscenium(batch, R);
  yield;
  buildScreen(batch, R);
  buildRigging(batch, R);
  yield;
  for (const p of FURNITURE) if (p.kind === 'piano') buildPiano(batch, p);
  buildBackstage(batch, R);
  yield;
  buildBooth(batch, R);
  // the gilt frame round the Forge's alcove, under the curtain's pelmet
  const gilt = batch.get('gilt');
  for (const s of [-1, 1]) bbox(gilt, mat(s * 2.62, STAGE_Y + 1.9, -21.8), 0.24, 3.8, 0.12, 0.85, 0.5);
  litter(batch, [-11, -13.8, 11, 5.5], 0, 26, R, ['paper']);
  litter(batch, [-11, -21.5, 11, -14.6], STAGE_Y, 10, R, ['paper']);
  return moon;
}
