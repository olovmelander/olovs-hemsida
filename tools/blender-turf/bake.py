"""Bake metric, repeatable golf-surface swatches with Blender Cycles.

blender -b -t 4 -P tools/blender-turf/bake.py
Maps contain unlit linear reflectance variation, tangent slopes and roughness.
The generated swatches are material samples, independent of course geography.
"""
import math
import tempfile
from pathlib import Path

import bpy
import numpy as np

SIZE = 256
OUTPUT = Path(__file__).resolve().parents[2] / "apps/golf/src/engine/assets/turf"
# Material, tile metres, blade length/width mm, leaf count, directional spread
# radians, proportion of straw, intrinsic roughness. Order matches the loader.
CUTS = [
    ("green", .36, 5.5, 1.1, 44000, .46, .045, .53),
    ("fringe", .50, 12., 1.65, 32000, .54, .065, .62),
    ("tee", .58, 16., 1.85, 32000, .60, .070, .58),
    ("fairway", .72, 22., 2.30, 31000, .52, .095, .67),
    ("semi", .85, 36., 2.50, 24500, .93, .155, .76),
    ("rough", 1.05, 63., 3.15, 19700, 2.65, .225, .87),
    ("fescue", 1.35, 113., 2.50, 14600, 2.95, .430, .88),
    ("sand", .32, 2.4, 1.35, 22500, 3.14, .00, .84),
]


def patch(x, y, seed):
    # Aperiodic within the tile. Cyclic distance keeps packets continuous
    # across a swatch border without laying two sets of parallel marks in it.
    rng = np.random.default_rng(2905 + seed)
    field = np.zeros_like(x)
    for _ in range(96):
        centre = rng.random(2)
        dx, dy = (x-centre[0]+.5)%1-.5, (y-centre[1]+.5)%1-.5
        angle = rng.uniform(-math.pi,math.pi)
        along = dx*math.cos(angle) + dy*math.sin(angle)
        across = dy*math.cos(angle) - dx*math.sin(angle)
        radius = rng.uniform(.018,.07)
        field += rng.normal() * np.exp(-((along/(radius*1.75))**2 + (across/radius)**2))
    return np.tanh(field)


def separate_grain(pixels):
    # A 36 cm green swatch may repeat hundreds of times across one putting
    # surface. Keep its cut tips and folds, reserving clumps that span much
    # of a swatch for the independently projected metre-scale density field.
    rgb = pixels[:,:,:3]
    mean = rgb.mean(axis=(0,1))
    fx, fy = np.meshgrid(np.fft.rfftfreq(SIZE), np.fft.fftfreq(SIZE))
    spread = 5.0  # Gaussian sigma, texels (7 mm on the putting green)
    low_pass = np.exp(-2*math.pi**2*spread**2*(fx**2 + fy**2))
    low = np.fft.irfft2(np.fft.rfft2(rgb,axes=(0,1))*low_pass[:,:,None],axes=(0,1))
    rgb -= low-mean


