"""Author Puttom architecture through the live Blender bridge without replacing other work.

All dimensions are in metres. Plan/height evidence is kept in the model plan;
facade openings and small architectural details are explicit reconstruction choices.
Only procedural geometry/materials are exported, never source photographs.
"""
import hashlib
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(globals().get('PUTTOM_REPO_ROOT', r'C:\Users\olov_\repos\olovs-hemsida'))
HERE = ROOT/'puttombuild/facilities/models-2026-09-10'
CACHE = ROOT/'puttombuild/cache/facilities-model-2026-09-10'
ORIGIN = (697365., 7025190., 44.)
SCENE_NAME = 'Puttom | Authored facilities 2026-09-10 r3'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def linear(value):
    return value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4


def color(hex_value):
    return tuple(linear(int(hex_value[i:i+2], 16)/255) for i in (0, 2, 4))


class Builder:
    def __init__(self, scene):
        self.scene, self.buckets, self.facilities, self.materials = scene, {}, {}, {}
        palette = {
            'red': ('993c31', .88, 0), 'red-dark': ('772d25', .88, 0),
            'white': ('e3e7dc', .64, 0), 'roof': ('474740', .77, .05),
            'roof-metal': ('303738', .54, .3), 'roof-red': ('934a38', .82, 0),
            'glass': ('355e6b', .21, .28), 'glass-dark': ('1e343a', .27, .2),
            'foundation': ('6a767b', .92, 0), 'blue-base': ('436473', .9, 0),
            'wood': ('796348', .9, 0), 'wood-dark': ('4c4437', .94, 0),
            'brick': ('9b6549', .95, 0), 'black': ('252a27', .7, .1),
            'roof-light': ('87928e', .68, .2), 'cream': ('ded6b8', .9, 0),
            'door-green': ('345851', .8, 0), 'clock': ('ede4c8', .8, 0),
            'metal': ('899496', .35, .65), 'lamp': ('f0dfac', .5, 0),
        }
        for name, (value, rough, metallic) in palette.items():
            self.material(name, color(value), rough, metallic)

    def material(self, name, rgb, rough=.8, metallic=0, alpha=1):
        mat = bpy.data.materials.new('PUT MODEL | '+name)
        mat.diffuse_color = (*rgb, alpha)
        mat.use_nodes = True
        node = mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Base Color'].default_value = (*rgb, 1)
        node.inputs['Roughness'].default_value = rough
        node.inputs['Metallic'].default_value = metallic
        node.inputs['Alpha'].default_value = alpha
        if alpha < 1:
            mat.surface_render_method = 'DITHERED'
        self.materials[name] = mat

    def mesh(self, fid, name, vertices, faces, role):
        key = (fid, role)
        bucket = self.buckets.setdefault(key, {'vertices': [], 'faces': [], 'elements': [], 'grounding': []})
        offset = len(bucket['vertices'])
        bucket['vertices'].extend([tuple(float(p[k])-ORIGIN[k] for k in range(3)) for p in vertices])
        bucket['grounding'].extend([(0,(0.,0.,0.),0.)]*len(vertices))
        bucket['faces'].extend([tuple(offset+i for i in face) for face in faces])
        bucket['elements'].append(name)

    def box(self, fid, name, center, size, role, angle=0):
        c, s = math.cos(angle), math.sin(angle)
        vertices = []
        for z in (-.5, .5):
            for x, y in [(-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5)]:
                u, v = x*size[0], y*size[1]
                vertices.append((center[0]+u*c-v*s, center[1]+u*s+v*c, center[2]+z*size[2]))
        self.mesh(fid, name, vertices, [(3,2,1,0), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)], role)

    def beam(self, fid, name, start, end, width, depth, role):
        # mathutils uses float32. Work near zero so centimetre details survive
        # the seven-digit projected northing; mesh() receives Python doubles.
        a, b = [Vector(tuple(p[k]-ORIGIN[k] for k in range(3))) for p in (start,end)]
        direction = b-a
        assert direction.length > .001, name
        direction.normalize()
        side = direction.cross(Vector((0,0,1)))
        if side.length < .01:
            side = direction.cross(Vector((0,1,0)))
        side.normalize()
        up = direction.cross(side).normalized()
        vertices = [tuple(ORIGIN[k]+float((p+side*u*width/2+up*v*depth/2)[k]) for k in range(3)) for p in (a,b)
                    for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        self.mesh(fid, name, vertices, [(3,2,1,0), (4,5,6,7), (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)], role)

    def cylinder(self, fid, name, start, end, radius, role, sides=8):
        a, b = [Vector(tuple(p[k]-ORIGIN[k] for k in range(3))) for p in (start,end)]
        direction = (b-a).normalized()
        side = direction.cross(Vector((0,0,1)))
        if side.length < .01:
            side = direction.cross(Vector((0,1,0)))
        side.normalize()
        up = direction.cross(side).normalized()
        vertices = [tuple(ORIGIN[k]+float((p+radius*(side*math.cos(2*math.pi*i/sides)+up*math.sin(2*math.pi*i/sides)))[k]) for k in range(3))
                    for p in (a,b) for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range(sides,2*sides))]
        faces += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
        self.mesh(fid, name, vertices, faces, role)

    def prism(self, fid, name, ring, bottom, top, role):
        ring = list(ring)
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1])) < 0:
            ring.reverse()
        size = len(ring)
        vertices = [(p[0],p[1],bottom) for p in ring]+[(p[0],p[1],top) for p in ring]
        faces = [tuple(reversed(range(size))), tuple(range(size,2*size))]
        faces += [(i,(i+1)%size,(i+1)%size+size,i+size) for i in range(size)]
        self.mesh(fid, name, vertices, faces, role)

    def finish(self):
        for fid, data in self.facilities.items():
            parent = bpy.data.objects.new(fid, None)
            parent['facilityId'] = fid
            parent['sourceBuildingIds'] = data.get('sourceBuildingIds', [])
            parent['evidence'] = json.dumps(data, ensure_ascii=False)
            parent['groundAnchorEpsg3006'] = data['groundAnchorEpsg3006']
            parent['groundAnchorRh2000M'] = data['groundAnchorRh2000M']
            parent['footprintEpsg3006'] = json.dumps(data['footprintEpsg3006'])
            parent['kind'] = data['kind']
            parent['excludeVegetation'] = data.get('excludeVegetation', True)
            parent['placement'] = data.get('placement','absolute-rh2000')
            self.scene.collection.objects.link(parent)
            for (owner, role), bucket in self.buckets.items():
                if owner != fid:
                    continue
                mesh = bpy.data.meshes.new(fid+' | '+role)
                mesh.from_pydata(bucket['vertices'], [], bucket['faces'])
                mesh.update()
                # A clipped millimetre sliver may collapse when Blender stores
                # local positions as float32. Remove only truly zero-area triangles.
                zero_faces=[p.index for p in mesh.polygons if len(p.vertices)==3 and
                            (mesh.vertices[p.vertices[1]].co-mesh.vertices[p.vertices[0]].co).cross(
                                mesh.vertices[p.vertices[2]].co-mesh.vertices[p.vertices[0]].co).length_squared==0]
                if zero_faces:
                    edit=bmesh.new(); edit.from_mesh(mesh); edit.faces.ensure_lookup_table()
                    bmesh.ops.delete(edit,geom=[edit.faces[i] for i in zero_faces],context='FACES_ONLY')
                    edit.to_mesh(mesh); edit.free(); mesh.update()
                    mesh['pruned_zero_area_source_facets']=len(zero_faces)
                mesh.materials.append(self.materials[role])
                if any(item[0] for item in bucket['grounding']):
                    assert data['kind']=='site', 'Architecture must retain source heights'
                    # Creating a CustomData layer may invalidate prior RNA handles.
                    # Allocate all layers first, then fetch each by name to write.
                    mesh.attributes.new('ground_anchor_local','FLOAT_VECTOR','POINT')
                    mesh.attributes.new('ground_mode','INT','POINT')
                    mesh.attributes.new('ground_clearance','FLOAT','POINT')
                    mesh.attributes['ground_anchor_local'].data.foreach_set('vector',[v for item in bucket['grounding'] for v in item[1]])
                    mesh.attributes['ground_mode'].data.foreach_set('value',[item[0] for item in bucket['grounding']])
                    mesh.attributes['ground_clearance'].data.foreach_set('value',[item[2] for item in bucket['grounding']])
                    assert [v.value for v in mesh.attributes['ground_mode'].data]==[item[0] for item in bucket['grounding']]
                    for index,item in enumerate(bucket['grounding']):
                        assert math.dist(mesh.attributes['ground_anchor_local'].data[index].vector,item[1])<.0001
                        assert abs(mesh.attributes['ground_clearance'].data[index].value-item[2])<.00001
                obj = bpy.data.objects.new(fid+' | '+role, mesh)
                self.scene.collection.objects.link(obj)
                obj.parent = parent
                obj['facilityId'], obj['materialRole'] = fid, role
                obj['elements'] = json.dumps(bucket['elements'])
                obj['production_geometry'] = True
                obj['castShadow'] = role not in ('net-mesh','paving-rose','paving-pale')
        assert {key[0] for key in self.buckets} == set(self.facilities)


