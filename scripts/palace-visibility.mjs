// npm: node scripts/palace-visibility.mjs  (POSES=n SEED=n)  -- exits 1 on any violation.
// Brute-force check that the palace's portal culling never hides something the camera could see.
// For random camera poses: every chunk the culler hides is tested triangle by triangle: a triangle
// that faces the camera, is inside its frustum and has a clear line of sight (walls and slabs block;
// doors and windows are open) means the chunk should have been drawn.
import * as THREE from 'three';
import { buildStaticBoxes } from '../src/shared/maps/palace.js';

const SEED = Number(process.env.SEED || 1);
const POSES = Number(process.env.POSES || 300);
let s = SEED >>> 0;
const R = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const { palaceGeometry } = await import('../src/client/render/maps/palace.js');
const { Culler, ZONE_NAMES } = await import('../src/client/render/maps/palace/zones.js');
const { ROOMS } = await import('../src/client/render/maps/palace/kit.js');
const B = palaceGeometry();
const mat = new THREE.MeshBasicMaterial();
const culler = new Culler(B.portals);
const meshes = [];
const reg = (m, z) => { meshes.push(m); culler.add(m, z); };
for (const c of B.chunks) reg(Object.assign(new THREE.Mesh(c.geo, mat), { name: c.key }), c.zones);
for (const it of B.instances) {
  const m = new THREE.InstancedMesh(it.geo, mat, it.count);
  m.instanceMatrix = it.matrices; m.name = it.name; m.computeBoundingSphere(); reg(m, it.zones);
}
if (B.lamps.sign) reg(Object.assign(new THREE.Mesh(B.lamps.sign.geo, mat), { name: `lamp:${B.lamps.sign.i}` }), B.lamps.sign.zones);
{ const lg = new THREE.BufferGeometry(); lg.setAttribute('position', B.lamps.glows.position); lg.setIndex(B.lamps.glows.index); lg.computeBoundingSphere(); meshes.push(Object.assign(new THREE.Mesh(lg, mat), { name: 'lamps' })); }

const SOLID = new Set(['ext', 'int', 'roof', 'floor0', 'slab', 'stage', 'step', 'pillar']);
const solids = buildStaticBoxes().filter((q) => SOLID.has(q.tag)).map((q) => q.b);
const inSolid = (x, y, z) => { for (const b of solids) if (x > b[0] + 1e-3 && x < b[3] - 1e-3 && y > b[1] + 1e-3 && y < b[4] - 1e-3 && z > b[2] + 1e-3 && z < b[5] - 1e-3) return true; return false; };
// segment from a to b blocked by a solid?
function blocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const b of solids) {
    let t0 = 0, t1 = 1;
    const lo = [b[0] - 0.02, b[1] - 0.02, b[2] - 0.02], hi = [b[3] + 0.02, b[4] + 0.02, b[5] + 0.02];
    const o = [ax, ay, az], d = [dx, dy, dz];
    let hit = true;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) { hit = false; break; } continue; }
      let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

const pose = () => {
  if (process.env.MODE === 'portal') {
    for (let tries = 0; tries < 100; tries++) {
      const q = B.portals[Math.floor(R() * B.portals.length)].box;
      const x = q[0] - 1.2 + R() * (q[3] - q[0] + 2.4), y = Math.max(0.3, q[1] - 1.2 + R() * (q[4] - q[1] + 2.4)), z = q[2] - 1.2 + R() * (q[5] - q[2] + 2.4);
      if (!inSolid(x, y, z)) return { x, y, z, yaw: R() * Math.PI * 2, pitch: (R() - 0.5) * 1.6 };
    }
    return null;
  }
  if (process.env.MODE === 'wall') {
    for (let tries = 0; tries < 100; tries++) {
      const b = solids[Math.floor(R() * solids.length)];
      const x = b[0] - 0.6 + R() * (b[3] - b[0] + 1.2), y = b[1] - 0.6 + R() * (b[4] - b[1] + 1.2), z = b[2] - 0.6 + R() * (b[5] - b[2] + 1.2);
      if (y > 0.3 && !inSolid(x, y, z)) return { x, y, z, yaw: R() * Math.PI * 2, pitch: (R() - 0.5) * 1.6 };
    }
    return null;
  }
  const kind = R();
  let x, y, z;
  for (let tries = 0; tries < 100; tries++) {
    if (kind < 0.8) {
      const r = ROOMS[Math.floor(R() * ROOMS.length)];
      const e = 1.0;
      x = r.b[0] - e + R() * (r.b[3] - r.b[0] + 2 * e);
      z = r.b[2] - e + R() * (r.b[5] - r.b[2] + 2 * e);
      const top = Math.min(r.b[4], 14);
      y = r.b[1] + 0.4 + R() * Math.min(top - r.b[1] - 0.4, 3.2);
    } else {
      x = -60 + R() * 120; z = -60 + R() * 120; y = 0.4 + R() * (R() < 0.7 ? 3 : 14);
    }
    if (!inSolid(x, y, z)) return { x, y, z, yaw: R() * Math.PI * 2, pitch: (R() - 0.5) * 1.8 };
  }
  return null;
};

