"""Build modelling ground context from retained, hashed class-2 laser returns.

This interpolated reference supports foundations; it does not alter runtime DTM.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'johannesbergbuild/facilities'
OUT = ROOT / 'johannesbergbuild/cache/facilities-model'
ORIGIN = [679200, 6626160, 16]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    sources, arrays = [], []
    for suffix in ['', '/service-hall']:
        folder = ROOT / ('johannesbergbuild/cache/facilities-reference/laser' + suffix)
        receipt = json.loads((folder / 'window.json').read_text())
        data = {}
        for item in receipt['files']:
            p = ROOT / item['path']
            assert sha(p) == item['sha256']
            sources.append({'path': item['path'], 'sha256': item['sha256']})
            if item['dimension'] in ['x', 'y', 'z', 'classification']:
                data[item['dimension']] = np.fromfile(p, {'Float64Array': '<f8', 'Float32Array': '<f4', 'Uint8Array': 'u1'}[item['storage']])
        ground = data['classification'] == 2
        arrays.append(np.column_stack([data[k][ground] for k in ['x', 'y', 'z']]))
    points = np.unique(np.concatenate(arrays), axis=0)
    inventory = json.loads((HERE / 'site-inventory.json').read_text())
    mask = np.zeros(len(points), dtype=bool)
    for f in inventory['facilities']:
        mask |= contains_xy(Polygon(f['geometry']['ringEPSG3006']).buffer(1), points[:,0], points[:,1])
    points = points[~mask]
    tree = cKDTree(points[:, :2])

    def sample(xy):
        dist, indices = tree.query(np.array(xy), k=8)
        weights = 1 / np.maximum(dist, .1)**2
        return np.sum(points[indices, 2] * weights, axis=1) / np.sum(weights, axis=1), dist[:, 0]

    features, all_rings = [], []
    for f in inventory['facilities']:
        ring = f['geometry']['ringEPSG3006']
        all_rings.extend(ring)
        edge_points = []
        for a, b in zip(ring, ring[1:] + ring[:1]):
            count = max(1, int(np.ceil(np.linalg.norm(np.subtract(a, b)) / 1.5)))
            edge_points.extend((np.array(a) + (np.array(b) - a) * t / count).tolist() for t in range(count))
        values, distance = sample(edge_points)
        center = f['geometry']['centroidEPSG3006']
        anchor, anchor_distance = sample([center])
        features.append({'id': f['id'], 'sourceBuildingId': f['sourceBuildingId'],
                         'anchorEpsg3006': center, 'groundAnchorRh2000M': round(float(anchor[0]), 3),
                         'anchorNearestReturnDistanceM': round(float(anchor_distance[0]), 3),
                         'groundPerimeterRH2000': [round(float(v), 3) for v in np.quantile(values, [0, .1, .5, .9, 1])],
                         'perimeterSampleLocationsEpsg3006': edge_points,
                         'perimeterHeightsRH2000': np.round(values, 3).tolist(),
                         'maximumNearestReturnDistanceM': round(float(max(distance)), 3)})
    extent = np.array(all_rings)
    x0, y0 = np.floor((extent.min(axis=0) - ORIGIN[:2] - 14) / 2) * 2
    x1, y1 = np.ceil((extent.max(axis=0) - ORIGIN[:2] + 14) / 2) * 2
    width, height = int((x1-x0)/2)+1, int((y1-y0)/2)+1
    xx, yy = np.meshgrid(np.arange(width)*2+x0+ORIGIN[0], np.arange(height)*2+y0+ORIGIN[1])
    values, distances = sample(np.column_stack([xx.ravel(), yy.ravel()]))
    grid = {'x0': float(x0), 'y0': float(y0), 'step': 2, 'width': width, 'height': height,
            'heights': np.round(values - ORIGIN[2], 3).tolist(),
            'nearestSourceDistanceM': np.round(distances, 2).tolist()}
    OUT.mkdir(exist_ok=True, parents=True)
    grid_path = OUT / 'ground-grid.json'
    grid_path.write_text(json.dumps(grid, separators=(',', ':')) + '\n', encoding='utf-8')
    report = {'schemaVersion': 1, 'originEPSG3006': ORIGIN[:2], 'originHeightRH2000M': ORIGIN[2],
              'captureDate': '2021-04-17', 'horizontalCrs': 'EPSG:3006', 'verticalCrs': 'EPSG:5613',
              'method': 'Inverse squared distance of eight nearest class-2 returns outside 1m-buffered building footprints; 2m reference grid.',
              'limits': ['Modelling reference only; no runtime terrain replacement.',
                         'Ground under roofs is interpolated; it is not a surveyed floor.',
                         'Context outside source windows may be extrapolated; nearest distances are retained.'],
              'groundSourcePoints': len(points), 'sources': sources,
              'inventory': {'path': 'johannesbergbuild/facilities/site-inventory.json', 'sha256': sha(HERE/'site-inventory.json')},
              'gridPath': grid_path.relative_to(ROOT).as_posix(), 'gridSha256': sha(grid_path),
              'grid': {k: v for k, v in grid.items() if k not in ['heights', 'nearestSourceDistanceM']}, 'facilities': features}
    (HERE/'model-ground.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'groundPoints': len(points), 'features': len(features), 'grid': report['grid']}))


if __name__ == '__main__':
    main()