def world(volume, u, v, h):
    origin, a, b = volume['originEpsg3006'], volume['axisU'], volume['axisV']
    return (origin[0]+a[0]*u+b[0]*v, origin[1]+a[1]*u+b[1]*v, h)


def angle(volume):
    return math.atan2(volume['axisU'][1], volume['axisU'][0])


def rect(volume, u0, u1, v0, v1):
    return [world(volume,u,v,0)[:2] for u,v in [(u0,v0),(u1,v0),(u1,v1),(u0,v1)]]


def box_uv(b, fid, volume, name, u, v, h, su, sv, sh, role):
    b.box(fid,name,world(volume,u,v,h),(su,sv,sh),role,angle(volume))


def window(b, fid, f, u, v, h, width=1.25, height=1.3, label='window'):
    side = 1 if v > 0 else -1
    box_uv(b,fid,f,label+' surround',u,v,h,width+.17,.12,height+.17,'white')
    box_uv(b,fid,f,label+' pane',u,v+side*.075,h,width,.05,height,'glass')
    box_uv(b,fid,f,label+' mullion',u,v+side*.108,h,.055,.03,height,'white')
    box_uv(b,fid,f,label+' crossbar',u,v+side*.11,h,width,.035,.048,'white')
    box_uv(b,fid,f,label+' sill',u,v+side*.15,h-height/2-.07,width+.26,.28,.085,'white')


