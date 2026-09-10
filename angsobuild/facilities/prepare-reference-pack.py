"""Pin Ängsö reference inputs and assemble a portable local browsing gallery."""
import hashlib
from html import escape
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / 'angsobuild/cache/facilities-2026-09-10'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def local_link(path):
    return Path(path).relative_to(relative(CACHE)).as_posix()


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def main():
    ortho_path = HERE / 'orthophoto-reference.json'
    photo_path = HERE / 'photo-sources.json'
    ortho = json.loads(ortho_path.read_text(encoding='utf-8'))
    photo_data = json.loads(photo_path.read_text(encoding='utf-8'))
    assert ortho['outlines'], 'Wait for reviewed roof/site outlines'
    assert photo_data['photos'], 'Wait for reviewed photographs'
    paths = {relative(ortho_path), relative(photo_path)}
    catalogues = [relative(ortho_path), relative(photo_path)]
    photos = []
    sources = {s['id']: s for s in photo_data.get('sources', [])}
    for source in sources.values():
        if source.get('local') and (ROOT / source['local']).is_file():
            paths.add(source['local'])
    for item in photo_data['photos']:
        path = item['local']
        with Image.open(ROOT / path) as img:
            width, height = img.size
        if item.get('sha256'):
            assert sha(ROOT / path) == item['sha256']
        assert item.get('observations'), 'Unreviewed photo: ' + item['id']
        paths.add(path)
        source_urls = [sources[s]['url'] for s in item.get('sourceIds', []) if s in sources]
        photos.append({**item, 'path': path, 'width': width, 'height': height,
                       'sourceUrl': item['url'], 'sourcePages': source_urls,
                       'captureDate': item.get('captureDate') or 'unknown',
                       'not_a_runtime_texture': True})
    for item in ortho['orthophotos']:
        paths.add(item['path'])
        assert sha(ROOT / item['path']) == item['sha256']
    outlines = list(ortho['outlines'])
    outlines.extend({**item, 'kind': 'inherited-building'} for item in ortho.get('existingModelContext', [])
                    if item.get('ringEPSG3006'))
    laser_clouds = []
    roof_support = []
    height_origin = 0
    height_path = HERE / 'height-reference.json'
    if height_path.exists():
        height_data = json.loads(height_path.read_text(encoding='utf-8'))
        height_origin = height_data.get('blenderFrame', {}).get('originHeightRH2000', 0)
        catalogues.append(relative(height_path))
        paths.add(relative(height_path))
        for acquisition_path in sorted((CACHE / 'laser').glob('**/acquisition.json')):
            acquisition = json.loads(acquisition_path.read_text(encoding='utf-8'))
            point_path = acquisition['localPointsPath']
            assert sha(ROOT / point_path) == acquisition['localPointsSha256']
            paths.add(point_path)
            paths.add(relative(acquisition_path))
            laser_clouds.append({'id': acquisition.get('windowId', acquisition_path.parent.name)+'-laser',
                                 'path': point_path, 'sourceUrl': acquisition['sourceUrl'],
                                 'sourceId': acquisition['sourceId'], 'captureStart': acquisition.get('captureStart'),
                                 'captureEnd': acquisition.get('captureEnd'), 'verticalDatum': 'RH2000',
                                 'attribution': acquisition['attribution'], 'licence': acquisition['licence']})
        for item in height_data.get('roofSupport', []):
            roof_support.append(item)
    readme = '''ANGSO / FACILITY MODELLING REFERENCES / 2026-09-10
Metre units. X east, Y grid north, Z up. EPSG:3006 origin E605530 N6605140.
Z for the laser is RH2000 minus the recorded height origin; map planes use a
separate arbitrary flat display datum. Do not infer terrain heights from the map.
Disable the image planes before inspecting the 3D laser/roof supports, which
may fall below the flat image datum. The height origin is stored on the scene.
The reference collection is not a finished architectural model or a runtime GLB.
Orthophotos: Lantmateriet, captured 2025-04-24, native pixel spacing 0.16 m.
The broad overview is 0.8 m. Pixel spacing is not positional survey accuracy.
Cyan curves are manually observed image roof edges, not ground-wall surveys.
Green curves identify visible site features; amber inherited app geometry is
hidden by default. Enable that collection to compare the existing approximation.
Use the campus/detail/range/northern cameras and Material Preview or Rendered
shading to see packed reference imagery. Photo/document boards lie east of the
campus. Source links, visible details and evidence gaps are object properties.
The official site diagram is semantic evidence, not a scale map. Generated
illustrations are excluded from architectural evidence. Photo upload dates are
not camera dates. Named facilities follow the club's published information.
Laser returns, when included, retain original coordinates and classification in
separate hidden collections. Class 1 is unclassified, not a building class.
The 2021 laser predates 2025 imagery and subsequent changes. Height statistics
and planar studies are evidence, not certified roof ridges or eaves.
The proposed studio/covered range was announced 2025-12-04 for an autumn 2026
project start. Proposed drawings do not establish a completed building.
Read the packed catalogues and angsobuild/facilities/README.md for reconstruction
priorities, coverage gaps and the full coordinate conversion back to the app.
'''
    spec = {
        'schemaVersion': 1, 'date': '2026-09-10',
        'sceneName': 'Angso | Facility references 2026-09-10',
        'originEPSG3006': ortho['originEPSG3006'], 'heightOriginRh2000M': height_origin,
        'orthophotos': ortho['orthophotos'], 'outlines': outlines,
        'photos': photos, 'laserClouds': laser_clouds, 'roofSupport': roof_support,
        'catalogues': catalogues, 'defaultPanel': 'campus-native',
        'blendPath': relative(CACHE / 'angso-facility-references.blend'),
        'previewPath': relative(CACHE / 'blender-campus-preview.png'),
        'readme': readme,
        'inputs': [{'path': path, 'sha256': sha(ROOT / path)} for path in sorted(paths)],
    }
    write(HERE / 'blender-reference-spec.json', spec)
    cards = []
    for panel in spec['orthophotos']:
        plain = local_link(panel['path'])
        overlay = plain.replace('.png', '-overlay.png')
        shown = overlay if (CACHE / overlay).exists() else plain
        cards.append(f'''<article data-kind="plan"><p class="eyebrow">ORTHOPHOTO / {panel['captureDate']}</p>
<h2>{escape(panel['id'])}</h2><a href="{shown}"><img loading="lazy" src="{shown}" alt="{escape(panel['id'])} georeferenced orthophoto"></a>
<p>{panel['pixelSizeM']} m/pixel · {panel['width']} × {panel['height']} px · EPSG:3006</p>
<p><a href="{plain}">Original crop</a> · <a href="{overlay}">Traced overlay</a> · <a href="{local_link(panel['rasterPath'])}">GeoTIFF</a> · <a href="{local_link(panel['worldFilePath'])}">World file</a></p></article>''')
    for item in photos:
        path = local_link(item['path'])
        date_label = ('DOCUMENT '+str(item['documentDate'])) if item.get('documentDate') else 'CAPTURE '+str(item['captureDate'])
        observations = ''.join('<li>'+escape(str(value))+'</li>' for value in item['observations'])
        gaps = '; '.join(str(v) for v in item.get('gaps', []))
        urls = ' · '.join(f'<a href="{escape(url, quote=True)}">Source page {i+1}</a>' for i, url in enumerate(item['sourcePages']))
        cards.append(f'''<article data-kind="photo"><p class="eyebrow">{escape(item.get('kind','photograph').upper())} / {escape(date_label)}</p>
<h2>{escape(item['id'])}</h2><a href="{path}"><img loading="lazy" src="{path}" alt="{escape(item['id'])}"></a>
<ul>{observations}</ul><p class="muted">Limits: {escape(gaps)}</p><p>{urls} · <a href="{escape(item['sourceUrl'],quote=True)}">Original</a></p></article>''')
    rows = ''.join(f'<tr><td>{escape(item["id"])}</td><td>{escape(item.get("label", ""))}</td><td>{escape(item["kind"])}</td><td>{escape(str(item.get("notes", "")))}</td></tr>' for item in spec['outlines'])
    documents = ''.join(f'<li><a href="{local_link(source["local"])}">{escape(source["id"])}</a> · <a href="{escape(source["url"],quote=True)}">Original source</a></li>'
                        for source in sources.values() if source.get('local', '').lower().endswith('.pdf'))
    html = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ängsö · Facility reference library</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font:16px/1.55 system-ui,sans-serif;background:#101c17;color:#e7efe9;max-width:1500px;margin:auto;padding:30px}h1{font-size:clamp(32px,5vw,54px);line-height:1.1;margin:16px 0}h2{font-size:20px;line-height:1.3}.intro{max-width:950px}.eyebrow{font-size:12px;letter-spacing:.1em;color:#a6cfb8}.muted{color:#c2cfc6}a{color:#a7e6c2;text-underline-offset:3px}.links{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.links a,button{background:#294a39;padding:10px 15px;border-radius:7px;border:1px solid #466c55;color:#e9f4ed}.toolbar{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;background:#101c17ed;padding:15px 0;z-index:1}input{font:inherit;flex:1;min-width:220px;background:#203328;color:inherit;border:1px solid #52715e;border-radius:6px;padding:10px}button{font:inherit;cursor:pointer}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:22px}article{padding:20px;background:#20362a;border:1px solid #3a5243;border-radius:12px}img{width:100%;height:350px;object-fit:contain;background:#14221a}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #425547;padding:10px;vertical-align:top}details{margin:24px 0}summary{cursor:pointer;font-size:20px}[hidden]{display:none!important}footer{margin:35px 0;color:#adbbb1}</style></head><body>
