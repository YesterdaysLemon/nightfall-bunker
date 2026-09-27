# Polygon Ghoul v3 (ps1c): the 1997 32-bit console zombie, rebuilt sharp, and the
# game's in-game zombie model.
#
# v2 (z_ps1b.py) read as bulbous: superellipse "pillow" loft sections, smooth
# shading across whole parts. v3 keeps v2's painting pipeline (one 256px page,
# 16-colour hue-shifted ramps per part, Cycles-baked AO + painted light at ~60%,
# mirrored face block, composite TV post) and rebuilds every shape from angular
# planes (art/STYLE.md):
#   - limbs are 6-sided prisms with tapers and slight twists; pointed deltoid caps,
#     elbow and knee points, a rolled-cuff ledge; hands are mittens: palm block,
#     one claw-bent finger block, a separate thumb;
#   - the torso and pelvis are faceted 10-sided boxes, narrow at the waist, with
#     hunched sloping shoulders and pointed collar flaps;
#   - the head is a faceted box skull: brow ridge, sunken sockets, cheekbone
#     corners, hollow cheeks, a wedge chin, a wedge nose piece and flat ear tabs;
#   - hard normals: every edge sharper than 30 degrees is split, and sharp convex
#     edges get a crisp one-texel painted highlight (creases a dark line).
# The model is built UN-POSED in the game's rig (rest pose, joint-local parts) and
# posed by forward kinematics with three.js joint rotations, so the renders show
# exactly what the game will animate. --export writes public/models/ghoul.json/.png.
#
#   node art/zombies/blend.mjs z_ps1c.py --preview [--views front,side,back] [--face] [--ingame] [--helmet]
#   node art/zombies/blend.mjs z_ps1c.py --export     (game model + texture only, no renders)
#   node art/zombies/blend.mjs z_ps1c.py --final      (heroes, turntable, face, ingame, compare, export)
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree

STYLE = "ps1c"
OUT = os.path.join(kit.OUT_BASE, STYLE)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DBG = os.path.join(OUT, "_d") if os.environ.get("PS1C_DEBUG") else None
EXPORT_DIR = os.path.join(kit.ROOT, "public", "models")
GAME_ID = "ghoul"
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP_DEG = 30.0                            # split normals above this dihedral angle
EDGE_HI, EDGE_LO = 0.30, 0.80               # painted ridge highlight / crease darkening
KEY = V((0.0, -0.42, 0.91)).normalized()    # painted key: a bulb above, slightly in front

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# The world palette from v2 (STYLE.md), plus the steel helmet.
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
    # painted steel helmet: olive drab, a shade greener and greyer than the cloth
    "helmet": ([(24, 28, 26), (36, 42, 36), (50, 57, 46), (66, 73, 56), (84, 91, 68), (108, 114, 86)], 3),
    "steel": ([(34, 34, 36), (70, 70, 68), (112, 110, 102)], 1),
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
    "fing": (224, 64, 32, 16), "thumb": (224, 80, 16, 16), "eyes": (240, 80, 16, 8), "collar": (240, 88, 16, 8),
    "boot": (96, 88, 64, 24), "foot": (160, 88, 64, 24),
    "ear": (0, 96, 16, 16), "nose": (16, 96, 16, 16),
    "thigh.L": (0, 112, 64, 48), "thigh.R": (64, 112, 64, 48),
    "shin.L": (128, 112, 64, 48), "shin.R": (192, 112, 64, 48),
    "uarm.L": (0, 160, 48, 32), "uarm.R": (48, 160, 48, 32),
    "farm.L": (96, 160, 32, 32), "farm.R": (128, 160, 32, 32),
    "helmet": (160, 160, 96, 32),
}
HEAD_FC = 64          # head columns spent on the face quarter (front centre -> ear)

# ---------------------------------------------------------------- the game rig
# three.js space (+Y up, facing +Z, character's left = +X), pos relative to the parent.
JOINTS = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.95, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.55, 0.02)), ("shL", "spine", (0.27, 0.49, 0.0)), ("shR", "spine", (-0.27, 0.49, 0.0)),
    ("elL", "shL", (0.0, -0.33, 0.0)), ("elR", "shR", (0.0, -0.33, 0.0)),
    ("hipL", "hips", (0.1, -0.04, 0.0)), ("hipR", "hips", (-0.1, -0.04, 0.0)),
    ("knL", "hipL", (0.0, -0.46, 0.0)), ("knR", "hipR", (0.0, -0.46, 0.0)),
]
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("cap", "neck"), ("helmet", "neck"),
         ("eyes", "neck"), ("upperArm.L", "shL"), ("upperArm.R", "shR"), ("lowerArm.L", "elL"),
         ("lowerArm.R", "elR"), ("upperLeg.L", "hipL"), ("upperLeg.R", "hipR"), ("lowerLeg.L", "knL"),
         ("lowerLeg.R", "knR")]
C3 = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))      # Blender (Z up, -Y front) -> three.js


def b2t(v):
    return (v[0], v[2], -v[1])


def t2b(v):
    return V((v[0], -v[2], v[1]))


def _rest_world():
    W = {}
    for n, p, pos in JOINTS:
        W[n] = (W[p] if p else V((0, 0, 0))) + t2b(pos)
    return W


JW = _rest_world()                                   # joint world positions in the rest pose (Blender)


def euler3(rx, ry, rz):
    """three.js Euler (order XYZ) as a Blender-space rotation matrix."""
    R = Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(ry, 3, "Y") @ Matrix.Rotation(rz, 3, "Z")
    return (C3.transposed() @ R @ C3).to_4x4()


def fk(pose, body_off=(0.0, 0.0, 0.0)):
    M = {}
    for n, p, pos in JOINTS:
        loc = t2b(pos) + (V(body_off) if n == "body" else V())
        M[n] = (M[p] if p else Matrix.Identity(4)) @ Matrix.Translation(loc) @ euler3(*pose.get(n, (0, 0, 0)))
    return M


# poses as the game would set them (three.js joint rotations)
BAKE_POSE = {"shL": (-1.35, 0, 0), "shR": (-1.35, 0, 0)}
STANCE = {"spine": (0.20, 0.0, 0.03), "neck": (-0.10, -0.20, 0.20),
          "shL": (-1.22, 0.0, 0.12), "shR": (-1.04, 0.0, -0.08), "elL": (-0.18, 0, 0), "elR": (-0.40, 0, 0),
          "hipL": (-0.24, 0, 0.02), "knL": (0.20, 0, 0), "hipR": (0.14, 0, -0.03), "knR": (0.10, 0, 0)}


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
        s.over = []
        s.dither = 0.0

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

    def overlay(s, mask, mat, k):
        """Force a ramp entry on a mask after quantising (light-independent, e.g. eyes)."""
        s.over.append((np.asarray(mask) > 0.5, mat, k))

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
        for mk, mn, k in s.over:
            out[mk] = RAMP_C[mn][k]
        for r, c, mn, k in s.fixes:
            out[r, c] = RAMP_C[mn][k]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[ps1c] WARNING region {s.name} uses {n} colours")
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


def grid_reg(name, mats, sx, sy, seed=0):
    """Reg over a small region in plain UV units scaled to metres (sx, sy)."""
    x0, y0, w, h = REG[name]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg(name, mats, U * sx, Vv * sy, None, sx / w, sy / h, seed)
    r.U, r.V = U, Vv
    return r


# ---------------------------------------------------------------- geometry: profiles

def _push(h, push):
    """push = {k: (out, fwd[, up])}: out moves a right-side vertex away from the
    centre line (its mirror follows), fwd moves it toward the front, up along the part."""
    for k, pv in (push or {}).items():
        h[k][0] -= pv[0]; h[k][1] += pv[1]
        if len(pv) > 2:
            h[k][2] += pv[2]
    return h


def sym(half):
    """Half profile k = 0 (back centre) .. n/2 (front centre) round the character's
    right side (x <= 0, y + = front) -> the full closed ring, mirrored for the left."""
    pts = [list(p) + [0.0] * (3 - len(p)) for p in half]
    for k in range(len(half) - 2, 0, -1):
        p = pts[k]
        pts.append([-p[0], p[1], p[2]])
    return pts


def hexprof(w, d, push=None):
    """Six-sided limb prism: ridges down the front and back, flat inner/outer sides."""
    return sym(_push([[0, -d, 0], [-w, -0.36 * d, 0], [-w, 0.36 * d, 0], [0, d, 0]], push))


def flatprof(w, d, push=None):
    """Flat hexagon (hands): ridge at the back/front centres, flat broad faces."""
    return sym(_push([[0, -d, 0], [-w, -0.45 * d, 0], [-w, 0.45 * d, 0], [0, d, 0]], push))


def boxprof(w, d):
    return [[-w, -d, 0], [-w, d, 0], [w, d, 0], [w, -d, 0]]


def tbox(w, db, df, push=None):
    """Ten-sided faceted box (torso, pelvis): flat back, bevelled shoulder blades,
    flat sides, bevelled chest corners, flat front with a faint sternum ridge."""
    return sym(_push([[0, -db, 0], [-0.62 * w, -0.97 * db, 0], [-w, -0.40 * db, 0], [-w, 0.35 * df, 0],
                      [-0.68 * w, 0.93 * df, 0], [0, df, 0]], push))


def hbox(w, db, df, push=None):
    """Twelve-sided faceted skull ring: flat back, back corners, flat sides, front
    corners (cheekbones), and a face front split at the eye line."""
    return sym(_push([[0, -db, 0], [-0.60 * w, -0.97 * db, 0], [-0.95 * w, -0.50 * db, 0], [-w, 0.02 * df, 0],
                      [-0.90 * w, 0.52 * df, 0], [-0.47 * w, 0.92 * df, 0], [0, df, 0]], push))


def twist(pts, deg):
    a = math.radians(deg); c, s_ = math.cos(a), math.sin(a)
    return [[p[0] * c - p[1] * s_, p[0] * s_ + p[1] * c, p[2]] for p in pts]


def uv_in(reg, x, v):
    x0, y0, w, h = reg
    eps = 0.02
    col = min(max(x * w, eps), w - eps)
    row = min(max((1 - v) * h, eps), h - eps)
    return ((x0 + col) / AT, 1 - (y0 + row) / AT)


