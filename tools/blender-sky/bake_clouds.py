"""Bake the upper hemisphere of Poly Haven's CC0 Kloofendal 48d Partly Cloudy (Pure Sky).

Greg Zaal (photography), Jarod Guest (sky edit), https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
Input: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr
blender -b -y --factory-startup -P tools/blender-sky/bake_clouds.py -- /path/to/input.hdr
"""
import hashlib
import sys
from pathlib import Path

import bpy
import numpy as np

source = Path(sys.argv[sys.argv.index("--") + 1])
if hashlib.sha256(source.read_bytes()).hexdigest() != "5244534e9cf5b606f2ff513aa00ddb161b0a4826ffd88a0d3bd03ac29247d198":
    raise ValueError("Expected the 2K HDR version of Kloofendal 48d Partly Cloudy (Pure Sky)")

hdr = bpy.data.images.load(str(source.resolve()))
width, height = hdr.size
pixels = np.empty(width * height * 4, np.float32)
hdr.pixels.foreach_get(pixels)
sky = pixels.reshape(height, width, 4)[height // 2:, :, :3]
luma = sky @ np.array([.2126, .7152, .0722], np.float32)
sun_y, sun_x = np.unravel_index(np.argmax(luma), luma.shape)
elevation = (np.arange(height // 2)[:, None] + .5) * np.pi / height
azimuth = (np.arange(width)[None, :] - sun_x) * 2 * np.pi / width
cos_angle = (np.sin(elevation) * np.sin(elevation[sun_y]) +
             np.cos(elevation) * np.cos(elevation[sun_y]) * np.cos(azimuth))

# Unmix the neutral condensate from blue air. The clear-sky chromaticity
# changes with both elevation and angular distance to the sun. Fit its lower
# envelope so bright wisps survive and the broad solar aureole stays out.
up = np.broadcast_to(np.sin(elevation), luma.shape)
features = np.stack([np.ones_like(up), np.exp(-up * 13), up, up**2,
                     cos_angle, cos_angle**2, np.maximum(cos_angle, 0)**8], axis=-1)
chroma = sky[:, :, 0] / np.maximum(sky[:, :, 2], 1e-5)
a = features[::6, ::6].reshape(-1, features.shape[-1])
b = chroma[::6, ::6].ravel()
weights = np.ones_like(b)
for _ in range(8):
    fit = np.linalg.lstsq(a * weights[:, None], b * weights, rcond=None)[0]
    weights = np.where(b > a @ fit, .15, 1.)
clear = features @ fit
opacity = np.clip((chroma - clear - .024) / np.maximum(.21, .78 - clear), 0, 1)
relief = np.clip((np.log2(np.maximum(luma, .01)) + 2.6) / 3.6, 0, 1)
lining = np.clip(np.log2(np.maximum(1., luma)) / 2.5, 0, 1)

# Remove the photographic solar disc. The player's live sun controls all
# directional highlights, including those in the water.
disc = cos_angle > np.cos(np.deg2rad(1.0))
rim = (cos_angle > np.cos(np.deg2rad(1.8))) & ~disc
for channel in (opacity, relief, lining):
    channel[disc] = np.median(channel[rim])

packed = np.stack([opacity, relief, lining, np.ones_like(luma)], axis=-1)
packed = np.roll(packed, width // 2 - sun_x, axis=1)
result = bpy.data.images.new("Relightable clouds", width, height // 2, alpha=False, float_buffer=True)
result.colorspace_settings.name = "Non-Color"
result.pixels.foreach_set(packed.astype(np.float32).ravel())
scene = bpy.context.scene
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "WEBP"
scene.render.image_settings.quality = 95
target = Path(__file__).resolve().parents[2] / "apps/golf/src/engine/assets/cloud-radiance.webp"
target.parent.mkdir(parents=True, exist_ok=True)
result.save_render(str(target), scene=scene)
