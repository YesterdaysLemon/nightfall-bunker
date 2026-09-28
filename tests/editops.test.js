// Model Workshop edit replay (art/lab/editops.mjs) and the bake that writes it
// into public/models: what the workshop previews is what the game gets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateFrom, replay, jointWorld, mirrorName, partNamed, partTriangles, KINDS } from '../art/lab/editops.mjs';
import { bake } from '../art/lab/bake.mjs';

const model = (id) => JSON.parse(readFileSync(new URL(`../public/models/${id}.json`, import.meta.url), 'utf8'));
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
// A tiny model: named single points at the origin joint.
const points = (...pts) => ({
  joints: { root: { parent: null, pos: [0, 0, 0] } },
  parts: pts.map(([name, x, nx = 1]) => ({ name, joint: 'root', pos: [x, 0, 0], nrm: [nx, 0, 0], idx: [] })),
});
const x = (s, name, k = 0) => partNamed(s, name).pos[k];

test('a mirrored push moves both sides symmetrically', () => {
  const s = replay(stateFrom(points(['a.L', 0.2], ['a.R', -0.2, -1])), [{ t: 'move', c: [0.2, 0, 0], r: 0.1, d: [0.05, 0.01, 0], axis: [0, 0, -1], mirror: true }]);
  near(x(s, 'a.L'), 0.25, 'left x'); near(x(s, 'a.R'), -0.25, 'right x');
  near(x(s, 'a.L', 1), 0.01, 'left y'); near(x(s, 'a.R', 1), 0.01, 'right y');
});

test('a mirrored stroke seen from the side moves each vertex once', () => {
  const s = replay(stateFrom(points(['mid', 0.1])), [{ t: 'move', c: [0, 0, 0], r: 0.1, d: [0, 0.02, 0], axis: [-1, 0, 0], mirror: true }]);
  near(x(s, 'mid', 1), 0.02, 'y');
});

test('a sphere brush (no axis) only reaches what is near in 3D', () => {
  const m = points(['a', 0.05]);
  m.parts.push({ name: 'b', joint: 'root', pos: [0.05, 0, 0.5], nrm: [0, 0, 1], idx: [] });
  const s = replay(stateFrom(m), [{ t: 'move', c: [0.05, 0, 0], r: 0.1, d: [0, 0.03, 0], axis: null, mirror: false }]);
  near(x(s, 'a', 1), 0.03, 'near point moved'); near(x(s, 'b', 1), 0, 'far point stayed');
});

test('a part-limited brush leaves other parts alone', () => {
  const s = replay(stateFrom(points(['arm.L', 0.2], ['torso', 0.2])), [{ t: 'move', c: [0.2, 0, 0], r: 0.1, d: [0.05, 0, 0], axis: [0, 0, -1], mirror: false, part: 'arm.L' }]);
  near(x(s, 'arm.L'), 0.25, 'arm'); near(x(s, 'torso'), 0.2, 'torso');
});

test('stretching the ghoul upper arm carries both elbows', () => {
  const g = model('ghoul');
  const base = stateFrom(g, (p) => p.joint != null);
  const s = replay(base, [{ t: 'stretch', part: 'upperArm.L', s: [1, 1.5, 1], mirror: true }]);
  const before = jointWorld(g.joints), after = jointWorld(s.joints);
  assert.ok(Math.abs(after.elL[1] - before.elL[1]) > 0.02, 'left elbow moved');
  near(after.elR[1], after.elL[1], 'right elbow matches');
});

test('moving the ghoul elbow stretches the upper arm and carries the forearm', () => {
  const g = model('ghoul');
  const base = stateFrom(g, (p) => p.joint != null);
  const s = replay(base, [{ t: 'joint', j: 'elL', d: [0.05, 0, 0], mirror: true }]);
  near(s.joints.elL.pos[0], g.joints.elL.pos[0] + 0.05, 'elbow joint moved');
  near(s.joints.elR.pos[0], g.joints.elR.pos[0] - 0.05, 'mirrored elbow moved the other way');
  // Upper-arm vertices near the shoulder barely move; near the elbow they move almost fully.
  const up0 = partNamed(base, 'upperArm.L'), up1 = partNamed(s, 'upperArm.L');
  let nearShoulder = Infinity, nearElbow = -Infinity;
  for (let v = 0; v < up0.pos.length / 3; v++) {
    const dx = up1.pos[v * 3] - up0.pos[v * 3];
    if (up0.pos[v * 3 + 1] > -0.03) nearShoulder = Math.min(nearShoulder, Math.abs(dx) < 0.01 ? 0 : dx);
    if (up0.pos[v * 3 + 1] < g.joints.elL.pos[1] + 0.03) nearElbow = Math.max(nearElbow, dx);
  }
  assert.equal(nearShoulder, 0, 'shoulder end stays');
  assert.ok(nearElbow > 0.035, `elbow end follows (${nearElbow})`);
  // The forearm's joint-local shape is unchanged: it rides the joint.
  assert.deepEqual(Array.from(partNamed(s, 'lowerArm.L').pos), Array.from(partNamed(base, 'lowerArm.L').pos));
});

