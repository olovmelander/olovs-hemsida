import bpy, subprocess, json
from pathlib import Path
root = Path(r'C:/Users/olov_/repos/olovs-hemsida')
log = root / 'docs/graphics/tree-atelier-2026-09-13/foliage-worker.log'
with log.open('w', encoding='utf-8') as output:
    worker = subprocess.Popen([bpy.app.binary_path, '--background', '--factory-startup', '--python-exit-code', '1',
        '--python', str(root/'tools/blender-tree-study/fluffy_pine.py')], stdout=output,
        stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
print(json.dumps({'pid': worker.pid, 'log': str(log), 'activeScene': bpy.context.scene.name}))
