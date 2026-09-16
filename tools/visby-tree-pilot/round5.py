"""Full-facility tree treatment review, extending the retained corridor checkpoint.

The facility outline selects cells. Dense woodland is a treatment, not an
individual stem census; source availability and inspection remain separate.
"""
from round4 import *
import round4 as previous_tool

PREVIOUS=OUT/'round4'
PRIOR_DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round4'
WORK=OUT/'round5'
DOC=PRIOR_DOC.parent/'round5'
PLAYING_CORRIDOR=previous_tool.corridor

def facility():
    return shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry'])

def extension():
    return facility().difference(PLAYING_CORRIDOR())

def check_lock():
    for name,value in read(DOC/'input-lock.json')['sha256'].items():
        assert digest(ROOT/name)==value,'Frozen input changed: '+name

def plan():
    WORK.mkdir(exist_ok=True);DOC.mkdir(parents=True,exist_ok=True)
    for name in ['review','detections']:(WORK/name).mkdir(exist_ok=True)
    osm_path=ROOT/'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson'
    source=next(f for f in read(osm_path)['features'] if f['properties'].get('tags',{}).get('leisure')=='golf_course')
    scope=unary_union([shape(source['geometry']),PLAYING_CORRIDOR()])
    assert scope.is_valid and scope.geom_type=='Polygon'
    inventory_path=ROOT/'visbybuild/facilities/facility-inventory.json'
    buildings=[f for f in read(inventory_path)['facilities'] if f.get('scope')=='club-facilities' and f.get('footprintEpsg3006')]
    assert all(scope.covers(Polygon(f['footprintEpsg3006'])) for f in buildings),'Club facility outside scope'
    save(DOC/'facility-scope.geojson',collection([dict(type='Feature',geometry=mapping(scope),properties=dict(
        id='visby-full-facility-review',role='review-scope-not-legal-property-boundary',areaMetres2=scope.area,
        source=str(osm_path.relative_to(ROOT)).replace(chr(92),'/'),sourceSha256=digest(osm_path),osmProperties=source['properties'],
        review='Agent inspected retained 2022 whole-facility image and checked all 13 inventoried club facilities plus retained playing/practice corridor.',
        adjustment='Union with earlier corridor preserves a small shoreline margin; no previous coverage is discarded.',
        includes='Main 18 holes, supplementary golf land/short-course areas, clubhouse, driving range, practice areas, service buildings, woodland and connecting land.',
        limitation='Cartographic review extent, not a cadastral or surveyed boundary.'))]))
    frozen={**read(PRIOR_DOC/'input-lock.json')['sha256']}
    paths=[PREVIOUS/'publication.json',PREVIOUS/'pilot-records.json',PREVIOUS/'pilot-footprints.geojson',PREVIOUS/'stand-output/index.json',
        PRIOR_DOC/'corrections.json',PRIOR_DOC/'coverage.geojson',PRIOR_DOC/'issue-index.json',PRIOR_DOC/'reproduction-lock.json',DOC/'facility-scope.geojson',osm_path,inventory_path]
    paths += [ROOT/k for k in read(PRIOR_DOC/'reproduction-lock.json')['sha256']]
    paths += [PREVIOUS/j['file'] for j in read(PREVIOUS/'stand-output/index.json')]
    for p in paths:frozen[str(p.relative_to(ROOT)).replace(chr(92),'/')]=digest(p)
    lock=dict(previous='round4',sha256=frozen)
    if (DOC/'input-lock.json').exists():assert read(DOC/'input-lock.json')==lock
    else:save(DOC/'input-lock.json',lock)
    old={f['properties']['id']:f for f in read(PRIOR_DOC/'coverage.geojson')['features']}
    lines={h['n']:LineString(h['line']) for h in read(OUT/'exclusions.json')['geometry']['holes']}
    features=[];scenes=[];w,s,e,n=scope.bounds;added=extension();reserved=protected()
    for x in range(int(np.floor(w/100))*100,int(np.ceil(e/100))*100,100):
        for y in range(int(np.floor(s/100))*100,int(np.ceil(n/100))*100,100):
            cell=box(x,y,x+100,y+100);owned=cell.intersection(scope)
            if owned.area<.001:continue
            id=f'cell-{x}-{y}';extra=cell.intersection(added);editable=extra.difference(reserved);prior=old.get(id)
            p=dict(id=id,bounds=[x,y,x+100,y+100],areaMetres2=owned.area,priorCorridorAreaMetres2=owned.intersection(PLAYING_CORRIDOR()).area,
                extensionAreaMetres2=extra.area,reviewableAreaMetres2=editable.area,priorInspected=bool(prior and prior['properties'].get('inspected')),selected=editable.area>.001,
                status='unreviewed' if editable.area>.001 else prior['properties']['status'] if prior else 'protected-evaluation',
                inspected=False if editable.area>.001 else bool(prior and prior['properties'].get('inspected')),issueIds=[],
                holes=[h for h,line in lines.items() if owned.intersects(line.buffer(90))])
            if prior:p['priorCorridorStatus']=prior['properties']['status']
            if p['selected']:
                sid=f'r5-{len(scenes)+1:03}';p['scene']=sid
                scenes.append(dict(id=sid,cellId=id,easting=x+50,northing=y+50,size=100,ownedBounds=p['bounds'],
                    hole=min(lines,key=lambda h:lines[h].distance(cell.centroid)),holes=p['holes'],split='full-facility-placement-review'))
            features.append(dict(type='Feature',geometry=mapping(owned),properties=p))
    save(DOC/'coverage-plan.geojson',collection(features));save(WORK/'review-scenes.json',scenes)
    save(DOC/'protocol.json',dict(scope='Full facility polygon, with new review of all area outside the previously inspected corridor.',
        areaMetres2=scope.area,extensionAreaMetres2=added.area,gridCells=len(features),newReviewCells=len(scenes),
        treatment='Distinct open-grown, play/view-relevant and facility/path-side crowns as individuals; connected dense woodland as measured stands, preserving edges and gaps. No automatic stem census.',
        display='Facility boundary, 100 m cell, owned review extension and treatment geometry have separate labels/colours.',
        ownership='Half-open 100 m cells. New candidate centres outside the previous corridor; full crown geometry and 20 m detector halo. Protected evaluation unchanged.',
        completion='Every part of facility must have a source/treatment review status; ambiguous/protected/no-data area is explicit and cannot count as passed.'))
    target=WORK/'chm.tif'
    if not target.exists():shutil.copyfile(OUT/'chm.tif',target)
    assert digest(target)==digest(OUT/'chm.tif');check_lock()
    print('Facility cells',len(features),'extension cells',len(scenes),'area',scope.area,'extension',added.area,flush=True)

def configure():
    # Reuse the audited pixel/band/detector implementation under this new scope.
    for key,value in dict(PREVIOUS=PREVIOUS,PRIOR_DOC=PRIOR_DOC,WORK=WORK,DOC=DOC,check_lock=check_lock,corridor=extension).items():setattr(previous_tool,key,value)

if __name__=='__main__':
    if '--plan' in sys.argv:plan()
    else:
        configure()
        if '--candidates' in sys.argv:previous_tool.candidates()
        else:previous_tool.sources()
