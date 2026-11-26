"""Build the editable, self-contained Banvy tree asset library in a clean Blender process.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender-tree-study/realistic/tree_library.py -- docs/graphics/woodland-trees/Banvy-Trees.blend

The eighteen Asset Browser collections use the same Hero meshes, metric fit,
species pigments and packed images as the course renderer. Each collection's
instance offset is its ground anchor, independent of its place in the gallery.
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector, Matrix

REPO = Path(__file__).resolve().parents[3]
MODELS = REPO / 'apps/golf/public/models/trees'
MODULES = REPO / 'apps/golf/src/data'
FAMILIES = [
    ('gran', 'Norway spruce', 0x3d6047), ('björk', 'Silver birch', 0x6e8946),
    ('al', 'Grey alder', 0x52764c), ('ek', 'Pedunculate oak', 0x78864a),
    ('inland', 'Scots pine – inland', 0x526d47), ('coastal', 'Scots pine – Kronholmen', 0x4c6052),
]


def generated(name):
    # The asset packers emit a single JSON literal as an ES default export.
    text = (MODULES / (name + '.mjs')).read_text(encoding='utf-8')
    return json.loads(text.split('export default ', 1)[1].strip().removesuffix(';'))


def verified(record):
    path = MODELS / record['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError(f'Asset digest mismatch: {path}')
    return path


def swatch(rgb):
    def linear(byte):
        s = byte / 255
        return s / 12.92 if s < .04045 else ((s + .055) / 1.055) ** 2.4
    return tuple(linear((rgb >> n) & 255) for n in (16, 8, 0))


def make_material(label, maps, tint=None):
    """Normal PNGs pack tangent X/Y and light-through in B, on both leaves and bark."""
    material = bpy.data.materials.new(label)
    material.use_nodes = True
    nt = material.node_tree
    nt.nodes.clear()
    def node(kind, x, y):
        n = nt.nodes.new(kind)
        n.location = (x, y)
        return n
    def set_input(n, socket, source):
        if isinstance(source, bpy.types.NodeSocket):
            nt.links.new(source, n.inputs[socket])
        else:
            n.inputs[socket].default_value = source
    def vector(operation, a, b, x, y):
        n = node('ShaderNodeVectorMath', x, y)
        n.operation = operation
        set_input(n, 0, a)
        set_input(n, 1, b)
        return n.outputs['Value' if operation == 'DOT_PRODUCT' else 'Vector']
    def math_node(op, args, x, y):
        n = node('ShaderNodeMath', x, y)
        n.operation = op
        for i, arg in enumerate(args):
            set_input(n, i, arg)
        return n.outputs[0]
    def image_node(record, data, x, y):
        im = bpy.data.images.load(str(verified(record)), check_existing=True)
        im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        im['sha256'] = record['sha256']
        im.alpha_mode = 'STRAIGHT'
        if not im.packed_file:
            im.pack()
        tex = node('ShaderNodeTexImage', x, y)
        tex.image = im
        tex.label = 'Tangent XY / light through' if data else 'Surface colour'
        return tex

    pigment = image_node(maps['atlas'], False, -1000, 420)
    offset = vector('DIVIDE', pigment.outputs['Color'], maps['mean'], -770, 420)
    if tint is None:
        vertex = node('ShaderNodeVertexColor', -760, 610)
        vertex.label = 'Height-dependent bark colour'
        tint = vertex.outputs['Color']
        leaf = False
    else:
        leaf = True
    albedo = vector('MULTIPLY', offset, tint, -510, 420)
    packed = image_node(maps['normals'], True, -1000, 10)
    rg = node('ShaderNodeSeparateXYZ', -785, 10)
    set_input(rg, 0, packed.outputs['Color'])
    xy = node('ShaderNodeCombineXYZ', -575, -80)
    for i in (0, 1):
        set_input(xy, i, math_node('MULTIPLY_ADD', [rg.outputs[i], 2, -1], -780, -170 - i * 150))
    squared = vector('DOT_PRODUCT', xy.outputs[0], xy.outputs[0], -380, -100)
    z = math_node('SQRT', [math_node('SUBTRACT', [1, squared], -190, -100)], -20, -100)
    rgb = node('ShaderNodeCombineXYZ', 160, 80)
    set_input(rgb, 0, rg.outputs[0])
    set_input(rgb, 1, rg.outputs[1])
    set_input(rgb, 2, math_node('MULTIPLY_ADD', [z, .5, .5], 150, -130))
    relief = node('ShaderNodeNormalMap', 370, 80)
    set_input(relief, 'Strength', .55 if leaf else 1)
    set_input(relief, 'Color', rgb.outputs[0])
    surface = node('ShaderNodeBsdfPrincipled', 585, 420)
    set_input(surface, 'Base Color', albedo)
    set_input(surface, 'Normal', relief.outputs[0])
    set_input(surface, 'Roughness', .81 if leaf else .89)
    shader = surface.outputs[0]
    if leaf:
        trans = node('ShaderNodeBsdfTranslucent', 575, -45)
        set_input(trans, 'Color', albedo)
        wrap = node('ShaderNodeMixShader', 850, 250)
        set_input(wrap, 0, math_node('MULTIPLY', [rg.outputs[2], .16], 365, -170))
        set_input(wrap, 1, shader)
        set_input(wrap, 2, trans.outputs[0])
        coverage = node('ShaderNodeMixShader', 1075, 350)
        set_input(coverage, 0, pigment.outputs['Alpha'])
        set_input(coverage, 1, node('ShaderNodeBsdfTransparent', 855, 510).outputs[0])
        set_input(coverage, 2, wrap.outputs[0])
        shader = coverage.outputs[0]
    set_input(node('ShaderNodeOutputMaterial', 1300 if leaf else 860, 420), 'Surface', shader)
    return material


def add_form(parent, name, variant, asset, materials, anchor):
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(verified(asset)), merge_vertices=False)
    meshes = [obj for obj in bpy.data.objects if obj not in existing and obj.type == 'MESH']
    if len(meshes) != 2:
        raise ValueError(f'Expected crown and trunk in {name}')
    corners = [obj.matrix_world @ Vector(p) for obj in meshes for p in obj.bound_box]
    kh = variant['templateRadius'] / max(abs(p[i]) for p in corners for i in (0, 1))
    kv = variant['templateHeight'] / max(p.z for p in corners)
    transform = Matrix.Translation(anchor) @ Matrix.Diagonal((kh, kh, kv, 1))
    for obj in meshes:
        part = obj.name.split('.')[0]
        obj.data.materials.clear()
        obj.data.materials.append(materials[part])
        if part == 'trunk' and not obj.data.color_attributes:
            raise ValueError(f'Missing bark vertex colour in {name}')
        obj.name = name + ' · ' + part
        obj.data.name = obj.name
        obj.matrix_world = transform @ obj.matrix_world
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
    collection.instance_offset = anchor
    collection['template_height_m'] = variant['templateHeight']
    collection['template_radius_m'] = variant['templateRadius']
    collection['seed'] = variant['seed']
    collection['hero_sha256'] = asset['sha256']
    collection.asset_mark()
    collection.asset_data.description = f"{name}, {variant['templateHeight']:.2f} m tall. Origin at the trunk foot."
    collection.asset_data.tags.new('Banvy')
    collection.asset_data.tags.new(parent.name)


def thumbnails(scene, camera, folder):
    """Embed a recognizable metric form in each Asset Browser entry."""
    forms = [c for c in bpy.data.collections if c.asset_data]
    scene.render.resolution_x = scene.render.resolution_y = 192
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    for col in forms:
        col.hide_render = True
    for i, col in enumerate(forms):
        col.hide_render = False
        centre = col.instance_offset + Vector((0, 0, col['template_height_m'] * .48))
        camera.location = centre + Vector((8, -33, 2))
        camera.rotation_euler = (centre - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.ortho_scale = max(col['template_radius_m'] * 2.12, col['template_height_m'] * 1.09)
        scene.render.filepath = str(folder / f'{i}.png')
        bpy.ops.render.render(write_still=True)
        with bpy.context.temp_override(id=col):
            bpy.ops.ed.lib_id_load_custom_preview(filepath=scene.render.filepath)
        col.hide_render = True
    for col in forms:
        col.hide_render = False
    scene.render.film_transparent = False
    scene.render.filepath = '//Banvy trees.png'


def build(destination):
    if not bpy.app.background:
        raise RuntimeError('Use a separate background Blender process for the library export')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'Banvy trees'
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    standard, coast = [json.loads((MODELS / f).read_text(encoding='utf-8'))['species']
                       for f in ('realistic-v2.json', 'realistic-visby.json')]
    woodland = generated('woodland-tree-tiers')
    leaves = generated('woodland-sprigs')
    pine = generated('scots-pine-assets')
    for col, (key, label, tint) in enumerate(FAMILIES):
        data = coast if key == 'coastal' else standard
        species = next(s for s in data if s['key'] == ('tall' if key in pine else key))
        tiers = pine[key]['variants'] if key in pine else woodland[key]
        foliage = pine[key]['foliage'] if key in pine else leaves.get(key, species['foliage'])
        materials = {'crown': make_material(label + ' · foliage', foliage, swatch(tint)),
                     'trunk': make_material(label + ' · bark', species['bark'])}
        group = bpy.data.collections.new(label)
        scene.collection.children.link(group)
        for i, (variant, records) in enumerate(zip(species['variants'], tiers, strict=True)):
            anchor = Vector(((col - 2.5) * 25, (i - 1) * 38, 0))
            add_form(group, f'{label} · {i + 1}', variant, records['hero'], materials, anchor)
    scene.world = bpy.data.worlds.new('Daylight')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.47, .60, .76, 1)
    background.inputs['Strength'].default_value = .85
    setup = bpy.data.collections.new('Gallery view')
    scene.collection.children.link(setup)
    cam = bpy.data.objects.new('Gallery camera', bpy.data.cameras.new('Gallery camera'))
    setup.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.clip_end = 500
    scene.camera = cam
    light = bpy.data.objects.new('Afternoon sun', bpy.data.lights.new('Afternoon sun', 'SUN'))
    setup.objects.link(light)
    light.rotation_euler = Vector((.6, .5, -1)).to_track_quat('-Z', 'Y').to_euler()
    light.data.energy, light.data.angle = 3.0, .10
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 4
    with tempfile.TemporaryDirectory(prefix='banvy-tree-previews-') as previews:
        thumbnails(scene, cam, Path(previews))
    scene.cycles.samples = 12
    cam.location = (2, -155, 107)
    target = Vector((0, 0, 7))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = 161
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.shading.type = 'MATERIAL'
                space.overlay.show_overlays = False
                space.region_3d.view_rotation = cam.rotation_euler.to_quaternion()
                space.region_3d.view_distance = 123
                space.region_3d.view_location = target
                space.region_3d.view_perspective = 'ORTHO'
    bpy.ops.object.select_all(action='DESELECT')
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=True)


if __name__ == '__main__':
    build(Path(sys.argv[sys.argv.index('--') + 1]).resolve())
