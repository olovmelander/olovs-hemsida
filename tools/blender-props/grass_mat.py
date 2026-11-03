"""The grass mat for the shell turf (3 November, owner request: "a mat of dense
grass").

Run in Blender 5.x through the Blender MCP. Models a 1 x 1 m patch of dense
turf -- several thousand curved, tapered blades, scattered so the patch tiles
(a blade near an edge is drawn again one metre over, so its lean crosses the
seam) -- in a scene of its own ("BanvyGrassMat"; it touches no other scene),
and bakes it looking straight down through an orthographic camera into one
1024 x 1024 RGBA picture:

  RGB  the blades' colour (dark at the root, lighter to the tip, each blade its
       own tone, a few dry ones), rendered through emission, so it is the
       grass's own colour and the game lights it;
  A    the height of the topmost blade over the ground, 0 (bare) to 1 (the
       tallest tip), which the shells cut by.

Two renders of the same blades (colour, then height as an emission ramp),
packed into one PNG. Seeded: the same mat every run.
"""
import math
import os
import random

import bpy

OUT = os.environ.get('BANVY_MAT_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'grass-mat.png')
SCENE = 'BanvyGrassMat'
SIZE = 1024
BLADES = 16000
HEIGHT = (0.35, 1.0)    # in units of the mat's full height (1)
WIDTH = (0.005, 0.0105)  # metres
LEAN = (0.15, 0.75)
DRY = 0.05
GREEN_ROOT, GREEN_TIP = (0.05, 0.1, 0.02), (0.3, 0.46, 0.1)
DRY_ROOT, DRY_TIP = (0.15, 0.13, 0.05), (0.58, 0.52, 0.25)
TALL = 0.08             # metres the tallest tip stands, for the blade's own proportions


def scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE)
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('BanvyGrassMatWorld')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
    sc.world = world
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    return sc


def material(name, attribute):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    attr = nodes.new('ShaderNodeAttribute')
    attr.attribute_name = attribute
    emit = nodes.new('ShaderNodeEmission')
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(attr.outputs['Color'], emit.inputs['Color'])
    links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def build():
    sc = scene()
    rand = random.Random(0x3a7)
    verts, faces, colours, heights = [], [], [], []
    # the ground: the darkest root colour, at height 0
    for x, y in ((-0.1, -0.1), (1.1, -0.1), (1.1, 1.1), (-0.1, 1.1)):
        verts.append((x, y, -0.001))
        colours.append((GREEN_ROOT[0] * 0.6, GREEN_ROOT[1] * 0.6, GREEN_ROOT[2] * 0.6, 1))
        heights.append((0, 0, 0, 1))
    faces.append((0, 1, 2, 3))
    for _ in range(BLADES):
        x0, y0 = rand.random(), rand.random()
        h = (HEIGHT[0] + rand.random() * (HEIGHT[1] - HEIGHT[0])) * TALL
        w = WIDTH[0] + rand.random() * (WIDTH[1] - WIDTH[0])
        lean = LEAN[0] + rand.random() * (LEAN[1] - LEAN[0])
        yaw = rand.random() * math.tau
        dx, dy = math.cos(yaw), math.sin(yaw)
        ax, ay = -dy, dx
        dry = rand.random() < DRY
        root, tip = (DRY_ROOT, DRY_TIP) if dry else (GREEN_ROOT, GREEN_TIP)
        tone = 0.75 + rand.random() * 0.5
        seg = 5
        # the blade, and again one metre over wherever its lean could cross a seam
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                bx, by = x0 + ox, y0 + oy
                reach = h * lean + 0.02
                if bx < -reach or bx > 1 + reach or by < -reach or by > 1 + reach:
                    continue
                first = len(verts)
                for s in range(seg + 1):
                    t = s / seg
                    rise = h * t * (1 - 0.5 * lean * lean * t * t)
                    out = h * lean * t * t
                    half = 0.0 if s == seg else w * (1 - t) * (1 + 1.2 * t * (1 - t)) * 0.5
                    px, py = bx + dx * out, by + dy * out
                    for side in ((-1, 1) if s < seg else (0,)):
                        verts.append((px + ax * half * side, py + ay * half * side, rise))
                        c = [min(1.0, (root[k] + (tip[k] - root[k]) * t ** 0.8) * tone) for k in range(3)]
                        colours.append((*c, 1.0))
                        g = rise / TALL
                        heights.append((g, g, g, 1.0))
                for s in range(seg - 1):
                    a = first + 2 * s
                    faces.append((a, a + 1, a + 3, a + 2))
                a = first + 2 * (seg - 1)
                faces.append((a, a + 1, first + 2 * seg))
    mesh = bpy.data.meshes.new('grass_mat')
    mesh.from_pydata(verts, [], faces)
    for name, data in (('Col', colours), ('Height', heights)):
        attr = mesh.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(data):
            attr.data[i].color = c
    mesh.materials.append(material('BanvyGrassMatColour', 'Col'))
    ob = bpy.data.objects.new('grass_mat', mesh)
    sc.collection.objects.link(ob)
    cam_data = bpy.data.cameras.new('grass_mat_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 1.0
    cam = bpy.data.objects.new('grass_mat_cam', cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0.5, 0.5, 2.0)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    return sc, ob, len(faces)


def render(sc, ob):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    stem = OUT[:-4]
    paths = {}
    for pass_name, mat_name, attribute in (('colour', 'BanvyGrassMatColour', 'Col'), ('height', 'BanvyGrassMatHeight', 'Height')):
        ob.data.materials[0] = material(mat_name, attribute)
        sc.render.filepath = f'{stem}-{pass_name}.png'
        with bpy.context.temp_override(scene=sc):
            bpy.ops.render.render(write_still=True, scene=sc.name)
        paths[pass_name] = sc.render.filepath
    return paths


if __name__ == '__main__':
    sc, ob, faces = build()
    print({'png': render(sc, ob), 'faces': faces})
