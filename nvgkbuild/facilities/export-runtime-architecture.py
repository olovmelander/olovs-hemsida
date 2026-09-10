"""Export only the approved Blender facility architecture to compact runtime JSON.

Run in an independent background Blender; this never calls the live MCP:
  & 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background `
    nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend `
    --python nvgkbuild/facilities/export-runtime-architecture.py

The saved .blend remains unchanged. Reference photos, ortho imagery, source
clouds, terrain, unresolved roof patches, cameras and lights are not exported.
Open architectural faces are oriented outward for front-side runtime materials.
"""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(r'C:\Users\olov_\repos\olovs-hemsida')
BLEND=ROOT/'nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend'
OUTPUT=ROOT/'apps/golf/src/engine/scenery/norrfallsviken-facilities-meshes.json'
RECEIPT=ROOT/'nvgkbuild/facilities/runtime-export-validation.json'
ORIGIN=(678580.0,6988405.0,32.8)
FACILITIES=('clubhouse-main-roof-native','clubhouse-cross-roof-native',
            'clubhouse-north-annex-roof','lm-range-shelter')
COLLECTIONS=('NV | 02 Measured roof planes','NV | 03 Interpreted walls and glazing')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def encode(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')

def role_and_facility(obj):
    name=obj.name.removeprefix('NV | ')
    facility=next((identifier for identifier in FACILITIES if identifier in name),None)
    if name.startswith(('Range front post ','Range closed end','Range slab - floor estimate')):
        facility='lm-range-shelter'
    assert facility is not None,f'Unrecognised architecture facility: {obj.name}'
    prefix_roles=(('Measured roof | ','measured-roof'),('Interpreted walls | ','walls'),
                  ('Corner trim | ','frame'),('Fascia | ','fascia'),('Ridge cap | ','ridge-cap'),
                  ('Gable | ','gable'),('Glazed front | ','glazing'),
                  ('Glazing mullion | ','frame'),('Glazing transom | ','frame'),
                  ('Glazing ridge mullion | ','frame'),('Range front post ','post'),
                  ('Range closed end','walls'),('Range slab - floor estimate','slab'))
    role=next((role for prefix,role in prefix_roles if name.startswith(prefix)),None)
    assert role is not None,f'Unrecognised architecture role: {obj.name}'
    return role,facility

def linear_material(material):
    assert material is not None,'Architecture material is missing'
    assert material.use_nodes,'Architecture material needs its exact linear shader colour'
    assert not any(n.type=='TEX_IMAGE' for n in material.node_tree.nodes),'Image materials are not runtime architecture'
    shader=material.node_tree.nodes.get('Principled BSDF')
    assert shader is not None,'Only authored Principled architecture colours are supported'
    colour=[float(c) for c in shader.inputs['Base Color'].default_value[:3]]
    assert all(0<=c<=1 for c in colour),'Nonfinite or out-of-range colour'
    return colour,float(shader.inputs['Roughness'].default_value)

def export():
    assert bpy.app.background,'Runtime export must run in an independent background Blender process'
    assert Path(bpy.data.filepath).resolve()==BLEND.resolve(),'Open the approved source blend before exporting'
    source_hash=sha(BLEND)
    build=load(ROOT/'nvgkbuild/facilities/blender-workspace-validation.json')
    assert source_hash==build['blendSha256'],'Approved saved Blender file changed; preserve it for review'
    scene=bpy.data.scenes['Norrfallsviken | Measured facilities']
    assert tuple(scene['origin_easting_northing_RH2000'])==ORIGIN
    height_path=ROOT/'nvgkbuild/mapping/facilities-height-reference.json'
    heights=load(height_path)
    features={f['id']:f for f in heights['facilities'] if f['id'] in FACILITIES}
    assert set(features)==set(FACILITIES)
    centres={identifier:Vector((sum(p[0] for p in f['roofSupportRectangle']['ringEpsg3006'])/4-ORIGIN[0],
                               sum(p[1] for p in f['roofSupportRectangle']['ringEpsg3006'])/4-ORIGIN[1],0))
             for identifier,f in features.items()}
    candidates={o.name:o for name in COLLECTIONS for o in bpy.data.collections[name].objects}
    parts=[];skipped=[];part_receipts=[]
    minimum_area=float('inf');flipped=0
    for name,obj in sorted(candidates.items()):
        assert obj.name in scene.objects,'Architecture collection references an object outside the source scene'
        if obj.hide_render or any(c.hide_render for c in obj.users_collection if c.name in COLLECTIONS):
            skipped.append({'object':name,'reason':'hidden architectural construction geometry'})
            continue
        if name.startswith('NV | Unresolved roof evidence | '):
            skipped.append({'object':name,'reason':'practice roof has no verified complete building body'})
            continue
        assert obj.type=='MESH',f'Unexpected architecture object: {name}'
        assert not obj.modifiers,f'Apply and review architecture modifiers before exporting: {name}'
        role,facility=role_and_facility(obj)
        mesh=obj.data
        mesh.calc_loop_triangles()
        source_vertices=[obj.matrix_world@v.co for v in mesh.vertices]
        # 0.01 mm storage quantisation is far below roof/source uncertainty and
        # retains trim alignment while keeping the static browser asset small.
        vertices=[Vector(tuple(round(float(c),5) for c in v)) for v in source_vertices]
        centre=sum(vertices,Vector())/len(vertices)
        groups={}
        for tri in mesh.loop_triangles:
            groups.setdefault(tri.material_index,[]).append(tuple(tri.vertices))
        object_flip_count=0;object_min_area=float('inf')
        for material_index,triangles in sorted(groups.items()):
            material=obj.material_slots[material_index].material
            colour,roughness=linear_material(material)
            output_triangles=[]
            for source_triangle in triangles:
                triangle=list(source_triangle)
                a,b,c=(vertices[i] for i in triangle)
                normal=(b-a).cross(c-a)
                area=normal.length/2
                assert area>1e-8,f'Degenerate runtime triangle in {name}'
                minimum_area=min(minimum_area,area);object_min_area=min(object_min_area,area)
                centroid=(a+b+c)/3
                if role in ('measured-roof','slab'):
                    orientation=normal.z
                elif role in ('walls','gable','glazing'):
                    radial=centroid-centres[facility]
                    orientation=normal.x*radial.x+normal.y*radial.y
                else:
                    # The trim/frame/post meshes are convex rectangular beams.
                    orientation=normal.dot(centroid-centre)
                assert abs(orientation)>1e-8,f'Ambiguous outward normal in {name}'
                if orientation<0:
                    triangle[1],triangle[2]=triangle[2],triangle[1]
                    flipped+=1;object_flip_count+=1
                output_triangles.append(triangle)
            used=sorted(set(i for triangle in output_triangles for i in triangle))
            remap={index:new for new,index in enumerate(used)}
            part={'name':name if len(groups)==1 else f'{name} | material {material_index}',
                  'facilityId':facility,'role':role,
                  'positions':[float(c) for i in used for c in vertices[i]],
                  'indices':[remap[i] for triangle in output_triangles for i in triangle],
                  'colour':colour,'roughness':roughness,
                  'materialName':material.name}
            # Vector coordinates are float32 in Blender; serialise explicitly
            # quantised Python floats, rather than incidental float32 noise.
            part['positions']=[round(c,5) for c in part['positions']]
            assert len(part['indices'])%3==0 and max(part['indices'])<len(part['positions'])//3
            parts.append(part)
        part_receipts.append({'object':name,'facilityId':facility,'role':role,
                              'sourceVertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),
                              'outwardWindingCorrections':object_flip_count,
                              'minimumTriangleAreaSquareMetres':object_min_area})
    assert {p['facilityId'] for p in parts}==set(FACILITIES)
    assert sum(p['role']=='measured-roof' for p in parts)==4
    assert all('practice' not in p['facilityId'] for p in parts)
    assert len(skipped)==5,'Expected three unresolved practice patches and two hidden cross-roof fascias'
    facilities=[]
    for identifier in FACILITIES:
        f=features[identifier];ring=f['roofSupportRectangle']['ringEpsg3006']
        body=scene.objects['NV | Interpreted walls | '+identifier]
        wall_points=[body.matrix_world@v.co for v in body.data.vertices]
        positions=[p['positions'] for p in parts if p['facilityId']==identifier]
        coords=[Vector(p[i:i+3]) for p in positions for i in range(0,len(p),3)]
        facilities.append({'id':identifier,
            'floorRH2000Estimate':float(body['floor_RH2000_estimate']),
            'roofSupportFootprintEpsg3006':ring,
            'wallFootprintEpsg3006':[[round(v.x+ORIGIN[0],4),round(v.y+ORIGIN[1],4)] for v in wall_points[:4]],
            'roofHeightRH2000':f['ridge']['heightsRH2000'],
            'eaveHeightsRH2000':f['roofSupportRectangle']['eavePlaneHeightsRH2000'],
            'boundsLocalEastNorthUp':[[round(min(v[k] for v in coords),5) for k in range(3)],
                                      [round(max(v[k] for v in coords),5) for k in range(3)]],
            'wallGeometryStatus':'photo-informed initial interpretation; floor and facade dimensions are estimates',
            'roofGeometryStatus':'2025 laser plane fit within sampled inner roof envelope'})
    result={'schemaVersion':1,'originEpsg3006RH2000':list(ORIGIN),
            'sourceBlendSha256':source_hash,
            'coordinateFrame':'local Blender east/north/up in metres; add origin componentwise for EPSG:3006/RH2000',
            'colourSpace':'linear RGB, copied exactly from authored Blender Principled material inputs',
            'positionPrecisionMetres':0.00001,
            'facilities':facilities,'parts':parts}
    encoded=encode(result)
    # Independently check the final serialised coordinates against the measured
    # source ledger. This catches axis/offset/unit mistakes and quantisation
    # regressions at the browser asset boundary, not just in the Blender mesh.
    decoded=json.loads(encoded)
    maximum_roof_error=0.0;maximum_plane_error=0.0
    for part in decoded['parts']:
        if part['role']!='measured-roof':continue
        f=features[part['facilityId']]
        actual=[part['positions'][i:i+3] for i in range(0,len(part['positions']),3)]
        r=f['roofSupportRectangle'];ridge=f['ridge']
        expected=[[p[0]-ORIGIN[0],p[1]-ORIGIN[1],h-ORIGIN[2]]
                  for p,h in list(zip(r['ringEpsg3006'],r['eavePlaneHeightsRH2000']))+
                             list(zip(ridge['endpointsEpsg3006'],ridge['heightsRH2000']))]
        assert len(actual)==len(expected)==6
        maximum_roof_error=max(maximum_roof_error,max(abs(a[k]-e[k]) for a,e in zip(actual,expected) for k in range(3)))
        for offset in range(0,len(part['indices']),3):
            face=[actual[i] for i in part['indices'][offset:offset+3]]
            best=float('inf')
            for plane in f['planes'][:2]:
                a,b,c=plane['coefficientsLocalEN'];e,n=f['originEpsg3006']
                error=max(abs(p[2]+ORIGIN[2]-(a*(p[0]+ORIGIN[0]-e)+b*(p[1]+ORIGIN[1]-n)+c)) for p in face)
                best=min(best,error)
            maximum_plane_error=max(maximum_plane_error,best)
    assert maximum_roof_error<.00002,'Runtime roof vertices differ from measured source ledger'
    assert maximum_plane_error<.003,'Runtime roof faces do not follow measured laser planes'
    assert sha(BLEND)==source_hash,'Source blend changed during export'
    OUTPUT.write_bytes(encoded+b'\n')
    receipt={'schemaVersion':1,'sourceBlend':BLEND.relative_to(ROOT).as_posix(),'sourceBlendSha256':source_hash,
             'sourceScene':scene.name,'sourceHeightReferenceSha256':sha(height_path),
             'generator':{'path':Path(__file__).resolve().relative_to(ROOT).as_posix(),
                          'sha256':sha(Path(__file__)),'blenderVersion':bpy.app.version_string},
             'output':OUTPUT.relative_to(ROOT).as_posix(),'outputSha256':sha(OUTPUT),'outputBytes':OUTPUT.stat().st_size,
             'facilityCount':len(facilities),'partCount':len(parts),
             'vertexCount':sum(len(p['positions'])//3 for p in parts),
             'triangleCount':sum(len(p['indices'])//3 for p in parts),
             'minimumTriangleAreaSquareMetres':minimum_area,'outwardWindingCorrections':flipped,
             'maximumMeasuredRoofVertexErrorMetres':maximum_roof_error,
             'maximumMeasuredRoofTrianglePlaneErrorMetres':maximum_plane_error,
             'excludedObjects':skipped,'parts':part_receipts,
             'validation':{'sourceBlendUnchanged':sha(BLEND)==source_hash,
                           'onlyFourApprovedFacilities':True,'noTexturesOrReferenceData':True,
                           'linearMaterialColoursCopiedWithoutConversion':True,
                           'allTrianglesNondegenerate':True,'openFacadesOrientedAwayFromFacilityCentre':True,
                           'roofAndSlabWindingUp':True,'closedBeamWindingOutward':True},
             'limitations':['Wall, glazing, foundation and trim dimensions are initial photographic interpretations.',
                            'Measured clubhouse main and cross roofs remain intersecting assemblies; not a Boolean-unioned shell.',
                            'The practice building stays on the existing runtime fallback because its complete roof/body is unresolved.',
                            'No copyright-protected reference photos or raw laser returns are included in the runtime asset.']}
    RECEIPT.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:receipt[k] for k in ('output','outputBytes','outputSha256','partCount','vertexCount','triangleCount','outwardWindingCorrections')}))

export()
