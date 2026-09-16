"""Post-evaluation diagnostics; cannot select settings or change frozen references."""
from prepare import *
from scipy.stats import norm

def sampled(line):
 if line.is_empty:return []
 if line.geom_type in ['LineString','LinearRing']:return [line.interpolate(d) for d in np.arange(0,line.length,1)]
 return [p for part in line.geoms for p in sampled(part)]

def polygons(g):
 if g.is_empty:return []
 if g.geom_type=='Polygon':return [g]
 return [p for part in getattr(g,'geoms',[]) for p in polygons(part)]

def main():
 bench=read(DOC/'benchmark.json');detail=read(OUT/'benchmark-details.json');selected=bench['selection']['selected'];paired=[]
 for scene in read(OUT/'scenes.json'):
  if scene['split']!='evaluation':continue
  rows=[next(r for r in detail[m] if r['scene']==scene['id']) for m in ['node-current',selected]]
  indices=[{p[0]:k for k,p in enumerate(r['pairs'])} for r in rows];common=indices[0].keys()&indices[1].keys()
  refs=[f for f in read(DOC/'reference.geojson')['features'] if f['properties'].get('scene')==scene['id'] and f['properties']['role']=='crown']
  for i in sorted(common):paired.append(dict(id=refs[i]['properties']['id'],**{m:dict(centreMetres=r['distances'][index[i]],iou=r['ious'][index[i]]) for m,r,index in zip(['node-current',selected],rows,indices)}))
 save(DOC/'paired-diagnostic.json',dict(phase='Post-evaluation diagnostic, not used to select settings',referenceIds=[p['id'] for p in paired],pairs=paired,
  summary={m:dict(count=len(paired),medianCentreMetres=float(np.median([p[m]['centreMetres'] for p in paired])),meanIoU=float(np.mean([p[m]['iou'] for p in paired]))) for m in ['node-current',selected]}))
 scenes={s['id']:s for s in read(OUT/'scenes.json')};polygons={
 'cal14':[(70,0),(100,0),(100,38),(94,37),(87,40),(88,50),(83,53),(80,50),(81,42),(76,38),(72,33),(69,29),(69,16),(73,14),(74,6)],
 'cal05':[(20,10),(27,10),(27,20),(25,24),(34,28),(32,31),(30,38),(33,42),(29,50),(30,55),(31,66),(30,72),(36,78),(28,83),(27,90),(12,90),(15,78),(12,71),(12,67),(15,57),(17,50),(17,45),(16,40),(18,33),(19,28),(21,24),(20,19)]}
 areas={'cal14':[65,0,100,58],'cal05':[10,10,40,90]};fs=[];metrics=[]
 def geo(id,pts):
  w,s,e,n=scenes[id]['bounds'];return Polygon([(w+x,n-y) for x,y in pts])
 occupied={m:[shape(f['geometry']) for file in [f'{m}-woodland-coverage.geojson',f'{m}-individual-coverage.geojson'] for f in read(DOC/file)['features']] for m in ['before','after']}
 for id,vertices in polygons.items():
  ref=geo(id,vertices);x,y,u,v=areas[id];roi=geo(id,[(x,y),(u,y),(u,v),(x,v)]);inner=roi.buffer(-1)
  fs.extend([feature(ref,role='interpreted-canopy-envelope',scene=id,uncertaintyMetres=2),feature(roi,role='edge-scoring-region',scene=id)])
  row=dict(scene=id,referenceAreaMetres2=ref.area)
  for mode in ['before','after']:
   pred=unary_union([p for g in occupied[mode] if g.intersects(roi) for p in polygons(g.intersection(roi))])
   rb=ref.boundary.intersection(inner);pb=unary_union([p.boundary for p in polygons(pred)]).intersection(inner)
   forward=[p.distance(pb) for p in sampled(rb)] if not pb.is_empty else []
   reverse=[p.distance(rb) for p in sampled(pb)] if not rb.is_empty else []
   row[mode]=dict(omissionMetres2=ref.difference(pred).area,commissionMetres2=pred.difference(ref).area,
    referenceToPredicted=dict(meanMetres=float(np.mean(forward)),p95Metres=float(np.quantile(forward,.95)),samples=len(forward)) if forward else None,
    predictedToReference=dict(meanMetres=float(np.mean(reverse)),p95Metres=float(np.quantile(reverse,.95)),samples=len(reverse)) if reverse else None)
  metrics.append(row)
 clearings=[]
 for id,(x,y,u,v) in {'cal07':[25,5,60,55],'cal17':[10,50,90,90],'eval09':[5,5,95,95]}.items():
  roi=geo(id,[(x,y),(u,y),(u,v),(x,v)]);fs.append(feature(roi,role='source-interpreted-clearing',scene=id))
  clearings.append(dict(scene=id,areaMetres2=roi.area,occupiedMetres2={m:unary_union([g.intersection(roi) for g in occupied[m] if g.intersects(roi)]).area for m in ['before','after']}))
 save(DOC/'edge-clearing-reference.geojson',dict(**collection(fs),phase='Post-evaluation source interpretation; approximate height-anchored envelope and open-ground controls, not independent accuracy certification'))
 save(DOC/'edge-clearing-diagnostic.json',dict(phase='Descriptive, post-evaluation, no retuning',boundaryUncertaintyMetres=2,samplingMetres=1,edgeMetrics=metrics,clearings=clearings,
  caveats=['Two local envelopes, not a facility-wide forest-boundary accuracy estimate.','Occupancy combines fields with crown circles; it is not the drawn canopy silhouette.','Clip boundaries excluded from distance sampling by 1 m.']))
 print('Paired references',len(paired),'edge envelopes',len(metrics),'clearings',len(clearings))

if __name__=='__main__':main()
