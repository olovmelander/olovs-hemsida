/* Adopt reviewed native image pixels without a fitted translation or card-length
 * adjustment. The immutable legacy frame is reached through inverse EPSG:3006;
 * source pixels and their affine remain in the review for later inspection. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sweref99TmToLatLon } from '../../packages/course-geo/chmv2/projection.mjs';
import { ORIGIN, M_PER_LAT, M_PER_LON, lonLatToXZ, centroid, polyArea, polyLen, pointInPoly } from '../lib.mjs';

const TEE_KEYS = ['tee-61', 'tee-57', 'tee-48', 'tee-41'];
const SHA256 = /^[a-f0-9]{64}$/;
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkedSource(review, sourceKey) {
  const source = review?.sources?.[sourceKey];
  const sourceIds = source?.sourceIds ?? source?.sources?.map(s => s.id);
  if (!source || source.horizontalCrs !== 'EPSG:3006' || !SHA256.test(source.sha256) ||
      !SHA256.test(source.requestSha256) || !sourceIds?.length ||
      !sourceIds.every(id => typeof id === 'string' && id.length > 0)) {
    throw new Error('Orthophoto trace needs a checked native EPSG:3006 source and SHA-256 hashes');
  }
  const { width, height, geoTransform: t } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) ||
      t[1] <= 0 || t[2] !== 0 || t[4] !== 0 || t[5] >= 0) {
    throw new Error('Orthophoto source requires its native north-up pixel-edge affine');
  }
  if (source.boundsEpsg3006 && (!Array.isArray(source.boundsEpsg3006) ||
      source.boundsEpsg3006.length !== 4 || !source.boundsEpsg3006.every((v, i) =>
        Number.isFinite(v) && Math.abs(v - [t[0], t[3] + height * t[5], t[0] + width * t[1], t[3]][i]) < 1e-6))) {
    throw new Error('Orthophoto pixel affine disagrees with its source bounds');
  }
  return { ...source, sourceIds };
}

/** Continuous image coordinates address pixel edges, as in the intake GeoTIFF.
 * A sample centre is [column + 0.5, row + 0.5]; tracing adds no half-pixel shift. */
export function orthophotoPointEpsg3006(review, sourceKey, pixel) {
  const source = checkedSource(review, sourceKey);
  if (!finitePair(pixel) || pixel[0] < 0 || pixel[0] > source.width || pixel[1] < 0 || pixel[1] > source.height) {
    throw new Error('Invalid orthophoto image coordinates');
  }
  const t = source.geoTransform;
  return [t[0] + pixel[0] * t[1], t[3] + pixel[1] * t[5]];
}

export function orthophotoPoint(review, sourceKey, pixel) {
  const [easting, northing] = orthophotoPointEpsg3006(review, sourceKey, pixel);
  const [latitude, longitude] = sweref99TmToLatLon(easting, northing);
  return lonLatToXZ(longitude, latitude);
}

function provenance(review, entry) {
  if (typeof entry?.id !== 'string' || !entry.id) throw new Error('Orthophoto feature needs a stable review id');
  const source = checkedSource(review, entry.sourceKey);
  return { prov: 'lm-orthophoto', reviewId: entry.id, sourceKey: entry.sourceKey,
    sourceIds: [...source.sourceIds], sourceSha256: source.sha256 };
}

function assertSimplePixelRing(points) {
  if (!points.every(finitePair)) throw new Error('Invalid orthophoto image coordinates');
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a, b, p) => Math.abs(cross(a, b, p)) < 1e-8 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (same(a, b)) throw new Error('Orthophoto polygon has repeated vertices');
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue;
      const c = points[j], d = points[j + 1];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
          on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) {
        throw new Error('Orthophoto polygon has self-intersections or overlapping edges');
      }
    }
  }
}

