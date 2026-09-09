"""Reproduce fixed review panels directly from verified RGB PNGs and their grids.

Uses PIL's explicit geometric transform and rectangle validity, avoiding TIFF
fourth-band alpha inference. This only renders diagnostic review images.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
REPORT=ROOT/'johannesbergbuild/cache/lm-review/back9-native/panels.json'

def main():
    report=json.loads(REPORT.read_text())
    for panel in report['panels']:
        w,s,e,n=panel['extentEPSG3006']; width,height=panel['pixelSize']
        dx=(e-w)/width;dy=(n-s)/height
        output=Image.new('RGB',(width,height)); covered=np.zeros((height,width),dtype=bool)
        used=[]
        for source in panel['sources']:
            source_path=Path(source['path']); source_path=source_path if source_path.is_absolute() else ROOT/source_path
            source_path=source_path.with_suffix('.png')
            ledger=json.loads(source_path.with_suffix('.json').read_text())
            sw,ss,se,sn=ledger['boundsEpsg3006']; sr=ledger['resolutionMetres']
            raw=source_path.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=ledger['rgbSha256']: raise ValueError('Source PNG hash mismatch')
            im=Image.open(source_path).convert('RGB')
            # PIL transform addresses pixel centres; compensate for the half
            # pixel when target and source sampling intervals differ.
            transform=(dx/sr,0,(w-sw)/sr+(dx/sr-1)/2,0,dy/sr,(sn-n)/sr+(dy/sr-1)/2)
            projected=im.transform((width,height),Image.Transform.AFFINE,transform,Image.Resampling.BILINEAR)
            xs=w+(np.arange(width)+.5)*dx; ys=n-(np.arange(height)+.5)*dy
            valid=(xs[None,:]>=sw)&(xs[None,:]<se)&(ys[:,None]>ss)&(ys[:,None]<=sn)
            if valid.any():
                output.paste(projected,(0,0),Image.fromarray(valid.astype('uint8')*255)); covered|=valid
                used.append({**source,'path':source_path.relative_to(ROOT).as_posix(),'sha256':ledger['rgbSha256']})
        if not covered.all() or not np.asarray(output).any(): raise ValueError('Blank or incomplete panel')
        output.save(panel['plainPath']); panel['plainSha256']=hashlib.sha256(Path(panel['plainPath']).read_bytes()).hexdigest()
        overlay=output.copy();draw=ImageDraw.Draw(overlay)
        colours={'green':'cyan','bunker':'yellow','tee':'white','fairway':'magenta','water':'#408dff','path':'orange','building':'white'}
        for feature in panel['shapes']:
            coords=[tuple(p) for p in feature.get('originalShapePanelPixelRing',feature.get('originalShapePanelPixelPoints',[]))]
            if len(coords)>1: draw.line(coords+([coords[0]] if feature['closed'] else []),fill=colours.get(feature['kind'],'#ffbbff'),width=2)
        for x in range(0,width,100): draw.line([(x,0),(x,height)],fill='#888888',width=1);draw.text((x+2,2),str(x),fill='white',stroke_width=1,stroke_fill='black')
        for y in range(100,height,100): draw.line([(0,y),(width,y)],fill='#888888',width=1);draw.text((2,y+2),str(y),fill='white',stroke_width=1,stroke_fill='black')
        overlay.save(panel['overlayPath']);panel['overlaySha256']=hashlib.sha256(Path(panel['overlayPath']).read_bytes()).hexdigest()
        panel['sources']=used
        panel['resampling']='Pillow bilinear RGB with explicit rectangle mask; TIFF NIR never treated as alpha'
    REPORT.write_text(json.dumps(report,indent=2)+'\n')
    print(f'{len(report["panels"])} RGB panels verified and rendered')

if __name__=='__main__': main()
