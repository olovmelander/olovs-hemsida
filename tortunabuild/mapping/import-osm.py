"""Normalize the dated, bounded OSM extract without inventing golf geometry.

Raw XML stays in cache. Public geometry omits contributor/user metadata and
contact details; ODbL attribution and exact source identity remain explicit.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from pyproj import Transformer, __proj_version__
from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tortunabuild/cache/reference/osm.xml'
OUTPUT = ROOT / 'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson'
URL = 'https://api.openstreetmap.org/api/0.6/map?bbox=16.71,59.651,16.744,59.674'
SOURCE_ID = 'tortuna-osm-2026-09-09'
ALLOWED = {'name', 'golf', 'golf:par', 'golf:course', 'leisure', 'landuse',
           'natural', 'building', 'building:levels', 'height', 'highway',
           'waterway', 'water', 'wetland', 'amenity', 'surface', 'width',
           'bridge', 'tunnel', 'covered', 'layer', 'ref', 'par', 'barrier'}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def main():
    raw = SOURCE.read_bytes()
    source_sha = hashlib.sha256(raw).hexdigest()
    root = ET.fromstring(raw)
    transform = Transformer.from_crs(4326, 3006, always_xy=True)
    nodes = {n.attrib['id']: transform.transform(float(n.attrib['lon']), float(n.attrib['lat']))
             for n in root.findall('node')}
    ways = {w.attrib['id']: w for w in root.findall('way')}
    features, skipped = [], []

    def tags(element):
        return {t.attrib['k']: t.attrib['v'] for t in element.findall('tag') if t.attrib['k'] in ALLOWED}

    def points(way):
        ids = [n.attrib['ref'] for n in way.findall('nd')]
        if any(i not in nodes for i in ids):
            return None
        return [nodes[i] for i in ids]

    def add(element, geom, properties):
        if geom.is_empty or not geom.is_valid:
            raise ValueError(f"Invalid source geometry: {element.tag}/{element.attrib['id']}")
        features.append({'type': 'Feature', 'id': f"{element.tag}/{element.attrib['id']}",
                         'properties': {'sourceId': SOURCE_ID, 'sourceSha256': source_sha,
                                        'sourceTimestamp': element.get('timestamp'),
                                        'status': 'supplementary-map-reference-not-surveyed', 'tags': properties},
                         'geometry': mapping(geom)})

    for way in ways.values():
        properties = tags(way)
        if not properties:
            continue
        coords = points(way)
        if not coords or len(coords) < 2:
            skipped.append(f"way/{way.attrib['id']}:incomplete-nodes")
            continue
        area = coords[0] == coords[-1] and len(coords) >= 4 and any(k in properties for k in
                ('building', 'landuse', 'natural', 'leisure', 'golf', 'amenity', 'water'))
        geom = Polygon(coords) if area else LineString(coords)
        if not geom.is_valid:
            skipped.append(f"way/{way.attrib['id']}:invalid-source-geometry")
            continue
        add(way, geom, properties)

    for relation in root.findall('relation'):
        properties = tags(relation)
        if not properties:
            continue
        by_role = {'outer': [], 'inner': []}
        complete = True
        for member in relation.findall('member'):
            if member.attrib['type'] != 'way':
                continue
            way = ways.get(member.attrib['ref'])
            coords = points(way) if way is not None else None
            if not coords:
                complete = False
                break
            role = member.attrib.get('role') or 'outer'
            if role in by_role:
                by_role[role].append(LineString(coords))
        if not complete:
            skipped.append(f"relation/{relation.attrib['id']}:incomplete-members")
            continue
        outer = unary_union(list(polygonize(by_role['outer'])))
        inner = unary_union(list(polygonize(by_role['inner'])))
        geometry = outer.difference(inner)
        if geometry.is_empty or not geometry.is_valid:
            skipped.append(f"relation/{relation.attrib['id']}:unclosed-or-invalid-source-rings")
            continue
        add(relation, geometry, properties)

    collection = {'type': 'FeatureCollection', 'name': 'Tortuna supplementary map context',
                  'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
                  'axisOrder': ['easting', 'northing'], 'features': features}
    write(OUTPUT, collection)
    report = {'schemaVersion': 1, 'groundId': 'tortuna', 'sourceId': SOURCE_ID,
              'sourceUrl': URL, 'acquiredAt': datetime.fromtimestamp(SOURCE.stat().st_mtime, timezone.utc).isoformat(),
              'sourceBytes': len(raw), 'sourceSha256': source_sha,
              'sourceCrs': 'OGC:CRS84', 'horizontalCrs': 'EPSG:3006',
              'transform': {'engine': 'pyproj/PROJ', 'projVersion': __proj_version__, 'alwaysXY': True},
              'outputPath': OUTPUT.relative_to(ROOT).as_posix(),
              'outputSha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
              'featureCounts': dict(Counter(f['geometry']['type'] for f in features)),
              'skipped': skipped, 'licence': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
              'limitations': ['No golf hole, green, tee, fairway or bunker outlines are present in this extract.',
                              'Database edit dates are not capture dates or current-condition verification.',
                              'Open paths remain lines; tagged/default widths and building heights need separate review.']}
    write(ROOT / 'geo_data/course-v2/tortuna/acquisition/osm-context.json', report)
    print(json.dumps({'features': len(features), 'counts': report['featureCounts'], 'skipped': len(skipped)}))


if __name__ == '__main__':
    main()
