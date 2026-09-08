"""Trace the observed practice range without assigning it to a numbered hole."""
import json
from hashlib import sha256
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parents[4]
SOURCE = 'geo_data/course-v2/visby/reference/gotland-ortho-2022.json'
OUT = 'visbybuild/mapping/practice-surfaces.geojson'
PIXELS = [[1070,2585],[1080,2490],[1140,2330],[1200,2200],[1260,2070],
          [1300,2030],[1340,2040],[1327,2098],[1300,2104],[1272,2120],
          [1270,2155],[1283,2172],[1305,2182],[1330,2200],[1315,2225],
          [1300,2245],[1298,2280],[1310,2310],[1333,2338],[1330,2390],
          [1300,2415],[1255,2460],[1220,2490],[1218,2560],[1180,2610],
          [1120,2610]]

meta = json.loads((ROOT / SOURCE).read_text('utf8'))
source = ROOT / meta['image']['path']
assert sha256(source.read_bytes()).hexdigest() == meta['image']['sha256']
assert meta['bboxEpsg3006'] == [686900,6370350,688650,6372150]
assert (meta['width'], meta['height'], meta['outputSampleSpacingMetres']) == (3500,3600,.5)
project = lambda p: [686900.25 + p[0] * .5, 6372149.75 - p[1] * .5]
geometry = Polygon([project(p) for p in PIXELS])
assert geometry.is_valid and geometry.area > 1000
properties = dict(kind='range_field', hole=None, sourceId='gotland-ortho-2022',
                  observedYear=2022, captureDate=None, reviewStatus='machine-visual-review',
                  notSurveyed=True, method='manual-image-boundary-digitization',
                  interpretationUncertaintyMetres=4,
                  registrationAccuracy='not independently checked',
                  licence='exact service terms unresolved; local provisional derivative only',
                  areaSquareMetres=round(geometry.area,2),
                  sourceImage=meta['image']['path'], sourceImageSha256=meta['image']['sha256'],
                  sourceEvidence=SOURCE, sourcePixels=PIXELS,
                  pixelCoordinateConvention='full image pixel centres; E=686900.25+0.5*x, N=6372149.75-0.5*y',
                  note='Observed open driving-range field east of the clubhouse road. The adjacent narrow practice fairway is separate. The eastern boundary detours around visible trees near source pixels (1300,2140) and (1320,2280). This is a provisional playing-footprint interpretation, not a cadastral boundary or a current vegetation survey.')
collection = dict(type='FeatureCollection', name='Visby provisional practice surfaces',
                  crs=dict(type='name',properties=dict(name='EPSG:3006')),
                  axisOrder=['easting','northing'], status='provisional-source-derived-not-surveyed',
                  features=[dict(type='Feature',id='range-field-image-2022',
                                 properties=properties,geometry=mapping(geometry))])
destination = ROOT / OUT
destination.write_text(json.dumps(collection,ensure_ascii=False,indent=2)+'\n','utf8')

image = np.asarray(Image.open(source).convert('RGB'))
figure, axes = plt.subplots(1,2,figsize=(10,10),layout='constrained')
for ax in axes:
    ax.imshow(image,origin='upper')
    ax.set_xlim(1050,1450)
    ax.set_ylim(2660,1980)
    ax.set_aspect('equal')
    ax.grid(color='yellow',alpha=.35)
    ax.tick_params(labelsize=8)
axes[0].set_title('Region Gotland 2022 source')
ring = np.asarray([*PIXELS,PIXELS[0]])
axes[1].plot(ring[:,0],ring[:,1],color='cyan',linewidth=1.5)
axes[1].scatter(ring[:,0],ring[:,1],color='cyan',s=8)
axes[1].set_title('Observed range-field footprint')
figure.suptitle('Provisional practice geometry; adjacent practice fairway and visible trees remain separate')
preview = ROOT / 'visbybuild/cache/vegetation/review/practice-range-source-review.png'
preview.parent.mkdir(parents=True,exist_ok=True)
figure.savefig(preview,dpi=130)
plt.close(figure)
report = dict(schemaVersion=1, groundId='visby', observedOn='2026-09-07',
              sourceEvidence=SOURCE, sourceImage=meta['image'],
              outputPath=OUT, outputSha256=sha256(destination.read_bytes()).hexdigest(),
              previewPath=preview.relative_to(ROOT).as_posix(),
              previewSha256=sha256(preview.read_bytes()).hexdigest(),
              featureCount=1, areaSquareMetres=geometry.area,
              sourcePixels=PIXELS,
              limitations=['Visible maintained/open field limits are manually interpreted at 0.5 m output resolution; source registration has not been independently checked.',
                           'The practice field is not assigned to a numbered hole. Its footprint does not establish the identity of isolated LiDAR returns as trees or range structures.',
                           '2022 imagery and 2024 laser have different capture years; current field limits remain unverified.'])
(ROOT / 'geo_data/course-v2/visby/vegetation/practice-surface-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({k: report[k] for k in ['outputPath','outputSha256','previewPath','areaSquareMetres']}))
