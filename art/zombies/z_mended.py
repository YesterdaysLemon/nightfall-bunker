# The Mended (game id `mended`): a dead airfield mechanic whose shattered body was put
# back together like kintsugi. He joins the Polygon Ghoul and the porcelain Kintsugi boss
# on the same 1997 disc (art/STYLE.md).
#
# Design:
#   - face, neck, forearms and the bare left hand are matte bone-porcelain plates joined
#     by gold seams; a chip is missing at the right temple; milky painted eyes (plus an
#     unlit `eyes` part like the Ghoul's);
#   - olive coveralls (the world `trousers` ramp) with the sleeves rolled to the elbow, a
#     few gold-mended cracks across the cloth, grease wiped down the thighs;
#   - a slung leather tool belt with a hanging open-end wrench and a pouch, heavy boots,
#     a tan split-leather welding gauntlet on the right hand;
#   - a tall, flat-topped canvas welding cap (`weldcap`) with a short visor and brass
#     goggles pushed up on it; broad squared shoulders.
# Build: like Ghoul v3 (z_ps1c.py, the reference): rigid faceted prisms (hard normals
# over 30 degrees) built UN-POSED in the game's zombie rig (rest pose, joint-local parts)
# and posed by forward kinematics with three.js joint rotations. One 256px page with
# per-region 16-colour CLUTs, Cycles-baked AO/facet light painted in at ~60 %, edge
# highlights. The head is NOT mirrored (the cracks are asymmetric): its UVs wrap once,
# front-weighted, and the porcelain is painted in 3D from baked positions (explicit crack
# polylines on the face, jittered 3D Voronoi plates on the neck, arms and hand), so the
# seams run on across UV borders. Gold texels also go on a glow page.
#
#   node art/zombies/blend.mjs z_mended.py --preview [--views front,side,back] [--face] [--walk] [--ingame]
#   node art/zombies/blend.mjs z_mended.py --export   (game model + texture only, no renders)
#   node art/zombies/blend.mjs z_mended.py --final    (heroes, turntable, face, walk, ingame, export)
# Every render run also exports public/models/mended.json + mended.png + mended_glow.png.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree

STYLE = "mended"
OUT = os.path.join(kit.OUT_BASE, STYLE)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DBG = os.path.join(OUT, "_d") if os.environ.get("MENDED_DEBUG") else None
EXPORT_DIR = os.path.join(kit.ROOT, "public", "models")
GAME_ID = "mended"
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP_DEG = 30.0                            # split normals above this dihedral angle
EDGE_HI, EDGE_LO = 0.30, 0.80               # painted ridge highlight / crease darkening
KEY = V((0.0, -0.42, 0.91)).normalized()    # painted key: a bulb above, slightly in front
GLOW_C = (236, 188, 110)                    # glow page colour of the gold seams
GLOW_PREVIEW = 0.32                         # emission strength used in the renders
TAU = 2 * math.pi

# ---------------------------------------------------------------- CLUT ramps (sRGB, dark -> light, lit base)
# The world palette (z_ps1b/z_ps1c RAMPS) plus bone porcelain, gold, the canvas cap,
# dull brass and dark goggle glass: same value range, cool shadows, warm highlights.
RAMPS = {
    "skin": ([(32, 30, 36), (50, 50, 54), (70, 72, 70), (92, 96, 88), (114, 118, 104),
              (136, 140, 120), (160, 162, 138), (188, 186, 158)], 5),
    "blood": ([(38, 4, 8), (92, 14, 16), (140, 30, 24)], 1),
    "bloodc": ([(36, 12, 12), (66, 20, 18), (96, 30, 24)], 1),
    "bloodc2": ([(44, 14, 14), (80, 24, 20)], 1),
    "shirt": ([(32, 32, 30), (50, 48, 38), (70, 66, 46), (92, 86, 58), (116, 108, 72), (144, 134, 92)], 3),
    "khaki": ([(92, 80, 56), (138, 124, 88), (182, 168, 126)], 1),
    "metal": ([(60, 58, 56), (170, 166, 150)], 1),
    "metal1": ([(170, 166, 150)], 0),
    "trousers": ([(24, 27, 27), (36, 40, 35), (50, 55, 43), (65, 71, 54), (82, 88, 66),
                  (102, 107, 80), (126, 128, 98)], 4),
    "leather": ([(18, 14, 14), (32, 25, 22), (47, 36, 28), (64, 49, 36), (86, 68, 50)], 3),
    "mud": ([(66, 56, 42), (100, 88, 64)], 1),
    "dirt": ([(40, 34, 30), (74, 64, 50)], 1),
    "steel": ([(34, 34, 36), (70, 70, 68), (112, 110, 102)], 1),
    "concrete": ([(26, 30, 28), (36, 40, 37), (46, 50, 45), (58, 62, 55), (72, 75, 66)], 3),
    "wood": ([(30, 22, 18), (46, 34, 26), (64, 48, 34), (86, 66, 46)], 2),
    # bone porcelain: matte, a warm yellowed white, never pure white
    "porc": ([(42, 38, 44), (66, 62, 64), (94, 88, 86), (124, 116, 106), (152, 142, 124), (178, 166, 142),
              (202, 190, 162), (224, 212, 182)], 5),
    "porc3": ([(124, 116, 106), (178, 166, 142), (214, 202, 172)], 1),
    "gold": ([(100, 70, 28), (182, 140, 62), (240, 208, 130)], 1),
    "wsteel": ([(40, 40, 42), (76, 76, 74), (116, 114, 106), (160, 156, 142)], 2),
    "hollow": ([(16, 13, 14), (38, 32, 30), (62, 54, 46)], 1),
    "canvas": ([(34, 32, 28), (56, 52, 42), (82, 76, 58), (110, 102, 76), (140, 130, 98), (170, 160, 122)], 3),
    "brass": ([(46, 36, 22), (84, 66, 36), (124, 100, 56), (164, 136, 80)], 2),
    "lens": ([(8, 12, 12), (20, 28, 26), (44, 58, 52), (104, 124, 112)], 1),
    "grease": ([(20, 18, 16), (40, 36, 30)], 1),
}


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMP_C = {k: np.array(v[0], float) / 255.0 for k, v in RAMPS.items()}
# porcelain is a pale material: light 1.0 maps above its base entry, so it stays bone-white under painted shade
RAMP_GAIN = {"porc": 1.4, "porc3": 1.4}
RAMP_LL = {k: np.log(np.array([_luma(c) for c in v[0]]) / (_luma(v[0][v[1]]) * RAMP_GAIN.get(k, 1.0)))
           for k, v in RAMPS.items()}

# texture page layout: name -> (x0, y0, w, h), top-left origin
REG = {
    "head": (0, 0, 128, 96), "torso": (128, 0, 128, 64), "pelvis": (128, 64, 128, 24), "belt": (128, 88, 128, 8),
    "boot": (0, 96, 64, 24), "foot": (64, 96, 64, 24), "weldcap": (128, 96, 96, 24),
    "neck": (224, 96, 32, 16), "brim": (224, 112, 32, 8),
    "thigh.L": (0, 120, 64, 48), "thigh.R": (64, 120, 64, 48), "shin.L": (128, 120, 64, 48), "shin.R": (192, 120, 64, 48),
    "uarm.L": (0, 168, 48, 32), "uarm.R": (48, 168, 48, 32),
    "palm.L": (96, 168, 32, 16), "fing.L": (128, 168, 32, 16), "palm.R": (96, 184, 32, 16), "fing.R": (128, 184, 32, 16),
    "thumb.L": (160, 168, 16, 16), "thumb.R": (160, 184, 16, 16),
    "ear": (176, 168, 16, 16), "nose": (192, 168, 16, 16), "lens": (208, 168, 16, 16), "pouch": (224, 168, 32, 16),
    "eyes": (176, 184, 16, 8), "collar": (192, 184, 16, 8), "brass": (208, 184, 16, 8), "wrench": (224, 184, 32, 8),
    "farm.L": (0, 200, 48, 48), "farm.R": (48, 200, 48, 48), "hair": (96, 200, 16, 8),
}
_occ = np.zeros((AT, AT), int)
for _n, (_x, _y, _w, _h) in REG.items():
    _occ[_y:_y + _h, _x:_x + _w] += 1
assert _occ.max() == 1, "texture regions overlap"

# ---------------------------------------------------------------- the game rig
# three.js space (+Y up, facing +Z, character's left = +X), pos relative to the parent.
# Same names and hierarchy as the Ghoul; the shoulders are a little broader (0.28).
JOINTS = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.95, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.55, 0.02)), ("shL", "spine", (0.28, 0.49, 0.0)), ("shR", "spine", (-0.28, 0.49, 0.0)),
    ("elL", "shL", (0.0, -0.33, 0.0)), ("elR", "shR", (0.0, -0.33, 0.0)),
    ("hipL", "hips", (0.1, -0.04, 0.0)), ("hipR", "hips", (-0.1, -0.04, 0.0)),
    ("knL", "hipL", (0.0, -0.46, 0.0)), ("knR", "hipR", (0.0, -0.46, 0.0)),
]
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("weldcap", "neck"), ("eyes", "neck"),
         ("upperArm.L", "shL"), ("upperArm.R", "shR"), ("lowerArm.L", "elL"), ("lowerArm.R", "elR"),
         ("upperLeg.L", "hipL"), ("upperLeg.R", "hipR"), ("lowerLeg.L", "knL"), ("lowerLeg.R", "knR")]
HEAD_PARTS = ["head", "eyes", "weldcap"]            # hide all three on a headshot
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
# hero stills: stiff and lopsided, the right shoulder dropped, arms hanging a little apart
HERO = {"spine": (0.10, 0.04, 0.12), "neck": (-0.02, 0.20, -0.24),
        "shL": (-0.28, 0.0, 0.11), "shR": (-0.10, 0.0, -0.07), "elL": (-0.42, 0.0, 0.0), "elR": (-0.12, 0.0, 0.0),
        "hipL": (-0.08, 0.0, 0.03), "knL": (0.10, 0.0, 0.0), "hipR": (0.06, 0.0, -0.03), "knR": (0.04, 0.0, 0.0)}


def walk_pose(ph=1.1, t=0.7, arm_drop=0.3, head_tilt=0.2):
    """Zombies.pose() for a walker (src/client/render/zombies.js), mid stride."""
    amp, s, c = 0.42, math.sin(ph), math.cos(ph)
    sway = math.sin(t * 1.3) * 0.05
    return {"hipL": (s * amp, 0, 0), "hipR": (-s * amp, 0, 0),
            "knL": (max(0.0, -c) * amp * 1.4 + 0.05, 0, 0), "knR": (max(0.0, c) * amp * 1.4 + 0.05, 0, 0),
            "spine": (0.16 + sway, 0, s * 0.07),
            "shL": (-1.4 + arm_drop * 0.6 + math.sin(t * 1.7) * 0.08, 0, 0.1),
            "shR": (-1.35 + math.cos(t * 1.9) * 0.08, 0, -0.1),
            "elL": (-0.15, 0, 0), "elR": (-0.3, 0, 0),
            "neck": (-0.1 + math.sin(t * 2.1) * 0.08, math.sin(t * 0.7) * 0.2, head_tilt)}


WALK = walk_pose()


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


def inpoly(X, Y, poly):
    inside = np.zeros(X.shape, bool)
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        inside ^= ((y1 > Y) != (y2 > Y)) & (X < (x2 - x1) * (Y - y1) / (y2 - y1 + 1e-12) + x1)
    return inside


def texel_size(P):
    """Metres per texel from baked positions (the smaller of the two neighbour steps,
    so island borders don't count), the larger of the two directions."""
    dx = np.linalg.norm(np.diff(P, axis=1), axis=-1)
    dy = np.linalg.norm(np.diff(P, axis=0), axis=-1)
    ex = np.minimum(np.pad(dx, ((0, 0), (1, 0)), mode="edge"), np.pad(dx, ((0, 0), (0, 1)), mode="edge"))
    ey = np.minimum(np.pad(dy, ((1, 0), (0, 0)), mode="edge"), np.pad(dy, ((0, 1), (0, 0)), mode="edge"))
    return np.clip(np.maximum(ex, ey), 0.0015, 0.02)


