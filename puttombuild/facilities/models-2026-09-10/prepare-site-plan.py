"""Data-only Puttom site additions, grounded in original class-2 laser returns.

No Blender/runtime/terrain mutation. EPSG:3006 horizontal coordinates and RH2000
heights stay absolute. Ground objects never inherit aerial roof displacement.
"""
from pathlib import Path
import hashlib
import json
import math
import subprocess
import sys
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import triangulate

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
FAC=HERE.parent
ORIGIN=[697365.0,7025190.0,44.0]
def read(path):return json.loads(path.read_text(encoding='utf8'))
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def unit(v):return np.asarray(v,dtype=float)/np.linalg.norm(v)
def rounded(a):return np.round(a,5).tolist()

def refine_ground_mesh(item,base,max_edge=.999):
    """Conforming midpoint subdivision; retain the exact source polygon boundary.

    Every occurrence of a marked shared edge is split in the same iteration.
    Unlike independent triangle subdivision this creates no hanging edge nodes
    whose interpolated runtime heights could open cracks in the paving.
    """
    vertices=[];lookup={};triangles=[]
    for face in item['faces']:
        assert len(face)==3,'Ground paving expects an existing triangle mesh'
        tri=[]
        for index in face:
            vertex=item['verticesENH'][index];key=tuple(vertex[:2])
            if key not in lookup:lookup[key]=len(vertices);vertices.append(list(vertex))
            tri.append(lookup[key])
        triangles.append(tri)
    for iteration in range(24):
        marked={}
        for tri in triangles:
            for a,b in zip(tri,tri[1:]+tri[:1]):
                edge=tuple(sorted((a,b)))
                if edge in marked:continue
                if math.dist(vertices[a][:2],vertices[b][:2])<=max_edge:continue
                p=[(vertices[a][k]+vertices[b][k])/2 for k in (0,1)]
                marked[edge]=len(vertices);vertices.append([*p,base(p)+.025])
        if not marked:break
        refined=[]
        for tri in triangles:
            splits=[tuple(sorted((tri[i],tri[(i+1)%3]))) in marked for i in range(3)]
            count=sum(splits)
            if not count:refined.append(tri);continue
            if count==3:
                a,b,c=tri;ab=marked[tuple(sorted((a,b)))];bc=marked[tuple(sorted((b,c)))];ca=marked[tuple(sorted((c,a)))]
                refined.extend([[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])
            elif count==1:
                start=splits.index(True);a,b,c=tri[start:]+tri[:start];ab=marked[tuple(sorted((a,b)))]
                refined.extend([[a,ab,c],[ab,b,c]])
            else:
                start=next(i for i in range(3) if splits[i] and splits[(i+1)%3])
                a,b,c=tri[start:]+tri[:start];ab=marked[tuple(sorted((a,b)))];bc=marked[tuple(sorted((b,c)))]
                refined.extend([[b,bc,ab],[a,ab,c],[ab,bc,c]])
        triangles=refined
    else:raise ValueError('Ground mesh subdivision failed to converge')
    item['verticesENH']=rounded(vertices);item['faces']=triangles
    item['groundMeshRefinement']=dict(method='conforming shared-edge midpoint subdivision',
        maximumEdgeMetres=1.,sourceFootprintPreserved=True)

def apply_ground_contacts(plan,base):
    counts={'drape':0,'rigid':0}
    for item in plan['primitives']:
        identifier=item['id']
        if identifier=='range-apron-rose':
            refine_ground_mesh(item,base)
            item['groundContact']={'mode':'drape','clearanceMetres':.055};counts['drape']+=1
        elif identifier=='range-apron-pale-pavers':
            item['groundContact']={'mode':'drape','clearanceMetres':.067};counts['drape']+=1
        elif identifier.startswith(('range-mat-','range-tray-','range-rope-post-')):
            p=item['centerENH'][:2]
            item['groundContact']={'mode':'rigid','anchorENH':rounded([*p,base(p)])};counts['rigid']+=1
    plan['groundContactPolicy']=dict(
        purpose='Keep facility paving and small fixtures above the active rendered terrain without changing source XY placement.',
        drape='Replace each paving vertex height with runtime terrain at that vertex plus clearanceMetres.',
        rigid='Translate each complete item vertically once by runtime terrain at anchorENH.xy minus anchorENH.height; preserve authored offsets and dimensions.',
        absolute='Unannotated primitives, including ropes, safety net structures, dispenser and buildings, retain absolute source placement.',
        pinkClearanceMetres=.055,paleClearanceMetres=.067,counts=counts)
    plan['summary']['groundContact']=counts
    return plan

def main():
    # A narrow update mode preserves later plan revisions made after generation.
    preserved_plan=read(HERE/'site-plan.json') if '--ground-contact-only' in sys.argv else None
    inv_path=FAC/'facility-inventory.json'; inv=read(inv_path)
    ref=read(FAC/'orthophoto-reference.json'); panels={p['id']:p for p in ref['panels']}
    obs={x['id']:x for x in inv['nonBuildingFacilities']}
    laser_path=ROOT/'puttombuild/cache/facilities-reference-2026-09-10/laser/points.json'
    data=np.asarray(read(laser_path)['points'],dtype=float)
    extra_path=laser_path.with_name('site-extra-north-net-points.json')
    extra_ledger=laser_path.with_name('site-extra-north-net-acquisition.json')
    if not extra_path.exists():
        # Existing facility window stops at N=7025430; never extrapolate a ground
        # plane 35 m beyond it for the northern end of the safety net.
        js="""
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openItem, readWindow } from './packages/course-geo/copc-reader/copc-window.mjs';
import { authorizationHeaders, lantmaterietCredentials } from './packages/course-geo/acquisition/credentials.mjs';
const campaigns=JSON.parse(fs.readFileSync('geo_data/course-v2/puttom/acquisition/laser-campaigns.json'));
const source=campaigns.items.find(x=>x.id==='23f028-702_69');
const bbox=[697490,7025425,697540,7025475];
const credentials=lantmaterietCredentials();if(!credentials)throw Error('Local LM credentials required for northern net ground');
const opened=await openItem({url:source.assets.data.href,headers:authorizationHeaders(credentials)});
const {points,statistics}=await readWindow(opened,bbox);
const rows=[];for(let i=0;i<points.count;i++)if(points.classification[i]===2)rows.push([points.x[i],points.y[i],Math.round(points.z[i]*100)/100,2]);
const file='puttombuild/cache/facilities-reference-2026-09-10/laser/site-extra-north-net-points.json';
const raw=JSON.stringify({columns:['easting','northing','heightRH2000','classification'],points:rows});fs.writeFileSync(file,raw);
const ledger={sourceId:source.id,sourceUrl:source.assets.data.href,captureStart:source.captureStart,captureEnd:source.captureEnd,
 horizontalCrs:'EPSG:3006',verticalDatum:'RH2000',boundsEpsg3006:bbox,classification:2,sourceAttribution:campaigns.terms.attribution,
 localPointsFile:file,sha256:createHash('sha256').update(raw).digest('hex'),count:rows.length,acquiredAt:new Date().toISOString(),statistics};
fs.writeFileSync(file.replace('-points.json','-acquisition.json'),JSON.stringify(ledger,null,2)+'\\n');
console.log(JSON.stringify({groundReturns:rows.length,boundsEpsg3006:bbox}));
"""
        result=subprocess.run(['node','--env-file=.env','--input-type=module','-e',js],cwd=ROOT,capture_output=True,text=True,timeout=180,check=True)
        print(result.stdout.strip())
    extra_meta=read(extra_ledger)
    assert digest(extra_path)==extra_meta['sha256'],'Extra source hash mismatch'
    extra=np.asarray(read(extra_path)['points'],dtype=float)
    data=np.concatenate((data[:,:4],extra),axis=0)
    ground=data[data[:,3]==2,:3];tree=cKDTree(ground[:,:2]);ground_checks=[]
    def base(p,record=False):
        d,ix=tree.query(p,k=36);near=ground[ix];delta=near[:,:2]-p
        A=np.column_stack((delta,np.ones(len(delta))))
        weights=1/np.maximum(d,0.4)
        coef=np.linalg.lstsq(A*weights[:,None],near[:,2]*weights,rcond=None)[0]
        residual=near[:,2]-A@coef; keep=np.abs(residual-np.median(residual))<max(.08,float(np.quantile(np.abs(residual),.8)))
        if keep.sum()>=10:coef=np.linalg.lstsq(A[keep],near[keep,2],rcond=None)[0]
        if record:ground_checks.append(dict(centerEN=rounded(p),heightRH2000=round(float(coef[2]),4),
            sourcePointCount=int(keep.sum()),nearestDistanceMetres=round(float(d[0]),3),
            sampleRadiusMetres=round(float(d[-1]),3),method='local robust class-2 plane; not a finished-floor survey'))
        return float(coef[2])
    def pix(panel,pts):
        b=panels[panel]['boundsEpsg3006'];r=.16
        return np.asarray([[b[0]+u*r,b[3]-v*r] for u,v in pts])
    primitives=[]
    def common(identifier,facility,material,evidence,**kw):
        return dict(id=identifier,facilityId=facility,materialRole=material,
            evidence=evidence,dimensionStatus='visual-scale-estimate-unless-noted',
            excludeVegetation=False,**kw)
    def box(identifier,facility,material,center,size,angle=0,evidence=None,**kw):
        x=common(identifier,facility,material,evidence or [],type='box',centerENH=rounded(center),
            sizeMetres=rounded(size),rotationRadiansZ=round(float(angle),7),**kw);primitives.append(x);return x
    def cylinder(identifier,facility,material,a,b,r,evidence=None,**kw):
        x=common(identifier,facility,material,evidence or [],type='cylinder',startENH=rounded(a),endENH=rounded(b),
            radiusMetres=r,radialSegments=6,**kw);primitives.append(x);return x
    def mesh(identifier,facility,material,verts,faces,evidence=None,**kw):
        x=common(identifier,facility,material,evidence or [],type='mesh',verticesENH=rounded(verts),
            faces=faces,**kw);primitives.append(x);return x
    def polygon_mesh(identifier,facility,material,poly,height_offset,evidence):
        polys=[poly] if isinstance(poly,Polygon) else list(poly.geoms)
        verts=[];faces=[]
        for pp in polys:
            for tri in triangulate(pp):
                if not pp.buffer(1e-7).covers(tri):continue
                coords=list(tri.exterior.coords)[:3];start=len(verts)
                verts.extend([[e,n,base([e,n])+height_offset] for e,n in coords]);faces.append([start,start+1,start+2])
        return mesh(identifier,facility,material,verts,faces,evidence,castShadow=False)
    photo_range=['photo:range-2025','photo:range-2026','ortho:observed-range-mats']
    matpoints=np.asarray(obs['observed-range-mats']['pointsEpsg3006'])
    apron=Polygon(obs['observed-range-mat-apron']['ringEpsg3006'])
    polygon_mesh('range-apron-rose','range-apron','paving-rose',apron,.025,
                 ['ortho:observed-range-mat-apron','photo:range-2025','photo:range-2026'])
    field_center=np.asarray([697449.,7025365.])
    bases=[]; tangents=[];normals=[];pale_tiles=[]
    for i,p in enumerate(matpoints):
        tangent=unit(matpoints[min(i+1,len(matpoints)-1)]-matpoints[max(i-1,0)])
        normal=np.asarray([-tangent[1],tangent[0]])
        if (field_center-p)@normal<0:normal=-normal
        tangents.append(tangent);normals.append(normal);h=base(p,True);bases.append(h)
        angle=math.atan2(tangent[1],tangent[0])
        mat=box(f'range-mat-{i+1:02d}','range-mats','range-mat',[*p,h+.068],[1.65,1.65,.055],angle,photo_range,
                placementStatus='exact-inventory-observed-center-no-roof-shift')
        mat['sourceObservedCenterEN']=rounded(p)
        tray=p+tangent*1.09
        box(f'range-tray-{i+1:02d}','range-mats','rubber-black',[*tray,base(tray)+.085],[.45,.73,.09],angle,photo_range)
        # Light square pavers are a simple geometric approximation of the observed
        # pink/pale pattern, clipped exactly to the apparent apron outline.
        for offset in [-1.75,-2.3]:
            for du in [-1.04,-.52,0,.52,1.04]:
                if (i+round(du/.52)+round(offset/.55))%2:continue
                c=p+normal*offset+tangent*du;s=.25
                poly=Polygon([c-tangent*s-normal*s,c+tangent*s-normal*s,c+tangent*s+normal*s,c-tangent*s+normal*s]).intersection(apron)
                if not poly.is_empty and poly.area>.01:pale_tiles.append(poly)
    if pale_tiles:polygon_mesh('range-apron-pale-pavers','range-apron','paving-pale',MultiPolygon(pale_tiles),.033,photo_range)
    # Blue bollards and white ropes along the rear edge are visible in the 2025
    # photo. Exact installation spacing is not surveyed; reuse observed bay arc.
    rope_posts=[]
    for i in range(0,len(matpoints),2):
        p=matpoints[i]-normals[i]*2.03;h=base(p)
        if not apron.buffer(.7).covers(Polygon([p+[-.03,-.03],p+[.03,-.03],p+[.03,.03],p+[-.03,.03]])):continue
        box(f'range-rope-post-{i+1:02d}','range-apron','fixture-blue',[*p,h+.5],[.105,.105,1.0],0,photo_range)
        box(f'range-rope-post-base-{i+1:02d}','range-apron','metal-dark',[*p,h+.05],[.25,.25,.07],0,photo_range)
        rope_posts.append(np.asarray([*p,h+.9]))
    for i,(a,b) in enumerate(zip(rope_posts,rope_posts[1:])):
        prev=a
        for j in range(1,7):
            t=j/6;q=a+(b-a)*t;q[2]-=.27*math.sin(math.pi*t)
            cylinder(f'range-rope-{i:02d}-{j}','range-apron','rope-white',prev,q,.018,photo_range);prev=q
    # Ball dispenser outside the inner north end of the L-shaped range wing.
    # Footprint alignment is approximate photo interpretation; height/finish are
    # photograph-derived and cabinet components are deliberately texture-free.
    model_path=HERE/'model-plan.json';model=read(model_path)
    range_wing=next(v for v in model['volumes'] if v['id']=='range-west-wing')
    observed_dispenser=pix('range-buildings',[[300,357]])[0]
    du=np.asarray(range_wing['axisU']);front=np.asarray(range_wing['axisV'])
    wall_center=np.asarray(range_wing['originEpsg3006'])
    dispenser_u=float((observed_dispenser-wall_center)@du)
    dispenser_center=wall_center+du*dispenser_u+front*(range_wing['width']/2+.36+.04)
    angle=math.atan2(du[1],du[0]);dh=base(dispenser_center,True)
    disp_ev=['photo:range-2025','photo:range-2012','ortho:range-buildings-inner-courtyard']
    box('range-dispenser-cabinet','range-ball-dispenser','metal-stainless',[*dispenser_center,dh+1.35],
        [1.5,.72,2.1],angle,disp_ev,placementStatus='photo-interpreted-mount-4cm-outside-model-inner-wall',
        hostVolumeId='range-west-wing',hostWallSide='v+',wallGapMetres=.04)
    for k,u in enumerate([-.58,.58]):
        p=dispenser_center+du*u
        box(f'range-dispenser-leg-{k}','range-ball-dispenser','metal-stainless',[*p,dh+.22],[.075,.5,.44],angle,disp_ev)
    # Wedge hopper top rising towards wall. Width axis du; front axis front.
    def at(u,v,z):return [*(dispenser_center+du*u+front*v),dh+z]
    verts=[at(-.75,-.36,2.4),at(.75,-.36,2.4),at(.75,.36,2.4),at(-.75,.36,2.4),at(-.75,-.36,3.13),at(.75,-.36,3.13)]
    mesh('range-dispenser-sloped-hopper','range-ball-dispenser','metal-stainless',verts,
         [[0,1,5,4],[4,5,2,3],[0,4,3],[1,2,5],[0,3,2,1]],disp_ev)
    for label,u,z,size in [('payment',.43,1.85,[.30,.045,.37]),('outlet',.10,.48,[.29,.075,.18])]:
        p=dispenser_center+du*u+front*.385
        box(f'range-dispenser-{label}','range-ball-dispenser','rubber-black',[*p,dh+z],size,angle,disp_ev)
    # Photo-supported safety structure. The inherited eastern alignment is a
    # context trace; support spacing/height and net sag remain explicit estimates.
    east=np.asarray(obs['inherited-range-net-1']['lineEpsg3006'])
    west=pix('range-buildings',[[211,351],[164,219],[133,138],[105,50],[91,6]])
    def resample(line,pitch):
        lens=np.linalg.norm(np.diff(line,axis=0),axis=1);s=np.concatenate(([0],np.cumsum(lens)))
        q=np.linspace(0,s[-1],int(math.ceil(s[-1]/pitch))+1)
        return np.column_stack([np.interp(q,s,line[:,i]) for i in (0,1)])
    def make_net(identifier,line,height,pitch,evidence):
        pp=resample(line,pitch); hh=[base(p,True) for p in pp]
        for i,(p,h) in enumerate(zip(pp,hh)):
            cylinder(f'{identifier}-pole-{i:02d}',identifier,'net-pole',[*p,h-.15],[*p,h+height],.095,evidence)
        verts=[];faces=[]
        for i in range(len(pp)-1):
            a=pp[i];b=pp[i+1]
            for j in range(4):
                t0=j/4;t1=(j+1)/4;p0=a+(b-a)*t0;p1=a+(b-a)*t1
                h0=hh[i]+(hh[i+1]-hh[i])*t0;h1=hh[i]+(hh[i+1]-hh[i])*t1
                z0=h0+height-.45*math.sin(math.pi*t0);z1=h1+height-.45*math.sin(math.pi*t1)
                idx=len(verts);verts.extend([[*p0,h0+.1],[*p1,h1+.1],[*p1,z1],[*p0,z0]]);faces.append([idx,idx+1,idx+2,idx+3])
                cylinder(f'{identifier}-top-cable-{i:02d}-{j}',identifier,'metal-dark',[*p0,z0],[*p1,z1],.019,evidence)
        mesh(f'{identifier}-mesh',identifier,'net-mesh',verts,faces,evidence,doubleSided=True,castShadow=False,
             notes='Translucent proxy for fine mesh; regularized support spacing and sag are estimated, not measured.')
    make_net('range-east-net',east,10.,12.,['inherited:range-net-1','photo:range-2026','photo:flickr-34163074006'])
    make_net('range-west-near-net',west,6.,10.,['ortho:range-buildings-visible-west-line','photo:range-2025'])
    # Three actual ground anchors identified at the left ends of apparent tilted
    # pole traces; heights estimated from the photographs, not roof geometry.
    flagpoints=pix('clubhouse-courtyard',[[463,232],[475,264],[488,295]])
    for i,p in enumerate(flagpoints):
        h=base(p,True)
        box(f'courtyard-flag-base-{i+1}','courtyard-flags','paving-pale',[*p,h+.07],[.62,.62,.14],0,['photo:clubhouse-2018','ortho:clubhouse-courtyard'])
        cylinder(f'courtyard-flagpole-{i+1}','courtyard-flags','flagpole-white',[*p,h+.08],[*p,h+9.5],.055,
                 ['photo:clubhouse-2018','photo:terrace-2022','ortho:clubhouse-courtyard'],notes='Pole height estimated; flags vary by occasion and are not assigned an invented graphic.')
    fence=pix('clubhouse-courtyard',[[443,180],[464,235],[479,278],[487,311],[481,331],[438,341]])
    fposts=resample(fence,2.25); fh=[base(p) for p in fposts]
    fence_ev=['photo:terrace-2022','photo:clubhouse-2018','ortho:clubhouse-courtyard']
    for i,(p,h) in enumerate(zip(fposts,fh)):
        cylinder(f'courtyard-fence-post-{i:02d}','courtyard-fence','timber-dark',[*p,h-.08],
                 [p[0]+.04*((i%3)-1),p[1],h+1.65+.13*(i%4)],.05,fence_ev)
    for i,(a,b) in enumerate(zip(fposts,fposts[1:])):
        for j,offset in enumerate([.32,.57,.82,1.04]):
            cylinder(f'courtyard-fence-rail-{i:02d}-{j}','courtyard-fence','timber-dark',
                     [*a,fh[i]+offset],[*b,fh[i+1]+offset],.035,fence_ev)
    camper=np.asarray(obs['observed-clubhouse-west-fence']['lineEpsg3006'])
    cp=resample(camper,2.1);ch=[base(p) for p in cp]
    for i,p in enumerate(cp):
        box(f'camper-fence-post-{i:02d}','camper-fence','timber-red',[*p,ch[i]+.65],[.105,.105,1.3],0,
            ['ortho:observed-clubhouse-west-fence','photo:flickr-34163074006'])
    verts=[];faces=[]
    for i,(a,b) in enumerate(zip(cp,cp[1:])):
        k=len(verts);verts.extend([[*a,ch[i]+.06],[*b,ch[i+1]+.06],[*b,ch[i+1]+1.12],[*a,ch[i]+1.12]]);faces.append([k,k+1,k+2,k+3])
    mesh('camper-fence-panels','camper-fence','timber-red',verts,faces,
         ['ortho:observed-clubhouse-west-fence','photo:flickr-34163074006'],doubleSided=True)
    colors={
        'range-mat':([.07,.29,.095,1],.95,0),'rubber-black':([.025,.029,.028,1],.9,0),
        'paving-rose':([.49,.285,.23,1],.94,0),'paving-pale':([.62,.59,.50,1],.98,0),
        'fixture-blue':([.17,.34,.40,1],.6,0),'rope-white':([.83,.81,.7,1],.96,0),
        'metal-stainless':([.51,.54,.54,1],.38,.65),'metal-dark':([.085,.10,.1,1],.75,.3),
        'net-pole':([.19,.205,.185,1],.8,.15),'net-mesh':([.045,.075,.055,.17],1.,0),
        'timber-dark':([.115,.10,.077,1],.98,0),'timber-red':([.34,.058,.035,1],.94,0),
        'flagpole-white':([.83,.85,.83,1],.47,.15)}
    materials={k:dict(baseColorRGBA=c,roughness=r,metallic=m,alphaMode='BLEND' if c[3]<1 else 'OPAQUE',doubleSided=k=='net-mesh') for k,(c,r,m) in colors.items()}
    plan=dict(schemaVersion=1,groundId='puttom',preparedAt='2026-09-10',
        frame=dict(horizontalCrs='EPSG:3006',verticalDatum='RH2000',coordinateOrder='Easting, Northing, Height',
                   coordinates='absoluteENH',blenderOriginENH=ORIGIN,axes='X east, Y grid north, Z up',unit='metre'),
        sourceInventory=dict(file=inv_path.relative_to(ROOT).as_posix(),sha256=digest(inv_path)),
        sourceModelPlan=dict(file=model_path.relative_to(ROOT).as_posix(),sha256=digest(model_path),use='dispenser wall attachment only'),
        groundSource=dict(file=laser_path.relative_to(ROOT).as_posix(),sha256=digest(laser_path),classification=2,
            campaign='June 2023',groundReturnCount=len(ground),heightSampling='36 nearest class-2 returns, robust local plane; geometry surface offsets 0.025-0.068 m',
            supplementaryGroundWindow=dict(file=extra_path.relative_to(ROOT).as_posix(),sha256=digest(extra_path),ledger=extra_ledger.relative_to(ROOT).as_posix(),boundsEpsg3006=extra_meta['boundsEpsg3006']),
            notes='No roof displacement correction applied to any ground object; planar sampling is not entrance/floor measurement.'),
        materialDefinitions=materials,primitives=primitives,groundChecks=ground_checks,
        suppressionHints=[
            dict(flag='replacesRangeFacilities',value=True,replaces='entire legacy RF generated mats, strip, kerb, solid dividers and east net'),
            dict(facility='courtyard-flags',replaces='generic clubhouse-loop terrace/flagpole geometry once corresponding authored building is loaded'),
            dict(facility='cartPark',keepExisting=True,notes='No golf cart geometry is included in this site plan.')],
        limitations=[
            '17 mat centres come directly from native 2024 imagery; mat/tray dimensions and blue-post spacing are photo-scaled estimates.',
            'Net alignment on east is inherited traced context; west only covers the near run visible in the detailed panel. Exact post heights, pole count and sag are estimated.',
            'Dispenser location along the inner range wall is photograph-interpreted; cabinet is mounted 4 cm outside model-plan range-west-wing v+ wall.',
            'Flagpole ground anchors and garden fence were interpreted from native image. Exact heights, rail construction and vertical finished levels are not surveyed.',
            'No ground tee, green, bunker, fairway or terrain mesh is changed. These meshes are facility surfaces/fixtures only.'])
    plan['summary']=dict(primitives=len(primitives),observedRangeMats=17,rangeTrays=17,flagpoles=3,
        facilityIds=sorted({p['facilityId'] for p in primitives}),materials=len(materials),
        estimatedDispenserHeightMetres=3.13,estimatedEastNetHeightMetres=10.,estimatedNearWestNetHeightMetres=6.)
    plan=apply_ground_contacts(preserved_plan or plan,base)
    (HERE/'site-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(plan['summary']))

if __name__=='__main__':main()
