"""Bake tileable timber and granite relief in Blender for Banvy's mapped bridges.
The linear R/G fields hold wood grain and mineral relief. Runtime UVs follow
each deck's surveyed axis and the board joins stay antialiased in the shader.
"""
import array
import math
from pathlib import Path

import bpy
from mathutils import noise


def sample(u, v):
    # A torus closes both ends of the field at every octave. Its narrow axis
    # follows the board; longitudinal fibres turn around slower growth rings.
    a, b = math.tau * u, math.tau * v
    ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
    point = ((2 + 0.36 * cb) * ca, (2 + 0.36 * cb) * sa, 0.36 * sb)
    bend = noise.noise(point)
    pores = noise.noise(tuple(c * 6.8 for c in point))
    growth = 0.5 + 0.5 * math.cos(a * 7 + 5.6 * bend + 0.47 * pores)
    fibre = math.sin(a * 36 + 15 * bend + 3.1 * pores)
    wood = 0.48 + 0.24 * growth**4 + 0.055 * fibre + 0.11 * pores
    # Isotropic mineral crystals: separate the light inclusions from a finer
    # dark binder. No masonry joints are claimed by the generic bridge finish.
    rock_point = ((1.6 + 0.85 * cb) * ca, (1.6 + 0.85 * cb) * sa, 0.85 * sb)
    coarse = noise.noise(tuple(c * 9.1 for c in rock_point))
    quartz = noise.noise(tuple(c * 23.5 for c in rock_point))
    stone = 0.48 + 0.27 * coarse + 0.22 * quartz + 0.12 * max(0, quartz)**2
    return max(0, min(1, wood)), max(0, min(1, stone)), max(0, min(1, 0.5 + 0.4 * pores)), 1


def bake():
    side = 256
    values = array.array("f")
    for y in range(side):
        for x in range(side):
            values.extend(sample((x + 0.5) / side, (y + 0.5) / side))
    image = bpy.data.images.new("Bridge relief", side, side, alpha=False, is_data=True)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(values)
    target = Path(__file__).resolve().parents[2] / "apps/golf/src/engine/assets/bridge-relief.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(target)
    image.file_format = "PNG"
    image.save()
    print(f"Baked linear bridge relief: {target.stat().st_size} bytes")


if __name__ == "__main__":
    bake()
