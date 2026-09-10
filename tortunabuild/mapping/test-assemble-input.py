"""Source-change, camera and topology regression tests for Tortuna assembly."""
import hashlib
import importlib.util
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from shapely.geometry import Point, Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]


def module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT/relative)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


assembler = module('tortuna_assembler', 'tortunabuild/mapping/assemble-input.py')
partition = module('water_partition', 'geo_data/course-v2/visby/vegetation/decompose-water.py')


def feature(fid, hole=4, kind='tee', east=597400, north=6614900, **properties):
    return {'type': 'Feature', 'id': fid,
            'properties': {'hole': hole, 'kind': kind, **properties},
            'geometry': mapping(box(east, north, east+10, north+10))}


def collection(features):
    return {'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': 'EPSG:3006'}},
            'features': features}


class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.root_patch = patch.object(assembler, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.directory.cleanup)

    def write(self, path, data):
        target = self.root/path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(assembler.encoded(data))
        return assembler.ident(path)

    def layer(self, name, originals, changed, removals=(), front_format=True):
        source = f'{name}-original.geojson'
        geometry, report = f'{name}.geojson', f'{name}-review.json'
        original_pin = self.write(source, collection(originals))
        geometry_pin = self.write(geometry, collection(changed))
        review = {'replacements': sum(len(f['properties']['replacesFeatureIds']) for f in changed),
                  'additions': sum(not f['properties']['replacesFeatureIds'] for f in changed),
                  'removals': list(removals)}
        review.update({'baselineInputs': [original_pin], 'outputPath': geometry, 'outputSha256': geometry_pin['sha256']}
                      if front_format else {'originalFeatures': original_pin, 'geometry': geometry_pin})
        self.write(report, review)
        return source, (geometry, report)

    def test_both_review_formats_apply_exact_replacements_and_remove_wrong_path_pad(self):
        front, flayer = self.layer('front', [feature('front-old')],
                                  [feature('front-new', replacesFeatureIds=['front-old'], teeRole='forward-observed-platform')])
        back, blayer = self.layer('back', [feature('back-old', hole=18), feature('path-mistaken-for-pad', hole=18)],
                                 [feature('back-new', hole=18, replacesFeatureIds=['back-old'])],
                                 [{'featureId': 'path-mistaken-for-pad', 'hole': 18, 'kind': 'tee', 'reason': 'Observed continuous path'}], False)
        before = {p: (self.root/p).read_bytes() for p in [front, back]}
        with patch.object(assembler, 'SURFACES', [front, back]), patch.object(assembler, 'IMPROVEMENTS', [flayer, blayer]):
            adopted, reviews = assembler.assemble_surfaces()
        self.assertEqual([f['id'] for f in adopted], ['front-new', 'back-new'])
        self.assertEqual(adopted[0]['properties']['teeRole'], 'forward-observed-platform')
        self.assertEqual(reviews[1]['removals'][0]['featureId'], 'path-mistaken-for-pad')
        self.assertEqual(before, {p: (self.root/p).read_bytes() for p in before})

    def test_changed_original_or_changeset_hash_rejects_before_output_changes(self):
        source, layer = self.layer('front', [feature('old')], [feature('new', replacesFeatureIds=['old'])])
        sentinel = self.root/'playing-surfaces.geojson'
        sentinel.write_bytes(b'prior assembly\n')
        with patch.object(assembler, 'SURFACES', [source]), patch.object(assembler, 'IMPROVEMENTS', [layer]):
            for path in [source, layer[0]]:
                original = (self.root/path).read_bytes()
                (self.root/path).write_bytes(original+b'\n')
                with self.subTest(changed=path), self.assertRaisesRegex(ValueError, 'Source identity changed'):
                    assembler.assemble_surfaces()
                (self.root/path).write_bytes(original)
        self.assertEqual(sentinel.read_bytes(), b'prior assembly\n')

    def test_duplicate_removal_and_wrong_hole_are_rejected(self):
        for wrong_hole in [False, True]:
            replacement = feature('new', hole=5 if wrong_hole else 4,
                                  replacesFeatureIds=['old'] if wrong_hole else ['old', 'old'])
            source, layer = self.layer('front', [feature('old')], [replacement])
            with patch.object(assembler, 'SURFACES', [source]), patch.object(assembler, 'IMPROVEMENTS', [layer]):
                with self.assertRaisesRegex(ValueError, 'same original twice|hole or surface identity'):
                    assembler.assemble_surfaces()

    def test_forward_only_pads_preserve_historical_start_except_current_ninth(self):
        historical = [597400.1234, 6614900.4321]
        forward = feature('forward', east=597450, teeRole='forward-observed-platform', replacesFeatureIds=[])
        for hole in [4, 12]:
            start, eligible = assembler.choose_start(hole, [forward], historical)
            self.assertEqual(start, [597400.123, 6614900.432])
            self.assertEqual(eligible, [])
        start, eligible = assembler.choose_start(9, [forward], historical)
        self.assertTrue(Polygon(forward['geometry']['coordinates'][0]).covers(Point(start)))
        self.assertEqual(eligible, [forward])
        back = feature('back', east=597395)
        start, eligible = assembler.choose_start(4, [forward, back], historical)
        self.assertEqual(eligible, [back])
        self.assertTrue(Polygon(back['geometry']['coordinates'][0]).covers(Point(start)))

    def test_landuse_hole_is_partitioned_without_covering_maintained_surface(self):
        land = feature('field', kind='landuse')
        exclusions = box(597403, 6614903, 597407, 6614907)
        pieces, check = assembler.exclude_maintained_surfaces(land, exclusions, partition.decompose)
        shapes = [Polygon(p['ring']) for p in pieces]
        combined = unary_union(shapes)
        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(s.is_valid and not s.interiors for s in shapes))
        self.assertAlmostEqual(combined.area, 84)
        self.assertAlmostEqual(combined.intersection(exclusions).area, 0)
        self.assertAlmostEqual(combined.symmetric_difference(Polygon(land['geometry']['coordinates'][0]).difference(exclusions)).area, 0)
        self.assertEqual(check['excludedAreaSquareMetres'], 16)

    def test_measured_roof_attachment_preserves_ground_footprint_and_absolute_heights(self):
        ring = [list(point) for point in feature('building')['geometry']['coordinates'][0]]
        observation = {'id': 'observed-roof', 'associatedBuildingId': 'building',
                       'replacesGroundFootprint': False, 'sourceFootprintGeometryEpsg3006':
                       {'type': 'Polygon', 'coordinates': [ring]}}
        observation['observedRoofGeometryEpsg3006'] = deepcopy(observation['sourceFootprintGeometryEpsg3006'])
        mesh = {'verticesEpsg3006RH2000': [[597400, 6614900, 33.12], [597402, 6614900, 34.56], [597400, 6614902, 32.45]],
                'triangleIndices': [0, 1, 2]}
        evidence = self.write('evidence.json', {'source': 'test source'})
        self.write(assembler.BUILDING_OBSERVATIONS, {'groundFootprintReplacements': [], 'inputs': [], 'buildings': [observation]})
        self.write(assembler.BUILDING_ROOFS, {'horizontalCrs': 'EPSG:3006', 'verticalCrs': 'EPSG:5613',
                   'inputs': [], 'evidence': evidence, 'withheld': [], 'buildings': [{'id': 'building',
                   'observationId': 'observed-roof', 'groundFootprintReplaced': False, 'parentBuildingId': None, 'mesh': mesh}]})
        self.write(assembler.ROOF_ENVELOPES, collection([{'type': 'Feature', 'id': 'observed-roof',
                   'properties': {'associatedBuildingId': 'building', 'kind': 'building_roof_envelope'},
                   'geometry': observation['observedRoofGeometryEpsg3006']}]))
        buildings = [{'id': 'building', 'ring': deepcopy(ring)}]
        records, exclusions, review = assembler.attach_building_roofs(buildings)
        self.assertEqual(buildings[0]['ring'], ring)
        self.assertEqual(records[0]['mesh'], mesh)
        self.assertNotIn('roofSurface', buildings[0])
        self.assertEqual(review['attachedBuildingIds'], ['building'])
        self.assertEqual(exclusions[0]['ring'], ring)
        self.assertEqual(exclusions[0]['exclusionRole'], 'vegetation-only-observed-roof-envelope')

    def test_environment_preserves_network_width_and_withholds_unmeasured_bridge_deck(self):
        partition_path = 'geo_data/course-v2/visby/vegetation/decompose-water.py'
        (self.root/partition_path).parent.mkdir(parents=True, exist_ok=True)
        (self.root/partition_path).write_bytes((ROOT/partition_path).read_bytes())
        def line(fid, kind, **properties):
            return {'type': 'Feature', 'id': fid, 'geometry': {'type': 'LineString',
                    'coordinates': [[597400, 6614900], [597420, 6614920]]},
                    'properties': {'kind': kind, 'sourceId': 'source', **properties}}
        records = [line('bridge', 'path', tags={'bridge': 'yes'}, widthMetres=7.5, network='roads', highway='tertiary'),
                   line('track', 'path', widthMetres=3.5, network='tracks', highway='track', surface='compacted'),
                   line('ditch', 'watercourse', waterway='ditch', widthMetres=2),
                   line('power', 'power_line', tags={'voltage': '130000'}),
                   line('rail', 'railway', inferMasts=True)]
        output = self.write(assembler.ENVIRONMENT, collection(records))
        self.write(assembler.ENVIRONMENT_REVIEW, {'output': output})
        adopted, report = assembler.assemble_environment([], [], [], [])
        self.assertEqual([p['id'] for p in adopted['paths']], ['track'])
        self.assertEqual((adopted['paths'][0]['network'], adopted['paths'][0]['widthMetres'], adopted['paths'][0]['material']),
                         ('tracks', 3.5, 'compacted'))
        self.assertEqual(report['omitted'][0]['id'], 'bridge')
        self.assertTrue(adopted['streams'][0]['contextOnly'])
        self.assertEqual(adopted['streams'][0]['kind'], 'ditch')
        self.assertFalse(adopted['streams'][0]['inferWaterSurface'])
        self.assertFalse(adopted['railways'][0]['inferMasts'])
        self.assertEqual(adopted['powerLines'][0]['voltage'], '130000')

    def test_wider_forest_preserves_holes_and_boundary_buildings_remain_omitted(self):
        extent = box(0, 0, 100, 100)
        forest = Polygon([(-10, -10), (110, -10), (110, 110), (-10, 110)],
                         [[(30, 30), (70, 30), (70, 70), (30, 70)]])
        def context(fid, geometry, tags):
            return {'id': fid, 'properties': {'sourceId': 'test-osm', 'tags': tags}, 'geometry': mapping(geometry)}
        source = collection([context('wood', forest, {'natural': 'wood'}),
                             context('edge-house', box(95, 20, 105, 30), {'building': 'yes'}),
                             context('house', box(10, 10, 20, 20), {'building': 'yes'})])
        original = deepcopy(source)
        with patch.object(assembler, 'EXTENT', extent):
            buildings, vegetation, review = assembler.assemble_context([source], partition.decompose)
            with self.assertRaisesRegex(ValueError, 'Duplicate surrounding'):
                assembler.assemble_context([source, source], partition.decompose)
        self.assertEqual(source, original)
        self.assertEqual([b['id'] for b in buildings], ['house'])
        self.assertEqual(buildings[0]['ring'], [list(p) for p in box(10, 10, 20, 20).exterior.coords])
        combined = unary_union([Polygon(p['ring']) for p in vegetation['wood']])
        self.assertAlmostEqual(combined.symmetric_difference(forest.intersection(extent)).area, 0)
        self.assertAlmostEqual(combined.intersection(box(30, 30, 70, 70)).area, 0)
        self.assertTrue(review['landCoverTopology'][0]['clippedToMeasuredTerrain'])
        self.assertEqual(review['omitted'][0]['id'], 'edge-house')

    def test_partition_slivers_merge_without_discarding_source_area_or_closing_holes(self):
        pieces = [box(0, 0, .1, 2), box(.1, 0, 4, 2)]
        merged = assembler.merge_small_partition_pieces(pieces)
        self.assertEqual(len(merged), 1)
        self.assertAlmostEqual(merged[0].symmetric_difference(unary_union(pieces)).area, 0)
        self.assertFalse(merged[0].interiors)
        with self.assertRaisesRegex(ValueError, 'explicit review'):
            assembler.merge_small_partition_pieces([box(0, 0, .1, .1), box(3, 3, 5, 5)])

    def test_invalid_final_output_leaves_all_previous_outputs_untouched(self):
        prior = {'a.json': b'old A', 'b.json': b'old B'}
        for path, data in prior.items():
            (self.root/path).write_bytes(data)
        with self.assertRaises(ValueError):
            assembler.publish({'a.json': {'valid': True}, 'b.json': {'invalid': float('nan')}})
        self.assertEqual(prior, {p: (self.root/p).read_bytes() for p in prior})

    def test_declared_lf_receipt_pin_survives_windows_checkout_line_endings(self):
        raw = b'{\n  "source": "unchanged"\n}\n'
        (self.root/'receipt.json').write_bytes(raw.replace(b'\n', b'\r\n'))
        assembler.verify_identity({'path': 'receipt.json', 'sha256LfNormalized': hashlib.sha256(raw).hexdigest()})


if __name__ == '__main__':
    unittest.main()
