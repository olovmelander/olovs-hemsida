"""Read the saved production scene in background Blender; never save or edit it.

blender --background <puttom-facilities-v1.blend> --python export-authoring.py
Optional script arguments after --: --output <authoring-scene.json> --scene <name>
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CACHE = ROOT / 'puttombuild/cache/facilities-model-2026-09-10'
SCENE = 'Puttom | Authored facilities 2026-09-10'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def plain(value):
    if hasattr(value, 'to_list'):
        return [plain(v) for v in value.to_list()]
    if hasattr(value, 'to_dict'):
        return {k: plain(v) for k, v in value.to_dict().items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, str) and value[:1] in ('[', '{'):
        return json.loads(value)
    return value


def metadata(parent):
    required = ('facilityId', 'sourceBuildingIds', 'groundAnchorEpsg3006',
                'groundAnchorRh2000M', 'footprintEpsg3006', 'kind', 'evidence')
    missing = [key for key in required if key not in parent]
    if missing:
        raise ValueError(f'{parent.name}: missing metadata {missing}')
    item = {key: plain(parent[key]) for key in required}
    item['id'] = item.pop('facilityId')
    # Preserving older interactive scenes can add Blender's .001 suffix to
    # datablock names. Stable facility metadata owns the runtime node identity.
    item['nodeName'] = item['id']
    item['authoringNodeName'] = parent.name
    for key in ('excludeVegetation', 'placement', 'label'):
        if key in parent:
            item[key] = plain(parent[key])
    return item


def material_data(material):
    if material is None:
        raise ValueError('Production geometry has no material')
    principled = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if material.use_nodes else None
    if principled is None:
        raise ValueError(f'{material.name}: expected procedural Principled material')
    for name in ('Base Color', 'Metallic', 'Roughness', 'Alpha'):
        if principled.inputs[name].is_linked:
            raise ValueError(f'{material.name}: linked {name} would require a baked texture')
    color = list(principled.inputs['Base Color'].default_value)
    color[3] *= float(principled.inputs['Alpha'].default_value)
    return dict(name=material.name, baseColorFactor=color,
                metallicFactor=float(principled.inputs['Metallic'].default_value),
                roughnessFactor=float(principled.inputs['Roughness'].default_value),
                doubleSided=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', default=None)
    parser.add_argument('--output', type=Path, default=CACHE / 'authoring-scene.json')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.scene is None:
        build_report = HERE / 'blender-model-build.json'
        args.scene = json.loads(build_report.read_text(encoding='utf-8'))['scene'] if build_report.exists() else SCENE
    scene = bpy.data.scenes.get(args.scene)
    if scene is None:
        raise ValueError(f'Authored scene is unavailable: {args.scene}')
    if bpy.context.window:
        bpy.context.window.scene = scene
    depsgraph = scene.view_layers[0].depsgraph
    parents = sorted((o for o in scene.objects if o.type == 'EMPTY' and 'facilityId' in o), key=lambda o: o.name)
    if not parents:
        raise ValueError('No facility parent empties found')
    materials, material_indices, facilities, consumed = [], {}, [], set()
    for parent in parents:
        facility = metadata(parent)
        buckets = {}
        for original in sorted(parent.children_recursive, key=lambda o: o.name):
            if original.type != 'MESH' or not original.get('production_geometry', False):
                continue
            if original in consumed:
                raise ValueError(f'Duplicate facility ownership of {original.name}')
            consumed.add(original)
            evaluated = original.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
            try:
                mesh.calc_loop_triangles()
                matrix = evaluated.matrix_world
                normal_matrix = matrix.to_3x3().inverted().transposed()
                reflected = matrix.to_3x3().determinant() < 0
                grounding = {name: mesh.attributes.get(name) for name in ('ground_anchor_local', 'ground_mode', 'ground_clearance')}
                if any(grounding.values()):
                    if facility['kind'] != 'site' or not all(grounding.values()):
                        raise ValueError(f'{original.name}: ground-contact attributes need a site mesh and all three fields')
                    if any(attribute.domain != 'POINT' for attribute in grounding.values()):
                        raise ValueError(f'{original.name}: ground-contact attributes must use the POINT domain')
                for triangle in mesh.loop_triangles:
                    material = evaluated.material_slots[triangle.material_index].material if triangle.material_index < len(evaluated.material_slots) else None
                    if material not in material_indices:
                        material_indices[material] = len(materials)
                        materials.append(material_data(material))
                    index = material_indices[material]
                    cast_shadow = bool(original.get('castShadow', True))
                    receive_shadow = bool(original.get('receiveShadow', materials[index]['baseColorFactor'][3] >= .999))
                    bucket = buckets.setdefault((index, cast_shadow, receive_shadow),
                        dict(material=index, castShadow=cast_shadow, receiveShadow=receive_shadow,
                             positions=[], normals=[], objectNames=[], materialRoles=[]))
                    if facility['kind'] == 'site':
                        bucket.setdefault('groundAnchorsLocal', [])
                        bucket.setdefault('groundModes', [])
                        bucket.setdefault('groundClearances', [])
                    if original.name not in bucket['objectNames']:
                        bucket['objectNames'].append(original.name)
                    role = str(original.get('materialRole', material.name))
                    if role not in bucket['materialRoles']:
                        bucket['materialRoles'].append(role)
                    loops = list(triangle.loops)
                    if reflected:
                        loops.reverse()
                    for loop_index in loops:
                        loop = mesh.loops[loop_index]
                        position = matrix @ mesh.vertices[loop.vertex_index].co
                        # Blender 4.5 exposes evaluated split normals per corner.
                        normal = normal_matrix @ mesh.corner_normals[loop_index].vector
                        normal.normalize()
                        if not all(math.isfinite(v) for v in (*position, *normal)):
                            raise ValueError(f'Nonfinite geometry in {original.name}')
                        bucket['positions'].extend(position)
                        bucket['normals'].extend(normal)
                        if facility['kind'] == 'site':
                            vertex_index = loop.vertex_index
                            anchor = list(grounding['ground_anchor_local'].data[vertex_index].vector) if grounding['ground_anchor_local'] else [0., 0., 0.]
                            mode = int(grounding['ground_mode'].data[vertex_index].value) if grounding['ground_mode'] else 0
                            clearance = float(grounding['ground_clearance'].data[vertex_index].value) if grounding['ground_clearance'] else 0.
                            if mode not in (0, 1, 2) or not all(math.isfinite(v) for v in (*anchor, clearance)):
                                raise ValueError(f'{original.name}: invalid ground-contact values at vertex {vertex_index}: mode={mode}, anchor={anchor}, clearance={clearance}')
                            bucket['groundAnchorsLocal'].extend(anchor)
                            bucket['groundModes'].append(mode)
                            bucket['groundClearances'].append(clearance)
            finally:
                evaluated.to_mesh_clear()
        if not buckets:
            raise ValueError(f'{parent.name}: no production triangles')
        facility['primitives'] = list(buckets.values())
        facilities.append(facility)
    unowned = [o.name for o in scene.objects if o.type == 'MESH' and o.get('production_geometry', False) and o not in consumed]
    if unowned:
        raise ValueError(f'Production meshes lack facility owners: {unowned}')
    blend = Path(bpy.data.filepath).resolve()
    snapshot = dict(schemaVersion=1, groundId='puttom', scene=scene.name,
                    replacesRangeFacilities=bool(scene.get('replacesRangeFacilities', False)),
                    blenderVersion=bpy.app.version_string,
                    sourceBlend=dict(path=blend.relative_to(ROOT).as_posix(), sha256=digest(blend), bytes=blend.stat().st_size),
                    coordinateFrame=dict(kind='blender-local-epsg3006-rh2000', origin=[697365., 7025190., 44.], axes='east-north-up'),
                    materials=materials, facilities=facilities)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')
    triangles = sum(len(p['positions']) // 9 for f in facilities for p in f['primitives'])
    print(json.dumps(dict(output=str(args.output), facilities=len(facilities), productionObjects=len(consumed),
                          materialBuckets=sum(len(f['primitives']) for f in facilities), triangles=triangles,
                          bytes=args.output.stat().st_size, sha256=digest(args.output))))


if __name__ == '__main__':
    main()
