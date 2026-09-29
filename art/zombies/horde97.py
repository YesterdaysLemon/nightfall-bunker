# horde97: the shared toolkit for the horde zombies built after The Mended (the usher, the
# projectionist, ...). It carries everything that is the same for every 1997-look humanoid
# of the disc (art/STYLE.md), copied from z_mended.py (the reference) and made configurable,
# so a character script holds only its own design:
#
#   * the numpy painter `Reg` (material ids + painted light, quantised to per-region CLUTs),
#     `loft` / `poly_obj` geometry with hard normals, the game rig, FK poses;
#   * the Cycles bake of AO / facet normals / positions, the painted light, edge highlights;
#   * the game export (public/models/<id>.json + .png + _glow.png, art/STYLE.md format);
#   * the low-res TV-pass renders: 3/4, front, side, back, walk pose, face, in-game shot.
#
# A character script does:  import horde97 as H ; H.setup(...) ; define build_rest() (every
# part in the rest pose, world coordinates, Blender space) and paint_page() (its texture
# regions) ; H.main().   Flags:  --preview [--views a,b] | --export | --final ; --walk --face
# --ingame.  Every render run exports the game files too.
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree

STYLE = None                                # set by setup()
OUT = None
GAME_ID = None
DBG = None
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
EXPORT_DIR = os.path.join(kit.ROOT, "public", "models")
AT = 256                                    # texture page
UP = 3                                      # native render pixel -> output pixels
NATIVE = (300, 400)
SUN, SUN_COL, AMB, BACK = 0.95, (1.0, 0.93, 0.80), 0.64, 0.45
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)
SHARP_DEG = 30.0                            # split normals above this dihedral angle
EDGE_HI, EDGE_LO = 0.30, 0.80               # painted ridge highlight / crease darkening
KEY = V((0.0, -0.42, 0.91)).normalized()    # painted key: a bulb above, slightly in front
GLOW_PREVIEW = 0.32                         # emission strength of the glow page in the renders
TAU = 2 * math.pi
CFG = {}
REG = {}                                    # texture page layout: name -> (x0, y0, w, h), top-left origin

# ---------------------------------------------------------------- CLUT ramps (sRGB, dark -> light, lit base)
# The world palette (z_ps1b / z_ps1c RAMPS) plus the materials the horde shares; a character
# script adds its own with add_ramps(): same value range, cool shadows, warm highlights.
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
    "gold": ([(100, 70, 28), (182, 140, 62), (240, 208, 130)], 1),
    "wsteel": ([(40, 40, 42), (76, 76, 74), (116, 114, 106), (160, 156, 142)], 2),
    "hollow": ([(16, 13, 14), (38, 32, 30), (62, 54, 46)], 1),
    "brass": ([(46, 36, 22), (84, 66, 36), (124, 100, 56), (164, 136, 80)], 2),
    "lens": ([(8, 12, 12), (20, 28, 26), (44, 58, 52), (104, 124, 112)], 1),
    "grease": ([(20, 18, 16), (40, 36, 30)], 1),
}
RAMP_GAIN = {}          # pale materials: light 1.0 maps above the base entry, so they stay pale under shade
RAMP_C, RAMP_LL = {}, {}


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def rebuild_ramps():
    for k, v in RAMPS.items():
        RAMP_C[k] = np.array(v[0], float) / 255.0
        RAMP_LL[k] = np.log(np.array([_luma(c) for c in v[0]]) / (_luma(v[0][v[1]]) * RAMP_GAIN.get(k, 1.0)))


def add_ramps(ramps, gain=None):
    RAMPS.update(ramps)
    RAMP_GAIN.update(gain or {})
    rebuild_ramps()


rebuild_ramps()

# ---------------------------------------------------------------- the game rig
# three.js space (+Y up, facing +Z, character's left = +X), pos relative to the parent.
# The same names and hierarchy as every zombie; the proportions may differ per character.
JOINTS_STD = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.95, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.55, 0.02)), ("shL", "spine", (0.28, 0.49, 0.0)), ("shR", "spine", (-0.28, 0.49, 0.0)),
    ("elL", "shL", (0.0, -0.33, 0.0)), ("elR", "shR", (0.0, -0.33, 0.0)),
    ("hipL", "hips", (0.1, -0.04, 0.0)), ("hipR", "hips", (-0.1, -0.04, 0.0)),
    ("knL", "hipL", (0.0, -0.46, 0.0)), ("knR", "hipR", (0.0, -0.46, 0.0)),
]
JOINTS = list(JOINTS_STD)
PARTS = []
HEAD_PARTS = []
C3 = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))      # Blender (Z up, -Y front) -> three.js
JW = {}


