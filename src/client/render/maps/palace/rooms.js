// The public rooms and the dressing rooms: the foyer (ticket booth, concession counter,
// benches, velvet ropes, the sealed auditorium doors), the stair hall (the grand
// staircase's balustrade, the landing, Aurora on her plinth), the box office (counter,
// ticket racks, safe), the dressing rooms (vanities, the wardrobe rail, the trunk,
// the stairwell rail) and the cellar passage under them.

import * as THREE from 'three';
import { FURNITURE, STAIRS, PALACE } from '../../../../shared/maps/palace.js';
import { rng } from '../../geo.js';
import { chamferBox, hull, prism } from '../../level.js';
import { V3, at, mat, bbox, bgeo, beam, atlasQuad } from './kit.js';
import { runMoulding } from './shell.js';
import { instanced, rubble, balusterGeo, newel, stanchion, rope, trunk, costumeRail, COSTUME_COLORS, litter, crateStack } from './props.js';
import { posterRect, signRect, SIGNS } from './paint.js';

const TAU = Math.PI * 2;
const UP_Y = PALACE.UP_Y;
const furniture = (kind) => FURNITURE.filter((p) => p.kind === kind);

// A cream pilaster with gilt flutes and capital on a wall at (x, z) facing n = [nx, nz].
function pilaster(batch, x, z, n, y0, y1, w = 0.5) {
  const cream = batch.get('cream'), gilt = batch.get('gilt'), mahog = batch.get('mahogany');
  const d = 0.12;
  const m = mat(x + n[0] * d / 2, 0, z + n[1] * d / 2, Math.atan2(n[0], n[1]));
  bbox(cream, at(m, 0, (y0 + y1) / 2 + 0.3, 0), w, y1 - y0 - 0.6, d, 0.9, 1.5);
  for (const fx of [-w * 0.28, 0, w * 0.28]) bbox(gilt, at(m, fx, (y0 + y1) / 2 + 0.3, d / 2 + 0.008), 0.04, y1 - y0 - 1.2, 0.016, 0.7, 1);
  bgeo(gilt, hull([V3(-w / 2, 0, -d / 2), V3(w / 2, 0, -d / 2), V3(-w / 2, 0, d / 2), V3(w / 2, 0, d / 2), V3(-w / 2 - 0.08, 0.28, -d / 2), V3(w / 2 + 0.08, 0.28, -d / 2), V3(-w / 2 - 0.08, 0.28, d / 2 + 0.1), V3(w / 2 + 0.08, 0.28, d / 2 + 0.1)]), at(m, 0, y1 - 0.3, 0), 1);
  bbox(mahog, at(m, 0, y0 + 0.3, 0.01), w + 0.06, 0.6, d + 0.04, 0.8, 1);
}

// A framed poster in a gilt frame behind glass, on a wall at (x, y, z) facing yaw.
function framedPoster(batch, x, y, z, yaw, idx, w = 0.8, h = 1.2) {
  const m = mat(x, y, z, yaw);
  bbox(batch.get('gilt'), at(m, 0, 0, 0.025), w + 0.14, h + 0.14, 0.05, 0.9, 0.5);
  atlasQuad(batch.get('posters'), at(m, 0, 0, 0.052), w, h, posterRect(idx), 0.95);
  atlasQuad(batch.get('mirror'), at(m, 0, 0, 0.06), w + 0.02, h + 0.02, [0, 0, 1, 1], 0.55);
}

// Room trim: skirting, dado and cornice on the listed sides of a room rectangle.
function trim(batch, rect, sides, { y = 0, dado = 1.1, top, skirt = 'mahogany', cornice = true }) {
  const mah = batch.get(skirt), cream = batch.get('cream'), gilt = batch.get('gilt');
  for (const s of sides) {
    runMoulding(mah, rect, s, y, [[0.15, 0.035]], 0.8);
    if (dado) runMoulding(mah, rect, s, y + dado, [[0.05, 0.045], [0.035, 0.065]], 0.9);
    if (cornice) {
      runMoulding(cream, rect, s, top - 0.42, [[0.14, 0.06], [0.14, 0.14], [0.14, 0.24]], 0.85);
      runMoulding(gilt, rect, s, top - 0.47, [[0.05, 0.08]], 0.9);
    }
  }
}

// --- Foyer ------------------------------------------------------------------------------------------

function ticketBooth(batch, p, R) {
  const [x0, , z0, x1, , z1] = p.solid;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const mahog = batch.get('mahogany'), gilt = batch.get('gilt'), mirror = batch.get('mirror'), dark = batch.get('dark');
  // base: cream panels framed in gilt, on a dark plinth
  bbox(dark, mat(cx, 0.06, cz), w + 0.06, 0.12, d + 0.06, 0.6, 1);
  bbox(batch.get('cream'), mat(cx, 0.56, cz), w, 0.9, d, [1, 0.95, 0.85], 1.2);
  for (const [sx, sz, pw, pd] of [[0, d / 2 + 0.01, w - 0.3, 0.02], [0, -d / 2 - 0.01, w - 0.3, 0.02], [w / 2 + 0.01, 0, 0.02, d - 0.3], [-w / 2 - 0.01, 0, 0.02, d - 0.3]]) {
    bbox(batch.get('mahogany'), mat(cx + sx, 0.56, cz + sz), pw, 0.6, pd, 0.8, 0.6);
    for (const dy of [-0.31, 0.31]) bbox(gilt, mat(cx + sx * 1.02, 0.56 + dy, cz + sz * 1.02), pw ? pw + 0.04 : 0.03, 0.03, pd ? pd + 0.04 : 0.03, 0.9, 0.3);
  }
  bbox(mahog, mat(cx, 1.04, cz), w + 0.1, 0.06, d + 0.1, 0.95, 1);
  // glass upper with brass mullions; a speaking grille and a coin trough on the front
  // inside: the ticket counter under the window, a shelf of ticket rolls at the back
  bbox(mahog, mat(cx, 1.12, z1 - 0.3), w - 0.2, 0.04, 0.35, 0.8, 1);
  bbox(mahog, mat(cx, 1.3, z0 + 0.2), w - 0.3, 0.03, 0.25, 0.8, 1);
  for (let k = 0; k < 5; k++) bgeo(batch.get('paper'), prism(0.06, 0.06, 0.08, 8), mat(cx - 0.6 + k * 0.3, 1.36, z0 + 0.2, 0, Math.PI / 2), [0.9, 0.45 + k * 0.08, 0.35]);
  for (const [sx, sz, len, alongX] of [[0, d / 2, w, true], [0, -d / 2, w, true], [w / 2, 0, d, false], [-w / 2, 0, d, false]]) {
    atlasQuad(mirror, mat(cx + sx, 1.62, cz + sz, alongX ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI / 2 : -Math.PI / 2)), len - 0.08, 1.1, [0, 0, 1, 1], 0.7);
    for (const u of [-0.5, 0, 0.5]) {
      const off = u * (len - 0.1);
      bbox(gilt, mat(cx + (alongX ? off : sx), 1.62, cz + (alongX ? sz : off)), 0.035, 1.12, 0.035, 0.75, 2);
    }
  }
  bgeo(gilt, prism(0.12, 0.12, 0.02, 8), mat(cx, 1.45, z1 + 0.01, 0, Math.PI / 2), 1);
  bbox(gilt, mat(cx, 1.1, z1 + 0.08), 0.5, 0.04, 0.16, 1, 0.3);
  // roof: stepped cap, a gilt crown and a finial; the TICKETS sign
  bbox(mahog, mat(cx, 2.22, cz), w + 0.16, 0.1, d + 0.16, 0.9, 1);
  bbox(gilt, mat(cx, 2.3, cz), w + 0.06, 0.06, d + 0.06, 0.9, 0.5);
  bgeo(mahog, hull([V3(-w / 2, 0, -d / 2), V3(w / 2, 0, -d / 2), V3(-w / 2, 0, d / 2), V3(w / 2, 0, d / 2), V3(-0.3, 0.26, -0.3), V3(0.3, 0.26, -0.3), V3(-0.3, 0.26, 0.3), V3(0.3, 0.26, 0.3)]), mat(cx, 2.33, cz), 0.85);
  bgeo(gilt, hull([...Array.from({ length: 8 }, (_, k) => V3(Math.cos((k / 8) * TAU) * 0.08, 0, Math.sin((k / 8) * TAU) * 0.08)), V3(0, 0.3, 0)]), mat(cx, 2.59, cz), 1.1);
  atlasQuad(batch.get('signs'), mat(cx, 2.43, z1 + 0.09, 0, -0.35), 0.9, 0.3, signRect(SIGNS.tickets), 1);
  // inside: a stool and a roll of tickets on the shelf
  bgeo(dark, prism(0.16, 0.16, 0.05, 8), mat(cx, 0.72, cz - 0.2), 0.7);
  bbox(batch.get('paper'), mat(cx - 0.3, 1.1, cz + 0.2), 0.14, 0.1, 0.14, [0.8, 0.45, 0.35], 0.3);
}