def mesh(name, positions, faces, colour, roughness):
    data = bpy.data.meshes.new(name)
    vertices = positions.reshape(-1, 3).astype('f')
    triangles = faces.reshape(-1, 3).astype('i')
    data.vertices.add(len(vertices))
    data.vertices.foreach_set("co", vertices.ravel())
    data.loops.add(triangles.size)
    data.loops.foreach_set("vertex_index", triangles.ravel())
    data.polygons.add(len(triangles))
    data.polygons.foreach_set("loop_start", np.arange(0, triangles.size, 3, dtype='i'))
    data.update(calc_edges=True)
    for label, values in [("pigment", colour), ("roughness", roughness)]:
        a = data.color_attributes.new(name=label, type='FLOAT_COLOR', domain='POINT')
        rgba = np.ones((len(vertices), 4), dtype='f')
        rgba[:, :3] = values.reshape(len(vertices), -1)
        a.data.foreach_set('color', rgba.ravel())
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def swatch(spec, index):
    name, metres, length_mm, width_mm, count, spread, straw_share, roughness = spec
    rng = np.random.default_rng(67111 + index)
    uv = rng.random((count, 2))
    # Some roots grow in tufts. Taller cuts resolve a much looser canopy.
    centers = rng.random((int(max(140, count / 25)), 2))
    clustered = rng.random(count) < (.28 if index < 4 else .67)
    uv[clustered] = (centers[rng.integers(len(centers), size=clustered.sum())] +
                     rng.normal(0, .015, (clustered.sum(), 2))) % 1
    clump = patch(uv[:, 0], uv[:, 1], index)
    angle = rng.normal(0, spread, count) + clump * (.32 + index * .10)
    length = length_mm * .001 * rng.uniform(.50, 1.48, count)
    width = width_mm * .001 * rng.uniform(.56, 1.44, count)
    age = (rng.random(count) < straw_share * (1 + clump * .68)).astype(float)
    pigment = np.array([.41, .51, .31]) + age[:, None] * np.array([.23, .035, -.035])
    pigment *= (1 + rng.normal(0, .09, count) + .10 * clump)[:, None]
    base_rough = np.clip(roughness + age*.065 + rng.normal(0,.035,count), .32,.98)
    if name == 'sand':
        pigment = np.array([.68,.62,.50]) * rng.lognormal(-.018,.16,count)[:,None]
        mineral = rng.random(count)
        pigment[mineral < .065] *= np.array([.56,.53,.49])
        pigment[mineral > .92] *= np.array([1.13,1.13,1.17])
        base_rough = np.clip(.86 - (mineral>.92)*.18 + rng.normal(0,.035,count),.55,.98)
    forward = np.column_stack((np.cos(angle), np.sin(angle))) * length[:,None]
    across = np.column_stack((-np.sin(angle), np.cos(angle))) * width[:,None]
    root = uv * metres
    if name == 'sand':
        # Five vertices form a grain with four sloping mineral facets.
        points = np.stack([root-forward*.5, root-across*.5, root+forward*.5,
                           root+across*.5, root+forward*.07], axis=1)
        heights = np.repeat((rng.random(count)*.001)[:,None], 5,axis=1)
        heights[:,4] += width*rng.uniform(.15,.44,count)
        faces = [[0,1,4],[1,2,4],[2,3,4],[3,0,4]]
        tones = [1,1,1,1,1]
    else:
        # Folded leaf blade, with midrib, asymmetrical bend and a cut tip.
        bend = across*rng.normal(0,.7,count)[:,None]
        points = np.stack([root-across*.45,root+across*.45,
                           root+forward*.54+bend*.33-across*.48,
                           root+forward*.54+bend*.33+across*.48,
                           root+forward*.54+bend*.33,root+forward+bend],axis=1)
        lift = length*rng.uniform(.18,.70,count)
        heights = np.stack([lift*.02,lift*.04,lift*.66,lift*.77,lift*.86,lift],axis=1)
        faces = [[0,4,1],[0,2,4],[4,3,1],[2,5,4],[4,5,3]]
        tones = [.74,.77,.96,1.02,1.05,1.12]
    offsets = []
    indices = []
    # Copy a blade or grain across an edge only if its silhouette crosses it.
    lo = points.min(axis=1)
    hi = points.max(axis=1)
    for dx in [-1,0,1]:
        for dy in [-1,0,1]:
            offset = np.array([dx,dy])*metres
            ids = np.where(np.all(hi+offset>=0,axis=1) & np.all(lo+offset<=metres,axis=1))[0]
            if len(ids):
                offsets.append(np.broadcast_to(offset,(len(ids),1,2)))
                indices.append(ids)
    ids = np.concatenate(indices)
    xyz = np.concatenate([points[ids]+np.concatenate(offsets), heights[ids,:,None]],axis=-1)
    n = xyz.shape[1]
    tri = np.arange(len(ids))[:,None,None]*n + np.array(faces)[None,:,:]
    col = pigment[ids,None,:] * np.array(tones)[None,:,None]
    rough = np.repeat(base_rough[ids,None,None], n, axis=1)
    surface = mesh(name, xyz, tri, col, rough)

    # The thatch/soil between blades has its own diffuse colour and roughness.
    axis = np.linspace(0,1,65)
    x,y = np.meshgrid(axis,axis)
    mottling = patch(x,y,index)
    z = -.002 + mottling * (.0003 if name=='sand' else .0008)
    pts = np.stack([x*metres, y*metres, z], axis=-1)
    s = np.arange(65*65).reshape(65,65)[:-1,:-1].ravel()
    tri = np.concatenate([np.stack([s,s+1,s+66],1),np.stack([s,s+66,s+65],1)])
    colour = np.array([.54,.48,.38]) if name=='sand' else np.array([.31,.34,.19])
    variation = np.array([.15,.12,.10]) if name=='sand' else np.array([.31,.20,.12])
    base = colour[None,None,:]*(1+mottling[:,:,None]*variation)
    floor = mesh(name+' ground',pts,tri,base,np.full((65,65,1),min(.98,roughness+.08)))
    return [surface,floor]


def make_material():
    mat = bpy.data.materials.new('De-lit surface channels')
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    pigment = nodes.new('ShaderNodeAttribute')
    pigment.attribute_name = 'pigment'
    rough = nodes.new('ShaderNodeAttribute')
    rough.attribute_name = 'roughness'
    normal = nodes.new('ShaderNodeNewGeometry')
    split = nodes.new('ShaderNodeSeparateXYZ')
    links.new(normal.outputs['Normal'],split.inputs['Vector'])
    packed = nodes.new('ShaderNodeCombineColor')
    for axis, socket in [('X','Red'),('Y','Green')]:
        remap = nodes.new('ShaderNodeMath')
        remap.operation = 'MULTIPLY_ADD'
        links.new(split.outputs[axis],remap.inputs[0])
        remap.inputs[1].default_value = .5
        remap.inputs[2].default_value = .5
        links.new(remap.outputs[0],packed.inputs[socket])
    links.new(rough.outputs['Fac'],packed.inputs['Blue'])
    output = nodes.get('Material Output')
    emission = nodes.new('ShaderNodeEmission')
    links.new(emission.outputs[0], output.inputs['Surface'])
    return mat,emission.inputs['Color'],[pigment.outputs['Color'], packed.outputs[0]]


