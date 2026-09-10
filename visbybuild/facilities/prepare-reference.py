"""Build a georeferenced Visby facility reference kit from retained source data.

Run with geobuild/cache/ortho-venv/Scripts/python.exe. Runtime geometry is not edited.
The inventory distinguishes OSM footprints, visible roof observations and heights.
"""
from pathlib import Path
import json, hashlib, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon, Point, mapping
from pyproj import CRS, Transformer
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = HERE / 'reference'
ORTHO = OUT / 'ortho'
CACHE = ROOT / 'visbybuild/cache/lm-ortho'
E0, N0 = 687748.5, 6370951.5

def read(path): return json.loads(path.read_text(encoding='utf8'))
def write(path, data): path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)+'\n', encoding='utf8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def rel(path): return path.relative_to(ROOT).as_posix()
def rnd(x): return round(float(x), 3)

LABELS = {
 'way/530655627': 'Range / practice building (role provisional)',
 'way/530655628': 'Large northeast service building (role provisional)',
 'way/530655629': 'Detached building beside parking (role unverified)',
 'way/530655630': 'East clubhouse ancillary building (role unverified)',
 'way/530655631': 'Clubhouse and restaurant',
 'way/530655632': 'Red former lighthouse keeper dwelling (identity inferred)',
 'way/530655633': 'White Fyrhuset accommodation (identity inferred)',
}

