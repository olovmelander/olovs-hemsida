import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('puttom_lm_ortho', HERE / 'lm_ortho.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PuttomIntakeTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads((HERE / 'lm-ortho-plan.json').read_text(encoding='utf-8'))

    def test_window_selection_is_exact(self):
        selected = module.selected_windows(self.plan, 'context-0-0,hole-01-green')
        self.assertEqual({w['id'] for w in selected}, {'context-0-0', 'hole-01-green'})
        for value in ['missing', 'context-0-0,context-0-0']:
            with self.assertRaises(module.reader.IntakeError):
                module.selected_windows(self.plan, value)

    def test_bad_native_grid_or_missing_source_is_rejected(self):
        for change in ['grid', 'source', 'path']:
            plan = copy.deepcopy(self.plan)
            if change == 'grid':
                plan['windows'][0]['boundsEpsg3006'][0] += 0.08
            elif change == 'source':
                plan['windows'][0]['sourceIds'] = ['unknown']
            else:
                plan['windows'][0]['id'] = '../unsafe'
            with self.assertRaises(module.reader.IntakeError):
                module.selected_windows(plan)


if __name__ == '__main__':
    unittest.main()
