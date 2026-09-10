"""Independently audit a saved Puttom authoring scene without saving/mutating it.

blender --background <final.blend> --python audit-authoring.py
Optional: -- --scene <name> --output <report.json>
Use -- --precision-only to run the projected-coordinate regression independently.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys

import bpy

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite(values):
    return all(math.isfinite(float(v)) for v in values)


def plain(value):
    if hasattr(value,'to_list'):
        return value.to_list()
    if isinstance(value,str) and value[:1] in ('[','{'):
        return json.loads(value)
    return value


def triangle_area(a,b,c):
    # Python doubles preserve positive tiny facets instead of float32 rounding.
    u=[float(b[k])-float(a[k]) for k in range(3)]
    v=[float(c[k])-float(a[k]) for k in range(3)]
    cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
    return math.sqrt(sum(n*n for n in cross))/2


def projected_precision_regression():
    namespace=runpy.run_path(str(HERE/'build-models.py'),run_name='puttom_precision_definitions')
    builder_type=namespace['Builder']
    origin=namespace['ORIGIN']
    start=(697578.13,7025377.43,55.1)
    tolerance=.0001
    results=[]

    def fresh():
        value=builder_type.__new__(builder_type)
        value.buckets={}
        return value

    def inspect(builder,expected,name,basis=None):
        vertices=next(iter(builder.buckets.values()))['vertices']
        assert all(finite(p) for p in vertices),name
        local_start=[start[k]-origin[k] for k in range(3)]
        offsets=[[p[k]-local_start[k] for k in range(3)] for p in vertices]
        if basis:
            coordinates=[[sum(p[k]*axis[k] for k in range(3)) for axis in basis] for p in offsets]
        else:
            coordinates=offsets
        measured=[max(p[k] for p in coordinates)-min(p[k] for p in coordinates) for k in range(3)]
        error=max(abs(measured[k]-expected[k]) for k in range(3))
        assert error<=tolerance,(name,measured,expected,error)
        results.append(dict(name=name,expectedSpansMetres=expected,
                            measuredSpansMetres=[round(x,8) for x in measured],
                            maximumErrorMetres=round(error,9),passed=True))

    for axis in range(3):
        builder=fresh()
        end=list(start);end[axis]+=2.6
        builder.beam('precision','10 cm beam',start,end,.1,.1,'test')
        spans=[.1,.1,.1];spans[axis]=2.6
        inspect(builder,spans,'axis-'+str(axis)+' 10 cm beam')
    builder=fresh()
    direction=[.91440628,.40479768,0]
    scale=math.sqrt(sum(x*x for x in direction))
    direction=[x/scale for x in direction]
    side=[direction[1],-direction[0],0]
    builder.beam('precision','oblique 10 cm beam',start,
                 [start[k]+direction[k]*2.4 for k in range(3)],.1,.13,'test')
    inspect(builder,[2.4,.1,.13],'oblique 10 cm beam',[direction,side,[0,0,1]])
    builder=fresh()
    builder.cylinder('precision','clock face radius 29 cm',start,
                     [start[0],start[1]+.09,start[2]],.29,'test',32)
    inspect(builder,[.58,.09,.58],'clock cylinder radius 29 cm')
    return dict(absoluteStartENH=list(start),toleranceMetres=tolerance,
                builderSha256=digest(HERE/'build-models.py'),tests=results,passed=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--scene')
    parser.add_argument('--output',type=Path,default=HERE/'authoring-audit.json')
    parser.add_argument('--precision-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    assert bpy.app.background,'Audit must run in a separate background process'
    precision=projected_precision_regression()
    if args.precision_only:
        print(json.dumps(dict(precisionRegression=precision,passed=True)))
        return
    source=Path(bpy.data.filepath)
    assert source.is_file(),'Open the final normal .blend document first'
    source_before=digest(source)
    candidates=[scene for scene in bpy.data.scenes if scene.get('originEPSG3006RH2000')]
    scene=bpy.data.scenes.get(args.scene) if args.scene else candidates[0] if len(candidates)==1 else None
    assert scene is not None,'Select exactly one authored scene'
    assert scene.get('normal_blend_document'), 'Audit the packaged normal document'
    assert list(scene['originEPSG3006RH2000'])==[697365.,7025190.,44.]
    assert scene['model_plan_sha256']==digest(HERE/'model-plan.json'),'Saved asset uses an older model plan'
    assert scene['site_plan_sha256']==digest(HERE/'site-plan.json'),'Saved asset uses an older site plan'
    plan=json.loads((HERE/'model-plan.json').read_text(encoding='utf-8'))
    parents={obj.name:obj for obj in scene.objects if obj.type=='EMPTY' and obj.get('facilityId')}
    assert parents
    assert len({parent['facilityId'] for parent in parents.values()})==len(parents),'Duplicate stable facility IDs'
    inherited=[]
    for name,parent in parents.items():
        # Blender adds display-name suffixes while preserving the previous live
        # variant. Export identity lives in the explicit facilityId property.
        assert isinstance(parent['facilityId'],str) and parent['facilityId']
        anchor=plain(parent['groundAnchorEpsg3006'])
        height=float(parent['groundAnchorRh2000M'])
        ring=plain(parent['footprintEpsg3006'])
        assert len(anchor)==2 and finite([*anchor,height]),name
        assert 696000<anchor[0]<699000 and 7024000<anchor[1]<7027000 and 20<height<80,name
        assert len(ring)>=3 and all(len(p)==2 and finite(p) for p in ring),name
        assert parent.get('placement')=='absolute-rh2000',name
        inherited.extend(plain(parent['sourceBuildingIds']))
    assert sorted(inherited)==sorted(plan['coveredInheritedIds'])
    assert len(inherited)==len(set(inherited))

    stats=[]
    truly_degenerate=[]
    positive_tiny=[]
    modes_count={0:0,1:0,2:0}
    grounding_meshes=0
    for obj in scene.objects:
        if obj.type!='MESH' or not obj.get('production_geometry'):
            continue
        assert obj.parent and obj.parent.name in parents,obj.name
        assert obj['facilityId']==obj.parent['facilityId'],obj.name
        assert obj.data.materials and all(mat is not None for mat in obj.data.materials),obj.name
        mesh=obj.data
        vertices=[tuple(obj.matrix_world @ vertex.co) for vertex in mesh.vertices]
        assert vertices and all(finite(p) for p in vertices),obj.name
        assert max(abs(v) for p in vertices for v in p)<3000,'Production vertices must use local metres'
        mesh.calc_loop_triangles()
        assert len(mesh.loop_triangles)>0,obj.name
        areas=[]
        degenerate=[]
        tiny=[]
        for triangle in mesh.loop_triangles:
            a,b,c=[vertices[index] for index in triangle.vertices]
            area=triangle_area(a,b,c)
            areas.append(area)
            # Only exact collapses/collinear triangles are rejected. Small positive
            # facets can be valid roof clipping or narrow trim, and are reported.
            if area==0:
                degenerate.append(triangle.index)
            elif area<1e-6:
                tiny.append(triangle.index)
        if degenerate:
            truly_degenerate.append(dict(object=obj.name,triangleCount=len(degenerate),sampleIndices=degenerate[:12]))
        if tiny:
            positive_tiny.append(dict(object=obj.name,triangleCount=len(tiny),minimumPositiveArea=min(a for a in areas if a>0)))
        ground={name:mesh.attributes.get(name) for name in ('ground_anchor_local','ground_mode','ground_clearance')}
        if any(ground.values()):
            grounding_meshes+=1
            assert all(ground.values()),(obj.name,'incomplete ground attributes')
            assert obj.parent['kind']=='site',(obj.name,'building ground attributes')
            for name,attribute in ground.items():
                assert attribute.domain=='POINT' and len(attribute.data)==len(vertices),(obj.name,name)
            assert ground['ground_anchor_local'].data_type=='FLOAT_VECTOR'
            assert ground['ground_mode'].data_type=='INT'
            assert ground['ground_clearance'].data_type=='FLOAT'
            for index in range(len(vertices)):
                anchor=tuple(ground['ground_anchor_local'].data[index].vector)
                mode=int(ground['ground_mode'].data[index].value)
                clearance=float(ground['ground_clearance'].data[index].value)
                assert mode in (0,1,2) and finite([*anchor,clearance]),(obj.name,index)
                assert max(abs(v) for v in anchor)<3000 and abs(clearance)<5,(obj.name,index)
                if mode==2:
                    assert max(abs(v) for v in anchor)<1e-6,(obj.name,'drape anchor should be zero')
                modes_count[mode]+=1
        stats.append(dict(object=obj.name,vertices=len(vertices),triangles=len(areas),
                          trulyDegenerateTriangles=len(degenerate),positiveTinyTriangles=len(tiny),
                          minimumTriangleAreaSquareMetres=min(areas),groundAttributes=bool(any(ground.values()))))
    assert stats
    assert grounding_meshes>0 and modes_count[1]>0 and modes_count[2]>0,'Missing authored site grounding'
    assert digest(source)==source_before,'Source file changed during audit'
    report=dict(passed=not truly_degenerate,scene=scene.name,sourceFile=source.relative_to(ROOT).as_posix(),
                sourceSha256=source_before,sourceFileUnchanged=True,blenderVersion=bpy.app.version_string,
                coveredInheritedIds=len(inherited),facilityParents=len(parents),productionMeshes=len(stats),
                triangles=sum(x['triangles'] for x in stats),trulyDegenerateTriangles=truly_degenerate,
                positiveTinyTriangles=positive_tiny,positiveTinyTriangleThresholdSquareMetres=1e-6,
                groundAttributeMeshes=grounding_meshes,groundModeVertexCounts=modes_count,
                precisionRegression=precision,meshes=stats)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key not in ('meshes','precisionRegression')}))
    assert not truly_degenerate, 'Truly degenerate production triangles; inspect the written audit report'


if __name__=='__main__':
    main()
