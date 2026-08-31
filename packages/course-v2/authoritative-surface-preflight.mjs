import {
  CANONICAL_CRS,
  validateSourceCatalog,
  validateSourceManifest,
} from '../course-geo/manifest.mjs';
import { validateAuthoritativeSurfaceSource } from './authoritative-surface-source.mjs';

export const AUTHORITATIVE_SURFACE_PREFLIGHT_KIND = 'banvy-authoritative-surface-preflight-v1';

const PROHIBITED_SOLE_AUTHORITY_PRODUCTS = new Set([
  'aws-terrarium',
  'club-course-guide',
  'esri-world-imagery',
  'golftraxx-layout',
  'openstreetmap',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrigin(value) {
  return object(value) && Number.isFinite(value.easting) &&
    Number.isFinite(value.northing) && Number.isFinite(value.heightRH2000);
}

function finiteTerrainBounds(value) {
  return object(value) && Number.isFinite(value.minEasting) &&
    Number.isFinite(value.minNorthing) && Number.isFinite(value.maxEasting) &&
    Number.isFinite(value.maxNorthing) &&
    value.minEasting < value.maxEasting && value.minNorthing < value.maxNorthing;
}

function canonicalFrameBinding(manifest, frame) {
  const expected = manifest?.canonicalFrame;
  const originMatches = finiteOrigin(expected?.origin) && finiteOrigin(frame?.origin) &&
    expected.origin.easting === frame.origin.easting &&
    expected.origin.northing === frame.origin.northing &&
    expected.origin.heightRH2000 === frame.origin.heightRH2000;
  const axes = expected?.axisMapping;
  const axesMatch = object(axes) && object(frame?.axisMapping) &&
    axes.worldX === frame.axisMapping.worldX && axes.worldY === frame.axisMapping.worldY &&
    axes.worldZ === frame.axisMapping.worldZ;
  return expected?.compoundCrs === CANONICAL_CRS.compound &&
    expected?.horizontalCrs === CANONICAL_CRS.horizontal &&
    expected?.verticalCrs === CANONICAL_CRS.vertical &&
    frame?.compoundCrs === CANONICAL_CRS.compound &&
    frame?.horizontalCrs === CANONICAL_CRS.horizontal &&
    frame?.verticalCrs === CANONICAL_CRS.vertical &&
    typeof frame?.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(frame.fingerprint) &&
    axesMatch && originMatches;
}

function sourceCandidate(source, products) {
  const product = products.get(source.productId);
  const reasons = [];
  if (!source.roles?.includes('surface')) reasons.push('does-not-cover-surfaces');
  if (source.lifecycle !== 'approved') reasons.push('lifecycle-not-approved');
  if (source.use !== 'authoritative') reasons.push('use-not-authoritative');
  if (!/^[a-f0-9]{64}$/.test(source.checksum || '')) reasons.push('checksum-missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.acquiredAt || '')) reasons.push('acquisition-date-missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.capturedAt || '')) reasons.push('capture-date-missing');
  if (!Number.isFinite(source.horizontalAccuracyMetres)) reasons.push('horizontal-accuracy-unmeasured');
  if (product?.licence?.reviewStatus !== 'approved') reasons.push('licence-not-approved');
  if (PROHIBITED_SOLE_AUTHORITY_PRODUCTS.has(source.productId)) reasons.push('prohibited-as-sole-authority');
  return Object.freeze({
    id: source.id,
    productId: source.productId,
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

function blocker(id, message) {
  return Object.freeze({ id, status: 'blocked', message });
}

/**
 * Evaluate the exact gates needed before a reviewed surface source can replace
 * a migration surface layer. It deliberately does not transform geometry or
 * attempt to make a provisional terrain frame authoritative.
 */
export function evaluateAuthoritativeSurfacePreflight({
  manifest,
  catalog,
  frame,
  terrainBounds,
  terrainProvisional = false,
  source = null,
} = {}) {
  const catalogErrors = validateSourceCatalog(catalog);
  const manifestErrors = catalogErrors.length
    ? ['manifest validation skipped because the source catalog is invalid']
    : validateSourceManifest(manifest, { catalog, label: 'manifest' });
  const products = new Map((catalog?.products || []).filter(object)
    .map(product => [product.id, product]));
  const candidates = Array.isArray(manifest?.sources)
    ? manifest.sources.filter(candidate => candidate?.roles?.includes('surface'))
      .map(candidate => sourceCandidate(candidate, products))
    : [];
  const originApproved = manifest?.canonicalFrame?.originStatus === 'approved' &&
    finiteOrigin(manifest?.canonicalFrame?.origin);
  const terrainFrameBound = originApproved && canonicalFrameBinding(manifest, frame);
  const terrainBoundsValid = finiteTerrainBounds(terrainBounds);
  const sourcePresent = source !== null && source !== undefined;
  const sourceErrors = !sourcePresent
    ? ['surface source has not been supplied']
    : validateAuthoritativeSurfaceSource(source, {
      manifest,
      catalog,
      expectedGroundId: manifest?.groundId ?? null,
      expectedFrameFingerprint: frame?.fingerprint ?? null,
      terrainBounds: terrainBoundsValid ? terrainBounds : null,
    });
  const sourceValid = sourcePresent && sourceErrors.length === 0;
  const blockers = [];
  if (catalogErrors.length) blockers.push(blocker('source-catalog', 'The source catalog is invalid.'));
  if (manifestErrors.length) blockers.push(blocker('source-manifest', 'The ground source manifest is invalid.'));
  if (!originApproved) {
    blockers.push(blocker('canonical-origin', 'Approve a finite EPSG:5845 origin from independent controls.'));
  }
  if (!terrainFrameBound) {
    blockers.push(blocker('terrain-frame', 'Bind the terrain frame exactly to the approved canonical origin.'));
  }
  if (!terrainBoundsValid) {
    blockers.push(blocker('terrain-frontier', 'Provide finite bounds for the compiled terrain frontier.'));
  }
  if (terrainProvisional) {
    blockers.push(blocker('terrain-provisional', 'A provisional terrain preview may not carry authoritative surfaces.'));
  }
  if (!candidates.some(candidate => candidate.eligible)) {
    blockers.push(blocker('surface-source', 'No approved authoritative surface source is available.'));
  }
  if (!sourceValid) {
    blockers.push(blocker('surface-review', 'Supply a source file that passes provenance, licence, geometry and review gates.'));
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: AUTHORITATIVE_SURFACE_PREFLIGHT_KIND,
    groundId: manifest?.groundId ?? null,
    ready: blockers.length === 0,
    originApproved,
    terrainFrameBound,
    terrainBoundsValid,
    terrainProvisional: terrainProvisional === true,
    candidates: Object.freeze(candidates),
    source: Object.freeze({ present: sourcePresent, valid: sourceValid, errors: Object.freeze(sourceErrors) }),
    blockers: Object.freeze(blockers),
  });
}
