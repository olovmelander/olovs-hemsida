"""Source-only clubhouse roof plane and section review; leaves originals intact."""
from pathlib import Path
import hashlib,json
import numpy as np
import rasterio
from PIL import Image
from shapely.geometry import Polygon
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'tortunabuild/cache/clubhouse'
OUT.mkdir(parents=True,exist_ok=True)
PHOTO='tortunabuild/cache/orthophoto/crops/clubhouse.tif'
POINTS='tortunabuild/cache/buildings/laser-2021-points.json'
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))

def main():
    points=np.asarray(read(POINTS)['points'])
    selected=points[(points[:,0]>597442)&(points[:,0]<597488)&(points[:,1]>6615050)&(points[:,1]<6615096)]
    roof=read('tortunabuild/mapping/building-height-evidence.json')['buildings'][0]
    planes=roof['planes']
    origin=np.asarray(planes[0]['originEpsg3006'])
    normal=np.asarray(planes[0]['coefficients'][:2])-np.asarray(planes[1]['coefficients'][:2])
    v=normal/np.linalg.norm(normal);u=np.asarray([v[1],-v[0]])
    with rasterio.open(ROOT/PHOTO) as src:
        image=src.read([1,2,3]).transpose(1,2,0);bounds=src.bounds
    Image.fromarray(image).crop((260,300,488,548)).resize((912,992)).save(OUT/'roof-native-enlarged.png')
    npz=np.load(ROOT/'tortunabuild/cache/buildings/tortuna-clubhouse-main-roof-roof-points.npz')
    xyz=npz['xyz'];labels=npz['labels']
    fig,axes=plt.subplots(1,2,figsize=(14,9),layout='constrained')
    for ax in axes:
        ax.imshow(image,extent=[bounds.left,bounds.right,bounds.bottom,bounds.top])
        ax.set_xlim(597446,597483);ax.set_ylim(6615058,6615094);ax.set_aspect('equal')
        ax.ticklabel_format(useOffset=False,style='plain');ax.tick_params(labelsize=8)
    for index in range(len(planes)):
        mask=labels==index
        axes[1].scatter(xyz[mask,0],xyz[mask,1],s=14,color=plt.cm.tab10(index),label=f'plane{index}: n={mask.sum()}')
    axes[1].scatter(xyz[labels<0,0],xyz[labels<0,1],s=16,color='black',marker='x',label='unassigned')
    axes[1].legend(fontsize=8);axes[0].set_title('Native May 2026 roof');axes[1].set_title('Earlier unconstrained 2021 plane assignments')
    fig.savefig(OUT/'roof-plane-source.png',dpi=160);plt.close(fig)
    uv=(selected[:,:2]-origin)@np.column_stack((u,v))
    fig,axes=plt.subplots(2,2,figsize=(14,10),layout='constrained')
    first=(selected[:,4]==1)&(selected[:,3]==1)
    axes[0,0].scatter(uv[first,0],uv[first,1],c=selected[first,2],s=7,cmap='plasma')
    axes[0,0].set_xlabel('u southeast (m)');axes[0,0].set_ylabel('v northeast (m)');axes[0,0].set_aspect('equal')
    axes[0,1].scatter(uv[:,0],selected[:,2],c=selected[:,3],s=3,cmap='tab10');axes[0,1].set_xlabel('u southeast (m)');axes[0,1].set_ylabel('RH2000')
    for centre in [-10,-5,0,5,10]:
        mask=(np.abs(uv[:,0]-centre)<1.25)&(np.abs(uv[:,1])<10)
        axes[1,0].scatter(uv[mask,1],selected[mask,2],s=8,label=f'u={centre}±1.25m')
    for centre in [-7,-4,-1,2,5]:
        mask=(np.abs(uv[:,1]-centre)<.65)&(np.abs(uv[:,0])<17)
        axes[1,1].scatter(uv[mask,0],selected[mask,2],s=8,label=f'v={centre}±0.65m')
    axes[1,0].set_xlabel('v northeast (m)');axes[1,1].set_xlabel('u southeast (m)')
    for ax in axes.flat:ax.grid(alpha=.2)
    for ax in axes[1]:ax.set_ylim(26,38);ax.legend(fontsize=7);ax.set_ylabel('RH2000')
    fig.savefig(OUT/'roof-source-sections.png',dpi=150);plt.close(fig)
    print(json.dumps(dict(originEpsg3006=origin.tolist(),uSoutheast=u.tolist(),vNortheast=v.tolist(),uBearingDegrees=float(np.degrees(np.arctan2(u[0],u[1])))%360,points=len(selected))))

if __name__=='__main__':main()