def b2t(v):
    return (v[0], v[2], -v[1])


def t2b(v):
    return V((v[0], -v[2], v[1]))


def set_rig(joints):
    """Use these joints (three.js space, parent-relative) and refresh the rest-pose world table JW."""
    JOINTS[:] = list(joints)
    JW.clear()
    for n, p, pos in JOINTS:
        JW[n] = (JW[p] if p else V((0, 0, 0))) + t2b(pos)


set_rig(JOINTS_STD)


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


def set_regions(regs):
    REG.clear()
    REG.update(regs)
    occ = np.zeros((AT, AT), int)
    for n, (x, y, w, h) in REG.items():
        assert x >= 0 and y >= 0 and x + w <= AT and y + h <= AT, f"region {n} is off the page"
        occ[y:y + h, x:x + w] += 1
    if occ.max() != 1:
        bad = [n for n, (x, y, w, h) in REG.items() if occ[y:y + h, x:x + w].max() > 1]
        raise AssertionError("texture regions overlap: " + ", ".join(bad))
    print(f"[{STYLE}] page {100.0 * (occ > 0).mean():.0f} % used")


def setup(style, name, script, regs, parts, build_rest, paint_page, head_parts, headwear=(), unlit=("eyes",),
          joints=None, glow=None, note="", hat_parts=(), jaw_z=1.57, face_cam=(0.0, 0.13), meta=None,
          ramps=None, gain=None, tint=None):
    """Configure a character: its id, page layout, part list [(name, joint)], the two design
    callbacks, what goes with the head on a headshot, and the meta the game reads."""
    global STYLE, GAME_ID, OUT, DBG
    STYLE = GAME_ID = style
    OUT = os.path.join(kit.OUT_BASE, style)
    DBG = os.path.join(OUT, "_d") if os.environ.get(style.upper() + "_DEBUG") else None
    if ramps:
        add_ramps(ramps, gain)
    if joints:
        set_rig(joints)
    set_regions(regs)
    PARTS[:] = parts
    HEAD_PARTS[:] = head_parts
    CFG.update(name=name, script=script, build_rest=build_rest, paint_page=paint_page, headwear=list(headwear),
               unlit=list(unlit), glow=glow, note=note, hat_parts=tuple(hat_parts), jaw_z=jaw_z, face_cam=face_cam,
               meta=meta or {}, tint=tint)


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
            print(f"[{STYLE}] WARNING region {s.name} uses {n} colours")
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


# ---------------------------------------------------------------- geometry: shared body pieces

def head_warp(u):
    """Front-weighted wrap: the front half of the head gets ~68 % of the columns."""
    if u < 0.25:
        return u * 0.64
    if u > 0.75:
        return 0.84 + (u - 0.75) * 0.64
    return 0.16 + (u - 0.25) * 1.36


# The Mended's head, the starting point of every skull: (z, y offset, half-width, back, front, pushes)
HEAD_RINGS = [
    (1.778, 0.004, 0.082, 0.090, 0.082, {}),
    (1.738, 0.000, 0.097, 0.104, 0.102, {}),
    (1.710, 0.000, 0.099, 0.104, 0.104, {4: (0.002, 0.010), 5: (0.004, 0.016), 6: (0, 0.010)}),
    (1.690, 0.000, 0.096, 0.102, 0.098, {4: (0, -0.006), 5: (-0.004, -0.022), 6: (0, -0.004)}),
    (1.650, 0.000, 0.097, 0.098, 0.100, {4: (0.014, 0.014), 5: (0.0, -0.004)}),
    (1.606, 0.000, 0.080, 0.088, 0.096, {3: (0, 0, 0.004), 4: (-0.012, -0.012), 5: (-0.006, -0.008), 6: (0, -0.002)}),
    (1.576, 0.000, 0.070, 0.078, 0.094, {0: (0, 0, 0.018), 1: (0, 0, 0.018), 2: (0, 0, 0.012), 3: (0, 0, 0.006),
                                         4: (-0.008, -0.010), 5: (-0.006, -0.002), 6: (0, 0.006)}),
    (1.548, 0.000, 0.044, 0.056, 0.086, {0: (0, 0, 0.030), 1: (0, 0, 0.030), 2: (0, 0, 0.022), 3: (0, 0, 0.012),
                                         4: (-0.010, -0.008), 5: (-0.010, 0.006), 6: (0, 0.012)}),
]


