"""Unbranded driver, fairway and hybrid heads, authored in metres in Blender.

The shell and striking face share their boundary. Sole facets follow that
shell; photo-derived dimensions are estimates, not manufacturer CAD.
"""
import bpy, bmesh, math
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from mathutils.bvhtree import BVHTree


def build_wood(scene, key, loft, api):
    mesh,material,shaft,tube=(api[k] for k in ['mesh','material','shaft','tube'])
    driver=key=='driver'
    hybrid=key=='hybrid-4'
    scale=.96 if key=='wood-5' else 1
    width=(.045 if hybrid else .061 if driver else .051)*scale
    depth=(.064 if hybrid else .107 if driver else .082)*scale
    front=-.030 if hybrid else -.043 if driver else -.034
    center_z=.0255 if hybrid else .036 if driver else .024
    face_w=(.040 if hybrid else .0505 if driver else .043)*scale
    face_h=(.016 if hybrid else .025 if driver else .0145)*scale
    # The hybrid's 22-degree loft, 59-degree lie and 40.25-inch length follow
    # Wilson's 2025 product catalogue. Its shell dimensions are photo estimates.
    lie=59 if hybrid else 57 if driver else (57.5 if key=='wood-3' else 58)
    length_inches=40.25 if hybrid else 45.75 if driver else (43.25 if key=='wood-3' else 42.75)
    crown=material('wood lacquer crown',(.019,.021,.024),.48,.20)
    sole=material('wood titanium shell',(.029,.032,.036),.8,.29)
    face_mat=material('wood forged face',(.055,.061,.066),.90,.38)
    panel=material('wood central sole',(.016,.019,.021),.68,.30)
    if hybrid:panel=material('hybrid brushed sole field',(.056,.062,.068),.88,.38)
    housing=material('wood sculpted shoulders',(.058,.062,.067),.8,.36)
    recess=material('wood recessed channels',(.008,.009,.011),.35,.40)
    silver=material('wood brushed sole facets',(.44,.48,.51),.96,.29)
    red=material('wood small red accent',(.40,.009,.012),.45,.29)
    groove=material('wood face milling',(.025,.030,.034),.8,.43)
    steel=material('wood face scoring',(.39,.43,.46),.85,.33)
    # Cross-sections recover the broad D-shaped plan and flatter sole. Fairway
    # heads have their own shallow section; they are not scaled drivers.
    if driver:
        stations=[(0,face_w,.011,.061),(.07,.056,.008,.064),(.25,.061,.0055,.065),
                  (.48,.060,.005,.059),(.70,.052,.007,.048),(.86,.038,.012,.037),
                  (.95,.023,.017,.028),(.995,.0058,.022,.0245),(1,0,.0233,.0233)]
    elif hybrid:
        stations=[(0,face_w,center_z-face_h,center_z+face_h),(.08,.043,.007,.044),
                  (.28,.045,.0045,.043),(.48,.0425,.0045,.039),(.70,.035,.0065,.0315),
                  (.86,.025,.010,.025),(.95,.0145,.0135,.0195),(.995,.0035,.016,.0175),
                  (1,0,.0168,.0168)]
    else:
        stations=[(0,face_w,center_z-face_h,center_z+face_h),(.08,.047*scale,.007,.041),
                  (.28,.051*scale,.0045,.042),(.48,.048*scale,.004,.039),
                  (.70,.039*scale,.0055,.031),(.86,.027*scale,.009,.023),
                  (.95,.016*scale,.012,.019),(.995,.004*scale,.0145,.0158),(1,0,.0152,.0152)]

    def sample(t, col):
        # Cubic Hermite with centred secants for a smooth photographic profile.
        for i in range(len(stations)-1):
            if t<=stations[i+1][0]:break
        a,b=stations[i],stations[i+1];h=b[0]-a[0];q=(t-a[0])/h
        prev=stations[max(0,i-1)];nxt=stations[min(len(stations)-1,i+2)]
        da=(b[col]-prev[col])/(b[0]-prev[0]);db=(nxt[col]-a[col])/(nxt[0]-a[0])
        return (2*q**3-3*q*q+1)*a[col]+(q**3-2*q*q+q)*h*da+(-2*q**3+3*q*q)*b[col]+(q**3-q*q)*h*db

    def face_y(x,z):
        return front+math.tan(math.radians(loft))*(z-center_z)+x*x/(2*.30)+(z-center_z)**2/(2*.28)

    def section(t,u,upper=True):
        w=sample(t,1);low,high=sample(t,2),sample(t,3)
        mid=(low+high)/2
        # The heel narrows gently into the back, unlike a symmetric ellipsoid.
        shift=-.003*math.sin(math.pi*t)
        x=shift+u*w
        v=math.sqrt(max(0,1-abs(u)**(2/.84)))
        z=mid+(high-mid)*v**.90 if upper else mid-(mid-low)*v**.48
        if hybrid:
            # Continue the toe fullness through the side seam, avoiding a
            # step where the upper and lower half-sections meet.
            height_fraction=v**.90 if upper else -v**.48
            x-=.0022*max(0,-u)**2*(.5-.5*height_fraction)*(1-t)**2
        y=front+depth*t+(face_y(x,z)-front)*(1-t)**5
        return Vector((x,y,z))

    def perimeter(t,a):
        co=math.cos(a);u=math.copysign(abs(co)**.84,co)
        return section(t,u,math.sin(a)>=0)

    n=128;longitudinal=72
    verts=[];faces=[];mats=[]
    for j in range(longitudinal):
        t=j/longitudinal
        verts.extend(perimeter(t,math.tau*i/n) for i in range(n))
    for j in range(longitudinal-1):
        for i in range(n):
            k=(i+1)%n
            faces.append((j*n+i,j*n+k,(j+1)*n+k,(j+1)*n+i))
            mats.append(0 if i<n//2 else 1)
    pole=len(verts);verts.append(section(1,0))
    for i in range(n):
        faces.append(((longitudinal-1)*n+i,(longitudinal-1)*n+(i+1)%n,pole));mats.append(0 if i<n//2 else 1)
    # A radially tessellated face is part of the same watertight head shell.
    last=list(range(n))
    for j in range(1,17):
        r=1-j/17;ring=[]
        for i in range(n):
            p=perimeter(0,math.tau*i/n);x=p.x*r;z=center_z+(p.z-center_z)*r
            ring.append(len(verts));verts.append((x,face_y(x,z),z))
        for i in range(n):
            k=(i+1)%n;faces.append((last[k],last[i],ring[i],ring[k]));mats.append(2)
        last=ring
    center=len(verts);verts.append((0,front,center_z))
    for i in range(n):faces.append((last[(i+1)%n],last[i],center));mats.append(2)
    body=mesh('Continuous wood shell and forged face',verts,faces,crown)
    body.data.materials.append(sole);body.data.materials.append(face_mat)
    for p,index in zip(body.data.polygons,mats):p.material_index=index

    def activate(ob):
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob

    def recalc(ob):
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()

    recalc(body)
    # The heel socket grows out of the shell; a radius softens its intersection.
    axis=Vector((math.cos(math.radians(lie)),0,math.sin(math.radians(lie))))
    base=Vector((face_w*1.145,front+(.021 if driver else .017),.037 if hybrid else .051 if driver else .035))
    u=Vector((axis.z,0,-axis.x));v=Vector((0,1,0));vv=[];ff=[]
    neck_sections=[(-.018,.009),(-.010,.0083),(0,.0069),(.014,.0056),(.031,.0052)]
    for distance,radius in neck_sections:
        for i in range(64):vv.append(base+axis*distance+radius*(u*math.cos(math.tau*i/64)+v*math.sin(math.tau*i/64)))
    for j in range(len(neck_sections)-1):
        for i in range(64):k=(i+1)%64;ff.append((j*64+i,j*64+k,(j+1)*64+k,(j+1)*64+i))
    ff.extend([tuple(reversed(range(64))),tuple(range((len(neck_sections)-1)*64,len(vv)))])
    neck=mesh('Blended heel socket',vv,ff,crown);recalc(neck)
    for ob in [body,neck]:
        for vert in ob.data.vertices:vert.co*=1000
        ob.data.update()
    activate(body)
    mod=body.modifiers.new('Integrated heel socket','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=neck
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(neck,do_unlink=True)
    bevel=body.modifiers.new('Rolled shell edges','BEVEL');bevel.width=.85;bevel.segments=4;bevel.limit_method='ANGLE';bevel.angle_limit=.48;bevel.use_clamp_overlap=True
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for vert in body.data.vertices:vert.co/=1000
    body.data.update();recalc(body)
    for p in body.data.polygons:p.use_smooth=True

    def skin(p,upper=False,offset=.0001):
        x,t=p
        w=sample(t,1);shift=-.003*math.sin(math.pi*t)
        u=(x*width-shift)/w
        if abs(u)>=.995:raise RuntimeError(f'{key}: detail extends beyond shell: {p}, {u}')
        result=section(t,u,upper);result.z+=offset if upper else -offset
        return result

    def patch(name,polygon,mat,offset=.0002,upper=False,rise=0,edge=.0012):
        polygon=[Vector((x,t,0)) for x,t in polygon]
        metric=[Vector((p.x*width,p.y*depth)) for p in polygon]
        def height(uv):
            if not rise:return offset
            p=Vector((uv.x*width,uv.y*depth));distances=[]
            for i,a in enumerate(metric):
                b=metric[(i+1)%len(metric)];d=b-a
                closest=a+d*max(0,min(1,(p-a).dot(d)/d.length_squared))
                distances.append((p-closest).length)
            q=min(1,min(distances)/edge)
            return offset+rise*q*q*(3-2*q)
        triangles=tessellate_polygon([polygon]);vv=[];ff=[];steps=18
        for a,b,c in triangles:
            if isinstance(a,int):a,b,c=(polygon[k] for k in (a,b,c))
            indices={}
            for i in range(steps+1):
                for j in range(steps+1-i):
                    uv=a*(1-(i+j)/steps)+b*i/steps+c*j/steps
                    indices[i,j]=len(vv);vv.append(skin((uv.x,uv.y),upper,height(uv)))
            for i in range(steps):
                for j in range(steps-i):
                    ff.append((indices[i,j],indices[i+1,j],indices[i,j+1]))
                    if j<steps-i-1:ff.append((indices[i+1,j],indices[i+1,j+1],indices[i,j+1]))
        ob=mesh(name,vv,ff,mat)
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
        # These are exterior skin layers, with consistent outward normals.
        if (sum(p.normal.z for p in ob.data.polygons)>0)!=upper:
            bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
        return ob

    # Broad stepped facets follow the underside, with thin seams and a low,
    # fitted rear weight. The old floating tubes and round weight are removed.
    field=[(-.62,.13),(.62,.13),(.69,.22),(.47,.77),(.26,.85),(-.30,.85),(-.57,.72),(-.69,.22)]
    patch('Central sole border',field,recess,.00018)
    inner=[(x*.962,.48+(t-.48)*.958) for x,t in field]
    patch('Inset central sole panel',inner,panel,.00032)
    for sign in [-1,1]:
        outer=[(.67,.12),(.86,.19),(.85,.44),(.67,.70),(.37,.84),(.30,.78),(.56,.65),(.70,.25)]
        patch('Sculpted side housing',[(sign*x,t) for x,t in outer],housing,.00048,rise=.0007)
        rail=[(.61,.14),(.70,.18),(.69,.30),(.64,.26),(.47,.74),(.32,.80),(.34,.75),(.55,.30)]
        if hybrid:rail=[(.61,.14),(.70,.18),(.67,.25),(.37,.77),(.29,.79),(.31,.72),(.56,.23)]
        patch('Angular brushed sole blade',[(sign*x,t) for x,t in rail],silver,.0012,rise=.00025,edge=.0005)
        channel=[(.74,.31),(.80,.35),(.72,.58),(.58,.70),(.57,.63),(.67,.44)]
        patch('Recessed side channel',[(sign*x,t) for x,t in channel],recess,.00124)
        # One small red inset, without the reference's lettering or emblems.
        if sign==-1:patch('Red sole inset',[(-.752,.37),(-.774,.395),(-.750,.44),(-.728,.415)],red,.00134)
    patch('Front sole cross member',[(-.69,.065),(.69,.065),(.75,.16),(.63,.20),(.56,.145),(-.56,.145),(-.63,.20),(-.75,.16)],housing,.00048,rise=.0006)
    if hybrid:
        # The photographed hybrid has a solid rear pad, not a fairway's
        # removable weight. Fine transverse recesses articulate its shoulders.
        rear=[(-.32,.73),(.29,.73),(.37,.80),(.20,.93),(-.23,.93),(-.40,.83)]
        patch('Integrated hybrid rear pad',rear,recess,.00065,rise=.00055,edge=.0015)
        for t in [.77,.805,.84]:
            for sign in [-1,1]:
                patch('Rear pad fine recess',[(sign*x,s) for x,s in [(.18,t),(.29,t+.018),(.29,t+.024),(.18,t+.006)]],housing,.00125)
    else:
        weight=[(-.30,.77),(.26,.77),(.34,.82),(.22,.94),(-.25,.94),(-.39,.85)] if driver else [(-.23,.75),(.18,.75),(.27,.82),(.16,.91),(-.20,.91),(-.31,.82)]
        patch('Rear weight pocket',weight,recess,.00075)
        center_t=.847 if driver else .825
        inset=[(x*.87,center_t+(t-center_t)*.77) for x,t in weight]
        patch('Low rear weight plate',inset,housing,.00105,rise=.00025,edge=.0007)
        screw=skin((-.03,center_t),False,.0015)
        dx=skin((-.029,center_t))-skin((-.031,center_t))
        dy=skin((-.03,center_t+.001))-skin((-.03,center_t-.001))
        normal=-dx.cross(dy).normalized()
        tube('Rear weight fastener',screw,screw+normal*.00024,.0035 if driver else .003,.0035 if driver else .003,api['dark'],48)
        tube('Hex fastener recess',screw+normal*.00025,screw+normal*.00029,.0017,.0017,recess,6)

    # Shade the actual crown polygons, so a second surface cannot intersect
    # the smooth shell or sparkle while the club is rotated.
    if driver:
        crown_panel=material('wood carbon crown inset',(.012,.015,.018),.38,.24)
        shape=[(-.73,.10),(.71,.10),(.86,.30),(.73,.59),(.44,.84),(-.39,.89),(-.71,.70),(-.89,.38)]
        body.data.materials.append(crown_panel);index=len(body.data.materials)-1
        def inside(x,y):
            result=False
            for i,(ax,ay) in enumerate(shape):
                bx,by=shape[(i+1)%len(shape)]
                if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:result=not result
            return result
        for p in body.data.polygons:
            if p.material_index==0 and p.normal.z>0 and inside(p.center.x/width,(p.center.y-front)/depth):p.material_index=index
    # Fine, flush scorelines fit the curved face rather than floating on tubes.
    for j in range(-3,4) if driver or hybrid else range(-2,3):
        z=center_z+j*(.0038 if hybrid else .005 if driver else .0043)
        spans=[(-.79,-.57,steel),(-.52,.52,groove),(.57,.79,steel)]
        if hybrid and abs(j)==3:spans=[(-.28,.28,groove)]
        for left,right,mat in spans:
            vv=[];ff=[]
            for i in range(33):
                x=face_w*(left+(right-left)*i/32)
                for dz in [-.00013,.00013]:vv.append((x,face_y(x,z+dz)-.00018,z+dz))
                if i:ff.append((2*i-2,2*i-1,2*i+1,2*i))
            ob=mesh('Flush face scoreline',vv,ff,mat)
            for p in ob.data.polygons:p.use_smooth=False
    # A simple index replaces every logo. It is fitted to the sole skin.
    label='4\n22°' if hybrid else '10.5' if driver else key[-1]
    font_path=Path('C:/Windows/Fonts/bahnschrift.ttf')
    cu=bpy.data.curves.new('Wood loft or number','FONT');cu.body=label;cu.size=.004 if hybrid else .0045 if driver else .0055;cu.align_x='CENTER';cu.align_y='CENTER'
    if font_path.exists():cu.font=bpy.data.fonts.load(str(font_path),check_existing=True)
    ob=bpy.data.objects.new('Wood loft or number',cu);scene.collection.objects.link(ob);cu.materials.append(silver)
    ob.location=skin((.78,.27));ob.rotation_euler=(math.pi,0,math.pi/2)
    activate(ob);bpy.ops.object.convert(target='MESH');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bm=bmesh.new();bm.from_mesh(body.data);tree=BVHTree.FromBMesh(bm)
    for vert in ob.data.vertices:
        hit,normal,_,_=tree.ray_cast(Vector((vert.co.x,vert.co.y,-.04)),Vector((0,0,1)))
        if hit is None:raise RuntimeError(f'{key}: sole index misses head')
        vert.co=hit+normal*.00155
    # Main body must remain one connected, closed volume after the heel union.
    bad=sum(not e.is_manifold for e in bm.edges)
    todo=set(bm.verts);components=0
    while todo:
        components+=1;stack=[todo.pop()]
        while stack:
            for edge in stack.pop().link_edges:
                for vert in edge.verts:
                    if vert in todo:todo.remove(vert);stack.append(vert)
    volume=abs(bm.calc_volume());bm.free()
    if bad or components!=1:raise RuntimeError(f'{key}: invalid shell ({bad} edges, {components} components)')
    shaft(base,length_inches*.0254-base.dot(axis)-.012,graphite=True,integrated_neck=True,lie=lie)
    if driver:
        for distance in [.011,.015,.019]:
            radius=.0056+(.0052-.0056)*max(0,(distance-.014)/.017)
            tube('Adjustable sleeve seam',base+axis*distance,base+axis*(distance+.00045),radius+.00010,radius+.00010,recess,64)
    return {'id':key,'closedHead':True,'headComponents':components,'continuousFace':True,
            'loftDegrees':loft,'lieDegrees':lie,'lengthInches':length_inches,
            'estimatedWidthMm':round(width*2000,2),'estimatedDepthMm':round(depth*1000,2),
            'estimatedFaceHeightMm':round(face_h*2000,2),'estimatedVolumeCc':round(volume*1e6,1),
            'fittedSolePanels':True,'flushScorelines':True,'unbranded':True}
