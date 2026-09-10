"""Open the saved reference .blend in background Blender and verify/render it."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

spec_path = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
spec = json.loads(spec_path.read_text(encoding="utf-8"))
root = Path(spec["repoRoot"])
scene = bpy.data.scenes[spec["sceneName"]]
anchor = spec["anchorLocalXZ"]
assert scene.unit_settings.system == "METRIC" and scene.unit_settings.scale_length == 1
assert scene["reference_only"]
errors = []
for building in spec["footprints"]:
    obj = scene.objects["UPSALA REF | " + building["id"]]
    expected = building["localXZ"]
    if expected[0] == expected[-1]:
        expected = expected[:-1]
    actual = obj.data.splines[0].points
    assert len(expected) == len(actual)
    for wanted, observed in zip(expected, actual):
        errors.append(math.dist((wanted[0] - anchor[0], anchor[1] - wanted[1], 0.35), observed.co[:3]))
    assert not obj["height_verified"]
assert max(errors) < 0.00005
image_planes = [o for o in scene.objects if o.type == "MESH" and "source_path" in o]
assert len(image_planes) == len(spec["photos"]) + 3
assert all(o.data.materials[0].node_tree.nodes.get("Image Texture").image.packed_file for o in image_planes)
for photo in spec["photos"]:
    obj = scene.objects["UPSALA REF | " + photo["id"]]
    assert obj["source_url"] == photo["sourceUrl"]
    assert obj["evidence_type"] == photo["evidenceType"]
laser_points = sum(len(o.data.vertices) for o in scene.objects if o.type == "MESH" and "classification" in o)
assert laser_points == spec["laserReference"]["points"] == 99607
camera = scene.camera
half = camera.data.ortho_scale / 2
for b in spec["footprints"]:
    for p in b["localXZ"]:
        assert abs(p[0] - anchor[0] - camera.location.x) < half
        assert abs(anchor[1] - p[1] - camera.location.y) < half
preview = root / spec["previewPath"]
scene.render.filepath = str(preview)
bpy.ops.render.render(write_still=True, scene=scene.name)
assert preview.exists() and preview.stat().st_size > 10000
# libraries.write intentionally leaves the live user's Blender state alone.
# Convert that library into a normal, directly openable .blend in this separate
# background process, with the intended scene and top reference view active.
initial_library_sha = hashlib.sha256((root / spec["blendPath"]).read_bytes()).hexdigest()
assert bpy.context.window is not None
bpy.context.window.scene = scene
for other in list(bpy.data.scenes):
    if other != scene:
        assert not other.objects, "Unexpected scene in isolated reference file"
        bpy.data.scenes.remove(other)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            space = area.spaces.active
            space.region_3d.view_perspective = "ORTHO"
            space.region_3d.view_rotation = Quaternion((1, 0, 0, 0))
            space.region_3d.view_location = Vector((camera.location.x, camera.location.y, 0))
            space.region_3d.view_distance = camera.data.ortho_scale
            space.shading.type = "MATERIAL"
            space.overlay.show_floor = False
            space.overlay.show_axis_x = False
            space.overlay.show_axis_y = False
bpy.ops.wm.save_as_mainfile(filepath=str(root / spec["blendPath"]), check_existing=False)
final_sha = hashlib.sha256((root / spec["blendPath"]).read_bytes()).hexdigest()
creation_path = root / spec["reportPath"]
creation = json.loads(creation_path.read_text(encoding="utf-8"))
creation["initialLibrarySha256"] = creation.get("initialLibrarySha256", initial_library_sha)
creation["blendSha256"] = final_sha
creation["blendBytes"] = (root / spec["blendPath"]).stat().st_size
creation["savedAsNormalBlendInIsolatedBackgroundProcess"] = True
creation_path.write_text(json.dumps(creation, indent=2) + "\n", encoding="utf-8")
report = {
    "passed": True, "method": "Independent background Blender opened the saved scene, verified geometry/packed images/source metadata, then rendered the map.",
    "blenderVersion": bpy.app.version_string, "scene": scene.name,
    "footprints": len(spec["footprints"]), "maximumStoredVertexErrorMetres": max(errors),
    "packedReferenceImages": len(image_planes), "laserReferencePoints": laser_points,
    "allBuildingReferencesInsideCamera": True,
    "blendPath": spec["blendPath"], "blendSha256": final_sha,
    "opensWithReferenceSceneActive": bpy.context.scene.name == scene.name,
    "previewPath": spec["previewPath"], "previewSha256": hashlib.sha256(preview.read_bytes()).hexdigest(),
    "referenceOnly": True, "finishedArchitecture": False,
}
(root / "upsalabuild/facilities/reference-2026-09-10/blender-render-validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
