# Hellhound (hound): the Polygon Ghoul's dog, built for the same 1997 disc
# (art/STYLE.md). A gaunt, charred wolf-dog in rigid faceted segments on the
# game's hound rig (src/client/render/hounds.js): wedge chest with faceted rib
# planes, a knife-edge spine with raked spikes, a long wedge snout over a
# separate lower jaw, swept-back ears, angular hocks and a thin segmented tail.
#
# Model: ~850 triangles, 11 parts on 19 joints. Parts are authored directly in
# three.js joint space (+Y up, facing +Z, left = +X) under an empty that turns
# three.js space into Blender space, so export is a straight copy. Leg parts are
# symmetric about their own X = 0 plane with mirrored UVs, so one part serves
# both the left and right joints (meta.shared).
# Texture: one 256x256 page, <= 16 colours per part: painted light x Cycles-baked
# AO / facet light (top-front key), hue-shifted ramps from the Ghoul's world table
# plus charred hide, scorched bone and ember. Ember cracks and eyes are also
# written to a glow page on the same UVs (hound_glow.png).
# Presentation: native 400x300 (a quadruped is wide), nearest texels, vertex snap,
# then the Ghoul's composite TV pass.
#
#   node art/zombies/blend.mjs z_hound.py --preview [--views front,side] [--ingame]
#   node art/zombies/blend.mjs z_hound.py --final   (heroes, turntable, ingame.png)
# Every run also exports public/models/hound.json + hound.png + hound_glow.png.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix

STYLE = "hound"
OUT = os.path.join(kit.OUT_BASE, STYLE)
MODELS = os.path.join(kit.ROOT, "public", "models")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (400, 300)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP = math.radians(30)                    # split normals on edges sharper than this
GLOW_STRENGTH = 2.4
TAU = 2 * math.pi

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# The Ghoul's world table (z_ps1b.RAMPS) extended with the hound's materials: same
# value range and hue shift (cool violet shadows, warm highlights). Second value =
# the "lit base" entry. Only the embers are allowed past blood/chalk saturation.
RAMPS = {
    "blood": ([(38, 4, 8), (92, 14, 16), (140, 30, 24)], 1),
    "bloodc": ([(36, 12, 12), (66, 20, 18), (96, 30, 24)], 1),
    "concrete": ([(26, 30, 28), (36, 40, 37), (46, 50, 45), (58, 62, 55), (72, 75, 66)], 3),
    "wood": ([(30, 22, 18), (46, 34, 26), (64, 48, 34), (86, 66, 46)], 2),
    "chalk": ([(120, 30, 26), (170, 52, 40)], 1),
    # charred hide: near-black violet shadows up to a warm burnt umber
    "hide": ([(16, 15, 21), (24, 21, 28), (34, 29, 35), (46, 38, 42), (60, 48, 48), (76, 60, 54),
              (96, 74, 60), (118, 90, 68)], 5),
    "hide6": ([(16, 15, 21), (28, 25, 31), (44, 37, 41), (60, 48, 48), (78, 62, 55), (104, 80, 64)], 4),
    "ash2": ([(72, 70, 74), (108, 102, 98)], 1),
    # scorched bone (spikes, ribs, teeth): cool grey-brown shadow to a dull ivory
    "bone": ([(34, 30, 34), (54, 48, 48), (80, 71, 64), (110, 99, 82), (142, 129, 104), (172, 158, 126)], 3),
    "bone3": ([(60, 54, 52), (104, 94, 78), (150, 137, 108)], 1),
    "claw": ([(12, 11, 15), (26, 23, 28), (46, 41, 42)], 1),
    "maw": ([(26, 6, 10), (58, 12, 14), (96, 22, 18)], 1),
    # embers: set by glow level, not by light
    "ember3": ([(118, 26, 10), (196, 70, 18), (246, 150, 60)], 1),
    "ember": ([(90, 18, 8), (150, 40, 12), (210, 90, 24), (246, 150, 60), (255, 210, 130)], 2),
}
# glow page levels (index = round(glow * 5)); black = no glow
GLOW_C = np.array([(0, 0, 0), (70, 12, 2), (140, 36, 6), (210, 84, 18), (255, 150, 52), (255, 214, 140)], float) / 255.0


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMP_C = {k: np.array(v[0], float) / 255.0 for k, v in RAMPS.items()}
RAMP_LL = {k: np.log(np.array([_luma(c) for c in v[0]]) / _luma(v[0][v[1]])) for k, v in RAMPS.items()}

# texture page layout: name -> (x0, y0, w, h), top-left origin
REG = {
    "head": (0, 0, 64, 128), "torso": (64, 0, 128, 80), "jaw": (192, 0, 32, 80), "neck": (224, 0, 32, 64),
    "ear": (224, 64, 16, 16), "bone": (240, 64, 16, 16),
    "hind": (64, 80, 128, 64), "thigh": (192, 80, 32, 64), "shin": (224, 80, 16, 64), "foot": (240, 80, 16, 48),
    "paw": (0, 128, 32, 16), "foreUpper": (64, 144, 32, 64), "foreLower": (96, 144, 16, 64), "tail": (112, 144, 16, 64),
}

# ---------------------------------------------------------------- the rig (three.js space)
# name, parent, position relative to the parent in the zero pose (metres, +Y up, facing +Z)
JOINTS = [
    ("body", None, (0, 0, 0)),
    ("spine", "body", (0, 0.64, -0.04)),
    ("fore", "spine", (0, 0.02, 0.2)),
    ("hind", "spine", (0, 0, -0.2)),
    ("neck", "fore", (0, 0.05, 0.17)),
    ("head", "neck", (0, 0, 0.22)),
    ("jaw", "head", (0, -0.034, 0.0)),
    ("shL", "fore", (0.095, -0.05, 0.07)), ("shR", "fore", (-0.095, -0.05, 0.07)),
    ("elL", "shL", (0, -0.3, 0)), ("elR", "shR", (0, -0.3, 0)),
    ("hipL", "hind", (0.09, -0.02, -0.13)), ("hipR", "hind", (-0.09, -0.02, -0.13)),
    ("stL", "hipL", (0, -0.26, 0)), ("stR", "hipR", (0, -0.26, 0)),
    ("hkL", "stL", (0, -0.24, 0)), ("hkR", "stR", (0, -0.24, 0)),
    ("tail", "hind", (0, 0.035, -0.24)),
]
# part -> joints it is drawn at (legs: one symmetric part at both sides)
PARTS = [("torso", ["fore"]), ("hind", ["hind"]), ("neck", ["neck"]), ("head", ["head"]), ("jaw", ["jaw"]),
         ("foreUpper", ["shL", "shR"]), ("foreLower", ["elL", "elR"]), ("hindThigh", ["hipL", "hipR"]),
         ("hindShin", ["stL", "stR"]), ("hindFoot", ["hkL", "hkR"]), ("tail", ["tail"])]


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


