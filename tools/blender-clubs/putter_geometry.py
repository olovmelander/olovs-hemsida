"""Unbranded centre-shaft half-moon mallet, authored from CS22 photographs.

Metres, Blender Z up. Loft/lie/length follow the manufacturer's catalogue;
head dimensions and surface profiles are photo-derived authoring estimates.
"""
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def build_putter(scene,loft,api):
    mesh,tube,material=(api[k] for k in ['mesh','tube','material'])
    steel=material('putter satin steel',(.64,.67,.69),1,.31)
    polish=material('putter polished radius',(.72,.75,.77),1,.20)
    channel=material('putter channel steel',(.58,.61,.63),1,.26)
    face_mat=material('putter milled face',(.56,.59,.61),.98,.34)
    milling=material('putter milling recess',(.27,.30,.32),.88,.42)
    top_mill=material('putter shoulder milling',(.51,.54,.56),1,.38)
    black=material('putter alignment inlay',(.008,.012,.013),.05,.53)
    rubber=material('putter grip rubber',(.018,.023,.022),0,.76)
    grip_detail=material('putter grip etching',(.07,.079,.075),0,.87)
    shaft_mat=material('putter chrome shaft',(.67,.70,.72),1,.17)
    lie=71;length_inches=34
    axis=Vector((math.cos(math.radians(lie)),0,math.sin(math.radians(lie))))
    tangent=math.tan(math.radians(loft));front=-.014
    origin=Vector((0,.013));n=224

    def ease(t):
        t=max(0,min(1,t));return t*t*(3-2*t)

    def activate(ob):
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True)
        bpy.context.view_layer.objects.active=ob

    def normals(ob):
        bm=bmesh.new();bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(ob.data);bm.free()

    def rounded(points,radius=.0014):
        result=[]
        for i,p in enumerate(points):
            p=Vector(p);a=Vector(points[i-1]);b=Vector(points[(i+1)%len(points)])
            d=min(radius,(a-p).length*.3,(b-p).length*.3)
            start=p+(a-p).normalized()*d;end=p+(b-p).normalized()*d
            for j in range(7):
                t=j/6;result.append(tuple((1-t)**2*start+2*(1-t)*t*p+t*t*end))
        return result

    outline=[(-.050,front),(.050,front),(.052,-.012),(.052,-.003)]
    outline += [(.052*math.cos(math.pi*j/80),-.003+.050*math.sin(math.pi*j/80)) for j in range(1,81)]
    outline += [(-.052,-.012)]
    outline=rounded(outline,.0016)
    pocket=rounded([(-.027,.0005),(.027,.0005),(.027,.011),(.024,.027),
                    (.019,.037),(.009,.0405),(0,.0415),(-.009,.0405),
                    (-.019,.037),(-.024,.027),(-.027,.011)],.003)

    def radial(poly):
        result=[]
        for k in range(n):
            d=Vector((math.cos(math.tau*k/n),math.sin(math.tau*k/n)));hits=[]
            for i,p in enumerate(poly):
                p=Vector(p);e=Vector(poly[(i+1)%len(poly)])-p
                det=d.x*e.y-d.y*e.x
                if abs(det)<1e-10:continue
                q=p-origin;t=(q.x*e.y-q.y*e.x)/det;u=(q.x*d.y-q.y*d.x)/det
                if t>0 and 0<=u<=1:hits.append(t)
            if not hits:raise RuntimeError('Putter contour is not radial')
            result.append(origin+d*min(hits))
        return result

    outline=radial(outline);pocket=radial(pocket)

    def upper(x,y):return .027-.0155*ease((y+.001)/.048)+.00025*(1-(x/.055)**2)
    def lower(x,y):return .0033+.0017*(abs(x)/.052)**3+.0008*(max(0,y)/.047)**2
    def floor(x,y):return .0108+.0007*ease((y-.020)/.020)+.0003*(x/.028)**2
    def point(x,y,z):return (x,y+(z-.015)*tangent*(1-ease((y-front)/.011)),z)
    def inset(p,d):return p+(origin-p).normalized()*d
    vv=[];ff=[];material_ids=[]

    def add_ring(points):
        ring=[]
        for p in points:ring.append(len(vv));vv.append(tuple(p))
        return ring

    def bridge(a,b,mat):
        for i in range(n):
            j=(i+1)%n;ff.append((a[i],a[j],b[j],b[i]));material_ids.append(mat)

    sections=[(0,.0013),(.025,.00045),(.09,0),(.32,0),(.83,0),(.94,.0005),(.985,.0012),(1,.0019)]
    last=None;first=None
    for t,offset in sections:
        points=[]
        for p in outline:
            x,y=inset(p,offset);z=lower(x,y)+(upper(x,y)-lower(x,y))*t
            points.append(point(x,y,z))
        ring=add_ring(points)
        if last is not None:bridge(last,ring,0)
        else:first=ring
        last=ring
    # Broad U-shaped shoulders and a face bar surround a real recessed channel.
    outer=[inset(p,.0019) for p in outline]
    mouth=[inset(p,-.0011) for p in pocket]
    for q in [.15,.35,.6,.85,1]:
        ring=add_ring([point(*(p.lerp(m,q)),upper(*(p.lerp(m,q)))) for p,m in zip(outer,mouth)])
        bridge(last,ring,1);last=ring
    for depth,offset in [(.035,-.0002),(.13,.00065),(.35,.0012),(.70,.0013),(.92,.0017),(1,.0027)]:
        points=[]
        for p in pocket:
            x,y=inset(p,offset);z=upper(x,y)+(floor(x,y)-upper(x,y))*depth
            points.append(point(x,y,z))
        ring=add_ring(points);bridge(last,ring,2);last=ring
    floor_edge=[inset(p,.0027) for p in pocket]
    for j in range(1,18):
        points=[]
        for p in floor_edge:
            x,y=origin+(p-origin)*(1-j/18);points.append(point(x,y,floor(x,y)))
        ring=add_ring(points);bridge(last,ring,2);last=ring
    c=len(vv);vv.append(point(*origin,floor(*origin)))
    for i in range(n):ff.append((last[i],last[(i+1)%n],c));material_ids.append(2)
    last=first
    for j in range(1,13):
        ring=add_ring([point(*(origin+(inset(p,.0013)-origin)*(1-j/13)),lower(*(origin+(inset(p,.0013)-origin)*(1-j/13)))) for p in outline])
        bridge(last,ring,1);last=ring
    c=len(vv);vv.append(point(*origin,lower(*origin)))
    for i in range(n):ff.append((last[i],last[(i+1)%n],c));material_ids.append(1)
    body=mesh('Continuous half moon putter',vv,ff,polish)
    body.data.materials.append(steel);body.data.materials.append(channel)
    for p,mat in zip(body.data.polygons,material_ids):p.material_index=mat
    normals(body)

    def boolean(tool,operation):
        # Work in millimetres for robust tiny sockets and fillets.
        for ob in [body,tool]:
            for v in ob.data.vertices:v.co*=1000
            ob.location*=1000
        activate(body);mod=body.modifiers.new('Machined join','BOOLEAN')
        mod.operation=operation;mod.solver='EXACT';mod.object=tool
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(tool,do_unlink=True)
        for v in body.data.vertices:v.co/=1000
        body.location/=1000;body.data.update()

    # Short, flared centre socket. It intersects the face bar and is united
    # into the main head; the shaft begins directly at its silver collar.
    base=Vector((0,-.00625,.0263));u=Vector((axis.z,0,-axis.x));v=Vector((0,1,0))
    profile=[(-.004,.0049),(0,.0051),(.0011,.0050),(.0035,.0046),(.0078,.0046),(.009,.0050),(.0105,.0050)]
    verts=[];faces=[];sides=80
    for t,r in profile:
        center=base+axis*t
        verts.extend(center+r*(u*math.cos(math.tau*i/sides)+v*math.sin(math.tau*i/sides)) for i in range(sides))
    faces=[tuple(reversed(range(sides))),tuple(range((len(profile)-1)*sides,len(profile)*sides))]
    faces.extend((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i) for j in range(len(profile)-1) for i in range(sides))
    neck=mesh('Compact centre shaft socket',verts,faces,polish);normals(neck)
    boolean(neck,'UNION')
    for x in [-.035,.035]:
        cutter=tube('Sole weight recess cutter',(x,.002,-.003),(x,.002,.0069),.0086,.0086,steel,80)
        activate(cutter);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        boolean(cutter,'DIFFERENCE')
    normals(body)
    activate(body)
    for vert in body.data.vertices:vert.co*=1000
    bevel=body.modifiers.new('Small machined edge fillets','BEVEL');bevel.width=.32;bevel.segments=3
    bevel.limit_method='ANGLE';bevel.angle_limit=.65;bevel.use_clamp_overlap=True
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for vert in body.data.vertices:vert.co/=1000
    body.data.update();normals(body)
    for p in body.data.polygons:p.use_smooth=True

    bm=bmesh.new();bm.from_mesh(body.data);bm.normal_update();bm.verts.ensure_lookup_table()
    bad=sum(not e.is_manifold for e in bm.edges);todo=set(bm.verts);components=0
    while todo:
        components+=1;stack=[todo.pop()]
        while stack:
            for edge in stack.pop().link_edges:
                for vert in edge.verts:
                    if vert in todo:todo.remove(vert);stack.append(vert)
    if bad or components!=1:raise RuntimeError(f'Putter main head is not one closed solid: {bad} edges, {components} components')
    # Keep the broad steel fields calm, with smooth normals on curved lips.
    normals_out=[]
    for loop in body.data.loops:
        vert=bm.verts[loop.vertex_index];x,y,z=vert.co;normal=vert.normal.copy()
        for height in [upper,floor]:
            if abs(z-height(x,y))<.000005:
                dx=(height(x+.00001,y)-height(x-.00001,y))/.00002
                dy=(height(x,y+.00001)-height(x,y-.00001))/.00002
                normal=Vector((-dx,-dy,1)).normalized()
        if abs(y-(front+(z-.015)*tangent))<1e-6 and abs(x)<.050:
            normal=Vector((0,-1,tangent)).normalized()
        normals_out.append(normal)
    body.data.normals_split_custom_set(normals_out)
    tree=BVHTree.FromBMesh(bm)
    fitted=0
    def surface(x,y,up=True,offset=.00003):
        nonlocal fitted
        hit,normal,_,_=tree.ray_cast(Vector((x,y,.060 if up else -.020)),Vector((0,0,-1 if up else 1)))
        if hit is None:raise RuntimeError(f'Putter surface detail off the head: {x}, {y}')
        fitted+=1;return hit+normal*offset

    # Three inlaid aiming lines, with a wider centre line. Their rounded ends
    # and every intermediate point follow the recessed channel floor.
    for x,width,y1 in [(-.017,.00085,.0345),(0,.00135,.038),(.017,.00085,.0345)]:
        radius=width/2;y0=.0035;verts=[];faces=[];steps=56
        for j in range(steps+1):
            yy=y0+(y1-y0)*j/steps
            end=min(yy-y0,y1-yy)
            half=math.sqrt(max(0,radius**2-(radius-min(radius,end))**2))
            verts.extend([surface(x-half,yy),surface(x+half,yy)])
            if j:faces.append((2*j-2,2*j-1,2*j+1,2*j))
        ob=mesh('Recessed alignment line',verts,faces,black)
        for p in ob.data.polygons:p.use_smooth=False

    # A flush satin striking field and fine interleaved scallop milling.
    # All face detail lives in the 3.5-degree striking plane, within its rim.
    def face_y(z):return front+(z-.015)*tangent
    face_outline=rounded([(-.0485,.008),(-.047,.0066),(0,.0060),(.047,.0066),
                          (.0485,.008),(.0485,.0218),(.0468,.0232),(-.0468,.0232),(-.0485,.0218)],.0012)
    verts=[(x,face_y(z)-.000022,z) for x,z in face_outline]
    field=mesh('Flush milled striking field',verts,[tuple(range(len(verts)))],face_mat)
    for p in field.data.polygons:p.use_smooth=False
    vv=[];ff=[]
    for direction in [-1,1]:
        for j in range(135):
            x0=-.0475+j*.00071;last=False
            for k in range(33):
                q=k/32;z=.0071+q*.0153
                x=x0+direction*.00055*(2*q-1)**2
                if abs(x)>(.0469 if z<.008 or z>.0216 else .0478):last=False;continue
                i=len(vv);vv.extend([(x-.000025,face_y(z)-.000046,z),(x+.000025,face_y(z)-.000046,z)])
                if last:ff.append((i-2,i-1,i+1,i))
                last=True
    ob=mesh('Interleaved face milling',vv,ff,milling)
    for p in ob.data.polygons:p.use_smooth=False

    # Parallel shoulder machining stops at the cavity lip and socket.
    vv=[];ff=[]
    for j in range(165):
        x=-.050+j*.00061;last=False
        for k in range(70):
            y=-.012+k*.00083
            hit,normal,_,_=tree.ray_cast(Vector((x,y,.060)),Vector((0,0,-1)))
            good=hit is not None and abs(hit.z-upper(x,y))<.00009 and normal.z>.78
            if not good:last=False;continue
            i=len(vv);vv.extend([surface(x-.000018,y),surface(x+.000018,y)])
            if last:ff.append((i-2,i-1,i+1,i))
            last=True
    mesh('Fine shoulder machining',vv,ff,top_mill)

    # Paired flush sole weights and small recessed hexagonal fasteners.
    for x in [-.035,.035]:
        disk=tube('Satin sole weight',(x,.002,.0046),(x,.002,.00665),.00812,.00812,steel,80)
        for p in disk.data.polygons:p.use_smooth=len(p.vertices)==4
        tube('Dark weight socket',(x,.002,.00454),(x,.002,.00460),.00175,.00175,black,6)
        # A narrow shadow seam follows the circular recess, without raised rails.
        verts=[];faces=[]
        for r in [.00813,.00839]:
            verts.extend((x+r*math.cos(math.tau*i/96),.002+r*math.sin(math.tau*i/96),.00464) for i in range(96))
        faces=[(i,(i+1)%96,(i+1)%96+96,i+96) for i in range(96)]
        mesh('Weight inset seam',verts,faces,black)
    bm.free()

    # Straight centre shaft: no iron-style ferrule or tall slant neck.
    end=length_inches*.0254-base.dot(axis)
    tube('Straight tapered putter shaft',base+axis*.0095,base+axis*(end-.010),.00465,.0061,shaft_mat,64)
    grip_start=end-.250
    grip_verts=[];grip_faces=[];rings=14;segments=72
    for j in range(rings):
        t=j/(rings-1);along=grip_start+.25*t;scale=.83+.17*t
        for i in range(segments):
            a=math.tau*i/segments
            xx=.0105*math.cos(a)*scale;yy=max(-.0079,.0125*math.sin(a))*scale
            grip_verts.append(base+axis*along+u*xx+v*yy)
    grip_faces=[tuple(reversed(range(segments))),tuple(range((rings-1)*segments,rings*segments))]
    grip_faces.extend((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i) for j in range(rings-1) for i in range(segments))
    grip=mesh('Flat front putter grip',grip_verts,grip_faces,rubber);normals(grip)
    vv=[];ff=[]
    for j in range(60):
        t=.025+j/59*.95;scale=.83+.17*t;center=base+axis*(grip_start+.25*t)+v*(-.0079*scale-.000035)
        i=len(vv);vv.extend([center-u*.0061+axis*-.00012,center+u*.0061+axis*-.00012,center+u*.0061+axis*.00012,center-u*.0061+axis*.00012]);ff.append((i,i+1,i+2,i+3))
    mesh('Flush grip etching',vv,ff,grip_detail)

    measured_lie=math.degrees(math.atan2(axis.z,axis.x))
    if abs(measured_lie-lie)>.001:raise RuntimeError('Putter shaft lie differs from target')
    return {'id':'putter','closedHead':True,'headComponents':components,'nonManifoldEdges':bad,
            'loftDegrees':loft,'lieDegrees':round(measured_lie,3),'lengthInches':length_inches,
            'centreShaft':True,'socketUnion':True,'alignmentLines':3,'soleWeightRecesses':2,
            'fittedDetailVertices':fitted,'faceMillingBands':270,'flatFrontGrip':True,
            'estimatedHeadWidthMm':104,'estimatedHeadDepthMm':61,'estimatedFaceHeightMm':24,
            'estimatedChannelDepthMm':15.5,'maximumSurfaceDetailOffsetMm':.046}
