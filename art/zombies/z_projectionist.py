# The Projectionist (game id `projectionist`): the Aurora Picture Palace's night projectionist, dead
# in his booth, for the palace horde. Same 1997 disc as the Ghoul, the Mended, the Stoker, the
# Gasser and the Usher (art/STYLE.md). Silhouette and colour first: he is the tall, stooped, thin one
# with a green flat brim, bulging lenses, a pale apron, and amber loops of film.
#
# Design:
#   - gaunt: long neck and forearms, narrow sloping shoulders, a stoop built into the rest pose
#     (the head and shoulders hang forward), a sallow waxy skin, a bald dome, hollow cheeks;
#   - a green celluloid eyeshade (`eyeshade`, a separate headwear part: a headband and a wide
#     curved flat brim over the eyes) and thick round tortoiseshell glasses whose lenses bulge
#     off the face with the eyes glowing icy blue-white behind them (glow page);
#   - a dusty blue-grey knit cardigan over a grey shirt, its shawl collar rolled up round the
#     neck, sleeves shoved up and bunched at the elbows; a pale work apron over it: a bib on the
#     chest with a big pocket, neck straps, a waist band, and two skirt panels hung from the
#     thighs (they swing with the legs) with a tool pocket;
#   - forearms and hands scorched by the carbon arc: blackened palms and fingertips, raw blisters
#     and branching arc scars whose tips glow a faint cold white;
#   - loops of 35 mm film tangled round him: a sash across the chest, a loop at the waist, a spiral
#     round the right forearm with loose tails (amber celluloid, sprocket holes);
#   - charcoal slacks, worn brown crepe-soled shoes.
# Built like the Mended (z_mended.py, through the shared toolkit horde97.py).
#
#   node art/zombies/blend.mjs z_projectionist.py --preview [--views front,side,back] [--walk] [--face] [--ingame]
#   node art/zombies/blend.mjs z_projectionist.py --export   (game model + texture only, no renders)
# Every render run also exports public/models/projectionist.json + .png + _glow.png.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import horde97 as H
from horde97 import (kit, bpy, bmesh, np, V, Matrix, TAU, JW, REG, Reg, loft, loft_reg, grid_reg, poly_obj, bvh, hit,
                     hit_front, hexprof, flatprof, boxprof, tbox, hbox, sym, twist, ell, segd, inpoly, lowfreq, blur2,
                     texel_size, smooth01, C, make_head, make_hand, make_foot, hand_frame, ribbon_polys, preg)

FWD = V((0, -1, 0))
UP_ = V((0, 0, 1))
DN = V((0, 0, -1))

# ---------------------------------------------------------------- CLUT ramps (sRGB, dark -> light)
RAMPS = {
    # dusty blue-grey wool, cool shadows and warm-grey highlights
    "knit": ([(24, 28, 36), (36, 42, 52), (52, 58, 70), (72, 80, 94), (94, 102, 116), (120, 128, 140)], 3),
    "shirtg": ([(58, 58, 62), (102, 102, 104), (150, 148, 142), (190, 186, 170)], 2),
    # pale duck canvas for the apron
    "duck": ([(38, 36, 34), (66, 62, 54), (100, 94, 80), (138, 130, 110), (174, 164, 138), (206, 196, 166)], 3),
    "slacks": ([(20, 18, 18), (32, 29, 28), (46, 42, 40), (62, 57, 52), (82, 76, 68)], 2),
    # sallow, waxy skin
    "skinp": ([(34, 34, 32), (52, 54, 50), (74, 76, 68), (98, 100, 88), (122, 122, 106), (148, 146, 126),
               (174, 170, 146)], 4),
    # scorched skin: char, raw red, blister cream
    "burn": ([(12, 10, 12), (26, 18, 20), (46, 30, 32), (74, 44, 44), (112, 62, 60), (152, 90, 86), (196, 140, 130),
              (226, 190, 176)], 2),
    "film": ([(30, 16, 8), (66, 36, 14), (116, 66, 24), (170, 104, 38), (218, 150, 64), (244, 208, 130)], 3),
    "celluloid": ([(16, 40, 26), (30, 72, 46), (52, 112, 70), (86, 156, 100), (142, 206, 146)], 2),
    "horn": ([(18, 12, 10), (34, 22, 16), (54, 36, 24), (84, 58, 38), (130, 96, 64)], 2),
    "lensglow": ([(24, 44, 62), (60, 108, 140), (120, 176, 206), (196, 230, 246)], 2),
    "crepe": ([(60, 50, 38), (96, 82, 62), (130, 114, 86)], 1),
}
GAIN = {"duck": 1.08, "skinp": 1.06, "slacks": 1.25, "knit": 1.06, "shirtg": 1.2, "celluloid": 1.0}

# ---------------------------------------------------------------- the rig: taller and thinner than the standard
# three.js space, parent-relative. Long forearms and legs, narrow shoulders, the neck pushed forward.
JOINTS = [
    ("body", None, (0.0, 0.0, 0.0)), ("hips", "body", (0.0, 0.97, 0.0)), ("spine", "hips", (0.0, 0.06, 0.0)),
    ("neck", "spine", (0.0, 0.55, 0.035)), ("shL", "spine", (0.25, 0.50, 0.0)), ("shR", "spine", (-0.25, 0.50, 0.0)),
    ("elL", "shL", (0.0, -0.35, 0.0)), ("elR", "shR", (0.0, -0.35, 0.0)),
    ("hipL", "hips", (0.095, -0.04, 0.0)), ("hipR", "hips", (-0.095, -0.04, 0.0)),
    ("knL", "hipL", (0.0, -0.47, 0.0)), ("knR", "hipR", (0.0, -0.47, 0.0)),
]

# ---------------------------------------------------------------- the page (256x256, top-left origin)
PAGE = {
    "head": (0, 0, 128, 96), "torso": (128, 0, 128, 80), "pelvis": (128, 80, 128, 16),
    "shade": (0, 96, 64, 12), "brim": (0, 108, 64, 12), "collar": (64, 96, 48, 16), "film": (112, 96, 32, 16), "band": (144, 96, 64, 8),
    "rims": (144, 104, 32, 16), "lens": (176, 104, 16, 16), "eyes": (192, 104, 16, 8), "hair": (192, 112, 16, 8),
    "ear": (208, 96, 16, 16), "nose": (224, 96, 16, 16), "strap": (240, 96, 16, 8), "neck": (224, 112, 32, 8),
    "thigh.L": (0, 120, 64, 48), "thigh.R": (64, 120, 64, 48), "shin.L": (128, 120, 64, 48), "shin.R": (192, 120, 64, 48),
    "uarm.L": (0, 168, 48, 32), "uarm.R": (48, 168, 48, 32),
    "palm.L": (96, 168, 32, 16), "fing.L": (128, 168, 32, 16), "palm.R": (96, 184, 32, 16), "fing.R": (128, 184, 32, 16),
    "thumb.L": (160, 168, 16, 16), "thumb.R": (160, 184, 16, 16), "foot": (176, 168, 64, 24),
    "farm.L": (0, 200, 48, 48), "farm.R": (48, 200, 48, 48), "panel": (96, 200, 48, 48), "bib": (144, 200, 32, 48),
}
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("eyeshade", "neck"), ("eyes", "neck"),
         ("upperArm.L", "shL"), ("upperArm.R", "shR"), ("lowerArm.L", "elL"), ("lowerArm.R", "elR"),
         ("upperLeg.L", "hipL"), ("upperLeg.R", "hipR"), ("lowerLeg.L", "knL"), ("lowerLeg.R", "knR")]

