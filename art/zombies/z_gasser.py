# The Gasser (gasser): a gaunt gas-mask sentry for the "1997" world (art/STYLE.md),
# the fast one (the game uses it for runners).
#
# Built like Polygon Ghoul v3 (z_ps1c.py, the reference implementation, whose helpers
# are copied here): rigid faceted prisms in the game rig's rest pose, hard normals
# (every edge sharper than 30 degrees split), one 256 px page painted per region
# with hue-shifted CLUT ramps x a Cycles-baked AO / facet light at ~60 % strength,
# painted ridge highlights, a mirrored mask block at ~3x body density, native
# 300x400 renders through the composite TV post. Staged in the Rotted's mood: a
# warm bulb raking from above-front, cool rims from behind, murky green fog.
#
# Design:
#   - a WWII-style respirator is the face: a faceted rubber face piece with a raised
#     bead, two round eyepieces in metal rims whose glass glows milky sickly green
#     (the unlit `eyes` part + the glow page), a short snout valve, and a corrugated
#     hose (hard rings) running down to a rusty canister strapped on the chest.
#     The hose is split at a coupler sleeve: the upper run moves with the head, the
#     lower with the chest, and the upper end slides inside the sleeve when the head
#     pitches, so the game's neck poses do not open a gap;
#   - a long field-grey greatcoat in hard panels: high turned-up collar, belt,
#     double-breasted front, a canister sling; the skirt is two panels hung from the
#     hip joints (upperLeg.L/R) so they swing with the legs, split at the back into
#     tails, with a torn hem;
#   - gaunt and long-limbed: narrow shoulders, a hump built into the torso, long bare
#     forearms out of short ragged sleeves, big bony three-fingered claw hands with
#     dark nails, canvas leggings over boots.
#
#   node art/zombies/blend.mjs z_gasser.py --preview [--views front,side,back,three_quarter] [--mask] [--run] [--rest] [--ingame]
#   node art/zombies/blend.mjs z_gasser.py --final     (heroes, turntable, mask, run, rest, ingame)
# Every run exports public/models/gasser.json + gasser.png + gasser_glow.png.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree

STYLE = "gasser"
OUT = os.path.join(kit.OUT_BASE, STYLE)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FINAL = "--final" in ARGS
DBG = os.path.join(OUT, "_d") if os.environ.get("GASSER_DEBUG") else None
EXPORT_DIR = os.path.join(kit.ROOT, "public", "models")
GAME_ID = "gasser"
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
# the Rotted's light: a warm caged bulb above and in front, cool rims from behind
SUN, SUN_COL, AMB, BACK = 1.0, (1.0, 0.80, 0.58), 0.58, 0.55
FOG_DARK = (7, 14, 11); FOG_GLOW = (50, 78, 58)
SHARP_DEG = 30.0                            # split normals above this dihedral angle
EDGE_HI, EDGE_LO = 0.30, 0.80               # painted ridge highlight / crease darkening
KEY = V((0.0, -0.42, 0.91)).normalized()    # painted key: a bulb above, slightly in front
EYE_TINT = (1.0, 0xe2 / 255, 0xb0 / 255)    # the game draws `eyes` unlit x 0xffe2b0

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# The world palette (z_ps1b / z_ps1c RAMPS: skin, blood, leather, mud, metal, khaki,
# concrete, wood, chalk) plus the Gasser's materials in the same value range and hue
# shift (cool shadows, warm highlights): field-grey coat, sage rubber, dark hose
# rubber, olive canister paint, rust, webbing, canvas, mildew and claw nails.
# (colours dark -> light, index of the "lit base" entry = light 1.0)
RAMPS = {
    "skin": ([(32, 30, 36), (50, 50, 54), (70, 72, 70), (92, 96, 88), (114, 118, 104),
              (136, 140, 120), (160, 162, 138), (188, 186, 158)], 5),
    "skin4": ([(58, 60, 60), (86, 90, 82), (114, 118, 104), (142, 144, 122)], 2),
    "livid2": ([(52, 32, 36), (104, 68, 68)], 1),
    "bloodc2": ([(44, 14, 14), (80, 24, 20)], 1),
    "coat": ([(20, 24, 24), (29, 34, 33), (40, 46, 43), (52, 59, 53), (66, 74, 64), (82, 89, 76),
              (100, 105, 89), (122, 124, 104)], 4),
    "coat5": ([(29, 34, 33), (40, 46, 43), (52, 59, 53), (66, 74, 64), (82, 89, 76)], 3),
    "lining": ([(20, 20, 21), (33, 32, 31), (48, 46, 42)], 1),
    "rubber": ([(20, 22, 24), (32, 35, 37), (46, 50, 50), (60, 65, 63), (75, 80, 76), (92, 97, 90),
                (112, 116, 106), (136, 138, 124)], 4),
    "rubberd": ([(12, 13, 14), (20, 22, 23), (30, 33, 33), (42, 46, 44), (56, 60, 56), (72, 76, 69)], 3),
    "steel": ([(26, 27, 28), (40, 42, 42), (58, 60, 58), (80, 82, 76), (106, 106, 96), (136, 134, 120)], 3),
    "canpaint": ([(24, 28, 24), (36, 42, 34), (50, 57, 44), (66, 73, 56), (84, 91, 68), (106, 112, 84)], 3),
    "rust": ([(34, 18, 14), (58, 30, 20), (86, 46, 26), (114, 64, 34)], 2),
    "rust3": ([(58, 30, 20), (86, 46, 26), (114, 64, 34)], 1),
    "web2": ([(50, 48, 38), (88, 84, 64)], 1),
    "strap2": ([(28, 26, 23), (54, 50, 41)], 1),
    "button": ([(62, 60, 52), (106, 100, 82)], 1),
    "web3": ([(46, 44, 35), (74, 70, 54), (106, 100, 77)], 1),
    "khaki": ([(92, 80, 56), (138, 124, 88), (182, 168, 126)], 1),
    "khaki1": ([(150, 140, 104)], 0),
    "metal": ([(60, 58, 56), (170, 166, 150)], 1),
    "metal1": ([(150, 146, 132)], 0),
    "mildew2": ([(70, 84, 64), (98, 112, 86)], 1),
    "leather": ([(18, 14, 14), (32, 25, 22), (47, 36, 28), (64, 49, 36), (86, 68, 50)], 3),
    "leather4": ([(24, 19, 18), (40, 31, 26), (58, 45, 34), (82, 64, 47)], 2),
    "mud": ([(66, 56, 42), (100, 88, 64)], 1),
    "nail": ([(10, 9, 10), (20, 17, 17), (34, 29, 27), (52, 46, 41)], 2),
    "canvas": ([(38, 38, 32), (56, 55, 45), (76, 74, 59), (98, 95, 76), (122, 118, 94), (148, 142, 114)], 3),
    "concrete": ([(26, 30, 28), (36, 40, 37), (46, 50, 45), (58, 62, 55), (72, 75, 66)], 3),
    "wood": ([(30, 22, 18), (46, 34, 26), (64, 48, 34), (86, 66, 46)], 2),
}


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMP_C = {k: np.array(v[0], float) / 255.0 for k, v in RAMPS.items()}
RAMP_LL = {k: np.log(np.array([_luma(c) for c in v[0]]) / _luma(v[0][v[1]])) for k, v in RAMPS.items()}

# texture page layout: name -> (x0, y0, w, h), top-left origin. The mask block is
# mirrored (both halves share texels) and gets ~3x the body's texel density.
REG = {
    "head": (0, 0, 96, 96), "torso": (96, 0, 128, 64), "pelvis": (96, 64, 128, 24), "neck": (96, 88, 32, 8),
    "rim": (224, 0, 32, 16), "snout": (224, 16, 32, 32), "can": (224, 48, 32, 32),
    "eyes": (224, 80, 16, 16), "thumb": (240, 80, 16, 16),
    "skirt": (0, 96, 128, 64), "collar": (128, 96, 64, 32), "palm": (192, 96, 32, 16), "fing": (192, 112, 32, 16),
    "hoseU": (224, 96, 16, 24), "hoseL": (240, 96, 16, 48), "foot": (128, 128, 64, 32),
    "uarm.L": (0, 160, 48, 40), "uarm.R": (48, 160, 48, 40),
    "farm.L": (96, 160, 32, 48), "farm.R": (128, 160, 32, 48),
    "shin.L": (160, 160, 48, 48), "shin.R": (208, 160, 48, 48),
}
HEAD_FC = 64          # head columns spent on the face quarter (front centre -> side)


def _check_layout():
    occ = np.zeros((AT, AT), int)
    for n, (x0, y0, w, h) in REG.items():
        assert x0 + w <= AT and y0 + h <= AT, n
        occ[y0:y0 + h, x0:x0 + w] += 1
    assert occ.max() == 1, "texture regions overlap"


_check_layout()

# ---------------------------------------------------------------- the game rig
# three.js space (+Y up, facing +Z, character's left = +X), pos relative to the parent.
# The ghoul's hierarchy and names, gaunt proportions: narrow shoulders, long legs,
# the neck set a little forward over the hump.
JOINTS = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.99, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.51, 0.04)), ("shL", "spine", (0.22, 0.43, 0.03)), ("shR", "spine", (-0.22, 0.43, 0.03)),
    ("elL", "shL", (0.0, -0.34, 0.0)), ("elR", "shR", (0.0, -0.34, 0.0)),
    ("hipL", "hips", (0.09, -0.04, 0.0)), ("hipR", "hips", (-0.09, -0.04, 0.0)),
    ("knL", "hipL", (0.0, -0.48, 0.0)), ("knR", "hipR", (0.0, -0.48, 0.0)),
]
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("eyes", "neck"),
         ("upperArm.L", "shL"), ("upperArm.R", "shR"), ("lowerArm.L", "elL"), ("lowerArm.R", "elR"),
         ("upperLeg.L", "hipL"), ("upperLeg.R", "hipR"), ("lowerLeg.L", "knL"), ("lowerLeg.R", "knR")]
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
# the sentry: hunched over, head up and watching, claws out and low, knees bent to spring
STANCE = {"spine": (0.30, 0.0, 0.03), "neck": (-0.26, 0.14, -0.05),
          "shL": (-0.62, 0.0, 0.10), "shR": (-0.34, 0.0, -0.16), "elL": (-0.80, 0, 0), "elR": (-0.50, 0, 0),
          "hipL": (-0.22, 0, 0.04), "knL": (0.34, 0, 0), "hipR": (0.12, 0, -0.05), "knR": (0.26, 0, 0)}


def run_pose(s, c):
    """render/zombies.js, runner (cls 2), at gait phase sin = s, cos = c."""
    amp = 0.95
    return {"spine": (0.45, 0, 0), "neck": (-0.35, 0, 0),
            "shL": (-0.35 - s * 0.9, 0, 0), "shR": (-0.35 + s * 0.9, 0, 0), "elL": (-1.3, 0, 0), "elR": (-1.3, 0, 0),
            "hipL": (s * amp, 0, 0), "hipR": (-s * amp, 0, 0),
            "knL": (max(0.0, -c) * amp * 1.4 + 0.05, 0, 0), "knR": (max(0.0, c) * amp * 1.4 + 0.05, 0, 0)}


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


