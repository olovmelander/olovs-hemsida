"""Photo-inspired, unbranded muscle-back wedges authored in Blender MCP.

The linked gallery depicts the standard ZM, despite its legacy '-ht' URL.
Dimensions are visual estimates; the bag's existing 44/50/56/60 lofts remain.
"""
import bpy, bmesh, math, runpy
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def build_wedge(scene, key, loft, api):
    mesh, smooth, shaft, material = (api[k] for k in ['mesh','smooth_outline','shaft','material'])
    before=set(scene.objects)
    lie=64
    length_inches={'pw':36,'gw':35.75,'sw':35.5,'lw':35.5}[key]
    bounce={'pw':8,'gw':8,'sw':12,'lw':10}[key]
    steel=material('wedge satin steel',(.66,.68,.69),1,.28)
    polish=material('wedge rolled steel',(.70,.73,.75),1,.23)
    face_mat=material('wedge blasted face',(.43,.46,.48),.92,.43)
    mill_mat=material('wedge fine milling',(.49,.52,.54),.95,.38)
    engraving=material('wedge recessed markings',(.045,.055,.060),.45,.44)
    back_mill=material('wedge rear milling',(.52,.55,.57),1,.34)
    ferrule=material('wedge satin ferrule',(.015,.019,.021),.06,.48)
    head_transform=Matrix.Translation((0,0,.006)) @ Matrix.Rotation(math.radians(-loft),4,'X')
    inverse=head_transform.inverted()
    front_y=-.0045
    ridge_z=.027+(loft-44)/16*.010
    height_scale=1+(loft-50)*.003
    width_scale=1+(loft-50)*.0006
    cut_x=.0275

    def ease(t):
        t=max(0,min(1,t));return t*t*(3-2*t)

    def activate(ob):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True);bpy.context.view_layer.objects.active=ob

    def normals(ob):
        bm=bmesh.new();bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(ob.data);bm.free()

    def rear_y(z,x=-.009):
        # Thin upper blade, broad lower muscle and a narrow machined shoulder.
        blend=1-ease((z-ridge_z)/.0038)
        crown=.00085*(1-((x+.009)/.053)**2)
        return .0065-.135*z+(.0068-.105*z)*blend+crown

    # Match the rounded toe and gently bowed leading edge in the gallery's
    # face photograph. Higher lofts get a slightly taller, fuller toe.
    outline=smooth([(x*width_scale,z*height_scale) for x,z in [
        (-.032,.0039),(-.044,.008),(-.049,.020),(-.048,.035),
        (-.041,.050),(-.031,.057),(-.020,.059),(-.007,.055),
        (.008,.046),(.022,.035),(.034,.023),(.036,.015),
        (.027,.007),(.008,.0036),(-.013,.0030)]],8)
    center=Vector((-.009,.028))
    n=192

    def radial(poly,origin):
        result=[]
        for k in range(n):
            d=Vector((math.cos(math.tau*k/n),math.sin(math.tau*k/n)))
            hits=[]
            for i,a in enumerate(poly):
                a=Vector(a);b=Vector(poly[(i+1)%len(poly)]);e=b-a
                det=d.x*e.y-d.y*e.x
                if abs(det)<1e-10:continue
                q=a-origin;t=(q.x*e.y-q.y*e.x)/det;u=(q.x*d.y-q.y*d.x)/det
                if t>0 and 0<=u<=1:hits.append(t)
            if not hits:raise RuntimeError('Wedge outline is not a radial contour')
            result.append(tuple(origin+d*min(hits)))
        return result

    outline=radial(outline,center)
    min_z=min(z for x,z in outline)
    # Solve the trailing sole height after applying loft. Otherwise a simple
    # plate extrusion makes a knife edge, especially on the 56/60 heads.
    rear_low=min_z+.018
    for _ in range(40):
        depth=rear_y(rear_low)-front_y
        sole_width=depth/math.cos(math.radians(loft))
        # Modest positive bounce with rounded leading/trailing relief.
        rise=sole_width*math.tan(math.radians(bounce))*.55
        target=min_z+depth*math.tan(math.radians(loft))-rise/math.cos(math.radians(loft))
        rear_low=(rear_low+target)/2
    lift=rear_low-min_z

    def warp(z):
        q=max(0,1-(z-min_z)/.048)
        return z+lift*q**1.5

    rear_outline=[(x,warp(z)) for x,z in outline]
    rear_center=Vector((-.009,(rear_low+max(z for x,z in outline))*.5))
    verts=[];faces=[]
    # Rounded perimeter: the face is planar, the sole cambered, the rear edge
    # softly rolled. All of these share vertices with the sculpted back.
    sections=[(0,.00065),(.025,.00020),(.09,0),(.28,-.00012),(.55,-.00012),(.82,0),(.965,.00020),(1,.00065)]
    for t,inset in sections:
        for x,z in outline:
            p=Vector((x,z));p+=(center-p).normalized()*inset
            rz=warp(p.y)
            low=1-ease((p.y-min_z)/.023)
            zz=p.y+(rz-p.y)*t-math.sin(math.pi*t)*.0008*low
            verts.append((p.x,front_y+(rear_y(rz,p.x)-front_y)*t,zz))
    side_rings=len(sections)
    faces.append(tuple(reversed(range(n))))
    faces.extend((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(side_rings-1) for i in range(n))
    # Dense, continuous rear surface follows the muscle profile, including the
    # narrow shoulder; no separate floating weight plate or open cavity.
    back_edge=[Vector((verts[(side_rings-1)*n+i][0],verts[(side_rings-1)*n+i][2])) for i in range(n)]
    back_start=len(faces)
    rings=36
    for j in range(1,rings):
        q=1-j/rings
        for p in back_edge:
            x,z=rear_center+(p-rear_center)*q
            verts.append((x,rear_y(z,x),z))
        previous=(side_rings+j-2)*n;current=(side_rings+j-1)*n
        faces.extend((previous+i,previous+(i+1)%n,current+(i+1)%n,current+i) for i in range(n))
    last=(side_rings+rings-2)*n
    middle=len(verts);verts.append((rear_center.x,rear_y(rear_center.y,rear_center.x),rear_center.y))
    faces.extend((last+i,last+(i+1)%n,middle) for i in range(n))
    body=mesh('Continuous sculpted wedge',verts,faces,polish)
    body.data.materials.append(steel)
    for p in body.data.polygons:
        if p.index>=back_start:p.material_index=1
    normals(body)

    leading_y=(head_transform@Vector((0,front_y,min_z))).y
    base=Vector((.046,leading_y-.0015+.0052,.041))
    axis=Vector((math.cos(math.radians(lie)),0,math.sin(math.radians(lie))))
    attach=runpy.run_path(str(Path(__file__).with_name('hosel_geometry.py')))['attach_hosel']
    hosel_audit=attach(body,head_transform,base,axis,cut_x,key)
    normals(body)
    # Analytic surface normals retain the flat blade and smooth shoulder;
    # ordinary vertex normals carry the continuously lofted neck.
    bm=bmesh.new();bm.from_mesh(body.data);bm.normal_update();bm.verts.ensure_lookup_table()
    custom=[]
    for loop in body.data.loops:
        v=bm.verts[loop.vertex_index];x,y,z=v.co
        normal=v.normal.copy()
        q=ease((x-(cut_x-.003))/.006)
        if x<=cut_x+.000001 and abs(y-rear_y(z,x))<.000002:
            dy=(rear_y(z+.00002,x)-rear_y(z-.00002,x))/.00004
            dx=(rear_y(z,x+.00002)-rear_y(z,x-.00002))/.00004
            normal=Vector((-dx,1,-dy)).normalized().lerp(normal,q).normalized()
        if abs(y-front_y)<.0000001 and x<=cut_x+.000001:
            normal=Vector((0,-1,0)).lerp(normal,q).normalized()
        custom.append(normal)
    body.data.normals_split_custom_set(custom)
    bad=sum(not e.is_manifold for e in bm.edges)
    todo=set(bm.verts);components=0
    while todo:
        components+=1;stack=[todo.pop()]
        while stack:
            for e in stack.pop().link_edges:
                for v in e.verts:
                    if v in todo:todo.remove(v);stack.append(v)
    tree=BVHTree.FromBMesh(bm)
    if bad or components!=1:raise RuntimeError(f'{key}: head is not one closed solid ({bad}, {components})')

    def span(poly,z):
        xs=[]
        for i,(x0,z0) in enumerate(poly):
            x1,z1=poly[(i+1)%len(poly)]
            if min(z0,z1)<=z<max(z0,z1):xs.append(x0+(x1-x0)*(z-z0)/(z1-z0))
        return (min(xs),max(xs)) if len(xs)>1 else (0,0)

    def face_span(z):
        a,b=span(outline,z)
        return max(-.034,a+.0030),min(.023,b-.0035)

    # Blasted field follows the topline but keeps the polished toe margin.
    vv=[];ff=[];face_top=max(z for x,z in outline)-.0037
    for j in range(97):
        z=.006+j/96*(face_top-.006);a,b=face_span(z)
        vv.extend([(a,front_y-.000035,z),(b,front_y-.000035,z)])
        if j:ff.append((2*j-2,2*j-1,2*j+1,2*j))
    field=mesh('Flush satin striking field',vv,ff,face_mat)
    for p in field.data.polygons:p.use_smooth=False

    # Faint curved milling and deep-looking fine scorelines, fitted directly
    # against the planar face. Their ends stop inside the blasted field.
    vv=[];ff=[]
    for j in range(95):
        z0=.0068+j*.00052
        if z0>face_top-.0008:break
        a,b=face_span(z0)
        if b-a<.001:continue
        start=len(vv)
        for k in range(33):
            x=a+.0004+(b-a-.0008)*k/32
            z=z0+.00028*math.sin((x+.025)*60)
            vv.extend([(x,front_y-.000045,z-.000022),(x,front_y-.000045,z+.000022)])
            if k:ff.append((start+2*k-2,start+2*k-1,start+2*k+1,start+2*k))
    milling=mesh('Fine face milling',vv,ff,mill_mat)
    for p in milling.data.polygons:p.use_smooth=False
    groove_count=0
    for j in range(16):
        z=.008+j*.00325
        if z>face_top-.0012:break
        a,b=face_span(z);a+=.00055;b-=.00055
        if b-a<.003:continue
        r=.00014;points=[]
        for cx,start in [(b-r,-math.pi/2),(a+r,math.pi/2)]:
            for k in range(9):
                angle=start+math.pi*k/8
                points.append((cx+r*math.cos(angle),front_y-.000075,z+r*math.sin(angle)))
        ob=mesh('Fine inset scoreline',points,[tuple(range(len(points)))],engraving)
        for p in ob.data.polygons:p.use_smooth=False
        groove_count+=1

    # Subtle rear milling above a polished shoulder follows the actual skin.
    # All surface details are fitted by ray casting, so they cannot hover or
    # project through the rounded edge when the club rotates.
    fitted=0;max_offset=0
    def on_back(x,z,offset=.000032):
        nonlocal fitted,max_offset
        hit,normal,_,_=tree.ray_cast(Vector((x,.05,z)),Vector((0,-1,0)))
        if hit is None:raise RuntimeError(f'{key}: rear detail outside head ({x}, {z})')
        fitted+=1;max_offset=max(max_offset,offset)
        return hit+normal*offset

    vv=[];ff=[]
    for j in range(13):
        z=ridge_z+.0005+j/12*.0021
        a,b=span(rear_outline,z);a+=.0020;b=min(b-.0020,cut_x-.0020)
        for k in range(65):
            x=a+(b-a)*k/64;vv.append(on_back(x,z))
            if j and k:
                i=j*65+k;ff.append((i-66,i-65,i,i-1))
    mesh('Polished muscle shoulder',vv,ff,polish)
    vv=[];ff=[]
    for j in range(132):
        x0=-.048+j*.00056
        start=len(vv);last=False
        for k in range(17):
            z=ridge_z+.0032+k/16*.0060
            x=x0+.0007*math.sin((z-ridge_z)/.009*math.pi)
            a,b=span(rear_outline,z)
            valid=a+.0024<x<min(b-.0024,cut_x-.003)
            if not valid:last=False;continue
            i=len(vv);vv.extend([on_back(x-.000025,z),on_back(x+.000025,z)])
            if last:ff.append((i-2,i-1,i+1,i))
            last=True
    mesh('Curved rear milling',vv,ff,back_mill)

    font_path=Path('C:/Windows/Fonts/bahnschrift.ttf')
    font=bpy.data.fonts.load(str(font_path),check_existing=True) if font_path.exists() else None
    def stamp(text,size,location,rotation,sole=False):
        cu=bpy.data.curves.new('Loft marking','FONT');cu.body=text;cu.size=size
        cu.align_x='CENTER';cu.align_y='CENTER';cu.resolution_u=10
        if font:cu.font=font
        ob=bpy.data.objects.new('Wedge '+text,cu);scene.collection.objects.link(ob)
        cu.materials.append(engraving);ob.location=location;ob.rotation_euler=rotation
        activate(ob);bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        stamp_bm=bmesh.new();stamp_bm.from_mesh(ob.data)
        bmesh.ops.triangulate(stamp_bm,faces=list(stamp_bm.faces))
        bmesh.ops.subdivide_edges(stamp_bm,edges=list(stamp_bm.edges),cuts=1,use_grid_fill=True)
        stamp_bm.to_mesh(ob.data);stamp_bm.free()
        for v in ob.data.vertices:
            if sole:
                origin=inverse@Vector((v.co.x,v.co.y,-.025))
                direction=inverse.to_3x3()@Vector((0,0,1))
                hit,normal,_,_=tree.ray_cast(origin,direction)
                if hit is None:raise RuntimeError(f'{key}: sole marking outside head')
                v.co=hit+normal*.000045
            else:v.co=on_back(v.co.x,v.co.z,.000045)
        for p in ob.data.polygons:p.use_smooth=False
        return ob

    stamp(str(loft)+'°',.0080,(-.028,0,ridge_z-.0052),(math.pi/2,0,math.pi))
    stamp(str(loft)+'°',.0100,(-.026,.010,0),(math.pi,0,0),sole=True)
    stamp(str(bounce).zfill(2),.0037,(-.014,.010,0),(math.pi,0,0),sole=True)
    bm.free()

    for ob in set(scene.objects)-before:ob.matrix_world=head_transform@ob.matrix_world
    shaft(base,length_inches*.0254-base.dot(axis)-.012,integrated_neck=True,lie=lie,ferrule_mat=ferrule)
    face_normal=head_transform.to_3x3()@Vector((0,-1,0))
    measured_loft=math.degrees(math.atan2(face_normal.z,-face_normal.y))
    measured_lie=math.degrees(math.atan2(axis.z,axis.x))
    if abs(measured_loft-loft)>.001 or abs(measured_lie-lie)>.001:raise RuntimeError('Wedge angles changed during authoring')
    return {'id':key,'closedHead':True,'headComponents':components,'nonManifoldEdges':bad,
            'loftDegrees':round(measured_loft,3),'lieDegrees':round(measured_lie,3),
            'lengthInches':length_inches,'authoredBounceDegrees':bounce,
            'backLoftMarking':True,'soleLoftMarking':True,'flushScorelines':groove_count,
            'fittedBackDetailVertices':fitted,'maximumBackDetailOffsetMm':max_offset*1000,
            'estimatedBladeWidthMm':round((max(x for x,z in outline)-min(x for x,z in outline))*1000,2),
            'estimatedFaceHeightMm':round((max(z for x,z in outline)-min(z for x,z in outline))*1000,2),
            'hosel':hosel_audit}
