"""Continuous cavity-back heads with fitted face details and number stamps.

Used by build_clubs.py inside Blender MCP. All dimensions are metres.
"""
import bpy, bmesh, math, runpy
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree


def build_iron(scene, loft, number, api):
    mesh, smooth, plate, shaft = (api[k] for k in ['mesh','smooth_outline','plate','shaft'])
    chrome, satin, face_mat, groove = (api[k] for k in ['chrome','satin','face_mat','groove'])
    # D9 Forged published lie/length/offset progression (TGW's specification table).
    # Blade contours below are authored estimates from the product and review
    # photographs; those photos do not supply engineering dimensions.
    lie, length_inches, offset_inches = {
        5:(61,38.25,.133), 6:(61.5,37.75,.117), 7:(62,37.25,.100),
        8:(63,36.75,.084), 9:(63.5,36.25,.067),
    }[number]
    head_transform = Matrix.Translation((0,0,.006)) @ Matrix.Rotation(math.radians(-loft),4,'X')
    inverse = head_transform.inverted()
    before=set(scene.objects)

    def activate(ob):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True);bpy.context.view_layer.objects.active=ob

    def apply(ob):
        activate(ob)
        for mod in list(ob.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)

    def normals(ob):
        bm=bmesh.new();bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(ob.data);bm.free()

    def check_closed(ob,stage):
        if len(ob.data.vertices)<4:raise RuntimeError(f'Iron {number}, {stage}: empty solid')
        bm=bmesh.new();bm.from_mesh(ob.data)
        bad=sum(1 for edge in bm.edges if not edge.is_manifold)
        bm.free()
        if bad:raise RuntimeError(f'Iron {number}, {stage}: {bad} non-manifold edges')

    def finish(ob, width=.0007, clamp=False):
        activate(ob)
        for v in ob.data.vertices:v.co*=1000
        ob.data.update()
        bevel=ob.modifiers.new('Machined edge radius','BEVEL');bevel.width=width*1000;bevel.segments=5
        bevel.limit_method='ANGLE';bevel.angle_limit=.35
        bevel.use_clamp_overlap=clamp
        bevel.harden_normals=True
        normals_mod=ob.modifiers.new('Forged surface normals','WEIGHTED_NORMAL');normals_mod.keep_sharp=True
        apply(ob)
        for v in ob.data.vertices:v.co/=1000
        ob.data.update()

    # Landmark coordinates from the flat product photograph, brought into a
    # face-local frame using the 7 iron's lie. A rounded toe and almost straight
    # upper edge replace the triangular, pinched heel of the first pass.
    c,s=math.cos(math.radians(28)),math.sin(math.radians(28))
    width_scale=1-(number-7)*.004
    # The photographed back is foreshortened by loft. Recover its face-frame
    # height before applying each club's actual loft in 3D (avoid tilting twice).
    height_scale=(1+(number-7)*.012)/math.cos(math.radians(30.5))
    def landmark(px,pz):
        x,z=px-400,pz-250
        return ((-.009+(c*x+s*z)*.000117)*width_scale,
                (.002+(-s*x+c*z+164)*.000117)*height_scale)
    # Small radii at deliberate corners retain the angular stamped geometry.
    def rounded(points,radius=.00065,steps=5):
        result=[]
        for i,p in enumerate(points):
            p=Vector(p);a=Vector(points[i-1]);b=Vector(points[(i+1)%len(points)])
            d=min(radius,(a-p).length*.24,(b-p).length*.24)
            start=p+(a-p).normalized()*d;end=p+(b-p).normalized()*d
            for k in range(steps+1):
                t=k/steps;result.append(tuple((1-t)**2*start+2*(1-t)*t*p+t*t*end))
        return result
    def contour(points,radius=.00065):
        return rounded([landmark(x,z) for x,z in points],radius)
    pocket=contour([(104,319),(103,277),(126,198),(151,172),(354,139),
                    (377,146),(606,296),(636,345),(642,391),(609,400),
                    (491,399),(268,373),(151,349)],.001)
    outline=smooth([landmark(x,z) for x,z in [
        (60,290),(85,185),(150,89),(220,44),(292,42),(381,63),
        (520,128),(644,212),(712,281),(733,350),(706,400),
        (650,425),(560,433),(379,418),(224,393),(104,362)]],6)
    # The front and back sole edges cannot share the same height in the face
    # frame: after applying loft that produces a knife-like, tilted sole. Lift
    # the rear edge to give the sole a small positive bounce and camber.
    sole_lift=.019*math.tan(math.radians(loft))+.0014
    def warp(z):
        t=max(0,min(1,(.032-z)/.030))
        return z+sole_lift*t*t*(3-2*t)
    def rear(z):return .0182+(number-7)*.00015-z*.345
    # Radial correspondence lets the outer skin roll continuously into the
    # inner cavity. It gives the rim a real cross-section and soft highlights.
    center=Vector((-.008,.027))
    def radial(poly):
        result=[]
        for k in range(192):
            d=Vector((math.cos(math.tau*k/192),math.sin(math.tau*k/192)))
            hits=[]
            for i,a in enumerate(poly):
                a=Vector(a);b=Vector(poly[(i+1)%len(poly)]);edge=b-a
                det=d.x*edge.y-d.y*edge.x
                if abs(det)<1e-10:continue
                q=a-center
                t=(q.x*edge.y-q.y*edge.x)/det
                u=(q.x*d.y-q.y*d.x)/det
                if t>0 and 0<=u<=1:hits.append(t)
            if not hits:raise RuntimeError('Cavity contour is not star-shaped')
            result.append(tuple(center+d*min(hits)))
        return result
    outline=radial(outline);pocket=radial(pocket)
    warped_pocket=[(x,warp(z)) for x,z in pocket]
    cavity_y=.0005
    n=len(outline)
    # Intermediate perimeter rings crown the sole instead of leaving a broad
    # flat extrusion. All rear geometry uses the same warped face frame.
    verts=[]
    for t in [0,.15,.4,.7,1]:
        for x,z in outline:
            zz=z+(warp(z)-z)*t
            low=max(0,min(1,(.025-z)/.023))
            zz-=math.sin(math.pi*t)*.0010*low
            verts.append((x,-.0045+(rear(warp(z))-.0012+.0045)*t,zz))
    rim_profile=[(.12,-.00025),(.32,.00025),(.53,.00020),(.72,-.00030),(.85,-.0010),(.94,-.0019),(1,None)]
    for q,delta in rim_profile:
        for (ox,oz),(ix,iz) in zip(outline,pocket):
            x=ox+(ix-ox)*q;z=warp(oz+(iz-oz)*q)
            y=cavity_y if delta is None else max(cavity_y+.0003,rear(z)+delta)
            verts.append((x,y,z))
    ring_count=5+len(rim_profile)
    faces=[tuple(reversed(range(n))),tuple(range((ring_count-1)*n,ring_count*n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(ring_count-1) for i in range(n)]
    body=mesh('Continuous forged head',verts,faces,chrome);normals(body)
    check_closed(body,'lofted shell')

    # A direct boundary loft makes the head, heel and hosel one surface.
    leading_y=(head_transform@Vector((0,-.0045,.002))).y
    base=Vector((.046,leading_y-offset_inches*.0254+.0052,.039))
    axis=Vector((math.cos(math.radians(lie)),0,math.sin(math.radians(lie))))
    attach=runpy.run_path(str(Path(__file__).with_name('hosel_geometry.py')))['attach_hosel']
    hosel_audit=attach(body,head_transform,base,axis,.0275*width_scale,number)
    check_closed(body,'stitched heel')
    finish(body,.00020,clamp=True)
    check_closed(body,'neck rounding')
    normals(body)
    # Keep weighted normals on the broad blade planes, but use the continuous
    # surface normals on the neck's small, unevenly spaced loft polygons.
    bm=bmesh.new();bm.from_mesh(body.data);bm.normal_update();bm.verts.ensure_lookup_table()
    neck_normals=[]
    for loop,corner in zip(body.data.loops,body.data.corner_normals):
        vert=bm.verts[loop.vertex_index]
        t=max(0,min(1,(vert.co.x-.0275*width_scale)/.003))
        q=t*t*(3-2*t)
        neck_normals.append(corner.vector.lerp(vert.normal,q).normalized())
    body.data.normals_split_custom_set(neck_normals)
    bm.free()

    cavity_mat=api['material']('iron cavity satin',(.54,.57,.59),1,.34)
    muscle_mat=api['material']('iron directional satin',(.63,.66,.68),1,.27)
    seam_mat=api['material']('iron machined recess',(.16,.18,.19),.9,.38)
    floor_outline=[(-.006+(x+.006)*.985,.030+(z-.030)*.97) for x,z in warped_pocket]
    floor=plate('Continuous brushed cavity field',floor_outline,cavity_y-.0001,cavity_y+.00007,cavity_mat,0)
    for p in floor.data.polygons:p.use_smooth=False

    # Angular lower weight, broad planar bevel and fine shadow seam. The
    # reference's mass is next to the SOLE; it was misplaced at the topline.
    # Separate shallow planes meet along a ridge instead of floating as a pill.
    def fitted_panel(name,points,height,mat):
        points=contour(points,.00065)
        m=len(points)
        vv=[(x,cavity_y+.00003,warp(z)) for x,z in points]
        vv += [(x,height(x,warp(z)),warp(z)) for x,z in points]
        ff=[tuple(reversed(range(m))),tuple(range(m,2*m))]
        ff += [(i,(i+1)%m,(i+1)%m+m,i+m) for i in range(m)]
        ob=mesh(name,vv,ff,mat);normals(ob)
        for p in ob.data.polygons:p.use_smooth=False
        finish(ob,.00020,clamp=True)
        return ob
    ridge_y=lambda x,z: .0030+(rear(z)-.0030)*.48
    muscle_points=[(155,199),(169,180),(354,154),(376,163),
                   (600,307),(625,355),(633,379),(440,345),(350,268)]
    muscle=fitted_panel('Integrated angular sole muscle',muscle_points,ridge_y,muscle_mat)
    # The narrow diagonal returns towards the heel in two straight facets.
    ridge_points=[(125,212),(153,205),(350,276),(434,351),(631,383),
                  (618,391),(427,366),(341,291),(132,226)]
    ridge=fitted_panel('Polished diagonal return',ridge_points,lambda x,z:ridge_y(x,z)-.00015,chrome)
    seam_points=[(135,232),(336,297),(420,373),(595,395),(544,392),
                 (414,379),(331,305),(139,239)]
    fitted_panel('Fine diagonal recess',seam_points,lambda x,z:cavity_y+.00012,seam_mat)

    # Face milling is a surface treatment, never a tube floating off the edge.
    # Clip the rectangular blasted area against the silhouette with 4 mm margins.
    def face_span(z):
        xs=[]
        for i,(x0,z0) in enumerate(outline):
            x1,z1=outline[(i+1)%n]
            if min(z0,z1)<=z<max(z0,z1):xs.append(x0+(x1-x0)*(z-z0)/(z1-z0))
        return (max(-.030,min(xs)+.0035),min(.021,max(xs)-.0035)) if len(xs)>1 else (0,0)
    vv=[];ff=[];rows=56
    for j in range(rows+1):
        z=.006+j/rows*(max(p[1] for p in outline)-.009)
        left,right=face_span(z)
        vv.extend([(left,-.00456,z),(right,-.00456,z)])
        if j:ff.append((2*j-2,2*j-1,2*j+1,2*j))
    patch=mesh('Flush blasted face',vv,ff,face_mat)
    for p in patch.data.polygons:p.use_smooth=False
    for j in range(13):
        z=.007+j*.00360
        left,right=face_span(z)
        left+=.0008;right-=.0008
        if right<=left:continue
        cut=mesh('Inset face scoreline',[(left,-.00463,z-.00017),(right,-.00463,z-.00017),
                                       (right,-.00463,z+.00017),(left,-.00463,z+.00017)],[(0,1,2,3)],groove)
        for p in cut.data.polygons:p.use_smooth=False

    # Numerals are converted to fitted triangle meshes, with no brand text.
    font_path=Path('C:/Windows/Fonts/bahnschrift.ttf')
    font=bpy.data.fonts.load(str(font_path),check_existing=True) if font_path.exists() else bpy.data.fonts.get('Bfont')
    def numeral(name,size,location,rotation):
        cu=bpy.data.curves.new(name,'FONT');cu.body=str(number);cu.size=size
        cu.align_x='CENTER';cu.align_y='CENTER';cu.resolution_u=10
        if font:cu.font=font
        ob=bpy.data.objects.new(name,cu);scene.collection.objects.link(ob)
        ob.location=location;ob.rotation_euler=rotation;cu.materials.append(groove)
        activate(ob);bpy.ops.object.convert(target='MESH');bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        for p in ob.data.polygons:p.use_smooth=False
        return ob
    stamp_x,stamp_z=landmark(211,320)
    back=numeral('Cavity number '+str(number),.0085,(stamp_x,cavity_y+.00015,warp(stamp_z)),(math.pi/2,0,math.pi))
    sole=numeral('Sole number '+str(number),.0105,(-.033,.006,0),(math.pi,0,0))
    stamp=bmesh.new();stamp.from_mesh(sole.data)
    bmesh.ops.triangulate(stamp,faces=list(stamp.faces))
    bmesh.ops.subdivide_edges(stamp,edges=list(stamp.edges),cuts=3,use_grid_fill=True)
    stamp.to_mesh(sole.data);stamp.free()
    bm=bmesh.new();bm.from_mesh(body.data);tree=BVHTree.FromBMesh(bm)
    for vert in sole.data.vertices:
        hit,normal,_,_=tree.ray_cast(Vector((vert.co.x,vert.co.y,-.025)),Vector((0,0,1)))
        if hit is None:raise RuntimeError(f'Sole numeral is outside the head silhouette: {tuple(vert.co)}, body vertices={len(body.data.vertices)}')
        vert.co=hit+normal*.000070
    bm.free()

    # Small flush sole ports on the long irons, consistent with the photographed
    # 5/6/7 sole. They are fitted to the solid skin and cannot protrude as rods.
    if number<=7:
        bm=bmesh.new();bm.from_mesh(body.data);tree=BVHTree.FromBMesh(bm)
        for x0,x1,y in [(-.024,-.001,.0035),(-.012,.013,.0090),(.002,.021,.0035)]:
            points=[];polygons=[];segments=48;rings=5
            for ring in range(rings+1):
                radius=ring/rings
                for k in range(segments):
                    a=-math.pi/2+(k%(segments//2))/(segments//2)*math.pi
                    if k>=segments//2:a+=math.pi
                    center=x1-.00065 if k<segments//2 else x0+.00065
                    edge_x=center+.00065*math.cos(a)
                    x=(x0+x1)/2+radius*(edge_x-(x0+x1)/2);yy=y+radius*.00065*math.sin(a)
                    hit,normal,_,_=tree.ray_cast(Vector((x,yy,-.025)),Vector((0,0,1)))
                    if hit is None:raise RuntimeError('Sole port is outside the head')
                    points.append(hit+normal*.000075)
                    if ring:
                        previous=(ring-1)*segments;current=ring*segments;j=(k+1)%segments
                        polygons.append((previous+k,previous+j,current+j,current+k))
            port=mesh('Flush sole slot',points,polygons,groove)
            for p in port.data.polygons:p.use_smooth=False
        bm.free()

    # Verify the load-bearing head is a single closed component before export.
    bm=bmesh.new();bm.from_mesh(body.data)
    bad=sum(1 for edge in bm.edges if not edge.is_manifold)
    if bad:raise RuntimeError(f'Iron {number}: {bad} non-manifold body edges')
    todo=set(bm.verts);components=0
    while todo:
        components+=1;stack=[todo.pop()]
        while stack:
            for edge in stack.pop().link_edges:
                for vert in edge.verts:
                    if vert in todo:todo.remove(vert);stack.append(vert)
    bm.free()
    if components!=1:raise RuntimeError(f'Iron {number}: detached head components ({components})')
    for ob in set(scene.objects)-before:ob.matrix_world=head_transform@ob.matrix_world
    shaft(base,length_inches*.0254-base.dot(axis)-.012,integrated_neck=True,lie=lie)
    measured_lie=math.degrees(math.atan2(axis.z,axis.x))
    face_normal=head_transform.to_3x3()@Vector((0,-1,0))
    measured_loft=math.degrees(math.atan2(face_normal.z,-face_normal.y))
    if abs(measured_lie-lie)>.001 or abs(measured_loft-loft)>.001:
        raise RuntimeError('The generated shaft or face angle differs from its specification')
    return {'number':number,'closedHead':True,'headComponents':components,
            'soleNumber':True,'cavityNumber':True,'flushScorelines':13,
            'loftDegrees':round(measured_loft,3),'lieDegrees':round(measured_lie,3),
            'lengthInches':length_inches,'offsetMm':round(offset_inches*25.4,3),
            'hosel':hosel_audit,
            'estimatedBladeWidthMm':round((max(p[0] for p in outline)-min(p[0] for p in outline))*1000,2),
            'estimatedFaceHeightMm':round((max(p[1] for p in outline)-min(p[1] for p in outline))*1000,2)}
