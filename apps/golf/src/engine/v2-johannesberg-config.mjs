/* Reviewed live contract for the Johannesberg graph frontier.

   Johannesberg is a legacy flat-earth GPK1 pack, like Puttom and Veckefjärden
   and unlike Ribbingsfors: its world is local metres about 59.72733/18.19202
   with -z at TRUE north, while the published tiles are cut on the EPSG:3006
   grid, whose north is 2.76 degrees away here. Left unbridged that is 48 m at
   a kilometre out, so the bridge carries the meridian convergence, the frame's
   own metre, and a MEASURED vertical datum step.

   Every DERIVED value below is printed by the compiler that produced the
   published graph, every REVIEWED value has its rationale beside it, and the
   single MEASURED value carries its evidence. Nothing is typed from another
   course. */

/* The pack's own frame, read from johannesbergbuild/lib.mjs and reproduced by
   the GPK1 header (origin 59.72733/18.19202, mPerLon 56118.16). INHERITED,
   except metresPerLongitude, which is 111320*cos(latitude) and is DERIVED --
   the header's 56118.16 is that same number rounded to two decimals. */
const LEGACY_FRAME = Object.freeze({
  latitude: 59.72733,
  longitude: 18.19202,
  metresPerLatitude: 111320,
  metresPerLongitude: 111320 * Math.cos(59.72733 * Math.PI / 180),
  /* MEASURED, not derived. Johannesberg's GPK1 heights are AWS Terrarium on an
     unrecorded datum; the v2 ground is Lantmäteriet's laser DTM on RH 2000, so
     there is nothing to derive an offset TO.

     tools/measure-vertical-datum.mjs --ground johannesberg: the median of
     legacy minus v2 over 38,543 samples on a 2 m grid inside the greens,
     fairways and tee pads, every sample inside a water ring discarded.
     Per class the medians run 4.55 m (tees, n=1,787) through 5.70 m
     (fairways, n=34,741) to 6.06 m (greens, n=2,015); the whole overlap on a
     16 m grid gives 4.83 m, which never entered the number.

     Read the spread honestly: MAD is 1.72 m, seven times Puttom's 0.24 m, and
     a registration sweep of the legacy sample point over +/-40 m -- against
     the derived bridge, its mirror, the reversed rotation and no rotation at
     all -- moves it by less than 0.25 m in every case. A flat objective like
     that is not misregistration; it is a coarse global model genuinely
     disagreeing with a laser DTM about the shape of gently rolling Uppland
     parkland. So this offset is the best single step between the two datums
     and NOT a claim that the two surfaces agree to a metre anywhere.

     Puttom's number is 23.6263 m and Veckefjärden's 20.9924 m. Copying either
     here would be a 15-18 m error. */
  verticalDatumOffsetMetres: 5.6676,
});

