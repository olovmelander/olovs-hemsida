# Visby GK / Kronholmen — provisional 3D handoff

Checkpoint: 2026-09-07, local working tree. Follow the
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

## Remaining mapping and approval work

1. Identify H12's physical tee and every numbered tee association using suitable
   source evidence. Preserve the explicit virtual start until then.
2. Review current boundaries, missing tee platforms, fringes, bunker completeness
   and detailed practice facilities. Keep the separate nine's identity distinct.
3. Obtain independent horizontal/vertical controls and resolve canonical-origin
   approval without promoting the existing software frame automatically.
4. Resolve current orthophoto access and derivative terms, photo/media reuse and
   production release conditions. Public availability is not a license grant.
5. Review vegetation truth areas, individual objects, building dimensions and
   present-day changes; keep unknown attributes explicit.
6. Complete per-hole human visual review, both rendering backends, named mobile
   devices, offline behavior and performance checks using the runbook gates.
