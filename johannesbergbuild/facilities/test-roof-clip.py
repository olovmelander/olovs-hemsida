"""Portable geometry tests using Blender's bundled mathutils, without scene edits.

From the repository root:
  blender --background --factory-startup --python-exit-code 1 \
    --python johannesbergbuild/facilities/test-roof-clip.py

On Windows, use the installed blender.exe path if it is not on PATH.
"""
import math
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest

HELPER = runpy.run_path(str(Path(__file__).resolve().with_name('roof_clip.py')))
clip = HELPER['clip_recent_faces']
L_MASK = [(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)]
SQUARE = [(0, 0), (4, 0), (4, 4), (0, 4)]


def mask(points):
    return [[679200+x, 6626160+y] for x, y in points]


def architecture(points, color='roof'):
    return SimpleNamespace(vertices=points, faces=[tuple(range(len(points)))], colors=[color])


def xy_area(model):
    return sum(abs(sum(model.vertices[face[i]][0]*model.vertices[face[(i+1) % len(face)]][1]
                       - model.vertices[face[(i+1) % len(face)]][0]*model.vertices[face[i]][1]
                       for i in range(len(face))))/2 for face in model.faces)


def surface_area(model):
    # Independent triangle-fan area calculation; vertical surfaces remain nonzero.
    result = 0.0
    for face in model.faces:
        origin = model.vertices[face[0]]
        for i in range(1, len(face)-1):
            a = [model.vertices[face[i]][k]-origin[k] for k in range(3)]
            b = [model.vertices[face[i+1]][k]-origin[k] for k in range(3)]
            cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
            result += math.sqrt(sum(v*v for v in cross))/2
    return result


class RoofClipTests(unittest.TestCase):
    def check_slope(self, boundary):
        model = architecture([(x, y, 2*x+3*y+5)
                              for x, y in [(-1, -1), (5, -1), (5, 5), (-1, 5)]], 'slope')
        clip(model, 0, mask(boundary))
        self.assertAlmostEqual(xy_area(model), 7, places=6)
        self.assertAlmostEqual(surface_area(model), 7*math.sqrt(14), places=6)
        self.assertTrue(all(color == 'slope' for color in model.colors))
        for face in model.faces:
            for index in face:
                x, y, z = model.vertices[index]
                self.assertAlmostEqual(z, 2*x+3*y+5, places=7)
                self.assertTrue(-1e-6 <= x <= 4+1e-6 and -1e-6 <= y <= 4+1e-6)
                self.assertTrue(x <= 1+1e-6 or y <= 1+1e-6)

    def test_sloped_roof_concave_cut_preserves_plane_and_area(self):
        self.check_slope(L_MASK)

    def test_reversed_mask_winding(self):
        self.check_slope(list(reversed(L_MASK)))

    def test_closed_mask_repeated_endpoint(self):
        self.check_slope(L_MASK+[L_MASK[0]])

    def test_vertical_fascia_retains_height_and_area(self):
        model = architecture([(.5, -2, 0), (.5, 5, 0), (.5, 5, 2), (.5, -2, 2)], 'fascia')
        clip(model, 0, mask(L_MASK))
        self.assertAlmostEqual(surface_area(model), 8, places=6)
        self.assertTrue(all(color == 'fascia' for color in model.colors))

    def check_diagonal(self, first, last):
        model = architecture([(*first, 0), (*last, 0), (*last, 2), (*first, 2)], 'diagonal')
        clip(model, 0, mask(SQUARE))
        # One of the two diagonals is a shared mask-triangle edge. Its vertical
        # face must occur once, not twice; the other diagonal must split cleanly.
        self.assertAlmostEqual(surface_area(model), 8*math.sqrt(2), places=6)

    def test_vertical_positive_diagonal_is_not_duplicated(self):
        self.check_diagonal((-1, -1), (5, 5))

    def test_vertical_negative_diagonal_is_not_duplicated(self):
        self.check_diagonal((-1, 5), (5, -1))

    def test_earlier_faces_and_materials_remain_unchanged(self):
        model = SimpleNamespace(
            vertices=[(-9, -9, 1), (-8, -9, 1), (-9, -8, 1),
                      (-1, -1, 0), (5, -1, 0), (5, 5, 0), (-1, 5, 0)],
            faces=[(0, 1, 2), (3, 4, 5, 6)], colors=['prefix', 'roof'])
        clip(model, 1, mask(L_MASK))
        self.assertEqual(model.faces[0], (0, 1, 2))
        self.assertEqual(model.colors[0], 'prefix')
        self.assertTrue(all(color == 'roof' for color in model.colors[1:]))
        self.assertEqual(model.vertices[:3], [(-9, -9, 1), (-8, -9, 1), (-9, -8, 1)])

    def test_fully_outside_face_is_removed_with_its_material(self):
        model = architecture([(10, 10, 0), (11, 10, 0), (11, 11, 0), (10, 11, 0)])
        clip(model, 0, mask(L_MASK))
        self.assertEqual(model.faces, [])
        self.assertEqual(model.colors, [])

    def test_invalid_mask_fails_before_any_mutation(self):
        model = architecture([(0, 0, 0), (1, 0, 0), (1, 1, 0)])
        before = repr(model)
        with self.assertRaises(ValueError):
            clip(model, 0, mask([(0, 0), (1, 1), (2, 2)]))
        self.assertEqual(repr(model), before)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RoofClipTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise AssertionError('Roof clipping regression tests failed')
