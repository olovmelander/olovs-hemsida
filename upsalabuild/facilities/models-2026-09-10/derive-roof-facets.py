"""Derive the visible upper envelope of reviewed roof domains, without Blender."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,math
import numpy as np
import shapely
from shapely.geometry import Polygon,MultiPolygon,GeometryCollection,box
from shapely.ops import unary_union,triangulate

HERE=Path(__file__).resolve().parent
source_path=HERE/'roof-measurements.json'
source=json.loads(source_path.read_text(encoding='utf-8'))
components=source['clubhouseComponents']+[c for b in source['auxiliaryBuildings'] for c in b.get('roofComponents',[])]
plane_evidence={p['id']:p for c in components for p in c['roofPlanes']}
domains=[Polygon(c['domainRoofRingLocalXZ']) for c in components]
assert all(p.is_valid for p in domains)
union=unary_union(domains);bounds=union.bounds
work_bounds=[bounds[0]-20,bounds[1]-20,bounds[2]+20,bounds[3]+20]

def coeff(p):
    ox,oz=p['originLocalXZ']
    return np.array([p['a'],-p['b'],p['c']-p['a']*ox+p['b']*oz])

def positive_halfplane(c):
    # Sutherland-Hodgman clip of a bounding rectangle against ax+bz+c>=0.
    x0,z0,x1,z1=work_bounds
    points=[np.array(v,dtype=float) for v in [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]]
    out=[]
    for a,b in zip(points,points[1:]+points[:1]):
        ha=float(c[:2]@a+c[2]);hb=float(c[:2]@b+c[2]);ia=ha>=0;ib=hb>=0
        if ia:out.append(a.tolist())
        if ia!=ib:
            t=ha/(ha-hb);out.append((a+t*(b-a)).tolist())
    return Polygon(out) if len(out)>=3 else Polygon()

def polygons(g):
    if g.is_empty:return []
    if isinstance(g,Polygon):return [g]
    if isinstance(g,(MultiPolygon,GeometryCollection)):return [p for item in g.geoms for p in polygons(item)]
    return []

raw=[]
for component,domain in zip(components,domains):
    if len(component['roofPlanes'])==1:
        plane=component['roofPlanes'][0]
        raw.append(dict(component=component['id'],plane=plane['id'],coefficients=coeff(plane),geometry=domain))
        continue
    p0,p1=component['roofPlanes'];a,b=coeff(p0),coeff(p1)
    # p0 is visible on its side when p1-p0 >=0, because a gable is min(p0,p1).
    for chosen,other,plane in [(a,b,p0),(b,a,p1)]:
        facet=domain.intersection(positive_halfplane(other-chosen))
        assert facet.is_valid
        raw.append(dict(component=component['id'],plane=plane['id'],coefficients=chosen,geometry=facet))

output=[]
for i,facet in enumerate(raw):
    visible=facet['geometry']
    for j,other in enumerate(raw):
        if i==j or other['component']==facet['component']:continue
        overlap=visible.intersection(other['geometry'])
        if overlap.area<1e-10:continue
        delta=other['coefficients']-facet['coefficients']
        if np.max(np.abs(delta))<1e-9:
            if j<i:visible=visible.difference(overlap)
        else:
            higher=overlap.intersection(positive_halfplane(delta))
            visible=visible.difference(higher)
    for part_index,p in enumerate(polygons(visible)):
        if p.area<1e-7:continue
        assert p.is_valid
        exterior=[list(q) for q in list(p.exterior.coords)[:-1]]
        holes=[[list(q) for q in list(r.coords)[:-1]] for r in p.interiors]
        if hasattr(shapely,'constrained_delaunay_triangles'):
            triangles=list(shapely.constrained_delaunay_triangles(p).geoms)
        else:triangles=[t for t in triangulate(p) if p.covers(t)]
        # Boolean boundaries may contain machine-precision collinear vertices.
        # Exclude zero-area faces rather than exporting unstable normals.
        triangles=[t for t in triangles if t.area>1e-9]
        assert abs(sum(t.area for t in triangles)-p.area)<1e-6
        vertices=[];indices=[];lookup={}
        for triangle in triangles:
            face=[]
            for x,z in list(triangle.exterior.coords)[:-1]:
                key=(x,z)
                if key not in lookup:
                    lookup[key]=len(vertices)
                    h=float(facet['coefficients']@np.array([x,z,1]))
                    vertices.append([x,h,z])
                face.append(lookup[key])
            tri_points=np.array([vertices[j] for j in face])
            if np.cross(tri_points[1]-tri_points[0],tri_points[2]-tri_points[0])[1]<0:
                face[1],face[2]=face[2],face[1]
            indices.append(face)
        output.append(dict(id=f'{facet["component"]}-{facet["plane"]}-{part_index+1}',componentId=facet['component'],planeId=facet['plane'],
            heightStatus=plane_evidence[facet['plane']].get('heightStatus','interpreted source-plane estimate'),sourceSupportCount=plane_evidence[facet['plane']].get('supportCount'),
            ringLocalXZ=exterior,exteriorLocalXZ=exterior,holesLocalXZ=holes,areaSquareMetres=p.area,planeCoefficientXYZ=facet['coefficients'].tolist(),
            planeEquation='heightRH2000=A*xCourse+B*zCourse+C',verticesCourseXYZ=vertices,triangles=indices,triangleWinding='Normals point toward positive course Y height / positive Blender Z.'))

visible_union=unary_union([Polygon(f['ringLocalXZ'],f['holesLocalXZ']) for f in output])
gap_area=union.difference(visible_union).area
overlap_area=sum(f['areaSquareMetres'] for f in output)-visible_union.area
assert gap_area<1e-6 and abs(overlap_area)<1e-6
check_max=0;count=0;worst=None
for face in output:
    c=np.array(face['planeCoefficientXYZ']);poly=Polygon(face['ringLocalXZ'],face['holesLocalXZ'])
    for t in face['triangles']:
        xyz=np.array([face['verticesCourseXYZ'][j] for j in t]);q=xyz[:,[0,2]].mean(axis=0);p=shapely.Point(q)
        expected=[]
        for component,domain in zip(components,domains):
            if domain.buffer(1e-8).covers(p):expected.append(min(float(coeff(pl)@np.array([*q,1])) for pl in component['roofPlanes']))
        assert expected
        error=abs(float(c@np.array([*q,1]))-max(expected))
        if error>check_max:check_max=error;worst=dict(facet=face['id'],q=q.tolist(),expected=expected,actual=float(c@np.array([*q,1])),triangleArea=Polygon(xyz[:,[0,2]]).area)
        count+=1
if check_max>=1e-7:print(json.dumps(worst))
assert check_max<1e-7
report=dict(schemaVersion=1,id='upsala-facilities-visible-roof-facets-2026-09-10',generatedAt=datetime.now(timezone.utc).isoformat(),
 source=dict(path='upsalabuild/facilities/models-2026-09-10/roof-measurements.json',sha256=hashlib.sha256(source_path.read_bytes()).hexdigest()),
 frame=source['frame'],anchorLocalXZ=source['anchorLocalXZ'],anchorHeightRH2000=source['anchorHeightRH2000'],
 coordinateConvention='verticesCourseXYZ are [xCourse,heightRH2000,zCourse]. Footprint rings use [xCourse,zCourse]. Blender=[x-anchorX,anchorZ-z,heightRH2000-34.968].',
 algorithm='Split each gable domain into min(two planes), then subtract overlaps wherever another component is higher. Preserve polygon holes; constrained triangulation checked by area.',
 facets=output,validation=dict(state='passed',components=len(components),sourcePlanes=len(raw),visibleFacetParts=len(output),triangles=count,
     roofDomainUnionAreaSquareMetres=union.area,uncoveredAreaSquareMetres=gap_area,overlapAreaSquareMetres=overlap_area,
     maximumTriangleCentroidEnvelopeResidualMetres=check_max),
 limitations=['Facet precision is mathematical consistency with the interpreted roof domains and planes, not surveyed roof accuracy.','No walls, floor heights, dormers, chimney or eave trims are generated in this envelope.'])
(HERE/'roof-facets.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report['validation'],indent=2))
