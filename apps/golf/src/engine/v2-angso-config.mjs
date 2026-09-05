/* Reviewed live contract for the Ängsö graph frontier and its world.

   Ängsö is the FOURTH real v2 configuration and the one that costs the
   frontier its square. The course runs 2,167 m north to south along the
   peninsula at Stora Bodarna and only 894 m across; 2,048 m of 1 m ground does
   not reach the 12th to the 16th, so its level zero is sixteen tiles per side
   rather than eight -- 256 tiles, four times Veckefjärden's. That is a
   consequence of the property's shape, not a quality setting.

   Its GPK1 pack is a legacy TRUE-north flat-earth pack about 59.57390 N,
   16.87100 E, so the bridge is Veckefjärden's kind: meridian convergence, the
   frame's own metre, and a MEASURED vertical datum step. Nothing here is typed
   from another course. Every DERIVED value is printed by the compiler that
   produced the published graph, every REVIEWED value has its rationale beside
   it, and the single MEASURED value carries its evidence. */

/* The pack's own frame, read from angsobuild/lib.mjs and reproduced by the
   GPK1 header (origin 59.5739/16.8710, mPerLon 56375.41). INHERITED, except
   metresPerLongitude which is 111320*cos(latitude) and is therefore DERIVED. */
const LEGACY_FRAME = Object.freeze({
  latitude: 59.57390,
  longitude: 16.87100,
  metresPerLatitude: 111320,
  metresPerLongitude: 111320 * Math.cos(59.57390 * Math.PI / 180),
  /* MEASURED, and measured to be nothing -- because the pack was RE-GROUNDED
     (2026-09-05). Ängsö's GPK1 heights used to be AWS Terrarium on an
     unrecorded datum, and tools/measure-vertical-datum.mjs put them a median
     9.1166 m above the laser DTM with a MAD of 1.8463 m over 41,636 mown
     samples -- eight times Veckefjärden's 0.2392 m, and not registration (the
     best rigid shift of the sample point, 12 m south-west, bought 0.1676 m).
     Terrarium's SHAPE over this low-relief shore was wrong as well as its
     datum, and the pack's water rings disagreed with the DTM by -3.66 to
     +6.10 m, so no single number could carry them. angsobuild/build-heightfields.mjs
     now cuts HF0 and HF1 from the published laser ring graph, sampled through
     this same derived bridge, and the re-run measurement is the proof: median
     0.0008 m, MAD 0.0221 m, registration sweep best at exactly (0, 0). The
     0.02 m spread is the 4 m compatibility field read against the 1 m window
     it was cut from, not a disagreement about the datum.

     The corroboration that never entered the number still holds, the other
     way round: the pack now carries Mälaren's western bay at the DTM's own
     laser-flat 0.84 m (sd 0.12 m over 38,816 interior samples), where the
     Terrarium pack had it at 9.76 m.

     Veckefjärden's number is 20.9924 m and Puttom's 23.6263 m. Copying either
     here would put the ground twenty-one or twenty-four metres in the air:
     0 is a claim about THIS pack, not a default. */
  verticalDatumOffsetMetres: 0,
});

