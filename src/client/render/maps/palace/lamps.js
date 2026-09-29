// A fixture for every lamp in the map's LIGHTS: crystal chandeliers, tulip sconces, the
// street lamp, pendants, bare bulbs on flex, cage lamps, the red EXIT sign, the
// front-of-house spot and the vanity's ring of bulbs. The frames go into the batch;
// what glows is one mesh per lamp with its own MeshBasicMaterial, which the rig sets
// to the lamp's live level (rig.bulbs[i].bulb). A soft billboard halo per lamp follows
// the same level, so a lit fixture blooms in the fog and a dead one doesn't.

import * as THREE from 'three';
import { LIGHTS } from '../../../../shared/maps/palace.js';
import { GeoBuilder, rng } from '../../geo.js';
import { chamferBox, hull, prism } from '../../level.js';
import { V3, at, mat, bbox, bgeo, beam } from './kit.js';
import { signRect, SIGNS } from './paint.js';
import { zonesTouching } from './zones.js';

const TAU = Math.PI * 2;
const WARM = [1, 0.86, 0.62], PALE = [0.92, 0.88, 0.78], COLD = [0.78, 0.86, 1];

// What each lamp is (by LIGHTS index), and where it hangs from.
const FIXTURES = [
  { kind: 'chandelier', size: 1.0, top: 6.0, halo: 2.4 },          // foyer
  { kind: 'sconce', n: [1, 0], wall: -10.85, halo: 1.0 },          // foyer west wall
  { kind: 'sconce', n: [-1, 0], wall: 10.85, halo: 1.0 },          // foyer east wall
  { kind: 'street', halo: 3.2, tint: COLD },                       // the street lamp
  { kind: 'chandelier', size: 0.62, top: 7.0, halo: 1.8 },         // stair hall
  { kind: 'bowl', top: 6.6, halo: 1.3 },                           // dressing rooms, by the door
  { kind: 'vanity', halo: 1.4 },                                   // the vanity's mirror
  { kind: 'bare', top: 6.6, halo: 0.9 },                           // dressing rooms, far end
  { kind: 'shade', top: 3.2, halo: 0.9, enamel: 0.35 },            // box office
  { kind: 'gooseneck', wall: 17.85, halo: 2.2, tint: COLD },       // alley: mercury lamp
  { kind: 'wire', halo: 1.3 },                                     // alley: a bulb on a wire
  { kind: 'chandelier', size: 1.55, top: 11, halo: 3.4 },          // auditorium west
  { kind: 'chandelier', size: 1.55, top: 11, halo: 3.4 },          // auditorium east
  { kind: 'exit', halo: 1.0, tint: [1, 0.3, 0.22] },               // EXIT over the back doors
  { kind: 'spot', halo: 1.6 },                                     // front-of-house spot
  { kind: 'cage', top: 11, halo: 1.2 },                            // stage: work lamp on a rope
  { kind: 'shade', top: 6.2, halo: 1.4, enamel: 0.5 },             // backstage
  { kind: 'cage', top: 4.4, halo: 1.3, tint: [1, 0.32, 0.2], red: true },   // backstage: red lamp under the catwalk
  { kind: 'bare', top: 10, halo: 0.9 },                            // booth
  { kind: 'alcove', halo: 0.9 },                                   // the Forge's alcove
  { kind: 'sconce', n: [1, 0], wall: -10.85, halo: 1.0 },          // foyer west wall, by the sealed doors
  { kind: 'sconce', n: [-1, 0], wall: 10.85, halo: 1.0 },          // foyer east wall, by the ticket booth
];

// Glowing bits: a GeoBuilder per lamp, tinted by vertex colour.
function glow() { return new GeoBuilder(); }

// A candle bulb: a small faceted flame.
const flameGeo = () => hull([V3(0, 0.07, 0), V3(0.022, 0.02, 0), V3(-0.022, 0.02, 0), V3(0, 0.02, 0.022), V3(0, 0.02, -0.022), V3(0, -0.015, 0)]);
const dropGeo = () => hull([V3(0, 0.035, 0), V3(0.016, 0, 0.009), V3(-0.016, 0, 0.009), V3(0, 0, -0.018), V3(0, -0.05, 0)]);

