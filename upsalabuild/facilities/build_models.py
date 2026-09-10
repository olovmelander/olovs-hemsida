"""Build the Upsala exterior assets in a separate Blender scene.

Run in Blender through runpy.run_path, or blender --background --python this.py.
XY is the course east/north frame, Z is RH2000 until final mesh creation.
The live user's scene, selection and saved file are deliberately not replaced.
"""
import collections
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'upsalabuild/facilities/models-2026-09-10'
PLAN = json.loads((OUT / 'model-plan.json').read_text(encoding='utf-8'))
ROOFS = json.loads((OUT / 'roof-measurements.json').read_text(encoding='utf-8'))
FACETS = json.loads((OUT / 'roof-facets.json').read_text(encoding='utf-8'))
AX, AZ = PLAN['anchorLocalXZ']
AH = PLAN['anchorHeightRH2000']
PALETTE = dict(plaster=0xE7E4CD, white=0xEEEDE3, trim=0x454B49, glass=0x30464B,
               tile=0xB78257, tileLine=0x98714F, roof=0x414847, roofLine=0x343B3A,
               red=0x913E31, redLine=0x79372E, wood=0x8B795F, stone=0x8D887C,
               metal=0x858B87, mat=0x315D40, terrace=0xAC9980)

def xy(p): return (p[0], -p[1])
def add(a,b): return tuple(x+y for x,y in zip(a,b))
def mul(a,t): return tuple(x*t for x in a)
def unit(a): return mul(a,1/math.sqrt(sum(x*x for x in a)))
def lerp(a,b,t): return add(mul(a,1-t),mul(b,t))
def area(r): return sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r))/2
def ccw(r):
    r=list(r)
    if r[0]==r[-1]: r=r[:-1]
    return r if area(r)>0 else r[::-1]
def inside(p,r):
    yes=False
    for i,a in enumerate(r):
        b=r[(i+1)%len(r)]
        if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:yes=not yes
    return yes
def plane_h(p,pt):
    ox,oz=p['originLocalXZ']
    return p['a']*(pt[0]-ox)+p['b']*(pt[1]+oz)+p['c']
def component_h(c,pt): return min(plane_h(p,pt) for p in c['roofPlanes'])
def roof_h(components,pt):
    heights=[component_h(c,pt) for c in components if inside(pt,[xy(p) for p in c['domainRoofRingLocalXZ']])]
    # Municipal outlines can denote roof edges, and interpreted eaves have .8m uncertainty.
    if not heights:
        nearest=min(components,key=lambda c:min(math.dist(pt,xy(p)) for p in c['domainRoofRingLocalXZ']))
        heights=[component_h(nearest,pt)]
    return max(heights)

