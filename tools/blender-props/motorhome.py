"""A painted alcove motorhome for the player's motorhome lots (3 November).

Run in Blender 5.x (through the Blender MCP, or `blender -b -P motorhome.py`).
Builds one van and exports a GLB with two meshes:

- `van_body`: the living box, the alcove over the cab and the cab's nose,
  painted WHITE with its own shading in vertex colour (the player tints it);
- `van_trim`: windscreen, side windows, door, skirt, tyres and hubs, lamps.

Axes: Blender -Y runs along the van (front at -Y), X across, Z up; the glTF
exporter writes the front along +Z. 6.8 m long, 2.3 m wide, 3.05 m tall, the
size the boxes were. Uses the same helpers as parked_car.py.
"""
import math
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
car = runpy.run_path(os.path.join(HERE, 'parked_car.py'), run_name='banvy_prop_lib')
box, cylinder, paint, join, clear, triangles = car['box'], car['cylinder'], car['paint'], car['join'], car['clear'], car['triangles']
import bpy

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(HERE, 'out', 'motorhome.glb')


def build():
    clear()
    white = (1.0, 1.0, 1.0)
    body = [
        # the living box, from behind the cab to the tail
        box('living', (2.30, 5.0, 2.55), (0, 0.85, 1.70), bevel=0.16, segments=3),
        # the alcove over the cab, rounded at its nose
        box('alcove', (2.24, 1.55, 0.78), (0, -2.15, 2.52), bevel=0.24, segments=3),
        # the cab's nose and bonnet
        box('nose', (2.16, 1.15, 0.95), (0, -2.75, 0.95), bevel=0.18, segments=3),
    ]
    for ob in body:
        paint(ob, white)
    van_body = join('van_body', body)

    trim = []
    glass = box('windscreen', (2.04, 0.5, 0.78), (0, -2.42, 1.62), bevel=0.06, segments=2, taper=(0.98, 0.55))
    paint(glass, (0.15, 0.19, 0.23), ground_dark=0, top_lift=0)
    trim.append(glass)
    for side in (-1, 1):
        band = box('windows', (0.04, 3.2, 0.5), (side * 1.16, 0.55, 2.05), bevel=0.02, segments=1)
        paint(band, (0.16, 0.2, 0.25), ground_dark=0, top_lift=0)
        stripe = box('stripe', (0.03, 5.6, 0.12), (side * 1.165, 0.4, 1.28), bevel=0.01, segments=1)
        paint(stripe, (0.55, 0.62, 0.70), ground_dark=0, top_lift=0)
        trim += [band, stripe]
    door = box('door', (0.04, 0.7, 1.8), (1.165, -0.9, 1.35), bevel=0.02, segments=1)
    paint(door, (0.86, 0.86, 0.84), ground_dark=0.2)
    trim.append(door)
    skirt = box('skirt', (2.26, 6.2, 0.28), (0, 0.15, 0.48), bevel=0.05, segments=2)
    paint(skirt, (0.24, 0.25, 0.27), ground_dark=0.1)
    trim.append(skirt)
    for x in (-0.82, 0.82):
        lamp = box('headlamp', (0.34, 0.06, 0.14), (x, -3.33, 0.95), bevel=0.02, segments=1)
        paint(lamp, (0.95, 0.93, 0.82), ground_dark=0, top_lift=0)
        tail = box('taillamp', (0.18, 0.06, 0.5), (x * 1.18, 3.36, 0.95), bevel=0.02, segments=1)
        paint(tail, (0.72, 0.08, 0.06), ground_dark=0, top_lift=0)
        trim += [lamp, tail]
    for x in (-0.92, 0.92):
        for y in (-2.45, 1.95):
            tyre = cylinder('tyre', 0.36, 0.25, (x, y, 0.36), vertices=18)
            mod = tyre.modifiers.new('bevel', 'BEVEL')
            mod.width = 0.05
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
            paint(tyre, (0.07, 0.07, 0.075), ground_dark=0.1, top_lift=0)
            hub = cylinder('hub', 0.2, 0.26, (x + (0.004 if x > 0 else -0.004), y, 0.36), vertices=12)
            paint(hub, (0.6, 0.61, 0.62), ground_dark=0, top_lift=0)
            trim += [tyre, hub]
    van_trim = join('van_trim', trim)
    mat = bpy.data.materials.get('car_paint') or bpy.data.materials.new('car_paint')
    for ob in (van_body, van_trim):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return van_body, van_trim


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
    van = build()
    print({'glb': export(van), 'tris': {ob.name: triangles(ob) for ob in van}})
