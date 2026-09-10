"""Clip newly authored roof faces to a concave plan mask without Blender ops.

The architecture vertices use (E-679200, N-6626160, RH2000-16). Mask coordinates
are EPSG:3006. Each mask triangle is convex, so Sutherland-Hodgman clipping can
interpolate XYZ along face edges while retaining sloped and vertical surfaces.
"""
import math

from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ORIGIN_E = 679200.0
ORIGIN_N = 6626160.0
EPS = 1e-7
AREA_EPS = 1e-10


def _cross_xy(a, b, p):
    return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])


def _same(a, b):
    return sum((a[k]-b[k])**2 for k in range(3)) <= EPS**2


def _clean(points):
    result = []
    for point in points:
        if not result or not _same(result[-1], point):
            result.append(point)
    if len(result) > 1 and _same(result[0], result[-1]):
        result.pop()
    return result


def _area_3d(points):
    # XY area alone would incorrectly discard vertical gutters and fascias.
    if len(points) < 3:
        return 0.0
    origin = points[0]
    normal = [0.0, 0.0, 0.0]
    for i in range(1, len(points)-1):
        a = [points[i][k]-origin[k] for k in range(3)]
        b = [points[i+1][k]-origin[k] for k in range(3)]
        normal[0] += a[1]*b[2]-a[2]*b[1]
        normal[1] += a[2]*b[0]-a[0]*b[2]
        normal[2] += a[0]*b[1]-a[1]*b[0]
    return math.sqrt(sum(v*v for v in normal))/2


def _clip_to_triangle(points, triangle):
    result = points
    direction = 1 if _cross_xy(*triangle) > 0 else -1
    for i in range(3):
        a, b = triangle[i], triangle[(i+1) % 3]
        if not result:
            break
        output = []
        previous = result[-1]
        d_previous = direction*_cross_xy(a, b, previous)
        previous_inside = d_previous >= -EPS
        for current in result:
            d_current = direction*_cross_xy(a, b, current)
            current_inside = d_current >= -EPS
            if current_inside != previous_inside:
                denominator = d_previous-d_current
                if abs(denominator) > 1e-15:
                    t = max(0.0, min(1.0, d_previous/denominator))
                    output.append(tuple(previous[k]+t*(current[k]-previous[k]) for k in range(3)))
            if current_inside:
                output.append(current)
            previous, d_previous, previous_inside = current, d_current, current_inside
        result = _clean(output)
    return result


def _polygon_key(points):
    # A vertical face on a shared triangulation edge can belong to both mask
    # triangles. Remove that identical output once, preserving material/winding.
    values = [tuple(round(v, 6) for v in p) for p in points]
    candidates = []
    for sequence in (values, list(reversed(values))):
        candidates.extend(tuple(sequence[i:]+sequence[:i]) for i in range(len(sequence)))
    return min(candidates)


def clip_recent_faces(A, start_face, maskRingEPSG3006):
    """Replace A.faces[start_face:] with their intersection with the plan mask.

    Original face vertices are retained; callers may remove unused vertices at
    mesh finalization. Earlier faces/colors are untouched. A simple concave mask
    ring, either winding and optionally closed, is supported; holes are not.
    All clipping output is prepared before mutating the architecture object.
    """
    if not isinstance(start_face, int) or not 0 <= start_face <= len(A.faces):
        raise ValueError('start_face must address the current face array')
    if len(A.colors) != len(A.faces):
        raise ValueError('Architecture face/material arrays have different lengths')
    ring = _clean([tuple((float(p[0])-ORIGIN_E, float(p[1])-ORIGIN_N, 0.0))
                   for p in maskRingEPSG3006])
    if len(ring) < 3 or any(not math.isfinite(v) for p in ring for v in p):
        raise ValueError('Expected a finite polygon mask')
    if _area_3d(ring) <= AREA_EPS:
        raise ValueError('Polygon mask has zero area')
    # Blender4.5 returns point indices; older Blender builds returned vectors.
    # Resolve indices to the original double-precision local coordinates.
    triangles = [tuple(ring[p] if isinstance(p, int) else tuple(float(v) for v in p)
                       for p in tri)
                 for tri in tessellate_polygon([[Vector(p) for p in ring]])]
    triangles = [tri for tri in triangles if abs(_cross_xy(*tri)) > AREA_EPS]
    if not triangles:
        raise ValueError('Polygon mask could not be triangulated')
    triangle_bounds = [(min(p[0] for p in tri), min(p[1] for p in tri),
                        max(p[0] for p in tri), max(p[1] for p in tri)) for tri in triangles]

    vertices, faces, colors = [], [], []
    offset = len(A.vertices)
    removed = 0
    for face, color in zip(A.faces[start_face:], A.colors[start_face:]):
        points = _clean([tuple(float(v) for v in A.vertices[index]) for index in face])
        if any(len(p) != 3 or any(not math.isfinite(v) for v in p) for p in points):
            raise ValueError('Roof face contains invalid vertices')
        if _area_3d(points) <= AREA_EPS:
            removed += 1
            continue
        bounds = (min(p[0] for p in points), min(p[1] for p in points),
                  max(p[0] for p in points), max(p[1] for p in points))
        seen, emitted = set(), False
        for tri, tb in zip(triangles, triangle_bounds):
            if bounds[0] > tb[2]+EPS or bounds[2] < tb[0]-EPS or bounds[1] > tb[3]+EPS or bounds[3] < tb[1]-EPS:
                continue
            clipped = _clip_to_triangle(points, tri)
            if _area_3d(clipped) <= AREA_EPS:
                continue
            key = _polygon_key(clipped)
            if key in seen:
                continue
            seen.add(key)
            first = offset+len(vertices)
            vertices.extend(clipped)
            faces.append(tuple(range(first, first+len(clipped))))
            colors.append(color)
            emitted = True
        if not emitted:
            removed += 1
    original_count = len(A.faces)-start_face
    A.vertices.extend(vertices)
    A.faces[start_face:] = faces
    A.colors[start_face:] = colors
    return dict(inputFaces=original_count, outputFaces=len(faces),
                entirelyDiscardedFaces=removed, addedVertices=len(vertices), maskTriangles=len(triangles))
