# Polygon Ghoul v2 (ps1b): the 1997 32-bit console zombie, done the way period
# artists did it.
#
# Model: ~950 triangles in rigid segments pivoted at the joints (the game's 13-part
# rig), Gouraud-smooth within each part (hard edges only on soles and cap rims),
# with vertex colours for tint and extremity darkening.
# Texture: ONE 256x256 page, 16-colour CLUT per part. Each part is painted as
# material ids + painted light (folds as dark/light pairs, seams, highlights), then
# multiplied by lighting baked in Cycles from the model itself (AO + smooth
# normals lit by a symmetric top-front key), then quantised to its hue-shifted
# ramps (cool shadows, warm highlights) and hand-touched. The face gets the biggest
# block of the page and is mirrored left/right (double resolution).
# Presentation: rendered at native 300x400 (no AA, nearest texels, vertices snapped
# to the pixel grid), then shown like a 1997 TV: PS1 15-bit dither, x3 upscale
# through a composite/CRT pass (horizontal blur + chroma bleed, faint scanlines,
# a little bloom).
#
#   node art/zombies/blend.mjs z_ps1b.py --preview [--views front,side,back] [--ingame]
#   node art/zombies/blend.mjs z_ps1b.py --final        (heroes, turntable, ingame.png)
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix

STYLE = "ps1b"
OUT = os.path.join(kit.OUT_BASE, STYLE)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DBG = os.path.join(OUT, "_d") if os.environ.get("PS1B_DEBUG") else None   # bake/debug images
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# dark -> light, hue-shifted: shadows lean cool/purple, highlights warm. The second
# value is the "lit base" entry (light = 1.0).
RAMPS = {
    "skin": ([(32, 30, 36), (50, 50, 54), (70, 72, 70), (92, 96, 88), (114, 118, 104),
              (136, 140, 120), (160, 162, 138), (188, 186, 158)], 5),
    "skin3": ([(70, 72, 70), (114, 118, 104), (160, 162, 138)], 1),
    "livid": ([(44, 28, 32), (80, 50, 54), (120, 82, 80)], 2),
    "hair": ([(20, 18, 22), (38, 34, 34), (60, 54, 48)], 1),
    "livid2": ([(52, 32, 36), (104, 68, 68)], 1),
    "blood": ([(38, 4, 8), (92, 14, 16), (140, 30, 24)], 1),
    "bloodc": ([(36, 12, 12), (66, 20, 18), (96, 30, 24)], 1),
    "bloodc2": ([(44, 14, 14), (80, 24, 20)], 1),
    "shirt": ([(32, 32, 30), (50, 48, 38), (70, 66, 46), (92, 86, 58), (116, 108, 72), (144, 134, 92)], 3),
    "shirt2": ([(70, 66, 46), (116, 108, 72)], 1),
    "khaki": ([(92, 80, 56), (138, 124, 88), (182, 168, 126)], 1),
    "metal": ([(60, 58, 56), (170, 166, 150)], 1),
    "metal1": ([(170, 166, 150)], 0),
    "trousers": ([(24, 27, 27), (36, 40, 35), (50, 55, 43), (65, 71, 54), (82, 88, 66),
                  (102, 107, 80), (126, 128, 98)], 4),
    "leather": ([(18, 14, 14), (32, 25, 22), (47, 36, 28), (64, 49, 36), (86, 68, 50)], 3),
    "mud": ([(66, 56, 42), (100, 88, 64)], 1),
    "dirt": ([(40, 34, 30), (74, 64, 50)], 1),
    "cap": ([(30, 32, 28), (46, 50, 38), (64, 68, 48), (84, 88, 60), (106, 110, 76), (134, 136, 96)], 3),
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
    "head": (0, 0, 96, 96), "torso": (96, 0, 128, 64), "cap": (224, 0, 32, 32),
    "neck": (224, 32, 32, 16), "palm": (224, 48, 32, 16), "pelvis": (96, 64, 128, 24),
    "fingA": (224, 64, 16, 16), "fingB": (240, 64, 16, 16), "thumb": (224, 80, 16, 16),
    "boot": (96, 88, 64, 24),
    "thigh.L": (0, 112, 64, 48), "thigh.R": (64, 112, 64, 48),
    "shin.L": (128, 112, 64, 48), "shin.R": (192, 112, 64, 48),
    "uarm.L": (0, 160, 48, 32), "uarm.R": (48, 160, 48, 32),
    "farm.L": (96, 160, 32, 32), "farm.R": (128, 160, 32, 32),
}
HEAD_FC = 64          # head columns spent on the face quarter (front centre -> ear)


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


# ---------------------------------------------------------------- numpy helpers

def lowfreq(rng, h, w, cell, wrap=True):
    """Smooth value noise in [-1, 1] (wraps horizontally)."""
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


# ---------------------------------------------------------------- the painter

class Reg:
    """One texture-page region painted as material ids + painted light, in metres.
    X runs round the part (0 = front centre, + = character's left, wraps if P),
    Y runs down the part (0 = first ring). Quantised to the part's CLUT by finish()."""

    def __init__(s, name, mats, X, Y, P=None, tx=0.01, ty=0.01, seed=0):
        s.name = name
        s.h, s.w = X.shape
        s.mats = list(mats)
        s.X, s.Y, s.P, s.tx, s.ty = X, Y, P, tx, ty
        s.id = np.zeros((s.h, s.w), np.int16)
        s.sh = np.ones((s.h, s.w))
        s.rng = np.random.default_rng(seed)
        s.nz = lowfreq(s.rng, s.h, s.w, 3)                 # edge roughness
        s.fixes = []
        s.dither = 0.0

    # coordinates
    def dx(s, x0):
        d = s.X - x0
        return (d + s.P / 2) % s.P - s.P / 2 if s.P else d

    @property
    def B(s):                                              # from the back centre
        return (s.X % s.P) - s.P / 2 if s.P else s.X

    def m(s, name):
        return s.mats.index(name)

    def put(s, mask, mat):
        s.id[np.asarray(mask) > 0.5] = s.m(mat)

    def lit(s, mask, f):
        s.sh *= 1 + (f - 1) * np.clip(np.asarray(mask, float), 0, 1)

    # shapes
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
        """A cloth fold: dark crease plus a lit ridge beside it."""
        w = w or 0.6 * s.tx
        off = off or (1.2 * s.tx, -0.4 * s.ty)
        s.line([p0, p1], w, f=dark)
        s.line([(p0[0] + off[0], p0[1] + off[1]), (p1[0] + off[0], p1[1] + off[1])], w, f=light)

    def drip(s, x0, y0, length, w=None, mat="blood", f=None, wobble=0.25):
        w = w or 0.55 * s.tx
        n = max(2, int(length / (2 * s.ty)))
        pts = [(x0, y0)]
        x = x0
        for k in range(1, n + 1):
            x += s.rng.uniform(-wobble, wobble) * s.tx
            pts.append((x, y0 + length * k / n))
        s.line(pts, w, mat, f)
        s.blob(x, y0 + length, w * 1.6, w * 1.8, mat, f, rough=0.0)

    def splat(s, x0, y0, rad, mat="bloodc", drips=2, f=0.85, rough=0.35):
        s.blob(x0, y0, rad, rad * 0.85, mat, None, rough)
        s.blob(x0 + rad * 0.15, y0 - rad * 0.1, rad * 0.55, rad * 0.45, None, f, rough)
        for _ in range(drips):
            s.drip(x0 + s.rng.uniform(-0.6, 0.6) * rad, y0 + rad * 0.4, s.rng.uniform(1.2, 3.0) * rad, mat=mat)

    def clusters(s, cell, thr, f=None, mat=None, where=1.0, seed=0):
        n = lowfreq(np.random.default_rng(seed + 991), s.h, s.w, cell)
        mk = (n > thr) * np.asarray(where, float)
        if f is not None:
            s.lit(mk, f)
        if mat:
            s.put(mk, mat)
        return mk

    def fix(s, x, y, mat, k):
        """Hand-set one texel (after quantising) at part coordinates (x, y)."""
        d = np.abs(s.dx(x)) / s.tx + np.abs(s.Y - y) / s.ty
        r, c = np.unravel_index(np.argmin(d), d.shape)
        s.fixes.append((r, c, mat, k))

    def finish(s, light):
        L = np.clip(s.sh * light, 0.02, 4.0)
        out = np.zeros((s.h, s.w, 3))
        bay = np.array([[-0.25, 0.25], [0.25, -0.25]])[(np.arange(s.h) % 2)[:, None], (np.arange(s.w) % 2)[None, :]]
        for mi, mn in enumerate(s.mats):
            sel = s.id == mi
            if not sel.any():
                continue
            ll = RAMP_LL[mn]
            lv = np.log(L[sel])
            if s.dither and len(ll) > 1:
                lv = lv + s.dither * bay[sel] * np.mean(np.diff(ll))
            k = np.abs(lv[:, None] - ll[None, :]).argmin(1)
            out[sel] = RAMP_C[mn][k]
        for r, c, mn, k in s.fixes:
            out[r, c] = RAMP_C[mn][k]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[ps1b] WARNING region {s.name} uses {n} colours")
        return out