# ---------------------------------------------------------------- numpy helpers (z_ps1c)

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


# ---------------------------------------------------------------- the painter (z_ps1c)

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

    def drip(s, x0, y0, length, w=None, mat="bloodc2", f=None, wobble=0.25):
        w = w or 0.55 * s.tx
        n = max(2, int(length / (2 * s.ty)))
        pts = [(x0, y0)]
        x = x0
        for k in range(1, n + 1):
            x += s.rng.uniform(-wobble, wobble) * s.tx
            pts.append((x, y0 + length * k / n))
        s.line(pts, w, mat, f)
        s.blob(x, y0 + length, w * 1.6, w * 1.8, mat, f, rough=0.0)

    def splat(s, x0, y0, rad, mat="bloodc2", drips=2, f=0.85, rough=0.35):
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

    def overlay(s, mask, mat, k):
        """Force a ramp entry on a mask after quantising (light-independent)."""
        s.over.append((np.asarray(mask) > 0.5, mat, k))

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
        for mk, mn, k in s.over:
            out[mk] = RAMP_C[mn][k]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[gasser] WARNING region {s.name} uses {n} colours")
        COLS[s.name] = n
        return out


COLS = {}


def mould(r, x0, y0, rx, ry, mat="mildew2", thr=0.05, seed=0, f=None):
    """A deliberate patch of mould (or grime with f): dense flecks in the middle,
    breaking up toward a ragged edge. x0 / y0 / rx / ry in the region's metres."""
    n = lowfreq(np.random.default_rng(seed + 577), r.h, r.w, 1.5)
    d = np.sqrt((r.dx(x0) / rx) ** 2 + ((r.Y - y0) / ry) ** 2) + 0.35 * r.nz
    mk = (d < 1) & (n > thr + 0.7 * (d - 0.45))
    if mat:
        r.put(mk, mat)
    if f is not None:
        r.lit(mk, f)
    return mk


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
    r = Reg(name, mats, X, Y, P, P / w, Ltot / h, seed)
    r.U = U
    return r


def grid_reg(name, mats, sx, sy, seed=0):
    """Reg over a small region in plain UV units scaled to metres (sx, sy)."""
    x0, y0, w, h = REG[name]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg(name, mats, U * sx, Vv * sy, None, sx / w, sy / h, seed)
    r.U, r.V = U, Vv
    return r


# ---------------------------------------------------------------- geometry: profiles (z_ps1c)

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


def octprof(r, n=8):
    """A hard n-gon ring (flat top edge) for round things: eyepieces, snout, hose, canister."""
    return [[r * math.cos((k + 0.5) * 2 * math.pi / n), r * math.sin((k + 0.5) * 2 * math.pi / n), 0.0]
            for k in range(n)]


def tbox(w, db, df, push=None):
    """Ten-sided faceted box (torso, pelvis): flat back, bevelled shoulder blades,
    flat sides, bevelled chest corners, flat front."""
    return sym(_push([[0, -db, 0], [-0.62 * w, -0.97 * db, 0], [-w, -0.40 * db, 0], [-w, 0.35 * df, 0],
                      [-0.68 * w, 0.93 * df, 0], [0, df, 0]], push))


def hbox(w, db, df, push=None):
    """Twelve-sided faceted skull ring: flat back, back corners, flat sides, front
    corners (cheekbones), and a face front split down the centre line."""
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


