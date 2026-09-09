import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyReviewedOrthophoto } from './reviewed-orthophoto.mjs';
import { verifyChunkAsset } from '../../packages/course-v2/chunk-node.mjs';
import { sampleTerrainTile } from '../../packages/course-v2/terrain-pyramid.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = path.join(root,'apps/golf/public');
const read = relative => JSON.parse(fs.readFileSync(path.join(pub,relative),'utf8'));

export function applyCourseReview(baseline, review) {
  const actual = createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  if (actual !== review.baseModelSha256) throw new Error('Puttom baseline changed; re-review indexed source replacements before rebuilding');
  const model = applyReviewedOrthophoto(baseline,review);
  model.infra.preserveMappedBoundaries = review.preserveMappedBoundaries === true;
  const entry = read('courses/v2-index.json').courses.find(c=>c.slug==='puttom');
  const course = read(entry.manifest.url), ground = read(course.groundManifest.url);
  const decoded = new Map();
  const height = point => {
    const [e,n] = latLonToSweref99Tm(model.origin.lat-point[1]/model.mPerLat,model.origin.lon+point[0]/model.mPerLon);
    const tile = ground.tiles.find(t=>t.lod===0&&e>=t.bounds.minEasting&&e<=t.bounds.maxEasting&&n>=t.bounds.minNorthing&&n<=t.bounds.maxNorthing);
    if (!tile) throw new Error('Reviewed point leaves the native 1 m terrain');
    if (!decoded.has(tile.id)) {
      const chunk=verifyChunkAsset(tile.layers.terrain,fs.readFileSync(path.join(pub,tile.layers.terrain.url)));
      decoded.set(tile.id,{bounds:tile.bounds,grid:chunk.header.grid,payload:chunk.payload});
    }
    const rh2000=sampleTerrainTile(decoded.get(tile.id),e,n);
    if (!Number.isFinite(rh2000)) throw new Error('Reviewed point has no finite source terrain height');
    return rh2000+PUTTOM_PREVIEW_CONFIG.legacyFrame.verticalDatumOffsetMetres;
  };
  const round=x=>Math.round(x*10)/10;
  for(const h of model.holes) {
    // Card-distance camera references cannot establish extra physical turf.
    // Keep mapped platforms and stop creating rectangles at unresolved cameras.
    h.tees.inferPads=false;
    const tee=height(h.line[0]),green=height(h.green.c);
    h.elev={tee:round(tee),green:round(green),rise:round(green-tee)};
    h.elevSrc='laser';
  }
  model.orthophotoReview.summary=review.summary;
  model.orthophotoReview.terrainManifest=course.groundManifest;
  return model;
}
