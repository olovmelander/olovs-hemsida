"""Restore the saved scene by appending it, without replacing the open file."""
import bpy, json
from pathlib import Path

root = Path(r'C:/Users/olov_/repos/olovs-hemsida')
backup = root / 'docs/graphics/tree-atelier-2026-09-13/blender-recovery-1219.blend'
name = 'Veckefjarden | Photo landmarks 2026-09-13'
if name not in bpy.data.scenes:
    with bpy.data.libraries.load(str(backup), link=False) as (source, target):
        target.scenes = [name] if name in source.scenes else []
scene = bpy.data.scenes.get(name)
if scene is None:
    raise RuntimeError('The verified recovery scene is missing')
assert len(scene.objects) == 156, 'Unexpected landmark object count'
bpy.context.window.scene = scene
print(json.dumps({'restoredScene': scene.name, 'objects': len(scene.objects),
                  'activeFile': bpy.data.filepath, 'blender': bpy.app.version_string}))
