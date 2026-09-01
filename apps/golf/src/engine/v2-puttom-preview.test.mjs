import { describe, expect, it } from 'vitest';
import { compileTerrainAssets } from '../../../../packages/course-v2/terrain-compiler-node.mjs';
import { createTerrainPreviewDescriptor } from '../../../../packages/course-v2/terrain-preview-node.mjs';
import { createTerrainRenderResource, prepareTerrainRenderData } from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import {
  PUTTOM_PREVIEW_CONFIG,
  alignTerrainPreviewToLegacyFrame,
  assertPuttomSurfaceCoverage,
  createTerrainResourceSampler,
  decimateTerrainRenderResources,
  fallbackTerrainPreviewState,
  loadPuttomTerrainPreview,
  puttomPreviewRequested,
  verifiedSurfaceClassIds,
} from './v2-puttom-preview.mjs';
import {
  ellipsoidMetresPerDegree,
  transverseMercatorPointScale,
} from './geodetic-frame.mjs';

/* A frame that is metric-true and sits on the central meridian, so its bridge
   is a pure translation. The assertions below were written for that bridge and
   still measure exactly what they were written to measure; the real Puttom
   frame, which rotates, gets its own test at the end. */
const STRAIGHT_FRAME = (() => {
  const latitude = 63.2992, longitude = 15;
  const ellipsoid = ellipsoidMetresPerDegree(latitude);
  const k = transverseMercatorPointScale(latitude, longitude);
  return Object.freeze({
    latitude,
    longitude,
    metresPerLatitude: ellipsoid.perLatitude * k,
    metresPerLongitude: ellipsoid.perLongitude * k,
  });
})();

function fixture() {
  const size = 9;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = 71 + column * 0.25 + row * 0.5;
  }
  const compiled = compileTerrainAssets({
    groundId: 'bridge-test', courseSlugs: ['bridge-test'], heights,
    width: size, height: size, originEasting: 650000, originNorthing: 6640008,
    tileSegments: 4, codec: 'raw',
  });
  const descriptor = createTerrainPreviewDescriptor(compiled, { label: 'Bridge test' });
  const resources = descriptor.tiles.map(tile => {
    const decoded = verifyChunkAsset(tile.reference, compiled.resources.get(tile.reference.url));
    return createTerrainRenderResource({
      tileId: tile.id,
      decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
      frame: descriptor.frame,
    });
  });
  return { descriptor, resources };
}

