"""The Long Dead (ink): a tall, gaunt zombie rendered as a black-and-cream woodcut print.

Nine heads tall (~2.3 m), hunched, arms hanging past the knees with long clawed
fingers, a tattered greatcoat, tall laced boots, a skull face with a gaping jaw.

Techniques
  skin      Skin modifier body (torso, limbs) and separate skin-modifier hands
            (bony metacarpals, knuckled fingers)
  sculpt    kit.Sculpt: skull face (sockets, brow, cheekbones, nasal cavity,
            gaping mouth, long jaw), ribs, sternum, collarbones, sunken belly,
            elbow knobs; boots (ankle creases)
  cloth     greatcoat + sleeves, then a shoulder cape, each pre-cut into strips
            (split slits, tapered, ragged edges, moth holes) and draped over the
            body under a tilted, gusting gravity vector so the free tatters blow
            back (baked + applied). Force fields had no effect on this cloth in
            5.2 here, so gravity carries the "wind".
  soft body wrist-rag tails sag under gravity (goal-weighted, baked + applied)
  shading   Eevee: Diffuse -> Shader to RGB -> light value (x AO, x facing) is
            compared against gouged parallel lines laid along the form (a
            per-vertex "hatch" coordinate: rings round limbs, lines down the
            coat); darker = thicker lines until they merge into solid black.
            Inverted-hull outlines. Blood-red emission for the eyes and drips.
  post      numpy: paper composite + grain, ragged ink edges, ink starvation
            flecks, red layer printed with misregistration and a soft glow.
"""
import os, sys, math, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
import numpy as np
from mathutils import Vector as V, Matrix, Euler, noise as mnoise
from mathutils.bvhtree import BVHTree

R = random.Random(1931)
RAW = os.environ.get("INK_RAW") == "1"          # debug: render the raw light value
RAWV = os.environ.get("INK_RAW") == "2"         # debug: render the ramp value v


