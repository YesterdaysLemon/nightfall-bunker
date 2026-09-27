# Kintsugi (style id `kintsugi`): the secret porcelain boss, remade for the 1997
# world (art/STYLE.md). A 1940s lady as an antique porcelain figurine, broken and
# mended with gold, built like the Polygon Ghoul.
#
# Model: ~1100 triangles in rigid segments on the game's boss joints (the rig in
# src/client/render/kintsugi.js): hard-edged 6-16-sided prisms and rings, split
# normals over 30 degrees. The chunks are planned for the damage stages and the
# shatter: the skull cap and the left victory roll go at stage 1 (showing a dark
# bisque hollow), the left forearm at stage 2 (leaving a bisque stump), three of the
# eight skirt shards at stage 3; every chunk flies on its own in a shatter/reform.
# Texture: one 256x256 page (face mirrored, ~3x density) painted as material ids +
# painted light (Cycles-baked AO and key light, glaze glints painted from the baked
# normals), quantised to per-material ramps; the gold seams are also on a glow page.
# Props on the same page and in the same export: the dancing figurine (~0.28 m on a
# round base, a low-poly posed build of the same lady with a pretty face) and the
# mended teacup on its saucer.
#
# z_ps1b.py is used as a library (painter, ramps, stage, fog, TV post).
#   node art/zombies/blend.mjs z_kintsugi.py --preview [--views front,side]
#   node art/zombies/blend.mjs z_kintsugi.py --final   (heroes, turntable, ingame, props)
# Every run exports public/models/kintsugi.json + kintsugi.png + kintsugi_glow.png.
import os, sys, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix

STYLE = "kintsugi"
OUT = os.path.join(kit.OUT_BASE, STYLE)
MODELS = os.path.join(kit.ROOT, "public", "models")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
os.makedirs(OUT, exist_ok=True)


def _ps1b():
    """z_ps1b.py minus its run() call, as a namespace."""
    path = os.path.join(HERE, "z_ps1b.py")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    src = src[:src.index("\nkit.run(")]
    ns = {"__name__": "ps1b_lib", "__file__": path}
    exec(compile(src, path, "exec"), ns)
    return ns


P = _ps1b()
P["OUT"] = OUT
Reg, lowfreq, blur2, ell, prof, uv_in = P["Reg"], P["lowfreq"], P["blur2"], P["ell"], P["prof"], P["uv_in"]
flatprof, boxprof, C, save_png, make_image = P["flatprof"], P["boxprof"], P["C"], P["save_png"], P["make_image"]
AT = 256
TAU = 2 * math.pi


# ---------------------------------------------------------------- ramps (sRGB, dark -> light, lit base)
# Same value range and hue shift as the world table: cool shadows, warm highlights.
# Glaze whites stay below pure white; only gold and cobalt are bright accents.
def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


RAMPS = {
    "glaze": ([(44, 46, 56), (72, 76, 88), (106, 108, 116), (138, 140, 144), (170, 170, 166), (198, 195, 184),
               (230, 224, 204)], 4),
    "cobalt": ([(14, 20, 56), (26, 40, 100), (42, 64, 136), (76, 100, 168)], 2),
    "gold": ([(98, 64, 22), (172, 126, 48), (238, 198, 114)], 1),
    "bisque": ([(72, 64, 58), (120, 110, 98)], 1),
    "hollow": ([(18, 16, 16), (36, 32, 30), (58, 52, 46)], 1),
    "socket": ([(6, 6, 8), (18, 16, 18)], 1),
    "tooth": ([(106, 98, 80), (164, 154, 128), (204, 194, 162)], 1),
    "rouge": ([(118, 50, 54), (168, 84, 84)], 1),
}
for _k, (_cols, _base) in RAMPS.items():
    P["RAMPS"][_k] = (_cols, _base)
    P["RAMP_C"][_k] = np.array(_cols, float) / 255.0
    P["RAMP_LL"][_k] = np.log(np.array([_luma(c) for c in _cols]) / _luma(_cols[_base]))
GLOW_C = C((255, 178, 70))

# ---------------------------------------------------------------- texture page layout (x, y, w, h), top-left
REG = {
    "skirt": (0, 0, 128, 72), "head": (128, 0, 80, 72), "crown": (208, 0, 48, 48),
    "figface": (208, 48, 32, 24), "sw": (240, 48, 16, 24),
    "chest": (0, 72, 128, 64), "hairback": (128, 72, 64, 24), "roll": (192, 72, 48, 24), "rollend": (240, 72, 16, 16),
    "waist": (128, 96, 64, 16), "neck": (192, 96, 32, 16), "figbase": (224, 96, 32, 16),
    "yoke": (128, 112, 64, 24), "uarm": (192, 112, 64, 24),
    "farm": (0, 136, 64, 40), "thumb": (64, 136, 16, 16), "inner": (64, 152, 16, 24),
    "thigh": (80, 136, 32, 40), "shin": (112, 136, 48, 40), "shoe": (160, 136, 48, 24), "heel": (208, 136, 16, 16),
    "stump": (224, 136, 32, 16), "hollow": (224, 152, 32, 24),
    "cup": (0, 176, 96, 48), "saucer": (96, 176, 96, 40),
}
P["REG"] = REG
_occ = np.zeros((AT, AT), int)
for _n, (_x, _y, _w, _h) in REG.items():
    _occ[_y:_y + _h, _x:_x + _w] += 1
assert _occ.max() == 1, "texture regions overlap"
# flat 8x8 swatches for end caps (broken faces are unglazed bisque)
SW = {"glazedark": (240, 48, "glaze", 2), "bisque": (248, 48, "bisque", 1), "cobalt": (240, 56, "cobalt", 2),
      "black": (248, 56, "socket", 0), "glaze": (240, 64, "glaze", 4), "gold": (248, 64, "gold", 1)}


def pg(px, py):
    """Page texel coordinates (top-left origin) -> Blender UV."""
    return (px / AT, 1 - py / AT)


def swuv(name):
    x, y = SW[name][:2]
    return pg(x + 4, y + 4)


# ---------------------------------------------------------------- the rig (three.js space, parent-relative)
JOINTS = [
    ("body", None, (0, 0, 0)), ("hips", "body", (0, 0.97, 0)), ("spine", "hips", (0, 0.08, 0)),
    ("chest", "spine", (0, 0.13, 0)), ("neck", "chest", (0, 0.27, 0)), ("head", "neck", (0, 0.085, 0.01)),
    ("shL", "chest", (0.172, 0.232, -0.005)), ("shR", "chest", (-0.172, 0.232, -0.005)),
    ("elL", "shL", (0, -0.275, 0)), ("elR", "shR", (0, -0.275, 0)),
    ("hipL", "hips", (0.085, -0.03, 0)), ("hipR", "hips", (-0.085, -0.03, 0)),
    ("knL", "hipL", (0, -0.44, 0)), ("knR", "hipR", (0, -0.44, 0)),
]


def t2b(v):
    return V((v[0], -v[2], v[1]))


def b2t(v):
    return (v[0], v[2], -v[1])


JABS = {}
for _n, _p, _o in JOINTS:
    JABS[_n] = (JABS[_p] if _p else V((0, 0, 0))) + t2b(_o)
SKIRT_TOP = 0.905
SKIRT_HINGE = round(SKIRT_TOP - 0.97, 4)          # shard hinge height relative to the hips joint


def euler3(a, b, c):
    """three.js Euler XYZ (about three's X, Y, Z) as a Blender rotation matrix."""
    return Matrix.Rotation(a, 4, "X") @ Matrix.Rotation(b, 4, "Z") @ Matrix.Rotation(-c, 4, "Y")


def make_rig(prefix, root):
    E = {}
    for n, par, p in JOINTS:
        e = kit.empty(prefix + n)
        e.parent = E[par] if par else root
        e["rest"] = list(t2b(p))
        e.location = t2b(p)
        E[n] = e
    return E


def set_pose(E, pose):
    for n, e in E.items():
        a, b, c = pose.get(n, (0, 0, 0))
        e.matrix_basis = Matrix.Translation(V(e["rest"])) @ euler3(a, b, c)
    bpy.context.view_layer.update()


REST = {"shL": (0, 0, 0.1), "shR": (0, 0, -0.1), "elL": (-0.15, 0, 0), "elR": (-0.15, 0, 0)}
# dancePose() in kintsugi.js, for the figurine
DANCE = {"hips": (0, 0.28, 0), "spine": (-0.1, 0, 0), "chest": (-0.06, -0.12, 0.05), "hipR": (0.85, 0, 0),
         "knR": (0.75, 0, 0), "hipL": (-0.05, 0, 0.03), "shL": (-2.75, 0, 0.3), "elL": (-0.65, 0, 0),
         "shR": (-0.25, 0, -1.3), "elR": (-0.4, 0, 0), "neck": (0, 0, -0.18), "head": (-0.15, 0.3, -0.05)}
# hero renders: the stiff doll walk, arms out, head cocked
HERO = {"hips": (0, 0.1, 0.03), "spine": (0.06, -0.12, -0.03), "chest": (0.04, 0, 0), "neck": (-0.05, 0.06, 0.26),
        "head": (-0.08, 0.14, 0.08), "shL": (-0.55, 0, 0.30), "elL": (-0.5, 0, 0), "shR": (-1.0, 0, -0.22),
        "elR": (-0.35, 0, 0), "hipL": (-0.26, 0, 0.02), "knL": (0.1, 0, 0), "hipR": (0.2, 0, -0.02), "knR": (0.34, 0, 0)}


# ---------------------------------------------------------------- mesh building

class MB:
    """bmesh builder: vertices shared by position (per tag), UVs per corner, faces
    oriented toward `want`. Everything smooth; hard edges come from the 30 deg rule."""

    def __init__(s, name):
        s.name = name
        s.bm = bmesh.new()
        s.uv = s.bm.loops.layers.uv.new("UVMap")
        s.vm = {}

    def v(s, co, tag=0):
        k = (tag, round(co[0], 5), round(co[1], 5), round(co[2], 5))
        if k not in s.vm:
            s.vm[k] = s.bm.verts.new(co)
        return s.vm[k]

    def face(s, cos, uvs, want=None, tag=0):
        cos = [V(c) for c in cos]
        if want is not None:
            nrm = sum((cos[i].cross(cos[(i + 1) % len(cos)]) for i in range(len(cos))), V())
            if nrm.dot(V(want)) < 0:
                cos, uvs = cos[::-1], list(uvs)[::-1]
        vv = [s.v(c, tag) for c in cos]
        if len(set(vv)) < len(vv):
            return None
        try:
            f = s.bm.faces.new(vv)
        except ValueError:
            return None
        f.smooth = True
        for lp, uv in zip(f.loops, uvs):
            lp[s.uv].uv = uv
        return f

    def obj(s):
        ob = kit.mesh_obj(s.name, s.bm, None, smooth=False)
        sharpen(ob)
        return ob


