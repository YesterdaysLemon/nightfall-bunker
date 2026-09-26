# Kintsugi (porcelain): an antique porcelain figurine of a 1940s woman turned
# zombie, broken and repaired with gold. Museum display on dark velvet.
#   node art/zombies/blend.mjs z_porcelain.py --preview [--views front,side,back]
#
# Pipeline
#   body     Skin-modifier skeleton + volume blobs (hips, ribs, bust, palms) + skull
#            blobs and a quad-sphere cranium with sculpted hair volume/waves, fused by
#            one voxel remesh, then sculpted by code (gaunt face, orbits, collarbones,
#            neck tendons, knees, shins, elbows, wrists, hand tendons).
#   breakage Exact booleans with jagged cutters. Holes (skull, eyes, shins) are
#            opened, then the figure is solidified into a hollow 6.5 mm ceramic
#            shell whose broken rims show unglazed bisque; flakes expose bisque; the
#            mouth and nostrils are dark cavities; one finger is snapped off.
#   dress    Skirt = cloth drape over a skin-body collider (pinned waist, seeded
#            godets, broken hem), UV'd from its rest grid so the print follows the
#            folds, then "fired" rigid with solidify. A torn sleeve flap sags by soft
#            body. Sleeves, collar, belt, buckle, buttons and the rolled-sheet victory
#            rolls are swept / surface-snapped pieces.
#   glaze    One shader: numpy-painted cobalt rose tile (triplanar on the body, UV on
#            the skirt), clear-coated ivory glaze with a touch of subsurface, iron
#            specks, three-scale distorted Voronoi crack network in figure space ->
#            gold kintsugi seams (metal + raised bump). Point colour 'pc' masks:
#            R dress print, G gilding, B solid cobalt, A print allowed.
# Scratch: floral_tile.png and a cached skirt bake (skirt_<hash>.npy) in the output dir.
import os, sys, math, random, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix, Euler, kdtree
from mathutils.bvhtree import BVHTree

STYLE = "porcelain"
OUT = os.path.join(kit.OUT_BASE, STYLE)
os.makedirs(OUT, exist_ok=True)
FINAL = kit.cli()["mode"] == "final"
VOXEL = 0.004
TILE = 0.6          # metres covered by one painted floral tile
SHELL = 0.0065        # porcelain wall thickness


def nrm(*a):
    return V(a).normalized()