function chandelier(batch, g, p, F, R) {
  const s = F.size;
  const gilt = batch.get('gilt'), dark = batch.get('dark');
  const [x, y, z] = p;
  const base = mat(x, y, z);
  // Ceiling rose, chain, the stem with its knops, and the bowl.
  bgeo(gilt, prism(0.34 * s, 0.26 * s, 0.07, 12), mat(x, F.top - 0.035, z), 0.9);
  const chainTop = F.top - 0.07, stemTop = y + 0.55 * s;
  for (let cy = chainTop; cy > stemTop; cy -= 0.09) {
    bbox(dark, mat(x, cy - 0.045, z, (cy * 7) % 2 ? 0 : Math.PI / 2), 0.02, 0.08, 0.05, 0.8, 0.2);
  }
  bgeo(gilt, prism(0.03 * s, 0.03 * s, 0.55 * s, 6), at(base, 0, 0.27 * s, 0), 1);
  for (const [ky, kr] of [[0.5, 0.07], [0.3, 0.09], [0.05, 0.14]]) bgeo(gilt, prism(kr * s, kr * s * 0.7, 0.06 * s, 8), at(base, 0, ky * s, 0), 1);
  bgeo(gilt, hull([
    ...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU) * 0.3 * s, 0, Math.sin((k / 8) * TAU) * 0.3 * s)),
    ...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU) * 0.12 * s, -0.18 * s, Math.sin((k / 8) * TAU) * 0.12 * s)),
    V3(0, -0.26 * s, 0),
  ]), base, 1.05);
  // Arms in two tiers, each ending in a candle cup and a flame bulb; strings of drops.
  const tiers = s > 1.2 ? [[10, 0.62, 0.02], [7, 0.36, 0.3]] : [[8, 0.55, 0.02], [5, 0.3, 0.26]];
  for (const [n, r, ty] of tiers) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + ty;
      const cx = Math.cos(a) * r * s, cz = Math.sin(a) * r * s;
      const broken = R() < 0.1;
      // The arm: out along the bowl's rim, then up to the cup.
      const ax = Math.cos(a) * 0.22 * s, az = Math.sin(a) * 0.22 * s;
      beam(gilt, [x + ax, y + ty * s - 0.05 * s, z + az], [x + cx, y + ty * s - 0.08 * s, z + cz], 0.025 * s, 0.025 * s, 0.9, 0.3);
      if (broken) continue;
      beam(gilt, [x + cx, y + ty * s - 0.08 * s, z + cz], [x + cx, y + ty * s + 0.05 * s, z + cz], 0.025 * s, 0.025 * s, 0.9, 0.3);
      bgeo(gilt, prism(0.045 * s, 0.025 * s, 0.05 * s, 6), mat(x + cx, y + ty * s + 0.07 * s, z + cz), 1);
      g.geo(flameGeo(), mat(x + cx, y + ty * s + 0.1 * s, z + cz, 0, 0, 0, s), WARM);
      // A string of three drops below the arm.
      if (R() < 0.8) for (let d = 0; d < 3; d++) g.geo(dropGeo(), mat(x + cx * 0.9, y + ty * s - (0.14 + d * 0.07) * s, z + cz * 0.9, 0, 0, 0, s), [0.55, 0.5, 0.44]);
    }
  }
  // Festoons of drops between the arms, and a final pendant.
  const n = s > 1.2 ? 16 : 10;
  for (let k = 0; k < n; k++) {
    if (R() < 0.15) continue;
    const a = (k / n) * TAU;
    for (let d = 0; d < 4; d++) {
      const u = d / 3, r = (0.3 + 0.28 * u) * s, sag = Math.sin(u * Math.PI) * 0.12 * s;
      g.geo(dropGeo(), mat(x + Math.cos(a + u * 0.35) * r, y - 0.12 * s - sag, z + Math.sin(a + u * 0.35) * r, 0, 0, 0, s * 0.9), [0.5, 0.46, 0.4]);
    }
  }
  g.geo(hull([V3(0, 0, 0), V3(0.05, -0.08, 0), V3(-0.05, -0.08, 0), V3(0, -0.08, 0.05), V3(0, -0.08, -0.05), V3(0, -0.22, 0)]), mat(x, y - 0.28 * s, z, 0, 0, 0, s), [0.6, 0.55, 0.48]);
}

