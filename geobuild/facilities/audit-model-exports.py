"""Independently inspect exported GLB bytes and compare facility bounds to Blender."""
import hashlib
from html import escape
import json
import math
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'geobuild/facilities'
audit=json.loads((HERE/'model-audit.json').read_text(encoding='utf-8'))
build=json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
assert audit['passed'] and build['passed']
for p in build['sourceInputs']:
    assert hashlib.sha256((ROOT/p['path']).read_bytes()).hexdigest()==p['sha256'],p['path']
assert hashlib.sha256((ROOT/audit['workspacePath']).read_bytes()).hexdigest()==audit['workspaceSha256']
results=[]
for export in audit['exports']:
    data=(ROOT/export['path']).read_bytes()
    assert hashlib.sha256(data).hexdigest()==export['sha256']
    assert struct.unpack_from('<4sII',data)==(b'glTF',2,len(data))
    json_length,json_type=struct.unpack_from('<II',data,12)
    assert json_type==0x4E4F534A
    doc=json.loads(data[20:20+json_length])
    bin_length,bin_type=struct.unpack_from('<II',data,20+json_length)
    assert bin_type==0x004E4942
    binary=memoryview(data)[28+json_length:]
    assert len(binary)==bin_length
    assert not doc.get('images') and not doc.get('textures')
    extras=doc['scenes'][doc.get('scene',0)]['extras']
    assert extras['origin_easting_northing']==[684390,7023040]
    assert extras['origin_height_rh2000']==30.673
    assert 'Y up, Z south' in extras['axis_contract']
    # Inspect the material correction in actual GLB bytes, not only geometry.
    main_wall=next(n for n in doc['nodes'] if n['name'].startswith('VECK MODEL | Clubhouse / main pale yellow two-storey walls'))
    west_annex=next(n for n in doc['nodes'] if n['name'].startswith('VECK MODEL | Clubhouse / west annex foundation'))
    def base_color(node):
        primitive=doc['meshes'][node['mesh']]['primitives'][0]
        return doc['materials'][primitive['material']]['pbrMetallicRoughness']['baseColorFactor']
    assert base_color(west_annex)==base_color(main_wall),'West annex cladding material correction missing'
    bounds={};vertices=triangles=0
    for node in doc['nodes']:
        assert not any(k in node for k in ['matrix','translation','rotation','scale','children']), 'Unexpected transformed node'
        fid=node['extras']['source_feature']
        box=bounds.setdefault(fid,[math.inf,math.inf,math.inf,-math.inf,-math.inf,-math.inf])
        for primitive in doc['meshes'][node['mesh']]['primitives']:
            pos=doc['accessors'][primitive['attributes']['POSITION']]
            assert pos['type']=='VEC3' and pos['componentType']==5126
            view=doc['bufferViews'][pos['bufferView']]
            offset=view.get('byteOffset',0)+pos.get('byteOffset',0)
            stride=view.get('byteStride',12)
            for i in range(pos['count']):
                x,z,minus_y=struct.unpack_from('<fff',binary,offset+i*stride)
                point=(x,-minus_y,z)
                assert all(math.isfinite(v) for v in point)
                for k,v in enumerate(point):box[k]=min(box[k],v);box[k+3]=max(box[k+3],v)
            vertices+=pos['count']
            indices=doc['accessors'][primitive['indices']]
            assert primitive.get('mode',4)==4 and indices['count']%3==0
            triangles+=indices['count']//3
            vi=doc['bufferViews'][indices['bufferView']]
            oi=vi.get('byteOffset',0)+indices.get('byteOffset',0)
            fmt,size={5121:('B',1),5123:('H',2),5125:('I',4)}[indices['componentType']]
            for i in range(indices['count']):
                assert struct.unpack_from('<'+fmt,binary,oi+i*size)[0]<pos['count']
    maximum=max(abs(v-audit['features'][fid]['bounds'][i]) for fid,box in bounds.items() for i,v in enumerate(box))
    assert maximum<1e-4
    assert len(doc['nodes'])==export['objects']
    results.append({'path':export['path'],'sha256':export['sha256'],'bytes':len(data),'nodes':len(doc['nodes']),
                    'features':len(bounds),'vertices':vertices,'triangles':triangles,'maximumBoundsDifferenceMetres':maximum,
                    'axisMetadataMatchesCoordinates':True,'westAnnexCladdingVerified':True,'photoTextures':0})
result={'passed':True,'checks':['GLB headers/buffers/accessors','Finite positions and valid triangle indices','Axis mapping and RH2000 origin metadata','Per-facility bounds against reopened Blender geometry','All model source and artifact hashes'], 'exports':results}
(HERE/'model-export-audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
out=ROOT/'geobuild/cache/facilities-model-2026-09-10'
titles={'clubhouse-west':'Clubhouse · course side','clubhouse-east':'Clubhouse · entrance','campus':'Main facilities','hotel-pool':'Hotel, pool and padel','range':'Driving range','western':'Western buildings'}
cards=''.join('<figure><a href="'+p['name']+'.png"><img src="'+p['name']+'.png"></a><figcaption>'+escape(titles[p['name']])+'</figcaption></figure>' for p in audit['previews'])
html='''<!doctype html><meta charset="utf-8"><title>Veckefjärden facility models</title><style>body{background:#16261e;color:#eff3ea;font:16px system-ui;max-width:1450px;margin:auto;padding:26px}h1{font-size:34px}a{color:#ace8be}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:18px}figure{margin:0;background:#22372a;border-radius:12px;overflow:hidden}img{width:100%}figcaption{padding:14px;font-size:19px}nav{display:flex;gap:22px;padding:18px 0}p{line-height:1.5}</style><h1>Veckefjärden · Facility models</h1><p>Clubhouse, hotel buildings, pool, padel, range and nearby structures modeled from reviewed plan geometry and photographs. Terrain follows RH2000 data. Building heights and unseen details are estimates.</p><nav><a href="veckefjarden-facilities-workspace.blend">Blender workspace</a><a href="veckefjarden-facilities.glb">All facilities GLB</a><a href="veckefjarden-clubhouse.glb">Clubhouse GLB</a><a href="../../facilities/modeling-review-2026-09-10.md">Modeling notes</a></nav><main>'''+cards+'</main>'
(out/'index.html').write_text(html,encoding='utf-8')
print(json.dumps(result))
