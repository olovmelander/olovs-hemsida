"""Read the live Blender environment without changing its scene."""
import bpy
import json
print(json.dumps({
    'version': bpy.app.version_string,
    'binary': bpy.app.binary_path,
    'file': bpy.data.filepath,
    'activeScene': bpy.context.scene.name,
    'scenes': [{'name': s.name, 'objects': len(s.objects)} for s in bpy.data.scenes],
}, ensure_ascii=False))