def warp3(P, freq, seed, octaves=3):
    """Smooth 3D wobble (sum of sines) so Voronoi borders wander like cracks."""
    rg = np.random.default_rng(seed)
    out = np.zeros_like(P)
    for c in range(3):
        for k in range(octaves):
            d = rg.normal(size=3); d /= np.linalg.norm(d)
            out[..., c] += np.sin((P @ d) * freq * 2.1 ** k + rg.uniform(0, TAU)) / 2.0 ** k
    return out / 1.75


def voronoi(P, seeds, jit, freq, seed):
    """Nearest seed per texel and the distance to the bisector with the second nearest."""
    Q = P + jit * warp3(P, freq, seed)
    S = np.array([tuple(s) for s in seeds], float)
    D = np.linalg.norm(Q[..., None, :] - S[None, None], axis=-1)
    order = np.argsort(D, -1)
    i1, i2 = order[..., 0], order[..., 1]
    d1 = np.take_along_axis(D, i1[..., None], -1)[..., 0]
    d2 = np.take_along_axis(D, i2[..., None], -1)[..., 0]
    sep = np.linalg.norm(S[i1] - S[i2], axis=-1)
    return i1, (d2 ** 2 - d1 ** 2) / (2 * np.maximum(sep, 1e-6))


def poly_dist(P, pts):
    """Distance from texel positions P (h, w, 3) to a 3D polyline."""
    d = np.full(P.shape[:2], 9.0)
    for a, b in zip(pts, pts[1:]):
        a = np.array(a, float); b = np.array(b, float); ab = b - a
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        d = np.minimum(d, np.linalg.norm(P - (a + t[..., None] * ab), axis=-1))
    return d


# ---------------------------------------------------------------- the painter

class Reg:
    """One texture-page region painted as material ids + painted light, in metres.
    X runs round the part (0 = front centre, + = character's left for downward parts,
    wraps if P), Y runs down the part (0 = first ring). Quantised to the part's CLUT by finish()."""

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
            print(f"[mended] WARNING region {s.name} uses {n} colours")
        return out

    def gold_mask(s):
        return s.id == s.m("gold") if "gold" in s.mats else np.zeros((s.h, s.w), bool)


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


def seam_glints(r, seam, seed, thr=0.62):
    """The odd bright texel along a gold seam."""
    n = lowfreq(np.random.default_rng(seed + 5), r.h, r.w, 1.3)
    r.overlay(seam & (n > thr), "gold", 2)


def cloth_crack(r, x, y, ang, length, seed):
    """A rip in the cloth mended the kintsugi way: a dark jagged tear laddered with
    gold stitches across it, the odd stitch catching the light."""
    rg = np.random.default_rng(seed)
    t = max(r.tx, r.ty)
    step = 1.6 * t
    pts = [(x, y)]
    for _ in range(max(2, int(length / step))):
        a = ang + rg.uniform(-0.7, 0.7)                     # zigzag about one heading: a tear, not a curl
        pts.append((pts[-1][0] + math.cos(a) * step, pts[-1][1] + math.sin(a) * step))
    w = 0.5 * t
    r.line([(p[0], p[1] + 1.1 * r.ty) for p in pts], w, f=0.74)
    r.line(pts, w, f=0.42)
    for i in range(1, len(pts) - 1, 2):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i + 1]
        L = max(1e-9, math.hypot(x1 - x0, y1 - y0))
        nx, ny = -(y1 - y0) / L * 1.5 * t, (x1 - x0) / L * 1.5 * t
        r.line([(pts[i][0] - nx, pts[i][1] - ny), (pts[i][0] + nx, pts[i][1] + ny)], w, "gold")
        if i % 6 == 1:
            r.fix(pts[i][0] + nx * 0.5, pts[i][1] + ny * 0.5, "gold", 2)
    return pts


def seam_shadow(r, seam, f=0.74):
    """The texel under a seam (rows run down the part) in the plate edge's shadow."""
    below = np.zeros_like(seam)
    below[1:] = seam[:-1]
    r.lit(below & ~seam, f)


def porcelain(r, P, seeds, seed, width=1.25, vary=0.075, jit=0.010, freq=34.0, where=None):
    """Gold seams along the (wobbled) 3D Voronoi borders between porcelain plates, and a
    slightly different painted light per plate. P: rest-pose texel positions (world)."""
    tsz = texel_size(P)
    cell, delta = voronoi(P, seeds, jit, freq, seed)
    seam = delta < 0.5 * width * tsz
    if where is not None:
        seam &= where
    f = np.random.default_rng(seed + 17).uniform(1 - vary, 1 + vary, len(seeds))
    k = f[cell] if where is None else np.where(where, f[cell], 1.0)
    r.sh *= k
    seam_shadow(r, seam)
    r.put(seam, "gold")
    seam_glints(r, seam, seed)
    return seam, cell


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
    """Half profile k = 0 (back centre) .. n/2 (front centre) round one side
    (x <= 0, y + = front) -> the full closed ring, mirrored for the other side."""
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
    """Ten-sided faceted box (torso, pelvis, belt): flat back, bevelled shoulder blades,
    flat sides, bevelled chest corners, flat front with a faint sternum ridge."""
    return sym(_push([[0, -db, 0], [-0.62 * w, -0.97 * db, 0], [-w, -0.40 * db, 0], [-w, 0.35 * df, 0],
                      [-0.68 * w, 0.93 * df, 0], [0, df, 0]], push))


def hbox(w, db, df, push=None):
    """Twelve-sided faceted skull ring: flat back, back corners, flat sides, front
    corners (cheekbones), and a face front split at the eye line."""
    return sym(_push([[0, -db, 0], [-0.60 * w, -0.97 * db, 0], [-0.95 * w, -0.50 * db, 0], [-w, 0.02 * df, 0],
                      [-0.90 * w, 0.52 * df, 0], [-0.47 * w, 0.92 * df, 0], [0, df, 0]], push))


def capprof(w, db, df):
    """Ten-sided cap crown with a wide flat front (for the goggles)."""
    return sym([[0, -db, 0], [-0.62 * w, -0.97 * db, 0], [-w, -0.40 * db, 0], [-w, 0.42 * df, 0],
                [-0.64 * w, df, 0], [0, df, 0]])


def twist(pts, deg):
    a = math.radians(deg); c, s_ = math.cos(a), math.sin(a)
    return [[p[0] * c - p[1] * s_, p[0] * s_ + p[1] * c, p[2]] for p in pts]


def uv_in(reg, x, v):
    x0, y0, w, h = reg
    eps = 0.02
    col = min(max(x * w, eps), w - eps)
    row = min(max((1 - v) * h, eps), h - eps)
    return ((x0 + col) / AT, 1 - (y0 + row) / AT)


def loft(name, cs, profs, fref, reg, caps=(True, True), mirror=None, vs=None, apex=(None, None), cap_u=None,
         uwarp=None):
    """A rigid segment: rings of profile points (x side, y front[, a back along the
    centre line]) round a centre line. UVs wrap round the ring by arc length (optionally
    re-spaced by `uwarp`), or mirrored (0 = front centre, `mirror` = the side vertex,
    1 = back centre), and run along the segment (v = 1 at the first ring). An end is
    open, capped flat (a flat colour from the end row) or closed by a fan to an `apex`.
    Faces are smooth; harden() splits the sharp edges."""
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
            xs.append([(uwarp(l / L[-1]) if uwarp else l / L[-1]) for l in L])
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


def hit(tree, org, dirn, lift=0.0):
    """Surface point along a ray, lifted along its (outward-facing) normal."""
    dirn = V(dirn).normalized()
    loc, nrm, idx, dist = tree.ray_cast(V(org), dirn)
    if loc is None:
        return None, None
    if nrm.dot(dirn) > 0:
        nrm = -nrm
    return loc + nrm * lift, nrm


def hit_front(tree, x, z, lift=0.0):
    return hit(tree, (x, -2.0, z), (0, 1, 0), lift)


VIEW_RAY = {"front": lambda a, b: ((a, -2.0, b), (0, 1, 0)), "back": lambda a, b: ((a, 2.0, b), (0, -1, 0)),
            "left": lambda a, b: ((2.0, a, b), (-1, 0, 0)), "right": lambda a, b: ((-2.0, a, b), (1, 0, 0))}


def crack_path(tree, pts2, view, seed, jag=0.18, step=0.005):
    """A crack designed as 2D points in a view plane (front/back: (x, z); left/right:
    (y, z)), subdivided with jagged midpoints and projected onto the surface."""
    rg = np.random.default_rng(seed)
    pts = [tuple(p) for p in pts2]

    def split(a, b, depth):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < step or depth > 6:
            return [a]
        o = rg.uniform(-jag, jag) * L
        m = ((a[0] + b[0]) / 2 - (b[1] - a[1]) / L * o, (a[1] + b[1]) / 2 + (b[0] - a[0]) / L * o)
        return split(a, m, depth + 1) + split(m, b, depth + 1)
    dense = []
    for a, b in zip(pts, pts[1:]):
        dense += split(a, b, 0)
    dense.append(pts[-1])
    out = []
    for a, b in dense:
        org, dr = VIEW_RAY[view](a, b)
        loc, _ = hit(tree, org, dr)
        if loc is not None:
            out.append(tuple(loc))
    return out


# ---------------------------------------------------------------- geometry: the parts (rest pose, world)

HEAD_YC = -0.022
# head rings, top (under the cap) .. under the jaw: (z, y offset, half-width, back, front, pushes {k: (out, fwd[, up])})
HEADR = [
    (1.778, 0.004, 0.082, 0.090, 0.082, {}),                                                   # under the cap
    (1.738, 0.000, 0.097, 0.104, 0.102, {}),                                                   # temples, cap band
    (1.710, 0.000, 0.099, 0.104, 0.104, {4: (0.002, 0.010), 5: (0.004, 0.016), 6: (0, 0.010)}),   # brow shelf
    (1.690, 0.000, 0.096, 0.102, 0.098, {4: (0, -0.006), 5: (-0.004, -0.022), 6: (0, -0.004)}),   # deep sockets
    (1.650, 0.000, 0.097, 0.098, 0.100, {4: (0.014, 0.014), 5: (0.0, -0.004)}),                   # sharp cheekbones
    (1.606, 0.000, 0.080, 0.088, 0.096, {3: (0, 0, 0.004), 4: (-0.012, -0.012), 5: (-0.006, -0.008),
                                         6: (0, -0.002)}),                                        # hollow cheeks
    (1.576, 0.000, 0.070, 0.078, 0.094, {0: (0, 0, 0.018), 1: (0, 0, 0.018), 2: (0, 0, 0.012), 3: (0, 0, 0.006),
                                         4: (-0.008, -0.010), 5: (-0.006, -0.002), 6: (0, 0.006)}),  # jaw, mouth
    (1.548, 0.000, 0.044, 0.056, 0.086, {0: (0, 0, 0.030), 1: (0, 0, 0.030), 2: (0, 0, 0.022), 3: (0, 0, 0.012),
                                         4: (-0.010, -0.008), 5: (-0.010, 0.006), 6: (0, 0.012)}),   # wedge chin
]
HEAD_ROWS = (4, 12, 24, 36, 53, 69, 81, 90)     # texel rows of the rings (the face gets most)
EYE = (0.040, 1.672)                           # eye centre (|x|, z)


def head_warp(u):
    """Front-weighted wrap: the front half of the head gets ~68 % of the columns."""
    if u < 0.25:
        return u * 0.64
    if u > 0.75:
        return 0.84 + (u - 0.75) * 0.64
    return 0.16 + (u - 0.25) * 1.36


