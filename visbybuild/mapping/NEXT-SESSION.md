# Visby GK / Kronholmen — provisional 3D handoff

Checkpoint: 2026-09-08 (see "What changed on 2026-09-08" below; the 2026-09-07
intake this describes is otherwise unchanged). Follow the
[runbook](../../docs/v2-course-runbook.md),
[mapping workflow](../../docs/v2-course-mapping-workflow.md),
[club research](../../docs/courses/visby-source-research.md) and
[geospatial research](../../geo_data/course-v2/visby/reference/README.md).
The implementation is local and provisional. Independent controls, image/media
rights and production approval remain unresolved; no commit, push or deployment
is implied by the generated public-directory artifacts.

## Current application and source model

`?bana=visby` opens the main eighteen in 3D with measured v2 terrain by default.
`?bana=visby&view=sources` preserves the earlier source preview.
`?bana=visby&v2=0` selects the compatibility terrain; `v2=require` requires the
published graph. The physical ground and course slug are both `visby`. The
separate nine shares the property and remains future work, without a registered
playable routing. Caddee's repeated 18-row nine-hole card does not establish
another eighteen physical holes.

| Layer | Current implementation |
|---|---|
| Official card | 18 holes, par 72; 18 pars, 18 stroke indexes and 108 lengths agree between SGF and club-linked Caddee. |
| Numbered tees | 63 / 59 / 55 / 51 / 46 / 41; totals 6230 / 5819 / 5490 / 4926 / 4609 / 4216 m. Display default is 59. |
| Greens and routes | 18 source-derived green outlines and 18 main-course routes, with canonical EPSG:3006 coordinates in [geometry.json](geometry.json). |
| Physical tees | 17 observed representative platforms. Hole 12 has no identified physical platform; its explicit fairway camera is only a virtual flyover start. All six numbered-tee camera references remain approximate, and daily markers are unknown. |
| Fairways | 16 rings: 14 on 13 main holes and two unassigned shared-property corridors on the separate nine. The five par threes receive no invented fairway strips. |
| Bunkers | 65 observed outlines in shared-ground scenery. Completeness and hole ownership remain unverified. |
| Practice | A separately traced driving-range field is maintained in [practice-surfaces.geojson](practice-surfaces.geojson); detailed bays, targets and other practice facilities remain incomplete. |
| Buildings and paths | 32 OSM building footprints and clipped source roads/paths. Unknown heights and widths use explicit generic rendering values; no measured roof claim. |
| Water | 25 canonical national source polygons, ten interior rings, two sea components; 40 simple render pieces preserve the same water union and dry islands. |
| Vegetation | 2024 measured canopy supports 256 stand chunks at 4 m cell spacing. These are area representatives, not surveyed individual trees or measured species. |

The [route crosswalk](route-reference.json),
[surface traces](surface-traces-2022.json),
[surface inventory](playing-surfaces.geojson) and
[review](playing-surfaces-review.json) retain source pixels, IDs, methods and
uncertainty. They use the 2022 municipal orthophoto and available OSM outlines,
correlated with the club-linked diagrams. Exact current mowing boundaries,
later course alterations and independent positional residuals remain unknown.

Hole 12's exception must stay explicit: `tees.status` is
`unresolved-physical-platform`, `pads` is empty, and `cameraReference` must name
a sourced point inside an observed fairway. Other holes require observed pads.
`inferPads:false` and the mapped-only object policy prevent an inferred platform
or marker furniture. Scorecard lengths never stretch routes or move tees.
Flags are virtual targets inside the observed greens, not current pin positions.

## Terrain, water and software frame

| Measurement | Value |
|---|---|
| National source items | Coastal COGs `636_68` and `637_68`, EPSG:3006 + RH2000 (EPSG:5845), factor 1 |
| Pixel-edge window E/N | west 685700, north 6373000, east 689797, south 6368903 |
| First sample centre E/N | 685700.5, 6372999.5 |
| Source raster | 4097 × 4097 at 1 m; 16,785,409 finite samples, 67,141,636 bytes |
| Float32 SHA-256 | `deb6ce495470335a7778da55485ca63ec46386bdfd2bdf9d0a8ddf90a4e4e898` |
| RH2000 height range | 0.10084–11.01286 m |
| Complete published pyramid | 341 tiles at 1 / 2 / 4 / 8 / 16 m, including all 256 finest tiles |
| Initial active frontier | 64 complete 1 m tiles: columns 4–11, rows 3–10; E686724.5–688772.5, N6370183.5–6372231.5 |
| Compatibility heightfields | Source samples at 4 m and 16 m, both within the retained 4096 m extent |

