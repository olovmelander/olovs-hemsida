"""Explicit source-reviewed pilot edits, authored AFTER the frozen detector benchmark.

The annotated evaluation areas may now be edited for the visual experiment;
they are never used to claim an independent post-edit accuracy measurement.
"""
from prepare import *
from shapely.geometry import shape,Point,mapping
from shapely.ops import unary_union
from scipy.optimize import linear_sum_assignment

DOC=ROOT/'geo_data/course-v2/visby/vegetation/pilot'

def main():
    baseline=read(OUT/'baseline-records.json');reference=read(DOC/'reference.geojson')
    refs=[f for f in reference['features'] if f['properties']['role']=='crown' and f['properties']['scorable']]
    clearings=unary_union([shape(f['geometry']) for f in reference['features'] if f['properties']['role']=='clearing'])
    distances=np.array([[np.hypot(f['properties']['easting']-b['easting'],f['properties']['northing']-b['northing']) for b in baseline] for f in refs])
    ri,bi=linear_sum_assignment(np.where(distances<=6,distances,1e6))
    pairs={int(i):int(j) for i,j in zip(ri,bi) if distances[i,j]<=6}
    retained={b['id']:dict(b) for b in baseline}
    sequence=max(int(b['id'].split('-')[-1]) for b in baseline)
    edits=[];footprints=[];rgb_stats={};base_holds=[]
    holds=read(ROOT/'tools/visby-tree-pilot/placement-holds.json')
    for i,feature in enumerate(refs):
        p=feature['properties'];poly=shape(feature['geometry']);old=baseline[pairs[i]] if i in pairs else None
        if old is None:sequence+=1
        tree_id=old['id'] if old else f'tree-visby-{sequence:06}'
        scene=read(OUT/'review'/(p['scene']+'.json'))
        with rasterio.open(OUT/'review'/(p['scene']+'-rgbi.tif')) as src:
            w=from_bounds(*poly.bounds,transform=src.transform).round_offsets().round_lengths();rgb=src.read(window=w)
            from rasterio.features import geometry_mask
            mask=geometry_mask([mapping(poly)],out_shape=rgb.shape[1:],transform=src.window_transform(w),invert=True)
            red=rgb[0].astype(float);nir=rgb[3].astype(float);contrast=np.divide(nir-red,nir+red,out=np.zeros_like(red),where=nir+red>0)
            ir=float(np.median(contrast[mask])) if np.any(mask) else None
        # Positions are visually interpreted LiDAR crown centres. NIR corroborates vegetation,
        # but is deliberately not used as a deletion or species-classification threshold.
        candidate=dict(id=tree_id,easting=p['easting'],northing=p['northing'],objectHeightMetres=p['heightMetres'],radiusMetres=p['radiusMetres'],
            referenceId=p['id'],sourceId='visby-tree-pilot-rgbi-lidar-review',placementMethod='digitized',horizontalAccuracyMetres=2.0,verticalAccuracyMetres=1.5,
            confidence=.65,truthZone=old['truthZone'] if old else 'A',capturedAt='2024-04-28')
        held=p['id'] in holds['referenceIds']
        if held:
            base_holds.append({**p,'reservedId':tree_id,'status':'unresolved-tree-base','reason':holds['reason']})
        else:retained[tree_id]=dict(**candidate,pilotEdit=True)
        action='adjust' if old else 'promote-from-stand'
        edits.append(dict(id=tree_id,action='hold-base' if held else action,referenceId=p['id'],scene=p['scene'],decision='unresolved-tree-base' if held else 'accepted-source-relative-preview',
            before=old,after=candidate,reason='Crown and canopy extent interpreted from LiDAR, RGB and CIR together; approximate crown centre, not a stem.',
            nirContrastMedian=ir,sourceWindows=scene['sources'],lidarCaptureRange=p['lidarCaptureRange'],imageCapture=p['imageCapture']))
        footprints.append(dict(type='Feature',geometry=feature['geometry'],properties=dict(id=tree_id,role='unresolved-crown-overhang' if held else 'individual-crown',referenceId=p['id'])))
    # Clearings are explicitly reviewed. No absent or low-infrared tree is silently removed.
    removals=[]
    for b in baseline:
        if clearings.contains(Point(b['easting'],b['northing'])) and b['id'] in retained:
            retained.pop(b['id']);removals.append(b['id']);edits.append(dict(id=b['id'],action='remove',decision='accepted-source-relative-preview',reason='Centre inside a visually reviewed open clearing supported by LiDAR and RGBI',before=b))
    unresolved=base_holds+[f['properties'] for f in reference['features'] if f['properties']['role']=='crown' and not f['properties']['scorable']]
    catalogue=dict(version=1,groundId='visby',status='local-experiment-only',reviewer='agent visual interpretation',
        referenceSha256=digest(DOC/'reference.geojson'),benchmarkSha256=digest(DOC/'benchmark.json'),
        limitation='These edits reuse reference annotations. Agreement after editing is source conformance, not held-out accuracy.',edits=edits,unresolved=unresolved,
        noInfraredOnlyDeletions=True,speciesMeasured=False,
        seasonalReview=dict(campaign='2022',captureDate=None,scenes=['hold09a','hold16a','cal15'],finding='Leafy outlines support vegetation interpretation; deciduous seasonal change is visible on hole 9. No removal or positional shift inferred from the older image.'))
    save(DOC/'corrections.json',catalogue)
    save(OUT/'pilot-record-drafts.json',list(retained.values()))
    save(OUT/'pilot-footprints.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),features=footprints))
    print(json.dumps(dict(edits=len(edits),adjusted=len(pairs),promoted=len(refs)-len(pairs),removed=len(removals),unresolved=len(unresolved),records=len(retained))))

if __name__=='__main__':main()
