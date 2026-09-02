/* Which Laserdata Skog campaigns cover a ground, and where they meet.

   The discovery report answers "is there coverage"; this answers the question
   the vegetation compiler actually has to live with: WHICH scan owns each part
   of the ground, when it was flown, with what sensor and leaf state, how dense
   it really is, and where two scans abut. At Puttom the answer is two
   campaigns three years and one sensor generation apart, meeting on a hard
   line that runs through the course, and a third, superseded scan under the
   newer of the two. Nothing here needs credentials: the STAC search, the
   per-item `_info.json` under `/hojd/pub/`, and Skogsstyrelsen's scan-area
   metadata layer all answer unauthenticated, so the evidence can be re-derived
   by anyone and pinned before a single point byte is read.                    */
import {
  STAC_ENDPOINTS,
  bboxArea,
  bboxIntersection,
  rectangleUnionArea,
  sha256Bytes,
  sha256FromStacChecksum,
  stacSearch,
  summarizeFeature,
} from './stac.mjs';

export const LASER_CAMPAIGNS_SCHEMA_VERSION = 1;
export const LASER_COLLECTION = 'dsm-skoglig-copc';

/* The licence changed on 2026-06-01: the collection now advertises `other`
   because Lantmäteriet classes the point cloud as personal data under GDPR,
   but the terms document keeps CC BY 4.0 and adds this attribution string,
   which therefore travels with every derived asset. */
export const LASER_TERMS = Object.freeze({
  documentId: 'LM2026/077164',
  version: '1.0',
  effectiveFrom: '2026-06-01',
  licence: 'CC-BY-4.0',
  attribution: 'Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0',
  url: 'https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf',
  personalData: 'the licensee is data controller for the raw cloud; a registry of tree positions, heights and radii carries no personal data and the raw cloud is never published',
});

export const SKOGSSTYRELSEN_SCAN_METADATA = Object.freeze({
  service: 'https://geodpags.skogsstyrelsen.se/arcgis/rest/services/Geodataportal/GeodataportalVisaSkogligaGrunddataMetadata/MapServer/0/query',
  fields: Object.freeze(['Indexruta', 'Las_Namn', 'Datum', 'Lov_Avlov', 'Skannermodell', 'Omdrev']),
  /* Skogsstyrelsen's own technical description uses August scans as the
     worked example with value 1, so 1 is leaf-on. */
  leafOnValue: 1,
});

const SEAM_TOLERANCE_METRES = 0.5;
const EXCLUSIVE_AREA_FLOOR_SQUARE_METRES = 1;

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function finiteBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item)) ||
      value[0] >= value[2] || value[1] >= value[3]) {
    throw new TypeError(`${label} must be a finite non-empty [minX, minY, maxX, maxY] bbox`);
  }
  return value;
}

export function safePublicInfoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/pub/pointcloud/sls/') || !url.pathname.endsWith('_info.json') ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a metadata URL that is not a public Laserdata Skog info asset');
  }
  return url;
}

/**
 * The numbers that matter from a `_info.json`, each with the definition it
 * actually has. "Density" arrives as three different quantities and the STAC
 * `pc:density` field is a point spacing in metres; every consumer must say
 * which one it means, so this never collapses them into one field.
 */
