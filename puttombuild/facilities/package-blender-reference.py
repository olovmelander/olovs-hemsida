"""Package the owned scene library into a normal .blend in background Blender.

Never run through the live MCP bridge. Input must match the last build checksum.
The source library is retained as a backup; any subsequent artist changes abort.
"""
import hashlib
import json
from pathlib import Path
import shutil
import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'puttombuild/facilities'
spec = json.loads((HERE / 'blender-reference-spec.json').read_text(encoding='utf-8'))
output = ROOT / spec['blendPath']
library = output.with_suffix('.library.blend')
stage = output.with_suffix('.packaged.blend')
report_path = HERE / 'blender-build-report.json'
report = json.loads(report_path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


assert bpy.app.background, 'Run only in an independent background Blender process'
assert Path(bpy.data.filepath).resolve() == output.resolve()
assert sha(output) == report['blendSha256'], 'File changed; preserve artist edits'
assert not stage.exists() and not library.exists(), 'Prior package exists; preserve it'
assert all(p.resolve().parent == output.resolve().parent for p in (library, stage))
shutil.copy2(output, library)
scene = bpy.data.scenes[spec['sceneName']]
assert list(bpy.data.scenes) == [scene], 'Unrelated scene was included'
bpy.context.window.scene = scene
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene['normal_blend_document'] = True
bpy.ops.wm.save_as_mainfile(filepath=str(stage), compress=True)
assert sha(output) == report['blendSha256'], 'File changed while packaging'
stage.replace(output)
report.update(blendSha256=sha(output), blendBytes=output.stat().st_size,
              packaging={'normalBlendDocument': True, 'activeScene': scene.name,
                         'independentBackgroundProcess': True,
                         'libraryBackup': library.relative_to(ROOT).as_posix()})
report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
print(json.dumps(report))
