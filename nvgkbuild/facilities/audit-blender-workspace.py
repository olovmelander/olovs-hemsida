"""Read-only audit of the live or separately opened saved Blender workspace.

Via MCP, execute this file with no arguments. For the saved file, run Blender
in a separate background process with --python this-file -- --saved.
No Blender data, context, selection, scenes or source files are modified.
Only the aggregate audit report is written outside Blender's data model.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector, kdtree

ROOT = Path(r'C:\Users\olov_\repos\olovs-hemsida')
SCENE_NAME = 'Norrfallsviken | Measured facilities'
ORIGIN = np.array([678580.0, 6988405.0, 32.8])
MODE = 'saved' if '--saved' in sys.argv else 'live'
OUT = ROOT / 'nvgkbuild/facilities'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

checks=[]
def check(condition,label,detail=None):
    checks.append({'check':label,'passed':bool(condition),**({'detail':detail} if detail is not None else {})})

def snapshot():
    return {'activeScene':bpy.context.scene.name,'currentFile':bpy.data.filepath,
            'selectedObjects':sorted(o.name for o in bpy.context.selected_objects),
            'scenes':{s.name: {'objects': sorted(o.name for o in s.objects),
                              'objectMatrices': {o.name: [float(v) for row in o.matrix_world for v in row] for o in s.objects},
                              'camera':s.camera.name if s.camera else None} for s in bpy.data.scenes},
            'dataCounts': {'scenes':len(bpy.data.scenes),'objects':len(bpy.data.objects),'meshes':len(bpy.data.meshes),
                           'images':len(bpy.data.images),'materials':len(bpy.data.materials)}}

def world_vertices(obj):
    values=np.empty(len(obj.data.vertices)*3,dtype=np.float32)
    obj.data.vertices.foreach_get('co',values)
    values=values.reshape(-1,3).astype(float)
    matrix=np.array(obj.matrix_world,dtype=float)
    return values@matrix[:3,:3].T+matrix[:3,3]

def unordered_faces(obj):
    return sorted(tuple(sorted(p.vertices)) for p in obj.data.polygons)

before=snapshot()
scene=bpy.data.scenes[SCENE_NAME]
builder_path=OUT/'blender-workspace-validation.json'
builder=read(builder_path)
height_path=ROOT/'nvgkbuild/mapping/facilities-height-reference.json'
heights=read(height_path)
data_path=ROOT/'nvgkbuild/cache/facilities-reference/blender-source-data.json'
data=read(data_path)
raw_path=ROOT/heights['source']['localPointsPath']
raw=read(raw_path)
raw_points=np.array(raw['points'],dtype=float)
blend_path=ROOT/builder['blendPath']
check(sha(blend_path)==builder['blendSha256'],'saved blend hash matches builder output')
check(sha(raw_path)==heights['source']['localPointsSha256'],'raw laser hash matches pinned extract')
check(sha(data_path)==read(data_path.with_suffix('.meta.json'))['sha256'],'prepared source JSON hash matches sidecar')
check(list(scene['origin_easting_northing_RH2000'])==ORIGIN.tolist(),'scene uses documented metric origin')
check(scene.unit_settings.system=='METRIC' and scene.unit_settings.scale_length==1,'scene units are metres')
check(len(scene.objects)==builder['sceneObjects'],'scene object count matches saved build')
for source in builder['sourceFiles']:
    check(sha(ROOT/source['path'])==source['sha256'],'builder source hash: '+source['path'])

roof_results=[]
geometry_fingerprints={}
for feature in heights['facilities']:
    identifier=feature['id']
    if 'roofSupportRectangle' not in feature:
        check(scene.objects.get('NV | Measured roof | '+identifier) is None,'unresolved practice roof has no fabricated gable')
        for plane in feature['planes']:
            obj=scene.objects['NV | Unresolved roof evidence | '+plane['id']]
            actual=world_vertices(obj)+ORIGIN
            a,b,c=plane['coefficientsLocalEN'];e,n=feature['originEpsg3006']
            residual=actual[:,2]-(a*(actual[:,0]-e)+b*(actual[:,1]-n)+c)
            check(abs(residual).max()<.001,'unresolved roof patch follows measured plane: '+plane['id'],float(abs(residual).max()))
        continue
    obj=scene.objects['NV | Measured roof | '+identifier]
    actual=world_vertices(obj)+ORIGIN
    rect=feature['roofSupportRectangle'];ridge=feature['ridge']
    expected=np.array([[*p,h] for p,h in zip(rect['ringEpsg3006'],rect['eavePlaneHeightsRH2000'])]+
                      [[*p,h] for p,h in zip(ridge['endpointsEpsg3006'],ridge['heightsRH2000'])])
    error=float(abs(actual-expected).max())
    check(actual.shape==(6,3) and error<.0001,'actual transformed roof coordinates: '+identifier,error)
    check(len(obj.data.polygons)==2,'two measured roof faces: '+identifier)
    check(obj.get('source_feature_id')==identifier,'roof identity property: '+identifier)
    check(all(c.name=='NV | 02 Measured roof planes' for c in obj.users_collection),'measured roofs isolated from interpreted walls: '+identifier)
    residuals=[];normals=[]
    for face in obj.data.polygons:
        p=actual[list(face.vertices)]
        face_residual=[]
        for plane in feature['planes'][:2]:
            a,b,c=plane['coefficientsLocalEN'];e,n=feature['originEpsg3006']
            face_residual.append(float(abs(p[:,2]-(a*(p[:,0]-e)+b*(p[:,1]-n)+c)).max()))
        residuals.append(min(face_residual))
        normals.append(float(np.cross(p[1]-p[0],p[2]-p[0])[2]))
    check(max(residuals)<.003,'faces follow fitted roof equations: '+identifier,residuals)
    check(min(normals)>0,'measured roof faces wind upward: '+identifier,normals)
    check(min(actual[4:,2])>max(actual[:4,2])+2,'ridge is above both eaves: '+identifier)
    length=float(np.linalg.norm(actual[1,:2]-actual[0,:2]));width=float(np.linalg.norm(actual[2,:2]-actual[1,:2]))
    check(abs(length-rect['lengthMetres'])<.015 and abs(width-rect['widthMetres'])<.015,'roof support dimensions preserved: '+identifier)
    geometry_fingerprints[obj.name]=digest({'vertices':np.round(actual-ORIGIN,5).tolist(),'faces':unordered_faces(obj)})
    roof_results.append({'id':identifier,'maximumVertexCoordinateErrorMetres':error,
                         'maximumFacePlaneResidualMetres':max(residuals),'lengthMetres':round(length,5),
                         'widthMetres':round(width,5),'ridgeHeightsRH2000':actual[4:,2].round(6).tolist(),
                         'eaveHeightsRH2000':actual[:4,2].round(6).tolist(),'allFacesUp':min(normals)>0})

cloud=scene.objects['NV | Laser source returns - enable collection to inspect']
actual_points=world_vertices(cloud)
expected_points=raw_points[:,:3]-ORIGIN
point_error=float(abs(actual_points-expected_points).max())
check(len(actual_points)==190926,'all 190926 raw source returns retained')
check(point_error<.0001,'every transformed point matches original laser coordinate',point_error)
attr=cloud.data.attributes.get('classification')
check(attr is not None and attr.domain=='POINT' and attr.data_type=='INT','point cloud classification attribute exists')
classes=np.empty(len(attr.data),dtype=np.int32);attr.data.foreach_get('value',classes)
check(np.array_equal(classes,raw_points[:,3].astype(int)),'every point retains original classification')
check(len(cloud.data.polygons)==0,'source point cloud has no invented surface faces')
geometry_fingerprints[cloud.name]=digest({'vertices':np.round(actual_points,4).tolist(),'classification':classes.tolist()})

terrain=data['terrain'];expected_terrain=np.array(terrain['vertices'])
ground_objects=[scene.objects['NV | Campus ground - 2m median laser sampling'],
                scene.objects['NV | Ground outside orthophoto coverage - untextured']]
all_actual_faces=[];max_ground_error=0.0;all_ground_up=True;ground_winding=[]
for obj in ground_objects:
    actual=world_vertices(obj)
    error=float(abs(actual-expected_terrain).max());max_ground_error=max(max_ground_error,error)
    check(error<.0001,'ground mesh vertex coordinates: '+obj.name,error)
    down=0
    for face in obj.data.polygons:
        p=actual[list(face.vertices)]
        up=bool(np.cross(p[1]-p[0],p[2]-p[0])[2]>0)
        all_ground_up &= up
        if not up:down+=1
    ground_winding.append({'object':obj.name,'faces':len(obj.data.polygons),'downwardFaces':down})
    all_actual_faces.extend(unordered_faces(obj))
    geometry_fingerprints[obj.name]=digest({'vertices':np.round(actual,4).tolist(),'faces':unordered_faces(obj)})
check(sorted(all_actual_faces)==sorted(tuple(sorted(f)) for f in terrain['triangles']),'ground topology retains all holes and creates no extra triangles')
check(len(all_actual_faces)==22082,'ground triangle count is 22082')
check(all_ground_up,'all reference ground triangles wind upward',ground_winding)
grid=terrain['grid'];indices=np.array(terrain['gridIndex'],dtype=int)
check(not set(indices).intersection(grid['omittedGridIndices']),'unsupported grid vertices remain absent')

# Independently reconstruct the median sampling from raw classified points,
# using Blender's own KD tree rather than the SciPy preparation implementation.
source_ground=raw_points[raw_points[:,3]==2,:3]-ORIGIN
tree=kdtree.KDTree(len(source_ground))
for i,p in enumerate(source_ground):tree.insert((float(p[0]),float(p[1]),0.0),i)
tree.balance()
independent_heights=[];distances=[];beyond=[];support_mismatches=0
for i,vertex in enumerate(expected_terrain):
    query=(float(vertex[0]),float(vertex[1]),0.0)
    _,nearest,dist=tree.find(query);distances.append(dist)
    if dist>5.0:beyond.append(i)
    nearby=tree.find_range(query,2.5)
    if len(nearby)>=3:chosen=[v[1] for v in nearby]
    else:
        nearby=tree.find_range(query,3.0)
        chosen=[v[1] for v in nearby] if nearby else [nearest]
    independent_heights.append(float(np.median(source_ground[chosen,2])))
    if len(chosen)!=terrain['groundSupportCount'][i]:support_mismatches+=1
height_error=float(abs(expected_terrain[:,2]-np.array(independent_heights)).max())
check(not beyond,'every retained ground vertex is within 5 m of measured ground',{'maxMetres':max(distances)})
check(height_error<.02,'independent raw-ground median reconstruction',{'maximumHeightErrorMetres':height_error,'supportCountMismatches':support_mismatches})
for index in grid['omittedGridIndices']:
    e=grid['boundsEpsg3006'][0]+(index%grid['columns'])*grid['spacingMetres']-ORIGIN[0]
    n=grid['boundsEpsg3006'][1]+(index//grid['columns'])*grid['spacingMetres']-ORIGIN[1]
    _,_,distance=tree.find((e,n,0.0))
    check(distance>5,'omitted ground vertex lacks support: '+str(index),distance)

uv=ground_objects[0].data.uv_layers.get('Source geographic UV')
max_uv_error=0.0
check(uv is not None,'ground geographic UV layer exists')
for loop in ground_objects[0].data.loops:
    max_uv_error=max(max_uv_error,max(abs(float(uv.data[loop.index].uv[k])-terrain['uv'][loop.vertex_index][k]) for k in range(2)))
check(max_uv_error<1e-6,'actual terrain UV matches geographic source mapping',max_uv_error)

images={}
for obj in scene.objects:
    for slot in obj.material_slots:
        mat=slot.material
        if mat and mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:
                    im=node.image
                    images[im.name]=im
image_results=[]
for name,im in images.items():
    packed=im.packed_file
    check(packed is not None,'reference image is packed: '+name)
    packed_hash=hashlib.sha256(bytes(packed.data)).hexdigest() if packed else None
    path=Path(bpy.path.abspath(im.filepath))
    # A saved library uses paths relative to itself. The packed bytes remain
    # authoritative even if a source path is unavailable on another machine.
    source_hash=sha(path) if path.is_file() else None
    if source_hash:check(packed_hash==source_hash,'packed image matches source file: '+name)
    image_results.append({'name':name,'packed':bool(packed),'packedBytes':packed.size if packed else 0,
                          'packedSha256':packed_hash,'sourceFileAvailable':bool(source_hash),'sourceFileSha256':source_hash})
expected_images=builder['sourceImagePlanes']+builder['photoBoards']+1
check(len(images)==expected_images,'all source planes, photo boards and terrain image are referenced and packed',{'actual':len(images),'expected':expected_images})
catalogues=[]
for suffix in ('ortho','height','web'):
    text=bpy.data.texts.get('NV | '+suffix+' source catalogue.json')
    path=ROOT/f'nvgkbuild/mapping/facilities-{suffix}-reference.json'
    check(text is not None,'source catalogue embedded: '+suffix)
    if text:
        check(json.loads(text.as_string())==read(path),'embedded source catalogue matches recorded file: '+suffix)
        catalogues.append({'kind':suffix,'textName':text.name,'sourceSha256':sha(path)})
web=read(ROOT/'nvgkbuild/mapping/facilities-web-reference.json')
boards_by_id={json.loads(o['reference_metadata'])['id']:o for o in scene.objects if o.get('reference_metadata')}
for ref in web['references']:
    # Blender truncates long object names. Stable source IDs are retained in
    # board metadata and are the correct identity for this check.
    board=boards_by_id.get(ref['id'])
    check(board is not None,'curated source board exists: '+ref['id'])
    if board:
        check(json.loads(board['reference_metadata'])==ref,'photo board retains exact source URL/date confidence: '+ref['id'])
        check(board.get('reference_only') and board.get('not_a_runtime_texture'),'photo stays labelled as local reference: '+ref['id'])

other_scenes=[]
for s in bpy.data.scenes:
    if s.name==SCENE_NAME:continue
    leaked=[o.name for o in s.objects if o.name.startswith('NV | ')]
    check(not leaked,'Norrfallsviken objects do not leak into other scene: '+s.name,leaked)
    other_scenes.append({'name':s.name,'objectCount':len(s.objects),
                         'membershipSha256':digest(sorted(o.name for o in s.objects))})
check(before==snapshot(),'audit leaves scenes, object matrices, active scene, current file and selection unchanged')
if MODE=='live':
    # Other authorised course work may change the active scene after our build.
    # Preserve the actual audit-entry state, rather than restoring stale state.
    check(bpy.data.scenes.get(builder['activeScenePreserved']) is not None,'pre-build scene remains available')
    check(bpy.context.scene.name==before['activeScene'] and bpy.data.filepath==before['currentFile'],
          'live active scene and file remain exactly as found at audit entry')
else:
    check(Path(bpy.data.filepath).resolve()==blend_path.resolve(),'audit is reading the actual saved blend')
    if builder.get('packaging',{}).get('format')=='normal-blend-document':
        check(bpy.context.scene==scene,'normal blend opens directly on the measured facilities scene')
        check(scene.camera is not None and scene.camera.name==builder['packaging']['defaultCamera'],
              'normal blend opens with the intended clubhouse review camera')
    live_path=OUT/'blender-workspace-independent-audit-live.json'
    if live_path.exists():
        live=read(live_path)
        check(live['geometryFingerprints']==geometry_fingerprints,'saved geometry matches independently audited live geometry')
        check(sorted((i['name'],i['packedSha256']) for i in live['images'])==
              sorted((i['name'],i['packedSha256']) for i in image_results),'saved packed images match live packed images')

report={'schemaVersion':1,'mode':MODE,'scene':SCENE_NAME,'blenderVersion':bpy.app.version_string,
        'blenderBinary':bpy.app.binary_path,'blendFile':builder['blendPath'],'blendSha256':sha(blend_path),
        'auditScriptSha256':sha(OUT/'audit-blender-workspace.py'),
        'sourceHashes':{'heightReference':sha(height_path),'preparedSourceData':sha(data_path),'rawLaserExtract':sha(raw_path)},
        'roofResults':roof_results,'sourcePointCount':len(actual_points),'pointCoordinateErrorMetres':point_error,
        'classificationCounts':{str(int(v)):int((classes==v).sum()) for v in np.unique(classes)},
        'ground':{'verticesPerMesh':len(expected_terrain),'trianglesAcrossCoverageMeshes':len(all_actual_faces),
                  'meshCoordinateErrorMetres':max_ground_error,'independentMedianMaximumErrorMetres':height_error,
                  'independentSupportCountMismatches':support_mismatches,'maximumNearestGroundDistanceMetres':max(distances),
                  'omittedGridVertices':len(grid['omittedGridIndices']),'geographicUvMaximumError':max_uv_error,
                  'meshWinding':ground_winding},
        'images':image_results,'embeddedSourceCatalogues':catalogues,'otherScenes':other_scenes,'activeScene':bpy.context.scene.name,
        'historicalPreservationEvidence':{'builderReportedOtherScenesPreserved':builder['otherScenesPreserved'],
            'activeSceneAtBuild':builder['activeScenePreserved'],'activeSceneAtAuditEntry':before['activeScene'],
            'activeSceneChangedSinceBuild':builder['activeScenePreserved']!=before['activeScene'],
            'limitation':'No pre-build object snapshot was persisted. This audit directly verifies present isolation and no changes during audit; historical membership preservation is the builder assertion, not independently reconstructed.'},
        'interpretationReview':['Measured roof meshes are inner sampled envelopes; wall inset and floors remain explicitly interpreted.',
            'Cross-wing roof and main roof remain separate intersecting measured surfaces, not a Boolean-unioned final architectural shell.',
            'Practice roof has measured planar patches only; no unsupported complete gable is introduced.',
            'The 2 m reference terrain is context geometry and must not replace the application 1 m ground.'],
        'geometryFingerprints':geometry_fingerprints,'checks':checks,
        'passed':all(c['passed'] for c in checks)}
target=OUT/f'blender-workspace-independent-audit-{MODE}.json'
target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'mode':MODE,'passed':report['passed'],'checks':len(checks),
                  'failures':[c for c in checks if not c['passed']],
                  'auditFile':target.relative_to(ROOT).as_posix(),'blenderBinary':bpy.app.binary_path,
                  'pointCount':len(actual_points),'groundMedianError':height_error},ensure_ascii=False))