export function itemStatisticsFromInfo(info) {
  const metadata = info?.metadata;
  const boundary = info?.boundary;
  const statistics = info?.stats?.statistic;
  if (!metadata || !boundary || !Array.isArray(statistics)) {
    throw new Error('COPC info metadata is incomplete: metadata, boundary and stats are required');
  }
  const stat = name => statistics.find(item => item.name === name) || null;
  const count = finite(metadata.count, 'metadata.count');
  const area = finite(boundary.area, 'boundary.area');
  const copc = metadata.copc_info || {};
  const numberOfReturns = stat('NumberOfReturns');
  const returnNumber = stat('ReturnNumber');
  const classification = stat('Classification');
  const intensity = stat('Intensity');
  const scanAngle = stat('ScanAngleRank');
  const pointSource = stat('PointSourceId');
  const gpsTime = stat('GpsTime');
  return Object.freeze({
    pointCount: count,
    lasVersion: `${metadata.major_version}.${metadata.minor_version}`,
    pointRecordFormat: metadata.dataformat_id ?? null,
    pointLength: metadata.point_length ?? null,
    compoundCrs: /EPSG","5845"/.test(String(metadata.comp_spatialreference || '')) ? 'EPSG:5845' : null,
    boundsEpsg3006: [metadata.minx, metadata.miny, metadata.maxx, metadata.maxy].map(value => finite(value, 'metadata bounds')),
    heightRangeRH2000: [finite(metadata.minz, 'metadata.minz'), finite(metadata.maxz, 'metadata.maxz')],
    scale: [metadata.scale_x, metadata.scale_y, metadata.scale_z],
    offset: [metadata.offset_x, metadata.offset_y, metadata.offset_z],
    boundaryAreaSquareMetres: round(area, 2),
    /* all returns over the hexbin boundary: the only density here that is a
       count divided by an area */
    allReturnDensityPerSquareMetre: round(count / area, 3),
    boundaryDensity: round(boundary.density, 4),
    averagePointSpacingMetres: round(boundary.avg_pt_spacing, 4),
    averagePointsPerSquareUnit: round(boundary.avg_pt_per_sq_unit, 4),
    returns: Object.freeze({
      numberOfReturnsMean: round(numberOfReturns?.average, 4),
      numberOfReturnsMax: numberOfReturns?.maximum ?? null,
      returnNumberMean: round(returnNumber?.average, 4),
    }),
    classificationMean: round(classification?.average, 4),
    intensity: Object.freeze({
      min: intensity?.minimum ?? null,
      mean: round(intensity?.average, 2),
      max: intensity?.maximum ?? null,
    }),
    scanAngleDegrees: Object.freeze({ min: round(scanAngle?.minimum, 3), max: round(scanAngle?.maximum, 3) }),
    flightLines: Object.freeze({
      firstId: pointSource?.minimum ?? null,
      lastId: pointSource?.maximum ?? null,
      count: Number.isFinite(pointSource?.minimum) && Number.isFinite(pointSource?.maximum)
        ? pointSource.maximum - pointSource.minimum + 1 : null,
    }),
    gpsTime: Object.freeze({
      min: gpsTime?.minimum ?? null,
      max: gpsTime?.maximum ?? null,
      spanSeconds: Number.isFinite(gpsTime?.minimum) && Number.isFinite(gpsTime?.maximum)
        ? round(gpsTime.maximum - gpsTime.minimum, 1) : null,
    }),
    copc: Object.freeze({
      spacingMetres: copc.spacing ?? null,
      halfSizeMetres: copc.halfsize ?? null,
      center: [copc.center_x, copc.center_y, copc.center_z],
      rootHierarchyOffset: copc.root_hier_offset ?? null,
      rootHierarchySize: copc.root_hier_size ?? null,
    }),
    creation: Object.freeze({ year: metadata.creation_year ?? null, dayOfYear: metadata.creation_doy ?? null }),
    software: metadata.software_id || null,
  });
}

function byNewest(left, right) {
  return String(right.captureEnd || right.capturedAt || '').localeCompare(String(left.captureEnd || left.capturedAt || '')) ||
    String(left.id).localeCompare(String(right.id));
}

