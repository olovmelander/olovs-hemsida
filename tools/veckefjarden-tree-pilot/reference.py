"""Independent, agent-interpreted source reference. No detector outputs are read.

Coordinates below were marked visually on the frozen RGB/CHM source panels,
in metres east/down from their northwest corner. Ellipses approximate crowns,
not stem surveys. Overlapping interiors are explicitly outside scoring.
"""
from prepare import *
from shapely.affinity import scale

# x, down, east/west radius, north/south radius; no algorithm-derived centres.
CROWNS={
'cal12':[(23,14.5,5,5),(23,28,4,4),(22,36,6,6),(83,77.5,2.5,3)],
'cal11':[(8.5,20,3.5,3),(13,18,3,3),(18,19,3,3),(34.5,24,4,4.5),(34,33,4.5,5),(30,44,3.5,5),(26,34,4,4),(33,55,2.5,3),(47,52,5,5),(50,63,4.5,5),(56,56,3,4),(63,61,4,4),(68,61,3.5,3.5)],
'cal07':[(76.5,9.5,3,4.5),(69.5,19,2.5,2.5),(76,23.5,3,2.5),(75,31.5,2.5,2.5),(74.5,37.5,2.5,3),(71.5,55,2.5,3),(68,61.5,2.5,2.5),(65.5,67.5,2,2.5),(42,69,4.5,4),(36,74,3,4),(54,69,4,4),(55,79,4,3.5),(26,76.5,3.5,3),(18,81,3,3)],
'cal17':[(26,8,3,3),(63,9,2.5,2.5),(61.5,14,3,3),(60,19,3,3),(62,25,4,4),(49,26,3,4),(59,33,2.5,3),(63,35.5,3,3),(60,43,2.5,2.5),(73,39,4,3)],
'cal18':[(63,32,4,4),(64,38,3.5,3),(72,29,2,2.5),(83,35,3,3),(83,30,2.5,2.5)],
'cal05':[(24,7,4,4),(23,16,4,5),(23,23,4,4),(23,31,5,5),(24,37,4,4),(24,45,5,5),(22,54,5,5),(19,62,5,5),(21,70,5,4),(24,77,6,5),(21,85,5,4),(19,92,5,4)],
'calshort':[(7.5,26,2.5,3),(25,55,2.5,3),(46,18,3,3),(54,24,4,5),(63,18,5,5),(46,66,2.5,2.5),(55,64,3,2),(53,71,3.5,4),(40,72,3,3),(34,74,3,4),(33,80,3,3),(49,78,3,3),(53,85,3,3),(48,92,3,3),(25,90,3,2.5)],
'calcampus':[(59,13,5,3),(15,63,5,5),(30,66,5,5),(48,62,4,4),(55,55,5,4),(63,56,4,4)],
'cal04':[(36,8,3,4),(6,25,4,4),(81,67,3,3),(82,76,3,3),(69,81,2.5,3),(64,78,3,3)],
'cal14':[(84,44,3,5)],
'cal10':[(64,46,3.5,3.5),(35,55,5,4),(36,64,4,4),(64,63,6,4),(71,68,6,5),(70,76,4,4),(90,72,5,5),(78,81,4,5)],
'eval09':[],
'eval16':[(36,5,3,3),(48,6,4,4),(51,13,2,4),(56,22,2.5,3),(12,82,5,4),(26,85,6,5),(40,80,5,5),(49,83,5,5),(59,85,5,5),(71,75,6,5),(80,72,5,5),(78,84,5,6),(93,76,6,5),(94,86,5,6)],
'eval02':[(23,16,4,5),(21,28,5,3),(31,5,5,4),(47,38,4,4),(53,44,4,4),(60,17,3.5,4),(72,33,4,4),(80,36,4,4),(81,26,4,3),(94,25,4,3),(93,34,3,3),(92,48,4,4),(91,12,4,3),(86,7,4,4),(67,5,4,4),(85,15,4,3),(57,26,4,4),(38,94,4,4)],
'evalrange':[],
}
# Source-visible areas where individual identity is ambiguous. Buildings and
# open grass/water remain scoring negatives. Clear crowns within these broad
# woodland envelopes retain their footprint + 1 m as an interpretable area.
AMBIG={
'cal12':[(0,0,80,10),(32,0,81,38),(96,65,100,100)],
'cal11':[(20,20,78,69),(0,68,100,100)],
'cal07':[(0,32,10,65),(48,65,61,83),(0,86,100,100)],
'cal17':[(29,0,50,19),(70,34,78,44)],
'cal18':[(0,0,100,42)],
'cal05':[(0,0,13,100),(12,0,38,100)],
'calshort':[(0,0,50,13),(60,24,100,70),(30,66,60,100),(16,86,30,100)],
'calcampus':[(61,0,100,48),(5,51,100,100)],
'cal04':[(0,85,100,100),(56,63,92,85)],
'cal14':[(65,0,100,41)],
'cal10':[(0,0,35,50),(29,49,85,100)],
'eval09':[],
'eval16':[(0,0,30,25),(0,68,100,100)],
'eval02':[(0,0,100,52),(0,85,100,100)],
'evalrange':[(50,0,100,100)],
}