const cam = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 260);
const fr = new THREE.Frustum(), pm = new THREE.Matrix4();
const P = new THREE.Vector3();
const bad = [];
let culledTris = 0, checked = 0, posesDone = 0;
const t0 = performance.now();
for (let n = 0; n < POSES; n++) {
  const p = pose();
  if (!p) continue;
  cam.fov = 60 + R() * 55;
  cam.aspect = R() < 0.7 ? 16 / 9 : R() < 0.5 ? 21 / 9 : 4 / 3;
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  culler.stale = true; culler.update(cam);
  pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
  posesDone++;
  for (const m of meshes) {
    if (m.visible) continue;
    if (!fr.intersectsObject(m)) continue;
    const g = m.geometry, pos = g.attributes.position, nrm = g.attributes.normal, idx = g.index;
    const count = m.isInstancedMesh ? m.count : 1;
    const im = new THREE.Matrix4();
    let found = null;
    for (let inst = 0; inst < count && !found; inst++) {
      if (m.isInstancedMesh) m.getMatrixAt(inst, im);
      const nt = (idx ? idx.count : pos.count);
      for (let t = 0; t < nt && !found; t += 3) {
        const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
        const pts0 = [ia, ib, ic].map((i) => P.clone().set(pos.getX(i), pos.getY(i), pos.getZ(i)));
        if (m.isInstancedMesh) pts0.forEach((q) => q.applyMatrix4(im));
        const cen = pts0[0].clone().add(pts0[1]).add(pts0[2]).multiplyScalar(1 / 3);
        const pts = pts0.map((q) => q.clone().sub(cen).multiplyScalar(0.8).add(cen));
        const nx = nrm.getX(ia), ny = nrm.getY(ia), nz = nrm.getZ(ia);
        const mat3 = null;
        // facing: the camera is on the front side
        if (!m.isInstancedMesh && (nx * (p.x - cen.x) + ny * (p.y - cen.y) + nz * (p.z - cen.z)) <= 0 && !['screen', 'chainlink'].includes(m.name) && !m.name.startsWith('lamp')) continue;
        culledTris++;
        for (const q of [cen, ...pts]) {
          if (!fr.containsPoint(q)) continue;
          const ox = m.isInstancedMesh ? 0 : nx * 0.03, oy = m.isInstancedMesh ? 0 : ny * 0.03, oz = m.isInstancedMesh ? 0 : nz * 0.03;
          checked++;
          if (!blocked(p.x, p.y, p.z, q.x + ox, q.y + oy, q.z + oz)) { found = { at: q.toArray().map((v) => +v.toFixed(2)), n: [nx, ny, nz].map((v) => +v.toFixed(2)), cen: cen.toArray().map((v) => +v.toFixed(2)), pts: pts.map((w) => w.toArray().map((v) => +v.toFixed(2))) }; break; }
        }
      }
    }
    if (found) bad.push({ mesh: m.name, zones: m.userData.zones ?? culler.items.find((it) => it.mesh === m).zones.map((z) => ZONE_NAMES[z]).join('+'), pos: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), asp: +cam.aspect.toFixed(2), tri: found.at, n: found.n, cen: found.cen, pts: found.pts });
  }
}
console.log(`poses ${posesDone}, culled-and-in-frustum tris tested ${culledTris}, sight checks ${checked}, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`VIOLATIONS: ${bad.length}`);
const seen = new Set();
for (const b of bad) { const k = b.mesh + b.zones; if (seen.has(k) && seen.size > 12) continue; seen.add(k); if (seen.size <= 40) console.log(JSON.stringify(b)); }
if (bad.length) process.exitCode = 1;
