// Model Workshop edits: replayable operations on a game model (art/STYLE.md
// export format) in its rest pose (metres, +Y up, facing +Z, character's left +X).
// The workshop page inlines this file (build-lab.mjs); bake.mjs replays the same
// operations into public/models/<id>.json, so the preview and the bake agree.
//
// A model state is { joints: { name: { parent, pos } }, parts: [part] } where a part is
//   { name, joint, at (joints it is drawn at when shared, else null), pos, nrm, uv, col,
//     idx (every face ever made; faces are only appended), dead (Set of removed faces),
//     add (id of the 'add' op that made it, else null) }.
// Arrays other than pos are never edited in place, so cloned states can share them.
//
// Operations (all positions in rest-pose world space unless noted):
//   move     { c, r, d, axis, mirror, part? }  brush: slide what is near c by d
//   inflate  { c, r, amt, axis, mirror, part? } brush: push along the surface normal
//   smooth   { cs, r, amt, axis, mirror, part? } brush stroke: relax toward neighbours near each centre
//     With axis (the view direction) a brush is a cylinder through the model, so
//     front and back move together; with axis null it is a sphere at c.
//   stretch  { part, s: [sx,sy,sz], mirror }    scale a part about its joint; child joints follow
//   joint    { j, d, mirror }                   move a joint: its parts and children follow,
//                                              the bone leading to it stretches
//   verts    { sets: [{ part, v: [vertex...], d (joint-local) }] }  move exact vertices
//   del      { list: [{ part, f: [face...] }] } remove triangles
//   poke     { list: [{ part, f }], h }         raise each triangle's centre into a point
//   add      { id, kind, joint, at, n, s, len, lean, twist, uv, mirror }  a new part

export function jointWorld(joints) {
  const out = {};
  const get = (n, depth = 0) => {
    if (out[n]) return out[n];
    const j = joints[n];
    if (!j || depth > 64) return [0, 0, 0];
    const p = j.parent ? get(j.parent, depth + 1) : [0, 0, 0];
    return (out[n] = [p[0] + j.pos[0], p[1] + j.pos[1], p[2] + j.pos[2]]);
  };
  for (const n of Object.keys(joints)) get(n);
  return out;
}

export function mirrorName(name) {
  const swaps = [['.L', '.R'], ['Left', 'Right'], ['L', 'R']];
  for (const [a, b] of swaps) {
    if (name.endsWith(a)) return name.slice(0, -a.length) + b;
    if (name.endsWith(b)) return name.slice(0, -b.length) + a;
  }
  return name;
}

export function childrenOf(joints) {
  const kids = {};
  for (const [n, j] of Object.entries(joints)) if (j.parent) (kids[j.parent] ||= []).push(n);
  return kids;
}

// --- State ------------------------------------------------------------------------------------------

export function stateFrom(model, include = () => true) {
  const shared = model.meta?.shared || {};
  const parts = [];
  for (const p of model.parts) {
    if (!include(p)) continue;
    parts.push({
      name: p.name, joint: p.joint ?? null, at: shared[p.name] || null,
      pos: Float32Array.from(p.pos),
      nrm: p.nrm ? Float32Array.from(p.nrm) : vertexNormals(p.pos, p.idx),
      uv: p.uv ? Float32Array.from(p.uv) : null,
      col: p.col ? Float32Array.from(p.col) : null,
      idx: Array.from(p.idx), dead: null, add: null,
    });
  }
  return { joints: structuredClone(model.joints || {}), parts };
}

export function cloneState(s) {
  return {
    joints: structuredClone(s.joints),
    parts: s.parts.map((p) => ({ ...p, pos: p.pos.slice(), dead: p.dead ? new Set(p.dead) : null })),
  };
}

export function partNamed(state, name) { return state.parts.find((p) => p.name === name) || null; }

// Every place a part is drawn: the right-hand copy of a shared part is mirrored (flipX).
export function instances(state) {
  const w = jointWorld(state.joints);
  const out = [];
  for (const p of state.parts) {
    (p.at || [p.joint]).forEach((j, k) => out.push({ p, part: p.name, joint: j, pos: p.pos, nrm: p.nrm, origin: j ? (w[j] || [0, 0, 0]) : [0, 0, 0], flipX: k > 0 }));
  }
  return out;
}

export function liveFaces(p) {
  const n = p.idx.length / 3;
  if (!p.dead || !p.dead.size) return null;
  const out = [];
  for (let f = 0; f < n; f++) if (!p.dead.has(f)) out.push(f);
  return out;
}

