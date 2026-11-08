"""Draw a training crop with its reference boxes (red) and detected boxes (yellow, score >= --score) for a visual check. Cache only."""
import json, sys, argparse
import numpy as np
from PIL import Image, ImageDraw
ap = argparse.ArgumentParser(); ap.add_argument("--raster"); ap.add_argument("--train"); ap.add_argument("--window"); ap.add_argument("--crowns"); ap.add_argument("--score", type=float, default=0.2); ap.add_argument("--out"); ap.add_argument("--scale", type=int, default=3)
a = ap.parse_args()
meta = json.load(open(a.raster)); data = np.memmap(a.raster[:-5] + ".rgb", dtype=np.uint8, mode="r", shape=(meta["height"], meta["width"], 3))
crop = [c for c in json.load(open(a.train))["crops"] if c["window"] == a.window][0]
p = meta["pixelMetres"]; bb = crop["bbox"]
c0 = int((bb[0] - meta["minEasting"]) / p); r0 = int((meta["maxNorthing"] - bb[3]) / p); c1 = int((bb[2] - meta["minEasting"]) / p); r1 = int((meta["maxNorthing"] - bb[1]) / p)
E0 = meta["minEasting"] + c0 * p; N0 = meta["maxNorthing"] - r0 * p
img = Image.fromarray(np.asarray(data[r0:r1, c0:c1])).resize(((c1 - c0) * a.scale, (r1 - r0) * a.scale))
d = ImageDraw.Draw(img); s = a.scale / p
for b in crop["boxes"]:
    d.rectangle([(b["xmin"] - E0) * s, (N0 - b["ymax"]) * s, (b["xmax"] - E0) * s, (N0 - b["ymin"]) * s], outline=(255, 40, 40), width=2)
if a.crowns:
    for reg in json.load(open(a.crowns))["regions"]:
        for x0, y0, x1, y1, sc in reg["crowns"]:
            if sc < a.score: continue
            d.rectangle([(x0 - E0) * s, (N0 - y1) * s, (x1 - E0) * s, (N0 - y0) * s], outline=(255, 230, 0), width=1)
img.save(a.out)
print(a.out, img.size)
