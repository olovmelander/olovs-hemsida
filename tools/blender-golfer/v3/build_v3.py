"""Build a Banvy golfer, revision 3, headless.

  blender --background --factory-startup --python tools/blender-golfer/v3/build_v3.py -- female [--clips Idle,Walk] [--no-outfit]
      [--no-export] [--no-blend] [--review <dir> [shot,shot]] [--review-samples 32] [--audit-only]

--no-export builds and bakes without writing the GLB, manifest or native file (for
iterating); --review renders review_v3's shots on the CPU from the built scene.
Every build audits its own motion on the CPU (audit_cpu_v3.py), measures the carried
club against the posed outfit (carry_v3.py), and fails the export if a check fails;
--audit-only skips the outfit and the export and writes the report.
GOLFER_FAST=1 skips the skin and eye bakes; GOLFER_PARTS=polo,trousers builds only
those outfit steps.

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
audit_only = '--audit-only' in argv
if audit_only:
    # The audit measures the shoes' soles: build those, and nothing that takes time.
    import os
    os.environ['GOLFER_PARTS'] = 'shoes'; os.environ['GOLFER_FAST'] = '1'; os.environ['GOLFER_NO_SHADE'] = '1'
outfit = '--no-outfit' not in argv
do_export = '--no-export' not in argv and not audit_only
save_blend = '--no-blend' not in argv and do_export
review_dir = None; review_shots = None; review_samples = 32
if '--review' in argv:
    i = argv.index('--review'); review_dir = argv[i + 1]
    if i + 2 < len(argv) and not argv[i + 2].startswith('--'):
        review_shots = argv[i + 2].replace('+', ',').split(',')     # a+b too: PowerShell splits on commas
if '--review-samples' in argv:
    review_samples = int(argv[argv.index('--review-samples') + 1])

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
import audit_cpu_v3
audit = audit_cpu_v3.audit(G, clips, bake_v3.pose_sampler(G))
turns = audit_cpu_v3.directions(G, clips)
audit['directions'] = turns
# The carried club rests on the shoulder: measured on the posed outfit (carry_v3.py) during the bake.
import carry_v3
audit['carry'] = G.get('carry', {})
for name, r in audit['carry'].items():
    if r['depth_mm'] > carry_v3.LIMIT * 1000:
        audit['failures'].append(f"{name}: the carried club goes {r['depth_mm']} mm into the {r['part']} (frame {r['frame']})")
        audit['passed'] = False
audit_dir = ROOT / 'output/golfer-build/audit'
audit_dir.mkdir(parents=True, exist_ok=True)
(audit_dir / f'motion-{variant}.json').write_text(json.dumps(audit, indent=1), encoding='utf-8')
print('AUDIT ' + json.dumps(dict(variant=variant, clips=len(audit['motions']), passed=audit['passed'] and turns['passed'],
                                 failures=audit['failures'] + turns['failures'])))
if audit_only:
    sys.exit(0 if audit['passed'] and turns['passed'] else 3)
# Revision 3 takes the lab's canonical names, so the runtime loads it unchanged;
# the September golfers live on in experiments/golfer/assets/v1 (?golferset=v1).
stem = 'banvy-golfer' if variant == 'female' else 'banvy-golfer-male'
if review_dir:
    import review_v3
    for ob in (G['source'], G['cage']):
        ob.hide_render = True
    by_name = {c['name']: c for c in clips}
    stills = [s for s in (review_shots or review_v3.DEFAULT) if not s.startswith('strip:')]
    if stills:
        review_v3.render(variant, review_dir, stills, review_samples, rig=G['rig'], manifest=by_name)
    # strip:Clip:view (a contact sheet of eight poses), e.g. strip:Walk:side
    for s in (review_shots or []):
        if s.startswith('strip:'):
            _, clip, *view = s.split(':')
            review_v3.strip(variant, review_dir, clip, view[0] if view else 'front', rig=G['rig'], manifest=by_name)
if not do_export:
    print('BUILD ' + json.dumps(dict(variant=variant, seconds=round(time.time() - t0, 1), export=False, clips=len(clips))))
    sys.exit(0)
if not (audit['passed'] and turns['passed']) and '--allow-failures' not in argv:
    raise SystemExit('The motion audit failed; nothing was exported (--allow-failures exports anyway).')
manifest = bake_v3.export(G, scene, actions, clips, report, stem, 'golfer.json' if variant == 'female' else 'golfer-male.json',
                          dict(design=G.get('design', ''), palette='Coral & royal blue' if variant == 'female' else 'Cobalt & stone',
                               source=dict(asset=f'Blender Studio Human Base Meshes v1.4.1 - realistic {variant}',
                                           license='CC0', url='https://download.blender.org/demo/asset-bundles/human-base-meshes/'),
                               status='revision 3, round 4: draped cloth, painted skin, face rig, kinematic-sequence motion',
                               cpuAudit=dict(sampleHz=120, clips=len(audit['motions']), passed=bool(audit['passed'] and turns['passed']),
                                             checks='audit_cpu_v3.py')))
if save_blend:
    OUT.mkdir(parents=True, exist_ok=True)
    G['rig']['design'] = G.get('design', '')
    # The sculpt source and fitting cage are rebuilt from the CC0 bundle; leave them out.
    for ob in (G['source'], G['cage']):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0     # no .blend1 backup beside the checked-in file
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'banvy-golfer-v3-{variant}.blend'), compress=True)
print('BUILD ' + json.dumps(dict(variant=variant, seconds=round(time.time() - t0, 1), bytes=manifest['bytes'],
                                 clips=len(clips), triangles=manifest['triangles'])))
