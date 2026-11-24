#!/usr/bin/env python3
"""Multi-band (0.16 m RGBI + NIR + optional DTM/intensity) candidate surface extractor.

Runs inside the locked Pixi `mapping` Python 3.12 environment. Given a cached
4-band RGBI GeoTIFF (`EPSG:3006`) and seed hints (green, bunker, waste_sand,
tee, fairway, water, mown_approach), computes NDVI, green-NIR NDWI, brightness,
and chroma, performs seed-guided connected-component extraction with
morphological cleanup, preserves interior holes/islands (`[outerRing, ...innerRings]`),
and writes topologically valid `EPSG:3006` candidate polygons plus optional
native RGBI review crops into the gitignored local cache.

Extracted polygons are strictly tagged `status: "segmentation-candidate-awaiting-review"`
and must always be reviewed against native paired source overlays before acceptance.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import shape
from shapely.validation import make_valid


def compute_spectral_indices(rgbi: np.ndarray) -> dict[str, np.ndarray]:
    """Compute float32 spectral bands from uint8 (4, H, W) RGBI array."""
    r = rgbi[0].astype(np.float32) / 255.0
    g = rgbi[1].astype(np.float32) / 255.0
    b = rgbi[2].astype(np.float32) / 255.0
    nir = rgbi[3].astype(np.float32) / 255.0
    eps = 1e-5
    ndvi = (nir - r) / (nir + r + eps)
    ndwi = (g - nir) / (g + nir + eps)
    brightness = (r + g + b) / 3.0
    chroma = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    green_excess = g - 0.5 * (r + b)
    return {
        'r': r, 'g': g, 'b': b, 'nir': nir,
        'ndvi': ndvi, 'ndwi': ndwi, 'brightness': brightness,
        'chroma': chroma, 'green_excess': green_excess,
    }


def class_mask_for_seed(
    kind: str,
    indices: dict[str, np.ndarray],
    seed_rc: tuple[int, int],
    *,
    tolerance_scale: float = 1.0,
) -> np.ndarray:
    """Build a local spectral membership mask anchored at the seed pixel's properties."""
    h, w = indices['ndvi'].shape
    sr, sc = seed_rc
    r0, r1 = max(0, sr - 2), min(h, sr + 3)
    c0, c1 = max(0, sc - 2), min(w, sc + 3)
    s_ndvi = float(np.median(indices['ndvi'][r0:r1, c0:c1]))
    s_ndwi = float(np.median(indices['ndwi'][r0:r1, c0:c1]))
    s_bright = float(np.median(indices['brightness'][r0:r1, c0:c1]))
    s_g = float(np.median(indices['g'][r0:r1, c0:c1]))

    ndvi = indices['ndvi']
    ndwi = indices['ndwi']
    bright = indices['brightness']
    g = indices['g']
    t = float(tolerance_scale)

    if kind in ('bunker', 'waste_sand'):
        # Bright low-NDVI mineral surface (white marble marmorkross or natural sand)
        ndvi_cap = min(0.28, s_ndvi + 0.16 * t)
        bright_floor = max(0.32, s_bright - 0.22 * t)
        return (ndvi <= ndvi_cap) & (bright >= bright_floor) & (ndwi < 0.35)
    if kind == 'water':
        # Dark NIR-absorbing water body
        ndwi_floor = max(-0.05, s_ndwi - 0.18 * t)
        ndvi_cap = min(0.15, s_ndvi + 0.15 * t)
        return (ndwi >= ndwi_floor) & (ndvi <= ndvi_cap) & (bright <= min(0.55, s_bright + 0.20 * t))
    if kind in ('green', 'tee', 'mown_approach', 'fairway'):
        # Tightly mown high-NDVI turf with consistent local brightness & green reflectance
        ndvi_tol = (0.14 if kind in ('green', 'tee') else 0.18) * t
        bright_tol = (0.14 if kind in ('green', 'tee') else 0.18) * t
        g_tol = (0.14 if kind in ('green', 'tee') else 0.18) * t
        return (
            (np.abs(ndvi - s_ndvi) <= ndvi_tol)
            & (np.abs(bright - s_bright) <= bright_tol)
            & (np.abs(g - s_g) <= g_tol)
            & (ndvi > 0.15)
        )
    # Generic local spectral match
    return (np.abs(ndvi - s_ndvi) <= 0.16 * t) & (np.abs(bright - s_bright) <= 0.16 * t)