def sharpen(ob, deg=30):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(deg))
    except Exception as e:
        print("[kintsugi] set_sharp_from_angle:", e)
    me.update()


def loft(mb, cs, profs, fref, reg, mirror=None, vs=None, caps=(False, False), cap_uv="bisque", tag=0):
    """Rings of profile points round a centre line (see z_ps1b.loft). UVs wrap round the
    ring by arc length (u = 0.5 at the front, + = the character's left for top-down
    lofts) or mirror (0 = front centre, `mirror` = side vertex, 1 = back centre) and run
    along the segment (v = 1 at the first ring). Caps: a swatch name, or
    ('planar', region, radius)."""
    reg = REG[reg] if isinstance(reg, str) else reg
    m, n = len(cs), len(profs[0])
    cs = [V(c) for c in cs]
    ts = [(cs[min(i + 1, m - 1)] - cs[max(i - 1, 0)]).normalized() for i in range(m)]
    frs = fref if isinstance(fref, list) else [fref] * m
    rings, xs, Ps, Qs = [], [], [], []
    for i in range(m):
        t = ts[i]; f = V(frs[i]); f = (f - t * f.dot(t)).normalized(); s = f.cross(t).normalized()
        rings.append([cs[i] + s * x + f * y for x, y in profs[i]])
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
    for i in range(m - 1):
        cm = (cs[i] + cs[i + 1]) / 2
        for k in range(n):
            k1 = (k + 1) % n
            cos = [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]]
            uvs = [uv_in(reg, xs[i][k], vs[i]), uv_in(reg, xs[i][k + 1], vs[i]),
                   uv_in(reg, xs[i + 1][k + 1], vs[i + 1]), uv_in(reg, xs[i + 1][k], vs[i + 1])]
            mb.face(cos, uvs, sum(cos, V()) / 4 - cm, tag)
    for end, i in ((0, 0), (1, m - 1)):
        if not caps[end]:
            continue
        if isinstance(cap_uv, tuple):
            _, rn, rad = cap_uv
            x0, y0, w, h = REG[rn]
            uvs = [pg(x0 + w / 2 + x / rad * (w / 2 - 0.6), y0 + h / 2 - y / rad * (h / 2 - 0.6)) for x, y in profs[i]]
        else:
            uvs = [swuv(cap_uv)] * n
        mb.face(rings[i], uvs, -ts[0] if end == 0 else ts[-1], tag)
    return {"v": vs, "P": Ps, "Pm": max(Ps), "L": d[-1], "d": d, "Q": Qs, "rings": rings, "z": [c.z for c in cs]}


def lathe(mb, pts, n, reg, a0=0.0, caps=(None, None), tag=0, rows=None):
    """Solid of revolution round +Z from a profile [(r, z)] listed counter-clockwise
    (r to the right, z up), so faces point out of the solid. u = angle (0.5 at the
    front), v = arc length along the profile (or `rows` = [0..1] per ring)."""
    reg = REG[reg] if isinstance(reg, str) else reg
    ang = [a0 + TAU * k / n for k in range(n)]
    rings = [[V((r * math.sin(a), -r * math.cos(a), z)) for a in ang] for r, z in pts]
    if rows is None:
        L = [0.0]
        for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
            L.append(L[-1] + math.hypot(r1 - r0, z1 - z0))
        rows = [l / L[-1] for l in L]
    uu = [(0.5 + k / n) % 1.0 for k in range(n)] + [None]
    for j in range(len(pts) - 1):
        (r0, z0), (r1, z1) = pts[j], pts[j + 1]
        nr, nz = (z1 - z0), -(r1 - r0)
        for k in range(n):
            k1 = (k + 1) % n
            ua = uu[k]; ub = uu[k1] if uu[k1] > ua else ua + 1.0 / n
            cos = [rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]]
            am = (ang[k] + TAU / (2 * n))
            want = V((nr * math.sin(am), -nr * math.cos(am), nz))
            uvs = [uv_in(reg, ua, 1 - rows[j]), uv_in(reg, ub, 1 - rows[j]), uv_in(reg, ub, 1 - rows[j + 1]),
                   uv_in(reg, ua, 1 - rows[j + 1])]
            mb.face(cos, uvs, want, tag)
    for end, j in ((0, 0), (1, len(pts) - 1)):
        c = caps[end]
        if not c:
            continue
        want, uvn = c
        uvs = [swuv(uvn)] * n if isinstance(uvn, str) else [uvn(p) for p in rings[j]]
        mb.face(rings[j], uvs, V((0, 0, want)), tag)
    return rings


# ---------------------------------------------------------------- the lady
# head rings, top of the face loft .. under the jaw: (z, y, half-width, front, back, {vertex: push})
# 12-gon: 6 = front centre, 5/7 = front quarter (eyes), 4/8 cheekbones, 3/9 sides, 0 = back
HEADR = [
    (1.705, -0.052, 0.084, 0.086, 0.094, {}),
    (1.672, -0.052, 0.086, 0.088, 0.094, {6: (0, 0.012), 5: (0, 0.012), 4: (0, 0.004)}),          # brow ridge
    (1.645, -0.053, 0.084, 0.080, 0.092, {5: (0.004, -0.018), 6: (0, 0.006), 4: (0.004, 0.0)}),   # sockets
    (1.614, -0.055, 0.084, 0.084, 0.088, {4: (0.010, 0.008), 5: (0.002, 0.004), 6: (0, 0.002)}),  # cheekbones
    (1.586, -0.057, 0.066, 0.082, 0.072, {4: (-0.010, -0.010), 5: (-0.002, 0.0), 6: (0, 0.004)}),  # gaunt cheeks, teeth
    (1.562, -0.060, 0.046, 0.074, 0.054, {5: (-0.004, 0.0), 6: (0, 0.006)}),                        # pointed chin
    (1.542, -0.064, 0.034, 0.042, 0.042, {}),
]
HEAD_ROWS = (0, 12, 24, 38, 50, 62, 72)
HEAD_FC = 56
FIGHEAD = [
    (1.705, -0.052, 0.084, 0.086, 0.094, {}),
    (1.648, -0.054, 0.086, 0.092, 0.092, {}),
    (1.598, -0.057, 0.070, 0.086, 0.078, {}),
    (1.548, -0.063, 0.040, 0.052, 0.050, {}),
]
FIG_ROWS = (0, 9, 17, 24)
FIG_FC = 20
CROWN = (1.752, -0.056, 0.068, 0.064, 0.080)      # z, y, w, front, back of the upper dome ring
CROWN_TOP = V((0, -0.058, 1.779))
CROWN_R = 0.105                                   # top projection half-size (crown region)
SK = [(SKIRT_TOP, 0.162, 0.140, 0.142), (0.675, 0.240, 0.222, 0.230), (0.430, 0.308, 0.290, 0.300)]
SK_ROWS = 64


def shoeprof(w, h):
    return [[0, -h], [-w, -h], [-w * 0.85, h * 0.35], [0, h], [w * 0.85, h * 0.35], [w, -h]]


def crown_uv(p):
    x0, y0, w, h = REG["crown"]
    return pg(x0 + (p.x / CROWN_R * 0.5 + 0.5) * w, y0 + ((p.y - CROWN[1]) / CROWN_R * 0.5 + 0.5) * h)


def sk_pt(a, row, z=None):
    zz, w, df, db = SK[row]
    d = df if math.cos(a) >= 0 else db
    return V((w * math.sin(a), -d * math.cos(a), zz if z is None else z))


def sk_row(z):
    return min(71.6, max(0.4, (SKIRT_TOP - z) / (SKIRT_TOP - SK[2][0]) * SK_ROWS))


def sk_u(a):
    return 0.5 + a / TAU


