# The Rotted (rot): gritty photoreal creature sculpt of an undead 1940s airfield mechanic.
#   node art/zombies/blend.mjs z_rot.py --preview [--views three_quarter,front,side,back]
#   extra preview views: face, face_front, face_side, hand, feet;  --fast skips sims, hair and fleece.
# Pipeline: kit.skeleton -> Skin modifier -> voxel remesh -> sculpt by code (bust + face, hands, bare
# foot) with boolean eye sockets and mouth; baked cloth drape (jacket over a body collider), baked
# soft-body cloth flaps, hair curves (scalp, frayed threads), particle shearling; Cycles + AgX.
import os, sys, math, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
from mathutils import Vector as V, Matrix, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPTS = kit.cli()
FINAL = OPTS["mode"] == "final"
FAST = "--fast" in ARGV
T0 = time.time()
STATE = {}
kit.VIEWS.update({"face": -28, "face_front": 0, "face_side": -90, "hand": -35, "feet": -35})


def log(*a):
    print("[rot] %6.1fs" % (time.time() - T0), *a, flush=True)


# =========================================================================== small helpers

def lerp(a, b, t):
    return a + (b - a) * t


def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def fbm(p, scale=1.0, octaves=3, seed=0):
    q = V(p) * scale + V((seed * 17.3, seed * 5.1, seed * 11.7))
    return noise.fractal(q, 0.5, 2.0, octaves, noise_basis="PERLIN_ORIGINAL")


def frame(x, y, z):
    return Matrix((x, y, z)).transposed()