def loft_reg(name, info, mats, seed=0):
    """Reg over a loft region: X round the part at its widest ring, Y along it."""
    x0, y0, w, h = REG[name]
    P, Ltot = info["Pm"], info["L"]
    vrows = [(1 - v) * h for v in info["v"]]
    dist = info["d"]
    cols = (np.arange(w) + 0.5) / w
    rows = np.interp(np.arange(h) + 0.5, vrows, dist)
    U, Y = np.meshgrid(cols, rows)
    X = (U - 0.5) * P
    return Reg(name, mats, X, Y, P, P / w, Ltot / h, seed)


# ---------------------------------------------------------------- geometry

def prof(w, df, db, n=8, e=0.85, push=None):
    """Closed n-gon cross-section (superellipse, e < 1 = boxier) in (side, front)
    coordinates, starting at the back and running round the character's right side.
    push = {k: (dx, dy)} moves vertex k and its mirror (n - k, x flipped)."""
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
    """Flat hexagon (hands): ridge at the back/front centres, flat sides."""
    return [[0, -d], [-w, -d * 0.45], [-w, d * 0.45], [0, d], [w, d * 0.45], [w, -d * 0.45]]


def boxprof(w, d):
    return [[-w, -d], [-w, d], [w, d], [w, -d]]


def uv_in(reg, x, v):
    x0, y0, w, h = reg
    eps = 0.02
    col = min(max(x * w, eps), w - eps)
    row = min(max((1 - v) * h, eps), h - eps)
    return ((x0 + col) / AT, 1 - (y0 + row) / AT)


def loft(name, cs, profs, fref, reg, caps=(True, True), mirror=None, vs=None, sharp=(), smooth=True):
    """A rigid segment: rings of profile points round a centre line. UVs wrap round
    the ring by arc length (or mirrored: 0 = front centre, `mirror` = the side
    vertex, 1 = back centre, so both halves share texels) and run along the segment
    (v = 1 at the first ring). End caps get a degenerate UV on the end row (a flat
    colour, and ignored by the bake). `sharp` = profile vertices whose lengthwise
    edges stay hard."""
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, xs, Ps, Qs = [], [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        rings.append([bm.verts.new(cs[i] + s * x + f * y) for x, y in profs[i]])
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
    if vs is None:
        vs = [1 - x / d[-1] for x in d]

    def face(vv, uu, want, sm):
        co = [v.co for v in vv]
        nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
        if nrm.dot(want) < 0:
            vv, uu = vv[::-1], uu[::-1]
        fc = bm.faces.new(vv)
        fc.smooth = sm
        for lp, uv in zip(fc.loops, uu):
            lp[uvl].uv = uv_in(reg, *uv)
        return fc

    for i in range(m - 1):
        cm = (cs[i] + cs[i + 1]) / 2
        for k in range(n):
            k1 = (k + 1) % n
            vv = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]
            uu = [(xs[i][k], vs[i]), (xs[i][k + 1], vs[i]), (xs[i + 1][k + 1], vs[i + 1]), (xs[i + 1][k], vs[i + 1])]
            ctr = sum((v.co for v in vv), V()) / 4
            face(vv, uu, ctr - cm, smooth)
    xc = 0.0 if mirror is not None else 0.5
    for end, i in ((0, 0), (1, m - 1)):
        if not caps[end]:
            continue
        uu = [(xc, vs[i] + (-0.02 if end == 0 else 0.02))] * n
        face(rings[i][:], uu, -ts[0] if end == 0 else ts[-1], False)
        for k in range(n):
            e = bm.edges.get((rings[i][k], rings[i][(k + 1) % n]))
            if e:
                e.smooth = False
    for k in sharp:
        for i in range(m - 1):
            e = bm.edges.get((rings[i][k], rings[i + 1][k]))
            if e:
                e.smooth = False
    ob = kit.mesh_obj(name, bm, None, smooth=False)
    return ob, {"v": vs, "P": Ps, "Pm": max(Ps), "L": d[-1], "d": d, "Q": Qs}


def rig_part(name, objs, pivot, root):
    ob = kit.join(objs) if len(objs) > 1 else objs[0]
    ob.name = name; ob.data.name = name
    ob.data.transform(Matrix.Translation(-V(pivot)))
    ob.location = pivot
    ob.parent = root
    return ob


# head rings, crown .. under the jaw: (z, y, half-width, front, back, {vertex: push})
HEADR = [
    (1.790, -0.052, 0.056, 0.058, 0.068, {}),
    (1.768, -0.056, 0.087, 0.096, 0.100, {}),
    (1.700, -0.058, 0.100, 0.104, 0.104, {6: (0, 0.012), 5: (0, 0.010), 4: (0, 0.004)}),        # brow ridge
    (1.667, -0.058, 0.098, 0.098, 0.100, {5: (0.002, -0.011), 6: (0, 0.004)}),                  # sockets, bridge
    (1.630, -0.059, 0.095, 0.096, 0.094, {6: (0, 0.040), 5: (0.004, 0.003), 4: (0.004, -0.002)}),  # nose, cheekbones
    (1.598, -0.061, 0.084, 0.098, 0.082, {6: (0, -0.004), 4: (-0.008, -0.006)}),                # mouth, hollow cheeks
    (1.566, -0.064, 0.064, 0.094, 0.064, {6: (0, 0.008), 5: (0, 0.004)}),                       # chin
    (1.542, -0.070, 0.050, 0.050, 0.050, {}),
]
HEAD_ROWS = (0, 7, 27, 39, 53, 65, 81, 96)   # texel rows of the rings (face gets most)
HZ = [r[0] for r in HEADR]