def band_obj(name, rings, vbands, reg, wants):
    """Quads between consecutive closed rings of explicit points (same count n): the
    thick standing collar. u runs round the ring (k / n); band i maps ring i to
    v_top vbands[i][0] and ring i + 1 to vbands[i][1] (fractions of the region's
    height from its top row); wants[i](face centre) is the outward direction."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    n = len(rings[0])
    vv_ = [[bm.verts.new(V(p)) for p in r] for r in rings]
    for i in range(len(rings) - 1):
        va, vb = vbands[i]
        for k in range(n):
            k1 = (k + 1) % n
            vv = [vv_[i][k], vv_[i][k1], vv_[i + 1][k1], vv_[i + 1][k]]
            uu = [(k / n, va), ((k + 1) / n, va), ((k + 1) / n, vb), (k / n, vb)]
            co = [v.co for v in vv]
            nrm = sum((co[j].cross(co[(j + 1) % 4]) for j in range(4)), V())
            ctr = sum(co, V()) / 4
            if nrm.dot(wants[i](ctr)) < 0:
                vv, uu = vv[::-1], uu[::-1]
            fc = bm.faces.new(vv)
            fc.smooth = True
            for lp, (u, vt) in zip(fc.loops, uu):
                lp[uvl].uv = uv_in(reg, u, 1 - vt)
    return kit.mesh_obj(name, bm, None, smooth=False)


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


def oring(rx, ryb, ryf, z, yc=0.0, n=8, dz=None):
    """An n-gon ring round (0, yc) at height z: k = 0 back centre, n/4 the right side,
    n/2 the front centre; ryb / ryf are the back / front half-depths; dz lifts vertices."""
    pts = []
    for k in range(n):
        th = 2 * math.pi * k / n
        c = math.cos(th)
        pts.append(V((-rx * math.sin(th), yc + (ryb if c >= 0 else ryf) * c, z + ((dz or {}).get(k, 0.0)))))
    return pts


class Path:
    """A cubic Bezier sampled by arc length (the hose)."""

    def __init__(s, p0, p1, p2, p3, n=240):
        P = [V(p) for p in (p0, p1, p2, p3)]
        s.pts = []
        for i in range(n + 1):
            t = i / n; u = 1 - t
            s.pts.append(P[0] * u ** 3 + P[1] * 3 * u * u * t + P[2] * 3 * u * t * t + P[3] * t ** 3)
        s.acc = [0.0]
        for a, b in zip(s.pts, s.pts[1:]):
            s.acc.append(s.acc[-1] + (b - a).length)
        s.L = s.acc[-1]

    def at(s, d):
        d = min(max(d, 0.0), s.L)
        i = max(0, min(len(s.acc) - 2, int(np.searchsorted(s.acc, d)) - 1))
        seg = s.acc[i + 1] - s.acc[i]
        t = (d - s.acc[i]) / seg if seg > 1e-9 else 0.0
        return s.pts[i].lerp(s.pts[i + 1], t)


# ---------------------------------------------------------------- geometry: the parts (rest pose, world)

HEAD_YC = -0.050
# mask/head rings, crown .. under the chin: (z, y offset, half-width, back, front, pushes {k: (out, fwd[, up])})
# k: 0 back centre, 1 back corner, 2 side-back, 3 side, 4 cheek corner, 5 face side, 6 face centre
HEADR = [
    (1.786, 0.004, 0.056, 0.060, 0.050, {}),                                                        # crown
    (1.740, 0.000, 0.095, 0.100, 0.094, {5: (0.010, 0.004)}),                                       # temples
    (1.700, 0.000, 0.104, 0.102, 0.104, {4: (0, 0.006), 5: (0.016, 0.012), 6: (0, 0.004)}),        # brow of the face piece
    (1.660, 0.000, 0.107, 0.098, 0.106, {4: (0.008, 0.004), 5: (0.016, 0.006)}),                   # eye line, cheek corners
    (1.620, 0.000, 0.099, 0.092, 0.110, {4: (0.004, 0.006), 5: (0.008, 0.014), 6: (0, 0.018)}),    # cheeks swell to the snout
    (1.578, 0.000, 0.080, 0.080, 0.104, {0: (0, 0, 0.014), 1: (0, 0, 0.012), 2: (0, 0, 0.008),
                                         5: (0.002, 0.008), 6: (0, 0.008)}),                        # jaw
    (1.544, 0.004, 0.052, 0.058, 0.080, {0: (0, 0, 0.026), 1: (0, 0, 0.024), 2: (0, 0, 0.016),
                                         3: (0, 0, 0.008)}),                                        # chin
]
HEAD_ROWS = (6, 18, 32, 48, 64, 78, 90)      # texel rows of the rings (the face gets most)
APEX_TOP = (0, HEAD_YC - 0.002, 1.802)
APEX_BOT = (0, HEAD_YC + 0.014, 1.536)
EYE = (0.051, 1.678)                         # eyepiece centre (|x|, z)
EYE_R = 0.035                                # eyepiece rim radius (big bug eyes read at range)
SNOUT_Z = 1.598
CAN = (0.064, -0.162, 1.290)                 # canister centre on the chest (left of the buttons)
CAN_R, CAN_H = 0.057, 0.152
HOSE_SPLIT = 0.066                           # arc length where the hose passes from the head to the chest
SLEEVE = 0.074                               # coupler sleeve length (the upper run slides inside it)


def build_rest():
    """Every part in the rest pose, in world coordinates (Blender: Z up, facing -Y,
    left = +X). Returns (loft infos for painting, {part name: [objects]}, extras)."""
    I, G, X = {}, {}, {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1)); dn = V((0, 0, -1))

    # ---- head: the respirator's faceted rubber face piece over the skull (mirrored UVs)
    head, I["head"] = loft("head", [(0, HEAD_YC + yo, z) for z, yo, *_ in HEADR],
                           [hbox(w, db, df, p) for z, yo, w, db, df, p in HEADR], fwd, REG["head"],
                           mirror=HEAD_FC / REG["head"][2], vs=[1 - r / REG["head"][3] for r in HEAD_ROWS],
                           apex=(APEX_TOP, APEX_BOT))
    tree = bvh(head)
    hparts = [head]
    hz = [v.co.z for v in head.data.vertices]
    hy = [v.co.y for v in head.data.vertices]
    X["mask_box"] = (min(hz), max(hz), -(min(hy) + max(hy)) / 2)   # z range, forward offset of its centre

    # ---- eyepieces: octagonal metal rims standing proud of the rubber; the glass is
    # the unlit `eyes` part (a centre fan, radial UVs into the glowing lens patch)
    glass = []
    for sx in (1, -1):
        c, n = hit_front(tree, sx * EYE[0], EYE[1])
        if c is None:
            c, n = V((sx * EYE[0], HEAD_YC - 0.105, EYE[1])), V((0, -1, 0))
        a = (n + fwd * 0.9 + V((sx * 0.10, 0, 0.02))).normalized()
        rim, I["rim"] = loft("rim", [c - a * 0.020, c + a * 0.013], [octprof(EYE_R + 0.002), octprof(EYE_R)],
                             up, REG["rim"], (False, False))
        hparts.append(rim)
        f = (up - a * up.dot(a)).normalized(); s = f.cross(a).normalized()
        g = c + a * 0.0085
        rr = EYE_R - 0.0035
        ring = [g + s * (rr * math.cos((k + 0.5) * math.pi / 4)) + f * (rr * math.sin((k + 0.5) * math.pi / 4))
                for k in range(8)]
        for k in range(8):
            k1 = (k + 1) % 8
            uvs = []
            for kk in (k, k1):
                th = (kk + 0.5) * math.pi / 4
                u = 0.5 + 0.47 * math.cos(th) * sx
                uvs.append(("eyes", u, 0.5 - 0.47 * math.sin(th)))
            glass.append(([g, ring[k], ring[k1]], [("eyes", 0.5, 0.5)] + uvs, tuple(a)))
        X["eye" + ("L" if sx > 0 else "R")] = (c, a)
    G["eyes"] = [poly_obj("eyes", glass)]

    # ---- snout: an octagonal valve housing, forward and down from the mouth, with a clamp ridge
    sb, sn = hit_front(tree, 0.0, SNOUT_Z)
    d = (sn * 0.35 + V((0, -0.80, -0.62))).normalized()
    SNO = [(-0.014, 0.035), (0.034, 0.038), (0.050, 0.031)]
    snout, I["snout"] = loft("snout", [sb + d * a_ for a_, r_ in SNO], [octprof(r_) for a_, r_ in SNO],
                             up, REG["snout"], (False, True))
    hparts.append(snout)
    F = sb + d * 0.050
    X["snout"] = (F, d)

    # ---- the hose: snout -> down the chest -> canister top. Hard corrugation rings; the
    # upper run belongs to the head, the lower to the chest, joined at a coupler sleeve.
    T = V((CAN[0] - 0.008, CAN[1] - 0.006, CAN[2] + CAN_H / 2 - 0.010))
    path = Path(F - d * 0.008, F + d * 0.045 + V((0, 0, -0.035)), T + V((0.0, -0.040, 0.105)), T)
    X["hose_len"] = path.L
    HU = [(0.000, 0.0185), (0.033, 0.0225), (HOSE_SPLIT, 0.0180), (HOSE_SPLIT + SLEEVE - 0.004, 0.0175)]
    hose_u, I["hoseU"] = loft("hoseU", [path.at(s_) for s_, r_ in HU], [octprof(r_, 6) for s_, r_ in HU],
                              fwd, REG["hoseU"], (False, False))
    hparts.append(hose_u)
    rest = path.L - (HOSE_SPLIT + SLEEVE + 0.004)
    HL = [(HOSE_SPLIT - 0.004, 0.0265), (HOSE_SPLIT + SLEEVE, 0.0265), (HOSE_SPLIT + SLEEVE + 0.004, 0.0175),
          (HOSE_SPLIT + SLEEVE + 0.004 + rest * 0.34, 0.0225), (HOSE_SPLIT + SLEEVE + 0.004 + rest * 0.68, 0.0170),
          (path.L, 0.0205)]
    hose_l, I["hoseL"] = loft("hoseL", [path.at(s_) for s_, r_ in HL], [octprof(r_, 6) for s_, r_ in HL],
                              fwd, REG["hoseL"], (True, False))
    X["hoseL_r"] = [r_ for s_, r_ in HL]
    X["hoseU_r"] = [r_ for s_, r_ in HU]
    G["head"] = hparts

    # ---- torso: faceted greatcoat box, a hump over the upper back, narrow sloping
    # shoulders, narrow waist; the neck; the high collar; the canister and lower hose
    # centre line leaning forward at the top, shoulder blades pushed out and back into a hump
    TORSO = [(1.530, -0.036, 0.085, 0.070, 0.058, {}),
             (1.492, -0.032, 0.198, 0.150, 0.088, {1: (0, -0.022), 2: (0, 0, -0.030), 3: (0, 0, -0.036)}),
             (1.400, -0.016, 0.168, 0.190, 0.096, {1: (0.014, -0.026)}),
             (1.220, 0.002, 0.146, 0.120, 0.100, {}),
             (1.020, 0.006, 0.142, 0.100, 0.104, {})]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO],
                             [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO], fwd, REG["torso"], (True, False),
                             cap_u=0.27)
    neck, I["neck"] = loft("neck", [(0, -0.030, 1.500), (0, -0.048, 1.584)],
                           [hexprof(0.040, 0.044), hexprof(0.037, 0.041)], fwd, REG["neck"], (False, False))
    CY = -0.024
    front_v = {4: -0.092, 3: -0.046, 5: -0.046}
    rings = [oring(0.100, 0.100, 0.086, 1.490, CY), oring(0.134, 0.134, 0.116, 1.642, CY, dz=front_v),
             oring(0.116, 0.116, 0.100, 1.635, CY, dz=front_v), oring(0.082, 0.082, 0.072, 1.500, CY)]
    out_ = lambda c: V((c.x, c.y - CY, 0.0))
    collar = band_obj("collar", rings, [(0.56, 0.04), (0.60, 0.70), (0.74, 1.0)], REG["collar"],
                      [out_, lambda c: V((0.3 * c.x, 0.3 * (c.y - CY), 1.0)), lambda c: -out_(c)])
    cc = V(CAN)
    CANR = [(-CAN_H / 2, CAN_R - 0.004, -0.004), (CAN_H / 2 - 0.020, CAN_R, 0.003), (CAN_H / 2, CAN_R - 0.008, 0.004)]
    can, I["can"] = loft("can", [cc + V((dx_, 0, z_)) for z_, r_, dx_ in CANR], [octprof(r_) for z_, r_, dx_ in CANR],
                         fwd, REG["can"], (True, True), cap_u=0.5)
    G["torso"] = [torso, neck, collar, can, hose_l]

    # ---- pelvis: the coat's upper skirt below the belt (the skirt panels tuck inside)
    PEL = [(1.062, 0.006, 0.158, 0.106, 0.108), (1.000, 0.006, 0.172, 0.114, 0.116),
           (0.885, 0.006, 0.194, 0.130, 0.122)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL],
                               [tbox(w, db, df) for z, yc, w, db, df in PEL], fwd, REG["pelvis"], (False, False))
    G["pelvis"] = [pelvis]

    for sd, sx in (("L", 1), ("R", -1)):
        # ---- upper arm: coat sleeve prism with a pointed shoulder cap
        sh = JW["sh" + sd]
        UA = [(-0.004, 0.044, 0.046, sx * 0.002, 0), (-0.100, 0.041, 0.043, sx * 0.002, 4),
              (-0.318, 0.035, 0.038, 0.0, 9)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d_, dx, tw in UA],
                                   [twist(hexprof(w, d_), sx * tw) for z, w, d_, dx, tw in UA], fwd,
                                   REG["uarm." + sd], (False, True), apex=(sh + V((sx * 0.014, 0.004, 0.026)), None))
        G["upperArm." + sd] = [ua]

        # ---- forearm: a short ragged coat cuff, then a long bare bony forearm, flat at the wrist
        el = JW["el" + sd]
        p_ = math.radians(20)                                            # hanging hand pronated a little
        n = V((-sx * math.cos(p_), math.sin(p_), 0))                     # palm normal (inward, a bit back)
        td = V((-sx * math.sin(p_), -math.cos(p_), 0))                   # thumb side (front)
        bk = -n                                                          # back of the hand
        FA = [(0.035, 0.041, 0.045, {0: (0, -0.022)}), (-0.088, 0.049, 0.052, {1: (0, 0, -0.012), 2: (0, 0, 0.008)}),
              (-0.092, 0.023, 0.027, {}), (-0.300, 0.017, 0.024, {})]
        fr = [fwd, fwd, fwd, (fwd + td).normalized()]
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d_, p), sx * 5 * k) for k, (z, w, d_, p) in enumerate(FA)], fr,
                                   REG["farm." + sd], (False, False))
        # ---- the claw: a big bony palm, three long curled fingers with nail points, a thumb
        wr = el + V((0, 0, -0.300))
        palm, I["palm"] = loft("palm." + sd, [wr + dn * -0.012, wr + dn * 0.090],
                               [flatprof(0.029, 0.013), flatprof(0.048, 0.016, {3: (0, 0.005)})],
                               bk, REG["palm"], (False, True))
        s_ = bk.cross(dn).normalized()                                   # across the knuckles, away from the thumb
        base = wr + dn * 0.084
        fings = []
        for off, spread, ln, prof in ((-0.030, -0.14, 1.00, (0.0105, 0.0098)), (0.000, 0.0, 1.10, (0.0108, 0.0100)),
                                      (0.029, 0.14, 0.92, (0.0098, 0.0092))):
            pts = [base + s_ * off]
            frs = []
            for c_, L_ in ((16, 0.052 * ln), (42, 0.044 * ln), (72, 0.032 * ln)):
                a_ = math.radians(c_)
                dirv = (dn * math.cos(a_) + n * math.sin(a_) + s_ * spread).normalized()
                frs.append((bk * math.cos(a_) + dn * math.sin(a_)).normalized())
                pts.append(pts[-1] + dirv * L_)
            w0, d0 = prof
            fg, I["fing"] = loft("fing." + sd, pts[:3],
                                 [boxprof(w0, d0), boxprof(w0 * 0.80, d0 * 0.82), boxprof(w0 * 0.62, d0 * 0.62)],
                                 frs[:3], REG["fing"], (False, False), apex=(None, pts[3]))
            fings.append(fg)
        tb = wr + dn * 0.024 + td * 0.030 + n * 0.008
        t1 = (dn * 0.55 + td * 0.55 + n * 0.45).normalized()
        t2 = (dn * 0.45 + n * 0.85 + td * 0.10).normalized()
        th, I["thumb"] = loft("thumb." + sd, [tb, tb + t1 * 0.040], [boxprof(0.0115, 0.0105), boxprof(0.0092, 0.0084)],
                              bk, REG["thumb"], (False, False), apex=(None, tb + t1 * 0.040 + t2 * 0.036))
        G["lowerArm." + sd] = [fa, palm] + fings + [th]

        # ---- the greatcoat skirt panel for this leg: hung from the hip joint so it swings
        # with the thigh; D-shaped, meets its twin on the centre line, split into tails
        # at the back, torn at the hem (hem cap = the dark lining)
        hp = JW["hip" + sd]
        jag = ([0.000, -0.030, 0.020, -0.044, 0.012, -0.036, 0.014, 0.064] if sx > 0 else
               [0.000, -0.020, -0.038, 0.016, -0.026, 0.020, -0.040, 0.058])
        SK = [(0.975, 0.150, 0.100, 0.110, 0.000, None), (0.845, 0.196, 0.126, 0.142, 0.000, None),
              (0.400, 0.238, 0.156, 0.186, 0.032, jag)]
        cx = 0.10
        # the left panel laps over the right one at the front and down the back (just
        # proud of it), so the coat reads closed until the tails split below the seat
        fx, fy_, bx_, by_ = (-0.028, 0.007, -0.014, 0.006) if sx > 0 else (0.004, 0.0, 0.004, 0.0)

        def skprof(W, Fr, B, slit, jz):
            pts = [(fx, Fr + fy_), (0.45 * W, Fr * 0.98), (0.82 * W, Fr * 0.72), (W, Fr * 0.16), (0.97 * W, -B * 0.30),
                   (0.82 * W, -B * 0.72), (0.45 * W, -B * 0.98),
                   (slit if slit else bx_, -(B + (0 if slit else by_)) * (0.96 if slit else 1.0))]
            return [[sx * (x_ - cx), f_, (jz[k] if jz else 0.0)] for k, (x_, f_) in enumerate(pts)]
        sk, I["skirt"] = loft("skirt." + sd, [(sx * cx, 0.006, z) for z, *_ in SK],
                              [skprof(W, Fr, B, sl, jz) for z, W, Fr, B, sl, jz in SK], fwd, REG["skirt"],
                              (False, True), cap_u=0.97)
        G["upperLeg." + sd] = [sk]

        # ---- shin: canvas legging (top tucked inside the coat), boot below
        kn = JW["kn" + sd]
        SN = [(0.060, 0.050, 0.056, {}), (-0.110, 0.050, 0.058, {0: (0, -0.010)}), (-0.400, 0.036, 0.043, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN],
                                   [hexprof(w, d_, p) for z, w, d_, p in SN], fwd, REG["shin." + sd], (False, False))
        xf = kn.x + sx * 0.004
        a = math.radians(7) * sx
        fd = V((math.sin(a), -math.cos(a), 0))
        h0 = V((xf, 0.068, 0.0))
        FT = [(0.000, 0.044, 0.092), (0.100, 0.052, 0.104), (0.192, 0.056, 0.068)]

        def fprof(w, top):
            return sym([[0, -0.04, 0], [-w, -0.04, 0], [-1.06 * w, -0.018, 0], [-0.72 * w, top - 0.04, 0],
                        [0, top - 0.035, 0]])
        ft, I["foot"] = loft("foot." + sd, [h0 + fd * s + V((0, 0, 0.04)) for s, w, top in FT],
                             [fprof(w, top) for s, w, top in FT], up, REG["foot"], (True, False),
                             apex=(None, h0 + fd * 0.285 + V((0, 0, 0.024))))
        G["lowerLeg." + sd] = [sn, ft]
    return I, G, X


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


def apply_pose(objs, pose, body_off=(0, 0, 0)):
    M = fk(pose, body_off)
    for ob in objs:
        ob.matrix_basis = M[ob["joint"]]
    bpy.context.view_layer.update()


def vertex_tint(ob, part):
    """Per-corner colour, multiplied into the texture: darker lower legs and claws,
    occlusion under the mask, a darker hem. Uses the rest pose."""
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
            if part.startswith("lowerArm") and co.z < 0.80:
                f *= 0.88 + 0.12 * smooth01((co.z - 0.64) / 0.16)
            if part.startswith("upperLeg") and co.z < 0.62:
                f *= 0.90 + 0.10 * smooth01((co.z - 0.42) / 0.20)
            if part == "head" and co.z < 1.560 and nz < 0.3:
                f *= 0.86
            cols[li] = (f ** 1.08, f ** 1.04, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    return ca


# ---------------------------------------------------------------- baked light, edge light (z_ps1c)

def bake_maps(objs):
    """Cycles bakes AO, object-space normals (hard, per facet) and object-space
    positions onto the page. The painted light: a top-front key, sky, a warm bounce
    from below and a faint back rim, occluded."""
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
        save_png(os.path.join(DBG, "bake_light.png"), np.repeat(np.clip(light / 1.3, 0, 1)[..., None], 3, 2))
    print("[gasser] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
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

def paint_head(name, Ph, seed):
    """The mask and the head behind it, painted in 3D from the baked positions: |x|
    across, z up, F forward of the head's centre line (mirrored UVs share texels).
    The rubber face piece with its raised bead, the eyepiece collars and the chin
    ribs; behind the bead a bald corpse scalp under a five-strap webbing harness."""
    ax = np.abs(Ph[..., 0]); Z = Ph[..., 2]; F = HEAD_YC - Ph[..., 1]
    phi = np.arctan2(ax, F)                        # 0 front centre .. pi back centre
    R = 0.10
    Xa = phi * R                                   # arc distance round from the face centre
    r = Reg(name, ["rubber", "skin4", "strap2", "button"], Xa, 1.8 - Z, None, 0.0025, 0.003, seed=seed)
    front = F > 0.045
    PHI_E = 1.36
    ztop = 1.752 - 0.030 * np.clip(phi / PHI_E, 0, 1) ** 2
    face = (phi < PHI_E) & (Z < ztop)
    edge_d = np.minimum((PHI_E - phi) * R, np.where(phi < PHI_E, ztop - Z, 9.0))   # distance inside the bead
    out_d = np.maximum((phi - PHI_E) * R, np.where(phi < PHI_E + 0.3, Z - ztop, -9.0))  # distance outside
    r.put(~face, "skin4")
    # the bead round the face piece: a lit roll, a dark step off it onto the scalp
    r.lit(face & (edge_d < 0.006), 1.28)
    r.lit(face & (edge_d >= 0.006) & (edge_d < 0.009), 0.8)
    r.lit(~face & (out_d < 0.005), 0.55)
    # the eyepiece collars: a raised rubber ring round each rim and a crease outside it
    ed = np.sqrt((ax - EYE[0]) ** 2 + (Z - EYE[1]) ** 2)
    r.lit(front & (ed < EYE_R + 0.001), 0.5)
    r.lit(front & (ed >= EYE_R + 0.001) & (ed < EYE_R + 0.008), 1.22)
    r.lit(front & (ed >= EYE_R + 0.008) & (ed < EYE_R + 0.011), 0.70)
    r.lit(front & (ed >= EYE_R + 0.011) & (ed < EYE_R + 0.020) & (Z < EYE[1]), 0.88)   # under-eye shadow
    # brow of the face piece, a moulding line across it, and the centre seam
    r.lit(face & (Z > 1.703) & (Z < 1.716) & front, 1.12)
    r.lit(face & (np.abs(Z - 1.733) < 0.0018) & (ax < 0.05), 0.75)
    r.lit(face & (ax < 0.0016) & (Z > 1.62) & (Z < 1.745), 1.18)
    # the snout socket and the ribbed chin under it
    sd = np.sqrt(ax ** 2 + (Z - SNOUT_Z) ** 2)
    r.lit(front & (sd < 0.046), 0.62)
    r.lit(front & (sd >= 0.046) & (sd < 0.052), 1.2)
    for zc in (1.556, 1.566):
        r.lit(face & (np.abs(Z - zc) < 0.0022) & (ax < 0.05), 1.22)
        r.lit(face & (np.abs(Z - zc + 0.0045) < 0.0020) & (ax < 0.05), 0.72)
    # weathering: grime in the pores low on the cheeks, a pale bloom of mould on the
    # chin and down the sides of the face piece, worn patches on the brow
    r.clusters(2.2, 0.55, f=0.74, where=face & front & (Z < 1.64) & (ax > 0.03), seed=4)
    bloom = face & (ed > EYE_R + 0.012) & (((Z < 1.585) & (ax > 0.012)) | ((phi > 0.95) & (Z < 1.66)))
    r.clusters(1.8, 0.30, f=1.28, where=bloom, seed=5)
    r.clusters(4.0, 0.60, f=0.86, where=face, seed=6)
    r.clusters(2.5, 0.55, f=1.14, where=face & (Z > 1.70), seed=9)
    # the harness: temple and cheek straps round the sides to a pad on the back of the skull
    Xe = PHI_E * R
    Xb = np.pi * R
    straps = [((Xe - 0.004, 1.712), (Xb, 1.716)), ((Xe - 0.004, 1.600), (Xb * 0.8, 1.640), (Xb, 1.668))]
    smask = np.zeros_like(Z, bool)
    for pts in straps:
        mk = r.line([(x_, 1.8 - z_) for x_, z_ in pts], 0.0062) > 0.5
        smask |= mk
        r.line([(x_, 1.8 - z_ + 0.0072) for x_, z_ in pts], 0.0016, f=0.62)     # shadow under the strap
    pad = ((Xb - Xa) / 0.030) ** 2 + ((Z - 1.690) / 0.036) ** 2 < 1
    smask |= pad
    smask &= ~face | (phi > PHI_E - 0.04)
    r.put(smask, "strap2")
    r.lit(smask & (r.nz > 0.35), 0.85)
    r.lit(pad & (((Xb - Xa) / 0.030) ** 2 + ((Z - 1.690) / 0.036) ** 2 > 0.6), 0.8)
    for zc in (1.712, 1.600):                                            # buckles at the bead
        bk = (np.abs(Xa - Xe - 0.008) < 0.0055) & (np.abs(Z - zc) < 0.0075)
        r.put(bk, "button")
        r.lit((np.abs(Xa - Xe - 0.008) < 0.0025) & (np.abs(Z - zc) < 0.0035), 0.4)
    # the scalp: bald, mottled, a stitched scar, mould in the creases
    scalp = ~face & ~smask
    r.clusters(3.0, 0.40, f=0.82, where=scalp, seed=7)
    r.clusters(5.0, 0.55, f=1.14, where=scalp, seed=8)
    scar = r.line([(Xb - 0.05, 1.8 - 1.765), (Xb - 0.012, 1.8 - 1.745)], 0.0014, f=0.5)
    for k in range(4):
        x_ = Xb - 0.046 + k * 0.011
        r.line([(x_, 1.8 - 1.767 + k * 0.005), (x_ + 0.003, 1.8 - 1.755 + k * 0.005)], 0.0010, f=0.6)
    r.overlay(scalp & (lowfreq(np.random.default_rng(31), r.h, r.w, 1.6) > 0.72), "skin4", 0)   # dark hair stubble
    r.face, r.ed = face, ed
    return r


def paint_rim(I):
    info = I["rim"]
    r = loft_reg("rim", info, ["steel"], 201)
    Y, Lt = r.Y, info["L"]
    r.lit(Y < 0.020, 0.55)                                          # buried in the rubber
    r.lit(Y > Lt - 0.0035, 1.35)                                    # the turned front lip
    r.lit(np.abs(Y - (Lt - 0.008)) < 0.0015, 0.62)                  # thread groove
    r.clusters(1.5, 0.55, f=0.8, seed=3)
    return r


def paint_snout(I):
    info = I["snout"]
    r = loft_reg("snout", info, ["canpaint", "steel", "rust3"], 211)
    Y, Lt = r.Y, info["L"]
    d1 = info["d"][1]
    r.lit(Y < 0.016, 0.55)                                          # in the rubber socket
    clamp = (Y > d1 - 0.006) & (Y < d1 + 0.006)
    r.put(clamp, "steel")
    r.lit(clamp & (Y < d1 - 0.002), 1.25)
    r.lit((Y >= d1 + 0.006) & (Y < d1 + 0.008), 0.7)
    for x_ in (-r.P / 4, r.P / 4):                                  # clamp screws
        r.blob(x_, d1, 0.004, 0.003, "steel", 0.5, rough=0.0)
    r.put(Y > Lt - 0.004, "steel")                                  # the cap row (the flat front)
    r.lit(Y > Lt - 0.004, 0.7)
    r.clusters(1.6, 0.45, mat="rust3", where=~clamp & (Y > 0.016) & (Y < Lt - 0.004), seed=4)
    r.clusters(2.0, 0.5, f=0.82, seed=5)
    return r


def paint_hose(name, info, radii, seed, sleeve=False):
    """Dark corrugated rubber: each geometric ridge ring gets a lit crest, each valley
    a dark crease, with fine painted ribs between. The lower run starts with the
    steel coupler sleeve (two clamp screws) and a dark step into the hose."""
    r = loft_reg(name, info, ["rubberd", "steel"], seed)
    Y = r.Y
    ds = info["d"]
    big = max(radii)
    rib = np.sin(2 * np.pi * Y / 0.011)
    r.lit(np.clip(rib, 0, 1), 1.18)
    r.lit(np.clip(-rib, 0, 1), 0.8)
    for dd, rr in zip(ds, radii):
        if rr > 0.020:
            r.lit(np.abs(Y - dd) < 0.004, 1.35)
        else:
            r.lit(np.abs(Y - dd) < 0.004, 0.55)
    if sleeve:
        sl = Y < ds[1]
        r.put(sl, "steel")
        r.lit(sl & (Y < 0.004), 1.3)
        r.lit(sl & (Y > ds[1] - 0.004), 0.6)
        r.lit(sl & (np.abs(Y - ds[1] * 0.5) < 0.003), 0.7)
        for x_ in (-r.P / 4, r.P / 4):
            r.blob(x_, ds[1] * 0.5, 0.0045, 0.0045, "steel", 1.3, rough=0.0)
        r.lit((Y > ds[1]) & (Y < ds[2] + 0.002), 0.4)
    r.clusters(2.0, 0.5, f=1.15, where=r.U < 2, seed=seed + 1)
    return r


def paint_can(I):
    info = I["can"]
    r = loft_reg("can", info, ["canpaint", "rust", "web2", "khaki1"], 221)
    X, Y, Lt = r.X, r.Y, info["L"]
    d1 = info["d"][1]
    r.lit(Y < 0.006, 0.7)                                           # bottom seam
    r.lit((Y > d1 - 0.004) & (Y < d1), 0.6)                         # lid seam
    r.lit((Y >= d1) & (Y < d1 + 0.004), 1.3)
    r.lit(Y > Lt - 0.003, 0.8)
    for yk in (0.030, 0.090):                                       # rolled ribs
        r.lit(np.abs(Y - yk) < 0.0025, 1.22)
        r.lit(np.abs(Y - yk - 0.0045) < 0.002, 0.72)
    strap = (Y > 0.048) & (Y < 0.066)
    r.put(strap, "web2")
    r.lit(strap & (Y < 0.051), 1.2)
    r.lit((Y >= 0.066) & (Y < 0.069), 0.55)
    band = (Y > 0.100) & (Y < 0.108) & (np.abs(X) < r.P * 0.3)       # faded stencil stripe
    r.put(band & (r.nz < 0.25), "khaki1")
    r.clusters(1.6, 0.30, mat="rust", where=(Y < 0.02) | (Y > d1 - 0.01), seed=5)
    r.clusters(2.0, 0.55, mat="rust", where=~strap, seed=6)
    r.clusters(2.5, 0.5, f=0.8, seed=7)
    r.blob(0.03, 0.078, 0.010, 0.008, None, 1.25, rough=0.2)        # dents
    r.blob(0.036, 0.083, 0.010, 0.008, None, 0.75, rough=0.2)
    return r


def paint_collar():
    r = grid_reg("collar", ["coat", "lining", "button", "mildew2"], 0.78, 0.20, 301)
    U, Vv = r.U, r.V
    outer = (Vv >= 0.04) & (Vv < 0.56)
    rim = (Vv >= 0.56) & (Vv < 0.72)
    inner = Vv >= 0.72
    r.put(inner, "lining")
    r.lit(inner * np.clip((Vv - 0.72) / 0.28, 0, 1), 0.6)
    r.lit(rim, 1.16)
    r.lit(outer & (Vv < 0.10), 1.2)                                 # the turned edge
    r.lit(outer & (Vv > 0.46), 0.72)                                # down onto the shoulders
    for u_ in (0.07, 0.19, 0.31, 0.69, 0.81, 0.93):                 # stiff vertical creases
        r.lit(outer & (np.abs(U - u_) < 0.006) & (Vv > 0.1), 0.72)
        r.lit(outer & (np.abs(U - u_ - 0.012) < 0.005) & (Vv > 0.1), 1.14)
    for u_ in (0.43, 0.57):                                         # front edges beside the V
        r.lit(outer & (np.abs(U - u_) < 0.010), 1.22)
    hook = (np.abs(U - 0.5) < 0.09) & (np.abs(U - 0.5) > 0.075) & (np.abs(Vv - 0.36) < 0.05)
    r.put(hook & outer, "button")
    mk = (np.abs(U - 0.0) < 0.14) | (np.abs(U - 1.0) < 0.14)      # mould down the back of the collar
    n = lowfreq(np.random.default_rng(303), r.h, r.w, 1.5)
    r.put(outer & mk & (Vv > 0.22) & (n > 0.1 + 2.0 * np.minimum(np.abs(U), np.abs(U - 1)) - 0.1), "mildew2")
    r.clusters(4.0, 0.5, f=0.86, where=outer, seed=4)
    return r


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["coat", "web2", "button", "mildew2", "bloodc2"], 231)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ax = np.abs(X)
    B = r.B
    Lt = Y.max()
    r.lit(Y < 0.030, 0.6)                                           # under the collar
    # lapels and the double-breasted front: overlap edge, two rows of buttons
    for sg in (-1, 1):
        r.line([(sg * 0.012, 0.03), (sg * 0.088, 0.13)], 0.9 * tx, f=1.25)
        r.line([(sg * 0.016, 0.034), (sg * 0.092, 0.135)], 0.7 * tx, f=0.62)
        r.lit((ax < 0.088 * np.clip((Y - 0.03) / 0.10, 0, 1)) & (Y < 0.13) & (Y > 0.03), 1.08)
    ov = 0.094
    r.line([(ov, 0.13), (ov, Lt)], 0.8 * tx, f=0.52)
    r.line([(ov - 1.3 * tx, 0.13), (ov - 1.3 * tx, Lt)], 0.6 * tx, f=1.22)
    for bx in (-0.062, 0.050):
        for by in (0.175, 0.255, 0.335):
            b = ell(X, Y, bx, by, 0.0085, 0.0080) < 1
            r.put(b, "button")
            r.lit(ell(X, Y, bx, by + 0.011, 0.009, 0.0035) < 1, 0.55)
    # the canister sling: over the right shoulder, across the chest, round the back
    sling = [(-P / 4 + 0.03, 0.0), (-0.020, 0.15), (0.090, 0.33), (P / 4 - 0.01, 0.44)]
    sw = 0.0115
    sl = r.line(sling, sw, "web2") > 0.5
    r.line([(x_, y_ + sw + 0.8 * ty) for x_, y_ in sling], 0.7 * ty, f=0.55)
    r.line([(x_, y_ - sw + 0.5 * ty) for x_, y_ in sling], 0.6 * ty, f=1.2)
    back = [(P / 4 - 0.01, 0.44), (P / 2, 0.24), (P / 2 + P / 4 - 0.03, 0.0)]
    r.line(back, sw, "web2")
    r.line([(x_, y_ + sw + 0.8 * ty) for x_, y_ in back], 0.7 * ty, f=0.55)
    buckle = ell(X, Y, 0.035, 0.24, 0.012, 0.010) < 1
    r.put(buckle & sl, "button")
    # armpit folds, a hump of creases across the upper back, the back seam and half-belt
    for sg in (-1, 1):
        sx0 = sg * P / 4
        r.blob(sx0, 0.12, 0.030, 0.040, None, 0.85, rough=0.3)
        for (a0, a1) in (((-0.03, 0.10), (-0.08, 0.19)), ((0.03, 0.10), (0.07, 0.20))):
            r.fold((sx0 + sg * a0[0], a0[1]), (sx0 + sg * a1[0], a1[1]), off=(sg * 1.3 * tx, 0))
    for yk, bend in ((0.07, 0.012), (0.11, 0.018), (0.16, 0.014)):
        pts = [(P / 2 + k * 0.03, yk + bend * (1 - (k / 4) ** 2)) for k in range(-4, 5)]
        r.line(pts, 0.6 * ty, f=0.66)
        r.line([(x_, y_ - 1.3 * ty) for x_, y_ in pts], 0.6 * ty, f=1.18)
    r.line([(P / 2, 0.03), (P / 2, 0.44)], 0.6 * tx, f=0.62)
    hb = (np.abs(B) < 0.085) & (Y > 0.435) & (Y < 0.465)
    r.lit(hb, 1.16)
    r.lit((np.abs(B) < 0.085) & (Y >= 0.465) & (Y < 0.465 + 1.2 * ty), 0.55)
    for bx in (-0.066, 0.066):
        r.put(ell(B, Y, bx, 0.45, 0.007, 0.007) < 1, "button")
    r.lit(Y > 0.49, 0.62)                                           # into the belt
    # a torn patch on the back, grime and mould in clusters, dried claw marks on the chest
    rip = ell(B, Y, -0.07, 0.30, 0.020, 0.028) + 0.3 * r.nz
    r.lit(rip < 1.3, 0.62)
    r.lit(rip < 1, 0.42)
    m1 = mould(r, P / 2, 0.06, 0.11, 0.06, seed=1)                  # under the collar at the back
    m2 = mould(r, -P / 4 - 0.01, 0.17, 0.045, 0.07, seed=2)          # right armpit
    m3 = mould(r, P / 2 + 0.05, 0.40, 0.06, 0.045, seed=3)           # low on the back
    r.put(sl & (m1 | m2 | m3), "web2")
    mould(r, P / 4 + 0.01, 0.20, 0.05, 0.08, None, seed=4, f=0.72)   # grime under the left arm
    mould(r, 0.02, 0.45, 0.12, 0.05, None, seed=5, f=0.78)           # grime over the belt
    r.clusters(5, 0.50, f=0.88, seed=1)
    r.clusters(4, 0.62, f=1.08, where=Y < 0.25, seed=5)
    for k in range(3):
        x0_ = -0.13 + k * 0.016
        r.line([(x0_, 0.20 + k * 0.006), (x0_ + 0.035, 0.29 + k * 0.006)], 0.55 * tx, "bloodc2")
    r.splat(-0.10, 0.36, 0.014, drips=2)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["coat", "leather4", "metal", "mildew2"], 241)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    ax = np.abs(X)
    BH = 0.052
    belt = Y < BH
    r.put(belt, "leather4")
    r.lit(belt & (Y < 1.1 * ty), 1.3)
    r.lit(belt & (Y > BH - 1.1 * ty), 0.6)
    r.lit((Y >= BH) & (Y < BH + 1.4 * ty), 0.5)
    bk = (np.abs(X - 0.01) < 0.030) & (Y > 0.006) & (Y < BH - 0.005)
    r.put(bk, "metal")
    inner = (np.abs(X - 0.01) < 0.019) & (Y > 0.014) & (Y < BH - 0.013)
    r.put(inner, "leather4"); r.lit(inner, 0.55)
    r.put((np.abs(X - 0.01) < 0.6 * tx) & (Y > 0.014) & (Y < BH - 0.013), "metal")
    ov = 0.094
    r.line([(ov, BH), (ov + 0.01, Y.max())], 0.8 * tx, f=0.52)
    r.line([(ov - 1.3 * tx, BH), (ov + 0.01 - 1.3 * tx, Y.max())], 0.6 * tx, f=1.22)
    for sg in (-1, 1):                                              # slanted pocket flaps
        cx = sg * 0.150
        r.line([(cx - 0.035 * sg, 0.085), (cx + 0.030 * sg, 0.070)], 0.9 * ty, f=1.2)
        r.line([(cx - 0.035 * sg, 0.090), (cx + 0.030 * sg, 0.075)], 0.8 * ty, f=0.55)
    r.line([(r.P / 2, BH + 0.02), (r.P / 2, Y.max())], 0.7 * tx, f=0.5)     # the back vent begins
    mk = mould(r, r.P / 2 - 0.09, 0.12, 0.06, 0.05, seed=7)
    r.put(mk & belt, "leather4")
    r.clusters(5, 0.5, f=0.88, where=~belt, seed=3)
    return r


def paint_skirt(I):
    """The coat skirt (both panels share it, mirrored): folds, the front edge, the
    tail slit, the lining on the inner face and hem cap, a torn muddy hem."""
    info = I["skirt"]
    r = loft_reg("skirt", info, ["coat", "lining", "mud", "mildew2"], 251)
    U, Y, tx, ty = r.U, r.Y, r.tx, r.ty
    st = info["xs"][1]
    Lt = info["L"]
    inner = U > st[7]
    r.put(inner, "lining")
    r.lit(inner, 1.8)                          # the panels' inner faces bake near-black AO (they face each
                                               # other 8 mm apart) but show as the coat's lining in a stride
    r.lit(Y < 0.085, 0.7)                                           # up inside the pelvis
    r.lit((U < 0.010) & ~inner, 1.28)                               # the coat's front edge
    r.lit((U >= 0.010) & (U < 0.018), 0.62)
    slit = np.clip((Y - 0.20) / 0.08, 0, 1)                          # the tails part below the seat
    r.lit(((U > st[7] - 0.014) & (U <= st[7])) * slit, 0.55)
    r.lit(((U > st[7] - 0.024) & (U <= st[7] - 0.014)) * slit, 1.15)
    # a few long hanging folds, irregular, fanning toward the hem
    for u_, y0, du in ((0.10, 0.22, 0.020), (0.23, 0.14, -0.012), (0.38, 0.26, 0.026), (0.52, 0.18, 0.010),
                       (0.63, 0.30, -0.016)):
        r.line([(u_ * r.P - r.P / 2, y0), ((u_ + du) * r.P - r.P / 2, Lt)], 0.7 * tx, f=0.72)
        r.line([((u_ + 0.022) * r.P - r.P / 2, y0 + 0.03), ((u_ + du + 0.030) * r.P - r.P / 2, Lt)], 0.6 * tx, f=1.14)
    # the torn hem: a ragged dark band, rips up from it, frayed threads, mud
    hem = Y > Lt - 0.030 + 0.012 * r.nz
    r.lit(hem & ~inner, 0.72)
    for u_, ln in ((0.12, 0.10), (0.29, 0.07), (0.45, 0.13), (0.61, 0.06), (0.70, 0.09)):
        x_ = u_ * r.P - r.P / 2
        r.line([(x_, Lt), (x_ + 0.01, Lt - ln)], 0.9 * tx, f=0.35)
        r.line([(x_ + 1.4 * tx, Lt), (x_ + 0.01 + 1.4 * tx, Lt - ln)], 0.6 * tx, f=1.2)
    r.clusters(2.5, 0.25, mat="mud", where=(Y > Lt - 0.09 + 0.02 * r.nz) & ~inner, seed=4)
    for k, (u_, y_) in enumerate(((0.20, Lt - 0.13), (0.62, Lt - 0.17))):   # mould climbing from the hem
        mk = mould(r, u_ * r.P - r.P / 2, y_, 0.06, 0.07, seed=11 + k)
        r.put(mk & inner, "lining")
    mould(r, 0.46 * r.P - r.P / 2, 0.30, 0.07, 0.10, None, seed=13, f=0.74)  # a dark wet stain
    r.clusters(5, 0.5, f=0.88, where=~inner, seed=6)
    for u_, y_ in ((0.36, 0.30), (0.55, 0.22)):                     # bullet holes
        x_ = u_ * r.P - r.P / 2
        r.blob(x_, y_, 0.006, 0.006, "lining", 0.5, rough=0.0)
        r.lit((ell(r.X, Y, x_, y_, 0.010, 0.010) < 1) & (ell(r.X, Y, x_, y_, 0.006, 0.006) >= 1), 1.2)
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["coat", "metal1", "bloodc2", "mildew2"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = info["L"]
    d1 = info["d"][1]
    r.lit(Y < d1 - 0.004, 1.1)                                      # the shoulder cap, a strap across it
    r.lit(np.abs(Y - d1 + 0.004) < 0.6 * ty, 0.62)                  # shoulder seam
    r.lit(np.abs(Y - d1 + 0.004 - 1.2 * ty) < 0.6 * ty, 1.18)
    r.put((np.abs(r.dx(0.0)) < 0.010) & (np.abs(Y - d1 * 0.45) < 0.008), "metal1")   # strap button
    r.line([(P / 2, d1), (P / 2 + 0.005, Lt)], 0.6 * tx, f=0.66)    # back seam
    for k in range(3):                                              # elbow creases
        r.fold((P / 2 - 0.04 + k * 0.03, Lt - 0.10), (P / 2 - 0.03 + k * 0.03, Lt - 0.05))
    r.fold((-0.03, d1 + 0.05), (0.01, d1 + 0.12))
    if L:
        mould(r, -P / 4 + 0.02, d1 + 0.07, 0.04, 0.06, seed=14)     # mould on the inner sleeve
    else:
        mould(r, 0.02, d1 + 0.02, 0.045, 0.04, None, seed=15, f=0.74)
    r.clusters(5, 0.5, f=0.88, seed=16 if L else 17)
    r.lit(np.clip((Y - Lt + 0.04) / 0.04, 0, 1), 0.82)
    if not L:
        r.splat(0.01, 0.20, 0.018, drips=2)
    return r


def paint_farm(I, sd):
    L = sd == "L"
    info = I["farm." + sd]
    r = loft_reg("farm." + sd, info, ["skin", "coat5", "livid2"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ds = info["d"]
    cuff_end = ds[1] + 0.004 * r.nz
    sleeve = Y < ds[1] + 0.001
    r.put(sleeve, "coat5")
    r.lit(sleeve & (Y > ds[1] - 0.030) & (Y < ds[1] - 0.024), 0.62)     # turned-back cuff seam
    r.lit(sleeve & (Y > ds[1] - 0.024), 1.1)
    r.lit(sleeve & (Y > cuff_end - 0.004), 0.55)                         # ragged edge
    step = (Y >= ds[1] + 0.001) & (Y < ds[2] + 0.001)
    r.put(step, "coat5"); r.lit(step, 0.35)                              # the lining inside the cuff
    skin = Y >= ds[2] + 0.001
    r.lit(skin & (Y < ds[2] + 0.030), 0.62)                              # shadow under the cuff
    # the bony forearm: ulna ridge down the back-outer side, tendons to the wrist, veins
    so = 1 if L else -1
    ul = so * P / 4 + so * 0.012
    r.line([(ul + 0.006, ds[2] + 0.02), (ul - 0.004, ds[3] - 0.01)], 0.8 * tx, f=1.3)
    r.line([(ul + 0.006 + 1.2 * tx, ds[2] + 0.02), (ul - 0.004 + 1.2 * tx, ds[3] - 0.01)], 0.6 * tx, f=0.7)
    for x0_ in (-0.008, 0.006):
        r.line([(x0_, ds[3] - 0.10), (x0_ * 0.6, ds[3] - 0.004)], 0.55 * tx, f=1.2)
    for x0_ in (0.03, -0.02):
        pts = [(P / 2 + x0_ + 0.006 * math.sin(k * 1.3), ds[2] + 0.03 + k * 0.03) for k in range(6)]
        r.line(pts, 0.5 * tx, f=0.72)
    r.blob(-0.02 * so, ds[2] + 0.09, 0.012, 0.016, "livid2", 1.1, rough=0.4)   # bruise
    r.clusters(2.2, 0.35, f=0.72, where=skin & (Y > ds[3] - 0.07), seed=21 if L else 22)
    r.clusters(3.0, 0.5, f=0.86, where=skin, seed=23 if L else 24)
    return r


def paint_palm(I):
    r = loft_reg("palm", I["palm"], ["skin", "livid2", "bloodc2", "nail"], 91)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.9)
    r.lit(np.abs(r.B) < 0.03, 0.78)                                 # palm side
    for x0_ in (-0.022, 0.0, 0.022):                                # tendons to the three claws
        r.line([(x0_ * 0.5, 0.01), (x0_, Lt - 0.012)], 0.5 * tx, f=1.22)
        r.line([(x0_ * 0.5 + 1.2 * tx, 0.01), (x0_ + 1.2 * tx, Lt - 0.012)], 0.4 * tx, f=0.8)
    for x0_ in (-0.024, 0.0, 0.024):                                # hard knuckles
        r.blob(x0_, Lt - 0.008, 0.007, 0.006, None, 1.3, rough=0)
    r.line([(-0.02, 0.03), (0.02, 0.06)], 0.6 * tx, "livid2")
    r.blob(0.01, 0.05, 0.010, 0.010, "bloodc2", 0.9)
    r.clusters(2.5, 0.45, f=0.8, seed=4)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.7)
    return r


def paint_finger(I):
    info = I["fing"]
    r = loft_reg("fing", info, ["skin", "nail", "bloodc2", "livid2"], 92)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ds = info["d"]
    Lt = info["L"]
    r.lit(np.ones(X.shape), 0.9)
    r.lit(Y < 0.008, 1.25)                                          # knuckle
    for dk in ds[1:3]:                                              # joint creases
        r.lit(np.abs(Y - dk) < 0.003, 0.62)
        r.lit(np.abs(Y - dk - 0.0045) < 0.002, 1.22)
    nail = Y > ds[2] - 0.004                                        # the whole claw point
    r.put(nail, "nail")
    r.lit(nail & (Y > Lt - 0.010), 1.3)                             # a glint at the tip
    r.lit(nail & (Y < ds[2] + 0.004), 0.7)
    r.clusters(2.0, 0.5, mat="bloodc2", where=(Y > ds[1]) & ~nail, seed=6)
    r.clusters(2.0, 0.4, f=0.8, where=~nail, seed=7)
    return r


def paint_thumb(I):
    info = I["thumb"]
    r = loft_reg("thumb", info, ["skin", "nail"], 95)
    Y, Lt = r.Y, info["L"]
    r.lit(Y < 0.006, 0.8)
    r.lit(np.abs(Y - info["d"][1]) < 0.003, 0.65)
    nail = Y > info["d"][1] + 0.004
    r.put(nail, "nail")
    r.lit(nail & (Y > Lt - 0.010), 1.3)
    return r


def paint_neck(I):
    r = loft_reg("neck", I["neck"], ["skin", "livid2"], 13)
    Y = r.Y
    r.lit(np.ones(Y.shape), 0.7)
    r.lit(Y > Y.max() - 0.03, 0.5)
    for sg in (-1, 1):
        r.line([(sg * 0.02, 0.0), (sg * 0.008, Y.max())], 0.004, f=1.25)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    info = I["shin." + sd]
    r = loft_reg("shin." + sd, info, ["canvas", "leather4", "metal1", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = info["L"]
    r.lit(Y < 0.06, 0.6)                                            # inside the coat
    for yk in (0.075, 0.095, 0.12):                                 # knee wrinkles
        r.fold((-0.04, yk), (0.04, yk + 0.008), off=(0, -1.3 * ty))
    so = 1 if L else -1
    xo = so * P / 4                                                 # the outer side: a laced opening
    r.line([(xo, 0.06), (xo, Lt - 0.05)], 0.7 * tx, f=0.5)
    r.line([(xo + so * 1.3 * tx, 0.06), (xo + so * 1.3 * tx, Lt - 0.05)], 0.6 * tx, f=1.2)
    for yk in np.arange(0.085, Lt - 0.06, 0.034):
        r.blob(xo - so * 0.010, yk, 0.004, 0.004, "metal1", rough=0.0)
        r.line([(xo - so * 0.010, yk), (xo + so * 0.010, yk + 0.017)], 0.5 * tx, f=0.62)
    for yk in (Lt - 0.155, Lt - 0.095):                             # two leather straps with buckles
        st = np.abs(Y - yk) < 0.0075
        r.put(st, "leather4")
        r.lit(st & (Y < yk - 0.004), 1.25)
        r.lit((Y >= yk + 0.0075) & (Y < yk + 0.0075 + 1.2 * ty), 0.55)
        r.put((np.abs(r.dx(xo + so * 0.018)) < 0.008) & (np.abs(Y - yk) < 0.009), "metal1")
    boot = Y > Lt - 0.045
    r.put(boot, "leather4")
    r.lit(boot & (Y < Lt - 0.040), 1.25)
    r.lit((Y > Lt - 0.052) & (Y <= Lt - 0.045), 0.55)
    r.clusters(2.5, 0.2, mat="mud", where=(Y > Lt - 0.12) & ~boot, seed=11 if L else 12)
    r.clusters(3, 0.5, f=0.84, where=~boot, seed=13)
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["leather", "mud", "metal", "bloodc2"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][1]                         # stations on the instep ring (k0 = sole centre)
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 0.9)
    r.lit(sole, 0.4)
    r.lit(welt, 1.22)
    r.lit((np.abs(U - st[2]) < 0.012) | (np.abs(U - st[6]) < 0.012), 0.66)
    Lt = info["d"][-1]
    toe = Y > Lt - 0.07
    r.lit(toe & ~sole, 1.12)
    r.lit((np.abs(Y - (Lt - 0.07)) < 0.006) & ~sole, 0.62)
    r.lit((Y < 0.03) & ~sole, 0.85)
    lace = (np.abs(X) < 0.02) & (Y > 0.04) & (Y < 0.16)
    r.lit(lace, 0.78)
    for yk in np.arange(0.05, 0.16, 0.024):
        r.line([(-0.013, yk), (0.013, yk + 0.01)], 0.55 * tx, "metal", 0.8)
    r.clusters(2.5, 0.35, mat="mud", where=~sole, seed=15)
    r.clusters(2, 0.55, f=1.2, where=toe & ~sole, seed=16)
    r.blob(0.04, 0.2, 0.012, 0.01, "bloodc2")
    return r


def paint_eyes():
    """The glass: milky, sickly green, brightest in the middle, a dark retaining ring,
    a catch light and a hairline crack. The game multiplies it by 0xffe2b0 (warm),
    so the glass is painted cooler than it should finally read."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    rr = np.hypot(U - 0.5, Vv - 0.5) / 0.47
    a = np.zeros((h, w, 3))
    a[:] = C((122, 206, 166))
    a[rr < 0.78] = C((156, 232, 192))
    a[rr < 0.52] = C((190, 250, 216))
    a[rr < 0.26] = C((218, 255, 234))
    a[rr > 0.93] = C((34, 40, 38))
    a[(rr > 0.93) & (Vv < 0.45)] = C((70, 74, 66))
    a[ell(U, Vv, 0.36, 0.33, 0.07, 0.07) < 1] = C((236, 255, 244))  # catch light
    crack = (np.abs((U - 0.62) - 0.55 * (Vv - 0.60)) < 0.035) & (Vv > 0.55) & (Vv < 0.88) & (rr < 0.93)
    a[crack] = C((70, 120, 100))
    return a