def door(b, fid, f, u, v, floor, label='door', role='door-green', width=1):
    side = 1 if v > 0 else -1
    box_uv(b,fid,f,label+' frame',u,v,floor+1.08,width+.18,.15,2.18,'white')
    box_uv(b,fid,f,label+' leaf',u,v+side*.1,floor+1.05,width,.065,2.05,role)
    box_uv(b,fid,f,label+' handle',u+width*.34,v+side*.15,floor+1.03,.055,.07,.16,'metal')
    box_uv(b,fid,f,label+' step',u,v+side*.40,floor-.02,width+.35,.85,.18,'foundation')


def roof(b, fid, f):
    half_l, half_w = f['length']/2+f.get('roofOverhang',.3), f['width']/2+f.get('roofOverhang',.3)
    eave, ridge = f['eaveH'], f['ridgeH']
    role = f.get('roofMaterial', 'roof')
    trim = f.get('trimMaterial','white')
    kind = f['roofType']
    if f.get('roofSurfacePolygonsENH'):
        for index,polygon in enumerate(f['roofSurfacePolygonsENH']):
            b.mesh(fid,f['id']+' joined roof surface '+str(index),polygon,[tuple(range(len(polygon)))],role)
        # Fascia follows the exposed perimeter of the joined roof. The plan
        # resolves the inner valley and the lower outside hip separately.
        for index,segment in enumerate(f.get('exteriorRoofSegmentsENH',[])):
            if math.dist(segment[0],segment[1])>.01:
                b.beam(fid,'joined roof fascia '+str(index),segment[0],segment[1],.1,.14,trim)
        for index,segment in enumerate([] if f.get('exteriorRoofSegmentsENH') else f.get('exteriorWallSegmentsEpsg3006',[])):
            a,c = segment
            local=[]
            for p in (a,c):
                dx,dy = p[0]-f['originEpsg3006'][0],p[1]-f['originEpsg3006'][1]
                u,v = dx*f['axisU'][0]+dy*f['axisU'][1],dx*f['axisV'][0]+dy*f['axisV'][1]
                local.append((u,v))
            if abs(local[0][1]-local[1][1])<.05:
                b.beam(fid,'joined roof eaves',(a[0],a[1],eave-.08),(c[0],c[1],eave-.08),.1,.14,trim)
        return
    if kind == 'hip':
        top = [world(f,u,v,eave) for u,v in [(-half_l,-half_w),(half_l,-half_w),(half_l,half_w),(-half_l,half_w)]]
        ridge_half = max(0,half_l-half_w)
        if ridge_half < .05:
            top.append(world(f,0,0,ridge))
            faces = [(0,1,4),(1,2,4),(2,3,4),(3,0,4)]
        else:
            top.extend([world(f,-ridge_half,0,ridge),world(f,ridge_half,0,ridge)])
            faces = [(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4)]
        b.mesh(fid,f['id']+' hipped roof',top,faces,role)
        for i in range(4):
            b.beam(fid,'hip eaves',top[i],top[(i+1)%4],.12,.16,trim)
        return
    if kind in ('flat', 'shed'):
        high_side = f.get('roofHighSide', 'v+')
        if kind == 'flat':
            heights = [eave]*4
        elif high_side == 'v+':
            heights = [eave,eave,ridge,ridge]
        elif high_side == 'v-':
            heights = [ridge,ridge,eave,eave]
        elif high_side == 'u+':
            heights = [eave,ridge,ridge,eave]
        else:
            heights = [ridge,eave,eave,ridge]
        uv = [(-half_l,-half_w),(half_l,-half_w),(half_l,half_w),(-half_l,half_w)]
        top = [world(f,u,v,z) for (u,v),z in zip(uv,heights)]
        b.mesh(fid,f['id']+' roof',top+[(e,n,h-.13) for e,n,h in top],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],role)
        for index in range(4):
            b.beam(fid,'roof fascia',top[index],top[(index+1)%4],.11,.17,trim)
        return
    # Solid gabled roof skin: top faces plus soffit sides, one cap at each end.
    for side in (-1,1):
        top = [world(f,-half_l,0,ridge),world(f,half_l,0,ridge),
               world(f,half_l,side*half_w,eave),world(f,-half_l,side*half_w,eave)]
        if side < 0:
            top.reverse()
        verts = top+[(e,n,h-.13) for e,n,h in top]
        b.mesh(fid,f['id']+' roof slope '+str(side),verts,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],role)
        b.beam(fid,'eaves gutter',world(f,-half_l,side*half_w,eave-.08),world(f,half_l,side*half_w,eave-.08),.12,.16,'roof-metal')
        for end in (-1,1):
            b.beam(fid,'bargeboard',world(f,end*half_l,0,ridge),world(f,end*half_l,side*half_w,eave),.13,.18,trim)
        # Few geometric standing seams preserve roof rhythm at course viewing distances.
        pitch = .95 if role == 'roof-metal' else 1.45
        count = max(1,int(2*half_l/pitch))
        for index in range(1,count):
            u = -half_l+2*half_l*index/count
            b.beam(fid,'roof seam',world(f,u,0,ridge+.024),world(f,u,side*half_w,eave+.024),.028,.026,role)
    b.beam(fid,'ridge cap',world(f,-half_l,0,ridge+.04),world(f,half_l,0,ridge+.04),.16,.12,role)


