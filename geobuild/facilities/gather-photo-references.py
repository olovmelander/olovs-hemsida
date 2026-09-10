"""Fetch reviewed public photo references into the ignored local research cache.

No photos are licensed here for application distribution. WordPress upload dates
are recorded separately from camera dates. Run with the ortho-venv Python.
"""
from pathlib import Path
import concurrent.futures
import hashlib
import io
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "geobuild/cache/facilities-2026-09-10/photos"
MANIFEST = ROOT / "geobuild/facilities/photo-sources.json"
SELECTION = {
    "club": [2041, 2485, 172, 149, 155, 92, 2527],
    "hotel": [167, 797],
}
SITES = {"club": "https://veckefjarden.com", "hotel": "https://hotellveckefjarden.com"}
REVIEWS = {
    "club-2041": {
        "facilities": ["clubhouse", "entrance-porch", "clubhouse-side-annex", "practice-area"],
        "view": "Elevated view across uphill entrance facade toward course and bay; bearing not surveyed.",
        "observations": ["Two full window rows on uphill facade; pale-yellow vertical timber and white trim.", "Dark grey pitched roof, chimneys/vents, central round upper window, entrance porch and small side annex.", "Distant agricultural-style building is context only; its use is not established by this image."],
        "limits": "Oblique photo, no camera calibration; use native orthophoto for plan dimensions.",
    },
    "club-2485": {
        "facilities": ["clubhouse", "restaurant-terrace", "clubhouse-side-annex", "parking", "practice-green"],
        "view": "Course-facing elevation from downhill across practice grounds.",
        "observations": ["Two full upper window rows plus exposed lower basement level on downhill side.", "Long raised terrace with central external stair; gabled annex and smaller entry porch at left.", "Pale-yellow vertical boards, white pilasters and arched window surrounds, dark grey roof and green lower facade.", "Flagpoles, parking, low fence and approach paths visible."],
        "limits": "Facade details visible but no measured wall, eave or ridge heights.",
    },
    "club-172": {
        "facilities": ["restaurant-terrace"],
        "view": "Close view along furnished restaurant terrace beside clubhouse wall.",
        "observations": ["Timber deck, dark lightweight chairs/tables, glass or clear-panel wind enclosure and pale-yellow wall with white windows."],
        "limits": "Small cropped angle; does not establish full terrace perimeter or present enclosure configuration.",
    },
    "club-149": {
        "facilities": ["padel", "padel-adjacent-buildings", "flagpoles"],
        "view": "Outside long side of outdoor padel court looking across to two small buildings.",
        "observations": ["Blue playing surface, black mesh/glass enclosure, black posts and paired floodlights.", "Pale-yellow adjacent structures have dark roofs and white trim; building functions remain unverified."],
        "limits": "Do not infer that every adjacent building is a range shelter from this photo alone.",
    },
    "club-155": {
        "facilities": ["padel"],
        "view": "Close court-level oblique view, partially occluded by player.",
        "observations": ["Blue court material, black enclosure posts, glass/mesh panels and floodlight-head proportions."],
        "limits": "Player and crop obscure geometry; cannot supply court position, dimensions or complete elevation.",
    },
    "club-92": {
        "facilities": ["practice-area", "pond-fountain", "paths"],
        "view": "Across practice putting surface toward pond and fountain.",
        "observations": ["Practice flags, mown ground transitions, trees, paths, pond spray and shoreline context."],
        "limits": "Landscape reference only, not a surveyed fountain coordinate or current water-edge trace.",
    },
    "club-2527": {
        "facilities": ["pro-shop"],
        "view": "Interior of official club shop.",
        "observations": ["Shop fittings and equipment reference; official attachment is associated with club proshop page."],
        "limits": "Interior reference only; does not establish a separate building or exterior entrance position.",
    },
    "hotel-167": {
        "facilities": ["hotel", "pool", "hotel-deck", "gazebo", "clubhouse-gable"],
        "view": "Elevated oblique view across hotel courtyard toward clubhouse side and golf course.",
        "observations": ["Single-storey low-pitch hotel wings meet in an L around lawn and pool.", "Pale cladding, white windows, dark roof seams, chimneys/vents and green door.", "Pool has rounded access end, timber surround and retractable translucent arched cover.", "Deck has timber posts with rope rails, tables/chairs and white retractable awning.", "Polygonal gazebo roof partly visible in foreground; clubhouse gable balcony/fire escape visible behind."],
        "limits": "Historic configuration; present pool/deck/gazebo footprint must be checked against 2024 orthophoto. Roof material appearance is not a measured specification.",
    },
    "hotel-797": {
        "facilities": ["clubhouse", "restaurant-terrace", "hotel", "practice-area", "flagpoles"],
        "view": "Broad daytime course-facing clubhouse and adjacent low building context.",
        "observations": ["Corroborates clubhouse annex, terrace, central stair, flags and paths under different lighting from club-2485."],
        "limits": "Building details distant; use club-2485 for facade interpretation.",
    },
    "shop-training": {
        "facilities": ["range-flagpoles", "practice-area"],
        "view": "Low oblique training-area view from official golfshop page.",
        "observations": ["Row of sponsor flagpoles on sloping mown ground; local grass and flag proportions."],
        "limits": "Does not show covered range bays or establish exact flagpole positions.",
    },
    "hemnet-aerial": {
        "facilities": ["surrounding-buildings", "roads", "course-context"],
        "view": "Historical elevated estate-context photo looking toward bay over neighboring houses and course.",
        "observations": ["Course-adjacent houses, roads and an agricultural-style building cluster are visible for identity comparison."],
        "limits": "690px image from a neighboring land listing removed 2020-05-07; capture date unknown, not current metric evidence. Foreground houses must not be assigned a club function.",
    },
}
EXTERNAL = [
    ("shop-training", "https://xn--pqveckefjrden-jfb.se/cdn/shop/files/medlem.jpg?v=1748258837&width=1500", "https://xn--pqveckefjrden-jfb.se/"),
    ("hemnet-aerial", "https://bilder.hemnet.se/images/itemgallery_cut/76/a8/76a80d89c8788ca05daf33965b3fc47e.jpg", "https://www.hemnet.se/bostad/tomt-veckefjardens-golfbana-ornskoldsviks-kommun-veckehojden-3-10624858"),
]