# The face cracks, designed in views and projected onto the head (x = character's left).
FACE_CRACKS = [
    ("front", [(0.030, 1.745), (0.034, 1.728), (0.027, 1.716), (0.036, 1.704), (0.057, 1.694), (0.066, 1.679),
               (0.062, 1.662), (0.072, 1.646), (0.066, 1.628), (0.076, 1.610), (0.070, 1.592), (0.074, 1.574),
               (0.062, 1.558)]),                                                 # down through the left eye's corner
    ("front", [(-0.050, 1.745), (-0.040, 1.730), (-0.028, 1.722), (-0.016, 1.708), (-0.012, 1.696),
               (-0.020, 1.684), (-0.021, 1.668), (-0.025, 1.652), (-0.022, 1.636), (-0.028, 1.620),
               (-0.020, 1.606), (-0.013, 1.598)]),                               # forehead, beside the nose, the lip
    ("front", [(-0.013, 1.584), (-0.022, 1.571), (-0.014, 1.557), (-0.019, 1.546)]),   # under the mouth
    ("front", [(-0.025, 1.652), (-0.040, 1.646), (-0.052, 1.651), (-0.066, 1.640), (-0.080, 1.645),
               (-0.090, 1.636), (-0.099, 1.641)]),                               # across the right cheek
    ("front", [(0.034, 1.728), (0.050, 1.722), (0.062, 1.729), (0.076, 1.720), (0.090, 1.727), (0.100, 1.719)]),
    ("front", [(0.070, 1.592), (0.054, 1.584), (0.040, 1.577), (0.030, 1.566), (0.018, 1.560), (0.010, 1.549)]),
    ("left", [(-0.062, 1.702), (-0.035, 1.694), (-0.006, 1.700), (0.022, 1.686), (0.050, 1.672), (0.070, 1.652),
              (0.082, 1.628)]),                                                   # on round the left temple
    ("right", [(-0.020, 1.641), (0.010, 1.636), (0.035, 1.622), (0.052, 1.606), (0.062, 1.588), (0.070, 1.574)]),
    ("back", [(0.040, 1.735), (0.022, 1.712), (0.032, 1.690), (0.004, 1.670), (-0.020, 1.650), (-0.010, 1.626),
              (-0.030, 1.600)]),
]
FACE_HAIRLINES = [
    ("front", [(0.072, 1.646), (0.082, 1.656), (0.092, 1.652)]),
    ("front", [(-0.028, 1.722), (-0.020, 1.737)]),
    ("front", [(0.006, 1.566), (-0.004, 1.576), (-0.002, 1.584)]),
    ("front", [(-0.052, 1.651), (-0.050, 1.664)]),
]
CHIP = [(-0.041, 1.726), (-0.046, 1.716), (-0.058, 1.703), (-0.066, 1.699), (-0.054, 1.713)]   # missing sliver
SEAMS = {}                                           # built 3D crack polylines, per painter


