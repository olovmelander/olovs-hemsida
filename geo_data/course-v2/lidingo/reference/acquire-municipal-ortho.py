"""Acquire a bounded Lidingö 2019 WMS reference in its advertised EPSG:3011.

Raw imagery stays in the ignored cache; requests and hashes remain reviewable.
Access is public; final product-specific redistribution review remains pending.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[4]
CACHE = ROOT / "lidingobuild/cache/municipal-ortho-2019"
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / "geo_data/course-v2/lidingo/discovery/municipal-ortho-2019.json"
project = Transformer.from_crs(3006, 3011, always_xy=True)
target = [677060, 6585730, 678250, 6587100]
bounds = project.transform_bounds(*target, densify_pts=21)
bounds = [math.floor(bounds[0]), math.floor(bounds[1]), math.ceil(bounds[2]), math.ceil(bounds[3])]
resolution = 0.5
width, height = round((bounds[2] - bounds[0]) / resolution), round((bounds[3] - bounds[1]) / resolution)
url = "https://karta.lidingo.se/wms?" + urlencode({"servicename": "wms_ortofoto_2019_oppendata", "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": "theme-ortofoto2019_i1", "STYLES": "", "SRS": "EPSG:3011", "BBOX": ",".join(map(str, bounds)), "WIDTH": width, "HEIGHT": height, "FORMAT": "image/png", "TRANSPARENT": "FALSE"})
with urlopen(url, timeout=60) as response:
    raw = response.read()
    content_type = response.headers.get("Content-Type")
image = Image.open(BytesIO(raw))
image.load()
if image.size != (width, height):
    raise ValueError("Unexpected WMS dimensions")
image_path = CACHE / "lidingo-2019-0p5m.png"
image_path.write_bytes(raw)
(CACHE / "lidingo-2019-0p5m.pgw").write_text(f"{resolution}\n0\n0\n{-resolution}\n{bounds[0]+resolution/2}\n{bounds[3]-resolution/2}\n", encoding="utf-8")
report = {"schemaVersion": 1, "groundId": "lidingo", "provider": "Lidingö stad", "sourceId": "lidingo-municipal-ortho-2019", "retrievedAt": datetime.now(timezone.utc).isoformat(), "url": url, "sourceService": "https://karta.lidingo.se/wms?servicename=wms_ortofoto_2019_oppendata", "layer": "theme-ortofoto2019_i1", "campaignLabel": "2019", "captureDate": None, "contentType": content_type, "horizontalCrs": "EPSG:3011", "bboxEpsg3011": bounds, "requestedCoverageEpsg3006": target, "width": width, "height": height, "sampleSpacingMetres": resolution, "productGsdMetres": None, "path": image_path.relative_to(ROOT).as_posix(), "worldfilePath": (CACHE / "lidingo-2019-0p5m.pgw").relative_to(ROOT).as_posix(), "bytes": len(raw), "sha256": sha256(raw).hexdigest(), "licence": {"state": "primary-terms-verification-pending", "candidate": "CC0 (municipal 2019 open-data service; independently listed by JOSM imagery index)", "secondaryCatalogueUrl": "https://josm.openstreetmap.de/wiki/Maps/Sweden", "note": "Public access and the oppendata service name do not by themselves settle redistribution rights. Retain as measurement/reference input in local cache."}, "limitations": ["2019 is the service/campaign label; exact capture date and source GSD have not been established.", "The requested 0.5 m pixel spacing is an output sampling choice and does not establish positional accuracy.", "Review against current club material and newer national orthophoto before adopting changed boundaries."]}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
