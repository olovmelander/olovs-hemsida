"""Build a saved, animated review of the actual exported cloth through Blender MCP.

Run check-flags.mjs first to export the production number atlas. No user scene
is cleared; this study lives in its own scene and is saved as a separate library.
"""
import bpy, json, math, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = globals().get('OUT', os.path.join(ROOT, 'docs', 'graphics', 'flags-motion-2026-09-21'))
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(os.path.dirname(__file__), 'cache', 'flag-bake.json'), encoding='utf-8') as fh:
    bake = json.load(fh)
NAME = 'Flag wind and fabric review'
previous_scene = bpy.context.window.scene
if previous_scene.name == NAME:
    previous_scene = next((s for s in bpy.data.scenes if s.name != NAME), None)
if bpy.data.scenes.get(NAME):
    bpy.data.scenes.remove(bpy.data.scenes[NAME])
for obj in list(bpy.data.objects):
    if obj.name.startswith('Flag review '):
        bpy.data.objects.remove(obj, do_unlink=True)
sc = bpy.data.scenes.new(NAME)
bpy.context.window.scene = sc
sc.render.engine = 'CYCLES'
sc.cycles.samples = 32
sc.render.threads_mode = 'FIXED'
sc.render.threads = 4
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1600, 1100, 100
sc.render.fps = bake['fps']
sc.frame_start, sc.frame_end = 1, bake['frames']
sc.view_settings.view_transform = 'AgX'
world = bpy.data.worlds.new('Flag review sky')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.63, 0.73, 0.87, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.65
sc.world = world

atlas = bpy.data.images.load(os.path.join(ROOT, 'tools', 'goldens', 'flags-motion', 'flag-atlas.png'), check_existing=False)
atlas.pack()
fabric = bpy.data.materials.new('Flag review woven yellow nylon')
fabric.use_nodes = True
nodes, links = fabric.node_tree.nodes, fabric.node_tree.links
bsdf = nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 0.82
bsdf.inputs['Specular IOR Level'].default_value = 0.28
bsdf.inputs['Sheen Weight'].default_value = 0.24
bsdf.inputs['Sheen Roughness'].default_value = 0.8
bsdf.inputs['Sheen Tint'].default_value = (1, 0.88, 0.62, 1)
tex = nodes.new('ShaderNodeTexImage'); tex.image = atlas
uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'Number atlas'
links.new(uv.outputs['UV'], tex.inputs['Vector'])
links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
cloth_uv = nodes.new('ShaderNodeUVMap'); cloth_uv.uv_map = 'Cloth UV'
waves = []
for axis, scale in [('X', 390), ('Y', 250)]:
    wave = nodes.new('ShaderNodeTexWave'); wave.bands_direction = axis
    wave.inputs['Scale'].default_value = scale
    links.new(cloth_uv.outputs['UV'], wave.inputs['Vector'])
    waves.append(wave)
weave = nodes.new('ShaderNodeMath'); weave.operation = 'MULTIPLY'
links.new(waves[0].outputs['Color'], weave.inputs[0]); links.new(waves[1].outputs['Color'], weave.inputs[1])
bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.16; bump.inputs['Distance'].default_value = 0.00015
links.new(weave.outputs[0], bump.inputs['Height']); links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
translucent = nodes.new('ShaderNodeBsdfTranslucent')
links.new(tex.outputs['Color'], translucent.inputs['Color'])
mix = nodes.new('ShaderNodeMixShader'); mix.inputs[0].default_value = 0.16
links.new(bsdf.outputs[0], mix.inputs[1]); links.new(translucent.outputs[0], mix.inputs[2])
links.new(mix.outputs[0], nodes.get('Material Output').inputs['Surface'])

def plain(name, colour, roughness=0.8, metal=0):
    mat = bpy.data.materials.new('Flag review ' + name); mat.diffuse_color = (*colour, 1); mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metal
    return mat

pole_mat = plain('powder coated pole', (0.8, 0.82, 0.79), 0.35, 0.4)
text_mat = plain('labels', (0.025, 0.065, 0.045))
ground_mat = plain('green', (0.19, 0.27, 0.13))
nx, nz = bake['grid']['nx'], bake['grid']['nz']
faces = [(j*nx+i, (j+1)*nx+i, (j+1)*nx+i+1, j*nx+i+1) for j in range(nz-1) for i in range(nx-1)]

