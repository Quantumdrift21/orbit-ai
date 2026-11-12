# Flow, Orbit's second character, modelled in Blender: a chibi genie-scholar (small form) and the mage
# it transforms into (big form). Stylised and smooth (no painted detail): hand-set flat colours, soft shapes.
# Exports renderer/models/flow-genie.glb.js and flow-mage.glb.js the same way tools/aerostrike.py does.
#
# Run:  blender -b -P tools/flow.py                        (export both)
#       blender -b -P tools/flow.py -- --preview DIR        (also render DIR/flow-genie.png, flow-mage.png)
#       blender -b -P tools/flow.py -- --only genie|mage    (just one form)
#       blender -b -P tools/flow.py -- --blend              (also save tools/flow-<form>.blend to look around)
#
# Coordinates: Blender is Z-up with the front facing -Y; glTF/three.js turns that into Y-up, front +Z.
# Limbs hang from named empties (shoulderR, elbowR, wristR, ... tail0..tail2) that match the joint names
# in renderer/joints.js; the renderer poses those, so the model is built in a neutral pose.
# Material names matter: the renderer keeps them all fixed except `glow`, which follows the state colour.
import base64
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []


# ---------- materials ----------
def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def material(name, hex_, rough=0.6, metal=0.0, emit=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    rgb = srgb(hex_)
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m


MAT = {}


def make_materials():
    """Fresh materials for a new scene (each form is built in an empty file)."""
    MAT.clear()
    MAT.update(
        {
            'skin': material('skin', 'C98A5E', 0.7),
            'hair': material('hair', '2A1F1C', 0.75),
            'iris': material('iris', '5A4FA8', 0.3),
            'cloth-white': material('cloth-white', 'F2F0EA', 0.9),
            'cloth-blue': material('cloth-blue', '3B55B5', 0.85),
            'cloth-navy': material('cloth-navy', '26376F', 0.85),  # the mage's shirt and sleeves
            'cloth-brown': material('cloth-brown', '5C4631', 0.9),  # the mage's trousers
            'leather': material('leather', '6B4527', 0.75),
            'bone': material('bone', 'E9E1CC', 0.6),
            'gold': material('gold', 'D9A94C', 0.35, 1.0),
            'dark': material('dark', '15171D', 0.5),  # eyes, brows, goatee
            'white': material('white', 'F6F6F6', 0.3),  # eye highlights
            'glow': material('glow', '3F9BF0', 0.4, 0.0, 0.8, 0.6),  # tail and hand aura; state-coloured in Orbit
        }
    )

S = (-1, 1)  # sides: -1 = Flow's right (screen left), 1 = Flow's left


# ---------- helpers ----------
def finish(o, mat):
    o.data.materials.clear()
    o.data.materials.append(MAT[mat])
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth()
    o.select_set(False)
    return o


def place(o, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    o.location = loc
    o.rotation_euler = rot
    if scale:
        o.scale = scale
    return o


def sphere(r, seg=40, rings=24, **kw):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    return place(bpy.context.object, **kw)


def cyl(r, depth, r2=None, n=40, **kw):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=n)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=n)
    return place(bpy.context.object, **kw)


def torus(major, minor, **kw):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=48, minor_segments=12)
    return place(bpy.context.object, **kw)


def box(size, **kw):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return place(o, **kw)


def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def boolean(o, cutter, op='DIFFERENCE'):
    apply_all(o)
    m = o.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    apply_all(o)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return o


def subsurf(o, levels=2):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = m.render_levels = levels
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def pivot(name, loc, parts, parent=None):
    """A named empty at `loc` (Blender coords) with `parts` built in world space hanging under it."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    for p in parts:
        p.parent = e
        p.matrix_parent_inverse = e.matrix_world.inverted()
    return e


def armature(name, bones, meshes):
    """A bone chain (name, head, tail) in world coords, skinning `meshes` with automatic weights, so the
    renderer can bend soft parts (smoke, cloth) by rotating bones of the same names as its joints."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    made = {}
    for bname, head, tail, parent in bones:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = head, tail
        if parent:
            b.parent = made[parent]
        made[bname] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        apply_all(m)
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    bpy.ops.object.select_all(action='DESELECT')
    return ob


