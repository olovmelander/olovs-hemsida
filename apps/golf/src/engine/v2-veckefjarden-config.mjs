/* Reviewed live contract for the Veckefjärden graph frontier and its world.

   Veckefjärden is the THIRD real v2 configuration and it is the one that makes
   the bridge a discriminated choice rather than a set of numbers. Puttom and
   Veckefjärden are both legacy GPK1 packs authored in a TRUE-north flat-earth
   frame about their own origin, so a bridge into the EPSG:3006 grid has to
   carry the meridian convergence, the frame's own metre, and a measured
   vertical datum step. Ribbingsfors' pack was authored directly in the grid
   frame on RH 2000, so its whole bridge collapses to the identity. Modelling
   the second as "the first with different numbers" would invite someone to
   invent a datum offset for a course that does not have one; modelling the
   first as the second would silently drop a 3.28 degree rotation that is
   82.6 m at the far corner of this property.

   Nothing here is typed from another course. Every DERIVED value is printed by
   the compiler that produced the published graph, every REVIEWED value has its
   rationale beside it, and the single MEASURED value carries its evidence. */

/* The pack's own frame, read from geobuild/lib.mjs and reproduced by the GPK1
   header (origin 63.2845/18.6735, mPerLon 50045.09). INHERITED, except
   metresPerLongitude which is 111320*cos(latitude) and is therefore DERIVED. */
const LEGACY_FRAME = Object.freeze({
  latitude: 63.28450,
  longitude: 18.67350,
  metresPerLatitude: 111320,
  metresPerLongitude: 111320 * Math.cos(63.28450 * Math.PI / 180),
  /* MEASURED. Veckefjärden's GPK1 heights are AWS Terrarium on an unrecorded
     datum; the v2 ground is Lantmäteriet's laser DTM on RH 2000. This is the
     median difference over 35,533 samples on a 2 m grid inside the greens,
     fairways and tee pads of BOTH courses, with every sample inside a water
     ring discarded: MAD 0.2392 m, p05 20.46, p95 21.64. Per class the medians
     run 20.75 m (championship greens, n=2115) to 21.35 m (korthålsbanan tees,
     n=11), with the championship fairways supplying 28,842 of the samples at
     20.97 — the 0.6 m class spread is built-up green complexes reading
     differently in a coarse global model, not noise.

     Two independent things corroborate it. Veckefjärden the lake carries a
     legacy level of 21.59 m and the DTM reads its surface as a laser-flat
     0.280 m RH 2000 (also the Z on all 1,339 vertices of Lantmäteriet's own
     break-geometry polygon for it), a difference of 21.31 m. And CLAUDE.md's
     "Åsberget's 241 m summit" is the same bias: the DTM reads 218.5 m as the
     highest ground within 2.5 km of the mast, and 218.5 + 20.9 is 239.

     Puttom's number is 23.6263 m. Copying it here would be a 2.6 m error. */
  verticalDatumOffsetMetres: 20.9924,
});