def shell(b, fid, f, detail=True):
    ground = f['groundH']
    floor = f.get('floorH',ground+.18)
    eave, ridge = f['eaveH'], f['ridgeH']
    half_l, half_w = f['length']/2, f['width']/2
    wall = f.get('wallMaterial','red')
    ring = f.get('wallRingEpsg3006') or rect(f,-half_l,half_l,-half_w,half_w)
    minimum = min(f.get('groundCornerH',[ground]))
    foundation_role = 'blue-base' if f['id']=='clubhouse-main' or f.get('facade',{}).get('foundationColour')=='blue-grey' else 'foundation'
    b.prism(fid,f['id']+' foundation',ring,minimum-.45,floor+.48 if f['id']=='clubhouse-main' else floor+.28,foundation_role)
    if f.get('exteriorWallPolygonsENH'):
        for index,polygon in enumerate(f['exteriorWallPolygonsENH']):
            b.mesh(fid,f['id']+' exposed wall '+str(index),polygon,[tuple(range(len(polygon)))],wall)
    else:
        b.prism(fid,f['id']+' timber walls',ring,floor+.12,eave-.05,wall)
    if f['roofType'] == 'gable' and not f.get('exteriorWallPolygonsENH'):
        for side in (-1,1):
            verts = [world(f,side*half_l,-half_w,eave-.08),world(f,side*half_l,half_w,eave-.08),world(f,side*half_l,0,ridge-.1)]
            if side < 0:
                verts.reverse()
            b.mesh(fid,f['id']+' gable',verts,[(0,1,2)],wall)
    elif f['roofType'] == 'shed':
        # Fill the triangular/high wall under the sloping roof.
        high_v = half_w if f.get('roofHighSide','v+')=='v+' else -half_w
        for side in (-1,1):
            verts = [world(f,side*half_l,-high_v,eave-.08),world(f,side*half_l,high_v,eave-.08),world(f,side*half_l,high_v,ridge-.08)]
            if (side < 0) != (high_v < 0):
                verts.reverse()
            b.mesh(fid,f['id']+' shed end',verts,[(0,1,2)],wall)
        face = [world(f,-half_l,high_v,eave-.08),world(f,half_l,high_v,eave-.08),world(f,half_l,high_v,ridge-.08),world(f,-half_l,high_v,ridge-.08)]
        if high_v > 0:
            face.reverse()
        b.mesh(fid,f['id']+' shed high wall',face,[(0,1,2,3)],wall)
    roof(b,fid,f)
    for side in (-1,1):
        for u in (-half_l+.08,half_l-.08):
            box_uv(b,fid,f,'corner trim',u,side*(half_w+.03),(floor+eave)/2,.14,.1,eave-floor,f.get('trimMaterial','white'))
            if eave-floor>2:
                b.cylinder(fid,'rainwater pipe',world(f,u,side*(half_w+.17),floor+.1),world(f,u,side*(half_w+.17),eave-.12),.05,'roof-metal')
        if detail:
            count = max(1,round(f['length']/3.5))
            for index in range(count):
                u = -half_l+(index+.5)*f['length']/count
                window(b,fid,f,u,side*(half_w+.04),floor+1.5,1.0,1.15)
    return floor


def gable_frame(f):
    return {**f, 'axisU': f['axisV'], 'axisV': [-p for p in f['axisU']]}


def porch(b, fid, f, u, v, floor, width=2.35, projection=1.6):
    side = 1 if v > 0 else -1
    edge = v+side*projection
    roof_h = floor+2.45
    for local_u in (-width/2,width/2):
        b.beam(fid,'entrance porch post',world(f,u+local_u,edge,floor),world(f,u+local_u,edge,roof_h),.12,.12,'white')
    for lo,hi in [(-width/2,0),(0,width/2)]:
        zlo = roof_h+.5*(1-abs(lo)/(width/2))
        zhi = roof_h+.5*(1-abs(hi)/(width/2))
        top = [world(f,u+lo,v,zlo),world(f,u+hi,v,zhi),world(f,u+hi,edge,zhi-.04),world(f,u+lo,edge,zlo-.04)]
        if side < 0:
            top.reverse()
        b.mesh(fid,'peaked porch canopy',top,[(0,1,2,3)],'roof-metal')
        b.beam(fid,'peaked porch fascia',world(f,u+lo,edge,zlo-.04),world(f,u+hi,edge,zhi-.04),.12,.16,f.get('trimMaterial','white'))


def rail(b, fid, f, u0, u1, v, floor, height=.98):
    length = abs(u1-u0)
    count = max(2,math.ceil(length/1.8))
    for index in range(count+1):
        u = u0+(u1-u0)*index/count
        b.beam(fid,'terrace post',world(f,u,v,floor),world(f,u,v,floor+height),.105,.105,'wood-dark')
    for z in (.38,height):
        b.beam(fid,'terrace rail',world(f,u0,v,floor+z),world(f,u1,v,floor+z),.10,.12,'wood-dark')
    for index in range(max(1,int(length/.32))):
        u = u0+(u1-u0)*(index+.5)/max(1,int(length/.32))
        b.beam(fid,'terrace baluster',world(f,u,v,floor+.13),world(f,u,v,floor+.9),.035,.035,'wood-dark')


