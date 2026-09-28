# The Stoker (stoker): the bunker's boiler-room stoker, burned to death at the
# furnace and still smouldering. A brute zombie for the 1997 disc (art/STYLE.md),
# built on the Polygon Ghoul v3 pipeline (z_ps1c.py: faceted prisms, hard normals,
# one 256px page with hue-shifted ramps, Cycles-baked painted light, the game rig
# in its rest pose, JSON export) with the hellhound's ember cracks (z_hound.py)
# painted onto a glow page.
#
# Silhouette: a top-heavy wedge. Very broad squared shoulders (a flat trapezius
# shelf with hard corners, deltoid caps), thick bare forearms into huge riveted
# leather gauntlets, a short thick neck, and sturdy legs that look shorter under a
# long heavy leather apron: a bib plate on the chest, a stiff plate below the belt
# and a split skirt, one flap per thigh (so the legs still swing), all hard faceted
# plates with a visible thickness. A torn singlet under crossed apron straps, a
# chain and an oily rag at the belt, and a tall tufted wool cap pulled down to a
# heavy brow over two dying-coal eyes.
# Skin: soot-charred (the hound's hide, made human) with restrained ember cracks on
# the forearms, upper arms, chest, neck and a few across the face. Embers and eyes
# are also written to stoker_glow.png (same UVs, black = no glow).
#
# Rig: the Ghoul's 12 joints and names (src/client/render/zombies.js animates every
# zombie with the same code), brute proportions: shoulders at +-0.33, slightly
# shorter legs. Parts are rigid, in joint-local space, rest pose = standing with the
# arms hanging. `head` on `neck` (hidden by headshots), the wool cap is `woolcap`.
#
#   node art/zombies/blend.mjs z_stoker.py --preview [--views front,side,back] [--face] [--walk] [--ingame] [--rest]
#   node art/zombies/blend.mjs z_stoker.py --final     (heroes, turntable, face, walk, rest, ingame)
# Every run exports public/models/stoker.json + stoker.png + stoker_glow.png.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree

STYLE = "stoker"
GAME_ID = "stoker"
OUT = os.path.join(kit.OUT_BASE, STYLE)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DBG = os.path.join(OUT, "_d") if os.environ.get("STOKER_DEBUG") else None
EXPORT_DIR = os.path.join(kit.ROOT, "public", "models")
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP_DEG = 30.0                            # split normals above this dihedral angle
EDGE_HI, EDGE_LO = 0.30, 0.80               # painted ridge highlight / crease darkening
KEY = V((0.0, -0.42, 0.91)).normalized()    # painted key: a bulb above, slightly in front
GLOW_STRENGTH = 2.0                         # preview emission of the glow page (the game: see meta.glow)
GLOW_GAME = 1.4                             # intended three.js emissiveIntensity for stoker_glow.png

# ---------------------------------------------------------------- CLUT ramps (sRGB)
# The world table (z_ps1b / z_ps1c) and the hound's fire, plus the stoker's own
# materials in the same value range and hue shift (cool violet shadows, warm
# highlights). Second value = the "lit base" entry. Only embers pass blood/chalk
# saturation. Short sub-ramps (char5, apron3) keep each part near 16 colours.
RAMPS = {
    "trousers": ([(24, 27, 27), (36, 40, 35), (50, 55, 43), (65, 71, 54), (82, 88, 66),
                  (102, 107, 80), (126, 128, 98)], 4),
    "leather": ([(18, 14, 14), (32, 25, 22), (47, 36, 28), (64, 49, 36), (86, 68, 50)], 3),
    "metal": ([(60, 58, 56), (170, 166, 150)], 1),
    "steel": ([(34, 34, 36), (70, 70, 68), (112, 110, 102)], 1),
    "bloodc2": ([(44, 14, 14), (80, 24, 20)], 1),
    "concrete": ([(26, 30, 28), (36, 40, 37), (46, 50, 45), (58, 62, 55), (72, 75, 66)], 3),
    "wood": ([(30, 22, 18), (46, 34, 26), (64, 48, 34), (86, 66, 46)], 2),
    "chalk": ([(120, 30, 26), (170, 52, 40)], 1),
    # the hound's fire: embers are set by glow level, not by light
    "ember3": ([(118, 26, 10), (196, 70, 18), (246, 150, 60)], 1),
    "ash": ([(92, 88, 88)], 0),
    # charred skin: the hound's hide made human (a touch warmer and lighter, so a face reads)
    "char": ([(17, 15, 20), (26, 22, 28), (37, 31, 36), (50, 41, 44), (66, 53, 52), (84, 66, 60),
              (102, 86, 76), (124, 110, 98)], 5),                # lit planes go to ash, not to skin
    "char5": ([(26, 22, 28), (40, 33, 38), (58, 47, 48), (82, 65, 60), (108, 92, 82)], 3),
    "sear": ([(58, 24, 20), (104, 48, 36)], 1),                  # raw seared flesh, gums
    "tooth": ([(74, 64, 50), (128, 114, 88)], 1),                # scorched teeth
    "singlet": ([(30, 29, 31), (46, 44, 43), (66, 62, 57), (90, 84, 74), (116, 108, 92), (142, 132, 112)], 3),
    "apron": ([(18, 14, 15), (28, 21, 20), (40, 30, 26), (55, 41, 32), (72, 54, 40), (92, 69, 50),
               (114, 86, 60), (138, 105, 72)], 3),                # heavy dark saddle leather
    "apron3": ([(40, 30, 26), (72, 54, 40), (114, 86, 60)], 1),
    "glove": ([(26, 21, 19), (40, 32, 27), (57, 46, 37), (78, 63, 48), (102, 83, 62), (128, 105, 78),
               (154, 128, 96)], 4),                              # buff work leather
    "wool": ([(24, 19, 20), (36, 27, 26), (50, 36, 32), (68, 46, 39), (88, 59, 47), (110, 74, 56),
              (134, 92, 68)], 3),                                # scorched rust-brown knit
    "rag": ([(44, 24, 22), (76, 40, 32), (110, 62, 46), (142, 88, 64)], 2),
}
# glow page levels (index = round(glow * 5)); black = no glow. A shade under the hound's.
GLOW_C = np.array([(0, 0, 0), (64, 11, 2), (128, 32, 6), (200, 78, 16), (248, 140, 48), (255, 204, 128)], float) / 255.0


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMP_C = {k: np.array(v[0], float) / 255.0 for k, v in RAMPS.items()}
RAMP_LL = {k: np.log(np.array([_luma(c) for c in v[0]]) / _luma(v[0][v[1]])) for k, v in RAMPS.items()}

# texture page layout: name -> (x0, y0, w, h), top-left origin. The head wraps once
# with the front half getting two thirds of its columns (face ~3x body density).
REG = {
    "head": (0, 0, 96, 96), "torso": (96, 0, 128, 80),
    "neck": (224, 0, 32, 16), "eyes": (224, 16, 16, 8), "nose": (240, 16, 16, 8),
    "ear": (224, 24, 16, 16), "tuft": (240, 24, 16, 16),
    "palm": (224, 40, 32, 16), "fing": (224, 56, 32, 16),
    "thumb": (224, 72, 16, 16), "chain": (240, 72, 16, 16),
    "pelvis": (96, 80, 128, 24),
    "cap": (0, 96, 64, 32), "boot": (64, 96, 32, 32),
    "bib": (96, 104, 48, 40), "apron": (144, 104, 64, 40), "foot": (208, 104, 48, 24),
    "flap.L": (0, 128, 32, 56), "flap.R": (32, 128, 32, 56),
    "uarm.L": (64, 144, 48, 40), "uarm.R": (112, 144, 48, 40),
    "farm.L": (160, 144, 48, 40), "farm.R": (208, 144, 48, 40),
    "thigh.L": (0, 184, 40, 40), "thigh.R": (40, 184, 40, 40),
    "shin.L": (80, 184, 48, 40), "shin.R": (128, 184, 48, 40),
    "rag": (176, 184, 24, 40),
}
HEAD_FRONT = 2.0 / 3.0


def _check_regions():
    occ = np.zeros((AT, AT), int)
    for n, (x, y, w, h) in REG.items():
        assert x + w <= AT and y + h <= AT, n
        occ[y:y + h, x:x + w] += 1
    assert occ.max() == 1, "texture regions overlap"


_check_regions()

# ---------------------------------------------------------------- the game rig
# three.js space (+Y up, facing +Z, character's left = +X), pos relative to the parent.
# The Ghoul's joints with brute proportions: wider shoulders, shorter legs.
JOINTS = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.92, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.555, 0.03)), ("shL", "spine", (0.33, 0.49, 0.0)), ("shR", "spine", (-0.33, 0.49, 0.0)),
    ("elL", "shL", (0.0, -0.32, 0.0)), ("elR", "shR", (0.0, -0.32, 0.0)),
    ("hipL", "hips", (0.11, -0.05, 0.0)), ("hipR", "hips", (-0.11, -0.05, 0.0)),
    ("knL", "hipL", (0.0, -0.43, 0.0)), ("knR", "hipR", (0.0, -0.43, 0.0)),
]
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("woolcap", "neck"), ("eyes", "neck"),
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
STANCE = {"spine": (0.17, 0.0, 0.03), "neck": (-0.14, -0.18, 0.12),
          "shL": (-1.30, 0.0, 0.10), "shR": (-1.18, 0.0, -0.10), "elL": (-0.15, 0, 0), "elR": (-0.34, 0, 0),
          "hipL": (-0.20, 0, 0.02), "knL": (0.16, 0, 0), "hipR": (0.12, 0, -0.03), "knR": (0.10, 0, 0)}


def walk_pose(ph=2.1, t=0.6, arm_drop=0.2, head_tilt=0.14, limp=0.0):
    """Zombies.pose() for a walker (src/client/render/zombies.js), locomotion branch."""
    amp = 0.42
    s, c = math.sin(ph), math.cos(ph)
    sway = math.sin(t * 1.3) * 0.05
    return {"hipL": (s * amp, 0, 0), "hipR": (-s * amp * (1 - limp), 0, 0),
            "knL": (max(0.0, -c) * amp * 1.4 + 0.05, 0, 0), "knR": (max(0.0, c) * amp * 1.4 * (1 - limp * 0.5) + 0.05, 0, 0),
            "spine": (0.16 + sway, 0, s * 0.07),
            "shL": (-1.4 + arm_drop * 0.6 + math.sin(t * 1.7) * 0.08, 0, 0.1), "shR": (-1.35 + math.cos(t * 1.9) * 0.08, 0, -0.1),
            "elL": (-0.15, 0, 0), "elR": (-0.3, 0, 0),
            "neck": (-0.1 + math.sin(t * 2.1) * 0.08, math.sin(t * 0.7) * 0.2, head_tilt)}


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


