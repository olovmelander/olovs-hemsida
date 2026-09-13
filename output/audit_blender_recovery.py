import bpy, json
from pathlib import Path
report = {'file': bpy.data.filepath, 'activeScene': bpy.context.scene.name,
          'scenes': [{'name': s.name, 'objects': len(s.objects)} for s in bpy.data.scenes]}
Path(r'C:/Users/olov_/repos/olovs-hemsida/docs/graphics/tree-atelier-2026-09-13/recovery-audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