function seamBetween(a, b, aoi) {
  const pairs = [];
  const [ax0, ay0, ax1, ay1] = a.projBbox;
  const [bx0, by0, bx1, by1] = b.projBbox;
  const xFrom = Math.max(ax0, bx0, aoi[0]);
  const xTo = Math.min(ax1, bx1, aoi[2]);
  const yFrom = Math.max(ay0, by0, aoi[1]);
  const yTo = Math.min(ay1, by1, aoi[3]);
  const north = [[ay1, by0], [by1, ay0]];
  for (const [top, bottom] of north) {
    if (Math.abs(top - bottom) <= SEAM_TOLERANCE_METRES && xTo > xFrom && top > aoi[1] && top < aoi[3]) {
      pairs.push({ axis: 'northing', value: round((top + bottom) / 2, 3), from: round(xFrom, 3), to: round(xTo, 3) });
    }
  }
  const east = [[ax1, bx0], [bx1, ax0]];
  for (const [right, left] of east) {
    if (Math.abs(right - left) <= SEAM_TOLERANCE_METRES && yTo > yFrom && right > aoi[0] && right < aoi[2]) {
      pairs.push({ axis: 'easting', value: round((right + left) / 2, 3), from: round(yFrom, 3), to: round(yTo, 3) });
    }
  }
  return pairs;
}

/**
 * Sort the items newest-first and give each one the part of the AOI it still
 * owns after every newer item has taken its share. An item with no exclusive
 * area is superseded: it may be read as a change reference but never
 * contributes canopy. Active items that share an edge inside the AOI define a
 * seam; active items that overlap define a band that must be reconciled by
 * precedence, never blended.
 */
export function campaignInventory(features, aoiBboxEpsg3006, { infoStatistics = new Map() } = {}) {
  const aoi = finiteBbox(aoiBboxEpsg3006, 'AOI bbox');
  const items = [];
  for (const feature of features) {
    if (feature.collection !== LASER_COLLECTION) continue;
    const summary = summarizeFeature(feature, ['data', 'info']);
    const projBbox = summary.projBbox;
    if (!projBbox) throw new Error(`laser item ${feature.id} carries no projected bbox`);
    finiteBbox(projBbox, `laser item ${feature.id} proj:bbox`);
    const overlap = bboxIntersection(projBbox, aoi);
    if (!overlap) continue;
    const properties = feature.properties || {};
    items.push({
      id: summary.id,
      collection: summary.collection,
      projBbox: projBbox.map(value => round(value, 3)),
      capturedAt: summary.capturedAt,
      captureStart: summary.captureStart,
      captureEnd: summary.captureEnd,
      updatedAt: properties.updated || properties.andringsdatum || null,
      dataModifiedAt: properties.data_modified || null,
      scanArea: properties.skanningsomrade || null,
      flightHeightMetres: properties.flyghojd ?? null,
      /* three different quantities, deliberately three fields */
      declaredPointDensityPerSquareMetre: properties.punkttathet ?? null,
      stacPcDensity: properties['pc:density'] ?? null,
      stacPointCount: properties['pc:count'] ?? null,
      assets: summary.assets,
      overlapBboxEpsg3006: overlap.map(value => round(value, 3)),
      overlapSquareMetres: round(bboxArea(overlap), 1),
      overlapRatioOfAoi: round(bboxArea(overlap) / bboxArea(aoi), 6),
      statistics: infoStatistics.get(feature.id) || null,
    });
  }
  items.sort(byNewest);
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const newer = items.slice(0, index)
      .map(other => bboxIntersection(item.overlapBboxEpsg3006, other.overlapBboxEpsg3006))
      .filter(Boolean);
    const exclusive = bboxArea(item.overlapBboxEpsg3006) - rectangleUnionArea(newer);
    item.exclusiveSquareMetres = round(Math.max(0, exclusive), 1);
    item.role = exclusive > EXCLUSIVE_AREA_FLOOR_SQUARE_METRES ? 'active' : 'superseded';
    item.supersededBy = items.slice(0, index)
      .filter(other => bboxIntersection(item.overlapBboxEpsg3006, other.overlapBboxEpsg3006))
      .map(other => other.id);
    item.excludedFromCanopy = item.role !== 'active';
  }
  const active = items.filter(item => item.role === 'active');
  const seams = [];
  const activeOverlapBands = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      for (const seam of seamBetween(a, b, aoi)) {
        seams.push({ id: `seam-${seam.axis}-${seam.value}`, ...seam, items: [a.id, b.id].sort() });
      }
      const band = bboxIntersection(a.overlapBboxEpsg3006, b.overlapBboxEpsg3006);
      if (band) activeOverlapBands.push({ items: [a.id, b.id].sort(), bboxEpsg3006: band.map(value => round(value, 3)) });
    }
  }
  seams.sort((left, right) => left.id.localeCompare(right.id));
  const coverageRatio = round(Math.min(1, rectangleUnionArea(active.map(item => item.overlapBboxEpsg3006)) / bboxArea(aoi)), 6);
  return Object.freeze({
    items: Object.freeze(items.map(item => Object.freeze(item))),
    activeItemIds: Object.freeze(active.map(item => item.id)),
    supersededItemIds: Object.freeze(items.filter(item => item.role !== 'active').map(item => item.id)),
    seams: Object.freeze(seams),
    activeOverlapBands: Object.freeze(activeOverlapBands),
    coverageRatio,
    precedence: 'newest campaign owns each area; a seam between active campaigns is a hard line that nothing is averaged across; a superseded campaign is a change reference and never contributes canopy',
  });
}

