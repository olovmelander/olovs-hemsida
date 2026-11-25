/* What the tree pipeline may read.

   - Laser: COPC point clouds from Lantmäteriet's height STAC
     (https://api.lantmateriet.se/stac-hojd/v1/), served from dl1.lantmateriet.se.
     A point cloud is structurally required (application/vnd.laszip+copc, a
     .copc.laz asset): it places the trees, and no raster stands in for it.
   - Orthophotos: orto-* collections from the imagery STAC (stac-bild), served
     from dl1.lantmateriet.se/bild/data/orto/.
   - The surface model matched from aerial photos ("Ythöjdmodell", collection
     dsm-cog in the height STAC), served from dl1.lantmateriet.se/hojd/data/grid/yhm/.
     Forbidden from 8 November 2026; the owner allowed it on 25 November 2026
     ("Allow it", to add to the laser for trees planted since the laser was
     flown, leafy park crowns and species, never to replace it, and every use
     scored on a held-out sample).
   - Naturvårdsverket's tree-species map (NMD2023 tilläggsskikt trädslag, CC0),
     from geodata.naturvardsverket.se: the owner approved new sources that give
     better data on 25 November 2026.
   - Never Skogsstyrelsen data (the owner's decision of 8 November 2026 stands).
   Credentials are read from the environment only (node --env-file=<.env>),
   by the shared credentials module, and never printed or written.          */

export const LANTMATERIET_HEIGHT_STAC = 'https://api.lantmateriet.se/stac-hojd/v1/';
export const LANTMATERIET_IMAGE_STAC = 'https://api.lantmateriet.se/stac-bild/v1/';
export const LANTMATERIET_DOWNLOAD_HOST = 'dl1.lantmateriet.se';
export const SURFACE_COLLECTION = 'dsm-cog';
export const NMD_HOST = 'geodata.naturvardsverket.se';

/* any Skogsstyrelsen origin */
const FORBIDDEN = [/skogsstyrelsen/i, /\bsks\b/i];

export function forbiddenSource(text) {
  return FORBIDDEN.some(pattern => pattern.test(String(text ?? '')));
}

/**
 * Check a pinned laser campaigns file and the configured items against the
 * policy. Returns the list of problems (empty when the sources are allowed).
 */
export function laserPolicyProblems(campaigns, itemIds) {
  const problems = [];
  if (campaigns.discovery && campaigns.discovery !== LANTMATERIET_HEIGHT_STAC) problems.push(`laser discovery ${campaigns.discovery} is not Lantmäteriet's height STAC`);
  if (forbiddenSource(campaigns.collection) || forbiddenSource(campaigns.terms?.attribution)) problems.push(`laser collection ${campaigns.collection} is a forbidden source`);
  for (const id of itemIds) {
    const item = (campaigns.items || []).find(entry => entry.id === id);
    if (!item) { problems.push(`laser item ${id} is not in the pinned campaigns file`); continue; }
    const asset = item.assets?.data;
    if (!asset) { problems.push(`laser item ${id} has no data asset`); continue; }
    let url = null;
    try { url = new URL(asset.href); } catch { problems.push(`laser item ${id} has no valid href`); continue; }
    if (url.protocol !== 'https:' || url.hostname !== LANTMATERIET_DOWNLOAD_HOST) problems.push(`laser item ${id} is not served by ${LANTMATERIET_DOWNLOAD_HOST}`);
    if (!/\.copc\.laz$/.test(url.pathname) || (asset.type && asset.type !== 'application/vnd.laszip+copc')) problems.push(`laser item ${id} is not a COPC point cloud`);
    if (forbiddenSource(item.collection) || forbiddenSource(url.pathname)) problems.push(`laser item ${id} comes from a forbidden source`);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !Number.isInteger(asset.bytes)) problems.push(`laser item ${id} has no pinned size and SHA-256`);
  }
  return problems;
}

/** Check the configured orthophoto campaigns against the policy. */
export function orthoPolicyProblems(campaigns) {
  const problems = [];
  for (const campaign of campaigns) {
    if (!/^orto-/.test(campaign.collection)) problems.push(`orthophoto collection ${campaign.collection} is not a Lantmäteriet orthophoto (orto-*)`);
    if (forbiddenSource(campaign.collection)) problems.push(`orthophoto collection ${campaign.collection} is a forbidden source`);
  }
  return problems;
}

/** A surface-model item the pipeline will read, or a refusal: Lantmäteriet's dsm-cog only. */
export function safeSurfaceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== LANTMATERIET_DOWNLOAD_HOST || !url.pathname.startsWith('/hojd/data/grid/yhm/') ||
      !url.pathname.endsWith('_dsm.tif') || url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a URL that is not a Lantmäteriet surface-model asset');
  }
  return url;
}

/** The pinned surface-model items, against the policy. */
export function surfacePolicyProblems(pins) {
  const problems = [];
  if (pins.discovery !== LANTMATERIET_HEIGHT_STAC) problems.push(`surface discovery ${pins.discovery} is not Lantmäteriet's height STAC`);
  if (pins.collection !== SURFACE_COLLECTION) problems.push(`surface collection ${pins.collection} is not ${SURFACE_COLLECTION}`);
  for (const item of pins.items || []) {
    try { safeSurfaceUrl(item.href); } catch (error) { problems.push(`${item.id}: ${error.message}`); }
    if (forbiddenSource(item.href)) problems.push(`${item.id} comes from a forbidden source`);
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') || !Number.isInteger(item.bytes)) problems.push(`${item.id} has no pinned size and SHA-256`);
  }
  return problems;
}

/** An orthophoto asset URL the pipeline will fetch, or a refusal. */
export function safeOrthoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== LANTMATERIET_DOWNLOAD_HOST || !url.pathname.startsWith('/bild/data/orto/') ||
      !url.pathname.endsWith('.tif') || url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a URL that is not a Lantmäteriet orthophoto asset');
  }
  return url;
}