def build_rest():
    """Every part in the rest pose, in world coordinates (Blender: Z up, facing -Y,
    left = +X). Returns (loft infos for painting, {part name: [objects]})."""
    I, G = {}, {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1)); dn = V((0, 0, -1))

    # ---- head: faceted box skull, one front-weighted wrap (not mirrored), wedge nose, ear tabs
    head, I["head"] = loft("head", [(0, HEAD_YC + yo, z) for z, yo, *_ in HEADR],
                           [hbox(w, db, df, p) for z, yo, w, db, df, p in HEADR], fwd, REG["head"],
                           vs=[1 - r / REG["head"][3] for r in HEAD_ROWS], uwarp=head_warp,
                           apex=((0, HEAD_YC - 0.002, 1.792), (0, HEAD_YC + 0.012, 1.566)))
    yf = lambda f: HEAD_YC - f                         # forward distance -> world y
    top, tip = (0, yf(0.097), 1.692), (0, yf(0.132), 1.628)
    nose = []
    for sx in (1, -1):
        base = (sx * 0.017, yf(0.098), 1.616)
        nose.append(([top, tip, base], [("nose", 0.5, 0.02), ("nose", 0.5, 0.8), ("nose", 0.5 + sx * 0.46, 0.8)],
                     (sx, -1, 0.3)))
    nose.append(([(0.017, yf(0.098), 1.616), tip, (-0.017, yf(0.098), 1.616)],
                 [("nose", 0.96, 0.9), ("nose", 0.5, 0.8), ("nose", 0.04, 0.9)], (0, -0.3, -1)))
    nose_ob = poly_obj("nose", nose)
    ears = []
    for sx in (1, -1):
        rt, rb = (sx * 0.095, yf(-0.004), 1.694), (sx * 0.093, yf(-0.010), 1.630)
        tt, tb = (sx * 0.119, yf(-0.030), 1.702), (sx * 0.111, yf(-0.034), 1.640)
        uv = [("ear", 0.02, 0.02), ("ear", 0.98, 0.02), ("ear", 0.98, 0.98), ("ear", 0.02, 0.98)]
        ears.append(([rt, tt, tb, rb], uv, (sx, 0.4, 0)))
        ears.append(([(p[0] - sx * 0.002, p[1], p[2]) for p in (rt, tt, tb, rb)], uv, (-sx, -0.4, 0)))
    ear_ob = poly_obj("ears", ears)
    head_tree = bvh(head)
    # hair tufts poking out under the back of the cap: thin two-sided wedges
    tufts = []
    huv = [("hair", 0.05, 0.1), ("hair", 0.95, 0.1), ("hair", 0.5, 0.95)]
    for k, (ph, ln) in enumerate(((2.00, 0.026), (2.50, 0.031), (math.pi, 0.024), (-2.50, 0.031), (-2.00, 0.026))):
        d = V((math.sin(ph), -math.cos(ph), 0))
        loc, _ = hit(head_tree, V((0, HEAD_YC, 1.708)) + d * 0.5, -d)
        if loc is None:
            continue
        side = V((0, 0, 1)).cross(d).normalized()
        p0, p1 = loc - side * 0.012 - d * 0.004, loc + side * 0.012 - d * 0.004
        tip = loc + d * ln + V((0, 0, -0.017)) + side * (0.005 if k % 2 else -0.005)
        tufts.append(([p0, p1, tip], huv, tuple(d + V((0, 0, 1)))))
        tufts.append(([p1, p0, tip + V((0, 0, -0.005)) - d * 0.003], huv, tuple(d + V((0, 0, -1.5)))))
    G["head"] = [head, nose_ob, ear_ob, poly_obj("tufts", tufts)]
    SEAMS["head"] = [crack_path(head_tree, pts, view, 300 + k) for k, (view, pts) in enumerate(FACE_CRACKS)]
    SEAMS["head_hair"] = [crack_path(head_tree, pts, view, 350 + k, jag=0.3) for k, (view, pts) in
                          enumerate(FACE_HAIRLINES)]

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

    # ---- welding cap: a tall ten-sided crown with a flat top and a wide flat front, tipped
    # back and a touch to the left; a short visor; brass goggles pushed up on the front
    CAPC = HEAD_YC + 0.006
    CAPR = [(1.874, 0.098, 0.097, 0.100), (1.860, 0.115, 0.113, 0.117), (1.752, 0.108, 0.113, 0.114),
            (1.726, 0.106, 0.111, 0.113)]                                   # chamfered flat top .. band
    cap, I["weldcap"] = loft("weldcap", [(0, CAPC, z) for z, *_ in CAPR], [capprof(w, db, df) for z, w, db, df in CAPR],
                             fwd, REG["weldcap"], (True, False), cap_u=0.25)
    piv = V((0, CAPC, 1.726))
    MC = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-7), 4, "X") @ \
        Matrix.Rotation(math.radians(3), 4, "Y") @ Matrix.Translation(-piv)
    cap.data.transform(MC)
    # visor: along the front of the base ring, thick at the crown, thin at the lip, angled down
    z0, w0, db0, df0 = CAPR[-1]
    ring = [V((p[0], CAPC - p[1], z0 + 0.003)) for p in capprof(w0, db0, df0)]
    arc = [3, 4, 5, 6, 7]
    ext = [0.016, 0.056, 0.068, 0.056, 0.016]; drop = [0.004, 0.015, 0.019, 0.015, 0.004]
    ctr = V((0, CAPC, 0))
    inner = [ring[k] for k in arc]
    outer = []
    for p, e, dz in zip(inner, ext, drop):
        dr = V((p.x - ctr.x, p.y - ctr.y, 0)).normalized()
        outer.append(p + dr * e + V((0, 0, -dz)))
    lower = [p + V((0, 0, -0.009)) for p in inner]
    inner, outer, lower = ([MC @ p for p in L] for L in (inner, outer, lower))
    brim = []
    for k in range(4):
        u0, u1 = k / 4, (k + 1) / 4
        brim.append(([inner[k], inner[k + 1], outer[k + 1], outer[k]],
                     [("brim", u0, 0.05), ("brim", u1, 0.05), ("brim", u1, 0.44), ("brim", u0, 0.44)], (0, -0.2, 1)))
        brim.append(([lower[k], lower[k + 1], outer[k + 1], outer[k]],
                     [("brim", u0, 0.95), ("brim", u1, 0.95), ("brim", u1, 0.56), ("brim", u0, 0.56)], (0, -0.2, -1)))
    brim_ob = poly_obj("brim", brim)
    cap_tree = bvh(cap)
    gog = []
    lens_c = {}
    for sx in (1, -1):
        loc, n = hit_front(cap_tree, sx * 0.041, 1.816)
        if loc is None:
            loc, n = V((sx * 0.041, CAPC - 0.12, 1.816)), V((0, -1, 0))
        a = (n + V((0, 0, 0.30))).normalized()
        u1 = V((1, 0, 0)); u1 = (u1 - a * u1.dot(a)).normalized()
        u2 = a.cross(u1).normalized()
        if u2.z < 0:
            u2 = -u2
        base = [loc - a * 0.004 + (u1 * math.cos(k * TAU / 6) + u2 * math.sin(k * TAU / 6)) * 0.0285 for k in range(6)]
        front = [loc + a * 0.021 + (u1 * math.cos(k * TAU / 6) + u2 * math.sin(k * TAU / 6)) * 0.0245 for k in range(6)]
        for k in range(6):
            k1 = (k + 1) % 6
            mid = (base[k] + base[k1] + front[k] + front[k1]) / 4
            gog.append(([base[k], base[k1], front[k1], front[k]],
                        [("brass", k / 6, 0.92), ("brass", (k + 1) / 6, 0.92), ("brass", (k + 1) / 6, 0.08),
                         ("brass", k / 6, 0.08)], tuple(mid - (loc + a * 0.008))))
        gog.append((front, [("lens", 0.5 + 0.47 * math.cos(k * TAU / 6), 0.5 - 0.47 * math.sin(k * TAU / 6))
                            for k in range(6)], tuple(a)))
        lens_c[sx] = (loc, a, u1, u2, front)
    # the bridge between the lenses
    fl, fr = lens_c[1][4][3], lens_c[-1][4][0]             # inner front vertices (left lens at 180 deg, right at 0)
    au = (lens_c[1][3] + lens_c[-1][3]).normalized() * 0.0055
    aa = (lens_c[1][1] + lens_c[-1][1]).normalized() * -0.008
    gog.append(([fl + au, fr + au, fr - au + aa, fl - au + aa],
                [("brass", 0.1, 0.1), ("brass", 0.9, 0.1), ("brass", 0.9, 0.9), ("brass", 0.1, 0.9)],
                tuple((lens_c[1][1] + lens_c[-1][1]).normalized())))
    G["weldcap"] = [cap, brim_ob, poly_obj("goggles", gog)]

    # ---- torso: faceted box, broad squared shoulders (a flat plateau, a vertical corner),
    # narrower chest and waist; neck; pointed coverall collar
    TORSO = [(1.545, 0.012, 0.105, 0.072, 0.064, {}),
             (1.522, 0.012, 0.236, 0.110, 0.098, {1: (0, -0.010)}),
             (1.470, 0.008, 0.240, 0.118, 0.112, {1: (0, -0.010)}),
             (1.350, 0.000, 0.206, 0.124, 0.124, {}),
             (1.095, 0.004, 0.158, 0.100, 0.102, {}),
             (0.990, 0.004, 0.166, 0.102, 0.106, {})]
    tv = [0.0, 0.075, 0.13, 0.25, 0.51, 0.62]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO],
                             [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO], fwd, REG["torso"], (True, False),
                             vs=[1 - c / tv[-1] for c in tv], cap_u=0.27)
    neck, I["neck"] = loft("neck", [(0, 0.004, 1.470), (0, -0.016, 1.615)],
                           [hexprof(0.052, 0.054, {3: (0, 0.004)}), hexprof(0.048, 0.050, {3: (0, 0.004)})],
                           fwd, REG["neck"], (False, False))
    tt = bvh(torso)
    flaps = []
    for sx in (1, -1):
        a, _ = hit_front(tt, sx * 0.032, 1.536, 0.004)
        b, _ = hit_front(tt, sx * 0.108, 1.508, 0.004)
        c, nc = hit_front(tt, sx * 0.062, 1.420, 0.010)
        if a is None or b is None or c is None:
            continue
        flaps.append(([a, b, c], [("collar", 0.02, 0.02), ("collar", 0.98, 0.02), ("collar", 0.5, 0.98)], tuple(nc)))
    G["torso"] = [torso, neck] + ([poly_obj("collar", flaps)] if flaps else [])

    # ---- pelvis: the coverall seat; a slung tool belt (lower on the right), a hanging
    # open-end wrench on the right hip and a pouch on the left
    PEL = [(1.062, 0.004, 0.172, 0.104, 0.108), (0.925, 0.006, 0.196, 0.126, 0.118),
           (0.815, 0.004, 0.160, 0.104, 0.098)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL],
                               [tbox(w, db, df) for z, yc, w, db, df in PEL], fwd, REG["pelvis"], (False, True))
    belt, I["belt"] = loft("belt", [(0, 0.004, 1.052), (0, 0.004, 0.994)],
                           [tbox(0.182, 0.114, 0.118), tbox(0.190, 0.122, 0.121)], fwd, REG["belt"], (True, False),
                           cap_u=0.5)
    bp = V((0, 0, 1.023))
    belt.data.transform(Matrix.Translation(bp) @ Matrix.Rotation(math.radians(-4), 4, "Y") @ Matrix.Translation(-bp))
    # a big open-end wrench: outline in (y, z) below its hang point, 12 mm thick along x,
    # turned so its flat face shows from the front-right
    WL = 0.258
    OL = [(-0.012, 0.000), (0.012, 0.000), (0.012, -0.190), (0.034, -0.210), (0.034, -WL), (0.013, -WL),
          (0.010, -0.236), (-0.010, -0.236), (-0.013, -WL), (-0.034, -WL), (-0.034, -0.210), (-0.012, -0.190)]
    anc = V((-0.218, 0.066, 1.004))
    Rw = Matrix.Rotation(math.radians(40), 3, "Z") @ Matrix.Rotation(math.radians(8), 3, "X") @ \
        Matrix.Rotation(math.radians(6), 3, "Y")
    WP = lambda y, z, s: anc + Rw @ V((s * 0.006, y, z))
    wuv = lambda y, z: ("wrench", 0.02 + 0.96 * (-z / WL), 0.06 + 0.88 * ((y + 0.034) / 0.068))
    wr = []
    for s in (-1, 1):
        wr.append(([WP(y, z, s) for y, z in OL], [wuv(y, z) for y, z in OL], tuple(Rw @ V((s, 0, 0)))))
    cen = sum((V((0, y, z)) for y, z in OL), V()) / len(OL)
    for k in range(len(OL)):
        (y0, z0), (y1, z1) = OL[k], OL[(k + 1) % len(OL)]
        mid = V((0, (y0 + y1) / 2, (z0 + z1) / 2))
        wr.append(([WP(y0, z0, -1), WP(y1, z1, -1), WP(y1, z1, 1), WP(y0, z0, 1)],
                   [("wrench", 0.02 + 0.96 * (-z0 / WL), 0.03), ("wrench", 0.02 + 0.96 * (-z1 / WL), 0.03),
                    ("wrench", 0.02 + 0.96 * (-z1 / WL), 0.05), ("wrench", 0.02 + 0.96 * (-z0 / WL), 0.05)],
                   tuple(Rw @ (mid - cen))))
    # pouch: a leather box on the left hip, slightly behind, its inner side against the seat
    pc, hx, hy, hz = V((0.213, 0.052, 0.952)), 0.022, 0.044, 0.050
    Rp = Matrix.Rotation(math.radians(-8), 3, "Z")
    Pp = lambda x, y, z: pc + Rp @ V((x, y, z))
    X0, X1, Y0, Y1, Z0, Z1 = -hx, hx, -hy, hy, -hz, hz
    pouch = [([Pp(X1, Y0, Z0), Pp(X1, Y1, Z0), Pp(X1, Y1, Z1), Pp(X1, Y0, Z1)],
              [("pouch", 0.02, 0.98), ("pouch", 0.48, 0.98), ("pouch", 0.48, 0.02), ("pouch", 0.02, 0.02)],
              tuple(Rp @ V((1, 0, 0)))),
             ([Pp(X0, Y0, Z0), Pp(X1, Y0, Z0), Pp(X1, Y0, Z1), Pp(X0, Y0, Z1)],
              [("pouch", 0.52, 0.98), ("pouch", 0.72, 0.98), ("pouch", 0.72, 0.02), ("pouch", 0.52, 0.02)],
              tuple(Rp @ V((0, -1, 0)))),
             ([Pp(X0, Y1, Z0), Pp(X1, Y1, Z0), Pp(X1, Y1, Z1), Pp(X0, Y1, Z1)],
              [("pouch", 0.52, 0.98), ("pouch", 0.72, 0.98), ("pouch", 0.72, 0.02), ("pouch", 0.52, 0.02)],
              tuple(Rp @ V((0, 1, 0)))),
             ([Pp(X0, Y0, Z1), Pp(X1, Y0, Z1), Pp(X1, Y1, Z1), Pp(X0, Y1, Z1)],
              [("pouch", 0.76, 0.02), ("pouch", 0.98, 0.02), ("pouch", 0.98, 0.98), ("pouch", 0.76, 0.98)],
              tuple(Rp @ V((0, 0, 1)))),
             ([Pp(X0, Y0, Z0), Pp(X1, Y0, Z0), Pp(X1, Y1, Z0), Pp(X0, Y1, Z0)],
              [("pouch", 0.76, 0.02), ("pouch", 0.98, 0.02), ("pouch", 0.98, 0.98), ("pouch", 0.76, 0.98)],
              tuple(Rp @ V((0, 0, -1))))]
    G["pelvis"] = [pelvis, belt, poly_obj("wrench", wr), poly_obj("pouch", pouch)]

    ARM_SEEDS.clear()
    for sd, sx in (("L", 1), ("R", -1)):
        glove = sd == "R"
        rg = np.random.default_rng(71 if sx > 0 else 73)
        # ---- upper arm: rolled coverall sleeve, a flat squared shoulder top, a thick roll above the elbow
        sh = JW["sh" + sd]
        UA = [(0.035, 0.062, 0.064, 0.0, 0), (-0.005, 0.072, 0.073, sx * 0.004, 3), (-0.200, 0.057, 0.059, 0.0, 7),
              (-0.212, 0.071, 0.073, 0.0, 8), (-0.300, 0.068, 0.070, 0.0, 10)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d, dx, tw in UA],
                                   [twist(hexprof(w, d), sx * tw) for z, w, d, dx, tw in UA], fwd, REG["uarm." + sd],
                                   (True, True), cap_u=0.5)
        G["upperArm." + sd] = [ua]

        # ---- forearm: bony porcelain prism, pointed elbow; the right one ends in a flared gauntlet
        el = JW["el" + sd]
        if glove:
            FA = [(0.045, 0.048, 0.050, {}), (-0.005, 0.054, 0.053, {0: (0, -0.032)}), (-0.080, 0.054, 0.057, {}),
                  (-0.138, 0.042, 0.046, {}), (-0.141, 0.062, 0.064, {}), (-0.236, 0.043, 0.048, {})]
        else:
            FA = [(0.045, 0.048, 0.050, {}), (-0.005, 0.054, 0.053, {0: (0, -0.032)}), (-0.080, 0.054, 0.057, {}),
                  (-0.236, 0.024, 0.036, {})]
        p_ = math.radians(20)
        n = V((-sx * math.cos(p_), math.sin(p_), 0))                     # palm normal (inward, a bit back)
        td = V((-sx * math.sin(p_), -math.cos(p_), 0))                   # thumb side (front)
        bk = -n
        wr_ = el + V((0, 0, -0.240))
        fr = [fwd] * 3 + ([(fwd + td).normalized(), (fwd + td).normalized(), td] if glove else [td])
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d, p), sx * 5 * k) for k, (z, w, d, p) in enumerate(FA)], fr,
                                   REG["farm." + sd], (False, False))
        g = 1.10 if glove else 1.0                                        # the gloved hand is bigger
        palm, I["palm." + sd] = loft("palm." + sd, [wr_ + dn * -0.012, wr_ + dn * 0.046, wr_ + dn * 0.090 * g],
                                     [flatprof(0.033 * g, 0.017 * g), flatprof(0.045 * g, 0.020 * g),
                                      flatprof(0.047 * g, 0.018 * g, {3: (0, 0.005)})],
                                     bk, REG["palm." + sd], (False, True))
        k0 = wr_ + dn * 0.086 * g
        a1 = (dn * math.cos(math.radians(25)) + n * math.sin(math.radians(25))).normalized()
        a2 = (dn * math.cos(math.radians(78)) + n * math.sin(math.radians(78))).normalized()
        k1 = k0 + a1 * 0.050 * g; k2 = k1 + a2 * 0.042 * g
        fb = lambda al: (bk * math.cos(math.radians(al)) + dn * math.sin(math.radians(al))).normalized()
        fing, I["fing." + sd] = loft("fing." + sd, [k0, k1, k2],
                                     [flatprof(0.046 * g, 0.0135 * g, {3: (0, 0.006)}), flatprof(0.044 * g, 0.012 * g),
                                      flatprof(0.037 * g, 0.0095 * g)],
                                     [fb(12), fb(50), fb(78)], REG["fing." + sd], (False, True))
        tb = wr_ + dn * 0.018 + td * 0.028 * g + n * 0.006
        t1 = (dn * 0.55 + td * 0.55 + n * 0.45).normalized()
        t2 = (dn * 0.50 + n * 0.80 + td * 0.10).normalized()
        th, I["thumb." + sd] = loft("thumb." + sd, [tb, tb + t1 * 0.034 * g, tb + t1 * 0.034 * g + t2 * 0.030 * g],
                                    [boxprof(0.012 * g, 0.0105 * g), boxprof(0.011 * g, 0.0096 * g),
                                     boxprof(0.0088 * g, 0.0078 * g)], bk, REG["thumb." + sd], (False, True))
        G["lowerArm." + sd] = [fa, palm, fing, th]
        # porcelain plate seeds (world rest coords): a few round the forearm, two on the hand
        S = []
        for z in (0.02, -0.035, -0.09, -0.15, -0.20):
            for j in range(2 if z > -0.13 or not glove else 1):
                a = rg.uniform(0, TAU)
                S.append(el + V((0.07 * math.cos(a), 0.07 * math.sin(a), z + rg.uniform(-0.012, 0.012))))
        if not glove:
            S += [wr_ + dn * 0.04 + bk * 0.03, wr_ + dn * 0.05 - bk * 0.03, wr_ + dn * 0.12 + td * 0.02]
        ARM_SEEDS[sd] = S

        # ---- thigh: coverall leg prism, front crease, knee point
        hp = JW["hip" + sd]
        TG = [(0.060, 0.096, 0.108, {}, 0), (-0.280, 0.088, 0.096, {}, 4),
              (-0.452, 0.078, 0.084, {3: (0, 0.018)}, 6), (-0.490, 0.072, 0.076, {}, 6)]
        tg, I["thigh." + sd] = loft("thigh." + sd, [hp + V((0, 0, z)) for z, *_ in TG],
                                    [twist(hexprof(w, d, p), -sx * tw) for z, w, d, p, tw in TG], fwd,
                                    REG["thigh." + sd], (False, True))
        G["upperLeg." + sd] = [tg]

        # ---- shin: the coverall leg hanging over the boot; the boot shaft; a heavy foot, thick sole
        kn = JW["kn" + sd]
        SN = [(0.040, 0.074, 0.080, {}), (-0.120, 0.075, 0.083, {0: (0, -0.010)}), (-0.250, 0.086, 0.092, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN],
                                   [hexprof(w, d, p) for z, w, d, p in SN], fwd, REG["shin." + sd], (False, True))
        xf = kn.x + sx * 0.006
        bt, I["boot"] = loft("boot." + sd, [(xf, 0.004, 0.215), (xf, 0.004, 0.068)],
                             [hexprof(0.066, 0.074), hexprof(0.070, 0.080)], fwd, REG["boot"], (False, False))
        a = math.radians(8) * sx
        fd = V((math.sin(a), -math.cos(a), 0))
        h0 = V((xf, 0.086, 0.0))
        FT = [(0.000, 0.055, 0.088), (0.092, 0.066, 0.124), (0.208, 0.070, 0.082)]

        def fprof(w, top):
            return sym([[0, -0.04, 0], [-w, -0.04, 0], [-1.07 * w, -0.008, 0], [-0.74 * w, top - 0.04, 0],
                        [0, top - 0.034, 0]])
        ft, I["foot"] = loft("foot." + sd, [h0 + fd * s + V((0, 0, 0.04)) for s, w, top in FT],
                             [fprof(w, top) for s, w, top in FT], up, REG["foot"], (True, False),
                             apex=(None, h0 + fd * 0.310 + V((0, 0, 0.030))))
        G["lowerLeg." + sd] = [sn, bt, ft]
    return I, G