def main():
    print('Building Visby facility inventory from retained 1m DTM and 2024 laser cells', flush=True)
    ORTHO.mkdir(parents=True, exist_ok=True)
    model_path=ROOT/'visbybuild/course-model.json'; model=read(model_path)
    acquisition=read(CACHE/'acquisition.json')
    assert acquisition['access']['authorized']
    write(OUT/'orthophoto-acquisition.json', acquisition)
    dtm_path=ROOT/'visbybuild/cache/terrain-review/terrain-1m.f32'
    terrain=read(ROOT/'geo_data/course-v2/visby/acquisition/terrain-window.json')
    terrain['sourceFloat32Sha256']=read(ROOT/'visbybuild/heightfields.json')['source']['fineInputSha256']
    dtm=np.fromfile(dtm_path, dtype='<f4').reshape(4097,4097)
    assert sha(dtm_path)==terrain['sourceFloat32Sha256']
    def ground(e,n):
        x=e-685700.5; y=6372999.5-n; c=int(math.floor(x));r=int(math.floor(y));u=x-c;v=y-r
        return float(dtm[r,c]*(1-u)*(1-v)+dtm[r,c+1]*u*(1-v)+dtm[r+1,c]*(1-u)*v+dtm[r+1,c+1]*u*v)
    cloud_dir=ROOT/'visbybuild/cache/vegetation'
    cloud_meta=read(cloud_dir/'chm-24e002.json')
    chm=np.fromfile(cloud_dir/'chm-24e002.f32',dtype='<f4').reshape(2048,2048)
    chm_sha=sha(cloud_dir/'chm-24e002.f32')
    cloud_ground=np.fromfile(cloud_dir/'ground-24e002.f32',dtype='<f4').reshape(2048,2048)
    unproject=Transformer.from_crs(3006,4326,always_xy=True)
    observations=read(OUT/'observed-roofs-2026.json')
    def trace_ground(observation, key):
        gt=observations['sources'][observation['source']]['geoTransform']
        return [[gt[0]+u*gt[1],gt[3]+v*gt[5]] for u,v in observation[key]]
    observed={o['id']:o for o in observations['roofs']}
    buildings=list(model['infra']['buildings'])
    existing_ids={b['id'] for b in buildings}
    for o in observed.values():
        if o['id'] in existing_ids:continue
        LABELS[o['id']]=o['label']
        ring=trace_ground(o,'ringPixels')
        buildings.append(dict(id=o['id'],ring=[[e-E0,N0-n] for e,n in ring],h=None,kind='observed-roof-envelope',
          name=o['label'],sourceId='Lantmateriet-2026-04-10',heightStatus='not-measured'))
    facilities=[]
    for i,b in enumerate(buildings):
        ring=[[E0+x,N0-z] for x,z in b['ring']]
        poly=Polygon(ring); e,n=poly.centroid.coords[0]
        rect=np.array(poly.minimum_rotated_rectangle.exterior.coords[:4]); edges=np.roll(rect,-1,axis=0)-rect
        lengths=np.linalg.norm(edges,axis=1); k=int(np.argmax(lengths)); axis=edges[k]/lengths[k]
        if axis[1]<0: axis=-axis
        base_samples=[ground(*p) for p in ring[:-1]]+[ground(e,n)]
        inside=poly.buffer(-1); left,bottom,right,top=poly.bounds
        c0=max(0,int((left-685700.5)/2));c1=min(2048,int((right-685700.5)/2)+1)
        r0=max(0,int((6372999.5-top)/2));r1=min(2048,int((6372999.5-bottom)/2)+1)
        cloud=[]
        for r in range(r0,r1):
            for c in range(c0,c1):
                ce=685701.5+c*2; cn=6372998.5-r*2
                if inside.contains(Point(ce,cn)) and np.isfinite(chm[r,c]) and np.isfinite(cloud_ground[r,c]):
                    cloud.append([ce,cn,float(chm[r,c]),float(cloud_ground[r,c])])
        heights=[s[2] for s in cloud]
        roof_evidence=dict(campaign='24e002',pixelSpacingMetres=2,insetMetres=1,cellCount=len(cloud),
          source='visbybuild/cache/vegetation/chm-24e002.f32',sourceSha256=chm_sha,
          measure='Maximum non-noise return height above interpolated cloud ground in each 2m cell',
          status='roof-supporting-height-envelope-not-fitted-roof-planes',
          limits='Cell maxima can include chimneys or overhanging vegetation; source is 2024, footprints OSM 2026, imagery 2026. No eave or ridge plane is established.',
          aboveGroundMetres={str(p):rnd(np.percentile(heights,p)) for p in [10,50,90,95,100]} if heights else None,
          cellsEastingNorthingHeightAboveGroundGroundRH2000=[[rnd(v) for v in s] for s in cloud])
        f=dict(id=b['id'],label=LABELS.get(b['id'],b.get('name') or 'Surrounding building '+b['id']),
          annotation=str(i+1).zfill(2),scope='club-facilities' if b['id'] in LABELS else 'surrounding-context',
          identityStatus='clubhouse name retained from OSM' if b['id']=='way/530655631' else 'see label; association is not a land-ownership assertion',
          footprintEpsg3006=ring,footprintBlenderXY=[[rnd(x),rnd(-z)] for x,z in b['ring']],
          centerEpsg3006=[rnd(e),rnd(n)],centerBlenderXY=[rnd(e-E0),rnd(n-N0)],centerLonLat=list(unproject.transform(e,n)),
          areaSquareMetres=rnd(poly.area),boundsEpsg3006=list(poly.bounds),
          footprintAxis=dict(unitEastNorth=[rnd(v) for v in axis],bearingDegreesClockwiseFromGridNorth=rnd(math.degrees(math.atan2(axis[0],axis[1]))%180),
            longDimensionMetres=rnd(max(lengths)),shortDimensionMetres=rnd(min(lengths)),
            method='minimum-area enclosing rectangle of inherited OSM footprint; not a measured roof ridge'),
          footprintEvidence=dict(source=b['sourceId'],modelFile=rel(model_path),status='inherited-OSM-footprint-not-surveyed',
            rawModelHeight=b.get('h'),rawModelHeightStatus=b.get('heightStatus'),heightAccepted=False),
          groundEvidence=dict(source=rel(dtm_path),sourceSha256=terrain['sourceFloat32Sha256'],verticalCrs='EPSG:5613',
            method='bilinear interpolation of acquired 1m Markhojdmodell at footprint vertices and centroid',
            centerRH2000=rnd(ground(e,n)),minimumRH2000=rnd(min(base_samples)),medianRH2000=rnd(np.median(base_samples)),maximumRH2000=rnd(max(base_samples)),
            samplesRH2000=[rnd(v) for v in base_samples],status='terrain-support-levels-not-finished-floor-survey'),
          roofHeightEvidence=roof_evidence,roofObservation=None)
        facilities.append(f)
        if b['id'] in ('range-parking-building-2026','service-west-south-2026'):
            roof_evidence['status']='contaminated-by-overhanging-tree-crowns-do-not-use-as-roof-height'
            roof_evidence['roofHeightAccepted']=False
        elif b['id'] in ('service-north-small-2026','way/530655629'):
            roof_evidence['status']='insufficient-2024-support-for-current-2026-roof'
            roof_evidence['roofHeightAccepted']=False
        else:
            roof_evidence['roofHeightAccepted']='supporting-envelope-only-not-eaves-or-ridge'
        if b['id'] in observed:
            o=observed[b['id']];ring=trace_ground(o,'ringPixels');ridge=trace_ground(o,'ridgePixels')
            f['roofObservation']=dict(source='visbybuild/facilities/reference/observed-roofs-2026.json',sourcePanel=o['source'],
              roofEnvelopeEpsg3006=ring,roofEnvelopeBlenderXY=[[rnd(e-E0),rnd(n-N0)] for e,n in ring],
              ridgeEpsg3006=ridge,ridgeBlenderXY=[[rnd(e-E0),rnd(n-N0)] for e,n in ridge],
              form=o['roofForm'],note=o['note'],interpretationUncertaintyMetres=1,
              status='manual-2026-roof-envelope-and-approximate-ridge-not-surveyed-wall-footprint')
            if b['id'] not in existing_ids:
                f['footprintEvidence']['status']='2026-image-roof-envelope-not-wall-footprint'
    tower_e,tower_n=687145.2,6370761.1
    tower=dict(id='skansudde-1936-tower',label='Skansudde concrete lighthouse (1936)',annotation=str(len(facilities)+1),scope='club-facilities',
      centerEpsg3006=[tower_e,tower_n],centerBlenderXY=[tower_e-E0,tower_n-N0],
      footprintEpsg3006=None,footprintBlenderXY=None,
      groundEvidence=dict(centerRH2000=rnd(ground(tower_e,tower_n)),method='bilinear 1m DTM'),
      publishedHeightMetres=10.4,publishedHeightStatus='existing sourced claim in scenery/visby.js; verify against current lighthouse source',
      radiusMetres=2.2,radiusStatus='legacy imagery estimate; tower shaft and lantern differ',
      identityStatus='named coastal landmark; location inherited from earlier orthophoto interpretation')
    facilities.append(tower)
    frame=dict(originEpsg3006=[E0,N0],axes='Blender X east, Y grid north, Z up',verticalDatum='RH2000',
        zConvention='Absolute RH2000 metres, no subtraction of the runtime frame 0.10m offset',
        runtimeConversion='runtime x=blender X; runtime z=-blender Y; runtime elevation handled by loader')
    inventory=dict(schemaVersion=1,groundId='visby',preparedAt='2026-09-10',horizontalCrs='EPSG:3006',blenderFrame=frame,
      modelSha256=sha(model_path),facilities=facilities,nonBuildingFacilities=[],
      limitations=['Footprint axes are only shape guides; roof axes must be traced from orthophoto.',
        '2026 imagery does not determine facade materials, wall heights, room allocation or current equipment.',
        'Facilities outside the seven OSM club-area footprints require explicit observation; a generic OSM house is not proof of use.'])
    for o in observations['nonBuildingFacilities']:
        key='ringPixels' if 'ringPixels' in o else 'linePixels';points=trace_ground(o,key)
        inventory['nonBuildingFacilities'].append(dict(id=o['id'],kind=o['kind'],note=o['note'],sourcePanel=o['source'],
          geometryType='Polygon' if key=='ringPixels' else 'LineString',coordinatesEpsg3006=points,
          coordinatesBlenderXY=[[rnd(e-E0),rnd(n-N0)] for e,n in points],interpretationUncertaintyMetres=1))
    for p in model['infra']['parking']:
        if 'ring' not in p:continue
        inventory['nonBuildingFacilities'].append(dict(id=p['id'],kind='parking',source='inherited OSM parking outline',
          geometryType='Polygon',coordinatesEpsg3006=[[E0+x,N0-z] for x,z in p['ring']],coordinatesBlenderXY=[[x,-z] for x,z in p['ring']]))
    for i,ring in enumerate(model['scenery'].get('greens',[])):
        inventory['nonBuildingFacilities'].append(dict(id='practice-green-'+str(i+1),kind='practice-putting-green',source='inherited source-reviewed scenery green',
          geometryType='Polygon',coordinatesEpsg3006=[[E0+x,N0-z] for x,z in ring],coordinatesBlenderXY=[[x,-z] for x,z in ring],
          note='Retains existing source epoch and uncertainty; no new mowing boundary is claimed.'))
    write(HERE/'facility-inventory.json',inventory)
    print('Facility inventory written: '+str(len(facilities))+' structures',flush=True)
    geo=dict(type='FeatureCollection',name='Visby facility reference footprints',crs=dict(type='name',properties=dict(name='EPSG:3006')),
      features=[dict(type='Feature',id=f['id'],properties=dict(label=f['label'],scope=f['scope'],annotation=f['annotation']),geometry=mapping(Polygon(f['footprintEpsg3006']))) for f in facilities if f['footprintEpsg3006']])
    write(OUT/'building-footprints.geojson',geo)
    records={r['id']:r for r in acquisition['windows']}
    panels=[]
    specs = [('clubhouse-close','clubhouse-finish',[687200,6370705,687255,6370780]),
              ('lighthouse-close','clubhouse-finish',[687115,6370730,687180,6370780]),
              ('east-facilities-close','clubhouse-finish',[687253,6370718,687330,6370795]),
              ('range-building-close','range-practice',[687390,6370830,687450,6370900]),
              ('service-building-close','context-2-3',[687940,6370985,688030,6371090])]
    specs += [('range-firing-line','range-practice',[687390,6370815,687525,6370915]),
              ('service-yard','context-2-3',[687915,6370965,688045,6371110]),
              ('range-net-north','range-practice',[687500,6370840,687610,6371030])]
    specs += [(name,name,None) for name in records]
    for name,source,bounds in specs:
        record=records[source];file=CACHE/record['rasterFile'];assert sha(file)==record['sha256']
        with rasterio.open(file) as src:
            assert src.crs.to_epsg()==3006 and np.allclose(src.transform.to_gdal(),record['geoTransform'],atol=1e-8,rtol=0)
            if bounds:
                c0=int(math.floor((bounds[0]-src.bounds.left)/.16));c1=int(math.ceil((bounds[2]-src.bounds.left)/.16))
                r0=int(math.floor((src.bounds.top-bounds[3])/.16));r1=int(math.ceil((src.bounds.top-bounds[1])/.16))
                assert c0>=0 and r0>=0 and c1<=src.width and r1<=src.height
                window=Window(c0,r0,c1-c0,r1-r0)
            else: window=Window(0,0,src.width,src.height)
            data=src.read([1,2,3],window=window);transform=src.window_transform(window)
        img=Image.fromarray(np.moveaxis(data,0,2)); png=ORTHO/(name+'.png');img.save(png)
        width,height=img.size;gt=list(transform.to_gdal());bounds=[gt[0],gt[3]-.16*height,gt[0]+.16*width,gt[3]]
        world=ORTHO/(name+'.pgw');world.write_text(f'0.16\n0\n0\n-0.16\n{gt[0]+.08:.8f}\n{gt[3]-.08:.8f}\n')
        prj=ORTHO/(name+'.prj');prj.write_text(CRS.from_epsg(3006).to_wkt(version='WKT1_GDAL'))
        rec=dict(id=name,png=rel(png),worldfile=rel(world),projection=rel(prj),width=width,height=height,
          geoTransform=gt,boundsEpsg3006=bounds,pixelConvention='pixel edges at top left; pixel centres +0.08m east and -0.08m north',
          resolutionMetres=.16,horizontalCrs='EPSG:3006',captures=record['sources'],sourceRaster=rel(file),sourceRasterSha256=record['sha256'],
          sourceWindowPixels=[int(window.col_off),int(window.row_off),int(window.width),int(window.height)],pngSha256=sha(png),
          attribution='Ortofoto Nedladdning © Lantmäteriet, CC BY 4.0; RGB bands extracted without resampling',
          accuracy='0.16m pixel spacing is not independent position accuracy',
          blenderPlane=dict(centerXY=[(bounds[0]+bounds[2])/2-E0,(bounds[1]+bounds[3])/2-N0],widthMetres=width*.16,heightMetres=height*.16,northImageEdge='top'))
        draw=ImageDraw.Draw(img);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
        def px(p):return((p[0]-gt[0])/.16,(gt[3]-p[1])/.16)
        for f in facilities:
            e,n=f['centerEpsg3006']
            if not(bounds[0]<=e<=bounds[2] and bounds[1]<=n<=bounds[3]):continue
            color='#ffd64a' if f['scope']=='club-facilities' else '#52d9ff'
            if f['footprintEpsg3006']:draw.line([px(p) for p in f['footprintEpsg3006']],fill=color,width=3)
            if f.get('roofObservation'):
                draw.line([px(p) for p in f['roofObservation']['roofEnvelopeEpsg3006']],fill='#ff65db',width=3)
            x,y=px([e,n]);draw.text((x+4,y+4),f['annotation'],font=font,fill=color,stroke_width=2,stroke_fill='black')
        for f in inventory['nonBuildingFacilities']:
            points=f['coordinatesEpsg3006']
            if all(bounds[0]<=p[0]<=bounds[2] and bounds[1]<=p[1]<=bounds[3] for p in points):
                draw.line([px(p) for p in points],fill='#79ff91',width=3)
        draw.text((12,12),name+' | 2026-04-10 | EPSG:3006 | north up',font=font,fill='white',stroke_width=2,stroke_fill='black')
        draw.line([(15,height-26),(15+20/.16,height-26)],fill='white',width=5)
        draw.text((15,height-52),'20 m',font=font,fill='white',stroke_width=2,stroke_fill='black')
        annotated=ORTHO/(name+'-inventory.png');img.save(annotated);rec['annotatedPng']=rel(annotated)
        panels.append(rec)
        write(OUT/'orthophoto-manifest.json',dict(schemaVersion=1,groundId='visby',blenderFrame=frame,panels=panels))
        print('Prepared '+name,flush=True)
    write(OUT/'orthophoto-manifest.json',dict(schemaVersion=1,groundId='visby',blenderFrame=frame,panels=panels))
    # Small source-height patch for Blender landscaping reference, sampled from the 1m source at 2m.
    easting=np.arange(687100.5,688080.6,2);northing=np.arange(6371179.5,6370659.4,-2)
    patch=np.array([[ground(e,n) for e in easting] for n in northing],dtype='<f4')
    patchfile=OUT/'facility-ground-rh2000-2m.f32';patch.tofile(patchfile)
    write(OUT/'facility-ground-rh2000-2m.json',dict(width=len(easting),height=len(northing),originEasting=easting[0],originNorthing=northing[0],
      originConvention='northwest sample centre',sampleSpacingMetres=2,horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
      source=rel(dtm_path),sourceSha256=terrain['sourceFloat32Sha256'],file=rel(patchfile),sha256=sha(patchfile),blenderFrame=frame))
    lines=['# Visby facility inventory','', 'Prepared 2026-09-10. Orthophoto flight 2026-04-10, native 0.16 m; 2024 laser cells are 2 m.', '',
      '| Map label | Facility | E / N (EPSG:3006) | Ground RH2000 | 2024 roof-cell HAG p90 |',
      '|---|---|---|---|---|']
    for f in facilities:
        h=f.get('roofHeightEvidence',{}).get('aboveGroundMetres')
        lines.append(f"| {f['annotation']} | {f['label']} | {f['centerEpsg3006'][0]:.2f}, {f['centerEpsg3006'][1]:.2f} | {f['groundEvidence']['centerRH2000']:.2f} m | {str(h['90'])+' m' if h else 'unavailable'} |")
    lines += ['', 'Yellow overlays: club-area facilities and lighthouse. Blue: surrounding context. Magenta: manually traced 2026 roof envelopes. OSM footprints are not a claim that eaves align with those outlines.', '',
      'Height values summarize maximum returns in 2 m cells inset 1 m from the footprint. They are supporting evidence, not fitted eaves or ridges. Trees and chimneys can raise the envelope. The 1 m terrain provides ground support, not finished-floor levels.', '',
      'Blender coordinate contract: X=E-687748.5, Y=N-6370951.5, Z=absolute RH2000. Each PNG has a PGW and PRJ. RGB pixels are copied without resampling; the annotated image uses the same transform.', '',
      'Attribution: Ortofoto Nedladdning © Lantmäteriet, CC BY 4.0; OpenStreetMap contributors for inherited footprints. Source rasters remain local under visbybuild/cache/lm-ortho/. The reference kit is for modeling and does not modify runtime geometry.']
    (OUT/'inventory.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(json.dumps(dict(facilities=len(facilities),panels=len(panels),inventory=rel(HERE/'facility-inventory.json'))))

if __name__=='__main__':main()