function concession(batch, p, R) {
  const [x0, , z0, x1, , z1] = p.solid;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const mahog = batch.get('mahogany'), gilt = batch.get('gilt'), dark = batch.get('dark'), mirror = batch.get('mirror');
  // the candy case: a panelled base, a glass-fronted case, a mahogany top
  bbox(batch.get('panel'), mat(cx, 0.3, z1 - 0.3), w, 0.6, 0.55, 0.9, 1);
  bbox(dark, mat(cx, 0.83, z1 - 0.32), w - 0.1, 0.44, 0.5, 0.35, 1);
  atlasQuad(mirror, mat(cx, 0.83, z1 - 0.04, 0, -0.12), w - 0.1, 0.46, [0, 0, 1, 1], 0.7);
  for (let x = x0 + 0.05; x <= x1 - 0.04; x += 1.0) bbox(gilt, mat(x, 0.83, z1 - 0.05), 0.04, 0.48, 0.04, 1, 0.3);
  bbox(mahog, mat(cx, 1.08, cz + 0.1), w + 0.1, 0.05, d - 0.1, 0.95, 1);
  bbox(gilt, mat(cx, 0.62, z1 - 0.02), w, 0.04, 0.03, 0.9, 0.5);
  // candy boxes inside the case, some fallen
  const tints = [[0.9, 0.3, 0.25], [0.95, 0.8, 0.3], [0.35, 0.55, 0.85], [0.95, 0.95, 0.85], [0.4, 0.75, 0.45]];
  for (let k = 0; k < 34; k++) {
    if (R() < 0.3) continue;
    const bx = x0 + 0.2 + (k % 17) * ((w - 0.4) / 16), by = 0.66 + Math.floor(k / 17) * 0.2;
    bbox(batch.get('paper'), mat(bx, by, z1 - 0.3 + (R() - 0.5) * 0.1, (R() - 0.5) * 0.3), 0.14, 0.1, 0.06, tints[k % 5], 0.3);
  }
  // back bar: shelves and a long mirror on the wall
  atlasQuad(batch.get('silver'), mat(cx, 1.9, 6.17, 0), w - 0.4, 1.0, [0, 0, 1, 1], 0.3);
  bbox(gilt, mat(cx, 2.43, 6.19), w - 0.3, 0.06, 0.04, 0.9, 0.5);
  bbox(gilt, mat(cx, 1.38, 6.19), w - 0.3, 0.06, 0.04, 0.9, 0.5);
  bbox(mahog, mat(cx, 1.4, 6.3), w - 0.4, 0.04, 0.24, 0.8, 1);
  for (let k = 0; k < 14; k++) if (R() < 0.7) bgeo(batch.get('paper'), prism(0.035, 0.028, 0.1, 6), mat(x0 + 0.4 + k * 0.52, 1.47, 6.3), [0.95, 0.92, 0.85]);
  // the popcorn machine on the counter: a glass cabinet on a red base, kettle inside
  const pm = mat(-2.8, 1.1, cz + 0.1);
  bbox(batch.get('plush'), at(pm, 0, 0.12, 0), 0.62, 0.24, 0.5, [1.1, 0.8, 0.7], 0.5);
  bbox(gilt, at(pm, 0, 0.26, 0), 0.64, 0.04, 0.52, 0.9, 0.3);
  for (const [sx, sz] of [[-0.3, -0.24], [0.3, -0.24], [-0.3, 0.24], [0.3, 0.24]]) bbox(gilt, at(pm, sx, 0.62, sz), 0.03, 0.72, 0.03, 1, 0.3);
  bbox(batch.get('linen'), at(pm, 0, 0.38, 0), 0.56, 0.2, 0.44, [1.05, 0.92, 0.55], 0.4);
  atlasQuad(mirror, at(pm, 0, 0.62, 0.25), 0.58, 0.7, [0, 0, 1, 1], 0.6);
  bgeo(batch.get('metal'), prism(0.12, 0.09, 0.14, 8), at(pm, 0, 0.82, 0), [0.9, 0.9, 0.95]);
  bbox(batch.get('plush'), at(pm, 0, 1.02, 0), 0.64, 0.08, 0.52, [1.1, 0.8, 0.7], 0.5);
  // a cash register and a soda fountain
  const cr = mat(2.6, 1.1, cz + 0.1, -0.2);
  bgeo(batch.get('metal'), hull([V3(-0.2, 0, -0.18), V3(0.2, 0, -0.18), V3(-0.2, 0, 0.2), V3(0.2, 0, 0.2), V3(-0.18, 0.28, -0.1), V3(0.18, 0.28, -0.1), V3(-0.18, 0.14, 0.2), V3(0.18, 0.14, 0.2)]), cr, [0.85, 0.75, 0.55]);
  bbox(dark, at(cr, 0, 0.3, -0.14), 0.3, 0.1, 0.05, 0.8, 0.3);
  for (const x of [0.5, 0.8, 1.1]) {
    bgeo(batch.get('metal'), prism(0.05, 0.06, 0.34, 8), mat(x, 1.27, cz + 0.05), [0.9, 0.9, 0.95]);
    bbox(dark, mat(x, 1.38, cz + 0.12), 0.03, 0.03, 0.12, 0.8, 0.3);
  }
  // the menu board and the REFRESHMENTS sign over the bar
  atlasQuad(batch.get('signs'), mat(cx, 3.05, 6.18, 0), 2.6, 1.0, signRect(SIGNS.menu), 0.9);
  bbox(gilt, mat(cx, 3.05, 6.165), 2.72, 1.12, 0.02, 0.8, 0.5);
  atlasQuad(batch.get('signs'), mat(cx, 3.9, 6.18, 0), 3.2, 0.6, signRect(SIGNS.refresh), 0.95);
  // popcorn boxes spilled on the carpet in front
  for (let k = 0; k < 9; k++) {
    const x = cx + (R() - 0.5) * w, z = z1 + 0.3 + R() * 1.5;
    bbox(batch.get('paper'), mat(x, 0.05, z, R() * TAU, R() < 0.5 ? Math.PI / 2 : 0), 0.09, 0.14, 0.06, [0.95, 0.4, 0.3], 0.3);
  }
}

