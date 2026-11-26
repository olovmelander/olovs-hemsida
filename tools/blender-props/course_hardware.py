"""Build Banvy's instanced flagstick, tee marker and distance sign, in metres.

Run with blender -b --factory-startup -P tools/blender-props/course_hardware.py.
The four meshes use the player's original local origins. This file contains
no course coordinates. The exported colours are linear neutral paint values
that the player can tint per instance.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy


def mesh(name, vertices, faces, tones, roughness, smooth=True):
    geometry = bpy.data.meshes.new(name)
    geometry.from_pydata(vertices, [], faces)
    geometry.update()
    obj = bpy.data.objects.new(name, geometry)
    bpy.context.collection.objects.link(obj)
    colours = geometry.color_attributes.new(name="Paint", type="BYTE_COLOR", domain="POINT")
    for entry, rgb in zip(colours.data, tones):
        entry.color = (*rgb, 1)
    for face in geometry.polygons:
        face.use_smooth = smooth
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = roughness
    paint = material.node_tree.nodes.new("ShaderNodeVertexColor")
    paint.layer_name = colours.name
    material.node_tree.links.new(paint.outputs["Color"], shader.inputs["Base Color"])
    obj.data.materials.append(material)
    return obj


def turning(name, profile, segments, roughness):
    vertices, faces, tones = [], [], []
    for ring, (height, radius, rgb) in enumerate(profile):
        for side in range(segments):
            angle = math.tau * side / segments
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
            tones.append(rgb)
            if ring:
                a = (ring - 1) * segments + side
                b = (ring - 1) * segments + (side + 1) % segments
                faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range(len(vertices) - segments, len(vertices))))
    return mesh(name, vertices, faces, tones, roughness)


def marker():
    # Flatten the cut base where it meets the turf. A shallow mould parting
    # line catches a highlight in grazing light without growing the silhouette.
    profile = []
    for latitude in [-90, -74, -67, -56, -44, -32, -19, -7, -1.2, -0.5, 0, 0.5, 1.2,
                     7, 19, 32, 44, 56, 67, 78, 87, 90]:
        angle = math.radians(latitude)
        height = 0.13 * math.sin(angle)
        if height < -0.105:
            height = -0.105 + (height + 0.105) * 0.35
        radius = max(0.0001, 0.13 * math.cos(angle) - (0.0008 if latitude == 0 else 0))
        shade = 0.81 + 0.18 * min(1, max(0, (height + 0.115) / 0.083))
        if latitude == 0:
            shade *= 0.92
        profile.append((height, radius, (shade, shade, shade)))
    return turning("tee_marker", profile, 28, 0.49)


def flagstick():
    ivory, sleeve = (0.89, 0.91, 0.88), (0.76, 0.78, 0.75)
    alloy, joint = (0.54, 0.59, 0.60), (0.27, 0.30, 0.30)
    return turning("flagstick", [
        (-1.43, 0.0220, alloy), (-1.427, 0.0225, alloy),
        (-1.295, 0.0225, alloy), (-1.294, 0.0224, joint), (-1.291, 0.0224, ivory),
        (0.700, 0.0193, ivory), (0.705, 0.0193, joint),
        (0.715, 0.0257, alloy), (0.717, 0.0260, alloy),
        (0.723, 0.0260, alloy), (0.725, 0.0257, sleeve),
        (1.235, 0.0257, sleeve), (1.237, 0.0260, alloy), (1.245, 0.0260, alloy),
        (1.250, 0.0230, alloy), (1.255, 0.0180, ivory), (1.295, 0.0175, ivory),
        (1.300, 0.0145, ivory)], 20, 0.34)


def plate():
    # Rounded return and rolled highlight inside the original 40 x 28 x 6 cm box.
    vertices, faces, tones = [], [], []
    for depth, inset, tone in [(-0.030, 0.003, 1), (-0.027, 0, 0.95),
                               (0.027, 0, 0.93), (0.030, 0.003, 1)]:
        ring = []
        for sx, sz, start in [(1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)]:
            for j in range(5):
                angle = math.radians(start + j * 22.5)
                radius = 0.019 - inset
                ring.append((sx * 0.181 + radius * math.cos(angle), depth,
                             0.62 + sz * 0.121 + radius * math.sin(angle)))
        offset = len(vertices)
        vertices.extend(ring)
        tones.extend([(tone,) * 3] * len(ring))
        if offset:
            for i in range(20):
                a, b = offset - 20 + i, offset - 20 + (i + 1) % 20
                faces.append((b, a, a + 20, b + 20))
    faces.append(tuple(range(20)))
    faces.append(tuple(reversed(range(60, 80))))
    return mesh("distance_plate", vertices, faces, tones, 0.46, smooth=False)


def post():
    return turning("distance_post", [
        (0, 0.035, (0.64, 0.59, 0.52)), (0.038, 0.0348, (0.83, 0.81, 0.78)),
        (0.480, 0.0311, (1, 1, 1)), (0.484, 0.0265, (0.91, 0.91, 0.89)),
        (0.617, 0.0265, (0.94, 0.93, 0.90)),
        (0.620, 0.0270, (0.88, 0.86, 0.82))], 16, 0.79)


def export():
    # Only run in a private background process. Export only our selected objects.
    bpy.ops.object.select_all(action='DESELECT')
    objects = [marker(), flagstick(), plate(), post()]
    for obj in objects:
        obj.select_set(True)
    target = Path(__file__).resolve().parents[2] / "apps/golf/public/models/props"
    stage = target / "course-hardware.glb"
    bpy.ops.export_scene.gltf(filepath=str(stage), export_format="GLB", use_selection=True,
                              export_vertex_color="ACTIVE", export_normals=True,
                              export_texcoords=False, export_yup=True)
    data = stage.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    file = stage.with_name(f"course-hardware-{digest}.glb")
    stage.replace(file)
    record = {"url": f"models/props/{file.name}", "sha256": digest, "bytes": len(data),
              "meshes": [obj.name for obj in objects]}
    # Importable at build time; only the immutable mesh is fetched by the player.
    (target / "course-hardware.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(record)


if __name__ == "__main__":
    export()