def build_lady(lo=False):
    """-> parts [(name, joint, MB)], paint info. lo=True: the figurine's low-poly build."""
    F = V((0, -1, 0)); U = V((0, 0, 1))
    parts, I = [], {}
    rng = np.random.default_rng(7)
    n6 = 4 if lo else 6

    # ---- head: the face loft (mirrored UVs), the crown dome, the cap, the hollow
    face = MB("face")
    rings, rows, reg, fc, nh = (FIGHEAD, FIG_ROWS, "figface", FIG_FC, 8) if lo else (HEADR, HEAD_ROWS, "head", HEAD_FC, 12)
    I["head"] = loft(face, [(0, y, z) for z, y, *_ in rings], [prof(w, df, db, nh, 0.9, p) for z, y, w, df, db, p in rings],
                     F, reg, mirror=fc / REG[reg][2], vs=[1 - r / REG[reg][3] for r in rows],
                     caps=(False, True), cap_uv="glazedark")
    zA, yA, wA, dfA, dbA, pA = rings[0]
    A = [V((x, yA - y, zA)) for x, y in prof(wA, dfA, dbA, nh, 0.9, pA)]
    B = [V((x, CROWN[1] - y, CROWN[0])) for x, y in prof(CROWN[2], CROWN[3], CROWN[4], nh, 0.9)]
    hc = V((0, -0.055, 1.66))
    cap = MB("cap")
    capset = set() if lo else {6, 7, 8}          # sectors from the front centre round to the left side
    for k in range(nh):
        k1 = (k + 1) % nh
        tgt = cap if k in capset else face
        for cos in ([A[k], A[k1], B[k1], B[k]], [B[k], B[k1], CROWN_TOP]):
            ctr = sum(cos, V()) / len(cos)
            tgt.face(cos, [crown_uv(p) for p in cos], ctr - hc)
            if tgt is cap:
                ins = [hc + (p - hc) * 0.955 for p in cos]
                tgt.face(ins, [swuv("bisque")] * len(cos), hc - ctr, tag=1)
    parts.append(("face", "head", face))
    if not lo:
        parts.append(("cap", "head", cap))
        hol = MB("hollow")
        H1 = [V((x, -0.054 - y, 1.700)) for x, y in prof(0.074, 0.074, 0.082, 8, 1.0)]
        H2 = [V((x, -0.056 - y, 1.742)) for x, y in prof(0.052, 0.050, 0.060, 8, 1.0)]
        top, bot, hctr = V((0, -0.058, 1.764)), V((0, -0.052, 1.650)), V((0, -0.055, 1.705))

        def huv(p):
            x0, y0, w, h = REG["hollow"]
            return pg(x0 + (p.x / 0.09 * 0.5 + 0.5) * w, y0 + min(h - 0.5, max(0.5, (1.766 - p.z) / 0.118 * h)))
        for k in range(8):
            k1 = (k + 1) % 8
            for cos in ([H1[k], H1[k1], H2[k1], H2[k]], [H2[k], H2[k1], top], [H1[k1], H1[k], bot]):
                ctr = sum(cos, V()) / len(cos)
                hol.face(cos, [huv(p) for p in cos], hctr - ctr)
        parts.append(("hollow", "head", hol))

    # ---- victory rolls (hard 8-gons, lo: 6) and the nape roll
    nr = 6 if lo else 8
    for sd, sx in (("L", 1), ("R", -1)):
        rb = MB("roll" + sd)
        pr = prof(0.034, 0.034, 0.034, nr, 1.0)
        rcs = [(sx * 0.050, -0.132, 1.728), (sx * 0.054, -0.070, 1.752), (sx * 0.056, -0.010, 1.736)]
        rpr = [pr, [(x * 1.07, y * 1.07) for x, y in pr], pr]
        if lo:
            rcs, rpr = [rcs[0], rcs[2]], [pr, pr]
        loft(rb, rcs, rpr, [V((sx * 0.45, 0, 1)).normalized()] * len(rcs), "roll", caps=(True, True),
             cap_uv=("planar", "rollend", 0.037))
        parts.append(("roll" + sd, "head", rb))
    nb = MB("hairBack")
    pr = prof(0.030, 0.030, 0.030, 4 if lo else 6, 1.0)
    I["hairback"] = loft(nb, [(-0.074, 0.004, 1.600), (0, 0.030, 1.588), (0.074, 0.004, 1.600)], [pr, pr, pr], U,
                         "hairback", caps=(True, True), cap_uv=("planar", "rollend", 0.033))
    parts.append(("hairBack", "head", nb))

    # ---- neck, bodice (padded shoulders, bust, pointed collar), belt, yoke
    nk = MB("neck")
    I["neck"] = loft(nk, [(0, -0.028, 1.578), (0, -0.004, 1.428)],
                     [prof(0.037, 0.035, 0.037, n6, 1.0), prof(0.041, 0.038, 0.041, n6, 1.0)], F, "neck")
    parts.append(("neck", "neck", nk))
    CH = [(1.468, 0.000, 0.052, 0.042, 0.048, 1.0, {}),
          (1.428, 0.002, 0.190, 0.074, 0.080, 0.55, {}),
          (1.345, -0.004, 0.160, 0.100, 0.084, 0.75, {}),
          (1.262, -0.010, 0.140, 0.110, 0.082, 0.8, {4: (0, 0.010), 5: (0, -0.004)}),
          (1.160, -0.004, 0.118, 0.082, 0.078, 0.85, {}),
          (1.058, 0.000, 0.098, 0.070, 0.068, 0.85, {})]
    nc = 6 if lo else 10
    chs = [CH[i] for i in ((0, 1, 3, 5) if lo else range(6))]
    ch = MB("chest")
    I["chest"] = ci = loft(ch, [(0, y, z) for z, y, *_ in chs],
                           [prof(w, df, db, nc, e, {} if lo else p) for z, y, w, df, db, e, p in chs], F, "chest",
                           caps=(True, False), cap_uv="glazedark")
    if not lo:
        def chest_uv(p):
            zs = ci["z"]
            j = max(0, min(len(zs) - 2, next((i for i in range(len(zs) - 1) if p.z >= zs[i + 1]), len(zs) - 2)))
            t = (zs[j] - p.z) / (zs[j] - zs[j + 1])
            Pz = ci["P"][j] * (1 - t) + ci["P"][j + 1] * t
            v = ci["v"][j] * (1 - t) + ci["v"][j + 1] * t
            return uv_in(REG["chest"], 0.5 + p.x / Pz, v)
        for sx in (1, -1):                       # the pointed collar: two flaps lying on the chest
            a, b, c = V((sx * 0.012, -0.052, 1.463)), V((sx * 0.072, -0.068, 1.438)), V((sx * 0.047, -0.103, 1.370))
            nrm = V((0, -1, 0.55))
            ch.face([a, b, c], [swuv("glaze")] * 3, nrm, tag=2)
            ch.face([a, b, c], [swuv("glazedark")] * 3, -nrm, tag=3)
    parts.append(("chest", "chest", ch))
    wb = MB("waist")
    WR = [(1.082, 0.097, 0.070, 0.068), (1.040, 0.104, 0.076, 0.074), (0.990, 0.104, 0.076, 0.074), (0.962, 0.100, 0.073, 0.071)]
    wrs = [WR[0], WR[3]] if lo else WR
    I["waist"] = loft(wb, [(0, 0, z) for z, *_ in wrs], [prof(w, df, db, nc, 0.85) for z, w, df, db in wrs], F, "waist")
    parts.append(("waist", "spine", wb))
    yb = MB("yoke")
    YR = [(0.990, 0.101, 0.074, 0.072, 0.9), (0.940, 0.148, 0.122, 0.124, 0.95), (0.893, 0.172, 0.150, 0.152, 1.0)]
    YR = [YR[0], YR[2]] if lo else YR
    I["yoke"] = loft(yb, [(0, 0, z) for z, *_ in YR], [prof(w, df, db, 8 if lo else 12, e) for z, w, df, db, e in YR], F, "yoke")
    parts.append(("yoke", "hips", yb))

    # ---- the skirt: eight hinged shards of a 16-sided flared cone, broken hem
    if lo:
        sb = MB("skirt")
        hem = (0.46, 0.34, 0.33, 0.33)
        for f in range(8):
            a0, a1 = f * TAU / 8, (f + 1) * TAU / 8
            q = [sk_pt(a0, 0), sk_pt(a1, 0)]
            h0 = V((hem[1] * math.sin(a0), -hem[2] * math.cos(a0), hem[0]))
            h1 = V((hem[1] * math.sin(a1), -hem[2] * math.cos(a1), hem[0]))
            cos = [q[0], q[1], h1, h0]
            u0, u1 = sk_u(a0), sk_u(a1)
            if u0 >= 1:
                u0, u1 = u0 - 1, u1 - 1
            uvs = [uv_in(REG["skirt"], u, 1 - sk_row(p.z) / 72) for u, p in zip((u0, u1, u1, u0), cos)]
            ctr = sum(cos, V()) / 4
            sb.face(cos, uvs, V((ctr.x, ctr.y, 0)))
            ins = [V((p.x * 0.97, p.y * 0.97, p.z)) for p in cos]
            sb.face(ins, [pg(REG["inner"][0] + 8, REG["inner"][1] + 12)] * 4, V((-ctr.x, -ctr.y, 0)), tag=1)
        parts.append(("skirt", "hips", sb))
    else:
        NS = 16
        hemz = [SK[2][0] + rng.uniform(-0.016, 0.016) for _ in range(NS)]
        outline = []
        for i in range(8):
            sb = MB(f"skirt{i}")
            for f in (2 * i, 2 * i + 1):
                a0, a1 = f * TAU / NS, (f + 1) * TAU / NS
                t0, t1 = sk_pt(a0, 0), sk_pt(a1, 0)
                m0, m1 = sk_pt(a0, 1), sk_pt(a1, 1)
                e0, e1 = sk_pt(a0, 2, hemz[f % NS]), sk_pt(a1, 2, hemz[(f + 1) % NS])
                at = (a0 + a1) / 2 + rng.uniform(-0.3, 0.3) * (a1 - a0)
                zt = min(e0.z, e1.z) - rng.uniform(0.022, 0.056)
                pm, ph = sk_pt(at, 1), sk_pt(at, 2)
                dv = (ph - pm).normalized()
                tooth = ph + dv * ((SK[2][0] - zt) / abs(dv.z))
                ua, ub, ut = sk_u(a0), sk_u(a1), sk_u(at)
                if sk_u(2 * i * TAU / NS) >= 1:
                    ua, ub, ut = ua - 1, ub - 1, ut - 1
                R = REG["skirt"]
                uv = lambda u, p: uv_in(R, u, 1 - sk_row(p.z) / 72)
                ir = REG["inner"]
                iuv = lambda u, p: pg(ir[0] + 1 + (u % 0.125) / 0.125 * (ir[2] - 2), ir[1] + 1 + sk_row(p.z) / 72 * (ir[3] - 2))
                for cos, us in (([t0, t1, m1, m0], (ua, ub, ub, ua)), ([m0, m1, e1, e0], (ua, ub, ub, ua)),
                                ([e0, e1, tooth], (ua, ub, ut))):
                    ctr = sum(cos, V()) / len(cos)
                    out = V((ctr.x, ctr.y, 0))
                    sb.face(cos, [uv(u, p) for u, p in zip(us, cos)], out)
                    ins = [V((p.x * 0.975, p.y * 0.975, p.z)) for p in cos]
                    sb.face(ins, [iuv(u, p) for u, p in zip(us, cos)], -out, tag=1)
                outline.append([(ua, sk_row(e0.z)), (ut, sk_row(zt)), (ub, sk_row(e1.z))])
            parts.append((f"skirt{i}", "hips", sb))
        I["skirt_outline"] = outline

    # ---- arms: puff sleeves, long porcelain forearms, big flat hands
    for sd, sx in (("L", 1), ("R", -1)):
        ua = MB("upper" + sd)
        cs = [(sx * 0.176, 0.006, 1.458), (sx * 0.186, 0.006, 1.398), (sx * 0.181, 0.006, 1.334),
              (sx * 0.179, 0.006, 1.328), (sx * 0.172, 0.005, 1.152)]
        pr = [prof(0.050, 0.048, 0.050, n6, 1), prof(0.068, 0.064, 0.066, n6, 1), prof(0.054, 0.052, 0.052, n6, 1),
              prof(0.036, 0.036, 0.036, n6, 1), prof(0.029, 0.030, 0.030, n6, 1)]
        sel = (0, 1, 2, 4) if lo else range(5)
        I["uarm"] = loft(ua, [cs[i] for i in sel], [pr[i] for i in sel], F, "uarm", caps=(False, True), cap_uv="bisque")
        parts.append(("upper" + sd, "sh" + sd, ua))
        if sd == "L" and not lo:                  # the broken stump left when the forearm goes (stage 2)
            st = MB("stump")
            c0 = V((0.172, 0.005, 1.160))
            top = [c0 + V((x, -y, 0)) for x, y in prof(0.0305, 0.0315, 0.0315, 6, 1)]
            jag = [1.104 + rng.uniform(-0.018, 0.018) for _ in range(6)]
            bot = [c0 + V((x, -y, jag[k] - c0.z)) for k, (x, y) in enumerate(prof(0.0290, 0.0295, 0.0295, 6, 1))]
            x0, y0, w, h = REG["stump"]
            for k in range(6):
                k1 = (k + 1) % 6
                cos = [top[k], top[k1], bot[k1], bot[k]]
                u0, u1 = k / 6, (k + 1) / 6
                uvs = [pg(x0 + u0 * w + 0.3, y0 + 0.5), pg(x0 + u1 * w - 0.3, y0 + 0.5),
                       pg(x0 + u1 * w - 0.3, y0 + (1.160 - jag[k1]) / 0.08 * h), pg(x0 + u0 * w + 0.3, y0 + (1.160 - jag[k]) / 0.08 * h)]
                ctr = sum(cos, V()) / 4
                st.face(cos, uvs, V((ctr.x - c0.x, ctr.y - c0.y, 0)))
            st.face(bot, [swuv("bisque")] * 6, V((0, 0, -1)))
            parts.append(("stump", "shL", st))
        fa = MB("fore" + sd)
        cs = [(sx * 0.172, 0.005, 1.162), (sx * 0.172, 0.000, 1.080), (sx * 0.170, -0.004, 0.893),
              (sx * 0.167, -0.008, 0.846), (sx * 0.162, -0.014, 0.800), (sx * 0.146, -0.034, 0.736)]
        if lo:
            pr = [prof(0.029, 0.030, 0.030, 4, 1), prof(0.018, 0.021, 0.021, 4, 1), prof(0.014, 0.041, 0.041, 4, 1),
                  prof(0.008, 0.033, 0.033, 4, 1)]
            cs = [cs[0], cs[2], cs[4], cs[5]]
            I_ = loft(fa, cs, pr, F, "farm", caps=(False, True), cap_uv="glaze")
        else:
            pr = [prof(0.029, 0.030, 0.030, 6, 1), prof(0.031, 0.031, 0.030, 6, 1), prof(0.018, 0.021, 0.021, 6, 1),
                  flatprof(0.015, 0.042), flatprof(0.014, 0.041), flatprof(0.008, 0.033)]
            I["farm"] = loft(fa, cs, pr, F, "farm", caps=(False, True), cap_uv="glaze")
            loft(fa, [(sx * 0.158, -0.036, 0.872), (sx * 0.151, -0.053, 0.842), (sx * 0.147, -0.057, 0.812)],
                 [boxprof(0.0095, 0.0085), boxprof(0.0090, 0.0080), boxprof(0.0070, 0.0065)], F, "thumb",
                 caps=(False, True), cap_uv="glaze", tag=1)
        parts.append(("fore" + sd, "el" + sd, fa))

    # ---- legs: thighs under the skirt, shins with a front ridge, pointed low-heeled pumps
    for sd, sx in (("L", 1), ("R", -1)):
        tb = MB("thigh" + sd)
        I["thigh"] = loft(tb, [(sx * 0.083, 0.0, 0.965), (sx * 0.086, -0.004, 0.495)],
                          [prof(0.064, 0.066, 0.068, n6, 1), prof(0.047, 0.050, 0.048, n6, 1)], F, "thigh")
        parts.append(("thigh" + sd, "hip" + sd, tb))
        sb = MB("shin" + sd)
        cs = [(sx * 0.086, -0.004, 0.538), (sx * 0.087, 0.004, 0.395), (sx * 0.089, 0.010, 0.080)]
        pr = [prof(0.048, 0.052, 0.047, n6, 1), prof(0.048, 0.050, 0.053, n6, 1), prof(0.023, 0.025, 0.026, n6, 1)]
        I["shin"] = loft(sb, cs, pr, F, "shin")
        x = sx * 0.090
        sh = [(x, 0.036, 0.076), (x, -0.034, 0.052), (x, -0.104, 0.024), (x, -0.150, 0.012)]
        spr = [shoeprof(0.024, 0.030), shoeprof(0.033, 0.030), shoeprof(0.032, 0.017), shoeprof(0.007, 0.005)]
        if lo:
            trap = lambda w, h: [[-w, -h], [-w * 0.7, h], [w * 0.7, h], [w, -h]]
            sh, spr = [sh[0], sh[3]], [trap(0.028, 0.03), trap(0.007, 0.005)]
        I["shoe"] = loft(sb, sh, spr, U, "shoe", caps=(True, True), cap_uv="cobalt", tag=1)
        if not lo:
            loft(sb, [(x, 0.030, 0.052), (x, 0.026, 0.0)], [boxprof(0.013, 0.012), boxprof(0.010, 0.010)], F, "heel",
                 caps=(False, True), cap_uv="black", tag=2)
        parts.append(("shin" + sd, "kn" + sd, sb))
    return parts, I


