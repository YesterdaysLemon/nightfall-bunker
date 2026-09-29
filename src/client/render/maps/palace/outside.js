// Outside the palace: the street front (the terracotta facade, the marquee spelling
// AURORA in bulbs with its letterboards and loose letters, poster cases, the kerb, a
// dead '50s sedan, the shops across the road and next door), the alley (open sky, the
// derelict building's boarded windows and fire escape, the dumpster and fence, the
// stage door, a ghost sign on the brick, puddles), the dressing rooms' fire escape on
// the west side, and the loading dock behind the stage. Render-only: nothing collides.

import * as THREE from 'three';
import { FURNITURE, WINDOWS } from '../../../../shared/maps/palace.js';
import { slabWithHoles } from '../../../../shared/mapkit.js';
import { rng } from '../../geo.js';
import { chamferBox, hull, prism, sackGeo } from '../../level.js';
import { V3, at, mat, bbox, bgeo, beam, bake, quad, shellFace, atlasQuad } from './kit.js';
import { crateStack, litter, rubble } from './props.js';
import { posterRect, signRect, letterRect, SIGNS } from './paint.js';
import { OUT } from './zones.js';

const TAU = Math.PI * 2;
const FRONT = 20.15;   // the facade's outer face

// --- Ground ------------------------------------------------------------------------------------------

function groundStyle(x, y, z) {
  if (z > 25.8 && z < 36) return ['tarmac', 4];
  if (z > FRONT - 0.2 && z <= 25.8) return ['concrete', 4];
  if (z >= 36 && z < 40) return ['concrete', 4];
  if (x > 18 && x < 30 && z > 6 && z < 20) return ['dirt', 3];
  return ['tarmac', 5];
}

function buildGround(batch) {
  const holes = [[-18.15, -24.15, 18.15, FRONT], [-12.15, -30.15, 12.15, -24], [18.15, -24.15, 24, 6]];
  const boxes = slabWithHoles(-60, -60, 60, 70, -0.02, 0, holes, 'ground');
  for (const { b } of boxes) shellFace(batch, b, 2, groundStyle, bake, 3);
  // the kerb and the gutter along the road
  const conc = batch.get('concrete');
  bbox(conc, mat(0, 0.06, 25.72), 120, 0.14, 0.22, 0.8, 1);
  bbox(conc, mat(0, 0.06, 36.05), 120, 0.14, 0.22, 0.8, 1);
  // dashed centre line, faded; manholes
  const paint = batch.get('cream');
  for (let x = -58; x < 58; x += 4) bbox(paint, mat(x, 0.004, 30.9), 2.2, 0.006, 0.14, [0.85, 0.75, 0.35], 1);
  for (const [x, z] of [[-9, 29.5], [16, 32.5], [-25, 33]]) bgeo(batch.get('dark'), prism(0.4, 0.4, 0.02, 10), mat(x, 0.01, z), 0.8);
}

// --- The facade ----------------------------------------------------------------------------------------

// A 5 x 7 pixel font for the marquee's name.
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};

function buildFacade(batch, R, bulbs) {
  const terra = batch.get('terracotta'), gilt = batch.get('gilt'), dark = batch.get('dark'), glass = batch.get('mirror');
  const Z = FRONT;
  // Granite base course, broken at the entrance.
  for (const [x0, x1] of [[-18.3, -1.3], [1.3, 18.3]]) bbox(dark, mat((x0 + x1) / 2, 0.3, Z + 0.06), x1 - x0, 0.6, 0.12, [0.55, 0.52, 0.5], 1);
  bbox(batch.get('concrete'), mat(0, 0.12, Z + 0.28), 2.8, 0.24, 0.56, 0.75, 1);   // the entrance step
  // Pilasters with capitals between the bays.
  for (const x of [-17.6, -10.5, -3.4, 3.4, 10.5, 17.6]) {
    bbox(terra, mat(x, 3.9, Z + 0.1), 0.62, 6.6, 0.2, 0.95, 2.4);
    bbox(terra, mat(x, 7.0, Z + 0.16), 0.8, 0.3, 0.32, 1, 2.4);
    bbox(dark, mat(x, 0.35, Z + 0.14), 0.74, 0.7, 0.28, [0.5, 0.48, 0.46], 1);
  }
  // Cornice, parapet and the stepped crest with the palace's name and a sunburst.
  for (const [y, h, d] of [[7.25, 0.12, 0.3], [7.4, 0.18, 0.45], [7.6, 0.14, 0.6]]) bbox(terra, mat(0, y, Z + d / 2), 36.6, h, d, 0.95, 2.4);
  bbox(terra, mat(0, 8.05, Z + 0.1), 36.6, 0.8, 0.3, 0.9, 2.4);
  for (const [w, y0, y1] of [[9, 8.4, 9.2], [6.2, 9.2, 9.9], [3, 9.9, 10.5]]) {
    bbox(terra, mat(0, (y0 + y1) / 2, Z + 0.1), w, y1 - y0, 0.3, 0.95, 2.4);
    bbox(gilt, mat(0, y1 - 0.03, Z + 0.2), w + 0.1, 0.06, 0.2, 0.8, 0.5);
  }
  atlasQuad(batch.get('signs'), mat(0, 8.72, Z + 0.27), 8.2, 0.52, signRect(SIGNS.facade), 0.95);
  const cy = 9.9;
  bgeo(gilt, hull([...Array.from({ length: 9 }, (_, k) => V3(Math.cos((k / 8) * Math.PI) * 0.5, Math.sin((k / 8) * Math.PI) * 0.5, 0)), ...Array.from({ length: 9 }, (_, k) => V3(Math.cos((k / 8) * Math.PI) * 0.4, Math.sin((k / 8) * Math.PI) * 0.4, 0.1))]), mat(0, cy, Z + 0.26), 1);
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI;
    bgeo(gilt, hull([V3(-0.07, 0, 0), V3(0.07, 0, 0), V3(0, 0, 0.05), V3(0, k % 2 ? 0.7 : 1.0, 0.02)]), mat(Math.cos(a) * 0.58, cy + Math.sin(a) * 0.58, Z + 0.26, 0, 0, a - Math.PI / 2), 0.9);
  }
  // Upper bays: boarded windows either side, a recessed panel with a relief over the marquee.
  for (const x of [-14, -7, 7, 14]) {
    bbox(dark, mat(x, 5.5, Z + 0.01), 1.6, 1.9, 0.04, 0.35, 1);
    for (let k = 0; k < 4; k++) bbox(batch.get('woodWall'), mat(x, 4.8 + k * 0.45, Z + 0.06, 0, 0, (R() - 0.5) * 0.3), 1.9, 0.18, 0.04, 0.55, 1);
    bbox(terra, mat(x, 6.58, Z + 0.1), 2.0, 0.2, 0.22, 1, 2.4);
    bbox(terra, mat(x, 4.46, Z + 0.1), 1.9, 0.1, 0.25, 1, 2.4);
  }
  bbox(terra, mat(0, 6.1, Z + 0.02), 6.4, 1.8, 0.06, 0.7, 2.4);
  for (let k = 0; k < 7; k++) bbox(gilt, mat(-2.4 + k * 0.8, 6.1, Z + 0.07), 0.12, 1.4, 0.05, 0.75, 0.5);
  // Window and door surrounds on the street.
  for (const w of WINDOWS.filter((q) => q.z === 20)) {
    const hw = w.width / 2;
    bbox(terra, mat(w.x, w.top + 0.15, Z + 0.08), w.width + 0.5, 0.3, 0.16, 1.05, 2.4);
    for (const s of [-1, 1]) bbox(terra, mat(w.x + s * (hw + 0.12), (w.sill + w.top) / 2, Z + 0.06), 0.24, w.top - w.sill, 0.12, 1, 2.4);
    if (w.sill > 0.6) bbox(dark, mat(w.x, w.sill - 0.05, Z + 0.12), w.width + 0.4, 0.1, 0.24, [0.6, 0.58, 0.56], 1);
    if (w.id === 0 || w.id === 1) atlasQuad(batch.get('signs'), mat(w.x, w.top + 0.55, Z + 0.02), 1.4, 0.46, signRect(SIGNS.tickets), 0.9);
  }
  // the entrance: bronze frame and a dark transom
  for (const s of [-1, 1]) bbox(gilt, mat(s * 1.08, 1.45, Z + 0.06), 0.12, 1.9, 0.12, 0.6, 0.5);
  bbox(dark, mat(0, 2.8, Z + 0.02), 2.2, 0.7, 0.04, 0.4, 1);
  atlasQuad(glass, mat(0, 2.8, Z + 0.05), 2.0, 0.55, [0, 0, 1, 1], 0.5);
  // Boarded fake doors either side of the entrance.
  for (const x of [-2.2, 2.2]) {
    bbox(dark, mat(x, 1.25, Z + 0.02), 1.1, 2.5, 0.04, 0.4, 1);
    atlasQuad(glass, mat(x, 1.55, Z + 0.045), 0.8, 1.2, [0, 0, 1, 1], 0.45);
    for (const s of [-1, 1]) bbox(gilt, mat(x + s * 0.55, 1.25, Z + 0.05), 0.06, 2.5, 0.06, 0.6, 0.3);
    for (let k = 0; k < 4; k++) bbox(batch.get('woodWall'), mat(x, 0.55 + k * 0.55, Z + 0.09, 0, 0, (R() - 0.5) * 0.5), 1.35, 0.17, 0.045, 0.55, 1);
  }
  // Poster cases: gilt frames, glass, a poster and a hooded lamp (dead).
  [[-16.5, 6], [-12.3, 3], [-9.0, 1], [-4.05, 0], [4.05, 7], [9.0, 2], [12.3, 4], [15.9, 5]].forEach(([x, k]) => {
    const m = mat(x, 1.75, Z + 0.06);
    bbox(gilt, m, 1.12, 1.62, 0.1, 0.85, 0.5);
    atlasQuad(batch.get('posters'), at(m, 0, 0, 0.052), 0.92, 1.4, posterRect(k), 0.95);
    atlasQuad(glass, at(m, 0, 0, 0.07), 0.96, 1.44, [0, 0, 1, 1], 0.55);
    bgeo(dark, hull([V3(-0.3, 0, 0), V3(0.3, 0, 0), V3(-0.3, 0.06, 0), V3(0.3, 0.06, 0), V3(-0.25, -0.02, 0.28), V3(0.25, -0.02, 0.28)]), at(m, 0, 0.9, 0), 0.8);
    beam(dark, at(m, 0, 0.93, 0).elements.slice(12, 15), at(m, 0, 1.0, 0.2).elements.slice(12, 15), 0.02, 0.02, 1, 0.2);
  });
  buildMarquee(batch, R, bulbs);
}

