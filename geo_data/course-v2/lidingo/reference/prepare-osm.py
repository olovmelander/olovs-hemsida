"""Convert the retained dated OSM extract to bounded reference GeoJSON.

This is supplemental ODbL evidence, not adopted/surveyed geometry.
"""
import collections
import copy
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "osm-map-2026-09-07.xml"
root = ET.parse(SOURCE).getroot()
nodes = {node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])] for node in root.findall("node")}
features = []
incomplete = []
for way in root.findall("way"):
    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
    refs = [nd.attrib["ref"] for nd in way.findall("nd")]
    if any(ref not in nodes for ref in refs):
        incomplete.append(way.attrib["id"])
        continue
    coordinates = [nodes[ref] for ref in refs]
    area_tags = tags.get("area") == "yes" or tags.get("building", "no") != "no" or bool(tags.get("landuse")) or bool(tags.get("leisure")) or tags.get("golf") in {"green", "tee", "fairway", "bunker", "driving_range"} or tags.get("natural") in {"water", "wood", "scrub", "wetland", "bare_rock", "grassland", "beach", "heath", "fell"}
    polygon = len(refs) >= 4 and refs[0] == refs[-1] and tags.get("area") != "no" and area_tags
    properties = {"osmType": "way", "osmId": way.attrib["id"], "osmVersion": way.attrib.get("version"), "osmTimestamp": way.attrib.get("timestamp"), "sourceId": "lidingo-osm-2026-09-07", "reviewStatus": "unreviewed-supplementary", "tags": tags}
    features.append({"type": "Feature", "id": "way/" + way.attrib["id"], "properties": properties, "geometry": {"type": "Polygon" if polygon else "LineString", "coordinates": [coordinates] if polygon else coordinates}})
golf = [feature for feature in features if feature["properties"]["tags"].get("golf") or feature["properties"]["tags"].get("leisure") == "golf_course"]
routes = sorted([feature for feature in golf if feature["properties"]["tags"].get("golf") == "hole"], key=lambda f: int(f["properties"]["tags"].get("ref", 999)))
def write_geojson(name, values):
    (HERE / name).write_text(json.dumps({"type": "FeatureCollection", "name": "Lidingö GK supplementary OSM evidence, 2026-09-07", "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors", "features": values}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
write_geojson("osm-golf-reference.geojson", golf)
write_geojson("osm-routing-reference.geojson", routes)
write_geojson("osm-context-reference.geojson", [f for f in features if f not in golf])
boundary = copy.deepcopy([f for f in features if f["properties"]["osmId"] in ["4874892", "4874914"]])
for feature in boundary:
    feature["properties"]["boundaryRelation"] = "3942404"
    if feature["geometry"]["type"] == "LineString":
        ring = feature["geometry"]["coordinates"]
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("The retained course-boundary outer members must be closed")
        feature["geometry"] = {"type": "Polygon", "coordinates": [ring]}
write_geojson("osm-course-boundary.geojson", boundary)
transformer = Transformer.from_crs(4326, 3006, always_xy=True)
def project_coordinates(coordinates):
    if isinstance(coordinates[0], (int, float)):
        return list(transformer.transform(*coordinates))
    return [project_coordinates(child) for child in coordinates]
for stem in ["golf", "context"]:
    source_geojson = json.loads((HERE / f"osm-{stem}-reference.geojson").read_text(encoding="utf-8"))
    projected = copy.deepcopy(source_geojson)
    for feature in projected["features"]:
        feature["geometry"]["coordinates"] = project_coordinates(feature["geometry"]["coordinates"])
    projected["crs"] = {"type": "name", "properties": {"name": "EPSG:3006"}}
    (HERE / f"osm-{stem}-epsg3006.geojson").write_text(json.dumps(projected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
points = [point for feature in golf for point in (feature["geometry"]["coordinates"][0] if feature["geometry"]["type"] == "Polygon" else feature["geometry"]["coordinates"])]
bbox = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
report = {"sourceUrl": "https://api.openstreetmap.org/api/0.6/map?bbox=18.115,59.370,18.145,59.385", "acquiredOn": "2026-09-07", "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "bboxWgs84": bbox, "completeWayCount": len(features), "golfFeatureCounts": dict(collections.Counter(f["properties"]["tags"].get("golf", "course") for f in golf)), "routeHoleRefs": [f["properties"]["tags"].get("ref") for f in routes], "routeParTotal": sum(int(f["properties"]["tags"].get("par", 0)) for f in routes), "incompleteWaysOmitted": incomplete, "relations": [{"id": r.attrib["id"], "tags": {t.attrib["k"]: t.attrib["v"] for t in r.findall("tag")}, "members": [m.attrib for m in r.findall("member")]} for r in root.findall("relation") if any(t.attrib.get("v") == "golf_course" for t in r.findall("tag"))], "limitations": ["Golf surfaces include old Bing/Mapbox-derived OSM geometry and need review against current licensed imagery.", "Route and surface OSM edit timestamps are not observation or survey dates.", "The full extract includes neighbouring property; it is retained as acquisition evidence, never a claim of golf-property ownership."]}
(HERE / "osm-inventory.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
