"""Conservative roof-trace models for Cafe 9 and the hole 15 toilet.

build(ctx) uses only the shared authoring context; it does not access Blender.
Main roof edges come unchanged from ancillary-location-review.json. Heights,
wall inset, pale wall finish, roof pitch and canopy supports are estimates.
"""
import json
import math
from pathlib import Path


ORIGIN = (677700.5, 6586399.5)
WALL = 0xCCCBC1
FOUNDATION = 0x8F9290
ROOF = 0x343B3F
FASCIA = 0x515858
SOFFIT = 0xB7B8AF
CANOPY_POST = 0xB9BBB2
PAVING = 0x99988F

# Independently reviewed north roof projection in hole-10-tees.png.
# This approximate roof trace is separate from the unchanged main-roof trace.
CAFE_NORTH_PROJECTION_PIXELS = [(839,592), (852,590), (856,601), (841,605)]


def local(point):
    return (point[0]-ORIGIN[0], point[1]-ORIGIN[1])


def average(points):
    return tuple(sum(p[i] for p in points)/len(points) for i in range(len(points[0])))


def inset(ring, amount):
    """Small estimated wall setback; main roof polygon is never modified."""
    c = average(ring)
    radius = min(math.dist(c,p) for p in ring)
    factor = 1-amount/radius
    return [(c[0]+(p[0]-c[0])*factor,c[1]+(p[1]-c[1])*factor) for p in ring]


def intersection(a,b,c,d):
    u = (b[0]-a[0], b[1]-a[1])
    v = (d[0]-c[0], d[1]-c[1])
    denominator = u[0]*v[1]-u[1]*v[0]
    assert abs(denominator)>1e-9
    w = (c[0]-a[0],c[1]-a[1])
    t = (w[0]*v[1]-w[1]*v[0])/denominator
    return (a[0]+t*u[0],a[1]+t*u[1])


class Geometry:
    def __init__(self, ctx, parent, prefix):
        self.ctx, self.parent, self.prefix = ctx, parent, prefix
        self.triangles = 0
        self.meshes = 0

    def mesh(self, name, vertices, faces, color, roughness=.85):
        triangles = []
        for face in faces:
            for i in range(1,len(face)-1):
                triangles.extend((face[0],face[i],face[i+1]))
        self.ctx.mesh(self.parent,self.prefix+' '+name,vertices,triangles,color,
                      roughness=roughness)
        self.triangles += len(triangles)//3
        self.meshes += 1

    def prism(self, name, ring, bottom, top, color, roughness=.85):
        """Clockwise source ring, scalar or per-corner vertical levels."""
        count = len(ring)
        lows = [bottom]*count if isinstance(bottom,(int,float)) else bottom
        highs = [top]*count if isinstance(top,(int,float)) else top
        assert all(hi>lo for lo,hi in zip(lows,highs))
        points = [(p[0],p[1],z) for levels in (lows,highs) for p,z in zip(ring,levels)]
        faces = [tuple(range(count)),tuple(reversed(range(count,2*count)))]
        faces.extend((i,i+count,(i+1)%count+count,(i+1)%count) for i in range(count))
        self.mesh(name,points,faces,color,roughness)

    def beam(self, name, a, b, width, depth, color):
        length = math.dist(a,b)
        assert length>1e-5
        axis = tuple((b[i]-a[i])/length for i in range(3))
        if abs(axis[2])<.95:
            side = (-axis[1],axis[0],0)
        else:
            side = (1,0,0)
        length_side = math.sqrt(sum(v*v for v in side))
        side = tuple(v/length_side for v in side)
        up = (axis[1]*side[2]-axis[2]*side[1],
              axis[2]*side[0]-axis[0]*side[2],
              axis[0]*side[1]-axis[1]*side[0])
        points = [tuple(c[i]+side[i]*s*width/2+up[i]*t*depth/2 for i in range(3))
                  for c in (a,b) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))]
        self.mesh(name,points,[(0,3,2,1),(4,5,6,7),(0,1,5,4),
                             (1,2,6,5),(2,3,7,6),(3,0,4,7)],color)

    def roof_plane(self, name, points, thickness, color):
        """Closed shallow slab, with a CCW top plane and vertical thickness."""
        vertices = [tuple(p) for p in points]+[(p[0],p[1],p[2]-thickness) for p in points]
        self.mesh(name,vertices,[(0,1,2,3),(7,6,5,4),(0,4,5,1),
                                (1,5,6,2),(2,6,7,3),(3,7,4,0)],color)


