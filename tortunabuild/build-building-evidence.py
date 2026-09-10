"""Measure dated roof surfaces from bounded source returns and observed roofs.

No ground footprint, DTM, eave height, wall height, or roof style is invented.
The established Lidingö bounded TIN algorithm is reused by loading only its
three pinned function definitions, avoiding that script's course-specific I/O.
"""
from pathlib import Path
import ast, hashlib, json
import numpy as np
import rasterio
from shapely.geometry import shape, MultiPoint, Polygon
from shapely.ops import triangulate
from shapely import contains_xy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tortunabuild/cache/buildings'
OUT.mkdir(parents=True,exist_ok=True)
PINS={
    'tortunabuild/cache/buildings/laser-2021-points.json':'ff07c4e622e8c5ddfb26472d0407f67e7c6c14687e9af93c916df51f9c79ea00',
    'tortunabuild/cache/terrain/terrain-1m.f32':'86f30a75f398cfa2da8c32b833b859c575a9056910b237ac2539fdbba3c02ef1',
    'lidingobuild/build-building-evidence.py':'7238ecc0a5398bde0538653389d4a1b823b3c2300a64f3b9967d507384533b75',
}


def identity(relative):
    data=(ROOT/relative).read_bytes()
    if relative=='lidingobuild/build-building-evidence.py':
        # Source code identity is portable across Git's platform EOL checkout.
        normalized=data.replace(b'\r\n',b'\n')
        return dict(path=relative,sha256LfNormalized=hashlib.sha256(normalized).hexdigest(),
                    sha256=hashlib.sha256(normalized).hexdigest(),contentRepresentation='utf8-lf')
    return dict(path=relative,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())


def read(relative):
    return json.loads((ROOT/relative).read_text(encoding='utf-8'))


def dtm_at(x,y,dtm):
    col=np.asarray(x)-595352.5
    row=6616947.5-np.asarray(y)
    if np.any((col<0)|(row<0)|(col>4096)|(row>4096)):
        raise ValueError('Query leaves the pinned native DTM')
    ix=np.minimum(4095,np.floor(col).astype(int));iy=np.minimum(4095,np.floor(row).astype(int))
    u,v=col-ix,row-iy
    return (dtm[iy,ix]*(1-u)+dtm[iy,ix+1]*u)*(1-v)+(dtm[iy+1,ix]*(1-u)+dtm[iy+1,ix+1]*u)*v


def roof_functions():
    path='lidingobuild/build-building-evidence.py'
    tree=ast.parse((ROOT/path).read_text(encoding='utf-8'))
    selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ['q','robust_planes','roof_mesh']]
    if len(selected)!=3:
        raise ValueError('Reviewed roof algorithm functions changed')
    namespace=dict(np=np,MultiPoint=MultiPoint,Polygon=Polygon,triangulate=triangulate,dtm_at=dtm_at)
    exec(compile(ast.Module(body=selected,type_ignores=[]),path,'exec'),namespace)
    return [namespace[key] for key in ['q','robust_planes','roof_mesh']]