function bench(batch, p) {
  const [x0, , z0, x1, , z1] = p.solid;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongZ = z1 - z0 > x1 - x0;
  const L = alongZ ? z1 - z0 : x1 - x0, D = alongZ ? x1 - x0 : z1 - z0;
  const m = mat(cx, 0, cz, alongZ ? Math.PI / 2 : 0);
  const mah = batch.get('mahogany');
  bgeo(batch.get('plush'), chamferBox(L - 0.06, 0.12, D - 0.06, 0.04), at(m, 0, 0.43, 0), 0.9);
  for (let k = 1; k < 4; k++) bbox(batch.get('gilt'), at(m, -L / 2 + (k * L) / 4, 0.49, 0), 0.03, 0.02, 0.03, 1, 0.2);
  bbox(mah, at(m, 0, 0.33, 0), L, 0.1, D, 0.8, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bgeo(mah, prism(0.035, 0.045, 0.3, 6), at(m, sx * (L / 2 - 0.1), 0.14, sz * (D / 2 - 0.08)), 0.85);
  bbox(mah, at(m, 0, 0.1, 0), L - 0.2, 0.03, 0.03, 0.8, 0.5);
}

function buildFoyer(batch, R) {
  const rect = [-10.85, 6.15, 10.85, 19.85];
  trim(batch, rect, ['x0', 'x1', 'z0', 'z1'], { top: 6.0 });
  for (const z of [7.5, 11.5, 19.3]) pilaster(batch, -10.85, z, [1, 0], 0, 5.55);
  for (const z of [7.2, 11.8, 16.1, 19.3]) pilaster(batch, 10.85, z, [-1, 0], 0, 5.55);
  for (const x of [-7.9, 7.9, -10.2, 10.2]) pilaster(batch, x, 19.85, [0, -1], 0, 5.55);
  for (const x of [-9.2, 9.2]) pilaster(batch, x, 6.15, [0, 1], 0, 5.55);
  // A plaster coffer round the chandelier, and its rose.
  const cream = batch.get('cream'), gilt = batch.get('gilt');
  for (const [x, z, sx, sz] of [[0, 8.6, 13, 0.3], [0, 17.4, 13, 0.3], [-6.35, 13, 0.3, 8.5], [6.35, 13, 0.3, 8.5]]) {
    bbox(cream, mat(x, 5.9, z), sx, 0.2, sz, 0.85, 1.5);
    bbox(gilt, mat(x, 5.78, z), sx * (sx > 1 ? 1 : 0.5) + (sx > 1 ? 0 : 0.1), 0.05, sz * (sz > 1 ? 1 : 0.5) + (sz > 1 ? 0 : 0.1), 0.9, 0.5);
  }
  bgeo(gilt, prism(0.7, 0.55, 0.06, 12), mat(0, 5.97, 13), 0.9);
  for (let k = 0; k < 10; k++) bgeo(cream, hull([V3(0, 0, 0), V3(0.6, 0, -0.12), V3(0.6, 0, 0.12), V3(0.95, 0, 0), V3(0.45, -0.07, 0)]), mat(0, 5.98, 13, (k / 10) * TAU), 0.9);
  // The sealed doors into the auditorium, roped off with a CLOSED sign.
  for (const x of [-6.2, 6.2]) {
    const zf = 6.15;
    for (const s of [-1, 1]) {
      const cx = x + s * 0.45;
      bbox(batch.get('plush'), mat(cx, 1.2, zf + 0.04), 0.86, 2.36, 0.06, 0.55, 0.5);
      for (let bi = 0; bi < 12; bi++) bbox(gilt, mat(cx - 0.3 + (bi % 3) * 0.3, 0.45 + Math.floor(bi / 3) * 0.55, zf + 0.08), 0.03, 0.03, 0.02, 1, 0.2);
      atlasQuad(batch.get('mirror'), mat(cx, 1.95, zf + 0.075), 0.32, 0.32, [0, 0, 1, 1], 0.6);
    }
    bbox(batch.get('mahogany'), mat(x, 2.46, zf + 0.05), 2.1, 0.14, 0.1, 0.9, 1);
    for (const s of [-1, 1]) bbox(batch.get('mahogany'), mat(x + s * 0.97, 1.2, zf + 0.05), 0.14, 2.5, 0.1, 0.9, 1);
    for (let k = 0; k < 3; k++) bbox(batch.get('woodWall'), mat(x, 0.9 + k * 0.5, zf + 0.13, 0, 0, (k - 1) * 0.25 + 0.1), 2.2, 0.16, 0.04, 0.55, 1);
    stanchion(batch, x - 1.25, 7.15);
    stanchion(batch, x + 1.25, 7.15);
    rope(batch, [x - 1.25, 0.9, 7.15], [x + 1.25, 0.9, 7.15]);
    atlasQuad(batch.get('signs'), mat(x, 0.62, 7.19, 0), 0.5, 0.2, signRect(SIGNS.closed), 0.9);
    atlasQuad(batch.get('signs'), mat(x, 0.62, 7.11, Math.PI), 0.5, 0.2, signRect(SIGNS.closed), 0.9);
  }
  stanchion(batch, 4.5, 12.8, 0.7);
  stanchion(batch, -3.3, 18.6, 2.1);
  // Boarded fake doors either side of the entrance, inside.
  for (const x of [-2.2, 2.2]) {
    const zf = 19.85;
    bbox(batch.get('dark'), mat(x, 1.2, zf - 0.03), 1.1, 2.4, 0.04, 0.4, 1);
    atlasQuad(batch.get('mirror'), mat(x, 1.55, zf - 0.055, Math.PI), 0.8, 1.2, [0, 0, 1, 1], 0.4);
    for (const s of [-1, 1]) bbox(gilt, mat(x + s * 0.55, 1.2, zf - 0.06), 0.05, 2.4, 0.05, 0.9, 0.3);
    bbox(gilt, mat(x, 2.42, zf - 0.06), 1.15, 0.05, 0.05, 0.9, 0.3);
    for (let k = 0; k < 4; k++) bbox(batch.get('woodWall'), mat(x, 0.5 + k * 0.55, zf - 0.1, Math.PI, 0, (R() - 0.5) * 0.5), 1.35, 0.17, 0.045, 0.55, 1);
  }
  framedPoster(batch, -10.84, 1.95, 10.3, Math.PI / 2, 0);
  framedPoster(batch, 10.84, 1.95, 11.2, -Math.PI / 2, 1);
  framedPoster(batch, -4.05, 1.95, 19.84, Math.PI, 5);
  framedPoster(batch, 4.05, 1.95, 19.84, Math.PI, 2);
  atlasQuad(batch.get('signs'), mat(10.84, 2.75, 14, -Math.PI / 2), 1.5, 0.32, signRect(SIGNS.boxOffice), 0.9);
  atlasQuad(batch.get('signs'), mat(-10.84, 4.2, 14.5, Math.PI / 2), 1.0, 1.5, signRect(SIGNS.prices), 0.85);
  for (const p of furniture('ticketBooth')) ticketBooth(batch, p, R);
  for (const p of furniture('concession')) concession(batch, p, R);
  for (const p of furniture('bench')) bench(batch, p);
  litter(batch, [-10.5, 7.6, 10.5, 19.5], 0, 30, R, ['paper', 'paper', 'glass']);
}

// --- Stair hall ---------------------------------------------------------------------------------------

function statue(batch, p, R) {
  const [x0, y0, z0, x1, y1, z1] = p.solid;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0;
  const cream = batch.get('cream'), gilt = batch.get('gilt');
  // the plinth: a moulded marble block with a gilt plaque
  bbox(batch.get('dark'), mat(cx, 0.08, cz), w + 0.1, 0.16, w + 0.1, 0.6, 1);
  bbox(cream, mat(cx, 0.62, cz), w - 0.12, 0.95, w - 0.12, [0.52, 0.56, 0.54], 1);
  bbox(cream, mat(cx, y1 - 0.06, cz), w + 0.06, 0.12, w + 0.06, [0.6, 0.63, 0.6], 1);
  bbox(cream, mat(cx, 0.21, cz), w + 0.02, 0.1, w + 0.02, [0.6, 0.63, 0.6], 1);
  bbox(gilt, mat(cx + w / 2 - 0.05, 0.72, cz), 0.02, 0.22, 0.5, 1, 0.3);
  // Aurora: a draped figure raising a star to the dawn (plaster, chipped).
  const s = mat(cx, y1, cz, -Math.PI / 2 - 0.3);
  const white = [1.0, 1.0, 1.04];
  // a base of rock she stands on, the robe falling in folds, one knee forward
  bgeo(cream, hull([V3(-0.34, 0, -0.3), V3(0.34, 0, -0.3), V3(-0.34, 0, 0.3), V3(0.3, 0, 0.3), V3(-0.2, 0.14, -0.2), V3(0.25, 0.12, 0.1), V3(0, 0.18, 0.05)]), s, [0.8, 0.8, 0.82]);
  const robe = hull([
    ...Array.from({ length: 7 }, (_, k) => V3(Math.cos((k / 7) * TAU) * 0.27, 0.1, Math.sin((k / 7) * TAU) * 0.22)),
    ...Array.from({ length: 6 }, (_, k) => V3(Math.cos((k / 6) * TAU) * 0.15, 0.98, Math.sin((k / 6) * TAU) * 0.12)),
    V3(0.06, 0.5, 0.26),
  ]);
  bgeo(cream, robe, s, white);
  bgeo(cream, hull([V3(-0.15, 0, -0.1), V3(0.15, 0, -0.1), V3(-0.15, 0, 0.1), V3(0.15, 0, 0.1), V3(-0.2, 0.4, -0.09), V3(0.2, 0.4, -0.09), V3(-0.15, 0.4, 0.1), V3(0.15, 0.4, 0.1), V3(0, 0.28, 0.15)]), at(s, 0, 0.97, 0), white);
  // the drape over her shoulder, trailing behind
  bgeo(cream, hull([V3(-0.2, 1.36, -0.05), V3(-0.14, 1.4, -0.12), V3(-0.3, 0.5, -0.2), V3(-0.12, 0.2, -0.28), V3(-0.22, 0.9, -0.24)]), s, [0.9, 0.9, 0.94]);
  bgeo(cream, prism(0.05, 0.06, 0.12, 6), at(s, 0, 1.42, 0), white);
  bgeo(cream, hull([V3(-0.09, 0, -0.08), V3(0.09, 0, -0.08), V3(-0.08, 0, 0.1), V3(0.08, 0, 0.1), V3(-0.1, 0.16, -0.09), V3(0.1, 0.16, -0.09), V3(-0.07, 0.2, 0.08), V3(0.07, 0.2, 0.08), V3(0, 0.26, -0.02), V3(0, 0.08, 0.14)]), at(s, 0, 1.47, 0), white);
  // hair gathered up
  bgeo(cream, prism(0.07, 0.04, 0.1, 6), at(s, 0, 1.73, -0.04), white);
  // the raised arm and its star; the other arm holding the robe, broken at the wrist
  beam(cream, at(s, 0.2, 1.3, 0).elements.slice(12, 15), at(s, 0.34, 1.72, 0.02).elements.slice(12, 15), 0.08, 0.08, white, 0.3);
  beam(cream, at(s, 0.34, 1.72, 0.02).elements.slice(12, 15), at(s, 0.38, 2.08, 0.05).elements.slice(12, 15), 0.07, 0.07, white, 0.3);
  const star = [];
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU, r = k % 2 ? 0.07 : 0.17; star.push(V3(Math.cos(a) * r, Math.sin(a) * r, 0.03), V3(Math.cos(a) * r, Math.sin(a) * r, -0.03)); }
  bgeo(gilt, hull(star), at(s, 0.39, 2.25, 0.05), 1);
  beam(cream, at(s, -0.2, 1.3, 0).elements.slice(12, 15), at(s, -0.28, 0.95, 0.12).elements.slice(12, 15), 0.08, 0.08, white, 0.3);
  // the chipped-off hand on the plinth top
  bgeo(cream, chamferBox(0.08, 0.05, 0.1, 0.015), mat(cx + 0.35, y1 + 0.03, cz + 0.4, 0.7), white);
}

