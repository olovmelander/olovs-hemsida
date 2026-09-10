"""Check retained roof geometry and reproduce source-height review panels."""
from pathlib import Path
import hashlib, json
import numpy as np
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
VISUAL_NOTES={
    'tortuna-clubhouse-main-roof':'2026 image shows intersecting brown roof sections; elevated 2021 points follow those roof planes and the observed envelope. Orange OSM outline is offset and remains independent. Chimneys/dormers are not separately authored.',
    'tortuna-range-service-barn-roof':'Clear long red roof with two principal pitches; first-return heights align with the image roof, including the southwest end. Retain epoch difference.',
    'tortuna-range-west-barn-roof':'Unobscured red pitched roof; elevated return distribution follows both roof slopes. No facade material inferred.',
    'tortuna-carpark-west-north-barn-roof':'Long dark roof and small bright southwest section are visible. The measured southwest height feature is dated 2021 and is not interpreted as a current architectural detail.',
    'tortuna-house-near-hole9-roof':'Red intersecting roof with dormers east of hole 9; elevated returns follow the roof. Image roof and OSM ground hypothesis differ; no ground translation applied.',
    'tortuna-house-east-garage-roof':'Dark detached roof corresponds with measured edge/interior returns; sparse central source rows retain the maximum 5 m triangle-edge check.',
}


def identity(relative):
    data=(ROOT/relative).read_bytes()
    return dict(path=relative,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())


def main():
    read=lambda path:json.loads((ROOT/path).read_text(encoding='utf-8'))
    meshes=read('tortunabuild/mapping/building-roof-meshes.json')
    evidence=read('tortunabuild/mapping/building-height-evidence.json')
    observations=read('tortunabuild/mapping/building-observations.json')
    obs={b['id']:b for b in observations['buildings']}
    facts={b['id']:b for b in evidence['buildings']}
    if meshes['evidence']['sha256']!=identity('tortunabuild/mapping/building-height-evidence.json')['sha256']:
        raise ValueError('Evidence identity mismatch')
    records=[]
    fig=plt.figure(figsize=(14,9),layout='constrained')
    for index,b in enumerate(meshes['buildings']):
        v=np.asarray(b['mesh']['verticesEpsg3006RH2000'],dtype=float)
        indices=np.asarray(b['mesh']['triangleIndices'],dtype=int).reshape(-1,3)
        if not np.isfinite(v).all() or indices.min()<0 or indices.max()>=len(v):
            raise ValueError('Invalid finite vertex/index contract')
        poly=shape(obs[b['observationId']]['observedRoofGeometryEpsg3006'])
        triangles=[Polygon(v[t,:2]) for t in indices]
        if any(not t.is_valid or t.area<=1e-10 or not poly.buffer(1e-5).covers(t) for t in triangles):
            raise ValueError('Roof triangle leaves its reviewed image envelope')
        union=unary_union(triangles)
        summed=sum(t.area for t in triangles)
        if abs(summed-union.area)>1e-5:
            raise ValueError('Roof triangles overlap')
        expected_void=shape(b['mesh']['uncoveredFootprintGeometryEpsg3006'])
        if poly.difference(union).symmetric_difference(expected_void).area>1e-4:
            raise ValueError('Unobserved roof gap was lost')
        stat=b['mesh']['statistics']
        if stat['roofClearanceAboveDtmMetres']['minimum']<.5 or stat['maximumTriangleEdgeMetres']>5.001:
            raise ValueError('Roof support/terrain limits violated')
        if b['observationId'] not in VISUAL_NOTES:
            raise ValueError('Candidate requires explicit visual source correspondence review')
        record=dict(id=b['id'],observationId=b['observationId'],state='assistant-source-correspondence-reviewed',
            humanAccepted=False,sourceEpoch=b['sourceEpoch'],imageEpoch='2026-05-02',
            geometryChecks='finite vertices, valid indices, non-overlapping contained triangles, retained exact gaps, bounded edges and positive DTM clearance',
            roofAreaSquareMetres=round(union.area,3),observedEnvelopeAreaSquareMetres=round(poly.area,3),
            footprintCoverageFraction=round(union.area/poly.area,6),triangles=len(indices),vertices=len(v),
            sourceFirstReturns=facts[b['observationId']]['selectedInteriorFirstReturns'],
            planarSupportFraction=facts[b['observationId']]['planarSupportFraction'],
            roofHeightRH2000=stat['roofHeightRH2000'],roofClearanceAboveDtmMetres=stat['roofClearanceAboveDtmMetres'],
            imageSourceReview=VISUAL_NOTES[b['observationId']],
            sourcePanel=f"tortunabuild/cache/buildings/{b['observationId']}-source-panel.png")
        records.append(record)
        ax=fig.add_subplot(2,3,index+1,projection='3d')
        center=v[:,:2].mean(axis=0)
        ax.plot_trisurf(v[:,0]-center[0],v[:,1]-center[1],v[:,2],triangles=indices,color='#'+obs[b['observationId']]['roofColourDisplayEstimateHex'],linewidth=.03,edgecolor='#494949',shade=True)
        ax.set_title(b['id'],fontsize=10);ax.set_xlabel('E offset (m)',fontsize=8);ax.set_ylabel('N offset (m)',fontsize=8);ax.set_zlabel('RH2000 (m)',fontsize=8)
        ax.tick_params(labelsize=6);ax.view_init(elev=32,azim=-115)
        span=np.ptp(v,axis=0);ax.set_box_aspect([max(span[0],1),max(span[1],1),max(span[2],1)])
    fig.suptitle('Tortuna: retained April 2021 measured roof surfaces, source-supported boundaries',fontsize=13)
    fig.savefig(ROOT/'tortunabuild/cache/buildings/measured-roof-review.png',dpi=150);plt.close(fig)
    report=dict(schemaVersion=1,groundId='tortuna',state='source-correspondence-and-geometry-reviewed',reviewedOn='2026-09-09',
        humanAccepted=False,horizontalCrs='EPSG:3006',verticalCrs='EPSG:5613',
        inputs=[identity('tortunabuild/mapping/'+name) for name in ['building-roof-meshes.json','building-height-evidence.json','building-observations.json','building-laser-acquisition.json','building-orthophoto-acquisition.json']],
        measuredRoofs=len(records),triangles=sum(b['triangles'] for b in records),buildings=records,
        withheld=meshes['withheld'],groundFootprintReplacements=0,terrainEdits=0,
        visualEvidence='tortunabuild/cache/buildings/measured-roof-review.png',
        limitations=['The dated measured roof is not a complete current architectural model.',
            'Low clubhouse extension, tiny sheds and other unsupported candidates retain estimates/unknowns; no invented roof measurements.',
            'Observed image roof boundaries do not replace ground footprints or independently establish surveyed eaves.',
            'Wall descent from supported roof boundary to native DTM is a visualization convention.'])
    (ROOT/'tortunabuild/mapping/building-roof-review.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(measuredRoofs=len(records),triangles=report['triangles'],withheld=len(meshes['withheld']),groundFootprintReplacements=0)))


if __name__=='__main__':
    main()
