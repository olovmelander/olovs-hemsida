#!/usr/bin/env python3
"""Render the source-only vector comparison for the reviewed par3/Sahara changes.

No source photographs are embedded or redistributed. The base model supplies
unchanged green, tee, bunker and road context; the dated evidence supplies the
retired fairway claims and the newly traced sand boundary.
"""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from pyproj import Transformer


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', type=Path, default=Path('upsalabuild'))
    p.add_argument('--evidence', type=Path, default=Path('upsalabuild/mapping/stora-par3-sahara-review-2026-09-07.json'))
    p.add_argument('--out', type=Path, default=Path('upsalabuild/mapping/stora-par3-sahara-review'))
    args = p.parse_args()
    model = json.loads((args.build/'course-model.json').read_text(encoding='utf-8'))
    evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
    assert evidence['frame'] == {k: model[k] for k in ['origin', 'mPerLat', 'mPerLon']}
    assert len(evidence['features']) == 4 and all(f['status'] == 'accepted' for f in evidence['features'])
    transformer = Transformer.from_crs('EPSG:3006', 'EPSG:4326', always_xy=True)

    def local(e, n):
        lon, lat = transformer.transform(e, n)
        return ((lon-model['origin']['lon'])*model['mPerLon'], (model['origin']['lat']-lat)*model['mPerLat'])

    fig, axes = plt.subplots(2, 2, figsize=(12, 12), facecolor='#f5f3eb')
    fig.suptitle('Upsala Stora: par3 surface review and Sahara', fontsize=18, fontweight='bold', y=.97)
    fig.text(.5, .938, '2025 orthophoto geometry | 2024 visual crosscheck | reviewed 7 September 2026', ha='center', fontsize=10)
    captions = {
        2: 'Retire 2,653 m² coarse claim across path and rough',
        6: 'Retire 5,704 m² coarse claim across path and grass',
        14: 'Retire 1,151 m² coarse claim across trees and sand',
        8: 'Add 85.98 m² observed Sahara sand footprint',
    }
    for ax, feature in zip(axes.flat, evidence['features']):
        e0, n0, e1, n1 = feature['sourcePanels'][0]['extentEPSG3006']
        corners = [local(e, n) for e, n in [(e0, n0), (e1, n0), (e0, n1), (e1, n1)]]
        xs, zs = zip(*corners)
        ax.set_xlim(min(xs), max(xs)); ax.set_ylim(max(zs), min(zs)); ax.set_aspect('equal')
        ax.set_facecolor('#f0eee3')
        for h in model['holes']:
            ax.add_patch(Polygon(h['green']['ring'], facecolor='#b9d6b0', edgecolor='#34714a', lw=.8))
            for pad in h['tees'].get('pads', []):
                ax.add_patch(Polygon(pad['ring'], facecolor='#fbfaf2', edgecolor='#6e8069', lw=.8))
            for bunker in h.get('bunkers', []):
                ax.add_patch(Polygon(bunker['ring'], facecolor='#e8dca8', edgecolor='#a69355', lw=.8))
        for kind in ['roads', 'paths', 'tracks']:
            for road in model['infra'].get(kind, []):
                if road.get('line'):
                    x, z = zip(*road['line']); ax.plot(x, z, color='#a3a5a1', lw=1.3)
        for water in model.get('water', []):
            ax.add_patch(Polygon(water['ring'], facecolor='#c0d9e5', edgecolor='#749eb1', lw=.7))
        if feature['action'] == 'retire':
            for ring in feature['originalShape']['rings']:
                ax.add_patch(Polygon(ring, facecolor='none', edgecolor='#a75067', lw=1.7, hatch='//'))
            for observation in feature['observations']:
                ax.plot(*observation['localPoint'], marker='x', color='#922b43', ms=7)
        else:
            for ring in feature['rings']:
                ax.add_patch(Polygon(ring, facecolor='#efcd69', edgecolor='#a36710', lw=1.8))
        scale = 10 if e1-e0 < 110 else 25
        x, z = min(xs)+(max(xs)-min(xs))*.07, max(zs)-(max(zs)-min(zs))*.07
        ax.plot([x, x+scale], [z, z], color='#39473e', lw=3)
        ax.text(x+scale/2, z-(max(zs)-min(zs))*.025, f'{scale} m', ha='center', va='bottom', fontsize=9)
        ax.annotate('N', xy=(.94, .94), xytext=(.94, .84), xycoords='axes fraction', ha='center', arrowprops={'arrowstyle': '-|>', 'color':'#39473e'}, fontsize=9)
        ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f'Hole {feature["hole"]}\n{captions[feature["hole"]]}', fontsize=11, loc='left', pad=10)
        for spine in ax.spines.values(): spine.set_edgecolor('#d5d1c2')
    fig.subplots_adjust(left=.035, right=.965, bottom=.09, top=.89, hspace=.17, wspace=.08)
    fig.text(.04, .05, 'Hatched rose: retired fairway claim. Gold: added sand. Crosses: reviewed non-fairway observations.', fontsize=10)
    fig.text(.04, .029, 'Background colour is neutral context. No replacement rough boundary, survey accuracy, bunker depth or full census is asserted.', fontsize=9)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for ext in ['svg', 'png']:
        fig.savefig(args.out.with_suffix('.'+ext), dpi=160, facecolor=fig.get_facecolor())
    svg = args.out.with_suffix('.svg')
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)
    print(f'Vector comparison and PNG: {args.out}')


if __name__ == '__main__':
    main()
