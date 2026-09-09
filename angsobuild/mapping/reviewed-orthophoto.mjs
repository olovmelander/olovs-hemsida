/* Adopt reviewed Lantmateriet pixel-edge traces in the frozen legacy frame.
 * Complete surface sets replace the historical OSM/satellite choices. The
 * scorecard is metadata: it never stretches the image geometry. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sweref99TmToLatLon } from '../../packages/course-geo/chmv2/projection.mjs';
import { ORIGIN, M_PER_LAT, M_PER_LON, centroid, polyArea, polyLen, pointInPoly } from '../lib.mjs';

const FRAME = 'local metres about ORIGIN; north -z, east +x';
// Match the stored model/pack scale, rather than its unrounded precursor.
const STORED_M_PER_LON = Math.round(M_PER_LON * 100) / 100;
const SHA256 = /^[a-f0-9]{64}$/;
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rounded = n => Math.round(n * 1000) / 1000;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const MAX_TEE_ASSOCIATION_DISTANCE_METRES = 10;

function distanceToRing(point, ring) {
  if (pointInPoly(...point, ring)) return 0;
  let closest = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const fraction = Math.max(0, Math.min(1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    closest = Math.min(closest, Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dz));
  }
  return closest;
}

function checkedSource(review, key) {
  const source = review?.sources?.[key];
  const sourceIds = source?.sourceIds ?? source?.sources?.map(s => s.id);
  if (!source || source.horizontalCrs !== 'EPSG:3006' || !SHA256.test(source.sha256) ||
      !SHA256.test(source.requestSha256) || !sourceIds?.length ||
      !sourceIds.every(id => typeof id === 'string' && id.length > 0) || new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Orthophoto trace needs a checked native EPSG:3006 source and SHA-256 hashes');
  }
  const { width, height, geoTransform: t } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite) ||
      t[1] <= 0 || t[2] !== 0 || t[4] !== 0 || t[5] >= 0) {
    throw new Error('Orthophoto source requires its native north-up pixel-edge affine');
  }
  const bounds = [t[0], t[3] + height * t[5], t[0] + width * t[1], t[3]];
  if (source.boundsEpsg3006 && (!Array.isArray(source.boundsEpsg3006) || source.boundsEpsg3006.length !== 4 ||
      !source.boundsEpsg3006.every((v, i) => Number.isFinite(v) && Math.abs(v - bounds[i]) < 1e-6))) {
    throw new Error('Orthophoto pixel affine disagrees with its source bounds');
  }
  return { ...source, sourceIds };
}

/** Continuous coordinates address pixel edges; a sample centre is c+.5,r+.5. */
export function orthophotoPointEpsg3006(review, key, pixel) {
  const source = checkedSource(review, key);
  if (!finitePair(pixel) || pixel[0] < 0 || pixel[0] > source.width || pixel[1] < 0 || pixel[1] > source.height) {
    throw new Error('Invalid orthophoto image coordinates');
  }
  const t = source.geoTransform;
  return [t[0] + pixel[0] * t[1], t[3] + pixel[1] * t[5]];
}

export function orthophotoPoint(review, key, pixel) {
  const [e, n] = orthophotoPointEpsg3006(review, key, pixel);
  const [lat, lon] = sweref99TmToLatLon(e, n);
  return [(lon - ORIGIN.lon) * STORED_M_PER_LON, -(lat - ORIGIN.lat) * M_PER_LAT];
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
  const vertices = points.slice(0, -1), count = vertices.length;
  if (new Set(vertices.map(p => p.join(','))).size !== count) throw new Error('Orthophoto polygon has repeated vertices');
  for (let i = 0; i < count; i++) {
    const a = vertices[i], b = vertices[(i + 1) % count], next = vertices[(i + 2) % count];
    if (on(a, b, next) || on(b, next, a)) throw new Error('Orthophoto polygon has overlapping edges');
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const c = vertices[j], d = vertices[(j + 1) % count];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
          on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) {
        throw new Error('Orthophoto polygon has self-intersections or overlapping edges');
      }
    }
  }
}

export function orthophotoRing(review, entry) {
  const trace = provenance(review, entry), pixels = entry.ringPixels;
  if (!Array.isArray(pixels) || pixels.length < 4 || !same(pixels[0], pixels.at(-1))) {
    throw new Error('Orthophoto polygon must be a closed pixel ring');
  }
  assertSimplePixelRing(pixels);
  const ring = pixels.map(p => orthophotoPoint(review, entry.sourceKey, p));
  if (Math.abs(polyArea(ring)) < 0.01) throw new Error('Orthophoto polygon has no usable area');
  return { ring, ...trace };
}

