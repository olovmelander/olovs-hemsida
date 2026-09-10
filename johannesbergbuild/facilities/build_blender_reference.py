"""Build only a new Johannesberg reference scene through the local Blender bridge.

Inputs are source-pinned, images are packed, and the scene is saved as a separate
.blend library. Existing scenes, their transforms, selection and file remain.
The flat orthophoto is a plan reference, not a model of terrain or architecture.
"""
import hashlib
import json
import math
from pathlib import Path
import bpy

PREFIX = 'JOH REF | '


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(spec_path):
    spec_path = Path(spec_path).resolve()
    root = spec_path.parents[2]
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    output = root / spec['blendPath']
    if bpy.data.scenes.get(spec['sceneName']) or output.exists():
        raise RuntimeError('Reference scene or output exists; use a new scene name/file to preserve earlier work')
    for item in spec['inputs']:
        if sha256(root / item['path']) != item['sha256']:
            raise RuntimeError('Source bytes changed: ' + item['path'])
    pinned = {item['path'] for item in spec['inputs']}
    for panel in spec['orthophotos']:
        w, s, e, n = panel['boundsEPSG3006']
        assert e > w and n > s and panel['path'] in pinned
    for photo in spec['photos']:
        assert photo['width'] > 0 and photo['height'] > 0 and photo['path'] in pinned
    for feature in spec['outlines']:
        assert len(feature['ringEPSG3006']) >= (3 if feature.get('closed', True) else 2)
        assert all(len(p) == 2 and all(math.isfinite(v) for v in p) for p in feature['ringEPSG3006'])
    for feature in spec.get('points', []):
        assert len(feature['pointEPSG3006']) == 2 and all(math.isfinite(v) for v in feature['pointEPSG3006'])
    cloud = None
    if spec.get('pointCloud'):
        assert spec['pointCloud']['path'] in pinned
        cloud = json.loads((root / spec['pointCloud']['path']).read_text(encoding='utf-8'))
        assert len(cloud['points']) == cloud['count']
        assert all(len(p) == 4 and all(math.isfinite(v) for v in p) for p in cloud['points'])

    def snapshot():
        return {s.name: [(o.name, tuple(v for row in o.matrix_world for v in row), o.data.name if o.data else None)
                         for o in s.objects] for s in bpy.data.scenes}

    before = snapshot()
    active_before, file_before = bpy.context.scene.name, bpy.data.filepath
    selection_before = tuple(o.name for o in bpy.context.selected_objects)
    scene = bpy.data.scenes.new(spec['sceneName'])
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene['reference_only'] = True
    scene['horizontal_crs'] = 'EPSG:3006'
    scene['vertical_crs'] = 'EPSG:5613 / RH 2000'
    scene['origin_easting_northing'] = spec['originEPSG3006']
    scene['height_origin_rh2000_m'] = spec['heightOriginRh2000M']
    scene['axis_contract'] = 'X=E-originE; Y=N-originN; Z=RH2000-originH. One Blender unit = one metre.'
    scene['height_note'] = spec['heightNote']
    scene['source_spec'] = spec_path.relative_to(root).as_posix()

    def group(name):
        collection = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(collection)
        return collection

    maps = group('01 Orthophotos - flat plan datum')
    reviewed = group('02 Photo-reviewed roof outlines')
    context = group('03 Inherited footprint context')
    landscape = group('04 Facility surfaces and access')
    labels = group('05 Labels and scale')
    boards = group('06 Exterior photos and official site map')
    laser = group('07 Laser evidence - vertices only')
    cameras = group('08 Review cameras')

    def xyz(p, height=None):
        return (p[0] - spec['originEPSG3006'][0], p[1] - spec['originEPSG3006'][1],
                p[2] - spec['heightOriginRh2000M'] if height is None and len(p) > 2 else (height or 0))

    def material(name, color):
        mat = bpy.data.materials.new(PREFIX + name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        mat.node_tree.nodes.clear()
        emission = mat.node_tree.nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (*color, 1)
        out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(emission.outputs[0], out.inputs['Surface'])
        return mat

    cyan = material('Reviewed cyan', (.05, .95, 1))
    amber = material('Inherited amber', (1, .55, .07))
    green = material('Facility surfaces', (.4, 1, .4))
    white = material('Labels', (1, 1, 1))

    def line(name, vertices, collection, mat, closed=True, width=.12):
        curve = bpy.data.curves.new(PREFIX + name, 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = width
        curve.bevel_resolution = 0
        spline = curve.splines.new('POLY')
        spline.points.add(len(vertices) - 1)
        for p, vertex in zip(spline.points, vertices):
            p.co = (*vertex, 1)
        spline.use_cyclic_u = closed
        curve.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, curve)
        collection.objects.link(obj)
        return obj

    def label(text, position, size=2.2, collection=labels):
        curve = bpy.data.curves.new(PREFIX + text, 'FONT')
        curve.body, curve.size, curve.align_x = text, size, 'CENTER'
        curve.materials.append(white)
        obj = bpy.data.objects.new(PREFIX + text, curve)
        obj.location = position
        collection.objects.link(obj)
        return obj

    def plane(name, source, bounds, height, collection, attributes):
        left, bottom, right, top = bounds
        img = bpy.data.images.load(str(root / source), check_existing=False)
        img.name = PREFIX + name
        img.pack()
        mesh = bpy.data.meshes.new(PREFIX + name)
        mesh.from_pydata([(left, bottom, height), (right, bottom, height),
                         (right, top, height), (left, top, height)], [], [(0, 1, 2, 3)])
        mesh.update()
        uv = mesh.uv_layers.new(name='Source image orientation')
        coords = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for loop in mesh.loops:
            uv.data[loop.index].uv = coords[loop.vertex_index]
        mat = bpy.data.materials.new(PREFIX + name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image, tex.interpolation = img, 'Linear'
        emission = nodes.new('ShaderNodeEmission')
        out = nodes.new('ShaderNodeOutputMaterial')
        links.new(tex.outputs['Color'], emission.inputs['Color'])
        links.new(emission.outputs[0], out.inputs['Surface'])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        collection.objects.link(obj)
        obj['source_path'] = source
        for key, value in attributes.items():
            obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
        return obj

    origin_e, origin_n = spec['originEPSG3006']
    for i, panel in enumerate(spec['orthophotos']):
        west, south, east, north = panel['boundsEPSG3006']
        plane(panel['id'], panel['path'], [west - origin_e, south - origin_n, east - origin_e, north - origin_n],
              .04 / (i + 1), maps, {'capture_date': panel['captureDate'], 'pixel_size_metres': panel['pixelSizeMetres'],
                             'bounds_epsg3006': panel['boundsEPSG3006'], 'flat_plan_reference': True})

    for feature in spec['outlines']:
        ring = feature['ringEPSG3006']
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        surface = feature['kind'] != 'building'
        collection = landscape if surface else (reviewed if feature['reviewed'] else context)
        mat = green if surface else (cyan if feature['reviewed'] else amber)
        obj = line(feature['id'], [xyz(p, .4) for p in ring], collection, mat, feature.get('closed', True))
        obj['evidence'] = json.dumps(feature, ensure_ascii=False)
        obj['architectural_model'] = False
        obj['geometry_kind'] = feature['geometryKind']
        center = [sum(p[k] for p in ring) / len(ring) for k in (0, 1)]
        if feature.get('shortLabel', feature['label']):
            label(feature.get('shortLabel', feature['label']), xyz(center, .8), 2)

    for feature in spec.get('points', []):
        x, y, z = xyz(feature['pointEPSG3006'], .8)
        obj = line(feature['id'], [(x-1, y-1, z), (x+1, y+1, z), (x, y, z),
                                  (x-1, y+1, z), (x+1, y-1, z)], landscape, green, False)
        obj['evidence'] = json.dumps(feature, ensure_ascii=False)
        obj['location_only_not_boundary'] = True
        label(feature['label'], (x, y+3, z), 2)

    west, south, east, north = spec['orthophotos'][0]['boundsEPSG3006']
    left, bottom, right, top = west - origin_e, south - origin_n, east - origin_e, north - origin_n
    label('JOHANNESBERG / FACILITY REFERENCES', ((left + right) / 2, top + 13, .8), 6)
    label('Cyan: photo-reviewed roof | Amber: inherited outline | Green: site facility',
          ((left + right) / 2, bottom - 12, .8), 3)
    line('50 metre scale', [(left + 12, bottom + 15, .8), (left + 62, bottom + 15, .8)], labels, white, False, .3)
    label('50 m', (left + 37, bottom + 20, 1), 3)
    line('Grid north', [(right - 16, top - 45, .8), (right - 16, top - 16, .8),
                        (right - 21, top - 24, .8)], labels, white, False, .3)
    label('GRID N', (right - 18, top - 10, 1), 3)

    for i, photo in enumerate(spec['photos']):
        col, row = i % 4, i // 4
        width = 95
        height = width * photo['height'] / photo['width']
        if height > 75:
            width, height = width * 75 / height, 75
        x, y = right + 35 + col * 110, top - row * 110
        plane(photo['id'], photo['path'], [x, y - height, x + width, y], .5, boards,
              {'source_url': photo['sourceUrl'], 'page_url': photo['pageUrl'],
               'capture_date': photo.get('captureDate') or 'unknown', 'rights': photo['rights'],
               'not_a_texture_asset': True, 'facility_ids': photo.get('facilityIds', [])})
        label(photo['id'], (x + width / 2, y - height - 5, 1), 2.5, boards)
    label('EXTERIOR VIEWS + OFFICIAL MAP / REFERENCE ONLY', (right + 240, top + 13, 1), 5, boards)

    cloud_count = 0
    if cloud:
        points = cloud['points']
        mesh = bpy.data.meshes.new(PREFIX + '2021 laser returns - not a roof mesh')
        mesh.from_pydata([xyz(p[:3]) for p in points], [], [])
        classification = mesh.attributes.new('source_classification', 'INT', 'POINT')
        classification.data.foreach_set('value', [p[3] for p in points])
        obj = bpy.data.objects.new(PREFIX + '2021 laser returns - select and Tab to inspect', mesh)
        laser.objects.link(obj)
        obj['source_path'] = spec['pointCloud']['path']
        obj['capture_date'] = spec['pointCloud']['captureDate']
        obj['height_note'] = 'Class 1 mixes roof/vegetation. Class 2 ground. Map plane is not the ground surface.'
        obj.hide_render = True
        laser.hide_viewport = True
        cloud_count = len(points)

    def camera(name, bounds):
        x0, y0, x1, y1 = bounds
        data = bpy.data.cameras.new(PREFIX + name)
        data.type, data.ortho_scale, data.clip_end = 'ORTHO', max(x1 - x0, y1 - y0) + 40, 3000
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = ((x0 + x1) / 2, (y0 + y1) / 2, 1000)
        cameras.objects.link(obj)
        return obj

    scene.camera = camera('Site plan camera', [left, bottom - 20, right, top + 20])
    camera('Photo board camera', [right + 20, top - ((len(spec['photos']) + 3) // 4) * 110,
                                   right + 475, top + 20])
    for panel in spec['orthophotos'][1:]:
        w, s, e, n = panel['boundsEPSG3006']
        camera(panel['id'] + ' camera', [w - origin_e, s - origin_n, e - origin_e, n - origin_n])
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 1800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(root / spec['previewPaths']['site'])
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new(PREFIX + 'World')
    scene.world.color = (.045, .045, .045)
    notes = bpy.data.texts.new(PREFIX + 'READ ME - facility modelling brief')
    notes.write(spec['readme'])
    notes.use_fake_user = True
    scene['readme_text'] = notes.name
    for obj in scene.objects:
        obj['reference_only'] = True

    after = snapshot()
    assert all(after[name] == objects for name, objects in before.items()), 'Existing scene changed'
    assert bpy.context.scene.name == active_before and bpy.data.filepath == file_before
    assert tuple(o.name for o in bpy.context.selected_objects) == selection_before
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), {scene, notes}, path_remap='RELATIVE_ALL', fake_user=True, compress=True)
    report = {'passed': True, 'artifactStage': 'library-export-before-project-finalization',
              'blenderVersion': bpy.app.version_string, 'scene': scene.name,
              'activeScenePreserved': active_before, 'existingSceneTransformsPreserved': True,
              'existingSelectionPreserved': True, 'currentFilePreserved': True,
              'objects': len(scene.objects), 'orthophotos': len(spec['orthophotos']), 'outlines': len(spec['outlines']),
              'photoBoards': len(spec['photos']), 'laserVertices': cloud_count,
              'blendPath': spec['blendPath'], 'blendBytes': output.stat().st_size, 'blendSha256': sha256(output),
              'specSha256': sha256(spec_path), 'referenceOnly': True, 'architectureCompleted': False}
    (root / spec['reportPath']).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(report, ensure_ascii=False))
    return scene
