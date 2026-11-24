import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validateFacilityManifest, linearLuminance } from './validate-facility-glb.mjs';
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
