import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalJson, canonicalJsonBytes } from './canonical-json.mjs';
import { buildChunkEnvelope, parseChunkEnvelope } from './chunk.mjs';
import {
  assetReferenceForChunk,
  readChunk,
  sha256Bytes,
  verifyChunkAsset,
  writeChunk,
} from './chunk-node.mjs';
import { verifyAssetGraph } from './graph-node.mjs';
import {
  V2_COURSE_MEDIA_TYPE,
  V2_SUPPORTED_FEATURES,
  validateCourseManifest,
  validateGroundManifest,
  validateRootIndex,
} from './schema.mjs';
import { createSyntheticAssetGraph } from './synthetic-fixture.mjs';
import { decodeTerrainGrid, encodeTerrainGrid } from './terrain-grid.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const decoder = new TextDecoder();

function clone(value) {
  return structuredClone(value);
}

function firstChunk(graph, kind = null) {
  for (const [url, data] of graph.resources) {
    if (!url.endsWith('.bvch')) continue;
    const parsed = parseChunkEnvelope(data);
    if (!kind || parsed.header.kind === kind) return { url, data, parsed };
  }
  throw new Error(`fixture has no ${kind || ''} chunk`);
}

function replaceCourseManifest(graph, slug, mutate) {
  const root = clone(graph.root);
  const resources = new Map(graph.resources);
  const entry = root.courses.find(course => course.slug === slug);
  const prior = resources.get(entry.manifest.url);
  const document = JSON.parse(decoder.decode(prior));
  mutate(document);
  const data = Buffer.from(canonicalJsonBytes(document));
  const sha256 = sha256Bytes(data);
  const url = `courses/${slug}/course-v2-${sha256}.json`;
  resources.delete(entry.manifest.url);
  entry.manifest = { url, mediaType: V2_COURSE_MEDIA_TYPE, bytes: data.byteLength, sha256 };
  resources.set(url, data);
  return { root, resources };
}

test('canonical JSON is deterministic and rejects values JSON would silently alter', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: -0 } }), '{"a":{"x":0,"y":2},"z":1}');
  assert.equal(canonicalJson({ a: 1, z: 2 }), canonicalJson({ z: 2, a: 1 }));
  assert.throws(() => canonicalJson({ height: Number.NaN }), /finite JSON number/);
  assert.throws(() => canonicalJson([, 1]), /sparse array slot/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cycle/);
});

test('uint16 terrain quantization round-trips RH 2000 heights within five millimetres', () => {
  const source = [20.001, 20.114, Number.NaN, 21.999, 22.125, 22.999];
  const encoded = encodeTerrainGrid({ heights: source, width: 3, height: 2, heightScaleMetres: 0.01 });
  const decoded = decodeTerrainGrid(encoded.payload, {
    ...encoded.grid,
    sampleSpacingMetres: 1,
    geometricErrorMetres: 0.01,
  });
  source.forEach((height, index) => {
    if (Number.isNaN(height)) assert.ok(Number.isNaN(decoded[index]));
    else assert.ok(Math.abs(decoded[index] - height) <= 0.005001);
  });
  assert.equal(encoded.payload.byteLength, 12);
  assert.equal(encoded.maximumQuantizationErrorMetres, 0.005);
});

test('terrain quantization refuses range overflow and an all-nodata tile', () => {
  assert.throws(() => encodeTerrainGrid({ heights: [0, 700, 1, 2], width: 2, height: 2 }), /range/);
  assert.throws(() => encodeTerrainGrid({ heights: [NaN, NaN, NaN, NaN], width: 2, height: 2 }), /no finite/);
});

test('v2 chunk bytes and both encoded/decoded identities are deterministic', () => {
  const graphA = createSyntheticAssetGraph();
  const graphB = createSyntheticAssetGraph();
  const a = firstChunk(graphA, 'terrain');
  const b = graphB.resources.get(a.url);
  assert.deepEqual(a.data, b);
  const reference = assetReferenceForChunk(a.data, { kind: 'terrain', directory: 'assets/terrain' });
  assert.equal(reference.url, a.url);
  const decoded = verifyChunkAsset(reference, a.data);
  assert.equal(decoded.header.decodedSha256, sha256Bytes(decoded.payload));
  assert.equal(reference.sha256, sha256Bytes(a.data));
});

