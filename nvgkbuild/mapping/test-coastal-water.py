"""Geometry regression checks for source-gap ocean repair (no network access)."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np
from shapely.geometry import Point, Polygon, box

spec = importlib.util.spec_from_file_location('marine', Path(__file__).with_name('acquire-coastal-water.py'))
marine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(marine)


class GapRepairTest(unittest.TestCase):
    def setUp(self):
        self.xs = self.ys = np.arange(0, 101, 4)
        self.low = np.full((len(self.ys), len(self.xs)), 0.2)

    def test_repairs_enclosed_gap_noise_and_preserves_mapped_island_and_mainland(self):
        noise, island, mainland = box(20, 20, 40, 40), box(60, 20, 80, 40), box(0, 50, 20, 70)
        world = box(0, 0, 100, 100)
        sea = world.difference(noise.union(island).union(mainland))
        result, records = marine.repair_gap_holes(sea, world, island, self.xs, self.ys, self.low)
        self.assertTrue(result.covers(noise))
        self.assertEqual(result.intersection(island).area, 0)
        self.assertEqual(result.intersection(mainland).area, 0)
        self.assertEqual(len(records), 1)

    def test_keeps_high_or_missing_data_holes_and_holes_outside_gap(self):
        world, hole = box(0, 0, 100, 100), box(20, 20, 40, 40)
        sea = world.difference(hole)
        high = self.low.copy()
        high[7, 7] = 0.81
        missing = self.low.copy()
        missing[7, 7] = np.nan
        for raster, domain in [(high, world), (missing, world), (self.low, box(70, 70, 90, 90))]:
            result, records = marine.repair_gap_holes(sea, domain, Polygon(), self.xs, self.ys, raster)
            self.assertEqual(result.intersection(hole).area, 0)
            self.assertEqual(records, [])

    def test_campaign_edge_is_not_surf_and_tiny_source_island_stays_a_shore(self):
        world = box(679000, 6987000, 683000, 6991000)
        island = box(680001, 6987550, 680003, 6987553)
        sea = box(680000, 6987500, 680200, 6987700).difference(island)
        coast, excluded = marine.shore_without_campaign_cuts(sea, island, world,
            [dict(boundsEpsg3006=[680000, 6987500, 682500, 6990000])])
        self.assertGreater(excluded, 200)
        self.assertGreater(coast.distance(Point(680000, 6987600)), 4)
        self.assertLess(island.boundary.difference(coast).length, 0.001)


if __name__ == '__main__':
    unittest.main()
