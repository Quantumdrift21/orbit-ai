# AeroStrike, modelled in Blender. Builds each module as a named empty with detailed hard-surface
# children (bevels, cut-in vents, panel lines), then exports renderer/models/aerostrike.glb.js.
# Orbit swaps each named module into renderer/mech.js; modules not modelled here yet stay procedural.
#
# Run:  blender -b -P tools/aerostrike.py            (export)
#       blender -b -P tools/aerostrike.py -- --blend  (also save tools/aerostrike.blend to look around)
#
# Coordinates: Blender is Z-up with the front facing -Y; glTF/three.js turns that into Y-up, front +Z.
# Each module is modelled around its own pivot (the empty); mech.js decides where the pivot goes.
# Module names: letters and digits only (three.js turns '.' into '_').
# Material names matter: Orbit replaces shell/trim/dark/glass/glow with the robot's skin materials.
import base64
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'renderer', 'models', 'aerostrike.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- materials (colours from the reference sheet) ----------
def material(name, rgb, metal, rough, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


MAT = {
    'shell': material('shell', srgb('D0D7E2'), 1.0, 0.3),
    'trim': material('trim', srgb('6B7485'), 0.8, 0.5),
    'dark': material('dark', srgb('2B3038'), 0.6, 0.55),
    'glow': material('glow', srgb('00CFFF'), 0.0, 0.4, 4.0),
    'glass': material('glass', srgb('0A1F33'), 0.2, 0.05),
}


# ---------- helpers ----------
def finish(o, mat, bevel=0.0, seg=3, smooth=True):
    o.data.materials.clear()
    o.data.materials.append(MAT[mat])
    if bevel:
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = seg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(35)
    if smooth:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
        o.select_set(False)
    return o


def place(o, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    o.location = loc
    o.rotation_euler = rot
    if scale:
        o.scale = scale
    return o


def box(size, **kw):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return place(o, **kw)


def sphere(r, seg=48, rings=32, **kw):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    return place(bpy.context.object, **kw)


def cyl(r, depth, r2=None, n=48, **kw):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=n)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=n)
    return place(bpy.context.object, **kw)


def torus(major, minor, **kw):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=64, minor_segments=12)
    return place(bpy.context.object, **kw)


def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def boolean(o, cutter, op='DIFFERENCE'):
    """Cut (or intersect) `o` with `cutter` right away, then delete the cutter."""
    apply_all(o)
    m = o.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    apply_all(o)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return o


def module(name, loc, parts):
    """Group parts under an empty named after the module; loc = where it sits on the full mech (Blender coords)."""
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    for p in parts:
        p.parent = e
    e.location = loc
    return e


def module_at(name, pivot_three, parts):
    """Like module(), for parts built where they sit on the full mech: the empty goes to the pivot that
    mech.js uses (given in three.js coords x, y-up, z-front) and the parts keep their place around it."""
    x, y, z = pivot_three
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = (x, -z, y)
    bpy.context.view_layer.update()
    for p in parts:
        p.parent = e
        p.matrix_parent_inverse = e.matrix_world.inverted()
    return e


def xform(objs, loc, rot):
    """Move objects built around the origin into place together, as one rigid piece."""
    bpy.context.view_layer.update()
    m = Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4()
    for o in objs:
        o.matrix_world = m @ o.matrix_world
    bpy.context.view_layer.update()


S = (-1, 1)  # sides: -1 = robot's right (screen left), 1 = robot's left