def build_geometry():
    I, parts = {}, []
    fwd = V((0, -1, 0)); up = V((0, 0, 1))

    # torso (10-sided): neck base, shoulders, chest, ribs, bloused shirt, tucked in
    T = [(1.505, -0.070, 0.086, 0.062, 0.066),
         (1.462, -0.066, 0.214, 0.104, 0.100),
         (1.370, -0.048, 0.210, 0.126, 0.114),
         (1.230, -0.024, 0.190, 0.118, 0.106),
         (1.090, -0.008, 0.186, 0.118, 0.106),
         (1.000, 0.000, 0.172, 0.106, 0.098)]
    torso, I["torso"] = loft("torso", [(0, y, z) for z, y, *_ in T],
                             [prof(w, df, db, 10, 0.72) for z, y, w, df, db in T], fwd, REG["torso"], (True, False))
    neck, I["neck"] = loft("neck", [(0, -0.072, 1.462), (0, -0.090, 1.592)],
                           [prof(0.064, 0.060, 0.060, 6, 1.0), prof(0.058, 0.056, 0.058, 6, 1.0)],
                           fwd, REG["neck"], (False, False))
    # head: 12-sided, mirrored UVs, face planes pushed out of the front vertices
    hy = -0.045
    head, I["head"] = loft("head", [(0, y + hy, z) for z, y, *_ in HEADR],
                           [prof(w, df, db, 12, 0.9, p) for z, y, w, df, db, p in HEADR], fwd, REG["head"],
                           mirror=HEAD_FC / REG["head"][2], vs=[1 - r / REG["head"][3] for r in HEAD_ROWS])
    # garrison cap: a narrow boat on top of the head, tipped to the right
    CAP = [(-0.212, 1.748, 0.044, 0.072),     # front end
           (-0.184, 1.746, 0.094, 0.112),     # front peak
           (-0.100, 1.754, 0.097, 0.084),     # crown dip
           (-0.010, 1.750, 0.094, 0.106),     # back peak
           (0.020, 1.752, 0.044, 0.068)]      # back end

    def cap_prof(w, h):
        return [[0, 0], [-w, 0], [-w * 0.90, h * 0.50], [-w * 0.08, h], [w * 0.08, h], [w * 0.90, h * 0.50], [w, 0]]
    cap, I["cap"] = loft("cap", [(0.0, y, z) for y, z, w, hh in CAP], [cap_prof(w, hh) for y, z, w, hh in CAP],
                         up, REG["cap"], sharp=(1, 2, 3, 4, 5, 6))
    cap.data.transform(Matrix.Translation((0, -0.10, 1.76)) @ Matrix.Rotation(math.radians(-12), 4, "Y")
                       @ Matrix.Translation((0, 0.10, -1.76)))
    # pelvis / trouser seat with the belt
    PZ = [(1.045, 0.184, 0.116, 0.108), (0.930, 0.202, 0.122, 0.120), (0.815, 0.168, 0.106, 0.106)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, 0, z) for z, *_ in PZ],
                               [prof(w, df, db, 10, 0.75) for z, w, df, db in PZ], fwd, REG["pelvis"], (False, True))

    parts += [("head", [head, cap], (0, -0.095, 1.565)), ("torso", [torso, neck], (0, 0, 1.03)),
              ("pelvis", [pelvis], (0, 0, 0.93))]

    for sd, sx in (("L", 1), ("R", -1)):
        L = sd == "L"
        # arms reaching forward, wrists limp
        sh = V((sx * 0.190, -0.062, 1.400))
        d1 = V((sx * 0.16, -0.60 if L else -0.52, -0.78 if L else -0.84)).normalized()
        el = sh + d1 * 0.29
        d2 = V((-sx * 0.07, -0.98, -0.12 if L else -0.22)).normalized()
        wr = el + d2 * 0.265
        d3 = V((sx * 0.06, -0.40, -0.91)).normalized()
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh - d1 * 0.05, sh + d1 * 0.12, el + d1 * 0.015],
                                   [prof(0.074, 0.074, 0.074, 6, 1.0), prof(0.068, 0.068, 0.068, 6, 1.0),
                                    prof(0.058, 0.058, 0.058, 6, 1.0)], up, REG["uarm." + sd], (False, True))
        fa, I["farm." + sd] = loft("farm." + sd, [el - d2 * 0.035, el + d2 * 0.11, wr],
                                   [prof(0.050, 0.050, 0.050, 6, 1.0), prof(0.051, 0.046, 0.046, 6, 1.0),
                                    prof(0.036, 0.029, 0.029, 6, 1.0)], up, REG["farm." + sd], (False, False))
        # hand: a flat palm, two curled finger groups and a thumb
        fb = V((0, -1, 0)); fbo = (fb - d3 * fb.dot(d3)).normalized()        # back of the hand faces forward
        tside = (d3.cross(fbo)).normalized()
        if tside.x * sx > 0:                                                 # thumb toward the body midline
            tside = -tside
        palm, I["palm"] = loft("palm." + sd, [wr - d3 * 0.012, wr + d3 * 0.045, wr + d3 * 0.086],
                               [flatprof(0.029, 0.015), flatprof(0.043, 0.019), flatprof(0.043, 0.015)],
                               fb, REG["palm"], (False, True))
        fingers = []
        for g, (off, l1, l2, curl) in enumerate(((0.021, 0.042, 0.034, 0.9), (-0.021, 0.037, 0.030, 1.2))):
            k0 = wr + d3 * 0.080 + tside * off
            a1 = (d3 - fbo * 0.25).normalized(); a2 = (d3 - fbo * curl).normalized()
            k1 = k0 + a1 * l1; k2 = k1 + a2 * l2
            fg, I["fing" + "AB"[g]] = loft(f"fing{g}." + sd, [k0, k1, k2],
                                          [boxprof(0.0195, 0.0092), boxprof(0.0185, 0.0086), boxprof(0.0160, 0.0074)],
                                          [fbo, (fbo + a1 * 0.3).normalized(), (fbo + a2 * 0.6).normalized()],
                                          REG["fing" + "AB"[g]], (False, True))
            fingers.append(fg)
        tb = wr + d3 * 0.022 + tside * 0.034 - fbo * 0.004
        t1 = (d3 * 0.75 + tside * 0.25 - fbo * 0.6).normalized()
        t2 = (d3 * 0.8 - fbo * 0.6 - tside * 0.1).normalized()
        th, I["thumb"] = loft("thumb." + sd, [tb, tb + t1 * 0.030, tb + t1 * 0.030 + t2 * 0.026],
                              [boxprof(0.0110, 0.0095), boxprof(0.0100, 0.0088), boxprof(0.0085, 0.0074)],
                              fbo, REG["thumb"], (False, True))
        # legs: left foot a half step forward; hips lowered and trousers baggier than v1
        hip = V((sx * 0.100, 0.0, 0.920))
        kn = V((sx * 0.122, -0.032 if L else -0.004, 0.490))
        an = V((sx * 0.150, -0.045 if L else 0.055, 0.115))
        t1_ = (kn - hip).normalized()
        tg, I["thigh." + sd] = loft("thigh." + sd, [hip - t1_ * 0.03, hip.lerp(kn, 0.5), kn + t1_ * 0.012],
                                    [prof(0.112, 0.112, 0.118, 8, 0.9), prof(0.106, 0.108, 0.104, 8, 0.9),
                                     prof(0.084, 0.088, 0.080, 8, 0.9)], fwd, REG["thigh." + sd], (False, False))
        t2_ = (an - kn).normalized()
        sb = an - t2_ * 0.045
        sn, I["shin." + sd] = loft("shin." + sd, [kn - t2_ * 0.03, kn.lerp(sb, 0.45), kn.lerp(sb, 0.82), sb],
                                   [prof(0.082, 0.086, 0.082, 8, 0.9), prof(0.078, 0.076, 0.084, 8, 0.9),
                                    prof(0.098, 0.100, 0.100, 8, 0.9), prof(0.086, 0.088, 0.088, 8, 0.9)],
                                   fwd, REG["shin." + sd], (False, True))
        a = math.radians(10) * sx
        bf = V((math.sin(a), -math.cos(a), 0))
        Bt = [(0.215, 0.070, 0.076, 0.076, 0.9), (0.115, 0.076, 0.096, 0.082, 0.9),
              (0.062, 0.080, 0.178, 0.088, 0.72), (0.0, 0.086, 0.200, 0.096, 0.72)]
        bt, I["boot"] = loft("boot." + sd, [(an.x, an.y, z) for z, *_ in Bt],
                             [prof(w, df, db, 8, e) for z, w, df, db, e in Bt], bf, REG["boot"], (False, True))
        parts += [("upperarm." + sd, [ua], sh), ("forearm." + sd, [fa], el),
                  ("hand." + sd, [palm, *fingers, th], wr), ("thigh." + sd, [tg], hip),
                  ("shin." + sd, [sn, bt], kn)]
    return I, parts