/** Verify actual cached bytes at adoption; committed reviews remain rebuildable. */
export function verifyOrthophotoSources(review, { sourceDirectory } = {}) {
  if (!sourceDirectory) throw new Error('Orthophoto source cache directory is required');
  const root = path.resolve(sourceDirectory), checked = [];
  for (const key of Object.keys(review.sources ?? {})) {
    const source = checkedSource(review, key), file = source.rasterFile ?? `${key}.tif`;
    if (path.basename(file) !== file || !/^[a-z0-9_-]+\.tif$/.test(file)) throw new Error('Invalid cached orthophoto filename');
    const raster = path.join(root, file);
    const sidecar = JSON.parse(fs.readFileSync(raster.replace(/\.tif$/, '.json'), 'utf8'));
    for (const field of ['sha256', 'requestSha256', 'width', 'height', 'geoTransform']) {
      if (!same(source[field], sidecar[field])) throw new Error(`Orthophoto source ${key} changed ${field}`);
    }
    if (!same(source.sourceIds, sidecar.sourceIds ?? sidecar.sources?.map(s => s.id))) {
      throw new Error(`Orthophoto source ${key} changed sourceIds`);
    }
    if (createHash('sha256').update(fs.readFileSync(raster)).digest('hex') !== source.sha256) {
      throw new Error(`Orthophoto source ${key} failed its image SHA-256 check`);
    }
    checked.push(key);
  }
  return checked;
}

