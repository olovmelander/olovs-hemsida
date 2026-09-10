"""Reopen and render the reference .blend in a separate background Blender.

blender --background <reference.blend> --python <this script> -- <spec.json>
This script never connects to or changes the live Blender window.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

PREFIX = 'JOH REF | '


def main():
    spec_path = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    root = spec_path.parents[2]
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    scene = bpy.data.scenes[spec['sceneName']]
    assert Path(bpy.data.filepath).resolve() == (root / spec['blendPath']).resolve()
    assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
    assert scene['reference_only'] and scene['horizontal_crs'] == 'EPSG:3006'
    assert list(scene['origin_easting_northing']) == spec['originEPSG3006']
    assert scene['height_origin_rh2000_m'] == spec['heightOriginRh2000M']
    assert all(o['reference_only'] for o in scene.objects)
    images = [i for i in bpy.data.images if i.name.startswith(PREFIX)]
    assert len(images) == len(spec['orthophotos']) + len(spec['photos'])
    assert all(i.packed_file for i in images), 'Image missing from saved .blend'
    # Packed pixels are loaded lazily after reopening a .blend.
    assert all(len(i.pixels) > 0 for i in images), 'Packed image could not be decoded'
    origin_e, origin_n = spec['originEPSG3006']
    for p in spec['orthophotos']:
        obj = scene.objects[PREFIX + p['id']]
        w, s, e, n = p['boundsEPSG3006']
        expected = [(w-origin_e, s-origin_n), (e-origin_e, s-origin_n),
                    (e-origin_e, n-origin_n), (w-origin_e, n-origin_n)]
        assert all(math.dist(tuple(v.co)[:2], xy) < .001 for v, xy in zip(obj.data.vertices, expected))
        uv = [tuple(v.uv) for v in obj.data.uv_layers.active.data]
        assert uv == [(0, 0), (1, 0), (1, 1), (0, 1)]
        img = bpy.data.images[PREFIX + p['id']]
        assert tuple(img.size) == (p['width'], p['height'])
    for f in spec['outlines']:
        obj = scene.objects[PREFIX + f['id']]
        assert json.loads(obj['evidence']) == f and not obj['architectural_model']
        assert obj.data.splines[0].use_cyclic_u == f['closed']
    for p in spec['photos']:
        obj = scene.objects[PREFIX + p['id']]
        assert obj['source_path'] == p['path'] and obj['not_a_texture_asset']
        assert tuple(bpy.data.images[PREFIX + p['id']].size) == (p['width'], p['height'])
    cloud = json.loads((root / spec['pointCloud']['path']).read_text(encoding='utf-8'))
    laser = scene.objects[PREFIX + '2021 laser returns - select and Tab to inspect']
    assert len(laser.data.vertices) == cloud['count'] and len(laser.data.polygons) == 0
    assert laser.hide_render and bpy.data.collections[PREFIX + '07 Laser evidence - vertices only'].hide_viewport
    classes = laser.data.attributes['source_classification']
    max_error = 0
    for i, p in enumerate(cloud['points']):
        target = (p[0]-origin_e, p[1]-origin_n, p[2]-spec['heightOriginRh2000M'])
        error = math.dist(laser.data.vertices[i].co, target)
        max_error = max(max_error, error)
        assert error < .001 and classes.data[i].value == p[3]
    previews = []
    for key, name in [('site', 'Site plan camera'), ('photos', 'Photo board camera')]:
        camera = scene.objects[PREFIX + name]
        assert math.sqrt(sum(v*v for v in camera.rotation_euler)) < 1e-8 and camera.data.type == 'ORTHO'
        scene.camera = camera
        scene.render.filepath = str(root / spec['previewPaths'][key])
        scene.render.resolution_x = scene.render.resolution_y = 1800 if key == 'site' else 2200
        scene.render.image_settings.color_mode = 'RGB'
        if '--check-only' not in sys.argv:
            bpy.ops.render.render(write_still=True, scene=scene.name)
        path = Path(scene.render.filepath)
        assert path.is_file() and path.stat().st_size > 10000
        previews.append({'path': spec['previewPaths'][key], 'bytes': path.stat().st_size,
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    if '--finalize' in sys.argv:
        # Library export preserves the user's live project. Finalize only this
        # separate background process into a normal, directly openable project.
        bpy.context.window.scene = scene
        scene.camera = scene.objects[PREFIX + 'Site plan camera']
        scene.render.filepath = str(root / spec['previewPaths']['site'])
        scene.render.resolution_x = scene.render.resolution_y = 1800
        from mathutils import Quaternion, Vector
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    space = area.spaces.active
                    space.shading.type = 'MATERIAL'
                    space.region_3d.view_rotation = Quaternion((1, 0, 0, 0))
                    space.region_3d.view_location = Vector((scene.camera.location.x, scene.camera.location.y, 0))
                    space.region_3d.view_distance = 680
                    space.region_3d.view_perspective = 'ORTHO'
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(root / spec['blendPath']))
    if '--check-only' in sys.argv:
        assert bpy.context.scene == scene, 'Project did not reopen on the reference scene'
    report = {'passed': True, 'blenderVersion': bpy.app.version_string,
              'reopenedBlendPath': spec['blendPath'],
              'blendSha256': hashlib.sha256((root / spec['blendPath']).read_bytes()).hexdigest(),
              'specSha256': hashlib.sha256(spec_path.read_bytes()).hexdigest(),
              'scene': scene.name, 'packedImages': len(images), 'outlines': len(spec['outlines']),
              'laserVertices': cloud['count'], 'maximumLaserCoordinateErrorMetres': max_error,
              'planBoundsAndUvsVerified': True, 'sourceAttributesVerified': True,
              'noArchitectureClaim': True, 'activeScene': bpy.context.scene.name,
              'checkedAfterFinalizedSave': '--check-only' in sys.argv, 'previews': previews}
    out = root / 'johannesbergbuild/facilities/blender-reopen-validation.json'
    out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
