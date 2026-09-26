# "Noodle" (toon): a rubber-hose Saturday-morning cartoon zombie.
#   node art/zombies/blend.mjs z_toon.py --preview [--views three_quarter,front,side,back]
# Techniques: Skin-modifier noodle limbs/torso on Bezier arcs (no hard elbows), sculpted
# head/ears/hands/feet (kit.Sculpt + voxel-remesh unions), boolean mouth cavity, cloth-draped
# torn shirt (pinned yoke, jagged pre-cut hem, boolean star holes), soft-body droop (ears,
# tongue), curve-bevel ink strokes, cel materials (Shader to RGB) with object-space paint
# masks, inverted-hull outlines, flat cream stage with cel contact shadows.
import os, sys, math, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy, bmesh
from mathutils import Vector as V, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = [time.time()]
def tick(label):
    t = time.time(); print(f"[toon]  {label}: {t - T0[0]:.1f}s"); T0[0] = t

# --------------------------------------------------------------------------- colour + materials

def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)

LIT_T = 0.6          # Shader-to-RGB value above which a surface counts as lit
INKS = []             # (object, outline thickness) applied at the end of build()


def _rgb(n, col):
    nd = n.new("ShaderNodeRGB")
    nd.outputs[0].default_value = col
    return nd.outputs[0]


