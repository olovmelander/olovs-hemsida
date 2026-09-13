"""Build/export a separate scene using the live Blender MCP. Never clears user scenes.

From repo root:
  python upsalabuild/facilities/blender_mcp_client.py --script tools/blender-tree-study/build_atelier.py --timeout 300
The saved .blend contains only the study scene. Existing unsaved work remains open.
"""
import bpy, json, hashlib, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(r'C:/Users/olov_/repos/olovs-hemsida')
SOURCE = ROOT / 'tools/blender-tree-study/atelier_trees.py'
OUT = ROOT / 'apps/golf/public/models/trees/atelier'
EVIDENCE = ROOT / 'docs/graphics/tree-atelier-2026-09-13'
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
old_files = set(OUT.glob('*.glb'))
ns = {'__name__': 'atelier_trees'}
exec(compile(SOURCE.read_text(encoding='utf-8'), str(SOURCE), 'exec'), ns)
original_scene = bpy.context.window.scene
scene = bpy.data.scenes.new('Ghibli | Tree atelier')
bpy.context.window.scene = scene
collection = scene.collection
materials = {key: ns['material']('Atelier | ' + ns['NAMES'][key], ns['linear'](value)) for key, value in ns['PALETTE'].items()}
materials['bark'] = ns['material']('Atelier | Bark pigment', (1, 1, 1))

def export(objects, destination):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
        export_animations=False, export_extras=False, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_materials='NONE', export_texcoords=False,
        export_normals=True, export_skins=False, export_morph=False)

def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)

def simplify(obj, budget):
    count = triangles(obj)
    if count <= budget:
        return
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Atelier | silhouette budget', 'DECIMATE')
    modifier.ratio = budget / count
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)