export function replay(base, ops) {
  const s = cloneState(base);
  for (const op of ops) applyOp(s, op);
  return s;
}

export function applyOp(s, op) {
  switch (op.t) {
    case 'move': case 'inflate': case 'smooth': brush(s, op); break;
    case 'stretch': stretch(s, op); break;
    case 'joint': moveJoint(s, op); break;
    case 'verts': moveVerts(s, op); break;
    case 'del':
      for (const { part, f } of op.list || [{ part: op.part, f: op.f }]) {
        const p = partNamed(s, part);
        if (p) p.dead = new Set([...(p.dead || []), ...f.filter((x) => x >= 0 && x < p.idx.length / 3)]);
      }
      break;
    case 'poke': poke(s, op); break;
    case 'add': addPart(s, op); break;
    default: break;
  }
  return s;
}

// --- Brushes ---------------------------------------------------------------------------------------

function fall(d, r) {
  const x = Math.max(0, 1 - d / r);
  return x * x * (3 - 2 * x);
}

function dist(px, py, pz, c, a) {
  const vx = px - c[0], vy = py - c[1], vz = pz - c[2];
  if (!a) return Math.hypot(vx, vy, vz);
  const k = vx * a[0] + vy * a[1] + vz * a[2];
  return Math.hypot(vx - k * a[0], vy - k * a[1], vz - k * a[2]);
}

