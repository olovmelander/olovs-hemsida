"""Launch the isolated asset build through the live Blender MCP connection."""
import bpy, subprocess, json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
original_colours = globals().get('ORIGINAL_COLOURS', False)
doc = root / 'docs/graphics' / ('visby-martall-original-colours-2026-09-21' if original_colours else 'visby-martall-2026-09-21')
doc.mkdir(parents=True, exist_ok=True)
package_only = globals().get('PACKAGE_ONLY', False)
script = 'package_visby_references.py' if package_only else 'visby_pine.py'
logfile = doc / ('package.log' if package_only else 'worker.log')
with logfile.open('w', encoding='utf-8') as log:
    worker = subprocess.Popen([bpy.app.binary_path, '--background', '--factory-startup',
        '--python-exit-code', '1', '--python', str(root / 'tools/blender-tree-study' / script),
        *(['--', '--original-colours'] if original_colours else [])],
        stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
print(json.dumps({'pid': worker.pid, 'preservedScene': bpy.context.scene.name, 'log': str(logfile)}))
