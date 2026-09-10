"""Join source catalogues into a pinned Blender specification and local gallery."""
import hashlib
from html import escape
import json
import os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'puttombuild/facilities'
CACHE = ROOT / 'puttombuild/cache/facilities-reference-2026-09-10'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path):
    return path.relative_to(ROOT).as_posix()


def local_link(path):
    return os.path.relpath(ROOT/path, CACHE).replace('\\', '/')


def main():
    ortho = read(HERE/'orthophoto-reference.json')
    inventory = read(HERE/'facility-inventory.json')
    web = read(HERE/'web-reference.json')
    heights = read(HERE/'height-reference.json')
    catalogues = [rel(HERE/name) for name in ['orthophoto-reference.json', 'facility-inventory.json',
                                           'web-reference.json', 'height-reference.json']]
    paths = set(catalogues)
    panels = []
    cards = []
    for p in ortho['panels']:
        assert sha(ROOT/p['png']) == p['pngSha256']
        assert sha(ROOT/p['tif']) == p['tifSha256']
        paths.update(p[k] for k in ('png', 'tif', 'worldfile', 'projectionFile'))
        panels.append({'id': p['id'], 'path': p['png'], 'boundsEPSG3006': p['boundsEpsg3006'],
                       'captureDate': ortho['captureDate'], 'pixelSizeMetres': p['pixelSizeMetres'],
                       'attribution': ortho['attribution']})
        overlay = p.get('reviewOverlay') or p.get('reviewedOverlay') or p.get('observedOverlay') or p.get('inheritedOverlay') or p['png']
        paths.add(overlay)
        cards.append({'type': 'orthophoto', 'id': p['id'], 'title': p['id'].replace('-', ' ').title(),
                      'path': overlay, 'description': f"{ortho['captureDate']} · {p['pixelSizeMetres']} m/pixel · EPSG:3006. Roof edges are plan observations, not surveyed wall footprints.",
                      'links': [('Plain image', local_link(p['png'])), ('GeoTIFF', local_link(p['tif'])),
                                ('World file', local_link(p['worldfile']))]})
    photos = []
    for p in web['photos']:
        path = p['localPath']
        assert sha(ROOT/path) == p['sha256'], 'Changed photograph: '+path
        with Image.open(ROOT/path) as image:
            width, height = image.size
        paths.add(path)
        photo = {'id': p['id'], 'path': path, 'width': width, 'height': height,
                 'sourceUrl': p.get('originalImageUrl') or p.get('sourceUrl'), 'pageUrl': p['pageUrl'],
                 'captureDate': p.get('captureDate') or 'unknown',
                 'rights': p.get('rights', 'Reference only; no redistribution grant established'),
                 'observations': p.get('visualReview') or p.get('observations'),
                 'facilityIds': p.get('facilityIds') or p.get('facilities', []),
                 'referenceMetadata': p}
        assert photo['sourceUrl'] and photo['observations']
        photos.append(photo)
        review = photo['observations']
        description = review if isinstance(review, str) else ' '.join(review.get('observations', [])) if isinstance(review, dict) else ' '.join(review)
        description = 'Captured '+(p.get('captureDate') or 'date unknown')+'. ' + (p.get('captureDateNote') or '') + ' ' + description
        cards.append({'type': 'photo', 'id': p['id'], 'title': p.get('title') or p['id'].replace('-', ' ').title(),
                      'path': path, 'description': description,
                      'links': [('Source page', photo['pageUrl']), ('Original image', photo['sourceUrl'])]})
    outlines = []
    w, s, e, n = panels[0]['boundsEPSG3006']
    for f in inventory['facilities']:
        center = f['centerEpsg3006']
        if not (w <= center[0] <= e and s <= center[1] <= n):
            continue
        inherited = f.get('inheritedModel')
        if inherited:
            outlines.append({'id': 'existing-'+f['id'], 'label': '', 'kind': 'inherited-building',
                             'ringEPSG3006': inherited['ringEpsg3006'], 'evidence': inherited})
    for observed in inventory['roofObservations']:
        outlines.append({'id': observed['id'], 'label': observed.get('shortLabel') or observed['id'].replace('roof-', ''),
                         'kind': 'observed-roof', 'ringEPSG3006': observed['ringEpsg3006'],
                         'evidence': observed})
    points = []
    for f in inventory.get('nonBuildingFacilities', []):
        ring = f.get('ringEpsg3006') or f.get('lineEpsg3006')
        if ring:
            outlines.append({'id': 'site-'+f['id'], 'label': f.get('shortLabel', ''),
                             'kind': 'site', 'ringEPSG3006': ring, 'evidence': f,
                             'closed': not bool(f.get('lineEpsg3006'))})
        for index, point in enumerate(f.get('pointsEpsg3006', [])):
            points.append({'id': f['id']+'-'+str(index+1), 'pointEPSG3006': point,
                           'label': str(index+1), 'evidence': f})
    point_path = 'puttombuild/cache/facilities-reference-2026-09-10/laser/points.json'
    paths.add(point_path)
    paths.add('puttombuild/cache/facilities-reference-2026-09-10/laser/acquisition.json')
    for filename, title in [('height-overview.png', 'Laser ground and elevated returns'),
                            ('roof-plane-review.png', 'Roof plane support review')]:
        path = rel(CACHE/'laser'/filename)
        if (ROOT/path).exists():
            paths.add(path)
            cards.append({'type': 'laser', 'id': filename, 'title': title, 'path': path,
                          'description': 'June 2023 laser evidence. Plane fits describe sampled support; they do not establish wall footprints, roof overhangs or entrance thresholds.',
                          'links': [('Height evidence catalogue', '../../facilities/height-reference.json')]})
    height_origin = heights['blenderFrame']['originHeightRH2000']
    readme = f'''PUTTOM / FACILITY MODELLING REFERENCES / 2026-09-10
Metres: X east, Y grid north, Z up. EPSG:3006 origin E697365 N7025190.
Laser Z = RH2000 height minus {height_origin} m. Map images lie on a flat plan datum.
June 2024 orthophotos have 0.16 m pixel spacing; this is not absolute survey accuracy.
June 2023 laser returns are separate evidence, older than the aerial image campaign.
CYAN: observed image roof edges. AMBER: inherited app building outlines.
GREEN: site context; inspect each object's source status before using it as a measurement.
Roof overhang and relief displacement mean image roof edges are not wall footprints.
Laser collection is hidden initially; enable it to inspect vertices and classification.
Class 1 is unclassified, not an automatic building classification.
Photo boards lie east of the map. Choose Photograph camera to inspect them together.
Source URLs, dates, confidence and observations are on objects and embedded catalogues.
The 2018 clubhouse photo shows an end section of two-level glazing along the long facade,
a tiled-looking brown roof and a brick chimney; the existing glazed-gable-only model
is insufficient. Check more recent images before fixing materials and elevations.
This scene supplies reconstruction references. Finished building meshes and runtime
replacement exports have not been produced. Hidden facades and exact openings need
additional evidence. Nearby houses are not automatically club-owned facilities.
Return geometry to the legacy frame through inverse EPSG:3006 projection, followed by
x=(lon-18.9413)*50019.58 and z=(63.2992-lat)*111320. Never merely add local offsets.
See puttombuild/facilities/README.md and the four embedded source catalogues.
'''
    spec = {'schemaVersion': 1, 'sceneName': 'Puttom | Facility references 2026-09-10',
            'originEPSG3006': [697365, 7025190], 'heightOriginRh2000M': height_origin,
            'catalogues': catalogues, 'inputs': [{'path': p, 'sha256': sha(ROOT/p)} for p in sorted(paths)],
            'orthophotos': panels, 'photos': photos, 'outlines': outlines, 'points': points,
            'pointCloud': {'path': point_path, 'captureCampaign': '2023-06',
                           'source': 'Lantmäteriet Laserdata Nedladdning Skog',
                           'heightNote': 'Class 1 is unclassified; class 2 is ground. Cloud retained as original evidence.'},
            'roofStudies': [], 'readme': readme,
            'blendPath': rel(CACHE/'puttom-facility-references.blend'),
            'previewPath': rel(CACHE/'blender-site-preview.png'),
            'renders': {'Site plan camera': rel(CACHE/'blender-site-preview.png'),
                        'clubhouse-courtyard camera': rel(CACHE/'blender-clubhouse-preview.png'),
                        'Photograph camera': rel(CACHE/'blender-photo-preview.png')}}
    (HERE/'blender-reference-spec.json').write_text(json.dumps(spec, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    articles = []
    for c in cards:
        links = ' · '.join(f'<a href="{escape(url, quote=True)}">{escape(label)}</a>' for label, url in c['links'])
        articles.append(f'<article data-type="{c["type"]}" data-search="{escape(c["title"]+" "+c["description"], quote=True)}"><h2>{escape(c["title"])}</h2><a href="{escape(local_link(c["path"]), quote=True)}"><img loading="lazy" src="{escape(local_link(c["path"]), quote=True)}" alt="{escape(c["title"], quote=True)}"></a><p>{escape(c["description"])}</p><footer>{links}</footer></article>')
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Puttom facility references</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#14211c;color:#e7efe9;font:16px/1.5 system-ui}header,nav,main{max-width:1480px;margin:auto;padding:24px}header{padding-top:45px}h1{font-size:38px;margin:0 0 12px}header p{max-width:940px;color:#bed0c5}a{color:#a2e1be}nav{display:flex;gap:12px;position:sticky;top:0;background:#14211cf5;z-index:2;padding-top:12px;padding-bottom:12px}input,select{padding:12px;border:1px solid #4a6556;border-radius:7px;background:#21352a;color:inherit;font:inherit}input{flex:1;min-width:100px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,410px),1fr));gap:22px}article{background:#21352a;border:1px solid #385041;border-radius:10px;padding:18px;overflow:hidden}article[hidden]{display:none}h2{font-size:20px;margin:0 0 14px}img{display:block;width:100%;height:340px;object-fit:contain;background:#111b16}article p{font-size:14px;color:#c6d6cc;overflow-wrap:anywhere}footer{font-size:14px} .links{display:flex;gap:20px;flex-wrap:wrap}small{color:#b6c7bb}</style>
<header><small>ÖRNSKÖLDSVIKS GOLFKLUBB · PUTTOM · 10 SEPTEMBER 2026</small><h1>Clubhouse & facility references</h1>
<p>Measured aerial plans, original laser evidence and real exterior photographs for reconstruction in Blender. Use the dated source records to distinguish observed geometry, inherited outlines and missing detail.</p>
<div class="links"><a href="puttom-facility-references.blend">Blender workspace</a><a href="../../facilities/README.md">Modelling brief</a><a href="../../facilities/facility-inventory.json">Facility inventory</a><a href="../../facilities/height-reference.json">Laser height evidence</a></div>
<p>Cyan outlines follow observed roof edges. Amber shows existing app outlines. Site context is magenta in the image overlays and green in Blender. Individual confidence and source status are recorded in the inventory.</p>
<p>Orthophoto: © Lantmäteriet, processed information, CC BY 4.0. Web photos are local modelling references; reuse rights are recorded individually.</p></header>
<nav aria-label="Reference filters"><input id="search" type="search" placeholder="Search clubhouse, range, roof, maintenance…" aria-label="Search references"><select id="kind" aria-label="Reference type"><option value="">All references</option><option value="orthophoto">Orthophotos</option><option value="photo">Photographs</option><option value="laser">Laser evidence</option></select><span id="count" aria-live="polite"></span></nav><main>'''+''.join(articles)+'''</main><script>
const search=document.querySelector('#search'),kind=document.querySelector('#kind'),cards=[...document.querySelectorAll('article')];function filter(){let count=0;for(const card of cards){card.hidden=Boolean((kind.value&&card.dataset.type!==kind.value)||!card.dataset.search.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));if(!card.hidden)count++}document.querySelector('#count').textContent=count+' references'}search.addEventListener('input',filter);kind.addEventListener('change',filter);filter();</script></html>'''
    (CACHE/'index.html').write_text(html, encoding='utf-8')
    for c in cards:
        assert (ROOT/c['path']).exists()
    report = {'passed': True, 'pinnedInputs': len(paths), 'orthophotos': len(panels), 'photos': len(photos),
              'outlines': len(outlines), 'localImageLinksValid': True, 'sourceHashesVerified': True,
              'gallery': rel(CACHE/'index.html')}
    (HERE/'reference-pack-validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