def loft(name, cs, profs, fref, reg, caps=(True, True), mirror=None, vs=None, apex=(None, None), cap_u=None):
    """A rigid segment: rings of profile points (x side, y front[, a back along the
    centre line]) round a centre line. UVs wrap round the ring by arc length (or
    mirrored: 0 = front centre, `mirror` = the side vertex, 1 = back centre) and run
    along the segment (v = 1 at the first ring). An end is either open, capped flat
    (a flat colour from the end row) or closed by a fan to an `apex` point (its own
    rows of texels). Faces are smooth; harden() splits the sharp edges."""
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, xs, Ps, Qs = [], [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        rings.append([bm.verts.new(cs[i] + s * p[0] + f * p[1] - t * (p[2] if len(p) > 2 else 0.0))
                      for p in profs[i]])
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
    a0 = V(apex[0]) if apex[0] is not None else None
    a1 = V(apex[1]) if apex[1] is not None else None
    d = [(a0 - cs[0]).length if a0 is not None else 0.0]
    for i in range(1, m):
        d.append(d[-1] + (cs[i] - cs[i - 1]).length)
    tot = d[-1] + ((a1 - cs[-1]).length if a1 is not None else 0.0)
    if vs is None:
        vs = [1 - x / tot for x in d]

    def face(vv, uu, want):
        co = [v.co for v in vv]
        nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
        if nrm.dot(want) < 0:
            vv, uu = vv[::-1], uu[::-1]
        fc = bm.faces.new(vv)
        fc.smooth = True
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
            face(vv, uu, ctr - cm)
    xc = cap_u if cap_u is not None else (0.0 if mirror is not None else 0.5)
    for end, i in ((0, 0), (1, m - 1)):
        ap = a0 if end == 0 else a1
        if ap is not None:
            av = bm.verts.new(ap)
            vend = 1.0 if end == 0 else 0.0
            inner = cs[i] + (cs[1 if end == 0 else m - 2] - cs[i]) * 0.5
            for k in range(n):
                k1 = (k + 1) % n
                vv = [rings[i][k], rings[i][k1], av]
                uu = [(xs[i][k], vs[i]), (xs[i][k + 1], vs[i]), ((xs[i][k] + xs[i][k + 1]) / 2, vend)]
                face(vv, uu, (vv[0].co + vv[1].co + ap) / 3 - inner)
        elif caps[end]:
            uu = [(xc, vs[i] + (-0.02 if end == 0 else 0.02))] * n
            face(rings[i][:], uu, -ts[0] if end == 0 else ts[-1])
    ob = kit.mesh_obj(name, bm, None, smooth=False)
    info = {"v": ([1.0] if a0 is not None else []) + list(vs) + ([0.0] if a1 is not None else []),
            "d": ([0.0] if a0 is not None else []) + d + ([tot] if a1 is not None else []),
            "P": Ps, "Pm": max(Ps), "L": tot, "Q": Qs, "xs": xs}
    return ob, info


def poly_obj(name, polys):
    """A small mesh from explicit polygons: [(points, uvs (region, u, v_top), want_normal)]."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for pts, uvs, want in polys:
        vv = [bm.verts.new(V(p)) for p in pts]
        co = [v.co for v in vv]
        nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
        if nrm.dot(V(want)) < 0:
            vv, uvs = vv[::-1], uvs[::-1]
        fc = bm.faces.new(vv)
        fc.smooth = True
        for lp, (reg, u, vt) in zip(fc.loops, uvs):
            lp[uvl].uv = uv_in(REG[reg], u, 1 - vt)
    return kit.mesh_obj(name, bm, None, smooth=False)


def bvh(ob):
    me = ob.data
    return BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])


def hit_front(tree, x, z, lift=0.0):
    """Surface point seen from the front (-Y) at (x, z), lifted along its normal."""
    loc, nrm, idx, dist = tree.ray_cast(V((x, -2.0, z)), V((0, 1, 0)))
    if loc is None:
        return None, None
    if nrm.y > 0:
        nrm = -nrm
    return loc + nrm * lift, nrm


# ---------------------------------------------------------------- geometry: the parts (rest pose, world)

HEAD_YC = -0.020
# head rings, crown .. under the jaw: (z, y offset, half-width, back, front, pushes {k: (out, fwd[, up])})
HEADR = [
    (1.806, 0.004, 0.050, 0.054, 0.046, {}),
    (1.782, 0.002, 0.086, 0.094, 0.088, {}),
    (1.738, 0.000, 0.098, 0.104, 0.104, {}),                                                   # temples
    (1.708, 0.000, 0.100, 0.104, 0.104, {4: (0, 0.006), 5: (0.004, 0.012), 6: (0, 0.008)}),  # brow ridge
    (1.688, 0.000, 0.097, 0.102, 0.098, {4: (0, -0.006), 5: (-0.004, -0.020), 6: (0, -0.004)}),  # sockets
    (1.652, 0.000, 0.096, 0.098, 0.100, {4: (0.010, 0.012), 5: (0.0, -0.004)}),               # cheekbones
    (1.626, 0.000, 0.090, 0.094, 0.098, {4: (0.004, 0.004), 5: (-0.002, -0.004), 6: (0, 0.002)}),
    (1.604, 0.000, 0.080, 0.088, 0.096, {3: (0, 0, 0.004), 4: (-0.010, -0.010), 5: (-0.004, -0.008),
                                         6: (0, -0.002)}),                                    # hollow cheeks
    (1.574, 0.000, 0.068, 0.078, 0.094, {0: (0, 0, 0.018), 1: (0, 0, 0.018), 2: (0, 0, 0.012), 3: (0, 0, 0.006),
                                         4: (-0.010, -0.012), 5: (-0.008, -0.004), 6: (0, 0.006)}),  # jaw, mouth
    (1.550, 0.000, 0.046, 0.058, 0.082, {0: (0, 0, 0.030), 1: (0, 0, 0.030), 2: (0, 0, 0.022), 3: (0, 0, 0.012),
                                         4: (-0.010, -0.010), 5: (-0.010, 0.004), 6: (0, 0.010)}),   # wedge chin
]
HEAD_ROWS = (3, 9, 21, 30, 37, 50, 59, 67, 79, 88)     # texel rows of the rings (the face gets most)
EYE = (0.040, 1.674)                                   # eye centre (|x|, z)


def build_rest():
    """Every part in the rest pose, in world coordinates (Blender: Z up, facing -Y,
    left = +X). Returns (loft infos for painting, {part name: [objects]})."""
    I, G = {}, {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1)); dn = V((0, 0, -1))

    # ---- head: faceted box skull with mirrored face UVs, wedge nose, ear tabs
    head, I["head"] = loft("head", [(0, HEAD_YC + yo, z) for z, yo, *_ in HEADR],
                           [hbox(w, db, df, p) for z, yo, w, db, df, p in HEADR], fwd, REG["head"],
                           mirror=HEAD_FC / REG["head"][2], vs=[1 - r / REG["head"][3] for r in HEAD_ROWS],
                           apex=((0, HEAD_YC - 0.004, 1.816), (0, HEAD_YC + 0.012, 1.566)))
    yf = lambda f: HEAD_YC - f                         # forward distance -> world y
    top, tip, und = (0, yf(0.095), 1.690), (0, yf(0.129), 1.628), (0, yf(0.101), 1.612)
    nose = []
    for sx in (1, -1):
        base = (sx * 0.017, yf(0.097), 1.617)
        nose.append(([top, tip, base], [("nose", 0.02, 0.0), ("nose", 0.02, 0.8), ("nose", 0.98, 0.8)],
                     (sx, -1, 0.3)))
    nose.append(([(0.017, yf(0.097), 1.617), tip, (-0.017, yf(0.097), 1.617)],
                 [("nose", 0.98, 0.85), ("nose", 0.02, 0.9), ("nose", 0.98, 0.98)], (0, -0.3, -1)))
    nose_ob = poly_obj("nose", nose)
    ears = []
    for sx in (1, -1):
        rt, rb = (sx * 0.095, yf(-0.004), 1.692), (sx * 0.092, yf(-0.010), 1.630)
        tt, tb = (sx * 0.118, yf(-0.028), 1.700), (sx * 0.111, yf(-0.032), 1.640)
        uv = [("ear", 0.02, 0.02), ("ear", 0.98, 0.02), ("ear", 0.98, 0.98), ("ear", 0.02, 0.98)]
        ears.append(([rt, tt, tb, rb], uv, (sx, 0.4, 0)))
        ears.append(([(p[0] - sx * 0.002, p[1], p[2]) for p in (rt, tt, tb, rb)], uv, (-sx, -0.4, 0)))
    ear_ob = poly_obj("ears", ears)
    head_tree = bvh(head)
    G["head"] = [head, nose_ob, ear_ob]

    # ---- eyes: two tiny rhombi over the painted eyes (drawn unlit in the game)
    eyes = []
    for sx in (1, -1):
        loc, n = hit_front(head_tree, sx * EYE[0], EYE[1], 0.0022)
        if loc is None:
            loc, n = V((sx * EYE[0], yf(0.075), EYE[1])), V((0, -1, 0))
        a = V((sx, 0, 0)); a = (a - n * a.dot(n)).normalized()
        b = n.cross(a).normalized()
        if b.z < 0:
            b = -b
        pts = [loc - a * 0.0125, loc - b * 0.0052, loc + a * 0.0125, loc + b * 0.0052]
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        eyes.append((pts, [("eyes", u(0.02), 0.5), ("eyes", 0.5, 0.98), ("eyes", u(0.98), 0.5), ("eyes", 0.5, 0.02)],
                     tuple(n)))
    G["eyes"] = [poly_obj("eyes", eyes)]

    # ---- garrison cap: a folded boat, crisp crown crease and curtain step, tipped right
    CAP = [(-0.140, 1.748, 0.026, 0.036), (-0.114, 1.754, 0.080, 0.090), (-0.020, 1.768, 0.084, 0.062),
           (0.072, 1.760, 0.080, 0.084), (0.100, 1.752, 0.026, 0.040)]

    def cprof(w, h):
        return [[-w, 0, 0], [-1.03 * w, 0.45 * h, 0], [-0.86 * w, 0.49 * h, 0], [0, h, 0],
                [0.86 * w, 0.49 * h, 0], [1.03 * w, 0.45 * h, 0], [w, 0, 0]]
    cap, I["cap"] = loft("cap", [(0.0, y, z) for y, z, w, h in CAP], [cprof(w, h) for y, z, w, h in CAP],
                         up, REG["cap"])
    cap.data.transform(Matrix.Translation((-0.010, 0, 1.760)) @ Matrix.Rotation(math.radians(-10), 4, "Y")
                       @ Matrix.Translation((0, 0, -1.760)))
    G["cap"] = [cap]

    # ---- steel helmet: 8-sided dome, flared brim lower at the back, underside
    hyc = HEAD_YC + 0.004
    zr = lambda ph: 1.690 - 0.022 * math.cos(ph)               # rim height: back 1.668 .. front 1.712

    def octr(rx, ry, zf, zn):
        return [[-rx * math.sin(ph), -ry * math.cos(ph), zf(ph) - zn]
                for ph in (math.pi * (k / 4 + 1 / 8) for k in range(8))]
    HR = [(1.822, 0.098, 0.108, lambda ph: 1.822 + 0.3 * (zr(ph) - 1.690)),
          (1.770, 0.138, 0.150, lambda ph: 1.770 + 0.6 * (zr(ph) - 1.690)),
          (1.708, 0.140, 0.153, lambda ph: zr(ph) + 0.018),
          (1.690, 0.157, 0.171, zr)]
    hd = [0.024, 0.076, 0.138, 0.156]
    hv = [0.16 + 0.84 * (1 - x / hd[-1]) for x in hd]
    helm, I["helmet"] = loft("helmet", [(0, hyc, zn) for zn, *_ in HR], [octr(rx, ry, zf, zn) for zn, rx, ry, zf in HR],
                             fwd, REG["helmet"], caps=(False, False), vs=hv, apex=((0, hyc, 1.846), None))
    under = []
    ring = lambda rx, ry, dz: [(-rx * math.sin(ph), hyc - ry * math.cos(ph), zr(ph) + dz)
                               for ph in (math.pi * (k / 4 + 1 / 8) for k in range(8))]
    o, i_ = ring(0.157, 0.171, 0.0), ring(0.134, 0.147, 0.010)
    for k in range(8):
        k1 = (k + 1) % 8
        u0, u1 = k / 8, (k + 1) / 8
        under.append(([o[k], o[k1], i_[k1], i_[k]], [("helmet", u0, 0.90), ("helmet", u1, 0.90),
                                                      ("helmet", u1, 0.98), ("helmet", u0, 0.98)], (0, 0, -1)))
    G["helmet"] = [helm, poly_obj("helmet_under", under)]

    # ---- torso: faceted box, hunched sloping shoulders, narrow waist; neck; collar flaps
    TORSO = [(1.538, 0.012, 0.100, 0.070, 0.062, {}),
             (1.500, 0.012, 0.218, 0.112, 0.100, {1: (0, -0.012), 2: (0, 0, -0.012), 3: (0, 0, -0.014)}),
             (1.392, 0.000, 0.214, 0.122, 0.124, {1: (0, -0.010)}),
             (1.250, 0.000, 0.186, 0.110, 0.114, {}),
             (1.100, 0.004, 0.156, 0.098, 0.100, {}),
             (0.990, 0.004, 0.164, 0.100, 0.104, {})]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO],
                             [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO], fwd, REG["torso"], (True, False),
                             cap_u=0.27)
    neck, I["neck"] = loft("neck", [(0, 0.004, 1.470), (0, -0.014, 1.612)],
                           [hexprof(0.054, 0.056, {3: (0, 0.004)}), hexprof(0.049, 0.051, {3: (0, 0.004)})],
                           fwd, REG["neck"], (False, False))
    tt = bvh(torso)
    flaps = []
    for sx in (1, -1):
        a, _ = hit_front(tt, sx * 0.030, 1.508, 0.004)
        b, _ = hit_front(tt, sx * 0.092, 1.486, 0.004)
        c, nc = hit_front(tt, sx * 0.058, 1.418, 0.010)
        if a is None or b is None or c is None:
            continue
        flaps.append(([a, b, c], [("collar", 0.02, 0.02), ("collar", 0.98, 0.02), ("collar", 0.5, 0.98)],
                      tuple(nc)))
    G["torso"] = [torso, neck] + ([poly_obj("collar", flaps)] if flaps else [])

    # ---- pelvis: belt band and a faceted seat
    PEL = [(1.062, 0.004, 0.172, 0.104, 0.108), (1.004, 0.004, 0.176, 0.106, 0.110),
           (0.925, 0.006, 0.192, 0.124, 0.116), (0.815, 0.004, 0.160, 0.104, 0.098)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL],
                               [tbox(w, db, df) for z, yc, w, db, df in PEL], fwd, REG["pelvis"], (False, True))
    G["pelvis"] = [pelvis]

    for sd, sx in (("L", 1), ("R", -1)):
        L = sd == "L"
        # ---- upper arm: sleeve prism, pointed deltoid cap, rolled-cuff ledge above the elbow
        ARM_IN = V((-sx * 0.025, 0, 0))                                   # geometry sits inside the wide rig shoulder
        sh = JW["sh" + sd] + ARM_IN
        UA = [(0.004, 0.068, 0.068, sx * 0.010, 0), (-0.075, 0.066, 0.066, sx * 0.004, 4),
              (-0.225, 0.054, 0.057, 0.0, 8), (-0.232, 0.063, 0.063, 0.0, 9), (-0.300, 0.061, 0.061, 0.0, 11)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d, dx, tw in UA],
                                   [twist(hexprof(w, d), sx * tw) for z, w, d, dx, tw in UA], fwd, REG["uarm." + sd],
                                   (False, True), apex=(sh + V((sx * 0.036, 0.004, 0.040)), None))
        G["upperArm." + sd] = [ua]

        # ---- forearm (pointed elbow, long, flat at the wrist) and the mitten hand
        el = JW["el" + sd] + ARM_IN
        p_ = math.radians(20)                                            # hanging hand pronated a little
        n = V((-sx * math.cos(p_), math.sin(p_), 0))                     # palm normal (inward, a bit back)
        td = V((-sx * math.sin(p_), -math.cos(p_), 0))                   # thumb side (front)
        bk = -n                                                          # back of the hand
        wr = el + V((0, 0, -0.240))
        FA = [(0.045, 0.050, 0.052, {}), (-0.005, 0.055, 0.054, {0: (0, -0.030)}), (-0.075, 0.056, 0.058, {}),
              (-0.232, 0.023, 0.037, {})]
        fr = [fwd, fwd, (fwd + td).normalized(), td]
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d, p), sx * 6 * k) for k, (z, w, d, p) in enumerate(FA)], fr,
                                   REG["farm." + sd], (False, False))
        palm, I["palm"] = loft("palm." + sd, [wr + dn * -0.012, wr + dn * 0.046, wr + dn * 0.090],
                               [flatprof(0.032, 0.016), flatprof(0.044, 0.019), flatprof(0.046, 0.017, {3: (0, 0.004)})],
                               bk, REG["palm"], (False, True))
        k0 = wr + dn * 0.086
        a1 = (dn * math.cos(math.radians(25)) + n * math.sin(math.radians(25))).normalized()
        a2 = (dn * math.cos(math.radians(78)) + n * math.sin(math.radians(78))).normalized()
        k1 = k0 + a1 * 0.050; k2 = k1 + a2 * 0.042
        fb = lambda al: (bk * math.cos(math.radians(al)) + dn * math.sin(math.radians(al))).normalized()
        fing, I["fing"] = loft("fing." + sd, [k0, k1, k2],
                               [flatprof(0.045, 0.0125, {3: (0, 0.004)}), flatprof(0.043, 0.011), flatprof(0.036, 0.009)],
                               [fb(12), fb(50), fb(78)], REG["fing"], (False, True))
        tb = wr + dn * 0.018 + td * 0.028 + n * 0.006
        t1 = (dn * 0.55 + td * 0.55 + n * 0.45).normalized()
        t2 = (dn * 0.50 + n * 0.80 + td * 0.10).normalized()
        th, I["thumb"] = loft("thumb." + sd, [tb, tb + t1 * 0.034, tb + t1 * 0.034 + t2 * 0.030],
                              [boxprof(0.0115, 0.0100), boxprof(0.0105, 0.0092), boxprof(0.0085, 0.0075)],
                              bk, REG["thumb"], (False, True))
        G["lowerArm." + sd] = [fa, palm, fing, th]

        # ---- thigh: pressed trouser prism (front crease), knee point
        hp = JW["hip" + sd]
        TG = [(0.060, 0.096, 0.108, {}, 0), (-0.280, 0.088, 0.096, {}, 4),
              (-0.452, 0.078, 0.084, {3: (0, 0.018)}, 6), (-0.490, 0.072, 0.076, {}, 6)]
        tg, I["thigh." + sd] = loft("thigh." + sd, [hp + V((0, 0, z)) for z, *_ in TG],
                                    [twist(hexprof(w, d, p), -sx * tw) for z, w, d, p, tw in TG], fwd,
                                    REG["thigh." + sd], (False, True))
        G["upperLeg." + sd] = [tg]

        # ---- shin with the trousers bloused over the boot, boot shaft, blocky foot with a sharp toe
        kn = JW["kn" + sd]
        SN = [(0.040, 0.072, 0.078, {}), (-0.110, 0.074, 0.084, {0: (0, -0.010)}), (-0.222, 0.090, 0.096, {}),
              (-0.262, 0.074, 0.080, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN],
                                   [hexprof(w, d, p) for z, w, d, p in SN], fwd, REG["shin." + sd], (False, True))
        xf = kn.x + sx * 0.006
        bt, I["boot"] = loft("boot." + sd, [(xf, 0.004, 0.235), (xf, 0.004, 0.070)],
                             [hexprof(0.060, 0.066), hexprof(0.064, 0.072)], fwd, REG["boot"], (False, False))
        a = math.radians(8) * sx
        fd = V((math.sin(a), -math.cos(a), 0))
        h0 = V((xf, 0.075, 0.0))
        FT = [(0.000, 0.048, 0.080), (0.070, 0.056, 0.112), (0.165, 0.062, 0.086), (0.235, 0.062, 0.060)]

        def fprof(w, top):
            return sym([[0, -0.04, 0], [-w, -0.04, 0], [-1.06 * w, -0.018, 0], [-0.72 * w, top - 0.04, 0],
                        [0, top - 0.035, 0]])
        ft, I["foot"] = loft("foot." + sd, [h0 + fd * s + V((0, 0, 0.04)) for s, w, top in FT],
                             [fprof(w, top) for s, w, top in FT], up, REG["foot"], (True, False),
                             apex=(None, h0 + fd * 0.290 + V((0, 0, 0.026))))
        G["lowerLeg." + sd] = [sn, bt, ft]
    return I, G


def harden(ob, deg=SHARP_DEG):
    """Split normals on every edge sharper than `deg` (smooth within flat-ish runs)."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    lim = math.radians(deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0.0) <= lim
    bm.to_mesh(me); bm.free()
    me.update()


def rig_part(name, objs, joint, root):
    ob = kit.join(objs) if len(objs) > 1 else objs[0]
    ob.name = name; ob.data.name = name
    ob.data.transform(Matrix.Translation(-JW[joint]))
    ob.parent = root
    ob["joint"] = joint
    return ob


def apply_pose(objs, pose, body_off=(0, 0, 0), aside=None):
    M = fk(pose, body_off)
    for ob in objs:
        ob.matrix_basis = M[ob["joint"]]
        if aside and ob.name in aside:
            ob.matrix_basis = Matrix.Translation(aside[ob.name]) @ ob.matrix_basis
    bpy.context.view_layer.update()


def vertex_tint(ob, part):
    """Per-corner colour, multiplied into the texture: darker lower legs and
    fingertips, occlusion under the jaw, a cool lean in the dark. Uses the rest pose."""
    me = ob.data
    jw = JW[ob["joint"]]
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    cn = me.corner_normals
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co + jw
            nz = cn[li].vector.z
            f = 0.82 + 0.18 * smooth01((co.z - 0.05) / 0.85)
            f *= 0.93 + 0.07 * (0.5 + 0.5 * nz)
            if part.startswith("lowerArm") and co.z < 0.93:
                f *= 0.90 + 0.10 * smooth01((co.z - 0.75) / 0.18)
            if part == "head" and co.z < 1.572 and nz < 0.3:
                f *= 0.84
            cols[li] = (f ** 1.08, f ** 1.04, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    return ca


# ---------------------------------------------------------------- baked light, edge light

def bake_maps(objs):
    """Cycles bakes AO, object-space normals (hard, per facet) and object-space
    positions onto the page. The painted light: a top-front key, sky, a warm bounce
    from below and a faint back rim, occluded. Positions let the face be painted
    in 3D (features land on the geometry, whatever the UV stretch)."""
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
    mats = {}
    for kind in ("diffuse", "pos"):
        mat = bpy.data.materials.new("Bake_" + kind)
        nd = kit.Nodes(mat)
        out = nd.new("ShaderNodeOutputMaterial")
        if kind == "diffuse":
            sh = nd.new("ShaderNodeBsdfDiffuse", Color=(0.5, 0.5, 0.5, 1))
            nd.link(sh, "BSDF", out, "Surface")
        else:
            tc = nd.new("ShaderNodeTexCoord")
            vm = nd.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY_ADD"
            vm.inputs[1].default_value = (0.5, 0.5, 0.5); vm.inputs[2].default_value = (0.5, 0.5, 0.5)
            mat.node_tree.links.new(tc.outputs["Object"], vm.inputs[0])
            em = nd.new("ShaderNodeEmission")
            mat.node_tree.links.new(vm.outputs[0], em.inputs["Color"])
            nd.link(em, "Emission", out, "Surface")
        mats[kind] = (mat, nd.new("ShaderNodeTexImage"))
    res = {}
    for kind in ("AO", "NORMAL", "POS"):
        mat, tex = mats["pos" if kind == "POS" else "diffuse"]
        for o in objs:
            kit.assign(o, mat)
        img = bpy.data.images.new("bake_" + kind, AT, AT, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        tex.image = img
        mat.node_tree.nodes.active = tex
        kit.activate(objs[0])
        for o in objs:
            o.select_set(True)
        if kind == "AO":
            bpy.ops.object.bake(type="AO", margin=4, use_clear=True)
        elif kind == "NORMAL":
            bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=4, use_clear=True)
        else:
            bpy.ops.object.bake(type="EMIT", margin=4, use_clear=True)
        px = np.empty(AT * AT * 4, np.float32)
        img.pixels.foreach_get(px)
        res[kind] = px.reshape(AT, AT, 4)[::-1, :, :3].astype(np.float64)
    bpy.data.objects.remove(ground)
    nrm = res["NORMAL"] * 2 - 1
    nrm /= np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    ao = np.clip(res["AO"][..., 0], 0, 1)
    key = np.array(KEY)
    rim = np.array([0.0, 0.7, 0.7]); rim /= np.linalg.norm(rim)
    bnc = np.array([0.0, -0.30, -0.95]); bnc /= np.linalg.norm(bnc)
    dk = np.clip(nrm @ key, 0, 1); dr = np.clip(nrm @ rim, 0, 1); db = np.clip(nrm @ bnc, 0, 1)
    sky = 0.5 + 0.5 * nrm[..., 2]
    light = 1.10 * (ao ** 0.7 * (0.50 + 0.10 * sky) + 0.36 * dk * ao ** 0.4 + 0.07 * db * ao ** 0.4
                    + 0.08 * dr * ao ** 0.4)
    pos = res["POS"] * 2 - 1
    if DBG:
        os.makedirs(DBG, exist_ok=True)
        save_png(os.path.join(DBG, "bake_ao.png"), np.repeat(ao[..., None], 3, 2))
        save_png(os.path.join(DBG, "bake_normal.png"), res["NORMAL"])
        save_png(os.path.join(DBG, "bake_light.png"), np.repeat(np.clip(light / 1.3, 0, 1)[..., None], 3, 2))
    print("[ps1c] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
    return light, pos


def edge_light(objs):
    """A factor map: sharp convex edges get a crisp one-texel highlight on both
    facets (stronger the more the ridge faces the key light), concave sharp edges
    (creases) a dark line. Computed from the rest-pose geometry and its UVs."""
    fac = np.ones((AT, AT))
    for ob in objs:
        me = ob.data
        uvd = me.uv_layers.active.data
        sharp = np.zeros(len(me.edges), bool)
        att = me.attributes.get("sharp_edge")
        if att:
            att.data.foreach_get("value", sharp)
        ek = {tuple(sorted(e.vertices)): i for i, e in enumerate(me.edges)}
        side = {}
        for p in me.polygons:
            li = list(p.loop_indices)
            for a, b in zip(li, li[1:] + li[:1]):
                e = ek[tuple(sorted((me.loops[a].vertex_index, me.loops[b].vertex_index)))]
                side.setdefault(e, []).append((p.index, uvd[a].uv.copy(), uvd[b].uv.copy()))
        for e, lst in side.items():
            if len(lst) != 2 or not sharp[e]:
                continue
            (p1, *_), (p2, *_) = lst
            P1, P2 = me.polygons[p1], me.polygons[p2]
            convex = (P2.center - P1.center).dot(P1.normal) < 0
            if convex:
                f = 1.0 + EDGE_HI * max(0.0, (P1.normal + P2.normal).normalized().dot(KEY)) ** 0.8
                if f < 1.04:
                    continue
            else:
                f = EDGE_LO
            for pi, u0, u1 in lst:
                cu = sum((uvd[l].uv for l in me.polygons[pi].loop_indices), V((0, 0))) / me.polygons[pi].loop_total
                a = np.array([u0.x * AT, (1 - u0.y) * AT]); b = np.array([u1.x * AT, (1 - u1.y) * AT])
                c = np.array([cu.x * AT, (1 - cu.y) * AT])
                ln = np.linalg.norm(b - a)
                if ln < 0.6:
                    continue
                mid = (a + b) / 2
                inw = c - mid
                inw = inw / max(1e-6, np.linalg.norm(inw)) * 0.45
                for t in np.linspace(0, 1, int(ln * 2) + 2):
                    q = a + (b - a) * t + inw
                    ix, iy = int(q[0]), int(q[1])
                    if 0 <= ix < AT and 0 <= iy < AT:
                        fac[iy, ix] = max(fac[iy, ix], f) if f > 1 else min(fac[iy, ix], f)
    return fac


# ---------------------------------------------------------------- texture painting

def paint_face(name, Ph, seed):
    """Face and head painted in 3D from the baked positions: |x| across, z up,
    F forward of the head's centre line (mirrored UVs share texels)."""
    ax = np.abs(Ph[..., 0]); Z = Ph[..., 2]; F = HEAD_YC - Ph[..., 1]
    front = F > 0.035
    Xf = np.where(front, ax, 9.0)
    phi = np.arctan2(ax, F)                        # 0 front centre .. pi back centre
    r = Reg(name, ["skin", "livid2", "hair", "blood"], Xf, 1.8 - Z, None, 0.002, 0.0027, seed=seed)
    zz = lambda z: 1.8 - z
    E = lambda x0_, z0, rx, rz: np.sqrt(((Xf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    EX, EZ = EYE
    # sunken sockets: darkest up under the brow
    sock = E(EX, EZ + 0.004, 0.029, 0.0200) + 0.10 * r.nz
    r.lit(soft(sock, 0.5) * np.clip(0.55 + (Z - EZ) / 0.025, 0.45, 1), 0.40)
    r.lit((Z > 1.710) & (Z < 1.760) & front, 0.88)
    r.lit(((Z > 1.710) & (Z < 1.760)) * np.clip(0.3 + Xf / 0.05, 0, 1), 0.80)   # forehead darkens to the temples
    r.clusters(2.2, 0.35, f=0.84, where=(Z > 1.708) & (Z < 1.750) & front, seed=9)
    r.lit((E(0.012, EZ + 0.006, 0.008, 0.012) < 1), 0.8)                   # inner corner by the bridge
    # milky eyes: a pale almond, grey pupil, a raw lower lid, one catch light (light-independent)
    eye = E(EX, EZ, 0.0125, 0.0056) < 1
    r.put(eye, "skin")
    r.overlay(eye, "skin", 7)
    r.overlay(eye & (Z > EZ + 0.0030), "skin", 6)                          # upper-lid shadow on the eyeball
    r.overlay(E(EX + 0.001, EZ - 0.0008, 0.0042, 0.0040) < 1, "skin", 5)   # pupil
    lid = (E(EX + 0.001, EZ - 0.0064, 0.0125, 0.0026) < 1) & ~eye
    r.put(lid, "livid2"); r.lit(lid, 0.95)
    r.lit(E(EX + 0.003, EZ - 0.0140, 0.020, 0.0034) < 1, 0.72)             # eye bag crease
    r.eye = eye
    # nose piece: nostrils and the shadow it casts
    nos = E(0.0085, 1.6158, 0.0045, 0.0030) < 1
    r.put(nos & (F > 0.095), "livid2"); r.lit(nos & (F > 0.095), 0.42)
    r.lit((E(0.0, 1.609, 0.020, 0.0045) < 1) & (F < 0.103), 0.6)
    # hollow cheeks and dragged smile lines
    r.lit(soft(E(0.066, 1.608, 0.026, 0.016), 0.6), 0.78)
    r.line([(0.022, zz(1.617)), (0.034, zz(1.592))], 0.0026, f=0.7)
    for z in (1.716, 1.725, 1.733):                                         # forehead wrinkles
        r.line([(0.008, zz(z)), (0.050, zz(z + 0.002))], 0.0016, f=0.72)
        r.line([(0.008, zz(z + 0.003)), (0.050, zz(z + 0.005))], 0.0012, f=1.12)
    # jaw shadow and the underside of the chin
    r.lit(np.clip((1.566 - Z) / 0.010, 0, 1) * front, 0.66)
    r.clusters(2.5, 0.45, f=0.93, where=(Z < 1.604) & (Xf > 0.03) & (Xf < 0.09), seed=3)   # stubble
    # the mouth hanging open: thin livid lips, a dark bloody maw, a few yellow teeth
    up_lip = E(0.0, 1.5985, 0.026, 0.0028) < 1
    r.put(up_lip, "livid2"); r.lit(up_lip, 1.0)
    lo_lip = E(0.0, 1.5790, 0.024, 0.0030) < 1
    r.put(lo_lip, "livid2"); r.lit(lo_lip, 1.15)
    maw = E(0.0, 1.5885, 0.023, 0.0085) < 1
    r.put(maw, "blood"); r.lit(maw, 0.24)
    teeth = (Xf < 0.018) & (Z > 1.5918) & (Z < 1.5966)
    r.put(teeth, "skin"); r.overlay(teeth, "skin", 5)
    for k in range(1, 4):
        r.overlay(teeth & (np.abs(Xf - 0.0058 * k + 0.0015) < 0.0011), "skin", 3)
    low = (Xf > 0.004) & (Xf < 0.016) & (Z > 1.5820) & (Z < 1.5850)
    r.put(low, "skin"); r.overlay(low, "skin", 4)
    # blood from the mouth over the chin
    chin = E(0.0, 1.567, 0.022, 0.012) + 0.35 * r.nz
    r.put((chin < 1) & ~lo_lip, "blood")
    r.lit((chin < 0.6), 0.8)
    for x_, z_, n_, w_ in ((0.0, 1.578, 0.030, 0.0026), (0.011, 1.578, 0.024, 0.0018), (0.023, 1.583, 0.022, 0.0018),
                           (0.028, 1.590, 0.016, 0.0016)):
        r.drip(x_, zz(z_), n_, w=w_, mat="blood")
    r.put((E(0.026, 1.5885, 0.005, 0.006) < 1), "blood")                  # mouth corners
    r.clusters(1.8, 0.5, f=1.35, where=(chin < 0.9), seed=5)                # wet sheen
    # short back and sides: hair up top, clipped stubble round the sides and back
    zh = np.where(phi < 0.55, 1.740 + 0.012 * np.clip(phi / 0.55, 0, 1) ** 2 - 0.004 * (phi < 0.12),
                  np.where(phi < 1.25, 1.752 - (phi - 0.55) * 0.06, 1.708))
    zh = zh - 0.010 * np.clip(1 - ax / 0.018, 0, 1) * (phi < 0.5)          # widow's peak
    hair = Z > zh + 0.006 * r.nz
    r.put(hair, "hair")
    r.lit(hair * np.clip((Z - zh) / 0.035, 0, 1), 1.25)
    r.clusters(4, 0.3, f=1.25, where=hair, seed=12)                         # combed clumps
    r.clusters(3.5, 0.4, f=0.75, where=hair, seed=13)
    burn = (phi > 1.22) & (phi < 1.48) & (Z > 1.672) & ~hair               # sideburns
    r.put(burn, "hair")
    clip = (phi > 1.25) & (Z > 1.600) & ~hair & ~burn
    r.lit(clip * np.clip((Z - 1.600) / 0.04, 0.3, 1), 0.72)
    r.put(clip & (Z > zh - 0.010), "hair")
    # blood spatter, corpse mottling
    for (px, pz) in ((0.058, 1.640), (0.050, 1.650), (0.070, 1.700)):
        r.blob(px, zz(pz), 0.0024, 0.0024, "blood", rough=0.0)
    r.clusters(3, 0.45, f=0.9, where=~hair & ~eye & ~teeth, seed=7)
    r.clusters(5, 0.6, f=0.86, where=(phi > 0.9) & ~hair, seed=8)
    return r


def paint_ear():
    r = grid_reg("ear", ["skin", "livid2", "blood"], 0.024, 0.065, 17)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.95)
    r.lit(ell(U, Vv, 0.42, 0.5, 0.30, 0.34) < 1, 0.72)                      # bowl
    r.lit(ell(U, Vv, 0.40, 0.55, 0.14, 0.16) < 1, 0.66)
    r.lit(U > 0.8, 1.18)                                                     # rim
    r.put(ell(U, Vv, 0.55, 0.82, 0.14, 0.10) < 1, "livid2")                  # lobe
    r.blob(0.012, 0.03, 0.004, 0.006, "blood", 0.9)
    return r


def paint_cap(I):
    info = I["cap"]
    r = loft_reg("cap", info, ["cap", "metal", "bloodc2"], 101)
    X, Y, P = r.X, r.Y, r.P
    U = X / P + 0.5
    st = info["xs"][1]                     # u of the profile stations on the front-peak ring
    under = U > st[6]
    r.lit(under, 0.40)
    for u_ in (0.0, st[6], 1.0):                                  # piping on the rim
        r.lit(np.abs(U - u_) < 0.016, 0.62)
    for k, s_ in ((2, 1), (4, -1)):                               # curtain seam under the step
        r.lit(np.abs(U - st[k] - s_ * 0.012) < 0.012, 0.6)
    r.lit(np.abs(U - st[3]) < 0.012, 0.66)                        # crown crease
    r.lit(np.clip(1 - Y / 0.03, 0, 1) + np.clip((Y - r.Y.max() + 0.03) / 0.03, 0, 1), 0.84)
    pin = (np.abs(U - (st[0] + st[1]) / 2) < 0.03) & (Y > 0.04) & (Y < 0.062)   # enamel pin, left curtain
    r.put(pin, "metal"); r.lit(pin & (Y > 0.052), 0.5)
    r.clusters(3, 0.45, f=0.84, where=~under, seed=2)
    r.clusters(3, 0.62, f=1.12, where=~under, seed=4)
    r.blob(-0.05, 0.19, 0.012, 0.01, "bloodc2", 0.9)
    return r


def paint_helmet(I):
    info = I["helmet"]
    r = loft_reg("helmet", info, ["helmet", "steel", "khaki", "bloodc2"], 103)
    X, Y, P = r.X, r.Y, r.P
    x0, y0, w, h = REG["helmet"]
    row = (np.arange(h)[:, None] + 0.5) * np.ones((1, w))
    rim_row = (1 - info["v"][-1]) * h
    Lt = info["d"][-1]
    phi = (X / P) * 2 * np.pi + np.pi * (1 + 1 / 8)                  # 0 back .. pi front
    under = row > rim_row + 0.5
    r.lit(under, 0.42)
    r.lit((Y > Lt - 0.020) & ~under, 0.92)                           # brim
    r.lit(np.abs(Y - (Lt - 0.019)) < 0.004, 0.72)                    # brim fold line
    rim = (Y > Lt - 0.005) & ~under
    r.put(rim & (r.nz > 0.1), "steel")                              # chipped rim edge
    r.clusters(4, 0.50, f=0.90, where=~under, seed=5)               # worn paint
    r.clusters(4, 0.70, f=1.08, where=~under & (Y < Lt - 0.03), seed=6)
    r.clusters(1.6, 0.80, mat="steel", where=~under, seed=7)        # chips
    for k in range(3):                                              # scratches
        x_ = -0.10 + 0.09 * k
        r.line([(x_, 0.05 + 0.01 * k), (x_ + 0.03, 0.09 + 0.01 * k)], 0.6 * r.tx, "steel", 1.2)
    strap = (np.abs(np.cos(phi)) > 0.93) & (np.cos(phi) > 0) & (Y > Lt - 0.03) & ~under   # strap over the back brim
    r.put(strap, "khaki"); r.lit(strap, 0.9)
    r.splat(0.12, 0.06, 0.018, "bloodc2", drips=2)
    return r


def paint_neck(I):
    r = loft_reg("neck", I["neck"], ["skin", "livid", "blood"], 13)
    X, Y = r.X, r.Y
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.05)) / 0.05, 0, 1), 0.55)          # under the jaw
    r.lit(np.clip(1 - Y / 0.025, 0, 1), 0.7)                        # collar shadow
    for sg in (-1, 1):                                              # neck tendons
        r.line([(sg * 0.034, top - 0.01), (sg * 0.008, 0.012)], 0.004, f=1.18)
        r.line([(sg * 0.044, top - 0.01), (sg * 0.016, 0.012)], 0.003, f=0.8)
    r.blob(0.075, 0.07, 0.022, 0.018, "livid", 1.1, rough=0.3)     # bite wound
    r.blob(0.075, 0.07, 0.014, 0.012, "blood", 0.9, rough=0.3)
    r.blob(0.075, 0.07, 0.006, 0.006, "blood", 0.3, rough=0.2)
    r.drip(0.072, 0.075, 0.05, mat="blood"); r.drip(0.08, 0.075, 0.035, mat="blood")
    for x, n_ in ((0.0, 0.10), (-0.01, 0.07), (0.012, 0.09), (0.022, 0.05)):   # chin blood running down
        r.line([(x, top - n_), (x, top)], 0.0035, "blood")
        r.blob(x, top - n_, 0.004, 0.005, "blood", rough=0.0)
    return r


def paint_collar():
    r = grid_reg("collar", ["shirt", "bloodc"], 0.06, 0.07, 19)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.14)
    r.lit((Vv < 0.14) | (np.abs(U - 0.5) > 0.40 - 0.35 * Vv), 0.8)      # stitched edge
    r.blob(0.02, 0.05, 0.008, 0.01, "bloodc", 0.9)
    return r


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["shirt", "khaki", "metal1", "skin3", "bloodc"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    # open collar: a V of skin and its shadow (the collar points are geometry)
    vd = 0.118
    vw = 0.050 * np.clip(1 - Y / vd, 0, 1)
    vee = (ax < vw) & (Y < vd)
    r.put(vee, "skin3")
    r.lit(vee * np.clip(1 - Y / 0.06, 0, 1), 0.55)
    r.lit(vee & (ax > vw - 1.1 * tx), 0.62)
    r.lit((Y < 0.02) & ~vee, 1.12)                                  # collar band round the neck
    # placket and bone buttons
    pl = Y > vd
    r.lit(pl & (ax < 0.55 * tx), 0.66)
    r.lit(pl & (X > 0.6 * tx) & (X < 1.7 * tx), 1.15)
    for by in (0.165, 0.245, 0.325, 0.405):
        r.put(ell(X, Y, 0.3 * tx, by, 0.0085, 0.0075) < 1, "khaki")
        r.lit(ell(X, Y, 0.3 * tx, by + 0.011, 0.009, 0.0035) < 1, 0.6)
    # chest pockets with buttoned flaps
    for sg in (-1, 1):
        cx = sg * 0.100
        d = np.abs(X - cx)
        pk = (d < 0.036) & (Y > 0.14) & (Y < 0.238)
        r.lit(pk & ~((d < 0.036 - tx) & (Y > 0.14 + ty) & (Y < 0.238 - ty)), 0.66)
        r.lit(pk & (Y > 0.206), 0.9)
        r.lit((d < 0.038) & (Y > 0.137) & (Y < 0.167), 1.2)
        r.lit((d < 0.038) & (Y >= 0.167) & (Y < 0.167 + 1.3 * ty), 0.52)
        r.put(ell(X, Y, cx, 0.158, 0.007, 0.0065) < 1, "khaki")
    # armpit folds and the shirt bloused over the belt
    for sg in (-1, 1):
        sx0 = sg * r.P / 4
        r.blob(sx0, 0.14, 0.035, 0.045, None, 0.88, rough=0.3)
        for (a0, a1) in (((-0.03, 0.12), (-0.09, 0.21)), ((0.0, 0.13), (-0.01, 0.26)), ((0.03, 0.12), (0.08, 0.22))):
            r.fold((sx0 + sg * a0[0], a0[1]), (sx0 + sg * a1[0], a1[1]), off=(sg * 1.3 * tx, 0))
    Lt = Y.max()
    bl = np.clip((Y - (Lt - 0.11)) / 0.05, 0, 1) * np.clip((Lt - 0.005 - Y) / 0.02, 0, 1)
    ph = 2 * np.pi * X / 0.058 + 1.3 * np.sin(X * 23.0)
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.2)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.74)
    r.lit(np.clip((Y - (Lt - 0.035)) / 0.02, 0, 1), 0.7)
    for (p0, p1) in (((-0.05, 0.31), (-0.02, 0.37)), ((0.05, 0.34), (0.03, 0.41)), ((0.18, 0.27), (0.13, 0.34))):
        r.fold(p0, p1)
    # suspenders: straight down the front ...
    for sg in (-1, 1):
        cx = sg * 0.084
        e_ = (X - cx) * sg
        st = (np.abs(X - cx) < 0.0165)
        r.put(st, "khaki")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.62)
        r.lit(st & (e_ < -0.0165 + 1.1 * tx), 1.2)
        r.lit((e_ >= 0.0165) & (e_ < 0.0165 + 1.4 * tx) & (Y > 0.03), 0.66)
        bk = (np.abs(X - cx) < 0.021) & (np.abs(Y - 0.282) < 0.013)
        r.put(bk, "metal1")
        r.put((np.abs(X - cx) < 0.012) & (np.abs(Y - 0.282) < 0.006), "khaki")
        r.lit((np.abs(X - cx) < 0.012) & (np.abs(Y - 0.282) < 0.006), 0.55)
        r.lit((np.abs(X - cx) < 0.022) & (Y > 0.295) & (Y < 0.295 + 1.3 * ty), 0.5)
    # ... and crossed in an X on the back, with a patch at the cross
    for sg in (-1, 1):
        bc = sg * 0.085 * (1 - Y / 0.28)
        e_ = (B - bc) * sg
        st = np.abs(B - bc) < 0.0165
        r.put(st, "khaki")
        r.lit(st & (e_ > 0.0165 - 1.1 * tx), 0.64)
        r.lit((e_ >= 0.0165) & (e_ < 0.0165 + 1.4 * tx), 0.68)
    patch = ell(B, Y, 0, 0.28, 0.024, 0.019) < 1
    r.put(patch, "khaki"); r.lit(patch, 0.7)
    r.lit(patch & (ell(B, Y, 0, 0.28, 0.024, 0.019) > 0.75), 0.75)
    # blood from the chin down the placket, a soaked belly stain, spatters
    r.blob(0.0, 0.11, 0.030, 0.028, "bloodc", 0.9, rough=0.4)
    for x_, y_, n_ in ((-0.022, 0.11, 0.10), (-0.009, 0.11, 0.20), (0.004, 0.11, 0.26), (0.017, 0.11, 0.16),
                       (0.03, 0.10, 0.08), (-0.034, 0.09, 0.06)):
        r.drip(x_, y_, n_, w=0.6 * tx, mat="bloodc")
    r.splat(0.135, 0.35, 0.036, drips=3)
    r.splat(-0.16, 0.43, 0.018, drips=1)
    r.splat(0.21, 0.20, 0.012, drips=1)
    r.blob(r.P / 2 - 0.12, 0.37, 0.03, 0.025, "bloodc", 0.9, rough=0.5)
    # a rip showing grey skin on the right side
    rip = ell(X, Y, -0.19, 0.34, 0.016, 0.022) + 0.3 * r.nz
    r.lit(rip < 1.35, 0.55)
    r.put(rip < 1, "skin3")
    r.put(ell(X, Y, -0.19, 0.345, 0.006, 0.008) < 1, "bloodc")
    r.clusters(4, 0.55, f=0.9, seed=1)
    r.clusters(4, 0.62, f=1.08, where=Y < 0.25, seed=2)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["trousers", "leather", "metal", "bloodc2"], 31)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    ax = np.abs(X)
    BH = 0.056
    belt = Y < BH
    r.put(belt, "leather")
    r.lit(belt & (Y < 1.1 * ty), 1.28)
    r.lit(belt & (Y > BH - 1.1 * ty), 0.6)
    r.lit((Y >= BH) & (Y < BH + 1.3 * ty), 0.55)                    # belt shadow on the trousers
    for x_ in (0.075, -0.075, 0.2, -0.2, r.P / 2, r.P / 2 - 0.13, r.P / 2 + 0.13):
        lp = (np.abs(r.dx(x_)) < 0.0075) & (Y < BH + 0.008)
        r.put(lp, "trousers"); r.lit(lp, 1.12)
        r.lit((np.abs(r.dx(x_)) >= 0.0075) & (np.abs(r.dx(x_)) < 0.0075 + tx) & (Y < BH + 0.006), 0.6)
    bk = (ax < 0.027) & (Y > 0.006) & (Y < BH - 0.004)
    r.put(bk, "metal")
    inner = (ax < 0.017) & (Y > 0.014) & (Y < BH - 0.012)
    r.put(inner, "leather"); r.lit(inner, 0.55)
    r.put((ax < 0.6 * tx) & (Y > 0.014) & (Y < BH - 0.012), "metal")
    r.fold((0.004, BH + 0.006), (0.006, 0.19), off=(1.2 * tx, 0))                  # fly
    r.line([(0.006, 0.19), (-0.012, 0.205)], 0.6 * tx, f=0.7)
    for sg in (-1, 1):
        r.fold((sg * 0.10, BH + 0.006), (sg * 0.155, 0.14), off=(-sg * 1.2 * tx, 0))  # hip pockets
        r.fold((sg * 0.015, 0.23), (sg * 0.065, 0.155), dark=0.72)                  # crotch folds
        r.fold((sg * 0.03, 0.24), (sg * 0.10, 0.18), dark=0.76)
        cx = r.P / 2 + sg * 0.075                                                   # back pockets
        d = np.abs(r.dx(cx))
        pk = (d < 0.034) & (Y > 0.085) & (Y < 0.18)
        r.lit(pk & ~((d < 0.034 - tx) & (Y > 0.085 + ty) & (Y < 0.18 - ty)), 0.66)
        r.lit((d < 0.035) & (Y > 0.083) & (Y < 0.11), 1.15)
        r.lit((d < 0.035) & (Y >= 0.11) & (Y < 0.11 + 1.2 * ty), 0.55)
    r.lit(np.clip((Y - 0.19) / 0.06, 0, 1), 0.82)
    r.clusters(4, 0.55, f=0.9, where=~belt, seed=3)
    r.splat(0.10, 0.115, 0.02, "bloodc2", drips=2)
    r.blob(r.P / 2 - 0.1, 0.135, 0.016, 0.014, "bloodc2", 0.9)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["trousers", "bloodc", "mud", "skin3"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    inner = -outer
    so = 1 if L else -1
    r.fold((outer, 0.0), (outer + so * 0.004, Lt), off=(-so * 1.2 * tx, 0))          # outer seam
    r.fold((inner, 0.0), (inner, Lt), dark=0.8, off=(so * 1.2 * tx, 0))
    for (y0_, y1_, dx0, dx1) in ((0.04, 0.26, -0.02, 0.06), (0.12, 0.35, -0.05, 0.03),
                                 (0.23, 0.43, -0.04, 0.05), (0.06, 0.19, 0.09, 0.14)):
        r.fold((inner * 0.5 + so * dx0, y0_), (so * dx1, y1_), off=(so * 1.2 * tx, -0.5 * ty))
    for yk in (Lt - 0.085, Lt - 0.055, Lt - 0.025):                    # knee creases, back and front
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    r.fold((-0.03, Lt - 0.04), (0.035, Lt - 0.045), dark=0.8, off=(0, -1.2 * ty))
    r.clusters(3, 0.3, f=1.12, where=(np.abs(X) < 0.07) & (Y > Lt - 0.10), seed=8)  # dusty knee
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    if L:
        r.splat(0.03, 0.21, 0.032, drips=2)
        r.splat(-0.06, 0.36, 0.02, drips=1)
        tear = ell(X, Y, 0.0, Lt - 0.04, 0.034, 0.024) + 0.3 * r.nz
        r.lit(tear < 1.3, 0.5)
        r.put(tear < 1, "skin3")
        r.blob(0.004, Lt - 0.035, 0.012, 0.009, "bloodc", 0.9)
    else:
        r.splat(-0.02, 0.34, 0.03, drips=2)
        cx = outer
        d = np.abs(X - cx)
        pk = (d < 0.048) & (Y > 0.13) & (Y < 0.30)
        r.lit(pk & ~((d < 0.048 - tx) & (Y > 0.13 + ty) & (Y < 0.30 - ty)), 0.62)
        r.lit((d < 0.05) & (Y > 0.128) & (Y < 0.165), 1.18)
        r.lit((d < 0.05) & (Y >= 0.165) & (Y < 0.165 + 1.3 * ty), 0.52)
        r.lit(pk & (Y > 0.26), 0.88)
    r.lit(np.clip(Y / Lt, 0, 1), 0.92)
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
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.3)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.68)
    r.lit((Y > Lt - 0.05) & (Y < Lt - 0.03), 1.15)
    r.lit(Y >= Lt - 0.03, 0.62)
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
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.88)
    for k in range(-3, 4):                                        # shaft creases
        r.fold((k * 0.05 + 0.012, 0.02), (k * 0.05 + 0.02, 0.09), off=(1.2 * tx, 0))
    r.lit(Y < 0.02, 0.62)                                         # under the bloused trousers
    tongue = ax < 0.018
    r.lit(tongue, 0.8)
    for yk in np.arange(0.03, Lt, 0.024):
        r.line([(-0.014, yk), (0.014, yk + 0.012)], 0.55 * tx, "khaki")
        r.put(ell(X, Y, -0.016, yk, 0.004, 0.004) < 1, "metal")
        r.put(ell(X, Y, 0.016, yk, 0.004, 0.004) < 1, "metal")
    r.clusters(3, 0.5, mat="mud", where=Y > Lt - 0.05, seed=14)
    r.blob(0.05, 0.08, 0.012, 0.01, "bloodc2")
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["leather", "mud", "metal", "bloodc2", "khaki"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][2]                         # stations on the instep ring (k0 = sole centre)
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 0.9)
    r.lit(sole, 0.4)
    r.lit(welt, 1.22)
    r.lit((np.abs(U - st[2]) < 0.012) | (np.abs(U - st[6]) < 0.012), 0.66)      # welt seam
    Lt = info["d"][-1]
    toe = Y > Lt - 0.07
    r.lit(toe & ~sole, 1.12)
    r.lit((np.abs(Y - (Lt - 0.07)) < 0.006) & ~sole, 0.62)                      # toe-cap stitching
    r.lit((Y < 0.03) & ~sole, 0.85)                                              # heel counter
    lace = (np.abs(X) < 0.02) & (Y > 0.04) & (Y < 0.16)
    r.lit(lace, 0.78)
    for yk in np.arange(0.05, 0.16, 0.024):
        r.line([(-0.013, yk), (0.013, yk + 0.01)], 0.55 * tx, "khaki")
    r.clusters(3, 0.50, mat="mud", where=(np.abs(r.B) < 0.10) & ~sole, seed=15)
    r.clusters(2, 0.55, f=1.2, where=toe & ~sole, seed=16)
    r.blob(0.04, 0.2, 0.012, 0.01, "bloodc2")
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    r = loft_reg("uarm." + sd, I["uarm." + sd], ["shirt", "bloodc"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.abs(Y - 0.075) < 0.6 * ty, 0.7)                      # shoulder seam
    r.lit(np.abs(Y - 0.075 + 1.2 * ty) < 0.6 * ty, 1.15)
    for k in range(3):                                           # inner elbow creases
        r.fold((P / 2 - 0.05 + k * 0.03, Lt - 0.13), (P / 2 - 0.035 + k * 0.03, Lt - 0.08))
    r.fold((-0.03, 0.13), (0.02, 0.18))
    cuff = Y > Lt - 0.068
    r.lit(cuff, 1.1)
    for yk, f_ in ((Lt - 0.040, 0.7), (Lt - 0.006, 0.6)):
        r.lit(np.abs(Y - yk) < 0.6 * ty, f_)
    r.lit(np.abs(Y - (Lt - 0.054)) < 0.6 * ty, 1.15)
    r.clusters(4, 0.55, f=0.9, seed=16 if L else 17)
    if L:
        r.blob(0.02, 0.17, 0.012, 0.01, "bloodc")
    else:
        r.splat(0.0, 0.19, 0.024, drips=2)
    return r


def paint_farm(I, sd):
    L = sd == "L"
    r = loft_reg("farm." + sd, I["farm." + sd], ["skin", "livid", "blood", "shirt2"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.clip(1 - Y / 0.065, 0, 1), 0.62)                     # sleeve shadow
    r.lit(np.abs(r.B) < 0.05, 0.9)                                 # underside
    for x0_ in (0.03, -0.02):                                      # veins
        pts = [(r.P / 2 + x0_ + 0.01 * math.sin(k), 0.07 + k * 0.035) for k in range(6)]
        r.line(pts, 0.55 * tx, "livid")
    r.blob(-0.03, 0.12, 0.018, 0.015, "livid", 1.2, rough=0.4)     # bruise
    r.lit(np.clip((Y - 0.2) / 0.08, 0, 1), 0.9)
    if L:
        for k in range(3):                                         # claw scratches
            r.line([(-0.02 + k * 0.012, 0.11 + k * 0.01), (0.012 + k * 0.012, 0.18 + k * 0.01)], 0.6 * tx, "blood", 0.8)
        r.splat(0.01, 0.24, 0.014, "blood", drips=1)
    else:
        r.splat(0.0, 0.10, 0.022, "blood", drips=3)
        r.blob(0.03, 0.22, 0.01, 0.008, "blood", 0.9)
    return r


def paint_palm(I):
    r = loft_reg("palm", I["palm"], ["skin", "livid", "blood", "dirt"], 91)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.ones(X.shape), 0.88)
    r.clusters(3, 0.45, f=0.88, seed=4)
    Lt = Y.max()
    r.lit(np.abs(r.B) < 0.03, 0.8)                                 # palm side
    for x0_ in (-0.018, -0.006, 0.006, 0.018):                     # tendons
        r.line([(x0_ * 0.6, 0.02), (x0_, Lt - 0.012)], 0.5 * tx, f=1.15)
    for x0_ in (-0.02, -0.007, 0.007, 0.02):                        # knuckles
        r.blob(x0_, Lt - 0.006, 0.0055, 0.005, None, 1.25, rough=0)
    r.line([(-0.025, 0.035), (0.02, 0.065)], 0.6 * tx, "livid")
    r.blob(0.004, 0.05, 0.012, 0.012, "blood", 0.9)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.72)
    return r


