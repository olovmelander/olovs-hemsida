/* Per-course bespoke scenery.

   Almost everything in this engine is data: the same code draws six courses
   because six packs describe them. A handful of things are not, and cannot
   honestly be -- Åsmasten's guy fans, the octagon and copper spire of
   Själevads kyrka, the 1649 chapel at Norrfällsviken. Those are buildings
   drawn from photographs at surveyed coordinates, and a generic extruder
   would make all three into the same box.

   So they live here, one module per course, loaded lazily by slug: a course
   without a module pays nothing, and adding course #7 does not mean reading
   another club's landmarks to find the guard that skips them. Each module
   exports build(ctx) and returns how many objects it added; ctx carries the
   engine's own drawing helpers, so the moved code is the code that ran
   before, unchanged.                                                        */

/* Only Veckefjärden's are extracted so far. Norrfällsvikens kapell and its
   moored boats still sit inline in main.js behind the guards they were written
   with -- they render correctly there, and moving working code for symmetry is
   how a refactor turns into a regression. They come across when something asks
   them to, and the mechanism below is what they will come across into.       */
const REGISTRY = {
  veckefjarden: () => import('./veckefjarden.js'),
};

/* Loaded once, early: a course module may supply BOTH a species rule (which the
   planter needs, and the planter runs long before any landmark) and a build()
   for its landmarks. Cached so the two callers share one import. */
let cached = { slug: null, mod: null };
export async function loadSceneryModule(slug) {
  if (cached.slug === slug) return cached.mod;
  const load = REGISTRY[slug];
  cached = { slug, mod: load ? await load() : null };
  return cached.mod;
}

export async function buildScenery(slug, ctx) {
  const mod = await loadSceneryModule(slug);
  return (mod && mod.build) ? (mod.build(ctx) || 0) : 0;
}
