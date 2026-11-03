"""A painted mute swan for the player's lakes (3 November).

Run in Blender 5.x (through the Blender MCP, or `blender -b -P swan.py`).
Builds one swan floating at the waterline and exports a GLB with two meshes:

- `swan_body`: body, wings folded high over the back, neck and head, painted
  white with its own shading (a little grey on the flanks and the belly);
- `swan_trim`: the orange bill with its black knob, and the eyes.

Axes: Blender -Y runs along the swan (bill at -Y), X across, Z up, the waterline
at z = 0; the glTF exporter writes the bill along +Z. About 1.4 m long. Uses
the same helpers as parked_car.py.
"""
import math
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
lib = runpy.run_path(os.path.join(HERE, 'parked_car.py'), run_name='banvy_prop_lib')
paint, join, clear, triangles = lib['paint'], lib['join'], lib['clear'], lib['triangles']
import bpy
from mathutils import Vector

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(HERE, 'out', 'swan.glb')


def paint_soft(ob, rgb, ground_dark=0.3, under_dark=0.22, top_lift=0.05):
    """Painted like the cars, but by the smooth vertex normal and in soft ramps, so
    a round body takes no facets: a little darker low on the flanks and under the
    belly, a little lighter on top."""
    mesh = ob.data
    attr = mesh.color_attributes.get('Col') or mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    mw = ob.matrix_world
    ramp = lambda a, b, x: min(1.0, max(0.0, (x - a) / (b - a)))
    for li, loop in enumerate(mesh.loops):
        v = mesh.vertices[loop.vertex_index]
        nz = (mw.to_3x3() @ v.normal).normalized().z
        z = (mw @ v.co).z
        shade = 1 - ground_dark * ramp(0.35, -0.05, z)
        shade *= 1 - under_dark * ramp(-0.1, -0.85, nz)
        shade *= 1 + top_lift * ramp(0.3, 0.9, nz)
        attr.data[li].color = (min(1, rgb[0] * shade), min(1, rgb[1] * shade), min(1, rgb[2] * shade), 1)
    mesh.color_attributes.active_color = attr


def smooth(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()


def ellipsoid(name, radii, centre, rotation=(0, 0, 0), segments=24, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=centre, rotation=rotation)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return ob


def neck_curve(name):
    """The S of the neck: a tapered tube along a curve from the breast to the head."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.055
    curve.bevel_resolution = 4
    curve.resolution_u = 10
    spline = curve.splines.new('BEZIER')
    pts = [(0, -0.42, 0.18), (0, -0.62, 0.48), (0, -0.54, 0.80)]
    spline.bezier_points.add(len(pts) - 1)
    for bp, co in zip(spline.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    spline.bezier_points[0].radius = 1.25
    spline.bezier_points[1].radius = 0.9
    spline.bezier_points[2].radius = 0.75
    ob = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.active_object


def build():
    clear()
    for ob in list(bpy.data.objects):
        if ob.type == 'CURVE':
            bpy.data.objects.remove(ob, do_unlink=True)
    white = (0.97, 0.97, 0.95)
    body = [
        # the body riding low, its waterline at z = 0
        ellipsoid('body', (0.30, 0.62, 0.22), (0, 0.05, 0.09)),
        # the wings folded and raised over the back
        ellipsoid('wings', (0.27, 0.48, 0.16), (0, 0.18, 0.22), rotation=(math.radians(-8), 0, 0)),
        # the tail's point
        ellipsoid('tail', (0.12, 0.2, 0.08), (0, 0.66, 0.2), rotation=(math.radians(-20), 0, 0), segments=14, rings=8),
        neck_curve('neck'),
        # the head
        ellipsoid('head', (0.06, 0.11, 0.07), (0, -0.58, 0.84), rotation=(math.radians(10), 0, 0), segments=16, rings=10),
    ]
    for ob in body:
        paint_soft(ob, white)
    swan_body = join('swan_body', body)

    trim = []
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.035, radius2=0.012, depth=0.12, location=(0, -0.72, 0.82), rotation=(math.radians(100), 0, 0))
    bill = bpy.context.active_object
    paint(bill, (0.95, 0.42, 0.08), ground_dark=0, top_lift=0)
    knob = ellipsoid('knob', (0.025, 0.035, 0.03), (0, -0.66, 0.86), segments=8, rings=6)
    paint(knob, (0.06, 0.06, 0.06), ground_dark=0, top_lift=0)
    trim += [bill, knob]
    for x in (-0.05, 0.05):
        eye = ellipsoid('eye', (0.012, 0.012, 0.012), (x, -0.63, 0.87), segments=6, rings=4)
        paint(eye, (0.04, 0.04, 0.04), ground_dark=0, top_lift=0)
        trim.append(eye)
    swan_trim = join('swan_trim', trim)
    mat = bpy.data.materials.get('car_paint') or bpy.data.materials.new('car_paint')
    for ob in (swan_body, swan_trim):
        smooth(ob)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return swan_body, swan_trim


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
    swan = build()
    print({'glb': export(swan), 'tris': {ob.name: triangles(ob) for ob in swan}})
