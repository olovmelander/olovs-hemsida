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
    # Vivid on the green: a coral-red polo with royal navy and a teal accent for her,
    # cobalt with Swedish-yellow tipping for him.
    'female': dict(skin='#ECC0A4', polo='#F2503A', trim='#FBF9F4', navy='#1C3A86', hair='#7E5A36', hair_hi='#C29560',
                   shoe='#FBFAF6', accent='#F2503A', sole='#FBF9F4', outsole='#1C3A86', lip='#D8645A', iris='#2F8FB5',
                   headwear='#FBFAF6', bill_under='#11A7A1', trousers='#1C3A86', belt='#11A7A1', tie='#11A7A1'),
    'male': dict(skin='#A86E4F', polo='#1F5FD6', trim='#F7C93C', navy='#16357F', hair='#2B1D15', hair_hi='#54392A',
                 shoe='#FBFAF6', accent='#1F5FD6', sole='#F4F1EA', outsole='#B9844C', trousers='#E6DAC0', belt='#A65A24',
                 lip='#AE5E4C', iris='#5B381F', headwear='#FBFAF6', bill_under='#1F5FD6', tie='#F7C93C'),
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
        kw.setdefault('specular', .26)        # cloth and leather: a soft, low highlight
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
        C.inflate(me, (.0095 if self.v == 'female' else .010) * k)
        # Bridge the hollows of the trunk (not the arms).
        co = C.coords(me)
        trunk = [i for i, p in enumerate(co) if abs(p[0]) < .145 * k or p[2] > J['shoulder_L'].z - .03]
        C.bridge_slices(me, (0, 0, 0), (0, 0, 1), .96 if self.v == 'female' else .9, step=.012, select=trunk)
        for side in 'LR':
            sh, el = self.arm_frame(side); ax = (el - sh).normalized()
            co = C.coords(me)
            arm = [i for i, p in enumerate(co) if (V(p) - sh).dot(ax) > .03 and (V(p) - (sh + ax * (V(p) - sh).dot(ax))).length < .09 * k]
            if arm:
                C.bridge_slices(me, sh, ax, .7, step=.012, select=arm)
        C.smooth(me, 26, .5, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, (.0065 if self.v == 'female' else .0075) * k)
        C.smooth(me, 6, .35, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, (.005 if self.v == 'female' else .0055) * k)
        self.clamp_drift(ob, used, .045 * k)
        self.tuck(ob)
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
        polo_mat = self.mat('polo pique', P['polo'], .86, normal_image=pique, normal_strength=.45, specular=.18)
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

    def tuck(self, ob):
        """Tucked in: snug under the waistband, bloused a little just above it.

        The blouse overhangs the trousers' top edge, so from above no gap between
        the shirt and the waistband shows.
        """
        k = self.k; me = ob.data
        top = self.waist_z + .005 * k                       # the trousers' top edge
        co = C.coords(me)
        for i, p in enumerate(co):
            z = p[2]
            if z > top + .07 * k or abs(p[0]) > .2 * k:
                continue
            hit = self.bvh.find_nearest(V(p))
            if hit[0] is None:
                continue
            loc, nrm = hit[0], hit[1]
            gap = (V(p) - loc).dot(nrm)
            flat = V((nrm.x, nrm.y, 0))
            flat = flat.normalized() if flat.length > 1e-6 else nrm
            tuck = smooth_np((top - .004 * k - z) / (.02 * k))
            blouse = smooth_np((z - (top - .008 * k)) / (.014 * k)) * (1 - smooth_np((z - (top + .018 * k)) / (.05 * k)))
            a = math.atan2(p[0], -p[1])
            # Gathered: soft vertical folds where the fabric bunches over the band.
            gather = .55 + .45 * math.sin(11 * a + 1.7 * math.sin(3 * a)) * math.sin(7 * a + .6)
            g = mix(gap, .0035 * k, tuck) + (.0075 if self.v == 'male' else .0062) * k * blouse * (.55 + .9 * gather)
            co[i] = np.array(loc + nrm * g)
        C.set_coords(me, co)

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
            stand_h = (.020 - .004 * front) * k
            q0 = p + V((0, 0, -.003))
            q1 = p + V((0, 0, stand_h)) + out * .0015
            q2 = q1 + out * .0055 * k + V((0, 0, .001))
            leaf = (.029 + .021 * front ** 1.6) * k
            q3 = q2 + out * leaf * .46 + V((0, 0, -leaf * .88)) + V((0, -.008 * front, 0))
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
        trim = self.mat('collar', P['trim'] if self.v == 'female' else P['polo'], .82, specular=.2)
        self.finish(ob, trim, .0018 * k, offset=0)
        if self.v == 'male':
            edge = [r[3] for r in rows]
            t = C.tube(f'Golfer_v3_{self.v}_CollarTipping', edge, [.0016 * k] * len(edge), self.col, 6)
            C.transfer_weights(t, self.polo_ob)
            self.finish(t, self.mat('tipping', P['trim'], .55))

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
            self.finish(ob, self.mat('sleeve band', P['trim'], .8, specular=.2), .0016 * k, offset=0)

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
        C.inflate(me, (.009 if shorts else .015) * k)
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
                    r = mix(.074, .063, t) * k
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
        # The front rise drapes straight from the hips: smooth the crotch hard, so the
        # cloth spans the hollows instead of following the anatomy.
        co = C.coords(me); hipz = J['hip_L'].z
        rise = {i for i, p in enumerate(co) if abs(p[0]) < .075 * k and hipz - .17 * k < p[2] < hipz + .03 * k}
        if rise:
            pin = set(range(len(co))) - rise
            C.smooth(me, 30, .5, pin=pin | C.boundary_vertices(me))
            co = C.coords(me)
            for i in rise:
                if co[i][1] < J['hip_L'].y and abs(co[i][0]) < .045 * k:
                    co[i][1] -= .004 * k * smooth_np(1 - abs(co[i][0]) / (.045 * k))
            C.set_coords(me, co)
        self.keep_off_body(ob, (.008 if shorts else .012) * k)
        self.clamp_drift(ob, used, .06 * k)
        import time as _t; _t0 = _t.time()
        # The waistband closes on the tucked shirt: no opening shows above the belt.
        polo = getattr(self, 'polo_ob', None)
        if polo is not None:
            pbvh = BVHTree.FromObject(polo, bpy.context.evaluated_depsgraph_get())
            hem = self.waist_z - (.035 if self.v == 'female' else .025) * k
            z_lo = max(top - .045 * k, hem + .012 * k)
            co = C.coords(me)
            for i, p in enumerate(co):
                if p[2] < z_lo or p[2] > top + .03 * k:
                    continue
                hit = pbvh.find_nearest(V(p))
                if hit[0] is None:
                    continue
                w = smooth_np((p[2] - z_lo) / max(top - z_lo, 1e-4))
                target = hit[0] + hit[1] * .0032 * k
                co[i] = co[i] * (1 - w) + np.array(target) * w
            C.set_coords(me, co)
        print(f'OUTFIT   waist hug {_t.time() - _t0:.1f}s')
        C.cut_plane(ob, (0, 0, top), (0, 0, -1), keep_positive=True)
        # The hem breaks a little lower at the back over the shoe.
        C.cut_plane(ob, (0, .0, hem_z), V((0, -.18, 1)).normalized(), keep_positive=True)
        self.fly(ob, top, J)
        twill = self.textures.normal('twill')
        TX.cylinder_uv(ob, (0, 0, 0), (0, 0, 1), 34)
        self.finish(ob, self.mat('trousers', P['trousers'], .86, normal_image=twill, normal_strength=.22), None)
        _t1 = _t.time(); C.smooth_weights(ob, 5, .35); print(f'OUTFIT   trouser weights {_t.time() - _t1:.1f}s')
        self.trouser_ob = ob
        self.hide |= C.shrink_mask(self.me, m & np.array([hem_z + .02 < c.z < top - .01 for c in self.centre]), 2)
        self.belt(top)

    def fly(self, ob, top, J):
        """The fly: a stitched J-curve on the front of the trousers or shorts."""
        k = self.k
        bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
        pts = []
        for i in range(12):
            t = i / 11
            z = top - .03 * k - t * .135 * k
            x = .018 * k * math.sin(math.pi / 2 * min(1.0, t * 1.25)) if t < .8 else .018 * k * (1 - (t - .8) / .2 * .9)
            hit = bvh.ray_cast(V((x, -.6, z)), V((0, 1, 0)), 1)
            if hit[0] is not None:
                pts.append(hit[0] + V((0, -.0009, 0)))
        if len(pts) > 5:
            t = C.tube(f'Golfer_v3_{self.v}_Fly', pts, [(.0011 * k, .0005)] * len(pts), self.col, 5)
            C.transfer_weights(t, ob)
            dark = tuple(max(0.0, c * .78) for c in C.hexrgb(self.P['trousers']))
            self.finish(t, self.mat('fly seam', '#%02X%02X%02X' % tuple(int(c * 255) for c in dark), .9))

    def belt(self, top):
        P = self.P; k = self.k
        z = top - .016 * k
        band = [c for c, f in zip(self.centre, self.fs) if abs(c[2] - z) < .01 and f in (FS['pelvis'], FS['belly'], FS['torso'])]
        band = np.array(band)
        hull = C.hull2d([tuple(np.round(p[:2], 5)) for p in band]); cen = band[:, :2].mean(axis=0)
        pts = []
        tbvh = BVHTree.FromObject(self.trouser_ob, bpy.context.evaluated_depsgraph_get())
        for i in range(96):
            a = 2 * math.pi * i / 96
            d = V((math.sin(a), -math.cos(a), 0))
            o = V((cen[0], cen[1], z))
            hit = tbvh.ray_cast(o + d * .4, -d, .4)
            if hit[0] is not None:
                pts.append(V((hit[0].x, hit[0].y, z)) + d * .0042 * k)
            else:
                q = C.project_to_hull(cen + np.array([d.x, d.y]) * .5, hull, cen)
                q = q + (q - cen) / np.linalg.norm(q - cen) * .0105 * k
                pts.append(V((q[0], q[1], z)))
        # A belt is a smooth band: relax the ring.
        for _ in range(6):
            pts = [pts[i] * .5 + (pts[i - 1] + pts[(i + 1) % len(pts)]) * .25 for i in range(len(pts))]
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

    def hairline_z(self, a, eye):
        """The hairline's height at an azimuth (0 front, +-pi back)."""
        front = eye.z + .062 * self.k
        side = self.J['ears'].z + (.004 if self.v == 'female' else .022) * self.k
        nape = self.J['ears'].z - (.075 if self.v == 'female' else .055) * self.k
        u = abs(a) / math.pi
        if u < .5:
            return mix(front, side, smooth_np(u / .5))
        return mix(side, nape, smooth_np((u - .5) / .5))

    def hairline(self, c, eye, centre):
        """True above the hairline (front: forehead, sides: above the ears, back: the nape)."""
        a = math.atan2(c[0] - centre.x, -(c[1] - centre.y))        # 0 front, +-pi back
        return c[2] > self.hairline_z(a, eye)

    def snap_hairline(self, ob, eye, centre):
        """Move the cut's sawtooth boundary onto the smooth hairline curve on the scalp."""
        me = ob.data; co = C.coords(me)
        bnd = sorted(C.boundary_vertices(me))
        for i in bnd:
            p = co[i]
            a = math.atan2(p[0] - centre.x, -(p[1] - centre.y))
            z = self.hairline_z(a, eye)
            d = V((math.sin(a), -math.cos(a), 0))
            o = V((centre.x, centre.y, z))
            hit = self.bvh.ray_cast(o + d * .3, -d, .3)
            if hit[0] is not None and abs(z - p[2]) < .03 * self.k:
                co[i] = np.array(hit[0])
        C.set_coords(me, co)
        # Relax the first rows inside the edge so the snap leaves no crease.
        C.smooth(me, 3, .5, pin=set(bnd))

    def hair(self):
        P = self.P; k = self.k
        eye, centre = self.head_frame()
        excluded = {FS['ear_L'], FS['ear_R'], FS['eyelid_L'], FS['eyelid_R'], FS['mouth'], FS['chin'], FS['jaw']}
        m = self.mask({FS['head']}, lambda c: self.hairline(c, eye, centre)) & ~np.isin(self.fs, list(excluded))
        ob, used = C.extract(self.body, m, f'Golfer_v3_{self.v}_Hair', self.col)
        me = ob.data
        self.snap_hairline(ob, eye, centre)
        co = C.coords(me)
        bnd = C.boundary_vertices(me)
        thick = np.zeros(len(co))
        for i, p in enumerate(co):
            h = p[2] - (eye.z + .03 * k)
            base = (.0085 if self.v == 'female' else .0032) * k
            thick[i] = base * (.35 + .65 * smooth_np(h / (.07 * k)))
            if self.v == 'female' and p[1] > centre.y and p[2] < centre.z:
                thick[i] += .004 * k * smooth_np((p[1] - centre.y) / .06)
        # Fade to the skin at the hairline.
        dist_edge = self._edge_distance(me, bnd)
        thick *= np.clip(dist_edge / ((.012 if self.v == 'female' else .02) * k), .15 if self.v == 'female' else 0.0, 1.0)
        C.inflate(me, thick)
        C.smooth(me, 4, .4, pin=bnd)
        TX.hair_uv(ob, centre, (V((0, .55, -.83)) if self.v == 'female' else V((0, .25, -.97))))
        strands = self.textures.normal('hair')
        hair_col = self.textures.hair_color(P['hair'], P['hair_hi'])
        mat = self.mat('hair', P['hair'], .52, normal_image=strands, normal_strength=.8, color_image=hair_col, specular=.38)
        if self.v == 'female':
            under = tuple(c * .62 for c in C.hexrgb(P['hair']))
            shell = self.mat('hair under', '#%02X%02X%02X' % tuple(int(c * 255) for c in under), .6,
                             normal_image=strands, normal_strength=.6, specular=.2)
        else:
            shell = mat
        self.finish(ob, shell, None)
        if self.v == 'female':
            self.braid(centre)
            self.strands(ob, eye, centre, mat)

    def strands(self, hair_ob, eye, centre, mat):
        """Clumps of combed-back hair from the visor line and the nape into the braid's root."""
        k = self.k; J = self.J
        bones = [b for b in self.rig.data.bones if b.name.startswith('Braid')]
        root = bones[0].head_local.copy() + V((0, -.004, .004))
        hbvh = BVHTree.FromObject(hair_ob, bpy.context.evaluated_depsgraph_get())
        c = V((0, J['ears'].y + .01, J['ears'].z + .03 * k))
        def surface(d):
            hit = hbvh.ray_cast(c + d * .3, -d, .3)
            return hit[0] if hit[0] is not None else c + d * .1 * k
        rd = (root - c).normalized()
        objs = []
        import random
        rng = random.Random(7)
        n = 72
        for i in range(n):
            a = -math.pi * .92 + 2 * math.pi * .92 * i / (n - 1) + rng.uniform(-.03, .03)
            u = abs(a) / math.pi
            if u < .62:
                z0 = self.hairline_z(a, eye) + .03 * k        # above the visor band
            else:
                z0 = self.hairline_z(a, eye) + .006 * k       # the nape, swept up
            d0 = V((math.sin(a), -math.cos(a), 0)) * .09 * k + V((0, 0, z0 - c.z))
            d0 = d0.normalized()
            pts = []
            steps = 18
            for j in range(steps + 1):
                t = j / steps
                d = d0.slerp(rd, t) if d0.angle(rd) > 1e-3 else d0
                # Over the crown the path bows up a little (the hair is full there).
                p = surface(d.normalized())
                lift = (.0008 + .0016 * math.sin(math.pi * t) + rng.uniform(0, .0005)) * k
                pts.append(p + (p - c).normalized() * lift)
            pts[-1] = pts[-1].lerp(root, .6)
            w = (.0074 + rng.uniform(-.0012, .0012)) * k
            radii = [(w * (.55 + .45 * math.sin(math.pi * min(1.0, .15 + .85 * j / steps))), .0011 * k) for j in range(steps + 1)]
            objs.append(self.ribbon(f'Golfer_v3_{self.v}_Strand', pts, radii, c))
        sj = C.join(objs, f'Golfer_v3_{self.v}_HairStrands')
        if sj:
            TX.scale_uv_box(sj, 18)
            C.rigid(sj, 'Head')
            self.finish(sj, mat, None, weights=False)

    def ribbon(self, name, pts, radii, centre, sides=6):
        """A flattened tube lying on the head: wide along the scalp, thin off it."""
        verts = []; faces = []; n = len(pts)
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            nrm = (p - centre); nrm = (nrm - t * t.dot(nrm)).normalized()
            b = t.cross(nrm).normalized()
            rx, ry = radii[i]
            for j in range(sides):
                a = 2 * math.pi * j / sides
                verts.append(tuple(p + b * (rx * math.cos(a)) + nrm * (ry * math.sin(a))))
        for i in range(n - 1):
            for j in range(sides):
                a = i * sides + j; b2 = i * sides + (j + 1) % sides
                faces.append((a, b2, b2 + sides, a + sides))
        faces.append(tuple(reversed(range(sides)))); faces.append(tuple((n - 1) * sides + j for j in range(sides)))
        me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
        ob = bpy.data.objects.new(name, me); self.col.objects.link(ob)
        for poly in me.polygons:
            poly.use_smooth = True
        return ob

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
        self.finish(braid, self.mat('hair', P['hair'], .52, normal_image=strands, normal_strength=.8, color_image=hair_col, specular=.38), None, weights=False)
        tie_p, d, seg = at(total * .86)
        tie = C.tube(f'Golfer_v3_{self.v}_BraidTie', [tie_p - d * .006, tie_p + d * .006], [.0085 * k, .0085 * k], self.col, 14)
        C.rigid(tie, bones[seg].name)
        self.finish(tie, self.mat('tie', P['tie'], .5), None, weights=False)

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

    def band(self, edge, lift, cols=72):
        """The headwear's band line: the head surface at the edge height, lifted off it."""
        J = self.J; k = self.k
        c = V((0, J['ears'].y + .008, J['ears'].z + .02 * k))
        pts = []
        for j in range(cols):
            a = -math.pi + 2 * math.pi * j / cols
            d = V((math.sin(a), -math.cos(a), 0))
            z = edge(a)
            hit = self.bvh.ray_cast(V((c.x, c.y, z)) + d * .3, -d, .3)
            base = hit[0] if hit[0] is not None else V((c.x, c.y, z)) + d * .09 * k
            pts.append(base + d * lift)
        return c, pts

    def bill(self, name, edge, c, reach_c, half_angle=.92, pitch=9.0, curve=.012, thick=.0036):
        """A curved, D-shaped bill built as top, underside and rim (materials by construction)."""
        P = self.P; k = self.k
        rows = 9; cols = 35
        top = []
        for r in range(rows + 1):
            t = r / rows
            row = []
            for cc in range(cols):
                a = mix(-half_angle, half_angle, cc / (cols - 1))
                dir_ = V((math.sin(a), -math.cos(a), 0))
                z0 = edge(a) + .004 * k
                hit = self.bvh.ray_cast(V((c.x, c.y, z0)) + dir_ * .3, -dir_, .35)
                base = hit[0] if hit[0] is not None else V((c.x, c.y, z0)) + dir_ * .09 * k
                base = base + dir_ * .0075 * k
                u = abs(a) / half_angle
                reach = reach_c * k * (.10 + .90 * max(0.0, 1 - u ** 2.4) ** .6)
                fwd = V((0, -1, 0)).lerp(dir_, .6).normalized()
                p = base + fwd * reach * t
                # Pitched down and curved across: the sides fall away from the centre.
                p.z -= reach * t * math.tan(math.radians(pitch)) + curve * k * (u ** 2) * (.35 + .65 * t)
                row.append(p)
            top.append(row)
        nb = V((0, math.sin(math.radians(pitch)), math.cos(math.radians(pitch))))
        T = thick * k
        verts = []; faces = []; mats = []
        idx_top = {}; idx_bot = {}
        for r in range(rows + 1):
            for cc in range(cols):
                idx_top[r, cc] = len(verts); verts.append(tuple(top[r][cc]))
        for r in range(rows + 1):
            for cc in range(cols):
                idx_bot[r, cc] = len(verts); verts.append(tuple(top[r][cc] - nb * T))
        for r in range(rows):
            for cc in range(cols - 1):
                faces.append((idx_top[r, cc], idx_top[r, cc + 1], idx_top[r + 1, cc + 1], idx_top[r + 1, cc])); mats.append(0)
                faces.append((idx_bot[r, cc], idx_bot[r + 1, cc], idx_bot[r + 1, cc + 1], idx_bot[r, cc + 1])); mats.append(1)
        # Rim: the two side ends and the outer edge.
        ring = [(r, 0) for r in range(rows + 1)] + [(rows, cc) for cc in range(1, cols)] + [(r, cols - 1) for r in range(rows - 1, -1, -1)]
        for (a1, b1), (a2, b2) in zip(ring[:-1], ring[1:]):
            faces.append((idx_top[a1, b1], idx_bot[a1, b1], idx_bot[a2, b2], idx_top[a2, b2])); mats.append(0)
        me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
        for p, m in zip(me.polygons, mats):
            p.material_index = m; p.use_smooth = True
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
        me.update()
        ob = bpy.data.objects.new(name, me); self.col.objects.link(ob)
        ob.data.materials.append(self.mat('headwear', P['headwear'], .78, normal_image=self.textures.normal('twill'), normal_strength=.25))
        ob.data.materials.append(self.mat('bill under', P['bill_under'], .85))
        TX.scale_uv_box(ob, 40)
        C.rigid(ob, 'Head')
        ob.parent = self.rig; mod = ob.modifiers.new('Golfer rig', 'ARMATURE'); mod.object = self.rig
        self.parts.append(ob)
        return ob

    def headwear(self):
        P = self.P; k = self.k; J = self.J
        eye, centre = self.head_frame()
        front_z = eye.z + (.040 if self.v == 'female' else .044) * k
        def edge(a):
            u = abs(a) / math.pi
            return mix(front_z, J['ears'].z + .028 * k, smooth_np(u / .5)) if u < .5 else mix(J['ears'].z + .028 * k, J['ears'].z - .004 * k, smooth_np((u - .5) / .5))
        twill = self.textures.normal('twill')
        cloth = self.mat('headwear', P['headwear'], .78, normal_image=twill, normal_strength=.25)
        if self.v == 'female':
            hair_lift = .0105 * k
            c, verts, faces = self.head_dome(edge, lambda a: edge(a) + .027 * k, lambda a, e: hair_lift, rows=4)
            me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Visor'); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
            ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
            for p in me.polygons:
                p.use_smooth = True
            C.smooth(me, 4, .4, pin=C.boundary_vertices(me))
            TX.cylinder_uv(ob, c, (0, 0, 1), 40, .1)
            self.finish(ob, cloth, .0028 * k, weights=False)
            C.rigid(ob, 'Head')
            self.bill(f'Golfer_v3_{self.v}_Bill', edge, c, .072, half_angle=.95, pitch=11, curve=.010)
            return
        # A structured six-panel cap: the crown rises steeply from the band (the front
        # panels stand up off the forehead), rounds over a low top and is buttoned there.
        lift = .0062 * k
        c, band = self.band(edge, lift)
        top_z = J['head_top'].z + .010 * k
        axis = V((c.x, c.y + .006 * k, 0))
        rows = 20; cols = len(band)
        verts = []
        for r in range(rows + 1):
            th = (math.pi / 2) * (r / rows)
            for j, B in enumerate(band):
                a = -math.pi + 2 * math.pi * j / cols
                front = max(0.0, math.cos(a)) ** 1.5
                pexp = 2.6 + 1.2 * front                  # squarer at the structured front
                rvec = V((B.x - axis.x, B.y - axis.y, 0))
                r0 = rvec.length; dirh = rvec.normalized()
                H = top_z - B.z
                ct, st = math.cos(th), math.sin(th)
                rr = r0 * (abs(ct) ** (2 / pexp)) if r < rows else 0.0
                zz = B.z + H * (abs(st) ** (2 / pexp))
                verts.append(axis + dirh * rr + V((0, 0, zz)))
        faces = []
        for r in range(rows):
            for j in range(cols):
                a_ = r * cols + j; b_ = r * cols + (j + 1) % cols
                faces.append((a_, b_, b_ + cols, a_ + cols))
        me = bpy.data.meshes.new(f'Golfer_v3_{self.v}_Cap'); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=.0008 * k)
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(me.name, me); self.col.objects.link(ob)
        for p in me.polygons:
            p.use_smooth = True
        # Never inside the head: keep a felt's gap off the skull everywhere.
        self.keep_off_body(ob, .0055 * k)
        C.smooth(me, 3, .35, pin=C.boundary_vertices(me))
        self.keep_off_body(ob, .005 * k)
        TX.cylinder_uv(ob, c, (0, 0, 1), 40, .1)
        self.finish(ob, cloth, .0026 * k, weights=False)
        C.rigid(ob, 'Head')
        crown = ob
        # Panel seams and the top button.
        cbvh = BVHTree.FromObject(crown, bpy.context.evaluated_depsgraph_get())
        seams = []
        top = V((axis.x, axis.y, top_z))
        for deg in (30, 90, 150, -30, -90, -150):
            a = math.radians(deg)
            d = V((math.sin(a), -math.cos(a), 0))
            pts = []
            for i in range(14):
                el = math.radians(4 + 82 * i / 13)
                ray = V((math.cos(el) * d.x, math.cos(el) * d.y, math.sin(el)))
                o = V((axis.x, axis.y, edge(a) + .01 * k)) + ray * .25
                hit = cbvh.ray_cast(o, -ray, .3)
                if hit[0] is not None:
                    pts.append(hit[0] + hit[1] * .0007)
            if len(pts) > 4:
                seams.append(C.tube(f'Golfer_v3_{self.v}_CapSeam', pts, [.0011 * k] * len(pts), self.col, 5))
        sj = C.join(seams, f'Golfer_v3_{self.v}_CapSeams')
        if sj:
            C.rigid(sj, 'Head'); self.finish(sj, self.mat('cap seam', '#E4E1D8', .8), weights=False)
        hit = cbvh.ray_cast(top + V((0, 0, .1)), V((0, 0, -1)), .2)
        tp = hit[0] if hit[0] is not None else top
        btn = C.tube(f'Golfer_v3_{self.v}_CapButton', [tp - V((0, 0, .001)), tp + V((0, 0, .0032 * k)), tp + V((0, 0, .0042 * k))],
                     [.0068 * k, .0062 * k, .002 * k], self.col, 14)
        C.rigid(btn, 'Head'); self.finish(btn, cloth, weights=False)
        # The sweatband edge: a soft rolled rim along the band.
        rim = C.tube(f'Golfer_v3_{self.v}_CapRim', [p + (p - V((axis.x, axis.y, p.z))).normalized() * .0012 for p in band],
                     [.0022 * k] * len(band), self.col, 6, closed=True, caps=False)
        C.rigid(rim, 'Head'); self.finish(rim, cloth, weights=False)
        self.bill(f'Golfer_v3_{self.v}_Bill', edge, c, .080, half_angle=.98, pitch=9, curve=.024)
        # The embroidered flag: a cobalt staff and a sunny pennant on the front panels.
        hit = cbvh.ray_cast(V((0, -.5, front_z + .036 * k)), V((0, 1, 0)), 1)
        if hit[0] is not None:
            q = hit[0] + V((0, -.0010, 0))
            flag = C.tube(f'Golfer_v3_{self.v}_CapFlag', [q - V((0, 0, .012 * k)), q + V((0, 0, .012 * k))], [(.0013 * k, .0005)] * 2, self.col, 6)
            C.rigid(flag, 'Head'); self.finish(flag, self.mat('emblem', P['polo'], .7), weights=False)
            pennant = C.tube(f'Golfer_v3_{self.v}_CapPennant', [q + V((.0006, -.0002, .012 * k)), q + V((.0125 * k, -.0004, .008 * k))],
                             [(.0045 * k, .0005), (.0006, .0004)], self.col, 4)
            C.rigid(pennant, 'Head'); self.finish(pennant, self.mat('emblem flag', P['trim'], .7), weights=False)

    def lashes(self):
        """Upper lashes: clumped, curled blades along each lid margin, on the lid bones.

        The margin is found by rays from in front of the eye: scanning down, the
        first height at which the eyeball is nearer than the skin is the opening;
        the last skin hit above it is the margin.
        """
        k = self.k; fem = self.v == 'female'
        objs = []
        dg = bpy.context.evaluated_depsgraph_get()
        for side, eye in (('L', self.G['eyes'][0]), ('R', self.G['eyes'][1])):
            c = sum((v.co for v in eye.data.vertices), V()) / len(eye.data.vertices)
            ebvh = BVHTree.FromObject(eye, dg)
            margin = []
            for i in range(49):
                x = c.x + (-.0165 + .033 * i / 48)
                prev = None
                for j in range(110):
                    z = c.z + .016 - j * .0002
                    o = V((x, c.y - .06, z)); d = V((0, 1, 0))
                    hb = self.bvh.ray_cast(o, d, .1); he = ebvh.ray_cast(o, d, .1)
                    on_eye = he[0] is not None and (hb[0] is None or he[3] < hb[3] - 1e-5)
                    if on_eye:
                        if prev is not None:
                            margin.append(prev)
                        break
                    prev = hb[0].copy() if hb[0] is not None else None
            if len(margin) < 6:
                continue
            outer = 1 if side == 'L' else -1          # +x is the left eye's outer corner
            n = 30 if fem else 22
            xs = [p.x for p in margin]; x0, x1 = min(xs), max(xs)
            up = V((0, 0, 1)); fwd = V((0, -1, 0))
            for i in range(n):
                u = (i + .5) / n
                x = mix(x0, x1, u)
                p = min(margin, key=lambda q: abs(q.x - x))
                o = u if outer > 0 else 1 - u                # 0 inner corner .. 1 outer corner
                L = (.0046 if fem else .0032) * (.45 + .55 * math.sin(math.pi * min(1.0, .1 + o * .8)) ** .6) * (1 + (.25 if fem else .08) * o)
                lat = V((outer, 0, 0)) * (o - .45) * .6
                d0 = (fwd * .85 + up * .30 + lat).normalized()
                d1 = (fwd * .30 + up * .95 + lat * 1.2).normalized()
                root = p + fwd * .0002 + up * .0001
                pts = []
                for t in (0, .33, .66, 1.0):
                    d = d0.lerp(d1, t).normalized()
                    pts.append(root + d0 * L * t * .5 + d * L * t * .5)
                w0 = .00075 if fem else .0006
                blade = C.tube(f'Golfer_v3_{self.v}_Lash', pts, [(w0, .00016), (w0 * .8, .00014), (w0 * .5, .00011), (.00007, .00005)],
                               self.col, 4)
                C.rigid(blade, 'Lid_' + side)
                objs.append(blade)
        if not objs:
            return
        lashes = C.join(objs, f'Golfer_v3_{self.v}_Lashes')
        m = self.mat('lashes', '#1B1512' if fem else '#1E1813', .55)
        m.use_backface_culling = False
        self.finish(lashes, m, None, weights=False)

    def earrings(self):
        k = self.k
        for side in 'LR':
            ear = [c for c, f in zip(self.centre, self.fs) if f == FS['ear_' + side]]
            lobe = min(ear, key=lambda c: c[2])
            p = V(lobe) + V((0, -.002, -.001))
            e = C.tube(f'Golfer_v3_{self.v}_Earring_{side}', [p + V((0, .0, -.0025)), p + V((0, 0, .0025))], [.0026 * k, .0026 * k], self.col, 12)
            C.rigid(e, 'Head'); self.finish(e, self.mat('gold', '#D9B35E', .25, metal=1.0), weights=False)

    # -- body skin and eyes -----------------------------------------------------------------------
    def scalp_mask(self):
        """Float attribute for the skin bake: 1 above the hairline, fading over 1.5 cm below it."""
        eye, centre = self.head_frame()
        me = self.me; k = self.k
        low = self.J['ears'].z - .12 * k
        face = {FS['mouth'], FS['chin'], FS['jaw'], FS['eyelid_L'], FS['eyelid_R'], FS['ear_L'], FS['ear_R']}
        skip = set()
        for p, f in zip(me.polygons, self.fs):
            if f in face:
                skip.update(p.vertices)
        head = [i for i, vv in enumerate(me.vertices) if vv.co.z > low and i not in skip and abs(vv.co.x) < .12 * k]
        v = np.zeros(len(me.vertices), dtype=np.float32)
        for i in head:
            c = me.vertices[i].co
            a = math.atan2(c.x - centre.x, -(c.y - centre.y))
            if abs(a) < math.pi * .38:
                continue                       # no fade on the forehead
            h = self.hairline_z(a, eye)
            v[i] = smooth_np((c.z - (h - .015 * k)) / (.015 * k))
        attr = me.attributes.get('scalp_mask') or me.attributes.new('scalp_mask', 'FLOAT', 'POINT')
        attr.data.foreach_set('value', v)
        print('SCALP', int((v > .05).sum()), 'vertices')

    def skin(self):
        P = self.P
        if self.v == 'male':
            self.scalp_mask()
        tex = TX.bake_skin(self.G, self.P, self.v)
        self.body.data.materials.clear()
        self.body.data.materials.append(tex['material'])
        TX.bake_eyes(self.G, P, self.v)


def mix(a, b, t):
    return a + (b - a) * t


def smooth_np(x):
    x = min(1.0, max(0.0, float(x))); return x * x * (3 - 2 * x)


def dress(G, collection):
    import os, time
    O = Outfit(G, collection)
    clock = [time.time()]
    def lap(name):
        now = time.time(); print(f'OUTFIT {name} {now - clock[0]:.1f}s'); clock[0] = now
    O.polo(); lap('polo')
    # Tailored shorts for her, trousers for him: both follow each leg cleanly
    # through every swing (a pleated skirt needs cloth simulation to do that).
    O.trousers(shorts=O.v == 'female'); lap('trousers')
    O.shoes(); O.glove(); lap('shoes+glove')
    O.hair(); lap('hair')
    O.headwear(); lap('headwear')
    O.lashes(); lap('lashes')
    if O.v == 'female':
        O.earrings()
    if os.environ.get('GOLFER_FAST'):
        plain_materials(G)
    else:
        O.skin(); lap('skin bake')
    C.delete_body_faces(O.body, O.hide)
    G['outfit'] = O.parts
    G['design'] = __doc__.split('\n\n')[1].strip() if __doc__ else ''
    return {}
