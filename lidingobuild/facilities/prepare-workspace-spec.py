"""Pin the completed orthophoto, photo and geometry references for Blender."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'lidingobuild/cache/facilities-reference-2026-09-10'
FAC = ROOT/'lidingobuild/facilities'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ortho = read(FAC/'orthophoto-reference.json')
    web = read(FAC/'web-reference.json')
    model = read(OUT/'model-reference.json')
    inventory = read(FAC/'facility-inventory.json')
    photos = [p for p in web['photos'] if p.get('preferredForBlender')]
    assert photos, 'No reviewed reference photos'
    for photo in photos:
        with Image.open(ROOT/photo['path']) as source:
            orientation = int(source.getexif().get(274, 1))
            photo['sourceWidth'], photo['sourceHeight'] = source.size
            photo['exifOrientation'] = orientation
            photo['width'], photo['height'] = source.size[::-1] if orientation in (5,6,7,8) else source.size
    panels = [{**w, 'path': w['imagePath']} for w in ortho['windows']]
    assert panels[0]['id'] == 'facilities-overview-lm-2025'
    paths = {p['path'] for p in photos+panels}
    paths.update(['lidingobuild/facilities/orthophoto-reference.json',
                  'lidingobuild/facilities/web-reference.json',
                  'lidingobuild/facilities/facility-inventory.json',
                  'lidingobuild/cache/facilities-reference-2026-09-10/model-reference.json'])
    for item in panels:
        assert sha(ROOT/item['path']) == item['imageSha256']
    for item in photos:
        assert sha(ROOT/item['path']) == item['sha256']
    notes = '''LIDINGÖ GOLFKLUBB / FACILITY MODELLING WORKSPACE

Stage: gathered reference material plus the EXISTING app display geometry imported
as editable parts. This is the starting point for detailed remodelling, not a new
completed replica. No production app assets were replaced by this task.

SCENES
1. Model reference: five existing building models and courtyard terrace, split by
   architectural part/material. Neutral terrain uses the published 1m DTM sampled
   at 2m for display. Six primary footprints, 14 facility boundaries and additional
   mapped context sit at terrain heights. Toggle the 2021 roof TIN collection to
   inspect measured roofs, preserving unsupported regions.
2. Orthophoto plan: 2025-05-31 native 0.16m orthophoto, at exact EPSG:3006 pixel
   bounds. Detail crops and 2019 historical comparators are packed but hidden;
   select their objects in the Outliner and enable viewport/render visibility.
   Hide the other photo planes when comparing a historical layer. This scene is
   a flat plan reference at Z=0, not measured ground or roof heights.
3. Photo references: curated actual aerial and exterior photographs, with source
   URLs, capture-date evidence, rights and visible features on object properties.
   All source images are packed into this local file.

COORDINATES
One Blender unit=one metre. X=E-677700.5, Y=N-6586399.5, Z=RH2000-25.
Horizontal EPSG:3006; vertical RH2000/EPSG:5613. For app placement after Blender
glTF axis conversion, add 25m to vertical Y. Source fixture elevations already
include the terrain bridge; do not add an extra -0.05m offset.

PRIORITY MODELLING WORK
- Match the clubhouse roof steps, white facade, blue awnings, recessed reception,
  balcony/columns, pavilion and timber terrace to the reviewed exterior/aerials.
- The existing pale range buildings are a known appearance mismatch: reviewed
  photos show red timber structures. Confirm each photo-to-footprint association
  before replacing facade materials and openings.
- Model both north/south range shelters, tee mats and dividers, ball-machine huts,
  range fence/net supports, entrance pillars and pedestrian access where evidence
  supports their placement. Exact pole heights and hidden facades remain gaps.
- Keep the small shed and southern support building as outline references until
  enough height and exterior evidence is available; unknown use stays unknown.
- The 2025 orthophoto predates 2026 range-net work. Compare the current club photos
  and statements; historical imagery and conceptual drawings are not as-built plans.

See lidingobuild/facilities/README.md, facility-inventory.md, web-reference.md and
orthophoto-reference.md for sources, conflicts and remaining capture needs.
Raw/reference pixels and this packed project stay in the local ignored cache.
'''
    spec = {
        'schemaVersion': 1, 'sceneNames': {
            'model': 'Lidingö | Facilities model reference',
            'plan': 'Lidingö | Orthophoto plan',
            'photos': 'Lidingö | Photo references'},
        'modelPath': 'lidingobuild/cache/facilities-reference-2026-09-10/model-reference.json',
        'libraryPath': 'lidingobuild/cache/facilities-reference-2026-09-10/lidingo-facilities.library.blend',
        'blendPath': 'lidingobuild/cache/facilities-reference-2026-09-10/lidingo-facilities.blend',
        'reportPath': 'lidingobuild/facilities/blender-workspace-validation.json',
        'previews': {key: f'lidingobuild/cache/facilities-reference-2026-09-10/{key}-preview.png'
                     for key in ('model','plan','photos')},
        'inputs': [{'path': path, 'sha256': sha(ROOT/path)} for path in sorted(paths)],
        'orthophotos': panels, 'photos': photos, 'readme': notes,
        'unresolvedFacilities': inventory['unresolvedFacilities'],
    }
    spec_path = FAC/'blender-workspace-spec.json'
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    builder = FAC/'build-blender-workspace.py'
    run = f"from pathlib import Path\nexec(compile(Path({str(builder)!r}).read_text(encoding='utf-8'), {str(builder)!r}, 'exec'))\nbuild({str(spec_path)!r})\n"
    (OUT/'run-blender.py').write_text(run, encoding='utf-8')
    print(json.dumps({'photos': len(photos), 'orthophotos': len(panels), 'pinnedFiles': len(paths),
                      'architectureParts': len(model['architectureMeshes']), 'spec': str(spec_path)}))


if __name__ == '__main__':
    main()
