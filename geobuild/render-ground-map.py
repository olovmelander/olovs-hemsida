#!/usr/bin/env python3
"""Plot exported map vectors without inventing or smoothing geographic geometry.
python geobuild/render-ground-map.py --source upsalabuild/mapping/ground-map.geojson --out upsalabuild/mapping/overview.svg
"""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams.update({'font.family': 'DejaVu Sans', 'svg.fonttype': 'none', 'svg.hashsalt': 'upsala-ground-map-v1'})
import matplotlib.pyplot as plt
from matplotlib.patches import PathPatch, Circle, Rectangle, Patch
from matplotlib.path import Path as MplPath
from matplotlib.collections import PatchCollection
from matplotlib.lines import Line2D
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--source', required=True)
p.add_argument('--out', required=True)
args = p.parse_args()
source = Path(args.source)
raw = source.read_bytes()
data = json.loads(raw)
features = data['features']
frame = data['metadata']['modelSources'][0]['localFrame']
origin = frame['origin']
def xy(coordinate):
    return [(coordinate[0] - origin['lon']) * frame['mPerLon'],
            (coordinate[1] - origin['lat']) * frame['mPerLat']]
def kind(f): return f['properties']['featureKind']
routes = [f for f in features if kind(f) == 'playing-route']
route_points = np.array([xy(c) for f in routes for c in f['geometry']['coordinates']])
xmin, ymin = route_points.min(axis=0) - [140, 145]
xmax, ymax = route_points.max(axis=0) + [140, 130]
limits = (xmin, xmax, ymin, ymax)

bg = '#faf9f4'
navy = '#24485e'
orange = '#a64c28'
colors = {
    'forest': ('#d9e3d4', '#a7b8a1', .24, 1),
    'wood': ('#d1dec9', '#a7b8a1', .24, 1),
    'scrub': ('#e8e8d4', '#c1c1a4', .2, 1),
    'wetland': ('#e0e7d8', '#9eae9a', .3, 1),
    'grass': ('#e7eacb', '#bbc1a2', .25, 2),
    'fairway': ('#c0d39d', '#859d66', .3, 3),
    'driving-range': ('#c4d1a3', '#788d5e', .5, 3),
    'green': ('#608b5c', '#42693f', .35, 5),
    'practice_green': ('#4d8052', '#315834', .5, 6),
    'tee-platform': ('#92b278', '#648452', .35, 4),
    'tee': ('#92b278', '#648452', .35, 4),
    'bunker': ('#f3df9b', '#bd9f58', .4, 6),
    'range_bunker': ('#f3df9b', '#bd9f58', .5, 6),
    'practice_bunker': ('#f3df9b', '#bd9f58', .5, 6),
    'range_mat': ('#345c4a', '#254536', .3, 8),
    'footbridge': ('#a88b68', '#705c43', .5, 8),
    'range_tee_pad': ('#9b978f', '#625f59', .5, 6),
    'range_target_surface': ('#f4f1e7', '#938c76', .7, 6),
    'non_turf_island': ('#ece7d4', '#756e5f', .5, 7),
    'water': ('#afd4df', '#659cac', .5, 5),
    'parking': ('#dad5cd', '#aaa396', .4, 3),
    'buildings': ('#a79b8d', '#71695e', .5, 7),
    'building-context-box': ('#c5bbb1', '#94897b', .3, 3),
}

def bounds_of(g):
    c = g['coordinates']
    if g['type'] == 'Polygon': c = [p for ring in c for p in ring]
    elif g['type'] == 'Point': c = [c]
    points = np.array([xy(p) for p in c])
    return (*points.min(axis=0), *points.max(axis=0))
def visible(f, bounds):
    xa, ya, xb, yb = bounds_of(f['geometry'])
    lo_x, hi_x, lo_y, hi_y = bounds
    return xb >= lo_x and xa <= hi_x and yb >= lo_y and ya <= hi_y
def polygon_path(rings):
    vertices, codes = [], []
    for ring in rings:
        points = [xy(p) for p in ring]
        vertices.extend(points)
        codes.extend([MplPath.MOVETO] + [MplPath.LINETO] * (len(points) - 2) + [MplPath.CLOSEPOLY])
    return MplPath(vertices, codes)

fig = plt.figure(figsize=(14.5, 10.2), facecolor=bg)
ax = fig.add_axes([.035, .205, .716, .68], facecolor=bg)
detail = fig.add_axes([.772, .407, .205, .355], facecolor=bg)