export function orthophotoRing(review, entry) {
  const trace = provenance(review, entry);
  const pixels = entry.ringPixels;
  if (!Array.isArray(pixels) || pixels.length < 4 || !same(pixels[0], pixels.at(-1))) {
    throw new Error('Orthophoto polygon must be a closed pixel ring');
  }
  assertSimplePixelRing(pixels);
  const ring = pixels.map(p => orthophotoPoint(review, entry.sourceKey, p));
  if (Math.abs(polyArea(ring)) < 0.01) throw new Error('Orthophoto polygon has no usable area');
  return { ring, ...trace };
}

/** Call during adoption while the imagery cache exists. Regeneration can then
 * use the committed, checked review without shipping restricted raw imagery. */
export function verifyOrthophotoSources(review, { sourceDirectory } = {}) {
  if (!sourceDirectory) throw new Error('Orthophoto source cache directory is required');
  const root = path.resolve(sourceDirectory);
  const checked = [];
  for (const [key] of Object.entries(review.sources ?? {})) {
    const source = checkedSource(review, key);
    const file = source.rasterFile ?? `${key}.tif`;
    if (path.basename(file) !== file || !/^[a-z0-9-]+\.tif$/.test(file)) throw new Error('Invalid cached orthophoto filename');
    const raster = path.join(root, file);
    const sidecar = JSON.parse(fs.readFileSync(raster.replace(/\.tif$/, '.json'), 'utf8'));
    for (const field of ['sha256', 'requestSha256', 'width', 'height', 'geoTransform']) {
      if (!same(source[field], sidecar[field])) throw new Error(`Orthophoto source ${key} changed ${field}`);
    }
    const ids = sidecar.sources?.map(s => s.id) ?? sidecar.sourceIds;
    if (!same(source.sourceIds, ids)) throw new Error(`Orthophoto source ${key} changed sourceIds`);
    for (const item of source.sources ?? []) {
      const actual = sidecar.sources?.find(s => s.id === item.id);
      if (!actual || item.capturedAt !== actual.capturedAt) throw new Error(`Orthophoto source ${key} changed capture timestamp`);
    }
    if (createHash('sha256').update(fs.readFileSync(raster)).digest('hex') !== source.sha256) {
      throw new Error(`Orthophoto source ${key} failed its image SHA-256 check`);
    }
    checked.push(key);
  }
  return checked;
}

function upsert(features, entry, value) {
  let index = features.findIndex(p => p.reviewId === entry.id);
  if (index < 0 && entry.replaceId !== undefined) {
    index = features.findIndex(p => p.id === entry.replaceId);
    if (index < 0) throw new Error('Reviewed feature replacement id is stale');
  }
  if (index < 0 && entry.replaceIndex !== undefined) {
    index = entry.replaceIndex;
    if (!Number.isInteger(index) || index < 0 || !features[index]) throw new Error('Reviewed feature replacement index is stale');
  }
  if (index < 0) features.push(value);
  else features[index] = { ...features[index], ...value };
}