export const VECKEFJARDEN_V2_CONFIG = Object.freeze({
  slug: 'veckefjarden',
  groundId: 'veckefjarden',
  label: 'Veckefjärdens GC · Lantmäteriet 1 m terräng',
  /* DERIVED — printed by compile-veckefjarden-ground-graph.mjs and carried by
     every published ground manifest for this ground. */
  frameFingerprint: '2e56c2fd7f8cbb04b684fb0222d2a0890201ccb23f635d068302be0569760fa6',
  /* DERIVED — the published RING graph's own extent, out to the 16,384 m root.
     This is what the ground manifest declares and what the frontier loader
     checks the graph against. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 675717.5,
    minNorthing: 7014810.5,
    maxEasting: 692101.5,
    maxNorthing: 7031194.5,
  }),
  /* DERIVED — the reviewed 2048 m metre-resolution window, which is what the
     8 by 8 level-zero frontier actually fills. Veckefjärden is the first ground
     where these two rectangles differ: a ground with no world rings has one
     extent and omits this field. */
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 682885.5,
    minNorthing: 7021978.5,
    maxEasting: 684933.5,
    maxNorthing: 7024026.5,
  }),
  /* DERIVED — the frame origin the compiler chose, the centre of that window. */
  canonicalOrigin: Object.freeze({
    easting: 683909.5,
    northing: 7023002.5,
    heightRH2000: 0.16,
  }),
  bridgeMode: 'wgs84-legacy-frame',
  legacyFrame: LEGACY_FRAME,
  /* DERIVED — the pack origin projected to SWEREF 99 TM. Reproduced two ways:
     PROJ cs2cs, in the committed migration's candidateOrigin, and the repo's
     own Krüger series in packages/course-geo/chmv2/projection.mjs. */
  legacyOriginEpsg3006: Object.freeze({
    easting: 684183.801986,
    northing: 7022564.696685,
  }),
  /* INHERITED — the GPK1 header's own GEO block, so a rebuilt pack that moves
     its frame fails here instead of rendering the terrain 43 m off. */
  packOriginWgs84: Object.freeze({ latitude: 63.28450, longitude: 18.67350 }),
  packMetresPerLongitude: 50045.09,
  packFrame: 'north=-z, east=+x, bearing=atan2(dx,-dz), right=(-cos b, sin b)',
  /* REVIEWED — the 8 x 8 level-zero set. */
  expectedTileCount: 64,
  expectedSurfaceTileCount: 0,
  /* REVIEWED — Veckefjärden's played surfaces are still the legacy traces
     (OSM outlines, the club's hole plans and the GPS survey), not an
     authoritative surveyed intake, so the ground atlas keeps painting them and
     no v2 surface layer is claimed. */
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
  /* REVIEWED, from a plan the app recomputes and checks at every boot.

     expectedCoreGrid is main.js's own CORE: the played geometry plus the
     practice greens and the range, grown 150 m and snapped to 36 m. guardMetres
     is DERIVED (guardCells x dx). The two point counts are DERIVED too --
     planV2LegacyCutout recomputes them from the grid and the INSCRIBED legacy
     rectangle, so a changed frame, a changed frontier or a changed CORE moves
     them and the assertion fails rather than agreeing with itself.

     The inscribed rectangle matters here and is not the frontier's footprint:
     the 2,048 m window arrives rotated 3.28 degrees into this pack's frame, and
     a cut that can only omit an axis-aligned rectangle has to stay inside the
     largest one that fits, or it punches a hole the v2 mesh does not reach.
     For Veckefjärden that costs about 83 m on the west edge. */
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -900,
      x1: 432,
      z0: -1332,
      z1: 432,
      nx: 334,
      nz: 442,
    }),
    expectedSkippedBasePoints: 143_008,
    expectedTotalBasePoints: 147_628,
  }),
});

/* The korthålsbanan shares this ground, this terrain and this bridge. It has
   its own routing, its own card and its own GPK1 pack, but its pack was built
   by tools/build-nine.mjs on the parent's frame, so every frame constant above
   is the same object rather than a second copy that could drift. */
export const VECKEFJARDEN_KORTHALSBANAN_V2_CONFIG = Object.freeze({
  ...VECKEFJARDEN_V2_CONFIG,
  slug: 'veckefjarden-korthalsbanan',
  label: 'Veckefjärdens korthålsbana · Lantmäteriet 1 m terräng',
  /* MEASURED — the korthålsbana's OWN legacy CORE, not the parent's. Its playB
     carries the parent's green rings and range through scenery but not the
     parent's westmost fairway lines, so its CORE starts 72 m east of the
     parent's (x0 -828 against -900) and the inherited cutout contract was
     wrong on exactly the path that asserts it: the ring world serves on real
     GPUs and never applies the contract, but wherever the rings cannot serve
     the FIXED-FRONTIER fallback asserted the parent's 334x442/143008 and
     rolled the terrain back to GPK1 -- with the freshly planted LiDAR
     vegetation then standing on Terrarium ground (baseMismatch p95 12.76 m,
     the forest-canopy signature). Numbers read the runbook way: boot with the
     wrong contract and copy what the assertion prints (2026-09-04, WebGL2;
     the cutout is geometry, not backend). */
  legacyCoreCutout: Object.freeze({
    ...VECKEFJARDEN_V2_CONFIG.legacyCoreCutout,
    expectedCoreGrid: Object.freeze({
      ...VECKEFJARDEN_V2_CONFIG.legacyCoreCutout.expectedCoreGrid,
      x0: -828,
      nx: 316,
    }),
    expectedSkippedBasePoints: 135160,
    expectedTotalBasePoints: 139672,
  }),
});

export const VECKEFJARDEN_V2_CONFIGS = Object.freeze({
  [VECKEFJARDEN_V2_CONFIG.slug]: VECKEFJARDEN_V2_CONFIG,
  [VECKEFJARDEN_KORTHALSBANAN_V2_CONFIG.slug]: VECKEFJARDEN_KORTHALSBANAN_V2_CONFIG,
});
