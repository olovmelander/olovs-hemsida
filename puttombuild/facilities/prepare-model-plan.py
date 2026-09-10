"""Reconcile measured roof planes with imagery into buildable Puttom volumes.

This is an architectural interpretation, not a surveyed as-built drawing. Source
images are never shifted. Laser-supported model envelopes use original EN/RH2000
coordinates; sparse details have explicit photographic/production estimates.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from shapely.geometry import MultiPoint, Polygon, LineString
from shapely import constrained_delaunay_triangles

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'models-2026-09-10'
OUT.mkdir(exist_ok=True)
ORIGIN = np.array([697365., 7025190.])
inventory = json.loads((HERE / 'facility-inventory.json').read_text(encoding='utf-8'))
height = json.loads((HERE / 'height-reference.json').read_text(encoding='utf-8'))
roofs = {x['id']: x for x in inventory['roofObservations']}
heights = {x['id']: x for x in height['facilities']}
inherited = {x['id']: x for x in inventory['facilities']}
ground_cloud = None
volumes = []


def unit(v):
    v = np.array(v, dtype=float)
    return v / np.linalg.norm(v)


def arr(v, places=4):
    return np.round(v, places).tolist()


def plane_h(roof_id, plane_index, points):
    f = heights[roof_id]
    p = f['planes'][plane_index - 1]
    a, b, c = p['coefficientsLocalEN']
    return (np.array(points) - f['originEpsg3006']) @ np.array([a, b]) + c


def ground_h(roof_id, points):
    f = heights.get(roof_id)
    if f and f['nearbyGround'].get('coefficientsLocalEN'):
        a, b, c = f['nearbyGround']['coefficientsLocalEN']
        return (np.array(points) - f['originEpsg3006']) @ np.array([a, b]) + c
    global ground_cloud
    if ground_cloud is None:
        cloud = np.array(json.loads((ROOT / 'puttombuild/cache/facilities-reference-2026-09-10/laser/points.json').read_text())['points'])
        ground_cloud = cloud[cloud[:, 3] == 2, :3]
    result = []
    for xy in points:
        d = np.sum((ground_cloud[:, :2] - xy) ** 2, axis=1)
        result.append(float(np.median(ground_cloud[np.argpartition(d, 30)[:30], 2])))
    return np.array(result)


def rectangle(centre, u, length, width):
    v = np.array([-u[1], u[0]])
    return np.array([centre + u*x*length/2 + v*y*width/2 for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]])


def add(id, source, centre, u, roof_length, roof_width, eave, ridge, *,
        assembly=None, kind='timber-building', roof_type='gable', overhang=.3,
        plane_ids=(), notes='', uncertainty=.7, vertical=.5, inherited_ids=None,
        photos=(), facade=None, roof_high_side='v+', estimate=False, roof_colour='charcoal'):
    u = unit(u)
    v = np.array([-u[1], u[0]])
    centre = np.array(centre, dtype=float)
    ring = rectangle(centre, u, roof_length-2*overhang, roof_width-2*overhang)
    roofring = rectangle(centre, u, roof_length, roof_width)
    corners = ground_h(source, ring)
    ground = float(ground_h(source, [centre])[0])
    volume = dict(id=id, sourceRoofId=source, label=roofs.get(source, {}).get('label', id),
                  inheritedIds=list(inherited_ids if inherited_ids is not None else roofs.get(source, {}).get('inheritedIds', [])),
                  assembly=assembly or id, kind=kind, roofType=roof_type,
                  originEpsg3006=arr(centre), originBlenderXY=arr(centre-ORIGIN),
                  axisU=arr(u, 8), axisV=arr(v, 8), length=round(roof_length-2*overhang,3),
                  width=round(roof_width-2*overhang,3), roofLength=round(roof_length,3),
                  roofWidth=round(roof_width,3), roofOverhang=overhang,
                  wallRingEpsg3006=arr(ring), roofRingEpsg3006=arr(roofring),
                  groundH=round(ground,3), groundCornerH=arr(corners,3),
                  minGroundH=round(float(min(corners))-.15,3),
                  eaveH=round(float(eave),3), ridgeH=round(float(ridge),3),
                  floorH=round(max(ground+.15, min(float(max(corners)), eave-2.2)),3),
                  roofHighSide=roof_high_side if roof_type=='shed' else None,
                  roofColour=roof_colour,
                  provenance=dict(horizontal='photo/orthophoto interpretation' if estimate else 'original laser support reconciled with orthophoto and photographs',
                      vertical='photo proportion / conservative production estimate' if estimate else 'measured supporting planes, regularized architectural roof',
                      laserPlaneIds=[heights[source]['planes'][n-1]['id'] for n in plane_ids],
                      photoIds=list(photos), orthophotoObservation=source if source in roofs else None),
                  uncertainty=dict(horizontalMetres=uncertainty, verticalMetres=vertical,
                      openings='Photographic proportion or restrained production estimates; not measured openings.'),
                  notes=notes, facade=facade or {})
    assert ridge >= eave > ground + 1, (id, ground,eave,ridge)
    assert Polygon(ring).is_valid and Polygon(ring).area > 1
    volumes.append(volume)
    return volume


def ridge_pair(source, p1=1, p2=2, u=None):
    f = heights[source]
    a = np.array(f['planes'][p1-1]['coefficientsLocalEN'])
    b = np.array(f['planes'][p2-1]['coefficientsLocalEN'])
    normal = unit(a[:2]-b[:2])
    if u is None:
        u = np.array([-normal[1],normal[0]])
        if u[0] < 0:
            u = -u
    u = unit(u)
    v = np.array([-u[1],u[0]])
    origin = np.array(f['originEpsg3006'])
    cross = -(a[2]-b[2])/np.dot(a[:2]-b[:2],v)
    points = np.concatenate([f['planes'][i-1]['supportHullEpsg3006'] for i in [p1,p2]])
    q = (points-origin) @ np.array([u,v]).T
    centre = origin + u*(q[:,0].min()+q[:,0].max())/2 + v*cross
    length = np.ptp(q[:,0])+.5
    width = 2 * max(abs(q[:,1].min()-cross),abs(q[:,1].max()-cross))+.5
    ridge = float(np.mean([plane_h(source,i,[centre])[0] for i in [p1,p2]]))
    slope = float(np.mean([np.linalg.norm(c[:2]) for c in [a,b]]))
    return centre,u,length,width,ridge-slope*width/2,ridge


def from_observation(source, u=None, shift=(0.,0.)):
    points = np.array(roofs[source]['ringEpsg3006'])
    if u is None:
        box = np.array(MultiPoint(points).minimum_rotated_rectangle.exterior.coords)[:4]
        edges = np.roll(box,-1,axis=0)-box
        u = unit(edges[np.argmax(np.sum(edges**2,axis=1))])
        if u[0] < 0:
            u = -u
    v = np.array([-u[1],u[0]])
    origin = points.mean(axis=0)
    q = (points-origin) @ np.array([u,v]).T
    centre = origin + np.array(shift) + u*np.mean([q[:,0].min(),q[:,0].max()]) + v*np.mean([q[:,1].min(),q[:,1].max()])
    return centre, u, float(np.ptp(q[:,0])), float(np.ptp(q[:,1]))


# Main building: the aerial roof is displaced 4.04 m east of the laser ridge.
main_c = np.array([697367.397,7025188.7065])
main_u = unit([.37394393,-.92745131])
main_v = np.array([-main_u[1],main_u[0]])
add('clubhouse-main','roof-clubhouse-main',main_c,main_u,20.6,13.1,50.0,53.613,
    assembly='clubhouse',overhang=.35,plane_ids=(1,2),vertical=.35,
    photos=('clubhouse-2018','flickr-34163074006','flickr-34163073056','flickr-34163072946'),
    roof_colour='brown-grey',notes='Two measured opposing 29-degree slopes. Ridge from original laser coordinates. Regularized eaves; support hulls padded 0.25-0.35 m. Roof centre is 4.04 m west and 0.63 m north of orthophoto roof centroid; imagery remains unchanged. Exposed blue-grey foundation on western and southern downhill sides.',
    facade=dict(glazedGable='u+', entranceSide='v+', glassReturnLength=4.5,groundStoreys=2,
                mainEntranceU=-3.7,glazingBaseH=44.85,glazingTransomH=47.45,
                upperSmallWindows='v+; four unequal spaced openings outside southern glazing return',
                foundationColour='blue-grey',northUpperWindow=True))

lower_c = main_c + main_u*(-4.25) + main_v*(-7.65)
lower_edges = rectangle(lower_c,main_u,16.3,3.5)
lower_heights = plane_h('roof-clubhouse-west-lower',2,lower_edges)
add('clubhouse-west-lower','roof-clubhouse-west-lower',lower_c,main_u,16.3,3.5,
    float(min(lower_heights)),float(max(lower_heights)),assembly='clubhouse',kind='annex',roof_type='shed',
    overhang=.2,plane_ids=(2,),photos=('flickr-34163074006','flickr-34163072946'),roof_colour='brown-grey',
    notes='Valid shallow plane2 controls side extension. Duplicated main roof plane1 is excluded. High edge joins main west wall; north end projects about 2 m beyond main gable; south end stops before glazed return. Exact wall junction is regularized.',
    facade=dict(foundationColour='blue-grey',attachedSide='v+'))

wing = heights['roof-clubhouse-west-wing']['candidateGableRidges'][0]
wing_c = np.mean(wing['endpointsEpsg3006'],axis=0)
add('clubhouse-west-wing','roof-clubhouse-west-wing',wing_c,main_u,26.2,4.6,45.52,46.66,
    assembly='clubhouse',kind='annex',plane_ids=(1,2),photos=('flickr-34163074006','flickr-34163072946'),
    notes='One continuous narrow gabled wing replaces both inherited annex blocks. Roof length regularized from visible aerial envelope and measured ridge/support; tiny northerly support outliers excluded.',
    facade=dict(doorSide='v-',doorU=9.0,windowCount=3))
connector_c = main_c + main_u*(-4.5) + main_v*(-13.4)
add('clubhouse-connector','roof-clubhouse-connector',connector_c,main_v,9.7,4.5,45.3,46.5,
    assembly='clubhouse',kind='connector',overhang=.2,estimate=True,vertical=.8,uncertainty=1.0,
    photos=('flickr-34163074006','flickr-34163072946'),
    notes='Dark low transverse gable connects long west wing to exposed base of west extension. All catalogued query planes belong to adjacent roofs and are rejected as connector evidence. Dimensions/heights inferred from oblique photos; overlapping connection faces should be omitted.',
    facade=dict(attachedEnds=['u-','u+'],windowCount=0))

c,u,l,w = from_observation('roof-north-courtyard-building',main_v)
add('north-courtyard-building','roof-north-courtyard-building',c,u,l,w,46.3,48.15,
    photos=('flickr-34163072946','flickr-34163074006'),estimate=True,vertical=.8,
    notes='Detached red gabled building is photographically clear. Very sparse low-angle plane subsets do not reconstruct its dark roof; eaves/ridge are conservative photo proportion estimates. Functional identity remains unverified.',
    facade=dict(doorSide='v-',windowCount=3))

# L plan: two perpendicular gables share their measured ridge intersection.
rf = heights['roof-range-l-building']
r1,r2 = rf['candidateGableRidges']
a,b = [np.array(x) for x in r1['endpointsEpsg3006']]
u1 = unit(a-b)
c,d = [np.array(x) for x in r2['endpointsEpsg3006']]
u2 = unit(c-d)
ab = np.linalg.solve(np.array([u1,-u2]).T,d-b)
junction = b + u1*ab[0]
width1,width2=10.9,10.4
north_end = b-u1*.7
south_end = junction+u1*width2/2
west_end = junction-u2*width1/2
east_end = c+u2*.7
for id,centre,u,length,width,pair,old in [
    ('range-west-wing',(north_end+south_end)/2,u1,np.linalg.norm(south_end-north_end),width1,(1,3),['trace-vinkelhus']),
    ('range-east-wing',(west_end+east_end)/2,u2,np.linalg.norm(east_end-west_end),width2,(2,4),['trace-vinkelhus-arm'])]:
    add(id,'roof-range-l-building',centre,u,length,width,49.055-.329*width/2,49.055,
        assembly='range-l-building',kind='range-building',plane_ids=pair,inherited_ids=old,
        photos=('flickr-34163072946','flickr-34163073056','range-2025'),roof_colour='brown-grey',
        notes='Measured opposing slopes form one arm of continuous L building. Shared ridge intersection is retained; arms overlap at junction. Union walls and clip internal roof faces at their valleys; do not display an internal gable through the other roof.',
        facade=dict(windowCount=5,wallColour='red',crossGableJunctionEpsg3006=arr(junction)))

c,u,l,w=from_observation('roof-range-east-hut')
# Existing planar support is one shallow slope; keep a shallow pitched form.
add('range-east-hut','roof-range-east-hut',c+np.array([.6,-.1]),u,l,w,47.05,48.3,
    plane_ids=(1,),photos=('flickr-34163074006',),vertical=.7,
    notes='Detached elongated red range-side hut. Single sampled 9-degree slope supports low roof height; opposite roof half and ridge regularized from oblique appearance.',
    facade=dict(doorSide='u-',windowCount=2))
c,u,l,w=from_observation('roof-range-west-hut')
add('range-west-hut','roof-range-west-hut',c,u,l,w,46.15,48.05,
    plane_ids=(1,),roof_type='shed',vertical=.6,
    photos=('flickr-34163072946',),
    notes='Small detached range structure has one visibly broad sloping roof and a small side projection. Sampled single slope controls height; simplified rectangular wall base retains full shelter envelope. Function unverified.',
    facade=dict(windowCount=0,doorSide='v-'))

c,u,l,w,e,r=ridge_pair('roof-range-south-building',1,2)
w=7.6
e=r-.557*w/2
add('harbre','roof-range-south-building',c,u,l,w,e,r,kind='log-house',plane_ids=(1,2),overhang=.45,
    photos=('harbre-2018','flickr-34163072946','flickr-34163073056'),
    notes='Härbre association is supported by official facade and oblique campus views. Main gable uses measured 29-degree opposing roof planes. Roof width limited to 7.6 m around dominant v +/-3.6 m support edges; isolated v-4.42 m corner excluded. Low plane3 belongs to a separate southeast feature and is not the main roof or photographed northwest shelter. Horizontal log walls/corner joints, clock, double upper window and little door canopy are photographic details.',
    facade=dict(entranceSide='u-',gableDoorEnd='u-',clock=True,upperDoubleWindow=True,sideShelter='v+',sideShelterWidth=1.7,doorCanopy=True,windowCount=1))

for source,id in [('roof-maintenance-long','maintenance-long'),('roof-maintenance-hall','maintenance-hall')]:
    c,u,l,w,e,r=ridge_pair(source)
    add(id,source,c,u,l,w,e,r,assembly=id,kind='maintenance',plane_ids=(1,2),
        photos=('flickr-34163074006','flickr-34163072946'),
        notes='Roof ridge, bearing and both slopes from original laser coordinates. Eave envelope padded 0.25 m beyond sampled support. Red service walls and dark roof visible in obliques; door sizes and bay counts are production estimates.',
        facade=dict(vehicleDoors=3 if id=='maintenance-long' else 2,windowCount=2))
c,u,l,w=from_observation('roof-maintenance-hall-attachment',shift=(.8,.1))
add('maintenance-hall-attachment','roof-maintenance-hall-attachment',c,u,l,w,53.0,53.7,
    assembly='maintenance-hall',kind='shelter',roof_type='shed',estimate=True,vertical=1.,uncertainty=1.2,
    notes='Small southeast orthophoto projection; conservatively modelled as low side shelter. Query plane belongs to neighbouring main hall and is excluded. Shift follows hall reconciliation. Detailed use and enclosure unknown.',
    facade=dict(openSides=True,postCount=4))
c,u,l,w=from_observation('roof-maintenance-small',shift=(1.1,.1))
hs=plane_h('roof-maintenance-small',1,rectangle(c,u,l,w))
add('maintenance-small','roof-maintenance-small',c,u,l,w,min(hs),max(hs),kind='maintenance',roof_type='shed',
    plane_ids=(1,),roof_colour='light-grey',roof_high_side='v-',
    notes='Shallow light roof shifted to original single-plane support (~1.1 m east of image). One broad mono-pitch surface; facade opening sizes estimated.',facade=dict(vehicleDoors=1))

# Western neighbours are represented descriptively; no club ownership asserted.
c,u,l,w,e,r=ridge_pair('roof-west-cabin-a',1,2)
w=8.7
e=42.22
add('west-cabin-a','roof-west-cabin-a',c,u,l,w,e,r,kind='neighbouring-building',plane_ids=(1,2),
    uncertainty=1.5,vertical=.7,notes='Low opposing roof planes and visible cabin envelope reconciled; asymmetric shallow roof and attached apron regularized to sampled total span rather than mirroring the larger half. Laser centre lies west of apparent image roof. Ownership and function unknown.',facade=dict(windowCount=2))
c,u,l,w,e,r=ridge_pair('roof-west-cabin-b',2,3)
add('west-cabin-b','roof-west-cabin-b',c,u,l,w,e,r,assembly='west-cabin-b',kind='neighbouring-building',plane_ids=(2,3),
    uncertainty=1.,vertical=.7,notes='Main dark pitched half of compound cabin roof uses opposing ~18-degree supports. Additional light canopy/extension is separate. Ownership and function unknown.',facade=dict(windowCount=2))
# Plane1 is a shallow adjoining roof; isolate the northerly light segment seen in ortho.
bc=next(x for x in volumes if x['id']=='west-cabin-b')
bc_u=np.array(bc['axisU']);bc_v=np.array(bc['axisV'])
canopy_c=np.array(bc['originEpsg3006'])-bc_u*(bc['roofLength']/2+1.2)
add('west-cabin-b-extension','roof-west-cabin-b',canopy_c,bc_u,3.2,bc['roofWidth'],42.0,42.8,
    assembly='west-cabin-b',kind='annex',roof_type='shed',plane_ids=(1,),inherited_ids=[],roof_colour='light-grey',roof_high_side='v-',
    uncertainty=1.,vertical=.7,notes='Light adjoining northern roof segment inferred from orthophoto and shallow plane1. Simplified attached extension; exact wall relationship unresolved.',facade=dict(windowCount=1))

for id,pair,old in [('west-red-house-south',(1,2),['trace-house-red']),('west-red-house-north',(3,4),[])]:
    c,u,l,w,e,r=ridge_pair('roof-west-red-house',*pair)
    add(id,'roof-west-red-house',c,u,l,w,e,r,assembly='west-red-house',kind='neighbouring-building',
        plane_ids=pair,inherited_ids=old,roof_colour='red-tile',vertical=.7,uncertainty=1.,
        notes='Two roof pairs form stepped red-roofed neighbouring house. Original plane support controls each segment; asymmetric measured slopes are simplified to a single gable section. Club ownership/function unknown.',facade=dict(wallColour='pale-cream',windowCount=3))
c,u,l,w=from_observation('roof-west-red-house-canopy',shift=(-1.1,.8))
add('west-red-house-canopy','roof-west-red-house-canopy',c,u,l,w,44.7,46.3,
    assembly='west-red-house',kind='conservatory',roof_type='shed',plane_ids=(1,),roof_colour='light-grey',
    uncertainty=1.3,vertical=.8,notes='Light lakeside canopy/conservatory visible in orthophoto. Plane2 duplicates taller house roof and is excluded. Low slope and envelope remain approximate due mixed support.',facade=dict(glazed=True,openSides=False))
c,u,l,w=from_observation('roof-west-lakeshore-pavilion',shift=(-1.2,.5))
add('west-lakeshore-pavilion','roof-west-lakeshore-pavilion',c,u,l,w,40.45,41.5,
    kind='pavilion',roof_type='hip',plane_ids=(1,),roof_colour='light-grey',vertical=1.,uncertainty=1.,
    notes='Light faceted pavilion roof is visually established. Low planar subset gives approximate eave; steep higher subset is a tree/adjacent object and excluded. Hip apex 1.05 m above eave is a photo estimate. Ownership/function unknown.',facade=dict(openSides=True,postCount=4))
c,u,l,w=from_observation('roof-west-south-dark-shed')
g=ground_h('roof-west-south-dark-shed',[c])[0]
add('west-south-dark-shed','roof-west-south-dark-shed',c,u,l,w,g+2.15,g+2.8,
    kind='shed',estimate=True,uncertainty=1.5,vertical=1.,
    notes='Roof visible in aerial; no clean elevated laser plane. Low shed proportions are conservative production estimates; function and wall details unknown.',facade=dict(windowCount=0))
c,u,l,w=from_observation('roof-west-south-rust-shed')
add('west-south-rust-shed','roof-west-south-rust-shed',c,u,l,w,46.3,46.45,
    kind='shed',roof_type='shed',plane_ids=(1,),roof_colour='rust',uncertainty=1.5,vertical=.8,
    notes='Tiny rust roof candidate uses near-level sparse plane support. Geometry identity uncertain; no unsupported facility name assigned.',facade=dict(windowCount=0))

# These two old sheds are explicitly unmatched; preserve location and modest form.
for id in ['trace-shed-c','trace-shed-d']:
    f=inherited[id]
    ring=np.array(f['inheritedModel']['ringEpsg3006'])
    c=ring.mean(axis=0);u=unit(ring[1]-ring[0])
    l=np.linalg.norm(ring[1]-ring[0]);w=np.linalg.norm(ring[2]-ring[1])
    g=ground_h(id,[c])[0]
    add(id,id,c,u,l+.3,w+.3,g+2.2,g+2.9,kind='unverified-shed',overhang=.15,
        estimate=True,inherited_ids=[id],uncertainty=3.,vertical=1.5,
        notes='Unmatched inherited small shed retained at existing location. No observed roof is arbitrarily assigned to this trace. Dimensions and height remain low-confidence approximations.',facade=dict(windowCount=0))


def polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for part in geometry.geoms for p in polygon_parts(part)]


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'LineString':
        return [geometry]
    return [p for part in geometry.geoms for p in line_parts(part)]


def halfplane(bounds, coefficients):
    """Finite polygon for a*x+b*y+c >= 0; coordinates are small local EN."""
    x0,y0,x1,y1=bounds
    points=[np.array(p) for p in [(x0-1,y0-1),(x1+1,y0-1),(x1+1,y1+1),(x0-1,y1+1)]]
    result=[]
    def value(p):
        return float(np.dot(coefficients[:2],p)+coefficients[2])
    for a,b in zip(points,points[1:]+points[:1]):
        va,vb=value(a),value(b)
        if va>=0:
            result.append(a)
        if (va>=0)!=(vb>=0):
            result.append(a+(b-a)*va/(va-vb))
    return Polygon(result) if len(result)>=3 else Polygon()


def finish_range_topology():
    arms=[v for v in volumes if v['assembly']=='range-l-building']
    assert len(arms)==2
    slopes={}
    all_roofs={v['id']:Polygon(np.array(v['roofRingEpsg3006'])-ORIGIN) for v in arms}
    all_walls={v['id']:Polygon(np.array(v['wallRingEpsg3006'])-ORIGIN) for v in arms}
    visible_shapes=[]
    wall_length=0.
    north_arm=next(f for f in arms if f['id']=='range-west-wing')
    east_arm=next(f for f in arms if f['id']=='range-east-wing')
    junction=np.array(north_arm['facade']['crossGableJunctionEpsg3006'])-ORIGIN
    junction_x=np.array(east_arm['axisU'])
    junction_y=-np.array(north_arm['axisU'])
    x_coefficient=np.array([*junction_x,-np.dot(junction,junction_x)])
    y_coefficient=np.array([*junction_y,-np.dot(junction,junction_y)])
    for f in arms:
        centre=np.array(f['originEpsg3006'])-ORIGIN
        u,v=np.array(f['axisU']),np.array(f['axisV'])
        l,w=f['roofLength']/2,f['roofWidth']/2
        slope=(f['ridgeH']-f['eaveH'])/w
        slopes[f['id']]=[]
        for side in [-1,1]:
            poly=Polygon([centre+u*x+v*y for x,y in [(-l,0),(l,0),(l,side*w),(-l,side*w)]])
            # height = ridge - slope * abs(local V).
            coefficient=np.array([-side*slope*v[0],-side*slope*v[1],f['ridgeH']+side*slope*np.dot(centre,v)])
            slopes[f['id']].append((poly,coefficient))

    def surface_height(point):
        """Real L roof: outer hip, two terminating ridges, inner valley."""
        candidates={}
        for arm in arms:
            if all_roofs[arm['id']].buffer(.0005).covers(MultiPoint([point])):
                av=np.array(arm['axisV'])
                ac=np.array(arm['originEpsg3006'])-ORIGIN
                candidates[arm['id']]=float(arm['ridgeH']-(arm['ridgeH']-arm['eaveH'])*abs(np.dot(np.array(point)-ac,av))/(arm['roofWidth']/2))
        if len(candidates)==1:
            return next(iter(candidates.values()))
        assert len(candidates)==2,point
        x=np.dot(np.array(point)-junction,junction_x)
        y=np.dot(np.array(point)-junction,junction_y)
        a,b=candidates[north_arm['id']],candidates[east_arm['id']]
        if x>=0 and y>=0:
            return max(a,b)
        if x<0 and y<0:
            return min(a,b)
        return a if x<0 else b
    for f in arms:
        other=next(v for v in arms if v['id']!=f['id'])
        centre=np.array(f['originEpsg3006'])-ORIGIN
        u,v=np.array(f['axisU']),np.array(f['axisV'])
        slope=(f['ridgeH']-f['eaveH'])/(f['roofWidth']/2)
        def roof_h_local(point):
            return float(f['ridgeH']-slope*abs(np.dot(np.array(point)-centre,v)))
        def enh(point,h):
            return [round(float(point[0]+ORIGIN[0]),5),round(float(point[1]+ORIGIN[1]),5),round(float(h),5)]
        f['roofSurfacePolygonsENH']=[]
        f['exteriorWallPolygonsENH']=[]
        f['exteriorWallSegmentsEpsg3006']=[]
        f['exteriorRoofSegmentsENH']=[]
        for shape,coefficient in slopes[f['id']]:
            visible=shape
            for other_shape,other_coefficient in slopes[other['id']]:
                overlap=shape.intersection(other_shape)
                if overlap.area<1e-10:
                    continue
                # A union of full gable prisms incorrectly continues both ridges
                # into raised outer gables. The photographed outside corner is
                # hipped. Keep A in NW, B in SE, lower surface in SW outer hip,
                # and upper surface in NE inner valley.
                for sx,sy in [(-1,-1),(-1,1),(1,-1),(1,1)]:
                    quadrant=overlap.intersection(halfplane(overlap.bounds,sx*x_coefficient)).intersection(halfplane(overlap.bounds,sy*y_coefficient))
                    if quadrant.area<1e-10:
                        continue
                    if sx<0 and sy>0:
                        remove=quadrant if f['id']==east_arm['id'] else Polygon()
                    elif sx>0 and sy<0:
                        remove=quadrant if f['id']==north_arm['id'] else Polygon()
                    else:
                        difference=other_coefficient-coefficient
                        if sx<0 and sy<0:
                            difference=-difference
                        remove=quadrant.intersection(halfplane(quadrant.bounds,difference))
                    visible=visible.difference(remove)
            for part in polygon_parts(visible):
                if part.area<1e-8:
                    continue
                visible_shapes.append(part)
                for triangle in constrained_delaunay_triangles(part).geoms:
                    coordinates=np.array(triangle.exterior.coords)[:-1]
                    if Polygon(coordinates).exterior.is_ccw is False:
                        coordinates=coordinates[::-1]
                    f['roofSurfacePolygonsENH'].append([enh(p,np.dot(coefficient[:2],p)+coefficient[2]) for p in coordinates])

        def split_at_roof_changes(a,b):
            breaks=[0.,1.]
            lines=[x_coefficient,y_coefficient]
            coefficients=[coefficient for parts in slopes.values() for _,coefficient in parts]
            lines.extend(c-d for i,c in enumerate(coefficients) for d in coefficients[i+1:])
            for line in lines:
                qa,qb=np.dot(a,line[:2])+line[2],np.dot(b,line[:2])+line[2]
                if qa*qb<0 and abs(qa-qb)>1e-9:
                    breaks.append(float(qa/(qa-qb)))
            breaks=sorted(set(round(t,10) for t in breaks))
            return [(a+(b-a)*t,a+(b-a)*q) for t,q in zip(breaks,breaks[1:])]

        for field,other_shape,is_wall in [
            ('wallRingEpsg3006',all_walls[other['id']],True),
            ('roofRingEpsg3006',all_roofs[other['id']],False)]:
            ring=np.array(f[field])-ORIGIN
            for a,b in zip(ring,np.roll(ring,-1,axis=0)):
                original=b-a
                # Remove interior boundaries; a tiny inset retains coincident outer edges.
                exposed=LineString([a,b]).difference(other_shape.buffer(-1e-7))
                for part in line_parts(exposed):
                    if part.length<.005:
                        continue
                    p,q=np.array(part.coords[0]),np.array(part.coords[-1])
                    if np.dot(q-p,original)<0:
                        p,q=q,p
                    for p,q in split_at_roof_changes(p,q):
                        if np.linalg.norm(q-p)<.005:
                            continue
                        if is_wall:
                            bottom=f['floorH']+.12
                            wall_length+=np.linalg.norm(q-p)
                            # CCW plan edge -> right-facing outward wall normal.
                            f['exteriorWallPolygonsENH'].append([enh(p,bottom),enh(q,bottom),enh(q,surface_height(q)-.08),enh(p,surface_height(p)-.08)])
                            f['exteriorWallSegmentsEpsg3006'].append([enh(p,0)[:2],enh(q,0)[:2]])
                        else:
                            f['exteriorRoofSegmentsENH'].append([enh(p,surface_height(p)),enh(q,surface_height(q))])
        f['roofTopology']='L roof facets terminate both ridges at measured junction: inner northeast overlap is upper envelope/valley; outside southwest corner is lower envelope/hip; northwest uses north arm, southeast uses east arm. Full rectangular roofs/caps must not also render. Exterior wall tops follow the same finished roof, with internal edges removed.'
    expected_area=all_roofs[arms[0]['id']].union(all_roofs[arms[1]['id']]).area
    actual_area=sum(p.area for p in visible_shapes)
    expected_perimeter=all_walls[arms[0]['id']].union(all_walls[arms[1]['id']]).length
    assert abs(expected_area-actual_area)<.02,(expected_area,actual_area)
    assert abs(expected_perimeter-wall_length)<.002,(expected_perimeter,wall_length)
    for index,p in enumerate(visible_shapes):
        for q in visible_shapes[index+1:]:
            assert p.intersection(q).area<.0001
    support_checks=[]
    source=heights['roof-range-l-building']
    for plane in source['planes']:
        for xy,measured in zip(plane['supportHullEpsg3006'],plane['supportHullHeightsRH2000']):
            point=np.array(xy)-ORIGIN
            if any(poly.covers(MultiPoint([point])) for poly in all_roofs.values()):
                residual=surface_height(point)-measured
                support_checks.append(residual)
    support_rms=float(np.sqrt(np.mean(np.array(support_checks)**2)))
    assert support_rms<.10,support_rms
    return dict(roofUnionAreaSquareMetres=round(expected_area,4),
                clippedRoofAreaSquareMetres=round(actual_area,4),
                exteriorWallPerimeterMetres=round(wall_length,4),
                roofTriangleCount=sum(len(v['roofSurfacePolygonsENH']) for v in arms),
                exteriorWallPolygonCount=sum(len(v['exteriorWallPolygonsENH']) for v in arms),
                laserSupportHullComparisonCount=len(support_checks),laserSupportHullRmseMetres=round(support_rms,4),passed=True)


range_topology=finish_range_topology()

expected={f['id'] for f in inventory['facilities'] if f['scope']=='clubhouse-range-maintenance' and f.get('inheritedModel')}
covered=[i for v in volumes for i in v['inheritedIds']]
assert set(covered)==expected, (expected-set(covered),set(covered)-expected)
assert len(covered)==len(set(covered))
assert len({v['id'] for v in volumes})==len(volumes)

plan=dict(schemaVersion=1,groundId='puttom',preparedAt='2026-09-10',
    coordinateFrame=dict(horizontalCrs='EPSG:3006',verticalDatum='RH2000',
        blenderOrigin=[697365.,7025190.,44.],axes='X east, Y grid north, Z up',unit='metre'),
    geometryConvention='Each rectangular volume centre is originEpsg3006. U follows ridge/length; V is perpendicular left. Wall corners are (-U,-V),(+U,-V),(+U,+V),(-U,+V). Heights are absolute RH2000. roofType shed rises from eaveH at v- to ridgeH at v+ unless roofHighSide states otherwise.',
    sourceFiles={name:dict(path=f'puttombuild/facilities/{name}',sha256=hashlib.sha256((HERE/name).read_bytes()).hexdigest()) for name in ['facility-inventory.json','height-reference.json','web-reference.json']},
    sourceAttribution='Laserdata and orthophoto, Lantmäteriet, processed, CC BY 4.0. Photographs are modelling references only; no photo pixels reused as runtime textures.',
    interpretation='Finished production model plan from dated laser/orthophoto/photo evidence with labelled estimates. Not a survey or verified current inventory of owned facilities.',
    detailPolicy='Use red timber, white trim, restrained dark glazing and simple estimated openings where no close facade exists. Specific clubhouse glazing, log Härbre and observed roof assemblies receive photo-informed detail. No invented business/facility identities or signs.',
    coveredInheritedIds=sorted(covered),volumeCount=len(volumes),rangeTopologyValidation=range_topology,volumes=volumes)
(OUT/'model-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Review plots keep the source pixels fixed: geometry moves only when supported.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
plot_cache=ROOT/'puttombuild/cache/facilities-reference-2026-09-10'
fig,axs=plt.subplots(2,2,figsize=(18,16))
for ax,panel in zip(axs.ravel(),['clubhouse-courtyard','range-buildings','maintenance-yard','western-cabins']):
    path=plot_cache/'ortho'/f'{panel}.png'
    a,d,b,e,x,y=map(float,path.with_suffix('.pgw').read_text().split())
    im=Image.open(path)
    left=x-a/2;top=y-e/2
    right=left+a*im.width;bottom=top+e*im.height
    ax.imshow(im,extent=[left-ORIGIN[0],right-ORIGIN[0],bottom-ORIGIN[1],top-ORIGIN[1]])
    for v in volumes:
        p=np.array(v['roofRingEpsg3006'])-ORIGIN
        c=np.array(v['originBlenderXY'])
        if left-ORIGIN[0]<c[0]<right-ORIGIN[0] and bottom-ORIGIN[1]<c[1]<top-ORIGIN[1]:
            p=np.vstack([p,p[0]])
            ax.plot(p[:,0],p[:,1],color='#43ffcd',lw=1.3)
            ax.text(c[0],c[1],v['id'],color='white',fontsize=6.5,ha='center',va='center',
                    bbox=dict(facecolor='black',alpha=.6,pad=1,edgecolor='none'))
            if v['roofType']=='gable':
                u=np.array(v['axisU']);ridge=np.array([c-u*v['roofLength']/2,c+u*v['roofLength']/2])
                ax.plot(ridge[:,0],ridge[:,1],color='#ffdb5b',lw=1)
    ax.set_title(panel+' — model roof (cyan), ridge (yellow), unshifted ortho')
    ax.set_xlim(left-ORIGIN[0],right-ORIGIN[0]);ax.set_ylim(bottom-ORIGIN[1],top-ORIGIN[1]);ax.set_aspect('equal')
    ax.set_xlabel('metres east of Blender origin');ax.set_ylabel('metres north of Blender origin')
fig.tight_layout()
fig.savefig(plot_cache/'model-plan-review.png',dpi=150)
plt.close(fig)
print(json.dumps(dict(volumes=len(volumes),coveredInheritedIds=len(covered),output=str(OUT/'model-plan.json'))))
for v in volumes:
    print(v['id'],v['originBlenderXY'],v['roofLength'],v['roofWidth'],v['groundH'],v['eaveH'],v['ridgeH'])
