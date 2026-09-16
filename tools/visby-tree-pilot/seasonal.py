"""Dated 2022 seasonal interpretation, kept outside distributed/runtime assets."""
from prepare import *

def main():
    source=read(ROOT/'geo_data/course-v2/visby/reference/gotland-ortho-2022.json')
    file=ROOT/source['image']['path']
    if digest(file)!=source['image']['sha256']:raise ValueError('Seasonal image checksum changed')
    image=Image.open(file).convert('RGB');w,s,e,n=source['bboxEpsg3006'];scale=source['outputSampleSpacingMetres']
    for scene in read(OUT/'scenes.json'):
        meta=read(OUT/'review'/(scene['id']+'.json'));a,b,c,d=meta['bounds']
        crop=image.crop(((a-w)/scale,(n-d)/scale,(c-w)/scale,(n-b)/scale))
        crop.save(OUT/'review'/(scene['id']+'-2022.png'))
        canvas=Image.new('RGB',(1200,440),'#17202a');draw=ImageDraw.Draw(canvas)
        for i,(title,im) in enumerate([('2022 seasonal RGB; exact date unknown',crop),('2026-04-10 RGB',Image.open(OUT/'review'/(scene['id']+'-rgb.png'))),('2024 LiDAR canopy height',Image.open(OUT/'review'/(scene['id']+'-chm.png'))) ]):
            draw.text((i*400+10,12),title,fill='white');canvas.paste(im.resize((380,380)),(i*400+10,40))
        canvas.save(OUT/'review'/(scene['id']+'-seasonal.png'))
    save(OUT/'seasonal-source.json',dict(sourceId=source['sourceId'],campaignLabel='2022',captureDate=None,sha256=digest(file),
        use='Seasonal crown-shape interpretation only; older image cannot establish 2026 presence or current stem position.',licence=source['licence']))

if __name__=='__main__':main()