def extract_seed_polygon(
    rgbi: np.ndarray,
    transform,
    seed_easting: float,
    seed_northing: float,
    kind: str,
    *,
    search_radius_m: float = 45.0,
    simplify_m: float = 0.35,
    min_area_m2: float = 4.0,
    min_island_area_m2: float = 2.0,
    tolerance_scale: float = 1.0,
    preserve_islands: bool = True,
) -> dict | None:
    """Extract a topologically valid EPSG:3006 polygon (with innerRings) around one seed."""
    _, h, w = rgbi.shape
    px_w = abs(transform.a)
    px_h = abs(transform.e)
    inv = ~transform
    sc_f, sr_f = inv * (seed_easting, seed_northing)
    sc, sr = int(round(sc_f)), int(round(sr_f))
    if not (0 <= sr < h and 0 <= sc < w):
        return None

    rad_c = max(4, int(math.ceil(search_radius_m / px_w)))
    rad_r = max(4, int(math.ceil(search_radius_m / px_h)))
    r0, r1 = max(0, sr - rad_r), min(h, sr + rad_r + 1)
    c0, c1 = max(0, sc - rad_c), min(w, sc + rad_c + 1)

    sub = rgbi[:, r0:r1, c0:c1]
    local_sr, local_sc = sr - r0, sc - c0
    sub_transform = transform * rasterio.Affine.translation(c0, r0)

    indices = compute_spectral_indices(sub)
    mask = class_mask_for_seed(kind, indices, (local_sr, local_sc), tolerance_scale=tolerance_scale)

    # Ensure seed pixel is included so labeling always anchors on the seed
    mask[local_sr, local_sc] = True

    # Light morphological closing to bridge 1-pixel mower/shadow noise without erasing islands
    struct = ndimage.generate_binary_structure(2, 1)
    cleaned = ndimage.binary_closing(mask, structure=struct, iterations=1)
    cleaned = ndimage.binary_opening(cleaned, structure=struct, iterations=1)
    cleaned[local_sr, local_sc] = True

    labeled, _ = ndimage.label(cleaned)
    target_label = labeled[local_sr, local_sc]
    if target_label == 0:
        return None
    component = (labeled == target_label)

    # Optionally remove tiny pinhole noise inside the component while keeping real grass islands
    if preserve_islands:
        min_island_px = max(1, int(round(min_island_area_m2 / (px_w * px_h))))
        filled = ndimage.binary_fill_holes(component)
        holes = filled & (~component)
        hole_labels, n_holes = ndimage.label(holes)
        for hid in range(1, n_holes + 1):
            hmask = (hole_labels == hid)
            if int(hmask.sum()) < min_island_px:
                component[hmask] = True
    else:
        component = ndimage.binary_fill_holes(component)

    # Vectorize exact connected component in EPSG:3006
    best_geom = None
    best_area = 0.0
    for geom_dict, val in shapes(component.astype(np.uint8), mask=component, transform=sub_transform):
        if val != 1:
            continue
        geom = make_valid(shape(geom_dict))
        if geom.geom_type == 'MultiPolygon':
            geom = max(geom.geoms, key=lambda g: g.area)
        if geom.geom_type == 'Polygon' and geom.area > best_area:
            best_geom = geom
            best_area = geom.area

    if best_geom is None or best_geom.area < min_area_m2:
        return None

    simplified = make_valid(best_geom.simplify(simplify_m, preserve_topology=True))
    if simplified.geom_type == 'MultiPolygon':
        simplified = max(simplified.geoms, key=lambda g: g.area)
    if simplified.geom_type != 'Polygon' or simplified.area < min_area_m2:
        return None

    def round_ring(coords):
        ring = [[round(float(x), 3), round(float(y), 3)] for x, y in coords]
        if len(ring) >= 2 and ring[0] != ring[-1]:
            ring.append(ring[0])
        return ring

    outer = round_ring(simplified.exterior.coords)
    inners = []
    if preserve_islands:
        for interior in simplified.interiors:
            if shape({'type': 'Polygon', 'coordinates': [list(interior.coords)]}).area >= min_island_area_m2:
                inners.append(round_ring(interior.coords))

    return {
        'coordinates': [outer, *inners],
        'areaM2': round(float(simplified.area), 2),
        'islandCount': len(inners),
        'cropBox': (c0, r0, c1, r1),
        'subTransform': sub_transform,
    }


