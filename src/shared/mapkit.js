// Building blocks for maps (map.js is the bunker, maps/palace.js the picture
// palace): collision boxes, walls with holes, slabs, stairs, windows and the
// defaults every map object gets (defineMap). Pure data and functions, shared by
// the browser, the Node server and the Worker.
//
// Axes: +x east, +z south, +y up. Metres. Boxes are { b: [x0, y0, z0, x1, y1, z1], tag }.

// Box tags that are floors to stand on (the navigation grid reads their tops;
// every other tag is an obstacle).
export const FLOOR_TAGS = new Set(['floor0', 'floor', 'slab', 'step', 'stage', 'landing']);

export function box(x0, y0, z0, x1, y1, z1, tag) {
  return { b: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], tag };
}

// A wall along one axis at coordinate c, from p0 to p1, with rectangular holes
// ({ a, b, y0, y1 }: positions along the axis and the hole's bottom and top).
export function wallRun(axis, c, p0, p1, y0, y1, holes, tag, thick = 0.3) {
  const out = [];
  const mk = (a, b, ya, yb) => {
    if (b - a < 1e-3 || yb - ya < 1e-3) return;
    out.push(axis === 'x'
      ? box(a, ya, c - thick / 2, b, yb, c + thick / 2, tag)
      : box(c - thick / 2, ya, a, c + thick / 2, yb, b, tag));
  };
  const hs = holes.filter((h) => h.b > p0 && h.a < p1).sort((m, n) => m.a - n.a);
  let cur = p0;
  for (const h of hs) {
    mk(cur, h.a, y0, y1);
    mk(h.a, h.b, y0, Math.max(y0, h.y0));
    mk(h.a, h.b, Math.min(y1, h.y1), y1);
    cur = h.b;
  }
  mk(cur, p1, y0, y1);
  return out;
}

// A rectangle split around hole rectangles ([x0, z0, x1, z1]) into non-overlapping boxes.
export function slabWithHoles(x0, z0, x1, z1, y0, y1, holes, tag) {
  const xs = new Set([x0, x1]);
  for (const h of holes) { xs.add(Math.max(x0, Math.min(x1, h[0]))); xs.add(Math.max(x0, Math.min(x1, h[2]))); }
  const xa = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xa.length - 1; i++) {
    const a = xa[i], b = xa[i + 1];
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const cuts = holes.filter((h) => mid > h[0] && mid < h[2]).map((h) => [h[1], h[3]]).sort((m, n) => m[0] - n[0]);
    let cz = z0;
    for (const [h0, h1] of cuts) {
      if (h0 > cz) out.push(box(a, y0, cz, b, y1, h0, tag));
      cz = Math.max(cz, h1);
    }
    if (z1 > cz) out.push(box(a, y0, cz, b, y1, z1, tag));
  }
  return out;
}

// Windows zombies tear into: from { id, zone, x, z, n: outward normal [nx, nz],
// base (floor height), width?, sill?, top? } derive where a zombie stands to tear
// the boards (outside), where it lands (inside) and where players rebuild (repair).
export function makeWindows(list, { width = 1.4, sill = 0.9, top = 2.2, boards = 6 } = {}) {
  return list.map((w) => {
    const base = w.base ?? 0;
    const [nx, nz] = w.n;
    return {
      ...w,
      level: w.level ?? (base > 0.6 ? 1 : 0),
      width: w.width ?? width,
      base,
      sill: base + (w.sill ?? sill),
      top: base + (w.top ?? top),
      outside: [w.x + nx * 0.75, base, w.z + nz * 0.75],
      inside: [w.x - nx * 0.9, base, w.z - nz * 0.9],
      repair: [w.x - nx * 1.1, base, w.z - nz * 1.1],
      boards,
    };
  });
}

// The wall holes the windows on one wall need (for wallRun).
export function windowHoles(windows, filter) {
  return windows.filter(filter).map((w) => {
    const along = w.n[0] === 0 ? w.x : w.z;
    return { a: along - w.width / 2, b: along + w.width / 2, y0: w.sill, y1: w.top };
  });
}

