#!/usr/bin/env python3
"""Render native-source tee review panels with physical pads and nominal references.

The plain image remains separate from the overlay. --extent uses EPSG:3006
pixel-edge bounds; --focus-pad uses a zero-based pad index and --metres square.
Default extent is the full authenticated tee acquisition window. All output
belongs in ignored cache. Cyan nominal references are not observed tee markers.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--model',type=Path,default=Path('upsalabuild/course-model.json'))
    parser.add_argument('--hole',type=int,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--extent',type=float,nargs=4)
    parser.add_argument('--focus-pad',type=int)
    parser.add_argument('--metres',type=float,default=50)
    parser.add_argument('--pixels',type=int,default=1200,help='Longest display side; display resampling adds no source resolution')
    args=parser.parse_args()
    if args.extent and args.focus_pad is not None:
        parser.error('--extent and --focus-pad are mutually exclusive')
    args.out.mkdir(parents=True,exist_ok=True)
    model=json.loads(args.model.read_text(encoding='utf-8'))
    hole=next(h for h in model['holes'] if h['n']==args.hole)
    frame={k:model[k] for k in ['origin','mPerLat','mPerLon']}
    forward=Transformer.from_crs(4326,3006,always_xy=True)
    def projected(point):
        x,z=point
        return list(forward.transform(frame['origin']['lon']+x/frame['mPerLon'],frame['origin']['lat']-z/frame['mPerLat']))
    def pad_center(pad):
        if 'cx' in pad and 'cz' in pad:
            return [pad['cx'],pad['cz']]
        if pad.get('c'):
            return pad['c']
        ring=pad['ring']
        twice_area=cx=cz=0
        for (x1,z1),(x2,z2) in zip(ring,ring[1:]+ring[:1]):
            cross=x1*z2-x2*z1
            twice_area+=cross;cx+=(x1+x2)*cross;cz+=(z1+z2)*cross
        if abs(twice_area)>1e-9:
            return [cx/(3*twice_area),cz/(3*twice_area)]
        return [sum(p[a] for p in ring)/len(ring) for a in [0,1]]
    source_ledger=args.source.with_suffix('.json')
    ledger=json.loads(source_ledger.read_text(encoding='utf-8')) if source_ledger.exists() else None
    sha=hashlib.sha256(args.source.read_bytes()).hexdigest()
    if ledger:
        assert ledger['sha256']==sha,'Acquisition source hash mismatch'
    with rasterio.open(args.source) as src:
        assert src.crs.to_epsg()==3006
        bounds=list(src.bounds)
        if args.extent:
            bounds=args.extent
        elif args.focus_pad is not None:
            pad=hole['tees']['pads'][args.focus_pad]
            e,n=projected(pad_center(pad))
            half=args.metres/2
            bounds=[e-half,n-half,e+half,n+half]
        west,south,east,north=bounds
        width_m,height_m=east-west,north-south
        assert min(width_m,height_m)>0
        resolution=max(width_m,height_m)/args.pixels
        width,height=round(width_m/resolution),round(height_m/resolution)
        transform=from_bounds(*bounds,width,height)
        coverage=np.zeros((height,width),dtype=np.uint8)
        reproject(source=src.dataset_mask(),destination=coverage,src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.nearest,src_nodata=0,dst_nodata=0)
        assert np.all(coverage),'Requested panel is not fully covered by valid source pixels'
        rgb=np.zeros((3,height,width),dtype=np.uint8)
        for band in range(3):
            reproject(source=rasterio.band(src,band+1),destination=rgb[band],src_transform=src.transform,src_crs=src.crs,dst_transform=transform,dst_crs=src.crs,resampling=Resampling.bilinear,src_nodata=None)
        source={'path':args.source.as_posix(),'sha256':sha,'width':src.width,'height':src.height,'geoTransform':list(src.transform.to_gdal()),'boundsEPSG3006':list(src.bounds),'resolutionM':list(src.res),'ledgerPath':source_ledger.as_posix() if ledger else None}
    def pixel(point):
        e,n=projected(point)
        return [(e-west)/transform.a,(n-north)/transform.e]
    plain=Image.fromarray(np.moveaxis(rgb,0,-1))
    plain_path=args.out/'plain.png'
    plain.save(plain_path)
    overlay=plain.copy()
    draw=ImageDraw.Draw(overlay)
    try:
        font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
    except OSError:
        font=ImageFont.load_default()
    for pos in range(0,max(width,height),100):
        if pos<width:
            draw.line([(pos,0),(pos,height)],fill='#a0a0a0',width=1)
            draw.text((pos+3,3),str(pos),fill='white',font=font,stroke_width=2,stroke_fill='black')
        if pos<height:
            draw.line([(0,pos),(width,pos)],fill='#a0a0a0',width=1)
            if pos:
                draw.text((3,pos+3),str(pos),fill='white',font=font,stroke_width=2,stroke_fill='black')
    pads=[]
    for i,pad in enumerate(hole['tees']['pads']):
        ring=[pixel(p) for p in pad['ring']]
        center=pixel(pad_center(pad))
        draw.line([tuple(p) for p in ring+[ring[0]]],fill='#ff40ff',width=3)
        draw.text(tuple(center),f'P{i}',fill='#ff40ff',font=font,stroke_width=2,stroke_fill='black')
        pads.append({'padIndex':i,'sourceId':pad.get('sourceId'),'originalShape':pad,'pixelRing':ring,'centerPixel':center})
    marks=[]
    for i,mark in enumerate(hole['tees']['marks']):
        x,y=pixel(mark['c'])
        draw.ellipse((x-8,y-8,x+8,y+8),outline='#00ffff',width=2)
        draw.text((x+10,y+3+i%2*17),f'M{i+1}',fill='#00ffff',font=font,stroke_width=2,stroke_fill='black')
        marks.append({'index':i,'originalShape':mark,'pixel':[x,y],'classification':'nominal scorecard reference; not an observed physical marker'})
    x,y=pixel(hole['line'][0])
    draw.line([(x-12,y),(x+12,y)],fill='#ffff00',width=3)
    draw.line([(x,y-12),(x,y+12)],fill='#ffff00',width=3)
    overlay_path=args.out/'overlay.png'
    overlay.save(overlay_path)
    data={'schemaVersion':1,'hole':args.hole,'frame':frame,'modelPath':args.model.as_posix(),'modelSha256':hashlib.sha256(args.model.read_bytes()).hexdigest(),'plainPath':plain_path.as_posix(),'plainSha256':hashlib.sha256(plain_path.read_bytes()).hexdigest(),'overlayPath':overlay_path.as_posix(),'pixelSize':[width,height],'extentEPSG3006':bounds,'geoTransform':list(transform.to_gdal()),'pixelCoordinateConvention':'Pixel edges: E=gt0+x*gt1+y*gt2, N=gt3+x*gt4+y*gt5','resampling':'bilinear for display only; native source remains authoritative','projection':'pyproj EPSG4326 to EPSG3006 using exact model.origin, mPerLon and mPerLat; no fitted registration','source':source,'pads':pads,'nominalReferences':marks,'routeStart':{'local':hole['line'][0],'pixel':[x,y]},'legend':{'magenta':'existing physical pad P0...','cyan':'nominal references M1...; not observed markers','yellowCross':'existing route start'}}
    (args.out/'panel.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    print(args.out/'panel.json')


if __name__=='__main__':
    main()
