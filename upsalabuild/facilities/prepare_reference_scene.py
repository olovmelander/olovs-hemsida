"""Combine acquired reference manifests into an explicit Blender/gallery spec."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "upsalabuild/facilities/reference-2026-09-10"
CACHE = ROOT / "upsalabuild/cache/facilities-2026-09-10"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def prepare(suffix=""):
    ortho = read(REFERENCE / "orthophoto-manifest.json")
    buildings = read(REFERENCE / "building-reference-inventory.json")["buildings"]
    web = read(REFERENCE / "web-photo-manifest.json")
    assert ortho["validation"]["state"] == "passed"
    def verified(path, sha):
        actual = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        assert actual == sha, f"Changed reference source: {path}"
        return path
    def image_spec(image):
        return {"id": image["id"], "path": verified(image["path"], image["sha256"]),
                "cornersLocalXZ": [p["localXZ"] for p in image["pixelToLocalCorners"]],
                "displayPlaneZ": -0.1 if image["resolutionMetres"] <= 0.16 else -0.2,
                "captureDate": ", ".join(image["captureDates"])}
    native = next(i for i in ortho["images"] if i["id"] == "facilities-campus-native")
    photos = []
    for photo in web["photos"]:
        photos.append({"id": photo["id"], "path": verified(photo["path"], photo["sha256"]),
                       "width": photo["width"], "height": photo["height"],
                       "sourceUrl": photo["sourcePageURL"], "evidenceType": photo["evidenceType"],
                       "captureDate": photo.get("captureDate") or "unknown",
                       "dateNote": photo.get("captureDateNote", ""), "description": photo["description"],
                       "limitations": photo.get("limitations", []), "buildingIds": photo.get("buildingIds", [])})
    spec = {
        "schemaVersion": 1, "repoRoot": str(ROOT), "sceneName": "Upsala GK | Facility references 2026-09-10" + suffix,
        "manifestPath": "upsalabuild/facilities/reference-2026-09-10/orthophoto-manifest.json",
        "anchorLocalXZ": ortho["anchorLocalXZ"], "orthophoto": image_spec(native),
        "additionalOrthophotos": [image_spec(i) for i in ortho["images"] if i is not native],
        "annotatedMapPath": ortho["reviewPanels"][0]["path"],
        "additionalMapPanels": ortho["reviewPanels"][1:],
        "photos": photos,
        "footprints": [{"id": b["id"], "sourceId": f"municipal:{b['municipalObjectId']}",
                        "measured": b["confirmedExistingMeasuredOutline"], "localXZ": b["localRing"],
                        "label": b["name"], "evidence": b["geometryInterpretation"] + " " + b["functionEvidenceNote"]} for b in buildings],
        "blendPath": "upsalabuild/cache/facilities-2026-09-10/upsala-facility-references" + suffix + ".blend",
        "previewPath": "upsalabuild/cache/facilities-2026-09-10/blender-map-preview" + suffix + ".png",
        "reportPath": "upsalabuild/facilities/reference-2026-09-10/blender-scene-validation" + suffix + ".json",
        "galleryPath": "upsalabuild/facilities/reference-2026-09-10/index.html",
        "readme": """UPSALA GK - FACILITY REFERENCE SCENE

This is a modelling desk, not a completed architectural reconstruction.
One Blender unit is one metre. X follows course X; Y is minus course Z.
The source anchor and all transforms are recorded in the scene properties.
Flat images and outlines at Z=0 are a mapping datum, not terrain or floor levels.
Use the exact per-point EPSG:3006 transform for tracing measurements; the image
quad is only a display approximation to that transform.

Collections 01-04: native June2025 orthophotos, numbered municipal outlines.
Cyan outlines have confirmed existing/measured source status. Amber outlines
are other municipal evidence. Overlapping parts are not separate building solids.
Collection05: real photo, drawing and design-visualization boards, excluded from
map renders. Dates, evidence types and source URLs are attached to each board.
All photos are packed for local reference; do not export these boards as textures.
The 2026 service house postdates the orthophoto. Its design and as-built evidence
must be reconciled separately. The 2021 laser reference also predates this change.

Modelling order: main clubhouse roof masses, measured ground placement, eaves
and ridge heights from suitable laser/photo controls, terrace/porches/dormers,
window/door groups visible in photos, range shelters and service buildings.
Unseen sides and daily movable furniture remain evidence gaps.

For runtime axis/height contracts and removal of duplicate procedural objects,
read upsalabuild/facilities/reference-2026-09-10/runtime-integration.md.
The current file preserves a separate reference scene; it does not modify
the production course, other Blender scenes, or the active Blender window.
""",
    }
    laser_path = REFERENCE / "lidar-roof-evidence.json"
    if laser_path.exists():
        laser = read(laser_path)
        point_reference = laser["blenderPointReference"]
        spec["laserReference"] = {
            "path": verified(point_reference["path"], point_reference["sha256"]),
            "points": point_reference["points"], "anchorHeightRH2000": 34.968,
            "heightAnchorNote": "Rounded 2023 terrain height at the shared clubhouse anchor; a scene datum, not finished floor.",
            "sourceManifest": laser_path.relative_to(ROOT).as_posix(),
        }
    spec["contextReferences"] = []
    for filename in ["context-geometry-local.json", "supplemental-context.json"]:
        context_path = REFERENCE / filename
        if not context_path.exists():
            continue
        for feature in read(context_path)["features"]:
            if feature["category"] in ["buildings", "mapped-tree-point"]:
                continue
            if feature["category"] == "mapped-fixture-point" and not feature["coverage"]["nativeImageFullyCovers"]:
                continue
            spec["contextReferences"].append({
                "id": feature["id"], "category": feature["category"],
                "rings": feature.get("localRings", [feature["localRing"]] if "localRing" in feature else []),
                "holes": feature.get("localHoles", []), "point": feature.get("localXZ"),
                "sourceManifest": context_path.relative_to(ROOT).as_posix(),
            })
    CACHE.mkdir(parents=True, exist_ok=True)
    spec_path = CACHE / ("blender-scene-spec" + suffix + ".json")
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    script = CACHE / ("create-reference-scene" + suffix + ".py")
    builder = ROOT / "upsalabuild/facilities/build_reference_scene.py"
    script.write_text(f"from pathlib import Path\nexec(compile(Path({str(builder)!r}).read_text(encoding='utf-8'), {str(builder)!r}, 'exec'))\nbuild_reference_scene({str(spec_path)!r})\n", encoding="utf-8")
    print(json.dumps({"spec": str(spec_path), "script": str(script), "footprints": len(buildings), "imageBoards": len(photos)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suffix", default="", help="New suffix for a revised scene; existing scenes/files are retained")
    prepare(parser.parse_args().suffix)
