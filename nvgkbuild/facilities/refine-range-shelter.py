"""Refine only the photographed range building in a separate Blender document.

From the repository root, in a separate process (never the live Blender MCP):
  & 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background `
    nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend `
    --python nvgkbuild/facilities/refine-range-shelter.py

The measured six-vertex roof, wall footprint and estimated floor stay registered
to the existing runtime contract. Facade dimensions and repeating cladding are
photographic interpretations, not additional measured survey observations.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'nvgkbuild/cache/facilities-reference'
BASE = DIRECTORY / 'norrfallsviken-facilities.blend'
OUTPUT = DIRECTORY / 'norrfallsviken-range-shelter-refined.blend'
ASSET = ROOT / 'apps/golf/src/engine/scenery/norrfallsviken-range-shelter-meshes.json'
REPORT = ROOT / 'nvgkbuild/facilities/range-refinement-validation.json'
SCENE = 'Norrfallsviken | Measured facilities'
COLLECTION = 'NV | 10 Refined range shelter'
ORIGIN = (678580.0, 6988405.0, 32.8)
FACILITY = 'lm-range-shelter'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def serial(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def snapshot(obj):
    return hashlib.sha256(serial({
        'matrix': [float(v) for row in obj.matrix_world for v in row],
        'vertices': [float(c) for v in obj.data.vertices for c in v.co] if obj.type == 'MESH' else [],
        'faces': [list(p.vertices) for p in obj.data.polygons] if obj.type == 'MESH' else [],
        'hidden': [obj.hide_render, obj.hide_viewport],
        'materials': [m.name for m in obj.data.materials] if obj.type == 'MESH' else [],
    }).encode()).hexdigest()


def main():
    assert bpy.app.background, 'Use an independent background Blender process'
    assert Path(bpy.data.filepath).resolve() == BASE.resolve(), 'Open the unchanged original workspace'
    base_hash = sha(BASE)
    base_report = load(ROOT / 'nvgkbuild/facilities/blender-workspace-validation.json')
    assert base_hash == base_report['blendSha256'], 'Original Blender workspace changed; retain it'
    if OUTPUT.exists():
        assert REPORT.exists() and load(REPORT)['refinedBlendSha256'] == sha(OUTPUT), 'Retain an unrecorded variation'
    base_asset_path = ROOT / 'apps/golf/src/engine/scenery/norrfallsviken-facilities-meshes.json'
    base_asset = load(base_asset_path)
    assert base_asset['sourceBlendSha256'] == base_hash
    layout = next(f for f in base_asset['facilities'] if f['id'] == FACILITY)
    height_path = ROOT / 'nvgkbuild/mapping/facilities-height-reference.json'
    height_catalogue = load(height_path)
    measured = next(f for f in height_catalogue['facilities'] if f['id'] == FACILITY)
    photo_catalogue_path = ROOT / 'nvgkbuild/mapping/facilities-web-reference.json'
    photo = next(f for f in load(photo_catalogue_path)['references'] if f['id'] == 'official-range-20250528')
    assert sha(ROOT / photo['localPath']) == photo['sha256']
    scene = bpy.data.scenes[SCENE]
    assert tuple(scene['origin_easting_northing_RH2000']) == ORIGIN
    original_names = {p['name'] for p in base_asset['parts'] if p['facilityId'] == FACILITY}
    other_objects = {o.name: snapshot(o) for o in bpy.data.objects if o.name not in original_names}
    other_scenes = {s.name: sorted(o.name for o in s.objects) for s in bpy.data.scenes if s != scene}
    assert COLLECTION not in bpy.data.collections, 'Refinement must start from the original source'
    collection = bpy.data.collections.new(COLLECTION)
    scene.collection.children.link(collection)
    for name in original_names:
        obj = scene.objects[name]
        obj.hide_render = True
        obj.hide_viewport = True
    floor = layout['floorRH2000Estimate']
    footprint_source = [Vector((p[0]-ORIGIN[0], p[1]-ORIGIN[1], floor-ORIGIN[2]))
                        for p in layout['wallFootprintEpsg3006']]
    # Photo left-to-right runs southeast to northwest on the NE-facing front.
    # Its right-hand door/window are therefore at source roof corner 0, not 1.
    footprint = [footprint_source[i] for i in (1,0,3,2)]
    u = (footprint[1]-footprint[0]).normalized()
    inward = (footprint[3]-footprint[0]).normalized()
    outward = -inward
    up = Vector((0, 0, 1))
    width = (footprint[1]-footprint[0]).length
    depth = (footprint[3]-footprint[0]).length
    centre = sum(footprint, Vector()) / 4
    bay = (.28*width, .735*width)
    door = (.808*width-.56, .808*width+.56, 0.0, 2.32)
    window = (.923*width-.535, .923*width+.535, 1.02, 2.32)

    def point(x, d, h):
        return footprint[0] + u*x + inward*d + up*h

    def roof_h(p):
        return min(a*(p.x+ORIGIN[0]-measured['originEpsg3006'][0]) +
                   b*(p.y+ORIGIN[1]-measured['originEpsg3006'][1]) + c - floor
                   for a, b, c in (f['coefficientsLocalEN'] for f in measured['planes'][:2]))

    def material(label, colour, roughness=.75):
        m = bpy.data.materials.new('NV | Range refined | '+label)
        values = [int(colour[i:i+2], 16)/255 for i in (0, 2, 4)]
        linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values]
        m.use_nodes = True
        shader = m.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value = (*linear, 1)
        shader.inputs['Roughness'].default_value = roughness
        m.diffuse_color = (*linear, 1)
        return m

    red = material('red timber', '873d3b')
    relief = material('timber battens', '914441')
    roof_red = material('profiled red roof', 'a86360')
    roof_high = material('restrained roof profile', 'b16c68')
    white = material('white joinery and rainwater goods', 'e4e4db')
    cover_mat = material('grey rolled weather cover', '777b79', .93)
    glass = material('plain glazing - no invented interior', '536873', .24)
    slab_mat = material('concrete threshold and existing slab', '999b91', .94)
    meshes = {}

    def geometry(label, role, mat, vertices, faces, normals=None):
        key = (label, role, mat.name)
        verts, polys = meshes.setdefault(key, ([], []))
        start = len(verts)
        verts.extend(tuple(float(c) for c in p) for p in vertices)
        for i, face in enumerate(faces):
            face = list(face)
            if normals is not None:
                n = (Vector(vertices[face[1]])-Vector(vertices[face[0]])).cross(
                     Vector(vertices[face[2]])-Vector(vertices[face[0]]))
                if n.dot(normals[i]) < 0:
                    face.reverse()
            polys.append(tuple(start+j for j in face))

    def prism(label, role, mat, front, inside):
        # Each building piece is a closed prism. Interior faces also face into
        # the open bay, so the browser needs no double-sided material hack.
        front = [Vector(v) for v in front]
        vertices = front + [v+inside for v in front]
        n = len(front)
        faces = [tuple(range(n)), tuple(range(n, 2*n))]
        faces.extend((i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n))
        centroid = sum(vertices, Vector())/len(vertices)
        normals = [sum((vertices[i] for i in face), Vector())/len(face)-centroid for face in faces]
        geometry(label, role, mat, vertices, faces, normals)

    def box(label, role, mat, a, b, side, half_width, half_depth):
        a, b, side = Vector(a), Vector(b), Vector(side).normalized()
        along = (b-a).normalized()
        other = along.cross(side).normalized()
        vertices = [p+side*s*half_width+other*t*half_depth for p in (a, b)
                    for s, t in ((-1,-1), (1,-1), (1,1), (-1,1))]
        faces = ((0,1,2,3), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7))
        centroid = (a+b)/2
        normals = [sum((vertices[i] for i in face), Vector())/len(face)-centroid for face in faces]
        geometry(label, role, mat, vertices, faces, normals)

    def tube(label, role, mat, a, b, radius, sides=8):
        a, b = Vector(a), Vector(b)
        direction = (b-a).normalized()
        side = direction.cross(up)
        if side.length < .01:
            side = direction.cross(u)
        side.normalize()
        other = direction.cross(side).normalized()
        vertices = [p + radius*(side*math.cos(j*math.tau/sides)+other*math.sin(j*math.tau/sides))
                    for p in (a,b) for j in range(sides)]
        faces = [tuple(range(sides)), tuple(range(sides,2*sides))]
        faces.extend((j,(j+1)%sides,(j+1)%sides+sides,j+sides) for j in range(sides))
        centroid = (a+b)/2
        normals = [sum((vertices[i] for i in face), Vector())/len(face)-centroid for face in faces]
        geometry(label, role, mat, vertices, faces, normals)

    roof_obj = scene.objects['NV | Measured roof | '+FACILITY]
    measured_vertices = [roof_obj.matrix_world@v.co for v in roof_obj.data.vertices]
    geometry('measured roof', 'measured-roof', roof_red, measured_vertices,
             [(0,1,5,4),(2,3,4,5)], [up,up])
    # Segment the front around actual photographed openings; the red wall does
    # not remain behind the glass or across the broad open bay.
    cuts = sorted({0.0, bay[0], bay[1], door[0], door[1], window[0], window[1], width})
    levels = [-.25, 0, window[2], door[3]]
    front_cells = []
    for left, right in zip(cuts, cuts[1:]):
        mid = (left+right)/2
        top_left = roof_h(point(left,0,0))-.04
        top_right = roof_h(point(right,0,0))-.04
        for k in range(len(levels)):
            bottom = levels[k]
            top = levels[k+1] if k+1 < len(levels) else min(top_left,top_right)
            mid_h = (bottom+top)/2
            in_bay = bay[0] < mid < bay[1] and bottom >= 0
            in_door = door[0] < mid < door[1] and 0 <= mid_h < door[3]
            in_window = window[0] < mid < window[1] and window[2] < mid_h < window[3]
            if in_bay or in_door or in_window:
                continue
            tl, tr = (top_left, top_right) if k+1 == len(levels) else (top,top)
            front_cells.append((left,right,bottom,tl,tr))
            prism('front timber around opening door and window', 'walls', red,
                  [point(left,0,bottom),point(right,0,bottom),point(right,0,tr),point(left,0,tl)], inward*.11)
    # Close the two gables at the inset wall line, all the way to the measured
    # roof underside. The previous low rectangular massing left a visible gap.
    plane_a, plane_b = [p['coefficientsLocalEN'] for p in measured['planes'][:2]]
    def ridge_depth(x):
        p = point(x,0,0)
        delta = ((plane_a[0]-plane_b[0])*(p.x+ORIGIN[0]-measured['originEpsg3006'][0]) +
                 (plane_a[1]-plane_b[1])*(p.y+ORIGIN[1]-measured['originEpsg3006'][1]) + plane_a[2]-plane_b[2])
        slope = (plane_a[0]-plane_b[0])*inward.x + (plane_a[1]-plane_b[1])*inward.y
        return -delta/slope
    for x, extrusion in ((0,u*.11),(width,-u*.11)):
        ridge_d = ridge_depth(x)
        front = [point(x,0,-.25),point(x,depth,-.25),
                 point(x,depth,roof_h(point(x,depth,0))-.04),
                 point(x,ridge_d,roof_h(point(x,ridge_d,0))-.04),
                 point(x,0,roof_h(point(x,0,0))-.04)]
        prism('closed timber gables', 'gable', red, front, extrusion)
        for d in [j*.18 for j in range(1,math.ceil(depth/.18)) if j*.18 < depth-.08]:
            h = roof_h(point(x,d,0))-.05
            outward_x = -u if x == 0 else u
            box('vertical timber relief', 'timber-relief', relief,
                point(x,d,.025)+outward_x*.018, point(x,d,h)+outward_x*.018,
                inward, .014,.018)
    prism('plain rear timber - unseen openings unspecified', 'walls', red,
          [point(0,depth,-.25),point(width,depth,-.25),
           point(width,depth,roof_h(point(width,depth,0))-.04),
           point(0,depth,roof_h(point(0,depth,0))-.04)], -inward*.11)
    # The visible left front panel has vertical battens. The door/window panel
    # is horizontal boarding in the 2025 photo; seams stop at each opening.
    for j in range(1,math.ceil(bay[0]/.18)):
        x = j*.18
        if x < bay[0]-.08:
            box('vertical timber relief', 'timber-relief', relief,
                point(x,-.018,.025),point(x,-.018,roof_h(point(x,0,0))-.06),u,.014,.018)
    for h in [j*.20 for j in range(1,16)]:
        intervals = [(bay[1],width)]
        for opening in (door,window):
            if opening[2] < h < opening[3]:
                intervals = [(a,min(b,opening[0])) for a,b in intervals if a < opening[0]] + [
                             (max(a,opening[1]),b) for a,b in intervals if b > opening[1]]
        for a,b in intervals:
            if b-a > .035 and h < min(roof_h(point(a,0,0)),roof_h(point(b,0,0)))-.08:
                box('horizontal boarding beside openings', 'timber-relief', relief,
                    point(a,-.014,h),point(b,-.014,h),up,.010,.014)
    for i, p in enumerate(footprint):
        h = roof_h(p)-.045
        direction = ((-u if i in (0,3) else u) + (outward if i in (0,1) else inward)).normalized()
        box('white corner trim', 'frame', white, p+direction*.025, p+up*h+direction*.025,u,.055,.055)
    for x in bay:
        box('open bay white jambs', 'post', white,
            point(x,-.02,0), point(x,-.02,roof_h(point(x,0,0))-.05),u,.067,.067)
    # A shallow header and rolled cover occupy only the top of the bay.
    box('open bay white header', 'frame', white,
        point(bay[0],-.015,roof_h(point(bay[0],0,0))-.13),
        point(bay[1],-.015,roof_h(point(bay[1],0,0))-.13),up,.075,.06)
    cover_start, cover_end = bay[0]+.09,bay[1]-.09
    cover_verts = []
    segments = 14
    for j in range(segments+1):
        t = j/segments
        x = cover_start+(cover_end-cover_start)*t
        ripple = .010*math.sin(j*2.2)
        hem = 2.43-.022*math.sin(math.pi*t)
        cover_verts.extend((point(x,.035+ripple,roof_h(point(x,0,0))-.23), point(x,.06+ripple,hem)))
    cover_faces = [(2*j,2*j+1,2*j+3,2*j+2) for j in range(segments)]
    geometry('grey rolled cover with restrained fabric relief', 'weather-cover', cover_mat,
             cover_verts,cover_faces,[outward]*segments)
    box('grey cover lower hem', 'weather-cover', cover_mat,
        point(cover_start,.055,2.43),point(cover_end,.055,2.43),up,.033,.025)
    for label, opening in (('glazed door',door),('separate window',window)):
        left,right,bottom,top = opening
        # A single plain pane: no invented muntins, handles, signs or interior.
        prism(label+' plain pane', 'door' if label == 'glazed door' else 'glazing', glass,
              [point(left+.07,.013,bottom+.065),point(right-.07,.013,bottom+.065),
               point(right-.07,.013,top-.065),point(left+.07,.013,top-.065)], inward*.025)
        for x in (left+.035,right-.035):
            box(label+' white frame', 'frame', white,point(x,-.025,bottom),point(x,-.025,top),u,.035,.045)
        for h in (bottom+.035,top-.035):
            box(label+' white frame', 'frame', white,point(left,-.025,h),point(right,-.025,h),up,.035,.045)
    # Full floor is retained at the previously reviewed estimate. Only the
    # small building threshold extends outside; the mat strip belongs to the
    # separate, orthophoto-aligned outdoor range implementation.
    geometry('existing floor estimate', 'slab', slab_mat,footprint,[(0,1,2,3)],[up])
    prism('open bay and entrance concrete threshold', 'threshold', slab_mat,
          [point(bay[0]-.07,-.25,.018),point(door[1]+.04,-.25,.018),
           point(door[1]+.04,.04,.018),point(bay[0]-.07,.04,.018)], -up*.08)
    # Existing measured roof remains untouched. Repeating low profile ribs
    # suggest the visible tile-effect roofing without fabricating measured tiles.
    for edge in ((0,1,4,5),(3,2,4,5)):
        ea,eb,ra,rb = (measured_vertices[i] for i in edge)
        length = (eb-ea).length
        count = math.floor(length/.28)
        for j in range(1,count):
            t = j/count
            spread = .052/length
            verts = []
            for s, lift in ((t-spread,.010),(t,.035),(t+spread,.010)):
                verts.extend((ea.lerp(eb,s)+up*lift,ra.lerp(rb,s)+up*lift))
            geometry('shallow tile effect roof ribs', 'roof-profile', roof_high,verts,
                     [(0,2,3,1),(2,4,5,3)],[up,up])
        courses = math.floor((ra-ea).length/.39)
        for j in range(1,courses):
            t = j/courses
            ds = .035/(ra-ea).length
            vertices = [ea.lerp(ra,t-ds)+up*.010,eb.lerp(rb,t-ds)+up*.010,
                        eb.lerp(rb,t+ds)+up*.042,ea.lerp(ra,t+ds)+up*.042]
            geometry('subtle roof course seams', 'roof-profile', roof_high,vertices,[(0,1,2,3)],[up])
    for a,b in ((0,1),(1,5),(5,2),(2,3),(3,4),(4,0)):
        box('white eaves and gable fascia', 'fascia', white,
            measured_vertices[a]-up*.06,measured_vertices[b]-up*.06,up,.075,.035)
    box('red ridge cap', 'ridge-cap', roof_high,
        measured_vertices[4]+up*.025,measured_vertices[5]+up*.025,up,.055,.09)
    # Both front downpipes are visible: the left beside the closed timber panel,
    # and the right around the corner. Rear pipe positions are unobserved.
    gutter_start = measured_vertices[0]+outward*.06-up*.06
    gutter_end = measured_vertices[1]+outward*.06-up*.06
    tube('white front gutter', 'gutter', white,gutter_start,gutter_end,.07)
    for x,t in ((.04,.018),(width-.04,.982)):
        gutter = gutter_start.lerp(gutter_end,t)
        vertical_top = point(x,-.10,roof_h(point(x,0,0))-.47)
        vertical_bottom = point(x,-.10,.18)
        elbow = point(x,-.12,.10)
        outlet = point(x,-.25,.085)
        for a,b in ((gutter,vertical_top),(vertical_top,vertical_bottom),(vertical_bottom,elbow),(elbow,outlet)):
            tube('two photographed white downpipes', 'downpipe', white,a,b,.05)

    objects = []
    for (label,role,mat_name),(vertices,faces) in meshes.items():
        mesh = bpy.data.meshes.new('NV | Range refined | '+label)
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        mesh.materials.append(bpy.data.materials[mat_name])
        obj = bpy.data.objects.new('NV | Range refined | '+label,mesh)
        collection.objects.link(obj)
        obj['facility_id'] = FACILITY
        obj['runtime_role'] = role
        obj['evidence'] = '2025-06-05 measured roof' if role == 'measured-roof' else '2025-05-28 official exterior photo; dimensions interpreted'
        objects.append(obj)
    provenance = {
        'baseBlend': BASE.relative_to(ROOT).as_posix(),'baseBlendSha256':base_hash,
        'baseArchitectureSha256':sha(base_asset_path),
        'heightReference':height_path.relative_to(ROOT).as_posix(),'heightReferenceSha256':sha(height_path),
        'laserCaptureDate':height_catalogue['source']['capturedAt'],
        'laserSourceUrl':height_catalogue['source'].get('sourceUrl',height_catalogue['source'].get('url')),
        'roofPlaneSupportCounts':[p['supportCount'] for p in measured['planes'][:2]],
        'roofPlaneRmseMetres':[p['residualRmseMetres'] for p in measured['planes'][:2]],
        'orthophotoReference':'nvgkbuild/mapping/facilities-ortho-reference.json',
        'orthophotoReferenceSha256':sha(ROOT/'nvgkbuild/mapping/facilities-ortho-reference.json'),
        'exteriorPhoto':{k:photo[k] for k in ('id','captureDate','captureDateStatus','imageUrl','metadataUrl','sha256')},
        'status':'Measured roof, retained interpreted footprint/floor, photo-informed facade and cladding',
        'openingDimensions':'Approximate proportions from a perspective photograph; no calibrated facade survey',
        'bayFractionOfFront':[.28,.735],
        'doorEstimateMetres':{'centreFraction':.808,'width':1.12,'height':2.32},
        'windowEstimateMetres':{'centreFraction':.923,'width':1.07,'sill':1.02,'head':2.32},
        'frontOutwardUnitEastNorth':[round(outward.x,6),round(outward.y,6)],
        'facadeLeftToRightUnitEastNorth':[round(u.x,6),round(u.y,6)],
        'facadeHandedness':'Door and window at northwest end; closed panel at southeast end; front faces northeast',
        'floorRH2000Estimate':floor,
        'limitations':['Wall footprint and floor retain the existing estimates, not surveyed thresholds.',
                       'Hidden rear openings and interiors are unspecified; rear wall is plain timber.',
                       'People obscure the lower door; a plain undivided pane avoids inventing decorative details.',
                       'Roof and timber repeating profiles are restrained visual interpretations, not individual measurements.',
                       'No reference photos, raw laser returns or source terrain are runtime geometry.']}
    notes = bpy.data.texts.new('NV | Range refinement source and limits')
    notes.write(json.dumps(provenance,ensure_ascii=False,indent=2))
    # Store a usable close review camera in this independent document only.
    camera_data = bpy.data.cameras.new('NV | Refined range review')
    camera_data.type='ORTHO';camera_data.ortho_scale=20.5;camera_data.lens=50
    camera = bpy.data.objects.new('NV | Refined range review',camera_data)
    scene.collection.objects.link(camera)
    target = centre+up*2.05
    camera.location=centre+outward*26+u*15+up*8
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=camera
    bpy.context.window.scene=scene
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
    scene.render.resolution_x=1440;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.render.filepath=str(DIRECTORY/'range-shelter-refined-review.png')
    assert all(snapshot(bpy.data.objects[name])==signature for name,signature in other_objects.items()), 'Unrelated object changed'
    assert {s.name:sorted(o.name for o in s.objects) for s in bpy.data.scenes if s!=scene}==other_scenes
    assert sha(BASE)==base_hash
    staged = OUTPUT.with_name('norrfallsviken-range-shelter-refined.staged.blend')
    assert not staged.exists(), 'Retain an existing staged variation'
    bpy.ops.wm.save_as_mainfile(filepath=str(staged),compress=True)
    assert sha(BASE)==base_hash
    staged.replace(OUTPUT)
    parts=[];minimum_area=float('inf')
    for obj in objects:
        mesh=obj.data;mesh.calc_loop_triangles()
        positions=[round(float(c),5) for v in mesh.vertices for c in obj.matrix_world@v.co]
        indices=[i for tri in mesh.loop_triangles for i in tri.vertices]
        shader=mesh.materials[0].node_tree.nodes['Principled BSDF']
        for start in range(0,len(indices),3):
            a,b,c=(Vector(positions[3*i:3*i+3]) for i in indices[start:start+3])
            area=(b-a).cross(c-a).length/2
            assert area>1e-8,f'Degenerate geometry: {obj.name}'
            minimum_area=min(minimum_area,area)
            if obj['runtime_role'] in ('measured-roof','roof-profile','slab'):
                assert (b-a).cross(c-a).z>0, f'Inverted upward sheet: {obj.name}'
        parts.append({'name':obj.name,'facilityId':FACILITY,'role':obj['runtime_role'],
                      'positions':positions,'indices':indices,
                      'colour':[float(c) for c in shader.inputs['Base Color'].default_value[:3]],
                      'roughness':float(shader.inputs['Roughness'].default_value),
                      'materialName':mesh.materials[0].name})
    expected_roof=next(p for p in base_asset['parts'] if p['facilityId']==FACILITY and p['role']=='measured-roof')
    exported_roof=next(p for p in parts if p['role']=='measured-roof')
    roof_error=max(abs(a-b) for a,b in zip(expected_roof['positions'],exported_roof['positions']))
    assert roof_error<.00002
    asset={'schemaVersion':1,'originEpsg3006RH2000':list(ORIGIN),'sourceBlendSha256':sha(OUTPUT),
           'coordinateFrame':base_asset['coordinateFrame'],'colourSpace':base_asset['colourSpace'],
           'positionPrecisionMetres':.00001,'facilities':[layout],
           'geometrySourceProvenance':provenance,'parts':parts}
    ASSET.write_text(serial(asset)+'\n',encoding='utf-8')
    receipt={'schemaVersion':1,'refinedBlend':OUTPUT.relative_to(ROOT).as_posix(),
             'refinedBlendSha256':sha(OUTPUT),'refinedBlendBytes':OUTPUT.stat().st_size,
             'sourceBlend':BASE.relative_to(ROOT).as_posix(),'sourceBlendSha256':base_hash,
             'generator':Path(__file__).relative_to(ROOT).as_posix(),'generatorSha256':sha(Path(__file__)),
             'blenderVersion':bpy.app.version_string,'blenderBinary':bpy.app.binary_path,
             'output':ASSET.relative_to(ROOT).as_posix(),'outputSha256':sha(ASSET),'outputBytes':ASSET.stat().st_size,
             'partCount':len(parts),'vertexCount':sum(len(p['positions'])//3 for p in parts),
             'triangleCount':sum(len(p['indices'])//3 for p in parts),'minimumTriangleAreaSquareMetres':minimum_area,
             'maximumMeasuredRoofVertexDifferenceMetres':roof_error,
             'geometrySourceProvenance':provenance,
             'preservation':{'baseBlendUnchanged':sha(BASE)==base_hash,'baseRuntimeAssetUnchanged':sha(base_asset_path)==provenance['baseArchitectureSha256'],
                             'unrelatedObjectsUnchanged':len(other_objects),'otherScenesUnchanged':len(other_scenes),
                             'unrelatedObjectsDigest':hashlib.sha256(serial(other_objects).encode()).hexdigest(),
                             'liveUserBlenderAccessed':False,'floorAndWallFootprintUnchanged':True},
             'validation':{'onlyRangeArchitecture':all(p['facilityId']==FACILITY for p in parts),
                           'allTrianglesNondegenerate':True,'measuredAndProfiledRoofFacesUpward':True,
                           'linearColoursCopiedExactly':True,'noImageMaterials':True},
             'hiddenOriginalRangeObjects':sorted(original_names),
             'reviewImage':scene.render.filepath}
    REPORT.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(serial({k:receipt[k] for k in ('refinedBlend','output','partCount','vertexCount','triangleCount','outputBytes')}))
    bpy.ops.render.render(write_still=True)


main()