// Welded vertex groups (split corners at one position) and their neighbours.
function welds(p) {
  const key = new Map(), group = new Int32Array(p.pos.length / 3), members = [];
  for (let v = 0; v < group.length; v++) {
    const k = `${Math.round(p.pos[v * 3] * 1e5)},${Math.round(p.pos[v * 3 + 1] * 1e5)},${Math.round(p.pos[v * 3 + 2] * 1e5)}`;
    let g = key.get(k);
    if (g === undefined) { g = members.length; key.set(k, g); members.push([]); }
    group[v] = g; members[g].push(v);
  }
  const nb = members.map(() => new Set());
  for (let f = 0; f < p.idx.length / 3; f++) {
    if (p.dead && p.dead.has(f)) continue;
    const a = group[p.idx[f * 3]], b = group[p.idx[f * 3 + 1]], c = group[p.idx[f * 3 + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return { group, members, nb };
}

function brush(s, op) {
  const cs = op.cs || [op.c]; // a smoothing stroke passes several centres
  const cs2 = cs.map((c) => [-c[0], c[1], c[2]]);
  const near = (x, y, z, list, a) => { let w = 0; for (const c of list) w = Math.max(w, fall(dist(x, y, z, c, a), op.r)); return w; };
  const a2 = op.axis ? [-op.axis[0], op.axis[1], op.axis[2]] : null;
  const d = op.d, d2 = d && [-d[0], d[1], d[2]];
  const twin = op.part && op.mirror ? mirrorName(op.part) : op.part;
  // Group the places each vertex array is drawn (a shared part is drawn twice).
  const groups = new Map();
  for (const inst of instances(s)) {
    const own = !op.part || inst.part === op.part;
    const mir = op.mirror && (!op.part || inst.part === twin);
    if (!own && !mir) continue;
    let g = groups.get(inst.pos);
    if (!g) groups.set(inst.pos, (g = []));
    g.push({ inst, own, mir });
  }
  // Each vertex moves once, by the strongest weight over every place it is drawn
  // and (with mirror on) both sides of the brush, so a stroke across the centre
  // line stays symmetric and never moves anything twice.
  for (const [p, g] of groups) {
    const part = g[0].inst.p;
    const n = p.length / 3;
    const W = new Float64Array(n), D = new Array(n), FX = new Int8Array(n).fill(1);
    for (let v = 0; v < n; v++) {
      const i = v * 3;
      for (const { inst, own, mir } of g) {
        const f = inst.flipX ? -1 : 1, o = inst.origin;
        const wx = o[0] + p[i] * f, wy = o[1] + p[i + 1], wz = o[2] + p[i + 2];
        if (own) { const w1 = near(wx, wy, wz, cs, op.axis); if (w1 > W[v]) { W[v] = w1; D[v] = d; FX[v] = f; } }
        if (mir) { const w2 = near(wx, wy, wz, cs2, a2); if (w2 > W[v]) { W[v] = w2; D[v] = d2; FX[v] = f; } }
      }
    }
    if (op.t === 'move') {
      for (let v = 0; v < n; v++) {
        const w = W[v]; if (w <= 0) continue;
        const i = v * 3, dd = D[v];
        p[i] += dd[0] * w * FX[v]; p[i + 1] += dd[1] * w; p[i + 2] += dd[2] * w;
      }
    } else if (op.t === 'inflate') {
      const nr = part.nrm;
      for (let v = 0; v < n; v++) {
        const w = W[v]; if (w <= 0) continue;
        const i = v * 3;
        p[i] += nr[i] * op.amt * w; p[i + 1] += nr[i + 1] * op.amt * w; p[i + 2] += nr[i + 2] * op.amt * w;
      }
    } else if (op.t === 'smooth') {
      const { members, nb } = welds(part);
      const next = [];
      for (let gi = 0; gi < members.length; gi++) {
        const v0 = members[gi][0];
        let w = 0;
        for (const v of members[gi]) w = Math.max(w, W[v]);
        if (w <= 0 || !nb[gi].size) continue;
        let ax = 0, ay = 0, az = 0;
        for (const o of nb[gi]) { const u = members[o][0] * 3; ax += p[u]; ay += p[u + 1]; az += p[u + 2]; }
        const k = nb[gi].size, t = Math.min(1, w * op.amt);
        next.push([gi, (ax / k - p[v0 * 3]) * t, (ay / k - p[v0 * 3 + 1]) * t, (az / k - p[v0 * 3 + 2]) * t]);
      }
      for (const [gi, dx, dy, dz] of next) for (const v of members[gi]) { p[v * 3] += dx; p[v * 3 + 1] += dy; p[v * 3 + 2] += dz; }
    }
  }
}

// --- Rig --------------------------------------------------------------------------------------------

function stretch(s, op) {
  const names = new Set([op.part]);
  if (op.mirror) names.add(mirrorName(op.part));
  const kids = childrenOf(s.joints);
  const sc = op.s, seen = new Set(), scaled = new Set();
  for (const inst of instances(s)) {
    if (!names.has(inst.part)) continue;
    if (!seen.has(inst.pos)) {
      seen.add(inst.pos);
      const p = inst.pos;
      for (let i = 0; i < p.length; i += 3) { p[i] *= sc[0]; p[i + 1] *= sc[1]; p[i + 2] *= sc[2]; }
    }
    if (inst.joint && !scaled.has(inst.joint)) {
      scaled.add(inst.joint);
      for (const c of kids[inst.joint] || []) {
        const q = s.joints[c].pos;
        s.joints[c].pos = [q[0] * sc[0], q[1] * sc[1], q[2] * sc[2]];
      }
    }
  }
}

// Moving a joint carries its parts and child joints. The bone that leads to it
// stretches: when the parent joint has only this child (an arm or leg chain) the
// parent's parts stretch along the bone; otherwise (a spine with a neck and two
// shoulders) only the parent's surface near the joint follows.
function moveJoint(s, op) {
  const kids = childrenOf(s.joints);
  const list = [[op.j, op.d]];
  if (op.mirror) {
    const m = mirrorName(op.j);
    if (m !== op.j && s.joints[m]) list.push([m, [-op.d[0], op.d[1], op.d[2]]]);
  }
  const done = new Set();
  for (const [j, d] of list) {
    const J = s.joints[j];
    if (!J) continue;
    const w = jointWorld(s.joints);
    const P = J.parent;
    if (P) {
      const pw = w[P], jw = w[j];
      const bone = [jw[0] - pw[0], jw[1] - pw[1], jw[2] - pw[2]];
      const L2 = bone[0] * bone[0] + bone[1] * bone[1] + bone[2] * bone[2] || 1e-9;
      const chain = (kids[P] || []).length === 1;
      const R = Math.sqrt(L2) * 0.5;
      for (const inst of instances(s)) {
        if (inst.joint !== P || done.has(inst.pos)) continue;
        done.add(inst.pos);
        const p = inst.pos, fx = inst.flipX ? -1 : 1;
        for (let i = 0; i < p.length; i += 3) {
          const rx = p[i] * fx, ry = p[i + 1], rz = p[i + 2];
          let wt;
          if (chain) wt = Math.min(1, Math.max(0, (rx * bone[0] + ry * bone[1] + rz * bone[2]) / L2));
          else wt = fall(Math.hypot(rx - bone[0], ry - bone[1], rz - bone[2]), R);
          if (wt <= 0) continue;
          p[i] += d[0] * wt * fx; p[i + 1] += d[1] * wt; p[i + 2] += d[2] * wt;
        }
      }
    }
    J.pos = [J.pos[0] + d[0], J.pos[1] + d[1], J.pos[2] + d[2]];
  }
}

// --- Triangles --------------------------------------------------------------------------------------

function moveVerts(s, op) {
  for (const set of op.sets) {
    const p = partNamed(s, set.part);
    if (!p) continue;
    const n = p.pos.length / 3;
    for (const v of set.v) {
      if (v < 0 || v >= n) continue;
      p.pos[v * 3] += set.d[0]; p.pos[v * 3 + 1] += set.d[1]; p.pos[v * 3 + 2] += set.d[2];
    }
  }
}

function poke(s, op) {
  for (const { part, f } of op.list || [{ part: op.part, f: op.f }]) pokeFace(s, part, f, op.h);
}

function pokeFace(s, name, face, h) {
  const p = partNamed(s, name);
  if (!p || face * 3 + 2 >= p.idx.length || (p.dead && p.dead.has(face))) return;
  const [a, b, c] = p.idx.slice(face * 3, face * 3 + 3);
  const P = (v, k) => p.pos[v * 3 + k];
  const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2);
  const vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const m = [0, 1, 2].map((k) => (P(a, k) + P(b, k) + P(c, k)) / 3 + [nx, ny, nz][k] * h);
  const avg = (arr, w) => arr && [0, 1, 2].slice(0, w).map((k) => (arr[a * w + k] + arr[b * w + k] + arr[c * w + k]) / 3);
  const n0 = p.pos.length / 3;
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const corner = (v) => {
    for (let k = 0; k < 3; k++) { pos.push(p.pos[v * 3 + k]); nrm.push([nx, ny, nz][k]); }
    if (p.uv) uv.push(p.uv[v * 2], p.uv[v * 2 + 1]);
    if (p.col) col.push(p.col[v * 3], p.col[v * 3 + 1], p.col[v * 3 + 2]);
  };
  const mid = () => {
    pos.push(...m); nrm.push(nx, ny, nz);
    if (p.uv) uv.push(...avg(p.uv, 2));
    if (p.col) col.push(...avg(p.col, 3));
  };
  let k = n0;
  for (const [x, y] of [[a, b], [b, c], [c, a]]) { corner(x); corner(y); mid(); idx.push(k, k + 1, k + 2); k += 3; }
  const cat = (A, B, T) => { const out = new T(A.length + B.length); out.set(A); out.set(B, A.length); return out; };
  p.pos = cat(p.pos, pos, Float32Array);
  p.nrm = cat(p.nrm, nrm, Float32Array);
  if (p.uv) p.uv = cat(p.uv, uv, Float32Array);
  if (p.col) p.col = cat(p.col, col, Float32Array);
  p.idx = p.idx.concat(idx);
  p.dead = new Set([...(p.dead || []), face]);
}

// --- Parts ------------------------------------------------------------------------------------------
// Unit shapes stand on y = 0 and reach y = 1; x and z span about -1..1. `lean`
// (radians) bends the tip toward +z. Every face gets its own corners (hard facets).

function ring(n, r, y, z, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push([Math.cos(a) * r, y, z + Math.sin(a) * r]); }
  return out;
}
function loft(rings, tip) {
  const f = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k], B = rings[k + 1], n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push([A[i], B[j], A[j]], [A[i], B[i], B[j]]); }
  }
  const L = rings[rings.length - 1];
  for (let i = 0; i < L.length; i++) f.push([L[i], tip, L[(i + 1) % L.length]]);
  const B0 = rings[0];
  for (let i = 1; i + 1 < B0.length; i++) f.push([B0[0], B0[i], B0[i + 1]]);
  return f;
}
export const KINDS = {
  spike: (o) => { const b = Math.tan(o.lean || 0); return loft([ring(4, 1, 0, 0, Math.PI / 4)], [0, 1, b]); },
  horn: (o) => {
    const b = Math.tan(o.lean || 0);
    const rs = [[0, 1], [0.35, 0.72], [0.68, 0.42]].map(([y, r]) => ring(5, r, y, b * y * y));
    return loft(rs, [0, 1, b]);
  },
  fin: (o) => {
    const b = Math.tan(o.lean || 0) * 0.8, t = 0.18;
    const P = [[0, 0, -1], [0, 0, 1], [0, 1, -0.4 + b]];
    const L = P.map(([x, y, z]) => [x - t, y, z]), R = P.map(([x, y, z]) => [x + t, y, z]);
    return [[L[0], L[2], L[1]], [R[0], R[1], R[2]],
      [L[0], L[1], R[1]], [L[0], R[1], R[0]], [L[1], L[2], R[2]], [L[1], R[2], R[1]], [L[2], L[0], R[0]], [L[2], R[0], R[2]]];
  },
  blob: () => {
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l * 0.5 + 0.5, z / l]; });
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    return F.map((f) => f.map((i) => V[i]));
  },
  box: () => {
    const c = (x, y, z) => [x, y, z];
    const v = [c(-1, 0, -1), c(1, 0, -1), c(1, 0, 1), c(-1, 0, 1), c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)];
    const q = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    return q.flatMap(([a, b, cc, d]) => [[v[a], v[b], v[cc]], [v[a], v[cc], v[d]]]);
  },
  tooth: (o) => { const b = Math.tan(o.lean || 0); return loft([ring(3, 1, 0, 0, Math.PI / 2)], [0, 1, b]); },
};

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// World-space triangles for an add op (before mirroring).
export function partTriangles(op) {
  const n = norm(op.n);
  // Tangent frame: lean toward world up when the surface faces sideways (horns
  // curl up), toward the back when it faces up or down (spines sweep back).
  const up = Math.abs(n[1]) < 0.8 ? [0, 1, 0] : [0, 0, -1];
  let z = norm(sub(up, n.map((v) => v * (up[0] * n[0] + up[1] * n[1] + up[2] * n[2]))));
  let x = norm(cross(n, z));
  const tw = ((op.twist || 0) * Math.PI) / 180;
  const cz = Math.cos(tw), sz = Math.sin(tw);
  [x, z] = [x.map((v, i) => v * cz - z[i] * sz), z.map((v, i) => z[i] * cz + x[i] * sz)];
  const s = op.s || 0.04, len = op.len || 0.08, sink = 0.18 * Math.min(len, s * 2);
  const lean = ((op.lean || 0) * Math.PI) / 180;
  const shape = orient((KINDS[op.kind] || KINDS.spike)({ lean }), op.kind, Math.tan(lean));
  const place = ([px, py, pz]) => [0, 1, 2].map((k) => op.at[k] + x[k] * px * s + n[k] * (py * len - sink) + z[k] * pz * s);
  return shape.map((tri) => tri.map(place));
}