def canopy_texture():
    # One 4.8 m tile records the density of short turf, wild seed tussocks
    # and mineral streaks. Random periodic packets avoid uniform FBM blobs.
    rng = np.random.default_rng(917)
    axis = (np.arange(SIZE)+.5)/SIZE
    x, y = np.meshgrid(axis, axis)
    channels = []
    for kind in range(3):
        field = np.zeros_like(x)
        for band, count in [(1.,95),(.45,250),(.18,480)]:
            for _ in range(count):
                cx,cy = rng.random(2)
                dx = ((x-cx+.5)%1-.5)*4.8
                dy = ((y-cy+.5)%1-.5)*4.8
                angle = rng.normal(.15,.30) if kind==0 else rng.uniform(-math.pi,math.pi)
                along = dx*math.cos(angle)+dy*math.sin(angle)
                across = dy*math.cos(angle)-dx*math.sin(angle)
                radius = band*rng.uniform(.10,.24)
                r = (along/(radius*(2.1 if kind!=1 else 1.45)))**2 + (across/radius)**2
                field += rng.normal(0,band**.4)*np.exp(-r*1.8)
        coverage = (field-field.mean())/max(.01,field.std())
        channel = .5+.17*coverage
        if kind == 0:
            # Several-centimetre patches survive the micro swatch's mipmaps:
            # local changes in shoot density are narrower than the mottling
            # of an entire stand, but wider than the fine clipped leaf tips.
            fx, fy = np.meshgrid(np.fft.rfftfreq(SIZE),np.fft.fftfreq(SIZE))
            clumps = rng.normal(size=x.shape)
            kernel = np.exp(-2*math.pi**2*((2.1*fx)**2+(1.3*fy)**2))
            clumps = np.fft.irfft2(np.fft.rfft2(clumps)*kernel,s=x.shape)
            channel = .5+.13*coverage+.14*(clumps-clumps.mean())/clumps.std()
        channels.append(np.clip(channel,.05,.95))
    return np.stack([*channels,np.ones_like(x)],axis=-1).astype('f')


def bake():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.render.resolution_x = scene.render.resolution_y = SIZE*2
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Raw'
    scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '16'
    camera = bpy.data.cameras.new('Swatch orthographic')
    eye = bpy.data.objects.new('Swatch orthographic',camera)
    bpy.context.collection.objects.link(eye)
    camera.type = 'ORTHO'
    eye.rotation_euler = (0,0,0)
    scene.camera = eye
    material, inlet, outputs = make_material()
    maps = [[],[]]
    with tempfile.TemporaryDirectory() as folder:
        for i, spec in enumerate(CUTS):
            print('Baking',spec[0],flush=True)
            objects = swatch(spec,i)
            for ob in objects:
                ob.data.materials.append(material)
            camera.ortho_scale = spec[1]
            eye.location = (spec[1]/2,spec[1]/2,2)
            for j, channel in enumerate(outputs):
                material.node_tree.links.new(channel,inlet)
                scene.render.filepath = str(Path(folder)/f'{i}-{j}.png')
                bpy.ops.render.render(write_still=True)
                frame = bpy.data.images.load(scene.render.filepath)
                frame.colorspace_settings.name = 'Non-Color'
                rgba = np.empty(SIZE*SIZE*16,dtype='f')
                frame.pixels.foreach_get(rgba)
                pixels = rgba.reshape(SIZE,2,SIZE,2,4).mean(axis=(1,3))
                bpy.data.images.remove(frame)
                if j==0:
                    # Keep palette and weather ownership in the course renderer.
                    # Equal mean per channel preserves all local pigment differences.
                    pixels[:,:,:3] /= pixels[:,:,:3].mean(axis=(0,1))
                    pixels[:,:,:3] *= .5
                else:
                    pixels[:,:,:2] += .5-pixels[:,:,:2].mean(axis=(0,1))
                separate_grain(pixels)
                maps[j].append(np.clip(pixels,0,1))
            for ob in objects:
                data = ob.data
                bpy.data.objects.remove(ob,do_unlink=True)
                bpy.data.meshes.remove(data)
    OUTPUT.mkdir(parents=True,exist_ok=True)
    maps.append([canopy_texture()])
    for layers,name in zip(maps,['pigment','normal-roughness','canopy']):
        pixels = np.concatenate(layers,axis=0)[::-1].copy()
        result = bpy.data.images.new(name,width=SIZE,height=SIZE*len(layers),alpha=False,float_buffer=True)
        result.colorspace_settings.name = 'Non-Color'
        result.pixels.foreach_set(pixels.ravel())
        scene.render.image_settings.file_format = 'WEBP'
        scene.render.image_settings.quality = 96 if name=='normal-roughness' else 91
        result.save_render(str(OUTPUT/(name+'.webp')),scene=scene)
        print('Published',name,flush=True)


if __name__=='__main__':
    bake()
