"""Export georeferenced RGB review images to an access-controlled artifact.

The original RGBI TIFF hash, exact pixel-edge grid and capture date accompany
each full-resolution JPEG. No imagery is committed or shipped in the app.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def export(cache, output):
    plan = json.loads((cache / 'plan.json').read_text())
    acquired = json.loads((cache / 'acquisition.json').read_text())
    if acquired['state'] != 'acquired-for-review' or acquired['planSha256'] != sha(cache / 'plan.json'):
        raise ValueError('A complete, bound acquisition is required')
    output.mkdir(parents=True, exist_ok=True)
    index = dict(schemaVersion=1, groundId='visby', crs='EPSG:3006',
        attribution='Ortofoto Nedladdning ©Lantmäteriet, CC BY 4.0; RGB extracts converted to JPEG for review.',
        terms='https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf',
        sourcePlanSha256=acquired['planSha256'], sourceCommit=acquired['sourceCommit'],
        use='Source-image review for the requested golf-course mapping; not a runtime texture.', images=[])
    for record in acquired['windows']:
        file = cache / record['rasterFile']
        if file.parent != cache or sha(file) != record['sha256']:
            raise ValueError('Source image checksum mismatch')
        with rasterio.open(file) as src:
            if (src.crs.to_epsg() != 3006 or src.count != 4 or
                    not np.allclose(src.transform.to_gdal(), record['geoTransform'], atol=1e-8, rtol=0)):
                raise ValueError('Source review grid mismatch')
            rgb = src.read([1, 2, 3])
            if rgb.dtype != np.uint8:
                raise ValueError('Expected unscaled byte RGB')
        target = output / (record['id'] + '.jpg')
        Image.fromarray(rgb.transpose(1, 2, 0)).save(target, quality=95, subsampling=0)
        index['images'].append(dict(id=record['id'], file=target.name, sha256=sha(target),
            sourceRasterSha256=record['sha256'], boundsEpsg3006=record['boundsEpsg3006'],
            geoTransform=record['geoTransform'], width=record['width'], height=record['height'],
            sources=record['sources'], validFraction=record['validFraction']))
    (output / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
    (output / 'ATTRIBUTION.txt').write_text(index['attribution'] + '\n' + index['terms'] + '\n')
    print(json.dumps({'reviewImages':len(index['images']), 'sourcePlanSha256':index['sourcePlanSha256']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('visbybuild/cache/lm-ortho'))
    parser.add_argument('--out', type=Path, default=Path('visbybuild/cache/lm-review'))
    args = parser.parse_args()
    export(args.cache, args.out)
