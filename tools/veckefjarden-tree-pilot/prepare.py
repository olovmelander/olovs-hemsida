"""Veckefjarden source inventory, full-facility ownership grid and source panels."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from PIL import Image, ImageDraw
from matplotlib import colormaps
from shapely.geometry import Polygon, Point, LineString, box, shape, mapping
from shapely.ops import unary_union
from pyproj import Transformer

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/veckefjarden-tree-pilot'
DOC=ROOT/'geo_data/course-v2/veckefjarden/vegetation/reviews/2026-09-16'
CACHE=ROOT/'geobuild/cache/lm-ortho-veckefjarden'
def read(p):return json.loads(Path(p).read_text(encoding='utf-8'))
def save(p,d):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def digest(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def collection(fs):return dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=fs)
def feature(g,**props):return dict(type='Feature',geometry=mapping(g),properties=props)
def write_tif(p,a,t):
 if a.ndim==2:a=a[None]
 with rasterio.open(p,'w',driver='GTiff',width=a.shape[2],height=a.shape[1],count=a.shape[0],dtype=a.dtype,crs='EPSG:3006',transform=t,compress='deflate',tiled=True,nodata=np.nan if np.issubdtype(a.dtype,np.floating) else None) as dst:dst.write(a)
def check_lock():
 for name,value in read(DOC/'input-lock.json')['sha256'].items():assert digest(ROOT/name)==value,name

def plan():
 DOC.mkdir(parents=True,exist_ok=True);(OUT/'review').mkdir(exist_ok=True)
 base=read(OUT/'baseline.json');geos=read(OUT/'exclusions.json')['geometries']
 outline=Polygon(geos[0]['boundary']).buffer(0);surfaces=[];lines=[]
 for slug,g in zip(['veckefjarden','veckefjarden-korthalsbanan'],geos):
  for h in g['holes']:
   lines.append(dict(slug=slug,hole=h['n'],geometry=LineString(h['line'])))
   rings=h['fairway']['rings']+[h['green']['ring']]+[t['ring'] for t in h['tees']['pads']]+[b['ring'] for b in h['bunkers']]
   surfaces += [Polygon(r).buffer(0) for r in rings if len(r)>=3]
 anchor=unary_union([outline]+[a['geometry'].buffer(35) for a in lines]+surfaces)
 scenery=[]
 for k in ['greens','fairways','tees','range']:
  scenery += [Polygon(r).buffer(0) for r in geos[0]['scenery'][k] if Polygon(r).distance(anchor)<80]
 surfaces+=scenery
 corridor=unary_union(surfaces).buffer(30)
 local=read(ROOT/'geobuild/course-model.json');tx=Transformer.from_crs(4326,3006,always_xy=True)
 campus=[]
 # Reviewed campus roofs/surfaces; northern unverified neighbours are context only.
 for f in read(ROOT/'apps/golf/src/engine/scenery/veckefjarden-facility-footprints.json'):
  if f['id'] not in ['R01','R02','R03','R04','R05','R06','R07','R08','S01','S02','S03','S04']:continue
  ring=[tx.transform(local['origin']['lon']+x/local['mPerLon'],local['origin']['lat']-z/local['mPerLat']) for x,z in f['ring']]
  campus.append(Polygon(ring).buffer(25))
 scope=unary_union([outline,corridor]+[l['geometry'].buffer(35) for l in lines]+campus).buffer(0)
 # Facility review includes water/clearings inside its exterior, not just turf.
 scope=unary_union([Polygon(p.exterior) for p in (scope.geoms if scope.geom_type=='MultiPolygon' else [scope])])
 save(DOC/'facility-core.geojson',collection([feature(scope,role='original-facility-review-scope',areaMetres2=scope.area)]))
 expansion=read(DOC/'scope-expansion.json') if (DOC/'scope-expansion.json').exists() else dict(metres=0)
 scope=scope.buffer(expansion['metres']) if expansion['metres'] else scope
 save(DOC/'facility-scope.geojson',collection([feature(scope,role='full-facility-review-scope',areaMetres2=scope.area,
  provenance='Retained OSM course outline w59696110 union both routings/playing surfaces + 30 m (35 m line fallback), known campus + 25 m; interior holes included. Additional user-selected exterior belt recorded separately.',
  extraReviewBeltMetres=expansion['metres'],
  limitation='Review extent, not surveyed property boundary; neighbouring buildings are not assigned a golf use.')]))
 save(DOC/'playing-corridor.geojson',collection([feature(corridor,role='playing-practice-plus-30m')]))
 save(DOC/'routing-lines.geojson',collection([feature(l['geometry'],slug=l['slug'],hole=l['hole']) for l in lines]))
 w,s,e,n=scope.bounds;cells=[]
 for x in range(int(w//100)*100,int(e//100+1)*100,100):
  for y in range(int(s//100)*100,int(n//100+1)*100,100):
   owned=box(x,y,x+100,y+100).intersection(scope)
   if owned.area<.001:continue
   cells.append(feature(owned,id=f'cell-{x}-{y}',bounds=[x,y,x+100,y+100],status='unreviewed',inspected=False,areaMetres2=owned.area,
    holes=[f'{l["slug"]}:{l["hole"]}' for l in lines if l['geometry'].distance(owned)<60]))
 save(DOC/'coverage-plan.geojson',collection(cells))
 report=read(ROOT/'geo_data/course-v2/veckefjarden/acquisition/ortho-review.json');hashes={}
 for r in report['windows']:
  p=CACHE/r['rasterFile'];assert digest(p)==r['sha256'];hashes[p.relative_to(ROOT).as_posix()]=r['sha256']
  with rasterio.open(p) as src:
   assert src.count==4 and src.crs.to_epsg()==3006
   assert np.allclose(src.transform.to_gdal(),r['geoTransform'],atol=1e-8,rtol=0)
 paths=[OUT/'baseline.json',OUT/'baseline-records.json',OUT/'exclusions.json',ROOT/'apps/golf/public/courses/v2-index.json',
  ROOT/'geo_data/course-v2/veckefjarden/acquisition/ortho-review.json',ROOT/'geo_data/course-v2/veckefjarden/acquisition/laser-campaigns.json',
  ROOT/'geobuild/osm-features.json',ROOT/'geobuild/course-model.json',ROOT/'apps/golf/src/engine/scenery/veckefjarden-facility-footprints.json']
 paths += [p for p in (OUT/'build').rglob('*') if p.is_file()]
 paths += [OUT/'before'/f['url'] for f in base['identities']]
 hashes.update({p.relative_to(ROOT).as_posix():digest(p) for p in paths})
 lock=dict(sha256=hashes)
 if (DOC/'input-lock.json').exists():assert read(DOC/'input-lock.json')==lock
 else:save(DOC/'input-lock.json',lock)
 save(DOC/'protocol.json',dict(groundId='veckefjarden',slugs=['veckefjarden','veckefjarden-korthalsbanan'],holeCounts=[18,9],
  scopeAreaMetres2=scope.area,cells=len(cells),scopeBounds=list(scope.bounds),extraReviewBeltMetres=expansion['metres'],
  sourceDates=dict(lidar=['2026-06-01','2026-06-21'],rgbi='2024-06-27'),
  sourceLimit='Imagery predates LiDAR by two years. NIR supports vegetation interpretation; image absence is not proof of removal. No surveyed trunks.',
  stop='One full editable-facility inspection, bounded detector benchmark and one accepted-correction pass. Deliver local comparison with explicit exceptions even if targets are missed.',
  sampling='Freeze at least 100 source-interpreted crowns and 30 spatially separate evaluation crowns before candidate outputs. Reference windows will be locked separately before detection.',
  target=dict(precision=.9,recall=.9),centreConvention='LiDAR-derived source crown centre; no survey accuracy claim.',
  deployment='Isolated local preview of both shared routings; baseline remains production default.'))
 print(json.dumps(dict(cells=len(cells),area=scope.area,bounds=scope.bounds,baselineRecords=base['records'])))

REPORT=None
def rgbi_window(bounds,resolution=.16):
 global REPORT
 if REPORT is None:REPORT=read(ROOT/'geo_data/course-v2/veckefjarden/acquisition/ortho-review.json')
 w,s,e,n=bounds;cols=round((e-w)/resolution);rows=round((n-s)/resolution);t=from_origin(w,n,resolution,resolution)
 values=np.zeros((4,rows,cols),dtype=np.uint8);valid=np.zeros((rows,cols),dtype=np.uint8);sources=[]
 for r in REPORT['windows']:
  if not box(*r['boundsEpsg3006']).intersects(box(*bounds)):continue
  with rasterio.open(CACHE/r['rasterFile']) as src:
   if src.count!=4 or src.crs.to_epsg()!=3006:raise ValueError('Expected four-band RGBI in EPSG:3006')
   a=np.zeros_like(values);m=np.zeros_like(valid)
   reproject(rasterio.band(src,[1,2,3,4]),a,src_transform=src.transform,src_crs=src.crs,dst_transform=t,dst_crs=src.crs,resampling=Resampling.bilinear)
   reproject(src.dataset_mask(),m,src_transform=src.transform,src_crs=src.crs,dst_transform=t,dst_crs=src.crs,resampling=Resampling.nearest)
   values[:,m>0]=a[:,m>0];valid[m>0]=255
  sources.append(dict(id=r['id'],sha256=r['sha256'],dates=r['sources']))
 if not np.all(valid):raise ValueError('Incomplete RGBI footprint '+str(bounds))
 return values,t,sources
def chm_window(bounds):
 with rasterio.open(OUT/'chm.tif') as src:
  win=from_bounds(*bounds,transform=src.transform)
  assert np.allclose([win.col_off,win.row_off,win.width,win.height],np.round([win.col_off,win.row_off,win.width,win.height]),rtol=0,atol=1e-7)
  return src.read(1,window=win)
def canopy_rgb(a):
 c=(colormaps['viridis'](np.clip(a/30,0,1))[:,:,:3]*255).astype(np.uint8);c[~np.isfinite(a)|(a<2)]=[15,20,25];return c
def rasters():
 evidence=read(OUT/'canopy-evidence.json');assert evidence['state']=='canopy-rasters-built' and len(evidence['campaigns'])==1
 c=evidence['campaigns'][0];files=c['files'];side=read(ROOT/files['chm']['sidecar']);t=from_origin(side['originEasting'],side['originNorthing'],1,1)
 for name in ['chm','ground','firstReturns','allReturns']:
  p=ROOT/files[name]['data'];assert digest(p)==files[name]['sha256'];a=np.fromfile(p,dtype='<f4').reshape(side['height'],side['width']);write_tif(OUT/(name+'.tif'),a,t)
 scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry']);mask=rasterize([(mapping(scope),1)],out_shape=a.shape,transform=t).astype(bool)
 with rasterio.open(OUT/'chm.tif') as src:h=src.read(1)
 with rasterio.open(OUT/'firstReturns.tif') as src:r=src.read(1)
 save(DOC/'source-inventory.json',dict(lidarCampaign=c['campaignId'],lidarDates=[c['captureStart'],c['captureEnd']],rgbiCapture='2024-06-27',
  sourceEvidenceSha256=digest(OUT/'canopy-evidence.json'),crs='EPSG:3006 / RH2000',pixelConvention='edges; centres +0.5 E/-0.5 N',
  firstReturnsPerScopeSquareMetre=float(np.nansum(r[mask])/mask.sum()),heightValidFraction=float(np.mean(np.isfinite(h[mask]))),
  heightMissingPixels=int(np.sum(~np.isfinite(h[mask]))),canopyPixelsAbove3m=int(np.sum(h[mask]>=3)),
  rgbiBands=4,nativeImagerySpacingMetres=.16,uncertainty='Source-relative interpretation, not measured absolute or stem accuracy.'))

def overview():
 scope=shape(read(DOC/'facility-scope.geojson')['features'][0]['geometry']);w,s,e,n=scope.bounds
 bounds=[np.floor(w)-25,np.floor(s)-25,np.ceil(e)+25,np.ceil(n)+25]
 a,t,sources=rgbi_window(bounds,1);canvas=Image.fromarray(np.moveaxis(a[:3],0,-1));canvas.save(OUT/'review/overview-rgb.png');draw=ImageDraw.Draw(canvas)
 Image.fromarray(np.moveaxis(a[[3,0,1]],0,-1)).save(OUT/'review/overview-cir.png')
 red=a[0].astype(float);nir=a[3].astype(float);contrast=np.divide(nir-red,nir+red,out=np.zeros_like(red),where=nir+red>0)
 Image.fromarray((colormaps['RdYlGn']((contrast+1)/2)[:,:,:3]*255).astype('uint8')).save(OUT/'review/overview-vegetation.png')
 height=np.full(a.shape[1:],np.nan,dtype='float32')
 with rasterio.open(OUT/'chm.tif') as src:reproject(rasterio.band(src,1),height,src_transform=src.transform,src_crs=src.crs,dst_transform=t,dst_crs=src.crs,resampling=Resampling.nearest)
 Image.fromarray(canopy_rgb(height)).save(OUT/'review/overview-chm.png')
 for f in read(DOC/'coverage-plan.geojson')['features']:
  b=f['properties']['bounds'];draw.rectangle((b[0]-bounds[0],bounds[3]-b[3],b[2]-bounds[0],bounds[3]-b[1]),outline='#7f9393',width=1)
 for p in scope.geoms if scope.geom_type=='MultiPolygon' else [scope]:draw.line([(x-bounds[0],bounds[3]-y) for x,y in p.exterior.coords],fill='white',width=3)
 for f in read(DOC/'routing-lines.geojson')['features']:
  xy=[(x-bounds[0],bounds[3]-y) for x,y in f['geometry']['coordinates']];draw.line(xy,fill='#ffd35a' if f['properties']['slug']=='veckefjarden' else '#7fecf2',width=2);draw.text(xy[len(xy)//2],str(f['properties']['hole']),fill='white',stroke_width=1,stroke_fill='black')
 canvas.save(OUT/'review/overview.png');save(OUT/'review/overview.json',dict(bounds=bounds,sources=sources))
 print('overview saved',bounds)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('command',choices=['plan','rasters','overview']);args=parser.parse_args()
 if args.command=='plan':plan()
 else:
  check_lock()
  if args.command=='rasters':rasters()
  if args.command=='overview':overview()
