"""Observed range fixtures and nearby buildings; no imported photographic textures.

Plan comes from native orthophoto traces. Range appearance is observed in the
official 2024-07-12 photographs. Secondary buildings are explicitly massing.
"""
import math
import statistics


def oriented(ring):
    if ring[0]==ring[-1]:ring=ring[:-1]
    a,b=max(zip(ring,ring[1:]+ring[:1]),key=lambda e:math.dist(*e))
    dx,dy=b[0]-a[0],b[1]-a[1]
    if dx<0:dx,dy=-dx,-dy
    angle=math.atan2(dy,dx);c,s=math.cos(angle),math.sin(angle)
    uv=[(x*c+y*s,-x*s+y*c) for x,y in ring]
    lo=[min(p[i] for p in uv) for i in (0,1)];hi=[max(p[i] for p in uv) for i in (0,1)]
    u,v=(lo[0]+hi[0])/2,(lo[1]+hi[1])/2
    return (u*c-v*s,u*s+v*c),hi[0]-lo[0],hi[1]-lo[1],angle


def build(g,features,ground):
    report={'buildings':[],'matCount':0,'limitations':[
        'Building heights and hidden elevations estimated; nearby estate/yard buildings remain massing.',
        'Range canopy support layout and fixture dimensions inferred from exterior photos.',
        'No interiors; no assumed ownership or use for unnamed neighbouring buildings.']}
    for f in features:
        if f['kind']!='roof' or f['id']=='clubhouse-main':continue
        g.feature=f['id'];name=f['id']+' | ';ring=f['ringBlenderXY']
        center,L,W,angle=oriented(ring);cx,cy=center;c,s=math.cos(angle),math.sin(angle)
        def p(x,y,z):return (cx+c*x-s*y,cy+s*x+c*y,z)
        def box(n,x,y,z,l,w,h,mat):return g.box(name+n,p(x,y,z),(l,w,h),mat,angle)
        hs=[ground(x,y) for x,y in ring]+[ground(cx,cy)];base=statistics.median(hs)+.10
        foundation=min(hs)-.12
        shed=f['id']=='range-shelter';manor='manor' in f['id'];farm='farm' in f['id'] or 'estate' in f['id']
        height=2.55 if shed else 4.65 if manor else 4.6 if farm else 3.1
        ridge=base+height+(W*.33 if W<15 else W*.26)
        wallmat='yellow' if manor else 'red'
        roofmat='tile' if ('north' in f['id'] and farm) else 'slate'
        length,width=max(1,L-.5),max(1,W-.5)
        box('foundation',0,0,(base+foundation)/2,length,width,base-foundation,'stone')
        if shed:
            # Roof-supported open structure. Only the north back wall and east
            # end are solid; the west gable and south hitting side remain open.
            box('north red timber wall',0,width/2-.06,base+height/2,length,.12,height,'red')
            box('east red timber wall',length/2-.06,0,base+height/2,.12,width,height,'red')
            for i in range(6):
                x=-length/2+length*i/5
                box('open south support '+str(i),x,-width/2,base+height/2,.13,.13,height,'white')
            box('west north post',-length/2,width/2,base+height/2,.14,.14,height,'white')
            for i in range(6):
                # Small corner lattice only, not a solid wall sealing the opening.
                t=-width/2+i*.19
                g.beam(name+'west lattice '+str(i),p(-length/2,t,base+.3),p(-length/2,min(t+.85,width/2),base+1.5),.035,'wood')
        else:
            box('wall massing',0,0,base+height/2,length,width,height,wallmat)
            if farm:
                box('ochre lower wall context',0,0,base+.95,length+.01,width+.01,1.9,'yellow')
            for x in (-length/2,length/2):
                for y in (-width/2,width/2):box('corner trim',x,y,base+height/2,.12,.12,height,'trim')
        hip=manor and 'main' in f['id']
        g.roof(name+'roof',center,L,W,base+height,ridge,angle,roofmat,hip=hip)
        if not hip:
            for side in (-1,1):
                x=side*(length/2+.01)
                g.mesh(name+'timber gable '+str(side),[p(x,-width/2,base+height-.015),p(x,width/2,base+height-.015),p(x,0,ridge-.1)],[(0,1,2)],wallmat)
                for y in (-W/2,W/2):g.beam(name+'fascia',p(side*L/2,y,base+height),p(side*L/2,0,ridge),.13,'white' if shed else 'trim')
        if shed:
            for i in range(max(1,int(length/.23))):
                x=-length/2+i*.23
                box('rear vertical cover strip '+str(i),x,width/2+.015,base+height/2,.036,.035,height,'red')
        for ob in g.collection.objects:
            if ob.get('facility_id')==f['id']:
                ob['model_detail']='photo-informed shelter' if shed else 'orthophoto roof massing; facades unresolved'
                ob['source_panel']=f['panelId']
        report['buildings'].append({'id':f['id'],'roofLengthMetres':round(L,2),'roofWidthMetres':round(W,2),
                                    'baseRH2000':round(base,3),'eaveEstimateMetres':height,'ridgeEstimateMetres':round(ridge-base,2),
                                    'detail':'photo-informed' if shed else 'massing'})

    mats=[f for f in features if f['kind']=='range-mat']
    if mats:
        def center(f):
            if f.get('centerBlenderXY'):return f['centerBlenderXY']
            ring=f['ringBlenderXY'];return [sum(p[i] for p in ring)/len(ring) for i in (0,1)]
        mats.sort(key=lambda f:center(f)[0]);points=[center(f) for f in mats]
        angle=math.atan2(points[-1][1]-points[0][1],points[-1][0]-points[0][0])
        for f,(x,y) in zip(mats,points):
            g.feature=f['id'];h=ground(x,y)
            g.box(f['id']+' | hitting slab',(x,y,h+.055),(2.1,2.3,.1),'stone',angle)
            g.box(f['id']+' | green mat',(x,y,h+.125),(1.25,1.45,.04),'mat',angle)
            report['matCount']+=1
        for i,(a,b) in enumerate(zip(points,points[1:])):
            x,y=(a[0]+b[0])/2,(a[1]+b[1])/2;h=ground(x,y);g.feature='range-divider-'+str(i+1)
            g.box(g.feature+' | masonry',(x,y,h+.28),(.32,1.65,.56),'stone',angle)
            g.box(g.feature+' | timber coping',(x,y,h+.59),(.40,1.79,.065),'wood',angle)
            # Actual masonry courses, subtle economical relief.
            g.box(g.feature+' | horizontal joint',(x,y,h+.28),(.326,1.654,.014),'gravel',angle)
        # Table visible in 2024 reference, approximate placement west of mat line.
        x,y=points[0][0]-5,points[0][1]-2;h=ground(x,y);g.feature='range-picnic-table-estimate'
        g.box('Range picnic tabletop',(x,y,h+.76),(1.8,.75,.07),'wood',angle)
        for sign in (-1,1):
            g.box('Range picnic bench',(x,y+sign*.6,h+.44),(1.8,.25,.06),'wood',angle)
            for dx in (-.55,.55):
                g.beam('Range picnic leg',(x+dx,y+sign*.35,h+.72),(x+dx,y+sign*.62,h),.085,'wood')
    return report
