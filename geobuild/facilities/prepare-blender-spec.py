"""Join reviewed imagery and exterior evidence into the Blender reference spec."""
import hashlib
from html import escape
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT/'geobuild/facilities'
CACHE = ROOT/'geobuild/cache/facilities-2026-09-10'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    inventory = json.loads((HERE/'inventory.json').read_text(encoding='utf-8'))
    source_photos = json.loads((HERE/'photo-sources.json').read_text(encoding='utf-8'))
    assert inventory['features'], 'Wait for reviewed geometry'
    assert all(p['visualReview'] for p in source_photos['photos']), 'Wait for photo review'
    paths = {'geobuild/facilities/inventory.json', 'geobuild/facilities/photo-sources.json'}
    orthos=[]
    for panel in inventory['panels']:
        paths.add(panel['imagePath'])
        orthos.append({'id':panel['id'], 'path':panel['imagePath'],
                       'boundsEPSG3006':panel['boundsEPSG3006'], 'captureDate':'2024-06-27',
                       'pixelSizeMetres':panel['resolutionMetres']})
    assert orthos[0]['id']=='facility-overview'
    photos=[]
    for photo in source_photos['photos']:
        path=ROOT/photo['localPath']
        assert digest(path)==photo['sha256'], path
        paths.add(photo['localPath'])
        photos.append({'id':photo['id'], 'path':photo['localPath'],
                       'width':photo['dimensionsPx'][0], 'height':photo['dimensionsPx'][1],
                       'sourceUrl':photo['originalImageUrl'], 'pageUrl':photo['pageUrl'],
                       'captureDate':photo['cameraDateFromExif'] or 'unknown', 'rights':photo['rights']})
    outlines=[]
    for f in inventory['features']+inventory['existingModelContext']:
        if not f.get('ringEPSG3006'):
            continue
        outlines.append({'id':f['id'], 'label':f['label'], 'kind':f['kind'],
                         'reviewed':f['geometryStatus'].startswith('reviewed-'),
                         'geometryStatus':f['geometryStatus'], 'ringEPSG3006':f['ringEPSG3006'],
                         'identificationStatus':f['identificationStatus'],
                         'sourcePanelId':f['sourcePanelId'], 'notes':f['notes']})
    notes='''VECKEFJARDEN GC / FACILITY MODELING REFERENCES / 2026-09-10
This is a reference scene, not a finished building model.
All map geometry uses metres: X east, Y grid north, Z up.
Origin EPSG:3006 E684390 N7023040. Z=0 is an arbitrary flat plan datum.
No terrain, wall-base, eaves, ridge height or roof pitch has been established here.
Orthophotos: Lantmateriet 2024-06-27, native source 0.16 m; overview resampled.
Pixel spacing is not absolute survey accuracy. Roof edges are not wall footprints.
Cyan outlines: manually reviewed image edges. Amber: existing model comparison.
Photo boards lie east of the mapped area; inspect using Material Preview/Rendered.
Select a detail camera for a close plan view. Names match inventory.json IDs.
Photos have source URLs in custom properties. They are modeling references only.
Each camera date is unknown unless stated; upload date is not capture date.
The current application/course models have not been modified by this reference work.
For exports to the legacy app, use full inverse projection; do not merely swap axes.
See geobuild/facilities/README.md and inventory.json for gaps and coordinate conversion.
'''
    spec={'schemaVersion':1, 'date':'2026-09-10', 'sceneName':'Veckefjarden | Facility references 2026-09-10',
          'originEPSG3006':[inventory['frame']['originE'],inventory['frame']['originN']],
          'inputs':[{'path':p,'sha256':digest(ROOT/p)} for p in sorted(paths)],
          'orthophotos':orthos, 'photos':photos, 'outlines':outlines,
          'blendPath':'geobuild/cache/facilities-2026-09-10/veckefjarden-facility-references.blend',
          'previewPath':'geobuild/cache/facilities-2026-09-10/blender-site-preview.png',
          'reportPath':'geobuild/facilities/blender-build-report.json', 'readme':notes}
    (HERE/'blender-reference-spec.json').write_text(json.dumps(spec,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    cards=[]
    for panel in inventory['panels']:
        relative=Path(panel['imagePath']).relative_to('geobuild/cache/facilities-2026-09-10').as_posix()
        overlay=relative.replace('.png','-overlay.png')
        image_path=overlay if (CACHE/overlay).exists() else relative
        cards.append(f'<article><h2>{escape(panel["id"])}</h2><a href="{image_path}"><img src="{image_path}"></a><p>{panel["resolutionMetres"]} m/pixel · EPSG:3006 · 2024-06-27</p><a href="{relative}">Plain orthophoto</a></article>')
    for p in source_photos['photos']:
        relative=Path(p['localPath']).relative_to('geobuild/cache/facilities-2026-09-10').as_posix()
        review=p['visualReview']
        caption=escape(review) if isinstance(review,str) else escape(review.get('view',''))+'<ul>'+''.join('<li>'+escape(item)+'</li>' for item in review.get('observations',[]))+'</ul><p>'+escape(review.get('limits',''))+'</p>'
        title=p.get('title') or ', '.join(review.get('facilities',[]))
        cards.append(f'<article><h2>{escape(p["id"])} · {escape(title)}</h2><a href="{relative}"><img loading="lazy" src="{relative}"></a><p>{caption}</p><a href="{escape(p["pageUrl"],quote=True)}">Source page</a> · <a href="{escape(p["originalImageUrl"],quote=True)}">Original photograph</a></article>')
    html='''<!doctype html><meta charset="utf-8"><title>Veckefjärden facility references</title>
<style>body{font:16px system-ui;background:#14221d;color:#eaf2ed;max-width:1400px;margin:auto;padding:30px}h1{font-size:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:22px}article{background:#21382e;padding:18px;border-radius:12px}h2{font-size:20px}img{width:100%;max-height:520px;object-fit:contain;background:#101a15}a{color:#a5e4c2}p{line-height:1.55}</style>
<h1>Veckefjärden · Facility references</h1><p>Georeferenced site plans and reviewed exterior photographs. Roof edges are plan references; physical heights remain unmeasured. Photos are reference material and have unknown capture dates unless recorded in the manifest.</p><p><a href="veckefjarden-facility-references.blend">Open Blender reference file</a> · <a href="../../facilities/README.md">Modeling brief</a></p><main>'''+''.join(cards)+'</main>'
    (CACHE/'index.html').write_text(html,encoding='utf-8')
    print(json.dumps({'panels':len(orthos),'photos':len(photos),'outlines':len(outlines),'spec':'geobuild/facilities/blender-reference-spec.json'}))


if __name__=='__main__':
    main()
