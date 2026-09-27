// Every exported character model (public/models/*.json, art/STYLE.md format)
// must load cleanly: finite numbers, matching array lengths, indices in range,
// UVs inside the page, joints that resolve, and a texture file next to it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/models';
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];

test('model files are present or the directory is empty', () => {
  assert.ok(Array.isArray(files));
});

for (const f of files) {
  test(`model ${f}`, () => {
    const m = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    assert.equal(m.version, 1, 'version 1');
    assert.ok(existsSync(join(DIR, m.texture)), `texture ${m.texture} exists`);
    if (m.emissive) assert.ok(existsSync(join(DIR, m.emissive)), `glow ${m.emissive} exists`);
    const joints = m.joints || {};
    for (const [name, j] of Object.entries(joints)) {
      assert.ok(j.parent === null || j.parent === undefined || joints[j.parent], `${name}: parent ${j.parent} exists`);
      assert.ok(Array.isArray(j.pos) && j.pos.length === 3 && j.pos.every(Number.isFinite), `${name}: pos`);
    }
    assert.ok(Array.isArray(m.parts) && m.parts.length > 0, 'has parts');
    let tris = 0;
    for (const p of m.parts) {
      const n = p.pos.length / 3;
      assert.ok(Number.isInteger(n) && n > 0, `${p.name}: positions`);
      assert.ok(p.pos.every(Number.isFinite), `${p.name}: finite positions`);
      if (p.joint != null) assert.ok(joints[p.joint], `${p.name}: joint ${p.joint} exists`);
      if (p.nrm) {
        assert.equal(p.nrm.length, p.pos.length, `${p.name}: normals`);
        for (let i = 0; i < p.nrm.length; i += 3) {
          const l = Math.hypot(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]);
          assert.ok(l > 0.9 && l < 1.1, `${p.name}: unit normals`);
        }
      }
      if (p.uv) {
        assert.equal(p.uv.length / 2, n, `${p.name}: uv count`);
        assert.ok(p.uv.every((v) => Number.isFinite(v) && v >= -0.001 && v <= 1.001), `${p.name}: uv in the page`);
      }
      if (p.col) assert.equal(p.col.length, p.pos.length, `${p.name}: colours`);
      if (p.idx) {
        assert.equal(p.idx.length % 3, 0, `${p.name}: triangles`);
        assert.ok(p.idx.every((i) => Number.isInteger(i) && i >= 0 && i < n), `${p.name}: indices in range`);
        tris += p.idx.length / 3;
      } else {
        tris += n / 3;
      }
    }
    assert.ok(tris <= 6000, `${f}: ${tris} triangles is over the 1997 budget`);
  });
}
