#!/usr/bin/env python3
"""Naturvårdsverket's tree-species map (NMD2023 tilläggsskikt trädslag), cut to every ground in one pass.

What it is: for each 10 m cell of forest land in Sweden, an indication from 0 to 100 that "should correspond to
crown cover in per cent" of pine (tall), spruce (gran), larch (lärk, part of pine), ordinary broadleaf (triviallöv:
birch, aspen, alder) and noble broadleaf (ädellöv), split into beech (bok) and oak and other noble broadleaf
(ek/övrigt ädel). 255 is not forest land. A last layer marks cells whose species call is uncertain (all shares 0
there). Mapped from Sentinel-2 time series of 2021-2023 (product description v1.1, 2026-02-24).

What it is good for here: the mix of species in the woodland round a course. What it is not: a species for a single
tree. The product description says the risk of a wrong species is large for solitary trees, sparse forest and
small patches of forest, which is most of a course's own trees, and park trees are mostly not forest land at all.
Each tree's own evidence decides; this map sets the odds where trees stand in a wood.

How it is read. The map is published only as one nationwide zip, and six of its nine layers keep their TIFF
directory at the end of the file, so no window can be read without passing through the whole layer. Each layer
needed is streamed once from the zip (one HTTP range request for its compressed bytes), inflated to a temporary
file, cut for every ground, and deleted before the next. Every layer used is read, none derived: the shares do not
add up to 100 as the product description's normalisation suggests (in 7-15% of forest cells pine and spruce alone
reach 100 with noble broadleaf on top), so ordinary broadleaf cannot be taken as the rest. Contorta is not read: no
ground lies in its range of use here, and the runtime draws no lodgepole pine.

Licence CC0 ("Ange gärna 'NMD, Naturvårdsverket' som källa"). The windows are small and free to redistribute, so
they are kept in git: geo_data/course-v2/<ground>/vegetation/nmd2023-tradslag.tif (one band a layer, named) with
its source record beside it.

    pixi run --manifest-path packages/course-geo/toolchain/pixi.toml -e mapping --frozen python \
        tools/tree-pipeline/forest-species-map.py [--grounds bro-hof,visby] [--half 2560] [--temp <dir>]

One heavy job: about six gigabytes of transfer, a few of temporary disk, little CPU. Run it alone.
"""
import argparse
import hashlib
import json
import os
import struct
import tempfile
import time
import urllib.request
import zlib
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[2]
ZIP_URL = 'https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/NMD2023_Tradslag_v1_1.zip'
DESCRIPTION_URL = 'https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/NMD2023_Produktbeskrivning_till%c3%a4gsskikt_Tr%c3%a4dslag.pdf'
READ = ['tall', 'gran', 'lark', 'trivial', 'adel', 'bok', 'ekovradel', 'osakerklassning']
BANDS = ['tall', 'gran', 'lark', 'trivial', 'adel', 'bok', 'ekovradel', 'osakerklassning']
AGENT = {'User-Agent': 'course-geo-toolchain'}


def grounds():
    """Every published ground with its origin in EPSG:3006, from the published ground manifests."""
    public = ROOT / 'apps/golf/public'
    seen = {}
    for course in json.loads((public / 'courses/v2-index.json').read_text(encoding='utf-8'))['courses']:
        if course['groundId'] in seen:
            continue
        manifest = json.loads((public / course['manifest']['url']).read_text(encoding='utf-8'))
        ground = json.loads((public / manifest['groundManifest']['url']).read_text(encoding='utf-8'))
        origin = ground['frame']['origin']
        seen[course['groundId']] = (origin['easting'], origin['northing'])
    return seen


def get(start, end):
    req = urllib.request.Request(ZIP_URL, headers={**AGENT, 'Range': f'bytes={start}-{end}'})
    return urllib.request.urlopen(req, timeout=120)


