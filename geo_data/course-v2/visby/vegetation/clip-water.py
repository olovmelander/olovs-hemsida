#!/usr/bin/env python3
"""Clip pinned national water breaks, preserving polygon holes and RH2000 Z."""
import json
import sqlite3
from hashlib import sha256
from pathlib import Path

import numpy as np
from shapely import get_coordinates
from shapely.geometry import MultiLineString, Point, box, mapping
from shapely.ops import unary_union
from shapely.wkb import loads

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'geo_data/course-v2/visby/mapping'
CACHE = ROOT / 'visbybuild/cache/geodata-2026-09-07'
BOUNDS = [685700.5, 6368903.5, 689796.5, 6372999.5]
SEA_SEEDS = {'636_68': [686000, 6369500], '637_68': [686000, 6371500]}
SOURCE_BOUNDS = {'636_68': [685000,6365000,690000,6370000], '637_68': [685000,6370000,690000,6380000]}


def shoreline_lines(geometry, source_bounds):
    """Retain source water boundaries except artificial AOI/item rectangle edges."""
    boundaries_x = [BOUNDS[0], BOUNDS[2], source_bounds[0], source_bounds[2]]
    boundaries_y = [BOUNDS[1], BOUNDS[3], source_bounds[1], source_bounds[3]]
    same_point = lambda a, b: abs(a[0]-b[0]) < 1e-7 and abs(a[1]-b[1]) < 1e-7
    result, suppressed = [], 0
    pieces = [geometry] if geometry.geom_type == 'Polygon' else geometry.geoms
    for polygon in pieces:
        for ring in [polygon.exterior, *polygon.interiors]:
            points = list(ring.coords)
            runs, current = [], []
            for a, b in zip(points, points[1:]):
                artificial = any(abs(a[0]-x) < 1e-7 and abs(b[0]-x) < 1e-7 for x in boundaries_x) or any(abs(a[1]-y) < 1e-7 and abs(b[1]-y) < 1e-7 for y in boundaries_y)
                if artificial:
                    suppressed += 1
                    if current:
                        runs.append(current)
                        current = []
                elif current and same_point(current[-1], a):
                    current.append(list(b))
                else:
                    if current:
                        runs.append(current)
                    current = [list(a), list(b)]
            if current:
                runs.append(current)
            if len(runs) > 1 and same_point(runs[-1][-1], runs[0][0]):
                runs = [runs[-1] + runs[0][1:], *runs[1:-1]]
            result.extend(runs)
    return result, suppressed


def gpkg_geometry(blob):
    assert blob[:2] == b'GP' and blob[2] == 0, 'Unsupported GeoPackage geometry header'
    envelope_type = (blob[3] >> 1) & 7
    envelope_bytes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope_type]
    return loads(blob[8 + envelope_bytes:])


