"""Append the reviewed B08 roof domains with explicitly estimated heights.

Run after compile-roof-measurements.py and close-clubhouse-roof.py, before
derive-roof-facets.py. This overwrites roof-measurements.json only when executed.
The native outline is observed; the vertical parameters below are assumptions.
"""
from pathlib import Path
import json
import math

import numpy as np
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def compile_range(observation, inventory, terrain_datum):
    building = next(b for b in inventory["buildings"] if b["id"] == "B08")
    components = []
    assumed_offsets = {
        "B08-main-monopitch": [4.2, 4.2, 3.2, 3.2],
        "B08-north-rear-extension": [4.45, 4.45, 4.2, 4.2],
    }
    for observed in observation["roofComponents"]:
        ring = np.asarray(observed["domainRoofRingLocalXZ"], dtype=float)
        assert ring.shape == (4, 2) and np.isfinite(ring).all()
        assert Polygon(ring).is_valid
        origin = ring.mean(axis=0)
        heights = terrain_datum + np.asarray(assumed_offsets[observed["id"]])
        design = np.column_stack((ring[:, 0] - origin[0],
                                  -ring[:, 1] + origin[1], np.ones(4)))
        coeff = np.linalg.lstsq(design, heights, rcond=None)[0]
        plane = dict(
            id=observed["id"] + "-estimated-plane",
            originLocalXZ=origin.tolist(),
            equation="heightRH2000=a*(xCourse-originX)+b*(-zCourse+originZ)+c",
            a=float(coeff[0]), b=float(coeff[1]), c=float(coeff[2]),
            supportCount=0, sourceLasClass=None, verticalRmseMetres=None,
            pitchDegrees=math.degrees(math.atan(np.linalg.norm(coeff[:2]))),
            interpretation="Estimated shallow roof plane for modelling; heights and slope direction are not measured.",
            heightStatus="estimated", assumedTerrainDatumRH2000=terrain_datum,
            assumedRoofHeightsAboveTerrainMetres=(heights - terrain_datum).tolist(),
            verticalInterpretationUncertaintyMetres=1.0,
        )
        components.append(dict(
            id=observed["id"], domainRoofRingLocalXZ=ring.tolist(),
            domainRoofRingEPSG3006=observed["domainRoofRingEPSG3006"],
            roofPlanes=[plane],
            heightFunction="single estimated plane; does not establish a measured roof height",
            roofMaterial="dark-metal", heightStatus="estimated",
            domainInterpretation="Visible native roof outline, approximately0.7m boundary uncertainty; independent of estimated vertical form.",
            sourceNativePixelRing=observed["sourceNativePixelRing"],
            horizontalInterpretationUncertaintyMetres=0.7,
            verticalInterpretationUncertaintyMetres=1.0,
        ))
    return dict(
        id="B08", name="Driving-range roof shelter",
        sourceOutlineLocalXZ=building["localRing"],
        sourceOutlineEPSG3006=building["sourceRingsEPSG3006"],
        dimensionsMetres=building["orientedBoundingRectangleMetres"],
        roofComponents=components,
        heightStatus="estimated: no acquired laser coverage; source-supported roof outlines with assumed3.2m front/4.2m rear above DTM datum",
        terrainRH2000AtCentroid=terrain_datum,
        sourceObservation="upsalabuild/facilities/models-2026-09-10/range-roof-observation.json",
    )


def main():
    inventory = json.loads((ROOT / "upsalabuild/facilities/reference-2026-09-10/building-reference-inventory.json").read_text(encoding="utf-8"))
    observation = json.loads((HERE / "range-roof-observation.json").read_text(encoding="utf-8"))
    building = next(b for b in inventory["buildings"] if b["id"] == "B08")
    centroid = Polygon(building["sourceRingsEPSG3006"]).centroid
    terrain = np.memmap(ROOT / "upsalabuild/cache/terrain-block.f32", dtype="<f4", mode="r", shape=(4785, 3641))
    col, row = centroid.x - 638255.5, 6637977.5 - centroid.y
    x, y = int(np.floor(col)), int(np.floor(row))
    assert 0 <= x < terrain.shape[1] - 1 and 0 <= y < terrain.shape[0] - 1
    dx, dy = col - x, row - y
    datum = float((1-dx)*(1-dy)*terrain[y,x] + dx*(1-dy)*terrain[y,x+1]
                  + (1-dx)*dy*terrain[y+1,x] + dx*dy*terrain[y+1,x+1])
    measurements_path = HERE / "roof-measurements.json"
    measurements = json.loads(measurements_path.read_text(encoding="utf-8"))
    assert measurements["frame"] == observation["frame"] == inventory["frame"]
    measurements["auxiliaryBuildings"] = [b for b in measurements["auxiliaryBuildings"] if b["id"] != "B08"]
    measurements["auxiliaryBuildings"].append(compile_range(observation, inventory, datum))
    measurements_path.write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"building": "B08", "components": 2, "terrainDatumRH2000": datum, "heightStatus": "estimated"}))


if __name__ == "__main__":
    main()
