/* Reviewed live contract for the Upsala graph frontier and its world.

   Håmö gård is the second ground here carrying two courses, and the first
   where they stand SIDE BY SIDE: Stora banan west, Mellanbanan east, their
   played geometry spanning 1,686 m together. One 2,048 m level-zero window
   holds both, which is why both slugs below are the same record with a
   different name -- one terrain, one bridge, two routings.

   It is also the first ground here whose GPK1 pack was RE-GROUNDED rather than
   vertically bridged, and that is the number worth reading before anything
   else. Every other legacy course keeps its AWS Terrarium heights and carries
   a measured datum step: Veckefjärden's is 20.9924 m with a 0.2392 m median
   absolute deviation, which is a datum. Upsala's measured 6.7514 m came with a
   1.9188 m MAD over a 0-15 m range, because Terrarium's SHAPE over this
   parkland is wrong as well as its datum -- and applying that median still
   left this course's ponds between 2.8 m below their own bed and 5.3 m above
   their own surface. So upsalabuild/build-heightfields.mjs was rewritten to
   cut HF0 and HF1 from the same Lantmäteriet laser DTM as the published tiles,
   sampled THROUGH the bridge declared here, and the pack, the standalone page
   and the v2 ground now carry one field in RH 2000.

   Nothing here is typed from another course. Every DERIVED value is printed by
   the compiler or the publisher that produced the published graph, every
   REVIEWED value has its rationale beside it, and the single MEASURED value
   carries its evidence. */

/* The pack's own frame, as upsalabuild/lib.mjs defines it and the GPK1 header
   reproduces it. INHERITED.

   metresPerLongitude is the header's own rounded 55930.68 rather than the
   unrounded 111320*cos(59.839) the build computes, and deliberately so: this
   is the exact constant upsalabuild/build-heightfields.mjs sampled the DTM
   through, so the runtime bridge and the field under the pack are provably the
   same transform. The two differ by one part in 5.6 million, which is 0.36 mm
   across the property. */
const LEGACY_FRAME = Object.freeze({
  latitude: 59.839,
  longitude: 17.4952,
  metresPerLatitude: 111320,
  metresPerLongitude: 55930.68,
  /* MEASURED, and measured to be nothing. tools/measure-vertical-datum.mjs
     --ground upsala reports a median of 0.0001 m over 61,123 samples of mown
     ground on a 2 m grid across BOTH courses, MAD 0.0239 m, range -1.08 to
     +1.31 m, with greens at -0.0031, fairways at +0.0005 and tees at -0.0046.
     The whole-overlap median, which never entered the number, is -0.0002 m.

     The 0.024 m spread is the 4 m compatibility field read against the 1 m
     window it was cut from, not a disagreement about the datum.

     The registration sweep corroborates the HORIZONTAL bridge at the same
     time: over a +-12 m rigid shift of the legacy sample point, the spread is
     smallest at exactly (0, 0). Before the re-grounding the same sweep ran to
     its own boundary at (-12, -12) for a 0.10 m improvement on a 1.92 m
     spread, which is what a bad vertical field looks like when you ask it a
     horizontal question.

     This is the one course here where copying another ground's offset would
     be LESS wrong than copying this one: 0 is a claim about this pack, not a
     default. */
  verticalDatumOffsetMetres: 0,
});

