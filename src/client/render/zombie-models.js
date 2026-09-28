// The horde's looks: which painted model (public/models/<id>.json) a window
// zombie wears. Purely cosmetic: every model keeps its class's rules and hit
// volumes (enemies.js), and all clients agree because the pick comes from the
// zombie's network id, never the simulation RNG or which files loaded.
//
//   glow    emissive strength for the model's _glow page (the model's own
//           meta.glow.emissiveIntensity wins)
//   weight  how often it turns up per class: [walker, jogger, runner]
//
// Each new zombie borrows something the owner liked: the Mended are Kintsugi's
// gold-mended porcelain on a shambling mechanic, the Stoker is an ember-cracked
// brute on the jog, and the Gasser runs in the Rotted style's sick green.
export const ZOMBIE_MODELS = {
  ghoul: { glow: 0.4, weight: [4, 3, 3] },
  mended: { glow: 0.4, weight: [4, 1, 0] },
  stoker: { glow: 1.4, weight: [1, 4, 1] },
  gasser: { glow: 0.8, weight: [1, 2, 5] },
};

// The model for zombie `id` of class `cls` (0 walker, 1 jogger, 2 runner).
export function zombieModelId(id, cls = 0) {
  const col = Math.max(0, Math.min(2, cls | 0));
  const entries = Object.entries(ZOMBIE_MODELS).filter(([, m]) => m.weight[col] > 0);
  const total = entries.reduce((s, [, m]) => s + m.weight[col], 0);
  let r = ((Math.imul((id | 0) ^ 0x9e3779b9, 2654435761) >>> 0) / 4294967296) * total;
  for (const [key, m] of entries) {
    r -= m.weight[col];
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

// How the zombie renderer treats one exported part. A model's meta can name its
// headwear (drawn per zombie), parts that go with the head on a headshot
// (head_parts or hideWithHead), and unlit parts (eyes by default).
export function zombiePartFlags(model, name) {
  const meta = model.meta || {};
  const hat = (meta.headwear || ['cap', 'helmet']).includes(name)
    ? (name === 'cap' ? 1 : name === 'helmet' ? 2 : 0) : 0;
  return {
    hat,
    head: name === 'head' || name === 'eyes' || hat > 0
      || (meta.head_parts || []).includes(name) || (meta.hideWithHead || []).includes(name),
    skin: name === 'head',
    unlit: (meta.unlit || ['eyes']).includes(name),
  };
}
