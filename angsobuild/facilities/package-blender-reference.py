"""Turn the owned scene library into a normally opening Blender document.

Run only in a separate background Blender. Preserve the original library and
reject any file changed since this task's recorded build.
"""
import hashlib
import json
from pathlib import Path
import shutil

import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
spec = json.loads((HERE / 'blender-reference-spec.json').read_text(encoding='utf-8'))
output = ROOT / spec['blendPath']
library = output.with_suffix('.library.blend')
stage = output.with_suffix('.packaged.blend')
report_path = HERE / 'blender-build-report.json'
report = json.loads(report_path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


assert bpy.app.background, 'Only use an independent background Blender process'
assert Path(bpy.data.filepath).resolve() == output.resolve()
assert sha(output) == report['blendSha256'], 'Preserve artist edits made after the build'
assert not stage.exists() and not library.exists(), 'Preserve an existing package or backup'
assert output.resolve().parent == (ROOT / 'angsobuild/cache/facilities-2026-09-10').resolve()
assert all(path.resolve().parent == output.resolve().parent for path in (stage, library))
shutil.copy2(output, library)
scene = bpy.data.scenes[spec['sceneName']]
assert list(bpy.data.scenes) == [scene], 'Unrelated scene included'
bpy.context.window.scene = scene
scene.camera = scene.objects['ANG REF | '+spec['defaultPanel']+' camera']
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
scene['normal_blend_document'] = True
bpy.ops.wm.save_as_mainfile(filepath=str(stage), compress=True)
assert sha(output) == report['blendSha256'], 'File changed during packaging'
stage.replace(output)
report.update(blendSha256=sha(output), blendBytes=output.stat().st_size,
              packaging={'normalBlendDocument': True, 'activeScene': scene.name,
                         'defaultCamera': scene.camera.name, 'independentBackgroundProcess': True,
                         'libraryBackup': library.relative_to(ROOT).as_posix(),
                         'librarySha256': sha(library)})
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
