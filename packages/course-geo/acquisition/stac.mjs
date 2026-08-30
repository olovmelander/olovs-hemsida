import { createHash } from 'node:crypto';

export const STAC_ENDPOINTS = Object.freeze({
  height: 'https://api.lantmateriet.se/stac-hojd/v1/',
  imagery: 'https://api.lantmateriet.se/stac-bild/v1/',
});

const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_MULTIHASH = /^1220([a-f0-9]{64})$/;

function finiteBbox(value, label = 'bbox') {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item))) {
    throw new TypeError(`${label} must be [minX, minY, maxX, maxY]`);
  }
  if (value[0] >= value[2] || value[1] >= value[3]) {
    throw new RangeError(`${label} has an empty or inverted extent`);
  }
  return value;
}

function round(value, decimals = 9) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function bboxIntersects(left, right) {
  finiteBbox(left, 'left bbox');
  finiteBbox(right, 'right bbox');
  return left[0] < right[2] && left[2] > right[0] &&
    left[1] < right[3] && left[3] > right[1];
}

export function bboxIntersection(left, right) {
  if (!bboxIntersects(left, right)) return null;
  return [
    Math.max(left[0], right[0]),
    Math.max(left[1], right[1]),
    Math.min(left[2], right[2]),
    Math.min(left[3], right[3]),
  ];
}

export function bboxArea(value) {
  const [minX, minY, maxX, maxY] = finiteBbox(value);
  return (maxX - minX) * (maxY - minY);
}

export function rectangleUnionArea(rectangles) {
  const valid = rectangles.filter(Boolean).map((item, index) => finiteBbox(item, `rectangle ${index}`));
  if (valid.length === 0) return 0;
  const xs = [...new Set(valid.flatMap(item => [item[0], item[2]]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index++) {
    const minX = xs[index];
    const maxX = xs[index + 1];
    if (maxX <= minX) continue;
    const middle = (minX + maxX) / 2;
    const intervals = valid
      .filter(item => item[0] <= middle && item[2] >= middle)
      .map(item => [item[1], item[3]])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    if (intervals.length === 0) continue;
    let coveredY = 0;
    let [start, end] = intervals[0];
    for (const [nextStart, nextEnd] of intervals.slice(1)) {
      if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        coveredY += end - start;
        start = nextStart;
        end = nextEnd;
      }
    }
    coveredY += end - start;
    area += (maxX - minX) * coveredY;
  }
  return area;
}

export function projectedBbox(feature) {
  const value = feature?.properties?.['proj:bbox'] ?? feature?.assets?.data?.['proj:bbox'];
  if (!value) throw new Error(`STAC item ${feature?.id || '<unknown>'} has no proj:bbox`);
  return finiteBbox(value, `STAC item ${feature?.id || '<unknown>'} proj:bbox`);
}

export function featureDate(feature) {
  const properties = feature?.properties || {};
  return properties.data_modified || properties.updated || properties.end_datetime ||
    properties.datetime || properties.start_datetime || '';
}

export function coverageSummary(features, aoiBbox) {
  finiteBbox(aoiBbox, 'AOI bbox');
  const clipped = features.map(feature => bboxIntersection(projectedBbox(feature), aoiBbox));
  const coveredSquareMetres = rectangleUnionArea(clipped);
  const requiredSquareMetres = bboxArea(aoiBbox);
  return {
    requiredSquareMetres: round(requiredSquareMetres, 3),
    coveredSquareMetres: round(Math.min(coveredSquareMetres, requiredSquareMetres), 3),
    ratio: round(Math.min(1, coveredSquareMetres / requiredSquareMetres), 9),
    complete: coveredSquareMetres >= requiredSquareMetres - Math.max(0.01, requiredSquareMetres * 1e-9),
  };
}

export function selectNewestCoverage(features, aoiBbox) {
  const candidates = features
    .filter(feature => bboxIntersects(projectedBbox(feature), aoiBbox))
    .sort((left, right) => featureDate(right).localeCompare(featureDate(left)) ||
      String(left.id).localeCompare(String(right.id)));
  const selected = [];
  let covered = 0;
  for (const feature of candidates) {
    const next = [...selected, feature];
    const nextCovered = coverageSummary(next, aoiBbox).coveredSquareMetres;
    if (nextCovered > covered + 0.01) {
      selected.push(feature);
      covered = nextCovered;
    }
  }
  return {
    features: selected.sort((left, right) => String(left.id).localeCompare(String(right.id))),
    coverage: coverageSummary(selected, aoiBbox),
  };
}

function campaignRank(features) {
  return features.reduce((latest, feature) => {
    const properties = feature.properties || {};
    const year = Number(properties.flygar);
    const candidate = Number.isInteger(year) ? `${String(year).padStart(4, '0')}-12-31` : featureDate(feature);
    return candidate > latest ? candidate : latest;
  }, '');
}

export function selectLatestCampaign(features, aoiBbox) {
  const groups = new Map();
  for (const feature of features) {
    if (!bboxIntersects(projectedBbox(feature), aoiBbox)) continue;
    const key = feature.collection || '<missing-collection>';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }
  if (groups.size === 0) throw new Error('no STAC campaign intersects the AOI');
  const campaigns = [...groups.entries()].map(([collection, items]) => ({
    collection,
    items,
    rank: campaignRank(items),
    coverage: coverageSummary(items, aoiBbox),
  })).sort((left, right) => right.rank.localeCompare(left.rank) ||
    right.coverage.ratio - left.coverage.ratio || left.collection.localeCompare(right.collection));
  const primary = campaigns[0];
  const selected = [...primary.items];
  const fallbackCollections = new Set();
  let selectedCoverage = coverageSummary(selected, aoiBbox);
  for (const campaign of campaigns.slice(1)) {
    if (selectedCoverage.complete) break;
    for (const feature of campaign.items.sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
      const candidateCoverage = coverageSummary([...selected, feature], aoiBbox);
      if (candidateCoverage.coveredSquareMetres > selectedCoverage.coveredSquareMetres + 0.01) {
        selected.push(feature);
        fallbackCollections.add(campaign.collection);
        selectedCoverage = candidateCoverage;
      }
      if (selectedCoverage.complete) break;
    }
  }
  return {
    collection: primary.collection,
    primaryFeatures: primary.items.sort((left, right) => String(left.id).localeCompare(String(right.id))),
    primaryCoverage: primary.coverage,
    features: selected.sort((left, right) => String(left.collection).localeCompare(String(right.collection)) ||
      String(left.id).localeCompare(String(right.id))),
    coverage: selectedCoverage,
    fallbackCollections: [...fallbackCollections].sort(),
    completeCampaignAvailable: campaigns.some(item => item.coverage.complete),
    campaigns: campaigns.map(item => ({
      collection: item.collection,
      rank: item.rank,
      itemCount: item.items.length,
      coverage: item.coverage,
    })),
  };
}

export function sha256FromStacChecksum(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (SHA256.test(normalized)) return normalized;
  return normalized.match(SHA256_MULTIHASH)?.[1] || null;
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeStacUrl(root, candidate) {
  const rootUrl = new URL(root);
  const nextUrl = new URL(candidate, rootUrl);
  if (nextUrl.protocol !== 'https:' || nextUrl.origin !== rootUrl.origin ||
      !nextUrl.pathname.startsWith(rootUrl.pathname)) {
    throw new Error(`refusing STAC pagination outside ${rootUrl.href}: ${nextUrl.href}`);
  }
  return nextUrl;
}

async function fetchJson(url, { fetchImpl, timeoutMs, headers = {} }) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/geo+json, application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== 'object') throw new Error(`GET ${url} returned non-object JSON`);
  return value;
}

