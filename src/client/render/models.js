// Low-poly character models exported from the Blender art pipeline
// (art/zombies/*, see art/STYLE.md) as JSON parts plus one painted texture page.
//
// public/models/<id>.json:
//   { version: 1, texture: "<id>.png", emissive?: "<id>_glow.png",
//     joints: { name: { parent: name|null, pos: [x, y, z] } },   // rest pose, metres, +Y up, facing +Z
//     parts:  [ { name, joint, pos: [...], nrm: [...], uv: [...], col?: [...], idx: [...] } ] }
// Part vertices are in their joint's local space; joint positions are relative to the parent.
// A model that fails to load resolves to null and the renderer keeps its procedural fallback.

import * as THREE from 'three';

const cache = new Map();

export function pageTexture(image) {
  const t = new THREE.Texture(image);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;      // hand-placed texels stay crisp
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 1;
  t.flipY = false;                        // UVs are exported with v = 0 at the top row
  t.needsUpdate = true;
  return t;
}

function geometryOf(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
  if (p.nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
  if (p.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
  if (p.col) g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
  if (p.idx) g.setIndex(p.idx);
  if (!p.nrm) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

async function loadOne(id, base) {
  const res = await fetch(`${base}${id}.json`);
  if (!res.ok) throw new Error(`${id}.json: ${res.status}`);
  const data = await res.json();
  const image = async (file) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = `${base}${file}`;
    await img.decode();
    return img;
  };
  const [page, glow] = await Promise.all([image(data.texture), data.emissive ? image(data.emissive) : null]);
  const parts = new Map();
  for (const p of data.parts) parts.set(p.name, { name: p.name, joint: p.joint, geometry: geometryOf(p), hasColor: !!p.col });
  return {
    id, joints: data.joints, parts, meta: data.meta || {},
    texture: pageTexture(page),
    emissive: glow ? pageTexture(glow) : null, // optional glow mask on the same UV layout
  };
}

// Resolves to { id: model | null }. Never rejects: a missing model just means fallback art.
export async function loadModels(ids, base = '/models/') {
  const out = {};
  await Promise.all(ids.map(async (id) => {
    if (!cache.has(id)) cache.set(id, loadOne(id, base).catch((err) => { console.warn('model', id, 'unavailable:', err.message); return null; }));
    out[id] = await cache.get(id);
  }));
  return out;
}

// Build a joint hierarchy (Object3D per joint) from a model's rest pose.
export function buildJoints(model, root = new THREE.Object3D()) {
  const nodes = { [model.rootName || 'root']: root };
  const pending = Object.entries(model.joints);
  let guard = 0;
  while (pending.length && guard++ < 999) {
    const [name, j] = pending.shift();
    const parent = j.parent ? nodes[j.parent] : root;
    if (!parent) { pending.push([name, j]); continue; }
    const o = new THREE.Object3D();
    o.name = name;
    o.position.fromArray(j.pos);
    parent.add(o);
    nodes[name] = o;
  }
  return nodes;
}