ARM_SEEDS = {}
NECK_SEEDS = [V((0.05, -0.03, 1.60)), V((-0.05, -0.02, 1.56)), V((0.0, 0.06, 1.58)), V((0.03, 0.05, 1.50)),
              V((-0.04, -0.05, 1.49)), V((0.06, -0.01, 1.52))]


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


def ground(objs, pose):
    """Pose, then drop the body so the lowest rendered vertex touches the floor."""
    apply_pose(objs, pose)
    zmin = min((o.matrix_world @ v.co).z for o in objs if not o.hide_render for v in o.data.vertices)
    apply_pose(objs, pose, body_off=(0, 0, -zmin))


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
            if part == "head" and co.z < 1.570 and nz < 0.3:
                f *= 0.86
            if part == "weldcap" and nz < -0.3:
                f *= 0.80
            cols[li] = (f ** 1.08, f ** 1.04, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    return ca


# ---------------------------------------------------------------- baked light, edge light

def bake_maps(objs):
    """Cycles bakes AO, object-space normals (hard, per facet) and object-space
    positions onto the page. The painted light: a top-front key, sky, a warm bounce
    from below and a faint back rim, occluded. Positions let the porcelain be painted
    in 3D (cracks land on the geometry, whatever the UV stretch)."""
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
    ground_ob = kit.mesh_obj("BakeGround", bm, None, smooth=False)
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
    bpy.data.objects.remove(ground_ob)
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
    print("[mended] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
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


# ---------------------------------------------------------------- texture painting: porcelain

def paint_head(name, Ph, seed):
    """Head and face painted in 3D from the baked positions: x signed (the cracks are
    not mirrored), |x| for the paired features (eyes, sockets, mouth)."""
    x = Ph[..., 0]; Z = Ph[..., 2]; F = HEAD_YC - Ph[..., 1]
    ax = np.abs(x)
    front = F > 0.035
    Xf = np.where(front, ax, 9.0)
    Xs = np.where(front, x, 9.0)
    phi = np.arctan2(ax, F)                        # 0 front centre .. pi back centre
    tsz = texel_size(Ph)
    r = Reg(name, ["porc", "gold", "hollow", "bloodc2"], Xs, 1.8 - Z, None, 0.003, 0.003, seed=seed)   # 2D helpers: front only
    E = lambda x0_, z0, rx, rz: np.sqrt(((Xf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    Es = lambda x0_, z0, rx, rz: np.sqrt(((Xs - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    EX, EZ = EYE
    # broad shaping: the mask's planes, a lit forehead and cheekbones, gaunt hollows
    r.lit(soft(E(0.0, 1.712, 0.07, 0.022)), 1.08)
    r.lit(soft(E(0.068, 1.648, 0.026, 0.010)), 1.16)                          # cheekbone tops
    r.lit(soft(E(0.062, 1.603, 0.024, 0.016), 0.6), 0.76)                     # hollow cheeks
    r.lit(np.clip((ax - 0.07) / 0.03, 0, 1) * (phi < 1.4), 0.9)               # sides turn away
    # deep sockets: darkest up under the brow shelf
    sock = E(EX, EZ + 0.004, 0.031, 0.021) + 0.10 * r.nz
    r.lit(soft(sock, 0.5) * np.clip(0.55 + (Z - EZ) / 0.025, 0.45, 1), 0.34)
    r.lit((E(0.012, EZ + 0.006, 0.008, 0.012) < 1), 0.75)                     # inner corner by the bridge
    r.lit(E(EX + 0.003, EZ - 0.0145, 0.021, 0.0034) < 1, 0.74)                # lower-lid crease
    # milky eyes: a pale almond, a faint grey pupil, a dark lid rim
    eye = E(EX, EZ, 0.0125, 0.0056) < 1
    r.put(eye, "porc")
    r.overlay(eye, "porc", 7)
    r.overlay(eye & (Z > EZ + 0.0030), "porc", 6)
    r.overlay(E(EX + 0.001, EZ - 0.0008, 0.0040, 0.0038) < 1, "porc", 4)
    lid = (E(EX + 0.001, EZ - 0.0064, 0.0125, 0.0024) < 1) & ~eye
    r.lit(lid, 0.6)
    r.eye = eye
    # nose piece: the shadow it casts, the nostrils
    nos = E(0.0085, 1.615, 0.0045, 0.0030) < 1
    r.put(nos & (F > 0.096), "hollow")
    r.lit((E(0.0, 1.608, 0.020, 0.0045) < 1) & (F < 0.104), 0.62)
    # porcelain mouth: a thin dark slit hanging open, a row of upper teeth, a lip ridge
    maw = E(0.0, 1.5885, 0.022, 0.0060) < 1
    r.put(maw, "hollow"); r.lit(maw, 0.5)
    teeth = (Xf < 0.017) & (Z > 1.5905) & (Z < 1.5940)
    r.put(teeth, "porc"); r.overlay(teeth, "porc", 6)
    for k in range(1, 4):
        r.overlay(teeth & (np.abs(Xf - 0.0056 * k + 0.0014) < 0.0010), "porc", 3)
    r.lit((E(0.0, 1.5975, 0.025, 0.0026) < 1) & ~maw, 1.18)                   # upper lip ridge
    r.lit((E(0.0, 1.5800, 0.022, 0.0028) < 1) & ~maw, 0.78)                   # under the lower lip
    r.lit(np.clip((1.566 - Z) / 0.010, 0, 1) * front, 0.70)                   # under the chin
    # dried blood from the right corner of the mouth (one deliberate cluster)
    r.blob(-0.021, 1.8 - 1.586, 0.006, 0.004, "bloodc2", rough=0.2)
    r.drip(-0.022, 1.8 - 1.584, 0.020, w=0.0017, mat="bloodc2")
    r.drip(-0.017, 1.8 - 1.584, 0.012, w=0.0014, mat="bloodc2")
    # short dark hair round the back and sides below the cap, sideburns
    hair = ((phi > 1.25) & (Z > 1.618 + 0.010 * np.cos(phi * 3))) | ((phi > 1.10) & (phi <= 1.25) & (Z > 1.672))
    hair &= Z < 1.80
    r.put(hair, "hollow")
    r.lit(hair, 2.3)                                                         # dark brown, not a void
    r.clusters(3.0, 0.2, f=1.35, where=hair, seed=12)
    r.clusters(2.0, 0.45, f=0.7, where=hair, seed=14)
    r.lit(hair * np.clip((1.64 - Z) / 0.02, 0, 1), 0.8)
    # grime: soot under the cap band, an oily thumb smear on the left jaw, dusty pores
    r.clusters(2.2, 0.30, f=0.80, where=(Z > 1.712) & front, seed=9)
    r.lit(soft(Es(0.074, 1.600, 0.013, 0.010) + 0.4 * r.nz, 0.4), 0.66)
    r.lit(soft(Es(-0.056, 1.668, 0.010, 0.008) + 0.4 * r.nz, 0.4), 0.80)
    r.clusters(3, 0.50, f=0.9, where=~hair & ~eye & ~teeth, seed=7)
    # the missing shard at the right temple: a dark hollow rimmed with gold
    chip = inpoly(Xs, Z, CHIP) & front
    dch = np.full(x.shape, 9.0)
    for a, b in zip(CHIP, CHIP[1:] + CHIP[:1]):
        dch = np.minimum(dch, segd(Xs, Z, a, b))
    rim = (dch < 0.75 * tsz) & ~chip & front
    r.put(chip, "hollow")
    r.lit(chip & (dch < 2.2 * tsz) & (Z > np.mean([p[1] for p in CHIP])), 0.55)   # the rim's shadow inside
    r.lit(chip & (dch >= 2.2 * tsz), 1.2)                                   # the inner shell catches a little light
    # gold seams (3D polylines) and a few unmended hairlines
    d = np.full(x.shape, 9.0)
    for pl in SEAMS["head"]:
        if len(pl) > 1:
            d = np.minimum(d, poly_dist(Ph, pl))
    thr = np.maximum(0.5 * tsz, np.minimum(0.8 * tsz, 0.0032))            # thin on the coarse back half too
    seam = ((d < thr) | rim) & ~eye
    dh = np.full(x.shape, 9.0)
    for pl in SEAMS["head_hair"]:
        if len(pl) > 1:
            dh = np.minimum(dh, poly_dist(Ph, pl))
    r.lit((dh < 0.45 * tsz) & ~seam, 0.62)
    seam_shadow(r, seam, 0.72)
    r.put(seam, "gold")
    seam_glints(r, seam, seed)
    return r


def paint_hair():
    """The hair tufts: dark brown strands, lighter at the root under the cap's shade."""
    r = grid_reg("hair", ["hollow"], 0.03, 0.03, 18)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 2.3)
    r.lit(np.sin(U * 40) > 0.3, 1.35)
    r.lit(Vv > 0.7, 0.75)
    return r


def paint_ear():
    r = grid_reg("ear", ["porc", "gold", "hollow"], 0.024, 0.065, 17)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.95)
    r.lit(ell(U, Vv, 0.42, 0.5, 0.30, 0.34) < 1, 0.72)                      # bowl
    r.lit(ell(U, Vv, 0.40, 0.55, 0.14, 0.16) < 1, 0.62)
    r.lit(U > 0.8, 1.18)                                                     # rim
    r.line([(0.012, 0.0), (0.010, 0.018), (0.015, 0.030)], 0.6 * r.tx, "gold")   # a mended nick in the rim
    return r


def paint_neck(I, P):
    r = loft_reg("neck", I["neck"], ["porc", "gold", "hollow"], 13)
    X, Y = r.X, r.Y
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.05)) / 0.05, 0, 1), 0.55)          # under the jaw
    r.lit(np.clip(1 - Y / 0.03, 0, 1), 0.66)                        # collar shadow
    for sg in (-1, 1):                                              # neck tendons as hard planes
        r.line([(sg * 0.034, top - 0.01), (sg * 0.008, 0.012)], 0.004, f=1.16)
        r.line([(sg * 0.044, top - 0.01), (sg * 0.016, 0.012)], 0.003, f=0.82)
    porcelain(r, P, NECK_SEEDS, 131)
    return r


def paint_farm(I, sd, P):
    L = sd == "L"
    info = I["farm." + sd]
    mats = ["porc", "gold", "hollow", "grease"] if L else ["porc", "gold", "canvas"]
    r = loft_reg("farm." + sd, info, mats, 81 if L else 83)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    r.lit(np.clip(1 - Y / 0.07, 0, 1), 0.6)                         # under the rolled sleeve
    r.lit(np.abs(r.B) < 0.04, 0.9)                                  # underside
    if L:
        porcelain(r, P, ARM_SEEDS[sd], 181)
        r.lit(np.clip((Y - 0.2) / 0.08, 0, 1), 0.9)
        # a small chip out of the outer forearm, rimmed in gold; grease on the wrist
        c0 = (0.05, 0.15)
        ch = r.blob(*c0, 0.011, 0.009, rough=0.3)
        rimk = r.blob(*c0, 0.011 + 1.2 * tx, 0.009 + 1.2 * ty, rough=0.3) * (1 - ch)
        r.put(ch, "hollow"); r.lit(ch, 0.7)
        r.put(rimk, "gold")
        r.clusters(2.0, 0.35, mat="grease", where=(Y > Lt - 0.05) & (np.abs(X) > 0.03), seed=4)
    else:
        g0 = info["d"][4] - 0.002                                   # the gauntlet's top edge
        where = Y < g0
        porcelain(r, P, ARM_SEEDS[sd], 183, where=where)
        gl = Y >= g0
        r.put(gl, "canvas")
        r.lit(gl & (Y < g0 + 1.2 * ty), 1.3)                        # the flared cuff's rolled edge
        r.lit(gl & (Y >= g0 + 1.2 * ty) & (Y < g0 + 2.4 * ty), 0.62)
        for k in range(-5, 6):                                      # cuff stitching and creases
            r.line([(k * 0.022 + 0.004, g0 + 0.012), (k * 0.022, Lt - 0.004)], 0.45 * tx, f=0.84)
        r.lit(gl & (np.abs(Y - (g0 + 0.030)) < 0.5 * ty), 0.7)
        r.clusters(2.5, 0.35, f=0.62, where=gl, seed=6)             # scorch marks
        r.clusters(1.5, 0.72, f=0.5, where=gl, seed=7)
    return r


def paint_porc_hand(name, I, P, seed, part):
    """The bare left hand: porcelain carrying on the forearm's plates, hard knuckles,
    oil-black fingertips."""
    r = loft_reg(name, I[name], ["porc", "gold", "grease"], seed)
    X, Y, tx, ty, Pm = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.9)
    porcelain(r, P, ARM_SEEDS["L"], 185)
    if part == "palm":
        r.lit(np.abs(r.B) < 0.03, 0.8)                               # palm side
        for x0_ in (-0.018, -0.006, 0.006, 0.018):                   # tendons
            r.line([(x0_ * 0.6, 0.02), (x0_, Lt - 0.012)], 0.5 * tx, f=1.14)
        for x0_ in (-0.02, -0.007, 0.007, 0.02):                      # hard knuckles
            r.blob(x0_, Lt - 0.006, 0.0055, 0.005, None, 1.3, rough=0)
        r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.72)
        r.clusters(2.0, 0.45, mat="grease", where=np.abs(r.B) < 0.04, seed=3)
    elif part == "fing":
        back = np.abs(X) < Pm / 4
        r.lit(~back, 0.8)
        for xk in (-0.0215, 0.0, 0.0215):                            # splits between the fingers
            r.lit(np.abs(X - xk) < 0.55 * tx, 0.55)
            r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.6)
        r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.7)
        r.lit(back & (np.abs(Y - Lt * 0.5 + 0.005) < 0.003), 1.25)
        r.put(Y > Lt - 0.016 + 0.004 * r.nz, "grease")              # oil-black fingertips
    else:
        r.lit((X / Pm + 0.5) > 0.75, 0.8)
        r.put(Y > Lt - 0.014, "grease")
    return r