# ---------- head unit: helmet, V-brow, crest, visor, comms ears, jaw, rear vents, neck gimbal ----------
def build_head():
    p = []
    # helmet shell with a face window cut out and panel-line grooves down each side
    helmet = sphere(0.6, scale=(0.94, 1.0, 1.0))
    bpy.ops.object.transform_apply(scale=True)
    for s in S:  # flat machined sides where the comms ears mount
        boolean(helmet, box((0.5, 1.4, 1.4), loc=(s * 0.75, 0, 0)))
    sol = helmet.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = 0.04
    sol.offset = -1
    boolean(helmet, box((0.64, 0.5, 0.44), loc=(0, -0.5, -0.04)))
    for s in S:
        groove = torus(math.sqrt(0.6**2 - 0.36**2), 0.011, loc=(s * 0.36 * 0.94, 0, 0), rot=(0, math.pi / 2, 0))
        boolean(helmet, groove)
    groove = torus(0.6, 0.011, rot=(math.pi / 2, 0, 0), loc=(0, 0.12, 0))
    groove.scale = (0.94, 1, 1)
    boolean(helmet, groove)
    p.append(finish(helmet, 'shell', bevel=0.012))

    p.append(finish(sphere(0.555), 'dark'))  # inner head, seen through the face window

    # glass visor filling the face window, set slightly back
    visor = sphere(0.585, scale=(0.94, 1, 1))
    bpy.ops.object.transform_apply(scale=True)
    boolean(visor, box((0.6, 0.5, 0.4), loc=(0, -0.5, -0.04)), 'INTERSECT')
    p.append(finish(visor, 'glass'))

    for s in S:
        # angled eye slits
        eye = box((0.2, 0.06, 0.045), loc=(s * 0.15, -0.55, 0.05), rot=(0, -s * 0.22, s * 0.27))
        p.append(finish(eye, 'glow', bevel=0.012))
        # V-shaped brow armour, meeting above the nose
        brow = box((0.36, 0.13, 0.11), loc=(s * 0.17, -0.51, 0.24), rot=(0.25, -s * 0.33, s * 0.36))
        p.append(finish(brow, 'shell', bevel=0.02))
        # cheek guards
        cheek = box((0.17, 0.09, 0.32), loc=(s * 0.39, -0.42, -0.19), rot=(-0.2, s * 0.15, s * 0.8))
        p.append(finish(cheek, 'shell', bevel=0.02))
        # comms ears: housing with a recessed face, vented cap, glowing ring and status light
        ear = cyl(0.23, 0.18, loc=(s * 0.57, 0.02, 0), rot=(0, math.pi / 2, 0))
        boolean(ear, cyl(0.17, 0.08, loc=(s * 0.69, 0.02, 0), rot=(0, math.pi / 2, 0)))
        p.append(finish(ear, 'trim', bevel=0.015))
        cap = cyl(0.15, 0.04, loc=(s * 0.645, 0.02, 0), rot=(0, math.pi / 2, 0))
        for i in range(8):
            a = i / 8 * math.tau
            fin = box((0.08, 0.02, 0.07), loc=(s * 0.67, 0.02 + math.cos(a) * 0.1, math.sin(a) * 0.1), rot=(a, 0, 0))
            boolean(cap, fin)
        p.append(finish(cap, 'shell', bevel=0.006))
        p.append(finish(torus(0.2, 0.014, loc=(s * 0.67, 0.02, 0), rot=(0, math.pi / 2, 0)), 'glow'))
        p.append(finish(cyl(0.035, 0.03, loc=(s * 0.67, 0.02, 0), rot=(0, math.pi / 2, 0)), 'glow'))
        # antenna sockets (Orbit's own antennas slot into these)
        sock = cyl(0.075, 0.12, r2=0.05, loc=(s * 0.3, 0.05, 0.52), rot=(0, s * 0.5, 0))
        p.append(finish(sock, 'trim', bevel=0.008))

    # crest fin over the top, from the brow to the back
    crest = torus(0.615, 0.05, rot=(0, math.pi / 2, 0))
    crest.scale = (0.65, 1, 1)
    bpy.ops.object.transform_apply(scale=True)
    boolean(crest, box((1, 2, 0.75), loc=(0, 0.05, 0.53)), 'INTERSECT')
    p.append(finish(crest, 'shell', bevel=0.01))

    # jaw guard with three vent slots
    jaw = box((0.36, 0.13, 0.2))
    for i in (-1, 0, 1):
        boolean(jaw, box((0.055, 0.1, 0.13), loc=(i * 0.1, -0.06, 0)))
    p.append(finish(place(jaw, loc=(0, -0.48, -0.37), rot=(0.42, 0, 0)), 'trim', bevel=0.015))
    p.append(finish(box((0.3, 0.05, 0.14), loc=(0, -0.43, -0.36), rot=(0.42, 0, 0)), 'dark'))  # behind the slots

    # rear cooling grille
    grille = box((0.36, 0.1, 0.3))
    for i in range(4):
        boolean(grille, box((0.3, 0.08, 0.035), loc=(0, 0.04, 0.105 - i * 0.07)))
    p.append(finish(place(grille, loc=(0, 0.58, 0.02), rot=(-0.3, 0, 0)), 'trim', bevel=0.012))
    p.append(finish(box((0.3, 0.05, 0.26), loc=(0, 0.555, 0.02), rot=(-0.3, 0, 0)), 'dark'))

    # neck: tapered column, gimbal ring, glow band, two pistons
    p.append(finish(cyl(0.25, 0.46, r2=0.18, loc=(0, 0, -0.64)), 'trim', bevel=0.01))
    p.append(finish(torus(0.25, 0.045, loc=(0, 0, -0.55)), 'shell'))
    p.append(finish(torus(0.215, 0.016, loc=(0, 0, -0.74)), 'glow'))
    for s in S:
        p.append(finish(cyl(0.03, 0.36, loc=(s * 0.19, 0.08, -0.62), rot=(0.25, s * 0.2, 0)), 'shell'))
    return module('head', (0, 0.02, 1.88), p)


