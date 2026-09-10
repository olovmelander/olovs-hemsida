"""Independent GEOS checks for the dated tee additions, including water islands.

Run with a Python environment containing Shapely, after adopting the reviews.
Source imagery is not required. --write saves the machine-readable evidence.
"""
import hashlib
import json
import sys
from pathlib import Path

import shapely
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]


def read(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def xy(value):
    if isinstance(value[0], (int, float)):
        return value[:2]
    return [xy(child) for child in value]


paths = [f"visbybuild/mapping/lm-tee-review-{nine}-2026-09-09.json" for nine in ("front9", "back9")]
front, back = map(read, paths)
geometry_path = "visbybuild/mapping/geometry.json"
geometry = read(geometry_path)
water_path = "geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson"
water = unary_union([shape({**f["geometry"], "coordinates": xy(f["geometry"]["coordinates"])})
                     for f in read(water_path)["features"]])
greens = unary_union([Polygon(h["green"]["ring"]) for h in geometry["holes"]])
bunkers = unary_union([Polygon(b["ring"]) for h in geometry["holes"] for b in h["bunkers"]])
candidates = [(h["n"], p["id"], p["ringProjected"]) for h in front["holes"] for p in h["additionalPads"]]
candidates += [(h["hole"], p["id"], p["ringEpsg3006"]) for h in back["holes"] for p in h["proposedPads"]]
results = []
for number, identity, ring in candidates:
    polygon = Polygon(ring)
    adopted = geometry["holes"][number - 1]["tees"]["pads"]
    matches = [p for p in adopted if Polygon(p["ring"]).hausdorff_distance(polygon) < 0.000001]
    overlaps = {name: round(polygon.intersection(layer).area, 6)
                for name, layer in (("water", water), ("greens", greens), ("bunkers", bunkers))}
    passed = polygon.is_valid and polygon.area > 1 and len(matches) == 1 and max(overlaps.values()) < 0.01
    results.append({"hole": number, "id": identity, "valid": polygon.is_valid,
                    "areaSquareMetres": round(polygon.area, 6), "adoptedMatches": len(matches),
                    "overlapSquareMetres": overlaps, "passed": passed})
report = {"schemaVersion": 1, "groundId": "visby", "reviewedAt": "2026-09-09",
          "method": "Independent GEOS polygon validity, accepted-ring matching and full polygon intersection; source water interior rings retained.",
          "shapelyVersion": shapely.__version__, "geosVersion": shapely.geos_version_string,
          "inputs": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths + [geometry_path, water_path]},
          "passed": all(p["passed"] for p in results), "polygons": results,
          "limitation": "Geometry consistency and feature separation do not establish surveyed horizontal accuracy."}
if "--write" in sys.argv:
    (ROOT / "visbybuild/mapping/tee-polygon-validation-2026-09-09.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
sys.exit(0 if report["passed"] else 1)
