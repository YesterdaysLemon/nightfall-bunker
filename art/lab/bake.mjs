// Bakes Model Workshop edits into a game model (public/models/<file>.json).
//   node art/lab/bake.mjs <id> <workshop-doc.json> --rev <new tag> [--dry]
// <workshop-doc.json> is the workshop's saved document for that model ({ rev, ops,
// notes, ... }, e.g. from the artifact db). Its ops replay exactly as the workshop
// previewed them (art/lab/editops.mjs) on the same base: every jointed part,
// including ones the workshop hides (the ghoul's other headwear, Kintsugi's damage
// pieces), so they follow the surface they sit on. The props (figurine, teacup)
// are their own models inside kintsugi.json.
// Normals are recomputed only around moved or new vertices, keeping untouched
// facets as exported. Removed triangles are dropped and unused vertices compacted.
// Parts drawn at several joints (meta.shared) become explicit left/right parts.
// The applied edits are recorded under art/lab/edits/<id>-<rev>.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateFrom, replay, vertexNormals } from './editops.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const PROPS = { figurine: ['figurine', 'figbase'], teacup: ['teacup'] };

export function baseInclude(id) {
  const only = PROPS[id];
  return only ? (p) => only.includes(p.name) : (p) => p.joint != null;
}
export function modelFile(id) { return PROPS[id] ? 'kintsugi' : id; }

export function bake(model, id, lab, rev) {
  const base = stateFrom(model, baseInclude(id));
  const st = replay(base, lab.ops || []);
  const r4 = (v) => Math.round(v * 10000) / 10000 || 0;
  const byName = new Map(model.parts.map((p) => [p.name, p]));
  const stats = { moved: 0, total: 0, maxd: 0, added: 0, removed: 0 };
  const out = [];
  for (const p of st.parts) {
    const orig = byName.get(p.name) && !p.add ? byName.get(p.name) : null;
    const n0 = orig ? orig.pos.length / 3 : 0;
    const count = p.pos.length / 3;
    const touched = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      if (v >= n0) { touched[v] = 1; continue; }
      const d = Math.hypot(p.pos[v * 3] - orig.pos[v * 3], p.pos[v * 3 + 1] - orig.pos[v * 3 + 1], p.pos[v * 3 + 2] - orig.pos[v * 3 + 2]);
      if (d > 1e-6) { touched[v] = 1; stats.moved++; stats.maxd = Math.max(stats.maxd, d); }
    }
    stats.total += n0;
    // Fresh normals for every corner of a live triangle with a moved or new corner.
    const fresh = vertexNormals(p.pos, p.idx, null, p.dead);
    const nrm = Float32Array.from(p.nrm);
    const faces = [];
    for (let f = 0; f < p.idx.length / 3; f++) {
      if (p.dead && p.dead.has(f)) { if (f < (orig ? orig.idx.length / 3 : 0)) stats.removed++; continue; }
      faces.push(f);
      const [a, b, c] = p.idx.slice(f * 3, f * 3 + 3);
      if (touched[a] || touched[b] || touched[c]) for (const v of [a, b, c]) for (let k = 0; k < 3; k++) nrm[v * 3 + k] = fresh[v * 3 + k];
    }
    if (!faces.length) continue;
    // Compact to the vertices live faces use.
    const remap = new Int32Array(count).fill(-1);
    const keep = [];
    const idx = [];
    for (const f of faces) for (let k = 0; k < 3; k++) {
      const v = p.idx[f * 3 + k];
      if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); }
      idx.push(remap[v]);
    }
    const pick = (arr, w) => arr && keep.flatMap((v) => Array.from(arr.subarray(v * w, v * w + w), r4));
    const part = { name: p.name, joint: p.joint, pos: pick(p.pos, 3), nrm: pick(nrm, 3) };
    if (p.uv) part.uv = pick(p.uv, 2);
    if (p.col) part.col = pick(p.col, 3);
    part.idx = idx;
    if (p.add) stats.added++;
    if (p.at) part.at = p.at;
    out.push(part);
  }
  // Explicit sides for shared parts; the second joint gets the mirror image.
  const parts = [];
  for (const p of out) {
    const js = p.at;
    delete p.at;
    if (!js) { parts.push(p); continue; }
    js.forEach((j, k) => {
      const side = /L$/.test(j) ? 'L' : /R$/.test(j) ? 'R' : String(k);
      if (k === 0) { parts.push({ ...p, name: `${p.name}.${side}`, joint: j }); return; }
      const pos = p.pos.slice(), nrm = p.nrm.slice(), idx = p.idx.slice();
      for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i] || 0; nrm[i] = -nrm[i] || 0; }
      for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
      parts.push({ ...p, name: `${p.name}.${side}`, joint: j, pos, nrm, idx });
    });
  }
  // Put the edited parts back in the model, keeping parts outside this base in place.
  const inBase = baseInclude(id);
  const untouched = model.parts.filter((p) => !inBase(p));
  model.parts = PROPS[id] ? [...untouched, ...parts] : [...parts, ...untouched];
  if (!PROPS[id]) for (const j of Object.values(st.joints)) j.pos = j.pos.map(r4);
  if (!PROPS[id]) model.joints = st.joints;
  const meta = (model.meta ||= {});
  if (meta.shared) {
    delete meta.shared;
    if (meta.note && /shared parts/.test(meta.note)) meta.note = 'legs are explicit left/right parts (sculpted in the Model Workshop)';
  }
  if (typeof meta.tris === 'number') meta.tris = model.parts.reduce((s, p) => s + p.idx.length / 3, 0);
  else if (meta.tris && typeof meta.tris === 'object') {
    meta.tris = Object.fromEntries(model.parts.filter((p) => p.joint != null || PROPS[id]).map((p) => [p.name, p.idx.length / 3]));
  }
  const revs = (meta.revs ||= {});
  revs[id] = rev;
  if (!PROPS[id]) meta.rev = rev;
  meta.lab = { ...(meta.lab || {}), [id]: { rev, bakedAt: new Date().toISOString(), ops: (lab.ops || []).length, edits: `art/lab/edits/${id}-${rev}.json` } };
  return stats;
}

