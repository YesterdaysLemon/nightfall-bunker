# The Survivor: the third-person teammate model, built for the "1997" world
# (art/STYLE.md). Same disc as the Ghoul, but alive and heroic-grim: an airfield
# rifleman in an M1-style steel helmet, olive field jacket with rolled sleeves,
# M1936-style webbing and a cartridge belt with pouches, trousers bloused into
# brown boots, a small haversack, and a determined painted face.
#
# Model: ~1100 triangles in rigid faceted segments pivoted at the joints used by
# src/client/render/avatars.js (hips, spine, neck, arms, shL/elL/wrL, shR/elR/wrR,
# hipL/knL, hipR/knR). Hard normals: every edge sharper than ~30 degrees is split.
# Rest pose: standing, arms hanging (avatars.js poses the arms onto the gun by IK).
# Player colour: four small parts (helmet band, both armbands, neckerchief) are
# painted neutral near-white on the page and tinted per player by the game with a
# material colour multiply (meta.tint lists them).
# Texture: ONE 256x256 page, a CLUT ramp per material, painted light x Cycles-baked
# AO / facet-normal light at ~75 % strength; the face is mirrored (double density).
#
#   node art/zombies/blend.mjs z_survivor.py --preview [--views front,side,back] [--ingame]
#   node art/zombies/blend.mjs z_survivor.py --final     (heroes, turntable, ingame.png)
# Every run also exports public/models/survivor.json + survivor.png.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix

STYLE = "survivor"
OUT = os.path.join(kit.OUT_BASE, STYLE)
MODELS = os.path.join(kit.ROOT, "public", "models")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP = math.radians(30)

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# The Ghoul's world table (z_ps1b.RAMPS) plus the living: warm flesh, olive-drab
# steel, olive jacket, khaki webbing, gauze and a neutral near-white "band" that the
# game tints with the player colour. dark -> light, cool shadows, warm highlights;
# the second value is the "lit base" entry (light = 1.0).
RAMPS = {
    "flesh": ([(40, 30, 36), (64, 46, 48), (90, 68, 62), (118, 90, 76), (146, 114, 94), (172, 138, 114),
               (198, 164, 138), (222, 192, 166)], 4),
    "flesh3": ([(90, 68, 62), (146, 114, 94), (198, 164, 138)], 1),
    "lips": ([(62, 38, 42), (100, 64, 62), (136, 92, 82)], 1),
    "hair": ([(24, 20, 22), (44, 34, 30), (66, 52, 40), (90, 72, 52)], 2),
    "eye": ([(34, 30, 34), (132, 128, 122), (188, 184, 172)], 1),
    "iris": ([(16, 14, 18), (40, 34, 32), (70, 58, 46)], 1),
    "steel": ([(20, 24, 22), (30, 36, 30), (42, 50, 38), (56, 64, 46), (72, 80, 56), (92, 98, 68),
               (116, 120, 86), (146, 146, 110)], 4),
    "jacket": ([(30, 30, 28), (44, 46, 36), (60, 62, 44), (80, 80, 56), (102, 100, 70), (126, 122, 86),
                (152, 146, 104)], 4),
    "web": ([(40, 36, 30), (60, 56, 42), (84, 78, 56), (110, 102, 72), (138, 128, 92), (168, 158, 118)], 3),
    "trousers": ([(24, 27, 27), (36, 40, 35), (50, 55, 43), (65, 71, 54), (82, 88, 66),
                  (102, 107, 80), (126, 128, 98)], 4),
    "leather": ([(18, 14, 14), (32, 25, 22), (47, 36, 28), (64, 49, 36), (86, 68, 50), (110, 88, 64)], 3),
    "metal": ([(60, 58, 56), (110, 108, 100), (170, 166, 150)], 1),
    "gauze": ([(84, 78, 70), (132, 126, 110), (176, 170, 150)], 1),
    "band": ([(56, 56, 58), (88, 88, 90), (124, 124, 124), (160, 160, 156), (194, 194, 188),
              (222, 222, 216), (244, 244, 238)], 4),
    "mud": ([(52, 44, 34), (74, 62, 46), (100, 86, 62)], 1),
    "dirt": ([(40, 34, 30), (60, 50, 42), (82, 70, 56)], 1),
    "bloodc": ([(36, 12, 12), (66, 20, 18), (96, 30, 24)], 1),
    "concrete": ([(26, 30, 28), (36, 40, 37), (46, 50, 45), (58, 62, 55), (72, 75, 66)], 3),
    "wood": ([(30, 22, 18), (46, 34, 26), (64, 48, 34), (86, 66, 46)], 2),
    "chalk": ([(120, 30, 26), (170, 52, 40)], 1),
}


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMP_C = {k: np.array(v[0], float) / 255.0 for k, v in RAMPS.items()}
RAMP_LL = {k: np.log(np.array([_luma(c) for c in v[0]]) / _luma(v[0][v[1]])) for k, v in RAMPS.items()}

# texture page layout: name -> (x0, y0, w, h), top-left origin
REG = {
    "head": (0, 0, 96, 96), "torso": (96, 0, 128, 64),
    "neck": (224, 0, 32, 16), "band": (224, 16, 32, 16), "palm": (224, 32, 32, 16),
    "fing": (224, 48, 16, 16), "thumb": (240, 48, 16, 16),
    "pelvis": (96, 64, 128, 32), "pouch": (224, 64, 32, 32),
    "helmet": (0, 96, 64, 32), "boot": (64, 96, 64, 32), "pack": (128, 96, 32, 32),
    "farm.L": (160, 96, 32, 32), "farm.R": (192, 96, 32, 32), "hand2": (224, 96, 32, 32),
    "thigh.L": (0, 128, 64, 56), "thigh.R": (64, 128, 64, 56),
    "shin.L": (128, 128, 64, 56), "shin.R": (192, 128, 64, 56),
    "uarm.L": (0, 184, 48, 40), "uarm.R": (48, 184, 48, 40),
}
HEAD_FC = 64          # head columns spent on the face quarter (front centre -> ear)

# joints, Blender space (Z up, facing -Y, character's left = +X), rest pose
JOINTS = [
    ("hips", None, (0.0, 0.0, 0.95)),
    ("spine", "hips", (0.0, 0.0, 1.03)),
    ("neck", "spine", (0.0, -0.018, 1.50)),
    ("arms", "spine", (0.0, -0.008, 1.44)),
    ("shL", "arms", (0.196, -0.008, 1.44)), ("elL", "shL", (0.214, -0.004, 1.15)), ("wrL", "elL", (0.226, -0.018, 0.884)),
    ("shR", "arms", (-0.196, -0.008, 1.44)), ("elR", "shR", (-0.214, -0.004, 1.15)), ("wrR", "elR", (-0.226, -0.018, 0.884)),
    ("hipL", "hips", (0.100, 0.0, 0.90)), ("knL", "hipL", (0.108, -0.010, 0.48)),
    ("hipR", "hips", (-0.100, 0.0, 0.90)), ("knR", "hipR", (-0.108, -0.010, 0.48)),
]
JW = {n: V(p) for n, _, p in JOINTS}
TINT = ["helmband", "band.L", "band.R", "scarf"]


def C(c):
    return np.array(c[:3], dtype=np.float64) / 255.0


