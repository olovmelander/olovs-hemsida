"""A painted golf cart for the player's cart parks (2 November).

Run in Blender 5.x (through the Blender MCP, or `blender -b -P golf_cart.py`).
Builds the cart in an empty scene and exports one GLB with two meshes:

- `cart_body`: the cowl, body and roof, painted WHITE in vertex colour with its
  own shading baked in, so the player tints each cart by instance colour (the
  fleet is white with one blue, as the club's photograph shows);
- `cart_trim`: seats, posts, windscreen, wheels, steering wheel and bag rack,
  in their own colours.

Axes: Blender X runs along the cart (front at +X), Y across, Z up; the glTF
exporter writes X along, -Z across and Y up, which the player reads.
Painted as the scenery is: flat albedo per part, a soft darkening toward the
ground and on down-facing faces, every edge bevelled once so the silhouette
holds from twenty metres and up close. About 2,000 triangles; a park holds
six to ten, drawn as two instanced meshes.
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector

OUT = os.environ.get('BANVY_PROP_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'golf-cart.glb')


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def rounded_box(name, size, centre, bevel=0.04, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = bevel
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def cylinder(name, radius, depth, centre, rotation=(0, 0, 0), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=centre, rotation=rotation, vertices=vertices)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def paint(ob, rgb, ground_dark=0.22, under_dark=0.30):
    """Flat albedo with a soft painted shade: darker toward the ground and on down-facing faces."""
    mesh = ob.data
    attr = mesh.color_attributes.get('Col') or mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    mw = ob.matrix_world
    for poly in mesh.polygons:
        n = (mw.to_3x3() @ poly.normal).normalized()
        for li in poly.loop_indices:
            v = mesh.vertices[mesh.loops[li].vertex_index].co
            z = (mw @ v).z
            shade = 1 - ground_dark * max(0.0, 1 - z / 1.2)
            if n.z < -0.3:
                shade *= 1 - under_dark
            attr.data[li].color = (rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, 1)
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
    body = []
    # the floor pan and the body tub, rounded
    body.append(rounded_box('tub', (2.25, 1.14, 0.42), (0, 0, 0.5), bevel=0.09, segments=3))
    # the front cowl, a little taller, curved over the front wheels
    body.append(rounded_box('cowl', (0.62, 1.10, 0.36), (0.80, 0, 0.82), bevel=0.12, segments=3))
    # the rear deck over the back wheels
    body.append(rounded_box('deck', (0.70, 1.12, 0.18), (-0.78, 0, 0.78), bevel=0.06, segments=2))
    # the roof: a thin rounded canopy
    body.append(rounded_box('roof', (2.34, 1.26, 0.07), (-0.05, 0, 1.86), bevel=0.03, segments=2))
    for ob in body:
        paint(ob, white)
    cart_body = join('cart_body', body)

    trim = []
    seat = (0.16, 0.17, 0.18)
    trim.append(rounded_box('seat', (0.62, 1.04, 0.16), (0.02, 0, 0.82), bevel=0.05, segments=2))
    trim.append(rounded_box('backrest', (0.12, 1.04, 0.46), (-0.32, 0, 1.12), bevel=0.05, segments=2))
    for ob in trim[-2:]:
        paint(ob, seat)
    posts = []
    for x, y in ((0.62, 0.56), (0.62, -0.56), (-1.08, 0.56), (-1.08, -0.56)):
        posts.append(cylinder('post', 0.028, 1.06, (x, y, 1.33), vertices=10))
    for ob in posts:
        paint(ob, (0.22, 0.23, 0.24), ground_dark=0)
    trim += posts
    # the windscreen, leaning back from the cowl to the roof
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.66, 0, 1.40), rotation=(0, math.radians(-78), 0))
    glass = bpy.context.active_object
    glass.scale = (0.86, 1.08, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    solid = glass.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = 0.015
    bpy.ops.object.modifier_apply(modifier=solid.name)
    paint(glass, (0.70, 0.80, 0.86), ground_dark=0)
    trim.append(glass)
    # the steering wheel on its column
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.022, location=(0.42, 0.26, 1.08),
                                     rotation=(0, math.radians(-55), 0), major_segments=20, minor_segments=6)
    wheel = bpy.context.active_object
    paint(wheel, (0.12, 0.12, 0.13), ground_dark=0)
    trim.append(wheel)
    column = cylinder('column', 0.02, 0.42, (0.56, 0.26, 0.92), rotation=(0, math.radians(35), 0), vertices=8)
    paint(column, (0.2, 0.2, 0.2), ground_dark=0)
    trim.append(column)
    # the bag rack behind the backrest
    rack = rounded_box('rack', (0.22, 0.86, 0.50), (-1.00, 0, 1.12), bevel=0.04, segments=2)
    paint(rack, (0.20, 0.21, 0.22))
    trim.append(rack)
    # the wheels: tyre and hub
    for x in (0.74, -0.74):
        for y in (0.52, -0.52):
            tyre = cylinder('tyre', 0.215, 0.17, (x, y, 0.215), rotation=(math.pi / 2, 0, 0), vertices=18)
            mod = tyre.modifiers.new('bevel', 'BEVEL')
            mod.width = 0.04
            mod.segments = 2
            bpy.ops.object.modifier_apply(modifier=mod.name)
            paint(tyre, (0.08, 0.08, 0.085), ground_dark=0.1)
            hub = cylinder('hub', 0.11, 0.18, (x, y + (0.006 if y > 0 else -0.006), 0.215), rotation=(math.pi / 2, 0, 0), vertices=14)
            paint(hub, (0.62, 0.63, 0.64), ground_dark=0)
            trim += [tyre, hub]
    cart_trim = join('cart_trim', trim)
    for ob in (cart_body, cart_trim):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        mat = bpy.data.materials.get('cart_paint') or bpy.data.materials.new('cart_paint')
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return cart_body, cart_trim


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


if __name__ == '__main__' or 'BANVY_PROP_RUN' in globals():
    cart = build()
    path = export(cart)
    print({'glb': path, 'tris': {ob.name: triangles(ob) for ob in cart}})
