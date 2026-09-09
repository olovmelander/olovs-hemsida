"""Vector-only comparison of reviewed tee reference corrections; no source imagery."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[1]
read = lambda path: json.loads((ROOT / path).read_text(encoding='utf-8'))
models = {'stora': read('upsalabuild/course-model.json'),
          'mellan': read('upsalamellanbuild/course-model.json')}
reviews = {}
for part in ['front9', 'back9', 'mellan']:
    review = read(f'upsalabuild/mapping/lm-tee-review-{part}-2026-09-09.json')
    for record in review['holes']:
        reviews[(review['course'], record['hole'])] = record

fig, axes = plt.subplots(3, 2, figsize=(12, 15), constrained_layout=True)
for ax, (course, number) in zip(axes.flat, [('stora', 1), ('stora', 4), ('stora', 11),
                                         ('stora', 18), ('mellan', 3), ('mellan', 4)]):
    hole = next(h for h in models[course]['holes'] if h['n'] == number)
    record = reviews[(course, number)]
    for pad in hole['tees']['pads']:
        ring = pad['ring'] + pad['ring'][:1]
        ax.fill(*zip(*ring), color='#d4ead4', edgecolor='#23783a', linewidth=1.2)
    moved = 0
    for decision in record['referenceDecisions']:
        i = decision['markIndex']
        old, new = record['originalMarks'][i]['c'], hole['tees']['marks'][i]['c']
        if old != new:
            moved += 1
            ax.plot(*old, marker='x', color='#b8433c', markersize=7)
            ax.annotate('', xy=new, xytext=old,
                        arrowprops={'arrowstyle': '->', 'color': '#b8433c', 'lw': 1})
        if decision['status'] == 'align-to-observed-pad':
            ax.plot(*new, marker='o', color='#155b99', markersize=4)
        else:
            ax.plot(*new, marker='x', color='#777777', markersize=5)
    ax.set_title(f'{"Stora" if course == "stora" else "Mellan"} hole {number} · {moved} references moved')
    ax.set_aspect('equal')
    ax.invert_yaxis()
    ax.margins(.12)
    ax.grid(alpha=.2)
    ax.set_xlabel('Local east (m)')
    ax.set_ylabel('Local south (m)')
fig.suptitle('Upsala tee navigation alignment · 9 September 2026\n'
             'Photographed platforms retained; references moved only through explicit associations', fontsize=14)
fig.legend(handles=[Line2D([0], [0], color='#23783a', label='Physical platform'),
                    Line2D([0], [0], marker='x', color='#b8433c', linestyle='', label='Previous position'),
                    Line2D([0], [0], marker='o', color='#155b99', linestyle='', label='Reviewed platform reference'),
                    Line2D([0], [0], marker='x', color='#777777', linestyle='', label='Unresolved reference retained')],
           loc='outside lower center', ncol=2)
out = ROOT / 'upsalabuild/mapping/lm-tee-reference-changes-2026-09-09.svg'
fig.savefig(out)
fig.savefig(ROOT / 'upsalabuild/cache/lm-tee-reference-changes-2026-09-09.png', dpi=110)
print(out)