The [acquisition](../../geo_data/course-v2/visby/acquisition/terrain-window.json)
and [compiler evidence](../../geo_data/course-v2/visby/acquisition/terrain-compile.json)
pin the source lattice and checksums. The general reader uses each coastal
COG's actual extent, rejects gaps, nodata, overlaps and misaligned centres, and
does not assume the nominal item ID establishes a full 10 km raster.

The exact software frame is E687748.5, N6370951.5, origin height 0.10 m RH2000;
east is +x and north is −z. The PROJ-derived WGS84 point is
57.44236399463288° N, 18.12847826436399° E. This convention is recorded in
[frame.mjs](../frame.mjs), the runtime contract and the source manifest's
`legacyFrame`. It is not a surveyed approval: the source manifest's
`canonicalFrame.origin` coordinates remain `null`, with
`originStatus:'pending-control-approval'`.

Water retains source RH2000 levels. Inland source Z is constant; varying sea Z
uses a labeled representative median, while the original XYZ geometry remains
available. No bathymetry, present water level or penalty-area status is inferred.
Original `shoreline.lines` remove artificial partition, source-tile and AOI
edges from foam and shallow-color calculations on both renderers. Finite source
sea pieces do not enable an unbounded rectangular ocean.

See the [water/vegetation notes](../../geo_data/course-v2/visby/vegetation/README.md),
[stand evidence](../../geo_data/course-v2/visby/vegetation/stand-evidence.json) and
[source-placement review](../../geo_data/course-v2/visby/vegetation/stand-source-review.json).
Stand counts and hashes must come from the latest evidence after playing or
practice surfaces change. Terrain remains unmodified by playing surfaces and
water-bed carving; the legacy procedural tree lattice is disabled.

## Checks from repository artifacts

From the repository root:

```powershell
npm run check:visby
npm --prefix apps/golf run build
node tools/serve.mjs apps/golf/dist 8642
```

The four [course artifact tests](../course.node-test.mjs) need the generated
model, card, vectors, heightfields and public pack/graph chunks. They passed
with both synchronous and asynchronous raw-cache reads explicitly prohibited.
They require no credentials, source-image cache or network access. They verify
canonical geometry and all official card values, water topology and source
shorelines, encoded heightfields, the static cutout contract and actual decoding
of the 64 native-metre runtime tiles. All green and camera heights agree with
the source model within terrain quantization and display rounding.

The build-adapter and shared shoreline tests also exercise missing-source
failures, the explicit H12 exception and artificial water seams. Unit/artifact
checks do not certify resemblance, survey accuracy or device performance.

The original [browser-validation.json](browser-validation.json) describes the
source-preview checkpoint. It is not evidence of 3D acceptance. The separate
`npm run check:visby-runtime` probe uses retained raw terrain and stand-stage
inputs to compare source preservation before exercising browser rendering.
With the app served above and those caches present:

```powershell
node visbybuild/check-runtime.mjs http://127.0.0.1:8642 --source-only
node visbybuild/check-runtime.mjs http://127.0.0.1:8642
node visbybuild/check-runtime.mjs http://127.0.0.1:8642 --gl
node visbybuild/check-runtime.mjs http://127.0.0.1:8642 --mobile
node visbybuild/check-runtime.mjs http://127.0.0.1:8642 --fallback
```

Use the retained reports for actual results and hardware. A mobile viewport is
not a physical-phone test, and a graph-resource outage is not a fully offline
application. Human visual acceptance and named-device review remain separate.

## Rebuild from retained source evidence

Raw originals, rasters and compiler stages remain under ignored
`visbybuild/cache/`. Rebuilding is a separate operation from running the
artifact checks. It needs the pinned 1 m Float32 terrain, municipal image,
canopy rasters and terrain/stand stage inputs. Python source authoring needs
Pillow, NumPy, OpenCV, Shapely and pyproj in the selected environment.
Follow the acquisition scripts in the linked source notes to restore missing
inputs; do not fill gaps or substitute changed bytes for a pinned source.

