"""Add portable preview materials to the separate Blender review scene."""
import bpy,json,re,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(r'C:/Users/olov_/repos/olovs-hemsida')
DOC=ROOT/'docs/graphics/canopy-refinement-2026-09-13'
sys.path.insert(0,str(ROOT/'tools/blender-tree-study'))
from pine_meshes import linear,material
scene=bpy.data.scenes['Ghibli | Continuous canopy study']
manifest=json.loads((DOC/'candidate-manifest.json').read_text(encoding='utf-8'))
palette_source=(ROOT/'apps/golf/src/engine/painted-world-palette.mjs').read_text(encoding='utf-8')
palette_block=re.search(r'export const FOLIAGE_PALETTES = \{(.*?)\};',palette_source,re.S).group(1)
palettes={key:[int(c.strip(),16) for c in colours.split(',')]
 for key,colours in re.findall(r'(\w+):\[(0x[\da-f]+,0x[\da-f]+,0x[\da-f]+)\]',palette_block)}
assert set(palettes)=={'tall','gran','bjork','al','ek'}

def leaves(key,image):
    m=bpy.data.materials.new(key+' | Continuous painted foliage');m.use_nodes=True
    m.surface_render_method='DITHERED';m.use_backface_culling=False
    nodes=m.node_tree.nodes;nodes.clear();add=nodes.new;link=m.node_tree.links.new
    out=add('ShaderNodeOutputMaterial');geometry=add('ShaderNodeNewGeometry')
    facing=add('ShaderNodeMath');facing.operation='MULTIPLY_ADD';facing.inputs[1].default_value=-2;facing.inputs[2].default_value=1
    link(geometry.outputs['Backfacing'],facing.inputs[0])
    normal=add('ShaderNodeVectorMath');normal.operation='SCALE';link(geometry.outputs['Normal'],normal.inputs[0]);link(facing.outputs[0],normal.inputs['Scale'])
    dot=add('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';link(normal.outputs[0],dot.inputs[0]);dot.inputs[1].default_value=Vector((-.3,-.6,.85)).normalized()
    def ramp(low,high,gain=1):
        n=add('ShaderNodeMapRange');n.clamp=True;n.interpolation_type='SMOOTHSTEP'
        n.inputs['From Min'].default_value=low;n.inputs['From Max'].default_value=high;n.inputs['To Max'].default_value=gain
        link(dot.outputs['Value'],n.inputs['Value']);return n.outputs['Result']
    shade,base,highlight=[(*linear(c),1) for c in palettes[key]]
    body=add('ShaderNodeMixRGB');body.inputs[1].default_value=shade;body.inputs[2].default_value=base;link(ramp(-.18,.85),body.inputs[0])
    light=add('ShaderNodeMixRGB');link(body.outputs[0],light.inputs[1]);light.inputs[2].default_value=highlight;link(ramp(.48,.98,.74),light.inputs[0])
    emission=add('ShaderNodeEmission');link(light.outputs[0],emission.inputs['Color']);emission.inputs['Strength'].default_value=1.04
    tex=add('ShaderNodeTexImage');tex.image=image
    cut=add('ShaderNodeMath');cut.operation='GREATER_THAN';cut.inputs[1].default_value=.5;link(tex.outputs['Alpha'],cut.inputs[0])
    transparent=add('ShaderNodeBsdfTransparent');blend=add('ShaderNodeMixShader')
    link(cut.outputs[0],blend.inputs[0]);link(transparent.outputs[0],blend.inputs[1]);link(emission.outputs[0],blend.inputs[2]);link(blend.outputs[0],out.inputs[0])
    m.diffuse_color=base;return m

for s in manifest['species']:
    key=s['foliage']['key'];image=bpy.data.images.load(str(ROOT/'apps/golf/public/models/trees'/s['foliage']['atlas']['file']));image.pack()
    for ob in scene.objects:
        if not ob.name.startswith(key+' | '):continue
        ob.data.materials.clear()
        ob.data.materials.append(leaves(key,image) if 'crown' in ob.name else material(key+' | Authored bark',(1,1,1)))
camera=scene.camera
if camera is None:
    camera=bpy.data.objects.new('Canopy review camera',bpy.data.cameras.new('Canopy review camera'));scene.collection.objects.link(camera)
camera.location=(5,-120,30);camera.rotation_euler=(Vector((0,0,9))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=120;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.transparent_max_bounces=48
scene.render.resolution_x=2200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
world=scene.world or bpy.data.worlds.new('Canopy review world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(*linear(0xdadfd1),1);world.node_tree.nodes['Background'].inputs[1].default_value=.8;scene.world=world
scene.view_settings.view_transform='Standard'
bpy.data.libraries.write(str(DOC/'continuous-canopy.blend'),{scene},fake_user=True,compress=True)
print(json.dumps({'scene':scene.name,'meshes':sum(o.type=='MESH' for o in scene.objects),'packedAtlases':5,'file':str(DOC/'continuous-canopy.blend')}))
