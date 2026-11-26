import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { validateFacilityManifest, linearLuminance } from './validate-facility-glb.mjs';
import { publishFacility } from './publish-facility-glb.mjs';
import { checkGroundQuality } from '../check-course-quality.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function buildMinimalGlb({ nodeName = 'Castle', baseColorFactor = [0.74, 0.72, 0.68, 1.0] } = {}) {
  // 3 vertices (1 triangle): POSITION (36 bytes) + NORMAL (36 bytes) = 72 bytes
  const bin = Buffer.alloc(72);
  // POSITION: (0,0,0), (1,0,0), (0,1,0)
  bin.writeFloatLE(1, 12);
  bin.writeFloatLE(1, 28);
  // NORMAL: (0,0,1) x 3
  bin.writeFloatLE(1, 44);
  bin.writeFloatLE(1, 56);
  bin.writeFloatLE(1, 68);

  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 72 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    materials: [{ name: 'Stucco', pbrMetallicRoughness: { baseColorFactor, roughnessFactor: 0.85, metallicFactor: 0 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    nodes: [{ name: nodeName, mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  while (jsonBuf.length % 4 !== 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(' ')]);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(jsonBuf.length, 0);
  jsonHdr.writeUInt32LE(0x4e4f534a, 4);

  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(bin.length, 0);
  binHdr.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHdr, jsonBuf, binHdr, bin]);
}

test('validateFacilityManifest accepts bloom-safe GLB and rejects bright whitewash exceeding GLOW threshold', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-fac-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const modelsDir = path.join(dir, 'models', 'bro-hof');
  fs.mkdirSync(modelsDir, { recursive: true });

  const writeFixture = baseColor => {
    const glb = buildMinimalGlb({ nodeName: 'Bro Hof Slott', baseColorFactor: baseColor });
    const glbPath = path.join(modelsDir, 'facilities-v1.glb');
    fs.writeFileSync(glbPath, glb);
    const manifestPath = path.join(modelsDir, 'facilities-v1.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      groundId: 'bro-hof',
      asset: {
        url: 'models/bro-hof/facilities-v1.glb',
        bytes: glb.length,
        sha256: createHash('sha256').update(glb).digest('hex'),
      },
      facilities: [{ id: 'castle', nodeName: 'Bro Hof Slott', groundAnchorLocal: [0, 0], groundAnchorRh2000M: 12.4 }],
    }));
    return manifestPath;
  };

  // Warm calibrated white stucco (linear luminance ~0.72 < 0.82) -> PASS
  const safePath = writeFixture([0.74, 0.72, 0.68, 1.0]);
  const safeRes = validateFacilityManifest({ manifestPath: safePath, publicRoot: dir });
  assert.equal(safeRes.valid, true, JSON.stringify(safeRes.errors));
  assert.equal(safeRes.summary.triangles, 1);
  assert(linearLuminance([0.74, 0.72, 0.68]) < 0.82);

  // Over-bright pure white stucco (linear luminance 0.96 > 0.82) -> REJECT
  const brightPath = writeFixture([0.96, 0.96, 0.95, 1.0]);
  const brightRes = validateFacilityManifest({ manifestPath: brightPath, publicRoot: dir });
  assert.equal(brightRes.valid, false);
  assert.match(brightRes.errors[0], /bloom-safe ceiling/);
});

test('checkGroundQuality enforces bloom guardrail and passes terrain/seam/course checks on shipped Lidingö', () => {
  const strict = checkGroundQuality({ groundId: 'lidingo', publicRoot: path.join(ROOT, 'apps/golf/public') });
  // Lidingö's pre-v2 facility GLB uses 0xf4f2eb (linear lum 0.8874 > 0.82); strict mode flags it
  assert.equal(strict.ok, false);
  assert(strict.errors.every(e => e.includes('bloom-safe ceiling')));

  // With historical ceiling, all terrain, seam, green, tee, water, and manifest checks pass cleanly
  const report = checkGroundQuality({
    groundId: 'lidingo',
    publicRoot: path.join(ROOT, 'apps/golf/public'),
    checkFacilityMaxLum: 0.90,
  });
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.summary.tiles, 469);
  assert.equal(report.summary.seam.maxEdgeDeltaM, 0);
  assert.equal(report.summary.courses[0].holes, 18);
});