def plot_ground(axis, bounds, show_routes=False, detail_view=False):
    plotted = [f for f in features if visible(f, bounds)]
    for f in plotted:
        k, g = kind(f), f['geometry']
        if g['type'] == 'Polygon' and k in colors:
            fill, edge, width, z = colors[k]
            axis.add_patch(PathPatch(polygon_path(g['coordinates']), facecolor=fill,
                edgecolor=edge, linewidth=width * (1.25 if detail_view else 1), zorder=z))
    crowns = [f for f in plotted if kind(f) == 'tree-crown-candidate']
    circles = [Circle(xy(f['geometry']['coordinates']), f['properties']['radiusMetres']) for f in crowns]
    axis.add_collection(PatchCollection(circles, facecolor='#72945e', edgecolor='#48673e',
        linewidth=.15, alpha=.38, zorder=4))
    for f in plotted:
        k, g = kind(f), f['geometry']
        if g['type'] == 'LineString' and k in ['waterway', 'roads', 'tracks', 'paths']:
            points = np.array([xy(p) for p in g['coordinates']])
            if k == 'waterway': color, width, z, style = '#679ea9', .55, 5, '-'
            elif k == 'roads': color, width, z, style = '#9a938a', 1.8, 3, '-'
            else: color, width, z, style = '#9d958a', .5, 6, ':'
            axis.plot(points[:, 0], points[:, 1], color=color, linewidth=width,
                linestyle=style, zorder=z)
        if k == 'tree-osm-point':
            x, y = xy(g['coordinates'])
            axis.plot(x, y, 'x', color='#406737', markersize=2.4, markeredgewidth=.45, zorder=8)
    if show_routes:
        for f in routes:
            occurrence = f['properties']['occurrences'][0]
            mellan = 'mellan' in occurrence['build']
            points = np.array([xy(p) for p in f['geometry']['coordinates']])
            color = orange if mellan else navy
            axis.plot(points[:, 0], points[:, 1], color=color, alpha=.67,
                linewidth=.72, linestyle=(0, (4, 3)), zorder=9)
            axis.plot(*points[0], marker='s', markersize=2.3, color=color, zorder=10)
            x, y = points[-1]
            label = f"{'M' if mellan else 'S'}{occurrence['hole']}"
            offsets = {'S1':(11,-2), 'S2':(8,5), 'S3':(9,0), 'S4':(-10,8),
                'S5':(10,4), 'S6':(-10,-4), 'S7':(-10,2), 'S8':(-14,-6),
                'S9':(5,-9), 'S10':(11,3), 'S11':(-8,9), 'S12':(-9,5),
                'S13':(8,-6), 'S14':(12,9), 'S15':(-9,-4), 'S16':(9,3),
                'S17':(10,-5), 'S18':(-9,-4), 'M1':(8,8), 'M2':(9,7),
                'M3':(9,1), 'M4':(7,-8), 'M5':(8,-5), 'M6':(9,-5),
                'M7':(10,2), 'M8':(-10,-6), 'M9':(-6,9)}
            axis.plot(x,y,marker='o',markersize=2.5,color=color,zorder=11)
            axis.annotate(label, xy=(x,y), xytext=offsets.get(label,(9,5)),
                textcoords='offset points', ha='center',va='center',fontsize=8,
                fontweight='bold',color=color,zorder=13,
                bbox=dict(boxstyle='round,pad=.19',facecolor=bg,edgecolor=color,linewidth=.45,alpha=.96),
                arrowprops=dict(arrowstyle='-',color=color,linewidth=.4,shrinkA=3,shrinkB=1))
    axis.set_xlim(bounds[:2]); axis.set_ylim(bounds[2:]); axis.set_aspect('equal')
    axis.set_xticks([]);axis.set_yticks([])
    for spine in axis.spines.values(): spine.set_color('#c5c7bc');spine.set_linewidth(.7)
    return plotted

plotted = plot_ground(ax, limits, show_routes=True)
detail_bounds = (-300, 100, -55, 335)
plot_ground(detail, detail_bounds, detail_view=True)
ax.add_patch(Rectangle((detail_bounds[0],detail_bounds[2]), detail_bounds[1]-detail_bounds[0],
    detail_bounds[3]-detail_bounds[2], fill=False,edgecolor='#7f7362',linewidth=.8,
    linestyle=(0,(3,3)),zorder=12))
ax.text(-288,-76,'Practice detail',fontsize=7,color='#695c4a',ha='left',va='top',zorder=13,
    bbox=dict(facecolor=bg,edgecolor='none',pad=1))

