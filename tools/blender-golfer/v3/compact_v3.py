"""Compact an exported golfer GLB (12 November).

Blender's glTF exporter writes every vertex attribute and every animation key as
32-bit floats. The golfer ships with Spela to every player, so it is rewritten here:

  WEIGHTS_0     float x4 -> unsigned byte x4, normalized (each vertex's weights still sum to one)
  COLOR_0       float x3 -> unsigned byte x4, normalized (the baked shading)
  NORMAL        float x3 -> short x3, normalized, padded to 8 bytes (KHR_mesh_quantization)
  indices       32 bit -> 16 bit where a primitive has fewer than 65,536 vertices
  rotations     float x4 -> short x4, normalized (glTF's own quantized rotation keys)

Positions, texture coordinates, translations and key times stay floats: a skinned
mesh ignores its node's transform, so quantized positions could not be scaled back.
Nothing else in the file changes. three.js's GLTFLoader reads all of it.
"""
import json, struct
import numpy as np

FLOAT, UBYTE, SHORT, USHORT, UINT = 5126, 5121, 5122, 5123, 5125
SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(data):
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2
    jlen, jtype = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack_from('<II', data, off)
    return gltf, bytes(data[off + 8:off + 8 + blen])


def write_glb(gltf, binary):
    raw = json.dumps(gltf, separators=(',', ':')).encode()
    raw += b' ' * ((4 - len(raw) % 4) % 4)
    binary += b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(raw) + 8 + len(binary)
    return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(raw), 0x4E4F534A) + raw
            + struct.pack('<II', len(binary), 0x004E4942) + binary)


def read_accessor(gltf, binary, index):
    """An accessor's values as float64 rows (normalized integers mapped back to their range)."""
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    n = COUNT[acc['type']]; ct = acc['componentType']; size = SIZE[ct]
    stride = view.get('byteStride', n * size)
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    arr = np.ndarray((acc['count'], n), dtype=NP[ct], buffer=binary, offset=start, strides=(stride, size))
    vals = arr.astype(np.float64)
    if acc.get('normalized'):
        vals = {5121: vals / 255, 5123: vals / 65535, 5120: np.maximum(vals / 127, -1), 5122: np.maximum(vals / 32767, -1)}.get(ct, vals)
    return vals