def make_head(rings=None, rows=(4, 12, 24, 36, 53, 69, 81, 90), yc=-0.022, apex=((0, -0.002, 1.792), (0, 0.012, 1.566)),
              nose=(0.097, 1.692, 0.132, 1.628, 0.098, 1.616, 0.017),
              ear=((0.095, -0.004, 1.694), (0.093, -0.010, 1.630), (0.119, -0.030, 1.702), (0.111, -0.034, 1.640)),
              tufts=None, tuft_z=1.708, eye=(0.040, 1.672), eye_size=(0.0125, 0.0052), eye_lift=0.0022):
    """A faceted box skull with one front-weighted wrap (not mirrored), a wedge nose, ear tabs, hair
    tufts and the `eyes` rhombi. `apex` = (top, bottom) fan points as (x, y offset from yc, z);
    nose = (top fwd, top z, tip fwd, tip z, base fwd, base z, half width); ear = (root top, root
    bottom, tip top, tip bottom) as (x, fwd, z). Returns a dict of objects and the head's BVH."""
    rings = rings or HEAD_RINGS
    fwd = V((0, -1, 0))
    yf = lambda f: yc - f                              # forward distance -> world y
    head, info = loft("head", [(0, yc + yo, z) for z, yo, *_ in rings],
                      [hbox(w, db, df, p) for z, yo, w, db, df, p in rings], fwd, REG["head"],
                      vs=[1 - r / REG["head"][3] for r in rows], uwarp=head_warp,
                      apex=((apex[0][0], yc + apex[0][1], apex[0][2]), (apex[1][0], yc + apex[1][1], apex[1][2])))
    tf, tz, pf, pz, bf, bz, bw = nose
    top, tip = (0, yf(tf), tz), (0, yf(pf), pz)
    npolys = []
    for sx in (1, -1):
        base = (sx * bw, yf(bf), bz)
        npolys.append(([top, tip, base], [("nose", 0.5, 0.02), ("nose", 0.5, 0.8), ("nose", 0.5 + sx * 0.46, 0.8)],
                       (sx, -1, 0.3)))
    npolys.append(([(bw, yf(bf), bz), tip, (-bw, yf(bf), bz)],
                   [("nose", 0.96, 0.9), ("nose", 0.5, 0.8), ("nose", 0.04, 0.9)], (0, -0.3, -1)))
    epolys = []
    rt, rb, tt, tb = ear
    for sx in (1, -1):
        p = lambda q, sx=sx: (sx * q[0], yf(q[1]), q[2])
        uv = [("ear", 0.02, 0.02), ("ear", 0.98, 0.02), ("ear", 0.98, 0.98), ("ear", 0.02, 0.98)]
        epolys.append(([p(rt), p(tt), p(tb), p(rb)], uv, (sx, 0.4, 0)))
        epolys.append(([(q[0] - sx * 0.002, q[1], q[2]) for q in (p(rt), p(tt), p(tb), p(rb))], uv, (-sx, -0.4, 0)))
    tree = bvh(head)
    tuft_ob = None
    if tufts:
        tp = []
        huv = [("hair", 0.05, 0.1), ("hair", 0.95, 0.1), ("hair", 0.5, 0.95)]
        for k, (ph, ln) in enumerate(tufts):
            d = V((math.sin(ph), -math.cos(ph), 0))
            loc, _ = hit(tree, V((0, yc, tuft_z)) + d * 0.5, -d)
            if loc is None:
                continue
            side = V((0, 0, 1)).cross(d).normalized()
            p0, p1 = loc - side * 0.012 - d * 0.004, loc + side * 0.012 - d * 0.004
            tipv = loc + d * ln + V((0, 0, -0.017)) + side * (0.005 if k % 2 else -0.005)
            tp.append(([p0, p1, tipv], huv, tuple(d + V((0, 0, 1)))))
            tp.append(([p1, p0, tipv + V((0, 0, -0.005)) - d * 0.003], huv, tuple(d + V((0, 0, -1.5)))))
        if tp:
            tuft_ob = poly_obj("tufts", tp)
    eyes = []
    for sx in (1, -1):
        loc, n = hit_front(tree, sx * eye[0], eye[1], eye_lift)
        if loc is None:
            loc, n = V((sx * eye[0], yf(0.075), eye[1])), V((0, -1, 0))
        a = V((sx, 0, 0)); a = (a - n * a.dot(n)).normalized()
        b = n.cross(a).normalized()
        if b.z < 0:
            b = -b
        pts = [loc - a * eye_size[0], loc - b * eye_size[1], loc + a * eye_size[0], loc + b * eye_size[1]]
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        eyes.append((pts, [("eyes", u(0.02), 0.5), ("eyes", 0.5, 0.98), ("eyes", u(0.98), 0.5), ("eyes", 0.5, 0.02)],
                     tuple(n)))
    return {"head": head, "info": info, "tree": tree, "nose": poly_obj("nose", npolys), "ears": poly_obj("ears", epolys),
            "tufts": tuft_ob, "eyes": poly_obj("eyes", eyes), "yc": yc}


