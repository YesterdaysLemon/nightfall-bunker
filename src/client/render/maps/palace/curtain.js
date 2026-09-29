// The curtain over the Forge's alcove (DOORS 'curtain'): two heavy velvet drapes, pleated
// in deep folds and weighted with a gilt fringe, hanging from a pelmet. When the Magic
// Lantern is first ridden they draw back to either side and bunch up, the folds
// gathering as they go.

import * as THREE from 'three';

const TAU = Math.PI * 2;

// One drape: a pleated sheet (x across 0..1, y down 0..1) with vertex-coloured fold shading,
// its x positions rebuilt as it gathers.
function drapeGeometry(w, h, cols, rows, flip) {
  const g = new THREE.BufferGeometry();
  const n = (cols + 1) * (rows + 1);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const idx = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const k = r * (cols + 1) + c;
      uv[k * 2] = (c / cols) * w / 1.2;
      uv[k * 2 + 1] = 1 - (r / rows) * h / 2.2;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      if (flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export function buildCurtain(level, d) {
  const [x0, y0, z0, x1, y1, z1] = d.box;
  const zc = (z0 + z1) / 2 + 0.05;
  const group = new THREE.Group();
  group.name = 'curtain';
  const W = (x1 - x0) / 2 + 0.25, Hh = y1 - y0 + 0.35;
  const cols = 28, rows = 10;
  const mat = level.mats.drape;
  const fringeMat = level.mats.gilt;
  const halves = [-1, 1].map((side) => {
    const geo = drapeGeometry(W, Hh, cols, rows, side < 0);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    // The gilt fringe along its hem: a row of tassels that follows the cloth.
    const fringe = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), fringeMat, cols + 1);
    const fc = new Float32Array((cols + 1) * 3).fill(0.8);
    fringe.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 3).fill(0.9), 3));
    fringe.instanceColor = new THREE.InstancedBufferAttribute(fc, 3);
    group.add(fringe);
    return { side, geo, mesh, fringe };
  });
  // The pelmet: a gilt-edged velvet box across the top.
  const pel = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.7, 0.55, 0.3), mat);
  pel.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 3).fill(0.55), 3));
  pel.position.set((x0 + x1) / 2, y1 + 0.12, zc + 0.12);
  group.add(pel);
  for (const [dy, h] of [[-0.3, 0.08], [0.28, 0.06]]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.76, h, 0.34), fringeMat);
    band.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 3).fill(0.85), 3));
    band.position.set((x0 + x1) / 2, y1 + 0.12 + dy, zc + 0.12);
    group.add(band);
  }

  let t = 0, opening = false;
  const tmp = new THREE.Matrix4();
  // Lay both drapes out for an opening amount u (0 closed .. 1 drawn back).
  const layout = (u) => {
    const e = u * u * (3 - 2 * u);
    for (const hlf of halves) {
      const { side, geo, fringe } = hlf;
      const p = geo.attributes.position.array, c = geo.attributes.color.array;
      // The drape spans from the centre (inner edge) to the jamb, then gathers to the jamb.
      const outer = side < 0 ? x0 - 0.25 : x1 + 0.25;
      const inner0 = (x0 + x1) / 2 + side * 0.02;
      const width = Math.abs(outer - inner0) * (1 - e * 0.78);
      const folds = 5 + e * 5;
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        // Tied back: the lower part of an open drape swings further toward the jamb.
        const tie = e * Math.sin(Math.PI * Math.min(1, v * 1.2)) * 0.1;
        for (let cI = 0; cI <= cols; cI++) {
          const k = r * (cols + 1) + cI;
          const s = cI / cols;   // 0 at the inner edge, 1 at the jamb
          const phase = TAU * folds * s;
          const depth = 0.07 + 0.1 * e + 0.03 * v;
          const x = outer - side * width * (1 - s) * (1 - tie);
          const z = zc + Math.sin(phase) * depth + 0.02 * Math.sin(v * 7 + s * 11);
          const y = y1 + 0.15 - v * Hh + (s < 0.05 ? 0 : 0) + (r === rows ? Math.sin(s * 17) * 0.03 : 0);
          p[k * 3] = x; p[k * 3 + 1] = y; p[k * 3 + 2] = z;
          const light = 0.5 + 0.4 * (0.5 + 0.5 * Math.cos(phase)) - 0.1 * v * v;
          c[k * 3] = light; c[k * 3 + 1] = light; c[k * 3 + 2] = light;
          if (r === rows) {
            tmp.makeTranslation(x, y - 0.05, z + 0.01);
            fringe.setMatrixAt(cI, tmp);
          }
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      fringe.instanceMatrix.needsUpdate = true;
    }
  };
  layout(0);
  return {
    group,
    openDoor(instant) { opening = true; if (instant) { t = 1; layout(1); } },
    update(dt) {
      if (!opening || t >= 1) return;
      t = Math.min(1, t + dt * 0.45);
      layout(t);
    },
  };
}