def paint_finger(I):
    r = loft_reg("fing", I["fing"], ["skin", "livid", "blood", "dirt"], 92)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.9)
    back = np.abs(X) < P / 4
    r.lit(~back, 0.8)                                              # palm side
    for xk in (-0.0215, 0.0, 0.0215):                              # splits between the four fingers
        r.lit(np.abs(X - xk) < 0.55 * tx, 0.55)
        r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.6)
    r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.7)              # middle knuckle crease
    r.lit(back & (np.abs(Y - Lt * 0.5 + 0.005) < 0.003), 1.2)
    nail = back & (Y > Lt - 0.014)
    for xk in (-0.032, -0.011, 0.011, 0.032):
        nk = nail & (np.abs(X - xk) < 0.0075)
        r.put(nk, "dirt"); r.lit(nk & (Y < Lt - 0.008), 1.2)
    r.blob(0.02, Lt - 0.006, 0.008, 0.006, "blood", 0.9)
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


def paint_eyes():
    """The eye-quad patch: a milky almond filling the rhombus, a grey pupil."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    a = np.zeros((h, w, 3)); a[:] = C((196, 194, 168))
    a[(np.abs(U - 0.5) < 0.30) & (Vv < 0.3)] = C((168, 168, 146))            # upper-lid shade
    a[ell(U, Vv, 0.52, 0.55, 0.16, 0.34) < 1] = C((138, 140, 124))            # pupil
    a[ell(U, Vv, 0.40, 0.40, 0.05, 0.12) < 1] = C((214, 212, 188))            # catch light
    return a


def paint_page(I, light, pos):
    jn = np.array(JW["neck"])

    def preg(name):
        x0, y0, w, h = REG[name]
        return pos[y0:y0 + h, x0:x0 + w] + jn
    face = paint_face("head", preg("head"), 11)
    regs = [face, paint_face("nose", preg("nose"), 12), paint_ear(), paint_cap(I), paint_helmet(I), paint_neck(I),
            paint_collar(), paint_torso(I), paint_pelvis(I), paint_boot(I), paint_foot(I), paint_palm(I),
            paint_finger(I), paint_thumb(I)]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd), paint_farm(I, sd)]
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 18))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.45, 0.45, wrap=r.P is not None)
        lt = lt * EDGE[y0:y0 + h, x0:x0 + w]
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
    x0, y0, w, h = REG["eyes"]
    page[y0:y0 + h, x0:x0 + w] = paint_eyes()
    # glow page (same UVs): the eye patch, and the painted eyes on the face, dimmer
    glow = np.zeros((AT, AT, 3))
    glow[y0:y0 + h, x0:x0 + w] = paint_eyes() * 0.85
    x0, y0, w, h = REG["head"]
    glow[y0:y0 + h, x0:x0 + w][face.eye] = C((92, 92, 78))
    return page, glow


EDGE = np.ones((AT, AT))


# ---------------------------------------------------------------- images

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


def load_png(path):
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, :3].astype(np.float64)


# ---------------------------------------------------------------- materials

def fog_group():
    """Screen-space murky fog colour (backdrop and fog share it)."""
    ng = bpy.data.node_groups.get("PS1C_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("PS1C_Fog", "ShaderNodeTree")
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, unlit=False):
    """Texture (nearest) x vertex colour, lit by a sun (split normals: hard facets)
    plus flat ambient (or unlit), mixed to the fog colour by camera distance.
    mapping = 'floor' / 'wall' projects the texture by world position."""
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
    if unlit:
        em = N.new("ShaderNodeEmission"); Lk.new(col, em.inputs["Color"])
        surf = em.outputs[0]
    else:
        dif = N.new("ShaderNodeBsdfDiffuse"); Lk.new(col, dif.inputs["Color"])
        amb = N.new("ShaderNodeMix"); amb.data_type = "RGBA"; amb.blend_type = "MULTIPLY"; amb.name = "Ambient"
        amb.inputs[0].default_value = 1.0
        Lk.new(col, amb.inputs[6]); amb.inputs[7].default_value = (AMB, AMB, AMB, 1.0)
        em = N.new("ShaderNodeEmission"); Lk.new(amb.outputs[2], em.inputs["Color"])
        add = N.new("ShaderNodeAddShader")
        Lk.new(dif.outputs[0], add.inputs[0]); Lk.new(em.outputs[0], add.inputs[1])
        surf = add.outputs[0]
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


# ---------------------------------------------------------------- game export

def export_game(objs, page, glow):
    """public/models/ghoul.json (+ .png, _glow.png): the rest-pose parts in joint-local
    three.js space, per-corner split normals, v flipped for a top-left origin."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    joints = {n: {"parent": p, "pos": [round(float(x), 4) for x in pos]} for n, p, pos in JOINTS}
    order = {n: i for i, (n, j) in enumerate(PARTS)}
    parts, tris = [], {}
    for ob in sorted(objs, key=lambda o: order[o.name]):
        me = ob.data
        me.calc_loop_triangles()
        cn = me.corner_normals
        uvd = me.uv_layers.active.data
        ca = me.color_attributes.get("Col")
        seen, P, N, U, Cc, idx = {}, [], [], [], [], []
        for tri in me.loop_triangles:
            for li in tri.loops:
                co = me.vertices[me.loops[li].vertex_index].co
                n = cn[li].vector.normalized()
                p3 = tuple(round(float(x), 4) for x in b2t(co))
                n3 = tuple(round(float(x), 4) for x in b2t(n))
                uv = uvd[li].uv
                u2 = (round(float(uv.x), 4), round(float(1 - uv.y), 4))
                c3 = tuple(round(float(x), 3) for x in ca.data[li].color[:3]) if ca else ()
                key = p3 + n3 + u2 + c3
                if key not in seen:
                    seen[key] = len(P)
                    P.append(p3); N.append(n3); U.append(u2); Cc.append(c3)
                idx.append(seen[key])
        part = {"name": ob.name, "joint": ob["joint"], "pos": [x for p in P for x in p],
                "nrm": [x for p in N for x in p], "uv": [x for p in U for x in p]}
        if ca:
            part["col"] = [x for p in Cc for x in p]
        part["idx"] = idx
        parts.append(part)
        tris[ob.name] = len(idx) // 3
    body = sum(v for k, v in tris.items() if k not in ("cap", "helmet", "eyes"))
    data = {"version": 1, "texture": GAME_ID + ".png", "emissive": GAME_ID + "_glow.png", "joints": joints,
            "parts": parts,
            "meta": {"id": GAME_ID, "name": "Polygon Ghoul v3", "style": STYLE, "generator": "art/zombies/z_ps1c.py",
                     "units": "m", "up": "+Y", "facing": "+Z", "left": "+X", "pose": "rest",
                     "tris": tris, "tris_body": body,
                     "headwear": ["cap", "helmet"], "unlit": ["eyes"],
                     "note": "show cap, helmet or neither; tint instances 0.8-1.1; draw eyes unlit"}}
    jp = os.path.join(EXPORT_DIR, GAME_ID + ".json")
    with open(jp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    save_png(os.path.join(EXPORT_DIR, GAME_ID + ".png"), page)
    save_png(os.path.join(EXPORT_DIR, GAME_ID + "_glow.png"), glow)
    print(f"[ps1c] export -> {jp} ({os.path.getsize(jp) / 1024:.1f} KB) tris {tris} body {body}")


# ---------------------------------------------------------------- build

PARTS_OBJ = []


def build():
    root = kit.empty("ZOMBIE_ps1c")
    I, G = build_rest()
    objs = []
    for name, joint in PARTS:
        ob = rig_part(name, G[name], joint, root)
        if name != "eyes":
            harden(ob)
        objs.append(ob)
    PARTS_OBJ[:] = objs
    bpy.context.view_layer.update()
    for ob in objs:
        if ob.name != "eyes":
            vertex_tint(ob, ob.name)
    body = {o.name: o for o in objs}
    # bake in a game-like pose (arms forward, no arm/torso contact), headwear set aside
    apply_pose(objs, BAKE_POSE, aside={"cap": V((3, 0, 0)), "helmet": V((-3, 0, 0))})
    body["eyes"].hide_render = True
    bake = [o for o in objs if o.name != "eyes"]
    light, pos = bake_maps(bake)
    body["eyes"].hide_render = False
    EDGE[:] = edge_light(bake)
    page, glow = paint_page(I, light, pos)
    img = make_image("ps1c_page", page, "texture_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    if "--export" in ARGS or "--final" in ARGS:
        export_game(objs, page, glow)
    mat = ps1_mat("PS1C_Ghoul", img)
    emat = ps1_mat("PS1C_Eyes", img, vcol=False, unlit=True)
    for ob in objs:
        kit.assign(ob, emat if ob.name == "eyes" else mat)
    show_helmet = "--helmet" in ARGS
    body["helmet"].hide_render = body["helmet"].hide_viewport = not show_helmet
    body["cap"].hide_render = body["cap"].hide_viewport = show_helmet
    # the zombie stance, feet on the floor
    apply_pose(objs, STANCE)
    zmin = min((o.matrix_world @ v.co).z for o in objs if not o.hide_render for v in o.data.vertices)
    apply_pose(objs, STANCE, body_off=(0, 0, -zmin))
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


def unsnap():
    for ob, rest in SNAP:
        ob.data.vertices.foreach_set("co", rest.astype(np.float32).ravel())
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
    cm = bpy.data.materials.new("PS1C_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("PS1C_Env") else (dist - near_c, dist + far_c)
            fr.inputs["From Min"].default_value = near
            fr.inputs["From Max"].default_value = far


def paint_floor():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("floor", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 111)
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
    fimg = make_image("ps1c_floor", paint_floor(), "floor_tile.png")
    kit.assign(floor, ps1_mat("PS1C_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
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
    if DBG:
        import shutil
        os.makedirs(DBG, exist_ok=True)
        shutil.copy(path, os.path.join(DBG, "n_" + os.path.splitext(os.path.basename(path))[0].replace("preview_", "")[:10] + ".png"))
    kit.numpy_post(path, crt)


# ---------------------------------------------------------------- extra shots

def face_shot(root):
    """Head close-up at native resolution (like v2's face.png)."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    root.rotation_euler.z = math.radians(-22)
    bpy.context.view_layer.update()
    head = bpy.data.objects["head"]
    hc = head.matrix_world @ V((0, -0.02, 0.09))
    cam = sc.camera
    cam.data.lens = 50
    cam.location = hc + V((0.0, -0.95, 0.05))
    kit._aim(cam, hc + V((0, 0, -0.01)))
    set_fog(0.95, near_c=0.3, far_c=6.0)
    p = os.path.join(OUT, "face.png")
    render_native(p)
    post(p)
    print("[ps1c] face ->", p)


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
    wimg = make_image("ps1c_wall", paint_wall())
    wmat = ps1_mat("PS1C_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("PS1C_EnvHole", make_image("ps1c_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("ps1c_wood", paint_wood())
    wm = ps1_mat("PS1C_EnvWoodM", wood, None, vcol=False)
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
    chalk = ps1_mat("PS1C_EnvChalk", make_image("ps1c_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
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
            k_ = 0.55 if m.name.startswith("PS1C_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[ps1c] ingame ->", p)


def compare():
    """v2 | v3 side by side at the same size: three-quarter, face and in-game."""
    v2 = os.path.join(kit.OUT_BASE, "ps1b")
    rows = []
    for name in ("three_quarter", "face"):
        a, b = os.path.join(v2, name + ".png"), os.path.join(OUT, name + ".png")
        if os.path.exists(a) and os.path.exists(b):
            A, B = load_png(a), load_png(b)
            if A.shape == B.shape:
                rows.append(np.concatenate([A, np.full((A.shape[0], 12, 3), 0.05), B], 1))
    if rows:
        wmax = max(r.shape[1] for r in rows)
        out = np.concatenate([np.pad(r, ((0, 12), (0, wmax - r.shape[1]), (0, 0))) for r in rows], 0)
        save_png(os.path.join(OUT, "compare_v2_v3.png"), out)
    a, b = os.path.join(v2, "ingame.png"), os.path.join(OUT, "ingame.png")
    if os.path.exists(a) and os.path.exists(b):
        A, B = load_png(a), load_png(b)
        save_png(os.path.join(OUT, "compare_ingame_v2_v3.png"), np.concatenate([A, np.full((A.shape[0], 12, 3), 0.05), B], 1))
    print("[ps1c] compare ->", OUT)


if "--export" in ARGS and "--final" not in ARGS:
    kit.reset()
    build()
else:
    kit.run(STYLE, build, stage, post,
            meta={"technique": "rigid faceted prisms (hard normals > 30 deg) in the game rig's rest pose, posed by FK; "
                               "256px page, 16-colour CLUT per part, painted light x Cycles-baked AO/facet light, "
                               "edge highlights; native 300x400 + composite/CRT post",
                  "texture_page": "256x256", "segments": 14, "game_model": "public/models/ghoul.json"})
    root = bpy.data.objects["ZOMBIE_ps1c"]
    if "--final" in ARGS or "--face" in ARGS:
        face_shot(root)
    if "--final" in ARGS or "--ingame" in ARGS:
        ingame(root)
    if "--final" in ARGS:
        compare()