def shell(ctx, geometry, roof_ring, eave_height, ridge_height):
    """Closed one-storey walls with a two-plane roof over the exact source ring."""
    wall_ring = inset(roof_ring,.22)
    ground_levels = [ctx.ground(*p) for p in wall_ring]
    floor = max(ground_levels)+.08
    eave, ridge = floor+eave_height, floor+ridge_height
    geometry.prism('terrain foundation',wall_ring,[z-.055 for z in ground_levels],
                   floor+.11,FOUNDATION)
    # Source vertices run clockwise NW, NE, SE, SW. The ridge joins the
    # midpoints of north and south gables; that pitch is an authored estimate.
    wall_north,wall_south = average(wall_ring[:2]),average(wall_ring[2:])
    vertices = [(x,y,z) for z in (floor+.08,eave-.065) for x,y in wall_ring]
    vertices += [(*wall_north,ridge-.075),(*wall_south,ridge-.075)]
    faces = [(0,1,2,3),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0),
             (4,7,9,8),(8,9,6,5),(4,8,5),(7,6,9)]
    geometry.mesh('plain walls and gables',vertices,faces,WALL)
    p = [(*point,eave) for point in roof_ring]
    north,south = (*average(roof_ring[:2]),ridge),(*average(roof_ring[2:]),ridge)
    geometry.roof_plane('west roof plane',[p[0],p[3],south,north],.085,ROOF)
    geometry.roof_plane('east roof plane',[north,south,p[2],p[1]],.085,ROOF)
    # Modest physical roof-edge thickness reads at approach distance without
    # inventing a roof covering, openings, signs, gutters or service equipment.
    edges = [(p[0],p[3]),(p[1],p[2]),(p[0],north),(north,p[1]),
             (p[3],south),(south,p[2])]
    for i,(a,b) in enumerate(edges):
        geometry.beam('roof edge %s'%i,(a[0],a[1],a[2]-.055),
                      (b[0],b[1],b[2]-.055),.09,.10,FASCIA)
    geometry.beam('ridge cap',(north[0],north[1],north[2]+.018),
                  (south[0],south[1],south[2]+.018),.105,.048,ROOF)
    return floor,wall_ring


def evidence(observation, heights, extras=None):
    result = {
        'sourceIds': [observation['id'],observation['ortho']['sourceId'],observation['guide']['id']],
        'sourceDocument': 'lidingobuild/facilities/ancillary-location-review.json',
        'geometryBasis': 'Unchanged manually observed 2025 roof polygon; not a surveyed wall footprint.',
        'roofTraceEpsg3006': observation['observedRoofRingEpsg3006'],
        'roofTracePixels': observation['observedRoofRingPixels'],
        'sourceImage': observation['ortho']['path'],
        'sourceImageSha256': observation['ortho']['sha256'],
        'sourceImageUrl': observation['ortho']['sourceUrl'],
        'captureDate': observation['ortho']['captureDate'],
        'guideUrl': observation['guide']['sourceUrl'],
        'locationConfidence': observation['locationConfidence'],
        'traceUncertainty': observation['geometryUncertainty'],
        'heightEstimatesMetresAboveFloor': {'eave':heights[0],'ridge':heights[1]},
        'heightBasis': 'Authored one-storey proportions. Neither roof/eave height nor pitch is measured.',
        'facadeBasis': 'Neutral pale walls and dark grey roof based on visible tonal areas; actual finish, material, doors and windows remain unverified.',
        'wallFootprintBasis': 'Small estimated inward setback under the source roof, not an independently observed wall trace.',
        'groundBasis': 'Production published 1 m terrain, sampled at wall corners; level floor above highest corner and terrain-following foundation skirt.',
        'openingsAndSigns': 'No unsupported openings, service hatch, logo or signs authored.',
        'sourceBuildingIdsExplanation': 'No matching retained OSM building; this is an additional facility.',
        'exclusionOutline': 'Main observed roof ring; authored north-canopy roof union additionally included for Cafe 9.'
    }
    if extras:
        result.update(extras)
    return result