/** Signed distance from a point to each seam: positive is north/east of it. */
export function seamDistances(point, seams) {
  const easting = finite(point?.easting, 'point.easting');
  const northing = finite(point?.northing, 'point.northing');
  return seams.map(seam => {
    const signed = seam.axis === 'northing' ? northing - seam.value : easting - seam.value;
    return Object.freeze({
      seamId: seam.id,
      signedDistanceMetres: round(signed, 3),
      side: signed >= 0 ? (seam.axis === 'northing' ? 'north' : 'east') : (seam.axis === 'northing' ? 'south' : 'west'),
    });
  });
}

/** Which side of every seam a rectangle lies on, or that it straddles. */
export function rectangleSeamRelation(bbox, seams) {
  finiteBbox(bbox, 'rectangle');
  return seams.map(seam => {
    const low = seam.axis === 'northing' ? bbox[1] : bbox[0];
    const high = seam.axis === 'northing' ? bbox[3] : bbox[2];
    let relation = 'straddles';
    if (high <= seam.value) relation = seam.axis === 'northing' ? 'south' : 'west';
    else if (low >= seam.value) relation = seam.axis === 'northing' ? 'north' : 'east';
    return Object.freeze({ seamId: seam.id, relation, lowSideMetres: round(seam.value - low, 3), highSideMetres: round(high - seam.value, 3) });
  });
}

export function parseSkogsstyrelsenScanMetadata(response) {
  if (!response || !Array.isArray(response.features)) throw new Error('scan metadata response has no feature array');
  return response.features.map(feature => {
    const attributes = feature.attributes || {};
    return Object.freeze({
      indexSquare: attributes.Indexruta ?? null,
      scanName: attributes.Las_Namn ?? null,
      date: attributes.Datum ?? null,
      leafOn: attributes.Lov_Avlov === SKOGSSTYRELSEN_SCAN_METADATA.leafOnValue,
      leafFlag: attributes.Lov_Avlov ?? null,
      scanner: attributes.Skannermodell ?? null,
      cycle: attributes.Omdrev ?? null,
    });
  }).sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
}

