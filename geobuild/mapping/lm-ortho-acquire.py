#!/usr/bin/env python3
"""Acquire pinned, native-grid Veckefjarden orthophotos to the ignored cache.

python geobuild/mapping/lm-ortho-acquire.py --env-file .env
Provider credentials remain in memory; no raw pixels are committed/uploaded.
The existing tested Visby reader performs bounded authenticated COG reads.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import IntakeError, acquire_window, authorization, digest, probe_sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--only', help='Comma-separated context window IDs')
    args = parser.parse_args()
    if args.env_file:
        for line in args.env_file.read_text(encoding='utf-8-sig').splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            name, value = line.split('=', 1)
            if name.strip() in ('LANTMATERIET_USERNAME', 'LANTMATERIET_PASSWORD', 'LANTMATERIET_BEARER_TOKEN'):
                os.environ.setdefault(name.strip(), value.strip().strip('\"\''))
    metadata = ROOT / 'geo_data/course-v2/veckefjarden/acquisition'
    plan_file = metadata / 'ortho-plan.json'
    plan = json.loads(plan_file.read_text(encoding='utf-8'))
    if plan.get('groundId') != 'veckefjarden' or plan.get('horizontalCrs') != 'EPSG:3006':
        raise IntakeError('Expected the pinned Veckefjarden plan')
    windows = plan['windows']
    if args.only:
        selected = set(args.only.split(','))
        windows = [w for w in windows if w['id'] in selected]
        if len(windows) != len(selected):
            raise IntakeError('Unknown review window')
    for window in windows:
        if not 0 < window['width'] * window['height'] <= 16_000_000:
            raise IntakeError('Review window exceeds the reader budget')
    cache = ROOT / 'geobuild/cache/lm-ortho-veckefjarden'
    cache.mkdir(parents=True, exist_ok=True)
    report_file = metadata / 'ortho-review.json'
    report = dict(schemaVersion=1, groundId='veckefjarden', kind='authenticated-orthophoto-acquisition',
                  observedAt=datetime.now(timezone.utc).isoformat(), state='pending',
                  planSha256=digest(plan_file), collection=plan['collection'],
                  horizontalCrs=plan['horizontalCrs'], resolutionMetres=plan['resolutionMetres'],
                  boundsEpsg3006=plan['boundsEpsg3006'], sourceRasterDirectory='geobuild/cache/lm-ortho-veckefjarden',
                  attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
                  sourceAbsoluteHorizontalAccuracyMetres=None,
                  selectedWindows=[w['id'] for w in windows], access=None, windows=[],
                  rawImageryRedistributed=False, geometryChanged=False)
    def save():
        report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    try:
        auth = authorization()
        report['access'] = probe_sources(plan['sources'], auth)
        if not report['access']['authorized']:
            raise IntakeError('Authenticated TIFF byte probe failed')
        report['state'] = 'acquiring'
        save()
        for window in windows:
            record = acquire_window(plan, window, cache, auth)
            if record['validFraction'] != 1:
                raise IntakeError('Incomplete image coverage')
            report['windows'].append(record)
            save()
            print(json.dumps({key: record[key] for key in ('id', 'width', 'height', 'validFraction', 'bytes')}), flush=True)
        report['state'] = 'acquired-for-review'
        save()
        return 0
    except Exception as exc:
        # Third-party HTTP/raster errors may include authentication headers.
        report['state'], report['errorType'] = 'failed', type(exc).__name__
        save()
        print(json.dumps({'state': 'failed', 'errorType': type(exc).__name__}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
