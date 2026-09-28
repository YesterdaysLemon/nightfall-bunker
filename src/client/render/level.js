// The bunker: shell, windows + barricades, doors/debris, stairs, furniture,
// wall buys, mystery box and bulbs.

import * as THREE from 'three';
import {
  T, LOFT_Y, ROOF_Y, SLAB_BOTTOM, BX0, BX1, BZ0, BZ1, IX0, IX1, IZ0, IZ1,
  WINDOWS, MAX_BOARDS, DOORS, WALL_BUYS, MYSTERY_BOX, STAIRS, STAIR_HOLES, FURNITURE, LIGHTS, BALCONY,
  RADIO, buildStaticBoxes, stairFootprint,
} from '../../shared/map.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Batch, mat, rng } from './geo.js';
import { drawChalkWeapon, drawChalkLabel, drawWallScrawl } from './chalk.js';
import { buildWeaponModel } from './weapons3d.js';

const EPS = 0.01;

// --- Faceted prop geometry (art/STYLE.md: sharp planes, hard normals) --------------
// Every helper returns a non-indexed, flat-shaded geometry with planar UVs taken
// per face along its dominant axis, like GeoBuilder.tbox: `fit` is metres per
// texture repeat along x, y and z (a crate uses its own size: one page a face).

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function planarUV(g, fit = [1, 1, 1]) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k) / fit[0], y = p.getY(k) / fit[1], z = p.getZ(k) / fit[2];
      const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
      uv[k * 2] = u + 0.5;
      uv[k * 2 + 1] = v + 0.5;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Hard-edged convex hull of points, planar-mapped. */
export function hull(points, fit) {
  return planarUV(new ConvexGeometry(points), fit);
}

/** Box with 45-degree chamfers on every edge (44 triangles). */
export function chamferBox(sx, sy, sz, b = 0.03, fit = [1, 1, 1]) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  b = Math.min(b, hx * 0.9, hy * 0.9, hz * 0.9);
  const pts = [];
  for (const X of [-1, 1]) {
    for (const Y of [-1, 1]) {
      for (const Z of [-1, 1]) pts.push(V3(X * (hx - b), Y * hy, Z * hz), V3(X * hx, Y * (hy - b), Z * hz), V3(X * hx, Y * hy, Z * (hz - b)));
    }
  }
  return hull(pts, fit);
}

/** A prism of `n` flat sides along y (legs, dials, bottles, wheels, barrels). */
export function prism(rTop, rBot, h, n = 6, fit = [1, 1, 1], rot = Math.PI / n) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, n, 1, false, rot);
  return planarUV(g, fit);
}

/** A faceted sack: hexagonal rings pinched at the tied ends, flat underneath. */
export function sackGeo(sx, sy, sz, R) {
  const pts = [];
  for (const [t, pinch] of [[-0.5, 0.5], [-0.3, 0.92], [0.05, 1], [0.32, 0.9], [0.5, 0.55]]) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + (R() - 0.5) * 0.35;
      const y = Math.max(-0.42, Math.sin(a) * 0.5) * (1 + (R() - 0.5) * 0.12);
      const z = Math.cos(a) * 0.5 * (1 + (R() - 0.5) * 0.12);
      pts.push(V3((t + (R() - 0.5) * 0.04) * sx, y * sy * (pinch * 0.6 + 0.4), z * sz * pinch));
    }
  }
  const g = hull(pts, [sx, sy, sz]);
  g.translate(0, 0.04 * sy, 0);
  return g;
}

/** A plank with slanted saw-cut ends and chamfered long edges, in unit space. */
function plankGeo(R) {
  const pts = [];
  for (const end of [-1, 1]) {
    const slant = (R() - 0.5) * 0.06;
    for (const [y, z] of [[-0.5, -0.3], [-0.5, 0.3], [0.5, -0.3], [0.5, 0.3], [-0.32, -0.5], [-0.32, 0.5], [0.32, -0.5], [0.32, 0.5]]) {
      pts.push(V3(end * 0.5 + slant * y - (end > 0 ? 0.02 : -0.02) * (y > 0 ? 1 : 0), y, z));
    }
  }
  return hull(pts, [1, 1, 1]);
}

function lambert(map, extra = {}) {
  return new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
}