def hand_frame(sx, pitch=20):
    """Palm normal n (inward, a bit back), thumb side td (front) and the back of the hand bk."""
    p_ = math.radians(pitch)
    n = V((-sx * math.cos(p_), math.sin(p_), 0))
    td = V((-sx * math.sin(p_), -math.cos(p_), 0))
    return n, td, -n


def make_hand(sd, sx, wr_, g=1.0, flen=1.0, curl=(25, 78), palm_len=1.0):
    """Palm, four-finger block and thumb hanging from the wrist point wr_ (Blender, world rest
    pose). g scales the whole hand, flen the fingers, curl = the two finger bend angles (degrees).
    Regions palm.<sd>, fing.<sd>, thumb.<sd>. Returns {"objs": {...}, "info": {...}, "tips": ...}."""
    dn = V((0, 0, -1)); n, td, bk = hand_frame(sx)
    pl = palm_len
    palm, ip = loft("palm." + sd, [wr_ + dn * -0.012, wr_ + dn * 0.046 * pl, wr_ + dn * 0.090 * g * pl],
                    [flatprof(0.033 * g, 0.017 * g), flatprof(0.045 * g, 0.020 * g),
                     flatprof(0.047 * g, 0.018 * g, {3: (0, 0.005)})], bk, REG["palm." + sd], (False, True))
    k0 = wr_ + dn * 0.086 * g * pl
    a1 = (dn * math.cos(math.radians(curl[0])) + n * math.sin(math.radians(curl[0]))).normalized()
    a2 = (dn * math.cos(math.radians(curl[1])) + n * math.sin(math.radians(curl[1]))).normalized()
    k1 = k0 + a1 * 0.050 * g * flen
    k2 = k1 + a2 * 0.042 * g * flen
    fb = lambda al: (bk * math.cos(math.radians(al)) + dn * math.sin(math.radians(al))).normalized()
    fing, jf = loft("fing." + sd, [k0, k1, k2],
                    [flatprof(0.046 * g, 0.0135 * g, {3: (0, 0.006)}), flatprof(0.044 * g, 0.012 * g),
                     flatprof(0.037 * g, 0.0095 * g)],
                    [fb(curl[0] / 2), fb((curl[0] + curl[1]) / 2 - 1), fb(curl[1])], REG["fing." + sd], (False, True))
    tb = wr_ + dn * 0.018 + td * 0.028 * g + n * 0.006
    t1 = (dn * 0.55 + td * 0.55 + n * 0.45).normalized()
    t2 = (dn * 0.50 + n * 0.80 + td * 0.10).normalized()
    th, jt = loft("thumb." + sd, [tb, tb + t1 * 0.034 * g, tb + t1 * 0.034 * g + t2 * 0.030 * g],
                  [boxprof(0.012 * g, 0.0105 * g), boxprof(0.011 * g, 0.0096 * g), boxprof(0.0088 * g, 0.0078 * g)],
                  bk, REG["thumb." + sd], (False, True))
    return {"objs": [palm, fing, th], "info": {"palm." + sd: ip, "fing." + sd: jf, "thumb." + sd: jt},
            "k0": k0, "k1": k1, "k2": k2, "n": n, "td": td, "bk": bk}


