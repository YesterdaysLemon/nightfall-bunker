// The level renderer every map shares: windows and their boards, doors and debris,
// chalk wall buys and the mystery box, plus faceted prop geometry the maps'
// dressings (render/maps/*.js) build with.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Batch, mat, rng } from './geo.js';
import { drawChalkWeapon, drawChalkLabel } from './chalk.js';
import { buildWeaponModel } from './weapons3d.js';

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

// A map's level: what every map shares (windows and their boards, doors and debris,
// chalk wall buys, the mystery box), plus the map's own dressing (render/maps/*.js:
// its shell, furniture, lamps and outside), which draws everything else.
export class Level {
  // map: a map object (shared/map.js MAPS); dress: its dressing (render/maps/index.js).
  constructor(rig, textures, map, dress) {
    this.rig = rig;
    this.tex = textures;
    this.map = map;
    this.dress = dress;
    this.mats = makeMaterials(textures);
    this.group = new THREE.Group();
    this.group.name = `level:${map.id}`;
    rig.scene.add(this.group);
    this.anims = [];
    this.time = 0;
    this.own = [];          // textures this level made (disposed with it)
    this.makeToken = null;  // the toy the box shows when it moves away (game.js sets it)

    const batch = new Batch(this.mats);
    dress.build(this, batch);
    for (const m of batch.meshes()) this.group.add(m);

    this.buildWindows();
    this.buildDoors();
    this.buildWallBuys();
    this.buildBox();
    dress.after?.(this);
    this.exterior = dress.exterior?.(this) || null;
  }

