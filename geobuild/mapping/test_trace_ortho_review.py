"""Historical tee identity stays tied to an original source ID or exact slot."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('trace_review', Path(__file__).with_name('trace-ortho-review.py'))
TRACE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRACE)


class HistoricalPadIdentityTests(unittest.TestCase):
    def test_idless_dtm_uses_index_without_fabricating_source_id(self):
        self.assertEqual(TRACE.historical_pad_identity({'prov': 'dtm'}, 2), {'sourceOriginalPadIndex': 2})

    def test_original_source_id_path_is_retained(self):
        self.assertEqual(TRACE.historical_pad_identity({'id': 'w123'}, 2), {'sourceId': 'w123'})
        self.assertEqual(TRACE.historical_pad_identity({'id': 'review-pad', 'sourceId': 'w123'}, 2), {'sourceId': 'w123'})

    def test_original_index_aliases_are_exact_and_validated(self):
        pads = [{}, {}, {}]
        self.assertEqual(TRACE.retained_pad_index({'retainedOriginalPadIndex': 1}, pads), 1)
        self.assertEqual(TRACE.retained_pad_index({'sourceOriginalPadIndex': 1}, pads), 1)
        for part in [{}, {'sourceOriginalPadIndex': -1}, {'sourceOriginalPadIndex': 3},
                     {'sourceOriginalPadIndex': True}, {'sourceOriginalPadIndex': '1'},
                     {'sourceOriginalPadIndex': 1, 'retainedOriginalPadIndex': 2}]:
            with self.subTest(part=part), self.assertRaises(ValueError):
                TRACE.retained_pad_index(part, pads)


if __name__ == '__main__':
    unittest.main()
