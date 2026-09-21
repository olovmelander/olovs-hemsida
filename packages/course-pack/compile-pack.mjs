/* Pure compatibility compiler shared by the historic CLI and staged production.
 * Key order and compression remain the existing GPK1 byte contract. */
import zlib from 'node:zlib';
import { writePack } from './lib.mjs';
import { runtimeScenery } from './runtime-scenery.mjs';
import { runtimeWater } from './runtime-water.mjs';

export function compilePack({ model, heightfields: hf, cover = null, slug }) {
const OLD = model.lakeLevel !== undefined;
/* -- verbatim from the builds' embed.mjs; do not "improve" the key order -------- */
const vec = {
  holes: model.holes.map(h => ({
    n: h.n, par: h.par, idx: h.idx, t: h.t,
    line: h.line, lineLen: h.lineLen, pin: h.pin,
    green: { ring: h.green.ring, c: h.green.c },
    fairway: { rings: h.fairway.rings },
    tees: { ...(h.tees.inferPads === false ? { inferPads: false } : {}), ...(h.tees.status ? { status: h.tees.status } : {}), ...(h.tees.markerLayout ? { markerLayout: h.tees.markerLayout } : {}), ...(h.tees.markerPlacement ? { markerPlacement: h.tees.markerPlacement } : {}), pads: h.tees.pads.map(p => ({ ring: p.ring, ...(p.preserveTerrain ? { preserveTerrain: true } : {}), ...(p.reviewId !== undefined && h.tees.marks.some(m => m.sourcePadId === p.reviewId) ? { reviewId: p.reviewId } : {}), ...(p.id !== undefined && h.tees.marks.some(m => m.sourcePadId === p.id) ? { id: p.id } : {}) })), marks: h.tees.marks.map(m => ({ c: m.c, b: m.b, m: m.m, ...(m.referenceSurfaceKind ? { referenceSurfaceKind: m.referenceSurfaceKind } : {}), ...(m.referenceSurfaceRing ? { referenceSurfaceRing: m.referenceSurfaceRing } : {}), ...(m.orthophotoReference ? { orthophotoReference: m.orthophotoReference } : {}), ...(m.displayC !== undefined ? { displayC: m.displayC } : {}), ...(m.sourcePadId !== undefined ? { sourcePadId: m.sourcePadId } : {}) })) },
    bunkers: h.bunkers.map(b => ({ ring: b.ring, ...(b.innerRings?.length ? { innerRings: b.innerRings } : {}) })),
    elev: h.elev, tiers: h.tiers,
    name: h.name, note: h.note, shape: h.shape,
    ...(OLD ? { sp: h.sp } : {}),
  })),
  water: model.water.map(runtimeWater),
  /* the older schema always carried marking; a newer build carries it once its
     reconcile has a rule set to place it from (Ängsö's Lokala regler, Johannesberg's
     hole plans) */
  marking: (model.marking || []).map(m => ({ c: m.color, pts: m.pts, ...(m.reviewId ? { id: m.id, reviewId: m.reviewId, hole: m.hole, boundaryStatus: m.boundaryStatus, corridorUncertaintyM: m.corridorUncertaintyM, postPlacementKind: m.postPlacementKind, physicalPostPositionsObserved: m.physicalPostPositionsObserved } : {}) })),
  ...(model.outOfBounds ? { outOfBounds: model.outOfBounds } : {}),
  streams: model.streams.map(s => ({ line: s.line, w: s.w, ...(model.infra.bridgePlacement === 'mapped-only' ? Object.fromEntries(['id', 'kind', 'tunnel', 'covered', 'layer', 'width', ...(s.contextOnly ? ['widthMetres', 'widthStatus', 'sourceId', 'waterSurfaceStatus', 'contextOnly'] : [])].filter(k => s[k] !== undefined).map(k => [k, s[k]])) : {}) })),
  veg: model.vegetation,
  cover,
  infra: model.infra,
  /* the newer builds may carry traced surroundings too (Puttom: the works yard) */
  surround: model.surround ?? { clearfells: [], yard: null, hayfields: null, shallows: [] },
  scenery: runtimeScenery(model),
};
/* ------------------------------------------------------------------------------- */

const raw = obj => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 });
const b64ToRaw = s => Buffer.from(s, 'base64');

return writePack({
  slug,
  /* seaTintBandMetres is how far ABOVE seaLevel the vista still counts a
     sample as water, and it is a course quantity because a constant cannot
     serve both kinds of coast. Where a bare-earth DTM carries the sea as a
     flattened surface, that surface can read a few centimetres ABOVE the
     level the model declares -- at Visby it reads 0.240 against a declared
     0.230, so a band of zero finds 8.8 ha of a 6,539 ha sea. A course that
     does not declare one keeps the engine's own 0.5 m, so nothing already
     published moves. */
  geo: { origin: model.origin, mPerLon: model.mPerLon,
         seaLevel: OLD ? model.lakeLevel : model.seaLevel, frame: model.frame,
         ...(model.seaTintBandMetres === undefined ? {} : { seaTintBandMetres: model.seaTintBandMetres }) },
  hf0: { x0: hf.hf0.x0, z0: hf.hf0.z0, dx: hf.hf0.dx, nx: hf.hf0.nx, nz: hf.hf0.nz, h0: hf.hf0.h0, hs: hf.hf0.hs },
  hf1: { x0: hf.hf1.x0, z0: hf.hf1.z0, dx: hf.hf1.dx, nx: hf.hf1.nx, nz: hf.hf1.nz, h0: hf.hf1.h0, hs: hf.hf1.hs },
  streams: [b64ToRaw(hf.hf0.b64), b64ToRaw(hf.hf1.b64), raw(vec)],
});

}
