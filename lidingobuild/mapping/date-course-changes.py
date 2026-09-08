"""Date the course changes the club reports, by looking at them in every capture.

The club's course council records work that postdates the imagery this build was
mapped from. A dated statement is one record; a capture that shows the ground
before and after is another, and the two together are what this repository asks
for before geometry is adopted.

Three captures now span 2018-2025 over this course at 0.16 m, so a feature can
be BRACKETED: absent in one and present in the next dates its construction to
between them. That is also the only way to tell a completed work from a
proposal, which the club's own documents mix - the masterplan and the
development schedule both draw things that may or may not have been built.

  python3 lidingobuild/mapping/date-course-changes.py [--sheets]

--sheets writes side-by-side crops to the ignored cache for the eyeball. The
report is what is committed; the pixels are not.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'lidingobuild/cache/change-dating'
to3011 = Transformer.from_crs(3006, 3011, always_xy=True)

CAPTURES = [
    ('municipal-2018', 'geo_data/course-v2/lidingo/discovery/municipal-ortho-2018-native.json', 3011),
    ('municipal-2019', 'geo_data/course-v2/lidingo/discovery/municipal-ortho-2019-native.json', 3011),
    ('lm-2025-05-31', 'geo_data/course-v2/lidingo/discovery/lm-ortofoto-0p16.json', 3006),
]

# The sites the club's own dated record names, at the coordinates the detector
# or the survey puts them. A site is listed here because a CLUB DOCUMENT says
# something was built, not because a pixel looked interesting.
SITES = [
    {'id': 'hole-13-green-bunker', 'easting': 677284.9, 'northing': 6586779.9,
     'clubRecord': 'course-council page: a new LEFT GREEN BUNKER on hole 13, among the works reported by 2025',
     'modelState': 'hole 13 carries ZERO bunkers'},
    {'id': 'hole-17-green-bunker', 'mappedBunkerIndex': 10,
     'clubRecord': 'September 2024 report: a new hole-17 GREEN BUNKER',
     'modelState': "the model's one ring on this green reads sand in 2025 and turf in 2019"},
]

# A site the model already has a ring for is read at THAT ring's centroid, not
# at a coordinate typed here. The first draft guessed hole 17's and sampled 30 m
# of fairway, which read as no sand in every capture and would have been
# recorded as a refusal of the club's own statement.
_surfaces = json.loads((ROOT / 'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))
_bunkers = [f for f in _surfaces['features'] if f['properties']['kind'] == 'bunker']
for _site in SITES:
    if 'mappedBunkerIndex' not in _site:
        continue
    _ring = (_bunkers[_site['mappedBunkerIndex']]['geometry']['coordinates'][0]
             if _bunkers[_site['mappedBunkerIndex']]['geometry']['type'] == 'Polygon'
             else _bunkers[_site['mappedBunkerIndex']]['geometry']['coordinates'][0][0])
    # about the first vertex: on raw EPSG:3006 a shoelace centroid about the
    # coordinate origin lands a median 20 m from small rings like these
    _ox, _oy = _ring[0][0], _ring[0][1]
    _a = _cx = _cy = 0.0
    for _i in range(len(_ring) - 1):
        _x0, _y0 = _ring[_i][0] - _ox, _ring[_i][1] - _oy
        _x1, _y1 = _ring[_i + 1][0] - _ox, _ring[_i + 1][1] - _oy
        _cr = _x0 * _y1 - _x1 * _y0
        _a += _cr; _cx += (_x0 + _x1) * _cr; _cy += (_y0 + _y1) * _cr
    _site['easting'] = round(_ox + _cx / (3 * _a), 2)
    _site['northing'] = round(_oy + _cy / (3 * _a), 2)


def load(path, crs):
    meta = json.loads((ROOT / path).read_text())
    return {'image': np.asarray(Image.open(ROOT / meta['path']).convert('RGB')),
            'world': [float(x) for x in (ROOT / meta['worldfilePath']).read_text().split()],
            'crs': crs, 'meta': meta}


def pixel(src, easting, northing):
    e, n = (to3011.transform(easting, northing) if src['crs'] == 3011 else (easting, northing))
    w = src['world']
    return (np.asarray(e) - w[4]) / w[0], (np.asarray(n) - w[5]) / w[3]


def disc(src, easting, northing, radius=3.0, step=0.2):
    """The colour of a small disc, which is what a bunker's interior is."""
    g = np.arange(-radius, radius + step / 2, step)
    dx, dy = np.meshgrid(g, g)
    keep = dx * dx + dy * dy <= radius * radius
    c, r = pixel(src, easting + dx[keep], northing + dy[keep])
    c = np.clip(np.round(c).astype(np.int32), 0, src['image'].shape[1] - 1)
    r = np.clip(np.round(r).astype(np.int32), 0, src['image'].shape[0] - 1)
    px = src['image'][r, c].astype(np.float32)
    R, G, B = px[:, 0], px[:, 1], px[:, 2]
    return {'medianLuminance': round(float(np.median(0.299 * R + 0.587 * G + 0.114 * B)), 1),
            'medianExcessGreen': round(float(np.median(2 * G - R - B)), 1),
            'medianRedOverGreen': round(float(np.median(R / np.maximum(G, 1))), 3)}