def lin(c):
    out = []
    for x in c[:3]:
        x = x / 255.0
        out.append(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def smooth01(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def to3(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return (v[0], v[2], -v[1])


# ---------------------------------------------------------------- numpy helpers (from ps1b)

def lowfreq(rng, h, w, cell, wrap=True):
    gw = max(2, int(round(w / cell))); gh = int(h / cell) + 2
    g = rng.uniform(-1, 1, (gh, gw))
    ys = np.arange(h) / cell; xs = np.arange(w) * gw / w
    y0 = np.floor(ys).astype(int); fy = (ys - y0)[:, None]
    x0 = np.floor(xs).astype(int); fx = (xs - x0)[None, :]
    x1 = (x0 + 1) % gw; x0 = x0 % gw; y1 = np.minimum(y0 + 1, gh - 1)
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def gblur(a, sigma, axis, wrap=False):
    if sigma <= 0.01:
        return a
    r = max(1, int(math.ceil(sigma * 3)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = [(0, 0)] * a.ndim; pad[axis] = (r, r)
    p = np.pad(a, pad, mode="wrap" if wrap else "edge")
    n = a.shape[axis]
    out = np.zeros_like(a, dtype=np.float64)
    for i, kv in enumerate(k):
        sl = [slice(None)] * a.ndim; sl[axis] = slice(i, i + n)
        out += kv * p[tuple(sl)]
    return out


def blur2(a, sx, sy=None, wrap=False):
    return gblur(gblur(a, sx, 1, wrap), sx if sy is None else sy, 0)


def ell(x, y, x0, y0, rx, ry):
    return np.sqrt(((x - x0) / rx) ** 2 + ((y - y0) / ry) ** 2)


def segd(x, y, p0, p1):
    (ax, ay), (bx, by) = p0, p1
    dx, dy = bx - ax, by - ay
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / max(1e-12, dx * dx + dy * dy), 0, 1)
    return np.hypot(x - ax - t * dx, y - ay - t * dy)


# ---------------------------------------------------------------- the painter (from ps1b)

class Reg:
    """One page region painted as material ids + painted light, in metres. X runs
    round the part (0 = front centre, + = character's left, wraps if P), Y runs down
    the part (0 = first ring). Quantised to each material's ramp by finish()."""

    def __init__(s, name, mats, X, Y, P=None, tx=0.01, ty=0.01, seed=0):
        s.name = name
        s.h, s.w = X.shape
        s.mats = list(mats)
        s.X, s.Y, s.P, s.tx, s.ty = X, Y, P, tx, ty
        s.id = np.zeros((s.h, s.w), np.int16)
        s.sh = np.ones((s.h, s.w))
        s.rng = np.random.default_rng(seed)
        s.nz = lowfreq(s.rng, s.h, s.w, 3)
        s.fixes = []
        s.dither = 0.0

    def dx(s, x0):
        d = s.X - x0
        return (d + s.P / 2) % s.P - s.P / 2 if s.P else d

    @property
    def B(s):
        return (s.X % s.P) - s.P / 2 if s.P else s.X

    def m(s, name):
        return s.mats.index(name)

    def put(s, mask, mat):
        s.id[np.asarray(mask) > 0.5] = s.m(mat)

    def lit(s, mask, f):
        s.sh *= 1 + (f - 1) * np.clip(np.asarray(mask, float), 0, 1)

    def blob(s, x0, y0, rx, ry, mat=None, f=None, rough=0.25, soft=0.0):
        d = np.sqrt((s.dx(x0) / rx) ** 2 + ((s.Y - y0) / ry) ** 2) + rough * s.nz
        mk = np.clip((1 - d) / soft, 0, 1) if soft else (d < 1).astype(float)
        if mat:
            s.put(mk, mat)
        if f is not None:
            s.lit(mk, f)
        return mk

    def line(s, pts, w, mat=None, f=None, soft=0.0):
        d = np.full((s.h, s.w), 9.0)
        for p0, p1 in zip(pts, pts[1:]):
            q0 = (0.0, p0[1]); q1 = (p1[0] - p0[0], p1[1])
            d = np.minimum(d, segd(s.dx(p0[0]), s.Y, q0, q1))
        mk = np.clip((w - d) / soft, 0, 1) if soft else (d < w).astype(float)
        if mat:
            s.put(mk, mat)
        if f is not None:
            s.lit(mk, f)
        return mk

    def fold(s, p0, p1, w=None, dark=0.72, light=1.18, off=None):
        w = w or 0.6 * s.tx
        off = off or (1.2 * s.tx, -0.4 * s.ty)
        s.line([p0, p1], w, f=dark)
        s.line([(p0[0] + off[0], p0[1] + off[1]), (p1[0] + off[0], p1[1] + off[1])], w, f=light)

    def drip(s, x0, y0, length, w=None, mat="bloodc", f=None, wobble=0.25):
        w = w or 0.55 * s.tx
        n = max(2, int(length / (2 * s.ty)))
        pts = [(x0, y0)]
        x = x0
        for k in range(1, n + 1):
            x += s.rng.uniform(-wobble, wobble) * s.tx
            pts.append((x, y0 + length * k / n))
        s.line(pts, w, mat, f)

    def splat(s, x0, y0, rad, mat="bloodc", drips=1, f=0.85, rough=0.35):
        s.blob(x0, y0, rad, rad * 0.85, mat, None, rough)
        s.blob(x0 + rad * 0.15, y0 - rad * 0.1, rad * 0.55, rad * 0.45, None, f, rough)
        for _ in range(drips):
            s.drip(x0 + s.rng.uniform(-0.6, 0.6) * rad, y0 + rad * 0.4, s.rng.uniform(1.0, 2.2) * rad, mat=mat)

    def clusters(s, cell, thr, f=None, mat=None, where=1.0, seed=0):
        n = lowfreq(np.random.default_rng(seed + 991), s.h, s.w, cell)
        mk = (n > thr) * np.asarray(where, float)
        if f is not None:
            s.lit(mk, f)
        if mat:
            s.put(mk, mat)
        return mk

    def fix(s, x, y, mat, k):
        d = np.abs(s.dx(x)) / s.tx + np.abs(s.Y - y) / s.ty
        r, c = np.unravel_index(np.argmin(d), d.shape)
        s.fixes.append((r, c, mat, k))

    def finish(s, light):
        L = np.clip(s.sh * light, 0.02, 4.0)
        out = np.zeros((s.h, s.w, 3))
        for mi, mn in enumerate(s.mats):
            sel = s.id == mi
            if not sel.any():
                continue
            ll = RAMP_LL[mn]
            lv = np.log(L[sel])
            k = np.abs(lv[:, None] - ll[None, :]).argmin(1)
            out[sel] = RAMP_C[mn][k]
        for r, c, mn, k in s.fixes:
            out[r, c] = RAMP_C[mn][k]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[survivor] note: region {s.name} uses {n} colours")
        return out


def loft_reg(name, info, mats, seed=0):
    x0, y0, w, h = REG[name]
    P, Ltot = info["Pm"], info["L"]
    vrows = [(1 - v) * h for v in info["v"]]
    dist = info["d"]
    cols = (np.arange(w) + 0.5) / w
    rows = np.interp(np.arange(h) + 0.5, vrows, dist)
    U, Y = np.meshgrid(cols, rows)
    X = (U - 0.5) * P
    return Reg(name, mats, X, Y, P, P / w, Ltot / h, seed)


def flat_reg(name, mats, seed=0):
    """A plain region in texel fractions (boxes): X, Y in 0..1."""
    x0, y0, w, h = REG[name]
    X, Y = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    return Reg(name, mats, X, Y, None, 1 / w, 1 / h, seed)


# ---------------------------------------------------------------- geometry

def prof(w, df, db, n=8, e=0.85, push=None):
    """Closed n-gon cross-section in (side, front) coordinates, starting at the back
    and running round the character's right side. push = {k: (dx, dy)} moves vertex k
    and its mirror."""
    pts = []
    for k in range(n):
        ph = 2 * math.pi * k / n
        sx, cy = -math.sin(ph), math.cos(ph)
        x = 0.0 if abs(sx) < 1e-9 else math.copysign(abs(sx) ** e, sx) * w
        y = 0.0 if abs(cy) < 1e-9 else -math.copysign(abs(cy) ** e, cy) * (db if cy > 0 else df)
        pts.append([x, y])
    for k, (ddx, ddy) in (push or {}).items():
        pts[k][0] += ddx; pts[k][1] += ddy
        j = (n - k) % n
        if j != k:
            pts[j][0] -= ddx; pts[j][1] += ddy
    return pts


def flatprof(w, d):
    return [[0, -d], [-w, -d * 0.45], [-w, d * 0.45], [0, d], [w, d * 0.45], [w, -d * 0.45]]


def boxprof(w, d):
    return [[-w, -d], [-w, d], [w, d], [w, -d]]


def uv_in(reg, x, v):
    x0, y0, w, h = REG[reg]
    eps = 0.02
    col = min(max(x * w, eps), w - eps)
    row = min(max((1 - v) * h, eps), h - eps)
    return ((x0 + col) / AT, 1 - (y0 + row) / AT)


def _face(bm, uvl, reg, vv, uu, want):
    co = [v.co for v in vv]
    nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
    if nrm.dot(want) < 0:
        vv, uu = vv[::-1], uu[::-1]
    fc = bm.faces.new(vv)
    fc.smooth = True
    for lp, uv in zip(fc.loops, uu):
        lp[uvl].uv = uv_in(reg, *uv)
    return fc


def _harden(bm, sharp=SHARP):
    """Hard normals: split every edge sharper than `sharp` (and every open edge)."""
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > sharp:
            e.smooth = False


def loft(name, cs, profs, fref, reg, caps=(True, True), mirror=None, vs=None, warp=None, sharp=SHARP, tip=None):
    """A rigid faceted segment: rings of profile points round a centre line. UVs wrap
    round the ring by arc length (or mirrored: 0 = front centre, `mirror` = the side
    vertex, 1 = back centre) and run along the segment (v = 1 at the first ring).
    warp(i, k, co) -> co moves ring vertices after placement. `tip` closes the far end
    to a point."""
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, xs, Ps, Qs = [], [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        ring = []
        for k, (x, y) in enumerate(profs[i]):
            co = cs[i] + s * x + f * y
            if warp:
                co = warp(i, k, co)
            ring.append(bm.verts.new(co))
        rings.append(ring)
        L = [0.0]
        for k in range(n):
            a2, b2 = profs[i][k], profs[i][(k + 1) % n]
            L.append(L[-1] + math.hypot(b2[0] - a2[0], b2[1] - a2[1]))
        Ps.append(L[-1])
        if mirror is None:
            xs.append([l / L[-1] for l in L])
        else:
            hh, q1, q3 = n // 2, n // 4, 3 * n // 4
            row = []
            for k in range(n + 1):
                if k <= hh:
                    d, qf, qb = L[hh] - L[k], L[hh] - L[q1], L[q1]
                else:
                    d, qf, qb = L[k] - L[hh], L[q3] - L[hh], L[n] - L[q3]
                row.append(d / qf * mirror if d <= qf else mirror + (d - qf) / qb * (1 - mirror))
            xs.append(row)
            Qs.append(((L[hh] - L[q1] + L[q3] - L[hh]) / 2, (L[q1] + L[n] - L[q3]) / 2))
    d = [0.0]
    for i in range(1, m):
        d.append(d[-1] + (cs[i] - cs[i - 1]).length)
    if tip is not None:
        d.append(d[-1] + (V(tip) - cs[-1]).length)
    if vs is None:
        vs = [1 - x / d[-1] for x in d]
    for i in range(m - 1):
        cm = (cs[i] + cs[i + 1]) / 2
        for k in range(n):
            k1 = (k + 1) % n
            vv = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]
            uu = [(xs[i][k], vs[i]), (xs[i][k + 1], vs[i]), (xs[i + 1][k + 1], vs[i + 1]), (xs[i + 1][k], vs[i + 1])]
            ctr = sum((v.co for v in vv), V()) / 4
            _face(bm, uvl, reg, vv, uu, ctr - cm)
    if tip is not None:
        tv = bm.verts.new(V(tip))
        axis = (V(tip) - cs[-1]).normalized()
        for k in range(n):
            k1 = (k + 1) % n
            vv = [rings[-1][k], rings[-1][k1], tv]
            uu = [(xs[-1][k], vs[m - 1]), (xs[-1][k + 1], vs[m - 1]), ((xs[-1][k] + xs[-1][k + 1]) / 2, vs[-1])]
            ctr = sum((v.co for v in vv), V()) / 3
            rel = ctr - cs[-1]
            _face(bm, uvl, reg, vv, uu, rel - axis * rel.dot(axis) + axis * 0.3 * rel.length)
    xc = 0.0 if mirror is not None else 0.5
    for end, i in ((0, 0), (1, m - 1)):
        if not caps[end] or (end == 1 and tip is not None):
            continue
        uu = [(xc, vs[i] + (-0.02 if end == 0 else 0.02))] * n
        _face(bm, uvl, reg, rings[i][:], uu, -ts[0] if end == 0 else ts[-1])
    _harden(bm, sharp)
    ob = kit.mesh_obj(name, bm, None, smooth=False)
    return ob, {"v": vs, "P": Ps, "Pm": max(Ps), "L": d[-1], "d": d, "Q": Qs}


def box(name, c, ay, hx, hy, hz, reg, az=(0, 0, 1), taper=1.0, skip_back=True, main=(0.0, 0.75)):
    """Oriented box: centre c, outward axis ay, up az; half sizes along side/out/up.
    The outer face (+ay) maps to columns `main` of the region, every other face to
    the strip right of it. `taper` scales the bottom face's width."""
    ay = V(ay).normalized(); az = V(az); az = (az - ay * az.dot(ay)).normalized()
    ax = az.cross(ay).normalized()
    c = V(c)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    P = {}
    for i in (-1, 1):
        for j in (-1, 1):
            for k in (-1, 1):
                sx = taper if k < 0 else 1.0
                P[(i, j, k)] = bm.verts.new(c + ax * (i * hx * sx) + ay * (j * hy) + az * (k * hz))
    u0, u1 = main
    s0, s1 = u1 + 0.02, 0.98

    def quad(keys, uvs, want):
        _face(bm, uvl, reg, [P[k] for k in keys], uvs, want)

    # outer face: u along ax, v along az (v = 1 at the top)
    quad([(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)], [(u0, 1), (u1, 1), (u1, 0), (u0, 0)], ay)
    side = [(s0, 1), (s1, 1), (s1, 0), (s0, 0)]
    quad([(-1, 1, 1), (-1, -1, 1), (-1, -1, -1), (-1, 1, -1)], side, -ax)
    quad([(1, 1, 1), (1, -1, 1), (1, -1, -1), (1, 1, -1)], side, ax)
    quad([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], [(s0, 1), (s1, 1), (s1, 0.8), (s0, 0.8)], az)
    quad([(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)], [(s0, 0.2), (s1, 0.2), (s1, 0), (s0, 0)], -az)
    if not skip_back:
        quad([(-1, -1, 1), (1, -1, 1), (1, -1, -1), (-1, -1, -1)], side, -ay)
    _harden(bm)
    return kit.mesh_obj(name, bm, None, smooth=False)


# head rings, crown .. under the jaw: (z, centre y, half-width, front, back, {vertex: push})
HEADR = [
    (1.772, -0.020, 0.058, 0.060, 0.066, {}),
    (1.752, -0.022, 0.088, 0.094, 0.098, {}),
    (1.700, -0.024, 0.097, 0.102, 0.102, {6: (0, 0.012), 5: (0, 0.010), 4: (0, 0.004)}),            # brow ridge
    (1.668, -0.024, 0.095, 0.096, 0.098, {5: (0.002, -0.008), 6: (0, 0.004)}),                      # sockets, bridge
    (1.632, -0.024, 0.094, 0.096, 0.094, {6: (0, 0.036), 5: (0.004, 0.004), 4: (0.002, 0.0)}),      # nose, cheekbones
    (1.598, -0.025, 0.090, 0.098, 0.086, {6: (0, -0.002), 5: (0, 0.002)}),                           # mouth
    (1.562, -0.028, 0.082, 0.100, 0.070, {6: (0, 0.010), 5: (0.006, 0.008), 4: (0.004, 0.002)}),    # square jaw, chin
    (1.538, -0.036, 0.054, 0.058, 0.052, {}),                                                        # under the jaw
]
HEAD_ROWS = (0, 7, 27, 39, 53, 65, 81, 96)   # texel rows of the rings (face gets most)
HZ = [r[0] for r in HEADR]
# M1-style helmet rings (z, half-width, front, back); the skirt drops at the sides and back
HELM = [(1.850, 0.052, 0.056, 0.058), (1.820, 0.110, 0.120, 0.122), (1.762, 0.134, 0.146, 0.148),
        (1.702, 0.142, 0.154, 0.154), (1.694, 0.160, 0.174, 0.172)]
HELM_Y = -0.028
T_RINGS = [(1.525, -0.012, 0.078, 0.064, 0.058),     # collar
           (1.478, -0.008, 0.224, 0.108, 0.100),     # shoulders
           (1.385, -0.012, 0.222, 0.136, 0.112),     # chest
           (1.250, -0.006, 0.188, 0.124, 0.104),     # ribs
           (1.120, 0.000, 0.164, 0.114, 0.098),      # waist
           (1.020, 0.000, 0.176, 0.118, 0.104)]      # jacket skirt
P_RINGS = [(1.078, 0.189, 0.127, 0.113), (1.030, 0.192, 0.129, 0.115), (0.940, 0.196, 0.124, 0.118),
           (0.832, 0.166, 0.106, 0.106)]


def helm_warp(i, k, co):
    if i < 3:
        return co
    ph = 2 * math.pi * k / 10
    sx, cy = -math.sin(ph), math.cos(ph)
    co = co.copy()
    co.z -= 0.028 * abs(sx) ** 1.5 + 0.014 * max(0.0, cy)
    return co


def build_geometry():
    """-> I (loft infos by region), parts [(part, joint, [objects])], hands {side: (axis, palm)}."""
    I, parts, hands = {}, [], {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1))

    # ---- head, neck and helmet (neck joint)
    head, I["head"] = loft("head", [(0, y, z) for z, y, *_ in HEADR],
                           [prof(w, df, db, 12, 0.85, p) for z, y, w, df, db, p in HEADR], fwd, "head",
                           caps=(False, True), mirror=HEAD_FC / REG["head"][2],
                           vs=[1 - r / REG["head"][3] for r in HEAD_ROWS], sharp=math.radians(33))
    neck, I["neck"] = loft("neck", [(0, -0.022, 1.585), (0, -0.018, 1.485)],
                           [prof(0.058, 0.058, 0.060, 6, 1.0), prof(0.062, 0.060, 0.062, 6, 1.0)],
                           fwd, "neck", (False, False))
    helmet, I["helmet"] = loft("helmet", [(0, HELM_Y, z) for z, *_ in HELM],
                               [prof(w, df, db, 10, 0.8) for z, w, df, db in HELM], fwd, "helmet",
                               caps=(True, False), warp=helm_warp)
    # the player-colour band round the helmet, just proud of the dome
    def hdim(z):
        (z0, *a), (z1, *b) = HELM[2], HELM[3]
        t = (z0 - z) / (z0 - z1)
        return [x + (y - x) * t for x, y in zip(a, b)]
    bz = (1.756, 1.718)
    helmband, I["helmband"] = loft("helmband", [(0, HELM_Y, z) for z in bz],
                                   [prof(*[1.045 * x for x in hdim(z)], 10, 0.8) for z in bz], fwd, "band",
                                   caps=(False, False))
    parts += [("head", "neck", [head, neck, helmet]), ("helmband", "neck", [helmband])]

    # ---- torso, haversack, neckerchief (spine joint)
    def slope(i, k, co):                                   # trapezius: shoulders fall away from the neck
        if i == 1:
            co = co.copy(); co.z -= 0.058 * (abs(co.x) / 0.224) ** 2
        return co
    torso, I["torso"] = loft("torso", [(0, y, z) for z, y, *_ in T_RINGS],
                             [prof(w, df, db, 10, 0.62) for z, y, w, df, db in T_RINGS], fwd, "torso", (False, False),
                             warp=slope)
    pack = box("pack", (0, 0.146, 1.295), (0, 1, 0), 0.128, 0.046, 0.118, "pack")
    scarf, I["scarf"] = loft("scarf", [(0, -0.016, 1.538), (0, -0.012, 1.488)],
                             [prof(0.084, 0.080, 0.072, 8, 0.85), prof(0.100, 0.096, 0.084, 8, 0.85)], fwd, "band",
                             (False, False))
    knot = box("knot", (0, -0.126, 1.474), (0, -1, 0.25), 0.030, 0.020, 0.024, "band", main=(0.0, 0.5))
    flap = box("flap", (0, -0.152, 1.418), (0, -1, 0.35), 0.040, 0.008, 0.046, "band", taper=0.25, main=(0.5, 0.95))
    parts += [("torso", "spine", [torso, pack]), ("scarf", "spine", [scarf, knot, flap])]

    # ---- pelvis, cartridge belt pouches and canteen (hips joint)
    pelvis, I["pelvis"] = loft("pelvis", [(0, 0, z) for z, *_ in P_RINGS],
                               [prof(w, df, db, 10, 0.72) for z, w, df, db in P_RINGS], fwd, "pelvis", (False, True))
    kit_objs = [pelvis]
    w_, df_, db_ = 0.191, 0.128, 0.114
    for j, th in enumerate((0.40, -0.40, 0.92, -0.92)):
        x, y = w_ * math.sin(th), -df_ * math.cos(th)
        nrm = V((math.sin(th) / w_, -math.cos(th) / df_, 0)).normalized()
        kit_objs.append(box(f"pouch{j}", V((x, y, 1.050)) + nrm * 0.020, nrm, 0.030, 0.018, 0.036, "pouch"))
    th = -2.45
    x, y = w_ * math.sin(th), -db_ * math.cos(th)
    nrm = V((math.sin(th) / w_, -math.cos(th) / db_, 0)).normalized()
    kit_objs.append(box("canteen", V((x, y, 0.975)) + nrm * 0.034, nrm, 0.052, 0.030, 0.070, "pouch"))
    parts.append(("pelvis", "hips", kit_objs))

    for sd, sx in (("L", 1), ("R", -1)):
        sh, el, wr = JW["sh" + sd], JW["el" + sd], JW["wr" + sd]
        # ---- sleeve with the roll just above the elbow, and the armband
        d1 = (el - sh).normalized()
        W = [0.077, 0.072, 0.086, 0.083, 0.060]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh - d1 * 0.030, sh + d1 * 0.160, sh + d1 * 0.212,
                                                  sh + d1 * 0.268, el + d1 * 0.020],
                                   [prof(w, w * 0.94, w * 0.94, 6, 1.0) for w in W], fwd, "uarm." + sd, (False, True))
        band, _ = loft("band." + sd, [sh + d1 * 0.070, sh + d1 * 0.122],
                       [prof(0.0835, 0.080, 0.080, 6, 1.0), prof(0.0815, 0.078, 0.078, 6, 1.0)], fwd, "band", (False, False))
        # ---- bare forearm
        d2 = (wr - el).normalized()
        fa, I["farm." + sd] = loft("farm." + sd, [el - d2 * 0.030, el + d2 * 0.105, wr + d2 * 0.004],
                                   [prof(0.054, 0.052, 0.052, 6, 1.0), prof(0.057, 0.050, 0.050, 6, 1.0),
                                    prof(0.039, 0.030, 0.030, 6, 1.0)], fwd, "farm." + sd, (False, False))
        # ---- big hand, loosely closed: palm, one finger block curled toward the palm, thumb
        d3 = d2
        out = V((sx, 0, 0)); fbo = (out - d3 * out.dot(d3)).normalized()      # back of the hand faces outward
        palm, I["palm"] = loft("palm." + sd, [wr - d3 * 0.012, wr + d3 * 0.050, wr + d3 * 0.094],
                               [flatprof(0.032, 0.017), flatprof(0.047, 0.021), flatprof(0.046, 0.016)],
                               fbo, "palm", (False, True))
        k0 = wr + d3 * 0.088 - fbo * 0.002
        a1 = (d3 - fbo * 0.35).normalized(); a2 = (d3 * 0.25 - fbo).normalized()
        k1 = k0 + a1 * 0.046; k2 = k1 + a2 * 0.036
        fing, I["fing"] = loft("fing." + sd, [k0, k1, k2],
                               [boxprof(0.041, 0.012), boxprof(0.040, 0.0115), boxprof(0.037, 0.010)],
                               [fbo, (fbo + a1 * 0.3).normalized(), (fbo - a2 * 0.2 + d3 * 0.6).normalized()],
                               "fing", (False, True))
        tb = wr + d3 * 0.030 + fwd * 0.036 - fbo * 0.010
        t1 = (d3 * 0.62 + fwd * 0.30 - fbo * 0.45).normalized()
        th_, I["thumb"] = loft("thumb." + sd, [tb, tb + t1 * 0.050],
                               [boxprof(0.0125, 0.011), boxprof(0.0105, 0.0090)], fbo, "thumb", (False, True))
        hands[sd] = {"axis": [round(c, 4) for c in to3(d3)], "palm": [round(c, 4) for c in to3(-fbo)],
                     "grip": [round(c, 4) for c in to3(d3 * 0.080 - fbo * 0.030)]}
        # ---- legs: baggy trousers bloused over boots
        hip, kn = JW["hip" + sd], JW["kn" + sd]
        an = V((sx * 0.116, 0.004, 0.105))
        t1_ = (kn - hip).normalized()
        tg, I["thigh." + sd] = loft("thigh." + sd, [hip - t1_ * 0.055, hip.lerp(kn, 0.5), kn + t1_ * 0.012],
                                    [prof(0.110, 0.110, 0.118, 8, 0.8), prof(0.100, 0.102, 0.102, 8, 0.8),
                                     prof(0.081, 0.085, 0.080, 8, 0.8)], fwd, "thigh." + sd, (False, True))
        t2_ = (an - kn).normalized()
        sn, I["shin." + sd] = loft("shin." + sd, [kn - t2_ * 0.030, kn.lerp(an, 0.42), V((an.x, an.y, 0.272)),
                                                  V((an.x, an.y + 0.002, 0.222))],
                                   [prof(0.081, 0.085, 0.081, 8, 0.8), prof(0.073, 0.076, 0.079, 8, 0.8),
                                    prof(0.095, 0.100, 0.098, 8, 0.8), prof(0.074, 0.080, 0.078, 8, 0.8)],
                                   fwd, "shin." + sd, (False, False))
        a = math.radians(7) * sx
        bf = V((math.sin(a), -math.cos(a), 0))
        Bt = [(0.236, 0.066, 0.074, 0.072, 0.8), (0.072, 0.075, 0.166, 0.087, 0.7), (0.0, 0.079, 0.188, 0.091, 0.7)]
        bt, I["boot"] = loft("boot." + sd, [(an.x, an.y, z) for z, *_ in Bt],
                             [prof(w, df, db, 8, e) for z, w, df, db, e in Bt], bf, "boot", (False, True))
        parts += [("uarm." + sd, "sh" + sd, [ua]), ("band." + sd, "sh" + sd, [band]),
                  ("farm." + sd, "el" + sd, [fa]), ("hand." + sd, "wr" + sd, [palm, fing, th_]),
                  ("thigh." + sd, "hip" + sd, [tg]), ("shin." + sd, "kn" + sd, [sn, bt])]
    return I, parts, hands


def rig_part(name, objs, pivot, root):
    ob = kit.join(objs) if len(objs) > 1 else objs[0]
    ob.name = name; ob.data.name = name
    ob.data.transform(Matrix.Translation(-V(pivot)))
    ob.location = pivot
    ob.parent = root
    return ob


def vertex_tint(ob, part):
    """Per-corner colour: darker boots and lower legs, darker undersides, a cool lean
    in the dark. The player-colour parts stay nearly white."""
    bpy.context.view_layer.update()
    me = ob.data
    mw = ob.matrix_world.copy()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    band = part in TINT
    for p in me.polygons:
        for li in p.loop_indices:
            vx = me.vertices[me.loops[li].vertex_index]
            co = mw @ vx.co
            nz = vx.normal.z
            if band:
                f = 0.94 + 0.06 * (0.5 + 0.5 * nz)
            else:
                f = 0.82 + 0.18 * smooth01((co.z - 0.04) / 0.85)
                f *= 0.90 + 0.10 * (0.5 + 0.5 * nz)
            cols[li] = (f ** 1.06, f ** 1.03, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca


# ---------------------------------------------------------------- baked light

ARM_PARTS = ("uarm", "band.", "farm", "hand")


def bake_light(objs):
    """AO + facet normals baked from the rest pose (arms moved out to the sides so they
    do not shadow the jacket: in the game they are up on the gun). Light: a symmetric
    top-front key, a sky term and a faint back rim, all occluded, at ~75 % strength."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    kit.cycles_gpu()
    sc.cycles.samples = 256
    sc.cycles.use_denoising = False
    w = kit.world((1, 1, 1), 1.0)
    try:
        w.light_settings.distance = 0.10
    except Exception as e:
        print("ao distance:", e)
    moved = []
    for o in objs:
        if o.name.startswith(ARM_PARTS):
            sx = 1 if o.name.endswith("L") else -1
            o.location.x += sx * 0.32
            moved.append((o, sx))
    bpy.context.view_layer.update()
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0))]
    bm.faces.new(vv)
    ground = kit.mesh_obj("BakeGround", bm, None, smooth=False)
    mat = bpy.data.materials.new("BakeMat")
    n = kit.Nodes(mat)
    out = n.new("ShaderNodeOutputMaterial")
    dif = n.new("ShaderNodeBsdfDiffuse", Color=(0.5, 0.5, 0.5, 1))
    n.link(dif, "BSDF", out, "Surface")
    tex = n.new("ShaderNodeTexImage")
    for o in objs:
        kit.assign(o, mat)
    res = {}
    for kind in ("AO", "NORMAL"):
        img = bpy.data.images.new("bake_" + kind, AT, AT, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        tex.image = img
        mat.node_tree.nodes.active = tex
        kit.activate(objs[0])
        for o in objs:
            o.select_set(True)
        if kind == "AO":
            bpy.ops.object.bake(type="AO", margin=2, use_clear=True)
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=2, use_clear=True)
        px = np.empty(AT * AT * 4, np.float32)
        img.pixels.foreach_get(px)
        res[kind] = px.reshape(AT, AT, 4)[::-1, :, :3].astype(np.float64)
    bpy.data.objects.remove(ground)
    for o, sx in moved:
        o.location.x -= sx * 0.32
    bpy.context.view_layer.update()
    nrm = res["NORMAL"] * 2 - 1
    nrm /= np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    ao = np.clip(res["AO"][..., 0], 0, 1)
    key = np.array([0.0, -0.78, 0.63]); key /= np.linalg.norm(key)
    rim = np.array([0.0, 0.7, 0.7]); rim /= np.linalg.norm(rim)
    dk = np.clip(nrm @ key, 0, 1); dr = np.clip(nrm @ rim, 0, 1)
    sky = 0.5 + 0.5 * nrm[..., 2]
    light = 1.08 * (ao ** 0.75 * (0.52 + 0.10 * sky) + 0.40 * dk * ao ** 0.4 + 0.12 * dr * ao ** 0.4)
    light = 1.0 + 0.75 * (light - 1.0)
    print("[survivor] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
    return light


# ---------------------------------------------------------------- texture painting

def paint_head(I):
    info = I["head"]
    x0, y0, W, H = REG["head"]
    qf, qb = info["Q"][3]
    c = np.arange(W) + 0.5
    xc = np.where(c < HEAD_FC, c / HEAD_FC * qf, qf + (c - HEAD_FC) / (W - HEAD_FC) * qb)
    zr = np.interp(np.arange(H) + 0.5, HEAD_ROWS, HZ)
    X, Z = np.meshgrid(xc, zr)
    r = Reg("head", ["flesh", "lips", "hair", "eye", "iris", "web", "metal", "dirt"], X, 1.8 - Z, None,
            qf / HEAD_FC, 0.0035, seed=11)
    zz = lambda z: 1.8 - z
    Qf = qf
    E = lambda x0_, z0, rx, rz: ell(X, Z, x0_, z0, rx, rz)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    # --- big planes: the front of the face takes the light, the sides turn away
    r.lit(soft(E(0.0, 1.64, 0.07, 0.08), 1.0) * (X < Qf), 1.06)
    r.lit(np.clip((X - 0.075) / 0.06, 0, 1) * (X < Qf + 0.01), 0.88)
    r.lit(soft(E(0.02, 1.712, 0.06, 0.016)), 1.08)                          # forehead under the brim
    r.lit(np.clip((Z - 1.700) / 0.012, 0, 1), 0.72)                         # helmet shadow on the brow
    r.lit(soft(E(0.030, 1.699, 0.046, 0.0060), 0.4), 1.22)                  # brow ridge top plane
    # eye sockets: shadow under the brow, lighter than the Ghoul's (alive, not sunken)
    EX, EZ = 0.034, 1.669
    sock = E(EX, EZ + 0.002, 0.025, 0.016) + 0.08 * r.nz
    r.lit(soft(sock, 0.4) * np.clip(0.6 + (Z - EZ) / 0.025, 0.5, 1), 0.60)
    # eyes: a small pale almond, dark iris looking straight ahead, heavy upper lid
    eye = E(EX + 0.001, EZ - 0.001, 0.0120, 0.0050) < 1
    r.put(eye, "eye")
    iris = E(EX - 0.0015, EZ - 0.0008, 0.0050, 0.0050) < 1
    r.put(iris & eye, "iris")
    r.lit(eye & (Z > EZ + 0.0012), 0.7)                                      # upper lid shadow on the eye
    lidl = (E(EX + 0.001, EZ + 0.0030, 0.0135, 0.0022) < 1)
    r.put(lidl & ~eye, "hair"); r.lit(lidl & ~eye, 0.8)                      # lash line
    r.fix(EX - 0.0030, zz(EZ + 0.0004), "eye", 2)                            # catch light
    r.lit(E(EX + 0.003, EZ - 0.0105, 0.018, 0.0026) < 1, 0.82)               # lower lid crease
    # brows: thick, low and angled down to the centre -- a set, determined frown
    brow = r.line([(0.008, zz(1.6835)), (0.030, zz(1.6865)), (0.054, zz(1.6905))], 0.0036)
    r.put(brow, "hair"); r.lit(brow, 1.05)
    for xk in (0.0045, 0.0085):                                              # frown creases
        r.line([(xk, zz(1.681)), (xk + 0.0012, zz(1.694))], 0.0011, f=0.72)
    r.line([(0.0065, zz(1.681)), (0.0077, zz(1.694))], 0.0010, f=1.12)
    # nose: straight, lit bridge and tip, shadowed sides and underside
    r.lit((X < 0.009) * np.clip((Z - 1.634) / 0.012, 0, 1) * (Z < 1.690), 1.18)
    r.lit((X > 0.009) & (X < 0.021) & (Z > 1.626) & (Z < 1.664), 0.74)
    r.lit(soft(E(0.0, 1.635, 0.012, 0.008)), 1.22)
    r.lit(E(0.0, 1.6215, 0.019, 0.0045) < 1, 0.55)
    nos = E(0.0090, 1.6235, 0.0042, 0.0024) < 1
    r.put(nos, "lips"); r.lit(nos, 0.5)
    # cheekbones and planes of the cheek, nasolabial lines
    r.lit(soft(E(0.060, 1.646, 0.030, 0.011)), 1.14)
    r.lit(soft(E(0.068, 1.612, 0.030, 0.016), 0.6), 0.84)
    r.line([(0.020, zz(1.626)), (0.031, zz(1.603))], 0.0020, f=0.78)
    r.line([(0.024, zz(1.626)), (0.035, zz(1.603))], 0.0018, f=1.08)
    # mouth: a firm straight line, thin upper lip, lit lower lip, corners set down
    mouth = E(0.0, 1.6005, 0.0235, 0.0016) < 1
    r.put(mouth, "lips"); r.lit(mouth, 0.55)
    up_lip = (E(0.0, 1.6035, 0.022, 0.0022) < 1) & ~mouth
    r.put(up_lip, "lips"); r.lit(up_lip, 0.9)
    lo_lip = (E(0.0, 1.5965, 0.019, 0.0028) < 1) & ~mouth
    r.put(lo_lip, "lips"); r.lit(lo_lip, 1.2)
    r.lit(E(0.0, 1.5915, 0.015, 0.0024) < 1, 0.78)                          # shadow under the lower lip
    r.lit(E(0.0245, 1.5985, 0.0028, 0.0028) < 1, 0.7)                       # corners
    # square chin with a cleft, hard jaw line, shadow under it
    r.lit(soft(E(0.0, 1.574, 0.022, 0.010)), 1.14)
    r.lit((X < 0.0018) & (Z > 1.566) & (Z < 1.578), 0.8)
    r.line([(0.030, zz(1.566)), (Qf, zz(1.598))], 0.0038, f=0.82)
    r.lit(np.clip((1.566 - Z) / 0.008, 0, 1), 0.66)
    # a few days' stubble on the jaw and the upper lip (clusters, not noise)
    stub = (Z < 1.612) & (X > 0.010) & (X < Qf) & ~mouth & ~lo_lip & ~up_lip
    r.lit(stub & (X < 0.075), 0.93)                                          # shadow of a beard
    r.clusters(1.4, 0.35, f=0.9, where=stub & (Z < 1.595), seed=3)
    # ears just behind the side vertex
    ear = E(Qf + 0.012, 1.656, 0.016, 0.029) + 0.1 * r.nz
    r.lit(soft(ear, 0.3), 1.14)
    r.lit(E(Qf + 0.014, 1.653, 0.008, 0.017) < 1, 0.66)
    r.lit(E(Qf + 0.030, 1.652, 0.007, 0.028) < 1, 0.74)
    # short-cropped hair: sideburns and the back below the helmet skirt
    bx = np.clip((X - Qf) / qb, 0, 1)
    side_burn = (X > Qf - 0.030) & (X < Qf - 0.010) & (Z > 1.646)
    back_hair = (X > Qf + 0.024) & (Z > 1.612 + 0.010 * (1 - bx) + 0.002 * r.nz)          # clipped nape
    hair = side_burn | back_hair
    r.put(hair, "hair")
    r.clusters(3, 0.3, f=1.2, where=hair, seed=12)
    r.lit(back_hair * np.clip((Z - 1.615) / 0.03, 0, 1), 1.12)
    r.lit((X > Qf + 0.024) & ~hair & (Z > 1.60), 0.9)                       # shaved stubble below it
    # the helmet's chinstraps, unbuckled and hanging down the cheeks
    strap = r.line([(Qf - 0.020, zz(1.700)), (Qf - 0.026, zz(1.640)), (Qf - 0.036, zz(1.582))], 0.0040)
    r.put(strap, "web")
    r.line([(Qf - 0.014, zz(1.700)), (Qf - 0.020, zz(1.640)), (Qf - 0.030, zz(1.582))], 0.0015, f=0.72)
    r.lit(strap, 1.05)
    bk = E(Qf - 0.034, 1.592, 0.0055, 0.0045) < 1
    r.put(bk, "metal"); r.lit(bk & (Z < 1.591), 0.6)
    # grime: smudges on the brow and cheekbones, darker in the creases
    r.clusters(3.2, 0.68, f=0.86, where=(X > 0.05) & (X < Qf - 0.035) & (Z > 1.62) & (Z < 1.66), seed=7)
    r.clusters(5, 0.55, f=0.94, where=~hair & ~eye, seed=9)
    return r


def paint_neck(I):
    r = loft_reg("neck", I["neck"], ["flesh", "dirt"], 13)
    X, Y = r.X, r.Y
    r.lit(np.clip(1 - Y / 0.03, 0, 1), 0.55)                        # under the jaw
    for sg in (-1, 1):
        r.line([(sg * 0.034, 0.01), (sg * 0.008, Y.max() - 0.01)], 0.004, f=1.14)
        r.line([(sg * 0.044, 0.01), (sg * 0.016, Y.max() - 0.01)], 0.003, f=0.84)
    r.lit(np.clip((1 - ell(X, Y, 0, 0.045, 0.009, 0.012)) / 0.5, 0, 1), 1.15)
    r.clusters(1.6, 0.2, f=0.88, where=Y < 0.035, seed=4)
    r.lit(np.clip((Y - (Y.max() - 0.03)) / 0.03, 0, 1), 0.7)        # shade into the scarf
    return r


def paint_helmet(I):
    r = loft_reg("helmet", I["helmet"], ["steel", "metal", "mud"], 101)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    d = I["helmet"]["d"]
    r.lit(np.clip(1 - Y / 0.05, 0, 1), 1.1)                          # crown catches the bulb
    rim = Y > d[3] - 0.004
    r.lit(np.abs(Y - d[3] + 0.004) < 0.6 * ty, 0.6)                  # seam at the rim
    r.lit(rim, 1.22)                                                 # rolled steel rim
    r.lit(Y > d[4] - 0.6 * ty, 0.7)
    r.clusters(5, 0.66, f=0.88, seed=2)                              # dents and dull patches
    r.clusters(4, 0.70, f=1.10, where=Y < d[3], seed=4)
    for k in range(5):                                               # bright scratches
        x_ = r.rng.uniform(-r.P / 2, r.P / 2); y_ = r.rng.uniform(0.03, d[3] - 0.03)
        r.line([(x_, y_), (x_ + r.rng.uniform(-0.03, 0.03), y_ + r.rng.uniform(0.01, 0.03))], 0.5 * tx, "metal", 0.9)
    r.clusters(3, 0.4, mat="mud", where=Y > d[3] - 0.02, seed=6)       # mud flecks on the skirt
    return r


def paint_band():
    """Neutral near-white cloth (tinted per player in the game): a few folds, edges."""
    r = flat_reg("band", ["band"], 141)
    X, Y = r.X, r.Y
    r.lit(np.ones(X.shape), 1.02)
    for x_ in (0.12, 0.37, 0.63, 0.88):
        r.fold((x_, 0.05), (x_ + 0.06, 0.95), dark=0.8, light=1.12)
    r.lit((Y < 1.2 / 16) | (Y > 1 - 1.2 / 16), 0.78)
    r.clusters(4, 0.5, f=0.92, seed=3)
    # the knot (left half of the page strip) gets a central twist
    r.lit((X < 0.5) & (np.abs(X - 0.25) < 0.04), 0.7)
    return r


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["jacket", "web", "metal", "bloodc", "mud"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    Lt = Y.max()
    r.lit(np.clip(1 - Y / 0.035, 0, 1), 0.66)                      # under the scarf
    # pointed collar points lying on the upper chest, their shadows under them
    yb = 0.118 - np.clip((ax - 0.022) / 0.078, 0, 1) * 0.072
    collar = (ax > 0.020) & (ax < 0.100) & (Y > 0.030) & (Y < yb)
    r.lit(collar, 1.22)
    r.lit((ax > 0.018) & (ax < 0.104) & (Y >= yb) & (Y < yb + 1.4 * ty), 0.58)
    r.lit((ax <= 0.020) & (Y > 0.030) & (Y < 0.12), 0.78)
    # fly front and buttons
    pl = Y > 0.118
    r.lit(pl & (X > 0.3 * tx) & (X < 1.0 * tx), 0.64)
    r.lit(pl & (X > 1.0 * tx) & (X < 2.0 * tx), 1.12)
    for by in (0.17, 0.25, 0.33):
        bt = ell(X, Y, -0.4 * tx, by, 0.007, 0.006) < 1
        r.put(bt, "web"); r.lit(bt, 0.9)
    # chest pockets with buttoned flaps
    for sg in (-1, 1):
        cx = sg * 0.096
        d = np.abs(X - cx)
        pk = (d < 0.036) & (Y > 0.140) & (Y < 0.236)
        r.lit(pk & ~((d < 0.036 - tx) & (Y > 0.140 + ty) & (Y < 0.236 - ty)), 0.66)
        r.lit((d < 0.038) & (Y > 0.137) & (Y < 0.168), 1.18)
        r.lit((d < 0.038) & (Y >= 0.168) & (Y < 0.168 + 1.3 * ty), 0.52)
        r.put(ell(X, Y, cx, 0.158, 0.006, 0.0055) < 1, "web")
    # yoke seam across the back, side seams
    r.lit((np.abs(B) < 0.22) & (np.abs(Y - 0.10) < 0.6 * ty), 0.7)
    for sg in (-1, 1):
        r.fold((sg * r.P / 4, 0.06), (sg * r.P / 4, Lt), dark=0.78, off=(sg * 1.2 * tx, 0))
    # armpit folds and the jacket bunched above the belt
    for sg in (-1, 1):
        sx0 = sg * r.P / 4
        r.blob(sx0, 0.10, 0.04, 0.05, None, 0.84, rough=0.3)
        for (a0, a1) in (((-0.03, 0.10), (-0.09, 0.19)), ((0.0, 0.11), (-0.01, 0.23)), ((0.03, 0.10), (0.08, 0.20))):
            r.fold((sx0 + sg * a0[0], a0[1]), (sx0 + sg * a1[0], a1[1]), off=(sg * 1.3 * tx, 0))
    bl = np.clip((Y - 0.40) / 0.05, 0, 1)
    ph = 2 * np.pi * X / 0.07 + 1.3 * np.sin(X * 19.0)
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.16)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.76)
    for (p0, p1) in (((-0.05, 0.28), (-0.02, 0.35)), ((0.06, 0.30), (0.04, 0.38)), ((-0.17, 0.26), (-0.13, 0.33))):
        r.fold(p0, p1)
    # webbing suspenders: down the front to the belt hooks ...
    for sg in (-1, 1):
        cx = sg * (0.105 - 0.03 * np.clip(Y / Lt, 0, 1))
        e_ = (X - cx) * sg
        st = np.abs(X - cx) < 0.0165
        r.put(st, "web")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.64)
        r.lit(st & (e_ < -0.0165 + 1.1 * tx), 1.18)
        r.lit((e_ >= 0.0165) & (e_ < 0.0165 + 1.4 * tx), 0.62)
        for yk in (0.225, 0.42):                                    # adjuster buckles
            bk = (np.abs(X - cx) < 0.020) & (np.abs(Y - yk) < 0.011)
            r.put(bk, "metal")
            inner = (np.abs(X - cx) < 0.011) & (np.abs(Y - yk) < 0.005)
            r.put(inner, "web"); r.lit(inner, 0.6)
            r.lit((np.abs(X - cx) < 0.021) & (Y > yk + 0.011) & (Y < yk + 0.011 + 1.3 * ty), 0.55)
    # ... and crossed in an X on the back
    for sg in (-1, 1):
        bc = sg * 0.10 * (1 - np.clip(Y / 0.30, 0, 2))
        e_ = (B - bc) * sg
        st = (np.abs(B - bc) < 0.0165) & (Y < 0.50)
        r.put(st, "web")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.64)
        r.lit((np.abs(B - bc) >= 0.0165) & (np.abs(B - bc) < 0.0165 + 1.4 * tx) & (Y < 0.50), 0.66)
    cross = ell(B, Y, 0, 0.30, 0.020, 0.016) < 1
    r.put(cross, "metal"); r.lit(cross, 0.8)
    # grime: dust on the shoulders, mud low down, a little dried blood (not his)
    r.clusters(5, 0.62, f=0.9, seed=1)
    r.clusters(5, 0.66, f=1.08, where=Y < 0.2, seed=2)
    r.clusters(5, 0.62, mat="mud", where=(Y > 0.44) & (r.id == 0), seed=5)
    r.blob(-0.17, 0.37, 0.026, 0.010, "bloodc", 0.9, rough=0.5)            # a dried smear, not his
    r.blob(-0.15, 0.378, 0.012, 0.006, "bloodc", rough=0.3)
    return r


def paint_pack():
    r = flat_reg("pack", ["web", "metal", "mud"], 151)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    main = X < 0.75
    u = X / 0.75
    r.lit(main & (Y < 0.42), 1.12)                                       # flap
    r.lit(main & (np.abs(Y - 0.42) < 1.2 * ty), 0.55)
    r.lit(main & (Y < 1.2 * ty), 0.7)
    for ux in (0.25, 0.75):                                               # two straps and buckles
        st = main & (np.abs(u - ux) < 0.07)
        r.lit(st, 0.86)
        r.lit(main & (np.abs(u - ux - 0.07) < 0.03), 0.62)
        bk = main & (np.abs(u - ux) < 0.09) & (np.abs(Y - 0.55) < 0.05)
        r.put(bk, "metal")
    r.lit(~main, 0.9)
    r.lit(~main & (Y < 0.2), 1.1)
    r.fold((0.1, 0.6), (0.3, 0.9)); r.fold((0.5, 0.65), (0.62, 0.95))
    r.clusters(3, 0.5, mat="mud", where=Y > 0.7, seed=3)
    r.clusters(4, 0.5, f=0.9, seed=4)
    return r


def paint_pouch():
    r = flat_reg("pouch", ["web", "metal", "mud"], 161)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    main = X < 0.75
    u = X / 0.75
    flap = main & (Y < 0.40)
    r.lit(flap, 1.14)
    r.lit(main & (np.abs(Y - 0.40) < 1.1 * ty), 0.5)                     # flap shadow
    r.lit(main & ((u < 1.2 * tx / 0.75) | (u > 1 - 1.2 * tx / 0.75)), 0.72)
    snap = main & (np.abs(u - 0.5) < 0.10) & (np.abs(Y - 0.30) < 0.06)
    r.put(snap, "metal"); r.lit(snap & (Y > 0.30), 0.6)
    r.lit(main & (Y > 0.90), 0.72)
    r.lit(~main, 0.84)
    r.clusters(2.5, 0.45, mat="mud", where=Y > 0.62, seed=3)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["trousers", "web", "metal", "jacket", "mud"], 31)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    ax = np.abs(X)
    bw = 0.048
    belt = Y < bw
    r.put(belt, "web")
    r.lit(belt & (Y < 1.1 * ty), 1.24)
    r.lit(belt & (Y > bw - 1.1 * ty), 0.62)
    for k in range(-14, 15):                                              # eyelet row
        r.lit(belt & (np.abs(r.dx(k * 0.045)) < 0.5 * tx) & (np.abs(Y - bw * 0.72) < 0.5 * ty), 0.5)
    bk = (ax < 0.030) & (Y > 0.004) & (Y < bw - 0.004)
    r.put(bk, "metal")
    r.lit((ax < 0.020) & (Y > 0.012) & (Y < bw - 0.012), 0.7)
    # jacket skirt below the belt, then the trousers
    skirt = (Y >= bw) & (Y < 0.112)
    r.put(skirt, "jacket")
    r.lit((Y >= bw) & (Y < bw + 1.4 * ty), 0.55)
    r.lit(np.abs(Y - 0.112) < 0.8 * ty, 0.6)
    r.lit(skirt & (ax < 0.8 * tx), 0.66)
    for sg in (-1, 1):                                                    # lower jacket pockets
        cx = sg * 0.09
        r.lit((np.abs(X - cx) < 0.04) & (np.abs(Y - bw - 0.012) < 0.8 * ty), 0.7)
    r.lit((Y >= 0.112) & (Y < 0.112 + 1.4 * ty), 0.62)
    r.fold((0.004, 0.12), (0.006, 0.19), off=(1.2 * tx, 0))
    for sg in (-1, 1):
        r.fold((sg * 0.02, 0.215), (sg * 0.07, 0.15), dark=0.74)
        r.fold((sg * 0.035, 0.225), (sg * 0.105, 0.17), dark=0.78)
        cx = r.P / 2 + sg * 0.075
        d = np.abs(r.dx(cx))
        pk = (d < 0.034) & (Y > 0.125) & (Y < 0.2)
        r.lit(pk & ~((d < 0.034 - tx) & (Y > 0.125 + ty) & (Y < 0.2 - ty)), 0.66)
    r.lit(np.clip((Y - 0.19) / 0.06, 0, 1), 0.84)
    r.clusters(4, 0.55, f=0.9, where=~belt, seed=3)
    r.clusters(5, 0.66, mat="mud", where=Y > 0.19, seed=6)
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["jacket", "mud", "bloodc"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    d = info["d"]
    r.lit(np.abs(Y - 0.050) < 0.6 * ty, 0.7)                            # shoulder seam
    r.lit(np.abs(Y - 0.050 + 1.2 * ty) < 0.6 * ty, 1.14)
    r.fold((-0.02, 0.08), (0.02, 0.17)); r.fold((P / 2 - 0.03, 0.12), (P / 2, 0.19))
    roll = (Y > d[2] - 0.006) & (Y < d[3] + 0.006)
    r.lit(roll, 1.16)
    for yk, f_ in ((d[2] - 0.006, 0.55), ((d[2] + d[3]) / 2, 0.72), (d[3] + 0.004, 0.55)):
        r.lit(np.abs(Y - yk) < 0.6 * ty, f_)
    r.lit(np.abs(Y - (d[2] + d[3]) / 2 - 1.2 * ty) < 0.6 * ty, 1.14)
    r.lit((Y > d[1]) & (Y < d[2] - 0.006), 0.84)                         # bunched above the roll
    r.lit(Y > d[3] + 0.008, 0.5)                                        # inside of the roll
    r.clusters(4, 0.55, f=0.9, seed=16 if L else 17)
    r.clusters(3, 0.62, mat="mud", seed=18 if L else 19)
    if not L:
        r.blob(0.01, 0.13, 0.010, 0.008, "bloodc", 0.9)
    return r


def paint_farm(I, sd):
    L = sd == "L"
    r = loft_reg("farm." + sd, I["farm." + sd], ["flesh", "hair", "leather", "metal", "gauze", "bloodc", "dirt"],
                 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    out = P / 4 if L else -P / 4                                          # outer side (back of the wrist)
    r.lit(np.clip(1 - Y / 0.05, 0, 1), 0.6)                              # shadow under the rolled sleeve
    r.lit(np.abs(r.B) < 0.045, 0.86)                                     # inner side
    r.lit(np.clip(1 - np.abs(r.dx(out * 0.6)) / 0.03, 0, 1) * (Y > 0.04) * (Y < 0.16), 1.14)  # muscle
    r.clusters(1.5, 0.55, f=0.92, where=np.abs(r.dx(out)) < 0.03, seed=5)   # arm hair
    r.clusters(5, 0.8, mat="dirt", seed=6 if L else 7)
    if L:                                                                  # wristwatch
        strap = (Y > Lt - 0.034) & (Y < Lt - 0.018)
        r.put(strap, "leather"); r.lit(strap & (Y > Lt - 0.022), 0.7)
        face = ell(r.dx(out), Y, 0, Lt - 0.026, 0.012, 0.012) < 1
        r.put(face, "metal"); r.lit(face & (Y > Lt - 0.026), 0.8)
    else:                                                                  # dirty field dressing
        gz = (Y > 0.085) & (Y < 0.150)
        r.put(gz, "gauze")
        for yk in (0.100, 0.118, 0.136):
            r.lit(gz & (np.abs(Y - yk - 0.02 * np.sin(X * 60)) < 0.6 * ty), 0.72)
        r.lit((Y >= 0.150) & (Y < 0.150 + 1.3 * ty), 0.6)
        r.blob(out, 0.118, 0.012, 0.014, "bloodc", rough=0.3)
        r.clusters(2.5, 0.5, f=0.85, where=gz, seed=8)
    return r


def paint_palm(I):
    r = loft_reg("palm", I["palm"], ["flesh", "dirt"], 91)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.abs(r.B) < 0.03, 0.78)                                       # palm side
    for x0_ in (-0.018, -0.006, 0.006, 0.018):                            # tendons, knuckles
        r.line([(x0_ * 0.6, 0.015), (x0_, Lt - 0.012)], 0.5 * tx, f=1.12)
        r.blob(x0_, Lt - 0.006, 0.0055, 0.005, None, 1.26, rough=0)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.72)
    r.clusters(3, 0.7, mat="dirt", seed=4)
    return r


def paint_finger(I):
    r = loft_reg("fing", I["fing"], ["flesh", "dirt"], 92)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    Lt = Y.max()
    for k in (0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9):                      # splits between the fingers
        r.lit(np.abs(U - k) < 0.012, 0.66)
    mid = Lt * 0.54
    r.lit(np.abs(Y - mid) < 0.004, 0.72)
    r.lit(np.abs(Y - mid + 0.006) < 0.003, 1.2)
    r.lit(Y > Lt - 0.008, 0.85)
    r.clusters(3, 0.72, mat="dirt", seed=5)
    return r


def paint_thumb(I):
    r = loft_reg("thumb", I["thumb"], ["flesh", "dirt"], 95)
    X, Y, P = r.X, r.Y, r.P
    U = X / P + 0.5
    Lt = Y.max()
    r.lit(np.abs(Y - Lt * 0.5) < 0.004, 0.72)
    r.lit((U > 0.25) & (U < 0.5) & (Y > Lt - 0.012), 1.18)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["trousers", "mud", "bloodc", "web"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    inner = -outer
    so = 1 if L else -1
    r.fold((outer, 0.0), (outer + so * 0.004, Lt), off=(-so * 1.2 * tx, 0))
    r.fold((inner, 0.0), (inner, Lt), dark=0.8, off=(so * 1.2 * tx, 0))
    for (y0_, y1_, dx0, dx1) in ((0.04, 0.22, -0.02, 0.06), (0.12, 0.30, -0.05, 0.03), (0.22, 0.38, -0.04, 0.05)):
        r.fold((inner * 0.5 + so * dx0, y0_), (so * dx1, y1_), off=(so * 1.2 * tx, -0.5 * ty))
    for yk in (Lt - 0.05, Lt - 0.025):                                     # knee creases
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    # big bellows cargo pocket on the outer thigh
    cx = outer
    d = np.abs(r.dx(cx))
    pk = (d < 0.050) & (Y > 0.15) & (Y < 0.31)
    r.lit(pk & ~((d < 0.050 - tx) & (Y > 0.15 + ty) & (Y < 0.31 - ty)), 0.6)
    r.lit((d < 0.052) & (Y > 0.147) & (Y < 0.185), 1.16)
    r.lit((d < 0.052) & (Y >= 0.185) & (Y < 0.185 + 1.3 * ty), 0.5)
    r.lit(pk & (Y > 0.27), 0.86)
    r.clusters(3, 0.3, f=1.12, where=(np.abs(X) < 0.07) & (Y > Lt - 0.08), seed=8)   # dusty knee
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    r.clusters(5, 0.66, mat="mud", where=Y > Lt * 0.55, seed=11 if L else 12)
    r.lit(np.clip(Y / Lt, 0, 1), 0.94)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    info = I["shin." + sd]
    r = loft_reg("shin." + sd, info, ["trousers", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    d = info["d"]
    r.lit(np.full(X.shape, 1.0), 0.92)
    b0 = d[1]
    bl = np.clip((Y - b0) / (d[2] - b0), 0, 1)
    ph = 2 * np.pi * X / 0.05 + 1.1 * np.sin(X * 31.0 + (3 if L else 1))
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.28)                           # bloused folds over the boot
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.66)
    r.lit(Y > d[2] + 0.01, 0.55)                                         # tucked under
    r.fold((-0.02, 0.02), (0.01, 0.12)); r.fold((P / 2 - 0.02, 0.0), (P / 2, 0.1))
    r.clusters(5, 0.5, mat="mud", where=Y > d[1] + 0.04, seed=11 if L else 12)
    r.clusters(4, 0.55, f=0.9, seed=13)
    return r


def paint_boot(I):
    info = I["boot"]
    r = loft_reg("boot", info, ["leather", "mud", "metal", "web"], 61)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ax = np.abs(X)
    z = 0.236 - Y
    r.lit(np.ones(X.shape), 0.92)
    for k in range(-3, 4):                                               # ankle creases
        r.fold((k * 0.045 + 0.01, 0.02), (k * 0.045 + 0.018, 0.09), off=(1.2 * tx, 0))
    lace = (ax < 0.018) & (z > 0.07)
    r.lit(lace, 0.78)
    for zk in np.arange(0.22, 0.075, -0.022):
        r.line([(-0.014, 0.236 - zk), (0.014, 0.236 - zk + 0.011)], 0.55 * tx, "web")
        r.put(ell(X, Y, -0.016, 0.236 - zk, 0.004, 0.004) < 1, "metal")
        r.put(ell(X, Y, 0.016, 0.236 - zk, 0.004, 0.004) < 1, "metal")
    toe = (ax < 0.07) & (z < 0.07)
    r.lit(toe * np.clip((z - 0.02) / 0.05, 0, 1), 1.3)                     # polished toe cap
    r.lit((ax < 0.075) & (np.abs(z - 0.066) < 0.004), 0.6)
    r.lit((np.abs(r.B) < 0.05) & (z < 0.085) & (z > 0.02), 0.86)          # heel counter
    welt = (z < 0.022) & (z > 0.012)
    r.lit(welt, 1.22)
    r.lit(z <= 0.012, 0.38)                                               # sole
    r.clusters(4, 0.25, mat="mud", where=z < 0.075, seed=14)
    r.clusters(2, 0.55, f=1.2, where=toe, seed=15)
    return r


def paint_page(I, light):
    regs = [paint_head(I), paint_neck(I), paint_helmet(I), paint_band(), paint_torso(I), paint_pack(),
            paint_pouch(), paint_pelvis(I), paint_boot(I), paint_palm(I), paint_finger(I), paint_thumb(I)]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd), paint_farm(I, sd)]
    page = np.zeros((AT, AT, 3)); page[:] = C((22, 22, 20))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = light[y0:y0 + h, x0:x0 + w]
        lt = blur2(lt, 0.8, 0.8, wrap=r.P is not None)
        if r.name == "band":                                # six parts share it: paint only, keep it clean
            lt = np.ones_like(lt)
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
    return page


def save_png(path, arr, k=1):
    arr = np.clip(arr, 0, 1)
    if k > 1:
        arr = np.kron(arr, np.ones((k, k, 1)))
    hh, ww = arr.shape[:2]
    img = bpy.data.images.new("tmp_png", ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = arr[::-1]
    img.pixels.foreach_set(px.ravel())
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    img.filepath_raw = os.path.abspath(path); img.file_format = "PNG"; img.save()
    bpy.data.images.remove(img)


def make_image(name, arr):
    hh, ww = arr.shape[:2]
    img = bpy.data.images.new(name, ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = arr[::-1]
    img.pixels.foreach_set(px.ravel())
    try:
        img.pack()
    except Exception as e:
        print("pack failed:", e)
    return img


# ---------------------------------------------------------------- export

def r4(x):
    v = round(float(x), 4)
    return 0.0 if v == 0 else v


def export_model(objs, hands, tris):
    """public/models/survivor.json in the STYLE.md / models.js format (three.js space)."""
    joints = {}
    for jn, par, pos in JOINTS:
        p = V(pos) - (JW[par] if par else V((0, 0, 0)))
        joints[jn] = {"parent": par, "pos": [r4(c) for c in to3(p)]}
    parts = []
    for ob, joint in objs:
        me = ob.data
        me.calc_loop_triangles()
        uvd = me.uv_layers["UVMap"].data
        cn = me.corner_normals
        col = me.color_attributes.get("Col")
        seen, pos, nrm, uv, cc, idx = {}, [], [], [], [], []
        for tri in me.loop_triangles:
            for li in tri.loops:
                p = to3(me.vertices[me.loops[li].vertex_index].co)
                n = to3(cn[li].vector)
                t = uvd[li].uv
                c = col.data[li].color if col else (1, 1, 1, 1)
                key = (r4(p[0]), r4(p[1]), r4(p[2]), r4(n[0]), r4(n[1]), r4(n[2]), r4(t.x), r4(1 - t.y),
                       round(c[0], 3), round(c[1], 3), round(c[2], 3))
                k = seen.get(key)
                if k is None:
                    k = seen[key] = len(seen)
                    pos += key[0:3]; nrm += key[3:6]; uv += key[6:8]; cc += key[8:11]
                idx.append(k)
        parts.append({"name": ob.name, "joint": joint, "pos": pos, "nrm": nrm, "uv": uv, "col": cc, "idx": idx})
    data = {"version": 1, "texture": "survivor.png", "joints": joints, "parts": parts,
            "meta": {"style": "survivor", "tris": tris, "page": [AT, AT], "tint": TINT, "hands": hands,
                     "note": "tint parts are painted neutral near-white: multiply by the player colour. "
                             "hands: rest-pose axis (wrist -> knuckles), palm normal and grip-channel offset "
                             "from the wrist joint, in the hand joint's space"}}
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, "survivor.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"[survivor] export -> {path} ({os.path.getsize(path) // 1024} KB, {tris} tris)")


# ---------------------------------------------------------------- materials (ps1b look)

def fog_group():
    ng = bpy.data.node_groups.get("SRV_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("SRV_Fog", "ShaderNodeTree")
    ng.interface.new_socket(name="Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    N, Lk = ng.nodes, ng.links
    go = N.new("NodeGroupOutput")
    tc = N.new("ShaderNodeTexCoord")
    sub = N.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.56, 0.0)
    Lk.new(tc.outputs["Window"], sub.inputs[0])
    asp = N.new("ShaderNodeVectorMath"); asp.operation = "MULTIPLY"; asp.name = "Aspect"
    asp.inputs[1].default_value = (0.75, 1.0, 0.0)
    Lk.new(sub.outputs[0], asp.inputs[0])
    ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    Lk.new(asp.outputs[0], ln.inputs[0])
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0; mr.inputs["From Max"].default_value = 0.62
    mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 0.0
    Lk.new(ln.outputs["Value"], mr.inputs["Value"])
    pw = N.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 1.4
    Lk.new(mr.outputs["Result"], pw.inputs[0])
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.name = "FogCols"
    Lk.new(pw.outputs[0], mix.inputs[0])
    mix.inputs[6].default_value = lin(FOG_DARK); mix.inputs[7].default_value = lin(FOG_GLOW)
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.6; nz.inputs["Detail"].default_value = 3.0
    nz.inputs["Roughness"].default_value = 0.55
    off = N.new("ShaderNodeVectorMath"); off.operation = "ADD"; off.inputs[1].default_value = (3.7, 1.3, 0.5)
    Lk.new(asp.outputs[0], off.inputs[0]); Lk.new(off.outputs[0], nz.inputs["Vector"])
    mr2 = N.new("ShaderNodeMapRange")
    mr2.inputs["From Min"].default_value = 0.30; mr2.inputs["From Max"].default_value = 0.70
    mr2.inputs["To Min"].default_value = 0.6; mr2.inputs["To Max"].default_value = 1.4
    Lk.new(nz.outputs["Fac"], mr2.inputs["Value"])
    mul = N.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    Lk.new(mix.outputs[2], mul.inputs[6]); Lk.new(mr2.outputs["Result"], mul.inputs[7])
    Lk.new(mul.outputs[2], go.inputs[0])
    return ng


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, tint=None):
    """Texture (nearest) x vertex colour (x tint), lit by a sun plus flat ambient,
    mixed to the fog colour by camera distance."""
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree; nt.nodes.clear(); N, Lk = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    tex = N.new("ShaderNodeTexImage"); tex.image = img; tex.interpolation = "Closest"
    col = tex.outputs["Color"]
    if mapping:
        geo = N.new("ShaderNodeNewGeometry")
        sep = N.new("ShaderNodeSeparateXYZ"); Lk.new(geo.outputs["Position"], sep.inputs[0])
        comb = N.new("ShaderNodeCombineXYZ")
        Lk.new(sep.outputs["X"], comb.inputs["X"])
        Lk.new(sep.outputs["Y" if mapping == "floor" else "Z"], comb.inputs["Y"])
        mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1 / tex_scale, 1 / tex_scale, 1.0)
        Lk.new(comb.outputs[0], mp.inputs["Vector"]); Lk.new(mp.outputs["Vector"], tex.inputs["Vector"])
        tex.extension = "REPEAT"
        if mapping == "floor":
            sq = N.new("ShaderNodeVectorMath"); sq.operation = "MULTIPLY"; sq.inputs[1].default_value = (1.0, 0.85, 0.0)
            Lk.new(geo.outputs["Position"], sq.inputs[0])
            ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"; Lk.new(sq.outputs[0], ln.inputs[0])
            ramp = N.new("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = "EASE"
            cr.elements[0].position = 0.0; cr.elements[0].color = (0.30, 0.30, 0.30, 1)
            cr.elements[1].position = 0.45; cr.elements[1].color = (1, 1, 1, 1)
            Lk.new(ln.outputs["Value"], ramp.inputs["Fac"])
            sh = N.new("ShaderNodeMix"); sh.data_type = "RGBA"; sh.blend_type = "MULTIPLY"; sh.inputs[0].default_value = 1.0
            Lk.new(col, sh.inputs[6]); Lk.new(ramp.outputs["Color"], sh.inputs[7])
            col = sh.outputs[2]
    if vcol:
        vc = N.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
        vm = N.new("ShaderNodeMix"); vm.data_type = "RGBA"; vm.blend_type = "MULTIPLY"; vm.inputs[0].default_value = 1.0
        Lk.new(col, vm.inputs[6]); Lk.new(vc.outputs["Color"], vm.inputs[7])
        col = vm.outputs[2]
    if tint:
        tm = N.new("ShaderNodeMix"); tm.data_type = "RGBA"; tm.blend_type = "MULTIPLY"; tm.inputs[0].default_value = 1.0
        Lk.new(col, tm.inputs[6]); tm.inputs[7].default_value = lin(tint)
        col = tm.outputs[2]
    dif = N.new("ShaderNodeBsdfDiffuse"); Lk.new(col, dif.inputs["Color"])
    amb = N.new("ShaderNodeMix"); amb.data_type = "RGBA"; amb.blend_type = "MULTIPLY"; amb.name = "Ambient"
    amb.inputs[0].default_value = 1.0
    Lk.new(col, amb.inputs[6]); amb.inputs[7].default_value = (AMB, AMB, AMB, 1.0)
    em = N.new("ShaderNodeEmission"); Lk.new(amb.outputs[2], em.inputs["Color"])
    add = N.new("ShaderNodeAddShader")
    Lk.new(dif.outputs[0], add.inputs[0]); Lk.new(em.outputs[0], add.inputs[1])
    fg = N.new("ShaderNodeGroup"); fg.node_tree = fog_group()
    fem = N.new("ShaderNodeEmission"); Lk.new(fg.outputs[0], fem.inputs["Color"])
    cam = N.new("ShaderNodeCameraData")
    fr = N.new("ShaderNodeMapRange"); fr.name = "FogRange"
    fr.inputs["From Min"].default_value = 3.0; fr.inputs["From Max"].default_value = 13.0
    Lk.new(cam.outputs["View Distance"], fr.inputs["Value"])
    mx = N.new("ShaderNodeMixShader")
    Lk.new(fr.outputs["Result"], mx.inputs[0]); Lk.new(add.outputs[0], mx.inputs[1]); Lk.new(fem.outputs[0], mx.inputs[2])
    Lk.new(mx.outputs[0], out.inputs["Surface"])
    return m


# ---------------------------------------------------------------- build

HERO_TINT = (0x6a, 0xa9, 0xff)      # renders show player 2's blue


def build():
    root = kit.empty("SURVIVOR")
    I, parts, hands = build_geometry()
    objs = []
    for name, joint, pieces in parts:
        ob = rig_part(name, pieces, JW[joint], root)
        objs.append((ob, joint))
    bpy.context.view_layer.update()
    for ob, _ in objs:
        vertex_tint(ob, ob.name)
    light = bake_light([o for o, _ in objs])
    page = paint_page(I, light)
    os.makedirs(OUT, exist_ok=True)
    save_png(os.path.join(OUT, "texture_page.png"), page)
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(MODELS, "survivor.png"), page)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o, _ in objs)
    export_model(objs, hands, tris)
    img = make_image("survivor_page", page)
    mat = ps1_mat("SRV_Survivor", img)
    tmat = ps1_mat("SRV_Band", img, tint=HERO_TINT)
    for ob, _ in objs:
        kit.assign(ob, tmat if ob.name in TINT else mat)
    return root


# ---------------------------------------------------------------- stage, snapping, post

SNAP = []


def snap_vertices():
    sc = bpy.context.scene; cam = sc.camera
    bpy.context.view_layer.update()
    rx = sc.render.resolution_x * sc.render.resolution_percentage // 100
    ry = sc.render.resolution_y * sc.render.resolution_percentage // 100
    step = (cam.data.sensor_width / cam.data.lens) / max(rx, ry)
    Ci = np.array(cam.matrix_world.inverted())
    for ob, rest in SNAP:
        A = Ci @ np.array(ob.matrix_world); Ai = np.linalg.inv(A)
        P = rest @ A[:3, :3].T + A[:3, 3]
        z = -P[:, 2]
        sx = np.round(P[:, 0] / z / step) * step
        sy = np.round(P[:, 1] / z / step) * step
        Q = np.stack([sx * z, sy * z, P[:, 2]], 1)
        Lc = Q @ Ai[:3, :3].T + Ai[:3, 3]
        ob.data.vertices.foreach_set("co", Lc.astype(np.float32).ravel())
        ob.data.update()


_render_to = kit.render_to


def render_native(path):
    bpy.context.scene.render.resolution_percentage = 100
    snap_vertices()
    return _render_to(path)


kit.render_to = render_native


def fog_card(cam, size=24.0):
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0))]
    bm.faces.new(vv)
    card = kit.mesh_obj("FogCard", bm, None, smooth=False)
    card.parent = cam; card.location = (0, 0, -45)
    cm = bpy.data.materials.new("SRV_FogCard")
    try:
        cm.use_nodes = True
    except Exception:
        pass
    nt = cm.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    g = nt.nodes.new("ShaderNodeGroup"); g.node_tree = fog_group()
    nt.links.new(g.outputs[0], em.inputs["Color"]); nt.links.new(em.outputs[0], o.inputs["Surface"])
    kit.assign(card, cm)
    return card


def set_fog(dist, near_c=1.2, far_c=9.0, near_f=2.4, far_f=6.0):
    for m in bpy.data.materials:
        fr = m.node_tree.nodes.get("FogRange") if m.node_tree else None
        if fr:
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("SRV_Env") else (dist - near_c, dist + far_c)
            fr.inputs["From Min"].default_value = near
            fr.inputs["From Max"].default_value = far


def paint_floor():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("floor", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 111)
    r.clusters(10, 0.4, f=0.92, seed=21)
    r.clusters(7, 0.6, f=1.06, seed=22)
    r.clusters(3, 0.66, f=0.93, seed=23)
    r.lit((Xg < 1.2 / w) | (Yg < 1.2 / h), 0.75)
    return r.finish(np.ones((h, w)))


def paint_wall():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wall", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 121)
    for yk in (0.0, 0.5):
        r.lit(np.abs(Yg - yk) < 0.9 / h, 0.7)
        r.lit(np.abs(Yg - yk - 1.2 / h) < 0.5 / h, 1.12)
    r.clusters(20, 0.2, f=0.9, seed=31)
    r.clusters(12, 0.5, f=1.06, seed=32)
    return r.finish(np.full((h, w), 0.9))


def paint_wood():
    h, w = 16, 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wood", ["wood"], Xg, Yg, 1.0, 1 / w, 1 / h, 131)
    g = np.sin(Yg * 2 * np.pi * 3 + 1.5 * np.sin(Xg * 9))
    r.lit(np.clip(g, 0, 1), 1.18); r.lit(np.clip(-g, 0, 1), 0.82)
    r.lit((Yg < 1.2 / h) | (Yg > 1 - 1.2 / h), 0.6)
    for x_ in (0.06, 0.94):
        r.lit(ell(Xg, Yg, x_, 0.5, 1.5 / w, 1.5 / h) < 1, 0.4)
    return r.finish(np.ones((h, w)))


def stage(root):
    sc = kit.render_setup("EEVEE", NATIVE, samples=1, view="Standard", filter_px=0.0)
    ee = sc.eevee
    for attr in ("use_raytracing", "use_shadows", "use_gtao", "use_volumetric_shadows", "use_bloom"):
        try:
            setattr(ee, attr, False)
        except Exception:
            pass
    kit.world((0, 0, 0), 0.0)
    sun = kit.sun("Sun", rot=(52, 0, -30), strength=SUN, angle=1.0, color=SUN_COL)
    sun.data.use_shadow = False
    back = kit.sun("BackLight", rot=(-62, 0, -150), strength=BACK, angle=1.0, color=(0.45, 0.85, 0.55))
    back.data.use_shadow = False
    cam = kit.camera(lens=50)
    kit.frame_to(cam, root, margin=1.07, aim_frac=0.5, elev=0.10)
    fog_card(cam)
    bm = bmesh.new()
    F = 60.0
    vv = [bm.verts.new(p) for p in ((-F, -F, -0.002), (F, -F, -0.002), (F, F, -0.002), (-F, F, -0.002))]
    bm.faces.new(vv)
    floor = kit.mesh_obj("Floor", bm, None, smooth=False)
    kit.assign(floor, ps1_mat("SRV_EnvFloor", make_image("srv_floor", paint_floor()), "floor", vcol=False, tex_scale=1.2))
    set_fog(cam.location.length)
    SNAP.clear()
    for ob in kit.descendants(root):
        if ob.type == "MESH":
            rest = np.empty(len(ob.data.vertices) * 3, np.float32)
            ob.data.vertices.foreach_get("co", rest)
            SNAP.append((ob, rest.reshape(-1, 3).astype(np.float64)))


PS1_DITHER = np.array([[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]], float)


def crt(a, k=UP):
    """Native frame -> 1997 TV (the ps1b composite pass)."""
    H, W = a.shape[:2]
    rgb = a[..., :3].astype(np.float64)
    d = PS1_DITHER[(np.arange(H) % 4)[:, None], (np.arange(W) % 4)[None, :]][..., None]
    rgb = np.floor(np.clip(rgb * 255 + d, 0, 255) / 8) / 31
    bright = np.clip(rgb - 0.55, 0, None)
    glow = 0.30 * blur2(bright, 1.6) + 0.22 * blur2(bright, 5.0)
    Y = rgb @ np.array([0.299, 0.587, 0.114])
    I_ = rgb @ np.array([0.596, -0.274, -0.322])
    Q_ = rgb @ np.array([0.211, -0.523, 0.312])
    up = lambda x: np.repeat(np.repeat(x, k, 0), k, 1)
    Yu = gblur(gblur(up(Y), 0.50 * k, 1), 0.28 * k, 0)
    Yu = Yu + 0.22 * (Yu - gblur(Yu, 1.3 * k, 1))
    Iu = gblur(gblur(up(I_), 1.25 * k, 1), 0.45 * k, 0)
    Qu = gblur(gblur(up(Q_), 1.25 * k, 1), 0.45 * k, 0)
    sh = max(1, int(round(0.35 * k)))
    Iu = np.roll(Iu, sh, 1); Qu = np.roll(Qu, sh, 1)
    out = np.stack([Yu + 0.956 * Iu + 0.621 * Qu, Yu - 0.272 * Iu - 0.647 * Qu, Yu - 1.106 * Iu + 1.703 * Qu], -1)
    out += gblur(gblur(up(glow), 0.6 * k, 1), 0.6 * k, 0)
    j = (np.arange(H * k) % k + 0.5) / k
    gap = (np.abs(j - 0.5) * 2) ** 2
    lum = np.clip(out @ np.array([0.299, 0.587, 0.114]), 0, 1)
    out *= (1 - 0.12 * gap[:, None] * (1 - 0.7 * lum))[..., None]
    yy, xx = np.meshgrid(np.linspace(-1, 1, H * k), np.linspace(-1, 1, W * k), indexing="ij")
    out *= (1 - 0.07 * (xx ** 2 + yy ** 2))[..., None]
    res = np.ones((H * k, W * k, 4))
    res[..., :3] = np.clip(out, 0, 1)
    return res


def post(path):
    kit.numpy_post(path, crt)


def ingame(root):
    """The survivor at in-game distance: 320x240 in the dark bunker, ~5 m away."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    root.rotation_euler.z = math.radians(-24)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.55, -4.6, 1.62)
    kit._aim(cam, (0.1, 0, 1.0))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = fog_group()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = lin((5, 8, 7)); mix.inputs[7].default_value = lin((26, 36, 30))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    wmat = ps1_mat("SRV_EnvWall", make_image("srv_wall", paint_wall()), "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    kit.assign(kit.mesh_obj("Wall", bm, None, smooth=False), wmat)
    dark = ps1_mat("SRV_EnvHole", make_image("srv_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
    bm.faces.new(vv)
    kit.assign(kit.mesh_obj("Window", bm, None, smooth=False), dark)
    wm = ps1_mat("SRV_EnvWoodM", make_image("srv_wood", paint_wood()), None, vcol=False)
    for k, (zc, ang) in enumerate(((1.22, 4), (1.53, -3), (1.84, 5))):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                lp[uvl].uv = uv
        pl = kit.mesh_obj(f"Plank{k}", bm, None, smooth=False)
        pl.scale = (1.62, 0.03, 0.17)
        pl.location = (-1.2, 2.53, zc)
        pl.rotation_euler = (0, math.radians(ang), 0)
        kit.assign(pl, wm)
    chalk = ps1_mat("SRV_EnvChalk", make_image("srv_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                     [C((126, 38, 32)), C((160, 52, 42))]])), None, vcol=False)
    strokes = [((0.70 + 0.11 * k, 1.42), (0.72 + 0.11 * k, 1.90)) for k in range(4)] + [((0.62, 1.50), (1.14, 1.80))]
    for k, ((xa, za), (xb, zb)) in enumerate(strokes):
        d = V((xb - xa, 0, zb - za)); nrm = V((-d.z, 0, d.x)).normalized() * 0.022
        bm = bmesh.new()
        vv = [bm.verts.new((p_.x, 2.585, p_.z)) for p_ in (V((xa, 0, za)) - nrm, V((xb, 0, zb)) - nrm,
                                                          V((xb, 0, zb)) + nrm, V((xa, 0, za)) + nrm)]
        bm.faces.new(vv)
        kit.assign(kit.mesh_obj(f"Chalk{k}", bm, None, smooth=False), chalk)
    set_fog((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=10.0, near_f=2.0, far_f=5.0)
    for m in bpy.data.materials:
        a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
        if a:
            k_ = 0.55 if m.name.startswith("SRV_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[survivor] ingame ->", p)


kit.run(STYLE, build, stage, post,
        meta={"technique": "rigid faceted lofted segments with hard normals (>30 deg), vertex colours; 256px page, "
                           "a CLUT ramp per material, painted light x Cycles-baked AO/facet light; player colour by "
                           "multiplying 4 neutral tint parts; native 300x400 + composite/CRT post",
              "texture_page": "256x256", "joints": len(JOINTS)})

if "--final" in ARGS or "--ingame" in ARGS:
    ingame(bpy.data.objects["SURVIVOR"])