def paint_glove(name, I, seed, part):
    """The right hand in a tan split-leather welding gauntlet: stitching, creases, scorch."""
    r = loft_reg(name, I[name], ["canvas", "leather"], seed)
    X, Y, tx, ty, Pm = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.95)
    r.clusters(2.5, 0.35, f=0.66, seed=seed + 1)                     # scorch
    if part == "palm":
        r.lit(np.abs(r.B) < 0.03, 0.8)
        r.put((np.abs(r.B) < 0.028) & (Y > 0.02), "leather")        # dark reinforcement patch on the palm
        for x0_ in (-0.021, 0.021):
            r.line([(x0_, 0.01), (x0_, Lt)], 0.45 * tx, f=0.7)
        r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.7)
    elif part == "fing":
        back = np.abs(X) < Pm / 4
        r.lit(~back, 0.82)
        for xk in (-0.0235, 0.0, 0.0235):
            r.lit(np.abs(X - xk) < 0.55 * tx, 0.6)
            r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.62)
        r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.72)
        r.lit(back & (np.abs(Y - Lt * 0.5 + 0.005) < 0.003), 1.2)
        r.put(Y > Lt - 0.012, "leather")                             # worn, blackened tips
    else:
        r.lit((X / Pm + 0.5) > 0.75, 0.8)
        r.put(Y > Lt - 0.012, "leather")
    return r


# ---------------------------------------------------------------- texture painting: cloth, leather, brass

def paint_collar():
    r = grid_reg("collar", ["trousers", "gold"], 0.06, 0.07, 19)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.14)
    r.lit((Vv < 0.14) | (np.abs(U - 0.5) > 0.40 - 0.35 * Vv), 0.78)      # stitched edge
    return r


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["trousers", "gold", "porc3", "bloodc2", "metal1"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    Lt = Y.max()
    # open collar: a V of porcelain chest with a gold seam across it
    vd = 0.115
    vw = 0.060 * np.clip(1 - (Y - 0.01) / (vd - 0.01), 0, 1)
    vee = (ax < vw) & (Y < vd) & (Y > 0.0)
    r.put(vee, "porc3")
    r.lit(vee * np.clip(1 - Y / 0.07, 0, 1), 0.6)
    r.lit(vee & (ax > vw - 1.1 * tx), 0.62)
    r.put(r.line([(0.012, 0.0), (0.004, 0.030), (0.014, 0.055), (0.006, 0.090)], 0.5 * tx) * vee, "gold")
    r.lit((Y < 0.02) & ~vee, 1.12)                                  # collar band round the neck
    # zip placket down the front, a metal pull at the top
    pl = Y > vd
    r.lit(pl & (ax < 0.55 * tx), 0.6)
    r.lit(pl & (X > 0.6 * tx) & (X < 1.8 * tx), 1.16)
    r.put((ax < 0.9 * tx) & (Y > vd) & (Y < vd + 0.022), "metal1")
    # chest pockets with flaps; a pencil in the left one; a blank name patch on the right
    for sg in (-1, 1):
        cx = sg * 0.094
        d = np.abs(X - cx)
        pk = (d < 0.036) & (Y > 0.165) & (Y < 0.262)
        r.lit(pk & ~((d < 0.036 - tx) & (Y > 0.165 + ty) & (Y < 0.262 - ty)), 0.64)
        r.lit(pk & (Y > 0.230), 0.9)
        r.lit((d < 0.038) & (Y > 0.162) & (Y < 0.192), 1.2)
        r.lit((d < 0.038) & (Y >= 0.192) & (Y < 0.192 + 1.3 * ty), 0.52)
    r.put((np.abs(X - 0.108) < 0.6 * tx) & (Y > 0.145) & (Y < 0.170), "metal1")   # pencil / screwdriver
    npatch = ell(X, Y, -0.094, 0.138, 0.032, 0.014) < 1
    r.lit(npatch, 1.4)
    r.lit((ell(X, Y, -0.094, 0.138, 0.032, 0.014) < 1) & (ell(X, Y, -0.094, 0.138, 0.032, 0.014) > 0.78), 0.62)
    for k in range(4):                                              # illegible stitched name
        r.lit((np.abs(Y - 0.138 + (k % 2) * 0.004) < 0.5 * ty) & (np.abs(X + 0.108 - k * 0.009) < 0.0035), 0.6)
    # yoke seam over the shoulders, armpit folds, the coverall bunched above the belt
    r.lit(np.abs(Y - 0.100) < 0.5 * ty, 0.7)
    r.lit(np.abs(Y - 0.100 - 1.1 * ty) < 0.5 * ty, 1.14)
    for sg in (-1, 1):
        sx0 = sg * r.P / 4
        r.blob(sx0, 0.19, 0.035, 0.045, None, 0.86, rough=0.3)
        for (a0, a1) in (((-0.03, 0.17), (-0.09, 0.26)), ((0.0, 0.18), (-0.01, 0.31)), ((0.03, 0.17), (0.08, 0.27))):
            r.fold((sx0 + sg * a0[0], a0[1]), (sx0 + sg * a1[0], a1[1]), off=(sg * 1.3 * tx, 0))
    bl = np.clip((Y - (Lt - 0.12)) / 0.05, 0, 1) * np.clip((Lt - 0.005 - Y) / 0.02, 0, 1)
    ph = 2 * np.pi * X / 0.060 + 1.3 * np.sin(X * 23.0)
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.2)
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.74)
    r.lit(np.clip((Y - (Lt - 0.04)) / 0.02, 0, 1), 0.7)
    # grease: a wide dark belly stain, wiped hand marks on the right chest, a sweat-dark back
    r.clusters(4, 0.25, f=0.72, where=(Y > 0.33) & (ax < 0.12), seed=31)
    for k in range(3):
        r.line([(-0.07 - 0.012 * k, 0.28 + 0.01 * k), (-0.12 - 0.012 * k, 0.36 + 0.01 * k)], 0.9 * tx, f=0.66)
    r.clusters(5, 0.30, f=0.84, where=(np.abs(B) < 0.12) & (Y > 0.12) & (Y < 0.34), seed=32)
    # gold-mended cracks: across the chest from the left shoulder, and on the back
    cloth_crack(r, 0.19, 0.115, 2.2, 0.17, 401)
    cloth_crack(r, r.P / 2 - 0.07, 0.14, 1.3, 0.16, 411)
    # a little old blood
    r.splat(-0.035, 0.27, 0.016, drips=2)
    r.blob(r.P / 2 + 0.11, 0.30, 0.014, 0.012, "bloodc2", 0.9)
    r.clusters(4, 0.55, f=0.9, seed=1)
    r.clusters(4, 0.62, f=1.08, where=Y < 0.30, seed=2)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["trousers", "bloodc2", "leather"], 31)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    ax = np.abs(X)
    r.lit(Y < 0.08, 0.7)                                            # under the belt
    r.fold((0.004, 0.07), (0.006, 0.19), off=(1.2 * tx, 0))       # fly
    r.line([(0.006, 0.19), (-0.012, 0.205)], 0.6 * tx, f=0.7)
    for sg in (-1, 1):
        r.fold((sg * 0.10, 0.07), (sg * 0.155, 0.15), off=(-sg * 1.2 * tx, 0))   # hip pocket slits
        r.fold((sg * 0.015, 0.23), (sg * 0.065, 0.155), dark=0.72)
        r.fold((sg * 0.03, 0.24), (sg * 0.10, 0.18), dark=0.76)
        cx = r.P / 2 + sg * 0.078                                                 # back pockets
        d = np.abs(r.dx(cx))
        pk = (d < 0.034) & (Y > 0.09) & (Y < 0.19)
        r.lit(pk & ~((d < 0.034 - tx) & (Y > 0.09 + ty) & (Y < 0.19 - ty)), 0.64)
    # a dark red shop rag stuffed in the right back pocket, hanging out
    cx = r.P / 2 - 0.078
    rag = (np.abs(r.dx(cx) + 0.004 * np.sin(Y * 90)) < 0.020 - 0.05 * np.clip(Y - 0.14, 0, 1)) & (Y > 0.085) & (Y < 0.20)
    r.put(rag, "bloodc2")
    r.lit(rag * (np.sin(r.dx(cx) * 260 + Y * 40) > 0.3), 1.25)
    r.lit(np.clip((Y - 0.19) / 0.06, 0, 1), 0.82)
    r.clusters(4, 0.40, f=0.72, where=Y > 0.06, seed=3)             # grease
    r.clusters(4, 0.55, f=0.9, seed=4)
    return r


