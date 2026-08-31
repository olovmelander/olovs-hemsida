import {
  AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS,
  prepareAuthoritativeSurfaceFeatures,
} from './authoritative-surface-source.mjs';
import { compileSurfacePreviewAssets } from './surface-compiler-node.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

function terrainFrontierBounds(tiles) {
  if (!Array.isArray(tiles) || !tiles.length) throw new TypeError('terrainTiles are required');
  const bounds = {
    minEasting: Math.min(...tiles.map(tile => tile?.bounds?.minEasting)),
    minNorthing: Math.min(...tiles.map(tile => tile?.bounds?.minNorthing)),
    maxEasting: Math.max(...tiles.map(tile => tile?.bounds?.maxEasting)),
    maxNorthing: Math.max(...tiles.map(tile => tile?.bounds?.maxNorthing)),
  };
  if (Object.values(bounds).some(value => !Number.isFinite(value)) ||
      bounds.minEasting >= bounds.maxEasting || bounds.minNorthing >= bounds.maxNorthing) {
    throw new Error('terrainTiles do not declare a finite surface frontier');
  }
  return Object.freeze(bounds);
}

/**
 * Compile already-reviewed canonical polygons into the ordinary surface chunk
 * format. This deliberately creates no preview descriptor and writes nothing:
 * publication belongs to the normal ground-manifest path after its independent
 * licence, visual and hardware gates pass.
 */
export function compileAuthoritativeSurfaceAssets({
  source,
  manifest,
  catalog,
  frame,
  terrainDescriptorSha256,
  terrainTiles,
  assetDirectory,
  codec = 'deflate-raw',
} = {}) {
  if (!SHA256.test(terrainDescriptorSha256 || '')) {
    throw new TypeError('terrainDescriptorSha256 must be a lowercase SHA-256');
  }
  const terrainBounds = terrainFrontierBounds(terrainTiles);
  const prepared = prepareAuthoritativeSurfaceFeatures(source, {
    frame,
    manifest,
    catalog,
    expectedGroundId: manifest?.groundId,
    terrainBounds,
  });
  const compilation = compileSurfacePreviewAssets({
    groundId: prepared.groundId,
    frame,
    /* Authoritative assets use the approved canonical frame directly. They may
       never inherit the provisional legacy-origin bridge used by the opt-in
       Puttom migration preview. */
    legacyBridge: { translateX: 0, translateZ: 0 },
    terrainTiles,
    holes: [],
    features: prepared.features,
    assetDirectory,
    codec,
    mowCoordinateMode: 'unmeasured-zero',
  });
  return Object.freeze({
    ...compilation,
    provenance: Object.freeze({
      kind: 'authoritative-surface-compilation-v1',
      sourceId: prepared.sourceId,
      sourceSha256: prepared.sourceSha256,
      terrainDescriptorSha256,
      frameFingerprint: frame.fingerprint,
      reviewedAt: prepared.reviewedAt,
      replaceMigration: true,
      unmeasuredFields: AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS,
      featureCount: prepared.features.length,
    }),
  });
}