manifest = {'schemaVersion': 1, 'kind': 'ghibli-trees', 'design': 'atelier-v2',
            'units': 'metres, y up, base at 0',
            'colour': 'Crown COLOR_0 is a warm/cool pigment multiplier; trunk COLOR_0 is linear bark colour.',
            'generatorSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'species': []}
display = []
try:
    for index, key in enumerate(ns['PALETTE']):
        species = {'key': key, 'name': ns['NAMES'][key], 'variants': []}
        for variant in range(4):
            seed = 21000 + index * 1000 + variant * 37
            record = {'seed': seed, 'tiers': {}}
            for tier in ('hero', 'full', 'lite'):
                c, t, height = ns['build'](key, seed, tier, collection, materials)
                budget = {'hero': (11000, 1800), 'full': (2500, 450), 'lite': (650, 120)}[tier]
                simplify(c, budget[0]); simplify(t, budget[1])
                # Stable exact node names, independent of what the user has open.
                conflicts = []
                for ob, name in ((c, 'crown'), (t, 'trunk')):
                    conflict = bpy.data.objects.get(name)
                    if conflict is not None and conflict != ob:
                        conflicts.append((conflict, name))
                        conflict.name = name + ' | existing'
                    ob.name = name
                tmp = OUT / '_export.glb'
                try:
                    export([c, t], tmp)
                finally:
                    c.name = 'Atelier | Export crown'
                    t.name = 'Atelier | Export trunk'
                    for conflict, name in conflicts:
                        conflict.name = name
                data = tmp.read_bytes(); sha = hashlib.sha256(data).hexdigest()
                final = OUT / (sha + '.glb')
                tmp.replace(final)
                record['tiers'][tier] = {'file': final.name, 'sha256': sha, 'bytes': len(data),
                    'tris': {'crown': triangles(c), 'trunk': triangles(t)}}
                points = [v.co for ob in (c, t) for v in ob.data.vertices]
                if tier == 'hero':
                    record['templateHeight'] = round(max(p.z for p in points), 4)
                    record['templateRadius'] = round(max(max(abs(p.x), abs(p.y)) for p in points), 4)
                if variant == 0 and tier == 'hero':
                    x = (index - 2) * 12
                    for ob in (c, t):
                        ob.name = f'Atelier | {key} | ' + ('crown' if ob == c else 'trunk')
                        ob.location.x = x
                    display.append((key, c, t))
                else:
                    for ob in (c, t):
                        mesh = ob.data
                        bpy.data.objects.remove(ob, do_unlink=True)
                        if mesh.users == 0:
                            bpy.data.meshes.remove(mesh)
            species['variants'].append(record)
        manifest['species'].append(species)
    (OUT / 'ghibli-v2.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    referenced = {OUT / rec['file'] for s in manifest['species'] for v in s['variants'] for rec in v['tiers'].values()}
    for old in old_files - referenced:
        if old.resolve().parent == OUT.resolve() and len(old.stem) == 64:
            old.unlink()
    # A neutral botanical presentation scene; exported meshes are the same ones shown here.
    ground = ns['material']('Atelier | Warm paper', ns['linear'](0xd5d8bc), vertex=False)
    bpy.ops.mesh.primitive_plane_add(size=200)
    plane = bpy.context.object; plane.name = 'Atelier | Ground'; plane.data.materials.append(ground)
    plane.location.z = -.045
    world = bpy.data.worlds.new('Atelier | Daylight'); world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .74, .84, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .45
    scene.world = world
    light = bpy.data.lights.new('Atelier | Broad sunlight', 'AREA'); light.energy = 5200; light.shape = 'DISK'; light.size = 18
    sun = bpy.data.objects.new(light.name, light); collection.objects.link(sun); sun.location = (-22, -18, 34)
    sun.rotation_euler = (Vector((0, 0, 7)) - sun.location).to_track_quat('-Z', 'Y').to_euler()
    daylight = bpy.data.lights.new('Atelier | Sun', 'SUN'); daylight.energy = 2.1; daylight.angle = math.radians(14)
    sun2 = bpy.data.objects.new(daylight.name, daylight); collection.objects.link(sun2); sun2.rotation_euler = sun.rotation_euler
    camera_data = bpy.data.cameras.new('Atelier | Botanical camera'); camera_data.type = 'ORTHO'; camera_data.ortho_scale = 66
    camera = bpy.data.objects.new(camera_data.name, camera_data); collection.objects.link(camera)
    camera.location = (24, -95, 35); camera.rotation_euler = (Vector((0, 0, 7.2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 32; scene.cycles.use_denoising = True
    scene.render.resolution_x = 2200; scene.render.resolution_y = 1050; scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'Medium High Contrast'
    scene.view_settings.exposure = 0; scene.view_settings.gamma = 1
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(EVIDENCE / 'blender-five-species.png')
    scene['generator'] = str(SOURCE)
    scene['preview_url'] = 'http://localhost:5173/tree-study.html'
    bpy.ops.object.select_all(action='DESELECT')
    for _, crown, trunk in display:
        crown.select_set(True); trunk.select_set(True)
    bpy.context.view_layer.objects.active = display[1][1]
    # Library write saves a self-contained study without renaming/saving user work.
    bpy.data.libraries.write(str(EVIDENCE / 'ghibli-tree-atelier.blend'), {scene}, fake_user=True, compress=True)
    (EVIDENCE / 'build-report.json').write_text(json.dumps({'blender': bpy.app.version_string,
        'transport': 'Blender MCP localhost:9876', 'originalScene': original_scene.name,
        'scene': scene.name, 'manifest': str(OUT / 'ghibli-v2.json'),
        'species': [{'key': s['key'], 'variants': len(s['variants']), 'triangles': s['variants'][0]['tiers']} for s in manifest['species']]}, indent=2), encoding='utf-8')
    print('ATELIER_COMPLETE ' + json.dumps({'scene': scene.name, 'files': 60,
        'bytes': sum(t['bytes'] for s in manifest['species'] for v in s['variants'] for t in v['tiers'].values())}))
finally:
    bpy.context.window.scene = original_scene