function markBearing(mark, line) {
  let nearest = Infinity, target = line.at(-1);
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((mark.c[0] - a[0]) * dx + (mark.c[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(mark.c[0] - a[0] - t * dx, mark.c[1] - a[1] - t * dz);
    if (d < nearest) { nearest = d; target = b; }
  }
  return Math.round(Math.atan2(target[0] - mark.c[0], mark.c[1] - target[1]) * 1800 / Math.PI) / 10;
}

export function applyReviewedOrthophoto(input, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'angso' ||
      input?.origin?.lat !== ORIGIN.lat || input?.origin?.lon !== ORIGIN.lon ||
      input.mPerLat !== M_PER_LAT || input.mPerLon !== STORED_M_PER_LON || input.frame !== FRAME) {
    throw new Error('Orthophoto review requires the immutable Angso legacy frame');
  }
  for (const key of Object.keys(review.sources ?? {})) checkedSource(review, key);
  const model = structuredClone(input), ids = new Set(), reviewedHoles = new Set();
  const summary = { holes: 0, greens: 0, fairways: 0, teePads: 0, bunkers: 0, water: 0,
    provisionalTeeReferences: 0, unresolvedTeeReferences: 0 };
  const convert = entry => {
    if (ids.has(entry.id)) throw new Error('Duplicate orthophoto feature id');
    const converted = orthophotoRing(review, entry);
    ids.add(entry.id);
    return converted;
  };
  const completeSet = (entry, label) => {
    if (entry?.replaceAll !== true || !Array.isArray(entry.accepted)) throw new Error(`${label} review requires a complete accepted replacement set`);
    checkedSource(review, entry.sourceKey);
    return entry.accepted.map(feature => ({ ...feature, sourceKey: feature.sourceKey ?? entry.sourceKey }));
  };
  for (const entry of review.holes ?? []) {
    const hole = model.holes.find(h => h.n === entry.n);
    if (!hole || reviewedHoles.has(entry.n)) throw new Error('Unknown or duplicate reviewed hole');
    reviewedHoles.add(entry.n); summary.holes++;
    let routeChanged = false;
    if (entry.green) {
      const green = convert(entry.green);
      const c = entry.green.referencePixels ? orthophotoPoint(review, entry.green.sourceKey, entry.green.referencePixels) : centroid(green.ring);
      if (!finitePair(c) || !pointInPoly(...c, green.ring)) throw new Error('Green reference leaves its reviewed putting surface; supply an interior referencePixels');
      hole.green = { ...green, c, area: Math.round(Math.abs(polyArea(green.ring))) };
      hole.pin = [...c]; hole.line[hole.line.length - 1] = [...c];
      routeChanged = true; summary.greens++;
    }
    if (entry.fairways) {
      const surfaces = completeSet(entry.fairways, 'Fairway').map(convert);
      hole.fairway = { rings: surfaces.map(s => s.ring), prov: 'lm-orthophoto',
        orthophotoSources: surfaces.map(({ ring, ...source }) => source) };
      summary.fairways += surfaces.length;
    }
    if (entry.bunkers) {
      hole.bunkers = completeSet(entry.bunkers, 'Bunker').map(convert);
      hole.bunkerReview = { sourceKey: entry.bunkers.sourceKey, sourceSha256: review.sources[entry.bunkers.sourceKey].sha256 };
      summary.bunkers += hole.bunkers.length;
    }
    if (entry.tees) {
      const entries = completeSet(entry.tees, 'Tee');
      const pads = entries.map(tee => { const pad = convert(tee), c = centroid(pad.ring);
        return { ...pad, cx: c[0], cz: c[1], preserveTerrain: true }; });
      if (!pads.length) throw new Error('Reviewed tee set must contain at least one physical pad');
      const associated = new Map();
      entries.forEach((tee, padIndex) => {
        for (const [key, pixel] of Object.entries(tee.cameraReferencesPixels ?? {})) {
          const index = Number(key);
          if (!/^\d+$/.test(key) || !hole.tees.marks[index] || !tee.numberedSourceAssetId || associated.has(index)) {
            throw new Error('Tee reference requires unique numbered platform evidence and a valid mark index');
          }
          const c = orthophotoPoint(review, tee.sourceKey, pixel);
          if (!pointInPoly(...c, pads[padIndex].ring)) throw new Error('Tee reference leaves its reviewed platform');
          associated.set(index, { c, padIndex, numberedSourceAssetId: tee.numberedSourceAssetId });
        }
      });
      hole.tees.marks.forEach((mark, index) => {
        const original = mark.orthophotoReference?.originalPosition ?? mark.c;
        if (!finitePair(original)) throw new Error('Tee reference needs a finite original position');
        const explicit = associated.get(index);
        const containing = pads.map((p, i) => pointInPoly(...original, p.ring) ? i : -1).filter(i => i >= 0);
        const ranked = pads.map((p, i) => ({ index: i, distance: distance(original, [p.cx, p.cz]),
          edgeDistance: distanceToRing(original, p.ring) }))
          .sort((a, b) => a.edgeDistance - b.edgeDistance || a.distance - b.distance || a.index - b.index);
        // A distant forward reference can be a fairway tee without a separate
        // platform. The image does not justify moving it hundreds of metres to
        // another colour's pad. Retain it, and keep that association unresolved.
        const unresolved = !explicit && !containing.length && ranked[0].edgeDistance > MAX_TEE_ASSOCIATION_DISTANCE_METRES;
        const selected = unresolved ? null : explicit?.padIndex ?? containing[0] ?? ranked[0].index;
        const pad = selected === null ? null : pads[selected];
        const relocated = !explicit && !containing.length && !unresolved;
        const c = explicit?.c ?? (relocated ? [pad.cx, pad.cz] : [...original]);
        if (!unresolved && !pointInPoly(...c, pad.ring)) throw new Error('Tee pad centroid lies outside its surface; supply a reviewed camera reference');
        mark.c = [...c]; delete mark.shore;
        mark.orthophotoReference = {
          kind: explicit ? 'numbered-platform-reference' : unresolved ? 'unresolved-virtual-tee-reference'
            : relocated ? 'provisional-virtual-tee-reference' : 'legacy-reference-inside-reviewed-pad',
          originalPosition: [...original], selectedPadReviewId: pad?.reviewId ?? null,
          distanceMetres: rounded(distance(original, c)),
          nearestPadEdgeDistanceMetres: rounded(ranked[0].edgeDistance),
          maximumAssociationDistanceMetres: MAX_TEE_ASSOCIATION_DISTANCE_METRES,
          identityStatus: explicit ? 'source-associated' : unresolved ? 'unsupported-platform-association' : 'unverified-colour-association',
          positionStatus: unresolved ? 'retained-unverified-virtual-reference' : explicit ? 'source-associated' : relocated ? 'provisionally-relocated' : 'retained-inside-reviewed-pad',
          ambiguous: explicit ? false : unresolved || containing.length > 1 || (!containing.length && ranked.length > 1 && ranked[1].edgeDistance - ranked[0].edgeDistance < 5),
          candidates: ranked.map(item => ({ reviewId: pads[item.index].reviewId,
            distanceMetres: rounded(item.distance), edgeDistanceMetres: rounded(item.edgeDistance) })),
          ...(explicit ? { numberedSourceAssetId: explicit.numberedSourceAssetId } : {}),
        };
        if (relocated) summary.provisionalTeeReferences++;
        if (unresolved) summary.unresolvedTeeReferences++;
      });
      hole.tees.pads = pads; hole.tees.inferPads = false;
      hole.tees.status = 'orthophoto-platforms-colour-associations-unverified';
      hole.line[0] = [...hole.tees.marks[0].c]; routeChanged = true; summary.teePads += pads.length;
    }
    if (routeChanged) {
      hole.lineLen = Math.round(polyLen(hole.line) * 10) / 10;
      hole.lenDev = Math.round(Math.abs(polyLen(hole.line) - hole.t[0]) / hole.t[0] * 10000) / 100;
      hole.lineSrc = 'lm-orthophoto-reviewed-endpoints';
      delete hole.teeSlide; delete hole.teePadDist;
      for (const mark of hole.tees.marks) mark.b = markBearing(mark, hole.line);
    }
  }
  const waterIds = new Set();
  for (const entry of review.water ?? []) {
    if (typeof entry.replaceId !== 'string' || waterIds.has(entry.replaceId)) throw new Error('Reviewed water requires a unique existing replacement id');
    waterIds.add(entry.replaceId);
    const water = model.water.find(w => w.id === entry.replaceId);
    if (!water || !Number.isFinite(water.level)) throw new Error('Reviewed water replacement is stale or has no measured level');
    const surface = convert(entry);
    Object.assign(water, surface, { area: Math.round(Math.abs(polyArea(surface.ring))) });
    summary.water++;
  }
  if (ids.size || (review.holes ?? []).some(h => h.fairways || h.tees || h.bunkers)) {
    (model.infra ??= {}).preserveMappedBoundaries = true;
  }
  model.orthophotoReview = { schemaVersion: 1, groundId: 'angso', reviewedAt: review.reviewedAt ?? null,
    sources: structuredClone(review.sources), featureIds: [...ids], summary };
  return model;
}
