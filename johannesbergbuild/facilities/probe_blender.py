"""Read-only scene inventory; safe to run through the local bridge."""
import json
import bpy

print(json.dumps({
    'blenderVersion': bpy.app.version_string,
    'binaryPath': bpy.app.binary_path,
    'currentFile': bpy.data.filepath,
    'activeScene': bpy.context.scene.name,
    'scenes': [{'name': s.name, 'objects': len(s.objects)} for s in bpy.data.scenes],
    'selectedObjects': [o.name for o in bpy.context.selected_objects],
}, ensure_ascii=False))