export const ANGSO_V2_CONFIG = Object.freeze({
  slug: 'angso',
  groundId: 'angso',
  label: 'Ängsö Golfklubb · Lantmäteriet 1 m terräng',
  /* DERIVED — printed by compile-angso-ground-graph.mjs and carried by every
     published ground manifest for this ground. It does not change when the
     rings are republished, because it is a statement about the frame. */
  frameFingerprint: 'bfc6a0f04badb8e31cd874bc28e58ed679dd591164d8cb9a96ca9a96209b9318',
  /* DERIVED — the published graph's own extent, which is the RING root: seven
     nested levels reaching 16,384 m, not the course window. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 597473.5,
    minNorthing: 6597529.5,
    maxEasting: 613857.5,
    maxNorthing: 6613913.5,
  }),
  /* REVIEWED — the sub-rectangle of level zero the frontier PRELOADS, which
     on this ground is not the whole metre window.

     Ängsö's metre level had to be 4,096 m square because the course is
     2,167 m long and the ring topology wants a square; preloading all 256 of
     those tiles is 16,845,330 encoded bytes, 200.8% of the 8 MiB a visitor
     may download before the first frame. Columns 4-11 and rows 2-13 -- eight
     tiles by twelve, 2,048 x 3,072 m -- are 96 tiles and 6,453,395 bytes,
     76.9% of that budget, measured from the published manifest rather than
     estimated. They keep 577 m of metre ground east and west of the played
     geometry and 452 m north and south, which is where the Mälaren shore,
     the reserve edge and the near scenery are.

     Beyond this rectangle the ground is not missing: the streaming ring
     renderer draws every published lod-0 tile, and construction heights fall
     through to lod 1, which on this ground spans the SAME 4,096 m at 2 m --
     finer than the 4 m legacy field it replaces. */
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 604641.5,
    minNorthing: 6604185.5,
    maxEasting: 606689.5,
    maxNorthing: 6607257.5,
  }),
  /* DERIVED — the frame origin the compiler chose, the centre of that window.
     It lands 0.4 m from the played centroid, which is what centring the window
     on the course rather than on the aligner's floor buys. */
  canonicalOrigin: Object.freeze({
    easting: 605665.5,
    northing: 6605721.5,
    heightRH2000: -1.75,
  }),
  bridgeMode: 'wgs84-legacy-frame',
  legacyFrame: LEGACY_FRAME,
  /* DERIVED — the pack origin projected to SWEREF 99 TM, from the committed
     migration's candidateOrigin (PROJ cs2cs through the pinned geoid grid). */
  legacyOriginEpsg3006: Object.freeze({
    easting: 605689.962,
    northing: 6605447.157,
  }),
  /* INHERITED — the GPK1 header's own GEO block, so a rebuilt pack that moves
     its frame fails here instead of rendering the terrain in the wrong place. */
  packOriginWgs84: Object.freeze({ latitude: 59.57390, longitude: 16.87100 }),
  packMetresPerLongitude: 56375.41,
  packFrame: 'local metres about ORIGIN; north -z, east +x',
  /* REVIEWED — the 8 by 12 sub-rectangle named above, not the 256-tile
     level-zero set. */
  expectedTileCount: 96,
  expectedSurfaceTileCount: 0,
  /* REVIEWED — Ängsö's played surfaces are still the legacy traces: four of
     the eighteen holes carry an OSM hole way and the rest are satellite
     traces slid to their card length, with no orthophoto window read and no
     survey. The ground atlas keeps painting them and no v2 surface layer is
     claimed. */
  surfacePolicy: 'legacy-ground-atlas',
  /* DERIVED from the published ground manifest: seven levels, 469 tiles, a
     parent link on every one but the root, reaching 16,384 m. Level 1 spans
     the SAME 4,096 m as level 0 rather than twice it, because level 0 is
     already sixteen tiles wide; every level-1 tile still has exactly four
     level-0 children, which is the rule that matters. */
  ringGraph: Object.freeze({
    levels: 7,
    tiles: 469,
    rootSpanMetres: 16384,
    tilesByLod: Object.freeze({ 0: 256, 1: 64, 2: 64, 3: 64, 4: 16, 5: 4, 6: 1 }),
  }),
  /* NOT MEASURED, and explicitly null rather than guessed. The legacy CORE
     cutout contract can only be read off the runtime CORE grid AFTER main.js
     has smoothed the mown edges, and Ängsö is served by the streaming RING
     adapter, which builds no legacy CORE at all -- the graph covers the
     horizon, so there is nothing to cut a hole in. Measured on the boot this
     config was written against: renderer kind `graph`, 469 tiles over seven
     levels, one draw call, zero failed tiles, mesh resolution 1 m.

     Null is the honest value. It is not a gap to be filled with a number
     from another course: if this ground is ever served by the fixed frontier
     instead, the adapter refuses to cut rather than cutting to a contract
     nobody measured. */
  legacyCoreCutout: null,
});

export const ANGSO_V2_CONFIGS = Object.freeze({
  [ANGSO_V2_CONFIG.slug]: ANGSO_V2_CONFIG,
});
