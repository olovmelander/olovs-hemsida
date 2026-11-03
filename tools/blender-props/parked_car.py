"""A painted estate car for the player's car parks and roads (2 November).

Run in Blender 5.x (through the Blender MCP, or `blender -b -P parked_car.py`).
Builds one car and exports a GLB with two meshes:

- `car_body`: the lower body, bonnet, boot and roof, painted WHITE with its own
  shading in vertex colour, so the player gives each car its paint per instance;
- `car_trim`: the glasshouse, tyres and hubs, bumpers, lamps and mirrors.

Axes: Blender -Y runs along the car (front at -Y), X across, Z up; the glTF
exporter writes the front along +Z, X across, Y up, which is how the player's
parking rows already turn their cars. 4.35 m long, 1.78 m wide, 1.46 m tall,
the size the two boxes were. About 1,500 triangles: a car park of fifty is two
instanced draws.
"""
import math
import os
import bpy
import bmesh

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'parked-car.glb')


def clear():
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def box(name, size, centre, bevel=0.05, segments=2, taper=None):
    """A rounded box; `taper` (width, length) shrinks its top face toward its centre."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if taper:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        top = max(v.co.z for v in bm.verts)
        for v in bm.verts:
            if abs(v.co.z - top) < 1e-4:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
        bm.to_mesh(ob.data)
        bm.free()
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def cylinder(name, radius, depth, centre, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=centre, rotation=(0, math.pi / 2, 0), vertices=vertices)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def paint(ob, rgb, ground_dark=0.25, under_dark=0.35, top_lift=0.06):
    mesh = ob.data
    attr = mesh.color_attributes.get('Col') or mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    mw = ob.matrix_world
    for poly in mesh.polygons:
        n = (mw.to_3x3() @ poly.normal).normalized()
        for li in poly.loop_indices:
            z = (mw @ mesh.vertices[mesh.loops[li].vertex_index].co).z
            shade = 1 - ground_dark * max(0.0, 1 - z / 1.0)
            if n.z < -0.3:
                shade *= 1 - under_dark
            if n.z > 0.6:
                shade *= 1 + top_lift
            attr.data[li].color = (min(1, rgb[0] * shade), min(1, rgb[1] * shade), min(1, rgb[2] * shade), 1)
    mesh.color_attributes.active_color = attr


def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name
    return ob


def build():
    clear()
    white = (1.0, 1.0, 1.0)
    body = [
        # the lower body, sill to waist
        box('lower', (1.76, 4.32, 0.58), (0, 0, 0.60), bevel=0.14, segments=3),
        # the roof, over the glasshouse, a little shorter and narrower
        box('roof', (1.42, 2.30, 0.07), (0, 0.32, 1.42), bevel=0.04, segments=2),
    ]
    for ob in body:
        paint(ob, white)
    car_body = join('car_body', body)

    trim = []
    glass = box('glass', (1.56, 2.55, 0.52), (0, 0.26, 1.15), bevel=0.06, segments=2, taper=(0.9, 0.86))
    paint(glass, (0.16, 0.2, 0.24), ground_dark=0, top_lift=0)
    trim.append(glass)
    for y, colour in ((-2.17, (0.2, 0.21, 0.22)), (2.17, (0.2, 0.21, 0.22))):
        bumper = box('bumper', (1.70, 0.12, 0.20), (0, y, 0.44), bevel=0.04, segments=2)
        paint(bumper, colour, ground_dark=0)
        trim.append(bumper)
    for x in (-0.62, 0.62):
        head = box('headlamp', (0.36, 0.06, 0.12), (x, -2.165, 0.74), bevel=0.02, segments=1)
        paint(head, (0.95, 0.93, 0.82), ground_dark=0, top_lift=0)
        tail = box('taillamp', (0.30, 0.06, 0.16), (x, 2.165, 0.80), bevel=0.02, segments=1)
        paint(tail, (0.72, 0.08, 0.06), ground_dark=0, top_lift=0)
        mirror = box('mirror', (0.12, 0.14, 0.10), (x * 1.47, -0.62, 1.02), bevel=0.02, segments=1)
        paint(mirror, (0.18, 0.18, 0.19), ground_dark=0)
        trim += [head, tail, mirror]
    for x in (-0.8, 0.8):
        for y in (-1.38, 1.36):
            tyre = cylinder('tyre', 0.33, 0.23, (x, y, 0.33), vertices=18)
            mod = tyre.modifiers.new('bevel', 'BEVEL')
            mod.width = 0.05
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
            paint(tyre, (0.07, 0.07, 0.075), ground_dark=0.1, top_lift=0)
            hub = cylinder('hub', 0.19, 0.24, (x + (0.004 if x > 0 else -0.004), y, 0.33), vertices=12)
            paint(hub, (0.6, 0.61, 0.62), ground_dark=0, top_lift=0)
            trim += [tyre, hub]
    car_trim = join('car_trim', trim)
    mat = bpy.data.materials.get('car_paint') or bpy.data.materials.new('car_paint')
    for ob in (car_body, car_trim):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return car_body, car_trim


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export(objects):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                              export_vertex_color='ACTIVE', export_materials='NONE', export_yup=True,
                              export_normals=True, export_texcoords=False)
    return OUT


if __name__ == '__main__':
    car = build()
    print({'glb': export(car), 'tris': {ob.name: triangles(ob) for ob in car}})
