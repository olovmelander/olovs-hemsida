"""Synthetic image/grid unit fixtures only; these are never course evidence."""
import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location('overlays', Path(__file__).with_name('render-source-overlays.py'))
overlays = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlays)


class SourceOverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='source-overlay-unit-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        image = Image.new('RGBA', (4, 2), (30, 80, 140, 0))  # zero NIR must not turn RGB transparent
        image.save(self.root/'unit.tif')
        self.row = {'id': 'unit-fixture', 'rasterFile': 'unit.tif', 'sha256': overlays.sha(self.root/'unit.tif'),
                    'validFraction': 1, 'boundsEpsg3006': [100, 200, 104, 202], 'width': 4, 'height': 2,
                    'geoTransform': [100, 1, 0, 202, 0, -1], 'sources': [{'id': 'synthetic-test', 'capturedAt': '2000-01-01'}]}

    def sources(self, row=None):
        return overlays.read_sources({'windows': [row or self.row]}, self.root)

    def test_pinned_rgb_is_visible_with_zero_nir_and_metric_aspect_ratio(self):
        sources, errors = self.sources()
        self.assertEqual(errors, [])
        panel = {'id': 'unit', 'extentEPSG3006': [100, 200, 104, 202], 'featureIds': []}
        result = overlays.render_panel(panel, {}, sources, self.root, size=100)
        self.assertFalse(result['geographicApproval'])
        self.assertEqual(result['displayCoverageFraction'], 1)
        with Image.open(self.root/result['image']) as image:
            self.assertEqual(image.size, (200, 90))
            self.assertEqual(image.getpixel((10, 50)), (30, 80, 140))
        first = result['sha256']
        self.assertEqual(overlays.render_panel(panel, {}, sources, self.root, size=100)['sha256'], first)

    def test_hash_grid_mask_and_capture_date_fail_closed(self):
        cases = [{'sha256': '0'*64}, {'geoTransform': [101, 1, 0, 202, 0, -1]},
                 {'validFraction': .5}, {'sources': [{'id': 'undated'}]}, {'width': 5}, {'rasterFile': '../unit.tif'}]
        for mutation in cases:
            with self.subTest(mutation=mutation):
                row = {**copy.deepcopy(self.row), **mutation}
                sources, errors = self.sources(row)
                self.assertEqual(sources, [])
                self.assertEqual(len(errors), 1)

    def test_partial_extent_is_reported_and_missing_coverage_produces_no_image(self):
        sources, _ = self.sources()
        partial = {'id': 'partial', 'extentEPSG3006': [100, 200, 108, 202], 'featureIds': []}
        result = overlays.render_panel(partial, {}, sources, self.root, size=100)
        self.assertEqual(result['displayCoverageFraction'], .5)
        absent = {'id': 'absent', 'extentEPSG3006': [500, 600, 508, 602], 'featureIds': []}
        result = overlays.render_panel(absent, {}, sources, self.root)
        self.assertEqual(result['status'], 'missing-source-coverage')
        self.assertFalse((self.root/'absent.png').exists())


if __name__ == '__main__':
    unittest.main()