function buildStairHall(ctx, batch, R) {
  const rect = [-17.85, 6.15, -11.15, 19.85];
  trim(batch, rect, ['x0', 'x1', 'z1'], { top: 7.0, cornice: false });
  trim(batch, [-17.85, 10.8, -11.15, 19.85], ['z0'], { top: 7.0, cornice: false, dado: 0 });
  trim(batch, rect, ['x0', 'x1', 'z0', 'z1'], { y: 3.6, dado: 1.1, top: 7.0 });
  pilaster(batch, -11.15, 18.6, [-1, 0], 0, 6.55);
  pilaster(batch, -11.15, 11.6, [-1, 0], 0, 6.55);
  const mahog = batch.get('mahogany'), gilt = batch.get('gilt'), cream = batch.get('cream');
  const S = STAIRS.find((s) => s.id === 'hall');
  const x = S.a1 + 0.05;   // the open (east) side, on the rail collider
  // Balusters, two a step, and along the landing's edge.
  const bal = balusterGeo(0.84, 0.035);
  const mats = [];
  for (let i = 0; i < S.steps; i++) {
    const zA = S.start - (i + 1) * S.run, y = (i + 1) * S.rise;
    for (const f of [0.27, 0.73]) mats.push(mat(x, y, zA + S.run * f));
  }
  for (let bx = -15.25; bx < -11.3; bx += 0.22) mats.push(mat(bx, UP_Y, 10.75));
  instanced(ctx, bal, 'mahogany', mats);
  // Handrails, newels and the stair rods at each riser.
  const top = S.start - S.steps * S.run;
  beam(mahog, [x, 0.95, S.start + 0.1], [x, S.steps * S.rise + 0.9, top + 0.05], 0.09, 0.07, 0.95, 0.5);
  beam(mahog, [x, UP_Y + 0.9, 10.75], [-11.2, UP_Y + 0.9, 10.75], 0.09, 0.07, 0.95, 0.5);
  newel(mahog, gilt, x, 0, S.start + 0.1, 1.2);
  newel(mahog, gilt, x, UP_Y, 10.75, 1.1);
  newel(mahog, gilt, -11.25, UP_Y, 10.75, 1.1);
  for (let i = 0; i < S.steps; i++) {
    const z = S.start - i * S.run - 0.03, y = i * S.rise + 0.03;
    bbox(gilt, mat((S.a0 + S.a1) / 2, y + 0.005, z - 0.02), S.a1 - S.a0 - 0.1, 0.025, 0.025, 1, 0.3);
  }
  // The open side's outer stringer: a mahogany band sloping with the steps, gilt edged.
  beam(mahog, [x + 0.02, 0.1, S.start + 0.05], [x + 0.02, S.steps * S.rise - 0.1, top], 0.06, 0.34, 0.85, 0.5);
  beam(gilt, [x + 0.05, -0.08, S.start + 0.05], [x + 0.05, S.steps * S.rise - 0.28, top], 0.02, 0.04, 0.8, 0.3);
  // A little panelled door into the cupboard under the stairs, and a skirting under the stringer.
  bbox(mahog, mat(x + 0.02, 1.05, 11.9), 0.05, 2.1, 0.9, 0.7, 1);
  for (const dz of [-0.47, 0.47]) bbox(gilt, mat(x + 0.04, 1.05, 11.9 + dz), 0.03, 2.14, 0.04, 0.8, 0.3);
  bbox(gilt, mat(x + 0.05, 1.05, 11.65), 0.03, 0.03, 0.08, 1, 0.2);
  bbox(mahog, mat(x + 0.02, 0.08, (S.start + top) / 2), 0.04, 0.16, S.start - top, 0.7, 1);
  // The stringer between the stairs and the west wall, capped in mahogany.
  const g = hull([
    V3(-17.86, 0, S.start + 0.05), V3(-17.49, 0, S.start + 0.05), V3(-17.86, 0.35, S.start + 0.05), V3(-17.49, 0.35, S.start + 0.05),
    V3(-17.86, S.steps * S.rise + 0.15, top), V3(-17.49, S.steps * S.rise + 0.15, top), V3(-17.86, 0, top), V3(-17.49, 0, top),
  ], [2, 2, 2]);
  bgeo(cream, g, new THREE.Matrix4(), 0.8);
  beam(mahog, [-17.67, 0.37, S.start + 0.05], [-17.67, S.steps * S.rise + 0.17, top], 0.38, 0.04, 0.8, 0.5);
  // Lobby cards climbing the west wall with the stairs.
  for (const [z, k] of [[16.6, 3], [14.2, 6], [11.8, 7]]) {
    const y = ((S.start - z) / S.run) * S.rise + 1.7;
    framedPoster(batch, -17.84, y, z, Math.PI / 2, k, 0.6, 0.9);
  }
  // Ceiling rose for the chandelier; the sign over the dressing-room door.
  bgeo(gilt, prism(0.45, 0.36, 0.06, 12), mat(-14.5, 6.97, 13), 0.9);
  atlasQuad(batch.get('signs'), mat(-16.5, 6.45, 6.17, 0), 1.5, 0.28, signRect(SIGNS.dressing), 0.85);
  for (const p of furniture('plinth')) statue(batch, p, R);
  litter(batch, [-15.3, 6.5, -11.4, 19.5], 0, 10, R, ['paper']);
}