// The marquee: a canopy over the pavement with letterboards on its fascia, chaser bulbs
// round every edge and on its soffit, and AURORA in bulb-studded letters on top.
function buildMarquee(batch, R, bulbs) {
  const cream = batch.get('cream'), gilt = batch.get('gilt'), dark = batch.get('dark'), metal = batch.get('metal');
  const x0 = -7.5, x1 = 7.5, z0 = FRONT, z1 = 23.6, y0 = 3.3, y1 = 4.9;
  const W = x1 - x0, D = z1 - z0;
  const panel = [0.95, 0.85, 0.7];
  // soffit, top and the fascia's cream enamel panels with gilt trim
  bbox(cream, mat(0, y0 + 0.05, (z0 + z1) / 2), W, 0.1, D, [0.7, 0.66, 0.6], 1.5);
  bbox(metal, mat(0, y1 - 0.05, (z0 + z1) / 2), W, 0.1, D, 0.45, 2);
  bbox(cream, mat(0, (y0 + y1) / 2, z1 - 0.06), W, y1 - y0, 0.12, panel, 1.5);
  for (const s of [-1, 1]) bbox(cream, mat(s * (W / 2 - 0.06), (y0 + y1) / 2, (z0 + z1) / 2), 0.12, y1 - y0, D, panel, 1.5);
  for (const y of [y0 + 0.08, y1 - 0.08]) {
    bbox(gilt, mat(0, y, z1 + 0.02), W + 0.1, 0.12, 0.06, 0.9, 0.5);
    for (const s of [-1, 1]) bbox(gilt, mat(s * (W / 2 + 0.02), y, (z0 + z1) / 2), 0.06, 0.12, D, 0.9, 0.5);
  }
  // letterboards: two lines on the front, NOW SHOWING on each end
  const sg = batch.get('signs');
  atlasQuad(sg, mat(0, 4.36, z1 + 0.005), 8.8, 0.55, signRect(SIGNS.line1), 1);
  atlasQuad(sg, mat(0, 3.8, z1 + 0.005), 8.8, 0.55, signRect(SIGNS.line2), 1);
  for (const s of [-1, 1]) {
    atlasQuad(sg, mat(s * (W / 2 + 0.005), 4.36, (z0 + z1) / 2 + 0.2, s * Math.PI / 2), 2.4, 0.4, signRect(SIGNS.now), 0.95);
    atlasQuad(sg, mat(s * (W / 2 + 0.005), 3.8, (z0 + z1) / 2 + 0.2, s * Math.PI / 2), 2.4, 0.4, signRect(SIGNS.line3), 0.95);
  }
  // a few loose letters: crooked on the board, and fallen on the pavement
  for (const [x, y, ch, rz] of [[5.6, 4.2, 'E', 0.5], [-5.2, 3.72, 'N', -0.4], [6.1, 3.62, 'T', 0.9]]) atlasQuad(sg, mat(x, y, z1 + 0.02, 0, 0, rz), 0.3, 0.3, letterRect(ch), 1);
  for (const [x, z, ch, yaw] of [[2.7, 22.4, 'H', 0.4], [-3.9, 24.6, 'O', 2.1], [5.1, 21.2, 'W', -0.8], [-1.2, 23.5, 'L', 1.2]]) atlasQuad(sg, mat(x, 0.012, z, yaw, -Math.PI / 2), 0.3, 0.3, letterRect(ch), 0.85);
  // tie rods to the facade
  for (const s of [-1, 1]) beam(dark, [s * 6.8, y1, z1 - 0.2], [s * 6.8, 7.1, z0 + 0.05], 0.05, 0.05, 0.8, 0.3);
  // Bulbs: round the fascia's edges, a grid on the soffit.
  for (let x = x0 + 0.15; x < x1; x += 0.25) for (const y of [y0 + 0.2, y1 - 0.2]) bulbs.push([x, y, z1 + 0.06, 1]);
  for (const s of [-1, 1]) for (let z = z0 + 0.3; z < z1; z += 0.25) for (const y of [y0 + 0.2, y1 - 0.2]) bulbs.push([s * (W / 2 + 0.06), y, z, 1]);
  for (let x = x0 + 0.4; x < x1; x += 0.5) for (let z = z0 + 0.5; z < z1 - 0.2; z += 0.6) bulbs.push([x, y0 - 0.04, z, 2]);
  // AURORA on top: red enamel channel letters on a gilt rail, a bulb in every pixel.
  const px = 0.18, word = 'AURORA';
  const lw = 5 * px, gap = 0.26, total = word.length * lw + (word.length - 1) * gap;
  const red = [0.95, 0.42, 0.36];
  bbox(gilt, mat(0, y1 + 0.08, z1 - 0.35), total + 0.4, 0.16, 0.16, 0.8, 0.5);
  [...word].forEach((ch, i) => {
    const lx = -total / 2 + i * (lw + gap);
    // the second R has slipped and hangs crooked
    const slip = i === 4 ? mat(lx + lw / 2, y1 + 0.16, z1 - 0.35, 0, 0, -0.26) : mat(lx + lw / 2, y1 + 0.16, z1 - 0.35);
    GLYPHS[ch].forEach((row, r) => {
      [...row].forEach((on, c) => {
        if (on !== '1') return;
        if (i === 5 && r === 0 && c === 3) return;   // a piece missing
        const lm = at(slip, (c - 2) * px, (6 - r) * px + px / 2, 0);
        bbox(cream, lm, px * 0.96, px * 0.96, 0.16, red, 0.5);
        const p = new THREE.Vector3().setFromMatrixPosition(at(lm, 0, 0, 0.1));
        bulbs.push([p.x, p.y, p.z, 3]);
      });
    });
  });
}

