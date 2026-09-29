# The Usher (game id `usher`): a dead theatre usher for the Aurora Picture Palace's horde,
# on the same 1997 disc as the Ghoul, the Mended, the Stoker and the Gasser (art/STYLE.md).
#
# Design (silhouette and colour first: he is the only maroon-and-white man of the horde):
#   - a faded maroon hip-length uniform jacket, double-breasted, two columns of brass buttons,
#     peaked lapels with gold piping, a gold-braid aiguillette on the right chest, square
#     shoulders with gold epaulettes and a bullion fringe, gold braid rings on the cuffs;
#   - a small black bow tie under a white shirt V, a pillbox cap (`pillbox`, a separate headwear
#     part: flat gold-banded crown, a brass badge, a chin strap loose under the jaw);
#   - white gloves (dirty ivory), the left one torn open at the fingertips and across the back;
#     a dead black torch clenched in the right fist;
#   - dark wine trousers with a gold side stripe, black dress shoes;
#   - greyish-lilac dead skin, a slack jaw hanging open with a dribble, milky eyes.
# Built like the Mended (z_mended.py, through the shared toolkit horde97.py): rigid faceted prisms
# with hard normals in the game rig's rest pose, one 256 px page of per-region 16-colour-ish CLUTs
# painted with baked AO and facet light at ~60 %, edge highlights, a dim glow page (the eyes).
#
#   node art/zombies/blend.mjs z_usher.py --preview [--views front,side,back] [--walk] [--face] [--ingame]
#   node art/zombies/blend.mjs z_usher.py --export   (game model + texture only, no renders)
# Every render run also exports public/models/usher.json + usher.png + usher_glow.png.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import horde97 as H
from horde97 import (kit, bpy, bmesh, np, V, Matrix, TAU, JW, REG, Reg, loft, loft_reg, grid_reg, poly_obj, bvh, hit,
                     hit_front, hexprof, flatprof, boxprof, tbox, hbox, sym, twist, ell, segd, inpoly, lowfreq, blur2,
                     texel_size, smooth01, C, make_head, make_hand, make_foot, hand_frame, ribbon_polys, preg, C3,
                     HEAD_RINGS)

FWD = V((0, -1, 0))
UP_ = V((0, 0, 1))
DN = V((0, 0, -1))

# ---------------------------------------------------------------- CLUT ramps (sRGB, dark -> light)
# The world palette (horde97.RAMPS) plus the usher's materials, same value range and hue shift:
# cool violet shadows, warm dusty highlights; the maroon is duller than the blood (nothing
# is more saturated than the blood or the chalk red).
RAMPS = {
    "maroon": ([(30, 14, 22), (50, 22, 32), (72, 32, 42), (96, 44, 52), (122, 58, 62), (150, 78, 76)], 3),
    "maroond": ([(18, 12, 20), (28, 17, 26), (40, 24, 32), (54, 32, 40), (70, 42, 48)], 2),
    "skinu": ([(34, 30, 38), (54, 50, 58), (76, 74, 80), (100, 98, 102), (124, 122, 122), (150, 146, 140),
               (178, 172, 160)], 4),
    "shirtw": ([(74, 72, 78), (122, 118, 116), (176, 168, 152), (216, 208, 188)], 2),
    "glove": ([(46, 44, 52), (74, 72, 78), (108, 104, 106), (146, 140, 134), (182, 174, 158), (212, 204, 182),
               (232, 224, 200)], 4),
    "braid": ([(52, 38, 20), (96, 72, 34), (142, 110, 54), (186, 152, 82), (228, 196, 118)], 2),
    "tie": ([(10, 10, 16), (20, 20, 30), (38, 38, 52), (70, 70, 90)], 1),
    "blacksteel": ([(10, 10, 12), (24, 24, 28), (46, 46, 52), (86, 86, 92), (140, 138, 134)], 1),
    "shoe": ([(8, 8, 10), (18, 16, 18), (32, 28, 28), (52, 46, 44), (80, 72, 66)], 2),
    "teeth": ([(96, 84, 62), (150, 136, 100), (200, 188, 146)], 1),
    "torchglass": ([(10, 14, 18), (26, 34, 42), (58, 72, 82), (120, 138, 146)], 1),
}
GAIN = {"glove": 1.25, "shirtw": 1.2, "skinu": 1.14, "maroond": 1.28}

# ---------------------------------------------------------------- the page (256x256, top-left origin)
PAGE = {
    "head": (0, 0, 128, 96), "torso": (128, 0, 128, 96),
    "cap": (0, 96, 96, 24), "foot": (96, 96, 64, 24), "lapel": (160, 96, 32, 24),
    "epau": (192, 96, 48, 16),
    "eyes": (240, 96, 16, 8), "hair": (240, 104, 16, 8), "tie": (240, 112, 16, 8),
    "thigh.L": (0, 120, 64, 48), "thigh.R": (64, 120, 64, 48), "shin.L": (128, 120, 64, 48), "shin.R": (192, 120, 64, 48),
    "uarm.L": (0, 168, 48, 32), "uarm.R": (48, 168, 48, 32),
    "palm.L": (96, 168, 32, 16), "fing.L": (128, 168, 32, 16), "palm.R": (96, 184, 32, 16), "fing.R": (128, 184, 32, 16),
    "thumb.L": (160, 168, 16, 16), "thumb.R": (160, 184, 16, 16), "torch": (176, 168, 32, 32),
    "ear": (208, 168, 16, 16), "nose": (224, 168, 16, 16), "captop": (240, 168, 16, 16), "strap": (208, 184, 16, 8),
    "farm.L": (0, 200, 48, 48), "farm.R": (48, 200, 48, 48), "pelvis": (96, 200, 128, 24), "neck": (224, 200, 32, 16),
}
PARTS = [("pelvis", "hips"), ("torso", "spine"), ("head", "neck"), ("pillbox", "neck"), ("eyes", "neck"),
         ("upperArm.L", "shL"), ("upperArm.R", "shR"), ("lowerArm.L", "elL"), ("lowerArm.R", "elR"),
         ("upperLeg.L", "hipL"), ("upperLeg.R", "hipR"), ("lowerLeg.L", "knL"), ("lowerLeg.R", "knR")]

YC = -0.022
# skull rings, the Mended's for the top; the jaw hangs: a long lower lip and a dropped, pulled-back chin
RINGS = list(H.HEAD_RINGS[:7]) + [
    (1.538, 0.004, 0.058, 0.068, 0.088, {0: (0, 0, 0.022), 1: (0, 0, 0.022), 2: (0, 0, 0.016), 3: (0, 0, 0.008),
                                         4: (-0.008, -0.006), 5: (-0.006, 0.002), 6: (0, 0.004)}),
    (1.506, 0.010, 0.040, 0.054, 0.070, {0: (0, 0, 0.030), 1: (0, 0, 0.030), 2: (0, 0, 0.022), 3: (0, 0, 0.012),
                                         4: (-0.006, -0.004), 5: (-0.006, 0.004), 6: (0, 0.010)}),
]
ROWS = (4, 12, 24, 36, 53, 66, 77, 88, 94)
EYE = (0.040, 1.672)
JAW_Z = 1.56


def octprof(w, db, df):
    """Eight-sided ring: the pillbox's crown."""
    return sym([[0, -db, 0], [-0.72 * w, -0.72 * db, 0], [-w, 0.0, 0], [-0.72 * w, 0.72 * df, 0], [0, df, 0]])


# ---------------------------------------------------------------- geometry: the parts (rest pose, world)