def clubhouse(b, fid, f):
    floor = shell(b,fid,f,False)
    half_l, half_w = f['length']/2, f['width']/2
    eave, ridge = f['eaveH'], f['ridgeH']
    facade = f.get('facade',{})
    glass_base = facade.get('glazingBaseH',floor+.52)
    mid = facade.get('glazingTransomH',floor+3.1)
    return_length = facade.get('glassReturnLength',4.5)
    face_u = half_l+.065
    # The actual south gable is a continuous glazed wall up into its triangular roof.
    edge = half_w-.13
    vertices = [world(f,face_u,-edge,glass_base),world(f,face_u,edge,glass_base),
                world(f,face_u,edge,eave-.11),world(f,face_u,0,ridge-.22),world(f,face_u,-edge,eave-.11)]
    b.mesh(fid,'south glazed gable',vertices,[(0,1,2,3,4)],'glass')
    for i in range(5):
        b.beam(fid,'glazed gable perimeter',vertices[i],vertices[(i+1)%5],.15,.15,'white')
    for z in (glass_base+.1,mid,eave-.15):
        b.beam(fid,'gable window transom',world(f,face_u+.06,-edge,z),world(f,face_u+.06,edge,z),.105,.12,'white')
    count = 8
    for i in range(count+1):
        v = -edge+2*edge*i/count
        top = eave-.15+(ridge-eave-.08)*(1-abs(v)/edge)
        b.beam(fid,'gable vertical mullion',world(f,face_u+.065,v,glass_base),world(f,face_u+.065,v,top),.1,.1,'white')
    for side in (-1,1):
        face_v = side*(half_w+.07)
        u0,u1 = half_l-return_length,half_l
        glass = [world(f,u0,face_v,glass_base),world(f,u1,face_v,glass_base),world(f,u1,face_v,eave-.12),world(f,u0,face_v,eave-.12)]
        if side > 0:
            glass.reverse()
        b.mesh(fid,'side glazing return',glass,[(0,1,2,3)],'glass')
        for z in (glass_base+.05,mid,eave-.14):
            b.beam(fid,'side glazing transom',world(f,u0,face_v+side*.07,z),world(f,u1,face_v+side*.07,z),.11,.1,'white')
        for i in range(4):
            u = u0+(u1-u0)*i/3
            b.beam(fid,'side glazing mullion',world(f,u,face_v+side*.075,glass_base),world(f,u,face_v+side*.075,eave-.12),.105,.105,'white')
        # Four small upper lights, with taller lower windows along the timber portion.
        for index,u in enumerate((-7.8,-4.15,-.65,2.55)):
            window(b,fid,f,u,side*(half_w+.05),eave-1.1,1.6 if index==2 else 1.2,.62,'upper clubhouse window')
            if side < 0 or abs(u-facade.get('mainEntranceU',-3.7))>1.2:
                window(b,fid,f,u,side*(half_w+.05),floor+1.78,1.3,1.45,'lower clubhouse window')
        # Restrained vertical battens make the timber facade read at close range.
        for index in range(1,int((2*half_l-return_length)/.52)):
            u = -half_l+index*.52
            if u < half_l-return_length-.2:
                box_uv(b,fid,f,'timber batten',u,side*(half_w+.014),(floor+eave)/2,.028,.021,eave-floor-.25,'red-dark')
    entry_u = facade.get('mainEntranceU',-3.7)
    door(b,fid,f,entry_u,half_w+.04,floor+.03,'main double entrance','white',1.55)
    porch(b,fid,f,entry_u,half_w+.12,floor,2.4,1.25)
    # Opposite north gable has a traditional upper window and the small side entry.
    gf = gable_frame(f)
    window(b,fid,gf,0,half_l+.06,floor+4.0,2.0,1.7,'north gable window')
    door(b,fid,gf,-half_w*.50,half_l+.08,floor,'north side entry','white')
    porch(b,fid,gf,-half_w*.50,half_l+.15,floor,1.8,1.0)
    # Broad wooden landing wraps the glazed end. Its boards and rail are actual geometry.
    terrace_floor = glass_base-.14
    deck = rect(f,half_l-.15,half_l+2.35,-half_w-.5,half_w+.5)
    b.prism(fid,'glazed end timber terrace',deck,terrace_floor-.20,terrace_floor,'wood')
    for i in range(int((2*half_w+1)/.20)):
        v = -half_w-.5+(i+.5)*.2
        b.beam(fid,'deck plank joint',world(f,half_l-.1,v,terrace_floor+.004),world(f,half_l+2.35,v,terrace_floor+.004),.012,.012,'wood-dark')
    front = gable_frame(f)
    rail(b,fid,front,-half_w-.45,half_w+.45,-(half_l+2.32),terrace_floor)
    rail(b,fid,f,half_l-.1,half_l+2.32,-half_w-.47,terrace_floor)
    rail(b,fid,f,half_l-.1,half_l+2.32,half_w+.47,terrace_floor)
    # West steps reach the lower campus without moving the building onto the old roof trace.
    bottom = min(f['groundCornerH'])+.06
    steps = max(3,math.ceil((terrace_floor-bottom)/.17))
    for i in range(steps):
        top = terrace_floor-(i+1)*(terrace_floor-bottom)/steps
        box_uv(b,fid,f,'terrace stair tread',half_l+1.0,-half_w-.7-i*.29,(bottom+top)/2,1.55,.31,max(.08,top-bottom+.09),'wood')
    # Brick chimney, roof flashing and two small vents from the entrance/aerial references.
    for u,v,role,size in [(-5.8,1.15,'brick',(.68,.78)),(4.0,-1.1,'roof-metal',(.27,.27))]:
        roof_h = ridge-(ridge-eave)*abs(v)/(half_w+.35)
        box_uv(b,fid,f,'roof flashing',u,v,roof_h+.025,size[0]+.3,size[1]+.3,.12,'roof-metal')
        box_uv(b,fid,f,'chimney stack',u,v,roof_h+.6,size[0],size[1],1.15,role)
        box_uv(b,fid,f,'chimney cap',u,v,roof_h+1.2,size[0]+.18,size[1]+.18,.14,'foundation')


