"""Acquire bounded facility reference imagery without modifying course geometry.

Run with the repository review Python environment. Credentials are handled by
the established authenticated reader; source pixels stay in the ignored cache.
"""
from pathlib import Path
import importlib.util
import json
import math

ROOT = Path(__file__).resolve().parents[3]
REFERENCE = Path(__file__).parent
CACHE = ROOT / 'upsalabuild/cache/facilities-2026-09-10'
spec = importlib.util.spec_from_file_location('upsala_ortho', ROOT / 'upsalabuild/mapping/lm-ortho-acquire.py')
ortho = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ortho)

source_file = ROOT / 'geo_data/course-v2/upsala/reference/lm-ortho-plan-2026-09-09.json'
source_plan = json.loads(source_file.read_text(encoding='utf-8'))
model_file = ROOT / 'upsalabuild/course-model.json'
model = json.loads(model_file.read_text(encoding='utf-8'))
anchor = source_plan['sources'][0]['boundsEpsg3006'][:2]
definitions = [
    ('facilities-campus-native', [639740, 6636120, 640120, 6636540], .16,
     'Clubhouse cluster, shop/restaurant candidate wings, training buildings, service yard, range shelters and parking'),
    ('facilities-range-native', [639590, 6636190, 639850, 6636345], .16,
     'Complete range tee line and shelters west of the clubhouse at native resolution'),
    ('facilities-range-overview', [639460, 6635860, 640140, 6636560], .64,
     'Facilities campus, driving range and practice-area context; downsampled overview'),
]
windows = []
for ident, requested, resolution, purpose in definitions:
    bounds = [round(anchor[a] + math.floor((requested[a] - anchor[a]) / resolution) * resolution, 6) for a in range(2)]
    bounds += [round(anchor[a] + math.ceil((requested[a+2] - anchor[a]) / resolution) * resolution, 6) for a in range(2)]
    width, height = [round((bounds[a+2] - bounds[a]) / resolution) for a in range(2)]
    source_ids = [s['id'] for s in source_plan['sources'] if all(bounds[a] < s['boundsEpsg3006'][a+2] and bounds[a+2] > s['boundsEpsg3006'][a] for a in range(2))]
    windows.append(dict(id=ident, purpose=purpose, boundsEpsg3006=bounds, width=width, height=height,
                        resolutionMetres=resolution, sourceIds=source_ids, features=[]))
plan = dict(schemaVersion=1, groundId='upsala', kind='facilities-reference-orthophoto-plan',
            collection=source_plan['collection'], nativeResolutionMetres=.16,
            sourcePlan=dict(path=source_file.relative_to(ROOT).as_posix(), sha256=ortho.digest(source_file)),
            models=[dict(file=model_file.relative_to(ROOT).as_posix(),sha256=ortho.digest(model_file),
                         frame={k:model[k] for k in ['origin','mPerLat','mPerLon']})],
            sources=source_plan['sources'], windows=windows)
ortho.write_json(CACHE / 'plan.json', plan)
ortho.write_json(REFERENCE / 'orthophoto-plan.json', plan)
ortho.acquire(plan, windows, CACHE, REFERENCE / 'orthophoto-acquisition.json')