def build_rest():
    I, G = {}, {}
    hd = make_head(RINGS, ROWS, YC, apex=((0, -0.002, 1.792), (0, 0.016, 1.486)),
                   tufts=((2.00, 0.026), (2.50, 0.031), (math.pi, 0.024), (-2.50, 0.031), (-2.00, 0.026)),
                   tuft_z=1.700, eye=EYE)
    head, I["head"], htree = hd["head"], hd["info"], hd["tree"]
    G["head"] = [head, hd["nose"], hd["ears"]] + ([hd["tufts"]] if hd["tufts"] else [])
    G["eyes"] = [hd["eyes"]]

    # ---- the pillbox: an eight-sided crown, flat top, tipped a little forward and over the right ear
    CAPC = YC + 0.004
    CAPR = [(1.828, 0.092, 0.096, 0.094), (1.818, 0.101, 0.106, 0.104), (1.746, 0.108, 0.114, 0.118),
            (1.726, 0.110, 0.116, 0.122)]
    cap, I["cap"] = loft("cap", [(0, CAPC, z) for z, *_ in CAPR], [octprof(w, db, df) for z, w, db, df in CAPR], FWD,
                         REG["cap"], (False, False))
    top_ring = [V((p[0], CAPC - p[1], CAPR[0][0])) for p in octprof(*CAPR[0][1:])]
    ctr = V((0, CAPC, CAPR[0][0]))
    tp = []
    for k in range(len(top_ring)):
        a, b = top_ring[k], top_ring[(k + 1) % len(top_ring)]
        uv = lambda q: ("captop", 0.5 + (q.x - ctr.x) / 0.19, 0.5 + (q.y - ctr.y) / 0.19)
        tp.append(([a, b, ctr], [uv(a), uv(b), uv(ctr)], (0, 0, 1)))
    captop = poly_obj("captop", tp)
    piv = V((0, CAPC, 1.726))
    MC = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-6), 4, "X") @ \
        Matrix.Rotation(math.radians(8), 4, "Y") @ Matrix.Translation(-piv)
    cap.data.transform(MC)
    captop.data.transform(MC)
    # the chin strap: gold cord hanging loose from the crown, under the jaw and up the other side
    def on_head(az, z, lift=0.005):
        d = V((math.sin(az), -math.cos(az), 0))
        loc, n = hit(htree, V((0, YC, z)) + d * 0.4, -d, lift)
        return loc, n
    left, nrm = [], []
    for az, z in ((1.42, 1.730), (1.30, 1.690), (1.16, 1.640), (1.00, 1.590), (0.80, 1.545), (0.55, 1.515)):
        p, n = on_head(az, z)
        if p is not None:
            left.append(p); nrm.append(n)
    chin, cn = hit(htree, V((0, YC + 0.012, 1.30)), V((0, 0, 1)), 0.005)
    sp = [MC @ V((0.1085, CAPC, 1.738))] + left[1:]
    nrm[0] = V((1, 0, 0))
    pts = sp + [chin] if chin is not None else sp
    pts = pts + [V((-p.x, p.y, p.z)) for p in reversed(sp)]
    ref = nrm + ([cn] if chin is not None else []) + [V((-n.x, n.y, n.z)) for n in reversed(nrm)]
    strap = poly_obj("strap", ribbon_polys("strap", pts, 0.0085, ref, back=False))
    G["pillbox"] = [cap, captop, strap]

    # ---- torso: a hip-length jacket, squared padded shoulders, a nipped waist, a flared hem;
    # neck; peaked lapels; a bow tie; gold epaulettes with a fringe
    TORSO = [(1.548, 0.012, 0.100, 0.070, 0.066, {}),
             (1.520, 0.012, 0.226, 0.108, 0.096, {1: (0, -0.008)}),
             (1.468, 0.008, 0.238, 0.118, 0.112, {1: (0, -0.008)}),
             (1.350, 0.000, 0.208, 0.124, 0.126, {}),
             (1.170, 0.004, 0.174, 0.106, 0.112, {}),
             (1.000, 0.004, 0.198, 0.118, 0.124, {}),
             (0.905, 0.004, 0.210, 0.126, 0.130, {})]
    tv = [0.0, 0.03, 0.10, 0.24, 0.47, 0.75, 1.0]
    torso, I["torso"] = loft("torso", [(0, yc, z) for z, yc, *_ in TORSO], [tbox(w, db, df, p) for z, yc, w, db, df, p in TORSO],
                             FWD, REG["torso"], (True, False), vs=[1 - c for c in tv], cap_u=0.27)
    neck, I["neck"] = loft("neck", [(0, 0.004, 1.470), (0, -0.016, 1.615)],
                           [hexprof(0.052, 0.054, {3: (0, 0.004)}), hexprof(0.048, 0.050, {3: (0, 0.004)})],
                           FWD, REG["neck"], (False, False))
    tt = bvh(torso)
    lap = []
    for sx in (1, -1):
        a, na = hit_front(tt, sx * 0.028, 1.526, 0.005)
        b, nb = hit_front(tt, sx * 0.118, 1.508, 0.005)
        c, nc = hit_front(tt, sx * 0.104, 1.388, 0.008)
        d, nd = hit_front(tt, sx * 0.046, 1.340, 0.006)
        if None in (a, b, c, d):
            continue
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        lap.append(([a, b, c, d], [("lapel", u(0.06), 0.03), ("lapel", u(0.94), 0.03), ("lapel", u(0.86), 0.95),
                                   ("lapel", u(0.22), 0.95)], tuple(nc)))
    bt, _ = hit_front(tt, 0.0, 1.492, 0.008)
    tie = []
    if bt is not None:
        kn = 0.0072
        z0 = bt.z
        for sx in (1, -1):
            o = V((sx * 0.006, bt.y, z0))
            oo = V((sx * 0.038, bt.y - 0.007, z0))
            q = [o + V((0, 0, 0.006)), oo + V((0, 0, 0.014)), oo + V((0, 0, -0.014)), o + V((0, 0, -0.006))]
            u = (lambda a: a) if sx > 0 else (lambda a: 1 - a)
            tie.append((q, [("tie", u(0.5), 0.15), ("tie", u(0.98), 0.02), ("tie", u(0.98), 0.98), ("tie", u(0.5), 0.85)],
                        (0, -1, 0)))
        kc = V((0, bt.y - 0.003, z0))
        tie.append(([kc + V((-kn, 0, kn)), kc + V((kn, 0, kn)), kc + V((kn, 0, -kn)), kc + V((-kn, 0, -kn))],
                    [("tie", 0.40, 0.1), ("tie", 0.60, 0.1), ("tie", 0.60, 0.9), ("tie", 0.40, 0.9)], (0, -1, 0)))
    # epaulettes: a chunky padded board on the torso's shoulder (its slab buried in the shoulder line),
    # gold cord across the top and a bullion fringe painted on its outer end
    epau = []
    for sx in (1, -1):
        ang = math.radians(6)
        al = V((sx * math.cos(ang), 0, -math.sin(ang)))
        ac = V((0, -1, 0))
        up = al.cross(ac) * sx
        if up.z < 0:
            up = -up
        O = V((sx * 0.205, 0.014, 1.535))
        hl, hw, ht = 0.068, 0.052, 0.012
        c = lambda a_, b_, c_: O + al * (a_ * hl) + ac * (b_ * hw) + up * (c_ * ht)
        u = (lambda q: q) if sx > 0 else (lambda q: 1 - q)
        epau.append(([c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
                     [("epau", u(0.02), 0.57), ("epau", u(0.98), 0.57), ("epau", u(0.98), 0.03),
                      ("epau", u(0.02), 0.03)], tuple(up)))
        for (pa, pb, nn, u0, u1) in (((1, -1), (1, 1), al, 0.02, 0.48), ((-1, -1), (1, -1), -ac, 0.52, 0.98),
                                     ((-1, 1), (1, 1), ac, 0.52, 0.98)):
            q = [c(pa[0], pa[1], 1), c(pb[0], pb[1], 1), c(pb[0], pb[1], -1), c(pa[0], pa[1], -1)]
            epau.append((q, [("epau", u0, 0.66), ("epau", u1, 0.66), ("epau", u1, 0.97), ("epau", u0, 0.97)],
                         tuple(nn)))
    G["torso"] = [torso, neck, poly_obj("lapels", lap), poly_obj("tie", tie), poly_obj("epaulettes", epau)]

    # ---- pelvis: the trousers' seat (mostly under the jacket)
    PEL = [(1.062, 0.004, 0.170, 0.100, 0.104), (0.960, 0.006, 0.186, 0.116, 0.112), (0.815, 0.004, 0.158, 0.104, 0.098)]
    pelvis, I["pelvis"] = loft("pelvis", [(0, yc, z) for z, yc, *_ in PEL], [tbox(w, db, df) for z, yc, w, db, df in PEL],
                               FWD, REG["pelvis"], (False, True))
    G["pelvis"] = [pelvis]

    for sd, sx in (("L", 1), ("R", -1)):
        # ---- upper arm: a straight jacket sleeve, square at the shoulder
        sh = JW["sh" + sd]
        UA = [(0.035, 0.062, 0.064, 0.0, 0), (-0.005, 0.072, 0.073, sx * 0.004, 3), (-0.190, 0.064, 0.066, 0.0, 7),
              (-0.302, 0.060, 0.062, 0.0, 10)]
        ua, I["uarm." + sd] = loft("uarm." + sd, [sh + V((dx, 0, z)) for z, w, d, dx, tw in UA],
                                   [twist(hexprof(w, d), sx * tw) for z, w, d, dx, tw in UA], FWD, REG["uarm." + sd],
                                   (True, True), cap_u=0.5)
        G["upperArm." + sd] = [ua]

        # ---- forearm: the jacket sleeve down to the cuff, then a white glove
        el = JW["el" + sd]
        FA = [(0.045, 0.058, 0.060, {}), (-0.010, 0.062, 0.062, {0: (0, -0.030)}), (-0.100, 0.058, 0.060, {}),
              (-0.212, 0.053, 0.056, {}), (-0.240, 0.052, 0.055, {})]
        n_, td_, bk_ = hand_frame(sx)
        fr_ = [FWD] * (len(FA) - 1) + [td_]
        fa, I["farm." + sd] = loft("farm." + sd, [el + V((0, 0, z)) for z, *_ in FA],
                                   [twist(hexprof(w, d, p), sx * 4 * k) for k, (z, w, d, p) in enumerate(FA)], fr_,
                                   REG["farm." + sd], (False, True))
        wr_ = el + V((0, 0, -0.240))
        hd_ = make_hand(sd, sx, wr_, g=1.04, flen=1.0, curl=(28, 80) if sd == "R" else (22, 70))
        I.update(hd_["info"])
        parts = [fa] + hd_["objs"]
        if sd == "R":
            # the dead torch in the right fist: a black hexagonal barrel, a flared head, a dark lens
            a = FWD * math.cos(math.radians(50)) + DN * math.sin(math.radians(50))
            ct = wr_ + DN * 0.082 + hd_["n"] * 0.030
            ts = [-0.062, 0.100, 0.116, 0.205]
            cs_ = [ct + a * t for t in ts]
            rr = [0.0175, 0.0195, 0.033, 0.0375]
            tb_, I["torch"] = loft("torch", cs_, [hexprof(0.87 * r, r) for r in rr], hd_["n"], REG["torch"], (True, True),
                                   cap_u=0.5)
            parts.append(tb_)
        G["lowerArm." + sd] = parts

        # ---- thigh: a straight trouser leg, front crease
        hp = JW["hip" + sd]
        TG = [(0.060, 0.092, 0.104, {}, 0), (-0.280, 0.084, 0.092, {}, 4), (-0.452, 0.076, 0.084, {3: (0, 0.016)}, 6),
              (-0.490, 0.072, 0.078, {}, 6)]
        tg, I["thigh." + sd] = loft("thigh." + sd, [hp + V((0, 0, z)) for z, *_ in TG],
                                    [twist(hexprof(w, d, p), -sx * tw) for z, w, d, p, tw in TG], FWD, REG["thigh." + sd],
                                    (False, True))
        G["upperLeg." + sd] = [tg]

        # ---- shin: the trouser leg over a black dress shoe
        kn = JW["kn" + sd]
        SN = [(0.040, 0.074, 0.080, {}), (-0.150, 0.072, 0.080, {0: (0, -0.008)}), (-0.352, 0.068, 0.078, {})]
        sn, I["shin." + sd] = loft("shin." + sd, [kn + V((0, 0, z)) for z, *_ in SN], [hexprof(w, d, p) for z, w, d, p in SN],
                                   FWD, REG["shin." + sd], (False, True))
        xf = kn.x + sx * 0.006
        ft, I["foot"] = make_foot(sd, sx, xf, s_max=0.196, toe=0.272, w=(0.048, 0.058, 0.056),
                                  tops=(0.084, 0.100, 0.070), toe_h=0.030)
        G["lowerLeg." + sd] = [sn, ft]
    return I, G


# ---------------------------------------------------------------- painting helpers

def button(r, x, y, rad=0.0105):
    """A brass button: dark rim, a lit face, one bright glint texel."""
    rim = r.blob(x, y, rad + 0.6 * r.tx, rad + 0.6 * r.ty, rough=0.0)
    r.lit(rim, 0.55)
    r.blob(x, y, rad, rad, "braid", 1.25, rough=0.0)
    r.fix(x - 0.35 * rad, y - 0.35 * rad, "braid", 4)


def rope(r, pts, w=None, seed=3):
    """Gold cord: a braid line, a shaded twist along it and the odd glint."""
    w = w or 0.55 * r.tx
    r.line(pts, w, "braid", 1.0)
    rg = np.random.default_rng(seed)
    for a, b in zip(pts, pts[1:]):
        n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / (1.4 * r.tx)))
        for k in range(n):
            t = (k + 0.5) / n
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            if k % 2:
                r.blob(x, y, 0.5 * w, 0.5 * w, None, 0.66, rough=0.0)
            elif rg.random() < 0.3:
                r.fix(x, y, "braid", 4)