function sconce(batch, g, p, F) {
  const gilt = batch.get('gilt');
  const [nx] = F.n;
  const yaw = Math.atan2(nx, 0);
  const m = mat(F.wall, p[1], p[2], yaw);
  const reach = Math.abs(p[0] - F.wall);
  // Backplate, a scrolled arm, a cup, and the tulip shade that glows.
  bgeo(gilt, hull([V3(-0.09, -0.22, 0), V3(0.09, -0.22, 0), V3(-0.12, 0.05, 0), V3(0.12, 0.05, 0), V3(0, 0.2, 0), V3(-0.08, -0.2, 0.04), V3(0.08, -0.2, 0.04), V3(-0.1, 0.04, 0.04), V3(0.1, 0.04, 0.04), V3(0, 0.17, 0.04)]), at(m, 0, -0.18, 0), 1);
  beam(gilt, [F.wall + nx * 0.03, p[1] - 0.25, p[2]], [F.wall + nx * reach * 0.6, p[1] - 0.18, p[2]], 0.035, 0.035, 0.9, 0.3);
  beam(gilt, [F.wall + nx * reach * 0.6, p[1] - 0.18, p[2]], [p[0], p[1] - 0.1, p[2]], 0.03, 0.03, 0.9, 0.3);
  bgeo(gilt, prism(0.05, 0.03, 0.05, 6), mat(p[0], p[1] - 0.08, p[2]), 1);
  const tulip = hull([
    ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.05, 0, Math.sin((k / 6) * TAU) * 0.05)),
    ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU + 0.5) * 0.11, 0.16, Math.sin((k / 6) * TAU + 0.5) * 0.11)),
  ]);
  g.geo(tulip, mat(p[0], p[1] - 0.06, p[2]), [0.95, 0.78, 0.55]);
}

function street(batch, g, p) {
  const iron = batch.get('dark');
  const [x, , z] = p;
  const px = x, pz = z + 0.45;   // the post stands at the kerb; the lantern leans over the pavement
  bgeo(iron, prism(0.2, 0.26, 0.5, 8), mat(px, 0.25, pz), 0.8);
  bgeo(iron, prism(0.14, 0.18, 0.3, 8), mat(px, 0.62, pz), 0.8);
  bgeo(iron, prism(0.065, 0.1, 4.2, 8), mat(px, 2.85, pz), 0.8);
  for (const y of [1.2, 3.2]) bgeo(iron, prism(0.11, 0.11, 0.08, 8), mat(px, y, pz), 0.8);
  // The crook: up, over and down to the lantern.
  const pts = [[px, 4.9, pz], [px, 5.6, pz - 0.05], [px, 5.95, pz - 0.25], [px, 5.95, z - 0.02]];
  for (let k = 0; k < pts.length - 1; k++) beam(iron, pts[k], pts[k + 1], 0.07, 0.07, 0.75, 0.3);
  // Lantern: a cap, four panes (the glowing part) and a finial.
  bgeo(iron, hull([V3(-0.26, 0, -0.26), V3(0.26, 0, -0.26), V3(-0.26, 0, 0.26), V3(0.26, 0, 0.26), V3(0, 0.22, 0)]), mat(x, p[1] + 0.26, z), 0.7);
  bgeo(iron, prism(0.12, 0.08, 0.1, 8), mat(x, p[1] - 0.24, z), 0.7);
  g.geo(prism(0.2, 0.12, 0.46, 4, [1, 1, 1], Math.PI / 4), mat(x, p[1] + 0.02, z), COLD);
}

