"""Verify retained club evidence and inspect image metadata without changing sources.

Requires Pillow. Usage from repo root:
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/reference/verify-club.py
Raw image crops/contact sheets remain in the ignored reference cache.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

reference = Path(__file__).resolve().parent
inventory = json.loads((reference / "club-source-assets.json").read_text(encoding="utf-8"))
observations = []
strips = []
for asset in inventory["assets"]:
    source = reference / asset["cachePath"]
    data = source.read_bytes()
    assert len(data) == asset["byteLength"], asset["id"]
    assert hashlib.sha256(data).hexdigest() == asset["sha256"], asset["id"]
    if not (asset.get("contentType") or "").startswith("image/"):
        continue
    with Image.open(source) as image:
        exif = image.getexif()
        exif_dates = {name: str(exif[tag]) for name, tag in [("DateTime", 306), ("DateTimeOriginal", 36867), ("DateTimeDigitized", 36868)] if tag in exif}
        observations.append({"assetId": asset["id"], "sourceSha256": asset["sha256"], "widthPixels": image.width, "heightPixels": image.height, "format": image.format, "exifDateFields": exif_dates, "georeferencing": "No georeferencing adopted; camera metadata and diagram orientation do not establish mapping controls."})
        if "_Lidingo_" in asset["id"]:
            hole = int(asset["id"].split("_Lidingo_")[1])
            strip = image.convert("RGB").crop((0, 0, image.width, 330))
            strip.thumbnail((690, 200))
            strips.append((hole, strip))
card = json.loads((reference / "club-scorecard.json").read_text(encoding="utf-8"))
assert len(card["holes"]) == 18
assert sorted(hole["index"] for hole in card["holes"]) == list(range(1, 19))
assert [sum(hole["par"] for hole in card["holes"][start:end]) for start, end in [(0, 9), (9, 18), (0, 18)]] == [33, 37, 70]
for tee in card["tees"]:
    for key, start, end in [("front", 0, 9), ("back", 9, 18), ("total", 0, 18)]:
        assert sum(hole["lengths"][tee["id"]] for hole in card["holes"][start:end]) == tee[key], (tee, key)
assert card["source"]["sha256"] == next(asset["sha256"] for asset in inventory["assets"] if asset["id"] == card["source"]["assetId"])
assert sorted(video["hole"] for video in inventory["flyovers"]) == list(range(1, 19))
assert sorted(hole for hole, _ in strips) == list(range(1, 19))
sheet = Image.new("RGB", (1380, 1800), "white")
for index, (hole, strip) in enumerate(sorted(strips)):
    sheet.paste(strip, ((index // 9) * 690, (index % 9) * 200))
sheet_path = reference / "cache" / "club-2026-09-07" / "banguide-card-review.png"
sheet.save(sheet_path)
report = {"schemaVersion": 1, "status": "passed", "sourceAssetCount": len(inventory["assets"]), "sourceBytes": sum(asset["byteLength"] for asset in inventory["assets"]), "imageCount": len(observations), "checks": ["Every retained source byte count and SHA-256", "18 holes and stroke-index permutation", "Every tee front/back/total distance", "Front/back/total par", "Official source-card checksum", "18 hole-labeled club flyover links", "18 hole guide headers"], "limitations": "Structural/checksum checks do not establish source accuracy, current on-ground geometry, permissions, or independent human review.", "images": observations}
(reference / "club-evidence-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: report[key] for key in ["status", "sourceAssetCount", "sourceBytes", "imageCount"]}))
print(f"Banguide header comparison: {sheet_path}")
