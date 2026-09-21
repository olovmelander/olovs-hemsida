"""Pack the research board into the editable study, outside runtime exports."""
import bpy, json
from pathlib import Path


def pack_references(scene, doc):
    collection=bpy.data.collections.new('References | enable to compare photographs')
    scene.collection.children.link(collection)
    collection.hide_render=True
    sources=json.loads((doc/'reference/sources.json').read_text(encoding='utf-8'))
    for index,record in enumerate(sources['images']):
        image=bpy.data.images.load(str(doc/'reference'/record['file']),check_existing=True)
        image.pack()
        ob=bpy.data.objects.new('Reference %d | %s'%(index+1,record['provenance']),None)
        ob.empty_display_type='IMAGE';ob.data=image;ob.empty_display_size=12
        ob.location=((index-1.5)*16,5,4);ob.rotation_euler=(1.57079632679,0,0)
        ob['source_url']=record['url'];ob['usage']=sources['usage']
        collection.objects.link(ob)
    collection.hide_viewport=True
    scene['references']='Four packed source photographs in the hidden References collection. Enable it to compare.'


if __name__=='__main__':
    assert bpy.app.background
    doc=Path(__file__).resolve().parents[2]/'docs/graphics/visby-martall-2026-09-21'
    file=doc/'visby-coastal-pines.blend'
    bpy.ops.wm.open_mainfile(filepath=str(file))
    bpy.context.preferences.filepaths.save_version=0
    pack_references(bpy.context.scene,doc)
    bpy.ops.wm.save_as_mainfile(filepath=str(file))
    print('PACKED_VISBY_REFERENCES',flush=True)