function pendant(batch, g, p, F, kind) {
  const [x, y, z] = p;
  const flex = batch.get('dark');
  beam(flex, [x, F.top, z], [x, y + (kind === 'shade' ? 0.2 : kind === 'bowl' ? 0.12 : 0.08), z], 0.012, 0.012, 1, 0.2);
  bgeo(flex, prism(0.05, 0.05, 0.03, 6), mat(x, F.top - 0.015, z), 1);
  if (kind === 'bare') {
    bgeo(flex, prism(0.022, 0.022, 0.05, 6), mat(x, y + 0.06, z), 1);
    g.geo(hull([V3(0, 0.04, 0), ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.035, -0.01, Math.sin((k / 6) * TAU) * 0.035)), V3(0, -0.05, 0)]), mat(x, y, z), WARM);
  } else if (kind === 'shade') {
    const enamel = batch.get('metal');
    bgeo(enamel, new THREE.CylinderGeometry(0.07, 0.3, 0.2, 10, 1, true).toNonIndexed(), mat(x, y + 0.1, z), F.enamel);
    const inside = new THREE.CylinderGeometry(0.066, 0.285, 0.19, 10, 1, true);
    g.geo(inside.toNonIndexed(), mat(x, y + 0.1, z), [0.7, 0.6, 0.45]);
    g.geo(hull([V3(0, 0.04, 0), ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.04, -0.01, Math.sin((k / 6) * TAU) * 0.04)), V3(0, -0.055, 0)]), mat(x, y + 0.02, z), WARM);
  } else if (kind === 'bowl') {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      beam(flex, [x, y + 0.3, z], [x + Math.cos(a) * 0.2, y + 0.03, z + Math.sin(a) * 0.2], 0.008, 0.008, 1, 0.2);
    }
    g.geo(hull([
      ...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU) * 0.22, 0.03, Math.sin((k / 8) * TAU) * 0.22)),
      ...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU + 0.4) * 0.14, -0.1, Math.sin((k / 8) * TAU + 0.4) * 0.14)),
    ]), mat(x, y, z), PALE);
  }
}

// A lamp in a wire cage (work lights, the red lamp).
function cage(batch, g, x, y, z, tint, top = null) {
  const metal = batch.get('dark');
  if (top != null) beam(batch.get('linen'), [x, top, z], [x, y + 0.14, z], 0.02, 0.02, [0.55, 0.5, 0.42], 0.3);
  bgeo(metal, prism(0.05, 0.06, 0.08, 6), mat(x, y + 0.1, z), 1);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    beam(metal, [x, y + 0.08, z], [x + Math.cos(a) * 0.08, y - 0.02, z + Math.sin(a) * 0.08], 0.01, 0.01, 1, 0.1);
    beam(metal, [x + Math.cos(a) * 0.08, y - 0.02, z + Math.sin(a) * 0.08], [x, y - 0.12, z], 0.01, 0.01, 1, 0.1);
  }
  g.geo(hull([V3(0, 0.05, 0), ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.045, -0.01, Math.sin((k / 6) * TAU) * 0.045)), V3(0, -0.07, 0)]), mat(x, y, z), tint);
}

function gooseneck(batch, g, p, F) {
  const metal = batch.get('dark');
  const [x, y, z] = p;
  const pts = [[F.wall, y + 0.6, z], [F.wall - 0.25, y + 0.62, z], [x + 0.2, y + 0.5, z], [x, y + 0.3, z]];
  bgeo(metal, chamferBox(0.04, 0.3, 0.2, 0.01), mat(F.wall - 0.02, y + 0.6, z), 0.8);
  for (let k = 0; k < pts.length - 1; k++) beam(metal, pts[k], pts[k + 1], 0.05, 0.05, 0.7, 0.3);
  const cone = new THREE.CylinderGeometry(0.08, 0.36, 0.22, 10, 1, true).toNonIndexed();
  bgeo(batch.get('metal'), cone, mat(x, y + 0.14, z), 0.4);
  g.geo(new THREE.CylinderGeometry(0.075, 0.34, 0.2, 10, 1, true).toNonIndexed(), mat(x, y + 0.14, z), [0.55, 0.62, 0.72]);
  g.geo(hull([V3(0, 0.06, 0), ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.07, -0.01, Math.sin((k / 6) * TAU) * 0.07)), V3(0, -0.08, 0)]), mat(x, y + 0.04, z), COLD);
}

