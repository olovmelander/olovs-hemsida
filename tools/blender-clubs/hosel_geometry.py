"""A continuous heel boundary loft; no overlapping neck on the iron face."""
import bmesh, math
from mathutils import Vector


def attach_hosel(body, head_transform, base, axis, cut_x, number):
    inverse=head_transform.inverted()
    bm=bmesh.new();bm.from_mesh(body.data)
    # The cavity and scorelines stop before this plane. Replace just the last
    # few millimetres of the heel with a loft sharing its actual boundary.
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
        plane_co=Vector((cut_x,0,0)),plane_no=Vector((1,0,0)),dist=1e-7,
        clear_outer=True,clear_inner=False,use_snap_center=True)
    boundary=[e for e in bm.edges if e.is_boundary]
    if not boundary or any(abs(v.co.x-cut_x)>2e-6 for e in boundary for v in e.verts):
        raise RuntimeError(f'Iron {number}: heel cut did not create one clean boundary')
    for edge in list(boundary):
        cuts=max(0,math.ceil(edge.calc_length()/.00055)-1)
        if cuts:bmesh.ops.subdivide_edges(bm,edges=[edge],cuts=cuts,use_grid_fill=False)
    root=set(v for e in bm.edges if e.is_boundary for v in e.verts)
    low=Vector((cut_x,min(v.co.y for v in root),min(v.co.z for v in root)))
    high=Vector((cut_x,max(v.co.y for v in root),max(v.co.z for v in root)))
    root_center=(low+high)/2
    ry,rz=(high.y-low.y)/2,(high.z-low.z)/2
    def angle(v):return math.atan2((v.co.y-root_center.y)/ry,(v.co.z-root_center.z)/rz)
    root=sorted(root,key=angle)
    for i,v in enumerate(root):
        if bm.edges.get((v,root[(i+1)%len(root)])) is None:
            raise RuntimeError(f'Iron {number}: heel boundary is not a single radial loop')
    angles=[angle(v) for v in root]
    root_offsets=[(v.co.z-root_center.z,v.co.y-root_center.y) for v in root]
    # Continue the existing blade slopes at the seam. A flat extrusion here
    # would leave a shoulder in the topline and a kink beneath the heel.
    bm.normal_update()
    root_slopes=[]
    for v in root:
        normal=sum((e.link_faces[0].normal for e in v.link_edges if e.is_boundary),Vector((0,0,0))).normalized()
        yz=normal.y*normal.y+normal.z*normal.z
        slope=Vector((0,-normal.x*normal.y/yz,-normal.x*normal.z/yz)) if yz>1e-8 else Vector((0,0,0))
        root_slopes.append(head_transform.to_3x3()@slope)
    # Carry the blade's small edge radii through the blend instead of
    # propagating its front/sole corner as a sharp ridge along the neck.
    softened=[]
    for v in root:
        weights=[math.exp(-((v.co-other.co).length/.0018)**2) for other in root]
        softened.append(sum((s*w for s,w in zip(root_slopes,weights)),Vector((0,0,0)))/sum(weights))
    root_slopes=softened
    p0=head_transform@root_center
    join=base-axis*.002;end=base+axis*.031
    controls=[p0,p0+Vector((.004,0,0)),p0+Vector((.008,0,0)),
              join-axis*.008,join-axis*.004,join]
    derivatives=[5*(controls[i+1]-controls[i]) for i in range(5)]
    def bezier(points,t):
        n=len(points)-1
        return sum((math.comb(n,i)*(1-t)**(n-i)*t**i*p for i,p in enumerate(points)),Vector((0,0,0)))
    def ease(t):return t*t*t*(10-15*t+6*t*t)
    face_depth=head_transform.to_3x3()@Vector((0,1,0))
    face_up=head_transform.to_3x3()@Vector((0,0,1))
    barrel_up=axis.cross(Vector((0,1,0))).normalized()
    last=root;barrel=[];heel_rings=24;barrel_rings=10

    def connect(points):
        nonlocal last
        current=[bm.verts.new(inverse@point) for point in points]
        for i in range(len(root)):
            j=(i+1)%len(root)
            bm.faces.new((last[i],last[j],current[j],current[i]))
        last=current

    for j in range(1,heel_rings+1):
        t=j/heel_rings;q=ease(t)
        center=bezier(controls,t)
        # Transport the blade section into the barrel without rolling it
        # around the curved centreline; that roll creates a pinched crease.
        u=face_up.lerp(barrel_up,q).normalized()
        depth=face_depth.lerp(Vector((0,1,0)),q)
        w=(depth-u*depth.dot(u)).normalized()
        points=[]
        for a,(dz,dy),slope in zip(angles,root_offsets,root_slopes):
            su=dz*(1-q)+.00545*math.cos(a)*q
            sw=dy*(1-q)+.00545*math.sin(a)*q
            points.append(center+u*su+w*sw+slope*(.020*t*(1-t)**3))
        connect(points)
        if j==heel_rings:barrel.append((list(last),.00545))
    u=axis.cross(Vector((0,1,0))).normalized();w=u.cross(axis).normalized()
    for j in range(1,barrel_rings+1):
        t=j/barrel_rings;radius=.00545+(.0052-.00545)*ease(t)
        center=join.lerp(end,t)
        connect([center+radius*(u*math.cos(a)+w*math.sin(a)) for a in angles])
        barrel.append((list(last),radius))
    bm.faces.new(tuple(last))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    if any(not e.is_manifold for e in bm.edges):raise RuntimeError(f'Iron {number}: open heel loft')
    for face in bm.faces:face.smooth=True

    # Fit circle centres to three exported ring points. A simple vertex mean
    # would be biased because the inherited heel boundary has uneven spacing.
    samples=[min(range(len(angles)),key=lambda i:abs(math.atan2(math.sin(angles[i]-a),math.cos(angles[i]-a)))) for a in [0,math.tau/3,math.tau*2/3]]
    deviation=radial_error=0
    for ring,radius in barrel:
        a,b,c=[head_transform@ring[i].co for i in samples]
        ab,ac=b-a,c-a;normal=ab.cross(ac)
        center=a+(ac.length_squared*normal.cross(ab)+ab.length_squared*ac.cross(normal))/(2*normal.length_squared)
        deviation=max(deviation,(center-base).cross(axis).length)
        radial_error=max(radial_error,max(abs((head_transform@v.co-center).length-radius) for v in ring))
    join_angle=math.degrees(bezier(derivatives,1).angle(axis))
    if deviation>1e-6 or radial_error>1e-6 or join_angle>.001:
        raise RuntimeError(f'Iron {number}: hosel alignment failed ({deviation}, {radial_error}, {join_angle})')
    bm.to_mesh(body.data);bm.free();body.data.update()
    return {'stitchedHeel':True,'rootBoundaryVertices':len(root),'straightBarrelMm':33,
            'shaftAxisDeviationMm':round(deviation*1000,6),'barrelRadiusErrorMm':round(radial_error*1000,6),
            'joinAngleDegrees':round(join_angle,6),'ferruleRadiusMm':5.2}
