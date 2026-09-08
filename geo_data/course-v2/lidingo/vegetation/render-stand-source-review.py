"""Render dated orthophoto/stand source panels; no geometry or model adoption."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[4]
metadata = json.loads((ROOT / "geo_data/course-v2/lidingo/discovery/municipal-ortho-2019.json").read_text(encoding="utf-8"))
image = np.array(Image.open(ROOT / metadata["path"]))
points = np.array(json.loads((ROOT / "lidingobuild/cache/vegetation/review/stand-samples.json").read_text(encoding="utf-8")))
transform = Transformer.from_crs(3006, 3011, always_xy=True)
east, north = transform.transform(points[:, 0], points[:, 1])
bounds = metadata["bboxEpsg3011"]
scenes = [
    ("Clubhouse / range", [677530, 6586200, 677900, 6586570]),
    ("West housing / fairways", [677040, 6586080, 677420, 6586460]),
    ("East forest / road", [677750, 6586520, 678130, 6586900]),
]
figure, axes = plt.subplots(2, 3, figsize=(16, 10), layout="constrained")
for column, (title, bbox) in enumerate(scenes):
    view = transform.transform_bounds(*bbox, densify_pts=21)
    for row in range(2):
        axes[row, column].imshow(image, extent=[bounds[0], bounds[2], bounds[1], bounds[3]], origin="upper")
        axes[row, column].set_xlim(view[0], view[2])
        axes[row, column].set_ylim(view[1], view[3])
        axes[row, column].set_aspect("equal")
        axes[row, column].tick_params(labelsize=6)
    axes[0, column].set_title(title + " — municipal 2019", fontsize=11)
    selected = (east >= view[0]) & (east <= view[2]) & (north >= view[1]) & (north <= view[3])
    axes[1, column].scatter(east[selected], north[selected], s=2, c=points[selected, 3], cmap="autumn", vmin=2, vmax=30, alpha=0.8)
    axes[1, column].set_title("2021 laser: eligible 4 m stand-cell centres", fontsize=10)
figure.suptitle("Lidingö source comparison: different capture years; dots are field-cell centres, not observed stems", fontsize=13)
destination = ROOT / "lidingobuild/cache/vegetation/review/stand-source-panels.png"
figure.savefig(destination, dpi=140)
plt.close(figure)
print(destination)