export function scanMetadataQueryUrl(point) {
  const url = new URL(SKOGSSTYRELSEN_SCAN_METADATA.service);
  url.searchParams.set('geometry', JSON.stringify({ x: finite(point.easting, 'easting'), y: finite(point.northing, 'northing') }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '3006');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', SKOGSSTYRELSEN_SCAN_METADATA.fields.join(','));
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  return url;
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response;
}

export async function fetchLaserItems(bboxWgs84, { fetchImpl = globalThis.fetch } = {}) {
  return stacSearch(STAC_ENDPOINTS.height, { bbox: bboxWgs84, collections: [LASER_COLLECTION], fetchImpl });
}

/** The public `_info.json`, verified against the STAC checksum when one is advertised. */
export async function fetchItemInfo(feature, { fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  const asset = feature.assets?.info;
  if (!asset?.href) throw new Error(`laser item ${feature.id} advertises no info asset`);
  const url = safePublicInfoUrl(asset.href);
  const started = performance.now();
  const response = await fetchJson(url, fetchImpl, timeoutMs);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = sha256Bytes(bytes);
  const expected = sha256FromStacChecksum(asset['file:checksum']);
  if (expected && expected !== sha256) {
    throw new Error(`info asset for ${feature.id} does not match its STAC checksum`);
  }
  const expectedBytes = Number.isFinite(asset['file:size']) ? asset['file:size'] : null;
  if (expectedBytes !== null && expectedBytes !== bytes.length) {
    throw new Error(`info asset for ${feature.id} is ${bytes.length} bytes; STAC advertises ${expectedBytes}`);
  }
  return Object.freeze({
    itemId: feature.id,
    href: url.href,
    bytes: bytes.length,
    sha256,
    expectedSha256: expected,
    checksumVerified: expected !== null && expected === sha256,
    elapsedMilliseconds: round(performance.now() - started, 3),
    info: JSON.parse(bytes.toString('utf8')),
  });
}

export async function fetchScanMetadata(point, { fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  const response = await fetchJson(scanMetadataQueryUrl(point), fetchImpl, timeoutMs);
  const json = await response.json();
  if (json?.error) throw new Error(`scan metadata service error ${json.error.code || ''}: ${json.error.message || ''}`);
  return parseSkogsstyrelsenScanMetadata(json);
}

/** The pinned document. Everything in it is re-derivable without credentials. */
export function laserCampaignsReport({
  groundId,
  groundName,
  courseSlugs,
  observedOn,
  aoi,
  inventory,
  origin = null,
  groundBounds = null,
  scanMetadata = [],
  infoEvidence = [],
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn || '')) throw new Error('observedOn must be YYYY-MM-DD');
  const seams = inventory.seams;
  return {
    $schema: '../../../../packages/course-geo/acquisition/laser-campaigns.schema.json',
    schemaVersion: LASER_CAMPAIGNS_SCHEMA_VERSION,
    groundId,
    groundName,
    courseSlugs,
    observedOn,
    state: 'pinned-campaign-inventory',
    collection: LASER_COLLECTION,
    discovery: STAC_ENDPOINTS.height,
    terms: LASER_TERMS,
    aoi,
    coverageRatio: inventory.coverageRatio,
    precedence: inventory.precedence,
    activeItemIds: [...inventory.activeItemIds],
    supersededItemIds: [...inventory.supersededItemIds],
    seams: seams.map(seam => ({ ...seam })),
    activeOverlapBands: inventory.activeOverlapBands.map(band => ({ ...band })),
    items: inventory.items.map(item => ({ ...item })),
    origin: origin ? { ...origin, seams: seamDistances(origin, seams) } : null,
    groundBounds: groundBounds ? { bboxEpsg3006: groundBounds, seams: rectangleSeamRelation(groundBounds, seams) } : null,
    scanMetadata: scanMetadata.map(entry => ({ ...entry })),
    infoEvidence: infoEvidence.map(entry => ({ ...entry })),
  };
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validateLaserCampaignsReport(report, manifest = null) {
  const errors = [];
  const fail = message => errors.push(message);
  if (report?.schemaVersion !== LASER_CAMPAIGNS_SCHEMA_VERSION) fail('schemaVersion must be 1');
  if (report?.state !== 'pinned-campaign-inventory') fail('state must be pinned-campaign-inventory');
  if (report?.collection !== LASER_COLLECTION) fail(`collection must be ${LASER_COLLECTION}`);
  if (!ID.test(report?.groundId || '')) fail('groundId must be kebab-case');
  if (manifest && report?.groundId !== manifest.groundId) fail('groundId does not match the source manifest');
  if (manifest && JSON.stringify(report?.aoi?.bboxWgs84) !== JSON.stringify(manifest.targetBboxWgs84)) {
    fail('WGS84 AOI does not match the source manifest');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.observedOn || '')) fail('observedOn must be YYYY-MM-DD');
  if (report?.terms?.attribution !== LASER_TERMS.attribution) fail('attribution string drifted from the licence terms');
  if (!Array.isArray(report?.items) || report.items.length === 0) fail('items must be a non-empty array');
  if (!(report?.coverageRatio >= 0.95)) fail('active campaigns cover less than 95% of the AOI');
  const ids = new Set();
  for (const item of report?.items || []) {
    if (ids.has(item.id)) fail(`duplicate item ${item.id}`);
    ids.add(item.id);
    if (!['active', 'superseded'].includes(item.role)) fail(`${item.id}: role must be active or superseded`);
    if (item.excludedFromCanopy !== (item.role !== 'active')) fail(`${item.id}: excludedFromCanopy must follow role`);
    const data = item.assets?.data;
    if (!data?.href?.startsWith('https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/')) fail(`${item.id}: data asset URL is not a Laserdata Skog COPC`);
    if (!SHA256.test(data?.sha256 || '')) fail(`${item.id}: data asset lacks a SHA-256`);
    if (!Number.isFinite(data?.bytes) || data.bytes <= 0) fail(`${item.id}: data asset lacks a byte size`);
    if (item.role === 'active' && !item.statistics) fail(`${item.id}: active items need info statistics`);
    if (item.statistics && item.statistics.compoundCrs !== 'EPSG:5845') fail(`${item.id}: info metadata is not EPSG:5845`);
  }
  for (const id of report?.activeItemIds || []) if (!ids.has(id)) fail(`active item ${id} is not in items`);
  for (const evidence of report?.infoEvidence || []) {
    if (!evidence.checksumVerified) fail(`info asset for ${evidence.itemId} was not checksum-verified`);
  }
  return errors;
}

/** What changed between the pinned inventory and a live one. */
export function campaignDrift(pinned, live) {
  const pinnedItems = new Map((pinned?.items || []).map(item => [item.id, item]));
  const liveItems = new Map((live?.items || []).map(item => [item.id, item]));
  const added = [...liveItems.keys()].filter(id => !pinnedItems.has(id)).sort();
  const removed = [...pinnedItems.keys()].filter(id => !liveItems.has(id)).sort();
  const changed = [];
  for (const [id, item] of pinnedItems) {
    const other = liveItems.get(id);
    if (!other) continue;
    const fields = [
      ['role', item.role, other.role],
      ['captureStart', item.captureStart, other.captureStart],
      ['captureEnd', item.captureEnd, other.captureEnd],
      ['updatedAt', item.updatedAt, other.updatedAt],
      ['data.sha256', item.assets?.data?.sha256, other.assets?.data?.sha256],
      ['data.bytes', item.assets?.data?.bytes, other.assets?.data?.bytes],
      ['info.sha256', item.assets?.info?.sha256, other.assets?.info?.sha256],
      ['pointCount', item.statistics?.pointCount ?? null, other.statistics?.pointCount ?? null],
    ];
    for (const [field, before, after] of fields) {
      if (JSON.stringify(before) !== JSON.stringify(after)) changed.push({ id, field, pinned: before ?? null, live: after ?? null });
    }
  }
  /* a re-fly keeps the seam LINE and changes who meets there, so the seam's
     identity includes its items */
  const seamSignature = seam => `${seam.id}:${(seam.items || []).join('+')}`;
  const seamsBefore = JSON.stringify((pinned?.seams || []).map(seamSignature));
  const seamsAfter = JSON.stringify((live?.seams || []).map(seamSignature));
  if (seamsBefore !== seamsAfter) changed.push({ id: null, field: 'seams', pinned: JSON.parse(seamsBefore), live: JSON.parse(seamsAfter) });
  return Object.freeze({ added, removed, changed, drifted: added.length > 0 || removed.length > 0 || changed.length > 0 });
}
