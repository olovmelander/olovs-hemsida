"""Add reviewed native-pixel roof/surface observations to the reference inventory.

Run after prepare-ortho-reference.py. Neither script edits runtime geometry.
"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent

def read(path):return json.loads(path.read_text(encoding='utf8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def main():
    reference=read(HERE/'orthophoto-reference.json')
    panels={p['id']:p for p in reference['panels']}
    observation=read(HERE/'orthophoto-reference.observations.json')
    inventory=read(HERE/'facility-inventory.json')
    inventory['facilities']=[f for f in inventory['facilities'] if f.get('inheritedModel')]
    by_id={f['id']:f for f in inventory['facilities']}
    origin=reference['blenderFrame']['originEpsg3006']
    project=Transformer.from_crs(4326,3006,always_xy=True)
    unproject=Transformer.from_crs(3006,4326,always_xy=True)
    model=read(ROOT/'puttombuild/course-model.json')
    def grid(pts):return [list(project.transform(model['origin']['lon']+x/model['mPerLon'],model['origin']['lat']-z/model['mPerLat'])) for x,z in pts]
    def pixels(pts,panel):
        b=panel['boundsEpsg3006'];r=panel['pixelSizeMetres']
        return [[round(b[0]+u*r,4),round(b[3]-v*r,4)] for u,v in pts]
    def center(ring):return [sum(p[i] for p in ring)/len(ring) for i in (0,1)]
    def blender(ring):return [[e-origin[0],n-origin[1]] for e,n in ring]
    roofs=[]
    for entry in observation['roofs']:
        panel=panels[entry['panel']]
        ring=pixels(entry['pixelRing'],panel)
        c=center(ring)
        xz=[]
        for e,n in ring:
            lon,lat=unproject.transform(e,n)
            xz.append([(lon-model['origin']['lon'])*model['mPerLon'],(model['origin']['lat']-lat)*model['mPerLat']])
        roof=dict(id=entry['id'],label=entry['label'],sourcePanel=entry['panel'],
            sourceImage=panel['png'],sourcePngSha256=panel['pngSha256'],pixelRing=entry['pixelRing'],
            pixelConvention=observation['pixelConvention'],ringEpsg3006=ring,ringBlenderXY=blender(ring),
            ringLegacyLocalXZ=xz,centerEpsg3006=c,centerBlenderXY=blender([c])[0],
            geometryRole='roof-outline-observation',confidence=entry['confidence'],notes=entry['notes'],
            inheritedIds=entry['inheritedIds'],captureDate=reference['captureDate'])
        roofs.append(roof)
        for legacy_id in entry['inheritedIds']:
            target=by_id[legacy_id]
            target['observedRoof']=roof
            target['physicalRoofId']=roof['id']
            target['observationStatus']='matched-roof-observation-not-wall-footprint'
        if not entry['inheritedIds']:
            inventory['facilities'].append(dict(id=entry['id'],label=entry['label'],
                scope='clubhouse-range-maintenance',purposeStatus='unverified-from-orthophoto',
                inheritedModel=None,observedRoof=roof,physicalRoofId=roof['id'],
                centerEpsg3006=c,centerLonLat=list(unproject.transform(*c)),centerBlenderXY=blender([c])[0],
                observationStatus='additional-roof-or-canopy-observation'))
    for item in observation['unmatchedInheritedIds']:
        by_id[item['id']]['observationStatus']=item['status']
        by_id[item['id']]['observationNotes']=item['notes']
    non=[]
    for b in model['infra']['parking']:
        ring=grid(b['ring'])
        non.append(dict(id=b['id'],label=b['id'],kind='parking-or-hardscape',geometryRole='inherited-surface-outline',
            ringEpsg3006=ring,ringBlenderXY=blender(ring),ringLocalXZ=b['ring'],
            confidence='unverified-inherited-geometry',surface=b.get('surface'),vehicles=b.get('vehicles'),
            notes='Native 2024 overview provides visual context; this inherited outline has not been manually retraced here.'))
    for kind in ['greens','bunkers','range']:
        for i,pts in enumerate(model['scenery'].get(kind,[])):
            ring=grid(pts)
            non.append(dict(id=f'practice-{kind}-{i+1}',label=f'Practice {kind} {i+1}',kind=kind,
                geometryRole='inherited-surface-outline',ringEpsg3006=ring,ringBlenderXY=blender(ring),
                ringLocalXZ=pts,confidence='inherited-scenery-geometry-see-mapping-review',
                notes='Retained context shape from current course model; not a new surveyed facility boundary.'))
    rf=model['scenery'].get('rangeFacilities',{})
    for i,pts in enumerate(rf.get('nets',[])):
        ring=grid(pts)
        non.append(dict(id=f'inherited-range-net-{i+1}',label='Range net alignment',kind='line',
            geometryRole='inherited-line',lineEpsg3006=ring,lineBlenderXY=blender(ring),
            confidence='unverified-inherited-geometry',heightMetres=rf.get('netHeight'),
            heightStatus='inherited-estimate-not-measured',notes='Post line visible in overview; exact pole heights/sag unmeasured.'))
    if rf.get('bays'):
        ring=grid(rf['bays'])
        non.append(dict(id='inherited-range-bays',label='Inherited representative range bay anchors',kind='point-set',
            geometryRole='inherited-points',pointsEpsg3006=ring,pointsBlenderXY=blender(ring),
            confidence='unverified-inherited-geometry',notes='Seven coarse representative anchors; use observed mat points for reference layout.'))
    for entry in observation['nonBuildingObservations']:
        panel=panels[entry['panel']]
        item={k:v for k,v in entry.items() if not k.startswith('pixel')}
        item.update(geometryRole='image-observation',captureDate=reference['captureDate'],sourceImage=panel['png'])
        for key,out in [('pixelRing','ring'),('pixelLine','line'),('pixelPoints','points')]:
            if key in entry:
                pts=pixels(entry[key],panel)
                item[key]=entry[key];item[out+'Epsg3006']=pts;item[out+'BlenderXY']=blender(pts)
        non.append(item)
    inventory['roofObservations']=roofs
    inventory['nonBuildingFacilities']=non
    inventory['unlocatedFacilities']=observation['unlocatedFacilities']
    inventory['summary']=dict(inheritedBuildings=40,inheritedSitePieces=17,physicalRoofObservations=len(roofs),
        additionalRoofOrCanopyObservations=sum(not r['inheritedIds'] for r in roofs),
        unmatchedInheritedSitePieces=len(observation['unmatchedInheritedIds']),
        inheritedSurroundingBuildings=23,nonBuildingRecords=len(non),
        notes='Physical roof observations include low-confidence canopies/candidates; this count is not a verified building count. Western lakeside ownership/function unverified.')
    write(HERE/'facility-inventory.json',inventory)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
    for panel in panels.values():
        im=Image.open(ROOT/panel['inheritedOverlay']).convert('RGB');draw=ImageDraw.Draw(im)
        b=panel['boundsEpsg3006'];res=panel['pixelSizeMetres']
        def coords(pts):return [((e-b[0])/res,(b[3]-n)/res) for e,n in pts]
        for roof in roofs:
            c=roof['centerEpsg3006']
            if not(b[0]<c[0]<b[2] and b[1]<c[1]<b[3]):continue
            pts=coords(roof['ringEpsg3006']);draw.line(pts+[pts[0]],fill='#27edf5',width=3)
        for item in non:
            if item['geometryRole']!='image-observation':continue
            pts=item.get('ringEpsg3006') or item.get('lineEpsg3006') or item.get('pointsEpsg3006')
            pp=coords(pts)
            if item.get('pointsEpsg3006'):
                for x,y in pp:draw.ellipse((x-4,y-4,x+4,y+4),outline='#ea63ff',width=2)
            else:draw.line(pp+([pp[0]] if item.get('ringEpsg3006') else []),fill='#ea63ff',width=3)
        draw.rectangle((5,5,min(im.width-5,640),34),fill='#121c24')
        draw.text((10,9),'AMBER inherited  |  CYAN roof observation  |  MAGENTA facility',font=font,fill='white')
        path=(ROOT/panel['png']).with_name(panel['id']+'-review-overlay.png');im.save(path)
        panel['reviewOverlay']=path.relative_to(ROOT).as_posix()
    reference['observationFile']='puttombuild/facilities/orthophoto-reference.observations.json'
    reference['inventoryFile']='puttombuild/facilities/facility-inventory.json'
    write(HERE/'orthophoto-reference.json',reference)
    print(json.dumps(inventory['summary']))

if __name__=='__main__':main()
