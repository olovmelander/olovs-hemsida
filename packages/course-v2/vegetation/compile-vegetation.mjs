/* The vegetation compiler, end to end: per-campaign canopy rasters in,
   reviewable candidates, stand fields and (for approved records) object
   chunks out. Library first, CLI at the bottom.

   Inputs are what Stages 1-3 of the plan produce offline: one
   height-above-ground raster per active campaign (the highest normalised
   return per 1 m cell, NaN where no return), the pinned campaign inventory,
   the committed EPSG:3006 course geometry, and the published ground manifest
   whose terrain tiles supply every base height. Nothing here reads a point
   or a credential.

   Records are compiled for candidates an approvals file names, for
   candidates that pass the versioned machine-review rules when a machine
   review is requested, or -- for an isolated harness only -- for every
   eligible individual under an explicitly labelled auto-approval. Dense
   forest is never turned into records: each finest tile also gets a
   measured stand field (canopy fraction and heights per 4 m cell, with the
   individuals' crowns and the semantic exclusions removed), published as its
   own chunk kind.                                                            */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetReferenceForChunk, readChunk, writeChunk } from '../chunk-node.mjs';
import { STAND_FIELD_FEATURE, STAND_FIELD_FORMAT, encodeStandField, inspectStandFieldPayload } from '../stand-field.mjs';
import {
  cellOf,
  createRaster,
  fillSingleCellVoids,
  medianFilter3x3,
  presenceMask,
  rasterSummary,
  voidMask,
} from './canopy-fields.mjs';
import { CROWN_PARAMETERS, crownConfidence, deriveCrownCandidates } from './crown-detect.mjs';
import { courseExclusionFeatures, rasterizeExclusions } from './semantic-exclusions.mjs';
import { mergeTileStandFields, standField, standFieldSummary, tileStandField } from './stand-fields.mjs';
import { assignStableIds, parseTreeId, registryDiff } from './registry-identity.mjs';
import { compileObjectChunks, objectCompilationSummary, treeRecord } from './object-compiler.mjs';
import { createGroundHeightLookup, createGroundSampler } from './ground-sampler.mjs';
import { GROUND_RINGS } from '../ground-rings-registry.mjs';

export const VEGETATION_COMPILER_VERSION = 2;

/**
 * A ground carrying several courses (veckefjarden + its korthålsbana) has
 * several migration models, and the compiler must see them ALL: exclusions
 * from one course's greens and tees alone would let the machine review plant
 * trees on the other's putting surfaces, and its hole lines would be missing
 * from the provisional truth zones. Everything courseExclusionFeatures and
 * provisionalZone read is unioned; duplicated shared features (one ground's
 * water in both models) simply rasterise twice into the same mask.
 */
export function mergeCourseGeometries(geometries) {
  if (!Array.isArray(geometries) || !geometries.length) throw new TypeError('at least one course geometry is required');
  if (geometries.length === 1) return geometries[0];
  const list = key => geometries.flatMap(entry => entry[key] || []);
  const scenery = key => geometries.flatMap(entry => entry.scenery?.[key] || []);
  const infra = key => geometries.flatMap(entry => entry.infra?.[key] || []);
  /* the range is a list of rings in the migrated model and a single ring in
     older ones; the merge normalises every contribution to a list of rings */
  const range = geometries.flatMap(entry => {
    const value = entry.scenery?.range;
    if (!Array.isArray(value) || !value.length) return [];
    return Array.isArray(value[0]?.[0]) ? value : [value];
  });
  return {
    holes: list('holes'),
    water: list('water'),
    streams: list('streams'),
    scenery: { greens: scenery('greens'), fairways: scenery('fairways'), tees: scenery('tees'), range },
    infra: {
      buildings: infra('buildings'),
      roads: infra('roads'),
      paths: infra('paths'),
      tracks: infra('tracks'),
      railway: infra('railway'),
      power: { lines: geometries.flatMap(entry => entry.infra?.power?.lines || []) },
      landuse: infra('landuse'),
    },
  };
}

/** Every migration model of a ground, merged: the registry's courseModels
    where the ground declares them, else the single course-model file. */
export function loadGroundCourseGeometries(dataDir, groundId) {
  const courseModels = GROUND_RINGS[groundId]?.courseModels;
  const entries = courseModels
    ? Object.entries(courseModels).map(([slug, model]) => [slug, model.migration])
    : [[groundId, 'course-model.epsg3006.json']];
  return entries.map(([slug, file]) => Object.freeze({ slug,
    geometry: JSON.parse(fs.readFileSync(path.join(dataDir, 'migration', file), 'utf8')).geometry }));
}

export function loadGroundGeometry(dataDir, groundId) {
  return mergeCourseGeometries(loadGroundCourseGeometries(dataDir, groundId).map(course => course.geometry));
}
export const PROVISIONAL_ZONES = Object.freeze({ zoneAMetres: 90, zoneBMetres: 300 });
export const DEFAULT_MINIMUM_CONFIDENCE = 0.5;
export const STAND_CELL_METRES = 4;

/* The rules that stand in for the human review the plan asked for, by the
   owner's decision of 2026-09-02. They are versioned so a record can say
   which rules approved it, and every rejection carries the rule it failed. */
export const MACHINE_REVIEW_RULES = Object.freeze({
  version: 1,
  minimumConfidence: 0.6,
  minimumHeightMetres: 3,
  minimumRadiusMetres: 1,
  zoneA: Object.freeze({ minimumProminenceMetres: 3, minimumCompactness: 0.5 }),
  statement: 'machine review v1, no human review (owner decision 2026-09-02): an individual crown is approved when it is not excluded, its composite confidence is at least 0.6, it stands at least 3 m tall with a crown radius of at least 1 m, and in zone A its prominence is at least 3 m and its compactness at least 0.5; stand crowns are never records',
});

