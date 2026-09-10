"""Read-only verification of the saved range variation and browser mesh export.

  & 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background `
    nvgkbuild/cache/facilities-reference/norrfallsviken-range-shelter-refined.blend `
    --python nvgkbuild/facilities/audit-range-refinement.py

Only the tracked audit JSON is written. Blender data, source files and runtime
assets are not changed. The live user Blender process is never accessed.
"""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
REPORT=ROOT/'nvgkbuild/facilities/range-refinement-validation.json'
AUDIT=ROOT/'nvgkbuild/facilities/range-refinement-audit.json'
ORIGIN=(678580.0,6988405.0,32.8)
FACILITY='lm-range-shelter'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def serial(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)


def snapshot(obj):
    return hashlib.sha256(serial({
        'matrix':[float(v) for row in obj.matrix_world for v in row],
        'vertices':[float(c) for v in obj.data.vertices for c in v.co] if obj.type=='MESH' else [],
        'faces':[list(p.vertices) for p in obj.data.polygons] if obj.type=='MESH' else [],
        'hidden':[obj.hide_render,obj.hide_viewport],
        'materials':[m.name for m in obj.data.materials] if obj.type=='MESH' else [],
    }).encode()).hexdigest()


def audit():
    assert bpy.app.background,'Use the independent saved-file process'
    report=load(REPORT)
    blend=ROOT/report['refinedBlend'];asset_path=ROOT/report['output']
    assert Path(bpy.data.filepath).resolve()==blend.resolve()
    checks={}
    def check(name,value):
        checks[name]=bool(value)
        assert value,name
    check('savedBlendHashMatches',sha(blend)==report['refinedBlendSha256'])
    check('baseBlendUnchanged',sha(ROOT/report['sourceBlend'])==report['sourceBlendSha256'])
    check('runtimeAssetHashMatches',sha(asset_path)==report['outputSha256'])
    asset=load(asset_path)
    check('sourceBlendRecordedInAsset',asset['sourceBlendSha256']==sha(blend))
    check('sameMetricOrigin',asset['originEpsg3006RH2000']==list(ORIGIN))
    scene=bpy.data.scenes['Norrfallsviken | Measured facilities']
    collection=bpy.data.collections['NV | 10 Refined range shelter']
    objects={o.name:o for o in collection.objects}
    check('allPartsMatchSavedCollection',set(objects)=={p['name'] for p in asset['parts']})
    check('onlyRangeArchitecture',all(p['facilityId']==FACILITY for p in asset['parts']))
    check('opensOnRangeCamera',bpy.context.scene==scene and scene.camera.name=='NV | Refined range review')
    check('originalRangeObjectsHidden',all(scene.objects[name].hide_render and scene.objects[name].hide_viewport
                                          for name in report['hiddenOriginalRangeObjects']))
    ignore=set(objects)|set(report['hiddenOriginalRangeObjects'])|{'NV | Refined range review'}
    unchanged={o.name:snapshot(o) for o in bpy.data.objects if o.name not in ignore}
    check('unrelatedSavedObjectsUnchanged',len(unchanged)==report['preservation']['unrelatedObjectsUnchanged'] and
          hashlib.sha256(serial(unchanged).encode()).hexdigest()==report['preservation']['unrelatedObjectsDigest'])
    # Packed source evidence stays in this local modelling document; it is
    # deliberately excluded from the runtime mesh package.
    laser=scene.objects['NV | Laser source returns - enable collection to inspect']
    check('originalSourceCloudRetained',len(laser.data.vertices)==190926)
    classification=[entry.value for entry in laser.data.attributes['classification'].data]
    check('sourceClassificationsRetained',classification.count(2)==120104 and classification.count(1)==70822)
    source_images=[image for image in bpy.data.images if image.source=='FILE']
    check('allSourceImagesRemainPacked',all(image.packed_file is not None for image in source_images))
    maximum_coordinate_error=0.0;minimum_area=float('inf');triangles=0;trees=[]
    for part in asset['parts']:
        obj=objects[part['name']];mesh=obj.data;mesh.calc_loop_triangles()
        check('meshOnly:'+part['name'],obj.type=='MESH' and not obj.modifiers)
        coordinates=[float(c) for v in mesh.vertices for c in obj.matrix_world@v.co]
        check('vertexCount:'+part['name'],len(coordinates)==len(part['positions']))
        maximum_coordinate_error=max(maximum_coordinate_error,max(abs(a-b) for a,b in zip(coordinates,part['positions'])))
        check('trianglesMatch:'+part['name'],[i for tri in mesh.loop_triangles for i in tri.vertices]==part['indices'])
        mat=mesh.materials[0];shader=mat.node_tree.nodes['Principled BSDF']
        check('exactLinearColour:'+part['name'],[float(v) for v in shader.inputs['Base Color'].default_value[:3]]==part['colour'])
        check('exactRoughness:'+part['name'],float(shader.inputs['Roughness'].default_value)==part['roughness'])
        check('noImages:'+part['name'],not any(n.type=='TEX_IMAGE' for n in mat.node_tree.nodes))
        vertices=[Vector(part['positions'][i:i+3]) for i in range(0,len(part['positions']),3)]
        indices=[part['indices'][i:i+3] for i in range(0,len(part['indices']),3)]
        for tri in indices:
            a,b,c=(vertices[i] for i in tri)
            normal=(b-a).cross(c-a);area=normal.length/2
            minimum_area=min(minimum_area,area)
            assert area>1e-8,'Degenerate saved export triangle: '+part['name']
            if part['role'] in ('measured-roof','roof-profile','slab'):
                assert normal.z>0,'Inverted upward triangle: '+part['name']
        triangles+=len(indices)
        trees.append((part['name'],part['role'],BVHTree.FromPolygons(vertices,indices,all_triangles=True)))
    check('quantisationWithinStoragePrecision',maximum_coordinate_error<=.0000051)
    check('allTrianglesNondegenerate',minimum_area>1e-8)
    check('expectedTriangleCount',triangles==report['triangleCount'])
    heights=load(ROOT/'nvgkbuild/mapping/facilities-height-reference.json')
    facility=next(f for f in heights['facilities'] if f['id']==FACILITY)
    measured=next(p for p in asset['parts'] if p['role']=='measured-roof')
    ring=facility['roofSupportRectangle'];ridge=facility['ridge']
    expected=[[p[0]-ORIGIN[0],p[1]-ORIGIN[1],h-ORIGIN[2]] for p,h in
              list(zip(ring['ringEpsg3006'],ring['eavePlaneHeightsRH2000']))+
              list(zip(ridge['endpointsEpsg3006'],ridge['heightsRH2000']))]
    measured_vertices=[measured['positions'][i:i+3] for i in range(0,len(measured['positions']),3)]
    roof_error=max(abs(a[k]-b[k]) for a,b in zip(measured_vertices,expected) for k in range(3))
    check('sixMeasuredRoofVerticesMatchLedger',len(measured_vertices)==6 and roof_error<.00002)
    plane_error=0.0
    for start in range(0,len(measured['indices']),3):
        face=[measured_vertices[i] for i in measured['indices'][start:start+3]]
        errors=[]
        for plane in facility['planes'][:2]:
            a,b,c=plane['coefficientsLocalEN'];e,n=facility['originEpsg3006']
            errors.append(max(abs(p[2]+ORIGIN[2]-(a*(p[0]+ORIGIN[0]-e)+b*(p[1]+ORIGIN[1]-n)+c)) for p in face))
        plane_error=max(plane_error,min(errors))
    check('allRoofTrianglesOnMeasuredPlanes',plane_error<.003)
    original=load(ROOT/'apps/golf/src/engine/scenery/norrfallsviken-facilities-meshes.json')
    layout=next(f for f in original['facilities'] if f['id']==FACILITY)
    check('retainsFloorAndFootprintContract',asset['facilities'][0]==layout)
    floor=layout['floorRH2000Estimate']
    ring=[Vector((p[0]-ORIGIN[0],p[1]-ORIGIN[1],floor-ORIGIN[2])) for p in layout['wallFootprintEpsg3006']]
    left,right=ring[1],ring[0]
    u=(right-left).normalized();inward=(ring[2]-ring[1]).normalized()
    width=(right-left).length;depth=(ring[2]-ring[1]).length
    def ray(fraction,height):
        origin=left+u*(fraction*width)-inward*2+Vector((0,0,height))
        hits=[]
        for name,role,tree in trees:
            location,normal,index,distance=tree.ray_cast(origin,inward,depth+3)
            if location is not None:hits.append({'object':name,'role':role,'distance':distance,
                                                'normalDotIncoming':normal.dot(inward)})
        return min(hits,key=lambda h:h['distance']) if hits else None
    probes={label:ray(fraction,height) for label,fraction,height in
            [('openBay',.50,1.40),('greyCover',.50,2.60),('door',.808,1.6),
             ('window',.923,1.6),('closedPanel',.12,1.5)]}
    check('bayIsAnOpeningNotAnOverlay',probes['openBay'] is not None and probes['openBay']['distance']>depth+1.5)
    check('greyCoverOnlyInUpperBay',probes['greyCover']['role']=='weather-cover' and probes['greyCover']['distance']<2.2)
    check('doorIsVisibleThroughActualWallOpening',probes['door']['role']=='door' and probes['door']['distance']<2.2)
    check('windowIsVisibleThroughActualWallOpening',probes['window']['role']=='glazing' and probes['window']['distance']<2.2)
    check('closedPanelHasOutwardFace',probes['closedPanel']['role']=='walls' and probes['closedPanel']['distance']<2.1 and probes['closedPanel']['normalDotIncoming']<-.99)
    check('doorAndWindowAreAtNorthwestEnd',u.x<0 and u.y>0)
    check('photographedFrontFacesNortheast',inward.x<0 and inward.y<0)
    result={'schemaVersion':1,'status':'passed','checkCount':len(checks),'checks':checks,
            'savedBlend':report['refinedBlend'],'savedBlendSha256':sha(blend),
            'runtimeAsset':report['output'],'runtimeAssetSha256':sha(asset_path),
            'generator':Path(__file__).relative_to(ROOT).as_posix(),'generatorSha256':sha(Path(__file__)),
            'partCount':len(asset['parts']),'triangleCount':triangles,'minimumTriangleAreaSquareMetres':minimum_area,
            'maximumExportVsSavedCoordinateErrorMetres':maximum_coordinate_error,
            'maximumRoofVsSourceLedgerErrorMetres':roof_error,'maximumRoofPlaneErrorMetres':plane_error,
            'facadeRayProbes':probes,'sourcePointCount':len(laser.data.vertices),
            'packedSourceImageCount':len(source_images),'liveUserBlenderAccessed':False,
            'blendAndAssetWritten':False}
    AUDIT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(serial({k:result[k] for k in ('status','checkCount','partCount','triangleCount','maximumRoofVsSourceLedgerErrorMetres')}))


audit()