def ell(name, c, r, M=None, level=3, parent=None, fn=None):
    """Quad-sphere ellipsoid with radii r, rotated by the 3x3 M, centred at c."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2 ** level - 1, use_grid_fill=True)
    for v in bm.verts:
        n = v.co.normalized()
        p = V((n.x * r[0], n.y * r[1], n.z * r[2]))
        if fn:
            p = fn(p)
        if M is not None:
            p = M @ p
        v.co = p + V(c)
    return kit.mesh_obj(name, bm, parent)


def section_tube(name, pts, outs, ro, rb, segs=10, parent=None, cap=True):
    """Tube with elliptical sections: radius ro along outs[i], rb across."""
    bm = bmesh.new()
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        o = outs[i] - t * outs[i].dot(t)
        o.normalize()
        b = t.cross(o).normalized()
        a1 = ro[i] if isinstance(ro, (list, tuple)) else ro
        a2 = rb[i] if isinstance(rb, (list, tuple)) else rb
        rings.append([bm.verts.new(p + o * math.cos(2 * math.pi * k / segs) * a1 + b * math.sin(2 * math.pi * k / segs) * a2)
                      for k in range(segs)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return kit.mesh_obj(name, bm, parent)


def ribbon(name, pts, sides, width, parent=None):
    bm = bmesh.new()
    prev = None
    for p, s in zip(pts, sides):
        a, b = bm.verts.new(p - s * width / 2), bm.verts.new(p + s * width / 2)
        if prev:
            bm.faces.new((prev[0], prev[1], b, a))
        prev = (a, b)
    return kit.mesh_obj(name, bm, parent)


def resample(pts, step):
    pts = [V(p) for p in pts]
    out = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int((b - a).length / step))
        out += [a.lerp(b, k / n) for k in range(n)]
    out.append(pts[-1])
    return out


def cut_faces(ob, pred):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if pred(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def drop_islands(ob, min_faces=40):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen, kill = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(comp) < min_faces:
            kill += comp
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def boundary_verts(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    out = [(v.co.copy(), v.normal.copy()) for v in bm.verts if v.is_boundary]
    bm.free()
    return out


def boolean_diff(ob, cutters):
    for c in cutters:
        m = ob.modifiers.new("Bool", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = c
        for sv in ("MANIFOLD", "EXACT"):
            try:
                m.solver = sv
                break
            except TypeError:
                continue
    kit.apply_modifiers(ob)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)


def solidify(ob, t, offset=-1.0, mat_offset=0, rim_offset=0):
    m = ob.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = t
    m.offset = offset
    m.use_even_offset = False
    try:
        m.thickness_clamp = 0.5
    except AttributeError:
        pass
    m.material_offset = mat_offset
    m.material_offset_rim = rim_offset
    return m


def subsurf_live(ob, levels=1):
    m = ob.modifiers.new("Subdiv", "SUBSURF")
    m.levels = m.render_levels = levels
    return m


class Snapper:
    def __init__(self, objs):
        self.trees = []
        for o in objs:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            self.trees.append(BVHTree.FromBMesh(bm))
            bm.free()

    def near(self, p):
        best = None
        for t in self.trees:
            loc, nrm, i, d = t.find_nearest(V(p))
            if loc is not None and (best is None or d < best[2]):
                best = (loc, nrm, d)
        return best

    def ray(self, o, d):
        best = None
        for t in self.trees:
            loc, nrm, i, dist = t.ray_cast(V(o), V(d).normalized())
            if loc is not None and (best is None or dist < best[2]):
                best = (loc, nrm, dist)
        return best


def skin(name, joints, bones, parent, rs=1.2, **kw):
    """kit.skin_body with radii scaled up to make up for the subdivision shrink."""
    jj = {k: [co.copy(), (r[0] * rs, r[1] * rs)] for k, (co, r) in joints.items()}
    return kit.skin_body(name, jj, bones, parent=parent, **kw)


def copy_obj(o, name):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    for m in list(c.modifiers):
        c.modifiers.remove(m)
    kit.link(c, o.parent)
    return c


def paint_mask(ob, fn, name="mask"):
    """Per-vertex RGBA attribute from fn(co, normal) -> (r, g, b, a)."""
    me = ob.data
    n = len(me.vertices)
    vals = []
    for v in me.vertices:
        vals.extend(fn(v.co, v.normal))
    at = me.color_attributes.get(name) or me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    at.data.foreach_set("color", vals)
    return at


def hair_object(name, strands, r_root, r_tip, mat, parent):
    """Hair curves object from a list of point lists (falls back to legacy curves)."""
    try:
        hc = bpy.data.hair_curves.new(name)
        hc.add_curves([len(s) for s in strands])
        pos = [c for s in strands for p in s for c in p]
        hc.attributes["position"].data.foreach_set("vector", pos)
        rad = hc.attributes.get("radius") or hc.attributes.new("radius", "FLOAT", "POINT")
        rr = []
        for s in strands:
            k = len(s)
            rr += [lerp(r_root, r_tip, i / max(1, k - 1)) for i in range(k)]
        rad.data.foreach_set("value", rr)
        hc.materials.append(mat)
        ob = bpy.data.objects.new(name, hc)
    except Exception as e:  # legacy poly curves
        log("hair curves fallback:", e)
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = r_root
        cu.bevel_resolution = 0
        for s in strands:
            sp = cu.splines.new("POLY")
            sp.points.add(len(s) - 1)
            for i, p in enumerate(s):
                sp.points[i].co = (p.x, p.y, p.z, 1.0)
                sp.points[i].radius = lerp(1.0, r_tip / r_root, i / max(1, len(s) - 1))
        cu.materials.append(mat)
        ob = bpy.data.objects.new(name, cu)
    kit.link(ob, parent)
    return ob


def my_drape(ob, colliders, frames=24, pin=None, stiffness=12.0, thickness=0.006, quality=5, mass=0.3, max_move=0.07):
    """Cloth drape baked and applied (kit.drape_cloth with a lower step quality)."""
    for c in colliders:
        kit.collider(c, thickness)
        c.collision.cloth_friction = 8.0
    m = ob.modifiers.new("Cloth", "CLOTH")
    s = m.settings
    s.quality = quality
    s.mass = mass
    s.tension_stiffness = s.compression_stiffness = stiffness
    s.shear_stiffness = stiffness * 0.5
    s.bending_stiffness = 1.5
    s.air_damping = 2.0
    if pin:
        s.vertex_group_mass = pin
        s.pin_stiffness = 2.0
    cs = m.collision_settings
    cs.distance_min = thickness
    cs.collision_quality = 3
    cs.use_self_collision = False
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    before = [v.co.copy() for v in ob.data.vertices]
    kit._step(frames)
    kit.apply_modifiers(ob)
    # sanitize: vertices the solver flung away (started inside the collider) go back to rest
    bad = 0
    for v, b in zip(ob.data.vertices, before):
        d = v.co - b
        if d.length > max_move:
            v.co = b + d.normalized() * min(d.length, max_move * 0.3)
            bad += 1
    if bad:
        log("drape: reset", bad, "flung vertices")
    for c in colliders:
        for mm in list(c.modifiers):
            if mm.type == "COLLISION":
                c.modifiers.remove(mm)
    bpy.context.scene.frame_set(1)
    return ob


# =========================================================================== skeleton

def skeleton():
    P = dict(height=1.78, heads=8.0, hunch=0.75, head_tilt=0.0, arms_up=0.1, arm_spread=0.12,
             left_drag=0.22, knee=0.22, arm=0.415, leg=0.49, shoulder=0.162, hip=0.094, fingers=0,
             r=dict(pelvis=0.108, belly=0.09, chest=0.118, neck=0.044, shoulder=0.047, elbow=0.034,
                    wrist=0.024, hip=0.07, knee=0.047, ankle=0.034, toe=0.03, palm=0.035))
    J, B = kit.skeleton(P)
    ch = J["chest"][0]
    J["neck"][0] = V((0.0, ch.y - 0.03, J["shoulder.L"][0].z + 0.045))
    # a real stoop: rotate the upper body forward about the pelvis, more toward the neck (kyphosis)
    pel = J["pelvis"][0].copy()
    def bend(p, ang):
        return pel + Matrix.Rotation(ang, 3, "X") @ (p - pel)
    for k, ang in (("belly", 0.08), ("chest", 0.15), ("neck", 0.23)):
        J[k][0] = bend(J[k][0], ang)
    for sd in "LR":
        sh0 = J[f"shoulder.{sd}"][0].copy()
        sh1 = bend(sh0, 0.2)
        d = sh1 - sh0
        J[f"shoulder.{sd}"][0] = sh1
        for k in ("elbow", "wrist", "palm"):
            J[f"{k}.{sd}"][0] = J[f"{k}.{sd}"][0] + d
    for k in ("shoulder.R", "elbow.R", "wrist.R", "palm.R"):
        J[k][0] = J[k][0] + V((0, 0.0, -0.02))
    return J, B


def spine_y(J, z):
    pts = [(J["pelvis"][0].z, J["pelvis"][0].y), (J["belly"][0].z, J["belly"][0].y),
           (J["chest"][0].z, J["chest"][0].y), (J["neck"][0].z, J["neck"][0].y)]
    if z <= pts[0][0]:
        return pts[0][1]
    for (z0, y0), (z1, y1) in zip(pts, pts[1:]):
        if z <= z1:
            return lerp(y0, y1, (z - z0) / (z1 - z0))
    return pts[-1][1]


def flatten_torso(ob, J, k=0.8):
    """Squash the round skin-modifier torso front-to-back (ribcage is wider than deep)."""
    z0, z1 = J["pelvis"][0].z - 0.12, J["pelvis"][0].z
    z2, z3 = J["shoulder.L"][0].z, J["neck"][0].z + 0.03
    for v in ob.data.vertices:
        c = v.co
        w = sstep(z0, z1, c.z) * (1 - sstep(z2, z3, c.z)) * (1 - sstep(0.13, 0.2, abs(c.x)))
        if w <= 0:
            continue
        sy = spine_y(J, c.z)
        c.y = sy + (c.y - sy) * (1 + (k - 1) * w)
    ob.data.update()


def head_matrix(J):
    nk = J["neck"][0]
    R = Matrix.Rotation(0.12, 3, "Z") @ Matrix.Rotation(0.22, 3, "Y") @ Matrix.Rotation(0.07, 3, "X")
    hc = nk + V((0.024, -0.1, 0.152))
    return Matrix.Translation(hc) @ R.to_4x4()


# =========================================================================== body + bust (head)

EYE = V((0.031, -0.079, 0.0))
MOUTH_C = V((0.0, -0.083, -0.067))
MOUTH_R = (0.023, 0.03, 0.0105)
GASH = [(-0.036, -0.078, 0.058), (-0.014, -0.083, 0.068), (0.004, -0.082, 0.079), (0.02, -0.078, 0.09)]


def build_body(J, B, root):
    body = skin("Body", J, B, root, 1.22, subdiv=1,
                         drop=("head", "wrist.L", "wrist.R", "palm.L", "palm.R", "ankle.L", "toe.L", "toe.R"),
                         segments={("hip.L", "knee.L"): 1, ("hip.R", "knee.R"): 1, ("knee.R", "ankle.R"): 1,
                                   ("shoulder.L", "elbow.L"): 1, ("shoulder.R", "elbow.R"): 1})
    flatten_torso(body, J, 0.78)
    kit.remesh(body, 0.007)
    s = kit.Sculpt(body)
    for sx, sd in ((1, "L"), (-1, "R")):
        kn = J[f"knee.{sd}"][0]
        s.inflate(kn + V((0, -0.045, 0.01)), 0.03, 0.006)            # kneecap
    s.noise(scale=18, amount=0.0015, seed=2)
    s.done()
    return body


def head_parts(Mh, root, neck_can):
    R3 = Mh.to_3x3()
    out = []

    def E(c, r, rot=None, lvl=3):
        out.append(ell("hp", Mh @ V(c), r, R3 @ rot if rot is not None else R3, lvl, root))

    def T(pts, radii, segs=12):
        out.append(kit.tube("hp", [Mh @ V(p) for p in pts], radii, segs, parent=root))

    E((0, 0.022, 0.022), (0.07, 0.094, 0.081), lvl=4)             # cranium
    E((0, -0.005, -0.012), (0.06, 0.083, 0.098), lvl=4)           # head mass
    E((0, -0.063, 0.0), (0.051, 0.02, 0.02))                      # orbits
    E((0, -0.071, 0.022), (0.054, 0.016, 0.012))                  # brow ridge
    E((0, -0.058, -0.035), (0.04, 0.036, 0.046))                  # maxilla
    E((0, -0.042, -0.076), (0.043, 0.042, 0.029))                 # lower face
    E((0, -0.075, -0.101), (0.017, 0.013, 0.013))                 # chin
    E((0, 0.0, -0.045), (0.05, 0.055, 0.045))                     # skull base
    for sx in (1, -1):
        E((sx * 0.047, -0.056, -0.013), (0.016, 0.018, 0.0105))  # cheekbone
        T([(sx * 0.05, -0.05, -0.012), (sx * 0.066, 0.0, -0.014)], [0.008, 0.007])
        E((sx * 0.0115, -0.094, -0.044), (0.0075, 0.008, 0.0065))  # nostril wing
        E((sx * 0.052, 0.032, -0.036), (0.012, 0.012, 0.014))    # mastoid
    T([(-0.058, 0.008, -0.028), (-0.057, -0.002, -0.074), (-0.036, -0.058, -0.098), (0, -0.078, -0.106),
       (0.036, -0.058, -0.098), (0.057, -0.002, -0.074), (0.058, 0.008, -0.028)],
      [0.011, 0.013, 0.012, 0.013, 0.012, 0.013, 0.011])            # mandible
    T([(0, -0.084, 0.006), (0, -0.096, -0.018), (0, -0.104, -0.034), (0, -0.101, -0.043)], [0.0055, 0.0065, 0.0078, 0.006])  # nose, collapsed tip
    T([(0, -0.1, -0.04), (0, -0.097, -0.048)], [0.004, 0.0035])  # columella
    T([(0, 0.0, -0.045), (0, 0.022, -0.1), tuple(neck_can)], [0.041, 0.041, 0.047], 16)       # neck
    return out


def head_cutters(Mh, root):
    R3 = Mh.to_3x3()
    cs = []
    for sx in (1, -1):
        cs.append(ell("cut", Mh @ V((sx * EYE.x, EYE.y, EYE.z)), (0.0138, 0.02, 0.0074),
                      R3 @ Matrix.Rotation(sx * 0.12, 3, "Y"), 3, root))
    cs.append(ell("cut", Mh @ MOUTH_C, MOUTH_R, R3 @ Matrix.Rotation(0.07, 3, "Y"), 3, root))
    return cs


def build_bust(J, Mh, root):
    bj = {}
    for k, extra in (("belly", 0.003), ("chest", 0.003), ("neck", 0.0025), ("shoulder.L", 0.0025), ("shoulder.R", 0.0025)):
        co, r = J[k]
        bj[k] = [co.copy(), (r[0] + extra, r[1] + extra)]
    bones = [("belly", "chest"), ("chest", "neck"), ("chest", "shoulder.L"), ("chest", "shoulder.R")]
    sk = skin("Bust", bj, bones, root, 1.22, subdiv=1)
    flatten_torso(sk, J, 0.78)
    neck_can = Mh.inverted() @ (J["neck"][0] + V((0, 0.01, -0.03)))
    ob = kit.join([sk] + head_parts(Mh, root, neck_can), "Bust")
    kit.remesh(ob, 0.0022)
    hc = Mh.translation
    Mi_ = Mh.inverted()

    def blend_w(c):
        q = Mi_ @ c
        w = 1.0 - sstep(0.13, 0.2, (c - hc).length)
        if q.y < -0.078 and abs(q.x) < 0.024 and -0.055 < q.z < 0.012:
            w *= 0.25                                   # keep the nose crisp
        return w
    kit.vgroup(ob, "blend", blend_w)
    sm = ob.modifiers.new("Blend", "SMOOTH")
    sm.factor, sm.iterations, sm.vertex_group = 0.5, 7, "blend"
    kit.apply_modifiers(ob)
    boolean_diff(ob, head_cutters(Mh, root))
    kit.remesh(ob, 0.0022)
    log("bust remeshed", len(ob.data.vertices), "verts")
    sculpt_bust(ob, Mh, J)
    return ob


def sculpt_bust(ob, Mh, J):
    R3 = Mh.to_3x3()
    C = lambda x, y, z: Mh @ V((x, y, z))
    D = lambda x, y, z: R3 @ V((x, y, z))
    hc = Mh.translation.copy()
    s = kit.Sculpt(ob)
    s.smooth(2, 0.5, c=hc, r=0.2)
    s.refresh()
    tree = [BVHTree.FromBMesh(s.bm)]

    def re():
        s.refresh()
        tree[0] = BVHTree.FromBMesh(s.bm)

    def sn(p, off=0.0):
        loc, nrm, i, d = tree[0].find_nearest(V(p))
        return (loc + nrm * off) if loc is not None else V(p)

    def sp(pts, step=0.0025):
        return [sn(p) for p in resample(pts, step)]

    def crease(pts, r, d):
        s.crease_stroke(sp(pts), r, d)

    def ridge(pts, r, a):
        s.inflate_stroke(sp(pts), r, a)

    # --- big planes of the face: sunken orbits, cheeks and temples, hard bone
    for sx in (1, -1):
        ex = sx * EYE.x
        s.inflate(C(ex, -0.083, 0.002), 0.026, -0.005)
        s.inflate(C(sx * 0.03, -0.092, 0.021), 0.016, 0.0022)
        s.inflate(C(sx * 0.05, -0.072, -0.013), 0.012, 0.0012)
        s.inflate(C(sx * 0.044, -0.068, -0.05), 0.028, -0.011)
        s.inflate(C(sx * 0.05, -0.05, -0.062), 0.02, -0.006)
        s.inflate(C(sx * 0.066, -0.035, 0.028), 0.024, -0.006)
        s.inflate(C(sx * 0.03, -0.084, -0.017), 0.009, 0.0007)
    # break the brow shelf into two arcs with a glabella dip
    s.inflate(C(0, -0.092, 0.014), 0.013, -0.0045)
    for sx in (1, -1):
        s.grab(C(sx * 0.047, -0.08, 0.02), 0.016, D(0, 0.002, -0.004))
    s.smooth(4, 0.5, c=C(0, -0.085, 0.018), r=0.05)
    re()
    # --- eyelids, folds, wrinkles
    for sx in (1, -1):
        ex = sx * EYE.x
        crease([C(ex - sx * 0.012, -0.086, -0.019), C(ex + sx * 0.004, -0.086, -0.024), C(ex + sx * 0.016, -0.08, -0.022)], 0.0035, 0.0014)
        ridge([C(ex - sx * 0.014, -0.09, 0.006), C(ex, -0.093, 0.0115), C(ex + sx * 0.015, -0.088, 0.004)], 0.0035, 0.0012)
        crease([C(ex - sx * 0.013, -0.09, 0.014), C(ex, -0.092, 0.019), C(ex + sx * 0.016, -0.086, 0.012)], 0.0025, 0.0012)
        ridge([C(ex - sx * 0.012, -0.088, -0.009), C(ex, -0.089, -0.0115), C(ex + sx * 0.014, -0.085, -0.007)], 0.003, 0.0009)
        for k in range(3):
            a = -0.5 + k * 0.45
            p0 = V((ex + sx * 0.018, -0.082, 0.0))
            crease([C(*p0), C(p0.x + sx * 0.012 * math.cos(a), -0.078, p0.z + 0.012 * math.sin(a))], 0.0018, 0.0007)
        crease([C(sx * 0.016, -0.1, -0.042), C(sx * 0.025, -0.096, -0.056), C(sx * 0.031, -0.089, -0.074)], 0.0055, 0.0034)
        ridge([C(sx * 0.022, -0.098, -0.04), C(sx * 0.031, -0.093, -0.054), C(sx * 0.037, -0.086, -0.07)], 0.006, 0.0016)
        crease([C(sx * 0.006, -0.1, -0.036), C(sx * 0.016, -0.1, -0.04), C(sx * 0.019, -0.096, -0.048), C(sx * 0.012, -0.099, -0.051)], 0.0022, 0.0012)
        s.inflate(C(sx * 0.025, -0.089, -0.068), 0.005, -0.0015)
        ridge([C(sx * 0.05, -0.02, -0.086), C(sx * 0.03, -0.068, -0.1), C(sx * 0.01, -0.085, -0.108)], 0.006, 0.0015)
        s.grab(C(sx * 0.074, 0.012, -0.006), 0.011, D(-sx * 0.004, 0.0, 0.0))
        s.grab(C(sx * 0.0085, -0.1, -0.05), 0.0045, D(0, 0.005, 0.004))
        crease([C(sx * 0.007, -0.09, 0.02), C(sx * 0.009, -0.088, 0.036)], 0.002, 0.0009)
    # lips: thin, receding, cracked
    ridge([C(-0.023, -0.09, -0.06), C(-0.01, -0.097, -0.0575), C(0, -0.099, -0.058), C(0.01, -0.097, -0.0575), C(0.023, -0.09, -0.06)], 0.0035, 0.0012)
    ridge([C(-0.021, -0.088, -0.075), C(0, -0.095, -0.0775), C(0.021, -0.088, -0.075)], 0.004, 0.0013)
    crease([C(0, -0.106, -0.047), C(0, -0.1, -0.055)], 0.003, 0.001)
    crease([C(-0.016, -0.09, -0.087), C(0, -0.094, -0.089), C(0.016, -0.09, -0.087)], 0.004, 0.0018)
    rng = random.Random(5)
    for k in range(14):
        x = -0.018 + k * 0.0028 + rng.uniform(-0.001, 0.001)
        zc = -0.058 if k % 2 else -0.0775
        crease([C(x, -0.1, zc + 0.003), C(x + rng.uniform(-0.001, 0.001), -0.1, zc - 0.003)], 0.0011, 0.0007)
    # forehead wrinkles and the gash
    for k, z in enumerate((0.04, 0.051, 0.062, 0.073)):
        w_ = 0.004 * math.sin(k * 2.1)
        crease([C(-0.045, -0.073, z - 0.003), C(-0.024, -0.08, z + 0.002 + w_), C(-0.004, -0.083, z - 0.001), C(0.018, -0.082, z + 0.002 - w_), C(0.044, -0.074, z - 0.004)], 0.0032, 0.0014)
    # nose: bridge, nasal hump, deep nostrils, rotted collapsed tip
    ridge([C(0, -0.088, 0.004), C(0, -0.096, -0.014), C(0, -0.101, -0.028)], 0.0042, 0.0014)
    s.inflate(C(0, -0.095, -0.012), 0.006, 0.0012)
    s.grab(C(0, -0.104, -0.037), 0.007, D(0, 0.003, 0.0012))
    s.inflate(C(0.003, -0.103, -0.034), 0.0042, -0.0016)
    for sx in (1, -1):
        s.grab(C(sx * 0.0075, -0.099, -0.049), 0.0042, D(-sx * 0.001, 0.007, 0.005))
    # sagging lower lip (shows the crooked teeth), receding upper lip
    s.grab(C(0, -0.094, -0.079), 0.017, D(0, -0.0015, -0.0055))
    for sx in (1, -1):
        s.grab(C(sx * 0.017, -0.09, -0.078), 0.008, D(0, 0, -0.0022))
    s.grab(C(0, -0.097, -0.058), 0.012, D(0, 0.001, 0.0022))
    # neck creases
    for k in range(3):
        crease([C(-0.03, -0.035, -0.115 - k * 0.018), C(0, -0.045, -0.12 - k * 0.018), C(0.03, -0.035, -0.115 - k * 0.018)], 0.0028, 0.0012)
    crease([C(*p) for p in GASH], 0.0032, 0.004)
    ridge([C(p[0] - 0.002, p[1], p[2] + 0.0045) for p in GASH], 0.003, 0.0009)
    ridge([C(p[0] + 0.002, p[1], p[2] - 0.0045) for p in GASH], 0.003, 0.0009)
    re()
    STATE["gash"] = sp([C(*p) for p in GASH], 0.002)

    # --- neck: tendons, larynx; clavicles, sternum and ribs under thin skin
    nk = J["neck"][0]
    notch = sn(nk + V((0, -0.085, -0.015)))
    STATE["notch"] = notch
    for sx, sd in ((1, "L"), (-1, "R")):
        mast = C(sx * 0.052, 0.03, -0.045)
        ridge([mast, mast.lerp(notch + V((sx * 0.012, 0, 0)), 0.5), notch + V((sx * 0.013, 0.0, 0.004))], 0.009, 0.003)
        acro = sn(J[f"shoulder.{sd}"][0] + V((0, -0.01, 0.06)))
        clav = [notch + V((sx * 0.018, 0, -0.004)), notch.lerp(acro, 0.5) + V((0, -0.01, 0.01)), acro]
        ridge(clav, 0.009, 0.0035)
        crease([p + V((0, 0.01, 0.022)) for p in clav[:2]] + [acro + V((0, 0.02, 0.015))], 0.012, 0.005)
        crease([p + V((0, 0, -0.018)) for p in clav], 0.01, 0.0018)
    s.inflate(sn(C(0, -0.03, -0.125)), 0.011, 0.0035)
    re()
    ridge([notch + V((0, 0, -0.012)), notch + V((0, 0.02, -0.19))], 0.012, 0.0014)
    for i in range(7):
        z = notch.z - 0.045 - i * 0.024
        for sx in (1, -1):
            pts = [V((sx * 0.018, notch.y - 0.02, z)), V((sx * 0.055, notch.y, z - 0.01)),
                   V((sx * 0.095, notch.y + 0.03, z - 0.025)), V((sx * 0.125, notch.y + 0.07, z - 0.04))]
            ridge(pts, 0.006, 0.0012)
            crease([p + V((0, 0, -0.012)) for p in pts], 0.0075, 0.0028)
    re()
    # --- skin: pores, crepey neck, lumpy decay
    s.noise(scale=85, amount=0.0003, octaves=3, c=hc, r=0.35)
    s.noise(scale=30, amount=-0.0007, ridged=True, c=hc + V((0, 0.03, -0.13)), r=0.12, seed=3)
    s.noise(scale=22, amount=0.0012, octaves=2, seed=5)
    s.smooth(1, 0.2)
    s.done()


def eye_rim_y(tree, Mh, sx):
    Mi = Mh.inverted()
    R3 = Mh.to_3x3()
    ys = []
    for ang in range(0, 360, 30):
        a = math.radians(ang)
        x = sx * EYE.x + math.cos(a) * 0.0165
        z = EYE.z + math.sin(a) * 0.0098
        hit = tree.ray_cast(Mh @ V((x, -0.2, z)), R3 @ V((0, 1, 0)))
        if hit[0] is not None:
            ys.append((Mi @ hit[0]).y)
    ys.sort()
    return ys[len(ys) // 2] if ys else EYE.y


def build_face_bits(bust, Mh, root, M):
    R3 = Mh.to_3x3()
    bm = bmesh.new()
    bm.from_mesh(bust.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    eyes = []
    for sx in (1, -1):
        y_rim = eye_rim_y(tree, Mh, sx)
        c = V((sx * EYE.x, y_rim + 0.0006 + 0.0118, EYE.z - 0.0008))
        eb = ell("Eye", (0, 0, 0), (0.0118, 0.0118, 0.0118), None, 4, root)
        gaze = Matrix.Rotation(-0.08, 3, "X") @ Matrix.Rotation(sx * 0.1, 3, "Z")
        eb.matrix_basis = Matrix.Translation(Mh @ c) @ (R3 @ gaze).to_4x4()
        kit.assign(eb, M["eye"])
        eyes.append(eb)
    # teeth: crooked, long in the root (gums receded), one missing, one broken
    rng = random.Random(9)
    parts = []
    def arc_y(x):
        return -0.082 + 38.0 * x * x
    for row, (zg, zt) in enumerate(((-0.0555, -0.0655), (-0.0785, -0.0695))):
        xs = [-0.0195, -0.0138, -0.0082, -0.0027, 0.0028, 0.0083, 0.0139, 0.0196]
        for k, x in enumerate(xs):
            if (row, k) in ((0, 2), (1, 6)):
                continue
            w = 0.0052 if k in (3, 4) else 0.0046
            h = abs(zt - zg) + 0.004 + rng.uniform(-0.0015, 0.0015)
            if (row, k) == (0, 5):
                h *= 0.55
            tangent = V((1.0, 76.0 * x, 0)).normalized()
            outward = V((76.0 * x, -1.0, 0)).normalized()
            up = V((0, 0, 1))
            Mt = frame(tangent, -outward, up) @ Matrix.Rotation(rng.uniform(-0.35, 0.35), 3, "Y") @ \
                Matrix.Rotation(rng.uniform(-0.45, 0.45), 3, "Z") @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 3, "X")
            cz = (zg + zt) / 2 + (0.0 if row == 0 else 0.0)
            ctr = V((x, arc_y(x) + 0.002 + rng.uniform(-0.0008, 0.0008), cz))
            pointy = k in (1, 6)
            sign = -1 if row == 0 else 1

            def shape(p, sign=sign, h=h, pointy=pointy):
                t = (p.z * sign) / (h / 2)  # -1 root .. +1 tip
                f = 1.0 - (0.35 if pointy else 0.08) * max(0.0, t)
                return V((p.x * f, p.y * (1 - 0.25 * max(0.0, t)), p.z))
            parts.append(ell("tooth", Mh @ ctr, (w / 2, 0.0032, h / 2), R3 @ Mt, 2, root, shape))
    teeth = kit.join(parts, "Teeth")
    Mi = Mh.inverted()
    kit.color_attr(teeth, lambda co, n: (lambda c: (min(1.0, max(0.0, (abs(c.z + 0.067) - 0.001) / 0.009)),) * 3 + (1,))(Mi @ co), "rot")
    kit.assign(teeth, M["tooth"])
    gums = []
    for zg in (-0.0548, -0.0792):
        pts = [Mh @ V((x, arc_y(x) + 0.004, zg)) for x in [i * 0.004 - 0.026 for i in range(14)]]
        gums.append(kit.tube("gum", pts, 0.0036, 10, parent=root))
    gums.append(ell("tongue", Mh @ V((0, -0.06, -0.075)), (0.017, 0.024, 0.0065), R3, 3, root))
    gum = kit.join(gums, "Gums")
    kit.assign(gum, M["mouth"])
    return eyes, teeth, gum



def build_ears(Mh, root):
    """Sculpted ears (concha bowl, helix rim, lobe) pushed into the sides of the head."""
    R3 = Mh.to_3x3()
    parts = []
    for sx in (1, -1):
        def shape(p, sx=sx):
            r2 = (p.y / 0.0135) ** 2 + (p.z / 0.025) ** 2
            if p.x * sx > 0:
                bowl = max(0.0, 1 - r2 / 0.6) * (1 - sstep(-0.028, -0.012, -p.z) * 0.0)
                rim = sstep(0.6, 0.85, r2) * (1 - sstep(0.9, 1.0, r2))
                p = V((p.x - sx * (0.003 * bowl - 0.0012 * rim), p.y, p.z))
            return p
        M = R3 @ Matrix.Rotation(-sx * 0.26, 3, "Z") @ Matrix.Rotation(-0.2, 3, "X")
        ear = ell("ear", Mh @ V((sx * 0.067, 0.018, -0.008)), (0.0055, 0.0135, 0.025), M, 4, root, shape)
        sc = kit.Sculpt(ear)
        sc.noise(scale=150, amount=0.0003, seed=71 + sx)
        sc.smooth(1, 0.3)
        bmesh.ops.recalc_face_normals(sc.bm, faces=sc.bm.faces[:])
        sc.done()
        parts.append(ear)
    return parts


def build_shirt(bust, J, Mh, root, M):
    """Collarless work shirt: the chest of the bust, offset out, open at the throat, with folds."""
    hc = Mh.translation.copy()
    nk = J["neck"][0]
    notch = STATE["notch"]
    sh = copy_obj(bust, "Shirt")
    zv = notch.z - 0.14

    def kill(c, n):
        back = sstep(-0.09, 0.02, c.y - spine_y(J, c.z))
        if c.z > lerp(notch.z + 0.012, nk.z + 0.035, back):
            return True
        if (c - hc).length < 0.14:
            return True
        if c.y < spine_y(J, c.z) - 0.02 and c.z > zv and abs(c.x) < 0.047 * (c.z - zv) / 0.14 + 0.002:
            return True
        return False
    cut_faces(sh, kill)
    drop_islands(sh, 200)
    me = sh.data
    for v in me.vertices:
        v.co += v.normal * 0.0055
    me.update()
    sc = kit.Sculpt(sh)
    for i, v in enumerate(sc.bm.verts):
        c = v.co
        q = V((c.x * 14, c.y * 14, c.z * 6))
        v.co += sc.normals[i] * ((1 - abs(noise.noise(q)) * 2) * 0.002 + fbm(c, 25, 2, 81) * 0.0012)
    sc.done()
    kit.assign(sh, M["shirt"], M["canvas_in"])
    solidify(sh, 0.0018, -1.0, 1, 1)
    return sh

# =========================================================================== hands

def build_hand(J, s, sx, root, M):
    el, wr = J[f"elbow.{s}"][0].copy(), J[f"wrist.{s}"][0].copy()
    f = (wr - el).normalized()
    nrm = V((-sx, 0.35, 0.0))
    nrm = (nrm - f * nrm.dot(f)).normalized()
    a = f.cross(nrm).normalized()
    if a.y > 0:
        a = -a
    N = {}
    bones = []

    def put(n, co, r):
        N[n] = [V(co), (r, r)]
    put("el", el, 0.036)
    put("fa1", el.lerp(wr, 0.35), 0.031)
    put("fa2", el.lerp(wr, 0.72), 0.025)
    put("wr", wr, 0.021)
    pc = wr + f * 0.045
    put("pc", pc, 0.017)
    bones += [("el", "fa1"), ("fa1", "fa2"), ("fa2", "wr"), ("wr", "pc")]
    fingers = [("i", 0.026, (0.047, 0.029, 0.022), 0.17, 0.0, 1.0),
               ("m", 0.0085, (0.052, 0.033, 0.024), 0.03, 0.004, 1.05),
               ("r", -0.0095, (0.049, 0.031, 0.022), -0.11, 0.0, 1.1),
               ("p", -0.026, (0.039, 0.024, 0.019), -0.25, -0.008, 1.15)]
    rng = random.Random(4 if sx > 0 else 8)
    digits = []
    for name, off, L, spl, ex, cs in fingers:
        mcp = wr + f * (0.088 + ex) + a * off
        d0 = (f + a * spl).normalized()
        th = [(0.06 + rng.uniform(-0.06, 0.08)) * cs, (0.36 + rng.uniform(-0.1, 0.12)) * cs, (0.55 + rng.uniform(-0.1, 0.1)) * cs]
        pts, dirs, p = [mcp], [], mcp
        for k in range(3):
            d = (d0 * math.cos(th[k]) + nrm * math.sin(th[k])).normalized()
            dirs.append(d)
            p = p + d * L[k]
            pts.append(p)
        radii = [0.0102, 0.0089, 0.0077, 0.0064]
        mids = [0.0079, 0.0068, 0.0059]
        prev = "pc"
        for k in range(3):
            jn = f"{name}{k}"
            put(jn, pts[k], radii[k])
            bones.append((prev, jn))
            mn = jn + "m"
            put(mn, pts[k].lerp(pts[k + 1], 0.5), mids[k])
            bones.append((jn, mn))
            prev = mn
        put(f"{name}3", pts[3], radii[3])
        bones.append((prev, f"{name}3"))
        digits.append((pts, dirs, d0, th))
    # thumb
    cmc = wr + f * 0.015 + a * 0.017 + nrm * 0.008
    t0 = (f * 0.5 + a * 0.78 + nrm * 0.32).normalized()
    t1 = (t0 + nrm * 0.35 + f * 0.2).normalized()
    t2 = (t1 + nrm * 0.4).normalized()
    p1 = cmc + t0 * 0.038
    p2 = p1 + t1 * 0.032
    p3 = p2 + t2 * 0.025
    put("t0", cmc, 0.0135)
    put("t1", p1, 0.0105)
    put("t1m", p1.lerp(p2, 0.5), 0.0086)
    put("t2", p2, 0.0088)
    put("t2m", p2.lerp(p3, 0.5), 0.0074)
    put("t3", p3, 0.0064)
    bones += [("wr", "t0"), ("t0", "t1"), ("t1", "t1m"), ("t1m", "t2"), ("t2", "t2m"), ("t2m", "t3")]
    hand = skin(f"Hand.{s}", N, bones, root, 1.18, subdiv=1)
    kit.remesh(hand, 0.0021)
    # --- sculpt: knuckles, tendons, bony wrist, veins, creases
    sc = kit.Sculpt(hand)
    sc.smooth(2, 0.5)
    sc.refresh()
    tree = BVHTree.FromBMesh(sc.bm)

    def sn(p):
        loc = tree.find_nearest(V(p))[0]
        return loc if loc is not None else V(p)

    dors = -nrm
    for (pts, dirs, d0, th), (name, off, *_rest) in zip(digits, fingers):
        sc.inflate(pts[0] + dors * 0.0085, 0.0095, 0.0032)
        for j in (1, 2):
            e0 = d0 * math.sin(th[j - 1]) - nrm * math.cos(th[j - 1])
            e1 = d0 * math.sin(th[j]) - nrm * math.cos(th[j])
            e = (e0 + e1).normalized()
            sc.inflate(pts[j] + e * 0.0072, 0.0068, 0.0019)
            for dd in (-0.0028, 0.0028):
                q = pts[j] + e * 0.0075 + dirs[j - 1] * dd
                sc.crease_stroke([sn(q - a * 0.0055), sn(q + a * 0.0055)], 0.0014, 0.00045)
        tend = [sn(p) for p in resample([pts[0] + dors * 0.009, wr + f * 0.02 + dors * 0.012 + a * off * 0.4], 0.003)]
        sc.inflate_stroke(tend, 0.0032, 0.0011)
    sc.inflate(sn(wr + dors * 0.006 - a * 0.018), 0.008, 0.003)       # ulnar head
    sc.inflate_stroke([sn(p) for p in resample([el - a * 0.02 + dors * 0.02, wr - a * 0.018 + dors * 0.008], 0.004)], 0.006, 0.0015)
    sc.crease_stroke([sn(p) for p in resample([el.lerp(wr, 0.15) + dors * 0.03, el.lerp(wr, 0.8) + dors * 0.02], 0.004)], 0.008, 0.002)
    for vseed in range(2):
        pts = []
        base = wr + f * 0.055 + dors * 0.012 + a * (0.012 - vseed * 0.02)
        for k in range(14):
            t = k / 13
            q = base.lerp(el.lerp(wr, 0.3) + dors * 0.02 + a * (0.01 - vseed * 0.015), t)
            q += a * 0.004 * math.sin(t * 9 + vseed * 2)
            pts.append(sn(q))
        sc.inflate_stroke(pts, 0.0022, 0.0010)
    sc.refresh()
    sc.noise(scale=140, amount=0.00022, octaves=2, seed=1)
    sc.noise(scale=55, amount=-0.00035, ridged=True, seed=4)
    sc.smooth(1, 0.2)
    sc.done()
    kit.assign(hand, M["skin"])
    # nails: long, curved, dirty
    nails = []
    tips = [(pts[3], dirs[2], d0 * math.sin(th[2]) - nrm * math.cos(th[2])) for pts, dirs, d0, th in digits]
    tips.append((p3, t2, (t2.cross(a)).normalized() * (1 if t2.cross(a).dot(dors) > 0 else -1)))
    for tip, d, e in tips:
        e = (e - d * e.dot(d)).normalized()
        side = d.cross(e).normalized()

        def shape(p):
            t = p.y / 0.0075
            w = 1.0 - 0.35 * max(0.0, t) ** 2
            return V((p.x * w, p.y, p.z - (p.x / 0.0048) ** 2 * 0.0013 - max(0.0, t) ** 2 * 0.001))
        c = tip - d * 0.0045 + e * 0.0058
        nails.append(ell("nail", c, (0.0048, 0.0075, 0.0011), frame(side, d, e), 2, root, shape))
    nail = kit.join(nails, f"Nails.{s}")
    kit.assign(nail, M["nail"])
    STATE[f"hand.{s}"] = (wr, f, nrm, a)
    return hand, nail


# =========================================================================== bare foot (left)

def build_foot(J, root, M):
    kn = J["knee.L"][0].copy()
    A = V((0.112, 0.1, 0.108))
    H = A + V((0.0, 0.04, -0.035))
    Bl = V((0.118, -0.036, 0.024))
    STATE["ank.L"] = A
    N = {}
    bones = []

    def put(n, co, r):
        N[n] = [V(co), (r, r)]
    put("kn", kn, 0.052)
    put("sh1", kn.lerp(A, 0.3), 0.044)
    put("sh2", kn.lerp(A, 0.68), 0.033)
    put("an", A, 0.03)
    put("hl", H, 0.027)
    put("mf", A.lerp(Bl, 0.55) + V((0.004, 0, -0.004)), 0.025)
    put("bl", Bl, 0.021)
    bones += [("kn", "sh1"), ("sh1", "sh2"), ("sh2", "an"), ("an", "hl"), ("an", "mf"), ("mf", "bl")]
    toes = [(-0.029, 0.037, 0.0112), (-0.011, 0.032, 0.0082), (0.004, 0.029, 0.0077), (0.018, 0.025, 0.0072), (0.031, 0.02, 0.0066)]
    tipl = []
    for k, (off, ln, r) in enumerate(toes):
        root_p = Bl + V((off, -0.006 + abs(off) * 0.25, -0.002))
        d = V((off * 0.8, -1.0, 0.0)).normalized()
        segs = 2 if k == 0 else 3
        pts = [root_p]
        for j in range(segs):
            q = pts[-1] + d * (ln / segs)
            q.z = max(r * 0.85, q.z - 0.004)
            pts.append(q)
        prev = "bl"
        for j, q in enumerate(pts):
            nm = f"t{k}{j}"
            put(nm, q, r * (1 - 0.12 * j))
            bones.append((prev, nm))
            prev = nm
        tipl.append((pts[-1], d, r))
    foot = skin("Foot.L", N, bones, root, 1.15, subdiv=1)
    kit.remesh(foot, 0.0024)
    sc = kit.Sculpt(foot)
    sc.smooth(2, 0.5)
    sc.refresh()
    tree = BVHTree.FromBMesh(sc.bm)

    def sn(p):
        loc = tree.find_nearest(V(p))[0]
        return loc if loc is not None else V(p)
    sc.inflate(A + V((0.03, 0, 0.002)), 0.012, 0.004)                   # malleoli
    sc.inflate(A + V((-0.029, -0.004, 0.008)), 0.012, 0.004)
    sc.inflate_stroke([sn(p) for p in resample([H + V((0, 0.02, 0.02)), A.lerp(kn, 0.35) + V((0, 0.035, 0))], 0.004)], 0.008, 0.003)  # achilles
    sc.inflate_stroke([sn(p) for p in resample([kn + V((0, -0.05, -0.03)), A + V((0, -0.028, 0.03))], 0.004)], 0.008, 0.002)  # tibia
    sc.inflate(sn(kn.lerp(A, 0.25) + V((0, 0.04, 0))), 0.03, 0.004)    # calf
    for off, ln, r in toes:
        sc.inflate_stroke([sn(p) for p in resample([Bl + V((off, -0.005, 0.02)), A + V((off * 0.3, -0.03, 0.01))], 0.004)], 0.0035, 0.0012)
        sc.inflate(sn(Bl + V((off, -0.008, 0.02))), 0.007, 0.0015)
    sc.refresh()
    sc.noise(scale=120, amount=0.00025, seed=6)
    sc.noise(scale=45, amount=-0.0004, ridged=True, seed=7)
    for v in sc.bm.verts:
        if v.co.z < 0.0015:
            v.co.z = 0.0015
    sc.done()
    kit.assign(foot, M["skin"])
    nails = []
    for tip, d, r in tipl:
        e = V((0, 0, 1))
        side = d.cross(e).normalized()
        c = tip + e * r * 0.75 - d * r * 0.3
        nails.append(ell("tnail", c, (r * 0.62, r * 0.8, r * 0.14), frame(side, d, e), 2, root))
    tn = kit.join(nails, "Toenails")
    kit.assign(tn, M["toenail"])
    return foot, tn


# =========================================================================== boot (right)

def build_boot(J, root, M):
    an = J["ankle.R"][0].copy()
    x = an.x
    Ab = V((x, an.y + 0.005, 0.1))
    top = V((x - 0.004, an.y + 0.012, 0.25))
    Hb = V((x, an.y + 0.05, 0.048))
    Bb = V((x - 0.006, an.y - 0.12, 0.044))
    Tb = V((x - 0.01, an.y - 0.19, 0.04))
    STATE["ank.R"] = Ab
    N = {"top": [top, (0.055, 0.055)], "mid": [top.lerp(Ab, 0.5), (0.053, 0.053)], "an": [Ab, (0.052, 0.052)],
         "hl": [Hb, (0.045, 0.045)], "bl": [Bb, (0.047, 0.047)], "tc": [Tb, (0.037, 0.037)]}
    bones = [("top", "mid"), ("mid", "an"), ("an", "hl"), ("an", "bl"), ("bl", "tc")]
    boot = skin("Boot", N, bones, root, 1.12, subdiv=1)
    kit.remesh(boot, 0.003)
    sc = kit.Sculpt(boot)
    sc.smooth(2, 0.5)
    for v in sc.bm.verts:
        if v.co.z < 0.026:
            v.co.z = 0.026
        if v.co.z > top.z + 0.01:
            v.co.z = top.z + 0.01
    sc.refresh()
    tree = BVHTree.FromBMesh(sc.bm)

    def ray_front(xx, zz):
        hit = tree.ray_cast(V((xx, -1.0, zz)), V((0, 1, 0)))
        return hit[0], hit[1]
    # flex creases across the vamp, toe-cap seam, scuffs
    for k in range(5):
        yy = Bb.y + 0.03 - k * 0.011
        pts = [tree.find_nearest(V((x + dx, yy + abs(dx) * 0.2, 0.09)))[0] for dx in (-0.035, -0.015, 0.0, 0.015, 0.035)]
        sc.crease_stroke(pts, 0.004, 0.0014)
    cap = [tree.find_nearest(Tb + V((math.cos(t) * 0.045, math.sin(t) * 0.03 + 0.03, 0.02)))[0] for t in [i * 0.35 for i in range(-4, 13)]]
    sc.crease_stroke(cap, 0.0025, 0.0012)
    sc.noise(scale=35, amount=-0.0012, ridged=True, seed=11)
    sc.noise(scale=90, amount=0.0003, seed=12)
    sc.done()
    kit.assign(boot, M["boot"])
    # outsole: the boot squashed to a slab and widened
    sole = copy_obj(boot, "Sole")
    cx, cy = x - 0.005, an.y - 0.07
    for v in sole.data.vertices:
        v.co.x = cx + (v.co.x - cx) * 1.07
        v.co.y = cy + (v.co.y - cy) * 1.04
        v.co.z = min(max(v.co.z, 0.0), 0.03 if v.co.y > an.y + 0.01 else 0.027)
    kit.remesh(sole, 0.003)
    kit.assign(sole, M["rubber"])
    # laces through brass eyelets up the front of the shaft
    ey, lace = [], []
    rows = []
    for k in range(7):
        zz = 0.085 + k * 0.026
        hit, nr = ray_front(x, zz)
        if hit is None:
            continue
        rows.append((hit, nr, zz))
    for hit, nr, zz in rows:
        side = V((1, 0, 0))
        for sgn in (-1, 1):
            p = hit + side * sgn * 0.014 + V((0, 0.004, 0))
            q = tree.find_nearest(p)
            pp = q[0] + q[1] * 0.001
            ey.append(pp)
    parts = []
    for p in ey:
        parts.append(ell("eyelet", p, (0.0032, 0.0032, 0.0032), None, 2, root))
    eyelets = kit.join(parts, "Eyelets")
    kit.assign(eyelets, M["brass"])
    for i in range(len(rows) - 1):
        l0, r0 = ey[2 * i], ey[2 * i + 1]
        l1, r1 = ey[2 * i + 2], ey[2 * i + 3]
        for a, b in ((l0, r1), (r0, l1)):
            mid = a.lerp(b, 0.5) + V((0, -0.004, 0))
            lace.append(kit.tube("lace", [a, mid, b], 0.0022, 6, parent=root))
    if ey:
        for p, sw in ((ey[-2], -1), (ey[-1], 1)):
            pts = [p, p + V((sw * 0.006, -0.012, -0.01)), p + V((sw * 0.012, -0.02, -0.045)), p + V((sw * 0.015, -0.022, -0.08))]
            lace.append(kit.tube("lace", pts, 0.0021, 6, parent=root))
    laces = kit.join(lace, "Laces")
    kit.assign(laces, M["lace"])
    return boot, sole, eyelets, laces


# =========================================================================== overalls

def build_overalls(J, root, M):
    OJ = {}

    def put(n, co, r):
        OJ[n] = [V(co), (r, r)]
    pel, bel, ch = J["pelvis"][0], J["belly"][0], J["chest"][0]
    put("pelvis", pel + V((0, 0.0, 0.03)), 0.148)
    put("belly", bel + V((0, -0.012, 0.0)), 0.135)
    put("chest", ch + V((0, -0.01, -0.035)), 0.122)
    for s, sx in (("L", 1), ("R", -1)):
        hp, kn = J[f"hip.{s}"][0], J[f"knee.{s}"][0]
        an = STATE["ank." + s]
        put(f"hip.{s}", hp + V((sx * 0.008, 0, 0.0)), 0.098)
        put(f"knee.{s}", kn + V((0, -0.004, 0)), 0.08)
        put(f"shin.{s}", kn.lerp(an, 0.5), 0.077)
        put(f"ank.{s}", an + V((0, 0, 0.03)), 0.078)
    bones = [("pelvis", "belly"), ("belly", "chest")]
    for s in "LR":
        bones += [("pelvis", f"hip.{s}"), (f"hip.{s}", f"knee.{s}"), (f"knee.{s}", f"shin.{s}"), (f"shin.{s}", f"ank.{s}")]
    ob = skin("Overalls", OJ, bones, root, 1.12, subdiv=1)
    flatten_torso(ob, J, 0.84)
    kit.remesh(ob, 0.0085)
    zw = pel.z + 0.13
    top = max(v.co.z for v in ob.data.vertices)
    zb = min(ch.z - 0.03, top - 0.03)
    STATE["zw"], STATE["zb"] = zw, zb
    # --- folds, bunching, mud lumps; flat bib
    s = kit.Sculpt(ob)
    bib_n = V((0, -1, 0.18)).normalized()
    bib_c = None
    for i, v in enumerate(s.bm.verts):
        c = v.co
        n = s.normals[i]
        d = 0.0
        if c.z < pel.z - 0.04:
            q = V((c.x * 16, c.y * 16, c.z * 3.2))
            d += (1 - abs(noise.noise(q)) * 2) * 0.0045
            d += fbm(c, 7, 2, 3) * 0.004
        if c.x < 0 and c.z < 0.42:
            d += 0.0045 * math.sin(c.z * 115 + fbm(c, 9, 2, 5) * 3.0) * (1 - sstep(0.2, 0.42, c.z))
        if c.z < 0.5:
            m = fbm(c, 26, 3, 9)
            if m > 0.25:
                d += (m - 0.25) * 0.012 * (1 - sstep(0.25, 0.5, c.z))
        if zw - 0.05 < c.z < zb + 0.02 and n.y < -0.4 and abs(c.x) < 0.14:
            pass
        v.co += n * d
    s.refresh()
    for sd in "LR":
        kn = J[f"knee.{sd}"][0]
        for k in range(4):
            zz = kn.z + 0.05 - k * 0.028
            pts = [kn + V((dx, 0.06, zz - kn.z + dx * 0.3)) for dx in (-0.06, -0.03, 0.0, 0.03, 0.06)]
            s.crease_stroke(pts, 0.012, 0.004)
        for k in range(3):
            zz = J[f"hip.{sd}"][0].z - 0.02 - k * 0.03
            s.crease_stroke([V((0.0, -0.08, zz + 0.02)), V((0.06 if sd == "L" else -0.06, -0.09, zz - 0.03))], 0.012, 0.003)
    s.done()
    # flatten the bib panel (front-facing verts only)
    me = ob.data
    ys = [v.co.y for v in me.vertices if zw < v.co.z < zb and abs(v.co.x) < 0.1 and v.normal.y < -0.5]
    y_front = sorted(ys)[len(ys) // 3] if ys else ch.y - 0.12
    for v in me.vertices:
        c = v.co
        if zw - 0.06 < c.z < zb + 0.03 and v.normal.y < -0.3 and abs(c.x) < 0.15:
            tgt = y_front - (c.z - zw) * 0.12
            w = sstep(zw - 0.06, zw + 0.02, c.z) * (1 - sstep(0.1, 0.15, abs(c.x)))
            c.y = lerp(c.y, tgt, 0.75 * w)
    me.update()
    closed = copy_obj(ob, "OverallsClosed")
    # --- cut: open sides above the waist, bib, leg ends, holes
    holes = [(J["knee.R"][0] + V((0.0, -0.075, 0.01)), 0.05, 1), (J["hip.L"][0].lerp(J["knee.L"][0], 0.55) + V((0.07, -0.02, 0)), 0.045, 2),
             (J["hip.R"][0].lerp(J["knee.R"][0], 0.3) + V((-0.05, 0.08, 0)), 0.04, 3)]

    def kill(c, n):
        if c.z > zw:
            sy = spine_y(J, c.z)
            w = 0.112 - (c.z - zw) * 0.08
            if c.y < sy - 0.02 and abs(c.x) < w and c.z < zb + 0.004 * fbm(c, 40, 2, 1):
                return False
            if c.y > sy + 0.03 and abs(c.x) < 0.1 and c.z < zw + 0.07:
                return False
            return True
        if c.x < 0:
            if c.z < 0.175 + 0.018 * fbm(c, 22, 2, 4) + 0.03 * max(0.0, fbm(c, 7, 2, 5)):
                return True
        else:
            if c.z < 0.29 + 0.03 * fbm(c, 18, 3, 6) + 0.07 * max(0.0, fbm(c, 6, 2, 7)):
                return True
        for hc_, r, sd in holes:
            dd = (c - hc_).length
            if dd < r * 1.4 and (1 - dd / r) + 0.45 * fbm(c, 38, 3, sd) > 0.18:
                return True
        return False
    cut_faces(ob, kill)
    drop_islands(ob, 40)
    kit.assign(ob, M["canvas"], M["canvas_in"])
    solidify(ob, 0.004, -1.0, 1, 1)
    subsurf_live(ob, 1)
    return ob, closed


def build_straps(J, root, M, bust, body, overalls):
    snap_b = Snapper([bust, body])
    snap_o = Snapper([overalls])
    zb, zw = STATE["zb"], STATE["zw"]
    parts, buckles = [], []
    for sx, sd in ((1, "L"), (-1, "R")):
        sh = J[f"shoulder.{sd}"][0]
        start = snap_o.ray(V((sx * 0.078, -1.0, zb - 0.012)), V((0, 1, 0)))
        if start is None:
            vs = [v.co for v in overalls.data.vertices]
            log("strap: no bib hit", sx, zb, len(vs), min(v.z for v in vs), max(v.z for v in vs), min(v.y for v in vs))
            continue
        p0 = start[0] + start[1] * 0.004
        path = [p0]
        for t, (x, dz) in enumerate(((0.08, 0.05), (0.084, 0.1), (0.09, 0.15))):
            q = snap_b.near(V((sx * x, p0.y + 0.02, zb + dz)))
            path.append(q[0] + q[1] * 0.004)
        top = snap_b.near(sh + V((-sx * 0.085, 0.0, 0.07)))
        path.append(top[0] + top[1] * 0.004)
        for k in range(1, 6):
            t = k / 5
            q = V((lerp(sx * 0.085, -sx * 0.05, t), spine_y(J, lerp(sh.z, zw + 0.05, t)) + 0.12, lerp(sh.z + 0.02, zw + 0.06, t)))
            h = snap_b.near(q)
            path.append(h[0] + h[1] * 0.004)
        pts = resample(path, 0.012)
        sides = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            nn = snap_b.near(p)[1] if i > 0 else start[1]
            sides.append(t.cross(nn).normalized())
        parts.append(ribbon("strap", pts, sides, 0.034, root))
        # buckle: rectangular frame + button on the bib
        t = (pts[2] - pts[0]).normalized()
        nn = start[1]
        side = t.cross(nn).normalized()
        c = pts[0].lerp(pts[1], 0.35) + nn * 0.004
        for a_, b_ in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            pa = c + side * a_[0] * 0.022 + t * a_[1] * 0.017
            pb = c + side * b_[0] * 0.022 + t * b_[1] * 0.017
            buckles.append(kit.tube("bk", [pa, pb], 0.0028, 6, parent=root))
        buckles.append(kit.tube("btn", [c + nn * -0.004 + t * -0.022, c + nn * 0.003 + t * -0.022], 0.0075, 14, parent=root))
    straps = kit.join(parts, "Straps")
    kit.assign(straps, M["canvas"])
    solidify(straps, 0.003, 0.0)
    subsurf_live(straps, 1)
    bk = kit.join(buckles, "Buckles")
    kit.assign(bk, M["brass"])
    return straps, bk


# =========================================================================== jacket + shearling

def build_jacket(J, root, M, colliders):
    pel, bel, ch, nk = J["pelvis"][0], J["belly"][0], J["chest"][0], J["neck"][0]
    arms = {}
    parts = []
    yoke = V((0, nk.y + 0.015, J["shoulder.L"][0].z + 0.03))
    torso = [V((0, lerp(pel.y, bel.y, 0.6), pel.z - 0.06)), V((0, bel.y, bel.z)), V((0, ch.y + 0.005, ch.z)), yoke]
    parts.append(kit.tube("jt", torso, [0.16, 0.155, 0.163, 0.118], 28, parent=root))
    for s_ in "LR":
        sh, el, wr = J[f"shoulder.{s_}"][0], J[f"elbow.{s_}"][0], J[f"wrist.{s_}"][0]
        cuff = el.lerp(wr, 0.92)
        arms[s_] = (sh, el, cuff)
        parts.append(ell("js", sh + V((0, 0, 0.004)), (0.054, 0.056, 0.052), None, 3, root))
        parts.append(kit.tube("ja", [sh + (sh - el).normalized() * 0.02, sh.lerp(el, 0.5), el, cuff],
                              [0.057, 0.055, 0.054, 0.051], 20, parent=root))
    ob = kit.join(parts, "Jacket")
    flatten_torso(ob, J, 0.8)
    kit.remesh(ob, 0.012)
    log("jacket remesh", len(ob.data.polygons))
    zn = yoke.z - 0.035
    STATE["jk"] = (yoke, zn, lambda z: 0.072 + (zn - z) * 0.075)
    zh = pel.z - 0.015

    def armt(c, s):
        sh, el, cuff = arms[s]
        d = cuff - sh
        t = (c - sh).dot(d) / d.length_squared
        return t
    def near_arm(c):
        for s_ in "LR":
            sh, el, cuff = arms[s_]
            d = cuff - sh
            t = max(0.0, min(1.0, (c - sh).dot(d) / d.length_squared))
            if (c - (sh + d * t)).length < 0.09 and t > 0.25:
                return True
        return False

    def opening_w(z):
        return 0.072 + (zn - z) * 0.075

    def kill(c, n):
        if c.z > zn and math.hypot(c.x, c.y - yoke.y) < 0.105:
            return True
        if c.y < spine_y(J, c.z) - 0.03 and abs(c.x) < opening_w(c.z) and c.z < zn + 0.05:
            return True
        if c.z < zh and not near_arm(c):
            return True
        for s in "LR":
            if abs(c.x) > 0.15 and (c.x > 0) == (s == "L") and armt(c, s) > 0.97:
                return True
        return False
    cut_faces(ob, kill)
    log("jacket cut", len(ob.data.polygons))
    drop_islands(ob, 60)
    log("jacket islands", len(ob.data.polygons))

    def pin(c):
        for s in "LR":
            if abs(c.x) > 0.19 and (c.x > 0) == (s == "L"):
                return 1.0 - 0.6 * sstep(0.55, 0.95, armt(c, s))
        w = sstep(ch.z - 0.1, ch.z + 0.04, c.z)
        if c.y > spine_y(J, c.z):
            w = max(w, 0.55 * sstep(zh, ch.z, c.z))
        return w
    kit.vgroup(ob, "pin", pin)
    if not FAST:
        t = time.time()
        my_drape(ob, colliders, frames=22, pin="pin", stiffness=14.0, thickness=0.007, quality=5)
        log("jacket drape %.1fs" % (time.time() - t))
    # the neckline/front edge before tearing, for the shearling
    edge = boundary_verts(ob)
    kit.subdivide(ob, 1)
    # --- sculpt seams and wrinkles
    s = kit.Sculpt(ob)
    tree = BVHTree.FromBMesh(s.bm)

    def sn(p):
        loc = tree.find_nearest(V(p))[0]
        return loc if loc is not None else V(p)

    def seam(pts, r=0.005, d=0.0018):
        s.crease_stroke([sn(p) for p in resample(pts, 0.004)], r, d)
    for sx, sd in ((1, "L"), (-1, "R")):
        sh, el, cuff = arms[sd]
        seam([V((sx * 0.155, spine_y(J, zh) , zh + 0.02)), V((sx * 0.16, spine_y(J, ch.z), ch.z - 0.02)), sh + V((-sx * 0.02, 0.02, -0.08))])
        seam([nk + V((sx * 0.08, 0.02, 0.0)), sh + V((0, 0.0, 0.08))])
        d = (el - sh).normalized()
        u = d.cross(V((0, 0, 1))).normalized()
        w = d.cross(u).normalized()
        ring = [sh + d * 0.02 + (u * math.cos(k * 0.5) + w * math.sin(k * 0.5)) * 0.075 for k in range(14)]
        seam(ring)
        # irregular diagonal compression folds: short helical creases with a ridge beside each
        rngf = random.Random(17 if sx > 0 else 19)
        dd = (cuff - sh).normalized()
        uu = dd.cross(V((0, 0, 1))).normalized()
        ww = dd.cross(uu).normalized()
        L = (cuff - sh).length
        for k in range(24):
            t = rngf.choice((rngf.uniform(0.15, 0.95), rngf.uniform(0.42, 0.62), rngf.uniform(0.78, 0.94)))
            a0 = rngf.uniform(0, 6.28)
            span = rngf.uniform(0.8, 1.9)
            slope = rngf.uniform(0.035, 0.08) * rngf.choice((-1, 1))
            pts = [sh + dd * (L * t + slope * (j / 6 - 0.5)) + (uu * math.cos(a0 + span * j / 6) + ww * math.sin(a0 + span * j / 6)) * 0.075
                   for j in range(7)]
            depth = rngf.uniform(0.002, 0.005)
            seam(pts, rngf.uniform(0.006, 0.01), depth)
            seam([p + dd * 0.011 for p in pts], 0.009, -depth * 0.5)
    seam([V((-0.16, spine_y(J, ch.z + 0.07) + 0.15, ch.z + 0.07)), V((0.16, spine_y(J, ch.z + 0.07) + 0.15, ch.z + 0.07))])
    for i, v in enumerate(s.bm.verts):
        c = v.co
        q = V((c.x * 11, c.y * 11, c.z * 5))
        v.co += s.normals[i] * ((1 - abs(noise.noise(q)) * 2) * 0.003 + fbm(c, 30, 2, 13) * 0.0012)
    s.done()
    # --- tears: ragged hem and cuffs, holes
    holes = [(arms["L"][1] + V((0.035, 0.02, 0.0)), 0.042, 21), (arms["R"][1] + V((-0.03, 0.035, 0.005)), 0.05, 25), (V((-0.12, spine_y(J, ch.z) + 0.16, ch.z + 0.03)), 0.05, 22),
             (V((0.1, spine_y(J, bel.z) - 0.14, bel.z - 0.05)), 0.035, 23), (V((0.05, spine_y(J, bel.z) + 0.15, bel.z - 0.08)), 0.04, 24)]

    def tear(c, n):
        if c.z < zh + 0.035 * fbm(c, 16, 2, 31) + 0.05 * max(0.0, fbm(c, 5, 2, 32)) + 0.025 and not near_arm(c):
            return True
        for s_ in "LR":
            if abs(c.x) > 0.15 and (c.x > 0) == (s_ == "L") and armt(c, s_) > 0.93 + 0.04 * fbm(c, 20, 2, 33):
                return True
        for hc_, r, sd in holes:
            dd = (c - hc_).length
            if dd < r * 1.4 and (1 - dd / r) + 0.45 * fbm(c, 34, 3, sd) > 0.25:
                return True
        return False
    cut_faces(ob, tear)
    drop_islands(ob, 30)
    kit.assign(ob, M["leather"], M["lining"])
    solidify(ob, 0.006, -1.0, 1, 1)
    subsurf_live(ob, 1)
    # frayed, rolled cuffs
    rolls = []
    rngc = random.Random(31)
    for s_ in "LR":
        sh, el, cuff = arms[s_]
        dd = (cuff - sh).normalized()
        uu = dd.cross(V((0, 0, 1))).normalized()
        ww = dd.cross(uu).normalized()
        c0 = sh.lerp(cuff, 0.905)
        pts = [c0 + dd * (0.006 * math.sin(k * 1.7)) + (uu * math.cos(k * 0.36) + ww * math.sin(k * 0.36)) * (0.052 + rngc.uniform(-0.003, 0.003)) for k in range(19)]
        rolls.append(kit.tube("cuffroll", pts, [0.0085 * (0.55 + 0.45 * math.sin(math.pi * k / 18)) for k in range(19)], 8, parent=root))
    roll = kit.join(rolls, "CuffRolls")
    kit.subdivide(roll, 1)
    sr = kit.Sculpt(roll)
    sr.noise(scale=60, amount=0.0015, seed=33)
    sr.done()
    kit.assign(roll, M["leather"])
    return ob, edge


def build_collar(J, root, M, jacket, edge):
    nk, ch = J["neck"][0], J["chest"][0]
    yoke, zn, ow = STATE["jk"]
    snap = Snapper([jacket])
    cy = yoke.y + 0.004
    z0 = ch.z - 0.11

    def lapel(sx, z):
        h = snap.near(V((sx * (ow(z) + 0.01), spine_y(J, z) - 0.2, z)))
        return h[0]
    left = [lapel(1, z0 + (zn - z0) * k / 10) for k in range(11)]
    right = [lapel(-1, z0 + (zn - z0) * k / 10) for k in range(10, -1, -1)]
    ring = []
    for k in range(25):
        a_ = 0.5 + (2 * math.pi - 1.0) * k / 24
        q = V((math.sin(a_) * 0.108, cy - math.cos(a_) * 0.095, zn + 0.004))
        h = snap.near(q)
        ring.append(h[0].lerp(q, 0.5))
    path = left + ring + right
    pts = resample(path, 0.01)
    for _ in range(8):
        pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    pts = resample(pts, 0.008)
    outs, ro, rb, ctr = [], [], [], []
    npts = len(pts)
    for ip, p in enumerate(pts):
        h = snap.near(p)
        n = h[1] if h else V((0, -1, 0))
        up = sstep(nk.z - 0.09, nk.z - 0.02, p.z)
        o = (n + V((0, 0, 0.6 * up))).normalized()
        outs.append(o)
        r1 = lerp(0.0065, 0.0095, up)
        r2 = lerp(0.03, 0.05, up)
        u_ = ip / max(1, npts - 1)
        te = sstep(0.0, 0.2, u_) * sstep(0.0, 0.2, 1.0 - u_)
        ro.append(r1 * (0.3 + 0.7 * te))
        rb.append(r2 * (0.15 + 0.85 * te))
        ctr.append(p + o * (r1 * 0.5 + 0.005))
    col = section_tube("Collar", ctr, outs, ro, rb, 12, root)
    kit.subdivide(col, 1)
    s = kit.Sculpt(col)
    s.noise(scale=90, amount=0.0022, octaves=2, seed=41)
    s.noise(scale=25, amount=0.004, octaves=2, seed=42)
    s.done()
    kit.assign(col, M["fleece"], M["fleece_hair"])
    if not FAST:
        try:
            mod = col.modifiers.new("Fleece", "PARTICLE_SYSTEM")
            st = mod.particle_system.settings
            st.type = "HAIR"
            st.use_advanced_hair = True
            st.count = 12000
            st.hair_length = 0.011
            st.hair_step = 5
            st.child_type = "INTERPOLATED"
            for attr, val in (("child_percent", 3), ("child_nbr", 3)):
                if hasattr(st, attr):
                    setattr(st, attr, val)
            st.rendered_child_count = 16 if FINAL else 10
            st.clump_factor = 0.25
            st.clump_shape = 0.2
            st.kink = "CURL"
            st.kink_amplitude = 0.002
            st.kink_frequency = 3.0
            st.roughness_1 = 0.0025
            st.roughness_endpoint = 0.003
            st.roughness_2 = 0.0015
            st.render_step = 4
            st.display_step = 3
            st.radius_scale = 0.00042
            st.root_radius = 1.0
            st.tip_radius = 0.35
            try:
                st.material_slot = M["fleece_hair"].name
            except Exception:
                st.material = 2
        except Exception as e:
            log("fleece particles failed:", e)
    return col


# =========================================================================== hair + threads + flaps

def build_hair(bust, Mh, root, M):
    Mi = Mh.inverted()
    R3 = Mh.to_3x3()
    bm = bmesh.new()
    bm.from_mesh(bust.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    rng = random.Random(21)
    scalp = []
    for v in bust.data.vertices:
        c = Mi @ v.co
        if c.z < -0.065:
            continue
        nc = (R3.transposed() @ v.normal)
        if nc.dot((c - V((0, 0.01, 0.02))).normalized()) < 0.3:
            continue
        if c.y > 0.035:
            ok = c.z > -0.05
        elif c.y > -0.03:
            ok = c.z > 0.018 and not (abs(c.x) > 0.066 and c.z < 0.03)
        else:
            ok = c.z > 0.074 + (-c.y - 0.03) * 0.35 + abs(c.x) * 0.25
        if not ok:
            continue
        if fbm(c, 30, 2, 51) > 0.06:
            continue
        scalp.append((v.co.copy(), v.normal.copy(), c))
    if len(scalp) < 40:
        log("hair: scalp too small", len(scalp))
        return None
    kd = KDTree(len(scalp))
    for i, (co, n, c) in enumerate(scalp):
        kd.insert(co, i)
    kd.balance()

    def grow(p0, n0, c0, length, steps=11):
        out_c = V((c0.x, c0.y + 0.015, 0)).normalized() if abs(c0.x) + abs(c0.y) > 1e-4 else V((0, 1, 0))
        d = (n0 * 0.22 + (R3 @ out_c) * 0.6 + V((0, 0, -0.3))).normalized()
        pts = [p0 - n0 * 0.0006]
        p = p0.copy()
        seg = length / steps
        for k in range(steps):
            d = (d + V((0, 0, -0.45)) + V((fbm(p, 60, 1, k), fbm(p, 60, 1, k + 7), 0)) * 0.08).normalized()
            p = p + d * seg
            loc, nrm, i, dist = tree.find_nearest(p)
            if loc is not None and (p - loc).dot(nrm) < 0.0009:
                p = loc + nrm * 0.0009
            pts.append(p.copy())
        return pts
    strands = []
    for ci in range(78):
        co, n, c = scalp[rng.randrange(len(scalp))]
        L = rng.uniform(0.06, 0.14) * (1.25 if c.y > 0.02 else 1.0)
        guide = grow(co, n, c, L)
        for (co2, idx, dist) in kd.find_n(co, rng.randint(3, 6)):
            n2 = scalp[idx][1]
            off = co2 - co
            st = []
            for k, gp in enumerate(guide):
                t = k / (len(guide) - 1)
                q = gp + off * (1 - 0.93 * t) + V((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.0006 * t
                if k > 0:
                    loc, nrm, i, dd = tree.find_nearest(q)
                    if loc is not None and (q - loc).dot(nrm) < 0.0012:
                        q = loc + nrm * 0.0012
                st.append(q)
            strands.append(st)
    for k in range(90):
        co, n, c = scalp[rng.randrange(len(scalp))]
        strands.append(grow(co, n, c, rng.uniform(0.02, 0.08), 7))
    ob = hair_object("Hair", strands, 0.0002, 0.00005, M["hair"], root)
    log("hair strands", len(strands))
    return ob


def build_threads(objs, root, mat, seed=0, every=3, zmax=None):
    """Loose threads hanging from torn fabric edges (hair curves)."""
    rng = random.Random(seed)
    strands = []
    for ob in objs:
        for k, (co, n) in enumerate(boundary_verts(ob)):
            if zmax is not None and co.z > zmax:
                continue
            if k % every or rng.random() < 0.4:
                continue
            L = rng.uniform(0.008, 0.04)
            pts = [co.copy()]
            d = (n * 0.4 + V((0, 0, -1))).normalized()
            for j in range(5):
                d = (d + V((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), -0.3))).normalized()
                pts.append(pts[-1] + d * L / 5)
            strands.append(pts)
    if not strands:
        return None
    return hair_object("Threads", strands, 0.0005, 0.0003, mat, root)


def build_flaps(overalls, root, M):
    """Torn canvas flaps hanging from the ragged left cuff: soft body with goal weights."""
    rng = random.Random(77)
    edge = [(co, n) for co, n in boundary_verts(overalls) if co.x > 0 and co.z < 0.42]
    if len(edge) < 10:
        return None
    edge.sort(key=lambda e: e[0].z)
    picks = [edge[int(len(edge) * f)] for f in (0.05, 0.3, 0.55)]
    parts = []
    for co, n in picks:
        o = V((n.x, n.y, 0)).normalized() if n.length > 0 else V((1, 0, 0))
        side = o.cross(V((0, 0, 1))).normalized()
        L = rng.uniform(0.07, 0.11)
        w = rng.uniform(0.018, 0.03)
        bm = bmesh.new()
        rows = []
        for j in range(9):
            t = j / 8
            base = co + o * 0.004 + (o * 0.7 + V((0, 0, -0.7))).normalized() * L * t
            ww = w * (1 - 0.6 * t)
            rows.append([bm.verts.new(base + side * ww * (k - 1)) for k in range(3)])
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(2):
                bm.faces.new((r0[k], r0[k + 1], r1[k + 1], r1[k]))
        parts.append(kit.mesh_obj("flap", bm, root))
    fl = kit.join(parts, "Flaps")
    top_z = {}
    kit.vgroup(fl, "goal", lambda c: 1.0)  # placeholder, replaced below
    g = fl.vertex_groups["goal"]
    # goal from how far down the flap the vertex is (rows were built top to bottom)
    for v in fl.data.vertices:
        g.add([v.index], max(0.0, 1.0 - (v.index // 3 % 9) / 8 * 1.1) ** 2, "REPLACE")
    if not FAST:
        kit.softbody_sag(fl, "goal", frames=28, gravity=1.0, stiffness=0.35, damping=4.0)
    kit.subdivide(fl, 1)
    kit.assign(fl, M["canvas"], M["canvas_in"])
    solidify(fl, 0.003, 0.0, 1, 1)
    return fl


# =========================================================================== materials

class G:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.n = kit.Nodes(self.m)
        self.nt = self.n.nt
        self.out = self.node("ShaderNodeOutputMaterial")
        self.b = self.node("ShaderNodeBsdfPrincipled")
        self.link(self.b.outputs[0], self.out.inputs["Surface"])
        self.co = self.node("ShaderNodeTexCoord").outputs["Object"]

    def node(self, kind, **kw):
        return self.n.new(kind, **kw)

    def link(self, a, b):
        self.nt.links.new(a, b)

    def put(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.link(val, sock)
        elif isinstance(val, (tuple, list)) and len(val) == 3 and sock.type == "RGBA":
            sock.default_value = (*val, 1.0)
        else:
            sock.default_value = val

    def math(self, op, a, b=0.0, clamp=False):
        m = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.put(m.inputs[0], a)
        self.put(m.inputs[1], b)
        return m.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        m = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.put(m.inputs[0], fac)
        self.put(m.inputs[6], a)
        self.put(m.inputs[7], b)
        return m.outputs[2]

    def noise(self, scale, detail=4.0, rough=0.5, dist=0.0, vec=None):
        t = self.node("ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough, Distortion=dist)
        self.put(t.inputs["Vector"], vec if vec is not None else self.co)
        return t.outputs["Fac"]

    def voronoi(self, scale, feature="F1", vec=None, out="Distance"):
        t = self.node("ShaderNodeTexVoronoi", Scale=scale)
        t.feature = feature
        self.put(t.inputs["Vector"], vec if vec is not None else self.co)
        return t.outputs[out]

    def mr(self, v, a, b, c=0.0, d=1.0):
        m = self.node("ShaderNodeMapRange")
        self.put(m.inputs["Value"], v)
        m.inputs["From Min"].default_value = a
        m.inputs["From Max"].default_value = b
        m.inputs["To Min"].default_value = c
        m.inputs["To Max"].default_value = d
        return m.outputs["Result"]

    def ramp(self, fac, stops):
        r = self.node("ShaderNodeValToRGB")
        el = r.color_ramp.elements
        el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1.0)
        el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1.0)
        for pos, col in stops[1:-1]:
            e = el.new(pos)
            e.color = (*col, 1.0)
        self.put(r.inputs["Fac"], fac)
        return r.outputs["Color"]

    def ao(self, dist=0.03, local=True):
        a = self.node("ShaderNodeAmbientOcclusion")
        a.inputs["Distance"].default_value = dist
        a.samples = 8
        a.only_local = local
        return a.outputs["AO"]

    def xyz(self):
        s = self.node("ShaderNodeSeparateXYZ")
        self.link(self.co, s.inputs[0])
        return s.outputs

    def bump(self, height, strength, dist=0.001):
        b = self.node("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = dist
        self.put(b.inputs["Height"], height)
        self.link(b.outputs["Normal"], self.b.inputs["Normal"])

    def set(self, **kw):
        for k, v in kw.items():
            self.put(self.b.inputs[k.replace("_", " ")], v)


def materials():
    M = {}
    # ---------------- skin: mottled grey-green, veins, bruises, spots, cavity grime, mask attribute
    g = G("RotSkin")
    at = g.node("ShaderNodeAttribute")
    at.attribute_name = "mask"
    sep = g.node("ShaderNodeSeparateColor")
    g.link(at.outputs["Color"], sep.inputs[0])
    wound, dirt, bruise, wet = sep.outputs[0], sep.outputs[1], sep.outputs[2], at.outputs["Alpha"]
    col = g.ramp(g.noise(9.0, 8, 0.72, 0.3), [(0.42, (0.045, 0.055, 0.042)), (0.49, (0.11, 0.13, 0.1)),
                                               (0.55, (0.19, 0.21, 0.165)), (0.61, (0.26, 0.27, 0.215))])
    fine = g.ramp(g.noise(38.0, 6, 0.7), [(0.35, (0.78, 0.8, 0.76)), (0.65, (1.12, 1.08, 1.0))])
    col = g.mix(1.0, col, fine, "MULTIPLY")
    tint = g.ramp(g.noise(1.5, 2), [(0.38, (0.8, 0.92, 0.8)), (0.62, (1.06, 0.98, 0.88))])
    col = g.mix(1.0, col, tint, "MULTIPLY")
    col = g.mix(g.math("MULTIPLY", g.mr(g.noise(5.0, 6, 0.65, 0.5), 0.52, 0.6), 0.8), col, (0.045, 0.055, 0.03))
    fD = g.math("MAXIMUM", g.mr(g.noise(2.0, 4, 0.55), 0.6, 0.72), bruise)
    col = g.mix(g.math("MULTIPLY", fD, 0.85), col, (0.05, 0.04, 0.052))
    vein = g.mr(g.math("ABSOLUTE", g.math("SUBTRACT", g.noise(6.0, 3, 0.5, 0.5), 0.5)), 0.0, 0.016, 1.0, 0.0)
    vis = g.mr(g.noise(1.6, 2), 0.45, 0.6)
    col = g.mix(g.math("MULTIPLY", vein, g.math("MULTIPLY", vis, 0.6)), col, (0.1, 0.11, 0.19))
    spots = g.math("MULTIPLY", g.mr(g.voronoi(38.0), 0.0, 0.14, 1.0, 0.0), g.mr(g.noise(3.3, 2), 0.5, 0.62))
    col = g.mix(g.math("MULTIPLY", spots, 0.55), col, (0.08, 0.06, 0.045))
    col = g.mix(g.math("MULTIPLY", g.mr(g.ao(0.03), 0.4, 0.97, 1.0, 0.0), 0.92), col, (0.025, 0.02, 0.014))
    col = g.mix(g.math("MULTIPLY", dirt, 0.9), col, (0.09, 0.07, 0.045))
    crust = g.math("MULTIPLY", g.mr(wound, 0.05, 0.5), g.mr(g.noise(120, 4), 0.35, 0.6))
    col = g.mix(crust, col, (0.09, 0.045, 0.025))
    col = g.mix(g.mr(wound, 0.45, 0.9), col, g.mix(g.mr(g.noise(200, 3), 0.4, 0.65), (0.018, 0.003, 0.002), (0.06, 0.012, 0.007)))
    g.link(col, g.b.inputs["Base Color"])
    rough = g.mr(g.noise(14.0, 3), 0.3, 0.7, 0.42, 0.7)
    rough = g.math("SUBTRACT", rough, g.math("MULTIPLY", g.math("MAXIMUM", wet, wound), 0.34))
    rough = g.math("ADD", rough, g.math("MULTIPLY", dirt, 0.2), clamp=True)
    g.link(rough, g.b.inputs["Roughness"])
    g.set(Subsurface_Weight=0.12, Subsurface_Radius=(0.75, 0.6, 0.45), Subsurface_Scale=0.0025)
    g.b.inputs["Specular IOR Level"].default_value = 0.45
    g.link(g.math("MULTIPLY", wet, 0.6), g.b.inputs["Coat Weight"])
    g.b.inputs["Coat Roughness"].default_value = 0.12
    cracks = g.mr(g.voronoi(150.0, "DISTANCE_TO_EDGE"), 0.0, 0.05)
    wr = g.node("ShaderNodeTexWave", Scale=60.0, Distortion=6.0, Detail=4.0)
    wr.bands_direction = "Z"
    g.link(g.co, wr.inputs["Vector"])
    wrk = g.math("MULTIPLY", g.mr(wr.outputs["Fac"], 0.0, 0.35, 0.0, 1.0), 0.35)
    g.bump(g.math("ADD", g.math("ADD", g.math("MULTIPLY", g.noise(300, 3), 0.5), g.math("MULTIPLY", cracks, 0.3)), wrk), 0.3, 0.0006)
    M["skin"] = g.m

    g = G("RotMouth")
    g.set(Base_Color=(0.1, 0.018, 0.016), Roughness=0.28, Subsurface_Weight=0.2, Subsurface_Scale=0.003)
    g.link(g.mix(g.mr(g.noise(30, 3), 0.4, 0.7), (0.02, 0.006, 0.005), (0.07, 0.025, 0.018)), g.b.inputs["Base Color"])
    M["mouth"] = g.m
    g = G("RotSocket")
    g.set(Base_Color=(0.02, 0.008, 0.006), Roughness=0.3)
    M["socket"] = g.m

    # ---------------- eye: milky clouded, glossy wet coat, ghost of an iris
    g = G("RotEye")
    xyz = g.xyz()
    r = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", xyz[0], xyz[0]), g.math("MULTIPLY", xyz[2], xyz[2])))
    front = g.mr(xyz[1], 0.0, -0.006)
    iris = g.ramp(r, [(0.0, (0.42, 0.44, 0.42)), (0.0022, (0.5, 0.53, 0.5)), (0.0048, (0.58, 0.6, 0.56)),
                      (0.0058, (0.68, 0.66, 0.58)), (0.0075, (0.7, 0.68, 0.58))])
    scl = g.ramp(g.noise(250, 3, 0.6), [(0.4, (0.66, 0.62, 0.5)), (0.6, (0.72, 0.68, 0.58))])
    vein = g.mr(g.math("ABSOLUTE", g.math("SUBTRACT", g.noise(700, 2, 0.5, 0.6), 0.5)), 0.0, 0.02, 1.0, 0.0)
    scl = g.mix(g.math("MULTIPLY", vein, g.mr(xyz[1], -0.004, 0.006, 0.0, 0.7)), scl, (0.45, 0.12, 0.08))
    col = g.mix(front, scl, iris)
    g.link(col, g.b.inputs["Base Color"])
    g.set(Roughness=0.35, Subsurface_Weight=0.5, Subsurface_Radius=(0.8, 0.7, 0.6), Subsurface_Scale=0.002,
          Coat_Weight=1.0, Coat_Roughness=0.03)
    M["eye"] = g.m

    g = G("RotTooth")
    ca = g.node("ShaderNodeAttribute")
    ca.attribute_name = "rot"
    base = g.ramp(g.noise(120, 3), [(0.4, (0.46, 0.37, 0.2)), (0.6, (0.58, 0.49, 0.3))])
    col = g.mix(g.mr(ca.outputs["Fac"], 0.35, 1.0), base, (0.14, 0.09, 0.04))
    g.link(col, g.b.inputs["Base Color"])
    g.set(Roughness=0.38, Subsurface_Weight=0.15, Subsurface_Scale=0.002)
    M["tooth"] = g.m

    g = G("RotNail")
    g.link(g.ramp(g.noise(90, 4), [(0.35, (0.14, 0.12, 0.08)), (0.65, (0.38, 0.33, 0.22))]), g.b.inputs["Base Color"])
    g.set(Roughness=0.4, Coat_Weight=0.3, Coat_Roughness=0.3)
    g.bump(g.noise(300, 2), 0.2, 0.0003)
    M["nail"] = g.m
    g = G("RotToenail")
    g.link(g.ramp(g.noise(90, 4), [(0.35, (0.05, 0.04, 0.03)), (0.65, (0.2, 0.16, 0.1))]), g.b.inputs["Base Color"])
    g.set(Roughness=0.5)
    M["toenail"] = g.m

    # ---------------- hair: greasy, thinning, grey-brown
    h = bpy.data.materials.new("RotHair")
    n = kit.Nodes(h)
    out = n.new("ShaderNodeOutputMaterial")
    hb = n.new("ShaderNodeBsdfHairPrincipled")
    try:
        hb.parametrization = "MELANIN"
    except Exception:
        pass
    for k, v in (("Melanin", 0.88), ("Melanin Redness", 0.25), ("Roughness", 0.3), ("Radial Roughness", 0.35),
                 ("Coat", 0.3), ("Random Color", 0.3), ("Random Roughness", 0.2), ("Tint", (0.75, 0.8, 0.7, 1))):
        if k in hb.inputs:
            hb.inputs[k].default_value = v
    n.link(hb, 0, out, "Surface")
    M["hair"] = h
    h = bpy.data.materials.new("RotFleeceHair")
    n = kit.Nodes(h)
    out = n.new("ShaderNodeOutputMaterial")
    hb = n.new("ShaderNodeBsdfHairPrincipled")
    try:
        hb.parametrization = "COLOR"
    except Exception:
        pass
    for k, v in (("Color", (0.2, 0.15, 0.095, 1)), ("Roughness", 0.6), ("Radial Roughness", 0.9),
                 ("Random Color", 0.35), ("Random Roughness", 0.3), ("Coat", 0.0)):
        if k in hb.inputs:
            hb.inputs[k].default_value = v
    n.link(hb, 0, out, "Surface")
    M["fleece_hair"] = h

    g = G("RotFleece")
    g.link(g.ramp(g.noise(40, 6, 0.7), [(0.35, (0.05, 0.04, 0.028)), (0.55, (0.15, 0.12, 0.08)), (0.7, (0.24, 0.19, 0.13))]),
           g.b.inputs["Base Color"])
    g.set(Roughness=0.95, Sheen_Weight=0.8, Sheen_Roughness=0.6)
    g.bump(g.noise(160, 4, 0.7), 0.6, 0.002)
    M["fleece"] = g.m

    # ---------------- leather jacket: dark brown, worn, cracked, greasy
    g = G("RotLeather")
    xyz = g.xyz()
    col = g.ramp(g.noise(5.0, 8, 0.62), [(0.4, (0.045, 0.029, 0.019)), (0.55, (0.1, 0.064, 0.04)), (0.72, (0.2, 0.135, 0.085))])
    geo = g.node("ShaderNodeNewGeometry")
    wear = g.mr(geo.outputs["Pointiness"], 0.5, 0.56)
    col = g.mix(g.math("MULTIPLY", wear, 0.7), col, (0.2, 0.15, 0.1))
    crk = g.math("MULTIPLY", g.mr(g.voronoi(34.0, "DISTANCE_TO_EDGE"), 0.0, 0.035, 1.0, 0.0), g.mr(g.noise(3.0, 2), 0.45, 0.6))
    col = g.mix(g.math("MULTIPLY", crk, 0.8), col, (0.1, 0.08, 0.06))
    mud = g.math("MULTIPLY", g.mr(g.math("ADD", xyz[2], g.math("MULTIPLY", g.noise(6, 3), 0.12)), 1.08, 0.92), g.mr(g.noise(9, 3), 0.4, 0.6))
    col = g.mix(mud, col, (0.12, 0.095, 0.065))
    col = g.mix(g.math("MULTIPLY", g.mr(g.ao(0.05), 0.4, 0.95, 1.0, 0.0), 0.7), col, (0.015, 0.01, 0.008))
    g.link(col, g.b.inputs["Base Color"])
    g.link(g.math("ADD", g.mr(g.noise(8, 3), 0.3, 0.7, 0.38, 0.62), g.math("MULTIPLY", g.math("ADD", crk, mud), 0.3), clamp=True), g.b.inputs["Roughness"])
    g.set(Coat_Weight=0.1, Coat_Roughness=0.4, Specular_IOR_Level=0.4)
    g.bump(g.math("ADD", g.math("MULTIPLY", g.noise(140, 4), 0.3), g.math("MULTIPLY", crk, -0.5)), 0.25, 0.001)
    M["leather"] = g.m
    g = G("RotLining")
    g.link(g.ramp(g.noise(30, 5), [(0.4, (0.03, 0.028, 0.025)), (0.6, (0.07, 0.06, 0.05))]), g.b.inputs["Base Color"])
    g.set(Roughness=0.9, Sheen_Weight=0.5)
    M["lining"] = g.m

    # ---------------- canvas overalls: faded olive-brown duck, weave, oil, mud caked up the legs
    g = G("RotCanvas")
    xyz = g.xyz()
    col = g.ramp(g.noise(4.0, 6, 0.6), [(0.35, (0.03, 0.04, 0.055)), (0.55, (0.06, 0.075, 0.095)), (0.72, (0.1, 0.115, 0.13))])
    geo = g.node("ShaderNodeNewGeometry")
    col = g.mix(g.math("MULTIPLY", g.mr(geo.outputs["Pointiness"], 0.5, 0.56), 0.4), col, (0.16, 0.17, 0.18))
    oil = g.mr(g.noise(2.5, 5, 0.6), 0.6, 0.7)
    col = g.mix(g.math("MULTIPLY", oil, 0.7), col, (0.03, 0.028, 0.022))
    zmud = g.math("ADD", xyz[2], g.math("MULTIPLY", g.noise(5, 4), 0.12))
    wetm = g.mr(zmud, 0.3, 0.12)
    drym = g.math("MULTIPLY", g.mr(zmud, 0.58, 0.36), g.mr(g.noise(11, 4), 0.3, 0.45))
    col = g.mix(drym, col, (0.13, 0.1, 0.068))
    col = g.mix(wetm, col, (0.055, 0.04, 0.028))
    col = g.mix(g.math("MULTIPLY", g.mr(g.ao(0.04), 0.4, 0.95, 1.0, 0.0), 0.75), col, (0.02, 0.018, 0.014))
    g.link(col, g.b.inputs["Base Color"])
    g.link(g.math("SUBTRACT", g.math("ADD", 0.82, g.math("MULTIPLY", drym, 0.1)), g.math("MULTIPLY", wetm, 0.5)), g.b.inputs["Roughness"])
    g.set(Sheen_Weight=0.3)
    wv = g.node("ShaderNodeTexWave", Scale=420.0)
    wv.bands_direction = "X"
    g.link(g.co, wv.inputs["Vector"])
    wv2 = g.node("ShaderNodeTexWave", Scale=420.0)
    wv2.bands_direction = "Z"
    g.link(g.co, wv2.inputs["Vector"])
    g.bump(g.math("ADD", g.math("ADD", wv.outputs["Fac"], wv2.outputs["Fac"]), g.math("MULTIPLY", g.math("ADD", drym, wetm), 1.5)), 0.12, 0.0008)
    M["canvas"] = g.m
    g = G("RotEar")
    col = g.ramp(g.noise(40.0, 6, 0.65), [(0.4, (0.055, 0.06, 0.045)), (0.6, (0.13, 0.13, 0.1))])
    col = g.mix(g.mr(g.noise(9.0, 3), 0.5, 0.65), col, (0.07, 0.045, 0.05))
    col = g.mix(g.math("MULTIPLY", g.mr(g.ao(0.02), 0.4, 0.95, 1.0, 0.0), 0.9), col, (0.02, 0.016, 0.012))
    g.link(col, g.b.inputs["Base Color"])
    g.set(Roughness=0.55)
    g.bump(g.noise(300, 3), 0.25, 0.0005)
    M["ear"] = g.m
    g = G("RotShirt")
    col = g.ramp(g.noise(6.0, 6, 0.6), [(0.35, (0.14, 0.13, 0.1)), (0.55, (0.26, 0.24, 0.185)), (0.72, (0.34, 0.31, 0.24))])
    col = g.mix(g.math("MULTIPLY", g.mr(g.noise(2.5, 5), 0.55, 0.66), 0.6), col, (0.12, 0.095, 0.055))
    col = g.mix(g.math("MULTIPLY", g.mr(g.ao(0.03), 0.4, 0.95, 1.0, 0.0), 0.8), col, (0.03, 0.025, 0.018))
    g.link(col, g.b.inputs["Base Color"])
    g.set(Roughness=0.88, Sheen_Weight=0.4)
    wv = g.node("ShaderNodeTexWave", Scale=520.0)
    wv.bands_direction = "X"
    g.link(g.co, wv.inputs["Vector"])
    g.bump(wv.outputs["Fac"], 0.04, 0.0003)
    M["shirt"] = g.m
    g = G("RotCanvasIn")
    g.set(Base_Color=(0.05, 0.045, 0.035), Roughness=0.9)
    M["canvas_in"] = g.m

    # ---------------- boot / sole / laces / brass
    g = G("RotBoot")
    xyz = g.xyz()
    col = g.ramp(g.noise(7, 6), [(0.4, (0.022, 0.016, 0.012)), (0.6, (0.06, 0.042, 0.03))])
    geo = g.node("ShaderNodeNewGeometry")
    col = g.mix(g.mr(geo.outputs["Pointiness"], 0.5, 0.56), col, (0.16, 0.12, 0.085))
    mud = g.mr(g.math("ADD", xyz[2], g.math("MULTIPLY", g.noise(9, 4), 0.07)), 0.15, 0.06)
    col = g.mix(mud, col, (0.1, 0.075, 0.05))
    g.link(col, g.b.inputs["Base Color"])
    g.link(g.math("ADD", 0.42, g.math("MULTIPLY", mud, 0.4)), g.b.inputs["Roughness"])
    g.set(Coat_Weight=0.2, Coat_Roughness=0.3)
    g.bump(g.noise(150, 4), 0.2, 0.0008)
    M["boot"] = g.m
    g = G("RotRubber")
    g.link(g.mix(g.mr(g.noise(9, 4), 0.4, 0.6), (0.02, 0.018, 0.016), (0.09, 0.07, 0.05)), g.b.inputs["Base Color"])
    g.set(Roughness=0.8)
    M["rubber"] = g.m
    g = G("RotLace")
    g.set(Base_Color=(0.12, 0.095, 0.06), Roughness=0.85)
    M["lace"] = g.m
    g = G("RotBrass")
    ox = g.mr(g.noise(25, 5), 0.42, 0.62)
    g.link(g.mix(ox, (0.42, 0.3, 0.13), (0.07, 0.07, 0.05)), g.b.inputs["Base Color"])
    g.link(g.math("SUBTRACT", 1.0, ox), g.b.inputs["Metallic"])
    g.link(g.math("ADD", 0.35, g.math("MULTIPLY", ox, 0.5)), g.b.inputs["Roughness"])
    M["brass"] = g.m
    M["thread"] = M["canvas"]
    return M


def mat_concrete():
    g = G("RotConcrete")
    xyz = g.xyz()
    col = g.ramp(g.noise(1.6, 8, 0.6), [(0.35, (0.045, 0.043, 0.04)), (0.55, (0.09, 0.086, 0.078)), (0.75, (0.13, 0.125, 0.115))])
    stain = g.mr(g.noise(0.7, 4), 0.55, 0.7)
    col = g.mix(g.math("MULTIPLY", stain, 0.7), col, (0.03, 0.028, 0.024))
    crk = g.math("MULTIPLY", g.mr(g.voronoi(1.4, "DISTANCE_TO_EDGE"), 0.0, 0.004, 1.0, 0.0), g.mr(g.noise(1.2, 3), 0.55, 0.65))
    col = g.mix(g.math("MULTIPLY", crk, 0.6), col, (0.015, 0.014, 0.013))
    wet = g.math("MULTIPLY", g.mr(g.noise(0.9, 5, 0.6, 0.3), 0.52, 0.6), g.mr(xyz[2], 0.02, 0.0))
    col = g.mix(g.math("MULTIPLY", wet, 0.5), col, (0.02, 0.02, 0.02))
    board = g.node("ShaderNodeTexWave", Scale=3.2, Distortion=1.5)
    board.bands_direction = "Z"
    g.link(g.co, board.inputs["Vector"])
    wall = g.mr(xyz[2], 0.3, 0.6)
    col = g.mix(g.math("MULTIPLY", g.math("MULTIPLY", g.mr(board.outputs["Fac"], 0.9, 1.0), wall), 0.6), col, (0.02, 0.02, 0.02))
    g.link(col, g.b.inputs["Base Color"])
    g.link(g.math("SUBTRACT", g.mr(g.noise(6, 4), 0.3, 0.7, 0.6, 0.9), g.math("MULTIPLY", wet, 0.72)), g.b.inputs["Roughness"])
    g.bump(g.math("ADD", g.noise(40, 6), g.math("MULTIPLY", crk, -0.4)), 0.2, 0.004)
    return g.m


# =========================================================================== skin masks

def mask_fn_factory(Mh):
    Mi = Mh.inverted()
    gash = STATE.get("gash", [])

    def seg_dist(p):
        best = 1.0
        for q in gash:
            best = min(best, (p - q).length)
        return best

    def head_mask(co, n):
        c = Mi @ co
        dg = seg_dist(co)
        dgn = dg + 0.0025 * fbm(co, 400, 2, 66)
        wound = 1.0 - sstep(0.0018, 0.0055, dgn)
        bruise = 0.8 * (1.0 - sstep(0.004, 0.02, dgn))
        wet = wound
        # dark sunken eye rings and red lid rims
        for sx in (1, -1):
            de = math.hypot((c.x - sx * EYE.x) / 1.3, c.z - EYE.z)
            if c.y < -0.06:
                bruise = max(bruise, 1.0 * (1 - sstep(0.014, 0.034, de)))
                rim = 1 - sstep(0.0, 0.004, abs(de - 0.0135))
                wound = max(wound, 0.12 * rim)
                wet = max(wet, rim)
        # lips wet, cracked; nostrils
        dm = math.hypot((c.x - MOUTH_C.x) / 1.5, (c.z - MOUTH_C.z) * 1.2)
        if c.y < -0.07:
            wet = max(wet, 1 - sstep(0.012, 0.022, dm))
            wound = max(wound, 0.3 * (1 - sstep(0.008, 0.02, dm)))
        if c.y < -0.06 and -0.125 < c.z < -0.07 and abs(c.x) < 0.032:
            streak = fbm(V((c.x * 90, 0, c.z * 12)), 1.0, 2, 67)
            wound = max(wound, 0.55 * max(0.0, streak + 0.1) * (1 - sstep(0.02, 0.032, abs(c.x))) * sstep(-0.125, -0.085, c.z))
        bruise = max(bruise, 0.9 * max(0.0, fbm(co, 9, 3, 61) - 0.25))
        if abs(c.x) > 0.063 and -0.045 < c.z < 0.03 and -0.01 < c.y < 0.045:   # ears: grimy, livid
            bruise = max(bruise, 0.55)
            wet = 0.0
        dirt = max(0.0, fbm(co, 6, 3, 62) - 0.1) * 0.8 + (0.45 if abs(c.x) > 0.063 and -0.045 < c.z < 0.03 else 0.0) + 0.4 * (1 - sstep(-0.06, 0.02, c.z)) * max(0.0, fbm(co, 20, 2, 63))
        return (min(1.0, wound), min(1.0, dirt), min(1.0, bruise), min(1.0, wet))

    def limb_mask(co, n):
        dirt = max(0.0, fbm(co, 8, 3, 64) + 0.05) * 0.9
        dirt = max(dirt, 1 - sstep(0.02, 0.14, co.z))
        bruise = 0.8 * max(0.0, fbm(co, 7, 3, 65) - 0.2)
        return (0.0, min(1.0, dirt), min(1.0, bruise), 0.0)

    def hand_mask(tipdirt):
        def fn(co, n):
            w, d, b, wt = limb_mask(co, n)
            return (w, min(1.0, d + tipdirt(co)), b, wt)
        return fn
    return head_mask, limb_mask, hand_mask


def assign_bust(bust, Mh, M):
    kit.assign(bust, M["skin"], M["mouth"], M["socket"])
    Mi = Mh.inverted()
    for p in bust.data.polygons:
        c = Mi @ p.center
        dm = ((c.x - MOUTH_C.x) / MOUTH_R[0]) ** 2 + ((c.y - MOUTH_C.y) / MOUTH_R[1]) ** 2 + ((c.z - MOUTH_C.z) / MOUTH_R[2]) ** 2
        if dm < 1.08 and c.y > -0.086:
            p.material_index = 1
            continue
        for sx in (1, -1):
            de = ((c.x - sx * EYE.x) / 0.0138) ** 2 + ((c.y - EYE.y) / 0.02) ** 2 + ((c.z - EYE.z) / 0.0074) ** 2
            if de < 1.05 and c.y > -0.08:
                p.material_index = 2


# =========================================================================== build

def build():
    t0 = time.time()
    M = materials()
    root = kit.empty("ZOMBIE")
    J, B = skeleton()
    Mh = head_matrix(J)
    STATE["Mh"] = Mh
    body = build_body(J, B, root)
    kit.assign(body, M["skin"])
    log("body", len(body.data.vertices))
    bust = build_bust(J, Mh, root)
    assign_bust(bust, Mh, M)
    log("bust sculpted")
    eyes, teeth, gums = build_face_bits(bust, Mh, root, M)
    ears = kit.join(build_ears(Mh, root), "Ears")
    kit.assign(ears, M["ear"])
    shirt = build_shirt(bust, J, Mh, root, M)
    hands = [build_hand(J, "L", 1, root, M), build_hand(J, "R", -1, root, M)]
    log("hands")
    foot, toenails = build_foot(J, root, M)
    boot, sole, eyelets, laces = build_boot(J, root, M)
    log("foot + boot")
    overalls, closed = build_overalls(J, root, M)
    log("overalls")
    straps, buckles = build_straps(J, root, M, shirt, body, closed)
    proxy = kit.join([copy_obj(body, "px1"), copy_obj(bust, "px2"), closed], "ClothProxy")
    kit.remesh(proxy, 0.012)
    jacket, edge = build_jacket(J, root, M, [proxy])
    bpy.data.objects.remove(proxy, do_unlink=True)
    log("jacket")
    collar = build_collar(J, root, M, jacket, edge)
    log("collar")
    head_mask, limb_mask, hand_mask = mask_fn_factory(Mh)
    paint_mask(bust, head_mask)
    paint_mask(body, limb_mask)
    paint_mask(foot, limb_mask)
    for (hand, nail), s in zip(hands, "LR"):
        wr, f, nrm, a = STATE[f"hand.{s}"]
        paint_mask(hand, hand_mask(lambda co, wr=wr, f=f: 0.6 * sstep(0.07, 0.13, (co - wr).dot(f))))
    if not FAST:
        build_hair(bust, Mh, root, M)
        build_threads([overalls], root, M["thread"], seed=3, every=3, zmax=0.5)
        build_threads([jacket], root, M["lining"], seed=5, every=3, zmax=0.95)
        try:
            build_flaps(overalls, root, M)
        except Exception as e:
            log("flaps failed:", e)
    log("build done in %.1fs" % (time.time() - t0))
    for o in kit.descendants(root):
        if o.type == "MESH":
            o.data.update()
    return root


# =========================================================================== stage + render

_render_to = kit.render_to


def render_to(path):
    sc = bpy.context.scene
    if FINAL:
        sc.cycles.samples = 40 if "turntable" in path else 128
    return _render_to(path)


kit.render_to = render_to


def stage(root):
    sc = bpy.context.scene
    kit.render_setup("CYCLES", (900, 1200), 128 if FINAL else 20, view="AgX", exposure=0.0)
    for lk in ("AgX - Medium High Contrast", "Medium High Contrast", "AgX - Punchy", "Punchy"):
        try:
            sc.view_settings.look = lk
            break
        except TypeError:
            continue
    log("look:", sc.view_settings.look)
    cy = sc.cycles
    cy.max_bounces = 8
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 4
    cy.transparent_max_bounces = 8
    cy.sample_clamp_indirect = 4.0
    cy.caustics_reflective = cy.caustics_refractive = False
    cy.adaptive_threshold = 0.02
    sc.render.use_persistent_data = True
    kit.world((0.003, 0.0035, 0.005), 1.0)
    kit.backdrop(mat_concrete(), width=10, depth=7, height=5, radius=1.2, y_back=2.4)
    # warm caged bulb ~0.75 m in front of the chest and ~0.9 m above the head: rakes down face and chest
    kit.point("Bulb", (0.05, -0.95, 2.5), power=105, radius=0.012, color=(1.0, 0.62, 0.33))
    kit.area("Rim", (-1.1, 1.5, 2.1), (0, 0, 1.3), 55, 0.8, (0.45, 0.6, 1.0))
    kit.area("Rim2", (1.3, 1.3, 1.6), (0, 0, 1.1), 18, 0.8, (0.5, 0.62, 0.9))
    kit.area("Bounce", (0.0, -0.55, 0.03), (0.0, -0.3, 1.3), 9, 1.4, (1.0, 0.68, 0.42))   # warm floor bounce
    kit.area("Fill", (0.5, -4.2, 1.35), (0, 0, 1.0), 16, 2.5, (0.6, 0.7, 0.9))           # faint cool camera-side fill
    views = OPTS["views"] or []
    close = [v for v in views if v in ("face", "face_front", "face_side", "hand", "feet")]
    cam = kit.camera(lens=55)
    if close:
        v = close[0]
        rz = Matrix.Rotation(math.radians(kit.VIEWS[v]), 4, "Z")
        if v.startswith("face"):
            tgt = rz @ STATE["Mh"].translation
            dist, lens = 1.25, 100
        elif v == "hand":
            tgt = rz @ STATE["hand.L"][0]
            dist, lens = 1.0, 85
        else:
            tgt = rz @ V((0.0, -0.02, 0.15))
            dist, lens = 1.6, 70
        cam.data.lens = lens
        cam.location = tgt + V((0, -dist, dist * 0.08))
        kit._aim(cam, tgt)
    else:
        kit.frame_to(cam, root, margin=1.16, aim_frac=0.5, elev=0.08)


def post(path):
    import numpy as np

    def fn(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        u = xx / w - 0.5
        v = yy / h - 0.5
        r = np.sqrt((u * 1.1) ** 2 + (v * 0.85) ** 2)
        vig = 1.0 - 0.5 * np.clip((r - 0.22) / 0.5, 0, 1) ** 1.5
        rgb = a[..., :3] * vig[..., None]
        glow = np.exp(-((u - 0.02) ** 2) / 0.05 - ((v + 0.6) ** 2) / 0.1) * 0.035
        rgb = rgb + glow[..., None] * np.array([1.0, 0.7, 0.42], np.float32)
        rng = np.random.default_rng(11)
        for _ in range(70):
            cx = rng.normal(0.52, 0.16) * w
            cyy = rng.uniform(0.0, 0.6) * h
            rad = rng.uniform(0.6, 1.8) * w / 900
            b = rng.uniform(0.04, 0.2) * np.exp(-((cx / w - 0.52) ** 2) / 0.05)
            x0, x1 = int(max(0, cx - 6)), int(min(w, cx + 7))
            y0, y1 = int(max(0, cyy - 6)), int(min(h, cyy + 7))
            if x1 <= x0 or y1 <= y0:
                continue
            gy, gx = np.mgrid[y0:y1, x0:x1]
            spot = np.exp(-((gx - cx) ** 2 + (gy - cyy) ** 2) / (2 * rad * rad)) * b
            rgb[y0:y1, x0:x1] += spot[..., None] * np.array([1.0, 0.8, 0.6], np.float32)
        grain = np.random.default_rng(abs(hash(os.path.basename(path))) % (2 ** 32)).normal(0, 0.011, (h, w)).astype(np.float32)
        rgb = rgb + grain[..., None]
        a[..., :3] = np.clip(rgb, 0, 1)
        return a
    kit.numpy_post(path, fn)


kit.run("rot", build, stage, post)