After reviewed route/surface edits, regenerate the source vectors and any
affected practice layer, then rebuild the model, stands and exact fallback:

```powershell
python visbybuild/mapping/build-playing-surfaces.py
python geo_data/course-v2/visby/vegetation/build-practice-surfaces.py
python visbybuild/mapping/assemble-geometry.py
node visbybuild/build-course.mjs
node geo_data/course-v2/visby/vegetation/compile-stands.mjs
node geo_data/course-v2/visby/vegetation/review-stands.mjs
node packages/course-pack/emit-pack.mjs visbybuild apps/golf/public/courses/visby visby
node packages/course-pack/emit-manifest.mjs
node packages/course-v2/compile-visby-ground-graph.mjs
node visbybuild/update-source-manifest.mjs
node packages/course-v2/compile-visby-ground-graph.mjs --out apps/golf/public
```

The first graph invocation stages its output and writes the runtime contract;
the second binds the refreshed source-manifest hash into the local public
graph. If surfaces or practice bounds change CORE, review and update the static
values in [v2-visby-config.mjs](../../apps/golf/src/engine/v2-visby-config.mjs)
against the new [runtime contract](runtime-contract.json). Re-run the artifact
checks. Refresh migration artifacts through the runbook's PROJ workflow when
the compatibility model changes, then refresh the ledger and graph binding.
An updated checksum does not approve geometry, rights or controls.

For deliberately new terrain acquisition, use a fresh ignored directory:

```powershell
node --env-file=.env packages/course-geo/acquisition/build-terrain-window.mjs --ground visby --out visbybuild/cache/terrain-review-next
```

Review changed evidence before altering the source contract. Do not silently
replace the expected Float32 hash or origin. National 2026 orthophoto metadata
is available, but the configured account's pixel requests return HTTP 403.
Municipal 2022 image derivative terms and club/Caddee media reuse remain open;
the source images are not redistributed as runtime textures.

## What changed on 2026-09-08

| Was | Is |
|---|---|
| No independent per-hole geometry existed at all | [`geo_data/visby_clean.json`](../../geo_data/visby_clean.json): the club's 18x5 GolfTraxx GPS survey (course id 62230SW), measured against the model by [`golftraxx-review.mjs`](golftraxx-review.mjs) |
| H12's tee unresolved, its line -36.7% against the card | the survey supplies it; retargeted the hole reads -8.2%, inside the band with the other fourteen |
| Traces read off Esri z18, 0.3214 m/px, WorldView-2 2016-08-24 | [`ortho-crop.mjs`](../ortho-crop.mjs) serves Lantmateriet's **0.16 m 2026-04-10** flight with no credentials, plus Region Gotland's **0.25 m summer** capture as a second dated frame |
| Environment stopped at 2,048 m; 341 tiles, 5 levels, no `parentId` | ring spec registered for a **16 km root over 7 levels, 469 tiles**; acquire measured, publish in flight |
| No measured trees; `vegetation.*` all empty | **3,012 machine-reviewed individuals** + stand fields on all 256 tiles, acquired and eyeballed; publish still to run |
| `npm run check:visby` 28/29; manifest gate red | 29/29 and green -- hole 16's fairway was desynced from `geometry.json` and six checksums were stale |
| CLAUDE.md had no Visby section | it has one |
| Six numbered tee marks per hole on ONE point, span 0 m | the back tee on its platform and each shorter tee walked up the observed route by the card's own difference: **85 of 108 marks move, 18 points become 80** |
| 65 bunkers in `scenery`, no hole owns any | **48 assigned to their hole**, 17 left in scenery with the reason |
| The Baltic flagged neither sea nor lake | seven rings `isSea` + `isLake`, `seaTintBandMetres` 0.05, and **the generator agrees** -- `build-course.mjs` used to write `isSea:false` and would have reverted it |
| The vegetation publish had never landed | **3,249 individuals + 256 stand tiles published** on the 469-tile ring graph (run 34207369939) |

## Remaining mapping and approval work

