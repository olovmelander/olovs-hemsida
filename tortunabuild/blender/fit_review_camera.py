"""Frame every architectural vertex, including tall gables, in a review camera."""
from mathutils import Vector


def fit_review_camera(scene):
    camera=scene.camera
    points=[obj.matrix_world@v.co for obj in scene.objects if obj.type=='MESH' for v in obj.data.vertices]
    lo=Vector(tuple(min(p[j] for p in points) for j in range(3)))
    hi=Vector(tuple(max(p[j] for p in points) for j in range(3)))
    center=(lo+hi)/2
    rotation=camera.rotation_euler.to_matrix()
    camera.location=center+rotation@Vector((0,0,max(40,(hi-lo).length*3)))
    inverse=rotation.transposed()
    projected=[inverse@(p-center) for p in points]
    width=2*max(abs(p.x) for p in projected)
    height=2*max(abs(p.y) for p in projected)
    aspect=scene.render.resolution_x/scene.render.resolution_y
    camera.data.ortho_scale=max(width,height*aspect)*1.12