def border(mask):
    """Texels of a mask that touch a texel outside it (4-neighbourhood)."""
    m = np.asarray(mask, bool)
    e = np.zeros_like(m)
    for sh in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        e |= m & ~np.roll(m, sh, (0, 1))
    return e


# ---------------------------------------------------------------- the painter

class Reg:
    """One texture-page region painted as material ids + painted light, in metres,
    plus a glow layer. X runs round the part (0 = front centre, + = character's
    left, wraps if P), Y runs down the part (0 = first ring). Quantised to the part's
    CLUT by finish(); ember texels take their ramp entry from the glow level."""

    def __init__(s, name, mats, X, Y, P=None, tx=0.01, ty=0.01, seed=0):
        s.name = name
        s.h, s.w = X.shape
        s.mats = list(mats)
        s.X, s.Y, s.P, s.tx, s.ty = X, Y, P, tx, ty
        s.id = np.zeros((s.h, s.w), np.int16)
        s.sh = np.ones((s.h, s.w))
        s.glow = np.zeros((s.h, s.w))
        s.rng = np.random.default_rng(seed)
        s.nz = lowfreq(s.rng, s.h, s.w, 3)                 # edge roughness
        s.fixes = []
        s.over = []
        s.ember = next((m for m in s.mats if m.startswith("ember")), None)

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

    def hot(s, mask, g):
        mk = np.asarray(mask, float) > 0.5
        s.put(mk, s.ember)
        s.glow = np.where(mk, np.maximum(s.glow, g), s.glow)

    def at(s, P3, p):
        """Region coordinates (X, Y) of the texel whose rest position is nearest p."""
        d = np.sum((P3 - np.array(p, float)) ** 2, axis=2)
        r, c = np.unravel_index(np.argmin(d), d.shape)
        return float(s.X[r, c]), float(s.Y[r, c])

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

    def _crack_line(s, pts, gg, halo, base, W):
        rim = s.line(pts, 1.25 * max(s.tx, s.ty)) * W
        s.put(rim, base); s.lit(rim, 0.55)
        s.glow = np.maximum(s.glow, rim * gg * halo)
        core = s.line(pts, 0.5 * max(s.tx, s.ty)) * W
        s.hot(core, gg)

    def crack(s, x0, y0, ang, n, step, g=0.7, seed=0, branch=0.25, wiggle=0.55, halo=0.22, base=None, where=None):
        """An ember crack (z_hound): a random walk with side branches, a charred rim
        round a one-texel ember core, and a dim glow halo. `where` clips it."""
        rng = np.random.default_rng(seed)
        base = base or s.mats[0]
        W = 1.0 if where is None else np.asarray(where, float)
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
            s._crack_line(pts, gg, halo, base, W)

    def crack_path(s, pts, g=0.7, seed=0, jitter=0.45, halo=0.22, base=None, where=None, forks=()):
        """A hand-placed ember crack along a polyline (region X, Y), broken into short
        jittered steps so it stays jagged; forks = [(point index, angle, steps)] add
        short random-walk branches."""
        rng = np.random.default_rng(seed)
        base = base or s.mats[0]
        W = 1.0 if where is None else np.asarray(where, float)
        step = 1.7 * max(s.tx, s.ty)
        out = [tuple(pts[0])]
        for p0, p1 in zip(pts, pts[1:]):
            dx_, dy_ = p1[0] - p0[0], p1[1] - p0[1]
            L = max(1e-9, math.hypot(dx_, dy_)); k = max(1, int(round(L / step)))
            for i in range(1, k + 1):
                t = i / k
                j = rng.uniform(-jitter, jitter) * step if i < k else 0.0
                out.append((p0[0] + dx_ * t - dy_ / L * j, p0[1] + dy_ * t + dx_ / L * j))
        s._crack_line(out, g, halo, base, W)
        for i, ang, n in forks:
            s.crack(pts[i][0], pts[i][1], ang, n, step, g * 0.8, seed + 7 * (i + 1), branch=0.0, wiggle=0.4,
                    halo=halo, base=base, where=where)

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
        """Force a ramp entry on a mask after quantising (light-independent)."""
        s.over.append((np.asarray(mask) > 0.5, mat, k))

    def rivet(s, x0, y0, r=1.1):
        """A domed iron rivet: a steel dot, its catch light and a shadow below."""
        d = np.sqrt((s.dx(x0) / (r * s.tx)) ** 2 + ((s.Y - y0) / (r * s.ty)) ** 2)
        dot = d < 1
        s.put(dot, "steel"); s.lit(dot, 1.0)
        sd = np.sqrt((s.dx(x0 + 0.5 * s.tx) / (r * s.tx)) ** 2 + ((s.Y - y0 - 1.5 * s.ty) / (0.8 * r * s.ty)) ** 2)
        s.lit((sd < 1) & ~dot, 0.55)
        s.fix(x0 - 0.3 * s.tx, y0 - 0.3 * s.ty, "steel", 2)

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
        for mk, mn, k in s.over:
            out[mk] = RAMP_C[mn][k]
        for r, c, mn, k in s.fixes:
            out[r, c] = RAMP_C[mn][k]
        gl = GLOW_C[np.clip(np.round(s.glow * 5), 0, 5).astype(int)]
        n = len(np.unique(np.round(out.reshape(-1, 3) * 255).astype(int), axis=0))
        if n > 16:
            print(f"[stoker] note: region {s.name} uses {n} colours")
        return out, gl


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
    r.col = np.arange(w)[None, :].repeat(h, 0)
    r.row = np.arange(h)[:, None].repeat(w, 1)
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


def oct8(rx, ry):
    """Eight-sided ring with a flat face at the front and back (the wool cap)."""
    return [[-rx * math.sin(ph), -ry * math.cos(ph), 0]
            for ph in (math.pi * (k / 4 + 1 / 8) for k in range(8))]


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
         front=None):
    """A rigid segment: rings of profile points (x side, y front[, a back along the
    centre line]) round a centre line. UVs wrap round the ring by arc length (or
    mirrored: 0 = front centre, `mirror` = the side vertex, 1 = back centre; or
    front-weighted: the front half between the side vertices gets `front` of the
    width, the seam at the back centre) and run along the segment (v = 1 at the
    first ring). An end is open, capped flat (a flat colour from the end row) or
    closed by a fan to an `apex` point. Faces are smooth; harden() splits the
    sharp edges."""
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
        hh, q1, q3 = n // 2, n // 4, 3 * n // 4
        if front is not None:
            b = (1 - front) / 2
            row = []
            for k in range(n + 1):
                if k <= q1:
                    u = L[k] / L[q1] * b
                elif k <= q3:
                    u = b + (L[k] - L[q1]) / (L[q3] - L[q1]) * front
                else:
                    u = b + front + (L[k] - L[q3]) / (L[n] - L[q3]) * b
                row.append(u)
            xs.append(row)
        elif mirror is None:
            xs.append([l / L[-1] for l in L])
        else:
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


def _mkface(bm, uvl, vv, uvs, want):
    """One face from verts and (region, u, v_top) UVs, wound to face `want`."""
    co = [v.co for v in vv]
    nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
    if nrm.dot(V(want)) < 0:
        vv, uvs = vv[::-1], uvs[::-1]
    fc = bm.faces.new(vv)
    fc.smooth = True
    for lp, (rg, u, vt) in zip(fc.loops, uvs):
        lp[uvl].uv = uv_in(REG[rg], u, 1 - vt)
    return fc


def poly_obj(name, polys):
    """A small mesh from explicit polygons: [(points, uvs (region, u, v_top), want_normal)]."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for pts, uvs, want in polys:
        _mkface(bm, uvl, [bm.verts.new(V(p)) for p in pts], list(uvs), want)
    return kit.mesh_obj(name, bm, None, smooth=False)


def plate(name, grid, rg, thick=0.012, edges=("left", "right", "bottom"), back=(0, 1, 0), twosided=False):
    """A stiff faceted plate (heavy leather) from a grid of world points, rows top ->
    bottom. Front faces point away from `back`; the listed border edges get a
    thickness band (offset along `back`) that samples the region's rim texels, so the
    cut edge reads as one darker line. `twosided` adds back faces (thin cloth)."""
    nr, nc = len(grid), len(grid[0])
    x0, y0, w, h = REG[rg]
    iu = lambda j: (0.5 + j / (nc - 1) * (w - 1)) / w
    iv = lambda i: (0.5 + i / (nr - 1) * (h - 1)) / h
    bk = V(back).normalized()
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new("UVMap")
    Fv = [[bm.verts.new(V(p)) for p in row] for row in grid]
    ctr = sum((V(p) for row in grid for p in row), V()) / (nr * nc)
    Bv = {}

    def bv(i, j):
        if (i, j) not in Bv:
            Bv[(i, j)] = bm.verts.new(Fv[i][j].co + bk * thick)
        return Bv[(i, j)]
    for i in range(nr - 1):
        for j in range(nc - 1):
            uu = [(rg, iu(j), iv(i)), (rg, iu(j + 1), iv(i)), (rg, iu(j + 1), iv(i + 1)), (rg, iu(j), iv(i + 1))]
            _mkface(bm, uvl, [Fv[i][j], Fv[i][j + 1], Fv[i + 1][j + 1], Fv[i + 1][j]], uu, -bk)
            if twosided:
                _mkface(bm, uvl, [bv(i, j), bv(i, j + 1), bv(i + 1, j + 1), bv(i + 1, j)], uu, bk)
    lines = {"top": [(0, j) for j in range(nc)], "bottom": [(nr - 1, j) for j in range(nc)],
             "left": [(i, 0) for i in range(nr)], "right": [(i, nc - 1) for i in range(nr)]}
    for e in edges:
        pts = lines[e]
        for (i, j), (i2, j2) in zip(pts, pts[1:]):
            uu = [(rg, iu(j), iv(i)), (rg, iu(j2), iv(i2)), (rg, iu(j2), iv(i2)), (rg, iu(j), iv(i))]
            mid = (Fv[i][j].co + Fv[i2][j2].co) / 2
            out = mid - ctr
            _mkface(bm, uvl, [Fv[i][j], Fv[i2][j2], bv(i2, j2), bv(i, j)], uu, out - bk * out.dot(bk))
    return kit.mesh_obj(name, bm, None, smooth=False)


def spikes(name, tufts, rg):
    """Three-sided pyramids (base triangle, apex): wool tufts. No base faces."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new("UVMap")
    for base, apex in tufts:
        bv = [bm.verts.new(V(p)) for p in base]
        av = bm.verts.new(V(apex))
        ctr = sum((V(p) for p in base), V()) / 3
        for k in range(3):
            a, b = bv[k], bv[(k + 1) % 3]
            _mkface(bm, uvl, [a, b, av], [(rg, k / 3, 1.0), (rg, (k + 1) / 3, 1.0), (rg, (k + 0.5) / 3, 0.0)],
                    (a.co + b.co) / 2 - ctr)
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