def paint_head(name, Ph, seed):
    """The head and face painted in 3D from the baked positions: greyish-lilac dead skin, deep
    sockets, milky eyes, and a slack jaw hanging open on a dark, wet mouth with a dribble."""
    x = Ph[..., 0]; Z = Ph[..., 2]; F = YC - Ph[..., 1]
    ax = np.abs(x)
    front = F > 0.035
    Xf = np.where(front, ax, 9.0)
    Xs = np.where(front, x, 9.0)
    phi = np.arctan2(ax, F)
    r = Reg(name, ["skinu", "hollow", "bloodc2", "teeth"], Xs, 1.8 - Z, None, 0.003, 0.003, seed=seed)
    E = lambda x0_, z0, rx, rz: np.sqrt(((Xf - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    Es = lambda x0_, z0, rx, rz: np.sqrt(((Xs - x0_) / rx) ** 2 + ((Z - z0) / rz) ** 2)
    soft = lambda d, s=0.5: np.clip((1 - d) / s, 0, 1)
    EX, EZ = EYE
    r.lit(np.full(x.shape, 1.02), 1.0)
    r.lit(soft(E(0.0, 1.712, 0.07, 0.022)), 1.08)                             # the brow catches the bulb
    r.lit(soft(E(0.068, 1.648, 0.026, 0.010)), 1.14)                          # cheekbone tops
    r.lit(soft(E(0.060, 1.600, 0.026, 0.020), 0.6), 0.74)                     # gaunt hollow cheeks
    r.lit(np.clip((ax - 0.07) / 0.03, 0, 1) * (phi < 1.4), 0.9)               # the sides turn away
    sock = E(EX, EZ + 0.004, 0.031, 0.021) + 0.10 * r.nz
    r.lit(soft(sock, 0.5) * np.clip(0.55 + (Z - EZ) / 0.025, 0.45, 1), 0.36)  # sockets under the brow
    r.lit((E(0.012, EZ + 0.006, 0.008, 0.012) < 1), 0.75)
    r.lit(soft(E(EX, EZ - 0.020, 0.030, 0.008), 0.5), 0.70)                   # heavy eye-bags
    eye = E(EX, EZ, 0.0125, 0.0056) < 1
    r.put(eye, "skinu")
    r.overlay(eye, "skinu", 6)
    r.overlay(eye & (Z > EZ + 0.0030), "skinu", 5)
    r.overlay(E(EX + 0.001, EZ - 0.0008, 0.0040, 0.0038) < 1, "skinu", 3)
    lid = (E(EX + 0.001, EZ - 0.0064, 0.0125, 0.0024) < 1) & ~eye
    r.lit(lid, 0.6)
    r.eye = eye
    nos = E(0.0085, 1.615, 0.0045, 0.0030) < 1
    r.put(nos & (F > 0.096), "hollow")
    r.lit((E(0.0, 1.608, 0.020, 0.0045) < 1) & (F < 0.104), 0.62)
    # the slack mouth: the jaw hangs open, a wet dark cavity, upper teeth, a few lower teeth, a sagging lip
    cav = E(0.0, 1.5625, 0.026, 0.0155) < 1
    r.put(cav, "hollow"); r.lit(cav, 0.55)
    r.lit(cav & (Z < 1.556) & (Xf < 0.016), 1.9)                                # a dull tongue in the dark
    r.put(cav & (Z < 1.556) & (Xf < 0.016), "bloodc2")
    up = (Xf < 0.021) & (Z > 1.5745) & (Z < 1.5815)
    r.put(up, "teeth"); r.overlay(up, "teeth", 2)
    for k in range(1, 5):
        r.overlay(up & (np.abs(Xf - 0.0048 * k + 0.0012) < 0.0009), "teeth", 0)
    lo = (Xf < 0.014) & (Z > 1.5455) & (Z < 1.5500)
    r.put(lo, "teeth"); r.overlay(lo, "teeth", 1)
    r.overlay(lo & (np.abs(Xf - 0.0055) < 0.0008), "teeth", 0)
    r.lit((E(0.0, 1.5875, 0.026, 0.0026) < 1) & ~cav & ~up, 1.16)               # the upper lip ridge
    r.lit((E(0.0, 1.5395, 0.020, 0.0034) < 1) & ~cav, 0.62)                    # the hanging lower lip
    r.lit(soft(E(0.0, 1.520, 0.030, 0.010), 0.4), 0.78)                        # under the lip
    r.lit(np.clip((1.512 - Z) / 0.012, 0, 1) * front, 0.70)                    # under the chin
    # a dribble of dark blood from the left corner of the mouth down the chin
    r.blob(0.024, 1.8 - 1.556, 0.005, 0.004, "bloodc2", rough=0.2)
    r.drip(0.026, 1.8 - 1.554, 0.030, w=0.0018, mat="bloodc2")
    r.drip(0.020, 1.8 - 1.548, 0.018, w=0.0014, mat="bloodc2")
    # short slicked hair round the back and sides, sideburns
    hair = ((phi > 1.25) & (Z > 1.618 + 0.010 * np.cos(phi * 3))) | ((phi > 1.10) & (phi <= 1.25) & (Z > 1.672))
    hair &= Z < 1.80
    r.put(hair, "hollow")
    r.lit(hair, 1.75)
    r.clusters(3.0, 0.2, f=1.35, where=hair, seed=12)
    r.clusters(2.0, 0.45, f=0.7, where=hair, seed=14)
    r.lit(hair * np.clip((1.64 - Z) / 0.02, 0, 1), 0.8)
    # the cap band's dent across the brow, grime, pores, a grey cast on the left jaw
    r.lit(np.abs(Z - 1.729) < 0.0026, 0.72)
    r.clusters(2.2, 0.30, f=0.80, where=(Z > 1.712) & front, seed=9)
    r.lit(soft(Es(0.070, 1.590, 0.013, 0.010) + 0.4 * r.nz, 0.4), 0.70)
    r.clusters(3, 0.50, f=0.9, where=~hair & ~eye & ~up & ~lo, seed=7)
    return r


def paint_hair():
    r = grid_reg("hair", ["hollow"], 0.03, 0.03, 18)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 2.3)
    r.lit(np.sin(U * 40) > 0.3, 1.35)
    r.lit(Vv > 0.7, 0.75)
    return r


def paint_ear():
    r = grid_reg("ear", ["skinu", "hollow"], 0.024, 0.065, 17)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.95)
    r.lit(ell(U, Vv, 0.42, 0.5, 0.30, 0.34) < 1, 0.72)
    r.lit(ell(U, Vv, 0.40, 0.55, 0.14, 0.16) < 1, 0.62)
    r.lit(U > 0.8, 1.18)
    return r


def paint_neck(I, P):
    r = loft_reg("neck", I["neck"], ["skinu", "hollow", "bloodc2"], 13)
    X, Y = r.X, r.Y
    top = Y.max()
    r.lit(np.clip((Y - (top - 0.05)) / 0.05, 0, 1), 0.55)          # under the jaw
    r.lit(np.clip(1 - Y / 0.03, 0, 1), 0.66)                        # collar shadow
    for sg in (-1, 1):                                              # neck tendons as hard planes
        r.line([(sg * 0.034, top - 0.01), (sg * 0.008, 0.012)], 0.004, f=1.16)
        r.line([(sg * 0.044, top - 0.01), (sg * 0.016, 0.012)], 0.003, f=0.82)
    r.clusters(3, 0.45, f=0.85, seed=14)
    return r


# ---------------------------------------------------------------- painting: the uniform

def paint_torso(I):
    r = loft_reg("torso", I["torso"], ["maroon", "braid", "shirtw", "bloodc2"], 21)
    X, Y, tx, ty = r.X, r.Y, r.tx, r.ty
    ax = np.abs(X)
    B = r.B
    Lt = Y.max()
    P = r.P
    # a sun-faded top: dusty shoulders and chest, darker toward the hem
    r.lit(np.clip(1 - Y / 0.30, 0, 1), 1.10)
    r.lit(np.clip((Y - 0.46) / 0.18, 0, 1), 0.86)
    # the white shirt V between the lapels: a placket with two buttons, in shade under the chin
    vee = (ax < 0.022 + 0.19 * np.clip(Y - 0.0, 0, 1)) & (Y < 0.20) & (Y > 0.0)
    r.put(vee, "shirtw")
    r.lit(vee, 0.90)
    r.lit(vee * np.clip(1 - Y / 0.07, 0, 1), 0.58)
    r.lit(vee & (ax > 0.022 + 0.19 * np.clip(Y, 0, 1) - 1.2 * tx), 0.6)
    r.lit(vee & (ax < 0.55 * tx) & (Y > 0.05), 0.72)                # placket
    for yb in (0.09, 0.15):
        r.blob(0.0, yb, 0.0045, 0.0045, "shirtw", 1.3, rough=0.0)
    # yoke and armhole seams across the shoulders
    r.lit(np.abs(Y - 0.100) < 0.5 * ty, 0.72)
    r.lit(np.abs(Y - 0.100 - 1.1 * ty) < 0.5 * ty, 1.14)
    # the double-breasted front: the overlap edge, two columns of three brass buttons
    edge = -0.028
    r.line([(edge, 0.195), (edge - 0.004, Lt - 0.02)], 0.55 * tx, f=0.62)
    r.line([(edge + 1.4 * tx, 0.195), (edge - 0.004 + 1.4 * tx, Lt - 0.02)], 0.55 * tx, f=1.14)
    for yb in (0.235, 0.355, 0.475):
        for xb in (-0.066, 0.066):
            button(r, xb, yb)
    # a welt breast pocket on the left with a thread of piping, and hip pocket flaps
    r.line([(0.070, 0.235), (0.130, 0.228)], 0.6 * tx, "braid", 0.9)
    r.line([(0.070, 0.238 + 1.3 * ty), (0.130, 0.231 + 1.3 * ty)], 0.5 * tx, f=0.6)
    for sg in (-1, 1):
        cx = sg * 0.135
        d = np.abs(X - cx)
        fl = (d < 0.036) & (Y > 0.485) & (Y < 0.512)
        r.lit(fl, 1.16)
        r.lit((d < 0.038) & (Y >= 0.512) & (Y < 0.512 + 1.3 * ty), 0.5)
        r.lit((d < 0.037) & (Y > 0.485 - 1.2 * ty) & (Y <= 0.485), 0.62)
    # the gold aiguillette on the right chest: two swags from the shoulder, a loop, two aglets
    rope(r, [(-0.185, 0.085), (-0.172, 0.150), (-0.150, 0.215), (-0.118, 0.262), (-0.092, 0.265)], seed=4)
    rope(r, [(-0.160, 0.088), (-0.140, 0.140), (-0.112, 0.190), (-0.086, 0.222), (-0.070, 0.245)], seed=5)
    rope(r, [(-0.092, 0.265), (-0.084, 0.330)], seed=6)
    rope(r, [(-0.070, 0.245), (-0.066, 0.300)], seed=7)
    for (ax_, ay_) in ((-0.084, 0.336), (-0.066, 0.306)):
        r.blob(ax_, ay_, 0.0035, 0.0055, "braid", 1.25, rough=0.0)
    # waist seam, the jacket's hem and its centre-back vent
    r.lit(np.abs(Y - 0.395) < 0.45 * ty, 0.74)
    r.lit(np.abs(Y - 0.395 - 1.1 * ty) < 0.45 * ty, 1.10)
    r.lit((Y > Lt - 0.026) & (Y < Lt - 0.022 + 1.1 * ty), 1.2)
    r.lit(Y > Lt - 0.012, 0.62)
    bk = np.abs(np.abs(B) - 0.0) < 0.6 * tx
    r.lit(bk & (Y > 0.10), 0.68)
    r.lit((np.abs(np.abs(B) - P / 2) < 0.6 * tx) & (Y > 0.10), 0.68)
    r.lit((np.abs(np.abs(X) - P / 2) < 0.5 * tx) & (Y > Lt - 0.19), 0.42)                     # the vent's dark slit
    # armpit shadow at the sides, the creased sleeve heads
    for sg in (-1, 1):
        r.blob(sg * P / 4, 0.19, 0.035, 0.045, None, 0.84, rough=0.3)
        for k in range(3):
            r.fold((sg * (P / 4 - 0.03 + 0.03 * k), 0.11), (sg * (P / 4 - 0.02 + 0.03 * k), 0.24), off=(sg * 1.3 * tx, 0))
    # wear: grease down the belly, dusty pale patches, moth holes, blood
    r.clusters(4, 0.28, f=0.80, where=(Y > 0.36) & (ax < 0.13), seed=31)
    r.clusters(5, 0.55, f=0.93, seed=32)
    r.clusters(4, 0.62, f=1.09, where=Y < 0.3, seed=33)
    for (hx_, hy_) in ((0.150, 0.150), (-0.190, 0.34), (0.205, 0.44)):
        h = r.blob(hx_, hy_, 0.006, 0.005, rough=0.2)
        r.lit(h, 0.30)
        r.lit(r.blob(hx_, hy_, 0.011, 0.010, rough=0.3) * (1 - h), 0.66)
    r.splat(-0.090, 0.150, 0.026, drips=3)
    r.blob(-0.070, 0.300, 0.017, 0.012, "bloodc2", 0.9)
    r.blob(P / 2 - 0.07, 0.22, 0.020, 0.014, "bloodc2", 0.9)
    r.drip(P / 2 - 0.08, 0.24, 0.10, w=0.004)
    return r


def paint_lapel():
    r = grid_reg("lapel", ["maroon", "braid"], 0.05, 0.16, 19)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.16)
    edge = (Vv > 0.94) | (np.abs(U - 0.06 - 0.16 * Vv) < 0.05) | (U > 0.90 - 0.04 * Vv)
    r.put((np.abs(U - 0.06 - 0.16 * Vv) < 0.045) | (U > 0.90 - 0.035 * Vv), "braid")   # gold piping along both edges
    r.lit(r.id == r.m("braid"), 0.9)
    r.lit((Vv < 0.06), 0.78)
    r.lit(np.sin(Vv * 90 + U * 8) > 0.86, 0.9)
    return r


