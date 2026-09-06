#!/usr/bin/env python3
"""Render accepted Stora surface and tee changes as a shareable vector comparison.

No source imagery is embedded. North is up, axes are local metres and each panel
has an equal horizontal/vertical scale. Usage: python geobuild/render-stora-followup.py
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams.update({'font.family': 'DejaVu Sans', 'svg.fonttype': 'none', 'svg.hashsalt': 'stora-followup-v1'})
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Patch
from matplotlib.lines import Line2D
from matplotlib.ticker import MaxNLocator
import numpy as np

def main():
    root = Path(__file__).resolve().parent.parent
    mapping = root / 'upsalabuild/mapping'
    surface = json.loads((mapping/'stora-surfaces-2025.json').read_text())
    tees = json.loads((mapping/'stora-tees-followup-2026-09-06.json').read_text())
    panels = []
    for f in surface['features']:
        old = f['originalShape']
        panels.append((f"Hole {f['hole']:02} | {f['kind']}", old.get('rings', [old.get('ring')]), f['rings']))
    for f in tees['features']:
        h = next(h for h in tees['holes'] if h['hole'] == f['hole'])
        old = [h['originalPads'][i]['ring'] for i in h['retireOriginalPadIndices']]
        panels.append((f"Hole {f['hole']:02} | tee ({f['observedYear']} archive)", old, [f['ring']]))
    fig, axes = plt.subplots(5, 4, figsize=(15, 20), facecolor='#f8f8f3')
    for ax, (title, old, new) in zip(axes.flat, panels):
        for rings, colour, face, style in [(new, '#237346', '#bfd9bd', '-'), (old, '#ad7658', 'none', '--')]:
            for ring in rings:
                ax.add_patch(Polygon(np.asarray(ring)*[1, -1], closed=True, facecolor=face, edgecolor=colour, linestyle=style, linewidth=1))
        points = np.concatenate([np.asarray(r)*[1, -1] for r in old+new])
        lo, hi = points.min(axis=0), points.max(axis=0)
        centre = (lo+hi)/2; span = max(max(hi-lo)*1.15, 15)
        ax.set_xlim(centre[0]-span/2, centre[0]+span/2)
        ax.set_ylim(centre[1]-span/2, centre[1]+span/2)
        ax.set_aspect('equal'); ax.set_title(title, fontsize=10, loc='left')
        ax.grid(color='#dddddd', linewidth=.4)
        ax.tick_params(labelsize=7)
        ax.xaxis.set_major_locator(MaxNLocator(3)); ax.yaxis.set_major_locator(MaxNLocator(3))
    for ax in list(axes.flat)[len(panels):]:
        ax.axis('off')
    fig.suptitle('Upsala Stora | continued mapping review', fontsize=20, x=.055, ha='left', y=.98)
    fig.text(.055, .955, '12 fairways, hole 16 green and 4 tee outlines | North up | Axes in metres; panel scales vary', fontsize=11)
    fig.legend(handles=[Patch(facecolor='#bfd9bd', edgecolor='#237346', label='Accepted outline'), Line2D([], [], color='#ad7658', linestyle='--', label='Replaced outline')], loc='upper right', bbox_to_anchor=(.95, .945), frameon=False)
    fig.text(.055, .018, 'Manual image interpretation, not a complete survey. Boundary uncertainty: 1 m green; 2–2.5 m tees; 3–4 m fairways.\nAbsolute source accuracy is unknown. Archive years identify municipal services; exact flight dates are unknown. See the accompanying evidence JSON.', fontsize=10)
    fig.subplots_adjust(left=.055, right=.96, top=.915, bottom=.065, hspace=.35, wspace=.28)
    for extension in ['svg', 'png']:
        output = mapping/f'stora-followup-review.{extension}'
        fig.savefig(output, dpi=130, metadata={'Date': None} if extension=='svg' else None)
        if extension == 'svg':
            output.write_text('\n'.join(line.rstrip() for line in output.read_text().splitlines())+'\n')
    plt.close(fig)

if __name__ == '__main__':
    main()
