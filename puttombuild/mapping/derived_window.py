"""Make a native-grid crop from already verified local orthophoto windows.

No reprojection/resampling: output pixels remain on the original 16 cm lattice.
Each derivative records the exact input hashes and bounds in its request hash.
"""
from pathlib import Path
import contextlib
import hashlib
import json
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.transform import array_bounds

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'puttombuild/cache/lm-ortho'


def digest(file):
    with open(file,'rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def derive_window(identifier, bounds, cache=CACHE):
    plan=json.loads((ROOT/'puttombuild/mapping/lm-ortho-plan.json').read_text())
    res=plan['resolutionMetres']; anchor=plan['sources'][0]['boundsEpsg3006']
    bounds=[float(anchor[i%2]+(np.floor if i<2 else np.ceil)((v-anchor[i%2])/res+(1e-7 if i<2 else -1e-7))*res) for i,v in enumerate(bounds)]
    windows=[w for w in plan['windows'] if w['id'].startswith('context-') and w['boundsEpsg3006'][0]<bounds[2] and w['boundsEpsg3006'][2]>bounds[0] and w['boundsEpsg3006'][1]<bounds[3] and w['boundsEpsg3006'][3]>bounds[1]]
    records=[]
    for w in windows:
        meta=json.loads((cache/(w['id']+'.json')).read_text())
        if digest(cache/meta['rasterFile'])!=meta['sha256']:
            raise ValueError('Input crop bytes changed')
        records.append(meta)
    request=dict(kind='native-crop-of-verified-windows',bounds=bounds,resolution=res,inputs=[dict(id=r['id'],sha256=r['sha256']) for r in records])
    with contextlib.ExitStack() as stack:
        datasets=[stack.enter_context(rasterio.open(cache/r['rasterFile'])) for r in records]
        pixels,transform=merge(datasets,bounds=bounds,res=res,masked=True)
        if np.ma.getmaskarray(pixels).any():raise ValueError('Requested review crop is not completely covered')
        file=cache/(identifier+'.tif')
        with rasterio.open(file,'w',driver='GTiff',width=pixels.shape[2],height=pixels.shape[1],count=4,dtype='uint8',crs=3006,transform=transform,compress='deflate',tiled=True) as dst:
            dst.write(pixels)
    sources={s['id']:s for r in records for s in r['sources']}
    report=dict(id=identifier,rasterFile=file.name,sha256=digest(file),requestSha256=hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest(),
        horizontalCrs='EPSG:3006',width=pixels.shape[2],height=pixels.shape[1],geoTransform=list(transform.to_gdal()),
        boundsEpsg3006=list(array_bounds(pixels.shape[1],pixels.shape[2],transform)),sources=list(sources.values()),sourceIds=list(sources),
        validFraction=1.0,derivation=request,bytes=file.stat().st_size)
    (cache/(identifier+'.json')).write_text(json.dumps(report,indent=2)+'\n')
    return report,pixels,transform