def compact(path, report=True):
    data = open(path, 'rb').read()
    gltf, binary = read_glb(data)
    before = len(data)
    chunks = []          # new binary parts: (view index, bytes)
    new_views = {}       # accessor index -> replaced
    used_quantization = False

    def add_view(blob, target=None, stride=None):
        view = dict(buffer=0, byteOffset=0, byteLength=len(blob))
        if target:
            view['target'] = target
        if stride:
            view['byteStride'] = stride
        gltf['bufferViews'].append(view)
        chunks.append((len(gltf['bufferViews']) - 1, blob))
        return len(gltf['bufferViews']) - 1

    def replace(index, blob, ct, type_, normalized=True, target=None, stride=None, extra=None):
        acc = gltf['accessors'][index]
        acc['bufferView'] = add_view(blob, target, stride)
        acc.pop('byteOffset', None)
        acc['componentType'] = ct; acc['type'] = type_
        if normalized:
            acc['normalized'] = True
        else:
            acc.pop('normalized', None)
        for key in ('min', 'max'):
            acc.pop(key, None)
        if extra:
            acc.update(extra)
        new_views[index] = True

    stats = dict(weights=0, colours=0, normals=0, indices=0, rotations=0)
    done = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if 'WEIGHTS_0' in attrs and attrs['WEIGHTS_0'] not in done:
                i = attrs['WEIGHTS_0']; done.add(i)
                if gltf['accessors'][i]['componentType'] == FLOAT:
                    w = read_accessor(gltf, binary, i)
                    w = np.clip(w, 0, None); s = w.sum(1, keepdims=True); s[s == 0] = 1; w = w / s
                    q = np.floor(w * 255 + .5).astype(np.int32)
                    # Keep each sum at exactly 255: the remainder goes to the largest weight.
                    big = np.argmax(q, axis=1)
                    q[np.arange(len(q)), big] += 255 - q.sum(1)
                    replace(i, np.clip(q, 0, 255).astype(np.uint8).tobytes(), UBYTE, 'VEC4', target=34962)
                    stats['weights'] += len(q)
            if 'COLOR_0' in attrs and attrs['COLOR_0'] not in done:
                i = attrs['COLOR_0']; done.add(i)
                if gltf['accessors'][i]['componentType'] == FLOAT:
                    c = np.clip(read_accessor(gltf, binary, i), 0, 1)
                    if c.shape[1] == 3:
                        c = np.concatenate([c, np.ones((len(c), 1))], axis=1)
                    replace(i, np.floor(c * 255 + .5).astype(np.uint8).tobytes(), UBYTE, 'VEC4', target=34962)
                    stats['colours'] += len(c)
            if 'NORMAL' in attrs and attrs['NORMAL'] not in done:
                i = attrs['NORMAL']; done.add(i)
                if gltf['accessors'][i]['componentType'] == FLOAT:
                    n = read_accessor(gltf, binary, i)
                    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
                    q = np.zeros((len(n), 4), dtype=np.int16)
                    q[:, :3] = np.round(n * 32767).astype(np.int16)
                    replace(i, q.tobytes(), SHORT, 'VEC3', target=34962, stride=8)
                    used_quantization = True
                    stats['normals'] += len(n)
            if prim.get('indices') is not None and prim['indices'] not in done:
                i = prim['indices']; done.add(i)
                acc = gltf['accessors'][i]
                if acc['componentType'] == UINT:
                    idx = read_accessor(gltf, binary, i).astype(np.int64).ravel()
                    if idx.max() < 65535:
                        replace(i, idx.astype(np.uint16).tobytes(), USHORT, 'SCALAR', normalized=False, target=34963)
                        stats['indices'] += len(idx)
    for anim in gltf.get('animations', []):
        for ch in anim['channels']:
            if ch['target'].get('path') != 'rotation':
                continue
            sampler = anim['samplers'][ch['sampler']]
            i = sampler['output']
            if i in done or gltf['accessors'][i]['componentType'] != FLOAT:
                continue
            done.add(i)
            q = read_accessor(gltf, binary, i)
            q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
            replace(i, np.round(q * 32767).astype(np.int16).tobytes(), SHORT, 'VEC4')
            stats['rotations'] += len(q)
    # Repack: keep the views still referenced (by accessors and images), in order, then the new ones.
    referenced = {a['bufferView'] for a in gltf['accessors'] if 'bufferView' in a}
    referenced |= {img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img}
    new_blob = dict(chunks)
    remap = {}; views = []; parts = []; offset = 0
    for vi, view in enumerate(gltf['bufferViews']):
        if vi not in referenced:
            continue
        blob = new_blob[vi] if vi in new_blob else binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        pad = (-offset) % 8
        parts.append(b'\0' * pad); offset += pad
        nv = dict(view); nv['byteOffset'] = offset; nv['byteLength'] = len(blob)
        remap[vi] = len(views); views.append(nv)
        parts.append(blob); offset += len(blob)
    for a in gltf['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = remap[a['bufferView']]
    for img in gltf.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = remap[img['bufferView']]
    gltf['bufferViews'] = views
    gltf['buffers'] = [dict(byteLength=offset)]
    if used_quantization:
        for key in ('extensionsUsed', 'extensionsRequired'):
            ext = gltf.setdefault(key, [])
            if 'KHR_mesh_quantization' not in ext:
                ext.append('KHR_mesh_quantization')
    out = write_glb(gltf, b''.join(parts))
    open(path, 'wb').write(out)
    stats.update(before=before, after=len(out))
    if report:
        print('COMPACT', stats)
    return stats
