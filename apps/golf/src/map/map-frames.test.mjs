/* The map's frame constants are a copy, so this is what keeps them honest, and
   the height check is what proves the copy puts a green on its own ground. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseChunkEnvelope } from '../../../../packages/course-v2/chunk.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS } from '../engine/v2-frontier-configs.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../engine/v2-puttom-preview.mjs';
import { greensAreGeneric } from './map-course.mjs';
import { createMapFrame, MAP_GROUND_FRAMES } from './map-frames.mjs';
import { buildTileTree } from './map-lod.mjs';
import { decodeTileHeights, sampleTile } from './map-height.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), 'utf8'));
const reviewed = [...Object.values(V2_GRAPH_FRONTIER_CONFIGS), { ...PUTTOM_PREVIEW_CONFIG, groundId: 'puttom', bridgeMode: 'wgs84-legacy-frame' }];

function packVectors(packUrl) {
  const bytes = fs.readFileSync(path.join(PUBLIC, packUrl));
  const headerBytes = bytes.readUInt32LE(4);
  const header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString('utf8'));
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString('utf8'));
}

function tileHeights(node) {
  const { encodedPayload, codec, header } = parseChunkEnvelope(fs.readFileSync(path.join(PUBLIC, node.layers.terrain.url)));
  const payload = codec === 'deflate-raw' ? zlib.inflateRawSync(encodedPayload) : encodedPayload;
  return decodeTileHeights(new Uint8Array(payload), header.grid).heights;
}

function groundSampler(nodes) {
  const cache = new Map();
  const l0 = [...nodes.values()].filter(node => node.lod === 0);
  return (x, z) => {
    const node = l0.find(n => x >= n.x0 && x < n.x0 + n.size && z >= n.z0 && z < n.z0 + n.size);
    if (!node) return NaN;
    if (!cache.has(node.id)) cache.set(node.id, tileHeights(node));
    return sampleTile(cache.get(node.id), (x - node.x0) / node.size, (z - node.z0) / node.size);
  };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('map ground frames', () => {
  it('are field for field what the reviewed configs declare', () => {
    expect(Object.keys(MAP_GROUND_FRAMES).sort()).toEqual([...new Set(reviewed.map(c => c.groundId))].sort());
    for (const config of reviewed) {
      const frame = MAP_GROUND_FRAMES[config.groundId];
      expect(frame.bridgeMode).toBe(config.bridgeMode);
      expect(frame.frameFingerprint).toBe(config.frameFingerprint);
      expect(frame.verticalDatumOffsetMetres).toBe(config.legacyFrame?.verticalDatumOffsetMetres ?? 0);
      expect(frame.legacyOriginEpsg3006.easting).toBe(config.legacyOriginEpsg3006.easting);
      expect(frame.legacyOriginEpsg3006.northing).toBe(config.legacyOriginEpsg3006.northing);
      if (config.bridgeMode === 'wgs84-legacy-frame') {
        for (const key of ['latitude', 'longitude', 'metresPerLatitude', 'metresPerLongitude']) {
          expect(frame.legacyFrame[key]).toBe(config.legacyFrame[key]);
        }
      } else expect(frame.legacyFrame).toBeNull();
    }
  });

  it('refuses a ground whose published frame is not the reviewed one', () => {
    expect(() => createMapFrame('visby', { fingerprint: 'x'.repeat(64), origin: { easting: 0, northing: 0 } })).toThrow(/koordinatram/);
    expect(() => createMapFrame('nowhere', {})).toThrow(/koordinatram/);
  });

  /* The independent proof asks the laser survey, not another copy of the
     numbers. A green is built nearly level, and the height survey knows nothing
     of the outlines. So a green carried through the frame must land on nearly
     level ground, and where a frame carries a rotation, dropping it must make
     that worse. The packs' own recorded green heights are no use here: some are
     coarse global data (Johannesberg's 7th-9th read 8-12 m off while their
     greens lie flat as placed, and 3 m rough without the rotation). */
  const index = readJson('courses/v2-index.json');
  const packs = readJson('courses/index.json').courses;
  for (const entry of index.courses) {
    it(`puts ${entry.slug}'s greens on level ground`, () => {
      const course = readJson(entry.manifest.url);
      const ground = readJson(course.groundManifest.url);
      const { nodes } = buildTileTree(ground);
      const frame = createMapFrame(entry.groundId, ground.frame);
      const heightAt = groundSampler(nodes);
      const vectors = packVectors(packs.find(p => p.slug === entry.slug).packUrl);
      const config = MAP_GROUND_FRAMES[entry.groundId];
      const shiftX = ground.frame.origin.easting - config.legacyOriginEpsg3006.easting;
      const shiftZ = config.legacyOriginEpsg3006.northing - ground.frame.origin.northing;
      const unrotated = (x, z) => [x - shiftX, z - shiftZ];
      const relief = (place, hole) => {
        const heights = hole.green.ring.map(([x, z]) => heightAt(...place(x, z)));
        expect(heights.every(Number.isFinite), `hole ${hole.n} is off the 1 m tiles`).toBe(true);
        return Math.max(...heights) - Math.min(...heights);
      };
      /* Generic greens have no edge of their own to test: their rings are one
         template (26 m on all nine of the korthålsbana's). This is the one layout
         allowed to be that, and the map marks its numbers as estimates; a second
         one fails here until it is looked at. */
      const generic = greensAreGeneric(vectors.holes.map(hole => hole.green.ring));
      expect(generic, 'only the korthålsbana has placeholder greens').toBe(entry.slug === 'veckefjarden-korthalsbanan');
      if (generic) return;
      const placed = median(vectors.holes.map(hole => relief(frame.toWorld, hole)));
      expect(placed, 'median height range under a green').toBeLessThan(1.3);
      if (config.legacyFrame) expect(placed).toBeLessThan(median(vectors.holes.map(hole => relief(unrotated, hole))));
    }, 60000);
  }
});
