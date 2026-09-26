# Polygon Ghoul (ps1): a 1997 32-bit console survival-horror zombie.
#
# ~700 flat-shaded triangles in 13 rigid segments (the game's rig split), every
# segment a lofted low-sided prism with a cylindrical UV wrap into ONE 256x256
# texture page painted per pixel with numpy (15-bit colour, nearest filtering).
# Render: Eevee, 1 sample, no AA filter, sun + flat ambient (no shadows), fog to a
# murky green by camera distance, vertices snapped to the "hardware" pixel grid
# before every render, then a post pass that point-samples to 400 lines, applies
# the PS1's 4x4 ordered dither + 15-bit truncation and upscales nearest-neighbour.
#
#   node art/zombies/blend.mjs z_ps1.py --preview [--views front,side,back]
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix

STYLE = "ps1"
OUT = os.path.join(kit.OUT_BASE, STYLE)
AT = 256              # texture page
CHUNK = 1             # body texel block size (2 = bake to 2x2 blocks; tested, too muddy)
POST_ROWS = 400       # "hardware" lines: one output pixel = render height / 400
SUN = 3.1
SUN_COL = (1.0, 0.92, 0.78)
AMB = (0.24, 0.26, 0.24)

# ---------------------------------------------------------------- palette (sRGB 0-255)
SKIN = (122, 120, 102); SKIN_D = (80, 78, 66); SKIN_L = (154, 150, 128)
BLOOD = (118, 18, 14); BLOOD_D = (72, 10, 8); BLOOD_B = (70, 30, 22); GORE = (84, 20, 14)
OD = (82, 77, 50); OD_D = (54, 50, 34); OD_L = (104, 97, 66)
KHAKI = (130, 116, 82); KHAKI_D = (86, 76, 52)
TROU = (88, 79, 55); TROU_D = (58, 52, 38); TROU_L = (110, 99, 71)
LEATHER = (56, 42, 31); LEATHER_D = (32, 24, 18); LEATHER_L = (84, 66, 48)
METAL = (156, 150, 128); METAL_D = (78, 76, 68)
HAIR = (38, 32, 26)
FOG_DARK = (8, 16, 11); FOG_GLOW = (56, 86, 60)

# texture page layout: name -> (x0, y0, w, h), top-left origin
REG = {
    "head": (0, 0, 128, 64), "torso": (128, 0, 128, 64), "pelvis": (0, 64, 128, 32),
    "cap": (128, 64, 32, 32), "neck": (160, 64, 32, 16),
    "boot.L": (192, 64, 64, 32), "boot.R": (0, 192, 64, 32),
    "thigh.L": (0, 96, 64, 64), "thigh.R": (64, 96, 64, 64),
    "shin.L": (128, 96, 64, 64), "shin.R": (192, 96, 64, 64),
    "uarm.L": (0, 160, 64, 32), "uarm.R": (64, 160, 64, 32),
    "farm.L": (128, 160, 32, 32), "farm.R": (160, 160, 32, 32),
    "hand.L": (192, 160, 32, 32), "hand.R": (224, 160, 32, 32),
    "thumb.L": (64, 192, 16, 16), "thumb.R": (80, 192, 16, 16),
}


def C(c):
    return np.array(c[:3], dtype=np.float64) / 255.0