HEAD_YC = -0.034
# head rings, crown (under the cap) .. chin: (z, y offset, half-width, back, front, pushes {k: (out, fwd[, up])})
HEADR = [
    (1.736, 0.004, 0.084, 0.090, 0.084, {}),
    (1.710, 0.002, 0.097, 0.103, 0.101, {}),                                                   # forehead (cap brim)
    (1.692, 0.000, 0.101, 0.105, 0.106, {4: (0.004, 0.012), 5: (0.004, 0.019), 6: (0, 0.014)}),   # heavy brow ridge
    (1.671, 0.000, 0.098, 0.103, 0.101, {4: (0, -0.004), 5: (-0.004, -0.024), 6: (0, -0.006)}),   # deep sockets
    (1.640, 0.000, 0.101, 0.100, 0.103, {4: (0.012, 0.012), 5: (0.0, -0.004)}),                 # cheekbones
    (1.611, 0.000, 0.095, 0.095, 0.100, {3: (0, 0, 0.004), 4: (-0.006, -0.006), 5: (-0.002, -0.004)}),
    (1.583, 0.000, 0.097, 0.084, 0.101, {0: (0, 0, 0.016), 1: (0, 0, 0.016), 2: (0, 0, 0.010), 3: (0.006, 0, 0.004),
                                         4: (0.006, 0.002), 5: (-0.002, 0.004), 6: (0, 0.006)}),  # wide jaw, mouth
    (1.553, 0.000, 0.068, 0.060, 0.095, {0: (0, 0, 0.030), 1: (0, 0, 0.030), 2: (0, 0, 0.022), 3: (0, 0, 0.010),
                                         4: (-0.004, 0.0), 5: (-0.006, 0.008), 6: (0, 0.014)}),   # broad wedge chin
]
HEAD_ROWS = (5, 13, 22, 30, 44, 56, 68, 82)             # texel rows of the rings (apexes at rows 0 and 96)
HEAD_TOP, HEAD_BOT = 1.758, 1.537
EYE = (0.041, 1.667)                                   # eye centre (|x|, z)
CAP_PIVOT = V((0.0, HEAD_YC + 0.006, 1.700))


def build_rest():
    """Every part in the rest pose, in world coordinates (Blender: Z up, facing -Y,
    left = +X). Returns (loft infos for painting, {part name: [objects]})."""
    I, G = {}, {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1)); dn = V((0, 0, -1))

    # ---- head: faceted box skull, heavy brow, wide wedge jaw; burned nose; ear stubs
    head, I["head"] = loft("head", [(0, HEAD_YC + yo, z) for z, yo, *_ in HEADR],
                           [hbox(w, db, df, p) for z, yo, w, db, df, p in HEADR], fwd, REG["head"],
                           front=HEAD_FRONT, vs=[1 - r / REG["head"][3] for r in HEAD_ROWS],
                           apex=((0, HEAD_YC - 0.002, HEAD_TOP), (0, HEAD_YC + 0.016, HEAD_BOT)))
    yf = lambda f: HEAD_YC - f                         # forward distance -> world y
    top, tip = (0, yf(0.098), 1.664), (0, yf(0.121), 1.627)
    nose = []
    for sx in (1, -1):
        base = (sx * 0.016, yf(0.099), 1.616)
        nose.append(([top, tip, base], [("nose", 0.02, 0.0), ("nose", 0.02, 0.8), ("nose", 0.98, 0.8)],
                     (sx, -1, 0.3)))
    nose.append(([(0.016, yf(0.099), 1.616), tip, (-0.016, yf(0.099), 1.616)],
                 [("nose", 0.98, 0.85), ("nose", 0.02, 0.9), ("nose", 0.98, 0.98)], (0, -0.3, -1)))
    nose_ob = poly_obj("nose", nose)
    ears = []
    for sx in (1, -1):
        rt, rb = (sx * 0.097, yf(0.000), 1.674), (sx * 0.095, yf(-0.006), 1.626)
        tt, tb = (sx * 0.111, yf(-0.020), 1.669), (sx * 0.107, yf(-0.024), 1.633)
        uv = [("ear", 0.02, 0.02), ("ear", 0.98, 0.02), ("ear", 0.98, 0.98), ("ear", 0.02, 0.98)]
        ears.append(([rt, tt, tb, rb], uv, (sx, 0.4, 0)))
        ears.append(([(p[0] - sx * 0.002, p[1], p[2]) for p in (rt, tt, tb, rb)], uv, (-sx, -0.4, 0)))
    ear_ob = poly_obj("ears", ears)
    head_tree = bvh(head)
    G["head"] = [head, nose_ob, ear_ob]

    # ---- eyes: two small diamonds over the painted coals (drawn unlit in the game)
    eyes = []
    for sx in (1, -1):
        loc, n = hit_front(head_tree, sx * EYE[0], EYE[1], 0.0022)
        if loc is None:
            loc, n = V((sx * EYE[0], yf(0.08), EYE[1])), V((0, -1, 0))
        a = V((sx, 0, 0)); a = (a - n * a.dot(n)).normalized()
        b = n.cross(a).normalized()
        if b.z < 0:
            b = -b
        pts = [loc - a * 0.0115, loc - b * 0.0066, loc + a * 0.0115, loc + b * 0.0066]
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        eyes.append((pts, [("eyes", u(0.02), 0.5), ("eyes", 0.5, 0.98), ("eyes", u(0.98), 0.5), ("eyes", 0.5, 0.02)],
                     tuple(n)))
    G["eyes"] = [poly_obj("eyes", eyes)]

    # ---- the tall wool cap: a rolled cuff pulled down to the brow, a tall crown, tufts on top
    cyc = CAP_PIVOT.y
    CAPR = [(1.700, 0.114, 0.120), (1.746, 0.118, 0.124), (1.749, 0.105, 0.111), (1.816, 0.096, 0.100),
            (1.858, 0.064, 0.068)]
    cap, I["woolcap"] = loft("woolcap", [(0, cyc, z) for z, *_ in CAPR], [oct8(rx, ry) for z, rx, ry in CAPR],
                             fwd, REG["cap"], caps=(False, True), cap_u=0.5)
    tufts = []                                      # a gathered crown of stiff wool tufts, splayed outward
    for ang, lean, h in ((-0.25, 0.034, 0.046), (1.30, 0.030, 0.040), (2.75, 0.036, 0.044), (4.35, 0.028, 0.038),
                         (0.0, 0.004, 0.050)):
        o = V((math.sin(ang), -math.cos(ang), 0))
        c = V((0, cyc, 1.848)) + o * (0.018 if lean > 0.01 else 0.0)
        side = V((-o.y, o.x, 0))
        base = [c - o * 0.020 + side * 0.022, c - o * 0.020 - side * 0.022, c + o * 0.024]
        tufts.append((base, c + o * lean + V((0, 0, h))))
    tuft_ob = spikes("tufts", tufts, "tuft")
    tilt = Matrix.Translation(CAP_PIVOT) @ Matrix.Rotation(math.radians(-6), 4, "X") @ \
        Matrix.Rotation(math.radians(-3), 4, "Y") @ Matrix.Translation(-CAP_PIVOT)
    for ob in (cap, tuft_ob):
        ob.data.transform(tilt)
    G["woolcap"] = [cap, tuft_ob]

    # ---- torso: a wedge, very broad squared shoulders (flat trapezius shelf, hard corners)
    TORSO = [(1.578, 0.016, 0.128, 0.082, 0.072, {}),
             (1.534, 0.010, 0.300, 0.126, 0.110, {1: (0, -0.012)}),
             (1.452, 0.000, 0.286, 0.136, 0.150, {1: (0, -0.010)}),
             (1.335, 0.000, 0.262, 0.130, 0.150, {}),
             (1.195, 0.004, 0.218, 0.116, 0.132, {}),
             (1.000, 0.004, 0.200, 0.110, 0.122, {})]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO],
                             [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO], fwd, REG["torso"], (True, False),
                             cap_u=0.5)
    neck, I["neck"] = loft("neck", [(0, 0.004, 1.500), (0, -0.020, 1.604)],
                           [hexprof(0.072, 0.068, {3: (0, 0.004)}), hexprof(0.066, 0.062, {3: (0, 0.004)})],
                           fwd, REG["neck"], (False, False))
    # apron bib: hangs from the chest, tucked under the belt; straps are painted
    BB = [(1.442, 0.128, 0.046, 0.150, 0.162), (1.300, 0.156, 0.054, 0.150, 0.164), (1.050, 0.150, 0.060, 0.105, 0.131)]
    bib = plate("bib", [[(-xo, -fs, z), (-xi, -fi, z), (xi, -fi, z), (xo, -fs, z)] for z, xo, xi, fs, fi in BB],
                "bib", 0.010, ("left", "right", "top"))
    G["torso"] = [torso, neck, bib]

    # ---- pelvis: a thick belt band, the trouser seat, the apron plate below the belt,
    # an oily rag tucked into the back of the belt, a chain looped at the left hip
    PEL = [(1.092, 0.004, 0.218, 0.126, 0.146), (1.030, 0.004, 0.222, 0.128, 0.150),
           (0.935, 0.008, 0.206, 0.130, 0.120), (0.815, 0.006, 0.170, 0.108, 0.100)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL],
                               [tbox(w, db, df) for z, yc, w, db, df in PEL], fwd, REG["pelvis"], (False, True))
    AP = [(1.046, 0.190, 0.075, 0.075, 0.136), (0.905, 0.208, 0.075, 0.100, 0.156), (0.762, 0.222, 0.075, 0.118, 0.172)]
    apron = plate("apron", [[(-xo, -fs, z), (-xi, -fi, z), (xi, -fi, z), (xo, -fs, z)] for z, xo, xi, fs, fi in AP],
                  "apron", 0.014, ("left", "right", "bottom"))
    rag = plate("rag", [[(-0.170, 0.126, 1.074), (-0.078, 0.130, 1.074)],
                        [(-0.176, 0.158, 0.962), (-0.074, 0.162, 0.968)],
                        [(-0.166, 0.152, 0.842), (-0.082, 0.156, 0.868)]],
                "rag", 0.004, (), back=(0, -1, 0), twosided=True)
    CH = [(0.224, -0.045, 1.045), (0.238, -0.020, 0.980), (0.242, 0.020, 0.958), (0.226, 0.064, 0.992),
          (0.186, 0.088, 1.045)]
    tri = lambda r_: [[0.0, r_, 0.0], [-0.87 * r_, -0.5 * r_, 0.0], [0.87 * r_, -0.5 * r_, 0.0]]
    chain, I["chain"] = loft("chain", CH, [tri(0.011)] * len(CH), V((1, 0, 0)), REG["chain"], (False, False))
    G["pelvis"] = [pelvis, apron, rag, chain]

    for sd, sx in (("L", 1), ("R", -1)):
        # ---- upper arm: bare, heavy deltoid cap over the squared shoulder, thick biceps
        sh = JW["sh" + sd]
        UA = [(0.012, 0.088, 0.084, sx * 0.014, 0), (-0.080, 0.094, 0.090, sx * 0.010, 4),
              (-0.215, 0.080, 0.080, 0.0, 8), (-0.300, 0.076, 0.076, 0.0, 10)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d, dx, tw in UA],
                                   [twist(hexprof(w, d), sx * tw) for z, w, d, dx, tw in UA], fwd, REG["uarm." + sd],
                                   (False, True), apex=(sh + V((sx * 0.046, 0.004, 0.054)), None))
        G["upperArm." + sd] = [ua]

        # ---- forearm: thick and bare to a flared gauntlet cuff; a huge riveted mitt
        el = JW["el" + sd]
        p_ = math.radians(20)                                            # hanging hand pronated a little
        n = V((-sx * math.cos(p_), math.sin(p_), 0))                     # palm normal (inward, a bit back)
        td = V((-sx * math.sin(p_), -math.cos(p_), 0))                   # thumb side (front)
        bk = -n                                                          # back of the hand
        FA = [(0.045, 0.072, 0.072, {}), (-0.015, 0.082, 0.080, {0: (0, -0.034)}), (-0.132, 0.079, 0.076, {}),
              (-0.138, 0.101, 0.097, {}), (-0.244, 0.072, 0.066, {})]
        FA_ROWS = (0, 6, 21, 26, 40)
        fr = [fwd, fwd, fwd, fwd, (fwd + td).normalized()]
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d, p), sx * 4 * k) for k, (z, w, d, p) in enumerate(FA)], fr,
                                   REG["farm." + sd], (False, False), vs=[1 - r / REG["farm." + sd][3] for r in FA_ROWS])
        wr = el + V((0, 0, -0.246))
        palm, I["palm"] = loft("palm." + sd, [wr + dn * -0.014, wr + dn * 0.096],
                               [flatprof(0.042, 0.022), flatprof(0.060, 0.027, {3: (0, 0.007)})],
                               bk, REG["palm"], (False, True))
        k0 = wr + dn * 0.090
        a1 = (dn * math.cos(math.radians(25)) + n * math.sin(math.radians(25))).normalized()
        a2 = (dn * math.cos(math.radians(78)) + n * math.sin(math.radians(78))).normalized()
        k1 = k0 + a1 * 0.056; k2 = k1 + a2 * 0.046
        fb = lambda al: (bk * math.cos(math.radians(al)) + dn * math.sin(math.radians(al))).normalized()
        fing, I["fing"] = loft("fing." + sd, [k0, k1, k2],
                               [flatprof(0.060, 0.017, {3: (0, 0.006)}), flatprof(0.057, 0.015), flatprof(0.050, 0.012)],
                               [fb(12), fb(50), fb(78)], REG["fing"], (False, True))
        tb = wr + dn * 0.020 + td * 0.040 + n * 0.008
        t1 = (dn * 0.55 + td * 0.55 + n * 0.45).normalized()
        t2 = (dn * 0.50 + n * 0.80 + td * 0.10).normalized()
        th, I["thumb"] = loft("thumb." + sd, [tb, tb + t1 * 0.042, tb + t1 * 0.042 + t2 * 0.034],
                              [boxprof(0.016, 0.014), boxprof(0.015, 0.013), boxprof(0.012, 0.010)],
                              bk, REG["thumb"], (False, True))
        G["lowerArm." + sd] = [fa, palm, fing, th]

        # ---- thigh: sturdy trouser prism; the split apron's flap rides on it (so the leg can swing)
        hp = JW["hip" + sd]
        TG = [(0.060, 0.102, 0.110, {}, 0), (-0.260, 0.096, 0.104, {}, 4), (-0.440, 0.084, 0.090, {3: (0, 0.014)}, 6)]
        tg, I["thigh." + sd] = loft("thigh." + sd, [hp + V((0, 0, z)) for z, *_ in TG],
                                    [twist(hexprof(w, d, p), -sx * tw) for z, w, d, p, tw in TG], fwd,
                                    REG["thigh." + sd], (False, True))
        FX = [0.008, 0.075, 0.150, 0.208]; FF = [0.138, 0.146, 0.136, 0.086]
        FZ = [(0.805, 0.000, 1.00), (0.590, 0.004, 1.02), (0.372, 0.012, 1.05)]
        grid = [[(sx * x * sc, -(f + df), z) for x, f in zip(FX, FF)] for z, df, sc in FZ]
        if sx < 0:
            grid = [row[::-1] for row in grid]
        flap = plate("flap." + sd, grid, "flap." + sd, 0.012, ("left", "right", "bottom"))
        G["upperLeg." + sd] = [tg, flap]

        # ---- shin into a heavy work boot, blocky foot with a steel toe cap
        kn = JW["kn" + sd]
        SN = [(0.040, 0.080, 0.086, {}), (-0.110, 0.084, 0.090, {0: (0, -0.012)}), (-0.200, 0.078, 0.082, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN],
                                   [hexprof(w, d, p) for z, w, d, p in SN], fwd, REG["shin." + sd], (False, True))
        xf = kn.x + sx * 0.006
        bt, I["boot"] = loft("boot." + sd, [(xf, 0.004, 0.272), (xf, 0.004, 0.070)],
                             [hexprof(0.088, 0.094), hexprof(0.080, 0.088)], fwd, REG["boot"], (False, False))
        a = math.radians(8) * sx
        fd = V((math.sin(a), -math.cos(a), 0))
        h0 = V((xf, 0.085, 0.0))
        FT = [(0.000, 0.054, 0.090), (0.105, 0.066, 0.118), (0.235, 0.068, 0.068)]

        def fprof(w, top):
            return sym([[0, -0.04, 0], [-w, -0.04, 0], [-1.06 * w, -0.018, 0], [-0.72 * w, top - 0.04, 0],
                        [0, top - 0.035, 0]])
        ft, I["foot"] = loft("foot." + sd, [h0 + fd * s + V((0, 0, 0.04)) for s, w, top in FT],
                             [fprof(w, top) for s, w, top in FT], up, REG["foot"], (True, False),
                             apex=(None, h0 + fd * 0.305 + V((0, 0, 0.028))))
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