DZ = 0.018
YC = -0.056
RINGS = [
    (1.806, 0.004, 0.056, 0.064, 0.056, {}),
    (1.782, 0.000, 0.088, 0.098, 0.094, {}),
    (1.730, 0.000, 0.096, 0.102, 0.102, {4: (0.002, 0.008), 5: (0.004, 0.014), 6: (0, 0.008)}),
    (1.708, 0.000, 0.093, 0.100, 0.096, {4: (0, -0.006), 5: (-0.004, -0.020), 6: (0, -0.004)}),
    (1.668, 0.000, 0.092, 0.096, 0.098, {4: (0.012, 0.012), 5: (0.0, -0.004)}),
    (1.622, 0.000, 0.070, 0.084, 0.092, {3: (0, 0, 0.004), 4: (-0.020, -0.014), 5: (-0.014, -0.010), 6: (0, -0.004)}),
    (1.590, 0.000, 0.062, 0.074, 0.090, {0: (0, 0, 0.018), 1: (0, 0, 0.018), 2: (0, 0, 0.012), 3: (0, 0, 0.006),
                                         4: (-0.014, -0.012), 5: (-0.010, -0.004), 6: (0, 0.004)}),
    (1.552, 0.004, 0.036, 0.050, 0.082, {0: (0, 0, 0.034), 1: (0, 0, 0.034), 2: (0, 0, 0.026), 3: (0, 0, 0.016),
                                         4: (-0.012, -0.010), 5: (-0.012, 0.004), 6: (0, 0.016)}),
]
ROWS = (4, 12, 24, 36, 53, 69, 81, 90)
EYE = (0.040, 1.692)
MZ = 1.6045           # the mouth line
JAW_Z = 1.60


def octprof(w, db, df):
    """Eight-sided ring."""
    return sym([[0, -db, 0], [-0.72 * w, -0.72 * db, 0], [-w, 0.0, 0], [-0.72 * w, 0.72 * df, 0], [0, df, 0]])


def radial(tree, cx, cy, z, deg, lift):
    """A point on the surface round a vertical axis through (cx, cy) at height z, at azimuth `deg`
    (0 = front, + = the character's left), lifted along its normal. Returns (point, normal)."""
    a = math.radians(deg)
    d = V((math.sin(a), -math.cos(a), 0))
    loc, n = hit(tree, V((cx, cy, z)) + d * 0.6, -d, lift)
    return loc, n


# ---------------------------------------------------------------- geometry: the parts (rest pose, world)

