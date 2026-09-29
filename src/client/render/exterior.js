// The dead courtyard around the bunker. Render-only; nothing here collides.

import * as THREE from 'three';
import { EXTERIOR, BX0, BX1, BZ0, BZ1 } from '../../shared/map.js';
import { Batch, mat, rng } from './geo.js';
import { chamferBox, hull, planarUV, prism, sackGeo } from './level.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class Exterior {
  constructor(rig, mats, tex) {
    this.rig = rig;
    this.group = new THREE.Group();
    this.group.name = 'exterior';
    rig.scene.add(this.group);
    this.time = 0;
    const R = rng(1944);
    this.buildGround(mats, R);
    const batch = new Batch(mats);
    this.buildPlane(batch, R);
    this.buildTruck(batch);
    this.buildTower(batch);
    this.buildCrates(batch);
    this.buildHangar(batch);
    for (const m of batch.meshes()) this.group.add(m);
    this.buildTrees(mats, R);
    this.buildSandbags(mats, R);
    this.buildWire(mats, R);
    this.buildBarrels(mats);
    this.buildTreeline(R);
    this.buildGrass(R);
    this.buildSearchlight();
  }

  buildGround(mats, R) {
    const size = 320, seg = 80;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.13 + z * 0.07) * Math.cos(z * 0.11 - x * 0.05) + 0.25 * Math.sin(x * 0.41 + 1.3) * Math.sin(z * 0.37);
      const far = Math.min(1, Math.hypot(x, z) / 120);
      const v = (0.55 + n * 0.45) * (1 - far * 0.4);
      col.set([v * 0.95, v, v * 0.9], i * 3);
      uv.setXY(i, x / 4, z / 4);
      // gentle undulation away from the building
      const d = Math.max(0, Math.hypot(Math.max(0, Math.abs(x + 4) - 14), Math.max(0, Math.abs(z) - 8)) - 6);
      pos.setY(i, -0.02 + Math.min(1, d / 30) * (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.6));
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, mats.dirt);
    ground.matrixAutoUpdate = false;
    this.group.add(ground);

    const r = EXTERIOR.runway;
    const rg = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0, 1, 1);
    rg.rotateX(-Math.PI / 2);
    const ruv = rg.attributes.uv;
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * (r.x1 - r.x0) / 8, ruv.getY(i) * (r.z1 - r.z0) / 8);
    rg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rg.attributes.position.count * 3).fill(0.55), 3));
    const runway = new THREE.Mesh(rg, mats.tarmac);
    runway.position.set((r.x0 + r.x1) / 2, 0.01, (r.z0 + r.z1) / 2);
    this.group.add(runway);
    // Dashed centre line.
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 0.35).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8e8a7a }), 24);
    for (let i = 0; i < 24; i++) dash.setMatrixAt(i, mat(-110 + i * 10, 0.02, (r.z0 + r.z1) / 2));
    this.group.add(dash);
    // Craters.
    const crater = new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2, d = 14 + R() * 30;
      const x = Math.cos(a) * d - 4, z = Math.sin(a) * d;
      const c = new THREE.Mesh(new THREE.CircleGeometry(1.2 + R() * 1.6, 14), crater);
      c.rotation.x = -Math.PI / 2;
      c.position.set(x, 0.03, z);
      this.group.add(c);
    }
  }

  buildPlane(batch, R) {
    const { pos, yaw } = EXTERIOR.plane;
    const base = mat(pos[0], 0, pos[2], yaw);
    const metal = batch.get('metal');
    const rust = batch.get('rust');
    const dark = batch.get('dark');
    const at = (x, y, z, ry = 0, rx = 0, rz = 0) => base.clone().multiply(mat(x, y, z, ry, rx, rz));
    const add = (b, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0, c = 0.7) => b.tbox(at(x, y, z, ry, rx, rz), sx, sy, sz, c, 2);
    const F = [2, 2, 2];
    // Fuselage: octagonal frustums whose radii meet, nose buried in the dirt.
    const segs = 9;
    const rad = (u) => 1.05 * (1 - Math.pow(Math.min(1, Math.abs(u - 0.35) / 0.65), 2) * 0.55);
    for (let i = 0; i < segs; i++) {
      const u = i / (segs - 1), du = 0.5 / (segs - 1);
      const g = prism(rad(u + du), rad(u - du), 1.55, 8, F);
      g.rotateX(Math.PI / 2);
      (i % 3 === 1 ? rust : metal).geo(g, at(0, 0.75 + u * 0.9, -6 + i * 1.5, 0, -0.06 + (i === 0 ? 0.25 : 0)), 0.55 + R() * 0.2);
    }
    // Tail fin and tailplane: swept, tapering slabs.
    metal.geo(hull([
      V3(-0.07, -1, -0.9), V3(0.07, -1, -0.9), V3(-0.07, -1, 0.9), V3(0.07, -1, 0.9),
      V3(-0.03, 1, 0.1), V3(0.03, 1, 0.1), V3(-0.03, 1, 0.85), V3(0.03, 1, 0.85),
    ], F), at(0, 2.6, 7.3, 0, 0.2), 0.6);
    metal.geo(hull([
      V3(-2.1, -0.03, -0.1), V3(-2.1, 0.03, -0.1), V3(-2.1, 0, 0.55),
      V3(0, -0.06, -0.65), V3(0, 0.06, -0.65), V3(0, -0.05, 0.65), V3(0, 0.05, 0.65),
      V3(2.1, -0.03, -0.1), V3(2.1, 0.03, -0.1), V3(2.1, 0, 0.55),
    ], F), at(0, 1.9, 7.1, 0, 0, 0.08), 0.55);
    // Wings: one intact and tapered, one snapped off and lying in the mud.
    const wing = (span, root, tip, thick, sweep) => hull([
      V3(span / 2, thick / 2, -root / 2), V3(span / 2, -thick / 2, -root / 2), V3(span / 2, 0, -root / 2 - 0.12),
      V3(span / 2, thick / 3, root / 2), V3(span / 2, -thick / 3, root / 2),
      V3(-span / 2, thick / 5, -tip / 2 + sweep), V3(-span / 2, -thick / 5, -tip / 2 + sweep), V3(-span / 2, thick / 6, tip / 2 + sweep), V3(-span / 2, -thick / 6, tip / 2 + sweep),
    ], F);
    metal.geo(wing(9, 2.8, 1.4, 0.24, 0.35), at(-5.5, 0.9, -1.5, 0.05, 0, -0.08), 0.6);
    rust.geo(wing(6, 1.5, 2.4, 0.2, -0.3), at(5.2, 0.35, -2.8, -0.45, 0, 0.35), 0.5);
    // Engines & a bent propeller.
    for (const [x, y, z, rx] of [[-3.6, 0.9, -2.8, 0], [4.2, 0.55, -4.6, 0.3]]) {
      const eng = prism(0.55, 0.45, 1.8, 8, F);
      eng.rotateX(Math.PI / 2);
      dark.geo(eng, at(x, y, z, 0, rx), 0.9);
      const hub = prism(0.12, 0.2, 0.3, 6, F);
      hub.rotateX(-Math.PI / 2);
      metal.geo(hub, at(x, y, z - 1.0, 0, rx), 0.45);
      add(metal, x, y, z - 1.0, 0.18, 2.4, 0.08, 0, 0, 0.6 + R(), 0.5);
      add(metal, x, y, z - 1.0, 0.18, 1.8, 0.08, 0, 0, 2.1 + R(), 0.5);
    }
    // Scattered wreckage.
    for (let i = 0; i < 14; i++) {
      add(R() < 0.5 ? metal : rust, (R() - 0.5) * 14, 0.1 + R() * 0.2, (R() - 0.5) * 16, 0.4 + R() * 1.4, 0.06, 0.3 + R() * 1.2, R() * 3, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5, 0.4 + R() * 0.3);
    }
    // Cockpit canopy: a faceted glasshouse.
    batch.get('glass').geo(hull([
      V3(-0.55, -0.3, -0.7), V3(0.55, -0.3, -0.7), V3(-0.55, -0.3, 0.7), V3(0.55, -0.3, 0.7),
      V3(-0.35, 0.15, -0.45), V3(0.35, 0.15, -0.45), V3(-0.4, 0.2, 0.6), V3(0.4, 0.2, 0.6),
      V3(-0.15, 0.3, -0.1), V3(0.15, 0.3, -0.1), V3(-0.15, 0.3, 0.55), V3(0.15, 0.3, 0.55),
    ]), at(0, 1.55, -4.8, 0, 0.3), 0.7);
  }

  buildTruck(batch) {
    const { pos, yaw } = EXTERIOR.truck;
    const base = mat(pos[0], 0, pos[2], yaw, 0, 0.06);
    const m = batch.get('metal'), r = batch.get('rust'), d = batch.get('dark'), f = batch.get('fabric'), w = batch.get('woodWall');
    const at = (x, y, z, ry = 0, rx = 0, rz = 0) => base.clone().multiply(mat(x, y, z, ry, rx, rz));
    const add = (b, x, y, z, sx, sy, sz, c = 0.6) => b.tbox(at(x, y, z), sx, sy, sz, c, 2);
    const F = [2, 2, 2];
    const mirror = (pts) => pts.flatMap(([x, y, z]) => [V3(x, y, z), V3(-x, y, z)]);
    // Cab with a raked windscreen, and a tapering bonnet in front of it.
    m.geo(hull(mirror([[1.05, 0.75, -1.5], [1.05, 0.75, -3.3], [1.05, 1.5, -3.3], [0.95, 2.05, -2.75], [0.95, 2.05, -1.5]]), F), base, 0.5);
    m.geo(hull(mirror([[0.8, 0.75, -3.3], [0.8, 1.42, -3.3], [0.6, 1.52, -3.3], [0.7, 0.75, -4.7], [0.7, 1.3, -4.7], [0.5, 1.38, -4.7]]), F), base, 0.55);
    const glass = batch.get('glass');
    glass.tbox(at(0, 1.78, -3.04, 0, 0.83), 1.7, 0.66, 0.03, 0.8, 1);
    for (const s of [-1, 1]) glass.tbox(at(s * 1.06, 1.72, -2.2, 0), 0.03, 0.42, 0.8, 0.8, 1);
    d.tbox(at(0, 1.0, -4.72), 1.0, 0.5, 0.04, 1, 1); // grille
    d.tbox(at(0, 0.62, -4.85), 2.1, 0.16, 0.14, 1, 1); // bumper
    for (const s of [-1, 1]) {
      // mudguards over the front wheels, headlamps beside the bonnet
      const pts = [];
      for (const x of [0.82, 1.28]) for (const [y, z] of [[1.1, -1.7], [1.1, -2.9], [0.8, -3.2], [0.8, -1.5]]) pts.push(V3(s * x, y, z));
      m.geo(hull(pts, F), base, 0.45);
      const lampG = prism(0.13, 0.13, 0.14, 8, F);
      lampG.rotateX(Math.PI / 2);
      d.geo(lampG, at(s * 0.92, 1.05, -4.45), 0.9);
      batch.get('lamp').tbox(at(s * 0.92, 1.05, -4.525), 0.16, 0.16, 0.01, 0.3, 1);
    }
    // Load bed with plank sides, and the canvas tilt over hoops.
    r.geo(chamferBox(2.3, 0.35, 4.6, 0.05, F), at(0, 0.8, 0.9), 0.45);
    for (const s of [-1, 1]) w.tbox(at(s * 1.12, 1.15, 0.9), 0.06, 0.4, 4.5, 0.45, 1);
    w.tbox(at(0, 1.15, 3.17), 2.3, 0.4, 0.06, 0.45, 1);
    f.geo(hull(mirror([[1.15, 1.2, -1.1], [1.15, 2.15, -1.1], [0.72, 2.58, -1.1], [0.001, 2.66, -1.1], [1.15, 1.2, 3.1], [1.15, 2.15, 3.1], [0.72, 2.58, 3.1], [0.001, 2.66, 3.1]]), F), base, [0.42, 0.44, 0.34]);
    for (const z of [-0.3, 1.0, 2.3]) d.tbox(at(0, 2.66, z), 1.5, 0.03, 0.06, 0.6, 1);
    add(d, 0, 0.55, -1.2, 2.0, 0.4, 7.2, 0.9);
    for (const [x, z] of [[-1.05, -2.3], [1.05, -2.3], [-1.05, 1.9], [1.05, 1.9]]) {
      const wh = prism(0.5, 0.5, 0.35, 8, F);
      wh.rotateZ(Math.PI / 2);
      d.geo(wh, at(x, 0.5, z), 0.8);
      const hub = prism(0.2, 0.2, 0.37, 6, F);
      hub.rotateZ(Math.PI / 2);
      m.geo(hub, at(x, 0.5, z), 0.4);
    }
  }

  buildTower(batch) {
    const { pos } = EXTERIOR.tower;
    const w = batch.get('woodWall');
    const h = 9;
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      w.geo(chamferBox(0.22, h, 0.22, 0.04), mat(pos[0] + x * 0.8, h / 2, pos[2] + z * 0.8, 0, x * 0.06, -z * 0.06), 0.4);
    }
    for (let y = 2; y < h; y += 2.4) {
      w.tbox(mat(pos[0], y, pos[2] - 1.0, 0, 0, 0.9), 0.1, 3, 0.1, 0.4, 1);
      w.tbox(mat(pos[0], y, pos[2] + 1.0, 0, 0, -0.9), 0.1, 3, 0.1, 0.4, 1);
    }
    w.geo(chamferBox(3.2, 0.2, 3.2, 0.05), mat(pos[0], h, pos[2]), 0.45);
    // Lookout: a plank parapet, corner posts and a pitched tin roof.
    for (const [x, z, sx, sz] of [[0, -1.55, 3.2, 0.08], [0, 1.55, 3.2, 0.08], [-1.55, 0, 0.08, 3.2], [1.55, 0, 0.08, 3.2]]) {
      w.tbox(mat(pos[0] + x, h + 0.55, pos[2] + z), sx, 0.9, sz, 0.4, 1);
    }
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) w.tbox(mat(pos[0] + x, h + 1.1, pos[2] + z), 0.12, 2.0, 0.12, 0.4, 1);
    batch.get('metal').geo(hull([
      V3(-1.9, 0, -1.9), V3(1.9, 0, -1.9), V3(-1.9, 0, 1.9), V3(1.9, 0, 1.9),
      V3(-1.9, 0.1, -1.9), V3(1.9, 0.1, -1.9), V3(-1.9, 0.1, 1.9), V3(1.9, 0.1, 1.9), V3(0, 0.95, 0),
    ], [2, 2, 2]), mat(pos[0], h + 2.1, pos[2]), 0.35);
    this.lampPos = new THREE.Vector3(pos[0], h + 1.3, pos[2]);
    const drum = prism(0.34, 0.3, 0.6, 8);
    drum.rotateX(Math.PI / 2);
    batch.get('metal').geo(drum, mat(pos[0], h + 1.3, pos[2], 0.6, -0.3), 0.5);
    batch.get('metal').tbox(mat(pos[0], h + 1.0, pos[2]), 0.12, 0.5, 0.12, 0.4, 1);
  }

  buildCrates(batch) {
    const c = batch.get('crate');
    const box = (s) => chamferBox(s, s, s, 0.045, [s, s, s]);
    for (const [x, z, yaw] of EXTERIOR.crates) {
      c.geo(box(0.9), mat(x, 0.45, z, yaw), 0.55);
      c.geo(box(0.7), mat(x + 0.9, 0.35, z + 0.2, yaw + 0.3), 0.5);
    }
  }

  buildHangar(batch) {
    const { pos, size } = EXTERIOR.hangar;
    const [sx, sy, sz] = size;
    const m = batch.get('metal');
    m.tbox(mat(pos[0], sy * 0.3, pos[2]), sx, sy * 0.6, sz, 0.35, 6);
    const roof = new THREE.CylinderGeometry(sz / 2, sz / 2, sx, 8, 1, true, 0, Math.PI);
    roof.rotateZ(Math.PI / 2);
    roof.rotateX(Math.PI / 2);
    m.geo(planarUV(roof, [6, 6, 6]), mat(pos[0], sy * 0.6, pos[2], 0, -Math.PI / 2), 0.3);
    batch.get('dark').tbox(mat(pos[0], sy * 0.3, pos[2] - sz / 2 - 0.05), sx * 0.7, sy * 0.55, 0.1, 1, 1);
  }

  buildTrees(mats, R) {
    // Three variants of bare, twisted trees merged into instanced meshes.
    const variants = [0, 1, 2].map((v) => {
      const b = new Batch(mats).get('bark');
      const rr = rng(300 + v);
      const branch = (m, len, rad, depth) => {
        // hexagonal limbs with hard facets
        const g = new THREE.CylinderGeometry(rad * 0.62, rad, len, 6, 1).toNonIndexed();
        g.computeVertexNormals();
        g.translate(0, len / 2, 0);
        b.geo(g, m, 0.55 + rr() * 0.15);
        if (depth <= 0) return;
        const n = depth > 2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const child = m.clone()
            .multiply(new THREE.Matrix4().makeTranslation(0, len * (0.55 + rr() * 0.4), 0))
            .multiply(new THREE.Matrix4().makeRotationY(rr() * Math.PI * 2))
            .multiply(new THREE.Matrix4().makeRotationZ(0.45 + rr() * 0.6));
          branch(child, len * (0.55 + rr() * 0.2), rad * 0.6, depth - 1);
        }
      };
      branch(new THREE.Matrix4(), 3.5 + v, 0.28, 3);
      return b.build();
    });
    const trees = EXTERIOR.trees;
    variants.forEach((g, v) => {
      const list = trees.filter((_, i) => i % 3 === v);
      const im = new THREE.InstancedMesh(g, mats.bark, list.length);
      list.forEach(([x, z], i) => im.setMatrixAt(i, mat(x, -0.1, z, R() * 6, (R() - 0.5) * 0.12, (R() - 0.5) * 0.12, 1 + R() * 0.6)));
      this.group.add(im);
    });
  }

  buildSandbags(mats, R) {
    // Faceted sacks merged into one mesh (one draw call, like the old instancing).
    const sacks = [0, 1, 2, 3].map(() => sackGeo(0.6, 0.22, 0.37, R));
    const b = new Batch(mats).get('sandbag');
    for (const [x, z, yaw, len] of EXTERIOR.sandbags) {
      const n = Math.round(len / 0.6);
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < n - row; i++) {
          const along = (i - (n - row - 1) / 2) * 0.6;
          const m = mat(x + Math.cos(yaw) * along, 0.1 + row * 0.2, z - Math.sin(yaw) * along, yaw + (R() - 0.5) * 0.25 + (R() < 0.5 ? Math.PI : 0), 0, (R() - 0.5) * 0.08);
          b.geo(sacks[Math.floor(R() * sacks.length)], m, 0.68 + R() * 0.14);
        }
      }
    }
    const mesh = new THREE.Mesh(b.build(), mats.sandbag);
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  buildWire(mats, R) {
    const posts = [];
    const pts = [];
    for (const [[ax, az], [bx, bz]] of EXTERIOR.wire) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 3.5);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        posts.push(mat(x, 0.6, z, R() * 3, (R() - 0.5) * 0.15, (R() - 0.5) * 0.15));
        if (i === n) continue;
        const nx2 = ax + (bx - ax) * ((i + 1) / n), nz2 = az + (bz - az) * ((i + 1) / n);
        for (const h of [0.35, 0.75, 1.1]) {
          const sag = 0.08;
          const steps = 6;
          for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            const y0 = h - Math.sin(t0 * Math.PI) * sag, y1 = h - Math.sin(t1 * Math.PI) * sag;
            pts.push(x + (nx2 - x) * t0, y0, z + (nz2 - z) * t0, x + (nx2 - x) * t1, y1, z + (nz2 - z) * t1);
          }
        }
      }
    }
    const pg = new THREE.BoxGeometry(0.08, 1.2, 0.08);
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pg.attributes.position.count * 3).fill(0.4), 3));
    const im = new THREE.InstancedMesh(pg, mats.woodWall, posts.length);
    posts.forEach((m, i) => im.setMatrixAt(i, m));
    this.group.add(im);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2826 })));
  }

  buildBarrels(mats) {
    // Octagonal drums with two rolling hoops and a lipped top.
    const b = new Batch(mats).get('rust');
    b.geo(prism(0.3, 0.3, 0.9, 8), new THREE.Matrix4(), 0.6);
    for (const y of [-0.22, 0.22]) b.geo(prism(0.318, 0.318, 0.045, 8), mat(0, y, 0), 0.5);
    for (const y of [-0.435, 0.435]) b.geo(prism(0.31, 0.31, 0.035, 8), mat(0, y, 0), 0.45);
    b.geo(prism(0.035, 0.035, 0.03, 6), mat(0.15, 0.46, 0.05), 0.4);
    const g = b.build();
    const list = EXTERIOR.barrels;
    const im = new THREE.InstancedMesh(g, mats.rust, list.length);
    list.forEach(([x, z], i) => im.setMatrixAt(i, i === 2 ? mat(x, 0.3, z, 0.4, 0, Math.PI / 2) : mat(x, 0.45, z, i)));
    this.group.add(im);
  }

  buildTreeline(R) {
    const g = new THREE.ConeGeometry(3, 12, 6);
    g.translate(0, 6, 0);
    const n = 120;
    const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x07090b }), n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.05;
      const d = 95 + R() * 25;
      im.setMatrixAt(i, mat(Math.cos(a) * d, -1, Math.sin(a) * d, 0, 0, 0, 0.7 + R() * 0.9));
    }
    this.group.add(im);
  }

  buildGrass(R) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 4 + R() * 56;
      ctx.strokeStyle = `rgba(${60 + R() * 30},${62 + R() * 30},${38 + R() * 20},1)`;
      ctx.lineWidth = 1 + R() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.quadraticCurveTo(x + (R() - 0.5) * 10, 40, x + (R() - 0.5) * 20, 8 + R() * 30);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const g1 = new THREE.PlaneGeometry(0.9, 0.55);
    g1.translate(0, 0.27, 0);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const merged = mergeTwo(g1, g2);
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    const n = 1400;
    const im = new THREE.InstancedMesh(merged, m, n);
    let k = 0;
    while (k < n) {
      const x = (R() - 0.5) * 110, z = (R() - 0.5) * 90;
      if (x > BX0 - 2 && x < BX1 + 2 && z > BZ0 - 3.5 && z < BZ1 + 2) continue;
      if (z > 29 && z < 47) continue;
      im.setMatrixAt(k++, mat(x, -0.02, z, R() * 3, 0, 0, 0.6 + R() * 0.9));
    }
    this.group.add(im);
  }

  buildSearchlight() {
    const len = 60;
    const g = new THREE.ConeGeometry(4, len, 20, 1, true);
    g.translate(0, -len / 2, 0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { len: { value: len } },
      vertexShader: 'varying float vD; void main(){ vD = -position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ',
      fragmentShader: 'varying float vD; uniform float len; void main(){ float a = 0.09 * pow(1.0 - clamp(vD/len,0.0,1.0), 2.0); gl_FragColor = vec4(vec3(0.75,0.8,0.9)*a, 1.0);} ',
    });
    this.beam = new THREE.Mesh(g, m);
    this.beam.position.copy(this.lampPos);
    this.group.add(this.beam);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  update(dt) {
    this.time += dt;
    if (this.beam) {
      const t = this.time * 0.18;
      this.beam.rotation.set(-0.35 + Math.sin(t * 1.7) * 0.12, t + Math.sin(t * 0.7) * 0.8, 0, 'YXZ');
    }
  }
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const A = a.attributes[name], B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array); arr.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index.array, ib = b.index.array, off = a.attributes.position.count;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