// --- Box office ---------------------------------------------------------------------------------------

function buildBoxOffice(batch, R) {
  const rect = [11.15, 6.15, 17.85, 19.85];
  trim(batch, rect, ['x0', 'x1', 'z0', 'z1'], { dado: 1.0, top: 3.2 });
  const mahog = batch.get('mahogany'), gilt = batch.get('gilt'), dark = batch.get('dark'), metal = batch.get('metal'), wood = batch.get('woodWall');
  for (const p of furniture('counter')) {
    const [x0, , z0, x1, , z1] = p.solid;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    bbox(batch.get('panel'), mat(cx, 0.5, z1 - 0.08), w, 1.0, 0.1, 0.9, 1);
    bbox(mahog, mat(cx, 0.5, z0 + 0.05), w, 1.0, 0.06, 0.7, 1);
    for (const s of [-1, 1]) bbox(mahog, mat(cx + s * (w / 2 - 0.03), 0.5, cz), 0.06, 1.0, d, 0.8, 1);
    bbox(mahog, mat(cx, 1.07, cz), w + 0.08, 0.06, d + 0.08, 0.95, 1);
    // a shelf under the counter (clerk's side) and the brass grille screen on top
    bbox(wood, mat(cx, 0.45, cz - 0.05), w - 0.12, 0.03, d - 0.25, 0.6, 1);
    for (let k = 0; k <= 8; k++) bbox(gilt, mat(x0 + 0.05 + k * ((w - 0.1) / 8), 1.55, cz), 0.03, 0.9, 0.03, 0.9, 0.2);
    bbox(gilt, mat(cx, 2.02, cz), w, 0.06, 0.06, 0.9, 0.3);
    for (const wx of [cx - 1.15, cx + 1.15]) {
      atlasQuad(batch.get('mirror'), mat(wx, 1.6, cz + 0.04), 0.9, 0.8, [0, 0, 1, 1], 0.6);
      bbox(gilt, mat(wx, 1.12, cz + 0.1), 0.3, 0.02, 0.2, 1, 0.3);
    }
    atlasQuad(batch.get('signs'), mat(cx, 2.3, cz + 0.05), 1.8, 0.4, signRect(SIGNS.boxOffice), 0.95);
    // a ticket dispenser and a telephone on the counter; a stool behind
    bgeo(metal, hull([V3(-0.15, 0, -0.12), V3(0.15, 0, -0.12), V3(-0.15, 0, 0.12), V3(0.15, 0, 0.12), V3(-0.13, 0.2, -0.1), V3(0.13, 0.2, -0.1), V3(-0.13, 0.12, 0.12), V3(0.13, 0.12, 0.12)]), mat(cx - 0.4, 1.1, cz - 0.1), [0.8, 0.8, 0.85]);
    for (let k = 0; k < 4; k++) bbox(batch.get('paper'), mat(cx - 0.52 + k * 0.08, 1.33, cz - 0.1), 0.05, 0.02, 0.08, [0.9, 0.5 + k * 0.1, 0.4], 0.2);
    bgeo(dark, hull([V3(-0.1, 0, -0.1), V3(0.1, 0, -0.1), V3(-0.1, 0, 0.1), V3(0.1, 0, 0.1), V3(-0.08, 0.1, -0.06), V3(0.08, 0.1, -0.06), V3(-0.08, 0.06, 0.1), V3(0.08, 0.06, 0.1)]), mat(cx + 0.7, 1.1, cz - 0.15), 0.8);
    bgeo(dark, prism(0.16, 0.16, 0.05, 8), mat(cx + 0.2, 0.72, z0 - 0.5), 0.7);
    bgeo(dark, prism(0.02, 0.03, 0.7, 6), mat(cx + 0.2, 0.35, z0 - 0.5), 0.7);
  }
  // Ticket racks either side of the alley door; the safe in the corner.
  for (const x0 of [12.2, 16.3]) {
    bbox(wood, mat(x0 + 0.7, 1.8, 6.25), 1.44, 1.1, 0.18, 0.55, 1);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
      bbox(dark, mat(x0 + 0.1 + c * 0.17, 1.33 + r * 0.21, 6.35), 0.14, 0.16, 0.02, 0.5, 0.3);
      if (R() < 0.6) bbox(batch.get('paper'), mat(x0 + 0.1 + c * 0.17, 1.3 + r * 0.21, 6.37), 0.11, 0.1, 0.02, [0.95, 0.55 + R() * 0.4, 0.45], 0.2);
    }
  }
  const sf = mat(17.47, 0, 6.55, -Math.PI / 2);
  bgeo(dark, chamferBox(0.66, 0.9, 0.6, 0.04), at(sf, 0, 0.47, 0), [0.4, 0.46, 0.42]);
  bbox(dark, at(sf, 0, 0.03, 0), 0.7, 0.06, 0.64, 0.5, 0.3);
  bbox(gilt, at(sf, 0, 0.5, 0.305), 0.5, 0.7, 0.01, 0.35, 0.5);
  bgeo(metal, prism(0.07, 0.07, 0.03, 10), at(sf, -0.1, 0.62, 0.31, 0, Math.PI / 2), [0.9, 0.9, 0.9]);
  bbox(metal, at(sf, 0.14, 0.5, 0.32, 0, 0, 0.4), 0.14, 0.03, 0.03, 0.9, 0.2);
  // a calendar and a poster; the price board
  atlasQuad(batch.get('posters'), mat(17.84, 1.7, 17.4, -Math.PI / 2), 0.66, 1.0, posterRect(0), 0.85);
  atlasQuad(batch.get('signs'), mat(11.16, 1.75, 17.5, Math.PI / 2), 0.7, 1.05, signRect(SIGNS.prices), 0.85);
  litter(batch, [11.4, 6.4, 17.6, 19.6], 0, 14, R, ['paper']);
}

// --- Dressing rooms -----------------------------------------------------------------------------------

function vanity(batch, p, R, big) {
  const [x0, y0, z0, x1, y1, z1] = p.solid;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = z1 - z0, d = x1 - x0;
  const wood = batch.get('mahogany'), dark = batch.get('dark'), gilt = batch.get('gilt');
  const top = y1;
  bbox(wood, mat(cx, top - 0.03, cz), d + 0.04, 0.05, w, 0.85, 1);
  bbox(wood, mat(cx, top - 0.14, cz), d - 0.04, 0.16, w - 0.04, 0.75, 1);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bbox(wood, mat(cx + sx * (d / 2 - 0.05), y0 + (top - y0 - 0.2) / 2, cz + sz * (w / 2 - 0.05)), 0.05, top - y0 - 0.2, 0.05, 0.75, 0.5);
  for (let k = 0; k < (big ? 3 : 1); k++) bbox(gilt, mat(x1 + 0.005, top - 0.14, z0 + (w * (k + 0.5)) / (big ? 3 : 1)), 0.01, 0.03, 0.08, 1, 0.2);
  if (big) {
    // the mirror (its bulbs are the lamp), bottles and jars, a wig on a stand, a chair
    atlasQuad(batch.get('silver'), mat(-17.83, 5.12, cz, Math.PI / 2), w - 0.35, 1.15, [0, 0, 1, 1], 0.75);
    bbox(wood, mat(-17.82, 5.12, cz), 0.04, 1.4, w - 0.1, 0.5, 1);
    const tints = [[0.9, 0.5, 0.45], [0.6, 0.8, 0.9], [0.95, 0.9, 0.7], [0.5, 0.35, 0.3]];
    for (let k = 0; k < 11; k++) {
      const bz = z0 + 0.15 + R() * (w - 0.3), bx = x0 + 0.1 + R() * (d - 0.25), h = 0.05 + R() * 0.12;
      bgeo(k % 3 ? batch.get('glass') : batch.get('paper'), prism(0.025 + R() * 0.02, 0.03, h, 6), mat(bx, top + h / 2, bz), tints[k % 4]);
    }
    const wm = mat(cx + 0.05, top, z0 + 0.35);
    bgeo(dark, prism(0.02, 0.05, 0.3, 6), at(wm, 0, 0.15, 0), 0.8);
    bgeo(batch.get('cream'), hull([V3(-0.08, 0, -0.08), V3(0.08, 0, -0.08), V3(-0.08, 0, 0.08), V3(0.08, 0, 0.08), V3(-0.09, 0.16, 0), V3(0.09, 0.16, 0), V3(0, 0.24, 0), V3(0, 0.1, 0.1)]), at(wm, 0, 0.3, 0), [0.85, 0.82, 0.78]);
    bgeo(batch.get('linen'), hull([V3(-0.1, 0.12, -0.1), V3(0.1, 0.12, -0.1), V3(-0.11, 0.2, 0.05), V3(0.11, 0.2, 0.05), V3(0, 0.27, -0.02), V3(-0.12, -0.08, -0.08), V3(0.12, -0.08, -0.08)]), at(wm, 0, 0.3, 0), [0.35, 0.25, 0.18]);
    const ch = mat(-16.75, y0, cz + 0.4, -Math.PI / 2 + 0.4);
    bbox(wood, at(ch, 0, 0.45, 0), 0.42, 0.05, 0.4, 0.8, 0.5);
    bgeo(batch.get('plush'), chamferBox(0.38, 0.06, 0.36, 0.02), at(ch, 0, 0.5, 0), 0.9);
    for (const [a, b] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) bbox(wood, at(ch, a, 0.22, b), 0.03, 0.44, 0.03, 0.8, 0.3);
    bbox(wood, at(ch, 0, 0.8, 0.18), 0.4, 0.4, 0.03, 0.8, 0.5);
  } else {
    // a washstand: a basin, a pitcher and a small round mirror
    bgeo(batch.get('cream'), prism(0.2, 0.14, 0.09, 10), mat(cx, top + 0.045, cz), [0.9, 0.9, 0.92]);
    bgeo(batch.get('cream'), prism(0.06, 0.08, 0.22, 8), mat(cx + 0.12, top + 0.11, cz + 0.2), [0.85, 0.88, 0.9]);
    const mm = mat(-17.83, top + 0.75, cz, Math.PI / 2);
    bgeo(gilt, prism(0.26, 0.26, 0.03, 12), at(mm, 0, 0, 0.01, 0, Math.PI / 2), 0.9);
    atlasQuad(batch.get('silver'), at(mm, 0, 0, 0.03), 0.4, 0.4, [0, 0, 1, 1], 0.7);
  }
}