def build_teacup():
    mb = MB("teacup")
    n = 8
    x0, y0, w, h = REG["cup"]
    cup = [(0.0195, 0.0095), (0.031, 0.021), (0.0375, 0.036), (0.0418, 0.058), (0.0388, 0.0572), (0.0335, 0.036), (0.018, 0.021)]
    rows = [0.0, 0.2, 0.45, 0.78, 0.82, 0.93, 1.0]
    lathe(mb, cup, n, "cup", caps=((-1, "glaze"), (1, lambda p: pg(x0 + w / 2 + p.x / 0.02 * 3, y0 + h - 3 + p.y / 0.02 * 2))), rows=rows)
    sx0, sy0, sw, shh = REG["saucer"]
    sau = [(0.028, 0.0), (0.060, 0.0100), (0.066, 0.0145), (0.063, 0.0168), (0.036, 0.0102), (0.021, 0.0093)]
    lathe(mb, sau, n, (sx0, sy0, sw, 32), a0=TAU / 16, caps=((-1, "glaze"), (1, "glaze")), tag=1)
    loft(mb, [(0.039, 0, 0.051), (0.054, 0, 0.049), (0.057, 0, 0.036), (0.047, 0, 0.025), (0.034, 0, 0.023)],
         [boxprof(0.0042, 0.0030)] * 5, V((0, -1, 0)), (sx0, sy0 + 32, sw, 8), caps=(False, False), tag=2)
    return mb


def build_base():
    mb = MB("figbase")
    lathe(mb, [(0.052, 0.0), (0.050, 0.019), (0.046, 0.0225)], 10, "figbase",
          caps=((-1, "black"), (1, "cobalt")), rows=[0.0, 0.75, 1.0])
    return mb


# ---------------------------------------------------------------- export (STYLE.md / models.js format)

