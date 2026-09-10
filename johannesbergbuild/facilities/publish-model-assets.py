"""Bake exported Blender metre-grid vertices into Johannesberg's exact app frame.

No third-party photography is published. The GLB contains static, procedural
building geometry only. Source dates and uncertain dimensions stay in evidence.
"""
import hashlib
import json
from pathlib import Path
import struct
import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'johannesbergbuild/facilities'
OUT = ROOT / 'apps/golf/public/models/johannesberg'
CACHE = ROOT / 'johannesbergbuild/cache/facilities-model'
TRANSFORM = Transformer.from_crs(3006, 4326, always_xy=True)
FRAME = {'kind': 'legacy-local-rh2000', 'originWgs84': {'lat':59.72733,'lon':18.19202},
         'mPerLat':111320,'mPerLon':56118.16}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def app_xy(e, n):
    lon, lat = TRANSFORM.transform(e, n)
    return (np.asarray(lon)-18.19202)*56118.16, (59.72733-np.asarray(lat))*111320


def main():
    raw = (CACHE/'johannesberg-facilities-grid.glb').read_bytes()
    export_report=json.loads((HERE/'model-export-validation.json').read_text(encoding='utf-8'))
    build_report=json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
    assert export_report['passed'] and export_report['gridGlbSha256']==sha(raw), 'Export receipt does not match the GLB'
    assert export_report['scene']==build_report['scene'], 'Export belongs to a different architecture build'
    assert build_report['specSha256']==sha((HERE/'architecture-spec.json').read_bytes()), 'Architecture specification changed after building'
    assert build_report['implementationSha256']==sha((HERE/'build_architecture.py').read_bytes()), 'Architecture builder changed after building'
    magic, version, total = struct.unpack_from('<III',raw)
    assert magic==0x46546c67 and version==2 and total==len(raw)
    size, kind = struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    gltf=json.loads(raw[20:20+size])
    offset=20+size
    bin_size, bin_kind=struct.unpack_from('<II',raw,offset)
    assert bin_kind==0x004e4942
    data=bytearray(raw[offset+8:offset+8+bin_size])
    assert not any(gltf.get(k) for k in ('images','textures','skins','animations','cameras'))
    assert len(gltf['buffers'])==1 and 'uri' not in gltf['buffers'][0]
    for node in gltf['nodes']:
        assert node.get('translation',[0,0,0])==[0,0,0],node['name']
        assert node.get('rotation',[0,0,0,1])==[0,0,0,1],node['name']
        assert node.get('scale',[1,1,1])==[1,1,1],node['name']
        assert 'matrix' not in node,node['name']

    def array(index):
        a=gltf['accessors'][index];v=gltf['bufferViews'][a['bufferView']]
        assert a['componentType']==5126 and a['type']=='VEC3' and 'sparse' not in a
        start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return np.ndarray((a['count'],3),'<f4',buffer=data,offset=start,strides=(v.get('byteStride',12),4))

    positions={p['attributes']['POSITION'] for m in gltf['meshes'] for p in m['primitives']}
    normals={p['attributes']['NORMAL'] for m in gltf['meshes'] for p in m['primitives'] if 'NORMAL' in p['attributes']}
    max_rounding=0
    for index in positions:
        points=array(index)
        e=points[:,0].astype(float)+679200
        n=6626160-points[:,2].astype(float)
        x,z=app_xy(e,n)
        converted=np.column_stack([x,points[:,1].astype(float)+16,z])
        points[:]=converted
        max_rounding=max(max_rounding,float(np.max(np.abs(points-converted))))
        gltf['accessors'][index]['min']=points.min(axis=0).astype(float).tolist()
        gltf['accessors'][index]['max']=points.max(axis=0).astype(float).tolist()
    # Normal inverse transpose of the local grid-to-app Jacobian. The site is
    # <600m wide; the basis uses its centre. Positions above use exact PROJ.
    dx_e,dz_e=(np.subtract(app_xy(679400.5,6626200),app_xy(679399.5,6626200)))
    dx_s,dz_s=(np.subtract(app_xy(679400,6626199.5),app_xy(679400,6626200.5)))
    jacobian=np.array([[dx_e,0,dx_s],[0,1,0],[dz_e,0,dz_s]])
    normal_matrix=np.linalg.inv(jacobian).T
    for index in normals:
        values=array(index);converted=values@normal_matrix.T
        converted/=np.linalg.norm(converted,axis=1)[:,None]
        values[:]=converted
    build=json.loads((HERE/'model-build-report.json').read_text(encoding='utf-8'))
    inventory=json.loads((HERE/'site-inventory.json').read_text(encoding='utf-8'))
    ground=json.loads((HERE/'model-ground.json').read_text(encoding='utf-8'))
    anchors={f['id']:f for f in ground['facilities']}
    facilities=[]
    roots=gltf['scenes'][gltf.get('scene',0)]['nodes']
    by_name={gltf['nodes'][i]['name']:gltf['nodes'][i] for i in roots}
    built={f['id']:f for f in build['facilities']}
    for f in inventory['facilities']:
        node_name=built[f['id']]['nodeName']
        node=by_name[node_name]
        assert node['extras']['sourceBuildingId']==f['sourceBuildingId']
        # Blender suffixes repeated live-scene names with dots; GLTFLoader
        # sanitizes those dots. Stable public names avoid that implicit rename.
        node_name=f['id']
        node['name']=node_name
        a=anchors[f['id']];e,n=a['anchorEpsg3006'];x,z=app_xy(e,n)
        facilities.append({'id':f['id'],'sourceBuildingId':f['sourceBuildingId'],'nodeName':node_name,
                           'groundAnchorLocal':[round(float(x),6),round(float(z),6)],
                           'groundAnchorRh2000M':a['groundAnchorRh2000M'],
                           'placement':'absolute-rh2000' if 678403.5<=e<=680451.5 and 6624276.5<=n<=6626324.5 else 'terrain-anchor',
                           'appearance':'evidence-led-model-with-estimated-dimensions'})
    assert len(facilities)==22 and len(roots)==22
    gltf.setdefault('asset',{})['copyright']='Procedurally modelled Johannesberg exterior geometry; no photographic textures.'
    gltf['asset']['extras']={'coordinateFrame':FRAME,'sourceGridGlbSha256':sha(raw),'modelEvidenceDate':'2026-09-10'}
    gltf['buffers'][0]['byteLength']=len(data)
    encoded=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    encoded+=b' '*((-len(encoded))%4)
    data+=b'\0'*((-len(data))%4)
    blob=struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
    OUT.mkdir(parents=True,exist_ok=True)
    asset_name='facilities-'+sha(blob)+'.glb'
    (OUT/asset_name).write_bytes(blob)
    manifest={'schemaVersion':1,'groundId':'johannesberg','courseSlugs':['johannesberg','johannesberg-9'],
              'coordinateFrame':FRAME,'asset':{'url':'models/johannesberg/'+asset_name,'bytes':len(blob),'sha256':sha(blob)},
              'facilities':facilities,'modelStatus':'Exterior appearance models with explicitly estimated dimensions',
              'referenceDates':{'orthophoto':'2025-06-14','laser':'2021-04-17'},
              'sourceReport':'johannesbergbuild/facilities/model-build-report.json'}
    (OUT/'facilities-v1.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    report={'passed':True,'facilities':len(facilities),'gridGlbSha256':sha(raw),'publishedAsset':manifest['asset'],
            'manifestPath':'apps/golf/public/models/johannesberg/facilities-v1.json',
            'maximumFloatStorageErrorMetres':max_rounding,'positionConversion':'Exact EPSG3006 to WGS84 to legacy frame per vertex',
            'normalJacobian':jacobian.tolist(),'noPhotographicTextures':True,
            'absoluteRh2000Facilities':sum(f['placement']=='absolute-rh2000' for f in facilities),
            'terrainAnchoredFacilities':sum(f['placement']=='terrain-anchor' for f in facilities),
            'modelBuildReportSha256':sha((HERE/'model-build-report.json').read_bytes())}
    (HERE/'model-publish-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    main()