def build_rest():
    I, G = {}, {}
    hd = make_head(RINGS, ROWS, YC, apex=((0, -0.002, 1.819), (0, 0.012, 1.538)),
                   nose=(0.097, 1.712, 0.140, 1.650, 0.098, 1.636, 0.017),
                   ear=((0.095, -0.004, 1.712), (0.093, -0.010, 1.648), (0.124, -0.032, 1.722), (0.115, -0.036, 1.660)),
                   tufts=((2.30, 0.024), (math.pi, 0.020), (-2.30, 0.024)), tuft_z=1.722, eye=EYE)
    head, I["head"], htree = hd["head"], hd["info"], hd["tree"]
    bpy.data.objects.remove(hd["eyes"], do_unlink=True)       # the eyes sit on the lenses instead
    parts_head = [head, hd["nose"], hd["ears"]] + ([hd["tufts"]] if hd["tufts"] else [])

    # ---- thick round glasses: a hexagonal horn rim, a faceted lens bulging off the face, a bridge and
    # temples; the unlit `eyes` rhombi sit on the lens apexes (the glowing eyes behind the glass)
    gl, eyes = [], []
    rings = {}
    for sx in (1, -1):
        loc, n = hit_front(htree, sx * EYE[0], EYE[1], 0.0)
        if loc is None:
            loc = V((sx * EYE[0], YC - 0.098, EYE[1]))
        a = V((sx * 0.10, -1, 0.0)).normalized()
        u1 = V((1, 0, 0)); u1 = (u1 - a * u1.dot(a)).normalized()
        u2 = a.cross(u1).normalized()
        if u2.z < 0:
            u2 = -u2
        ring = lambda c, R: [c + (u1 * math.cos(k * TAU / 6) + u2 * math.sin(k * TAU / 6)) * R for k in range(6)]
        b_ring, f_ring = ring(loc - a * 0.003, 0.0345), ring(loc + a * 0.019, 0.0335)
        apex = loc + a * 0.031
        rings[sx] = (b_ring, f_ring)
        for k in range(6):
            k1 = (k + 1) % 6
            mid = (b_ring[k] + b_ring[k1] + f_ring[k] + f_ring[k1]) / 4
            gl.append(([b_ring[k], b_ring[k1], f_ring[k1], f_ring[k]],
                       [("rims", k / 6, 0.95), ("rims", (k + 1) / 6, 0.95), ("rims", (k + 1) / 6, 0.05),
                        ("rims", k / 6, 0.05)], tuple(mid - (loc + a * 0.008))))
            uvk = lambda kk: ("lens", 0.5 + 0.47 * math.cos(kk * TAU / 6), 0.5 - 0.47 * math.sin(kk * TAU / 6))
            gl.append(([f_ring[k], f_ring[k1], apex], [uvk(k), uvk(k1), ("lens", 0.5, 0.5)],
                       tuple(a + (f_ring[k] + f_ring[k1]) / 2 - apex)))
        ep = apex + a * 0.0014
        pts = [ep - u1 * 0.0140, ep - u2 * 0.0100, ep + u1 * 0.0140, ep + u2 * 0.0100]
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        eyes.append((pts, [("eyes", u(0.02), 0.5), ("eyes", 0.5, 0.98), ("eyes", u(0.98), 0.5), ("eyes", 0.5, 0.02)],
                     tuple(a)))
    # bridge: over the nose between the two front rings
    Lf, Rf = rings[1][1][3], rings[-1][1][0]
    Lb, Rb = rings[1][0][3], rings[-1][0][0]
    up = V((0, 0, 0.0045))
    gl.append(([Lf + up, Rf + up, Rf - up, Lf - up], [("rims", 0.1, 0.1), ("rims", 0.9, 0.1), ("rims", 0.9, 0.9),
                                                       ("rims", 0.1, 0.9)], (0, -1, 0)))
    # temples: horn arms over the cheekbone to the ears
    for sx in (1, -1):
        b_ring = rings[sx][0]
        outer = b_ring[0] if sx > 0 else b_ring[3]
        pts = [outer]
        for az, z in ((1.10, EYE[1] + 0.006), (1.36, EYE[1] + 0.010), (1.53, EYE[1] + 0.012)):
            d = V((sx * math.sin(az), -math.cos(az), 0))
            loc, _ = hit(htree, V((0, YC, z)) + d * 0.4, -d, 0.0035)
            if loc is not None:
                pts.append(loc)
        gl += ribbon_polys("rims", pts, 0.0085, V((sx, 0, 0)), u0=0.05, u1=0.95, v0=0.3, v1=0.7, back=True)
    G["head"] = parts_head + [poly_obj("glasses", gl)]
    G["eyes"] = [poly_obj("eyes", eyes)]

    # ---- the eyeshade: a headband and a wide, curved, flat brim over the glasses (green celluloid)
    SC = YC + 0.002
    SR = [(1.762, 0.104, 0.108, 0.112), (1.738, 0.106, 0.110, 0.114)]
    band, I["shade"] = loft("shadeband", [(0, SC, z) for z, *_ in SR], [octprof(w, db, df) for z, w, db, df in SR], FWD,
                            REG["shade"], (False, False))
    z0, w0, db0, df0 = SR[0]
    ring = [V((p[0], SC - p[1], z0 + 0.002)) for p in octprof(w0, db0, df0)]
    arc = [2, 3, 4, 5, 6]
    ext = [0.014, 0.052, 0.080, 0.052, 0.014]
    drop = [0.001, 0.006, 0.008, 0.006, 0.001]
    ctr = V((0, SC, 0))
    inner = [ring[k] for k in arc]
    outer = []
    for p, e, dz in zip(inner, ext, drop):
        dr = V((p.x - ctr.x, p.y - ctr.y, 0)).normalized()
        outer.append(p + dr * e + V((0, 0, -dz)))
    lower = [p + V((0, 0, -0.004)) for p in inner]
    brim = []
    for k in range(4):
        uu0, uu1 = k / 4, (k + 1) / 4
        brim.append(([inner[k], inner[k + 1], outer[k + 1], outer[k]],
                     [("brim", uu0, 0.04), ("brim", uu1, 0.04), ("brim", uu1, 0.46), ("brim", uu0, 0.46)], (0, -0.2, 1)))
        brim.append(([lower[k], lower[k + 1], outer[k + 1], outer[k]],
                     [("brim", uu0, 0.96), ("brim", uu1, 0.96), ("brim", uu1, 0.54), ("brim", uu0, 0.54)], (0, -0.2, -1)))
    piv = V((0, SC, z0))
    MS = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(12), 4, "X") @ Matrix.Translation(-piv)
    band.data.transform(MS)
    brim_ob = poly_obj("shadebrim", brim)
    brim_ob.data.transform(MS)
    G["eyeshade"] = [band, brim_ob]

    # ---- torso: a knit cardigan on a stooped, narrow frame; neck; a rolled shawl collar
    TORSO = [(1.598, -0.040, 0.092, 0.066, 0.060, {}),
             (1.572, -0.038, 0.188, 0.092, 0.084, {1: (0, -0.006)}),
             (1.505, -0.030, 0.196, 0.104, 0.100, {}),
             (1.385, -0.014, 0.172, 0.110, 0.104, {}),
             (1.230, 0.004, 0.150, 0.098, 0.094, {}),
             (1.060, 0.010, 0.162, 0.102, 0.098, {}),
             (0.905, 0.012, 0.176, 0.112, 0.108, {})]
    tv = [0.0, 0.03, 0.11, 0.30, 0.55, 0.80, 1.0]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO], [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO],
                             FWD, REG["torso"], (True, False), vs=[1 - c for c in tv], cap_u=0.27)
    neck, I["neck"] = loft("neck", [(0, -0.022, 1.520), (0, -0.050, 1.652)],
                           [hexprof(0.045, 0.047, {3: (0, 0.004)}), hexprof(0.040, 0.043, {3: (0, 0.004)})],
                           FWD, REG["neck"], (False, False))
    collar, I["collar"] = loft("collar", [(0, -0.030, 1.545), (0, -0.050, 1.622)],
                               [octprof(0.100, 0.098, 0.098), octprof(0.070, 0.072, 0.072)], FWD, REG["collar"], (False, False))
    tt = bvh(torso)
    # the apron: a bib hugging the chest, two straps up to the collar
    corners = []
    for z, hw in ((1.470, 0.072), (1.265, 0.084), (1.055, 0.098)):
        row = []
        for sx in (-1, 1):
            p, n = hit_front(tt, sx * hw, z, 0.009)
            row.append(p)
        corners.append(row)
    bib = []
    if all(p is not None for row in corners for p in row):
        for i in range(2):
            (a0, a1), (b0, b1) = corners[i], corners[i + 1]
            v0, v1 = (0.0, 0.49) if i == 0 else (0.49, 1.0)
            bib.append(([a0, a1, b1, b0], [("bib", 0.03, v0 + 0.005), ("bib", 0.97, v0 + 0.005), ("bib", 0.97, v1 - 0.005),
                                            ("bib", 0.03, v1 - 0.005)], (0, -1, 0)))
    straps = []
    for sx in (-1, 1):
        pts = []
        for z, x in ((1.470, 0.062), (1.505, 0.060), (1.545, 0.056), (1.578, 0.050)):
            p, n = hit_front(tt, sx * x, z, 0.010)
            if p is not None:
                pts.append(p)
        if len(pts) > 1:
            straps += ribbon_polys("strap", pts, 0.013, V((0, -1, 0)), back=False)
    # film: a scarf of it round the collar with two long strips hanging down the apron, and a slanting loop
    # round the waist with a loose end
    film = []
    ctree = bvh(collar)
    pts, refs = [], []
    for deg in (-120, -85, -50, -16, 18, 52, 86, 120):
        p, n = radial(ctree, 0.0, -0.042, 1.586, deg, 0.010)
        if p is not None:
            pts.append(p); refs.append(n)
    film += ribbon_polys("film", pts, 0.040, refs, back=False)
    for x0, z1, seed_ in ((0.058, 0.985, 0), (-0.046, 1.215, 1)):
        hp = []
        for k, z in enumerate((1.560, 1.485, 1.385, 1.285, 1.190, 1.095, 0.985)):
            if z < z1 - 0.001:
                break
            sway = x0 + (0.008 if k % 2 else -0.004) * (1 + seed_)
            p, n = hit_front(tt, sway, z, 0.026)
            if p is not None:
                hp.append(p)
        if len(hp) > 1:
            film += ribbon_polys("film", hp, 0.044, V((0, -1, 0)), back=True)
    loop = [(-100, 1.300), (-62, 1.272), (-24, 1.222), (14, 1.165), (52, 1.122), (90, 1.130), (128, 1.172), (166, 1.222),
            (204, 1.272), (236, 1.300)]
    pts, refs = [], []
    for deg, z in loop:
        p, n = radial(tt, 0.0, 0.004, z, deg, 0.034)
        if p is not None:
            pts.append(p); refs.append(n)
    film += ribbon_polys("film", pts, 0.044, refs, back=False)
    if pts:
        e = pts[-1]
        film += ribbon_polys("film", [e, e + V((-0.010, 0.012, -0.10)), e + V((-0.024, 0.020, -0.21)),
                                      e + V((-0.020, 0.010, -0.32))], 0.044, V((1, 0, 0)), back=True)
    G["torso"] = [torso, neck, collar] + [poly_obj("bib", bib)] + ([poly_obj("straps", straps)] if straps else []) + \
                 [poly_obj("filmtorso", film)]

    # ---- pelvis: the slacks' seat, and the apron's waist band
    PEL = [(1.062, 0.008, 0.158, 0.100, 0.096), (0.800, 0.004, 0.150, 0.096, 0.092)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL], [tbox(w, db, df) for z, yc, w, db, df in PEL],
                               FWD, REG["pelvis"], (False, True))
    wband, I["band"] = loft("band", [(0, 0.012, 1.078), (0, 0.012, 1.028)],
                            [octprof(0.178, 0.114, 0.112), octprof(0.180, 0.116, 0.114)], FWD, REG["band"], (False, False))
    G["pelvis"] = [pelvis, wband]

    for sd, sx in (("L", 1), ("R", -1)):
        # ---- upper arm: a knit sleeve shoved up and bunched into a fat cuff at the elbow
        sh = JW["sh" + sd]
        UA = [(0.035, 0.054, 0.056, 0.0, 0), (-0.005, 0.062, 0.062, sx * 0.004, 3), (-0.170, 0.051, 0.053, 0.0, 7),
              (-0.318, 0.064, 0.066, 0.0, 10), (-0.362, 0.062, 0.064, 0.0, 10)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d, dx, tw in UA],
                                   [twist(hexprof(w, d), sx * tw) for z, w, d, dx, tw in UA], FWD, REG["uarm." + sd],
                                   (True, True), cap_u=0.5)
        G["upperArm." + sd] = [ua]

        # ---- forearm: long, thin and scorched, a pointed elbow
        el = JW["el" + sd]
        FA = [(0.045, 0.046, 0.048, {}), (-0.010, 0.050, 0.050, {0: (0, -0.028)}), (-0.110, 0.043, 0.046, {}),
              (-0.252, 0.026, 0.034, {})]
        n_, td_, bk_ = hand_frame(sx)
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d, p), sx * 5 * k) for k, (z, w, d, p) in enumerate(FA)],
                                   [FWD] * (len(FA) - 1) + [td_], REG["farm." + sd], (False, False))
        wr_ = el + V((0, 0, -0.256))
        hd_ = make_hand(sd, sx, wr_, g=1.02, flen=1.28, curl=(24, 66), palm_len=1.05)
        I.update(hd_["info"])
        parts = [fa] + hd_["objs"]
        if sd == "R":
            ftree = bvh(fa)
            sp, refs = [], []
            for k in range(9):
                z = el.z - 0.030 - 0.0225 * k
                p, n = radial(ftree, el.x, el.y, z, -40 + 78 * k, 0.010)
                if p is not None:
                    sp.append(p); refs.append(n)
            fl = ribbon_polys("film", sp, 0.040, refs, back=False)
            if sp:
                e = sp[-1]
                tail = [e, e + V((-0.030, -0.018, -0.05)), e + V((-0.062, -0.024, -0.11)), e + V((-0.082, -0.010, -0.18))]
                fl += ribbon_polys("film", tail, 0.040, V((0, 1, 0)), back=True)
            parts.append(poly_obj("filmarm", fl))
        G["lowerArm." + sd] = parts

        # ---- thigh: a narrow trouser leg; an apron skirt panel hung from it (swings with the leg)
        hp = JW["hip" + sd]
        TG = [(0.060, 0.078, 0.088, {}, 0), (-0.280, 0.072, 0.080, {}, 4), (-0.462, 0.066, 0.072, {3: (0, 0.014)}, 6),
              (-0.496, 0.062, 0.068, {}, 6)]
        tg, I["thigh." + sd] = loft("thigh." + sd, [hp + V((0, 0, z)) for z, *_ in TG],
                                    [twist(hexprof(w, d, p), -sx * tw) for z, w, d, p, tw in TG], FWD, REG["thigh." + sd],
                                    (False, True))
        rows = [(1.040, -0.104, 0.128), (0.830, -0.114, 0.138), (0.610, -0.118, 0.150)]
        pn = []
        for i in range(2):
            for j in range(3):
                def P(ri, cj):
                    z, y, xo = rows[ri]
                    fx = (0.0, 0.36, 0.70, 1.0)[cj]
                    x = sx * (0.004 + (xo - 0.004) * fx)
                    return V((x, y + (0.0, 0.002, 0.014, 0.042)[cj], z))
                uu = lambda cj: (0.03 + 0.94 * cj / 3) if sx > 0 else (0.97 - 0.94 * cj / 3)
                q = [P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)]
                uv = [("panel", uu(j), 0.02 + 0.96 * i / 2), ("panel", uu(j + 1), 0.02 + 0.96 * i / 2),
                      ("panel", uu(j + 1), 0.02 + 0.96 * (i + 1) / 2), ("panel", uu(j), 0.02 + 0.96 * (i + 1) / 2)]
                pn.append((q, uv, (0, -1, 0.05)))
        G["upperLeg." + sd] = [tg, poly_obj("panel", pn)]

        # ---- shin: the slack's leg over a worn crepe-soled shoe
        kn = JW["kn" + sd]
        SN = [(0.040, 0.064, 0.070, {}), (-0.352, 0.052, 0.060, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN], [hexprof(w, d, p) for z, w, d, p in SN],
                                   FWD, REG["shin." + sd], (False, True))
        xf = kn.x + sx * 0.004
        ft, I["foot"] = make_foot(sd, sx, xf, s_max=0.198, toe=0.280, w=(0.046, 0.056, 0.054), tops=(0.084, 0.098, 0.068),
                                  toe_h=0.028, heel=0.086)
        G["lowerLeg." + sd] = [sn, ft]
    return I, G