describe('Puttom interactive terrain preview bridge', () => {
  it('only enables the explicit Puttom opt-in', () => {
    expect(puttomPreviewRequested('puttom', '?v2=1')).toBe(true);
    expect(puttomPreviewRequested('puttom', '?v2=0')).toBe(false);
    expect(puttomPreviewRequested('upsala', '?v2=1')).toBe(false);
  });

  it('keeps ordinary visits off the v2 network path and reports unsupported courses', async () => {
    const off = await loadPuttomTerrainPreview({ slug: 'puttom', search: '' });
    expect(off).toMatchObject({ requested: false, ready: false, status: 'off' });
    const other = await loadPuttomTerrainPreview({ slug: 'upsala', search: '?v2=1' });
    expect(other).toMatchObject({ requested: true, ready: false, status: 'fallback', reason: 'course-not-enabled' });
  });

  it('lets the selection boundary decide the request explicitly', async () => {
    const forcedOff = await loadPuttomTerrainPreview({ slug: 'puttom', search: '?v2=1', requested: false });
    expect(forcedOff).toMatchObject({ requested: false, status: 'off' });
    const forcedOn = await loadPuttomTerrainPreview({ slug: 'upsala', search: '?v2=require', requested: true });
    expect(forcedOn).toMatchObject({ requested: true, status: 'fallback', reason: 'course-not-enabled' });
    await expect(loadPuttomTerrainPreview({ slug: 'puttom', requested: 1 })).rejects.toThrow(/boolean/);
    const fallback = fallbackTerrainPreviewState({ slug: 'angso', reason: 'graph-renderer-not-activated' });
    expect(fallback).toMatchObject({ requested: true, ready: false, status: 'fallback', reason: 'graph-renderer-not-activated' });
    expect(Number.isNaN(fallback.heightAt(0, 0))).toBe(true);
    expect(() => fallbackTerrainPreviewState({ slug: 'angso' })).toThrow(/reason/);
  });

  it('uses the verified primary/secondary union for the required surface inventory', () => {
    const resources = [
      { tileId: 'a', inspection: { surfaceIds: [2, 4, 5] } },
      { tileId: 'b', inspection: { surfaceIds: [0, 2, 6] } },
    ];
    expect(verifiedSurfaceClassIds(resources)).toEqual([0, 2, 4, 5, 6]);
    const coverage = new Uint32Array(256);
    for (const id of [0, 2, 4, 5, 6]) coverage[id] = 1;
    expect(assertPuttomSurfaceCoverage(coverage)).toBe(coverage);
    /* A secondary neighbour can make the verified union contain rough without
       rough occupying a signed/current sample. That must remain diagnostic and
       cannot satisfy the fail-closed coverage gate. */
    coverage[0] = 0;
    expect(() => assertPuttomSurfaceCoverage(coverage)).toThrow(/missing rough/);
  });

  it('turns a missing preview into a non-throwing GPK1 fallback', async () => {
    const fallback = await loadPuttomTerrainPreview({
      slug: 'puttom',
      geo: { origin: { lat: 63.2992, lon: 18.9413 }, frame: 'local metres about ORIGIN; north -z, east +x' },
      search: '?v2=1',
      locationHref: 'https://banvy.test/',
      loaderOptions: { fetchImpl: async () => new Response('missing', { status: 404 }) },
    });
    expect(fallback).toMatchObject({ requested: true, ready: false, status: 'fallback', reason: 'load-failed' });
  });

  it('translates EPSG:5845 resources into legacy x/y/z without changing terrain height', () => {
    const loaded = fixture();
    const legacy = { easting: 650003, northing: 6640005 };
    const aligned = alignTerrainPreviewToLegacyFrame(loaded, legacy, STRAIGHT_FRAME);
    expect(aligned.resources).toHaveLength(4);
    expect(aligned.bridge.translateX).toBeCloseTo(1, 9);
    expect(aligned.bridge.translateZ).toBeCloseTo(1, 9);
    expect(aligned.sample(0, 0)).toBeCloseTo(73.25, 2);
    expect(aligned.sample(-3, -3)).toBeCloseTo(71, 2);
    expect(aligned.sample(5.01, 5)).toBeNaN();
  });

  it('samples shared tile boundaries continuously', () => {
    const aligned = alignTerrainPreviewToLegacyFrame(fixture(), {
      easting: 650000, northing: 6640008,
    }, STRAIGHT_FRAME);
    expect(aligned.sample(4, 4)).toBeCloseTo(74, 2);
    expect(aligned.sample(4 - 1e-7, 4)).toBeCloseTo(aligned.sample(4 + 1e-7, 4), 5);
    expect(createTerrainResourceSampler(aligned.resources).bounds).toEqual(aligned.bounds);
  });

  it('keeps 1 m CPU truth while producing a four-times-lighter 2 m render frontier', () => {
    const aligned = alignTerrainPreviewToLegacyFrame(fixture(), {
      easting: 650000, northing: 6640008,
    }, STRAIGHT_FRAME);
    const reduced = decimateTerrainRenderResources(aligned.resources, 2);
    expect(reduced).toHaveLength(4);
    expect(reduced[0]).toMatchObject({ width: 3, height: 3, sampleSpacingMetres: 2 });
    expect(reduced[0].textureData.byteLength).toBe(aligned.resources[0].textureData.byteLength * 9 / 25);
    const reducedSampler = createTerrainResourceSampler(reduced);
    expect(reducedSampler.bounds).toEqual(aligned.bounds);
    expect(reducedSampler.sample(4, 4)).toBeCloseTo(aligned.sample(4, 4), 2);
    expect(() => decimateTerrainRenderResources(aligned.resources, 3)).toThrow(/power-of-two/);
  });

  /* ------------------------------------------------- the real Puttom bridge
     Everything above uses a frame whose bridge is a pure translation, which is
     the wrong bridge for Puttom and was the shipped one until this. */

  it('turns the pilot onto true north, and says by how much', () => {
    const aligned = alignTerrainPreviewToLegacyFrame(fixture(), {
      easting: 650000, northing: 6640008,
    }, PUTTOM_PREVIEW_CONFIG.legacyFrame);
    expect(aligned.bridge.rotationRadians * 180 / Math.PI).toBeCloseTo(3.522145, 5);
    expect(aligned.bridge.scaleX).toBeCloseTo(0.99725207, 7);
    expect(aligned.bridge.scaleZ).toBeCloseTo(0.99860903, 7);
    /* the frame constants the bridge was derived for are the pack's own */
    expect(PUTTOM_PREVIEW_CONFIG.legacyFrame.metresPerLatitude).toBe(111320);
    expect(Math.round(PUTTOM_PREVIEW_CONFIG.legacyFrame.metresPerLongitude * 100) / 100).toBe(50019.58);
  });

  it('samples the ground a rotated query lands on, not the one below it', () => {
    const legacy = { easting: 650000, northing: 6640008 };
    const straight = alignTerrainPreviewToLegacyFrame(fixture(), legacy, STRAIGHT_FRAME);
    const rotated = alignTerrainPreviewToLegacyFrame(fixture(), legacy, PUTTOM_PREVIEW_CONFIG.legacyFrame);
    /* This test is about WHERE the sample is taken, and the Puttom frame also
       lifts the result onto the legacy vertical datum, so that term is taken
       back out rather than left to confound the comparison. */
    const datum = rotated.bridge.verticalDatumOffsetMetres;
    expect(datum).toBeGreaterThan(20);
    const level = (x, z) => rotated.sample(x, z) - datum;
    /* the origin is the rotation's fixed point, so only distance can differ */
    expect(level(0, 0)).toBeCloseTo(straight.sample(0, 0), 6);
    /* 4 m out, 3.52 degrees is a quarter of a metre -- on this ramp fixture
       that is a different height, which is the whole point */
    const [gx, gz] = rotated.bridge.toGrid(4, 4);
    expect(Math.hypot(gx - 4, gz - 4)).toBeGreaterThan(0.2);
    expect(level(4, 4)).toBeCloseTo(straight.sample(gx, gz), 6);
  });

  it('hands the legacy cutout an inscribed rectangle, never the grid one', () => {
    const aligned = alignTerrainPreviewToLegacyFrame(fixture(), {
      easting: 650000, northing: 6640008,
    }, PUTTOM_PREVIEW_CONFIG.legacyFrame);
    /* narrower on both axes -- the rotation overhang, given back to GPK1.
       Not `x0 > x0`: where the footprint does not straddle the origin the
       rotation carries the whole rectangle sideways, so only the extent is a
       reliable statement. */
    expect(aligned.legacyBounds.x1 - aligned.legacyBounds.x0)
      .toBeLessThan(aligned.bounds.x1 - aligned.bounds.x0);
    expect(aligned.legacyBounds.z1 - aligned.legacyBounds.z0)
      .toBeLessThan(aligned.bounds.z1 - aligned.bounds.z0);
    for (const [x, z] of [
      [aligned.legacyBounds.x0, aligned.legacyBounds.z0],
      [aligned.legacyBounds.x1, aligned.legacyBounds.z1],
      [aligned.legacyBounds.x0, aligned.legacyBounds.z1],
      [aligned.legacyBounds.x1, aligned.legacyBounds.z0],
    ]) expect(Number.isFinite(aligned.sample(x, z))).toBe(true);
  });

  it('refuses to bridge without a declared legacy frame', () => {
    expect(() => alignTerrainPreviewToLegacyFrame(fixture(), { easting: 1, northing: 2 }))
      .toThrow(/latitude must be finite/);
  });
});
