"""Plot source comparisons without adopting imagery geometry or publishing pixels."""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
meta = json.loads((ROOT / 'geo_data/course-v2/visby/reference/gotland-ortho-2022.json').read_text(encoding='utf-8'))
image = np.asarray(Image.open(ROOT / meta['image']['path']))
bounds = meta['bboxEpsg3006']
points = np.asarray(json.loads((ROOT / 'visbybuild/cache/vegetation/review/stand-samples.json').read_text()))
scenes = [('Clubhouse / range', [687000,6370550,687750,6371300]),
          ('Northern forest / links', [687200,6371300,688000,6372100]),
          ('Eastern course / facilities', [687750,6370600,688550,6371400])]
figure, axes = plt.subplots(2,3,figsize=(16,10),layout='constrained')
for column,(title,view) in enumerate(scenes):
    for row in range(2):
        ax=axes[row,column]
        ax.imshow(image,extent=[bounds[0],bounds[2],bounds[1],bounds[3]],origin='upper')
        ax.set_xlim(view[0],view[2]);ax.set_ylim(view[1],view[3]);ax.set_aspect('equal')
        ax.tick_params(labelsize=6)
    axes[0,column].set_title(title+' — municipal 2022',fontsize=11)
    selected=(points[:,0]>=view[0])&(points[:,0]<=view[2])&(points[:,1]>=view[1])&(points[:,1]<=view[3])
    axes[1,column].scatter(points[selected,0],points[selected,1],s=2,c=points[selected,3],cmap='autumn',vmin=2,vmax=25,alpha=.8)
    axes[1,column].set_title('2024 laser: eligible 4 m stand-cell centres',fontsize=10)
figure.suptitle('Visby source comparison: different capture years; dots are area-field centres, not observed stems',fontsize=13)
destination=ROOT/'visbybuild/cache/vegetation/review/stand-source-panels.png'
figure.savefig(destination,dpi=140);plt.close(figure)
print(destination)