<p class="eyebrow">ÄNGSÖ GOLFKLUBB / RECONSTRUCTION EVIDENCE / 10 SEPTEMBER 2026</p>
<h1>Buildings, courtyard & facilities</h1>
<p class="intro">A source-linked modelling library with native orthophotos, observed roof outlines, real photographs, site documents and laser evidence. Each reference keeps its date and limitations. Open the packed Blender workspace to work in metres.</p>
<p class="intro muted">The 2025 aerial imagery and 2021 laser describe different dates. Roof image edges can differ from ground walls. The planned studio and covered range require construction verification. Finished architectural meshes remain to be authored.</p>
<nav class="links"><a href="angso-facility-references.blend">Blender workspace</a><a href="../../facilities/README.md">Modelling brief</a><a href="../../facilities/photo-sources.json">Photo & document sources</a><a href="../../facilities/orthophoto-reference.json">Georeferenced inventory</a><a href="blender-campus-preview.png">Blender preview</a></nav>
<div class="toolbar"><input id="search" aria-label="Filter references" placeholder="Filter by facility, material or reference ID…"><button data-filter="all">All</button><button data-filter="plan">Plans</button><button data-filter="photo">Photos & documents</button><span id="count" aria-live="polite"></span></div>
<details><summary>Original PDF documents and full proposal drawings</summary><ul>'''+documents+'''</ul></details>
<main>'''+''.join(cards)+'''</main><details><summary>Observed outlines and facility inventory</summary><div style="overflow:auto"><table><thead><tr><th>ID</th><th>Feature</th><th>Evidence type</th><th>Notes</th></tr></thead><tbody>'''+rows+'''</tbody></table></div></details>
<footer>Orthophoto attribution and original source records are retained in the inventory. Web images are modelling references; no redistribution grant or runtime texture use is implied. Generated illustrations were excluded.</footer>
<script>let category='all';const input=document.querySelector('#search'),cards=[...document.querySelectorAll('article')];function filter(){let visible=0;for(const card of cards){card.hidden=!((category==='all'||card.dataset.kind===category)&&card.textContent.toLowerCase().includes(input.value.toLowerCase()));if(!card.hidden)visible++}document.querySelector('#count').textContent=visible+' references'}input.addEventListener('input',filter);document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.filter;filter()}));filter();</script></body></html>'''
    (CACHE / 'index.html').write_text(html, encoding='utf-8')
    print(json.dumps({'orthophotos': len(spec['orthophotos']), 'photoDocumentBoards': len(photos),
                      'outlines': len(spec['outlines']), 'laserClouds': len(laser_clouds),
                      'roofSupport': len(roof_support), 'pinnedInputs': len(paths)}))


if __name__ == '__main__':
    main()
