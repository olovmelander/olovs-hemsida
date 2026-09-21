#!/usr/bin/env python3
"""Render pinned Lantmateriet acquisition windows beside EPSG:3006 model overlays.

Consumes the real windows[] acquisition format used by Puttom/Johannesberg.
RGBI's fourth band is NIR, never transparency. Unknown/no-data pixels are not
silently painted as evidence. All output is local and all reviews stay pending.
Requires Pillow. Source hashes, grid, dimensions, dates and coverage are retained.
"""
import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from PIL import Image, ImageDraw, __version__ as pillow_version


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_sources(acquisition, directory):
    sources, errors = [], []
    for row in acquisition['windows']:
        try:
            filename = row['rasterFile']
            if Path(filename).name != filename:
                raise ValueError('rasterFile must be a basename')
            file = directory / filename
            if not file.is_file():
                raise ValueError(f'missing raw window: {file}')
            if sha(file) != row['sha256']:
                raise ValueError(f'raw window hash differs: {file}')
            if row.get('validFraction') != 1:
                raise ValueError('partial/unknown validity requires a mask-aware source adapter')
            west, south, east, north = row['boundsEpsg3006']
            width, height = row['width'], row['height']
            if not (east > west and north > south and width > 0 and height > 0):
                raise ValueError('invalid raster extent/dimensions')
            wanted = [west, (east-west)/width, 0, north, 0, -(north-south)/height]
            if len(row['geoTransform']) != 6 or any(abs(a-b) > 1e-7 for a, b in zip(row['geoTransform'], wanted)):
                raise ValueError('pixel-edge geotransform and declared extent differ')
            if not row.get('sources') or any(not s.get('capturedAt') for s in row['sources']):
                raise ValueError('capture dates/source identities required')
            with Image.open(file) as image:
                if image.size != (width, height) or len(image.getbands()) not in (3, 4):
                    raise ValueError('image dimensions/bands disagree with acquisition')
            sources.append({**row, 'file': file})
        except (OSError, ValueError, KeyError) as error:
            errors.append({'window': row.get('id'), 'reason': str(error)})
    return sources, errors


def render_panel(panel, features, sources, out, size=720):
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', panel['id']):
        raise ValueError('panel identity must be a safe filename stem')
    e0, n0, e1, n1 = panel['extentEPSG3006']
    if not all(math.isfinite(v) for v in (e0, n0, e1, n1)) or not (e1 > e0 and n1 > n0):
        raise ValueError('invalid panel bounds')
    scale = size / max(e1-e0, n1-n0)
    width, height = max(1, round((e1-e0)*scale)), max(1, round((n1-n0)*scale))
    base = Image.new('RGB', (width, height), '#363d48')
    mask = Image.new('1', (width, height))
    used = []
    # Coarse context first; native windows overwrite only their observed extent.
    for source in sorted(sources, key=lambda s: -abs(s['geoTransform'][1])):
        a, b, c, d = source['boundsEpsg3006']
        left, bottom, right, top = max(a, e0), max(b, n0), min(c, e1), min(d, n1)
        if right <= left or top <= bottom:
            continue
        with Image.open(source['file']) as raw:
            image = Image.merge('RGB', raw.split()[:3])
            box = ((left-a)/(c-a)*image.width, (d-top)/(d-b)*image.height,
                   (right-a)/(c-a)*image.width, (d-bottom)/(d-b)*image.height)
            x0, y0 = round((left-e0)/(e1-e0)*width), round((n1-top)/(n1-n0)*height)
            x1, y1 = round((right-e0)/(e1-e0)*width), round((n1-bottom)/(n1-n0)*height)
            if x1 <= x0 or y1 <= y0:
                continue
            base.paste(image.resize((x1-x0, y1-y0), Image.Resampling.LANCZOS, box=box), (x0, y0))
            ImageDraw.Draw(mask).rectangle((x0, y0, x1-1, y1-1), fill=1)
            used.append({'id': source['id'], 'sha256': source['sha256'], 'sources': source['sources']})
    fraction = (width*height - mask.histogram()[0]) / (width*height)
    if not used:
        return {'id': panel['id'], 'status': 'missing-source-coverage', 'displayCoverageFraction': 0, 'geographicApproval': False}
    overlay = base.copy()
    draw = ImageDraw.Draw(overlay)
    colors = {'greens': '#00ffff', 'tees': '#ffffff', 'fairways': '#ff60ef',
              'bunkers': '#ffff00', 'water': '#409dff', 'infrastructure': '#ffa040'}
    for identity in panel['featureIds']:
        f = features[identity]
        for ring in f['rings']:
            points = [((e-e0)/(e1-e0)*width, (n1-n)/(n1-n0)*height) for e, n in ring]
            if len(points) >= 2:
                draw.line(points + ([points[0]] if f['closed'] else []), fill=colors[f['category']], width=2)
    pair = Image.new('RGB', (width*2, height+40), '#15191f')
    pair.paste(base, (0, 40)); pair.paste(overlay, (width, 40))
    ImageDraw.Draw(pair).text((10, 12), f"{panel['id']} | north up | source coverage {fraction:.1%} | REVIEW PENDING", fill='white')
    file = out / (panel['id']+'.png'); pair.save(file)
    return {'id': panel['id'], 'status': 'rendered-awaiting-review', 'extentEPSG3006': panel['extentEPSG3006'],
            'displayCoverageFraction': fraction, 'coverageMeaning': 'Fraction of display pixels backed by fully valid source windows; not reviewed area.',
            'sourceWindows': used, 'image': file.name, 'sha256': sha(file), 'geographicApproval': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--acquisition', type=Path, required=True)
    parser.add_argument('--acquisition-sha256', required=True)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if 'cache' not in args.out.parts:
        parser.error('imagery panels must stay in a local cache directory')
    if args.out.exists():
        parser.error('use a fresh output directory to preserve earlier evidence')
    if sha(args.acquisition) != args.acquisition_sha256:
        parser.error('acquisition metadata hash differs from the pinned configuration')
    review = json.loads(args.review.read_text()); acquisition = json.loads(args.acquisition.read_text())
    if review['groundId'] != acquisition['groundId'] or review.get('crs') != 'EPSG:3006':
        parser.error('review/acquisition ground or CRS mismatch')
    if acquisition.get('horizontalCrs', 'EPSG:3006') != 'EPSG:3006':
        parser.error('unsupported acquisition CRS')
    sources, errors = read_sources(acquisition, args.source_dir)
    args.out.mkdir(parents=True)
    panels = []
    if not errors:
        features = {f['id']: f for f in review['features']}
        panels = [render_panel(p, features, sources, args.out) for p in review['panels']]
    report = {'schemaVersion': 1, 'groundId': review['groundId'], 'geographicApproval': False,
              'runtime': {'python': sys.version.split()[0], 'pillow': pillow_version},
              'reviewSha256': sha(args.review), 'acquisitionSha256': sha(args.acquisition),
              'attribution': acquisition.get('attribution'), 'terms': acquisition.get('terms'),
              'status': 'blocked' if errors else 'prepared-awaiting-review', 'errors': errors, 'panels': panels,
              'rawImageryRedistribution': 'not authorized by this command; outputs stay local'}
    (args.out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'report': str(args.out/'report.json'), 'errors': len(errors), 'panels': len(panels)}))
    return 1 if errors or any(p['status'] == 'missing-source-coverage' for p in panels) else 0


if __name__ == '__main__':
    raise SystemExit(main())