def paint_page(I, light, pos):
    def preg(name, joint):
        x0, y0, w, h = REG[name]
        return pos[y0:y0 + h, x0:x0 + w] + np.array(JW[joint])
    head = paint_head("head", preg("head", "neck"), 11)
    regs = [head, paint_rim(I), paint_snout(I),
            paint_hose("hoseU", I["hoseU"], XTRA["hoseU_r"], 261),
            paint_hose("hoseL", I["hoseL"], XTRA["hoseL_r"], 263, sleeve=True),
            paint_can(I), paint_collar(), paint_torso(I), paint_pelvis(I), paint_skirt(I), paint_neck(I),
            paint_palm(I), paint_finger(I), paint_thumb(I), paint_foot(I)]
    for sd in "LR":
        regs += [paint_uarm(I, sd), paint_farm(I, sd), paint_shin(I, sd)]
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 18))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.45, 0.45, wrap=r.P is not None)
        lt = lt * EDGE[y0:y0 + h, x0:x0 + w]
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
    x0, y0, w, h = REG["eyes"]
    eyes = paint_eyes()
    page[y0:y0 + h, x0:x0 + w] = eyes
    # glow page (same UVs): the lenses, and a faint green haze on the rubber round them
    glow = np.zeros((AT, AT, 3))
    glow[y0:y0 + h, x0:x0 + w] = eyes * 0.95
    x0, y0, w, h = REG["head"]
    Ph = preg("head", "neck")
    front = (HEAD_YC - Ph[..., 1]) > 0.045
    haze = np.clip(1 - (head.ed - EYE_R - 0.003) / 0.020, 0, 1) * front * (head.ed > EYE_R + 0.001)
    haze = np.round(haze * 3) / 3                                   # stepped, like the painted light
    glow[y0:y0 + h, x0:x0 + w] = C((26, 62, 40))[None, None, :] * haze[..., None]
    x0, y0, w, h = REG["rim"]
    rim_rows = (np.arange(h) + 0.5) / h > 0.72                       # the front lip, lit by the lens
    glow[y0:y0 + h, x0:x0 + w][rim_rows] = C((40, 88, 58))
    return page, glow