def paint_epau():
    """The padded epaulette board: twisted gold cord across a maroon centre, edged in braid (the upper
    part of the region); then its edges: the outer end is a hanging bullion fringe, the sides braid."""
    r = grid_reg("epau", ["maroon", "braid"], 0.13, 0.06, 41)
    U, Vv = r.U, r.V
    top = Vv < 0.62
    r.lit(np.ones_like(U), 1.0)
    r.put(top, "braid")
    r.lit(top, 1.30)
    twist_ = np.sin(U * 78 + np.where(Vv > 0.3, 2.4, 0.0))
    r.lit(top & (twist_ > 0.15), 1.26)
    r.lit(top & (twist_ <= 0.15), 0.72)
    r.lit(top & ((Vv < 0.06) | (Vv > 0.56) | (U < 0.03) | (U > 0.965)), 0.6)
    r.put(top & (np.abs(Vv - 0.31) < 0.07), "maroon")
    r.lit(top & (np.abs(Vv - 0.31) < 0.07), 1.05)
    r.lit(top & (np.abs(Vv - 0.31) < 0.04) & (np.sin(U * 40) > 0), 0.85)
    edge = ~top
    fr = edge & (U < 0.5)                                            # the outer end: hanging bullion strands
    r.put(fr, "braid")
    st = np.sin(U * 2 * 46)
    r.lit(fr & (st > 0.1), 1.24)
    r.lit(fr & (st <= 0.1), 0.66)
    r.lit(fr & (Vv < 0.72), 0.7)
    r.lit(fr & (Vv > 0.92), 0.75)
    side = edge & (U >= 0.5)
    r.put(side, "braid")
    r.lit(side, 0.72)
    r.lit(side & (Vv < 0.72), 1.0)
    return r


