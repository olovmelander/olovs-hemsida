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

/* Every lake the simulator draws out to its ground's own shore, read by the same rule
   (map-shores.mjs): one sheet of pictures and where each lake is on it. Without them
   the lakes stop at their outlines, as they did. */
export async function loadShores(record, fetchFile) {
  if (!record?.shores) return null;
  const [picture, lakes] = await Promise.all([
    fetchFile(record.shores.picture.file).then(decodePicture),
    fetchFile(record.shores.lakes.file).then(bytes => JSON.parse(new TextDecoder().decode(bytes))),
  ]);
  return { picture, lakes };
}

function decodePicture(bytes) {
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none' });
}

export async function loadWaterPicture(record, fetchFile) {
  if (!record) return null;
  const water = await decodePicture(await fetchFile(record.water.file));
  return { water, x0: record.x0, z0: record.z0, spacing: record.spacing };
}

export async function loadForestPicture(record, fetchFile) {
  if (!record) return null;
  const forestBytes = await fetchFile(record.forest.file);
  return { forest: await decodePicture(forestBytes), forestBytes, x0: record.x0, z0: record.z0, spacing: record.spacing };
}
