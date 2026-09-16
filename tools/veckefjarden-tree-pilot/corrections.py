"""Bounded manual-crown promotion, without using the evaluation reference."""
from prepare import *
from rasterio.features import geometry_mask
from scipy.spatial import cKDTree

def propose():
 refs=read(DOC/'reference.geojson');baseline=read(OUT/'baseline-records.json')
 tree=cKDTree([(r['easting'],r['northing']) for r in baseline]);scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry'])
 protected=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry']);fs=[]
 with rasterio.open(OUT/'chm.tif') as src:
  for f in refs['features']:
   p=f['properties']
   if p['role']!='crown' or p['split']!='calibration':continue
   g=shape(f['geometry']);point=Point(p['easting'],p['northing']);distance,index=tree.query([point.x,point.y]);nearest=baseline[int(index)]
   win=from_bounds(*g.bounds,transform=src.transform).round_offsets().round_lengths();h=src.read(1,window=win)
   mask=geometry_mask([mapping(g)],out_shape=h.shape,transform=src.window_transform(win),invert=True)
   valid=h[mask&np.isfinite(h)];height=float(np.quantile(valid,.95)) if len(valid) else 0
   decision='proposed-individual'
   if distance<6:decision='retain-nearby-existing-individual'
   elif height<3:decision='unresolved-insufficient-height'
   elif not scope.covers(point) or protected.intersects(g):decision='outside-edit-scope'
   fs.append(feature(g,**p,decision=decision,heightMetres=height,radiusMetres=float(np.sqrt(g.area/np.pi)),nearestId=nearest['id'],nearestDistanceMetres=float(distance)))
 save(DOC/'correction-proposals.geojson',collection(fs));save(OUT/'probe-points.json',[dict(id=f['properties']['id'],easting=f['properties']['easting'],northing=f['properties']['northing']) for f in fs if f['properties']['decision']=='proposed-individual'])
 print('Proposals',sum(f['properties']['decision']=='proposed-individual' for f in fs),'of',len(fs),'source-reviewed calibration crowns')

def accept():
 fs=read(DOC/'correction-proposals.geojson')['features'];probes=read(OUT/'runtime-probes.json');base=read(OUT/'baseline-records.json');records=list(base);accepted=[];decisions=[]
 holds={r['id']:r for r in read(DOC/'runtime-holds.json')['holds']} if (DOC/'runtime-holds.json').exists() else {}
 for f in fs:
  p=f['properties'];decision=p['decision'];point=Point(p['easting'],p['northing'])
  if decision=='proposed-individual':
   checks=[next(r for r in run['rows'] if r['id']==p['id']) for run in probes]
   if p['id'] in holds:decision=holds[p['id']]['decision'];p['holdEvidence']=holds[p['id']]['evidence']
   elif any(r['blocked'] for r in checks):decision='held-runtime-ground-exclusion'
   elif any(point.distance(Point(q['easting'],q['northing']))<4 for q in accepted):decision='held-close-crown-identity'
   else:
    decision='accepted-source-reviewed-individual';id='veckefjarden-pilot-'+p['id']
    assert all(r['id']!=id for r in records)
    r=dict(id=id,groundId='veckefjarden',easting=point.x,northing=point.y,objectHeightMetres=p['heightMetres'],radiusMetres=p['radiusMetres'],
     sourceId='laser-lm-skog-26f015-702-68',capturedAt='2026-06-21',truthZone='A',confidence=.7,
     horizontalAccuracyMetres=2,verticalAccuracyMetres=1.5,pilotEdit=True,referenceId=p['id'])
    records.append(r);accepted.append(r);p['recordId']=id
   p['runtimeProbe']=checks
  p['decision']=decision;p['uncertainty']='2 m source interpretation floor; no surveyed trunk accuracy'
  decisions.append(f)
 save(OUT/'pilot-record-drafts.json',records)
 save(DOC/'corrections.geojson',collection(decisions))
 save(DOC/'corrections.json',dict(accepted=len(accepted),baselineRecords=len(base),afterRecords=len(records),
  decisions={key:sum(f['properties']['decision']==key for f in decisions) for key in sorted({f['properties']['decision'] for f in decisions})},
  policy='One bounded pass on source-reviewed calibration crowns; no evaluation labels applied, no baseline removals or image-centre moves; other individual identities remain unresolved until separately reviewed.'))
 print(read(DOC/'corrections.json'))

if __name__=='__main__':propose() if sys.argv[1]=='propose' else accept()
