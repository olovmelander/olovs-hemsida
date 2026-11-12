"""Bake every clip at 60 fps, simulate the braid, export the GLB and manifest.

Run headless from the repository root:
  blender --background --factory-startup --python tools/blender-golfer/v3/build_v3.py -- female
"""
import bpy, json, math, hashlib, struct
import numpy as np
from pathlib import Path
from mathutils import Vector as V, Matrix
from rig_math import bake_action, frame, mat4, clamp, smooth
import clips_v3

FPS = 60
ROOT = Path(__file__).resolve().parents[3]
ASSET = ROOT / 'experiments/golfer/assets'


class Braid:
    """A damped verlet chain hanging from the head, kept off the head and back."""

    def __init__(self, skel, body=None):
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
        h3 = skel.rest3['Head']
        self.root_dir = (h3.transposed() @ (self.rest_pts[1] - self.rest_pts[0])).normalized()
        self.root_frame = h3.transposed() @ skel.rest3[self.names[0]]
        # The back as a collider: its rest profile (the farthest-back skin near the
        # spine, every centimetre of height), carried by the posed chest.
        self.back = None
        if body is not None:
            import numpy as np
            co = np.array([v.co[:] for v in body.data.vertices])
            mid = co[np.abs(co[:, 0]) < .07]
            z0 = skel.head['Spine'].z; z1 = skel.head['Neck'].z + .02
            zs = np.arange(z0, z1, .01)
            ys = []
            for z in zs:
                band = mid[np.abs(mid[:, 2] - z) < .008]
                ys.append(float(band[:, 1].max()) if len(band) else np.nan)
            ys = np.array(ys); ok = ~np.isnan(ys)
            if ok.sum() > 4:
                self.back = (zs[ok], ys[ok])
        self.clear = .028      # polo, its ease and the braid's own radius

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
            n_warm = len(warm) if pas == 0 else 0
            result = []
            for idx, f in enumerate(frames):
                tgt, centre, chest = targets(poses[f])
                C_pose = poses[f]['Chest']; C_rest = self.s.rest['Chest']
                to_rest = C_rest @ C_pose.inverted(); from_rest = C_pose @ C_rest.inverted()
                for _ in range(sub):
                    for i in range(1, len(x)):
                        v = (x[i] - xp[i]) * .952
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
                            if self.back is not None:
                                q = to_rest @ x[i]
                                # Continuous everywhere below the neck (np.interp holds the
                                # lowest measured line below the profile): a collider that
                                # switched off at an edge snapped the braid's tip.
                                if q.z < self.back[0][-1]:
                                    by = float(np.interp(q.z, self.back[0], self.back[1])) + self.clear
                                    if q.y < by:
                                        # Only behind the back: the profile is measured near
                                        # the spine, so it fades out toward the sides and front.
                                        w = smooth((.13 - abs(q.x)) / .05) * smooth((q.y - (by - .09)) / .03)
                                        q.y += (by - q.y) * .5 * w; x[i] = from_rest @ q
                        # A braid bends, it does not fold: at most 32 degrees per joint.
                        for i in range(2, len(x)):
                            prev = x[i - 1] - x[i - 2]; d = x[i] - x[i - 1]
                            if prev.length > 1e-6 and d.length > 1e-6:
                                ang = prev.angle(d)
                                if ang > .56:
                                    d = prev.normalized().slerp(d.normalized(), .56 / ang) * d.length
                                    x[i] = x[i - 1] + d
                # Record the clip's own frames only: the warm-up repeats frame 0, and
                # recording it delayed the braid by a second on every one-shot clip.
                if idx >= n_warm and pas == passes - 1:
                    result.append([p.copy() for p in x])
            if pas == passes - 1:
                out = result
        assert len(out) == n, (len(out), n)
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
            # The root turns from its rest frame (relative to the head) by the least rotation.
            d_local = (H.transposed() @ (pts[1] - pts[0])).normalized()
            q = self.root_dir.rotation_difference(d_local)
            z = H @ (q.to_matrix() @ self.root_frame).col[2]
            for i, name in enumerate(self.names):
                d = (pts[i + 1] - pts[i]).normalized()
                F = frame(d, z)
                poses[f][name] = mat4(F, pts[i])
                z = F.col[2]
        return poses


