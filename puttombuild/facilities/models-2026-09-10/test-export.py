"""Precision and binary-layout checks without writing any public asset."""
import importlib.util
import json
import math
from pathlib import Path
import struct
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('emit', HERE / 'emit-runtime-assets.py')
emit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(emit)


def primitive():
    # Two tangents (3,0,3), (0,4,0), with a sloped grid normal.
    normal = [-1 / math.sqrt(2), 0, 1 / math.sqrt(2)]
    return dict(material=0, positions=[-120, -20, 0, -117, -20, 3, -120, -16, 0], normals=normal * 3)


class ExportTest(unittest.TestCase):
    def test_exact_coordinates_after_float32(self):
        result = emit.transform_primitive(primitive())
        x, y, z = struct.unpack_from('<3f', result['positions'])
        expected = emit.project(emit.ORIGIN_E - 120, emit.ORIGIN_N - 20)
        self.assertAlmostEqual(x, expected[0], delta=.00002)
        self.assertEqual(y, 44)
        self.assertAlmostEqual(z, expected[1], delta=.00002)
        self.assertLess(result['maximumRoundtripMetres'], .0001)

    def test_normal_is_orthogonal_to_projected_tangents(self):
        result = emit.transform_primitive(primitive())
        positions = list(struct.iter_unpack('<3f', result['positions']))
        normal = struct.unpack_from('<3f', result['normals'])
        self.assertAlmostEqual(math.sqrt(sum(v * v for v in normal)), 1, places=6)
        self.assertGreater(abs(normal[2]), .02)  # Grid convergence rotates the normal.
        for point in positions[1:]:
            tangent = [v - origin for v, origin in zip(point, positions[0])]
            self.assertLess(abs(sum(a * b for a, b in zip(normal, tangent))), .00005)

    def test_invalid_normals_fail_before_any_write(self):
        data = primitive(); data['normals'] = [0] * 9
        with self.assertRaisesRegex(ValueError, 'normal'):
            emit.transform_primitive(data)

    def test_site_attributes_keep_exact_anchor_projection_and_vertex_ownership(self):
        data = primitive()
        data.update(groundAnchorsLocal=[-120, -20, -.2] * 3, groundModes=[1, 1, 2], groundClearances=[0, 0, .055])
        result = emit.transform_primitive(data)
        anchor = struct.unpack_from('<3f', result['groundAnchors'])
        expected = emit.project(emit.ORIGIN_E - 120, emit.ORIGIN_N - 20)
        self.assertAlmostEqual(anchor[0], expected[0], delta=.00002)
        self.assertAlmostEqual(anchor[2], expected[1], delta=.00002)
        self.assertAlmostEqual(anchor[1], 43.8, places=5)
        self.assertEqual(struct.unpack('<3f', result['groundModes']), (1, 1, 2))
        self.assertAlmostEqual(struct.unpack('<3f', result['groundClearances'])[2], .055, places=6)
        self.assertEqual(len(result['groundAnchors']), result['vertices'] * 12)

    def test_self_contained_glb_layout_and_source_metadata(self):
        snapshot = dict(groundId='puttom', coordinateFrame=dict(origin=[697365., 7025190., 44.], axes='east-north-up'),
            scene='synthetic-export-check', sourceBlend=dict(path='synthetic.blend', sha256='0' * 64),
            materials=[dict(name='transparent-net', baseColorFactor=[.1, .1, .1, .17], metallicFactor=0, roughnessFactor=.8)],
            facilities=[dict(id='clubhouse', sourceBuildingIds=['trace-clubhouse-main'], kind='building',
                groundAnchorEpsg3006=[697245., 7025170.], groundAnchorRh2000M=44.,
                footprintEpsg3006=[[697240., 7025165.], [697250., 7025165.], [697250., 7025175.], [697240., 7025175.]],
                evidence=dict(test='synthetic, never a runtime deliverable'), primitives=[dict(primitive(), castShadow=False, receiveShadow=False)])])
        binary, manifest, receipt = emit.emit(snapshot, b'synthetic')
        self.assertEqual(struct.unpack_from('<III', binary), (0x46546C67, 2, len(binary)))
        length, chunk_type = struct.unpack_from('<II', binary, 12)
        self.assertEqual(chunk_type, 0x4E4F534A)
        document = json.loads(binary[20:20 + length])
        self.assertEqual(document['nodes'][0]['extras']['sourceBuildingIds'], ['trace-clubhouse-main'])
        self.assertEqual(document['scenes'][0]['nodes'], [0])
        self.assertFalse(document['nodes'][1]['extras']['castShadow'])
        self.assertFalse(document['nodes'][1]['extras']['receiveShadow'])
        self.assertEqual(document['materials'][0]['alphaMode'], 'BLEND')
        self.assertFalse(manifest['replacesRangeFacilities'])
        self.assertEqual(receipt['triangles'], 1)
        self.assertEqual(manifest['asset']['sha256'], emit.sha256(binary))
        for view in document['bufferViews']:
            self.assertEqual(view['byteOffset'] % 4, 0)
        self.assertNotIn('images', document)


if __name__ == '__main__':
    unittest.main()