export const UPSALA_V2_CONFIG = Object.freeze({
  slug: 'upsala',
  groundId: 'upsala',
  label: 'Upsala GK · Lantmäteriet 1 m terräng',
  /* DERIVED — printed by compile-upsala-ground-graph.mjs and carried by every
     published ground manifest for this ground. */
  frameFingerprint: '628d86e3e5bf35bd79500173488c31a31fe101c06d1acad56033d089d2846d86',
  /* DERIVED — the published RING graph's own extent, out to the 16,384 m root. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 631951.5,
    minNorthing: 6627953.5,
    maxEasting: 648335.5,
    maxNorthing: 6644337.5,
  }),
  /* DERIVED — the reviewed 2,048 m metre-resolution window, which is what the
     8 by 8 level-zero frontier actually fills. */
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 639119.5,
    minNorthing: 6635121.5,
    maxEasting: 641167.5,
    maxNorthing: 6637169.5,
  }),
  /* DERIVED — the frame origin the compiler chose, the centre of that window. */
  canonicalOrigin: Object.freeze({
    easting: 640143.5,
    northing: 6636145.5,
    heightRH2000: 13.28,
  }),
  bridgeMode: 'wgs84-legacy-frame',
  legacyFrame: LEGACY_FRAME,
  /* DERIVED — the pack origin projected to SWEREF 99 TM, from the committed
     cs2cs migration's candidateOrigin. The repository's own Krüger series
     reproduces that migration to 1.3 mm over all 12,925 of its coordinates
     (packages/course-geo/migrate-without-proj.mjs prints the comparison). */
  legacyOriginEpsg3006: Object.freeze({
    easting: 639830.271,
    northing: 6636114.391,
  }),
  /* INHERITED — the GPK1 header's own GEO block, so a rebuilt pack that moves
     its frame fails here instead of rendering the terrain in the wrong place. */
  packOriginWgs84: Object.freeze({ latitude: 59.839, longitude: 17.4952 }),
  packMetresPerLongitude: 55930.68,
  packFrame: 'local metres about ORIGIN; north -z, east +x',
  /* REVIEWED — the 8 x 8 level-zero set. */
  expectedTileCount: 64,
  expectedSurfaceTileCount: 0,
  /* REVIEWED — Upsala's played surfaces are still the legacy fusion: OSM's
     surveyed greens and bunkers, the club's banguide read off orthoimagery for
     the routing, and the card's own length. That is not an authoritative
     surveyed intake, so the ground atlas keeps painting them and no v2 surface
     layer is claimed. */
  surfacePolicy: 'legacy-ground-atlas',
  /* DERIVED from the published ground manifest: seven levels, 277 tiles, a
     parent link on every one, reaching 16,384 m. That is what lets the
     streaming ring renderer take over from the frontier and draw ONE terrain
     to the horizon, with no legacy CORE, MID or FAR beneath it. */
  ringGraph: Object.freeze({
    levels: 7,
    tiles: 277,
    rootSpanMetres: 16384,
    tilesByLod: Object.freeze({ 0: 64, 1: 64, 2: 64, 3: 64, 4: 16, 5: 4, 6: 1 }),
  }),
  /* NOT YET MEASURED, for the reason Veckefjärden records: the legacy CORE
     cutout contract can only be read off the runtime CORE grid AFTER main.js
     has smoothed the mown edges. Upsala serves through the ring adapter, which
     builds no legacy CORE at all, so the cut is only reachable on the
     frontier-only fallback; leaving it null keeps the legacy lattice in place
     there rather than punching a hole the v2 mesh might not reach. */
  /* REVIEWED, from a plan the app recomputes and checks at every boot.

     expectedCoreGrid is main.js's own CORE: the played geometry of BOTH
     courses plus the practice greens and the range, grown 150 m and snapped to
     36 m. guardMetres is DERIVED (guardCells x dx). The two point counts are
     DERIVED too -- planV2LegacyCutout recomputes them from the grid and the
     INSCRIBED legacy rectangle, so a changed frame, a changed frontier or a
     changed CORE moves them and the assertion fails rather than agreeing with
     itself.

     These numbers were MEASURED the only way they can be: by booting the app
     against the pre-ring generation of this ground, so the frontier adapter
     rather than the streaming ring renderer served, with a deliberately wrong
     contract in place. The assertion prints what it actually got. That the
     CORE covers 316 x 361 cells and the cut omits 110,050 of its 114,076 base
     points -- 96.5 per cent -- is what a 2,048 m frontier over a 1,260 x
     1,440 m CORE looks like.

     The inscribed rectangle matters here and is not the frontier's footprint:
     the 2,048 m window arrives rotated 2.16 degrees into this pack's frame,
     and a cut that can only omit an axis-aligned rectangle has to stay inside
     the largest one that fits, or it punches a hole the v2 mesh does not
     reach.

     In normal service this contract is not reached at all: the published ring
     graph covers the horizon, so main.js hands the ground to the streaming
     renderer and never builds a legacy CORE. It is the frontier-only
     fallback's contract, and it is measured rather than left null because the
     adapter is constructed before that choice is made. */
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -648,
      x1: 612,
      z0: -756,
      z1: 684,
      nx: 316,
      nz: 361,
    }),
    expectedSkippedBasePoints: 110_050,
    expectedTotalBasePoints: 114_076,
  }),
});

/* Mellanbanan shares this ground, this terrain and this bridge. It has its own
   routing, its own card and its own GPK1 pack -- built by tools/build-nine.mjs
   on the parent's frame and, since the re-grounding, on the parent's RH 2000
   heightfields -- so every frame constant above is the same object rather than
   a second copy that could drift. */
export const UPSALA_MELLANBANAN_V2_CONFIG = Object.freeze({
  ...UPSALA_V2_CONFIG,
  slug: 'upsala-mellanbanan',
  label: 'Upsala GK Mellanbanan · Lantmäteriet 1 m terräng',
});

export const UPSALA_V2_CONFIGS = Object.freeze({
  [UPSALA_V2_CONFIG.slug]: UPSALA_V2_CONFIG,
  [UPSALA_MELLANBANAN_V2_CONFIG.slug]: UPSALA_MELLANBANAN_V2_CONFIG,
});