def paint_tie():
    r = grid_reg("tie", ["tie"], 0.04, 0.03, 45)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 1.0)
    r.lit((U > 0.40) & (U < 0.60), 1.35)
    r.lit((U > 0.55) & (Vv < 0.35), 1.2)
    r.lit(np.abs(Vv - 0.5) > 0.44, 0.7)
    r.lit(U > 0.88, 0.75)
    return r


def paint_pelvis(I):
    r = loft_reg("pelvis", I["pelvis"], ["maroond", "braid", "bloodc2", "hollow"], 31)
    X, Y, tx, ty, B = r.X, r.Y, r.tx, r.ty, r.B
    r.lit(Y < 0.08, 0.7)
    r.fold((0.004, 0.07), (0.006, 0.19), off=(1.2 * tx, 0))
    for sg in (-1, 1):
        r.fold((sg * 0.10, 0.07), (sg * 0.155, 0.15), off=(-sg * 1.2 * tx, 0))
        r.fold((sg * 0.015, 0.23), (sg * 0.065, 0.155), dark=0.72)
        cx = r.P / 2 + sg * 0.078
        d = np.abs(r.dx(cx))
        pk = (d < 0.034) & (Y > 0.09) & (Y < 0.19)
        r.lit(pk & ~((d < 0.034 - tx) & (Y > 0.09 + ty) & (Y < 0.19 - ty)), 0.64)
    r.clusters(4, 0.40, f=0.75, where=Y > 0.06, seed=3)
    r.clusters(4, 0.55, f=0.9, seed=4)
    return r


