"""A painted grey heron standing in the shallows (3 November).

Run in Blender 5.x (through the Blender MCP, or `blender -b -P heron.py`).
Builds one heron standing on the lake bed, its feet at z = 0, and exports a
GLB with two meshes:

- `heron_body`: body, folded wings, neck and head, painted grey above and a
  paler grey-white on the neck and breast, by the smooth normal;
- `heron_trim`: the long yellow bill, the black crest and shoulder patch, the
  eye, and the legs.

Axes: Blender -Y runs along the bird (bill at -Y), X across, Z up, the feet at
z = 0; the glTF exporter writes the bill along +Z. About 1.0 m tall. Uses the
same helpers as parked_car.py and swan.py.
"""
import math
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
lib = runpy.run_path(os.path.join(HERE, 'parked_car.py'), run_name='banvy_prop_lib')
swan = runpy.run_path(os.path.join(HERE, 'swan.py'), run_name='banvy_prop_lib')
join, clear, triangles = lib['join'], lib['clear'], lib['triangles']
paint, paint_soft, smooth, ellipsoid = lib['paint'], swan['paint_soft'], swan['smooth'], swan['ellipsoid']
import bpy

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(HERE, 'out', 'heron.glb')


def tube(name, points, radii, bevel=0.03, resolution=8):
    """A tapered tube along a bezier through `points` (Blender coordinates)."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = bevel
    curve.bevel_resolution = 3
    curve.resolution_u = resolution
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for bp, co, r in zip(spline.bezier_points, points, radii):
        bp.co = co
        bp.radius = r
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.active_object


def leg(name, x):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.009, depth=0.5, location=(x, 0.02, 0.25))
    ob = bpy.context.active_object
    ob.name = name
    return ob


def build():
    clear()
    for ob in list(bpy.data.objects):
        if ob.type in ('CURVE', 'CAMERA', 'LIGHT') and ob.name.startswith(('neck', 'heron')):
            bpy.data.objects.remove(ob, do_unlink=True)
    grey, pale = (0.36, 0.38, 0.42), (0.86, 0.87, 0.86)
    body_parts = []
    # the body, held at a slant, the wings folded along it
    body = ellipsoid('body', (0.13, 0.27, 0.12), (0, 0.04, 0.6), rotation=(math.radians(-24), 0, 0))
    paint_soft(body, grey, ground_dark=0.0, under_dark=0.15, top_lift=0.06)
    wings = ellipsoid('wings', (0.14, 0.26, 0.09), (0, 0.08, 0.64), rotation=(math.radians(-22), 0, 0))
    paint_soft(wings, (0.31, 0.33, 0.37), ground_dark=0.0, under_dark=0.1, top_lift=0.05)
    tail = ellipsoid('tail', (0.07, 0.12, 0.04), (0, 0.29, 0.5), rotation=(math.radians(-35), 0, 0), segments=12, rings=8)
    paint_soft(tail, (0.26, 0.28, 0.31), ground_dark=0.0, under_dark=0.1, top_lift=0.0)
    # the neck: drawn in, an S from the breast up to the head
    neck = tube('neck', [(0, -0.08, 0.6), (0, -0.24, 0.78), (0, -0.19, 0.965)], [1.7, 0.95, 0.85], bevel=0.032)
    paint_soft(neck, pale, ground_dark=0.0, under_dark=0.08, top_lift=0.03)
    head = ellipsoid('head', (0.04, 0.075, 0.045), (0, -0.21, 0.97), rotation=(math.radians(8), 0, 0), segments=14, rings=10)
    paint_soft(head, pale, ground_dark=0.0, under_dark=0.05, top_lift=0.03)
    body_parts += [body, wings, tail, neck, head]
    heron_body = join('heron_body', body_parts)

    trim = []
    # the bill: long, dagger-like, yellow
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.016, radius2=0.002, depth=0.14, location=(0, -0.33, 0.965), rotation=(math.radians(96), 0, 0))
    bill = bpy.context.active_object
    paint(bill, (0.92, 0.66, 0.12), ground_dark=0, under_dark=0, top_lift=0)
    # the black crest stripe over the eye, trailing back as a plume
    crest = tube('heron_crest', [(0.0, -0.2, 1.005), (0.0, -0.13, 0.995), (0.0, -0.06, 0.965)], [1.0, 0.7, 0.3], bevel=0.012, resolution=6)
    paint(crest, (0.06, 0.06, 0.07), ground_dark=0, under_dark=0, top_lift=0)
    # the black shoulder patch at the bend of the wing
    shoulder = ellipsoid('shoulder', (0.135, 0.06, 0.05), (0, -0.12, 0.62), segments=12, rings=8)
    paint(shoulder, (0.12, 0.12, 0.14), ground_dark=0, under_dark=0, top_lift=0)
    eyes = []
    for x in (-0.033, 0.033):
        eye = ellipsoid('eye', (0.008, 0.008, 0.008), (x, -0.245, 0.98), segments=6, rings=4)
        paint(eye, (0.95, 0.8, 0.2), ground_dark=0, under_dark=0, top_lift=0)
        eyes.append(eye)
    legs = [leg('leg_l', -0.04), leg('leg_r', 0.04)]
    for lg in legs:
        paint(lg, (0.55, 0.5, 0.36), ground_dark=0.2, under_dark=0, top_lift=0)
    trim += [bill, crest, shoulder] + eyes + legs
    heron_trim = join('heron_trim', trim)
    mat = bpy.data.materials.get('car_paint') or bpy.data.materials.new('car_paint')
    for ob in (heron_body, heron_trim):
        smooth(ob)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return heron_body, heron_trim


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
    heron = build()
    print({'glb': export(heron), 'tris': {ob.name: triangles(ob) for ob in heron}})
