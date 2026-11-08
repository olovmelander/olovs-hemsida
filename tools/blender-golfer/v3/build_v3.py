"""Build a Banvy golfer, revision 3, headless.

  blender --background --factory-startup --python tools/blender-golfer/v3/build_v3.py -- female [--clips Idle,Walk] [--no-outfit]

Writes experiments/golfer/assets/banvy-golfer-v3-<variant>.glb and
golfer-v3-<variant>.json, and the editable native file
docs/graphics/golfer-2026-11-07/banvy-golfer-v3-<variant>.blend.
"""
import bpy, sys, json, time
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[2]
OUT = ROOT / 'docs/graphics/golfer-2026-11-07'

import assemble_v3, bake_v3

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
variant = argv[0] if argv else 'female'
clip_names = None
if '--clips' in argv:
    clip_names = argv[argv.index('--clips') + 1].split(',')
outfit = '--no-outfit' not in argv
save_blend = '--no-blend' not in argv

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = f'Banvy | Golfer v3 {variant}'
scene.unit_settings.system = 'METRIC'
col = bpy.data.collections.new(f'Golfer v3 | {variant}')
scene.collection.children.link(col)
G = assemble_v3.build(variant, col)
G['cage']['golfer_source'] = True; G['source']['golfer_source'] = True
extra = {}
if outfit:
    import outfit_v3
    extra.update(outfit_v3.dress(G, col))
else:
    import outfit_v3
    outfit_v3.plain_materials(G)
actions, clips, report = bake_v3.bake_all(G, scene, clip_names)
# Revision 3 takes the lab's canonical names, so the runtime loads it unchanged;
# the September golfers live on in experiments/golfer/assets/v1 (?golferset=v1).
stem = 'banvy-golfer' if variant == 'female' else 'banvy-golfer-male'
manifest = bake_v3.export(G, scene, actions, clips, report, stem, 'golfer.json' if variant == 'female' else 'golfer-male.json',
                          dict(design=G.get('design', ''), palette='Coral & royal blue' if variant == 'female' else 'Cobalt & stone',
                               source=dict(asset=f'Blender Studio Human Base Meshes v1.4.1 - realistic {variant}',
                                           license='CC0', url='https://download.blender.org/demo/asset-bundles/human-base-meshes/'),
                               status='revision 3: realistic anatomy, fitted rig, kinematic-sequence motion'))
if save_blend:
    OUT.mkdir(parents=True, exist_ok=True)
    G['rig']['design'] = G.get('design', '')
    # The sculpt source and fitting cage are rebuilt from the CC0 bundle; leave them out.
    for ob in (G['source'], G['cage']):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'banvy-golfer-v3-{variant}.blend'), compress=True)
print('BUILD ' + json.dumps(dict(variant=variant, seconds=round(time.time() - t0, 1), bytes=manifest['bytes'],
                                 clips=len(clips), triangles=manifest['triangles'])))