// --- Neighbouring buildings -------------------------------------------------------------------------------

// A plain block of a building: brick walls, a flat roof, dark windows in rows on the
// faces listed, a cornice. front: 'n' | 's' | 'e' | 'w' faces get windows.
function block(batch, x0, z0, x1, z1, h, R, { faces = 'nsew', wall = 'brick', tint = 0.8, shop = null, floors = 3 } = {}) {
  const b = [x0, 0, z0, x1, h, z1];
  const style = (x, y, z, n) => (n[1] > 0.5 ? ['tarmac', 5] : n[1] < -0.5 ? null : [wall, wall === 'brick' ? 2 : 2.4]);
  for (let f = 0; f < 6; f++) shellFace(batch, b, f, style, (x, y, z, nx, ny, nz) => bake(x, y, z, nx, ny, nz).map((v) => v * tint), 3);
  const dark = batch.get('dark'), wood = batch.get('woodWall'), conc = batch.get('concrete');
  const face = (n, along0, along1, c) => {
    const alongX = n === 'n' || n === 's';
    const sgn = n === 's' || n === 'e' ? 1 : -1;
    const yaw = n === 's' ? 0 : n === 'n' ? Math.PI : n === 'e' ? Math.PI / 2 : -Math.PI / 2;
    const len = along1 - along0;
    const cols = Math.max(1, Math.floor(len / 3));
    for (let fl = shop ? 1 : 0; fl < floors; fl++) {
      const y = 1.7 + fl * (h / floors);
      if (y + 1 > h - 0.4) continue;
      for (let k = 0; k < cols; k++) {
        const a = along0 + (len * (k + 0.5)) / cols;
        const p = alongX ? [a, y, c + sgn * 0.02] : [c + sgn * 0.02, y, a];
        const m = mat(p[0], p[1], p[2], yaw);
        const boarded = R() < 0.35;
        bbox(dark, m, 1.1, 1.6, 0.03, 0.35 + R() * 0.15, 1);
        bbox(conc, at(m, 0, -0.85, 0.06), 1.3, 0.1, 0.14, 0.7, 1, (q) => q < 2 || q === 5);
        bbox(wall === 'brick' ? batch.get('brick') : batch.get('terracotta'), at(m, 0, 0.88, 0.03), 1.3, 0.16, 0.08, 0.7, 1, (q) => q < 3 || q === 5);
        if (boarded) for (let j = 0; j < 3; j++) bbox(wood, at(m, 0, -0.5 + j * 0.5, 0.04, 0, 0, (R() - 0.5) * 0.4), 1.3, 0.16, 0.03, 0.5, 1);
        else if (R() < 0.5) bbox(batch.get('linen'), at(m, (R() - 0.5) * 0.3, 0.2, 0.018), 0.5, 1.1, 0.01, [0.4, 0.36, 0.3], 1);
      }
    }
    // cornice
    const cm = alongX ? mat((along0 + along1) / 2, h - 0.2, c + sgn * 0.12, 0) : mat(c + sgn * 0.12, h - 0.2, (along0 + along1) / 2, 0);
    bbox(conc, cm, alongX ? len + 0.2 : 0.3, 0.3, alongX ? 0.3 : len + 0.2, 0.6, 2);
  };
  if (faces.includes('n')) face('n', x0, x1, z0);
  if (faces.includes('s')) face('s', x0, x1, z1);
  if (faces.includes('e')) face('e', z0, z1, x1);
  if (faces.includes('w')) face('w', z0, z1, x0);
}

// A ground-floor shopfront on a building face (facing +z or -z), with its sign.
function shopfront(batch, x0, x1, z, dir, sign, R) {
  const dark = batch.get('dark'), glass = batch.get('mirror'), gilt = batch.get('gilt');
  const yaw = dir > 0 ? 0 : Math.PI;
  const cx = (x0 + x1) / 2, w = x1 - x0;
  bbox(dark, mat(cx, 1.5, z + dir * 0.02), w - 0.4, 2.6, 0.04, 0.3, 1);
  atlasQuad(glass, mat(cx, 1.5, z + dir * 0.05, yaw), w - 0.6, 2.4, [0, 0, 1, 1], 0.5);
  for (let x = x0 + 0.2; x <= x1 - 0.19; x += (w - 0.4) / 3) bbox(gilt, mat(x, 1.5, z + dir * 0.07), 0.08, 2.6, 0.06, 0.5, 0.5);
  atlasQuad(batch.get('signs'), mat(cx, 3.3, z + dir * 0.06, yaw), w - 0.6, (w - 0.6) / 8, signRect(SIGNS[sign]), 0.85);
  // a torn awning
  bgeo(batch.get('linen'), hull([V3(-w / 2 + 0.3, 0, 0), V3(w / 2 - 0.3, 0, 0), V3(-w / 2 + 0.3, -0.7, 1.2), V3(w / 2 - 0.3, -0.75, 1.2), V3(-w / 2 + 0.3, -0.95, 1.22), V3(w / 2 - 0.3, -0.95, 1.22)]), mat(cx, 3.0, z, yaw), [0.5 + R() * 0.3, 0.3, 0.28]);
}

