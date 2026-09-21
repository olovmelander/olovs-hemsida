"""Read-only MCP inspection, with a recovery copy before a new cloth study."""
import bpy, json, os

out = os.path.join(os.path.dirname(__file__), 'cache')
os.makedirs(out, exist_ok=True)
backup = os.path.join(out, 'before-flag-refinement.blend')
if not os.path.exists(backup):
    bpy.ops.wm.save_as_mainfile(filepath=backup, copy=True)
print(json.dumps({'blender': bpy.app.version_string, 'file': bpy.data.filepath,
                  'recovery': backup, 'scenes': [s.name for s in bpy.data.scenes]}))
