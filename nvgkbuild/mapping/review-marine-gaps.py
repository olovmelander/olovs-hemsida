"""Read bounded dated LM orthophotos to inspect missing water-boundary areas."""
import importlib.util
import json
import hashlib
from pathlib import Path
import rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('intake',Path(__file__).with_name('lm-ortho-acquire.py'))
intake=importlib.util.module_from_spec(spec);spec.loader.exec_module(intake)
catalog=json.loads((ROOT/'geo_data/course-v2/norrfallsviken/reference/lm-ortho-catalog-2026-09-09.json').read_text(encoding='utf8'))
out=ROOT/'nvgkbuild/cache/marine-gap-review';out.mkdir(parents=True,exist_ok=True)
records=[]
with rasterio.Env(GDAL_HTTP_HEADERS='Authorization: '+intake.credentials(),GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
 CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='60',GDAL_HTTP_MAX_RETRY='2',CPL_CURL_VERBOSE=False,CPL_DEBUG=False,GDAL_HTTP_NETRC='NO'):
 for name,identifier,bounds,res in [
  ('north-gap','o69900_6800_50_fi12',[680000,6990500,681500,6992200],1),
  ('east-gap','o69850_6800_50_fi12',[680000,6987500,682500,6990000],2),
 ]:
  source=next(i for i in catalog['items'] if i['id']==identifier)
  width=round((bounds[2]-bounds[0])/res);height=round((bounds[3]-bounds[1])/res)
  with rasterio.open('/vsicurl/'+intake.source_url(source['assets']['data']['href'])) as src:
   assert src.crs.to_epsg()==3006 and src.count==3 and src.res==(.5,.5)
   rgb=src.read([1,2,3],window=from_bounds(*bounds,src.transform),out_shape=(3,height,width),resampling=Resampling.average)
  target=out/(name+'.png');Image.fromarray(rgb.transpose(1,2,0)).save(target)
  record=dict(id=name,sourceId=identifier,capturedAt=source['capturedAt'],url=source['assets']['data']['href'],
   boundsEpsg3006=bounds,resolutionMetres=res,sourceResolutionMetres=.5,width=width,height=height,
   pngSha256=hashlib.sha256(target.read_bytes()).hexdigest(),file=target.relative_to(ROOT).as_posix())
  records.append(record);print(json.dumps(record),flush=True)
(out/'index.json').write_text(json.dumps(dict(windows=records,limitation='2012 orthophotos: historical land/water evidence, not present-day precise coastline'),indent=2)+'\n',encoding='utf8')
