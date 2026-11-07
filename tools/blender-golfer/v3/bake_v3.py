"""Bake every clip at 60 fps, simulate the braid, export the GLB and manifest.

Run headless from the repository root:
  blender --background --factory-startup --python tools/blender-golfer/v3/build_v3.py -- female
"""
import bpy, json, math, hashlib, struct
from pathlib import Path
from mathutils import Vector as V, Matrix
from rig_math import bake_action, frame, mat4, clamp, smooth
import clips_v3

FPS = 60
ROOT = Path(__file__).resolve().parents[3]
ASSET = ROOT / 'experiments/golfer/assets'


class Braid:
    """A damped verlet chain hanging from the head, kept off the head and back."""

    def __init__(self, skel):
        self.s = skel
        self.names = [n for n in skel.order if n.startswith('Braid')]
        self.on = bool(self.names)
        if not self.on:
            return
        self.rest_pts = [skel.head[n].copy() for n in self.names] + [skel.tail[self.names[-1]].copy()]
        self.lengths = [skel.length[n] for n in self.names]
        hr = skel.rest['Head'].inverted()
        self.local = [hr @ p for p in self.rest_pts]
        self.head_c_local = hr @ (skel.head['Head'] + V((0, .01, .09)))
        self.stiff = [1.0, .14, .045, .018, .009, .005, .003]

    def run(self, poses, loop):
        if not self.on:
            return poses
        n = len(poses); dt = 1 / FPS; sub = 4; h = dt / sub
        g = V((0, 0, -9.81))
        def targets(pose):
            H = pose['Head']; return [H @ p for p in self.local], H @ self.head_c_local, pose['UpperChest']
        pts0, _, _ = targets(poses[0])
        x = [p.copy() for p in pts0]; xp = [p.copy() for p in pts0]
        passes = 3 if loop else 1
        out = None
        seq = list(range(n))
        warm = [0] * (FPS if not loop else 0)
        for pas in range(passes):
            frames = (warm if pas == 0 else []) + seq
            result = []
            for f in frames:
                tgt, centre, chest = targets(poses[f])
                for _ in range(sub):
                    for i in range(1, len(x)):
                        v = (x[i] - xp[i]) * .965
                        xp[i] = x[i].copy()
                        x[i] = x[i] + v + g * h * h
                    x[0] = tgt[0].copy(); xp[0] = tgt[0].copy()
                    for _it in range(3):
                        for i in range(1, len(x)):
                            # Shape memory: the braid keeps its sweep near the head.
                            x[i] = x[i].lerp(tgt[i], self.stiff[i] * .35)
                            d = x[i] - x[i - 1]; L = self.lengths[i - 1]
                            if d.length > 1e-6:
                                x[i] = x[i - 1] + d.normalized() * L
                            # Off the head and the upper back.
                            r = x[i] - centre
                            if r.length < .118:
                                x[i] = centre + r.normalized() * .118
                        # A braid bends, it does not fold: at most 32 degrees per joint.
                        for i in range(2, len(x)):
                            prev = x[i - 1] - x[i - 2]; d = x[i] - x[i - 1]
                            if prev.length > 1e-6 and d.length > 1e-6:
                                ang = prev.angle(d)
                                if ang > .56:
                                    d = prev.normalized().slerp(d.normalized(), .56 / ang) * d.length
                                    x[i] = x[i - 1] + d
                if f in seq and (pas == passes - 1):
                    result.append([p.copy() for p in x])
            if pas == passes - 1:
                out = result
        # Two passes of a light temporal filter remove the last flutter.
        for _ in range(2):
            out = [[(out[max(f - 1, 0)][i] + out[f][i] * 2 + out[min(f + 1, n - 1)][i]) * .25 for i in range(len(out[f]))]
                   for f in range(n)]
        if loop and n > 20:
            # Close the loop: ease the last frames into the first.
            k = 16
            for j in range(k):
                f = n - k + j; w = smooth((j + 1) / k)
                out[f] = [a.lerp(b, w) for a, b in zip(out[f], out[0])]
        for f in range(n):
            pts = out[f]
            H = poses[f]['Head'].to_3x3()
            # The root takes its roll from the head; each further bone carries the
            # previous bone's frame down the chain (parallel transport), so no
            # bone's roll depends on how the braid happens to hang.
            z = H.col[0].normalized().cross((pts[1] - pts[0]).normalized())
            for i, name in enumerate(self.names):
                d = (pts[i + 1] - pts[i]).normalized()
                F = frame(d, z)
                poses[f][name] = mat4(F, pts[i])
                z = F.col[2]
        return poses


