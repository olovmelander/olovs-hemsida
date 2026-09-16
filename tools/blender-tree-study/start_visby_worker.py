"""Launch the isolated asset build through the live Blender MCP connection."""
import bpy, subprocess, json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
doc = root / 'docs/graphics/visby-coastal-pine-2026-09-16'
doc.mkdir(parents=True, exist_ok=True)
with (doc / 'worker.log').open('w', encoding='utf-8') as log:
    worker = subprocess.Popen([bpy.app.binary_path, '--background', '--factory-startup',
        '--python-exit-code', '1', '--python', str(root / 'tools/blender-tree-study/visby_pine.py')],
        stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
print(json.dumps({'pid': worker.pid, 'preservedScene': bpy.context.scene.name, 'log': str(doc / 'worker.log')}))
