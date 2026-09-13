"""Start the fixed-budget Blender worker via live MCP and return immediately."""
import bpy, subprocess, json
from pathlib import Path
root = Path(r'C:/Users/olov_/repos/olovs-hemsida')
evidence = root / 'docs/graphics/tree-atelier-2026-09-13'
log = evidence / 'pine-worker.log'
with log.open('w', encoding='utf-8') as output:
    worker = subprocess.Popen([bpy.app.binary_path, '--background', '--factory-startup', '--python-exit-code', '1',
        '--python', str(root / 'tools/blender-tree-study/refine_pine.py')],
        stdout=output, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
report = {'pid': worker.pid, 'log': str(log), 'activeScene': bpy.context.scene.name, 'objects': len(bpy.context.scene.objects)}
(evidence / 'pine-worker.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