test('framing rejects bad magic, reserved flags, truncation and trailing bytes', () => {
  const { data } = firstChunk(createSyntheticAssetGraph());
  const badMagic = Buffer.from(data); badMagic[0] ^= 1;
  assert.throws(() => parseChunkEnvelope(badMagic), /magic/);
  const reserved = Buffer.from(data); reserved[7] = 1;
  assert.throws(() => parseChunkEnvelope(reserved), /reserved/);
  assert.throws(() => parseChunkEnvelope(data.subarray(0, data.length - 1)), /truncated/);
  assert.throws(() => parseChunkEnvelope(Buffer.concat([data, Buffer.from([0])])), /trailing/);
});

test('framing rejects a valid JSON header that is not canonical', () => {
  const { parsed } = firstChunk(createSyntheticAssetGraph());
  const canonical = canonicalJsonBytes(parsed.header);
  const padded = new Uint8Array(canonical.byteLength + 1);
  padded[0] = 0x20;
  padded.set(canonical, 1);
  const source = buildChunkEnvelope(parsed.header, parsed.encodedPayload, parsed.codec);
  const view = new DataView(source.buffer);
  const payloadLength = view.getUint32(12, true);
  const forged = new Uint8Array(16 + padded.byteLength + payloadLength);
  forged.set(source.subarray(0, 16), 0);
  const forgedView = new DataView(forged.buffer);
  forgedView.setUint32(8, padded.byteLength, true);
  forged.set(padded, 16);
  forged.set(parsed.encodedPayload, 16 + padded.byteLength);
  assert.throws(() => parseChunkEnvelope(forged), /not canonical/);
});

test('manifest checksum catches encoded corruption before chunk decode', () => {
  const graph = createSyntheticAssetGraph();
  const { data, parsed } = firstChunk(graph, 'terrain');
  const reference = assetReferenceForChunk(data, { kind: 'terrain', directory: 'assets/terrain' });
  const corrupt = Buffer.from(data);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => verifyChunkAsset(reference, corrupt), /integrity mismatch/);
  assert.equal(parsed.header.kind, 'terrain');
});

test('decoded checksum catches payload corruption even with a valid envelope', () => {
  const graph = createSyntheticAssetGraph();
  const { parsed } = firstChunk(graph, 'terrain');
  const raw = Buffer.from(readChunk(firstChunk(graph, 'terrain').data).payload);
  raw[0] ^= 1;
  const forged = buildChunkEnvelope(parsed.header, raw, 'raw');
  assert.throws(() => readChunk(forged), /decoded chunk integrity mismatch/);
});

test('configured decoded-byte budget is enforced before payload inflation', () => {
  const { data, parsed } = firstChunk(createSyntheticAssetGraph(), 'terrain');
  assert.ok(parsed.header.decodedBytes > 8);
  assert.throws(() => readChunk(data, { maxDecodedBytes: 8 }), /decoded-byte budget/);
});

test('synthetic graph proves two courses share one parent ground and seven typed chunks', () => {
  const result = verifyAssetGraph(createSyntheticAssetGraph());
  assert.equal(result.courses, 2);
  assert.equal(result.grounds, 1);
  assert.equal(result.chunks, 7);
  assert.equal(result.v1Fallbacks, 2);
  assert.equal(result.decodedChunkBytes, 1458);
  assert.ok(result.encodedChunkBytes < 16 * 1024);
});

test('graph fails closed on stale manifests, corrupt chunks and unreferenced resources', () => {
  const stale = createSyntheticAssetGraph();
  const entry = stale.root.courses[0];
  const changed = Buffer.from(stale.resources.get(entry.manifest.url));
  changed[changed.length - 2] = changed[changed.length - 2] === 0x7d ? 0x20 : 0x7d;
  stale.resources.set(entry.manifest.url, changed);
  assert.throws(() => verifyAssetGraph(stale), /SHA-256/);

  const corrupt = createSyntheticAssetGraph();
  const target = firstChunk(corrupt, 'terrain');
  const bytes = Buffer.from(target.data); bytes[bytes.length - 1] ^= 1;
  corrupt.resources.set(target.url, bytes);
  assert.throws(() => verifyAssetGraph(corrupt), /integrity mismatch/);

  const extra = createSyntheticAssetGraph();
  extra.resources.set('assets/unused.bin', Buffer.from([1]));
  assert.throws(() => verifyAssetGraph(extra), /unreferenced resources/);
});