def apply_pose(objs, pose, body_off=(0, 0, 0)):
    M = fk(pose, body_off)
    for ob in objs:
        ob.matrix_basis = M[ob["joint"]]
    bpy.context.view_layer.update()


def ground(objs, pose):
    """Pose, then drop the body so the lowest vertex stands on the floor."""
    apply_pose(objs, pose)
    zmin = min((o.matrix_world @ v.co).z for o in objs if not o.hide_render for v in o.data.vertices)
    apply_pose(objs, pose, body_off=(0, 0, -zmin))


def vertex_tint(ob, part):
    """Per-corner colour, multiplied into the texture: soot rising from the floor,
    scorched glove fingers, occlusion under the jaw and at the apron hems, a cool
    lean in the dark. Uses the rest pose."""
    me = ob.data
    jw = JW[ob["joint"]]
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    cn = me.corner_normals
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co + jw
            nz = cn[li].vector.z
            f = 0.80 + 0.20 * smooth01((co.z - 0.05) / 0.85)
            f *= 0.93 + 0.07 * (0.5 + 0.5 * nz)
            if part.startswith("lowerArm") and co.z < 0.86:
                f *= 0.86 + 0.14 * smooth01((co.z - 0.72) / 0.14)
            if part == "head" and co.z < 1.560 and nz < 0.3:
                f *= 0.84
            cols[li] = (f ** 1.08, f ** 1.04, f, 1.0)
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    return ca


# ---------------------------------------------------------------- baked light, edge light