EDGE = np.ones((AT, AT))
XTRA = {}


# ---------------------------------------------------------------- images (z_ps1c)

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


# ---------------------------------------------------------------- materials (z_ps1c)

def fog_group():
    """Screen-space murky fog colour (backdrop and fog share it)."""
    ng = bpy.data.node_groups.get("GAS_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("GAS_Fog", "ShaderNodeTree")
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, unlit=False, tint=None, glow=None):
    """Texture (nearest) x vertex colour, lit by the suns (split normals: hard facets)
    plus flat ambient (or unlit, x tint like the game's eye material), mixed to the
    fog colour by camera distance. mapping = 'floor' / 'wall' projects by world position."""
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
    if tint:
        tm = N.new("ShaderNodeMix"); tm.data_type = "RGBA"; tm.blend_type = "MULTIPLY"; tm.inputs[0].default_value = 1.0
        Lk.new(col, tm.inputs[6]); tm.inputs[7].default_value = lin([c * 255 for c in tint])
        col = tm.outputs[2]
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
        if glow is not None:                       # the glow page as an emissive map
            gt = N.new("ShaderNodeTexImage"); gt.image = glow; gt.interpolation = "Closest"
            Lk.new(tex.inputs["Vector"].links[0].from_socket if tex.inputs["Vector"].links else N.new("ShaderNodeUVMap").outputs[0], gt.inputs["Vector"])
            ge = N.new("ShaderNodeEmission"); Lk.new(gt.outputs["Color"], ge.inputs["Color"])
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


