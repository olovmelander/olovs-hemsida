"""Package the owned architectural scene and publish its texture-free GLB.

Run in background Blender with the authored library opened. Source photos and
reference terrain are excluded from export. The GLB uses absolute RH2000 heights.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import shutil
import sys

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'lidingobuild/cache/facilities-model-2026-09-10'
PUBLIC=ROOT/'apps/golf/public/models/lidingo'
SCENE='Lidingö | Authored facilities 2026-09-10 | r2'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def camera(scene,name,position,target,scale):
    data=bpy.data.cameras.new(name)
    data.type='ORTHO'
    data.ortho_scale=scale
    data.sensor_fit='HORIZONTAL'
    data.clip_end=5000
    obj=bpy.data.objects.new(name,data)
    scene.collection.objects.link(obj)
    obj.location=position
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj


def terrain_preview(facilities):
    """Cover the complete authored extent with published 1 m terrain sampled at 4 m."""
    tiles=json.loads((OUT/'terrain-1m.json').read_text(encoding='utf-8'))['tiles']
    def height(x,y):
        e,n=x+677700.5,y+6586399.5
        tile=next((t for t in tiles if t['bounds']['minEasting']<=e<=t['bounds']['maxEasting'] and t['bounds']['minNorthing']<=n<=t['bounds']['maxNorthing']),None)
        if tile is None: return None
        b,g,h=tile['bounds'],tile['grid'],tile['heights']
        u,v=e-b['minEasting'],b['maxNorthing']-n
        i,j=min(g['width']-2,math.floor(u)),min(g['height']-2,math.floor(v))
        a,c=u-i,v-j
        k=j*g['width']+i
        return (h[k]*(1-a)+h[k+1]*a)*(1-c)+(h[k+g['width']]*(1-a)+h[k+g['width']+1]*a)*c-25
    rings=[p for f in facilities for p in f['footprintLocal']]
    xs=range(math.floor((min(p[0] for p in rings)-40)/4)*4,math.ceil((max(p[0] for p in rings)+40)/4)*4+1,4)
    ys=range(math.floor((min(-p[1] for p in rings)-40)/4)*4,math.ceil((max(-p[1] for p in rings)+40)/4)*4+1,4)
    vertices,faces,indices=[],[],{}
    for j,y in enumerate(ys):
        for i,x in enumerate(xs):
            z=height(x,y)
            if z is not None:
                indices[i,j]=len(vertices)
                vertices.append((x,y,z))
    for j in range(len(ys)-1):
        for i in range(len(xs)-1):
            cells=[(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
            if all(c in indices for c in cells):
                a,b,c,d=[indices[p] for p in cells]
                faces.extend(((a,b,c),(a,c,d)))
    return vertices,faces


def main():
    assert bpy.app.background
    report=json.loads((OUT/'authoring-report.json').read_text(encoding='utf-8'))
    library=ROOT/report['libraryPath']
    assert Path(bpy.data.filepath).resolve()==library.resolve()
    assert sha(library)==report['librarySha256']
    PUBLIC.mkdir(parents=True,exist_ok=True)
    manifest_path=PUBLIC/'facilities-v1.json'
    previous_manifest_sha=sha(manifest_path) if manifest_path.exists() else None
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if previous_manifest_sha:
        assert args==['--replace-manifest-sha256',previous_manifest_sha], 'Existing manifest requires its exact reviewed SHA-256'
        backup=OUT/f'facilities-manifest-{previous_manifest_sha}.json'
        if not backup.exists():
            shutil.copy2(manifest_path,backup)
    source=bpy.data.scenes[SCENE]
    source.view_layers[0].update()
    export=bpy.data.scenes.new('Lidingö | Runtime export')
    export.unit_settings.system='METRIC'
    exported=[]
    triangle_total=0
    for facility in report['facilities']:
        parent=source.objects[facility['nodeName']]
        groups={}
        part_names=[]
        for obj in parent.children_recursive:
            if obj.type!='MESH':
                continue
            part_names.append(obj.get('authoredPart',obj.name))
            data=obj.data
            data.calc_loop_triangles()
            for triangle in data.loop_triangles:
                mat=data.materials[triangle.material_index]
                group=groups.setdefault(mat.name,{'material':mat,'vertices':[],'indices':[]})
                start=len(group['vertices'])
                for index in triangle.vertices:
                    p=obj.matrix_world@data.vertices[index].co
                    assert all(math.isfinite(v) for v in p)
                    group['vertices'].append((p.x,p.y,p.z+25))
                group['indices'].append((start,start+1,start+2))
        assert groups,facility['id']
        root=bpy.data.objects.new(facility['nodeName']+'_asset',None)
        root['facilityId']=facility['id']
        root['sourceBuildingIds']=facility['sourceBuildingIds']
        root['evidence']=json.dumps(facility['evidence'],ensure_ascii=False)
        root['heightDatum']='RH2000'
        export.collection.objects.link(root)
        points=[]
        triangles=0
        for name,group in groups.items():
            mesh=bpy.data.meshes.new(root.name+' '+name)
            mesh.from_pydata(group['vertices'],[],group['indices'])
            mesh.materials.append(group['material'])
            mesh.update()
            obj=bpy.data.objects.new(root.name+' '+name,mesh)
            export.collection.objects.link(obj)
            obj.parent=root
            triangles+=len(group['indices'])
            points.extend((x,z,-y) for x,y,z in group['vertices'])
        triangle_total+=triangles
        bounds={'min':[min(p[k] for p in points) for k in range(3)],'max':[max(p[k] for p in points) for k in range(3)]}
        exported.append({**facility,'nodeName':root.name,'boundsLocalRh2000':bounds,
                         'triangles':triangles,'meshCount':len(groups),'authoredParts':sorted(set(part_names))})
    assert triangle_total<200000, f'Triangle budget exceeded: {triangle_total}'
    assert len({s for f in exported for s in f['sourceBuildingIds']})==sum(len(f['sourceBuildingIds']) for f in exported)
    bpy.context.window.scene=export
    glb=OUT/'facilities-export.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_active_scene=True,
                             export_yup=True,export_extras=True,export_materials='EXPORT',
                             export_cameras=False,export_lights=False,export_animations=False,
                             export_normals=True,export_apply=True)
    raw=glb.read_bytes()
    length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length])
    assert not doc.get('images') and not doc.get('textures') and not doc.get('cameras')
    assert not doc.get('animations') and not any(b.get('uri') for b in doc.get('buffers',[]))
    asset_hash=sha(glb)
    asset_path=PUBLIC/f'facilities-{asset_hash}.glb'
    if not asset_path.exists():
        shutil.copy2(glb,asset_path)
    assert sha(asset_path)==asset_hash
    manifest={
      'schemaVersion':1,'groundId':'lidingo','courseSlugs':['lidingo'],
      'coordinateFrame':{'kind':'epsg3006-local-rh2000','originEasting':677700.5,'originNorthing':6586399.5,
                         'axes':'east-up-south','heightDatum':'RH2000'},
      'asset':{'url':f'models/lidingo/facilities-{asset_hash}.glb','sha256':asset_hash,'bytes':len(raw)},
      'replacesRangeFacilities':True,'replacesCourtyard':True,'facilities':exported,
      'authoring':{'blenderVersion':bpy.app.version_string,'triangles':triangle_total,
                   'sourceImageryIncluded':False,'heightNote':'Absolute RH2000 in GLB; Blender modelling height origin25 baked exactly once.'}}

    # Authoring file and reference renders use the modelling coordinates.
    bpy.context.window.scene=source
    for role,pos,target,scale in [
      ('clubhouse',(88,-24,96),(-45,91,6),143),
      ('courtyard',(-5,63,24),(-40,105,8),72),
      ('range',(116,-255,98),(-70,-105,4),300),
      ('south-range',(-48,-400,49),(-119,-244,2),115),
      ('cafe-9',(-292,-77,28),(-309,-55,2),32),
      ('toilet-15',(-65,222,19),(-83,244,0),23)]:
        camera(source,'Lidingö '+role,pos,target,scale)
    source.world=bpy.data.worlds.new('Lidingö architecture sky')
    source.world.use_nodes=True
    source.world.node_tree.nodes['Background'].inputs[0].default_value=(.26,.32,.40,1)
    source.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    light=bpy.data.lights.new('Lidingö daylight','SUN')
    light.energy=3
    light.angle=.15
    obj=bpy.data.objects.new('Lidingö daylight',light)
    obj.rotation_euler=(.45,-.5,-.6)
    source.collection.objects.link(obj)
    data=bpy.data.meshes.new('Source terrain preview - never exported')
    preview_vertices,preview_faces=terrain_preview(exported)
    data.from_pydata(preview_vertices,[],preview_faces)
    mat=bpy.data.materials.new('Neutral terrain preview')
    mat.diffuse_color=(.18,.25,.12,1)
    data.materials.append(mat)
    obj=bpy.data.objects.new('Source terrain preview - never exported',data)
    source.collection.objects.link(obj)
    source.render.engine='BLENDER_EEVEE_NEXT'
    source.render.resolution_x=1600
    source.render.resolution_y=1100
    source.render.resolution_percentage=100
    source.render.image_settings.file_format='PNG'
    source.view_settings.view_transform='AgX'
    renders=[]
    for role in ('clubhouse','courtyard','range','south-range','cafe-9','toilet-15'):
        source.camera=source.objects['Lidingö '+role]
        source.render.filepath=str(OUT/f'{role}-render.png')
        bpy.ops.render.render(write_still=True,scene=source.name)
        renders.append((OUT/f'{role}-render.png').relative_to(ROOT).as_posix())
    source.camera=source.objects['Lidingö clubhouse']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.type='MATERIAL'
    blend=OUT/'lidingo-facilities-authored-r2.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True)
    assert (sha(manifest_path) if manifest_path.exists() else None)==previous_manifest_sha, 'Manifest changed during export'
    staged_manifest=PUBLIC/'facilities-v1.json.tmp'
    staged_manifest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    staged_manifest.replace(manifest_path)
    final={'status':'passed','blendPath':blend.relative_to(ROOT).as_posix(),'blendSha256':sha(blend),
           'asset':manifest['asset'],'facilityCount':len(exported),'triangles':triangle_total,
           'meshCount':sum(f['meshCount'] for f in exported),'sourceBuildingIds':sorted(s for f in exported for s in f['sourceBuildingIds']),
           'sourceImagesExported':False,'renders':renders,'modules':report['modules']}
    (ROOT/'lidingobuild/facilities/production-validation.json').write_text(json.dumps(final,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in final.items() if k!='modules'},ensure_ascii=False))


main()
