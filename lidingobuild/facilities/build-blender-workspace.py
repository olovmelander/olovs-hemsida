"""Build isolated Lidingö modelling/reference scenes via Blender MCP.

Run build(spec_path) inside Blender. Existing scene objects, active scene,
selection and current file are preserved. The library is packaged separately.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

PREFIX = 'LID | '


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(spec_path):
    spec_path = Path(spec_path).resolve()
    root = spec_path.parents[2]
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    output = root / spec['libraryPath']
    assert not output.exists(), 'Preserve the existing output; use a new output name'
    assert not any(bpy.data.scenes.get(n) for n in spec['sceneNames'].values())
    for item in spec['inputs']:
        assert sha(root / item['path']) == item['sha256'], 'Changed input: ' + item['path']
    model = json.loads((root / spec['modelPath']).read_text(encoding='utf-8'))
    original = {s.name: [(o.name, tuple(v for row in o.matrix_world for v in row),
                         o.data.name if o.data else None) for o in s.objects] for s in bpy.data.scenes}
    active, filepath = bpy.context.scene.name, bpy.data.filepath
    selection = [o.name for o in bpy.context.selected_objects]
    scenes = {}
    for role, name in spec['sceneNames'].items():
        scene = bpy.data.scenes.new(name)
        scenes[role] = scene
        scene.unit_settings.system = 'METRIC'
        scene['horizontal_crs'] = 'EPSG:3006'
        scene['vertical_crs'] = 'RH2000 / EPSG:5613'
        scene['origin_easting'] = 677700.5
        scene['origin_northing'] = 6586399.5
        scene['origin_height_rh2000'] = 25.0
        scene['axis_contract'] = 'X=E-677700.5; Y=N-6586399.5; Z=RH2000-25. One unit=1 metre.'
        scene['stage'] = 'Reference package and imported existing display model; detailed remodelling pending'
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        scene.render.resolution_x = 1600
        scene.render.resolution_y = 1100
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.view_settings.view_transform = 'Standard'
        scene.world = bpy.data.worlds.new(PREFIX + role + ' world')
        scene.world.use_nodes = True
        scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.16, .19, .22, 1)
        scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6

    scenes['plan'].render.resolution_x = 1100
    scenes['plan'].render.resolution_y = 1800

    def group(scene, name):
        col = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(col)
        return col

    architecture = group(scenes['model'], '01 Existing app architecture - EDITABLE BASELINE')
    terrain_col = group(scenes['model'], '02 Terrain - 1m source sampled every 2m')
    outline_col = group(scenes['model'], '03 Facility boundaries - dated evidence')
    source_col = group(scenes['model'], '04 Measured roof TIN - toggle to compare')
    source_col.hide_render = source_col.hide_viewport = True
    map_col = group(scenes['plan'], '01 Orthophotos - flat reference datum')
    plan_outlines = group(scenes['plan'], '02 Footprints and facility outlines')
    plan_labels = group(scenes['plan'], '03 Facility labels and grid north')
    photo_col = group(scenes['photos'], '01 Exterior reference boards')
    gaps_col = group(scenes['plan'], '04 Untraced search areas - NOT footprints')
    gaps_col.hide_render = gaps_col.hide_viewport = True
    materials = {}

    def material(name, rgb, emission=False):
        key = (name, emission)
        if key in materials:
            return materials[key]
        mat = bpy.data.materials.new(PREFIX + name)
        mat.diffuse_color = (*rgb, 1)
        mat.use_nodes = True
        if emission:
            mat.node_tree.nodes.clear()
            out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            em = mat.node_tree.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (*rgb, 1)
            mat.node_tree.links.new(em.outputs[0], out.inputs['Surface'])
        else:
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = (*rgb, 1)
            bsdf.inputs['Roughness'].default_value = .8
        materials[key] = mat
        return mat

    cyan = material('Building footprints cyan', (.08, .9, 1), True)
    green = material('Facility outlines lime', (.7, 1, .12), True)
    white = material('Reference labels', (.96, .98, 1), True)
    roof_mat = material('Measured roof evidence', (.1, .5, .7))
    amber = material('Untraced search areas amber', (1, .5, .08), True)

    def mesh(name, vertices, indices, collection, mat=None):
        data = bpy.data.meshes.new(PREFIX + name)
        data.from_pydata(vertices, [], [indices[i:i+3] for i in range(0, len(indices), 3)])
        data.update()
        if mat:
            data.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, data)
        collection.objects.link(obj)
        return obj

    def attributes(obj, data):
        for key, value in data.items():
            if value is None:
                value = 'unknown'
            obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value

    def line(name, vertices, collection, mat, width=.13):
        data = bpy.data.curves.new(PREFIX + name, 'CURVE')
        data.dimensions = '3D'
        data.bevel_depth, data.bevel_resolution = width, 0
        spline = data.splines.new('POLY')
        spline.points.add(len(vertices)-1)
        for point, vertex in zip(spline.points, vertices):
            point.co = (*vertex, 1)
        spline.use_cyclic_u = False
        data.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, data)
        collection.objects.link(obj)
        return obj

    def label(body, location, collection, size=2):
        data = bpy.data.curves.new(PREFIX + body[:55], 'FONT')
        data.body, data.size = body, size
        data.align_x = 'CENTER'
        data.materials.append(white)
        obj = bpy.data.objects.new(PREFIX + body[:55], data)
        obj.location = location
        collection.objects.link(obj)
        return obj

    for part in model['architectureMeshes']:
        color = part['color']
        rgb = tuple(((color >> n) & 255)/255 for n in (16, 8, 0))
        obj = mesh(part['buildingId'] + ' | ' + part['part'], part['vertices'], part['triangleIndices'],
                   architecture, material('Display ' + hex(color), rgb))
        attributes(obj, {'source_building_id': part['buildingId'], 'part': part['part'],
                         'evidence': part['evidence'], 'imported_existing_display': True,
                         'not_new_architectural_measurement': True})
    for roof in model['sourceRoofMeshes']:
        obj = mesh(roof['buildingId'] + ' | 2021 measured roof', roof['vertices'], roof['triangleIndices'], source_col, roof_mat)
        attributes(obj, {'source_building_id': roof['buildingId'], 'evidence': roof['metadata'],
                         'unsupported_regions': roof.get('uncoveredFootprintPolygons', [])})
    terrain = mesh('Terrain at source elevations', model['terrain']['vertices'], model['terrain']['triangleIndices'],
                   terrain_col, material('Neutral terrain', (.31, .40, .23)))
    terrain['source_spacing_metres'] = 1
    terrain['display_spacing_metres'] = 2

    loaded_images = []
    def image_material(item, name):
        img = bpy.data.images.load(str(root / item['path']), check_existing=False)
        img.name = PREFIX + name
        img.pack()
        loaded_images.append(img)
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
        return mat

    def image_plane(item, bounds, collection, height=0):
        x0, y0, x1, y1 = bounds
        obj = mesh(item['id'], [(x0,y0,height),(x1,y0,height),(x1,y1,height),(x0,y1,height)],
                   [0,1,2,0,2,3], collection, image_material(item, item['id']))
        uv = obj.data.uv_layers.new(name='Image pixel edges')
        coordinates = {
            1: [(0,0),(1,0),(1,1),(0,1)],
            2: [(1,0),(0,0),(0,1),(1,1)],
            3: [(1,1),(0,1),(0,0),(1,0)],
            4: [(0,1),(1,1),(1,0),(0,0)],
            5: [(1,1),(1,0),(0,0),(0,1)],
            6: [(1,0),(1,1),(0,1),(0,0)],
            7: [(0,0),(0,1),(1,1),(1,0)],
            8: [(0,1),(0,0),(1,0),(1,1)],
        }[item.get('exifOrientation', 1)]
        for loop in obj.data.loops:
            uv.data[loop.index].uv = coordinates[loop.vertex_index]
        attributes(obj, item)
        return obj

    cameras = {}
    def camera(scene, name, position, target, scale):
        data = bpy.data.cameras.new(PREFIX + name)
        data.type, data.ortho_scale, data.clip_end = 'ORTHO', scale, 5000
        data.sensor_fit = 'HORIZONTAL'
        obj = bpy.data.objects.new(PREFIX + name, data)
        scene.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        cameras[name] = obj
        return obj

    for i, panel in enumerate(spec['orthophotos']):
        w,s,e,n = panel['boundsEpsg3006']
        bounds = [w-677700.5,s-6586399.5,e-677700.5,n-6586399.5]
        obj = image_plane(panel, bounds, map_col, -.05-i*.002)
        if i:
            obj.hide_render = True
            obj.hide_viewport = True
        camera(scenes['plan'], panel['id'] + ' plan camera',
               ((bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2,900),
               ((bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2,0),
               max(bounds[2]-bounds[0], (bounds[3]-bounds[1])*1100/1800)*1.10)
    for footprint in model['buildingFootprints']:
        for i, ring in enumerate(footprint['rings']):
            name = footprint['id'] + ' footprint ' + str(i)
            obj = line(name, [(x,y,z+.15) for x,y,z in ring], outline_col, cyan)
            attributes(obj, {'evidence': footprint['metadata'], 'source_building_id': footprint['id']})
            line(name + ' plan', [(x,y,.3) for x,y,z in ring], plan_outlines, cyan, .3)
        ring = footprint['rings'][0]
        center = tuple(sum(p[k] for p in ring)/len(ring) for k in (0,1))
        label(footprint['id'], (*center, .6), plan_labels, 2.3)
    for facility in model['facilities']:
        for i, polygon in enumerate(facility['polygons']):
            for j, ring in enumerate(polygon['rings']):
                name = facility['id'] + ' ring ' + str(i) + '-' + str(j)
                obj = line(name, [(x,y,z+.12) for x,y,z in ring], outline_col, green)
                attributes(obj, {'evidence': facility['metadata'], 'kind': facility['kind'], 'interior_ring': j>0})
                line(name + ' plan', [(x,y,.2) for x,y,z in ring], plan_outlines, green, .18)
    for feature in model.get('supplementaryReferences', []):
        for i, ring in enumerate(feature['rings']):
            name = feature['id'] + ' additional source reference ' + str(i)
            mat = cyan if feature['metadata'].get('tags', {}).get('building') else green
            obj = line(name, [(x,y,z+.15) for x,y,z in ring], outline_col, mat)
            attributes(obj, {'evidence': feature['metadata'], 'additional_context_not_solid_model': True})
            line(name + ' plan', [(x,y,.25) for x,y,z in ring], plan_outlines, mat, .2)
    for gap in spec.get('unresolvedFacilities', []):
        bounds = gap.get('observationBoundsEpsg3006')
        if not bounds:
            continue
        west,south,east,north = bounds
        x0,y0,x1,y1 = west-677700.5,south-6586399.5,east-677700.5,north-6586399.5
        obj = line(gap['id'] + ' SEARCH AREA ONLY', [(x0,y0,.7),(x1,y0,.7),(x1,y1,.7),(x0,y1,.7),(x0,y0,.7)], gaps_col, amber, .2)
        attributes(obj, {'unresolved_facility': gap, 'not_a_footprint': True})
    w,s,e,n = spec['orthophotos'][0]['boundsEpsg3006']
    x0,y0,x1,y1 = w-677700.5,s-6586399.5,e-677700.5,n-6586399.5
    label('LIDINGÖ GK / 2025 ORTHOPHOTO / FACILITY REFERENCE', ((x0+x1)/2,y1+15,0), plan_labels, 5)
    label('Cyan: inherited building footprints | Lime: dated facility traces', ((x0+x1)/2,y0-12,0), plan_labels, 3)
    line('50 metre scale', [(x0+12,y0+15,1),(x0+62,y0+15,1)], plan_labels, white, .4)
    label('50 m', (x0+37,y0+20,1), plan_labels, 3)
    line('Grid north', [(x1-15,y1-48,1),(x1-15,y1-15,1),(x1-21,y1-24,1)], plan_labels, white, .4)
    label('N', (x1-15,y1-8,1), plan_labels, 5)
    scenes['plan'].camera = cameras[spec['orthophotos'][0]['id'] + ' plan camera']

    for i, photo in enumerate(spec['photos']):
        col, row = i%4, i//4
        width = 90
        height = width*photo['height']/photo['width']
        if height>65:
            width, height = width*65/height, 65
        x, y = col*105, -row*90
        image_plane(photo, [x,y-height,x+width,y], photo_col)
        label(photo['id'], (x+width/2,y-height-5,.3), photo_col, 2.1)
    rows = math.ceil(len(spec['photos'])/4)
    label('LIDINGÖ GK / EXTERIOR PHOTO REFERENCES', (200,15,0), photo_col, 5)
    scenes['photos'].camera = camera(scenes['photos'], 'Photo boards', (200,-rows*45+25,900),
                                      (200,-rows*45+25,0), max(460,rows*90*1600/1100+40))
    scenes['model'].camera = camera(scenes['model'], 'Clubhouse courtyard', (120,-45,130), (-42,95,7), 155)
    camera(scenes['model'], 'Range buildings', (115,-320,120), (-40,-130,4), 210)
    camera(scenes['model'], 'All facilities', (340,-540,420), (-85,-40,2), 760)
    for name, position, energy, size in [('Key', (80,-140,230), 2400, 120), ('Fill', (-150,160,160), 1700, 100)]:
        data = bpy.data.lights.new(PREFIX+name,'AREA')
        data.energy, data.shape, data.size = energy*100, 'DISK', size
        obj = bpy.data.objects.new(PREFIX+name,data)
        scenes['model'].collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector((-50,20,0))-obj.location).to_track_quat('-Z','Y').to_euler()
    sun_data = bpy.data.lights.new(PREFIX+'Sun','SUN')
    sun_data.energy, sun_data.angle = 2, .3
    sun = bpy.data.objects.new(PREFIX+'Sun',sun_data)
    sun.rotation_euler = (.5,-.4,-.5)
    scenes['model'].collection.objects.link(sun)

    notes = bpy.data.texts.new(PREFIX + 'START HERE - evidence and modelling brief')
    notes.write(spec['readme'])
    notes.use_fake_user = True
    for scene in scenes.values():
        scene['readme_text'] = notes.name
    after = {s.name: [(o.name, tuple(v for row in o.matrix_world for v in row),
                      o.data.name if o.data else None) for o in s.objects] for s in bpy.data.scenes}
    assert all(after[n] == objects for n,objects in original.items()), 'An existing scene changed'
    assert bpy.context.scene.name == active and bpy.data.filepath == filepath
    assert [o.name for o in bpy.context.selected_objects] == selection
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), set(scenes.values()) | {notes}, path_remap='RELATIVE_ALL', fake_user=True, compress=True)
    report = {'passed': True, 'stage': 'library-export', 'blenderVersion': bpy.app.version_string,
              'sceneCounts': {k: len(s.objects) for k,s in scenes.items()},
              'packedImages': len(loaded_images), 'sourceRoofMeshes': len(model['sourceRoofMeshes']),
              'editableArchitectureParts': len(model['architectureMeshes']),
              'buildingFootprints': len(model['buildingFootprints']), 'facilities': len(model['facilities']),
              'supplementaryReferences': len(model.get('supplementaryReferences', [])),
              'existingScenesPreserved': True, 'activeScenePreserved': active, 'currentFilePreserved': True,
              'selectionPreserved': True, 'libraryPath': spec['libraryPath'], 'librarySha256': sha(output),
              'libraryBytes': output.stat().st_size, 'architectureRemodelled': False}
    (root/spec['reportPath']).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