def paint_belt(I):
    r = loft_reg("belt", I["belt"], ["leather", "metal", "trousers"], 33)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    ax = np.abs(X)
    r.lit(Y < 1.1 * ty, 1.28)                                      # top edge, stitched
    r.lit(Y > Lt - 1.1 * ty, 0.62)
    r.lit((np.abs(Y - 1.6 * ty) < 0.4 * ty) & (np.sin(X * 700) > 0), 1.2)
    for x_ in (0.10, -0.10, 0.22, -0.22, r.P / 2, r.P / 2 - 0.14, r.P / 2 + 0.14):   # coverall belt loops
        lp = np.abs(r.dx(x_)) < 0.008
        r.put(lp, "trousers"); r.lit(lp, 1.1)
        r.lit((np.abs(r.dx(x_)) >= 0.008) & (np.abs(r.dx(x_)) < 0.008 + tx), 0.6)
    bk = (ax < 0.030) & (Y > 0.004) & (Y < Lt - 0.004)                    # heavy steel buckle
    r.put(bk, "metal")
    inner = (ax < 0.019) & (Y > 0.013) & (Y < Lt - 0.013)
    r.put(inner, "leather"); r.lit(inner, 0.55)
    r.put((ax < 0.6 * tx) & (Y > 0.013) & (Y < Lt - 0.013), "metal")
    for sg in (-1, 1):                                              # tool loops at the hips
        lp = np.abs(r.dx(sg * r.P / 4)) < 0.02
        r.lit(lp, 0.72); r.lit(lp & (Y < 1.2 * ty), 1.3)
    r.clusters(3, 0.45, f=0.8, seed=5)
    return r


def paint_wrench():
    r = grid_reg("wrench", ["wsteel", "hollow"], 0.258, 0.068, 41)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.35)                                    # bright worn steel against the olive
    handle = U < 0.74
    r.lit(handle & ((Vv < 0.36) | (Vv > 0.64)), 0.78)               # the handle's narrow sides
    r.lit(handle & (np.abs(Vv - 0.5) < 0.07), 1.3)                  # a bevel highlight down the handle
    r.lit((U > 0.80) & (U < 0.84), 0.7)                             # the head's shoulder
    r.lit((U > 0.88) & (np.abs(Vv - 0.5) < 0.22), 0.6)              # round the jaw
    r.lit(ell(U, Vv, 0.60, 0.5, 0.05, 0.07) < 1, 0.7)               # stamped size
    r.clusters(1.5, 0.45, f=0.6, seed=42)                           # grease
    r.put(U < 0.04, "hollow")
    return r


def paint_pouch():
    r = grid_reg("pouch", ["leather", "brass"], 0.10, 0.10, 51)
    U, Vv = r.U, r.V
    face = U < 0.5
    r.lit(np.ones_like(U), 1.0)
    flap = face & (Vv < 0.42)
    r.lit(flap, 1.12)
    r.lit(face & (np.abs(Vv - 0.42) < 0.05), 0.55)                 # flap shadow
    r.put(ell(U, Vv, 0.25, 0.36, 0.05, 0.05) < 1, "brass")          # snap
    r.lit(face & ((U < 0.05) | (U > 0.45) | (Vv > 0.94)), 0.7)
    r.lit(~face & (U > 0.74), 1.15)                                 # top face
    r.clusters(2.0, 0.5, f=0.75, seed=52)
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["trousers", "gold", "bloodc2"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.abs(Y - 0.045) < 0.6 * ty, 0.68)                       # shoulder seam
    r.lit(np.abs(Y - 0.045 + 1.2 * ty) < 0.6 * ty, 1.15)
    roll = info["d"][2]                                             # the rolled cuff
    r.lit(Y > roll, 1.12)
    r.lit(np.abs(Y - roll) < 0.7 * ty, 0.55)
    for yk, f_ in ((roll + 0.030, 0.68), (roll + 0.058, 0.68), (Lt - 0.005, 0.6)):
        r.lit(np.abs(Y - yk) < 0.6 * ty, f_)
        r.lit(np.abs(Y - yk + 1.1 * ty) < 0.6 * ty, 1.14)
    for k in range(3):                                              # inner elbow creases
        r.fold((P / 2 - 0.05 + k * 0.03, roll - 0.07), (P / 2 - 0.035 + k * 0.03, roll - 0.02))
    r.fold((-0.03, 0.09), (0.02, 0.14))
    r.clusters(4, 0.45, f=0.80, seed=16 if L else 17)               # grease
    if L:                                                           # a welding burn hole
        hole = r.blob(0.035, 0.12, 0.007, 0.006, rough=0.2)
        r.lit(r.blob(0.035, 0.12, 0.013, 0.012, rough=0.3) * (1 - hole), 0.62)
        r.lit(hole, 0.25)
    else:
        cloth_crack(r, -0.02, 0.06, 1.3, 0.10, 421)
        r.blob(0.02, 0.15, 0.010, 0.008, "bloodc2")
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["trousers", "gold", "bloodc2", "mud"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    inner = -outer
    so = 1 if L else -1
    r.fold((outer, 0.0), (outer + so * 0.004, Lt), off=(-so * 1.2 * tx, 0))          # outer seam
    r.fold((inner, 0.0), (inner, Lt), dark=0.8, off=(so * 1.2 * tx, 0))
    for (y0_, y1_, dx0, dx1) in ((0.04, 0.26, -0.02, 0.06), (0.12, 0.35, -0.05, 0.03), (0.23, 0.43, -0.04, 0.05)):
        r.fold((inner * 0.5 + so * dx0, y0_), (so * dx1, y1_), off=(so * 1.2 * tx, -0.5 * ty))
    for yk in (Lt - 0.085, Lt - 0.055, Lt - 0.025):                 # knee creases
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    # oily hand wipes down the front of the thighs
    for k in range(3):
        x0_ = so * (0.010 + 0.018 * k)
        r.line([(x0_, 0.05 + 0.02 * k), (x0_ + so * 0.012, 0.19 + 0.02 * k)], 0.9 * tx, f=0.62)
    r.clusters(3, 0.3, f=0.78, where=(np.abs(X) < 0.07) & (Y > Lt - 0.10), seed=8)   # oily knee
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    if L:
        cloth_crack(r, -0.05, 0.15, 1.15, 0.15, 431)
        r.splat(0.05, 0.33, 0.018, drips=1)
    else:
        cx = outer                                                   # tool pocket on the outer thigh
        d = np.abs(X - cx)
        pk = (d < 0.048) & (Y > 0.12) & (Y < 0.29)
        r.lit(pk & ~((d < 0.048 - tx) & (Y > 0.12 + ty) & (Y < 0.29 - ty)), 0.62)
        r.lit((d < 0.05) & (Y > 0.118) & (Y < 0.155), 1.18)
        r.lit((d < 0.05) & (Y >= 0.155) & (Y < 0.155 + 1.3 * ty), 0.52)
        # a square patch sewn over the knee
        pch = (np.abs(X - 0.005) < 0.042) & (np.abs(Y - (Lt - 0.05)) < 0.034)
        r.lit(pch, 1.2)
        r.lit(pch & ~((np.abs(X - 0.005) < 0.042 - tx) & (np.abs(Y - (Lt - 0.05)) < 0.034 - ty)), 0.66)
    r.lit(np.clip(Y / Lt, 0, 1), 0.92)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    r = loft_reg("shin." + sd, I["shin." + sd], ["trousers", "bloodc2", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.full(X.shape, 1.0), 0.9)
    r.clusters(3, 0.25, f=0.74, where=Y < 0.07, seed=5)             # oily knees
    r.lit((Y > Lt - 0.020) & (Y < Lt - 0.010), 1.15)               # the hem
    r.lit(Y >= Lt - 0.010, 0.62)
    for (p0, p1) in (((-0.02, 0.06), (0.01, 0.17)), ((0.04, 0.09), (0.02, 0.20)), ((P / 2 - 0.02, 0.04), (P / 2, 0.15)),
                     ((0.05, Lt - 0.06), (0.07, Lt - 0.02))):
        r.fold(p0, p1)
    r.clusters(4, 0.40, mat="mud", where=np.clip((Y - Lt * 0.55) / (Lt * 0.45), 0, 1) > 0.5, seed=11 if L else 12)
    r.clusters(4, 0.55, f=0.9, seed=13)
    if L:
        r.splat(0.02, 0.12, 0.020, drips=2)
    else:
        r.blob(-0.03, 0.16, 0.012, 0.01, "bloodc2", 0.9)
    return r


def paint_boot(I):
    r = loft_reg("boot", I["boot"], ["leather", "mud", "metal", "khaki"], 61)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.88)
    for k in range(-3, 4):                                          # shaft creases
        r.fold((k * 0.05 + 0.012, 0.02), (k * 0.05 + 0.02, 0.10), off=(1.2 * tx, 0))
    r.lit(Y < 0.03, 0.55)                                           # under the coverall hem
    tongue = ax < 0.018
    r.lit(tongue, 0.8)
    for yk in np.arange(0.03, Lt, 0.022):                           # speed hooks and laces
        r.line([(-0.014, yk), (0.014, yk + 0.011)], 0.55 * tx, "khaki")
        r.put(ell(X, Y, -0.017, yk, 0.004, 0.004) < 1, "metal")
        r.put(ell(X, Y, 0.017, yk, 0.004, 0.004) < 1, "metal")
    r.clusters(3, 0.45, mat="mud", where=Y > Lt - 0.06, seed=14)
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["leather", "mud", "metal", "khaki"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][1]                         # stations on the instep ring (k0 = sole centre)
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 0.9)
    r.lit(sole, 0.36)
    r.lit(welt, 1.22)
    r.lit((np.abs(U - st[2]) < 0.012) | (np.abs(U - st[6]) < 0.012), 0.62)      # welt seam
    Lt = info["d"][-1]
    toe = Y > Lt - 0.075
    r.lit(toe & ~sole, 1.12)
    r.lit((np.abs(Y - (Lt - 0.075)) < 0.006) & ~sole, 0.6)                      # steel toe-cap seam
    r.clusters(1.6, 0.55, mat="metal", where=toe & ~sole & (np.abs(X) < 0.05), seed=17)   # scuffed to the steel
    r.lit((Y < 0.03) & ~sole, 0.85)
    lace = (np.abs(X) < 0.02) & (Y > 0.05) & (Y < 0.17)
    r.lit(lace, 0.78)
    for yk in np.arange(0.06, 0.17, 0.022):
        r.line([(-0.013, yk), (0.013, yk + 0.01)], 0.55 * tx, "khaki")
    r.clusters(3, 0.45, mat="mud", where=(np.abs(r.B) < 0.10) & ~sole, seed=15)
    return r


def paint_cap(I):
    info = I["weldcap"]
    r = loft_reg("weldcap", info, ["canvas", "leather", "brass", "hollow"], 101)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    ax = np.abs(X)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 1.08)                         # the top edge catches the bulb
    band = Y > Lt - 0.026                                           # sweatband
    r.lit(band, 0.92)
    r.lit(np.abs(Y - (Lt - 0.026)) < 0.6 * ty, 0.6)
    r.lit(np.abs(Y - (Lt - 0.026) - 1.1 * ty) < 0.5 * ty, 1.12)
    for x_ in (P / 2, P / 4, -P / 4):                               # panel seams, stitched
        r.lit(np.abs(r.dx(x_)) < 0.5 * tx, 0.8)
    # the goggle strap round the crown, behind the lenses; a brass slide on the left
    sy0, sy1 = 0.052, 0.074
    strap = (Y > sy0) & (Y < sy1) & (ax > 0.07)
    r.put(strap, "leather")
    r.lit(strap & (Y < sy0 + 1.1 * ty), 1.2)
    r.lit((Y >= sy1) & (Y < sy1 + 1.2 * ty) & (ax > 0.07), 0.62)
    sl = (np.abs(X - 0.21) < 0.012) & (Y > sy0 - 0.004) & (Y < sy1 + 0.004)
    r.put(sl, "brass")
    r.lit(sl & (np.abs(X - 0.21) < 0.005), 0.6)
    r.lit((Y > sy0 - 0.012) & (Y < sy1 + 0.014) & (ax < 0.075), 0.7)   # shadow of the goggles
    # welding scorch: burnt clusters on the front right, a few burn holes; grime
    r.clusters(3, 0.35, f=0.62, where=(X < -0.02) & (X > -0.16) & (Y < Lt - 0.03), seed=102)
    for (hx_, hy_) in ((-0.07, 0.030), (-0.11, 0.090), (-0.045, 0.100)):
        r.blob(hx_, hy_, 0.0045, 0.004, "hollow", rough=0.1)
    r.clusters(4, 0.50, f=0.86, seed=103)
    r.clusters(3, 0.62, f=1.12, where=Y < Lt - 0.03, seed=104)
    return r