# ---------------------------------------------------------------- painting helpers

def fern(r, x, y, ang, length, seed, w=None, depth=2, tips=None):
    """A branching arc scar (a Lichtenberg figure): raw red lines fanning out; the tips are collected."""
    rg = np.random.default_rng(seed)
    w = w or 0.5 * r.tx
    step = 1.6 * max(r.tx, r.ty)

    def branch(x, y, ang, length, d):
        n = max(2, int(length / step))
        pts = [(x, y)]
        for i in range(n):
            ang += rg.uniform(-0.30, 0.30)
            x += math.cos(ang) * step * (r.tx / max(r.tx, r.ty))
            y += math.sin(ang) * step * (r.ty / max(r.tx, r.ty))
            pts.append((x, y))
            if d > 0 and i % 2 == 1 and i < n - 1:
                branch(x, y, ang + rg.choice([-1, 1]) * rg.uniform(0.6, 1.0), length * 0.45, d - 1)
        mk = r.line(pts, w)
        r.put(mk, "burn")
        r.lit(mk, 2.4)
        if tips is not None:
            tips.append(pts[-1])
    branch(x, y, ang, length, depth)


def tips_mask(r, tips, rad):
    m = np.zeros((r.h, r.w))
    for (x, y) in tips:
        m = np.maximum(m, r.blob(x, y, rad, rad, None, None, rough=0.0))
    return m > 0.5


