"""Coordinate and coverage checks for the orthophoto review renderer.

Run with the same Python environment as render-ortho-review.py:
  python -m unittest discover -s geobuild/mapping -p test_render_ortho_review.py
"""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image
from rasterio.enums import ColorInterp
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds


SPEC = importlib.util.spec_from_file_location('ortho_review', Path(__file__).with_name('render-ortho-review.py'))
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


class CoverageTests(unittest.TestCase):
    def test_adjacent_sources_cover_and_subpixel_gap_is_rejected(self):
        bounds = [0, 0, 10, 10]
        self.assertTrue(review.rectangle_covered(bounds, [[0, 0, 5, 10], [5, 0, 10, 10]]))
        self.assertFalse(review.rectangle_covered(bounds, [[0, 0, 4.999, 10], [5, 0, 10, 10]]))
        self.assertFalse(review.rectangle_covered(bounds, [[0, 0, 10, 9.999]]))

    def render(self, pixels):
        panel = {'id': 'synthetic', 'pixelSize': [10, 10], 'extentEPSG3006': [683000, 7023000, 683010, 7023010]}
        with MemoryFile() as memory:
            with memory.open(driver='GTiff', width=10, height=10, count=4, dtype='uint8',
                             crs='EPSG:3006', transform=from_bounds(*panel['extentEPSG3006'], 10, 10)) as writer:
                writer.write(pixels)
                writer.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
            with memory.open() as raster:
                return review.render_source(panel, [raster], [{'path': 'synthetic', 'sha256': 'synthetic'}])

    @staticmethod
    def gradient():
        rgb = np.tile(np.arange(100, dtype=np.uint8).reshape(1, 10, 10), (4, 1, 1))
        rgb[3] = 255
        return rgb

    def test_valid_black_pixel_is_preserved(self):
        image, transform, sources, stats = self.render(self.gradient())
        self.assertEqual(image.getpixel((0, 0)), (0, 0, 0))
        self.assertEqual(stats['validPixelFraction'], 1)
        self.assertFalse(stats['visualReviewPerformed'])
        self.assertEqual(transform * (0, 0), (683000, 7023010))
        self.assertEqual(transform * (10, 10), (683010, 7023000))
        self.assertEqual(len(sources), 1)

    def test_alpha_hole_is_not_treated_as_covered(self):
        pixels = self.gradient()
        pixels[3, 5, 5] = 0
        with self.assertRaisesRegex(ValueError, 'lack valid source data'):
            self.render(pixels)

    def test_spatially_constant_colour_is_rejected(self):
        pixels = np.zeros((4, 10, 10), dtype=np.uint8)
        pixels[0], pixels[1], pixels[2], pixels[3] = 50, 100, 150, 255
        with self.assertRaisesRegex(ValueError, 'spatially blank'):
            self.render(pixels)

    def test_world_file_uses_centres_and_json_transform_uses_edges(self):
        transform = from_bounds(683000, 7023000, 683100, 7023100, 800, 800)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'panel.png'
            review.save_georeferenced(Image.new('RGB', (800, 800)), path, transform)
            world = list(map(float, path.with_suffix('.pgw').read_text().splitlines()))
            self.assertEqual(world[:4], [0.125, 0, 0, -0.125])
            self.assertEqual(world[4:], [683000.0625, 7023099.9375])
            self.assertEqual(transform * (0, 0), (683000, 7023100))
            self.assertTrue(path.with_suffix('.prj').exists())


if __name__ == '__main__':
    unittest.main()