function buildNeighbours(batch, R) {
  // Next door along the street (west and east), and the row across the road.
  block(batch, -46, -26, -26, FRONT, 9.5, R, { faces: 'se', floors: 3, shop: true });
  shopfront(batch, -44, -36, FRONT, 1, 'shop4', R);
  shopfront(batch, -34, -27, FRONT, 1, 'shop1', R);
  block(batch, 30, -10, 48, FRONT, 12, R, { faces: 'sw', wall: 'terracotta', tint: 0.75, floors: 4, shop: true });
  shopfront(batch, 31, 39, FRONT, 1, 'shop3', R);
  const row = [[-52, -36, 9], [-36, -22, 12], [-22, -8, 8], [-8, 8, 10.5], [8, 22, 7.5], [22, 38, 11], [38, 54, 9]];
  const signs = ['shop2', 'shop1', 'shop4', 'shop3', 'shop2', 'shop4', 'shop1'];
  row.forEach(([x0, x1, h], i) => {
    block(batch, x0, 40, x1, 54, h, R, { faces: 'n', wall: i % 3 === 1 ? 'terracotta' : 'brick', tint: 0.7 + R() * 0.15, floors: Math.round(h / 3), shop: true });
    shopfront(batch, x0 + 1, x1 - 1, 40, -1, signs[i], R);
  });
  // Behind: the building at the alley's dead end, and the backs of the next street.
  block(batch, 12.15, -44, 34, -24.3, 12, R, { faces: 'sw', floors: 4 });
  block(batch, -40, -60, 40, -46, 9, R, { faces: 's', floors: 3, tint: 0.7 });
  block(batch, -46, -46, -26, -26, 8, R, { faces: 'e', floors: 2, tint: 0.7 });
  // The derelict building next door: its walls round the alley's east side, boarded.
  block(batch, 24, -24.15, 28, 6.15, 8, R, { faces: 'e', floors: 2 });
  shellFace(batch, [18.15, -0.02, -24.15, 24, 0, 6.0], 2, () => ['dirt', 3], bake, 2);
  const derelict = [18.15, 0, 6.0, 24, 8, 6.3];
  for (const f of [4, 2]) shellFace(batch, derelict, f, (x, y, z, n) => (n[1] > 0.5 ? ['tarmac', 5] : ['brick', 2]), bake, 2);
  shellFace(batch, [18.15, 7.7, -24.15, 24, 8, 6.3], 2, () => ['tarmac', 5], bake, 3);
  shellFace(batch, [18.15, 3.8, -24.15, 24, 3.95, 6.0], 3, () => ['ceiling', 2.5], bake, 2);
  shellFace(batch, [18.15, 0, -24.3, 24, 8, -24.15], 5, () => ['brick', 2], bake, 2);
  shellFace(batch, [23.85, 0, -24.15, 24, 3.8, 6.0], 1, () => ['plaster', 4.5], bake, 2);
  shellFace(batch, [18.15, 0, 5.85, 24, 3.8, 6.0], 5, () => ['plaster', 4.5], bake, 2);
  shellFace(batch, [18.15, 0, -24.15, 24, 3.8, -24.0], 4, () => ['plaster', 4.5], bake, 2);
  const dark = batch.get('dark'), wood = batch.get('woodWall');
  for (const x of [20, 22.6]) {
    for (const y of [1.6, 5.2]) {
      bbox(dark, mat(x, y, 6.32), 1.2, 1.5, 0.03, 0.35, 1);
      for (let k = 0; k < 3; k++) bbox(wood, mat(x, y - 0.5 + k * 0.5, 6.36, 0, 0, (R() - 0.5) * 0.5), 1.45, 0.17, 0.04, 0.5, 1);
    }
  }
  // Inside the derelict: rubble, a torn mattress, a broken chair, a doorway into the dark.
  const dirt = batch.get('dirt');
  for (let k = 0; k < 20; k++) bgeo(dirt, rubble(0.2 + R() * 0.5, 0.08 + R() * 0.2, 0.2 + R() * 0.5), mat(19 + R() * 4.5, 0.05, -23 + R() * 28, R() * TAU), 0.6);
  bgeo(batch.get('linen'), chamferBox(1.9, 0.16, 0.9, 0.06), mat(22.6, 0.08, -9, 0.3), [0.5, 0.45, 0.35]);
  bbox(dark, mat(23.84, 1.1, -10), 0.04, 2.2, 1.0, 0.1, 1);
  bbox(dark, mat(23.84, 1.1, 1), 0.04, 2.2, 1.0, 0.1, 1);
  for (let k = 0; k < 5; k++) bbox(wood, mat(20 + R() * 3, 0.1 + R() * 0.3, -20 + R() * 22, R() * TAU, (R() - 0.5) * 0.8), 0.1, 0.05, 1 + R(), 0.5, 1);
}

// --- The empty lot east of the box office ------------------------------------------------------------------

function buildEastLot(batch, R) {
  const metal = batch.get('metal'), wood = batch.get('woodWall'), dark = batch.get('dark');
  // window 5's sill and header, outside
  for (const w of WINDOWS.filter((q) => q.x === 18 && q.z > 6)) {
    bbox(batch.get('concrete'), mat(18.25, w.sill - 0.06, w.z), 0.2, 0.12, w.width + 0.35, 0.6, 1);
    bbox(batch.get('brick'), mat(18.22, w.top + 0.12, w.z), 0.14, 0.24, w.width + 0.4, 0.75, 2);
  }
  // a sagging chain-link fence along the pavement, a gap torn in it
  const cl = batch.get('chainlink');
  for (const [x0, x1] of [[18.15, 22.5], [24.2, 30]]) {
    const q = [[x0, 0.05, 20.3], [x1, 0.05, 20.3], [x1, 2.2, 20.3], [x0, 2.2, 20.3]];
    quad(cl, q, q.map((v) => [v[0] / 1.2, v[1] / 1.2]), (x, y, z) => bake(x, y, z + 0.3, 0, 0, 1));
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 2) bgeo(metal, prism(0.04, 0.04, 2.2, 6), mat(x, 1.1, 20.3), [0.7, 0.7, 0.72]);
    beam(metal, [x0, 2.2, 20.3], [x1, 2.1, 20.3], 0.035, 0.035, [0.7, 0.7, 0.72], 0.3);
  }
  // a billboard on stilts facing the street, its poster peeling
  const bm = mat(25.5, 0, 17.2, 0.12);
  for (const x of [-2.6, 0, 2.6]) bbox(wood, at(bm, x, 2.4, -0.1), 0.16, 4.8, 0.16, 0.6, 1);
  bbox(wood, at(bm, 0, 4.0, 0), 6.4, 3.0, 0.08, 0.55, 1.5);
  atlasQuad(batch.get('posters'), at(bm, -1.5, 4.0, 0.05), 1.9, 2.8, posterRect(3), 0.85);
  atlasQuad(batch.get('posters'), at(bm, 1.5, 4.0, 0.05), 1.9, 2.8, posterRect(6), 0.85);
  for (let k = 0; k < 6; k++) bbox(dark, at(bm, -3 + k * 1.2, 5.6, 0.25), 0.05, 0.05, 0.5, 0.8, 0.2);
  // rubble, a burnt-out oil drum, weeds
  const dirt = batch.get('dirt');
  for (let k = 0; k < 16; k++) bgeo(dirt, rubble(0.3 + R() * 0.6, 0.1 + R() * 0.3, 0.3 + R() * 0.6), mat(19 + R() * 10, 0.05, 7 + R() * 12, R() * TAU, (R() - 0.5) * 0.3), 0.6);
  bgeo(batch.get('rust'), prism(0.3, 0.3, 0.9, 8), mat(27.5, 0.45, 9), 0.5);
  litter(batch, [18.5, 6.5, 29.5, 19.8], 0, 16, R, ['paper', 'woodWall']);
}

