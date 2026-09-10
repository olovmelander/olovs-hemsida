"""Small ground mesh for Blender model renders; never exported to the game."""
import json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT/'puttombuild/cache/facilities-model-2026-09-10'
raw = json.loads((ROOT/'puttombuild/cache/facilities-reference-2026-09-10/laser/points.json').read_text())
points = np.array(raw['points'])
ground = points[points[:,3]==2,:3]
tree = cKDTree(ground[:,:2])
xs,ys = np.arange(697230,697630,4),np.arange(7025110,7025474,4)
xy = np.array([(x,y) for y in ys for x in xs])
distances,indices = tree.query(xy,k=6)
weights = 1/np.maximum(.15,distances)**2
height = np.sum(weights*ground[indices,2],axis=1)/np.sum(weights,axis=1)
vertices = np.c_[xy-[697365,7025190],height-44].round(4).tolist()
faces=[]
for row in range(len(ys)-1):
    for col in range(len(xs)-1):
        a=row*len(xs)+col
        corners=[a,a+1,a+1+len(xs),a+len(xs)]
        if all(distances[i,0]<12 for i in corners):
            faces.append(corners)
CACHE.mkdir(parents=True,exist_ok=True)
(CACHE/'preview-ground.json').write_text(json.dumps({'verticesLocalENH':vertices,'faces':faces,'productionGeometry':False},separators=(',',':')))
print(json.dumps({'vertices':len(vertices),'faces':len(faces),'exportedToGame':False}))
