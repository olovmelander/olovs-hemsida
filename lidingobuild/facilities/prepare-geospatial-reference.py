"""Prepare georeferenced facility references; source pixels remain in ignored cache."""
from pathlib import Path
import json
import hashlib
import math
import importlib.util
from datetime import datetime, timezone
from shapely.geometry import shape, box
from shapely.ops import unary_union
import numpy as np
import rasterio
from rasterio.transform import Affine, from_origin, array_bounds
from rasterio.windows import from_bounds
from rasterio.enums import ColorInterp, Resampling
from rasterio.warp import reproject
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
read = lambda p: json.loads((ROOT / p).read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
CACHE = ROOT / 'lidingobuild/cache/facilities-reference-2026-09-10/ortho'
CACHE.mkdir(parents=True, exist_ok=True)
ORIGIN = [677700.5, 6586399.5, 25.0]
relative = lambda p: Path(p).relative_to(ROOT).as_posix()

def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')

def snap(bounds, resolution=.16):
    anchor=[677500,6585000]
    return [round(anchor[i%2]+(math.floor if i<2 else math.ceil)((v-anchor[i%2])/resolution)*resolution,6) for i,v in enumerate(bounds)]

def capture(bounds):
    area=box(*bounds)
    contributing=[]
    covered=[]
    for s in read('geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json')['sources']:
        for f in read('lidingobuild/cache/lm-ortho/'+s['id']+'-flygbild.json')['features']:
            overlap=area.intersection(shape(f['geometry']))
            if overlap.area>1e-6:
                covered.append(overlap)
                contributing.append(dict(sourceId=s['id'],imageId=f['properties']['bildidentitet'],capturedAt=f['properties']['tidpunkt'],windowFraction=round(overlap.area/area.area,9)))
    assert unary_union(covered).area/area.area > .999999
    dates=[x['capturedAt'] for x in contributing]
    return dict(captureDate='2025-05-31', captureRange=dict(first=min(dates),last=max(dates)), contributingImages=contributing)

def raster_outputs(identifier, pixels, transform, extra):
    tif=CACHE/(identifier+'.tif')
    height,width=pixels.shape[1:]
    with rasterio.open(tif,'w',driver='GTiff',width=width,height=height,count=3,dtype='uint8',crs=3006,transform=transform,compress='deflate',tiled=True) as dst:
        dst.write(pixels[:3]); dst.colorinterp=(ColorInterp.red,ColorInterp.green,ColorInterp.blue)
    png=tif.with_suffix('.png')
    Image.fromarray(pixels[:3].transpose(1,2,0)).save(png)
    pgw=tif.with_suffix('.pgw')
    pgw.write_text('\n'.join(map(str,[transform.a,0,0,transform.e,transform.c+transform.a/2,transform.f+transform.e/2]))+'\n')
    prj=tif.with_suffix('.prj')
    prj.write_text(rasterio.crs.CRS.from_epsg(3006).to_wkt())
    bounds=list(array_bounds(height,width,transform))
    rec=dict(id=identifier,imagePath=relative(png),rasterPath=relative(tif),worldFilePath=relative(pgw),projectionPath=relative(prj),
             horizontalCrs='EPSG:3006',boundsEpsg3006=bounds,resolutionMetres=transform.a,width=width,height=height,
             geoTransform=list(transform.to_gdal()),imageSha256=sha(png),rasterSha256=sha(tif),worldFileSha256=sha(pgw),
             projectionSha256=sha(prj),validFraction=1.0,**extra)
    write_json(tif.with_suffix('.json'),rec)
    return rec

def prepare_ortho():
    plan=read('geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json')
    bounds=snap([677500,6586030,677730,6586570])
    identifier='facilities-native-source-lm-2025'
    native=CACHE/(identifier+'.tif')
    if not native.exists():
        spec=importlib.util.spec_from_file_location('facility_lm_acquire',ROOT/'lidingobuild/mapping/lm-alignment-acquire.py')
        mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        window=dict(id=identifier,boundsEpsg3006=bounds,resolutionMetres=.16,width=round((bounds[2]-bounds[0])/.16),height=round((bounds[3]-bounds[1])/.16),sourceIds=['o65850_6775_25_mr25'])
        facility_plan={**plan,'windows':[window],'sources':[s for s in plan['sources'] if s['id'] in window['sourceIds']]}
        write_json(CACHE/'alignment-plan.json',facility_plan)
        mod.acquire(facility_plan,[window],CACHE,CACHE/'native-acquisition.json')
    else:
        assert sha(native)==read(relative(native.with_suffix('.json')))['sha256']
    regions=[
        ('facilities-overview',[677500,6586030,677730,6586570],'Complete clubhouse, parking, range and south-practice corridor'),
        ('clubhouse-detail',[677600,6586410,677705,6586550],'Clubhouse, south annex, north facility, courtyard and putting greens'),
        ('upper-parking-detail',[677500,6586430,677625,6586545],'Both upper parking zones and practice-area change search'),
        ('range-north-detail',[677565,6586345,677655,6586410],'North range teeing apron, hardstanding and nearby paths'),
        ('range-buildings-detail',[677610,6586180,677710,6586320],'West and east range buildings, small shed, strips and southern parking'),
        ('range-south-detail',[677525,6586035,677710,6586200],'South range shelter/apron, support building and south practice green'),
    ]
    municipal=read('geo_data/course-v2/lidingo/discovery/municipal-ortho-2019.json')
    assert sha(ROOT/municipal['path'])==municipal['sha256']
    raw2019=np.asarray(Image.open(ROOT/municipal['path']).convert('RGB')).transpose(2,0,1)
    world=[float(v) for v in (ROOT/municipal['worldfilePath']).read_text().split()]
    municipal_transform=Affine(world[0],world[2],world[4]-world[0]/2,world[1],world[3],world[5]-world[3]/2)
    records=[]
    with rasterio.open(native) as src:
        assert src.crs.to_epsg()==3006 and src.res==(.16,.16) and src.dataset_mask().min()==255
        for name,requested,purpose in regions:
            b=snap(requested)
            window=from_bounds(*b,src.transform).round_offsets().round_lengths()
            pixels=src.read([1,2,3],window=window)
            transform=src.window_transform(window)
            assert np.allclose(array_bounds(*pixels.shape[1:],transform),b,rtol=0,atol=1e-6)
            rec=raster_outputs(name+'-lm-2025',pixels,transform,dict(sourceId='lm-orto-o2-2025',sourceRasterPath=relative(native),sourceRasterSha256=sha(native),resampling='none; exact native RGB pixel crop',purpose=purpose,**capture(b)))
            records.append(rec)
            # Comparator is reprojected from the exact retained EPSG:3011 grid.
            # Its 0.5 m output pixels do not imply 0.5 m product GSD or accuracy.
            transform2019=from_origin(b[0],b[3],.5,.5)
            width=math.ceil((b[2]-b[0])/.5); height=math.ceil((b[3]-b[1])/.5)
            output=np.zeros((3,height,width),dtype=np.uint8)
            reproject(raw2019,output,src_transform=municipal_transform,src_crs=3011,dst_transform=transform2019,dst_crs=3006,resampling=Resampling.nearest)
            records.append(raster_outputs(name+'-municipal-2019',output,transform2019,dict(sourceId='imagery-municipal-2019',sourceImagePath=municipal['path'],sourceImageSha256=municipal['sha256'],sourceWorldFilePath=municipal['worldfilePath'],sourceHorizontalCrs='EPSG:3011',resampling='nearest; reprojected EPSG:3011 to EPSG:3006',campaignYear=2019,captureDate=None,sourceProductGsdMetres=None,purpose=purpose+'; historical comparator')))
    report=dict(schemaVersion=1,groundId='lidingo',createdAt=datetime.now(timezone.utc).isoformat(),state='georeferenced-reference-ready-not-current-survey',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613 / RH2000',
        blenderOriginEpsg3006RH2000=ORIGIN,blenderConvention='X=E-677700.5; Y=N-6586399.5; Z=RH2000-25.0; 1 Blender unit=1 metre',
        applicationConvention='X=E-677700.5; Y=RH2000; Z=6586399.5-N; add 25 m vertical offset when importing the Blender GLB',
        pixelConvention='North-up; bounds are pixel outer edges. Pixel centre E=minE+(col+0.5)*resolution; N=maxN-(row+0.5)*resolution.',
        sourcePixelsStoredUnderIgnoredCache=True,rawImageryRedistributed=False,windows=records,
        sources=[dict(id='lm-orto-o2-2025',provider='Lantmäteriet',collection='orto-o2-2025',captureDate='2025-05-31',nativeResolutionMetres=.16,attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0',termsUrl='https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf',catalogEvidencePath='geo_data/course-v2/lidingo/reference/lm-ortho-catalog-2026-09-09.json',assets=plan['sources']),
                 dict(id='imagery-municipal-2019',provider='Lidingö stad',campaignYear=2019,captureDate=None,licence='CC0-1.0',serviceUrl=municipal['sourceService'],layer=municipal['layer'],termsEvidencePath='geo_data/course-v2/lidingo/mapping/municipal-ortho-2019-licence.json',sourceHorizontalCrs='EPSG:3011',sourceSampleSpacingMetres=.5,sourceProductGsdMetres=None)],
        limitations=['2025-05-31 is the newest retained orthophoto capture, not a 2026 as-built survey.','Ground sample distance does not establish absolute horizontal accuracy.','Elevated roof outlines can be displaced from wall footprints in orthophotos; use facade photos and laser evidence to resolve.','Municipal comparator is a 2019 campaign with unknown exact date and source GSD.','Facades, current equipment, net heights and dimensions require independent evidence.'])
    write_json(HERE/'orthophoto-reference.json',report)
    return report

if __name__ == '__main__':
    report=prepare_ortho()
    print(json.dumps({'windows':len(report['windows']),'manifest':relative(HERE/'orthophoto-reference.json')}))
