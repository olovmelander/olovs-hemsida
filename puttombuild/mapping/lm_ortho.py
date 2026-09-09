"""Acquire Puttom's pinned RGBI windows using the shared authenticated reader.

python puttombuild/mapping/lm_ortho.py [--probe-only] [--only context-0-0]
Credentials are read only from LANTMATERIET_* environment variables.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import math
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('shared_lm_ortho', ROOT / 'visbybuild/mapping/lm_ortho.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def selected_windows(plan, only=''):
    if (plan.get('groundId') != 'puttom' or plan.get('horizontalCrs') != 'EPSG:3006'
            or not 0 < plan.get('resolutionMetres', 0) <= 1):
        raise reader.IntakeError('Expected a Puttom EPSG:3006 orthophoto plan')
    sources = {s['id']: s for s in plan['sources']}
    if not sources or len(sources) != len(plan['sources']):
        raise reader.IntakeError('Missing or repeated source IDs')
    for source in sources.values():
        reader.source_url(source['href'])
    windows = plan['windows']
    ids = [w['id'] for w in windows]
    if len(ids) != len(set(ids)):
        raise reader.IntakeError('Repeated window IDs')
    selected = only.split(',') if only else ids
    if not selected or len(set(selected)) != len(selected) or any(i not in ids for i in selected):
        raise reader.IntakeError('Unknown or repeated review window selection')
    windows = [w for w in windows if w['id'] in selected]
    resolution = plan['resolutionMetres']
    for window in windows:
        bounds = window['boundsEpsg3006']
        if (not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', window['id'])
                or not all(isinstance(window[k], int) and window[k] > 0 for k in ('width', 'height'))
                or window['width'] * window['height'] > 16e6
                or len(bounds) != 4 or not all(math.isfinite(v) for v in bounds)
                or abs(bounds[2] - bounds[0] - window['width'] * resolution) > 1e-6
                or abs(bounds[3] - bounds[1] - window['height'] * resolution) > 1e-6
                or not window['sourceIds'] or any(i not in sources for i in window['sourceIds'])):
            raise reader.IntakeError('Invalid or oversized review window')
    return windows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, default=ROOT / 'puttombuild/mapping/lm-ortho-plan.json')
    parser.add_argument('--cache', type=Path, default=ROOT / 'puttombuild/cache/lm-ortho')
    parser.add_argument('--out', type=Path, default=ROOT / 'puttombuild/cache/lm-ortho/acquisition.json')
    parser.add_argument('--only', default='')
    parser.add_argument('--probe-only', action='store_true')
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text(encoding='utf-8'))
    windows = selected_windows(plan, args.only)
    source_ids = {i for w in windows for i in w['sourceIds']}
    sources = [s for s in plan['sources'] if s['id'] in source_ids]
    report = dict(schemaVersion=1, groundId='puttom', kind='authenticated-orthophoto-acquisition',
        observedAt=datetime.now(timezone.utc).isoformat(), sourceCommit=os.environ.get('GITHUB_SHA'),
        planSha256=reader.digest(args.plan), collection=plan['collection'], selectedWindows=[w['id'] for w in windows],
        state='pending', access=None, windows=[], rawImageryRedistributed=False, geometryChanged=False)
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    def save():
        args.out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    code = 0
    try:
        auth = reader.authorization()
        report['access'] = reader.probe_sources(sources, auth)
        if not report['access']['authorized']:
            raise reader.IntakeError('Orthophoto byte access did not pass; inspect per-asset HTTP status')
        report['state'] = 'access-verified'
        save()
        if not args.probe_only:
            for window in windows:
                record = reader.acquire_window(plan, window, args.cache, auth)
                report['windows'].append(record)
                save()
                print(json.dumps({'window': window['id'], 'width': record['width'], 'height': record['height'], 'validFraction': record['validFraction']}), flush=True)
            report['state'] = 'acquired-for-review'
    except reader.IntakeError as exc:
        report['state'], report['error'], code = 'blocked', str(exc), 2
    except Exception:
        report['state'], report['error'], code = 'failed', 'Raster acquisition failed; no runtime geometry changed', 1
    save()
    print(json.dumps({'state': report['state'], 'acquiredWindows': len(report['windows']), 'access': report['access']}))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