def paint_thigh(I, sd):
    L = sd == "L"
    r = loft_reg("thigh." + sd, I["thigh." + sd], ["maroond", "braid", "bloodc2", "mud"], 41 if L else 43)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    inner = -outer
    so = 1 if L else -1
    r.lit(np.full(X.shape, 1.0), 1.0)
    # the gold side stripe on the front-side ridge (seen from the front too): braid with a dark rail either side
    dxs = np.abs(X - 0.80 * outer)
    r.lit((dxs > 0.011) & (dxs < 0.017), 0.6)
    r.put(dxs < 0.011, "braid")
    r.lit(dxs < 0.011, 0.92)
    r.lit((dxs < 0.011) & (np.sin(Y * 110) > 0.4), 1.16)
    r.lit((dxs < 0.011) & (dxs > 0.008), 0.72)
    r.fold((inner, 0.0), (inner, Lt), dark=0.8, off=(so * 1.2 * tx, 0))
    r.fold((so * 0.004, 0.02), (so * 0.006, Lt - 0.02), dark=0.78, off=(so * 1.2 * tx, 0))     # the front crease
    for (y0_, y1_, dx0, dx1) in ((0.04, 0.26, -0.02, 0.06), (0.12, 0.35, -0.05, 0.03), (0.23, 0.43, -0.04, 0.05)):
        r.fold((inner * 0.5 + so * dx0, y0_), (so * dx1, y1_), off=(so * 1.2 * tx, -0.5 * ty), dark=0.8)
    for yk in (Lt - 0.070, Lt - 0.040, Lt - 0.014):                # knee creases
        r.fold((P / 2 - 0.04, yk), (P / 2 + 0.04, yk + 0.006), off=(0, -1.2 * ty))
    r.clusters(3, 0.3, f=0.8, where=(np.abs(X) < 0.07) & (Y > Lt - 0.10), seed=8)
    r.clusters(4, 0.55, f=0.9, seed=9 if L else 10)
    r.clusters(5, 0.45, f=1.10, where=Y < 0.2, seed=11)                              # faded
    if L:
        r.splat(0.05, 0.33, 0.018, drips=1)
    else:
        r.blob(-0.02, 0.12, 0.014, 0.010, "bloodc2", 0.9)
    r.lit(np.clip(Y / Lt, 0, 1), 0.92)
    return r


def paint_shin(I, sd):
    L = sd == "L"
    r = loft_reg("shin." + sd, I["shin." + sd], ["maroond", "braid", "bloodc2", "mud"], 51 if L else 53)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    outer = P / 4 if L else -P / 4
    so = 1 if L else -1
    r.lit(np.full(X.shape, 1.0), 0.92)
    dxs = np.abs(X - 0.80 * outer)
    r.lit((dxs > 0.011) & (dxs < 0.017), 0.6)
    r.put(dxs < 0.011, "braid")
    r.lit(dxs < 0.011, 0.92)
    r.lit((dxs < 0.011) & (np.sin(Y * 110) > 0.4), 1.16)
    r.lit((dxs < 0.011) & (dxs > 0.008), 0.72)
    r.fold((so * 0.004, 0.02), (so * 0.006, Lt - 0.04), dark=0.78, off=(so * 1.2 * tx, 0))
    r.lit((Y > Lt - 0.024) & (Y < Lt - 0.012), 1.14)               # the hem turn-up
    r.lit(Y >= Lt - 0.012, 0.55)
    for (p0, p1) in (((-0.02, 0.06), (0.01, 0.17)), ((0.04, 0.09), (0.02, 0.20)), ((P / 2 - 0.02, 0.04), (P / 2, 0.15))):
        r.fold(p0, p1, dark=0.8)
    r.clusters(4, 0.40, mat="mud", where=np.clip((Y - Lt * 0.6) / (Lt * 0.4), 0, 1) > 0.5, seed=11 if L else 12)
    r.clusters(4, 0.55, f=0.9, seed=13)
    if L:
        r.splat(0.02, 0.12, 0.020, drips=2)
    else:
        r.blob(-0.03, 0.16, 0.012, 0.01, "bloodc2", 0.9)
    return r


def paint_foot(I):
    info = I["foot"]
    r = loft_reg("foot", info, ["shoe", "mud", "braid", "glove"], 62)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    U = X / P + 0.5
    st = info["xs"][1]
    sole = (U < st[1]) | (U > st[7])
    welt = ((U >= st[1]) & (U < st[2])) | ((U > st[6]) & (U <= st[7]))
    r.lit(np.ones(X.shape), 1.0)
    r.lit(sole, 0.45)
    r.lit(welt, 1.3)
    r.lit((np.abs(U - st[2]) < 0.012) | (np.abs(U - st[6]) < 0.012), 0.66)
    Lt = info["d"][-1]
    toe = Y > Lt - 0.07
    r.lit(toe & ~sole, 1.28)                                        # polished toe cap
    r.lit((np.abs(Y - (Lt - 0.070)) < 0.005) & ~sole, 0.6)
    r.clusters(1.4, 0.6, f=1.4, where=toe & ~sole & (np.abs(X) < 0.04), seed=17)
    lace = (np.abs(X) < 0.016) & (Y > 0.05) & (Y < 0.15)
    r.lit(lace, 0.78)
    for yk in np.arange(0.055, 0.15, 0.02):
        r.line([(-0.011, yk), (0.011, yk + 0.008)], 0.5 * tx, "glove", 0.6)
    r.clusters(3, 0.45, mat="mud", where=(np.abs(r.B) < 0.10) & ~sole & (Y < 0.10), seed=15)
    r.clusters(2.2, 0.55, f=0.75, where=~sole, seed=16)              # scuffs
    return r


