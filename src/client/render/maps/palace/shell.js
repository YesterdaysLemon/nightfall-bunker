// The palace's shell: every wall, floor, stair and ceiling box from the map data,
// each face cut along the room boundaries so every part takes its own room's look
// (damask over panelling in the public rooms, brick backstage, terracotta on the
// street front), plus the trim that runs around each room: skirting, dado rails,
// cornices, pilasters and the casings round every opening.

import { buildStaticBoxes, WINDOWS, DOORS, PALACE } from '../../../../shared/maps/palace.js';
import { roomAt, shellFace, bbox, mat, bake } from './kit.js';

const T = PALACE.T;
const H = T / 2;

// What a wall's main face shows in each room, by height above that room's floor.
const WALL = {
  foyer: (y) => (y < 1.1 ? ['panel', 1.1] : ['damask', 1.5]),
  stair: (y) => (y < 1.1 || (y > 3.6 && y < 4.7) ? ['panel', 1.1] : ['damask', 1.5]),
  boxoffice: (y) => (y < 1.0 ? ['panel', 1.0] : ['cream', 2.6]),
  dressing: () => ['plaster', 4.5],
  cellar: () => ['brick', 2],
  house: (y) => (y < 1.2 ? ['panel', 1.2] : ['damask', 1.8]),
  stage: () => ['brick', 2.2],
  back: () => ['brick', 2.2],
  alcove: () => ['brick', 1.8],
  booth: () => ['concrete', 3],
  alley: () => ['brick', 2],
  derelict: () => ['plaster', 4.5],
};
const CEIL = {
  foyer: ['cream', 3], stair: ['cream', 3], boxoffice: ['cream', 2.6], dressing: ['cream', 3],
  cellar: ['ceiling', 2.5], derelict: ['ceiling', 2.5], stage: ['ceiling', 3], back: ['ceiling', 2.5], alcove: ['cream', 2], booth: ['concrete', 3],
};
const FLOOR = {
  foyer: ['carpet', 1.8], stair: ['carpet', 1.8], boxoffice: ['floorBoards', 1.5], dressing: ['floorBoards', 1.5],
  cellar: ['dirt', 3], house: ['floorBoards', 1.5], stage: ['floorBoards', 1.4], back: ['floorBoards', 1.5],
  alcove: ['floorBoards', 1.4], booth: ['concrete', 3], alley: ['tarmac', 4], derelict: ['dirt', 3],
};

const probe = (x, y, z, n, d = 0.2) => roomAt(x + n[0] * d, y + n[1] * d, z + n[2] * d);

function wallStyle(b, tag) {
  const thinX = b[3] - b[0] <= T + 0.01, thinZ = b[5] - b[2] <= T + 0.01;
  const front = b[2] >= 20 - H - 0.01 && b[5] <= 20 + H + 0.01;
  return (x, y, z, n) => {
    if (n[1] > 0.5) return ['concrete', 3];
    const main = (thinX && n[0]) || (thinZ && n[2]);
    if (n[1] < -0.5 || !main) {
      // Lintel soffits and jambs: the plaster of the room they open onto, or the outside.
      if (n[1] < -0.5 && y < 0.05) return null;
      const r = roomAt(x, y + (n[1] < -0.5 ? -0.2 : 0), z) || probe(x, y, z, n, 0.4);
      if (front) return ['terracotta', 2.4];
      if (!r || r.out) return ['brick', 2];
      return r.id === 'stage' || r.id === 'back' || r.id === 'cellar' || r.id === 'alcove' ? ['brick', 2] : ['cream', 2.4];
    }
    const r = probe(x, y, z, n);
    if (!r) return front && n[2] > 0 ? ['terracotta', 2.4] : ['brick', 2];
    return WALL[r.id]((y - r.b[1]));
  };
}

function floorStyle(tag, b) {
  return (x, y, z, n) => {
    if (n[1] > 0.5) {
      const r = probe(x, y, z, n);
      if (tag === 'slab' && b[1] > 7) return ['concrete', 3];
      if (!r) return ['tarmac', 4];
      return FLOOR[r.id] || ['floorBoards', 1.5];
    }
    if (n[1] < -0.5) {
      if (tag === 'floor0' || tag === 'stage') return null;
      const r = probe(x, y, z, n);
      if (!r) return null;
      return CEIL[r.id] || ['cream', 3];
    }
    // Sides: the stage's front apron, the landing's fascia, the stairwell's edges.
    if (tag === 'floor0') return null;
    if (tag === 'stage') return n[2] > 0.5 && z > -14.05 ? ['panel', 1.2] : null;
    const r = probe(x, y, z, n);
    if (!r) return null;
    return r.id === 'stair' ? ['panel', 1.1] : ['woodWall', 2];
  };
}