# ---------------------------------------------------------------- game export

def export_game(objs, page, glow):
    """public/models/gasser.json (+ .png, _glow.png): the rest-pose parts in joint-local
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
    body = sum(v for k, v in tris.items() if k != "eyes")
    z0, z1, hf = XTRA["mask_box"]
    hc = (z0 + z1) / 2
    data = {"version": 1, "texture": GAME_ID + ".png", "emissive": GAME_ID + "_glow.png", "joints": joints,
            "parts": parts,
            "meta": {"id": GAME_ID, "name": "The Gasser", "style": STYLE, "generator": "art/zombies/z_gasser.py",
                     "units": "m", "up": "+Y", "facing": "+Z", "left": "+X", "pose": "rest",
                     "tris": tris, "tris_body": body, "unlit": ["eyes"], "headwear": [],
                     "head_centre_y": round(hc, 3), "head_centre_fwd": round(hf, 3), "height": round(HEIGHT[0], 3),
                     "note": "runner model; no cap/helmet; tint instances 0.8-1.1; draw eyes unlit (the glass is "
                             "painted cool so the 0xffe2b0 eye tint lands on sickly green); the hose is split at a "
                             "coupler: its upper run is in `head` (hidden on a headshot), its lower run in `torso`"}}
    jp = os.path.join(EXPORT_DIR, GAME_ID + ".json")
    with open(jp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    save_png(os.path.join(EXPORT_DIR, GAME_ID + ".png"), page)
    save_png(os.path.join(EXPORT_DIR, GAME_ID + "_glow.png"), glow)
    print(f"[gasser] export -> {jp} ({os.path.getsize(jp) / 1024:.1f} KB) tris {tris} body {body} "
          f"head centre {hc:.3f} m height {HEIGHT[0]:.3f} m")


# ---------------------------------------------------------------- build

PARTS_OBJ = []
HEIGHT = [0.0]


def build():
    root = kit.empty("ZOMBIE_gasser")
    I, G, X = build_rest()
    XTRA.update(X)
    objs = []
    for name, joint in PARTS:
        ob = rig_part(name, G[name], joint, root)
        if name != "eyes":
            harden(ob)
        objs.append(ob)
    PARTS_OBJ[:] = objs
    bpy.context.view_layer.update()
    zs = [(JW[o["joint"]] + v.co).z for o in objs for v in o.data.vertices]
    HEIGHT[0] = max(zs) - min(zs)
    for ob in objs:
        if ob.name != "eyes":
            vertex_tint(ob, ob.name)
    body = {o.name: o for o in objs}
    # bake in a game-like pose (arms forward, no arm/coat contact)
    apply_pose(objs, BAKE_POSE)
    body["eyes"].hide_render = True
    bake = [o for o in objs if o.name != "eyes"]
    light, pos = bake_maps(bake)
    body["eyes"].hide_render = False
    EDGE[:] = edge_light(bake)
    page, glow = paint_page(I, light, pos)
    print("[gasser] colours per region:", dict(sorted(COLS.items())))
    img = make_image("gasser_page", page, "texture_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    export_game(objs, page, glow)
    gimg = make_image("gasser_glow", glow)
    mat = ps1_mat("GAS_Body", img, glow=gimg)
    emat = ps1_mat("GAS_Eyes", img, vcol=False, unlit=True, tint=EYE_TINT)
    for ob in objs:
        kit.assign(ob, emat if ob.name == "eyes" else mat)
    pose_on_floor(objs, STANCE)
    return root


def pose_on_floor(objs, pose):
    """Pose by FK, then drop the body so the lowest vertex stands on the floor."""
    apply_pose(objs, pose)
    zmin = min((o.matrix_world @ v.co).z for o in objs if not o.hide_render for v in o.data.vertices)
    apply_pose(objs, pose, body_off=(0, 0, -zmin))


# ---------------------------------------------------------------- stage, snapping, post (z_ps1c)

SNAP = []


def snap_vertices():
    """Snap every vertex to the render's pixel grid in screen space (integer vertex
    coordinates, the source of the 32-bit wobble), keeping depth."""
    sc = bpy.context.scene; cam = sc.camera
    bpy.context.view_layer.update()
    rx = sc.render.resolution_x * sc.render.resolution_percentage // 100
    ry = sc.render.resolution_y * sc.render.resolution_percentage // 100
    step = (cam.data.sensor_width / cam.data.lens) / max(rx, ry)
    if cam.data.sensor_fit == "VERTICAL":
        step = (cam.data.sensor_height / cam.data.lens) / ry
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


def render_native(path, snap=True):
    bpy.context.scene.render.resolution_percentage = 100      # previews too: native is already small
    if snap:
        snap_vertices()
    dt = _render_to(path)
    unsnap()
    return dt


kit.render_to = render_native      # run() looks render_to up in kit at call time


def fog_card(cam, size=24.0):
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0))]
    bm.faces.new(vv)
    card = kit.mesh_obj("FogCard", bm, None, smooth=False)
    card.parent = cam; card.location = (0, 0, -45)
    cm = bpy.data.materials.new("GAS_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("GAS_Env") else (dist - near_c, dist + far_c)
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
    sun = kit.sun("Sun", rot=(48, 0, -24), strength=SUN, angle=1.0, color=SUN_COL)          # the warm bulb
    sun.data.use_shadow = False
    back = kit.sun("BackLight", rot=(-62, 0, -150), strength=BACK, angle=1.0, color=(0.42, 0.60, 0.95))   # cool rim
    back.data.use_shadow = False
    back2 = kit.sun("BackLight2", rot=(-58, 0, 150), strength=BACK * 0.55, angle=1.0, color=(0.45, 0.80, 0.58))
    back2.data.use_shadow = False
    cam = kit.camera(lens=50)
    kit.frame_to(cam, root, margin=1.07, aim_frac=0.5, elev=0.10)
    fog_card(cam)
    bm = bmesh.new()
    Fl = 60.0
    vv = [bm.verts.new(p) for p in ((-Fl, -Fl, -0.002), (Fl, -Fl, -0.002), (Fl, Fl, -0.002), (-Fl, Fl, -0.002))]
    bm.faces.new(vv)
    floor = kit.mesh_obj("Floor", bm, None, smooth=False)
    fimg = make_image("gas_floor", paint_floor(), "floor_tile.png")
    kit.assign(floor, ps1_mat("GAS_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
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
    kit.numpy_post(path, crt)


# ---------------------------------------------------------------- extra shots

def reframe(root, yaw, margin=1.07):
    root.rotation_euler.z = math.radians(yaw)
    bpy.context.view_layer.update()
    cam = bpy.context.scene.camera
    cam.data.lens = 50
    kit.frame_to(cam, root, margin=margin, aim_frac=0.5, elev=0.10)
    set_fog(cam.location.length)


def mask_shot(root):
    """Mask close-up at native resolution."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    pose_on_floor(PARTS_OBJ, STANCE)
    root.rotation_euler.z = math.radians(-24)
    bpy.context.view_layer.update()
    head = bpy.data.objects["head"]
    hc = head.matrix_world @ V((0, -0.03, 0.10))
    cam = sc.camera
    cam.data.lens = 50
    cam.location = hc + V((0.0, -0.95, 0.03))
    kit._aim(cam, hc + V((0, 0, -0.03)))
    set_fog(0.95, near_c=0.3, far_c=6.0)
    p = os.path.join(OUT, "mask.png")
    render_native(p)
    post(p)
    print("[gasser] mask ->", p)