// Face every triangle away from the shape's core (its bent axis, or its centre).
function orient(tris, kind, b) {
  const all = tris.flat();
  const mean = [0, 1, 2].map((k) => all.reduce((s, v) => s + v[k], 0) / all.length);
  const core = (y) => (kind === 'horn' ? [0, y, b * y * y] : kind === 'spike' || kind === 'tooth' ? [0, y, b * y] : mean);
  return tris.map((t) => {
    const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
    const fn = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    const out = sub(c, core(Math.min(0.95, Math.max(0.05, c[1]))));
    return fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0 ? [t[0], t[2], t[1]] : t;
  });
}

function addPart(s, op) {
  const w = jointWorld(s.joints);
  const build = (tris, joint, name, flip) => {
    const o = joint ? (w[joint] || [0, 0, 0]) : [0, 0, 0];
    const pos = [], nrm = [], idx = [];
    tris.forEach((t, f) => {
      const T = flip ? [t[0], t[2], t[1]] : t;
      const fn = norm(cross(sub(T[1], T[0]), sub(T[2], T[0])));
      for (const v of T) { pos.push(v[0] - o[0], v[1] - o[1], v[2] - o[2]); nrm.push(...fn); }
      idx.push(f * 3, f * 3 + 1, f * 3 + 2);
    });
    const count = pos.length / 3;
    const uv = new Float32Array(count * 2);
    for (let v = 0; v < count; v++) { uv[v * 2] = op.uv ? op.uv[0] : 0.5; uv[v * 2 + 1] = op.uv ? op.uv[1] : 0.5; }
    s.parts.push({ name, joint, at: null, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv, col: null, idx, dead: null, add: op.id });
  };
  const tris = partTriangles(op);
  build(tris, op.joint, `${op.kind}${op.id}`, false);
  if (op.mirror && Math.abs(op.at[0]) > 0.004) {
    const mj = op.joint && s.joints[mirrorName(op.joint)] ? mirrorName(op.joint) : op.joint;
    build(tris.map((t) => t.map(([x, y, z]) => [-x, y, z])), mj, `${op.kind}${op.id}m`, true);
  }
}

// --- Normals ----------------------------------------------------------------------------------------

// Per-vertex normals from an indexed triangle list (split vertices keep hard edges).
export function vertexNormals(pos, idx, out, dead) {
  const n = out || new Float32Array(pos.length);
  n.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    if (dead && dead.has(t / 3)) continue;
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}