def s2l(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


PAPER_S = (0.925, 0.890, 0.805)
INK_S = (0.070, 0.062, 0.060)
RED_S = (0.80, 0.05, 0.035)
PAPER, INK, RED = s2l(PAPER_S), s2l(INK_S), s2l(RED_S)


def sm01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# --------------------------------------------------------------------------- helpers

def bvh_world(obs):
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in obs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        off = len(verts)
        verts += [mw @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def push_out(p, bvh, clr):
    loc, nrm, idx, dist = bvh.find_nearest(p)
    if loc is None:
        return p
    d = (p - loc).dot(nrm)
    if d < clr:
        return p + nrm * (clr - d)
    return p


def set_hatch(ob, values):
    me = ob.data
    a = me.attributes.get("hatch") or me.attributes.new("hatch", "FLOAT", "POINT")
    a.data.foreach_set("value", np.asarray(values, dtype=np.float32))


def hatch_fn(ob, fn):
    set_hatch(ob, [fn(v.co) for v in ob.data.vertices])


def hatch_bones(ob, J, chains):
    """Per-vertex hatch coordinate from the nearest bone segment.
    chains: [(joint names, mode, ref vector, label)]; mode 'ring' = lines wrap
    round the limb (value = length along the chain), 'long' = lines run along it
    (value = angle round the bone x radius). Returns per-vertex labels."""
    segs = []
    for names, mode, ref, label in chains:
        s = R.uniform(0, 1)
        for a, b in zip(names, names[1:]):
            A, B = J[a][0], J[b][0]
            segs.append((A, B, s, mode, ref, label))
            s += (B - A).length
    P = np.array([v.co[:] for v in ob.data.vertices])
    A = np.array([s[0][:] for s in segs])
    Bm = np.array([s[1][:] for s in segs])
    AB = Bm - A
    L2 = np.maximum((AB ** 2).sum(1), 1e-9)
    AP = P[:, None, :] - A[None]
    t = np.clip((AP * AB[None]).sum(2) / L2, 0, 1)
    C = A[None] + t[..., None] * AB[None]
    d = np.linalg.norm(P[:, None, :] - C, axis=2)
    k = d.argmin(1)
    h = np.zeros(len(P))
    labels = []
    for i in range(len(P)):
        A_, B_, s0, mode, ref, label = segs[k[i]]
        ti = t[i, k[i]]
        if mode == "ring":
            h[i] = s0 + ti * (B_ - A_).length
        else:
            u = (B_ - A_).normalized()
            e1 = (V(ref) - u * u.dot(V(ref))).normalized()
            e2 = u.cross(e1)
            q = V(P[i]) - (A_ + (B_ - A_) * ti)
            h[i] = math.atan2(q.dot(e2), q.dot(e1)) * 0.07
        labels.append(label)
    set_hatch(ob, h)
    return labels


def join_all(objs, name):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    return kit.join(objs, name)


# --------------------------------------------------------------------------- materials

def ink_mat(name, albedo, freq=62.0, lo=0.085, hi=0.42, wob=0.45, jit=0.10, ao=0.6, edge=0.35, carve=0.0):
    """Woodcut ink: light value vs gouged parallel lines -> ink or paper."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    n = kit.Nodes(m)
    L = n.nt.links.new
    out = n.new("ShaderNodeOutputMaterial")
    dif = n.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (albedo, albedo, albedo, 1)
    s2r = n.new("ShaderNodeShaderToRGB")
    L(dif.outputs[0], s2r.inputs[0])
    bw = n.new("ShaderNodeRGBToBW")
    L(s2r.outputs["Color"], bw.inputs[0])
    lum = bw.outputs[0]

    def mth(op, a, b=None, c=None):
        nd = n.new("ShaderNodeMath")
        nd.operation = op
        for i, x in enumerate((a, b, c)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = x
            else:
                L(x, nd.inputs[i])
        return nd.outputs[0]

    if ao:
        aon = n.new("ShaderNodeAmbientOcclusion")
        aon.inputs["Distance"].default_value = 0.08
        lum = mth("MULTIPLY", lum, mth("MULTIPLY_ADD", aon.outputs["AO"], ao, 1 - ao))
    if edge:
        lw = n.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.5
        f = mth("POWER", lw.outputs["Facing"], 3.0)
        lum = mth("MULTIPLY", lum, mth("MULTIPLY_ADD", f, -edge, 1.0))
    geo = n.new("ShaderNodeNewGeometry")
    lum = mth("MULTIPLY", lum, mth("SUBTRACT", 1.0, geo.outputs["Backfacing"]))
    em = n.new("ShaderNodeEmission")
    L(em.outputs[0], out.inputs["Surface"])
    if RAW:
        L(lum, em.inputs["Color"])
        return m
    mr = n.new("ShaderNodeMapRange")
    mr.clamp = True
    L(lum, mr.inputs["Value"])
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    v = mr.outputs["Result"]
    tc = n.new("ShaderNodeTexCoord")
    nz = n.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 7.0
    nz.inputs["Detail"].default_value = 3.0
    L(tc.outputs["Object"], nz.inputs["Vector"])
    nz2 = n.new("ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 80.0
    nz2.inputs["Detail"].default_value = 2.0
    L(tc.outputs["Object"], nz2.inputs["Vector"])
    mid = mth("MULTIPLY", mth("MULTIPLY", v, mth("SUBTRACT", 1.0, v)), 4.0)
    v = mth("ADD", v, mth("MULTIPLY", mth("MULTIPLY_ADD", nz2.outputs["Fac"], 2 * jit, -jit), mid))
    if RAWV:
        L(v, em.inputs["Color"])
        return m
    if carve > 0:
        nz3 = n.new("ShaderNodeTexNoise")
        nz3.inputs["Scale"].default_value = 9.0
        nz3.inputs["Detail"].default_value = 4.0
        L(tc.outputs["Object"], nz3.inputs["Vector"])
        cm = n.new("ShaderNodeMapRange")
        cm.clamp = True
        L(nz3.outputs["Fac"], cm.inputs["Value"])
        cm.inputs["From Min"].default_value = 0.54
        cm.inputs["From Max"].default_value = 0.66
        cm.inputs["To Max"].default_value = 0.13 * carve
        front = mth("SUBTRACT", 1.0, geo.outputs["Backfacing"])
        v = mth("MAXIMUM", v, mth("MULTIPLY", cm.outputs["Result"], front))
    at = n.new("ShaderNodeAttribute")
    at.attribute_type = "GEOMETRY"
    at.attribute_name = "hatch"
    hh = mth("MULTIPLY_ADD", at.outputs["Fac"], freq, mth("MULTIPLY_ADD", nz.outputs["Fac"], 2 * wob, -wob))
    tri = mth("ABSOLUTE", mth("MULTIPLY_ADD", mth("FRACT", hh), 2.0, -1.0))
    paper = mth("LESS_THAN", tri, v)
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    L(paper, mix.inputs[0])
    mix.inputs[6].default_value = (*INK, 1)
    mix.inputs[7].default_value = (*PAPER, 1)
    L(mix.outputs[2], em.inputs["Color"])
    return m


def floor_mat():
    """Paper floor with a hatched ink pool under the feet (screen-space strokes)."""
    m = bpy.data.materials.get("InkFloor")
    if m:
        return m
    m = bpy.data.materials.new("InkFloor")
    n = kit.Nodes(m)
    L = n.nt.links.new

    def mth(op, a, b=None, c=None):
        nd = n.new("ShaderNodeMath")
        nd.operation = op
        for i, x in enumerate((a, b, c)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = x
            else:
                L(x, nd.inputs[i])
        return nd.outputs[0]

    out = n.new("ShaderNodeOutputMaterial")
    geo = n.new("ShaderNodeNewGeometry")
    sep = n.new("ShaderNodeSeparateXYZ")
    L(geo.outputs["Position"], sep.inputs[0])
    dx = mth("DIVIDE", sep.outputs["X"], 0.62)
    dy = mth("DIVIDE", mth("SUBTRACT", sep.outputs["Y"], 0.03), 0.34)
    d = mth("SQRT", mth("ADD", mth("MULTIPLY", dx, dx), mth("MULTIPLY", dy, dy)))
    vm = n.new("ShaderNodeVectorMath")
    vm.operation = "MULTIPLY"
    L(geo.outputs["Position"], vm.inputs[0])
    vm.inputs[1].default_value = (1.5, 11.0, 1.0)
    nz = n.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 3.0
    L(vm.outputs[0], nz.inputs["Vector"])
    d = mth("ADD", d, mth("MULTIPLY_ADD", nz.outputs["Fac"], 0.9, -0.45))
    mr = n.new("ShaderNodeMapRange")
    mr.clamp = True
    L(d, mr.inputs["Value"])
    mr.inputs["From Min"].default_value = 0.35
    mr.inputs["From Max"].default_value = 1.05
    v = mr.outputs["Result"]
    tc = n.new("ShaderNodeTexCoord")
    sw = n.new("ShaderNodeSeparateXYZ")
    L(tc.outputs["Window"], sw.inputs[0])
    nz2 = n.new("ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 3.0
    nz2.inputs["Detail"].default_value = 2.0
    L(geo.outputs["Position"], nz2.inputs["Vector"])
    hh = mth("MULTIPLY_ADD", sw.outputs["Y"], 190.0, mth("MULTIPLY_ADD", nz2.outputs["Fac"], 0.8, -0.4))
    tri = mth("ABSOLUTE", mth("MULTIPLY_ADD", mth("FRACT", hh), 2.0, -1.0))
    paper = mth("LESS_THAN", tri, v)
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    L(paper, mix.inputs[0])
    mix.inputs[6].default_value = (*INK, 1)
    mix.inputs[7].default_value = (*PAPER, 1)
    em = n.new("ShaderNodeEmission")
    L(mix.outputs[2], em.inputs["Color"])
    L(em.outputs[0], out.inputs["Surface"])
    return m


def mats():
    return {
        "skin": ink_mat("InkSkin", 0.85, lo=0.05, hi=0.30, ao=0.45),
        "bone": ink_mat("InkBone", 1.0, freq=110.0, lo=0.03, hi=0.34, ao=0.55, edge=0.3),
        "shirt": ink_mat("InkShirt", 0.30, carve=0.8),
        "pants": ink_mat("InkPants", 0.26, freq=70.0, carve=0.8),
        "coat": ink_mat("InkCoat", float(os.environ.get("INK_COAT", "0.31")), freq=55.0, ao=0.5, carve=1.0),
        "boot": ink_mat("InkBoot", 0.17, freq=80.0, carve=0.6),
        "lace": ink_mat("InkLace", 0.80, freq=40.0, ao=0.2, edge=0.1),
        "rag": ink_mat("InkRag", 0.55, freq=90.0),
        "hair": ink_mat("InkHair", 0.12, freq=50.0),
        "claw": ink_mat("InkClaw", 0.10, freq=120.0),
        "tooth": kit.emission_mat("InkToothLit", PAPER, 1.0),
        "void": kit.emission_mat("InkVoid", INK, 1.0),
        "red": kit.emission_mat("BloodRed", RED, 1.0),
        "eye": kit.emission_mat("EyeRed", (1.0, 0.02, 0.01), 1.0),
    }


def ol(ob, th):
    return kit.outline(ob, th, color=INK, name="InkOutline")


# --------------------------------------------------------------------------- skeleton

HEAD_R = 0.095
HEAD_C = V((0, -0.185, 2.175))
HEAD_ROT = Euler((math.radians(3), math.radians(-7), math.radians(5)), "XYZ").to_matrix()


def head_to_world(p):
    return HEAD_C + HEAD_ROT @ V(p)


def body_joints():
    J = {}

    def put(n, co, r):
        J[n] = [V(co), r if isinstance(r, tuple) else (r, r)]

    r = HEAD_R
    put("pelvis", (0, 0.03, 1.15), (0.125, 0.092))
    put("belly", (0, 0.045, 1.36), (0.076, 0.06))
    put("chest", (0, 0.025, 1.59), (0.112, 0.082))
    put("upchest", (0, -0.005, 1.79), (0.118, 0.075))
    put("neck", (0, -0.09, 1.975), 0.034)
    put("skull", head_to_world((0, 0.25 * r, -0.72 * r)), 0.03)
    arm = {"L": ((0.238, -0.035, 1.900), (0.335, 0.035, 1.345), (0.405, -0.02, 0.84)),
           "R": ((-0.238, -0.045, 1.892), (-0.33, 0.0, 1.335), (-0.415, -0.10, 0.835))}
    leg = {"L": ((0.115, -0.045, 0.605), (0.14, -0.05, 0.11)),
           "R": ((-0.115, 0.015, 0.60), (-0.135, 0.075, 0.11))}
    for s, sd in (("L", 1), ("R", -1)):
        sh, el, wr = (V(c) for c in arm[s])
        put(f"clav.{s}", (sd * 0.12, -0.03, 1.862), 0.034)
        put(f"shoulder.{s}", sh, 0.046)
        put(f"uarm.{s}", sh.lerp(el, 0.45), 0.033)
        put(f"elbow.{s}", el, 0.038)
        put(f"farm.{s}", el.lerp(wr, 0.28), 0.031)
        put(f"farm2.{s}", el.lerp(wr, 0.7), 0.025)
        put(f"wrist.{s}", wr, 0.022)
        hip = V((sd * 0.085, 0.03, 1.08))
        kn, an = V(leg[s][0]), V(leg[s][1])
        put(f"hip.{s}", hip, 0.086)
        put(f"thigh.{s}", hip.lerp(kn, 0.45), 0.080)
        put(f"knee.{s}", kn, 0.068)
        put(f"shin.{s}", kn.lerp(an, 0.4), 0.066)
        put(f"ankle.{s}", an, 0.048)
        put(f"foot.{s}", an + V((0, -0.08, -0.05)), 0.035)
    B = [("pelvis", "belly"), ("belly", "chest"), ("chest", "upchest"), ("upchest", "neck"), ("neck", "skull")]
    for s in "LR":
        B += [("upchest", f"clav.{s}"), (f"clav.{s}", f"shoulder.{s}"), (f"shoulder.{s}", f"uarm.{s}"),
              (f"uarm.{s}", f"elbow.{s}"), (f"elbow.{s}", f"farm.{s}"), (f"farm.{s}", f"farm2.{s}"),
              (f"farm2.{s}", f"wrist.{s}"), ("pelvis", f"hip.{s}"), (f"hip.{s}", f"thigh.{s}"),
              (f"thigh.{s}", f"knee.{s}"), (f"knee.{s}", f"shin.{s}"), (f"shin.{s}", f"ankle.{s}"),
              (f"ankle.{s}", f"foot.{s}")]
    return J, B


def sculpt_body(body, J):
    s = kit.Sculpt(body)
    t = BVHTree.FromBMesh(s.bm)

    def front(x, z):
        hit = t.ray_cast(V((x, -1.0, z)), V((0, 1, 0)))
        return hit[0]

    def proj(p):
        return t.find_nearest(V(p))[0]

    # ribs: grooves sloping down and out from the sternum
    for k in range(7):
        z0 = 1.80 - k * 0.042
        for sd in (-1, 1):
            pts = [front(sd * x, z0 - (x - 0.02) * 0.45) for x in (0.02, 0.045, 0.07, 0.095, 0.115)]
            pts = [p for p in pts if p is not None]
            if len(pts) > 1:
                s.crease_stroke(pts, 0.012, 0.0055)
    s.refresh()
    t = BVHTree.FromBMesh(s.bm)
    # sternum + collarbones
    s.inflate_stroke([front(0, 1.82), front(0, 1.62)], 0.012, 0.004)
    for sd in (-1, 1):
        s.inflate_stroke([proj((sd * 0.03, -0.09, 1.86)), proj((sd * 0.13, -0.08, 1.9)),
                          proj((sd * 0.22, -0.07, 1.95))], 0.014, 0.007)
    # sunken belly
    s.inflate(front(0, 1.38), 0.10, -0.022)
    # elbow knobs + forearm ridge
    for sd, side in ((1, "L"), (-1, "R")):
        el = J[f"elbow.{side}"][0]
        s.grab(proj(el + V((0, 0.06, 0))), 0.035, (0, 0.012, 0.004))
        wr = J[f"wrist.{side}"][0]
        a, b = proj(el.lerp(wr, 0.2) + V((sd * 0.05, 0, 0))), proj(el.lerp(wr, 0.9) + V((sd * 0.05, 0, 0)))
        s.inflate_stroke([a, b], 0.009, 0.003)
    # trouser folds: long creases down the legs, bunching at the knees and boot tops
    s.refresh()
    for side in ("L", "R"):
        hp, kn, an = J[f"hip.{side}"][0], J[f"knee.{side}"][0], J[f"ankle.{side}"][0]
        ax = (kn - hp).normalized()
        e1 = ax.cross(V((0, 0, 1)))
        e1 = (e1 if e1.length > 0.1 else V((1, 0, 0))).normalized()
        e2 = ax.cross(e1).normalized()
        for k in range(7):
            a = 2 * math.pi * k / 7 + R.uniform(-0.3, 0.3)
            off = (e1 * math.cos(a) + e2 * math.sin(a)) * 0.09
            p0 = hp.lerp(kn, R.uniform(0.1, 0.3)) + off
            p1 = kn.lerp(an, R.uniform(0.2, 0.6)) + off * 0.9
            s.crease_stroke([proj(p0), proj(hp.lerp(kn, 0.7) + off), proj(p1)], 0.014, R.uniform(0.004, 0.008))
        for z0 in (kn.z + 0.05, kn.z - 0.02, kn.z - 0.09, 0.47, 0.52):
            c = hp.lerp(an, (hp.z - z0) / (hp.z - an.z))
            ring = [proj(c + (e1 * math.cos(a) + e2 * math.sin(a)) * 0.1 + V((0, 0, R.uniform(-0.01, 0.01))))
                    for a in np.linspace(0, 2 * math.pi, 10)]
            s.crease_stroke(ring, 0.011, 0.005)
    s.noise(35, 0.0012)
    s.smooth(1, 0.3)
    s.done()
    kit.shade_smooth(body)


# --------------------------------------------------------------------------- head

def build_head(root, M):
    r = HEAD_R
    head = kit.quad_sphere("Head", r, 5, scale=(0.80, 0.95, 1.06))
    s = kit.Sculpt(head)
    # long, narrow jaw
    s.grab((0, -0.7 * r, -0.85 * r), 0.85 * r, (0, -0.12 * r, -0.80 * r))
    s.refresh()
    s.scale((0, -0.45 * r, -1.35 * r), 0.85 * r, (0.72, 0.95, 1.0))
    s.refresh()
    # flatten the face plane a touch
    s.flatten((0, -0.93 * r, -0.1 * r), 0.7 * r, (0, -1, 0), 0.25)
    s.refresh()

    def front(x, z):
        t = BVHTree.FromBMesh(s.bm)
        hit = t.ray_cast(V((x, -3 * r, z)), V((0, 1, 0)))[0]
        return hit if hit is not None else t.find_nearest(V((x, -1.2 * r, z)))[0]

    # brow ridge, cheekbones, temples, sunken cheeks
    s.inflate_stroke([front(-0.6 * r, 0.33 * r), front(0, 0.26 * r), front(0.6 * r, 0.33 * r)], 0.2 * r, 0.08 * r)
    for sd in (-1, 1):
        s.inflate(front(sd * 0.60 * r, -0.30 * r), 0.26 * r, 0.13 * r)
        s.inflate((sd * 0.74 * r, -0.30 * r, 0.25 * r), 0.40 * r, -0.16 * r)
        s.inflate(front(sd * 0.48 * r, -0.78 * r), 0.36 * r, -0.2 * r)
    s.refresh()
    # carve: eye sockets, nasal cavity, gaping mouth (tracked -> void material)
    before = [v.co.copy() for v in s.bm.verts]
    socket = {}
    for sd in (-1, 1):
        c = front(sd * 0.36 * r, 0.03 * r)
        socket[sd] = c.copy()
        s.inflate(c, 0.37 * r, -0.32 * r)
        s.inflate(c + V((0, 0.08 * r, 0)), 0.25 * r, -0.2 * r)
    nose = front(0, -0.34 * r)
    s.crease_stroke([nose + V((0, 0, 0.12 * r)), nose + V((0, 0, -0.05 * r))], 0.14 * r, 0.20 * r)
    mouth_top, mouth_bot = -0.92 * r, -1.52 * r
    zs = [mouth_top + (mouth_bot - mouth_top) * k / 4 for k in range(5)]
    for k, z in enumerate(zs):
        w = 0.34 * r * (1 - 0.35 * abs(k - 2) / 2)
        s.crease_stroke([front(-w, z), front(0, z), front(w, z)], 0.19 * r, 0.40 * r, kind="smooth")
    carve = [(before[i] - v.co).dot(s.normals[i]) for i, v in enumerate(s.bm.verts)]
    s.refresh()
    s.noise(60 / r * 0.1, 0.012 * r, ridged=True, seed=3)
    s.smooth(1, 0.25)
    s.done()
    # void faces
    me = head.data
    void_face = [sum(carve[vi] for vi in p.vertices) / len(p.vertices) > 0.14 * r for p in me.polygons]
    # lip edges for teeth / blood
    lip_top = [front_pt for front_pt in []]
    t = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])

    def fr(x, z):
        hit = t.ray_cast(V((x, -3 * r, z)), V((0, 1, 0)))[0]
        return hit if hit is not None else t.find_nearest(V((x, -1.2 * r, z)))[0]

    # teeth: upper and lower rows along the mouth rim, pointing into the gap
    teeth = []
    for row, z0, dz in (("up", mouth_top - 0.02 * r, -1), ("dn", mouth_bot + 0.04 * r, 1)):
        n = 7 if row == "up" else 6
        for k in range(n):
            if R.random() < 0.18:
                continue
            x = (-0.24 + 0.48 * k / (n - 1)) * r + R.uniform(-0.02, 0.02) * r
            p = fr(x, z0 + 0.06 * r * dz * -1)
            if p is None:
                continue
            base = p + V((0, 0.0, 0)) + V((0, 0, -dz * 0.06 * r))
            ln = R.uniform(0.26, 0.42) * r
            tip = base + V((R.uniform(-0.04, 0.04) * r, 0.02 * r, dz * ln))
            teeth.append(kit.tube("Tooth", [base, base.lerp(tip, 0.5), tip],
                                  [0.085 * r, 0.075 * r, 0.022 * r], segments=6))
    # eyes
    eyes = []
    for sd in (-1, 1):
        c = socket[sd] + V((0, 0.30 * r, -0.02 * r))
        eyes.append(kit.quad_sphere("Eye", 0.17 * r, 2, loc=c))
    # hatch: horizontal contour lines bowed round the skull
    hatch_fn(head, lambda co: co.z * 1.0 - 0.9 * (co.x * co.x) / r + 0.15 * co.y)
    for tt in teeth:
        hatch_fn(tt, lambda co: co.z)
    # lower-lip points (local) for blood drips
    lip = [fr(x * r, mouth_bot - 0.02 * r) for x in (-0.2, -0.04, 0.12, 0.22)]
    # to world
    parts = [head] + teeth + eyes
    for o in parts:
        o.data.transform(M)
        o.parent = root
    lip = [M @ p for p in lip if p is not None]
    return head, void_face, teeth, eyes, lip


# --------------------------------------------------------------------------- hands

def hand_graph(side, J, curl_mul=1.0):
    sd = 1 if side == "L" else -1
    wr, el = J[f"wrist.{side}"][0], J[f"elbow.{side}"][0]
    d = (wr - el).normalized()
    n0 = V((-sd * 0.72, -0.69, 0.0)).normalized()
    w = d.cross(n0).normalized()
    n = w.cross(d).normalized()
    if n.dot(n0) < 0:
        n = -n
    fwd = w if w.y < 0 else -w
    HJ, HB = {}, []

    def put(nm, co, rr):
        HJ[nm] = [V(co), (rr, rr)]

    put("wrist", wr, 0.022)
    put("carpal", wr + d * 0.028, 0.021)
    HB.append(("wrist", "carpal"))
    fingers = [(0.021, 0.26, 0.200, (6, 14, 24)),
               (0.007, 0.09, 0.228, (4, 12, 24)),
               (-0.008, -0.08, 0.210, (8, 16, 26)),
               (-0.021, -0.25, 0.170, (12, 20, 28))]
    tips = []
    chains = [(["wrist", "carpal"], "ring", None, "hand")]
    for k, (off, fan, ln, curls) in enumerate(fingers):
        mid = wr + d * 0.066 + fwd * off * 0.8 + n * 0.002
        kn = wr + d * 0.112 + fwd * off + n * 0.003
        put(f"m{k}", mid, 0.0085)
        put(f"k{k}", kn, 0.0124)
        HB += [("carpal", f"m{k}"), (f"m{k}", f"k{k}")]
        dir0 = (d + fwd * fan).normalized()
        ax = dir0.cross(n).normalized()
        p, ang, prev = kn, 0.0, f"k{k}"
        names = ["carpal", f"m{k}", f"k{k}"]
        for j, seg in enumerate((0.42, 0.33, 0.25)):
            ang += math.radians(curls[j] * curl_mul + R.uniform(-6, 6))
            dj = Matrix.Rotation(ang, 3, ax) @ dir0
            m_ = p + dj * ln * seg * 0.5
            e_ = p + dj * ln * seg
            put(f"f{k}{j}m", m_, (0.0078, 0.0068, 0.0055)[j])
            put(f"f{k}{j}e", e_, (0.0102, 0.0088, 0.005)[j])
            HB += [(prev, f"f{k}{j}m"), (f"f{k}{j}m", f"f{k}{j}e")]
            names += [f"f{k}{j}m", f"f{k}{j}e"]
            prev, p = f"f{k}{j}e", e_
        tips.append((p, Matrix.Rotation(ang + math.radians(25), 3, ax) @ dir0))
        chains.append((names, "ring", None, "hand"))
    # thumb
    t0 = wr + d * 0.03 + fwd * 0.026 + n * 0.012
    tdir = (d * 0.55 + fwd * 0.6 + n * 0.45).normalized()
    tax = tdir.cross(n).normalized()
    put("t0", t0, 0.012)
    HB.append(("carpal", "t0"))
    p, ang, prev = t0, 0.0, "t0"
    names = ["carpal", "t0"]
    for j, seg in enumerate((0.06, 0.05, 0.042)):
        ang += math.radians((18, 26, 24)[j] * curl_mul)
        dj = Matrix.Rotation(ang, 3, tax) @ tdir
        e_ = p + dj * seg
        put(f"t{j + 1}", e_, (0.0095, 0.0078, 0.0045)[j])
        HB.append((prev, f"t{j + 1}"))
        names.append(f"t{j + 1}")
        prev, p = f"t{j + 1}", e_
    tips.append((p, Matrix.Rotation(ang + math.radians(25), 3, tax) @ tdir))
    chains.append((names, "ring", None, "hand"))
    return HJ, HB, tips, chains


def build_hand(root, side, J, curl_mul):
    HJ, HB, tips, chains = hand_graph(side, J, curl_mul)
    hand = kit.skin_body(f"Hand.{side}", HJ, HB, parent=root, subdiv=2, branch_smooth=0.25)
    s = kit.Sculpt(hand)
    s.noise(90, 0.0006)
    s.done()
    hatch_bones(hand, HJ, chains)
    claws = []
    for p, dj in tips:
        dn = (dj + V((0, 0, -0.25))).normalized()
        c = kit.tube("Claw", [p - dj * 0.004, p + dj * 0.02, p + dj * 0.036 + dn * 0.016],
                     [0.0062, 0.0045, 0.0006], segments=8)
        hatch_fn(c, lambda co: co.z)
        claws.append(c)
    claw = join_all(claws, f"Claws.{side}")
    claw.parent = root
    return hand, claw


# --------------------------------------------------------------------------- boots

def build_boot(root, side, J):
    sd = 1 if side == "L" else -1
    an, kn = J[f"ankle.{side}"][0], J[f"knee.{side}"][0]
    ax = (kn - an).normalized()
    fc = V((an.x + sd * 0.004, an.y - 0.068, 0.06))
    foot = kit.quad_sphere("Foot", 1.0, 3)
    for v in foot.data.vertices:
        c = v.co.copy()
        toe = max(0.0, -c.y)
        v.co = fc + V((c.x * 0.056 * (1 + 0.12 * toe), c.y * 0.150, c.z * 0.062 * (1 - 0.18 * toe)))
    shaft = kit.tube("Shaft", [an - ax * 0.07, an, an + ax * 0.12, an + ax * 0.24, an + ax * 0.34],
                     [0.05, 0.05, 0.05, 0.056, 0.061], segments=20)
    boot = kit.join([foot, shaft], f"Boot.{side}")
    kit.remesh(boot, 0.006)
    for v in boot.data.vertices:
        if v.co.z < 0.018:
            v.co.z = 0.018
    s = kit.Sculpt(boot)
    for z in (0.14, 0.175, 0.21):
        c = an + ax * ((z - an.z) / ax.z)
        pts = [c + V((math.cos(a) * 0.06, math.sin(a) * 0.06, R.uniform(-0.006, 0.006)))
               for a in np.linspace(-0.2 * math.pi, 1.2 * math.pi, 9)]
        pts = [BVHTree.FromBMesh(s.bm).find_nearest(p)[0] for p in pts]
        s.crease_stroke(pts, 0.009, 0.0025)
    s.noise(40, 0.0012)
    s.smooth(2, 0.4)
    s.done()
    kit.shade_smooth(boot)
    boot.parent = root
    # sole
    sole = kit.quad_sphere("Sole", 1.0, 3)
    for v in sole.data.vertices:
        c = v.co.copy()
        v.co = fc + V((c.x * 0.064, c.y * 0.162 - 0.004, 0))
        v.co.z = max(0.0, 0.02 + c.z * 0.026)
    sole.parent = root
    # laces
    t = BVHTree.FromPolygons([v.co.copy() for v in boot.data.vertices], [list(p.vertices) for p in boot.data.polygons])
    eyes = []
    for k in range(9):
        z = 0.13 + k * 0.034
        c = an + ax * ((z - an.z) / ax.z)
        row = []
        for o in (-0.018, 0.018):
            hit = t.ray_cast(c + V((o, -0.3, 0)), V((0, 1, 0)))[0]
            row.append(hit + V((0, -0.004, 0)) if hit else None)
        eyes.append(row)
    laces = []
    for k in range(len(eyes) - 1):
        for a, b in ((eyes[k][0], eyes[k + 1][1]), (eyes[k][1], eyes[k + 1][0])):
            if a and b:
                mid = a.lerp(b, 0.5) + V((0, -0.004, 0))
                laces.append(kit.tube("Lace", [a, mid, b], 0.0032, segments=6))
    top = an + ax * 0.33
    ring = [top + V((math.cos(a) * 0.066, math.sin(a) * 0.066, 0.004 * math.sin(3 * a))) for a in np.linspace(0, 2 * math.pi, 25)]
    laces.append(kit.tube("Strap", ring, 0.007, segments=8))
    lace = join_all(laces, f"Laces.{side}")
    lace.parent = root
    hatch_fn(boot, lambda co: co.z * 1.0 + 0.3 * co.y)
    hatch_fn(sole, lambda co: co.y * 0.5)
    hatch_fn(lace, lambda co: co.x * 2.0)
    return boot, sole, lace


# --------------------------------------------------------------------------- coat + sleeves

COAT_PROFILE = [
    # z,    rx,    ry,    cy,     front opening (deg each side)
    (2.060, 0.098, 0.094, -0.078, 48),
    (2.020, 0.090, 0.087, -0.082, 45),
    (1.990, 0.112, 0.100, -0.070, 41),
    (1.955, 0.155, 0.118, -0.056, 37),
    (1.915, 0.200, 0.138, -0.042, 34),
    (1.875, 0.232, 0.152, -0.028, 32),
    (1.835, 0.226, 0.158, -0.018, 31),
    (1.790, 0.205, 0.160, -0.010, 31),
    (1.620, 0.212, 0.160, 0.010, 30),
    (1.450, 0.232, 0.168, 0.022, 29),
    (1.250, 0.240, 0.180, 0.034, 27),
    (1.000, 0.275, 0.215, 0.048, 25),
    (0.700, 0.325, 0.262, 0.064, 27),
    (0.400, 0.362, 0.305, 0.080, 30),
    (0.160, 0.378, 0.330, 0.090, 32),
]


def prof_at(z):
    P = COAT_PROFILE
    if z >= P[0][0]:
        return P[0][1:]
    for a, b in zip(P, P[1:]):
        if b[0] <= z <= a[0]:
            t = (a[0] - z) / (a[0] - b[0])
            t = t * t * (3 - 2 * t)
            return [x + (y - x) * t for x, y in zip(a[1:], b[1:])]
    return P[-1][1:]


def tatter(bm, grid_faces, NR, NC, slit_cols, slit_top_row, cut_choices, taper_rows=3, front_short=False, narrow=0.0):
    """Cut a (NR x NC face) grid into hanging strips: split slits, trim uneven
    lengths, taper strip ends to points. grid_faces[(i, j)] -> face (verts
    created as (i,j),(i+1,j),(i+1,j+1),(i,j+1)). Returns dead face keys."""
    cuts = []
    for j in slit_cols:
        for i in range(slit_top_row[j], NR):
            f = grid_faces.get((i, j))
            if f is None:
                continue
            a, b = f.verts[0], f.verts[1]            # (i,j) -> (i+1,j): the left edge of face (i, j)
            e = bm.edges.get((a, b))
            if e:
                cuts.append(e)
    bounds = [0] + list(slit_cols) + [NC]
    dead = set()
    tapers = []
    for j0, j1 in zip(bounds, bounds[1:]):
        ncut = R.choice(cut_choices)
        if front_short:                      # front panels shorter, back tails longer
            u = (j0 + j1) / 2 / NC
            frontness = abs(u - 0.5) * 2    # 1 at the front edges, 0 at the back
            ncut = int(ncut * (0.6 + 0.5 * frontness) + 3 * frontness ** 2)
        last = NR - 1 - ncut
        for i in range(last + 1, NR):
            for j in range(j0, j1):
                dead.add((i, j))
        tapers.append((j0, j1, last))
    bmesh.ops.split_edges(bm, edges=cuts)
    if narrow > 0:
        for j0, j1, last in tapers:
            rt = max(slit_top_row.get(j0, 0), slit_top_row.get(j1, 0))
            span = max(1, last + 1 - rt)
            for i in range(rt, last + 1):
                fac = narrow * ((i + 1 - rt) / span) ** 1.3
                vb = set()
                for j in range(j0, j1):
                    f = grid_faces.get((i, j))
                    if f is None or (i, j) in dead:
                        continue
                    vb.update((f.verts[1], f.verts[2]))
                if len(vb) < 2:
                    continue
                c = sum((v.co for v in vb), V()) / len(vb)
                for v in vb:
                    v.co = v.co.lerp(c, fac)
    for j0, j1, last in tapers:
        for k in range(taper_rows):
            i = last - k                     # face row whose bottom verts get pinched
            if i < 0:
                continue
            fac = 0.85 * (taper_rows - k) / taper_rows
            vb = set()
            for j in range(j0, j1):
                f = grid_faces.get((i, j))
                if f is None or (i, j) in dead:
                    continue
                vb.update((f.verts[1], f.verts[2]))
            if len(vb) < 2:
                continue
            c = sum((v.co for v in vb), V()) / len(vb)
            drop = 0.02 * (taper_rows - k) / taper_rows * R.uniform(0.3, 1.0)
            for v in vb:
                v.co = v.co.lerp(c, fac)
                v.co.z -= drop
    return dead


def rag_edges(bm, amount, zmax, seed=0):
    """Jitter every open-edge vertex within the surface so cuts, holes and hems tear raggedly."""
    bm.normal_update()
    off = V((seed * 3.1, seed * 1.7, seed * 5.3))
    for v in bm.verts:
        if v.co.z > zmax or not any(e.is_boundary for e in v.link_edges):
            continue
        rnd = V((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-1, 1)))
        rnd += V((mnoise.noise(v.co * 40 + off), mnoise.noise(v.co * 40 + off + V((9, 0, 0))), mnoise.noise(v.co * 40 + off + V((0, 9, 0)))))
        n = v.normal
        t = rnd - n * rnd.dot(n)
        v.co += t * amount * sm01((zmax - v.co.z) / 0.15)


def fix_normals(bm, outward_fn):
    bm.normal_update()
    score = sum(f.normal.dot(outward_fn(f.calc_center_median())) for f in bm.faces)
    if score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


def drop_islands(bm, keep_fn, min_faces=12):
    seen = set()
    kill = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, comp = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        if len(comp) < min_faces or not any(keep_fn(v.co) for g in comp for v in g.verts):
            kill += comp
    if kill:
        bmesh.ops.delete(bm, geom=list(set(kill)), context="FACES")


def build_coat(J, body):
    bvh = bvh_world([body])
    Z0, DZ, NR, NC = 2.05, 0.015, 126, 100
    grid = []
    for i in range(NR + 1):
        z = Z0 - i * DZ
        rx, ry, cy, op = prof_at(z)
        th0 = math.radians(op)
        A = 0.085 * sm01((1.62 - z) / 1.0)
        row = []
        for j in range(NC + 1):
            th = th0 + (2 * math.pi - 2 * th0) * j / NC
            f = 1 + A * (0.55 * math.sin(7 * th + 0.4) + 0.45 * math.sin(12 * th + 1.7 + 5 * z))
            f += 0.03 * mnoise.noise(V((th * 1.5, z * 3, 0.5)))
            row.append(V((rx * f * math.sin(th), cy - ry * f * math.cos(th), z)))
        grid.append(row)
    for it in range(5):
        grid = [[push_out(p, bvh, 0.024) for p in row] for row in grid]
        if it < 4:
            new = [[p.copy() for p in row] for row in grid]
            for i in range(1, NR):
                if grid[i][0].z < 1.6:
                    break
                for j in range(1, NC):
                    avg = (grid[i - 1][j] + grid[i + 1][j] + grid[i][j - 1] + grid[i][j + 1]) / 4
                    new[i][j] = grid[i][j].lerp(avg, 0.5)
            grid = new
    bm = bmesh.new()
    Vt = [[bm.verts.new(p) for p in row] for row in grid]
    F = {}
    for i in range(NR):
        for j in range(NC):
            F[(i, j)] = bm.faces.new((Vt[i][j], Vt[i + 1][j], Vt[i + 1][j + 1], Vt[i][j + 1]))
    slits, j = [], R.randint(3, 5)
    while j <= NC - 3:
        slits.append(j)
        j += R.randint(4, 8)
    top = {j: int((Z0 - R.uniform(0.66, 1.12)) / DZ) for j in slits}
    dead = tatter(bm, F, NR, NC, slits, top, [0, 1, 3, 4, 6, 8, 10, 13, 16, 19], taper_rows=5,
                  front_short=True, narrow=0.62)
    off = V((R.uniform(0, 50), R.uniform(0, 50), 7.3))
    for (i, j), f in F.items():
        if (i, j) in dead:
            continue
        c = f.calc_center_median()
        z = Z0 - i * DZ
        edge_col = min(abs(j - sj) for sj in slits + [0, NC - 1]) <= 1
        if z > 1.02:
            hole = mnoise.fractal(c * 10.0 + off, 0.6, 2.0, 3)
            if z < 1.62 and hole > 0.44:
                dead.add((i, j))
        elif not edge_col and 0.35 < z and R.random() < 0.02:
            dead.add((i, j))
        # ragged lapel / front edges
        z = Z0 - i * DZ
        if z < 1.78:
            depth = 2.0 + 4.0 * (0.5 + 0.5 * mnoise.noise(V((z * 7.0, 3.3 if j < NC / 2 else 8.1, 0)))) * sm01((1.78 - z) / 0.4)
            if j < depth or j >= NC - depth:
                dead.add((i, j))
    bmesh.ops.delete(bm, geom=[F[k] for k in dead], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.faces.ensure_lookup_table()
    drop_islands(bm, lambda co: co.z > 1.25)
    rag_edges(bm, 0.008, 1.75, 1)
    fix_normals(bm, lambda c: V((c.x, c.y - 0.02, 0)).normalized())
    coat = kit.mesh_obj("Coat", bm)
    hatch_fn(coat, lambda co: (math.atan2(co.x, -(co.y - 0.02)) % (2 * math.pi)) * 0.25 + 0.004 * math.sin(co.z * 9))
    kit.vgroup(coat, "pin", lambda co: sm01((co.z - float(os.environ.get("INK_PIN", "1.1"))) / 0.4))
    return coat


CAPE_PROFILE = [
    (2.075, 0.108, 0.100, -0.078, 52),
    (2.035, 0.118, 0.108, -0.074, 47),
    (1.985, 0.185, 0.150, -0.056, 41),
    (1.925, 0.285, 0.205, -0.036, 35),
    (1.845, 0.350, 0.245, -0.020, 31),
    (1.745, 0.390, 0.272, -0.004, 29),
    (1.585, 0.410, 0.292, 0.008, 27),
]


def build_cape(obs):
    """Tattered shoulder cape (greatcoat capelet): hides the sleeve roots and
    gives the sloped, gothic shoulder line."""
    global COAT_PROFILE
    bvh = bvh_world(obs)
    Z0, DZ, NR, NC = 2.075, 0.015, 33, 96
    keep = COAT_PROFILE
    COAT_PROFILE = CAPE_PROFILE
    grid = []
    for i in range(NR + 1):
        z = Z0 - i * DZ
        rx, ry, cy, op = prof_at(z)
        th0 = math.radians(op)
        A = 0.07 * sm01((1.95 - z) / 0.3)
        row = []
        for j in range(NC + 1):
            th = th0 + (2 * math.pi - 2 * th0) * j / NC
            f = 1 + A * (0.6 * math.sin(9 * th + 1.1) + 0.4 * math.sin(14 * th + 0.3 + 6 * z))
            row.append(V((rx * f * math.sin(th), cy - ry * f * math.cos(th), z)))
        grid.append(row)
    COAT_PROFILE = keep
    for it in range(4):
        grid = [[push_out(p, bvh, 0.02) for p in row] for row in grid]
        if it < 3:
            new = [[p.copy() for p in row] for row in grid]
            for i in range(1, NR):
                for j in range(1, NC):
                    avg = (grid[i - 1][j] + grid[i + 1][j] + grid[i][j - 1] + grid[i][j + 1]) / 4
                    new[i][j] = grid[i][j].lerp(avg, 0.4)
            grid = new
    bm = bmesh.new()
    Vt = [[bm.verts.new(p) for p in row] for row in grid]
    F = {}
    for i in range(NR):
        for j in range(NC):
            F[(i, j)] = bm.faces.new((Vt[i][j], Vt[i + 1][j], Vt[i + 1][j + 1], Vt[i][j + 1]))
    slits, j = [], R.randint(2, 4)
    while j <= NC - 3:
        slits.append(j)
        j += R.randint(3, 6)
    top = {j: int((Z0 - R.uniform(1.76, 1.86)) / DZ) for j in slits}
    dead = tatter(bm, F, NR, NC, slits, top, [0, 1, 2, 3, 4, 5, 6, 8], taper_rows=4, narrow=0.5)
    off = V((R.uniform(0, 50), R.uniform(0, 50), 0))
    for (i, j), f in F.items():
        if (i, j) in dead:
            continue
        c = f.calc_center_median()
        if 1.8 < c.z < 1.98 and mnoise.fractal(c * 12.0 + off, 0.6, 2.0, 3) > 0.5:
            dead.add((i, j))
    bmesh.ops.delete(bm, geom=[F[k] for k in dead], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    drop_islands(bm, lambda co: co.z > 1.9)
    rag_edges(bm, 0.007, 1.95, 3)
    fix_normals(bm, lambda c: V((c.x, c.y, 0)).normalized())
    cape = kit.mesh_obj("Cape", bm)
    hatch_fn(cape, lambda co: (math.atan2(co.x, -co.y) % (2 * math.pi)) * 0.32 + 0.003 * math.sin(co.z * 11))
    kit.vgroup(cape, "pin", lambda co: sm01((co.z - 1.80) / 0.14))
    return cape


def build_sleeve(side, J, body):
    bvh = bvh_world([body])
    sh, el, wr = J[f"shoulder.{side}"][0], J[f"elbow.{side}"][0], J[f"wrist.{side}"][0]
    sd = 1 if side == "L" else -1
    start = sh.lerp(el, 0.10)
    path = [start, sh.lerp(el, 0.5), el, el.lerp(wr, 0.72)]
    # resample the polyline
    lens = [0.0]
    for a, b in zip(path, path[1:]):
        lens.append(lens[-1] + (b - a).length)
    NR, NC = 28, 22

    def at(u):
        s = u * lens[-1]
        for k in range(len(path) - 1):
            if lens[k + 1] >= s:
                t = (s - lens[k]) / max(1e-6, lens[k + 1] - lens[k])
                return path[k].lerp(path[k + 1], t), (path[k + 1] - path[k]).normalized()
        return path[-1], (path[-1] - path[-2]).normalized()

    grid = []
    for i in range(NR + 1):
        u = i / NR
        c, tg = at(u)
        e1 = (V((0, 1, 0)) - tg * tg.y).normalized()
        e2 = tg.cross(e1)
        rad = 0.050 - 0.008 * math.sin(u * math.pi) + 0.014 * u
        row = []
        for j in range(NC + 1):
            a = 2 * math.pi * j / NC
            f = 1 + 0.14 * u * math.sin(5 * a + 1.3 * sd) + 0.05 * mnoise.noise(V((a, u * 4, sd)))
            row.append(c + (e1 * math.cos(a) + e2 * math.sin(a)) * rad * f)
        grid.append(row)
    grid = [[push_out(push_out(p, bvh, 0.011), bvh, 0.011) for p in row] for row in grid]
    bm = bmesh.new()
    Vt = []
    for row in grid:                      # closed tube: column NC is column 0
        vs = [bm.verts.new(p) for p in row[:NC]]
        Vt.append(vs + [vs[0]])
    F = {}
    for i in range(NR):
        for j in range(NC):
            F[(i, j)] = bm.faces.new((Vt[i][j], Vt[i + 1][j], Vt[i + 1][j + 1], Vt[i][j + 1]))
    slits = sorted(R.sample(range(1, NC - 1), 6))
    top = {j: int(NR * R.uniform(0.52, 0.62)) for j in slits}
    dead = tatter(bm, F, NR, NC, slits, top, [2, 5, 7, 8, 9, 9, 10, 10], taper_rows=3, narrow=0.45)
    bmesh.ops.delete(bm, geom=[F[k] for k in dead], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    rag_edges(bm, 0.007, 10.0, 2)
    axis_pts = [at(i / 40)[0] for i in range(41)]

    def outward(c):
        q = min(axis_pts, key=lambda p: (p - c).length)
        return (c - q).normalized()
    fix_normals(bm, outward)
    ob = kit.mesh_obj(f"Sleeve.{side}", bm)
    # hatch: lines running down the sleeve
    tg0 = (el - sh).normalized()
    e1 = (V((0, 1, 0)) - tg0 * tg0.y).normalized()
    e2 = tg0.cross(e1)

    def hs(co):
        q = co - sh
        return math.atan2(q.dot(e2), q.dot(e1)) * 0.07 + 0.3 * sd
    hatch_fn(ob, hs)
    total = lens[-1]
    kit.vgroup(ob, "pin", lambda co: 1.0 - sm01((((co - start).dot(tg0)) / total - 0.42) / 0.22))
    return ob


def drape(ob, colliders, frames=30, pin="pin", stiffness=12.0, bending=0.8, thickness=0.006, damping=1.0,
          gravity=(0.0, 0.0, -9.81)):
    """kit.drape_cloth with bending stiffness, air damping and a tilted gravity
    vector (a steady 'wind' that blows the free tatters back) exposed."""
    sc = bpy.context.scene
    g0 = tuple(sc.gravity)
    sc.gravity = gravity
    for c in colliders:
        kit.collider(c, thickness)
    m = ob.modifiers.new("Cloth", "CLOTH")
    st = m.settings
    st.quality = 8
    st.mass = float(os.environ.get("INK_MASS", "0.12"))
    st.tension_stiffness = st.compression_stiffness = stiffness
    st.bending_stiffness = bending
    st.air_damping = damping
    st.vertex_group_mass = pin
    cs = m.collision_settings
    cs.distance_min = thickness
    cs.use_self_collision = False
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    sc = bpy.context.scene
    sc.frame_end = max(sc.frame_end, frames)
    for f in range(1, frames + 1):
        gust = 1.0 + 0.45 * math.sin(f * 0.33 + 0.7)
        sc.gravity = (gravity[0] * gust, gravity[1] * gust, gravity[2])
        sc.frame_set(f)
    kit.apply_modifiers(ob)
    for c in colliders:
        for mm in list(c.modifiers):
            if mm.type == "COLLISION":
                c.modifiers.remove(mm)
    sc.frame_set(1)
    sc.gravity = g0
    return ob


# --------------------------------------------------------------------------- small parts

def build_wraps(root, side, J):
    sd = 1 if side == "L" else -1
    wr, el = J[f"wrist.{side}"][0], J[f"elbow.{side}"][0]
    d = (wr - el).normalized()
    e1 = d.cross(V((0, 0, 1)))
    if e1.length < 0.1:
        e1 = V((1, 0, 0))
    e1.normalize()
    e2 = d.cross(e1).normalized()
    loops = []
    for k in range(4):
        c = wr - d * (0.004 + k * 0.014)
        tilt = Matrix.Rotation(math.radians(R.uniform(-14, 14)), 3, e1)
        rr = 0.028 + 0.003 * k + R.uniform(-0.002, 0.002)
        pts = [c + tilt @ ((e1 * math.cos(a) + e2 * math.sin(a)) * rr) for a in np.linspace(0, 2 * math.pi, 28)]
        loops.append(kit.tube("Wrap", pts, 0.0058, segments=8))
    wrap = join_all(loops, f"Wraps.{side}")
    wrap.parent = root
    hatch_fn(wrap, lambda co: co.dot(d) * 1.0 + 0.2 * co.x)
    # dangling tail (soft body)
    base = wr - d * 0.03 + V((sd * 0.034, -0.01, 0))
    out = V((sd * 1.0, -0.35, 0.25)).normalized()
    side_ax = out.cross(V((0, 0, 1))).normalized()
    bm = bmesh.new()
    rows = []
    N = 14
    for i in range(N + 1):
        p = base + out * (0.13 * i / N)
        wdt = 0.011 * (1 - 0.6 * i / N)
        rows.append([bm.verts.new(p - side_ax * wdt), bm.verts.new(p + side_ax * wdt)])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    tail = kit.mesh_obj(f"RagTail.{side}", bm, parent=root)
    g = tail.vertex_groups.new(name="goal")
    for v in tail.data.vertices:
        t = (v.co - base).dot(out) / 0.13
        g.add([v.index], max(0.0, 1.0 - t * 3.5) if t > 0.05 else 1.0, "REPLACE")
    kit.softbody_sag(tail, "goal", frames=36, gravity=1.0, stiffness=0.3, damping=2.0)
    sol = tail.modifiers.new("Thick", "SOLIDIFY")
    sol.thickness = 0.003
    hatch_fn(tail, lambda co: co.z * 1.3)
    return wrap, tail


def grow_strand(p, dirn, length, bvhs, step=0.011):
    pts = [p.copy()]
    d = dirn.normalized()
    n = max(3, int(length / step))
    for k in range(n):
        d = (d * 0.8 + V((0, 0, -0.42)) + V((mnoise.noise(p * 22), mnoise.noise(p * 22 + V((5, 0, 0))), 0)) * 0.35).normalized()
        q = p + d * step
        for bvh, clr in bvhs:
            q = push_out(q, bvh, clr)
        p = q
        pts.append(p.copy())
    return pts


def build_hair(root, head, others):
    r = HEAD_R
    bvhs = [(bvh_world([head]), 0.007), (bvh_world(others), 0.009)]
    strands = []
    clumps = 22
    for c in range(clumps):
        phi = R.uniform(-2.5, 2.5)            # angle round the skull, 0 = back
        if abs(phi) > 1.95:
            phi = math.copysign(1.95, phi)
        el = R.uniform(-0.05, 0.62)
        ln = R.uniform(0.14, 0.34) if abs(phi) < 1.6 else R.uniform(0.12, 0.26)
        for s in range(R.randint(2, 3)):
            ph = phi + R.uniform(-0.12, 0.12)
            e = el + R.uniform(-0.06, 0.06)
            loc = V((math.sin(ph) * math.cos(e) * 0.80 * r, math.cos(ph) * math.cos(e) * 0.95 * r, math.sin(e) * 1.06 * r))
            nrm = V((loc.x / (0.8 * r) ** 2, loc.y / (0.95 * r) ** 2, loc.z / (1.06 * r) ** 2)).normalized()
            p = head_to_world(loc * 0.98)
            dirn = HEAD_ROT @ nrm
            pts = grow_strand(p, dirn * 0.5 + V((0, 0, -0.3)), ln * R.uniform(0.85, 1.1), bvhs)
            m = len(pts)
            radii = [0.0024 * (1 - 0.7 * k / (m - 1)) for k in range(m)]
            st = kit.tube("Strand", pts, radii, segments=5)
            L = 0.0
            hs = {}
            strands.append(st)
    hair = join_all(strands, "Hair")
    hair.parent = root
    hatch_fn(hair, lambda co: co.z * 1.5)
    return hair


def trace_drip(start, bvh, length, step=0.006, air=0.0, wander=0.0):
    pts = [start.copy()]
    p = start.copy()
    s = 0.0
    while s < length:
        q = p + V((mnoise.noise(p * 40) * wander, 0, -step))
        loc, nrm, idx, dist = bvh.find_nearest(q)
        if loc is not None and nrm.z < -0.55:           # leaving the underside: fall freely
            break
        if loc is not None:
            q = loc + nrm * 0.0025
        pts.append(q)
        p = q
        s += step
    if air > 0:
        pts.append(p + V((0, 0, -air * 0.5)))
        pts.append(p + V((0, 0, -air)))
    return pts


def build_blood(root, head, body, lip):
    hb = bvh_world([head])
    bb = bvh_world([body])
    drips = []
    for k, p in enumerate(lip):
        pts = trace_drip(p + V((0, -0.002, 0)), hb, R.uniform(0.03, 0.08), air=R.choice([0.0, 0.03, 0.06, 0.1]))
        if len(pts) < 2:
            continue
        m = len(pts)
        radii = [0.0042 - 0.0012 * k2 / m for k2 in range(m)]
        radii[-1] = 0.0015
        drips.append(kit.tube("Drip", pts, radii, segments=8))
        drips.append(kit.quad_sphere("Drop", 0.0058, 2, loc=pts[-1] + V((0, 0, 0.002)), scale=(1, 1, 1.5)))
    # a few runs down the bare chest
    for x, z, ln in ((-0.03, 1.875, 0.06), (0.018, 1.845, 0.13)):
        hit = bb.ray_cast(V((x, -1, z)), V((0, 1, 0)))[0]
        if hit is None:
            continue
        pts = trace_drip(hit + V((0, -0.002, 0)), bb, ln, wander=0.006)
        if len(pts) < 3:
            continue
        m = len(pts)
        drips.append(kit.tube("Run", pts, [0.0035 * (1 - 0.35 * i / m) for i in range(m)], segments=8))
        drips.append(kit.quad_sphere("Drop", 0.0048, 2, loc=pts[-1], scale=(1, 0.8, 1.4)))
    blood = join_all(drips, "Blood")
    blood.parent = root
    return blood


# --------------------------------------------------------------------------- build

_T = [time.time()]


def tick(label):
    now = time.time()
    print(f"[ink] {label}: {now - _T[0]:.1f}s")
    _T[0] = now


def build():
    _T[0] = time.time()
    root = kit.empty("LONG_DEAD")
    M = mats()
    J, B = body_joints()
    body = kit.skin_body("Body", J, B, parent=root, subdiv=2, branch_smooth=0.4)
    sculpt_body(body, J)
    tick("body")
    Mh = Matrix.Translation(HEAD_C) @ HEAD_ROT.to_4x4()
    head, void_face, teeth, eyes, lip = build_head(root, Mh)

    hands, claws = [], []
    for side, cm in (("L", 1.0), ("R", 1.35)):
        h, c = build_hand(root, side, J, cm)
        hands.append(h)
        claws.append(c)
    tick("head+hands")
    boots = [build_boot(root, s, J) for s in "LR"]
    tick("boots")

    # coat + sleeves: pre-cut strips, one cloth sim with wind
    coat = build_coat(J, body)
    sleeves = [build_sleeve(s, J, body) for s in "LR"]
    coat = kit.join([coat] + sleeves, "Coat")
    coat.parent = root
    tick("coat mesh")
    wy = float(os.environ.get("INK_WIND", "2.8"))
    drape(coat, [body] + hands, frames=32, stiffness=12.0, bending=float(os.environ.get('INK_BEND', '0.3')),
          gravity=(-wy * 0.2, wy, -9.81))
    kit.shade_smooth(coat)
    tick("cloth sim")
    cape = build_cape([body, coat])
    cape.parent = root
    drape(cape, [body, coat] + hands, frames=24, stiffness=12.0, bending=0.4, gravity=(-wy * 0.2, wy, -9.81))
    kit.shade_smooth(cape)
    for o in (coat, cape):
        th = o.modifiers.new("Thick", "SOLIDIFY")
        th.thickness = 0.006
        th.offset = -1.0

    tick("cape sim")
    wraps = [build_wraps(root, s, J) for s in "LR"]
    hair = build_hair(root, head, [body, coat, cape])
    blood = build_blood(root, head, body, lip)

    tick("wraps/hair/blood")
    # ---- materials + hatch
    labels = hatch_bones(body, J, [
        (["pelvis", "belly", "chest"], "long", (0, -1, 0), "torso"),
        (["chest", "upchest", "neck", "skull"], "ring", None, "torso"),
        (["upchest", "clav.L", "shoulder.L"], "ring", None, "torso"),
        (["upchest", "clav.R", "shoulder.R"], "ring", None, "torso"),
        (["shoulder.L", "uarm.L", "elbow.L"], "ring", None, "uarm"),
        (["shoulder.R", "uarm.R", "elbow.R"], "ring", None, "uarm"),
        (["elbow.L", "farm.L", "farm2.L", "wrist.L"], "ring", None, "farm"),
        (["elbow.R", "farm.R", "farm2.R", "wrist.R"], "ring", None, "farm"),
        (["pelvis", "hip.L", "thigh.L", "knee.L", "shin.L", "ankle.L", "foot.L"], "long", (0.3, -1, 0), "leg"),
        (["pelvis", "hip.R", "thigh.R", "knee.R", "shin.R", "ankle.R", "foot.R"], "long", (-0.3, -1, 0), "leg"),
    ])
    kit.assign(body, M["skin"], M["shirt"], M["pants"])
    me = body.data
    vlab = labels
    for p in me.polygons:
        c = p.center
        labs = [vlab[i] for i in p.vertices]
        lab = max(set(labs), key=labs.count)
        idx = 0
        if lab == "leg":
            idx = 2
        elif lab in ("torso", "uarm"):
            idx = 1
            vx = 0.03 + (1.93 - c.z) * 0.42
            if c.z > 1.93 or (c.z > 1.50 and abs(c.x) < 0.115 * ((c.z - 1.50) / 0.43) ** 1.3 and c.y < 0):
                idx = 0
        p.material_index = idx
    kit.assign(head, M["bone"], M["void"])
    for p, v in zip(head.data.polygons, void_face):
        p.material_index = 1 if v else 0
    for o in teeth:
        kit.assign(o, M["tooth"])
    tooth = join_all(teeth, "Teeth") if teeth else None
    if tooth:
        tooth.parent = root
    for e in eyes:
        kit.assign(e, M["eye"])
    eye = join_all(eyes, "Eyes")
    eye.parent = root
    for h in hands:
        kit.assign(h, M["skin"])
    for c in claws:
        kit.assign(c, M["claw"])
    for boot, sole, lace in boots:
        kit.assign(boot, M["boot"])
        kit.assign(sole, M["boot"])
        kit.assign(lace, M["lace"])
    kit.assign(coat, M["coat"])
    kit.assign(cape, M["coat"])
    for w, t in wraps:
        kit.assign(w, M["rag"])
        kit.assign(t, M["rag"])
    kit.assign(hair, M["hair"])
    kit.assign(blood, M["red"])

    # ---- outlines
    ol(body, 0.0075)
    ol(head, 0.0055)
    for h in hands:
        ol(h, 0.0032)
    for c in claws:
        ol(c, 0.0018)
    for boot, sole, lace in boots:
        ol(boot, 0.007)
        ol(sole, 0.006)
        ol(lace, 0.0016)
    ol(coat, 0.0085)
    ol(cape, 0.0075)
    for w, t in wraps:
        ol(w, 0.0022)
        ol(t, 0.0022)
    ol(hair, 0.0014)
    ol(blood, 0.0016)
    if tooth:
        ol(tooth, 0.0012)
    return root


# --------------------------------------------------------------------------- stage

def stage(root):
    kit.render_setup("EEVEE", (900, 1200), 48, view="Standard", transparent=True, filter_px=1.2)
    kit.world((0, 0, 0), 0.0)
    kit.sun("Key", rot=(40, 0, -42), strength=3.0, angle=3.0)
    kit.sun("Fill", rot=(74, 0, 60), strength=0.4, angle=10.0)
    kit.sun("Rim", rot=(-45, 0, -30), strength=1.6, angle=4.0)
    fl = kit.floor_disc(floor_mat(), radius=30.0)
    fl.visible_shadow = False
    cam = kit.camera(lens=55)
    kit.frame_to(cam, root, margin=1.09, aim_frac=0.5, elev=0.05)


# --------------------------------------------------------------------------- post

_NOISE = {}


def _resample(g, H, W):
    gh, gw = g.shape
    ys = np.linspace(0, gh - 1, H)
    xs = np.linspace(0, gw - 1, W)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, gh - 1)
    x1 = np.minimum(x0 + 1, gw - 1)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    a, b, c, d = g[y0][:, x0], g[y0][:, x1], g[y1][:, x0], g[y1][:, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _noise(H, W, cells, seed):
    key = (H, W, cells, seed)
    if key not in _NOISE:
        rng = np.random.default_rng(seed)
        gh = max(2, int(cells))
        gw = max(2, int(cells * W / H))
        _NOISE[key] = _resample(rng.random((gh, gw)), H, W)
    return _NOISE[key]


def _box(a, r):
    r = int(r)
    if r < 1:
        return a
    k = 2 * r + 1
    p = np.pad(a, ((r + 1, r), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=0)
    a = (c[k:] - c[:-k]) / k
    p = np.pad(a, ((0, 0), (r + 1, r)), mode="edge")
    c = np.cumsum(p, axis=1)
    return (c[:, k:] - c[:, :-k]) / k


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def post_fn(a):
    H, W = a.shape[:2]
    paper = np.array(PAPER_S, dtype=np.float32)
    ink = np.array(INK_S, dtype=np.float32)
    red = np.array(RED_S, dtype=np.float32)
    alpha = a[..., 3:4]
    rgb = a[..., :3] * alpha + paper * (1 - alpha)
    if RAW or RAWV:
        a[..., :3] = rgb
        a[..., 3] = 1
        return a
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    redm = np.clip((r - np.maximum(g, b) - 0.28) * 3.0, 0, 1)
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    pl, il = float(paper @ [0.299, 0.587, 0.114]), float(ink @ [0.299, 0.587, 0.114])
    dens = np.clip((pl - lum) / (pl - il), 0, 1) * (1 - redm)
    fine = _noise(H, W, 1200 * 0.8, 1)
    fine2 = _noise(H, W, 1200 * 0.5, 2)
    mid = _noise(H, W, 160, 3)
    coarse = _noise(H, W, 30, 4)
    e = dens + (fine - 0.5) * 0.45 + (mid - 0.5) * 0.25
    d2 = _smooth(0.38, 0.62, e)
    speck = ((fine2 > 0.86) & (coarse < 0.5)).astype(np.float32)
    d2 = d2 * (1 - 0.45 * speck * (dens > 0.97))
    ptex = paper[None, None] * (1 + (mid[..., None] - 0.5) * 0.07 + (fine[..., None] - 0.5) * 0.05
                                - (coarse[..., None] - 0.5) * 0.05)
    itex = ink[None, None] * (1 + (mid[..., None] - 0.5) * 0.5)
    out = ptex * (1 - d2[..., None]) + itex * d2[..., None]
    # red layer: printed from its own block, a little off register, with a glow
    dy, dx = -int(round(0.0016 * H)), int(round(0.0024 * H))
    rs = np.roll(np.roll(redm, dy, axis=0), dx, axis=1)
    glow = _box(_box(_box(rs, 0.0045 * H), 0.0045 * H), 0.0045 * H)
    glow = np.clip(glow * 2.0, 0, 1) * 0.5
    out = out * (1 - glow[..., None]) + red * glow[..., None]
    rm = _smooth(0.3, 0.7, rs + (fine - 0.5) * 0.35)
    out = out * (1 - rm[..., None]) + (red * (1 + (mid[..., None] - 0.5) * 0.25)) * rm[..., None]
    # faint plate-tone vignette
    yy, xx = np.mgrid[0:H, 0:W]
    rr = ((yy / H - 0.5) ** 2 + (xx / W - 0.5) ** 2 * (W / H) ** 2) * 2.2
    out = out * (1 - 0.07 * np.clip(rr, 0, 1)[..., None] * (1 - d2[..., None]))
    a[..., :3] = np.clip(out, 0, 1)
    a[..., 3] = 1.0
    return a


def post(path):
    kit.numpy_post(path, post_fn)


kit.run("ink", build, stage, post)