def harbre(b, fid, f):
    f = {**f,'roofMaterial':'roof-metal','trimMaterial':'red-dark'}
    floor = shell(b,fid,f,False)
    l,w = f['length']/2,f['width']/2
    top = f['eaveH']
    for i in range(max(1,int((top-floor)/.20))):
        h = floor+.18+i*.2
        for side in (-1,1):
            box_uv(b,fid,f,'horizontal side log',0,side*(w+.045),h,f['length']+.24,.13,.155,'red')
            box_uv(b,fid,f,'exposed log end',side*(l+.05),0,h,.16,f['width']+.32,.155,'red-dark')
    gf = gable_frame(f)
    end = f.get('facade',{}).get('gableDoorEnd','u+')
    v = -(l+.13) if end == 'u+' else l+.13
    door(b,fid,gf,0,v,floor+.05,'harbre door','door-green',1.12)
    porch(b,fid,gf,0,v,floor,1.65,1.0)
    side = 1 if v>0 else -1
    for i in range(6):
        z = floor+.35+i*.23
        b.beam(fid,'door chevron',world(gf,-.45,v+side*.16,z+.15),world(gf,0,v+side*.16,z),.035,.025,'wood')
        b.beam(fid,'door chevron',world(gf,0,v+side*.16,z),world(gf,.45,v+side*.16,z+.15),.035,.025,'wood')
    window(b,fid,gf,0,v,floor+3.25,1.65,1.0,'upper double window')
    clock_h = floor+3.25
    clock_u = side*1.65
    center = world(gf,clock_u,v+side*.16,clock_h)
    outward = (gf['axisV'][0]*side,gf['axisV'][1]*side,0)
    b.cylinder(fid,'clock face',center,tuple(center[k]+outward[k]*.09 for k in range(3)),.29,'clock',24)
    b.beam(fid,'clock hour hand',world(gf,clock_u,v+side*.26,clock_h),world(gf,clock_u-.12,v+side*.26,clock_h+.09),.025,.025,'black')
    b.beam(fid,'clock minute hand',world(gf,clock_u,v+side*.27,clock_h),world(gf,clock_u+.06,v+side*.27,clock_h+.24),.018,.018,'black')
    if f.get('facade',{}).get('sideShelter'):
        canopy_width = f['facade'].get('sideShelterWidth',1.7)
        outer = w+canopy_width
        high,low = floor+2.45,floor+2.15
        b.mesh(fid,'harbre side shelter roof',[world(f,-l,w,high),world(f,l,w,high),world(f,l,outer,low),world(f,-l,outer,low)],[(0,1,2,3)],'roof-metal')
        for u in (-l+.15,l-.15):
            b.beam(fid,'harbre side shelter post',world(f,u,outer,floor),world(f,u,outer,low),.14,.14,'red')
        b.beam(fid,'harbre side shelter fascia',world(f,-l,outer,low),world(f,l,outer,low),.12,.16,'white')


def ancillary(b, fid, f):
    kind = f['kind']
    f = dict(f)
    if f['roofColour'] in ('red','red-brown','rust','rust-red','red-tile'):
        f['roofMaterial'] = 'roof-red'
    elif f['roofColour']=='light-grey':
        f['roofMaterial'] = 'roof-light'
    elif f['roofColour']=='brown-grey':
        f['roofMaterial'] = 'roof'
    elif kind in ('maintenance','range-building','shelter','connector','shed','unverified-shed'):
        f['roofMaterial'] = 'roof-metal'
    if f.get('facade',{}).get('wallColour')=='pale-cream':
        f['wallMaterial'] = 'cream'
    if kind in ('pavilion','conservatory','shelter'):
        floor = f.get('floorH',f['groundH']+.1)
        roof(b,fid,f)
        for e,n in f['wallRingEpsg3006']:
            b.beam(fid,'canopy upright',(e,n,floor),(e,n,f['eaveH']),.12,.12,'white')
        if kind != 'shelter':
            ring = f['wallRingEpsg3006']
            for a,c in zip(ring,ring[1:]+ring[:1]):
                b.mesh(fid,'glazed shelter panel',[(a[0],a[1],floor+.1),(c[0],c[1],floor+.1),(c[0],c[1],f['eaveH']-.1),(a[0],a[1],f['eaveH']-.1)],[(0,1,2,3)],'glass')
        b.prism(fid,'canopy deck',f['wallRingEpsg3006'],floor-.18,floor,'wood')
        return
    maintenance = kind == 'maintenance'
    detail = kind not in ('maintenance','connector','shed','unverified-shed')
    floor = shell(b,fid,f,detail)
    l,w = f['length']/2,f['width']/2
    if maintenance:
        # Taller broad workshop doors, narrow panels and corrugations match yard photographs.
        height = min(3.5,f['eaveH']-floor-.28)
        count = max(1,int(f['length']/6))
        for index in range(count):
            u = -l+(index+.5)*f['length']/count
            box_uv(b,fid,f,'machine hall door frame',u,w+.06,floor+height/2,3.65,.12,height+.15,'white')
            box_uv(b,fid,f,'machine hall door',u,w+.14,floor+height/2,3.43,.05,height,'red-dark')
            for row in range(1,int(height/.24)):
                box_uv(b,fid,f,'roller door seam',u,w+.18,floor+row*.24,3.4,.015,.018,'black')
            if index == 0:
                window(b,fid,f,u,w+.19,floor+height-.65,2.5,.5,'door glazing')
        for index in range(1,int(f['length']/.62)):
            u = -l+index*.62
            box_uv(b,fid,f,'rear vertical cladding',u,-w-.025,(floor+f['eaveH'])/2,.035,.022,f['eaveH']-floor-.15,'red-dark')
        door(b,fid,f,-l+1.0,-w-.04,floor,'yard access','white',.9)
    elif kind == 'range-building':
        door(b,fid,f,-l+2.0,w+.09,floor,'range entrance','white',1.05)
        porch(b,fid,f,-l+2.0,w+.16,floor,2.0,.9)
        # Long clubhouse/range buildings show light vertical trim around their low windows.
        for index in range(max(2,int(f['length']/.7))):
            u = -l+.35+index*.7
            if u < l-.2:
                box_uv(b,fid,f,'range timber batten',u,-w-.023,(floor+f['eaveH'])/2,.03,.02,f['eaveH']-floor-.15,'red-dark')
    elif detail:
        door(b,fid,f,-l*.35,w+.05,floor,'entry','white',.95)
        if f['length']>8:
            porch(b,fid,f,-l*.35,w+.12,floor,1.85,1.0)
    else:
        door(b,fid,f,0,w+.05,floor,'storage door','red-dark',1.1)