// A bulb hanging off a wire strung across the alley.
function wire(batch, g, p) {
  const [x, y, z] = p;
  const dark = batch.get('dark');
  const a = [12.15, y + 0.9, z + 0.3], b = [17.85, y + 1.2, z - 0.4];
  const sag = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * 0.45, a[2] + (b[2] - a[2]) * u];
  let prev = sag(0);
  for (let k = 1; k <= 10; k++) { const q = sag(k / 10); beam(dark, prev, q, 0.015, 0.015, 1, 0.2); prev = q; }
  const u = (x - a[0]) / (b[0] - a[0]);
  const hook = sag(u);
  beam(dark, hook, [x, y + 0.14, z], 0.012, 0.012, 1, 0.2);
  bbox(dark, mat(a[0] + 0.05, a[1], a[2]), 0.1, 0.08, 0.08, 1, 0.2);
  bbox(dark, mat(b[0] - 0.05, b[1], b[2]), 0.1, 0.08, 0.08, 1, 0.2);
  cage(batch, g, x, y, z, WARM);
}

// An EXIT box on a wall: m stands at the wall face, its +Z out into the room.
function exitBox(batch, g, m) {
  const dark = batch.get('dark');
  bbox(dark, at(m, 0, 0, 0.07), 0.7, 0.3, 0.14, 0.9, 0.3);
  const r = signRect(SIGNS.exit);
  const face = new THREE.PlaneGeometry(0.62, 0.24);
  const uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  g.geo(face, at(m, 0, 0, 0.142), [1, 1, 1]);
}

// The EXIT over the back doors, and a second over the side door to the alley; both are
// the one lamp.
function exitSign(batch, g, p) {
  const [x, y] = p;
  exitBox(batch, g, mat(x, y, 6 - 0.15, Math.PI));
  exitBox(batch, g, mat(12 - 0.15, 2.85, -5, -Math.PI / 2));
}

// The front-of-house lighting pipe across the auditorium, with a row of spots aimed at
// the stage; the centre one is the lamp.
function spotBar(batch, g, p, R) {
  const [x, y, z] = p;
  const dark = batch.get('dark'), metal = batch.get('metal');
  const barY = y + 0.35;
  beam(dark, [-9, barY, z], [9, barY, z], 0.06, 0.06, 0.8, 0.3);
  for (const hx of [-8, -3, 3, 8]) beam(dark, [hx, barY, z], [hx, 11, z], 0.025, 0.025, 1, 0.3);
  for (const sx of [-7, -4.5, -2, 0, 2, 4.5, 7]) {
    const yaw = Math.PI + (R() - 0.5) * 0.3 - sx * 0.02;
    const pitch = -0.55 + (R() - 0.5) * 0.2;
    const m = mat(sx, y, z, yaw, pitch);
    beam(dark, [sx, barY, z], [sx, y + 0.12, z], 0.02, 0.05, 1, 0.3);
    const body = prism(0.14, 0.17, 0.5, 8);
    body.rotateX(Math.PI / 2);
    bgeo(metal, body, m, 0.45);
    bbox(dark, at(m, 0, 0, -0.26), 0.22, 0.22, 0.03, 1, 0.3);
    if (sx === 0) {
      const lens = prism(0.12, 0.12, 0.03, 8);
      lens.rotateX(Math.PI / 2);
      g.geo(lens, at(m, 0, 0, 0.26), WARM);
    } else {
      const lens = prism(0.12, 0.12, 0.03, 8);
      lens.rotateX(Math.PI / 2);
      bgeo(batch.get('glass'), lens, at(m, 0, 0, 0.26), 0.8);
    }
  }
}

