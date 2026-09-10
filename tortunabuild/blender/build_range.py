"""Build Tortuna's measured driving range in Blender and render a review image.

This is a CHECK, not the runtime. The app draws the range procedurally from
tortuna-range-site.json so that every piece follows the 1 m terrain; this scene
rebuilds the same measured numbers independently, so proportions can be judged
away from the engine's own shading. Nothing here is exported into the course.

Run through the existing MCP add-on:
  <blender>/python.exe tortunabuild/blender/mcp_client.py --exec tortunabuild/blender/build_range.py
"""
import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "tortunabuild", "cache", "range", "blender-input.json")
OUT = os.path.join(ROOT, "tortunabuild", "cache", "range", "shots", "blender-review.png")
with open(DATA, "r", encoding="utf8") as handle:
    SITE = json.load(handle)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def material(name, rgba, roughness=0.9):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def mesh_from(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    return obj


def triangulate(ring):
    """Ear clipping. A centroid fan was tried first and is wrong here: the
    earthworks boundary is concave where it wraps the target area and the works
    yard, and a fan across a reflex vertex draws triangles outside the polygon.
    The engine uses three's own triangulator; this is the same job done locally
    so the review image shows the polygon that was traced."""
    points = [(p[0], p[1]) for p in ring]
    index = list(range(len(points)))
    area = sum(points[i][0] * points[(i + 1) % len(points)][1]
               - points[(i + 1) % len(points)][0] * points[i][1] for i in range(len(points)))
    if area < 0:
        index.reverse()

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        """STRICTLY inside. An on-or-touching test stalls the clipper here:
        marching squares plus a 1.5 m simplification leaves many vertices lying
        exactly on a candidate ear's edge, every ear is then refused, and the
        first attempt produced 9 triangles from a 121-point ring instead of 119."""
        eps = 1e-9
        d1, d2, d3 = cross(a, b, p), cross(b, c, p), cross(c, a, p)
        return d1 > eps and d2 > eps and d3 > eps

    faces, guard = [], 0
    while len(index) > 3 and guard < 10000:
        guard += 1
        for k in range(len(index)):
            prev, cur, nxt = index[k - 1], index[k], index[(k + 1) % len(index)]
            a, b, c = points[prev], points[cur], points[nxt]
            if cross(a, b, c) <= 0:
                continue
            if any(inside(points[j], a, b, c) for j in index if j not in (prev, cur, nxt)):
                continue
            faces.append((prev, cur, nxt))
            index.pop(k)
            break
        else:
            break
    if len(index) == 3:
        faces.append(tuple(index))
    return [tuple(p) for p in ring], faces


reset()
turf = material("turf", (0.15, 0.32, 0.12, 1))
matgreen = material("mat", (0.09, 0.34, 0.13, 1), 0.75)
earth = material("earthworks", (0.64, 0.61, 0.58, 1))
steel = material("steel", (0.24, 0.25, 0.26, 1), 0.55)
mesh_mat = material("netting", (0.09, 0.12, 0.10, 1), 0.95)
mesh_mat.blend_method = "BLEND"
mesh_mat.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.34

# a ground plane at the datum, so the pieces are read against something
bpy.ops.mesh.primitive_plane_add(size=600, location=(120, -300, -0.05))
bpy.context.active_object.data.materials.append(turf)
bpy.context.active_object.name = "ground"

earth_verts, earth_faces = triangulate(SITE["earthworks"])
mesh_from("earthworks", earth_verts, earth_faces, earth)

thickness = SITE["matThicknessMetres"]
for mat_rec in SITE["mats"]:
    ring = mat_rec["ring"]
    verts = [(p[0], p[1], p[2] + thickness) for p in ring] + [(p[0], p[1], p[2]) for p in ring]
    n = len(ring)
    faces = [tuple(range(n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh_from(mat_rec["id"], verts, faces, matgreen)

for index, post in enumerate(SITE["netPosts"]):
    x, y = post["at"]
    bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=post["height"],
                                        location=(x, y, post["base"] + post["height"] / 2))
    obj = bpy.context.active_object
    obj.name = "net-post-%02d" % (index + 1)
    obj.data.materials.append(steel)

line = SITE["netLine"]
height = SITE["net"]["heightMetres"]
verts, faces = [], []
for i, p in enumerate(line):
    verts.extend([(p[0], p[1], p[2] + 0.15), (p[0], p[1], p[2] + height)])
    if i:
        a = (i - 1) * 2
        faces.append((a, a + 1, a + 3, a + 2))
mesh_from("net-mesh", verts, faces, mesh_mat)

sun = bpy.data.lights.new("sun", type="SUN")
sun.energy = 4.0
sun.angle = math.radians(2)
sun_obj = bpy.data.objects.new("sun", sun)
sun_obj.rotation_euler = (math.radians(50), 0, math.radians(-135))
bpy.context.collection.objects.link(sun_obj)

mats = SITE["mats"]
mid = mats[len(mats) // 2]["ring"][0]
net_mid = line[len(line) // 2]
dx, dy = net_mid[0] - mid[0], net_mid[1] - mid[1]
dist = math.hypot(dx, dy)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 32
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (mid[0] - dx / dist * 34, mid[1] - dy / dist * 34, mid[2] + 16)
cam.rotation_euler = (math.radians(76), 0, math.atan2(dy, dx) - math.radians(90))
bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {
    item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
} else "BLENDER_EEVEE"
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.filepath = OUT
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.34, 0.42, 0.55, 1)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.render.render(write_still=True)
print(json.dumps({
    "objects": len(bpy.context.scene.objects),
    "earthworksTriangles": len(earth_faces),
    "mats": len(SITE["mats"]),
    "netPosts": len(SITE["netPosts"]),
    "earthworksPoints": len(SITE["earthworks"]),
    "datumRh2000": SITE["datumRh2000"],
    "render": OUT,
    "engine": scene.render.engine,
}))