def lin(c):
    out = []
    for x in c[:3]:
        x = x / 255.0
        out.append(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# ---------------------------------------------------------------- pixel painter

def lowfreq(rng, h, w, cell):
    """Smooth value noise in [-1, 1], wrapping horizontally (u = 0 == u = 1)."""
    gw = max(1, w // cell); gh = h // cell + 2
    g = rng.uniform(-1, 1, (gh, gw))
    ys = np.arange(h) / cell; xs = np.arange(w) / cell
    y0 = np.floor(ys).astype(int); fy = (ys - y0)[:, None]
    x0 = np.floor(xs).astype(int); fx = (xs - x0)[None, :]
    x1 = (x0 + 1) % gw; x0 = x0 % gw; y1 = np.minimum(y0 + 1, gh - 1)
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


class Tex:
    """A tiny texture, top row first. Columns wrap (they go round a limb):
    col 0 = back centre, w/4 = character's right, w/2 = front, 3w/4 = left."""

    def __init__(s, w, h, col, seed=0, grain=0.06, mottle=0.10, cell=8):
        s.w, s.h = w, h
        s.rng = np.random.default_rng(seed)
        s.a = np.empty((h, w, 3)); s.a[:] = C(col)
        if mottle:
            s.a *= (1 + mottle * lowfreq(s.rng, h, w, cell))[..., None]
        if grain:
            s.a *= (1 + grain * s.rng.standard_normal((h, w)))[..., None]

    def put(s, r, c, col, a=1.0):
        r = int(math.floor(r)); c = int(math.floor(c)) % s.w
        if 0 <= r < s.h:
            s.a[r, c] = s.a[r, c] * (1 - a) + C(col) * a

    def rect(s, r0, c0, r1, c1, col, a=1.0):
        r0, r1 = max(0, int(r0)), min(s.h, int(r1))
        for c in range(int(c0), int(c1)):
            cc = c % s.w
            s.a[r0:r1, cc] = s.a[r0:r1, cc] * (1 - a) + C(col) * a

    def mul(s, r0, c0, r1, c1, f):
        r0, r1 = max(0, int(r0)), min(s.h, int(r1))
        for c in range(int(c0), int(c1)):
            s.a[r0:r1, c % s.w] *= f

    def line(s, p0, p1, col, a=1.0):
        (r0, c0), (r1, c1) = p0, p1
        n = int(max(abs(r1 - r0), abs(c1 - c0))) + 1
        for k in range(n + 1):
            t = k / n
            s.put(round(r0 + (r1 - r0) * t), round(c0 + (c1 - c0) * t), col, a)

    def blob(s, r, c, rad, col, a=1.0, rough=0.35, sy=1.0):
        R = int(rad * 1.7 * max(1.0, sy)) + 1
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                d = math.hypot(dr / sy, dc) / rad + rough * s.rng.uniform(-1, 1)
                if d < 1:
                    s.put(r + dr, c + dc, col, a if d < 0.75 else a * 0.6)

    def drip(s, r, c, n, col=BLOOD, a=1.0):
        for k in range(n):
            if s.rng.random() < 0.12:
                c += int(s.rng.choice((-1, 1)))
            s.put(r + k, c, col, a)
        s.put(r + n, c, col, a); s.put(r + n, c + 1, col, a * 0.5)

    def splat(s, r, c, rad, col=BLOOD, drips=2, a=0.9):
        s.blob(r, c, rad, col, a)
        s.blob(r, c, rad * 0.5, BLOOD_D, a * 0.6)
        for _ in range(int(rad * 2)):
            ang = s.rng.uniform(0, 2 * math.pi); d = rad * s.rng.uniform(1.1, 2.0)
            s.put(r + math.sin(ang) * d, c + math.cos(ang) * d, col, a * 0.8)
        for _ in range(drips):
            s.drip(int(r + rad * 0.5), int(c + s.rng.integers(-int(rad), int(rad) + 1)),
                   int(s.rng.integers(3, 8)), col, a)

    def splat_f(s, r, c, rad, col=None, drips=2, a=0.8):
        # blood soaked into cloth: darker, browner, a little ragged
        s.splat(r, c, rad, GORE, drips, a)
        s.blob(r + 1, c, rad * 0.8, BLOOD_B, 0.35)

    def grime(s, n, dark=(40, 34, 24), dust=(128, 116, 88)):
        # big soft dirt blotches and a little dust: the lived-in photo-texture look
        for _ in range(n):
            s.blob(int(s.rng.integers(0, s.h)), int(s.rng.integers(0, s.w)),
                   float(s.rng.uniform(3, 7)), dark, float(s.rng.uniform(0.12, 0.25)), rough=0.6)
        for _ in range(n // 3):
            s.blob(int(s.rng.integers(0, s.h)), int(s.rng.integers(0, s.w)),
                   float(s.rng.uniform(2, 4)), dust, 0.15, rough=0.6)

    def vgrad(s, f0, f1, r0=0, r1=None):
        r1 = s.h if r1 is None else r1
        for r in range(max(0, r0), min(s.h, r1)):
            t = (r - r0) / max(1, r1 - 1 - r0)
            s.a[r] *= f0 + (f1 - f0) * t

    def ugrad(s, fn):
        u = (np.arange(s.w) + 0.5) / s.w
        s.a *= np.array([fn(x) for x in u])[None, :, None]

    def speckle(s, r0, c0, r1, c1, col, dens, a=1.0):
        for r in range(int(r0), int(r1)):
            for c in range(int(c0), int(c1)):
                if s.rng.random() < dens:
                    s.put(r, c, col, a)

    def wander(s, r0, r1, c, col, a=1.0, p=0.18, hi=None):
        for r in range(r0, r1):
            if s.rng.random() < p:
                c += int(s.rng.choice((-1, 1)))
            s.put(r, c, col, a)
            if hi:
                s.put(r, c - 1, hi, a * 0.4)

    def done(s, grain=0.035, chunk=1):
        a = s.a
        if chunk > 1:        # bake to chunk x chunk texel blocks (a lower-res texture)
            h2, w2 = s.h // chunk, s.w // chunk
            a = a.reshape(h2, chunk, w2, chunk, 3).mean(axis=(1, 3))
        a = a * (1 + grain * s.rng.standard_normal(a.shape[:2]))[..., None]
        a = np.round(np.clip(a, 0, 1) * 31) / 31            # 15-bit texels
        if chunk > 1:
            a = np.repeat(np.repeat(a, chunk, 0), chunk, 1)
        return a


def side(k, sgn, c0=None, w=128):
    """Column k texels from the front centre on the character's left (+1) / right (-1)."""
    c0 = w // 2 if c0 is None else c0
    return c0 + k if sgn > 0 else c0 - 1 - k


# ---------------------------------------------------------------- geometry

def prof(w, df, db, n=8, e=0.85, push=0.0):
    """Closed n-gon cross-section (superellipse, e < 1 = boxier) in (side, front)
    coordinates, starting at the back and running round the character's right side."""
    pts = []
    for k in range(n):
        ph = 2 * math.pi * k / n
        sx, cy = -math.sin(ph), math.cos(ph)
        x = 0.0 if abs(sx) < 1e-9 else math.copysign(abs(sx) ** e, sx) * w
        y = 0.0 if abs(cy) < 1e-9 else -math.copysign(abs(cy) ** e, cy) * (db if cy > 0 else df)
        pts.append([x, y])
    if push:
        pts[n // 2][1] += push
    return pts


def uv_in(reg, u, v):
    x0, y0, w, h = reg
    eps = 0.02
    col = min(max(u * w, eps), w - eps)
    row = min(max((1 - v) * h, eps), h - eps)
    return ((x0 + col) / AT, 1 - (y0 + row) / AT)


def loft(name, cs, profs, fref, reg, caps=(True, True)):
    """A rigid faceted segment: rings of profile points around a centre line.
    UVs wrap round the ring by arc length (u) and run along the segment (v = 1 at
    the first ring) inside the texture-page region `reg`."""
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, us, Ps = [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        rings.append([bm.verts.new(cs[i] + s * x + f * y) for x, y in profs[i]])
        L = [0.0]
        for k in range(n):
            a2, b2 = profs[i][k], profs[i][(k + 1) % n]
            L.append(L[-1] + math.hypot(b2[0] - a2[0], b2[1] - a2[1]))
        Ps.append(L[-1]); us.append([l / L[-1] for l in L])
    d = [0.0]
    for i in range(1, m):
        d.append(d[-1] + (cs[i] - cs[i - 1]).length)
    vs = [1 - x / d[-1] for x in d]

    def face(vv, uu, want):
        co = [v.co for v in vv]
        nrm = sum((co[i].cross(co[(i + 1) % len(co)]) for i in range(len(co))), V())
        if nrm.dot(want) < 0:
            vv, uu = vv[::-1], uu[::-1]
        fc = bm.faces.new(vv)
        uvd = {v: uv for v, uv in zip(vv, uu)}
        for lp in fc.loops:
            lp[uvl].uv = uv_in(reg, *uvd[lp.vert])

    for i in range(m - 1):
        cm = (cs[i] + cs[i + 1]) / 2
        for k in range(n):
            k1 = (k + 1) % n
            vv = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]
            uu = [(us[i][k], vs[i]), (us[i][k + 1], vs[i]), (us[i + 1][k + 1], vs[i + 1]), (us[i + 1][k], vs[i + 1])]
            ctr = sum((v.co for v in vv), V()) / 4
            face(vv, uu, ctr - cm)
    for end, i in ((0, 0), (1, m - 1)):
        if not caps[end]:
            continue
        P = Ps[i]; ymin = min(p[1] for p in profs[i])
        uu = [(0.5 + x / P, (1 - (y - ymin) / P) if end == 0 else (y - ymin) / P) for x, y in profs[i]]
        face(rings[i][:], uu, -ts[0] if end == 0 else ts[-1])
    ob = kit.mesh_obj(name, bm, None, smooth=False)
    return ob, {"v": vs, "P": Ps, "u": us}


def rig_part(name, objs, pivot, root, rot=None):
    ob = kit.join(objs) if len(objs) > 1 else objs[0]
    ob.name = name; ob.data.name = name
    ob.data.transform(Matrix.Translation(-V(pivot)))
    ob.location = pivot
    ob.parent = root
    if rot:
        ob.rotation_euler = [math.radians(a) for a in rot]
    return ob


HZ = (1.800, 1.758, 1.706, 1.664, 1.622, 1.583, 1.543)    # head ring heights (crown .. chin)


def cap_prof(w, h):
    # garrison cap cross-section: flat underside, near-vertical side curtains,
    # a narrow boxy crown on top
    return [[0, 0], [-w, 0], [-w * 0.97, h * 0.46], [-w * 0.14, h], [w * 0.14, h], [w * 0.97, h * 0.46], [w, 0]]


# ---------------------------------------------------------------- texture painting

def paint_head(info):
    w, h = 128, 64
    t = Tex(w, h, SKIN, 11, grain=0.06, mottle=0.14, cell=8)
    zt, zb = HZ[0], HZ[-1]
    R = lambda z: int(round((zt - z) / (zt - zb) * h))
    ey, ny, my = R(1.668), R(1.628), R(1.590)
    # bake the head's form into the paint: face plane light, temples and jaw darker
    t.ugrad(lambda u: 0.80 + 0.24 * max(0.0, -math.cos(2 * math.pi * u)) ** 0.7)
    t.blob(ey + 14, 44, 5, (104, 92, 96), 0.3, sy=1.3)            # livid blotches
    t.blob(ey - 2, 84, 4, (112, 104, 88), 0.35)
    for sg in (-1, 1):
        t.blob(ey + 10, side(12, sg), 5, SKIN_D, 0.6, sy=1.4)    # sunken cheeks
        t.blob(ey + 4, side(10, sg), 3, SKIN_L, 0.35, sy=0.7)    # cheekbones
        t.line((R(1.70), side(16, sg)), (R(1.672), side(20, sg)), (92, 84, 104), 0.5)
    for c in range(40, 88):                                       # under-jaw shade
        t.mul(my + 2, c, h, c + 1, 0.93 - 0.004 * abs(c - 63.5))
    # cropped hair, hairline highest at the front, low at the nape
    for c in range(w):
        u = (c + 0.5) / w
        bk = math.cos(2 * math.pi * u)
        zh = 1.694 - 0.085 * max(bk, 0) ** 0.8 + 0.030 * max(-bk, 0) + t.rng.uniform(-0.004, 0.004)
        r = R(zh)
        t.a[:r, c] = C(HAIR) * (1 + 0.18 * t.rng.standard_normal((r, 1)))
        for k in range(1, 7 if bk > 0.3 else 3):                  # clipped stubble fade
            if t.rng.random() < 0.8 - k * 0.12:
                t.put(r + k - 1, c, (62, 58, 48), 0.7)
    t.mul(R(1.61), 108, h, 148, 0.8)                              # nape shadow
    t.blob(R(1.585), 10, 3.0, BLOOD_D, 0.8); t.drip(R(1.58), 10, 6, BLOOD_D, 0.8)   # old wound
    # ears
    for cc in (30, 94):
        r0, r1 = R(1.690), R(1.628)
        t.rect(r0 + 1, cc, r1 - 1, cc + 5, (142, 128, 112), 1.0)
        t.rect(r0, cc + 1, r0 + 1, cc + 4, (142, 128, 112), 1.0); t.rect(r1 - 1, cc + 1, r1, cc + 4, (120, 96, 88), 1.0)
        t.rect(r0 + 2, cc + 2, r1 - 3, cc + 3, (72, 56, 52), 1.0)
        t.rect(r0 + 2, cc + 2, r0 + 3, cc + 4, (72, 56, 52), 1.0)
        for r in range(r0, r1):
            t.put(r, cc - 1, SKIN_D, 0.8); t.put(r, cc + 5, SKIN_D, 0.8)
    # eyes: deep sockets, heavy brow, milky eyes, raw lids
    for sg in (-1, 1):
        dr = 1 if sg < 0 else 0                                   # one eye droops
        t.blob(ey + dr, side(7, sg), 5.2, (54, 44, 50), 0.72, sy=0.8)
        t.blob(ey + dr, side(7, sg), 3.0, (40, 32, 38), 0.55, sy=0.8)
        lo, hi = (side(2, sg), side(12, sg)) if sg > 0 else (side(12, sg), side(2, sg))
        t.rect(ey - 8, lo, ey - 7, hi + 1, SKIN_L, 0.5)
        for k in range(2, 12):
            t.put(ey - 6 + (1 if k > 9 else 0), side(k, sg), HAIR, 0.85)
            t.put(ey - 5, side(k, sg), (60, 50, 44), 0.5)
        for k in range(5, 10):
            t.put(ey - 1 + dr, side(k, sg), (206, 200, 170))
            t.put(ey + dr, side(k, sg), (176, 168, 140))
            t.put(ey + 1 + dr, side(k, sg), (132, 50, 46), 0.65)
        t.put(ey - 1 + dr, side(7, sg), (30, 24, 22)); t.put(ey + dr, side(7, sg), (70, 50, 46))
        t.put(ey - 1 + dr, side(5, sg), (120, 110, 96))
        for k in range(4, 10):
            t.put(ey + 2 + dr, side(k, sg), (74, 62, 66), 0.45)
    # nose: lit ridge on the key-light side, shadow on the other, dark underside
    for r in range(ey - 3, ny):
        t.put(r, 62, SKIN_L, 0.45); t.put(r, 63, SKIN_L, 0.6)
        t.put(r, 65, SKIN_D, 0.55); t.put(r, 66, SKIN_D, 0.35)
    t.rect(ny, 61, ny + 1, 66, SKIN_L, 0.5)
    t.rect(ny + 1, 60, ny + 3, 68, (74, 62, 56), 0.6)
    t.put(ny + 1, 61, (40, 22, 20)); t.put(ny + 1, 66, (40, 22, 20))
    # mouth hanging open
    t.rect(my - 3, 56, my + 5, 72, (96, 64, 60), 0.35)
    t.rect(my - 2, 57, my - 1, 71, (80, 40, 36), 0.95)
    for c in range(58, 70):
        t.put(my - 1, c, (196, 182, 136) if c % 2 else (132, 116, 86))
    t.rect(my, 57, my + 2, 71, (26, 4, 4))
    for c in (59, 61, 66, 68):
        t.put(my + 2, c, (168, 154, 112))
    t.rect(my + 2, 60, my + 3, 68, (40, 6, 6), 0.8)
    t.rect(my + 3, 58, my + 4, 70, (110, 30, 28), 0.95)
    # blood: smeared round the mouth, sheeting off the chin, dragged up one cheek
    t.splat(my + 5, 64, 4.8, BLOOD, drips=0, a=0.85)
    t.blob(my + 8, 60, 3.5, BLOOD, 0.8); t.blob(my + 8, 68, 3, BLOOD_D, 0.7)
    t.blob(my + 1, 55, 2.6, BLOOD, 0.75)
    t.line((my, 55), (my - 8, 49), BLOOD, 0.6); t.line((my + 1, 54), (my - 6, 48), BLOOD_D, 0.45)
    for c, n in ((58, 9), (60, 12), (63, 13), (66, 11), (69, 8), (71, 6)):
        t.drip(my + 4, c, n, BLOOD, 0.9)
    t.speckle(ey + 9, 44, h - 3, 84, (70, 72, 60), 0.07, 0.35)    # stubble
    # forehead gash under the cap brim
    t.line((R(1.722), 69), (R(1.708), 78), BLOOD_D, 1.0)
    t.line((R(1.724), 70), (R(1.710), 79), (150, 96, 90), 0.6)
    t.drip(R(1.708), 74, 5, BLOOD, 0.85)
    t.vgrad(1.04, 0.88)
    t.mul(h - 2, 0, h, w, 0.8)
    return t.done()


def paint_neck(info):
    t = Tex(32, 16, SKIN, 13, grain=0.07, mottle=0.12, cell=4)
    t.line((1, 11), (15, 14), SKIN_L, 0.35); t.line((1, 20), (15, 17), SKIN_L, 0.35)
    t.rect(5, 15, 8, 17, SKIN_L, 0.4); t.rect(8, 15, 9, 17, SKIN_D, 0.5)
    for c, n in ((12, 10), (14, 14), (17, 12), (19, 8)):
        t.drip(0, c, n, BLOOD, 0.9)
    # bite wound on the left side of the neck
    t.blob(7, 24, 3.4, (150, 96, 88), 1.0, rough=0.45)
    t.blob(7, 24, 2.3, BLOOD_D, 1.0)
    t.blob(7, 24, 1.1, (30, 6, 6), 1.0, rough=0.2)
    t.drip(9, 23, 6, BLOOD); t.drip(9, 26, 5, BLOOD)
    t.vgrad(0.70, 1.0)
    return t.done(chunk=CHUNK)


def paint_cap(info):
    w, h = 32, 32
    t = Tex(w, h, (86, 84, 54), 101, grain=0.08, mottle=0.12, cell=4)
    u = info["u"][1]
    cu = lambda x: int(x * w)
    for c in range(w):
        uu = (c + 0.5) / w
        if uu < u[1] or uu > u[6]:
            t.a[:, c] *= 0.42                                     # inside / underside
    for k, hi in ((2, -1), (5, 1)):                               # curtain edge
        c = cu(u[k])
        t.rect(2, c, h - 2, c + 1, OD_D, 0.95)
        t.rect(2, c + hi, h - 2, c + hi + 1, OD_L, 0.55)
    t.rect(0, 15, h, 17, OD_D, 0.6)                               # crown crease
    t.rect(0, 14, h, 15, OD_L, 0.35)
    t.rect(0, cu(u[1]), h, cu(u[1]) + 2, OD_D, 0.5)               # sweat line
    t.rect(0, cu(u[6]) - 2, h, cu(u[6]), OD_D, 0.5)
    t.rect(5, cu(u[5]) + 2, 9, cu(u[5]) + 5, METAL_D, 0.8)        # plain enamel pin
    t.rect(6, cu(u[5]) + 3, 8, cu(u[5]) + 4, METAL, 0.8)
    t.speckle(0, 0, h, w, (62, 60, 40), 0.06, 0.6)
    t.vgrad(0.85, 0.92)
    t.mul(0, 0, 3, w, 0.8); t.mul(h - 3, 0, h, w, 0.8)
    return t.done(chunk=CHUNK)


def paint_torso(info):
    w, h = 128, 64
    t = Tex(w, h, OD, 21, grain=0.07, mottle=0.12, cell=8)
    for cc in (32, 96):                                           # armpit sweat
        t.blob(13, cc, 6, OD_D, 0.45, sy=1.7)
    # wrinkles
    for p0, p1 in (((20, 24), (30, 29)), ((22, 102), (32, 98)), ((34, 22), (42, 27)), ((33, 106), (41, 101)),
                   ((40, 58), (46, 54)), ((44, 70), (50, 74))):
        t.line(p0, p1, OD_D, 0.5)
    for c in range(3, 128, 9):
        t.line((55, c), (63, c + 1), OD_D, 0.45)
    # open collar: V of skin, collar points
    for r in range(0, 11):
        half = (10 - r) * 0.8
        for c in range(int(64 - half), int(math.ceil(64 + half))):
            t.put(r, c, SKIN_D if r < 3 else SKIN, 1.0)
    for r in range(0, 9):
        half = (10 - r) * 0.8
        wd = 6 - r // 2
        for sg in (-1, 1):
            e0 = 64 + half if sg > 0 else 64 - half - 1
            for k in range(wd):
                t.put(r, e0 + sg * k, OD_L, 0.9)
            t.put(r, e0 + sg * wd, OD_D, 0.9)
        if r == 8:
            t.rect(9, 54, 10, 74, OD_D, 0.7)
    t.splat(5, 64, 3.2, BLOOD, drips=0, a=0.9)
    for c, n in ((61, 14), (63, 24), (66, 18), (68, 10), (59, 8)):
        t.drip(8, c, n, BLOOD, 0.85)
    # placket and buttons
    for r in range(10, h):
        t.put(r, 63, OD_D, 0.75)
    for r in (16, 27, 38, 49):
        t.put(r, 63, (150, 140, 108)); t.put(r + 1, 63, OD_D)
    # chest pockets
    for sg in (-1, 1):
        c0 = 64 + 9 if sg > 0 else 63 - 21
        t.rect(14, c0, 28, c0 + 13, OD_D, 0.2)
        for r in (14, 27):
            t.rect(r, c0, r + 1, c0 + 13, OD_D, 0.8)
        t.rect(14, c0, 28, c0 + 1, OD_D, 0.8); t.rect(14, c0 + 12, 28, c0 + 13, OD_D, 0.8)
        t.rect(15, c0 + 1, 19, c0 + 12, OD_L, 0.55); t.rect(19, c0 + 1, 20, c0 + 12, OD_D, 0.9)
        t.put(18, c0 + 6, (150, 140, 108))
    # suspenders: straight down the front ...
    for sg in (-1, 1):
        s0 = 64 + 13 if sg > 0 else 63 - 16
        t.rect(0, s0, h, s0 + 4, KHAKI, 1.0)
        t.rect(0, s0, h, s0 + 1, KHAKI_D, 0.9); t.rect(0, s0 + 3, h, s0 + 4, KHAKI_D, 0.9)
        t.rect(29, s0 - 1, 34, s0 + 5, METAL, 1.0); t.rect(30, s0, 33, s0 + 4, METAL_D, 1.0)
        t.rect(31, s0 + 1, 32, s0 + 3, KHAKI, 1.0)
    # ... and crossed in an X on the back
    for r in range(h):
        off = max(-20.0, 15 - r * (30 / 44))
        for sg in (-1, 1):
            cc = int(round(sg * off)) - 2
            t.rect(r, cc, r + 1, cc + 4, KHAKI, 1.0)
            t.put(r, cc, KHAKI_D, 0.9); t.put(r, cc + 3, KHAKI_D, 0.9)
    t.rect(20, -3, 25, 3, LEATHER, 1.0); t.rect(20, -3, 21, 3, LEATHER_D, 1.0); t.rect(24, -3, 25, 3, LEATHER_D, 1.0)
    # blood and a rip showing grey skin
    t.grime(9)
    t.splat_f(40, 77, 6.0, BLOOD, drips=3, a=0.85)
    t.splat_f(47, 41, 3.5, BLOOD_B, drips=1, a=0.8)
    t.splat_f(18, 90, 2.5)
    t.blob(36, 6, 4, BLOOD_B, 0.55); t.blob(50, 118, 3, BLOOD_B, 0.5)
    t.blob(41, 36, 3.6, OD_D, 1.0, rough=0.5)
    t.blob(41, 36, 2.6, SKIN, 1.0, rough=0.45)
    t.blob(42, 36, 1.3, BLOOD_D, 0.9)
    t.speckle(0, 0, h, w, OD_D, 0.03, 0.5)
    t.vgrad(1.10, 0.80)
    t.ugrad(lambda u: 1 - 0.09 * math.sin(2 * math.pi * u) ** 2)
    return t.done(chunk=CHUNK)


def paint_pelvis(info):
    w, h = 128, 32
    t = Tex(w, h, TROU, 31, grain=0.07, mottle=0.12, cell=8)
    for p0, p1 in (((5, 64 + 18), (14, 64 + 25)), ((5, 63 - 18), (14, 63 - 25))):
        t.line(p0, p1, TROU_D, 0.9)
    for r in range(5, 23):
        t.put(r, 63, TROU_D, 0.9)
    t.line((22, 63), (25, 60), TROU_D, 0.9)
    for c0 in (7, 109):                                           # back pockets
        t.rect(7, c0, 8, c0 + 12, TROU_D, 0.8); t.rect(17, c0, 18, c0 + 12, TROU_D, 0.8)
        t.rect(7, c0, 18, c0 + 1, TROU_D, 0.8); t.rect(7, c0 + 11, 18, c0 + 12, TROU_D, 0.8)
        t.rect(8, c0 + 1, 11, c0 + 11, TROU_L, 0.5); t.rect(11, c0 + 1, 12, c0 + 11, TROU_D, 0.8)
        t.put(10, c0 + 5, METAL_D)
    for cc in (32, 96):
        for r in range(5, h):
            t.put(r, cc, TROU_D, 0.7)
    t.mul(22, 50, h, 78, 0.8); t.mul(22, 114, h, 142, 0.8)
    # belt, loops, buckle, suspender tabs
    t.rect(0, 0, 5, w, LEATHER, 1.0); t.rect(1, 0, 2, w, LEATHER_L, 0.5)
    t.rect(4, 0, 5, w, LEATHER_D, 1.0); t.rect(0, 0, 1, w, LEATHER_D, 0.7)
    for c in (64 + 26, 63 - 27, 64 + 44, 63 - 45, -1, 30, 97):
        t.rect(0, c, 6, c + 2, TROU, 1.0); t.rect(0, c, 6, c + 1, TROU_L, 0.4)
    t.rect(0, 59, 5, 69, METAL, 1.0); t.rect(1, 60, 4, 68, LEATHER_D, 1.0); t.rect(1, 63, 4, 65, METAL_D, 1.0)
    for s0 in (64 + 13, 63 - 16, 106, 18):
        t.rect(0, s0, 4, s0 + 4, KHAKI, 1.0); t.rect(0, s0, 4, s0 + 1, KHAKI_D, 0.9)
        t.rect(0, s0 + 3, 4, s0 + 4, KHAKI_D, 0.9); t.rect(2, s0 + 1, 3, s0 + 3, METAL, 1.0)
    t.grime(8)
    t.splat_f(9, 80, 3.4, BLOOD, drips=2)
    t.blob(20, 40, 3, BLOOD_B, 0.55); t.blob(14, 118, 2.5, BLOOD_B, 0.5)
    t.speckle(5, 0, h, w, TROU_D, 0.04, 0.5)
    t.vgrad(1.0, 0.84, 5, h)
    return t.done(chunk=CHUNK)


def paint_thigh(info, sd):
    L = sd == "L"
    w, h = 64, 64
    t = Tex(w, h, TROU, 41 if L else 43, grain=0.07, mottle=0.13, cell=8)
    outer, inner = (48, 16) if L else (16, 48)
    t.wander(0, h, outer, TROU_D, 0.85, p=0.1, hi=TROU_L)
    for c0, r0, r1 in ((26, 4, 40), (37, 10, 50), (30, 30, 60), (outer - 6, 6, 30), (outer + 6, 20, 46), (inner + 5, 0, 18)):
        t.wander(r0, r1, c0, TROU_D, 0.5, hi=TROU_L)
    for k in range(3):
        t.line((1 + k * 4, inner - 6), (4 + k * 4, inner + 6), TROU_D, 0.5)
    t.blob(57, 32, 8, (126, 110, 80), 0.35, rough=0.5, sy=0.8)    # dusty knee
    if L:
        t.grime(6)
        t.splat_f(24, 30, 6.5, BLOOD, drips=3); t.splat_f(42, 40, 4)
        t.blob(56, 33, 4.3, TROU_D, 1.0, rough=0.5)               # torn knee
        t.blob(56, 33, 3.2, SKIN_D, 1.0, rough=0.5)
        t.blob(57, 33, 1.8, BLOOD, 0.85)
    else:
        t.grime(6)
        t.splat_f(38, 36, 5.5, BLOOD, drips=3); t.blob(20, 26, 4, BLOOD_B, 0.6)
        c0 = outer - 7                                            # thigh pocket
        t.rect(14, c0, 31, c0 + 14, TROU_D, 0.25)
        t.rect(14, c0, 15, c0 + 14, TROU_D, 0.8); t.rect(30, c0, 31, c0 + 14, TROU_D, 0.8)
        t.rect(14, c0, 31, c0 + 1, TROU_D, 0.8); t.rect(14, c0 + 13, 31, c0 + 14, TROU_D, 0.8)
        t.rect(15, c0 + 1, 19, c0 + 13, TROU_L, 0.5); t.rect(19, c0 + 1, 20, c0 + 13, TROU_D, 0.9)
        t.put(18, c0 + 7, METAL_D)
    t.speckle(0, 0, h, w, TROU_D, 0.03, 0.5)
    t.vgrad(1.04, 0.92)
    t.ugrad(lambda u: 1 - 0.12 * max(0.0, math.cos(2 * math.pi * u)))
    return t.done(chunk=CHUNK)


def paint_shin(info, sd):
    L = sd == "L"
    w, h = 64, 64
    t = Tex(w, h, TROU, 51 if L else 53, grain=0.07, mottle=0.13, cell=8)
    rows = [int(round((1 - v) * h)) for v in info["v"]]
    rb = rows[2]
    for c0, r0, r1 in ((28, 2, rb - 8), (36, 6, rb - 4), (14, 0, rb - 10), (50, 4, rb - 6)):
        t.wander(r0, r1, c0, TROU_D, 0.5, hi=TROU_L)
    t.grime(6)
    r0 = rows[1] + (rb - rows[1]) // 3                            # bloused, bunched folds
    ph = t.rng.uniform(0, 6)
    for c in range(w):
        f = math.sin(c * 2 * math.pi / 6.4 + ph + 0.8 * math.sin(c * 0.7))
        for r in range(r0, h):
            k = (r - r0) / max(1, h - r0)
            t.a[r, c] *= 1 + (0.10 + 0.12 * k) * f
    for r in (rb - 3, rb + 3):
        t.rect(r, 0, r + 1, w, TROU_D, 0.35)
    t.rect(h - 3, 0, h, w, TROU_D, 0.7)
    t.speckle(r0, 0, h, w, (84, 70, 50), 0.10, 0.8)
    if L:
        t.splat_f(18, 34, 4.5, BLOOD, drips=3)
    else:
        t.blob(30, 26, 2.5, BLOOD_B, 0.6)
    t.vgrad(1.0, 0.9)
    t.ugrad(lambda u: 1 - 0.12 * max(0.0, math.cos(2 * math.pi * u)))
    return t.done(chunk=CHUNK)


def paint_boot(info, sd):
    L = sd == "L"
    w, h = 64, 32
    t = Tex(w, h, LEATHER, 61 if L else 63, grain=0.08, mottle=0.18, cell=8)
    rows = [int(round((1 - v) * h)) for v in info["v"]]
    ri = rows[2]
    for _ in range(12):
        t.blob(int(t.rng.integers(4, h - 4)), int(t.rng.integers(0, w)), 1.4, LEATHER_L, 0.45)
    t.rect(0, 29, ri - 1, 35, LEATHER_L, 0.35)                     # tongue
    for r in range(1, ri - 3, 3):
        t.put(r, 29, METAL_D); t.put(r, 34, METAL_D)
        t.line((r, 29), (r + 2, 34), (112, 98, 70), 0.9); t.line((r, 34), (r + 2, 29), (112, 98, 70), 0.9)
    t.rect(ri - 2, 20, ri - 1, 44, LEATHER_D, 0.9)                 # toe cap seam
    t.rect(ri - 1, 20, h - 4, 44, LEATHER_L, 0.3)
    t.rect(ri - 3, -8, h - 4, 8, LEATHER_D, 0.4)                   # heel counter
    t.rect(ri - 3, -8, ri - 2, 8, LEATHER_D, 0.8)
    t.rect(h - 4, 0, h, w, (32, 26, 22), 1.0)                      # sole
    for c in range(0, w, 2):
        t.put(h - 4, c, (112, 98, 74), 0.9)
    t.speckle(ri - 4, 0, h, w, (92, 80, 60), 0.14, 0.9)            # mud
    t.mul(0, 0, 4, w, 0.7)
    t.ugrad(lambda u: 1 - 0.12 * max(0.0, math.cos(2 * math.pi * u)))
    return t.done(chunk=CHUNK)


def paint_uarm(info, sd):
    L = sd == "L"
    w, h = 64, 32
    t = Tex(w, h, OD, 71 if L else 73, grain=0.07, mottle=0.12, cell=8)
    t.rect(2, 0, 3, w, OD_D, 0.5)
    for k in range(4):
        t.line((12 + k * 2, 20 + k * 7), (20 + k, 26 + k * 7), OD_D, 0.45)
    t.grime(4)
    t.rect(23, 0, h, w, OD_L, 0.7)                                 # rolled sleeve
    for r, a in ((23, 0.9), (27, 0.6), (31, 0.9)):
        t.rect(r, 0, r + 1, w, OD_D, a)
    if L:
        t.blob(10, 40, 2, BLOOD_B, 0.6); t.put(16, 30, BLOOD); t.put(18, 27, BLOOD)
    else:
        t.splat_f(17, 30, 3.5, BLOOD, drips=2)
    t.speckle(0, 0, h, w, OD_D, 0.03, 0.5)
    t.ugrad(lambda u: 0.78 + 0.28 * (0.5 - 0.5 * math.cos(2 * math.pi * u)))
    t.vgrad(1.05, 0.95)
    return t.done(chunk=CHUNK)


def paint_farm(info, sd):
    L = sd == "L"
    w, h = 32, 32
    t = Tex(w, h, SKIN, 81 if L else 83, grain=0.07, mottle=0.14, cell=8)
    t.wander(4, 30, 20, (88, 84, 104), 0.55, p=0.3)                # veins
    t.wander(6, 28, 11, (88, 84, 104), 0.45, p=0.3)
    t.blob(9, 5, 3, (98, 86, 98), 0.4)                             # bruise
    if L:
        for k in range(3):
            t.line((10 + k, 13 + k * 3), (18 + k, 19 + k * 3), BLOOD_D, 0.95)
            t.line((9 + k, 13 + k * 3), (17 + k, 19 + k * 3), (150, 96, 90), 0.4)
        t.splat(24, 12, 2.5, BLOOD, drips=1)
    else:
        t.splat(7, 16, 4, BLOOD, drips=3)
        t.blob(20, 22, 2, BLOOD_B, 0.5)
    t.rect(0, 0, 3, w, OD_L, 1.0); t.rect(2, 0, 3, w, OD_D, 0.8)   # sleeve roll overlap
    t.ugrad(lambda u: 0.95 + 0.13 * (0.5 + 0.5 * math.cos(2 * math.pi * u)))
    t.vgrad(1.0, 0.9)
    return t.done(chunk=CHUNK)


def paint_hand(info, sd):
    L = sd == "L"
    w, h = 32, 32
    t = Tex(w, h, SKIN, 91 if L else 93, grain=0.07, mottle=0.12, cell=4)
    rk = int(round((1 - info["v"][1]) * h))
    for c in (12, 16, 20):                                         # fingers (back)
        t.rect(rk + 1, c, h, c + 1, (60, 62, 50), 0.9)
    for c in (4, 28, 0):                                           # fingers (palm)
        t.rect(rk + 1, c, h, c + 1, (70, 72, 60), 0.7)
    for c in (8, 24):
        t.rect(rk, c, h, c + 1, SKIN_D, 0.5)
    for c in (10, 14, 18, 22):                                     # knuckles, nails
        t.put(rk - 1, c, SKIN_L, 0.8); t.put(rk - 1, c + 1, SKIN_L, 0.5)
        t.rect(h - 4, c - 1, h - 2, c + 1, (150, 146, 112), 1.0)
        t.rect(h - 2, c - 1, h - 1, c + 1, (50, 40, 30), 0.9)
    t.line((6, 2), (12, 6), SKIN_D, 0.5); t.line((8, 29), (13, 26), SKIN_D, 0.5)   # palm creases
    t.blob(rk, 16 + (2 if L else -2), 2.5, BLOOD, 0.8)
    t.blob(h - 2, 12 if L else 20, 2.2, BLOOD_D, 0.75)
    t.splat(8, 18 if L else 13, 2.0, BLOOD, drips=1)
    t.ugrad(lambda u: 1.0 + 0.10 * math.cos(2 * math.pi * u))
    t.vgrad(0.88, 1.0, 0, 4)
    return t.done(chunk=CHUNK)


def paint_thumb(info, sd):
    t = Tex(16, 16, SKIN, 95 if sd == "L" else 97, grain=0.07, mottle=0.1, cell=4)
    t.rect(10, 6, 13, 10, (150, 146, 112), 1.0); t.rect(13, 6, 14, 10, (50, 40, 30), 0.9)
    t.blob(5, 4, 1.5, BLOOD, 0.7)
    t.ugrad(lambda u: 1.0 + 0.08 * math.cos(2 * math.pi * u))
    return t.done(chunk=CHUNK)


def paint_floor():
    t = Tex(32, 32, (44, 47, 40), 111, grain=0.05, mottle=0.12, cell=8)
    t.rect(0, 0, 1, 32, (30, 32, 27), 0.7); t.rect(0, 0, 32, 1, (30, 32, 27), 0.7)
    t.wander(3, 29, 20, (44, 46, 40), 0.7, p=0.4)
    t.blob(10, 9, 3.5, (48, 48, 42), 0.45); t.blob(24, 25, 2.5, (54, 50, 42), 0.4)
    return t.done()


def make_image(name, arr, fname):
    hh, ww = arr.shape[:2]
    img = bpy.data.images.new(name, ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = arr[::-1]
    img.pixels.foreach_set(px.ravel())
    os.makedirs(OUT, exist_ok=True)
    img.filepath_raw = os.path.join(OUT, fname)
    img.file_format = "PNG"
    img.save()
    try:
        img.pack()
    except Exception as e:
        print("pack failed:", e)
    return img


def save_upscaled(arr, fname, k=4):
    big = np.kron(arr, np.ones((k, k, 1)))
    hh, ww = big.shape[:2]
    img = bpy.data.images.new("tmp_" + fname, ww, hh, alpha=False)
    px = np.ones((hh, ww, 4), np.float32); px[..., :3] = big[::-1]
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(OUT, fname); img.file_format = "PNG"; img.save()
    bpy.data.images.remove(img)


# ---------------------------------------------------------------- materials

def fog_group():
    """Screen-space murky-green fog colour (backdrop and fog share it, so the
    floor and the character dissolve into exactly the colour behind them)."""
    ng = bpy.data.node_groups.get("PS1_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("PS1_Fog", "ShaderNodeTree")
    ng.interface.new_socket(name="Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    N, Lk = ng.nodes, ng.links
    go = N.new("NodeGroupOutput")
    tc = N.new("ShaderNodeTexCoord")
    sub = N.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.56, 0.0)
    Lk.new(tc.outputs["Window"], sub.inputs[0])
    asp = N.new("ShaderNodeVectorMath"); asp.operation = "MULTIPLY"; asp.inputs[1].default_value = (0.75, 1.0, 0.0)
    Lk.new(sub.outputs[0], asp.inputs[0])
    ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    Lk.new(asp.outputs[0], ln.inputs[0])
    mr = N.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0; mr.inputs["From Max"].default_value = 0.62
    mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 0.0
    Lk.new(ln.outputs["Value"], mr.inputs["Value"])
    pw = N.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 1.4
    Lk.new(mr.outputs["Result"], pw.inputs[0])
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
    Lk.new(pw.outputs[0], mix.inputs[0])
    mix.inputs[6].default_value = lin(FOG_DARK); mix.inputs[7].default_value = lin(FOG_GLOW)
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.6; nz.inputs["Detail"].default_value = 5.0
    nz.inputs["Roughness"].default_value = 0.62
    off = N.new("ShaderNodeVectorMath"); off.operation = "ADD"; off.inputs[1].default_value = (3.7, 1.3, 0.5)
    Lk.new(asp.outputs[0], off.inputs[0]); Lk.new(off.outputs[0], nz.inputs["Vector"])
    mr2 = N.new("ShaderNodeMapRange")
    mr2.inputs["From Min"].default_value = 0.30; mr2.inputs["From Max"].default_value = 0.70
    mr2.inputs["To Min"].default_value = 0.55; mr2.inputs["To Max"].default_value = 1.45
    Lk.new(nz.outputs["Fac"], mr2.inputs["Value"])
    mul = N.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    Lk.new(mix.outputs[2], mul.inputs[6]); Lk.new(mr2.outputs["Result"], mul.inputs[7])
    Lk.new(mul.outputs[2], go.inputs[0])
    return ng


def ps1_mat(name, img, floor=False):
    """Lambert (sun) + flat ambient, nearest-sampled texture, mixed to the fog
    colour by camera distance. Rough 1 / no specular by construction."""
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree; nt.nodes.clear(); N, Lk = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    tex = N.new("ShaderNodeTexImage"); tex.image = img; tex.interpolation = "Closest"
    col = tex.outputs["Color"]
    if floor:
        geo = N.new("ShaderNodeNewGeometry")
        mp = N.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1 / 1.6, 1 / 1.6, 1.0)
        Lk.new(geo.outputs["Position"], mp.inputs["Vector"]); Lk.new(mp.outputs["Vector"], tex.inputs["Vector"])
        tex.extension = "REPEAT"
        sq = N.new("ShaderNodeVectorMath"); sq.operation = "MULTIPLY"; sq.inputs[1].default_value = (1.0, 0.85, 0.0)
        Lk.new(geo.outputs["Position"], sq.inputs[0])
        ln = N.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"; Lk.new(sq.outputs[0], ln.inputs[0])
        ramp = N.new("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = "CONSTANT"
        cr.elements[0].position = 0.0; cr.elements[0].color = (0.28, 0.28, 0.28, 1)
        cr.elements[1].position = 0.36; cr.elements[1].color = (1, 1, 1, 1)
        e = cr.elements.new(0.27); e.color = (0.55, 0.55, 0.55, 1)
        Lk.new(ln.outputs["Value"], ramp.inputs["Fac"])
        sh = N.new("ShaderNodeMix"); sh.data_type = "RGBA"; sh.blend_type = "MULTIPLY"; sh.inputs[0].default_value = 1.0
        Lk.new(col, sh.inputs[6]); Lk.new(ramp.outputs["Color"], sh.inputs[7])
        col = sh.outputs[2]
    dif = N.new("ShaderNodeBsdfDiffuse"); Lk.new(col, dif.inputs["Color"])
    amb = N.new("ShaderNodeMix"); amb.data_type = "RGBA"; amb.blend_type = "MULTIPLY"
    amb.inputs[0].default_value = 1.0
    Lk.new(col, amb.inputs[6]); amb.inputs[7].default_value = (*AMB, 1.0)
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

def build():
    root = kit.empty("ZOMBIE_ps1")
    I = {}
    fwd = V((0, -1, 0)); up = V((0, 0, 1))

    # torso + neck
    T = [(1.500, -0.078, 0.100, 0.070, 0.070),
         (1.455, -0.070, 0.225, 0.110, 0.105),
         (1.330, -0.046, 0.212, 0.125, 0.112),
         (1.170, -0.016, 0.185, 0.115, 0.105),
         (1.030, 0.000, 0.172, 0.108, 0.100)]
    torso, I["torso"] = loft("torso", [(0, y, z) for z, y, *_ in T],
                             [prof(w, df, db, 8, 0.7) for z, y, w, df, db in T], fwd, REG["torso"], (True, False))
    neck, I["neck"] = loft("neck", [(0, -0.078, 1.465), (0, -0.098, 1.595)],
                           [prof(0.062, 0.058, 0.058, 6, 1.0)] * 2, fwd, REG["neck"], (False, False))
    # boxy head, nose pushed out of the front vertex
    Hd = [(HZ[0], -0.052, 0.062, 0.064, 0.078, 0.0),
          (HZ[1], -0.057, 0.092, 0.100, 0.104, 0.0),
          (HZ[2], -0.058, 0.102, 0.112, 0.106, 0.0),
          (HZ[3], -0.058, 0.099, 0.103, 0.101, 0.0),
          (HZ[4], -0.059, 0.095, 0.104, 0.094, 0.026),
          (HZ[5], -0.061, 0.083, 0.100, 0.079, 0.004),
          (HZ[6], -0.065, 0.060, 0.085, 0.048, 0.0)]
    head, I["head"] = loft("head", [(0, y - 0.045, z - 0.01) for z, y, *_ in Hd],
                           [prof(w, df, db, 8, 0.8, p) for z, y, w, df, db, p in Hd], fwd, REG["head"])
    CAP = [(-0.190, 1.724, 0.050, 0.086),     # front peak
           (-0.168, 1.712, 0.099, 0.114),
           (-0.058, 1.722, 0.101, 0.090),     # pinched dip in the crown
           (0.052, 1.734, 0.101, 0.102),
           (0.078, 1.746, 0.055, 0.080)]      # back peak
    cap, I["cap"] = loft("cap", [(0.006, y - 0.045, z - 0.01) for y, z, w, hh in CAP], [cap_prof(w, hh) for y, z, w, hh in CAP],
                         up, REG["cap"])
    # pelvis / trouser seat with the belt
    PZ = [(1.075, 0.190, 0.120, 0.112), (0.950, 0.206, 0.124, 0.120), (0.845, 0.160, 0.104, 0.104)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, 0, z) for z, *_ in PZ],
                               [prof(w, df, db, 8, 0.75) for z, w, df, db in PZ], fwd, REG["pelvis"], (False, True))

    parts = [("head", [head, cap], (0, -0.095, 1.565), (8, -7, 0)),
             ("torso", [torso, neck], (0, 0, 1.03), None),
             ("pelvis", [pelvis], (0, 0, 0.95), None)]

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
                                   [prof(0.072, 0.072, 0.072, 6, 1.0), prof(0.066, 0.066, 0.066, 6, 1.0),
                                    prof(0.054, 0.056, 0.056, 6, 1.0)], up, REG["uarm." + sd], (False, True))
        fa, I["farm." + sd] = loft("farm." + sd, [el - d2 * 0.035, el + d2 * 0.11, wr],
                                   [prof(0.050, 0.050, 0.050, 6, 1.0), prof(0.052, 0.047, 0.047, 6, 1.0),
                                    prof(0.037, 0.031, 0.031, 6, 1.0)], up, REG["farm." + sd], (False, False))
        fb = V((0, -1, 0)); fbo = (fb - d3 * fb.dot(d3)).normalized()
        hc = [wr - d3 * 0.015, wr + d3 * 0.08, wr + d3 * 0.158 - fbo * 0.032]
        hd, I["hand." + sd] = loft("hand." + sd, hc,
                                   [prof(0.036, 0.021, 0.021, 6, 0.9), prof(0.053, 0.026, 0.026, 6, 0.9),
                                    prof(0.047, 0.018, 0.018, 6, 0.9)], fb, REG["hand." + sd], (False, True))
        sin_ = V((-sx, 0, 0))
        tb = wr + d3 * 0.03 + sin_ * 0.034 - fbo * 0.006
        tdir = (d3 * 0.7 + sin_ * 0.25 - fbo * 0.55).normalized()
        th, I["thumb." + sd] = loft("thumb." + sd, [tb, tb + tdir * 0.055],
                                    [prof(0.014, 0.012, 0.012, 4, 1.0), prof(0.010, 0.009, 0.009, 4, 1.0)],
                                    fb, REG["thumb." + sd], (False, True))
        # legs: left foot a half step forward
        hip = V((sx * 0.104, 0.0, 0.965))
        kn = V((sx * 0.124, -0.035 if L else -0.005, 0.505))
        an = V((sx * 0.150, -0.045 if L else 0.055, 0.115))
        t1 = (kn - hip).normalized()
        tg, I["thigh." + sd] = loft("thigh." + sd, [hip - t1 * 0.02, hip.lerp(kn, 0.5), kn + t1 * 0.01],
                                    [prof(0.102, 0.104, 0.110, 8, 0.9), prof(0.098, 0.100, 0.096, 8, 0.9),
                                     prof(0.078, 0.082, 0.074, 8, 0.9)], fwd, REG["thigh." + sd], (False, False))
        t2 = (an - kn).normalized()
        sb = an - t2 * 0.045
        sn, I["shin." + sd] = loft("shin." + sd, [kn - t2 * 0.03, kn.lerp(sb, 0.45), kn.lerp(sb, 0.84), sb],
                                   [prof(0.076, 0.080, 0.078, 8, 0.9), prof(0.073, 0.071, 0.080, 8, 0.9),
                                    prof(0.092, 0.095, 0.096, 8, 0.9), prof(0.083, 0.086, 0.086, 8, 0.9)],
                                   fwd, REG["shin." + sd], (False, True))
        a = math.radians(10) * sx
        bf = V((math.sin(a), -math.cos(a), 0))
        B = [(0.215, 0.068, 0.074, 0.074, 0.9), (0.115, 0.074, 0.094, 0.080, 0.9),
             (0.062, 0.078, 0.176, 0.086, 0.72), (0.0, 0.084, 0.198, 0.094, 0.72)]
        bt, I["boot." + sd] = loft("boot." + sd, [(an.x, an.y, z) for z, *_ in B],
                                   [prof(w, df, db, 8, e) for z, w, df, db, e in B], bf, REG["boot." + sd], (False, True))
        parts += [("upperarm." + sd, [ua], sh, None), ("forearm." + sd, [fa], el, None),
                  ("hand." + sd, [hd, th], wr, None), ("thigh." + sd, [tg], hip, None),
                  ("shin." + sd, [sn, bt], kn, None)]

    # the texture page
    tiles = {"head": paint_head(I["head"]), "neck": paint_neck(I["neck"]), "cap": paint_cap(I["cap"]),
             "torso": paint_torso(I["torso"]), "pelvis": paint_pelvis(I["pelvis"])}
    for sd in "LR":
        tiles["thigh." + sd] = paint_thigh(I["thigh." + sd], sd)
        tiles["shin." + sd] = paint_shin(I["shin." + sd], sd)
        tiles["boot." + sd] = paint_boot(I["boot." + sd], sd)
        tiles["uarm." + sd] = paint_uarm(I["uarm." + sd], sd)
        tiles["farm." + sd] = paint_farm(I["farm." + sd], sd)
        tiles["hand." + sd] = paint_hand(I["hand." + sd], sd)
        tiles["thumb." + sd] = paint_thumb(I["thumb." + sd], sd)
    page = np.zeros((AT, AT, 3)); page[:] = C((24, 24, 18))
    for name, arr in tiles.items():
        x0, y0, w, h = REG[name]
        page[y0:y0 + h, x0:x0 + w] = arr
    img = make_image("ps1_page", page, "texture_page.png")
    save_upscaled(page, "texture_page_x4.png")
    mat = ps1_mat("PS1_Ghoul", img)

    for name, objs, pivot, rot in parts:
        ob = rig_part(name, objs, pivot, root, rot)
        kit.assign(ob, mat)
    return root


# ---------------------------------------------------------------- stage, snapping, post

SNAP = []


def snap_vertices():
    """Snap every vertex to the 'hardware' pixel grid in screen space (the PS1's
    integer vertex coordinates), keeping depth. Recomputed per render from the
    stored rest positions, so it follows the turntable."""
    sc = bpy.context.scene; cam = sc.camera
    bpy.context.view_layer.update()
    step = (cam.data.sensor_width / cam.data.lens) / POST_ROWS
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


def render_to_snapped(path):
    snap_vertices()
    return _render_to(path)


kit.render_to = render_to_snapped      # run() looks render_to up in kit at call time


def stage(root):
    sc = kit.render_setup("EEVEE", (900, 1200), samples=1, view="Standard", filter_px=0.0)
    ee = sc.eevee
    for attr in ("use_raytracing", "use_shadows", "use_gtao", "use_volumetric_shadows", "use_bloom"):
        try:
            setattr(ee, attr, False)
        except Exception:
            pass
    kit.world((0, 0, 0), 0.0)
    sun = kit.sun("Sun", rot=(52, 0, -30), strength=SUN, angle=1.0, color=SUN_COL)
    sun.data.use_shadow = False
    back = kit.sun("BackLight", rot=(-62, 0, -150), strength=1.1, angle=1.0, color=(0.45, 0.85, 0.55))
    back.data.use_shadow = False                                  # 2nd directional light: cool fog-green fill
    cam = kit.camera(lens=50)
    kit.frame_to(cam, root, margin=1.07, aim_frac=0.5, elev=0.10)
    # fog distance relative to the framed camera distance
    dist = cam.location.length
    for m in bpy.data.materials:
        fr = m.node_tree.nodes.get("FogRange") if m.node_tree else None
        if fr:
            near, far = (dist - 2.4, dist + 6.0) if m.name == "PS1_Floor" else (dist - 1.2, dist + 9.0)
            fr.inputs["From Min"].default_value = near
            fr.inputs["From Max"].default_value = far
    # fog card fixed behind everything, facing the camera
    bm = bmesh.new()
    S = 24.0
    vv = [bm.verts.new(p) for p in ((-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0))]
    bm.faces.new(vv)
    card = kit.mesh_obj("FogCard", bm, None, smooth=False)
    card.parent = cam; card.location = (0, 0, -45)
    cm = bpy.data.materials.new("PS1_FogCard")
    try:
        cm.use_nodes = True
    except Exception:
        pass
    nt = cm.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    g = nt.nodes.new("ShaderNodeGroup"); g.node_tree = fog_group()
    nt.links.new(g.outputs[0], em.inputs["Color"]); nt.links.new(em.outputs[0], o.inputs["Surface"])
    kit.assign(card, cm)
    # concrete floor with a stepped blob shadow, dissolving into the fog
    bm = bmesh.new()
    F = 60.0
    vv = [bm.verts.new(p) for p in ((-F, -F, -0.002), (F, -F, -0.002), (F, F, -0.002), (-F, F, -0.002))]
    bm.faces.new(vv)
    floor = kit.mesh_obj("Floor", bm, None, smooth=False)
    fimg = make_image("ps1_floor", paint_floor(), "floor_tile.png")
    kit.assign(floor, ps1_mat("PS1_Floor", fimg, floor=True))
    # rest positions for the vertex snapping
    SNAP.clear()
    for ob in kit.descendants(root):
        if ob.type == "MESH":
            rest = np.empty(len(ob.data.vertices) * 3, np.float32)
            ob.data.vertices.foreach_get("co", rest)
            SNAP.append((ob, rest.reshape(-1, 3).astype(np.float64)))


# the PS1 GPU's 4x4 dither offsets (in 8-bit units), added before truncating to 5 bits
PS1_DITHER = np.array([[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]], float)


def post(path):
    def fn(a):
        H, W = a.shape[:2]
        s = H / POST_ROWS
        nh, nw = POST_ROWS, max(1, int(round(W / s)))
        ri = np.minimum(((np.arange(nh) + 0.5) * s).astype(int), H - 1)
        ci = np.minimum(((np.arange(nw) + 0.5) * s).astype(int), W - 1)
        lo = a[ri][:, ci, :3] * 255.0                              # point-sample (no filtering)
        d = PS1_DITHER[(np.arange(nh) % 4)[:, None], (np.arange(nw) % 4)[None, :]][..., None]
        lo = np.floor(np.clip(lo + d, 0, 255) / 8.0) / 31.0        # 15-bit colour
        yi = np.minimum((np.arange(H) / s).astype(int), nh - 1)
        xi = np.minimum((np.arange(W) / s).astype(int), nw - 1)
        outp = np.ones((H, W, 4)); outp[..., :3] = lo[yi][:, xi]   # nearest upscale
        return outp
    kit.numpy_post(path, fn)


kit.run(STYLE, build, stage, post,
        meta={"technique": "lofted rigid prisms (bmesh), numpy-painted 256px page, 15-bit, fog, vertex snap, PS1 dither",
              "texture_page": "256x256", "segments": 13})
