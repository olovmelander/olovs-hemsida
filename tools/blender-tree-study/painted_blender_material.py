"""Blender presentation material; glTF assets are exported before applying it."""
import bpy
from mathutils import Vector
from pine_meshes import linear

def painted_material(name,hex_colour,image,key='tall'):
    m=bpy.data.materials.new(name+' | Painted canopy');m.use_nodes=True
    m.surface_render_method='DITHERED';m.use_backface_culling=False
    nt=m.node_tree;nt.nodes.clear();new=nt.nodes.new;link=nt.links.new
    out=new('ShaderNodeOutputMaterial');emission=new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1.15
    geometry=new('ShaderNodeNewGeometry');dot=new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT'
    # Preserve the authored foliage normals on both sides of a cutout card.
    facing=new('ShaderNodeMath');facing.operation='MULTIPLY_ADD'
    facing.inputs[1].default_value=-2;facing.inputs[2].default_value=1;link(geometry.outputs['Backfacing'],facing.inputs[0])
    normal=new('ShaderNodeVectorMath');normal.operation='SCALE'
    link(geometry.outputs['Normal'],normal.inputs[0]);link(facing.outputs[0],normal.inputs['Scale'])
    link(normal.outputs[0],dot.inputs[0]);dot.inputs[1].default_value=Vector((-12,-10,22)).normalized()
    coords=new('ShaderNodeTexCoord');noise=new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=.48;noise.inputs['Detail'].default_value=1
    link(coords.outputs['Object'],noise.inputs['Vector'])
    sub=new('ShaderNodeMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=.5;link(noise.outputs['Fac'],sub.inputs[0])
    scale=new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=.44;link(sub.outputs[0],scale.inputs[0])
    add=new('ShaderNodeMath');add.operation='ADD';link(dot.outputs['Value'],add.inputs[0]);link(scale.outputs[0],add.inputs[1])
    def ramp(lo,hi):
        node=new('ShaderNodeMapRange');node.interpolation_type='SMOOTHSTEP';node.clamp=True
        node.inputs['From Min'].default_value=lo;node.inputs['From Max'].default_value=hi;link(add.outputs[0],node.inputs['Value']);return node.outputs['Result']
    palettes={'tall':(0x123b26,0x427823,0x91b843),'gran':(0x0d3629,0x2f6532,0x71a543),'bjork':(0x244f26,0x6e992a,0xb1ce50),'al':(0x123f2b,0x397936,0x7aad49),'ek':(0x1c3f1a,0x537e20,0xa0bc43)}
    shade,base,light=[linear(value) for value in palettes[key]]
    mix=new('ShaderNodeMixRGB');mix.inputs[1].default_value=(*shade,1);mix.inputs[2].default_value=(*base,1);link(ramp(-.35,.72),mix.inputs[0])
    highlight=new('ShaderNodeMixRGB');link(mix.outputs[0],highlight.inputs[1]);highlight.inputs[2].default_value=(*light,1);link(ramp(.45,.95),highlight.inputs[0]);link(highlight.outputs[0],emission.inputs['Color'])
    tex=new('ShaderNodeTexImage');tex.image=image
    pigment=new('ShaderNodeMixRGB');pigment.blend_type='MULTIPLY';pigment.inputs[0].default_value=1
    link(highlight.outputs[0],pigment.inputs[1]);link(tex.outputs['Color'],pigment.inputs[2]);link(pigment.outputs[0],emission.inputs['Color'])
    cut=new('ShaderNodeMath');cut.operation='GREATER_THAN';cut.inputs[1].default_value=.5;link(tex.outputs['Alpha'],cut.inputs[0])
    transparent=new('ShaderNodeBsdfTransparent');blend=new('ShaderNodeMixShader')
    link(cut.outputs[0],blend.inputs[0]);link(transparent.outputs[0],blend.inputs[1]);link(emission.outputs[0],blend.inputs[2]);link(blend.outputs[0],out.inputs[0])
    m.diffuse_color=(*base,1)
    return m

def birch_bark_material():
    m=bpy.data.materials.new('Silver birch | Ivory and charcoal bark');m.use_nodes=True
    nt=m.node_tree;new=nt.nodes.new;link=nt.links.new
    bs=nt.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=1
    coord=new('ShaderNodeTexCoord');scale=new('ShaderNodeVectorMath');scale.operation='MULTIPLY'
    scale.inputs[1].default_value=(1.6,1.6,12);link(coord.outputs['Object'],scale.inputs[0])
    noise=new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=1
    link(scale.outputs['Vector'],noise.inputs['Vector'])
    mask=new('ShaderNodeMapRange');mask.interpolation_type='SMOOTHSTEP';mask.clamp=True
    mask.inputs['From Min'].default_value=.64;mask.inputs['From Max'].default_value=.76
    link(noise.outputs['Fac'],mask.inputs['Value'])
    mix=new('ShaderNodeMixRGB');mix.inputs[1].default_value=(*linear(0xe6e3d2),1);mix.inputs[2].default_value=(*linear(0x55594e),1)
    link(mask.outputs['Result'],mix.inputs[0]);link(mix.outputs[0],bs.inputs['Base Color'])
    return m
