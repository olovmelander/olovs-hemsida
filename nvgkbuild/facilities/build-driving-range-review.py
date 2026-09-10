"""Native LM review of the range's mats, platform segments and target surfaces.

Green mat corners are estimated rectangles from observed pixel support,
constrained by each platform direction and checked against dated exterior photos.
They are not nominal-size templates. Ground heights remain a runtime terrain
sampling concern; no common flat elevation is imposed across the sloping range.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
from scipy.ndimage import label
from shapely.geometry import Point, Polygon

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'nvgkbuild/facilities/driving-range-review.json'
RUNTIME=ROOT/'apps/golf/src/engine/scenery/norrfallsviken-range-site.json'
CACHE=ROOT/'nvgkbuild/cache/facilities-reference/range-review'
CACHE.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source_path=ROOT/'nvgkbuild/cache/lm-ortho/facilities-range.json'
source=json.loads(source_path.read_text(encoding='utf-8'))
image_path=source_path.parent/source['rgbFile']
assert sha(image_path)==source['rgbSha256']
assert sha(source_path.parent/source['rasterFile'])==source['sha256']
im=Image.open(image_path).convert('RGB');pixels=np.asarray(im,dtype=np.float64)
transform=source['geoTransform']
old_path=ROOT/'nvgkbuild/mapping/review-environment-2026-09-09.json'
old=json.loads(old_path.read_text(encoding='utf-8'))
old_by_id={f['id']:f for f in old['features']}
project=Transformer.from_crs(3006,4326,always_xy=True)
def en(p):return [round(transform[0]+p[0]*.16,6),round(transform[3]-p[1]*.16,6)]
def xz(p):
    lon,lat=project.transform(*p)
    return [round((lon-18.5325)*50568.51,4),round((62.9825-lat)*111320,4)]
def ring_feature(identifier,kind,ring,**extra):
    ring=np.asarray(ring,dtype=float)
    shape=Polygon(ring)
    assert shape.is_valid and shape.area>1
    result=dict(id=identifier,kind=kind,sourcePixels=np.round(ring,6).tolist(),
        ringEpsg3006=[en(p) for p in ring],ringLocalXZ=[xz(en(p))for p in ring],
        centreEpsg3006=en([shape.centroid.x,shape.centroid.y]),
        areaSquareMetres=round(shape.area*.16**2,4),**extra)
    if identifier in old_by_id:
        previous=old_by_id[identifier]
        result['previousReview']=dict(id=identifier,ringEpsg3006=previous['ringEpsg3006'],
            sourcePixels=previous['ringPixels'],panelGeoTransform=previous['panel']['geoTransform'])
    return result

# Four visibly continuous pale platform segments, with gravel gaps after mats
# 3, 6 and 9. Slab joints within those segments cannot be resolved at 0.16 m.
pad_pixels=[
 [[634.5,788],[648,785.5],[658,836.5],[644,839]],
 [[646,843],[660,839.5],[674,887],[659,891.5]],
 [[660,891],[674,887],[695,937],[681,943]],
 [[682,944],[695,939],[717,983],[703,990]],
]
pads=[]
for i,ring in enumerate(pad_pixels):
    p=np.asarray(ring,dtype=float)
    axis=((p[2]+p[3])-(p[0]+p[1]))/2
    axis/=np.linalg.norm(axis)
    shot=np.array([axis[1],axis[0]])
    # Pixel +row points south. The firing direction is east/northeast, normal
    # to the observed platform's long edge, away from the gravel walkway.
    pads.append(ring_feature(f'lm-range-platform-{i+1:02d}','range_platform',p,
        matIds=[f'lm-range-mat-{j:02d}'for j in range(i*3+1,i*3+4)],
        longAxisSourcePixels=axis.tolist(),shotDirectionEpsg3006=np.round(shot,9).tolist(),
        planEdgeLengthsMetres=[round(float(np.linalg.norm(p[(j+1)%4]-p[j])*.16),3)for j in range(4)],
        material='pale-prepared-platform; concrete-like appearance confirmed by exterior photo',
        certainty='Visible segment boundary; construction joints, slab thickness and foundation not surveyed',
        traceUncertaintyMetres=.32))

seeds=[(644,795),(647,812),(651,829),(656,846),(660,862),(666,881),
       (671,897),(677,913),(684,931),(691,948),(700,967),(707,983)]
mats=[]
for index,(cx,cy) in enumerate(seeds):
    identifier=f'lm-range-mat-{index+1:02d}'
    pad=pads[index//3]
    patch=pixels[cy-13:cy+13,cx-13:cx+13]
    mask=(patch[:,:,1]-patch[:,:,0]>6)&(patch[:,:,1]-patch[:,:,2]>8)
    components,count=label(mask)
    candidates=[]
    for k in range(1,count+1):
        rows,cols=np.where(components==k)
        if len(rows)<8:continue
        candidates.append((float(np.mean((cols-13)**2+(rows-13)**2)),k))
    assert candidates
    component=min(candidates)[1]
    rows,cols=np.where(components==component)
    pixel_indices=np.c_[cols+cx-13,rows+cy-13]
    support=pixel_indices+.5
    assert 45<=len(support)<=115
    baseline=np.asarray(pad['longAxisSourcePixels'])
    angle0=math.atan2(baseline[1],baseline[0])
    # The observed pale platform constrains orientation when the small green
    # patch is blurred. Each patch is independently fitted; dimensions are
    # obtained from its support rather than a common mat-size constant.
    best=None
    offsets=np.array([[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]])
    pixel_edges=(support[:,None,:]+offsets[None,:,:]).reshape(-1,2)
    for delta in np.linspace(-12,12,97):
        angle=angle0+math.radians(float(delta))
        along=np.array([math.cos(angle),math.sin(angle)])
        across=np.array([along[1],-along[0]])
        uv=np.c_[pixel_edges@across,pixel_edges@along]
        lo,hi=uv.min(0),uv.max(0)
        area=float(np.prod(hi-lo))
        score=area+abs(delta)*.012
        if best is None or score<best[0]:best=(score,delta,across,along,lo,hi)
    _,delta,across,along,lo,hi=best
    uv=np.array([[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]])
    ring=uv[:,0,None]*across+uv[:,1,None]*along
    mat=ring_feature(identifier,'range_mat',ring,padId=pad['id'],
        supportPixelIndices=pixel_indices.astype(int).tolist(),supportPixelCount=len(support),
        fitting=dict(method='Minimum-area rectangle of observed green pixel-cell support, orientation constrained to +/-12 degrees of its own platform long edge',
            greenSelection='G-R>6 and G-B>8, nearest connected component within a 26x26 native-pixel window',
            seedPixel=[cx,cy],orientationOffsetFromPlatformDegrees=round(float(delta),3),
            dimensionsMetres=np.round((hi-lo)*.16,4).tolist(),
            axes='first dimension across the hitting line; second dimension along the platform',
            notNominalDimensions=True),
        shotDirectionEpsg3006=pad['shotDirectionEpsg3006'],
        material='green-artificial-turf',
        certainty='Visible green support and photo-supported rectangular form; exact corners estimated at native-pixel resolution',
        occluded=index in [0,4],
        uncertainty=dict(planCornerMetres=.40 if index in [0,4] else .25,rotationDegrees=12,
            note='Object/shadow obscures part of the green patch' if index in [0,4] else 'Blurred mat edges occupy only approximately 8-12 source pixels'))
    old_centroid=Polygon(old_by_id[identifier]['ringEpsg3006']).centroid
    mat['centreCorrectionFromPreviousMetres']=round(Point(mat['centreEpsg3006']).distance(old_centroid),4)
    containment=Polygon(pad['sourcePixels']).buffer(.4/.16).covers(Polygon(ring))
    assert containment,identifier+' is outside its observed platform beyond tracing uncertainty'
    mat['validation']=dict(fourRectangleCorners=True,insidePlatformWithinTraceUncertainty=True)
    mats.append(mat)

# The circulation strip is continuous gravel into the wider parking apron.
# Its north/south endpoints are scoped joins within that surface, not curbs.
# The right boundary follows the field edge beside all four observed bases.
walkway_pixels=[[620,785],[632,782],[648,785.5],[658,836.5],[660,839.5],
 [674,887],[695,937],[695,939],[717,983],[719,994],[700,1002],
 [684,977],[668,946],[653,914],[642,880],[631,838]]
hardstanding=[ring_feature('lm-range-hardstanding','gravel_circulation',walkway_pixels,
    material='grey-gravel',traceUncertaintyMetres=.5,
    certainty='Visible prepared gravel circulation beside mats; boundary through continuous parking gravel is a scope cut',
    scopeCuts=['north end joins existing gravel access','south end joins existing gravel apron'],
    notASeparateSlab=True,curbsOrRaisedEdgeSupported=False)]

targets=[
 ring_feature('lm-range-target-near','range_target_surface',
    [[923,884],[948,878],[975,881],[983,896],[979,911],[959,917],[938,916],[923,904]],
    material='green-observed-turf-patch',traceUncertaintyMetres=.5),
 ring_feature('lm-range-target-centre','range_target_surface',
    [[1039,644],[1112,627],[1129,691],[1052,709]],
    material='green-observed-rectangular-turf-patch',traceUncertaintyMetres=.4),
 ring_feature('lm-range-target-far-strip','range_target_surface',
    [[1646,652],[1830,637],[1833,664],[1649,672]],
    material='green-observed-long-turf-strip',traceUncertaintyMetres=.6),
]
for target in targets:
    target.update(certainty='Visible dated surface boundary; function, target-distance labels and construction details unverified',
                  targetDistanceMetres=None,raisedTargetOrFlagInvented=False)

def small(f,keys=()):return {k:f[k]for k in ('id','ringEpsg3006',*keys)}
runtime=dict(schemaVersion=1,mats=[small(f,('padId','shotDirectionEpsg3006'))for f in mats],
    pads=[small(f,('matIds',))for f in pads],hardstanding=[small(f)for f in hardstanding],targets=[small(f)for f in targets])
encoded=(json.dumps(runtime,separators=(',',':'),allow_nan=False)+'\n').encode('utf-8')
assert len(encoded)<10_000
RUNTIME.write_bytes(encoded)

panel_bounds=[590,765,735,1008];scale=4
panel=im.crop(panel_bounds).resize(((panel_bounds[2]-panel_bounds[0])*scale,(panel_bounds[3]-panel_bounds[1])*scale),Image.Resampling.NEAREST)
draw=ImageDraw.Draw(panel);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
def display(p):return ((p[0]-panel_bounds[0])*scale,(p[1]-panel_bounds[1])*scale)
for f in hardstanding+pads+mats:
    colour='#fae4ab' if f in pads else '#51f174' if f in mats else '#8bd8ef'
    pts=[display(p)for p in f['sourcePixels']];draw.line(pts+[pts[0]],fill=colour,width=2)
    if f in mats:
        centre=np.asarray(f['sourcePixels']).mean(0);q=display(centre)
        draw.text((q[0]-70,q[1]-8),f['id'].split('-')[-1],font=font,fill='white',stroke_width=2,stroke_fill='black')
        ray=np.array([f['shotDirectionEpsg3006'][0],-f['shotDirectionEpsg3006'][1]])
        draw.line([q,display(centre+ray*8)],fill='#ff674f',width=2)
review_image=CACHE/'range-mats-platforms-reviewed.png';panel.save(review_image)

photo=ROOT/'nvgkbuild/cache/facilities-reference/web/official-range-20250528.jpg'
record=dict(schemaVersion=1,groundId='norrfallsviken',kind='driving-range-native-orthophoto-review',reviewedOn='2026-09-10',
    source=dict(rasterPath=(source_path.parent/source['rasterFile']).relative_to(ROOT).as_posix(),
        rgbPath=image_path.relative_to(ROOT).as_posix(),rasterSha256=source['sha256'],rgbSha256=source['rgbSha256'],
        horizontalCrs='EPSG:3006',resolutionMetres=.16,geoTransform=source['geoTransform'],
        sourceImage='24u215ss15_27~2024-06-27_134221_2070',capturedAt='2024-06-27T13:42:21Z',
        attribution='Ortofoto Nedladdning, Lantmateriet, CC BY 4.0, adapted information'),
    photoSupport=dict(path=photo.relative_to(ROOT).as_posix(),sha256=sha(photo),
        catalogue='nvgkbuild/mapping/facilities-web-reference.json',capturedAt='2025-05-28',
        establishes='Rectangular green mats, pale prepared bases, gravel circulation, dark ball trays behind mats',
        doesNotEstablish='Surveyed dimensions, permanent positions of trays or unchanged mat arrangement between the two dates'),
    oldReview=dict(path=old_path.relative_to(ROOT).as_posix(),sha256=sha(old_path),
        finding='Previous mat rings were generated octagons of radius five native pixels around approximate centres, not boundary traces'),
    pixelConvention='Source image pixel edges; classified RGB pixel (column,row) occupies [column,column+1] x [row,row+1]. No image shift/rotation is fitted.',
    runtimeConvention='ringEpsg3006 is horizontal source geometry. Use existing EPSG-to-legacy bridge and terrain sampling per platform; render thickness, tray offsets and platform slope are display choices.',
    mats=mats,pads=pads,hardstanding=hardstanding,targets=targets,
    conclusions=['Twelve green mat patches are visible; none added or deleted.',
        'Four pale platform segments each support three mats. Gravel gaps after mats 3, 6 and 9 are retained; no twelve separate slab outlines are invented.',
        'Mats 1 and 5 have partial object/shadow occlusion. Rectangular form is supported by the dated exterior photo; exact corners retain uncertainty.',
        'No common elevated platform, curbs, nominal mat dimensions, target distances or new target objects are inferred.',
        'The broader gravel parking apron has no resolved material seam with the circulation strip; a separate artificial apron polygon is omitted.'],
    reviewedPanel=dict(path=review_image.relative_to(ROOT).as_posix(),sha256=sha(review_image),
        sourceCropPixelEdges=panel_bounds,displayScale=scale,
        geoTransform=[transform[0]+panel_bounds[0]*.16,.16/scale,0,transform[3]-panel_bounds[1]*.16,0,-.16/scale]),
    runtimeExport=dict(path=RUNTIME.relative_to(ROOT).as_posix(),bytes=len(encoded),sha256=sha(RUNTIME)),
    validation=dict(matCount=12,padCount=4,targetSurfaceCount=3,allRingsValid=True,
        sourceHashesVerified=True,allShotDirectionsPointTowardField=True),
    generator=dict(path=Path(__file__).resolve().relative_to(ROOT).as_posix(),sha256=sha(Path(__file__))))
OUT.write_text(json.dumps(record,indent=2,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf-8')
print(json.dumps(dict(runtime=record['runtimeExport'],mats=len(mats),pads=len(pads),targets=len(targets),
    matDimensions=[f['fitting']['dimensionsMetres']for f in mats],
    maximumCentreCorrectionMetres=max(f['centreCorrectionFromPreviousMetres']for f in mats)),indent=2))