  // Free everything this level made (the shared textures and gun models stay).
  dispose() {
    this.rig.scene.remove(this.group);
    for (const m of this.box.models.values()) this.box.g.remove(m);
    const mats = new Set();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) mats.add(m);
    });
    for (const m of mats) m.dispose();
    for (const t of this.own) t.dispose();
    this.exterior?.dispose?.();
    this.dress.dispose?.(this);
  }

  canvasTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.own.push(tex);
    return tex;
  }

  // --- Windows & barricades -------------------------------------------------------------
  buildWindows() {
    const { WINDOWS, MAX_BOARDS } = this.map;
    const T = this.map.T ?? 0.3;
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
  // Doors are double leaves hinged at the ends of their opening, in a wall along x or
  // z, on any floor; debris is a heap. Other kinds (the palace's curtain) come from
  // the map's dressing: dress.door(level, d) -> { group, openDoor(instant), update(dt) }.
  buildDoors() {
    this.doorVis = new Map();
    const R = rng(21);
    for (const d of this.map.DOORS) {
      if (d.kind !== 'door' && d.kind !== 'debris') {
        const v = this.dress.door?.(this, d);
        if (v) { this.group.add(v.group); this.doorVis.set(d.id, { ...v, custom: true, open: false, t: 0 }); }
        continue;
      }
      const g = new THREE.Group();
      const [x0, y0, z0, x1, y1, z1] = d.box;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const alongX = x1 - x0 > z1 - z0;
      const h = y1 - y0;
      const pieces = [];
      if (d.kind === 'door') {
        const span = alongX ? x1 - x0 : z1 - z0;
        const leafW = span / 2;
        for (const side of [-1, 1]) {
          // Pivot on the hinge; the leaf extends toward the doorway centre.
          const pivot = new THREE.Group();
          if (alongX) pivot.position.set(side < 0 ? x0 : x1, y0, cz);
          else pivot.position.set(cx, y0, side < 0 ? z0 : z1);
          const leaf = new THREE.Group();
          if (alongX) leaf.rotation.y = Math.PI / 2;
          pivot.add(leaf);
          const dir = alongX ? side : -side;
          for (let k = 0; k < 4; k++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, h - 0.02, leafW / 4 - 0.01), this.mats.woodWall);
            plank.geometry.setAttribute('color', whiteColors(plank.geometry, 0.55 + R() * 0.15));
            plank.position.set(0, (h - 0.02) / 2, dir * (k + 0.5) * (leafW / 4));
            leaf.add(plank);
          }
          for (const y of [0.45, h - 0.45]) {
            const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, leafW - 0.04), this.mats.metal);
            strap.geometry.setAttribute('color', whiteColors(strap.geometry, 0.4));
            strap.position.set(0, y, dir * leafW / 2);
            leaf.add(strap);
          }
          g.add(pivot);
          pieces.push({ obj: pivot, kind: 'leaf', side, y0 });
        }
        for (const face of [-1, 1]) {
          const yaw = alongX ? (face > 0 ? 0 : Math.PI) : (face > 0 ? Math.PI / 2 : -Math.PI / 2);
          g.add(this.chalkLabel(`${d.cost}`, cx + (alongX ? 0 : face * 0.06), y0 + 1.55, cz + (alongX ? face * 0.06 : 0), yaw, 0.8));
        }
      } else {
        // Debris: broken planks, a crate, a chair, rubble.
        const sx = x1 - x0, sz = z1 - z0;
        for (let k = 0; k < 16; k++) {
          const m = new THREE.Mesh(chamferBox(0.12 + R() * 0.1, 0.05, 0.9 + R() * 1.1, 0.012), R() < 0.8 ? this.mats.woodWall : this.mats.metal);
          m.geometry.setAttribute('color', whiteColors(m.geometry, 0.35 + R() * 0.3));
          m.position.set(x0 + R() * sx, y0 + 0.1 + R() * Math.min(1.6, h - 0.3), z0 + R() * sz);
          m.rotation.set((R() - 0.5) * 2.4, R() * 3, (R() - 0.5) * 2.4);
          g.add(m);
          pieces.push({ obj: m, kind: 'chunk', v: new THREE.Vector3((R() - 0.5) * 3, 2 + R() * 3, (R() - 0.5) * 3), s: (R() - 0.5) * 8 });
        }
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(chamferBox(0.6, 0.6, 0.6, 0.035, [0.6, 0.6, 0.6]), this.mats.crate);
          c.geometry.setAttribute('color', whiteColors(c.geometry, 0.6));
          c.position.set(cx + (R() - 0.5) * sx * 0.5, y0 + 0.3 + k * 0.45, cz + (R() - 0.5) * sz * 0.5);
          c.rotation.set((R() - 0.5) * 0.6, R() * 3, (R() - 0.5) * 0.6);
          g.add(c);
          pieces.push({ obj: c, kind: 'chunk', v: new THREE.Vector3((R() - 0.5) * 2, 1.5 + R() * 2, (R() - 0.5) * 2), s: (R() - 0.5) * 5 });
        }
        const lbl = d.use[0];
        const yaw = Math.atan2(lbl[0] - cx, lbl[2] - cz);
        g.add(this.chalkLabel(`${d.cost}`, cx + Math.sin(yaw) * 0.75, y0 + 1.1, cz + Math.cos(yaw) * 0.75, yaw, 0.7));
      }
      this.group.add(g);
      this.doorVis.set(d.id, { group: g, pieces, open: false, t: 0 });
    }
  }

  // Doors animate away; a new session rebuilds them closed.
  rebuildDoors() {
    for (const v of this.doorVis.values()) {
      this.group.remove(v.group);
      v.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.buildDoors();
  }

  chalkLabel(text, x, y, z, yaw, w) {
    const tex = this.canvasTexture(drawChalkLabel(text, { width: 256, height: 128 }));
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
    if (v.custom) { v.openDoor?.(instant); return; }
    for (const c of v.group.children) if (c.userData.label) c.visible = false;
    if (instant) v.group.visible = false;
  }

  updateDoors(dt) {
    for (const v of this.doorVis.values()) {
      if (v.custom) { v.update?.(dt); continue; }
      if (!v.open || !v.group.visible) continue;
      v.t += dt;
      for (const p of v.pieces) {
        if (p.kind === 'leaf') {
          p.obj.rotation.y = -p.side * Math.min(1, v.t / 0.7) * 1.7;
          p.obj.position.y = p.y0 - Math.max(0, v.t - 0.8) * 2.5;
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
    for (const wb of this.map.WALL_BUYS) {
      const tex = this.canvasTexture(drawChalkWeapon(wb.weapon));
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
  // It sits at one of map.BOX_SPOTS (its front, where you open it, is local -Z). When it
  // moves: a toy rises out of it ('leaving'), it lifts off and fades ('moving'), then
  // drops in at its new spot (setBoxSpot).
  buildBox() {
    const B = this.map.BOX_SPOTS[0];
    const [sx, sy, sz] = B.size;
    const g = new THREE.Group();
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
    const body = new THREE.Group();
    for (const m of parts.meshes()) body.add(m);
    g.add(body);
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
    body.add(lid);
    // Beam of light rising from the box.
    const beamH = this.map.boxBeam ?? 2.4;
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, strength: { value: 0.5 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float strength;
        void main(){ float a = (1.0 - vUv.y) * (0.6 + 0.4 * sin(vUv.x * 40.0 + time * 2.0));
        a *= smoothstep(0.0, 0.08, vUv.y); gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * a * strength, 1.0); }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, beamH, 16, 1, true), beamMat);
    beam.position.y = sy + beamH / 2;
    g.add(beam);
    this.group.add(g);
    this.box = { g, body, lid, beam, beamMat, state: 'idle', t: 0, weapon: null, display: null, models: new Map(), cycleT: 0, owner: null, token: null, spot: 0, land: 0 };
    this.setBoxSpot(0, true);
  }

  // Put the box at a spot (instantly, or dropping in from above).
  setBoxSpot(i, instant = false) {
    const b = this.box;
    const B = this.map.BOX_SPOTS[i] || this.map.BOX_SPOTS[0];
    b.spot = i;
    b.g.position.set(B.pos[0], B.pos[1], B.pos[2]);
    b.g.rotation.y = B.yaw || 0;
    b.land = instant ? 0 : 1;
    b.body.visible = true;
    b.beam.visible = true;
  }

  boxSpotPos(i = this.box.spot) {
    return (this.map.BOX_SPOTS[i] || this.map.BOX_SPOTS[0]).pos;
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
    if (b.token) b.token.visible = state === 'leaving';
    if (state === 'leaving' && !b.token && this.makeToken) { b.token = this.makeToken(); b.g.add(b.token); }
    if (state === 'idle') { b.beamMat.uniforms.strength.value = 0.5; b.body.visible = true; b.body.position.y = 0; b.beam.visible = true; }
  }

  updateBox(dt) {
    const b = this.box;
    const sy = this.map.BOX_SPOTS[0].size[1];
    b.t += dt;
    b.beamMat.uniforms.time.value += dt;
    const open = b.state === 'rolling' || b.state === 'ready' || b.state === 'leaving';
    const targetLid = open ? -1.9 : 0;
    b.lid.rotation.x += (targetLid - b.lid.rotation.x) * Math.min(1, dt * 6);
    if (b.land > 0) {
      // Dropping in at a new spot.
      b.land = Math.max(0, b.land - dt * 1.4);
      b.body.position.y = b.land * b.land * 6;
      b.beamMat.uniforms.strength.value = 0.5 + b.land * 2;
    }
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
      if (b.display) b.display.position.set(0, sy + 0.1 + Math.min(1, b.t / 1.5) * 0.55, 0);
      b.beamMat.uniforms.strength.value = 1.3;
    } else if (b.state === 'ready') {
      if (!b.display || b.display !== this.boxModel(b.weapon)) {
        if (b.display) b.display.visible = false;
        b.display = this.boxModel(b.weapon);
        b.display.visible = true;
      }
      b.display.position.set(0, sy + 0.1 + 0.55 * Math.max(0, 1 - b.t / 12), 0);
      b.display.rotation.x = Math.sin(b.t * 2) * 0.05;
    } else if (b.state === 'leaving') {
      // The guns cycle as usual, then a toy comes up instead.
      if (b.t < 3.2 && b.pool?.length) {
        b.cycleT -= dt;
        if (b.cycleT <= 0) {
          if (b.display) b.display.visible = false;
          b.display = this.boxModel(b.pool[Math.floor(Math.random() * b.pool.length)]);
          b.display.visible = true;
          b.cycleT = 0.06 + (b.t / 4.2) * 0.25;
        }
        if (b.display) b.display.position.set(0, sy + 0.1 + Math.min(1, b.t / 1.5) * 0.55, 0);
      } else {
        if (b.display) { b.display.visible = false; b.display = null; }
        if (b.token) {
          b.token.visible = true;
          b.token.position.set(0, sy + 0.2 + Math.min(1, (b.t - 3.2) / 0.8) * 0.5, 0);
          b.token.userData.update?.(dt, b.t);
        }
      }
      b.beamMat.uniforms.strength.value = 1.3 * Math.max(0.2, 1 - Math.max(0, b.t - 3.2));
    } else if (b.state === 'moving') {
      // Up and away.
      if (b.token) b.token.visible = false;
      const u = Math.min(1, b.t / 2.2);
      b.body.position.y = u * u * 9;
      b.body.visible = u < 1;
      b.beam.visible = false;
    }
  }

  update(dt) {
    this.time += dt;
    this.updateBoards(dt);
    this.updateDoors(dt);
    this.updateBox(dt);
    this.exterior?.update(dt);
    this.dress.update?.(this, dt);
  }
}

function whiteColors(geo, v = 1) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3).fill(v);
  return new THREE.BufferAttribute(a, 3);
}