def make_foot(sd, sx, xf, s_max=0.208, toe=0.310, w=(0.055, 0.066, 0.070), tops=(0.088, 0.124, 0.082), yaw=8,
              heel=0.086, sole=0.04, lift=0.04, toe_h=0.030, shaft=None):
    """A shoe: three rings from heel to toe, a fan to the toe tip. Returns (foot, info)."""
    fwd = V((0, -1, 0)); up = V((0, 0, 1))
    a = math.radians(yaw) * sx
    fd = V((math.sin(a), -math.cos(a), 0))
    h0 = V((xf, heel, 0.0))
    ss = (0.0, 0.092, s_max)

    def fprof(wd, top):
        return sym([[0, -sole, 0], [-wd, -sole, 0], [-1.07 * wd, -0.008, 0], [-0.74 * wd, top - sole, 0],
                    [0, top - sole + 0.006, 0]])
    return loft("foot." + sd, [h0 + fd * s + V((0, 0, lift)) for s in ss], [fprof(wd, tp) for wd, tp in zip(w, tops)],
                up, REG["foot"], (True, False), apex=(None, h0 + fd * toe + V((0, 0, toe_h))))


def box_polys(reg, c, ax, ay, az, hx, hy, hz, uvs):
    """The six faces of a box centred on c with orthonormal axes ax/ay/az (Vectors) and half sizes.
    uvs = {"px": ..., "nx": ..., "py":..., "ny":..., "pz":..., "nz":...} each (u0, u1, v0, v1) in region `reg`."""
    P = lambda x, y, z: c + ax * (x * hx) + ay * (y * hy) + az * (z * hz)
    faces = {"px": ([(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)], ax),
             "nx": ([(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)], -ax),
             "py": ([(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)], ay),
             "ny": ([(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], -ay),
             "pz": ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], az),
             "nz": ([(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)], -az)}
    out = []
    for k, (cs, nrm) in faces.items():
        if k not in uvs:
            continue
        u0, u1, v0, v1 = uvs[k]
        uu = [(reg, u0, v1), (reg, u1, v1), (reg, u1, v0), (reg, u0, v0)]
        out.append(([P(*q) for q in cs], uu, tuple(nrm)))
    return out


def ribbon_polys(reg, pts, width, ref, u0=0.02, u1=0.98, v0=0.05, v1=0.95, lift=0.0, back=True, cycle=None):
    """A flat ribbon along the points: one quad per span, wide across the direction `ref` x tangent.
    Every span maps to the whole region (the pattern repeats), or to a slice if `cycle` = (k, n)."""
    out = []
    for i in range(len(pts) - 1):
        a, b = V(pts[i]), V(pts[i + 1])
        t = (b - a).normalized()
        r_ = V(ref[i] if isinstance(ref, list) else ref)
        s = t.cross(r_).normalized()
        w2 = s * (width / 2)
        nrm = s.cross(t).normalized()
        if cycle:
            k, n = cycle
            ua, ub = u0 + (u1 - u0) * ((i + k) % n) / n, u0 + (u1 - u0) * (((i + k) % n) + 1) / n
        else:
            ua, ub = u0, u1
        q = [a - w2, b - w2, b + w2, a + w2]
        uv = [(reg, ua, v1), (reg, ub, v1), (reg, ub, v0), (reg, ua, v0)]
        out.append((q, uv, tuple(nrm)))
        if back:
            out.append((q[::-1], uv[::-1], tuple(-nrm)))
    return out


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
    """Per-corner colour, multiplied into the texture: darker lower legs and fingertips, occlusion
    under the jaw and under hat brims, a cool lean in the dark. Uses the rest pose. A character can
    add its own with setup(tint=fn(part, co_world, normal_z) -> factor)."""
    me = ob.data
    jw = JW[ob["joint"]]
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    cols = np.ones((len(me.loops), 4), np.float32)
    cn = me.corner_normals
    extra = CFG.get("tint")
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co + jw
            nz = cn[li].vector.z
            f = 0.82 + 0.18 * smooth01((co.z - 0.05) / 0.85)
            f *= 0.93 + 0.07 * (0.5 + 0.5 * nz)
            if part.startswith("lowerArm") and co.z < 0.93:
                f *= 0.90 + 0.10 * smooth01((co.z - 0.75) / 0.18)
            if part == "head" and co.z < CFG["jaw_z"] and nz < 0.3:
                f *= 0.86
            if part in CFG["hat_parts"] and nz < -0.3:
                f *= 0.80
            if extra:
                f *= extra(part, co, nz)
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
    print(f"[{STYLE}] light percentiles 10/50/90:", np.percentile(light, [10, 50, 90]).round(2))
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



# ---------------------------------------------------------------- the page, the game export, the build