def bake_all(G, scene, names=None):
    rig = G['rig']; skel = G['skel']
    rig.animation_data_create(); rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    braid = Braid(skel)
    actions = []; clips = []; report = {}
    scene.render.fps = FPS
    for name in names or clips_v3.CLIP_ORDER:
        clip, club, loop = clips_v3.make_clip(G, name)
        duration = clip.duration
        frames = round(duration * FPS); duration = frames / FPS
        G['bodypose'].max_reach_gap = 0; G['bodypose'].max_leg_gap = 0
        poses = []
        for f in range(frames + 1):
            t = min(f / FPS, duration)
            if loop and f == frames:
                t = 0.0
            poses.append(clip.pose(t))
        poses = braid.run(poses, loop)
        basis = [skel.basis(p) for p in poses]
        action = bpy.data.actions.new(f'{G["variant"].title()} v3 | {name}')
        action.use_fake_user = True; action['banvy_golfer'] = 3; action['clip_name'] = name
        action['banvy_character'] = G['variant']
        if not action.slots:
            action.slots.new('OBJECT', rig.name)
        bake_action(rig, action, basis, skel)
        actions.append(action)
        entry = dict(name=name, duration=duration, loop=loop, club=club)
        if isinstance(clip, clips_v3.Gait):
            entry.update(speed=clip.speed, stance=clip.stance,
                         travelDirection=[clip.direction[0], 0, -clip.direction[1]])
        if isinstance(clip, clips_v3.Turn):
            entry['turnAngle'] = clip.angle
        if isinstance(clip, clips_v3.Stroke):
            sw = clip.sw
            sp = sw.spec(sw.impact)
            ball = sw.st.ball
            n = sp['club'].to_3x3() @ sw.data['normal']
            entry.update(impact=sw.impact, contact=[ball.x, ball.z, -ball.y], shotDirection=[1, 0, 0],
                         faceDirection=[n.x, n.z, -n.y])
            report[name] = dict(impact_error=[round(v, 5) for v in sw.impact_error], goals=sw.goal_report)
        report.setdefault(name, {})['reach_gap_m'] = round(G['bodypose'].max_reach_gap, 4)
        report[name]['leg_gap_m'] = round(G['bodypose'].max_leg_gap, 4)
        clips.append(entry)
        print('BAKED', name, frames, report[name].get('reach_gap_m'))
    rig.animation_data.action = actions[0]
    if actions[0].slots:
        rig.animation_data.action_slot = actions[0].slots[0]
    return actions, clips, report


def export(G, scene, actions, clips, report, stem, manifest_name, extra):
    rig = G['rig']
    bpy.context.window.scene = scene if bpy.context.window else None
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    for action in actions:
        name = action['clip_name']
        track = rig.animation_data.nla_tracks.new(); track.name = name
        strip = track.strips.new(name, 1, action); strip.extrapolation = 'NOTHING'; track.mute = True
        if action.slots:
            strip.action_slot = action.slots[0]
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    rig.select_set(True)
    for ob in rig.children:
        if (ob.type == 'MESH' and not ob.get('golfer_source')) or ob.get('golfer_motion_marker'):
            ob.hide_set(False); ob.hide_render = False; ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = ASSET / (stem + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, use_active_scene=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True,
                              export_def_bones=False, export_bake_animation=True, export_anim_single_armature=False,
                              export_anim_slide_to_zero=True, export_frame_range=False, export_cameras=False,
                              export_lights=False, export_extras=False, export_yup=True,
                              export_image_format='AUTO', export_texcoords=True, export_normals=True,
                              export_tangents=False, export_skins=True, export_all_influences=False,
                              export_morph=False)
    data = path.read_bytes(); size, kind = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20 + size])
    names = {a['name'] for a in gltf.get('animations', [])}
    missing = {c['name'] for c in clips} - names
    if missing:
        raise RuntimeError(f'GLB is missing animations: {sorted(missing)}')
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    rig.animation_data.action = actions[0]
    if actions[0].slots:
        rig.animation_data.action_slot = actions[0].slots[0]
    body = G['body']
    manifest = dict(schema=1, revision=3, id=G['variant'], name=f'Banvy {G["variant"].title()} Golfer',
                    file=path.name, height=round(max(G['joints']['head_top'].z, 0), 3), forward='+Z',
                    bones=len(rig.data.bones), clips=clips,
                    clubs=[dict(id=cid, length=round(d['length'], 3)) for cid, d in G['club_data'].items()],
                    bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    vertices=len(body.data.vertices), triangles=sum(len(p.vertices) - 2 for p in body.data.polygons),
                    grip={side: round(G['grips']['Iron'].along(side), 4) for side in 'LR'},
                    animation=dict(fps=FPS, solver='v3 kinematic sequence', report=report), **extra)
    (ASSET / manifest_name).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest
