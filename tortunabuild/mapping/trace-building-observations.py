"""Reproduce observed roof selection outlines from pinned native 2026 imagery.

These are image roof silhouettes, NOT surveyed wall/ground footprints. Original
OSM ground hypotheses remain unchanged. Laser XY provides independent support.
"""
from pathlib import Path
import hashlib, json
from shapely.geometry import Polygon, shape, mapping

ROOT = Path(__file__).resolve().parents[2]
GRIDS = {
    'clubhouse': dict(path='tortunabuild/cache/orthophoto/crops/clubhouse.tif',
        sha256='1ce087d73b92e7c31f4bbf47bcc1ec2f4667055d7adb798d154ccdba29448c98',
        west=597406.72, north=6615139.52, width=800, height=800),
    'service-yard': dict(path='tortunabuild/cache/buildings/service-yard.tif',
        sha256='de0b7ca75c823f79f147bfbd01b9426089696cdbc04c9b4fdc3687ddfc59ea63',
        west=597280, north=6615360, width=1600, height=1600),
    'nearby-houses': dict(path='tortunabuild/cache/buildings/nearby-houses.tif',
        sha256='b7c920d4ef1b8c3997e61dab38fa758d4a77deb69681ef03b332ee2c5b3f28d4',
        west=597584, north=6615024, width=800, height=800),
}
# id, associated OSM/facility id, window, pixel-edge roof selection ring,
# current visible roof colour, visual interpretation. Heights are measured later.
TRACES = [
    ('tortuna-clubhouse-main-roof', 'way/1163533127', 'clubhouse',
     [[319,310],[452,422],[400,482],[383,480],[373,468],[363,461],[343,457],
      [303,424],[302,415],[307,409],[288,393],[285,397],[270,382],[267,373]],
     '68574b', 'Intersecting brown pitched/hipped roofs of the photographed ochre clubhouse; low pond-facing extension excluded.'),
    ('tortuna-clubhouse-low-extension', 'way/1163533127', 'clubhouse',
     [[443,439],[477,470],[413,535],[360,501],[367,490],[396,507]],
     '8b8176', 'Lower pond-facing terrace/extension envelope; chairs and terrace fixtures may cause non-planar returns, so retain measurement rejection if unsupported.'),
    ('tortuna-clubhouse-west-outbuilding-roof', 'way/1163533128', 'clubhouse',
     [[209,380],[245,409],[197,455],[168,427]],
     'a7725f', 'Detached red/brown roof immediately west of the clubhouse; official club photos show a low outbuilding in this location.'),
    ('tortuna-clubhouse-southwest-shed-roof', None, 'clubhouse',
     [[226,466],[257,468],[256,491],[226,490]],
     '796b66', 'Small detached roof beside the west path, omitted from retained OSM buildings; use remains unknown.'),
    ('tortuna-range-service-barn-roof', 'way/1163533113', 'service-yard',
     [[967,623],[1142,508],[1183,566],[1006,682]],
     'ad7160', 'Long unobscured red roof north of the range; two pitched planes visible.'),
    ('tortuna-range-small-outbuilding-roof', 'way/1163533114', 'service-yard',
     [[969,527],[1003,504],[1032,540],[996,564]],
     '995f52', 'Detached small red pitched roof northwest of the long service barn.'),
    ('tortuna-range-west-barn-roof', 'way/1163533115', 'service-yard',
     [[743,462],[793,430],[846,506],[810,542]],
     'a97360', 'Red pitched roof beside the service-yard access; northeast slope is shaded.'),
    ('tortuna-carpark-west-north-barn-roof', 'way/1163533123', 'service-yard',
     [[48,1265],[184,1169],[223,1209],[85,1307]],
     '77716b', 'Long dark roof northwest of the car park; small light roof section at southwest end is retained in selection.'),
    ('tortuna-house-near-hole9-roof', 'way/1163607303', 'nearby-houses',
     [[162,618],[203,593],[201,577],[236,557],[279,619],[237,646],[184,655]],
     'ab715a', 'Red/brown intersecting house roof east of the current hole 9 tee; use beyond mapped building remains unverified.'),
    ('tortuna-house-east-roof', 'way/1384988126', 'nearby-houses',
     [[582,304],[644,249],[687,282],[680,291],[702,322],[670,350],[652,344],[644,353]],
     '535c5e', 'Dark intersecting house roof east of the course, excluding the bright open terrace to its northwest.'),
    ('tortuna-house-east-garage-roof', 'way/1384988127', 'nearby-houses',
     [[658,393],[696,357],[730,391],[697,427]],
     '596061', 'Detached dark garage roof southeast of the house; current roof association only.'),
    ('tortuna-range-shelter-roof', 'tortuna-range-shelter', 'service-yard',
     [[1204,1164],[1238,1195],[1206,1230],[1172,1198]],
     'deded6', 'Bright small range shelter roof beside the sand practice bunker; no additional netting or supports inferred.'),
]


