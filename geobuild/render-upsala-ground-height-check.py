#!/usr/bin/env python3
"""Plot sanitised municipal/DTM residuals with course context; no source imagery."""
import argparse
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle
from pyproj import Transformer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, default=Path('upsalabuild/mapping/municipal-ground-height-check-2026-09-07.json'))
    parser.add_argument('--out', type=Path, default=Path('upsalabuild/mapping/municipal-ground-height-check'))
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding='utf-8'))
    model_file = Path('upsalabuild/course-model.json')
    model = json.loads(model_file.read_text(encoding='utf-8'))
    transform = Transformer.from_crs('EPSG:4326', 'EPSG:3006', always_xy=True)
    def project(ring):
        return [transform.transform(model['origin']['lon']+x/model['mPerLon'], model['origin']['lat']-z/model['mPerLat']) for x,z in ring]

    fig, axes = plt.subplots(1, 2, figsize=(14, 8.2), gridspec_kw={'width_ratios':[1.15,1]}, facecolor='#f5f3eb')
    fig.suptitle('Upsala: municipal ground heights against published 1 m terrain', fontsize=17, fontweight='bold', y=.96)
    counts, metrics = report['counts'], report['metrics']
    fig.text(.055, .892, f'{counts["included"]} complete comparisons | {counts["excluded"]} excluded | {len(report["outliers"])} absolute residuals above {report["outlierThresholdAbsoluteM"]} m', fontsize=11)
    included = [r for r in report['rows'] if r['included']]
    excluded = [r for r in report['rows'] if not r['included']]
    coverage = report['publishedTerrain']['finestCoverageBoundsEPSG3006']
    e0,n0,e1,n1 = coverage
    extents = [[e0-50,n0-30,max(e1+50,max(r['easting'] for r in excluded)+30),max(n1+50,max(r['northing'] for r in excluded)+30)],
               [640520,6636520,640720,6636720]]
    for i, (ax, extent) in enumerate(zip(axes, extents)):
        ax.set_facecolor('#f0eee3')
        for hole in model['holes']:
            for ring in hole['fairway']['rings']:
                ax.add_patch(Polygon(project(ring), facecolor='#e0e9d5', edgecolor='none'))
            ax.add_patch(Polygon(project(hole['green']['ring']), facecolor='#b9d6b0', edgecolor='#6b8a65', lw=.5))
        for ring in model['scenery'].get('greens', []):
            ax.add_patch(Polygon(project(ring), facecolor='#b9d6b0', edgecolor='#6b8a65', lw=.5))
        for building in model['infra'].get('buildings', []):
            ax.add_patch(Polygon(project(building['ring']), facecolor='#d5d3cb', edgecolor='#9e9e99', lw=.4))
        for kind in ['roads','tracks','paths']:
            for road in model['infra'].get(kind, []):
                if road.get('line'):
                    x,y=zip(*project(road['line'])); ax.plot(x,y,c='#b8b9b2',lw=.8)
        for water in model.get('water', []):
            ax.add_patch(Polygon(project(water['ring']), facecolor='#d3e1e8', edgecolor='#a0bac8', lw=.5))
        ax.add_patch(Rectangle((e0,n0),e1-e0,n1-n0,fill=False,edgecolor='#676f63',lw=1,ls='--'))
        ax.scatter([r['easting'] for r in excluded],[r['northing'] for r in excluded],c='#777777',marker='x',s=20,linewidths=.8,label='Excluded: outside 1 m coverage')
        scatter=ax.scatter([r['easting'] for r in included],[r['northing'] for r in included],c=[r['residualM'] for r in included],
                           cmap='RdBu_r',vmin=-1.1,vmax=1.1,s=18 if i==0 else 39,edgecolors='#555555',linewidths=.25)
        ax.set_xlim(extent[0],extent[2]);ax.set_ylim(extent[1],extent[3]);ax.set_aspect('equal')
        ax.ticklabel_format(style='plain',useOffset=False)
        ax.tick_params(axis='x',labelrotation=30,labelsize=8);ax.tick_params(axis='y',labelsize=8)
        ax.set_xlabel('Easting (EPSG:3006)',fontsize=10)
        if i==0:ax.set_ylabel('Northing (EPSG:3006)',fontsize=10)
        ax.annotate('N',xy=(.94,.96),xytext=(.94,.87),xycoords='axes fraction',ha='center',arrowprops={'arrowstyle':'-|>','color':'#39473e'},fontsize=9)
        for spine in ax.spines.values():spine.set_edgecolor('#c4c2b7')
    axes[0].set_title('Sample locations and finest terrain coverage',loc='left',fontsize=11)
    axes[1].set_title('Northeastern outliers: surrounding residential ground',loc='left',fontsize=11)
    axes[0].add_patch(Rectangle((extents[1][0],extents[1][1]),200,200,fill=False,edgecolor='#7d3c55',lw=1.2))
    axes[0].legend(loc='lower left',fontsize=8)
    colorbar=fig.colorbar(scatter,cax=fig.add_axes([.88,.27,.018,.49]))
    colorbar.set_label('Published DTM minus municipal height (m RH2000)',fontsize=10)
    fig.text(.055,.105,f'Median {metrics["medianM"]:+.3f} m | RMSE {metrics["rmseM"]:.3f} m | p95 absolute {metrics["p95AbsoluteResidualM"]:.3f} m. Every large residual remains in these metrics.',fontsize=11)
    fig.text(.055,.075,'No terrain fit or correction. REGDATE is registration, not capture. Clustered points do not certify the whole golf course.',fontsize=10)
    fig.text(.055,.048,'Northeastern context shows housing and earthworks in the 2025 orthophoto; cause and timing of height differences remain unverified.',fontsize=9)
    fig.subplots_adjust(left=.055,right=.82,bottom=.2,top=.83,wspace=.18)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    for extension in ['svg','png']:fig.savefig(args.out.with_suffix('.'+extension),dpi=160,facecolor=fig.get_facecolor())
    svg = args.out.with_suffix('.svg')
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n', encoding='utf-8')
    plt.close(fig)
    print(f'Residual map: {args.out}; report SHA256 {hashlib.sha256(args.report.read_bytes()).hexdigest()}; context model SHA256 {hashlib.sha256(model_file.read_bytes()).hexdigest()}')


if __name__=='__main__':main()
