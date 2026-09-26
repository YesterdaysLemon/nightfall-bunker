# Stitchling (plush): a chibi plush-toy zombie at real toy scale (~0.39 m tall).
#   node art/zombies/blend.mjs z_plush.py --preview [--views three_quarter,front,side,back]
#
# Techniques
#   cloth with pressure  head, torso, legs, arms, feet and ears are puffed by a baked cloth
#                        sim; seam lines are pinned so panels bulge and the fabric puckers
#                        along them (amplitude normalised so every part gets a set puff)
#   skin modifier        arms and legs (joint chains -> skin -> subsurf -> voxel remesh)
#   sculpt by code       seam grooves, cheeks, button dimple, finger/toe splits, cupped ears
#   thread               every stitch is a swept tube placed with BVH surface lookups
#   ray-projected shell  the overalls are a (theta, z) grid shot onto the torso, with a
#                        torn hole snapped to a ragged ellipse, then solidified
#   hair curves          ~1M short felt fibres (numpy-scattered Curves objects) over every felt
#                        surface, kept clear of buttons, patches and pockets
#   Cycles               soft studio light, peach sweep, tilt-shift depth of field
import os, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
from mathutils import Vector as V, Matrix, Euler, kdtree, noise as mnoise
from mathutils.bvhtree import BVHTree

FINAL = "--final" in sys.argv
RNG = random.Random(11)


def lin(r, g, b):
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


C_MINT = lin(150, 178, 150)
C_LAV = lin(150, 124, 184)
C_LAV_CUFF = lin(162, 138, 194)
C_PATCH = lin(106, 80, 136)
C_CHEEK = lin(148, 108, 142)
C_CREAM = lin(236, 226, 206)
C_MOUTH = lin(48, 38, 44)
C_THREAD_D = lin(66, 56, 62)
C_THREAD_L = lin(230, 216, 204)
C_STUFF = lin(248, 246, 242)
C_PEACH = lin(255, 202, 168)

# ---------------------------------------------------------------- proportions (metres, toy scale)
HC = V((0.0, -0.004, 0.303))          # head centre
HR = (0.101, 0.095, 0.097)            # head radii before puffing
TC = V((0.0, 0.008, 0.142))           # torso centre
TR = (0.074, 0.059, 0.076)            # torso radii
WAIST = 0.128
BIB_TOP = 0.190
SHELL_T = 0.0028                       # overalls fabric thickness
LEG_X = 0.043
NECK = V((0.0, 0.0, 0.21))             # head tilt pivot
MIR = -1.0                             # mirror the sheet's asymmetric features (see head section)
M = {}


# ---------------------------------------------------------------- small helpers

def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def hdir(az, el):
    """Direction from the head centre: az 0 = straight ahead (-Y), + toward +X (viewer's right)."""
    a, e = math.radians(az), math.radians(el)
    return V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


def catmull(pts, n=8):
    pts = [V(p) for p in pts]
    P = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


def resample(pts, step):
    pts = [V(p) for p in pts]
    out = [pts[0]]
    carry = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = (b - a).length
        if seg < 1e-12:
            continue
        s = step - carry
        while s <= seg:
            out.append(a.lerp(b, s / seg))
            s += step
        carry = seg - (s - step)
    if (out[-1] - pts[-1]).length > step * 0.3:
        out.append(pts[-1])
    return out


def frame_t(n, rot_deg=0.0, up=None):
    """Tangent frame (tx right, ty up) for a surface normal n."""
    n = V(n).normalized()
    up = V(up) if up is not None else V((0, 0, 1))
    if abs(n.dot(up)) > 0.95:
        up = V((0, -1, 0))
    tx = up.cross(n).normalized()
    ty = n.cross(tx).normalized()
    if rot_deg:
        a = math.radians(rot_deg)
        tx, ty = tx * math.cos(a) + ty * math.sin(a), -tx * math.sin(a) + ty * math.cos(a)
    return tx, ty


class Surf:
    """BVH surface lookups over one or more meshes (world space)."""

    def __init__(self, obs):
        obs = obs if isinstance(obs, (list, tuple)) else [obs]
        verts, polys = [], []
        for ob in obs:
            mw = ob.matrix_world
            off = len(verts)
            verts += [mw @ v.co for v in ob.data.vertices]
            polys += [[off + i for i in p.vertices] for p in ob.data.polygons]
        self.bvh = BVHTree.FromPolygons(verts, polys)

    def near(self, p, hint=None):
        p = V(p)
        if hint is not None:
            p = p + V(hint).normalized() * 0.01
        loc, nor, i, d = self.bvh.find_nearest(p)
        return loc, nor

    def cast(self, origin, direction):
        loc, nor, i, d = self.bvh.ray_cast(V(origin), V(direction).normalized())
        return loc, nor

    def out(self, c, d, far=0.4):
        d = V(d).normalized()
        return self.cast(V(c) + d * far, -d)


def add_tube(bm, pts, r, seg=6, cap=True):
    pts = [V(p) for p in pts]
    if len(pts) < 2:
        return
    rings, prev = [], None
    for i, p in enumerate(pts):
        t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t = t.normalized() if t.length > 1e-12 else V((0, 0, 1))
        if prev is None:
            up = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
            a = t.cross(up).normalized()
        else:
            a = prev - t * prev.dot(t)
            a = a.normalized() if a.length > 1e-9 else t.cross(V((0, 0, 1))).normalized()
        b = t.cross(a).normalized()
        prev = a
        rr = r[i] if isinstance(r, (list, tuple)) else r
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * rr)
                      for k in range(seg)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])


