/* Reviewed live contract for the Norrfällsviken graph frontier and its world.

   Norrfällsviken is the first SEASIDE v2 ground here, and the first whose
   finest window exists to reach ground the golf course does not stand on: the
   chapel of 1649, the fishing harbour and the Gulf of Bothnia itself. Sixteen
   level-zero tiles rather than eight is that decision, and
   packages/course-v2/norrfallsviken-ground-graph.mjs carries the arithmetic
   that makes it minimal rather than generous.

   The bridge is Veckefjärden's kind, not Ribbingsfors': this pack was authored
   in a TRUE-north flat-earth frame about its own origin, so the bridge carries
   the meridian convergence (3.148 degrees here), the frame's own metre, and a
   measured vertical datum step. Modelling it as an identity would put the
   terrain over 100 m out at the far corner of this window.

   Nothing here is typed from another course. Every DERIVED value is printed by
   the compiler that produced the published graph, every REVIEWED value has its
   rationale beside it, and the single MEASURED value carries its evidence. */

/* The pack's own frame, read from nvgkbuild/lib.mjs and reproduced by the GPK1
   header (origin 62.9825/18.5325, mPerLon 50568.51). INHERITED, except
   metresPerLongitude which is 111320*cos(latitude) -- 50568.5150 m, the value
   the header rounds to two decimals -- and is therefore DERIVED. */
const LEGACY_FRAME = Object.freeze({
  latitude: 62.98250,
  longitude: 18.53250,
  metresPerLatitude: 111320,
  metresPerLongitude: 111320 * Math.cos(62.98250 * Math.PI / 180),
  /* MEASURED. Norrfällsviken's GPK1 heights are AWS Terrarium on an unrecorded
     datum; the v2 ground is Lantmäteriet's laser DTM on RH 2000. This is the
     median difference over 31,829 samples on a 2 m grid inside the greens,
     fairways and tee pads, with every sample inside a water ring discarded:
     MAD 0.4616 m, p05 19.19, p95 24.90. Per class the medians run 20.3212 m
     (fairways, n=28,761) to 20.6875 m (greens, n=2,109), with tees at 20.4748
     (n=959) -- a 0.37 m class spread, the same built-up-green-complex effect
     Veckefjärden records at 0.6 m.

     Two things were checked and are worth writing down because one of them is
     a TRAP. The apparent agreement of the two models at the shoreline proves
     NOTHING here: nvgkbuild/build-heightfields.mjs pins seaLevel to 0 by fiat
     ("Terrarium mixes land pixels", its own comment says), so a sea-level
     comparison is circular and was discarded. What does corroborate the number
     is its SHAPE. Measured over all land in the window instead of the played
     ground, the median is 23.99 m, and it climbs with elevation from 21.3 m on
     the shore to 26.4 m at 50-60 m -- that is Terrarium carrying CANOPY where
     the 1 m DTM is bare earth, exactly the residual Puttom's bridge test
     reports rather than gates. The mown, open ground is the only surface where
     the two products describe the same thing, and it is what the median uses.

     The geoid says something different and is recorded so nobody re-derives
     it: Lantmäteriet's own checksummed SWEN17_RH2000 grid gives 23.3480 m of
     separation at this origin. The offset is not that, so Terrarium is not
     simply ellipsoidal here. It is a measurement, not a formula.

     Veckefjärden's number is 20.9924 m, 34 km north-east on the same coast,
     and Puttom's is 23.6263 m. Copying Puttom's here would be a 3.3 m error. */
  verticalDatumOffsetMetres: 20.3432,
});