// --- The alley --------------------------------------------------------------------------------------------

function buildAlley(batch, R) {
  const dark = batch.get('dark'), rust = batch.get('rust'), metal = batch.get('metal'), wood = batch.get('woodWall');
  // Windows round the derelict's boarded ground-floor openings, and dark windows above.
  for (const w of WINDOWS.filter((q) => q.x === 18 && q.z < 6)) {
    const zc = w.z;
    bbox(batch.get('concrete'), mat(17.8, w.sill - 0.06, zc), 0.2, 0.12, w.width + 0.35, 0.6, 1);
    bbox(batch.get('brick'), mat(17.82, w.top + 0.12, zc), 0.14, 0.24, w.width + 0.4, 0.75, 2);
  }
  for (const z of [-20.5, -13, -6, 1.5]) {
    for (const y of [4.6, 7.0]) {
      if (y > 7.5) continue;
      bbox(dark, mat(17.84, y, z), 0.03, 1.4, 1.1, 0.3, 1);
      bbox(batch.get('concrete'), mat(17.78, y - 0.76, z), 0.14, 0.1, 1.3, 0.6, 1);
      if (R() < 0.6) for (let k = 0; k < 3; k++) bbox(wood, mat(17.8, y - 0.45 + k * 0.45, z, 0, (R() - 0.5) * 0.4), 0.04, 0.16, 1.35, 0.5, 1);
    }
  }
  bbox(batch.get('concrete'), mat(17.9, 8.05, -9), 0.35, 0.2, 30.3, 0.55, 2);
  // The derelict's fire escape: two landings, the stair between, a drop ladder.
  for (const y of [3.4, 6.3]) {
    const zc = -13, L = 5, x0 = 16.75;
    bbox(metal, mat(x0 + 0.55, y - 0.05, zc), 1.1, 0.08, L, 0.35, 1);
    for (let z = zc - L / 2 + 0.1; z < zc + L / 2; z += 0.2) bbox(dark, mat(x0 + 0.55, y, z), 1.1, 0.03, 0.03, 0.8, 0.2);
    beam(dark, [x0, y + 1.0, zc - L / 2], [x0, y + 1.0, zc + L / 2], 0.05, 0.05, 0.8, 0.2);
    for (let z = zc - L / 2; z <= zc + L / 2 + 0.01; z += 1.0) beam(dark, [x0, y, z], [x0, y + 1.0, z], 0.035, 0.035, 0.8, 0.2);
    beam(dark, [x0, y + 0.5, zc - L / 2], [x0, y + 0.5, zc + L / 2], 0.03, 0.03, 0.8, 0.2);
    for (const z of [zc - L / 2 + 0.3, zc + L / 2 - 0.3]) beam(dark, [x0 + 0.1, y - 0.1, z], [17.85, y - 0.9, z], 0.05, 0.05, 0.8, 0.2);
  }
  for (const s of [-0.3, 0.3]) beam(dark, [17.3 + s * 0.3, 3.4, -11.2], [17.3 + s * 0.3, 6.3, -14.6], 0.05, 0.08, 0.8, 0.2);
  for (let k = 1; k < 10; k++) { const u = k / 10; bbox(dark, mat(17.3, 3.4 + 2.9 * u, -11.2 - 3.4 * u), 0.55, 0.03, 0.2, 0.8, 0.2); }
  for (const s of [-0.22, 0.22]) beam(dark, [16.85, 2.45, -15.1 + s], [16.85, 3.4, -15.1 + s], 0.035, 0.035, 0.8, 0.2);
  for (let y = 2.55; y < 3.4; y += 0.28) beam(dark, [16.85, y, -15.32], [16.85, y, -14.88], 0.025, 0.025, 0.8, 0.2);
  // The palace's side: the stage door's canopy and sign, drainpipes, a duct, a meter box.
  bbox(metal, mat(12.55, 2.72, -5), 0.8, 0.06, 2.4, 0.45, 1);
  for (const z of [-6.1, -3.9]) beam(dark, [12.15, 3.3, z], [12.9, 2.75, z], 0.03, 0.03, 0.8, 0.2);
  atlasQuad(batch.get('signs'), mat(12.16, 3.0, -5, Math.PI / 2), 1.2, 0.32, signRect(SIGNS.stageDoor), 0.9);
  for (const z of [-10.6, 3.6]) {
    bgeo(rust, prism(0.07, 0.07, 10.8, 6), mat(12.24, 5.5, z), 0.6);
    bgeo(rust, prism(0.1, 0.07, 0.3, 6), mat(12.24, 0.15, z + 0.12, 0, Math.PI / 2 - 0.3), 0.6);
  }
  bbox(metal, mat(12.5, 7.2, 1.9), 0.7, 8.2, 0.9, 0.4, 1.5);
  bbox(metal, mat(12.5, 3.05, 1.9), 0.72, 0.1, 0.92, 0.5, 1);
  bbox(metal, mat(12.3, 1.7, -13), 0.3, 0.8, 0.6, [0.5, 0.52, 0.5], 1);
  atlasQuad(batch.get('signs'), mat(12.46, 1.85, -13, Math.PI / 2), 0.5, 0.25, signRect(SIGNS.danger), 0.9);
  bbox(batch.get('concrete'), mat(12.3, 11.15, -9), 0.5, 0.3, 30.3, 0.6, 2);
  // The ghost sign painted on the palace's brick (its material, ghostSign, is palace.js's).
  atlasQuad(batch.get('ghostSign'), mat(12.16, 7.6, -13.5, Math.PI / 2), 12, 6, [0, 0, 1, 1], 0.9);
  // The dumpster: painted steel, one lid up, rubbish spilling.
  for (const p of FURNITURE) {
    if (p.kind === 'dumpster') {
      const [x0, , z0, x1, y1, z1] = p.solid;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
      bgeo(metal, hull([V3(-w / 2 + 0.1, 0.15, -d / 2), V3(w / 2, 0.15, -d / 2), V3(-w / 2 + 0.1, 0.15, d / 2), V3(w / 2, 0.15, d / 2), V3(-w / 2, y1 - 0.05, -d / 2), V3(w / 2, y1 - 0.05, -d / 2), V3(-w / 2, y1 - 0.05, d / 2), V3(w / 2, y1 - 0.05, d / 2)], [1, 1, 1]), mat(cx, 0, cz), [0.55, 0.75, 0.55]);
      for (const z of [z0 + 0.4, cz, z1 - 0.4]) bbox(dark, mat(x0 - 0.01, y1 * 0.5, z), 0.03, y1 * 0.8, 0.06, 0.7, 0.3);
      for (const z of [z0 + 0.1, z1 - 0.1]) bbox(dark, mat(cx, y1 - 0.2, z), w + 0.08, 0.12, 0.06, 0.8, 0.3);
      bgeo(dark, chamferBox(w - 0.02, 0.05, d / 2, 0.02), mat(cx, y1 + 0.01, cz + d / 4), 0.6);
      bgeo(dark, chamferBox(w - 0.02, 0.05, d / 2, 0.02), mat(cx - 0.1, y1 + 0.45, cz - d / 4 - 0.1, 0, 0, 0.9), 0.6);
      for (const [a, b] of [[x0 + 0.2, z0 + 0.2], [x1 - 0.2, z0 + 0.2], [x0 + 0.2, z1 - 0.2], [x1 - 0.2, z1 - 0.2]]) bgeo(dark, prism(0.06, 0.06, 0.12, 6), mat(a, 0.06, b), 1);
      const sk = sackGeo(0.6, 0.4, 0.5, R);
      for (let k = 0; k < 5; k++) bgeo(dark, sk, mat(x0 - 0.3 - R() * 0.4, 0.18, z0 + R() * d, R() * TAU), 1.4);
      bgeo(dark, sk, mat(cx, y1 + 0.1, cz + 0.4, 0.5), 1.4);
    }
    if (p.kind === 'fence') {
      const [x0, , z0, x1, y1, z1] = p.solid;
      const cz = (z0 + z1) / 2;
      for (const x of [x0 + 0.04, (x0 + x1) / 2, x1 - 0.04]) bgeo(metal, prism(0.04, 0.04, y1, 6), mat(x, y1 / 2, cz), [0.7, 0.7, 0.72]);
      beam(metal, [x0, y1 - 0.05, cz], [x1, y1 - 0.05, cz], 0.04, 0.04, [0.7, 0.7, 0.72], 0.3);
      beam(metal, [x0, 0.08, cz], [x1, 0.08, cz], 0.03, 0.03, [0.7, 0.7, 0.72], 0.3);
      const q = [[x0, 0.05, cz], [x1, 0.05, cz], [x1, y1 - 0.05, cz], [x0, y1 - 0.05, cz]];
      quad(batch.get('chainlink'), q, q.map((v) => [v[0] / 1.2, v[1] / 1.2]), (x, y, z) => bake(x, y, z + 0.3, 0, 0, 1));
      for (const dy of [0.12, 0.24]) beam(dark, [x0, y1 + dy, cz], [x1, y1 + dy - 0.03, cz], 0.012, 0.012, 1, 0.1);
    }
    if (p.kind === 'crates' && p.pos[1] < 0.5) crateStack(batch, p.solid, R, (m, w, h) => atlasQuad(batch.get('signs'), m, w, h, signRect(SIGNS.stencil), 0.8));
  }
  // Rubbish bags and puddles.
  const sk = sackGeo(0.55, 0.45, 0.5, R);
  for (const [x, z] of [[17.3, -4.6], [17.5, -5.3], [12.7, -19.4], [13.1, -18.9], [17.4, -22.8]]) bgeo(dark, sk, mat(x, 0.2, z, R() * TAU), 1.3);
  const pud = batch.get('puddle');
  for (const [x, z, sx, sz] of [[14.2, -2.5, 1.6, 2.4], [15.8, -13.5, 1.2, 1.8], [13.6, -20.5, 1.0, 1.4], [15.0, 4.0, 1.4, 0.9], [-4, 26.1, 2.2, 0.5], [9, 26.2, 1.6, 0.5], [-20, 4, 1.6, 2.2], [3, -33, 2.5, 1.5]]) {
    const pts = Array.from({ length: 9 }, (_, k) => { const a = (k / 9) * TAU; const r = 0.75 + R() * 0.3; return [x + Math.cos(a) * sx * 0.5 * r, 0.006, z + Math.sin(a) * sz * 0.5 * r]; });
    for (let k = 0; k < 9; k++) {
      const a = pts[k], b = pts[(k + 1) % 9];
      quad(pud, [[x, 0.006, z], b, a, a], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], (px, py, pz) => bake(px, py, pz, 0, 1, 0).map((v) => Math.min(1, v * 1.4)));
    }
  }
  litter(batch, [12.4, -23.6, 17.6, 5.6], 0, 22, R, ['paper', 'woodWall']);
}

