"""Repair area semantics and retain omitted golf paths from exact OSM snapshots.

Original reference files remain untouched. No vertices are moved or generated.
Only the two explicitly reviewed club parking identities are superseded by the
2019 facility inventory; their unmatched area is reported, never cut into slivers.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json
import math
import shapely
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lidingobuild/mapping"
CONTEXT = ROOT / "geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson"
GOLF = ROOT / "geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson"
FACILITIES = OUT / "facilities.geojson"
SUPERSEDED_CLUB_PARKING = {
    "way/32428960": ["lidingo-upper-parking-north-2019", "lidingo-upper-parking-south-2019"],
    "way/221846968": ["lidingo-clubhouse-parking-2019"],
}


def read_projected(path):
    data = json.loads(path.read_text(encoding="utf8"))
    assert data["type"] == "FeatureCollection"
    assert data["crs"]["properties"]["name"] == "EPSG:3006", path
    return data


def finite_points(points, identity):
    assert all(len(point) == 2 and all(math.isfinite(value) for value in point) for point in points), identity


def parking_geometry(feature):
    """OSM parking is an area unless explicitly area=no; require closed geometry."""
    tags = feature["properties"]["tags"]
    if tags.get("area") == "no":
        return None
    geometry = feature["geometry"]
    if geometry["type"] == "Polygon":
        result = deepcopy(geometry)
    elif geometry["type"] == "LineString":
        ring = geometry["coordinates"]
        if len(ring) < 4 or ring[0] != ring[-1]:
            return None
        result = {"type": "Polygon", "coordinates": [deepcopy(ring)]}
    else:
        raise ValueError(f"Unexpected parking geometry: {feature['id']}")
    for ring in result["coordinates"]:
        finite_points(ring, feature["id"])
    polygon = shape(result)
    assert polygon.is_valid and not polygon.is_empty and polygon.area > 0, feature["id"]
    return result


def main():
    context, golf, facilities = [read_projected(path) for path in [CONTEXT, GOLF, FACILITIES]]
    by_facility = {feature["id"]: feature for feature in facilities["features"]}
    for feature in facilities["features"]:
        assert shape(feature["geometry"]).is_valid, feature["id"]
    adopted, retired, omitted, overlaps = [], [], [], []
    normalized_parking = []
    for source in context["features"]:
        if source["properties"]["tags"].get("amenity") != "parking":
            continue
        geometry = parking_geometry(source)
        if geometry is None:
            omitted.append({"id": source["id"], "reason": "explicit-area-no-or-nonclosed-way", "sourceGeometryType": source["geometry"]["type"]})
            continue
        polygon = shape(geometry)
        matches = []
        for facility in facilities["features"]:
            intersection = polygon.intersection(shape(facility["geometry"])).area
            if intersection > 0.01:
                matches.append({"facilityId": facility["id"], "facilityKind": facility["properties"]["kind"],
                    "intersectionSquareMetres": round(intersection, 3), "fractionOfSourceParking": round(intersection / polygon.area, 6)})
        if matches:
            overlaps.append({"sourceId": source["id"], "sourceAreaSquareMetres": round(polygon.area, 3), "facilities": matches})
        normalized_parking.append(source["id"])
        if source["id"] in SUPERSEDED_CLUB_PARKING:
            replacements = SUPERSEDED_CLUB_PARKING[source["id"]]
            assert all(identity in by_facility and by_facility[identity]["properties"]["kind"] == "parking" for identity in replacements)
            shapes = [shape(by_facility[identity]["geometry"]) for identity in replacements]
            assert all(polygon.intersection(candidate).area > 0.01 for candidate in shapes), source["id"]
            replacement = unary_union(shapes)
            retired.append({"sourceFeatureId": source["id"], "replacedBy": replacements,
                "sourceAreaSquareMetres": round(polygon.area, 3),
                "overlapSquareMetres": round(polygon.intersection(replacement).area, 3),
                "sourceAreaOutsideObservedReplacementSquareMetres": round(polygon.difference(replacement).area, 3),
                "decision": "omit-entire-coarse-club-parking-source-from-rendered-inventory",
                "reason": "Explicitly reviewed same club facility. Retain observed 2019 footprint; do not turn uncertain coarse-source remainder into rendered slivers. The unmatched remainder is unresolved, not asserted absent.",
                "originalRetainedAt": CONTEXT.relative_to(ROOT).as_posix()})
            continue
        feature = deepcopy(source)
        feature["geometry"] = geometry
        feature["properties"].update({"kind": "parking", "sourceFeatureId": source["id"],
            "sourceGeometryType": source["geometry"]["type"], "sourceCollection": CONTEXT.relative_to(ROOT).as_posix(),
            "geometryNormalization": "closed-amenity-parking-way-to-area; area=no-excluded", "coordinateValuesChanged": False,
            "notSurveyed": True, "reviewStatus": "source-semantics-normalized-not-surveyed", "licence": "ODbL-1.0"})
        adopted.append(feature)
    assert set(entry["sourceFeatureId"] for entry in retired) == set(SUPERSEDED_CLUB_PARKING)

    golf_paths = []
    for source in golf["features"]:
        if source["properties"]["tags"].get("golf") != "path":
            continue
        assert source["geometry"]["type"] == "LineString", source["id"]
        coordinates = source["geometry"]["coordinates"]
        finite_points(coordinates, source["id"])
        assert len(coordinates) >= 2 and shape(source["geometry"]).length > 0, source["id"]
        feature = deepcopy(source)
        feature["properties"].update({"kind": "path", "sourceFeatureId": source["id"],
            "sourceGeometryType": "LineString", "sourceCollection": GOLF.relative_to(ROOT).as_posix(),
            "geometryNormalization": "unchanged-golf-path-line", "coordinateValuesChanged": False,
            "notSurveyed": True, "reviewStatus": "source-semantics-normalized-not-surveyed", "licence": "ODbL-1.0"})
        assert feature["geometry"] == source["geometry"]
        adopted.append(feature)
        golf_paths.append(source["id"])
    assert len(normalized_parking) == 28 and len(golf_paths) == 6, "Pinned snapshot infrastructure count changed"
    assert len(set(feature["id"] for feature in adopted)) == len(adopted)
    result = {"type": "FeatureCollection", "name": "Lidingö normalized supplementary infrastructure",
        "crs": {"type": "name", "properties": {"name": "EPSG:3006"}}, "axisOrder": ["easting", "northing"],
        "sourceId": "lidingo-osm-2026-09-07", "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
        "features": adopted}
    output = OUT / "infrastructure.geojson"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    report = {"schemaVersion": 1, "groundId": "lidingo", "status": "provisional-source-semantics-repaired",
        "inputs": [{"path": path.relative_to(ROOT).as_posix(), "sha256": sha256(path.read_bytes()).hexdigest()} for path in [CONTEXT, GOLF, FACILITIES]],
        "output": {"path": output.relative_to(ROOT).as_posix(), "sha256": sha256(output.read_bytes()).hexdigest()},
        "toolchain": {"shapely": shapely.__version__, "geos": shapely.geos_version_string},
        "counts": {"sourceParkingAreas": len(normalized_parking), "adoptedParkingAreas": len(normalized_parking) - len(retired),
            "retiredClubParkingAreas": len(retired), "unchangedGolfPaths": len(golf_paths), "outputFeatures": len(adopted)},
        "geometryChecks": {"allOutputGeometryValid": all(shape(f["geometry"]).is_valid for f in adopted),
            "sourceVerticesChanged": 0, "verticesSynthesized": 0, "ringsClippedOrSimplified": 0},
        "parkingAreaSemantics": "https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking",
        "parkingFacilityOverlaps": overlaps, "retiredSourceFeatures": retired, "omittedNonAreas": omitted,
        "unchangedGolfPathIds": golf_paths,
        "existingBuildingAreaCheck": {"sourceBuildingFeatures": sum(bool(f["properties"]["tags"].get("building")) for f in context["features"]),
            "allBuildingsAlreadyPolygon": all(f["geometry"]["type"] == "Polygon" for f in context["features"] if f["properties"]["tags"].get("building"))},
        "limitations": ["Area semantics do not improve the original OSM position accuracy or observation epoch.",
            "Neighbouring parking areas are geographic context, not asserted golf-club property or visitor access.",
            "No parked cars, bay centres, path widths or bridge positions are synthesized.",
            "The two superseded club lots retain unresolved source remainder areas; review current licensed imagery before extending the 2019 traces."]}
    (OUT / "infrastructure-review.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
    print(json.dumps(report["counts"]))


if __name__ == "__main__":
    main()
