"""Independent read-only background reopen of the final editable source file."""
import hashlib
import json
import math
import argparse
import sys
from pathlib import Path
from datetime import datetime, timezone
import bpy

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT/'angsobuild/facilities'
REPORT = json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
MANIFEST_PATH = ROOT/'apps/golf/public/models/angso/facilities-v1.json'
MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
EXPORT = json.loads((HERE/'model-export-validation.json').read_text(encoding='utf-8'))
SOURCE = ROOT/REPORT['blendPath']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--visual-review-note', default=None,
                    help='Reviewer observation after inspecting this revision\'s courtyard and rear renders')
options = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

assert bpy.app.background
assert Path(bpy.data.filepath).resolve() == SOURCE.resolve()
file_hash = sha(SOURCE)
assert file_hash == REPORT['blendSha256'] == MANIFEST['sourceBlendSha256'] == EXPORT['blendSha256']
assert isinstance(REPORT['revision'], int) and REPORT['revision'] > 0
assert len(bpy.data.scenes) == 1
scene = bpy.data.scenes[0]
assert scene.name == REPORT['scene']
assert scene.name.endswith(f"v{REPORT['revision']}")
assert bpy.context.scene == scene
assert scene.get('normal_blend_document') and REPORT['normalBlendDocument']
assert scene.camera and scene.camera.type == 'CAMERA'
assert scene.camera.name == REPORT['cameras']['courtyard']
assert scene.unit_settings.system == 'METRIC' and scene.unit_settings.scale_length == 1
assert list(scene['originEPSG3006']) == [605530.0, 6605140.0]
assert scene['originHeightRH2000'] == 8.0

roots = [o for o in scene.objects if o.parent is None and o.get('facilityId')]
ids = sorted(o['facilityId'] for o in roots)
assert len(roots) == 19 and len(set(ids)) == 19
assert ids == sorted(f['id'] for f in REPORT['facilities'])
assert ids == sorted(f['id'] for f in MANIFEST['facilities'])
assert 'B02' not in ids and 'S07' in ids
assert not any(o.get('facilityId') == 'B02' for o in scene.objects)

meshes = [o for o in scene.objects if o.type == 'MESH' and o.get('generated_facility_model')]
assert len(meshes) == REPORT['counts']['meshObjects']
vertices = sum(len(o.data.vertices) for o in meshes)
assert vertices == REPORT['counts']['vertices']
for root in roots:
    assert root.type == 'EMPTY'
    assert root.get('source_inventory') == 'angsobuild/facilities/model-inputs.json'
    assert any(o.type == 'MESH' for o in root.children_recursive)
for obj in meshes:
    assert obj.parent in roots and obj['facilityId'] == obj.parent['facilityId']
    assert obj.data.vertices and obj.data.polygons and len(obj.data.materials) == 1
    assert not obj.get('reference_only') and not obj.get('context_only')
    assert all(math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co)
    assert all(len(face.vertices) >= 3 for face in obj.data.polygons)
    material = obj.data.materials[0]
    assert material and material.use_nodes
    assert not any(node.type == 'TEX_IMAGE' for node in material.node_tree.nodes)
    if obj.get('surface_overlay'):
        assert all(face.use_smooth for face in obj.data.polygons)

