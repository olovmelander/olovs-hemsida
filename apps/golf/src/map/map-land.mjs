/* What covers a ground past its outlines: lakes beyond the extract's box, the open
   sea, and forest from the laser and the land cover. One small picture of each per
   ground, baked by tools/bake-map-land.mjs with the simulator's own detector. */
import catalogue from '../../public/models/map-land.json';

export const landRecord = groundId => catalogue.grounds[groundId] ?? null;

/* An outline that closes across land, which the ground's water picture replaces.
   Known by its first point, so a republished pack simply stops matching. */
export function outlineOverLand(groundId, ring) {
  return (landRecord(groundId)?.dry ?? []).some(({ points, first }) => ring.length === points && ring[0][0] === first[0] && ring[0][1] === first[1]);
}

/* Without them the map still opens, on its outlines and land cover. */
export async function loadLandPictures(record, fetchFile) {
  if (!record) return null;
  const picture = async ({ file }) => createImageBitmap(new Blob([await fetchFile(file)], { type: 'image/png' }), { colorSpaceConversion: 'none' });
  try {
    const [water, forest] = await Promise.all([picture(record.water), picture(record.forest)]);
    return { water, forest, x0: record.x0, z0: record.z0, spacing: record.spacing };
  } catch (error) {
    console.warn('map land:', error.message);
    return null;
  }
}
