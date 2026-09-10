"""Acquire LM water boundaries and assemble one ocean with documented gap fill.

Run with upsalabuild/cache/review-venv/Scripts/python.exe. Raw GeoPackages remain
in ignored cache. Credentials follow the existing orthophoto intake. Source
island holes are preserved regardless of their height in the laser model.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import gzip
import importlib.util
import json
import math
from pathlib import Path
import sqlite3
import urllib.request
import zlib

import contourpy
import numpy as np
import shapely
from shapely.geometry import Point, Polygon, MultiPolygon, LineString, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'apps/golf/public'
CACHE = ROOT / 'nvgkbuild/cache/marine-water'
REPORT = ROOT / 'geo_data/course-v2/norrfallsviken/reference/lm-marine-water-2026-09-09.json'
GAP_REVIEW = ROOT / 'nvgkbuild/cache/marine-gap-review/index.json'
GAP_SEAM_METRES = 4
GAP_HOLE_MAX_HEIGHT = 0.8
REVIEWED_OPEN_SEA = {
    'north-gap': ([680000, 6990500, 681500, 6992200],
        'fd46c3bbd9944521037a8cb51bf7f121ae981520ae234ad028420aa4b5086d02'),
    'east-gap': ([680000, 6987500, 682500, 6990000],
        '4ee1b7c75ede5c413d1858f9d4d4bbd5d7f7bf75eaa21b01819e8b3851854176'),
}


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [p for part in g.geoms for p in polygons(part)]


def lines(g):
    if g.is_empty:
        return []
    if g.geom_type in ('LineString', 'LinearRing'):
        return [g]
    return [p for part in g.geoms for p in lines(part)]


def coords(ring):
    return [[round(p[0], 2), round(p[1], 2)] for p in ring.coords]


def rings(g):
    return [coords(g.exterior)] + [coords(r) for r in g.interiors]


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def acquire():
    spec = importlib.util.spec_from_file_location('nvgk_ortho', ROOT / 'nvgkbuild/mapping/lm-ortho-acquire.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import lm_ortho
    auth = module.credentials()
    opener = urllib.request.build_opener(lm_ortho.NoRedirect())
    discovery = read_json(ROOT / 'geo_data/course-v2/norrfallsviken/acquisition/d2-discovery.json')
    CACHE.mkdir(parents=True, exist_ok=True)
    sources, water, islands, footprints = [], [], [], []
    for item in discovery['terrain']['items']:
        asset = item['assets']['breakgeometry']
        target = CACHE / (item['id'] + '-breakgeometry.gpkg')
        if not target.exists():
            request = urllib.request.Request(asset['href'], headers={'Authorization': auth})
            with opener.open(request, timeout=40) as response:
                data = response.read(asset['bytes'] + 1)
            if len(data) != asset['bytes'] or sha(data) != asset['sha256']:
                raise ValueError('LM source size/checksum differs: ' + item['id'])
            target.write_bytes(data)
        data = target.read_bytes()
        if len(data) != asset['bytes'] or sha(data) != asset['sha256']:
            raise ValueError('Cached source size/checksum differs: ' + item['id'])
        source = dict(id=item['id'], url=asset['href'], bytes=len(data), sha256=sha(data), features=[])
        connection = sqlite3.connect('file:' + target.as_posix() + '?mode=ro', uri=True)
        schema = connection.execute('SELECT table_name,column_name,geometry_type_name,srs_id,z FROM gpkg_geometry_columns').fetchall()
        if schema != [('polygons', 'geom', 'POLYGON', 3006, 1)]:
            raise ValueError('Unexpected LM water geometry schema')
        extent = connection.execute('SELECT min_x,min_y,max_x,max_y FROM gpkg_contents WHERE table_name=?', ('polygons',)).fetchone()
        footprints.append(box(*extent))
        source['declaredBoundsEpsg3006'] = list(extent)
        for fid, raw, classification in connection.execute('SELECT fid,geom,classification FROM polygons'):
            envelope_bytes = [0, 32, 48, 48, 64][(raw[3] >> 1) & 7]
            g = shapely.from_wkb(raw[8 + envelope_bytes:])
            heights = [p[2] for p in g.exterior.coords]
            # The large marine surfaces have the source's common -0.03/-0.04 m
            # level. Low enclosed pools and inland lakes remain separate.
            marine = classification == 1 and min(heights) >= -0.05 and max(heights) <= -0.02 and g.area >= 10000
            source['features'].append(dict(fid=fid, classification=classification,
                areaSquareMetres=round(g.area, 3), heightRangeRH2000=[min(heights), max(heights)],
                islandHoles=len(g.interiors), marineCandidate=marine))
            if not marine:
                continue
            g = shapely.force_2d(g)
            if not g.is_valid:
                raise ValueError('Invalid source marine polygon: ' + item['id'] + '/' + str(fid))
            water.append(g)
            islands.extend(Polygon(r) for r in g.interiors)
        connection.close()
        sources.append(source)
    return sources, unary_union(water), unary_union(islands), unary_union(footprints)


def source_gap_domain(water, footprints, world):
    """Long straight campaign crop edges reveal unprovided water geometry."""
    lengths = defaultdict(float)
    for polygon in polygons(water):
        pts = list(polygon.exterior.coords)
        for a, b in zip(pts, pts[1:]):
            for axis in (0, 1):
                aligned = round((a[axis] + b[axis]) / 5000) * 2500
                if max(abs(a[axis] - aligned), abs(b[axis] - aligned)) > 4:
                    continue
                span = abs(a[1 - axis] - b[1 - axis])
                if span < 15:
                    continue
                middle = [(a[k] + b[k]) / 2 for k in (0, 1)]
                for direction in (-1, 1):
                    p = middle.copy()
                    p[axis] = aligned + direction * 20
                    if water.covers(Point(*p)):
                        continue
                    cell = (math.floor(p[0] / 2500), math.floor(p[1] / 2500))
                    lengths[cell] += span
    domains, records = [], []
    for (col, row), length in sorted(lengths.items()):
        if length < 625:
            continue
        bounds = [col * 2500, row * 2500, (col + 1) * 2500, (row + 1) * 2500]
        # Native campaign cuts are offset about half a metre from the nominal
        # grid. Extend the missing-data domain across that sliver before union.
        g = box(*bounds).buffer(GAP_SEAM_METRES, join_style=2).intersection(world)
        if g.is_empty:
            continue
        domains.append(g)
        records.append(dict(boundsEpsg3006=bounds, observedCropEdgeMetres=round(length, 2),
            seamAllowanceMetres=GAP_SEAM_METRES,
            reason='long source boundary on 2.5 km campaign grid; polygon absence is not land evidence'))
    outside = world.difference(footprints)
    domains.append(outside)
    return unary_union(domains).difference(water), records


def terrain_raster(ground, world, spacing=4):
    """Sample unmodified published tiles; finer source levels replace coarser."""
    x0, y0, x1, y1 = world.bounds
    width, height = math.ceil((x1 - x0) / spacing) + 1, math.ceil((y1 - y0) / spacing) + 1
    xs, ys = np.linspace(x0, x1, width), np.linspace(y0, y1, height)
    raster = np.full((height, width), np.nan, dtype=np.float32)
    for tile in sorted(ground['tiles'], key=lambda t: -t['lod']):
        reference = tile['layers']['terrain']
        raw = (PUBLIC / reference['url']).read_bytes()
        if sha(raw) != reference['sha256']:
            raise ValueError('Published terrain SHA256 mismatch')
        header_bytes = int.from_bytes(raw[8:12], 'little')
        header = json.loads(raw[16:16 + header_bytes])
        encoded = raw[16 + header_bytes:]
        decoded = zlib.decompress(encoded, -15) if raw[5] == 1 else encoded
        grid, bounds = header['grid'], tile['bounds']
        source = np.frombuffer(decoded, dtype='<u2').reshape(grid['height'], grid['width'])
        c0 = np.searchsorted(xs, bounds['minEasting'])
        c1 = np.searchsorted(xs, bounds['maxEasting'], side='right')
        r0 = np.searchsorted(ys, bounds['minNorthing'])
        r1 = np.searchsorted(ys, bounds['maxNorthing'], side='right')
        fx = (xs[c0:c1] - bounds['minEasting']) / grid['sampleSpacingMetres']
        left = np.minimum(grid['width'] - 1, np.floor(fx).astype(int))
        right = np.minimum(grid['width'] - 1, left + 1)
        tx = fx - left
        for start in range(r0, r1, 128):
            stop = min(r1, start + 128)
            fy = (bounds['maxNorthing'] - ys[start:stop]) / grid['sampleSpacingMetres']
            top = np.minimum(grid['height'] - 1, np.maximum(0, np.floor(fy).astype(int)))
            bottom = np.minimum(grid['height'] - 1, top + 1)
            ty = fy - top
            a, b = source[top[:, None], left], source[top[:, None], right]
            c, d = source[bottom[:, None], left], source[bottom[:, None], right]
            nodata = grid.get('noDataValue', 65535)
            valid = (a != nodata) & (b != nodata) & (c != nodata) & (d != nodata)
            values = ((a * (1 - tx) + b * tx) * (1 - ty[:, None]) + (c * (1 - tx) + d * tx) * ty[:, None])
            values = values * grid['heightScaleMetres'] + grid['heightOffsetMetres']
            raster[start:stop, c0:c1] = np.where(valid, values, np.nan)
    return xs, ys, raster


def fallback_contours(xs, ys, raster, threshold, domain, measured, islands):
    contour = contourpy.contour_generator(x=xs, y=ys, z=np.ma.masked_invalid(raster),
        fill_type='OuterOffset', chunk_size=256)
    points, offsets = contour.filled(-1000, threshold)
    parts = []
    for pts, breaks in zip(points, offsets):
        rs = [pts[a:b] for a, b in zip(breaks, breaks[1:])]
        g = Polygon(rs[0], rs[1:])
        if not g.is_valid:
            g = shapely.make_valid(g)
        part = g.intersection(domain).difference(islands)
        if not part.is_empty:
            parts.append(part)
    candidates = unary_union(parts)
    # A source-cropped sea can enter via more than one gap. Resolve all parts
    # together, retaining only components attached to delivered marine water.
    combined = unary_union([measured, candidates]).difference(islands)
    selected = [g for g in polygons(combined) if g.intersection(measured).area > 1]
    final = unary_union(selected)
    return final, final.difference(measured)


def repair_gap_holes(final, domain, islands, xs, ys, raster):
    """Remove only enclosed low DTM artefacts; mainland contours stay unchanged.

    A component can straddle a wavy native campaign cut. Repair that entire
    enclosed component, rather than cutting it again at the nominal rectangle.
    Every explicit source island remains protected independently of elevation.
    """
    repaired, records = [], []
    spacing = float(xs[1] - xs[0])
    for p in polygons(final):
        for r in p.interiors:
            hole = Polygon(r)
            if not hole.intersects(domain) or hole.intersection(islands).area > 0.01:
                continue
            sample_area = hole.buffer(spacing)
            x0, y0, x1, y1 = sample_area.bounds
            c0, c1 = np.searchsorted(xs, [x0, x1])
            r0, r1 = np.searchsorted(ys, [y0, y1])
            xx, yy = np.meshgrid(xs[c0:c1], ys[r0:r1])
            values = raster[r0:r1, c0:c1][shapely.contains_xy(sample_area, xx, yy)]
            if not len(values) or not np.isfinite(values).all() or values.max() > GAP_HOLE_MAX_HEIGHT:
                continue
            repaired.append(hole)
            records.append(dict(boundsEpsg3006=list(hole.bounds), areaSquareMetres=hole.area,
                maximumSampleHeightRH2000=float(values.max()), samples=len(values)))
    return unary_union([final, *repaired]).difference(islands), records


def reviewed_open_sea():
    """Pinned windows visually reviewed as open sea, with historical provenance."""
    if not GAP_REVIEW.exists():
        raise ValueError('Run nvgkbuild/mapping/review-marine-gaps.py before rebuilding the ocean')
    review = read_json(GAP_REVIEW)
    records = []
    for identifier, (bounds, expected_sha) in REVIEWED_OPEN_SEA.items():
        item = next(w for w in review['windows'] if w['id'] == identifier)
        if item['boundsEpsg3006'] != bounds or item['pngSha256'] != expected_sha:
            raise ValueError('The visually reviewed marine window changed: ' + identifier)
        if sha((ROOT / item['file']).read_bytes()) != expected_sha:
            raise ValueError('The visually reviewed marine image checksum differs')
        records.append(dict(**item, interpretation='uniform open sea; no visible land or skerries',
            limitation=review['limitation']))
    return unary_union([box(*r['boundsEpsg3006']) for r in records]), records


def shore_without_campaign_cuts(final, islands, world, gap_records):
    cuts = unary_union([box(*r['boundsEpsg3006']).boundary for r in gap_records])
    boundary = final.boundary.difference(world.boundary.buffer(0.02))
    # These grid-aligned crop lines are not physical shores. An explicit island
    # remains a shore even if it happens to cross the campaign grid.
    coast = boundary.difference(cuts.buffer(GAP_SEAM_METRES))
    protected = boundary.intersection(islands.boundary.buffer(0.02))
    return unary_union([coast, protected]), boundary.difference(unary_union([coast, protected])).length


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fallback-max-height', type=float, default=0.15)
    args = parser.parse_args()
    if not 0 <= args.fallback_max_height <= 0.8:
        raise ValueError('Fallback bound must remain within reviewed coastal range')
    sources, measured, islands, footprints = acquire()
    index = read_json(PUBLIC / 'courses/v2-index.json')
    course_ref = next(c['manifest'] for c in index['courses'] if c['slug'] == 'norrfallsviken')
    course = read_json(PUBLIC / course_ref['url'])
    ground_ref = course['groundManifest']
    ground = read_json(PUBLIC / ground_ref['url'])
    b = ground['bounds']
    world = box(b['minEasting'], b['minNorthing'], b['maxEasting'], b['maxNorthing'])
    measured, islands = measured.intersection(world), islands.intersection(world)
    domain, gap_records = source_gap_domain(measured, footprints, world)
    print('Source marine area', round(measured.area / 1e6, 3), 'km2; source-gap area', round(domain.area / 1e6, 3), 'km2', flush=True)
    xs, ys, raster = terrain_raster(ground, world)
    final, fallback = fallback_contours(xs, ys, raster, args.fallback_max_height, domain, measured, islands)
    final, repaired_holes = repair_gap_holes(final, domain, islands, xs, ys, raster)
    reviewed_sea, imagery_review = reviewed_open_sea()
    reviewed_fill = reviewed_sea.intersection(world).difference(final).difference(islands)
    final = unary_union([final, reviewed_fill]).difference(islands)
    print('Repaired enclosed low gap holes', len(repaired_holes), 'image-confirmed fill',
          round(reviewed_fill.area), 'm2', flush=True)
    # Native XY coordinates have centimetre precision. Use one shared topology
    # grid before every overlay so serialized adjacent bands share boundaries.
    # Rounding independently generated rings can otherwise create slivers.
    islands = shapely.set_precision(islands, 0.01)
    final = shapely.set_precision(final, 0.01).difference(islands)
    fallback = final.difference(shapely.set_precision(measured, 0.01))
    if final.is_empty or not final.is_valid or final.intersection(islands).area > 1e-5:
        raise ValueError('Marine union lost topology or covers a source island')
    coast, excluded_crop_length = shore_without_campaign_cuts(final, islands, world, gap_records)
    segments = []
    for line in lines(coast):
        pts = list(line.coords)
        segments.extend(LineString([a, b]) for a, b in zip(pts, pts[1:]) if a != b)
    tree = STRtree(segments)
    segment_array = np.asarray(segments, dtype=object)
    def band_polygon(p):
        rs = rings(p)
        ds = []
        for r in rs:
            points = shapely.points(r)
            nearest = tree.nearest(points)
            distances = shapely.distance(points, segment_array[nearest])
            ds.append([round(min(60, float(d)), 3) for d in distances])
        return dict(rings=rs, shorelineDistances=ds)
    band_records, band_geometries, previous = [], [], shapely.set_precision(Polygon(), 0.01)
    lower = 0
    for upper in [2, 8, 20, 40, 60, None]:
        covered = final if upper is None else final.intersection(shapely.set_precision(coast.buffer(upper, quad_segs=4), 0.01))
        band = covered.difference(previous)
        parts = [p for p in polygons(band) if p.area > 1e-6]
        band_geometries.append(unary_union(parts))
        band_records.append(dict(minDistance=lower, maxDistance=upper,
            polygons=[band_polygon(p) for p in parts]))
        previous = covered
        print('Band', lower, upper, 'polygons', len(parts), flush=True)
        lower = upper
    # Re-read the actual serialized coordinates; these checks are independent
    # of the working GEOS objects used to construct the bands.
    serialized = [shapely.set_precision(Polygon(p['rings'][0], p['rings'][1:]), 0.01)
        for band in band_records for p in band['polygons']]
    if any(not p.is_valid for p in serialized):
        raise ValueError('Serialized shore band contains invalid geometry')
    band_union = unary_union(serialized)
    missing = final.difference(band_union).area
    excess = band_union.difference(final).area
    overlap = max(0, sum(p.area for p in serialized) - band_union.area)
    island_overlap = band_union.intersection(islands).area
    if max(missing, excess, overlap, island_overlap) > 0.05:
        raise ValueError('Band coverage or island protection differs: ' + str([missing, excess, overlap, island_overlap]))
    artefact = dict(schemaVersion=1, crs='EPSG:3006', verticalCrs='EPSG:5613',
        bounds={k: b[k] for k in ('minEasting', 'minNorthing', 'maxEasting', 'maxNorthing')},
        seaLevelRH2000=-0.03,
        marinePolygons=[rings(p) for p in polygons(final)],
        islandPolygons=[rings(p) for p in polygons(islands)],
        coastlines=[coords(line) for line in lines(coast)], bands=band_records,
        fallbackPolygons=[rings(p) for p in polygons(fallback)],
        sourceGaps=gap_records,
        fallbackPolicy=dict(source='unmodified published LM terrain', sampleSpacingMetres=float(xs[1] - xs[0]),
            maximumHeightRH2000=args.fallback_max_height, connectedToMeasuredMarine=True,
            restrictedToSourceGaps=True, sourceIslandHolesPreserved=True,
            campaignSeamAllowanceMetres=GAP_SEAM_METRES,
            enclosedGapHoleMaximumHeightRH2000=GAP_HOLE_MAX_HEIGHT,
            repairedLowHoleCount=len(repaired_holes), repairedLowHoleAreaSquareMetres=sum(r['areaSquareMetres'] for r in repaired_holes),
            reviewedOpenSeaWindows=[r['id'] for r in imagery_review],
            excludedArtificialCoastLengthMetres=excluded_crop_length),
        imageryReview=imagery_review,
        sources=[{k: s[k] for k in ('id', 'url', 'bytes', 'sha256')} for s in sources])
    data = (json.dumps(artefact, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    compressed = gzip.compress(data, compresslevel=9, mtime=0)
    digest = sha(compressed)
    destination = PUBLIC / 'courses/norrfallsviken' / ('environment-ocean-' + digest + '.json.gz')
    destination.write_bytes(compressed)
    source_config = ROOT / 'apps/golf/src/engine/norrfallsviken-ocean-source.mjs'
    source_config.write_text('// Verified LM marine boundaries with separately documented terrain-derived source-gap fill.\n'
        + 'export const NORRFALLSVIKEN_OCEAN_SOURCE = Object.freeze(' + json.dumps(dict(
            url=destination.relative_to(PUBLIC).as_posix(), sha256=digest, bytes=len(compressed),
            compression='gzip', decodedBytes=len(data), decodedSha256=sha(data)), indent=2) + ');\n', encoding='utf-8')
    report = dict(schemaVersion=1, groundId='norrfallsviken', acquiredAt=datetime.now(timezone.utc).isoformat(),
        provider='Lantmateriet', product='Markhojdmodell brytgeometri', licence='CC-BY-4.0',
        sourceGroundManifest=ground_ref, sources=sources, sourceGaps=gap_records,
        geometry=dict(measuredAreaSquareMetres=measured.area, fallbackAreaSquareMetres=fallback.area,
            finalAreaSquareMetres=final.area, preservedIslandAreaSquareMetres=islands.area,
            sourceIslandPolygons=len(polygons(islands)), finalPolygons=len(polygons(final)),
            finalInteriorRings=sum(len(p.interiors) for p in polygons(final)),
            coastLengthMetres=coast.length, valid=final.is_valid),
        fallbackPolicy=artefact['fallbackPolicy'],
        imageryReview=imagery_review, repairedGapHoles=repaired_holes,
        validation=dict(serializedBandsValid=True, missingSquareMetres=missing, excessSquareMetres=excess,
            overlapSquareMetres=overlap, sourceIslandOverlapSquareMetres=island_overlap,
            sharedTopologyPrecisionMetres=0.01),
        islandProbes=[dict(easting=p.representative_point().x, northing=p.representative_point().y,
            areaSquareMetres=p.area, expected='land') for p in sorted(polygons(islands), key=lambda p:p.area)[::max(1,len(polygons(islands))//6)]],
        limitations=['Source height is a flattened sea surface, not bathymetry.',
            'Older campaign rectangles omit water break polygons; their fallback coast is terrain-derived.',
            'Two open-sea rectangles are visually supported by historical 2012 imagery, not a current shoreline survey.',
            'Enclosed gap-only terrain artefacts up to 0.8 m are filtered; all explicit source island polygons remain dry.',
            'Unmapped low skerries outside the reviewed rectangles remain limited by terrain sampling and stated filtering.'],
        artifact=dict(url=destination.relative_to(PUBLIC).as_posix(), bytes=len(compressed), sha256=digest,
            compression='gzip', decodedBytes=len(data), decodedSha256=sha(data)))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['artifact']), flush=True)


if __name__ == '__main__':
    main()
