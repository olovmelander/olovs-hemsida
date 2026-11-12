"""Review renders of a v3 golfer, on the CPU.

  blender --background docs/graphics/golfer-2026-11-07/banvy-golfer-v3-female.blend \
      --python tools/blender-golfer/v3/review_v3.py -- female output/golfer-build/review [shot ...] [--samples 32]

Cycles on the CPU with a fixed thread count, so a review never wakes the GPU.
Each shot poses the rig from a baked clip at a time, shows that clip's club and
frames a bone. The same shots are used before and after a change.

build_v3.py can call render() in-process after a build (--review).
"""
import bpy, sys, json, math
from pathlib import Path
from mathutils import Vector as V, Matrix

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

# name: clip, time (s, or a manifest key such as 'impact'), bone, height offset, distance, azimuth, elevation, lens, size
# Azimuth 0 looks at the golfer's face (the camera stands at -Y); +90 is from the golfer's left (+X).
SHOTS = {
    'face':        ('Idle', .30, 'Head', .045, .98, 8, 0, 110, (720, 800)),
    'face-34':     ('Idle', .30, 'Head', .045, 1.0, 38, 2, 110, (720, 800)),
    'face-side':   ('Idle', .30, 'Head', .045, 1.0, 88, 0, 110, (720, 800)),
    'eyes':        ('Idle', .30, 'Head', .075, .52, 6, 0, 110, (800, 520)),
    'head-back':   ('Idle', .30, 'Head', -.02, 1.25, 168, 6, 110, (720, 900)),
    'head-side':   ('Idle', .30, 'Head', .03, 1.1, 96, 4, 110, (720, 800)),
    'head-back-34': ('Idle', .30, 'Head', -.02, 1.25, 140, 10, 110, (720, 900)),
    'portrait':    ('Idle', .30, 'UpperChest', .13, 1.25, 24, 4, 70, (720, 880)),
    'full-front':  ('Idle', .30, 'Hips', -.02, 3.9, 18, 6, 70, (620, 980)),
    'full-back':   ('Idle', .30, 'Hips', -.02, 3.9, 160, 8, 70, (620, 980)),
    'full-side':   ('Idle', .30, 'Hips', -.02, 3.9, 90, 5, 70, (620, 980)),
    'torso':       ('Idle', .30, 'Chest', .0, 1.55, 20, 4, 70, (760, 800)),
    'torso-back':  ('Idle', .30, 'Chest', .0, 1.55, 165, 6, 70, (760, 800)),
    'torso-side':  ('Idle', .30, 'Chest', .0, 1.55, 82, 4, 70, (760, 800)),
    'chest':       ('Idle', .30, 'UpperChest', -.03, .85, 14, 2, 85, (860, 720)),
    # REST is the rig's rest pose (the A-pose the garments are cut and draped in).
    'rest-front':  ('REST', 0, 'Hips', .0, 4.0, 14, 5, 70, (760, 980)),
    'rest-back':   ('REST', 0, 'Hips', .0, 4.0, 166, 6, 70, (760, 980)),
    'rest-torso':  ('REST', 0, 'Chest', .0, 1.6, 16, 3, 70, (860, 800)),
    'rest-chest':  ('REST', 0, 'UpperChest', -.03, .85, 14, 2, 85, (860, 720)),
    'rest-side':   ('REST', 0, 'Chest', -.1, 2.0, 86, 3, 70, (760, 900)),
    'rest-legs':   ('REST', 0, 'Hips', -.45, 2.3, 18, 4, 70, (700, 940)),
    'rest-legs-back': ('REST', 0, 'Hips', -.45, 2.3, 164, 5, 70, (700, 940)),
    'legs':        ('Idle', .30, 'Hips', -.48, 2.1, 22, 4, 70, (640, 900)),
    'shoes':       ('REST', 0, 'Foot_L', -.03, 1.0, 40, 22, 70, (860, 560)),
    'shoes-back':  ('REST', 0, 'Foot_L', -.03, 1.0, 150, 20, 70, (860, 560)),
    'collar':      ('REST', 0, 'Neck', -.03, .8, 16, 14, 85, (860, 640)),
    'glove':       ('REST', 0, 'Hand_L', -.05, .5, 60, 10, 85, (760, 700)),
    'glove-back':  ('REST', 0, 'Hand_L', -.05, .5, 110, 20, 85, (760, 700)),
    'collar-back': ('REST', 0, 'Neck', -.03, .8, 165, 16, 85, (860, 640)),
    'collar-side': ('REST', 0, 'Neck', -.03, .8, 80, 12, 85, (860, 640)),
    'belt':        ('REST', 0, 'Hips', .1, .75, 10, 8, 85, (860, 560)),
    'cap':         ('REST', 0, 'Head', .08, .85, 30, 12, 85, (800, 700)),
    'cap-back':    ('REST', 0, 'Head', .08, .85, 160, 14, 85, (800, 700)),
    'address':     ('AddressIron', 1.2, 'Hips', -.05, 3.6, 0, 6, 70, (760, 900)),
    'address-dtl': ('AddressIron', 1.2, 'Hips', -.05, 3.8, -90, 6, 70, (760, 900)),
    'hands':       ('AddressIron', 1.2, 'Hand_L', -.01, .62, 14, 18, 85, (760, 700)),
    'top':         ('SwingIron', 'top', 'Hips', .05, 3.8, 0, 6, 70, (760, 940)),
    'impact':      ('SwingDriver', 'impact', 'Hips', -.05, 3.8, 0, 6, 70, (820, 900)),
    'finish':      ('SwingIron', 'finish', 'Hips', .05, 3.8, 14, 6, 70, (760, 940)),
    'finish-back': ('SwingDriver', 'finish', 'Hips', .05, 3.9, -150, 8, 70, (760, 940)),
    'walk':        ('Walk', .28, 'Hips', -.02, 3.9, 78, 5, 70, (620, 980)),
    'putt':        ('Putt', 'impact', 'Hips', -.1, 3.2, 0, 8, 70, (760, 900)),
    'celebrate':   ('Celebrate', 1.05, 'Hips', .12, 4.2, 12, 4, 70, (700, 980)),
    'celebrate-face': ('Celebrate', 1.9, 'Head', .08, .8, 14, 2, 100, (720, 800)),
    'address-face': ('AddressIron', 1.2, 'Head', .05, .8, 20, -24, 100, (720, 800)),
}
DEFAULT = ['face', 'face-34', 'portrait', 'full-front', 'full-back', 'address', 'top', 'finish']