EDGE = np.ones((AT, AT))
PARTS_OBJ = []
STATE = {}


def compose_page(regs, light, glow_fn=None):
    """Quantise every painted region against the baked light (x the edge map) into the page, and
    build the glow page from each region's `glow` mask. regs: list of Reg."""
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 18))
    glow = np.zeros((AT, AT, 3))
    for r in regs:
        x0, y0, w, h = REG[r.name]
        lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.45, 0.45, wrap=r.P is not None)
        lt = np.where(lt < 0.05, 0.9, lt)                                   # unbaked texels
        lt = lt * EDGE[y0:y0 + h, x0:x0 + w]
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
        for mk, col in getattr(r, "glow", []):
            g = glow[y0:y0 + h, x0:x0 + w]
            g[np.asarray(mk) > 0.5] = C(col)
    return page, glow


def export_game(objs, page, glow):
    """public/models/<id>.json (+ .png, _glow.png): the rest-pose parts in joint-local three.js
    space, per-corner split normals, v flipped for a top-left origin."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    joints = {n: {"parent": p, "pos": [round(float(x), 4) for x in pos]} for n, p, pos in JOINTS}
    order = {n: i for i, (n, j) in enumerate(PARTS)}
    parts, tris = [], {}
    hz = hzf = None
    top = 0.0
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
            zs = [p[2] for p in P]
            hz = (min(ys) + max(ys)) / 2 + JW[ob["joint"]].z
            hzf = (min(zs) + max(zs)) / 2
        top = max(top, max(p[1] for p in P) + JW[ob["joint"]].z)
    total = sum(tris.values())
    meta = {"id": GAME_ID, "name": CFG["name"], "style": STYLE, "generator": CFG["script"],
            "units": "m", "up": "+Y", "facing": "+Z", "left": "+X", "pose": "rest",
            "tris": tris, "tris_body": total, "headwear": CFG["headwear"], "unlit": CFG["unlit"],
            "head_parts": HEAD_PARTS, "head_center_y": round(hz, 3) if hz else None,
            "head_center_fwd": round(hzf, 3) if hzf is not None else None,
            "height": round(top, 3)}
    if CFG["glow"]:
        meta["glow"] = CFG["glow"]
    meta["note"] = CFG["note"]
    meta.update(CFG["meta"])
    data = {"version": 1, "texture": GAME_ID + ".png", "emissive": GAME_ID + "_glow.png", "joints": joints,
            "parts": parts, "meta": meta}
    jp = os.path.join(EXPORT_DIR, GAME_ID + ".json")
    with open(jp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    save_png(os.path.join(EXPORT_DIR, GAME_ID + ".png"), page)
    save_png(os.path.join(EXPORT_DIR, GAME_ID + "_glow.png"), glow)
    print(f"[{STYLE}] export -> {jp} ({os.path.getsize(jp) / 1024:.1f} KB) tris {tris} total {total} "
          f"head centre {hz:.3f} height {top:.3f}")





def build():
    root = kit.empty("ZOMBIE_" + STYLE)
    I, G = CFG["build_rest"]()
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
    print(f"[{STYLE}] rest pose: feet {min(zs):.3f} m, top {max(zs):.3f} m")
    # bake in a game-like pose (arms forward, no arm/torso contact)
    apply_pose(objs, BAKE_POSE)
    body["eyes"].hide_render = True
    bake = [o for o in objs if o.name != "eyes"]
    light, pos = bake_maps(bake)
    body["eyes"].hide_render = False
    EDGE[:] = edge_light(bake)
    page, glow = CFG["paint_page"](I, light, pos)
    img = make_image(STYLE + "_page", page, "texture_page.png")
    gimg = make_image(STYLE + "_glow", glow, "glow_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    export_game(objs, page, glow)
    mat = ps1_mat("MND_" + STYLE, img, glow_img=gimg)
    emat = ps1_mat("MND_Eyes", img, vcol=False, unlit=True)
    STATE["mat"] = mat
    for ob in objs:
        kit.assign(ob, emat if ob.name == "eyes" else mat)
    ground(objs, HERO)
    return root


def preg(pos, name, joint):
    """Baked rest-pose positions (world) of a page region, for painting in 3D."""
    x0, y0, w, h = REG[name]
    return pos[y0:y0 + h, x0:x0 + w] + np.array(JW[joint])


def main():
    if "--export" in ARGS and "--final" not in ARGS:
        kit.reset()
        os.makedirs(OUT, exist_ok=True)
        build()
        return
    # Windows' 260-character path limit: under the app's virtualised profile the long project path leaves no
    # room for `preview_three_quarter.png` next to a long character id; save such shots as preview_3q.png
    kit.VIEWS.setdefault("3q", kit.VIEWS["three_quarter"])
    if len(os.path.join(os.path.abspath(OUT), "preview_three_quarter.png")) > 255 and "three_quarter" in " ".join(sys.argv):
        sys.argv[:] = [x.replace("three_quarter", "3q") for x in sys.argv]
        print(f"[{STYLE}] path too long for `preview_three_quarter.png`: the 3/4 view is saved as preview_3q.png")
    kit.run(STYLE, build, stage, post,
            meta={"technique": "rigid faceted prisms (hard normals > 30 deg) in the game rig's rest pose, posed by FK; "
                               "256px page, <=16-colour CLUT per region, painted light x Cycles-baked AO/facet light, "
                               "edge highlights; native 300x400 + composite/CRT post",
                  "texture_page": "256x256", "game_model": f"public/models/{GAME_ID}.json"})
    root = bpy.data.objects["ZOMBIE_" + STYLE]
    if "--final" in ARGS or "--walk" in ARGS:
        pose_shot(root, WALK, "walk", -35)
        pose_shot(root, WALK, "walk_side", -90)
    if "--final" in ARGS or "--face" in ARGS:
        face_shot(root)
    if "--final" in ARGS or "--hands" in ARGS:
        hands_shot(root)
    if "--final" in ARGS or "--ingame" in ARGS:
        ingame(root)


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
    fimg = make_image("horde_floor", paint_floor(), "floor_tile.png")
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
    print(f"[{STYLE}] {name} ->", p)


def face_shot(root):
    """Head close-up at native resolution, the cap and goggles in frame."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, HERO)
    root.rotation_euler.z = math.radians(-22)
    bpy.context.view_layer.update()
    head = bpy.data.objects["head"]
    hc = head.matrix_world @ V((0, CFG["face_cam"][0], CFG["face_cam"][1]))
    cam = sc.camera
    cam.data.lens = 50
    cam.location = hc + V((0.0, -1.0, 0.04))
    kit._aim(cam, hc + V((0, 0, -0.02)))
    set_fog(1.0, near_c=0.3, far_c=6.0)
    p = os.path.join(OUT, "face.png")
    render_native(p)
    post(p)
    print(f"[{STYLE}] face ->", p)