def convex_hull(points):
    points = sorted(set(tuple(p[:2]) for p in points))
    def cross(o,a,b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower,upper = [],[]
    for p in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=0:
            upper.pop()
        upper.append(p)
    return lower[:-1]+upper[:-1]


def site(b, plan):
    for name, material in plan['materialDefinitions'].items():
        rgba = material['baseColorRGBA']
        b.material(name,rgba[:3],material['roughness'],material['metallic'],rgba[3])
    evidence = {}
    ground_points = {}
    for item in plan['primitives']:
        fid = 'site-'+item['facilityId']
        role,name = item['materialRole'],item['id']
        vertex_start=len(b.buckets.get((fid,role),{}).get('vertices',[]))
        kind = item['type']
        evidence.setdefault(fid,[]).append({'id':name,'evidence':item['evidence'],'dimensionStatus':item['dimensionStatus'],
                                            'groundContact':item.get('groundContact')})
        if kind == 'box':
            center,size = item['centerENH'],item['sizeMetres']
            b.box(fid,name,center,size,role,item.get('rotationRadiansZ',0))
            ground_points.setdefault(fid,[]).append([center[0],center[1],center[2]-size[2]/2])
        elif kind == 'cylinder':
            b.cylinder(fid,name,item['startENH'],item['endENH'],item['radiusMetres'],role,item.get('sides',8))
            ground_points.setdefault(fid,[]).append(min([item['startENH'],item['endENH']],key=lambda p:p[2]))
        elif kind == 'mesh':
            b.mesh(fid,name,item['verticesENH'],item['faces'],role)
            ground_points.setdefault(fid,[]).extend(item['verticesENH'])
        else:
            raise ValueError('Unsupported site primitive: '+kind)
        contact=item.get('groundContact')
        if contact:
            mode={'rigid':1,'drape':2}[contact['mode']]
            anchor=tuple(contact['anchorENH'][k]-ORIGIN[k] for k in range(3)) if mode==1 else (0.,0.,0.)
            clearance=contact.get('clearanceMetres',0.)
            bucket=b.buckets[(fid,role)]
            for index in range(vertex_start,len(bucket['vertices'])):
                bucket['grounding'][index]=(mode,anchor,clearance)
    for fid, items in evidence.items():
        points = ground_points[fid]
        all_xy = [(p[0]+ORIGIN[0],p[1]+ORIGIN[1]) for (owner,_),bucket in b.buckets.items() if owner==fid for p in bucket['vertices']]
        hull = convex_hull(all_xy)
        assert len(hull)>=3, fid
        anchor = min(points,key=lambda p:p[2])
        b.facilities[fid] = {'sourceBuildingIds': [], 'groundAnchorEpsg3006': list(anchor[:2]),
                            'groundAnchorRh2000M': anchor[2], 'footprintEpsg3006': hull,
                            'kind':'site', 'excludeVegetation':False, 'evidence':items,
                            'placement':'absolute-rh2000'}


def add_camera(scene, name, position, target, scale):
    data = bpy.data.cameras.new(name)
    data.type, data.ortho_scale, data.clip_end = 'ORTHO',scale,4000
    obj = bpy.data.objects.new(name,data)
    obj.location = position
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.collection.objects.link(obj)
    return obj


def add_preview_context(scene, b):
    path = CACHE/'preview-ground.json'
    if path.exists():
        grid = json.loads(path.read_text(encoding='utf-8'))
        mesh = bpy.data.meshes.new('Puttom terrain for model review only')
        mesh.from_pydata(grid['verticesLocalENH'],[],grid['faces'])
        mesh.update()
        b.material('preview-grass',color('637349'),1,0)
        mesh.materials.append(b.materials['preview-grass'])
        obj = bpy.data.objects.new('Terrain preview - excluded from game asset',mesh)
        scene.collection.objects.link(obj)
        obj['production_geometry'] = False
    sun_data = bpy.data.lights.new('Puttom modelling daylight','SUN')
    sun_data.energy,sun_data.angle = 2.5,.13
    sun = bpy.data.objects.new('Puttom modelling daylight',sun_data)
    sun.rotation_euler = (math.radians(28),math.radians(-28),math.radians(-30))
    scene.collection.objects.link(sun)
    scene.world = bpy.data.worlds.new('Puttom model daylight')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.4,.5,.64,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .65
    scene.camera = add_camera(scene,'Puttom clubhouse review',(55,-66,35),(-3,-3,5),74)
    add_camera(scene,'Puttom whole campus review',(370,-310,330),(55,78,5),540)
    add_camera(scene,'Puttom range review',(130,-4,50),(55,68,4),140)
    add_camera(scene,'Puttom maintenance review',(255,190,62),(194,211,11),110)
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x,scene.render.resolution_y = 1800,1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'


def main():
    plan_path,site_path = HERE/'model-plan.json',HERE/'site-plan.json'
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    site_plan = json.loads(site_path.read_text(encoding='utf-8'))
    assert plan['groundId']==site_plan['groundId']=='puttom'
    output = CACHE/'puttom-facilities-v1.library.blend'
    assert not output.exists() and not bpy.data.scenes.get(SCENE_NAME), 'Preserve earlier artist work; use a new scene/output for revisions'
    previous_scene,previous_file = bpy.context.scene.name,bpy.data.filepath
    previous_selection = [obj.name for obj in bpy.context.selected_objects]
    previous_objects = {s.name: [(o.name,tuple(v for row in o.matrix_world for v in row)) for o in s.objects] for s in bpy.data.scenes}
    scene = bpy.data.scenes.new(SCENE_NAME)
    scene.unit_settings.system,scene.unit_settings.scale_length = 'METRIC',1
    scene['originEPSG3006RH2000'] = list(ORIGIN)
    scene['horizontal_crs'],scene['vertical_crs'] = 'EPSG:3006','RH2000'
    scene['replacesRangeFacilities'] = True
    scene['model_plan_sha256'],scene['site_plan_sha256'] = sha(plan_path),sha(site_path)
    b = Builder(scene)
    for volume in plan['volumes']:
        fid = volume['assembly']
        if fid not in b.facilities:
            b.facilities[fid] = {'sourceBuildingIds':[], 'groundAnchorEpsg3006':volume['originEpsg3006'],
                                'groundAnchorRh2000M':volume['groundH'], 'footprintEpsg3006':[],
                                'kind':'building','evidence':[], 'excludeVegetation':True}
        data = b.facilities[fid]
        data['sourceBuildingIds'].extend(volume['inheritedIds'])
        data['footprintEpsg3006'].extend(volume['roofRingEpsg3006'])
        data['evidence'].append(volume)
        if volume['id']=='clubhouse-main':
            clubhouse(b,fid,volume)
        elif volume['id']=='harbre':
            harbre(b,fid,volume)
        else:
            ancillary(b,fid,volume)
    for fid,data in b.facilities.items():
        # Explicit building exclusion is kept close to the building envelope.
        data['footprintEpsg3006'] = convex_hull(data['footprintEpsg3006'])
        assert len(data['sourceBuildingIds'])==len(set(data['sourceBuildingIds'])),fid
    site(b,site_plan)
    b.finish()
    add_preview_context(scene,b)
    text_blocks = set()
    for path in (plan_path,site_path,ROOT/'puttombuild/facilities/height-reference.json'):
        data = bpy.data.texts.new('PUT MODEL | '+path.name)
        data.write(path.read_text(encoding='utf-8'))
        data.use_fake_user = True
        text_blocks.add(data)
    assert bpy.context.scene.name==previous_scene and bpy.data.filepath==previous_file
    assert [obj.name for obj in bpy.context.selected_objects]==previous_selection
    assert all([(o.name,tuple(v for row in o.matrix_world for v in row)) for o in bpy.data.scenes[name].objects]==objects for name,objects in previous_objects.items())
    CACHE.mkdir(parents=True,exist_ok=True)
    bpy.data.libraries.write(str(output),{scene,*text_blocks},path_remap='RELATIVE_ALL',fake_user=True,compress=True)
    report = {'passed':True,'scene':scene.name,'blenderVersion':bpy.app.version_string,
              'libraryPath':output.relative_to(ROOT).as_posix(),'librarySha256':sha(output),
              'modelPlanSha256':sha(plan_path),'sitePlanSha256':sha(site_path),
              'buildingVolumes':len(plan['volumes']),'facilityGroups':len(b.facilities),
              'sitePrimitives':len(site_plan['primitives']),'productionMeshes':len(b.buckets),
              'sourceBuildingIds':plan['coveredInheritedIds'],
              'existingBlenderScenesAndSelectionPreserved':True,'previousActiveScene':previous_scene,
              'authoringStatus':'Production reconstruction; facade dimensions and undocumented small details are estimates'}
    (HERE/'blender-model-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':
    main()
