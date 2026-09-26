"""Shared Blender toolkit for the zombie style explorations (Blender 5.2, headless).

Each style script builds one character and hands it to `run()`:

    import os, sys; sys.path.insert(0, os.path.dirname(__file__)); import kit
    def build():  # -> root empty with every character part parented to it
        ...
    def stage(root):  # lights, backdrop, camera framing, render engine, materials look
        ...
    kit.run("plush", build, stage)

Run:  blender -b --factory-startup --python art/zombies/z_plush.py -- [--preview|--final]
  --preview   one three-quarter still at low res (fast iteration)          [default]
  --final     hero stills (front, 3/4, side, back), a 24-frame turntable,
              the .blend, and meta.json with triangle counts
Output: output/art/zombies/<style>/  (git-ignored)

Toolbox:
  skeleton + skin_body   posed humanoid from joints/radii through the Skin modifier
  Sculpt                 vertex brushes (inflate, grab, crease along strokes, pinch,
                         flatten, smooth, noise) driven by a KD-tree — sculpting by code
  quad_sphere, remesh, subdivide, apply_modifiers, join
  inflate_cloth          cloth-with-pressure inflation (plush / pillowy parts), baked + applied
  drape_cloth            cloth draped over colliders (torn clothes, cloaks), baked + applied
  softbody_sag           soft body with goal weights (droop, sag, dangling bits), baked + applied
  mat / toon_mat / outline / Nodes   material helpers (materials are shared by name)
  lights, world, backdrop, camera framing, numpy post-processing on renders
"""
import bpy
import bmesh
import json
import math
import os
import sys
import time
from mathutils import Vector, Matrix, Euler, kdtree, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_BASE = os.path.join(ROOT, "output", "art", "zombies")

V = Vector


# --------------------------------------------------------------------------- CLI

def cli():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"mode": "preview", "frames": 24, "res": None, "views": None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--final":
            o["mode"] = "final"
        elif a == "--preview":
            o["mode"] = "preview"
        elif a == "--frames":
            o["frames"] = int(argv[i + 1]); i += 1
        elif a == "--res":
            w, h = argv[i + 1].lower().split("x"); o["res"] = (int(w), int(h)); i += 1
        elif a == "--views":
            o["views"] = argv[i + 1].split(","); i += 1
        i += 1
    return o


# --------------------------------------------------------------------------- scene basics

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.frame_start, sc.frame_end = 1, 250
    return sc


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    return link(e, parent)


def mesh_obj(name, bm_or_mesh, parent=None, smooth=True):
    if isinstance(bm_or_mesh, bmesh.types.BMesh):
        me = bpy.data.meshes.new(name)
        bm_or_mesh.to_mesh(me)
        bm_or_mesh.free()
    else:
        me = bm_or_mesh
    ob = bpy.data.objects.new(name, me)
    link(ob, parent)
    if smooth:
        shade_smooth(ob)
    return ob


def shade_smooth(ob, smooth=True):
    if ob.type != "MESH":
        return
    for p in ob.data.polygons:
        p.use_smooth = smooth


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def apply_modifiers(ob, keep=()):
    """Bake the whole modifier stack (at the current frame) into the mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    for m in list(ob.modifiers):
        if m.type not in keep:
            ob.modifiers.remove(m)
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def apply_transform(ob):
    """Bake location/rotation/scale into the mesh (keeps the parent)."""
    mw = ob.matrix_basis.copy()
    if ob.type == "MESH":
        ob.data.transform(mw)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    base = objs[0]
    activate(base)
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    if name:
        base.name = name
        base.data.name = name
    return base


def subdivide(ob, levels=1, simple=False):
    m = ob.modifiers.new("Subdiv", "SUBSURF")
    m.levels = m.render_levels = levels
    if simple:
        m.subdivision_type = "SIMPLE"
    return apply_modifiers(ob)


def remesh(ob, voxel=0.01, adaptivity=0.0, smooth=True):
    """Voxel remesh: fuses overlapping pieces into one clean sculptable skin."""
    m = ob.modifiers.new("Remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = adaptivity
    m.use_smooth_shade = smooth
    return apply_modifiers(ob)


def decimate(ob, ratio=0.5, planar_deg=None):
    m = ob.modifiers.new("Decimate", "DECIMATE")
    if planar_deg is not None:
        m.decimate_type = "DISSOLVE"
        m.angle_limit = math.radians(planar_deg)
    else:
        m.ratio = ratio
    return apply_modifiers(ob)


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    tris = verts = 0
    for o in objs:
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        ev.to_mesh_clear()
    return tris, verts


def descendants(root):
    out = []
    stack = list(root.children)
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


# --------------------------------------------------------------------------- primitives

def quad_sphere(name, radius=1.0, level=3, loc=(0, 0, 0), scale=(1, 1, 1), parent=None):
    """Subdivided-cube sphere: even quads, sculpts better than a UV sphere."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2 ** level - 1, use_grid_fill=True)
    for v in bm.verts:
        v.co = v.co.normalized() * radius
        v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        v.co += V(loc)
    return mesh_obj(name, bm, parent)