def central_directory():
    """The zip's members from its central directory: name -> (local header offset, compressed size, size, crc, method)."""
    head = urllib.request.urlopen(urllib.request.Request(ZIP_URL, method='HEAD', headers=AGENT), timeout=60)
    size = int(head.headers['Content-Length'])
    tail = get(max(0, size - 65536), size - 1).read()
    i = tail.rfind(b'PK\x06\x06')  # zip64 end of central directory
    if i >= 0:
        cd_size, cd_offset = struct.unpack('<QQ', tail[i + 40:i + 56])
    else:
        i = tail.rfind(b'PK\x05\x06')
        cd_size, cd_offset = struct.unpack('<II', tail[i + 12:i + 20])
    cd = get(cd_offset, cd_offset + cd_size - 1).read()
    members, p = {}, 0
    while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        method, crc, csize, usize = struct.unpack('<H', cd[p + 10:p + 12])[0], *struct.unpack('<III', cd[p + 16:p + 28])
        nlen, elen, clen = struct.unpack('<HHH', cd[p + 28:p + 34])
        offset = struct.unpack('<I', cd[p + 42:p + 46])[0]
        name = cd[p + 46:p + 46 + nlen].decode('utf-8', 'replace')
        extra, q = cd[p + 46 + nlen:p + 46 + nlen + elen], 0
        while q + 4 <= len(extra):  # zip64 sizes and offset
            tag, length = struct.unpack('<HH', extra[q:q + 4])
            if tag == 1:
                fields, r = [], q + 4
                for present in (usize == 0xFFFFFFFF, csize == 0xFFFFFFFF, offset == 0xFFFFFFFF):
                    if present:
                        fields.append(struct.unpack('<Q', extra[r:r + 8])[0])
                        r += 8
                it = iter(fields)
                usize = next(it) if usize == 0xFFFFFFFF else usize
                csize = next(it) if csize == 0xFFFFFFFF else csize
                offset = next(it) if offset == 0xFFFFFFFF else offset
            q += 4 + length
        members[name] = (offset, csize, usize, crc, method)
        p += 46 + nlen + elen + clen
    identity = dict(url=ZIP_URL, bytes=size, lastModified=head.headers.get('Last-Modified'), etag=head.headers.get('ETag'))
    return members, identity