notes = [t for t in bpy.data.texts if 'Model source and interpretation' in t.name]
assert len(notes) == 1
packed_notes = json.loads(notes[0].as_string())
assert sorted(f['id'] for f in packed_notes['facilities']) == ids
assert packed_notes['reports'] == REPORT['modeling']
assert any(x['id'] == 'B02' for x in packed_notes['reports']['model_clubhouse.py']['omittedReferences'])
assert all(sha(ROOT/x['path']) == x['sha256'] for x in REPORT['sourceInputs'])
assert MANIFEST['groundId'] == 'angso'
assert 'Lantm' in MANIFEST['sourceAttribution'] and 'CC BY 4.0' in MANIFEST['sourceAttribution']
asset = ROOT/'apps/golf/public'/MANIFEST['asset']['url']
assert sha(asset) == MANIFEST['asset']['sha256'] == EXPORT['asset']['sha256']
assert asset.stat().st_size == MANIFEST['asset']['bytes']
manifest_facilities = {f['id']: f for f in MANIFEST['facilities']}
ground_ring_counts = {}
for facility in REPORT['facilities']:
    fid = facility['id']
    source_rings = facility.get('groundSurfaceRingsBlenderXY', [])
    display_rings = manifest_facilities[fid].get('groundSurfaceRingsLocal', [])
    assert len(source_rings) == len(display_rings), fid+' ground surface ring count'
    for source_ring, display_ring in zip(source_rings, display_rings):
        assert len(source_ring) == len(display_ring) >= 3
        assert all(len(p) == 2 and all(math.isfinite(v) for v in p) for p in display_ring)
        signed_area_twice = sum(a[0]*b[1]-b[0]*a[1] for a, b in
                                zip(display_ring, display_ring[1:]+display_ring[:1]))
        assert abs(signed_area_twice) > .01, fid+' degenerate ground surface ring'
    if source_rings:
        ground_ring_counts[fid] = len(source_rings)
assert ground_ring_counts, 'No measured surface rings retained for runtime ground cover'
assert all(REPORT[x] is True for x in ['existingScenesPreserved', 'currentFilePreserved', 'selectionPreserved'])
assert REPORT['activeScenePreserved'] and EXPORT['liveBlenderScenePreserved']

views = []
for key in ['courtyard', 'restaurant-rear']:
    p = SOURCE.parent/(key+'.png')
    exported = next(x for x in EXPORT['previews'] if x['view'] == key)
    assert sha(p) == exported['sha256']
    views.append({'view': key, 'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p)})
assert sha(SOURCE) == file_hash
result = {
    'schemaVersion': 1,
    'passed': True,
    'auditedAt': datetime.now(timezone.utc).isoformat(),
    'method': 'Independent background Blender reopen; source file not modified',
    'savedBlendPath': REPORT['blendPath'],
    'revision': REPORT['revision'],
    'blendSha256': file_hash,
    'blenderVersion': bpy.app.version_string,
    'sceneCount': len(bpy.data.scenes),
    'scene': scene.name,
    'facilityRoots': ids,
    'facilityRootCount': len(roots),
    'editableMeshes': len(meshes),
    'editableVertices': vertices,
    'normalDocumentStartupVerified': True,
    'activeCamera': scene.camera.name,
    'metricFrameAndOriginVerified': True,
    'unconfirmedB02Excluded': True,
    'siteCirculationS07Included': True,
    'finiteGeometryAndSingleMaterialMeshesVerified': True,
    'referenceImagesUsedAsArchitectureTextures': False,
    'packedModelingProvenanceMatchesBuildReport': True,
    'sourceInputHashesMatchCurrentFiles': True,
    'runtimeManifestMatchesSourceIdentity': True,
    'groundSurfaceRingCountsMatchSource': ground_ring_counts,
    'groundSurfaceRingCount': sum(ground_ring_counts.values()),
    'groundOverlaySmoothNormalsVerified': True,
    'runtimeAssetSha256': MANIFEST['asset']['sha256'],
    'sourceAttribution': MANIFEST['sourceAttribution'],
    'liveSessionPreservation': {
        'basis': 'Live builder recorded before/after object-transform, active-scene, current-file and selection checks; this audit only opens a separate background process',
        'reportedPreserved': True,
        'preservedActiveScene': REPORT['activeScenePreserved'],
    },
    'visualReview': {
        'views': views,
        'passed': bool(options.visual_review_note),
        'status': 'reviewed' if options.visual_review_note else 'manual review not supplied',
        'observations': options.visual_review_note,
        'limitations': 'Visual reconstruction review does not establish survey accuracy of hidden facade details or exact finished-floor and eave heights.',
    },
    'sourceFileUnchangedByAudit': True,
}
(HERE/'model-file-audit.json').write_text(json.dumps(result, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
print('ANGSO_MODEL_FILE_AUDIT '+json.dumps(result, ensure_ascii=False))