def ss(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------- geometry helpers

def catmull(pts, n=4):
    pts = [V(p) for p in pts]
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def lerp_list(vals, m):
    """Resample a list of numbers to m entries (linear)."""
    out = []
    for i in range(m):
        t = i / (m - 1) * (len(vals) - 1)
        k = min(int(t), len(vals) - 2)
        f = t - k
        out.append(vals[k] * (1 - f) + vals[k + 1] * f)
    return out


def frames(pts, closed=False):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    n = len(pts)
    if closed:
        T = [(pts[(i + 1) % n] - pts[i - 1]).normalized() for i in range(n)]
    else:
        T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    up = V((0, 0, 1)) if abs(T[0].z) < 0.9 else V((1, 0, 0))
    N = [T[0].cross(up).normalized()]
    for i in range(1, n):
        b = T[i - 1].cross(T[i])
        if b.length < 1e-9:
            N.append(N[-1].copy())
            continue
        ang = math.acos(max(-1.0, min(1.0, T[i - 1].dot(T[i]))))
        N.append((Matrix.Rotation(ang, 3, b.normalized()) @ N[-1]).normalized())
    return T, N, [T[i].cross(N[i]) for i in range(n)]


def sweep(name, pts, radii, seg=12, caps=(True, True), parent=None, profile=None, closed=False):
    """Tube / profile sweep with twist-free frames. `profile` = list of (u, v) in
    the normal/binormal plane (scaled by radius); default a circle."""
    pts = [V(p) for p in pts]
    T, N, B = frames(pts, closed)
    prof = profile or [(math.cos(2 * math.pi * k / seg), math.sin(2 * math.pi * k / seg)) for k in range(seg)]
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        r = radii[i] if hasattr(radii, "__len__") else radii
        rx, ry = r if isinstance(r, tuple) else (r, r)
        rings.append([bm.verts.new(p + N[i] * u * rx + B[i] * v * ry) for u, v in prof])
    m = len(prof)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for r0, r1 in pairs:
        for k in range(m):
            bm.faces.new((r0[k], r0[(k + 1) % m], r1[(k + 1) % m], r1[k]))
    capf = []
    if not closed:
        if caps[0]:
            capf.append(bm.faces.new(list(reversed(rings[0]))))
        if caps[1]:
            capf.append(bm.faces.new(rings[-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.mesh_obj(name, bm, parent)
    return ob


def jagged_blob(name, c, r, seed, level=3, jag=0.28, fine=0.07, scale=(1, 1, 1), rot=None):
    """A closed, angular, crumpled blob: a boolean cutter for breaks and chips."""
    rs = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=level, radius=1.0)
    off = V((rs.uniform(-9, 9), rs.uniform(-9, 9), rs.uniform(-9, 9)))
    from mathutils import noise
    for v in bm.verts:
        d = v.co.normalized()
        k = 1 + jag * noise.noise(d * 1.6 + off) + fine * noise.noise(d * 7.0 + off * 1.3) \
            + fine * 0.9 * noise.noise(d * 17.0 + off * 0.7) + fine * 0.7 * (rs.random() - 0.5)
        v.co = d * k
        v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        if rot is not None:
            v.co = rot @ v.co
        v.co = V(c) + v.co * r
    ob = kit.mesh_obj(name, bm, smooth=False)
    return ob


def ik(hip, ank, l1, l2, pole):
    d = ank - hip
    L = min(d.length, l1 + l2 - 1e-4)
    a = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    dn = d.normalized()
    p = (pole - dn * pole.dot(dn)).normalized()
    return hip + dn * a + p * h


# --------------------------------------------------------------------------- pose

HEAD_C = V((0.02, -0.112, 1.522))
HEAD_R = Euler((0.14, 0.2, 0.22), "XYZ").to_matrix()      # pitch down, loll to her left, turn
HEAD_M = Matrix.Translation(HEAD_C) @ HEAD_R.to_4x4()


def pose():
    J = {}

    def put(n, co, r):
        J[n] = [V(co), r if isinstance(r, tuple) else (r, r)]

    put("pelvis", (0, 0.0, 0.90), (0.10, 0.08))
    put("waist", (0, -0.014, 1.02), (0.08, 0.064))
    put("chest", (0, -0.042, 1.155), (0.094, 0.07))
    put("uchest", (0, -0.062, 1.26), (0.098, 0.064))
    put("neckb", (0, -0.08, 1.34), 0.049)
    put("neck", (0.006, -0.1, 1.405), 0.04)
    put("headb", HEAD_M @ V((0, 0.012, -0.055)), 0.03)
    # arms: right (-X) reaches forward, left (+X) hangs
    shR = V((-0.15, -0.09, 1.31))
    elR = shR + nrm(-0.12, -0.72, -0.68) * 0.28
    wrR = elR + nrm(0.06, -0.96, -0.18) * 0.245
    shL = V((0.152, -0.058, 1.305))
    elL = shL + nrm(0.3, 0.06, -1) * 0.28
    wrL = elL + nrm(0.1, -0.32, -1) * 0.245
    for s, sh, el, wr in (("R", shR, elR, wrR), ("L", shL, elL, wrL)):
        put(f"cl.{s}", J["uchest"][0].lerp(sh, 0.55) + V((0, 0, 0.03)), 0.038)
        put(f"sh.{s}", sh, 0.041)
        put(f"ua.{s}", sh.lerp(el, 0.4), 0.037)
        put(f"el.{s}", el, 0.029)
        put(f"fa.{s}", el.lerp(wr, 0.3), 0.032)
        put(f"wr.{s}", wr, 0.02)
    # legs via 2-bone IK: left forward with bent knee, right trailing, heel lifted
    hipL, ankL = V((0.084, 0.0, 0.868)), V((0.118, -0.1, 0.112))
    hipR, ankR = V((-0.084, 0.012, 0.876)), V((-0.125, 0.19, 0.142))
    for s, hp, an in (("L", hipL, ankL), ("R", hipR, ankR)):
        kn = ik(hp, an, 0.41, 0.37, V((0, -1, 0)))
        put(f"hip.{s}", hp, 0.078)
        put(f"th.{s}", hp.lerp(kn, 0.45), 0.068)
        put(f"kn.{s}", kn, 0.049)
        put(f"cf.{s}", kn.lerp(an, 0.3), 0.054)
        put(f"sn.{s}", kn.lerp(an, 0.7), 0.035)
        put(f"an.{s}", an, 0.025)
    aL, aR = J["an.L"][0], J["an.R"][0]
    # left: flat foot on a low heel
    put("heel.L", aL + V((0, 0.03, -0.058)), 0.024)
    put("post.L", aL + V((0, 0.032, -0.104)), 0.011)
    put("ball.L", aL + V((0, -0.118, -0.09)), (0.03, 0.02))
    put("toe.L", aL + V((0, -0.168, -0.094)), 0.017)
    # right: trailing, on the toe, heel lifted
    put("heel.R", aR + V((0, 0.03, -0.034)), 0.024)
    put("post.R", aR + V((0, 0.036, -0.08)), 0.011)
    put("ball.R", aR + V((0, -0.092, -0.114)), (0.03, 0.02))
    put("toe.R", aR + V((0, -0.143, -0.124)), 0.017)
    B = [("pelvis", "waist"), ("waist", "chest"), ("chest", "uchest"), ("uchest", "neckb"),
         ("neckb", "neck"), ("neck", "headb")]
    for s in "LR":
        B += [("uchest", f"cl.{s}"), (f"cl.{s}", f"sh.{s}"), (f"sh.{s}", f"ua.{s}"), (f"ua.{s}", f"el.{s}"),
              (f"el.{s}", f"fa.{s}"), (f"fa.{s}", f"wr.{s}"),
              ("pelvis", f"hip.{s}"), (f"hip.{s}", f"th.{s}"), (f"th.{s}", f"kn.{s}"), (f"kn.{s}", f"cf.{s}"),
              (f"cf.{s}", f"sn.{s}"), (f"sn.{s}", f"an.{s}"), (f"an.{s}", f"heel.{s}"), (f"heel.{s}", f"post.{s}"),
              (f"an.{s}", f"ball.{s}"), (f"ball.{s}", f"toe.{s}")]
    return J, B


def hand_frame(J, s):
    wr = J[f"wr.{s}"][0]
    fa = J[f"fa.{s}"][0]
    if s == "R":   # reaching, palm down, wrist drooping
        f = nrm(0.04, -0.55, -0.83)
        n0 = V((0.2, 0.3, -1))
    else:          # hanging, palm toward the thigh
        f = nrm(0.1, -0.36, -1)
        n0 = V((-1, 0.2, 0))
    n = (n0 - f * n0.dot(f)).normalized()
    side = f.cross(n)
    return wr, f, n, side


# --------------------------------------------------------------------------- head (head-local space)

def hair_weight(p):
    d = V((p.x / 0.072, p.y / 0.09, p.z / 0.1)).normalized()
    el = math.asin(max(-1.0, min(1.0, d.z)))
    a = abs(math.atan2(d.x, -d.y))
    th = float(np.interp(a, [0, 0.45, 0.85, 1.25, 1.65, 2.3, math.pi], [0.56, 0.5, 0.26, 0.04, -0.28, -0.52, -0.6]))
    return ss(th - 0.03, th + 0.1, el)


def make_head():
    """Cranium quad sphere with sculpted hair volume and waves (head-local).
    The face is built from skull blobs fused later by the body remesh."""
    hd = kit.quad_sphere("Head", 0.1, 5, loc=(0, 0.01, 0.012), scale=(0.7, 0.88, 0.92))
    s = kit.Sculpt(hd)
    s.inflate((0, 0.07, 0.02), 0.07, 0.005)                     # fuller occiput
    s.refresh()
    for i, v in enumerate(s.bm.verts):
        w = hair_weight(v.co)
        if w > 0:
            d = v.co.normalized()
            v.co += s.normals[i] * w * (0.011 + 0.008 * max(0.0, d.z) + 0.004 * max(0.0, d.y * 1.5))
    s.smooth(2, 0.4)
    s.refresh()
    bvh = BVHTree.FromBMesh(s.bm)

    def on(el, az, lift=0.0):
        d = V((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        hit = bvh.ray_cast(d * 0.3, -d)
        return (hit[0] if hit[0] is not None else d * 0.1) + d * lift

    for k, el0 in enumerate((-0.5, -0.28, -0.06, 0.18, 0.42)):
        pts = [on(el0 + 0.07 * math.sin(a * 5 + k), a) for a in np.linspace(1.2, 2 * math.pi - 1.2, 28)]
        s.crease_stroke(pts, 0.009, 0.0045)
    for az in (-0.95, -0.55, 0.55, 0.95):
        pts = [on(el, az * (1.2 - el * 0.35)) for el in np.linspace(0.35, 1.25, 12)]
        s.crease_stroke(pts, 0.007, 0.0035)
    s.smooth(1, 0.3)
    s.done()
    blobs = [hd]
    for nm, c, r, sc in (("Jaw", (0, -0.036, -0.066), 0.05, (0.94, 0.98, 0.8)),
                         ("Chin", (0, -0.072, -0.097), 0.017, (1.15, 0.9, 0.85)),
                         ("CheekL", (0.047, -0.058, -0.02), 0.021, (1.0, 1.3, 0.68)),
                         ("CheekR", (-0.047, -0.058, -0.02), 0.021, (1.0, 1.3, 0.68)),
                         ("Brow", (0, -0.07, 0.028), 0.048, (1.2, 0.36, 0.28)),
                         ("Nose", (0, -0.092, -0.016), 0.0105, (0.6, 0.95, 1.7))):
        blobs.append(kit.quad_sphere(nm, r, 3, loc=c, scale=sc))
    return blobs, bvh, on


def sculpt_face(s):
    """Skeletal, gaunt face sculpted on the fused mesh (head-local brush positions)."""
    HL = lambda p: s.kd.find(HEAD_M @ V(p))[0]
    s.smooth(2, 0.5, c=HEAD_M @ V((0, -0.05, -0.04)), r=0.09)
    s.refresh()
    for sx in (-1, 1):
        s.inflate(HL((sx * 0.03, -0.09, -0.002)), 0.03, -0.013)                  # deep orbits
        s.inflate_stroke([HL((sx * 0.01, -0.1, 0.024)), HL((sx * 0.035, -0.098, 0.026)),
                          HL((sx * 0.058, -0.075, 0.018))], 0.011, 0.003)        # brow ridge
        s.inflate(HL((sx * 0.046, -0.075, -0.056)), 0.026, -0.011)               # hollow cheeks
        s.inflate(HL((sx * 0.066, -0.03, 0.02)), 0.026, -0.006)                  # temples
        s.inflate_stroke([HL((sx * 0.055, -0.03, -0.022)), HL((sx * 0.057, -0.065, -0.026))], 0.012, 0.003)
        s.crease_stroke([HL((sx * 0.058, -0.02, -0.085)), HL((sx * 0.04, -0.07, -0.108)),
                         HL((sx * 0.01, -0.09, -0.118))], 0.012, 0.004, kind="smooth")   # under the jaw
    s.inflate_stroke([HL((0, -0.1, 0.012)), HL((0, -0.106, -0.016)), HL((0, -0.112, -0.03))], 0.008, 0.004)
    s.inflate(HL((0, -0.1, -0.072)), 0.022, -0.004)                              # receded lips
    s.smooth(1, 0.3, c=HEAD_M @ V((0, -0.07, -0.03)), r=0.08)


def rolled(name, path, R=0.021, turns=1.7, thick=0.0042, grow=0.4, nprof=72, taper=0.12, parent=None):
    """A rolled hair curl: a spiral cross-section (a rolled sheet) swept along a
    path, so both ends show the curl spiral. Ends taper a little."""
    path = catmull(path, 5)
    prof = []
    total = 2 * math.pi * turns
    outer, inner = [], []
    for k in range(nprof):
        a = total * k / (nprof - 1)
        r = 1.0 - grow * a / (2 * math.pi)
        rr = r * (1 + (0.035 * math.sin(a * 9) if a < 2 * math.pi else 0.0))
        outer.append((math.cos(a) * rr, math.sin(a) * rr))
        ri = r - thick / R
        inner.append((math.cos(a) * ri, math.sin(a) * ri))
    prof = outer + list(reversed(inner))
    m = len(path)
    radii = []
    for i in range(m):
        t = i / (m - 1)
        e = min(t, 1 - t)
        radii.append(R * (1 - taper + taper * ss(0.0, 0.25, e)))
    return sweep(name, path, radii, profile=prof, parent=parent)


def make_hair_rolls(on):
    """Victory rolls, side sausage curls and a nape roll (head-local)."""
    rolls = []
    for sx in (-1, 1):
        # victory roll: front hairline back over the top
        pts = [on(el, sx * az, 0.012) for el, az in ((0.5, 0.36), (0.72, 0.4), (0.95, 0.46), (1.15, 0.56))]
        rolls.append(rolled(f"VRoll{sx}", pts, R=0.0185, turns=1.8))
        # side curls stacked over the ear, running front to back
        for j, el in enumerate((0.16, -0.08, -0.3)):
            pts = [on(el, sx * az, 0.01) for az in (1.1 + 0.08 * j, 1.4, 1.72, 1.98)]
            rolls.append(rolled(f"SCurl{sx}{j}", pts, R=0.0155 - 0.0015 * j, turns=1.6))
    # nape roll across the back of the head (a 1940s rolled bun)
    pts = [on(-0.42 + 0.04 * math.cos(a * 2), a, 0.016) for a in np.linspace(1.75, 2 * math.pi - 1.75, 9)]
    rolls.append(rolled("NapeRoll", pts, R=0.024, turns=1.9))
    # crown curl
    pts = [on(0.95, az, 0.012) for az in (2.3, 2.7, 3.14, 3.55, 3.95)]
    rolls.append(rolled("CrownRoll", pts, R=0.018, turns=1.6))
    return rolls


# --------------------------------------------------------------------------- materials

MAT_SLOTS = ["Porcelain", "Flake", "Socket", "Inner", "Inner", "Inner", "Rim", "Rim", "Rim", "CutMarker"]
INNER_OFS, RIM_OFS = 3, 6


def paint_floral(path, N=1024, seed=11):
    """Paint a tileable cobalt underglaze motif (roses, leaves, vines, blossoms) as
    an ink-density map with numpy: washes plus darker brush outlines."""
    rs = np.random.RandomState(seed)
    ink = np.zeros((N, N), np.float32)

    def sm(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1)
        return t * t * (3 - 2 * t)

    def stamp(cx, cy, rad, fn):
        rad = int(rad) + 3
        xs = np.arange(int(cx) - rad, int(cx) + rad + 1)
        ys = np.arange(int(cy) - rad, int(cy) + rad + 1)
        dx = (xs - cx).astype(np.float32)[None, :]
        dy = (ys - cy).astype(np.float32)[:, None]
        val = fn(dx, dy)
        blk = np.ix_(np.mod(ys, N), np.mod(xs, N))
        ink[blk] = np.maximum(ink[blk], val)

    def stamp_over(cx, cy, rad, fn):
        rad = int(rad) + 3
        xs = np.arange(int(cx) - rad, int(cx) + rad + 1)
        ys = np.arange(int(cy) - rad, int(cy) + rad + 1)
        dx = (xs - cx).astype(np.float32)[None, :]
        dy = (ys - cy).astype(np.float32)[:, None]
        val, mask = fn(dx, dy)
        blk = np.ix_(np.mod(ys, N), np.mod(xs, N))
        ink[blk] = np.where(mask, val, ink[blk])

    def seg(p0, p1, w, val=1.0):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        c = (p0 + p1) / 2
        d = p1 - p0
        L2 = max(float(d.dot(d)), 1e-6)

        def f(dx, dy):
            px = dx + c[0] - p0[0]
            py = dy + c[1] - p0[1]
            t = np.clip((px * d[0] + py * d[1]) / L2, 0, 1)
            dist = np.sqrt((px - t * d[0]) ** 2 + (py - t * d[1]) ** 2)
            return val * (1 - sm(w * 0.45, w + 0.8, dist))
        stamp(c[0], c[1], np.sqrt(L2) / 2 + w + 2, f)

    def curve(p0, p1, bend, w0, w1, n=10):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = p1 - p0
        perp = np.array([-d[1], d[0]])
        pts = [p0 + d * t + perp * bend * math.sin(math.pi * t) for t in np.linspace(0, 1, n)]
        for i in range(n - 1):
            seg(pts[i], pts[i + 1], w0 + (w1 - w0) * i / (n - 2))
        return pts

    def rose(cx, cy, R, rot):
        n1 = int(rs.randint(5, 7))
        layers = [(1.0, n1, 0.0, 0.3), (0.72, n1, math.pi / n1, 0.42), (0.47, 5, 0.3, 0.55), (0.26, 4, 1.1, 0.68)]

        def f(dx, dy):
            r = np.sqrt(dx * dx + dy * dy) + 1e-3
            th = np.arctan2(dy, dx) + rot
            out = np.zeros_like(r)
            edges = []
            prev = None
            for li, (s, n, ph, wash) in enumerate(layers):
                c = np.abs(np.cos(n * (th + ph) / 2))
                e = R * s * (0.74 + 0.26 * c ** 0.6)
                edges.append((e, n, ph))
                e_in = R * (layers[li + 1][0] if li + 1 < len(layers) else 0.0) * 0.9
                k = np.clip((r - e_in) / np.maximum(e - e_in, 1), 0, 1)
                shade = wash + 0.3 * (1 - k) ** 1.5 + 0.03 * np.sin(th * n * 7 + r * 0.3)
                out = np.where(r < e, np.clip(shade, 0, 0.85), out)
            lw = max(1.4, R * 0.028)
            for e, n, ph in edges:
                out = np.maximum(out, 1 - sm(lw * 0.4, lw, np.abs(r - e)))
                c = np.cos(n * (th + ph) / 2)
                dist = np.abs(c) * r * 2 / n
                band = (r < e) & (r > e * 0.6)
                out = np.maximum(out, np.where(band, 1 - sm(lw * 0.3, lw * 0.9, dist), 0))
            core = r < R * 0.15
            sw = 0.5 + 0.5 * np.sin(r * 0.8 - th * 2)
            out = np.where(core, np.maximum(out, 0.7 + 0.3 * sw), out)
            e0 = edges[0][0]
            return out, r < e0 + lw * 1.2
        stamp_over(cx, cy, R * 1.02, f)

    def leaf(cx, cy, L, W, ang, side=1):
        ca, sa = math.cos(ang), math.sin(ang)

        def f(dx, dy):
            u = dx * ca + dy * sa + L / 2
            v = -dx * sa + dy * ca
            t = u / L
            half = (W / 2) * np.clip(np.sin(np.clip(t, 0, 1) * math.pi), 0, 1) ** 0.8
            inside = (t > 0) & (t < 1) & (np.abs(v) < half)
            wash = np.where(v * side > 0, 0.58, 0.36) + 0.12 * np.abs(v) / (half + 1e-3)
            out = np.where(inside, wash, 0.0)
            rim = (t > -0.01) & (t < 1.01)
            out = np.maximum(out, np.where(rim, 1 - sm(0.5, 1.5, np.abs(np.abs(v) - half)), 0))
            out = np.maximum(out, np.where(inside & (t < 0.92), 1 - sm(0.3, 1.2, np.abs(v)), 0))
            vv = np.abs(np.sin((u - np.abs(v) * 0.9) * (math.pi / (L * 0.13))))
            out = np.maximum(out, np.where(inside & (np.abs(v) < half * 0.8), 0.8 * (1 - sm(0.0, 0.2, vv)), 0))
            return out
        stamp(cx, cy, L / 2 + 3, f)

    def blossom(cx, cy, R, rot):
        def f(dx, dy):
            r = np.sqrt(dx * dx + dy * dy) + 1e-3
            th = np.arctan2(dy, dx) + rot
            e = R * (0.45 + 0.55 * np.abs(np.cos(5 * th / 2)) ** 0.8)
            out = np.where(r < e, 0.4 + 0.25 * (r / e), 0)
            out = np.maximum(out, 1 - sm(0.4, 1.4, np.abs(r - e)))
            return np.where(r < R * 0.22, 0.95, out)
        stamp(cx, cy, R + 2, f)

    def dot(cx, cy, R):
        stamp(cx, cy, R + 2, lambda dx, dy: 1 - sm(R - 1, R + 0.6, np.sqrt(dx * dx + dy * dy)))

    def wrapd(a, b):
        d = np.abs(np.array(a) - np.array(b))
        d = np.minimum(d, N - d)
        return float(np.hypot(*d))

    roses = []
    tries = 0
    while len(roses) < 9 and tries < 4000:
        tries += 1
        p = rs.uniform(0, N, 2)
        R = rs.uniform(72, 104) if len(roses) < 6 else rs.uniform(38, 52)
        if all(wrapd(p, q) > R + Q + 45 for q, Q in roses):
            roses.append((p, R))
    # stems, leaves and buds first (roses paint over their bases)
    for p, R in roses:
        for k in range(3):
            a = rs.uniform(0, 2 * math.pi)
            L = rs.uniform(1.5, 2.4) * R
            q = p + np.array([math.cos(a), math.sin(a)]) * L
            pts = curve(p, q, rs.uniform(-0.25, 0.25), 3.2, 1.6)
            for t, sd in ((0.45, 1), (0.75, -1), (0.98, 1)):
                i = int(t * (len(pts) - 1))
                j = min(i + 1, len(pts) - 1)
                tang = pts[j] - pts[max(i - 1, 0)]
                ta = math.atan2(tang[1], tang[0]) + sd * rs.uniform(0.5, 1.0)
                Lf = rs.uniform(0.45, 0.7) * R
                c = pts[i] + np.array([math.cos(ta), math.sin(ta)]) * Lf * 0.5
                leaf(c[0], c[1], Lf, Lf * 0.42, ta, side=sd)
            if rs.rand() < 0.6:
                blossom(q[0], q[1], rs.uniform(14, 20), rs.uniform(0, 6))
            else:  # curling tendril
                ang0 = a
                tp = [q + np.array([math.cos(ang0 + t * 5), math.sin(ang0 + t * 5)]) * (22 - t * 16) for t in np.linspace(0, 1, 14)]
                for i in range(len(tp) - 1):
                    seg(tp[i], tp[i + 1], 1.4)
    for p, R in roses:
        rose(p[0], p[1], R, rs.uniform(0, 6.3))
    # fillers
    for _ in range(70):
        p = rs.uniform(0, N, 2)
        if min(wrapd(p, q) - Q for q, Q in roses) < 30 or ink[int(p[1]) % N, int(p[0]) % N] > 0.05:
            continue
        if rs.rand() < 0.45:
            blossom(p[0], p[1], rs.uniform(12, 22), rs.uniform(0, 6))
        else:
            for k in range(3):
                a = rs.uniform(0, 6.3)
                dot(p[0] + math.cos(a) * 9, p[1] + math.sin(a) * 9, rs.uniform(2.5, 4))
    # soften like cobalt bleeding under the glaze
    for _ in range(2):
        ink = (ink + np.roll(ink, 1, 0) + np.roll(ink, -1, 0) + np.roll(ink, 1, 1) + np.roll(ink, -1, 1)) / 5
    ink = np.clip(ink, 0, 1)
    img = bpy.data.images.new("FloralTile", N, N, alpha=False, float_buffer=False)
    px = np.ones((N, N, 4), np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = ink
    img.pixels.foreach_set(px.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    img.colorspace_settings.name = "Non-Color"
    return img


class G:
    """Tiny functional wrapper over kit.Nodes for math-heavy shaders."""

    def __init__(self, mat):
        self.n = kit.Nodes(mat)
        self.L = self.n.nt.links.new

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.L(v, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=None, clamp=False):
        nd = self.n.new("ShaderNodeMath")
        nd.operation = op
        nd.use_clamp = clamp
        self.put(nd.inputs[0], a)
        if b is not None:
            self.put(nd.inputs[1], b)
        return nd.outputs[0]

    def mr(self, x, a, b, c=0.0, d=1.0, smooth=True):
        nd = self.n.new("ShaderNodeMapRange")
        nd.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
        self.put(nd.inputs["Value"], x)
        self.put(nd.inputs["From Min"], a)
        self.put(nd.inputs["From Max"], b)
        self.put(nd.inputs["To Min"], c)
        self.put(nd.inputs["To Max"], d)
        return nd.outputs["Result"]

    def vmath(self, op, a, b=None, scale=None):
        nd = self.n.new("ShaderNodeVectorMath")
        nd.operation = op
        self.put(nd.inputs[0], a)
        if b is not None:
            self.put(nd.inputs[1], b)
        if scale is not None:
            self.put(nd.inputs[3], scale)
        if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE"):
            return nd.outputs["Value"]
        return nd.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5, out="Fac"):
        nd = self.n.new("ShaderNodeTexNoise")
        self.put(nd.inputs["Vector"], vec)
        nd.inputs["Scale"].default_value = scale
        nd.inputs["Detail"].default_value = detail
        nd.inputs["Roughness"].default_value = rough
        return nd.outputs[out]

    def voronoi_edge(self, vec, scale):
        nd = self.n.new("ShaderNodeTexVoronoi")
        nd.voronoi_dimensions = "3D"
        nd.feature = "DISTANCE_TO_EDGE"
        self.put(nd.inputs["Vector"], vec)
        nd.inputs["Scale"].default_value = scale
        return nd.outputs["Distance"]

    def mix(self, f, a, b):
        nd = self.n.new("ShaderNodeMix")
        nd.data_type = "RGBA"
        self.put(nd.inputs[0], f)
        self.put(nd.inputs[6], a)
        self.put(nd.inputs[7], b)
        return nd.outputs[2]

    def mixf(self, f, a, b):
        nd = self.n.new("ShaderNodeMix")
        nd.data_type = "FLOAT"
        self.put(nd.inputs[0], f)
        self.put(nd.inputs[2], a)
        self.put(nd.inputs[3], b)
        return nd.outputs[0]


GLAZE = (0.83, 0.81, 0.75, 1)
GOLD = (1.0, 0.70, 0.28, 1)


def porcelain_mat(img):
    m = bpy.data.materials.new("Porcelain")
    g = G(m)
    n = g.n
    out = n.new("ShaderNodeOutputMaterial", loc=(1200, 0))
    b = n.new("ShaderNodeBsdfPrincipled", "BSDF", loc=(900, 0))
    tc = n.new("ShaderNodeTexCoord")
    vec = tc.outputs["Object"]
    attr = n.new("ShaderNodeVertexColor")
    attr.layer_name = "pc"
    sep = n.new("ShaderNodeSeparateColor")
    g.L(attr.outputs["Color"], sep.inputs[0])
    dress, gild, solid = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    allow = attr.outputs["Alpha"]
    # --- cobalt underglaze: painted tile, triplanar in figure space
    mp = n.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / TILE,) * 3
    g.L(vec, mp.inputs["Vector"])
    it = n.new("ShaderNodeTexImage")
    it.image = img
    it.projection = "BOX"
    it.projection_blend = 0.3
    it.interpolation = "Cubic"
    g.L(mp.outputs[0], it.inputs["Vector"])
    it2 = n.new("ShaderNodeTexImage")
    it2.image = img
    it2.interpolation = "Cubic"
    g.L(tc.outputs["UV"], it2.inputs["Vector"])
    useuv = n.new("ShaderNodeAttribute")
    useuv.attribute_name = "useuv"
    ink = g.mix(useuv.outputs["Fac"], it.outputs["Color"], it2.outputs["Color"])
    inkf = g.math("MULTIPLY", ink, 1.0)
    patch = g.mr(g.noise(vec, 2.6, 2.0, 0.5), 0.5, 0.58)          # scattered patches on skin/hair
    cover = g.math("MAXIMUM", dress, g.math("MULTIPLY", patch, 0.95))
    dens = g.math("MULTIPLY", g.math("MULTIPLY", inkf, cover), allow)
    dens = g.math("MAXIMUM", dens, solid)
    ramp = n.new("ShaderNodeValToRGB")
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, GLAZE
    el[1].position, el[1].color = 1.0, (0.012, 0.028, 0.24, 1)
    for pos, col in ((0.1, (0.55, 0.62, 0.82, 1)), (0.3, (0.1, 0.18, 0.56, 1)), (0.6, (0.03, 0.06, 0.36, 1))):
        e = el.new(pos)
        e.color = col
    g.L(dens, ramp.inputs["Fac"])
    base = ramp.outputs["Color"]
    # tiny iron specks in the glaze
    spk = n.new("ShaderNodeTexVoronoi")
    spk.voronoi_dimensions = "3D"
    g.L(vec, spk.inputs["Vector"])
    spk.inputs["Scale"].default_value = 30
    speck = g.math("MULTIPLY", g.mr(spk.outputs["Distance"], 0.07, 0.04),
                   g.mr(g.math("MULTIPLY", spk.outputs["Color"], 1.0), 0.93, 0.95))
    base = g.mix(g.math("MULTIPLY", speck, 0.6), base, (0.2, 0.15, 0.1, 1))
    # --- kintsugi crack network: distorted 3-scale Voronoi edges in figure space
    wob = g.vmath("SUBTRACT", g.noise(vec, 5.0, 3.0, 0.55, out="Color"), (0.5, 0.5, 0.5))
    dv = g.vmath("MULTIPLY_ADD", wob, (0.05, 0.05, 0.05))
    g.put(dv.node.inputs[2], vec)
    wv = g.noise(vec, 9.0, 2.0, 0.5)
    lines = []
    for scale, width, cov in ((2.4, 0.0027, None), (6.0, 0.0018, 0.45), (14.0, 0.0011, 0.57)):
        d = g.voronoi_edge(dv, scale)
        w = g.math("MULTIPLY", g.mr(wv, 0.3, 0.7, 0.45, 1.35, smooth=False), width * scale)
        ln = g.math("SUBTRACT", 1.0, g.mr(d, g.math("MULTIPLY", w, 0.5), w), clamp=True)
        if cov:
            ln = g.math("MULTIPLY", ln, g.mr(g.noise(vec, 3.1 + scale * 0.1, 2.0, 0.5), cov, cov + 0.05))
        lines.append(ln)
    crack = g.math("MAXIMUM", g.math("MAXIMUM", lines[0], lines[1]), lines[2])
    gold = g.math("MAXIMUM", crack, gild, clamp=True)
    col = g.mix(gold, base, GOLD)
    g.L(col, b.inputs["Base Color"])
    g.L(gold, b.inputs["Metallic"])
    rough_gold = g.mr(g.noise(vec, 40.0, 2.0, 0.5), 0.3, 0.7, 0.16, 0.3)
    g.L(g.mixf(gold, 0.09, rough_gold), b.inputs["Roughness"])
    g.L(g.mixf(gold, 1.0, 0.15), b.inputs["Coat Weight"])
    b.inputs["Coat Roughness"].default_value = 0.025
    b.inputs["Coat IOR"].default_value = 1.52
    g.L(g.mixf(gold, 0.12, 0.0), b.inputs["Subsurface Weight"])
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.8, 0.6)
    b.inputs["Subsurface Scale"].default_value = 0.004
    b.inputs["Specular IOR Level"].default_value = 0.5
    # raised gold seam + faint glaze ripple
    h = g.math("ADD", g.math("MULTIPLY", gold, 1.0), g.math("MULTIPLY", g.noise(vec, 120.0, 1.0, 0.5), 0.08))
    bump = n.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.0007
    g.L(h, bump.inputs["Height"])
    g.L(bump.outputs["Normal"], b.inputs["Normal"])
    g.L(b.outputs["BSDF"], out.inputs["Surface"])
    m.diffuse_color = GLAZE
    return m


def bisque_mat(name, color, rough=0.8, grain=0.0008, dark_scale=None):
    m = bpy.data.materials.new(name)
    g = G(m)
    n = g.n
    out = n.new("ShaderNodeOutputMaterial", loc=(900, 0))
    b = n.new("ShaderNodeBsdfPrincipled", "BSDF", loc=(600, 0))
    tc = n.new("ShaderNodeTexCoord")
    nz = g.noise(tc.outputs["Object"], 300.0, 3.0, 0.6)
    mott = g.noise(tc.outputs["Object"], 18.0, 3.0, 0.6)
    col = g.mix(g.mr(mott, 0.3, 0.7), color, tuple(c * 0.78 for c in color[:3]) + (1,))
    g.L(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    bump = n.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = grain
    g.L(nz, bump.inputs["Height"])
    g.L(bump.outputs["Normal"], b.inputs["Normal"])
    g.L(b.outputs["BSDF"], out.inputs["Surface"])
    m.diffuse_color = color
    return m


def make_materials():
    img = paint_floral(os.path.join(OUT, "floral_tile.png"))
    mats = {
        "Porcelain": porcelain_mat(img),
        "Flake": bisque_mat("Flake", (0.66, 0.58, 0.47, 1), 0.7),
        "Inner": bisque_mat("Inner", (0.3, 0.225, 0.155, 1), 0.9),
        "InnerDark": bisque_mat("InnerDark", (0.035, 0.028, 0.022, 1), 0.95),
        "Rim": bisque_mat("Rim", (0.74, 0.65, 0.52, 1), 0.75),
        "Socket": kit.mat("Socket", (0.006, 0.005, 0.005), 0.6),
        "CutMarker": kit.mat("CutMarker", (1, 0, 1), 0.5),
        "Teeth": kit.mat("Teeth", (0.74, 0.66, 0.5), 0.14, sss=0.1, sss_radius=(1, 0.7, 0.4), sss_scale=0.002, coat=0.7),
        "Cobalt": kit.mat("Cobalt", (0.02, 0.04, 0.3), 0.08, coat=1.0),
    }
    return mats


def slots(ob, mats, dark_inside=False):
    names = list(MAT_SLOTS)
    if dark_inside:
        names[INNER_OFS] = "InnerDark"
    kit.assign(ob, *[mats[k] for k in names])


# --------------------------------------------------------------------------- per-vertex paint masks

def seg_dist(P, a, b):
    a, b = np.array(a), np.array(b)
    d = b - a
    t = np.clip(((P - a) @ d) / max(d @ d, 1e-9), 0, 1)
    return np.linalg.norm(P - (a[None] + t[:, None] * d[None]), axis=1)


def set_pc(ob, cols):
    """Write an (n, 4) array into the point colour attribute 'pc'
    (R dress pattern, G gilding, B solid cobalt, A spare)."""
    me = ob.data
    ca = me.color_attributes.get("pc") or me.color_attributes.new("pc", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.ascontiguousarray(cols, np.float32).reshape(-1))


def coords(ob):
    n = len(ob.data.vertices)
    a = np.empty(n * 3, np.float32)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(n, 3)


def body_paint(body, J):
    P = coords(body).astype(np.float64)
    n = len(P)
    C = np.zeros((n, 4), np.float32)
    names = {
        "torso": [("pelvis", "waist"), ("waist", "chest"), ("chest", "uchest"), ("uchest", "neckb"),
                  ("uchest", "cl.L"), ("uchest", "cl.R")],
        "neck": [("neckb", "neck"), ("neck", "headb")],
        "arm": [(f"{a}.{s}", f"{b}.{s}") for s in "LR" for a, b in (("cl", "sh"), ("sh", "el"), ("el", "wr"))],
        "leg": [(f"{a}.{s}", f"{b}.{s}") for s in "LR" for a, b in (("hip", "kn"), ("kn", "an"))],
        "foot": [(f"{a}.{s}", f"{b}.{s}") for s in "LR" for a, b in (("an", "heel"), ("heel", "post"), ("an", "ball"), ("ball", "toe"))],
    }
    best = np.full(n, 9.0)
    lab = np.zeros(n, np.int32)
    for li, (k, bones) in enumerate(names.items()):
        for a, b in bones:
            d = seg_dist(P, J[a][0], J[b][0]) - 0.5 * (J[a][1][0] + J[b][1][0])
            m = d < best
            best[m] = d[m]
            lab[m] = li
    hl = np.array(HEAD_M.inverted())
    Ph = (np.c_[P, np.ones(n)] @ hl.T)[:, :3]
    head = ((Ph[:, 0] / 0.1) ** 2 + (Ph[:, 1] / 0.13) ** 2 + (Ph[:, 2] / 0.14) ** 2) < 1.0
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    torso = lab == 0
    vneck = (y < -0.02) & (z > 1.215 + 1.5 * np.abs(x))
    dress = torso & ~vneck & (z < 1.36)
    dress |= (lab == 3) & (z > 0.8)
    shoe = np.zeros(n, bool)
    for s in "LR":
        an = np.array(J[f"an.{s}"][0])
        da = np.linalg.norm(P - an, axis=1)
        foot = (lab == 4) | ((lab == 3) & (z < an[2] + 0.02))
        sh = foot & (da > 0.034)
        shoe |= sh
        edge = foot & (da > 0.034) & (da < 0.041)
        strap = (lab == 3) & (z > an[2] + 0.004) & (z < an[2] + 0.012) & (np.abs(x - an[0]) < 0.06)
        # T-strap down the instep
        fwd = (P[:, 1] < an[1] - 0.01) & (np.abs(x - an[0]) < 0.0045) & (da < 0.075) & (P[:, 2] > an[2] - 0.06) & foot
        C[edge | strap | fwd, 1] = 1.0
    C[:, 0] = (dress | shoe).astype(np.float32)
    C[head, 0] = 0.0
    C[:, 3] = 1.0
    C[torso & vneck & (z < 1.36), 3] = 0.0
    C[(lab == 1) | head, 3] = 0.0
    cheek = np.linalg.norm(Ph - np.array([-0.05, -0.075, -0.03]), axis=1) < 0.04
    C[cheek & head, 0] = 1.0
    C[cheek & head, 3] = 1.0
    set_pc(body, C)
    return C


# --------------------------------------------------------------------------- dress pieces

def slice_profile(P, z, c, bins=72, dz=0.012, rmax=0.3):
    """Max radius of points P near height z, per angular bin around centre c (xy)."""
    m = np.abs(P[:, 2] - z) < dz
    Q = P[m, :2] - np.array(c)[None]
    Q = Q[np.hypot(Q[:, 0], Q[:, 1]) < rmax]
    ang = np.arctan2(Q[:, 1], Q[:, 0])
    r = np.hypot(Q[:, 0], Q[:, 1])
    b = ((ang + math.pi) / (2 * math.pi) * bins).astype(int) % bins
    out = np.zeros(bins)
    np.maximum.at(out, b, r)
    # fill empty bins from neighbours, then soften
    for _ in range(bins):
        z0 = out == 0
        if not z0.any():
            break
        out[z0] = np.maximum(np.roll(out, 1), np.roll(out, -1))[z0]
    out = (out + np.roll(out, 1) + np.roll(out, -1)) / 3
    return out


def prof_at(prof, ang):
    bins = len(prof)
    t = (ang + math.pi) / (2 * math.pi) * bins - 0.5
    k = int(math.floor(t)) % bins
    f = t - math.floor(t)
    return prof[k] * (1 - f) + prof[(k + 1) % bins] * f


def make_skirt(root, collider_ob, body_P, mats):
    z_top, z_hem = 1.0, 0.47
    ctr = (0.0, 0.0)
    nc, nr = 132, 46
    prof_top = slice_profile(body_P, z_top, ctr, rmax=0.15)
    rs = random.Random(5)
    # broken hem: angular teeth + two deep breaks
    L = []
    j = 0
    while j < nc:
        w = rs.randint(2, 5)
        a = rs.uniform(0.01, 0.055)
        for k in range(w):
            t = k / w
            L.append((z_top - z_hem) - a * (1 - abs(2 * t - 1)) - rs.uniform(0, 0.008))
        j += w
    L = L[:nc]
    for j in range(nc):
        th = 2 * math.pi * j / nc - math.pi
        for c0, wdt, depth in ((-2.0, 0.55, 0.15), (1.1, 0.4, 0.08), (2.6, 0.3, 0.05)):
            dd = abs(math.atan2(math.sin(th - c0), math.cos(th - c0)))
            if dd < wdt:
                L[j] -= depth * (1 - dd / wdt) ** 0.8
    # safe radius per row/bin so the start shape never intersects the body
    coll_P = coords(collider_ob).astype(np.float64)
    rows_z = [z_top - (z_top - z_hem) * i / (nr - 1) for i in range(nr)]
    safe = [slice_profile(coll_P, zz, ctr, dz=0.02) for zz in rows_z]
    bm = bmesh.new()
    grid = []
    tparam = []
    for i in range(nr):
        row = []
        for j in range(nc):
            th = 2 * math.pi * j / nc - math.pi
            t = i / (nr - 1)
            length = L[j] * t
            zz = z_top - length
            r0 = prof_at(prof_top, th) + 0.008
            flare = 0.2 * math.sqrt(max(t, 0)) * (1 + 0.28 * math.cos(9 * th + 0.7))
            ri = min(nr - 1, int(round(length / (z_top - z_hem) * (nr - 1))))
            r = max(r0 + flare, prof_at(safe[ri], th) + 0.014 if length > 0.02 else 0)
            row.append(bm.verts.new((ctr[0] + math.cos(th) * r, ctr[1] + math.sin(th) * r, zz)))
            tparam.append(length / (z_top - z_hem))
        grid.append(row)
    for i in range(nr - 1):
        for j in range(nc):
            a, b_, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][(j + 1) % nc], grid[i][(j + 1) % nc]
            bm.faces.new((a, b_, c, d))
    ob = kit.mesh_obj("Skirt", bm, root)
    K = 3.0     # tiles around the skirt (seamless wrap)
    me = ob.data
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        js = [me.loops[li].vertex_index % nc for li in poly.loop_indices]
        wrap = max(js) - min(js) > nc // 2
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            i, j = divmod(vi, nc)
            u = (j + (nc if wrap and j < nc // 2 else 0)) / nc * K
            uv.data[li].uv = (u, -L[j] * i / (nr - 1) / TILE * 1.1)
    fl = me.attributes.new("useuv", "FLOAT", "POINT")
    fl.data.foreach_set("value", np.ones(len(me.vertices), np.float32))
    kit.vgroup(ob, "pin", lambda co: 1.0 if co.z > z_top - 0.03 else 0.0)
    # cached cloth bake (deterministic; the cache only saves iteration time)
    key = hashlib.md5(np.round(coords(ob), 4).tobytes() + np.round(coll_P, 3).tobytes()).hexdigest()[:12]
    cache = os.path.join(OUT, f"skirt_{key}.npy")
    if os.path.exists(cache):
        arr = np.load(cache)
        ob.data.vertices.foreach_set("co", arr.astype(np.float32).reshape(-1))
        ob.data.update()
    else:
        drape(ob, [collider_ob], frames=48, pin="pin")
        np.save(cache, coords(ob))
    C = np.zeros((len(ob.data.vertices), 4), np.float32)
    C[:, 0] = 1.0
    C[:, 3] = 1.0
    tp = np.array(tparam, np.float32)
    set_pc(ob, C)
    slots(ob, mats, dark_inside=True)
    return ob


def drape(ob, colliders, frames=48, pin=None):
    """Cloth drape (like kit.drape_cloth) with heavier, stiffer 'fired' fabric."""
    for c in colliders:
        kit.collider(c, 0.006)
    m = ob.modifiers.new("Cloth", "CLOTH")
    s = m.settings
    s.quality = 6
    s.mass = 0.35
    s.tension_stiffness = s.compression_stiffness = 18
    s.shear_stiffness = 8
    s.bending_stiffness = 0.6
    s.air_damping = 2.0
    if pin:
        s.vertex_group_mass = pin
    cs = m.collision_settings
    cs.distance_min = 0.006
    cs.collision_quality = 3
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    kit._step(frames)
    kit.apply_modifiers(ob)
    for c in colliders:
        for mm in list(c.modifiers):
            if mm.type == "COLLISION":
                c.modifiers.remove(mm)
    bpy.context.scene.frame_set(1)


def shell(ob, thick=SHELL, even=False):
    """Fire it: solidify inward into a ceramic wall; broken rims = bisque."""
    m = ob.modifiers.new("Shell", "SOLIDIFY")
    m.thickness = thick
    m.offset = -1
    m.use_even_offset = even
    m.use_quality_normals = True
    m.use_rim = True
    m.material_offset = INNER_OFS
    m.material_offset_rim = RIM_OFS
    kit.apply_modifiers(ob)
    sharpen_material_edges(ob)
    return ob


def sharpen_material_edges(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2 and lf[0].material_index != lf[1].material_index:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def make_sleeve(name, J, s, mats, root, seed):
    sh, el = J[f"sh.{s}"][0], J[f"el.{s}"][0]
    d = (el - sh).normalized()
    top = sh - d * 0.03 + V((0, 0, 0.02))
    pts = [top, sh + d * 0.0, sh + d * 0.05, sh + d * 0.11, sh + d * 0.16, sh + d * 0.18]
    radii = [0.02, 0.044, 0.046, 0.044, 0.043, 0.043]
    pts = catmull(pts, 3)
    radii = lerp_list(radii, len(pts))
    ob = sweep(name, pts, radii, seg=28, caps=(True, False), parent=root)
    # jagged broken end: move the last ring along the axis
    rs = random.Random(seed)
    me = ob.data
    nring = 28
    last = list(range(len(me.vertices) - nring, len(me.vertices)))
    k = 0
    while k < nring:
        w = rs.randint(2, 4)
        a = rs.uniform(0.008, 0.03)
        for q in range(w):
            if k + q < nring:
                t = q / w
                me.vertices[last[k + q]].co -= d * a * (1 - abs(2 * t - 1))
        k += w
    sc = kit.Sculpt(ob)
    sc.noise(40, 0.0015, seed=seed)
    for q in range(3):   # a few soft drape folds
        a = rs.uniform(0, 6.28)
        side = V((math.cos(a), math.sin(a), 0)).cross(d).normalized()
        p0 = sh + d * 0.08 + side * 0.05
        sc.crease_stroke([p0, p0 + d * 0.12 + side * 0.01], 0.012, 0.004, kind="smooth")
    sc.done()
    C = np.zeros((len(me.vertices), 4), np.float32)
    C[:, 0] = 1.0
    C[:, 3] = 1.0
    set_pc(ob, C)
    slots(ob, mats)
    shell(ob, 0.0035, even=False)
    return ob


def sag(ob, group, frames=36):
    """Soft body held by a soft goal (like kit.softbody_sag). At this scale the
    edge springs cannot hold free vertices (they fall metres), so every vertex
    keeps a partial goal weight and gravity sags it against the goal spring."""
    m = ob.modifiers.new("Softbody", "SOFT_BODY")
    sb = ob.soft_body
    sb.use_goal = True
    sb.vertex_group_goal = group
    sb.goal_default, sb.goal_min, sb.goal_max = 1.0, 0.0, 1.0
    sb.goal_spring, sb.goal_friction = 0.85, 5.0
    sb.use_edges = True
    sb.pull = sb.push = 0.9
    sb.damping = 4.0
    sb.effector_weights.gravity = 1.0
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    kit._step(frames)
    kit.apply_modifiers(ob)
    bpy.context.scene.frame_set(1)


def make_flap(J, mats, root):
    sh, el = J["sh.R"][0], J["el.R"][0]
    d = (el - sh).normalized()
    c = sh + d * 0.172
    down = (V((0, 0, -1)) - d * d.z).normalized()
    side = d.cross(down).normalized()
    R = 0.047
    bm = bmesh.new()
    nw, nl = 6, 12
    rows = []
    for i in range(nl + 1):
        t = i / nl
        row = []
        for j in range(nw + 1):
            a = (j / nw - 0.5) * 0.8 * (1 - 0.75 * t) + 0.12 * t
            row.append(bm.verts.new(c + d * (0.075 * t) + (down * math.cos(a) + side * math.sin(a)) * R * (1 + 0.1 * t)))
        rows.append(row)
    for i in range(nl):
        for j in range(nw):
            bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
    ob = kit.mesh_obj("SleeveFlap", bm, root)
    g = ob.vertex_groups.new(name="goal")
    for v in ob.data.vertices:
        t = min(1.0, max(0.0, (v.co - c).dot(d) / 0.075))
        g.add([v.index], 1.0 - 0.38 * t, "REPLACE")
    sag(ob, "goal")
    me = ob.data
    p0 = me.polygons[0]
    if p0.normal.dot(p0.center - (c + d * (p0.center - c).dot(d))) < 0:
        me.flip_normals()
    kit.subdivide(ob, 1)
    C = np.zeros((len(ob.data.vertices), 4), np.float32)
    C[:, 0] = 1.0
    C[:, 3] = 1.0
    set_pc(ob, C)
    slots(ob, mats)
    shell(ob, 0.003)
    return ob


def make_collar(bvh, J, mats, root):
    """Pointed shirt collar laid on the shoulders by snapping to the body surface."""
    nb = J["neckb"][0]
    bm = bmesh.new()
    rows = []
    nu, nv = 30, 6
    for i in range(2 * nu + 1):
        uu = -1 + i / nu
        side = -1 if uu >= 0 else 1      # +uu runs round to the figure's right (-X)
        u = abs(uu)     # 0 = back centre, 1 = front V
        ang = math.pi / 2 + uu * math.pi * 0.85
        inner = nb + V((math.cos(ang) * 0.062, math.sin(ang) * 0.058 + 0.004, 0.015 - 0.01 * u))
        if u > 0.7:
            k = (u - 0.7) / 0.3
            inner = inner.lerp(V((side * 0.006, nb.y - 0.075, 1.225)), k ** 1.3)
        out_dir = V((inner.x - nb.x, inner.y - nb.y, 0)).normalized() * 0.8 + V((0, 0, -0.6))
        width = 0.042 + 0.035 * ss(0.62, 0.9, u) * (1 - ss(0.92, 1.0, u))
        if u > 0.85:   # lapel point sweeps outward/down
            out_dir = (out_dir + V((side * 0.6, -0.1, -0.6))).normalized()
        row = []
        for j in range(nv + 1):
            v = j / nv
            p = inner + out_dir.normalized() * width * v
            loc, nor, _, _ = bvh.find_nearest(p)
            lift = 0.005 + 0.009 * math.sin(math.pi * min(1, v * 1.3)) * (1 - 0.4 * u) + 0.004 * v
            row.append(bm.verts.new(loc + nor * lift))
        rows.append(row)
    for i in range(2 * nu):
        for j in range(nv):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    vparam = [j / nv for i in range(2 * nu + 1) for j in range(nv + 1)]
    ob = kit.mesh_obj("Collar", bm, root)
    Cc = np.zeros((len(vparam), 4), np.float32)
    Cc[:, 2] = [1.0 if v > 0.8 else 0.0 for v in vparam]
    Cc[:, 3] = 0.0
    set_pc(ob, Cc)
    # make sure normals face away from the body
    me = ob.data
    p = me.polygons[len(me.polygons) // 2]
    loc, nor, _, _ = bvh.find_nearest(p.center)
    if p.normal.dot(p.center - loc) < 0:
        me.flip_normals()
    kit.subdivide(ob, 1)
    me = ob.data
    slots(ob, mats)
    shell(ob, 0.003, even=False)
    return ob


def make_belt(body_P, mats, root):
    z = 1.012
    prof = slice_profile(body_P, z, (0, 0), dz=0.008, rmax=0.15)
    n = 96
    pts = []
    for j in range(n):
        th = 2 * math.pi * j / n - math.pi
        r = prof_at(prof, th) + 0.012
        pts.append(V((math.cos(th) * r, math.sin(th) * r, z)))
    prof2 = []
    for k in range(20):
        a = 2 * math.pi * k / 20
        c, s = math.cos(a), math.sin(a)
        prof2.append((math.copysign(abs(c) ** 0.5, c), math.copysign(abs(s) ** 0.5, s)))
    ob = sweep("Belt", pts, [(0.0045, 0.017)] * n, profile=[(v, u) for u, v in prof2], parent=root, closed=True)
    C = np.zeros((len(ob.data.vertices), 4), np.float32)
    C[:, 0] = 1.0
    C[:, 3] = 1.0
    P = coords(ob)
    edge = np.abs(P[:, 2] - z) > 0.012
    C[edge, 2] = 1.0          # cobalt piping
    set_pc(ob, C)
    slots(ob, mats)
    # gilded buckle at the front
    front = min(pts, key=lambda p: p.y)
    bpts = []
    for k in range(24):
        a = 2 * math.pi * k / 24
        c, s = math.cos(a), math.sin(a)
        bpts.append(front + V((math.copysign(abs(c) ** 0.4, c) * 0.02, -0.006, math.copysign(abs(s) ** 0.4, s) * 0.017)))
    bk = sweep("Buckle", bpts, 0.0028, seg=8, parent=root, closed=True)
    Cb = np.zeros((len(bk.data.vertices), 4), np.float32)
    Cb[:, 1] = 1.0
    Cb[:, 3] = 1.0
    set_pc(bk, Cb)
    slots(bk, mats)
    return [ob, bk]


def make_buttons(bvh, mats, root):
    out = []
    for i, z in enumerate((1.2, 1.155, 1.11, 1.065)):
        loc, nor, _, _ = bvh.ray_cast(V((0.0, -0.5, z)), V((0, 1, 0)))
        if loc is None:
            continue
        b = kit.quad_sphere(f"Button{i}", 0.0085, 2, scale=(1, 1, 0.38))
        rot = nor.to_track_quat("Z", "Y").to_matrix().to_4x4()
        b.data.transform(Matrix.Translation(loc + nor * 0.002) @ rot)
        b.parent = root
        C = np.zeros((len(b.data.vertices), 4), np.float32)
        C[:, 2] = 1.0
        C[:, 3] = 1.0
        set_pc(b, C)
        slots(b, mats)
        out.append(b)
    return out


def make_fingers(J, mats, root):
    parts = []
    for s in "LR":
        wr, f, n, side = hand_frame(J, s)
        palm_c = wr + f * 0.045
        spread = [-0.024, -0.008, 0.008, 0.023]
        lens = [0.074, 0.082, 0.078, 0.062]
        tsign = 1 if s == "R" else -1
        # finger order across the palm: pinky ... index toward the thumb side
        order = spread if tsign > 0 else list(reversed(spread))
        for k in range(4):
            off = order[k] * tsign
            base = palm_c + f * 0.038 + side * off
            Ls = lens[k]
            segl = [Ls * 0.45, Ls * 0.3, Ls * 0.25]
            curls = [0.45 + 0.1 * k, 0.72, 0.55] if s == "R" else [0.35, 0.75 + 0.08 * k, 0.6]
            d = (f + side * off * 3.0).normalized()
            pts = [base - d * 0.012, base]
            p = base
            for L_, c in zip(segl, curls):
                d = (Matrix.Rotation(c, 3, side) @ d).normalized() if True else d
                # rotate toward the palm normal (curl into a claw)
                p = p + d * L_
                pts.append(p)
            radii = [0.0078, 0.0074, 0.0064, 0.0052, 0.0032]
            broken = (s == "R" and k == (0 if tsign > 0 else 3))
            if broken:   # a finger snapped off at the middle joint
                pts, radii = pts[:3] + [pts[2].lerp(pts[3], 0.35)], radii[:3] + [0.0061]
            cp = catmull(pts, 4)
            rr = lerp_list(radii, len(cp))
            rr = [r * (1.12 if i % 4 == 0 and 4 <= i < len(rr) - 2 else 0.92 if i % 4 == 2 else 1.0)
                  for i, r in enumerate(rr)]
            if not broken:
                rr[-1] = 0.0008
            ob = sweep(f"Finger.{s}{k}", cp, rr, seg=10, parent=root)
            slots(ob, mats)
            if broken:
                # the last cap is the broken end: bisque
                me = ob.data
                last = max(me.polygons, key=lambda pp: (pp.center - cp[-1]).length * -1)
                last.material_index = MAT_SLOTS.index("Rim")
            parts.append(ob)
        # thumb
        tb = palm_c + side * (tsign * 0.028) + n * 0.006 - f * 0.012
        d = (f * 0.6 + side * tsign * 0.55 + n * 0.45).normalized()
        pts = [tb, tb + d * 0.028]
        d2 = (Matrix.Rotation(-0.5 * tsign, 3, n) @ d)
        d2 = (d2 + n * 0.5).normalized()
        pts.append(pts[-1] + d2 * 0.028)
        pts.append(pts[-1] + (d2 + n * 0.6).normalized() * 0.02)
        cp = catmull(pts, 4)
        rr = lerp_list([0.0095, 0.0078, 0.0062, 0.0035], len(cp))
        rr[-1] = 0.0009
        ob = sweep(f"Thumb.{s}", cp, rr, seg=10, parent=root)
        slots(ob, mats)
        parts.append(ob)
    return parts


def make_teeth(mats, root, head_bvh):
    parts = []
    rs = random.Random(3)
    for row, zc, sgn in (("U", -0.066, -1), ("D", -0.081, 1)):
        for i in range(9):
            x = -0.019 + i * 0.00475
            if row == "D" and i in (2, 6):
                continue   # missing teeth
            hit = head_bvh.ray_cast(HEAD_M @ V((x, -0.3, zc)), HEAD_R @ V((0, 1, 0)))
            y = ((HEAD_M.inverted() @ hit[0]).y if hit[0] is not None else -0.105) + 0.004
            h = 0.0058 + rs.uniform(-0.001, 0.0012)
            t = kit.quad_sphere(f"Tooth{row}{i}", 1.0, 2, scale=(0.0024, 0.0026, h))
            M = HEAD_M @ Matrix.Translation(V((x, y, zc + sgn * h * 0.35))) @ Euler((0.2 * sgn, rs.uniform(-0.15, 0.15), rs.uniform(-0.2, 0.2))).to_matrix().to_4x4()
            t.data.transform(M)
            t.parent = root
            kit.assign(t, mats["Teeth"])
            parts.append(t)
    return parts


# --------------------------------------------------------------------------- build

def boolean_cut(ob, cutters, name="Cuts", self_=False):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        coll.objects.link(c)
    m = ob.modifiers.new("Bool", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.operand_type = "COLLECTION"
    m.collection = coll
    m.material_mode = "TRANSFER"
    m.use_self = self_
    kit.apply_modifiers(ob)
    names = [mt.name if mt else "" for mt in ob.data.materials]
    lut = np.array([MAT_SLOTS.index(nm) if nm in MAT_SLOTS else 0 for nm in names] or [0], np.int32)
    n = len(ob.data.polygons)
    mi = np.empty(n, np.int32)
    ob.data.polygons.foreach_get("material_index", mi)
    new = lut[np.clip(mi, 0, len(lut) - 1)].astype(np.int32)
    ob.data.materials.clear()
    for nm in MAT_SLOTS:
        ob.data.materials.append(bpy.data.materials[nm])
    ob.data.polygons.foreach_set("material_index", new)
    ob.data.update()
    return coll


def delete_marker_faces(ob):
    idx = {i for i, m in enumerate(ob.data.materials) if m and m.name.startswith("CutMarker")}
    print("[porcelain] marker slots", idx, [m.name for m in ob.data.materials])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if f.material_index in idx]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def build():
    t0 = __import__("time").time()
    mats = make_materials()
    root = kit.empty("ZOMBIE")
    J, B = pose()
    # ---------------- body: skin modifier + volume blobs + head, fused by remesh
    body = kit.skin_body("Body", J, B, root, subdiv=1, branch_smooth=0.5)
    armj = ("cl.", "sh.", "ua.", "el.", "fa.", "wr.")
    collider = kit.skin_body("Collider", J, [b for b in B if not b[1].startswith(armj)], None, subdiv=1,
                             branch_smooth=0.5, drop=tuple(k for k in J if k.startswith(armj)))
    blobs = []
    for nm, c, r, sc in (
        ("Hips", (0, 0.012, 0.878), 0.1, (1.5, 1.08, 1.0)),
        ("ButtL", (0.056, 0.045, 0.845), 0.07, (1, 0.9, 1)),
        ("ButtR", (-0.056, 0.05, 0.85), 0.07, (1, 0.9, 1)),
        ("Ribs", (0, -0.04, 1.19), 0.095, (1.05, 0.8, 1.05)),
        ("BustL", (0.048, -0.097, 1.195), 0.04, (1.05, 0.85, 0.95)),
        ("BustR", (-0.048, -0.097, 1.195), 0.04, (1.05, 0.85, 0.95)),
    ):
        blobs.append(kit.quad_sphere(nm, r, 3, loc=c, scale=sc, parent=root))
    for s in "LR":
        wr, f, n, side = hand_frame(J, s)
        pc = wr + f * 0.042
        palm = kit.quad_sphere(f"Palm.{s}", 1.0, 3, parent=root)
        M = Matrix((side * 0.035, n * 0.012, f * 0.048)).transposed()
        palm.data.transform(Matrix.Translation(pc) @ M.to_4x4())
        blobs.append(palm)
    heads, head_bvh, on = make_head()
    for h in heads:
        h.data.transform(HEAD_M)
        h.parent = root
    body = kit.join([body] + heads + blobs, "Body")
    kit.remesh(body, VOXEL)
    print(f"[porcelain] remeshed body: {len(body.data.vertices)} verts ({__import__('time').time() - t0:.1f}s)")
    # ---------------- sculpt by code on the fused figure
    s = kit.Sculpt(body)
    S = lambda p: s.kd.find(V(p))[0]
    s.smooth(2, 0.5)
    s.refresh()
    sculpt_face(s)
    s.refresh()
    s.scale((0, -0.03, 1.18), 0.14, (1.0, 0.86, 1.0))                  # slimmer ribcage depth
    s.scale((0, -0.014, 1.03), 0.08, (0.96, 0.94, 1.0))                 # waist
    for sx in (-1, 1):
        s.smooth(3, 0.5, c=(sx * 0.048, -0.12, 1.19), r=0.07)          # blend the bust into the bodice
        s.smooth(2, 0.5, c=(sx * 0.05, -0.1, 1.145), r=0.04)
    s.refresh()
    for sx in (-1, 1):
        # collarbones and neck tendons
        s.inflate_stroke([S((sx * 0.012, -0.12, 1.335)), S((sx * 0.06, -0.11, 1.345)), S((sx * 0.12, -0.09, 1.35))], 0.011, 0.004)
        s.inflate_stroke([S((sx * 0.01, -0.1, 1.345)), S((sx * 0.03, -0.08, 1.4)), S(HEAD_M @ V((sx * 0.05, 0.02, -0.07)))], 0.009, 0.003)
        s.crease_stroke([S((sx * 0.03, -0.12, 1.305)), S((sx * 0.1, -0.1, 1.315))], 0.012, 0.003, kind="smooth")
    s.crease_stroke([S((0, -0.12, 1.34)), S((0, -0.115, 1.325))], 0.012, 0.004)           # sternal notch
    s.inflate_stroke([S((0, -0.12, 1.22)), S((0, -0.14, 1.12)), S((0, -0.12, 1.04))], 0.011, 0.002)  # placket
    for sx, s_ in ((1, "L"), (-1, "R")):
        kn, an = J[f"kn.{s_}"][0], J[f"an.{s_}"][0]
        s.inflate(S(kn + V((0, -0.06, 0.0))), 0.03, 0.006)            # kneecap
        s.crease_stroke([S(kn + V((-0.03, -0.06, -0.03))), S(kn + V((0.03, -0.06, -0.03)))], 0.01, 0.003)
        s.inflate_stroke([S(kn.lerp(an, 0.15) + V((0, -0.08, 0))), S(kn.lerp(an, 0.85) + V((0, -0.08, 0)))], 0.01, 0.0025)  # shin
        s.inflate(S(an + V((0.03, 0, 0))), 0.012, 0.003)
        s.inflate(S(an + V((-0.03, 0, 0))), 0.012, 0.003)
        el = J[f"el.{s_}"][0]
        s.inflate(S(el + (el - J[f"sh.{s_}"][0]).normalized() * 0.03), 0.02, 0.005)   # bony elbow
        wr_, fa_ = J[f"wr.{s_}"][0], J[f"fa.{s_}"][0]
        s.scale(wr_.lerp(fa_, 0.3), 0.05, 0.9)                          # slimmer lower forearm
        s.inflate(S(wr_ + V((0.02, 0, 0.0))), 0.011, 0.0025)            # wrist bones
        s.inflate(S(wr_ + V((-0.02, 0, 0.0))), 0.011, 0.0025)
        s.inflate(S(el.lerp(fa_, 0.6) + V((0, -0.02, 0.02))), 0.03, 0.003)   # forearm muscle
        # tendons on the back of the hand
        wr, f, n, side = hand_frame(J, s_)
        for off in (-0.018, -0.006, 0.006, 0.018):
            a = wr + f * 0.012 + side * off * 0.6
            b = wr + f * 0.075 + side * off
            s.inflate_stroke([S(a - n * 0.02), S(b - n * 0.02)], 0.005, 0.0016)
    s.smooth(1, 0.25)
    s.done()
    body_P = coords(body).astype(np.float64)
    body_bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    slots(body, mats)
    # ---------------- breakage: holes, flakes, sockets
    hl = lambda p: HEAD_M @ V(p)
    cut = []
    skull = jagged_blob("SkullBreak", hl((0.056, -0.028, 0.085)), 0.052, 11, level=4, jag=0.3, fine=0.09,
                        scale=(1.0, 1.25, 0.9))
    cut.append(skull)
    for sx in (-1, 1):
        eye = jagged_blob(f"Eye{sx}", hl((sx * 0.031, -0.09, 0.002)), 0.022, 60 + sx, level=3, jag=0.08, fine=0.05,
                          scale=(1.0, 1.6, 0.86))
        cut.append(eye)
    shin_pts = [(J["kn.L"][0].lerp(J["an.L"][0], 0.45) + V((0.03, -0.04, 0)), 0.024, 21),
                (J["kn.R"][0].lerp(J["an.R"][0], 0.3) + V((-0.03, 0.03, 0)), 0.028, 22)]
    for c, r, sd in shin_pts:
        loc, nor, _, _ = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get()).find_nearest(c)
        cut.append(jagged_blob(f"Hole{sd}", loc + nor * 0.004, r, sd, level=3, jag=0.3, fine=0.1))
    marker = mats["CutMarker"]
    for c in cut:
        kit.assign(c, marker)
    # flakes (shallow chips showing bisque)
    bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    flakes = []
    for i, (c, r) in enumerate(((J["fa.L"][0] + V((0.03, -0.01, 0)), 0.018), (J["ua.R"][0] + V((0, 0, -0.04)), 0.015),
                                (J["kn.L"][0] + V((0, -0.05, 0.02)), 0.02), (hl((0.004, -0.108, -0.028)), 0.007),
                                (J["cf.R"][0] + V((0, 0.045, 0)), 0.02),
                                (V((0.07, -0.1, 1.3)), 0.016))):
        loc, nor, _, _ = bvh.find_nearest(c)
        fb = jagged_blob(f"Flake{i}", loc + nor * r * 0.42, r, 40 + i, level=2, jag=0.35, fine=0.12,
                         scale=(1, 1, 0.6), rot=nor.to_track_quat("Z", "Y").to_matrix())
        kit.assign(fb, mats["Flake"])
        flakes.append(fb)
    # dark cavities: eye sockets, nostrils, mouth (head-local, then placed)
    sockets = []
    for nm, c, r, sc in (("NoseL", (0.0045, -0.112, -0.036), 0.0045, (0.75, 1.6, 1.1)),
                         ("NoseR", (-0.0045, -0.112, -0.036), 0.0045, (0.75, 1.6, 1.1)),
                         ("Mouth", (0, -0.094, -0.0735), 0.024, (1.0, 1.0, 0.42))):
        o = kit.quad_sphere(nm, r, 3, scale=sc)
        o.data.transform(HEAD_M @ Matrix.Translation(c))
        kit.assign(o, mats["Socket"])
        sockets.append(o)
    colls = [boolean_cut(body, cut + flakes + sockets, "Cutters")]
    delete_marker_faces(body)
    body_paint(body, J)
    shell(body)
    print(f"[porcelain] body fired ({__import__('time').time() - t0:.1f}s)")
    # ---------------- hair rolls (head-local -> figure), broken where the skull is
    rolls = make_hair_rolls(on)
    for r in rolls:
        r.data.transform(HEAD_M)
        r.parent = root
        slots(r, mats)
        C = np.zeros((len(r.data.vertices), 4), np.float32)
        C[:, 3] = 1.0
        set_pc(r, C)
    hair = kit.join(rolls, "HairRolls")
    sk2 = jagged_blob("SkullBreak2", hl((0.056, -0.028, 0.085)), 0.052, 11, level=4, jag=0.3, fine=0.09,
                      scale=(1.0, 1.25, 0.9))
    kit.assign(sk2, mats["Rim"])
    colls.append(boolean_cut(hair, [sk2], "Cutters2", self_=True))
    sharpen_material_edges(hair)
    # ---------------- dress: cloth skirt, sleeves, collar, belt, buttons
    skirt = make_skirt(root, collider, body_P, mats)
    shell(skirt, 0.004, even=False)
    parts = [skirt, hair]
    parts += [make_sleeve("Sleeve.R", J, "R", mats, root, 5), make_sleeve("Sleeve.L", J, "L", mats, root, 6)]
    parts.append(make_collar(body_bvh, J, mats, root))
    parts.append(make_flap(J, mats, root))
    parts += make_belt(body_P, mats, root)
    parts += make_buttons(body_bvh, mats, root)
    parts += make_fingers(J, mats, root)
    parts += make_teeth(mats, root, body_bvh)
    # cleanup helpers
    for c in colls:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
    bpy.data.objects.remove(collider, do_unlink=True)
    # ---------------- museum plinth (spins with the figure)
    plinth = make_plinth(root)
    return root


def make_plinth(root):
    lac = kit.mat("Lacquer", (0.006, 0.006, 0.008), 0.12, coat=1.0)
    gold = kit.mat("GoldTrim", (1.0, 0.7, 0.3), 0.25, metal=1.0)
    bm = bmesh.new()
    prof = [(0.0, -0.075), (0.40, -0.075), (0.405, -0.07), (0.405, -0.012), (0.398, -0.006), (0.385, 0.0), (0.0, 0.0)]
    segs = 96
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((math.cos(2 * math.pi * k / segs) * r, math.sin(2 * math.pi * k / segs) * r, z))
                      for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.mesh_obj("Plinth", bm, root)
    kit.assign(ob, lac)
    ring = sweep("PlinthGold", [V((math.cos(2 * math.pi * k / 96) * 0.406, math.sin(2 * math.pi * k / 96) * 0.406, -0.018))
                                for k in range(96)], 0.0035, seg=8, parent=root, closed=True)
    kit.assign(ring, gold)
    return ob


# --------------------------------------------------------------------------- stage

def curtain():
    bm = bmesh.new()
    nx, nz = 420, 6
    W, Hh, y0 = 7.0, 5.0, 1.35
    rs = random.Random(9)
    ph = [rs.uniform(0, 6.28) for _ in range(3)]
    rows = []
    for i in range(nz):
        z = -0.1 + Hh * i / (nz - 1)
        row = []
        for j in range(nx):
            x = -W / 2 + W * j / (nx - 1)
            y = y0 + 0.07 * math.sin(x * 19 + ph[0] + 0.6 * math.sin(x * 3 + ph[1])) \
                + 0.035 * math.sin(x * 43 + ph[2]) + 0.02 * math.sin(z * 0.8 + x * 5)
            row.append(bm.verts.new((x, y, z)))
        rows.append(row)
    for i in range(nz - 1):
        for j in range(nx - 1):
            bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
    ob = kit.mesh_obj("Curtain", bm)
    m = bpy.data.materials.new("Velvet")
    g = G(m)
    out = g.n.new("ShaderNodeOutputMaterial")
    b = g.n.new("ShaderNodeBsdfPrincipled", "BSDF")
    b.inputs["Base Color"].default_value = (0.006, 0.006, 0.016, 1)
    b.inputs["Roughness"].default_value = 0.9
    b.inputs["Sheen Weight"].default_value = 1.0
    b.inputs["Sheen Roughness"].default_value = 0.35
    b.inputs["Sheen Tint"].default_value = (0.3, 0.33, 0.6, 1)
    g.L(b.outputs["BSDF"], out.inputs["Surface"])
    kit.assign(ob, m)
    return ob


def stage(root):
    kit.render_setup("CYCLES", (900, 1200), 128 if FINAL else 40, view="AgX", exposure=-0.15)
    sc = bpy.context.scene
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            sc.view_settings.look = look
            break
        except TypeError:
            pass
    cy = sc.cycles
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 8, 3, 4
    cy.transmission_bounces, cy.transparent_max_bounces = 2, 4
    cy.caustics_reflective = cy.caustics_refractive = False
    cy.adaptive_threshold = 0.02
    kit.world((0.004, 0.004, 0.007), 1.0)
    curtain()
    fl = kit.floor_disc(kit.mat("Floor", (0.005, 0.005, 0.006), 0.22, coat=0.4), radius=6, z=-0.075)
    # lights: warm key spot, cool softbox fill, two rims, sparkle top spot, backdrop pool
    kit.spot("Key", (-1.6, -2.5, 3.4), (0.0, 0, 1.15), 1700, angle=26, blend=0.45, radius=0.12, color=(1.0, 0.94, 0.86))
    kit.area("Fill", (2.4, -2.0, 1.5), (0, 0, 1.0), 70, 1.6, color=(0.78, 0.86, 1.0), shape="RECTANGLE")
    kit.area("RimL", (-1.9, 1.6, 2.4), (0, 0, 1.25), 520, 0.7, color=(0.82, 0.88, 1.0), shape="RECTANGLE")
    kit.area("RimR", (1.9, 1.5, 2.1), (0, 0, 1.1), 440, 0.7, color=(1.0, 0.88, 0.72), shape="RECTANGLE")
    kit.spot("Top", (0.25, -0.6, 3.8), (0, 0, 1.1), 700, angle=22, blend=0.3, radius=0.04, color=(1.0, 0.95, 0.88))
    kit.spot("Pool", (0.0, -0.8, 3.6), (0, 1.35, 1.2), 260, angle=34, blend=1.0, radius=0.3, color=(0.5, 0.55, 1.0))
    cam = kit.camera(lens=80)
    kit.frame_to(cam, root, margin=1.08, elev=0.1, aim_frac=0.5)
    zoom = os.environ.get("PZ_ZOOM")
    if zoom:   # debug close-ups: PZ_ZOOM=head|hands|feet
        tgt = {"head": V((0.02, -0.09, 1.55)), "hands": V((-0.1, -0.35, 1.05)), "feet": V((0, 0.05, 0.12)),
               "torso": V((0, -0.05, 1.2))}[zoom]
        cam.data.lens = 80
        cam.location = tgt + V((0, -0.95 if zoom == "head" else 1.6 * -1, 0.05))
        kit._aim(cam, tgt)


if __name__ == "__main__":
    kit.run(STYLE, build, stage)