def identity(path):
    data = (ROOT/path).read_bytes()
    return dict(path=path, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def main():
    import rasterio
    for key, grid in GRIDS.items():
        if identity(grid['path'])['sha256'] != grid['sha256']:
            raise ValueError(f'Pinned native image changed: {key}')
        with rasterio.open(ROOT/grid['path']) as src:
            if src.crs.to_epsg()!=3006 or src.res!=(.16,.16) or (src.width,src.height)!=(grid['width'],grid['height']):
                raise ValueError('Native grid changed')
    osm_path = 'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson'
    if identity(osm_path)['sha256'] != '69e9deeb00686fba8d3b86a9734aa6f2dac5ea4fd7baa08c0c72afafe66a1e6a':
        raise ValueError('OSM reference changed')
    osm = {f['id']: f for f in json.loads((ROOT/osm_path).read_text())['features']}
    records=[]
    for name, target, key, pixels, colour, description in TRACES:
        grid=GRIDS[key]
        ring=[[round(grid['west']+x*.16,4),round(grid['north']-y*.16,4)] for x,y in pixels]
        poly=Polygon(ring)
        if not poly.is_valid or poly.area<1:
            raise ValueError(f'Invalid observed roof outline: {name}')
        original=shape(osm[target]['geometry']) if target in osm else None
        record=dict(id=name, associatedBuildingId=target, operation='attach-measured-roof-if-supported',
            replacesGroundFootprint=False, observedRoofGeometryEpsg3006=mapping(poly),
            observedRoofAreaSquareMetres=round(poly.area,3), tracePixels=pixels,
            sourceGrid=dict(id=key, **grid, resolutionMetres=.16, pixelMeaning='edge coordinates; E=west+0.16*x, N=north-0.16*y'),
            sourceId='imagery-lm-ortho', captureDate='2026-05-02', observedAppearance=description,
            roofColourDisplayEstimateHex=colour, facadeColourDisplayEstimateHex='d4b156' if target=='way/1163533127' else None,
            interpretationUncertaintyMetres=1.2, horizontalStatus='observed image roof silhouette, not surveyed ground/wall footprint',
            sourceFootprintId=target, sourceFootprintGeometryEpsg3006=mapping(original) if original else None,
            originalGroundFootprintRetained=True, roofHeightRH2000=None, wallHeightMetres=None,
            measuredHeightStatus='pending bounded point/roof correspondence review',
            limitations=['Roof overhang and image displacement are not ground-footprint measurements.',
                '2026 roof appearance and April 2021 laser returns are different observation epochs.',
                'Colours are display estimates from illumination-dependent imagery.'])
        if original:
            record['osmImageComparison']=dict(osmAreaSquareMetres=round(original.area,3),
                centroidDifferenceMetres=round(original.centroid.distance(poly.centroid),3),
                roofOverlapFraction=round(poly.intersection(original).area/poly.area,4),
                status='OSM ground hypothesis and roof outline retained independently; no blanket translation applied')
        records.append(record)
    report=dict(schemaVersion=1, groundId='tortuna', state='provisional-roof-correspondence-observations',
        horizontalCrs='EPSG:3006', verticalCrs='EPSG:5613', reviewedOn='2026-09-09',
        reviewer='assistant source-image interpretation', humanAccepted=False,
        inputs=[identity(g['path']) for g in GRIDS.values()]+[identity(osm_path)],
        sourceIds=['imagery-lm-ortho','laser-lm-skog','tortuna-osm-2026-09-09','club-photo-17','club-photo-65'],
        buildings=records, groundFootprintReplacements=[],
        interpretation='Source geometry first: visible roof selection rings constrain a separately measured source-return surface; they never replace surveyed or OSM ground footprints.')
    (ROOT/'tortunabuild/mapping/building-observations.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    envelopes=dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:3006')),
        axisOrder=['easting','northing'],features=[dict(type='Feature',id=r['id'],
            properties=dict(kind='building_roof_envelope',sourceId=r['sourceId'],associatedBuildingId=r['associatedBuildingId'],
                captureDate=r['captureDate'],sourceWindow=r['sourceGrid']['id'],sourceRasterSha256=r['sourceGrid']['sha256'],
                geometryRole='observed roof/extension envelope for vegetation exclusions; not a replacement ground footprint',
                interpretationUncertaintyMetres=r['interpretationUncertaintyMetres'],humanAccepted=False),
            geometry=r['observedRoofGeometryEpsg3006']) for r in records])
    (ROOT/'tortunabuild/mapping/building-roof-envelopes.geojson').write_text(json.dumps(envelopes,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(buildings=len(records), groundFootprintReplacements=0)))


if __name__=='__main__':
    main()