test('poking a triangle replaces it with three raised ones', () => {
  const g = model('ghoul');
  const base = stateFrom(g, (p) => p.name === 'torso');
  const s = replay(base, [{ t: 'poke', list: [{ part: 'torso', f: 5 }], h: 0.04 }]);
  const p0 = partNamed(base, 'torso'), p1 = partNamed(s, 'torso');
  assert.equal(p1.idx.length, p0.idx.length + 9);
  assert.ok(p1.dead.has(5));
  assert.equal(p1.pos.length, p0.pos.length + 27);
  assert.equal(p1.uv.length, p0.uv.length + 18);
  assert.equal(p0.idx.length, g.parts.find((p) => p.name === 'torso').idx.length, 'the base state is untouched');
});

test('deleting triangles marks them dead without renumbering faces', () => {
  const g = model('ghoul');
  const s = replay(stateFrom(g, (p) => p.name === 'head'), [{ t: 'del', list: [{ part: 'head', f: [0, 3, 99999] }] }]);
  assert.deepEqual([...partNamed(s, 'head').dead].sort((a, b) => a - b), [0, 3]);
});

test('moving exact vertices applies their joint-local offset', () => {
  const s = replay(stateFrom(points(['p', 0.1])), [{ t: 'verts', sets: [{ part: 'p', v: [0, 7], d: [0, 0, 0.02] }] }]);
  near(x(s, 'p', 2), 0.02, 'z');
});

test('smoothing pulls a spike toward its neighbours', () => {
  // A fan of four triangles around a raised centre vertex (welded corners).
  const m = { joints: { root: { parent: null, pos: [0, 0, 0] } }, parts: [{
    name: 'fan', joint: 'root', nrm: null,
    pos: [0, 0.2, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, -1],
    idx: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4],
  }] };
  const s = replay(stateFrom(m), [{ t: 'smooth', cs: [[0, 0.2, 0]], r: 0.5, amt: 1, axis: null, mirror: false }]);
  assert.ok(partNamed(s, 'fan').pos[1] < 0.1, `centre lowered to ${partNamed(s, 'fan').pos[1]}`);
});

test('an added part is outward-facing and mirrored onto the other side', () => {
  for (const kind of Object.keys(KINDS)) {
    const op = { t: 'add', id: 1, kind, joint: 'root', at: [0.1, 0.5, 0], n: [1, 0, 0], s: 0.04, len: 0.1, lean: 25, twist: 30, uv: [0.25, 0.75], mirror: true };
    const tris = partTriangles(op);
    const all = tris.flat();
    const mid = [0, 1, 2].map((k) => all.reduce((a, v) => a + v[k], 0) / all.length);
    let outward = 0;
    for (const t of tris) {
      const u = t[1].map((v, k) => v - t[0][k]), w = t[2].map((v, k) => v - t[0][k]);
      const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
      if (fn[0] * (c[0] - mid[0]) + fn[1] * (c[1] - mid[1]) + fn[2] * (c[2] - mid[2]) > 0) outward++;
    }
    assert.ok(outward >= tris.length * 0.8, `${kind}: ${outward}/${tris.length} faces point out`);
    const s = replay(stateFrom(points(['body', 0])), [op]);
    const a = partNamed(s, `${kind}1`), b = partNamed(s, `${kind}1m`);
    assert.ok(a && b, `${kind}: both sides exist`);
    near(a.pos[0], -b.pos[0], `${kind}: mirrored x`);
    near(a.uv[0], 0.25, `${kind}: colour from the page`);
  }
});

test('mirror names swap sides and leave centre parts', () => {
  assert.equal(mirrorName('upperArm.L'), 'upperArm.R');
  assert.equal(mirrorName('thighR'), 'thighL');
  assert.equal(mirrorName('torso'), 'torso');
});

test('baking adds parts, drops removed triangles and keeps the model valid', () => {
  const g = model('ghoul');
  const tris0 = g.parts.find((p) => p.name === 'head').idx.length / 3;
  const lab = { ops: [
    { t: 'add', id: 1, kind: 'horn', joint: 'neck', at: [0.08, 1.75, 0], n: [1, 0.3, 0], s: 0.03, len: 0.1, lean: 30, twist: 0, uv: [0.5, 0.5], mirror: true },
    { t: 'del', list: [{ part: 'head', f: [0, 1] }] },
    { t: 'poke', list: [{ part: 'torso', f: 2 }], h: 0.03 },
  ] };
  const stats = bake(g, 'ghoul', lab, 'test1');
  assert.equal(stats.added, 2);
  const head = g.parts.find((p) => p.name === 'head');
  assert.equal(head.idx.length / 3, tris0 - 2);
  for (const p of g.parts) {
    const n = p.pos.length / 3;
    assert.equal(p.nrm.length, p.pos.length, `${p.name} normals`);
    if (p.uv) assert.equal(p.uv.length, n * 2, `${p.name} uvs`);
    assert.ok(p.idx.every((i) => i >= 0 && i < n), `${p.name} indices in range`);
  }
  assert.ok(g.parts.some((p) => p.name === 'horn1m' && p.joint === 'neck'));
  assert.equal(g.meta.revs.ghoul, 'test1');
});