def cafe(ctx, observation):
    ring = [local(p) for p in observation['observedRoofRingEpsg3006'][:-1]]
    transform = observation['ortho']['geoTransform']
    projection = [local((transform[0]+x*transform[1],transform[3]+y*transform[5]))
                  for x,y in CAFE_NORTH_PROJECTION_PIXELS]
    # Intersections splice only the observed protrusion into the main roof edge.
    # This preserves the original footprint, avoiding a broad vegetation bbox.
    left = intersection(ring[0],ring[1],projection[0],projection[3])
    right = intersection(ring[0],ring[1],projection[1],projection[2])
    outline = [ring[0],left,projection[0],projection[1],right,*ring[1:]]
    heights = (2.55,3.50)
    parent = ctx.facility('cafe-9',[],outline,evidence(observation,heights,{
        'northProjectionTracePixels': CAFE_NORTH_PROJECTION_PIXELS,
        'northProjectionTraceEpsg3006': [[p[0]+ORIGIN[0],p[1]+ORIGIN[1]] for p in projection],
        'northProjectionSourceImage': observation['ortho']['path'],
        'northProjectionReview': 'Small separate dark roof projection is visible north of main roof. Its pixels are approximate; open canopy interpretation, support count and height are authored estimates, consistent with the 2015 covered-sales-area history.',
        'northProjectionEstimate': {'roofHeightAboveFloorM':2.38,'roofThicknessM':.075,'postWidthM':.105},
        'exclusionOutline': 'Exact source main roof plus explicitly traced north roof projection, joined by edge insertion. No unrelated hardscape or vegetation included.'
    }))
    geometry = Geometry(ctx,parent,'cafe9')
    floor,_ = shell(ctx,geometry,ring,*heights)
    # Keep the covered projection small. A little overlap joins it to the wall
    # beneath the main roof overhang; this joint is inside the source main ring.
    axis = (ring[3][0]-ring[0][0],ring[3][1]-ring[0][1])
    length = math.hypot(*axis)
    shift = (axis[0]/length*.24,axis[1]/length*.24)
    back_right = (right[0]+shift[0],right[1]+shift[1])
    back_left = (left[0]+shift[0],left[1]+shift[1])
    canopy_ring = [projection[0],projection[1],back_right,back_left]
    # Clockwise source ring is reversed for upward-facing roof surface.
    canopy_top = [(*p,floor+2.38) for p in reversed(canopy_ring)]
    geometry.roof_plane('north covered projection',canopy_top,.075,ROOF)
    post_points = inset(canopy_ring,.16)[:2]
    for i,p in enumerate(post_points):
        geometry.beam('estimated canopy support %s'%i,(*p,ctx.ground(*p)+.015),
                      (*p,floor+2.31),.105,.105,CANOPY_POST)
    geometry.beam('north canopy fascia',(*projection[0],floor+2.335),
                  (*projection[1],floor+2.335),.10,.11,FASCIA)
    # Only a shallow patch beneath the roof is authored; existing course paths
    # remain source-mapped. Its concrete-like finish is an appearance estimate.
    apron = inset(canopy_ring,.035)
    apron_ground = [ctx.ground(*p) for p in apron]
    geometry.prism('covered approach slab',apron,[z-.015 for z in apron_ground],
                   [z+.035 for z in apron_ground],PAVING)
    return {'id':'cafe-9','triangles':geometry.triangles,'meshes':geometry.meshes,
            'floorRh2000M':round(floor+25,3),'sourceBuildingIds':[]}


def toilet(ctx, observation):
    ring = [local(p) for p in observation['observedRoofRingEpsg3006'][:-1]]
    heights = (2.25,2.75)
    parent = ctx.facility('toilet-15',[],ring,evidence(observation,heights,{
        'roofFormBasis': 'Two modest roof planes express the tonal division in the small orthophoto roof. Exact roof form and pitch are unresolved.',
        'waterPoint': 'Water service at this location is source-confirmed. Fixture geometry and exact fixture placement remain unresolved and are not invented.',
        'exclusionOutline': 'Unchanged manually observed main roof ring only.'
    }))
    geometry = Geometry(ctx,parent,'toilet15')
    floor,_ = shell(ctx,geometry,ring,*heights)
    return {'id':'toilet-15','triangles':geometry.triangles,'meshes':geometry.meshes,
            'floorRh2000M':round(floor+25,3),'sourceBuildingIds':[]}


def build(ctx):
    source = Path(__file__).with_name('ancillary-location-review.json')
    data = json.loads(source.read_text(encoding='utf-8'))
    observations = {o['id']:o for o in data['observations']}
    facilities = [cafe(ctx,observations['observed-cafe9-main-roof-2025']),
                  toilet(ctx,observations['observed-toilet15-roof-2025'])]
    return {'facilities':facilities,'triangles':sum(f['triangles'] for f in facilities),
            'meshes':sum(f['meshes'] for f in facilities),
            'basis':'Reviewed 2025 roof traces with source-confirmed facility identity; conservative appearance estimates.'}
