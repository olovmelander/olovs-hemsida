"""Finalize and audit only the owned Lidingö library in background Blender."""
import hashlib
import json
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT/'lidingobuild/facilities/blender-workspace-spec.json').read_text(encoding='utf-8'))
REPORT = ROOT/SPEC['reportPath']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package():
    assert bpy.app.background, 'Run in a separate background process'
    library, output = ROOT/SPEC['libraryPath'], ROOT/SPEC['blendPath']
    assert Path(bpy.data.filepath).resolve() == library.resolve()
    assert output.resolve().parent == library.resolve().parent
    assert not output.exists(), 'Preserve an already saved workspace'
    report = json.loads(REPORT.read_text(encoding='utf-8'))
    assert sha(library) == report['librarySha256']
    expected = set(SPEC['sceneNames'].values())
    assert set(s.name for s in bpy.data.scenes) == expected
    assert all(img.packed_file for img in bpy.data.images if img.source == 'FILE'), 'Unpacked external image'
    invalid = []
    mesh_count = triangle_count = 0
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        mesh_count += 1
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
        if any(not all(__import__('math').isfinite(x) for x in v.co) for v in obj.data.vertices):
            invalid.append(obj.name)
    assert not invalid, invalid
    for key in ('model', 'plan', 'photos'):
        scene = bpy.data.scenes[SPEC['sceneNames'][key]]
        scene.render.filepath = str(ROOT/SPEC['previews'][key])
        bpy.ops.render.render(write_still=True, scene=scene.name)
    model_scene = bpy.data.scenes[SPEC['sceneNames']['model']]
    bpy.context.window.scene = model_scene
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.shading.type = 'MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report.update(stage='packaged-and-rendered', blendPath=SPEC['blendPath'], blendBytes=output.stat().st_size,
                  blendSha256=sha(output), meshObjects=mesh_count, meshTriangles=triangle_count,
                  allExternalImagesPacked=True, finiteMeshCoordinates=True,
                  activeScene=model_scene.name, previews=SPEC['previews'])
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


package()