// --- The west side: the dressing rooms' fire escape, the passage ------------------------------------------

function buildWestSide(batch, R) {
  // The fire escape's iron is painted the olive of the palace's service doors, so it reads
  // against the brick; the chain-link and pallets are the passage's own.
  const metal = batch.get('metal'), dark = metal;
  const Y = 3.6, xw = -18.15, xo = -19.35, z0 = -18.4, z1 = 0.4;
  // Ladder openings in the rail where zombies climb up (the ladder spawns).
  const gaps = [-17.2, -14.8, -3.2, -0.8];
  // deck: a steel frame and a grating of bars, brackets under it into the wall
  bbox(metal, mat((xw + xo) / 2, Y - 0.08, z0), xw - xo, 0.12, 0.08, 0.35, 1);
  bbox(metal, mat((xw + xo) / 2, Y - 0.08, z1), xw - xo, 0.12, 0.08, 0.35, 1);
  bbox(metal, mat(xo, Y - 0.08, (z0 + z1) / 2), 0.08, 0.14, z1 - z0, 0.35, 1);
  for (let z = z0 + 0.1; z < z1; z += 0.12) bbox(dark, mat((xw + xo) / 2, Y - 0.02, z), xw - xo, 0.03, 0.03, 0.8, 0.2);
  for (let z = z0 + 0.4; z < z1; z += 2.2) beam(dark, [xo + 0.1, Y - 0.1, z], [xw, Y - 1.1, z], 0.06, 0.06, 0.8, 0.2);
  // the rail along the outer edge, broken at each ladder
  const spans = [];
  let cur = z0;
  for (const g of gaps) { spans.push([cur, g - 0.4]); cur = g + 0.4; }
  spans.push([cur, z1]);
  for (const [a, b] of spans) {
    if (b - a < 0.1) continue;
    beam(dark, [xo, Y + 1.0, a], [xo, Y + 1.0, b], 0.05, 0.05, 0.8, 0.2);
    beam(dark, [xo, Y + 0.5, a], [xo, Y + 0.5, b], 0.03, 0.03, 0.8, 0.2);
    for (const z of [a, b]) beam(dark, [xo, Y, z], [xo, Y + 1.0, z], 0.045, 0.045, 0.8, 0.2);
  }
  for (const z of [z0, z1]) beam(dark, [xw, Y + 1.0, z], [xo, Y + 1.0, z], 0.05, 0.05, 0.8, 0.2);
  // ladders down to the ground at each gap
  for (const g of gaps) {
    for (const s of [-0.22, 0.22]) beam(dark, [xo - 0.12, 0, g + s], [xo - 0.12, Y + 1.0, g + s], 0.04, 0.04, 0.8, 0.2);
    for (let y = 0.3; y < Y + 0.9; y += 0.3) beam(dark, [xo - 0.12, y, g - 0.22], [xo - 0.12, y, g + 0.22], 0.025, 0.025, 0.8, 0.2);
  }
  // sills and headers on the dressing-room and stair-hall windows, outside
  for (const w of WINDOWS.filter((q) => q.x === -18)) {
    bbox(batch.get('concrete'), mat(-18.25, w.sill - 0.06, w.z), 0.2, 0.12, w.width + 0.35, 0.6, 1);
    bbox(batch.get('brick'), mat(-18.22, w.top + 0.12, w.z), 0.14, 0.24, w.width + 0.4, 0.75, 2);
  }
  // A gate and fence across the passage at the street, rubbish, a pile of pallets.
  const cl = batch.get('chainlink');
  for (const [x0, x1] of [[-26, -21.8], [-20.2, -18.15]]) {
    const q = [[x0, 0.05, 20.3], [x1, 0.05, 20.3], [x1, 2.2, 20.3], [x0, 2.2, 20.3]];
    quad(cl, q, q.map((v) => [v[0] / 1.2, v[1] / 1.2]), (x, y, z) => bake(x, y, z + 0.3, 0, 0, 1));
    for (const x of [x0, x1]) bgeo(metal, prism(0.04, 0.04, 2.2, 6), mat(x, 1.1, 20.3), [0.7, 0.7, 0.72]);
    beam(metal, [x0, 2.2, 20.3], [x1, 2.2, 20.3], 0.035, 0.035, [0.7, 0.7, 0.72], 0.3);
  }
  const gq = [[-21.8, 0.05, 20.3], [-20.4, 0.05, 21.6], [-20.4, 2.2, 21.6], [-21.8, 2.2, 20.3]];
  quad(cl, gq, gq.map((v) => [v[0] / 1.2 + v[2] / 1.2, v[1] / 1.2]), (x, y, z) => bake(x, y, z, 0, 0, 1));
  for (let k = 0; k < 4; k++) bbox(batch.get('woodWall'), mat(-25.3, 0.08 + k * 0.14, -6 + (R() - 0.5) * 0.2, 0.1 * k), 1.2, 0.12, 1.0, 0.55, 1);
  for (let k = 0; k < 3; k++) bgeo(batch.get('rust'), prism(0.3, 0.3, 0.9, 8), mat(-25.4, 0.45, 12 + k * 0.7), 0.6);
  litter(batch, [-25.5, -22, -18.5, 19.5], 0, 18, R, ['paper', 'woodWall']);
}

