"""Verified RGBI + measured CHM review rasters. No detector labels enter reference panels."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from rasterio.windows import from_bounds
from PIL import Image, ImageDraw
from matplotlib import colormaps

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/visby-tree-pilot'
CACHE=ROOT/'visbybuild/cache/lm-ortho'

def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def save(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def digest(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def write_tif(file,values,transform):
    values=np.asarray(values)
    if values.ndim==2:values=values[None]
    with rasterio.open(file,'w',driver='GTiff',width=values.shape[2],height=values.shape[1],count=values.shape[0],dtype=values.dtype,crs='EPSG:3006',transform=transform,tiled=True,compress='deflate',nodata=np.nan if np.issubdtype(values.dtype,np.floating) else None) as dst:dst.write(values)

def merged_chm():
    evidence=read(OUT/'canopy-evidence.json')
    values=None;ground=None;returns=None;owners=None;sources=[]
    for number,campaign in enumerate(evidence['campaigns']):
        files=campaign['files'];side=read(ROOT/files['chm']['sidecar'])
        transform=from_origin(side['originEasting'],side['originNorthing'],side['sampleSpacingMetres'],side['sampleSpacingMetres'])
        arrays={}
        for name in ['chm','ground','firstReturns']:
            file=ROOT/files[name]['data']
            if digest(file)!=files[name]['sha256']:raise ValueError('Raster checksum changed')
            arrays[name]=np.fromfile(file,dtype='<f4').reshape(side['height'],side['width'])
        if values is None:
            values=arrays['chm'].copy();ground=arrays['ground'].copy();returns=arrays['firstReturns'].copy();owners=np.full(values.shape,-1,dtype=np.int16)
        valid=np.isfinite(arrays['chm'])
        values[valid]=arrays['chm'][valid];ground[valid]=arrays['ground'][valid];returns[valid]=arrays['firstReturns'][valid];owners[valid]=number
        sources.append(dict(campaign=campaign['campaignId'],captureStart=campaign['captureStart'],captureEnd=campaign['captureEnd'],sha256=files['chm']['sha256'],density=campaign['totals']))
    for name,data in [('chm',values),('cloud-ground',ground),('first-returns',returns),('campaign',owners)]:write_tif(OUT/(name+'.tif'),data,transform)
    save(OUT/'source-evidence.json',dict(crs='EPSG:3006',verticalCrs='EPSG:5613',pixelConvention='pixel edges; cell centre at +0.5 east/-0.5 north',transform=list(transform.to_gdal()),sources=sources))

def rgbi_window(bounds,resolution=.16):
    report=read(CACHE/'acquisition.json')
    w,s,e,n=bounds;cols=round((e-w)/resolution);rows=round((n-s)/resolution)
    transform=from_origin(w,n,resolution,resolution)
    result=np.zeros((4,rows,cols),dtype=np.uint8);valid=np.zeros((rows,cols),dtype=np.uint8);provenance=[]
    # Large context windows first, then smaller native-grid windows; every source is dated and verified.
    matches=[a for a in report['windows'] if a['boundsEpsg3006'][0]<e and a['boundsEpsg3006'][2]>w and a['boundsEpsg3006'][1]<n and a['boundsEpsg3006'][3]>s]
    matches.sort(key=lambda a:-a['width']*a['height'])
    for record in matches:
        file=CACHE/record['rasterFile']
        if digest(file)!=record['sha256']:raise ValueError('RGBI source checksum changed')
        with rasterio.open(file) as src:
            if src.count!=4 or src.crs.to_epsg()!=3006 or not np.allclose(src.transform.to_gdal(),record['geoTransform'],atol=1e-8,rtol=0):raise ValueError('RGBI grid changed')
            local=np.zeros_like(result);mask=np.zeros_like(valid)
            for band in range(4):reproject(rasterio.band(src,band+1),local[band],src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.bilinear)
            reproject(src.dataset_mask(),mask,src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.nearest)
            result[:,mask>0]=local[:,mask>0];valid[mask>0]=255
        provenance.append({k:record[k] for k in ['id','sha256','sources']})
    if not np.all(valid):raise ValueError(f'Incomplete RGBI coverage for {bounds}: {np.mean(valid>0):.4f}')
    return result,transform,provenance

def chm_window(bounds,resolution=1):
    w,s,e,n=bounds;out=np.full((round((n-s)/resolution),round((e-w)/resolution)),np.nan,dtype=np.float32)
    with rasterio.open(OUT/'chm.tif') as src:reproject(rasterio.band(src,1),out,src_transform=src.transform,src_crs=src.crs,dst_transform=from_origin(w,n,resolution,resolution),dst_crs=src.crs,resampling=Resampling.nearest)
    return out

def canopy_rgb(chm):
    colour=(colormaps['viridis'](np.clip(chm/24,0,1))[:,:,:3]*255).astype(np.uint8)
    colour[~np.isfinite(chm)|(chm<2)]=[15,20,25]
    return colour

def panel(scene):
    side=scene['size'];w=scene['easting']-side/2;n=scene['northing']+side/2;bounds=[w,n-side,w+side,n]
    rgb,transform,sources=rgbi_window(bounds,.16);chm=chm_window(bounds,.25)
    r=rgb[0].astype(np.float32);nir=rgb[3].astype(np.float32)
    contrast=np.divide(nir-r,nir+r,out=np.zeros_like(r),where=nir+r>0)
    ndvi=(colormaps['RdYlGn']((contrast+1)/2)[:,:,:3]*255).astype(np.uint8)
    views=[('RGB 2026-04-10',np.moveaxis(rgb[:3],0,-1)),('NIR / red / green',np.moveaxis(rgb[[3,0,1]],0,-1)),('LiDAR height 2024',canopy_rgb(chm)),('NIR contrast (uncalibrated)',ndvi)]
    canvas=Image.new('RGB',(1600,860),'white')
    for k,(title,arr) in enumerate(views):
        im=Image.fromarray(arr).resize((780,380),Image.Resampling.NEAREST if k==2 else Image.Resampling.BILINEAR)
        # Preserve square metre axes in a square panel rather than stretched input.
        im=Image.fromarray(arr).resize((380,380),Image.Resampling.NEAREST if k==2 else Image.Resampling.BILINEAR)
        canvas.paste(im,((k%2)*800+40,(k//2)*420+30));d=ImageDraw.Draw(canvas)
        d.text(((k%2)*800+40,(k//2)*420+8),scene['id']+' — '+title,fill='black')
        for tick in range(0,int(side)+1,10):
            px=(k%2)*800+40+round(tick/side*380);py=(k//2)*420+30+round(tick/side*380)
            d.line((px,(k//2)*420+30,px,(k//2)*420+410),fill=(120,120,120),width=1)
            d.line(((k%2)*800+40,py,(k%2)*800+420,py),fill=(120,120,120),width=1)
            d.text((px,(k//2)*420+411),str(tick),fill='black');d.text(((k%2)*800+5,py),str(tick),fill='black')
    directory=OUT/'review';directory.mkdir(exist_ok=True)
    canvas.crop((0,0,1240,850)).save(directory/(scene['id']+'-panel.png'))
    for name,arr in [('rgb',views[0][1]),('cir',views[1][1]),('chm',canopy_rgb(chm)),('contrast',ndvi)]:Image.fromarray(arr).save(directory/(scene['id']+'-'+name+'.png'))
    write_tif(directory/(scene['id']+'-rgbi.tif'),rgb,transform)
    save(directory/(scene['id']+'.json'),dict(**scene,bounds=bounds,sources=sources,sourceRelativeReference=True))
    print('panel',scene['id'],flush=True)

SCENES=[
 dict(id='cal02',hole=2,easting=687315,northing=6371190,size=100,split='calibration'),
 dict(id='cal03',hole=3,easting=687510,northing=6371530,size=120,split='calibration'),
 dict(id='cal04',hole=4,easting=687575,northing=6371830,size=120,split='calibration'),
 dict(id='cal08',hole=8,easting=687570,northing=6371200,size=120,split='calibration'),
 dict(id='cal15',hole=15,easting=687835,northing=6371315,size=120,split='calibration'),
 dict(id='cal13',hole=13,easting=688165,northing=6370935,size=120,split='calibration'),
 dict(id='cal14',hole=14,easting=688110,northing=6371130,size=100,split='calibration'),
 dict(id='cal10',hole=10,easting=687660,northing=6370680,size=100,split='calibration'),
 dict(id='cal06',hole=6,easting=687300,northing=6371550,size=100,split='calibration'),
 dict(id='hold09a',hole=9,easting=687440,northing=6371020,size=100,split='evaluation'),
 dict(id='hold09b',hole=9,easting=687335,northing=6370915,size=100,split='evaluation'),
 dict(id='hold16a',hole=16,easting=687855,northing=6371070,size=100,split='evaluation'),
 dict(id='hold16b',hole=16,easting=687905,northing=6370880,size=100,split='evaluation'),
]

if __name__=='__main__':
    if not (OUT/'chm.tif').exists():merged_chm()
    save(OUT/'scenes.json',SCENES)
    for scene in SCENES:
        if not (OUT/'review'/(scene['id']+'-panel.png')).exists():panel(scene)
    bounds=[687050,6370470,688400,6372030]
    rgb,transform,sources=rgbi_window(bounds,1)
    for name,array in [('overview-rgb',np.moveaxis(rgb[:3],0,-1)),('overview-cir',np.moveaxis(rgb[[3,0,1]],0,-1)),('overview-chm',canopy_rgb(chm_window(bounds)))]:Image.fromarray(array).save(OUT/'review'/(name+'.png'))
    save(OUT/'review/overview.json',dict(bounds=bounds,sources=sources,resolution=1))
