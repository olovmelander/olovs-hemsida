"""Acquire three bounded native 2026 roof review windows; keep pixels private."""
from pathlib import Path
import argparse, hashlib, json, os, sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'visbybuild/mapping'))
from lm_ortho import authorization, acquire_window, probe_sources


def main():
    import rasterio
    from PIL import Image
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', type=Path)
    args = parser.parse_args()
    if args.env_file:
        for line in args.env_file.read_text(encoding='utf-8-sig').splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() in ['LANTMATERIET_USERNAME', 'LANTMATERIET_PASSWORD']:
                os.environ.setdefault(key.strip(), value.strip().strip('\"\''))
    discovery = json.loads((ROOT / 'geo_data/course-v2/tortuna/acquisition/d2-discovery.json').read_text())['orthophoto']
    if discovery['collection'] != 'orto-n2-2026':
        raise ValueError('Expected pinned 2026 campaign')
    plan = dict(resolutionMetres=.16, sources=[dict(id=i['id'], href=i['assets']['data']['href'],
        width=15625, height=15625, boundsEpsg3006=i['projBbox'], capturedAt=i['capturedAt']) for i in discovery['items']])
    auth = authorization()
    access = probe_sources([dict(id=i['id'], href=i['assets']['data']['href'], bytes=i['assets']['data']['bytes']) for i in discovery['items']], auth)
    if not access['authorized']:
        raise ValueError('Native source access unavailable')
    cache = ROOT / 'tortunabuild/cache/buildings'
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    for name, west, south, size in [('service-yard', 597280, 6615104, 256), ('nearby-houses', 597584, 6614896, 128)]:
        window = dict(id=name, boundsEpsg3006=[west, south, west+size, south+size],
            width=round(size/.16), height=round(size/.16), sourceIds=[i['id'] for i in plan['sources']])
        ledger = acquire_window(plan, window, cache, auth)
        with rasterio.open(cache / (name+'.tif')) as src:
            Image.fromarray(src.read([1, 2, 3]).transpose(1, 2, 0)).save(cache / (name+'.png'))
        records.append(ledger)
        print(json.dumps(dict(window=name, state='retained-native-crop')), flush=True)
    output = dict(schemaVersion=1, groundId='tortuna', state='native-building-review-windows-retained',
        collection=discovery['collection'], access=access, windows=records,
        rawImageryRedistributed=False, attribution='Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.')
    (ROOT / 'tortunabuild/mapping/building-orthophoto-acquisition.json').write_text(json.dumps(output, indent=2)+'\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps(dict(state='failed', errorType=type(exc).__name__)), file=sys.stderr)
        raise SystemExit(1)
