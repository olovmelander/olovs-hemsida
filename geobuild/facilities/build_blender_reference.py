"""Create a separate Veckefjarden reference scene and self-contained .blend library.

Execute through blender_mcp.py. All inputs are repository-relative and checked
against the prepared spec. Existing scenes, active selection and file are kept.
The map is a flat plan datum: no roof or ground elevation is asserted.
"""
import hashlib
import json
from pathlib import Path

import bpy

ROOT = Path(globals().get('VECK_REPO_ROOT', r'C:\Users\olov_\repos\olovs-hemsida'))
SPEC_PATH = ROOT / 'geobuild/facilities/blender-reference-spec.json'
PREFIX = 'VECK REF | '


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(spec_path=SPEC_PATH):
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    output = ROOT / spec['blendPath']
    if bpy.data.scenes.get(spec['sceneName']) or output.exists():
        raise RuntimeError('Reference scene/file already exists; choose a new scene name and output to retain work')
    for source in spec['inputs']:
        assert digest(ROOT / source['path']) == source['sha256'], source['path']
    before = {scene.name: tuple(sorted(obj.name for obj in scene.objects)) for scene in bpy.data.scenes}
    active_before = bpy.context.scene.name
    file_before = bpy.data.filepath
    selection_before = tuple(sorted(obj.name for obj in bpy.context.selected_objects))
    scene = bpy.data.scenes.new(spec['sceneName'])
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene['reference_only'] = True
    scene['horizontal_crs'] = 'EPSG:3006'
    scene['origin_easting_northing'] = spec['originEPSG3006']
    scene['axis_contract'] = 'X=easting-originE, Y=northing-originN, Z=up; grid north +Y'
    scene['height_note'] = 'All outlines are at a flat reference datum. Ground, eaves and ridge heights unmeasured.'
    scene['spec_path'] = spec_path.relative_to(ROOT).as_posix()
    scene['reference_date'] = spec['date']

    def collection(name):
        result = bpy.data.collections.new(PREFIX + name)
        scene.collection.children.link(result)
        return result

    maps = collection('01 Orthophotos')
    reviewed = collection('02 Reviewed image outlines')
    context = collection('03 Existing model context')
    labels = collection('04 Labels and scale')
    photos = collection('05 Exterior reference boards')
    cameras = collection('06 Review cameras')

    def xyz(point, z=0):
        return (point[0] - spec['originEPSG3006'][0], point[1] - spec['originEPSG3006'][1], z)

    def material(name, color):
        result = bpy.data.materials.new(PREFIX + name)
        result.diffuse_color = (*color, 1)
        result.use_nodes = True
        nodes = result.node_tree.nodes
        nodes.clear()
        emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (*color, 1)
        out = nodes.new('ShaderNodeOutputMaterial')
        result.node_tree.links.new(emission.outputs[0], out.inputs['Surface'])
        return result

    cyan = material('Reviewed cyan', (.04, .95, .98))
    amber = material('Context amber', (1, .48, .05))
    white = material('Labels', (1, 1, 1))

    def line(name, vertices, target, mat, closed=True, width=.12):
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
        target.objects.link(obj)
        return obj

    def label(name, position, size=2, target=labels):
        data = bpy.data.curves.new(PREFIX + name, 'FONT')
        data.body = name
        data.size = size
        data.align_x = 'CENTER'
        data.materials.append(white)
        obj = bpy.data.objects.new(PREFIX + name, data)
        obj.location = position
        target.objects.link(obj)
        return obj

    def image_plane(name, path, bounds, z, target, attributes):
        # Vertex order SW, SE, NE, NW; north is image TOP. No mirroring.
        left, bottom, right, top = bounds
        vertices = [(left,bottom,z), (right,bottom,z), (right,top,z), (left,top,z)]
        img = bpy.data.images.load(str(ROOT / path), check_existing=False)
        img.name = PREFIX + name
        img.pack()
        mesh = bpy.data.meshes.new(PREFIX + name)
        mesh.from_pydata(vertices, [], [(0,1,2,3)])
        mesh.update()
        layer = mesh.uv_layers.new(name='Source orientation')
        uv = [(0,0), (1,0), (1,1), (0,1)]
        for loop in mesh.loops:
            layer.data[loop.index].uv = uv[loop.vertex_index]
        mat = bpy.data.materials.new(PREFIX + name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = img
        emission = nodes.new('ShaderNodeEmission')
        out = nodes.new('ShaderNodeOutputMaterial')
        links.new(texture.outputs['Color'], emission.inputs['Color'])
        links.new(emission.outputs[0], out.inputs['Surface'])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        target.objects.link(obj)
        obj['source_path'] = path
        for key,value in attributes.items():
            obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict,list)) else value
        return obj

    for index, panel in enumerate(spec['orthophotos']):
        west,south,east,north = panel['boundsEPSG3006']
        e,n = spec['originEPSG3006']
        image_plane(panel['id'], panel['path'], [west-e,south-n,east-e,north-n], index*.03, maps,
                    {'capture_date':panel['captureDate'], 'bounds_epsg3006':panel['boundsEPSG3006'],
                     'pixel_size_metres':panel['pixelSizeMetres'], 'reference_only':True,
                     'source_absolute_accuracy':'unknown; pixel size is not survey accuracy'})
    for feature in spec['outlines']:
        ring = feature['ringEPSG3006']
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        obj = line(feature['id'], [xyz(point,.4) for point in ring],
                   reviewed if feature['reviewed'] else context, cyan if feature['reviewed'] else amber)
        obj['evidence'] = json.dumps(feature, ensure_ascii=False)
        obj['height_verified'] = False
        obj['reference_only'] = True
        center = [sum(p[i] for p in ring)/len(ring) for i in (0,1)]
        label(feature['id'], xyz(center,.8), 1.8)

    west,south,east,north = spec['orthophotos'][0]['boundsEPSG3006']
    e,n = spec['originEPSG3006']
    left,bottom,right,top = west-e,south-n,east-e,north-n
    label('VECKEFJARDEN / FACILITY REFERENCES', ((left+right)/2,top+12,1), 6)
    label('Cyan: reviewed image edges | Amber: existing model | Heights unmeasured', ((left+right)/2,bottom-12,1), 3)
    line('50 metre scale', [(left+12,bottom+15,1),(left+62,bottom+15,1)], labels, white, False,.3)
    label('50 m', (left+37,bottom+20,1),3)
    line('Grid north', [(right-18,top-50,1),(right-18,top-16,1),(right-23,top-24,1)], labels,white,False,.3)
    label('N / EPSG:3006', (right-22,top-10,1),2.2)

    for index, photo in enumerate(spec['photos']):
        col,row = index%4,index//4
        width = 90.0
        height = width*photo['height']/photo['width']
        if height>78:
            width *= 78/height
            height=78
        x = right+35+col*105
        y = top-row*110
        image_plane(photo['id'], photo['path'], [x,y-height,x+width,y],1, photos,
                    {'source_url':photo['sourceUrl'], 'source_page':photo['pageUrl'],
                     'capture_date':photo.get('captureDate','unknown'), 'reference_only':True,
                     'rights':photo['rights'], 'not_a_texture_asset':True})
        label(photo['id'], (x+width/2,y-height-5,1), 2.5, photos)
    label('EXTERIOR PHOTOS / REFERENCE ONLY', (right+235,top+12,1), 5,photos)

    def camera(name, bounds):
        x0,y0,x1,y1 = bounds
        data = bpy.data.cameras.new(PREFIX + name)
        data.type='ORTHO'
        data.ortho_scale=max(x1-x0,y1-y0)+35
        data.clip_end=3000
        obj=bpy.data.objects.new(PREFIX + name,data)
        obj.location=((x0+x1)/2,(y0+y1)/2,1000)
        cameras.objects.link(obj)
        return obj

    scene.camera = camera('Site plan camera',[left,bottom-20,right,top+20])
    camera('Photo board camera',[right+25,top-((len(spec['photos'])+3)//4)*110,right+455,top+20])
    for panel in spec['orthophotos'][1:]:
        w,s,ee,nn=panel['boundsEPSG3006']
        camera(panel['id']+' camera',[w-e,s-n,ee-e,nn-n])
    scene.camera = scene.objects[PREFIX+'campus-native camera']
    scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.render.resolution_x=1800
    scene.render.resolution_y=1800
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.filepath=str(ROOT/spec['previewPath'])
    scene.view_settings.view_transform='Standard'
    scene.world=bpy.data.worlds.new(PREFIX+'World')
    scene.world.color=(.055,.055,.055)
    notes=bpy.data.texts.new(PREFIX+'README')
    notes.write(spec['readme'])
    notes.use_fake_user=True
    scene['readme_text']=notes.name
    for obj in scene.objects:
        obj['reference_only']=True
    assert bpy.context.scene.name==active_before
    assert bpy.data.filepath==file_before
    assert tuple(sorted(o.name for o in bpy.context.selected_objects))==selection_before
    assert all(tuple(sorted(o.name for o in bpy.data.scenes[name].objects))==objects for name,objects in before.items())
    output.parent.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(output),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report={'passed':True, 'blenderVersion':bpy.app.version_string, 'scene':scene.name,
            'sceneObjects':len(scene.objects), 'orthophotos':len(spec['orthophotos']),
            'outlines':len(spec['outlines']), 'photoBoards':len(spec['photos']),
            'activeScenePreserved':active_before,'existingSceneObjectsPreserved':True,
            'currentFilePreserved':True,'selectionPreserved':True,
            'blendPath':spec['blendPath'],'blendBytes':output.stat().st_size,
            'blendSha256':digest(output),'specSha256':digest(spec_path),'referenceOnly':True,
            'physicalHeightsEstablished':False}
    (ROOT/spec['reportPath']).write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    build()