def paint_cap_reg(I):
    info = I["cap"]
    r = loft_reg("cap", info, ["maroon", "braid", "hollow", "bloodc2"], 101)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    ax = np.abs(X)
    r.lit(np.full(X.shape, 1.08), 1.0)
    r.lit(Y < 0.006, 1.2)
    # a gold band round the base with a dark rail above and below, a twisted-cord look
    band = Y > Lt - 0.024
    r.lit((Y > Lt - 0.029) & (Y <= Lt - 0.024), 0.6)
    r.put(band, "braid")
    r.lit(band, 0.95)
    r.lit(band & (np.sin(X * 300 + Y * 20) > 0.35), 1.2)
    r.lit(band & (Y > Lt - 0.0045), 0.6)
    # the top piping under the flat crown
    r.put(Y < 0.008, "braid")
    r.lit(Y < 0.008, 0.9)
    r.lit((Y >= 0.008) & (Y < 0.008 + 1.2 * ty), 0.62)
    # a brass badge on the front: a small disc with a dark ring and a glint, a spoked star inside
    bd = ell(X, Y, 0.0, 0.058, 0.019, 0.019) < 1
    r.lit(ell(X, Y, 0.0, 0.058, 0.023, 0.023) < 1, 0.55)
    r.put(bd, "braid")
    r.lit(bd, 1.1)
    for ang in (0, 0.785, 1.571, 2.356):
        dx_, dy_ = math.cos(ang) * 0.014, math.sin(ang) * 0.014
        r.line([(-dx_, 0.058 - dy_), (dx_, 0.058 + dy_)], 0.4 * tx, f=0.62)
    r.fix(-0.007, 0.050, "braid", 4)
    # faded and grimy, moth-holed, a stain
    r.clusters(3, 0.40, f=0.86, seed=102)
    r.clusters(4, 0.60, f=1.12, where=Y < Lt - 0.03, seed=104)
    r.blob(-0.14, 0.05, 0.014, 0.012, "bloodc2", 0.9)
    for (hx_, hy_) in ((0.10, 0.03), (0.19, 0.046)):
        r.blob(hx_, hy_, 0.004, 0.004, "hollow", rough=0.1)
    return r


def paint_captop():
    r = grid_reg("captop", ["maroon", "braid"], 0.19, 0.19, 106)
    U, Vv = r.U, r.V
    rr = np.hypot(U - 0.5, Vv - 0.5)
    r.lit(np.full(U.shape, 1.14), 1.0)
    r.lit(rr > 0.44, 0.8)
    r.put(rr > 0.455, "braid")
    r.lit(rr > 0.455, 0.9)
    r.put(rr < 0.09, "braid")                                       # a gold button in the middle
    r.lit(rr < 0.09, 1.2)
    r.lit((rr < 0.09) & (U + Vv < 0.95), 1.35)
    r.lit((rr >= 0.09) & (rr < 0.13), 0.7)
    r.clusters(1.5, 0.5, f=0.88, seed=107)
    return r


def paint_strap():
    r = grid_reg("strap", ["braid"], 0.04, 0.02, 108)
    U, Vv = r.U, r.V
    r.lit(np.ones_like(U), 0.95)
    r.lit(np.sin(U * 40 + Vv * 3) > 0.2, 1.2)
    r.lit(np.sin(U * 40 + Vv * 3) < -0.5, 0.7)
    return r


def paint_uarm(I, sd):
    L = sd == "L"
    info = I["uarm." + sd]
    r = loft_reg("uarm." + sd, info, ["maroon", "braid", "bloodc2", "hollow"], 71 if L else 73)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.clip(1 - Y / 0.16, 0, 1), 1.10)
    r.lit(np.abs(Y - 0.045) < 0.6 * ty, 0.68)                       # the armhole seam
    r.lit(np.abs(Y - 0.045 + 1.2 * ty) < 0.6 * ty, 1.15)
    for k in range(3):                                              # inner elbow creases
        r.fold((P / 2 - 0.05 + k * 0.03, Lt - 0.10), (P / 2 - 0.035 + k * 0.03, Lt - 0.03))
    r.fold((-0.03, 0.09), (0.02, 0.14))
    r.fold((0.05, 0.13), (0.03, 0.22), dark=0.78)
    r.lit(np.abs(Y - (Lt - 0.004)) < 0.6 * ty, 0.62)
    r.clusters(4, 0.45, f=0.80, seed=16 if L else 17)
    r.clusters(5, 0.60, f=1.10, where=Y < 0.16, seed=18)
    if L:                                                            # a moth hole and a rip
        h = r.blob(0.035, 0.12, 0.006, 0.006, "hollow", rough=0.2)
        r.lit(r.blob(0.035, 0.12, 0.012, 0.011, rough=0.3) * (1 - h), 0.62)
    else:
        r.blob(0.02, 0.15, 0.010, 0.008, "bloodc2")
    return r


def paint_farm(I, sd):
    L = sd == "L"
    info = I["farm." + sd]
    r = loft_reg("farm." + sd, info, ["maroon", "braid", "skinu", "hollow", "bloodc2"], 81 if L else 83)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.clip(1 - Y / 0.05, 0, 1), 0.62)                        # under the armhole
    r.lit(np.abs(r.B) < 0.05, 0.92)                                 # underside
    # cuff: two gold braid rings and a slash, a dark rail beside them
    for y0_ in (Lt - 0.052, Lt - 0.030):
        r.put((Y > y0_) & (Y < y0_ + 0.012), "braid")
        r.lit((Y > y0_) & (Y < y0_ + 0.012), 0.95)
        r.lit((Y > y0_) & (Y < y0_ + 0.012) & (np.sin(X * 260 + Y * 20) > 0.3), 1.2)
        r.lit((Y > y0_ + 0.012) & (Y < y0_ + 0.012 + 1.3 * ty), 0.6)
        r.lit((Y > y0_ - 1.2 * ty) & (Y <= y0_), 0.62)
    r.lit(Y > Lt - 0.004, 0.42)
    r.fold((0.03, 0.10), (0.02, 0.17))
    r.fold((-0.05, 0.08), (-0.03, 0.15), dark=0.78)
    r.clusters(4, 0.45, f=0.80, seed=84 if L else 85)
    r.clusters(5, 0.6, f=1.10, where=Y < 0.15, seed=86)
    if L:
        # the left sleeve is torn open along the outer forearm: a jagged patch of grey skin, frayed thread
        rg = np.random.default_rng(88)
        c0, c1 = 0.06, 0.20
        edge = []
        for k in range(12):
            yy = c0 + (c1 - c0) * k / 11
            edge.append((0.040 + 0.02 * math.sin(k * 1.7) + rg.uniform(-0.008, 0.008), yy))
        edge2 = [(-0.004 + 0.018 * math.sin(k * 2.1 + 1) + rg.uniform(-0.006, 0.006), yy) for (_, yy), k in zip(edge, range(12))]
        poly = edge + edge2[::-1]
        hole = inpoly(X, Y, poly)
        r.put(hole, "skinu")
        r.lit(hole, 0.86)
        for (px_, py_) in poly:
            r.blob(px_, py_, 0.004, 0.004, None, 0.6, rough=0.0)
        r.lit(hole & (Y < c0 + 0.02), 0.6)
        r.lit(hole & (np.abs(X - 0.018) < 0.008) & (Y > c0 + 0.05) & (Y < c1 - 0.03), 1.16)
        r.blob(0.02, c0 + 0.09, 0.008, 0.02, "bloodc2", 0.9)
    else:
        r.splat(0.03, 0.07, 0.014, drips=2)
    return r