# ---------- chest core: Orbit's round body (radius 0.92 here) sits in the middle as the core display ----------
def build_torso():
    # frame: bezel ring with bolts around the core display, back spine, central reinforcement under the core
    f = []
    f.append(finish(torus(0.72, 0.075, loc=(0, -0.6, 0), rot=(math.pi / 2, 0, 0)), 'trim'))
    f.append(finish(torus(0.64, 0.014, loc=(0, -0.665, 0), rot=(math.pi / 2, 0, 0)), 'glow'))
    for i in range(8):
        a = (i + 0.5) / 8 * math.tau
        bolt = cyl(0.028, 0.05, n=6, loc=(math.cos(a) * 0.72, -0.665, math.sin(a) * 0.72), rot=(math.pi / 2, 0, 0))
        f.append(finish(bolt, 'shell'))
    f.append(finish(box((1.2, 0.6, 1.7), loc=(0, 0.6, -0.1)), 'dark', bevel=0.05))
    for s in S:  # cooling fins down the back spine
        for i in range(4):
            f.append(finish(box((0.06, 0.2, 0.34), loc=(s * (0.2 + i * 0.12), 0.95, 0.1)), 'trim', bevel=0.012))
    belly = box((0.6, 0.22, 0.3), loc=(0, -0.62, -0.9), rot=(-0.55, 0, 0))
    boolean(belly, box((0.36, 0.1, 0.07), loc=(0, -0.72, -0.85)))  # slot for the LED bar
    f.append(finish(belly, 'shell', bevel=0.03))
    f.append(finish(box((0.34, 0.06, 0.05), loc=(0, -0.69, -0.86), rot=(-0.55, 0, 0)), 'glow'))
    module_at('frame', (0, 0, 0), f)

    def core_cut(o, r=0.84):
        """Trim a plate's inner edge to a circle around the core, so the core display stays fully visible."""
        return boolean(o, cyl(r, 3, rot=(math.pi / 2, 0, 0)))

    # layered armour: angled slabs built around their own centre, then set in place (pitch, yaw: outer edge back)
    for s in S:
        p = []
        # side frame filling the gap between the core and the armour
        p.append(finish(box((0.3, 0.8, 1.3), loc=(s * 0.86, 0.1, -0.1)), 'dark', bevel=0.03))
        # pectoral: big plate over the upper chest, a panel line and cooling LEDs
        pec = box((0.95, 0.3, 0.72))
        boolean(pec, box((0.022, 0.1, 0.8), loc=(s * 0.2, -0.15, 0)))
        leds = [box((0.36, 0.05, 0.05), loc=(-s * 0.08, -0.16, 0.2)), box((0.14, 0.05, 0.05), loc=(-s * 0.19, -0.16, 0.1))]
        layer = box((0.42, 0.1, 0.3), loc=(s * 0.18, -0.19, -0.14))  # second, smaller plate on top
        xform([pec, layer, *leds], loc=(s * 0.86, -0.42, 0.5), rot=(-0.25, 0, s * 0.42))
        p += [finish(core_cut(pec), 'shell', bevel=0.02), finish(core_cut(layer, 0.9), 'shell', bevel=0.015)]
        p += [finish(o, 'glow') for o in leds]
        # side intake panel: three vertical slots with LEDs glowing inside
        side = box((0.36, 0.95, 0.8))
        leds = []
        for i in (-1, 0, 1):
            boolean(side, box((0.05, 0.12, 0.5), loc=(i * 0.1, -0.47, 0)))
            leds.append(box((0.04, 0.04, 0.46), loc=(i * 0.1, -0.43, 0)))
        xform([side, *leds], loc=(s * 1.08, -0.15, -0.38), rot=(0, 0, s * 0.35))
        p += [finish(side, 'shell', bevel=0.02)] + [finish(o, 'glow') for o in leds]
        # lower plate tucked under the core
        low = box((0.62, 0.26, 0.4))
        led = box((0.2, 0.05, 0.05), loc=(-s * 0.1, -0.13, 0.06))
        xform([low, led], loc=(s * 0.55, -0.55, -0.8), rot=(0.45, 0, s * 0.3))
        p += [finish(core_cut(low), 'shell', bevel=0.02), finish(led, 'glow')]
        module_at('chestL' if s > 0 else 'chestR', (s * 0.95, 0.15, -0.2), p)

    # collar: tapered ring under the neck and a yoke plate above the core
    c = [finish(cyl(0.66, 0.3, r2=0.46, loc=(0, 0.08, 1.02)), 'trim', bevel=0.02)]
    yoke = box((1.0, 0.34, 0.3))
    leds = [cyl(0.035, 0.04, loc=(s * 0.3, -0.17, 0), rot=(math.pi / 2, 0, 0)) for s in S]
    xform([yoke, *leds], loc=(0, -0.42, 0.92), rot=(-0.6, 0, 0))
    c += [finish(core_cut(yoke), 'shell', bevel=0.02)] + [finish(o, 'glow') for o in leds]
    module_at('collar', (0, 1.02, -0.08), c)

    # segmented abdomen: each rib a dark core, an armoured front plate and an LED
    for i, (z, w) in enumerate(((-1.12, 1.2), (-1.4, 1.05), (-1.66, 0.92))):
        r = [finish(box((w, 0.72, 0.24), loc=(0, 0.05, z)), 'trim', bevel=0.04)]
        front = box((w * 0.62, 0.14, 0.2), loc=(0, -0.36, z))
        boolean(front, box((0.26, 0.1, 0.07), loc=(0, -0.43, z)))
        r.append(finish(front, 'shell', bevel=0.03))
        r.append(finish(box((0.24, 0.05, 0.05), loc=(0, -0.41, z)), 'glow'))
        module_at(f'rib{i}', (0, z, -0.05), r)

    # pelvis: hip block, V-shaped centre plate with a glow line, angled hip guards
    pv = [finish(box((1.6, 0.85, 0.42), loc=(0, 0.05, -2.02)), 'trim', bevel=0.06)]
    v = cyl(0.36, 0.18, n=3, loc=(0, -0.42, -2.08), rot=(-math.pi / 2, 0, 0))
    pv.append(finish(v, 'shell', bevel=0.025))
    pv.append(finish(cyl(0.13, 0.05, n=3, loc=(0, -0.52, -2.1), rot=(-math.pi / 2, 0, 0)), 'glow'))
    for s in S:
        hip = box((0.3, 0.62, 0.52), loc=(s * 0.86, 0.02, -2.06), rot=(0, s * 0.28, 0))
        pv.append(finish(hip, 'shell', bevel=0.04))
        pv.append(finish(box((0.05, 0.4, 0.06), loc=(s * 1.02, -0.1, -2.0), rot=(0, s * 0.28, 0)), 'glow'))
    module_at('pelvis', (0, -2.02, -0.05), pv)