def fetch(url):
    parts = urllib.parse.urlsplit(url)
    encoded = urllib.parse.urlunsplit((parts.scheme, parts.netloc,
        urllib.parse.quote(parts.path, safe="/%"), parts.query, parts.fragment))
    request = urllib.request.Request(encoded, headers={"User-Agent": "VeckefjardenFacilityReferenceResearch/1.0"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read()


def get_photo(job):
    site, media_id = job
    reference_id = f"{site}-{media_id}"
    api_url = f"{SITES[site]}/wp-json/wp/v2/media/{media_id}"
    metadata = json.loads(fetch(api_url))
    image_url = metadata["source_url"]
    data = fetch(image_url)
    suffix = Path(urllib.parse.urlsplit(image_url).path).suffix
    path = CACHE / (reference_id + suffix)
    path.write_bytes(data)
    metadata_path = CACHE / (reference_id + ".wordpress.json")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    image_details = inspect_image(data)
    return {
        "id": reference_id,
        "originalImageUrl": image_url,
        "pageUrl": metadata["link"],
        "metadataUrl": api_url,
        "retrievedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "localPath": path.relative_to(ROOT).as_posix(),
        "metadataPath": metadata_path.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(),
        **image_details,
        "wordpressUploadDate": metadata["date"],
        "wordpressImageMetadata": metadata.get("media_details", {}).get("image_meta", {}),
        "title": metadata["title"]["rendered"],
        "rights": "No reuse license found; reference only; do not ship image in application assets.",
        "visualReview": REVIEWS[reference_id],
    }


def inspect_image(data):
    with Image.open(io.BytesIO(data)) as image:
        exif = image.getexif()
        # DateTimeOriginal is usually nested in ExifIFD. Tag 306 is an image
        # modification timestamp and must never be substituted for capture.
        original = exif.get_ifd(34665).get(36867) or exif.get(36867)
        return {
            "dimensionsPx": list(image.size),
            "cameraDateFromExif": original,
            "cameraDateSource": "EXIF ExifIFD DateTimeOriginal (36867)" if original else None,
            "cameraDateStatus": "Camera clock; timezone and clock accuracy unverified" if original else "unknown",
            "imageModifiedDateFromExif": exif.get(306),
            "imageModifiedDateSource": "EXIF DateTime (306), not capture date" if exif.get(306) else None,
        }


def get_external(job):
    reference_id, image_url, page_url = job
    data = fetch(image_url)
    suffix = Path(urllib.parse.urlsplit(image_url).path).suffix
    path = CACHE / (reference_id + suffix)
    path.write_bytes(data)
    return {
        "id": reference_id, "originalImageUrl": image_url, "pageUrl": page_url,
        "retrievedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "localPath": path.relative_to(ROOT).as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(), **inspect_image(data),
        "rights": "No reuse license found; reference only; do not ship image in application assets.",
        "visualReview": REVIEWS[reference_id],
    }


def contact_sheet(photos):
    cols, width, height = 3, 540, 360
    sheet = Image.new("RGB", (cols * width, ((len(photos) + cols - 1) // cols) * height), "#15201c")
    draw = ImageDraw.Draw(sheet)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    font = ImageFont.truetype(str(font_path), 19) if font_path.exists() else ImageFont.load_default()
    for index, photo in enumerate(photos):
        x, y = index % cols * width, index // cols * height
        with Image.open(ROOT / photo["localPath"]) as source:
            thumb = ImageOps.contain(source.convert("RGB"), (width - 16, height - 48))
            sheet.paste(thumb, (x + (width - thumb.width) // 2, y + 4))
        draw.text((x + 8, y + height - 36), photo["id"] + "  " + str(photo["dimensionsPx"]), fill="white", font=font)
    target = CACHE.parent / "reference-contact-sheet.jpg"
    sheet.save(target, quality=93)
    return target.relative_to(ROOT).as_posix()


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    jobs = [(site, item) for site, items in SELECTION.items() for item in items]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        photos = list(pool.map(get_photo, jobs))
        photos += list(pool.map(get_external, EXTERNAL))
    manifest = {"schemaVersion": 1, "course": "veckefjarden", "purpose": "Exterior facility modeling references",
        "rightsPolicy": "Private modeling references; no image is approved for app distribution.",
        "reviewDate": "2026-09-10",
        "coverageLimits": ["No complete calibrated facade set was found. Rear/service doors, precise window spacing and hidden elevations remain incomplete.", "Covered range-bay dimensions, service-building functions and recent landscaping need better close photos or a site survey.", "Historic photos are appearance references; 2024 Lantmateriet orthophotos establish plan placement. Pixel size is not absolute survey accuracy.", "Search results included incorrectly attributed other-course/stock images; these were excluded. Booking returned a robot-check page; tourism image origins returned 404; neither supplied final imagery."],
        "facilityFacts": [
            {"claim": "The clubhouse occupies a former school; two preserved oaks stand between parking and course.", "sourceUrl": "https://veckefjarden.com/om-oss/"},
            {"claim": "Official hotel site states 22 rooms, 48 beds, adjacent seasonal outdoor pool and free parking.", "sourceUrl": "https://hotellveckefjarden.com/om-hotellet/"},
            {"claim": "Restaurant has terrace with course/bay views.", "sourceUrl": "https://veckefjarden.com/restaurang/"},
            {"claim": "Training facilities include driving range with some covered bays, putting green, two short-game areas and short course.", "sourceUrl": "https://veckefjarden.com/spela/"},
            {"claim": "Outdoor padel is part of the club facility.", "sourceUrl": "https://veckefjarden.com/padel/"},
            {"claim": "Tourism directions identify restaurant and golfshop in main building and hotel in smaller neighboring building; tourism room count of 16 is outdated against the official 22.", "sourceUrl": "https://www.hogakusten.com/sv/hotell-veckefjarden"},
        ],
        "contactSheet": contact_sheet(photos), "photos": photos}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"photos": len(photos), "manifest": MANIFEST.relative_to(ROOT).as_posix(), "contactSheet": manifest["contactSheet"]}))
