"""Embed the completed source catalogue and curated photo boards in our scene."""
import hashlib
import json
import shutil
from pathlib import Path

import bpy

ROOT=Path(r'C:\Users\olov_\repos\olovs-hemsida')
OUT=ROOT/'nvgkbuild/cache/facilities-reference'
scene=bpy.data.scenes['Norrfallsviken | Measured facilities']
report_path=ROOT/'nvgkbuild/facilities/blender-workspace-validation.json'
report=json.loads(report_path.read_text())
blend=ROOT/report['blendPath']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(blend)==report['blendSha256'], 'Saved workspace changed since build; retain user work'
if bpy.data.collections.get('NV | 09 Curated photo references'):
    raise RuntimeError('Completed boards already exist; retain this scene')
active_before=bpy.context.scene.name
file_before=bpy.data.filepath
others={s.name:tuple(sorted(o.name for o in s.objects)) for s in bpy.data.scenes if s!=scene}
collection=bpy.data.collections.new('NV | 09 Curated photo references')
scene.collection.children.link(collection)
old=bpy.data.collections['NV | 07 Photographic reference boards']
old.hide_viewport=True
old.hide_render=True
web_path=ROOT/'nvgkbuild/mapping/facilities-web-reference.json'
web=json.loads(web_path.read_text(encoding='utf-8'))
texts={bpy.data.texts['NV | START HERE']}
for suffix in ('ortho','height','web'):
    path=ROOT/f'nvgkbuild/mapping/facilities-{suffix}-reference.json'
    text=bpy.data.texts.new('NV | '+suffix+' source catalogue.json')
    text.write(path.read_text(encoding='utf-8'))
    text.use_fake_user=True
    texts.add(text)
for i,ref in enumerate(web['references']):
    path=ROOT/ref['localPath']
    assert sha(path)==ref['sha256'],ref['id']
    im=bpy.data.images.load(str(path),check_existing=True)
    im.pack()
    width=65
    height=width*im.size[1]/im.size[0]
    x=200+(i%3)*75
    y=40-(i//3)*70
    d=bpy.data.meshes.new('NV | Reference '+ref['id'])
    d.from_pydata([(x,y,0),(x+width,y,0),(x+width,y-height,0),(x,y-height,0)],[],[(3,2,1,0)])
    uv=d.uv_layers.new()
    coords=[(0,1),(1,1),(1,0),(0,0)]
    for loop in d.loops:uv.data[loop.index].uv=coords[loop.vertex_index]
    mat=bpy.data.materials.new('NV | Reference '+ref['id'])
    mat.use_nodes=True
    mat.node_tree.nodes.clear()
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im
    emission=mat.node_tree.nodes.new('ShaderNodeEmission')
    output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color'])
    mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
    d.materials.append(mat)
    obj=bpy.data.objects.new('NV | Reference | '+ref['title'],d)
    collection.objects.link(obj)
    obj['source_page']=ref['pageUrl'];obj['image_url']=ref['imageUrl']
    obj['capture_date']=ref['captureDate'] or 'unknown'
    obj['capture_date_evidence']=ref['captureDateStatus']
    obj['reference_metadata']=json.dumps(ref,ensure_ascii=False)
    obj['reference_only']=True
    obj['not_a_runtime_texture']=True
    td=bpy.data.curves.new('NV | Caption '+ref['id'],'FONT')
    td.body=ref['title']+'\n'+str(ref['captureDate'] or 'Date unknown')+' | '+ref['captureDateStatus']
    td.size=1.3
    caption=bpy.data.objects.new('NV | Caption '+ref['id'],td)
    caption.location=(x,y-height-2,0)
    collection.objects.link(caption)
camera=bpy.data.objects['NV | Photo reference boards']
camera.location=(307,-55,300)
camera.data.ortho_scale=320
# The inner cross-gable fascia lies inside the main roof volume. It is not an
# exposed white trim edge; preserve it as hidden construction geometry.
for edge in ('34','40'):
    trim=bpy.data.objects.get('NV | Fascia | clubhouse-cross-roof-native'+edge)
    if trim:trim.hide_render=True;trim.hide_viewport=True
notes=bpy.data.texts['NV | START HERE']
notes.write('\nThe complete dated catalogues are embedded as NV | {ortho,height,web} source catalogue.json.\n'
            'Collection09 holds all nine curated references and their source URLs/date confidence.\n'
            'Main exterior date2020-08-19 is filename-inferred; it is not an independently verified capture date.\n')
scene['photo_catalogue']=web_path.relative_to(ROOT).as_posix()
scene['photo_boards']=len(web['references'])
scene.camera=bpy.data.objects['NV | Clubhouse and pavilion']
backup=OUT/'norrfallsviken-facilities.initial.blend'
if not backup.exists():shutil.copy2(blend,backup)
staged=OUT/'norrfallsviken-facilities.staged.blend'
bpy.data.libraries.write(str(staged),{scene,*texts},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
staged.replace(blend)
report.update({'blendSha256':sha(blend),'blendBytes':blend.stat().st_size,'sceneObjects':len(scene.objects),
               'photoBoards':len(web['references']),'embeddedSourceCatalogues':3})
report['sourceFiles'].append({'path':web_path.relative_to(ROOT).as_posix(),'sha256':sha(web_path)})
assert bpy.context.scene.name==active_before and bpy.data.filepath==file_before
assert all(tuple(sorted(o.name for o in bpy.data.scenes[name].objects))==items for name,items in others.items())
report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
for name,cam in [('clubhouse-study',scene.camera),('reference-boards',camera)]:
    scene.camera=cam;scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True,scene=scene.name)
scene.camera=bpy.data.objects['NV | Clubhouse and pavilion']
print(json.dumps({'blend':str(blend),'bytes':report['blendBytes'],'photos':report['photoBoards'],
                  'embeddedSourceCatalogues':3,'currentScenePreserved':active_before}))