test('publishFacility names the GLB by its hash, drops the one it replaces and refuses a stale manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facility-publish-'));
  try {
    const from = path.join(dir, 'build'), publicRoot = path.join(dir, 'public');
    fs.mkdirSync(from, { recursive: true });
    const write = tint => {
      const glb = buildMinimalGlb({ baseColorFactor: [tint, tint, tint, 1] }), sha256 = createHash('sha256').update(glb).digest('hex');
      fs.writeFileSync(path.join(from, 'facilities.glb'), glb);
      fs.writeFileSync(path.join(from, 'facilities-v1.json'), JSON.stringify({ schemaVersion: 1, groundId: 'demo',
        asset: { url: `models/demo/facilities-${sha256}.glb`, sha256, bytes: glb.length }, facilities: [{}] }));
      return sha256;
    };
    const first = write(0.5), listed = () => fs.readdirSync(path.join(publicRoot, 'models/demo')).sort();
    publishFacility({ from, publicRoot });
    assert.deepEqual(listed(), [`facilities-${first}.glb`, 'facilities-v1.json']);
    const second = write(0.4);
    assert.deepEqual(publishFacility({ from, publicRoot, check: true }).stale, [`facilities-${first}.glb`]);
    assert.deepEqual(listed(), [`facilities-${first}.glb`, 'facilities-v1.json']);   // a check writes nothing
    publishFacility({ from, publicRoot });
    assert.deepEqual(listed(), [`facilities-${second}.glb`, 'facilities-v1.json']);
    fs.writeFileSync(path.join(from, 'facilities.glb'), buildMinimalGlb({ baseColorFactor: [0.1, 0.1, 0.1, 1] }));
    assert.throws(() => publishFacility({ from, publicRoot }), /another GLB/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* campus_mesh.py runs inside Blender, which CI does not have: there this is skipped, and the published campus
   it built is held by its own test (apps/golf/src/engine/scenery/tjusta.test.mjs). */
const BLENDER = (() => {
  const probe = spawnSync('blender', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 && /Blender \d/.test(probe.stdout);
})();
test('campus_mesh winds every face to look the way it was told, on a frame turned off the grid', { skip: !BLENDER && 'Blender is not installed' }, () => {
  const script = `
import json, math, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools/facility-pipeline'))})
from campus_mesh import Frame, Mesh, linear
f = Frame((1000.0, 2000.0), 1010.0, 2020.0, 30.0)
m = Mesh(f)
m.box('wall', -4, 4, -3, 3, 10, 13, bottom=True)
m.roof('roof', [(-3.4, 13), (0, 15), (3.4, 13)], -4.3, 4.3, 'u', 'edge')
m.wall('wall', (5, 5), (9, 5), 10, 12, (0, -1))                    # told to look toward -v, given the other way round
m.panel('door', (9, 5), (5, 5), 10, 12, (0, -1), 0.05)
def normals(mat):
    verts, faces = m.parts[mat]
    out = []
    for a, b, c in faces:
        p, q, r = verts[a], verts[b], verts[c]
        u = [q[k] - p[k] for k in range(3)]; v = [r[k] - p[k] for k in range(3)]
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        l = math.hypot(*n)
        centre = [(p[k] + q[k] + r[k]) / 3 for k in range(3)]
        out.append(([x / l for x in n], centre))
    return out
middle = f.scene((0, 0, 11.5))
box = [(n[0] * (c[0] - middle[0]) + n[1] * (c[1] - middle[1]) + n[2] * (c[2] - middle[2])) for n, c in normals('wall')[:12]]
minus_v = f.turn((0, -1, 0))
lone = [n[0] * minus_v[0] + n[1] * minus_v[1] for n, _ in normals('wall')[12:]]
door = [n[0] * minus_v[0] + n[1] * minus_v[1] for n, _ in normals('door')]
lo, hi = m.bounds()
print(json.dumps(dict(box=min(box), roof=min(n[2] for n, _ in normals('roof')), lone=min(lone), door=min(door), triangles=m.triangles(),
                      origin=[round(v, 6) for v in f.scene((0, 0, 0))], east=[round(v, 6) for v in f.turn((1, 0, 0))], top=hi[2], red=linear(0xff0000))))
`;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'campus-mesh-')), 'probe.py');
  fs.writeFileSync(file, script);
  try {
    const run = spawnSync('blender', ['--background', '--factory-startup', '--python', file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').filter(line => line.startsWith('{')).at(-1));
    assert.ok(out.box > 0, 'every face of a box looks away from its middle');
    assert.ok(out.roof > 0.3, 'both slopes of a roof look up');
    assert.ok(out.lone > 0.99 && out.door > 0.99, 'a wall and a door look the way they were told, whichever way their corners ran');
    assert.deepEqual(out.origin, [10, 20, 0], 'the scene is the ground\'s own metres from its origin');
    assert.ok(Math.abs(out.east[0] - 0.5) < 1e-6 && Math.abs(out.east[1] - Math.cos(Math.PI / 6)) < 1e-6, 'u runs at the bearing, clockwise from north');
    assert.equal(out.top, 15);
    assert.deepEqual(out.red, [1, 0, 0]);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