// The vanity mirror's frame of bulbs (the vanity against the west wall at z = -4).
function vanityRing(batch, g) {
  const x = -17.8, y0 = 4.5, y1 = 5.75, z0 = -5.0, z1 = -3.0;
  const bulb = () => hull([V3(0, 0.035, 0), ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.035, 0, Math.sin((k / 6) * TAU) * 0.035)), V3(0, -0.035, 0)]);
  const dead = batch.get('dark');
  const R = rng(66);
  const spots = [];
  for (let z = z0; z <= z1 + 1e-3; z += 0.25) spots.push([x, y1, z]);
  for (let y = y0; y < y1 - 0.1; y += 0.25) { spots.push([x, y, z0]); spots.push([x, y, z1]); }
  for (const [bx, by, bz] of spots) {
    if (R() < 0.18) { bgeo(dead, bulb(), mat(bx + 0.06, by, bz), 0.5); continue; }
    g.geo(bulb(), mat(bx + 0.06, by, bz), WARM);
  }
}

function alcove(batch, g, p) {
  for (const sx of [-1, 1]) {
    const x = sx * 2.3;
    bbox(batch.get('dark'), mat(sx * 2.34, p[1] + 0.12, p[2]), 0.04, 0.16, 0.12, 1, 0.2);
    beam(batch.get('dark'), [sx * 2.34, p[1] + 0.12, p[2]], [x, p[1] + 0.12, p[2]], 0.02, 0.02, 1, 0.2);
    cage(batch, g, x, p[1], p[2], [1, 0.62, 0.3]);
  }
}

// --- Halos ------------------------------------------------------------------------------------

function haloMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vCol; varying float vFade;
      void main() {
        vUv = uv;
        vCol = instanceColor;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        mv.xy += position.xy * s;
        vFade = exp(-length(mv.xyz) * 0.045);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vCol; varying float vFade;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.4);
        gl_FragColor = vec4(vCol * a * vFade, 1.0);
      }`,
  });
}

// The fixtures' frames go into the batch; the glowing parts and the halos' places come back
// as data (geometry built once, meshes made per level by attachLamps).
export function* buildLamps(batch) {
  const R = rng(4411);
  const halos = [], plain = [];
  let sign = null;
  for (const [i, l] of LIGHTS.entries()) {
    const F = FIXTURES[i] || { kind: 'bare', top: l.pos[1] + 0.5, halo: 0.8 };
    const g = glow();
    let map = null;
    switch (F.kind) {
      case 'chandelier': chandelier(batch, g, l.pos, F, R); break;
      case 'sconce': sconce(batch, g, l.pos, F); break;
      case 'street': street(batch, g, l.pos); break;
      case 'bare': case 'shade': case 'bowl': pendant(batch, g, l.pos, F, F.kind); break;
      case 'vanity': vanityRing(batch, g); break;
      case 'cage': cage(batch, g, l.pos[0], l.pos[1], l.pos[2], F.tint || WARM, F.top); break;
      case 'gooseneck': gooseneck(batch, g, l.pos, F); break;
      case 'wire': wire(batch, g, l.pos); break;
      case 'exit': exitSign(batch, g, l.pos); map = 'signs'; break;
      case 'spot': spotBar(batch, g, l.pos, R); break;
      case 'alcove': alcove(batch, g, l.pos); break;
      default: pendant(batch, g, l.pos, { top: l.pos[1] + 0.5 }, 'bare');
    }
    const geo = g.build();
    if (map) {
      const bb = geo.boundingBox;
      sign = { i, geo, map, zones: zonesTouching([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z], 0.3) };
    } else plain.push({ i, geo });
    const c = new THREE.Color(l.color);
    if (F.tint) c.setRGB(c.r * F.tint[0] * 1.1, c.g * F.tint[1] * 1.1, c.b * F.tint[2] * 1.1);
    const hp = F.kind === 'exit' ? [l.pos[0], l.pos[1], 5.7] : F.kind === 'vanity' ? [-17.7, 5.1, -4] : F.kind === 'spot' ? [0, l.pos[1], l.pos[2] - 0.3] : l.pos;
    halos.push({ i, pos: hp, size: F.halo, color: c, str: F.kind === 'chandelier' ? 0.5 : 0.42 });
    if (F.kind === 'exit') halos.push({ i, pos: [11.6, 2.85, -5], size: F.halo, color: c, str: 0.42 });
    if (F.kind === 'alcove') halos.push({ i, pos: [-2.3, l.pos[1], l.pos[2]], size: F.halo, color: c, str: 0.4 }, { i, pos: [2.3, l.pos[1], l.pos[2]], size: F.halo, color: c, str: 0.4 });
    if (i % 4 === 3) yield;
  }
  return { glows: mergeGlows(plain), sign, halos };
}

// Every lamp's glowing parts as one geometry (one draw): positions, the tint each vertex has at
// full glow, and where in it each lamp's vertices are.
function mergeGlows(list) {
  let nv = 0, ni = 0;
  for (const { geo } of list) { nv += geo.attributes.position.count; ni += geo.index.count; }
  const position = new Float32Array(nv * 3), tint = new Float32Array(nv * 3), index = new Uint32Array(ni);
  const ranges = [];
  let vo = 0, io = 0;
  for (const { i, geo } of list) {
    const n = geo.attributes.position.count;
    position.set(geo.attributes.position.array, vo * 3);
    tint.set(geo.attributes.color.array, vo * 3);
    for (let k = 0; k < geo.index.count; k++) index[io + k] = geo.index.array[k] + vo;
    ranges.push({ i, from: vo * 3, to: (vo + n) * 3 });
    vo += n; io += geo.index.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? index : Uint16Array.from(index), 1));
  geo.computeBoundingSphere();
  return { position: geo.attributes.position, index: geo.index, sphere: geo.boundingSphere, tint, ranges };
}

// A level's lamps: one mesh for the glow of all of them (the rig sets each lamp's live level on
// a stand-in for its bulb, rig.bulbs[i].bulb.material.color, and the vertices are lit to match:
// what one mesh per lamp did with a colour each) and one for the EXIT sign, whose lettering is
// a texture; then one instanced draw for every halo, whose brightness follows the same level.
export function attachLamps(level, { glows, sign, halos }, reg) {
  const color = new THREE.BufferAttribute(new Float32Array(glows.tint), 3);
  color.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', glows.position);
  geo.setAttribute('color', color);
  geo.setIndex(glows.index);
  geo.boundingSphere = glows.sphere.clone();
  const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  glow.name = 'lamps';
  level.group.add(glow);
  const bulbs = glows.ranges.map((r) => {
    const bulb = { material: { color: new THREE.Color(1, 1, 1) } };
    if (level.rig.bulbs[r.i]) level.rig.bulbs[r.i].bulb = bulb;
    return { ...r, bulb, shown: -1 };
  });
  if (sign) {
    const m = new THREE.Mesh(sign.geo, new THREE.MeshBasicMaterial({ vertexColors: true, map: level.ptex[sign.map], side: THREE.DoubleSide }));
    m.name = `lamp:${sign.i}`;
    level.group.add(m);
    reg(m, sign.zones);
    if (level.rig.bulbs[sign.i]) level.rig.bulbs[sign.i].bulb = m;
  }
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMaterial(), halos.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  halos.forEach((h, k) => {
    mesh.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(...h.pos), new THREE.Quaternion(), new THREE.Vector3(h.size, h.size, h.size)));
    mesh.setColorAt(k, new THREE.Color(0, 0, 0));
  });
  mesh.name = 'halos';
  level.group.add(mesh);
  const tmp = new THREE.Color();
  const tint = glows.tint, out = color.array;
  return {
    update() {
      let moved = false;
      for (const b of bulbs) {
        const v = b.bulb.material.color.r;
        if (Math.abs(v - b.shown) < 0.002) continue;
        b.shown = v;
        for (let j = b.from; j < b.to; j++) out[j] = tint[j] * v;
        moved = true;
      }
      if (moved) color.needsUpdate = true;
      halos.forEach((h, k) => {
        const b = level.rig.bulbs[h.i];
        const v = b ? Math.max(0, b.level) : 0;
        tmp.copy(h.color).multiplyScalar(v * v * h.str);
        mesh.setColorAt(k, tmp);
      });
      mesh.instanceColor.needsUpdate = true;
    },
  };
}
