"""Pack the measured 1.9 m Poly Haven Granite Wall scan for the Stadium's retaining wall.

Original scan by Dimitrios Savva, CC0, https://polyhaven.com/a/granite_wall.
Run blender -b -P tools/blender-props/bake_bank_granite.py -- <source-cache-directory>.
"""
import hashlib
from pathlib import Path
import sys
from urllib.request import urlopen

import bpy
import numpy as np

cache = Path(sys.argv[sys.argv.index("--") + 1])
cache.mkdir(parents=True, exist_ok=True)


def read_map(name, digest, colour=False):
    filename = f"granite_wall_{name}_1k.jpg"
    source = cache / filename
    if not source.exists():
        url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/granite_wall/{filename}"
        source.write_bytes(urlopen(url, timeout=30).read())
    if hashlib.md5(source.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Unexpected Poly Haven source: {filename}")
    image = bpy.data.images.load(str(source.resolve()))
    image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    image.scale(512, 512)
    pixels = np.empty(512 * 512 * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(512, 512, 4)


albedo = read_map("diff", "9f9883bcb534a840ad29f4e26c0b3589", True)
luma = albedo[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# Encode local reflectance about the measured wall palette. The renderer can
# keep its granite coping and face colours while retaining the scan's contrast.
pigment = np.clip(0.5 + np.log2(np.maximum(luma, 0.001) / np.median(luma)) / 4, 0, 1)
rough = read_map("rough", "14707c440dd8d6e3373144b82767c4c1")[:, :, 0]
relief = read_map("disp", "4fe5fb5c3d27d4dc2e060275bb556ba8")[:, :, 0]
channels = np.stack([pigment, rough, relief, np.ones_like(rough)], axis=-1)
result = bpy.data.images.new("Split granite", 512, 512, alpha=False, float_buffer=True)
result.colorspace_settings.name = "Non-Color"
result.pixels.foreach_set(channels.astype(np.float32).ravel())
scene = bpy.context.scene
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.quality = 96
target = Path(__file__).resolve().parents[2] / "apps/golf/src/engine/assets/bank-granite.webp"
result.save_render(str(target), scene=scene)
print(f"Baked {target.name}, {target.stat().st_size} bytes")