def inflate_member(member, target):
    """Stream one member's compressed bytes in a single request and inflate them to `target`; check size and CRC."""
    offset, csize, usize, crc, method = member
    local = get(offset, offset + 29).read()
    nlen, elen = struct.unpack('<HH', local[26:30])
    start = offset + 30 + nlen + elen
    response = get(start, start + csize - 1)
    inflater = zlib.decompressobj(-15) if method == 8 else None
    written, check = 0, 0
    with open(target, 'wb') as out:
        while chunk := response.read(8 << 20):
            data = inflater.decompress(chunk) if inflater else chunk
            out.write(data)
            written += len(data)
            check = zlib.crc32(data, check)
        if inflater:
            tail = inflater.flush()
            out.write(tail)
            written += len(tail)
            check = zlib.crc32(tail, check)
    if written != usize or (check & 0xFFFFFFFF) != crc:
        raise SystemExit(f'{target.name}: {written} bytes, CRC {check & 0xFFFFFFFF:08x}; expected {usize}, {crc:08x}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--grounds', default='', help='comma-separated ground ids (default: every published ground)')
    ap.add_argument('--half', type=float, default=2560.0, help='metres from the ground origin to the window edge')
    ap.add_argument('--temp', type=Path, help='where to inflate one layer at a time and keep the windows cut so far, so a stopped run resumes (a few GB; default: the system temporary folder)')
    args = ap.parse_args()
    wanted = [g for g in args.grounds.split(',') if g]
    origins = {g: o for g, o in grounds().items() if not wanted or g in wanted}
    if not origins:
        raise SystemExit('no such ground')
    members, identity = central_directory()
    names = {layer: next(n for n in members if n.lower() == f'nmd2023_tradslag_{layer}_v1_1.tif') for layer in READ}
    windows = {}
    temp = (args.temp or Path(tempfile.gettempdir())) / f"nmd-{identity['etag'] or identity['bytes']}".replace('"', '')
    temp.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps([sorted(origins.items()), args.half]).encode()).hexdigest()[:12]
    for layer in READ:
        started = time.time()
        done = temp / f'windows-{layer}-{key}.npz'
        if not done.exists():
            local = temp / names[layer]
            inflate_member(members[names[layer]], local)
            cut = {}
            with rasterio.open(local) as src:
                for ground, (e, n) in origins.items():
                    box = (e - args.half, n - args.half, e + args.half, n + args.half)
                    window = from_bounds(*box, transform=src.transform).round_offsets().round_lengths()
                    cut[ground] = src.read(1, window=window, boundless=True, fill_value=255)
                    cut[f'{ground}__transform'] = np.array(tuple(src.window_transform(window))[:6])
            np.savez_compressed(done, **cut)
            local.unlink()
            print(f'{layer:16} {members[names[layer]][1] / 1e9:5.2f} GB in {time.time() - started:5.0f} s', flush=True)
        saved = np.load(done)
        for ground in origins:
            t = saved[f'{ground}__transform']
            w = windows.setdefault(ground, {'transform': rasterio.Affine(*t), 'crs': rasterio.crs.CRS.from_epsg(3006), 'bands': {}})
            w['bands'][layer] = saved[ground]
    summary = []
    for ground, w in windows.items():
        b = w['bands']
        forest = b['tall'] != 255
        stack = np.stack([b[name] for name in BANDS]).astype(np.uint8)
        folder = ROOT / 'geo_data/course-v2' / ground / 'vegetation'
        folder.mkdir(parents=True, exist_ok=True)
        tif = folder / 'nmd2023-tradslag.tif'
        profile = dict(driver='GTiff', width=stack.shape[2], height=stack.shape[1], count=len(BANDS), dtype='uint8', crs=w['crs'], transform=w['transform'],
                       nodata=255, compress='deflate', predictor=2)
        with rasterio.open(tif, 'w', **profile) as dst:
            dst.write(stack)
            for i, name in enumerate(BANDS, 1):
                dst.set_band_description(i, name)
        t = w['transform']
        record = dict(schemaVersion=1, kind='forest-species-map', groundId=ground, product='NMD2023 tilläggsskikt trädslag', version='1.1',
                      producer='Naturvårdsverket (Metria, SLU)', licence='CC0-1.0', attribution='NMD, Naturvårdsverket', descriptionUrl=DESCRIPTION_URL,
                      sourceZip=identity, read={layer: names[layer] for layer in READ},
                      imagery='Sentinel-2 time series 2021-2023',
                      meaning='0-100 indication that should correspond to crown cover in per cent; 255 is not forest land. Pine includes larch. '
                              'osakerklassning: 1 where the species call is uncertain (every share is 0 there). Pine, spruce, broadleaf and noble broadleaf '
                              'add up to 100 in a typical cell, but to as much as 140 where noble broadleaf grows: use the shares relative to each other.',
                      limits='The product description: the risk of a wrong species is large for solitary trees, sparse forest and small forest patches; '
                             'young dense or very wet ordinary broadleaf can read as noble broadleaf; thinned spruce can read as pine.',
                      crs='EPSG:3006', cellMetres=10, window=dict(easting=[t.c, t.c + 10 * stack.shape[2]], northing=[t.f - 10 * stack.shape[1], t.f]),
                      bands=BANDS, forestCells=int(forest.sum()), cells=int(forest.size), extractedOn=date.today().isoformat(),
                      tool='tools/tree-pipeline/forest-species-map.py', sha256=hashlib.sha256(tif.read_bytes()).hexdigest())
        (folder / 'nmd2023-tradslag.json').write_text(json.dumps(record, indent=1, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
        means = {name: round(float(stack[i][forest].mean()), 1) if forest.any() else None for i, name in enumerate(BANDS[:-1])}
        summary.append(dict(ground=ground, forestShare=round(float(forest.mean()), 3), meanCover=means))
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