def main():
 check_lock();assert not (OUT/'detections').exists(),'Freeze reference before candidate generation'
 fs=[];counts={'calibration':0,'evaluation':0}
 for scene in read(OUT/'scenes.json'):
  id=scene['id'];w,s,e,n=scene['bounds'];ellipses=[];rows=[]
  for i,(x,y,rx,ry) in enumerate(CROWNS[id]):
   p=Point(w+x,n-y);g=scale(p.buffer(1,quad_segs=32),rx,ry);ellipses.append(g)
   rows.append(feature(g,role='crown',id=f'{id}-ref-{i+1:02}',scene=id,split=scene['split'],scorable=True,
    easting=p.x,northing=p.y,radiusEastMetres=rx,radiusNorthMetres=ry,
    centreUncertaintyMetres=2,boundaryUncertaintyMetres=2,
    interpretation='2026 height-supported crown centre; 2024 RGB shape/context; agent visual interpretation, approximate ellipse; not surveyed stem',
    sources=['laser:26f015-702_68','ortho-u2-2024:2024-06-27']))
  ambiguous=unary_union([box(w+x,n-v,w+u,n-y) for x,y,u,v in AMBIG[id]])
  if ellipses:ambiguous=ambiguous.difference(unary_union(ellipses).buffer(1))
  area=box(w+5,s+5,e-5,n-5).difference(ambiguous)
  for r in rows:assert area.covers(Point(r['properties']['easting'],r['properties']['northing'])),r['properties']['id']
  fs.extend(rows);counts[scene['split']]+=len(rows)
  fs.append(feature(area,role='scoring-area',scene=id,split=scene['split']))
  if not ambiguous.is_empty:fs.append(feature(ambiguous,role='ambiguous-canopy',scene=id,split=scene['split'],decision='No defensible exhaustive individual identities; exclude from accuracy denominator, retain woodland review'))
  fs.append(feature(box(*scene['bounds']),role='source-window',scene=id,split=scene['split']))
 assert sum(counts.values())>=100 and counts['evaluation']>=30,counts
 limits=['One agent reference interpretation; no independent human or stem survey.',
 'Purposive sample: clearly distinguishable crowns and open ground, not a random facility-wide accuracy estimate.',
 'Closed/ambiguous canopy is masked before detection; crown footprint plus 1 m is retained where an individual can be interpreted.',
 '2024 imagery predates 2026 LiDAR by two years. Low/changed vegetation remains uncertain.',
 'Approximate ellipses and 2 m interpretation uncertainty are judgments, not measured accuracy.']
 save(DOC/'reference.geojson',dict(**collection(fs),limits=limits))
 save(DOC/'reference-freeze.json',dict(counts=counts,sha256=digest(DOC/'reference.geojson'),windowLockSha256=digest(DOC/'reference-window-lock.json'),
  phase='Frozen before any Node/lidR candidate generation',methods=['published','node-current']+[f'{m}-d{d}-m3' for m in ['dalponte','silva'] for d in [5,7,9]],
  matchingToleranceMetres=4,rank=['F1','crown IoU','median centre disagreement'],maximumDetectorRounds=1,limits=limits))
 print(counts)

if __name__=='__main__':main()
