"""Build a separate, metre-scaled Ängsö evidence workspace in live Blender.

No operators switch scenes, delete objects or save over the user's current file.
The packed library includes only this reference scene and its dependencies.
"""
import hashlib
import json
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'angsobuild/facilities'
PREFIX = 'ANG REF | '


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    spec_path = HERE / 'blender-reference-spec.json'
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    output = ROOT / spec['blendPath']
    assert not output.exists(), 'Choose a new output path to preserve the existing workspace'
    assert not bpy.data.scenes.get(spec['sceneName']), 'Choose a new reference scene name'
    for item in spec['inputs']:
        assert digest(ROOT / item['path']) == item['sha256'], 'Changed input: ' + item['path']

    def snapshot():
        return {scene.name: [(obj.name, tuple(value for row in obj.matrix_world for value in row),
                             obj.data.name if obj.data else None) for obj in scene.objects]
                for scene in bpy.data.scenes}

    before = snapshot()
    active_before = bpy.context.scene.name
    file_before = bpy.data.filepath
    selected_before = sorted(obj.name for obj in bpy.context.selected_objects)
    active_object_before = bpy.context.view_layer.objects.active
    scene = bpy.data.scenes.new(spec['sceneName'])
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    origin_e, origin_n = spec['originEPSG3006']
    height_origin = spec.get('heightOriginRh2000M', 0)
    for key, value in {
        'reference_only': True,
        'horizontal_crs': 'EPSG:3006',
        'origin_easting_northing': spec['originEPSG3006'],
        'vertical_crs': 'RH2000 / EPSG:5613',
        'height_origin_rh2000_m': height_origin,
        'axis_contract': 'X east; Y grid north; Z up. One unit = one metre.',
        'plan_datum_note': 'Image planes are flat display references; they are not physical terrain.',
        'source_spec': 'angsobuild/facilities/blender-reference-spec.json',
        'architectural_model_complete': False,
    }.items():
        scene[key] = value

    def group(name, hidden=False):
        collection = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(collection)
        collection.hide_viewport = hidden
        collection.hide_render = hidden
        return collection

    maps = group('01 Orthophotos - flat plan datum')
    observed = group('02 Observed image edges')
    context = group('03 Existing app geometry - comparison', True)
    site = group('04 Site and facility observations')
    labels = group('05 Labels and scales')
    photos = group('06 Photographs and site documents')
    laser = group('07 Original laser returns - enable to inspect', True)
    studies = group('08 Elevated laser support - enable to inspect', True)
    cameras = group('09 Review cameras')
    model = group('10 Architecture - ready for modelling')
    model['status'] = 'Empty authoring collection; references are not finished architecture'

    def attributes(obj, values):
        obj['reference_only'] = True
        for key, value in values.items():
            if value is not None:
                obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value

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

    cyan = material('Observed cyan', (.025, .75, 1))
    amber = material('Inherited amber', (1, .45, .03))
    green = material('Site green', (.35, 1, .25))
    white = material('Label white', (1, 1, 1))

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
        data = bpy.data.curves.new(PREFIX + body[:55], 'FONT')
        data.body, data.size, data.align_x = body, size, 'CENTER'
        data.materials.append(white)
        obj = bpy.data.objects.new(PREFIX + body[:55], data)
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
        uv = mesh.uv_layers.new(name='North-up image orientation')
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
        plane(panel['id'], panel['path'], [w-origin_e, s-origin_n, e-origin_e, n-origin_n],
              .02 + index * .008, maps, panel)

    for item in spec['outlines']:
        ring = item['ringEPSG3006']
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 2:
            continue
        kind = item['kind']
        inherited = kind.startswith('inherited')
        roof = any(term in kind for term in ('roof', 'building', 'canopy'))
        target = context if inherited else observed if roof else site
        mat = amber if inherited else cyan if roof else green
        obj = line(item['id'], [(p[0]-origin_e, p[1]-origin_n, .35) for p in ring],
                   target, mat, item.get('closed', True), .08)
        attributes(obj, {'evidence': item, 'height_verified': False, 'architectural_model': False})
        if not inherited:
            cx, cy = [sum(p[k] for p in ring)/len(ring) for k in (0, 1)]
            label(item['id'], (cx-origin_e, cy-origin_n, .85), 1.35)

    w, s, e, n = spec['orthophotos'][0]['boundsEPSG3006']
    left, bottom, right, top = w-origin_e, s-origin_n, e-origin_e, n-origin_n
    label('ANGSO / FACILITY REFERENCES', ((left+right)/2, top+20, .8), 9)
    label('CYAN image roof edges | GREEN site features | AMBER app comparison (hidden)',
          ((left+right)/2, bottom-16, .8), 4)
    line('50 metre scale', [(left+15, bottom+18, .8), (left+65, bottom+18, .8)], labels, white, False, .25)
    label('50 m', (left+40, bottom+25, .8), 3.5)
    line('Grid north', [(right-18, top-52, .8), (right-18, top-18, .8), (right-24, top-27, .8)], labels, white, False, .25)
    label('GRID N', (right-19, top-10, .8), 3.5)

    for index, photo in enumerate(spec['photos']):
        col, row = index % 4, index // 4
        width = min(95, 76 * photo['width']/photo['height'])
        height = width * photo['height']/photo['width']
        x, y = right+40+col*115, top-row*115
        plane(photo['id'], photo['path'], [x, y-height, x+width, y], .5, photos, photo)
        label(photo['id'], (x+width/2, y-height-5, .8), 2.5, photos)
    label('PHOTOS AND SITE DOCUMENTS / SOURCE LINKS ON OBJECTS', (right+255, top+17, .8), 4.5, photos)

    point_count = 0
    for cloud in spec.get('laserClouds', []):
        payload = json.loads((ROOT / cloud['path']).read_text(encoding='utf-8'))
        rows = payload['points']
        for cls in sorted(set(row[3] for row in rows)):
            points = [(row[0]-origin_e, row[1]-origin_n, row[2]-height_origin) for row in rows if row[3] == cls]
            mesh = bpy.data.meshes.new(PREFIX + f"{cloud['id']} class {cls}")
            mesh.from_pydata(points, [], [])
            mesh.update()
            obj = bpy.data.objects.new(mesh.name, mesh)
            laser.objects.link(obj)
            attributes(obj, {**cloud, 'las_classification': cls,
                             'point_display': 'Vertex-only mesh. Select and enter Edit Mode to see individual returns.',
                             'class_1_note': 'Unclassified is not a building classification.'})
            point_count += len(points)

    for study in spec.get('roofSupport', []):
        vertices = [(p[0]-origin_e, p[1]-origin_n, p[2]-height_origin) for p in study['verticesEPSG3006Rh2000']]
        mesh = bpy.data.meshes.new(PREFIX + study['id'])
        mesh.from_pydata(vertices, [], [tuple(range(len(vertices)))])
        mesh.materials.append(cyan)
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        studies.objects.link(obj)
        attributes(obj, study)
        obj['architectural_model'] = False

    def camera(name, bounds):
        x0, y0, x1, y1 = bounds
        data = bpy.data.cameras.new(PREFIX + name)
        data.type = 'ORTHO'
        data.ortho_scale = max(x1-x0, y1-y0) + 15
        data.clip_end = 6000
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = ((x0+x1)/2, (y0+y1)/2, 2200)
        cameras.objects.link(obj)
        return obj

    all_bounds = [panel['boundsEPSG3006'] for panel in spec['orthophotos']]
    scene.camera = camera('Whole site camera', [min(b[0] for b in all_bounds)-origin_e,
                                               min(b[1] for b in all_bounds)-origin_n-25,
                                               max(b[2] for b in all_bounds)-origin_e,
                                               max(b[3] for b in all_bounds)-origin_n+35])
    camera('Photo boards camera', [right+25, top-((len(spec['photos'])+3)//4)*115, right+500, top+30])
    for panel in spec['orthophotos']:
        pw, ps, pe, pn = panel['boundsEPSG3006']
        cam = camera(panel['id']+' camera', [pw-origin_e, ps-origin_n, pe-origin_e, pn-origin_n])
        if panel['id'] == spec['defaultPanel']:
            scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 1800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(ROOT / spec['previewPath'])
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new(PREFIX + 'World')
    scene.world.color = (.04, .045, .04)
    notes = bpy.data.texts.new(PREFIX + 'README')
    notes.write(spec['readme'])
    notes.use_fake_user = True
    scene['readme_text'] = notes.name
    scene['source_spec_sha256'] = digest(spec_path)
    texts = {notes}
    for path in spec.get('catalogues', []):
        data = bpy.data.texts.new(PREFIX + Path(path).name)
        data.write((ROOT / path).read_text(encoding='utf-8'))
        data.use_fake_user = True
        texts.add(data)
    for obj in scene.objects:
        obj['reference_only'] = True

    after = snapshot()
    assert all(after[name] == state for name, state in before.items())
    assert bpy.context.scene.name == active_before
    assert bpy.data.filepath == file_before
    assert sorted(obj.name for obj in bpy.context.selected_objects) == selected_before
    assert bpy.context.view_layer.objects.active == active_object_before
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), {scene, *texts}, path_remap='RELATIVE_ALL', fake_user=True, compress=True)
    report = {
        'passed': True, 'blenderVersion': bpy.app.version_string, 'scene': scene.name,
        'objects': len(scene.objects), 'orthophotos': len(spec['orthophotos']),
        'outlines': len(spec['outlines']), 'photoBoards': len(spec['photos']),
        'laserPoints': point_count, 'roofSupportSurfaces': len(spec.get('roofSupport', [])),
        'existingSceneObjectsAndTransformsPreserved': True, 'activeScenePreserved': active_before,
        'currentFilePreserved': file_before, 'selectionPreserved': True,
        'blendPath': spec['blendPath'], 'blendBytes': output.stat().st_size,
        'blendSha256': digest(output), 'specSha256': digest(spec_path),
        'referenceOnly': True, 'architecturalModelComplete': False,
    }
    (HERE / 'blender-build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    build()
