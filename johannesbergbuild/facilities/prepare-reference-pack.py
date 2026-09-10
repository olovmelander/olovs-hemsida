"""Compile source receipts into a local review gallery and pinned Blender input.

Run from any directory with the review venv (Pillow). No network or Blender
mutation occurs here. Downloaded imagery stays in the ignored reference cache.
"""
import hashlib
import html
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'johannesbergbuild/facilities'
CACHE = ROOT / 'johannesbergbuild/cache/facilities-reference'
DATE = '2026-09-10'


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def relative(path):
    return Path(path).relative_to(ROOT).as_posix()


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def escape(value):
    return html.escape(str(value), quote=True)


def link(path):
    return escape(os.path.relpath(ROOT / path, CACHE).replace('\\', '/'))


def main():
    site_path = 'johannesbergbuild/facilities/site-inventory.json'
    panel_path = 'johannesbergbuild/facilities/orthophoto-panels.json'
    web_path = 'johannesbergbuild/facilities/web-reference-sources.json'
    height_paths = ['johannesbergbuild/facilities/roof-height-evidence.json',
                    'johannesbergbuild/facilities/roof-height-service-hall-evidence.json']
    site, panel_index, web = read(site_path), read(panel_path), read(web_path)
    height_reports = [read(p) for p in height_paths]
    heights = {f['sourceBuildingId']: f for d in height_reports for f in d['facilities']}
    buildings = [f for f in site['facilities'] if f['category'] == 'building']
    assert len({f['sourceBuildingId'] for f in buildings}) == len(buildings)
    assert all(f['sourceBuildingId'] in heights for f in buildings), 'Missing height join'
    inputs = {}

    def pin(path, expected=None):
        actual = digest(path)
        if expected:
            assert actual == expected, 'Source hash mismatch: ' + path
        inputs[path] = {'path': path, 'sha256': actual}
        return actual

    for path in [site_path, panel_path, web_path, *height_paths,
                 'apps/golf/src/engine/v2-johannesberg-config.mjs']:
        pin(path)
    for p in panel_index['panels']:
        pin(p['path'], p['sha256'])
        with Image.open(ROOT / p['path']) as img:
            assert img.size == (p['width'], p['height'])
        w, s, e, n = p['boundsEPSG3006']
        res = p['pixelResolutionMetres']
        assert abs((e - w) / res - p['width']) < .001
        assert abs((n - s) / res - p['height']) < .001
        for key in ('raster', 'provenance'):
            if p.get(key):
                pin(p[key]['path'], p[key]['sha256'])
    pin(panel_index['overview']['path'], panel_index['overview']['sha256'])
    photos = []
    for p in [*web['photos'], *web['documents']]:
        pin(p['path'], p['sha256'])
        if p.get('width') and p.get('height'):
            with Image.open(ROOT / p['path']) as img:
                assert img.size == (p['width'], p['height'])
            photos.append(p)
    cloud_paths = [d['privateBlenderPointReference']['path'] for d in height_reports]
    seen, points, source_files = set(), [], []
    for d, path in zip(height_reports, cloud_paths):
        sha = pin(path, d['privateBlenderPointReference']['sha256'])
        cloud = read(path)
        assert len(cloud['points']) == cloud['count']
        source_files.append({'path': path, 'sha256': sha})
        for p in cloud['points']:
            key = tuple(p)
            if key not in seen:
                points.append(p)
                seen.add(key)
    combined_path = 'johannesbergbuild/cache/facilities-reference/laser/combined-blender-points.json'
    combined = {'schemaVersion': 1, 'horizontalCrs': 'EPSG:3006', 'verticalCrs': 'EPSG:5613 / RH2000',
                'captureDate': '2021-04-17', 'columns': ['eastingM', 'northingM', 'heightRh2000M', 'classification'],
                'sourceFiles': source_files, 'count': len(points), 'points': points}
    write(ROOT / combined_path, combined)
    pin(combined_path)

    outlines, location_points = [], []
    for f in [*site['facilities'], *site.get('contextFeatures', [])]:
        geometry = f['geometry']
        ring = geometry.get('ringEPSG3006') or geometry.get('lineEPSG3006')
        if not ring:
            if geometry.get('pointEPSG3006'):
                location_points.append({'id': f['id'], 'label': f['label'],
                                        'pointEPSG3006': geometry['pointEPSG3006'],
                                        'geometryStatus': f['geometryStatus'], 'sourceInventory': site_path})
            continue
        outlines.append({'id': f['id'], 'label': f['label'],
                         'shortLabel': '' if '-access-' in f['id'] else str(f.get('modelBuildingIndex', f['label'])),
                         'kind': f['category'], 'geometryKind': f.get('geometryStatus', geometry['kind']),
                         'reviewed': f.get('geometryStatus') == 'reviewed-2025-roof-edge-reference',
                         'closed': geometry['kind'] not in ('line', 'polyline'),
                         'ringEPSG3006': ring, 'sourceBuildingId': f.get('sourceBuildingId'),
                         'sourceInventory': site_path, 'role': f.get('role', f['label'])})
    hub = panel_index['panels'][0]
    readme = f'''Johannesberg facilities reference / {DATE}

This is a reference scene, not completed architecture. {len(buildings)} building
outlines locate evidence; only the small range-shelter roof has a reviewed roof
perimeter (cyan); all other building outlines are inherited (amber). Site context
is green; a terrace location cross is not a terrace boundary. The native orthophoto was captured 2025-06-14
at 0.16 m/pixel. Number labels match model building indices in the source inventory.
All reference images are packed. The web photographs are reference-only: permission
for redistribution or use as runtime textures has not been established.

Open the local index.html gallery beside this .blend for all native building crops,
source links, capture-date evidence, rights, role confidence and modelling gaps.
Use the Site plan camera and Photo board camera for review. To inspect the laser,
enable collection 07, select its mesh and enter Edit Mode: it contains {len(points):,}
source vertices with source_classification (1=unclassified surface, 2=ground).
Do not convert these mixed returns directly into a roof mesh.

Coordinates: X=EPSG3006 easting-679200; Y=northing-6626160; Z=RH2000-16.
One Blender unit is one metre. The map plane at Z=0 is a flat reference at chosen
datum RH2000 16m, not ground, floor or terrain. Laser heights retain their source
vertical reference. The 2021-04-17 laser is older than the 2025 orthophoto.

For app export, use the actual Johannesberg runtime bridge. Its legacy frame uses
x=(lon-18.19202)*(111320*cos(59.72733 degrees)), z=(59.72733-lat)*111320,
after projecting EPSG3006 to WGS84. Its world y=RH2000+5.6676; geodata retains
absolute RH2000. The GPK1 header rounds the longitude scale to 56118.16. The
current vertical offset is an estimated registration step, not a new survey.
A simple axis swap loses projection convergence and scale. Wall lines, eaves
and floor levels remain to be surveyed
or reconciled across the dated sources; inherited footprint boxes are not wall
measurements. Clubhouse, manor and hotel annexes are separate facilities.

Priority: reconcile the clubhouse front/side/rear photographs against its 2025
roof plan; model its gables, central balcony, dormers, lower annex, terrace and
sloping-ground rear floor. Establish wall/eave/ridge dimensions from corroborated
evidence before detail. Then model estate buildings and range/parking/access.
2018 clubhouse photos predate the reported 2025 renovation; the 2024 rear view is
also historical. Preserve unknown facades and uncertain facility roles as gaps.
'''
    spec = {'schemaVersion': 1, 'date': DATE,
            'sceneName': f'Johannesberg | Facilities reference {DATE}',
            'blendPath': f'johannesbergbuild/cache/facilities-reference/johannesberg-facilities-reference-{DATE}.blend',
            'reportPath': 'johannesbergbuild/facilities/blender-reference-validation.json',
            'previewPaths': {'site': 'johannesbergbuild/cache/facilities-reference/blender-site-plan.png',
                             'photos': 'johannesbergbuild/cache/facilities-reference/blender-photo-board.png'},
            'originEPSG3006': [679200, 6626160], 'heightOriginRh2000M': 16,
            'heightNote': 'Flat plan datum at chosen RH2000 16m; not terrain or floor elevation.',
            'inputs': sorted(inputs.values(), key=lambda x: x['path']),
            'orthophotos': [{**p, 'pixelSizeMetres': p['pixelResolutionMetres']} for p in panel_index['panels']
                           if p['id'] in ('facilities-hub-native', 'range-full-context-080m')],
            'outlines': outlines, 'points': location_points, 'photos': photos,
            'pointCloud': {'path': combined_path, 'captureDate': '2021-04-17'}, 'readme': readme}
    write(PUBLIC / 'blender-reference-spec.json', spec)

    cards = []
    thumb_dir = CACHE / 'thumbnails'
    thumb_dir.mkdir(exist_ok=True)
    for p in photos:
        thumb = thumb_dir / (p['id'] + '.jpg')
        with Image.open(ROOT / p['path']) as img:
            img.thumbnail((960, 720))
            img.convert('RGB').save(thumb, quality=88)
        terms = ' '.join([p['id'], p['title'], *p.get('facilityIds', []), *p.get('sourceBuildingIds', [])])
        cards.append(f'''<article class="card" data-search="{escape(terms.lower())}">
<a href="{link(p['path'])}"><img loading="lazy" src="{link(relative(thumb))}" alt="{escape(p['title'])}"></a>
<h3>{escape(p['title'])}</h3><p>{escape(p['id'])}</p>
<p>{escape(', '.join(p.get('facilityIds', [])))}</p>
<p>Capture: {escape(p.get('captureDate') or 'unknown')} · {p['width']} × {p['height']} px</p>
<p>{escape(p.get('captureDateEvidence', ''))}</p>
<p>{escape(p.get('modellingNotes', ''))}</p>
<p><a href="{escape(p['pageUrl'])}">Publisher page</a> · <a href="{escape(p['sourceUrl'])}">Original source</a></p>
<p class="muted">Reference only · image reuse permission not established</p></article>''')
    rows = []
    for f in buildings:
        p = next(p for p in panel_index['panels'] if p['id'] == f['roofEvidence']['nativePanelId'])
        h = heights[f['sourceBuildingId']]
        d = f['geometry']['dimensionsM']
        candidates = h['roofCandidates']
        rows.append(f'''<tr data-search="{escape((f['id']+' '+f['sourceBuildingId']+' '+f['label']+' '+f['role']).lower())}">
<td>{f['modelBuildingIndex']}</td><td>{escape(f['label'])}<br><small>{escape(f['sourceBuildingId'])}</small></td>
<td>{escape(f['role'])}<br><small>{escape(f['roleEvidence']['kind'])}</small></td>
<td>{d['longAxis']} × {d['shortAxis']} m</td>
<td><a href="{link(p['path'])}">Native crop</a></td>
<td>{candidates['points']} candidate returns<br><small>{escape(h['confidence'])}</small></td>
<td>{escape(f['roofEvidence']['observation'])}</td></tr>''')
    gaps = ''.join('<li>' + escape(x) + '</li>' for x in web['coverageGaps'])
    context_rows = ''.join('<tr><td>' + escape(f['label']) + '</td><td>' + escape(f['geometry']['kind']) +
                           '</td><td>' + escape(f['geometryStatus']) + '</td></tr>' for f in site.get('contextFeatures', []))
    range_panel = next(p for p in panel_index['panels'] if p['id'] == 'range-full-context-080m')
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Johannesberg facilities · modelling references</title><style>
*{box-sizing:border-box}body{margin:0;background:#111c18;color:#e4eee9;font:16px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:auto;padding:32px}h1{font-size:34px;margin-bottom:8px}h2{margin-top:36px}
a{color:#8fd9c4}p{max-width:100ch}small,.muted{color:#b4c4bc}input{width:100%;padding:14px;border:1px solid #527769;border-radius:8px;background:#20372c;color:white;font:inherit}
.hero{width:100%;max-height:1000px;object-fit:contain;background:#080e0b}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px}
.card{background:#1c2d24;border-radius:10px;overflow:hidden;padding:14px}.card img{width:100%;height:210px;object-fit:contain;background:#0c1610}.card h3{font-size:19px;margin-bottom:6px}
.card p{font-size:14px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #395143;vertical-align:top}
.scroll{overflow-x:auto}nav{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}.notice{background:#2c3826;border-left:4px solid #b2c06c;padding:14px}[hidden]{display:none!important}
</style><main>'''
    page += f'''<h1>Johannesberg facilities</h1><p>Modelling reference pack · {DATE} · {len(buildings)} buildings · {len(web['photos'])} selected exterior photographs</p>
<nav><a href="{link(spec['blendPath'])}">Open Blender reference file</a><a href="#site">Site plan</a><a href="#inventory">Building inventory</a><a href="#photos">Photo references</a><a href="../../facilities/README.md">Modelling brief</a></nav>
<p class="notice">Prepared references, not completed architecture. Orthophoto: 14 June 2025, 16 cm/pixel. Laser: 17 April 2021. Amber outlines and dimensions come from inherited footprints; wall, eave and ridge measurements remain unverified. Photos are reference-only.</p>
<label for="filter">Filter by building name, source ID or photo role</label><input id="filter" type="search" placeholder="Try clubhouse, range, manor or w296165896">
<h2 id="site">Georeferenced site overview</h2><a href="{link(hub['path'])}"><img class="hero" src="{link(panel_index['overview']['path'])}" alt="Native facility orthophoto with numbered building outlines"></a>
<p>EPSG:3006 outer bounds: {escape(hub['boundsEPSG3006'])}. Grid north is up. Number labels match the table. Click to inspect the unmarked native image.</p>
<h2 id="inventory">Building inventory</h2><p>Dimensions are oriented bounding boxes of inherited footprints, not measured facade lengths. Laser counts describe unclassified roof candidates, which may include vegetation.</p>
<div class="scroll"><table><thead><tr><th>No.</th><th>Building</th><th>Role evidence</th><th>Footprint box</th><th>Orthophoto</th><th>2021 laser</th><th>Roof observation</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<h2>Practice, parking and access context</h2><p><a href="{link(range_panel['path'])}">Complete driving-range context (0.8 m/pixel)</a>. The terrace is a location pin; no boundary has been inferred.</p><table><thead><tr><th>Feature</th><th>Geometry</th><th>Evidence status</th></tr></thead><tbody>{context_rows}</tbody></table>
<h2 id="photos">Exterior photos and official site maps</h2><p>Open a photo for its original resolution. Publication and HTTP modification dates are not substituted for capture dates.</p><div class="grid">{''.join(cards)}</div>
<h2>Remaining evidence gaps</h2><ul>{gaps}</ul>
<p>For evidence provenance and detailed height limitations, see <a href="../../facilities/site-inventory.json">site inventory</a>, <a href="../../facilities/web-reference-sources.json">photo ledger</a> and <a href="../../facilities/roof-height-evidence.md">laser review</a>.</p>
<script>document.querySelector('#filter').addEventListener('input',e=>{{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('[data-search]').forEach(el=>el.hidden=!el.dataset.search.includes(q));}});</script></main></html>'''
    (CACHE / 'index.html').write_text(page, encoding='utf-8', newline='\n')
    report = {'passed': True, 'date': DATE, 'buildings': len(buildings), 'siteFeatures': len(site.get('contextFeatures', [])),
              'nativePanels': sum(p['pixelResolutionMetres'] == .16 for p in panel_index['panels']),
              'contextPanels': sum(p['pixelResolutionMetres'] != .16 for p in panel_index['panels']), 'selectedExteriorPhotos': len(web['photos']),
              'documents': len(web['documents']), 'blenderPhotoBoards': len(photos), 'laserVertices': len(points),
              'pinnedInputs': len(inputs), 'specPath': relative(PUBLIC / 'blender-reference-spec.json'),
              'specSha256': digest(relative(PUBLIC / 'blender-reference-spec.json')),
              'galleryPath': relative(CACHE / 'index.html'), 'gallerySha256': digest(relative(CACHE / 'index.html')),
              'heightJoinComplete': True, 'imageDimensionsAndMapScaleVerified': True, 'architectureCompleted': False}
    write(PUBLIC / 'reference-pack-validation.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
