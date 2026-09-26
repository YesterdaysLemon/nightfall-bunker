# Toolkit smoke test and API example: skin body, sculpted head, cloth inflation,
# soft-body sag, cloth drape, outline. node art/zombies/blend.mjs _example.py
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, bpy
from mathutils import Vector as V

def build():
    root = kit.empty("ZOMBIE")
    J, B = kit.skeleton({"fingers": 4, "hunch": 0.3})
    body = kit.skin_body("Body", J, B, parent=root, drop=("head",), segments={("knee.L", "ankle.L"): 1, ("knee.R", "ankle.R"): 1})
    hc = J["head"][0]; hr = J["head"][1][0]
    head = kit.quad_sphere("Head", hr, 4, loc=hc, scale=(0.92, 1.0, 1.1), parent=root)
    s = kit.Sculpt(head)
    for sx in (-1, 1):
        s.crease_stroke([hc + V((sx * hr * 0.25, -hr, hr * 0.1)), hc + V((sx * hr * 0.45, -hr * 0.9, hr * 0.12))], hr * 0.2, hr * 0.12)
    s.crease_stroke([hc + V((-hr * 0.35, -hr, -hr * 0.4)), hc + V((hr * 0.35, -hr, -hr * 0.35))], hr * 0.12, hr * 0.08)
    s.inflate(hc + V((0, -hr, -0.05 * hr)), hr * 0.25, hr * 0.12)
    s.noise(18, hr * 0.02)
    s.smooth(1, 0.3)
    s.done()
    # pillow: cloth pressure
    pil = kit.quad_sphere("Pillow", 0.12, 3, loc=(0.45, 0, 0.12), scale=(1.4, 1, 0.5), parent=root)
    kit.inflate_cloth(pil, pressure=8, frames=25)
    # dangling tongue: soft body sag
    tg = kit.tube("Tongue", [hc + V((0, -hr * 0.9, -hr * 0.45)), hc + V((0, -hr * 1.1, -hr * 0.6)), hc + V((0, -hr * 1.25, -hr * 0.7))], [0.02, 0.018, 0.012], parent=root)
    kit.vgroup(tg, "goal", lambda co: 1.0 if co.y > (hc.y - hr * 0.95) else 0.0)
    kit.softbody_sag(tg, "goal", frames=20)
    # cape: cloth drape over body
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=24, y_subdivisions=24, size=0.7, location=(0, 0.1, J["chest"][0].z + 0.3))
    cape = bpy.context.active_object; cape.name = "Cape"; cape.parent = root
    kit.vgroup(cape, "pin", lambda co: 1.0 if co.y > 0.3 else 0.0)
    kit.drape_cloth(cape, [body], frames=30, pin="pin")
    clay = kit.mat("Clay", (0.6, 0.55, 0.5), 0.6)
    for o in (body, head, pil, tg, cape):
        kit.assign(o, clay)
    kit.outline(head, 0.006)
    return root

def stage(root):
    kit.render_setup("EEVEE", (600, 800), 32)
    kit.world((0.05, 0.05, 0.06), 1)
    kit.backdrop(kit.mat("Bg", (0.3, 0.3, 0.32), 0.8))
    kit.area("Key", (-2, -3, 3.5), (0, 0, 1), 900, 2)
    kit.area("Rim", (2.5, 2, 2.5), (0, 0, 1.2), 500, 1)
    cam = kit.camera()
    kit.frame_to(cam, root)

kit.run("_kittest", build, stage)
