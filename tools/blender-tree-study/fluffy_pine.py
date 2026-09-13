"""Small textured-foliage experiment; background Blender only, explicit budgets."""
import bpy, math, random, sys, json, hashlib
from pathlib import Path
from mathutils import Vector
assert bpy.app.background
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from pine_meshes import Mesh, layout, build, material, linear
OUT = ROOT / 'apps/golf/public/models/trees/foliage-study'
DOC = ROOT / 'docs/graphics/tree-atelier-2026-09-13'
scene = bpy.context.scene; scene.name = 'Ghibli | Textured pine foliage'
for ob in list(scene.objects): bpy.data.objects.remove(ob, do_unlink=True)
image = bpy.data.images.load(str(OUT / 'needle-sprays.png')); image.pack()
leaf = material('Needle sprays | Alpha cutout', linear(0x597747))
leaf.use_backface_culling = False
leaf.surface_render_method = 'DITHERED'
nodes = leaf.node_tree.nodes; links = leaf.node_tree.links
tex = nodes.new('ShaderNodeTexImage'); tex.image = image
mix = nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
bs = nodes.get('Principled BSDF')
links.new(bs.inputs['Base Color'].links[0].from_socket, mix.inputs[1]); links.new(tex.outputs['Color'], mix.inputs[2]); links.new(mix.outputs[0], bs.inputs['Base Color'])
links.new(tex.outputs['Alpha'], bs.inputs['Alpha'])
mats = {'leaf': leaf, 'bark': material('Pine | Copper and grey bark', (1, 1, 1))}
report = {'design': 'textured-pine-experiment', 'source': 'Original seeded pine layout and original vector needle atlas', 'tiers': {}}
height, branches, clumps, pads = layout(9000)
for tier, per_clump, budget in [('hero', 20, 4500), ('full', 8, 1700), ('lite', 0, 420)]:
    old, trunk = build(9000, tier, scene.collection, mats)
    if tier == 'lite':
        crown = old
        crown.data.materials.clear(); crown.data.materials.append(material('Distant | Solid foliage', linear(0x597747)))
    else:
        bpy.data.objects.remove(old, do_unlink=True)
        mesh, uv = Mesh(), []
        rng = random.Random(9000)
        for c, radii, phase, undercut in clumps:
            r = Vector(radii)
            for j in range(per_clump):
                z = 1 - 2 * (j + .5) / per_clump
                a = j * 2.39996323 + phase
                direction = Vector((math.sqrt(1-z*z)*math.cos(a), math.sqrt(1-z*z)*math.sin(a), z))
                centre = c + Vector((direction[k]*r[k] for k in range(3))) * (.42 + .30*rng.random())
                face = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
                u = face.cross(Vector((0, 0, 1))).normalized(); v = face.cross(u).normalized()
                size = max(r.x, r.y) * (.45 if tier == 'hero' else .62) * rng.uniform(.85, 1.15)
                tile = rng.randrange(4); tx = tile % 2; ty = tile // 2
                ids = []
                pigment = rng.uniform(.88, 1.08)
                for x, y in [(-1,-1), (1,-1), (1,1), (-1,1)]:
                    p = centre + (u*x + v*y)*size
                    n = Vector(((p.x-c.x)/r.x, (p.y-c.y)/r.y, (p.z-c.z)/max(r.z, .2)))
                    n.z += .3; n.normalize()
                    ids.append(mesh.vert(p, n, (pigment, pigment, pigment)))
                    uv.append(((tx + (x+1)/2)/2, (ty + (y+1)/2)/2))
                mesh.faces.append(tuple(ids))
        crown = mesh.object('crown', leaf, scene.collection)
        attr = crown.data.uv_layers.new(name='UVMap')
        for loop in crown.data.loops: attr.data[loop.index].uv = uv[loop.vertex_index]
    tris = sum(len(p.vertices)-2 for ob in (crown,trunk) for p in ob.data.polygons)
    assert tris <= budget, (tier, tris)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in (crown,trunk): ob.select_set(True)
    bpy.context.view_layer.objects.active = crown
    file = OUT / (tier + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB', use_selection=True, export_yup=True,
        export_normals=True, export_texcoords=True, export_vertex_color='ACTIVE', export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False, export_morph=False)
    report['tiers'][tier] = {'file': file.name, 'triangles': tris, 'bytes': file.stat().st_size,
                            'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
    for ob in (crown,trunk): ob.location.x = {'hero': -15, 'full': 0, 'lite': 15}[tier]; ob.name = tier + ' | ' + ob.name
world = bpy.data.worlds.new('Foliage study | Sky'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.65,.74,.83,1)
world.node_tree.nodes['Background'].inputs[1].default_value = .6; scene.world = world
bpy.ops.mesh.primitive_plane_add(size=200)
bpy.context.object.data.materials.append(material('Foliage study | Paper', linear(0xdfe4d1), False))
bpy.context.object.location.z = -.05
bpy.ops.object.light_add(type='SUN', location=(0,0,30)); bpy.context.object.data.energy=2.2
bpy.context.object.rotation_euler = Vector((10,10,-24)).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(19,-83,30))
camera = bpy.context.object; camera.rotation_euler=(Vector((0,0,10))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=57; scene.camera=camera
scene.render.engine='CYCLES'; scene.cycles.samples=16
scene.render.resolution_x=1800; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
scene['browser_preview']='http://localhost:5173/foliage-study.html'
report['height']=height
(OUT/'study.json').write_text(json.dumps(report,indent=2)+'\n')
(DOC/'foliage-build-report.json').write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(DOC/'textured-pine.blend'))
print('FOLIAGE_BUILD_COMPLETE', json.dumps(report))
