"""Photo-informed clubhouse reconstruction in the measured Veckefjarden frame.

Called by build_facility_model.py inside Blender. No operators, scene changes or
file writes are made here. XY comes from the reviewed 2024 roof outlines; wall
insets, roof planes and all architectural heights are explicit estimates.
"""
import math


PHOTO_IDS = ['club-2041', 'club-2485', 'hotel-167']


def build(ctx):
    ring = ctx.ring('R01')
    # Main bar: the long eastern edge is unambiguous in the native orthophoto.
    dx, dy = ring[3][0] - ring[4][0], ring[3][1] - ring[4][1]
    angle = math.atan2(dy, dx)
    ca, sa = math.cos(angle), math.sin(angle)
    west_north = (ring[5][0] + dx, ring[5][1] + dy)
    cx = sum(p[0] for p in [ring[3], ring[4], ring[5], west_north]) / 4
    cy = sum(p[1] for p in [ring[3], ring[4], ring[5], west_north]) / 4
    length = math.hypot(dx, dy)
    width = abs(-(ring[5][0] - ring[4][0])*sa + (ring[5][1] - ring[4][1])*ca)
    wall_half = width/2 - .30
    wall_length = length - .60
    counts = {'windows': 0, 'doors': 0, 'roofStacks': 0}

    def p(s, t, z):
        return (cx + ca*s - sa*t, cy + sa*s + ca*t, z)

    def uv(xy):
        x, y = xy[0]-cx, xy[1]-cy
        return (x*ca + y*sa, -x*sa + y*ca)

    def mark(obj, fid='R01', evidence='photo-estimated'):
        ctx.tag(obj, fid, evidence=evidence)
        obj['reference_photo_ids'] = ','.join(PHOTO_IDS)
        obj['architectural_heights'] = 'photo-estimated; not measured from DTM'
        return obj

    def box(name, s, t, z, dimensions, mat, a=angle, fid='R01'):
        return mark(ctx.box('Clubhouse / '+name, p(s, t, z), dimensions, mat, a), fid)

    def mesh(name, verts, faces, mat, fid='R01', evidence='photo-estimated'):
        return mark(ctx.mesh('Clubhouse / '+name, [p(*v) for v in verts], faces, mat), fid, evidence)

    def beam(name, a, b, size, mat='white', depth=None, fid='R01'):
        return mark(ctx.beam('Clubhouse / '+name, p(*a), p(*b), size, depth or size, mat), fid)

    def ground(s, t):
        x, y, _ = p(s, t, 0)
        return ctx.ground(x, y)

    def batten_mesh(name, s0, s1, t, z0, z1, spacing=.20, material='wall_yellow'):
        """Raised vertical timber boards as one economical, editable mesh."""
        verts, faces = [], []
        n = max(1, int((s1-s0)/spacing))
        for i in range(n+1):
            s = s0 + (s1-s0)*i/n
            j = len(verts)
            for z in [z0, z1]:
                for ds, dt in [(-.014,-.020),(.014,-.020),(.014,.020),(-.014,.020)]:
                    verts.append((s+ds,t+dt,z))
            faces.extend(tuple(j+k for k in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        mesh(name, verts, faces, material)

    def window(name, s, t, bottom, w=1.30, h=1.85, side=1, arch=False, door=False, fid='R01'):
        """Facade joinery: opaque glazing, raised casing and divided panes."""
        counts['doors' if door else 'windows'] += 1
        outer_t = t + side*.085
        box(name+' recess', s, outer_t, bottom+h/2, (w+.18,.14,h+.16), 'roof_grey', fid=fid)
        box(name+' glazing', s, outer_t+side*.083, bottom+h/2, (w,.035,h), 'glass', fid=fid)
        ft = outer_t + side*.12
        for ds in [-w/2-.055, w/2+.055]:
            box(name+' vertical casing', s+ds, ft, bottom+h/2, (.11,.13,h+.18), 'white', fid=fid)
        for z in [bottom-.055, bottom+h+.055]:
            box(name+' horizontal casing', s, ft, z, (w+.22,.13,.11), 'white', fid=fid)
        box(name+' central mullion', s, ft+side*.01, bottom+h/2, (.055,.08,h), 'white', fid=fid)
        box(name+' transom', s, ft+side*.01, bottom+h*.66, (w,.08,.055), 'white', fid=fid)
        box(name+' projecting sill', s, ft+side*.065, bottom-.105, (w+.30,.28,.09), 'white', fid=fid)
        if door:
            box(name+' handle', s+w*.30, ft+side*.12, bottom+.95, (.035,.08,.18), 'metal', fid=fid)
        if arch:
            # Photographs show solid, segmentally arched white head pieces above
            # rectangular windows, not full arched glass openings.
            v = []
            for i in range(13):
                th = i*math.pi/12
                v.append((s+w*.60*math.cos(th),ft,bottom+h+.13+.52*math.sin(th)))
            mesh(name+' arched white head',v,[tuple(range(len(v)))],'white',fid)

    def gable_wall(name, sc, tc, ln, wd, eave, ridge, along_s=True, mat='wall_yellow'):
        # End triangles beneath the separate roof slopes.
        for sign in [-1,1]:
            if along_s:
                s = sc + sign*(ln/2-.29)
                verts=[(s,tc-wd/2+.28,eave),(s,tc+wd/2-.28,eave),(s,tc,ridge-.12)]
            else:
                t = tc + sign*(ln/2-.29)
                verts=[(sc-wd/2+.28,t,eave),(sc+wd/2-.28,t,eave),(sc,t,ridge-.12)]
            mesh(name+' gable infill '+str(sign),verts,[(0,1,2)],mat)

    def roof(name, sc, tc, ln, wd, eave, ridge, along_s=True, fid='R01'):
        x,y,_=p(sc,tc,0)
        obj=ctx.gable('Clubhouse / '+name,x,y,ln,wd,eave,ridge,
                      angle if along_s else angle+math.pi/2,'roof_grey')
        mark(obj,fid,'ortho-roof-plan' if fid in ['R01','R02'] else 'photo-estimated')
        seam_mat='roof_seam' if 'roof_seam' in ctx.materials else 'metal'
        n=max(2,round(ln/.75))
        for i in range(n+1):
            q=-ln/2+ln*i/n
            if along_s:
                a,b,c=(sc+q,tc-wd/2,eave+.04),(sc+q,tc,ridge+.04),(sc+q,tc+wd/2,eave+.04)
            else:
                a,b,c=(sc-wd/2,tc+q,eave+.04),(sc,tc+q,ridge+.04),(sc+wd/2,tc+q,eave+.04)
            beam(name+' standing seam A '+str(i),a,b,.022,seam_mat,fid=fid)
            beam(name+' standing seam B '+str(i),b,c,.022,seam_mat,fid=fid)
        if along_s:
            beam(name+' ridge cap',(sc-ln/2,tc,ridge+.045),(sc+ln/2,tc,ridge+.045),.14,'roof_grey',fid=fid)
            for e in [-1,1]:
                ss=sc+e*ln/2
                beam(name+' bargeboard',(ss,tc-wd/2,eave),(ss,tc,ridge),.12,'white',depth=.20,fid=fid)
                beam(name+' bargeboard',(ss,tc,ridge),(ss,tc+wd/2,eave),.12,'white',depth=.20,fid=fid)
            for t in [tc-wd/2,tc+wd/2]:
                beam(name+' gutter',(sc-ln/2,t,eave-.12),(sc+ln/2,t,eave-.12),.12,'metal',fid=fid)
        else:
            beam(name+' ridge cap',(sc,tc-ln/2,ridge+.04),(sc,tc+ln/2,ridge+.04),.14,'roof_grey',fid=fid)
            for e in [-1,1]:
                tt=tc+e*ln/2
                beam(name+' bargeboard',(sc-wd/2,tt,eave),(sc,tt,ridge),.12,'white',depth=.20,fid=fid)
                beam(name+' bargeboard',(sc,tt,ridge),(sc+wd/2,tt,eave),.12,'white',depth=.20,fid=fid)
            for s in [sc-wd/2,sc+wd/2]:
                beam(name+' gutter',(s,tc-ln/2,eave-.12),(s,tc+ln/2,eave-.12),.12,'metal',fid=fid)

    # Bare-earth terrain establishes site attachment only. Story/roof dimensions
    # below remain photo estimates and must never be reported as LiDAR heights.
    entrance_ground = ground(0,-wall_half-.6)
    first_floor = entrance_ground+.22
    west_ground_samples=[ground(s,wall_half+.65) for s in [-15,-8,0,8,15]]
    basement_bottom=min(west_ground_samples+[ground(-17,0)])-.18
    main_eave=first_floor+7.25
    main_ridge=first_floor+10.10
    basement_mat='clubhouse_basement' if 'clubhouse_basement' in ctx.materials else 'foundation'
    box('main pale yellow two-storey walls',0,0,(first_floor+main_eave)/2,
        (wall_length,2*wall_half,main_eave-first_floor),'wall_yellow')
    box('terrain attached basement',0,0,(basement_bottom+first_floor)/2,
        (wall_length,2*wall_half,first_floor-basement_bottom),basement_mat)
    gable_wall('main',0,0,length,width,main_eave,main_ridge)
    roof('main grey standing-seam roof',0,0,length,width,main_eave,main_ridge)

    for side in [-1,1]:
        t=side*(wall_half+.022)
        batten_mesh(('east' if side<0 else 'west')+' vertical timber',-wall_length/2,wall_length/2,t,first_floor+.08,main_eave-.08)
        for z in [first_floor+.04,first_floor+3.63,main_eave-.16]:
            box('white horizontal facade belt',0,t+side*.045,z,(wall_length+.05,.105,.14),'white')
        for s in [-wall_length/2+.16,-6.0,5.8,wall_length/2-.16]:
            box('white corner board and pilaster',s,t+side*.065,(first_floor+main_eave)/2,(.38,.16,main_eave-first_floor),'white')
            box('pilaster capital',s,t+side*.08,main_eave-.34,(.55,.20,.17),'white')
        # The documented photographs are oblique: this rhythm is an architectural
        # interpretation, not a calibrated photogrammetric facade survey.
        positions=([-14.6,-10.8,-7.0,-3.2,4.0,7.8,11.6,15.0] if side<0
                   else [-14.6,-10.1,-7.5,-4.8,-2.1,.6,3.3,6.0,8.7,11.4,14.1])
        for i,s in enumerate(positions):
            window(('east' if side<0 else 'west')+' upper window '+str(i+1),s,t,first_floor+4.38,1.24,1.85,side)
            # Lower windows that the 2024 annex conceals are not fabricated on
            # the inside of an intersecting wall.
            if side<0 and abs(s)<5.0:
                continue
            if side>0 and -1.4<s<14.75:
                continue
            window(('east' if side<0 else 'west')+' first-floor window '+str(i+1),s,t,first_floor+.78,1.30,2.03,side,arch=True)
        for s in [-wall_length/2+.4,wall_length/2-.4]:
            base=ground(s,side*(wall_half+.2))+.1
            beam('rainwater downpipe',(s,t+side*.20,base),(s,t+side*.20,main_eave-.15),.095,'metal')

    # The circular first-floor east feature is clearly visible above the porch.
    circle_s=.35
    circle_z=first_floor+5.55
    circle_t=-wall_half-.115
    circle_verts=[]
    for rad in [.43,.56]:
        for j in range(32):
            th=2*math.pi*j/32
            circle_verts.append((circle_s+rad*math.cos(th),circle_t,circle_z+rad*math.sin(th)))
    mesh('circular east window glazing',circle_verts[:32],[tuple(range(32))],'glass')
    mesh('circular east window white rim',circle_verts,[(j,(j+1)%32,(j+1)%32+32,j+32) for j in range(32)],'white')
    counts['windows']+=1
    box('circular window vertical mullion',circle_s,circle_t-.04,circle_z,(.045,.06,.84),'white')

    # South gable: narrow attic opening, balcony door and metal landing are
    # identifiable in hotel-167. The opposite gable is partly annex-obscured.
    end=-wall_length/2-.035
    for z,w,h,name in [(first_floor+4.18,1.38,2.18,'south balcony door'),(main_eave+.82,1.15,1.16,'south attic window')]:
        box(name+' white surround',end,0,z+h/2,(.12,w+.24,h+.24),'white')
        box(name+' glazing',end-.07,0,z+h/2,(.04,w,h),'glass')
        box(name+' mullion',end-.10,0,z+h/2,(.055,.055,h),'white')
        box(name+' transom',end-.10,0,z+h*.69,(.055,w,.065),'white')
    counts['windows']+=1
    counts['doors']+=1
    balcony_z=first_floor+4.1
    box('south gable balcony slab',end-.85,0,balcony_z-.12,(1.70,7.15,.20),'foundation')
    for t in [-3.50,3.50]:
        beam('balcony side rail',(end,t,balcony_z+1.0),(end-1.65,t,balcony_z+1.0),.045,'metal')
    beam('balcony front handrail',(end-1.65,-3.5,balcony_z+1.0),(end-1.65,3.5,balcony_z+1.0),.05,'metal')
    for j in range(24):
        t=-3.5+j*7/23
        beam('balcony baluster',(end-1.65,t,balcony_z),(end-1.65,t,balcony_z+1.0),.026,'metal')

    # The low service entry beneath the south balcony is visible in both the
    # uphill photograph and hotel-167. Its small projection is photo estimated,
    # separate from the measured high main-roof outline.
    south_s=end-1.50; south_t=-.60
    south_floor=ground(south_s-1.50,south_t)+.16
    south_eave=south_floor+2.60
    box('south gable small entry annex',south_s,south_t,south_floor+1.25,(3.05,4.85,2.50),'wall_yellow')
    box('south small annex foundation',south_s,south_t,south_floor-.15,(3.05,4.85,.30),'foundation')
    sr=[(end-3.10,south_t-2.60,south_eave),(end-3.10,south_t+2.60,south_eave),
        (end+.05,south_t+2.60,south_eave+.40),(end+.05,south_t-2.60,south_eave+.40)]
    mesh('photo-estimated south annex lean-to roof',sr,[(0,1,2,3)],'roof_grey')
    for a,b in zip(sr,sr[1:]+sr[:1]):
        beam('south annex roof edge',a,b,.12,'white')
    box('south small entry white door surround',end-3.055,south_t,south_floor+1.08,(.13,1.30,2.16),'white')
    box('south small entry glazed door',end-3.13,south_t,south_floor+1.08,(.045,1.08,1.98),'glass')
    box('south small entry door transom',end-3.16,south_t,south_floor+1.57,(.065,1.10,.055),'white')
    counts['doors']+=1

    # Annex rectangles follow distinct portions of R01; these are deliberately
    # separate from the two-storey historic bar, with no invented storeys.
    local=[uv(v) for v in ring]
    north_s0=(local[8][0]+local[9][0])/2
    north_s1=(local[0][0]+local[1][0])/2
    north_t0=(local[1][1]+local[2][1])/2
    north_t1=(local[0][1]+local[9][1])/2
    ns,nt=(north_s0+north_s1)/2,(north_t0+north_t1)/2
    nw,nl=north_s1-north_s0,north_t1-north_t0
    north_base=max(ground(ns,north_t1),ground(north_s1,nt))+.12
    north_eave=north_base+3.50
    north_ridge=north_eave+2.05
    box('north crosswing foundation',ns,nt,north_base-.18,(nw-.50,nl-.50,.55),'foundation')
    box('north single-storey crosswing',ns,nt,(north_base+north_eave)/2,(nw-.60,nl-.60,north_eave-north_base),'wall_yellow')
    roof('north crosswing roof',ns,nt,nl,nw,north_eave,north_ridge,False)
    gable_wall('north crosswing',ns,nt,nl,nw,north_eave,north_ridge,False)
    for t in [north_t0+.5,north_t1-.5]:
        for s in [north_s0+.4,north_s1-.4]:
            box('north crosswing corner trim',s,t,(north_base+north_eave)/2,(.24,.24,north_eave-north_base),'white')
    for j in range(3):
        window('north crosswing west window '+str(j),ns-3.1+j*3.1,north_t1-.25,north_base+.9,1.22,1.56,1)

    as0=min(local[6][0],local[7][0]); as1=local[8][0]
    at0=wall_half-.12; at1=(local[7][1]+local[8][1])/2
    ans,ant=(as0+as1)/2,(at0+at1)/2
    aw,al=as1-as0,at1-at0
    annex_base=min(ground(ans,at1),first_floor)-.06
    annex_eave=first_floor+3.10
    annex_ridge=first_floor+5.05
    box('west annex foundation',ans,ant,(annex_base+first_floor)/2,(aw-.50,al-.30,max(.18,first_floor-annex_base)),'wall_yellow')
    box('west projecting annex',ans,ant,(first_floor+annex_eave)/2,(aw-.45,al-.38,annex_eave-first_floor),'wall_yellow')
    roof('west annex roof',ans,ant,al+.10,aw,annex_eave,annex_ridge,False)
    gable_wall('west annex',ans,ant,al,aw,annex_eave,annex_ridge,False)
    batten_mesh('west annex timber',as0+.24,as1-.24,at1-.17,first_floor+.03,annex_eave-.06)
    for s in [as0+.22,as1-.22]:
        box('west annex white corner',s,at1-.13,(first_floor+annex_eave)/2,(.26,.18,annex_eave-first_floor),'white')
    for j,s in enumerate([ans-4.5,ans,ans+4.5]):
        window('west annex window '+str(j),s,at1-.17,first_floor+.8,1.6,1.65,1)

    # Small R02 roof has a reviewed image perimeter, but its porch wall and
    # glazing are inferred from the course-facing facade photograph.
    rp=[uv(q) for q in ctx.ring('R02')]
    ps0,ps1=min(q[0] for q in rp),max(q[0] for q in rp)
    pt0,pt1=min(q[1] for q in rp),max(q[1] for q in rp)
    ps,pt=(ps0+ps1)/2,(pt0+pt1)/2
    pb=ground(ps,pt1)+.20
    pe=pb+2.70; pr=pe+.95
    box('west porch floor',ps,pt,pb-.10,(ps1-ps0-.2,pt1-pt0-.2,.20),'foundation',fid='R02')
    box('west porch enclosure',ps,pt,pb+1.2,(ps1-ps0-.60,pt1-pt0-.60,2.4),'wall_yellow',fid='R02')
    roof('west attached porch roof',ps,pt,pt1-pt0,ps1-ps0,pe,pr,False,'R02')
    for s in [ps0+.36,ps1-.36]:
        box('west porch post',s,pt1-.35,pb+1.3,(.20,.20,2.6),'white',fid='R02')
    window('west porch double doors',ps,pt1-.28,pb+.04,2.0,2.20,1,door=True,fid='R02')

    # East entrance: its projection is visible in club-2041 but masked by roof
    # shadow in the orthophoto. Never label this additional plan as measured.
    porch_s=.35; porch_t=-wall_half-2.35
    porch_w=9.20; porch_d=5.05
    porch_eave=first_floor+3.04; porch_ridge=first_floor+4.26
    box('east entrance foundation',porch_s,porch_t,first_floor-.17,(porch_w-.60,porch_d-.30,.34),'foundation')
    box('east entrance yellow enclosure',porch_s,porch_t,first_floor+1.45,(porch_w-.70,porch_d-.55,2.90),'wall_yellow')
    x,y,_=p(porch_s,porch_t,0)
    mark(ctx.gable('Clubhouse / photo-estimated east entrance roof',x,y,porch_d,porch_w,porch_eave,porch_ridge,angle+math.pi/2,'roof_grey'))
    gable_wall('east entrance',porch_s,porch_t,porch_d,porch_w,porch_eave,porch_ridge,False)
    front_t=porch_t-porch_d/2+.26
    for s in [porch_s-3.85,porch_s-1.60,porch_s+1.60,porch_s+3.85]:
        box('east entrance white column',s,front_t-.06,first_floor+1.5,(.20,.22,3.0),'white')
    for j,s in enumerate([porch_s-2.80,porch_s,porch_s+2.80]):
        window('east entrance '+('double door' if j==1 else 'glazed side panel'),s,front_t,first_floor+.08,2.05,2.42,-1,door=j==1)
    # Plain projecting pediment, with white sloping trim as observed in the photo.
    beam('east porch left bargeboard',(porch_s-porch_w/2,front_t-.23,porch_eave),(porch_s,front_t-.23,porch_ridge),.17,'white',depth=.22)
    beam('east porch right bargeboard',(porch_s,front_t-.23,porch_ridge),(porch_s+porch_w/2,front_t-.23,porch_eave),.17,'white',depth=.22)
    for j in range(2):
        box('east entrance stone step',porch_s,front_t-.50-j*.35,first_floor-.09-j*.10,(3.10,.60,.18),'foundation')

    # Two stacks and smaller ventilators are identifiable on the main roof.
    for i,(s,t,w,d,h) in enumerate([(-8.9,-.7,1.45,1.15,1.48),(7.6,-.2,1.25,1.10,1.28)]):
        surface=main_ridge-abs(t)*(main_ridge-main_eave)/(width/2)
        box('main roof chimney '+str(i+1),s,t,surface+h/2-.1,(w,d,h),'foundation')
        box('main chimney cap '+str(i+1),s,t,surface+h-.08,(w+.16,d+.16,.12),'metal')
        counts['roofStacks']+=1
    for i,s in enumerate([-12.7,-3.7,2.9,12.2]):
        t=-1.65
        surface=main_ridge-abs(t)*(main_ridge-main_eave)/(width/2)
        box('small roof vent '+str(i),s,t,surface+.27,(.48,.40,.55),'roof_grey')
        counts['roofStacks']+=1
    for j,s in enumerate([ans-3.1,ans+3.1]):
        box('annex rooflight curb '+str(j),s,ant,annex_ridge+.04,(1.16,.92,.22),'white')
        box('annex rooflight glass '+str(j),s,ant,annex_ridge+.17,(.90,.68,.06),'glass')

    # Terrace: the narrow elevated course-side strip is photo-supported. The
    # wider S01 dining surface is separately traced and remains at site grade.
    deck_s0=-wall_length/2+.10; deck_s1=as0-.20
    deck_tc=wall_half+1.03; deck_w=2.10
    box('raised west terrace slab',(deck_s0+deck_s1)/2,deck_tc,first_floor-.12,(deck_s1-deck_s0,deck_w,.24),'foundation',fid='S01')
    for s in [deck_s0,deck_s0+3,deck_s0+6,deck_s0+9,deck_s0+12,deck_s1]:
        gz=ground(s,deck_tc)
        if first_floor-gz>.2:
            box('terrace support',s,deck_tc,(gz+first_floor)/2,(.17,.17,first_floor-gz),'white',fid='S01')
    outer_t=deck_tc+deck_w/2
    stair_s=-8.6
    for a,b in [(deck_s0,stair_s-1.2),(stair_s+1.2,deck_s1)]:
        if b<=a: continue
        beam('terrace upper handrail',(a,outer_t,first_floor+1.02),(b,outer_t,first_floor+1.02),.055,'metal',fid='S01')
        beam('terrace lower rail',(a,outer_t,first_floor+.20),(b,outer_t,first_floor+.20),.035,'metal',fid='S01')
        for i in range(max(2,int((b-a)/.28))+1):
            s=a+(b-a)*i/max(2,int((b-a)/.28))
            beam('terrace baluster',(s,outer_t,first_floor+.18),(s,outer_t,first_floor+1.02),.025,'metal',fid='S01')
    stair_ground=ground(stair_s,outer_t+3.8)
    rise=max(.18,first_floor-stair_ground)
    steps=max(2,math.ceil(rise/.18))
    run=steps*.29
    for j in range(steps):
        z=first_floor-rise*(j+1)/steps
        box('west terrace stair tread '+str(j),stair_s,outer_t+.29*(j+.5),z-.075,(2.25,.32,.15),'wood',fid='S01')
    for s in [stair_s-1.12,stair_s+1.12]:
        beam('west stair stringer',(s,outer_t,first_floor-.15),(s,outer_t+run,stair_ground-.10),.13,'metal',depth=.22,fid='S01')
        beam('west stair handrail',(s,outer_t,first_floor+1.0),(s,outer_t+run,stair_ground+1.0),.055,'metal',fid='S01')
        for j in [0,steps//2,steps]:
            z=first_floor-rise*j/steps
            beam('west stair railing post',(s,outer_t+.29*j,z),(s,outer_t+.29*j,z+1.0),.045,'metal',fid='S01')

    # Only exposed lower-level bays, no repeated extra full-height storey.
    for i,s in enumerate([-15.0,-12.0,-5.0,-2.7]):
        gz=ground(s,wall_half+.3)
        available=first_floor-gz
        if available>1.0:
            h=min(1.10,available-.40)
            window('exposed basement window '+str(i),s,wall_half+.02,first_floor-h-.30,1.25,h,1)
    patio=ctx.ring('S01')
    patio_levels=[ctx.ground(*q) for q in patio]
    # Follow terrain at each perimeter vertex; plan preserves the reviewed edge.
    verts=[(q[0],q[1],z+.055) for q,z in zip(patio,patio_levels)]
    paving=ctx.drape('Clubhouse / S01 ground dining paving',patio,'foundation',lift=.10) if hasattr(ctx,'drape') else ctx.mesh('Clubhouse / S01 ground dining paving',verts,[tuple(range(len(verts)))],'foundation')
    mark(paving,'S01','ortho-roof-plan')

    # Dining furniture is a representative, movable arrangement, not a survey.
    furniture_positions=[(-14.2,deck_tc),(-11.8,deck_tc),(-4.9,deck_tc)]
    for j,(s,t) in enumerate(furniture_positions):
        box('terrace table '+str(j),s,t,first_floor+.76,(.75,.75,.08),'wood',fid='S01')
        box('terrace table pedestal '+str(j),s,t,first_floor+.37,(.09,.09,.74),'metal',fid='S01')
        for side in [-1,1]:
            tt=t+side*.61
            box('terrace chair seat',s,tt,first_floor+.44,(.44,.43,.06),'wood',fid='S01')
            box('terrace chair back',s,tt+side*.18,first_floor+.69,(.44,.065,.46),'wood',fid='S01')
            for ds in [-.15,.15]:
                for dt in [-.14,.14]:
                    box('terrace chair leg',s+ds,tt+dt,first_floor+.22,(.025,.025,.44),'metal',fid='S01')

    return {
        'name':'Veckefjarden clubhouse architecture',
        'featureIds':['R01','R02','S01'],
        'photoIds':PHOTO_IDS,
        'mainRoofPlan':{'centerBlenderXY':[cx,cy],'lengthMetres':length,'widthMetres':width,'axisRadians':angle},
        'heightEstimates':{'firstFloorRelativeDatum':first_floor,'uphillGroundRelativeDatum':entrance_ground,
                           'basementBottomRelativeDatum':basement_bottom,'westGroundSamples':west_ground_samples,
                           'mainEaveAboveFirstFloorMetres':7.25,'mainRidgeAboveFirstFloorMetres':10.10,
                           'mainRoofRiseMetres':2.85,'heightInterpretationUncertaintyMetres':1.5},
        'counts':counts,
        'assumptions':[
            '2024 roof-edge XY controls placement; 0.30 m wall inset estimates roof overhang and is not a surveyed wall footprint.',
            'Pale yellow vertical timber, white joinery, dark roof, two main window rows and downhill basement derive from club-2041, club-2485 and hotel-167.',
            'All eaves, ridges, story heights and window spacing are photo estimates; DTM establishes ground only.',
            'East entrance roof projection is photo estimated at 9.20 by 5.05 m because its orthophoto boundary is in shadow.',
            'The low south-gable entry beneath the balcony is photo estimated at 3.05 by 4.85 m; its plan is not part of the reviewed high-roof outline.',
            'The 2024 west roof extension hides part of the old facade; older oblique photos do not resolve its current hidden wall junctions.',
            'North crosswing and west annex roof planes are approximate decompositions of the reviewed composite R01 outline.',
            'The raised strip terrace comes from the course-facing photo; S01 separately preserves the traced ground dining surface.',
            'Furnishing positions and unseen service details are representative; no room-use identity is inferred.'
        ],
        'wantedCameraPoints':{
            'clubhouseEast':{'location':list(p(-36,-54,first_floor+22)),'target':list(p(0,-2,first_floor+3.8))},
            'clubhouseWest':{'location':list(p(-36,62,first_floor+22)),'target':list(p(1,6,first_floor+3.8))},
            'clubhouseFacade':{'location':list(p(0,-62,first_floor+9.0)),'target':list(p(0,0,first_floor+4.8))}
        }
    }