function roofStyle(b) {
  return (x, y, z, n) => {
    if (n[1] > 0.5) return ['tarmac', 5];
    if (n[1] < -0.5) {
      const r = probe(x, y, z, n);
      if (!r) return null;
      if (r.id === 'house') return null;   // the auditorium's ceiling and dome are drawn on their own
      return CEIL[r.id] || ['cream', 3];
    }
    return ['brick', 2];
  };
}

// Stairs: carpet up the grand staircase, boards elsewhere.
function stepStyle(b) {
  const hall = b[0] >= -17.55 && b[3] <= -15.45 && b[2] >= 10.7;
  return (x, y, z, n) => {
    if (n[1] < -0.5) return null;
    if (n[1] > 0.5) return hall ? ['carpet', 1.2] : ['floorBoards', 1.4];
    const riser = (hall && n[2] > 0.5) || (!hall && ((b[3] - b[0] < 0.4 && n[0] > 0.5) || (b[5] - b[2] < 0.4 && n[2] > 0.5)));
    if (riser) return hall ? ['panel', 0.4] : ['woodWall', 1.5];
    return hall ? ['cream', 1.8] : ['woodWall', 2];
  };
}

// The boxes that are drawn (so anything touching one is hidden there): a face's cell is
// skipped when the point just outside it lies inside another of these.
const DRAWN = new Set(['ext', 'int', 'roof', 'floor0', 'stage', 'slab', 'step']);
const SOLIDS = buildStaticBoxes().filter((q) => DRAWN.has(q.tag)).map((q) => q.b);
function buried(x, y, z) {
  for (const b of SOLIDS) if (x > b[0] + 1e-3 && x < b[3] - 1e-3 && y > b[1] + 1e-3 && y < b[4] - 1e-3 && z > b[2] + 1e-3 && z < b[5] - 1e-3) return true;
  return false;
}

export function* buildShell(batch) {
  let done = 0;
  for (const { b, tag } of buildStaticBoxes()) {
    let style;
    switch (tag) {
      case 'ext': case 'int': style = wallStyle(b, tag); break;
      case 'floor0': case 'stage': case 'slab': style = floorStyle(tag, b); break;
      case 'roof': style = roofStyle(b); break;
      case 'step': style = stepStyle(b); break;
      default: continue;   // rails, pillars and props are modelled
    }
    const shown = (x, y, z, n) => (buried(x + n[0] * 0.05, y + n[1] * 0.05, z + n[2] * 0.05) ? null : style(x, y, z, n));
    for (let f = 0; f < 6; f++) shellFace(batch, b, f, shown, bake, tag === 'step' ? 4 : 1.3);
    if (++done % 20 === 0) yield;
  }
}

// --- Trim ---------------------------------------------------------------------------------------
// Openings along each wall line: { axis, c (the wall's line), a, b (along), y0, y1 }.
function openings() {
  const out = [];
  for (const w of WINDOWS) {
    const alongX = w.n[0] === 0;
    out.push({ axis: alongX ? 'x' : 'z', c: alongX ? w.z : w.x, a: (alongX ? w.x : w.z) - w.width / 2, b: (alongX ? w.x : w.z) + w.width / 2, y0: w.sill, y1: w.top, win: true });
  }
  for (const d of DOORS) {
    const [x0, y0, z0, x1, y1, z1] = d.box;
    if (d.kind === 'curtain') { out.push({ axis: 'x', c: -22, a: x0, b: x1, y0, y1 }); continue; }
    if (x1 - x0 > z1 - z0) out.push({ axis: 'x', c: Math.abs(z0 + z1) / 2 === 0 ? 0 : (z0 + z1) / 2, a: x0, b: x1, y0, y1: y0 + (d.kind === 'debris' ? 2.6 : 2.4) });
    else out.push({ axis: 'z', c: (x0 + x1) / 2, a: z0, b: z1, y0, y1: y0 + (d.kind === 'debris' ? 2.6 : 2.4) });
  }
  // Doorways without a door: the stage's east backstage door is debris; the partition's
  // Spark Gate doorway; the wing stair's opening onto the stage.
  out.push({ axis: 'x', c: -8, a: -15.2, b: -12.8, y0: 3.6, y1: 6.2 });
  out.push({ axis: 'z', c: -12, a: -19.6, b: -18.1, y0: 1.2, y1: 3.8 });
  // Fix the debris doorway at x = -11 (its box is thicker than the wall).
  for (const o of out) if (o.axis === 'z' && Math.abs(o.c + 11) < 0.5) o.c = -11;
  for (const o of out) if (o.axis === 'x' && Math.abs(o.c + 22) < 0.5) o.c = -22;
  return out;
}
export const OPENINGS = openings();