def blink_curve(t, starts):
    """0 open .. 1 closed: a quick close, a short hold, a slower opening."""
    v = 0.0
    for s0 in starts:
        u = t - s0
        if 0 <= u < .075:
            v = max(v, smooth(u / .075))
        elif .075 <= u < .105:
            v = 1.0
        elif .105 <= u < .27:
            v = max(v, 1 - smooth((u - .105) / .165))
    return v


def blink_times(name, duration):
    """When each clip blinks: with head turns, at rest and in the held finish; the
    short locomotion loops never blink (once a stride would read as a twitch)."""
    if name == 'Idle':
        return [.9, 3.32, 3.66, 5.55]
    if name.startswith('Address'):
        return [.86, 2.42]
    if name.startswith('Turn'):
        return [.04]
    if name == 'ClubChange':
        return [.28]
    if name == 'Celebrate':
        return [.06, duration - .75]
    if name == 'FistPump':
        return [.05, duration - .45]
    if name == 'Disappointed':
        return [.42, 1.5, duration - .5]
    if name in ('SwingDriver', 'SwingWood', 'SwingIron', 'ChipWedge', 'Putt'):
        return [.12, duration - .95]
    return []


def expression(name, t, duration, impact=None):
    """The face at a moment of a clip: jaw (degrees, + opens), smile, brow (-1 drawn .. 1 raised), squint.

    The sculpt's lips rest a little parted; a slightly closed jaw is the neutral face.
    """
    def window(t0, t1, rise=.25, fall=.35):
        return smooth((t - t0) / rise) * (1 - smooth((t - t1) / fall))
    f = dict(jaw=-.9, smile=.08, brow=0.0, squint=.04)
    if name == 'Idle':
        look = window(2.9, 4.3)                           # shading the eyes, looking down the course
        easy = window(4.7, 5.9)
        f.update(squint=.04 + .42 * look, brow=-.28 * look + .2 * easy, smile=.1 + .16 * easy)
    elif name.startswith('Address'):
        glance = window(.7, 1.5)                          # the look at the target
        f.update(brow=-.34 + .2 * glance, squint=.28 + .12 * glance, smile=.0, jaw=-1.1)
    elif impact is not None:
        effort = window(impact - .16, impact + .14, .1, .3)
        watch = window(impact + .45, impact + 1.2, .3, .5)
        pleased = smooth((t - (impact + 1.25)) / .5)
        f.update(brow=-.36 - .3 * effort + .5 * watch + .46 * pleased, squint=.3 + .42 * effort - .1 * watch + .2 * pleased,
                 smile=.3 * pleased, jaw=-1.1 - .4 * effort + .5 * watch + .4 * pleased)
    elif name == 'Celebrate':
        joy = smooth((t - .2) / .3)
        shout = window(.42, 1.2, .14, .4)
        f.update(smile=.25 + .75 * joy, jaw=-.9 + 7.0 * shout + 3.4 * joy * (1 - shout), brow=.55 * joy, squint=.5 * joy)
    elif name == 'FistPump':
        on = window(.45, 1.35, .2, .4)
        effort = window(.6, 1.08, .1, .3)
        f.update(smile=.12 + .5 * on, brow=-.3 * effort + .2 * smooth((t - 1.25) / .4),
                 squint=.1 + .4 * on, jaw=-1.0 + 1.2 * effort)
    elif name == 'Disappointed':
        down = window(.35, 1.5, .25, .3)
        sky = window(1.55, 2.2, .2, .4)
        f.update(brow=-.75 * down + .7 * sky - .15 * smooth((t - 2.4) / .4), squint=.38 * down, smile=0.0,
                 jaw=-1.2 + 3.4 * sky)
    elif name == 'Jog':
        f.update(jaw=1.2, smile=.05)
    return f


# Eye darts (saccades): (time, yaw, pitch in degrees); each is held until the next. A clip starts
# and ends at rest, so loops close. Only off the ball: at address and through a stroke the eyes
# stay on the ball and its flight.
DARTS = {
    'Idle': [(.42, 3.5, -1.0), (.95, 0, 0), (2.92, -4.0, 1.0), (3.36, 2.5, 0), (3.8, 0, 0), (5.32, 3.0, 1.5), (5.78, 0, 0)],
    'Celebrate': [(1.72, -3.0, .5), (2.2, 0, 0)],
    'FistPump': [(1.42, 3.0, 0), (1.72, 0, 0)],
    'Disappointed': [(.9, -3.5, 1.0), (1.3, 2.0, 0), (2.36, -2.5, 0), (2.66, 0, 0)],
    'ClubChange': [(.5, 3.0, 1.0), (.95, 0, 0)],
}