def look_at(cam, eye, target):
    d = (target - eye).normalized()
    up = V((0, 0, 1))
    right = d.cross(up).normalized()
    true_up = right.cross(d)
    m = Matrix((right, true_up, -d)).transposed().to_4x4()
    m.translation = eye
    cam.matrix_world = m


def studio(scene, collection):
    """A daylight studio: a soft sky, a warm key, a cool rim and a turf-coloured floor."""
    world = bpy.data.worlds.new('Golfer review | world'); world.use_nodes = True
    nt = world.node_tree; bg = nt.nodes['Background']
    grad = nt.nodes.new('ShaderNodeTexGradient'); tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    ramp.color_ramp.elements[0].position = .46; ramp.color_ramp.elements[0].color = (.46, .50, .42, 1)
    ramp.color_ramp.elements[1].position = .56; ramp.color_ramp.elements[1].color = (.62, .76, .94, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = .85
    scene.world = world
    made = []
    def light(name, kind, energy, colour, loc, target, size=1.0):
        data = bpy.data.lights.new(name, kind); data.energy = energy; data.color = colour
        if kind == 'AREA':
            data.size = size
        if kind == 'SUN':
            data.angle = math.radians(3)
        ob = bpy.data.objects.new(name, data); collection.objects.link(ob)
        look_at(ob, V(loc), V(target)); made.append(ob)
        return ob
    light('Review key', 'SUN', 3.4, (1.0, .95, .86), (2.2, -3.2, 4.2), (0, 0, 1.1))
    light('Review fill', 'AREA', 230, (.86, .92, 1.0), (-3.0, -2.6, 1.7), (0, 0, 1.2), 3.0)
    light('Review rim', 'AREA', 320, (1.0, .97, .92), (-1.8, 3.2, 2.8), (0, 0, 1.3), 1.6)
    me = bpy.data.meshes.new('Review floor')
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new('Review floor', me); collection.objects.link(floor)
    mat = bpy.data.materials.new('Review floor'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (.22, .27, .16, 1); b.inputs['Roughness'].default_value = .95
    me.materials.append(mat); made.append(floor)
    return made


def configure(scene, samples, threads):
    scene.render.engine = 'CYCLES'
    c = scene.cycles
    c.device = 'CPU'; c.samples = samples; c.use_adaptive_sampling = True; c.adaptive_threshold = .03
    c.use_denoising = True
    try:
        c.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    c.max_bounces = 4; c.diffuse_bounces = 2; c.glossy_bounces = 2; c.transparent_max_bounces = 8
    scene.render.threads_mode = 'FIXED'; scene.render.threads = threads
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGB'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0; scene.view_settings.gamma = 1
    scene.render.use_persistent_data = False


def clip_times(variant):
    name = 'golfer.json' if variant == 'female' else 'golfer-male.json'
    path = ROOT / 'experiments/golfer/assets' / name
    out = {}
    if path.exists():
        for c in json.loads(path.read_text(encoding='utf-8'))['clips']:
            out[c['name']] = c
    return out


def resolve_time(clip, t, manifest):
    if not isinstance(t, str):
        return float(t)
    c = manifest.get(clip, {})
    impact = c.get('impact', 1.0)
    if t == 'impact':
        return impact
    if t == 'top':
        return max(0.0, impact - .30)
    if t == 'finish':
        return min(c.get('duration', impact + 1.4) - .05, impact + 1.15)
    raise KeyError(t)


def render(variant, outdir, shots=None, samples=32, threads=4, rig=None, scale=1.0, manifest=None):
    scene = bpy.context.scene
    rig = rig or next(o for o in scene.objects if o.type == 'ARMATURE')
    col = bpy.data.collections.new('Golfer review'); scene.collection.children.link(col)
    made = studio(scene, col)
    configure(scene, samples, threads)
    cam_data = bpy.data.cameras.new('Review camera'); cam = bpy.data.objects.new('Review camera', cam_data)
    col.objects.link(cam); scene.camera = cam
    cam_data.sensor_width = 36; cam_data.clip_start = .02; cam_data.clip_end = 200
    manifest = manifest or clip_times(variant)
    actions = {a.get('clip_name'): a for a in bpy.data.actions if a.get('clip_name') and a.get('banvy_character', variant) == variant}
    clubs = [o for o in scene.objects if o.get('club_id')]
    outdir = Path(outdir).resolve(); outdir.mkdir(parents=True, exist_ok=True)
    fps = scene.render.fps = 60
    rig.animation_data_create()
    done = []
    for name in shots or DEFAULT:
        clip, t, bone, lift, dist, az, el, lens, size = SHOTS[name]
        action = actions.get(clip)
        if action is None and clip != 'REST':
            print('REVIEW skip', name, '(no clip', clip + ')'); continue
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action = action
        if action is None:
            for pb_ in rig.pose.bones:
                pb_.matrix_basis.identity()
            scene.frame_set(0)
        else:
            if action.slots:
                rig.animation_data.action_slot = action.slots[0]
            seconds = resolve_time(clip, t, manifest)
            scene.frame_set(int(round(seconds * fps)))
        want = manifest.get(clip, {}).get('club', 'Iron')
        for ob in clubs:
            ob.hide_render = ob['club_id'] != want
        bpy.context.view_layer.update()
        pb = rig.pose.bones[bone]
        target = rig.matrix_world @ pb.head + V((0, 0, lift))
        a = math.radians(az); e = math.radians(el)
        eye = target + V((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        eye.z = max(eye.z, .08)
        look_at(cam, eye, target)
        cam_data.lens = lens
        scene.render.resolution_x = int(size[0] * scale); scene.render.resolution_y = int(size[1] * scale)
        scene.render.resolution_percentage = 100
        path = outdir / f'{variant}-{name}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        done.append(path.name); print('REVIEW', path.name)
    for ob in made + [cam]:
        bpy.data.objects.remove(ob, do_unlink=True)
    for ob in clubs:
        ob.hide_render = False
    return done


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    samples = 32; scale = 1.0
    if '--samples' in argv:
        i = argv.index('--samples'); samples = int(argv[i + 1]); del argv[i:i + 2]
    if '--scale' in argv:
        i = argv.index('--scale'); scale = float(argv[i + 1]); del argv[i:i + 2]
    variant = argv[0] if argv else 'female'
    outdir = argv[1] if len(argv) > 1 else str(ROOT / 'output/golfer-build/review')
    shots = argv[2:] or None
    print('REVIEW done', render(variant, outdir, shots, samples, scale=scale))
