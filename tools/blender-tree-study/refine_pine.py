"""Fixed-budget pine export, run only in background Blender via MCP worker."""
import bpy, hashlib, json, time, sys
from pathlib import Path
from mathutils import Vector

assert bpy.app.background, 'Use start_pine_worker.py through MCP.'
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from pine_meshes import build, material, linear, BUDGET
OUT = ROOT / 'apps/golf/public/models/trees/refined'
EVIDENCE = ROOT / 'docs/graphics/tree-atelier-2026-09-13'
OUT.mkdir(parents=True, exist_ok=True); EVIDENCE.mkdir(parents=True, exist_ok=True)
start = time.monotonic()
scene = bpy.context.scene; scene.name = 'Ghibli | Refined original pine'
for ob in list(scene.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
mats = {'leaf': material('Pine study | Foliage', linear(0x3a6134)), 'bark': material('Pine study | Bark', (1, 1, 1))}
manifest = json.loads((OUT.parent / 'ghibli-v1.json').read_text(encoding='utf-8'))
for s in manifest['species']:
    for variant in s['variants']:
        for rec in variant['tiers'].values():
            rec['file'] = '../' + rec['file']
manifest['design'] = 'refined-original-pine'
manifest['generatorSha256'] = hashlib.sha256((HERE / 'pine_meshes.py').read_bytes()).hexdigest()
manifest['sourceGeneratorSha256'] = hashlib.sha256((HERE / 'ghibli_catalog.py').read_bytes()).hexdigest()
pine = next(s for s in manifest['species'] if s['key'] == 'tall')
report = {'blender': bpy.app.version_string, 'method': 'fixed topology; no subdivision/remesh/decimation', 'budgets': BUDGET, 'variants': []}
def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
for index, variant in enumerate(pine['variants']):
    row = {'seed': variant['seed'], 'tiers': {}}
    for tier in ('hero', 'full', 'lite'):
        assert time.monotonic() - start < 45, 'Build time ceiling exceeded'
        crown, trunk = build(variant['seed'], tier, scene.collection, mats)
        bpy.ops.object.select_all(action='DESELECT'); crown.select_set(True); trunk.select_set(True)
        bpy.context.view_layer.objects.active = crown
        tmp = OUT / '_export.glb'
        bpy.ops.export_scene.gltf(filepath=str(tmp), export_format='GLB', use_selection=True, export_yup=True,
            export_apply=True, export_cameras=False, export_lights=False, export_animations=False,
            export_extras=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
            export_materials='NONE', export_texcoords=False, export_normals=True, export_skins=False, export_morph=False)
        data = tmp.read_bytes(); sha = hashlib.sha256(data).hexdigest(); tmp.replace(OUT / (sha + '.glb'))
        rec = {'file': sha + '.glb', 'sha256': sha, 'bytes': len(data), 'tris': {'crown': triangles(crown), 'trunk': triangles(trunk)}}
        variant['tiers'][tier] = rec; row['tiers'][tier] = rec
        print(f'PINE_PROGRESS {index} {tier}: {rec["tris"]}', flush=True)
        if tier == 'hero':
            for ob in (crown, trunk):
                ob.name = f'Pine study | {index + 1} | ' + ('Crown' if ob == crown else 'Trunk')
                ob.location.x = (index - 1.5) * 18
        else:
            for ob in (crown, trunk):
                me = ob.data; bpy.data.objects.remove(ob, do_unlink=True); bpy.data.meshes.remove(me)
    report['variants'].append(row)
# Old hashed files remain available for pages with the previous manifest.
(OUT / 'ghibli-v3.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
report['buildSeconds'] = round(time.monotonic() - start, 2)
ground = material('Pine study | Warm paper', linear(0xd7d9c5), vertex=False)
bpy.ops.mesh.primitive_plane_add(size=250)
ob = bpy.context.object; ob.name = 'Pine study | Ground'; ob.location.z = -.055; ob.data.materials.append(ground)
world = bpy.data.worlds.new('Pine study | World'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.67, .76, .84, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .55; scene.world = world
light = bpy.data.lights.new('Pine study | Sun', 'SUN'); light.energy = 2.3; light.angle = .15
ob = bpy.data.objects.new(light.name, light); scene.collection.objects.link(ob)
ob.rotation_euler = Vector((14, 16, -28)).to_track_quat('-Z', 'Y').to_euler()
camera = bpy.data.cameras.new('Pine study | Camera'); camera.type = 'ORTHO'; camera.ortho_scale = 79
ob = bpy.data.objects.new(camera.name, camera); scene.collection.objects.link(ob)
ob.location = (17, -90, 29); ob.rotation_euler = (Vector((0, 0, 9)) - ob.location).to_track_quat('-Z', 'Y').to_euler(); scene.camera = ob
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.use_denoising = True
scene.render.resolution_x = 2000; scene.render.resolution_y = 1000; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'Medium High Contrast'
scene.render.filepath = str(EVIDENCE / 'refined-pine-variations.png')
scene['generator'] = str(HERE / 'pine_meshes.py'); scene['preview_url'] = 'http://localhost:5173/tree-study.html'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'; area.spaces.active.shading.type = 'MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE / 'refined-pine.blend'))
(EVIDENCE / 'pine-build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('PINE_BUILD_COMPLETE', flush=True)