def render_review_crop(rgbi: np.ndarray, crop_box: tuple[int, int, int, int], sub_transform, rings: list, out_path: Path):
    """Write a side-by-side RGBI | candidate-ring review crop into cache."""
    c0, r0, c1, r1 = crop_box
    rgb = np.transpose(rgbi[:3, r0:r1, c0:c1], (1, 2, 0))
    base = Image.fromarray(rgb, mode='RGB')
    overlay = base.copy()
    draw = ImageDraw.Draw(overlay)
    inv = ~sub_transform
    for idx, ring in enumerate(rings):
        pts = [inv * (e, n) for e, n in ring]
        color = '#ffff00' if idx == 0 else '#00ffff'
        if len(pts) >= 2:
            draw.line(pts, fill=color, width=2)
    pair = Image.new('RGB', (base.width * 2, base.height), '#15191f')
    pair.paste(base, (0, 0))
    pair.paste(overlay, (base.width, 0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pair.save(out_path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rgbi', type=Path, required=True, help='Cached 4-band EPSG:3006 RGBI GeoTIFF')
    parser.add_argument('--seeds', type=Path, required=True, help='JSON array or {seeds: [...]} of seed specs')
    parser.add_argument('--out', type=Path, required=True, help='Output EPSG:3006 candidate GeoJSON')
    parser.add_argument('--review-dir', type=Path, help='Optional gitignored cache dir for paired RGBI crops')
    args = parser.parse_args(argv)

    if args.review_dir and 'cache' not in args.review_dir.parts:
        parser.error('--review-dir must lie under a local cache directory')

    seed_doc = json.loads(args.seeds.read_text(encoding='utf-8'))
    seeds = seed_doc if isinstance(seed_doc, list) else seed_doc.get('seeds', [])

    features = []
    skipped = []
    with rasterio.open(args.rgbi) as src:
        rgbi = src.read([1, 2, 3, 4]) if src.count >= 4 else np.vstack([src.read([1, 2, 3]), np.zeros((1, src.height, src.width), dtype=np.uint8)])
        transform = src.transform

    for idx, seed in enumerate(seeds):
        sid = seed.get('id') or f'seed-{idx + 1}'
        kind = seed.get('kind') or 'bunker'
        e, n = seed['epsg3006']
        res = extract_seed_polygon(
            rgbi, transform, float(e), float(n), kind,
            search_radius_m=float(seed.get('searchRadiusM', 45.0)),
            simplify_m=float(seed.get('simplifyM', 0.35)),
            min_area_m2=float(seed.get('minAreaM2', 4.0)),
            min_island_area_m2=float(seed.get('minIslandAreaM2', 2.0)),
            tolerance_scale=float(seed.get('toleranceScale', 1.0)),
            preserve_islands=bool(seed.get('preserveIslands', True)),
        )
        if res is None:
            skipped.append({'id': sid, 'kind': kind, 'reason': 'no valid polygon extracted'})
            continue
        if args.review_dir:
            render_review_crop(rgbi, res['cropBox'], res['subTransform'], res['coordinates'], args.review_dir / f'{sid}.png')
        features.append({
            'type': 'Feature',
            'id': sid,
            'properties': {
                'kind': kind,
                'hole': seed.get('hole'),
                'areaM2': res['areaM2'],
                'islandCount': res['islandCount'],
                'status': 'segmentation-candidate-awaiting-review',
                'seedEpsg3006': [e, n],
            },
            'geometry': {
                'type': 'Polygon',
                'coordinates': res['coordinates'],
            },
        })

    fc = {
        'type': 'FeatureCollection',
        'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
        'status': 'segmentation-candidates-awaiting-review',
        'features': features,
        'skipped': skipped,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(fc, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'extracted': len(features), 'skipped': len(skipped), 'out': str(args.out)}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