def tube(points, r):
    """A smooth cable through the given points."""
    cu = bpy.data.curves.new('tube', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new('NURBS')
    sp.points.add(len(points) - 1)
    for pt, co in zip(sp.points, points):
        pt.co = (*co, 1)
    sp.use_endpoint_u = True
    sp.order_u = 3
    o = bpy.data.objects.new('tube', cu)
    bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    return o


def build_shoulders():
    X = (0, math.pi / 2, 0)  # turns a cylinder/torus to face along x (the turbine axis)
    for s in S:
        name = 'shoulderL' if s > 0 else 'shoulderR'
        cx, cy, cz = s * 1.72, 0.05, 0.82  # pivot (Blender coords)
        hx, hy, hz = cx + s * 0.4, cy - 0.05, cz + 0.02  # turbine centre
        p = [finish(sphere(0.3, loc=(cx, cy, cz)), 'trim')]  # ball joint
        # pauldron: armour cap over the joint, cut open for the turbine, with a layered top plate and LED
        pad = sphere(0.6, loc=(cx + s * 0.05, cy, cz + 0.05), scale=(1.05, 1, 0.85))
        bpy.ops.object.transform_apply(scale=True)
        sol = pad.modifiers.new('thick', 'SOLIDIFY')
        sol.thickness = 0.06
        sol.offset = -1
        boolean(pad, box((2, 2, 1), loc=(cx, cy, cz - 0.45)))
        boolean(pad, cyl(0.5, 1, loc=(hx + s * 0.3, hy, hz), rot=X))
        boolean(pad, box((0.022, 1.4, 0.3), loc=(cx - s * 0.15, cy, cz + 0.55)))  # panel line
        p.append(finish(pad, 'shell', bevel=0.012))
        top = sphere(0.68, loc=(cx - s * 0.02, cy, cz + 0.02), scale=(1.12, 1.06, 0.82))
        bpy.ops.object.transform_apply(scale=True)
        sol = top.modifiers.new('thick', 'SOLIDIFY')
        sol.thickness = 0.07
        sol.offset = -1
        boolean(top, box((2, 2, 1), loc=(cx, cy, cz - 0.2)))  # keep only the upper layer
        boolean(top, cyl(0.52, 1, loc=(hx + s * 0.3, hy, hz), rot=X))
        p.append(finish(top, 'shell', bevel=0.012))
        p.append(finish(box((0.05, 0.5, 0.04), loc=(cx - s * 0.28, cy - 0.2, cz + 0.55), rot=(0.5, 0, 0)), 'glow'))
        # turbine housing: hollow drum, closed at the back, intake lip, glowing ring, outer rotating ring
        drum = cyl(0.46, 0.36, loc=(hx, hy, hz), rot=X)
        boolean(drum, cyl(0.37, 0.6, loc=(hx, hy, hz), rot=X))
        for i in range(10):  # cooling ribs round the drum
            a = i / 10 * math.tau
            boolean(drum, box((0.2, 0.04, 0.06), loc=(hx, hy + math.cos(a) * 0.46, hz + math.sin(a) * 0.46), rot=(a, 0, 0)))
        p.append(finish(drum, 'trim', bevel=0.012))
        p.append(finish(cyl(0.38, 0.05, loc=(hx - s * 0.15, hy, hz), rot=X), 'dark'))
        p.append(finish(torus(0.415, 0.045, loc=(hx + s * 0.18, hy, hz), rot=X), 'shell'))
        p.append(finish(torus(0.36, 0.016, loc=(hx + s * 0.155, hy, hz), rot=X), 'glow'))
        p.append(finish(torus(0.5, 0.028, loc=(hx - s * 0.05, hy, hz), rot=X), 'shell'))
        p.append(finish(cyl(0.3, 0.02, loc=(hx - s * 0.1, hy, hz), rot=X), 'glow'))  # glowing intake core
        # fan: hub and 12 twisted blades as one object named <module>Fan, spun by mech.js about x
        hub = cyl(0.11, 0.14, r2=0.03, loc=(hx + s * 0.04, hy, hz), rot=(0, s * math.pi / 2, 0))
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        blades = []
        for i in range(12):
            b = box((0.025, 0.1, 0.25))
            xform([b], loc=(0, 0, 0.21), rot=(0, 0, 0.6))
            xform([b], loc=(hx + s * 0.02, hy, hz), rot=(i / 12 * math.tau, 0, 0))
            blades.append(b)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (*blades, hub):
            o.select_set(True)
        bpy.context.view_layer.objects.active = hub
        bpy.ops.object.join()
        hub.name = name + 'Fan'
        p.append(finish(hub, 'shell'))
        # cable conduits from the turbine round to the back
        for dz in (0.12, -0.08):
            pts = [(hx - s * 0.12, hy + 0.3, hz + dz), (cx - s * 0.1, cy + 0.6, cz + dz + 0.1), (cx - s * 0.55, cy + 0.8, cz + dz + 0.2)]
            p.append(finish(tube(pts, 0.035), 'dark'))
        module_at(name, (s * 1.72, 0.82, -0.05), p)


def build_arms():
    """Arms hang straight down from their pivot; mech.js adds the tilt and swing.
    Shoulder hinge, armoured upper arm, rotary elbow, vented forearm and wrist; build_hand adds the hand."""
    X = (0, math.pi / 2, 0)
    for s in S:
        px, pz = s * 1.78, 0.5  # pivot (Blender x, z; y = 0)

        def at(x, y, z):
            return (px + s * x, y, pz + z)  # x measured outwards

        p = []
        # shoulder hinge
        p.append(finish(cyl(0.19, 0.4, loc=at(0, 0, -0.05), rot=X), 'trim', bevel=0.01))
        # upper arm: inner strut, octagonal armour sleeve with a groove and an LED strip on the outside
        p.append(finish(cyl(0.17, 0.8, loc=at(0, 0, -0.5)), 'trim'))
        sleeve = cyl(0.3, 0.56, n=8, loc=at(0, 0, -0.44), rot=(0, 0, math.pi / 8))
        boolean(sleeve, torus(0.31, 0.014, loc=at(0, 0, -0.5)))
        p.append(finish(sleeve, 'shell', bevel=0.02))
        p.append(finish(box((0.04, 0.12, 0.36), loc=at(0.29, 0, -0.42)), 'glow'))
        # elbow: rotary joint with side caps and glowing rings, a guard plate at the back
        p.append(finish(cyl(0.21, 0.42, loc=at(0, 0, -0.98), rot=X), 'trim', bevel=0.01))
        for side_x in (-0.23, 0.23):
            p.append(finish(cyl(0.16, 0.06, loc=at(side_x, 0, -0.98), rot=X), 'shell', bevel=0.01))
            p.append(finish(torus(0.12, 0.012, loc=at(side_x * 1.15, 0, -0.98), rot=X), 'glow'))
        p.append(finish(box((0.34, 0.14, 0.36), loc=at(0, 0.2, -0.98), rot=(-0.35, 0, 0)), 'shell', bevel=0.03))
        upper, p = p, []  # from here down: the forearm, which bends at the elbow
        # forearm module: armoured block, vents with LEDs on the outside, LED strip and top plate at the front
        fore = box((0.62, 0.62, 1.0), loc=at(0, 0, -1.56))
        for i in range(4):
            boolean(fore, box((0.12, 0.4, 0.05), loc=at(0.31, 0, -1.36 - i * 0.1)))
        boolean(fore, box((0.62, 0.62, 0.025), loc=at(0, -0.31, -1.8)))  # panel line across the front
        p.append(finish(fore, 'shell', bevel=0.05))
        p.append(finish(box((0.04, 0.36, 0.34), loc=at(0.27, 0, -1.51)), 'glow'))  # behind the vents
        p.append(finish(box((0.06, 0.04, 0.4), loc=at(0, -0.32, -1.5)), 'glow'))
        plate = box((0.44, 0.08, 0.5), loc=at(0, -0.33, -1.48))
        boolean(plate, box((0.08, 0.12, 0.44), loc=at(0, -0.36, -1.5)))  # window for the LED strip
        p.append(finish(plate, 'trim', bevel=0.02))
        # wrist
        p.append(finish(cyl(0.2, 0.18, loc=at(0, 0, -2.1)), 'trim', bevel=0.01))
        p.append(finish(torus(0.2, 0.014, loc=at(0, 0, -2.1)), 'glow'))
        if s < 0:  # right forearm carries the blade: mounting rail, lock clamps, power conduit
            p.append(finish(box((0.07, 0.22, 0.95), loc=at(0.36, 0, -1.6)), 'trim', bevel=0.015))
            for lz in (-1.2, -2.0):
                p.append(finish(box((0.1, 0.28, 0.08), loc=at(0.38, 0, lz)), 'shell', bevel=0.015))
            p.append(finish(tube([at(0.2, 0.25, -1.08), at(0.36, 0.2, -1.17), at(0.42, 0.08, -1.17)], 0.025), 'glow'))
        module_at('armL' if s > 0 else 'armR', (px, pz, 0), upper)
        module_at('foreL' if s > 0 else 'foreR', (px, pz - 0.98, 0), p)
        build_hand(s, at, 'handL' if s > 0 else 'handR', (px, pz - 2.1, 0))


# fingers: (outward x, knuckle z, radius, phalanx lengths, spread: - fans out, + in); index by the thumb
FINGERS = (
    (0.15, -2.455, 0.048, (0.15, 0.11, 0.09), -0.06),
    (0.05, -2.47, 0.05, (0.17, 0.12, 0.095), 0.0),
    (-0.05, -2.465, 0.047, (0.16, 0.115, 0.09), 0.03),
    (-0.15, -2.44, 0.042, (0.12, 0.085, 0.075), 0.07),
)


def finger(name, r, lengths):
    """A finger hanging along -z from its knuckle at the origin, curling forward (-y) like ours: one object
    per phalanx (<name>0, <name>1, ...), each with its origin at the joint it bends at, chained parent to
    child so mech.js can curl each joint. Round knuckles, tapered bones with an armour plate on the back,
    and a rounded fingertip with a glowing pad."""
    segs, z = [], 0.0
    for i, ln in enumerate(lengths):
        rr = r * (1 - 0.08 * i)
        pieces = [
            finish(sphere(rr * 1.06, seg=20, rings=12), 'dark'),
            finish(cyl(rr * 0.9, ln, r2=rr, n=20, loc=(0, 0, -ln / 2)), 'trim'),
            finish(box((rr * 1.7, rr * 0.7, ln * 0.78), loc=(0, rr * 0.72, -ln * 0.5)), 'shell', bevel=rr * 0.3),
        ]
        if i == len(lengths) - 1:
            pieces.append(finish(sphere(rr * 0.92, seg=20, rings=12, loc=(0, 0, -ln)), 'shell'))
            pieces.append(finish(box((rr * 0.9, rr * 0.3, rr * 1.1), loc=(0, -rr * 0.75, -ln * 0.82)), 'glow'))
        o = merge(pieces, f'{name}{i}')
        o.location = (0, 0, z)
        bpy.context.view_layer.update()
        if segs:
            o.parent = segs[-1]
            o.matrix_parent_inverse = segs[-1].matrix_world.inverted()
        segs.append(o)
        z -= ln
    return segs[0]


def build_hand(s, at, name, pivot_three):
    """A human hand at the wrist: rounded palm with an armoured back, four fingers of three joints and a
    two-joint thumb on the outside (palm forward, like a person standing with open hands)."""
    p = [
        finish(box((0.44, 0.2, 0.34), loc=at(0, 0, -2.3)), 'trim', bevel=0.07),
        finish(box((0.4, 0.06, 0.28), loc=at(0, 0.11, -2.3)), 'shell', bevel=0.025),
        finish(box((0.3, 0.02, 0.03), loc=at(0, 0.145, -2.4)), 'glow'),
        finish(cyl(0.09, 0.16, loc=at(0.2, -0.02, -2.26), rot=(0, s * 0.5, 0)), 'trim', bevel=0.02),  # thumb mount
    ]
    for i, (fx, fz, r, lengths, spread) in enumerate(FINGERS):
        root = finger(f'{name}F{i}', r, lengths)
        xform([root], loc=at(fx, -0.01, fz), rot=(0, s * spread, 0))  # fan out a little
        p.append(root)
    thumb = finger(f'{name}F4', 0.052, (0.12, 0.1, 0.08))
    xform([thumb], loc=at(0.24, -0.05, -2.3), rot=(-0.45, -s * 0.55, 0))
    p.append(thumb)
    module_at(name, pivot_three, p)


def build_blade():
    """Retractable blade on the right forearm, with its origin at its root so mech.js can slide it out
    (scaling it down from the root). Built flat along +x, then turned to hang down the outside of the arm."""
    length = 2.15
    blade = plate2d([(0, -0.08), (length * 0.81, -0.1), (length, 0.03), (length * 0.84, 0.12), (0, 0.1)], 0.05)
    parts = [
        finish(blade, 'shell', bevel=0.012),
        finish(box((length * 0.75, 0.07, 0.025), loc=(length * 0.42, 0, -0.01)), 'glow'),  # energy line
        finish(box((length * 0.8, 0.06, 0.04), loc=(length * 0.4, 0, 0.09)), 'dark'),  # spine
        finish(box((0.2, 0.12, 0.3), loc=(0.05, 0, 0.01)), 'trim', bevel=0.02),  # collar
    ]
    root = (-1.78 - 0.42, 0, 0.5 - 1.15)  # right arm pivot + 0.42 outwards, 1.15 down
    xform(parts, loc=root, rot=(0, math.pi / 2, math.pi / 2))
    module_at('blade', (-2.2, -0.65, 0), parts)


def build_legs():
    """Legs hang straight down from the hip; mech.js swings them. Ball hip, layered thigh armour,
    knee hinge with pistons, calf with thruster and stabiliser fins, gimbal ankle, three-toed foot."""
    X = (0, math.pi / 2, 0)
    for s in S:
        px, pz = s * 0.6, -2.2

        def at(x, y, z):
            return (px + s * x, y, pz + z)  # x measured outwards

        p = [finish(sphere(0.27, loc=at(0, 0, 0)), 'trim')]  # hip ball
        # thigh: strut, muscle block at the back, layered front and outer armour with an LED
        p.append(finish(cyl(0.2, 0.95, loc=at(0, 0, -0.6)), 'trim'))
        p.append(finish(box((0.42, 0.3, 0.62), loc=at(0, 0.12, -0.62)), 'dark', bevel=0.05))
        front = box((0.56, 0.2, 0.72), loc=at(0, -0.2, -0.6), rot=(-0.06, 0, 0))
        boolean(front, box((0.6, 0.1, 0.022), loc=at(0, -0.3, -0.72)))  # panel line
        p.append(finish(front, 'shell', bevel=0.04))
        p.append(finish(box((0.18, 0.56, 0.62), loc=at(0.3, -0.02, -0.58)), 'shell', bevel=0.04))
        p.append(finish(box((0.04, 0.3, 0.05), loc=at(0.395, -0.05, -0.45)), 'glow'))
        thigh, p = p, []  # from here down: the shin, which bends at the knee
        # knee: hinge drum, kneecap with a light, pistons down the back
        p.append(finish(cyl(0.24, 0.52, loc=at(0, 0, -1.2), rot=X), 'trim', bevel=0.01))
        for kx in (-0.27, 0.27):
            p.append(finish(cyl(0.17, 0.05, loc=at(kx, 0, -1.2), rot=X), 'shell', bevel=0.01))
        cap = box((0.42, 0.18, 0.4), loc=at(0, -0.27, -1.17), rot=(0.25, 0, 0))
        p.append(finish(cap, 'shell', bevel=0.04))
        p.append(finish(cyl(0.05, 0.04, loc=at(0, -0.37, -1.15), rot=(math.pi / 2 + 0.25, 0, 0)), 'glow'))
        for kx in (-0.13, 0.13):
            thigh.append(finish(cyl(0.055, 0.4, loc=at(kx, 0.26, -1.0), rot=(0.12, 0, 0)), 'trim'))  # cylinder
            p.append(finish(cyl(0.03, 0.42, loc=at(kx, 0.29, -1.38), rot=(0.12, 0, 0)), 'shell'))  # rod
        # calf: armoured shin with an LED strip, thruster nozzle and stabiliser fins at the back
        shin = cyl(0.42, 1.0, r2=0.53, n=4, loc=at(0, 0, -1.82), rot=(0, 0, math.pi / 4))  # tapered square
        boolean(shin, box((0.1, 0.12, 0.62), loc=at(0, -0.36, -1.8)))  # window for the LED strip
        boolean(shin, box((0.76, 0.78, 0.022), loc=at(0, 0, -2.12)))  # panel line round the shin
        p.append(finish(shin, 'shell', bevel=0.06))
        p.append(finish(box((0.06, 0.06, 0.58), loc=at(0, -0.3, -1.8)), 'glow'))
        noz = cyl(0.13, 0.32, r2=0.19, loc=at(0, 0.45, -1.98), rot=(-2.36, 0, 0))
        boolean(noz, cyl(0.15, 0.2, loc=at(0, 0.53, -2.06), rot=(-2.36, 0, 0)))  # hollow mouth
        p.append(finish(noz, 'trim', bevel=0.01))
        p.append(finish(cyl(0.12, 0.02, loc=at(0, 0.5, -2.03), rot=(-2.36, 0, 0)), 'glow'))
        for fx in (-0.22, 0.22):
            fin = box((0.04, 0.32, 0.5), loc=at(fx, 0.46, -1.62), rot=(-0.4, 0, 0))
            p.append(finish(fin, 'shell', bevel=0.012))
        # ankle: multi-axis joint
        p.append(finish(sphere(0.18, loc=at(0, 0, -2.36)), 'trim'))
        p.append(finish(torus(0.2, 0.035, loc=at(0, 0, -2.36), rot=X), 'shell'))
        # foot: grip sole, base, top plate, three clawed toes and a heel spur
        p.append(finish(box((0.62, 0.92, 0.07), loc=at(0, -0.1, -2.66)), 'dark', bevel=0.02))
        p.append(finish(box((0.6, 0.88, 0.2), loc=at(0, -0.1, -2.53)), 'trim', bevel=0.05))
        p.append(finish(box((0.46, 0.56, 0.1), loc=at(0, -0.14, -2.4), rot=(-0.15, 0, 0)), 'shell', bevel=0.03))
        for tx in (-0.19, 0, 0.19):
            p.append(finish(box((0.14, 0.2, 0.15), loc=at(tx, -0.62, -2.56)), 'shell', bevel=0.03))
            p.append(finish(cyl(0.06, 0.26, r2=0.0, n=12, loc=at(tx, -0.84, -2.58), rot=(math.pi / 2 + 0.15, 0, 0)), 'shell'))
        p.append(finish(cyl(0.06, 0.24, r2=0.0, n=12, loc=at(0, 0.45, -2.58), rot=(-math.pi / 2 - 0.15, 0, 0)), 'shell'))
        module_at('legL' if s > 0 else 'legR', (px, pz, 0), thigh)
        module_at('shinL' if s > 0 else 'shinR', (px, pz - 1.2, 0), p)


def plate2d(pts, thick, loc=(0, 0, 0)):
    """A flat plate from an outline of (x, z) points, `thick` deep along y, origin at loc."""
    me = bpy.data.meshes.new('plate')
    me.from_pydata([(x, 0, z) for x, z in pts], [], [list(range(len(pts)))])
    o = bpy.data.objects.new('plate', me)
    bpy.context.collection.objects.link(o)
    sol = o.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = thick
    sol.offset = 0
    apply_all(o)
    o.location = loc
    return o


def merge(objs, name):
    """Join finished pieces into the first one (keeping its origin) as one object called `name`."""
    for o in objs:
        apply_all(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].select_set(False)
    return objs[0]


def blade_outline(length, w):
    return [(0, -w / 2), (length * 0.82, -w * 0.32), (length, 0), (length * 0.82, w * 0.42), (0, w / 2), (-w * 0.15, 0)]


def build_backpack():
    """Rear unit: primary and auxiliary thrusters, power-core channel and conduits, wing mounts, cooling fins."""
    cx, cy, cz = 0, 1.02, 0.05  # centre (Blender coords); the back face is at y = 1.33
    p = []
    body = box((1.25, 0.62, 1.3), loc=(cx, cy, cz))
    boolean(body, box((0.16, 0.1, 0.95), loc=(0, 1.33, 0.1)))  # channel for the power core
    p.append(finish(body, 'trim', bevel=0.06))
    p.append(finish(box((0.08, 0.06, 0.9), loc=(0, 1.31, 0.1)), 'glow'))
    for s in S:
        plate = box((0.42, 0.08, 0.9), loc=(s * 0.34, 1.36, 0.12))
        boolean(plate, box((0.44, 0.1, 0.022), loc=(s * 0.34, 1.4, 0.3)))  # panel line
        p.append(finish(plate, 'shell', bevel=0.025))
        p.append(finish(box((0.2, 0.04, 0.04), loc=(s * 0.34, 1.405, -0.18)), 'glow'))
        # wing mount pylon up to the wing hinge
        p.append(finish(box((0.22, 0.3, 0.5), loc=(s * 0.55, 1.0, 0.82), rot=(0, -s * 0.35, 0)), 'dark', bevel=0.03))
        # primary thruster: housing, hollow nozzle, glowing core and ring
        tx = s * 0.36
        p.append(finish(cyl(0.25, 0.3, loc=(tx, 1.1, -0.55)), 'trim', bevel=0.015))
        noz = cyl(0.27, 0.32, r2=0.19, loc=(tx, 1.1, -0.82))
        boolean(noz, cyl(0.2, 0.3, r2=0.14, loc=(tx, 1.1, -0.9)))
        p.append(finish(noz, 'shell', bevel=0.01))
        p.append(finish(cyl(0.17, 0.02, loc=(tx, 1.1, -0.76)), 'glow'))
        p.append(finish(torus(0.25, 0.02, loc=(tx, 1.1, -0.98)), 'glow'))
        # auxiliary thruster pointing back
        aux = cyl(0.13, 0.18, loc=(s * 0.42, 1.38, -0.32), rot=(math.pi / 2, 0, 0))
        boolean(aux, cyl(0.09, 0.2, loc=(s * 0.42, 1.45, -0.32), rot=(math.pi / 2, 0, 0)))
        p.append(finish(aux, 'trim', bevel=0.01))
        p.append(finish(cyl(0.09, 0.02, loc=(s * 0.42, 1.4, -0.32), rot=(math.pi / 2, 0, 0)), 'glow'))
        # power routing from the core channel to the thruster
        p.append(finish(tube([(0, 1.3, -0.38), (s * 0.18, 1.3, -0.48), (tx, 1.2, -0.56)], 0.028), 'glow'))
        # cooling fins down the side
        for i in range(5):
            p.append(finish(box((0.08, 0.45, 0.06), loc=(s * 0.66, cy, -0.32 + i * 0.14)), 'shell', bevel=0.01))
    p.append(finish(box((1.15, 0.55, 0.1), loc=(cx, cy, 0.72)), 'shell', bevel=0.025))  # top plate
    module_at('pack', (0, 0.05, -1.02), p)


def build_wings():
    """Each wing in its own frame (mech.js points it up and out, and mirrors the right one): blade along +x,
    flat in x-z, thin along y. Hinge hub with locking teeth, main segment with spar, LED, grooves and aileron,
    coverts over the root, and six layered feathers (<name>F0..F5) that mech.js fans open about their roots."""
    Y = (math.pi / 2, 0, 0)  # turns a cylinder to face along y
    for name in ('wingL', 'wingR'):
        p = []
        # rotation hinge with glowing rings and locking teeth
        p.append(finish(cyl(0.32, 0.22, loc=(0, 0, 0), rot=Y), 'trim', bevel=0.015))
        for fy in (-0.12, 0.12):
            p.append(finish(torus(0.24, 0.025, loc=(0, fy, 0), rot=Y), 'glow'))
            p.append(finish(cyl(0.13, 0.02, loc=(0, fy, 0), rot=Y), 'glow'))
        for i in range(8):
            a = i / 8 * math.tau
            p.append(finish(box((0.07, 0.26, 0.09), loc=(math.cos(a) * 0.33, 0, math.sin(a) * 0.33), rot=(0, -a, 0)), 'shell', bevel=0.01))
        p.append(finish(box((0.3, 0.3, 0.12), loc=(0.3, 0, 0.18), rot=(0, -0.3, 0)), 'dark', bevel=0.02))  # lock clamp
        # main wing segment
        main = plate2d(blade_outline(3.1, 0.6), 0.12)
        for gx in (1.0, 1.9):
            for gy in (-0.07, 0.07):
                boolean(main, box((0.025, 0.04, 0.8), loc=(gx, gy, 0)))  # panel grooves, both faces
        p.append(finish(main, 'shell', bevel=0.02))
        p.append(finish(box((2.5, 0.16, 0.09), loc=(1.3, 0, 0.27)), 'trim', bevel=0.02))  # leading-edge spar
        p.append(finish(box((2.0, 0.14, 0.04), loc=(1.25, 0, 0.12)), 'glow'))
        p.append(finish(box((0.8, 0.09, 0.15), loc=(2.0, 0, -0.27), rot=(0, 0.06, 0)), 'trim', bevel=0.015))  # aileron
        # coverts: overlapping scale plates over the root of the wing, on both faces
        for k, (ln, w) in enumerate(((1.15, 0.5), (0.9, 0.44), (0.65, 0.38))):
            for fy in (-1, 1):
                c = plate2d(blade_outline(ln, w), 0.035, loc=(0.18 + k * 0.32, fy * (0.075 + k * 0.012), 0.06 - k * 0.04))
                p.append(finish(c, 'trim' if k % 2 else 'shell', bevel=0.008))
        # six feathers in two overlapping layers (same span as before), each one object with its origin
        # at its root; mech.js fans them open (FEATHERS there has the same lengths)
        for i, (length, w) in enumerate(((2.6, 0.44), (2.4, 0.42), (2.2, 0.4), (2.0, 0.38), (1.8, 0.36), (1.6, 0.34))):
            root = (0.12, 0.05 + (i % 2) * 0.07 + i * 0.012, -0.1)
            f = finish(plate2d(blade_outline(length, w), 0.07, loc=root), 'trim' if i % 2 else 'shell', bevel=0.015)
            led = finish(box((length * 0.55, 0.1, 0.03), loc=(root[0] + length * 0.45, root[1], root[2])), 'glow')
            spar = finish(box((length * 0.7, 0.1, 0.06), loc=(root[0] + length * 0.38, root[1], root[2] + w * 0.38)), 'dark', bevel=0.01)
            knuckle = finish(cyl(0.07, 0.12, loc=root, rot=Y), 'dark')
            p.append(merge([f, led, spar, knuckle], f'{name}F{i}'))
        module(name, (0, 0, 0), p)


build_head()
build_torso()
build_shoulders()
build_arms()
build_legs()
build_backpack()
build_wings()
build_blade()

# ---------- export ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True)
with open(OUT, 'rb') as f:
    data = base64.b64encode(f.read()).decode()
# shipped as a JS module so it loads the same way in Orbit, the preview page and tests (no file fetch)
with open(OUT + '.js', 'w') as f:
    f.write('// Generated by tools/aerostrike.py, do not edit. The AeroStrike model (glTF binary, base64).\n')
    f.write(f"export default '{data}';\n")
os.remove(OUT)
print('wrote', OUT + '.js', len(data) * 3 // 4, 'bytes')
if '--blend' in sys.argv:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'tools', 'aerostrike.blend'))