# ---------------------------------------------------------------- numpy helpers (from ps1b)

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
    """One page region painted as material ids + painted light, in metres, plus a glow
    layer. X runs round the part (full wrap: 0 = top/front centre, + = the part's left,
    wraps with period P; mirrored: 0 = front/top centre .. back/bottom centre), Y runs
    along it from the first ring. Quantised to the part's CLUT by finish()."""

    def __init__(s, name, mats, X, Y, P=None, tx=0.01, ty=0.01, seed=0):
        s.name = name
        s.h, s.w = X.shape
        s.mats = list(mats)
        s.X, s.Y, s.P, s.tx, s.ty = X, Y, P, tx, ty
        s.id = np.zeros((s.h, s.w), np.int16)
        s.sh = np.ones((s.h, s.w))
        s.glow = np.zeros((s.h, s.w))
        s.rng = np.random.default_rng(seed)
        s.nz = lowfreq(s.rng, s.h, s.w, 3)
        s.fixes = []
        s.ember = next((m for m in s.mats if m.startswith("ember")), None)

    def dx(s, x0):
        d = s.X - x0
        return (d + s.P / 2) % s.P - s.P / 2 if s.P else d

    def m(s, name):
        return s.mats.index(name)

    def put(s, mask, mat):
        s.id[np.asarray(mask) > 0.5] = s.m(mat)

    def lit(s, mask, f):
        s.sh *= 1 + (f - 1) * np.clip(np.asarray(mask, float), 0, 1)

    def hot(s, mask, g):
        mk = np.asarray(mask, float) > 0.5
        s.put(mk, s.ember)
        s.glow = np.maximum(s.glow, mk * g)

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

    def crack(s, x0, y0, ang, n, step, g=0.8, seed=0, branch=0.25, wiggle=0.55, halo=0.22):
        """An ember crack: a random walk with side branches, a charred rim round a
        one-texel ember core (and a dim glow halo)."""
        rng = np.random.default_rng(seed)
        walks = [(x0, y0, ang, n, g)]
        while walks:
            x, y, a, k, gg = walks.pop()
            pts = [(x, y)]
            for i in range(k):
                a += rng.uniform(-wiggle, wiggle)
                x += math.cos(a) * step; y += math.sin(a) * step
                pts.append((x, y))
                if i < k - 2 and rng.random() < branch:
                    walks.append((x, y, a + rng.choice((-1, 1)) * rng.uniform(0.7, 1.2), max(2, (k - i) // 2), gg * 0.8))
            rim = s.line(pts, 1.25 * max(s.tx, s.ty))
            s.put(rim, s.mats[0]); s.lit(rim, 0.55)
            s.glow = np.maximum(s.glow, rim * gg * halo)
            core = s.line(pts, 0.5 * max(s.tx, s.ty))
            s.hot(core, gg)

    def clusters(s, cell, thr, f=None, mat=None, where=1.0, seed=0):
        n = lowfreq(np.random.default_rng(seed + 991), s.h, s.w, cell)
        mk = (n > thr) * np.asarray(where, float)
        if f is not None:
            s.lit(mk, f)
        if mat:
            s.put(mk, mat)
        return mk

    def finish(s, light):
        L = np.clip(s.sh * light, 0.02, 4.0)
        out = np.zeros((s.h, s.w, 3))
        for mi, mn in enumerate(s.mats):
            sel = s.id == mi
            if not sel.any():
                continue
            if mn == s.ember:
                k = np.clip(np.round(s.glow[sel] * (len(RAMP_C[mn]) - 1)), 0, len(RAMP_C[mn]) - 1).astype(int)
                out[sel] = RAMP_C[mn][k]
                continue
            ll = RAMP_LL[mn]
            k = np.abs(np.log(L[sel])[:, None] - ll[None, :]).argmin(1)
            out[sel] = RAMP_C[mn][k]
        gl = GLOW_C[np.clip(np.round(s.glow * 5), 0, 5).astype(int)]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[hound] WARNING region {s.name} uses {n} colours")
        return out, gl


def loft_reg(name, info, mats, seed=0):
    """Reg over a loft region: X round the part at its widest ring, Y along it."""
    x0, y0, w, h = REG[name]
    Pm, Ltot = info["Pm"], info["L"]
    vrows = [(1 - v) * h for v in info["v"]]
    rows = np.interp(np.arange(h) + 0.5, vrows, info["d"])
    cols = (np.arange(w) + 0.5) / w
    U, Y = np.meshgrid(cols, rows)
    if info["mirror"]:
        return Reg(name, mats, U * Pm / 2, Y, None, Pm / 2 / w, Ltot / h, seed)
    return Reg(name, mats, (U - 0.5) * Pm, Y, Pm, Pm / w, Ltot / h, seed)


# ---------------------------------------------------------------- geometry

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


def _harden(bm):
    """Hard normals: split every edge sharper than SHARP (and every open edge)."""
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0.0) > SHARP:
            e.smooth = False


def loft(name, cs, profs, fref, reg, caps=(True, True), mirror=False, tip=None, cap_u=None):
    """A rigid faceted segment: rings of profile points (x = side, y = along fref)
    round a centre line. UVs wrap round the ring by arc length (mirror: 0 = profile
    vertex n/2, 1 = vertex 0, so both halves share texels) and run along it (v = 1 at
    the first ring). `tip` closes the far end to a point instead of a cap."""
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, xs, Ps = [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        rings.append([bm.verts.new(cs[i] + s * x + f * y) for x, y in profs[i]])
        L = [0.0]
        for k in range(n):
            a2, b2 = profs[i][k], profs[i][(k + 1) % n]
            L.append(L[-1] + math.hypot(b2[0] - a2[0], b2[1] - a2[1]))
        Ps.append(L[-1])
        if not mirror:
            xs.append([l / L[-1] for l in L])
        else:
            hh = n // 2
            xs.append([(L[hh] - L[k]) / L[hh] if k <= hh else (L[k] - L[hh]) / (L[n] - L[hh]) for k in range(n + 1)])
    d = [0.0]
    for i in range(1, m):
        d.append(d[-1] + (cs[i] - cs[i - 1]).length)
    if tip is not None:
        d.append(d[-1] + (V(tip) - cs[-1]).length)
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
            _face(bm, uvl, reg, vv, uu, rel - axis * rel.dot(axis))
    xc = cap_u if cap_u is not None else (0.5 if mirror else 0.25)       # caps take one flank texel
    for end, i in ((0, 0), (1, m - 1)):
        if not caps[end] or (end == 1 and tip is not None):
            continue
        uu = [(xc, vs[i] + (-0.02 if end == 0 else 0.02))] * n
        _face(bm, uvl, reg, rings[i][:], uu, -ts[0] if end == 0 else ts[-1])
    _harden(bm)
    ob = kit.mesh_obj(name, bm, None, smooth=False)
    return ob, {"v": vs, "P": Ps, "Pm": max(Ps), "L": d[-1], "d": d, "mirror": mirror}


def pyramid(name, base, apex, reg="bone", u0=0.0, u1=0.5):
    """A spike / claw / fang: a base polygon closed to an apex (no base face)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    bv = [bm.verts.new(V(p)) for p in base]
    av = bm.verts.new(V(apex))
    ctr = sum((V(p) for p in base), V()) / len(base)
    axis = (V(apex) - ctr).normalized()
    n = len(bv)
    for k in range(n):
        vv = [bv[k], bv[(k + 1) % n], av]
        uu = [(u0 + (u1 - u0) * k / n, 1.0), (u0 + (u1 - u0) * (k + 1) / n, 1.0), (u0 + (u1 - u0) * (k + 0.5) / n, 0.02)]
        c3 = (vv[0].co + vv[1].co + vv[2].co) / 3 - ctr
        _face(bm, uvl, reg, vv, uu, c3 - axis * c3.dot(axis))
    _harden(bm)
    return kit.mesh_obj(name, bm, None, smooth=False)


def spike(name, x, y, z, length=0.045, height=0.07, rake=0.04, width=0.011, reg="bone", u=(0.0, 0.5)):
    """A raked dorsal blade on the spine ridge: a thin triangle-based pyramid."""
    base = [(x, y, z + length / 2), (x + width, y - 0.004, z - length / 2), (x - width, y - 0.004, z - length / 2)]
    return pyramid(name, base, (x, y + height, z - length / 2 - rake), reg, *u)


def sym8(D, w, T, wl=0.55, yl=0.72, yw=0.25, wu=0.62, yu=0.55):
    """Symmetric 8-gon (x = left, y = up) from the bottom centre (vertex 0) round to
    the top centre (vertex 4): keel, lower flank, widest flank, upper corner, ridge."""
    half = [(0.0, -D), (-w * wl, -D * yl), (-w, -D * yw), (-w * wu, T * yu), (0.0, T)]
    return half + [(-x, y) for x, y in half[3:0:-1]]


def head8(yb, lc, sd, up, yt):
    half = [(0.0, yb), (-lc[0], lc[1]), (-sd[0], sd[1]), (-up[0], up[1]), (0.0, yt)]
    return half + [(-x, y) for x, y in half[3:0:-1]]


def leg6(w, f, b, fw=0.7, bw=1.0, by=0.3, fy=0.55):
    """Symmetric 6-gon leg section (x = side, y = forward): back centre (vertex 0),
    back corner, front corner, front centre (vertex 3). Knife edges front and back."""
    half = [(0.0, -b), (-w * bw, -b * by), (-w * fw, f * fy), (0.0, f)]
    return half + [(-x, y) for x, y in half[2:0:-1]]


def paw6(w, h):
    half = [(0.0, -h), (-w, -h), (-w * 0.78, h * 0.25), (0.0, h)]
    return half + [(-x, y) for x, y in half[2:0:-1]]


UPV = V((0, 1, 0)); FWD = V((0, 0, 1)); DOWN = V((0, -1, 0))


def build_parts():
    """Every part in its joint's local three.js space (zero pose). -> {part: (objs, infos)}"""
    I, P = {}, {}

    # torso on `fore`: deep wedge chest, ribs as alternating rings (rib / gap), back -> front
    TR = [(-0.22, 0.140, 0.078, 0.058, 0), (-0.16, 0.195, 0.100, 0.062, 1), (-0.11, 0.222, 0.090, 0.066, -1),
          (-0.06, 0.255, 0.110, 0.072, 1), (-0.01, 0.268, 0.098, 0.076, -1), (0.04, 0.278, 0.110, 0.082, 1),
          (0.09, 0.268, 0.094, 0.086, -1), (0.14, 0.248, 0.098, 0.090, 0), (0.20, 0.190, 0.070, 0.078, 0)]
    profs = []
    for z, D, w, T, rib in TR:
        pr = sym8(D, w, T, wl=0.55 + 0.05 * rib, yl=0.74, wu=0.5)
        profs.append(pr)
    torso, I["torso"] = loft("torso", [(0, 0, z) for z, *_ in TR], profs, UPV, "torso", caps=(False, True))
    sp = [spike(f"tsp{i}", 0, T + 0.004, z, height=h, length=0.05) for i, (z, T, h) in
          enumerate(((0.15, 0.088, 0.075), (0.06, 0.082, 0.085), (-0.04, 0.074, 0.075), (-0.14, 0.063, 0.06)))]
    P["torso"] = [torso] + sp

    # hind on `hind`: tucked loin, hip-bone points, croup and the tail root, back -> front
    HR = [(-0.25, 0.060, 0.045, 0.040), (-0.16, 0.120, 0.090, 0.056), (-0.07, 0.115, 0.100, 0.072),
          (0.02, 0.098, 0.070, 0.064), (0.11, 0.110, 0.064, 0.060), (0.22, 0.150, 0.080, 0.060)]
    hprof = []
    for i, (z, D, w, T) in enumerate(HR):
        wu = 0.92 if i == 2 else 0.6                     # the hip bones (ilium) jut at the upper corners
        yu = 0.95 if i == 2 else 0.55
        hprof.append(sym8(D, w, T, wl=0.6, yl=0.75, wu=wu, yu=yu))
    hind, I["hind"] = loft("hind", [(0, 0, z) for z, *_ in HR], hprof, UPV, "hind", caps=(True, False))
    sp = [spike(f"hsp{i}", 0, T + 0.002, z, height=h, length=0.045) for i, (z, T, h) in
          enumerate(((0.16, 0.06, 0.055), (0.06, 0.063, 0.06), (-0.04, 0.07, 0.05)))]
    P["hind"] = [hind] + sp

    # neck on `neck`: deep, narrow, ridged; +Z along the neck (tilted up by the pose)
    NR = [(-0.07, 0.085, 0.064, 0.070), (0.16, 0.062, 0.046, 0.056), (0.26, 0.046, 0.036, 0.044)]
    neck, I["neck"] = loft("neck", [(0, 0, z) for z, *_ in NR], [sym8(D, w, T, wu=0.55) for z, D, w, T in NR],
                           UPV, "neck", caps=(False, False), mirror=True)
    sp = [spike(f"nsp{i}", 0, T - 0.004, z, height=h, length=0.04, rake=0.035) for i, (z, T, h) in
          enumerate(((0.0, 0.066, 0.06), (0.12, 0.06, 0.055)))]
    P["neck"] = [neck] + sp

    # head: wedge skull and long snout, occiput -> nose
    HD = [(-0.085, -0.010, (0.022, 0.000), (0.030, 0.026), (0.020, 0.046), 0.060),
          (-0.040, -0.034, (0.040, -0.030), (0.056, 0.010), (0.042, 0.052), 0.078),
          (0.015, -0.040, (0.046, -0.036), (0.066, 0.002), (0.050, 0.046), 0.062),
          (0.070, -0.036, (0.036, -0.036), (0.042, 0.000), (0.030, 0.030), 0.040),
          (0.290, -0.026, (0.018, -0.026), (0.020, -0.009), (0.013, 0.010), 0.015)]
    head, I["head"] = loft("head", [(0, 0, z) for z, *_ in HD], [head8(*r[1:]) for r in HD], UPV, "head", mirror=True)
    ears = []
    for sx in (1, -1):
        # swept-back pointed ear: a thin blade from the top of the skull, raked back and out
        b = [(sx * 0.018, 0.064, -0.02), (sx * 0.048, 0.050, -0.03), (sx * 0.040, 0.050, -0.068), (sx * 0.014, 0.062, -0.058)]
        ears.append(pyramid(f"ear{sx}", b, (sx * 0.062, 0.118, -0.155), "ear", 0.0, 1.0))
    fangs = [pyramid(f"fang{sx}", [(sx * 0.020, -0.028, 0.236), (sx * 0.026, -0.030, 0.222), (sx * 0.014, -0.030, 0.220)],
                     (sx * 0.021, -0.066, 0.228), "bone", 0.5, 1.0) for sx in (1, -1)]
    P["head"] = [head] + ears + fangs

    # jaw: a wedge under the snout, hinge -> chin (mouth floor on top, keel below)
    JW = [(-0.02, 0.042, 0.004, 0.052), (0.13, 0.030, 0.004, 0.034), (0.268, 0.015, 0.002, 0.015)]
    jprof = [[(0.0, -D), (-w * 0.55, -D * 0.72), (-w, -D * 0.2), (-w * 0.95, T), (0.0, T - 0.004),
              (w * 0.95, T), (w, -D * 0.2), (w * 0.55, -D * 0.72)] for z, w, T, D in JW]
    jaw, I["jaw"] = loft("jaw", [(0, 0, z) for z, *_ in JW], jprof, UPV, "jaw", mirror=True)
    lf = [pyramid(f"lfang{sx}", [(sx * 0.016, 0.0, 0.215), (sx * 0.021, 0.0, 0.200), (sx * 0.011, 0.0, 0.198)],
                  (sx * 0.017, 0.032, 0.206), "bone", 0.5, 1.0) for sx in (1, -1)]
    P["jaw"] = [jaw] + lf

    # --- legs: zero pose points straight down (-Y), forward = +Z
    # fore upper: shoulder blade, point of shoulder, humerus, elbow point behind
    FU = [(0.06, 0.014, 0.030, 0.034), (-0.04, 0.036, 0.054, 0.046), (-0.17, 0.028, 0.038, 0.036), (-0.315, 0.021, 0.022, 0.046)]
    fu, I["foreUpper"] = loft("foreUpper", [(0, y, 0) for y, *_ in FU], [leg6(w, f, b) for y, w, f, b in FU],
                              FWD, "foreUpper", caps=(False, True), mirror=True)
    P["foreUpper"] = [fu]
    # fore lower: skeletal forearm, knobby wrist, pastern angled forward, paw + claws
    FL = [(0.02, (0, 0.02, -0.004), 0.021, 0.022, 0.030), (-0.14, (0, -0.14, 0.0), 0.016, 0.018, 0.018),
          (-0.215, (0, -0.215, 0.002), 0.020, 0.020, 0.024), (-0.27, (0, -0.268, 0.018), 0.017, 0.018, 0.016)]
    fl, I["foreLower"] = loft("foreLower", [c for y, c, *_ in FL], [leg6(w, f, b) for y, c, w, f, b in FL],
                              FWD, "foreLower", caps=(False, False), mirror=True)
    P["foreLower"] = [fl] + paw("fpaw", -0.305, 0.0)

    # hind thigh: a big wedge of muscle, deep front-to-back, thin at the stifle
    HT = [(0.045, 0.036, 0.060, 0.070), (-0.07, 0.048, 0.080, 0.074), (-0.20, 0.030, 0.040, 0.036), (-0.275, 0.022, 0.028, 0.026)]
    ht, I["hindThigh"] = loft("hindThigh", [(0, y, 0) for y, *_ in HT], [leg6(w, f, b) for y, w, f, b in HT],
                              FWD, "thigh", caps=(False, True), mirror=True)
    P["hindThigh"] = [ht]
    # hind shin: calf behind, thin tibia, the hock point (calcaneus) jutting back
    HS = [(0.02, 0.022, 0.028, 0.044), (-0.10, 0.019, 0.020, 0.034), (-0.255, 0.017, 0.019, 0.021)]
    hs, I["hindShin"] = loft("hindShin", [(0, y, 0) for y, *_ in HS], [leg6(w, f, b) for y, w, f, b in HS],
                             FWD, "shin", caps=(False, False), mirror=True)
    hock = pyramid("hock", [(0.0, -0.205, -0.012), (0.014, -0.245, -0.014), (-0.014, -0.245, -0.014)],
                   (0.0, -0.262, -0.062), "bone", 0.0, 0.5)
    P["hindShin"] = [hs, hock]
    # hind foot: metatarsus straight down from the hock, paw + claws
    HF = [(0.02, 0.018, 0.018, 0.022), (-0.08, 0.015, 0.016, 0.017), (-0.14, 0.016, 0.018, 0.016)]
    hf, I["hindFoot"] = loft("hindFoot", [(0, y, 0.004 * i) for i, (y, *_) in enumerate(HF)], [leg6(w, f, b) for y, w, f, b in HF],
                             FWD, "foot", caps=(False, False), mirror=True)
    P["hindFoot"] = [hf] + paw("hpaw", -0.172, -0.012)

    # tail: thin, segmented (pinch / bulge rings), a knife ridge on top, drooping to a bone tip
    TL = [(0.0, 0.0, 0.0, 0.020), (-0.06, 0.012, -0.003, 0.011), (-0.10, 0.012, -0.004, 0.017), (-0.16, 0.008, -0.012, 0.009),
          (-0.20, 0.004, -0.02, 0.014), (-0.26, -0.008, -0.038, 0.007), (-0.30, -0.020, -0.052, 0.011)]
    tprof = [[(-r, -r * 0.55), (0.0, r * 1.25), (r, -r * 0.55)] for *_, r in TL]
    tl, I["tail"] = loft("tail", [(0, y, z) for z, y, _, r in TL], tprof, UPV, "tail", caps=(True, False),
                         tip=(0, -0.05, -0.39))
    P["tail"] = [tl]
    return I, P


def paw(name, ybot, z0):
    """Paw (heel -> toes) sitting on y = ybot, with two claws. Shared UV region."""
    PW = [(z0 - 0.03, 0.025, 0.018, 0.0), (z0 + 0.066, 0.027, 0.011, 0.0)]
    ob, info = loft(name, [(0, ybot + h, z) for z, w, h, _ in PW], [paw6(w, h) for z, w, h, _ in PW], UPV, "paw", mirror=True)
    PAW_INFO[0] = info
    cl = [pyramid(f"{name}cl{sx}", [(sx * 0.011, ybot + 0.012, z0 + 0.07), (sx * 0.004, ybot + 0.006, z0 + 0.066),
                                    (sx * 0.018, ybot + 0.006, z0 + 0.066)],
                  (sx * 0.012, ybot + 0.001, z0 + 0.098), "bone", 0.5, 1.0) for sx in (1, -1)]
    return [ob] + cl


PAW_INFO = [None]


# ---------------------------------------------------------------- rig / pose

def make_rig(root, meshes, mat, name="H"):
    """Joint empties (three.js space under a +90 deg X turn) and one object per part and
    joint, each with its own copy of the part mesh (vertex snapping edits meshes)."""
    conv = kit.empty(f"{name}_conv", parent=root)
    conv.rotation_euler = (math.radians(90), 0, 0)
    J = {}
    for jn, par, pos in JOINTS:
        e = kit.empty(f"{name}_{jn}", pos, J[par] if par else conv)
        e.rotation_mode = "ZYX"                      # = three.js Euler order 'XYZ'
        e.empty_display_size = 0.03
        J[jn] = e
    objs = []
    for pn, joints in PARTS:
        for jn in joints:
            ob = bpy.data.objects.new(f"{name}_{pn}_{jn}", meshes[pn].copy())
            kit.link(ob, J[jn])
            if mat:
                kit.assign(ob, mat)
            objs.append(ob)
    return J, objs


def cycle(p, duty):
    p -= math.floor(p)
    if p < duty:
        return (-1 + 2 * (p / duty), 0.0)
    u = (p - duty) / (1 - duty)
    return (1 - 2 * (0.5 - 0.5 * math.cos(math.pi * u)), math.sin(math.pi * u))


def pose(J, kind="rest", p=0.0, u=0.0, t=0.0):
    """A port of Hounds.pose() (src/client/render/hounds.js) for the renders."""
    E = {n: [0.0, 0.0, 0.0] for n in J}
    bp = [0.0, 0.0, 0.0]
    E["neck"][0], E["head"][0], E["jaw"][0], E["tail"][0] = -0.55, 0.55, 0.04, -0.15
    for s in "LR":
        E["sh" + s][0], E["el" + s][0] = 0.12, -0.12
        E["hip" + s][0], E["st" + s][0], E["hk" + s][0] = -0.35, 0.9, -0.55

    def front(s, sw, lift, amp):
        E["sh" + s][0] = 0.12 + sw * amp
        E["el" + s][0] = -0.12 + lift * 1.7 - max(0, -sw) * 0.25 * amp

    def back(s, sw, lift, amp):
        E["hip" + s][0] = -0.35 + sw * amp
        E["st" + s][0] = 0.9 + lift * 0.75 + max(0, sw) * 0.15
        E["hk" + s][0] = -0.55 - lift * 0.95 + max(0, sw) * 0.35

    if kind == "gallop":
        a, duty = 1.0, 0.3
        hl, hr, fr, fl = cycle(p, duty), cycle(p + 0.9, duty), cycle(p + 0.52, duty), cycle(p + 0.42, duty)
        front("L", *fl, 0.82 * a); front("R", *fr, 0.82 * a)
        back("L", *hl, 0.72 * a); back("R", *hr, 0.72 * a)
        gather = -(hl[0] + hr[0]) * 0.5
        E["hind"][0] = -0.26 * gather * a; E["fore"][0] = 0.1 * gather * a
        w = TAU * p
        bp[1] = -0.035 + 0.055 * a * max(0, math.sin(w + 0.9))
        E["body"][0] = 0.09 * a * math.sin(w + 2.3)
        E["neck"][0] = -0.06 + 0.1 * a * math.sin(w + 0.6)
        E["head"][0] = 0.26 - 0.06 * math.sin(w + 0.6)
        E["jaw"][0] = 0.2 + 0.12 * max(0, math.sin(w + 1.2)) + 0.25
        E["tail"][0] = 0.28 + 0.12 * math.sin(w + 1.5); E["tail"][1] = 0.18 * math.sin(w * 0.5)
    elif kind == "trot":
        a, duty = 0.95, 0.55
        A, B = cycle(p, duty), cycle(p + 0.5, duty)
        hA, hB = cycle(p + 0.04, duty), cycle(p + 0.54, duty)
        front("L", *A, 0.45 * a); back("R", *hA, 0.42 * a)
        front("R", *B, 0.45 * a); back("L", *hB, 0.42 * a)
        w = TAU * p
        bp[1] = -0.02 + 0.018 * abs(math.sin(w))
        E["body"][2] = 0.025 * math.sin(w)
        E["neck"][0] = -0.28; E["head"][0] = 0.5; E["head"][1] = 0.25
        E["jaw"][0] = 0.3
        E["tail"][0] = -0.05; E["tail"][1] = 0.3 * math.sin(w)
    elif kind == "lunge":                       # the launch phase of ATTACK (0.25 < u < 0.72)
        l = (u - 0.25) / 0.47
        e = l * l * (3 - 2 * l)
        bp[1] = -0.1 + 0.4 * math.sin(math.pi * l); bp[2] = 0.5 * e
        E["body"][0] = -0.32 * math.sin(math.pi * l)
        front("L", -1.4 * e, 0, 1); front("R", -1.3 * e, 0, 1)
        E["elL"][0] -= 0.3 * e; E["elR"][0] -= 0.25 * e
        back("L", 1.1 * e, 0, 0.8); back("R", 1.0 * e, 0, 0.8)
        E["hind"][0] = 0.15 * e
        E["neck"][0] = -0.05 - 0.2 * e; E["head"][0] = 0.35 - 0.15 * e
        E["jaw"][0] = 0.45 + 0.6 * smooth01(l / 0.6)
        E["tail"][0] = 0.35 * e
    for n, e in E.items():
        J[n].rotation_euler = e
    J["body"].location = bp
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- baked light

def world_copies(objs, select):
    """Posed copies with the world transform applied (for baking in world space)."""
    out = []
    for ob in objs:
        me = ob.data.copy()
        me.transform(ob.matrix_world)
        c = bpy.data.objects.new("bake_" + ob.name, me)
        kit.link(c)
        out.append((c, ob in select))
    return out


def bake_light(copies):
    """AO + facet normals baked from the posed model onto the page, lit like ps1b: a
    symmetric top-front key, a sky term and a faint back rim, all occluded."""
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
    for o, _ in copies:
        kit.assign(o, mat)
    targets = [o for o, sel in copies if sel]
    res = {}
    for kind in ("AO", "NORMAL"):
        img = bpy.data.images.new("bake_" + kind, AT, AT, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        tex.image = img
        mat.node_tree.nodes.active = tex
        kit.activate(targets[0])
        for o in targets:
            o.select_set(True)
        if kind == "AO":
            bpy.ops.object.bake(type="AO", margin=2, use_clear=True)
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=2, use_clear=True)
        px = np.empty(AT * AT * 4, np.float32)
        img.pixels.foreach_get(px)
        res[kind] = px.reshape(AT, AT, 4)[::-1, :, :3].astype(np.float64)
    bpy.data.objects.remove(ground)
    nrm = res["NORMAL"] * 2 - 1
    nrm /= np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    ao = np.clip(res["AO"][..., 0], 0, 1)
    key = np.array([0.0, -0.75, 0.66]); key /= np.linalg.norm(key)
    rim = np.array([0.0, 0.7, 0.7]); rim /= np.linalg.norm(rim)
    dk = np.clip(nrm @ key, 0, 1); dr = np.clip(nrm @ rim, 0, 1)
    sky = 0.5 + 0.5 * nrm[..., 2]
    light = 1.08 * (ao ** 0.75 * (0.52 + 0.10 * sky) + 0.40 * dk * ao ** 0.4 + 0.12 * dr * ao ** 0.4)
    light = 1.0 + 0.8 * (light - 1.0)          # painted light at roughly 60-80 % strength
    print("[hound] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
    return light, nrm[..., 2]


def vertex_tint(ob, wob):
    """Per-corner colour from the posed world copy: paws and belly darker (soot), a
    cool lean in the shadows. Multiplied into the texture."""
    me, wm = ob.data, wob.data
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    for p in wm.polygons:
        nz = p.normal.z
        for li in p.loop_indices:
            co = wm.vertices[wm.loops[li].vertex_index].co
            f = 0.72 + 0.28 * smooth01((co.z - 0.02) / 0.40)          # sooty paws
            f *= 0.86 + 0.14 * (0.5 + 0.5 * nz)                        # darker undersides
            cols[li] = (f ** 1.06, f ** 1.03, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca


# ---------------------------------------------------------------- texture painting

def paint_torso(I, nz):
    info = I["torso"]
    r = loft_reg("torso", info, ["hide", "bone3", "ember3", "ash2"], 21)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ax = np.abs(X)
    d = info["d"]
    ribs, gaps = [d[1], d[3], d[5]], [d[2], d[4], d[6]]
    flank = (ax > 0.07) & (ax < 0.34)
    sweep = -0.035 * np.clip((ax - 0.07) / 0.27, 0, 1)           # ribs sweep back as they go down
    for yr in ribs:
        rb = flank & (np.abs(Y - yr - sweep) < 1.1 * ty)
        r.put(rb, "bone3"); r.lit(rb, 1.12)
        r.lit(flank & (np.abs(Y - yr - sweep + 1.6 * ty) < 0.7 * ty), 0.7)        # shadow under each rib
    for yg in gaps:
        gp = (ax > 0.1) & (ax < 0.33) & (np.abs(Y - yg - sweep) < 1.2 * ty)
        r.lit(gp, 0.5)
        r.hot(gp & (np.abs(Y - yg - sweep) < 0.55 * ty) & (ax > 0.13) & (ax < 0.31) & (r.nz > -0.35), 0.55)
    # spine: a bone ridge of knobbed vertebrae down the back
    sp = ax < 1.1 * tx
    r.put(sp, "bone3"); r.lit(sp, 1.1)
    r.lit(sp & (np.sin(Y / 0.034 * TAU) > 0.4), 0.7)
    r.lit((ax >= 1.1 * tx) & (ax < 2.2 * tx), 0.7)
    # shoulder mass and the chest front, sternum keel scorched
    r.lit(np.clip((Y - 0.33) / 0.06, 0, 1) * (ax < 0.2), 1.08)
    r.lit((ax > P / 2 - 0.02), 0.78)
    for sx, seed in ((1, 3), (-1, 5)):
        r.crack(sx * 0.12, 0.40, -math.pi / 2 - sx * 0.3, 5, 2.2 * tx, 0.85, seed)       # over the shoulder
        r.crack(sx * 0.08, 0.02, math.pi / 2 + sx * 0.5, 4, 2.2 * tx, 0.75, seed + 10)    # behind the last rib
        r.crack(sx * 0.36, 0.30, -math.pi / 2 + sx * 0.2, 4, 2.0 * tx, 0.7, seed + 20)    # under the chest
    up = np.clip(nz, 0, 1)
    r.clusters(3, 0.4, mat="ash2", where=(up > 0.7) & (ax > 2.2 * tx) & (r.id == 0), seed=4)
    r.clusters(4, 0.5, f=0.88, where=r.id == 0, seed=6)
    r.clusters(3, 0.55, f=1.12, where=(r.id == 0) & (ax < 0.12), seed=7)
    return r


def paint_hind(I, nz):
    info = I["hind"]
    r = loft_reg("hind", info, ["hide", "bone3", "ember3", "ash2"], 31)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ax = np.abs(X)
    d = info["d"]
    sp = ax < 1.1 * tx
    r.put(sp & (Y > 0.03), "bone3"); r.lit(sp, 1.1)
    r.lit(sp & (np.sin(Y / 0.032 * TAU) > 0.4), 0.7)
    r.lit((ax >= 1.1 * tx) & (ax < 2.2 * tx), 0.7)
    # hip bones: ivory points at the upper corners of ring 2
    for sx in (1, -1):
        hb = ell(X, Y, sx * 0.09, d[2], 0.024, 0.03) < 1
        r.put(hb, "bone3"); r.lit(hb, 1.15)
        r.lit((ell(X, Y, sx * 0.09, d[2] - 0.035, 0.03, 0.02) < 1) & ~hb, 0.65)
    # tucked-up loin: gaunt shadow along the flank, darker belly
    r.lit((ax > 0.12) & (Y > d[2]) & (Y < d[5]), 0.8)
    r.lit(ax > P / 2 - 0.04, 0.72)
    r.lit(Y < 0.03, 0.8)                                            # round the tail root
    for sx, seed in ((1, 41), (-1, 43)):
        r.crack(sx * 0.05, 0.36, -math.pi / 2 + sx * 0.6, 5, 2.4 * tx, 0.8, seed)       # across the loin
        r.crack(sx * 0.16, 0.12, math.pi / 2 + sx * 0.4, 4, 2.2 * tx, 0.7, seed + 7)     # the haunch
    up = np.clip(nz, 0, 1)
    r.clusters(3, 0.4, mat="ash2", where=(up > 0.7) & (ax > 2.2 * tx) & (r.id == 0), seed=8)
    r.clusters(4, 0.5, f=0.88, where=r.id == 0, seed=9)
    return r


def paint_neck(I, nz):
    r = loft_reg("neck", I["neck"], ["hide", "bone3", "ember3", "ash2"], 51)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    top = X < 1.1 * tx
    r.put(top, "bone3"); r.lit(top, 1.1)
    r.lit(top & (np.sin(Y / 0.034 * TAU) > 0.4), 0.7)
    r.lit((X >= 1.1 * tx) & (X < 2.2 * tx), 0.7)
    r.lit(np.clip((Y - (Lt - 0.05)) / 0.05, 0, 1), 0.7)            # under the skull
    r.lit(X > 0.11, 0.8)                                            # throat in shadow
    # the throat glows: a seam of embers down the underside
    r.crack(0.13, Lt - 0.02, -math.pi / 2 - 0.1, 7, 2.0 * ty, 0.9, 52, branch=0.35, wiggle=0.35)
    r.crack(0.07, 0.05, math.pi / 2 - 0.4, 4, 2.0 * ty, 0.7, 53)
    r.clusters(3, 0.45, mat="ash2", where=(np.clip(nz, 0, 1) > 0.6) & (X > 2.2 * tx) & (r.id == 0), seed=5)
    r.clusters(4, 0.5, f=0.88, where=r.id == 0, seed=6)
    return r


def paint_head(I, nz):
    info = I["head"]
    r = loft_reg("head", info, ["hide", "bone", "ember3", "maw"], 11)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    d = info["d"]                                    # ring stations: occiput, cranium, brow, stop, nose
    ybrow, ystop, ynose = d[2], d[3], d[4]
    # planes: the top of the skull and snout faces the key, the sides turn away
    r.lit(X < 0.035, 1.12)
    r.lit((X > 0.1) & (X < 0.135), 0.82)
    # bone showing through on the skull: brow ridges and the sagittal crest
    crest = (X < 1.2 * tx) & (Y < ystop)
    r.put(crest, "bone"); r.lit(crest, 1.12)
    # brow ridge: a lit hard edge along the upper corner, from the cranium to the stop
    r.lit(segd(X, Y, (0.047, d[1]), (0.034, ystop)) < 1.1 * tx, 1.3)
    # sunken socket under it and the ember eye: a small slanted slit
    EX, EY = 0.062, ybrow + 0.008
    sock = ell(X, Y, EX, EY, 0.016, 0.022)
    r.lit(np.clip((1 - sock) / 0.5, 0, 1), 0.42)
    e0, e1 = (EX - 0.004, EY + 0.010), (EX + 0.004, EY - 0.009)
    r.hot(segd(X, Y, e0, e1) < 0.0042, 0.6)
    r.hot(segd(X, Y, e0, e1) < 0.0018, 0.8)
    # snout: a lit bridge, nostrils and a charred leathery nose tip
    r.lit((X < 0.012) & (Y > ystop) & (Y < ynose - 0.02), 1.18)
    nose = Y > ynose - 0.025
    r.lit(nose, 0.55)
    r.lit(nose & (X > 0.018) & (X < 0.04), 0.4)
    # the lip line: gums pulled back over a row of long teeth, then the dark palate
    lip = 0.118
    teeth = (X > lip) & (X < lip + 0.018) & (Y > ystop - 0.02) & (Y < ynose - 0.012)
    r.put(teeth, "bone"); r.lit(teeth, 1.25)
    ph = np.mod((Y - ystop) / 0.0125, 1.0)
    r.lit(teeth & ((ph < 0.22) | (X > lip + 0.018 - 1.0 * tx * (1 + 2 * np.abs(ph - 0.5)))), 0.45)
    gum = (X > lip - 0.012) & (X <= lip) & (Y > ystop - 0.03) & (Y < ynose - 0.008)
    r.put(gum, "maw"); r.lit(gum, 0.9)
    r.lit((X > lip - 0.02) & (X <= lip - 0.012) & (Y > ystop - 0.03), 0.7)
    pal = (X >= lip + 0.018) & (Y > d[2] - 0.02)
    r.put(pal, "maw"); r.lit(pal, 0.6)
    r.hot(pal & (np.abs(X - info["Pm"] / 2) < 0.008) & (Y > d[2]) & (Y < d[2] + 0.04) & (r.nz > 0.1), 0.4)   # throat embers
    # a crack from the brow back over the skull, one down the cheek
    r.crack(0.03, ybrow - 0.01, -math.pi / 2 - 0.3, 4, 1.8 * ty, 0.8, 12)
    r.crack(0.095, ybrow + 0.03, math.pi / 2 + 0.3, 3, 1.8 * ty, 0.65, 13)
    r.clusters(3, 0.5, f=0.86, where=r.id == 0, seed=14)
    r.clusters(3, 0.6, f=1.14, where=(r.id == 0) & (X < 0.05), seed=15)
    return r


def paint_jaw(I, nz):
    info = I["jaw"]
    r = loft_reg("jaw", info, ["hide6", "bone3", "ember3", "maw"], 61)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    tongue = X < 0.02
    r.put(tongue, "maw"); r.lit(tongue, 0.9)
    r.hot(tongue & (X < 0.006) & (Y > 0.02) & (Y < 0.07) & (r.nz > 0.0), 0.4)
    teeth = (X >= 0.02) & (X < 0.034) & (Y > 0.06) & (Y < Lt - 0.012)
    r.put(teeth, "bone3"); r.lit(teeth, 1.2)
    ph = np.mod(Y / 0.012, 1.0)
    r.lit(teeth & (ph < 0.25), 0.5)
    r.lit((X >= 0.034) & (X < 0.042), 0.62)                        # lip shadow under the teeth
    r.lit(X > 0.07, 0.72)                                           # underside
    r.lit(np.clip(1 - Y / 0.04, 0, 1), 0.7)                         # hinge
    r.crack(0.05, 0.08, math.pi / 2 - 0.1, 4, 2.0 * ty, 0.6, 62)
    r.clusters(3, 0.5, f=0.86, where=r.id == 0, seed=63)
    return r


def paint_leg(name, I, part, mats, seed, bone_front=False, crack=None):
    info = I[part]
    r = loft_reg(name, info, mats, seed)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt, half = Y.max(), info["Pm"] / 2
    r.lit(X < 0.25 * half, 1.1)                                    # front edge catches the key
    r.lit(X > 0.8 * half, 0.82)                                    # back edge
    if bone_front:                                                 # skeletal shin / forearm: bone along the front
        b = (X < 0.16 * half) & (Y > 0.03) & (Y < bone_front * Lt)
        r.put(b, mats[1]); r.lit(b, 0.85)
        r.lit((X >= 0.16 * half) & (X < 0.3 * half) & (Y < bone_front * Lt), 0.8)
    if crack:
        for c in crack:
            r.crack(*c)
    r.clusters(3, 0.5, f=0.86, where=r.id == 0, seed=seed + 1)
    return r


def paint_ear():
    x0, y0, w, h = REG["ear"]
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("ear", ["hide", "ember3"], Xg * 0.06, Yg * 0.12, None, 0.06 / w, 0.12 / h, 71)
    # u = 0..1 round the base (outer faces first), v = base -> tip
    r.lit(np.full(Xg.shape, 1.0), 1.0)
    r.lit(Yg < 0.25, 0.7)                                           # root of the ear
    r.lit((Xg > 0.5), 0.72)                                         # inner faces
    r.hot((Xg > 0.62) & (Xg < 0.88) & (Yg > 0.35) & (Yg < 0.75), 0.45)   # embers inside the ear
    return r


def paint_bone():
    x0, y0, w, h = REG["bone"]
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("bone", ["bone", "claw"], Xg, Yg, None, 1 / w, 1 / h, 81)
    # left half: spikes / fangs / hock (dark root -> pale tip); right half: claws
    r.put(Xg >= 0.5, "claw")
    r.sh = np.where(Xg < 0.5, 0.55 + 0.75 * Yg, 0.7 + 0.5 * Yg)          # rows run base -> tip
    r.lit(np.mod(Xg * 3, 1) < 0.2, 0.75)
    return r


def paint_paw(I, nz):
    r = loft_reg("paw", PAW_INFO[0], ["hide6", "claw", "ember3"], 91)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    half = PAW_INFO[0]["Pm"] / 2
    Lt = Y.max()
    r.put(X > 0.62 * half, "claw")                                  # pads
    r.lit(X > 0.62 * half, 0.6)
    for k in (-1, 1):                                               # toe splits on top
        r.lit((np.abs(X - 0.012) < 0.6 * tx) & (Y > Lt * 0.45), 0.5)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.75)
    r.lit(X < 0.012, 1.15)
    return r


def paint_tail(I, nz):
    info = I["tail"]
    r = loft_reg("tail", info, ["hide", "bone3", "ember3"], 95)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    d = info["d"]
    for k in (2, 4, 6):                                             # a vertebra knob on each bulge
        kb = (np.abs(Y - d[k]) < 1.2 * ty) & (np.abs(X) < 1.5 * tx)
        r.put(kb, "bone3"); r.lit(kb, 1.15)
    for k in (1, 3, 5):
        r.lit(np.abs(Y - d[k]) < 1.0 * ty, 0.6)
    tipb = Y > d[6] + 0.01
    r.put(tipb, "bone3"); r.lit(tipb & (Y > d[6] + 0.04), 1.2)
    r.hot((np.abs(Y - d[3]) < 0.5 * ty) & (np.abs(np.abs(X) - 0.012) < 0.6 * tx), 0.6)
    r.lit(np.abs(np.abs(X) - r.P / 2) < 0.012, 0.75)
    return r


def paint_page(I, light, nz):
    L = lambda reg: light[REG[reg][1]:REG[reg][1] + REG[reg][3], REG[reg][0]:REG[reg][0] + REG[reg][2]]
    Nz = lambda reg: nz[REG[reg][1]:REG[reg][1] + REG[reg][3], REG[reg][0]:REG[reg][0] + REG[reg][2]]
    regs = [paint_torso(I, Nz("torso")), paint_hind(I, Nz("hind")), paint_neck(I, Nz("neck")), paint_head(I, Nz("head")),
            paint_jaw(I, Nz("jaw")), paint_tail(I, Nz("tail")), paint_paw(I, Nz("paw")), paint_ear(), paint_bone()]
    regs.append(paint_leg("foreUpper", I, "foreUpper", ["hide", "bone3", "ember3", "ash2"], 101,
                          crack=[(0.02, 0.05, math.pi / 2 + 0.2, 5, 0.012, 0.8, 102)]))
    regs.append(paint_leg("foreLower", I, "foreLower", ["hide6", "bone3", "ember3"], 111, bone_front=0.6))
    regs.append(paint_leg("thigh", I, "hindThigh", ["hide", "bone3", "ember3", "ash2"], 121,
                          crack=[(0.05, 0.02, math.pi / 2 - 0.3, 5, 0.012, 0.8, 122), (0.1, 0.1, math.pi / 2 + 0.4, 3, 0.011, 0.6, 123)]))
    regs.append(paint_leg("shin", I, "hindShin", ["hide6", "bone3", "ember3"], 131, bone_front=0.7))
    regs.append(paint_leg("foot", I, "hindFoot", ["hide6", "bone3", "ember3"], 141))
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 19, 24))
    glow = np.zeros((AT, AT, 3))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = light[y0:y0 + h, x0:x0 + w]
        lt = blur2(lt, 0.7, 0.7, wrap=r.P is not None)
        if r.name in ("ear", "bone"):
            lt = np.ones_like(lt)
        col, gl = r.finish(lt)
        page[y0:y0 + h, x0:x0 + w] = col
        glow[y0:y0 + h, x0:x0 + w] = gl
    return page, glow


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


def export_model(meshes, tris):
    """public/models/hound.json in the STYLE.md / models.js format."""
    os.makedirs(MODELS, exist_ok=True)
    joints = {jn: {"parent": par, "pos": [r4(c) for c in pos]} for jn, par, pos in JOINTS}
    parts = []
    for pn, js in PARTS:
        me = meshes[pn]
        me.calc_loop_triangles()
        uvd = me.uv_layers["UVMap"].data
        cn = me.corner_normals
        col = me.color_attributes.get("Col")
        seen, pos, nrm, uv, cc, idx = {}, [], [], [], [], []
        for tri in me.loop_triangles:
            for li in tri.loops:
                p = me.vertices[me.loops[li].vertex_index].co
                n = cn[li].vector
                t = uvd[li].uv
                c = col.data[li].color if col else (1, 1, 1, 1)
                key = (r4(p.x), r4(p.y), r4(p.z), r4(n.x), r4(n.y), r4(n.z), r4(t.x), r4(1 - t.y),
                       r4(c[0]), r4(c[1]), r4(c[2]))
                k = seen.get(key)
                if k is None:
                    k = seen[key] = len(seen)
                    pos += key[0:3]; nrm += key[3:6]; uv += key[6:8]; cc += key[8:11]
                idx.append(k)
        parts.append({"name": pn, "joint": js[0], "pos": pos, "nrm": nrm, "uv": uv, "col": cc, "idx": idx})
    data = {"version": 1, "texture": "hound.png", "emissive": "hound_glow.png", "joints": joints, "parts": parts,
            "meta": {"style": "hound", "tris": tris, "page": [AT, AT],
                     "shared": {pn: js for pn, js in PARTS if len(js) > 1},
                     "note": "shared parts are symmetric about their joint's X = 0 plane; draw each at every listed joint"}}
    path = os.path.join(MODELS, "hound.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"[hound] export -> {path} ({os.path.getsize(path) // 1024} KB, {tris} tris)")


# ---------------------------------------------------------------- materials (ps1b look + glow)

def fog_group():
    ng = bpy.data.node_groups.get("HND_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("HND_Fog", "ShaderNodeTree")
    ng.interface.new_socket(name="Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    N, Lk = ng.nodes, ng.links
    go = N.new("NodeGroupOutput")
    tc = N.new("ShaderNodeTexCoord")
    sub = N.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.56, 0.0)
    Lk.new(tc.outputs["Window"], sub.inputs[0])
    asp = N.new("ShaderNodeVectorMath"); asp.operation = "MULTIPLY"; asp.name = "Aspect"
    asp.inputs[1].default_value = (NATIVE[0] / NATIVE[1], 1.0, 0.0)
    Lk.new(sub.outputs[0], asp.inputs[0])
    ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    Lk.new(asp.outputs[0], ln.inputs[0])
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0; mr.inputs["From Max"].default_value = 0.8
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, glow=None):
    """Texture (nearest) x vertex colour, lit by the sun plus flat ambient, the glow
    page added as emission, mixed to the fog colour by camera distance."""
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
    surf = add.outputs[0]
    if glow is not None:
        gt = N.new("ShaderNodeTexImage"); gt.image = glow; gt.interpolation = "Closest"
        ge = N.new("ShaderNodeEmission"); ge.name = "Glow"
        Lk.new(gt.outputs["Color"], ge.inputs["Color"]); ge.inputs["Strength"].default_value = GLOW_STRENGTH
        add2 = N.new("ShaderNodeAddShader")
        Lk.new(surf, add2.inputs[0]); Lk.new(ge.outputs[0], add2.inputs[1])
        surf = add2.outputs[0]
    fg = N.new("ShaderNodeGroup"); fg.node_tree = fog_group()
    fem = N.new("ShaderNodeEmission"); Lk.new(fg.outputs[0], fem.inputs["Color"])
    cam = N.new("ShaderNodeCameraData")
    fr = N.new("ShaderNodeMapRange"); fr.name = "FogRange"
    fr.inputs["From Min"].default_value = 3.0; fr.inputs["From Max"].default_value = 13.0
    Lk.new(cam.outputs["View Distance"], fr.inputs["Value"])
    mx = N.new("ShaderNodeMixShader")
    Lk.new(fr.outputs["Result"], mx.inputs[0]); Lk.new(surf, mx.inputs[1]); Lk.new(fem.outputs[0], mx.inputs[2])
    Lk.new(mx.outputs[0], out.inputs["Surface"])
    return m


def paint_floor():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("floor", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 111)
    r.clusters(10, 0.4, f=0.92, seed=21)
    r.clusters(7, 0.6, f=1.06, seed=22)
    r.clusters(3, 0.66, f=0.93, seed=23)
    r.lit((Xg < 1.2 / w) | (Yg < 1.2 / h), 0.75)
    return r.finish(np.ones((h, w)))[0]


def paint_wall():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wall", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 121)
    for yk in (0.0, 0.5):
        r.lit(np.abs(Yg - yk) < 0.9 / h, 0.7)
        r.lit(np.abs(Yg - yk - 1.2 / h) < 0.5 / h, 1.12)
    r.clusters(20, 0.2, f=0.9, seed=31)
    r.clusters(12, 0.5, f=1.06, seed=32)
    return r.finish(np.full((h, w), 0.9))[0]


def paint_wood():
    h, w = 16, 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wood", ["wood"], Xg, Yg, 1.0, 1 / w, 1 / h, 131)
    g = np.sin(Yg * 2 * np.pi * 3 + 1.5 * np.sin(Xg * 9))
    r.lit(np.clip(g, 0, 1), 1.18); r.lit(np.clip(-g, 0, 1), 0.82)
    r.lit((Yg < 1.2 / h) | (Yg > 1 - 1.2 / h), 0.6)
    for x_ in (0.06, 0.94):
        r.lit(ell(Xg, Yg, x_, 0.5, 1.5 / w, 1.5 / h) < 1, 0.4)
    return r.finish(np.ones((h, w)))[0]


# ---------------------------------------------------------------- build

STATE = {}
HERO_P = 0.62                                    # gallop phase of the hero pose


def build():
    root = kit.empty("HOUND_root")
    I, P = build_parts()
    meshes, joined = {}, []
    for pn, objs in P.items():
        ob = kit.join(objs, pn) if len(objs) > 1 else objs[0]
        ob.name = pn
        ob.data.name = pn
        meshes[pn] = ob.data
        ob.data.use_fake_user = True
        joined.append(ob)
    for ob in joined:
        bpy.data.objects.remove(ob)
    bpy.context.view_layer.update()
    STATE["meshes"] = meshes
    J, objs = make_rig(root, meshes, None, "H")
    # bake and tint in the standing rest pose (only the first joint of shared parts is a target)
    pose(J, "rest")
    first = {f"H_{pn}_{js[0]}" for pn, js in PARTS}
    copies = world_copies(objs, [o for o in objs if o.name in first])
    light, nz = bake_light(copies)
    by_name = {c.name[len("bake_"):]: c for c, _ in copies}
    for pn, js in PARTS:
        vertex_tint(bpy.data.objects[f"H_{pn}_{js[0]}"], by_name[f"H_{pn}_{js[0]}"])
    for c, _ in copies:
        me = c.data
        bpy.data.objects.remove(c)
        bpy.data.meshes.remove(me)
    # the rig's objects hold copies made before the tint: take the tinted first-joint meshes as the masters
    for pn, js in PARTS:
        src = bpy.data.objects[f"H_{pn}_{js[0]}"].data
        meshes[pn] = src.copy(); meshes[pn].use_fake_user = True
        for jn in js[1:]:
            bpy.data.objects[f"H_{pn}_{jn}"].data = src.copy()
    page, glow = paint_page(I, light, nz)
    os.makedirs(OUT, exist_ok=True)
    save_png(os.path.join(OUT, "texture_page.png"), page)
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    save_png(os.path.join(MODELS, "hound.png"), page)
    save_png(os.path.join(MODELS, "hound_glow.png"), glow)
    tris = sum(len(m.polygons) and sum(len(p.vertices) - 2 for p in m.polygons) * len(js)
               for (pn, js), m in ((pj, meshes[pj[0]]) for pj in PARTS))
    export_model(meshes, tris)
    img, gimg = make_image("hound_page", page), make_image("hound_glow", glow)
    mat = ps1_mat("HND_Hound", img, glow=gimg)
    STATE["mat"] = mat
    for ob in objs:
        kit.assign(ob, mat)
    STATE["J"] = J
    pose(J, "gallop", HERO_P)
    return root


# ---------------------------------------------------------------- stage, snapping, post

SNAP = []
REST = {}


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
    cm = bpy.data.materials.new("HND_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("HND_Env") else (dist - near_c, dist + far_c)
            fr.inputs["From Min"].default_value = near
            fr.inputs["From Max"].default_value = far


def snap_register(root):
    for ob in kit.descendants(root):
        if ob.type == "MESH":
            if ob.name not in REST:                          # the unsnapped coordinates, captured once
                rest = np.empty(len(ob.data.vertices) * 3, np.float32)
                ob.data.vertices.foreach_get("co", rest)
                REST[ob.name] = rest.reshape(-1, 3).astype(np.float64)
            SNAP.append((ob, REST[ob.name]))


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
    kit.frame_to(cam, root, margin=1.04, aim_frac=0.45, elev=0.14)
    fog_card(cam)
    bm = bmesh.new()
    F = 60.0
    vv = [bm.verts.new(p) for p in ((-F, -F, -0.002), (F, -F, -0.002), (F, F, -0.002), (-F, F, -0.002))]
    bm.faces.new(vv)
    floor = kit.mesh_obj("Floor", bm, None, smooth=False)
    fimg = make_image("hnd_floor", paint_floor())
    kit.assign(floor, ps1_mat("HND_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
    set_fog(cam.location.length)
    SNAP.clear()
    snap_register(root)


PS1_DITHER = np.array([[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]], float)


def crt(a, k=UP):
    """Native frame -> 1997 TV (the Ghoul's composite pass from z_ps1b)."""
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


# ---------------------------------------------------------------- the in-game still

def ingame(root):
    """Two hounds in the bunker at fighting distance: 320x240, dark fog."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    root.rotation_euler.z = 0
    J = STATE["J"]
    root.location = (-0.5, -0.2, 0)
    root.rotation_euler.z = math.radians(-58)                   # galloping in, across the camera
    pose(J, "gallop", 0.12)
    root2 = kit.empty("HOUND2_root")
    J2, _ = make_rig(root2, STATE["meshes"], STATE["mat"], "H2")
    root2.location = (1.25, 1.55, 0)
    root2.rotation_euler.z = math.radians(-150)                 # stalking toward the camera
    pose(J2, "trot", 0.3)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.2, -5.35, 1.6)
    kit._aim(cam, (0.25, 0.4, 0.55))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = fog_group()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = lin((6, 7, 8)); mix.inputs[7].default_value = lin((34, 34, 32))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    wimg = make_image("hnd_wall", paint_wall())
    wmat = ps1_mat("HND_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.9, 0), (9, 2.9, 0), (9, 2.9, 6.0), (-9, 2.9, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("HND_EnvHole", make_image("hnd_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-2.3, 2.88, 1.0), (-0.9, 2.88, 1.0), (-0.9, 2.88, 2.05), (-2.3, 2.88, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("hnd_wood", paint_wood())
    wm = ps1_mat("HND_EnvWoodM", wood, None, vcol=False)
    for k, (zc, ang) in enumerate(((1.22, 4), (1.53, -3), (1.84, 5))):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                lp[uvl].uv = uv
        pl = kit.mesh_obj(f"Plank{k}", bm, None, smooth=False)
        pl.scale = (1.62, 0.03, 0.17)
        pl.location = (-1.6, 2.83, zc)
        pl.rotation_euler = (0, math.radians(ang), 0)
        kit.assign(pl, wm)
    chalk = ps1_mat("HND_EnvChalk", make_image("hnd_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                    [C((126, 38, 32)), C((160, 52, 42))]])), None, vcol=False)
    strokes = [((0.90 + 0.11 * k, 1.42), (0.92 + 0.11 * k, 1.90)) for k in range(4)] + [((0.82, 1.50), (1.34, 1.80))]
    for k, ((xa, za), (xb, zb)) in enumerate(strokes):
        dd = V((xb - xa, 0, zb - za)); nrm = V((-dd.z, 0, dd.x)).normalized() * 0.022
        bm = bmesh.new()
        vv = [bm.verts.new((p_.x, 2.885, p_.z)) for p_ in (V((xa, 0, za)) - nrm, V((xb, 0, zb)) - nrm,
                                                          V((xb, 0, zb)) + nrm, V((xa, 0, za)) + nrm)]
        bm.faces.new(vv)
        st = kit.mesh_obj(f"Chalk{k}", bm, None, smooth=False)
        kit.assign(st, chalk)
    set_fog((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=10.0, near_f=2.0, far_f=5.0)
    for m in bpy.data.materials:
        a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
        if a:
            k_ = 0.55 if m.name.startswith("HND_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    SNAP.clear()
    snap_register(root); snap_register(root2)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[hound] ingame ->", p)


kit.run(STYLE, build, stage, post,
        meta={"technique": "rigid faceted segments on the game's 19-joint hound rig, hard normals > 30 deg; "
                           "256px page, <= 16-colour CLUT per part, painted light x Cycles-baked AO/facet light, "
                           "glow page for embers + eyes; native 400x300 + composite/CRT post",
              "texture_page": "256x256", "segments": 11})

if "--final" in ARGS or "--ingame" in ARGS:
    ingame(bpy.data.objects["HOUND_root"])
