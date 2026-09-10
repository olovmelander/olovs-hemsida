"""Make the owned scene library a normal directly openable Blender document.

Run only in a separate background Blender that has opened the existing owned
file. The user's Blender MCP process and live scene are never accessed here.

PowerShell (from repository root):
  & 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background `
    nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend `
    --python nvgkbuild/facilities/package-blender-workspace.py
"""
import hashlib
import json
from pathlib import Path
import shutil

import bpy

ROOT=Path(r'C:\Users\olov_\repos\olovs-hemsida')
DIRECTORY=ROOT/'nvgkbuild/cache/facilities-reference'
BLEND=DIRECTORY/'norrfallsviken-facilities.blend'
STAGED=DIRECTORY/'norrfallsviken-facilities.packaged.blend'
LIBRARY=DIRECTORY/'norrfallsviken-facilities.library.blend'
REPORT_PATH=ROOT/'nvgkbuild/facilities/blender-workspace-validation.json'
SCENE_NAME='Norrfallsviken | Measured facilities'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def package():
    assert bpy.app.background,'Packaging must run in an independent background Blender process'
    assert Path(bpy.data.filepath).resolve()==BLEND.resolve(),'Open the owned source file before packaging'
    for path in (BLEND,STAGED,LIBRARY):
        assert path.resolve().parent==DIRECTORY.resolve(),'Refusing a path outside the owned output directory'
    report=json.loads(REPORT_PATH.read_text(encoding='utf-8'))
    expected_hash=report['blendSha256']
    assert sha(BLEND)==expected_hash,'Saved workspace changed since its recorded build; preserve it'
    if report.get('packaging',{}).get('format')=='normal-blend-document':
        print(json.dumps({'status':'already-packaged','blendSha256':expected_hash}))
        return
    assert not STAGED.exists(),'A staged package already exists; retain it for review'
    if LIBRARY.exists():
        assert sha(LIBRARY)==expected_hash,'Existing library backup differs; preserve it'
    else:
        shutil.copy2(BLEND,LIBRARY)
    scene=bpy.data.scenes[SCENE_NAME]
    camera=scene.objects['NV | Clubhouse and pavilion']
    assert camera.type=='CAMERA'
    scene.camera=camera
    window=bpy.context.window
    assert window is not None,'A window context is required to store the startup scene'
    window.scene=scene
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
    scene['document_packaging']='Normal Blender document; opens on measured facilities and the clubhouse review camera'
    bpy.ops.wm.save_as_mainfile(filepath=str(STAGED),compress=True)
    assert STAGED.exists() and STAGED.stat().st_size>1_000_000,'Background save did not produce a complete workspace'
    assert sha(BLEND)==expected_hash,'Owned file changed during packaging; preserve it'
    current_report=json.loads(REPORT_PATH.read_text(encoding='utf-8'))
    assert current_report['blendSha256']==expected_hash,'Build report changed during packaging; preserve it'
    STAGED.replace(BLEND)
    current_report.update(blendSha256=sha(BLEND),blendBytes=BLEND.stat().st_size)
    current_report['packaging']={
        'format':'normal-blend-document','activeScene':SCENE_NAME,'defaultCamera':camera.name,
        'savedBy':'independent background Blender process; live user Blender untouched',
        'sourceLibraryBackup':LIBRARY.relative_to(ROOT).as_posix(),'sourceLibrarySha256':sha(LIBRARY),
        'script':'nvgkbuild/facilities/package-blender-workspace.py','scriptSha256':sha(Path(__file__)),
        'blenderBinary':bpy.app.binary_path}
    REPORT_PATH.write_text(json.dumps(current_report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':'packaged','blend':BLEND.relative_to(ROOT).as_posix(),
                      'blendSha256':current_report['blendSha256'],'bytes':current_report['blendBytes'],
                      'activeScene':scene.name,'defaultCamera':camera.name,
                      'libraryBackup':LIBRARY.relative_to(ROOT).as_posix()}))

package()