def bake_maps(objs):
    """Cycles bakes AO, object-space normals (hard, per facet) and object-space
    positions onto the page. The painted light: a top-front key, sky, a warm bounce
    from below and a faint back rim, occluded (the Ghoul's recipe). Positions let
    parts be painted in 3D (features land on the geometry, whatever the UV stretch)."""
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
    print("[stoker] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
    return light, pos, nrm[..., 2]


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

def paint_face(name, Ph, NZ, seed):
    """Face and head painted in 3D from the baked positions: x across (signed, so
    the burns are asymmetric), z up, F forward of the head's centre line."""
    x = Ph[..., 0]; ax = np.abs(x); Z = Ph[..., 2]; F = HEAD_YC - Ph[..., 1]
    front = F > 0.030
    face_ = F > 0.050                              # features only on the face, never the skull
    axf = np.where(face_, ax, 9.0)
    xf = np.where(face_, x, 9.0)
    phi = np.arctan2(ax, F)                        # 0 front centre .. pi back centre
    r = Reg(name, ["char", "sear", "tooth", "ash", "ember3"], x, 1.8 - Z, None, 0.0024, 0.0024, seed=seed)
    zz = lambda z: 1.8 - z
    E = lambda x0_, z0, rx, rz: np.sqrt(((xf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    Em = lambda x0_, z0, rx, rz: np.sqrt(((axf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    EX, EZ = EYE
    under_cap = Z > 1.703
    r.lit(under_cap, 0.62)
    # the heavy brow ridges catch the bulb over each eye; deep sockets under them
    r.lit(Em(0.046, 1.693, 0.034, 0.0065) < 1, 1.14)
    r.lit((axf < 0.010) & (Z > 1.684) & (Z <= 1.703), 0.85)                  # the notch between the brows
    sock = Em(EX, EZ + 0.003, 0.030, 0.018) + 0.10 * r.nz
    r.lit(soft(sock, 0.5) * np.clip(0.55 + (Z - EZ) / 0.025, 0.45, 1), 0.34)
    r.lit(Em(0.012, EZ + 0.004, 0.009, 0.012) < 1, 0.75)                    # by the bridge
    # two dying coals (the eye quads repeat them, unlit)
    eye = Em(EX, EZ, 0.0120, 0.0062) < 1
    r.hot(eye, 0.22)
    r.hot(Em(EX, EZ, 0.0072, 0.0042) < 1, 0.55)
    r.hot(Em(EX + 0.0015, EZ + 0.0008, 0.0026, 0.0024) < 1, 0.86)
    r.eye = eye
    # a burned-down nose: a lit bridge, seared nostrils and the shadow under it
    r.lit((axf < 0.010) & (Z > 1.628) & (Z < 1.668) & (F > 0.098), 1.15)
    nos = Em(0.0085, 1.6205, 0.0045, 0.0030) < 1
    r.put(nos & (F > 0.094), "sear"); r.lit(nos & (F > 0.094), 0.35)
    r.lit((E(0.0, 1.612, 0.022, 0.0045) < 1) & (F < 0.108), 0.6)
    # hollow cheeks under hard cheekbones
    r.lit(soft(Em(0.070, 1.606, 0.026, 0.016), 0.6), 0.8)
    r.lit(Em(0.072, 1.646, 0.022, 0.0055) < 1, 1.16)
    # a lipless grin: the lips burned back to a black maw, uneven scorched teeth
    # (two gone), thin seared gums, creases dragged back from the corners
    MZ = 1.5905
    wob = 0.0012 * np.sin(x * 260.0) + 0.0008 * r.nz
    maw = (axf < 0.033) & (Z > MZ - 0.0042 + wob) & (Z < MZ + 0.0040)
    r.put(maw, "sear"); r.lit(maw, 0.20)
    pitch = 0.0066
    ph_ = ((x + 0.0011) % pitch) / pitch
    upt = (axf < 0.027) & (Z > MZ + 0.0006) & (Z < MZ + 0.0040) & (ph_ > 0.16)
    upt &= ~((x > 0.010) & (x < 0.017)) & ~((x < -0.017) & (x > -0.024))    # missing teeth
    lot = (axf < 0.019) & (Z < MZ - 0.0012 + wob) & (Z > MZ - 0.0042 + wob) & (ph_ > 0.2)
    teeth = upt | lot
    r.put(teeth, "tooth"); r.lit(teeth, 0.95)
    r.lit(upt & (Z < MZ + 0.0016), 0.62)                                     # tooth tips in shade
    gum = (axf < 0.030) & (Z >= MZ + 0.0040) & (Z < MZ + 0.0062)
    r.put(gum, "sear"); r.lit(gum, 0.75)
    for sg in (1, -1):
        r.line([(sg * 0.033, zz(MZ)), (sg * 0.047, zz(MZ + 0.011))], 0.0020, f=0.55)
    r.lit(np.clip((1.560 - Z) / 0.012, 0, 1) * front, 0.62)                 # under the jaw
    # asymmetric burns: a seared patch on the right cheek, blistered char scales
    sp = E(-0.074, 1.620, 0.011, 0.009) + 0.35 * r.nz
    r.put((sp < 1) & ~maw, "sear"); r.lit((sp < 1), 0.8); r.lit((sp < 1.25) & (sp >= 1), 0.7)
    r.clusters(3, 0.40, f=0.86, where=(r.id == 0), seed=seed + 7)
    r.clusters(4, 0.55, f=1.12, where=(r.id == 0) & front & ~under_cap, seed=seed + 8)
    r.clusters(5, 0.45, f=0.88, where=(phi > 1.2), seed=seed + 11)           # soot on the skull
    sp2 = np.sqrt(((x - 0.090) / 0.009) ** 2 + ((Z - 1.600) / 0.008) ** 2) + 0.35 * r.nz   # behind the left jaw
    r.put((sp2 < 1) & (phi > 1.1) & (phi < 2.2), "sear"); r.lit((sp2 < 1.3) & (phi > 1.1) & (phi < 2.2), 0.62)
    # ash on the planes that face up (brow, cheekbones, the top of the nose)
    r.clusters(2.2, 0.58, mat="ash", where=(NZ > 0.5) & ~eye & ~maw & ~under_cap & (r.id == 0), seed=seed + 9)
    # a few ember cracks across the face (restrained, asymmetric): the left cheekbone to
    # the mouth corner, over the right brow, up the right jaw
    ok = front & ~eye & ~teeth & ~maw & ~gum & ~under_cap
    r.crack_path([(0.080, zz(1.656)), (0.066, zz(1.636)), (0.058, zz(1.618)), (0.046, zz(1.600))], 0.72, seed + 1,
                 where=ok, forks=[(1, math.pi / 2 - 0.9, 2)])
    r.crack_path([(-0.006, zz(1.700)), (-0.030, zz(1.696)), (-0.052, zz(1.699))], 0.55, seed + 2, where=ok)
    r.crack_path([(-0.040, zz(1.563)), (-0.058, zz(1.574)), (-0.072, zz(1.592))], 0.58, seed + 3, where=ok)
    return r


def paint_ear():
    r = grid_reg("ear", ["char", "sear"], 0.02, 0.05, 17)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.92)
    r.lit(ell(U, Vv, 0.42, 0.5, 0.30, 0.34) < 1, 0.7)                        # bowl
    r.put((U > 0.76) & (r.nz > -0.3), "sear")                                # the burnt rim
    r.lit(U > 0.8, 1.12)
    return r


def paint_eyes():
    """The eye-quad patch: a dying coal, dark red at the rim to a hot centre."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    d = ell(U, Vv, 0.5, 0.52, 0.5, 0.5)
    a = np.zeros((h, w, 3)); g = np.zeros((h, w))
    a[:] = C((70, 14, 6)); g[:] = 0.22
    a[d < 0.85] = C((140, 34, 10)); g[d < 0.85] = 0.42
    a[d < 0.55] = C((206, 84, 22)); g[d < 0.55] = 0.62
    hotc = ell(U, Vv, 0.56, 0.44, 0.14, 0.28) < 1
    a[hotc] = C((246, 150, 60)); g[hotc] = 0.84
    return a, GLOW_C[np.clip(np.round(g * 5), 0, 5).astype(int)]


def paint_cap(I, NZ):
    info = I["woolcap"]
    r = loft_reg("cap", info, ["wool", "ash"], 101)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    d = info["d"]
    Lt = Y.max()
    col = np.floor((r.X / tx) + 1000).astype(int)
    cuff = Y < d[1]
    rib = (col // 2) % 2 == 0
    r.lit(cuff & rib, 1.14); r.lit(cuff & ~rib, 0.86)                     # knit ribs on the rolled cuff
    r.lit(cuff & (Y > d[1] - 1.6 * ty), 1.22)                             # the roll catches the bulb
    r.lit(cuff & (Y < 1.2 * ty), 0.72)                                    # the brim edge
    step = (Y >= d[1]) & (Y < d[2] + 0.6 * ty)
    r.lit(step, 0.55)                                                     # tucked crease over the roll
    crown = Y >= d[2]
    for k in range(6):                                                    # gathered folds up to the tufts
        x0 = -P / 2 + P * (k + 0.35) / 6
        r.fold((x0, d[2] + 0.012), (x0 + 0.012, Lt), w=0.6 * tx)
    r.lit(np.clip((Y - (Lt - 0.028)) / 0.028, 0, 1), 0.82)               # gathered top in shade
    r.clusters(4, 0.45, f=0.86, seed=5)                                   # soot
    r.clusters(4, 0.60, f=1.12, where=crown, seed=6)                      # worn wool
    hole = r.blob(P * 0.28, d[3] - 0.012, 0.012, 0.010, None, 0.28, rough=0.4)
    r.lit(border(hole > 0.5), 1.25)
    r.clusters(2.5, 0.52, mat="ash", where=(NZ > 0.55) & ~cuff, seed=7)
    return r


def paint_tuft():
    r = grid_reg("tuft", ["wool"], 0.04, 0.04, 105)
    U, Vv = r.U, r.V
    r.sh = 0.72 + 0.58 * (1 - Vv)                                         # light wool tips, dark roots
    r.lit(np.mod(U * 3, 1) < 0.18, 0.75)                                  # facet seams
    return r


def paint_neck(I, NZ):
    r = loft_reg("neck", I["neck"], ["char", "ember3", "ash"], 13)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.035)) / 0.035, 0, 1), 0.55)             # under the jaw
    for sg in (-1, 1):                                                    # neck cords
        r.line([(sg * 0.036, top - 0.01), (sg * 0.012, 0.04)], 0.005, f=1.16)
    r.crack(0.05, 0.075, math.pi / 2 + 0.3, 3, 1.6 * tx, 0.65, 14)       # the throat smoulders
    r.crack(-P / 4 - 0.01, 0.070, math.pi / 2 - 0.4, 3, 1.6 * tx, 0.55, 15)
    r.clusters(3, 0.45, f=0.84, seed=16)
    return r


def paint_torso(I, P3, NZ):
    r = loft_reg("torso", I["torso"], ["singlet", "char5", "apron3", "ember3", "ash"], 21)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    x3, y3, z3 = P3[..., 0], P3[..., 1], P3[..., 2]
    ax3, fw = np.abs(x3), -y3
    bck = fw < -0.03
    # bare skin: a scooped neckline, the trapezius shelf, deep armholes, the back scoop
    zs = 1.430 + 0.11 * np.clip(ax3 / 0.15, 0, 1.6) ** 2
    zb = 1.480 + 0.07 * np.clip(ax3 / 0.15, 0, 1.6) ** 2
    strap = (ax3 > 0.150) & (ax3 < 0.188) & (z3 > 1.35)
    skin = ((z3 > np.where(fw > 0, zs, zb)) | ((ax3 > 0.190) & (z3 > 1.37))) & ~strap
    # rips in the singlet: charred skin through ragged holes
    tears = np.zeros_like(skin)
    for p, rx, ry, sd in (((0.085, 0.140, 1.300), 0.050, 0.040, 1), ((-0.245, 0.030, 1.235), 0.030, 0.046, 2),
                          ((-0.070, 0.135, 1.120), 0.022, 0.018, 3)):
        X0, Y0 = r.at(P3, p)
        tears |= r.blob(X0, Y0, rx, ry, None, None, rough=0.45) > 0.5
    # apron straps: over the shoulders from the bib's top corners, crossed on the back
    aps = (ax3 > 0.100) & (ax3 < 0.134) & (z3 > 1.432) & (fw > -0.06)
    for sg in (1, -1):
        t = np.clip((1.52 - z3) / 0.46, 0, 1)
        xc = sg * (0.117 - 0.26 * t)
        aps |= bck & (np.abs(x3 - xc) < 0.017) & (z3 < 1.56) & (z3 > 1.02)
    bare = (skin | tears) & ~aps
    r.put(bare, "char5")
    r.put(aps, "apron3")
    sing = ~bare & ~aps
    # singlet: a rolled hem round every opening (lit ridge, shadow on the skin), soot, sweat, scorch
    near = lambda m: np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    r.lit(sing & near(bare), 1.18)
    r.lit(bare & near(sing), 0.62)
    # grime where a stoker gets it: soot settling from the shoulders down, sweat under
    # the arms and down the spine, scorch where sparks landed, oily hand prints at the hips
    r.lit(sing * np.clip((z3 - 1.30) / 0.22, 0, 1), 0.84)
    for sg in (1, -1):
        X0, Y0 = r.at(P3, (sg * 0.25, 0.0, 1.33))
        r.blob(X0, Y0, 0.05, 0.07, None, 0.84, rough=0.4)
        X0, Y0 = r.at(P3, (sg * 0.16, 0.10, 1.12))
        r.blob(X0, Y0, 0.030, 0.034, None, 0.80, rough=0.45)
    X0, Y0 = r.at(P3, (0.0, 0.14, 1.26))
    r.blob(X0, Y0, 0.035, 0.12, None, 0.86, rough=0.35)
    for p, rad in (((0.19, 0.08, 1.40), 0.018), ((-0.08, 0.13, 1.44), 0.014), ((-0.21, -0.02, 1.18), 0.016)):
        X0, Y0 = r.at(P3, p)
        b = r.blob(X0, Y0, rad, rad, None, 0.55, rough=0.5)
        r.lit(border(b > 0.5) & sing, 0.75)
    r.clusters(6, 0.45, f=0.90, where=sing, seed=11)
    for (a0, a1) in (((-0.20, 0.30), (-0.16, 0.42)), ((0.21, 0.28), (0.17, 0.40)), ((P / 2 - 0.08, 0.2), (P / 2 - 0.02, 0.36))):
        r.fold(a0, a1)
    # strap edges: a dark line each side, lit top face
    r.lit(aps & border(aps), 0.66)
    r.lit((np.roll(aps, 1, 1) | np.roll(aps, -1, 1)) & ~aps, 0.62)
    # skin: char mottling, a little ash on the shelf, soot round the neck
    r.clusters(3, 0.40, f=0.86, where=bare, seed=14)
    r.clusters(2.5, 0.62, mat="ash", where=bare & (NZ > 0.65), seed=15)
    r.lit(bare & (z3 > 1.55) & (ax3 < 0.13), 0.85)
    r.lit(z3 < 1.09, 0.72)                                                # inside the belt
    # ember cracks, hand placed (3D points -> region): down the chest off-centre with a
    # fork across the left pec, a short one on the right pec, one smouldering up the
    # throat, across the left shoulder shelf, down the right armhole, in the back rip
    ok = bare
    for pts3, g, seed, forks in (
            ([(-0.034, -0.160, 1.538), (-0.014, -0.162, 1.508), (0.004, -0.162, 1.482), (-0.004, -0.162, 1.452)],
             0.58, 1, []),
            ([(0.020, -0.075, 1.576), (0.030, -0.110, 1.556), (0.046, -0.140, 1.542)], 0.52, 3, []),
            ([(0.200, 0.040, 1.553), (0.236, 0.010, 1.546), (0.270, -0.020, 1.536)], 0.54, 4, []),
            ([(-0.284, 0.030, 1.470), (-0.286, 0.000, 1.430), (-0.280, -0.030, 1.400)], 0.48, 5, []),
            ([(0.060, 0.140, 1.320), (0.090, 0.140, 1.300), (0.105, 0.139, 1.285)], 0.55, 6, [])):
        pts = [r.at(P3, p) for p in pts3]
        r.crack_path(pts, g, seed + 20, base="char5", where=ok, forks=forks, halo=0.15)
    return r


def paint_plate(name, sx, sy, seed, rivets=(), burns=(), seam=False, pocket=None, patch=None, fray=False):
    """A heavy leather plate (bib, apron, flaps): a dark raw cut edge (the thickness
    band samples it), saddle stitching, wear and scorch in clusters, iron rivets."""
    mats = ["apron", "steel"] + (["leather"] if patch or pocket else [])
    r = grid_reg(name, mats, sx, sy, seed)
    U, Vv, col, row = r.U, r.V, r.col, r.row
    x0, y0, w, h = REG[name]
    rim = (col == 0) | (col == w - 1) | (row == 0) | (row == h - 1)
    r.lit(rim, 0.58)
    ins = (col >= 2) & (col <= w - 3) & (row >= 2) & (row <= h - 3)
    st = ins & ((col == 2) | (col == w - 3) | (row == 2) | (row == h - 3))
    r.lit(st & ((col + row) % 3 != 0), 0.72)
    r.lit(st & ((col + row) % 3 == 0), 1.12)
    r.clusters(4, 0.50, f=1.12, where=~rim, seed=seed + 1)                  # scuffed where it rubs
    r.lit(np.clip((Vv - 0.45) / 0.55, 0, 1) * ~rim, 0.82)                   # soot darkens toward the hem
    r.clusters(5, 0.52, f=0.76, where=(Vv > 0.45) & ~rim, seed=seed + 3)     # scorch
    for (u, v, rad) in burns:                                                 # spark burns
        b = r.blob(u * sx, v * sy, rad, rad * 0.85, None, 0.40, rough=0.35)
        r.lit(border(b > 0.5), 0.7)
    if seam:
        cx = 0.5 * sx
        r.line([(cx, 0), (cx, sy)], 0.6 * r.tx, f=0.55)
        r.line([(cx + 1.4 * r.tx, 0), (cx + 1.4 * r.tx, sy)], 0.5 * r.tx, f=1.15)
    if pocket:
        u0, v0, u1, v1 = pocket
        pk = (U > u0) & (U < u1) & (Vv > v0) & (Vv < v1)
        r.put(pk, "leather"); r.lit(pk, 1.0)
        r.lit(border(pk), 0.62)
        fl = pk & (Vv < v0 + 0.3 * (v1 - v0))
        r.lit(fl, 1.12); r.lit(pk & (np.abs(Vv - (v0 + 0.3 * (v1 - v0))) < 0.8 / h), 0.5)
        r.rivet(0.5 * (u0 + u1) * sx, (v0 + 0.22 * (v1 - v0)) * sy)
    if patch:
        u0, v0, u1, v1 = patch
        pk = (U > u0) & (U < u1) & (Vv > v0) & (Vv < v1)
        r.put(pk, "leather"); r.lit(pk, 1.08)
        r.lit(border(pk) & ((col + row) % 2 == 0), 0.6)
    if fray:
        r.lit((row >= h - 3) & (r.nz > 0.1), 0.7)
    for (u, v) in rivets:
        r.rivet(u * sx, v * sy)
    return r


def paint_pelvis(I):
    info = I["pelvis"]
    r = loft_reg("pelvis", info, ["trousers", "leather", "steel"], 31)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    ax = np.abs(X)
    BH = info["d"][1]
    belt = Y < BH + 0.3 * ty
    r.put(belt, "leather")
    r.lit(belt & (Y < 1.1 * ty), 1.3)
    r.lit(belt & (Y > BH - 1.1 * ty), 0.62)
    r.lit((Y >= BH) & (Y < BH + 1.5 * ty), 0.5)                           # belt shadow
    bk = (ax < 0.036) & (Y > 0.008) & (Y < BH - 0.006)                     # a big iron buckle
    inner = (ax < 0.022) & (Y > 0.018) & (Y < BH - 0.016)
    r.put(bk & ~inner, "steel"); r.lit(bk & ~inner, 1.08); r.lit(inner, 0.5)
    r.put((ax < 0.6 * tx) & inner, "steel")
    r.lit(bk & ~inner & (Y > BH - 0.012), 0.7)
    for k in range(10):                                                   # rivets round the belt
        x_ = -P / 2 + P * (k + 0.5) / 10
        if abs(x_) > 0.06:
            r.rivet(x_, BH * 0.5)
    for sg in (-1, 1):                                                    # seat folds, soot
        r.fold((P / 2 + sg * 0.05, BH + 0.02), (P / 2 + sg * 0.10, Y.max()), off=(sg * 1.2 * tx, 0))
    r.clusters(6, 0.45, f=0.88, where=~belt, seed=3)
    r.clusters(3, 0.55, f=1.12, where=belt, seed=4)
    return r


def paint_chain():
    info_w, info_h = REG["chain"][2], REG["chain"][3]
    r = grid_reg("chain", ["steel"], 0.05, 0.25, 111)
    U, Vv, row = r.U, r.V, r.row
    r.lit(np.ones_like(U), 1.0)
    link = (row // 2) % 2 == 0
    r.lit(link & (U < 0.4), 1.35); r.lit(~link, 0.62)                      # alternating links
    r.lit((row % 2 == 0) & ~link, 0.45)
    return r


def paint_rag():
    r = grid_reg("rag", ["rag"], 0.09, 0.22, 107)
    U, Vv, col, row = r.U, r.V, r.col, r.row
    chk = ((col // 4) % 2 == 0) ^ ((row // 5) % 2 == 0)
    r.lit(chk, 0.80)                                                      # a faded check
    r.fold((0.03, 0.0), (0.05, 0.22), w=0.7 * r.tx)
    r.fold((0.06, 0.05), (0.07, 0.20), w=0.6 * r.tx)
    r.lit(Vv < 0.12, 0.6)                                                 # under the belt
    r.clusters(3, 0.35, f=0.62, seed=4)                                   # oil and soot
    r.lit((Vv > 0.9) & (r.nz > 0.0), 0.7)                                 # frayed end
    return r


def paint_uarm(I, sd, NZ):
    L = sd == "L"
    so = 1 if L else -1
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["char", "ember3", "ash", "sear"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = so * P / 4
    r.lit(np.abs(r.dx(-outer)) < P / 8, 0.85)                             # the inner side, against the chest
    for k in range(3):                                                    # inner elbow creases
        r.line([(-outer * 0.5 + P / 2 - 0.04 + k * 0.025, Lt - 0.05), (-outer * 0.5 + P / 2 - 0.03 + k * 0.025, Lt - 0.02)],
               0.6 * tx, f=0.7)
    sp = r.blob(outer * 0.6, Lt - 0.07, 0.022, 0.018, None, None, rough=0.4)   # a seared patch by the elbow
    r.put(sp > 0.5, "sear"); r.lit(border(sp > 0.5), 0.7)
    r.clusters(3, 0.40, f=0.86, seed=16 if L else 17)
    r.clusters(4, 0.58, f=1.10, seed=18 if L else 19)
    r.lit(np.clip(1 - Y / 0.06, 0, 1), 0.86)                             # the deltoid cap faces back in the game's poses
    ok = r.id != r.m("sear")
    # the limb's front faces up when the arms reach forward: the cracks live there and outside
    r.crack_path([(so * 0.030, 0.085), (so * 0.052, 0.125), (so * 0.036, 0.165), (so * 0.058, 0.205)], 0.60,
                 31 if L else 41, where=ok, halo=0.16)
    r.crack_path([(outer + so * 0.015, 0.115), (outer - so * 0.005, 0.150), (outer + so * 0.010, 0.180)], 0.50,
                 32 if L else 42, where=ok, halo=0.16)
    r.crack_path([(-so * 0.040, 0.235), (-so * 0.028, 0.270)], 0.48, 33 if L else 43, where=ok)
    return r


def paint_farm(I, sd, NZ):
    L = sd == "L"
    so = 1 if L else -1
    info = I["farm." + sd]
    r = loft_reg("farm." + sd, info, ["char5", "glove", "ember3", "steel", "ash"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    d = info["d"]
    Lt = Y.max()
    outer = so * P / 4
    glove = Y > d[2] - 0.2 * ty
    skin = ~glove
    r.put(glove, "glove")
    # bare forearm: elbow point, char, cracks along the muscle
    r.lit(skin & (np.abs(r.dx(P / 2)) < 0.03) & (Y < d[1] + 0.02), 1.15)
    r.lit(skin & (Y > d[2] - 0.022), 0.72)                                 # shade under the cuff flare
    r.clusters(3, 0.42, f=0.86, where=skin, seed=21)
    r.clusters(2.5, 0.62, mat="ash", where=skin & (NZ > 0.55), seed=22)
    # the forearms smoulder most: a long crack down the top (front) of the forearm, one
    # round the outside, a short one underneath
    r.crack_path([(so * 0.012, 0.052), (so * 0.030, 0.088), (so * 0.010, 0.124), (so * 0.026, 0.168)], 0.76,
                 51 if L else 61, where=skin, forks=[(1, math.pi / 2 - so * 0.9, 2), (2, math.pi / 2 + so * 1.0, 2)])
    r.crack_path([(outer * 0.92, 0.070), (outer * 0.98 + so * 0.012, 0.112), (outer * 0.86, 0.152)], 0.66,
                 52 if L else 62, where=skin)
    r.crack_path([(P / 2 - so * 0.020, 0.100), (P / 2 - so * 0.032, 0.140)], 0.50, 53 if L else 63, where=skin)
    # the gauntlet: a lit flare rim, a ring of rivets, a stitched seam, a wrist strap, scorch
    top = glove & (Y <= d[3] + 0.5 * ty)
    r.lit(top, 1.25)
    r.lit(glove & (Y > d[3] + 0.5 * ty) & (Y < d[3] + 1.8 * ty), 1.12)
    for k in range(8):
        r.rivet(-P / 2 + P * (k + 0.5) / 8, d[3] + 0.016)
    r.line([(-outer, d[3] + 0.03), (-outer, Lt)], 0.5 * tx, f=0.62)        # inner seam
    r.line([(-outer + 1.2 * tx, d[3] + 0.03), (-outer + 1.2 * tx, Lt)], 0.4 * tx, f=1.12)
    ws = glove & (Y > Lt - 0.040) & (Y < Lt - 0.022)                       # wrist strap
    r.lit(ws, 0.7); r.lit(glove & (np.abs(Y - (Lt - 0.040)) < 0.6 * ty), 0.55)
    r.rivet(outer, Lt - 0.031, 1.3)
    r.clusters(3, 0.45, f=1.16, where=glove & ~top, seed=24)
    r.clusters(4, 0.40, f=0.72, where=glove & (Y > d[3] + 0.04), seed=25)
    return r


def paint_palm(I):
    r = loft_reg("palm", I["palm"], ["glove", "steel"], 91)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.abs(r.B) < P / 5, 0.78)                                       # palm side
    r.lit((np.abs(X) < P / 5) & (Y > Lt - 0.012), 1.25)                    # hard knuckles
    band = (np.abs(X) < P / 4) & (np.abs(Y - 0.050) < 0.010)               # riveted strap over the back
    r.lit(band, 0.72); r.lit(band & (np.abs(Y - 0.041) < 0.5 * ty), 1.2)
    for k in (-1, 0, 1):
        r.rivet(k * 0.022, 0.050)
    r.clusters(3, 0.45, f=0.84, seed=4)
    r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.7)                                # into the cuff
    return r


def paint_finger(I):
    r = loft_reg("fing", I["fing"], ["glove", "steel"], 92)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    back = np.abs(X) < P / 4
    r.lit(~back, 0.8)
    for xk in (-0.030, 0.0, 0.030):                                         # three splits: four fat fingers
        r.lit(np.abs(X - xk) < 0.55 * tx, 0.55)
        r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.6)
    r.lit(back & (np.abs(Y - Lt * 0.5) < 0.005), 0.68)
    r.lit(back & (np.abs(Y - Lt * 0.5 + 0.006) < 0.003), 1.2)
    for xk in (-0.045, -0.015, 0.015, 0.045):                               # a rivet on each knuckle
        r.rivet(xk, 0.010, 0.9)
    r.lit(np.clip((Y - (Lt - 0.03)) / 0.03, 0, 1), 0.75)                   # scorched tips
    return r


def paint_thumb(I):
    r = loft_reg("thumb", I["thumb"], ["glove"], 95)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    Lt = Y.max()
    r.lit(U > 0.75, 0.8)
    r.lit(np.abs(Y - Lt * 0.5) < 0.004, 0.7)
    r.lit(np.clip((Y - (Lt - 0.025)) / 0.025, 0, 1), 0.75)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["trousers", "leather", "steel"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    so = 1 if L else -1
    r.fold((outer, 0.0), (outer + so * 0.004, Lt), off=(-so * 1.2 * tx, 0))
    for (y0_, y1_, dx0, dx1) in ((0.06, 0.28, P / 2 - 0.04, P / 2 + 0.02), (0.20, 0.42, P / 2 + 0.03, P / 2 - 0.02)):
        r.fold((dx0, y0_), (dx1, y1_))
    for yk in (Lt - 0.07, Lt - 0.04):                                      # knee creases at the back
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    # the flap's leg strap round the back of the thigh, buckled at the outside
    st = (np.abs(Y - 0.215) < 0.016) & (np.abs(r.dx(P / 2)) < P * 0.36)
    r.put(st, "leather"); r.lit(st & (np.abs(Y - 0.200) < 0.6 * ty), 1.2); r.lit(border(st), 0.62)
    r.rivet(outer + so * 0.02, 0.215, 1.4)
    r.clusters(6, 0.45, f=0.88, seed=9 if L else 10)
    r.clusters(5, 0.60, f=1.08, where=r.id == 0, seed=11)
    r.lit(np.clip(Y / Lt, 0, 1), 0.9)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    r = loft_reg("shin." + sd, I["shin." + sd], ["trousers"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.full(X.shape, 1.0), 0.88)
    b0 = Lt * 0.55
    bl = np.clip((Y - b0) / (Lt - b0), 0, 1)
    ph = 2 * np.pi * X / 0.05 + 1.1 * np.sin(X * 31.0 + (3 if L else 1))
    r.lit(bl * np.clip(np.sin(ph), 0, 1), 1.25)                            # bunched into the boots
    r.lit(bl * np.clip(-np.sin(ph), 0, 1), 0.70)
    r.lit(Y >= Lt - 0.02, 0.6)
    for (p0, p1) in (((-0.02, 0.02), (0.01, 0.12)), ((0.04, 0.05), (0.02, 0.15)), ((P / 2 - 0.02, 0.0), (P / 2, 0.1))):
        r.fold(p0, p1)
    r.clusters(6, 0.40, f=0.86, seed=13 if L else 14)
    r.lit(np.clip((Y - Lt * 0.5) / (Lt * 0.5), 0, 1), 0.85)                  # soot and ash kicked up
    return r


def paint_boot(I):
    r = loft_reg("boot", I["boot"], ["leather", "steel", "trousers"], 61)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.9)
    r.lit(Y < 1.4 * ty, 1.25)                                               # the thick top edge
    r.lit((Y >= 1.4 * ty) & (Y < 2.6 * ty), 0.6)
    for k in range(-3, 4):
        r.fold((k * 0.05 + 0.012, 0.03), (k * 0.05 + 0.02, 0.10), off=(1.2 * tx, 0))
    r.lit(ax < 0.018, 0.78)
    for yk in np.arange(0.03, Lt, 0.03):                                     # lace hooks
        r.rivet(-0.016, yk, 0.9); r.rivet(0.016, yk, 0.9)
        r.line([(-0.014, yk), (0.014, yk + 0.012)], 0.5 * tx, "trousers", 0.8)
    r.clusters(3, 0.45, f=0.75, where=Y > Lt - 0.06, seed=14)
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["leather", "steel"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][1]
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 0.9)
    r.lit(sole, 0.4)
    r.lit(welt, 1.22)
    Lt = info["d"][-1]
    toe = (Y > Lt - 0.085) & ~sole & ~welt                                   # the steel toe cap
    r.put(toe, "steel"); r.lit(toe, 1.0)
    r.lit(toe & (np.abs(Y - (Lt - 0.085)) < 1.2 * ty), 0.55)
    r.lit((Y < 0.03) & ~sole, 0.85)
    r.clusters(3, 0.45, f=0.75, where=~sole & ~toe, seed=15)
    r.clusters(2, 0.55, f=1.2, where=toe, seed=16)
    return r


def paint_page(I, light, pos, nz):
    def preg(name, joint):
        x0, y0, w, h = REG[name]
        return pos[y0:y0 + h, x0:x0 + w] + np.array(JW[joint])

    def nreg(name):
        x0, y0, w, h = REG[name]
        return nz[y0:y0 + h, x0:x0 + w]
    face = paint_face("head", preg("head", "neck"), nreg("head"), 11)
    regs = [face, paint_face("nose", preg("nose", "neck"), nreg("nose"), 12), paint_ear(),
            paint_cap(I, nreg("cap")), paint_tuft(), paint_neck(I, nreg("neck")),
            paint_torso(I, preg("torso", "spine"), nreg("torso")),
            paint_plate("bib", 0.33, 0.40, 201, rivets=[(0.10, 0.07), (0.90, 0.07)],
                        burns=[(0.30, 0.78, 0.012), (0.66, 0.60, 0.008)], pocket=(0.56, 0.20, 0.82, 0.44)),
            paint_plate("apron", 0.43, 0.29, 211, rivets=[(0.08, 0.08), (0.92, 0.08)], seam=True,
                        burns=[(0.28, 0.55, 0.014), (0.75, 0.35, 0.010)]),
            paint_plate("flap.L", 0.21, 0.44, 221, rivets=[(0.20, 0.06), (0.80, 0.06)], patch=(0.22, 0.48, 0.66, 0.70),
                        burns=[(0.70, 0.84, 0.010)], fray=True),
            paint_plate("flap.R", 0.21, 0.44, 231, rivets=[(0.20, 0.06), (0.80, 0.06)],
                        burns=[(0.30, 0.40, 0.012), (0.55, 0.78, 0.008)], fray=True),
            paint_pelvis(I), paint_chain(), paint_rag(), paint_boot(I), paint_foot(I),
            paint_palm(I), paint_finger(I), paint_thumb(I)]
    for sd in "LR":
        regs += [paint_uarm(I, sd, nreg("uarm." + sd)), paint_farm(I, sd, nreg("farm." + sd)),
                 paint_thigh(I, sd), paint_shin(I, sd)]
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 18, 20))
    glow = np.zeros((AT, AT, 3))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.45, 0.45, wrap=r.P is not None)
        lt = lt * EDGE[y0:y0 + h, x0:x0 + w]
        if r.name == "tuft":
            lt = np.ones_like(lt)
        col, gl = r.finish(lt)
        page[y0:y0 + h, x0:x0 + w] = col
        glow[y0:y0 + h, x0:x0 + w] = gl
    x0, y0, w, h = REG["eyes"]
    page[y0:y0 + h, x0:x0 + w], glow[y0:y0 + h, x0:x0 + w] = paint_eyes()
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
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
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
    ng = bpy.data.node_groups.get("STK_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("STK_Fog", "ShaderNodeTree")
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


def ps1_mat(name, img, mapping=None, vcol=True, tex_scale=1.0, unlit=False, glow=None):
    """Texture (nearest) x vertex colour, lit by a sun (split normals: hard facets)
    plus flat ambient (or unlit), the glow page added as emission, mixed to the fog
    colour by camera distance. mapping = 'floor' / 'wall' projects by world position."""
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


# ---------------------------------------------------------------- game export

def r4(x):
    v = round(float(x), 4)
    return 0.0 if v == 0 else v


def export_game(objs, page, glow):
    """public/models/stoker.json (+ .png, _glow.png): the rest-pose parts in joint-local
    three.js space, per-corner split normals, v flipped for a top-left origin."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    joints = {n: {"parent": p, "pos": [r4(x) for x in pos]} for n, p, pos in JOINTS}
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
                p3 = tuple(r4(x) for x in b2t(co))
                n3 = tuple(r4(x) for x in b2t(n))
                uv = uvd[li].uv
                u2 = (r4(uv.x), r4(1 - uv.y))
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
    head_ob = next(o for o in objs if o.name == "head")
    zs = [(v.co + JW["neck"]).z for v in head_ob.data.vertices]
    data = {"version": 1, "texture": GAME_ID + ".png", "emissive": GAME_ID + "_glow.png", "joints": joints,
            "parts": parts,
            "meta": {"id": GAME_ID, "name": "The Stoker", "style": STYLE, "generator": "art/zombies/z_stoker.py",
                     "units": "m", "up": "+Y", "facing": "+Z", "left": "+X", "pose": "rest",
                     "tris": tris, "tris_body": body, "unlit": ["eyes"],
                     "glow": {"page": GAME_ID + "_glow.png", "emissiveIntensity": GLOW_GAME,
                              "parts": ["head", "torso", "upperArm.L", "upperArm.R", "lowerArm.L", "lowerArm.R", "eyes"]},
                     "hideWithHead": ["woolcap"],
                     "headCentre": round((min(zs) + max(zs)) / 2, 3),
                     "note": "brute: tint instances 0.8-1.1 (head: skin tint); draw eyes unlit; "
                             "glow page as emissiveMap (emissive white) on the lit parts; hide woolcap with the head"}}
    jp = os.path.join(EXPORT_DIR, GAME_ID + ".json")
    with open(jp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    save_png(os.path.join(EXPORT_DIR, GAME_ID + ".png"), page)
    save_png(os.path.join(EXPORT_DIR, GAME_ID + "_glow.png"), glow)
    print(f"[stoker] export -> {jp} ({os.path.getsize(jp) / 1024:.1f} KB) tris {tris} total {sum(tris.values())} "
          f"head centre {data['meta']['headCentre']}")


# ---------------------------------------------------------------- build

PARTS_OBJ = []


def build():
    root = kit.empty("ZOMBIE_stoker")
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
    # bake in a game-like pose (arms forward, no arm/torso contact)
    apply_pose(objs, BAKE_POSE)
    body["eyes"].hide_render = True
    bake = [o for o in objs if o.name != "eyes"]
    light, pos, nz = bake_maps(bake)
    body["eyes"].hide_render = False
    EDGE[:] = edge_light(bake)
    page, glow = paint_page(I, light, pos, nz)
    img = make_image("stk_page", page, "texture_page.png")
    gimg = make_image("stk_glow", glow, "glow_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    export_game(objs, page, glow)
    mat = ps1_mat("STK_Body", img, glow=gimg)
    emat = ps1_mat("STK_Eyes", img, vcol=False, unlit=True, glow=gimg)
    for ob in objs:
        kit.assign(ob, emat if ob.name == "eyes" else mat)
    ground(objs, STANCE)
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
    cm = bpy.data.materials.new("STK_FogCard")
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
            near, far = (dist - near_f, dist + far_f) if m.name.startswith("STK_Env") else (dist - near_c, dist + far_c)
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
    return r.finish(np.ones((h, w)))[0]


def paint_wall():
    h = w = 64
    Xg, Yg = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    r = Reg("wall", ["concrete"], Xg, Yg, 1.0, 1 / w, 1 / h, 121)
    for yk in (0.0, 0.5):                                         # poured-concrete form lines
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
    fimg = make_image("stk_floor", paint_floor())
    kit.assign(floor, ps1_mat("STK_EnvFloor", fimg, "floor", vcol=False, tex_scale=1.2))
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

def shot(root, name, yaw, pose, margin=1.07):
    """A native 300x400 still of the model in a pose, framed like the heroes."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, pose)
    root.rotation_euler.z = math.radians(yaw)
    bpy.context.view_layer.update()
    cam = sc.camera
    cam.data.lens = 50
    kit.frame_to(cam, root, margin=margin, aim_frac=0.5, elev=0.10)
    set_fog(cam.location.length)
    p = os.path.join(OUT, name + ".png")
    render_native(p)
    post(p)
    print(f"[stoker] {name} ->", p)


def face_shot(root):
    """Head close-up at native resolution."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, STANCE)
    root.rotation_euler.z = math.radians(-22)
    bpy.context.view_layer.update()
    head = bpy.data.objects["head"]
    hc = head.matrix_world @ V((0, -0.03, 0.10))
    cam = sc.camera
    cam.data.lens = 50
    cam.location = hc + V((0.0, -1.0, 0.05))
    kit._aim(cam, hc + V((0, 0, -0.02)))
    set_fog(1.0, near_c=0.3, far_c=6.0)
    p = os.path.join(OUT, "face.png")
    render_native(p)
    post(p)
    print("[stoker] face ->", p)


def ingame(root):
    """The stoker at fighting distance: 320x240, ~6 m, walking in, dark bunker fog."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    ground(PARTS_OBJ, walk_pose(2.1))
    root.rotation_euler.z = math.radians(-14)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.7, -6.3, 1.62)
    kit._aim(cam, (0.15, 0, 1.05))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = fog_group()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = lin((5, 8, 7)); mix.inputs[7].default_value = lin((26, 36, 30))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    wimg = make_image("stk_wall", paint_wall())
    wmat = ps1_mat("STK_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("STK_EnvHole", make_image("stk_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-2.3, 2.58, 1.0), (-0.9, 2.58, 1.0), (-0.9, 2.58, 2.05), (-2.3, 2.58, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("stk_wood", paint_wood())
    wm = ps1_mat("STK_EnvWoodM", wood, None, vcol=False)
    for k, (zc, ang) in enumerate(((1.22, 4), (1.53, -3), (1.84, 5))):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                lp[uvl].uv = uv
        pl = kit.mesh_obj(f"Plank{k}", bm, None, smooth=False)
        pl.scale = (1.62, 0.03, 0.17)
        pl.location = (-1.6, 2.53, zc)
        pl.rotation_euler = (0, math.radians(ang), 0)
        kit.assign(pl, wm)
    chalk = ps1_mat("STK_EnvChalk", make_image("stk_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                      [C((126, 38, 32)), C((160, 52, 42))]])), None, vcol=False)
    strokes = [((1.10 + 0.11 * k, 1.42), (1.12 + 0.11 * k, 1.90)) for k in range(4)] + [((1.02, 1.50), (1.54, 1.80))]
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
            k_ = 0.55 if m.name.startswith("STK_Env") else 0.85
            a.inputs[7].default_value = (AMB * k_, AMB * k_, AMB * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    render_native(p)
    post(p)
    print("[stoker] ingame ->", p)


kit.run(STYLE, build, stage, post,
        meta={"technique": "rigid faceted prisms and leather plates (hard normals > 30 deg) in the game rig's rest pose, "
                           "posed by FK; 256px page, <= 16-colour CLUT per part, painted light x Cycles-baked AO/facet "
                           "light, edge highlights; ember cracks + coal eyes on a glow page; native 300x400 + composite/CRT post",
              "texture_page": "256x256", "segments": len(PARTS), "game_model": "public/models/stoker.json"})
_root = bpy.data.objects["ZOMBIE_stoker"]
if "--final" in ARGS or "--walk" in ARGS:
    shot(_root, "walk", -35, walk_pose(2.1))
    shot(_root, "walk_side", -90, walk_pose(2.1))
if "--final" in ARGS or "--rest" in ARGS:
    shot(_root, "rest_front", 0, {})
    shot(_root, "rest_side", -90, {})
if "--final" in ARGS or "--face" in ARGS:
    face_shot(_root)
if "--final" in ARGS or "--ingame" in ARGS:
    ingame(_root)