def scale_bar(axis, bounds, length, label):
    lo_x,hi_x,lo_y,hi_y=bounds
    x,y=lo_x+(hi_x-lo_x)*.045,lo_y+(hi_y-lo_y)*.055
    axis.plot([x,x+length],[y,y],color='#34433c',linewidth=2.4,zorder=20)
    tick=(hi_y-lo_y)*.008
    axis.plot([x,x],[y-tick,y+tick],color='#34433c',linewidth=.9,zorder=20)
    axis.plot([x+length,x+length],[y-tick,y+tick],color='#34433c',linewidth=.9,zorder=20)
    axis.text(x+length/2,y+tick*2,label,ha='center',va='bottom',fontsize=8,color='#34433c',zorder=20,
        bbox=dict(facecolor=bg,edgecolor='none',alpha=.85,pad=1))
scale_bar(ax,limits,200,'200 m')
scale_bar(detail,detail_bounds,50,'50 m')
ax.annotate('N', xy=(.945,.965),xytext=(.945,.865),xycoords='axes fraction',
    ha='center',va='center',fontsize=11,fontweight='bold',color='#34433c',
    arrowprops=dict(arrowstyle='-|>',color='#34433c',lw=1.3),zorder=30)

fig.text(.035,.947,'UPSALA GK',fontsize=23,fontweight='bold',color='#233c32')
fig.text(.035,.916,'Geographic review map · Stora, Mellanbanan and practice grounds',fontsize=12,color='#596657')
fig.text(.772,.865,'S1–S18   Stora',fontsize=11,fontweight='bold',color=navy)
fig.text(.772,.841,'M1–M9    Mellanbanan',fontsize=11,fontweight='bold',color=orange)
fig.text(.772,.805,'Labels mark route green endpoints.\nDashed routes and tee marks are provisional.',fontsize=8.3,
    color='#626557',linespacing=1.5)
fig.text(.772,.771,'Practice grounds · enlarged',fontsize=10,fontweight='bold',color='#3d4d3e')

legend = [Patch(facecolor='#d9e3d4',edgecolor='#a7b8a1',label='Forest / woodland'),
    Patch(facecolor='#c0d39d',edgecolor='#859d66',label='Fairway / range'),
    Patch(facecolor='#608b5c',edgecolor='#42693f',label='Green / practice green'),
    Patch(facecolor='#92b278',edgecolor='#648452',label='Tee platform'),
    Patch(facecolor='#f3df9b',edgecolor='#bd9f58',label='Bunker / mapped sand'),
    Patch(facecolor='#afd4df',edgecolor='#659cac',label='Water / ditch'),
    Patch(facecolor='#a79b8d',edgecolor='#71695e',label='Building'),
    Line2D([0],[0],marker='o',linestyle='none',markersize=5,markerfacecolor='#a9bb9f',markeredgecolor='#48673e',label='LiDAR crown candidate'),
    Line2D([0],[0],marker='x',linestyle='none',markersize=5,color='#406737',label='Separate OSM tree point')]
fig.legend(handles=legend,loc='upper left',bbox_to_anchor=(.768,.39),frameon=False,
    fontsize=8.5,labelspacing=.6,handlelength=1.2,borderaxespad=0)
fig.text(.035,.161,'DATED EVIDENCE, WITH VISIBLE LIMITS',fontsize=9,fontweight='bold',color='#3d4d3e')
fig.text(.035,.133,'2024 municipal and 2025 imagery traces · municipal building survey methods · OSM geometry · 2021 LiDAR crown candidates',
    fontsize=8.5,color='#626557')
fig.text(.035,.109,'Unknown absolute accuracy remains unknown. Crown centres are not surveyed stems; species are unverified. Guide references remain provisional.',
    fontsize=8.5,color='#626557')
fig.text(.035,.085,'The map shows existing vector geometry without smoothing. The practice inset retains the island inside the clubhouse putting green.',
    fontsize=8.5,color='#626557')
fig.text(.035,.049,f"Source: ground-map.geojson · SHA-256 {hashlib.sha256(raw).hexdigest()[:20]}… · frame: metres about {origin['lat']:.3f}°N, {origin['lon']:.4f}°E",
    fontsize=7.5,color='#76796d')

out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(out,facecolor=bg,metadata={'Date': None})
if out.suffix.lower() == '.svg':
    out.write_text('\n'.join(line.rstrip() for line in out.read_text().splitlines()) + '\n')
fig.savefig(out.with_suffix('.png'),dpi=160,facecolor=bg)
counts={}
for f in plotted: counts[kind(f)]=counts.get(kind(f),0)+1
print(json.dumps({'sourceSha256':hashlib.sha256(raw).hexdigest(),'svg':str(out),'png':str(out.with_suffix('.png')),
    'viewBoundsLocalMetres':limits,'visibleFeatureCounts':counts},indent=2))