// --- The loading dock behind the stage ----------------------------------------------------------------

function buildDock(batch, R) {
  const conc = batch.get('concrete'), dark = batch.get('dark'), metal = batch.get('metal');
  const Y = 1.2, z0 = -30.15, z1 = -31.3;
  bbox(conc, mat(0, Y / 2, (z0 + z1) / 2), 19, Y, z0 - z1, 0.8, 2);
  bbox(metal, mat(0, Y - 0.04, z1 - 0.02), 19.1, 0.08, 0.06, 0.4, 1);
  for (const x of [-2.8, 2.8, -9, 9]) bbox(dark, mat(x, 0.7, z1 - 0.08), 0.3, 0.5, 0.16, 0.9, 0.3);
  // ladders up the dock face where things climb on
  for (const x of [-7.2, -4.8, 4.8, 7.2]) {
    for (const s of [-0.2, 0.2]) beam(dark, [x + s, 0, z1 - 0.12], [x + s, Y + 0.9, z1 - 0.12], 0.035, 0.035, 0.8, 0.2);
    for (let y = 0.25; y < Y + 0.8; y += 0.3) beam(dark, [x - 0.2, y, z1 - 0.12], [x + 0.2, y, z1 - 0.12], 0.025, 0.025, 0.8, 0.2);
  }
  // an awning on brackets, the steel roll-up door, sills on the boarded windows
  bbox(metal, mat(0, 4.7, -31.2), 20, 0.08, 2.2, 0.35, 2);
  for (const x of [-9, -3, 3, 9]) beam(dark, [x, 3.8, -30.15], [x, 4.66, -32.1], 0.05, 0.05, 0.8, 0.2);
  bbox(metal, mat(0, Y + 1.5, -30.18), 3.6, 3.0, 0.06, [0.55, 0.55, 0.52], 1);
  for (let y = Y + 0.1; y < Y + 3.0; y += 0.15) bbox(dark, mat(0, y, -30.22), 3.5, 0.02, 0.02, 0.7, 0.3);
  atlasQuad(batch.get('signs'), mat(0, Y + 3.3, -30.2, Math.PI), 1.6, 0.4, signRect(SIGNS.loading), 0.85);
  for (const w of WINDOWS.filter((q) => q.z === -30)) {
    bbox(conc, mat(w.x, w.sill - 0.06, -30.25), w.width + 0.35, 0.12, 0.2, 0.6, 1);
    bbox(batch.get('brick'), mat(w.x, w.top + 0.12, -30.22), w.width + 0.4, 0.24, 0.14, 0.75, 2);
  }
  // a box truck backed up to the dock, long dead, and oil drums
  const tm = mat(0, 0, -36, Math.PI);
  bgeo(metal, chamferBox(2.3, 2.3, 5.2, 0.06), at(tm, 0, 1.95, -1.2), [0.6, 0.62, 0.6]);
  bgeo(metal, hull([V3(-1.1, 0.7, 0), V3(1.1, 0.7, 0), V3(-1.1, 0.7, 2.0), V3(1.1, 0.7, 2.0), V3(-1.05, 2.3, 0), V3(1.05, 2.3, 0), V3(-1.0, 2.2, 1.2), V3(1.0, 2.2, 1.2), V3(-1.05, 1.5, 2.1), V3(1.05, 1.5, 2.1)]), at(tm, 0, 0, 1.4), [0.45, 0.5, 0.62]);
  atlasQuad(batch.get('mirror'), at(tm, 0, 1.9, 3.08, 0, -0.62), 1.8, 0.6, [0, 0, 1, 1], 0.5);
  for (const [x, z] of [[-1.1, -3], [1.1, -3], [-1.1, 2.5], [1.1, 2.5]]) {
    const wh = prism(0.48, 0.48, 0.3, 8);
    wh.rotateZ(Math.PI / 2);
    bgeo(dark, wh, at(tm, x, 0.48, z), 0.9);
  }
  for (const [x, z] of [[-9.5, -33], [-8.8, -33.4], [8.6, -34]]) bgeo(batch.get('rust'), prism(0.3, 0.3, 0.9, 8), mat(x, 0.45, z, R()), 0.6);
  dockRubbish(batch, R);
  litter(batch, [-11, -40, 11, -31.6], 0, 16, R, ['paper', 'woodWall']);
}

function dockRubbish(batch, R) {
  const dark = batch.get('dark');
  const sk = sackGeo(0.55, 0.45, 0.5, R);
  for (const [x, z] of [[10.5, -32], [11, -32.6], [-10.8, -31.9]]) bgeo(dark, sk, mat(x, 0.2, z, R() * TAU), 1.3);
}

// --- The street's furniture and the dead car ------------------------------------------------------------

