"""Add explicitly located native review windows to the pinned acquisition.

--window ID,EASTING,NORTHING,SIZE_METRES (repeatable), all EPSG:3006.
Existing imagery and baseline feature geometry remain pinned.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('acquisition', Path(__file__).with_name('lm-ortho-acquire.py'))
acquisition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquisition)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--window', action='append', required=True)
    args = parser.parse_args()
    reference = ROOT / 'geo_data/course-v2/johannesberg/reference'
    cache = ROOT / 'johannesbergbuild/cache/lm-ortho'
    plan_file = reference / 'lm-ortho-plan-2026-09-09.json'
    report_file = reference / 'lm-ortho-acquisition-2026-09-09.json'
    plan = json.loads(plan_file.read_text(encoding='utf-8'))
    report = json.loads(report_file.read_text(encoding='utf-8'))
    resolution = plan['nativeResolutionMetres']
    anchor = plan['sources'][0]['boundsEpsg3006'][:2]
    selected = []
    for value in args.window:
        identifier, east, north, size = value.split(',')
        east, north, size = map(float, (east, north, size))
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', identifier) or not 0 < size <= 500:
            raise ValueError('Invalid additional review window')
        centre = [east, north]
        bounds = [round(anchor[a] + math.floor((centre[a] - size / 2 - anchor[a]) / resolution) * resolution, 6) for a in range(2)]
        bounds += [round(anchor[a] + math.ceil((centre[a] + size / 2 - anchor[a]) / resolution) * resolution, 6) for a in range(2)]
        width, height = [round((bounds[a + 2] - bounds[a]) / resolution) for a in range(2)]
        sources = [s['id'] for s in plan['sources'] if all(bounds[a] < s['boundsEpsg3006'][a + 2] and bounds[a + 2] > s['boundsEpsg3006'][a] for a in range(2))]
        window = dict(id=identifier, boundsEpsg3006=bounds, width=width, height=height,
                      resolutionMetres=resolution, sourceIds=sources,
                      purpose='Additional visual review of a feature located outside its baseline outline')
        old = next((w for w in plan['windows'] if w['id'] == identifier), None)
        if old and old != window:
            raise ValueError('Existing extra window differs; use a distinct identifier')
        if not old:
            plan['windows'].append(window)
        selected.append(window)
    acquisition.write_json(plan_file, plan)
    acquisition.write_json(cache / 'plan.json', plan)
    extra_file = cache / 'extra-acquisition.json'
    acquisition.acquire(plan, selected, cache, extra_file)
    extra = json.loads(extra_file.read_text(encoding='utf-8'))
    records = {r['id']: r for r in report['windows']}
    records.update({r['id']: r for r in extra['windows']})
    report['windows'] = [records[w['id']] for w in plan['windows']]
    report['planSha256'] = hashlib.sha256(plan_file.read_bytes()).hexdigest()
    acquisition.write_json(report_file, report)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps(dict(state='failed', errorType=type(exc).__name__)))
        raise SystemExit(1)
