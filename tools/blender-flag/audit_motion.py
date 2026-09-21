"""Inspect the exported guide loops through Blender MCP without changing scenes."""
import bpy
import json
import os
import numpy as np

root = os.path.dirname(__file__)
with open(globals().get('SOURCE', os.path.join(root, 'cache', 'flag-bake.json')), encoding='utf-8') as f:
    bake = json.load(f)
nx, nz = bake['grid']['nx'], bake['grid']['nz']
triangles = []
for j in range(nz - 1):
    for i in range(nx - 1):
        a = j * nx + i
        triangles.extend(((a, a + nx, a + 1), (a + 1, a + nx, a + nx + 1)))
triangles = np.array(triangles)
rows = []
for band in bake['bands']:
    p = np.array(band['frames']).reshape((-1, nx * nz, 3))
    normals = np.cross(p[:, triangles[:, 1]] - p[:, triangles[:, 0]],
                       p[:, triangles[:, 2]] - p[:, triangles[:, 0]])
    lengths = np.linalg.norm(normals, axis=2)
    normals /= np.maximum(lengths[:, :, None], 1e-12)
    angles = np.degrees(np.arccos(np.clip(np.sum(normals * np.roll(normals, 1, axis=0), axis=2), -1, 1)))
    steps = np.linalg.norm(p - np.roll(p, 1, axis=0), axis=2)
    rows.append({'name': band['name'], 'ms': band['ms'],
                 'maxNormalStepDeg': float(angles.max()),
                 'seamNormalStepDeg': float(angles[0].max()),
                 'maxVertexStepM': float(steps.max()),
                 'seamVertexStepM': float(steps[0].max())})
report = {'blender': bpy.app.version_string, 'activeScene': bpy.context.scene.name,
          'fps': bake['fps'], 'bands': rows}
out = globals().get('OUT', os.path.join(root, 'cache', 'guide-motion-audit.json'))
with open(out, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
print(json.dumps(report))