def paint_head(name, Ph, seed):
    """Head and face painted in 3D from the baked positions: sallow waxy skin, a bald dome, hollow
    cheeks and temples, a thin dry mouth, the arc's flash-burn round the eyes."""
    x = Ph[..., 0]; Z = Ph[..., 2]; F = YC - Ph[..., 1]
    ax = np.abs(x)
    front = F > 0.035
    Xf = np.where(front, ax, 9.0)
    Xs = np.where(front, x, 9.0)
    phi = np.arctan2(ax, F)
    r = Reg(name, ["skinp", "hollow", "bloodc2", "burn"], Xs, 1.9 - Z, None, 0.003, 0.003, seed=seed)
    E = lambda x0_, z0, rx, rz: np.sqrt(((Xf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    Es = lambda x0_, z0, rx, rz: np.sqrt(((Xs - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    EX, EZ = EYE
    r.lit(soft(E(0.0, 1.735, 0.07, 0.022)), 1.08)
    r.lit(soft(E(0.068, 1.668, 0.026, 0.010)), 1.14)                          # cheekbone tops
    r.lit(soft(E(0.058, 1.622, 0.030, 0.024), 0.6), 0.66)                     # very hollow cheeks
    r.lit(soft(E(0.086, 1.716, 0.016, 0.026), 0.6), 0.72)                     # sunken temples
    r.lit(np.clip((ax - 0.07) / 0.03, 0, 1) * (phi < 1.4), 0.9)
    sock = E(EX, EZ + 0.004, 0.033, 0.023) + 0.10 * r.nz
    r.lit(soft(sock, 0.5) * np.clip(0.55 + (Z - EZ) / 0.025, 0.45, 1), 0.34)
    r.lit((E(0.012, EZ + 0.006, 0.008, 0.012) < 1), 0.72)
    # flash-burn: raw red-brown rings round the eyes, where the arc's glare hit under the glasses
    fb = np.clip(1 - (E(EX, EZ - 0.004, 0.046, 0.034) + 0.15 * r.nz), 0, 1)
    r.put(fb > 0.25, "burn")
    r.lit(fb > 0.25, 1.9)
    r.lit((fb > 0.25) & (fb < 0.5), 1.0)
    r.put(fb > 0.6, "skinp")                                                  # pale spectacle marks in the middle
    r.lit(fb > 0.6, 0.9)
    eye = E(EX, EZ, 0.0125, 0.0056) < 1
    r.eye = eye
    nos = E(0.0085, 1.635, 0.0045, 0.0030) < 1
    r.put(nos & (F > 0.096), "hollow")
    r.lit((E(0.0, 1.628, 0.020, 0.0045) < 1) & (F < 0.104), 0.62)
    # the thin dry mouth: a hard line with a pale cracked lip
    maw = E(0.0, MZ, 0.024, 0.0026) < 1
    r.put(maw, "hollow"); r.lit(maw, 0.5)
    r.lit((E(0.0, MZ + 0.0055, 0.024, 0.0030) < 1) & ~maw, 1.22)             # upper lip
    r.lit((E(0.0, MZ - 0.0060, 0.020, 0.0036) < 1) & ~maw, 0.78)             # lower lip
    r.lit(np.clip((1.578 - Z) / 0.012, 0, 1) * front, 0.70)                   # under the long chin
    # stubble on the long chin, and a smear of engine grease on the left cheek
    r.clusters(1.6, 0.45, f=0.78, where=(Z < 1.594) & front & (Z > 1.556), seed=21)
    r.lit(soft(Es(0.066, 1.612, 0.014, 0.010) + 0.4 * r.nz, 0.4), 0.62)
    # thin wisps of grey hair round the back and over the ears; the dome is bald
    hair = ((phi > 1.35) & (Z > 1.640 + 0.008 * np.cos(phi * 3)) & (Z < 1.750)) | ((phi > 1.15) & (phi <= 1.35) & (Z > 1.690)
                                                                                   & (Z < 1.735))
    r.put(hair, "hollow")
    r.lit(hair, 1.9)
    r.clusters(2.6, 0.2, f=1.5, where=hair, seed=12)
    r.clusters(1.8, 0.4, f=0.6, where=hair, seed=14)
    r.lit(hair * np.clip((1.66 - Z) / 0.02, 0, 1), 0.8)
    # the dome: shiny, liver-spotted and a bit scorched
    dome = (Z > 1.762) & (phi > 0.15)
    r.lit(dome, 1.04)                                                               # a sallow bald dome...
    r.clusters(2.4, 0.56, f=0.80, where=dome, seed=8)
    burn = dome & (r.nz > 0.30) & (lowfreq(np.random.default_rng(19), r.h, r.w, 2.4) > 0.25)
    r.put(burn, "burn")                                                             # ...with raw flash-burned patches
    r.lit(burn, 2.5)
    r.clusters(1.8, 0.7, f=0.6, where=dome, seed=9)
    r.put((r.nz > 0.62) & dome, "hollow")
    r.lit((r.nz > 0.62) & dome, 1.9)                                                # a few dark wisps across the dome
    r.clusters(3, 0.5, f=0.9, where=~hair & ~eye, seed=7)
    return r


def paint_hair():
    r = grid_reg("hair", ["hollow"], 0.03, 0.03, 18)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 2.6)
    r.lit(np.sin(U * 40) > 0.3, 1.3)
    r.lit(Vv > 0.7, 0.75)
    return r


def paint_ear():
    r = grid_reg("ear", ["skinp", "hollow", "burn"], 0.024, 0.065, 17)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.95)
    r.lit(ell(U, Vv, 0.42, 0.5, 0.30, 0.34) < 1, 0.72)
    r.lit(ell(U, Vv, 0.40, 0.55, 0.14, 0.16) < 1, 0.62)
    r.lit(U > 0.8, 1.18)
    r.put(ell(U, Vv, 0.75, 0.4, 0.2, 0.30) < 1, "burn")
    r.lit(ell(U, Vv, 0.75, 0.4, 0.2, 0.30) < 1, 1.5)
    return r


def paint_neck(I):
    r = loft_reg("neck", I["neck"], ["skinp", "hollow", "burn"], 13)
    X, Y = r.X, r.Y
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.05)) / 0.05, 0, 1), 0.55)
    r.lit(np.clip(1 - Y / 0.03, 0, 1), 0.60)
    for sg in (-1, 1):                                              # stringy tendons
        r.line([(sg * 0.030, top - 0.01), (sg * 0.008, 0.010)], 0.005, f=1.18)
        r.line([(sg * 0.040, top - 0.01), (sg * 0.016, 0.010)], 0.004, f=0.78)
    r.clusters(3, 0.45, f=0.85, seed=14)
    return r


# ---------------------------------------------------------------- painting: cloth and things

def knit(r, mask, period=3.2, f0=0.92, f1=1.08, axis="x"):
    """Ribbed knit: fine vertical stripes."""
    if axis == "x":
        ph = (r.X / r.tx / period) % 1.0
    else:
        ph = (r.Y / r.ty / period) % 1.0
    r.lit(mask * (ph < 0.5), f1)
    r.lit(mask * (ph >= 0.5), f0)