export function applyReviewedOrthophoto(input, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'puttom' ||
      input?.origin?.lat !== ORIGIN.lat || input?.origin?.lon !== ORIGIN.lon ||
      input.mPerLat !== M_PER_LAT || Math.abs(input.mPerLon - M_PER_LON) > 0.01) {
    throw new Error('Orthophoto review requires the immutable Puttom legacy frame');
  }
  const model = structuredClone(input), ids = new Set(), reviewedHoles = new Set();
  const convert = entry => {
    if (ids.has(entry.id)) throw new Error('Duplicate orthophoto feature id');
    ids.add(entry.id);
    return orthophotoRing(review, entry);
  };
  for (const entry of review.holes ?? []) {
    const hole = model.holes.find(h => h.n === entry.n);
    if (!hole || reviewedHoles.has(entry.n)) throw new Error('Unknown or duplicate reviewed hole');
    reviewedHoles.add(entry.n);
    let routeChanged = false;
    if (entry.green) {
      const green = convert(entry.green);
      const reference = entry.green.referencePixels
        ? orthophotoPoint(review, entry.green.sourceKey, entry.green.referencePixels) : hole.green.c;
      if (!finitePair(reference) || !pointInPoly(...reference, green.ring)) throw new Error('Green reference leaves its reviewed putting surface');
      hole.green = { ...hole.green, ...green, c: [...reference], area: Math.round(Math.abs(polyArea(green.ring))) };
      hole.pin = [...reference];
      if (entry.green.updateRouteTarget !== false) { hole.line[hole.line.length - 1] = [...reference]; routeChanged = true; }
    }
    const reviewedMarks = new Set();
    for (const tee of entry.tees ?? []) {
      const pad = convert(tee), c = centroid(pad.ring);
      upsert(hole.tees.pads, tee, { ...pad, cx: c[0], cz: c[1] });
      const adoptedPad = hole.tees.pads.find(p => p.reviewId === tee.id);
      adoptedPad.id ??= tee.id;
      for (const [key, pixel] of Object.entries(tee.cameraReferencesPixels ?? {})) {
        const markIndex = TEE_KEYS.indexOf(key), mark = hole.tees.marks[markIndex];
        if (!mark || !tee.numberedSourceAssetId || reviewedMarks.has(key)) throw new Error('Tee camera requires unique numbered platform evidence');
        const reference = orthophotoPoint(review, tee.sourceKey, pixel);
        if (!pointInPoly(...reference, pad.ring)) throw new Error('Tee camera leaves its reviewed platform');
        reviewedMarks.add(key);
        mark.c = [...reference];
        Object.assign(mark, provenance(review, tee), { sourcePadId: adoptedPad.id,
          geometryBasis: 'reviewed-platform', platformBoundaryReviewed: true });
        mark.numberedSourceAssetId = tee.numberedSourceAssetId;
        delete mark.shore;
        if (markIndex === 0 && tee.updateRouteStart !== false) { hole.line[0] = [...reference]; routeChanged = true; }
      }
    }
    for (const camera of entry.cameraReferences ?? []) {
      const markIndex = TEE_KEYS.indexOf(camera.teeKey), mark = hole.tees.marks[markIndex];
      if (!mark || !camera.numberedSourceAssetId || reviewedMarks.has(camera.teeKey)) {
        throw new Error('Tee camera requires unique numbered platform evidence');
      }
      if (camera.geometryBasis !== 'visible-interior-anchor' ||
          typeof camera.reviewNotes !== 'string' || !camera.reviewNotes.trim()) {
        throw new Error('Standalone tee camera requires documented visible interior evidence');
      }
      if (camera.existingPadIndex !== undefined && (!Number.isInteger(camera.existingPadIndex) ||
          camera.existingPadIndex < 0 || !hole.tees.pads[camera.existingPadIndex])) {
        throw new Error('Standalone tee camera has a stale existing platform reference');
      }
      if (ids.has(camera.id)) throw new Error('Duplicate orthophoto feature id');
      const source = provenance(review, camera);
      const reference = orthophotoPoint(review, camera.sourceKey, camera.pointPixels);
      ids.add(camera.id);
      reviewedMarks.add(camera.teeKey);
      Object.assign(mark, source, { c: [...reference], numberedSourceAssetId: camera.numberedSourceAssetId,
        geometryBasis: camera.geometryBasis, platformBoundaryReviewed: false });
      delete mark.sourcePadId;
      delete mark.shore;
      if (markIndex === 0 && camera.updateRouteStart !== false) {
        hole.line[0] = [...reference]; routeChanged = true;
      }
    }
    for (const fairway of entry.fairways ?? []) {
      const surface = convert(fairway);
      const slots = hole.fairway.reviewedRings ??= {};
      let index = slots[fairway.id] ?? fairway.replaceIndex;
      if (index === undefined) { index = hole.fairway.rings.length; hole.fairway.rings.push(surface.ring); }
      else {
        if (!Number.isInteger(index) || index < 0 || !hole.fairway.rings[index]) throw new Error('Reviewed fairway replacement is stale');
        hole.fairway.rings[index] = surface.ring;
      }
      slots[fairway.id] = index;
      (hole.fairway.orthophotoSources ??= {})[fairway.id] = provenance(review, fairway);
    }
    if (entry.bunkers?.replaceAll === true) {
      checkedSource(review, entry.bunkers.sourceKey);
      if (!Array.isArray(entry.bunkers.accepted)) throw new Error('Bunker replacement requires accepted traces');
      hole.bunkers = entry.bunkers.accepted.map(convert);
      hole.bunkerReview = { sourceKey: entry.bunkers.sourceKey, sourceSha256: review.sources[entry.bunkers.sourceKey].sha256 };
    } else for (const bunker of entry.bunkers ?? []) upsert(hole.bunkers, bunker, convert(bunker));
    if (routeChanged) {
      hole.lineLen = Math.round(polyLen(hole.line) * 10) / 10;
      hole.lenDev = Math.round(Math.abs(hole.lineLen - hole.t[0]) / hole.t[0] * 10000) / 100;
      hole.lineSrc = 'lm-orthophoto-reviewed-endpoints';
      // Card-distance slides are historical, not the geometry's current source.
      delete hole.teeSlide;
      delete hole.teePadDist;
    }
    if (routeChanged || reviewedMarks.size) for (const mark of hole.tees.marks) {
      // A mark faces forward along the nearest part of the routing line.
      let nearest = Infinity, target = hole.line.at(-1);
      for (let i = 0; i < hole.line.length - 1; i++) {
        const a = hole.line[i], b = hole.line[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((mark.c[0] - a[0]) * dx + (mark.c[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        const distance = Math.hypot(mark.c[0] - a[0] - t * dx, mark.c[1] - a[1] - t * dz);
        if (distance < nearest) { nearest = distance; target = b; }
      }
      mark.b = Math.round(Math.atan2(target[0] - mark.c[0], mark.c[1] - target[1]) * 1800 / Math.PI) / 10;
    }
  }
  for (const water of review.water ?? []) {
    const surface = convert(water);
    if (water.replaceId === undefined && water.replaceIndex === undefined && !model.water.some(w => w.reviewId === water.id)) {
      throw new Error('Reviewed water must identify an existing feature to retain its measured level');
    }
    upsert(model.water, water, { ...surface, area: Math.round(Math.abs(polyArea(surface.ring))) });
  }
  for (const entry of review.paths ?? []) {
    if (ids.has(entry.id)) throw new Error('Duplicate orthophoto feature id');
    ids.add(entry.id);
    const trace = provenance(review, entry);
    if (!Array.isArray(entry.linePixels) || entry.linePixels.length < 2) throw new Error('Reviewed path requires a pixel polyline');
    const line = entry.linePixels.map(p => orthophotoPoint(review, entry.sourceKey, p));
    if (polyLen(line) < 0.01) throw new Error('Reviewed path has no usable length');
    upsert(model.infra.paths, entry, { id: entry.id, line, kind: 'path', ...trace });
  }
  // Remove reassigned legacy bunkers only AFTER indexed replacements in every
  // hole. Otherwise removing slot zero would silently retarget a later slot.
  for (const entry of review.holes ?? []) for (const removal of entry.removeBunkers ?? []) {
    if (ids.has(removal.id)) throw new Error('Duplicate orthophoto feature id');
    provenance(review, removal);
    ids.add(removal.id);
    if (!Array.isArray(removal.ringLegacy) || removal.ringLegacy.length < 3 || !removal.ringLegacy.every(finitePair)) {
      throw new Error('Bunker reassignment needs the original legacy ring');
    }
    const hole = model.holes.find(h => h.n === entry.n);
    const index = hole.bunkers.findIndex(b => same(b.ring, removal.ringLegacy));
    if (index >= 0) hole.bunkers.splice(index, 1);
    else if (!input.orthophotoReview?.featureIds?.includes(removal.id)) throw new Error('Bunker reassignment is stale');
  }
  model.orthophotoReview = { schemaVersion: 1, groundId: 'puttom', reviewedAt: review.reviewedAt ?? null,
    sources: structuredClone(review.sources), featureIds: [...ids] };
  return model;
}
