"""Grass cards for the tour turf (3 November, owner request: denser, more
impressive grass, not triangles).

Run in Blender 5.x through the Blender MCP. Builds four clumps of curved,
tapered grass blades in a scene of its own ("BanvyGrassCards"; it touches no
other scene) and renders them side by side, orthographic from the side, into a
transparent strip: four 512 x 256 tiles, each a clump 1.0 m wide and 0.5 m
tall standing on the tile's bottom edge.

  0  the rough: a dense clump, 20-35 cm
  1  fescue: fewer, taller, wispier blades, 30-48 cm, a few gone to straw
  2  short and dense, 10-24 cm
  3  mixed: green with a share of dry blades

The blades are painted by vertex colour (dark at the root, lighter to the tip,
each blade its own tone) and rendered through an emission shader, so the
texture is the grass's own colour and the game lights it. Seeded: the same
strip every run.
"""
import math
import os
import random

import bpy

OUT = os.environ.get('BANVY_CARDS_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'grass-cards.png')
SCENE = 'BanvyGrassCards'
TILE_W, TILE_H, TILES = 512, 256, 4
CELL = 1.0          # metres a tile is wide
HEIGHT = 0.5        # metres a tile is tall

VARIANTS = [
    dict(count=320, height=(0.2, 0.35), width=(0.009, 0.017), lean=(0.1, 0.55), dry=0.04),
    dict(count=170, height=(0.3, 0.48), width=(0.006, 0.012), lean=(0.15, 0.7), dry=0.22),
    dict(count=360, height=(0.1, 0.24), width=(0.009, 0.016), lean=(0.08, 0.5), dry=0.03),
    dict(count=280, height=(0.16, 0.38), width=(0.008, 0.015), lean=(0.1, 0.6), dry=0.3),
]
GREEN_ROOT, GREEN_TIP = (0.05, 0.11, 0.02), (0.30, 0.46, 0.09)
DRY_ROOT, DRY_TIP = (0.16, 0.14, 0.05), (0.62, 0.55, 0.26)


def scene():
    old = bpy.data.scenes.get(SCENE)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.scenes.remove(old)
    sc = bpy.data.scenes.new(SCENE)
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = TILE_W * TILES, TILE_H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    return sc


def blade_material():
    mat = bpy.data.materials.get('BanvyGrassBlade') or bpy.data.materials.new('BanvyGrassBlade')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    attr = nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    emit = nodes.new('ShaderNodeEmission')
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(attr.outputs['Color'], emit.inputs['Color'])
    links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def clump(sc, index, spec, rand):
    verts, faces, colours = [], [], []
    cx = index * CELL
    for _ in range(spec['count']):
        x = cx + (rand.random() - 0.5) * CELL * 0.82
        y = (rand.random() - 0.5) * 0.3
        h = spec['height'][0] + rand.random() * (spec['height'][1] - spec['height'][0])
        w = spec['width'][0] + rand.random() * (spec['width'][1] - spec['width'][0])
        lean = spec['lean'][0] + rand.random() * (spec['lean'][1] - spec['lean'][0])
        yaw = rand.random() * math.tau
        dx, dy = math.cos(yaw), math.sin(yaw)
        ax, ay = -dy, dx
        dry = rand.random() < spec['dry']
        root, tip = (DRY_ROOT, DRY_TIP) if dry else (GREEN_ROOT, GREEN_TIP)
        tone = 0.75 + rand.random() * 0.5
        seg = 6
        first = len(verts)
        for s in range(seg + 1):
            t = s / seg
            rise = h * t * (1 - 0.5 * lean * lean * t * t)
            out = h * lean * t * t
            half = 0.0 if s == seg else w * (1 - t) * (1 + 1.2 * t * (1 - t)) * 0.5
            px, py, pz = x + dx * out, y + dy * out, rise
            for side in ((-1, 1) if s < seg else (0,)):
                verts.append((px + ax * half * side, py + ay * half * side, pz))
                c = [min(1.0, (root[k] + (tip[k] - root[k]) * t ** 0.8) * tone) for k in range(3)]
                colours.append((*c, 1.0))
        for s in range(seg - 1):
            a = first + 2 * s
            faces.append((a, a + 1, a + 3, a + 2))
        a = first + 2 * (seg - 1)
        faces.append((a, a + 1, first + 2 * seg))
    mesh = bpy.data.meshes.new(f'grass_clump_{index}')
    mesh.from_pydata(verts, [], faces)
    attr = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(colours):
        attr.data[i].color = c
    mesh.materials.append(blade_material())
    ob = bpy.data.objects.new(f'grass_clump_{index}', mesh)
    sc.collection.objects.link(ob)
    return ob, len(faces)


def build():
    sc = scene()
    rand = random.Random(0x6a55)
    faces = [clump(sc, i, spec, rand)[1] for i, spec in enumerate(VARIANTS)]
    cam_data = bpy.data.cameras.new('grass_cards_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = CELL * TILES
    cam = bpy.data.objects.new('grass_cards_cam', cam_data)
    sc.collection.objects.link(cam)
    cam.location = (CELL * (TILES - 1) / 2, -3.0, HEIGHT / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    return sc, faces


def render(sc):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sc.render.filepath = OUT
    with bpy.context.temp_override(scene=sc):
        bpy.ops.render.render(write_still=True, scene=sc.name)
    return OUT


if __name__ == '__main__':
    sc, faces = build()
    print({'png': render(sc), 'faces': faces})