def eye_dart(name, t):
    seq = DARTS.get(name)
    if not seq:
        return None
    prev = (0.0, 0.0); cur = (0.0, 0.0); t0 = 0.0
    for ts, yaw, pitch in seq:
        if t >= ts:
            prev = cur; cur = (yaw, pitch); t0 = ts
    u = smooth((t - t0) / .05)                         # a saccade takes about three frames
    return (math.radians(prev[0] + (cur[0] - prev[0]) * u), math.radians(prev[1] + (cur[1] - prev[1]) * u))


def bake_all(G, scene, names=None):
    rig = G['rig']; skel = G['skel']
    rig.animation_data_create(); rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    braid = Braid(skel, G.get('cage'))
    actions = []; clips = []; report = {}
    G['baked'] = {}                       # clip -> (frames, loop): the armature-space poses, for the CPU audit
    G['carry'] = {}                       # clip -> the shoulder carry's fit (carry_v3.py)
    G['hand'] = {}                        # clip -> the free hand on the hip (carry_v3.py)
    scene.render.fps = FPS
    import carry_v3
    for name in names or clips_v3.CLIP_ORDER:
        clip, club, loop = clips_v3.make_clip(G, name)
        duration = clip.duration
        frames = round(duration * FPS); duration = frames / FPS

        def bake_clip(action=None):
            G['bodypose'].max_reach_gap = 0; G['bodypose'].max_leg_gap = 0
            poses = []
            blinks = blink_times(name, duration)
            for f in range(frames + 1):
                t = min(f / FPS, duration)
                if loop and f == frames:
                    t = 0.0
                G['bodypose'].blink = blink_curve(t, blinks)
                G['bodypose'].face = expression(name, t, duration, clip.sw.impact if isinstance(clip, clips_v3.Stroke) else None)
                G['bodypose'].dart = eye_dart(name, t)
                clip.carry_t = t
                poses.append(clip.pose(t))
            G['bodypose'].blink = 0.0; G['bodypose'].face = None; G['bodypose'].dart = None
            poses = braid.run(poses, loop)
            basis = [skel.basis(p) for p in poses]
            G['baked'][name] = (basis, loop)
            if action is None:
                action = bpy.data.actions.new(f'{G["variant"].title()} v3 | {name}')
                action.use_fake_user = True; action['banvy_golfer'] = 3; action['clip_name'] = name
                action['banvy_character'] = G['variant']
                if not action.slots:
                    action.slots.new('OBJECT', rig.name)
            bake_action(rig, action, basis, skel)
            return action

        action = bake_clip()
        entry = dict(name=name, duration=duration, loop=loop, club=club)
        if isinstance(clip, clips_v3.Carry):
            # The club rests on the shirt (carry_v3.py): baked in contact, the rise that rests it
            # read off the posed outfit, baked again with the rise and the authored bounces, measured.
            along = clip.grip.along('R')
            clip.carry_contact = True
            action = bake_clip(action)
            rise = carry_v3.fit(G, action, entry, along, frames, loop)
            clip.carry_contact = False; clip.carry_rise = rise
            action = bake_clip(action)
            fit = carry_v3.measure(G, action, entry, along, frames)
            if fit['depth_mm'] > 0:
                # An authored lift turns the shaft into the shirt: add the extra rise it needs.
                extra = carry_v3.fit(G, action, entry, along, frames, loop, floor=0.0)
                clip.carry_rise = lambda t, a=rise, b=extra: a(t) + b(t)
                action = bake_clip(action)
                fit = carry_v3.measure(G, action, entry, along, frames)
                fit['extra_mm'] = round(max(r for _t, r in extra.samples) * 1000, 1)
            fit['rise_mm'] = [round(min(r for _t, r in rise.samples) * 1000, 1), round(max(r for _t, r in rise.samples) * 1000, 1)]
            G['carry'][name] = fit
            print('CARRY', name, fit)
        if getattr(clip, 'hand_on_hip', False):
            # The free hand rests on the shirt (carry_v3.py): the push along the hip's normal read
            # off the posed outfit, baked, measured, and corrected once if it still goes in.
            push = carry_v3.fit_hip(G, action, entry, frames, loop, clip)
            clip.hip_push = push
            action = bake_clip(action)
            hand = carry_v3.measure_hip(G, action, entry, frames, clip)
            if hand['depth_mm'] > 0:
                extra = carry_v3.fit_hip(G, action, entry, frames, loop, clip, floor=0.0)
                clip.hip_push = lambda t, a=push, b=extra: a(t) + b(t)
                action = bake_clip(action)
                hand = carry_v3.measure_hip(G, action, entry, frames, clip)
                hand['extra_mm'] = round(max(r for _t, r in extra.samples) * 1000, 1)
            hand['push_mm'] = [round(min(r for _t, r in push.samples) * 1000, 1), round(max(r for _t, r in push.samples) * 1000, 1)]
            G['hand'][name] = hand
            print('HAND', name, hand)
            if name in G['carry']:
                # The arm moved: measure the club again on the final bake.
                again = carry_v3.measure(G, action, entry, clip.grip.along('R'), frames)
                G['carry'][name].update(depth_mm=again['depth_mm'], closest_mm=again['closest_mm'],
                                        part=again['part'], frame=again['frame'])
                print('CARRY', name, 'after the hand', again)
        actions.append(action)
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
            if sw.has_release:
                entry['trailRelease'] = sw.table['t'][-3]   # the trail hand lets go after the held finish
            report[name] = dict(impact_error=[round(v, 5) for v in sw.impact_error], goals=sw.goal_report)
        if name in G['carry']:
            report.setdefault(name, {})['carry'] = G['carry'][name]
        if name in G['hand']:
            report.setdefault(name, {})['hand'] = G['hand'][name]
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
                              export_image_format='WEBP', export_image_quality=92, export_texcoords=True, export_normals=True,
                              export_tangents=False, export_skins=True, export_all_influences=False,
                              export_morph=False)
    # Smaller attributes and keys (compact_v3.py): the golfer ships with Spela to every player.
    import compact_v3
    compaction = compact_v3.compact(str(path))
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
                    animation=dict(fps=FPS, solver='v3 kinematic sequence', report=report),
                    compaction={k: v for k, v in compaction.items()}, **extra)
    (ASSET / manifest_name).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def pose_sampler(G):
    """pose_at(clip, t) for the CPU audit: the baked frames played as the runtime plays them.

    Between two keys the runtime interpolates every joint in its own parent's
    space (the shortest way round in rotation, linear in position) and composes
    the chain. Interpolating the finished armature-space poses instead under-read
    the hands' drift off the grip between keys by a third.
    """
    from mathutils import Matrix
    baked = G['baked']; skel = G['skel']
    local_rest = {n: (skel.rest[skel.parent[n]].inverted() @ skel.rest[n]) if skel.parent[n] else skel.rest[n]
                  for n in skel.order}
    quats = {}

    def keys(name):
        if name not in quats:
            frames, _ = baked[name]
            qs = []
            prev = {}
            for basis in frames:
                row = {}
                for bone in skel.order:
                    q = basis[bone].to_quaternion()
                    if bone in prev and prev[bone].dot(q) < 0:
                        q.negate()                      # as the baked curves are written
                    row[bone] = (q, basis[bone].translation.copy()); prev[bone] = q
                qs.append(row)
            quats[name] = qs
        return quats[name]

    def pose_at(name, t):
        rows = keys(name)
        f = max(0.0, min(len(rows) - 1.0, t * FPS))
        i = int(math.floor(f)); u = f - i
        a = rows[i]; b = rows[min(i + 1, len(rows) - 1)]
        pose = {}
        for bone in skel.order:
            qa, la = a[bone]; qb, lb = b[bone]
            q = qa.slerp(qb, u) if u > 1e-9 else qa
            m = q.to_matrix().to_4x4()
            m.translation = la.lerp(lb, u) if u > 1e-9 else la
            parent = skel.parent[bone]
            pose[bone] = (pose[parent] @ local_rest[bone] @ m) if parent else (local_rest[bone] @ m)
        return pose
    return pose_at