// A three-leaf folding screen with painted fabric panels.
function foldingScreen(batch, x, y, z, yaw) {
  const m = mat(x, y, z, yaw);
  const wood = batch.get('mahogany'), lin = batch.get('linen');
  const leaves = [[-0.55, 0.45], [0, 0], [0.55, -0.45]];
  for (const [ox, a] of leaves) {
    const lm = at(m, ox, 0, Math.abs(ox) * 0.25, a);
    bbox(lin, at(lm, 0, 1.0, 0), 0.5, 1.5, 0.02, [0.75, 0.62, 0.45], 1);
    for (const fx of [-0.26, 0.26]) bbox(wood, at(lm, fx, 0.9, 0), 0.04, 1.8, 0.04, 0.8, 0.5);
    for (const fy of [0.22, 1.78]) bbox(wood, at(lm, 0, fy, 0), 0.54, 0.05, 0.04, 0.8, 0.5);
  }
  // a costume flung over it
  bgeo(batch.get('plush'), hull([V3(-0.3, 0, -0.1), V3(0.3, 0, -0.1), V3(-0.3, 0, 0.1), V3(0.3, 0, 0.1), V3(-0.25, -0.6, 0.12), V3(0.2, -0.7, 0.14), V3(-0.2, -0.4, -0.12)]), at(m, 0.1, 1.85, 0.02), [0.6, 0.7, 1.1]);
}

// A dress form on a tripod stand.
function dressForm(batch, x, y, z, yaw) {
  const m = mat(x, y, z, yaw);
  const dark = batch.get('dark');
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; beam(dark, at(m, 0, 0.5, 0).elements.slice(12, 15), at(m, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3).elements.slice(12, 15), 0.025, 0.025, 0.8, 0.2); }
  beam(dark, at(m, 0, 0.5, 0).elements.slice(12, 15), at(m, 0, 1.0, 0).elements.slice(12, 15), 0.025, 0.025, 0.8, 0.2);
  bgeo(batch.get('linen'), hull([V3(-0.17, 0, -0.12), V3(0.17, 0, -0.12), V3(-0.17, 0, 0.12), V3(0.17, 0, 0.12), V3(-0.13, 0.25, -0.1), V3(0.13, 0.25, -0.1), V3(-0.16, 0.25, 0.1), V3(0.16, 0.25, 0.1), V3(-0.2, 0.55, -0.1), V3(0.2, 0.55, -0.1), V3(-0.18, 0.55, 0.13), V3(0.18, 0.55, 0.13), V3(0, 0.66, 0)]), at(m, 0, 1.0, 0), [0.62, 0.52, 0.4]);
  // half a gown pinned to it
  bgeo(batch.get('plush'), hull([V3(-0.18, 0.2, 0.08), V3(0.18, 0.2, 0.08), V3(-0.14, 0.45, 0.13), V3(0.14, 0.45, 0.13), V3(-0.32, -0.45, 0.2), V3(0.3, -0.45, 0.22), V3(0, -0.45, -0.1)]), at(m, 0, 1.0, 0), [0.45, 0.6, 1.05]);
}