export function modelRev(model, id) { return model.meta?.revs?.[id] || (PROPS[id] ? 'r0' : model.meta?.rev) || 'r0'; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [id, docPath, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  const rev = opt('--rev');
  if (!id || !docPath || !rev) {
    console.error('usage: node art/lab/bake.mjs <id> <workshop-doc.json> --rev <new tag> [--dry]');
    process.exit(2);
  }
  const modelPath = join(repo, 'public', 'models', `${modelFile(id)}.json`);
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const raw = JSON.parse(readFileSync(docPath, 'utf8'));
  const lab = raw.data || raw;
  if (!(lab.ops || []).length) { console.error(`${id}: no shape edits to bake`); process.exit(1); }
  const have = modelRev(model, id);
  if ((lab.rev || 'r0') !== have) {
    console.error(`${id}: these edits were made on model rev ${lab.rev || 'r0'}, but the model is now ${have}`);
    process.exit(1);
  }
  const page = lab.page || {};
  if ((page.b ?? 1) !== 1 || (page.c ?? 1) !== 1 || (page.s ?? 1) !== 1 || (page.h ?? 0) !== 0) {
    console.error(`${id}: page adjustments are not baked yet; reset them or bake the page by hand`);
    process.exit(1);
  }
  if (Object.keys(lab.tints || {}).length) console.warn(`${id}: part tints are a preview only and are not baked`);
  const s = bake(model, id, lab, rev);
  console.log(`${id}: ${lab.ops.length} edits moved ${s.moved}/${s.total} vertices (max ${(s.maxd * 100).toFixed(1)} cm), added ${s.added} parts, removed ${s.removed} triangles`);
  if (rest.includes('--dry')) process.exit(0);
  writeFileSync(modelPath, JSON.stringify(model));
  mkdirSync(join(here, 'edits'), { recursive: true });
  writeFileSync(join(here, 'edits', `${id}-${rev}.json`), JSON.stringify({ model: id, rev, from: lab.rev || 'r0', bakedAt: model.meta.lab[id].bakedAt, ops: lab.ops, notes: lab.notes || [] }));
  console.log(`wrote public/models/${modelFile(id)}.json and art/lab/edits/${id}-${rev}.json`);
}
