/* Every tree the player plants on Tortuna, read from the published ground in
   plain Node: the measured crowns (object layer) and the stand trees drawn
   from the 4 m stand fields, planted by the runtime's OWN planner
   (planV2Vegetation) so the positions here are the positions on screen, not
   a second implementation of them. Tortuna is grid-authored, so the frame
   bridge is a pure translation about E597400.5 N6614899.5.

   A playing surface that is redrawn after the vegetation was published has to
   stay clear of these trees: the runtime plants every published record as it
   stands and never asks what surface is under it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { decodeStandField } from '../../packages/course-v2/stand-field.mjs';
import { planV2Vegetation, createFrameMapper } from '../../apps/golf/src/engine/v2-vegetation.mjs';
import { TORTUNA_FRAME } from '../frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), 'utf8'));

/** The published tree population in local metres: [{ x, z, radius, height, kind }]. */
export function loadPublishedTrees({ slug = 'tortuna', lowQuality = false } = {}) {
  const entry = readJson('courses/v2-index.json').courses.find(course => course.slug === slug);
  if (!entry?.manifest?.url) throw new Error(`${slug}: no published v2 course manifest`);
  const course = readJson(entry.manifest.url);
  const ground = readJson(course.groundManifest.url);
  const origin = ground.frame.origin;
  if (origin.easting !== TORTUNA_FRAME.easting || origin.northing !== TORTUNA_FRAME.northing) {
    throw new Error(`${slug}: ground origin E${origin.easting} N${origin.northing} is not the model frame`);
  }
  const tiles = [];
  for (const tile of ground.tiles) {
    if (tile.lod !== 0 || !(tile.layers?.objects || tile.layers?.stands)) continue;
    const entry = { id: tile.id, bounds: tile.bounds, objects: null, stands: null };
    if (tile.layers.objects) {
      const chunk = readChunk(fs.readFileSync(path.join(PUBLIC, tile.layers.objects.url)));
      const content = JSON.parse(Buffer.from(chunk.payload).toString('utf8'));
      if (!Array.isArray(content.records)) throw new Error(`${tile.id}: object chunk carries no records`);
      entry.objects = content.records;
    }
    if (tile.layers.stands) {
      const chunk = readChunk(fs.readFileSync(path.join(PUBLIC, tile.layers.stands.url)));
      entry.stands = decodeStandField(chunk.payload, chunk.header.standField);
    }
    tiles.push(entry);
  }
  tiles.sort((a, b) => a.id.localeCompare(b.id));
  /* the identity bridge: grid metres about the origin ARE local metres */
  const bridge = { translateX: 0, translateZ: 0, toLegacy: (x, z) => [x, z], toGrid: (x, z) => [x, z] };
  const mapper = createFrameMapper({ bridge, frameOrigin: origin });
  const plan = planV2Vegetation({ tiles }, { mapper, groundHeightAt: () => 0, lowQuality });
  return {
    groundManifest: course.groundManifest.url,
    stats: plan.stats,
    trees: plan.instances.map(tree => ({ x: tree.x, z: tree.z, radius: tree.radius, height: tree.height, kind: tree.kind })),
  };
}
