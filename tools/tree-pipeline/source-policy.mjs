/* What the tree pipeline may read: Lantmäteriet only, as current as the
   account can get.

   - Laser: COPC point clouds from Lantmäteriet's height STAC
     (https://api.lantmateriet.se/stac-hojd/v1/), served from dl1.lantmateriet.se.
     A point cloud is structurally required (application/vnd.laszip+copc, a
     .copc.laz asset), so no raster surface model can stand in for it.
   - Orthophotos: orto-* collections from the imagery STAC (stac-bild), served
     from dl1.lantmateriet.se/bild/data/orto/.
   - Never: "Ythöjdmodell från flygbilder" (the surface model matched from
     aerial photos) under any collection name, and never Skogsstyrelsen data.
   Credentials are read from the environment only (node --env-file=<.env>),
   by the shared credentials module, and never printed or written.          */

export const LANTMATERIET_HEIGHT_STAC = 'https://api.lantmateriet.se/stac-hojd/v1/';
export const LANTMATERIET_IMAGE_STAC = 'https://api.lantmateriet.se/stac-bild/v1/';
export const LANTMATERIET_DOWNLOAD_HOST = 'dl1.lantmateriet.se';

/* the photo-matched surface model, in Swedish and English spellings, and any
   Skogsstyrelsen origin */
const FORBIDDEN = [
  /yt-?h(o|ö|oe)jd-?modell/i, /ytmodell/i, /fr(a|å)n[-_ ]?flygbild/i, /flygbild/i, /bildmatch/i, /image[-_ ]?match/i,
  /photogramm/i, /surface[-_ ]?model[-_ ]?from/i, /skogsstyrelsen/i, /\bsks\b/i,
];

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

/** An orthophoto asset URL the pipeline will fetch, or a refusal. */
export function safeOrthoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== LANTMATERIET_DOWNLOAD_HOST || !url.pathname.startsWith('/bild/data/orto/') ||
      !url.pathname.endsWith('.tif') || url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a URL that is not a Lantmäteriet orthophoto asset');
  }
  return url;
}