def run_shot(root):
    """The game's runner pose at two opposite gait phases, seen from the side."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    frames = []
    for k, (s, c) in enumerate(((0.8, -0.6), (-0.8, 0.6))):
        pose_on_floor(PARTS_OBJ, run_pose(s, c))
        reframe(root, -72, 1.10)
        p = os.path.join(OUT, f"_run{k}.png")
        render_native(p)
        post(p)
        frames.append(load_png(p))
        os.remove(p)
    out = np.concatenate([frames[0], np.full((frames[0].shape[0], 12, 3), 0.03), frames[1]], 1)
    save_png(os.path.join(OUT, "run.png"), out)
    print("[gasser] run ->", os.path.join(OUT, "run.png"))


def rest_shot(root):
    """The export pose (rest: arms down, legs straight), front and side, to check the rig."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    frames = []
    for k, yaw in enumerate((0, -90)):
        pose_on_floor(PARTS_OBJ, {})
        reframe(root, yaw)
        p = os.path.join(OUT, f"_rest{k}.png")
        render_native(p)
        post(p)
        frames.append(load_png(p))
        os.remove(p)
    out = np.concatenate([frames[0], np.full((frames[0].shape[0], 12, 3), 0.03), frames[1]], 1)
    save_png(os.path.join(OUT, "rest.png"), out)
    print("[gasser] rest ->", os.path.join(OUT, "rest.png"))


