"""Outfits, hair and materials for the v3 golfers.

Original designs for Banvy's courses (no likeness of any existing game's
character):
  female -- coral pique polo with a white collar and sleeve bands, navy
            tailored golf shorts with a white belt, white visor, dark-blonde
            hair pulled back into a braid, white glove, white golf shoes with
            coral heel tabs.
  male   -- navy pique polo with white tipping, stone tailored trousers and a
            cognac belt, white cap, short dark hair, white glove, white shoes
            on gum soles.
"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector as V, Matrix
from mathutils.bvhtree import BVHTree
import cloth_v3 as C
import textures_v3 as TX
from body_v3 import FS, FINGERS, TOES, FOREFOOT

PALETTE = {
    'female': dict(skin='#E9C2A4', polo='#E2735C', trim='#F4F1EA', navy='#1F2C47', hair='#86643F', hair_hi='#B08A5B',
                   shoe='#F3F1EC', accent='#E2735C', sole='#F1EEE6', outsole='#1F2C47', lip='#C07A6E', iris='#5B7A8C',
                   headwear='#F4F2EC', bill_under='#1F2C47', trousers='#1F2C47', belt='#F4F1EA'),
    'male': dict(skin='#B47856', polo='#22304C', trim='#F2EFE8', navy='#22304C', hair='#2E241E', hair_hi='#4A3A2E',
                 shoe='#F3F1EC', accent='#22304C', sole='#C9935F', outsole='#A8743F', trousers='#CDC2A9', belt='#8A5A35',
                 lip='#9C6250', iris='#5E4430', headwear='#F2F0EA', bill_under='#22304C'),
}


def material(name, rgb, rough=.6, metal=0.0):
    return C.material(name, rgb, rough, metal)


def plain_materials(G):
    G['body'].data.materials.clear()
    G['body'].data.materials.append(C.material('Golfer v3 | skin', '#DDB096', .55))
    for e in G['eyes']:
        e.data.materials.clear(); e.data.materials.append(C.material('Golfer v3 | eye', '#EEEDEA', .2))


class Outfit:
    def __init__(self, G, col):
        self.G = G; self.col = col
        self.v = G['variant']; self.P = PALETTE[self.v]
        self.body = G['body']; self.me = self.body.data; self.J = G['joints']; self.rig = G['rig']
        self.k = self.J['head_top'].z / (1.68 if self.v == 'female' else 1.80)
        self.fs = C.face_sets(self.me)
        self.centre = [p.center.copy() for p in self.me.polygons]
        self.hide = np.zeros(len(self.me.polygons), dtype=bool)
        self.parts = []
        self.bvh = BVHTree.FromObject(self.body, bpy.context.evaluated_depsgraph_get())
        J = self.J
        self.hip_z = (J['hip_L'].z + J['hip_R'].z) / 2
        self.waist_z = self.hip_z + .135 * self.k
        self.mats = {}
        self.textures = TX.Library(self.v)

    # -- helpers -------------------------------------------------------------------
    def mask(self, sets=None, pred=None):
        m = np.ones(len(self.fs), dtype=bool) if sets is None else np.isin(self.fs, list(sets))
        if pred is not None:
            m &= np.array([pred(c) for c in self.centre])
        return m

    def keep_off_body(self, ob, gap):
        """Push any vertex that sank under the skin back out to a minimum gap."""
        me = ob.data; co = C.coords(me)
        for i, p in enumerate(co):
            hit = self.bvh.find_nearest(V(p))
            if hit[0] is None:
                continue
            loc, nrm = hit[0], hit[1]
            d = (V(p) - loc).dot(nrm)
            if d < gap:
                co[i] = np.array(loc + nrm * gap)
        C.set_coords(me, co)

    def clamp_drift(self, ob, used, limit):
        """No garment vertex may wander far from the skin it was cut from."""
        co = C.coords(ob.data); body = C.coords(self.me)[used]
        d = co - body; n = np.linalg.norm(d, axis=1)
        far = n > limit
        if far.any():
            co[far] = body[far] + d[far] / n[far, None] * limit
            C.set_coords(ob.data, co)
        return int(far.sum())

    def finish(self, ob, mat, thickness=None, weights=True, offset=-1.0):
        if mat is not None and not ob.data.uv_layers and any(n.type == 'TEX_IMAGE' for n in mat.node_tree.nodes):
            TX.scale_uv_box(ob, 40)
        if thickness:
            C.solidify(ob, thickness, offset)
        if mat is not None:
            ob.data.materials.clear(); ob.data.materials.append(mat)
        if weights:
            C.smooth_weights(ob, 3)
        ob.parent = self.rig
        mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = self.rig
        self.parts.append(ob)
        return ob

    def mat(self, key, color, rough=.7, **kw):
        name = f'Golfer v3 {self.v} | {key}'
        if name not in self.mats:
            self.mats[name] = C.material(name, color, rough, **kw)
        return self.mats[name]

    def arm_frame(self, side):
        sh = self.rig.data.bones['UpperArm_' + side].head_local
        el = self.rig.data.bones['UpperArm_' + side].tail_local
        return sh, el

    # -- polo -------------------------------------------------------------------------
    def polo(self):
        P = self.P; k = self.k; J = self.J
        hem = self.waist_z - (.035 if self.v == 'female' else .025) * k
        sleeve = .40 if self.v == 'female' else .50
        neck_top = J['neck_base'].z + .028 * k   # the torso set runs on up the nape
        def pred(c):
            return hem - .02 < c.z < neck_top
        m = self.mask({FS['torso'], FS['belly'], FS['pelvis'], FS['upper_L'], FS['upper_R']}, pred)
        # Upper arms only down to a little past the sleeve.
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = (el - sh)
            L = ax.length; ax.normalize()
            for i, c in enumerate(self.centre):
                if m[i] and self.fs[i] in (FS['upper_' + side],):
                    if (V(c) - sh).dot(ax) / L > sleeve + .12:
                        m[i] = False
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Polo', self.col)
        me = ob.data
        C.inflate(me, (.006 if self.v == 'female' else .009) * k)
        # Bridge the hollows of the trunk (not the arms).
        co = C.coords(me)
        trunk = [i for i, p in enumerate(co) if abs(p[0]) < .145 * k or p[2] > J['shoulder_L'].z - .03]
        C.bridge_slices(me, (0, 0, 0), (0, 0, 1), .88, step=.012, select=trunk)
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = (el - sh).normalized()
            co = C.coords(me)
            arm = [i for i, p in enumerate(co) if (V(p) - sh).dot(ax) > .03 and (V(p) - (sh + ax * (V(p) - sh).dot(ax))).length < .09 * k]
            if arm:
                C.bridge_slices(me, sh, ax, .7, step=.012, select=arm)
        C.smooth(me, 26, .5, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, (.0045 if self.v == 'female' else .007) * k)
        C.smooth(me, 6, .35, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, (.0035 if self.v == 'female' else .005) * k)
        self.clamp_drift(ob, used, .045 * k)
        # Hem and sleeve cuts.
        C.cut_plane(ob, (0, 0, hem), (0, 0, 1), keep_positive=True)
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = (el - sh)
            point = sh + ax * sleeve
            self._cut_arm(ob, side, point, -ax.normalized())
        # A little ease at the sleeve openings and a drape below the chest.
        co = C.coords(me); n = C.normals(me)
        bnd = C.boundary_vertices(me)
        add = np.zeros(len(co))
        for i, p in enumerate(co):
            if abs(p[0]) > .17 * k and i in bnd:
                add[i] = .004 * k
        C.inflate(me, add)
        self.polo_ob = ob
        loops = self._loops(ob)
        nb = V((0, J['neck_base'].y, J['neck_base'].z))
        def neck_score(L):
            pts = [V(C.coords(me)[i]) for i in L]; c = sum(pts, V()) / len(pts)
            r = max((p - c).length for p in pts)
            return (c - nb).length + (1.0 if r > .14 * k else 0.0)
        neck = min(loops, key=neck_score)
        self.neck_loop = [V(C.coords(me)[i]) for i in neck]
        self.sleeve_loops = [L for L in loops if L is not neck and np.mean([abs(C.coords(me)[i][0]) for i in L]) > .15 * k]
        self.sleeve_pts = [[V(C.coords(me)[i]) for i in L] for L in self.sleeve_loops]
        pique = self.textures.normal('pique')
        polo_mat = self.mat('polo pique', P['polo'], .82, sheen=.35, normal_image=pique, normal_strength=.45)
        TX.cylinder_uv(ob, (0, 0, 0), (0, 0, 1), 55)
        self.finish(ob, polo_mat, None)
        hidden = C.shrink_mask(self.me, m & np.array([c.z > hem + .015 for c in self.centre]), 2)
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = el - sh; L = ax.length; ax.normalize()
            for i, c in enumerate(self.centre):
                if hidden[i] and self.fs[i] == FS['upper_' + side] and (V(c) - sh).dot(ax) / L > sleeve - .06:
                    hidden[i] = False
        self.hide |= hidden
        self.collar(); self.placket(); self.sleeve_bands()

    def _cut_arm(self, ob, side, point, normal):
        me = ob.data
        sh, el = self.arm_frame(side); ax = (el - sh); L = ax.length; ax.normalize()
        def on_arm(c):
            t = (c - sh).dot(ax)
            return t > .18 * L and (c - (sh + ax * t)).length < .095 * self.k
        bm = bmesh.new(); bm.from_mesh(me)
        layer = bm.faces.layers.int.get('body_face_set')
        arm_set = FS['upper_' + side]
        def on_arm_face(f):
            return (layer is None or f[layer] == arm_set) and on_arm(f.calc_center_median())
        faces = [f for f in bm.faces if on_arm_face(f)]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=V(point), plane_no=V(normal))
        kill = [f for f in bm.faces if on_arm_face(f) and (f.calc_center_median() - V(point)).dot(V(normal)) < 0]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(me); bm.free(); me.update()

    def _loops(self, ob):
        me = ob.data
        bm = bmesh.new(); bm.from_mesh(me)
        edges = [e for e in bm.edges if e.is_boundary]
        adj = {}
        for e in edges:
            a, b = e.verts[0].index, e.verts[1].index
            adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
        bm.free()
        seen = set(); loops = []
        for s in adj:
            if s in seen:
                continue
            loop = [s]; seen.add(s); prev = None; cur = s
            while True:
                nxt = [n for n in adj[cur] if n != prev and n not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]; loop.append(cur); seen.add(cur)
            if len(loop) > 8:
                loops.append(loop)
        return loops

    def neck_ring(self, n=96):
        """The neck opening as a smooth closed curve, found by rays onto the polo's top edge."""
        J = self.J; k = self.k
        bvh = BVHTree.FromObject(self.polo_ob, bpy.context.evaluated_depsgraph_get())
        c = V((0, J['neck_base'].y, J['neck_base'].z))
        A = []; R = []; Z = []
        for i in range(72):
            a = -math.pi + 2 * math.pi * i / 72
            d = V((math.sin(a), -math.cos(a), 0))
            for step in range(90):
                z = c.z + .05 * k - step * .001
                hit = bvh.ray_cast(V((c.x, c.y, z)) + d * .25, -d, .25)
                if hit[0] is not None and (hit[0] - V((c.x, c.y, z))).length < .13 * k:
                    A.append(a); R.append(math.hypot(hit[0].x - c.x, hit[0].y - c.y)); Z.append(z)
                    break
        A = np.array(A)
        def basis(a, H=4):
            cols = [np.ones_like(a)]
            for h in range(1, H + 1):
                cols += [np.cos(h * a), np.sin(h * a)]
            return np.stack(cols, axis=1)
        B = basis(A)
        cr = np.linalg.lstsq(B, np.array(R), rcond=None)[0]
        cz = np.linalg.lstsq(B, np.array(Z), rcond=None)[0]
        out = []
        for i in range(n):
            a = -math.pi + 2 * math.pi * i / n
            b = basis(np.array([a]))
            r = float((b @ cr)[0]); z = float((b @ cz)[0])
            out.append((a, V((c.x + r * math.sin(a), c.y - r * math.cos(a), z))))
        return c, out

    def collar(self):
        """Stand and fold-down leaf around the neck opening, with collar points."""
        P = self.P; k = self.k
        c, ring = self.neck_ring(96)
        gap = math.radians(10)
        rows = []
        for a, p in sorted(((a if a > 0 else a + 2 * math.pi, p) for a, p in ring), key=lambda t: t[0]):
            if a < gap or a > 2 * math.pi - gap:
                continue
            aa = a if a <= math.pi else a - 2 * math.pi
            out = V((math.sin(aa), -math.cos(aa), 0))
            front = max(0.0, 1 - abs(aa) / math.radians(60))
            stand_h = (.022 - .004 * front) * k
            q0 = p + V((0, 0, -.003))
            q1 = p + V((0, 0, stand_h)) + out * .002
            q2 = q1 + out * .008 * k + V((0, 0, .0015))
            leaf = (.034 + .026 * front ** 1.6) * k
            q3 = q2 + out * leaf * .55 + V((0, 0, -leaf * .82)) + V((0, -.010 * front, 0))
            rows.append([q0, q1, q2, q3])
        verts = [tuple(v) for r in rows for v in r]; faces = []; cols = 4
        for i in range(len(rows) - 1):
            for j in range(cols - 1):
                a_ = i * cols + j
                faces.append((a_, a_ + cols, a_ + cols + 1, a_ + 1))
        me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Collar'); me.from_pydata(verts, [], faces); me.update()
        ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        C.transfer_weights(ob, self.polo_ob)
        trim = self.mat('collar', P['trim'] if self.v == 'female' else P['polo'], .78, sheen=.3)
        self.finish(ob, trim, .0026 * k, offset=0)
        if self.v == 'male':
            edge = [r[3] for r in rows]
            t = C.tube(f'Golfer_v3_{self.v}_CollarTipping', edge, [.0016 * k] * len(edge), self.col, 6)
            C.transfer_weights(t, self.polo_ob)
            self.finish(t, self.mat('tipping', P['trim'], .7))

    def placket(self):
        P = self.P; k = self.k
        top = max(self.neck_loop, key=lambda p: -p.y if abs(p.x) < .03 else -9)
        # Raycast the polo surface down the centre front.
        bvh = BVHTree.FromObject(self.polo_ob, bpy.context.evaluated_depsgraph_get())
        pts = []
        for i in range(9):
            z = top.z - .006 - i * .0135 * k
            hit = bvh.ray_cast(V((0, -1, z)), V((0, 1, 0)), 2)
            if hit[0] is not None:
                pts.append(hit[0] + V((0, -.0012, 0)))
        if len(pts) < 3:
            return
        strip = C.tube(f'Golfer_v3_{self.v}_Placket', pts, [(.013 * k, .0016)] * len(pts), self.col, 8)
        C.transfer_weights(strip, self.polo_ob)
        self.finish(strip, self.mat('placket', P['polo'] if self.v == 'male' else P['trim'], .8))
        buttons = []
        for p in (pts[2], pts[5]):
            b = C.tube(f'Golfer_v3_{self.v}_Button', [p + V((0, .0005, 0)), p + V((0, -.0028, 0))], [.0042 * k, .0040 * k], self.col, 12)
            buttons.append(b)
        b = C.join(buttons, f'Golfer_v3_{self.v}_Buttons')
        C.transfer_weights(b, self.polo_ob)
        self.finish(b, self.mat('buttons', '#F7F5EF', .35))

    def sleeve_bands(self):
        P = self.P; k = self.k
        sleeve = .40 if self.v == 'female' else .50
        bvh = BVHTree.FromObject(self.polo_ob, bpy.context.evaluated_depsgraph_get())
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = (el - sh); centre = sh + ax * sleeve; ax.normalize()
            ref = (V((0, -1, 0)) - ax * ax.dot(V((0, -1, 0)))).normalized(); ref2 = ax.cross(ref)
            width = (.016 if self.v == 'female' else .006) * k
            rows = []
            for off in (-width, -width * .5, -.0008):
                ring = []
                for j in range(48):
                    a = 2 * math.pi * j / 48
                    d = ref * math.cos(a) + ref2 * math.sin(a)
                    o = centre + ax * off
                    hit = bvh.ray_cast(o, d, .12)
                    ring.append((hit[0] + d * .0042) if hit[0] is not None else o + d * .05)
                rows.append(ring)
            # A soft roll at the very edge.
            rows.append([p + ax * .0016 - (p - centre - ax * (p - centre).dot(ax)).normalized() * .0016 for p in rows[-1]])
            verts = [tuple(v) for r in rows for v in r]; n = 48; faces = []
            for r in range(len(rows) - 1):
                for j in range(n):
                    a_ = r * n + j; b_ = r * n + (j + 1) % n
                    faces.append((a_, b_, b_ + n, a_ + n))
            me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_SleeveBand_{side}'); me.from_pydata(verts, [], faces); me.update()
            ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
            for p in me.polygons:
                p.use_smooth = True
            C.transfer_weights(ob, self.polo_ob)
            self.finish(ob, self.mat('sleeve band', P['trim'], .78, sheen=.3), .0016 * k, offset=0)

    # -- skort -------------------------------------------------------------------------
    def skort(self):
        P = self.P; k = self.k; J = self.J
        top = self.waist_z + .012 * k
        hem = J['knee_L'].z + .16 * k
        co_body = C.coords(self.me)
        lower = [p for p, f in zip(self.centre, self.fs) if f in (FS['pelvis'], FS['belly'], FS['torso'], FS['thigh_L'], FS['thigh_R'])]
        lower = np.array(lower)
        rows = 26; sides = 192; pleats = 24
        verts = []; uvs = []; weights = []
        hipline = self.hip_z - .02 * k
        for r in range(rows + 1):
            t = r / rows; z = mix(top, hem, t)
            band = lower[np.abs(lower[:, 2] - z) < .012]
            if len(band) < 8:
                band = lower[np.abs(lower[:, 2] - z) < .03]
            if z < self.hip_z:
                # Below the hips the skirt hangs from the widest section above it.
                wide = lower[np.abs(lower[:, 2] - self.hip_z) < .015]
                band = np.concatenate([band, wide * np.array([1, 1, 0]) + np.array([0, 0, z])])
            hull = C.hull2d([tuple(np.round(p[:2], 5)) for p in band])
            centre = band[:, :2].mean(axis=0)
            flare = .008 * k + .078 * k * max(0.0, (hipline - z) / (hipline - hem)) ** 1.05
            amp = .0065 * k * smooth_np(max(0.0, (hipline + .03 - z) / (hipline - hem + .03)))
            for i in range(sides):
                a = 2 * math.pi * i / sides
                d = np.array([math.sin(a), -math.cos(a)])
                q = C.project_to_hull(centre + d * .5, hull, centre) if len(hull) >= 3 else centre + d * .16
                rr = np.linalg.norm(q - centre) + flare
                s = (i * pleats / sides) % 1.0
                saw = (s if s < .82 else (1 - s) / .18 * .82) - .41
                rr += amp * saw * 2
                p = centre + d * rr
                verts.append((p[0], p[1], z))
                uvs.append((i / sides * 6, -z * 6))
                # Front panels ride the thighs, the back follows the hips; no seams in between.
                front = max(0.0, -d[1])
                leg = (.70 + .18 * front) * smooth_np(max(0.0, (hipline + .05 - z) / (hipline + .05 - hem))) ** .8
                left = smooth_np(.5 + p[0] / (.20 * k))
                weights.append({'Hips': 1 - leg, 'Thigh_L': leg * left, 'Thigh_R': leg * (1 - left)})
        faces = []
        for r in range(rows):
            for i in range(sides):
                a = r * sides + i; b = r * sides + (i + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Skort'); me.from_pydata(verts, [], faces); me.update()
        ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        uv = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index; u, vv = uvs[vi]
                if vi % sides == 0 and any(me.loops[l2].vertex_index % sides == sides - 1 for l2 in poly.loop_indices):
                    u = 6.0
                uv.data[li].uv = (u, vv)
        groups = {}
        for i, w in enumerate(weights):
            for n_, x in w.items():
                if x <= 1e-4:
                    continue
                groups.setdefault(n_, ob.vertex_groups.new(name=n_)).add([i], x, 'REPLACE')
        twill = self.textures.normal('twill')
        self.finish(ob, self.mat('skort', P['navy'], .78, sheen=.25, normal_image=twill, normal_strength=.35), .0025 * k, weights=False)
        # Waistband with a white stripe.
        band_pts = [V(verts[i]) for i in range(sides)]
        for z_off, col, r in ((-.006, 'trim', .0028), ):
            pts = [p + V((0, 0, z_off * k)) + V((p.x, p.y, 0)).normalized() * .002 for p in band_pts]
            t = C.tube(f'Golfer_v3_{self.v}_SkortStripe', pts, [r * k] * len(pts), self.col, 8, closed=True, caps=False)
            C.transfer_weights(t, ob)
            self.finish(t, self.mat('collar', P['trim'], .78, sheen=.3))
        # Undershorts keep every stride and swing covered.
        crotch = J['hip_L'].z - .085 * k
        m = self.mask({FS['pelvis'], FS['thigh_L'], FS['thigh_R'], FS['belly']}, lambda c: crotch - .07 * k < c.z < top)
        sh, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Undershorts', self.col)
        C.inflate(sh.data, .0035 * k); C.smooth(sh.data, 6, .5, pin=C.boundary_vertices(sh.data))
        self.keep_off_body(sh, .003 * k)
        C.cut_plane(sh, (0, 0, crotch - .06 * k), (0, 0, 1))
        self.finish(sh, self.mat('undershorts', P['navy'], .85), .0015 * k)
        self.hide |= C.shrink_mask(self.me, m & np.array([c.z > crotch - .045 * k for c in self.centre]), 1)

    # -- trousers ------------------------------------------------------------------------
    def trousers(self, shorts=False):
        P = self.P; k = self.k; J = self.J
        top = self.waist_z + .005 * k
        hem_z = (J['knee_L'].z + .14 * k) if shorts else (J['ankle_L'].z + .035 * k)
        m = self.mask({FS['pelvis'], FS['belly'], FS['thigh_L'], FS['thigh_R'], FS['shin_L'], FS['shin_R']},
                      lambda c: hem_z - .03 < c.z < top + .02)
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Trousers', self.col)
        me = ob.data
        C.inflate(me, .010 * k)
        co = C.coords(me)
        for side, sgn in (('L', 1), ('R', -1)):
            hip = J['hip_L' if side == 'L' else 'hip_R']; ankle = J['ankle_' + side]
            leg = [i for i, p in enumerate(co) if sgn * p[0] > .012 and p[2] < J['hip_L'].z - .06 * k]
            C.bridge_slices(me, ankle, hip - ankle, .95, step=.014, select=leg)
        co = C.coords(me)
        seat = [i for i, p in enumerate(co) if p[2] > J['hip_L'].z - .09 * k]
        C.bridge_slices(me, (0, 0, 0), (0, 0, 1), .8, step=.012, select=seat)
        # Below the knee the leg falls straight: blend each ring toward a slim tube.
        co = C.coords(me)
        for side, sgn in (('L', 1), ('R', -1)):
            knee = J['knee_' + side]; ankle = J['ankle_' + side]
            for i, p in enumerate(co):
                if sgn * p[0] > .012 and p[2] < knee.z:
                    t = (knee.z - p[2]) / (knee.z - ankle.z)
                    cx = mix(knee.x, ankle.x, t); cy = mix(knee.y, ankle.y + .006, t)
                    r = mix(.066, .057, t) * k
                    d = np.array([p[0] - cx, p[1] - cy]); n = np.linalg.norm(d)
                    if n > 1e-6:
                        q = np.array([cx, cy]) + d / n * max(r, n * .4 + r * .6)
                        w = smooth_np(t * 1.4)
                        co[i][:2] = co[i][:2] * (1 - w) + q * w
        if shorts:
            # A tailored short with a little A-line at the hem.
            for side, sgn in (('L', 1), ('R', -1)):
                hip = J['hip_L' if side == 'L' else 'hip_R']; knee = J['knee_' + side]
                ax = (knee - hip).normalized()
                for i, p in enumerate(co):
                    if sgn * p[0] > .012 and p[2] < hem_z + .07 * k:
                        c = hip + ax * (V(p) - hip).dot(ax)
                        d = V(p) - c
                        if d.length > 1e-6:
                            w = smooth_np((hem_z + .07 * k - p[2]) / (.08 * k))
                            co[i] = np.array(V(p) + d.normalized() * .012 * k * w)
        C.set_coords(me, co)
        C.smooth(me, 16, .5, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, .008 * k)
        self.clamp_drift(ob, used, .05 * k)
        C.cut_plane(ob, (0, 0, top), (0, 0, -1), keep_positive=True)
        # The hem breaks a little lower at the back over the shoe.
        C.cut_plane(ob, (0, .0, hem_z), V((0, -.18, 1)).normalized(), keep_positive=True)
        twill = self.textures.normal('twill')
        TX.cylinder_uv(ob, (0, 0, 0), (0, 0, 1), 34)
        self.finish(ob, self.mat('trousers', P['trousers'], .86, normal_image=twill, normal_strength=.22), None)
        C.smooth_weights(ob, 5, .35)
        self.trouser_ob = ob
        self.hide |= C.shrink_mask(self.me, m & np.array([hem_z + .02 < c.z < top - .01 for c in self.centre]), 2)
        self.belt(top)

    def belt(self, top):
        P = self.P; k = self.k
        z = top - .016 * k
        band = [c for c, f in zip(self.centre, self.fs) if abs(c[2] - z) < .01 and f in (FS['pelvis'], FS['belly'], FS['torso'])]
        band = np.array(band)
        hull = C.hull2d([tuple(np.round(p[:2], 5)) for p in band]); cen = band[:, :2].mean(axis=0)
        pts = []
        for i in range(96):
            a = 2 * math.pi * i / 96
            q = C.project_to_hull(cen + np.array([math.sin(a), -math.cos(a)]) * .5, hull, cen)
            q = cen + (q - cen) * 1.0 + (q - cen) / np.linalg.norm(q - cen) * .0105 * k
            pts.append(V((q[0], q[1], z)))
        b = C.tube(f'Golfer_v3_{self.v}_Belt', pts, [(.0035 * k, .016 * k)] * len(pts), self.col, 8, closed=True, caps=False)
        C.transfer_weights(b, self.trouser_ob)
        leather = self.textures.normal('leather')
        self.finish(b, self.mat('belt', P['belt'], .45, normal_image=leather, normal_strength=.3))
        self.belt_ob = b
        front = min(pts, key=lambda p: p.y)
        buckle = C.tube(f'Golfer_v3_{self.v}_Buckle', [front + V((-.018 * k, -.004, 0)), front + V((.018 * k, -.004, 0))],
                        [(.014 * k, .003), (.014 * k, .003)], self.col, 4)
        C.transfer_weights(buckle, self.trouser_ob)
        self.finish(buckle, self.mat('buckle', '#C9CCCF', .25, metal=1.0))

    # -- shoes and socks -------------------------------------------------------------------
    def shoes(self):
        P = self.P; k = self.k; J = self.J
        co_body = C.coords(self.me)
        vfs = {}
        for p, f in zip(self.me.polygons, self.fs):
            for i in p.vertices:
                vfs.setdefault(i, set()).add(f)
        for side, sgn in (('L', 1), ('R', -1)):
            ankle = J['ankle_' + side]; heel = J['heel_' + side]; tip = J['toe_tip_' + side]
            sets = {FS['foot_' + side], FOREFOOT[side]} | TOES[side] | {FS['shin_' + side]}
            foot = np.array([co_body[i] for i, fs in vfs.items() if fs & sets and co_body[i][2] < ankle.z + .03 * k])
            y0, y1 = foot[:, 1].max() + .006 * k, foot[:, 1].min() - .010 * k     # heel, toe
            stations = 30; ring_n = 28
            sole = .012 * k
            sections = []
            for si in range(stations + 1):
                t = si / stations; y = mix(y0, y1, t)
                band = foot[np.abs(foot[:, 1] - y) < .009 * k]
                if len(band) < 4:
                    band = foot[np.abs(foot[:, 1] - y) < .02 * k]
                xmin, xmax = band[:, 0].min(), band[:, 0].max()
                ztop = band[:, 2].max()
                # Round the heel and the toe box.
                end_heel = smooth_np(1 - t / .10); end_toe = smooth_np((t - .80) / .20)
                w = (xmax - xmin) / 2 + .0085 * k
                w *= 1 - .45 * end_heel ** 2 - .55 * end_toe ** 2.2
                top = min(ztop + .008 * k, ankle.z + .02 * k)
                top = top * (1 - .15 * end_toe) + sole * .15 * end_toe
                if t > .96:
                    top = mix(top, sole + .012 * k, (t - .96) / .04)
                    w *= 1 - (t - .96) / .04 * .7
                xm = (xmin + xmax) / 2
                sections.append((y, xm, w, top))
            verts = []
            for y, xm, w, top in sections:
                for j in range(ring_n):
                    th = 2 * math.pi * j / ring_n
                    cx = math.cos(th); sz = math.sin(th)
                    x = xm + w * math.copysign(abs(cx) ** .55, cx)
                    if sz >= 0:
                        z = sole + (top - sole) * abs(sz) ** .5
                    else:
                        z = sole * (1 - abs(sz) ** .35 * .9)
                    verts.append((x, y, z))
            faces = []
            for si in range(stations):
                for j in range(ring_n):
                    a_ = si * ring_n + j; b_ = si * ring_n + (j + 1) % ring_n
                    faces.append((a_, b_, b_ + ring_n, a_ + ring_n))
            faces.append(tuple(reversed(range(ring_n))))
            faces.append(tuple(stations * ring_n + j for j in range(ring_n)))
            me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Shoe_{side}'); me.from_pydata(verts, [], faces); me.update()
            ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
            for p in me.polygons:
                p.use_smooth = True
            C.smooth(me, 7, .4)
            # The collar of the shoe opens below the ankle bone.
            C.cut_plane(ob, (ankle.x, ankle.y, ankle.z - .012 * k), V((0, -.42, 1)).normalized(), keep_positive=False)
            C.solidify(ob, .0028 * k, -1)
            C.transfer_weights(ob, self.body)
            leather = self.textures.normal('leather')
            TX.scale_uv_box(ob, 30)
            upper = self.mat('shoe leather', P['shoe'], .42, normal_image=leather, normal_strength=.25, coat=.15)
            accent = self.mat('shoe accent', P['accent'], .5)
            ob.data.materials.clear(); ob.data.materials.append(upper); ob.data.materials.append(accent)
            for p in ob.data.polygons:
                c = p.center
                if c.y > y0 - .035 * k and c.z > .03 * k:
                    p.material_index = 1                         # heel counter
                if c.y < y1 + .045 * k and c.z < sole + .012 * k:
                    p.material_index = 1                         # toe bumper
            C.smooth_weights(ob, 2)
            ob.parent = self.rig; mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = self.rig
            self.parts.append(ob)
            # The sole: the bottom outline, extruded, with a little toe spring.
            ring = []
            for y, xm, w, top in sections + [(sections[-1][0] - .003, sections[-1][1], sections[-1][2] * .5, 0)]:
                ring.append((xm + w + .003 * k, y))
            ring = ring + [(xm - w - .003 * k, y) for y, xm, w, top in reversed(sections)]
            levels = [0.0, .007 * k, sole + .004 * k]
            sv = []; sf = []
            for z in levels:
                for x, y in ring:
                    spring = .009 * k * max(0.0, (y0 - y) / (y0 - y1) - .8) / .2
                    sv.append((x, y, z + spring))
            n = len(ring)
            for l in range(len(levels) - 1):
                for j in range(n):
                    a_ = l * n + j; b_ = l * n + (j + 1) % n
                    sf.append((a_, b_, b_ + n, a_ + n))
            sf.append(tuple(reversed(range(n)))); sf.append(tuple((len(levels) - 1) * n + j for j in range(n)))
            sme = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Sole_{side}'); sme.from_pydata(sv, [], sf); sme.update()
            so = bpy.data.objects.new(sme.name, sme); self.col.objects.link(so)
            so.data.materials.append(self.mat('outsole', P['outsole'], .8))
            so.data.materials.append(self.mat('midsole', P['sole'], .6))
            for p in sme.polygons:
                p.use_smooth = False
                if p.center.z > .006 * k:
                    p.material_index = 1
            C.transfer_weights(so, self.body)
            C.smooth_weights(so, 2)
            so.parent = self.rig; mod = so.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = self.rig
            self.parts.append(so)
            # Laces across the instep.
            bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
            laces = []
            for i in range(5):
                y = mix(ankle.y - .045 * k, ankle.y - .105 * k, i / 4)
                row = []
                for x in (-.017, 0, .017):
                    hit = bvh.ray_cast(V((ankle.x + sgn * .004 + x * k, y, .3)), V((0, 0, -1)), 1)
                    if hit[0] is not None:
                        row.append(hit[0] + V((0, 0, .0012)))
                if len(row) == 3:
                    laces.append(C.tube(f'Golfer_v3_{self.v}_Lace', row, [.0016 * k] * 3, self.col, 6))
            lj = C.join(laces, f'Golfer_v3_{self.v}_Laces_{side}')
            if lj:
                C.transfer_weights(lj, self.body)
                self.finish(lj, self.mat('laces', '#FBFAF6', .7))
            self.hide |= self.mask({FS['foot_' + side], FOREFOOT[side]} | TOES[side])
            if self.v == 'female':
                self.sock(side, ankle.z - .012 * k)

    def sock(self, side, shoe_top):
        P = self.P; k = self.k
        lo, hi = shoe_top - .02 * k, shoe_top + .035 * k
        m = self.mask({FS['shin_' + side]}, lambda c: lo < c.z < hi + .01)
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Sock_{side}', self.col)
        C.inflate(ob.data, .0018 * k)
        C.cut_plane(ob, (0, 0, hi), (0, 0, -1))
        rib = self.textures.normal('rib')
        TX.cylinder_uv(ob, self.J['ankle_' + side], (0, 0, 1), 70, .05)
        self.finish(ob, self.mat('sock', '#F7F6F2', .9, normal_image=rib, normal_strength=.5), .0015 * k)
        self.hide |= C.shrink_mask(self.me, m & np.array([c.z < hi - .006 for c in self.centre]), 1)

    # -- glove ------------------------------------------------------------------------------
    def glove(self):
        P = self.P; k = self.k; J = self.J
        wrist = J['wrist_L']
        sets = {FS['hand_L']} | {s for f in FINGERS['L'].values() for s in f} | {FS['forearm_L']}
        el = J['elbow_L']; ax = (wrist - el).normalized()
        m = self.mask(sets, lambda c: (V(c) - wrist).dot(ax) > -.03 * k)
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Glove', self.col)
        C.inflate(ob.data, .0011 * k)
        C.cut_plane(ob, wrist - ax * .022 * k, ax, keep_positive=True)
        leather = self.textures.normal('leather')
        self.finish(ob, self.mat('glove', '#F8F7F3', .55, normal_image=leather, normal_strength=.35), .0008 * k)
        self.hide |= C.shrink_mask(self.me, m & np.array([(V(c) - wrist).dot(ax) > -.012 * k for c in self.centre]), 1)

    # -- head: hair, visor or cap, braid --------------------------------------------------------
    def head_frame(self):
        J = self.J
        eye = (J['eye_L'] + J['eye_R']) / 2
        centre = V((0, J['ears'].y + .01, J['ears'].z + .03 * self.k))
        return eye, centre

    def hairline(self, c, eye, centre):
        """True above the hairline (front: forehead, sides: above the ears, back: the nape)."""
        a = math.atan2(c[0] - centre.x, -(c[1] - centre.y))        # 0 front, +-pi back
        front = eye.z + .062 * self.k
        side = self.J['ears'].z + (.004 if self.v == 'female' else .022) * self.k
        nape = self.J['ears'].z - (.075 if self.v == 'female' else .055) * self.k
        u = abs(a) / math.pi
        if u < .5:
            h = mix(front, side, smooth_np(u / .5))
        else:
            h = mix(side, nape, smooth_np((u - .5) / .5))
        return c[2] > h

    def hair(self):
        P = self.P; k = self.k
        eye, centre = self.head_frame()
        excluded = {FS['ear_L'], FS['ear_R'], FS['eyelid_L'], FS['eyelid_R'], FS['mouth'], FS['chin'], FS['jaw']}
        m = self.mask({FS['head']}, lambda c: self.hairline(c, eye, centre)) & ~np.isin(self.fs, list(excluded))
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Hair', self.col)
        me = ob.data
        co = C.coords(me)
        bnd = C.boundary_vertices(me)
        thick = np.zeros(len(co))
        for i, p in enumerate(co):
            h = p[2] - (eye.z + .03 * k)
            base = (.0085 if self.v == 'female' else .0045) * k
            thick[i] = base * (.35 + .65 * smooth_np(h / (.07 * k)))
            if self.v == 'female' and p[1] > centre.y and p[2] < centre.z:
                thick[i] += .004 * k * smooth_np((p[1] - centre.y) / .06)
        # Fade to the skin at the hairline.
        dist_edge = self._edge_distance(me, bnd)
        thick *= np.clip(dist_edge / (.012 * k), .15, 1.0)
        C.inflate(me, thick)
        C.smooth(me, 4, .4, pin=bnd)
        TX.hair_uv(ob, centre, (V((0, .55, -.83)) if self.v == 'female' else V((0, .25, -.97))))
        strands = self.textures.normal('hair')
        hair_col = self.textures.hair_color(P['hair'], P['hair_hi'])
        mat = self.mat('hair', P['hair'], .5, normal_image=strands, normal_strength=.8, color_image=hair_col, specular=.6)
        self.finish(ob, mat, None)
        if self.v == 'female':
            self.braid(centre)

    def _edge_distance(self, me, boundary):
        nb = C.neighbours(me); co = C.coords(me)
        dist = np.full(len(co), 1e9)
        frontier = list(boundary)
        for i in frontier:
            dist[i] = 0.0
        import heapq
        heap = [(0.0, i) for i in frontier]
        while heap:
            d, i = heapq.heappop(heap)
            if d > dist[i]:
                continue
            for j in nb[i]:
                nd = d + float(np.linalg.norm(co[i] - co[j]))
                if nd < dist[j]:
                    dist[j] = nd; heapq.heappush(heap, (nd, j))
        return dist

    def braid(self, centre):
        """A three-strand braid along the braid bones, tied off with a coral band."""
        P = self.P; k = self.k
        bones = [b for b in self.rig.data.bones if b.name.startswith('Braid')]
        pts = [b.head_local.copy() for b in bones] + [bones[-1].tail_local.copy()]
        objs = []
        n_lobes = 19
        total = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1))
        def at(s):
            acc = 0
            for i in range(len(pts) - 1):
                L = (pts[i + 1] - pts[i]).length
                if acc + L >= s:
                    return pts[i].lerp(pts[i + 1], (s - acc) / L), (pts[i + 1] - pts[i]).normalized(), i
                acc += L
            return pts[-1], (pts[-1] - pts[-2]).normalized(), len(pts) - 2
        for j in range(n_lobes):
            s = (j + .5) / n_lobes * total * .93
            p, d, seg = at(s)
            taper = 1 - .45 * (j / n_lobes) ** 1.5
            side = d.cross(V((1, 0, 0))).normalized()
            off = V((1, 0, 0)) * (.0105 * k * (1 if j % 2 else -1)) * taper
            a = p + off * 1.1 - d * .019 * k; b = p - off * .35 + d * .019 * k
            lobe = C.tube(f'Golfer_v3_{self.v}_BraidLobe', [a, a.lerp(b, .5) + side * .004, b],
                          [(.012 * k * taper, .010 * k * taper), (.0175 * k * taper, .0135 * k * taper), (.008 * k * taper, .007 * k * taper)],
                          self.col, 14)
            C.rigid(lobe, bones[seg].name)
            objs.append(lobe)
        core_pts = [at(total * .93 * i / 24)[0] for i in range(25)]
        core = C.tube(f'Golfer_v3_{self.v}_BraidCore', core_pts,
                      [((.0125 - .005 * (i / 24) ** 1.3) * k, (.0100 - .004 * (i / 24) ** 1.3) * k) for i in range(25)], self.col, 14)
        cw = {}
        for vi in range(len(core.data.vertices)):
            ring = vi // 14
            s_ = total * .93 * min(ring, 24) / 24
            _, _, seg = at(s_)
            cw.setdefault(bones[seg].name, []).append(vi)
        for name, ids in cw.items():
            g = core.vertex_groups.get(name) or core.vertex_groups.new(name=name)
            g.add(ids, 1.0, 'REPLACE')
        objs.append(core)
        # Root where the hair gathers, the tie and a short tuft.
        root = C.tube(f'Golfer_v3_{self.v}_BraidRoot', [pts[0] - V((0, .02, -.01)), pts[0] + (pts[1] - pts[0]) * .4],
                      [(.024 * k, .018 * k), (.014 * k, .012 * k)], self.col, 14)
        C.rigid(root, bones[0].name); objs.append(root)
        end, d, seg = at(total * .93)
        tuft = C.tube(f'Golfer_v3_{self.v}_BraidTuft', [end, end + d * .03 * k, end + d * .055 * k],
                      [.007 * k, .009 * k, .002 * k], self.col, 10)
        C.rigid(tuft, bones[-1].name); objs.append(tuft)
        braid = C.join(objs, f'Golfer_v3_{self.v}_Braid')
        TX.scale_uv_box(braid, 18)
        strands = self.textures.normal('hair')
        hair_col = self.textures.hair_color(P['hair'], P['hair_hi'])
        self.finish(braid, self.mat('hair', P['hair'], .5, normal_image=strands, normal_strength=.8, color_image=hair_col, specular=.6), None, weights=False)
        tie_p, d, seg = at(total * .86)
        tie = C.tube(f'Golfer_v3_{self.v}_BraidTie', [tie_p - d * .006, tie_p + d * .006], [.0085 * k, .0085 * k], self.col, 14)
        C.rigid(tie, bones[seg].name)
        self.finish(tie, self.mat('tie', P['accent'], .6), None, weights=False)

    def head_dome(self, z_lo, z_hi, lift, rows=14, cols=72, front_only=None):
        """A shell over the head between two edge heights (functions of azimuth)."""
        J = self.J; k = self.k
        c = V((0, J['ears'].y + .008, J['ears'].z + .02 * k))
        verts = []
        for r in range(rows + 1):
            t = r / rows
            for j in range(cols):
                a = -math.pi + 2 * math.pi * j / cols
                zl, zh = z_lo(a), (z_hi(a) if z_hi else None)
                el_lo = math.asin(max(-.99, min(.99, (zl - c.z) / (.105 * k))))
                el_hi = math.asin(max(-.99, min(.99, (zh - c.z) / (.105 * k)))) if zh is not None else math.radians(89)
                e = mix(el_lo, el_hi, t)
                d = V((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))
                hit = self.bvh.ray_cast(c + d * .35, -d, .35)
                base = hit[0] if hit[0] is not None else c + d * .1 * k
                verts.append(base + d * lift(a, e))
        faces = []
        for r in range(rows):
            for j in range(cols):
                a_ = r * cols + j; b_ = r * cols + (j + 1) % cols
                faces.append((a_, b_, b_ + cols, a_ + cols))
        return c, verts, faces

    def headwear(self):
        P = self.P; k = self.k; J = self.J
        eye, centre = self.head_frame()
        front_z = eye.z + .040 * k
        def edge(a):
            u = abs(a) / math.pi
            return mix(front_z, J['ears'].z + .028 * k, smooth_np(u / .5)) if u < .5 else mix(J['ears'].z + .028 * k, J['ears'].z - .004 * k, smooth_np((u - .5) / .5))
        if self.v == 'female':
            hair_lift = .0105 * k
            c, verts, faces = self.head_dome(edge, lambda a: edge(a) + .034 * k, lambda a, e: hair_lift, rows=4)
            name = 'Visor'
        else:
            hair_lift = .0070 * k
            def lift(a, e):
                return hair_lift + .006 * k * max(0.0, math.sin(e))   # a little crown height
            c, verts, faces = self.head_dome(edge, None, lift, rows=16)
            name = 'Cap'
        me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_{name}'); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
        ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        C.smooth(me, 4, .4, pin=C.boundary_vertices(me))
        if self.v == 'male':
            # Merge the pole into a button-topped crown.
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.004 * k)
            bm.to_mesh(me); bm.free()
        TX.cylinder_uv(ob, c, (0, 0, 1), 40, .1)
        cotton = self.textures.normal('twill')
        self.finish(ob, self.mat('headwear', P['headwear'], .75, sheen=.2, normal_image=cotton, normal_strength=.3), .0028 * k, weights=False)
        C.rigid(ob, 'Head')
        # The bill, from the front of the lower edge, curved across and down.
        bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
        rows = 8; cols = 33; verts = []
        for r in range(rows + 1):
            t = r / rows
            for cc in range(cols):
                a = mix(-.92, .92, cc / (cols - 1))
                dir_ = V((math.sin(a), -math.cos(a), 0))
                z0 = edge(a) + .003 * k
                hit = bvh.ray_cast(V((c.x, c.y, z0)) + dir_ * .3, -dir_, .35)
                base = hit[0] if hit[0] is not None else V((c.x, c.y, z0)) + dir_ * .1 * k
                reach = (.074 if self.v == 'male' else .070) * k * math.cos(a * .66) ** 1.3
                p = base + dir_ * (reach * t - .002)
                p.z -= (.012 * k) * t ** 1.5 + .004 * k * (a / .92) ** 2 * t
                verts.append(tuple(p))
        faces = []
        for r in range(rows):
            for cc in range(cols - 1):
                a_ = r * cols + cc
                faces.append((a_, a_ + 1, a_ + 1 + cols, a_ + cols))
        bme = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Bill'); bme.from_pydata(verts, [], faces); bme.update()
        bill = bpy.data.objects.new(bme.name, bme); self.col.objects.link(bill)
        for p in bme.polygons:
            p.use_smooth = True
        C.solidify(bill, .0034 * k, 0)
        bill.data.materials.append(self.mat('headwear', P['headwear'], .75))
        bill.data.materials.append(self.mat('bill under', P['bill_under'], .8))
        for p in bill.data.polygons:
            if p.normal.z < -.3:
                p.material_index = 1
        C.rigid(bill, 'Head')
        bill.parent = self.rig; mod = bill.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = self.rig
        self.parts.append(bill)
        if self.v == 'male':
            top = V((c.x, c.y, max(v.co.z for v in ob.data.vertices)))
            btn = C.tube(f'Golfer_v3_{self.v}_CapButton', [top - V((0, 0, .002)), top + V((0, 0, .004))], [.0065 * k, .005 * k], self.col, 12)
            C.rigid(btn, 'Head'); self.finish(btn, self.mat('headwear', P['headwear'], .75), weights=False)
            hit = bvh.ray_cast(V((0, -.5, front_z + .034 * k)), V((0, 1, 0)), 1)
            if hit[0] is not None:
                q = hit[0] + V((0, -.0012, 0))
                flag = C.tube(f'Golfer_v3_{self.v}_CapFlag', [q - V((0, 0, .011 * k)), q + V((0, 0, .011 * k))], [.0012 * k] * 2, self.col, 6)
                pennant = C.tube(f'Golfer_v3_{self.v}_CapPennant', [q + V((0, 0, .011 * k)), q + V((.011 * k, 0, .007 * k))],
                                 [(.0035 * k, .0007), (.0005, .0005)], self.col, 4)
                emb = C.join([flag, pennant], f'Golfer_v3_{self.v}_CapEmblem')
                C.rigid(emb, 'Head'); self.finish(emb, self.mat('emblem', P['bill_under'], .7), weights=False)

    def earrings(self):
        k = self.k
        for side in 'LR':
            ear = [c for c, f in zip(self.centre, self.fs) if f == FS['ear_' + side]]
            lobe = min(ear, key=lambda c: c[2])
            p = V(lobe) + V((0, -.002, -.001))
            e = C.tube(f'Golfer_v3_{self.v}_Earring_{side}', [p + V((0, .0, -.0025)), p + V((0, 0, .0025))], [.0026 * k, .0026 * k], self.col, 12)
            C.rigid(e, 'Head'); self.finish(e, self.mat('gold', '#D9B35E', .25, metal=1.0), weights=False)

    # -- body skin and eyes -----------------------------------------------------------------------
    def skin(self):
        P = self.P
        tex = TX.bake_skin(self.G, self.P, self.v)
        self.body.data.materials.clear()
        self.body.data.materials.append(tex['material'])
        TX.bake_eyes(self.G, P, self.v)


def mix(a, b, t):
    return a + (b - a) * t


def smooth_np(x):
    x = min(1.0, max(0.0, float(x))); return x * x * (3 - 2 * x)


def dress(G, collection):
    O = Outfit(G, collection)
    O.polo()
    # Tailored shorts for her, trousers for him: both follow each leg cleanly
    # through every swing (a pleated skirt needs cloth simulation to do that).
    O.trousers(shorts=O.v == 'female')
    O.shoes(); O.glove()
    O.hair(); O.headwear()
    if O.v == 'female':
        O.earrings()
    import os
    if os.environ.get('GOLFER_FAST'):
        plain_materials(G)
    else:
        O.skin()
    C.delete_body_faces(O.body, O.hide)
    G['outfit'] = O.parts
    G['design'] = __doc__.split('\n\n')[1].strip() if __doc__ else ''
    return {}