def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["knit", "shirtg", "hollow", "bloodc2", "leather"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    Lt = Y.max()
    P = r.P
    r.lit(np.clip(1 - Y / 0.25, 0, 1), 1.06)
    knit(r, np.ones(X.shape), 4.0, 0.94, 1.05)                             # ribbed knit all over
    # the cardigan's V: a grey shirt under the rolled collar and a slack dark tie
    vee = (ax < 0.020 + 0.30 * np.clip(Y, 0, 1)) & (Y < 0.115) & (Y > 0.004)
    r.put(vee, "shirtg")
    r.lit(vee, 0.9)
    r.lit(vee * np.clip(1 - Y / 0.06, 0, 1), 0.6)
    r.lit(vee & (ax > 0.020 + 0.30 * np.clip(Y, 0, 1) - 1.3 * tx), 0.6)
    tie = (ax < 0.9 * tx) & (Y > 0.03) & (Y < 0.16)
    r.put(tie, "hollow"); r.lit(tie, 2.2)
    # the front band: a ribbed button strip down the middle with leather buttons
    r.lit((np.abs(X - 0.0) < 0.026) & (Y > 0.02), 0.9)
    r.lit((np.abs(np.abs(X) - 0.026) < 0.6 * tx) & (Y > 0.02), 0.62)
    for yb in (0.10, 0.20, 0.32, 0.44, 0.56):
        r.blob(0.0, yb, 0.0065, 0.0065, "leather", 1.3, rough=0.0)
    # yoke / sloping shoulder seams, armpit shadow and the hem's ribbed band
    r.lit(np.abs(Y - 0.075) < 0.5 * ty, 0.72)
    r.lit(Y > Lt - 0.05, 0.94)
    r.lit((Y > Lt - 0.052) & (Y < Lt - 0.046), 0.66)
    for sg in (-1, 1):
        r.blob(sg * P / 4, 0.17, 0.030, 0.04, None, 0.84, rough=0.3)
    # wear: moth holes with pulled threads, oil down the back, scorch specks from the arc's sparks
    for (hx_, hy_) in ((0.14, 0.12), (-0.19, 0.30), (0.20, 0.42), (P / 2 - 0.05, 0.24), (P / 2 + 0.12, 0.40)):
        h = r.blob(hx_, hy_, 0.006, 0.005, "hollow", rough=0.2)
        r.lit(r.blob(hx_, hy_, 0.012, 0.010, rough=0.3) * (1 - h), 0.7)
        r.line([(hx_ + 0.006, hy_), (hx_ + 0.03, hy_ + 0.012)], 0.4 * tx, f=1.25)
    r.clusters(4, 0.28, f=0.76, where=(np.abs(B) < 0.14) & (Y > 0.12), seed=31)
    r.clusters(5, 0.55, f=0.92, seed=32)
    r.clusters(3, 0.72, f=0.5, where=Y > 0.1, seed=33)                       # singed specks
    scorch = r.blob(P / 2 - 0.05, 0.20, 0.048, 0.060, "hollow", 1.0, rough=0.5)
    r.lit(scorch, 1.5)
    r.lit(r.blob(P / 2 - 0.05, 0.20, 0.070, 0.085, rough=0.5) * (1 - scorch), 0.66)
    dn = np.abs(r.dx(P / 2 + 0.09)) < 0.028
    r.lit(dn & (Y > 0.34) & (Y < 0.40), 1.25)
    r.lit(dn & (Y > 0.34) & (Y < 0.40) & (np.sin(X * 300) > 0), 0.8)                # a darned patch
    r.blob(P / 2 + 0.06, 0.28, 0.022, 0.016, "bloodc2", 0.85)
    r.drip(P / 2 + 0.05, 0.30, 0.12, w=0.004)
    return r


def paint_collar(I):
    r = loft_reg("collar", I["collar"], ["knit", "hollow", "shirtg"], 23)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    r.lit(np.ones(X.shape), 1.05)
    knit(r, np.ones(X.shape), 3.0, 0.88, 1.10, axis="y")                     # the roll's ribs run round
    r.lit(Y < 0.008, 1.2)
    r.lit(Y > Lt - 0.012, 0.6)
    r.lit((np.abs(np.abs(X) - r.P / 4) < 0.8 * tx), 0.75)
    r.clusters(2, 0.4, f=0.8, seed=24)
    r.clusters(3, 0.72, f=1.1, seed=25)
    return r


def paint_bib():
    """The apron's bib: pale duck canvas, a stitched chest pocket with tools, grease and burns."""
    r = grid_reg("bib", ["duck", "hollow", "bloodc2", "leather", "burn"], 0.17, 0.42, 51)
    U, Vv = r.U, r.V
    tx, ty = r.tx, r.ty
    r.lit(np.ones_like(U), 1.0)
    r.lit(np.clip(Vv - 0.6, 0, 1), 0.86)
    edge = (U < 0.05) | (U > 0.95)
    r.lit(edge, 0.7)
    r.lit((U > 0.05) & (U < 0.05 + 1.3 / r.w * 1.0), 1.15)
    # the big pocket: stitched rectangle, a flap seam, a pencil and a pair of pliers' handles
    pk = (U > 0.22) & (U < 0.78) & (Vv > 0.42) & (Vv < 0.70)
    rim = pk & ~((U > 0.22 + 1.4 / r.w) & (U < 0.78 - 1.4 / r.w) & (Vv > 0.42 + 1.4 / r.h) & (Vv < 0.70 - 1.4 / r.h))
    r.lit(rim, 0.66)
    r.lit(pk & (Vv < 0.47), 1.14)
    r.lit(pk & (Vv >= 0.47) & (Vv < 0.47 + 1.4 / r.h), 0.55)
    r.put((np.abs(U - 0.36) < 0.03) & (Vv > 0.36) & (Vv < 0.46), "leather")
    r.lit((np.abs(U - 0.36) < 0.03) & (Vv > 0.36) & (Vv < 0.46), 1.3)
    r.put((np.abs(U - 0.50) < 0.02) & (Vv > 0.39) & (Vv < 0.46), "hollow")
    r.lit((np.abs(U - 0.50) < 0.02) & (Vv > 0.39) & (Vv < 0.46), 2.0)
    r.put((np.abs(U - 0.64) < 0.02) & (Vv > 0.40) & (Vv < 0.46), "leather")
    r.lit((np.abs(U - 0.64) < 0.02) & (Vv > 0.40) & (Vv < 0.46), 1.6)
    # grease, handprints and burnt holes
    r.clusters(3, 0.35, f=0.72, where=Vv > 0.25, seed=52)
    r.clusters(4, 0.6, f=0.88, seed=53)
    for (hx_, hy_) in ((0.72, 0.16), (0.24, 0.84)):
        h = r.blob(hx_ * 0.17, hy_ * 0.42, 0.006, 0.006, "hollow", rough=0.2)
        r.lit(r.blob(hx_ * 0.17, hy_ * 0.42, 0.012, 0.012, rough=0.3) * (1 - h), 0.6)
    return r


def paint_panel():
    """An apron skirt panel: canvas, a patch tool pocket with a screwdriver and scissors, a stitched hem."""
    r = grid_reg("panel", ["duck", "hollow", "bloodc2", "leather", "burn"], 0.17, 0.39, 61)
    U, Vv = r.U, r.V
    tx, ty = r.tx, r.ty
    r.lit(np.ones_like(U), 1.0)
    r.lit(np.clip(Vv - 0.4, 0, 1), 0.85)
    r.lit((U < 0.03) | (U > 0.97), 0.72)
    r.lit((Vv < 0.03), 0.7)
    pk = (U > 0.30) & (U < 0.84) & (Vv > 0.28) & (Vv < 0.56)
    rim = pk & ~((U > 0.30 + 1.4 / r.w) & (U < 0.84 - 1.4 / r.w) & (Vv > 0.28 + 1.4 / r.h) & (Vv < 0.56 - 1.4 / r.h))
    r.lit(rim, 0.64)
    r.lit(pk & (Vv < 0.32), 1.14)
    for x0_ in (0.42, 0.52, 0.70):
        r.lit((np.abs(U - x0_) < 0.5 / r.w) & (Vv > 0.32) & (Vv < 0.56), 0.72)
    r.put((np.abs(U - 0.47) < 0.03) & (Vv > 0.20) & (Vv < 0.30), "burn")               # a screwdriver's red handle
    r.lit((np.abs(U - 0.47) < 0.03) & (Vv > 0.20) & (Vv < 0.30), 1.4)
    r.put((np.abs(U - 0.63) < 0.018) & (Vv > 0.20) & (Vv < 0.29), "leather")
    r.lit((np.abs(U - 0.63) < 0.018) & (Vv > 0.20) & (Vv < 0.29), 1.3)
    r.put((np.abs(U - 0.72) < 0.014) & (Vv > 0.21) & (Vv < 0.29), "hollow")
    r.lit((np.abs(U - 0.72) < 0.014) & (Vv > 0.21) & (Vv < 0.29), 1.9)
    r.lit((Vv > 0.92) & (Vv < 0.95), 0.7)
    r.lit((Vv > 0.95), 0.9)
    r.lit((np.abs(Vv - 0.90) < 0.5 / r.h) & (np.sin(U * 220) > 0), 1.2)              # hem stitching
    r.clusters(3, 0.3, f=0.68, where=Vv > 0.5, seed=62)
    r.clusters(4, 0.6, f=0.86, seed=63)
    r.blob(0.06, 0.30, 0.02, 0.02, "bloodc2", 0.9)
    return r


def paint_strap():
    r = grid_reg("strap", ["leather"], 0.04, 0.02, 71)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.1)
    r.lit(Vv < 0.2, 0.75)
    r.lit(Vv > 0.85, 0.7)
    r.lit(np.sin(U * 60) > 0.6, 0.9)
    return r