def curve_tube(points, r, taper, name):
    """A smooth tube through `points`; `taper` = radius factors along it."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 6
    cu.resolution_u = 16
    sp = cu.splines.new('NURBS')
    sp.points.add(len(points) - 1)
    for pt, co in zip(sp.points, points):
        pt.co = (*co, 1)
    sp.use_endpoint_u = True
    sp.order_u = 4
    tc = bpy.data.curves.new(name + 'Taper', 'CURVE')
    tc.dimensions = '2D'
    ts = tc.splines.new('NURBS')
    ts.points.add(len(taper) - 1)
    for i, (pt, f) in enumerate(zip(ts.points, taper)):
        pt.co = (i / (len(taper) - 1), f, 0, 1)
    ts.use_endpoint_u = True
    ts.order_u = 3
    to = bpy.data.objects.new(name + 'Taper', tc)
    bpy.context.collection.objects.link(to)
    cu.taper_object = to
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    bpy.data.objects.remove(to, do_unlink=True)
    return o


# ---------- head: big round chibi head, swept hair, feather, earrings, a face the renderer animates ----------
HEAD = (0, 0, 1.25)
HEAD_R = 0.82


def spike(loc, direction, length, r):
    """A hair spike: an ellipsoid at `loc` pointing along `direction` (Blender coords)."""
    d = Vector(direction).normalized()
    o = sphere(r, 16, 10, loc=Vector(loc) + d * length * 0.4, scale=(1, 1, length / r * 0.5))
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o


def build_head():
    hx, hy, hz = HEAD
    p = [finish(sphere(HEAD_R, 48, 32, loc=HEAD, scale=(1.0, 0.92, 0.94)), 'skin')]
    for s in S:  # ears with a dangling gold earring
        p.append(finish(sphere(0.12, loc=(hx + s * 0.8, hy + 0.02, hz - 0.12), scale=(0.5, 0.8, 1)), 'skin'))
        p.append(finish(cyl(0.012, 0.16, n=8, loc=(hx + s * 0.82, hy - 0.02, hz - 0.3)), 'gold'))
        p.append(finish(sphere(0.04, 12, 8, loc=(hx + s * 0.82, hy - 0.02, hz - 0.4), scale=(1, 1, 1.4)), 'gold'))
    # Face parts are named so renderer/flow.js can blink, raise a brow and open the mouth to the voice.
    for s in S:  # big round purple eyes: white, iris, pupil, highlight (one object); thick brows toward the nose
        eye = [finish(sphere(0.13, loc=(hx + s * 0.3, hy - 0.68, hz - 0.08), scale=(1.0, 0.5, 1.25)), 'white')]
        eye.append(finish(sphere(0.1, loc=(hx + s * 0.3, hy - 0.73, hz - 0.1), scale=(1.0, 0.45, 1.25)), 'iris'))
        eye.append(finish(sphere(0.055, 12, 8, loc=(hx + s * 0.3, hy - 0.77, hz - 0.12), scale=(1.0, 0.5, 1.3)), 'dark'))
        eye.append(finish(sphere(0.035, 12, 8, loc=(hx + s * 0.26, hy - 0.81, hz - 0.02)), 'white'))
        for o in eye:
            apply_all(o)
        p.append(join(eye, 'eye' + ('L' if s > 0 else 'R')))
        brow = box((0.3, 0.06, 0.075), loc=(hx + s * 0.3, hy - 0.71, hz + 0.15))
        brow.rotation_euler = (0.25, -s * 0.35, 0)
        brow.name = 'brow' + ('L' if s > 0 else 'R')
        p.append(finish(brow, 'dark'))
    p.append(finish(sphere(0.07, loc=(hx, hy - 0.78, hz - 0.3), scale=(0.9, 0.7, 0.8)), 'skin'))  # nose
    # confident half-smile: a thin arc, lifted on the character's left; and an open mouth, closed flat
    # until it talks (flow.js scales it with the voice and hides the smile meanwhile)
    smile = torus(0.13, 0.014, loc=(hx + 0.05, hy - 0.74, hz - 0.48), rot=(math.pi / 2 - 0.3, 0, 0.1))
    boolean(smile, box((1, 1, 1), loc=(hx + 0.05, hy - 0.74, hz - 0.48 + 0.5 - 0.02)))  # keep the lower arc
    smile.name = 'smile'
    p.append(finish(smile, 'dark'))
    mouth = sphere(0.1, 20, 12, loc=(hx, hy - 0.74, hz - 0.5), scale=(1.0, 0.4, 0.6))
    mouth.name = 'mouth'
    p.append(finish(mouth, 'dark'))
    p.append(finish(box((0.2, 0.05, 0.03), loc=(hx, hy - 0.76, hz - 0.42)), 'dark'))  # thin moustache
    p.append(finish(sphere(0.07, 16, 12, loc=(hx, hy - 0.66, hz - 0.72), scale=(0.9, 0.5, 1.0)), 'dark'))  # goatee
    # hair: swept, spiky, parted to the character's right and pushed up and left; a scalp cap underneath,
    # a thick fringe, side locks over the ears and tufts spilling at the back
    parts = [sphere(HEAD_R * 1.03, 32, 20, loc=(hx, hy + 0.06, hz + 0.08))]
    boolean(parts[0], box((3, 3, 3), loc=(hx, hy, hz + 0.25 - 1.5)))  # keep the cap above the ears
    boolean(parts[0], box((1.6, 1.2, 1.2), loc=(hx, hy - 1.0, hz - 0.15)))  # open the face below the hairline
    rnd = [0.0, 0.6, -0.4, 0.9, -0.7, 0.3, -0.2, 0.8, -0.9, 0.5, 0.1, -0.6, 0.4, -0.3]
    for i in range(14):  # fringe: spikes off the hairline swept sideways to the character's left, a few up
        t = (i / 13 - 0.5) * 2
        base = (hx + t * 0.7, hy - 0.5 + abs(t) * 0.3, hz + 0.42 + (1 - abs(t)) * 0.1)
        d = (1.0 - t * 0.3, -0.45, 0.35 + rnd[i] * 0.35)
        parts.append(spike(base, d, 0.8 + 0.25 * abs(rnd[i]), 0.14))
    for i in range(5):  # bangs falling across the brow, to the character's left
        t = (i / 4 - 0.5) * 2
        base = (hx + t * 0.45 - 0.1, hy - 0.6, hz + 0.52)
        parts.append(spike(base, (0.9 + t * 0.2, -0.3, -0.4 + rnd[i] * 0.15), 0.5, 0.11))
    for i in range(10):  # crown and back tufts, flaring out nearly flat
        a = i / 10 * math.tau
        base = (hx + math.cos(a) * 0.5, hy + 0.1 + math.sin(a) * 0.45, hz + 0.55)
        parts.append(spike(base, (math.cos(a) * 1.0, math.sin(a) * 1.0 + 0.2, 0.3 + rnd[i] * 0.25), 0.8, 0.16))
    for s in S:  # two side locks swept back past the ears
        for k in range(2):
            base = (hx + s * 0.72, hy + 0.2 + k * 0.2, hz + 0.3 - k * 0.15)
            parts.append(spike(base, (s * 0.7, 0.9, -0.5), 0.7, 0.14))
    hair = join(parts, 'hair')
    mod = hair.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = 0.035
    apply_all(hair)
    sm = hair.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.6
    sm.iterations = 1
    apply_all(hair)
    p.append(finish(hair, 'hair'))
    # white feather tucked in on the character's left, sweeping up and out: a tapered leaf with a quill
    rot = (0.25, -0.75, 0.35)
    at = (hx + 0.8, hy - 0.2, hz + 0.85)
    p.append(finish(sphere(0.13, 24, 16, loc=at, rot=rot, scale=(0.3, 1.0, 3.6)), 'cloth-white'))
    p.append(finish(cyl(0.015, 0.9, n=8, loc=at, rot=rot), 'bone'))
    p.append(finish(torus(0.05, 0.012, loc=(hx + 0.62, hy - 0.1, hz + 0.55), rot=(0.25, -0.75, 0.35)), 'gold'))  # feather clasp
    return pivot('neck', (0, 0, 0.42), p)


# ---------- torso: bare chest, white shawl over the shoulders, bead necklace, scroll bandolier, blue sash ----------
def build_torso():
    p = [finish(cyl(0.17, 0.3, n=24, loc=(0, 0, 0.38)), 'skin')]  # neck
    p.append(finish(sphere(0.52, 40, 24, loc=(0, 0, -0.05), scale=(1.0, 0.72, 0.9)), 'skin'))  # chest
    p.append(finish(sphere(0.42, 40, 24, loc=(0, 0.02, -0.48), scale=(0.9, 0.7, 0.8)), 'skin'))  # belly
    # wrap: a rolled white cloth around the shoulders, dipping at the front, with a square blue brooch
    wrap = torus(0.56, 0.17, loc=(0, 0.02, 0.2), rot=(0.18, 0, 0))
    wrap.scale = (1.0, 0.8, 0.5)
    p.append(finish(subsurf(wrap, 1), 'cloth-white'))
    for s in S:  # the wrap's ends draping flat down over the upper arms
        drape = sphere(0.17, 24, 16, loc=(s * 0.62, -0.1, -0.08), scale=(0.8, 0.5, 1.5))
        p.append(finish(drape, 'cloth-white'))
    brooch = box((0.14, 0.05, 0.14), loc=(0, -0.58, 0.1), rot=(0, math.pi / 4, 0))  # diamond gem
    p.append(finish(brooch, 'iris'))
    frame = box((0.18, 0.04, 0.18), loc=(0, -0.57, 0.1), rot=(0, math.pi / 4, 0))
    boolean(frame, box((0.13, 0.1, 0.13), loc=(0, -0.57, 0.1), rot=(0, math.pi / 4, 0)))
    p.append(finish(frame, 'gold'))
    for i in range(14):  # necklace: a ring of gold beads below the collar
        a = math.pi * (0.1 + 0.8 * i / 13)
        p.append(finish(sphere(0.04, 12, 8, loc=(math.cos(a) * 0.3, -math.sin(a) * 0.3 - 0.12, 0.3 - math.sin(a) * 0.06)), 'gold'))
    # bandolier: leather strap from the left shoulder to the right hip, three big bone scroll cases across it
    strap = torus(0.58, 0.035, loc=(0, -0.02, -0.15), rot=(math.pi / 2 - 0.35, 0, 0.55))
    boolean(strap, box((2, 2, 2), loc=(0, 0.95, 0)))  # only the front half
    p.append(finish(strap, 'leather'))
    for t in (-0.22, 0.0, 0.22):
        loc = Vector((t * 0.85 - 0.02, -0.52 - abs(t) * 0.05, -0.15 - t * 0.6))
        rot = Euler((0.0, 0.6, 0.25))
        p.append(finish(cyl(0.1, 0.5, n=20, loc=loc, rot=rot), 'bone'))
        for e in (-0.22, 0.22):
            p.append(finish(cyl(0.11, 0.05, n=20, loc=loc + rot.to_matrix() @ Vector((0, 0, e)), rot=rot), 'leather'))
    pouch = box((0.16, 0.12, 0.18), loc=(-0.4, -0.3, -0.7), rot=(0, 0, -0.3))  # belt pouch on the right hip
    p.append(finish(subsurf(pouch, 2), 'leather'))
    # waist: blue sash over white skirt panels, a leather belt with a buckle, a sash tail at the left hip
    p.append(finish(subsurf(cyl(0.44, 0.3, r2=0.5, n=40, loc=(0, 0, -0.72)), 1), 'cloth-blue'))
    skirt = cyl(0.46, 0.5, r2=0.3, n=40, loc=(0, 0, -1.08))  # white skirt the smoke pours out of
    skirt.scale = (1.0, 0.9, 1.0)
    p.append(finish(subsurf(skirt, 2), 'cloth-white'))
    p.append(finish(torus(0.47, 0.04, loc=(0, 0, -0.62)), 'leather'))
    p.append(finish(box((0.14, 0.05, 0.12), loc=(0, -0.47, -0.62)), 'gold'))
    fold = cyl(0.12, 0.7, r2=0.04, n=20, loc=(0.46, -0.08, -1.05), rot=(0.1, -0.25, 0))  # sash tail
    p.append(finish(subsurf(fold, 1), 'cloth-blue'))
    return pivot('spine', (0, 0, -0.6), p)


# ---------- arms: short chibi arms, blue cloth sleeves on the forearms, open glowing hands ----------
def build_arms():
    for s in S:
        side = 'L' if s > 0 else 'R'
        sx, sz = s * 0.5, 0.2  # shoulder pivot, inside the chest's edge

        def at(x, y, z):
            return (sx + s * x, y, sz + z)

        upper = [finish(sphere(0.19, loc=at(0, 0, 0)), 'skin')]
        upper.append(finish(cyl(0.15, 0.5, r2=0.13, n=24, loc=at(0, 0, -0.27)), 'skin'))
        fore = [finish(sphere(0.14, loc=at(0, 0, -0.55)), 'skin')]
        fore.append(finish(subsurf(cyl(0.17, 0.5, r2=0.21, n=32, loc=at(0, 0, -0.84)), 1), 'cloth-blue'))
        fore.append(finish(torus(0.2, 0.025, loc=at(0, 0, -1.08)), 'cloth-white'))  # cuff
        # hand: a rounded palm, four stubby fingers and a thumb, lit by a soft glow orb
        hand = [finish(sphere(0.18, loc=at(0, 0, -1.24), scale=(1.0, 0.6, 1.1)), 'skin')]
        for i in range(4):
            fx = (i - 1.5) * 0.095
            hand.append(finish(sphere(0.055, 12, 8, loc=at(fx, -0.03, -1.47 - 0.02 * abs(i - 1.5))), 'skin'))
            hand.append(finish(cyl(0.05, 0.14, n=12, loc=at(fx, -0.03, -1.4)), 'skin'))
        hand.append(finish(cyl(0.055, 0.16, n=12, loc=at(0.19, -0.07, -1.28), rot=(0.3, s * 0.9, 0)), 'skin'))  # thumb
        hand.append(finish(sphere(0.055, 12, 8, loc=at(0.24, -0.09, -1.34)), 'skin'))
        hand.append(finish(sphere(0.16, loc=at(0, -0.22, -1.38)), 'glow'))
        sh = pivot('shoulder' + side, at(0, 0, 0), upper)
        el = pivot('elbow' + side, at(0, 0, -0.55), fore, sh)
        pivot('wrist' + side, at(0, 0, -1.12), hand, el)
        if '--preview' in ARGS:  # pose for the preview only: arms swung out to the sides, forearms raised
            sh.rotation_euler = (-0.2, -s * 1.0, 0)
            el.rotation_euler = (-1.1, -s * 0.3, 0)


# ---------- mage: the big form. Same head, a tall body in a navy shirt, white cape over the shoulders,
# scroll bandolier, blue sash over a long skirt-wrap, brown trousers, navy boots, a floating book ----------
def build_mage_torso():
    p = [finish(cyl(0.16, 0.35, n=24, loc=(0, 0, 1.9)), 'skin')]  # neck
    p.append(finish(sphere(0.55, 40, 24, loc=(0, 0, 1.45), scale=(1.0, 0.6, 0.8)), 'cloth-navy'))  # chest
    p.append(finish(cyl(0.42, 0.9, r2=0.36, n=40, loc=(0, 0, 0.85)), 'cloth-navy'))  # abdomen
    p.append(finish(sphere(0.2, loc=(0, -0.18, 1.72), scale=(1.6, 0.6, 0.5)), 'skin'))  # open collar
    # cape: a white cloth over both shoulders, hanging down the back, two front panels, square brooch
    cape = []
    for s in S:  # shoulder drapes
        p.append(finish(sphere(0.3, 24, 16, loc=(s * 0.5, 0.0, 1.78), scale=(1.1, 0.9, 0.55)), 'cloth-white'))
        front = box((0.26, 0.05, 2.0), loc=(s * 0.34, -0.3, 0.7), rot=(0.1, 0, s * 0.04))
        cape.append(finish(subsurf(front, 2), 'cloth-white'))
    brooch = box((0.16, 0.05, 0.16), loc=(0, -0.42, 1.62), rot=(0, math.pi / 4, 0))
    p.append(finish(brooch, 'iris'))
    frame = box((0.2, 0.04, 0.2), loc=(0, -0.41, 1.62), rot=(0, math.pi / 4, 0))
    boolean(frame, box((0.15, 0.1, 0.15), loc=(0, -0.41, 1.62), rot=(0, math.pi / 4, 0)))
    p.append(finish(frame, 'gold'))
    for i in range(14):  # gold bead necklace
        a = math.pi * (0.1 + 0.8 * i / 13)
        p.append(finish(sphere(0.035, 12, 8, loc=(math.cos(a) * 0.26, -math.sin(a) * 0.24 - 0.12, 1.76 - math.sin(a) * 0.06)), 'gold'))
    # bandolier with three bone scroll cases
    strap = torus(0.6, 0.035, loc=(0, 0.0, 1.0), rot=(math.pi / 2 - 0.3, 0, 0.5))
    strap.scale = (1.0, 1.0, 1.5)
    boolean(strap, box((2, 2, 3), loc=(0, 1.0, 1.0)))
    p.append(finish(strap, 'leather'))
    for t in (-0.22, 0.0, 0.22):
        loc = Vector((t * 0.8 - 0.02, -0.5 - abs(t) * 0.04, 1.2 - t * 0.8))
        rot = Euler((0.0, 0.55, 0.3))
        p.append(finish(cyl(0.09, 0.5, n=20, loc=loc, rot=rot), 'bone'))
        for e in (-0.22, 0.22):
            p.append(finish(cyl(0.1, 0.05, n=20, loc=loc + rot.to_matrix() @ Vector((0, 0, e)), rot=rot), 'leather'))
    # waist: leather belt and buckle, blue sash with a long tail, white skirt-wrap panels to the knees
    p.append(finish(torus(0.42, 0.045, loc=(0, 0, 0.45)), 'leather'))
    p.append(finish(box((0.16, 0.05, 0.14), loc=(0, -0.42, 0.45)), 'gold'))
    p.append(finish(subsurf(cyl(0.44, 0.5, r2=0.5, n=40, loc=(0, 0, 0.2)), 1), 'cloth-blue'))
    sash = box((0.26, 0.05, 1.3), loc=(0.42, -0.2, -0.45), rot=(0.08, -0.1, 0.1))
    p.append(finish(subsurf(sash, 2), 'cloth-blue'))
    for s in S:
        panel = box((0.36, 0.05, 1.5), loc=(s * 0.36, -0.3, -0.75), rot=(0.1, 0, s * 0.08))
        p.append(finish(subsurf(panel, 2), 'cloth-white'))
    back = box((1.0, 0.06, 2.6), loc=(0, 0.42, 0.5), rot=(-0.06, 0, 0))  # cape down the back
    cape.append(finish(subsurf(back, 2), 'cloth-white'))
    # cape bones: the renderer's wing joints swing the two fronts, `cape` the back; each bends along its length
    bones = []
    for s, nm in ((-1, 'wingR'), (1, 'wingL')):
        bones += [(nm, (s * 0.34, -0.3, 1.7), (s * 0.34, -0.3, 0.7), None), (nm + '1', (s * 0.34, -0.3, 0.7), (s * 0.34, -0.3, -0.3), nm)]
    bones += [('cape', (0, 0.42, 1.8), (0, 0.42, 0.5), None), ('cape1', (0, 0.42, 0.5), (0, 0.42, -0.8), 'cape')]
    p.append(armature('capeRig', bones, cape))
    pouch = box((0.2, 0.14, 0.22), loc=(-0.4, -0.25, 0.2), rot=(0, 0, -0.2))
    p.append(finish(subsurf(pouch, 2), 'leather'))
    # floating book at the left hip: leather cover, bone pages
    bk = Vector((0.8, -0.3, 0.0))
    rot = (1.25, 0.2, -0.35)  # cover toward the viewer, tilted as if floating open-ish
    p.append(finish(box((0.46, 0.34, 0.12), loc=bk, rot=rot), 'leather'))
    p.append(finish(box((0.44, 0.3, 0.16), loc=bk, rot=rot), 'bone'))
    p.append(finish(box((0.1, 0.36, 0.14), loc=bk + Euler(rot).to_matrix() @ Vector((-0.2, 0, 0)), rot=rot), 'leather'))  # spine
    return pivot('spine', (0, 0, 0.5), p)


def build_mage_arms():
    for s in S:
        side = 'L' if s > 0 else 'R'
        sx, sz = s * 0.58, 1.75

        def at(x, y, z):
            return (sx + s * x, y, sz + z)

        upper = [finish(sphere(0.2, loc=at(0, 0, 0)), 'cloth-navy')]
        upper.append(finish(cyl(0.16, 0.85, r2=0.13, n=24, loc=at(0, 0, -0.45)), 'cloth-navy'))
        upper.append(finish(torus(0.165, 0.025, loc=at(0, 0, -0.3)), 'gold'))  # arm band
        fore = [finish(sphere(0.14, loc=at(0, 0, -0.88)), 'cloth-navy')]
        fore.append(finish(cyl(0.13, 0.75, r2=0.16, n=24, loc=at(0, 0, -1.28)), 'cloth-navy'))
        fore.append(finish(torus(0.16, 0.025, loc=at(0, 0, -1.62)), 'gold'))  # cuff band
        hand = [finish(sphere(0.15, loc=at(0, 0, -1.8), scale=(1.0, 0.6, 1.1)), 'skin')]
        for i in range(4):
            fx = (i - 1.5) * 0.08
            hand.append(finish(cyl(0.04, 0.16, n=12, loc=at(fx, -0.02, -1.98)), 'skin'))
            hand.append(finish(sphere(0.045, 12, 8, loc=at(fx, -0.02, -2.06)), 'skin'))
        hand.append(finish(cyl(0.045, 0.15, n=12, loc=at(0.17, -0.06, -1.84), rot=(0.3, s * 0.9, 0)), 'skin'))
        hand.append(finish(sphere(0.045, 12, 8, loc=at(0.21, -0.08, -1.9)), 'skin'))
        hand.append(finish(sphere(0.14, loc=at(0, -0.2, -1.95)), 'glow'))
        sh = pivot('shoulder' + side, at(0, 0, 0), upper)
        el = pivot('elbow' + side, at(0, 0, -0.88), fore, sh)
        pivot('wrist' + side, at(0, 0, -1.68), hand, el)
        if '--preview' in ARGS:  # arms out, palms up, like the reference
            sh.rotation_euler = (-0.15, -s * 0.85, 0)
            el.rotation_euler = (-1.3, -s * 0.2, 0)


def build_mage_legs():
    for s in S:
        side = 'L' if s > 0 else 'R'
        hx, hz = s * 0.26, 0.3

        def at(x, y, z):
            return (hx + s * x, y, hz + z)

        thigh = [finish(sphere(0.21, loc=at(0, 0, 0)), 'cloth-brown')]
        thigh.append(finish(cyl(0.2, 1.3, r2=0.17, n=24, loc=at(0, 0, -0.65)), 'cloth-brown'))
        shin = [finish(sphere(0.17, loc=at(0, 0, -1.3)), 'cloth-brown')]
        shin.append(finish(cyl(0.16, 0.5, r2=0.17, n=24, loc=at(0, 0, -1.55)), 'cloth-brown'))
        # navy boot: tall shaft, pointed toe, three gold buckles down the front, a leather sole
        shin.append(finish(cyl(0.18, 1.0, r2=0.16, n=24, loc=at(0, 0, -2.25)), 'cloth-navy'))
        shin.append(finish(torus(0.18, 0.03, loc=at(0, 0, -1.78)), 'cloth-navy'))
        toe = sphere(0.17, 24, 16, loc=at(0, -0.2, -2.74), scale=(0.9, 1.7, 0.5))
        shin.append(finish(toe, 'cloth-navy'))
        shin.append(finish(box((0.3, 0.5, 0.06), loc=at(0, -0.1, -2.8)), 'leather'))
        for k in range(3):
            shin.append(finish(box((0.09, 0.03, 0.05), loc=at(0, -0.18, -2.0 - k * 0.22)), 'gold'))
        hip = pivot('hip' + side, at(0, 0, 0), thigh)
        pivot('knee' + side, at(0, 0, -1.3), shin, hip)
        if '--preview' in ARGS:  # a relaxed float: one knee a little bent
            hip.rotation_euler = (-0.15 if s > 0 else 0.1, 0, s * 0.08)


def build_genie():
    build_head().location = (0, 0, 0.42)
    build_torso()
    build_arms()
    build_tail()


def build_mage():
    neck = build_head()
    neck.location = (0, 0, 2.05)
    neck.scale = (0.78, 0.78, 0.78)  # the mage's head is big-chibi, not huge-chibi
    build_mage_torso()
    build_mage_arms()
    build_mage_legs()


# ---------- tail: the genie's spiral of smoke, tapering from the sash to a wisp ----------
def build_tail():
    pts = []
    n = 14
    for i in range(n):
        t = i / (n - 1)
        a = t * math.pi * 2.2
        pts.append((math.sin(a) * 0.3 * t, -0.05 + math.cos(a) * 0.2 * t, -0.85 - t * 1.6))
    tail = finish(curve_tube(pts, 0.36, [1.0, 0.9, 0.75, 0.6, 0.45, 0.32, 0.2, 0.1, 0.03, 0.0], 'tail'), 'glow')
    wisps = [
        finish(curve_tube([(0.1, -0.1, -1.1), (-0.3, -0.25, -1.45), (-0.5, -0.05, -1.85), (-0.35, 0.2, -2.15)], 0.08, [1, 0.7, 0.4, 0.0], 'wisp0'), 'glow'),
        finish(curve_tube([(-0.1, 0.1, -1.3), (0.35, 0.2, -1.7), (0.5, 0.0, -2.1), (0.3, -0.2, -2.4)], 0.07, [1, 0.7, 0.4, 0.0], 'wisp1'), 'glow'),
    ]
    # three bones down the spine of the smoke; the physics waves them and the mesh bends with them
    armature(
        'tailRig',
        [('tail0', pts[0], pts[5], None), ('tail1', pts[5], pts[10], 'tail0'), ('tail2', pts[10], pts[13], 'tail1')],
        [tail, *wisps],
    )


# ---------- preview render ----------
def render_preview(path, cam_loc, cam_z):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 900, 1300
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.03, 0.07, 1)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.collection.objects.link(cam)
    cam.location = cam_loc
    cam.rotation_euler = (math.radians(89), 0, math.radians(cam_z))
    cam.data.lens = 55
    sc.camera = cam
    for loc, energy, col in (((3, -4, 5), 1500, (1, 0.95, 0.9)), ((-4, -3, 1), 500, (0.6, 0.75, 1)), ((0, 4, 3), 600, (0.5, 0.7, 1))):
        l = bpy.data.objects.new('l', bpy.data.lights.new('l', 'POINT'))
        l.data.energy = energy
        l.data.color = col
        l.data.shadow_soft_size = 1.5
        l.location = loc
        bpy.context.collection.objects.link(l)
    sc.render.filepath = path
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as e:  # no GPU for EEVEE: fall back to the solid viewport renderer
        print('EEVEE failed, using Workbench:', e)
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.color_type = 'MATERIAL'
        bpy.ops.render.render(write_still=True)
    print('rendered', path)


FORMS = {
    'genie': (build_genie, (1.0, -8.4, 0.15), 7.5),
    'mage': (build_mage, (1.0, -11.0, 0.35), 5.5),
}
only = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else None
for form, (build, cam_loc, cam_z) in FORMS.items():
    if only and form != only:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    build()
    if '--preview' in ARGS:
        render_preview(os.path.join(ARGS[ARGS.index('--preview') + 1], f'flow-{form}.png'), cam_loc, cam_z)
    # ---------- export ----------
    out = os.path.join(ROOT, 'renderer', 'models', f'flow-{form}.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.select_set(o.type in ('MESH', 'EMPTY', 'ARMATURE'))
    # export_apply bakes every modifier except Armature, so the skins survive
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, use_selection=True)
    print('joints:', sorted(o.name for o in bpy.data.objects if o.type == 'EMPTY'), 'bones:', sorted(b.name for a in bpy.data.armatures for b in a.bones))
    with open(out, 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    with open(out + '.js', 'w') as f:
        f.write(f'// Generated by tools/flow.py, do not edit. The Flow {form} model (glTF binary, base64).\n')
        f.write(f"export default '{data}';\n")
    os.remove(out)
    print('wrote', out + '.js', len(data) * 3 // 4, 'bytes')
    if '--blend' in ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'tools', f'flow-{form}.blend'))
