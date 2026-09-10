/* Dated, guarded adoption after the historical facility/orthophoto overlays.
 * The ledger retains every prior point, including unresolved card-derived
 * references. New coordinates come from native pixels, never card distances.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pointInPoly, polyArea } from '../../geobuild/lib.mjs';
import { local, projected } from '../frame.mjs';

const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, root)));
const ledger = read('visbybuild/mapping/tee-alignment-review-2026-09-09.json');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const near = (a, b, tolerance = 0.000001) => point(a) && point(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
const ids = ['tee-63', 'tee-59', 'tee-55', 'tee-51', 'tee-46', 'tee-41'];
const require = (ok, message) => { if (!ok) throw new Error(`Visby tee alignment: ${message}`); };

export function teeAlignmentPixel(source, pixel) {
  const g = source?.geoTransform;
  require(/^[a-f0-9]{64}$/.test(source?.sha256) && Array.isArray(g) && g.length === 6 && g.every(Number.isFinite), 'checked source image and affine required');
  require(Math.abs(g[1] - 0.16) < 1e-10 && Math.abs(g[5] + 0.16) < 1e-10 && g[2] === 0 && g[4] === 0, 'native 0.16 m grid required');
  require(point(pixel) && pixel[0] >= 0 && pixel[1] >= 0 && pixel[0] <= source.width && pixel[1] <= source.height, 'pixel outside source image');
  return [g[0] + pixel[0] * g[1], g[3] + pixel[1] * g[5]];
}

export function applyReviewedTeeAlignment(input, review = ledger) {
  require(input?.groundId === 'visby' && input.horizontalCrs === 'EPSG:3006' && equal(input.axisOrder, ['easting', 'northing']), 'declared EPSG:3006 frame required');
  require(review?.schemaVersion === 1 && review.groundId === 'visby' && review.horizontalCrs === 'EPSG:3006' && equal(review.axisOrder, input.axisOrder), 'review frame differs');
  require(review.holes?.length === 18 && input.holes?.length === 18, 'all eighteen holes required');
  for (const source of review.sourceReviews) {
    const bytes = fs.readFileSync(new URL(source.path, root));
    require(createHash('sha256').update(bytes).digest('hex') === source.sha256, `source review changed: ${source.path}`);
  }
  const output = structuredClone(input);
  for (const [index, entry] of review.holes.entries()) {
    const hole = output.holes[index];
    require(entry.n === index + 1 && hole.n === entry.n, 'unique ordered holes required');
    require(equal(hole.green, entry.baseline.green) && equal(hole.line.slice(1), entry.baseline.line.slice(1)), `H${hole.n} green or later route changed since review`);
    const expectedPads = structuredClone(entry.baseline.pads);
    for (const pad of entry.pads) {
      const ring = pad.pixels.map(pixel => teeAlignmentPixel(entry.sourceImage, pixel));
      require(ring.length >= 4 && near(ring[0], ring.at(-1)) && Math.abs(polyArea(ring.map(local))) > 1, `H${hole.n} invalid physical ring`);
      require(ring.length === pad.ring.length && ring.every((p, i) => near(p, pad.ring[i])), `H${hole.n} ring differs from native pixels`);
      require(ring.every(p => local(p).every(v => Math.abs(v) <= 2048)), `H${hole.n} ring leaves acquired terrain`);
      require(['add', 'replace'].includes(pad.action) && Number.isInteger(pad.index) && pad.index >= 0 && (pad.action === 'add' ? pad.index === expectedPads.length : pad.index < entry.baseline.pads.length), `H${hole.n} stale pad slot`);
      const next = { ring, sourceIds: pad.sourceIds, reviewId: pad.id, interpretationUncertaintyMetres: pad.interpretationUncertaintyMetres };
      if (pad.action === 'add') expectedPads.push(next); else expectedPads[pad.index] = next;
    }
    require(hole.tees.pads.length >= entry.baseline.pads.length && hole.tees.pads.length <= expectedPads.length, `H${hole.n} unexpected physical pad count`);
    hole.tees.pads.forEach((pad, i) => require(equal(pad, entry.baseline.pads[i]) || equal(pad, expectedPads[i]), `H${hole.n} physical pad ${i} changed since review`));
    hole.tees.pads = expectedPads;
    require(entry.references.length === 6 && entry.references.every((r, i) => r.tee === ids[i]), `H${hole.n} six ordered references required`);
    hole.tees.referenceReview = {};
    if (hole.n !== 12) hole.tees.references ??= {};
    for (const ref of entry.references) {
      require(['source-corroborated', 'retained-unresolved'].includes(ref.status) && typeof ref.reason === 'string' && ref.reason.length > 0, `H${hole.n} reference review is incomplete`);
      require(near(projected(ref.targetLocal), ref.target), `H${hole.n} reference frame differs`);
      if (ref.status === 'source-corroborated') {
        require(near(teeAlignmentPixel(entry.sourceImage, ref.pixel), ref.target), `H${hole.n} reference differs from native pixels`);
        const pad = expectedPads[ref.targetPadIndex];
        require(pad && pointInPoly(...local(ref.target), pad.ring.map(local)), `H${hole.n} ${ref.tee} outside its numbered platform`);
      } else require(near(ref.oldLocal, ref.targetLocal, 1e-10), `H${hole.n} unresolved reference must not move`);
      const current = hole.tees.references?.[ref.tee];
      require(current === undefined || near(current, ref.oldAuthored) || near(current, projected(ref.oldLocal)) || near(current, ref.target), `H${hole.n} ${ref.tee} reference changed since review`);
      hole.tees.referenceReview[ref.tee] = { status: ref.status, reason: ref.reason, targetPadIndex: ref.targetPadIndex, review: 'tee-alignment-review-2026-09-09' };
      // H12 retains its separate, explicitly approximate fairway start. Its
      // physical pads and numbered platform identities remain unresolved.
      if (hole.n === 12) require(ref.status === 'retained-unresolved' && near(hole.tees.cameraReference, ref.target), 'H12 unresolved fairway camera changed');
      else hole.tees.references[ref.tee] = ref.target;
    }
    const routeStart = entry.updateRouteStart ? entry.references[0].target : entry.baseline.line[0];
    require(near(hole.line[0], entry.baseline.line[0]) || near(hole.line[0], routeStart), `H${hole.n} route start changed since review`);
    if (entry.updateRouteStart) {
      require(entry.references[0].status === 'source-corroborated' && near(entry.baseline.line[0], projected(entry.references[0].oldLocal), 0.001), `H${hole.n} rear route association differs`);
      hole.line[0] = [...routeStart];
    }
  }
  return output;
}
