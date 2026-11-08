#!/usr/bin/env python3
"""Each mapped building's roof colour, read off Lantmäteriet's orthophoto (8 November).

The owner asked whether the houses' real colours can be found from Lantmäteriet's
maps or photographs. Roofs can: the 16 cm orthophoto looks down on every roof in
a course's extract. Walls cannot -- an orthophoto shows them edge-on -- so the
walls keep the painted palette (engine/house-kit.mjs).

    python geobuild/facilities/roof-colours.py --env-file .env --course veckefjarden --collection 2024_U2
    python geobuild/facilities/roof-colours.py --env-file .env --course puttom
    python geobuild/facilities/roof-colours.py --env-file .env --course angso
    python geobuild/facilities/roof-colours.py --env-file .env --course upsala

needs numpy and rasterio. It finds the 2.5 km tiles under the course's buildings
and reads small windows of them over HTTPS (the same authenticated, redirect-free
access as lm-ortho-acquire.py), from the newest flight that has each tile, or from
`--collection` when it is pinned; no pixels are written anywhere. The output is one
colour per building: the whole review record in geobuild/facilities/roof-colours/
<name>.json, and the runtime file apps/golf/src/engine/scenery/<name>-roof-colours.json
(each coloured roof as [index, ringCheck, colour]; the name is the course's scenery
module, `--name`), each tied to its footprint by a checksum the player verifies
before using it.

For each footprint:
- its ring to SWEREF 99 TM: shifted from the pack's own origin on the newer grounds,
  through WGS84 from the older grounds' spherical metres;
- registered to the photograph: traced footprints can sit a metre or three off
  their roofs, so the course is shifted (within 4 m) to where the most of its
  footprints lie on open roof rather than lawn or canopy -- only when that clearly
  beats no shift (3 points of open roof per footprint);
- the pixels inside it, shrunk by a metre (a 5 m roof leans up to a metre off its
  footprint in a frame-camera orthophoto, and the eaves overhang the walls);
- leaves out vegetation (NDVI from the near-infrared band: an overhanging crown),
  the darkest and brightest twentieth (shadow, chimneys, glints, snow guards),
  so both slopes of a pitched roof count;
- the median of what remains, in sRGB, with the count of pixels it rests on.
A roof with fewer than 30 pixels left, under a quarter of its pixels kept, a
clearly green median or more than 60% canopy is recorded without a colour.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import struct
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HREF = 'https://dl1.lantmateriet.se/bild/data/orto/se0_16m_sweref/{collection}/o{n}_{e}_25_mr{yy}.tif'
# newest first: a tile is read from the first flight that has it
COLLECTIONS = ['2026_U2', '2026_O2', '2025_U2', '2025_O2', '2024_U2', '2024_O2', '2023_U2', '2023_O2', '2022_U2', '2022_O2']
TILE = 2500
# how far a course's footprints may sit off their roofs in the photograph
# a gain under GAIN (the mean share of open roof per footprint) leaves the footprints where they are
SEARCH, GAIN = 4.0, 0.03


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Source redirects are not accepted')


def ring_check(ring):
    """The player's footprint check (house-kit.mjs ringCheck): FNV-1a over the ring's JSON."""
    h = 0x811c9dc5
    for b in json.dumps(ring, separators=(',', ':')).encode():
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}'


def read_pack(pack):
    buf = pack.read_bytes()
    assert buf[:4] == b'GPK1'
    hlen = struct.unpack_from('<I', buf, 4)[0]
    header = json.loads(buf[8:8 + hlen])
    o = 8 + hlen + header['HF0']['bytes'] + header['HF1']['bytes']
    vec = json.loads(zlib.decompress(buf[o:o + header['VEC']['bytes']], -15))
    return header, vec


def credentials(env_file):
    if env_file:
        for line in Path(env_file).read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                if k.strip().startswith('LANTMATERIET_'):
                    os.environ.setdefault(k.strip(), v.strip().strip('"\''))
    token = os.environ.get('LANTMATERIET_BEARER_TOKEN')
    if token:
        return 'Bearer ' + token
    return 'Basic ' + base64.b64encode((os.environ['LANTMATERIET_USERNAME'] + ':' + os.environ['LANTMATERIET_PASSWORD']).encode()).decode()


def tile_href(key, collection):
    n, e = key
    return HREF.format(collection=collection, n=n // 100, e=e // 100, yy=collection[2:4])


def find_tile(key, auth, collections):
    """The first flight that serves this tile: a 16-byte ranged read of its TIFF header."""
    opener = urllib.request.build_opener(NoRedirect())
    for collection in collections:
        href = tile_href(key, collection)
        request = urllib.request.Request(href, headers={'Authorization': auth, 'Range': 'bytes=0-15'})
        try:
            with opener.open(request, timeout=25) as response:
                if response.status == 206 and response.read(17)[:4] in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+'):
                    return collection, href
        except urllib.error.HTTPError as exc:
            exc.close()
        except Exception:
            pass
    return None, None


def write_outputs(name, out):
    """Two files: the whole review record (every building, what was read and why it was or was not
    coloured) beside this script, and the runtime file the player imports -- each coloured roof as
    [index, ringCheck, colour], with the source and its licence."""
    review_file = ROOT / 'geobuild/facilities/roof-colours' / f'{name}.json'
    runtime_file = ROOT / 'apps/golf/src/engine/scenery' / f'{name}-roof-colours.json'
    review_file.parent.mkdir(parents=True, exist_ok=True)
    records = out['buildings']
    # one building a line: the review record is read by people
    head = json.dumps({k: v for k, v in out.items() if k != 'buildings'}, indent=1, ensure_ascii=False)[:-2]
    lines = ',\n'.join('  ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in records)
    review_file.write_text(head + ',\n "buildings": [\n' + lines + '\n ]\n}\n', encoding='utf-8', newline='\n')
    runtime = {'schemaVersion': 2, 'groundId': out['groundId'], 'kind': 'roof-colours',
               'source': {'collection': out['source']['collection'], 'attribution': out['source']['attribution']},
               'packSha256': out['packSha256'], 'review': str(review_file.relative_to(ROOT)).replace('\\', '/')}
    roofs = [[r['index'], r['ringCheck'], r['roof']] for r in records if r.get('roof')]
    head = json.dumps(runtime, indent=1, ensure_ascii=False)[:-2]
    rows = ',\n'.join('  ' + json.dumps(r, separators=(',', ':')) for r in roofs)
    runtime_file.write_text(head + ',\n "roofs": [\n' + rows + '\n ]\n}\n', encoding='utf-8', newline='\n')
    return review_file, runtime_file


def main():
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from rasterio.warp import transform as warp
    from rasterio.windows import from_bounds

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--course', default='veckefjarden', help='the course whose pack holds the footprints')
    parser.add_argument('--name', help='the scenery module the colours belong to (default: the course)')
    parser.add_argument('--collection', help='pin one flight, e.g. 2024_U2, instead of the newest per tile')
    args = parser.parse_args()
    pack = ROOT / 'apps/golf/public/courses' / args.course / 'pack.bin'
    auth = credentials(args.env_file)
    header, vec = read_pack(pack)
    origin, m_lon, m_lat = header['GEO']['origin'], header['GEO']['mPerLon'], 111320.0
    buildings = vec['infra']['buildings']
    # Two frames: the newer grounds are SWEREF 99 TM itself, shifted to an origin (their frame says so);
    # the older ones are metres about a WGS84 origin on a sphere
    shifted = re.search(r'EPSG:3006.*origin E([\d.]+) N([\d.]+)', header['GEO'].get('frame') or '')
    sweref = []
    for b in buildings:
        ring = b['ring']
        if shifted:
            e0, n0 = float(shifted[1]), float(shifted[2])
            es, ns = [e0 + x for x, _ in ring], [n0 - z for _, z in ring]
        else:
            es, ns = warp('EPSG:4326', 'EPSG:3006', [origin['lon'] + x / m_lon for x, _ in ring], [origin['lat'] - z / m_lat for _, z in ring])
        sweref.append((es, ns))
    keys = sorted({(TILE * int(sum(ns) / len(ns) // TILE), TILE * int(sum(es) / len(es) // TILE)) for es, ns in sweref})
    # the flights this ground's own discovery records name (a block's letter differs by region), newest first
    known = set()
    for f in (ROOT / 'geo_data/course-v2' / (args.name or args.course)).rglob('*.json'):
        known.update(re.findall(r'se0_16m_sweref/(\d{4}_[A-Z]\d)/', f.read_text(encoding='utf-8', errors='ignore')))
    collections = [args.collection] if args.collection else sorted(known | set(COLLECTIONS), key=lambda c: (-int(c[:4]), c))
    env = dict(GDAL_HTTP_HEADERS='Authorization: ' + auth, GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
               CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='45', GDAL_HTTP_MAX_RETRY='2',
               CPL_CURL_VERBOSE=False, CPL_DEBUG=False, GDAL_HTTP_NETRC='NO', GDAL_HTTP_MULTIRANGE='YES',
               GDAL_HTTP_AUTH_HEADER_ALLOWED_IF_REDIRECT='IF_SAME_HOST')
    records, assets = [], []
    with rasterio.Env(**env):
        datasets = {}
        for key in keys:
            collection, href = find_tile(key, auth, collections)
            if not href:
                continue
            src = rasterio.open('/vsicurl/' + href)
            assert src.crs.to_epsg() == 3006 and src.count == 4 and abs(src.res[0] - 0.16) < 1e-9
            datasets[key] = src
            assets.append({'id': href.rsplit('/', 1)[1][:-4], 'collection': collection})
        # Pass 1: each footprint's window, its outline, and how well the outline meets the photograph's
        # edges at every shift within SEARCH metres (the mean luminance gradient under the outline)
        R = int(round(SEARCH / 0.16)) // 2 * 2
        shifts = range(-R, R + 1, 2)
        prepared = []
        for index, (b, (es, ns)) in enumerate(zip(buildings, sweref)):
            ring = b['ring']
            cx, cy = sum(es) / len(es), sum(ns) / len(ns)
            key = (TILE * int(cy // TILE), TILE * int(cx // TILE))
            record = {'index': index, 'ringCheck': ring_check(ring), 'kind': b.get('kind')}
            src = datasets.get(key)
            pad = SEARCH + 2
            if src is None or min(es) - pad < src.bounds.left or max(es) + pad > src.bounds.right or min(ns) - pad < src.bounds.bottom or max(ns) + pad > src.bounds.top:
                record['roof'] = None; record['reason'] = 'outside one source tile'
                prepared.append((record, None)); continue
            window = from_bounds(min(es) - pad, min(ns) - pad, max(es) + pad, max(ns) + pad, src.transform).round_offsets().round_lengths()
            pix = src.read(window=window)
            wt = src.window_transform(window)
            shape = [{'type': 'Polygon', 'coordinates': [list(zip(es, ns)) + [(es[0], ns[0])]]}]
            mask = rasterize(shape, out_shape=pix.shape[1:], transform=wt, fill=0, default_value=1, dtype='uint8').astype(bool)
            # the footprint shrunk by a metre, at most 2000 of its pixels (every k-th)
            core = mask.copy()
            for _ in range(6):
                m = core.copy()
                m[1:, :] &= core[:-1, :]; m[:-1, :] &= core[1:, :]; m[:, 1:] &= core[:, :-1]; m[:, :-1] &= core[:, 1:]
                core = m
            ys, xs = np.nonzero(core)
            if len(ys) > 2000:
                k = len(ys) // 2000 + 1
                ys, xs = ys[::k], xs[::k]
            red, nir = pix[0].astype(np.float32), pix[3].astype(np.float32)
            open_ground = (nir - red) / np.maximum(nir + red, 1) < 0.18
            h, w = open_ground.shape
            score = np.zeros((len(shifts), len(shifts)), np.float32)
            if len(ys):
                for i, dy in enumerate(shifts):
                    for j, dx in enumerate(shifts):
                        yy, xx = ys + dy, xs + dx
                        ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
                        score[i, j] = open_ground[yy[ok], xx[ok]].mean() if ok.any() else 0
            prepared.append((record, (pix, mask, score)))
        # the course's own shift: where, summed over every building, the most of the footprints lies on
        # open roof rather than lawn or canopy; taken only when it clearly beats leaving them where they are
        scored = [d[2] for _, d in prepared if d is not None]
        total = sum(scored) if scored else np.zeros((len(shifts), len(shifts)), np.float32)
        c = len(shifts) // 2
        gi, gj = np.unravel_index(int(np.argmax(total)), total.shape)
        gain = float(total[gi, gj] - total[c, c]) / max(len(scored), 1)
        accepted = gain >= GAIN
        if not accepted:
            gi = gj = c
        offset = (shifts[gj] * 0.16, -shifts[gi] * 0.16)
        # Pass 2: each roof at the course's shift, sampled
        for record, data in prepared:
            if data is None:
                records.append(record); continue
            pix, mask, score = data
            dy, dx = shifts[gi], shifts[gj]
            mask = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
            # shrink by about a metre: six 16 cm pixels
            for _ in range(6):
                m = mask.copy()
                m[1:, :] &= mask[:-1, :]; m[:-1, :] &= mask[1:, :]; m[:, 1:] &= mask[:, :-1]; m[:, :-1] &= mask[:, 1:]
                mask = m
            total_px = int(mask.sum())
            r, g, bl, nir = (pix[i][mask].astype(np.float32) for i in range(4))
            if total_px < 30:
                record.update(roof=None, pixels=total_px, reason='too small'); records.append(record); continue
            ndvi = (nir - r) / np.maximum(nir + r, 1)
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl
            keep = ndvi < 0.18
            if keep.sum() >= 30:
                lo, hi = np.percentile(luma[keep], [5, 95])
                keep &= (luma >= lo) & (luma <= hi)
            kept = int(keep.sum())
            record.update(pixels=total_px, kept=kept, vegetation=round(float((ndvi >= 0.18).mean()), 3))
            if kept < 30 or kept < total_px * 0.25:
                record.update(roof=None, reason='too little open roof'); records.append(record); continue
            rgb = [int(round(float(np.median(c[keep])))) for c in (r, g, bl)]
            # a roof is not green: a footprint whose building has gone, or a hut under its trees,
            # gives the ground or the canopy's shade -- kept for review, not given to the player
            if (rgb[1] - rgb[0] >= 6 and rgb[1] - rgb[2] >= 10) or record['vegetation'] > 0.6:
                record.update(roof=None, sampled='#%02x%02x%02x' % tuple(rgb), reason='looks like ground or canopy')
                records.append(record); continue
            record['roof'] = '#%02x%02x%02x' % tuple(rgb)
            record['spread'] = round(float(np.median(np.abs(luma[keep] - np.median(luma[keep])))), 1)
            records.append(record)
        for src in datasets.values():
            src.close()
    years = sorted({a['collection'][:4] for a in assets})
    out = {
        'schemaVersion': 1, 'groundId': args.name or args.course, 'kind': 'roof-colours-from-orthophoto',
        'source': {'collection': 'orto-' + '+'.join(years), 'resolutionMetres': 0.16, 'horizontalCrs': 'EPSG:3006',
                   'assets': [a['id'] for a in assets] if args.collection else assets,
                   'attribution': 'Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.'},
        'method': 'Footprints registered to the photograph: the one shift for the course, within 4 m, under which the most of every footprint (shrunk by 1 m) lies on open roof (NDVI < 0.18), taken only when it gains at least 3 points over no shift. Then the median sRGB of the footprint shrunk by 1 m, leaving out NDVI >= 0.18 (overhanging crowns) and the darkest and brightest 5% of what remains. Pixels are read in place and never stored.',
        'registration': {'searchMetres': SEARCH, 'offsetMetres': [round(offset[0], 2), round(offset[1], 2)], 'axes': 'east, north',
                         'openRoofGain': round(gain, 3), 'accepted': bool(accepted), 'acceptAbove': GAIN},
        'packSha256': hashlib.sha256(pack.read_bytes()).hexdigest(),
        'buildings': records,
    }
    if args.collection:
        out['source']['collection'] = f'orto-u2-{args.collection[:4]}' if args.collection.endswith('U2') else f'orto-{args.collection.lower()}'
    review_file, runtime_file = write_outputs(args.name or args.course, out)
    got = sum(1 for r in records if r.get('roof'))
    print(json.dumps({'course': args.course, 'buildings': len(records), 'coloured': got, 'tiles': [a['id'] for a in assets], 'review': str(review_file.relative_to(ROOT)), 'runtime': str(runtime_file.relative_to(ROOT))}))


if __name__ == '__main__':
    main()