def mesh_arrays(ob, origin):
    """Per-corner arrays in three.js space relative to `origin` (Blender coords),
    identical corners deduplicated. The mesh must be in its rest placement."""
    me = ob.data
    me.calc_loop_triangles()
    mw = ob.matrix_world
    rot = mw.to_3x3().normalized()
    uvl = me.uv_layers.active.data
    cn = me.corner_normals
    keys, pos, nrm, uv, idx = {}, [], [], [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            co = mw @ me.vertices[me.loops[li].vertex_index].co - origin
            nn = (rot @ V(cn[li].vector)).normalized()
            u, v = uvl[li].uv
            k = (round(co.x, 4), round(co.z, 4), round(-co.y, 4), round(nn.x, 3), round(nn.z, 3), round(-nn.y, 3),
                 round(u, 4), round(1 - v, 4))
            if k not in keys:
                keys[k] = len(keys)
                pos += k[0:3]; nrm += k[3:6]; uv += k[6:8]
            idx.append(keys[k])
    return {"pos": pos, "nrm": nrm, "uv": uv, "idx": idx}


def export(boss, props, drops, skirt_mid, tris):
    os.makedirs(MODELS, exist_ok=True)
    joints = {}
    for n, par, p in JOINTS:
        joints[n] = {"parent": par, "pos": [round(x, 4) for x in p]}
    parts = []
    for name, joint, ob in boss:
        parts.append({"name": name, "joint": joint, **mesh_arrays(ob, JABS[joint])})
    for name, ob in props:
        parts.append({"name": name, "joint": None, **mesh_arrays(ob, V((0, 0, 0)))})
    data = {
        "version": 1, "texture": "kintsugi.png", "emissive": "kintsugi_glow.png", "joints": joints, "parts": parts,
        "meta": {
            "style": STYLE, "tris": tris,
            "boss": [p[0] for p in boss],
            "drop": drops,                                   # part -> damage stage that removes it
            "showAt": {"hollow": 1, "stump": 2},             # part -> stage from which it shows
            "attach": {"hollow": "face", "stump": "upperL"},  # ride on that chunk (same joint space)
            "skirt": skirt_mid,                              # shard -> hinge mid angle (from +Z toward +X)
            "skirtHinge": SKIRT_HINGE,                       # hinge height relative to the hips joint
            "props": {"figurine": ["figurine", "figbase"], "teacup": ["teacup"]},
            "figurine": {"height": round(FIG_H + BASE_H, 3), "base": BASE_H},
        },
    }
    path = os.path.join(MODELS, "kintsugi.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"[kintsugi] export -> {path} ({os.path.getsize(path) // 1024} KB, {len(parts)} parts)")


# ---------------------------------------------------------------- baked light and painted gloss

def bake(objs):
    """AO + object-space normals baked onto the page (see z_ps1b.bake_light)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    kit.cycles_gpu()
    sc.cycles.samples = 128
    sc.cycles.use_denoising = False
    w = kit.world((1, 1, 1), 1.0)
    try:
        w.light_settings.distance = 0.12
    except Exception as e:
        print("ao distance:", e)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0))])
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
            bpy.ops.object.bake(type="AO", margin=3, use_clear=True)
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="OBJECT", margin=3, use_clear=True)
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
    light = 1.18 * (ao ** 0.75 * (0.52 + 0.10 * sky) + 0.40 * dk * ao ** 0.4 + 0.12 * dr * ao ** 0.4)
    # glaze gloss: reflections of the bulb overhead as seen from the front, and a side sheen
    h1 = np.array([0.0, -0.86, 0.52]); h1 /= np.linalg.norm(h1)
    h2 = np.array([0.62, -0.30, 0.72]); h2 /= np.linalg.norm(h2)
    n2 = nrm.copy(); n2[..., 0] = np.abs(n2[..., 0])
    spec = np.maximum(np.clip(nrm @ h1, 0, 1), 0.92 * np.clip(n2 @ h2, 0, 1)) * np.clip(ao * 1.4, 0, 1)
    print("[kintsugi] light percentiles 10/50/90:", np.percentile(light[ao > 0.01], [10, 50, 90]).round(2))
    return light, spec


# ---------------------------------------------------------------- painting helpers

MATS = ["glaze", "cobalt", "gold", "bisque"]


def grid_reg(name, mats, xr, yr, P_=None, seed=0):
    """Reg over a region with X spanning xr and Y spanning yr (metres, linear)."""
    x0, y0, w, h = REG[name]
    xs = xr[0] + (np.arange(w) + 0.5) / w * (xr[1] - xr[0])
    ys = yr[0] + (np.arange(h) + 0.5) / h * (yr[1] - yr[0])
    X, Y = np.meshgrid(xs, ys)
    return Reg(name, mats, X, Y, P_, abs(xr[1] - xr[0]) / w, abs(yr[1] - yr[0]) / h, seed)


def rose(r, x, y, rad, seed):
    """A cobalt rose: petals, a dark heart, white curls, two leaves."""
    rg = np.random.default_rng(seed)
    r.blob(x, y, rad, rad * 0.9, "cobalt", 1.0, rough=0.2)
    r.blob(x, y, rad * 0.62, rad * 0.56, "glaze", 1.0, rough=0.0)          # white gap between petal rings
    r.blob(x, y, rad * 0.48, rad * 0.43, "cobalt", 0.66, rough=0.1)        # dark heart
    for k in range(2):
        a0 = rg.uniform(0, TAU); rr = rad * (0.66 - 0.28 * k)
        pts = [(x + rr * math.cos(a0 + t), y + rr * 0.9 * math.sin(a0 + t)) for t in np.linspace(0, 2.4, 6)]
        r.line(pts, 0.42 * min(r.tx, r.ty), "glaze", 0.95)
    for k in range(3):
        a = rg.uniform(0, TAU)
        lx, ly = x + math.cos(a) * rad * 1.5, y + math.sin(a) * rad * 1.35
        r.blob(lx, ly, rad * 0.55, rad * 0.34, "cobalt", 1.22, rough=0.15)


def blossom(r, x, y, rad):
    for k in range(5):
        a = k * TAU / 5
        r.blob(x + math.cos(a) * rad, y + math.sin(a) * rad, rad * 0.62, rad * 0.62, "cobalt", 1.15, rough=0.0)
    r.blob(x, y, rad * 0.4, rad * 0.4, "glaze", 1.1, rough=0.0)


def spray(r, x, y, scale, seed):
    """A cluster of the cobalt print: a rose, a vine with leaves, blossoms and dots."""
    rg = np.random.default_rng(seed)
    rose(r, x, y, 0.034 * scale, seed)
    for v in range(2):
        a = rg.uniform(0, TAU); pts = [(x, y)]
        for k in range(4):
            a += rg.uniform(-0.7, 0.7)
            pts.append((pts[-1][0] + math.cos(a) * 0.030 * scale, pts[-1][1] + math.sin(a) * 0.030 * scale))
        r.line(pts, 0.45 * min(r.tx, r.ty), "cobalt")
        for p in pts[2:4]:
            r.blob(p[0], p[1], 0.010 * scale, 0.006 * scale, "cobalt", 1.2, rough=0.0)
        blossom(r, pts[-1][0], pts[-1][1], 0.007 * scale)
    for k in range(4):
        r.blob(x + rg.uniform(-2, 2) * 0.04 * scale, y + rg.uniform(-2, 2) * 0.04 * scale, 0.0045 * scale, 0.0045 * scale,
               "cobalt", 1.1, rough=0.0)


def seam(r, pts, glint_every=5):
    """A gold kintsugi seam along a polyline (~1 texel), with the odd bright glint."""
    w = 0.6 * max(r.tx, r.ty)
    r.line(pts, w, "gold", 1.0)
    for p in pts[1::glint_every]:
        r.fix(p[0], p[1], "gold", 2)


def crack(r, x, y, ang, length, seed, branch=True):
    rg = np.random.default_rng(seed)
    step = 2.2 * max(r.tx, r.ty)
    pts = [(x, y)]
    for k in range(max(2, int(length / step))):
        ang += rg.uniform(-0.55, 0.55)
        pts.append((pts[-1][0] + math.cos(ang) * step, pts[-1][1] + math.sin(ang) * step))
    seam(r, pts)
    if branch and len(pts) > 6:
        j = int(rg.integers(2, len(pts) - 3))
        crack(r, pts[j][0], pts[j][1], ang + rg.choice([-1, 1]) * 1.1, length * 0.4, seed + 1, False)
    return pts


def jag_line(r, x, y0, y1, seed, amp=0.7):
    """A near-vertical seam from y0 to y1 at x (a break line between chunks)."""
    rg = np.random.default_rng(seed)
    n = max(2, int(abs(y1 - y0) / (2.0 * r.ty)))
    pts = [(x + rg.uniform(-amp, amp) * r.tx, y0 + (y1 - y0) * k / n) for k in range(n + 1)]
    seam(r, pts)


def ring_seam(r, y, seed, amp=1.0):
    """A seam running round a wrapped region at height y."""
    rg = np.random.default_rng(seed)
    n = max(4, int(r.P / (2.2 * r.tx)))
    pts = [(-r.P / 2 + r.P * k / n, y + rg.uniform(-amp, amp) * r.ty) for k in range(n + 1)]
    seam(r, pts)


def strands(r, freq, where, axis="x", phase=0.0):
    """Porcelain hair: sculpted strand grooves as light/dark pairs."""
    coord = r.X if axis == "x" else r.Y
    s = np.sin(coord * freq + phase + 0.8 * r.nz)
    r.lit((s > 0.55) * where, 1.14)
    r.lit((s < -0.55) * where, 0.84)


# ---------------------------------------------------------------- region painters

def paint_skirt(I):
    Pm = 1.45
    r = grid_reg("skirt", MATS, (-Pm / 2, Pm / 2), (0, 0.55), Pm, seed=201)
    for k, (x, y) in enumerate(((0.02, 0.17), (0.30, 0.30), (-0.34, 0.24), (0.56, 0.14), (-0.62, 0.36),
                                (0.12, 0.42), (-0.14, 0.08), (0.70, 0.40))):
        spray(r, x, y, 1.55 if k % 2 == 0 else 1.2, 300 + k)
    r.lit(np.clip(1 - r.Y / 0.05, 0, 1), 0.78)                           # under the yoke
    for k in range(8):                                                    # the shard break lines, mended
        jag_line(r, (k / 8) * Pm - (Pm if k / 8 >= 0.5 else 0), 0.0, 0.50, 400 + k)
    for k, (x, y, a) in enumerate(((0.2, 0.2, 2.2), (-0.45, 0.30, 0.5), (0.45, 0.42, 3.4), (-0.2, 0.45, -0.3))):
        crack(r, x, y, a, 0.16, 420 + k)
    for poly in I["skirt_outline"]:                                        # broken hem: bare bisque edge
        pts = [((u - 0.5) * Pm, row / 72 * 0.55) for u, row in poly]
        r.line(pts, 0.75 * r.ty, "bisque", 1.0)
    return r


def paint_head(I):
    info = I["head"]
    x0, y0, W, H = REG["head"]
    qf, qb = info["Q"][2]
    c = np.arange(W) + 0.5
    xc = np.where(c < HEAD_FC, c / HEAD_FC * qf, qf + (c - HEAD_FC) / (W - HEAD_FC) * qb)
    HZ = [q[0] for q in HEADR]
    zr = np.interp(np.arange(H) + 0.5, HEAD_ROWS, HZ)
    X, Z = np.meshgrid(xc, zr)
    r = Reg("head", ["glaze", "cobalt", "gold", "socket", "tooth"], X, 1.8 - Z, None, qf / HEAD_FC, 0.0024, seed=11)
    zz = lambda z: 1.8 - z
    E = lambda a, b, rx, rz: ell(X, Z, a, b, rx, rz)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    r.lit(np.clip((X - 0.07) / 0.05, 0, 1) * (X < qf + 0.01), 0.86)       # sides turn away
    r.lit(soft(E(0.0, 1.70, 0.06, 0.02)), 1.1)                            # forehead
    r.lit((Z > 1.667) & (Z < 1.679) & (X < 0.07), 1.22)                   # brow ridge top plane
    r.lit(soft(E(0.064, 1.625, 0.026, 0.010)), 1.25)                      # cheekbones
    r.lit(soft(E(0.060, 1.594, 0.024, 0.014), 0.6), 0.7)                  # gaunt hollows
    r.lit(soft(E(0.078, 1.655, 0.016, 0.022), 0.6), 0.8)                  # temples
    # empty black sockets, a shadowed rim
    EX, EZ = 0.035, 1.648
    sock = E(EX, EZ, 0.0215, 0.0185) + 0.07 * r.nz
    r.lit(soft(sock, 0.5) * (sock < 1.45), 0.7)
    r.put(sock < 1, "socket")
    # the nasal hole: an inverted heart
    nas = np.minimum(E(0.0045, 1.620, 0.0065, 0.0105), E(0.0, 1.613, 0.004, 0.006))
    r.put(nas < 1, "socket")
    r.lit(E(0.0, 1.608, 0.012, 0.004) < 1, 0.75)
    # lipless painted teeth, upper and lower rows
    for (za, zb, xm) in ((1.5875, 1.5985, 0.027), (1.5745, 1.5855, 0.023)):
        tt = (X < xm) & (Z > za) & (Z < zb)
        r.put(tt, "tooth")
        r.lit(tt & (Z > zb - 0.0035), 1.15)
        for k in range(0, 6):
            r.lit(tt & (np.abs(X - (0.0028 + k * 0.0056)) < 0.0009), 0.42)
    r.put((X < 0.026) & (Z > 1.5855) & (Z < 1.5875), "socket")             # the bite line
    r.lit((X < 0.03) & (Z >= 1.5985) & (Z < 1.6015), 0.6)
    r.put((np.abs(X - 0.029) < 0.0025) & (Z > 1.577) & (Z < 1.597), "socket")   # mouth corners
    r.line([(0.03, zz(1.566)), (qf, zz(1.602))], 0.003, f=0.8)             # jaw line
    r.lit(np.clip((1.557 - Z) / 0.01, 0, 1), 0.66)
    r.lit(soft(E(0.0, 1.567, 0.016, 0.006)), 1.15)                         # chin
    # hair: the sides above the ears and the whole back quarter, sculpted strands
    hair = ((X > qf - 0.012) & (Z > 1.60)) | (X > qf + 0.004) | ((X > 0.066) & (Z > 1.672))
    strands(r, 330.0, hair)
    r.lit(hair * np.clip((1.64 - Z) / 0.04, 0, 1), 0.8)
    # kintsugi: down the brow to the nose, the cheeks to the jaw, a temple into the hair
    seam(r, [(0.002, zz(1.705)), (0.006, zz(1.692)), (0.002, zz(1.680)), (0.007, zz(1.668)), (0.003, zz(1.655)),
             (0.009, zz(1.640)), (0.006, zz(1.632))], 3)
    seam(r, [(0.009, zz(1.606)), (0.004, zz(1.601))], 3)
    seam(r, [(0.043, zz(1.631)), (0.050, zz(1.618)), (0.057, zz(1.611)), (0.066, zz(1.598)), (0.071, zz(1.584)),
             (0.078, zz(1.572))], 3)
    seam(r, [(0.055, zz(1.664)), (0.068, zz(1.676)), (0.083, zz(1.684)), (0.096, zz(1.700))], 3)
    for (bx, bz) in ((0.080, 1.628),):                                     # a cobalt blossom on each cheek
        for k in range(5):
            a = k * TAU / 5 + 0.3
            r.put(E(bx + math.cos(a) * 0.0042, bz + math.sin(a) * 0.0042, 0.0028, 0.0028) < 1, "cobalt")
        r.put(E(bx, bz, 0.0016, 0.0016) < 1, "gold")
    return r


def paint_crown(I):
    R = CROWN_R
    r = grid_reg("crown", ["glaze", "gold", "cobalt"], (-R, R), (-R, R), None, seed=21)
    X, Y = r.X, r.Y
    ang = np.arctan2(X, -Y)
    rad = np.hypot(X, Y)
    s = np.sin(ang * 16 + 30 * rad + 0.6 * r.nz)
    r.lit((s > 0.5) & (rad > 0.012), 1.13)
    r.lit((s < -0.5) & (rad > 0.012), 0.85)
    r.lit((np.abs(X) < 0.9 * r.tx) & (Y < -0.01), 0.7)                     # centre parting
    # the cap's break lines: front centre and left side radial edges, and its brow edge
    def radial(a, seed):
        rg = np.random.default_rng(seed)
        pts = [(math.sin(a) * t + rg.uniform(-0.5, 0.5) * r.tx, -math.cos(a) * t + rg.uniform(-0.5, 0.5) * r.ty)
               for t in np.linspace(0.004, 0.092, 14)]
        seam(r, pts, 4)
    radial(0.0, 31); radial(math.pi / 2, 32)
    rg = np.random.default_rng(33)
    pts = [(math.sin(a) * 0.089 * (1 + rg.uniform(-0.03, 0.03)), -math.cos(a) * 0.089 * (1 + rg.uniform(-0.03, 0.03)))
           for a in np.linspace(0, math.pi / 2, 12)]
    seam(r, pts, 4)
    crack(r, -0.03, 0.02, 2.0, 0.07, 34)
    blossom(r, -0.055, -0.04, 0.005)
    return r


def paint_roll(I):
    x0, y0, w, h = REG["roll"]
    r = grid_reg("roll", ["glaze", "gold"], (-0.11, 0.11), (0, 0.125), 0.22, seed=41)
    strands(r, 150.0, np.ones_like(r.X), "x")
    r.lit(np.abs(r.X) > 0.075, 0.82)                                      # underside against the head
    crack(r, 0.01, 0.02, 1.4, 0.1, 42)
    return r


def paint_rollend():
    r = grid_reg("rollend", ["glaze", "gold"], (-1, 1), (-1, 1), None, seed=43)
    rad, ang = np.hypot(r.X, r.Y), np.arctan2(r.Y, r.X)
    spiral = ((rad * 2.6 - ang / TAU) % 1.0) < 0.3
    r.lit(spiral * (rad < 0.95), 0.62)
    r.lit((rad < 0.2), 0.8)
    return r


def paint_hairback(I):
    r = P["loft_reg"]("hairback", I["hairback"], ["glaze", "gold"], 45)
    strands(r, 150.0, np.ones_like(r.X), "x")
    r.lit(np.abs(r.X) > r.P * 0.3, 0.82)
    ring_seam(r, 0.08, 46)
    return r


def paint_neck(I):
    r = P["loft_reg"]("neck", I["neck"], ["glaze", "gold"], 51)
    Lt = r.Y.max()
    r.lit(np.clip(1 - r.Y / 0.05, 0, 1), 0.62)                           # under the jaw
    r.lit(np.clip((r.Y - Lt + 0.03) / 0.03, 0, 1), 0.8)                   # collar shadow
    for sg in (-1, 1):
        r.line([(sg * 0.03, 0.03), (sg * 0.008, Lt - 0.01)], 0.004, f=1.16)
    ring_seam(r, 0.045, 52)
    return r


def paint_chest(I):
    r = P["loft_reg"]("chest", I["chest"], MATS, 61)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    # the collar flaps (their outer edges trimmed in cobalt) and their shadow
    for sg in (-1, 1):
        a, b, c = (sg * 0.010, 0.004), (sg * 0.080, 0.030), (sg * 0.053, 0.104)
        r.line([b, c, a], 0.8 * tx, "cobalt")
    r.lit((Y < 0.012), 0.7)
    r.lit((ax < 0.9 * tx) & (Y > 0.1) & (Y < 0.36), 0.78)                 # placket
    for by in (0.13, 0.19, 0.25):
        r.blob(1.5 * tx, by, 0.0075, 0.0070, "gold", 1.0, rough=0.0)
        r.lit(ell(X, Y, 1.5 * tx, by + 0.009, 0.008, 0.003) < 1, 0.7)
    r.lit((Y < 0.045) & (ax > 0.09) & (ax < r.P * 0.3), 1.14)             # padded shoulder tops
    r.line([(-0.10, 0.232), (-0.03, 0.246), (0.0, 0.238), (0.03, 0.246), (0.10, 0.232)], 1.0 * ty, f=0.72)  # under the bust
    for sg in (-1, 1):                                                    # waist darts
        r.fold((sg * 0.05, 0.26), (sg * 0.045, 0.40))
    for k, (x, y) in enumerate(((0.085, 0.16), (-0.07, 0.30), (0.20, 0.30), (-0.22, 0.12), (r.P / 2 - 0.05, 0.22),
                                   (r.P / 2 + 0.12, 0.34))):
        spray(r, x, y, 0.75, 600 + k)
    crack(r, -0.03, 0.12, 1.2, 0.2, 610)
    crack(r, 0.16, 0.05, 1.9, 0.18, 611)
    crack(r, r.P / 2 - 0.1, 0.1, 1.5, 0.25, 612)
    ring_seam(r, 0.405, 613, 0.6)
    return r


def paint_waist(I):
    r = P["loft_reg"]("waist", I["waist"], MATS, 71)
    X, Y = r.X, r.Y
    belt = (Y > 0.040) & (Y < 0.093)
    r.put(belt, "cobalt")
    r.lit(belt & (Y < 0.047), 1.25)
    r.lit(belt & (Y > 0.086), 0.7)
    bk = (np.abs(X) < 0.02) & (Y > 0.046) & (Y < 0.088)
    r.put(bk, "gold")
    r.put((np.abs(X) < 0.009) & (Y > 0.056) & (Y < 0.078), "cobalt")
    r.lit((np.abs(X) < 0.009) & (Y > 0.056) & (Y < 0.078), 0.6)
    r.lit(Y < 0.02, 0.8)
    crack(r, r.P / 2, 0.01, 1.4, 0.06, 72, False)
    return r


def paint_yoke(I):
    r = P["loft_reg"]("yoke", I["yoke"], MATS, 81)
    X, Y = r.X, r.Y
    ph = 2 * np.pi * X / 0.045 + 1.3 * np.sin(X * 23.0)
    g = np.clip((Y - 0.03) / 0.05, 0, 1)
    r.lit(g * np.clip(np.sin(ph), 0, 1), 1.15)
    r.lit(g * np.clip(-np.sin(ph), 0, 1), 0.8)
    r.lit(Y < 0.012, 0.72)
    spray(r, -0.08, 0.06, 0.7, 82); spray(r, 0.2, 0.07, 0.7, 83); spray(r, r.P / 2, 0.05, 0.7, 84)
    crack(r, 0.05, 0.01, 1.5, 0.09, 85)
    return r


def paint_uarm(I):
    r = P["loft_reg"]("uarm", I["uarm"], MATS, 91)
    X, Y = r.X, r.Y
    d = I["uarm"]["d"]
    cuff = d[2]
    r.lit((Y < cuff) * np.clip(1 - Y / 0.03, 0, 1), 0.8)                  # gathers at the shoulder
    ph = 2 * np.pi * X / 0.04
    r.lit((Y < 0.03) * np.clip(np.sin(ph), 0, 1), 1.15)
    spray(r, 0.0, 0.055, 0.6, 92)
    r.put((Y > cuff - 0.012) & (Y < cuff + 0.002), "cobalt")               # cuff trim
    r.lit((Y > cuff + 0.002) & (Y < cuff + 0.02), 0.72)                    # shadow under the puff
    crack(r, 0.0, cuff + 0.03, 1.3, 0.12, 93)
    ring_seam(r, d[-1] - 0.012, 94, 0.8)
    return r


def paint_farm(I):
    r = P["loft_reg"]("farm", I["farm"], MATS, 101)
    X, Y = r.X, r.Y
    d = I["farm"]["d"]
    wrist, knuck = d[2], d[4]
    r.lit(np.clip(1 - Y / 0.03, 0, 1), 0.72)                              # into the elbow
    ring_seam(r, wrist - 0.004, 102, 0.7)
    crack(r, 0.0, 0.03, 1.4, 0.16, 103)
    # fingers: gaps down both broad faces of the hand, knuckle ridges
    U = X / r.P + 0.5
    hand = Y > wrist
    fing = Y > knuck - 0.006
    for c0, c1 in ((0.148, 0.352), (0.648, 0.852)):
        for j in (1, 2, 3):
            uc = c0 + (c1 - c0) * j / 4
            r.lit(fing & (np.abs(U - uc) < 0.012), 0.55)
        r.lit(hand & (np.abs(Y - knuck) < 0.004) & (U > c0) & (U < c1), 1.18)
    r.lit(hand & ((np.abs(U - 0.5) < 0.05) | (U < 0.05) | (U > 0.95)), 0.86)
    return r


def paint_plain(name, info, seed, extra=None):
    r = P["loft_reg"](name, info, MATS, seed)
    r.lit(np.clip(1 - r.Y / 0.03, 0, 1), 0.8)
    if extra:
        extra(r)
    return r


def paint_shin(I):
    def ex(r):
        X, Y = r.X, r.Y
        r.lit((np.abs(X) < 1.2 * r.tx) & (Y > 0.04), 1.12)                 # shin ridge
        r.lit(np.clip(1 - np.abs(Y - 0.03) / 0.03, 0, 1) * (np.abs(X) < 0.04), 1.15)   # knee
        blossom(r, r.P / 2, 0.16, 0.009)
        r.blob(r.P / 2 + 0.02, 0.2, 0.004, 0.004, "cobalt", rough=0.0)
        crack(r, 0.02, 0.1, 1.3, 0.2, 112)
    return paint_plain("shin", I["shin"], 111, ex)


def paint_thigh(I):
    def ex(r):
        crack(r, -0.03, 0.05, 1.5, 0.25, 122)
        r.lit(np.clip((0.12 - r.Y) / 0.12, 0, 1), 0.85)
    return paint_plain("thigh", I["thigh"], 121, ex)


def paint_shoe(I):
    r = P["loft_reg"]("shoe", I["shoe"], MATS, 131)
    X, Y = r.X, r.Y
    U = X / r.P + 0.5
    d = I["shoe"]["d"]
    r.put(np.ones_like(X) > 0, "cobalt")
    vamp = (np.abs(U - 0.5) < 0.16) & (Y < d[1] + 0.012)                   # the foot showing in the pump
    r.put(vamp, "glaze")
    r.lit(vamp, 0.9)
    edge = (np.abs(U - 0.5) < 0.19) & (Y < d[1] + 0.02) & ~vamp
    r.put(edge, "gold")
    r.lit((U < 0.08) | (U > 0.92), 0.7)                                   # sole
    rg = np.random.default_rng(132)
    for k in range(16):
        x, y = rg.uniform(-0.5, 0.5) * r.P, rg.uniform(0.0, Y.max())
        m = ell(X, Y, x, y, 0.004, 0.004) < 1
        r.put(m & ~vamp & ~edge, "glaze")
    return r


def paint_flat(name, mat, f=1.0, grad=None, seed=0):
    x0, y0, w, h = REG[name]
    r = grid_reg(name, [mat, "gold", "glaze", "bisque"], (0, 1), (0, 1), None, seed)
    r.lit(np.full(r.X.shape, 1.0), f)
    if grad:
        r.lit(np.clip(r.Y, 0, 1), grad)
    return r


def paint_stump():
    r = grid_reg("stump", ["glaze", "bisque", "gold"], (0, 1), (0, 1), None, 141)
    r.put(r.Y > 0.22 + 0.1 * r.nz, "bisque")
    r.put((r.Y > 0.14 + 0.1 * r.nz) & (r.Y <= 0.22 + 0.1 * r.nz), "gold")
    r.lit(r.Y > 0.5, 0.8)
    return r


def paint_hollow():
    r = grid_reg("hollow", ["hollow", "bisque"], (-1, 1), (0, 1), None, 151)
    r.lit(np.clip(r.Y, 0, 1), 0.7)
    r.clusters(2.5, 0.45, f=1.25, seed=152)
    return r


def paint_inner():
    r = grid_reg("inner", ["bisque", "hollow"], (0, 1), (0, 1), None, 161)
    r.put(r.Y < 0.35, "hollow")
    r.lit(np.clip(1 - r.Y, 0, 1), 0.8)
    return r


def paint_cup():
    r = grid_reg("cup", MATS, (-0.13, 0.13), (0, 0.12), 0.26, seed=171)
    X, Y = r.X, r.Y
    V_ = Y / 0.12                                                        # 0 foot .. 0.78 lip .. 1 inner bottom
    r.put((V_ > 0.66) & (V_ < 0.72), "cobalt")                            # band under the lip
    r.put((V_ > 0.765) & (V_ < 0.80), "gold")                             # gilt lip
    r.put((V_ < 0.05), "cobalt")                                          # foot ring
    for k, x in enumerate((-0.09, -0.02, 0.05, 0.11)):
        rose(r, x, 0.035 + 0.01 * (k % 2), 0.011, 172 + k)
        blossom(r, x + 0.03, 0.055, 0.004)
    r.lit((V_ > 0.8), 1.45)                                               # inside (lifts the baked cavity AO)
    r.put((V_ > 0.96), "cobalt")
    blossom(r, 0.0, 0.117, 0.004)
    jag_line(r, 0.028, 0.0, 0.094, 175, 0.9)                              # the mended crack: the hint
    jag_line(r, 0.024, 0.094, 0.12, 176, 0.9)
    return r


def paint_saucer():
    r = grid_reg("saucer", MATS, (-0.21, 0.21), (0, 0.08), 0.42, seed=181)
    X, Y = r.X, r.Y
    V_ = Y / 0.08 * 40 / 32                                                # saucer profile rows 0..1 (handle below)
    r.put((V_ > 0.30) & (V_ < 0.46), "cobalt")                            # rim band
    r.put((V_ > 0.46) & (V_ < 0.5), "gold")
    for k in range(6):
        blossom(r, -0.18 + k * 0.07, 0.036 * 32 / 40 * 0.9 + 0.02, 0.005)
    r.put(V_ < 0.1, "cobalt")
    jag_line(r, 0.06, 0.0, 0.064, 182, 1.0)
    handle = V_ > 1.0
    r.put(handle, "glaze")
    r.put(handle & (np.abs(X - 0.0) < 0.04), "gold")
    return r


def paint_figface(I):
    info = I["figface"]
    x0, y0, W, H = REG["figface"]
    qf, qb = info["Q"][1]
    c = np.arange(W) + 0.5
    xc = np.where(c < FIG_FC, c / FIG_FC * qf, qf + (c - FIG_FC) / (W - FIG_FC) * qb)
    zr = np.interp(np.arange(H) + 0.5, FIG_ROWS, [q[0] for q in FIGHEAD])
    X, Z = np.meshgrid(xc, zr)
    r = Reg("figface", ["glaze", "cobalt", "rouge", "socket", "gold"], X, 1.8 - Z, None, qf / FIG_FC, 0.0065, seed=191)
    E = lambda a, b, rx, rz: ell(X, Z, a, b, rx, rz)
    r.put(E(0.032, 1.650, 0.012, 0.005) < 1, "socket")                    # lashes / eyes
    r.put(E(0.030, 1.648, 0.005, 0.004) < 1, "cobalt")
    r.put((E(0.032, 1.667, 0.016, 0.004) < 1) & (Z > 1.667), "socket")     # brows
    r.put(E(0.052, 1.612, 0.012, 0.010) < 1, "rouge")                     # cheeks
    r.lit(E(0.052, 1.612, 0.012, 0.010) < 1, 1.2)
    r.put(E(0.0, 1.588, 0.012, 0.0055) < 1, "rouge")                      # lips
    hair = (X > qf - 0.01) & (Z > 1.60) | (X > qf + 0.004)
    strands(r, 330.0, hair)
    r.lit(np.clip((1.56 - Z) / 0.012, 0, 1), 0.75)
    return r


def paint_figbase():
    r = grid_reg("figbase", ["cobalt", "gold", "glaze"], (0, 1), (0, 1), 1.0, seed=195)
    r.put(r.Y > 0.72, "gold")
    r.lit(r.Y > 0.9, 1.25)
    for k in range(8):
        blossom(r, (k + 0.5) / 8, 0.36, 0.035)
    return r


def paint_page(I, light, spec):
    page = np.zeros((AT, AT, 3)); page[:] = C((20, 20, 24))
    glow = np.zeros((AT, AT, 3))
    synth = lambda h, w, a, b: np.repeat(np.linspace(a, b, h)[:, None], w, 1)
    regs = [(paint_skirt(I), None), (paint_head(I), None), (paint_crown(I), None), (paint_roll(I), None),
            (paint_rollend(), "flat"), (paint_hairback(I), None), (paint_neck(I), None), (paint_chest(I), None),
            (paint_waist(I), None), (paint_yoke(I), None), (paint_uarm(I), None), (paint_farm(I), None),
            (paint_flat("thumb", "glaze"), None), (paint_thigh(I), None), (paint_shin(I), None),
            (paint_shoe(I), None), (paint_flat("heel", "cobalt"), None), (paint_stump(), "flat"),
            (paint_hollow(), "flat"), (paint_inner(), "flat"), (paint_cup(), None), (paint_saucer(), None),
            (paint_figface(I), "flat"), (paint_figbase(), "flat")]
    for r, mode in regs:
        x0, y0, w, h = REG[r.name]
        if mode == "flat":
            lt = synth(h, w, 1.02, 0.86)
        else:
            lt = blur2(light[y0:y0 + h, x0:x0 + w], 0.7, 0.7, wrap=r.P is not None)
            lt = np.where(lt < 0.05, 0.9, lt)                              # unbaked texels (seams, margins)
        sp = spec[y0:y0 + h, x0:x0 + w] if mode is None else np.zeros((h, w))
        streak = lowfreq(np.random.default_rng(sum(map(ord, r.name))), h, w, 2.5)
        glazed = np.isin(r.id, [r.m(mm) for mm in r.mats if mm in ("glaze", "cobalt", "gold", "tooth")])
        r.lit(glazed & (sp > 0.90) & (streak > 0.42), 1.34)                # painted gloss on the glaze
        page[y0:y0 + h, x0:x0 + w] = r.finish(lt)
        if "gold" in r.mats:
            gm = r.id == r.m("gold")
            glow[y0:y0 + h, x0:x0 + w][gm] = GLOW_C
    for name, (x, y, mat, k) in SW.items():
        page[y:y + 8, x:x + 8] = P["RAMP_C"][mat][k]
    return page, glow


# ---------------------------------------------------------------- materials

def page_mat(name, img, gimg, glow=1.2):
    m = P["ps1_mat"](name, img, None, vcol=False)
    m.use_backface_culling = True
    nt = m.node_tree; N, Lk = nt.nodes, nt.links
    add = next(n for n in N if n.type == "ADD_SHADER")
    gt = N.new("ShaderNodeTexImage"); gt.image = gimg; gt.interpolation = "Closest"
    em = N.new("ShaderNodeEmission"); em.name = "Glow"; em.inputs["Strength"].default_value = glow
    Lk.new(gt.outputs["Color"], em.inputs["Color"])
    add2 = N.new("ShaderNodeAddShader")
    for lk in list(add.outputs[0].links):
        to = lk.to_socket
        Lk.remove(lk)
        Lk.new(add2.outputs[0], to)
    Lk.new(add.outputs[0], add2.inputs[0]); Lk.new(em.outputs[0], add2.inputs[1])
    return m


# ---------------------------------------------------------------- build

FIG_H, BASE_H = 0.255, 0.0225
STATE = {}


def build():
    root = kit.empty("KINTSUGI")
    E = make_rig("J_", root)
    parts, I = build_lady(False)
    boss = []
    for name, joint, mb in parts:
        ob = mb.obj()
        ob.name = name; ob.data.name = name
        ob.data.transform(Matrix.Translation(-JABS[joint]))
        ob.parent = E[joint]
        boss.append((name, joint, ob))
    bpy.context.view_layer.update()
    # the figurine: the low-poly build, danced, merged, shrunk onto its base
    froot = kit.empty("FIGRIG")
    FE = make_rig("F_", froot)
    lparts, LI = build_lady(True)
    I["figface"] = LI["head"]
    fobs = []
    for name, joint, mb in lparts:
        ob = mb.obj()
        ob.data.transform(Matrix.Translation(-JABS[joint]))
        ob.parent = FE[joint]
        fobs.append(ob)
    set_pose(FE, {**REST, **DANCE})
    for ob in fobs:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.data.transform(mw)
        ob.matrix_world = Matrix.Identity(4)
    fig = kit.join(fobs, "figurine")
    for e in [froot] + list(FE.values()):
        bpy.data.objects.remove(e)
    S = FIG_H / 1.80
    fig.data.transform(Matrix.Scale(S, 4))
    zmin = min(v.co.z for v in fig.data.vertices)
    fig.data.transform(Matrix.Translation((0, 0, BASE_H - zmin)))
    sharpen(fig)
    base = build_base().obj(); base.name = "figbase"
    cup = build_teacup().obj(); cup.name = "teacup"
    bpy.context.view_layer.update()
    # export the rest pose
    drops = {"cap": 1, "rollL": 1, "foreL": 2, "skirt1": 3, "skirt4": 3, "skirt6": 3}
    skirt_mid = {f"skirt{i}": round((i + 0.5) * TAU / 8, 5) for i in range(8)}
    tri = lambda ob: sum(len(p.vertices) - 2 for p in ob.data.polygons)
    tris = {"boss": sum(tri(o) for n, j, o in boss if n not in ("hollow", "stump")),
            "hollow": tri(bpy.data.objects["hollow"]), "stump": tri(bpy.data.objects["stump"]),
            "figurine": tri(fig) + tri(base), "teacup": tri(cup)}
    print("[kintsugi] tris:", tris)
    export(boss, [("figurine", fig), ("figbase", base), ("teacup", cup)], drops, skirt_mid, tris)
    # bake and paint the page (props away from the lady, the figurine body shares her texels)
    base.location = (-0.9, 0.2, 0); cup.location = (0.9, 0.2, 0)
    for o in (fig, bpy.data.objects["hollow"], bpy.data.objects["stump"]):
        o.hide_render = True                                           # no occluders that aren't there in-game
    bpy.context.view_layer.update()
    bake_objs = [o for n, j, o in boss if n not in ("hollow", "stump")] + [base, cup]
    set_pose(E, {"shL": (0, 0, 0.32), "shR": (0, 0, -0.32)})            # hands clear of the skirt for the AO
    light, spec = bake(bake_objs)
    set_pose(E, {})
    page, glow = paint_page(I, light, spec)
    img = make_image("kintsugi_page", page, "texture_page.png")
    gimg = make_image("kintsugi_glow", glow, "glow_page.png")
    save_png(os.path.join(OUT, "texture_page_x4.png"), page, 4)
    save_png(os.path.join(OUT, "glow_page_x4.png"), glow, 4)
    save_png(os.path.join(MODELS, "kintsugi.png"), page)
    save_png(os.path.join(MODELS, "kintsugi_glow.png"), glow)
    mat = page_mat("PS1B_Kintsugi", img, gimg, 0.8)
    fmat = page_mat("PS1B_KintsugiFig", img, gimg, 0.15)
    for n, j, o in boss:
        kit.assign(o, mat)
        if n in ("hollow", "stump"):
            o.hide_render = True
    for o in (fig, base):
        kit.assign(o, fmat)
    kit.assign(cup, mat)
    for o in (fig, base, cup):
        o.hide_render = True
        o.location = (40, 40, 0)
    set_pose(E, {**REST, **HERO})
    STATE.update(root=root, E=E, fig=fig, base=base, cup=cup, fmat=fmat)
    return root


def stage(root):
    P["stage"](root)


# ---------------------------------------------------------------- extra stills

def ingame(root):
    """At a fighting distance of ~6 m in the bunker: 320x240, murky fog."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 320, 240
    set_pose(STATE["E"], {**REST, "hips": (0, 0.1, 0.04), "hipL": (-0.3, 0, 0), "knL": (0.12, 0, 0), "hipR": (0.24, 0, 0),
                          "knR": (0.4, 0, 0), "shL": (-1.2, 0, 0.3), "shR": (-1.35, 0, -0.3), "elL": (-0.2, 0, 0),
                          "elR": (-0.3, 0, 0), "neck": (-0.25, 0.1, 0.4), "head": (0.1, 0.25, 0.1), "spine": (0.25, 0.1, 0)})
    root.rotation_euler.z = math.radians(-18)
    cam = sc.camera
    cam.data.lens = 24
    cam.data.sensor_fit = "AUTO"
    cam.location = (0.9, -6.1, 1.62)
    kit._aim(cam, (0.15, 0, 1.0))
    for ch in cam.children:
        if ch.name == "FogCard":
            ch.scale = (2.5, 2.5, 1)
    ng = P["fog_group"]()
    mix = ng.nodes.get("FogCols")
    mix.inputs[6].default_value = P["lin"]((5, 8, 7)); mix.inputs[7].default_value = P["lin"]((26, 36, 30))
    ng.nodes.get("Aspect").inputs[1].default_value = (1.333, 1.0, 0.0)
    wmat = P["ps1_mat"]("PS1B_EnvWall", make_image("k_wall", P["paint_wall"]()), "wall", vcol=False, tex_scale=1.6)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((-9, 1.9, 0), (9, 1.9, 0), (9, 1.9, 6.0), (-9, 1.9, 6.0))])
    kit.assign(kit.mesh_obj("Wall", bm, None, smooth=False), wmat)
    dark = P["ps1_mat"]("PS1B_EnvHole", make_image("k_hole", np.full((2, 2, 3), 0.02)), None, vcol=False)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((-2.3, 1.88, 1.0), (-0.9, 1.88, 1.0), (-0.9, 1.88, 2.05), (-2.3, 1.88, 2.05))])
    kit.assign(kit.mesh_obj("Window", bm, None, smooth=False), dark)
    wm = P["ps1_mat"]("PS1B_EnvWoodM", make_image("k_wood", P["paint_wood"]()), None, vcol=False)
    for k, (zc, ang) in enumerate(((1.22, 4), (1.53, -3), (1.84, 5))):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        uvl = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                lp[uvl].uv = uv
        pl = kit.mesh_obj(f"Plank{k}", bm, None, smooth=False)
        pl.scale = (1.62, 0.03, 0.17); pl.location = (-1.6, 1.83, zc); pl.rotation_euler = (0, math.radians(ang), 0)
        kit.assign(pl, wm)
    chalk = P["ps1_mat"]("PS1B_EnvChalk", make_image("k_chalk", np.array([[C((150, 44, 36)), C((120, 34, 30))],
                                                                         [C((126, 38, 32)), C((160, 52, 42))]])), None, vcol=False)
    strokes = [((1.0 + 0.11 * k, 1.42), (1.02 + 0.11 * k, 1.90)) for k in range(4)] + [((0.92, 1.50), (1.44, 1.80))]
    for k, ((xa, za), (xb, zb)) in enumerate(strokes):
        d = V((xb - xa, 0, zb - za)); nrm = V((-d.z, 0, d.x)).normalized() * 0.022
        bm = bmesh.new()
        bm.faces.new([bm.verts.new((p_.x, 1.885, p_.z)) for p_ in (V((xa, 0, za)) - nrm, V((xb, 0, zb)) - nrm,
                                                                    V((xb, 0, zb)) + nrm, V((xa, 0, za)) + nrm)])
        kit.assign(kit.mesh_obj(f"Chalk{k}", bm, None, smooth=False), chalk)
    P["set_fog"]((cam.location - V((0, 0, 1))).length, near_c=0.5, far_c=10.0, near_f=1.5, far_f=6.0)
    for m in bpy.data.materials:
        a = m.node_tree.nodes.get("Ambient") if m.node_tree else None
        if a:
            k_ = 0.55 if m.name.startswith("PS1B_Env") else 0.85
            a.inputs[7].default_value = (P["AMB"] * k_, P["AMB"] * k_, P["AMB"] * k_, 1)
    p = os.path.join(OUT, "ingame.png")
    P["render_native"](p)
    P["post"](p)
    print("[kintsugi] ingame ->", p)


