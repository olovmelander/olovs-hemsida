"""Bake the reviewed Blender GLB into the exact GPK1 horizontal frame.

Run with geobuild/cache/ortho-venv/Scripts/python.exe.  Geometry is merged only
within a source feature and PBR material. Every source triangle is retained;
images, textures, scene cameras and source reference boards are forbidden.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import zlib

import numpy as np
from pyproj import Transformer


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "geobuild/cache/facilities-model-2026-09-10/veckefjarden-facilities.glb"
OUTPUT = ROOT / "apps/golf/public/models/veckefjarden/facilities-v1.glb"
MANIFEST = OUTPUT.with_suffix(".json")
FOOTPRINTS = ROOT / "apps/golf/src/engine/scenery/veckefjarden-facility-footprints.json"
AUDIT = ROOT / "geobuild/facilities/runtime-model-build-audit.json"
SLUGS = ["veckefjarden", "veckefjarden-korthalsbanan"]
EXPECTED_FEATURES = {f"R{i:02d}" for i in range(1,13)} | {f"S{i:02d}" for i in range(1,9)}
BUILDING_INDICES = {"R01":[3], "R03":[6,0], "R04":[1,5], "R05":[4],
                    "R09":[28], "R10":[26], "R11":[25], "R12":[24]}
PARKING_INDICES = {"S04":[3], "S05":[0], "S06":[1]}
GROUND_CONTACT_NAMES = {
    "S01":"VECK MODEL | Clubhouse / S01 ground dining paving",
    "S04":"VECK MODEL | S04_reviewed_parking_surface",
    "S05":"VECK MODEL | S05_reviewed_parking_surface",
    "S06":"VECK MODEL | S06_reviewed_parking_surface",
    "S07":"VECK MODEL | S07_entrance_island",
    "S08":"VECK MODEL | S08_curved_apron",
}
ORIGIN_E, ORIGIN_N, ORIGIN_H = 684390., 7023040., 30.673
ORIGIN_LON, ORIGIN_LAT = 18.6735, 63.2845
METRES_LON, METRES_LAT = 50045.09, 111320.
INVERSE = Transformer.from_crs(3006,4326,always_xy=True)
FORWARD = Transformer.from_crs(4326,3006,always_xy=True)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_record(path):
    data=path.read_bytes()
    return {"path":path.relative_to(ROOT).as_posix(),"sha256":sha(data),"bytes":len(data)}


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,ensure_ascii=False,allow_nan=False)+"\n",encoding="utf-8",newline="\n")


def read_glb(path):
    data=path.read_bytes()
    assert struct.unpack_from("<III",data,0)==(0x46546C67,2,len(data)),"Invalid GLB header"
    chunks={}
    offset=12
    while offset<len(data):
        size,kind=struct.unpack_from("<II",data,offset)
        assert kind not in chunks,"Duplicate GLB chunk"
        chunks[kind]=data[offset+8:offset+8+size]
        offset+=8+size
    assert offset==len(data)
    return json.loads(chunks[0x4E4F534A]),chunks[0x004E4942]


DTYPES={5120:"i1",5121:"u1",5122:"<i2",5123:"<u2",5125:"<u4",5126:"<f4"}
WIDTHS={"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}


def accessor(g,blob,index):
    a=g["accessors"][index]
    assert "sparse" not in a and not a.get("normalized",False),"Unexpected accessor encoding"
    view=g["bufferViews"][a["bufferView"]]
    assert view.get("buffer",0)==0
    dtype=np.dtype(DTYPES[a["componentType"]]); width=WIDTHS[a["type"]]
    start=view.get("byteOffset",0)+a.get("byteOffset",0)
    stride=view.get("byteStride",dtype.itemsize*width)
    data=np.ndarray((a["count"],width),dtype=dtype,buffer=blob,offset=start,strides=(stride,dtype.itemsize)).copy()
    return data[:,0] if width==1 else data


def node_matrix(node):
    if "matrix" in node:
        return np.asarray(node["matrix"],dtype=np.float64).reshape(4,4).T
    x,y,z,w=node.get("rotation",[0,0,0,1])
    rotation=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                       [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                       [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    m=np.eye(4)
    m[:3,:3]=rotation@np.diag(node.get("scale",[1,1,1]))
    m[:3,3]=node.get("translation",[0,0,0])
    return m


def horizontal(e,n):
    lon,lat=INVERSE.transform(e,n)
    return (np.asarray(lon)-ORIGIN_LON)*METRES_LON,(ORIGIN_LAT-np.asarray(lat))*METRES_LAT


def convert_positions(p):
    x,z=horizontal(ORIGIN_E+p[:,0],ORIGIN_N-p[:,2])
    return np.column_stack([x,ORIGIN_H+p[:,1],z])


def jacobian(p,step=.25):
    """Exact projection evaluated locally; no site-wide rotation approximation."""
    e,n=ORIGIN_E+p[:,0],ORIGIN_N-p[:,2]
    xp,zp=horizontal(e+step,n); xm,zm=horizontal(e-step,n)
    a,c=(xp-xm)/(2*step),(zp-zm)/(2*step)
    xp,zp=horizontal(e,n-step); xm,zm=horizontal(e,n+step)
    b,d=(xp-xm)/(2*step),(zp-zm)/(2*step)
    return a,b,c,d


def convert_normals(p,n,step=.25):
    a,b,c,d=jacobian(p,step)
    determinant=a*d-b*c
    assert np.all(determinant>0),"Projection reverses triangle orientation"
    out=np.column_stack([(n[:,0]*d-n[:,2]*c)/determinant,
                         n[:,1],(-n[:,0]*b+n[:,2]*a)/determinant])
    length=np.linalg.norm(out,axis=1)
    assert np.all(length>.99),"Degenerate source normals"
    return out/length[:,None]


def read_pack(slug):
    path=ROOT/f"apps/golf/public/courses/{slug}/pack.bin"
    b=path.read_bytes()
    assert b[:4]==b"GPK1"
    size=struct.unpack_from("<I",b,4)[0]
    h=json.loads(b[8:8+size])
    assert h["fmt"]==1 and h["slug"]==slug
    assert h["GEO"]["origin"]=={"lat":ORIGIN_LAT,"lon":ORIGIN_LON}
    assert h["GEO"]["mPerLon"]==METRES_LON
    offset=8+size+h["HF0"]["bytes"]+h["HF1"]["bytes"]
    assert offset+h["VEC"]["bytes"]==len(b)
    return json.loads(zlib.decompress(b[offset:],-15)),file_record(path)


class BinaryWriter:
    def __init__(self,g):
        self.g=g; self.data=bytearray()

    def add(self,array,kind,target,bounds=False):
        a=np.ascontiguousarray(array)
        while len(self.data)%4:self.data.append(0)
        view={"buffer":0,"byteOffset":len(self.data),"byteLength":a.nbytes,"target":target}
        vi=len(self.g["bufferViews"]);self.g["bufferViews"].append(view)
        self.data.extend(a.tobytes())
        component={"float32":5126,"uint16":5123,"uint32":5125}[a.dtype.name]
        item={"bufferView":vi,"componentType":component,"count":len(a),"type":kind}
        if bounds:item.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        ai=len(self.g["accessors"]);self.g["accessors"].append(item)
        return ai

    def finish(self):
        size=len(self.data)
        self.g["buffers"]=[{"byteLength":size}]
        body=json.dumps(self.g,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
        body+=b" "*((-len(body))%4)
        self.data.extend(b"\0"*((-len(self.data))%4))
        total=12+8+len(body)+8+len(self.data)
        return struct.pack("<III",0x46546C67,2,total)+struct.pack("<II",len(body),0x4E4F534A)+body+struct.pack("<II",len(self.data),0x004E4942)+self.data


def main():
    inventory_path=ROOT/"geobuild/facilities/inventory.json"
    ground_path=ROOT/"geobuild/facilities/model-ground.json"
    source_inventory=read_json(inventory_path)
    inventory={f["id"]:f for f in source_inventory["features"]}
    ground=read_json(ground_path);grid_path=ROOT/ground["gridPath"]
    assert ground["originEPSG3006"]==[ORIGIN_E,ORIGIN_N]
    assert ground["originHeightRH2000"]==ORIGIN_H
    assert sha(grid_path.read_bytes())==ground["gridSha256"]
    grid=read_json(grid_path)
    heights=np.array(grid["heights"]).reshape(grid["height"],grid["width"])

    def sample_ground(x,y):
        gx,gy=(x-grid["x0"])/grid["step"],(y-grid["y0"])/grid["step"]
        col,row=math.floor(gx),math.floor(gy)
        assert 0<=col<grid["width"]-1 and 0<=row<grid["height"]-1
        u,v=gx-col,gy-row
        return ORIGIN_H+float(heights[row,col]*(1-u)*(1-v)+heights[row,col+1]*u*(1-v)+heights[row+1,col]*(1-u)*v+heights[row+1,col+1]*u*v)

    packs=[read_pack(slug) for slug in SLUGS]
    assert packs[0][0]["infra"]["buildings"]==packs[1][0]["infra"]["buildings"],"Course building orders differ"
    assert packs[0][0]["infra"]["parking"]==packs[1][0]["infra"]["parking"],"Course parking orders differ"
    infra=packs[0][0]["infra"]
    g,blob=read_glb(SOURCE)
    assert not any(g.get(k) for k in ["images","textures","animations","skins","extensionsUsed"]),"Unsupported external/export content"
    scene=g["scenes"][g.get("scene",0)]
    assert scene["extras"]["origin_easting_northing"]==[ORIGIN_E,ORIGIN_N]
    assert scene["extras"]["origin_height_rh2000"]==ORIGIN_H
    grouped={}; source_counts={}; visited=set(); triangle_count=0; vertex_count=0
    ground_contact_sources=[]

    def visit(index,parent):
        nonlocal triangle_count,vertex_count
        assert index not in visited,"Instanced or cyclic source nodes require explicit review"
        visited.add(index)
        node=g["nodes"][index]; matrix=parent@node_matrix(node)
        if "mesh" in node:
            fid=node.get("extras",{}).get("source_feature")
            assert fid in EXPECTED_FEATURES,(index,"Missing source feature")
            source_counts[fid]=source_counts.get(fid,0)+1
            source_name=re.sub(r"\.\d{3,}$","",node.get("name",""))
            ground_contact=source_name==GROUND_CONTACT_NAMES.get(fid)
            linear=matrix[:3,:3]
            for primitive in g["meshes"][node["mesh"]]["primitives"]:
                assert primitive.get("mode",4)==4 and set(primitive["attributes"])=={"POSITION","NORMAL"}
                p=accessor(g,blob,primitive["attributes"]["POSITION"]).astype(np.float64)
                n=accessor(g,blob,primitive["attributes"]["NORMAL"]).astype(np.float64)
                p=p@linear.T+matrix[:3,3]
                n=n@np.linalg.inv(linear);n/=np.linalg.norm(n,axis=1)[:,None]
                indices=accessor(g,blob,primitive["indices"]).astype(np.uint32)
                assert len(indices)%3==0 and int(indices.max())<len(p)
                if np.linalg.det(linear)<0:
                    indices=indices.reshape(-1,3)[:,[0,2,1]].reshape(-1)
                # Only six inspected ground-paving objects may be adjusted by
                # the runtime's terrain-clearance hook. Raised slabs, stairs,
                # supports, furnishings, island edging, mats and poles stay in
                # separate architecture batches even when they share material.
                if ground_contact:
                    assert np.all(np.abs(n[:,1])>.8),"Ground-contact source contains non-ground faces"
                    assert np.all(n[:,1]>0) or np.all(n[:,1]<0),"Ground-contact source has inconsistent winding"
                    ground_contact_sources.append({"id":fid,"sourceNodeName":node["name"],
                        "vertices":len(p),"triangles":len(indices)//3,
                        "minimumAbsoluteNormalY":float(np.min(np.abs(n[:,1]))),
                        "sourceNormalDirection":"upward" if n[0,1]>0 else "downward; source double-sided material retained"})
                bucket=grouped.setdefault((fid,primitive["material"],ground_contact),{"p":[],"n":[],"i":[],"vertices":0})
                bucket["p"].append(p);bucket["n"].append(n)
                bucket["i"].append(indices+bucket["vertices"]);bucket["vertices"]+=len(p)
                triangle_count+=len(indices)//3;vertex_count+=len(p)
        for child in node.get("children",[]):visit(child,matrix)

    for index in scene["nodes"]:visit(index,np.eye(4))
    assert set(source_counts)==EXPECTED_FEATURES
    assert {s["id"] for s in ground_contact_sources}==set(GROUND_CONTACT_NAMES)
    assert len(ground_contact_sources)==len(GROUND_CONTACT_NAMES)
    assert triangle_count==44422,("Unexpected source triangle count",triangle_count)
    assert len(grouped)<=160,("Too many material batches",len(grouped))
    output={"asset":{"version":"2.0","generator":"Veckefjarden reviewed facility runtime baker v1"},
            "scene":0,"scenes":[{"name":"Veckefjarden authored facilities","nodes":[],"extras":{
                "coordinateFrame":"legacy-local-rh2000","groundId":"veckefjarden",
                "originLongitude":ORIGIN_LON,"originLatitude":ORIGIN_LAT,
                "metresPerLongitude":METRES_LON,"metresPerLatitude":METRES_LAT,
                "axisContract":"X legacy east, Y absolute RH2000, Z legacy south",
                "sourceSha256":sha(SOURCE.read_bytes())}}],
            "nodes":[],"meshes":[],"materials":copy.deepcopy(g["materials"]),"accessors":[],"bufferViews":[]}
    writer=BinaryWriter(output);facilities=[];output_triangles=0
    max_position_error=0.;max_roundtrip_error=0.;max_normal_error=0.;max_normal_step_error=0.
    all_min=np.full(3,np.inf);all_max=np.full(3,-np.inf)
    for fid in sorted(EXPECTED_FEATURES):
        feature=inventory[fid];name="VECK_FACILITY_"+fid
        group_node=len(output["nodes"])
        output["scenes"][0]["nodes"].append(group_node)
        output["nodes"].append({"name":name,"children":[],"extras":{"facilityId":fid,"source_feature":fid,"coordinateFrame":"legacy-local-rh2000","heightStatus":"photo estimates; not surveyed"}})
        bounds_min=np.full(3,np.inf);bounds_max=np.full(3,-np.inf);feature_triangles=0
        for (bucket_fid,material,ground_contact),bucket in sorted(grouped.items()):
            if bucket_fid!=fid:continue
            source_positions=np.concatenate(bucket["p"]);source_normals=np.concatenate(bucket["n"])
            exact_positions=convert_positions(source_positions)
            exact_normals=convert_normals(source_positions,source_normals)
            alternate_normals=convert_normals(source_positions,source_normals,.5)
            p=exact_positions.astype("<f4");n=exact_normals.astype("<f4")
            indices=np.concatenate(bucket["i"])
            indices=indices.astype("<u2" if len(p)<=65535 else "<u4")
            max_position_error=max(max_position_error,float(np.max(np.linalg.norm(p-exact_positions,axis=1))))
            max_normal_error=max(max_normal_error,float(np.max(np.abs(np.linalg.norm(n,axis=1)-1))))
            max_normal_step_error=max(max_normal_step_error,float(np.max(np.linalg.norm(exact_normals-alternate_normals,axis=1))))
            e,north=FORWARD.transform(ORIGIN_LON+p[:,0].astype(float)/METRES_LON,ORIGIN_LAT-p[:,2].astype(float)/METRES_LAT)
            max_roundtrip_error=max(max_roundtrip_error,float(np.max(np.hypot(e-ORIGIN_E-source_positions[:,0],north-ORIGIN_N+source_positions[:,2]))))
            assert np.all(np.isfinite(p)) and np.all(np.isfinite(n))
            bounds_min=np.minimum(bounds_min,p.min(axis=0));bounds_max=np.maximum(bounds_max,p.max(axis=0))
            mesh_index=len(output["meshes"])
            primitive={"attributes":{"POSITION":writer.add(p,"VEC3",34962,True),"NORMAL":writer.add(n,"VEC3",34962)},"indices":writer.add(indices,"SCALAR",34963),"material":material,"mode":4}
            suffix="_ground" if ground_contact else ""
            output["meshes"].append({"name":f"{fid}_material_{material:02d}{suffix}","primitives":[primitive]})
            child=len(output["nodes"])
            output["nodes"][group_node]["children"].append(child)
            output["nodes"].append({"name":f"{name}_material_{material:02d}{suffix}","mesh":mesh_index,"extras":{"source_feature":fid,"facilityId":fid,"materialSourceIndex":material,"groundContact":ground_contact}})
            feature_triangles+=len(indices)//3;output_triangles+=len(indices)//3
        all_min=np.minimum(all_min,bounds_min);all_max=np.maximum(all_max,bounds_max)
        ring=np.asarray(feature["ringEPSG3006"])
        rx,rz=horizontal(ring[:,0],ring[:,1]);plan=np.column_stack([rx,rz]).tolist()
        anchor=np.mean(np.asarray(feature["ringBlenderXY"]),axis=0)
        ax,az=horizontal(ORIGIN_E+anchor[0],ORIGIN_N+anchor[1])
        building_indices=BUILDING_INDICES.get(fid,[]);parking_indices=PARKING_INDICES.get(fid,[])
        building_rings=[{"index":i,"ring":infra["buildings"][i]["ring"]} for i in building_indices]
        parking_rings=[{"index":i,"ring":infra["parking"][i]["ring"]} for i in parking_indices]
        known_ids=[infra["buildings"][i]["id"] for i in building_indices if infra["buildings"][i].get("id") is not None]
        facilities.append({"id":fid,"nodeName":name,"label":feature["label"],"kind":feature["kind"],
            "sourceBuildingIndices":building_indices,"sourceBuildingRingsLocal":building_rings,"sourceBuildingIds":known_ids,
            "sourceParkingIndices":parking_indices,"sourceParkingRingsLocal":parking_rings,
            "sourceSurfaceIds":[infra["parking"][i]["id"] for i in parking_indices if infra["parking"][i].get("id") is not None],
            "sourceSurfacePaths":[f"/infra/parking/{i}/ring" for i in parking_indices],
            "planRingLocal":plan,"groundAnchorLocal":[float(ax),float(az)],
            "groundAnchorRh2000M":sample_ground(*anchor),
            "boundsLocalRh2000":{"min":bounds_min.tolist(),"max":bounds_max.tolist()},
            "triangles":feature_triangles,"materialMeshes":len(output["nodes"][group_node]["children"]),
            "groundContactMeshes":sum(1 for key in grouped if key[0]==fid and key[2]),
            "sourceBlenderObjects":source_counts[fid],"identificationStatus":feature["identificationStatus"],
            "sourcePanelId":feature["sourcePanelId"],"sourceOrthophotoIds":feature["sourceIds"],
            "planBoundaryInterpretationUncertaintyMetres":feature["boundaryInterpretationUncertaintyMetres"],
            "heightUncertainty":{"status":"unquantified photo/model estimate; not surveyed","metres":None},
            "sourceNotes":feature["notes"]})
    assert output_triangles==triangle_count
    assert max_roundtrip_error<.0001 and max_position_error<.0001
    assert max_normal_error<1e-6 and max_normal_step_error<1e-6
    data=writer.finish();OUTPUT.parent.mkdir(parents=True,exist_ok=True);OUTPUT.write_bytes(data)
    asset={"url":"models/veckefjarden/facilities-v1.glb","sha256":sha(data),"bytes":len(data)}
    provenance={"orthophotoCapturedAt":"2024-06-27","orthophotoAttribution":"Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0",
        "orthophotoNativePixelSpacingMetres":.16,"orthophotoAbsoluteHorizontalAccuracyMetres":None,
        "sourceGlb":file_record(SOURCE),"inventory":file_record(inventory_path),"modelGround":file_record(ground_path),
        "groundGrid":file_record(grid_path),"photos":file_record(ROOT/"geobuild/facilities/photo-sources.json"),
        "publicPacks":[p[1] for p in packs],"referencePhotosEmbedded":False,
        "buildingIdentityContract":"Numeric pack indices are guarded by corresponding exact decoded rings. Missing source IDs are empty arrays, never undefined IDs.",
        "projection":"Per-vertex PROJ EPSG:3006 to WGS84, then exact published GPK1 local frame. Normals use inverse-transpose of the local full horizontal Jacobian.",
        "groundContactContract":"Only six explicitly inspected draped paving source objects have groundContact=true. Raised terraces, stairs, buildings, furnishings, island edging, mats and poles are excluded. This bake does not alter source paving elevations.",
        "heightContract":"Geometry Y is absolute RH2000. The runtime loader applies its chosen vertical datum offset; no legacy height bias is baked."}
    manifest={"schemaVersion":1,"id":"veckefjarden-facilities-v1","coordinateFrame":"legacy-local-rh2000",
        "courseSlugs":SLUGS,"groundId":"veckefjarden","asset":asset,
        "legacyFrame":{"latitude":ORIGIN_LAT,"longitude":ORIGIN_LON,"metresPerLongitude":METRES_LON,"metresPerLatitude":METRES_LAT},
        "boundsLocalRh2000":{"min":all_min.tolist(),"max":all_max.tolist()},
        "sourcePlanFrame":{"horizontalCrs":"EPSG:3006","originEasting":ORIGIN_E,"originNorthing":ORIGIN_N,"originHeightRH2000":ORIGIN_H},
        "triangles":output_triangles,"materialMeshes":len(grouped),"materials":len(output["materials"]),
        "facilities":facilities,"provenance":provenance}
    write_json(MANIFEST,manifest)
    write_json(FOOTPRINTS,[{"id":f["id"],"ring":f["planRingLocal"]} for f in facilities])
    # Independent binary reopen checks the actual written artifact rather than
    # trusting in-memory counts or the JSON sidecar alone.
    check,binary=read_glb(OUTPUT)
    decoded_triangles=0;decoded_vertices=0
    for mesh in check["meshes"]:
        for primitive in mesh["primitives"]:
            position=accessor(check,binary,primitive["attributes"]["POSITION"])
            normal=accessor(check,binary,primitive["attributes"]["NORMAL"])
            indices=accessor(check,binary,primitive["indices"])
            assert np.all(np.isfinite(position)) and np.all(np.isfinite(normal))
            assert int(indices.max())<len(position)
            decoded_triangles+=len(indices)//3;decoded_vertices+=len(position)
    assert decoded_triangles==triangle_count and decoded_vertices==vertex_count
    assert check["materials"]==g["materials"]
    assert len(check["scenes"][0]["nodes"])==20
    assert sum(1 for n in check["nodes"] if n.get("extras",{}).get("groundContact"))==6
    assert {n["extras"]["facilityId"] for n in check["nodes"]}==EXPECTED_FEATURES
    audit={"schemaVersion":1,"passed":True,"asset":asset,"manifest":file_record(MANIFEST),"staticFootprints":file_record(FOOTPRINTS),
        "source":file_record(SOURCE),"builder":file_record(Path(__file__)),
        "sourceObjects":len(visited),"sourceVertices":vertex_count,"outputVertices":decoded_vertices,
        "sourceTriangles":triangle_count,"outputTriangles":decoded_triangles,
        "outputFeatureGroups":20,"sourceMaterialDraws":len(g["meshes"]),"outputMaterialDraws":len(grouped),
        "drawCallReductionPercent":round((1-len(grouped)/len(g["meshes"]))*100,3),
        "sourceBytes":SOURCE.stat().st_size,"outputBytes":len(data),"materialsPreserved":True,"images":0,
        "positionFloat32MaximumErrorMetres":max_position_error,
        "independentInverseProjectionMaximumErrorMetres":max_roundtrip_error,
        "normalLengthMaximumError":max_normal_error,"normalJacobianStepCrosscheckMaximumDifference":max_normal_step_error,
        "replacementBuildingIndices":sorted(i for ids in BUILDING_INDICES.values() for i in ids),
        "replacementParkingIndices":sorted(i for ids in PARKING_INDICES.values() for i in ids),
        "bothPackInfrastructureIdentical":True,
        "groundContactSourceNodes":ground_contact_sources,"groundContactMeshes":6,
        "groundContactBakeHeightAdjustmentMetres":0,
        "notes":["Arithmetic precision does not establish survey accuracy.","All source triangles and PBR materials retained; source nodes merged by feature, material and ground-contact status only.","Northern neighboring buildings and the broad legacy hotel parking polygon remain outside the replacement set."]}
    write_json(AUDIT,audit)
    print(json.dumps({k:v for k,v in audit.items() if k not in ["notes"]},indent=2))


if __name__=="__main__":
    main()