function buildDressing(batch, R) {
  const Y = UP_Y;
  trim(batch, [-17.85, -7.85, -12.15, 5.85], ['x0', 'x1', 'z0', 'z1'], { y: Y, dado: 0, top: 6.6, skirt: 'woodWall', cornice: false });
  trim(batch, [-17.85, -23.85, -12.15, -8.15], ['x0', 'x1', 'z0', 'z1'], { y: Y, dado: 0, top: 6.6, skirt: 'woodWall', cornice: false });
  // a picture rail round both rooms
  for (const r of [[-17.85, -7.85, -12.15, 5.85], [-17.85, -23.85, -12.15, -8.15]]) for (const s of ['x0', 'x1', 'z0', 'z1']) runMoulding(batch.get('woodWall'), r, s, 6.2, [[0.05, 0.04]], 0.7);
  const vans = furniture('vanity');
  vans.forEach((p) => vanity(batch, p, R, p.solid[5] - p.solid[2] > 1.5));
  for (const p of furniture('trunk')) trunk(batch, p.solid, R);
  // The wardrobe rail: two wooden ends, a rail both sides full of costumes, hatboxes on top.
  for (const p of furniture('rack')) {
    const [x0, y0, z0, x1, , z1] = p.solid;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = z1 - z0;
    const m = mat(cx, y0, cz, Math.PI / 2);
    const wood = batch.get('mahogany');
    const D = x1 - x0;
    for (const s of [-1, 1]) {
      // an open end frame: two posts, a foot and a cross-rail, with a mirror on one end
      for (const zz of [-D / 2 + 0.04, D / 2 - 0.04]) bbox(wood, at(m, s * (L / 2 - 0.04), 0.86, zz), 0.06, 1.72, 0.06, 0.8, 1);
      bbox(wood, at(m, s * (L / 2 - 0.04), 0.04, 0), 0.1, 0.08, D + 0.04, 0.6, 1);
      bbox(wood, at(m, s * (L / 2 - 0.04), 1.1, 0), 0.05, 0.05, D, 0.7, 1);
      if (s > 0) atlasQuad(batch.get('silver'), at(m, L / 2 + 0.0, 0.62, 0, Math.PI / 2), D - 0.2, 0.9, [0, 0, 1, 1], 0.7);
    }
    bbox(wood, at(m, 0, 1.72, 0), L, 0.04, x1 - x0, 0.8, 1);
    for (const side of [-0.25, 0.25]) costumeRail(batch, at(m, 0, 0, side), L - 0.2, 1.6, R, COSTUME_COLORS);
    for (let k = 0; k < 4; k++) {
      const hb = prism(0.18, 0.18, 0.2, 8);
      bgeo(batch.get('linen'), hb, at(m, -L / 2 + 0.4 + k * 0.7, 1.84 + (k % 2) * 0.2, (R() - 0.5) * 0.2), [[0.8, 0.5, 0.45], [0.5, 0.6, 0.8], [0.85, 0.8, 0.6]][k % 3]);
    }
  }
  // The rails round the wing stairwell: plain iron pipe on posts.
  const dark = batch.get('dark');
  for (const z of [-18.05, -19.65]) {
    beam(dark, [-16.2, Y + 1.0, z], [-12.15, Y + 1.0, z], 0.05, 0.05, 0.8, 0.3);
    beam(dark, [-16.2, Y + 0.5, z], [-12.15, Y + 0.5, z], 0.035, 0.035, 0.8, 0.3);
    for (let x = -16.15; x <= -12.2; x += 1.0) beam(dark, [x, Y, z], [x, Y + 1.0, z], 0.045, 0.045, 0.8, 0.3);
  }
  // A folding screen, a dress form, a bench and hooks with coats.
  foldingScreen(batch, -12.8, Y, 5.0, -2.4);
  dressForm(batch, -17.3, Y, -20.4, 0.8);
  dressForm(batch, -12.7, Y, -10.2, -2.2);
  const bm = mat(-12.45, Y, -5.6, Math.PI / 2);
  bbox(batch.get('woodWall'), at(bm, 0, 0.42, 0), 1.4, 0.05, 0.36, 0.75, 1);
  for (const s of [-1, 1]) bbox(batch.get('woodWall'), at(bm, s * 0.62, 0.2, 0), 0.05, 0.4, 0.34, 0.7, 0.5);
  for (let k = 0; k < 5; k++) {
    const hz = -22.9 + k * 0.28;
    bbox(dark, mat(-12.18, Y + 1.75, hz), 0.08, 0.03, 0.03, 0.8, 0.2);
    if (k % 2 === 0) bgeo(batch.get('linen'), hull([V3(0, 0, -0.12), V3(0, 0, 0.12), V3(-0.1, -0.9, -0.2), V3(-0.12, -0.9, 0.2), V3(-0.06, -0.4, 0)]), mat(-12.2, Y + 1.72, hz), COSTUME_COLORS[(k + 2) % COSTUME_COLORS.length][1]);
  }
  // A gold star on the partition by the Spark Gate's doorway; bills on the walls.
  const star = [];
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + Math.PI / 2, r = k % 2 ? 0.11 : 0.26; star.push(V3(Math.cos(a) * r, Math.sin(a) * r, 0.02), V3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
  bgeo(batch.get('gilt'), hull(star), mat(-12.9, Y + 2.85, -7.83), 1.1);
  atlasQuad(batch.get('signs'), mat(-12.16, Y + 1.5, -15.9, -Math.PI / 2), 0.9, 0.6, signRect(SIGNS.bill), 0.8);
  atlasQuad(batch.get('posters'), mat(-17.84, Y + 1.5, -9.8, Math.PI / 2), 0.6, 0.9, posterRect(5), 0.75);
  atlasQuad(batch.get('signs'), mat(-12.16, Y + 1.8, 2.8, -Math.PI / 2), 0.4, 0.6, signRect(SIGNS.cast), 0.8);
  litter(batch, [-17.6, -23.6, -12.4, 5.6], Y, 22, R, ['paper', 'linen']);
}

// --- The cellar passage under the dressing rooms ---------------------------------------------------------

function buildCellar(batch, R) {
  const metal = batch.get('rust'), dark = batch.get('dark');
  // Pipes along the ceiling and down the walls.
  for (const [x, y, r] of [[-12.5, 3.1, 0.09], [-12.75, 3.15, 0.06], [-17.5, 3.05, 0.12]]) {
    const g = prism(r, r, 29.6, 8);
    g.rotateX(Math.PI / 2);
    bgeo(metal, g, mat(x, y, -9.1), 0.7);
    for (let z = -23; z < 5; z += 2.5) bbox(dark, mat(x, y + r + 0.08, z), 0.04, 0.16, 0.04, 0.8, 0.2);
  }
  bgeo(metal, prism(0.12, 0.12, 3.1, 8), mat(-17.5, 1.55, -6.5), 0.7);
  // An old boiler at the south end, broken seats and crates stacked along the west wall.
  const boiler = prism(0.7, 0.7, 2.0, 10);
  boiler.rotateX(Math.PI / 2);
  bgeo(metal, boiler, mat(-16.6, 0.8, 3.5), 0.65);
  bgeo(dark, prism(0.14, 0.14, 2.4, 8), mat(-16.6, 2.4, 4.2), 0.8);
  crateStack(batch, [-17.8, 0, -8.2, -16.6, 1.3, -6.8], R);
  crateStack(batch, [-17.8, 0, -14.6, -16.8, 1.0, -13.2], R);
  for (let k = 0; k < 8; k++) {
    const m = mat(-17.3 + (R() - 0.5) * 0.4, 0.2 + k * 0.12, -11.8 + (R() - 0.5) * 0.4, R() * 0.6, (R() - 0.5) * 0.4, (R() - 0.5) * 0.3);
    bbox(batch.get('plush'), m, 0.5, 0.08, 0.48, 0.5, 0.5);
    bbox(dark, at(m, 0.26, 0.2, 0), 0.03, 0.5, 0.44, 0.6, 0.3);
  }
  // Rubble and a coal heap.
  const dirt = batch.get('dirt');
  for (let k = 0; k < 14; k++) bgeo(dirt, rubble(0.2 + R() * 0.4, 0.1 + R() * 0.2, 0.2 + R() * 0.4), mat(-17.4 + R() * 1.4, 0.05, -22 + R() * 26, R() * TAU, (R() - 0.5) * 0.4), 0.6);
  bgeo(dark, hull([V3(-1, 0, -0.9), V3(1, 0, -0.9), V3(-1, 0, 0.9), V3(1, 0, 0.9), V3(-0.2, 0.7, 0.1), V3(0.3, 0.6, -0.2)]), mat(-16.7, 0, -20.5), 0.7);
}

export function* buildRooms(ctx) {
  const R = rng(1958), batch = ctx.batch;
  buildFoyer(batch, R);
  yield;
  buildStairHall(ctx, batch, R);
  yield;
  buildBoxOffice(batch, R);
  yield;
  buildDressing(batch, R);
  yield;
  buildCellar(batch, R);
}
