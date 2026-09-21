"""Open the saved study in background Blender and check its animated poses."""
import bpy, json, math, os

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
with open(os.path.join(os.path.dirname(__file__), 'cache', 'flag-bake.json'), encoding='utf-8') as fh:
    bake = json.load(fh)
sc = bpy.data.scenes['Flag wind and fabric review']
bpy.context.window.scene = sc
objects = [o for o in sc.objects if o.name.startswith('Flag review ') and o.name.endswith(' cloth')]
assert len(objects) == 6
worst = 0
for frame in [1, 90, 180]:
    sc.frame_set(frame)
    dg = sc.view_layers[0].depsgraph
    for obj in objects:
        name = obj.name.removeprefix('Flag review ').removesuffix(' cloth')
        source = next(b for b in bake['bands'] if b['name'] == name)['frames'][frame-1]
        evaluated = obj.evaluated_get(dg)
        mesh = evaluated.to_mesh()
        for i in range(bake['grid']['nx'] * bake['grid']['nz']):
            expected = (source[3*i], -source[3*i+2], source[3*i+1])
            error = math.dist(mesh.vertices[i].co, expected)
            assert math.isfinite(error)
            worst = max(worst, error)
        evaluated.to_mesh_clear()
assert worst < 0.001, worst
assert all(image.packed_file for image in bpy.data.images if image.name.startswith('flag-atlas'))
# Convert the isolated library into a project that opens on the review scene.
sc.frame_set(98)
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
        area.spaces.active.shading.type = 'MATERIAL'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
report = {'file': os.path.relpath(bpy.data.filepath, root), 'flags': len(objects),
          'activeScene': bpy.context.scene.name,
          'framesChecked': [1,90,180], 'maximumPoseErrorM': worst, 'packedAtlas': True}
with open(os.path.join(os.path.dirname(bpy.data.filepath),'blender-reopen-audit.json'),'w',encoding='utf-8') as fh:
    json.dump(report,fh,indent=2)
print(json.dumps(report))