// Pieces of [a, b] not blocked by an opening at height y on the wall line (axis, c).
export function freeSpans(axis, c, a, b, y, pad = 0.12) {
  let spans = [[a, b]];
  for (const o of OPENINGS) {
    if (o.axis !== axis || Math.abs(o.c - c) > 0.2 || y < o.y0 - 0.02 || y > o.y1 + pad) continue;
    const lo = o.a - pad, hi = o.b + pad;
    spans = spans.flatMap(([s, e]) => (hi <= s || lo >= e ? [[s, e]] : [[s, Math.max(s, lo)], [Math.min(e, hi), e]]).filter(([p, q]) => q - p > 0.05));
  }
  return spans;
}

// A moulding along the inner face of a room's wall: side is 'x0' | 'x1' | 'z0' | 'z1' of the
// room rectangle r = [x0, z0, x1, z1]; runs at height y with a stepped profile
// [[height, depth], ...] (bottom to top) in material g.
export function runMoulding(g, r, side, y, profile, tint = 1, span = null) {
  const [x0, z0, x1, z1] = r;
  const alongX = side === 'z0' || side === 'z1';
  const c = side === 'x0' ? x0 : side === 'x1' ? x1 : side === 'z0' ? z0 : z1;
  const wallC = c + (side === 'x0' || side === 'z0' ? -H : H);
  const inward = side === 'x0' || side === 'z0' ? 1 : -1;
  const [a, b] = span || (alongX ? [x0, x1] : [z0, z1]);
  let yy = y;
  for (const [h, d] of profile) {
    for (const [s, e] of freeSpans(alongX ? 'x' : 'z', wallC, a, b, yy + h / 2)) {
      const mid = (s + e) / 2, len = e - s;
      const off = c + inward * d / 2;
      const m = alongX ? mat(mid, yy + h / 2, off) : mat(off, yy + h / 2, mid);
      bbox(g, m, alongX ? len : d, h, alongX ? d : len, tint, 1);
    }
    yy += h;
  }
}

// Casings (architraves) round every opening, on the faces that open into rooms.
export function buildCasings(batch) {
  for (const o of OPENINGS) {
    for (const side of [-1, 1]) {
      const n = o.axis === 'x' ? [0, 0, side] : [side, 0, 0];
      const face = o.c + side * H;
      const mx = o.axis === 'x' ? (o.a + o.b) / 2 : face, mz = o.axis === 'x' ? face : (o.a + o.b) / 2;
      const r = roomAt(mx + n[0] * 0.3, (o.y0 + o.y1) / 2, mz + n[2] * 0.3);
      if (!r || r.out) continue;
      const fancy = ['foyer', 'stair', 'house', 'boxoffice'].includes(r.id);
      const key = fancy ? 'mahogany' : r.id === 'dressing' || r.id === 'booth' ? 'woodWall' : 'metal';
      const g = batch.get(key);
      const w = fancy ? 0.16 : 0.1, d = fancy ? 0.06 : 0.04, tint = fancy ? 0.9 : 0.6;
      const put = (along, y, sa, sy) => {
        const m = o.axis === 'x' ? mat(along, y, face + side * d / 2) : mat(face + side * d / 2, y, along);
        bbox(g, m, o.axis === 'x' ? sa : d, sy, o.axis === 'x' ? d : sa, tint, 0.8);
      };
      const top = o.y1, bot = o.win ? o.y0 : o.y0;
      put(o.a - w / 2, (bot + top) / 2 + w / 4, w, top - bot + w / 2);
      put(o.b + w / 2, (bot + top) / 2 + w / 4, w, top - bot + w / 2);
      put((o.a + o.b) / 2, top + w / 2, o.b - o.a + w * 2, w);
      if (o.win) put((o.a + o.b) / 2, bot - 0.04, o.b - o.a + w * 2, 0.08);
      if (fancy) {
        // A gilt keystone over the door.
        const k = o.axis === 'x' ? mat((o.a + o.b) / 2, top + w + 0.1, face + side * (d + 0.02)) : mat(face + side * (d + 0.02), top + w + 0.1, (o.a + o.b) / 2);
        bbox(batch.get('gilt'), k, o.axis === 'x' ? 0.22 : 0.05, 0.22, o.axis === 'x' ? 0.05 : 0.22, 1, 0.3);
      }
    }
  }
}

