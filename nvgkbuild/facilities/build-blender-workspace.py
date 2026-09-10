"""Build a separate, measured Norrfallsviken modelling workspace via Blender MCP.

Retains other scenes and the current file. The packed .blend is a local working
reference, including third-party photos; it is not a redistributable app asset.
Roof planes are measured. Walls, window divisions and decks are interpretations.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(r'C:\Users\olov_\repos\olovs-hemsida')
OUT = ROOT / 'nvgkbuild/cache/facilities-reference'
SCENE_NAME = 'Norrfallsviken | Measured facilities'
ORIGIN = (678580, 6988405, 32.8)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    blend_path = OUT / 'norrfallsviken-facilities.blend'
    if bpy.data.scenes.get(SCENE_NAME) or blend_path.exists():
        raise RuntimeError('Workspace exists; retain it and choose a new scene/output for a fresh build.')
    ortho_path = ROOT / 'nvgkbuild/mapping/facilities-ortho-reference.json'
    height_path = ROOT / 'nvgkbuild/mapping/facilities-height-reference.json'
    data_path = OUT / 'blender-source-data.json'
    ortho = json.loads(ortho_path.read_text(encoding='utf-8'))
    heights = json.loads(height_path.read_text(encoding='utf-8'))
    data = json.loads(data_path.read_text(encoding='utf-8'))
    assert tuple(data['originEpsg3006RH2000']) == ORIGIN
    for panel in ortho['panels']:
        assert sha(ROOT / panel['path']) == panel['sha256'], panel['id']
    assert sha(ROOT / heights['source']['localPointsPath']) == heights['source']['localPointsSha256']
    before = {s.name: tuple(sorted(o.name for o in s.objects)) for s in bpy.data.scenes}
    active_before, file_before = bpy.context.scene.name, bpy.data.filepath
    selection_before = tuple(sorted(o.name for o in bpy.context.selected_objects))
    scene = bpy.data.scenes.new(SCENE_NAME)
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene['origin_easting_northing_RH2000'] = ORIGIN
    scene['axis_contract'] = 'X=easting-678580; Y=northing-6988405; Z=RH2000-32.8; metres'
    scene['status'] = 'Measured reference workspace and initial building forms; facade detailing incomplete'
    scene['roof_tolerance'] = 'Planes approximately +/-0.2m vertically; sampled plan edges +/-0.5 to 1m'
    scene['source_dates'] = '2024-06-27 orthophoto; 2025-06-05 laser; individually dated exterior photos'

    def collection(name, hidden=False):
        c = bpy.data.collections.new('NV | ' + name)
        scene.collection.children.link(c)
        c.hide_viewport = hidden
        c.hide_render = hidden
        return c

    terrain_c = collection('01 Measured ground')
    roofs_c = collection('02 Measured roof planes')
    walls_c = collection('03 Interpreted walls and glazing')
    outlines_c = collection('04 Orthophoto traces and dimensions', True)
    maps_c = collection('05 Georeferenced source image planes', True)
    points_c = collection('06 Original laser returns', True)
    photos_c = collection('07 Photographic reference boards')
    setup_c = collection('08 Review cameras and lighting')
    evidence = []

    def material(name, hex_colour, roughness=.75):
        m = bpy.data.materials.new('NV | ' + name)
        rgb = [int(hex_colour[k:k+2], 16) / 255 for k in (0, 2, 4)]
        linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
        m.diffuse_color = (*linear, 1)
        m.use_nodes = True
        m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*linear, 1)
        m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = roughness
        return m

    red = material('Falu red timber - photo interpretation', '8b3a2c')
    roof_mat = material('Red roof - photo interpretation', 'b5705f')
    white = material('White fascia and frames', 'e6e4db')
    glass = material('Glazing placeholder - no interior survey', '425d63', .24)
    base_mat = material('Foundation display estimate', '77736a')
    cyan = material('Measured roof outlines', '44d0e8')
    amber = material('Orthophoto outlines', 'f2bc43')
    green = material('Practice mats', '2b6537')

    def xyz(point, h):
        return (point[0] - ORIGIN[0], point[1] - ORIGIN[1], h - ORIGIN[2])

    def mesh(name, vertices, faces, mat, group, props=None):
        if group in (roofs_c, maps_c, photos_c):
            faces = [tuple(reversed(face)) if (Vector(vertices[face[1]])-Vector(vertices[face[0]])).cross(
                Vector(vertices[face[2]])-Vector(vertices[face[0]])).z < 0 else face for face in faces]
        d = bpy.data.meshes.new('NV | ' + name)
        d.from_pydata(vertices, [], faces)
        d.update()
        if faces:
            bm = bmesh.new()
            bm.from_mesh(d)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(d)
            bm.free()
        # Open sheets have no enclosed volume to orient outward. Recalculation
        # can choose the underside, so their known upward direction is explicit.
        if group in (terrain_c, roofs_c, maps_c, photos_c):
            for polygon in d.polygons:
                if polygon.normal.z < 0: polygon.flip()
            d.update()
        obj = bpy.data.objects.new('NV | ' + name, d)
        group.objects.link(obj)
        if mat: d.materials.append(mat)
        for key, value in (props or {}).items(): obj[key] = value
        return obj

    def beam(name, a, b, radius, mat, group=walls_c):
        a, b = Vector(a), Vector(b)
        direction = (b - a).normalized()
        side = direction.cross(Vector((0, 0, 1)))
        if side.length < .01: side = direction.cross(Vector((0, 1, 0)))
        side.normalize()
        up = direction.cross(side).normalized()
        verts = [tuple(p + side * sx * radius + up * sy * radius)
                 for p in (a, b) for sx, sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        return mesh(name, verts, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], mat, group)

    def image_material(name, image_path, emission=False):
        im = bpy.data.images.load(str(image_path), check_existing=True)
        im.pack()
        m = bpy.data.materials.new('NV | ' + name)
        m.use_nodes = True
        nodes = m.node_tree.nodes
        nodes.clear()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = im
        tex.interpolation = 'Linear'
        tex.extension = 'CLIP'
        out = nodes.new('ShaderNodeOutputMaterial')
        shader = nodes.new('ShaderNodeEmission' if emission else 'ShaderNodeBsdfPrincipled')
        m.node_tree.links.new(tex.outputs['Color'], shader.inputs['Color' if emission else 'Base Color'])
        if not emission: shader.inputs['Roughness'].default_value = .95
        m.node_tree.links.new(shader.outputs[0], out.inputs['Surface'])
        return m

    def uv_map(obj, vertex_uv):
        uv = obj.data.uv_layers.new(name='Source geographic UV')
        for loop in obj.data.loops: uv.data[loop.index].uv = vertex_uv[loop.vertex_index]

    terrain = data['terrain']
    ground_mat = image_material('2024 orthophoto on 2025 ground - reference only', ROOT / ortho['source']['rgbPath'])
    covered = [face for face in terrain['triangles'] if all(terrain['orthoCovered'][i] for i in face)]
    uncovered = [face for face in terrain['triangles'] if not all(terrain['orthoCovered'][i] for i in face)]
    ground = mesh('Campus ground - 2m median laser sampling', terrain['vertices'], covered, ground_mat, terrain_c,
                  {'source': heights['source']['sourceId'], 'spacing_metres': 2.0,
                   'purpose': 'Modelling context; holes retained beyond 5m from ground evidence; not runtime terrain'})
    uv_map(ground, terrain['uv'])
    mesh('Ground outside orthophoto coverage - untextured', terrain['vertices'], uncovered, base_mat, terrain_c)
    points = mesh('Laser source returns - enable collection to inspect', data['pointCloud']['vertices'], [], None, points_c)
    points['source_point_count'] = len(data['pointCloud']['vertices'])
    points['source_path'] = heights['source']['localPointsPath']
    points['captured_at'] = heights['source']['capturedAt']
    attr = points.data.attributes.new('classification', 'INT', 'POINT')
    attr.data.foreach_set('value', data['pointCloud']['classification'])

    for panel in ortho['panels']:
        mat = image_material(panel['id'], ROOT / panel['path'], True)
        obj = mesh('Ortho | ' + panel['id'], [xyz(p, 25) for p in panel['cornersEpsg3006']], [(0,1,2,3)], mat, maps_c,
                   {'source_sha256': panel['sha256'], 'reference_only': True, 'source_gsd_metres': .16})
        uv_map(obj, [(0,1),(1,1),(1,0),(0,0)])

    for f in ortho['features']:
        ring = f['ringEpsg3006']
        for i, p in enumerate(ring):
            beam(f['id'] + ' | traced edge ' + str(i), xyz(p, 32.9), xyz(ring[(i+1)%len(ring)], 32.9), .035, amber, outlines_c)

    roof_records = []
    for f in heights['facilities']:
        if 'roofSupportRectangle' not in f:
            for plane in f['planes']:
                ring = plane['supportHullEpsg3006']
                a,b,c = plane['coefficientsLocalEN']
                e,n = f['originEpsg3006']
                verts = [xyz(p, a*(p[0]-e)+b*(p[1]-n)+c) for p in ring]
                mesh('Unresolved roof evidence | ' + plane['id'], verts, [tuple(range(len(verts)))], cyan, roofs_c,
                     {'status':'Measured patches only; practice-building roof form unresolved', 'support_count':plane['supportCount']})
            continue
        rect = f['roofSupportRectangle']
        ring, eaves = rect['ringEpsg3006'], rect['eavePlaneHeightsRH2000']
        ridge, hr = f['ridge']['endpointsEpsg3006'], f['ridge']['heightsRH2000']
        vertices = [xyz(p,h) for p,h in zip(ring,eaves)] + [xyz(p,h) for p,h in zip(ridge,hr)]
        obj = mesh('Measured roof | ' + f['id'], vertices, [(0,1,5,4),(2,3,4,5)], roof_mat, roofs_c,
                   {'source_reference': height_path.relative_to(ROOT).as_posix(), 'source_feature_id': f['id'],
                    'ridge_RH2000': hr, 'eave_RH2000': eaves,
                    'horizontal_uncertainty_metres':'0.5 to 1.0; inner roof-return envelope',
                    'source':'2025-06-05 LM laser plane fit'})
        roof_records.append({'id':f['id'], 'verticesEastingNorthingRH2000':
            [[round(v[k]+ORIGIN[k],6) for k in range(3)] for v in vertices], 'object':obj.name})
        # A wall inset and floor are design interpretations. They remain in a
        # separate collection so measured roof planes can be used independently.
        floor = 30.70 if f['id']=='lm-range-shelter' else 32.85
        center = Vector((sum(p[0] for p in ring)/4, sum(p[1] for p in ring)/4))
        walls = [tuple(center + (Vector(p)-center)*.955) for p in ring]
        verts = [xyz(p,floor-.25) for p in walls] + [xyz(p,h-.12) for p,h in zip(walls,eaves)]
        # The east-facing cross gable and pavilion glazing are established by
        # the 2020 official exterior; individual dimensions are approximate.
        glazed = f['id'] in ('clubhouse-cross-roof-native','clubhouse-north-annex-roof')
        open_range = f['id']=='lm-range-shelter'
        wall_faces = [(0,1,5,4),(2,3,7,6),(3,0,4,7)]
        if not glazed: wall_faces.append((1,2,6,5))
        if open_range: wall_faces.remove((0,1,5,4))
        body = mesh('Interpreted walls | ' + f['id'], verts, wall_faces, red, walls_c,
                    {'floor_RH2000_estimate':floor,'wall_inset_estimate':True,'unseen_facades':'Undetailed; no invented window schedule'})
        for i in range(4): beam('Corner trim | ' + f['id'] + str(i), verts[i], verts[i+4], .055, white)
        for a,b in [(0,1),(1,5),(5,2),(2,3),(3,4),(4,0)]:
            beam('Fascia | ' + f['id'] + str(a)+str(b), vertices[a],vertices[b],.065,white)
        beam('Ridge cap | ' + f['id'], vertices[4],vertices[5],.055,roof_mat)
        # Both gable ends close the massing; the photographed east end is glass.
        for edge, rid in [((0,3),4),((1,2),5)]:
            a,b=edge
            gmat=glass if glazed and rid==5 else red
            mesh('Gable | '+f['id']+str(rid), [vertices[a],vertices[b],vertices[rid]], [(0,1,2)], gmat,walls_c)
        if glazed:
            p0,p1=Vector(verts[5]),Vector(verts[6])
            b0,b1=Vector(verts[1]),Vector(verts[2])
            mesh('Glazed front | '+f['id'],[tuple(b0),tuple(b1),tuple(p1),tuple(p0)],[(0,1,2,3)],glass,walls_c,
                 {'reference':'official-clubhouse-east-20200819.jpg','divisions':'Photographic approximation, not measured'})
            for i in range(8):
                t=i/7
                beam('Glazing mullion | '+f['id']+str(i), b0.lerp(b1,t),p0.lerp(p1,t),.035,white)
            beam('Glazing transom | '+f['id'],p0,p1,.05,white)
            beam('Glazing ridge mullion | '+f['id'],(p0+p1)/2,vertices[5],.045,white)
        if open_range:
            p0,p1=Vector(verts[4]),Vector(verts[5])
            b0,b1=Vector(verts[0]),Vector(verts[1])
            for i,t in enumerate([0,.28,.74,1]):
                beam('Range front post '+str(i),b0.lerp(b1,t),p0.lerp(p1,t),.065,white)
            for a,b in [(0,.28),(.74,1)]:
                mesh('Range closed end', [tuple(b0.lerp(b1,a)),tuple(b0.lerp(b1,b)),tuple(p0.lerp(p1,b)),tuple(p0.lerp(p1,a))],[(0,1,2,3)],red,walls_c)
            mesh('Range slab - floor estimate',[xyz(p,floor) for p in walls],[(0,1,2,3)],base_mat,walls_c)
        evidence.append(f['id'])

    # The arrays are visible in 2024, but roof lean prevents directly treating
    # their pixel coordinates as surveyed placement. Keep them as plan outlines
    # for the artist until they have been registered to the measured roof.
    photo_files = [
        ('Clubhouse and pavilion | exterior 2020-08-19', 'official-clubhouse-east-20200819.jpg'),
        ('Range building and mats | 2025-05-28', 'official-range-20250528.jpg'),
        ('Historic entrance | 2016-08-25', 'official-entrance-practice-20160825.jpg'),
        ('Padel court | date unknown', 'padel-court22.webp'),
        ('Cafe/shop interior | date unknown', 'official-cafe.jpg'),
    ]
    photo_count=0
    for index,(label,filename) in enumerate(photo_files):
        file=OUT/'web'/filename
        if not file.exists(): continue
        mat=image_material(label,file,True)
        im=next(n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE')
        width=65
        height=width*im.size[1]/im.size[0]
        x=200+(index%2)*75
        y=35-(index//2)*65
        ob=mesh('Photo board | '+label,[(x,y,0),(x+width,y,0),(x+width,y-height,0),(x,y-height,0)],[(0,1,2,3)],mat,photos_c,
                {'reference_only':True,'source_path':file.relative_to(ROOT).as_posix(),'not_a_texture_asset':True})
        uv_map(ob,[(0,1),(1,1),(1,0),(0,0)])
        photo_count+=1

    def camera(name,position,target,ortho_scale=None):
        d=bpy.data.cameras.new('NV | '+name)
        d.clip_end=2000
        d.lens=45
        if ortho_scale: d.type='ORTHO'; d.ortho_scale=ortho_scale
        ob=bpy.data.objects.new('NV | '+name,d)
        setup_c.objects.link(ob)
        ob.location=position
        ob.rotation_euler=(Vector(target)-Vector(position)).to_track_quat('-Z','Y').to_euler()
        return ob

    close=camera('Clubhouse and pavilion',(44,38,24),(-2,4,2.5),55)
    campus=camera('Campus overview',(140,-165,165),(27,-65,-1),270)
    boards=camera('Photo reference boards',(270,-48,300),(270,-48,0),225)
    camera('Range building',(68,-63,23),(40,-109,1),45)
    for name,energy,position,size in [('Key',2400,(12,15,40),30),('Fill',1600,(-25,-10,28),25)]:
        d=bpy.data.lights.new('NV | '+name,'AREA'); d.energy=energy; d.shape='DISK'; d.size=size
        ob=bpy.data.objects.new('NV | '+name,d); setup_c.objects.link(ob); ob.location=position
        ob.rotation_euler=(-Vector(position)).to_track_quat('-Z','Y').to_euler()
    sun_data=bpy.data.lights.new('NV | Sun','SUN'); sun_data.energy=2.0; sun_data.angle=.12
    sun=bpy.data.objects.new('NV | Sun',sun_data); setup_c.objects.link(sun); sun.rotation_euler=(.35,-.45,-.6)
    scene.world=bpy.data.worlds.new('NV | World')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.32,.38,.43,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
    scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.render.resolution_x=1600; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'
    scene.camera=close
    notes=bpy.data.texts.new('NV | START HERE')
    notes.write('NORRFALLSVIKEN FACILITIES\n\nMetric source frame: X=easting-678580, Y=northing-6988405, Z=RH2000-32.8.\n'
        'Enable collections 04-06 for source outlines, georeferenced image planes and the full classified point cloud.\n'
        'Collection 02 contains measured roof planes; collection 03 is an initial architectural interpretation.\n'
        'Wall inset, floor thresholds, window divisions and hidden facades need further review. Practice roof remains unresolved.\n'
        '2024 imagery shows roof lean. Use 2025 laser coordinates for roof positioning. Solar arrays stay as unregistered source outlines.\n'
        'Photographs are packed as local modelling references, not textures or distributable game assets.\n'
        'See nvgkbuild/mapping/facilities-{ortho,height,web}-reference.json and the HTML reference gallery.\n')
    notes.use_fake_user=True
    scene['readme_text']=notes.name
    assert bpy.context.scene.name==active_before
    assert bpy.data.filepath==file_before
    assert tuple(sorted(o.name for o in bpy.context.selected_objects))==selection_before
    assert all(tuple(sorted(o.name for o in bpy.data.scenes[name].objects))==objects for name,objects in before.items())
    bpy.data.libraries.write(str(blend_path),{scene,notes},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report={'scene':scene.name,'blenderVersion':bpy.app.version_string,'blendPath':blend_path.relative_to(ROOT).as_posix(),
            'blendSha256':sha(blend_path),'blendBytes':blend_path.stat().st_size,'sceneObjects':len(scene.objects),
            'pointCount':len(data['pointCloud']['vertices']),'groundVertices':len(terrain['vertices']),
            'sourceImagePlanes':len(ortho['panels']),'photoBoards':photo_count,'measuredRoofs':roof_records,
            'activeScenePreserved':active_before,'currentFilePreserved':file_before,'otherScenesPreserved':True,
            'sourceFiles':[{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)} for p in (ortho_path,height_path,data_path)],
            'status':'Measured modelling workspace plus editable initial walls/glazing; not final app architecture'}
    (ROOT/'nvgkbuild/facilities/blender-workspace-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    for name,cam in [('clubhouse-study',close),('campus-study',campus),('reference-boards',boards)]:
        scene.camera=cam
        scene.render.filepath=str(OUT/(name+'.png'))
        bpy.ops.render.render(write_still=True,scene=scene.name)
    scene.camera=close
    print(json.dumps({k:v for k,v in report.items() if k!='measuredRoofs'}))


build()