1. **Settle hole 9.** [`green-9-review.json`](green-9-review.json) has four
   records agreeing the traced ring is wrong and two readings of WHY that
   disagree; a trace on the summer capture separates them. Do not move the ring.
   One correction has been folded in: OSM is NOT an independent check here.
   Seventeen of the eighteen model greens carry
   `sourceIds:["visby-osm-2026-09-07"]` and the two area multisets are identical
   apart from hole 3's, so asking OSM whether the model's greens are right is
   asking the model about itself.
2. **DONE, and the imagery refused its half.** The six numbered tees no longer
   share one point: `teeMarks` in [`build-course.mjs`](../build-course.mjs)
   holds the back tee on its observed platform and walks each shorter tee UP the
   observed route by the card's own difference from the back tee -- 85 of 108
   marks move, 18 points become 80, and `elev.tee` is re-read at the 59 tee.
   Only differences are used, never absolute route length, so a route short of
   its card (this one is, by a median 8%) does not corrupt the tee spacing; the
   walk is clamped inside the measured line, so nothing is extrapolated and no
   pad is inferred. `tees.inferPads` stays false. What the ORTHOPHOTO could not
   do is recorded in [`tee-decks.json`](tee-decks.json) with its numbers: the
   reading recovers 10 of the 17 mapped decks on the independent 2026 flight, at
   a median 5.4 m and with areas 0.21-1.88x theirs, which is not an instrument.
   It does corroborate that 90 of the 108 derived points sit on compact mown
   ground, and none lands in water, a bunker, a building or on a green.
3. **DONE.** 48 of the 65 observed bunkers now carry the hole that owns them
   ([`assign-bunkers.mjs`](assign-bunkers.mjs), reviewed in
   [`bunker-ownership-review.json`](bunker-ownership-review.json)); the
   remaining 17 stay in `scenery.bunkers` because no hole's green or fairway
   claims them by the margin the rule requires -- most belong to the separate
   nine that shares this property. No outline moved.
4. `vegetation.forest/wood/scrub/wetland/sand/rock` stay empty, and OSM will
   never fill them: it has **zero** vegetation polygons inside the played bbox
   +500 m while the imagery measures ~22.4 ha of canopy inside the same hull.
   The LiDAR stand field and individuals are the source on the course itself.
5. **`visbybuild/tree-cover.json` does not exist, and Visby is the only build
   here without one.** Both vista-cone loops sit inside a dead `if (M.cover)`
   branch, so beyond the LiDAR coverage there are no distant trees at all --
   which matters much more now that the ground reaches 16 km instead of 2. The
   measured-only vegetation policy is not what blocks this: it short-circuits
   the legacy on-course planter, while the cone loops are a separate gate. The
   Norrfallsviken path (`fetch-sat.mjs` then `build-treecover.py`) is the
   recipe, calibrated on THIS course's own OSM greens rather than on numbers
   carried from another ground.
6. `coast` is empty and no water ring carries `isSea`, on a course where the
   median green stands 82 m from the Baltic. Seven rings already carry
   `sourceIsSea:true`/`waterKind:'sea'` and account for **907 of 931 ha** of
   water, yet all 40 are written `isSea:false`, so the vista tint paints the
   Baltic as forest-green. Read CLAUDE.md's Angso section first -- `isSea` is
   an instruction about the whole world, not a label on a ring -- but note the
   Angso objection was TESTED here and does not apply: a sea plane at 0.18 m
   would cover **0.01 ha** of dry land at Visby against Angso's 65.8 ha,
   because this coast starts at 0.24 m and Angso's reed beds sat below their
   lake. OSM's three coastline chains share four nodes with the property hull.
   Check the water sheets at the same time: 99.9% of 583,473 ring-interior
   samples sit within 0.02 m of their own bed, so every sheet is coplanar with
   the ground under it and `aDepth` is zero everywhere.
7. The clubhouse (OSM way 530655631, 688 m2) is one of 32 anonymous footprints
   and gets no clubhouse treatment; there is no `scenery/visby.js` module.
8. Independent horizontal/vertical controls and canonical-origin approval remain
   unresolved; the software frame is not promoted by any of the above.
9. Orthophoto derivative terms, photo/media reuse and production release remain
   open. The imagery is used for tracing and review and is never redistributed.
10. Per-hole human visual review, both backends, named devices, offline and
   performance checks remain to be done with the runbook gates.