def coords(frame):
    return [(frame[k], -frame[k+2], frame[k+1]) for k in range(0,len(frame),3)]

def cylinder(name, x, y, radius, depth, z):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=(x,y,z))
    obj=bpy.context.object; obj.name='Flag review '+name; obj.data.materials.append(pole_mat)
    for polygon in obj.data.polygons: polygon.use_smooth=True

chosen = ['calm', 'light', 'moderate', 'gale', 'strong-gale', 'storm']
for index, name in enumerate(chosen):
    band = next(b for b in bake['bands'] if b['name'] == name)
    x, y = (index % 3)*2.25, (index//3)*3.0
    cylinder(name+' pole',x,y,0.0195,2.6,1.3)
    cylinder(name+' sleeve',x,y,0.026,0.53,2.28)
    mesh = bpy.data.meshes.new('Flag review '+name)
    mesh.from_pydata(coords(band['frames'][0]), [], faces); mesh.update()
    obj = bpy.data.objects.new('Flag review '+name+' cloth',mesh); sc.collection.objects.link(obj); obj.location=(x,y,0)
    mesh.materials.append(fabric)
    number_uv, fabric_uv = mesh.uv_layers.new(name='Number atlas'), mesh.uv_layers.new(name='Cloth UV')
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for li in polygon.loop_indices:
            n=mesh.loops[li].vertex_index; u=(n%nx)/(nx-1); v=(n//nx)/(nz-1)
            number_uv.data[li].uv=((index%4*512+16+u*480)/2048, 1-(16+v*288)/320)
            fabric_uv.data[li].uv=(u,1-v)
    obj.shape_key_add(name='Basis')
    for f, frame in enumerate(band['frames']):
        key=obj.shape_key_add(name=f'Cloth {f:03d}')
        for vertex, co in zip(key.data, coords(frame)): vertex.co=co
        for at,value in [(max(1,f),0), (f+1,1), (f+2,0)]:
            key.value=value; key.keyframe_insert(data_path='value',frame=at)
        if f == 0:
            key.value=1; key.keyframe_insert(data_path='value',frame=bake['frames']+1)
        key.value=0
    for curve in mesh.shape_keys.animation_data.action.fcurves:
        for point in curve.keyframe_points: point.interpolation='LINEAR'
    obj['wind_ms']=band['ms']; obj['source']='Blender cloth, same frames shipped to the app'
    solid=obj.modifiers.new('Thin sewn fabric', 'SOLIDIFY'); solid.thickness=0.00035
    bpy.ops.object.text_add(location=(x-0.12,y-0.45,0.045))
    label=bpy.context.object; label.name='Flag review '+name+' label'
    label.data.body=f"{band['ms']:g} m/s"; label.data.size=0.20
    label.data.materials.append(text_mat)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-0.012))
bpy.context.object.name='Flag review ground'; bpy.context.object.data.materials.append(ground_mat)
bpy.ops.object.light_add(type='AREA',location=(1,-4,8))
light=bpy.context.object; light.name='Flag review soft sun'; light.data.energy=1600; light.data.shape='DISK'; light.data.size=5
light.rotation_euler=(Vector((2,1,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA',location=(5,5,6))
light=bpy.context.object; light.name='Flag review rim'; light.data.energy=1100; light.data.size=4
light.rotation_euler=(Vector((2,1,2))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(7,-11,9))
camera=bpy.context.object; camera.name='Flag review camera'; camera.rotation_euler=(Vector((2.5,1.4,1.4))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=9.2; sc.camera=camera
sc.frame_set(98)
blend_path=os.path.join(OUT,'flag-wind-study.blend')
bpy.data.libraries.write(blend_path, {sc}, fake_user=True, compress=True)
sc.render.filepath=os.path.join(OUT,'blender-wind-study.png')
bpy.ops.render.render(write_still=True)
if previous_scene is not None:
    bpy.context.window.scene = previous_scene
report={'blender':bpy.app.version_string,'scene':sc.name,'blend':blend_path,'frame':sc.frame_current,
        'frames':bake['frames'],'fps':bake['fps'],'flags':chosen,'render':sc.render.filepath}
with open(os.path.join(OUT,'blender-review.json'),'w',encoding='utf-8') as fh: json.dump(report,fh,indent=2)
print(json.dumps(report))