test('graph rejects missing tile references and unsupported required features', () => {
  const missing = replaceCourseManifest(createSyntheticAssetGraph(), 'synthetic-short', course => {
    course.holes[0].tileIds = ['l9/missing/tile'];
  });
  assert.throws(() => verifyAssetGraph(missing), /references missing tile/);

  const future = replaceCourseManifest(createSyntheticAssetGraph(), 'synthetic-short', course => {
    course.requiredFeatures = [
      'chunk-envelope-v2', 'course-routing-json-v1', 'future-mesh-v9', 'terrain-grid-u16-v1',
    ];
  });
  assert.throws(() => verifyAssetGraph(future), /unsupported features: future-mesh-v9/);
  assert.deepEqual(V2_SUPPORTED_FEATURES, [
    'chunk-envelope-v2',
    'course-routing-json-v1',
    'object-registry-json-v1',
    'surface-grid-u8-i16-v1',
    'terrain-grid-u16-v1',
  ]);
});

test('strict validators reject path traversal, unknown fields and unverified claims', () => {
  const graph = createSyntheticAssetGraph();
  const root = clone(graph.root);
  root.courses[0].manifest.url = '../course.json';
  assert.ok(validateRootIndex(root).some(error => /relative URL|traversal|hash/.test(error)));

  const courseRef = graph.root.courses[0].manifest;
  const course = JSON.parse(decoder.decode(graph.resources.get(courseRef.url)));
  course.surprise = true;
  course.holes[0].strokeIndexStatus = 'verified';
  course.holes[0].strokeIndex = null;
  const courseErrors = validateCourseManifest(course);
  assert.ok(courseErrors.some(error => /surprise: unknown field/.test(error)));
  assert.ok(courseErrors.some(error => /strokeIndex.*required/.test(error)));

  const groundRef = course.groundManifest;
  const ground = JSON.parse(decoder.decode(graph.resources.get(groundRef.url)));
  delete ground.bounds.maxNorthing;
  assert.ok(validateGroundManifest(ground).some(error => /maxNorthing/.test(error)));
});

test('strict Draft 2020-12 schemas compile and validate every synthetic document', () => {
  const schemaDir = path.join(DIR, 'schemas');
  const files = readdirSync(schemaDir).filter(file => file.endsWith('.json')).sort();
  assert.deepEqual(files, [
    'authoritative-surface-source-v1.schema.json',
    'chunk-header-v2.schema.json',
    'common-v2.schema.json',
    'course-v2.schema.json',
    'ground-v2.schema.json',
    'object-registry-v1.schema.json',
    'root-v2.schema.json',
  ]);
  const schemas = new Map();
  for (const file of files) {
    const schema = JSON.parse(readFileSync(path.join(schemaDir, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof schema.$id, 'string');
    schemas.set(file, schema);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schema of schemas.values()) ajv.addSchema(schema);

  const graph = createSyntheticAssetGraph();
  const documents = {
    'authoritative-surface-source-v1.schema.json': [],
    'root-v2.schema.json': [graph.root],
    'ground-v2.schema.json': [],
    'course-v2.schema.json': [],
    'chunk-header-v2.schema.json': [],
    'object-registry-v1.schema.json': [],
  };
  for (const [url, data] of graph.resources) {
    if (url.includes('ground-v2-')) documents['ground-v2.schema.json'].push(JSON.parse(data));
    else if (url.includes('course-v2-')) documents['course-v2.schema.json'].push(JSON.parse(data));
    else if (url.endsWith('.bvch')) {
      const header = parseChunkEnvelope(data).header;
      documents['chunk-header-v2.schema.json'].push(header);
      if (header.kind === 'objects') {
        documents['object-registry-v1.schema.json'].push(readChunk(data).content);
      }
    }
  }
  for (const [schemaId, values] of Object.entries(documents)) {
    const validate = ajv.getSchema(schemaId);
    assert.equal(typeof validate, 'function');
    for (const value of values) {
      assert.equal(validate(value), true, ajv.errorsText(validate.errors));
    }
  }
});
