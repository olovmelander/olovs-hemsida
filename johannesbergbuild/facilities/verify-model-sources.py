"""Read-only model/source audit, writing only its validation receipt.

Run from any directory with the retained review Python environment:
  upsalabuild/cache/review-venv/Scripts/python.exe \
    johannesbergbuild/facilities/verify-model-sources.py

Checks current architecture/export/publication receipts; does not rebuild assets.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess

import numpy as np
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT/'johannesbergbuild/facilities'
SCOPED_PATHS = ['johannesbergbuild/facilities', 'apps/golf/public/models/johannesberg',
    'apps/golf/src/engine/scenery/johannesberg-facilities.mjs',
    'apps/golf/src/engine/scenery/johannesberg-facilities.test.mjs',
    'apps/golf/src/engine/scenery/johannesberg.js', 'apps/golf/src/engine/scenery/index.js',
    'apps/golf/public/_headers', 'apps/golf/vite.config.js',
    'tools/check-johannesberg-facilities.mjs', '.gitignore', '.gitattributes']


def read_json(path):
    return json.loads(Path(path).read_text('utf-8'))


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, total = struct.unpack_from('<III', raw)
    assert magic == 0x46546c67 and version == 2 and total == len(raw), 'Invalid GLB header'
    chunks, offset = {}, 12
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        assert offset+8+size <= len(raw) and kind not in chunks, 'Invalid/duplicate GLB chunk'
        chunks[kind] = raw[offset+8:offset+8+size]
        offset += 8+size
    doc, binary = json.loads(chunks[0x4e4f534a]), chunks[0x004e4942]
    assert len(doc['buffers']) == 1 and 'uri' not in doc['buffers'][0]
    assert doc['buffers'][0]['byteLength'] <= len(binary)
    return doc, binary


def accessor_arrays(doc, binary):
    types = {5120:'i1', 5121:'u1', 5122:'<i2', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
    widths = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT2':4, 'MAT3':9, 'MAT4':16}
    result = []
    for accessor in doc['accessors']:
        assert 'sparse' not in accessor
        view = doc['bufferViews'][accessor['bufferView']]
        dtype, width = np.dtype(types[accessor['componentType']]), widths[accessor['type']]
        start = view.get('byteOffset', 0)+accessor.get('byteOffset', 0)
        stride = view.get('byteStride', dtype.itemsize*width)
        assert start+(accessor['count']-1)*stride+width*dtype.itemsize <= len(binary)
        array = np.ndarray((accessor['count'], width), dtype, buffer=binary, offset=start,
                           strides=(stride, dtype.itemsize))
        assert np.isfinite(array).all(), 'Nonfinite accessor'
        result.append(array)
    return result


def check_json_numbers(value):
    if isinstance(value, float):
        assert math.isfinite(value), 'Nonfinite GLB JSON number'
    elif isinstance(value, dict):
        for v in value.values():
            check_json_numbers(v)
    elif isinstance(value, list):
        for v in value:
            check_json_numbers(v)


def git_checks():
    base = subprocess.run(['git', 'diff', '--check', '--', *SCOPED_PATHS], cwd=ROOT,
                          text=True, capture_output=True)
    untracked = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard', '--', *SCOPED_PATHS],
                              cwd=ROOT, text=True, capture_output=True, check=True)
    files, errors, warnings = [], [], []
    for line in (base.stdout+'\n'+base.stderr).splitlines():
        if line.startswith('warning:'):
            warnings.append(line)
        elif line.strip():
            errors.append(line)
    for filename in untracked.stdout.splitlines():
        if Path(filename).suffix.lower() not in ('.py', '.mjs', '.js', '.md', '.json'):
            continue
        checked = subprocess.run(['git', 'diff', '--no-index', '--check', '--', 'NUL' if __import__('os').name == 'nt' else '/dev/null', filename],
                                 cwd=ROOT, text=True, capture_output=True)
        files.append(filename)
        lines = (checked.stdout+'\n'+checked.stderr).splitlines()
        for line in lines:
            if line.startswith('warning:'):
                warnings.append(line)
            elif line.strip():
                errors.append(line)
        if checked.returncode not in (0, 1) and not lines:
            errors.append(f'git check failed for {filename}: {checked.returncode}')
    return dict(passed=base.returncode == 0 and not errors, trackedCommand=['git','diff','--check','--',*SCOPED_PATHS],
                untrackedTextFilesChecked=files, errors=errors, warnings=sorted(set(warnings)))


def main():
    hashes, pins, failures = {}, [], []
    report = dict(schemaVersion=1, checkedAt=datetime.now(timezone.utc).isoformat(), passed=False,
                  auditScope='Current source, architecture, export and public asset consistency; browser validation is separate.')

    def digest(path):
        path = (ROOT/path).resolve() if not isinstance(path, Path) else path.resolve()
        key = path.relative_to(ROOT).as_posix()
        if key not in hashes:
            hashes[key] = hashlib.sha256(path.read_bytes()).hexdigest()
        return hashes[key]

    def verify(path, expected, kind):
        try:
            actual = digest(path)
            entry = dict(path=Path(path).relative_to(ROOT).as_posix() if Path(path).is_absolute() else str(path),
                         expectedSha256=expected, actualSha256=actual, passed=actual == expected, kind=kind)
            pins.append(entry)
            if not entry['passed']:
                failures.append(entry)
        except Exception as error:
            failures.append(dict(path=str(path), kind=kind, error=str(error)))

    def nested_pins(value):
        if isinstance(value, dict):
            if isinstance(value.get('path'), str) and isinstance(value.get('sha256'), str):
                verify(value['path'], value['sha256'], 'retained-source')
            for v in value.values():
                nested_pins(v)
        elif isinstance(value, list):
            for v in value:
                nested_pins(v)

    try:
        spec = read_json(HERE/'architecture-spec.json')
        nested_pins(spec)
        build = read_json(HERE/'model-build-report.json')
        export = read_json(HERE/'model-export-validation.json')
        publication = read_json(HERE/'model-publish-validation.json')
        manifest = read_json(ROOT/publication['manifestPath'])
        report['currentReceipts'] = [dict(path=path.relative_to(ROOT).as_posix(), sha256=digest(path))
            for path in [HERE/'model-build-report.json', HERE/'model-export-validation.json',
                         HERE/'model-publish-validation.json', ROOT/publication['manifestPath']]]
        for path, sha in [(HERE/'architecture-spec.json', build['specSha256']),
                          (HERE/'build_architecture.py', build['implementationSha256']),
                          (build['blendPath'], build['blendSha256']),
                          (export['gridGlbPath'], export['gridGlbSha256']),
                          (export['workspacePath'], export['workspaceSha256']),
                          (HERE/'model-build-report.json', publication['modelBuildReportSha256'])]:
            verify(path, sha, 'build-export-receipt')
        asset = ROOT/'apps/golf/public'/manifest['asset']['url']
        verify(asset, manifest['asset']['sha256'], 'published-asset')
        assert asset.stat().st_size == manifest['asset']['bytes']
        assert manifest['asset'] == publication['publishedAsset']
        assert publication['gridGlbSha256'] == export['gridGlbSha256']
        assert build['scene'] == export['scene']
        grid, grid_binary = read_glb(ROOT/export['gridGlbPath'])
        public, public_binary = read_glb(asset)
        grid_arrays, public_arrays = accessor_arrays(grid, grid_binary), accessor_arrays(public, public_binary)
        check_json_numbers(public)
        assert not any(public.get(k) for k in ('images', 'textures', 'skins', 'animations', 'cameras'))
        assert public['asset']['extras']['sourceGridGlbSha256'] == export['gridGlbSha256']
        roots = public['scenes'][public.get('scene', 0)]['nodes']
        nodes = [public['nodes'][i] for i in roots]
        by_name = {n['name']:n for n in nodes}
        assert len(roots) == len(by_name) == len(manifest['facilities']) == 22
        for f in manifest['facilities']:
            assert by_name[f['nodeName']]['extras']['sourceBuildingId'] == f['sourceBuildingId']
        expected = {(f['id'], f['sourceBuildingId']) for f in spec['inventory']['facilities']}
        assert {(f['id'], f['sourceBuildingId']) for f in manifest['facilities']} == expected
        for node in public['nodes']:
            assert node.get('translation', [0,0,0]) == [0,0,0]
            assert node.get('rotation', [0,0,0,1]) == [0,0,0,1]
            assert node.get('scale', [1,1,1]) == [1,1,1] and 'matrix' not in node
        triangles = 0
        for mesh in public['meshes']:
            for primitive in mesh['primitives']:
                assert primitive.get('mode', 4) == 4
                indices = public_arrays[primitive['indices']]
                vertices = public_arrays[primitive['attributes']['POSITION']]
                assert indices.size % 3 == 0 and indices.max() < len(vertices)
                triangles += indices.size//3
        assert triangles == build['totalTriangles'] == export['triangles']
        transform = Transformer.from_crs(3006, 4326, always_xy=True)
        max_error = 0.0
        positions = {p['attributes']['POSITION'] for m in public['meshes'] for p in m['primitives']}
        for index in positions:
            points = grid_arrays[index].astype(float)
            lon, lat = transform.transform(points[:,0]+679200, 6626160-points[:,2])
            expected_positions = np.column_stack([(lon-18.19202)*56118.16, points[:,1]+16, (59.72733-lat)*111320])
            max_error = max(max_error, float(np.abs(public_arrays[index]-expected_positions).max()))
        assert max_error < .00004
        report.update(scene=build['scene'], architectureSources=len(spec['sources']),
            roots=22, sourceIdsMatch=True, facilities=[dict(id=f['id'], sourceBuildingId=f['sourceBuildingId'],
                nodeName=f['nodeName']) for f in manifest['facilities']], triangles=triangles,
            finiteAccessorCount=len(public_arrays), images=0, textures=0,
            exactPositionTransformMaximumErrorMetres=max_error, publicAsset=manifest['asset'])
        report['whitespace'] = git_checks()
        if not report['whitespace']['passed']:
            failures.append(dict(kind='whitespace', errors=report['whitespace']['errors']))
        ignored = subprocess.run(['git','check-ignore', build['blendPath'], export['workspacePath'],
            'johannesbergbuild/cache/facilities-reference/orthophoto/facilities-hub-native.png'],
            cwd=ROOT, capture_output=True, text=True)
        report['privateCacheIgnored'] = ignored.returncode == 0 and len(ignored.stdout.splitlines()) == 3
        assert report['privateCacheIgnored']
        report['passed'] = not failures
    except Exception as error:
        failures.append(dict(kind='audit-exception', type=type(error).__name__, error=str(error)))
    report['sourcePins'] = pins
    report['filesHashed'] = [dict(path=path, sha256=sha) for path, sha in sorted(hashes.items())]
    report['sourceAndReceiptFilesHashed'] = len(hashes)
    report['failures'] = failures
    report['auditImplementation'] = dict(path=Path(__file__).relative_to(ROOT).as_posix(),
        sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    report['roofClipTestCommand'] = 'blender --background --factory-startup --python-exit-code 1 --python johannesbergbuild/facilities/test-roof-clip.py'
    (HERE/'model-source-validation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', 'utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ('sourcePins','filesHashed','facilities','whitespace')}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