class Thread:
    """One thread colour: accumulates stitches (swept tubes) into a single mesh."""

    def __init__(self, name, mat, seg=6):
        self.name, self.mat, self.seg = name, mat, seg
        self.bm = bmesh.new()
        self.count = 0

    def stitch(self, a, na, b, nb, r, arch=0.4, dip=1.0, n=6):
        """A stitch from a to b (surface points + normals) arching over the chord."""
        pts = []
        for k in range(n + 1):
            t = k / n
            p = a.lerp(b, t)
            nn = na.lerp(nb, t).normalized()
            s = math.sin(math.pi * t) ** 0.5
            h = -dip * r + (dip * r + r * 0.85 + arch * r) * s
            pts.append(p + nn * h)
        add_tube(self.bm, pts, r, self.seg)
        self.count += 1

    def along(self, surf, pts, r, hint=None, lift=0.85, dip=1.0):
        """A stitch that follows the surface (long X strokes, brows, toe lines)."""
        pts = resample(pts, max(r * 1.5, 0.0008))
        out = []
        n = len(pts)
        for i, p in enumerate(pts):
            loc, nn = surf.near(p, hint if hint is not None else None)
            t = i / max(1, n - 1)
            s = min(1.0, math.sin(math.pi * t) * 3.0)
            out.append(loc + nn * (-dip * r + (dip * r + lift * r) * s))
        add_tube(self.bm, out, r, self.seg)
        self.count += 1

    def seam(self, surf, path, spacing, width, r, line_r=None, alt=None, every=0):
        """Cross-stitched seam: ticks across the path (and an optional centre thread);
        every `every`-th tick goes to the `alt` thread."""
        pts = resample(path, spacing)
        for i, p in enumerate(pts):
            th = alt if (alt is not None and every and i % every == every // 2) else self
            loc, n = surf.near(p)
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = n.cross(t).normalized()
            jit = 1 + RNG.uniform(-0.12, 0.12)
            tw = RNG.uniform(-0.12, 0.12)
            a, na = surf.near(loc + (side + t * tw) * width * 0.5 * jit)
            b, nb = surf.near(loc - (side + t * tw) * width * 0.5 * jit)
            th.stitch(a, na, b, nb, r, arch=0.9)
        if line_r:
            self.along(surf, path, line_r, lift=0.4)

    def running(self, surf, path, dash, gap, r, hint=None):
        pts = resample(path, 0.0004)
        nd, ng = max(2, int(dash / 0.0004)), max(1, int(gap / 0.0004))
        i = ng // 2
        while i + nd < len(pts):
            seg = pts[i:i + nd + 1]
            self.along(surf, seg, r, hint=hint, lift=0.7)
            i += nd + ng

    def obj(self, parent):
        ob = kit.mesh_obj(self.name, self.bm, parent)
        kit.assign(ob, self.mat)
        return ob


# ---------------------------------------------------------------- materials

def felt(name, color, bump=0.9, mottle=0.14, sheen=1.0, sss=0.15, rough=0.95, fibre=1.0, sheen_rough=0.5):
    """Felt: two-scale colour mottling, swirly fibre bump, sheen for the soft rim, a little SSS."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    n = kit.Nodes(m)
    out = n.new("ShaderNodeOutputMaterial", loc=(900, 0))
    b = n.new("ShaderNodeBsdfPrincipled", "BSDF", loc=(600, 0))
    tc = n.new("ShaderNodeTexCoord", loc=(-1000, 0))
    mot = n.new("ShaderNodeTexNoise", loc=(-700, 250))
    mot.inputs["Scale"].default_value = 30.0
    mot.inputs["Detail"].default_value = 6.0
    mot.inputs["Roughness"].default_value = 0.65
    n.link(tc, "Object", mot, "Vector")
    mix = n.new("ShaderNodeMix", loc=(-350, 250))
    mix.data_type = "RGBA"
    n.link(mot, "Fac", mix, 0)
    lo = tuple(c * (1 - mottle) for c in color)
    hi = tuple(min(1.0, c * (1 + mottle)) for c in color)
    mix.inputs[6].default_value = (*lo, 1)
    mix.inputs[7].default_value = (*hi, 1)
    n.link(mix, 2, b, "Base Color")
    f1 = n.new("ShaderNodeTexNoise", loc=(-700, -150))
    f1.inputs["Scale"].default_value = 320.0 * fibre
    f1.inputs["Detail"].default_value = 8.0
    f1.inputs["Roughness"].default_value = 0.7
    f1.inputs["Distortion"].default_value = 2.5
    n.link(tc, "Object", f1, "Vector")
    f2 = n.new("ShaderNodeTexNoise", loc=(-700, -400))
    f2.inputs["Scale"].default_value = 1300.0 * fibre
    f2.inputs["Detail"].default_value = 3.0
    f2.inputs["Distortion"].default_value = 1.0
    n.link(tc, "Object", f2, "Vector")
    ma = n.new("ShaderNodeMath", loc=(-450, -250))
    ma.operation = "MULTIPLY_ADD"
    n.link(f1, "Fac", ma, 0)
    ma.inputs[1].default_value = 0.6
    n.link(f2, "Fac", ma, 2)
    bp = n.new("ShaderNodeBump", loc=(-200, -250))
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.0012
    n.link(ma, "Value", bp, "Height")
    n.link(bp, "Normal", b, "Normal")
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = 0.2
    b.inputs["Sheen Weight"].default_value = sheen
    b.inputs["Sheen Roughness"].default_value = sheen_rough
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (1.0, 0.75, 0.55)
        b.inputs["Subsurface Scale"].default_value = 0.004
    n.link(b, "BSDF", out, "Surface")
    m.diffuse_color = (*color, 1)
    return m


def make_mats():
    cols = {"mint": C_MINT, "lav": C_LAV, "cuff": C_LAV_CUFF, "patch": C_PATCH, "cheek": C_CHEEK,
            "cream": C_CREAM, "mouth": C_MOUTH, "stuff": C_STUFF}
    M["mint"] = felt("FeltMint", C_MINT)
    M["lav"] = felt("FeltLavender", C_LAV, mottle=0.12)
    M["cuff"] = felt("FeltLavenderCuff", C_LAV_CUFF, mottle=0.1)
    M["patch"] = felt("FeltPatch", C_PATCH, mottle=0.16)
    M["cheek"] = felt("FeltCheek", C_CHEEK, mottle=0.12)
    M["cream"] = felt("FeltCream", C_CREAM, mottle=0.05, sss=0.2)
    M["mouth"] = felt("FeltMouth", C_MOUTH, mottle=0.1, sss=0.0)
    M["stuff"] = felt("Stuffing", C_STUFF, bump=0.9, mottle=0.03, sss=0.35, fibre=1.6)
    for k, c in cols.items():   # fibre tips: a touch lighter and greyer than the body of the felt
        tip = tuple(min(1.0, x * 1.25 + 0.03) for x in c)
        M["fz_" + k] = kit.mat("Fibre" + k.title(), tip, 0.9, sheen=1.0, spec=0.2)
    M["thread_d"] = kit.mat("ThreadDark", C_THREAD_D, 0.6, sheen=0.4, spec=0.3)
    M["thread_l"] = kit.mat("ThreadLight", C_THREAD_L, 0.6, sheen=0.4, spec=0.3)
    M["button"] = kit.mat("ButtonBlack", (0.004, 0.004, 0.005), 0.13, spec=0.28)
    M["button_g"] = kit.mat("ButtonGrey", lin(88, 84, 94), 0.25, coat=0.6, spec=0.5)
    M["peach"] = kit.mat("PeachSweep", C_PEACH, 0.85, spec=0.2)
    M["tag"] = kit.mat("SatinTag", lin(246, 242, 234), 0.35, sheen=0.6, spec=0.5)


# ---------------------------------------------------------------- felt fibres

def fibres(ob, mat, density=1.5e6, length=0.003, radius=0.00007, tilt=0.55, seed=0, avoid=(), gap=0.003):
    """Felt fuzz as a real hair Curves object: fibres scattered over the evaluated surface
    (area weighted), leaning off the normal, three points each with a slight curl.
    (Curves emitted by a Geometry Nodes modifier on a mesh were evaluated but never reached
    Cycles in 5.2, so the fibres are built directly as a hair Curves datablock.)"""
    import numpy as np
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tri = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    ev.to_mesh_clear()
    mw = np.array(ob.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    cr = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    nrm = cr / (2 * area[:, None] + 1e-15)
    N = int(area.sum() * density)
    if N < 1:
        return None
    rng = np.random.default_rng(seed)
    idx = rng.choice(nt, N, p=area / area.sum())
    u, v = rng.random(N), rng.random(N)
    f = u + v > 1
    u[f], v[f] = 1 - u[f], 1 - v[f]
    p = a[idx] + (b[idx] - a[idx]) * u[:, None] + (c[idx] - a[idx]) * v[:, None]
    n = nrm[idx]
    if avoid:                                  # no fuzz poking through buttons, patches, pockets
        av = Surf(list(avoid))
        keep = np.array([av.bvh.find_nearest(V(q), gap)[0] is None for q in p], bool)
        p, n, N = p[keep], n[keep], int(keep.sum())
    d = n + rng.normal(size=(N, 3)) * tilt
    d -= n * np.minimum(0.0, (d * n).sum(1))[:, None] * 1.2          # never into the surface
    d /= np.linalg.norm(d, axis=1)[:, None]
    L = length * (0.3 + 0.7 * rng.random(N) ** 1.5)
    curl = rng.normal(size=(N, 3))
    root = p - n * 0.0002
    mid = p + d * (L * 0.5)[:, None] + curl * (L * 0.1)[:, None]
    tip = p + d * L[:, None] + curl * (L * 0.25)[:, None]
    pts = np.stack([root, mid, tip], axis=1).reshape(-1).astype(np.float32)
    cv = bpy.data.hair_curves.new(ob.name + "_fibres")
    cv.add_curves([3] * N)
    cv.position_data.foreach_set("vector", pts)
    rad = cv.attributes.get("radius") or cv.attributes.new("radius", "FLOAT", "POINT")
    rad.data.foreach_set("value", np.tile(np.array([radius, radius * 0.8, radius * 0.35], np.float32), N))
    cv.materials.append(mat)
    fo = bpy.data.objects.new(ob.name + "_fibres", cv)
    kit.link(fo, ob.parent)
    return fo


# ---------------------------------------------------------------- geometry helpers

def unit_sphere(name, level, fn, parent):
    ob = kit.quad_sphere(name, 1.0, level, parent=parent)
    for v in ob.data.vertices:
        v.co = fn(v.co.normalized())
    ob.data.update()
    return ob


def puff(ob, target, pressure=60.0, stiffness=4.0, frames=24, pin=None):
    """Cloth-pressure inflation, amplitude normalised: the sim gives the shape of the
    puff (panels bulge, pinned seams stay), `target` sets its 75th-percentile size."""
    pre = [v.co.copy() for v in ob.data.vertices]
    kit.inflate_cloth(ob, pressure=pressure, frames=frames, stiffness=stiffness, pin=pin)
    post = [v.co.copy() for v in ob.data.vertices]
    if len(post) != len(pre):
        print("[plush] puff: topology changed on", ob.name)
        return ob
    ds = sorted((b - a).length for a, b in zip(pre, post))
    ref = ds[int(len(ds) * 0.75)]
    k = target / ref if ref > 1e-7 else 1.0
    for v, a, b in zip(ob.data.vertices, pre, post):
        v.co = a + (b - a) * k
    ob.data.update()
    print(f"[plush] puff {ob.name}: p75 {ref * 1000:.2f} mm -> x{k:.2f}")
    return ob


def lathe(prof, segs=48, closed=False):
    bm = bmesh.new()
    rings = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * ca, r * sa, z)) for r, z in prof])
    m = len(prof)
    for k in range(segs):
        r0, r1 = rings[k], rings[(k + 1) % segs]
        for i in range(m if closed else m - 1):
            j = (i + 1) % m
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    if not closed:
        bm.faces.new([rings[k][0] for k in range(segs)])
        bm.faces.new([rings[k][-1] for k in range(segs)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def orient(n, rot_deg=0.0, loc=(0, 0, 0)):
    q = V(n).normalized().to_track_quat("Z", "Y")
    return Matrix.Translation(V(loc)) @ q.to_matrix().to_4x4() @ Matrix.Rotation(math.radians(rot_deg), 4, "Z")


def button(name, loc, n, R, D, mat, rot=0.0, parent=None, thread=None, thread_r=None):
    """Sew-through button: lathed rim + dished face, four holes (exact boolean), X of thread."""
    prof = [(0.30, 0.56), (0.50, 0.57), (0.62, 0.63), (0.70, 0.82), (0.78, 0.97), (0.86, 1.0),
            (0.93, 0.93), (0.985, 0.76), (1.0, 0.5), (0.98, 0.22), (0.92, 0.04), (0.8, 0.0), (0.3, 0.0)]
    bm = lathe([(r * R, z * D) for r, z in prof], 48)
    ob = kit.mesh_obj(name, bm, parent)
    cb = bmesh.new()
    hx = 0.21 * R
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        bmesh.ops.create_cone(cb, cap_ends=True, cap_tris=False, segments=16, radius1=0.085 * R,
                              radius2=0.085 * R, depth=D * 2, matrix=Matrix.Translation((sx * hx, sy * hx, D * 1.28)))
    cut = kit.mesh_obj(name + "_cut", cb)
    md = ob.modifiers.new("Holes", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cut
    try:
        md.solver = "EXACT"
    except Exception:
        pass
    kit.apply_modifiers(ob)
    bpy.data.objects.remove(cut, do_unlink=True)
    mw = orient(n, rot, loc)
    ob.data.transform(mw)
    kit.shade_smooth(ob)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    kit.assign(ob, mat)
    if thread is not None:
        tr = thread_r or 0.07 * R
        for (x0, y0), (x1, y1) in (((-hx, -hx), (hx, hx)), ((-hx, hx), (hx, -hx))):
            pts = []
            for k in range(9):
                t = k / 8
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                z = 0.25 * D + (0.62 * D + tr * 1.1 - 0.25 * D) * (math.sin(math.pi * t) ** 0.35)
                pts.append(mw @ V((x, y, z)))
            add_tube(thread.bm, pts, tr, 6)
    return ob


class Patch:
    """A felt patch conformed to a surface: superellipse outline, solidified, soft edges."""

    def __init__(self, name, surf, loc, n, a, b, mat, rot=0.0, thick=0.0016, power=2.0, jag=0.025,
                 seed=0, parent=None, lift=0.0002, rings=6, segs=48):
        self.surf, self.loc, self.n = surf, V(loc), V(n).normalized()
        self.tx, self.ty = frame_t(self.n, rot)
        self.a, self.b, self.p, self.jag, self.seed = a, b, power, jag, seed
        bm = bmesh.new()
        c = bm.verts.new(self.world2d(0, 0, lift))
        prev = None
        ringsv = []
        for k in range(1, rings + 1):
            f = k / rings
            ring = []
            for j in range(segs):
                phi = 2 * math.pi * j / segs
                r = self.radius(phi) * f
                ring.append(bm.verts.new(self.world2d(r * math.cos(phi), r * math.sin(phi), lift)))
            ringsv.append(ring)
        for j in range(segs):
            bm.faces.new((c, ringsv[0][j], ringsv[0][(j + 1) % segs]))
        for r0, r1 in zip(ringsv, ringsv[1:]):
            for j in range(segs):
                bm.faces.new((r0[j], r1[j], r1[(j + 1) % segs], r0[(j + 1) % segs]))
        bm.normal_update()
        if sum((f.normal.dot(self.n) for f in bm.faces)) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        ob = kit.mesh_obj(name, bm, parent)
        sol = ob.modifiers.new("Solid", "SOLIDIFY")
        sol.thickness = thick
        sol.offset = 1.0
        sub = ob.modifiers.new("Sub", "SUBSURF")
        sub.levels = sub.render_levels = 1
        kit.apply_modifiers(ob)
        kit.shade_smooth(ob)
        kit.assign(ob, mat)
        self.ob = ob
        self.top = Surf(ob)

    def radius(self, phi):
        c, s = abs(math.cos(phi)), abs(math.sin(phi))
        r = 1.0 / max(1e-6, ((c / self.a) ** self.p + (s / self.b) ** self.p)) ** (1.0 / self.p)
        return r * (1 + self.jag * mnoise.noise(V((math.cos(phi) * 2.3, math.sin(phi) * 2.3, self.seed * 1.7))))

    def world2d(self, u, v, lift=0.0):
        q = self.loc + self.tx * u + self.ty * v
        loc, nn = self.surf.near(q, self.n)
        return loc + nn * lift

    def outline(self, inset, n=360):
        pts = []
        for j in range(n + 1):
            phi = 2 * math.pi * j / n
            r = self.radius(phi) - inset
            pts.append((phi, r))
        return pts

    def whip(self, th, spacing, inner, outer, r):
        """Short stitches crossing the patch edge all the way round."""
        ol = self.outline(0.0, 720)
        P = [V((r_ * math.cos(ph), r_ * math.sin(ph), 0)) for ph, r_ in ol]
        L = [0.0]
        for a, b in zip(P, P[1:]):
            L.append(L[-1] + (b - a).length)
        k = max(6, int(L[-1] / spacing))
        j = 0
        for s in range(k):
            tgt = L[-1] * (s + 0.5) / k
            while L[j + 1] < tgt:
                j += 1
            ph, rr = ol[j]
            u, v = math.cos(ph), math.sin(ph)
            ai, na = self.top.near(self.loc + self.tx * u * (rr - inner) + self.ty * v * (rr - inner), self.n)
            bo, nb = self.surf.near(self.loc + self.tx * u * (rr + outer) + self.ty * v * (rr + outer), self.n)
            th.stitch(ai, na, bo, nb, r, arch=1.2, n=6)

    def running(self, th, inset, dash, gap, r):
        pts = [self.loc + self.tx * (rr - inset) * math.cos(ph) + self.ty * (rr - inset) * math.sin(ph)
               for ph, rr in self.outline(0.0, 240)]
        th.running(self.top, pts, dash, gap, r, hint=self.n)


# ---------------------------------------------------------------- head
# Feature layout is written in the concept sheet's front-view azimuths (button on the viewer's
# left) and mirrored with MIR, so the kit's -35 deg hero view shows the button side the way the
# sheet's own three-quarter view does.

def fdir(az, el):
    return hdir(MIR * az, el)


def head_pt(d):
    x, y, z = d.x * HR[0], d.y * HR[1], d.z * HR[2]
    if d.z < 0:
        x *= 1 + 0.05 * (-d.z)
        y *= 1 + 0.02 * (-d.z)
    if d.y < 0:
        y *= 1 - 0.05 * (-d.y) ** 2
    return HC + V((x, y, z))


def seam_dirs():
    a = math.radians(MIR * 7)
    f = V((math.sin(a), -math.cos(a), 0))
    front = [fdir(9.5, -20), fdir(10.5, -9), fdir(10, 3), fdir(8.8, 15), fdir(7.6, 26)]
    over = [(f * math.cos(math.radians(t)) + V((0, 0, 1)) * math.sin(math.radians(t))).normalized()
            for t in range(36, 244, 8)]
    main = [d.normalized() for d in catmull(front + over, 6)]
    side = [d.normalized() for d in catmull([fdir(7, 74), fdir(-24, 68), fdir(-47, 53), fdir(-62, 34),
                                             fdir(-69, 12), fdir(-71, -13)], 8)]
    return main, side


def build_head(hp):
    head = unit_sphere("Head", 5, head_pt, hp)
    main, side = seam_dirs()
    kd_pts = [head_pt(d) for path in (main, side) for d in resample(path, 0.004)]
    kd = kdtree.KDTree(len(kd_pts))
    for i, p in enumerate(kd_pts):
        kd.insert(p, i)
    kd.balance()

    def pinw(co):
        _, _, d = kd.find(co)
        return 1.0 if d < 0.0022 else max(0.0, (0.0042 - d) / 0.002)
    kit.vgroup(head, "seam", pinw)
    puff(head, 0.0045, pressure=400, stiffness=2, frames=28, pin="seam")
    hs = Surf(head)
    seam_w = [[hs.out(HC, d)[0] for d in path] for path in (main, side)]
    s = kit.Sculpt(head)
    for path in seam_w:
        s.crease_stroke(path, 0.0036, 0.0012)
    for az in (-38, 38):
        s.inflate(HC + fdir(az, -30) * 0.1, 0.036, 0.0024)
    s.crease_stroke([HC + fdir(-16, -29) * 0.1, HC + fdir(16, -29) * 0.1], 0.013, 0.0014)
    s.inflate(HC + fdir(-33, -6) * 0.1, 0.036, -0.0022)
    s.flatten(HC + V((0, 0, -0.094)), 0.05, (0, 0, 1), 0.35, offset=0.003)
    s.noise(24, 0.0006, seed=3)
    s.smooth(1, 0.3)
    s.done()
    kit.assign(head, M["mint"])
    return head, main, side


def build_ear(hp, head, sx):
    hs = Surf(head)
    p, n = hs.out(HC, hdir(sx * 88, -14))
    out = (n + V((0, -0.25, 0.05))).normalized()
    up = V((0, 0, 1))
    side = up.cross(out).normalized()
    up = out.cross(side).normalized()
    c = p - out * 0.004
    ear = unit_sphere(f"Ear.{'L' if sx > 0 else 'R'}", 3,
                      lambda d: c + out * (d.x * 0.0092) + side * (d.y * 0.0205) + up * (d.z * 0.0235), hp)
    kit.vgroup(ear, "rim", lambda co: 1.0 if abs((co - c).dot(out)) < 0.0013 else 0.0)
    puff(ear, 0.0016, pressure=600, stiffness=1.5, frames=20, pin="rim")
    s = kit.Sculpt(ear)
    s.inflate(c + out * 0.0102 - up * 0.001 + side * 0.002, 0.0115, -0.0036)
    s.smooth(1, 0.3)
    s.done()
    kit.assign(ear, M["mint"])
    return ear


def head_details(hp, head, main, side, tD, tL):
    hs = Surf(head)
    # button eye
    p, n = hs.out(HC, fdir(-32, -6))
    button("EyeButton", p - n * 0.0016, n, 0.031, 0.0082, M["button"], rot=10, parent=hp,
           thread=tD, thread_r=0.0012)
    # X eye: cream felt disc, whip-stitched edge, X in doubled yarn
    p, n = hs.out(HC, fdir(32, -6))
    xp = Patch("EyePatch", hs, p, n, 0.0305, 0.0305, M["cream"], rot=0, thick=0.002, seed=2, parent=hp)
    xp.whip(tL, 0.0046, 0.0024, 0.0017, 0.00055)
    d = 0.0134
    for (u0, v0), (u1, v1) in (((-d, -d), (d, d)), ((-d, d), (d, -d))):
        for off in (-0.00075, 0.00075):
            ox, oy = -(v1 - v0), (u1 - u0)
            L = math.hypot(ox, oy)
            ox, oy = ox / L * off, oy / L * off
            pts = [xp.loc + xp.tx * (u0 + (u1 - u0) * t + ox) + xp.ty * (v0 + (v1 - v0) * t + oy)
                   for t in (0, 0.25, 0.5, 0.75, 1)]
            tD.along(xp.top, pts, 0.00095, hint=xp.n, lift=0.9, dip=1.2)
    # wide felt mouth with two square teeth
    p, n = hs.out(HC, fdir(-1, -29))
    mo = Patch("Mouth", hs, p, n, 0.036, 0.0079, M["mouth"], rot=0, thick=0.0012, power=5, jag=0.02, seed=4,
               parent=hp, segs=64)
    hm = Surf([head, mo.ob])
    for i, u in enumerate((-0.0195, 0.0085)):
        tp = mo.loc + mo.tx * (MIR * u) + mo.ty * 0.0019
        loc, nn = hm.near(tp, mo.n)
        Patch(f"Tooth.{i}", hm, loc, mo.n, 0.0092, 0.009, M["cream"], rot=(i * 2 - 1) * 3,
              thick=0.0024, power=5, jag=0.03, seed=7 + i, parent=hp, rings=4, segs=32)
    # cheek patch
    p, n = hs.out(HC, fdir(-53, -32))
    cp = Patch("CheekPatch", hs, p, n, 0.0205, 0.0198, M["cheek"], rot=MIR * 12, thick=0.0017, power=7,
               jag=0.03, seed=5, parent=hp)
    cp.whip(tL, 0.0046, 0.0024, 0.0017, 0.00052)
    # worried stitched brows (higher at the inner end)
    for dirs in ((fdir(-52, 11), fdir(-45, 15.5), fdir(-38, 18.5)), (fdir(37, 20), fdir(44, 17.5), fdir(51, 13))):
        pts = [hs.out(HC, dd)[0] for dd in catmull(list(dirs), 5)]
        tD.along(hs, pts, 0.0013, lift=0.9, dip=1.2)
    # cross-stitched seams, the odd tick in cream like a repair
    for path in (main, side):
        pts = [hs.out(HC, dd)[0] for dd in path]
        tD.seam(hs, pts, 0.0098, 0.0122, 0.001, line_r=0.00062, alt=tL, every=5)


# ---------------------------------------------------------------- body

def torso_pt(d):
    k = 1 + 0.06 * (-d.z)
    x, y, z = d.x * TR[0] * k, d.y * TR[1] * k, d.z * TR[2]
    return TC + V((x, y, z))


def build_torso(root):
    t = unit_sphere("Torso", 4, torso_pt, root)

    def pinw(co):
        dz = abs(co.z - WAIST)
        w = 1.0 if dz < 0.0016 else max(0.0, (0.0032 - dz) / 0.0016)
        if abs(co.y - TC.y) < 0.0018 and abs(co.x) > 0.02:
            w = 1.0
        return w
    kit.vgroup(t, "seam", pinw)
    puff(t, 0.0032, pressure=600, stiffness=2, frames=24, pin="seam")
    kit.subdivide(t, 1)
    s = kit.Sculpt(t)
    s.inflate((0, TC.y - TR[1] * 1.05, 0.125), 0.045, 0.003)
    s.noise(40, 0.0004, seed=9)
    s.done()
    kit.shade_smooth(t)
    kit.assign(t, M["mint"], M["lav"])
    kit.assign_by(t, lambda c, n: 1 if c.z < WAIST - 0.003 else 0)
    return t


R_ARC = 0.074                                          # torso radius used for arc lengths
TEAR = (math.radians(MIR * 21), 0.1245, 0.0148, 0.0125)  # theta, z, half-width (arc), half-height


def tear_r(phi):
    return 1 + 0.2 * mnoise.noise(V((math.cos(phi) * 1.8, math.sin(phi) * 1.8, 4.2))) + 0.07 * math.sin(phi * 7)


def in_tear(th, z, grow=0.0):
    tth, tz, tu, tv = TEAR
    du, dv = (th - tth) * R_ARC / (tu + grow), (z - tz) / (tv + grow)
    return math.hypot(du, dv) < tear_r(math.atan2(dv, du)), du, dv


def build_overalls(root, torso):
    ts = Surf(torso)
    thb, dth = math.radians(50), math.radians(5)
    zbot = 0.092
    cols, rows = 160, 30

    def ztop(th):
        return WAIST + (BIB_TOP - WAIST) * smoothstep((thb - abs(th)) / dth)

    def hit(th, z):
        d = V((math.sin(th), -math.cos(th), 0))
        o = V((TC.x, TC.y, z)) + d * 0.3
        loc, n = ts.cast(o, -d)
        if loc is None:
            loc, n = ts.near(o - d * 0.25)
        return loc, n

    tth, tz, tu, tv = TEAR
    P = {}
    for i in range(cols):
        th = -math.pi + 2 * math.pi * i / cols
        zt = ztop(th)
        for j in range(rows + 1):
            P[i, j] = [th, zbot + (zt - zbot) * j / rows]
    keep = {}
    for i in range(cols):
        for j in range(rows):
            th = -math.pi + 2 * math.pi * (i + 0.5) / cols
            z = (P[i, j][1] + P[i, j + 1][1] + P[(i + 1) % cols, j][1] + P[(i + 1) % cols, j + 1][1]) / 4
            keep[i, j] = not in_tear(th, z)[0]
    for i in range(cols):
        for j in range(rows + 1):
            adj = [keep.get(((i + di) % cols, j + dj)) for di in (-1, 0) for dj in (-1, 0)]
            adj = [a for a in adj if a is not None]
            if adj and any(adj) and not all(adj):
                th, z = P[i, j]
                _, du, dv = in_tear(th, z)
                phi = math.atan2(dv, du)
                r = tear_r(phi)
                P[i, j] = [tth + math.cos(phi) * r * tu / R_ARC, tz + math.sin(phi) * r * tv]
    bm = bmesh.new()
    VV = {}

    def vert(i, j):
        if (i, j) not in VV:
            th, z = P[i, j]
            loc, n = hit(th, z)
            VV[i, j] = bm.verts.new(loc + n * 0.0004)
        return VV[i, j]
    for (i, j), k in keep.items():
        if k:
            bm.faces.new((vert(i, j), vert((i + 1) % cols, j), vert((i + 1) % cols, j + 1), vert(i, j + 1)))
    bm.normal_update()
    if sum(f.normal.dot(f.calc_center_median() - TC) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    ob = kit.mesh_obj("Overalls", bm, root)
    kit.vgroup(ob, "thick", lambda co: max(0.02, smoothstep((co.z - zbot) / 0.02)))
    sol = ob.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = SHELL_T
    sol.offset = 1.0
    sol.vertex_group = "thick"
    sol.thickness_vertex_group = 0.02
    sub = ob.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    kit.apply_modifiers(ob)
    kit.shade_smooth(ob)
    s = kit.Sculpt(ob)
    cs = [hit(0.0, z)[0] for z in (0.131, 0.11, 0.09, 0.08)]
    s.crease_stroke(cs, 0.0035, 0.0012)
    s.noise(60, 0.0003, seed=4)
    s.done()
    kit.assign(ob, M["lav"])
    return ob, dict(thb=thb, dth=dth, ztop=ztop, hit=hit)


def build_legs(root):
    J, B = {"pelvis": [V((0, 0.008, 0.098)), (0.05, 0.045)]}, []
    for s, sx in (("L", 1), ("R", -1)):
        J[f"hip.{s}"] = [V((sx * 0.040, 0.006, 0.088)), (0.0355, 0.0355)]
        J[f"knee.{s}"] = [V((sx * 0.042, 0.004, 0.068)), (0.0345, 0.0345)]
        J[f"ankle.{s}"] = [V((sx * LEG_X, 0.004, 0.05)), (0.0335, 0.0335)]
        B += [("pelvis", f"hip.{s}"), (f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"ankle.{s}")]
    legs = kit.skin_body("Legs", J, B, parent=root, subdiv=2)
    kit.remesh(legs, 0.0016)
    puff(legs, 0.0015, pressure=300, stiffness=4, frames=20)
    s = kit.Sculpt(legs)
    s.noise(45, 0.0004, seed=6)
    s.smooth(1, 0.3)
    s.done()
    kit.assign(legs, M["lav"])
    return legs


def build_cuffs(root):
    out = []
    for s, sx in (("L", 1), ("R", -1)):
        prof = []
        ri, ro, z0, z1, cr = 0.0335, 0.0398, 0.036, 0.0605, 0.0032
        corners = [((ro - cr, z0 + cr), -90, 0), ((ro - cr, z1 - cr), 0, 90), ((ri + cr, z1 - cr), 90, 180),
                   ((ri + cr, z0 + cr), 180, 270)]
        for (cx, cz), a0, a1 in corners:
            for k in range(5):
                a = math.radians(a0 + (a1 - a0) * k / 4)
                prof.append((cx + math.cos(a) * cr, cz + math.sin(a) * cr))
        bm = lathe(prof, 48, closed=True)
        ob = kit.mesh_obj(f"Cuff.{s}", bm, root)
        ob.data.transform(Matrix.Translation((sx * LEG_X, 0.004, 0.0)))
        sc = kit.Sculpt(ob)
        sc.noise(80, 0.0006, seed=11 + sx)
        for zc, dep in ((0.0442, 0.0011), (0.0524, 0.0009)):
            sc.crease_stroke([V((sx * LEG_X + math.cos(a) * 0.0405, 0.004 + math.sin(a) * 0.0405, zc + 0.0006 * math.sin(3 * a)))
                              for a in [2 * math.pi * k / 48 for k in range(49)]], 0.0022, dep)
        sc.done()
        sub = ob.modifiers.new("Sub", "SUBSURF")
        sub.levels = sub.render_levels = 1
        kit.apply_modifiers(ob)
        kit.shade_smooth(ob)
        kit.assign(ob, M["cuff"])
        out.append(ob)
    return out


def build_feet(root, tD):
    feet = []
    for s, sx in (("L", 1), ("R", -1)):
        c = V((sx * 0.045, -0.013, 0.0195))
        yaw = math.radians(sx * 8)
        fw = V((math.sin(yaw), -math.cos(yaw), 0))
        sd = V((math.cos(yaw), math.sin(yaw), 0))

        def fn(d):
            k = 1 + 0.12 * max(0.0, -d.y)
            return c + sd * d.x * 0.033 * k + fw * (-d.y) * 0.046 + V((0, 0, d.z * 0.0205))
        ft = unit_sphere(f"Foot.{s}", 4, fn, root)
        for v in ft.data.vertices:
            if v.co.z < 0.0045:
                v.co.z = 0.0045 - (0.0045 - v.co.z) * 0.2
        grooves = (-0.011, 0.011)

        def pinw(co):
            q = co - c
            w = 1.0 if abs(co.z - 0.0065) < 0.0012 else 0.0
            f, l = q.dot(fw), q.dot(sd)
            for lk in grooves:
                w = max(w, smoothstep((f - 0.013) / 0.009) * max(0.0, 1 - abs(l - lk) / 0.0024))
            return w
        kit.vgroup(ft, "seam", pinw)
        puff(ft, 0.0024, pressure=800, stiffness=2, frames=20, pin="seam")
        fs = Surf(ft)
        toes = []
        for lk in grooves:
            pts = []
            for a in range(-15, 75, 5):
                ar = math.radians(a)
                d = fw * math.cos(ar) + V((0, 0, math.sin(ar) * 0.7))
                loc = fs.out(c + sd * lk, d)[0]
                if loc is not None and (loc - c).dot(fw) > 0.016:
                    pts.append(loc)
            toes.append(pts)
        sc = kit.Sculpt(ft)
        for line in toes:
            sc.crease_stroke(line, 0.0028, 0.0016)
        sc.done()
        for v in ft.data.vertices:
            if v.co.z < 0.005:
                v.co.z = 0.005 - (0.005 - v.co.z) * 0.3
        zmin = min(v.co.z for v in ft.data.vertices)
        for v in ft.data.vertices:
            v.co.z -= zmin
        kit.assign(ft, M["mint"])
        fs = Surf(ft)
        for line in toes:
            if len(line) > 2:
                tD.along(fs, line, 0.0006, lift=0.6)
        feet.append(ft)
    return feet


def build_arm(root, sx, lift, tD):
    s = "L" if sx > 0 else "R"
    sh = V((sx * 0.052, 0.006, 0.188 + lift * 0.3))
    el = V((sx * 0.081, -0.038, 0.186 + lift * 0.6))
    wr = V((sx * 0.092, -0.081, 0.184 + lift))
    J = {"sh": [sh, (0.0218, 0.0218)], "el": [el, (0.0212, 0.0212)], "wr": [wr, (0.0198, 0.0198)]}
    arm = kit.skin_body(f"Arm.{s}", J, [("sh", "el"), ("el", "wr")], parent=root, subdiv=2)
    fwd = (wr - el).normalized()
    fwd = (fwd + V((0, 0, -0.28))).normalized()
    sd = fwd.cross(V((0, 0, 1))).normalized()
    up = sd.cross(fwd).normalized()
    hc = wr + fwd * 0.019 + up * 0.001

    def fn(d):
        k = 1 + 0.14 * max(0.0, -d.y)
        return hc + sd * d.x * 0.026 * k + fwd * (-d.y) * 0.029 + up * d.z * 0.0175
    hand = unit_sphere(f"Hand.{s}", 4, fn, root)
    arm = kit.join([arm, hand], f"Arm.{s}")
    kit.remesh(arm, 0.0014)
    splits = (-0.0135, 0.0, 0.0135)

    def split_w(co):
        q = co - hc
        f, l = q.dot(fwd), q.dot(sd)
        w = 0.0
        for lk in splits:
            w = max(w, smoothstep((f - 0.004) / 0.012) * max(0.0, 1 - abs(l - lk) / 0.0032))
        return w
    sc = kit.Sculpt(arm)
    for i, v in enumerate(sc.bm.verts):
        w = split_w(v.co)
        if w > 0:
            v.co -= sc.normals[i] * 0.0042 * w
    sc.done()
    kit.vgroup(arm, "seam", split_w)
    puff(arm, 0.0017, pressure=600, stiffness=2, frames=20, pin="seam")
    sc = kit.Sculpt(arm)
    sc.smooth(1, 0.25)
    sc.noise(50, 0.0003, seed=21 + sx)
    sc.done()
    kit.assign(arm, M["mint"])
    # a short cross-stitched seam along the outer forearm
    asf = Surf(arm)
    outd = (sd * sx * 0.75 + up * 0.65).normalized()
    path = [asf.out(el.lerp(wr, t), outd)[0] for t in (0.05, 0.35, 0.65, 0.9)]
    path = [p for p in path if p is not None]
    if len(path) > 1:
        tD.seam(asf, catmull(path, 6), 0.0075, 0.0085, 0.0006, line_r=0.0004)
    return arm


def build_straps(root, torso, tD):
    ts = Surf(torso)
    out = []
    for s, sx in (("L", 1), ("R", -1)):
        guide = [(0.041, -0.06, 0.179), (0.043, -0.05, 0.196), (0.045, -0.03, 0.211), (0.046, -0.002, 0.222),
                 (0.045, 0.028, 0.214), (0.043, 0.05, 0.192), (0.041, 0.062, 0.166), (0.040, 0.064, 0.14),
                 (0.039, 0.062, 0.12)]
        guide = [V((sx * x, y, z)) for x, y, z in guide]
        path = resample(catmull(guide, 8), 0.0018)
        pts, nrm = [], []
        for p in path:
            loc, n = ts.out(TC, p - TC)
            if loc is None:
                continue
            front = loc.y < TC.y
            if front:
                over = 1.0 if loc.z < BIB_TOP + 0.001 else max(0.0, 1 - (loc.z - BIB_TOP - 0.001) / 0.008)
            else:
                over = 1.0 if loc.z < WAIST + 0.002 else max(0.0, 1 - (loc.z - WAIST - 0.002) / 0.008)
            pts.append(loc + n * (0.0005 + SHELL_T * over))
            nrm.append(n)
        bm = bmesh.new()
        w = 0.0078
        rows = []
        for i, (p, n) in enumerate(zip(pts, nrm)):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            b = n.cross(t).normalized()
            rows.append([bm.verts.new(p + b * w * k) for k in (-1, -0.5, 0, 0.5, 1)])
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(4):
                bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
        bm.normal_update()
        if sum(f.normal.dot(f.calc_center_median() - TC) for f in bm.faces) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        ob = kit.mesh_obj(f"Strap.{s}", bm, root)
        sol = ob.modifiers.new("Solid", "SOLIDIFY")
        sol.thickness = 0.0024
        sol.offset = 1.0
        sub = ob.modifiers.new("Sub", "SUBSURF")
        sub.levels = sub.render_levels = 1
        kit.apply_modifiers(ob)
        kit.shade_smooth(ob)
        kit.assign(ob, M["lav"])
        out.append(ob)
        ss = Surf(ob)
        loc, n = ss.near(pts[3] + nrm[3] * 0.01)
        button(f"StrapButton.{s}", loc - n * 0.0004, n, 0.0086, 0.0034, M["button_g"], rot=20 * sx, parent=root,
               thread=tD, thread_r=0.00065)
    return out


def overall_details(root, torso, shell, info, legs, tL, tD):
    shs = Surf(shell)
    hit = info["hit"]
    # patch pocket with a turned hem
    bm = bmesh.new()
    nu, nv = 18, 12
    th0, th1, z0, z1 = -0.032 / R_ARC, 0.032 / R_ARC, 0.1305, 0.1685
    grid = {}
    for i in range(nu + 1):
        for j in range(nv + 1):
            th = th0 + (th1 - th0) * i / nu
            z = z0 + (z1 - z0) * j / nv
            loc, n = hit(th, z)
            loc2, n2 = shs.near(loc + n * 0.012)
            grid[i, j] = bm.verts.new(loc2 + n2 * 0.0002)
    for i in range(nu):
        for j in range(nv):
            th = th0 + (th1 - th0) * (i + 0.5) / nu
            z = z0 + (z1 - z0) * (j + 0.5) / nv
            if in_tear(th, z, 0.001)[0]:
                continue
            bm.faces.new((grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.normal_update()
    if sum(f.normal.dot(f.calc_center_median() - TC) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    pk = kit.mesh_obj("Pocket", bm, root)
    sol = pk.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.0016
    sol.offset = 1.0
    sub = pk.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    kit.apply_modifiers(pk)
    kit.shade_smooth(pk)
    s = kit.Sculpt(pk)
    s.crease_stroke([hit(th0 + (th1 - th0) * k / 10, z1 - 0.0062)[0] + hit(0, z1)[1] * 0.004 for k in range(11)],
                    0.0022, 0.0009)
    s.done()
    kit.assign(pk, M["lav"])
    ps = Surf(pk)

    def above(th, z, h=0.006):
        loc, n = hit(th, z)
        return loc + n * h
    ins = 0.0024 / R_ARC
    edge = [above(th0 + ins, z1 - 0.0062), above(th0 + ins, z0 + 0.0024), above(th1 - ins, z0 + 0.0024),
            above(th1 - ins, z1 - 0.0062)]
    edge = [p for p in resample(edge, 0.001)
            if not in_tear(math.atan2(p.x, -(p.y - TC.y)), p.z, 0.004)[0]]
    tL.running(ps, edge, 0.0028, 0.0018, 0.0005, hint=V((0, -1, 0)))
    tL.running(ps, [above(th0 + ins, z1 - 0.0036), above(th1 - ins, z1 - 0.0036)], 0.0028, 0.0018, 0.0005,
               hint=V((0, -1, 0)))
    # bib top-stitching, back waistband, centre front seam
    thb, dth = info["thb"], info["dth"]
    ths = thb - dth * 0.5 - 0.0036 / R_ARC
    bib = [above(-ths, WAIST + 0.004), above(-ths, BIB_TOP - 0.0036)] + \
          [above(-ths + 2 * ths * k / 24, BIB_TOP - 0.0036) for k in range(1, 24)] + \
          [above(ths, BIB_TOP - 0.0036), above(ths, WAIST + 0.004)]
    bib = [p for p in resample(bib, 0.001) if not in_tear(math.atan2(p.x, -(p.y - TC.y)), p.z, 0.004)[0]]
    tL.running(shs, bib, 0.003, 0.002, 0.0005)
    back = [above(ths + 0.1 + (2 * math.pi - 2 * ths - 0.2) * k / 80, WAIST - 0.0036) for k in range(81)]
    tL.running(shs, resample(back, 0.001), 0.003, 0.002, 0.0005)
    tL.running(shs, [above(0.03, z) for z in (0.128, 0.11, 0.095, 0.083)], 0.003, 0.002, 0.0005)
    # tear: stuffing bursting out, a ring of hasty dark stitches
    tth, tz, tu, tv = TEAR
    base, bn = hit(tth, tz)
    tx, ty = frame_t(bn)
    puffs = []
    for k in range(10):
        a = 2 * math.pi * k / 9 + RNG.uniform(-0.3, 0.3)
        rr = RNG.uniform(0.0068, 0.0092) if k else 0.0
        r = RNG.uniform(0.0044, 0.0056)
        c = base + tx * math.cos(a) * rr + ty * math.sin(a) * rr * 0.85 + bn * RNG.uniform(0.0022, 0.0052)
        puffs.append(kit.quad_sphere(f"Puff{k}", r, 2, loc=c, parent=root))
    stuff = kit.join(puffs, "Stuffing")
    kit.remesh(stuff, 0.0005)
    sc = kit.Sculpt(stuff)
    sc.noise(700, 0.0004, seed=2)
    sc.smooth(1, 0.3)
    sc.done()
    kit.shade_smooth(stuff)
    kit.assign(stuff, M["stuff"])
    for k in range(13):
        phi = 2 * math.pi * (k + 0.3) / 13
        r = tear_r(phi)
        u, v = math.cos(phi), math.sin(phi)
        ln = RNG.uniform(0.0034, 0.0052)
        pa = hit(tth + u * (r * tu + ln) / R_ARC, tz + v * (r * tv + ln))
        pb = hit(tth + u * (r * tu - 0.0014) / R_ARC, tz + v * (r * tv - 0.0014))
        a, na = shs.near(pa[0] + pa[1] * 0.01)
        b = pb[0] + pb[1] * (SHELL_T * 0.9)
        tD.stitch(a, na, b, pb[1], 0.00068, arch=1.4)
    # patched hip
    ls = Surf(shell)
    loc, n = hit(-MIR * math.radians(44), 0.106)
    loc, n = ls.near(loc + n * 0.01)
    lp = Patch("LegPatch", ls, loc, n, 0.0165, 0.016, M["patch"], rot=MIR * 9, thick=0.0016, power=7, jag=0.03,
               seed=8, parent=root)
    lp.whip(tD, 0.0048, 0.0022, 0.0017, 0.00058)
    # a sewn-in toy tag on the back waistband
    tth_ = math.pi - MIR * 0.55
    base, bn = hit(tth_, WAIST - 0.004)
    tx, ty = frame_t(bn)
    bm = bmesh.new()
    rows = []
    for j in range(9):
        t = j / 8
        fold = 0.004 * math.sin(math.pi * t) + 0.0012
        c0 = base + bn * (SHELL_T + fold) - ty * (0.0165 * t) + tx * 0.0012 * math.sin(t * 5)
        rows.append([bm.verts.new(c0 + tx * u) for u in (-0.0068, -0.0023, 0.0023, 0.0068)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(3):
            bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
    tag = kit.mesh_obj("Tag", bm, root)
    sol = tag.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.0006
    sub = tag.modifiers.new("Sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    kit.apply_modifiers(tag)
    kit.shade_smooth(tag)
    kit.assign(tag, M["tag"])
    return pk, stuff


# ---------------------------------------------------------------- build

def build():
    make_mats()
    root = kit.empty("ZOMBIE")
    hp = kit.empty("HeadPivot", parent=root)
    tD = Thread("ThreadDark", M["thread_d"])
    tL = Thread("ThreadLight", M["thread_l"])
    tDb = Thread("ThreadDarkBody", M["thread_d"])
    tLb = Thread("ThreadLightBody", M["thread_l"])
    head, main, side = build_head(hp)
    ears = [build_ear(hp, head, 1), build_ear(hp, head, -1)]
    head_details(hp, head, main, side, tD, tL)
    torso = build_torso(root)
    shell, info = build_overalls(root, torso)
    legs = build_legs(root)
    cuffs = build_cuffs(root)
    feet = build_feet(root, tDb)
    arms = [build_arm(root, 1, 0.004, tDb), build_arm(root, -1, -0.004, tDb)]
    straps = build_straps(root, torso, tDb)
    pocket, stuff = overall_details(root, torso, shell, info, legs, tLb, tDb)
    for th, par in ((tD, hp), (tL, hp), (tDb, root), (tLb, root)):
        th.obj(par)
    for ob in [head] + feet + ears:
        md = ob.modifiers.new("Sub", "SUBSURF")
        md.levels = md.render_levels = 1
    # felt fibres (a lighter tip colour frosts the surface like real felt)
    O = bpy.data.objects
    face = [O[n] for n in ("EyeButton", "EyePatch", "Mouth", "Tooth.0", "Tooth.1", "CheekPatch")]
    btns = [O["StrapButton.L"], O["StrapButton.R"]]
    fz = [(head, "mint", 1.0e6, face), (torso, "mint", 6e5, [shell] + straps + btns),
          (shell, "lav", 1.0e6, [pocket, stuff] + straps + btns), (legs, "lav", 1.0e6, [O["LegPatch"]] + cuffs),
          (pocket, "lav", 1.0e6, [stuff]), (stuff, "stuff", 1.6e6, [])]
    fz += [(o, "mint", 1.0e6, []) for o in feet + arms + ears]
    fz += [(o, "lav", 1.0e6, btns) for o in straps]
    fz += [(o, "cuff", 1.0e6, []) for o in cuffs]
    fz += [(O[nm], key, 1.0e6, []) for nm, key in
           (("EyePatch", "cream"), ("CheekPatch", "cheek"), ("LegPatch", "patch"), ("Mouth", "mouth"),
            ("Tooth.0", "cream"), ("Tooth.1", "cream"))]
    for k, (ob, key, dens, avoid) in enumerate(fz):
        ln = 0.0017 if key == "stuff" else 0.0036
        if ob.name.startswith(("Tooth", "Mouth", "EyePatch", "CheekPatch", "LegPatch")):
            ln, dens = 0.0016, dens * 0.6
        tilt = 0.9 if key == "stuff" else 0.55
        fibres(ob, M["fz_" + key], dens * 1.6, ln, 0.00007, tilt, seed=k, avoid=avoid)
    hp.matrix_basis = Matrix.Translation(NECK) @ Euler((math.radians(3), math.radians(-3.5), 0)).to_matrix().to_4x4() \
        @ Matrix.Translation(-NECK)
    bpy.context.view_layer.update()
    if "--debug" in sys.argv:
        dg = bpy.context.evaluated_depsgraph_get()
        nc = 0
        for ob in kit.descendants(root):
            if ob.type == "MESH":
                try:
                    gs = ob.evaluated_get(dg).evaluated_geometry()
                    nc += len(gs.curves.curves) if gs.curves else 0
                except Exception:
                    pass
                d = ob.dimensions
                print(f"[plush] dims {ob.name:18s} {d.x*1000:6.1f} {d.y*1000:6.1f} {d.z*1000:6.1f} mm")
        print(f"[plush] fibre curves: {nc}")
        gs = bpy.data.objects["Head"].evaluated_get(dg).evaluated_geometry()
        cv = gs.curves
        pts = cv.points
        import statistics
        ds = [(pts[i].position - HC).length for i in range(0, min(len(pts), 4000))]
        print("[plush] fibre pt dist from head centre: min %.4f max %.4f med %.4f" % (min(ds), max(ds), statistics.median(ds)))
        print("[plush] first curve pts", [tuple(round(x, 4) for x in pts[i].position) for i in range(4)])
        print("[plush] attrs", [a.name for a in cv.attributes])
        try:
            print("[plush] radius", [cv.attributes["radius"].data[i].value for i in range(4)])
        except Exception as e:
            print("[plush] radius err", e)
        print("[plush] mats", [m.name if m else None for m in cv.materials])
    return root


def frame(cam, root, fill=0.84, elev=0.1):
    """Frame on real vertices (the kit uses bounding-box corners, which over-estimate the
    reach of diagonal arms): height fills `fill` of the frame, and the widest reach still
    fits the frame width at every turntable angle, perspective included."""
    pts = [o.matrix_world @ v.co for o in kit.descendants(root) if o.type == "MESH" for v in o.data.vertices]
    zmin, zmax = min(p.z for p in pts), max(p.z for p in pts)
    reach = max(math.hypot(p.x, p.y) for p in pts)
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    tan_v = (cam.data.sensor_width / 2) / cam.data.lens
    tan_h = tan_v * aspect
    h = zmax - zmin
    dist = max(h / fill / 2 / tan_v, reach / (tan_h * 0.94), 0.707 * reach * (1 + 1 / (tan_h * 0.94)))
    tgt = V((0, 0, zmin + h * 0.5))
    cam.location = tgt + V((0, -dist * math.cos(elev), dist * math.sin(elev)))
    kit._aim(cam, tgt)
    print(f"[plush] frame: h {h:.3f} reach {reach:.3f} dist {dist:.3f}")


def stage(root):
    sc = kit.render_setup("CYCLES", (900, 1200), 128 if FINAL else 48, view="AgX", look="AgX - Punchy", exposure=0.7)
    cy = sc.cycles
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 3, 3
    cy.transmission_bounces, cy.transparent_max_bounces = 2, 8
    cy.adaptive_threshold = 0.02
    sc.render.use_persistent_data = True
    kit.world(lin(250, 228, 214), 0.25)
    kit.backdrop(M["peach"], width=5, depth=3.5, height=3, radius=0.7, z=0.0, y_back=1.0)
    kit.area("Key", (-1.0, -1.35, 1.25), (0, 0, 0.24), 90, 1.3, color=(1.0, 0.96, 0.92))
    kit.area("Fill", (1.5, -1.0, 0.55), (0, 0, 0.2), 25, 1.6, color=(0.96, 0.97, 1.0))
    kit.area("Rim", (0.9, 1.1, 1.1), (0, 0, 0.3), 55, 0.6, color=(1.0, 0.95, 0.9))
    kit.area("Wash", (0.0, 0.1, 1.5), (0.0, 1.0, 0.35), 45, 1.6, color=(1.0, 0.93, 0.86))
    cam = kit.camera(target_h=0.2, dist=1.2, lens=85)
    frame(cam, root, fill=0.84, elev=0.1)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (cam.location - V((0, 0, HC.z))).length - 0.085
    cam.data.dof.aperture_fstop = 3.2
    cam.data.dof.aperture_blades = 7
    if "--closeup" in sys.argv:          # debug: judge felt, fibres and stitches up close
        cam.data.lens *= 3.2
        kit._aim(cam, V((0.0, -0.06, HC.z - 0.03)))
        cam.data.dof.use_dof = False


kit.run("plush", build, stage, meta={"height_m": 0.405, "technique": "cloth pressure, skin, sculpt, BVH stitches, hair-curve fibres"})
