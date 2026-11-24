#!/usr/bin/env python3
"""Create a georeferenced Blender reference scene for Banvy facility authoring.

Usage (headless):
  blender --background --factory-startup --python tools/facility-pipeline/prepare-reference-scene.py -- \
    --spec brohofbuild/cache/facility-ref-spec.json \
    --out brohofbuild/cache/bro-hof-facilities-ref.blend

Follows geobuild/facilities/README.md hygiene rules:
  - Creates a dedicated scene (`Banvy_Facilities_<ground>`) and isolated
    collections (`Reference_Terrain`, `Reference_Ortho`, `Reference_Footprints`,
    `Reference_LiDAR_Roofs`, `Authoring_Facilities`).
  - Uses Blender's data API (`bpy.data.*`) directly instead of viewport-sensitive
    `bpy.ops` operators.
  - Uses Banvy's local metric grid in Blender Z-up coordinates:
      Blender X = Easting - origin.easting   (East  -> glTF +X)
      Blender Y = Northing - origin.northing (North -> glTF -Z)
      Blender Z = RH 2000 elevation metres   (Up    -> glTF +Y)
    so Blender's standard glTF (+Y Up) exporter emits exact Banvy
    (East +X, Up +Y RH2000, South +Z) coordinates with zero manual axis hacks!
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

try:
    import bpy
except ImportError as exc:
    raise SystemExit(f'prepare-reference-scene.py must be executed inside Blender (bpy unavailable: {exc})')


def ensure_collection(scene, name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        scene.collection.children.link(col)
    return col


def build_terrain_mesh(col, dtm_spec, origin, crop_local):
    """Build a 1 m terrain reference mesh cropped to [minX, minY, maxX, maxY] in Blender local metres."""
    path = Path(dtm_spec['path'])
    raw = path.read_bytes()
    side = int(dtm_spec['side'])
    spacing = float(dtm_spec.get('spacing', 1.0))
    orig_e = float(dtm_spec['originEasting'])
    orig_n = float(dtm_spec['originNorthing'])
    heights = struct.unpack(f'<{side * side}f', raw)

    min_x, min_y, max_x, max_y = crop_local
    c0 = max(0, int(math.floor((origin['easting'] + min_x - orig_e) / spacing)))
    c1 = min(side - 1, int(math.ceil((origin['easting'] + max_x - orig_e) / spacing)))
    r0 = max(0, int(math.floor((orig_n - (origin['northing'] + max_y)) / spacing)))
    r1 = min(side - 1, int(math.ceil((orig_n - (origin['northing'] + min_y)) / spacing)))

    nx = c1 - c0 + 1
    ny = r1 - r0 + 1
    verts = []
    for r in range(r0, r1 + 1):
        northing = orig_n - r * spacing
        by = northing - origin['northing']
        for c in range(c0, c1 + 1):
            easting = orig_e + c * spacing
            bx = easting - origin['easting']
            bz = heights[r * side + c]
            verts.append((bx, by, bz))

    faces = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            v00 = j * nx + i
            v10 = v00 + 1
            v01 = (j + 1) * nx + i
            v11 = v01 + 1
            faces.append((v00, v10, v11, v01))

    mesh = bpy.data.meshes.new('Reference_DTM_1m')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('Reference_DTM_1m', mesh)
    col.objects.link(obj)
    obj.hide_render = True
    return obj


def build_ortho_plane(col, ortho_spec, origin):
    """Add a georeferenced orthophoto reference quad slightly below ground."""
    w, s, e, n = ortho_spec['boundsEpsg3006']
    z = float(ortho_spec.get('elevationRH2000', 0.0))
    verts = [
        (w - origin['easting'], s - origin['northing'], z),
        (e - origin['easting'], s - origin['northing'], z),
        (e - origin['easting'], n - origin['northing'], z),
        (w - origin['easting'], n - origin['northing'], z),
    ]
    mesh = bpy.data.meshes.new('Reference_Ortho_Plane')
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for loop_idx, uv in enumerate([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]):
        uv_layer.data[loop_idx].uv = uv
    mesh.update()

    img_path = str(Path(ortho_spec['imagePath']).resolve())
    mat = bpy.data.materials.new('Reference_Ortho_Mat')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out_node = nodes.new('ShaderNodeOutputMaterial')
    emit = nodes.new('ShaderNodeEmission')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(img_path, check_existing=True)
    links.new(tex.outputs['Color'], emit.inputs['Color'])
    links.new(emit.outputs['Emission'], out_node.inputs['Surface'])
    mesh.materials.append(mat)

    obj = bpy.data.objects.new('Reference_Ortho_Plane', mesh)
    col.objects.link(obj)
    obj.hide_render = True
    return obj


def build_footprints(col, geojson_path, origin, default_z=0.0):
    """Import EPSG:3006 building polygons as reference edge loops."""
    fc = json.loads(Path(geojson_path).read_text(encoding='utf-8'))
    created = 0
    for idx, feat in enumerate(fc.get('features', [])):
        geom = feat.get('geometry') or {}
        if geom.get('type') != 'Polygon':
            continue
        ring = geom['coordinates'][0]
        if len(ring) < 3:
            continue
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        z = float((feat.get('properties') or {}).get('groundRH2000', default_z))
        verts = [(e - origin['easting'], n - origin['northing'], z) for e, n in pts]
        edges = [(i, (i + 1) % len(verts)) for i in range(len(verts))]
        name = f"Footprint_{feat.get('id') or idx}"
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, edges, [])
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        col.objects.link(obj)
        created += 1
    return created


def build_lidar_clouds(col, points_files, origin):
    """Import cached COPC LiDAR points (Class 6 roofs & Class 2 ground) as vertex meshes."""
    total_pts = 0
    for pf in points_files:
        doc = json.loads(Path(pf).read_text(encoding='utf-8'))
        tid = doc.get('targetId', Path(pf).stem)
        roof_verts = []
        ground_verts = []
        for e, n, z, cls, *_ in doc.get('points', []):
            v = (e - origin['easting'], n - origin['northing'], z)
            if cls == 6:
                roof_verts.append(v)
            elif cls == 2:
                ground_verts.append(v)
        for label, verts in (('Roofs', roof_verts), ('Ground', ground_verts)):
            if not verts:
                continue
            name = f'LiDAR_{tid}_{label}'
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(verts, [], [])
            mesh.update()
            obj = bpy.data.objects.new(name, mesh)
            col.objects.link(obj)
            total_pts += len(verts)
    return total_pts


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    spec = json.loads(args.spec.read_text(encoding='utf-8'))
    ground_id = spec['groundId']
    origin = spec['originEpsg3006']

    scene = bpy.data.scenes.new(f'Banvy_Facilities_{ground_id}')
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0

    col_terrain = ensure_collection(scene, 'Reference_Terrain')
    col_ortho = ensure_collection(scene, 'Reference_Ortho')
    col_fp = ensure_collection(scene, 'Reference_Footprints')
    col_lidar = ensure_collection(scene, 'Reference_LiDAR_Roofs')
    ensure_collection(scene, 'Authoring_Facilities')

    if spec.get('dtm'):
        build_terrain_mesh(col_terrain, spec['dtm'], origin, spec['cropLocalXY'])
    if spec.get('ortho'):
        build_ortho_plane(col_ortho, spec['ortho'], origin)
    if spec.get('footprintsGeoJson'):
        build_footprints(col_fp, spec['footprintsGeoJson'], origin, spec.get('defaultElevationRH2000', 0.0))
    if spec.get('lidarPointsFiles'):
        build_lidar_clouds(col_lidar, spec['lidarPointsFiles'], origin)

    # Remove unused default Scene if present so the saved file opens straight on our scene
    for existing in list(bpy.data.scenes):
        if existing != scene:
            bpy.data.scenes.remove(existing)

    out_path = args.out.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_path))
    print(json.dumps({'groundId': ground_id, 'scene': scene.name, 'blendOut': str(out_path)}))


if __name__ == '__main__':
    main()