def paint_band(I):
    r = loft_reg("band", I["band"], ["duck", "leather", "hollow"], 72)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    Lt = Y.max()
    r.lit(np.ones(X.shape), 1.0)
    r.lit(Y < 1.3 * ty, 1.2)
    r.lit(Y > Lt - 1.3 * ty, 0.62)
    r.put(np.abs(X) < 0.05, "leather")                                      # a leather buckle strap in front
    r.lit(np.abs(X) < 0.05, 0.9)
    r.lit((np.abs(np.abs(X) - 0.05) < 0.6 * tx), 0.6)
    r.clusters(2.5, 0.4, f=0.72, seed=73)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["slacks", "hollow"], 31)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    r.lit(Y < 0.06, 0.7)
    r.fold((0.004, 0.04), (0.006, 0.12), off=(1.2 * tx, 0))
    r.clusters(4, 0.40, f=0.75, where=Y > 0.04, seed=3)
    r.clusters(4, 0.55, f=0.9, seed=4)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["slacks", "bloodc2", "mud", "burn"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    so = 1 if L else -1
    r.lit(np.full(X.shape, 1.0), 1.0)
    r.fold((so * 0.003, 0.02), (so * 0.005, Lt - 0.03), dark=0.78, off=(so * 1.2 * tx, 0))
    r.fold((P / 4 * so, 0.0), (P / 4 * so, Lt), dark=0.8, off=(-so * 1.2 * tx, 0))
    for yk in (Lt - 0.070, Lt - 0.040, Lt - 0.014):
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    r.clusters(3, 0.3, f=0.8, where=(np.abs(X) < 0.07) & (Y > Lt - 0.10), seed=8)
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    r.clusters(4, 0.62, f=0.6, where=Y < 0.3, seed=11)                                 # burn specks near the lap
    if L:
        r.blob(0.05, 0.24, 0.014, 0.010, "bloodc2", 0.9)
    r.lit(np.clip(Y / Lt, 0, 1), 0.92)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    r = loft_reg("shin." + sd, I["shin." + sd], ["slacks", "bloodc2", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    so = 1 if L else -1
    r.lit(np.full(X.shape, 1.0), 0.94)
    r.fold((so * 0.003, 0.02), (so * 0.005, Lt - 0.04), dark=0.78, off=(so * 1.2 * tx, 0))
    r.lit((Y > Lt - 0.026) & (Y < Lt - 0.014), 1.12)                              # the hem turn-up
    r.lit(Y >= Lt - 0.014, 0.55)
    for (p0, p1) in (((-0.02, 0.06), (0.01, 0.17)), ((0.04, 0.09), (0.02, 0.20))):
        r.fold(p0, p1, dark=0.8)
    r.clusters(4, 0.40, mat="mud", where=np.clip((Y - Lt * 0.6) / (Lt * 0.4), 0, 1) > 0.5, seed=11 if L else 12)
    r.clusters(4, 0.55, f=0.9, seed=13)
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["leather", "crepe", "mud", "khaki"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][1]
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 0.95)
    r.put(sole, "crepe")
    r.lit(sole, 1.0)
    r.lit(welt, 1.16)
    r.lit((np.abs(U - st[2]) < 0.012) | (np.abs(U - st[6]) < 0.012), 0.66)
    Lt = info["d"][-1]
    toe = Y > Lt - 0.07
    r.lit(toe & ~sole, 1.12)
    r.lit((np.abs(Y - (Lt - 0.070)) < 0.005) & ~sole, 0.6)
    lace = (np.abs(X) < 0.016) & (Y > 0.05) & (Y < 0.15)
    r.lit(lace, 0.78)
    for yk in np.arange(0.055, 0.15, 0.02):
        r.line([(-0.011, yk), (0.011, yk + 0.008)], 0.5 * tx, "khaki", 0.55)
    r.clusters(3, 0.45, mat="mud", where=(np.abs(r.B) < 0.10) & ~sole & (Y < 0.10), seed=15)
    r.clusters(2.2, 0.55, f=0.72, where=~sole, seed=16)
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["knit", "hollow", "bloodc2", "leather"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    knit(r, np.ones(X.shape), 4.0, 0.94, 1.05)
    r.lit(np.clip(1 - Y / 0.16, 0, 1), 1.08)
    r.lit(np.abs(Y - 0.045) < 0.6 * ty, 0.68)
    cuff = info["d"][3]
    r.lit(Y > cuff - 0.03, 1.10)                                                  # the bunched, pushed-up ribbed cuff
    knit(r, (Y > cuff - 0.03), 2.2, 0.72, 1.20, axis="y")
    r.lit(np.abs(Y - (cuff - 0.03)) < 0.7 * ty, 0.5)
    r.lit(Y > Lt - 0.008, 0.6)
    r.fold((-0.03, 0.09), (0.02, 0.14))
    r.clusters(4, 0.45, f=0.82, seed=16 if L else 17)
    if L:
        h = r.blob(0.035, 0.12, 0.006, 0.006, "hollow", rough=0.2)
        r.lit(r.blob(0.035, 0.12, 0.012, 0.011, rough=0.3) * (1 - h), 0.62)
    else:
        r.blob(0.02, 0.15, 0.010, 0.008, "bloodc2")
    return r


def paint_farm(I, sd):
    """The scorched forearm: charred to the wrist, blistered raw patches, arc scars branching from the
    hand up the arm; the scar tips glow a faint cold white (glow page)."""
    L = sd == "L"
    info = I["farm." + sd]
    r = loft_reg("farm." + sd, info, ["burn", "skinp", "hollow", "bloodc2"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    rg = np.random.default_rng(90 if L else 91)
    # skin by the elbow, burn advancing toward the wrist: char, then raw red, then blisters
    burnt = np.clip((Y - 0.06) / 0.10, 0, 1) + 0.25 * r.nz
    r.put(burnt < 0.55, "skinp")
    r.lit(burnt < 0.55, 0.86)
    r.lit(np.clip(1 - Y / 0.05, 0, 1), 0.62)
    r.lit(np.abs(r.B) < 0.04, 0.9)
    r.lit((burnt >= 0.55) & (burnt < 0.8), 1.5)                                   # raw red
    r.lit(burnt >= 0.8, 0.9)
    r.clusters(3.0, 0.30, f=0.5, where=Y > 0.12, seed=82 if L else 84)                # char patches
    r.clusters(2.6, 0.70, f=1.9, where=(Y > 0.08) & (Y < Lt - 0.04), seed=85 if L else 86)      # blisters
    tips = []
    for k in range(4):
        fern(r, rg.uniform(-P / 3, P / 3), Lt - rg.uniform(0.0, 0.05), -math.pi / 2 + rg.uniform(-0.5, 0.5),
             rg.uniform(0.09, 0.15), 900 + k + (0 if L else 30), depth=2, tips=tips)
    r.glow = [(tips_mask(r, tips, 0.4 * max(tx, ty)), (150, 190, 255))]
    r.lit(Y > Lt - 0.02, 0.7)
    r.lit(np.clip(1 - Y / 0.05, 0, 1), 0.7)
    return r


def paint_hand(name, I, sd, part, seed):
    r = loft_reg(name, I[name], ["burn", "skinp", "hollow", "bloodc2"], seed)
    X, Y, tx, ty, Pm = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    rg = np.random.default_rng(seed)
    r.put(np.ones(X.shape, bool), "burn")
    r.lit(np.ones(X.shape), 1.15)
    tips = []
    if part == "palm":
        r.lit(np.abs(r.B) < 0.03, 0.5)                                            # a charred palm
        r.clusters(2.6, 0.3, f=0.55, seed=seed + 1)
        for k in range(2):
            fern(r, rg.uniform(-0.02, 0.02), 0.03 + 0.01 * k, math.pi / 2 + rg.uniform(-0.4, 0.4), 0.07, seed + 5 + k,
                 depth=1, tips=tips)
        r.clusters(2.8, 0.7, f=1.9, seed=seed + 2)
    elif part == "fing":
        back = np.abs(X) < Pm / 4
        r.lit(~back, 0.6)
        for xk in (-0.0235, 0.0, 0.0235):
            r.lit(np.abs(X - xk) < 0.55 * tx, 0.55)
            r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.5)
        r.put(Y > Lt - 0.020 + 0.005 * r.nz, "hollow")                            # blackened fingertips
        r.lit(Y > Lt - 0.020, 2.0)
        r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.6)
        r.clusters(2.4, 0.7, f=1.8, where=Y < Lt - 0.03, seed=seed + 3)
        fern(r, 0.0, 0.0, math.pi / 2, 0.05, seed + 7, depth=1, tips=tips)
    else:
        r.lit((X / Pm + 0.5) > 0.75, 0.6)
        r.put(Y > Lt - 0.012, "hollow")
        r.lit(Y > Lt - 0.012, 2.0)
    r.glow = [(tips_mask(r, tips, 0.4 * max(tx, ty)), (150, 190, 255))] if tips else []
    return r


def paint_shade(I):
    """The eyeshade's headband: green celluloid with a bright top edge and an elastic at the back."""
    r = loft_reg("shade", I["shade"], ["celluloid", "hollow"], 101)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    r.lit(np.ones(X.shape), 1.05)
    r.lit(Y < 1.3 * ty, 1.35)
    r.lit(Y > Y.max() - 1.3 * ty, 0.6)
    r.put(np.abs(r.B) < 0.03, "hollow")
    r.lit(np.abs(r.B) < 0.03, 2.2)                                               # the elastic at the back
    r.clusters(2.5, 0.4, f=0.78, seed=102)
    return r


def paint_brim():
    """The flat brim: its top face (v 0.04-0.46) translucent green with a bright rolled edge and a
    sweat-stained dark underside (v 0.54-0.96)."""
    r = grid_reg("brim", ["celluloid", "hollow"], 0.30, 0.10, 103)
    U, Vv = r.U, r.V
    top = Vv < 0.5
    r.lit(np.ones_like(U), 1.0)
    r.lit(top, 1.15)
    r.lit(top & (Vv > 0.38), 1.45)                                               # the front edge catches the bulb
    r.lit(top & (Vv < 0.08), 0.75)
    r.lit(~top, 0.5)
    r.lit(~top & (Vv < 0.62), 0.36)
    r.lit(top & (np.sin(U * 90 + Vv * 12) > 0.8), 1.2)                            # a streaky sheen
    r.clusters(1.6, 0.45, f=0.7, seed=104)
    r.clusters(1.4, 0.7, f=1.3, where=top, seed=105)
    return r


def paint_lens():
    """A faceted round lens: a dark horn rim, glass glowing icy blue-white from the middle out, glare."""
    r = grid_reg("lens", ["lensglow", "horn"], 0.06, 0.06, 111)
    U, Vv = r.U, r.V
    rr = np.hypot(U - 0.5, Vv - 0.5) / 0.47
    rim = rr > 0.80
    r.put(rim, "horn")
    r.lit(rim, 0.9)
    r.lit(rim & (Vv < 0.45), 1.3)
    r.lit(~rim, 1.05)
    r.lit(~rim & (rr > 0.55), 0.85)
    r.overlay(~rim & (rr < 0.55), "lensglow", 2)
    r.overlay(~rim & (rr < 0.30), "lensglow", 3)
    r.overlay(ell(U, Vv, 0.36, 0.34, 0.09, 0.06) < 1, "lensglow", 3)               # a glare streak
    r.glow = [((~rim) & (rr < 0.62), (180, 226, 255))]
    return r


def paint_rims():
    r = grid_reg("rims", ["horn"], 0.04, 0.02, 112)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.0)
    r.lit(Vv < 0.35, 1.3)
    r.lit(Vv > 0.7, 0.7)
    r.clusters(1.4, 0.45, f=0.7, seed=113)                                       # tortoiseshell mottling
    r.clusters(1.0, 0.55, f=1.4, seed=114)
    return r


def paint_film():
    """35 mm film, exaggerated to read at game distance: dark developed strip with pale sprocket holes along
    both edges, sepia frames each with a faint picture, thin amber rails between them."""
    r = grid_reg("film", ["film", "hollow"], 0.08, 0.05, 121)
    U, Vv = r.U, r.V
    r.lit(np.full(U.shape, 0.62), 1.0)
    edge = (Vv < 0.28) | (Vv > 0.72)
    r.lit(edge, 0.8)
    pos = ((U * 3) % 1.0) - 0.5
    hole = ((np.abs(Vv - 0.14) < 0.085) | (np.abs(Vv - 0.86) < 0.085)) & (np.abs(pos) < 0.20)
    r.overlay(hole, "film", 3)
    cell = ((U * 2) % 1.0) - 0.5
    fr = (Vv >= 0.32) & (Vv <= 0.68) & (np.abs(cell) < 0.43)
    r.lit(fr, 0.62)
    r.lit(fr & (ell(cell, Vv, 0.0, 0.5, 0.27, 0.14) < 1), 2.1)                        # a faint picture in the frame
    r.lit(fr & (Vv < 0.38), 0.75)
    r.lit((np.abs(Vv - 0.30) < 0.02) | (np.abs(Vv - 0.70) < 0.02), 1.5)
    r.clusters(1.2, 0.5, f=0.85, seed=122)
    return r


def paint_eyes():
    """The eye-quad patch: an icy white orb with a small dark pupil (drawn unlit on the lens apex)."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    a = np.zeros((h, w, 3)); a[:] = C((196, 224, 240))
    a[ell(U, Vv, 0.5, 0.5, 0.36, 0.42) < 1] = C((232, 246, 255))
    a[ell(U, Vv, 0.50, 0.52, 0.12, 0.22) < 1] = C((84, 116, 150))
    a[ell(U, Vv, 0.44, 0.40, 0.05, 0.10) < 1] = C((255, 255, 255))
    return a


def paint_page(I, light, pos):
    P = lambda name, joint: preg(pos, name, joint)
    face = paint_head("head", P("head", "neck"), 11)
    regs = [face, paint_head("nose", P("nose", "neck"), 12), paint_ear(), paint_hair(), paint_neck(I),
            paint_torso(I), paint_collar(I), paint_bib(), paint_panel(), paint_strap(), paint_band(I), paint_pelvis(I),
            paint_foot(I), paint_shade(I), paint_brim(), paint_lens(), paint_rims(), paint_film()]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd), paint_farm(I, sd)]
        for part, seed in (("palm", 91), ("fing", 92), ("thumb", 95)):
            regs.append(paint_hand(part + "." + sd, I, sd, part, seed + (0 if sd == "L" else 10)))
    page, glow = H.compose_page(regs, light)
    x0, y0, w, h = REG["eyes"]
    page[y0:y0 + h, x0:x0 + w] = paint_eyes()
    glow[y0:y0 + h, x0:x0 + w] = paint_eyes() * 0.5
    return page, glow


H.setup("projectionist", "The Projectionist", "art/zombies/z_projectionist.py", PAGE, PARTS, build_rest, paint_page,
        head_parts=["head", "eyes", "eyeshade"], headwear=["eyeshade"], joints=JOINTS, ramps=RAMPS, gain=GAIN,
        hat_parts=("eyeshade",), jaw_z=JAW_Z, face_cam=(-0.03, 0.11),
        glow={"page": "projectionist_glow.png", "emissiveIntensity": 1.2,
              "parts": ["head", "lowerArm.L", "lowerArm.R", "eyes"],
              "note": "icy blue-white lenses (and the eyes behind them) glow; faint cold white at the tips of the "
                      "arc scars on forearms and hands"},
        note="palace horde: the night projectionist. eyeshade is always worn and goes with the head on a headshot "
             "(head_parts); tint instances 0.8-1.1 (head: skin tint); draw eyes unlit; emissiveMap = the glow page at "
             "~1.2; the apron's skirt panels are part of upperLeg.L/R and swing with the legs; the film loops are "
             "part of torso and lowerArm.R; lowerLeg.L/R are the trouser legs and shoes (hidden when he crawls). "
             "This rig is taller and thinner than the standard: hips 0.97, knees 0.47, shoulders 0.25.")
H.main()
