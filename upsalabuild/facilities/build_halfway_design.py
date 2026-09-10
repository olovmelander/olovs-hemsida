"""Build the separate, UNPLACED 2026 Halfway House design in Blender.

This is deliberately excluded from the twelve placed facility assets and every
runtime JSON. Call build_halfway_design() explicitly in a separate Blender
process or after the main build; importing this file does not build anything.
"""
from pathlib import Path
import hashlib
import json
import math
import struct

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "UNPLACED HALFWAY | "


def build_halfway_design(output_dir=None, suffix="", repo_root=None):
    """Author a plan-based design asset; no location or course datum is assigned."""
    root = Path(repo_root).resolve() if repo_root else ROOT
    out = Path(output_dir) if output_dir else root / "upsalabuild/facilities/models-2026-09-10/unplaced-design"
    name = "Halfway-design-unplaced" + suffix
    blend_path, glb_path = out / (name + ".blend"), out / (name + ".glb")
    report_path = out / (name + ".json")
    if any(p.exists() for p in (blend_path, glb_path, report_path)):
        raise RuntimeError("An unplaced design output already exists; supply a fresh suffix to preserve it")
    scene_name = "Upsala Halfway House 2026 | UNPLACED DESIGN" + suffix
    if bpy.data.scenes.get(scene_name):
        raise RuntimeError("This design scene already exists; supply a fresh suffix")
    sources = []
    for filename in ("halfway-plan1.webp", "halfway-plan2.webp", "halfway-plan3.webp", "halfway-render.webp"):
        p = root / "upsalabuild/cache/facilities-web-2026-09-10" / filename
        if not p.is_file():
            raise RuntimeError("Missing reviewed source drawing: " + str(p))
        sources.append({"path": p.relative_to(root).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
    original = {s.name: len(s.objects) for s in bpy.data.scenes}
    active_before, filepath_before = bpy.context.scene.name, bpy.data.filepath
    scene = bpy.data.scenes.new(scene_name)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["unplaced_design"] = True
    scene["runtime_inclusion_authorized"] = False
    scene["coordinate_contract"] = "Local design metres only; no course XZ, WGS84, SWEREF or RH2000 placement"
    scene["design_axes"] = "X follows the plan's7200mm dimension (north/south gable direction); Y follows6400mm dimension; front east glazing is Y-negative. These are design labels, not georeferenced axes."
    scene["height_status"] = "Estimated: wall2.55m, ridge3.65m, offset ridgeY+0.64m interpreted from unscaled elevations"
    collection = bpy.data.collections.new(PREFIX + "MODEL - never a placed runtime asset")
    scene.collection.children.link(collection)

    def material(name, color, roughness=.6, metallic=0, transmission=0):
        mat = bpy.data.materials.new(PREFIX + name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = transmission
        return mat

    white = material("Painted light timber - design illustration", (.79, .80, .76))
    batten = material("Light vertical boarding", (.86, .86, .81))
    dark = material("Charcoal window frames", (.035, .045, .045), .4)
    roof_mat = material("Estimated dark standing-seam roof", (.08, .105, .115), .5, .25)
    seam_mat = material("Standing seams", (.13, .16, .17), .45, .2)
    glass = material("Design glazing", (.11, .19, .20), .14, .08, .22)
    floor_mat = material("Design floor and foundation datum", (.40, .40, .37))
    wood = material("Interior counter timber", (.40, .29, .17))

    def mesh(name, vertices, faces, mat):
        data = bpy.data.meshes.new(PREFIX + name)
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new(PREFIX + name, data)
        collection.objects.link(obj)
        obj.data.materials.append(mat)
        obj["unplaced_design"] = True
        obj["runtime_asset"] = False
        obj["dimension_basis"] = "7200x6400mm floor plan; other dimensions interpreted"
        return obj

    def box(name, center, size, mat):
        cx, cy, cz = center
        a, b, c = (v / 2 for v in size)
        vertices = [(cx-a,cy-b,cz-c),(cx+a,cy-b,cz-c),(cx+a,cy+b,cz-c),(cx-a,cy+b,cz-c),
                    (cx-a,cy-b,cz+c),(cx+a,cy-b,cz+c),(cx+a,cy+b,cz+c),(cx-a,cy+b,cz+c)]
        return mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], mat)

    def beam(name, start, end, width, mat):
        start, end = Vector(start), Vector(end)
        obj = box(name, (0,0,0), (width,width,(end-start).length), mat)
        obj.location = (start+end)/2
        obj.rotation_euler = (end-start).to_track_quat("Z", "Y").to_euler()
        return obj

    length, span, wall_height, ridge_height, ridge_y = 7.2, 6.4, 2.55, 3.65, .64
    wall_thickness, overhang = .18, .23
    # Openings: along-wall interval, bottom, top, and glazing/door name.
    east = [(-3.47,-.90,.14,2.30,"east left glazing"),(-.90,.90,.03,2.30,"east paired doors"),(.90,3.47,.14,2.30,"east right glazing")]
    west = [(-1.18,-.28,.03,2.13,"west service door")]
    north = [(-2.98,-.30,.14,2.24,"north three-panel glazing")]
    south = [(-2.98,.64,.14,2.24,"south glazed frontage"),(1.16,2.08,.03,2.15,"south side door")]

    def wall(name, axis, fixed, half_length, openings):
        edges = sorted(set([-half_length,half_length]+[v for opening in openings for v in opening[:2]]))
        def place(s, z):
            return (s,fixed,z) if axis=="X" else (fixed,s,z)
        def size(w,h,depth=wall_thickness):
            return (w,depth,h) if axis=="X" else (depth,w,h)
        for index,(lo,hi) in enumerate(zip(edges,edges[1:])):
            mid=(lo+hi)/2
            opening=next((o for o in openings if o[0]<mid<o[1]),None)
            ranges=[(0,wall_height)] if not opening else [(0,opening[2]),(opening[3],wall_height)]
            for bottom,top in ranges:
                if top-bottom>.01:
                    box(name+f" wall{index}",place(mid,(bottom+top)/2),size(hi-lo,top-bottom),white)
        # Vertical seams on the opaque parts, clipped around each opening.
        for i in range(int(half_length*2/.16)+1):
            s=-half_length+.04+i*.16
            if s>half_length-.02:continue
            opening=next((o for o in openings if o[0]-.015<s<o[1]+.015),None)
            ranges=[(0,wall_height)] if not opening else [(0,opening[2]),(opening[3],wall_height)]
            for bottom,top in ranges:
                if top-bottom>.04:
                    point=list(place(s,(bottom+top)/2));point[1 if axis=="X" else 0]+=math.copysign(wall_thickness/2+.012,fixed)
                    box(name+f" batten{i}",point,size(.025,top-bottom,.024),batten)
        for lo,hi,bottom,top,label in openings:
            mid=(lo+hi)/2
            box(label+" glass",place(mid,(bottom+top)/2),size(hi-lo-.09,top-bottom-.09,.04),glass)
            for edge in (lo,hi):box(label+" jamb",place(edge,(bottom+top)/2),size(.065,top-bottom+.06,.14),dark)
            for level in (bottom,top):box(label+" rail",place(mid,level),size(hi-lo+.06,.065,.14),dark)
            panels=2 if "paired" in label else max(1,round((hi-lo)/.8))
            for j in range(1,panels):box(label+f" mullion{j}",place(lo+(hi-lo)*j/panels,(bottom+top)/2),size(.05,top-bottom,.12),dark)

    box("Floor datum - no surveyed foundation",(0,0,-.09),(length,span,.18),floor_mat)
    wall("East long glazed facade","X",-span/2,length/2,east)
    wall("West service facade","X",span/2,length/2,west)
    wall("North gable facade","Y",-length/2,span/2,north)
    wall("South gable facade","Y",length/2,span/2,south)

    def roof_height(y):
        if y<=ridge_y:return wall_height+(ridge_height-wall_height)*(y+span/2)/(ridge_y+span/2)
        return ridge_height-(ridge_height-wall_height)*(y-ridge_y)/(span/2-ridge_y)

    for end in (-1,1):
        outside=end*length/2;inside=outside-end*wall_thickness
        profile=[(-span/2,wall_height),(ridge_y,ridge_height),(span/2,wall_height)]
        vertices=[(xx,yy,zz) for xx in (outside,inside) for yy,zz in profile]
        faces=[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
        if end<0:faces=[tuple(reversed(face)) for face in faces]
        mesh(("North" if end<0 else "South")+" asymmetric gable",vertices,faces,white)
        for i in range(40):
            yy=-span/2+.08+i*.16
            if yy>=span/2:break
            height=roof_height(yy)-wall_height
            if height>.02:box("Gable vertical boarding",(outside+end*.014,yy,wall_height+height/2),(.025,.025,height),batten)
    for side,edge in (("east",-span/2-overhang),("west",span/2+overhang)):
        top=[(-length/2-overhang,edge,roof_height(edge)),(length/2+overhang,edge,roof_height(edge)),
             (length/2+overhang,ridge_y,ridge_height),(-length/2-overhang,ridge_y,ridge_height)]
        if side=="west":top.reverse()
        vertices=top+[(x,y,z-.10) for x,y,z in top]
        mesh(side+" roof surface - estimated pitch",vertices,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],roof_mat)
        for i in range(17):
            xx=-length/2-overhang+i*(length+2*overhang)/16
            beam(side+" standing seam",(xx,edge,roof_height(edge)+.02),(xx,ridge_y,ridge_height+.02),.018,seam_mat)
        beam(side+" light fascia",(-length/2-overhang,edge,roof_height(edge)-.06),(length/2+overhang,edge,roof_height(edge)-.06),.12,white)
    beam("Ridge cap",(-length/2-overhang,ridge_y,ridge_height+.02),(length/2+overhang,ridge_y,ridge_height+.02),.10,roof_mat)
    # Only coarse plan-supported interior volumes; fixture details are omitted.
    box("Rear worktop - plan3455mm",(1.63,2.72,.91),(3.455,.62,.09),wood)
    box("Serving counter - plan2655mm",(1.07,1.21,.98),(2.655,.62,.98),white)
    box("WC partition - approximate plan",(-1.72,2.04,1.12),(.12,2.17,2.24),white)
    box("WC front partition - approximate plan",(-2.57,.98,1.12),(1.7,.12,2.24),white)

    readme = bpy.data.texts.new(PREFIX+"EVIDENCE AND PLACEMENT")
    readme.write("UNPLACED 2026 HALFWAY HOUSE DESIGN\n\nThe club floor plan labels7200x6400mm (46.08m2). Wall2.55m, ridge3.65m, ridge offset0.64m and overhang0.23m are interpreted estimates from unscaled elevations. Openings follow those schematic elevations approximately; facade detail and materials are design references, not verified as-built measurements. The generic design illustration and gable elevations are different evidence types; plan/elevations control this model's geometry. No course coordinate, floor elevation or location is assigned. NEVER include this model in the twelve placed facility assets or authored runtime JSON without separately verified placement.\n")
    readme.use_fake_user=True
    scene["source_files"]=json.dumps(sources)
    scene["readme_text"]=readme.name
    meshes=[o for o in scene.objects if o.type=="MESH"]
    assert meshes and all(o.get("runtime_asset") is False for o in meshes)
    out.mkdir(parents=True,exist_ok=True)
    # Active-scene override is temporary; no window scene/file replacement occurs.
    original_window_scene=bpy.context.window.scene if bpy.context.window else None
    try:
        with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
            bpy.ops.export_scene.gltf(filepath=str(glb_path),export_format="GLB",use_active_scene=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False)
    finally:
        # The glTF operator can change the window scene even under temp_override.
        if bpy.context.window and original_window_scene:
            bpy.context.window.scene=original_window_scene
    payload=glb_path.read_bytes();magic,version,total=struct.unpack_from("<III",payload)
    assert magic==0x46546C67 and version==2 and total==len(payload)
    size,kind=struct.unpack_from("<II",payload,12);assert kind==0x4E4F534A
    gltf=json.loads(payload[20:20+size].decode("utf-8"))
    assert len(gltf.get("scenes",[]))==1
    assert all(node.get("name","").startswith(PREFIX) for node in gltf.get("nodes",[])),"Unexpected object leaked into isolated design export"
    bpy.data.libraries.write(str(blend_path),{scene,readme},path_remap="RELATIVE",fake_user=True,compress=True)
    assert bpy.context.scene.name==active_before and bpy.data.filepath==filepath_before
    assert all(len(bpy.data.scenes[name].objects)==count for name,count in original.items())
    report={"schemaVersion":1,"id":"upsala-halfway-2026-unplaced-design","scene":scene.name,"unplaced":True,"runtimeIncluded":False,
            "georeferenced":False,"courseLocation":None,"coordinateFrame":"Local design XYZ metres; arbitrary floorZ=0",
            "planDimensionsMetres":[7.2,6.4],"planAreaSquareMetres":46.08,"estimatedWallHeightMetres":2.55,"estimatedRidgeHeightMetres":3.65,
            "estimatedRidgeOffsetMetres":.64,"estimatedPitchDegrees":{"east":math.degrees(math.atan(1.1/3.84)),"west":math.degrees(math.atan(1.1/2.56))},
            "heightUncertaintyMetres":.5,"sourceGeometry":"Official floor plan dimensions with interpreted schematic elevations; not an as-built survey",
            "sources":sources,"objects":len(meshes),"blendPath":str(blend_path),"glbPath":str(glb_path),
            "blendSha256":hashlib.sha256(blend_path.read_bytes()).hexdigest(),"glbSha256":hashlib.sha256(payload).hexdigest(),
            "existingScenesPreserved":original,"activeScenePreserved":active_before,"existingBlenderFilepathPreserved":filepath_before,
            "limitations":["No verified course placement: excluded from all main facility/runtime assets.","Wall/roof heights and openings are modelling estimates.","A design model does not establish the actual2026 building's finished geometry."]}
    report_path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report))
    return scene


if __name__ == "__main__":
    import sys
    if "--build-halfway-design" in sys.argv:
        build_halfway_design()