export function makeMaterials(tex) {
  return {
    brick: lambert(tex.brick),
    plaster: lambert(tex.plaster),
    woodWall: lambert(tex.woodWall),
    floorBoards: lambert(tex.floorBoards),
    ceiling: lambert(tex.ceiling),
    concrete: lambert(tex.concrete),
    crate: lambert(tex.crate),
    metal: lambert(tex.metal),
    rust: lambert(tex.rust),
    sandbag: lambert(tex.sandbag),
    fabric: lambert(tex.uniform),
    paper: lambert(tex.paper),
    dirt: lambert(tex.dirt),
    tarmac: lambert(tex.tarmac),
    bark: lambert(tex.bark),
    dark: new THREE.MeshLambertMaterial({ color: 0x151515, vertexColors: true }),
    glass: new THREE.MeshLambertMaterial({ color: 0x223040, transparent: true, opacity: 0.45, vertexColors: true }),
    // Dial lamps and meter faces: painted light that does not need a bulb.
    lamp: new THREE.MeshBasicMaterial({ color: 0xd8a45a, vertexColors: true }),
  };
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function wallShade(x, y, z, f) {
  if (f === 2) return 0.9;
  if (f === 3) return 0.55;
  const base = y >= LOFT_Y - EPS ? LOFT_Y : 0;
  const top = base ? ROOF_Y : SLAB_BOTTOM;
  return (0.42 + 0.58 * smooth(0, 1.5, y - base)) * (1 - 0.3 * smooth(top - 0.9, top, y));
}

function extShade(x, y) { return 0.45 + 0.55 * smooth(0, 2.2, y); }

function isExteriorFace(b, f) {
  const cx = f === 0 ? b[3] : f === 1 ? b[0] : (b[0] + b[3]) / 2;
  const cz = f === 4 ? b[5] : f === 5 ? b[2] : (b[2] + b[5]) / 2;
  return cx <= BX0 - T / 2 + EPS || cx >= BX1 + T / 2 - EPS || cz <= BZ0 - T / 2 + EPS || cz >= BZ1 + T / 2 - EPS;
}

export class Level {
  constructor(rig, textures) {
    this.rig = rig;
    this.tex = textures;
    this.mats = makeMaterials(textures);
    this.group = new THREE.Group();
    this.group.name = 'level';
    rig.scene.add(this.group);
    this.anims = [];
    this.time = 0;

    const batch = new Batch(this.mats);
    this.buildShell(batch);
    this.buildTrim(batch);
    this.buildStairRails(batch);
    this.buildFurniture(batch);
    this.buildBalcony(batch);
    this.buildBeams(batch);
    for (const m of batch.meshes()) this.group.add(m);

    this.buildWindows();
    this.buildDoors();
    this.buildWallBuys();
    this.buildBox();
    this.buildBulbs();
    this.buildDecals();
  }

  // --- Shell ----------------------------------------------------------------------
  buildShell(batch) {
    for (const { b, tag } of buildStaticBoxes()) {
      if (tag === 'rail' || tag === 'prop') continue;
      const alongX = b[3] - b[0] > b[5] - b[2];
      for (let f = 0; f < 6; f++) {
        const up = f === 2, down = f === 3;
        let key = null, scale = 2.5, shade = wallShade;
        switch (tag) {
          case 'ext':
            if (up || down) { key = 'concrete'; scale = 3; break; }
            if (isExteriorFace(b, f)) { key = 'brick'; scale = 2; shade = extShade; break; }
            if ((alongX && f < 2) || (!alongX && f >= 4)) { key = 'concrete'; scale = 3; break; }
            key = b[1] >= LOFT_Y - EPS ? 'woodWall' : 'plaster'; scale = b[1] >= LOFT_Y - EPS ? 2.4 : 4.5;
            break;
          case 'int':
            key = up ? 'concrete' : (f >= 4 ? 'woodWall' : 'plaster'); scale = 4.5;
            break;
          case 'loftwall': key = 'woodWall'; scale = 2.4; break;
          case 'floor0': if (up) { key = 'floorBoards'; shade = () => 0.85; } break;
          case 'slab':
            key = up ? 'floorBoards' : down ? 'ceiling' : 'woodWall';
            shade = up ? () => 0.85 : down ? () => 0.55 : wallShade;
            break;
          case 'roof':
            key = down ? 'ceiling' : 'concrete'; scale = down ? 2.5 : 4;
            shade = down ? () => 0.5 : (x, y) => (up ? 0.8 : 0.7);
            break;
          case 'step':
            if (down) break;
            key = up ? 'floorBoards' : 'woodWall'; scale = up ? 1.5 : 2;
            shade = up ? () => 0.85 : (x, y) => 0.55 + 0.3 * smooth(0, 3, y);
            break;
          case 'pillar': if (!up && !down) { key = 'woodWall'; scale = 1.2; } break;
          default: key = 'concrete';
        }
        if (key) batch.get(key).boxFace(b, f, scale, shade);
      }
    }
  }

  // Window frames, door frame, skirting.
  buildTrim(batch) {
    const g = batch.get('woodWall');
    for (const w of WINDOWS) {
      const [nx, nz] = w.n;
      const tx = -nz, tz = nx;
      const hw = w.width / 2;
      const inner = -(T / 2 + 0.03); // along normal, inside face
      const put = (along, y, depth, sa, sy, sd) => {
        const cx = w.x + tx * along + nx * depth, cz = w.z + tz * along + nz * depth;
        const m = mat(cx, y, cz, Math.atan2(nx, nz));
        g.tbox(m, sa, sy, sd, 0.55, 1);
      };
      put(0, w.sill - 0.03, inner + 0.02, w.width + 0.3, 0.07, 0.14); // sill
      put(0, w.top + 0.05, inner, w.width + 0.3, 0.1, 0.06);          // head
      put(-hw - 0.06, (w.sill + w.top) / 2, inner, 0.1, w.top - w.sill + 0.2, 0.06);
      put(hw + 0.06, (w.sill + w.top) / 2, inner, 0.1, w.top - w.sill + 0.2, 0.06);
    }
    // Door frame (interior partition).
    const d = DOORS[0].box;
    for (const side of [d[0] - 0.02, d[3] + 0.02]) {
      g.tbox(mat(side, 1.25, d[2] - 0.06, 0), 0.06, 2.5, 0.12, 0.5, 1);
      g.tbox(mat(side, 1.25, d[5] + 0.06, 0), 0.06, 2.5, 0.12, 0.5, 1);
      g.tbox(mat(side, 2.45, (d[2] + d[5]) / 2, 0), 0.06, 0.12, d[5] - d[2] + 0.24, 0.5, 1);
    }
  }

  buildStairRails(batch) {
    const g = batch.get('woodWall');
    for (const s of STAIRS) {
      const [x0, z0, x1, z1] = stairFootprint(s);
      const side = s.a0 < 0 ? z1 + 0.05 : z0 - 0.05;
      const run = s.steps * s.run;
      const yAt = (x) => (s.dir > 0 ? (x - s.start) : (s.start - x)) / run * LOFT_Y;
      // balusters
      for (let x = x0 + 0.15; x < x1; x += 0.3) {
        const top = yAt(x) + 0.2;
        g.tbox(mat(x, top + 0.45, side, 0), 0.05, 0.9, 0.05, 0.5, 1);
      }
      // sloped handrail
      const len = Math.hypot(run, LOFT_Y);
      const ang = Math.atan2(LOFT_Y, run) * s.dir;
      const mx = (x0 + x1) / 2;
      const hm = new THREE.Matrix4().compose(
        new THREE.Vector3(mx, yAt(mx) + 1.1, side),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)),
        new THREE.Vector3(1, 1, 1),
      );
      g.tbox(hm, len + 0.2, 0.08, 0.09, 0.6, 1);
      // newel post at the bottom
      const bx = s.dir > 0 ? x0 : x1;
      g.geo(chamferBox(0.12, 1.2, 0.12, 0.025), mat(bx, 0.6, side), 0.45);
      g.geo(hull([V3(-0.07, 0, -0.07), V3(0.07, 0, -0.07), V3(-0.07, 0, 0.07), V3(0.07, 0, 0.07), V3(0, 0.08, 0)]), mat(bx, 1.2, side), 0.55);
    }
    // Loft railings around the stairwell holes.
    const railRun = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bx - ax, bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      g.tbox(mat(cx, LOFT_Y + 1.0, cz, yaw), 0.08, 0.08, len, 0.6, 1);
      g.tbox(mat(cx, LOFT_Y + 0.5, cz, yaw), 0.05, 0.05, len, 0.6, 1);
      const n = Math.max(1, Math.round(len / 0.9));
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        g.tbox(mat(ax + (bx - ax) * u, LOFT_Y + 0.5, az + (bz - az) * u, 0), 0.08, 1.0, 0.08, 0.5, 1);
      }
    };
    const [ax0, az0, ax1, az1] = STAIR_HOLES[0];
    railRun(ax0 - 0.05, az0 - 0.05, ax1, az0 - 0.05);
    railRun(ax0 - 0.05, az0 - 0.05, ax0 - 0.05, az1);
    const [bx0, bz0, bx1, bz1] = STAIR_HOLES[1];
    railRun(bx0, bz1 + 0.05, bx1 + 0.05, bz1 + 0.05);
    railRun(bx1 + 0.05, bz0, bx1 + 0.05, bz1 + 0.05);
  }

  buildBeams(batch) {
    const g = batch.get('woodWall');
    for (let x = IX0 + 1.6; x < IX1; x += 3.2) {
      if (STAIR_HOLES.some((h) => x > h[0] - 0.2 && x < h[2] + 0.2)) {
        // split beam around the hole
        for (const h of STAIR_HOLES) {
          if (x > h[0] - 0.2 && x < h[2] + 0.2) {
            const segs = [[IZ0, h[1]], [h[3], IZ1]].filter(([a, b]) => b - a > 0.3);
            for (const [a, b] of segs) g.geo(chamferBox(0.24, 0.22, b - a, 0.035), mat(x, SLAB_BOTTOM - 0.11, (a + b) / 2), 0.35);
          }
        }
      } else {
        g.geo(chamferBox(0.24, 0.22, IZ1 - IZ0, 0.035), mat(x, SLAB_BOTTOM - 0.11, 0), 0.35);
      }
      g.geo(chamferBox(0.26, 0.26, IZ1 - IZ0, 0.04), mat(x, ROOF_Y - 0.13, 0), 0.35);
    }
    g.geo(chamferBox(IX1 - IX0, 0.3, 0.3, 0.045), mat((IX0 + IX1) / 2, ROOF_Y - 0.15, 0), 0.3);
  }

  buildBalcony(batch) {
    const B = BALCONY;
    const w = batch.get('woodWall');
    const f = batch.get('floorBoards');
    f.box([B.x0, B.y - 0.2, B.z0, B.x1, B.y, B.z1], 1.5, (x, y, z, face) => (face === 2 ? 0.75 : 0.45));
    for (let x = B.x0 + 0.1; x <= B.x1; x += 3) {
      w.tbox(mat(x, (B.y - 0.2) / 2, B.z0 + 0.12, 0), 0.2, B.y - 0.2, 0.2, 0.45, 1);
    }
    w.tbox(mat(B.x1 - 0.1, (B.y - 0.2) / 2, B.z0 + 0.12, 0), 0.2, B.y - 0.2, 0.2, 0.45, 1);
    // railing
    w.tbox(mat((B.x0 + B.x1) / 2, B.y + 1.0, B.z0 + 0.05, 0), B.x1 - B.x0, 0.08, 0.08, 0.55, 1);
    for (let x = B.x0 + 0.05; x <= B.x1; x += 1.0) w.tbox(mat(x, B.y + 0.5, B.z0 + 0.05, 0), 0.07, 1.0, 0.07, 0.5, 1);
    // ladders at both ends
    for (const lx of [B.x0 + 0.5, B.x1 - 0.5]) {
      for (const dx of [-0.25, 0.25]) w.tbox(mat(lx + dx, B.y / 2 + 0.3, B.z0 - 0.12, 0, -0.08), 0.06, B.y + 0.9, 0.06, 0.45, 1);
      for (let y = 0.3; y < B.y + 0.6; y += 0.32) w.tbox(mat(lx, y, B.z0 - 0.12, 0), 0.5, 0.04, 0.05, 0.5, 1);
    }
  }

  buildFurniture(batch) {
    const R = rng(99);
    const wood = batch.get('woodWall');
    const crate = batch.get('crate');
    const metal = batch.get('metal');
    const fabric = batch.get('fabric');
    const sand = batch.get('sandbag');
    const paper = batch.get('paper');
    const dark = batch.get('dark');
    const glass = batch.get('glass');
    const lamp = batch.get('lamp');
    // Tapered square legs, turned 45 degrees so two facets catch the bulb.
    const leg = (g, x, y0, y1, z, r = 0.035, c = 0.5) => g.geo(prism(r * 0.8, r, y1 - y0, 4), mat(x, (y0 + y1) / 2, z), c);
    const table = (b, top = 0.06) => {
      const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2], h = b[4] - b[1];
      wood.geo(chamferBox(sx, top, sz, 0.02), mat(cx, b[1] + h - top / 2, cz), 0.75);
      // apron under the top
      for (const oz of [-1, 1]) wood.tbox(mat(cx, b[1] + h - top - 0.05, cz + oz * (sz / 2 - 0.07), 0), sx - 0.2, 0.1, 0.03, 0.45, 1);
      for (const ox of [-1, 1]) wood.tbox(mat(cx + ox * (sx / 2 - 0.07), b[1] + h - top - 0.05, cz, 0), 0.03, 0.1, sz - 0.2, 0.45, 1);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        leg(wood, cx + ox * (sx / 2 - 0.07), b[1], b[1] + h - top, cz + oz * (sz / 2 - 0.07), 0.04, 0.5);
      }
    };
    const chair = (x, y, z, yaw, fallen) => {
      const base = mat(x, y, z, yaw, 0, fallen ? Math.PI / 2 : 0);
      const lift = fallen ? 0.22 : 0;
      const at = (ox, oy, oz) => base.clone().multiply(mat(ox, oy + lift, oz));
      wood.geo(chamferBox(0.45, 0.05, 0.45, 0.015), at(0, 0.45, 0), 0.6);
      for (const [ox, oz] of [[-0.19, 0.19], [0.19, 0.19]]) wood.geo(prism(0.02, 0.025, 0.45, 4), at(ox, 0.22, oz), 0.5);
      // back legs run up into the back posts, with two slats between them
      for (const ox of [-0.19, 0.19]) wood.geo(prism(0.02, 0.026, 1.0, 4), at(ox, 0.5, -0.19), 0.55);
      wood.tbox(at(0, 0.88, -0.2), 0.4, 0.1, 0.03, 0.65, 1);
      wood.tbox(at(0, 0.66, -0.2), 0.4, 0.06, 0.03, 0.55, 1);
      wood.tbox(at(0, 0.12, 0), 0.38, 0.025, 0.025, 0.4, 1);
    };
    for (const p of FURNITURE) {
      const b = p.solid;
      switch (p.kind) {
        case 'table': {
          table(b);
          paper.tbox(mat(p.pos[0] + 0.1, 0.83, p.pos[2] - 0.2, 0.4), 0.3, 0.005, 0.4, 0.9, 0.3);
          metal.geo(prism(0.04, 0.035, 0.09, 6), mat(p.pos[0] - 0.25, 0.87, p.pos[2] + 0.3), 0.7); // tin mug
          break;
        }
        case 'radioTable': {
          table(b);
          const [x, y, z] = RADIO.pos;
          const r = mat(x, y, z, 0.15);
          const at = (ox, oy, oz, ry = 0, rx = 0, rz = 0) => r.clone().multiply(mat(ox, oy, oz, ry, rx, rz));
          // Field set: an olive steel case with a recessed face, dials, a lit
          // meter and a speaker grille, a carry handle and a whip aerial.
          metal.geo(chamferBox(0.56, 0.36, 0.3, 0.035), at(0, 0.18, 0), 0.8);
          dark.tbox(at(0, 0.19, 0.151), 0.46, 0.26, 0.012, 1, 1);
          for (let i = 0; i < 4; i++) metal.tbox(at(-0.14, 0.12 + i * 0.035, 0.16), 0.15, 0.012, 0.01, 0.35, 1);
          lamp.tbox(at(0.03, 0.25, 0.159), 0.11, 0.06, 0.004, 1, 1);
          dark.tbox(at(0.03, 0.235, 0.162), 0.004, 0.045, 0.004, 1, 1);
          for (const [dx, dy, rad] of [[0.16, 0.25, 0.035], [0.16, 0.13, 0.03], [0.05, 0.12, 0.022]]) {
            metal.geo(prism(rad, rad * 1.1, 0.03, 8), at(dx, dy, 0.165, 0, Math.PI / 2), 1.1);
            dark.tbox(at(dx, dy + rad * 0.55, 0.182), 0.008, rad * 0.8, 0.004, 1, 1);
          }
          for (const ox of [-0.12, 0.12]) metal.tbox(at(ox, 0.39, 0), 0.03, 0.06, 0.03, 0.6, 1);
          metal.tbox(at(0, 0.425, 0), 0.28, 0.025, 0.035, 0.7, 1);
          dark.geo(prism(0.006, 0.01, 0.9, 4), at(0.24, 0.8, -0.1, 0, 0, -0.12), 1);
          metal.geo(prism(0.018, 0.018, 0.05, 6), at(0.24, 0.38, -0.1), 0.6);
          // the handset, lying beside it
          dark.geo(chamferBox(0.2, 0.045, 0.06, 0.015), mat(x - 0.45, y + 0.025, z + 0.1, 0.9), 1);
          break;
        }
        case 'crates': {
          const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
          const s = Math.min(b[3] - b[0], b[5] - b[2]) * 0.55;
          const box = (sx, sy, sz, m, c) => crate.geo(chamferBox(sx, sy, sz, 0.03, [sx, sy, sz]), m, c);
          box(s, s, s, mat(cx - s * 0.35, b[1] + s / 2, cz - s * 0.3, p.yaw), 0.8);
          box(s, s, s, mat(cx + s * 0.4, b[1] + s / 2, cz + s * 0.35, p.yaw + 0.4), 0.7);
          box(s * 0.9, s, s * 0.9, mat(cx - s * 0.1, b[1] + s * 1.5, cz, p.yaw + 0.2), 0.9);
          break;
        }
        case 'chair': chair(p.pos[0], p.pos[1], p.pos[2], p.yaw, false); break;
        case 'chairFallen': chair(p.pos[0], p.pos[1], p.pos[2], p.yaw, true); break;
        case 'shelf': {
          const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2];
          for (const y of [0.1, 0.65, 1.2, 1.75]) wood.geo(chamferBox(sx, 0.04, sz, 0.012), mat(cx, y, cz), 0.55);
          for (const oz of [-1, 1]) wood.tbox(mat(cx, 1.0, cz + oz * (sz / 2 - 0.03), 0), sx, 2.0, 0.04, 0.4, 1);
          for (let i = 0; i < 14; i++) {
            const y = [0.12, 0.67, 1.22][i % 3];
            const h = 0.12 + R() * 0.18;
            const r = 0.03 + R() * 0.015;
            const g = R() < 0.5 ? glass : dark;
            const bx = cx + (R() - 0.5) * sx * 0.6, bz = cz + (R() - 0.5) * (sz - 0.3);
            g.geo(prism(r, r, h, 6), mat(bx, y + h / 2, bz, R() * 3), 1);
            g.geo(prism(r * 0.35, r * 0.6, 0.06, 6), mat(bx, y + h + 0.03, bz), 1);
          }
          // a tin box and a folded cloth on the top shelf
          metal.geo(chamferBox(0.3, 0.14, 0.22, 0.02), mat(cx, 1.84, cz + 0.4, 0.2), 0.7);
          fabric.geo(chamferBox(0.35, 0.08, 0.28, 0.03), mat(cx, 1.81, cz - 0.35, -0.1), [0.62, 0.6, 0.52]);
          break;
        }
        case 'operatingTable': {
          const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2];
          metal.geo(chamferBox(sx, 0.06, sz, 0.02), mat(cx, 0.82, cz), 0.8);
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) leg(metal, cx + ox * (sx / 2 - 0.08), 0, 0.8, cz + oz * (sz / 2 - 0.08), 0.03, 0.6);
          metal.tbox(mat(cx, 0.25, cz, 0), sx - 0.2, 0.03, sz - 0.2, 0.5, 1);
          // a stained sheet, draped over the edges
          const hx = sx * 0.4, hz = sz * 0.48;
          fabric.geo(hull([
            V3(-hx, 0.06, -hz), V3(hx, 0.06, -hz), V3(-hx, 0.06, hz), V3(hx, 0.06, hz),
            V3(-hx - 0.06, -0.12, -hz - 0.05), V3(hx + 0.05, -0.1, -hz - 0.06), V3(-hx - 0.05, -0.14, hz + 0.06), V3(hx + 0.06, -0.1, hz + 0.05),
          ]), mat(cx + 0.2, 0.88, cz, 0.05), [0.75, 0.72, 0.66]);
          // an instrument tray at the head end
          metal.geo(chamferBox(0.26, 0.035, 0.42, 0.01), mat(b[0] + 0.22, 0.87, cz - 0.05, 0.08), 0.95);
          for (let i = 0; i < 3; i++) dark.tbox(mat(b[0] + 0.18 + i * 0.04, 0.892, cz - 0.05, 0.1 * i), 0.012, 0.008, 0.2, 1, 1);
          break;
        }
        case 'cabinet': {
          const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sz = b[5] - b[2];
          metal.geo(chamferBox(b[3] - b[0], b[4], sz, 0.03), mat(cx, b[4] / 2, cz), 0.7);
          // four drawer fronts, each with a pull and a label card
          for (let i = 0; i < 4; i++) {
            const y = 0.26 + i * 0.44;
            metal.geo(chamferBox(0.03, 0.38, sz * 0.84, 0.012), mat(b[3] + 0.012, y, cz), 0.85);
            dark.tbox(mat(b[3] + 0.04, y + 0.06, cz, 0), 0.025, 0.035, 0.16, 1, 1);
            paper.tbox(mat(b[3] + 0.029, y + 0.13, cz, 0), 0.004, 0.05, 0.1, 0.8, 0.2);
          }
          break;
        }
        case 'cot': {
          const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, sx = b[3] - b[0], sz = b[5] - b[2];
          for (const oz of [-1, 1]) metal.geo(prism(0.02, 0.02, sx, 4), mat(cx, b[1] + 0.3, cz + oz * (sz / 2 - 0.03), 0, 0, Math.PI / 2), 0.55);
          for (const ox of [-1, 1]) metal.geo(prism(0.02, 0.02, sz, 4), mat(cx + ox * (sx / 2 - 0.03), b[1] + 0.3, cz, 0, Math.PI / 2), 0.55);
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) leg(metal, cx + ox * (sx / 2 - 0.05), b[1], b[1] + 0.32, cz + oz * (sz / 2 - 0.05), 0.02, 0.5);
          fabric.geo(chamferBox(sx - 0.1, 0.12, sz - 0.1, 0.04), mat(cx, b[1] + 0.38, cz), [0.55, 0.52, 0.42]);
          // a rumpled blanket and a pillow
          const hx = sx * 0.26, hz = (sz - 0.05) / 2;
          fabric.geo(hull([
            V3(-hx, 0.04, -hz * 0.9), V3(hx, 0.05, -hz * 0.8), V3(-hx * 0.9, 0.06, hz * 0.95), V3(hx, 0.03, hz),
            V3(-hx - 0.04, -0.05, -hz - 0.03), V3(hx + 0.05, -0.05, -hz - 0.04), V3(-hx - 0.03, -0.05, hz + 0.04), V3(hx + 0.04, -0.05, hz + 0.03),
            V3(0.1, 0.09, 0.05),
          ]), mat(cx + sx * 0.18, b[1] + 0.46, cz + 0.02, 0.1), [0.35, 0.37, 0.3]);
          fabric.geo(sackGeo(0.3, 0.1, 0.45, R), mat(b[0] + 0.25, b[1] + 0.49, cz, 0.1), [0.7, 0.68, 0.6]);
          break;
        }
        case 'sandbags': {
          // Only the bags you can see: the outer skin and the top course.
          const sacks = [0, 1, 2, 3].map(() => sackGeo(0.6, 0.22, 0.38, R));
          const rows = [];
          for (let y = b[1] + 0.12; y < b[4]; y += 0.22) rows.push(y);
          rows.forEach((y, row) => {
            const xs = [], zs = [];
            for (let x = b[0] + 0.3 + (row % 2) * 0.3; x < b[3] - 0.2; x += 0.6) xs.push(x);
            for (let z = b[2] + 0.2; z < b[5] - 0.1; z += 0.4) zs.push(z);
            xs.forEach((x, i) => zs.forEach((z, j) => {
              const g = sacks[Math.floor(R() * sacks.length)];
              const yaw = (R() - 0.5) * 0.2 + (R() < 0.5 ? Math.PI : 0), roll = (R() - 0.5) * 0.08, c = 0.7 + R() * 0.2;
              const edge = row === rows.length - 1 || i === 0 || j === 0 || i === xs.length - 1 || j === zs.length - 1;
              if (edge) sand.geo(g, mat(x, y - 0.02, z, yaw, 0, roll), c);
            }));
          });
          break;
        }
        case 'desk': {
          table(b, 0.07);
          // typewriter: a sloped faceted body, the platen and a sheet in it
          const tm = mat(p.pos[0] - 0.2, b[4], p.pos[2] + 0.1, 0.2);
          dark.geo(hull([
            V3(-0.17, 0, -0.14), V3(0.17, 0, -0.14), V3(-0.17, 0, 0.15), V3(0.17, 0, 0.15),
            V3(-0.16, 0.05, 0.15), V3(0.16, 0.05, 0.15), V3(-0.16, 0.15, -0.1), V3(0.16, 0.15, -0.1), V3(-0.15, 0.15, -0.14), V3(0.15, 0.15, -0.14),
          ]), tm, 1);
          metal.geo(prism(0.028, 0.028, 0.42, 8), tm.clone().multiply(mat(0, 0.17, -0.1, 0, 0, Math.PI / 2)), 0.5);
          paper.tbox(tm.clone().multiply(mat(0, 0.24, -0.12, 0, -0.25)), 0.21, 0.15, 0.003, 0.9, 0.3);
          for (let i = 0; i < 4; i++) paper.tbox(mat(p.pos[0] + 0.3 + R() * 0.4, b[4] + 0.003 + i * 0.002, p.pos[2] + (R() - 0.5) * 0.4, R() * 2), 0.21, 0.003, 0.3, 0.85, 0.3);
          break;
        }
        default:
      }
    }
  }

  // --- Windows & barricades -------------------------------------------------------------
  buildWindows() {
    const geo = plankGeo(rng(12));
    const mat0 = new THREE.MeshLambertMaterial({ map: this.tex.plank });
    const n = WINDOWS.length * MAX_BOARDS;
    this.boards = new THREE.InstancedMesh(geo, mat0, n);
    this.boards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boards.frustumCulled = false;
    this.group.add(this.boards);
    const R = rng(7);
    this.slots = [];
    for (const w of WINDOWS) {
      const [nx, nz] = w.n;
      const yaw = Math.atan2(nx, nz);
      const out = T / 2 + 0.04;
      const list = [];
      for (let j = 0; j < MAX_BOARDS; j++) {
        const y = w.sill + 0.12 + (j / (MAX_BOARDS - 1)) * (w.top - w.sill - 0.24);
        const roll = (j % 2 ? 1 : -1) * (0.12 + R() * 0.28);
        const pos = new THREE.Vector3(w.x + nx * (out + j * 0.006), y, w.z + nz * (out + j * 0.006));
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, 'YXZ'));
        const scale = new THREE.Vector3(w.width + 0.35 + R() * 0.15, 0.17, 0.045);
        list.push({ pos, quat, scale, state: 1, t: 1, mode: 'idle', spin: R() * 2 - 1 });
      }
      this.slots.push({ w, list, count: MAX_BOARDS });
    }
    this.updateBoards(0, true);
  }

  setBoards(id, count) {
    const s = this.slots[id];
    if (!s || count === s.count) return;
    if (count < s.count) {
      for (let j = s.count - 1; j >= count; j--) Object.assign(s.list[j], { state: 0, t: 0, mode: 'break' });
    } else {
      for (let j = s.count; j < count; j++) Object.assign(s.list[j], { state: 1, t: 0, mode: 'fix' });
    }
    s.count = count;
    this.boardsDirty = true;
  }

  resetBoards(counts) {
    counts.forEach((c, id) => {
      const s = this.slots[id];
      if (!s) return;
      s.count = c;
      s.list.forEach((b, j) => Object.assign(b, { state: j < c ? 1 : 0, t: 1, mode: 'idle' }));
    });
    this.updateBoards(0, true);
  }

  updateBoards(dt, force = false) {
    if (!force && !this.boardsDirty) return;
    let active = false;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), spin = new THREE.Quaternion();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const X = new THREE.Vector3(1, 0, 0);
    let i = 0;
    for (const s of this.slots) {
      const [nx, nz] = s.w.n;
      for (const b of s.list) {
        if (b.mode !== 'idle') {
          b.t = Math.min(1, b.t + dt / (b.mode === 'break' ? 0.7 : 0.35));
          active = true;
          if (b.t >= 1) b.mode = 'idle';
        }
        if (b.state === 0 && b.mode === 'idle') {
          m.copy(zero);
        } else if (b.mode === 'break') {
          const t = b.t;
          p.set(nx * (0.3 + 2.2 * t), 0.4 * t - 3.5 * t * t, nz * (0.3 + 2.2 * t)).add(b.pos);
          spin.setFromAxisAngle(X, b.spin * t * 5);
          q.copy(b.quat).multiply(spin);
          m.compose(p, q, b.scale);
        } else if (b.mode === 'fix') {
          const t = 1 - Math.pow(1 - b.t, 3);
          p.set(-nx * (1 - t) * 1.2, -(1 - t) * 0.9, -nz * (1 - t) * 1.2).add(b.pos);
          m.compose(p, b.quat, b.scale);
        } else {
          m.compose(b.pos, b.quat, b.scale);
        }
        this.boards.setMatrixAt(i++, m);
      }
    }
    this.boards.instanceMatrix.needsUpdate = true;
    this.boardsDirty = active;
  }

  // --- Doors & debris ------------------------------------------------------------------
  buildDoors() {
    this.doorVis = new Map();
    const R = rng(21);
    for (const d of DOORS) {
      const g = new THREE.Group();
      const [x0, y0, z0, x1, y1, z1] = d.box;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const pieces = [];
      if (d.kind === 'door') {
        const leafW = (z1 - z0) / 2;
        for (const side of [-1, 1]) {
          // Pivot on the hinge; the leaf extends toward the doorway centre.
          const pivot = new THREE.Group();
          pivot.position.set(cx, 0, side < 0 ? z0 : z1);
          const dir = -side;
          for (let k = 0; k < 4; k++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, y1 - 0.02, leafW / 4 - 0.01), this.mats.woodWall);
            plank.geometry.setAttribute('color', whiteColors(plank.geometry, 0.55 + R() * 0.15));
            plank.position.set(0, (y1 - 0.02) / 2, dir * (k + 0.5) * (leafW / 4));
            pivot.add(plank);
          }
          for (const y of [0.45, 1.95]) {
            const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, leafW - 0.04), this.mats.metal);
            strap.geometry.setAttribute('color', whiteColors(strap.geometry, 0.4));
            strap.position.set(0, y, dir * leafW / 2);
            pivot.add(strap);
          }
          g.add(pivot);
          pieces.push({ obj: pivot, kind: 'leaf', side });
        }
        for (const face of [-1, 1]) g.add(this.chalkLabel(`${d.cost}`, cx + face * 0.06, 1.55, cz, face > 0 ? Math.PI / 2 : -Math.PI / 2, 0.8));
      } else {
        // Debris: broken planks, a crate, a chair, rubble.
        const sx = x1 - x0, sz = z1 - z0;
        for (let k = 0; k < 16; k++) {
          const m = new THREE.Mesh(chamferBox(0.12 + R() * 0.1, 0.05, 0.9 + R() * 1.1, 0.012), R() < 0.8 ? this.mats.woodWall : this.mats.metal);
          m.geometry.setAttribute('color', whiteColors(m.geometry, 0.35 + R() * 0.3));
          m.position.set(x0 + R() * sx, 0.1 + R() * 1.6, z0 + R() * sz);
          m.rotation.set((R() - 0.5) * 2.4, R() * 3, (R() - 0.5) * 2.4);
          g.add(m);
          pieces.push({ obj: m, kind: 'chunk', v: new THREE.Vector3((R() - 0.5) * 3, 2 + R() * 3, (R() - 0.5) * 3), s: (R() - 0.5) * 8 });
        }
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(chamferBox(0.6, 0.6, 0.6, 0.035, [0.6, 0.6, 0.6]), this.mats.crate);
          c.geometry.setAttribute('color', whiteColors(c.geometry, 0.6));
          c.position.set(cx + (R() - 0.5) * sx * 0.5, 0.3 + k * 0.45, cz + (R() - 0.5) * sz * 0.5);
          c.rotation.set((R() - 0.5) * 0.6, R() * 3, (R() - 0.5) * 0.6);
          g.add(c);
          pieces.push({ obj: c, kind: 'chunk', v: new THREE.Vector3((R() - 0.5) * 2, 1.5 + R() * 2, (R() - 0.5) * 2), s: (R() - 0.5) * 5 });
        }
        const lbl = d.use[0];
        const yaw = Math.atan2(lbl[0] - cx, lbl[2] - cz);
        g.add(this.chalkLabel(`${d.cost}`, cx + Math.sin(yaw) * 0.75, 1.1, cz + Math.cos(yaw) * 0.75, yaw, 0.7));
      }
      this.group.add(g);
      this.doorVis.set(d.id, { group: g, pieces, open: false, t: 0 });
    }
  }

  chalkLabel(text, x, y, z, yaw, w) {
    const tex = new THREE.CanvasTexture(drawChalkLabel(text, { width: 256, height: 128 }));
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xbdbab0 }));
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.userData.label = true;
    return m;
  }

  openDoor(id, instant = false) {
    const v = this.doorVis.get(id);
    if (!v || v.open) return;
    v.open = true;
    v.t = instant ? 2 : 0;
    for (const c of v.group.children) if (c.userData.label) c.visible = false;
    if (instant) v.group.visible = false;
  }

  updateDoors(dt) {
    for (const v of this.doorVis.values()) {
      if (!v.open || !v.group.visible) continue;
      v.t += dt;
      for (const p of v.pieces) {
        if (p.kind === 'leaf') {
          p.obj.rotation.y = -p.side * Math.min(1, v.t / 0.7) * 1.7;
          p.obj.position.y = -Math.max(0, v.t - 0.8) * 2.5;
        } else {
          p.v.y -= 12 * dt;
          p.obj.position.addScaledVector(p.v, dt);
          p.obj.rotation.x += p.s * dt;
        }
      }
      if (v.t > 1.6) v.group.visible = false;
    }
  }

  // --- Wall buys ------------------------------------------------------------------------
  buildWallBuys() {
    for (const wb of WALL_BUYS) {
      const tex = new THREE.CanvasTexture(drawChalkWeapon(wb.weapon));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.75),
        new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, emissive: 0x3a3a36, emissiveMap: tex, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      mesh.position.set(wb.pos[0] + wb.face[0] * 0.012, wb.pos[1], wb.pos[2] + wb.face[1] * 0.012);
      mesh.rotation.y = Math.atan2(wb.face[0], wb.face[1]);
      this.group.add(mesh);
    }
  }

  // --- Mystery box ----------------------------------------------------------------------------
  buildBox() {
    const B = MYSTERY_BOX;
    const [sx, sy, sz] = B.size;
    const g = new THREE.Group();
    g.position.set(B.pos[0], B.pos[1], B.pos[2]);
    // Body: a chamfered chest with iron bands, corner caps, rope handles and
    // squat feet, merged into two meshes.
    const chest = new THREE.MeshLambertMaterial({ map: this.tex.boxLid, emissive: 0x15181c, emissiveMap: this.tex.boxLid, vertexColors: true });
    const parts = new Batch({ ...this.mats, chest });
    const iron = parts.get('metal'), dark = parts.get('dark');
    parts.get('chest').geo(chamferBox(sx, sy - 0.04, sz, 0.04, [sx, sy - 0.04, sz]), mat(0, sy / 2 + 0.02, 0), 0.7);
    for (const x of [-sx / 2 + 0.14, sx / 2 - 0.14]) iron.geo(chamferBox(0.07, sy - 0.03, sz + 0.02, 0.012), mat(x, sy / 2 + 0.02, 0), 0.35);
    for (const X of [-1, 1]) {
      for (const Z of [-1, 1]) {
        iron.geo(chamferBox(0.1, 0.1, 0.1, 0.02), mat(X * (sx / 2 - 0.04), sy - 0.06, Z * (sz / 2 - 0.04)), 0.3);
        dark.geo(chamferBox(0.12, 0.05, 0.12, 0.015), mat(X * (sx / 2 - 0.08), 0.025, Z * (sz / 2 - 0.08)), 1);
      }
      dark.geo(prism(0.018, 0.018, 0.2, 6), mat(X * (sx / 2 + 0.03), sy * 0.62, 0, 0, Math.PI / 2), 1);
      for (const z of [-0.1, 0.1]) iron.tbox(mat(X * (sx / 2 + 0.015), sy * 0.62, z, 0), 0.03, 0.05, 0.03, 0.35, 1);
    }
    for (const m of parts.meshes()) g.add(m);
    const lid = new THREE.Group();
    lid.position.set(0, sy, sz / 2);
    const lidMat = new THREE.MeshLambertMaterial({ map: this.tex.boxLid, emissive: 0x2a2f38, emissiveMap: this.tex.boxLid, vertexColors: true });
    const lidGeo = chamferBox(sx + 0.04, 0.09, sz + 0.04, 0.03, [sx + 0.04, 0.4, sz + 0.04]);
    lidGeo.setAttribute('color', whiteColors(lidGeo, 1));
    const lidMesh = new THREE.Mesh(lidGeo, lidMat);
    lidMesh.position.set(0, 0.045, -sz / 2);
    lid.add(lidMesh);
    const hasp = new THREE.Mesh(chamferBox(0.08, 0.12, 0.03, 0.01), this.mats.metal);
    hasp.geometry.setAttribute('color', whiteColors(hasp.geometry, 0.35));
    hasp.position.set(0, -0.02, -sz - 0.035);
    lid.add(hasp);
    g.add(lid);
    // Beam of light rising from the box.
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, strength: { value: 0.5 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float strength;
        void main(){ float a = (1.0 - vUv.y) * (0.6 + 0.4 * sin(vUv.x * 40.0 + time * 2.0));
        a *= smoothstep(0.0, 0.08, vUv.y); gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * a * strength, 1.0); }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, ROOF_Y - LOFT_Y - sy, 16, 1, true), beamMat);
    beam.position.y = sy + (ROOF_Y - LOFT_Y - sy) / 2;
    g.add(beam);
    this.group.add(g);
    this.box = { g, lid, beam, beamMat, state: 'idle', t: 0, weapon: null, display: null, models: new Map(), cycleT: 0, owner: null };
  }

  boxModel(id) {
    let m = this.box.models.get(id);
    if (!m) {
      m = buildWeaponModel(id);
      const len = m.userData.length || 1;
      const s = Math.min(1, 1.1 / len);
      m.scale.setScalar(s);
      m.rotation.y = Math.PI / 2;
      m.visible = false;
      this.box.g.add(m);
      this.box.models.set(id, m);
    }
    return m;
  }

  setBox(state, weapon, owner, pool) {
    const b = this.box;
    b.state = state; b.t = 0; b.weapon = weapon; b.owner = owner; b.pool = pool;
    if (b.display) b.display.visible = false;
    b.display = null;
    if (state === 'idle') b.beamMat.uniforms.strength.value = 0.5;
  }

  updateBox(dt) {
    const b = this.box;
    b.t += dt;
    b.beamMat.uniforms.time.value += dt;
    const open = b.state === 'rolling' || b.state === 'ready';
    const targetLid = open ? -1.9 : 0;
    b.lid.rotation.x += (targetLid - b.lid.rotation.x) * Math.min(1, dt * 6);
    if (b.state === 'rolling') {
      b.cycleT -= dt;
      if (b.cycleT <= 0) {
        const ids = b.pool;
        const id = b.t > 3.9 ? b.weapon : ids[Math.floor(Math.random() * ids.length)];
        if (b.display) b.display.visible = false;
        b.display = this.boxModel(id);
        b.display.visible = true;
        b.cycleT = 0.06 + (b.t / 4.2) * 0.25;
      }
      if (b.display) b.display.position.set(0, MYSTERY_BOX.size[1] + 0.1 + Math.min(1, b.t / 1.5) * 0.55, 0);
      b.beamMat.uniforms.strength.value = 1.3;
    } else if (b.state === 'ready') {
      if (!b.display || b.display !== this.boxModel(b.weapon)) {
        if (b.display) b.display.visible = false;
        b.display = this.boxModel(b.weapon);
        b.display.visible = true;
      }
      b.display.position.set(0, MYSTERY_BOX.size[1] + 0.1 + 0.55 * Math.max(0, 1 - b.t / 12), 0);
      b.display.rotation.x = Math.sin(b.t * 2) * 0.05;
    }
  }

  // --- Lights ---------------------------------------------------------------------------------
  buildBulbs() {
    const bulbGeo = new THREE.SphereGeometry(0.06, 10, 8);
    const shadeGeo = new THREE.ConeGeometry(0.22, 0.14, 12, 1, true);
    const shadeMat = new THREE.MeshLambertMaterial({ color: 0x3b3b33, side: THREE.DoubleSide });
    const wireMat = new THREE.LineBasicMaterial({ color: 0x111111 });
    LIGHTS.forEach((l, i) => {
      if (l.fire) return;
      const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffd7a0 }));
      bulb.position.set(...l.pos);
      this.group.add(bulb);
      const shade = new THREE.Mesh(shadeGeo, shadeMat);
      shade.position.set(l.pos[0], l.pos[1] + 0.09, l.pos[2]);
      this.group.add(shade);
      const top = l.pos[1] > LOFT_Y ? ROOF_Y : SLAB_BOTTOM;
      const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(l.pos[0], l.pos[1] + 0.12, l.pos[2]), new THREE.Vector3(l.pos[0], top, l.pos[2]),
      ]), wireMat);
      this.group.add(wire);
      this.rig.bulbs[i].bulb = bulb;
    });
  }

  // --- Decals -------------------------------------------------------------------------------
  buildDecals() {
    const R = rng(5);
    const blood = new THREE.MeshLambertMaterial({ map: this.tex.bloodDecal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const place = (x, y, z, yaw, pitch, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), blood);
      m.position.set(x, y, z);
      m.rotation.set(pitch, yaw, R() * 6, 'YXZ');
      this.group.add(m);
    };
    for (let i = 0; i < 9; i++) place(IX0 + 1 + R() * (IX1 - IX0 - 2), 0.005, IZ0 + 1 + R() * (IZ1 - IZ0 - 2), 0, -Math.PI / 2, 0.8 + R() * 1.2);
    for (let i = 0; i < 5; i++) place(IX0 + 1 + R() * (IX1 - IX0 - 2), LOFT_Y + 0.005, IZ0 + 1 + R() * 3, 0, -Math.PI / 2, 0.7 + R());
    place(IX0 + 0.01, 1.2, 3.8, Math.PI / 2, 0, 1.3);
    place(-6 + T / 2 + 0.01, 1.6, 3.4, Math.PI / 2, 0, 1.1);
    place(4.0, 1.4, IZ1 - 0.01, Math.PI, 0, 1.0);

    const scrawl = (text, x, y, z, yaw, w) => {
      const tex = new THREE.CanvasTexture(drawWallScrawl(text, { width: 1024, height: 256 }));
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      this.group.add(m);
    };
    scrawl('THEY COME AT NIGHT', -8.1, 2.15, IZ1 - 0.01, Math.PI, 3.4);
    scrawl('KEEP THE WINDOWS SHUT', -10.4, LOFT_Y + 2.2, IZ0 + 0.01, 0, 3.2);
  }

  update(dt) {
    this.time += dt;
    this.updateBoards(dt);
    this.updateDoors(dt);
    this.updateBox(dt);
  }
}

function whiteColors(geo, v = 1) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3).fill(v);
  return new THREE.BufferAttribute(a, 3);
}