def turf_reference(src, sites, radius=3.0):
    """Each capture is exposed differently, so 'bright' means nothing on its own.
    The reference is mown turf 12 m from the same site in the same frame."""
    rows = []
    for site in sites:
        for angle in (0, np.pi / 2, np.pi, 3 * np.pi / 2):
            rows.append(disc(src, site['easting'] + 12 * np.cos(angle),
                             site['northing'] + 12 * np.sin(angle), radius))
    return {'medianLuminance': round(float(np.median([r['medianLuminance'] for r in rows])), 1),
            'medianExcessGreen': round(float(np.median([r['medianExcessGreen'] for r in rows])), 1)}


sources = [(name, load(path, crs)) for name, path, crs in CAPTURES]
report = {'schemaVersion': 1, 'measuredOn': '2026-09-08', 'state': 'measurement-evidence-only',
          'generator': 'lidingobuild/mapping/date-course-changes.py',
          'method': ('a club document says something was built; three orthophotos spanning 2018-2025 say whether the '
                     'ground shows it, and between which two captures it appeared. Sand is read against MOWN TURF '
                     '12 m away IN THE SAME FRAME, because each capture is exposed differently and "bright" means '
                     'nothing on its own.'),
          'captures': [{'id': name, 'season': src['meta'].get('season'),
                        'captureDate': src['meta'].get('captureDate'),
                        'sampleSpacingMetres': src['meta'].get('sampleSpacingMetres'),
                        'licence': src['meta']['licence']['id']} for name, src in sources],
          'sites': []}

for site in SITES:
    row = {k: site[k] for k in ('id', 'clubRecord', 'modelState')}
    row['easting'] = site['easting']
    row['northing'] = site['northing']
    row['captures'] = {}
    for name, src in sources:
        here = disc(src, site['easting'], site['northing'])
        turf = turf_reference(src, [site])
        here['turfReferenceLuminance'] = turf['medianLuminance']
        here['luminanceAboveTurf'] = round(here['medianLuminance'] - turf['medianLuminance'], 1)
        # sand is what stands well clear of its own frame's turf and is not green
        here['readsAsSand'] = bool(here['luminanceAboveTurf'] >= 25 and here['medianExcessGreen'] <= 25)
        row['captures'][name] = here
    order = [name for name, _ in sources]
    seen = [row['captures'][n]['readsAsSand'] for n in order]
    if not any(seen):
        row['verdict'] = 'no sand in any capture'
    elif all(seen):
        row['verdict'] = f'sand in every capture back to {order[0]}: older than this evidence can date'
    else:
        first = order[seen.index(True)]
        previous = order[seen.index(True) - 1]
        row['verdict'] = f'built between {previous} and {first}'
    report['sites'].append(row)

(ROOT / 'lidingobuild/mapping/change-dating.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
for row in report['sites']:
    print(f"{row['id']:26} {row['verdict']}")
    for name, v in row['captures'].items():
        print(f"    {name:16} lum {v['medianLuminance']:6.1f} ({v['luminanceAboveTurf']:+6.1f} vs turf)"
              f"  ExG {v['medianExcessGreen']:6.1f}  sand={v['readsAsSand']}")
print('wrote lidingobuild/mapping/change-dating.json')

if '--sheets' in sys.argv:
    OUT.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        panels = []
        for name, src in sources:
            cx, cy = pixel(src, site['easting'], site['northing'])
            half = 40 / src['meta']['sampleSpacingMetres']
            crop = Image.fromarray(src['image']).crop(
                (int(cx - half), int(cy - half), int(cx + half), int(cy + half))).resize((440, 440), Image.LANCZOS)
            panels.append((name, crop))
        sheet = Image.new('RGB', (440 * len(panels), 462), '#111')
        draw = ImageDraw.Draw(sheet)
        for index, (name, crop) in enumerate(panels):
            sheet.paste(crop, (index * 440, 22))
            draw.text((index * 440 + 6, 5), name, fill='white')
            draw.ellipse((index * 440 + 220 - 34, 22 + 220 - 34, index * 440 + 220 + 34, 22 + 220 + 34),
                         outline=(255, 0, 255), width=2)
        sheet.save(OUT / f"{site['id']}.png")
    print(f'wrote {len(SITES)} sheets to {OUT.relative_to(ROOT)}')