class Builder:
    def __init__(self, asset, scene):
        self.asset=asset;self.scene=scene;self.groups=collections.defaultdict(lambda:[[],[]]);self.foundations=[]
        self.collection=bpy.data.collections.new(asset['id']);scene.collection.children.link(self.collection)
    def mesh(self,label,color,vertices,faces):
        vs,fs=self.groups[(label,color)];n=len(vs);vs.extend(tuple(p) for p in vertices)
        fs.extend(tuple(i+n for i in f) for f in faces)
    def polygon(self,label,color,points):
        if len(points)<3:return
        points=[Vector(p) for p in points]
        triangles=tessellate_polygon([points])
        for t in triangles:self.mesh(label,color,[points[i] for i in t] if isinstance(t[0],int) else t,[(0,1,2)])
    def box(self,label,color,center,size,axis=(1,0)):
        u=axis;v=(-u[1],u[0]);l,w,h=size
        verts=[(center[0]+u[0]*s*l/2+v[0]*t*w/2,center[1]+u[1]*s*l/2+v[1]*t*w/2,center[2]+q*h/2) for q in (-1,1) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
        self.mesh(label,color,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    def beam(self,label,color,a,b,width=.08,depth=None):
        d=Vector(b)-Vector(a)
        if d.length<.0001:return
        u=d.normalized();helper=Vector((0,0,1)) if abs(u.z)<.98 else Vector((1,0,0))
        v=u.cross(helper).normalized()*width/2;w=u.cross(v).normalized()*(depth or width)/2
        vs=[Vector(p)+s*v+t*w for p in (a,b) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
        self.mesh(label,color,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    def slab(self,label,color,ring,base,top):
        ring=ccw(ring);n=len(ring)
        self.polygon(label,color,[(x,y,top) for x,y in ring])
        for i,p in enumerate(ring):
            q=ring[(i+1)%n];self.mesh(label,color,[(p[0],p[1],base),(q[0],q[1],base),(q[0],q[1],top),(p[0],p[1],top)],[(0,1,2,3)])
    def foundation(self,ring,top):
        self.foundations.append(dict(ring=[[x,-y] for x,y in ring],topHeightRH2000=top,color=PALETTE['stone'],maxGroundGapMetres=6))
    def walls(self,label,ring,base,height,color,windows=False,doors=False,cladding=False):
        ring=ccw(ring)
        for i,p in enumerate(ring):
            q=ring[(i+1)%len(ring)];length=math.dist(p,q);u=unit((q[0]-p[0],q[1]-p[1]));normal=(u[1],-u[0])
            count=max(1,math.ceil(length/.8))
            top=lambda t:height(lerp(p,q,t)) if callable(height) else height
            for j in range(count):
                a,b=lerp(p,q,j/count),lerp(p,q,(j+1)/count)
                self.mesh(label+' walls',color,[(a[0],a[1],base),(b[0],b[1],base),(b[0],b[1],top((j+1)/count)),(a[0],a[1],top(j/count))],[(0,1,2,3)])
            self.beam(label+' sill',PALETTE['stone'],(*p,base+.12),(*q,base+.12),.18,.2)
            self.beam(label+' corners',PALETTE['white'] if color==PALETTE['red'] else PALETTE['trim'],(*p,base+.2),(*p,min(top(0),base+3.45)),.10)
            if length>3 and windows:
                number=max(1,int((length-.9)/2.55))
                for j in range(number):
                    point=lerp(p,q,(j+.5)/number);door=doors=='all' or (doors and j==number//2)
                    cap=top((j+.5)/number)
                    h=min(2.2 if door else 1.48,cap-base-.5)
                    if h>.7:self.window(label,point,u,normal,base+(.16 if door else .92),min(1.5,length/(number+1)*.72),h)
            if cladding:
                for j in range(1,int(length/.48)):
                    t=j*.48/length;point=add(lerp(p,q,t),mul(normal,.012))
                    self.beam(label+' board seams',PALETTE['redLine'],(*point,base+.15),(*point,top(t)-.06),.021)
    def window(self,label,p,u,n,bottom,width,height,frame=None):
        c=add(p,mul(n,.055));frame=frame or PALETTE['trim']
        self.box(label+' glazing',PALETTE['glass'],(*c,bottom+height/2),(width,.045,height),u)
        c=add(p,mul(n,.09))
        for s in (-1,1):
            v=add(c,mul(u,s*(width/2+.035)))
            self.box(label+' frames',frame,(*v,bottom+height/2),(.08,.09,height+.14),u)
        for z in (bottom-.03,bottom+height+.03):self.box(label+' frames',frame,(*c,z),(width+.14,.10,.08),u)
        self.box(label+' mullions',frame,(*c,bottom+height/2),(.055,.07,height),u)
        self.box(label+' lintels',PALETTE['white'],(*add(p,mul(n,.035)),bottom+height+.16),(width+.28,.12,.12),u)
    def railing(self,label,a,b,base,height=.95,cross=False):
        length=math.dist(a,b);count=max(1,math.ceil(length/1.55));c=PALETTE['wood']
        for j in range(count+1):
            p=lerp(a,b,j/count);self.beam(label+' posts',c,(*p,base),(*p,base+height),.09)
        for z in (base+.22,base+height):self.beam(label+' rails',c,(*a,z),(*b,z),.085)
        if cross:
            for j in range(count):
                p,q=lerp(a,b,j/count),lerp(a,b,(j+1)/count)
                self.beam(label+' cross rails',c,(*p,base+.23),(*q,base+height-.08),.055)
                self.beam(label+' cross rails',c,(*q,base+.23),(*p,base+height-.08),.055)
    def finalize(self):
        parts=[];triangles=0
        for (label,color),(vs,fs) in sorted(self.groups.items()):
            if not fs:continue
            mesh=bpy.data.meshes.new(self.asset['id']+' | '+label)
            mesh.from_pydata([(x-AX,y+AZ,z-AH) for x,y,z in vs],[],fs);mesh.update();mesh.calc_loop_triangles()
            obj=bpy.data.objects.new(self.asset['id']+' | '+label,mesh);self.collection.objects.link(obj)
            mat=material(color);mesh.materials.append(mat)
            obj['asset_id']=self.asset['id'];obj['color_srgb_hex']=color;obj['display_interpretation']=True
            positions=[round(c,4) for v in mesh.vertices for c in (v.co.x+AX,v.co.z+AH,AZ-v.co.y)]
            indices=[i for tri in mesh.loop_triangles for i in tri.vertices]
            triangles+=len(indices)//3;parts.append(dict(name=label,color=color,positions=positions,indices=indices))
        record={k:self.asset[k] for k in ('id','renderOnBuildingId','replaces')}
        record.update(parts=parts,foundations=self.foundations,
                      referenceOutlines=[dict(sourceId=f['id']+'/municipal:'+str(f['sourceId']),ring=f['ring']) for f in self.asset['features']],
                      evidence='Municipal plans + Lantmateriet 2025-06-14 orthophoto; coherent 2021 laser roof planes where available; 2026 club photos. Facade detail is a measured visual interpretation, not a surveyed as-built model.')
        return record,triangles

_mats={}
def material(color):
    if color in _mats:return _mats[color]
    mat=bpy.data.materials.new('Upsala | #%06x'%color);mat.use_nodes=True
    s=[((color>>shift)&255)/255 for shift in (16,8,0)]
    linear=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in s]
    mat.diffuse_color=(*linear,1);bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(*linear,1)
    bsdf.inputs['Roughness'].default_value=.38 if color==PALETTE['glass'] else .8
    _mats[color]=mat;return mat

def gable_components(f,eave,rise):
    u=f['axisXY'];v=(-u[1],u[0]);c=f['centreXY'];l,w=f['length']+.5,f['width']+.5
    ring=[add(c,add(mul(u,s*l/2),mul(v,t*w/2))) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
    planes=[dict(id=f['id']+'-estimated-'+str(s),originLocalXZ=[c[0],-c[1]],a=s*v[0]*rise/(w/2),b=s*v[1]*rise/(w/2),c=eave+rise) for s in (-1,1)]
    return [dict(id=f['id']+'-estimated-gable',sourceBuildingIds=[f['id']],domainRoofRingLocalXZ=[[x,-y] for x,y in ring],roofPlanes=planes,ridgeAxisLocalXZ=[[p[0],-p[1]] for p in (add(c,mul(u,-l/2)),add(c,mul(u,l/2)))])]

def clip_half(poly,fn):
    out=[]
    for i,p in enumerate(poly):
        q=poly[(i+1)%len(poly)];a,b=fn(p),fn(q)
        if a>=-1e-8:out.append(p)
        if (a>=0)!=(b>=0):out.append(lerp(p,q,a/(a-b)))
    return out

def roof_geometry(builder,components,tiled=True):
    for component in components:
        uses_tile=tiled and component.get('roofMaterial')!='dark-metal'
        color=PALETTE['tile' if uses_tile else 'roof'];line=PALETTE['tileLine' if uses_tile else 'roofLine']
        for pi,p in enumerate(component['roofPlanes']):
            # The precomputed union removes hidden faces at valleys/intersections.
            saved=[f for f in FACETS['facets'] if f['componentId']==component['id'] and f['planeId']==p['id']]
            polygons=[f.get('exteriorLocalXZ',f.get('ringLocalXZ')) for f in saved]
            if not saved:
                polygon=[xy(v) for v in component['domainRoofRingLocalXZ']]
                for other in component['roofPlanes']:
                    if other is not p:polygon=clip_half(polygon,lambda pt:plane_h(other,pt)-plane_h(p,pt))
                polygons=[[[x,-y] for x,y in polygon]] if len(polygon)>2 else []
            for polygon_index,ring in enumerate(polygons):
                ring=ccw([xy(v) for v in ring]);label=component['id']
                verts=[(x,y,plane_h(p,(x,y))+.025) for x,y in ring]
                if saved:
                    facet=saved[polygon_index]
                    builder.mesh(label+' roof',color,[(x,-z,h+.025) for x,h,z in facet['verticesCourseXYZ']],facet['triangles'])
                else:builder.polygon(label+' roof',color,verts)
                for i,a in enumerate(verts):
                    b=verts[(i+1)%len(verts)];builder.beam(label+' roof edges',PALETTE['trim'],a,b,.075,.12)
                # Narrow raised horizontal courses read as tiles without image textures.
                lo=min(v[2] for v in verts);hi=max(v[2] for v in verts)
                spacing=.16 if uses_tile else .44
                for j in range(math.ceil(lo/spacing),math.floor(hi/spacing)+1):
                    z=j*spacing;hits=[]
                    for i,a in enumerate(ring):
                        b=ring[(i+1)%len(ring)];ha,hb=plane_h(p,a),plane_h(p,b)
                        if (ha<=z<hb) or (hb<=z<ha):hits.append(lerp(a,b,(z-ha)/(hb-ha)))
                    if len(hits)>=2:
                        direction=unit((p.get('b',0),-p.get('a',1)))
                        hits.sort(key=lambda v:v[0]*direction[0]+v[1]*direction[1])
                        for i in range(0,len(hits)-1,2):builder.beam(label+' roof courses',line,(*hits[i],z+.045),(*hits[i+1],z+.045),.026,.021)
        ridge=component.get('ridgeAxisLocalXZ')
        if ridge:
            a,b=[xy(v) for v in ridge];builder.beam(component['id']+' ridge',color,(*a,component_h(component,a)+.09),(*b,component_h(component,b)+.09),.18,.13)

def facade_gable(builder,c,base):
    ridge=[xy(p) for p in c['ridgeAxisLocalXZ']];u=unit((ridge[1][0]-ridge[0][0],ridge[1][1]-ridge[0][1]));v=(-u[1],u[0]);w=c.get('roofWidthMetres',7.9)/2-.1
    for end,normal in ((ridge[0],mul(u,-1)),(ridge[1],u)):
        a,b=add(end,mul(v,-w)),add(end,mul(v,w));eave=min(component_h(c,a),component_h(c,b));peak=component_h(c,end)
        builder.polygon('central gable plaster',PALETTE['plaster'],[(*a,base),(*b,base),(*b,eave),(*end,peak),(*a,eave)])
        for s in (-1,0,1):
            builder.window('central upper floor',add(end,mul(v,s*2.05)),v,normal,base+3.68,1.35,1.45)
            builder.window('central entrance glazing',add(end,mul(v,s*2.05)),v,normal,base+.14,1.50,2.30)
        # The photographed small pointed attic window and crossed dark gable boards.
        center=add(end,mul(normal,.08));z=eave+.55
        points=[(*add(center,mul(v,-.45)),z),(*add(center,mul(v,.45)),z),(*add(center,mul(v,.45)),z+.57),(*center,z+1.0),(*add(center,mul(v,-.45)),z+.57)]
        builder.polygon('pointed attic glazing',PALETTE['glass'],points)
        for i,p in enumerate(points):builder.beam('attic window trim',PALETTE['trim'],p,points[(i+1)%len(points)],.075)
        for s in (-1,1):builder.beam('crossed attic boards',PALETTE['trim'],(*add(center,mul(v,s*.48)),z+.4),(*add(center,mul(v,-s*1.2)),peak-.5),.09)
        builder.beam('gable storey band',PALETTE['trim'],(*a,base+3.32),(*b,base+3.32),.12)

def roof_junction_walls(builder,components,base,color=None,close_upper_walls=False):
    """Close height steps where a taller roof domain ends above a lower wing."""
    for c in components:
        ring=ccw([xy(p) for p in c['domainRoofRingLocalXZ']])
        for i,a in enumerate(ring):
            b=ring[(i+1)%len(ring)];steps=max(1,math.ceil(math.dist(a,b)/.35))
            direction=unit((b[0]-a[0],b[1]-a[1]));offset=(direction[1]*.04,-direction[0]*.04)
            for j in range(steps):
                p,q=lerp(a,b,j/steps),lerp(a,b,(j+1)/steps);mid=lerp(p,q,.5)
                others=[o for o in components if o is not c and any(inside(test,[xy(v) for v in o['domainRoofRingLocalXZ']]) for test in (mid,add(mid,offset),add(mid,mul(offset,-1))))]
                if not others and 'central-raised' not in c['id'] and not close_upper_walls:continue
                bottom=lambda pt:max(component_h(o,pt) for o in others) if others else base+(2.4 if close_upper_walls else 3.32)
                if component_h(c,mid)<=bottom(mid)+.03:continue
                lowp,lowq=bottom(p),bottom(q);hip,hiq=component_h(c,p),component_h(c,q)
                builder.mesh('roof intersection cheek walls',color or PALETTE['plaster'],[(*p,min(lowp,hip)),(*q,min(lowq,hiq)),(*q,hiq),(*p,hip)],[(0,1,2,3)])

def clubhouse(builder,asset):
    f=asset['features'][0];components=ROOFS['clubhouseComponents'];base=f['baseRH2000']
    builder.foundation(f['ringXY'],base+.12)
    builder.walls('clubhouse',f['ringXY'],base,lambda p:roof_h(components,p),PALETTE['plaster'],True,True)
    roof_geometry(builder,components,True)
    roof_junction_walls(builder,components,base)
    facade_gable(builder,next(c for c in components if 'central-raised' in c['id']),base)
    west=next(c for c in components if 'west-terrace' in c['id']);ridge=[xy(p) for p in west['ridgeAxisLocalXZ']];u=unit((ridge[1][0]-ridge[0][0],ridge[1][1]-ridge[0][1]));out=(u[1],-u[0])
    # Confirm outward side points toward the photographed southwest terrace.
    if out[1]>0:out=mul(out,-1)
    for dormer in ROOFS.get('terraceDormers',[]):
        center=xy(dormer['centreLocalXZ']);w=2.7/2;depth=2.5;front=add(center,mul(out,.25));back=add(front,mul(out,-depth))
        z=component_h(west,front)+.04;peak=z+1.35
        left,right=add(front,mul(u,-w)),add(front,mul(u,w));backleft,backright=add(back,mul(u,-w)),add(back,mul(u,w))
        builder.polygon('terrace dormer face',PALETTE['plaster'],[(*left,z-.2),(*right,z-.2),(*front,peak)])
        for edge,rear in ((left,backleft),(right,backright)):
            builder.polygon('terrace dormer cheeks',PALETTE['plaster'],[(*edge,z-.12),(*rear,component_h(west,rear)),(*back,peak),(*front,peak)])
            builder.polygon('terrace dormer roof',PALETTE['tile'],[(*edge,z+.04),(*rear,component_h(west,rear)+.06),(*back,peak+.06),(*front,peak+.06)])
            builder.beam('terrace dormer bargeboard',PALETTE['trim'],(*edge,z),(*front,peak),.13)
    # Lower attached veranda: own measured gable, not another full-height wing.
    f2=asset['features'][1];aux=next(b for b in ROOFS['auxiliaryBuildings'] if b['id']=='B02');cs=aux['roofComponents']
    builder.foundation(f2['ringXY'],base+.12);builder.walls('west veranda',f2['ringXY'],base,lambda p:roof_h(cs,p),PALETTE['plaster'],True,True);roof_geometry(builder,cs,True)
    # The main restaurant frontage is paved; the timber deck/railing is farther
    # west beside the lower veranda, not across the main entry courtyard.
    a,b=ridge;v=out;wa=add(a,mul(v,6.75));wb=add(b,mul(v,6.75));da=add(wa,mul(v,5.0));db=add(wb,mul(v,5.0));deck=[wa,wb,db,da]
    builder.slab('restaurant paved terrace',PALETTE['terrace'],deck,base-.15,base+.04);builder.foundation(deck,base+.04)
    for t in (.25,.5,.75):
        p,q=lerp(wa,da,t),lerp(wb,db,t);builder.beam('terrace paving joints',PALETTE['stone'],(*p,base+.055),(*q,base+.055),.02)
    vu=f2['axisXY'];vo=(-vu[1],vu[0])
    if vo[0]>0:vo=mul(vo,-1)
    vc=f2['centreXY'];a=add(add(vc,mul(vu,-f2['length']/2)),mul(vo,f2['width']/2));b=add(add(vc,mul(vu,f2['length']/2)),mul(vo,f2['width']/2))
    c,d=add(a,mul(vo,4.4)),add(b,mul(vo,4.4));west_deck=[a,b,d,c]
    builder.slab('west timber terrace',PALETTE['wood'],west_deck,base-.25,base+.04);builder.foundation(west_deck,base+.04)
    builder.railing('west timber terrace',c,d,base+.05,cross=True);builder.railing('west deck end',a,c,base+.05,cross=True)
    # The low entrance canopy on the south wing, located along its terrace-facing eave.
    south=next(c for c in components if 'south-wing' in c['id']);sr=[xy(p) for p in south['ridgeAxisLocalXZ']];su=unit((sr[1][0]-sr[0][0],sr[1][1]-sr[0][1]));sv=(-su[1],su[0])
    if sv[0]>0:sv=mul(sv,-1)
    start=add(lerp(*sr,.2),mul(sv,6.8));end=add(lerp(*sr,.65),mul(sv,6.8));a,b=add(start,mul(sv,1.6)),add(end,mul(sv,1.6))
    builder.polygon('south entrance canopy',PALETTE['tile'],[(*start,base+3.0),(*end,base+3.0),(*b,base+2.6),(*a,base+2.6)])
    for p in (a,b):builder.beam('entrance canopy posts',PALETTE['trim'],(*p,base),(*p,base+2.6),.11)
    # Modest roof vents in positions visible on the north roof.
    nr=[xy(p) for p in components[0]['ridgeAxisLocalXZ']]
    for t in (.25,.68):
        p=lerp(*nr,t);h=component_h(components[0],p);builder.box('north roof vents',PALETTE['metal'],(*p,h+.25),(.65,.7,.5),unit((nr[1][0]-nr[0][0],nr[1][1]-nr[0][1])))

def auxiliary(builder,asset):
    measured={a['id']:a for a in ROOFS['auxiliaryBuildings']}
    for f in asset['features']:
        ident=f['id'];base=f['baseRH2000'];ring=f['ringXY'];u=f['axisXY'];v=(-u[1],u[0]);center=f['centreXY']
        if ident=='B07':
            base=next(a['baseRH2000'] for a in asset['features'] if a['id']=='B06')+.08
            builder.slab('practice porch platform',PALETTE['wood'],ring,base-.22,base);builder.foundation(ring,base)
            for i,a in enumerate(ccw(ring)):
                b=ccw(ring)[(i+1)%len(ring)]
                if math.dist(a,b)>8:builder.railing('practice deck',a,b,base,cross=True)
            continue
        light=ident in ('B03','B09','B11','B14','B15','B19')
        color=PALETTE['plaster' if light else 'red'];tiled=ident in ('B04','B05')
        eave=base+(3.6 if ident in ('B10','B11','B12','B16') else 2.8)
        rise=min(3.3,f['width']*.28)
        components=measured.get(ident,{}).get('roofComponents') or gable_components(f,eave,rise)
        builder.foundation(ring,base+.1)
        if ident=='B08':
            # Range is an open hitting shelter, with a rear wall and individual bays.
            eave=base+3.2;components=measured.get(ident,{}).get('roofComponents') or gable_components(f,eave,1.15)
            r=ccw(ring);long_edges=sorted([(math.dist(p,r[(i+1)%len(r)]),p,r[(i+1)%len(r)]) for i,p in enumerate(r)],reverse=True)
            _,a,b=max(long_edges[:2],key=lambda e:(e[1][1]+e[2][1])/2)
            builder.walls('range rear wall',[a,b,add(b,mul(v,.12)),add(a,mul(v,.12))],base,lambda p:roof_h(components,p),PALETTE['red'],cladding=True)
            fronta,frontb=min(long_edges[:2],key=lambda e:(e[1][1]+e[2][1])/2)[1:]
            count=max(4,round(math.dist(fronta,frontb)/2.45))
            builder.slab('range concrete platform',PALETTE['stone'],ring,base-.2,base+.06)
            for j in range(count+1):
                p=lerp(fronta,frontb,j/count);builder.beam('range structural posts',PALETTE['white'],(*p,base),(*p,roof_h(components,p)),.13)
                # The app already renders30 individually traced range mats.
                # Do not synthesize another regularly spaced row under this roof.
            for c in components:
                if 'rear-extension' in c['id']:
                    rr=[xy(p) for p in c['domainRoofRingLocalXZ']];rc=tuple(sum(p[k] for p in rr)/len(rr) for k in (0,1))
                    rr=[lerp(p,rc,.04) for p in rr]
                    builder.walls('range rear store',rr,base,lambda p:component_h(c,p),PALETTE['red'],cladding=True)
                    builder.foundation(rr,base+.1)
            roof_geometry(builder,components,False);continue
        builder.walls(ident,ring,base,lambda p:roof_h(components,p),color,ident not in ('B04','B10','B11','B12','B13','B16','B18','B19'),ident in ('B03','B05','B06','B14'),not light)
        roof_geometry(builder,components,tiled)
        roof_junction_walls(builder,components,base,color,close_upper_walls=len(components)>1)
        # Barn/service doors are distinct from residential glazing; documented style,
        # approximate facade positions when the source photos do not resolve openings.
        if ident in ('B04','B10','B11','B12','B16'):
            r=ccw(ring);_,a,b=max((math.dist(p,r[(i+1)%len(r)]),p,r[(i+1)%len(r)]) for i,p in enumerate(r));edge=unit((b[0]-a[0],b[1]-a[1]));n=(edge[1],-edge[0])
            count=1 if ident in ('B04','B16') else 3
            for j in range(count):
                p=lerp(a,b,(j+1)/(count+1));builder.window(ident+' service doors',p,edge,n,base+.13,1.25 if ident=='B04' else 2.5,2.6,PALETTE['white'])
            if ident=='B04':
                for t in (.12,.32,.68,.88):
                    p=lerp(a,b,t);builder.window('barn small openings',p,edge,n,base+1.02,.5,.58,PALETTE['redLine'])
                for t in (.16,.5,.84):
                    p=lerp(a,b,t);builder.window('barn upper vents',p,edge,n,base+2.95,.44,.34,PALETTE['redLine'])
        if ident=='B05':
            # Entrance porch lies on the southern short gable in the2026 drone view.
            end=add(center,mul(u,(-1 if u[1]>0 else 1)*f['length']/2));out=unit((end[0]-center[0],end[1]-center[1]));side=(-out[1],out[0]);a,b=add(end,mul(side,-2.5)),add(end,mul(side,2.5));c,d=add(a,mul(out,1.8)),add(b,mul(out,1.8))
            builder.slab('red house porch',PALETTE['wood'],[a,b,d,c],base-.18,base+.05)
            builder.polygon('red house porch roof',PALETTE['tile'],[(*a,base+2.8),(*b,base+2.8),(*d,base+2.35),(*c,base+2.35)])
            for p in (c,d):builder.beam('red house porch posts',PALETTE['white'],(*p,base),(*p,base+2.35),.10)
            builder.railing('red house porch',c,d,base+.05,cross=True)

def main():
    original_scene=bpy.context.window.scene if bpy.context.window else None
    original_file=bpy.data.filepath
    scene=bpy.data.scenes.new('UPSALA | Finished facilities | 2026-09-10')
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    scene['course_frame']=json.dumps(PLAN['frame']);scene['anchor_course_xz']=PLAN['anchorLocalXZ'];scene['anchor_rh2000']=AH
    scene['display_interpretation']='Source-grounded exterior interpretation; facade dimensions and unmeasured service roofs remain estimates.'
    assets=[];counts={}
    for asset in PLAN['assets']:
        b=Builder(asset,scene)
        if asset['id']=='upsala-clubhouse':clubhouse(b,asset)
        else:auxiliary(b,asset)
        record,count=b.finalize();assets.append(record);counts[asset['id']]=count
    output=dict(schemaVersion=1,groundId='upsala',frame=PLAN['frame'],assets=assets)
    assert sum(counts.values())<100000
    runtime=ROOT/'apps/golf/src/engine/scenery/upsala-authored-meshes.json'
    runtime.write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf-8')
    # Library write is safe in the user's live Blender. A separate background
    # export converts it to a normal editable .blend and exports GLB.
    blend=OUT/'upsala-facilities.blend'
    bpy.data.libraries.write(str(blend),{scene},fake_user=True,compress=True)
    report=dict(sceneName=scene.name,anchorLocalXZ=PLAN['anchorLocalXZ'],anchorHeightRH2000=AH,
                assets=len(assets),municipalParts=sum(len(a['features']) for a in PLAN['assets']),triangles=sum(counts.values()),trianglesByAsset=counts,
                meshJsonBytes=runtime.stat().st_size,meshJsonSha256=hashlib.sha256(runtime.read_bytes()).hexdigest(),
                preservedLiveScene=bpy.context.window.scene==original_scene if bpy.context.window else True,preservedLiveFile=bpy.data.filepath==original_file,
                blendPath=str(blend.relative_to(ROOT)).replace('\\','/'),blenderVersion=bpy.app.version_string)
    (OUT/'model-build-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