def hands_shot(root):
    """Close-up of both forearms and hands in the walk pose (native resolution, TV post)."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = NATIVE
    ground(PARTS_OBJ, WALK)
    root.rotation_euler.z = math.radians(-20)
    bpy.context.view_layer.update()
    cam = sc.camera
    cam.data.lens = 50
    for sd in "RL":
        ob = bpy.data.objects["lowerArm." + sd]
        hc = ob.matrix_world @ V((0, 0, -0.20))
        cam.location = hc + V((0.25 if sd == "R" else -0.25, -0.85, 0.15))
        kit._aim(cam, hc)
        set_fog(0.9, near_c=0.3, far_c=6.0)
        p = os.path.join(OUT, "hand" + sd + ".png")
        render_native(p)
        post(p)
        print(f"[{STYLE}] hand{sd} ->", p)


def ingame(root):
    """The character at fighting distance (~6 m) in the walk pose: 320x240, dark bunker fog."""
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
    wimg = make_image("horde_wall", paint_wall())
    wmat = ps1_mat("MND_EnvWall", wimg, "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-9, 2.6, 0), (9, 2.6, 0), (9, 2.6, 6.0), (-9, 2.6, 6.0))]
    bm.faces.new(vv)
    wall = kit.mesh_obj("Wall", bm, None, smooth=False)
    kit.assign(wall, wmat)
    dark = ps1_mat("MND_EnvHole", make_image("horde_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in ((-1.9, 2.58, 1.0), (-0.5, 2.58, 1.0), (-0.5, 2.58, 2.05), (-1.9, 2.58, 2.05))]
    bm.faces.new(vv)
    hole = kit.mesh_obj("Window", bm, None, smooth=False)
    kit.assign(hole, dark)
    wood = make_image("horde_wood", paint_wood())
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
    chalk = ps1_mat("MND_EnvChalk", make_image("horde_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
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
    print(f"[{STYLE}] ingame ->", p)

