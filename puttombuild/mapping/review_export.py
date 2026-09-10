"""Export native Puttom orthophoto pixels and reproducible geometry overlays.

Run with puttombuild/cache/ortho-venv/Scripts/python.exe. Raw pixels, overlay
PNGs and contact sheets stay in the ignored cache; review-index.json records
source hashes and pixel-edge affine transforms. No image registration is fitted.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer
import rasterio
from rasterio.merge import merge
from rasterio.transform import array_bounds


ROOT = Path(__file__).resolve().parents[2]
COLOURS = {"green": "#ff3948", "bunker": "#ffad32", "tee": "#32e8ff",
           "fairway": "#e5ffdd", "water": "#689aff", "building": "#f0b4ff"}


def sha256(file):
    digest = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def relative(file):
    try:
        return Path(file).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(Path(file).resolve())


def font(size):
    for candidate in ("C:/Windows/Fonts/consola.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def feature_inventory(model):
    if (len(model["holes"]) != 18 or model["origin"] != {"lat": 63.2992, "lon": 18.9413}
            or model["mPerLat"] != 111320 or not 50000 < model["mPerLon"] < 50030):
        raise ValueError("Expected Puttom's frozen legacy geographic frame")
    projection = Transformer.from_crs(4326, 3006, always_xy=True)

    def project(point):
        x, z = point
        return projection.transform(model["origin"]["lon"] + x / model["mPerLon"],
                                    model["origin"]["lat"] - z / model["mPerLat"])

    rings, routes, marks = [], [], []

    def add(kind, points, hole=None):
        if points:
            ring = [project(point) for point in points]
            rings.append({"kind": kind, "hole": hole, "ring": ring,
                          "bounds": point_bounds(ring)})

    for hole in model["holes"]:
        n = hole["n"]
        add("green", hole["green"]["ring"], n)
        for ring in hole["fairway"]["rings"]:
            add("fairway", ring, n)
        for pad in hole["tees"]["pads"]:
            add("tee", pad["ring"], n)
        for bunker in hole["bunkers"]:
            add("bunker", bunker["ring"], n)
        routes.append({"hole": n, "line": [project(p) for p in hole["line"]]})
        marks.append({"hole": n, "kind": "green", "label": f"G{n}",
                      "point": project(hole["green"]["c"])})
        for index, mark in enumerate(hole["tees"]["marks"]):
            identity = ["61", "57", "48", "41"][index]
            marks.append({"hole": n, "kind": "tee", "label": f"{n}:{identity}",
                          "point": project(mark["c"])})
    for water in model.get("water", []):
        add("water", water["ring"])
    for building in model.get("infra", {}).get("buildings", []):
        add("building", building["ring"])
    for key, kind in (("greens", "green"), ("bunkers", "bunker"),
                      ("tees", "tee"), ("range", "fairway")):
        for ring in model.get("scenery", {}).get(key, []):
            add(kind, ring)
    return rings, routes, marks


def point_bounds(points):
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


def intersects(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def overlay(raw, transform, inventory):
    image = raw.copy()
    draw = ImageDraw.Draw(image)
    rings, routes, marks = inventory
    width, height = image.size
    bounds = array_bounds(height, width, transform)
    inverse = ~transform
    pixel = lambda point: inverse * point
    for route in routes:
        if intersects(bounds, point_bounds(route["line"])):
            draw.line([pixel(p) for p in route["line"]], fill="#e6e6e6", width=1)
    for ring in sorted(rings, key=lambda r: r["kind"] != "fairway"):
        if intersects(bounds, ring["bounds"]):
            points = [pixel(p) for p in ring["ring"]]
            draw.line(points + [points[0]], fill=COLOURS[ring["kind"]], width=3, joint="curve")
    used_labels = {}
    for mark in marks:
        x, y = pixel(mark["point"])
        if not (0 <= x < width and 0 <= y < height):
            continue
        colour = COLOURS[mark["kind"]]
        draw.line([(x - 7, y), (x + 7, y)], fill=colour, width=2)
        draw.line([(x, y - 7), (x, y + 7)], fill=colour, width=2)
        # Coincident forward tees retain distinct readable identity labels.
        key = (round(x / 12), round(y / 12))
        slot = used_labels.get(key, 0)
        used_labels[key] = slot + 1
        draw.text((x + 9, y + 8 + 24 * slot), mark["label"], fill=colour,
                  font=font(20), stroke_width=2, stroke_fill="black")
    return image


def export_image(identifier, pixels, transform, sources, out, inventory, detail=None):
    if pixels.shape[0] != 3 or pixels.dtype != np.uint8:
        raise ValueError("Review PNGs require unchanged uint8 RGB bands 1,2,3")
    raw = Image.fromarray(np.moveaxis(pixels, 0, 2))
    raw_path = out / f"{identifier}.png"
    overlay_path = out / f"{identifier}-overlay.png"
    raw.save(raw_path)
    overlay(raw, transform, inventory).save(overlay_path)
    bounds = list(array_bounds(raw.height, raw.width, transform))
    # The affine maps pixel EDGES. Integer-indexed pixel centres use u+.5,v+.5.
    return {"id": identifier, **(detail or {}), "imageSize": list(raw.size),
            "extentEpsg3006": bounds, "geoTransform": list(transform.to_gdal()),
            "pixelToEpsg3006": list(transform)[:6],
            "pixelConvention": "pixel edges; centre of raster sample [column,row] is [column+0.5,row+0.5]",
            "resampling": "none; source RGB samples retained at native resolution",
            "sources": sources,
            "raw": {"path": relative(raw_path), "sha256": sha256(raw_path)},
            "overlay": {"path": relative(overlay_path), "sha256": sha256(overlay_path)}}


def contact_sheet(records, kind, mode, out, columns=6, cell=384):
    selected = sorted((r for r in records if r.get("view") == kind and r.get("hole")),
                      key=lambda r: r["hole"])
    if not selected:
        return None
    gap, title_height = 8, 30
    rows = math.ceil(len(selected) / columns)
    sheet = Image.new("RGB", (columns * (cell + gap) + gap,
                              rows * (cell + title_height + gap) + gap), "#171b20")
    draw, panels = ImageDraw.Draw(sheet), []
    for index, record in enumerate(selected):
        col, row = index % columns, index // columns
        left, top = gap + col * (cell + gap), gap + row * (cell + title_height + gap)
        draw.text((left, top + 3), f"Hole {record['hole']:02d} / {kind}",
                  fill="white", font=font(20))
        with Image.open(ROOT / record[mode]["path"]) as image:
            source_width, source_height = image.size
            image.thumbnail((cell, cell), Image.Resampling.LANCZOS)
            image_left = left + (cell - image.width) // 2
            image_top = top + title_height + (cell - image.height) // 2
            sheet.paste(image, (image_left, image_top))
            a, b, c, d, e, f = record["pixelToEpsg3006"]
            sx, sy = source_width / image.width, source_height / image.height
            panels.append({"sourceReviewId": record["id"], "hole": record["hole"],
                           "imageRectangle": [image_left, image_top, image.width, image.height],
                           "panelPixelToEpsg3006": [a * sx, b * sy, c, d * sx, e * sy, f],
                           "resampling": "Lanczos thumbnail for overview only; trace native PNG"})
    file = out / f"all18-{kind}-{mode}.png"
    sheet.save(file)
    return {"path": relative(file), "sha256": sha256(file),
            "imageSize": list(sheet.size), "panels": panels}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "puttombuild/cache/lm-ortho")
    parser.add_argument("--out", type=Path, default=ROOT / "puttombuild/cache/lm-ortho-review")
    parser.add_argument("--model", type=Path, default=ROOT / "puttombuild/course-model.json")
    parser.add_argument("--plan", type=Path, default=ROOT / "puttombuild/mapping/lm-ortho-plan.json")
    parser.add_argument("--available", action="store_true", help="Export completed windows during acquisition")
    parser.add_argument("--skip-hole-crops", action="store_true", help="Do not merge full-hole crops from context")
    parser.add_argument("--crop-reference", type=Path,
                        help="Replay full-hole grids from a previous review-index.json for exact image comparison")
    options = parser.parse_args()
    model = json.loads(options.model.read_text(encoding="utf-8"))
    plan = json.loads(options.plan.read_text(encoding="utf-8"))
    if plan["groundId"] != "puttom" or plan["horizontalCrs"] != "EPSG:3006":
        raise ValueError("Expected Puttom EPSG:3006 acquisition plan")
    out = options.out.resolve()
    if not out.is_relative_to(ROOT / "puttombuild/cache"):
        raise ValueError("Private review image outputs must remain under puttombuild/cache")
    out.mkdir(parents=True, exist_ok=True)
    inventory = feature_inventory(model)
    reference_crops = {}
    if options.crop_reference:
        reference = json.loads(options.crop_reference.read_text(encoding="utf-8"))
        if reference.get("groundId") != "puttom" or reference.get("horizontalCrs") != "EPSG:3006":
            raise ValueError("Expected a Puttom EPSG:3006 crop reference")
        reference_crops = {record["hole"]: record for record in reference["images"]
                           if record.get("view") == "full"}
        if set(reference_crops) != {hole["n"] for hole in model["holes"]}:
            raise ValueError("Crop reference must contain every full hole")
    records, context_datasets, missing = [], [], []
    with contextlib.ExitStack() as stack:
        for window in plan["windows"]:
            identifier = window["id"]
            file = options.source_dir / f"{identifier}.tif"
            sidecar_file = file.with_suffix(".json")
            if not file.exists() or not sidecar_file.exists():
                missing.append(identifier)
                if options.available:
                    continue
                raise FileNotFoundError(f"Acquisition window is incomplete: {identifier}")
            sidecar = json.loads(sidecar_file.read_text(encoding="utf-8"))
            actual_hash = sha256(file)
            if actual_hash != sidecar["sha256"]:
                raise ValueError(f"Source TIFF checksum mismatch: {identifier}")
            source = {"windowId": identifier, "path": relative(file), "sha256": actual_hash,
                      "sourceIds": window["sourceIds"], "geoTransform": sidecar["geoTransform"],
                      "capturedAt": sidecar.get("sources"), "acquiredAt": sidecar.get("acquiredAt")}
            dataset = stack.enter_context(rasterio.open(file))
            if (dataset.crs.to_epsg() != 3006 or dataset.count < 3 or
                    dataset.dtypes[:3] != ("uint8",) * 3 or
                    not np.allclose(dataset.transform.to_gdal(), sidecar["geoTransform"], rtol=0, atol=1e-8) or
                    not np.allclose(dataset.bounds, window["boundsEpsg3006"], rtol=0, atol=1e-6) or
                    not np.allclose(dataset.res, [plan["resolutionMetres"]] * 2, rtol=0, atol=1e-8) or
                    dataset.transform.b != 0 or dataset.transform.d != 0):
                raise ValueError(f"Source grid differs from acquired native grid: {identifier}")
            if dataset.width != window["width"] or dataset.height != window["height"]:
                raise ValueError(f"Source raster dimensions differ from plan: {identifier}")
            detail = {"hole": window.get("hole"),
                      "view": "green" if identifier.endswith("-green") else
                              "tees" if identifier.endswith("-tees") or identifier.startswith("tee-") else "context"}
            records.append(export_image(identifier, dataset.read([1, 2, 3]), dataset.transform,
                                        [source], out, inventory, detail))
            if identifier.startswith("context-"):
                context_datasets.append((dataset, source))
            print(json.dumps({"exported": identifier}), flush=True)
        if context_datasets and not options.skip_hole_crops:
            spacing = plan["resolutionMetres"]
            anchor = context_datasets[0][0].transform
            for hole in model["holes"]:
                n = hole["n"]
                points = [p for ring in inventory[0] if ring["hole"] == n for p in ring["ring"]]
                points += [m["point"] for m in inventory[2] if m["hole"] == n]
                bounds = point_bounds(points)
                snapped = [anchor.c + math.floor((bounds[0] - 30 - anchor.c) / spacing) * spacing,
                           anchor.f + math.floor((bounds[1] - 30 - anchor.f) / spacing) * spacing,
                           anchor.c + math.ceil((bounds[2] + 30 - anchor.c) / spacing) * spacing,
                           anchor.f + math.ceil((bounds[3] + 30 - anchor.f) / spacing) * spacing]
                if reference_crops:
                    snapped = reference_crops[n]["extentEpsg3006"]
                relevant = [(d, s) for d, s in context_datasets if intersects(d.bounds, snapped)]
                if not relevant:
                    continue
                pixels, transform = merge([d for d, _ in relevant], bounds=snapped,
                                          res=spacing, indexes=[1, 2, 3], masked=True)
                if reference_crops and (
                        list(pixels.shape[1:][::-1]) != reference_crops[n]["imageSize"] or
                        not np.allclose(transform.to_gdal(), reference_crops[n]["geoTransform"],
                                        rtol=0, atol=1e-8)):
                    raise ValueError(f"Full hole {n} grid differs from comparison reference")
                if np.ma.getmaskarray(pixels).any():
                    if options.available:
                        continue
                    raise ValueError(f"Full hole {n} crop has incomplete image coverage")
                records.append(export_image(f"hole-{n:02d}-full", np.asarray(pixels), transform,
                                            [s for _, s in relevant], out, inventory,
                                            {"hole": n, "view": "full"}))
                print(json.dumps({"exported": f"hole-{n:02d}-full"}), flush=True)
    sheets = [sheet for kind in ("green", "tees", "full") for mode in ("raw", "overlay")
              if (sheet := contact_sheet(records, kind, mode, out))]
    report = {"schemaVersion": 1, "groundId": "puttom", "kind": "native-orthophoto-geometry-review",
              "model": {"path": relative(options.model), "sha256": sha256(options.model)},
              "plan": {"path": relative(options.plan), "sha256": sha256(options.plan)},
              "horizontalCrs": "EPSG:3006", "nativeResolutionMetres": plan["resolutionMetres"],
              "projection": "pyproj EPSG:4326 to EPSG:3006 always_xy; exact model origin/mPerLat/mPerLon",
              "overlayLegend": COLOURS, "missingWindows": missing, "images": records, "sheets": sheets,
              "reviewStatus": "unreviewed source pixels plus existing model overlays; no alignment approval implied"}
    index_file = out / "review-index.json"
    index_file.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"index": relative(index_file), "images": len(records),
                      "sheets": len(sheets), "missingWindows": len(missing)}))


if __name__ == "__main__":
    main()