def ingame(root, dist=6.2, name="ingame.png", pose=None, yaw=-16):
    """The Gasser at fighting distance in the bunker: 320x240, the game's 80 degree
    vertical field of view, dark fog, at `dist` metres."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    pose_on_floor(PARTS_OBJ, pose or STANCE)
    root.rotation_euler.z = math.radians(yaw)
    cam = sc.camera
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 24.0
    cam.data.lens = 12.0 / math.tan(math.radians(40))
    cam.location = (0.35 * dist / 4, -dist, 1.62)
    kit._aim(cam, (0.1, 0, 1.25))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (3.5, 3.5, 1)
    if not bpy.data.objects.get("Wall"):
        ng = fog_group()
        mix = ng.nodes.get("FogCols")
        mix.inputs[6].default_value = lin((5, 8, 7)); mix.inputs[7].default_value = lin((24, 33, 28))
        ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
        wimg = make_image("gas_wall", paint_wall())
        wmat = ps1_mat("GAS_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
        bm = bmesh.new()
        vv = [bm.verts.new(p) for p in ((-12, 2.6, 0), (12, 2.6, 0), (12, 2.6, 7.0), (-12, 2.6, 7.0))]
        bm.faces.new(vv)
        wall = kit.mesh_obj("Wall", bm, None, smooth=False)
        kit.assign(wall, wmat)
        dark = ps1_mat("GAS_EnvHole", make_image("gas_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
        bm = bmesh.new()
        vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
        bm.faces.new(vv)
        hole = kit.mesh_obj("Window", bm, None, smooth=False)
        kit.assign(hole, dark)
        wood = make_image("gas_wood", paint_wood())
        wm = ps1_mat("GAS_EnvWoodM", wood, None, vcol=False)
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
        chalk = ps1_mat("GAS_EnvChalk", make_image("gas_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                          [C((126, 38, 32)), C((160, 52, 42))]])),
                        None, vcol=False)
        strokes = [((0.70 + 0.11 * k, 1.42), (0.72 + 0.11 * k, 1.90)) for k in range(4)] + [((0.62, 1.50), (1.14, 1.80))]
        for k, ((xa, za), (xb, zb)) in enumerate(strokes):
            d = V((xb - xa, 0, zb - za)); nrm = V((-d.z, 0, d.x)).normalized() * 0.022
            bm = bmesh.new()
            vv = [bm.verts.new((p_.x, 2.585, p_.z)) for p_ in (V((xa, 0, za)) - nrm, V((xb, 0, zb)) - nrm,
                                                              V((xb, 0, zb)) + nrm, V((xa, 0, za)) + nrm)]
            bm.faces.new(vv)
            st = kit.mesh_obj(f"Chalk{k}", bm, None, smooth=False)
            kit.assign(st, chalk)
        for m in bpy.data.materials:
            a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
            if a:
                k_ = 0.55 if m.name.startswith("GAS_Env") else 0.85
                a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    set_fog((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=11.0, near_f=2.0, far_f=6.0)
    p = os.path.join(OUT, name)
    render_native(p, snap=False)          # the game's renderer does not snap vertices
    # a nearest-neighbour crop round the figure from the native frame, for inspection
    a = load_png(p)
    bpy.context.view_layer.update()
    cam_m = cam.matrix_world.inverted()
    pts = [cam_m @ (o.matrix_world @ v.co) for o in PARTS_OBJ for v in o.data.vertices]
    f_ = cam.data.lens / cam.data.sensor_height * 240
    xs = [160 + f_ * q.x / -q.z for q in pts]; ys = [120 - f_ * q.y / -q.z for q in pts]
    x0, x1 = int(max(0, min(xs) - 12)), int(min(320, max(xs) + 12))
    y0, y1 = int(max(0, min(ys) - 8)), int(min(240, max(ys) + 8))
    save_png(os.path.join(OUT, name.replace(".png", "_crop.png")), a[y0:y1, x0:x1], 6)
    post(p)
    print("[gasser] ingame ->", p)


kit.run(STYLE, build, stage, post,
        meta={"technique": "rigid faceted prisms (hard normals > 30 deg) in the game rig's rest pose, posed by FK; "
                           "256px page, <=16-colour CLUT per region, painted light x Cycles-baked AO/facet light, "
                           "edge highlights; native 300x400 + composite/CRT post; the Rotted's warm-key/cool-rim light",
              "texture_page": "256x256", "game_model": "public/models/gasser.json"})
ROOT = bpy.data.objects["ZOMBIE_gasser"]
if FINAL or "--mask" in ARGS:
    mask_shot(ROOT)
if FINAL or "--run" in ARGS:
    run_shot(ROOT)
if FINAL or "--rest" in ARGS:
    rest_shot(ROOT)
if FINAL or "--ingame" in ARGS:
    ingame(ROOT, 5.5, "ingame.png")
    ingame(ROOT, 6.0, "ingame_run.png", pose=run_pose(0.8, -0.6), yaw=-40)
    ingame(ROOT, 8.0, "ingame_8m.png")
