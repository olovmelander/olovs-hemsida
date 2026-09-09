"""Render accepted vector differences without redistributing source imagery."""
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from shapely.geometry import Polygon
from shapely.ops import unary_union

root = Path(__file__).resolve().parents[1]
features = []
for part in ['front9', 'back9', 'mellan']:
    review = json.loads((root/f'upsalabuild/mapping/lm-review-{part}-2026-09-09.json').read_text(encoding='utf-8'))
    features.extend((part, f) for f in review['features'])
columns = 4
rows = math.ceil(len(features)/columns)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'svg.fonttype': 'none'})
fig, axes = plt.subplots(rows, columns, figsize=(13, rows*3.3), squeeze=False)
for ax, (part, f) in zip(axes.flat, features):
    before = [f['originalShape']['ring']] + [s['ring'] for s in f.get('originalMergedShapes', [])]
    after = f['ring']
    center = Polygon(after).centroid
    for ring in before:
        closed = ring+[ring[0]]
        ax.plot([p[0]-center.x for p in closed], [-p[1]+center.y for p in closed], color='#c66c24', linestyle='--', linewidth=1.3)
    closed = after+[after[0]]
    ax.fill([p[0]-center.x for p in closed], [-p[1]+center.y for p in closed], color='#008b83', alpha=.12)
    ax.plot([p[0]-center.x for p in closed], [-p[1]+center.y for p in closed], color='#008b83', linewidth=1.6)
    old = unary_union([Polygon(r) for r in before])
    course = 'Mellan' if part == 'mellan' else 'Stora'
    title = f"{course} H{f['hole']} · {f['kind']}\n{old.area:.0f} → {Polygon(after).area:.0f} m²"
    ax.set_title(title, loc='left', fontweight='bold')
    ax.set_aspect('equal', adjustable='datalim')
    ax.grid(alpha=.18)
    ax.set_xlabel('East (m)')
    ax.set_ylabel('North (m)')
    ax.margins(.16)
for ax in list(axes.flat)[len(features):]:
    ax.axis('off')
fig.suptitle('Upsala · accepted orthophoto boundary corrections', fontsize=17, fontweight='bold', y=.995)
fig.legend([Line2D([0],[0],color='#c66c24',linestyle='--'),Line2D([0],[0],color='#008b83')], ['Previous boundary','Reviewed 14 June 2025 imagery'],loc='upper center',bbox_to_anchor=(.5,.97),ncol=2,frameon=False)
fig.text(.5,.009,'North up. Equal metre scales within each panel; scales differ between panels. Image interpretation, not surveyed boundaries.',ha='center',fontsize=9)
fig.tight_layout(rect=(0,.025,1,.94))
target=root/'upsalabuild/mapping/lm-boundary-changes-2026-09-09.svg'
fig.savefig(target)
preview = root/'upsalabuild/cache/lm-boundary-changes-2026-09-09.png'
preview.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(preview, dpi=140)
print(target)
