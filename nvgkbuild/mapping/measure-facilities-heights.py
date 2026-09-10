"""Fit source-constrained roof planes from a focused LM 2025 laser window.

Run after acquire-facilities-laser.mjs with a Python containing NumPy,
Shapely, pyproj and Matplotlib. Raw source returns stay in the ignored cache.
Plane extents are measured-return support, not surveyed wall/eave boundaries.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import Point, Polygon, MultiPoint
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'nvgkbuild/cache/facilities-reference/laser'
acquisition=json.loads((CACHE/'acquisition.json').read_text(encoding='utf-8'))
raw=(CACHE/'points.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()==acquisition['localPointsSha256']
cloud=np.array(json.loads(raw)['points'])
reference=json.loads((ROOT/'nvgkbuild/mapping/facilities-ortho-reference.json').read_text(encoding='utf-8'))
features={f['id']:f for f in reference['features']}
model=json.loads((ROOT/'nvgkbuild/course-model.json').read_text(encoding='utf-8'))
project=Transformer.from_crs(3006,4326,always_xy=True)
rng=np.random.default_rng(20260910)

def local(p):
    lon,lat=project.transform(*p[:2])
    return [round((lon-model['origin']['lon'])*model['mPerLon'],4),round((model['origin']['lat']-lat)*model['mPerLat'],4)]

def q(values,fractions):
    return np.round(np.quantile(values,fractions),3).tolist() if len(values) else None

def fit_plane(xyz, threshold=.13, trials=1800):
    """Largest reproducible nonvertical planar set, then refit its inliers."""
    A=np.c_[xyz[:,:2],np.ones(len(xyz))]
    best=None;score=0
    for _ in range(trials):
        ix=rng.choice(len(xyz),3,replace=False)
        if abs(np.linalg.det(A[ix]))<.1:continue
        coef=np.linalg.solve(A[ix],xyz[ix,2])
        if np.linalg.norm(coef[:2])>1.4:continue
        mask=abs(A@coef-xyz[:,2])<threshold
        if mask.sum()>score:score=mask.sum();best=mask
    if best is None or score<12:return None
    for _ in range(4):
        coef=np.linalg.lstsq(A[best],xyz[best,2],rcond=None)[0]
        best=abs(A@coef-xyz[:,2])<threshold
    residual=A[best]@coef-xyz[best,2]
    return coef,best,residual

targets=['clubhouse-main-roof-native','clubhouse-cross-roof-native','clubhouse-north-annex-roof','lm-range-shelter','lm-practice-shed']
results=[]
fig,axs=plt.subplots(len(targets),2,figsize=(15,4.8*len(targets)))
for row,identifier in enumerate(targets):
    f=features[identifier];poly=Polygon(f['ringEpsg3006']);centre=np.array([poly.centroid.x,poly.centroid.y])
    b=poly.buffer(5).bounds
    p=cloud[(cloud[:,0]>b[0])&(cloud[:,0]<b[2])&(cloud[:,1]>b[1])&(cloud[:,1]<b[3])]
    ground=p[(p[:,3]==2)]
    G=np.c_[ground[:,:2]-centre,np.ones(len(ground))]
    groundfit=np.linalg.lstsq(G,ground[:,2],rcond=None)[0]
    ground0=float(groundfit[2]);grounderror=ground[:,2]-G@groundfit
    select=np.array([poly.buffer(1.5).contains(Point(*pt[:2])) for pt in p])
    hag=p[:,2]-(np.c_[p[:,:2]-centre,np.ones(len(p))]@groundfit)
    candidates=p[select&(p[:,3]!=2)&(hag>1.8)&(hag<8.0)&(p[:,4]==1)]
    xyz=candidates[:,:3].copy();xyz[:,:2]-=centre
    planes=[];used=np.zeros(len(xyz),dtype=bool)
    ax,section=axs[row]
    ax.scatter(p[:,0]-centre[0],p[:,1]-centre[1],c='lightgray',s=4,label='other returns')
    coefficients=[];planeSupport=[]
    for index in range(3):
        remaining=xyz[~used]
        if len(remaining)<20:break
        fitted=fit_plane(remaining)
        if fitted is None:break
        coef,mask,residual=fitted
        if mask.sum()<25:break
        ix=np.where(~used)[0][mask];used[ix]=True;inlier=xyz[ix]
        hull=np.array(MultiPoint(inlier[:,:2]).convex_hull.exterior.coords)[:-1]+centre
        plane=dict(id=f'{identifier}-plane-{index+1}',supportCount=len(inlier),
                   interpretation='dominant roof plane' if index<2 else 'minor planar subset; may be a connected or neighbouring roof rather than part of the dominant gable',
                   coefficientsLocalEN=[round(float(v),7) for v in coef],
                   slopeDegrees=round(math.degrees(math.atan(np.linalg.norm(coef[:2]))),2),
                   residualRmseMetres=round(float(np.sqrt(np.mean(residual**2))),3),
                   residualP95AbsoluteMetres=round(float(np.quantile(abs(residual),.95)),3),
                   supportHeightQuantilesRH2000=dict(zip(['min','p05','p50','p95','max'],q(inlier[:,2],[0,.05,.5,.95,1]))),
                   supportHullEpsg3006=np.round(hull,3).tolist(),supportHullLocalXZ=[local(pt) for pt in hull])
        planes.append(plane);coefficients.append(coef);planeSupport.append(inlier)
        ax.scatter(inlier[:,0],inlier[:,1],s=10,label=f'plane {index+1}: {len(inlier)} returns')
    record=dict(id=identifier,sourceFeatureId=identifier,sourceGeometry='2024 ortho envelope plus 1.5 m query buffer; plane geometry comes from 2025 laser coordinates',
                planeEquation='RH2000 height = a*(E-originE)+b*(N-originN)+c',originEpsg3006=centre.round(4).tolist(),
                originLocalXZ=local(centre),allCandidateRoofReturns=len(candidates),planes=planes,
                nearbyGround=dict(pointCount=len(ground),heightAtOriginRH2000=round(ground0,3),heightQuantilesRH2000=dict(zip(['p05','p50','p95'],q(ground[:,2],[.05,.5,.95]))),
                                  fittedSlopeDegrees=round(math.degrees(math.atan(np.linalg.norm(groundfit[:2]))),2),
                                  residualP95AbsoluteMetres=round(float(np.quantile(abs(grounderror),.95)),3)),
                limitations=['Roof support hull is an inner envelope of sampled roof returns; it is not a wall outline.',
                             'Ground fit uses the surrounding five metre window, not a measured entrance threshold.',
                             'Roof eave and ridge ends are undersampled; allow about 0.5–1 m horizontal uncertainty.'])
    if identifier=='lm-practice-shed':
        record['roofInterpretation']={'status':'unresolved-low-pitch-roof',
            'observedSurfaceHeightRH2000':q(candidates[candidates[:,2]<35.2,2],[.05,.5,.95]),
            'reason':'Dominant planar subsets are shallow, do not form a supported convex gable, and contain discontinuities. Do not turn their intersection into a ridge.',
            'modelRecommendation':'Use photographs to establish roof type; retain measured roof return height envelope approximately 33.2–34.8 m RH2000.'}
        section.scatter(xyz[:,0],xyz[:,2],s=10)
        section.set(xlabel='Relative easting m',ylabel='RH2000 m',title='Roof form unresolved; measured height returns')
    elif len(coefficients)>=2:
        a,b=coefficients[:2];normal=a[:2]-b[:2];distance=np.linalg.norm(normal)
        if distance>.2:
            cross=normal/distance;axis=np.array([-cross[1],cross[0]])
            ridgeOrigin=-(a[2]-b[2])*normal/distance**2
            roof=np.r_[planeSupport[0],planeSupport[1]]
            along=(roof[:,:2]-ridgeOrigin)@axis
            ends=np.quantile(along,[.01,.99]);ridgeXY=np.array([ridgeOrigin+t*axis for t in ends])
            ridgeZ=np.c_[ridgeXY,np.ones(2)]@a
            offset=(roof[:,:2]-ridgeOrigin)@cross
            low,high=np.quantile(offset,[.01,.99])
            # A return-envelope rectangle: no speculative roof overhang added.
            rect=np.array([ridgeOrigin+t*axis+s*cross for t,s in [(ends[0],low),(ends[1],low),(ends[1],high),(ends[0],high)]])
            cornersEN=rect+centre
            cornerZ=np.minimum(np.c_[rect,np.ones(4)]@a,np.c_[rect,np.ones(4)]@b)
            record['roofSupportRectangle']=dict(ringEpsg3006=cornersEN.round(3).tolist(),ringLocalXZ=[local(p) for p in cornersEN],
                                               lengthMetres=round(float(ends[1]-ends[0]),2),widthMetres=round(float(high-low),2),
                                               eavePlaneHeightsRH2000=cornerZ.round(3).tolist(),
                                               meaning='1st–99th percentile support projected on fitted ridge; sampled inner roof envelope, not a survey of walls/eaves')
            ridgeEN=ridgeXY+centre
            record['ridge']=dict(endpointsEpsg3006=ridgeEN.round(3).tolist(),endpointsLocalXZ=[local(p) for p in ridgeEN],
                                 heightsRH2000=ridgeZ.round(3).tolist(),heightAboveNearbyGroundMetres=round(float(np.mean(ridgeZ)-ground0),3),
                                 gridBearingDegrees=round(math.degrees(math.atan2(axis[0],axis[1]))%180,2),
                                 status='intersection of the two largest fitted roof planes; validate roof assembly and endpoint extent with photographs',
                                 suggestedVerticalToleranceMetres=.2)
            ax.plot(*ridgeXY.T,c='black',linewidth=2,label='fitted plane intersection')
            ax.plot(*np.r_[rect,rect[:1]].T,c='black',linestyle='--')
            section.scatter((xyz[:,:2]-ridgeOrigin)@cross,xyz[:,2],s=10,c=np.where(used,'tab:blue','lightgray'))
            for coef in coefficients[:2]:
                positions=np.array([ridgeOrigin+s*cross for s in [low,high]])
                section.plot([low,high],np.c_[positions,np.ones(2)]@coef)
            section.set(xlabel='Cross-ridge offset m',ylabel='RH2000 m',title='Two dominant roof plane cross-section')
    ring=np.array(f['ringEpsg3006']+[f['ringEpsg3006'][0]])-centre
    ax.plot(*ring.T,c='red',linewidth=1,label='2024 ortho envelope')
    ax.set(title=identifier,xlabel='Easting relative to origin m',ylabel='Northing relative to origin m',aspect='equal')
    ax.legend(fontsize=7)
    results.append(record)
fig.tight_layout();fig.savefig(CACHE/'roof-plane-review.png',dpi=140)
report=dict(schemaVersion=1,groundId='norrfallsviken',measuredOn='2026-09-10',source=acquisition,
            method=dict(algorithm='deterministic RANSAC then linear least-squares, up to 3 roof planes per supplied envelope',
                        seed=20260910,iterations=1800,inlierVerticalResidualMetres=.13,
                        sourceSelection='first-return, unclassified, 1.8–8 m above nearby ground plane; 1.5 m envelope query buffer',
                        publication='Aggregate roof and ground measurements only; raw returns remain in ignored local cache.'),
            facilities=results,
            limitations=['The source is June 2025 airborne laser at roughly metre horizontal sampling, not a facade survey.',
                         'Planar fit residual is internal scatter, not total survey accuracy.',
                         'Windows, doors, terrace elevation, materials and present-day changes require photographic or field evidence.',
                         'Do not move measured roofs to match relief-displaced aerial image roof outlines.'])
contextCache=ROOT/'nvgkbuild/cache/facilities-reference/laser-southern-context'
if (contextCache/'points.json').exists():
    contextAcquisition=json.loads((contextCache/'acquisition.json').read_text(encoding='utf-8'))
    contextRaw=(contextCache/'points.json').read_bytes()
    assert hashlib.sha256(contextRaw).hexdigest()==contextAcquisition['localPointsSha256']
    context=np.array(json.loads(contextRaw)['points'])
    # Main white slab on the additional 2024 context crop, separate from the
    # smaller outbuilding slab. This tests temporal construction, not ownership.
    slab=Polygon([(678640+.16*u,6988250.08-.16*v) for u,v in [(231,191),(275,154),(341,235),(299,272)]])
    inside=np.array([slab.contains(Point(*p[:2])) for p in context])
    nearby=context[(context[:,3]==2)&(context[:,0]>678670)&(context[:,0]<678700)&(context[:,1]>6988200)&(context[:,1]<6988230)]
    floor=float(np.median(nearby[:,2]));elevated=context[inside&(context[:,2]>floor+1.8)]
    report['surroundingConstruction']={
        'id':'southern-residential-context-2025','useAndOwnership':'unconfirmed; do not classify as golf maintenance',
        'source':contextAcquisition,'observation':'White slab visible in June 2024 orthophoto has a substantial elevated structure in June 2025 laser.',
        'querySlabRingEpsg3006':[list(p) for p in slab.exterior.coords][:-1],
        'returnsInsideOldSlabEnvelope':int(inside.sum()),'returnsMoreThan1p8MetresAboveNearbyGround':len(elevated),
        'elevatedHeightQuantilesRH2000':dict(zip(['p05','p50','p95','max'],q(elevated[:,2],[.05,.5,.95,1]))),
        'nearbyGroundMedianRH2000':round(floor,3),'groundSupportCount':len(nearby),
        'inference':'The height distribution and 2024 construction context strongly support a completed building by the laser capture; facade, roof form and use remain unverified.'}
target=ROOT/'nvgkbuild/mapping/facilities-height-reference.json'
target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for r in results:
    print(r['id'],json.dumps(dict(planes=[(p['supportCount'],p['slopeDegrees'],p['residualRmseMetres']) for p in r['planes']],ground=r['nearbyGround']['heightAtOriginRH2000'],ridgeRH2000=r.get('ridge',{}).get('heightsRH2000')),ensure_ascii=False))