export async function stacSearch(root, {
  bbox,
  collections,
  fetchImpl = globalThis.fetch,
  limit = 1000,
  maxPages = 20,
  timeoutMs = 60_000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  finiteBbox(bbox, 'STAC search bbox');
  if (collections !== undefined &&
      (!Array.isArray(collections) || collections.length === 0)) {
    throw new TypeError('STAC collections must be a non-empty array when provided');
  }
  const search = safeStacUrl(root, 'search');
  search.searchParams.set('bbox', bbox.join(','));
  if (collections) search.searchParams.set('collections', collections.join(','));
  search.searchParams.set('limit', String(limit));
  const seenPages = new Set();
  const features = new Map();
  let next = search;
  let pageCount = 0;
  while (next) {
    if (++pageCount > maxPages) throw new Error(`STAC pagination exceeded ${maxPages} pages`);
    if (seenPages.has(next.href)) throw new Error(`STAC pagination cycle at ${next.href}`);
    seenPages.add(next.href);
    const page = await fetchJson(next, { fetchImpl, timeoutMs });
    if (!Array.isArray(page.features)) throw new Error(`STAC page ${next.href} has no feature array`);
    for (const feature of page.features) {
      if (!feature?.id || !feature?.collection) throw new Error(`STAC page ${next.href} has an invalid item`);
      const key = `${feature.collection}/${feature.id}`;
      features.set(key, feature);
    }
    const link = Array.isArray(page.links) ? page.links.find(item => item.rel === 'next') : null;
    if (link?.method && String(link.method).toUpperCase() !== 'GET') {
      throw new Error(`unsupported STAC next-link method ${link.method}`);
    }
    next = link?.href ? safeStacUrl(root, link.href) : null;
  }
  return [...features.values()].sort((left, right) =>
    String(left.collection).localeCompare(String(right.collection)) ||
    String(left.id).localeCompare(String(right.id)));
}

export function summarizeAsset(asset) {
  if (!asset) return null;
  const stacChecksum = asset['file:checksum'] || null;
  return {
    href: asset.href,
    type: asset.type || null,
    title: asset.title || null,
    roles: Array.isArray(asset.roles) ? [...asset.roles].sort() : [],
    bytes: Number.isFinite(asset['file:size']) ? asset['file:size'] : null,
    stacChecksum,
    sha256: sha256FromStacChecksum(stacChecksum),
    projCode: asset['proj:code'] || null,
    projBbox: asset['proj:bbox'] || null,
    projShape: asset['proj:shape'] || null,
  };
}

export function summarizeFeature(feature, assetNames = Object.keys(feature.assets || {})) {
  const properties = feature.properties || {};
  return {
    id: feature.id,
    collection: feature.collection,
    bboxWgs84: feature.bbox || null,
    projCode: properties['proj:code'] || feature.assets?.data?.['proj:code'] || null,
    projBbox: projectedBbox(feature),
    capturedAt: properties.datetime || null,
    captureStart: properties.start_datetime || null,
    captureEnd: properties.end_datetime || null,
    modifiedAt: properties.data_modified || properties.andringsdatum || null,
    resolutionMetres: properties.geometriskupplosning ?? properties.upplosning ?? null,
    horizontalUncertaintyMetres: properties.lagesosakerhetplan ?? null,
    verticalUncertaintyMetres: properties.lagesosakerhethojd ?? null,
    pointDensityPerSquareMetre: properties.punkttathet ?? properties['pc:density'] ?? null,
    pointCount: properties['pc:count'] ?? null,
    spectralType: properties.spektraltyp || null,
    assets: Object.fromEntries(assetNames
      .filter(name => feature.assets?.[name])
      .sort()
      .map(name => [name, summarizeAsset(feature.assets[name])])),
  };
}
