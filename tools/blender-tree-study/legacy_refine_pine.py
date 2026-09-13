"""Superseded first pine refinement; retained for reference only.

Reuses the original seed, branching recipe and canopy arrangement. Only the
crown surface resolution, small edge irregularities and bark treatment change.
Other species in this preview refer to the original, unmodified assets.
"""
import bpy, bmesh, ast, math, random, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix, noise

ROOT = Path(r'C:/Users/olov_/repos/olovs-hemsida')
HERE = ROOT / 'tools/blender-tree-study'
OUT = ROOT / 'apps/golf/public/models/trees/refined'
EVIDENCE = ROOT / 'docs/graphics/tree-atelier-2026-09-13'
OUT.mkdir(parents=True, exist_ok=True)
old_files = set(OUT.glob('*.glb'))
original = bpy.context.window.scene
scene = bpy.data.scenes.new('Ghibli | Refined original pine')
bpy.context.window.scene = scene
coll = scene.collection
helpers = {'__name__': 'atelier_helpers'}
exec(compile((HERE / 'atelier_trees.py').read_text(encoding='utf-8'), 'atelier_trees.py', 'exec'), helpers)
leaf_mat = helpers['material']('Refined pine | Foliage', helpers['linear'](0x3a6134))
bark_mat = helpers['material']('Refined pine | Bark', (1, 1, 1))
ns = dict(bpy=bpy, bmesh=bmesh, math=math, random=random, Vector=Vector, Matrix=Matrix, noise=noise,
          coll=coll, _lodcount=[0], M={'pine': leaf_mat, 'bark': bark_mat, 'pinebark': bark_mat})
# Load definitions only. The original script's scene creation and rendering
# statements are intentionally never executed in the user's Blender session.
source = (HERE / 'ghibli_catalog.py').read_text(encoding='utf-8')
tree = ast.parse(source)
functions = {'lod_keep', 'new_obj', 'finish_crown', 'tris', 'tube', 'clump', 'U', 'pine'}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in functions:
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'ghibli_catalog.py', 'exec'), ns)
    elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'LOD_TIERS' for t in node.targets):
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'ghibli_catalog.py', 'exec'), ns)
base_clump = ns['clump']

def refined_clump(bm, c, rx, ry, rz, seed, sub=2, amp=.1, undercut=.7):
    # Retain the large connected crown forms. Extra vertices go into a subtle
    # scalloped edge, not into adding separate spherical foliage clusters.
    before = set(bm.verts)
    base_clump(bm, c, rx, ry, rz, seed, sub=3 if TIER == 'hero' else 2,
               amp=amp, undercut=min(.70, undercut + .12))
    for vert in set(bm.verts) - before:
        d = vert.co - c
        unit = Vector((d.x / max(rx, .01), d.y / max(ry, .01), d.z / max(rz, .01)))
        n = noise.noise(unit * 7 + Vector((seed * .21, seed * .13, seed * .07)))
        vert.co += d * n * .038

ns['clump'] = refined_clump
manifest = json.loads((OUT.parent / 'ghibli-v1.json').read_text(encoding='utf-8'))
for sp in manifest['species']:
    for variant in sp['variants']:
        for rec in variant['tiers'].values():
            rec['file'] = '../' + rec['file']
manifest['design'] = 'refined-original-pine'
manifest['generatorSha256'] = hashlib.sha256((HERE / 'refine_pine.py').read_bytes()).hexdigest()
manifest['sourceGeneratorSha256'] = hashlib.sha256(source.encode()).hexdigest()
pine = next(s for s in manifest['species'] if s['key'] == 'tall')
display = []

def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def decimate(ob, budget):
    if tris(ob) <= budget:
        return
    bpy.context.view_layer.objects.active = ob
    modifier = ob.modifiers.new('Refined pine | LOD', 'DECIMATE')
    modifier.ratio = budget / tris(ob); modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)

try:
    for index, variant in enumerate(pine['variants']):
        for TIER in ('hero', 'full', 'lite'):
            ns['LOD'] = {**ns['LOD_TIERS']['hero'], 'sub': 3 if TIER == 'hero' else 2}
            ns['_lodcount'][0] = 0
            before = set(scene.objects)
            crown, trunk, H = ns['pine']((0, 0, 0), variant['seed'], {'height': (14, 24), 'crown_from': (.5, .66)})
            objects = [o for o in scene.objects if o not in before]
            trunks = [o for o in objects if o != crown]
            # A continuous bark palette removes the old stripe at each tube.
            for ob in trunks:
                attr = ob.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='POINT')
                for i, v in enumerate(ob.data.vertices):
                    f = helpers['clamp']((v.co.z / H - .26) / .46)
                    a, b = helpers['linear'](0x756650), helpers['linear'](0xae7954)
                    grain = .92 + .08 * math.sin(v.co.x * 13 + v.co.y * 11 + v.co.z * .45)
                    attr.data[i].color = (*(grain * (aa + (bb - aa) * f) for aa, bb in zip(a, b)), 1)
                ob.data.color_attributes.active_color = attr
            crown.data.color_attributes['Depth'].name = 'Paint'
            crown.data.color_attributes.active_color = crown.data.color_attributes['Paint']
            budget = {'hero': (9500, 900), 'full': (2200, 240), 'lite': (570, 65)}[TIER]
            decimate(crown, budget[0])
            for ob in trunks:
                decimate(ob, budget[1])
            # Use the original source heights/radii so the course comparison
            # cannot accidentally change the footprint while improving surfaces.
            conflicts = []
            for i, ob in enumerate([crown] + trunks):
                name = 'crown' if i == 0 else f'trunk{i}'
                conflict = bpy.data.objects.get(name)
                if conflict and conflict != ob:
                    conflicts.append((conflict, name)); conflict.name = 'Refined pine | Temporary name'
                ob.name = name
            bpy.ops.object.select_all(action='DESELECT')
            for ob in objects:
                ob.select_set(True)
            bpy.context.view_layer.objects.active = crown
            tmp = OUT / '_export.glb'
            try:
                bpy.ops.export_scene.gltf(filepath=str(tmp), export_format='GLB', use_selection=True, export_yup=True,
                    export_apply=True, export_cameras=False, export_lights=False, export_animations=False,
                    export_extras=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                    export_materials='NONE', export_texcoords=False, export_normals=True, export_skins=False, export_morph=False)
            finally:
                for i, ob in enumerate(objects):
                    ob.name = f'Refined pine | {index + 1} | {i}'
                for ob, name in conflicts:
                    ob.name = name
            data = tmp.read_bytes(); sha = hashlib.sha256(data).hexdigest()
            tmp.replace(OUT / (sha + '.glb'))
            variant['tiers'][TIER] = {'file': sha + '.glb', 'sha256': sha, 'bytes': len(data),
                'tris': {'crown': tris(crown), 'trunk': sum(tris(t) for t in trunks)}}
            if TIER == 'hero':
                for ob in objects:
                    ob.location.x = (index - 1.5) * 16
                display.extend(objects)
            else:
                for ob in objects:
                    mesh = ob.data; bpy.data.objects.remove(ob, do_unlink=True)
                    if mesh.users == 0:
                        bpy.data.meshes.remove(mesh)
    (OUT / 'ghibli-v3.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    referenced = {(OUT / t['file']).resolve() for s in manifest['species'] for v in s['variants'] for t in v['tiers'].values()}
    for old in old_files:
        if old.resolve().parent == OUT.resolve() and old.resolve() not in referenced and len(old.stem) == 64:
            old.unlink()
    # Reuse only presentation objects from the study, never the rejected trees.
    studio = next((s for s in reversed(list(bpy.data.scenes)) if s.name.startswith('Ghibli | Tree atelier')), None)
    if studio:
        scene.world = studio.world.copy()
        for obj in studio.objects:
            if obj.type in ('LIGHT', 'CAMERA') or obj.name.startswith('Atelier | Ground'):
                copy = obj.copy(); copy.data = obj.data.copy(); coll.objects.link(copy)
                if copy.type == 'CAMERA':
                    scene.camera = copy; copy.data.ortho_scale = 76
        scene.render.engine = 'CYCLES'; scene.cycles.samples = 32; scene.cycles.use_denoising = True
        scene.render.resolution_x = 2000; scene.render.resolution_y = 1000; scene.render.resolution_percentage = 100
        scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'Medium High Contrast'
    scene['generator'] = str(HERE / 'refine_pine.py')
    scene.render.filepath = str(EVIDENCE / 'refined-pine-variations.png')
    bpy.data.libraries.write(str(EVIDENCE / 'refined-pine.blend'), {scene}, fake_user=True, compress=True)
    print('REFINED_PINE_COMPLETE ' + json.dumps({'scene': scene.name, 'variants': 4,
          'triangles': [v['tiers']['hero']['tris'] for v in pine['variants']]}))
finally:
    bpy.context.window.scene = original
