"""Pictures of an authored campus, on the CPU, before it goes anywhere near the app.

    blender --background --factory-startup --python tools/facility-pipeline/preview-facility-glb.py -- \
        --manifest <dir>/facilities-v1.json [--glb <file>] [--public apps/golf/public] --out <dir> \
        [--only <facility id>,...] [--samples 24] [--size 960x640] [--threads 2]

Each facility of the manifest is drawn from two sides, standing on a plain ground at its own anchor height and lit
by one sun, so a wrong roof, a missing wall or a part that floats shows before the model is published. The cameras
come from the manifest's own bounds: no view is written by hand. Cycles on the CPU, two threads by default, no GPU.
It is a look at the model's shape and colours; how it sits in the course is the first look's to show.

The manifest's frame is the app's (east, up, south); Blender's glTF import turns that to (east, north, up).
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--glb', type=Path)
    ap.add_argument('--public', type=Path, default=Path('apps/golf/public'))
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=24)
    ap.add_argument('--size', default='960x640')
    ap.add_argument('--threads', type=int, default=2)
    args = ap.parse_args(argv)
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    glb = args.glb or (args.manifest.parent / 'facilities.glb' if (args.manifest.parent / 'facilities.glb').exists() else args.public / manifest['asset']['url'])
    only = [s for s in args.only.split(',') if s]
    args.out = args.out.resolve()  # Blender resolves a relative render path against the drive, not the folder it runs in
    args.out.mkdir(parents=True, exist_ok=True)

    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 3
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = args.threads
    scene.render.resolution_x, scene.render.resolution_y = (int(v) for v in args.size.split('x'))
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('preview-sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.objects.new('preview-sun', bpy.data.lights.new('preview-sun', 'SUN'))
    sun.data.energy = 2.6
    sun.data.angle = 0.01
    scene.collection.objects.link(sun)
    ground_material = bpy.data.materials.new('preview-ground')
    ground_material.use_nodes = True
    ground_material.node_tree.nodes['Principled BSDF'].inputs[0].default_value = (0.16, 0.2, 0.1, 1)

    written = []
    for facility in manifest['facilities']:
        if only and facility['id'] not in only:
            continue
        lo, hi = facility['boundsLocalRh2000']['min'], facility['boundsLocalRh2000']['max']
        # app (east, up, south) -> Blender (east, north, up)
        centre = Vector(((lo[0] + hi[0]) / 2, -(lo[2] + hi[2]) / 2, (lo[1] + hi[1]) / 2))
        span = Vector((hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))
        radius = max(4.0, span.length / 2)
        level = facility['groundAnchorRh2000M']
        half = radius * 4
        mesh = bpy.data.meshes.new('preview-ground')
        mesh.from_pydata([(centre.x - half, centre.y - half, level), (centre.x + half, centre.y - half, level),
                          (centre.x + half, centre.y + half, level), (centre.x - half, centre.y + half, level)], [], [(0, 1, 2, 3)])
        mesh.materials.append(ground_material)
        ground = bpy.data.objects.new('preview-ground', mesh)
        scene.collection.objects.link(ground)
        target = Vector((centre.x, centre.y, max(level + span.z * 0.45, level + 1.0)))
        for label, azimuth in (('a', 215.0), ('b', 35.0)):  # from the south-west, then from the north-east
            a = math.radians(azimuth)
            eye = target + Vector((math.sin(a), math.cos(a), 0.0)) * radius * 2.4 + Vector((0, 0, radius * 0.75))
            camera = bpy.data.objects.new('preview-camera', bpy.data.cameras.new('preview-camera'))
            camera.data.lens = 35
            camera.location = eye
            camera.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
            scene.collection.objects.link(camera)
            scene.camera = camera
            # the sun over the viewer's left shoulder, so the side that is looked at is lit
            sun.rotation_euler = (math.radians(52), 0, math.radians(-azimuth - 35))
            scene.render.filepath = str(args.out / f"{facility['id']}-{label}.png")
            bpy.ops.render.render(write_still=True)
            written.append(scene.render.filepath)
            bpy.data.objects.remove(camera)
        bpy.data.objects.remove(ground)
    print(json.dumps(dict(glb=str(glb), pictures=written), indent=1))


if __name__ == '__main__':
    main()