// Players can never climb through a window; zombies do (their own path).
export function windowBlockers(windows, T = 0.3) {
  return windows.map((w) => {
    const hx = w.n[0] === 0 ? w.width / 2 : T / 2 + 0.05;
    const hz = w.n[0] === 0 ? T / 2 + 0.05 : w.width / 2;
    return box(w.x - hx, w.sill, w.z - hz, w.x + hx, w.top, w.z + hz, 'window');
  });
}

// --- Stairs ----------------------------------------------------------------------------
// A flight: { id, axis: 'x' | 'z', dir: +1 | -1 (the way it climbs along the axis),
// start (where it starts along the axis), a0, a1 (its extent across), steps, run,
// rise, y0 (the floor it starts from, default 0) }.

export function stairFootprint(s) {
  const len = s.steps * s.run;
  const lo = s.dir > 0 ? s.start : s.start - len;
  const hi = s.dir > 0 ? s.start + len : s.start;
  return s.axis === 'z' ? [s.a0, lo, s.a1, hi] : [lo, s.a0, hi, s.a1];
}

// Continuous ramp height over a flight (zombies glide up stairs), or null off every flight.
export function rampHeight(stairs, x, z) {
  for (const s of stairs) {
    const [x0, z0, x1, z1] = stairFootprint(s);
    const along = s.axis === 'z' ? z : x;
    const across = s.axis === 'z' ? x : z;
    const [lo, hi] = s.axis === 'z' ? [z0, z1] : [x0, x1];
    if (along >= lo - 0.05 && along <= hi + 0.05 && across >= s.a0 && across <= s.a1) {
      const u = s.dir > 0 ? along - s.start : s.start - along;
      const climb = s.steps * s.rise;
      return (s.y0 ?? 0) + Math.max(0, Math.min(climb, (u / (s.steps * s.run)) * climb));
    }
  }
  return null;
}

// Solid step columns, plus a full-height rail along the open side(s) when `rail` is
// 'a0', 'a1' or 'both' (the side the flight is open to a drop).
export function stairBoxes(stairs) {
  const out = [];
  for (const s of stairs) {
    const y0 = s.y0 ?? 0;
    for (let i = 0; i < s.steps; i++) {
      const a = s.dir > 0 ? s.start + i * s.run : s.start - (i + 1) * s.run;
      const top = y0 + (i + 1) * s.rise;
      const put = (p0, p1, c0, c1, yb, yt, tag) => out.push(s.axis === 'z' ? box(c0, yb, p0, c1, yt, p1, tag) : box(p0, yb, c0, p1, yt, c1, tag));
      put(a, a + s.run, s.a0, s.a1, s.base ?? 0, top, 'step');
      for (const side of s.rail === 'both' ? ['a0', 'a1'] : s.rail ? [s.rail] : []) {
        const c = s[side];
        const [c0, c1] = side === 'a0' ? [c - 0.1, c] : [c, c + 0.1];
        put(a, a + s.run, c0, c1, s.base ?? 0, top + 1.0, 'rail');
      }
    }
  }
  return out;
}

// --- Map defaults ------------------------------------------------------------------------
// Fills in what the rules, collision and navigation read, from a map's own data:
//   NAV_LEVELS   floor heights, lowest first (the grid keeps one layer per level)
//   NAV_REGIONS  per level, the rectangles [x0, z0, x1, z1] players and zombies walk
//   navBounds    [x0, z0, x1, z1] the grid covers; playBounds [x0, z0, x1, z1, yMax]
//   walkable(x, z, level), openZones(openDoorIds), stairHeightAt(x, z)
export function defineMap(m) {
  const regions = m.NAV_REGIONS;
  const walkable = m.walkable || ((x, z, level) => (regions[level] || []).some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]));
  const openZones = m.openZones || ((ids) => {
    const zones = new Set(['start']);
    for (const d of m.DOORS) if (ids.has(d.id)) for (const z of d.opens) zones.add(z);
    return zones;
  });
  return {
    MAX_BOARDS: 6,
    BOX_SPOTS: m.MYSTERY_BOX ? [m.MYSTERY_BOX] : [],
    stairHeightAt: (x, z) => rampHeight(m.STAIRS || [], x, z),
    stairFootprint,
    ...m,
    walkable,
    openZones,
  };
}
