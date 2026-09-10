"""Build a separate, metre-scale reference scene in the connected Blender.

Run build_reference_scene(spec_path) through blender_mcp_client.py. This uses
data APIs and saves only the new scene with libraries.write; existing scenes,
the active window, and the user's current file are not replaced.
"""
import hashlib
import json
from pathlib import Path
import struct

import bpy


def build_reference_scene(spec_path):
    spec_path = Path(spec_path)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    root = Path(spec["repoRoot"])
    scene_name = spec["sceneName"]
    if bpy.data.scenes.get(scene_name):
        raise RuntimeError(f"Scene already exists: {scene_name}; use a new name to retain earlier work")
    active_before = bpy.context.scene.name
    original_scenes = {s.name: len(s.objects) for s in bpy.data.scenes}
    output = root / spec["blendPath"]
    if output.exists():
        raise RuntimeError(f"Output exists: {output}; choose a new file to retain earlier work")
    anchor = spec["anchorLocalXZ"]
    scene = bpy.data.scenes.new(scene_name)
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["reference_only"] = True
    scene["course_local_anchor_xz"] = anchor
    scene["axis_contract"] = "Blender (X,Y,Z)=(courseX-anchorX,-courseZ+anchorZ,height-relative-to-anchor); glTF Y-up exports back to course orientation"
    scene["height_note"] = "The orthophoto and outlines are a flat mapping datum, not measured terrain or building heights."
    scene["manifest_path"] = spec["manifestPath"]

    def collection(name):
        result = bpy.data.collections.new("UPSALA REF | " + name)
        scene.collection.children.link(result)
        return result

    ortho_collection = collection("01 Orthophoto")
    measured_collection = collection("02 Measured footprints")
    context_collection = collection("03 Other municipal outlines")
    label_collection = collection("04 Map labels")
    photo_collection = collection("05 Photo and drawing boards")
    photo_collection.hide_render = True
    rig_collection = collection("06 Review camera")

    def xy(point, height=0):
        return (point[0] - anchor[0], -point[1] + anchor[1], height)

    def material(name, color):
        mat = bpy.data.materials.new("UPSALA REF | " + name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        mat.node_tree.nodes.clear()
        emission = mat.node_tree.nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (*color, 1)
        result = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(emission.outputs[0], result.inputs["Surface"])
        return mat

    cyan = material("Measured cyan", (0.1, 0.9, 1.0))
    amber = material("Context amber", (1.0, 0.55, 0.06))
    white = material("Text white", (1.0, 1.0, 1.0))

    def outline(name, vertices, parent, mat, width=0.15, closed=True):
        curve = bpy.data.curves.new(name, "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = width
        curve.bevel_resolution = 0
        spline = curve.splines.new("POLY")
        spline.points.add(len(vertices) - 1)
        for p, vertex in zip(spline.points, vertices):
            p.co = (*vertex, 1)
        spline.use_cyclic_u = closed
        obj = bpy.data.objects.new(name, curve)
        curve.materials.append(mat)
        parent.objects.link(obj)
        obj["reference_only"] = True
        return obj

    def label(text, position, size=2, rotation=None, parent=label_collection):
        curve = bpy.data.curves.new("Label " + text, "FONT")
        curve.body = text
        curve.size = size
        curve.align_x = "CENTER"
        curve.materials.append(white)
        obj = bpy.data.objects.new("UPSALA REF | " + text, curve)
        obj.location = position
        if rotation:
            obj.rotation_euler = rotation
        parent.objects.link(obj)
        obj["reference_only"] = True
        return obj

    def image_plane(name, image_path, vertices, parent, attributes):
        img = bpy.data.images.load(str(root / image_path), check_existing=False)
        img.name = "UPSALA REF | " + name
        img.pack()
        mesh = bpy.data.meshes.new("UPSALA REF | " + name)
        mesh.from_pydata(vertices, [], [(0, 3, 2, 1)])
        mesh.update()
        uvs = mesh.uv_layers.new(name="Source pixels")
        uv_by_vertex = [(0, 1), (1, 1), (1, 0), (0, 0)]
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                uvs.data[loop_index].uv = uv_by_vertex[mesh.loops[loop_index].vertex_index]
        mat = bpy.data.materials.new("UPSALA REF | " + name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        emission = nodes.new("ShaderNodeEmission")
        result = nodes.new("ShaderNodeOutputMaterial")
        links.new(tex.outputs["Color"], emission.inputs["Color"])
        links.new(emission.outputs[0], result.inputs["Surface"])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new("UPSALA REF | " + name, mesh)
        parent.objects.link(obj)
        obj["reference_only"] = True
        obj["source_path"] = image_path
        for key, value in attributes.items():
            obj[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
        return obj

    corners = [xy(p) for p in spec["orthophoto"]["cornersLocalXZ"]]
    image_plane("LM native orthophoto", spec["orthophoto"]["path"], corners, ortho_collection,
                {"source_manifest": spec["manifestPath"], "capture_date": spec["orthophoto"].get("captureDate", "unknown"), "flat_mapping_datum": True})
    for extra in spec.get("additionalOrthophotos", []):
        image_plane(extra["id"], extra["path"], [xy(p, extra["displayPlaneZ"]) for p in extra["cornersLocalXZ"]], ortho_collection,
                    {"source_manifest": spec["manifestPath"], "flat_mapping_datum": True})
    for building in spec["footprints"]:
        measured = building["measured"]
        ring = building["localXZ"]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        obj = outline("UPSALA REF | " + building["id"], [xy(p, 0.35) for p in ring],
                      measured_collection if measured else context_collection, cyan if measured else amber)
        obj["source_id"] = building["sourceId"]
        obj["evidence"] = building.get("evidence", "See source manifest")
        obj["height_verified"] = False
        cx = sum(p[0] for p in ring) / len(ring)
        cz = sum(p[1] for p in ring) / len(ring)
        label(building["id"], xy([cx, cz], 0.6), size=2.0)

    camera_bounds = corners + [xy(p) for building in spec["footprints"] for p in building["localXZ"]]
    camera_bounds += [xy(p) for extra in spec.get("additionalOrthophotos", [])
                      if "native" in extra["id"] for p in extra["cornersLocalXZ"]]
    xs, ys = [c[0] for c in camera_bounds], [c[1] for c in camera_bounds]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    label("UPSALA GK / FACILITY REFERENCES", ((minx + maxx) / 2, maxy + 10, 0.5), size=5)
    label("Cyan: confirmed measured plan | Amber: other source evidence | Heights unmeasured", ((minx + maxx) / 2, miny - 12, 0.5), size=2.6)
    outline("UPSALA REF | 50 metre scale", [(minx + 10, miny + 10, 0.6), (minx + 60, miny + 10, 0.6)], label_collection, white, 0.3, False)
    label("50 m", (minx + 35, miny + 14, 0.7), size=2.4)
    outline("UPSALA REF | North", [(maxx - 15, maxy - 40, 0.6), (maxx - 15, maxy - 10, 0.6), (maxx - 20, maxy - 18, 0.6)], label_collection, white, 0.3, False)
    label("N", (maxx - 15, maxy - 7, 0.7), size=4)

    for index, photo in enumerate(spec.get("photos", [])):
        # Reference boards stand beyond the mapped area and are excluded from renders.
        col, row = index % 5, index // 5
        width = min(36.0, 42.0 * photo["width"] / photo["height"])
        height = width * photo["height"] / photo["width"]
        left = (col - 2.5) * 42
        board_y = maxy + 45 + row * 8
        bottom = 5 + row * 50
        vertices = [(left, board_y, bottom + height), (left + width, board_y, bottom + height),
                    (left + width, board_y, bottom), (left, board_y, bottom)]
        image_plane(photo["id"], photo["path"], vertices, photo_collection,
                    {"source_url": photo["sourceUrl"], "evidence_type": photo["evidenceType"], "capture_date": photo.get("captureDate", "unknown"), "not_a_texture_asset": True})
        label(photo["id"] + " | " + photo["evidenceType"], (left + width / 2, board_y - 0.1, bottom - 2), 1.2,
              (1.57079632679, 0, 0), photo_collection)

    camera_data = bpy.data.cameras.new("UPSALA REF | Map camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(maxx - minx + 40, maxy - miny + 50)
    camera_data.clip_end = 3000
    camera = bpy.data.objects.new("UPSALA REF | Map camera", camera_data)
    camera.location = ((minx + maxx) / 2, (miny + maxy) / 2, 1000)
    camera.rotation_euler = (0, 0, 0)
    rig_collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(root / spec["previewPath"])
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("UPSALA REF | World")
    world.color = (0.08, 0.08, 0.08)
    scene.world = world

    notes = bpy.data.texts.new("UPSALA README | Facility reference scene")
    notes.write(spec["readme"])
    notes.use_fake_user = True
    scene["readme_text"] = notes.name
    scene["photo_board_count"] = len(spec.get("photos", []))
    scene["footprint_count"] = len(spec["footprints"])
    laser_points = 0
    if "laserReference" in spec:
        laser = spec["laserReference"]
        laser_collection = collection("07 Laser 2021 - toggle for roof study")
        laser_collection.hide_render = True
        laser_collection.hide_viewport = True
        cloud_bytes = (root / laser["path"]).read_bytes()
        header, payload = cloud_bytes.split(b"end_header\n", 1)
        assert b"format binary_little_endian 1.0" in header
        assert b"property double x\nproperty double y\nproperty double z\nproperty uchar classification" in header
        groups = {}
        for x, y, z, classification in struct.iter_unpack("<dddB", payload):
            groups.setdefault(classification, []).append((x - anchor[0], y + anchor[1], z - laser["anchorHeightRH2000"]))
        laser_points = sum(len(points) for points in groups.values())
        assert laser_points == laser["points"]
        for classification, points in groups.items():
            names = {1: "Unclassified candidate surfaces", 2: "Ground", 7: "Noise"}
            name = f"UPSALA REF | LAS {classification} {names.get(classification, 'source class')}"
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(points, [], [])
            mesh.update()
            obj = bpy.data.objects.new(name, mesh)
            laser_collection.objects.link(obj)
            obj["source_manifest"] = laser["sourceManifest"]
            obj["classification"] = classification
            obj["roof_classification_verified"] = False
            obj["anchor_height_RH2000"] = laser["anchorHeightRH2000"]
            obj["reference_only"] = True
            # Point geometry remains editable as loose vertices; a modifier gives
            # a usable point display without fabricating roof surfaces.
            group = bpy.data.node_groups.new(name, "GeometryNodeTree")
            group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
            group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
            group_in = group.nodes.new("NodeGroupInput")
            group_out = group.nodes.new("NodeGroupOutput")
            mesh_to_points = group.nodes.new("GeometryNodeMeshToPoints")
            mesh_to_points.inputs["Radius"].default_value = 0.07
            group.links.new(group_in.outputs["Geometry"], mesh_to_points.inputs["Mesh"])
            group.links.new(mesh_to_points.outputs["Points"], group_out.inputs["Geometry"])
            modifier = obj.modifiers.new("Show original samples as points", "NODES")
            modifier.node_group = group
        scene["laser_points"] = laser_points
        scene["laser_height_anchor_RH2000"] = laser["anchorHeightRH2000"]
        notes.write("\nCollection07 contains original 2021 laser returns, hidden initially. Toggle it for roof study.\nBlenderZ=RH2000-34.968; this is a scene datum, not finished floor.\nClass1 is unclassified; no point has been reclassified as roof. Ground/noise remain separate.\n")
    if spec.get("contextReferences"):
        context_reference_collection = collection("08 Parking and practice references")
        context_reference_collection.hide_render = True
        green = material("Context pale green", (0.5, 0.9, 0.45))
        for feature in spec["contextReferences"]:
            rings = feature["rings"] + feature["holes"]
            for index, ring in enumerate(rings):
                obj = outline("UPSALA REF | " + feature["id"] + f" ring {index}", [xy(p, 0.2) for p in ring], context_reference_collection, green, 0.05)
                obj["source_manifest"] = feature["sourceManifest"]
                obj["category"] = feature["category"]
            if feature["point"]:
                px, py, pz = xy(feature["point"], 0.3)
                obj = outline("UPSALA REF | " + feature["id"], [(px - 1, py, pz), (px + 1, py, pz)], context_reference_collection, green, 0.15, False)
                obj["source_manifest"] = feature["sourceManifest"]
                obj["position_only_no_dimensions"] = True
    assert bpy.context.scene.name == active_before, "Active scene changed unexpectedly"
    assert all(len(bpy.data.scenes[name].objects) == count for name, count in original_scenes.items()), "Existing scene object count changed"
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), {scene, notes}, path_remap="RELATIVE", fake_user=True, compress=True)
    report = {"passed": True, "blenderVersion": bpy.app.version_string, "scene": scene.name,
              "activeScenePreserved": active_before, "existingScenesObjectCountsPreserved": original_scenes,
              "objects": len(scene.objects), "footprints": len(spec["footprints"]),
              "laserReferencePoints": laser_points,
              "contextReferences": len(spec.get("contextReferences", [])),
              "photoBoards": len(spec.get("photos", [])), "blendPath": spec["blendPath"],
              "blendBytes": output.stat().st_size, "blendSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
              "specPath": spec_path.relative_to(root).as_posix(), "referenceOnly": True,
              "physicalHeightsEstablished": False, "mapPreviewPath": spec["previewPath"]}
    (root / spec["reportPath"]).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return scene