def main():
    ledger = json.loads((ROOT / 'geo_data/course-v2/visby/reference/lm-retained-assets.json').read_text(encoding='utf-8'))
    clip = box(*BOUNDS)
    features = []
    sources = []
    shore_checks = []
    for item in ['636_68', '637_68']:
        source = next(a for a in ledger['assets'] if a['path'].endswith(f'm{item}_brytgeometri.gpkg'))
        path = ROOT / source['path']
        data = path.read_bytes()
        assert sha256(data).hexdigest() == source['sha256'] and len(data) == source['bytes']
        con = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True)
        assert con.execute('select srs_id from gpkg_geometry_columns where table_name=?', ['polygons']).fetchone() == (3006,)
        read_count = 0
        for fid, raw, classification in con.execute('select fid,geom,classification from polygons order by fid'):
            read_count += 1
            original = gpkg_geometry(raw)
            assert original.is_valid, f'Invalid original polygon {item}/{fid}'
            clipped = original.intersection(clip)
            if clipped.is_empty or clipped.area == 0:
                continue
            assert clipped.geom_type in ['Polygon', 'MultiPolygon'] and clipped.is_valid
            z = get_coordinates(original, include_z=True)[:, 2]
            assert np.isfinite(z).all(), f'Non-finite source water Z {item}/{fid}'
            clipped_z = get_coordinates(clipped, include_z=True)[:, 2]
            assert np.isfinite(clipped_z).all()
            constant_height = float(z.max() - z.min()) < .0001
            sea = original.covers(Point(*SEA_SEEDS[item]))
            shore, suppressed_edges = shoreline_lines(clipped, SOURCE_BOUNDS[item])
            artificial_boundaries = unary_union([clip.boundary, box(*SOURCE_BOUNDS[item]).boundary])
            expected_shore = clipped.boundary.difference(artificial_boundaries)
            retained_shore = MultiLineString(shore)
            shore_difference = retained_shore.symmetric_difference(expected_shore).length
            assert shore_difference < 1e-6, f'Shoreline partition changed source boundary {item}/{fid}'
            shore_checks.append(dict(sourceFeatureId=f'{item}/polygons/{fid}',
                                     chains=len(shore), suppressedArtificialEdges=suppressed_edges,
                                     retainedLengthMetres=retained_shore.length,
                                     symmetricDifferenceLengthMetres=shore_difference))
            features.append(dict(type='Feature', id=f'lm-{item.replace("_", "-")}-water-{fid}',
                                 properties=dict(sourceId='water-breaks-lm-1m', sourceItemId=item,
                                                 sourceFid=fid, sourceFeatureId=f'{item}/polygons/{fid}',
                                                 sourceSha256=source['sha256'], sourceClassification=classification,
                                                 heightRH2000=float(np.median(clipped_z)), kind='flattened-water-surface',
                                                 sourceHeightRangeRH2000=[float(z.min()),float(z.max())],
                                                 clippedHeightRangeRH2000=[float(clipped_z.min()),float(clipped_z.max())],
                                                 constantSourceHeight=constant_height,
                                                 heightTreatment='source-constant' if constant_height else 'representative-median-of-clipped-source-vertex-Z',
                                                 shoreline=dict(lines=shore, coordinateOrder=['easting','northing','heightRH2000'],
                                                                source='canonical-water-boundary-minus-AOI-and-source-item-rectangle-edges',
                                                                suppressedArtificialEdges=suppressed_edges,
                                                                reviewStatus='source-derived-water-boundary-not-surveyed-shore'),
                                                 waterKind='sea' if sea else 'inland-water', isSea=sea,
                                                 seaAssociation='contains-declared-offshore-reference-point' if sea else None,
                                                 offshoreReferenceEpsg3006=SEA_SEEDS[item] if sea else None,
                                                 geometryUse='source-derived-candidate',
                                                 reviewStatus='source-topology-checked-not-field-reviewed',
                                                 clipBoundaryIsShore=False, bathymetry=None),
                                 geometry=mapping(clipped)))
        sources.append(dict(**source, inputPolygonCount=read_count))
        con.close()
    collection = dict(type='FeatureCollection', name='Visby national water breaks, clipped to retained terrain',
                      crs=dict(type='name', properties=dict(name='EPSG:3006')),
                      coordinateOrder=['easting', 'northing', 'heightRH2000'], verticalCrs='EPSG:5613',
                      licence='CC-BY-4.0', attribution='Markhöjdmodell Nedladdning, © Lantmäteriet, processed data, CC BY 4.0.',
                      bboxEpsg3006=BOUNDS, features=features)
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / 'water-breakgeometry-epsg3006.geojson'
    target.write_text(json.dumps(collection, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    holes = lambda g: len(g['coordinates']) - 1 if g['type'] == 'Polygon' else sum(len(p)-1 for p in g['coordinates'])
    report = dict(schemaVersion=1, groundId='visby', observedOn='2026-09-07',
                  sourceAssets=sources, outputPath=target.relative_to(ROOT).as_posix(),
                  outputSha256=sha256(target.read_bytes()).hexdigest(), boundsEpsg3006=BOUNDS,
                  polygons=len(features), seaComponents=sum(f['properties']['isSea'] for f in features),
                  preservedInteriorRings=sum(holes(f['geometry']) for f in features),
                  shorelineChecks=shore_checks,
                  sourceHeightsRH2000=sorted({f['properties']['heightRH2000'] for f in features}),
                  offshoreReferencePointsEpsg3006=SEA_SEEDS,
                  limitations=['Source polygon geometry and water-surface vertex Z were preserved through clipping.',
                               'Inland water Z is constant; sea polygons have a spatially varying source Z. heightRH2000 is only a representative median for variable-Z components; retained vertices remain the source evidence.',
                               'Sea association uses declared offshore points corroborated by the retained course orthophoto; source classification=1 alone does not distinguish sea and pond.',
                               'Clipping boundaries and the shared source-item boundary are not physical shores.',
                               'shoreline.lines suppresses segments lying on the AOI or source-item rectangle boundaries, including the N6370000 sea seam; retained lines are source water-boundary observations, not a surveyed present-day tidal shore.',
                               'No bathymetry, pond depth, current water level or golf penalty-area status is inferred.'])
    (OUT / 'water-breakgeometry-evidence.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ['outputPath', 'polygons', 'seaComponents', 'preservedInteriorRings', 'sourceHeightsRH2000']}))


if __name__ == '__main__':
    main()
