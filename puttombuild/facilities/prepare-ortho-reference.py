"""Prepare native 16 cm facility reference panels from verified cached LM windows.

Read-only with respect to the course model. Raster pixels remain on the source
EPSG:3006 lattice; inherited x/z geometry is transformed via its geographic frame.
Run with geobuild/cache/ortho-venv/Scripts/python.exe from the repository root.
"""
from pathlib import Path
import contextlib
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import rasterio
from rasterio.merge import merge
from rasterio.transform import array_bounds
from pyproj import CRS, Transformer

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / 'puttombuild/cache/lm-ortho'
OUT = ROOT / 'puttombuild/cache/facilities-reference-2026-09-10/ortho'
ORIGIN = [697365.0, 7025190.0]
RES = 0.16
PANELS = {
    'facilities-overview': [697205, 7025090, 697650, 7025450],
    'clubhouse-courtyard': [697315, 7025140, 697395, 7025240],
    'western-cabins': [697225, 7025120, 697310, 7025225],
    'range-buildings': [697365, 7025205, 697505, 7025320],
    'maintenance-yard': [697515, 7025325, 697615, 7025440],
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf8')

def relative(path):
    return path.relative_to(ROOT).as_posix()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model_path = ROOT / 'puttombuild/course-model.json'
    model = json.loads(model_path.read_text(encoding='utf8'))
    project = Transformer.from_crs(4326, 3006, always_xy=True)
    unproject = Transformer.from_crs(3006, 4326, always_xy=True)
    facilities = []
    for b in model['infra']['buildings']:
        ring = [list(project.transform(model['origin']['lon'] + x / model['mPerLon'],
                         model['origin']['lat'] - z / model['mPerLat'])) for x,z in b['ring']]
        center = np.mean(ring, axis=0).tolist()
        is_site = b.get('prov') == 'trace'
        facilities.append(dict(id=b['id'], label=b.get('name') or b['id'],
            scope='clubhouse-range-maintenance' if is_site else 'surrounding-osm-building',
            purposeStatus='inherited-label-unverified',
            inheritedModel=dict(ringLocalXZ=b['ring'], ringEpsg3006=ring,
                legacyHeightMetres=b.get('h'), kind=b.get('kind'), provenance=b.get('prov', 'OSM'),
                status='unverified-inherited-geometry-not-authoritative-footprint'),
            centerEpsg3006=center, centerLonLat=list(unproject.transform(*center)),
            centerBlenderXY=[center[0]-ORIGIN[0], center[1]-ORIGIN[1]], observedRoof=None))
    source_records = [json.loads(p.read_text()) for p in CACHE.glob('context-*.json')]
    results=[]
    for name, requested_bounds in PANELS.items():
        # The original tile lattice starts at E=695000, N=7025000. 16 cm
        # divides neither one metre nor the 2500 m tile size exactly.
        anchor=[695000.0,7025000.0]
        bounds=[anchor[i%2]+(math.floor if i<2 else math.ceil)((v-anchor[i%2])/RES)*RES
                for i,v in enumerate(requested_bounds)]
        sources=[s for s in source_records if s['boundsEpsg3006'][0]<bounds[2]
            and s['boundsEpsg3006'][2]>bounds[0] and s['boundsEpsg3006'][1]<bounds[3]
            and s['boundsEpsg3006'][3]>bounds[1]]
        for s in sources:
            assert sha(CACHE/s['rasterFile'])==s['sha256'], 'Cached source hash changed'
        with contextlib.ExitStack() as stack:
            datasets=[stack.enter_context(rasterio.open(CACHE/s['rasterFile'])) for s in sources]
            data, transform=merge(datasets,bounds=bounds,res=RES,masked=True)
            assert not np.ma.getmaskarray(data).any(), 'Coverage gap'
            tif=OUT/(name+'.tif')
            with rasterio.open(tif,'w',driver='GTiff',width=data.shape[2],height=data.shape[1],
                count=4,dtype='uint8',crs=3006,transform=transform,compress='deflate',tiled=True) as dst:
                dst.write(data)
        rgb=Image.fromarray(np.moveaxis(data[:3],0,2).astype('uint8'))
        png=OUT/(name+'.png'); rgb.save(png)
        bounds=list(array_bounds(data.shape[1],data.shape[2],transform))
        (OUT/(name+'.pgw')).write_text(f'{RES}\n0\n0\n{-RES}\n{bounds[0]+RES/2:.8f}\n{bounds[3]-RES/2:.8f}\n')
        (OUT/(name+'.prj')).write_text(CRS.from_epsg(3006).to_wkt(version='WKT1_GDAL'))
        corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]]
        rec=dict(id=name,png=relative(png),tif=relative(tif),worldfile=relative(OUT/(name+'.pgw')),
            projectionFile=relative(OUT/(name+'.prj')),width=rgb.width,height=rgb.height,
            horizontalCrs='EPSG:3006',pixelSizeMetres=RES,boundsEpsg3006=bounds,
            geoTransform=list(transform.to_gdal()),cornersEpsg3006=corners,
            cornersBlenderXY=[[e-ORIGIN[0],n-ORIGIN[1]] for e,n in corners],
            sourceInputs=[dict(id=s['id'],sha256=s['sha256'],file=relative(CACHE/s['rasterFile'])) for s in sources],
            captures=sorted({s['capturedAt'] for r in sources for s in r['sources']}),
            pngSha256=sha(png),tifSha256=sha(tif),bands='TIFF: RGBI; PNG: RGB',validFraction=1.0)
        results.append(rec)
        draw=ImageDraw.Draw(rgb)
        font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
        for i,f in enumerate(facilities):
            if f['scope']!='clubhouse-range-maintenance':continue
            ring=f['inheritedModel']['ringEpsg3006']
            if not(bounds[0]<f['centerEpsg3006'][0]<bounds[2] and bounds[1]<f['centerEpsg3006'][1]<bounds[3]):continue
            pts=[((e-bounds[0])/RES,(bounds[3]-n)/RES) for e,n in ring]
            draw.line(pts+[pts[0]],fill='#ffb646',width=3)
            x,y=pts[0];draw.text((x+3,y+3),f['id'].replace('trace-',''),font=font,fill='#ffffaa',stroke_width=2,stroke_fill='#151515')
        annotated=OUT/(name+'-inherited-overlay.png');rgb.save(annotated)
        rec['inheritedOverlay']=relative(annotated)
    reference=dict(schemaVersion=1,preparedAt='2026-09-10',groundId='puttom',
        source='Lantmäteriet orto-u2-2024',captureDate='2024-06-27',attribution='Lantmäteriet, CC BY 4.0',
        pixelSpacingIsNotPositionalAccuracy=True,horizontalCrs='EPSG:3006',
        blenderFrame=dict(originEpsg3006=ORIGIN,axes='X east, Y grid north, Z up',unit='metre'),
        legacyFrame=dict(origin=model['origin'],mPerLon=model['mPerLon'],mPerLat=model['mPerLat'],
            conversion='lon=origin.lon+x/mPerLon; lat=origin.lat-z/mPerLat; project EPSG:4326 to EPSG:3006',
            note='Never add legacy local x/z directly to projected origin: grid convergence is about 3.5 degrees.'),
        panels=results)
    write_json(HERE/'orthophoto-reference.json',reference)
    inventory=dict(schemaVersion=1,groundId='puttom',preparedAt='2026-09-10',
        modelFile=relative(model_path),modelSha256=sha(model_path),
        horizontalCrs='EPSG:3006',blenderFrame=reference['blenderFrame'],
        geometryUse='Reference workspace only; no runtime footprint replacement. Roof edges include overhang/relief effects.',
        facilities=facilities,nonBuildingFacilities=[])
    write_json(HERE/'facility-inventory.json',inventory)
    print(json.dumps(dict(panels=len(results),facilities=len(facilities),out=relative(OUT))))

if __name__=='__main__':
    main()