export const NORRFALLSVIKEN_V2_CONFIG = Object.freeze({
  slug: 'norrfallsviken',
  groundId: 'norrfallsviken',
  label: 'Norrfällsvikens GK · Lantmäteriet 1 m terräng',
  /* DERIVED — printed by compile-norrfallsviken-ground-graph.mjs and carried
     by every published ground manifest for this ground. */
  frameFingerprint: 'f3c5d5b875eb5d4b75726bdaf1a0ba30583a7227dcd2ab854bb469040d3f758a',
  /* DERIVED — the published RING graph's own extent, out to the 16,384 m root. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 670771.5,
    minNorthing: 6979759.5,
    maxEasting: 687155.5,
    maxNorthing: 6996143.5,
  }),
  /* REVIEWED — the FRONTIER, which is not the whole 4,096 m window.

     The frontier is the level-zero set the app verifies and installs EAGERLY at
     boot; the rest of level zero streams in behind it through the ring runtime,
     at the same 1 m. It is therefore bounded by a byte budget the loader
     enforces (8 MiB), and all 256 tiles of this window are 13.64 MB — so the
     whole window cannot be the frontier, and asking for it fails closed rather
     than loading slowly. That is what happened on the first boot here.

     This is the widest whole-tile rectangle that fits: columns 2-9 and rows
     2-13 of the lattice, 8 by 12 tiles, 2,048 x 3,072 m, 7.13 MB. Nine columns
     is 8.17 MB and over. It clears the played ground by 119 m and holds the
     chapel with 946 m to spare; the harbour's westernmost pier tip sits 47 m
     inside the west edge, which is a boot-set boundary and not a zone-A claim
     -- the harbour clears the WINDOW by 559 m, and its tiles stream in at 1 m
     like every other tile outside this rectangle.

     Ängsö's frontier is also 8 by 12 for a differently shaped course. That is
     not copied: it is what an 8 MiB budget buys in 256 m tiles of Swedish
     laser terrain, arrived at independently here. */
  expectedFrontierBoundsEpsg5845: Object.freeze({
    minEasting: 677427.5,
    minNorthing: 6986415.5,
    maxEasting: 679475.5,
    maxNorthing: 6989487.5,
  }),
  /* DERIVED — the frame origin the compiler chose, the centre of that window.
     The height is the window's own minimum, and it is NEGATIVE here because
     the height model reads the flattened sea a little below RH 2000 zero where
     it meets the shore. That is the first negative frame origin in this repo
     and it is data, not a fault. */
  canonicalOrigin: Object.freeze({
    easting: 678963.5,
    northing: 6987951.5,
    heightRH2000: -0.85,
  }),
  bridgeMode: 'wgs84-legacy-frame',
  legacyFrame: LEGACY_FRAME,
  /* DERIVED — the pack origin projected to SWEREF 99 TM. Reproduced two ways:
     PROJ cs2cs, in the committed migration's candidateOrigin, and the repo's
     own Krüger series in packages/course-geo/chmv2/projection.mjs, which agree
     to under a millimetre. Checked further: re-projecting all 231 green-ring
     vertices and all 84 hole-line vertices through the frame reproduces the
     committed EPSG:3006 migration to a worst case of 1.4 mm. */
  legacyOriginEpsg3006: Object.freeze({
    easting: 678970.625,
    northing: 6988556.634,
  }),
  /* INHERITED — the GPK1 header's own GEO block, so a rebuilt pack that moves
     its frame fails here instead of rendering the terrain in the wrong place. */
  packOriginWgs84: Object.freeze({ latitude: 62.98250, longitude: 18.53250 }),
  packMetresPerLongitude: 50568.51,
  /* Compared VERBATIM against the pack header's own GEO.frame string, so it is
     this pack's wording and not another course's. Veckefjärden's pack says
     "north=-z, east=+x, bearing=atan2(dx,-dz), right=(-cos b, sin b)"; putting
     that here instead was caught by the frontier's own frame check rather than
     by review, which is the point of comparing the string at all. */
  packFrame: 'local metres about ORIGIN; north -z, east +x',
  /* REVIEWED — the 8 x 12 frontier above, NOT the 256 tiles of level zero.
     See expectedFrontierBoundsEpsg5845 for why the two differ here and not at
     Veckefjärden, whose whole 64-tile level zero fits the budget. */
  expectedTileCount: 96,
  expectedSurfaceTileCount: 0,
  /* REVIEWED — Norrfällsviken's played surfaces are Esri z18 orthoimagery
     traces anchored on the club's own GPS survey, not an authoritative
     surveyed intake, so the ground atlas keeps painting them and no v2 surface
     layer is claimed. */
  surfacePolicy: 'legacy-ground-atlas',
  /* DERIVED from the published ground manifest: seven levels, 469 tiles, a
     parent link on every one, reaching 16,384 m. Note this ground carries 469
     rather than Veckefjärden's 277, because its level zero is sixteen tiles per
     side and level one has to cover the same square. */
  ringGraph: Object.freeze({
    levels: 7,
    tiles: 469,
    rootSpanMetres: 16384,
    tilesByLod: Object.freeze({ 0: 256, 1: 64, 2: 64, 3: 64, 4: 16, 5: 4, 6: 1 }),
  }),
  /* REVIEWED, from a plan the app recomputes and checks at every boot.

     expectedCoreGrid is main.js's own CORE: the played geometry plus the
     practice greens and the range, grown 150 m and snapped to 36 m, read from
     the PACK rather than from the build directory. guardMetres is DERIVED
     (guardCells x dx). The two point counts are DERIVED too -- planV2LegacyCutout
     recomputes them from the grid and the INSCRIBED legacy rectangle, so a
     changed frame, a changed frontier or a changed CORE moves them and the
     assertion fails rather than agreeing with itself.

     The inscribed rectangle matters here and is not the frontier's footprint:
     the 2,048 x 3,072 m frontier arrives rotated 3.148 degrees into this pack's
     frame, and a cut that can only omit an axis-aligned rectangle has to stay
     inside the largest one that fits. For Norrfällsviken that costs about 82 m
     on the east and west edges. The cut then covers most but not all of the
     CORE -- 90,534 of 105,148 base points -- because the frontier is the boot
     rectangle rather than the whole window; the legacy vertices that survive
     are along the CORE's own edges, where the ring runtime's own tiles arrive
     over them. */
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -540,
      x1: 540,
      z0: -756,
      z1: 792,
      nx: 271,
      nz: 388,
    }),
    expectedSkippedBasePoints: 90_534,
    expectedTotalBasePoints: 105_148,
  }),
});

export const NORRFALLSVIKEN_V2_CONFIGS = Object.freeze({
  [NORRFALLSVIKEN_V2_CONFIG.slug]: NORRFALLSVIKEN_V2_CONFIG,
});
