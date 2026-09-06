#!/usr/bin/env python3
"""Render geographic tee changes from reviewed vector evidence, without imagery.

Usage (no source acquisition):
  python geobuild/render-tee-review.py --build upsalabuild \
    --evidence upsalabuild/mapping/stora-tees-01-06-2025.json \
    --evidence upsalabuild/mapping/stora-tees-07-12-2025.json \
    --evidence upsalabuild/mapping/stora-tees-13-18-2025.json \
    --out upsalabuild/mapping/stora-tee-review.svg

Writes both SVG and PNG with the supplied output stem. Local [x,z] is drawn as
[x,-z], preserving every source vertex with north up and equal metre scales.
Panel scales vary. Daily tee markers and scorecard colours are not inferred.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams.update({
    'font.family': 'DejaVu Sans', 'svg.fonttype': 'none',
    'svg.hashsalt': 'geographic-tee-review-v1',
})
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Polygon
from matplotlib.ticker import MaxNLocator
import numpy as np

BACKGROUND = '#f8f8f3'
INK = '#253d3a'
MUTED = '#64736d'
OLD = '#ad7658'
NEW = '#237346'
REVIEWED = '#41835f'
PROVISIONAL = '#787e7a'


def read_evidence(paths):
    holes, features, frame, digests = {}, {}, None, []
    for path in paths:
        raw = path.read_bytes()
        data = json.loads(raw)
        if data.get('schemaVersion') != 1:
            raise ValueError(f'{path}: expected evidence schemaVersion 1')
        if frame is not None and data['frame'] != frame:
            raise ValueError(f'{path}: source local frame differs from other evidence')
        frame = data['frame']
        digests.append({'path': path.as_posix(), 'sha256': hashlib.sha256(raw).hexdigest()})
        for hole in data['holes']:
            number = hole['hole']
            if number in holes:
                raise ValueError(f'{path}: duplicate hole {number}')
            originals = hole['originalPads']
            retained = hole.get('retainOriginalPadIndices', [])
            retired = hole.get('retireOriginalPadIndices', [])
            if sorted(retained + retired) != list(range(len(originals))):
                raise ValueError(f'{path}: hole {number} must partition every original pad')
            holes[number] = hole
        for feature in data['features']:
            if feature.get('status') != 'accepted':
                continue
            if feature['id'] in features:
                raise ValueError(f'{path}: duplicate accepted feature {feature["id"]}')
            features[feature['id']] = feature
    if len(holes) != 18 or sorted(holes) != list(range(1, 19)):
        raise ValueError('The review sheet requires exactly holes 1–18')
    for feature in features.values():
        if feature['hole'] not in holes:
            raise ValueError(f'Accepted feature has no reviewed hole: {feature["id"]}')
    return holes, list(features.values()), frame, digests


def geographic_ring(ring):
    points = np.asarray(ring, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3 or not np.isfinite(points).all():
        raise ValueError('Every displayed ring must contain finite local [x,z] vertices')
    return points * [1, -1]


def previously_reviewed(pad):
    return pad.get('prov') in ('dated-orthophoto-trace', 'ortho-trace')


def draw_ring(axis, ring, *, face='none', edge=NEW, width=1.1, style='-', hatch=None, z=3):
    axis.add_patch(Polygon(geographic_ring(ring), closed=True, facecolor=face,
                           edgecolor=edge, linewidth=width, linestyle=style,
                           hatch=hatch, zorder=z))


def scale_length(target):
    power = 10 ** math.floor(math.log10(target))
    return max(v * power for v in (1, 2, 5) if v * power <= target) if target / power >= 1 else power / 2


def draw_panel(axis, hole, accepted, aspect):
    originals = hole['originalPads']
    retained_indices = hole.get('retainOriginalPadIndices', [])
    retained = [originals[i] for i in retained_indices]
    rings = [pad['ring'] for pad in originals] + [feature['ring'] for feature in accepted]
    points = np.concatenate([geographic_ring(ring) for ring in rings])
    lower, upper = points.min(axis=0), points.max(axis=0)
    centre = (lower + upper) / 2
    span = np.maximum(upper - lower, 12) * 1.35 + 8
    span[0] = max(span[0], span[1] * aspect)
    span[1] = span[0] / aspect
    axis.set_xlim(centre[0] - span[0] / 2, centre[0] + span[0] / 2)
    axis.set_ylim(centre[1] - span[1] / 2, centre[1] + span[1] / 2)
    axis.set_aspect('equal', adjustable='box')
    axis.set_facecolor('#ffffff')
    axis.grid(True, color='#e5e9e3', linewidth=.45, zorder=0)
    axis.xaxis.set_major_locator(MaxNLocator(nbins=4))
    axis.yaxis.set_major_locator(MaxNLocator(nbins=3))
    axis.tick_params(axis='both', colors=MUTED, labelsize=6.3, length=0, pad=3)
    for spine in axis.spines.values():
        spine.set_edgecolor('#ccd5cd')
        spine.set_linewidth(.55)

    for index in retained_indices:
        pad = originals[index]
        reviewed = previously_reviewed(pad)
        draw_ring(axis, pad['ring'], face='#e3efe4' if reviewed else '#e0e2df',
                  edge=REVIEWED if reviewed else PROVISIONAL, hatch='///' if reviewed else None,
                  width=1, z=2)
    for feature in accepted:
        draw_ring(axis, feature['ring'], face='#bfd9bd', edge=NEW, z=3)
    for pad in originals:
        draw_ring(axis, pad['ring'], edge=OLD, width=.8, style=(0, (3, 2)), z=4)

    kept_reviewed = sum(previously_reviewed(pad) for pad in retained)
    kept_provisional = len(retained) - kept_reviewed
    axis.text(0, 1.15, f'Hole {hole["hole"]:02d}', transform=axis.transAxes,
              color=INK, fontsize=10.3, fontweight='bold', va='bottom')
    axis.text(1, 1.15, f'{len(accepted)} new · {len(retained)} kept', transform=axis.transAxes,
              color=INK, fontsize=8.4, ha='right', va='bottom')
    status = 'Complete visible review' if hole['coverage'] == 'complete-visible' else 'Partial review'
    detail = f'{len(originals)} original'
    if kept_provisional:
        detail += f' · {kept_provisional} provisional kept'
    elif kept_reviewed:
        detail += f' · {kept_reviewed} reviewed kept'
    axis.text(0, 1.04, detail, transform=axis.transAxes, color=MUTED, fontsize=7.2, va='bottom')
    axis.text(1, 1.04, status, transform=axis.transAxes, color=MUTED, fontsize=7.2,
              ha='right', va='bottom')

    axis.annotate('N', xy=(.95, .95), xytext=(.95, .79), xycoords='axes fraction',
                  ha='center', va='center', fontsize=7.3, color=INK,
                  arrowprops={'arrowstyle': '-|>', 'lw': .7, 'color': INK}, zorder=8)
    length = scale_length(span[0] * .18)
    left, bottom = centre - span / 2
    x, y = left + span[0] * .06, bottom + span[1] * .09
    axis.plot([x, x + length], [y, y], color=INK, linewidth=1.35, zorder=8)
    axis.plot([x, x], [y - span[1] * .015, y + span[1] * .015], color=INK, linewidth=.8, zorder=8)
    axis.plot([x + length, x + length], [y - span[1] * .015, y + span[1] * .015], color=INK, linewidth=.8, zorder=8)
    axis.text(x + length / 2, y + span[1] * .025, f'{length:g} m', color=INK,
              ha='center', fontsize=7, zorder=8,
              bbox={'facecolor': 'white', 'edgecolor': 'none', 'pad': 1, 'alpha': .85})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--build', required=True, type=Path)
    parser.add_argument('--evidence', action='append', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--title', help='Course label; defaults to Upsala Stora for upsalabuild, otherwise the build name')
    args = parser.parse_args()
    model = json.loads((args.build / 'course-model.json').read_text())
    holes, features, frame, digests = read_evidence(args.evidence)
    model_frame = {key: model[key] for key in ('origin', 'mPerLat', 'mPerLon')}
    if frame != model_frame:
        raise ValueError('Evidence local frame differs from the selected build')
    original_count = sum(len(h['originalPads']) for h in holes.values())
    retained = [h['originalPads'][i] for h in holes.values() for i in h.get('retainOriginalPadIndices', [])]
    reviewed_count = sum(previously_reviewed(pad) for pad in retained)
    provisional_count = len(retained) - reviewed_count
    partial_count = sum(h['coverage'] != 'complete-visible' for h in holes.values())

    fig, axes = plt.subplots(6, 3, figsize=(12.8, 18.5), facecolor=BACKGROUND)
    fig.subplots_adjust(left=.052, right=.974, top=.857, bottom=.070, hspace=.49, wspace=.17)
    for axis, number in zip(axes.flat, range(1, 19)):
        position = axis.get_position()
        aspect = position.width * 12.8 / (position.height * 18.5)
        draw_panel(axis, holes[number], [f for f in features if f['hole'] == number], aspect)

    course_label = args.title or ('UPSALA GK / STORA BANAN' if args.build.name == 'upsalabuild' else args.build.name)
    fig.text(.052, .969, course_label, color=MUTED, fontsize=10, fontweight='bold')
    fig.text(.052, .941, 'Tee platforms: geographic before / after', color=INK, fontsize=22, fontweight='bold')
    fig.text(.052, .920,
             f'{original_count} original pads · {len(features)} newly traced platforms · '
             f'{reviewed_count} reviewed and {provisional_count} provisional pads retained',
             color=INK, fontsize=10)
    fig.text(.052, .902,
             '2025 outlines checked against 2024 orthophotos. Absolute source accuracy is unreported.',
             color=MUTED, fontsize=9.4)
    legend = [
        Line2D([0], [0], color=OLD, linewidth=1.2, linestyle=(0, (3, 2)), label='Original outline'),
        Patch(facecolor='#bfd9bd', edgecolor=NEW, label='New dated trace'),
        Patch(facecolor='#e3efe4', edgecolor=REVIEWED, hatch='///', label='Reviewed trace retained'),
        Patch(facecolor='#e0e2df', edgecolor=PROVISIONAL, label='Provisional pad retained'),
    ]
    fig.legend(handles=legend, loc='upper left', bbox_to_anchor=(.047, .892), ncol=4,
               frameon=False, fontsize=9, handlelength=2, columnspacing=2.1)
    fig.text(.052, .034,
             'North is up. Every outline preserves its source vertices. Each panel has an independent metre scale.',
             fontsize=9, color=INK)
    fig.text(.052, .019,
             f'{partial_count} partial reviews retain explicit gaps or uncertainty. No scorecard tee colours or daily marker positions are assigned.',
             fontsize=9, color=MUTED)
    stem = args.out.with_suffix('')
    stem.parent.mkdir(parents=True, exist_ok=True)
    description = json.dumps({'build': args.build.as_posix(), 'evidence': digests,
                              'frame': frame, 'imageryYears': [2024, 2025],
                              'absoluteHorizontalAccuracyMetres': None}, sort_keys=True)
    svg_path, png_path = stem.with_suffix('.svg'), stem.with_suffix('.png')
    fig.savefig(svg_path, metadata={'Date': None, 'Description': description}, facecolor=BACKGROUND)
    svg_path.write_text('\n'.join(line.rstrip() for line in svg_path.read_text().splitlines()) + '\n')
    fig.savefig(png_path, dpi=160, metadata={'Description': description}, facecolor=BACKGROUND)
    plt.close(fig)
    print(json.dumps({'holes': len(holes), 'newTraces': len(features),
                      'reviewedRetained': reviewed_count, 'provisionalRetained': provisional_count,
                      'svg': svg_path.as_posix(), 'png': png_path.as_posix()}))


if __name__ == '__main__':
    main()