def stage1_still(root):
    """Three-quarter hero at damage stage 1: skull cap and left roll gone, hollow showing."""
    for n in ("cap", "rollL"):
        bpy.data.objects[n].hide_render = True
    bpy.data.objects["hollow"].hide_render = False
    root.rotation_euler.z = math.radians(-35)
    p = os.path.join(OUT, "stage1_three_quarter.png")
    P["render_native"](p)
    P["post"](p)
    for n in ("cap", "rollL"):
        bpy.data.objects[n].hide_render = False
    bpy.data.objects["hollow"].hide_render = True


def props_still():
    """The figurine and a teacup on a crate, close up, glow off and on."""
    sc = bpy.context.scene
    for o in kit.descendants(STATE["root"]):
        o.hide_render = True
    for o in bpy.data.objects:
        if o.name.startswith(("Wall", "Window", "Plank", "Chalk")):
            o.hide_render = True
    fig, base, cup = STATE["fig"], STATE["base"], STATE["cup"]
    for o in (fig, base, cup):
        o.hide_render = False
    fig.location = base.location = (-0.07, 0.0, 0.9)
    fig.rotation_euler.z = base.rotation_euler.z = math.radians(-25)
    cup.location = (0.12, -0.04, 0.9); cup.rotation_euler.z = math.radians(-40)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uvl].uv = uv
    crate = kit.mesh_obj("Crate", bm, None, smooth=False)
    crate.scale = (0.7, 0.45, 0.9); crate.location = (0, 0.1, 0.45)
    kit.assign(crate, bpy.data.materials["PS1B_EnvWoodM"])
    sc.render.resolution_x, sc.render.resolution_y = 400, 300
    cam = sc.camera
    cam.data.lens = 50
    cam.location = (0.06, -0.72, 1.16)
    kit._aim(cam, (0.02, 0, 1.005))
    P["set_fog"](0.75, near_c=0.5, far_c=6.0, near_f=0.4, far_f=5.0)
    for glow, name in ((0.15, "props.png"), (4.0, "props_glow.png")):
        STATE["fmat"].node_tree.nodes["Glow"].inputs["Strength"].default_value = glow
        p = os.path.join(OUT, name)
        P["render_native"](p)
        P["post"](p)
        print("[kintsugi] props ->", p)


kit.run(STYLE, build, stage, P["post"],
        meta={"technique": "rigid hard-edged segments on the boss rig; 256px page, painted light x Cycles-baked AO/key, "
                           "glaze gloss painted from baked normals, per-material ramps; gold seams on a glow page; "
                           "native 300x400 + composite/CRT post",
              "texture_page": "256x256 + glow", "export": "public/models/kintsugi.json"})

if "--final" in ARGS:
    stage1_still(STATE["root"])
    ingame(STATE["root"])
    props_still()
