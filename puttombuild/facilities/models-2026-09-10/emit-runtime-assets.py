"""Project saved Blender triangles exactly, then emit a self-contained GLB.

Run with the repository's ortho Python environment (pyproj required). No Blender
API, reference imagery, terrain data or existing course model is modified.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import struct

from pyproj import Transformer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUTPUT = ROOT / 'apps/golf/public/models/puttom'
CACHE = ROOT / 'puttombuild/cache/facilities-model-2026-09-10'
UNPROJECT = Transformer.from_crs(3006, 4326, always_xy=True)
PROJECT = Transformer.from_crs(4326, 3006, always_xy=True)
ORIGIN_E, ORIGIN_N, ORIGIN_H = 697365., 7025190., 44.
LAT, LON, M_LAT, M_LON = 63.2992, 18.9413, 111320., 50019.58


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def project(east, north):
    longitude, latitude = UNPROJECT.transform(east, north)
    return (longitude - LON) * M_LON, -(latitude - LAT) * M_LAT


def project_pairs(points):
    return [list(project(e, n)) for e, n in points]


def finite(values, context):
    if not all(math.isfinite(value) for value in values):
        raise ValueError(f'Nonfinite {context}')


def transform_primitive(primitive):
    positions, normals = primitive['positions'], primitive['normals']
    if len(positions) != len(normals) or not positions or len(positions) % 9:
        raise ValueError('Primitive must contain matching position/normal triangle corners')
    east = [v + ORIGIN_E for v in positions[0::3]]
    north = [v + ORIGIN_N for v in positions[1::3]]
    lon, lat = UNPROJECT.transform(east, north)
    lon_e0, lat_e0 = UNPROJECT.transform([e - .5 for e in east], north)
    lon_e1, lat_e1 = UNPROJECT.transform([e + .5 for e in east], north)
    lon_n0, lat_n0 = UNPROJECT.transform(east, [n - .5 for n in north])
    lon_n1, lat_n1 = UNPROJECT.transform(east, [n + .5 for n in north])
    grounding = 'groundModes' in primitive
    if grounding:
        anchors, modes, clearances = primitive['groundAnchorsLocal'], primitive['groundModes'], primitive['groundClearances']
        if len(anchors) != len(positions) or len(modes) != len(east) or len(clearances) != len(east):
            raise ValueError('Ground-contact attribute counts differ from geometry')
        anchor_lon, anchor_lat = UNPROJECT.transform([e + ORIGIN_E for e in anchors[0::3]], [n + ORIGIN_N for n in anchors[1::3]])
    anchor_bytes, mode_bytes, clearance_bytes = bytearray(), bytearray(), bytearray()
    position_bytes, normal_bytes, indices, unique = bytearray(), bytearray(), [], {}
    minimum, maximum = [math.inf] * 3, [-math.inf] * 3
    maximum_roundtrip_m = 0.
    for i in range(len(east)):
        vertex = ((lon[i] - LON) * M_LON, positions[3 * i + 2] + ORIGIN_H, -(lat[i] - LAT) * M_LAT)
        # J maps grid E/N to legacy X/Z. Normals use inverse(J).transpose(),
        # with Blender up moving to the runtime Y axis. Derivatives span 1 m.
        a, b = (lon_e1[i] - lon_e0[i]) * M_LON, (lon_n1[i] - lon_n0[i]) * M_LON
        c, d = -(lat_e1[i] - lat_e0[i]) * M_LAT, -(lat_n1[i] - lat_n0[i]) * M_LAT
        determinant = a * d - b * c
        if not math.isfinite(determinant) or abs(determinant) < .5:
            raise ValueError('Invalid projection normal Jacobian')
        ne, nn, nh = normals[3 * i:3 * i + 3]
        normal = ((d * ne - c * nn) / determinant, nh, (-b * ne + a * nn) / determinant)
        length = math.sqrt(sum(v * v for v in normal))
        if length < .5:
            raise ValueError('Missing source normal')
        normal = tuple(v / length for v in normal)
        finite((*vertex, *normal), 'projected vertex')
        packed_position, packed_normal = struct.pack('<3f', *vertex), struct.pack('<3f', *normal)
        key = packed_position + packed_normal
        if grounding:
            mode, clearance = modes[i], clearances[i]
            anchor = ((anchor_lon[i] - LON) * M_LON, anchors[3 * i + 2] + ORIGIN_H, -(anchor_lat[i] - LAT) * M_LAT)
            if mode not in (0, 1, 2) or not -2 <= clearance <= 2:
                raise ValueError('Invalid ground-contact mode or clearance')
            finite((*anchor, clearance), 'ground-contact anchor')
            packed_anchor = struct.pack('<3f', *anchor)
            packed_mode, packed_clearance = struct.pack('<f', mode), struct.pack('<f', clearance)
            key += packed_anchor + packed_mode + packed_clearance
        if key not in unique:
            unique[key] = len(unique)
            position_bytes.extend(packed_position)
            normal_bytes.extend(packed_normal)
            if grounding:
                anchor_bytes.extend(packed_anchor); mode_bytes.extend(packed_mode); clearance_bytes.extend(packed_clearance)
            rounded = struct.unpack('<3f', packed_position)
            for axis, value in enumerate(rounded):
                minimum[axis] = min(minimum[axis], value)
                maximum[axis] = max(maximum[axis], value)
            # Receipt checks precision after the actual runtime float32 roundtrip.
            check_e, check_n = PROJECT.transform(rounded[0] / M_LON + LON, LAT - rounded[2] / M_LAT)
            maximum_roundtrip_m = max(maximum_roundtrip_m, math.hypot(check_e - east[i], check_n - north[i]))
        indices.append(unique[key])
    component_type, code = (5123, 'H') if len(unique) <= 65536 else (5125, 'I')
    index_bytes = struct.pack('<' + code * len(indices), *indices)
    return dict(positions=position_bytes, normals=normal_bytes, indices=index_bytes, vertices=len(unique),
                groundAnchors=anchor_bytes, groundModes=mode_bytes, groundClearances=clearance_bytes,
                indexCount=len(indices), componentType=component_type, min=minimum, max=maximum,
                maximumRoundtripMetres=maximum_roundtrip_m)


class Glb:
    def __init__(self):
        self.binary = bytearray()
        self.doc = dict(asset=dict(version='2.0', generator='Puttom saved Blender geometry + pyproj exact legacy projection'),
                        scene=0, scenes=[dict(nodes=[])], nodes=[], meshes=[], materials=[], accessors=[], bufferViews=[])

    def accessor(self, data, component, count, shape, target, minimum=None, maximum=None):
        while len(self.binary) % 4:
            self.binary.append(0)
        view = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append(dict(buffer=0, byteOffset=len(self.binary), byteLength=len(data), target=target))
        self.binary.extend(data)
        record = dict(bufferView=view, componentType=component, count=count, type=shape)
        if minimum is not None:
            record.update(min=minimum, max=maximum)
        self.doc['accessors'].append(record)
        return len(self.doc['accessors']) - 1

    def encode(self):
        while len(self.binary) % 4:
            self.binary.append(0)
        self.doc['buffers'] = [dict(byteLength=len(self.binary))]
        raw = json.dumps(self.doc, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        raw += b' ' * (-len(raw) % 4)
        total = 12 + 8 + len(raw) + 8 + len(self.binary)
        return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(raw), 0x4E4F534A) + raw + struct.pack('<II', len(self.binary), 0x004E4942) + self.binary


def emit(snapshot, source_bytes):
    frame = snapshot.get('coordinateFrame', {})
    if snapshot.get('groundId') != 'puttom' or frame.get('origin') != [ORIGIN_E, ORIGIN_N, ORIGIN_H] or frame.get('axes') != 'east-north-up':
        raise ValueError('Unexpected Blender extraction frame')
    model = json.loads((ROOT / 'puttombuild/course-model.json').read_text(encoding='utf-8'))
    available = {b['id'] for b in model['infra']['buildings'] if 'id' in b}
    sources, ids = set(), set()
    glb = Glb()
    for material in snapshot['materials']:
        rgba = material['baseColorFactor']
        finite(rgba, 'material color')
        if len(rgba) != 4 or any(v < 0 or v > 1 for v in rgba):
            raise ValueError(f'Invalid linear material color: {material["name"]}')
        glb.doc['materials'].append(dict(name=material['name'], doubleSided=True,
            pbrMetallicRoughness=dict(baseColorFactor=rgba, metallicFactor=material['metallicFactor'], roughnessFactor=material['roughnessFactor']),
            alphaMode='BLEND' if rgba[3] < .999 else 'OPAQUE'))
    facilities, total_vertices, total_triangles, roundtrip = [], 0, 0, 0.
    for facility in snapshot['facilities']:
        fid = facility['id']
        if fid in ids:
            raise ValueError(f'Duplicate facility {fid}')
        ids.add(fid)
        source_ids = facility['sourceBuildingIds']
        if not isinstance(source_ids, list):
            raise ValueError(f'{fid}: source IDs must be an array')
        for source in source_ids:
            if source not in available or source in sources:
                raise ValueError(f'{fid}: missing or duplicate inherited source {source}')
            sources.add(source)
        parent_index = len(glb.doc['nodes'])
        glb.doc['nodes'].append(dict(name=fid, children=[], extras=dict(facilityId=fid, sourceBuildingIds=source_ids)))
        glb.doc['scenes'][0]['nodes'].append(parent_index)
        minimum, maximum = [math.inf] * 3, [-math.inf] * 3
        for bucket_index, primitive in enumerate(facility['primitives']):
            converted = transform_primitive(primitive)
            position = glb.accessor(converted['positions'], 5126, converted['vertices'], 'VEC3', 34962, converted['min'], converted['max'])
            normal = glb.accessor(converted['normals'], 5126, converted['vertices'], 'VEC3', 34962)
            index = glb.accessor(converted['indices'], converted['componentType'], converted['indexCount'], 'SCALAR', 34963)
            mesh_index = len(glb.doc['meshes'])
            name = f'{fid}-material-{bucket_index:02d}'
            attributes = dict(POSITION=position, NORMAL=normal)
            if converted['groundModes']:
                if facility['kind'] != 'site':
                    raise ValueError(f'{fid}: ground-contact attributes cannot move a building')
                attributes['_GROUND_ANCHOR'] = glb.accessor(converted['groundAnchors'], 5126, converted['vertices'], 'VEC3', 34962)
                attributes['_GROUND_MODE'] = glb.accessor(converted['groundModes'], 5126, converted['vertices'], 'SCALAR', 34962)
                attributes['_GROUND_CLEARANCE'] = glb.accessor(converted['groundClearances'], 5126, converted['vertices'], 'SCALAR', 34962)
            glb.doc['meshes'].append(dict(name=name, primitives=[dict(attributes=attributes, indices=index,
                                                                    material=primitive['material'], mode=4)]))
            child_index = len(glb.doc['nodes'])
            glb.doc['nodes'].append(dict(name=name, mesh=mesh_index, extras=dict(materialRoles=primitive.get('materialRoles', []),
                castShadow=bool(primitive.get('castShadow', True)), receiveShadow=bool(primitive.get('receiveShadow', True)))))
            glb.doc['nodes'][parent_index]['children'].append(child_index)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], converted['min'][axis])
                maximum[axis] = max(maximum[axis], converted['max'][axis])
            total_vertices += converted['vertices']; total_triangles += converted['indexCount'] // 3
            roundtrip = max(roundtrip, converted['maximumRoundtripMetres'])
        item = dict(id=fid, nodeName=fid, sourceBuildingIds=source_ids, kind=facility['kind'],
                    groundAnchorLocal=list(project(*facility['groundAnchorEpsg3006'])),
                    groundAnchorRh2000M=facility['groundAnchorRh2000M'],
                    footprintLocal=project_pairs(facility['footprintEpsg3006']),
                    boundsLocalRh2000=dict(min=minimum, max=maximum), placement=facility.get('placement', 'absolute-rh2000'),
                    evidence=facility['evidence'], excludeVegetation=bool(facility.get('excludeVegetation', facility['kind'] == 'building')))
        facilities.append(item)
    if 'trace-clubhouse-main' not in sources:
        raise ValueError('Missing clubhouse replacement')
    if total_triangles > 750000 or roundtrip > .002:
        raise ValueError(f'Exceeded geometry or projection precision budget: {total_triangles} triangles, {roundtrip} m')
    binary = glb.encode()
    if len(binary) > 32 * 1024 * 1024:
        raise ValueError('Asset exceeds runtime byte budget')
    manifest = dict(schemaVersion=1, groundId='puttom', courseSlugs=['puttom'],
                    coordinateFrame=dict(kind='legacy-local-rh2000', originWgs84=dict(lat=LAT, lon=LON), mPerLat=M_LAT, mPerLon=M_LON,
                                         axes='east-up-south', heightDatum='RH2000'),
                    asset=dict(url='models/puttom/facilities-v1.glb', sha256=sha256(binary), bytes=len(binary)),
                    replacesRangeFacilities=bool(snapshot.get('replacesRangeFacilities', False)),
                    sourceBlend=snapshot['sourceBlend'], sourceScene=snapshot['scene'],
                    sourceExtractionSha256=sha256(source_bytes),
                    sourceAttribution='Orthophoto and Laserdata, Lantmateriet, processed, CC BY 4.0. Reference photographs informed modelling; no photographic textures are distributed.',
                    facilities=facilities)
    receipt = dict(schemaVersion=1, checkedAt=datetime.now(timezone.utc).isoformat(), status='exported',
                   sourceBlend=snapshot['sourceBlend'], sourceExtractionSha256=sha256(source_bytes), asset=manifest['asset'],
                   facilities=len(facilities), replacements=len(sources), materials=len(glb.doc['materials']),
                   meshes=len(glb.doc['meshes']), vertices=total_vertices, triangles=total_triangles,
                   maximumHorizontalFloat32RoundtripMetres=roundtrip,
                   projection='pyproj EPSG:3006 -> EPSG:4326 -> existing Puttom local course frame; inverse-Jacobian transformed normals')
    return binary, manifest, receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, default=CACHE / 'authoring-scene.json')
    args = parser.parse_args()
    source_bytes = args.input.read_bytes()
    binary, manifest, receipt = emit(json.loads(source_bytes), source_bytes)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'facilities-v1.glb').write_bytes(binary)
    (OUTPUT / 'facilities-v1.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    (HERE / 'export-receipt.json').write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
