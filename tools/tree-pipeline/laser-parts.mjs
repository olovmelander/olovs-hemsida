/* Laser campaigns that meet inside one window (Bro Hof, review-2026-11-24:
   20C028 of November 2020 and 21C031 of March 2021 meet at E 650000).

   A ground scanned in one campaign needs nothing here: laser.parts is absent
   and the window is one part. Where campaigns meet, trees.json lists them as
   laser.parts, each with its scan area, capture date, leaf state, label and
   pinned items, and the items partition laser.items. A seam between campaigns
   is a hard line that nothing is averaged across (the laser inventory's own
   rule): the canopy stage builds each part's ground, heights and canopy model
   from that part's returns alone and every lattice cell takes the part whose
   items hold its centre; the photo registration reads one part's intensity
   per patch. Cell centres on the seam belong to the part on its east / north
   side, as the items' own half-open boxes do.                              */

/** The laser parts of a ground's window: laser.parts, or the whole laser as one part. */
export function laserParts(laser) {
  if (Array.isArray(laser.parts)) return laser.parts;
  return [{ campaign: laser.campaign, capturedOn: laser.capturedOn, leafState: laser.leafState, label: laser.label, items: laser.items }];
}

/** Each part with the EPSG:3006 boxes of its items, from the pinned campaigns file. */
export function partBoxes(laser, campaigns) {
  return laserParts(laser).map(part => ({
    ...part,
    boxes: part.items.map(id => {
      const item = campaigns.items.find(entry => entry.id === id);
      if (!item) throw new Error(`laser item ${id} is not in the pinned campaigns file`);
      return item.projBbox;
    }),
  }));
}

/** The index of the part that owns a point (half-open boxes), or -1. */
export function partIndexAt(parts, easting, northing) {
  for (let p = 0; p < parts.length; p++) {
    for (const [x0, y0, x1, y1] of parts[p].boxes) if (easting >= x0 && easting < x1 && northing >= y0 && northing < y1) return p;
  }
  return -1;
}

/** The owner of every cell of a grid by its centre (255: no item covers it). */
export function partOwners(grid, parts) {
  const { width, height, sampleSpacingMetres: s } = grid;
  const owner = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const northing = grid.maxNorthing - (row + 0.5) * s;
    for (let column = 0; column < width; column++) {
      const p = partIndexAt(parts, grid.minEasting + (column + 0.5) * s, northing);
      owner[row * width + column] = p < 0 ? 255 : p;
    }
  }
  return owner;
}

/** One raster from one per part: each cell takes its owner's value (`none` where no part owns it). */
export function composeByOwner(owner, rasters, none) {
  const out = new rasters[0].constructor(owner.length);
  for (let i = 0; i < owner.length; i++) out[i] = owner[i] === 255 ? none : rasters[owner[i]][i];
  return out;
}

/** The problems of laser.parts (empty when absent or valid): they partition laser.items, in two or more dated campaigns. */
export function laserPartProblems(laser) {
  if (laser?.parts === undefined) return [];
  const problems = [];
  if (!Array.isArray(laser.parts) || laser.parts.length < 2) return ['laser.parts lists two or more campaigns that meet in the window (leave it out for one campaign)'];
  const items = Array.isArray(laser.items) ? laser.items : [];
  const seen = new Map();
  laser.parts.forEach((part, i) => {
    const label = `laser.parts[${i}]`;
    if (part === null || typeof part !== 'object' || Array.isArray(part)) { problems.push(`${label} must be an object`); return; }
    for (const key of Object.keys(part)) if (!['campaign', 'capturedOn', 'leafState', 'label', 'items', 'note'].includes(key)) problems.push(`${label}.${key} is not a known setting`);
    if (typeof part.campaign !== 'string' || !part.campaign) problems.push(`${label}.campaign must be the scan area id`);
    else if (laser.parts.findIndex(other => other?.campaign === part.campaign) !== i) problems.push(`${label}.campaign ${part.campaign} is listed twice`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part.capturedOn || '')) problems.push(`${label}.capturedOn must be YYYY-MM-DD`);
    if (!['leaf-off', 'leaf-on', 'mixed'].includes(part.leafState)) problems.push(`${label}.leafState must be leaf-off, leaf-on or mixed`);
    if (typeof part.label !== 'string' || !part.label) problems.push(`${label}.label must name the campaign, date and leaf state`);
    if (!Array.isArray(part.items) || !part.items.length) { problems.push(`${label}.items must list its pinned COPC items`); return; }
    for (const id of part.items) {
      if (!items.includes(id)) problems.push(`${label}.items: ${id} is not in laser.items`);
      if (seen.has(id)) problems.push(`${label}.items: ${id} is already in laser.parts[${seen.get(id)}]`);
      seen.set(id, i);
    }
  });
  for (const id of items) if (!seen.has(id)) problems.push(`laser.parts leaves out laser item ${id}`);
  return problems;
}