def tube(name, points, radii, segments=12, cap=True, parent=None):
    """Swept tube through points with per-point radius (fingers, tails, tendons, straps)."""
    bm = bmesh.new()
    rings = []
    pts = [V(p) for p in points]
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
        a = t.cross(up).normalized()
        b = t.cross(a).normalized()
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        ring = [bm.verts.new(p + (a * math.cos(2 * math.pi * k / segments) + b * math.sin(2 * math.pi * k / segments)) * r)
                for k in range(segments)]
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segments):
            bm.faces.new((r0[k], r0[(k + 1) % segments], r1[(k + 1) % segments], r1[k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm, parent)


# --------------------------------------------------------------------------- skeleton + skin

def skeleton(p=None):
    """A posed zombie skeleton as {joint: (co, radius)} plus bone pairs.

    Proportions and pose come from `p` (all optional):
      height 1.8, heads 7.5 (height in head units), shoulder 0.21, hip 0.11,
      arm 0.44 (fraction of height... total arm length / height), leg 0.48,
      hunch 0.25 (0..1 forward lean), head_tilt 0.25 (rad, sideways loll),
      arms_up (0..1 how far the arms reach forward), arm_spread 0.1,
      left_drag 0.3 (dragging left leg back), knee 0.15 (knee bend),
      r: {joint: radius} overrides; fingers: 0 (mitten) / 3..5; finger_len; toes (bool)
    Returns (joints, bones) where joints map name -> [Vector co, (rx, ry)].
    Units are metres, feet on z=0, facing -Y (Blender front view).
    """
    p = dict(p or {})
    H = p.get("height", 1.8)
    heads = p.get("heads", 7.5)
    hu = H / heads                                  # one head unit
    hunch = p.get("hunch", 0.25)
    tilt = p.get("head_tilt", 0.25)
    arms_up = p.get("arms_up", 0.85)
    spread = p.get("arm_spread", 0.1)
    drag = p.get("left_drag", 0.3)
    knee = p.get("knee", 0.15)
    sh_w = p.get("shoulder", 0.21 * H / 1.8)
    hip_w = p.get("hip", 0.11 * H / 1.8)
    head_r = p.get("head_r", hu * 0.5)

    leg = p.get("leg", 0.48) * H
    crotch = leg
    pelvis_z = crotch + 0.04 * H
    neck_z = H - hu * 1.15
    chest_z = pelvis_z + (neck_z - pelvis_z) * 0.62
    lean = hunch * 0.35 * (neck_z - pelvis_z)        # forward (-Y) offset of the upper body

    J = {}
    def put(n, co, r):
        J[n] = [V(co), r if isinstance(r, tuple) else (r, r)]

    R = {"pelvis": 0.14, "belly": 0.13, "chest": 0.15, "neck": 0.055, "head": head_r,
         "shoulder": 0.065, "elbow": 0.045, "wrist": 0.035, "hip": 0.085, "knee": 0.06,
         "ankle": 0.045, "toe": 0.04, "palm": 0.04, "finger": 0.012}
    R = {k: v * H / 1.8 for k, v in R.items()}
    R["head"] = head_r
    R.update(p.get("r", {}))

    put("pelvis", (0, 0, pelvis_z), R["pelvis"])
    put("belly", (0, -lean * 0.35, pelvis_z + (chest_z - pelvis_z) * 0.5), R["belly"])
    put("chest", (0, -lean * 0.75, chest_z), R["chest"])
    neck = V((0, -lean * 1.05, neck_z))
    put("neck", neck, R["neck"])
    head_c = neck + V((math.sin(tilt) * head_r * 0.9, -hu * 0.12 - hunch * 0.05, head_r * 1.05 * math.cos(tilt)))
    put("head", head_c, R["head"])

    for s, side in (("L", 1), ("R", -1)):
        sh = V((side * sh_w, -lean * 0.95, chest_z + (neck_z - chest_z) * 0.55))
        put(f"shoulder.{s}", sh, R["shoulder"])
        upper = p.get("arm", 0.44) * H * 0.45
        fore = p.get("arm", 0.44) * H * 0.42
        # arm direction: from hanging (0,0,-1) toward reaching forward (0,-1,0)
        a = arms_up * (1.0 if s == "L" else 0.82)
        d_up = V((side * spread, -math.sin(a * math.pi / 2), -math.cos(a * math.pi / 2))).normalized()
        el = sh + d_up * upper
        put(f"elbow.{s}", el, R["elbow"])
        d_fore = (d_up + V((0, -0.15, 0.12 * a))).normalized()
        wr = el + d_fore * fore
        put(f"wrist.{s}", wr, R["wrist"])
        nf = p.get("fingers", 0)
        palm = wr + d_fore * R["palm"] * 1.6
        put(f"palm.{s}", palm, (R["palm"] * 1.15, R["palm"] * 0.6))
        if nf:
            fl = p.get("finger_len", 0.075 * H / 1.8)
            curl = p.get("finger_curl", 0.35)
            side_ax = d_fore.cross(V((0, 0, 1))).normalized()
            if side_ax.length < 0.1:
                side_ax = V((1, 0, 0))
            for k in range(nf):
                off = (k - (nf - 1) / 2) / max(1, nf - 1)
                root = palm + d_fore * R["palm"] * 0.9 + side_ax * off * R["palm"] * 1.8
                dirk = (d_fore + side_ax * off * 0.35).normalized()
                if k == 0 and nf >= 4:  # thumb
                    root = palm + side_ax * (-side) * R["palm"] * 0.9
                    dirk = (d_fore * 0.5 - side_ax * side * 0.8 + V((0, 0, 0.2))).normalized()
                m1 = root + dirk * fl * 0.5
                dirk2 = (dirk + V((0, 0, -curl))).normalized()
                tip = m1 + dirk2 * fl * 0.5
                put(f"f{k}a.{s}", root, R["finger"])
                put(f"f{k}b.{s}", m1, R["finger"] * 0.9)
                put(f"f{k}c.{s}", tip, R["finger"] * 0.7)

        hp = V((side * hip_w, 0, pelvis_z - 0.03 * H))
        put(f"hip.{s}", hp, R["hip"])
        back = drag if s == "L" else -drag * 0.3
        kn = V((side * hip_w * 1.05, -knee * 0.25 * leg + back * 0.2 * leg, crotch * 0.52))
        put(f"knee.{s}", kn, R["knee"])
        an = V((side * hip_w * 1.1, back * 0.45 * leg, R["ankle"] * 1.6))
        if s == "L" and drag > 0:
            an.z += drag * 0.1 * leg
        put(f"ankle.{s}", an, R["ankle"])
        toe = an + V((side * 0.01, -0.17 * H / 1.8, -R["ankle"] * 0.8))
        if s == "L" and drag > 0:
            toe = an + V((side * 0.01, -0.12 * H / 1.8, -an.z + R["toe"] * 0.6))
        put(f"toe.{s}", toe, (R["toe"] * 1.3, R["toe"] * 0.8))

    B = [("pelvis", "belly"), ("belly", "chest"), ("chest", "neck"), ("neck", "head")]
    for s in "LR":
        B += [("chest", f"shoulder.{s}"), (f"shoulder.{s}", f"elbow.{s}"), (f"elbow.{s}", f"wrist.{s}"),
              (f"wrist.{s}", f"palm.{s}"), ("pelvis", f"hip.{s}"), (f"hip.{s}", f"knee.{s}"),
              (f"knee.{s}", f"ankle.{s}"), (f"ankle.{s}", f"toe.{s}")]
        k = 0
        while f"f{k}a.{s}" in J:
            B += [(f"palm.{s}", f"f{k}a.{s}"), (f"f{k}a.{s}", f"f{k}b.{s}"), (f"f{k}b.{s}", f"f{k}c.{s}")]
            k += 1
    return J, B


def skin_body(name, joints, bones, parent=None, subdiv=2, drop=(), segments=None,
              branch_smooth=0.3, apply=True):
    """Skin-modifier body. `drop` removes joints (e.g. 'head' when the head is a
    separate sculpted piece). `segments` = {(a, b): n} adds n interpolated joints
    along a bone so radii can bulge (calves, forearms)."""
    keep = {k: v for k, v in joints.items() if k not in drop}
    bm = bmesh.new()
    layer = bm.verts.layers.skin.verify()
    idx = {}
    for n, (co, r) in keep.items():
        v = bm.verts.new(co)
        v[layer].radius = r
        idx[n] = v
    for a, b in bones:
        if a not in idx or b not in idx:
            continue
        n = (segments or {}).get((a, b), 0)
        prev = idx[a]
        ra, rb = V(keep[a][1]), V(keep[b][1])
        for k in range(1, n + 1):
            t = k / (n + 1)
            v = bm.verts.new(keep[a][0].lerp(keep[b][0], t))
            rr = ra.lerp(rb, t)
            v[layer].radius = (rr.x, rr.y)
            bm.edges.new((prev, v))
            prev = v
        bm.edges.new((prev, idx[b]))
    root = idx.get("pelvis") or next(iter(idx.values()))
    root[layer].use_root = True
    ob = mesh_obj(name, bm, parent, smooth=False)
    sk = ob.modifiers.new("Skin", "SKIN")
    sk.branch_smoothing = branch_smooth
    sk.use_smooth_shade = True
    if subdiv:
        sd = ob.modifiers.new("Subdiv", "SUBSURF")
        sd.levels = sd.render_levels = subdiv
    if apply:
        apply_modifiers(ob)
        shade_smooth(ob)
    return ob


def armature_from_skeleton(name, joints, bones, parent=None):
    """An armature matching the skeleton (for later rigging / game export)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    link(ob, parent)
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for a, b in bones:
        if a not in joints or b not in joints:
            continue
        eb = arm.edit_bones.new(f"{a}>{b}")
        eb.head, eb.tail = joints[a][0], joints[b][0]
        if a in made:
            eb.parent = made[a]
        made[b] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


# --------------------------------------------------------------------------- sculpting by code

class Sculpt:
    """Brush-style vertex edits in object space. Every brush takes a centre (or a
    stroke of points), a radius and a strength, with a smooth falloff, like
    sculpt-mode brushes. Call .done() to write back and recompute normals.

        s = kit.Sculpt(head)
        s.crease_stroke([(-.04,-.1,.05), (.04,-.1,.05)], radius=.02, depth=.01)  # mouth line
        s.inflate((0,-.1,.02), .03, .008)                                       # cheek
        s.done()
    """

    def __init__(self, ob):
        self.ob = ob
        self.bm = bmesh.new()
        self.bm.from_mesh(ob.data)
        self.bm.verts.ensure_lookup_table()
        self._rebuild()

    def _rebuild(self):
        self.bm.normal_update()
        self.kd = kdtree.KDTree(len(self.bm.verts))
        for i, v in enumerate(self.bm.verts):
            self.kd.insert(v.co, i)
        self.kd.balance()
        self.normals = [v.normal.copy() for v in self.bm.verts]

    @staticmethod
    def fall(d, r, kind="smooth"):
        x = max(0.0, 1.0 - d / r)
        if kind == "sharp":
            return x * x
        if kind == "flat":
            return min(1.0, x * 3)
        return x * x * (3 - 2 * x)

    def _near(self, c, r):
        return self.kd.find_range(V(c), r)

    def inflate(self, c, r, amount, kind="smooth"):
        for co, i, d in self._near(c, r):
            self.bm.verts[i].co += self.normals[i] * amount * self.fall(d, r, kind)
        return self

    def grab(self, c, r, delta, kind="smooth"):
        delta = V(delta)
        for co, i, d in self._near(c, r):
            self.bm.verts[i].co += delta * self.fall(d, r, kind)
        return self

    def pinch(self, c, r, strength=0.3):
        c = V(c)
        for co, i, d in self._near(c, r):
            v = self.bm.verts[i]
            v.co = v.co.lerp(c, strength * self.fall(d, r))
        return self

    def scale(self, c, r, s, kind="smooth"):
        """Scale around c with falloff (s may be a 3-tuple)."""
        c = V(c)
        s = V(s) if isinstance(s, (tuple, list)) else V((s, s, s))
        for co, i, d in self._near(c, r):
            v = self.bm.verts[i]
            f = self.fall(d, r, kind)
            off = v.co - c
            tgt = c + V((off.x * s.x, off.y * s.y, off.z * s.z))
            v.co = v.co.lerp(tgt, f)
        return self

    def flatten(self, c, r, normal, strength=0.5, offset=0.0):
        c, n = V(c), V(normal).normalized()
        for co, i, d in self._near(c, r):
            v = self.bm.verts[i]
            h = (v.co - c).dot(n) - offset
            v.co -= n * h * strength * self.fall(d, r)
        return self

    def _stroke(self, pts, step):
        pts = [V(p) for p in pts]
        out = []
        for a, b in zip(pts, pts[1:]):
            n = max(1, int((b - a).length / step))
            out += [a.lerp(b, k / n) for k in range(n)]
        out.append(pts[-1])
        return out

    def crease_stroke(self, pts, radius, depth, kind="sharp"):
        """Carve a groove along a polyline (negative depth raises a ridge)."""
        best = {}
        for c in self._stroke(pts, radius * 0.35):
            for co, i, d in self._near(c, radius):
                f = self.fall(d, radius, kind)
                if f > best.get(i, 0):
                    best[i] = f
        for i, f in best.items():
            self.bm.verts[i].co -= self.normals[i] * depth * f
        return self

    def inflate_stroke(self, pts, radius, amount, kind="smooth"):
        return self.crease_stroke(pts, radius, -amount, kind)

    def noise(self, scale=8.0, amount=0.004, octaves=3, c=None, r=None, seed=0, ridged=False):
        off = V((seed * 13.1, seed * 7.7, seed * 3.3))
        items = self._near(c, r) if c is not None else [(v.co, i, 0.0) for i, v in enumerate(self.bm.verts)]
        for co, i, d in items:
            v = self.bm.verts[i]
            q = v.co * scale + off
            if ridged:
                n = 1.0 - abs(noise.noise(q, noise_basis="PERLIN_ORIGINAL")) * 2
            else:
                n = noise.fractal(q, 0.5, 2.0, octaves, noise_basis="PERLIN_ORIGINAL")
            f = self.fall(d, r) if c is not None else 1.0
            v.co += self.normals[i] * n * amount * f
        return self

    def smooth(self, iterations=2, factor=0.5, c=None, r=None):
        sel = None
        if c is not None:
            sel = {i: self.fall(d, r) for co, i, d in self._near(c, r)}
        for _ in range(iterations):
            new = {}
            for i, v in enumerate(self.bm.verts):
                w = 1.0 if sel is None else sel.get(i, 0)
                if w <= 0 or not v.link_edges:
                    continue
                avg = sum((e.other_vert(v).co for e in v.link_edges), V()) / len(v.link_edges)
                new[i] = v.co.lerp(avg, factor * w)
            for i, co in new.items():
                self.bm.verts[i].co = co
        return self

    def refresh(self):
        """Recompute normals / KD-tree after big edits (brushes use cached normals)."""
        self._rebuild()
        return self

    def done(self):
        self.bm.to_mesh(self.ob.data)
        self.bm.free()
        self.ob.data.update()
        return self.ob


# --------------------------------------------------------------------------- simulation (baked + applied)

def _step(frames):
    sc = bpy.context.scene
    sc.frame_start = 1
    sc.frame_end = max(sc.frame_end, frames)
    for f in range(1, frames + 1):
        sc.frame_set(f)


def vgroup(ob, name, weight_fn):
    """Vertex group from weight_fn(co) -> 0..1 (object space)."""
    g = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
    for v in ob.data.vertices:
        w = weight_fn(v.co)
        if w > 0:
            g.add([v.index], min(1.0, w), "REPLACE")
    return g


def inflate_cloth(ob, pressure=80.0, frames=40, shrink=0.0, stiffness=5.0, pin=None, self_collide=False):
    """Cloth with internal air pressure: turns a closed mesh into a stuffed,
    pillowy shape with fabric pull at seams. `pin` = vertex group name kept fixed.
    Measured: a 34x24x12 cm squashed ellipsoid grows to 19 cm tall at pressure 300 /
    stiffness 5, 17 cm at 100 / 3, and barely moves at 30 / 15. Smaller parts need
    more pressure. Negative `shrink` (e.g. -0.1) grows the fabric for extra puff."""
    m = ob.modifiers.new("Cloth", "CLOTH")
    s = m.settings
    s.quality = 8
    s.mass = 0.2
    s.tension_stiffness = s.compression_stiffness = stiffness
    s.shear_stiffness = stiffness * 0.5
    s.bending_stiffness = 0.1
    s.use_pressure = True
    s.uniform_pressure_force = pressure
    s.shrink_min = shrink
    s.effector_weights.gravity = 0.0
    s.air_damping = 1.0
    if pin:
        s.vertex_group_mass = pin
    m.collision_settings.use_collision = False
    m.collision_settings.use_self_collision = self_collide
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    _step(frames)
    apply_modifiers(ob)
    bpy.context.scene.frame_set(1)
    return ob


def collider(ob, thickness=0.005):
    m = ob.modifiers.new("Collision", "COLLISION")
    ob.collision.thickness_outer = thickness
    return m


def drape_cloth(ob, colliders, frames=60, pin=None, gravity=1.0, stiffness=10.0, shrink=0.0,
                self_collide=False, thickness=0.004):
    """Cloth draped over `colliders` (bodies get a temporary Collision modifier)."""
    tmp = [c for c in colliders if not any(mm.type == "COLLISION" for mm in c.modifiers)]
    for c in tmp:
        collider(c, thickness)
    m = ob.modifiers.new("Cloth", "CLOTH")
    s = m.settings
    s.quality = 8
    s.mass = 0.25
    s.tension_stiffness = s.compression_stiffness = stiffness
    s.bending_stiffness = 0.2
    s.shrink_min = shrink
    s.effector_weights.gravity = gravity
    if pin:
        s.vertex_group_mass = pin
    cs = m.collision_settings
    cs.distance_min = thickness
    cs.use_self_collision = self_collide
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    _step(frames)
    apply_modifiers(ob)
    for c in tmp:
        for mm in list(c.modifiers):
            if mm.type == "COLLISION":
                c.modifiers.remove(mm)
    bpy.context.scene.frame_set(1)
    return ob


def softbody_sag(ob, goal_group, frames=40, gravity=1.0, stiffness=0.5, damping=5.0):
    """Soft body held by a goal vertex group (1 = pinned, 0 = free): free parts
    sag, droop and jiggle under gravity, then the settled shape is applied."""
    m = ob.modifiers.new("Softbody", "SOFT_BODY")
    sb = ob.soft_body
    sb.use_goal = True
    sb.vertex_group_goal = goal_group
    sb.goal_default = 1.0
    sb.goal_min = 0.0
    sb.goal_max = 1.0
    sb.goal_spring = stiffness
    sb.goal_friction = damping
    sb.use_edges = True
    sb.pull = sb.push = 0.9
    sb.damping = damping
    sb.effector_weights.gravity = gravity
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    _step(frames)
    apply_modifiers(ob)
    bpy.context.scene.frame_set(1)
    return ob


# --------------------------------------------------------------------------- materials

class Nodes:
    """Tiny node-graph builder:  n = Nodes(mat); t = n.new('ShaderNodeTexNoise', Scale=5);
    n.link(t, 'Fac', bsdf, 'Roughness')."""

    def __init__(self, idblock, clear=True):
        try:
            idblock.use_nodes = True
        except Exception:
            pass
        self.nt = idblock.node_tree
        if clear:
            self.nt.nodes.clear()
        self.x = 0

    def new(self, kind, name=None, loc=None, **inputs):
        nd = self.nt.nodes.new(kind)
        if name:
            nd.name = nd.label = name
        nd.location = loc or (self.x, 0)
        self.x -= 220
        for k, v in inputs.items():
            if k in nd.inputs:
                nd.inputs[k].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def link(self, a, out, b, inp):
        o = a.outputs[out] if isinstance(out, (str, int)) else out
        i = b.inputs[inp] if isinstance(inp, (str, int)) else inp
        self.nt.links.new(o, i)
        return b


def _col(c):
    c = tuple(c)
    return c if len(c) == 4 else (*c, 1.0)


def mat(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, sss=0.0, sss_radius=(1.0, 0.4, 0.2),
        sss_scale=0.05, emit=None, emit_strength=0.0, sheen=0.0, coat=0.0, spec=0.5, alpha=1.0):
    """Principled material, shared by name (never deletes an existing one)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    n = Nodes(m)
    out = n.new("ShaderNodeOutputMaterial", loc=(300, 0))
    b = n.new("ShaderNodeBsdfPrincipled", "BSDF", loc=(0, 0))
    b.inputs["Base Color"].default_value = _col(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Specular IOR Level"].default_value = spec
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = sss_radius
        b.inputs["Subsurface Scale"].default_value = sss_scale
    if emit is not None:
        b.inputs["Emission Color"].default_value = _col(emit)
        b.inputs["Emission Strength"].default_value = emit_strength or 1.0
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    n.link(b, "BSDF", out, "Surface")
    m.diffuse_color = _col(color)
    return m


def bsdf(m):
    return m.node_tree.nodes.get("BSDF")


def emission_mat(name, color, strength=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    n = Nodes(m)
    out = n.new("ShaderNodeOutputMaterial", loc=(300, 0))
    e = n.new("ShaderNodeEmission", Color=_col(color), Strength=strength)
    n.link(e, "Emission", out, "Surface")
    return m


def toon_mat(name, color, shade=None, steps=((0.0, None), (0.45, None)), rim=None, spec=None):
    """Eevee-only cel shader (Shader to RGB renders black in Cycles):
    Diffuse -> Shader to RGB -> constant ramp -> emission.
    `shade` is the shadow colour (default: color * 0.45). Optional rim light colour
    and a hard specular pop (spec = (colour, threshold))."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    color = _col(color)
    shade = _col(shade) if shade else (color[0] * 0.45, color[1] * 0.42, color[2] * 0.55, 1)
    n = Nodes(m)
    out = n.new("ShaderNodeOutputMaterial", loc=(600, 0))
    d = n.new("ShaderNodeBsdfDiffuse", loc=(-600, 0))
    s2r = n.new("ShaderNodeShaderToRGB", loc=(-400, 0))
    n.link(d, "BSDF", s2r, "Shader")
    ramp = n.new("ShaderNodeValToRGB", loc=(-200, 0))
    ramp.color_ramp.interpolation = "CONSTANT"
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.0, shade
    el[1].position, el[1].color = steps[1][0], color
    n.link(s2r, "Color", ramp, "Fac")
    col_out = ramp.outputs["Color"]
    if spec:
        g = n.new("ShaderNodeBsdfGlossy", loc=(-600, -250), Roughness=0.25)
        s2 = n.new("ShaderNodeShaderToRGB", loc=(-400, -250))
        n.link(g, "BSDF", s2, "Shader")
        r2 = n.new("ShaderNodeValToRGB", loc=(-200, -250))
        r2.color_ramp.interpolation = "CONSTANT"
        r2.color_ramp.elements[1].position = spec[1]
        n.link(s2, "Color", r2, "Fac")
        mx = n.new("ShaderNodeMix", loc=(100, -100), data_type="RGBA", blend_type="MIX")
        n.link(r2, "Color", mx, 0)  # factor
        n.link(ramp, "Color", mx, 6)
        mx.inputs[7].default_value = _col(spec[0])
        col_out = mx.outputs[2]
    if rim:
        lw = n.new("ShaderNodeLayerWeight", loc=(-200, 250), Blend=0.35)
        r3 = n.new("ShaderNodeValToRGB", loc=(0, 250))
        r3.color_ramp.interpolation = "CONSTANT"
        r3.color_ramp.elements[1].position = 0.6
        n.link(lw, "Facing", r3, "Fac")
        mx2 = n.new("ShaderNodeMix", loc=(250, 100), data_type="RGBA", blend_type="MIX")
        n.link(r3, "Color", mx2, 0)
        n.nt.links.new(col_out, mx2.inputs[6])
        mx2.inputs[7].default_value = _col(rim)
        col_out = mx2.outputs[2]
    e = n.new("ShaderNodeEmission", loc=(400, 0))
    n.nt.links.new(col_out, e.inputs["Color"])
    n.link(e, "Emission", out, "Surface")
    m.diffuse_color = color
    return m


def outline(ob, thickness=0.01, color=(0, 0, 0), name="Outline"):
    """Inverted-hull ink outline (works in Eevee and Cycles)."""
    m = bpy.data.materials.get(name)
    if not m:
        m = emission_mat(name, color, 1.0)
        m.use_backface_culling = True
        try:
            m.use_backface_culling_shadow = True
        except AttributeError:
            pass
    if m.name not in [s.name for s in ob.data.materials if s]:
        ob.data.materials.append(m)
    idx = [s.name if s else None for s in ob.data.materials].index(m.name)
    if len(ob.data.materials) == 1:  # object had no material: give it a default first
        ob.data.materials.append(m)
    sol = ob.modifiers.new("Outline", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 1.0
    sol.use_flip_normals = True
    sol.use_rim = False
    sol.material_offset = idx
    sol.material_offset_rim = idx
    return sol


def assign(ob, *mats):
    ob.data.materials.clear()
    for m in mats:
        ob.data.materials.append(m)
    return ob


def assign_by(ob, fn):
    """Per-face material index from fn(face_center, face_normal) -> index."""
    for p in ob.data.polygons:
        p.material_index = fn(p.center, p.normal)
    return ob


def color_attr(ob, fn, name="Col"):
    """Per-corner colour attribute from fn(co, normal) -> (r, g, b[, a])."""
    me = ob.data
    ca = me.color_attributes.get(name) or me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
    for p in me.polygons:
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            ca.data[li].color = _col(fn(v.co, v.normal))
    return ca


# --------------------------------------------------------------------------- stage

def world(color=(0.02, 0.02, 0.025), strength=1.0):
    w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    n = Nodes(w)
    out = n.new("ShaderNodeOutputWorld", loc=(300, 0))
    bg = n.new("ShaderNodeBackground", Color=_col(color), Strength=strength)
    n.link(bg, "Background", out, "Surface")
    return w


def _aim(ob, target):
    d = V(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def area(name, loc, target=(0, 0, 1), power=300, size=1.0, color=(1, 1, 1), shape="DISK", shadow_soft=None):
    L = bpy.data.lights.new(name, "AREA")
    L.energy, L.color, L.shape = power, color[:3], shape
    L.size = size
    if shape in ("RECTANGLE", "ELLIPSE"):
        L.size_y = size
    ob = link(bpy.data.objects.new(name, L))
    ob.location = loc
    _aim(ob, target)
    return ob


def point(name, loc, power=100, radius=0.05, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, "POINT")
    L.energy, L.color = power, color[:3]
    L.shadow_soft_size = radius
    ob = link(bpy.data.objects.new(name, L))
    ob.location = loc
    return ob


def spot(name, loc, target=(0, 0, 1), power=500, angle=40, blend=0.3, radius=0.05, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, "SPOT")
    L.energy, L.color = power, color[:3]
    L.spot_size, L.spot_blend = math.radians(angle), blend
    L.shadow_soft_size = radius
    ob = link(bpy.data.objects.new(name, L))
    ob.location = loc
    _aim(ob, target)
    return ob


def sun(name, rot=(50, 0, 30), strength=3.0, angle=2.0, color=(1, 1, 1)):
    L = bpy.data.lights.new(name, "SUN")
    L.energy, L.color = strength, color[:3]
    L.angle = math.radians(angle)
    ob = link(bpy.data.objects.new(name, L))
    ob.rotation_euler = [math.radians(a) for a in rot]
    return ob


def backdrop(material, width=12, depth=8, height=6, radius=1.5, z=0.0, y_back=2.0):
    """Seamless photo-studio sweep (floor curving up into a back wall)."""
    bm = bmesh.new()
    prof = []
    for k in range(9):
        t = k / 8
        prof.append(V((0, -depth + (depth - radius) * t, z)) if False else None)
    pts = [V((0, -depth, z)), V((0, y_back - radius, z))]
    for k in range(1, 9):
        a = (math.pi / 2) * k / 8
        pts.append(V((0, y_back - radius + math.sin(a) * radius, z + radius - math.cos(a) * radius)))
    pts.append(V((0, y_back, z + height)))
    rows = []
    for x in (-width / 2, width / 2):
        rows.append([bm.verts.new(p + V((x, 0, 0))) for p in pts])
    for i in range(len(pts) - 1):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    ob = mesh_obj("Backdrop", bm)
    m = ob.modifiers.new("Sub", "SUBSURF")
    m.levels = m.render_levels = 2
    assign(ob, material)
    return ob


def floor_disc(material, radius=3.0, z=0.0):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=radius, segments=64)
    for v in bm.verts:
        v.co.z = z
    ob = mesh_obj("Floor", bm)
    assign(ob, material)
    return ob


def camera(target_h=0.9, dist=4.5, lens=70, elev=0.15, ortho=None):
    """Camera looking at the character from the front (-Y), slightly above."""
    cam = bpy.data.cameras.new("Camera")
    cam.lens = lens
    cam.clip_start, cam.clip_end = 0.05, 200
    if ortho:
        cam.type = "ORTHO"
        cam.ortho_scale = ortho
    ob = link(bpy.data.objects.new("Camera", cam))
    ob.location = (0, -dist, target_h + dist * elev)
    _aim(ob, (0, 0, target_h))
    bpy.context.scene.camera = ob
    return ob


def frame_to(cam_ob, root, margin=1.12, height=None, aim_frac=0.5, elev=0.12):
    """Frame the character so it fits the render at every turntable angle: its
    height and its widest reach around the vertical axis (arms, cloaks) both fit.
    Places the camera in front (-Y), `elev` radians above the aim point."""
    objs = [o for o in descendants(root) if o.type == "MESH" and not o.hide_render]
    pts = [o.matrix_world @ V(c) for o in objs for c in o.bound_box]
    zmin, zmax = (min(p.z for p in pts), max(p.z for p in pts)) if pts else (0, 1.8)
    reach = max((V((p.x, p.y)).length for p in pts), default=0.5)
    h = (height or (zmax - zmin)) * margin
    w = 2 * reach * margin
    cam = cam_ob.data
    cam.sensor_fit = "AUTO"   # sensor_width spans the larger image dimension
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / sc.render.resolution_y
    tgt = V((0, 0, zmin + (zmax - zmin) * aim_frac))
    if cam.type == "ORTHO":
        cam.ortho_scale = max(h, w / aspect) if aspect < 1 else max(h * aspect, w)
        dist = 20
    else:
        half = math.atan(cam.sensor_width / (2 * cam.lens))       # larger dimension
        tan_h = math.tan(half) if aspect >= 1 else math.tan(half) * aspect
        tan_v = math.tan(half) / aspect if aspect >= 1 else math.tan(half)
        dist = max((h / 2) / tan_v, (w / 2) / tan_h) + reach * 0.5
    cam_ob.location = tgt + V((0, -dist * math.cos(elev), dist * math.sin(elev)))
    _aim(cam_ob, tgt)
    return cam_ob


# --------------------------------------------------------------------------- render

def cycles_gpu():
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                break
            except TypeError:
                continue
        if hasattr(prefs, "refresh_devices"):
            prefs.refresh_devices()
        else:
            prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
        bpy.context.scene.cycles.device = "GPU"
    except Exception as e:  # CPU fallback
        print("cycles GPU unavailable:", e)


def render_setup(engine="EEVEE", res=(900, 1200), samples=64, view="AgX", look="None",
                 exposure=0.0, transparent=False, filter_px=1.5):
    sc = bpy.context.scene
    r = sc.render
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.film_transparent = transparent
    r.filter_size = filter_px
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA" if transparent else "RGB"
    if engine == "CYCLES":
        r.engine = "CYCLES"
        cycles_gpu()
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.use_adaptive_sampling = True
    else:
        r.engine = "BLENDER_EEVEE"
        e = sc.eevee
        e.taa_render_samples = samples
        for attr, val in (("use_raytracing", True), ("use_shadows", True), ("shadow_ray_count", 2),
                          ("shadow_step_count", 8), ("use_gtao", True)):
            if hasattr(e, attr):
                try:
                    setattr(e, attr, val)
                except Exception:
                    pass
    vs = sc.view_settings
    vs.view_transform = view
    try:
        vs.look = look
    except TypeError:
        vs.look = "None"
    vs.exposure = exposure
    return sc


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = os.path.abspath(path)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


def numpy_post(path, fn):
    """Load a rendered PNG, run fn(np_array HxWx4 float, top row first) -> array, save."""
    import numpy as np
    img = bpy.data.images.load(os.path.abspath(path), check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[::-1].copy()
    a = fn(a)
    hh, ww = a.shape[:2]
    out = bpy.data.images.new("post", ww, hh, alpha=True)
    out.pixels.foreach_set(np.ascontiguousarray(a[::-1]).reshape(-1).astype(np.float32))
    out.filepath_raw = os.path.abspath(path)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)


VIEWS = {"front": 0, "three_quarter": -35, "side": -90, "back": 180, "three_quarter_back": 145}


def run(style, build, stage, post=None, meta=None):
    """Build, stage and render one style. `post(path)` post-processes each render."""
    o = cli()
    out = os.path.join(OUT_BASE, style)
    os.makedirs(out, exist_ok=True)
    reset()
    t0 = time.time()
    root = build()
    t_build = time.time() - t0
    stage(root)
    sc = bpy.context.scene
    if o["res"]:
        sc.render.resolution_x, sc.render.resolution_y = o["res"]
    parts = [x for x in descendants(root) if x.type == "MESH"]
    tris, verts = tri_count(parts)
    zs = [(o.matrix_world @ V(c)).z for o in parts if not o.hide_render for c in o.bound_box]
    info = {"style": style, "tris": tris, "verts": verts, "build_s": round(t_build, 1),
            "engine": sc.render.engine, "height_m": round(max(zs) - min(zs), 2) if zs else None,
            **(meta or {})}
    print(f"[{style}] built in {t_build:.1f}s, {tris} tris, {verts} verts")

    def shoot(name, yaw):
        root.rotation_euler.z = math.radians(yaw)
        p = os.path.join(out, f"{name}.png")
        dt = render_to(p)
        if post:
            post(p)
        print(f"[{style}] {name}: {dt:.1f}s")
        return dt

    if o["mode"] == "preview":
        if not o["res"]:
            sc.render.resolution_percentage = 50
        views = o["views"] or ["three_quarter"]
        for v in views:
            shoot(f"preview_{v}", VIEWS.get(v, float(v) if v.lstrip("-").isdigit() else 0))
    else:
        times = {}
        for v in o["views"] or ["three_quarter", "front", "side", "back"]:
            times[v] = shoot(v, VIEWS[v])
        info["render_s"] = round(times.get("three_quarter", 0), 1)
        tdir = os.path.join(out, "turntable")
        os.makedirs(tdir, exist_ok=True)
        n = o["frames"]
        if n:
            keep = (sc.render.resolution_x, sc.render.resolution_y)
            sc.render.resolution_x, sc.render.resolution_y = keep[0] * 2 // 3, keep[1] * 2 // 3
            for i in range(n):
                shoot(os.path.join("turntable", f"f_{i:02d}"), -360.0 * i / n)
            sc.render.resolution_x, sc.render.resolution_y = keep
        root.rotation_euler.z = math.radians(VIEWS["three_quarter"])
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"{style}.blend"), compress=True)
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(info, f, indent=2)
    print(f"[{style}] done in {time.time() - t0:.1f}s -> {out}")