function buildStreet(batch, R) {
  const dark = batch.get('dark'), metal = batch.get('metal'), rust = batch.get('rust');
  // a fire hydrant, a newspaper box, a litter bin, parking meters
  const enamel = batch.get('enamel');
  bgeo(enamel, prism(0.12, 0.14, 0.6, 8), mat(-9.6, 0.3, 25.1), [0.34, 0.1, 0.07]);
  bgeo(enamel, prism(0.1, 0.14, 0.12, 8), mat(-9.6, 0.66, 25.1), [0.34, 0.1, 0.07]);
  bbox(enamel, mat(8.4, 0.55, 24.9, 0.1), 0.5, 1.1, 0.45, [0.08, 0.1, 0.18], 1);
  bgeo(enamel, prism(0.25, 0.22, 0.85, 8), mat(-3.7, 0.43, 25.15), [0.2, 0.24, 0.2]);
  for (const x of [-15, -12, 15.8, 19, 22]) {
    bgeo(dark, prism(0.035, 0.035, 1.1, 6), mat(x, 0.55, 25.4), 0.8);
    bgeo(metal, chamferBox(0.16, 0.26, 0.12, 0.03), mat(x, 1.2, 25.4), [0.6, 0.6, 0.6]);
  }
  // A '58 sedan at the kerb: two-tone paint, chrome, fins, a flat tyre, rust.
  const cm = mat(13.8, 0, 27.35, -Math.PI / 2, 0, 0.03);
  const body = batch.get('enamel'), chrome = batch.get('gilt');
  const teal = [0.08, 0.15, 0.15], white = [0.2, 0.2, 0.18];
  const mir = (pts) => pts.flatMap(([x, y, z]) => [V3(x, y, z), V3(-x, y, z)]);
  bgeo(body, hull(mir([[0.95, 0.38, -2.55], [0.98, 0.38, 2.6], [0.98, 0.95, 2.7], [0.96, 0.98, -2.3], [0.9, 0.8, -2.65], [0.85, 1.05, 2.7]]), [2, 2, 2]), cm, teal);
  bgeo(body, hull(mir([[0.84, 0.98, -0.8], [0.84, 0.98, 1.3], [0.72, 1.45, -0.45], [0.72, 1.45, 1.05]]), [2, 2, 2]), cm, white);
  atlasQuad(batch.get('mirror'), at(cm, 0, 1.22, -0.64, 0, -0.9), 1.4, 0.5, [0, 0, 1, 1], 0.4);
  atlasQuad(batch.get('mirror'), at(cm, 0, 1.22, 1.2, Math.PI, -0.9), 1.4, 0.45, [0, 0, 1, 1], 0.4);
  for (const s of [-1, 1]) {
    atlasQuad(batch.get('mirror'), at(cm, s * 0.8, 1.2, 0.25, s * Math.PI / 2), 1.8, 0.36, [0, 0, 1, 1], 0.4);
    bgeo(body, hull([V3(0, 0.9, 1.8), V3(0, 0.95, 2.72), V3(0, 1.28, 2.6), V3(0.04, 0.9, 1.8), V3(0.04, 0.95, 2.72), V3(0.04, 1.28, 2.6)]), at(cm, s * 0.86, 0, 0), teal);
    bbox(chrome, at(cm, s * 0.99, 0.62, 0), 0.02, 0.04, 4.8, [0.75, 0.75, 0.8], 0.5);
    bbox(rust, at(cm, s * 0.985, 0.5, -1.4 + s * 0.8), 0.02, 0.2, 0.7, 0.8, 0.5);
  }
  for (const z of [-2.65, 2.78]) bbox(chrome, at(cm, 0, 0.45, z), 2.0, 0.12, 0.1, [0.75, 0.75, 0.8], 0.5);
  bbox(dark, at(cm, 0, 0.62, -2.66), 1.1, 0.2, 0.02, 0.9, 0.3);
  for (const s of [-1, 1]) bgeo(batch.get('glass'), prism(0.08, 0.08, 0.03, 8), at(cm, s * 0.72, 0.75, -2.68, 0, Math.PI / 2), 0.9);
  for (const s of [-1, 1]) for (const z of [-1.7, 1.75]) bgeo(dark, hull([V3(0, 0.38, -0.5), V3(0, 0.38, 0.5), V3(0, 0.75, -0.36), V3(0, 0.75, 0.36), V3(0.02, 0.38, -0.5), V3(0.02, 0.38, 0.5), V3(0.02, 0.75, -0.36), V3(0.02, 0.75, 0.36)]), at(cm, s * 0.985 - (s > 0 ? 0.02 : 0), 0, z), 0.4);
  for (const [x, z, flat] of [[-0.85, -1.7, 0], [0.85, -1.7, 1], [-0.85, 1.75, 0], [0.85, 1.75, 0]]) {
    const wh = prism(0.36, 0.36, 0.24, 8);
    wh.rotateZ(Math.PI / 2);
    bgeo(dark, wh, at(cm, x, 0.36 - flat * 0.1, z, 0, 0, 0, 1), 0.9);
    const hub = prism(0.18, 0.18, 0.26, 8);
    hub.rotateZ(Math.PI / 2);
    bgeo(chrome, hub, at(cm, x, 0.36 - flat * 0.1, z), [0.7, 0.7, 0.75]);
  }
  litter(batch, [-20, 20.4, 20, 25.4], 0, 20, R, ['paper']);
  litter(batch, [-30, 26, 30, 35.5], 0, 12, R, ['paper']);
}

// --- Marquee bulbs, animated ---------------------------------------------------------------------------

// Which bulbs are dead, which flicker, and their phases (drawn once, with the build's own
// random stream, so every level of the palace lights the marquee the same way).
function marqueeData(list, R) {
  return { list, dead: list.map(() => R() < 0.3), glim: list.map(() => R() < 0.05), phase: list.map(() => R() * 10) };
}

const bulbShape = () => hull([V3(0, 0.05, 0), V3(0.045, 0, 0.026), V3(-0.045, 0, 0.026), V3(0, 0, -0.052), V3(0, -0.05, 0)]);

// The marquee's chasers for a level: one instanced draw, its colours set each frame.
export function attachOutside(level, { list, dead, glim, phase }, reg) {
  const mesh = new THREE.InstancedMesh(bulbShape(), new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
  list.forEach(([x, y, z], i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z));
    mesh.setColorAt(i, new THREE.Color(0.1, 0.08, 0.06));
  });
  mesh.name = 'marquee-bulbs';
  level.group.add(mesh);
  reg(mesh, [OUT]);
  const c = new THREE.Color();
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const on = level.rig.power;
      const step = Math.floor(t * 7);
      list.forEach(([, , , kind], i) => {
        let v = 0.08;
        if (on && !dead[i]) {
          v = kind === 3 ? 1.1 : kind === 2 ? 0.55 : (i + step) % 4 === 0 ? 1.2 : 0.28;
          if (glim[i] && Math.sin(t * 31 + phase[i]) > 0.6) v *= 0.2;
        } else if (glim[i]) {
          v = Math.max(0.08, Math.sin(t * 2.3 + phase[i]) * Math.sin(t * 7.1 + phase[i] * 2) * 0.7);
        }
        c.setRGB(0.1 + v * 0.95, 0.08 + v * 0.72, 0.06 + v * 0.42);
        mesh.setColorAt(i, c);
      });
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

export function* buildOutside(batch) {
  const R = rng(1961);
  buildGround(batch);
  yield;
  const bulbs = [];
  buildFacade(batch, R, bulbs);
  yield;
  buildNeighbours(batch, R);
  yield;
  buildEastLot(batch, R);
  buildAlley(batch, R);
  yield;
  buildWestSide(batch, R);
  buildDock(batch, R);
  buildStreet(batch, R);
  return marqueeData(bulbs, R);
}