def paint_glove(name, I, sd, part, seed):
    """White gloves, dirty ivory: three raised points on the back of the hand, a cuff button.
    The left glove is torn: the fingertips are out and the back is split open on grey skin."""
    L = sd == "L"
    r = loft_reg(name, I[name], ["glove", "skinu", "bloodc2", "hollow"], seed)
    X, Y, tx, ty, Pm = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.ones(X.shape), 0.96)
    r.clusters(2.5, 0.35, f=0.78, seed=seed + 1)                       # grimy smudges
    r.clusters(2.0, 0.65, f=0.66, seed=seed + 2)
    if part == "palm":
        r.lit(np.abs(r.B) < 0.03, 0.82)                                 # the palm side
        for x0_ in (-0.02, 0.0, 0.02):                                   # the three raised points (stitch lines)
            r.line([(x0_ * 0.6, 0.03), (x0_, Lt - 0.012)], 0.5 * tx, f=0.66)
            r.line([(x0_ * 0.6 + 1.3 * tx, 0.03), (x0_ + 1.3 * tx, Lt - 0.012)], 0.5 * tx, f=1.14)
        r.lit(np.clip(1 - Y / 0.02, 0, 1), 0.72)
        r.lit((Y > 0.004) & (Y < 0.004 + 1.4 * ty), 1.14)                # the glove's wrist edge
        r.blob(0.026, 0.015, 0.0045, 0.0045, "hollow", rough=0.0)        # cuff button hole
        if L:
            # the back of the glove is split open on grey skin
            bx = np.abs(r.B) < 0.05
            sk = (np.abs(r.dx(-0.0) - 0.0) < 0.05) & (Y > 0.03) & (Y < 0.075) & (np.abs(X - 0.005 - 0.03 * np.sin(Y * 90)) < 0.024)
            sk = sk & (np.abs(r.B) > 0.02)
            r.put(sk, "skinu")
            r.lit(sk, 0.9)
            r.lit(sk & (Y < 0.04), 0.66)
        r.blob(0.0, Lt - 0.03, 0.012, 0.010, "bloodc2", 0.85)
    elif part == "fing":
        back = np.abs(X) < Pm / 4
        r.lit(~back, 0.82)
        for xk in (-0.0235, 0.0, 0.0235):
            r.lit(np.abs(X - xk) < 0.55 * tx, 0.6)
            r.lit(np.abs(r.B - xk) < 0.55 * tx, 0.62)
        r.lit(back & (np.abs(Y - Lt * 0.5) < 0.004), 0.72)
        r.lit(back & (np.abs(Y - Lt * 0.5 + 0.005) < 0.003), 1.2)
        if L:
            r.put(Y > Lt - 0.020 + 0.005 * r.nz, "skinu")               # fingertips out of the torn glove
            r.lit((Y > Lt - 0.020) & (Y < Lt - 0.016), 0.62)
            r.lit(Y > Lt - 0.010, 0.85)
            r.put((Y > Lt - 0.008) & (np.abs(np.abs(X) - 0.010) < 0.005) & (np.abs(X) > 0.0), "hollow")   # ragged nails
        else:
            r.clusters(1.5, 0.5, f=0.7, where=Y > Lt - 0.03, seed=seed + 5)
    else:
        r.lit((X / Pm + 0.5) > 0.75, 0.8)
        if L:
            r.put(Y > Lt - 0.012, "skinu")
    return r


def paint_torch(I):
    info = I["torch"]
    r = loft_reg("torch", info, ["blacksteel", "torchglass", "braid", "bloodc2"], 121)
    X, Y, tx, ty, P = r.X, r.Y, r.tx, r.ty, r.P
    Lt = Y.max()
    r.lit(np.full(X.shape, 1.0), 1.0)
    # lengthwise facets catch the bulb; a knurled grip band; a chrome ring at the collar; a dead, cracked lens
    r.lit(np.abs(np.sin(X / P * 6 * math.pi)) > 0.85, 1.5)
    grip = (Y > 0.030) & (Y < 0.130)
    r.lit(grip & (np.sin(Y * 420) > 0.2), 1.28)
    r.lit(grip & (np.sin(Y * 420) <= 0.2), 0.8)
    ring = (Y > 0.160) & (Y < 0.172)
    r.put(ring, "braid")
    r.lit(ring, 0.8)
    r.lit((Y > 0.172) & (Y < 0.180), 0.6)
    head = Y > 0.182
    r.lit(head, 1.15)
    r.lit(Y > Lt - 0.004, 1.0)
    r.put(Y > Lt - 0.010, "torchglass")                                 # the lens rim and glass (the end cap takes its colour)
    r.lit(Y > Lt - 0.010, 0.9)
    r.overlay(Y > Lt - 0.003, "torchglass", 1)
    r.clusters(2.0, 0.45, f=0.7, seed=122)
    r.blob(0.01, 0.05, 0.007, 0.006, "bloodc2", 0.8)
    r.lit(Y < 0.012, 0.7)
    return r


def paint_eyes():
    """The eye-quad patch: a milky almond, a faint grey pupil."""
    x0, y0, w, h = REG["eyes"]
    U, Vv = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    a = np.zeros((h, w, 3)); a[:] = C((206, 202, 190))
    a[(np.abs(U - 0.5) < 0.30) & (Vv < 0.3)] = C((178, 174, 166))
    a[ell(U, Vv, 0.52, 0.55, 0.15, 0.32) < 1] = C((150, 150, 148))
    a[ell(U, Vv, 0.40, 0.40, 0.05, 0.12) < 1] = C((226, 224, 212))
    return a


def paint_page(I, light, pos):
    P = lambda name, joint: preg(pos, name, joint)
    face = paint_head("head", P("head", "neck"), 11)
    regs = [face, paint_head("nose", P("nose", "neck"), 12), paint_ear(), paint_hair(),
            paint_neck(I, None), paint_lapel(), paint_torso(I), paint_pelvis(I), paint_epau(), paint_tie(), paint_foot(I), paint_cap_reg(I), paint_captop(), paint_strap(), paint_torch(I)]
    for sd in "LR":
        regs += [paint_thigh(I, sd), paint_shin(I, sd), paint_uarm(I, sd), paint_farm(I, sd)]
        for part, seed in (("palm", 91), ("fing", 92), ("thumb", 95)):
            regs.append(paint_glove(part + "." + sd, I, sd, part, seed + (0 if sd == "L" else 10)))
    page, glow = H.compose_page(regs, light)
    x0, y0, w, h = REG["eyes"]
    page[y0:y0 + h, x0:x0 + w] = paint_eyes()
    glow[y0:y0 + h, x0:x0 + w] = paint_eyes() * 0.6
    x0, y0, w, h = REG["head"]
    glow[y0:y0 + h, x0:x0 + w][face.eye] = C((84, 84, 78))
    return page, glow


H.setup("usher", "The Usher", "art/zombies/z_usher.py", PAGE, PARTS, build_rest, paint_page,
        head_parts=["head", "eyes", "pillbox"], headwear=["pillbox"], joints=None, ramps=RAMPS, gain=GAIN,
        hat_parts=("pillbox",), jaw_z=JAW_Z, face_cam=(-0.02, 0.13),
        glow={"page": "usher_glow.png", "emissiveIntensity": 0.4, "parts": ["head", "eyes"],
              "note": "only the dim milky eyes glow"},
        note="palace horde: a faded maroon usher. pillbox is always worn and goes with the head on a headshot "
             "(head_parts); tint instances 0.8-1.1 (head: skin tint); draw eyes unlit; the torch is part of "
             "lowerArm.R and the torn glove part of lowerArm.L; lowerLeg.L/R are the trouser legs and shoes "
             "(hidden when he crawls)")
H.main()
