"""Reuse identical detector windows and verified imagery without re-reviewing scope."""
from round5 import *

def main():
    check_lock();previous={}
    for name in ['round3','round4']:
        for s in read(OUT/name/'review-scenes.json'):previous[tuple(s['ownedBounds'])]=(OUT/name,s)
    counts=dict(detections=0,imagery=0)
    for scene in read(WORK/'review-scenes.json'):
        if tuple(scene['ownedBounds']) not in previous:continue
        directory,old=previous[tuple(scene['ownedBounds'])];sid=scene['id'];oid=old['id']
        detection=directory/'detections'/(oid+'-dalponte-d9-m5.tif')
        if detection.exists():
            target=WORK/'detections'/(sid+'-dalponte-d9-m5.tif');shutil.copyfile(detection,target);counts['detections']+=1
        valid=directory/'review'/(oid+'-valid.png')
        if not valid.exists():continue
        meta=read(directory/'review'/(oid+'.json'));bounds=[scene['easting']-65,scene['northing']-65,scene['easting']+65,scene['northing']+65]
        assert bounds==meta['bounds'];assert digest(directory/'review'/(oid+'-rgbi.tif'))==meta['rasterSha256']
        with rasterio.open(directory/'review'/(oid+'-rgbi.tif')) as src:
            mask=geometry_mask([mapping(box(*scene['ownedBounds']).intersection(extension()).difference(protected()))],out_shape=(src.height,src.width),transform=src.transform,invert=True)
        fraction=float(np.mean(np.asarray(Image.open(valid))[mask]>0));assert fraction==1
        for suffix in ['-rgbi.tif','-valid.png','-rgb.png','-cir.png','-chm.png','-2022.png']:
            shutil.copyfile(directory/'review'/(oid+suffix),WORK/'review'/(sid+suffix))
        meta.update(scene);meta['validOwnedImageFraction']=fraction;meta['reusedFrom']=str((directory/'review'/(oid+'.json')).relative_to(ROOT)).replace(chr(92),'/')
        save(WORK/'review'/(sid+'.json'),meta);counts['imagery']+=1
    save(DOC/'cache-reuse.json',counts);check_lock();print(counts)

if __name__=='__main__':main()