def vertex_tint(ob, part):
    """Per-corner colour: darker lower legs, fingertips and under the chin; a cool
    lean in the dark. Multiplied into the texture at render time."""
    bpy.context.view_layer.update()
    me = ob.data
    mw = ob.matrix_world.copy()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    for p in me.polygons:
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            co = mw @ v.co
            nz = v.normal.z
            f = 0.80 + 0.20 * smooth01((co.z - 0.05) / 0.85)
            f *= 0.90 + 0.10 * (0.5 + 0.5 * nz)
            if part.startswith("hand"):
                f *= 0.92 + 0.08 * smooth01((co.z - 0.84) / 0.16)
            if part == "head" and co.z < 1.575 and nz < 0.3:
                f *= 0.80
            cols[li] = (f ** 1.08, f ** 1.04, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    return ca


# ---------------------------------------------------------------- baked light

def bake_light(objs):
    """Cycles bakes AO and smooth object-space normals from the model onto the page;
    the painted light comes from them: a symmetric top-front key, a sky term and a
    faint back rim, all occluded. Symmetric so the mirrored face stays consistent."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    kit.cycles_gpu()
    sc.cycles.samples = 256
    sc.cycles.use_denoising = False
    w = kit.world((1, 1, 1), 1.0)
    try:
        w.light_settings.distance = 0.12
    except Exception as e:
        print("ao distance:", e)
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
            bpy.ops.object.bake(type="AO", margin=4, use_clear=True)
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=4, use_clear=True)
        px = np.empty(AT * AT * 4, np.float32)
        img.pixels.foreach_get(px)
        res[kind] = px.reshape(AT, AT, 4)[::-1, :, :3].astype(np.float64)
    bpy.data.objects.remove(ground)
    nrm = res["NORMAL"] * 2 - 1
    nrm /= np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    ao = np.clip(res["AO"][..., 0], 0, 1)
    key = np.array([0.0, -0.80, 0.60]); key /= np.linalg.norm(key)
    rim = np.array([0.0, 0.7, 0.7]); rim /= np.linalg.norm(rim)
    dk = np.clip(nrm @ key, 0, 1); dr = np.clip(nrm @ rim, 0, 1)
    sky = 0.5 + 0.5 * nrm[..., 2]
    light = 1.08 * (ao ** 0.75 * (0.52 + 0.10 * sky) + 0.40 * dk * ao ** 0.4 + 0.12 * dr * ao ** 0.4)
    if DBG:
        os.makedirs(DBG, exist_ok=True)
        save_png(os.path.join(DBG, "bake_ao.png"), np.repeat(ao[..., None], 3, 2))
        save_png(os.path.join(DBG, "bake_normal.png"), res["NORMAL"])
        save_png(os.path.join(DBG, "bake_light.png"), np.repeat(np.clip(light / 1.3, 0, 1)[..., None], 3, 2))
    print("[ps1b] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
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
    r = Reg("head", ["skin", "livid2", "hair", "blood"], X, 1.8 - Z, None, qf / HEAD_FC, 0.0035, seed=11)
    zz = lambda z: 1.8 - z
    Qf = qf
    E = lambda x0_, z0, rx, rz: ell(X, Z, x0_, z0, rx, rz)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    # --- big planes: the front of the face faces the light, the sides turn away
    r.lit(soft(E(0.0, 1.64, 0.07, 0.08), 1.0) * (X < Qf), 1.06)
    r.lit(np.clip((X - 0.075) / 0.06, 0, 1) * (X < Qf + 0.01), 0.88)
    r.lit(soft(E(0.02, 1.728, 0.06, 0.02)), 1.1)                          # forehead
    r.lit(soft(E(0.030, 1.698, 0.046, 0.0065), 0.4), 1.26)                # brow ridge top plane
    # sunken sockets: darkest up under the brow, fading onto the cheek
    EX, EZ = 0.034, 1.668
    sock = E(EX, EZ + 0.002, 0.027, 0.0185) + 0.10 * r.nz
    r.lit(soft(sock, 0.4) * np.clip(0.6 + (Z - EZ) / 0.025, 0.45, 1), 0.32)
    r.lit((E(0.004, EZ + 0.004, 0.009, 0.012) < 1), 0.8)                  # inner corner by the bridge
    # milky eyes: a pale almond with a grey pupil, a raw lower lid, one catch light
    eye = E(EX + 0.001, EZ - 0.001, 0.0128, 0.0058) < 1
    r.put(eye, "skin"); r.lit(eye, 1.45)
    r.lit(eye & (Z > EZ + 0.001), 0.8)                                    # upper-lid shadow on the eyeball
    r.lit(E(EX + 0.001, EZ - 0.0012, 0.0045, 0.0042) < 1, 0.68)          # pupil
    lid = (E(EX + 0.002, EZ - 0.0066, 0.0125, 0.0026) < 1) & ~eye
    r.put(lid, "livid2"); r.lit(lid, 0.95)
    r.fix(EX - 0.0045, zz(EZ + 0.0010), "skin", 7)                        # catch light
    r.lit(E(EX + 0.004, EZ - 0.0145, 0.022, 0.0035) < 1, 0.66)            # eye bag crease
    # nose: lit bridge and tip, shadowed sides, dark underside and nostrils
    r.lit((X < 0.009) * np.clip((Z - 1.634) / 0.012, 0, 1) * (Z < 1.692), 1.2)
    r.lit((X > 0.009) & (X < 0.022) & (Z > 1.624) & (Z < 1.664), 0.7)
    r.lit(soft(E(0.0, 1.634, 0.013, 0.009)), 1.28)
    r.lit(E(0.0, 1.6205, 0.020, 0.0048) < 1, 0.48)
    nos = E(0.0092, 1.6232, 0.0045, 0.0028) < 1
    r.put(nos, "livid2"); r.lit(nos, 0.42)
    # cheekbones, hollow cheeks, smile lines dragged down
    r.lit(soft(E(0.062, 1.646, 0.030, 0.011)), 1.2)
    r.lit(soft(E(0.070, 1.610, 0.030, 0.017), 0.6), 0.68)
    r.line([(0.022, zz(1.627)), (0.036, zz(1.600))], 0.0026, f=0.68)
    r.line([(0.026, zz(1.627)), (0.040, zz(1.600))], 0.0022, f=1.12)
    for z in (1.712, 1.722):                                             # forehead wrinkles
        r.line([(0.006, zz(z)), (0.050, zz(z + 0.002))], 0.0018, f=0.8)
        r.line([(0.006, zz(z + 0.0036)), (0.050, zz(z + 0.0056))], 0.0016, f=1.12)
    # jaw line and the shadow under the chin
    r.line([(0.030, zz(1.568)), (Qf, zz(1.600))], 0.004, f=0.84)
    r.lit(np.clip((1.566 - Z) / 0.008, 0, 1), 0.62)
    r.lit(soft(E(0.0, 1.575, 0.020, 0.008)), 1.16)
    r.clusters(2.5, 0.45, f=0.93, where=(Z < 1.614) & (X > 0.03) & (X < Qf), seed=3)   # stubble
    # the mouth hanging open: thin livid lips, a dark maw, a few yellow teeth
    up_lip = E(0.0, 1.6075, 0.027, 0.0028) < 1
    r.put(up_lip, "livid2"); r.lit(up_lip, 1.0)
    lo_lip = E(0.0, 1.5845, 0.025, 0.0032) < 1
    r.put(lo_lip, "livid2"); r.lit(lo_lip, 1.2)
    maw = E(0.0, 1.5955, 0.024, 0.0098) < 1
    r.put(maw, "blood"); r.lit(maw, 0.22)
    teeth = (X < 0.019) & (Z > 1.6000) & (Z < 1.6052)
    r.put(teeth, "skin"); r.lit(teeth, 1.2)
    for k in range(1, 4):
        r.lit(teeth & (np.abs(X - 0.0058 * k + 0.0015) < 0.0011), 0.5)
    low = (X > 0.004) & (X < 0.016) & (Z > 1.5878) & (Z < 1.5912)
    r.put(low, "skin"); r.lit(low, 0.95)
    r.lit(low & (np.abs(X - 0.010) < 0.0011), 0.5)
    # ears (just behind the side vertex)
    ear = E(Qf + 0.012, 1.659, 0.017, 0.031) + 0.1 * r.nz
    r.lit(soft(ear, 0.3), 1.16)
    inner = E(Qf + 0.014, 1.656, 0.009, 0.019) < 1
    r.lit(inner, 0.62)
    r.lit((E(Qf + 0.031, 1.655, 0.007, 0.030) < 1), 0.72)
    # short back and sides: hair up under the cap, clipped stubble below it
    bx = np.clip((X - Qf) / qb, 0, 1)
    zh = np.where(X < Qf - 0.02, 1.744, 1.712 - 0.022 * bx)
    zh = np.where((X > Qf - 0.02) & (X < Qf - 0.006), 1.672, zh)       # sideburns
    hair = Z > zh + 0.003 * r.nz
    r.put(hair, "hair")
    r.lit(hair * np.clip((Z - zh) / 0.035, 0, 1), 1.3)
    r.clusters(4, 0.3, f=1.25, where=hair, seed=12)                    # combed clumps
    r.clusters(3.5, 0.4, f=0.75, where=hair, seed=13)
    zs = np.where(X < Qf - 0.02, 9.0, 1.625 + 0.012 * (1 - bx))        # stubble line
    stub = (Z > zs) & ~hair
    r.lit(stub * np.clip((Z - zs) / 0.03, 0.3, 1), 0.7)
    r.put(stub & (Z > zh - 0.008), "hair")                               # hair fading into the stubble
    # blood: run from the mouth corners and centre, over the chin and under the jaw
    chin = E(0.0, 1.576, 0.022, 0.012) + 0.35 * r.nz
    r.put((chin < 1) & ~lo_lip, "blood")
    r.lit((chin < 0.6), 0.8)
    for x_, z_, n_, w_ in ((0.0, 1.585, 0.042, 0.0026), (0.011, 1.584, 0.030, 0.0018), (0.024, 1.588, 0.026, 0.0018),
                           (0.030, 1.596, 0.020, 0.0016), (0.018, 1.582, 0.036, 0.0014)):
        r.drip(x_, zz(z_), n_, w=w_, mat="blood")
    r.put((E(0.027, 1.598, 0.005, 0.006) < 1), "blood")                    # mouth corners
    r.clusters(1.8, 0.5, f=1.4, where=(chin < 0.9), seed=5)                 # wet sheen
    for (px, pz) in ((0.052, 1.628), (0.044, 1.639)):
        r.blob(px, zz(pz), 0.0024, 0.0024, "blood", rough=0.0)
    r.clusters(3, 0.45, f=0.9, where=~hair & ~eye & ~teeth, seed=7)          # corpse mottling
    r.clusters(5, 0.6, f=0.86, where=(X > 0.06) & ~hair, seed=8)
    return r


def paint_cap(I):
    info = I["cap"]
    r = loft_reg("cap", info, ["cap", "metal", "bloodc2"], 101)
    X, Y, P = r.X, r.Y, r.P
    U = X / P + 0.5
    # profile arc stations (ring 1): bottom centre 0, corner, side mid, top crease...
    prof_u = [0.0, 0.14, 0.30, 0.47, 0.53, 0.70, 0.86, 1.0]
    under = (U < prof_u[1]) | (U > prof_u[6])
    r.lit(under, 0.36)
    for k, s_ in ((1, 1), (6, -1)):                   # piping on the rim
        r.lit(np.abs(U - prof_u[k]) < 0.018, 0.6)
    for k, s_ in ((2, -1), (5, 1)):                   # curtain edge: seam and turned-down lip
        r.lit(np.abs(U - prof_u[k]) < 0.016, 0.58)
        r.lit(np.abs(U - prof_u[k] - s_ * 0.03) < 0.016, 1.22)
    r.lit(np.abs(U - 0.5) < 0.02, 0.62)                # crown crease
    r.lit(np.abs(U - 0.47) < 0.02, 1.16)
    r.lit(np.clip(1 - Y / 0.03, 0, 1) + np.clip((Y - r.Y.max() + 0.03) / 0.03, 0, 1), 0.82)
    # plain enamel pin on the left curtain, near the front
    pin = (np.abs(U - 0.78) < 0.035) & (Y > 0.04) & (Y < 0.062)
    r.put(pin, "metal"); r.lit(pin & (Y > 0.052), 0.5)
    r.clusters(3, 0.45, f=0.84, where=~under, seed=2)
    r.clusters(3, 0.62, f=1.12, where=~under, seed=4)
    r.blob(0.05, 0.19, 0.012, 0.01, "bloodc2", 0.9)
    return r


def paint_neck(I):
    r = loft_reg("neck", I["neck"], ["skin", "livid", "blood"], 13)
    X, Y = r.X, r.Y
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.05)) / 0.05, 0, 1), 0.5)          # under the jaw
    r.lit(np.clip(1 - Y / 0.025, 0, 1), 0.7)                        # collar shadow
    for sg in (-1, 1):                                              # neck tendons
        r.line([(sg * 0.036, top - 0.01), (sg * 0.008, 0.012)], 0.004, f=1.18)
        r.line([(sg * 0.046, top - 0.01), (sg * 0.016, 0.012)], 0.003, f=0.8)
    r.lit(np.clip((1 - ell(X, Y, 0, 0.07, 0.009, 0.013)) / 0.5, 0, 1), 1.15)   # Adam's apple
    # bite wound on the left side
    r.blob(0.075, 0.07, 0.022, 0.018, "livid", 1.1, rough=0.3)
    r.blob(0.075, 0.07, 0.014, 0.012, "blood", 0.9, rough=0.3)
    r.blob(0.075, 0.07, 0.006, 0.006, "blood", 0.3, rough=0.2)
    r.drip(0.072, 0.075, 0.05, mat="blood"); r.drip(0.08, 0.075, 0.035, mat="blood")
    for x, n_ in ((0.0, 0.10), (-0.01, 0.07), (0.012, 0.09), (0.022, 0.05)):   # chin blood running down
        r.line([(x, top - n_), (x, top)], 0.0035, "blood")
        r.blob(x, top - n_, 0.004, 0.005, "blood", rough=0.0)
    return r


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["shirt", "khaki", "metal1", "skin3", "bloodc"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    # open collar: a V of skin, the collar points lying on the chest, their shadows
    vd = 0.112
    vw = 0.050 * np.clip(1 - Y / vd, 0, 1)
    vee = (ax < vw) & (Y < vd)
    r.put(vee, "skin3")
    r.lit(vee * np.clip(1 - Y / 0.06, 0, 1), 0.55)
    cw = vw + 0.042 * np.clip(1 - Y / 0.105, 0, 1)
    collar = (ax >= vw) & (ax < cw) & (Y < 0.105)
    r.lit(collar, 1.26)
    r.lit((ax >= cw) & (ax < cw + 1.4 * tx) & (Y < 0.105) & (Y > 0.01), 0.58)
    r.lit(vee & (ax > vw - 1.1 * tx), 0.62)
    r.lit((Y < 0.02) & ~vee, 1.15)                                  # collar band round the neck
    # placket and bone buttons
    pl = Y > vd
    r.lit(pl & (ax < 0.55 * tx), 0.66)
    r.lit(pl & (X > 0.6 * tx) & (X < 1.7 * tx), 1.15)
    for by in (0.155, 0.235, 0.315, 0.395):
        r.put(ell(X, Y, 0.3 * tx, by, 0.0085, 0.0075) < 1, "khaki")
        r.lit(ell(X, Y, 0.3 * tx, by + 0.011, 0.009, 0.0035) < 1, 0.6)
    # chest pockets with buttoned flaps
    for sg in (-1, 1):
        cx = sg * 0.098
        d = np.abs(X - cx)
        pk = (d < 0.036) & (Y > 0.13) & (Y < 0.228)
        r.lit(pk & ~((d < 0.036 - tx) & (Y > 0.13 + ty) & (Y < 0.228 - ty)), 0.66)
        r.lit(pk & (Y > 0.196), 0.9)
        r.lit((d < 0.038) & (Y > 0.127) & (Y < 0.157), 1.2)
        r.lit((d < 0.038) & (Y >= 0.157) & (Y < 0.157 + 1.3 * ty), 0.52)
        r.put(ell(X, Y, cx, 0.148, 0.007, 0.0065) < 1, "khaki")
    # armpit folds, sweat, and the shirt bloused over the belt
    for sg in (-1, 1):
        sx0 = sg * r.P / 4
        r.blob(sx0, 0.13, 0.035, 0.045, None, 0.88, rough=0.3)
        for (a0, a1) in (((-0.03, 0.11), (-0.09, 0.20)), ((0.0, 0.12), (-0.01, 0.25)), ((0.03, 0.11), (0.08, 0.21))):
            r.fold((sx0 + sg * a0[0], a0[1]), (sx0 + sg * a1[0], a1[1]), off=(sg * 1.3 * tx, 0))
    bl = np.clip((Y - 0.40) / 0.05, 0, 1) * np.clip((0.505 - Y) / 0.02, 0, 1)
    ph = 2 * np.pi * X / 0.058 + 1.3 * np.sin(X * 23.0)
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.2)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.74)
    r.lit(np.clip((Y - 0.475) / 0.02, 0, 1), 0.66)
    for (p0, p1) in (((-0.05, 0.30), (-0.02, 0.36)), ((0.05, 0.33), (0.03, 0.40)), ((0.18, 0.26), (0.13, 0.33))):
        r.fold(p0, p1)
    # suspenders: straight down the front ...
    for sg in (-1, 1):
        cx = sg * 0.082
        e_ = (X - cx) * sg
        st = (np.abs(X - cx) < 0.0165)
        r.put(st, "khaki")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.62)
        r.lit(st & (e_ < -0.0165 + 1.1 * tx), 1.2)
        r.lit((e_ >= 0.0165) & (e_ < 0.0165 + 1.4 * tx) & (Y > 0.03), 0.66)
        bk = (np.abs(X - cx) < 0.021) & (np.abs(Y - 0.272) < 0.013)
        r.put(bk, "metal1")
        r.put((np.abs(X - cx) < 0.012) & (np.abs(Y - 0.272) < 0.006), "khaki")
        r.lit((np.abs(X - cx) < 0.012) & (np.abs(Y - 0.272) < 0.006), 0.55)
        r.lit((np.abs(X - cx) < 0.022) & (Y > 0.285) & (Y < 0.285 + 1.3 * ty), 0.5)
    # ... and crossed in an X on the back, with a leather-look patch at the cross
    for sg in (-1, 1):
        bc = sg * 0.085 * (1 - Y / 0.27)
        e_ = (B - bc) * sg
        st = np.abs(B - bc) < 0.0165
        r.put(st, "khaki")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.64)
        r.lit((e_ >= 0.0165) & (e_ < 0.0165 + 1.4 * tx), 0.68)
    patch = ell(B, Y, 0, 0.27, 0.024, 0.019) < 1
    r.put(patch, "khaki"); r.lit(patch, 0.7)
    r.lit(patch & (ell(B, Y, 0, 0.27, 0.024, 0.019) > 0.75), 0.75)
    # blood from the chin down the placket, a soaked belly stain, spatters
    r.blob(0.0, 0.10, 0.030, 0.028, "bloodc", 0.9, rough=0.4)
    for x_, y_, n_ in ((-0.022, 0.1, 0.10), (-0.009, 0.1, 0.20), (0.004, 0.1, 0.26), (0.017, 0.1, 0.16),
                       (0.03, 0.09, 0.08), (-0.034, 0.08, 0.06)):
        r.drip(x_, y_, n_, w=0.6 * tx, mat="bloodc")
    r.splat(0.135, 0.34, 0.036, drips=3)
    r.splat(-0.16, 0.42, 0.018, drips=1)
    r.splat(0.21, 0.19, 0.012, drips=1)
    r.blob(r.P / 2 - 0.12, 0.36, 0.03, 0.025, "bloodc", 0.9, rough=0.5)
    # a rip showing grey skin on the right side
    rip = ell(X, Y, -0.19, 0.33, 0.016, 0.022) + 0.3 * r.nz
    r.lit(rip < 1.35, 0.55)
    r.put(rip < 1, "skin3")
    r.put(ell(X, Y, -0.19, 0.335, 0.006, 0.008) < 1, "bloodc")
    # grime and dust clusters
    r.clusters(4, 0.55, f=0.9, seed=1)
    r.clusters(4, 0.62, f=1.08, where=Y < 0.25, seed=2)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["trousers", "leather", "metal", "bloodc2"], 31)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    ax = np.abs(X)
    belt = Y < 0.044
    r.put(belt, "leather")
    r.lit(belt & (Y < 1.1 * ty), 1.28)
    r.lit(belt & (Y > 0.044 - 1.1 * ty), 0.6)
    r.lit((Y >= 0.044) & (Y < 0.044 + 1.3 * ty), 0.55)             # belt shadow on the trousers
    for x_ in (0.075, -0.075, 0.2, -0.2, r.P / 2, r.P / 2 - 0.13, r.P / 2 + 0.13):
        lp = (np.abs(r.dx(x_)) < 0.0075) & (Y < 0.052)
        r.put(lp, "trousers"); r.lit(lp, 1.12)
        r.lit((np.abs(r.dx(x_)) >= 0.0075) & (np.abs(r.dx(x_)) < 0.0075 + tx) & (Y < 0.05), 0.6)
    bk = (ax < 0.027) & (Y > 0.003) & (Y < 0.041)
    r.put(bk, "metal")
    inner = (ax < 0.017) & (Y > 0.011) & (Y < 0.033)
    r.put(inner, "leather"); r.lit(inner, 0.55)
    r.put((ax < 0.6 * tx) & (Y > 0.011) & (Y < 0.033), "metal")
    # fly, hip pockets, crotch folds, back pockets
    r.fold((0.004, 0.05), (0.006, 0.175), off=(1.2 * tx, 0))
    r.line([(0.006, 0.175), (-0.012, 0.19)], 0.6 * tx, f=0.7)
    for sg in (-1, 1):
        r.fold((sg * 0.10, 0.05), (sg * 0.155, 0.125), off=(-sg * 1.2 * tx, 0))
        r.fold((sg * 0.015, 0.215), (sg * 0.065, 0.14), dark=0.72)
        r.fold((sg * 0.03, 0.225), (sg * 0.10, 0.165), dark=0.76)
        cx = r.P / 2 + sg * 0.075
        d = np.abs(r.dx(cx))
        pk = (d < 0.034) & (Y > 0.07) & (Y < 0.165)
        r.lit(pk & ~((d < 0.034 - tx) & (Y > 0.07 + ty) & (Y < 0.165 - ty)), 0.66)
        r.lit((d < 0.035) & (Y > 0.068) & (Y < 0.095), 1.15)
        r.lit((d < 0.035) & (Y >= 0.095) & (Y < 0.095 + 1.2 * ty), 0.55)
    r.lit(np.clip((Y - 0.17) / 0.06, 0, 1), 0.82)
    r.clusters(4, 0.55, f=0.9, where=~belt, seed=3)
    r.splat(0.10, 0.10, 0.02, "bloodc2", drips=2)
    r.blob(r.P / 2 - 0.1, 0.12, 0.016, 0.014, "bloodc2", 0.9)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["trousers", "bloodc", "mud", "skin3"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    outer = P / 4 if L else -P / 4
    inner = -outer
    so = 1 if L else -1
    r.fold((outer, 0.0), (outer + so * 0.004, 0.47), off=(-so * 1.2 * tx, 0))          # outer seam
    r.fold((inner, 0.0), (inner, 0.47), dark=0.8, off=(so * 1.2 * tx, 0))
    for k, (y0_, y1_, dx0, dx1) in enumerate(((0.03, 0.22, -0.02, 0.06), (0.10, 0.30, -0.05, 0.03),
                                               (0.20, 0.37, -0.04, 0.05), (0.05, 0.16, 0.09, 0.14))):
        r.fold((inner * 0.5 + so * dx0, y0_), (so * dx1, y1_), off=(so * 1.2 * tx, -0.5 * ty))
    for yk in (0.395, 0.42, 0.445):                                  # knee creases, back and front
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    r.fold((-0.03, 0.43), (0.035, 0.425), dark=0.8, off=(0, -1.2 * ty))
    r.clusters(3, 0.3, f=1.12, where=(np.abs(X) < 0.07) & (Y > 0.37), seed=8)  # dusty knee
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    if L:
        r.splat(0.03, 0.18, 0.032, drips=2)
        r.splat(-0.06, 0.31, 0.02, drips=1)
        tear = ell(X, Y, 0.0, 0.445, 0.034, 0.024) + 0.3 * r.nz
        r.lit(tear < 1.3, 0.5)
        r.put(tear < 1, "skin3")
        r.blob(0.004, 0.45, 0.012, 0.009, "bloodc", 0.9)
    else:
        r.splat(-0.02, 0.29, 0.03, drips=2)
        cx = outer
        d = np.abs(X - cx)
        pk = (d < 0.048) & (Y > 0.11) & (Y < 0.26)
        r.lit(pk & ~((d < 0.048 - tx) & (Y > 0.11 + ty) & (Y < 0.26 - ty)), 0.62)
        r.lit((d < 0.05) & (Y > 0.108) & (Y < 0.145), 1.18)
        r.lit((d < 0.05) & (Y >= 0.145) & (Y < 0.145 + 1.3 * ty), 0.52)
        r.lit(pk & (Y > 0.22), 0.88)
    r.lit(np.clip(Y / 0.47, 0, 1), 0.92)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    r = loft_reg("shin." + sd, I["shin." + sd], ["trousers", "bloodc", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.full(X.shape, 1.0), 0.9)
    b0 = Lt * 0.55
    bl = np.clip((Y - b0) / (Lt - b0), 0, 1)
    ph = 2 * np.pi * X / 0.05 + 1.1 * np.sin(X * 31.0 + (3 if L else 1))
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.0 + 0.3 * 1)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.68)
    r.lit((Y > Lt - 0.03) & (Y < Lt - 0.015), 1.15)
    r.lit(Y >= Lt - 0.015, 0.55)
    for (p0, p1) in (((-0.02, 0.02), (0.01, 0.12)), ((0.04, 0.05), (0.02, 0.15)), ((P / 2 - 0.02, 0.0), (P / 2, 0.1))):
        r.fold(p0, p1)
    r.clusters(5, 0.45, mat="mud", where=np.clip((Y - Lt * 0.6) / (Lt * 0.4), 0, 1) > 0.5, seed=11 if L else 12)
    r.clusters(4, 0.55, f=0.9, seed=13)
    if L:
        r.splat(0.02, 0.10, 0.026, drips=2)
    else:
        r.blob(-0.03, 0.18, 0.012, 0.01, "bloodc", 0.9)
    return r


def paint_boot(I):
    r = loft_reg("boot", I["boot"], ["leather", "mud", "metal", "bloodc2", "khaki"], 61)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.ones(X.shape), 0.86)
    ax = np.abs(X)
    Lt = Y.max()
    z = 0.215 - Y
    for k in range(-3, 4):                                        # shaft creases
        r.fold((k * 0.045 + 0.01, 0.0), (k * 0.045 + 0.016, 0.07), off=(1.2 * tx, 0))
    r.lit((z < 0.215) & (z > 0.2), 0.7)
    lace = (ax < 0.017) & (z > 0.07)
    r.lit(lace, 0.8)
    for zk in np.arange(0.2, 0.07, -0.022):
        r.line([(-0.013, 0.215 - zk), (0.013, 0.215 - zk + 0.012)], 0.55 * tx, "khaki")
        r.put(ell(X, Y, -0.015, 0.215 - zk, 0.004, 0.004) < 1, "metal")
        r.put(ell(X, Y, 0.015, 0.215 - zk, 0.004, 0.004) < 1, "metal")
    r.fold((-0.06, 0.215 - 0.095), (0.06, 0.215 - 0.1), off=(0, -1.2 * ty))
    toe = (ax < 0.07) & (z < 0.062)
    r.lit(toe * np.clip((z - 0.02) / 0.04, 0, 1), 1.3)
    r.lit((ax < 0.075) & (np.abs(z - 0.064) < 0.004), 0.6)
    r.lit((np.abs(r.B) < 0.05) & (z < 0.085) & (z > 0.02), 0.85)
    r.lit((np.abs(r.B) < 0.05) & (np.abs(z - 0.085) < 0.004), 0.6)
    welt = (z < 0.02) & (z > 0.011)
    r.lit(welt, 1.25)
    sole = z <= 0.011
    r.lit(sole, 0.38)
    r.clusters(4, 0.3, mat="mud", where=z < 0.07, seed=14)
    r.clusters(2, 0.55, f=1.2, where=toe, seed=15)
    r.blob(0.05, 0.215 - 0.05, 0.012, 0.01, "bloodc2")
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    r = loft_reg("uarm." + sd, I["uarm." + sd], ["shirt", "bloodc"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.abs(Y - 0.052) < 0.6 * ty, 0.7)                      # shoulder seam
    r.lit(np.abs(Y - 0.052 + 1.2 * ty) < 0.6 * ty, 1.15)
    for k in range(3):                                           # inner elbow creases
        r.fold((P / 2 - 0.05 + k * 0.03, Lt - 0.10), (P / 2 - 0.035 + k * 0.03, Lt - 0.05))
    r.fold((-0.03, 0.10), (0.02, 0.15))
    cuff = Y > Lt - 0.065
    r.lit(cuff, 1.12)
    for yk, f_ in ((Lt - 0.065, 0.6), (Lt - 0.035, 0.7), (Lt - 0.006, 0.6)):
        r.lit(np.abs(Y - yk) < 0.6 * ty, f_)
    r.lit(np.abs(Y - (Lt - 0.05)) < 0.6 * ty, 1.15)
    r.clusters(4, 0.55, f=0.9, seed=16 if L else 17)
    if L:
        r.blob(0.02, 0.14, 0.012, 0.01, "bloodc")
    else:
        r.splat(0.0, 0.16, 0.024, drips=2)
    return r


def paint_farm(I, sd):
    L = sd == "L"
    r = loft_reg("farm." + sd, I["farm." + sd], ["skin", "livid", "blood", "shirt2"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.clip(1 - Y / 0.06, 0, 1), 0.62)                      # cuff shadow
    r.lit(np.abs(r.B) < 0.05, 0.86)                                # underside
    for x0_ in (0.03, -0.02):                                      # veins
        pts = [(r.P / 2 + x0_ + 0.01 * math.sin(k), 0.05 + k * 0.04) for k in range(6)]
        r.line(pts, 0.55 * tx, "livid")
    r.blob(-0.03, 0.1, 0.018, 0.015, "livid", 1.2, rough=0.4)       # bruise
    r.lit(np.clip((Y - 0.2) / 0.08, 0, 1), 0.88)
    if L:
        for k in range(3):                                         # claw scratches
            r.line([(-0.02 + k * 0.012, 0.09 + k * 0.01), (0.012 + k * 0.012, 0.16 + k * 0.01)], 0.6 * tx, "blood", 0.8)
        r.splat(0.01, 0.23, 0.014, "blood", drips=1)
    else:
        r.splat(0.0, 0.08, 0.022, "blood", drips=3)
        r.blob(0.03, 0.2, 0.01, 0.008, "blood", 0.9)
    return r


def paint_palm(I):
    r = loft_reg("palm", I["palm"], ["skin", "livid", "blood", "dirt"], 91)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.ones(X.shape), 0.86)
    r.clusters(3, 0.45, f=0.88, seed=4)
    Lt = Y.max()
    r.lit(np.abs(r.B) < 0.03, 0.78)                                # palm side
    for x0_ in (-0.018, -0.006, 0.006, 0.018):                     # tendons
        r.line([(x0_ * 0.6, 0.015), (x0_, Lt - 0.012)], 0.5 * tx, f=1.15)
        r.line([(x0_ * 0.6 + 0.006, 0.02), (x0_ + 0.006, Lt - 0.014)], 0.5 * tx, f=0.86)
    for x0_ in (-0.02, -0.007, 0.007, 0.02):                        # knuckles
        r.blob(x0_, Lt - 0.006, 0.0055, 0.005, None, 1.28, rough=0)
    r.line([(-0.025, 0.03), (0.02, 0.06)], 0.6 * tx, "livid")
    r.blob(0.004, 0.045, 0.012, 0.012, "blood", 0.9)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.7)
    return r


def paint_finger(I, which):
    r = loft_reg("fing" + which, I["fing" + which], ["skin", "livid", "blood", "dirt"], 92 if which == "A" else 94)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    Lt = Y.max()
    back = (U > 0.25) & (U < 0.5)
    r.lit(np.ones(X.shape), 0.88)
    r.lit(np.abs(U - 0.375) < 0.03, 0.5)                          # split between the two fingers
    r.lit(np.abs(U - 0.875) < 0.04, 0.55)
    r.lit((U > 0.75), 0.8)                                         # palm side
    mid = Lt * 0.52
    r.lit(back & (np.abs(Y - mid) < 0.004), 0.7)                   # knuckle crease
    r.lit(back & (np.abs(Y - mid + 0.005) < 0.003), 1.2)
    nail = back & (Y > Lt - 0.015) & (np.abs(U - 0.375) > 0.03) & (np.abs(U - 0.375) < 0.10)
    r.put(nail, "dirt"); r.lit(nail & (Y < Lt - 0.01), 1.2)
    r.blob(r.P * (0.44 - 0.5), Lt - 0.004, 0.006, 0.006, "blood", 0.9)
    return r


def paint_thumb(I):
    r = loft_reg("thumb", I["thumb"], ["skin", "livid", "blood", "dirt"], 95)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    Lt = Y.max()
    back = (U > 0.25) & (U < 0.5)
    r.lit(U > 0.75, 0.8)
    r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.7)
    nail = back & (Y > Lt - 0.014)
    r.put(nail, "dirt"); r.lit(nail & (Y < Lt - 0.009), 1.2)
    return r


def paint_floor():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("floor", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 111)
    r.lit(np.full((h, w), 1.0), 1.0)
    r.clusters(10, 0.4, f=0.92, seed=21)
    r.clusters(7, 0.6, f=1.06, seed=22)
    r.clusters(3, 0.66, f=0.93, seed=23)
    r.lit((Xg < 1.2 / w) | (Yg < 1.2 / h), 0.75)                 # expansion joints
    return r.finish(np.ones((h, w)))


def paint_wall():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wall", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 121)
    for yk in (0.0, 0.5):                                         # poured-concrete form lines
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


def save_png(path, arr, k=1):
    arr = np.clip(arr, 0, 1)
    if k > 1:
        arr = np.kron(arr, np.ones((k, k, 1)))
    hh, ww = arr.shape[:2]
    img = bpy.data.images.new("tmp_png", ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = arr[::-1]
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.abspath(path); img.file_format = "PNG"; img.save()
    bpy.data.images.remove(img)


def make_image(name, arr, fname=None):
    hh, ww = arr.shape[:2]
    img = bpy.data.images.new(name, ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = arr[::-1]
    img.pixels.foreach_set(px.ravel())
    if fname:
        os.makedirs(OUT, exist_ok=True)
        img.filepath_raw = os.path.join(OUT, fname)
        img.file_format = "PNG"
        img.save()
    try:
        img.pack()
    except Exception as e:
        print("pack failed:", e)
    return img


def paint_page(I, light):
    regs = [paint_head(I), paint_cap(I), paint_neck(I), paint_torso(I), paint_pelvis(I), paint_boot(I),
            paint_palm(I), paint_finger(I, "A"), paint_finger(I, "B"), paint_thumb(I)]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd), paint_farm(I, sd)]
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 18))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = light[y0:y0 + h, x0:x0 + w]
        lt = blur2(lt, 0.8, 0.8, wrap=r.P is not None)
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
    return page


# ---------------------------------------------------------------- materials

def fog_group():
    """Screen-space murky fog colour (backdrop and fog share it)."""
    ng = bpy.data.node_groups.get("PS1B_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("PS1B_Fog", "ShaderNodeTree")
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0):
    """Texture (nearest) x vertex colour, lit by a sun (Gouraud-smooth normals) plus
    flat ambient, mixed to the fog colour by camera distance. mapping = 'floor' / 'wall'
    projects the texture by world position (tiles of `tex_scale` metres)."""
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
        if mapping == "floor":           # a soft stepped contact shadow round the feet
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

HEAD_ROT = (13, -7, 0)


def build():
    root = kit.empty("ZOMBIE_ps1b")
    I, parts = build_geometry()
    objs = []
    for name, pieces, pivot in parts:
        ob = rig_part(name, pieces, pivot, root)
        objs.append(ob)
    bpy.context.view_layer.update()
    for ob in objs:
        vertex_tint(ob, ob.name)
    light = bake_light(objs)
    page = paint_page(I, light)
    img = make_image("ps1b_page", page, "texture_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    mat = ps1_mat("PS1B_Ghoul", img)
    for ob in objs:
        kit.assign(ob, mat)
        if ob.name == "head":
            ob.rotation_euler = [math.radians(a) for a in HEAD_ROT]
    return root


# ---------------------------------------------------------------- stage, snapping, post

SNAP = []


def snap_vertices():
    """Snap every vertex to the render's pixel grid in screen space (integer vertex
    coordinates, the source of the 32-bit wobble), keeping depth."""
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
    bpy.context.scene.render.resolution_percentage = 100      # previews too: native is already small
    snap_vertices()
    return _render_to(path)


kit.render_to = render_native      # run() looks render_to up in kit at call time


def fog_card(cam, size=24.0):
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0))]
    bm.faces.new(vv)
    card = kit.mesh_obj("FogCard", bm, None, smooth=False)
    card.parent = cam; card.location = (0, 0, -45)
    cm = bpy.data.materials.new("PS1B_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("PS1B_Env") else (dist - near_c, dist + far_c)
            fr.inputs["From Min"].default_value = near
            fr.inputs["From Max"].default_value = far


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
    fimg = make_image("ps1b_floor", paint_floor(), "floor_tile.png")
    kit.assign(floor, ps1_mat("PS1B_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
    set_fog(cam.location.length)
    SNAP.clear()
    for ob in kit.descendants(root):
        if ob.type == "MESH":
            rest = np.empty(len(ob.data.vertices) * 3, np.float32)
            ob.data.vertices.foreach_get("co", rest)
            SNAP.append((ob, rest.reshape(-1, 3).astype(np.float64)))


# the PS1 GPU's 4x4 dither offsets (in 8-bit units), added before truncating to 5 bits
PS1_DITHER = np.array([[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]], float)


def crt(a, k=UP):
    """Native frame -> 1997 TV: 15-bit dithered framebuffer, composite video (luma
    softened horizontally, chroma bleeding wider and a touch late), a CRT beam
    (faint scanlines that bright pixels bloom over) and a little glow."""
    H, W = a.shape[:2]
    rgb = a[..., :3].astype(np.float64)
    d = PS1_DITHER[(np.arange(H) % 4)[:, None], (np.arange(W) % 4)[None, :]][..., None]
    rgb = np.floor(np.clip(rgb * 255 + d, 0, 255) / 8) / 31
    # glow from highlights, at native scale
    bright = np.clip(rgb - 0.55, 0, None)
    glow = 0.30 * blur2(bright, 1.6) + 0.22 * blur2(bright, 5.0)
    Y = rgb @ np.array([0.299, 0.587, 0.114])
    I_ = rgb @ np.array([0.596, -0.274, -0.322])
    Q_ = rgb @ np.array([0.211, -0.523, 0.312])
    up = lambda x: np.repeat(np.repeat(x, k, 0), k, 1)
    Yu = gblur(gblur(up(Y), 0.50 * k, 1), 0.28 * k, 0)
    Yu = Yu + 0.22 * (Yu - gblur(Yu, 1.3 * k, 1))                  # a TV's sharpness knob
    Iu = gblur(gblur(up(I_), 1.25 * k, 1), 0.45 * k, 0)
    Qu = gblur(gblur(up(Q_), 1.25 * k, 1), 0.45 * k, 0)
    sh = max(1, int(round(0.35 * k)))
    Iu = np.roll(Iu, sh, 1); Qu = np.roll(Qu, sh, 1)
    out = np.stack([Yu + 0.956 * Iu + 0.621 * Qu, Yu - 0.272 * Iu - 0.647 * Qu, Yu - 1.106 * Iu + 1.703 * Qu], -1)
    out += gblur(gblur(up(glow), 0.6 * k, 1), 0.6 * k, 0)
    # scanlines: a dark gap between beam lines (<= 12%), filled in by bright pixels
    j = (np.arange(H * k) % k + 0.5) / k                           # 0..1 within a line
    gap = (np.abs(j - 0.5) * 2) ** 2                                # 0 at the beam centre, 1 at the gap
    lum = np.clip(out @ np.array([0.299, 0.587, 0.114]), 0, 1)
    out *= (1 - 0.12 * gap[:, None] * (1 - 0.7 * lum))[..., None]
    # faint vignette
    yy, xx = np.meshgrid(np.linspace(-1, 1, H * k), np.linspace(-1, 1, W * k), indexing="ij")
    out *= (1 - 0.07 * (xx ** 2 + yy ** 2))[..., None]
    res = np.ones((H * k, W * k, 4))
    res[..., :3] = np.clip(out, 0, 1)
    return res


def post(path):
    if DBG:
        import shutil
        os.makedirs(DBG, exist_ok=True)
        shutil.copy(path, os.path.join(DBG, "n_" + os.path.splitext(os.path.basename(path))[0].replace("preview_", "")[:10] + ".png"))
    kit.numpy_post(path, crt)


# ---------------------------------------------------------------- the in-game still

def ingame(root):
    """The ghoul at in-game distance: 320x240, ~105 px tall, dark bunker fog."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    root.rotation_euler.z = math.radians(-16)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.55, -3.85, 1.62)
    kit._aim(cam, (0.1, 0, 1.0))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = fog_group()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = lin((5, 8, 7)); mix.inputs[7].default_value = lin((26, 36, 30))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    # back wall of the bunker and a boarded-up window
    wimg = make_image("ps1b_wall", paint_wall())
    wmat = ps1_mat("PS1B_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("PS1B_EnvHole", make_image("ps1b_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("ps1b_wood", paint_wood())
    wm = ps1_mat("PS1B_EnvWoodM", wood, None, vcol=False)
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
    # the round tally, in red chalk
    chalk = ps1_mat("PS1B_EnvChalk", make_image("ps1b_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                        [C((126, 38, 32)), C((160, 52, 42))]])), None, vcol=False)
    strokes = [((0.70 + 0.11 * k, 1.42), (0.72 + 0.11 * k, 1.90)) for k in range(4)] + [((0.62, 1.50), (1.14, 1.80))]
    for k, ((xa, za), (xb, zb)) in enumerate(strokes):
        d = V((xb - xa, 0, zb - za)); nrm = V((-d.z, 0, d.x)).normalized() * 0.022
        bm = bmesh.new()
        vv = [bm.verts.new((p_.x, 2.585, p_.z)) for p_ in (V((xa, 0, za)) - nrm, V((xb, 0, zb)) - nrm,
                                                          V((xb, 0, zb)) + nrm, V((xa, 0, za)) + nrm)]
        bm.faces.new(vv)
        st = kit.mesh_obj(f"Chalk{k}", bm, None, smooth=False)
        kit.assign(st, chalk)
    set_fog((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=10.0, near_f=2.0, far_f=5.0)
    for m in bpy.data.materials:
        a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
        if a:
            k_ = 0.55 if m.name.startswith("PS1B_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[ps1b] ingame ->", p)


kit.run(STYLE, build, stage, post,
        meta={"technique": "rigid lofted segments, Gouraud + vertex colours; 256px page, 16-colour CLUT per part, "
                           "painted light x Cycles-baked AO/normal light; native 300x400 + composite/CRT post",
              "texture_page": "256x256", "segments": 13})

if "--final" in ARGS or "--ingame" in ARGS:
    ingame(bpy.data.objects["ZOMBIE_ps1b"])
