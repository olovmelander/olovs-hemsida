import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { decodeHF } from './codec.js';
import {
  PUTTOM_PREVIEW_CONFIG,
  alignTerrainPreviewToLegacyFrame,
} from './v2-puttom-preview.mjs';

/* ------------------------------------------- the ground on both sides agrees

   The pilot used to drop 37-45 m at its frontier: `bridge.translateY` carried a
   tile to absolute RH 2000 and stopped, while the legacy pack's Terrarium
   heights sit on a datum nobody recorded. This measures the step that is left,
   and it measures it where the two products describe the same thing -- mown,
   open ground. In the WOODS they legitimately differ, because Terrarium carries
   canopy where the 1 m DTM is bare earth, and that residual is reported rather
   than gated. */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PUBLIC = `${REPO}apps/golf/public`;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function legacySampler() {
  const pack = readFileSync(`${PUBLIC}/courses/puttom/pack.bin`);
  const headerBytes = pack.readUInt32LE(4);
  const header = JSON.parse(pack.subarray(8, 8 + headerBytes).toString('utf8'));
  const stream = pack.subarray(8 + headerBytes, 8 + headerBytes + header.HF0.bytes);
  const spec = header.HF0;
  const heights = decodeHF(spec, await inflateRaw(stream));
  return (x, z) => {
    const fx = (x - spec.x0) / spec.dx, fz = (z - spec.z0) / spec.dx;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= spec.nx - 1 || j >= spec.nz - 1) return Number.NaN;
    const tx = fx - i, tz = fz - j, k = j * spec.nx + i;
    return (heights[k] * (1 - tx) + heights[k + 1] * tx) * (1 - tz)
      + (heights[k + spec.nx] * (1 - tx) + heights[k + spec.nx + 1] * tx) * tz;
  };
}

async function bridgedPreview() {
  const root = `${PUBLIC}/${PUTTOM_PREVIEW_CONFIG.descriptorPath}`.replace(/\/[^/]+$/, '');
  const descriptor = JSON.parse(readFileSync(`${PUBLIC}/${PUTTOM_PREVIEW_CONFIG.descriptorPath}`, 'utf8'));
  const resources = await Promise.all(descriptor.tiles.map(async tile => {
    const bytes = readFileSync(`${root}/${tile.reference.url}`);
    const decoded = await verifyChunkAsset(tile.reference, new Uint8Array(bytes));
    return createTerrainRenderResource({
      tileId: tile.id,
      frame: descriptor.frame,
      decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
    });
  }));
  return alignTerrainPreviewToLegacyFrame(
    { descriptor, resources },
    PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006,
    PUTTOM_PREVIEW_CONFIG.legacyFrame,
  );
}

function summarise(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[sorted.length >> 1];
  const deviation = sorted.map(value => Math.abs(value - median)).sort((l, r) => l - r);
  return {
    count: sorted.length,
    median,
    mad: deviation[deviation.length >> 1],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('the v2 pilot and the legacy pack stand at the same height', () => {
  it('agrees to a decimetre on the played ground, and says what is left in the woods', async () => {
    const aligned = await bridgedPreview();
    const legacyAt = await legacySampler();
    const model = JSON.parse(readFileSync(`${REPO}puttombuild/course-model.json`, 'utf8'));
    const mown = [];
    for (const hole of model.holes) {
      if (hole.green?.ring) mown.push(hole.green.ring);
      for (const ring of hole.fairway?.rings || []) mown.push(ring);
      for (const pad of hole.tees?.pads || []) if (pad.ring) mown.push(pad.ring);
    }

    const played = [], everywhere = [];
    for (let x = -460; x <= 460; x += 4) for (let z = -460; z <= 460; z += 4) {
      const preview = aligned.sample(x, z), legacy = legacyAt(x, z);
      if (!Number.isFinite(preview) || !Number.isFinite(legacy)) continue;
      everywhere.push(legacy - preview);
      if (mown.some(ring => insideRing(ring, x, z))) played.push(legacy - preview);
    }
    const open = summarise(played), all = summarise(everywhere);
    expect(open.count).toBeGreaterThan(4000);

    /* the gate: no datum step left where a player stands */
    expect(Math.abs(open.median)).toBeLessThan(0.10);
    expect(open.mad).toBeLessThan(0.40);
    /* and the whole overlap must not have drifted either */
    expect(Math.abs(all.median)).toBeLessThan(0.30);

    /* Reported, never gated: Terrarium carries canopy where the 1 m DTM is bare
       earth, so the upper tail is the woods and is a real difference between
       two products rather than a fault in the bridge. */
    expect(all.p95).toBeGreaterThan(2);
  }, 60_000);   /* 64 tiles to verify and decode, not 16 */

  it('states the offset as measured, and refuses a frame that cannot say', () => {
    const frame = PUTTOM_PREVIEW_CONFIG.legacyFrame;
    expect(frame.verticalDatumOffsetMetres).toBeCloseTo(23.6263, 4);
    /* A pack whose vertical datum IS known needs no offset, and omitting it
       must mean zero rather than NaN. */
    expect(() => alignTerrainPreviewToLegacyFrame(
      { descriptor: { frame: { origin: { easting: 1, northing: 2, heightRH2000: 3 } } }, resources: [{}] },
      { easting: 1, northing: 2 },
      { ...frame, verticalDatumOffsetMetres: Number.NaN },
    )).toThrow(/verticalDatumOffsetMetres must be finite/);
  });
});