export function machineReviewDecision(candidate, rules = MACHINE_REVIEW_RULES) {
  const reasons = [];
  if (candidate.representation === 'excluded') reasons.push(`excluded:${candidate.exclusionReason}`);
  else if (candidate.representation !== 'individual') reasons.push('not-individual');
  if (candidate.confidence < rules.minimumConfidence) reasons.push('confidence');
  if (candidate.heightMetres < rules.minimumHeightMetres) reasons.push('height');
  if (candidate.radiusMetres < rules.minimumRadiusMetres) reasons.push('radius');
  if (candidate.truthZone === 'A') {
    if (candidate.prominenceMetres < rules.zoneA.minimumProminenceMetres) reasons.push('zone-a-prominence');
    if (candidate.compactness < rules.zoneA.minimumCompactness) reasons.push('zone-a-compactness');
  }
  return Object.freeze({ approved: reasons.length === 0, reasons: Object.freeze(reasons) });
}

const round = (value, decimals = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : null);

function distanceToPolyline(easting, northing, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((easting - x0) * dx + (northing - y0) * dy) / length2)) : 0;
    const d = Math.hypot(easting - (x0 + dx * t), northing - (y0 + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/** Provisional truth zone by distance to the nearest hole line; the plan approves exact zone-A geometry later. */
export function provisionalZone(easting, northing, holes, zones = PROVISIONAL_ZONES) {
  let best = Infinity;
  for (const hole of holes) {
    if (!Array.isArray(hole.line) || hole.line.length < 2) continue;
    const d = distanceToPolyline(easting, northing, hole.line);
    if (d < best) best = d;
  }
  const zone = best <= zones.zoneAMetres ? 'A' : best <= zones.zoneBMetres ? 'B' : 'C';
  return { zone, distanceToHoleLineMetres: round(best) };
}

function nearestTileEdge(easting, northing, tiles) {
  let best = Infinity;
  for (const tile of tiles) {
    if (tile.lod !== 0) continue;
    const { minEasting, maxEasting, minNorthing, maxNorthing } = tile.bounds;
    if (easting < minEasting || easting > maxEasting || northing < minNorthing || northing > maxNorthing) continue;
    best = Math.min(best, easting - minEasting, maxEasting - easting, northing - minNorthing, maxNorthing - northing);
  }
  return Number.isFinite(best) ? best : null;
}

function seamDistance(easting, northing, seams) {
  let best = Infinity;
  for (const seam of seams || []) {
    const d = seam.axis === 'northing' ? Math.abs(northing - seam.value) : Math.abs(easting - seam.value);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

function campaignIsNorth(item, seams) {
  for (const seam of seams || []) {
    if (seam.axis === 'northing' && item.projBbox[1] >= seam.value - 1e-6) return 1;
    if (seam.axis === 'easting' && item.projBbox[0] >= seam.value - 1e-6) return 1;
  }
  return 0;
}

/** Void every cell outside the campaign's own extent: a scan never speaks past its edge. */
export function clipRasterToExtent(raster, extent) {
  const values = new Float32Array(raster.values);
  let clipped = 0;
  for (let row = 0; row < raster.height; row++) {
    for (let column = 0; column < raster.width; column++) {
      const easting = raster.originEasting + (column + 0.5) * raster.sampleSpacingMetres;
      const northing = raster.originNorthing - (row + 0.5) * raster.sampleSpacingMetres;
      if (easting < extent[0] || easting >= extent[2] || northing < extent[1] || northing >= extent[3]) {
        const index = row * raster.width + column;
        if (!Number.isNaN(values[index])) clipped++;
        values[index] = Number.NaN;
      }
    }
  }
  return { raster: createRaster({ ...raster, values }), clipped };
}

export function candidateKey(campaignId, crown) {
  return `${campaignId}/${round(crown.centroid.easting, 1)}/${round(crown.centroid.northing, 1)}`;
}

function intersects(bounds, extent) {
  return bounds.minEasting < extent[2] && bounds.maxEasting > extent[0] &&
    bounds.minNorthing < extent[3] && bounds.maxNorthing > extent[1];
}

/**
 * Stand chunks for every finest tile with measured forest, merged across
 * campaigns cell by cell (newest first). Returns chunks and a tile -> reference map.
 */
export function compileStandChunks({ groundId, tiles, campaignFields, cellMetres = STAND_CELL_METRES, canopyThresholdMetres = 2 }) {
  const chunks = [];
  const layers = new Map();
  for (const tile of tiles) {
    if (tile.lod !== 0) continue;
    const bbox = [tile.bounds.minEasting, tile.bounds.minNorthing, tile.bounds.maxEasting, tile.bounds.maxNorthing];
    const fields = [];
    for (const campaign of campaignFields) {
      if (!intersects(tile.bounds, campaign.extent)) continue;
      fields.push(tileStandField({
        raster: campaign.raster,
        voids: campaign.voids,
        excludeMask: campaign.excludeMask,
        extentLabels: campaign.extentLabels,
        bbox,
        cellMetres,
        canopyThresholdMetres,
        north: campaign.north,
      }));
    }
    if (!fields.length) continue;
    const merged = mergeTileStandFields(fields);
    let measured = 0;
    for (const flag of merged.measured) measured += flag;
    if (!measured) continue;
    const { payload, standField: section } = encodeStandField({ ...merged, cellMetres });
    const header = {
      schemaVersion: 2,
      id: tile.id,
      kind: 'stands',
      owner: { type: 'ground', id: groundId },
      bounds: { ...tile.bounds },
      payloadFormat: STAND_FIELD_FORMAT,
      requiredFeatures: ['chunk-envelope-v2', STAND_FIELD_FEATURE],
      standField: section,
    };
    const chunk = writeChunk({ header, payload });
    const reference = assetReferenceForChunk(chunk, { kind: 'stands', directory: `grounds/${groundId}/stands` });
    const inspection = inspectStandFieldPayload(payload, header);
    chunks.push(Object.freeze({ tileId: tile.id, bytes: chunk, reference, inspection }));
    layers.set(tile.id, reference);
  }
  return Object.freeze({ chunks, layers });
}

/**
 * Compile one ground. `rasters` is [{ campaignId, raster }]; `campaigns` the
 * pinned inventory; `geometry` the EPSG:3006 model geometry; `ground` the
 * published ground manifest; `readAsset(url)` its chunk bytes.
 */
export async function compileVegetation({
  groundId,
  observedOn,
  campaigns,
  rasters,
  geometry,
  ground,
  readAsset,
  previousRecords = [],
  approvals = null,
  approveAllIndividuals = false,
  machineReview = null,
  minimumConfidence = DEFAULT_MINIMUM_CONFIDENCE,
  parameters = CROWN_PARAMETERS,
  zones = PROVISIONAL_ZONES,
  canopyThresholdMetres = 2,
  standCellMetres = STAND_CELL_METRES,
  /* exclusion features a ground carries beyond its migration model, in the
     rasteriser's own shape ({ kind, rings } / { kind, lines }): Tortuna's
     dated roof envelopes, facility footprints and 2026 clear-fells, which its
     stand compiler already applies and its object compile must apply too */
  extraExclusionFeatures = [],
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn || '')) throw new Error('observedOn must be YYYY-MM-DD');
  if (!Array.isArray(rasters) || !rasters.length) throw new Error('at least one campaign raster is required');
  if ([approvals, approveAllIndividuals, machineReview].filter(Boolean).length > 1) {
    throw new Error('approvals, approveAllIndividuals and machineReview are exclusive');
  }
  const activeIds = new Set(campaigns.activeItemIds || []);
  const items = new Map((campaigns.items || []).map(item => [item.id, item]));
  const sampler = await createGroundSampler(ground, readAsset);
  /* synchronous bulk lookup for the exclusion rasteriser: water exclusions
     test the DTM against each body's own measured surface, so a sea ring
     whose offshore closure crosses land cannot claim the land (see
     semantic-exclusions.mjs) */
  const groundLookup = await createGroundHeightLookup(ground, readAsset);
  if (campaigns.groundId && campaigns.groundId !== groundId) throw new Error('campaign inventory belongs to another ground');
  const holes = geometry.holes || [];
  const exclusionFeatures = [...courseExclusionFeatures(geometry), ...extraExclusionFeatures];
  const candidates = [];
  const campaignEvidence = [];
  const standFields = [];
  const campaignFields = [];

  const ordered = [...rasters].sort((left, right) => {
    const a = items.get(left.campaignId)?.captureEnd || '';
    const b = items.get(right.campaignId)?.captureEnd || '';
    return b.localeCompare(a) || left.campaignId.localeCompare(right.campaignId);
  });
  for (const { campaignId, raster } of ordered) {
    const item = items.get(campaignId);
    if (!item) throw new Error(`campaign ${campaignId} is not in the pinned inventory`);
    if (!activeIds.has(campaignId)) throw new Error(`campaign ${campaignId} is superseded and may not contribute canopy`);
    const { raster: clipped, clipped: clippedCells } = clipRasterToExtent(raster, item.projBbox);
    const voids = voidMask(clipped);
    const { raster: filled, filled: filledCells } = fillSingleCellVoids(clipped);
    const detection = medianFilter3x3(filled);
    const exclusions = rasterizeExclusions(filled, exclusionFeatures, { groundHeightAt: groundLookup.heightAt });
    const presence = presenceMask(filled, canopyThresholdMetres);
    /* Maxima are detected WITHOUT the exclusion mask and rejected afterwards
       with their reason, so every rejection is in the evidence; growth still
       respects the mask so no crown spills onto a green or a roof. */
    const derived = deriveCrownCandidates({ heights: filled, detection, voids, excludeMask: null, parameters, growthExcludeMask: exclusions.mask });
    const field = standField(filled, { voids, cellMetres: 8, canopyThresholdMetres });
    standFields.push({ campaignId, field, summary: standFieldSummary(field) });
    const captureAgeYears = item.captureEnd ? (Date.parse(observedOn) - Date.parse(item.captureEnd)) / (365.25 * 86400e3) : null;
    let excludedApexes = 0;
    const individualExtents = new Int32Array(derived.extentLabels.length).fill(-1);
    for (const crown of derived.crowns) {
      const { easting, northing } = crown.centroid;
      const zone = provisionalZone(easting, northing, holes, zones);
      const { confidence, terms } = crownConfidence(crown, {
        pulseDensityPerSquareMetre: null,
        seamDistanceMetres: seamDistance(easting, northing, campaigns.seams),
        tileEdgeDistanceMetres: nearestTileEdge(easting, northing, ground.tiles),
        captureAgeYears,
      });
      /* the apex decides: it is the measured point, the centroid is derived */
      const apexIndex = crown.apex.row * filled.width + crown.apex.column;
      const centroidCell = cellOf(filled, easting, northing);
      const centroidIndex = centroidCell.row * filled.width + centroidCell.column;
      const excludedAt = exclusions.mask[apexIndex] ? apexIndex : exclusions.mask[centroidIndex] ? centroidIndex : -1;
      const exclusionReason = excludedAt >= 0 ? exclusions.legend[exclusions.reason[excludedAt]] : null;
      if (exclusionReason) excludedApexes++;
      const representation = exclusionReason ? 'excluded' : crown.representation;
      candidates.push({
        key: candidateKey(campaignId, crown),
        campaignId,
        capturedAt: item.captureEnd ? item.captureEnd.slice(0, 10) : item.capturedAt?.slice(0, 10) || null,
        crownId: crown.id,
        representation,
        exclusionReason,
        standReasons: [...crown.standReasons],
        truthZone: zone.zone,
        distanceToHoleLineMetres: zone.distanceToHoleLineMetres,
        confidence,
        confidenceTerms: terms,
        apex: crown.apex,
        centroid: crown.centroid,
        heightMetres: crown.heightMetres,
        radiusMetres: crown.radiusMetres,
        coreRadiusMetres: crown.coreRadiusMetres,
        compactness: crown.compactness,
        prominenceMetres: crown.prominenceMetres,
        touchesVoid: crown.touchesVoid,
        touchesRasterEdge: crown.touchesRasterEdge,
      });
    }
    /* only individuals that will be records leave the stand field; that is
       decided below, so the extent labels are resolved after eligibility */
    campaignFields.push({
      campaignId,
      extent: item.projBbox,
      raster: filled,
      voids,
      excludeMask: exclusions.mask,
      extentLabels: derived.extentLabels,
      individualExtents,
      north: campaignIsNorth(item, campaigns.seams),
      crownsById: new Map(derived.crowns.map(crown => [crown.id, crown])),
    });
    campaignEvidence.push({
      campaignId,
      captureStart: item.captureStart,
      captureEnd: item.captureEnd,
      role: item.role,
      north: campaignIsNorth(item, campaigns.seams) === 1,
      raster: { width: raster.width, height: raster.height, sampleSpacingMetres: raster.sampleSpacingMetres, originEasting: raster.originEasting, originNorthing: raster.originNorthing },
      clippedToExtentCells: clippedCells,
      filledSingleCellVoids: filledCells,
      summary: rasterSummary(filled, { canopyThresholdMetres }),
      canopyCells: presence.reduce((sum, value) => sum + value, 0),
      exclusions: { excludedCells: exclusions.excludedCells, excludedFraction: exclusions.excludedFraction, cellsByKind: exclusions.cellsByKind },
      maxima: derived.maxima.length,
      crowns: derived.crowns.length,
      individuals: derived.crowns.filter(crown => crown.representation === 'individual').length,
      excludedCandidates: excludedApexes,
      stand: standFieldSummary(field),
    });
  }
  candidates.sort((left, right) => left.key.localeCompare(right.key));

  /* which candidates become records */
  const approvedKeys = approvals ? new Set(approvals.map(entry => (typeof entry === 'string' ? entry : entry.key))) : null;
  /* an approvals entry may carry promote:true -- a maximum the detector
     handed to the stand representation (crowns touching, not prominent in a
     leaf-off scan) that an INDEPENDENT record, a dated orthophoto, shows as a
     distinct crown standing clear; the two records never entered each other.
     A promoted record keeps the laser's own height and radius. */
  const promotedKeys = approvals ? new Set(approvals.filter(entry => entry && typeof entry === 'object' && entry.promote).map(entry => entry.key)) : null;
  const reviewRejections = {};
  const eligible = candidates.filter(candidate => {
    if (machineReview) {
      const decision = machineReviewDecision(candidate, machineReview);
      for (const reason of decision.reasons) reviewRejections[reason] = (reviewRejections[reason] || 0) + 1;
      return decision.approved;
    }
    if (candidate.representation === 'excluded') return false;
    /* a record needs a crown: a stand maximum whose cells all went to its
       neighbour has no radius and cannot be promoted, whatever the imagery says */
    if (promotedKeys?.has(candidate.key) && candidate.representation === 'stand') return candidate.radiusMetres >= 1;
    return candidate.representation === 'individual' &&
      candidate.confidence >= minimumConfidence &&
      (approveAllIndividuals || approvedKeys?.has(candidate.key));
  });
  const baseHeightMisses = [];
  const drafts = [];
  for (const candidate of eligible) {
    /* a stand crown promoted on an independent record may have no extent of
       its own (its cells went to a neighbour), so no centroid: the apex is the
       measured point and stands in for it */
    const at = Number.isFinite(candidate.centroid?.easting) ? candidate.centroid : { easting: candidate.apex.easting, northing: candidate.apex.northing };
    const base = await sampler.sample(at.easting, at.northing);
    if (!base || base.nodata) { baseHeightMisses.push(candidate.key); continue; }
    drafts.push({
      candidate,
      easting: at.easting,
      northing: at.northing,
      objectHeightMetres: candidate.heightMetres,
      base,
    });
  }
  /* the stand field leaves out exactly the crowns that became records */
  for (const draft of drafts) {
    const campaign = campaignFields.find(entry => entry.campaignId === draft.candidate.campaignId);
    if (!campaign) continue;
    const id = draft.candidate.crownId;
    for (let i = 0; i < campaign.extentLabels.length; i++) if (campaign.extentLabels[i] === id) campaign.individualExtents[i] = id;
  }
  const identity = assignStableIds({ groundId, previous: previousRecords, candidates: drafts });
  const records = identity.records.map(draft => treeRecord({
    id: draft.id,
    groundId,
    candidate: draft.candidate,
    easting: draft.easting,
    northing: draft.northing,
    baseHeightRH2000: draft.base.heightRH2000,
    sourceId: `laser-lm-skog-${draft.candidate.campaignId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    capturedAt: draft.candidate.capturedAt,
    truthZone: draft.candidate.truthZone,
    confidence: draft.candidate.confidence,
    accuracyTier: 'C',
  }));
  const compiled = records.length ? compileObjectChunks({ groundId, tiles: ground.tiles, records }) : { chunks: [], layers: new Map(), recordCount: 0 };
  const stands = compileStandChunks({
    groundId,
    tiles: ground.tiles,
    campaignFields: campaignFields.map(campaign => ({ ...campaign, extentLabels: campaign.individualExtents })),
    cellMetres: standCellMetres,
    canopyThresholdMetres,
  });
  const diff = registryDiff(previousRecords, records);
  const standTotals = stands.chunks.reduce((sum, chunk) => ({
    tiles: sum.tiles + 1,
    encodedBytes: sum.encodedBytes + chunk.bytes.byteLength,
    measuredCells: sum.measuredCells + chunk.inspection.measuredCells,
    closedCanopyCells: sum.closedCanopyCells + chunk.inspection.closedCanopyCells,
    excludedCells: sum.excludedCells + chunk.inspection.excludedCells,
  }), { tiles: 0, encodedBytes: 0, measuredCells: 0, closedCanopyCells: 0, excludedCells: 0 });
  const evidence = {
    schemaVersion: VEGETATION_COMPILER_VERSION,
    groundId,
    observedOn,
    frameFingerprint: sampler.frameFingerprint,
    attribution: campaigns.terms?.attribution || null,
    parameters,
    zones: { ...zones, note: 'provisional: distance to the nearest hole line until zone-A geometry is approved' },
    minimumConfidence,
    review: approveAllIndividuals
      ? 'HARNESS AUTO-APPROVAL: every eligible individual was approved without review; not for publication'
      : machineReview ? machineReview.statement
        : approvals ? `approvals file with ${approvedKeys.size} keys` : 'no approvals: no records compiled',
    machineReview: machineReview ? { rules: machineReview, approved: eligible.length, rejectedByRule: reviewRejections } : null,
    campaigns: campaignEvidence,
    candidates: {
      total: candidates.length,
      byRepresentation: countBy(candidates, candidate => candidate.representation),
      byZone: countBy(candidates, candidate => candidate.truthZone),
      byCampaign: countBy(candidates, candidate => candidate.campaignId),
      eligible: eligible.length,
    },
    records: { ...objectCompilationSummary(compiled), baseHeightMisses },
    stands: { cellMetres: standCellMetres, ...standTotals },
    identity: { matched: identity.matched.length, moved: identity.moved.length, added: identity.added.length, missing: identity.missing.length, nextSequence: identity.nextSequence },
    diff: { added: diff.added.length, removed: diff.removed.length, kept: diff.kept.length, moved: diff.moved.length, changed: diff.changed.length },
  };
  return Object.freeze({ candidates, standFields, records, compiled, stands, identity, diff, evidence });
}

function countBy(list, key) {
  const out = {};
  for (const item of list) { const k = key(item); out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}


/* ---------------------------------------------------------------------------
   The reviewed-candidates import path. compileVegetation re-detects crowns
   from a 1 m raster and machine-reviews them; a ground that has been through
   a reviewed tree-placement pass (docs/tree-placement-workflow.md) instead
   hands in its decided candidate table: every row a tree with its stable id,
   decision, position, height, crown radius, measured type and confidence, and
   play zone. Rows decided retain / adjust / add become records; the rest
   (hold, merge, remove, not-placed) do not. Inside the reviewed scope the
   stand field is rebuilt from the RESIDUAL canopy only -- canopy at least
   `canopyThresholdMetres` tall that no detected crown claims -- so a closed
   wood the detector merged is topped up without doubling the trees it placed.
   Tiles outside the scope keep their published object and stand chunks byte
   for byte. Nothing is re-detected here. */

export const REVIEWED_IMPORT_VERSION = 1;
export const REVIEWED_PLACED_DECISIONS = Object.freeze(['retain', 'adjust', 'add']);
/* record confidence by source: the round-2 detector's held-out precision
   (0.95) rounded down for laser crowns; a sparse leaf-off recovery has no
   crown structure and the photo only confirms it */
export const REVIEWED_CONFIDENCE = Object.freeze({ detector: 0.9, 'sparse-laser-recovery': 0.6 });

/** A minimal RFC 4180 reader for the committed candidate table. */
export function parseCandidateCsv(text) {
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  const number = value => (value === '' ? null : Number(value));
  return body.map(cells => {
    const raw = Object.fromEntries(header.map((name, k) => [name, cells[k] ?? '']));
    return {
      ...raw,
      easting: number(raw.easting), northing: number(raw.northing),
      objectHeightMetres: number(raw.objectHeightMetres), radiusMetres: number(raw.radiusMetres),
      typeConfidence: number(raw.typeConfidence),
    };
  });
}

function sourceIdFor(campaigns, easting, northing) {
  const owner = (campaigns.items || []).find(item => item.role === 'active' &&
    easting >= item.projBbox[0] && easting < item.projBbox[2] && northing >= item.projBbox[1] && northing < item.projBbox[3]);
  if (!owner) throw new Error(`no active laser item owns ${easting}, ${northing}`);
  return { sourceId: `laser-lm-skog-${owner.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, capturedAt: (owner.captureEnd || owner.capturedAt).slice(0, 10) };
}

/**
 * `rows` from parseCandidateCsv; `scope` [minE, minN, maxE, maxN] on finest
 * tile edges; `residual` { raster (createRaster, the canopy model the review
 * used), labels (Int32Array, >= 0 where a detected or recovered crown claims
 * the cell) }.
 */
export async function compileReviewedVegetation({
  groundId, observedOn, campaigns, rows, scope, residual, geometry, ground, readAsset,
  review, zones = PROVISIONAL_ZONES, standCellMetres = STAND_CELL_METRES, canopyThresholdMetres = 3,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn || '')) throw new Error('observedOn must be YYYY-MM-DD');
  if (!review || /^HARNESS/.test(review)) throw new Error('a reviewed import needs its review statement');
  const [sx0, sy0, sx1, sy1] = scope;
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  const inScope = tile => tile.bounds.minEasting >= sx0 && tile.bounds.maxEasting <= sx1 && tile.bounds.minNorthing >= sy0 && tile.bounds.maxNorthing <= sy1;
  const outScope = tile => tile.bounds.maxEasting <= sx0 || tile.bounds.minEasting >= sx1 || tile.bounds.maxNorthing <= sy0 || tile.bounds.minNorthing >= sy1;
  for (const tile of finest) if (!inScope(tile) && !outScope(tile)) throw new Error(`tile ${tile.id} straddles the reviewed scope; align the scope to finest tile edges`);
  const scopeTiles = finest.filter(inScope);
  const sampler = await createGroundSampler(ground, readAsset);
  const groundLookup = await createGroundHeightLookup(ground, readAsset);
  /* the published records the scope replaces, and the ones it must not collide with */
  const retainedRecords = [];
  const replacedRecords = [];
  for (const tile of finest) {
    if (!tile.layers.objects) continue;
    const records = readChunk(await readAsset(tile.layers.objects.url)).content.records;
    (inScope(tile) ? replacedRecords : retainedRecords).push(...records);
  }
  const retainedIds = new Set(retainedRecords.map(record => record.id));
  const seen = new Set();
  const records = [];
  const baseHeightMisses = [];
  const counts = { rows: rows.length, placed: 0, byDecision: {}, byType: {}, byPlay: {} };
  for (const row of rows) {
    counts.byDecision[row.decision] = (counts.byDecision[row.decision] || 0) + 1;
    if (!REVIEWED_PLACED_DECISIONS.includes(row.decision)) continue;
    if (!parseTreeId(row.id) || parseTreeId(row.id).groundId !== groundId) throw new Error(`row ${row.id} is not a ${groundId} tree id`);
    if (seen.has(row.id) || retainedIds.has(row.id)) throw new Error(`tree id ${row.id} is used twice`);
    seen.add(row.id);
    if (!(row.easting >= sx0 && row.easting < sx1 && row.northing >= sy0 && row.northing < sy1)) throw new Error(`${row.id} lies outside the reviewed scope`);
    if (!['near', 'woodland'].includes(row.play)) throw new Error(`${row.id}: play must be near or woodland`);
    if (!['conifer', 'broadleaf', 'unknown'].includes(row.type)) throw new Error(`${row.id}: type must be conifer, broadleaf or unknown`);
    const base = await sampler.sample(row.easting, row.northing);
    if (!base || base.nodata) { baseHeightMisses.push(row.id); continue; }
    const zone = provisionalZone(row.easting, row.northing, geometry.holes || [], zones);
    const { sourceId, capturedAt } = sourceIdFor(campaigns, row.easting, row.northing);
    const confidence = REVIEWED_CONFIDENCE[row.source];
    if (!Number.isFinite(confidence)) throw new Error(`${row.id}: unknown source ${row.source}`);
    records.push(treeRecord({
      id: row.id, groundId,
      candidate: { heightMetres: row.objectHeightMetres, radiusMetres: row.radiusMetres },
      easting: row.easting, northing: row.northing,
      baseHeightRH2000: base.heightRH2000, sourceId, capturedAt, truthZone: zone.zone, confidence, accuracyTier: 'C',
      subtype: row.type === 'unknown' ? null : row.type,
      typeConfidence: Number.isFinite(row.typeConfidence) ? row.typeConfidence : null,
      play: row.play,
    }));
    counts.placed++;
    counts.byType[row.type] = (counts.byType[row.type] || 0) + 1;
    counts.byPlay[row.play] = (counts.byPlay[row.play] || 0) + 1;
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  const compiledNew = compileObjectChunks({ groundId, tiles: scopeTiles, records });
  /* the residual stand field over the scope */
  const raster = residual.raster;
  if (residual.labels.length !== raster.values.length) throw new Error('residual labels must match the residual raster');
  const voids = new Uint8Array(raster.values.length);
  for (let i = 0; i < voids.length; i++) voids[i] = Number.isNaN(raster.values[i]) ? 1 : 0;
  const exclusions = rasterizeExclusions(raster, courseExclusionFeatures(geometry), { groundHeightAt: groundLookup.heightAt });
  const residualStats = { canopyCells: 0, claimedCells: 0, excludedCells: 0, residualCells: 0, cellSquareMetres: raster.sampleSpacingMetres ** 2 };
  for (let row = 0; row < raster.height; row++) {
    const northing = raster.originNorthing - (row + 0.5) * raster.sampleSpacingMetres;
    if (northing < sy0 || northing >= sy1) continue;
    for (let column = 0; column < raster.width; column++) {
      const easting = raster.originEasting + (column + 0.5) * raster.sampleSpacingMetres;
      if (easting < sx0 || easting >= sx1) continue;
      const i = row * raster.width + column;
      if (!(raster.values[i] >= canopyThresholdMetres)) continue;
      residualStats.canopyCells++;
      if (residual.labels[i] >= 0) residualStats.claimedCells++;
      else if (exclusions.mask[i]) residualStats.excludedCells++;
      else residualStats.residualCells++;
    }
  }
  const standNew = compileStandChunks({
    groundId, tiles: scopeTiles, cellMetres: standCellMetres, canopyThresholdMetres,
    campaignFields: [{ extent: scope, raster, voids, excludeMask: exclusions.mask, extentLabels: residual.labels, north: 0 }],
  });
  /* everything outside the scope, kept as published */
  const retained = { objects: [], stands: [] };
  for (const tile of finest.filter(outScope)) {
    for (const kind of ['objects', 'stands']) {
      const reference = tile.layers[kind];
      if (!reference) continue;
      retained[kind].push(Object.freeze({ tileId: tile.id, bytes: await readAsset(reference.url), reference, records: kind === 'objects' ? null : undefined }));
    }
  }
  const compiled = { chunks: [...compiledNew.chunks, ...retained.objects], layers: new Map([...compiledNew.layers, ...retained.objects.map(c => [c.tileId, c.reference])]), recordCount: records.length + retainedRecords.length };
  const stands = { chunks: [...standNew.chunks, ...retained.stands], layers: new Map([...standNew.layers, ...retained.stands.map(c => [c.tileId, c.reference])]) };
  const replacedIds = new Set(replacedRecords.map(record => record.id));
  const keptIds = records.filter(record => replacedIds.has(record.id)).length;
  const square = residualStats.cellSquareMetres;
  const evidence = {
    schemaVersion: VEGETATION_COMPILER_VERSION,
    importVersion: REVIEWED_IMPORT_VERSION,
    groundId,
    observedOn,
    frameFingerprint: sampler.frameFingerprint,
    attribution: campaigns.terms?.attribution || null,
    review,
    mode: 'reviewed-candidates',
    scopeEpsg3006: scope,
    zones: { ...zones, note: 'truthZone: distance to the nearest hole line of either routing' },
    rows: counts,
    records: { inScope: records.length, retainedOutsideScope: retainedRecords.length, baseHeightMisses, replacedPublishedInScope: replacedRecords.length, publishedIdsKeptInScope: keptIds },
    residualCanopy: {
      thresholdMetres: canopyThresholdMetres,
      canopySquareMetres: Math.round(residualStats.canopyCells * square),
      claimedByCrownsSquareMetres: Math.round(residualStats.claimedCells * square),
      excludedSquareMetres: Math.round(residualStats.excludedCells * square),
      residualSquareMetres: Math.round(residualStats.residualCells * square),
      residualShareOfCanopy: residualStats.canopyCells ? Math.round((residualStats.residualCells / residualStats.canopyCells) * 1e4) / 1e4 : 0,
    },
    stands: { cellMetres: standCellMetres, scopeTiles: standNew.chunks.length, retainedTiles: retained.stands.length },
    objects: { scopeTiles: compiledNew.chunks.length, retainedTiles: retained.objects.length },
  };
  return Object.freeze({
    candidates: [], standFields: [], records, compiled, stands, evidence,
    identity: { matched: [], moved: [], added: [], missing: [], nextSequence: null },
    diff: registryDiff(replacedRecords, records),
  });
}

/** Raw little-endian Float32 raster with a JSON sidecar, the shape `gdal_translate -of ENVI -ot Float32` produces. */
export function readRawRaster(dataPath, sidecarPath) {
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const bytes = fs.readFileSync(dataPath);
  const count = sidecar.width * sidecar.height;
  if (bytes.byteLength !== count * 4) throw new Error(`${dataPath} has ${bytes.byteLength} bytes; sidecar declares ${count * 4}`);
  const values = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const noData = Number.isFinite(sidecar.noData) ? sidecar.noData : null;
  for (let i = 0; i < count; i++) {
    const value = view.getFloat32(i * 4, true);
    values[i] = noData !== null && value === noData ? Number.NaN : value;
  }
  return createRaster({
    width: sidecar.width,
    height: sidecar.height,
    sampleSpacingMetres: sidecar.sampleSpacingMetres,
    originEasting: sidecar.originEasting,
    originNorthing: sidecar.originNorthing,
    values,
  });
}

export function writeCompilation(outDir, result) {
  fs.mkdirSync(path.join(outDir, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'stands'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify(result.candidates, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(result.evidence, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'registry.json'), JSON.stringify(result.records, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'registry-diff.json'), JSON.stringify(result.diff, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'identity.json'), JSON.stringify({ matched: result.identity.matched, moved: result.identity.moved, added: result.identity.added, missing: result.identity.missing }, null, 2) + '\n');
  const layers = {};
  for (const chunk of result.compiled.chunks) {
    fs.writeFileSync(path.join(outDir, 'objects', `${chunk.reference.sha256}.bvch`), chunk.bytes);
    layers[chunk.tileId] = chunk.reference;
  }
  fs.writeFileSync(path.join(outDir, 'layers.json'), JSON.stringify(layers, null, 2) + '\n');
  const standLayers = {};
  for (const chunk of result.stands.chunks) {
    fs.writeFileSync(path.join(outDir, 'stands', `${chunk.reference.sha256}.bvch`), chunk.bytes);
    standLayers[chunk.tileId] = chunk.reference;
  }
  fs.writeFileSync(path.join(outDir, 'stand-layers.json'), JSON.stringify(standLayers, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'stand-fields.json'), JSON.stringify(result.standFields.map(entry => ({
    campaignId: entry.campaignId,
    summary: entry.summary,
    columns: entry.field.columns,
    rows: entry.field.rows,
    cellMetres: entry.field.cellMetres,
    originEasting: entry.field.originEasting,
    originNorthing: entry.field.originNorthing,
    canopyFraction: Array.from(entry.field.canopyFraction, value => round(value)),
    meanHeight: Array.from(entry.field.meanHeight, value => round(value)),
  })), null, 2) + '\n');
}

/** Resolve the ground manifest through the mutable root and its active course
    manifest. Content-addressed ground manifests from prior generations stay
    beside it for rollback, so choosing the first filename in the directory is
    never a valid way to select the live generation. */
export function readActivePublishedGround(publicDir, groundId) {
  const resolvedPublicDir = path.resolve(publicDir);
  const readPublishedJson = (url, label) => {
    const file = path.resolve(resolvedPublicDir, url);
    if (!file.startsWith(`${resolvedPublicDir}${path.sep}`)) {
      throw new Error(`${label} escapes the public directory: ${url}`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const graphRoot = readPublishedJson('courses/v2-index.json', 'published v2 root');
  const rootEntries = graphRoot.courses?.filter(course => course.groundId === groundId) || [];
  if (!rootEntries.length) throw new Error(`published v2 root has no ground ${groundId}`);
  const resolved = rootEntries.map(rootEntry => {
    const courseManifest = readPublishedJson(rootEntry.manifest?.url, `course ${rootEntry.slug}`);
    if (courseManifest.groundId !== groundId) {
      throw new Error(`published root course ${rootEntry.slug} resolves ground ${courseManifest.groundId}, not ${groundId}`);
    }
    const ground = readPublishedJson(courseManifest.groundManifest?.url, `ground ${groundId}`);
    if (ground.groundId !== groundId) {
      throw new Error(`published root course ${rootEntry.slug} resolves ground ${ground.groundId}, not ${groundId}`);
    }
    return { rootEntry, courseManifest, ground };
  });
  const liveGroundUrls = new Set(resolved.map(entry => entry.courseManifest.groundManifest.url));
  if (liveGroundUrls.size !== 1) {
    throw new Error(`published ground ${groundId} has conflicting active manifests`);
  }
  return { graphRoot, rootEntries, courseManifest: resolved[0].courseManifest, ground: resolved[0].ground };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
  const groundId = flag('ground');
  const outDir = flag('out');
  const observedOn = flag('observed-on', new Date().toISOString().slice(0, 10));
  const rasterArgs = args.flatMap((arg, i) => (arg === '--raster' ? [args[i + 1]] : []));
  if (groundId && outDir && flag('reviewed')) {
    /* the reviewed import: --reviewed <candidates.csv> --scope minE,minN,maxE,maxN
       --residual-chm <float32.bin> --residual-labels <int32.bin> (each with a .json
       sidecar beside it) --review "<statement>" [--campaigns <inventory>] */
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const dataDir = path.join(root, 'geo_data/course-v2', groundId);
    const campaigns = JSON.parse(fs.readFileSync(path.resolve(root, flag('campaigns', path.join(dataDir, 'acquisition/laser-campaigns.json'))), 'utf8'));
    const publicDir = path.resolve(root, flag('public', 'apps/golf/public'));
    const { ground } = readActivePublishedGround(publicDir, groundId);
    const readAsset = async url => fs.readFileSync(path.join(publicDir, url));
    const readBinary = (file, Type) => {
      const sidecar = JSON.parse(fs.readFileSync(file.replace(/.bin$/, '.json'), 'utf8'));
      const bytes = fs.readFileSync(file);
      return { sidecar, values: new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
    };
    const chm = readBinary(path.resolve(root, flag('residual-chm')), Float32Array);
    const labels = readBinary(path.resolve(root, flag('residual-labels')), Int32Array);
    for (const key of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
      if (chm.sidecar[key] !== labels.sidecar[key]) throw new Error(`residual chm and labels differ in ${key}`);
    }
    const raster = createRaster({ width: chm.sidecar.width, height: chm.sidecar.height, sampleSpacingMetres: chm.sidecar.sampleSpacingMetres, originEasting: chm.sidecar.originEasting, originNorthing: chm.sidecar.originNorthing, values: chm.values });
    const result = await compileReviewedVegetation({
      groundId, observedOn, campaigns,
      rows: parseCandidateCsv(fs.readFileSync(path.resolve(root, flag('reviewed')), 'utf8')),
      scope: flag('scope').split(',').map(Number),
      residual: { raster, labels: labels.values },
      geometry: loadGroundGeometry(dataDir, groundId), ground, readAsset,
      review: flag('review'),
    });
    writeCompilation(outDir, result);
    console.log(JSON.stringify(result.evidence, null, 2));
    process.exit(0);
  }
  if (!groundId || !outDir || !rasterArgs.length) {
    console.error('usage: compile-vegetation.mjs --ground <id> --out <dir> --raster <campaignId>=<data.f32>:<sidecar.json> [...] [--approvals file | --approve-all-individuals | --machine-review] [--previous registry.json]');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const dataDir = path.join(root, 'geo_data/course-v2', groundId);
  const campaigns = JSON.parse(fs.readFileSync(path.join(dataDir, 'acquisition/laser-campaigns.json'), 'utf8'));
  const geometry = loadGroundGeometry(dataDir, groundId);
  const publicDir = path.join(root, 'apps/golf/public');
  const { ground } = readActivePublishedGround(publicDir, groundId);
  const readAsset = async url => fs.readFileSync(path.join(publicDir, url));
  const rasters = rasterArgs.map(spec => {
    const match = /^([^=]+)=([^:]+):(.+)$/.exec(spec);
    if (!match) throw new Error(`bad --raster ${spec}`);
    return { campaignId: match[1], raster: readRawRaster(match[2], match[3]) };
  });
  const approvalsPath = flag('approvals');
  const previousPath = flag('previous');
  const result = await compileVegetation({
    groundId,
    observedOn,
    campaigns,
    rasters,
    geometry,
    ground,
    readAsset,
    previousRecords: previousPath ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : [],
    approvals: approvalsPath ? JSON.parse(fs.readFileSync(approvalsPath, 'utf8')) : null,
    approveAllIndividuals: args.includes('--approve-all-individuals'),
    machineReview: args.includes('--machine-review') ? MACHINE_REVIEW_RULES : null,
  });
  writeCompilation(outDir, result);
  console.log(JSON.stringify({ candidates: result.evidence.candidates, records: result.evidence.records, stands: result.evidence.stands, identity: result.evidence.identity, review: result.evidence.review, machineReview: result.evidence.machineReview }, null, 2));
}