def _mix(n, fac, a, b):
    mx = n.new("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    n.nt.links.new(fac, mx.inputs[0])
    n.nt.links.new(a, mx.inputs[6])
    n.nt.links.new(b, mx.inputs[7])
    return mx.outputs[2]


def _ell_mask(n, tc, ells):
    """Union of object-space ellipsoids -> 0/1 mask socket."""
    out = None
    for c, r in ells:
        sub = n.new("ShaderNodeVectorMath", operation="SUBTRACT")
        n.nt.links.new(tc.outputs["Object"], sub.inputs[0]); sub.inputs[1].default_value = c
        div = n.new("ShaderNodeVectorMath", operation="DIVIDE")
        n.nt.links.new(sub.outputs[0], div.inputs[0]); div.inputs[1].default_value = r
        ln = n.new("ShaderNodeVectorMath", operation="LENGTH")
        n.nt.links.new(div.outputs[0], ln.inputs[0])
        lt = n.new("ShaderNodeMath", operation="LESS_THAN")
        n.nt.links.new(ln.outputs["Value"], lt.inputs[0]); lt.inputs[1].default_value = 1.0
        if out is None:
            out = lt.outputs[0]
        else:
            mx = n.new("ShaderNodeMath", operation="MAXIMUM")
            n.nt.links.new(out, mx.inputs[0]); n.nt.links.new(lt.outputs[0], mx.inputs[1])
            out = mx.outputs[0]
    return out


def toon(name, base, shade, spots=None, spec=None, masks=(), thresh=None, rim=None):
    """Cel shader (Eevee only): Diffuse -> Shader to RGB -> hard step between a flat
    base and ONE shadow tone. spots=(lit, shade, scale, cut) noise blotches;
    masks=[(lit, shade, [(centre, radii), ...])] object-space painted regions;
    spec=(colour, cut) hard glossy pop; rim=(colour, cut) hard fresnel rim on the lit side."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = base
    n = kit.Nodes(m)
    out = n.new("ShaderNodeOutputMaterial", loc=(1200, 0))
    d = n.new("ShaderNodeBsdfDiffuse")
    d.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = n.new("ShaderNodeShaderToRGB")
    n.link(d, "BSDF", s2r, "Shader")
    step = n.new("ShaderNodeValToRGB")
    cr = step.color_ramp
    cr.interpolation = "CONSTANT"
    cr.elements[0].position, cr.elements[0].color = 0.0, (0, 0, 0, 1)
    cr.elements[1].position, cr.elements[1].color = thresh or LIT_T, (1, 1, 1, 1)
    n.link(s2r, "Color", step, "Fac")
    lit, sh = _rgb(n, base), _rgb(n, shade)
    tc = n.new("ShaderNodeTexCoord")
    if spots:
        nz = n.new("ShaderNodeTexNoise", Scale=spots[2], Detail=1.0, Roughness=0.4)
        n.nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        r2 = n.new("ShaderNodeValToRGB")
        r2.color_ramp.interpolation = "CONSTANT"
        r2.color_ramp.elements[0].color = (0, 0, 0, 1)
        r2.color_ramp.elements[1].position, r2.color_ramp.elements[1].color = spots[3], (1, 1, 1, 1)
        n.link(nz, "Fac", r2, "Fac")
        lit = _mix(n, r2.outputs[0], lit, _rgb(n, spots[0]))
        sh = _mix(n, r2.outputs[0], sh, _rgb(n, spots[1]))
    for mlit, msh, ells in masks:
        mk = _ell_mask(n, tc, ells)
        lit = _mix(n, mk, lit, _rgb(n, mlit))
        sh = _mix(n, mk, sh, _rgb(n, msh))
    col = _mix(n, step.outputs[0], sh, lit)
    if rim:
        lw = n.new("ShaderNodeLayerWeight", Blend=0.5)
        r3 = n.new("ShaderNodeValToRGB")
        r3.color_ramp.interpolation = "CONSTANT"
        r3.color_ramp.elements[1].position = rim[1]
        n.link(lw, "Facing", r3, "Fac")
        mul = n.new("ShaderNodeMath", operation="MULTIPLY")
        n.nt.links.new(r3.outputs[0], mul.inputs[0]); n.nt.links.new(step.outputs[0], mul.inputs[1])
        col = _mix(n, mul.outputs[0], col, _rgb(n, rim[0]))
    if spec:
        g = n.new("ShaderNodeBsdfGlossy", Roughness=0.3)
        s2 = n.new("ShaderNodeShaderToRGB")
        n.link(g, "BSDF", s2, "Shader")
        r4 = n.new("ShaderNodeValToRGB")
        r4.color_ramp.interpolation = "CONSTANT"
        r4.color_ramp.elements[1].position = spec[1]
        n.link(s2, "Color", r4, "Fac")
        col = _mix(n, r4.outputs[0], col, _rgb(n, spec[0]))
    e = n.new("ShaderNodeEmission")
    n.nt.links.new(col, e.inputs["Color"])
    n.link(e, "Emission", out, "Surface")
    return m


def flat(name, col):
    return kit.emission_mat(name, col, 1.0)


# --------------------------------------------------------------------------- geometry helpers

def bez(P, t):
    a, b, c, d = [V(p) for p in P]
    u = 1 - t
    return a * u ** 3 + b * 3 * u * u * t + c * 3 * u * t * t + d * t ** 3


def bez_tan(P, t):
    a, b, c, d = [V(p) for p in P]
    u = 1 - t
    return ((b - a) * 3 * u * u + (c - b) * 6 * u * t + (d - c) * 3 * t * t).normalized()


def catmull(pts, per=6, closed=False):
    pts = [V(p) for p in pts]
    n = len(pts)
    out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = pts[(i - 1) % n] if closed else pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed else pts[min(i + 2, n - 1)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(pts[-1])
    return out


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def interp(x, table):
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


def frame_from(fwd, up):
    """Rotation matrix mapping local -Y -> fwd and local +Z -> up (orthonormalised)."""
    f = V(fwd).normalized()
    u = (V(up) - f * V(up).dot(f)).normalized()
    y = -f
    x = y.cross(u)
    return Matrix((x, y, u)).transposed()


def skin_chain(name, pts, radii, parent, subdiv=2):
    """Skin-modifier noodle through a smooth chain of points (per-point radius)."""
    bm = bmesh.new()
    lay = bm.verts.layers.skin.verify()
    vs = []
    for p, r in zip(pts, radii):
        v = bm.verts.new(V(p))
        v[lay].radius = r if isinstance(r, (tuple, list)) else (r, r)
        vs.append(v)
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    vs[0][lay].use_root = True
    ob = kit.mesh_obj(name, bm, parent, smooth=False)
    sk = ob.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    sd = ob.modifiers.new("Sub", "SUBSURF")
    sd.levels = sd.render_levels = subdiv
    kit.apply_modifiers(ob)
    kit.shade_smooth(ob)
    return ob


def curve_tube(name, pts, radius, parent=None, taper=None, cyclic=False, kind="NURBS", res=1, order=4, resu=4):
    """Bevelled curve -> mesh: ink strokes, hair, torn-edge lines, stitches."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    cu.resolution_u = resu
    sp = cu.splines.new(kind)
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        sp.points[i].radius = taper[i] if taper else 1.0
    sp.use_cyclic_u = cyclic
    if kind == "NURBS":
        sp.order_u = min(order, len(pts))
        sp.use_endpoint_u = not cyclic
    tmp = bpy.data.objects.new(name + "_c", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    ob = kit.mesh_obj(name, me, parent)
    return ob


def bvh_world(objs):
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        off = len(verts)
        verts += [mw @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def snap(bvh, p, lift=0.0):
    loc, nor, _, _ = bvh.find_nearest(V(p))
    return loc + nor * lift, nor


def rounded_box(name, size, parent=None, power=0.45, level=3):
    ob = kit.quad_sphere(name, 1.0, level, parent=parent)
    for v in ob.data.vertices:
        c = v.co
        v.co = V([math.copysign(abs(c[i]) ** power, c[i]) * size[i] for i in range(3)])
    return ob


def star(n, r_in=0.55, jitter=0.3, seed=0):
    rr = random.Random(seed)
    pts = []
    for k in range(2 * n):
        a = math.pi * k / n + rr.uniform(-0.15, 0.15)
        r = (1.0 if k % 2 == 0 else r_in) * (1 + rr.uniform(-jitter, jitter))
        pts.append((math.cos(a) * r, math.sin(a) * r))
    return pts


def tangent_frame(nrm):
    n = V(nrm).normalized()
    a = V((0, 0, 1)).cross(n)
    if a.length < 1e-3:
        a = V((1, 0, 0))
    a.normalize()
    b = n.cross(a).normalized()
    return a, b, n


def prism(name, center, axis, shape, scale, depth, parent=None):
    a, b, n = tangent_frame(axis)
    bm = bmesh.new()
    top, bot = [], []
    for x, y in shape:
        p = V(center) + (a * x + b * y) * scale
        bot.append(bm.verts.new(p - n * depth))
        top.append(bm.verts.new(p + n * depth))
    m = len(shape)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return kit.mesh_obj(name, bm, parent, smooth=False)


def decal(name, bvh, center, shape, scale, parent, lift=0.002, thick=0.003, rings=5, rot=0.0):
    """A thin slab conforming to a surface (patches, skin rips)."""
    loc, nrm = snap(bvh, center)
    a, b, n = tangent_frame(nrm)
    ca, sa = math.cos(rot), math.sin(rot)
    bm = bmesh.new()
    c = bm.verts.new(loc + n * lift)
    rows = []
    for k in range(1, rings + 1):
        f = k / rings
        row = []
        for x, y in shape:
            x2, y2 = x * ca - y * sa, x * sa + y * ca
            p = loc + (a * x2 + b * y2) * scale * f
            q, nn = snap(bvh, p, lift)
            row.append(bm.verts.new(q))
        rows.append(row)
    m = len(shape)
    for i in range(m):
        bm.faces.new((c, rows[0][i], rows[0][(i + 1) % m]))
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.mesh_obj(name, bm, parent)
    # make sure it faces outward
    me = ob.data
    if sum((p.normal.dot(n) for p in me.polygons)) < 0:
        for p in me.polygons:
            p.flip()
    sol = ob.modifiers.new("Thick", "SOLIDIFY")
    sol.thickness = thick
    sol.offset = -1.0
    kit.apply_modifiers(ob)
    return ob


# --------------------------------------------------------------------------- the character

M = {}

def materials():
    M["skin"] = toon("Skin", lin("#A8D04E"), lin("#6A9A3C"), spots=(lin("#93BD45"), lin("#5C8A35"), 7.0, 0.66))
    M["eye"] = toon("EyeWhite", lin("#FFF8D8"), lin("#D9CC98"), spec=(lin("#FFFFFF"), 0.93))
    M["pupil"] = toon("Pupil", lin("#141414"), lin("#050505"), spec=(lin("#FFFFFF"), 0.9))
    M["lid"] = toon("Lid", lin("#879A4C"), lin("#5E7038"))
    M["mouth"] = toon("MouthIn", lin("#7E1628"), lin("#560C1A"))
    M["tongue"] = toon("Tongue", lin("#EC6B7A"), lin("#B8414F"))
    M["tooth"] = toon("Tooth", lin("#FFF4D6"), lin("#D8C79A"))
    M["shirt"] = toon("Shirt", lin("#FF8A1C"), lin("#D15A12"))
    M["shirt_in"] = toon("ShirtIn", lin("#C4500F"), lin("#9A3C0A"))
    M["pants"] = toon("Pants", lin("#3F66C8"), lin("#2A4592"))
    M["strap"] = toon("Strap", lin("#223A7E"), lin("#15265A"))
    M["button"] = toon("Button", lin("#F5B83A"), lin("#B57B1E"), spec=(lin("#FFF2C0"), 0.8))
    M["patch"] = toon("Patch", lin("#E0B660"), lin("#AE8440"))
    M["ink"] = flat("Ink", lin("#141414"))


HEAD_C = V((0.0, -0.25, 1.6))
HEAD_ROT = (math.radians(-2), math.radians(-8), math.radians(20))
HEAD_S = 1.16
GS = 1   # side of the googly eye (+X = character's left, the side the 3/4 hero camera sees)


def build_head(parent):
    HR = 0.2
    rig = kit.empty("HeadRig", parent=parent)
    head = kit.quad_sphere("Head", HR, 5, parent=rig)
    for v in head.data.vertices:
        x, y, z = v.co
        s = smoothstep(0, 1, -z / HR) if z < 0 else 0.0
        x *= 1 - 0.3 * s
        y = y * 0.92 * (1 - 0.15 * s) - 0.1 * s * s
        z = z * (1 + 0.42 * s)
        if z > 0 and y > 0:
            y *= 1 + 0.1 * (z / HR)
        v.co = (x, y, z)
    head.data.update()
    EG, RG = V((GS * 0.078, -0.128, 0.014)), 0.09      # googly eye
    ED, RD = V((-GS * 0.084, -0.136, -0.004)), 0.064   # droopy eye
    sc = kit.Sculpt(head)
    sc.inflate((0.0, -0.08, 0.15), 0.14, 0.012)                          # domed forehead
    sc.inflate((GS * 0.07, 0.06, 0.17), 0.07, 0.014)                     # skull lumps
    sc.inflate((-GS * 0.1, 0.1, 0.12), 0.06, 0.01)
    for sx in (-1, 1):
        sc.inflate((sx * 0.12, -0.135, -0.085), 0.055, 0.014)             # cheekbones
        sc.inflate((sx * 0.1, -0.12, -0.17), 0.05, -0.012)               # hollow cheeks
        sc.inflate((sx * 0.19, -0.02, 0.05), 0.06, -0.008)               # temples
    sc.inflate(EG + V((0, -0.03, 0)), 0.1, -0.02)                        # sockets
    sc.inflate(ED + V((0, -0.03, 0)), 0.08, -0.016)
    sc.inflate_stroke([(-GS * 0.03, -0.17, 0.08), (-GS * 0.085, -0.165, 0.09), (-GS * 0.14, -0.13, 0.065)], 0.03, 0.012)   # tired brow
    sc.inflate((0.0, -0.185, -0.07), 0.03, 0.01)                         # nose bump
    sc.refresh()
    sc.grab((0.0, -0.17, -0.12), 0.08, (0, -0.032, 0.0))                 # overbite: upper lip juts
    sc.inflate((0.0, -0.13, -0.27), 0.05, 0.01)                           # chin
    sc.noise(9, 0.003)
    sc.smooth(1, 0.3)
    sc.done()
    tick("  head sculpt")
    # mouth: boolean cavity, its walls take the dark mouth material
    kit.assign(head, M["skin_head"])
    cut = kit.quad_sphere("MouthCut", 1.0, 4, loc=(-GS * 0.006, -0.2, -0.178), scale=(0.094, 0.08, 0.098), parent=rig)
    cut.rotation_euler = (0.2, GS * 0.12, 0.0)
    kit.assign(cut, M["mouth"])
    bo = head.modifiers.new("Mouth", "BOOLEAN")
    bo.operation, bo.object, bo.solver = "DIFFERENCE", cut, "EXACT"
    bo.material_mode = "TRANSFER"
    kit.apply_modifiers(head)
    bpy.data.objects.remove(cut)
    bm = bmesh.new(); bm.from_mesh(head.data)
    rim = []
    for e in bm.edges:
        if e.is_manifold and e.calc_face_angle(0) > math.radians(55):
            e.smooth = False
        if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
            rim += [v.co.copy() for v in e.verts]
    bm.to_mesh(head.data); bm.free()
    # the upper-lip anchor: highest rim point near the tooth's x
    tx = GS * 0.024
    near = [c for c in rim if abs(c.x - tx) < 0.012] or rim
    lip_top = max(near, key=lambda c: c.z)
    kit.shade_smooth(head)
    INKS.append((head, 0.008))
    tick("  head boolean")

    bvh = bvh_world([head])
    # paint: purple eye bags + nostril slits, object-space masks on the head surface
    bags = [(snap(bvh, EG + V((0.0, -0.03, -0.09)))[0], (0.066, 0.05, 0.036)),
            (snap(bvh, ED + V((0.0, -0.02, -0.066)))[0], (0.054, 0.05, 0.03))]
    nos = [(snap(bvh, (sx * 0.018, -0.2, -0.082))[0], (0.008, 0.02, 0.016)) for sx in (-1, 1)]
    hm = toon("SkinHead", lin("#A8D04E"), lin("#6A9A3C"),
              spots=(lin("#93BD45"), lin("#5C8A35"), 7.0, 0.68), spec=(lin("#E4F7A8"), 0.965),
              masks=[(lin("#8E6FA8"), lin("#684D84"), bags), (lin("#22361A"), lin("#1A2A14"), nos)])
    head.data.materials[0] = hm
    # eyes
    eg = kit.quad_sphere("EyeBig", RG, 4, loc=EG, parent=rig)
    kit.assign(eg, M["eye"]); INKS.append((eg, 0.005))
    look = V((-GS * 0.32, -0.9, 0.24)).normalized()
    pup = kit.quad_sphere("PupilBig", 1, 3, scale=(0.02, 0.02, 0.008), parent=rig)
    pup.matrix_basis = Matrix.Translation(EG + look * (RG - 0.002)) @ look.to_track_quat("Z", "Y").to_matrix().to_4x4()
    kit.assign(pup, M["pupil"])
    ed = kit.quad_sphere("EyeDroop", RD, 4, loc=ED, parent=rig)
    kit.assign(ed, M["eye"]); INKS.append((ed, 0.004))
    look2 = V((GS * 0.1, -0.85, -0.45)).normalized()
    pup2 = kit.quad_sphere("PupilDroop", 1, 3, scale=(0.016, 0.016, 0.006), parent=rig)
    pup2.matrix_basis = Matrix.Translation(ED + look2 * (RD - 0.001)) @ look2.to_track_quat("Z", "Y").to_matrix().to_4x4()
    kit.assign(pup2, M["pupil"])
    # heavy half-closed upper lid: a dome whose underside is flattened on a tilted plane
    lid = kit.quad_sphere("Lid", RD * 1.1, 3, parent=rig)
    pn = V((-GS * 0.3, -0.3, -1.0)).normalized()   # lid cut plane normal (points down/forward)
    lid_off = -0.014
    for v in lid.data.vertices:
        h = v.co.dot(pn) - lid_off
        if h > 0:
            v.co -= pn * h
    lid.data.update()
    lid.location = ED
    kit.assign(lid, M["lid"]); INKS.append((lid, 0.005))
    # brows (ink strokes on the skin)
    def stroke(name, pts, r, taper):
        sp = [snap(bvh, p, 0.002)[0] for p in catmull(pts, 4)]
        tp = [taper[min(len(taper) - 1, int(i / len(sp) * len(taper)))] for i in range(len(sp))]
        return curve_tube(name, sp, r, rig, taper=tp)
    b1 = stroke("BrowBig", [(GS * 0.16, -0.12, 0.1), (GS * 0.115, -0.16, 0.145), (GS * 0.055, -0.18, 0.14), (GS * 0.02, -0.19, 0.115)], 0.0042, [0.4, 0.9, 1.0, 0.7, 0.4])
    b2 = stroke("BrowDroop", [(-GS * 0.035, -0.19, 0.088), (-GS * 0.08, -0.18, 0.105), (-GS * 0.13, -0.15, 0.085), (-GS * 0.165, -0.12, 0.045)], 0.0065, [0.5, 1.0, 0.9, 0.6, 0.3])
    for b in (b1, b2):
        kit.assign(b, M["ink"])
    # tongue + the one big tooth
    tg = kit.quad_sphere("Tongue", 1, 3, loc=(GS * 0.012, -0.12, -0.235), scale=(0.055, 0.052, 0.025), parent=rig)
    tg.rotation_euler = (-0.25, 0, 0)
    kit.apply_transform(tg)
    s2 = kit.Sculpt(tg)
    s2.crease_stroke([(GS * 0.012, -0.2, -0.205), (GS * 0.012, -0.1, -0.215)], 0.016, 0.007)
    s2.done()
    kit.assign(tg, M["tongue"]); INKS.append((tg, 0.003))
    th = rounded_box("Tooth", (0.026, 0.013, 0.036), rig)
    th.location = lip_top + V((0, 0.012, -0.024))
    th.rotation_euler = (0.12, GS * 0.1, GS * 0.06)
    kit.assign(th, M["tooth"]); INKS.append((th, 0.003))
    # ears: flattened spheres cupped by sculpting, then soft-body droop of the outer rim
    for sx in (-1, 1):
        # low-res cage: bend into a thick dish (cup facing out/forward) ...
        ear = kit.quad_sphere(f"Ear.{'L' if sx > 0 else 'R'}", 1.0, 2, scale=(0.021, 0.07, 0.092), parent=rig)
        for v in ear.data.vertices:
            q = (v.co.y / 0.07) ** 2 + (v.co.z / 0.092) ** 2
            v.co.x += sx * 0.03 * q
        ear.data.update()
        ear.rotation_euler = (0.0, sx * 0.3, -sx * 0.6)
        ear.location = (sx * 0.225, 0.005, -0.03)
        kit.apply_transform(ear)
        # ... soft body: the outer flap flops down under gravity (goal 1 at the root) ...
        kit.vgroup(ear, "goal", lambda co: 1.0 - 0.4 * smoothstep(0.21, 0.29, abs(co.x)))
        kit.softbody_sag(ear, "goal", frames=14, stiffness=0.7, damping=8.0)
        # ... then subdivide the settled cage for a clean cartoon silhouette
        kit.subdivide(ear, 2)
        kit.shade_smooth(ear)
        kit.assign(ear, M["skin_head_ear"]); INKS.append((ear, 0.0045))
        # inner curl line: ray-cast a C-shape onto the concave face
        eb = bvh_world([ear])
        R = Matrix.Rotation(-sx * 0.6, 3, "Z") @ Matrix.Rotation(sx * 0.3, 3, "Y")
        cpts = []
        for k in range(9):
            a = math.radians(-120 + 240 * k / 8)
            loc_ = V((sx * 0.225, 0.005, -0.03)) + R @ V((sx * 0.06, math.cos(a) * 0.04 * -sx, math.sin(a) * 0.055))
            dirn = R @ V((-sx, 0, 0))
            hit = eb.ray_cast(loc_, dirn)
            if hit[0] is not None:
                cpts.append(hit[0] - dirn * 0.0015)
        if len(cpts) >= 4:
            cl = curve_tube(f"EarInk{sx}", cpts, 0.003, rig, taper=[0.3] + [1.0] * (len(cpts) - 2) + [0.3])
            kit.assign(cl, M["ink"])
    tick("  ears (soft body)")
    # wiry hair strands
    rr = random.Random(3)
    for k, (ax, az, ln) in enumerate([(-0.5, 0.95, 0.12), (-0.2, 1.0, 0.15), (0.05, 0.98, 0.13), (0.3, 0.9, 0.11), (0.55, 0.8, 0.1), (-0.75, 0.65, 0.09), (0.15, 0.7, 0.1)]):
        d = V((ax * 0.8, 0.1 + rr.uniform(-0.2, 0.3), az)).normalized()
        hit = bvh.ray_cast(d * 0.5, -d)
        root_p = hit[0] if hit[0] is not None else d * 0.2
        pts = [root_p - d * 0.01]
        dirv = d.copy()
        side = V((ax, 0, 0)).normalized() if abs(ax) > 0.01 else V((1, 0, 0))
        wig = rr.uniform(0.25, 0.5) * (1 if k % 2 else -1)
        for i in range(7):
            perp = dirv.cross(V((0, 1, 0))).normalized()
            dirv = (dirv + side * 0.22 + perp * wig * math.sin(i * 1.7) + V((0, 0, -0.05 * i))).normalized()
            pts.append(pts[-1] + dirv * ln / 7)
        pts[-1] += V((rr.uniform(-0.01, 0.01), rr.uniform(-0.01, 0.01), -0.01))
        hr = curve_tube(f"Hair{k}", pts, 0.0048, rig, taper=[1, 0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.3], res=1)
        kit.assign(hr, M["ink"])
    rig.location = HEAD_C
    rig.rotation_euler = HEAD_ROT
    rig.scale = (HEAD_S, HEAD_S, HEAD_S)
    return rig, head


def build_hand(name, side, parent):
    """Big four-fingered (thumb + 3) hand, local: wrist at origin, fingers along -Y,
    back of the hand +Z. Fat capsule fingers flop downward."""
    parts = [kit.quad_sphere(name + "_palm", 1.0, 3, loc=(0, -0.07, 0), scale=(0.064, 0.07, 0.03))]
    parts.append(kit.tube(name + "_wr", [(0, 0.03, 0), (0, -0.04, 0)], [0.034, 0.04], 12))
    rr = random.Random(5 + side)
    specs = [(-0.047, 0.105, 1.05), (0.0, 0.12, 0.8), (0.047, 0.11, 1.25)]
    for k, (x, ln, curl) in enumerate(specs):
        x *= side
        spread = x * 3.2
        d = V((math.sin(spread), -math.cos(spread), 0.08))
        p = V((x, -0.11, 0.004))
        pts = [p - d * 0.02, p.copy()]
        steps = 5
        for i in range(steps):
            ax = d.cross(V((0, 0, 1))).normalized()
            d = (Matrix.Rotation(curl / steps, 3, ax) @ d).normalized()
            pts.append(pts[-1] + d * ln / steps)
        rad = [0.02, 0.021, 0.021, 0.0215, 0.022, 0.023, 0.023]
        parts.append(kit.tube(f"{name}_f{k}", pts, rad, 12))
        parts.append(kit.quad_sphere(f"{name}_t{k}", 0.023, 2, loc=pts[-1]))
    # thumb on the inner side
    d = V((-side * 0.75, -0.55, -0.2)).normalized()
    p = V((-side * 0.045, -0.05, -0.005))
    pts = [p.copy()]
    for i in range(4):
        d = (d + V((side * 0.12, -0.1, -0.12))).normalized()
        pts.append(pts[-1] + d * 0.022)
    parts.append(kit.tube(name + "_th", pts, [0.021, 0.022, 0.022, 0.022, 0.022], 12))
    parts.append(kit.quad_sphere(name + "_tht", 0.022, 2, loc=pts[-1]))
    hand = kit.join(parts, name)
    kit.remesh(hand, 0.0052)
    s = kit.Sculpt(hand)
    s.smooth(3, 0.5)
    s.done()
    hand.data.transform(Matrix.Scale(HAND_S, 4))
    hand.parent = parent
    kit.shade_smooth(hand)
    return hand


def build_foot(name, side, parent):
    """Huge bare foot, local: ankle above the origin, toes along -Y, sole on z=0,
    big toe on the inner side."""
    parts = [kit.quad_sphere(name + "_b", 1.0, 3, loc=(0, -0.09, 0.045), scale=(0.078, 0.16, 0.058)),
             kit.quad_sphere(name + "_h", 1.0, 3, loc=(0, 0.035, 0.05), scale=(0.068, 0.07, 0.058)),
             kit.tube(name + "_a", [(0, 0.0, 0.05), (0, 0.0, 0.17)], [0.058, 0.052], 16)]
    toes = [(0.04, 0.0), (0.033, 0.014), (0.03, 0.026), (0.027, 0.038), (0.024, 0.052)]
    x = -side * 0.07
    for k, (r, back) in enumerate(toes):
        y = -0.235 + back
        parts.append(kit.quad_sphere(f"{name}_t{k}", r, 3, loc=(x, y, r * 0.95), scale=(1.0, 1.15, 1.0)))
        x += side * (r + toes[min(k + 1, 4)][0]) * 0.92
    foot = kit.join(parts, name)
    kit.remesh(foot, 0.0068)
    for v in foot.data.vertices:
        if v.co.z < 0.004:
            v.co.z = 0.0
    s = kit.Sculpt(foot)
    s.smooth(2, 0.4)
    s.done()
    for v in foot.data.vertices:
        if v.co.z < 0.0:
            v.co.z = 0.0
    foot.data.transform(Matrix.Scale(FOOT_S, 4))
    foot.parent = parent
    kit.shade_smooth(foot)
    return foot


HAND_S, FOOT_S = 1.55, 1.32
SPINE = [V((0, 0.05, 0.74)), V((0, 0.0, 0.92)), V((0, -0.07, 1.07)), V((0, -0.12, 1.16)), V((0, -0.16, 1.24))]


def spine_xy(z):
    if z <= SPINE[0].z:
        return SPINE[0].copy()
    for a, b in zip(SPINE, SPINE[1:]):
        if z <= b.z:
            return a.lerp(b, (z - a.z) / (b.z - a.z))
    return SPINE[-1].copy()


def sweep_rings(P, t0, t1, nring, nseg, rad_fn, end_zig=None):
    """Parallel-transport rings along a Bezier; returns list of rings (lists of co)."""
    rings = []
    tprev = bez_tan(P, t0)
    a = tprev.cross(V((0, 0, 1)))
    if a.length < 1e-3:
        a = V((1, 0, 0))
    a.normalize()
    for i in range(nring):
        w = i / (nring - 1)
        t = t0 + (t1 - t0) * w
        tg = bez_tan(P, t)
        a = (a - tg * a.dot(tg)).normalized()
        b = tg.cross(a).normalized()
        c = bez(P, t)
        ring = []
        for j in range(nseg):
            th = 2 * math.pi * j / nseg
            r = rad_fn(w, th)
            p = c + (a * math.cos(th) + b * math.sin(th)) * r
            if end_zig is not None and i == nring - 1:
                p += tg * end_zig[j]
            elif end_zig is not None and i == nring - 2:
                p += tg * min(0.0, end_zig[j]) * 0.4
            ring.append(p)
        rings.append(ring)
    return rings


def orient_out(ob, centre_fn):
    """Flip all faces if most normals point toward centre_fn(face_centre)."""
    score = 0.0
    for p in ob.data.polygons:
        c = p.center
        cc = V(centre_fn(c))
        d = V((c.x - cc.x, c.y - cc.y, 0))
        score += p.normal.dot(d)
    if score < 0:
        for p in ob.data.polygons:
            p.flip()
        ob.data.update()


def rings_mesh(name, rings, parent, closed_start=False):
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for r0, r1 in zip(vr, vr[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((r0[j], r0[k], r1[k], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = kit.mesh_obj(name, bm, parent)
    return ob


def zigzag(n, base_fn, rng, teeth=(3, 7), depth=(0.015, 0.07)):
    """Per-column heights of a torn edge: random saw teeth (sharp points)."""
    vals = [0.0] * n
    j = 0
    while j < n:
        w = rng.randint(*teeth)
        dep = rng.uniform(*depth)
        pk = rng.randint(1, max(1, w - 1))
        for k in range(w):
            if j + k >= n:
                break
            f = k / pk if k <= pk else (w - k) / (w - pk)
            vals[j + k] = dep * f
        j += w
    return [base_fn(i / n) - vals[i] for i in range(n)]


def build():
    materials()
    M["skin_head"] = M["skin"]
    M["skin_head_ear"] = M["skin"]
    root = kit.empty("ZOMBIE")
    pose = kit.empty("Pose", parent=root)
    tick("start")

    # ---------------------------------------------------------------- feet + noodle legs
    feet = {}
    ankles = {}
    FOOT = {1: dict(pos=(0.13, -0.15, 0.0), yaw=0.25, pitch=0.0),
            -1: dict(pos=(-0.12, 0.25, 0.0), yaw=0.05, pitch=0.42)}
    for side in (1, -1):
        f = build_foot(f"Foot.{'L' if side > 0 else 'R'}", side, pose)
        cfg = FOOT[side]
        piv = V((0, -0.2 * FOOT_S, 0))
        mtx = (Matrix.Translation(cfg["pos"]) @ Matrix.Rotation(cfg["yaw"] * side, 4, "Z") @
               Matrix.Translation(piv) @ Matrix.Rotation(cfg["pitch"], 4, "X") @ Matrix.Translation(-piv))
        zmin = min((mtx @ v.co).z for v in f.data.vertices)
        mtx = Matrix.Translation((0, 0, 0.004 - zmin)) @ mtx      # sole just above the floor
        f.matrix_basis = mtx
        feet[side] = f
        ankles[side] = mtx @ V((0, 0.0, 0.13 * FOOT_S))
        kit.assign(f, M["skin"]); INKS.append((f, 0.008))
    LEG = {}
    LEG[1] = [V((0.085, 0.05, 0.8)), V((0.11, -0.16, 0.56)), V((0.14, -0.13, 0.3)), ankles[1]]
    LEG[-1] = [V((-0.085, 0.05, 0.8)), V((-0.1, -0.06, 0.5)), V((-0.13, 0.13, 0.34)), ankles[-1]]
    legs = []
    for side in (1, -1):
        pts = [bez(LEG[side], i / 11) for i in range(12)]
        legs.append(skin_chain(f"Leg.{'L' if side > 0 else 'R'}", pts, [0.05] * 9 + [0.05, 0.052, 0.054], pose))
        kit.assign(legs[-1], M["skin"]); INKS.append((legs[-1], 0.006))
    tick("feet+legs")

    # ---------------------------------------------------------------- torso, neck, arms, hands
    tpts = catmull(SPINE + [V((0, -0.2, 1.33)), V((0, -0.23, 1.41))], 2)
    trad = [interp(p.z, [(0.74, 0.1), (0.92, 0.1), (1.08, 0.11), (1.18, 0.08), (1.24, 0.052), (1.3, 0.047), (1.45, 0.047)]) for p in tpts]
    torso = skin_chain("Torso", tpts, trad, pose)
    kit.assign(torso, M["skin"]); INKS.append((torso, 0.007))
    ARM = {1: [V((0.13, -0.12, 1.15)), V((0.3, -0.22, 1.3)), V((0.33, -0.5, 1.26)), V((0.27, -0.66, 1.08))],
           -1: [V((-0.13, -0.12, 1.15)), V((-0.33, -0.16, 0.98)), V((-0.38, -0.42, 0.98)), V((-0.31, -0.58, 1.05))]}
    arms, hands = [], []
    for side in (1, -1):
        P = ARM[side]
        pts = [bez(P, i / 13) for i in range(14)]
        rad = [0.042, 0.04, 0.038] + [0.036] * 8 + [0.035, 0.035, 0.035]
        arm = skin_chain(f"Arm.{'L' if side > 0 else 'R'}", pts, rad, pose)
        kit.assign(arm, M["skin"]); INKS.append((arm, 0.006))
        arms.append(arm)
        hand = build_hand(f"Hand.{'L' if side > 0 else 'R'}", side, pose)
        tg = bez_tan(P, 1.0)
        fwd = (tg + V((0, 0, -0.35 if side > 0 else -0.75))).normalized()
        up = Matrix.Rotation(side * 0.35, 3, fwd) @ V((0, 0, 1))
        hand.matrix_basis = Matrix.Translation(P[3] + tg * 0.01) @ frame_from(fwd, up).to_4x4()
        kit.assign(hand, M["skin"]); INKS.append((hand, 0.006))
        hands.append(hand)
    tick("torso+arms+hands")

    rig, head = build_head(pose)
    tick("head")

    # ---------------------------------------------------------------- saggy trousers
    parts = []
    bar = kit.tube("PantsBar", [V((0, 0.04, 0.95)), V((0, 0.04, 0.86)), V((0, 0.045, 0.74))], [0.16, 0.172, 0.165], 32)
    for v in bar.data.vertices:
        v.co.y = 0.04 + (v.co.y - 0.04) * 0.8
    parts.append(bar)
    CUFF_T = {1: 0.86, -1: 0.84}
    cuffs = []
    for side in (1, -1):
        P = LEG[side]
        n = 10
        ts = [0.05 + (CUFF_T[side] - 0.05) * i / (n - 1) for i in range(n)]
        pts = [bez(P, t) for t in ts]
        rad = [interp(t, [(0.0, 0.11), (0.4, 0.1), (0.6, 0.094), (0.86, 0.09)]) for t in ts]
        parts.append(kit.tube(f"PantsLeg{side}", pts, rad, 24))
        cuffs.append((bez(P, CUFF_T[side]), bez_tan(P, CUFF_T[side]), rad[-1]))
    pants = kit.join(parts, "Pants")
    pants.parent = pose
    kit.remesh(pants, 0.0105)
    sp = kit.Sculpt(pants)
    sp.grab((0, 0.06, 0.68), 0.14, (0, 0.01, -0.03))     # saggy seat
    sp.smooth(10, 0.5)
    sp.done()
    kit.shade_smooth(pants)
    kit.assign(pants, M["pants"]); INKS.append((pants, 0.007))
    for k, (c, tg, r) in enumerate(cuffs):
        a, b, n_ = tangent_frame(tg)
        ring = []
        rr = random.Random(20 + k)
        for j in range(24):
            th = 2 * math.pi * j / 24
            rj = r + 0.012 + rr.uniform(-0.003, 0.003)
            ring.append(c + (a * math.cos(th) + b * math.sin(th)) * rj + tg * rr.uniform(-0.004, 0.004))
        cf = curve_tube(f"Cuff{k}", ring, 0.024, pose, cyclic=True, res=3, resu=3)
        kit.assign(cf, M["pants"]); INKS.append((cf, 0.006))
    tick("pants")

    # ---------------------------------------------------------------- torn shirt (cloth)
    rng = random.Random(9)
    NU, NV, VB, Z_SH = 96, 30, 0.8, 1.17
    def hem_base(u):
        # lower at the back, higher at the front, a big flap on the left side
        th = 2 * math.pi * u
        return 0.84 + 0.035 * math.sin(th) + 0.02 * math.cos(2 * th)
    hem = zigzag(NU, hem_base, rng, teeth=(3, 8), depth=(0.02, 0.085))
    bm = bmesh.new()
    grid = []
    for i in range(NV + 1):
        v = i / NV
        row = []
        for j in range(NU):
            th = 2 * math.pi * j / NU
            h = hem[j]
            if v <= VB:
                w = v / VB
                z = h + (Z_SH - h) * w
                c = spine_xy(z)
                rx = interp(z, [(0.72, 0.2), (0.86, 0.19), (1.0, 0.175), (1.17, 0.185)])
                ry = interp(z, [(0.72, 0.16), (0.86, 0.155), (1.0, 0.14), (1.17, 0.125)])
            else:
                w = (v - VB) / (1 - VB)
                phi = w * math.pi / 2
                k = math.cos(phi)
                rx = 0.07 + (0.185 - 0.07) * k
                ry = 0.064 + (0.125 - 0.064) * k
                z = Z_SH + 0.075 * math.sin(phi)
                c = spine_xy(Z_SH).lerp(V((0, -0.165, 0)), w)
            row.append(bm.verts.new((c.x + rx * math.cos(th), c.y + ry * math.sin(th), z)))
        grid.append(row)
    for i in range(NV):
        for j in range(NU):
            k = (j + 1) % NU
            bm.faces.new((grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.index_update()
    hem_idx = [grid[0][j].index for j in range(NU)]
    shirt = kit.mesh_obj("Shirt", bm, pose)
    orient_out(shirt, lambda c: spine_xy(c.z) if c.z < 1.17 else V((0, -0.14, 1.0)))
    kit.vgroup(shirt, "pin", lambda co: smoothstep(0.98, 1.1, co.z))
    kit.drape_cloth(shirt, [torso, pants] + arms, frames=30, pin="pin", stiffness=6, thickness=0.006)
    tick("shirt cloth")
    ss = kit.Sculpt(shirt)
    ss.smooth(2, 0.35)
    ss.done()
    hem_pts = [shirt.data.vertices[i].co.copy() for i in hem_idx]
    # sleeves (torn) around the upper arms
    sleeves = []
    sleeve_edges = []
    for side, arm in zip((1, -1), arms):
        P = ARM[side]
        zig = zigzag(32, lambda u: 0.0, random.Random(30 + side), teeth=(2, 5), depth=(0.01, 0.04))
        rings = sweep_rings(P, 0.0, 0.3, 9, 32, lambda w, th: 0.068 - 0.008 * w + 0.004 * math.sin(3 * th), end_zig=zig)
        sl = rings_mesh(f"Sleeve.{'L' if side > 0 else 'R'}", rings, pose)
        orient_out(sl, lambda c, P=P: bez(P, 0.15))
        sleeves.append(sl)
        sleeve_edges.append(rings[-1])
    # thickness + holes
    for ob in [shirt] + sleeves:
        kit.assign(ob, M["shirt"], M["shirt_in"])
        so = ob.modifiers.new("Thick", "SOLIDIFY")
        so.thickness, so.offset, so.use_rim = 0.006, -1.0, True
        so.material_offset = so.material_offset_rim = 1
        kit.apply_modifiers(ob)
    bvh_sh = bvh_world([shirt])
    holes = [((0.03, -0.24, 1.02), (0.05, -1, 0.1), 0.05, 11), ((-0.11, -0.2, 0.9), (0.4, -1, 0.0), 0.042, 12),
             ((-0.06, 0.16, 1.0), (0.2, 1, 0.05), 0.05, 13), ((0.19, -0.02, 0.95), (-1, 0.1, 0), 0.038, 14)]
    cutters = []
    hole_loops = []
    backs = []
    for k, (c, ax, sz, seed) in enumerate(holes):
        shp = star(7 + k % 3, 0.55, 0.4, seed)
        ax = V(ax).normalized()
        loc, nrm = snap(bvh_sh, c)
        cutters.append(prism(f"HoleCut{k}", loc, nrm, shp, sz, 0.05))
        a, b, n_ = tangent_frame(nrm)
        loop = []
        for i in range(len(shp)):
            p0, p1 = V(shp[i]), V(shp[(i + 1) % len(shp)])
            for f in (0.0, 0.5):
                q = p0.lerp(p1, f)
                p = loc + (a * q.x + b * q.y) * sz
                hit = bvh_sh.ray_cast(p + nrm * 0.05, -nrm)
                loop.append(hit[0] + nrm * 0.001 if hit[0] is not None else p)
        hole_loops.append(loop)
        backs.append((loc, shp, sz))
    cut = kit.join(cutters, "HoleCutters")
    kit.assign(cut, M["shirt_in"])
    bo = shirt.modifiers.new("Holes", "BOOLEAN")
    bo.operation, bo.object, bo.solver = "DIFFERENCE", cut, "EXACT"
    bo.material_mode = "TRANSFER"
    kit.apply_modifiers(shirt)
    bpy.data.objects.remove(cut)
    kit.shade_smooth(shirt)
    INKS.append((shirt, 0.006))
    for k, (loc, shp, sz) in enumerate(backs):
        sk = decal(f"HoleSkin{k}", bvh_sh, loc, [(x * 1.25, y * 1.25) for x, y in shp], sz, pose, lift=-0.011, thick=0.002)
        kit.assign(sk, M["skin"])
    for sl in sleeves:
        INKS.append((sl, 0.005))
    # ink along torn edges
    edges = [curve_tube("HemInk", hem_pts, 0.0035, pose, cyclic=True, kind="POLY")]
    for k, ring in enumerate(sleeve_edges):
        edges.append(curve_tube(f"SleeveInk{k}", ring, 0.003, pose, cyclic=True, kind="POLY"))
    for k, loop in enumerate(hole_loops):
        edges.append(curve_tube(f"HoleInk{k}", loop, 0.0028, pose, cyclic=True, kind="POLY"))
    for e in edges:
        kit.assign(e, M["ink"])
    tick("shirt finish")

    # ---------------------------------------------------------------- one suspender + button
    bvh_c = bvh_world([shirt, pants])
    guide = [(GS * 0.075, -0.2, 0.8), (GS * 0.08, -0.21, 0.9), (GS * 0.09, -0.23, 1.02), (GS * 0.1, -0.23, 1.12), (GS * 0.11, -0.16, 1.23),
             (GS * 0.105, -0.05, 1.2), (GS * 0.09, 0.08, 1.08), (GS * 0.075, 0.16, 0.95), (GS * 0.065, 0.18, 0.8)]
    dense = catmull(guide, 6)
    cen, nrs = [], []
    for g in dense:
        A = spine_xy(min(g.z, 1.02))
        A = V((A.x, A.y, min(g.z, 1.02)))
        out = (g - A).normalized()
        hit = bvh_c.ray_cast(g + out * 0.4, -out)
        if hit[0] is None:
            continue
        cen.append(hit[0] + hit[1] * 0.004)
        nrs.append(hit[1])
    bm = bmesh.new()
    prev = None
    for i, (p, nr) in enumerate(zip(cen, nrs)):
        tg = (cen[min(i + 1, len(cen) - 1)] - cen[max(i - 1, 0)]).normalized()
        sd = nr.cross(tg).normalized()
        a = bm.verts.new(p + sd * 0.019)
        b = bm.verts.new(p - sd * 0.019)
        if prev:
            bm.faces.new((prev[0], prev[1], b, a))
        prev = (a, b)
    strap = kit.mesh_obj("Suspender", bm, pose)
    if sum(p.normal.dot(nrs[min(i, len(nrs) - 1)]) for i, p in enumerate(strap.data.polygons)) < 0:
        for p in strap.data.polygons:
            p.flip()
    so = strap.modifiers.new("Thick", "SOLIDIFY")
    so.thickness, so.offset = 0.005, 1.0
    kit.apply_modifiers(strap)
    kit.assign(strap, M["strap"]); INKS.append((strap, 0.004))
    for k, i in enumerate((1, len(cen) - 2)):       # brass buttons, front and back
        bp, bn = cen[i], nrs[i]
        btn = kit.quad_sphere(f"Button{k}", 1.0, 3, scale=(0.02, 0.02, 0.008), parent=pose)
        btn.matrix_basis = Matrix.Translation(bp + bn * 0.006) @ bn.to_track_quat("Z", "Y").to_matrix().to_4x4()
        kit.assign(btn, M["button"]); INKS.append((btn, 0.003))
    tick("suspender")

    # ---------------------------------------------------------------- patches, skin rips, wrinkles
    bvh_p = bvh_world([pants])
    sq = [(math.cos(a) * 1.0, math.sin(a) * 1.0) for a in [math.pi / 4 + k * math.pi / 2 for k in range(4)]]
    sqd = []
    for i in range(4):
        p0, p1 = V(sq[i]), V(sq[(i + 1) % 4])
        for f in (0.0, 0.25, 0.5, 0.75):
            q = p0.lerp(p1, f)
            sqd.append((q.x, q.y))
    PATCH_C = (0.14, -0.12, 0.6)
    patch = decal("Patch", bvh_p, PATCH_C, sqd, 0.05, pose, rot=0.2)
    kit.assign(patch, M["patch"]); INKS.append((patch, 0.004))
    # stitches around the patch
    loc, nrm = snap(bvh_p, PATCH_C)
    a, b, n_ = tangent_frame(nrm)
    ca, sa = math.cos(0.2), math.sin(0.2)
    for i in range(16):
        q = V(sqd[i])
        x2, y2 = q.x * ca - q.y * sa, q.x * sa + q.y * ca
        base = a * x2 + b * y2
        p_in = snap(bvh_p, loc + base * 0.05 * 0.82, 0.005)[0]
        p_out = snap(bvh_p, loc + base * 0.05 * 1.12, 0.004)[0]
        st = curve_tube(f"Stitch{i}", [p_in, p_out], 0.0022, pose, kind="POLY")
        kit.assign(st, M["ink"])
    rips = [((-0.14, -0.16, 0.48), 0.045, 21, 0.3), ((0.16, -0.12, 0.32), 0.035, 22, -0.4)]
    for k, (c, sz, seed, rot) in enumerate(rips):
        rp = decal(f"Rip{k}", bvh_p, c, star(6, 0.5, 0.35, seed), sz, pose, rot=rot)
        kit.assign(rp, M["skin"]); INKS.append((rp, 0.004))
    # hand-drawn fold lines: short tapered ink arcs around the trouser legs, snapped to the cloth
    # angle convention (legs point down): 0 = +X, 90 = front (-Y), -90 = back
    folds = [(1, 0.45, 55, 75, 0.02), (1, 0.53, 65, 50, -0.015), (1, 0.8, 35, 80, 0.0), (1, 0.5, -130, 60, 0.0),
             (-1, 0.47, 70, 75, 0.02), (-1, 0.44, -120, 60, -0.01), (-1, 0.78, 85, 70, 0.01),
             (1, 0.2, 105, 50, 0.0), (-1, 0.2, 40, 45, 0.0)]
    for k, (side, t, th0, span, wob) in enumerate(folds):
        P = LEG[side]
        c, tg = bez(P, t), bez_tan(P, t)
        a, b, n_ = tangent_frame(tg)
        r = 0.1
        pts = []
        for i in range(6):
            th = math.radians(th0 + span * i / 5)
            q = c + (a * math.cos(th) + b * math.sin(th)) * r + tg * wob * math.sin(math.pi * i / 5)
            pts.append(snap(bvh_p, q, 0.0025)[0])
        fl = curve_tube(f"Fold{k}", pts, 0.0032, pose, taper=[0.2, 0.8, 1.0, 1.0, 0.7, 0.2])
        kit.assign(fl, M["ink"])
    tick("patches")

    # ---------------------------------------------------------------- outlines
    for ob, t in INKS:
        kit.outline(ob, t, color=lin("#141414"))
    # centre the whole figure on the turntable axis
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in kit.descendants(root):
        if o.type == "MESH":
            for c in o.bound_box:
                w = o.matrix_world @ V(c)
                xs.append(w.x); ys.append(w.y)
    pose.location = (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0)
    tick("outlines")
    dg = bpy.context.evaluated_depsgraph_get()
    rows = []
    for o in kit.descendants(root):
        if o.type == "MESH":
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            rows.append((len(me.loop_triangles), o.name))
            ev.to_mesh_clear()
    rows.sort(reverse=True)
    print("[toon] heavy: " + ", ".join(f"{n}={t}" for t, n in rows[:14]))
    return root


# --------------------------------------------------------------------------- stage

def frame_camera(cam, root, fill=0.85, yaw_ref=-35, elev=0.06):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in kit.descendants(root):
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        step = max(1, len(me.vertices) // 300)
        pts += [mw @ me.vertices[i].co for i in range(0, len(me.vertices), step)]
        ev.to_mesh_clear()
    c = cam.data
    c.sensor_fit = "AUTO"
    tanv = (c.sensor_width / 2) / c.lens
    tanh = tanv * bpy.context.scene.render.resolution_x / bpy.context.scene.render.resolution_y

    def ext(yaw, L, T):
        R = Matrix.Rotation(math.radians(yaw), 3, "Z")
        f = (T - L).normalized()
        r = f.cross(V((0, 0, 1))).normalized()
        u = r.cross(f)
        xs, ys = [], []
        for p in pts:
            q = R @ p - L
            z = q.dot(f)
            xs.append(q.dot(r) / z / tanh)
            ys.append(q.dot(u) / z / tanv)
        return min(xs), max(xs), min(ys), max(ys)

    zc = 0.9
    D = 6.0
    for _ in range(8):
        T = V((0, 0, zc))
        L = T + V((0, -D * math.cos(elev), D * math.sin(elev)))
        x0, x1, y0, y1 = ext(yaw_ref, L, T)
        h = (y1 - y0) / 2
        D *= h / fill
        zc += (y1 + y0) / 2 * tanv * D
    # the whole turntable must fit
    worst = 0
    for yaw in range(0, 360, 15):
        x0, x1, y0, y1 = ext(yaw, L, T)
        worst = max(worst, abs(x0), abs(x1), abs(y0) * 1.0, abs(y1))
    if worst > 0.97:
        D *= worst / 0.97
    T = V((0, 0, zc))
    cam.location = T + V((0, -D * math.cos(elev), D * math.sin(elev)))
    kit._aim(cam, T)
    print(f"[toon] camera D={D:.2f} aim z={zc:.2f} worst={worst:.2f}")


def stage(root):
    kit.render_setup("EEVEE", (900, 1200), 48, view="Standard", filter_px=1.2)
    kit.world((0.9, 0.88, 0.85), 0.18)
    bg = flat("Backdrop", lin("#FBF3E1"))
    kit.backdrop(bg, width=30, depth=20, height=16, radius=2.0, y_back=4.0)
    sc = bpy.context.scene
    sc.eevee.use_raytracing = False           # probes only: no screen-space noise on the cel step
    sun = kit.sun("Key", strength=4.2, angle=1.2)
    sun.location = (-3.0, -3.4, 4.0)
    kit._aim(sun, (0, 0, 1.0))
    # soft cel contact shadows (ellipses under the feet, flat emission gradient)
    sh = bpy.data.materials.new("ContactShadow")
    n = kit.Nodes(sh)
    out = n.new("ShaderNodeOutputMaterial")
    tc = n.new("ShaderNodeTexCoord")
    ln = n.new("ShaderNodeVectorMath", operation="LENGTH")
    n.nt.links.new(tc.outputs["Object"], ln.inputs[0])
    rp = n.new("ShaderNodeValToRGB")
    rp.color_ramp.interpolation = "EASE"
    rp.color_ramp.elements[0].position, rp.color_ramp.elements[0].color = 0.45, lin("#CDBFA3")
    rp.color_ramp.elements[1].position, rp.color_ramp.elements[1].color = 1.0, lin("#FBF3E1")
    n.nt.links.new(ln.outputs["Value"], rp.inputs["Fac"])
    em = n.new("ShaderNodeEmission")
    n.link(rp, "Color", em, "Color")
    n.link(em, "Emission", out, "Surface")
    bpy.context.view_layer.update()
    pose = root.children[0]
    mids = []
    for side, name in ((1, "Foot.L"), (-1, "Foot.R")):
        f = bpy.data.objects[name]
        c = f.matrix_world @ V((0, -0.08, 0))
        d = kit.quad_sphere(f"Shadow{name}", 1.0, 3, scale=(1, 1, 0.001))
        d.parent = pose
        mids.append(c)
        d.matrix_world = Matrix.Translation((c.x, c.y, 0.0015)) @ Matrix.Rotation(f.matrix_world.to_euler().z, 4, "Z") @ Matrix.Diagonal((0.15, 0.27, 1, 1))
        kit.assign(d, sh)
    body_sh = kit.quad_sphere("ShadowBody", 1.0, 3, scale=(1, 1, 0.001))
    body_sh.parent = pose
    mid = (mids[0] + mids[1]) / 2
    body_sh.matrix_world = Matrix.Translation((mid.x, mid.y, 0.001)) @ Matrix.Diagonal((0.36, 0.5, 1, 1))
    kit.assign(body_sh, sh)
    cam = kit.camera(lens=60)
    frame_camera(cam, root)
    close = os.environ.get("TOON_CLOSE")
    if close:   # debug close-up on one part (e.g. HeadRig, Hand.L, Foot.L)
        bpy.context.view_layer.update()
        ob = bpy.data.objects[close]
        objs = [ob] + kit.descendants(ob)
        pts = [o.matrix_world @ V(c) for o in objs if o.type == "MESH" for c in o.bound_box]
        lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        ctr, size = (lo + hi) / 2, (hi - lo).length
        cam.location = ctr + V((0, -size * 2.6, size * 0.2))
        kit._aim(cam, ctr)


kit.run("toon", build, stage)