def paint_brim():
    r = grid_reg("brim", ["canvas"], 0.12, 0.05, 105)
    U, Vv = r.U, r.V
    top = Vv < 0.5
    r.lit(top, 1.1)
    r.lit(~top, 0.42)
    for vv in (0.16, 0.30):                                         # stitched rows
        r.lit(top & (np.abs(Vv - vv) < 0.04), 0.78)
    r.lit(top & (Vv > 0.42), 1.2)                                   # lip
    r.clusters(2.0, 0.45, f=0.7, seed=106)
    return r


def paint_lens():
    r = grid_reg("lens", ["lens", "brass"], 0.05, 0.05, 107)
    U, Vv = r.U, r.V
    rr = np.hypot(U - 0.5, Vv - 0.5) / 0.47
    rim = rr > 0.68
    r.put(rim, "brass")
    r.lit(rim & (Vv < 0.45), 1.2)
    r.lit(rim & (Vv > 0.62), 0.72)
    r.lit(~rim & (rr > 0.56), 0.6)                                   # the glass sits back in the rim
    r.overlay(ell(U, Vv, 0.38, 0.36, 0.12, 0.07) < 1, "lens", 3)     # the bulb in the glass
    r.overlay(ell(U, Vv, 0.60, 0.62, 0.05, 0.035) < 1, "lens", 2)
    return r


def paint_brass():
    r = grid_reg("brass", ["brass"], 0.06, 0.02, 108)
    U, Vv = r.U, r.V
    r.lit(Vv > 0.7, 1.2)                                            # the front edge of the rim
    r.lit(Vv < 0.25, 0.72)
    r.clusters(1.5, 0.5, f=0.78, seed=109)                          # tarnish
    return r


def paint_eyes():
    """The eye-quad patch: a milky almond filling the rhombus, a faint grey pupil."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    a = np.zeros((h, w, 3)); a[:] = C((206, 202, 180))
    a[(np.abs(U - 0.5) < 0.30) & (Vv < 0.3)] = C((178, 174, 154))            # upper-lid shade
    a[ell(U, Vv, 0.52, 0.55, 0.15, 0.32) < 1] = C((156, 156, 140))            # pupil
    a[ell(U, Vv, 0.40, 0.40, 0.05, 0.12) < 1] = C((226, 224, 204))            # catch light
    return a


def paint_page(I, light, pos):
    def preg(name, joint):
        x0, y0, w, h = REG[name]
        return pos[y0:y0 + h, x0:x0 + w] + np.array(JW[joint])
    face = paint_head("head", preg("head", "neck"), 11)
    regs = [face, paint_head("nose", preg("nose", "neck"), 12), paint_ear(), paint_hair(),
            paint_neck(I, preg("neck", "spine")),
            paint_collar(), paint_torso(I), paint_pelvis(I), paint_belt(I), paint_wrench(), paint_pouch(),
            paint_boot(I), paint_foot(I), paint_cap(I), paint_brim(), paint_lens(), paint_brass()]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd),
                 paint_farm(I, sd, preg("farm." + sd, "el" + sd))]
    for part, seed in (("palm", 91), ("fing", 92), ("thumb", 95)):
        regs.append(paint_porc_hand(part + ".L", I, preg(part + ".L", "elL"), seed, part))
        regs.append(paint_glove(part + ".R", I, seed + 10, part))
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 18))
    glow = np.zeros((AT, AT, 3))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.45, 0.45, wrap=r.P is not None)
        lt = np.where(lt < 0.05, 0.9, lt)                                   # unbaked texels
        lt = lt * EDGE[y0:y0 + h, x0:x0 + w]
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
        glow[y0:y0 + h, x0:x0 + w][r.gold_mask()] = C(GLOW_C)
    x0, y0, w, h = REG["eyes"]
    page[y0:y0 + h, x0:x0 + w] = paint_eyes()
    # glow page (same UVs): the gold seams, plus the eyes, dim (like the Ghoul's)
    glow[y0:y0 + h, x0:x0 + w] = paint_eyes() * 0.6
    x0, y0, w, h = REG["head"]
    glow[y0:y0 + h, x0:x0 + w][face.eye] = C((84, 84, 72))
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


# ---------------------------------------------------------------- materials

def fog_group():
    """Screen-space murky fog colour (backdrop and fog share it)."""
    ng = bpy.data.node_groups.get("MND_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("MND_Fog", "ShaderNodeTree")
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, unlit=False, glow_img=None, glow=GLOW_PREVIEW):
    """Texture (nearest) x vertex colour, lit by a sun (split normals: hard facets)
    plus flat ambient (or unlit), + the glow page, mixed to the fog colour by camera
    distance. mapping = 'floor' / 'wall' projects the texture by world position."""
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
        if glow_img is not None:
            gt = N.new("ShaderNodeTexImage"); gt.image = glow_img; gt.interpolation = "Closest"
            ge = N.new("ShaderNodeEmission"); ge.name = "Glow"; ge.inputs["Strength"].default_value = glow
            Lk.new(gt.outputs["Color"], ge.inputs["Color"])
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
    """public/models/mended.json (+ .png, _glow.png): the rest-pose parts in joint-local
    three.js space, per-corner split normals, v flipped for a top-left origin."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    joints = {n: {"parent": p, "pos": [round(float(x), 4) for x in pos]} for n, p, pos in JOINTS}
    order = {n: i for i, (n, j) in enumerate(PARTS)}
    parts, tris = [], {}
    hz = None
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
                n3 = tuple(round(float(x), 3) for x in b2t(n))
                uv = uvd[li].uv
                u2 = (round(float(uv.x), 4), round(float(1 - uv.y), 4))
                c3 = tuple(round(float(x), 2) for x in ca.data[li].color[:3]) if ca else ()
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
        if ob.name == "head":
            ys = [p[1] for p in P]
            hz = (min(ys) + max(ys)) / 2 + JW["neck"].z
    total = sum(tris.values())
    data = {"version": 1, "texture": GAME_ID + ".png", "emissive": GAME_ID + "_glow.png", "joints": joints,
            "parts": parts,
            "meta": {"id": GAME_ID, "name": "The Mended", "style": STYLE, "generator": "art/zombies/z_mended.py",
                     "units": "m", "up": "+Y", "facing": "+Z", "left": "+X", "pose": "rest",
                     "tris": tris, "tris_body": total, "unlit": ["eyes"], "head_parts": HEAD_PARTS,
                     "head_center_y": round(hz, 3) if hz else None,
                     "glow": "gold seams (face, neck, forearms, left hand, a few cloth cracks) and dim eyes",
                     "note": "weldcap is always worn (not per-instance headwear) and belongs to the head: hide head, "
                             "eyes and weldcap together on a headshot; tint instances 0.8-1.1; draw eyes unlit; "
                             "emissiveMap = the glow page at a low intensity (~0.35-0.5)"}}
    jp = os.path.join(EXPORT_DIR, GAME_ID + ".json")
    with open(jp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    save_png(os.path.join(EXPORT_DIR, GAME_ID + ".png"), page)
    save_png(os.path.join(EXPORT_DIR, GAME_ID + "_glow.png"), glow)
    print(f"[mended] export -> {jp} ({os.path.getsize(jp) / 1024:.1f} KB) tris {tris} total {total} "
          f"head centre {hz:.3f}")


# ---------------------------------------------------------------- build

PARTS_OBJ = []
STATE = {}


def build():
    root = kit.empty("ZOMBIE_mended")
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
    apply_pose(objs, {})
    zs = [(o.matrix_world @ v.co).z for o in objs for v in o.data.vertices]
    print(f"[mended] rest pose: feet {min(zs):.3f} m, top {max(zs):.3f} m")
    # bake in a game-like pose (arms forward, no arm/torso contact)
    apply_pose(objs, BAKE_POSE)
    body["eyes"].hide_render = True
    bake = [o for o in objs if o.name != "eyes"]
    light, pos = bake_maps(bake)
    body["eyes"].hide_render = False
    EDGE[:] = edge_light(bake)
    page, glow = paint_page(I, light, pos)
    img = make_image("mended_page", page, "texture_page.png")
    gimg = make_image("mended_glow", glow, "glow_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    export_game(objs, page, glow)
    mat = ps1_mat("MND_Mended", img, glow_img=gimg)
    emat = ps1_mat("MND_Eyes", img, vcol=False, unlit=True)
    STATE["mat"] = mat
    for ob in objs:
        kit.assign(ob, emat if ob.name == "eyes" else mat)
    ground(objs, HERO)
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
    cm = bpy.data.materials.new("MND_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("MND_Env") else (dist - near_c, dist + far_c)
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
    fimg = make_image("mended_floor", paint_floor(), "floor_tile.png")
    kit.assign(floor, ps1_mat("MND_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
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
        shutil.copy(path, os.path.join(DBG, "n_" + os.path.basename(path)))
    kit.numpy_post(path, crt)


# ---------------------------------------------------------------- extra shots

def pose_shot(root, pose, name, yaw):
    """A native 300x400 still in a given (game) pose, re-framed, with the TV post."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, pose)
    root.rotation_euler.z = 0.0
    bpy.context.view_layer.update()
    cam = sc.camera
    cam.data.lens = 50
    kit.frame_to(cam, root, margin=1.07, aim_frac=0.5, elev=0.10)
    set_fog(cam.location.length)
    root.rotation_euler.z = math.radians(yaw)
    p = os.path.join(OUT, name + ".png")
    render_native(p)
    post(p)
    print(f"[mended] {name} ->", p)


def face_shot(root):
    """Head close-up at native resolution, the cap and goggles in frame."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, HERO)
    root.rotation_euler.z = math.radians(-22)
    bpy.context.view_layer.update()
    head = bpy.data.objects["head"]
    hc = head.matrix_world @ V((0, -0.02, 0.13))
    cam = sc.camera
    cam.data.lens = 50
    cam.location = hc + V((0.0, -1.0, 0.04))
    kit._aim(cam, hc + V((0, 0, -0.02)))
    set_fog(1.0, near_c=0.3, far_c=6.0)
    p = os.path.join(OUT, "face.png")
    render_native(p)
    post(p)
    print("[mended] face ->", p)


def ingame(root):
    """The Mended at fighting distance (~6 m) in the walk pose: 320x240, dark bunker fog."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    ground(PARTS_OBJ, WALK)
    root.rotation_euler.z = math.radians(-16)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.75, -5.9, 1.62)
    kit._aim(cam, (0.1, 0, 1.05))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = fog_group()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = lin((5, 8, 7)); mix.inputs[7].default_value = lin((26, 36, 30))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    wimg = make_image("mended_wall", paint_wall())
    wmat = ps1_mat("MND_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("MND_EnvHole", make_image("mended_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("mended_wood", paint_wood())
    wm = ps1_mat("MND_EnvWoodM", wood, None, vcol=False)
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
    chalk = ps1_mat("MND_EnvChalk", make_image("mended_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
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
    set_fog((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=10.0, near_f=2.0, far_f=5.0)
    for m in bpy.data.materials:
        a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
        if a:
            k_ = 0.55 if m.name.startswith("MND_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[mended] ingame ->", p)


if "--export" in ARGS and "--final" not in ARGS:
    kit.reset()
    os.makedirs(OUT, exist_ok=True)
    build()
else:
    kit.run(STYLE, build, stage, post,
            meta={"technique": "rigid faceted prisms (hard normals > 30 deg) in the game rig's rest pose, posed by FK; "
                               "256px page, <=16-colour CLUT per region, painted light x Cycles-baked AO/facet light, "
                               "edge highlights; porcelain cracks painted in 3D from baked positions; gold on a glow "
                               "page; native 300x400 + composite/CRT post",
                  "texture_page": "256x256", "game_model": "public/models/mended.json"})
    root = bpy.data.objects["ZOMBIE_mended"]
    if "--final" in ARGS or "--walk" in ARGS:
        pose_shot(root, WALK, "walk", -35)
        pose_shot(root, WALK, "walk_side", -90)
    if "--final" in ARGS or "--face" in ARGS:
        face_shot(root)
    if "--final" in ARGS or "--ingame" in ARGS:
        ingame(root)
