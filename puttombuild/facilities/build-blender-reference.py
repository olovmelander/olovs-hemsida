"""Create a new, source-pinned Puttom reference scene through Blender MCP.

Execute this file via blender_mcp_client.py. A separate scene library is written;
the existing user's scenes, active scene, selection and current file are retained.
The measured plan and laser are references, not finished architectural assets.
"""
import hashlib
import json
from pathlib import Path
import bpy

ROOT = Path(globals().get('PUTTOM_REPO_ROOT', r'C:\Users\olov_\repos\olovs-hemsida'))
HERE = ROOT / 'puttombuild/facilities'
PREFIX = 'PUT REF | '


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    spec_path = HERE / 'blender-reference-spec.json'
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    output = ROOT / spec['blendPath']
    assert not output.exists(), 'Preserve existing work; choose a new output file'
    assert not bpy.data.scenes.get(spec['sceneName']), 'Preserve existing scene; choose a new name'
    for item in spec['inputs']:
        assert digest(ROOT / item['path']) == item['sha256'], 'Changed input: ' + item['path']

    def snapshot():
        return {s.name: [(o.name, tuple(v for row in o.matrix_world for v in row),
                         o.data.name if o.data else None) for o in s.objects] for s in bpy.data.scenes}

    before = snapshot()
    active_before, file_before = bpy.context.scene.name, bpy.data.filepath
    selection_before = [o.name for o in bpy.context.selected_objects]
    scene = bpy.data.scenes.new(spec['sceneName'])
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    for key, value in {'reference_only': True, 'horizontal_crs': 'EPSG:3006',
                       'vertical_crs': 'RH2000 / EPSG:5613',
                       'origin_easting_northing': spec['originEPSG3006'],
                       'height_origin_rh2000_m': spec['heightOriginRh2000M'],
                       'axis_contract': 'X east; Y grid north; Z up; one unit = one metre',
                       'map_height_note': 'Orthophotos lie on arbitrary flat plan datum, not terrain',
                       'source_spec': 'puttombuild/facilities/blender-reference-spec.json'}.items():
        scene[key] = value

    def group(name, hidden=False):
        collection = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(collection)
        collection.hide_viewport = hidden
        return collection

    maps = group('01 Orthophotos - flat plan reference')
    roofs = group('02 Observed image roof edges')
    inherited = group('03 Existing app geometry - comparison')
    facilities = group('04 Facility and site references')
    labels = group('05 Labels and scale')
    boards = group('06 Real exterior photographs')
    laser = group('07 Original laser returns - enable to inspect', True)
    roof_surfaces = group('08 Laser supported roof studies', True) if spec.get('roofStudies') else None
    if roof_surfaces:
        roof_surfaces.hide_render = True
    cameras = group('09 Review cameras')
    oe, on = spec['originEPSG3006']
    oh = spec['heightOriginRh2000M']

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

    cyan = material('Observed cyan', (.03, .8, 1))
    amber = material('Inherited amber', (1, .45, .03))
    green = material('Site green', (.3, 1, .25))
    white = material('Label white', (1, 1, 1))

    def attributes(obj, values):
        obj['reference_only'] = True
        for key, value in values.items():
            if value is not None:
                obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value

    def line(name, vertices, collection, mat, closed=True, width=.10):
        data = bpy.data.curves.new(PREFIX + name, 'CURVE')
        data.dimensions, data.bevel_depth, data.bevel_resolution = '3D', width, 0
        spline = data.splines.new('POLY')
        spline.points.add(len(vertices) - 1)
        for point, vertex in zip(spline.points, vertices):
            point.co = (*vertex, 1)
        spline.use_cyclic_u = closed
        data.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, data)
        collection.objects.link(obj)
        return obj

    def label(body, position, size=2.2, collection=labels):
        data = bpy.data.curves.new(PREFIX + body, 'FONT')
        data.body, data.size, data.align_x = body, size, 'CENTER'
        data.materials.append(white)
        obj = bpy.data.objects.new(PREFIX + body, data)
        obj.location = position
        collection.objects.link(obj)
        return obj

    def plane(name, path, bounds, z, collection, metadata):
        w, s, e, n = bounds
        img = bpy.data.images.load(str(ROOT / path), check_existing=False)
        img.name = PREFIX + name
        img.pack()
        mesh = bpy.data.meshes.new(PREFIX + name)
        mesh.from_pydata([(w, s, z), (e, s, z), (e, n, z), (w, n, z)], [], [(0, 1, 2, 3)])
        mesh.update()
        uv = mesh.uv_layers.new(name='North up source pixels')
        for loop, coordinate in zip(mesh.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            uv.data[loop.index].uv = coordinate
        mat = bpy.data.materials.new(PREFIX + name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        emission = nodes.new('ShaderNodeEmission')
        out = nodes.new('ShaderNodeOutputMaterial')
        links.new(tex.outputs['Color'], emission.inputs['Color'])
        links.new(emission.outputs[0], out.inputs['Surface'])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        collection.objects.link(obj)
        attributes(obj, {'source_path': path, **metadata})
        return obj

    for index, panel in enumerate(spec['orthophotos']):
        w, s, e, n = panel['boundsEPSG3006']
        plane(panel['id'], panel['path'], [w-oe, s-on, e-oe, n-on], .02 + index*.01,
              maps, panel)

    for item in spec['outlines']:
        ring = item['ringEPSG3006']
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        assert len(ring) >= 2
        kind = item['kind']
        target = roofs if kind == 'observed-roof' else inherited if kind == 'inherited-building' else facilities
        mat = cyan if kind == 'observed-roof' else amber if kind == 'inherited-building' else green
        obj = line(item['id'], [(p[0]-oe, p[1]-on, .3) for p in ring], target, mat, item.get('closed', True))
        attributes(obj, {'evidence': item, 'architectural_model': False, 'height_verified': False})
        if item.get('label'):
            cx, cy = [sum(p[k] for p in ring)/len(ring) for k in (0, 1)]
            label(item['label'], (cx-oe, cy-on, .8), 1.8)

    for point in spec.get('points', []):
        x, y = point['pointEPSG3006'][0]-oe, point['pointEPSG3006'][1]-on
        obj = line(point['id'], [(x-.45, y-.45, .4), (x+.45, y+.45, .4),
                                (x, y, .4), (x-.45, y+.45, .4), (x+.45, y-.45, .4)],
                   facilities, green, False, .07)
        attributes(obj, {'evidence': point, 'point_location_only': True})

    w, s, e, n = spec['orthophotos'][0]['boundsEPSG3006']
    left, bottom, right, top = w-oe, s-on, e-oe, n-on
    label('PUTTOM / FACILITY REFERENCES', ((left+right)/2, top+17, .8), 6)
    label('CYAN observed roof edges | AMBER existing app outlines | GREEN site context',
          ((left+right)/2, bottom-14, .8), 2.8)
    line('50 metre scale', [(left+12, bottom+14, .8), (left+62, bottom+14, .8)], labels, white, False, .25)
    label('50 m', (left+37, bottom+19, .8), 3)
    line('Grid north', [(right-16, top-44, .8), (right-16, top-15, .8), (right-21, top-24, .8)], labels, white, False, .25)
    label('GRID N', (right-18, top-9, .8), 3)

    for index, photo in enumerate(spec['photos']):
        col, row = index % 4, index // 4
        width = min(95, 75*photo['width']/photo['height'])
        height = width*photo['height']/photo['width']
        x, y = right+35+col*110, top-row*110
        plane(photo['id'], photo['path'], [x, y-height, x+width, y], .5, boards,
              {**photo, 'not_a_runtime_texture': True})
        label(photo['id'], (x+width/2, y-height-5, 1), 2.5, boards)
    label('EXTERIOR PHOTOGRAPHS / SOURCE DETAILS ON OBJECTS', (right+240, top+17, .8), 4.5, boards)

    cloud_count = 0
    if spec.get('pointCloud'):
        cloud = json.loads((ROOT / spec['pointCloud']['path']).read_text(encoding='utf-8'))
        rows = cloud['points']
        cloud_count = len(rows)
        mesh = bpy.data.meshes.new(PREFIX + 'Original laser points')
        mesh.from_pydata([(p[0]-oe, p[1]-on, p[2]-oh) for p in rows], [], [])
        attribute = mesh.attributes.new('source_classification', 'INT', 'POINT')
        attribute.data.foreach_set('value', [int(p[3]) for p in rows])
        obj = bpy.data.objects.new(PREFIX + 'Original laser points', mesh)
        laser.objects.link(obj)
        obj.hide_render = True
        attributes(obj, spec['pointCloud'])

    for item in spec.get('roofStudies', []):
        mesh = bpy.data.meshes.new(PREFIX + item['id'])
        mesh.from_pydata([(p[0]-oe, p[1]-on, p[2]-oh) for p in item['verticesEPSG3006RH2000']], [], item['faces'])
        mesh.update()
        mesh.materials.append(cyan)
        obj = bpy.data.objects.new(PREFIX + item['id'], mesh)
        roof_surfaces.objects.link(obj)
        attributes(obj, {'evidence': item, 'architectural_model': False})

    def camera(name, bounds):
        x0, y0, x1, y1 = bounds
        data = bpy.data.cameras.new(PREFIX + name)
        data.type, data.ortho_scale, data.clip_end = 'ORTHO', max(x1-x0, y1-y0)+40, 3000
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = ((x0+x1)/2, (y0+y1)/2, 1000)
        cameras.objects.link(obj)
        return obj

    scene.camera = camera('Site plan camera', [left, bottom-20, right, top+20])
    camera('Photograph camera', [right+20, top-((len(spec['photos'])+3)//4)*110, right+475, top+20])
    for panel in spec['orthophotos'][1:]:
        w, s, e, n = panel['boundsEPSG3006']
        camera(panel['id'] + ' camera', [w-oe, s-on, e-oe, n-on])
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 1800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(ROOT / spec['previewPath'])
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new(PREFIX + 'World')
    scene.world.color = (.035, .04, .035)
    texts = set()
    for source in spec['catalogues']:
        data = bpy.data.texts.new(PREFIX + Path(source).name)
        data.write((ROOT / source).read_text(encoding='utf-8'))
        data.use_fake_user = True
        texts.add(data)
    notes = bpy.data.texts.new(PREFIX + 'READ ME')
    notes.write(spec['readme'])
    notes.use_fake_user = True
    texts.add(notes)
    for obj in scene.objects:
        obj['reference_only'] = True

    after = snapshot()
    assert all(after[name] == objects for name, objects in before.items()), 'An existing scene changed'
    assert bpy.context.scene.name == active_before and bpy.data.filepath == file_before
    assert [o.name for o in bpy.context.selected_objects] == selection_before
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), {scene, *texts}, path_remap='RELATIVE_ALL', fake_user=True, compress=True)
    report = {'passed': True, 'blenderVersion': bpy.app.version_string, 'scene': scene.name,
              'existingSceneTransformsPreserved': True, 'existingSelectionPreserved': True,
              'activeScenePreserved': active_before, 'currentFilePreserved': True,
              'objects': len(scene.objects), 'orthophotos': len(spec['orthophotos']),
              'outlines': len(spec['outlines']), 'photoBoards': len(spec['photos']),
              'sitePoints': len(spec.get('points', [])),
              'laserVertices': cloud_count, 'roofStudies': len(spec.get('roofStudies', [])),
              'blendPath': spec['blendPath'], 'blendBytes': output.stat().st_size,
              'blendSha256': digest(output), 'specSha256': digest(spec_path),
              'referenceOnly': True, 'architectureCompleted': False}
    (HERE / 'blender-build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


main()
