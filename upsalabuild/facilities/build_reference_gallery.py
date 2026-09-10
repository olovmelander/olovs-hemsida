"""Create an offline, searchable gallery from the reviewed facility scene spec."""
import argparse
import html
import json
import os
from pathlib import Path


def build(spec_path):
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    root = Path(spec["repoRoot"])
    output = root / spec["galleryPath"]
    esc = html.escape
    def local_link(path):
        return esc(Path(os.path.relpath(root / path, output.parent)).as_posix(), quote=True)
    cards = []
    for photo in spec["photos"]:
        image_path = local_link(photo["path"])
        cards.append(f'''<article class="card" data-kind="{esc(photo['evidenceType'], quote=True)}">
          <a href="{image_path}" target="_blank"><img src="{image_path}" loading="lazy" alt="{esc(photo.get('description',photo['id']), quote=True)}"></a>
          <div class="body"><span class="tag">{esc(photo['evidenceType'])}</span>
          <h3>{esc(photo['id'])}</h3><p>{esc(photo.get('description',''))}</p>
          <p class="meta">Capture: {esc(str(photo.get('captureDate') or 'unknown'))} · {photo['width']} × {photo['height']}</p>
          <p class="meta">{esc(photo.get('dateNote',''))}</p>
          <a href="{esc(photo['sourceUrl'],quote=True)}" target="_blank" rel="noreferrer">Source page</a>
          </div></article>''')
    rows = []
    for building in spec["footprints"]:
        rows.append(f'''<tr><td>{esc(building['id'])}</td><td>{esc(building['sourceId'])}</td>
        <td>{esc(building.get('label',''))}</td><td>{'Measured plan' if building['measured'] else 'Context outline'}</td>
        <td>{esc(building.get('evidence',''))}</td></tr>''')
    options = ''.join(f'<option value="{esc(kind,quote=True)}">{esc(kind)}</option>' for kind in sorted({p['evidenceType'] for p in spec['photos']}))
    source_image = local_link(spec["orthophoto"]["path"])
    plan_image = local_link(spec.get("annotatedMapPath", spec["orthophoto"]["path"]))
    additional_maps = ''.join(f'<details><summary>{esc(p["id"])}</summary><a href="{local_link(p["path"])}" target="_blank"><img class="map" loading="lazy" src="{local_link(p["path"])}" alt="{esc(p["id"],quote=True)}"></a></details>' for p in spec.get("additionalMapPanels", []))
    content = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Upsala GK · Facility references</title><style>
    :root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;background:#101c18;color:#ecf2ed}*{box-sizing:border-box}
    body{margin:0}main{max-width:1320px;margin:auto;padding:32px 24px}h1{font-size:clamp(28px,4vw,48px);line-height:1.1;margin:12px 0 20px}
    h2{margin:36px 0 14px}h3{font-size:17px;margin:10px 0}p{max-width:920px}a{color:#98dcbd;text-underline-offset:3px}
    .eyebrow,.meta{font-size:13px;color:#b4c8bd}.notice{border-left:3px solid #e8b77d;padding:12px 18px;background:#263127;border-radius:4px}
    .actions{display:flex;flex-wrap:wrap;gap:12px;margin:22px 0}.actions a{border:1px solid #547d65;border-radius:7px;padding:9px 15px;text-decoration:none}
    .map{width:100%;max-height:840px;object-fit:contain;background:#09110d;border-radius:10px}.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:20px 0}
    input,select{background:#1b2b23;border:1px solid #527561;border-radius:6px;color:inherit;font:inherit;padding:10px}input{flex:1;min-width:220px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}.card{background:#1a2a22;border:1px solid #314a3c;border-radius:9px;overflow:hidden}
    .card img{width:100%;height:240px;object-fit:contain;background:#0b130f}.body{padding:16px}.tag{display:inline-block;font-size:12px;background:#2f4e3b;border-radius:4px;padding:2px 7px}
    .card[hidden]{display:none}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #38513f;padding:10px;text-align:left;vertical-align:top}
    .table-wrap{overflow:auto}footer{margin-top:40px;border-top:1px solid #38513f;padding-top:20px;color:#b4c8bd}
    </style><main><div class="eyebrow">UPSALA GOLFKLUBB / HÅMÖ / 10 SEPTEMBER 2026</div>
    <h1>Clubhouse & facility reference desk</h1>'''
    content += f'''<p>Metre-scale orthophotos, building outlines, exterior photos and service-house drawings prepared for Blender. {len(spec['footprints'])} footprint records and {len(spec['photos'])} curated image boards.</p>
    <div class="notice">The orthophotos show June 2025. The service house was rebuilt in 2026. Drawings and architectural visualizations are labelled separately from photographs; capture dates remain unknown where the source does not provide them.</div>
    <div class="actions"><a href="{local_link(spec['blendPath'])}">Blender reference scene</a><a href="README.md">Modelling brief</a><a href="orthophoto-manifest.json">Orthophoto & coordinates</a><a href="web-photo-manifest.json">Photo sources</a><a href="runtime-integration.md">Course integration</a></div>
    <h2>Facility map</h2><p>Open the image for a closer look. Outlines are plan references; wall and roof heights are not inferred from this map.</p>
    <a href="{plan_image}" target="_blank"><img class="map" src="{plan_image}" alt="Numbered Uppsala clubhouse campus orthophoto"></a>
    <p><a href="{source_image}" target="_blank">Unmarked native orthophoto</a></p>{additional_maps}
    <h2>Image references</h2><div class="tools"><input id="search" type="search" aria-label="Search image references" placeholder="Search clubhouse, terrace, studio…"><select id="kind" aria-label="Evidence type"><option value="">All evidence types</option>{options}</select><span id="count" aria-live="polite"></span></div>
    <div class="grid">{''.join(cards)}</div>
    <h2>Footprint inventory</h2><div class="table-wrap"><table><thead><tr><th>Map ID</th><th>Source ID</th><th>Identity / label</th><th>Plan evidence</th><th>Limitations</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
    <footer>Source pixels are local modelling references. This package does not grant permission to redistribute photographs or turn them into game textures. The scene contains flat reference geometry; it is not a finished architectural model.</footer>
    </main><script>
    const cards=[...document.querySelectorAll('.card')],q=document.querySelector('#search'),k=document.querySelector('#kind');
    function filter(){{let n=0;for(const card of cards){{card.hidden=!(card.textContent.toLowerCase().includes(q.value.toLowerCase())&&(!k.value||card.dataset.kind===k.value));if(!card.hidden)n++;}}document.querySelector('#count').textContent=n+' of '+cards.length+' references';}}
    q.addEventListener('input',filter);k.addEventListener('change',filter);filter();
    </script></html>'''
    output.write_text(content, encoding="utf-8")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    build(parser.parse_args().spec)