def main():
    for relative,sha in PINS.items():
        if identity(relative)['sha256']!=sha:
            raise ValueError(f'Pinned source changed: {relative}')
    q,robust_planes,roof_mesh=roof_functions()
    acquisition=read('tortunabuild/mapping/building-laser-acquisition.json')
    if acquisition['rasterlessPoints']['sha256']!=PINS['tortunabuild/cache/buildings/laser-2021-points.json'] or not acquisition['statistics']['nodeCountsExact']:
        raise ValueError('Acquisition receipt mismatch')
    raw=read('tortunabuild/cache/buildings/laser-2021-points.json')
    if raw['columns']!=['easting','northing','heightRH2000','classification','returnNumber','numberOfReturns']:
        raise ValueError('Point schema mismatch')
    points=np.asarray(raw['points'])
    if points.shape!=(664799,6) or not np.isfinite(points).all():
        raise ValueError('Point window incomplete')
    dtm=np.fromfile(ROOT/'tortunabuild/cache/terrain/terrain-1m.f32',dtype='<f4').reshape(4097,4097)
    observations=read('tortunabuild/mapping/building-observations.json')
    ground=dtm_at(points[:,0],points[:,1],dtm)
    elevated=(points[:,3]==1)&(points[:,4]==1)&((points[:,2]-ground)>=1.5)
    images={}
    buildings=[];meshes=[]
    for obs in observations['buildings']:
        poly=shape(obs['observedRoofGeometryEpsg3006'])
        if not poly.is_valid or poly.geom_type!='Polygon' or poly.interiors:
            raise ValueError('Unsupported roof selection geometry')
        grid=obs['sourceGrid']
        if identity(grid['path'])['sha256']!=grid['sha256']:
            raise ValueError('Reviewed image changed')
        if grid['path'] not in images:
            with rasterio.open(ROOT/grid['path']) as src:
                images[grid['path']]=(src.read([1,2,3]).transpose(1,2,0),src.bounds)
        inside=contains_xy(poly,points[:,0],points[:,1])
        core=contains_xy(poly.buffer(-.6),points[:,0],points[:,1])
        selected=points[core&elevated,:3]
        # Small intersecting roof facets contain fewer than 25 sampled returns.
        # Keep the same residual/slope criteria while allowing a 12-return facet.
        planes,labels=robust_planes(selected,min_inliers=12,max_planes=12)
        supported=float(np.count_nonzero(labels>=0)/len(labels)) if len(labels) else 0.
        stats,mesh=roof_mesh(poly,selected,labels,planes,dtm,points[inside&elevated,:3])
        record=dict(id=obs['id'],associatedBuildingId=obs['associatedBuildingId'],observedAt=acquisition['capturedAt'],
            captureStart=acquisition['captureStart'],captureEnd=acquisition['captureEnd'],
            selectionOutlineSource='2026 observed image roof silhouette; independent from retained OSM ground footprint',
            sourceOutline=obs['observedRoofGeometryEpsg3006'],observedRoofAreaSquareMetres=round(poly.area,3),
            selectedInteriorFirstReturns=len(selected),selectionBoundaryInsetMetres=.6,
            roofCandidateAbsoluteHeightRH2000=q(selected[:,2]),
            roofCandidateHeightAboveDtm=q(selected[:,2]-dtm_at(selected[:,0],selected[:,1],dtm)),
            planarSupportFraction=round(supported,4),planes=planes,roofSurface=stats,
            roofColourDisplayEstimateHex=obs['roofColourDisplayEstimateHex'],
            facadeColourDisplayEstimateHex=obs['facadeColourDisplayEstimateHex'],
            groundFootprintReplaced=False,wallHeightMetres=None,eaveHeightRH2000=None,roofType=None,
            visualReviewStatus='candidate-awaiting-rendered-source-panel-review',
            limitations=['Class 1 is unclassified: footprint and image association are needed to identify roof candidates.',
                '2021 laser does not prove all 2026 architecture is unchanged.',
                'Roof heights above an interpolated DTM are not surveyed wall or eave heights.'])
        if mesh is not None:
            # Separate child structures never duplicate the main clubhouse ID.
            target=obs['associatedBuildingId'] if obs['id']!='tortuna-clubhouse-low-extension' else obs['id']
            target=target or obs['id']
            mesh['boundaryHeightMethod']='Nearest robust source plane within 3 m of supporting returns; onto observed image roof envelope, not a surveyed eave or ground footprint.'
            meshes.append(dict(id=target,observationId=obs['id'],parentBuildingId=obs['associatedBuildingId'] if target!=obs['associatedBuildingId'] else None,
                sourceId='laser-lm-skog',sourceFootprintId=obs['associatedBuildingId'],sourceEpoch=acquisition['capturedAt'],
                state=stats['status'],groundFootprintReplaced=False,mesh=mesh))
        buildings.append(record)
        np.savez(OUT/(obs['id']+'-roof-points.npz'),xyz=selected,labels=labels)
        photo,bounds=images[grid['path']]
        fig,axes=plt.subplots(1,2,figsize=(12,6),layout='constrained')
        for ax in axes:
            ax.imshow(photo,extent=[bounds.left,bounds.right,bounds.bottom,bounds.top])
            ring=np.asarray(poly.exterior.coords);ax.plot(ring[:,0],ring[:,1],color='cyan',lw=1)
            if obs['sourceFootprintGeometryEpsg3006']:
                osm=np.asarray(shape(obs['sourceFootprintGeometryEpsg3006']).exterior.coords)
                ax.plot(osm[:,0],osm[:,1],color='orange',lw=1,ls='--')
            extent=poly.buffer(4).bounds
            ax.set_xlim(extent[0],extent[2]);ax.set_ylim(extent[1],extent[3]);ax.set_aspect('equal')
            ax.ticklabel_format(useOffset=False,style='plain');ax.tick_params(labelsize=6)
        scatter=axes[1].scatter(selected[:,0],selected[:,1],c=selected[:,2],s=5,cmap='plasma')
        fig.colorbar(scatter,ax=axes[1],label='2021 return height RH2000',shrink=.65)
        axes[0].set_title('2026 roof selection (cyan), OSM hypothesis (orange)',fontsize=9)
        axes[1].set_title(f'{len(selected)} first returns; {supported:.0%} planar support',fontsize=9)
        fig.suptitle(obs['id'],fontsize=11)
        fig.savefig(OUT/(obs['id']+'-source-panel.png'),dpi=130);plt.close(fig)
        print(json.dumps(dict(id=obs['id'],returns=len(selected),support=round(supported,3),status=stats['status'],coverage=stats.get('footprintCoverageFraction'))),flush=True)
    inputs=[identity(path) for path in PINS]+[identity('tortunabuild/mapping/building-observations.json'),identity('tortunabuild/mapping/building-laser-acquisition.json')]
    report=dict(schemaVersion=1,groundId='tortuna',state='dated-roof-height-evidence-candidates',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
        sourceEpoch=acquisition['capturedAt'],captureStart=acquisition['captureStart'],captureEnd=acquisition['captureEnd'],
        inputs=inputs,sourceIds=['laser-lm-skog','imagery-lm-ortho','terrain-lm-1m'],buildings=buildings,
        method=dict(firstReturnsOnly=True,sourceClassification=1,minimumHeightAboveDtmMetres=1.5,selectionInsetMetres=.6,
            planes='Deterministic RANSAC from reviewed existing algorithm; 0.18 m inliers, minimum 12 returns per plane, maximum slope 1.2, up to 12 planes.',
            mesh='Original supported return heights; maximum triangle edge 5 m; bounded plane interpolation on source selection boundary within 3 m of support; gaps retained.'),
        limitations=['Source acquisition epoch and image epoch differ; present-day architectural detail is not measured.',
            'Observed roof outlines never replace retained ground footprints.',
            'Do not assign roof clearance quantiles directly to legacy building h fields.'])
    (ROOT/'tortunabuild/mapping/building-height-evidence.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
    output=dict(schemaVersion=1,groundId='tortuna',state='machine-reviewed-measured-roof-candidates',horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
        sourceEpoch=acquisition['capturedAt'],inputs=inputs,evidence=identity('tortunabuild/mapping/building-height-evidence.json'),buildings=meshes,
        withheld=[dict(id=b['id'],associatedBuildingId=b['associatedBuildingId'],reasons=b['roofSurface']['reasons']) for b in buildings if b['roofSurface']['status']=='withheld'],
        limitations=['Render the supplied measured surface directly; do not place an additional generic roof over it.',
            'Wall boundary heights are source-supported visualization limits, not independently measured eaves.',
            'Wall descents to DTM are display geometry, not measured foundations.',
            'Retained OSM ground footprints and 2026 image roof silhouettes remain independent source facts.'])
    (ROOT/'tortunabuild/mapping/building-roof-meshes.json').write_text(json.dumps(output,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')


if __name__=='__main__':
    main()