export const JOHANNESBERG_V2_CONFIG = Object.freeze({
  slug: 'johannesberg',
  groundId: 'johannesberg',
  label: 'Johannesbergs Golf · Lantmäteriet 1 m terräng',
  /* DERIVED — printed by compile-johannesberg-ground-graph.mjs and carried by
     the published ground manifest. */
  frameFingerprint: '3b6db48a9134351129c33ee0e167aa1f5a295f9724f1e3a42ab797a2153209d4',
  /* DERIVED — the reviewed 2048 m window, which is the whole published graph's
     level-zero extent. */
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 678403.5,
    minNorthing: 6624276.5,
    maxEasting: 680451.5,
    maxNorthing: 6626324.5,
  }),
  /* DERIVED — the frame origin the compiler chose, the centre of that window. */
  canonicalOrigin: Object.freeze({
    easting: 679427.5,
    northing: 6625300.5,
    heightRH2000: 9.88,
  }),
  bridgeMode: 'wgs84-legacy-frame',
  legacyFrame: LEGACY_FRAME,
  /* DERIVED — the pack origin projected to SWEREF 99 TM. Reproduced two ways
     that never entered each other: PROJ cs2cs, in the committed migration's
     candidateOrigin (geo_data/course-v2/johannesberg/migration/
     course-model.epsg3006.json), and the repo's own Krüger series in
     packages/course-geo/chmv2/projection.mjs. They agree to a millimetre. */
  legacyOriginEpsg3006: Object.freeze({
    easting: 679460.879,
    northing: 6625364.187,
  }),
  /* INHERITED — the GPK1 header's own GEO block, so a rebuilt pack that moves
     its frame fails here instead of rendering the terrain tens of metres off. */
  packOriginWgs84: Object.freeze({ latitude: 59.72733, longitude: 18.19202 }),
  packMetresPerLongitude: 56118.16,
  packFrame: 'local metres about ORIGIN; north -z, east +x',
  /* REVIEWED — the complete 8 x 8 level-zero set. */
  expectedTileCount: 64,
  expectedSurfaceTileCount: 0,
  /* REVIEWED — Johannesberg's played surfaces are satellite traces routed by
     the club's 2026 banguide, not an authoritative surveyed intake, so the
     ground atlas keeps painting them and no v2 surface layer is claimed. */
  surfacePolicy: 'legacy-ground-atlas',
  /* MEASURED at boot: the runtime CORE grid can only be read AFTER main.js has
     smoothed the mown edges and synthesised tee pads, so these numbers come
     from a real boot on the reviewed bridge and are then locked.

     CORE is playB +/- 150 m snapped to 36, and playB here is NOT the holes: it
     also takes scenery.greens and scenery.range, so CORE reaches z -1152 while
     the northernmost hole point is at -783. The frontier replaces 219,736 of
     CORE's 261,280 base points -- 84.1% -- and the rim outside it stays the
     seamless GPK1 mesh.

     What that rim contains is a REVIEWED trade-off, not an oversight. The
     2048 m window is centred on the played ground of both courses, which keeps
     every hole corridor 110-231 m clear of its edge. Covering the driving
     range's far tip as well (it runs to z -996, 213 m beyond the last hole)
     would need either a 2048 x 4096 window -- 128 level-zero tiles, ~8.8 MiB,
     past this loader's reviewed 8 MiB frontier budget -- or re-centring, which
     would cut the SOUTHERN holes' margin from 110 m to 36 m. Play was chosen
     over the practice ground: the range's last 36 m renders from legacy MID,
     and the practice green at z -821..-784 is inside the frontier. */
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -936,
      x1: 900,
      z0: -1152,
      z1: 1116,
      nx: 460,
      nz: 568,
    }),
    expectedSkippedBasePoints: 219_736,
    expectedTotalBasePoints: 261_280,
  }),
});

/* The nine shares this ground, this window and this bridge: tools/build-nine.mjs
   built its pack on the parent's frame with the parent's environment, and the
   2048 m window was derived from the played ground of BOTH courses in the
   first place. It has its own routing, card and GPK1 pack, so it is its own
   v2 course on the one published ground -- every frame constant above is the
   same object rather than a second copy that could drift. */
export const JOHANNESBERG_9_V2_CONFIG = Object.freeze({
  ...JOHANNESBERG_V2_CONFIG,
  slug: 'johannesberg-9',
  label: 'Johannesberg niohålsbanan · Lantmäteriet 1 m terräng',
  /* MEASURED — and, unlike the korthålsbana's and Mellanbanan's, IDENTICAL
     to the parent's: 460x568, 219,736/261,280 at [-936,900]x[-1152,1116] @4,
     read the runbook way on 2026-09-05 (a deliberately wrong contract, and
     the assertion's own "got" line copied). It is the same grid because the
     two courses carry each other as scenery -- the nine's playB takes the
     eighteen's greens and range, the eighteen's takes the nine's -- so both
     CORE extents are the union of both courses. That is a fact about this
     pair, verified, not an inheritance: the boot with the wrong contract
     rolled the terrain back to GPK1 with the LiDAR trees already planted
     (baseMismatch p95 8.47 m, the forest-canopy signature), which is what
     an unmeasured cutout costs. Re-measure if either course's routing or
     scenery changes. */
  legacyCoreCutout: JOHANNESBERG_V2_CONFIG.legacyCoreCutout,
});

export const JOHANNESBERG_V2_CONFIGS = Object.freeze({
  [JOHANNESBERG_V2_CONFIG.slug]: JOHANNESBERG_V2_CONFIG,
  [JOHANNESBERG_9_V2_CONFIG.slug]: JOHANNESBERG_9_V2_CONFIG,
});
