# Puttom v2 LiDAR tree-placement plan

> **Status 2026-09-02:** investigation and implementation plan, audited against
> the live source catalogues on 2026-09-02. No runtime vegetation changes are
> authorized by this document alone. Puttom v2 currently has Lantmäteriet 1 m
> ground elevation, but its visible trees are not LiDAR-derived.
>
> **What the 2026-09-02 audit changed.** The plan's architecture stands. What
> was wrong or missing was about the *data*: the two scans that cover Puttom
> abut at a hard line that runs through the middle of the course, so there is
> no overlap band to reconcile; "advertised density" is three different numbers
> and the STAC field the tools read as density is a point spacing; the
> Skogsstyrelsen raster is not an independent source (it is the same laser
> data, processed by someone else) and is not on the critical path; three
> credential-free products replace it as checks (NMD2023 object height and tree
> species, Meta/WRI CHMv2); the laser licence changed on 2026-06-01 and now
> carries an attribution string and GDPR terms that the published registry must
> honour; and the pinned toolchain has no Python or R, so the crown compiler
> has to be written in Node over PDAL/GDAL rasters or the toolchain lock has to
> change first. Each of those is a section below, with the measurement that
> established it.

### Implementation checkpoint — 2026-09-02

- **Phase 0 is done and measured.** `tools/vegetation-baseline.mjs` boots the
  built app on the GPK1 path and on `?v2=require`, exports the legacy
  population through `V3D.legacyTrees()` (species, planting reason, hole,
  provisional zone), records `V3D.v2Objects()`, draws and boot marks, and
  captures every tee view plus an overhead with content hashes. The record is
  `geo_data/course-v2/puttom/vegetation/phase0-baseline.json`: on `?v2=require`
  Puttom plants **67,568** legacy trees (17,991 spruce, 36,766 pine, 12,811
  birch), of which 50,079 come from OSM/model forest rings, 17,264 from the
  satellite raster, 225 from the shore belt; 3,882 stand within the provisional
  zone A, 9,532 in B, 54,154 in C; 36 draw calls; the graph references zero
  object tiles. The GPK1 path plants 67,898 — the v2 ground changes acceptance
  near water by a few hundred trees, which is itself part of the baseline.
- **The freeze is load-bearing.** The planter records why each tree stands
  where it does (no placement changes — the baseline equals the previous
  render), `v2-graph-source` counts surface and object tiles in the graph
  summary, `v2-terrain-select` refuses a graph that declares object layers
  before the renderer exists (`V2_OBJECT_LAYER_GATE`: a boot error under
  `?v2=require`, a reported block under `?v2=1`), `check-app` gates the export
  against the planter count and the object-layer state on every course, and
  `puttom-vegetation-freeze.node-test.mjs` pins the committed graph at zero
  object references and the seam inside the ground rectangle.
- **Stage 1's credential-free half is done.** `record-laser-campaigns.mjs
  --write` pins the live inventory to
  `geo_data/course-v2/puttom/acquisition/laser-campaigns.json` (three items,
  the N 7025000 seam, per-item statistics with the three density definitions
  kept apart, Skogsstyrelsen's per-scan sensor and leaf state, the licence
  attribution); `--check` fails on drift, which is how a north re-fly will be
  adopted deliberately. The file is a checksummed manifest artifact.
- **Stage 0 has run, and it found why the reads were wrong.** With access
  restored (the `.env` password was wrong), `run-copc-census.mjs` read all
  three items' hierarchies in 2–4 pages each; every hierarchy sums exactly to
  its header count, and
  `geo_data/course-v2/puttom/acquisition/copc-hierarchy-census.json` holds the
  27-window census. Its first version put points from the north scan south of
  the seam, and chasing that exposed the fact that matters: **these items do
  not subdivide the COPC cube.** Decoding nodes at every depth of all three
  items (`copc-reader/verify-octree-convention.mjs`) shows each axis subdivided
  over the header's data extent — Y over the 5 km half-tile, Z over the point
  heights — with only X coinciding with the cube because the data is 10 km
  wide. A specification-following reader prunes the wrong nodes, which is what
  the 52-point PDAL window in the D2 evidence was. The census and the reader
  below use the extent rule; the seam windows now show zero for the wrong-side
  campaign, as they must.
- **Stages 1–3 run in Node.** `packages/course-geo/copc-reader/` (its own
  `npm install`, outside the workspace lockfile) decodes bounded windows with
  laz-perf: node selection under the extent rule padded by 2 m, every decoded
  node held to the hierarchy's point count exactly, points filtered by their
  real coordinates. `build-canopy.mjs` then builds, per finest tile of the
  published ground, the cloud's own ground from class 2/9 returns (mean per
  1 m cell, nearest-fill to 60 m, 3 × 3 mean), height above ground bilinearly,
  the 1 m canopy height model (0 where only ground returns exist, NaN where
  none), first/all/ground return counts, and the cloud-ground-minus-DTM
  statistics against the exact published terrain tiles. The trial on the two
  tiles either side of the seam: pulses 1.6–2.6/m², cloud ground within a
  decimetre of the DTM on both campaigns, node counts exact.
- **The compiler core exists, in Node, with tests, and has run end to end on
  synthetic canopy** (`packages/course-v2/vegetation/`): `canopy-fields`
  (voids, single-cell fill, median detection copy, presence, exact signed
  stand-edge distance, roughness, seam ownership), `crown-detect` (the
  declared variable window, Dalponte growth, statistics, individual/stand
  classification, confidence terms, and an extent pass — measured on synthetic
  crowns, Dalponte's 45% core sits at about 0.7 of the drip line, so an
  individual's radius is recovered by a Voronoi-constrained extension to 20%
  of the apex), `semantic-exclusions` (the model's greens, tees, fairways,
  bunkers, practice areas, water and shore band, streams, buildings, roads,
  paths, railway, power corridors and farmland rasterised with class buffers
  and a reason per cell), `stand-fields`, `registry-identity` (sequential ids
  preserved by matching; missing needs review), `object-compiler` (strict
  registry records with the accuracy floors, per-tile `objects` chunks through
  the real envelope), `ground-sampler` (base heights bilinearly from the exact
  published terrain tiles) and `compile-vegetation` (the driver and CLI:
  rasters in, candidates/evidence/registry/diff/chunks out; records only for
  approved candidates, with an explicitly labelled harness auto-approval).
- **The whole published ground has been derived (Phase 2 exceeded, review
  not done).** `build-canopy.mjs` read 72 tile windows from the two campaigns
  in 74 s (146 MB of range requests, every node count exact): south 13.7 M
  points, 2.11 pulses/m², 3.61 returns/m², 2.5% void; north 14.9 M points,
  2.63 pulses/m², 5.47 returns/m², 11.3% void (water in the northern bay).
  Cloud ground against the published DTM, per-tile medians: north
  −0.003…0.01 m (the DTM is that scan), south −0.135…0.07 m (the DTM is the
  2020 scan; no tile shows earthworks at tile scale). The census estimates
  reproduce the exact counts at a median ratio of 1.00 with the coarse-node
  spread the census reports (0.55–1.34), and the rasters live in the ignored
  toolchain cache with `canopy-evidence.json` committed. `compile-vegetation`
  then derived **44,961 crown candidates** in 36 s: 3,710 individuals,
  40,711 stand, 540 excluded with reasons (paths 307, water 94, farmland 77,
  roads 45, buildings 12, tees 4, fairway 1); zone A holds 685 individuals,
  1,213 stand crowns and 125 exclusions. Individuals: height p50 12.5 m
  (max 30.2), radius p50 3.9 m, confidence p50 0.74. The labelled harness
  compile turned the 3,707 eligible individuals into 64 valid `objects`
  chunks totalling 183,559 encoded bytes with base heights from the exact
  published tiles — proof of the path, not a registry:
  `vegetation-evidence.json` carries the summary and the per-hole zone-A
  counts, and no record is published.
- **Review overlays exist; the review does not.** `render-review.mjs` draws
  the merged canopy model with every candidate — individuals as circles at
  their crown radius, stand crowns and exclusions as dots — over the hole
  lines, fairway rings, tee pads, greens, bunkers, water and the seam, as a
  2 m overview and eighteen 1 m hole crops under
  `tools/goldens/puttom-vegetation-review/` (ignored, like the goldens). Looked
  at: the lakes are voids inside their rings, corridors read as open ground,
  hole 12's par 3 crosses its bay, and the rows of individuals between
  neighbouring corridors are the tree lines between parallel fairways.
- **Phases 3–6 delivered on 2026-09-02, later the same day, under one recorded
  deviation.** The owner decided that no human review would take place and
  that the generation should ship; the review gate is therefore held by the
  versioned machine rules in `compile-vegetation.mjs` (`MACHINE_REVIEW_RULES`
  v1: not excluded, confidence ≥ 0.6, height ≥ 3 m, radius ≥ 1 m, and in
  zone A prominence ≥ 3 m and compactness ≥ 0.5; stand crowns are never
  records), every published record says so through the evidence, and the
  plan's "individually reviewed" gate is explicitly not met. What shipped:
  - a new chunk kind, `stands` (`stand-field-u8-v1`): per finest tile, 4 m
    cells with canopy fraction, mean and p95 height, campaign and
    measured/excluded flags, with the machine-approved individuals' crowns
    and the semantic exclusions removed, so dense forest is published as
    measured density and never as invented stems; the schemas, validators,
    Node and web decoders, loader, graph verifier and emitter all carry it;
  - the published generation: **3,502** machine-reviewed `derived-lidar`
    records in 64 object registries (176,823 B) and 64 stand fields
    (548,251 B), on ground manifest `3cd42012…` and course `21c3229a…`, the
    root moved, the prior generation `590e64f2…`/`d91b128e…` retained for
    rollback, every chunk verified through the same path the loader uses
    (`puttom-vegetation-freeze.node-test.mjs` now asserts the generation);
  - the vegetation runtime (`engine/v2-vegetation.mjs`, a dynamic chunk a
    flagless visit never downloads): registries and stand fields fetched and
    verified fail-closed, placed through the v2 terrain's own bridge, planted
    with the three existing species templates at measured height and crown
    radius (individuals) or from the field with the allometry fitted on this
    ground's individuals, `r = 2.48 + 0.124 h` (stand trees), species by
    hash and never labelled as measured, and the legacy lattice cut out of
    every tile the generation owns;
  - measured on `?bana=puttom&v2=require` on this machine's GPU: 92,681
    trees drawn (3,502 individuals, 56,241 stand trees, 32,938 legacy outside
    the coverage), 0 legacy trees inside it, registry bases within 0.001 m of
    the visible ground, 725 KB of vegetation fetched, 36 draw calls, 22 s
    boot; the plain path is unchanged at 67,898 legacy trees.
  - **A picture caught what the gates passed.** The first published
    generation put six trees on the driving range: the migrated model
    carries the range as a list of rings and the exclusion adapter had
    passed the list as one ring, which rasterises nothing. Fixed, recompiled,
    republished; the intermediate generation's files were removed.
- **The independent-sensor cross-check and the seam report are done
  (2026-09-02, evening).** `packages/course-geo/chmv2/` reads the Meta/WRI
  CHMv2 tile straight from the open bucket (a range-request COG reader and a
  transverse Mercator series verified to millimetres against the PROJ values
  already in this repository), samples it onto the campaign rasters' own 1 m
  grid (81 COG tiles, 3.1 MB, every cell valid), and
  `run-chmv2-crosscheck.mjs` writes `vegetation/chmv2-crosscheck.json`.
  What it measured, in the order that matters:
  - **The seam is not a canopy step.** Over ±100 m of the seam the laser
    canopy fraction steps −0.04 and CHMv2 steps −0.035; laser mean height
    steps +0.02 m and CHMv2 +0.65 m. Both attribute to forest under the
    stated rule, and the two campaigns carry the same height bias against
    the independent raster, +1.58 m (2023 north) and +1.66 m (2026 south),
    0.08 m apart. Nothing in the published generation is a campaign artefact
    at the seam.
  - **Presence agreement is moderate and its disagreement is edge blur.**
    72.6% of cells agree on canopy at 2 m (kappa 0.41); CHMv2 calls canopy on
    69% of the ground against the laser's 59%, and 77% of its extra cells sit
    within 2 m of laser canopy, 43% of them reading over 10 m — a 0.5 m
    optical model smearing tall crowns outward, not trees the laser missed.
    The laser's own extra 8.6% is half beside optical canopy and spans all
    heights, which is what growth since the imagery and thin conifers look
    like.
  - **CHMv2 compresses height** (slope 0.46: it reads 4.7 m where the laser
    reads 2–5 m and 14 m where the laser reads 20–25 m), so the laser
    heights are kept as published and the bias is calibration, not error.
  - **89.9% of the 3,502 published individuals have optical canopy inside
    their crown** (92.9% south, 83.6% north), and the tile flags (agreement
    under 0.6 or bias more than 3 m from the ground-wide calibration) mark
    eight tiles on the western and southern edges. Water explains only one
    of them (the lake tile, where the laser has no returns). The others are
    **felling after the imagery**: `clearedBlocks` finds contiguous blocks
    the optical model reads as tall (≥ 8 m) and the June 2026 laser reads
    as bare (< 1 m) of 1.75, 1.35, 0.76, 0.66 and 0.57 ha in five tiles,
    against scattered smear of 0.02–0.2 ha everywhere else. The laser is
    the newer record, so the render is right to show those stands cut; the
    evidence lists them as `felledSinceImagery`.
  - **NMD2023 was measured and deferred.** Its object-height layers are
    national stripped PackBits TIFFs inside per-entry deflate, so Puttom's
    rows sit ~40% into each 0.8–1.5 GB stream, and the species layers keep
    their directory at the END of 2–3 GB entries. About 1.8 GB for the four
    height layers, 6 GB for species; same laser as ours, so no independence
    is bought. The species prior stays open on that cost.
- **Still open:** the species-stratified seam report (needs the NMD species
  prior above); hardware performance on a phone (the 55% low-quality cut of
  stand cells is in place, unmeasured); the default visit still shows the
  legacy planter because v2 itself stays opt-in until the release decision
  the digital-twin plan reserves; and a human review of zone A, should the
  owner want one, now has its overlays, its candidate keys and an approvals
  path into the same compiler.
- **Environment notes that cost time.** On a Windows checkout git converts the
  committed LF JSON to CRLF, so `check-manifests.mjs` and the manifest test
  report checksum mismatches on files nobody changed (the HEAD blobs hash to
  the recorded values); pixi/PROJ are absent locally, so the hole-inventory
  test that projects through PROJ fails here too. Both pass in CI.

## Executive verdict

Puttom v2 does **not** currently use `Laserdata Nedladdning, skog` or any
tree-height raster to determine tree position, height, crown size, density, or
species.

The live path is:

```text
Esri World Imagery z17 + model masks + OSM woodland
                         |
                         v
             legacy 3 m forest/open raster
                         |
                         v
             deterministic 5.4 m lattice
                         |
                         v
       procedural acceptance, species, size and rotation
                         |
                         v
             base Y sampled from visible ground
                         |
               +---------+---------+
               |                   |
          GPK1 terrain       active v2 DTM
```

V2 can therefore change the elevation on which a legacy candidate stands. It
does not supply the candidate's horizontal position or biological properties.

The target path is:

```text
pinned Laserdata Skog COPC items (north 2023, south 2026) + approved 1 m DTM
                         |
                         v
  hierarchy census -> complete, checksummed, locally staged source files
                         |
                         v
   per-campaign height-above-ground / 1 m canopy-height model + void mask
                         |
                         v
 crown candidates + stand masks + confidence terms + campaign ownership
                         |
                         v
   exclusions + credential-free cross-checks (NMD, CHMv2) + zone-A review
                         |
                         v
        approved content-addressed v2 object chunks (+ stand payload)
                         |
                         v
       shared WebGL2/WebGPU object-tile renderer
```

The implementation must use LiDAR as measured evidence without claiming that a
derived crown centre is a surveyed stem. Dense forest remains a canopy/density
problem; isolated, signature, and play-affecting trees are individual-object
problems.

## Definition of done

This work is complete only when all of the following are true:

1. Complete source data for the required Puttom extent has been acquired
   offline, checksummed, dated, and tied to the canonical EPSG:5845 frame, and
   every bounded read has been proven against the COPC hierarchy census.
2. A reproducible compiler derives canopy, stand density, and confidence-gated
   tree candidates without interpreting missing or under-read data as open
   ground, and without averaging the two campaigns across their seam.
3. Every published zone-A tree is data-derived, approved, and carries source,
   capture date, confidence, uncertainty, and review metadata.
4. Real object-registry BVCH chunks are referenced by
   `tiles[].layers.objects`; the current `objects: null` graph is gone for the
   approved coverage.
5. The application loads, verifies, instances, culls, and releases those object
   tiles on both WebGL2 and WebGPU.
6. The legacy `M.cover` lattice planter is disabled inside the verified v2
   object frontier without producing duplicate trees or empty transition bands.
7. Distant zone-C scenery can remain explicitly source-constrained procedural
   forest.
8. Missing, corrupt, stale, or incomplete required object assets fail closed
   under `?v2=require` and never silently become a clearing.
9. The published assets carry the attribution the laser licence requires, and
   the GDPR assessment for the derived registry is recorded.
10. Geospatial, visual, integrity, performance, and rollback gates in this plan
    pass before any default is changed.

## Confirmed current state

### Runtime placement authority

The existing Puttom canopy asset is produced from Esri imagery, not LiDAR:

- [`puttombuild/build-treecover.py`](../puttombuild/build-treecover.py#L2)
  declares Esri z17 imagery as its source;
- it classifies a 3 m grid using dark/textured land pixels and model masks at
  [`build-treecover.py:129`](../puttombuild/build-treecover.py#L129);
- [`packages/course-pack/emit-pack.mjs`](../packages/course-pack/emit-pack.mjs#L47)
  embeds `tree-cover.json` and the model vegetation rings into the normal GPK1
  pack;
- the app loads the same GPK1 vector payload for both legacy and v2 and decodes
  `M.cover` into `coverAt(x, z)` at
  [`main.js:801`](../apps/golf/src/main.js#L801).

Tree candidates are then generated by the shared legacy planter:

- a deterministic 5.4 m lattice is declared at
  [`main.js:3147`](../apps/golf/src/main.js#L3147);
- X/Z jitter is generated at
  [`main.js:3165`](../apps/golf/src/main.js#L3165);
- OSM/model `forest`, `wood`, and `scrub` rings contribute density at
  [`main.js:3169`](../apps/golf/src/main.js#L3169);
- the Esri-derived canopy raster and its local five-cell fraction control the
  remaining density at [`main.js:3181`](../apps/golf/src/main.js#L3181);
- procedural clumping and hash acceptance occur at
  [`main.js:3231`](../apps/golf/src/main.js#L3231);
- species, scale, position, and rotation are finalized at
  [`main.js:3246`](../apps/golf/src/main.js#L3246).

The live result is therefore:

| property | current authority |
|---|---|
| X/Z position | 3 m Esri canopy class, OSM/model rings, and deterministic jitter |
| density | local canopy fraction plus procedural clumping |
| base Y | shared visible-ground sampler; v2 DTM when active |
| object height | procedural species-template scale |
| crown radius | procedural species-template scale |
| species | procedural pine/spruce/birch selection |
| provenance per tree | none |
| human review per tree | none |

The shared visible-ground frontier is installed before vegetation is created at
[`main.js:2016`](../apps/golf/src/main.js#L2016). The planter calls
`terrainH(px, pz)` at [`main.js:3218`](../apps/golf/src/main.js#L3218), which is
why legacy candidates sit on v2 elevation. This is a vertical drape, not
LiDAR-derived placement.

### Published v2 graph

The current terrain compiler hardcodes every tile to:

```js
{ terrain: asset.reference, surface: null, objects: null }
```

See
[`terrain-compiler-node.mjs:240`](../packages/course-v2/terrain-compiler-node.mjs#L240).
The committed Puttom graph contains 85 terrain references and zero object
references. No Puttom `objects/` runtime assets exist.

The repository already has a strict object-registry contract, including
`placementMethod: "derived-lidar"`, source/capture metadata, confidence,
accuracy, truth zones, and mandatory approval for published objects. See
[`object-registry.mjs`](../packages/course-v2/object-registry.mjs). Only
synthetic fixtures exercise this contract today; Puttom has not emitted a real
registry.

### Acquisition evidence, not runtime data

The Puttom source manifest records:

- `laser-lm-skog` as `planned`, `supporting`, and without a retained local asset
  or checksum;
- `tree-height-sks` as `planned`, without an authenticated retained raster;
- `legacy-tree-cover` as an Esri/OSM-derived migration-only artifact.

See
[`source-manifest.json:27`](../geo_data/course-v2/puttom/source-manifest.json#L27)
and
[`source-manifest.json:40`](../geo_data/course-v2/puttom/source-manifest.json#L40).

The repository has working discovery, range probes, bounded-window tools,
canopy experiments, and per-hole source-control infrastructure. The last
retained Puttom evidence says the tested 256 m COPC window returned 52 points,
only `0.000721` of advertised density, and deliberately emitted no derived
runtime asset. Raw point-cloud bytes retained after the job were zero. See
[`course-digital-twin-implementation-plan.md:1401`](course-digital-twin-implementation-plan.md#L1401).
The comment block in
[`canopy-window.mjs`](../packages/course-geo/acquisition/canopy-window.mjs)
already localises the fault: the same reader configured identically returns
dense data when run with `--stream` and 0.08% of it without, so the under-read
is a reader/transport behaviour, not the source. Stage 1 below makes that
provable per window instead of inferred.

Compiling LiDAR-derived vegetation/object candidates is still an unchecked D2
deliverable at
[`course-digital-twin-implementation-plan.md:1024`](course-digital-twin-implementation-plan.md#L1024),
while the real D6 compiler, review UI, instancing, and removal of runtime
candidate scanning remain open at
[`course-digital-twin-implementation-plan.md:2304`](course-digital-twin-implementation-plan.md#L2304).

## The source truth at Puttom, measured

Everything in this section was read on 2026-09-02 from public endpoints —
Lantmäteriet's unauthenticated STAC search and per-item `_info.json`
metadata, Skogsstyrelsen's public scan-area metadata service, and the AWS open
data bucket — so it can be re-derived without credentials. It is the part of
the picture the previous revision did not have, and most of the plan's
corrections follow from it.

### Three COPC items intersect the AOI, and two of them abut through the course

`GET /stac-hojd/v1/search?collections=dsm-skoglig-copc&bbox=18.9,63.28,18.98,63.32`
returns three items, not two:

| item | extent (EPSG:3006 N) | captured | catalogue updated | points | file bytes | role |
|---|---|---|---|---:|---:|---|
| `23f028-702_69` | 7025000–7030000 (north half) | 2023-06-01 … 06-07 | 2026-06-17 | 172,835,421 | 1,061,579,823 | **active, north** |
| `26f015-702_69` | 7020000–7025000 (south half) | 2026-06-01 … 06-21 | 2026-08-27 | 142,431,214 | 730,824,720 | **active, south** |
| `20f015-702_69` | 7020000–7025000 (south half) | 2020-06-16 … 08-10 | 2026-06-17 | 145,305,774 | 704,665,562 | superseded; change reference only |

The seam between the two active campaigns is the line **N = 7025000**. The
legacy frame origin (63.2992 N, 18.9413 E) projects, by the migration's PROJ
run, to E 697498.02, N 7024997.74 — **two metres south of the seam** — and
the published v2 ground rectangle (E 696404.5–698452.5, N 7023802.5–7025850.5)
straddles it with 1197.5 m of ground south of the line and 850.5 m north. The
AOI runs from N 7022735 to N 7027432, so the course is split almost evenly
between a 2023 scan and a 2026 scan. There is **no overlap between them**: the north item's
boundary polygon stops at N 7024728–7025076 and the south item's at
N 7024962–7025038. The only overlapping pair is the old 2020 south scan under
the new 2026 one, and that is resolved by precedence, not mosaicking. The
previous revision's "keep an overlap band wide enough to compare height and
density" cannot be done at Puttom; the seam section below says what to do
instead.

Västernorrland is in Lantmäteriet's 2026 scanning plan, and the south item
was delivered on 2026-08-25. A north re-fly may therefore appear in the
catalogue at any point in the 2026–2027 delivery window. **Re-run the STAC
query at the start of every compiler run and before every release**; a new
north item would remove the seam and must be picked up deterministically
rather than discovered by a screenshot.

### Per-item statistics from the public `_info.json`

| statistic | north `23f028` | south `26f015` | old south `20f015` |
|---|---:|---:|---:|
| LAS / point record format | 1.4 / PDRF 6 | 1.4 / PDRF 6 | 1.4 / PDRF 6 |
| boundary area (km²) | 54.42 | 51.25 | 49.42 |
| all-return density (points / boundary area) | **3.18 /m²** | **2.78 /m²** | 2.94 /m² |
| `avg_pt_spacing` (this is what the STAC `density` field carries) | 0.561 m | 0.600 m | 0.583 m |
| `NumberOfReturns` mean / max | 2.79 / 5 | 1.96 / 8 | 1.63 / 5 |
| `ReturnNumber` mean | 1.89 | 1.48 | 1.32 |
| `Classification` mean (1 = unclassified, 2 = ground) | 1.39 | 1.97 | 1.95 |
| `Intensity` min / mean / max | 740 / 2,377 / 65,535 | 17,825 / 39,425 / 65,535 | 0 / 5,667 / 65,535 |
| `ScanAngleRank` range | ±18° | ±20° | ±19° |
| flight lines (`PointSourceId` range) | 61709–61715 (7) | 1733–1736 (4) | 10701–10720 (20) |
| GPS time span | ~6.0 days | **~1.1 hours** | ~2.2 days |
| Z range (m RH 2000) | 0.04 … 165.71 | −0.83 … 139.57 | −23.3 … 419.5 (noise present) |
| COPC root spacing / half-size | 78.125 m / 5000.005 m | same | same |
| root hierarchy page | 197,824 B at 1,061,381,999 | 191,104 B at 730,633,616 | 146,144 B at 704,519,418 |

Skogsstyrelsen's public scan-area metadata (the `VisaSkogligaGrunddataMetadata`
layer, queried at four points inside the AOI) adds the sensor and the leaf
state:

| scan area | date | scanner | `Lov_Avlov` | cycle |
|---|---|---|---|---|
| `23F028_702_69_5050` (north) | 2023-06-07 | Leica CityMapper-2 | 1 | omdrev 2 |
| `20F015_70225_69xx_25` (south, superseded) | 2020-06-18 | Leica ALS80-HP | 1 | omdrev 2 |
| `26F015` (south, active) | 2026-06 | not yet in Skogsstyrelsen's metadata | — | omdrev 3 (expected) |

`Lov_Avlov = 1` is leaf-on (Skogsstyrelsen's own technical description uses
August scans as the worked example with value 1). Both dated campaigns are
leaf-on and the 2026 one is a June flight, so treat all three as leaf-on until
its metadata says otherwise.

What these numbers change:

- **"Advertised density" is three different quantities.** The product says
  1–2 points/m²; Skogsstyrelsen's report 2022-19 clarifies that figure counts
  *last or single returns*; the per-item metadata gives 2.8–3.2 *all returns*
  per m²; and the STAC property the discovery tools read as density is the
  average point *spacing* in metres. The compiler must compute pulse density
  from `ReturnNumber == 1` counts in its own windows and state which quantity
  every gate uses. The 10% "transport sanity" ratio in the existing tools is
  against the discovery's 1.1 / 1.7 figures and stays a transport check only.
- **The two campaigns are different sensors with different intensity scales.**
  Mean intensity is 2,377 in the north and 39,425 in the south. Intensity must
  never be compared across the seam without per-campaign normalisation, and
  no surface or species rule may be tuned on one campaign and applied to the
  other unchecked.
- **The north scan took six days, the south scan one sortie.** Early June at
  63° N is birch leaf-out; a six-day window can straddle it. Deciduous crown
  heights in the north may read lower and thinner than the same trees would
  in the south. Stage 3 stratifies the seam comparison by NMD species class
  for exactly this reason.
- **The ground-class fraction differs by campaign** (mean class 1.39 north vs
  1.97 south implies a much larger ground share in the south). Height above
  ground therefore has different support on each side; the void mask and the
  DTM comparison in Stage 2 are per campaign.

### The published DTM is not from the newest scan

The `dtm-cog` item `702_69` carries an `ursprung.json` that records where each
patch of the 1 m model came from. Over the AOI: the south half (9.7 km² of
the AOI) is *Luftburen laserskanning 2020-06-16/18*, the north half (10.4 km²)
is *Luftburen laserskanning 2023-06-07*, and three small 2024 photogrammetric
patches (0.15 m plan / 0.25 m height uncertainty, against 0.3 / 0.1 m for
laser) lie outside the AOI. So under the south half of the course the
published ground is six years older than the point cloud that will stand on
it. On a golf course six years is real earthworks. Stage 2 keeps height above
ground computed from the 2026 cloud's own ground returns as the primary
normalisation and treats the cloud-minus-DTM difference as a QA product that
is expected to be non-zero in places, not as an error to hide.

### The laser licence changed on 2026-06-01

Lantmäteriet reclassified Laserdata Nedladdning, skog as personal data under
GDPR. From 2026-06-01 it is delivered only through the STAC API as 10 × 10 km
COPC/LAZ tiles, access has to be ordered again in Geotorget under new terms
(LM2026/077164 v1.0), and the STAC collection now advertises its licence as
`other`. The terms document itself keeps **CC BY 4.0** and adds two things
the published registry must honour:

- when publishing anything derived from the product, state the source as
  *Laserdata Nedladdning, skog, © Lantmäteriet*, that the data has been
  processed, and that CC BY 4.0 applies — in the asset, or in its accompanying
  metadata/documentation if that is not practical;
- the licensee is data controller under GDPR for the personal data it
  receives; the raw cloud must be handled accordingly and is never published.

A registry of tree positions, heights and radii contains no personal data.
That assessment is recorded in the source manifest at compile time, the raw
cloud stays in the ephemeral runner, and the attribution string travels with
the object chunks and the manifest.

The unauthenticated behaviour on 2026-09-02: the COPC data asset answers
`401` with `WWW-Authenticate: Basic realm="Authorization Server"`; the
per-item `_info.json` under `/hojd/pub/` and the STAC search are open.

## What the official and open products can establish

### Laserdata Nedladdning, skog — the primary source

Point cloud in EPSG:3006 + RH 2000 (compound EPSG:5845), LAS 1.4 PDRF 6, with
intensity, return number, number of returns, scan angle, GPS time and flight
line. Classes: 1 unclassified (all vegetation and buildings), 2 ground, 7 low
noise, 9 ground within water, 17 bridge (classification level 3 only), 18 high
noise. Lantmäteriet's quality description states a minimum of 1.0 point/m²
over the scanned surface (water excepted), a mean absolute error under 0.1 m in
height and 0.3 m in plan on open flat hard surfaces, and under 0.15 m in height
between adjacent strips. Scanning is done snow-free; leaf state is recorded per
scan area by Skogsstyrelsen (above), not by the product.

This source can establish:

- ground and above-ground returns;
- canopy height and envelope;
- forest/open boundaries;
- local canopy density and structure;
- approximate isolated crown candidates;
- scan date and spatial coverage.

It does not directly establish:

- a list of surveyed stems;
- exact species;
- exact crown geometry;
- current trees after felling or growth that happened after the flight;
- reliable separation of every individual tree in a dense stand. Skogsstyrelsen's
  report 2022-19 on point density found a *major* difference in crown
  delineation between 1 and 5 points/m² and little gain beyond 5, and
  recommends ≥ 5 points/m² for a future cycle precisely so that most crowns
  can be mapped as separate objects. Published detection rates for dominant
  trees at 2–4 points/m² sit around 75%; height from local maxima at this
  density is biased low by roughly 0.5–1.5 m because pulses miss the apex,
  more for conifers than for birch.

Official product documentation:

- [Laserdata Nedladdning, skog (Geotorget)](https://geotorget.lantmateriet.se/dokument/projects/laserdata-nedladdning-skog-api/released/1/)
- [Product description v1.6](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/pb_laserdata_nedladdning_skog.pdf)
- [Terms of use LM2026/077164](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf)
- [STAC-höjd API](https://api.lantmateriet.se/stac-hojd/v1/api.html)
- [Quality description for laser data](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/kvalitetsbeskrivning_laserdata.pdf)

### Markhöjdmodell Nedladdning

The approved 1 m DTM remains the authority for bare-earth base elevation. It is
not a canopy or tree-position layer, and at Puttom it is older than the south
point cloud (see above). Every candidate must be normalized against and finally
draped to the exact terrain generation published with the object registry.

### Skogsstyrelsen tree height — off the critical path, and not independent

This plan does not depend on it. Two facts settle its role:

1. **It is the same laser data.** Skogsstyrelsen's *Trädhöjd från Laserdata
   skog* is a 1 m signed-Int16 decimetre raster produced from Lantmäteriet's
   point cloud, with 0 where the cloud has no return. Comparing our CHM with it
   checks our *processing*, not the *source*. Its own technical note says the
   raster should not be averaged per stand because one tree spans several
   pixels — which is also a warning against reading one tree per maximum.
2. **Its access is split, and the split was measured.** The ImageServer the
   discovery tools target answers `403` even with the account in `.env`. The
   bulk distribution is open: the ATOM feeds at
   `geodpags.skogsstyrelsen.se/geodataport/feeds/Tradhojd_omdrev3.xml` and
   `Tradhojd_omdrev2.xml` link county zips that answer `200` without any
   login — Västernorrland is 8,568,413,295 bytes for omdrev 3 and
   24,112,529,037 bytes for omdrev 2 — under CC0. Skogsstyrelsen's metadata
   does not yet list the 2026 south scan, so omdrev 3 is not expected to cover
   the south half until their production catches up (they have announced 2026
   delays), and the AOI's omdrev 2 coverage is the 2023 and **2020** scans.

If someone chooses to fetch a county zip, it is a processing cross-check for
the north half only and is recorded as such. Nothing below waits for it.

- [Download page and feeds](https://www.skogsstyrelsen.se/laddanergeodata)
- [Technical specification](https://www.skogsstyrelsen.se/globalassets/sjalvservice/karttjanster/geodatatjanster/teknisk-beskrivning/raster-tradhojd-laserdata-skog---teknisk-beskrivning.pdf)
- [Report 2022-19 on point density](https://www.skogsstyrelsen.se/globalassets/om-oss/rapporter/rapporter-20222021202020192018/rapport-2022-19-okad-punkttathet-vid-nationell-laserskanning.pdf)

### NMD2023 tilläggsskikt — credential-free, CC0, two layers we want

Naturvårdsverket's Nationella marktäckedata 2023 ships additional layers as
national GeoTIFF zips with no login:

| layer | file | what it is | use here |
|---|---|---|---|
| Objekthöjd / objekttäckning v1.1 | `NMD2023_Tillaggsskikt_Objekthojd_objekttackning_v1_1.zip` (4.4 GB, 2025-07-21) | object height 0.5–5 m and 5–45 m plus coverage fraction, 10 m cells, computed from a 2 m raster derived from Laserdata skog 2018–2023 | same-source processing check of our CHM and canopy-presence mask at 10 m; north half only for the current scan |
| Trädslag v1.1 | `NMD2023_Tradslag_v1_1.zip` (7.9 GB, 2026-03-30) | 0–100 indication rasters for tall, gran, triviallöv and ädellöv (plus lärk, contorta, bok, ek), 10 m, MLSTM regression over Sentinel-2 2021–2023 trained on NFI plots | stand-level species-group prior; the only species evidence available without imagery |

The trädslag description carries a caveat that matters more on a golf course
than anywhere: *solitary trees, sparse stands and small forest patches carry a
high risk of wrong species*, young stands confuse pine and spruce, and thinned
spruce often reads as pine. It therefore supports `conifer-unknown` /
`deciduous-unknown` at stand level only, never a per-tree species claim.

- [NMD2023 tilläggsskikt directory](https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/)
- [Trädslag product description](https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/NMD2023_Produktbeskrivning_till%C3%A4gsskikt_Tr%C3%A4dslag.pdf)
- [Objekthöjd product description](https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/NMD2023_Produktbeskrivning_tillaggsskikt_Objekthojd_objekttackning.pdf)

### Meta / WRI Canopy Height Maps v2 — the independent-sensor canopy check

Released 2026-03-10, built on DINOv3 over high-resolution optical satellite
imagery, validated against ALS, GEDI and ICESat-2 (R² 0.86 against 0.53 for
v1), CC BY 4.0, on the AWS open data registry with no account. The tile over
Puttom is `forests/v2/global/dinov3_global_chm_v2_ml3/chm/1200130303.tif`
(Bing-quadkey naming, zoom 10): 223,795,118 bytes, 32768 × 32768 px, 8-bit,
deflate, 512 px internal tiles, EPSG:3857 at 1.1943 m per projected pixel —
about **0.54 m on the ground at 63.3° N** — last modified 2026-01-10.

It is optical and modelled, its imagery date is not published per pixel, and
it is not a survey. What it is good for is precisely what the laser cannot do
at Puttom: it is **one continuous sensor across the seam**, so it can say
whether a step in canopy height or forest edge at N 7025000 is in the forest
or in the campaigns. It also gives a canopy-presence opinion for the whole
zone-C ring. It must be reprojected to EPSG:3006 before use and never used as
a height authority.

- [AWS registry entry](https://registry.opendata.aws/dataforgood-fb-forestsv2/)
- [CHMv2 paper (Scientific Data, 2026)](https://arxiv.org/abs/2603.06382)
- [Release note](https://ai.meta.com/blog/world-resources-institute-dino-canopy-height-maps-v2/)

### Other sources, and why they are or are not used

| source | status | verdict |
|---|---|---|
| Lantmäteriet Ortofoto 2024 U2, 16 cm RGBI | ordered separately; assets answer `403` for this account | best evidence for zone-A review (crown outlines, NIR for deciduous/conifer) when the order lands; not waited for |
| Lantmäteriet Ythöjdmodell från flygbilder (image-matched DSM) | orderable in Geotorget | optional second canopy surface with the 2024 flight's date; a stereo DSM smooths gaps and crowns, so it is a check, not a candidate source |
| Lantmäteriet Topografi 10 vektor, mark | CC BY 4.0 | forest type (löv vs barr/bland) has not been revised since 2004; useful only as a coarse prior |
| Copernicus HRL Dominant Leaf Type / Tree Cover Density 2021, 10 m | free registration | redundant with NMD2023 trädslag, which is newer and Swedish-trained |
| SLU Skogskarta 2015, 12.5 m species volumes | open | too old for a 2026 registry |
| legacy Esri z17 tree cover | committed | comparison only; migration-only status unchanged |
| the superseded 2020 south scan `20f015-702_69` | in the catalogue | change reference for felling/growth 2020→2026 in the south half only; never mosaicked into canopy |

### The evidence hierarchy, stated once

| question | primary | check (same source, other processing) | check (different sensor) |
|---|---|---|---|
| where is canopy, how tall | Laserdata skog CHM | NMD2023 objekthöjd/täckning (10 m); Skogsstyrelsen trädhöjd if fetched | CHMv2 (0.54 m, optical) |
| where is a crown | Laserdata skog local maxima + segmentation | — | orthophoto when available; CHMv2 edges |
| conifer or deciduous, at stand level | NMD2023 trädslag | leaf-on return structure per campaign | Topografi 10 mark (coarse) |
| species of one tree | **nothing available** | — | orthophoto NIR / field / club photographs when they exist |
| what changed since the flight | 2026 scan vs 2020 scan (south half only) | — | CHMv2, legacy Esri, orthophoto |

## Architectural decisions

### 1. Keep source acquisition offline

Provider credentials and raw COPC URLs must never reach the browser. Source
data is acquired in a controlled local/CI compiler job. The public application
receives only compact, content-addressed derived object assets and attribution
metadata.

### 2. Fix correctness before range-efficiency, and make the target measurable

The existing remote COPC path can read the header/root population but has not
reliably descended the hierarchy for bounded Puttom windows. A sparse read must
never be interpreted as sparse forest.

The first correctness proof is a **hierarchy census**: read the LAS header,
the COPC info VLR and the hierarchy pages (about 200 KB per item) over
authenticated range requests, sum node point counts over the census windows,
and record the totals. No point bytes are decoded, so the census cannot be
wrong about the data in the way a reader can. Every subsequent bounded read —
local file or remote — must return within 1% of the census count for the same
window, or it fails. The census runs first because it is cheap, needs no
PDAL, and turns "the reader under-read" from an inference into a number.

Then stage the two active Puttom COPC files into an ephemeral,
access-controlled runner and run PDAL against local files. This removes
authentication/redirect behaviour from hierarchy traversal and gives a boring,
measurable baseline. The inputs are deleted after derived evidence and approved
outputs are written.

After local-file correctness is proven, a credential-injecting HTTP range cache
or proxy may restore bounded remote efficiency. Its output must be byte- and
candidate-equivalent to the local-file baseline. Optimizing the current
under-read path before establishing that baseline is rejected.

### 3. Separate individual candidates from stand representation

The compiler emits two logical products:

1. reviewed individual objects where evidence resolves a crown and the object
   matters to play or identity;
2. measured stand masks/density for dense forest where individual stems are not
   supportable.

The renderer may instantiate representative trees from a measured stand field,
but those instances must use `source-constrained-procedural`, never
`derived-lidar`, and they are not object-registry records. Zone A may not use
procedural large objects *as records*; how a dense zone-A stand is represented
is stated under truth zones below.

### 4. Keep biological appearance separate from positional truth

LiDAR can support height and approximate crown extent. It does not support an
exact pine/spruce/birch claim here, and the only species evidence without
imagery (NMD2023 trädslag) explicitly disclaims solitary trees and small
patches. The object subtype remains `null` or a conservative group such as
`conifer-unknown` / `deciduous-unknown` only when the stand-level prior and the
campaign's own return structure agree. Asset variation, colour, wind, and
seasonal response are rendering choices and must not alter recorded position,
height, radius, or provenance.

### 5. Cut over atomically inside an explicit coverage frontier

The legacy planter remains unchanged until a complete reviewed frontier is
available. At cutover, one mask determines ownership:

- inside verified v2 object coverage: load v2 object/stand assets only;
- outside it: retain legacy or zone-C scenery explicitly;
- no cell or tile may render both populations;
- a missing required object tile cannot expose the legacy population under
  `?v2=require`; it aborts v2 before installation.

### 6. The campaign seam is a design input, not an edge case

At Puttom the seam runs through the course, the campaigns are three years and
one sensor generation apart, and they do not overlap. Therefore:

- every derived cell, candidate and stand carries its campaign;
- nothing is averaged, blended or smoothed across N 7025000 — not the CHM, not
  a crown segment, not a stand density field; a crown segment that would cross
  the seam is cut at it and the halves are reconciled as candidates, with the
  reconciliation recorded;
- seam consistency is measured with references that are continuous across it:
  the published DTM (for ground), CHMv2 (for canopy presence and relative
  height), and NMD2023 trädslag (to stratify height comparisons by species
  group, because the north scan may have caught birch before full leaf);
- expected growth over the gap (three seasons, ~0.2–0.4 m/yr in young stands)
  is reported as an explained offset, not corrected into the data;
- intensity-based rules are calibrated per campaign or not used;
- a north re-fly, when it arrives, replaces the north campaign through the
  same precedence rule and the identity-preserving diff in Stage 6, with the
  seam metrics re-run.

### 7. The toolchain is PDAL + GDAL + Node; the crown compiler is Node

The pinned Pixi toolchain (`packages/course-geo/toolchain/pixi.toml`) contains
`libpdal-core` 2.10.2, `libgdal-core` 3.13.3 and PROJ 9.8.1 — **no Python, no
R**. PDAL has no local-maximum/watershed crown stage, and its point-based
`filters.litree` is not suited to 1–2 pulses/m². So the split is:

- PDAL: read, class filtering, per-campaign height above ground
  (`filters.hag_nn` against the cloud's own ground returns, `filters.hag_dem`
  against the DTM for the QA difference), and rasterisation
  (`writers.gdal`, `output_type=max`, 1 m, with a small search radius);
- GDAL: reprojection of CHMv2 and NMD clips into EPSG:3006, raster algebra,
  nodata handling;
- Node: the deterministic crown compiler — pit/void handling, smoothing, the
  height-adaptive local-maximum filter, marker-controlled watershed, stand
  classification, confidence terms, deduplication, identity matching — over
  Float32 rasters exported by GDAL, unit-tested with vitest on synthetic CHMs
  the way the codec and pack tests already are.

Adding Python (numpy/scipy/scikit-image) or R (lidR) to the lock is allowed
but is a reviewed toolchain change with its own gate; this plan does not
depend on it.

**Amendment, 2026-09-02.** The point-cloud stages also run in Node now, and
not only because this machine has no PDAL: Lantmäteriet's half-tile COPC
items subdivide the header extent per axis rather than the specification's
cube (see the checkpoint), so PDAL's node pruning reads the wrong ground on
them and a reader that knows the file's own rule is the correct one, not a
convenience. `packages/course-geo/copc-reader/` carries the one third-party
dependency (`copc` + `laz-perf`, WASM) in its own install, never in the
workspace lockfile or the browser build. PDAL remains available for
cross-checks where it is installed; where the two disagree, the node-exact
count is the arbiter. The reference practice the Node implementation follows is the
lidR book's: CHM from the highest return per cell with a sub-circle radius,
median smoothing, a variable-window local-maximum filter no narrower than 3 m,
and a Dalponte-style region growing on the smoothed CHM.

## Source and provenance ledger

Every compiler run must pin the following before reading source bytes:

| input | role | required record |
|---|---|---|
| Lantmäteriet `dsm-skoglig-copc` items `23f028-702_69` and `26f015-702_69` | canopy and object candidates | item ID, source URL identity without credentials, capture interval, bbox, `_info.json` sha256, point count, all-return and first-return density measured per window, bytes, multihash/checksum, terms version LM2026/077164 |
| Lantmäteriet `dsm-skoglig-copc` item `20f015-702_69` | change reference, south half only | as above, plus an explicit `excludedFromCanopy: true` |
| Lantmäteriet `dtm-cog` item `702_69` | bare-earth normalization QA and object base | item ID, `ursprung.json` sha256 and the per-patch capture dates it records, bbox, resolution, checksum, compiler generation |
| NMD2023 objekthöjd/täckning v1.1 | same-source canopy processing check | zip sha256, version, clip bbox, licence CC0 |
| NMD2023 trädslag v1.1 | stand-level species-group prior | zip sha256, version, clip bbox, licence CC0 |
| Meta/WRI CHMv2 tile `1200130303` | independent-sensor canopy check across the seam | object ETag/sha256, last-modified, licence CC BY 4.0, reprojection parameters |
| Skogsstyrelsen trädhöjd county zip | optional processing check, north half | zip sha256, cycle, licence CC0 — recorded only if fetched |
| approved ortho or survey | crown/stem review and signature trees | campaign/survey ID, capture date, resolution/accuracy, rights, checksum — when available |
| legacy Esri tree cover | comparison only | current committed hash, migration-only status |

Campaign precedence at Puttom:

1. north half: `23f028-702_69` until a newer item covering it passes the
   quality gate;
2. south half: `26f015-702_69`; `20f015-702_69` is read only by the change
   detector and never contributes a candidate;
3. select one campaign deterministically for each output cell/candidate by
   the seam line, not by distance or date arithmetic;
4. never average campaigns captured years apart into a fictional tree;
5. record the selected source ID on every derived object or stand tile.

If one output object depends on multiple source items, create a checksummed
derived-source record in the source manifest. Do not smuggle arrays or ad-hoc
lineage fields into the strict v1 object-registry schema; version the contract
if one source ID is insufficient.

The attribution string required by the laser terms — *Laserdata Nedladdning,
skog, © Lantmäteriet, bearbetad, CC BY 4.0* — is a field in the derived-source
record and is emitted into the published manifest.

## Canonical spatial contract

All processing uses:

- horizontal CRS: EPSG:3006, SWEREF 99 TM;
- vertical CRS: EPSG:5613, RH 2000;
- compound CRS: EPSG:5845;
- the committed Puttom frame fingerprint and reviewed origin;
- easting/northing order in source and registry assets;
- world mapping only at the runtime boundary.

Note that the COPC items' `boundary_json` in `_info.json` lists coordinates
as `[northing, easting]` while the LAS header, the STAC `proj:bbox` and the
CHMv2 tile are easting-first. The compiler reads bounds from the LAS header
and the STAC item, never from the boundary polygon, and asserts that the
points it reads fall inside the requested window.

The compiler must reject:

- absent or unexpected CRS metadata;
- swapped coordinate axes;
- candidates outside requested or source bounds;
- heights outside plausible source/DTM bounds;
- a source or object frame fingerprint that differs from the terrain graph;
- an object base sampled from a different DTM generation than the published
  terrain without an explicit, measured reconciliation.

All source windows use deterministic tile-aligned bounds plus a halo large
enough for local maxima, crown segmentation, stand-edge classification, and
cross-tile deduplication. The halo is compiler-only; each final object has one
owning tile. **The halo never crosses the seam**: a window touching N 7025000
is read from both campaigns and processed as two half-windows.

## Offline derivation pipeline

### Stage 0 — hierarchy census (credential-safe, no PDAL)

For each pinned item, over authenticated HTTP range requests:

1. read bytes 0–374 (LAS 1.4 header): version, PDRF, point count, scale,
   offset, min/max; compare with `_info.json` and the STAC item;
2. read the COPC info VLR at 375: centre, half-size, spacing, root hierarchy
   offset/size; compare with `_info.json`;
3. read the root hierarchy page and, recursively, every sub-page whose node
   intersects a census window; parse 32-byte entries (key, offset, byte size,
   point count; −1 marks a sub-page);
4. for each census window — the AOI, a 1024 m square centred on the origin
   (which straddles the seam on purpose), 512 m squares immediately north and
   south of the seam, and the per-hole 256 m control windows — sum node point
   counts weighted by area overlap, per octree depth, and report total points,
   implied all-return density, and the number of empty deepest-level nodes
   inside the window;
5. persist the numbers, the item IDs and the `_info.json` hashes; persist no
   URL with credentials and no point bytes.

Gate: the census reproduces the header point count when every page is read,
and the per-window totals become the reference every later read is held to.

### Stage 1 — acquire and verify source bytes

1. Re-run the STAC search for the AOI; refuse to proceed if the set of items,
   their `updated` timestamps or their asset checksums differ from the pinned
   set without an explicit re-pin.
2. Apply the campaign precedence above and pin exact item IDs, including the
   excluded 2020 item.
3. Download the two active COPC files (1.06 GB + 0.73 GB) and the DTM into an
   ephemeral work directory; verify advertised size, sha256/multihash, LAS
   header, bounds, point record format, CRS, and capture dates.
4. Count points over full source bounds and every census window with PDAL
   against the local files; each count must be within 1% of the Stage 0
   census for that window.
5. Measure first-return (pulse) density and all-return density per window per
   campaign, and record both with their definitions.
6. Run the same bounded reads through any proposed range proxy/cache and prove
   equivalent counts and statistics.
7. Fetch the credential-free references — the CHMv2 tile, the two NMD zips
   (clipped to the AOI plus halo and then discarded), optionally a
   Skogsstyrelsen county zip — and checksum the clips.
8. Stop with `source-incomplete` if observed density, spatial coverage, or
   classification evidence cannot support the next stage.
9. Persist credential-free acquisition evidence and delete temporary raw bytes
   at the end of the job.

The compiler must represent nodata separately from zero-height/open ground.
Nodata is a blocker or fallback boundary, never a clearing.

### Stage 2 — normalize the point cloud, per campaign

1. Remove declared low/high noise classes (7, 18); keep 1, 2, 9, 17.
2. Preserve ground, water, bridge, return-number, number-of-returns,
   scan-angle, intensity, GPS-time and flight-line dimensions for diagnostics.
3. Compute height above ground for non-ground returns against the ground
   returns **of the same campaign** (`filters.hag_nn`); this is the primary
   normalisation and carries no cross-product registration error.
4. Compute the same heights against the published DTM (`filters.hag_dem`) and
   difference the two over stable open control points and over the whole
   window; report the difference map. Under the south half the DTM is from
   2020 and the cloud from 2026, so a non-zero difference there is expected
   where the course has been reshaped; it is reviewed, not suppressed.
5. Reject or split flight lines/campaigns with unexplained vertical offsets
   against the quality description's 0.15 m between-strip figure.
6. Flag water, buildings, bridges, and known structures before canopy analysis.
7. Record per-campaign class fractions, return statistics and intensity
   ranges; these feed the confidence terms and the seam report.

### Stage 3 — build canopy and stand fields

Produce at least, per campaign and then stitched at the seam without blending:

- 1 m canopy-height model from the highest normalized return per cell, using a
  small point radius (0.25–0.35 m) so a return near a cell corner fills its
  neighbours, then 3 × 3 median smoothing for the detection copy only (the
  height copy stays unsmoothed);
- an explicit void mask: cells with no return within 1.5 m. At 2.8–3.2 returns
  per m² clustered on 1.3–1.8 pulses per m², a fair fraction of 1 m cells
  will be empty in the raw grid — measure the fraction; do not fill voids
  wider than one cell inside canopy, and never fill across the seam;
- canopy-presence mask at ≥ 2 m (the threshold already declared in
  `canopy-window.mjs`), plus a ≥ 0.5 m shrub mask;
- local pulse density and completeness;
- stand-edge distance;
- crown-height variability/roughness;
- campaign ownership per cell;
- confidence components before they are collapsed into one score.

Cross-checks, each recorded as a measurement:

- canopy-presence and 5–45 m height against NMD2023 objekthöjd/täckning at
  10 m (same source, other processing — a disagreement is about processing);
- canopy presence and relative height against CHMv2 resampled to 1 m
  (different sensor — a disagreement is about the forest or the date);
- height distributions on each side of the seam, stratified by NMD2023
  trädslag class, in stands that straddle it.

The first baseline follows the official product's scale: a 1 m grid with
conservative void handling. A 0.5 m experiment may be used only where measured
pulse density supports it. A visually attractive fine raster cannot invent
returns that were never captured.

### Stage 4 — derive individual crown candidates

Starting parameters, declared here before any measurement so a later change is
a recorded decision and not a fit to a screenshot:

- local maxima on the smoothed CHM with a height-adaptive circular window,
  `ws(h) = clamp(2 + 0.10·h, 3, 6)` m, minimum candidate height 3 m;
- crown regions by marker-controlled region growing on the smoothed CHM
  (Dalponte-style seed 0.45 and crown 0.55 of the apex height, maximum crown
  radius 10 m), constrained by canopy height, saddles, stand edges and the
  seam;
- crown centre = the segment's height-weighted centroid, labelled
  `crown-centre-derived`; the apex position is kept separately;
- height = the unsmoothed CHM maximum in the segment; radius = the
  equivalent-area radius of the segment.

Then:

1. Estimate crown completeness and separation from neighbouring crowns.
2. Reduce confidence near voids, tile and campaign boundaries, buildings,
   water, steep ground, and unresolved multi-crown stands.
3. Keep isolated high-confidence crowns as individual candidates.
4. Move unresolved dense regions to stand representation rather than forcing
   one unreliable object per maximum.
5. Set uncertainty floors that the data cannot beat: horizontal ≥ 1.5 m (crown
   centre versus stem, plus 0.3 m source plan error) and vertical ≥ 1.5 m
   (apex miss at this pulse density) for every `derived-lidar` record; a
   record may carry larger values, never smaller.
6. Expect and report, per representative window, the detection rate against
   review (the literature's ~75% of dominant trees at 2–4 points/m² is the
   yardstick, not a target to reach by loosening thresholds).

Candidate confidence should combine independently inspectable terms:

- source completeness/pulse density;
- height-above-ground support;
- crown peak prominence;
- crown segmentation compactness;
- distance from voids and campaign/tile boundaries;
- agreement with NMD2023 objekthöjd and CHMv2;
- orthophoto/manual confirmation where available;
- scan recency (2026 south, 2023 north).

The raw components belong in compiler review evidence even if runtime stores
only the final `confidence` value.

Species group, when claimed at all: `conifer-unknown` or `deciduous-unknown`
requires the NMD2023 trädslag indication for that group to be ≥ 70 in the
containing 10 m cell *and* the candidate's own leaf-on return structure not to
contradict it; otherwise `subtype` is `null`. NMD's own caveat about solitary
trees means most zone-A trees will stay `null` until an orthophoto or a field
record exists, and that is the correct outcome.

### Stage 5 — apply semantic exclusions

After derivation, intersect candidates and stands with the approved geometry
for:

- greens, tees, fairways, fringes, semi-rough, bunkers, and maintained paths;
- water and shoreline exclusion bands;
- buildings and facility yards;
- roads and parking;
- power-line corridors;
- recent clear-fells or other newer evidence, including the 2020→2026 change
  map in the south half;
- survey overrides.

Every rejection must carry a machine-readable reason in compiler evidence.
Exclusions remove false candidates; they must not erase a real reviewed
signature tree merely because a provisional surface polygon overlaps it. Zone-A
conflicts go to review.

### Stage 6 — deduplicate and preserve identity

1. Deduplicate halo/cross-tile candidates before assigning ownership.
2. Reconcile seam candidates using spatial proximity, crown overlap, height
   and campaign precedence; record each reconciliation.
3. Match a new registry against the prior registry and preserve stable IDs for
   unchanged trees.
4. Classify unmatched prior trees as `missing-needs-review`, not automatically
   felled.
5. Assign new deterministic IDs only after matching is complete.
6. Sort records by ID as required by the object-registry validator.

Stable identity must survive harmless sub-metre compiler shifts and a north
re-fly. IDs must not be raw hashes of a floating-point coordinate or capture
date, because either would replace every tree after a new flight.

## Truth zones and review policy

| zone | area | allowed placement |
|---|---|---|
| A | playing corridors plus an approved 80-100 m buffer, facilities, landmarks, signature sightlines | approved `derived-lidar`, digitized, or survey objects; a measured-stand payload where crowns are unresolvable, with its boundary evidence-derived at 1 m and reviewed; no procedural large objects as records |
| B | remaining physical course property | measured canopy/stand truth; reviewed individual large trees; confidence-gated source-constrained representative vegetation allowed |
| C | distant surroundings and horizon | source-constrained procedural or clustered scenery allowed, constrained by CHMv2 canopy presence where the tree-cover raster ends |

Zone A needs a rule for dense stands, because at 1–2 pulses/m² most stems in
a closed stand will not resolve and a 100 m corridor buffer is mostly closed
stand. The rule: the stand's outer edge — the row a golfer sees — is resolved
individually wherever the CHM can (edge trees have open ground on one side and
resolve far better than interior stems), and the interior is a measured-stand
payload whose density and height distribution come from the CHM. Its
representative instances are rendering, not records; the registry validator's
zone-A prohibition on `source-constrained-procedural` applies to records and is
untouched.

Zone A requires:

- per-hole review overlays showing source canopy, candidate centre/radius,
  exclusions, confidence, campaign and scan date, cross-check agreement, and
  rendered asset;
- approval for every published record;
- survey or independent digitization for signature/play-affecting objects when
  LiDAR uncertainty is too high;
- no unknown coverage gap hidden by procedural trees;
- explicit review of trees near tees, greens, dogleg sightlines, landing zones,
  and water carries, and of every tree within 30 m of the seam.

## Object-registry compilation

Each approved individual tree is compiled into the existing strict record:

| field | rule |
|---|---|
| `id` | stable across equivalent rebuilds and preserved across matched campaigns |
| `groundId` | `puttom` |
| `class` | `tree` |
| `subtype` | `null` unless the Stage 4 species-group rule is met; never a fabricated species |
| `easting`, `northing` | canonical derived crown/base candidate in EPSG:3006 |
| `heightRH2000` | base height sampled from the exact approved v2 DTM generation |
| `objectHeightMetres` | confidence-gated canopy height, not procedural scale |
| `radiusMetres` | derived/reviewed crown radius |
| `headingDegrees` | deterministic rendering orientation; not a measured biological property |
| `sourceId` | checksummed source/derived-source manifest record naming the campaign |
| `capturedAt` | acquisition date of the selected campaign (2023-06 north, 2026-06 south) |
| `accuracyTier` | source-honest tier; zone A permits only A/B/C |
| `horizontalAccuracyMetres` | derived uncertainty, ≥ 1.5 m for `derived-lidar` |
| `verticalAccuracyMetres` | combined DTM/canopy/base uncertainty, ≥ 1.5 m for `derived-lidar` |
| `confidence` | declared composite backed by review evidence |
| `reviewStatus` | `approved` for every published runtime record |
| `truthZone` | A, B, or C |
| `placementMethod` | `derived-lidar`, `digitized`, `survey`, or `source-constrained-procedural` as actually used |

Compiler output must:

1. emit one valid object-registry payload per owning tile;
2. wrap it in a `kind: "objects"` BVCH envelope;
3. content-address encoded and decoded bytes;
4. populate `tiles[].layers.objects` atomically;
5. add required feature negotiation for the object payload/registry version;
6. verify bounds, record count, hashes, IDs, source IDs, and approval metadata;
7. reject unreviewed zone-A records;
8. carry the licence attribution string in the manifest;
9. generate a registry diff and review summary before publishing.

Measured stand fields need their own explicit payload/version. They must not be
encoded as thousands of fake `derived-lidar` individuals.

## Runtime integration

### Loader and lifecycle

The generic v2 loader can understand object chunk envelopes, but today's live
Puttom path does not install or render object layers. Runtime work must add:

1. object-layer references to tile scheduling and capability negotiation;
2. verified decode in the existing worker/bounded-cache path;
3. stale-reply suppression and per-scope cancellation;
4. reference-counted GPU resource ownership and eviction;
5. object-tile availability in the v2 preflight decision;
6. explicit coverage/ownership state exposed in `window.V3D` diagnostics.

Under `?v2=require`, every required zone-A object chunk must be present,
supported, hash-valid, frame-valid, and approved before v2 installs. A partial
object frontier does not mix silently with the legacy planter.

### Rendering

Use backend-common instance data and species-neutral geometry families:

- conifer-unknown;
- deciduous-unknown;
- shrub/young-tree group where evidence supports only structure;
- stand impostor/cluster for unresolved dense forest.

Instance position, height, and crown radius come from the registry. Geometry
variation, colour, wind phase, and rotation may be deterministic artistic
variation. They must not change the recorded geospatial envelope.

Tree bases must use the same visible-ground contract as terrain, camera, and
water. At load time:

1. transform canonical E/N to the Puttom world frame;
2. sample the exact visible terrain frontier;
3. compare it with the record's `heightRH2000` base;
4. reject/report a mismatch beyond the accepted tolerance;
5. place the rendered base on the shared piecewise terrain height so LOD/morph
   behaviour cannot make the tree float.

### Legacy ownership switch

Refactor the current planter into explicit populations:

- `legacyCourseTrees` — current `M.cover`/OSM lattice;
- `v2ReviewedTrees` — object registry;
- `v2MeasuredStands` — source-constrained stand renderer;
- `distantSceneryTrees` — zone C.

The coverage mask is evaluated before candidate generation. Do not generate
legacy course trees and later hide them; that wastes boot time and makes
duplicate ownership difficult to test.

## Phased implementation

### Phase 0 — freeze and measure the baseline

1. Preserve the current GPK1 pack, tree-cover hash, v2 terrain descriptor, and
   fixed screenshots.
2. Add a debug export of the generated legacy tree instances: X/Z/Y, species,
   scale, reason/source class, and count per hole/zone.
3. Capture current tree counts, boot time, draw calls, active memory, and views
   from every tee plus selected overhead/free views.
4. Add a runtime assertion that current v2 has zero object-tile references so a
   future partial integration cannot masquerade as complete.

Gate: the baseline is reproducible and no acquisition/runtime change has been
made.

### Phase 1 — repair authoritative acquisition

1. Order/verify the Geotorget entitlement under the 2026-06-01 terms and put
   a working Lantmäteriet pair in the runner's secrets. On 2026-09-02 the pair
   in the local `.env` was refused with `401` by `dl1.lantmateriet.se` for the
   DTM COG as well as the COPC assets, while the STAC API accepted it, and
   `access-preflight.mjs --provider lantmateriet` reported `denied`. The same
   account read the DTM on 2026-08-30, so this is an account or entitlement
   change to resolve in Geotorget (Laserdata skog access had to be re-ordered
   under the new terms; a separate API username may apply), not a code
   problem. Nothing in Phase 1 proceeds until the preflight is `ready`.
2. Run the Stage 0 hierarchy census for all three items and commit its
   credential-free output.
3. Stage the two active Puttom COPC files locally in an ephemeral runner.
4. Prove full-density local bounded reads against the census, window by window.
5. Record credential-free acquisition evidence, hashes, capture dates, and
   timings.
6. Run the same bounded reads through any proposed range proxy/cache and prove
   equivalent counts/statistics.
7. Acquire the matching DTM and its `ursprung.json`; acquire the CHMv2 tile and
   the NMD2023 clips; record the licence and attribution for each.
8. Update manifest lifecycle only after retained derived artifacts exist; fix
   the manifest's Skogsstyrelsen access note (the open route is HTTPS ATOM
   zips under CC0, not an FTPS distribution).

Gate: complete source windows pass census, density (with its definition),
bounds, CRS, date, checksum, and nodata gates. The old 52-point under-read
cannot pass.

### Phase 2 — one representative derivation window across the seam

Choose the 1024 m origin-centred window: it contains dense forest, open and
isolated trees near a playing corridor, and both campaigns.

1. Build per-campaign HAG/CHM, void mask and diagnostics.
2. Compare 1 m and evidence-supported finer experiments.
3. Generate local maxima, crown segments, stand masks, and confidence terms
   with the declared starting parameters.
4. Run the NMD and CHMv2 cross-checks and the stratified seam comparison.
5. Inspect false positives over buildings, turf, water, and slopes.
6. Review candidates with a domain-aware human before tuning thresholds;
   record every parameter change beside its measurement.

Gate: the compiler distinguishes nodata, open ground, isolated candidates, and
unresolved stand canopy; the seam report explains every step at N 7025000 as
forest, growth, leaf state or sensor; no visual result is promoted merely
because it looks forest-like.

### Phase 3 — first real reviewed object tile

1. Finalize stable IDs and source records.
2. Review every zone-A candidate in the tile.
3. Emit one real BVCH object-registry chunk and, if the tile holds a dense
   stand, its stand payload.
4. Run strict decode, bounds, hash, approval, attribution and registry-diff
   tests.
5. Render it in an isolated harness on WebGL2 and WebGPU.
6. Compare registry height/radius/base with compiler evidence.

Gate: one content-addressed object tile is source-honest, reviewed, and renders
without the legacy planter.

### Phase 4 — live opt-in integration

1. Add object loading/instancing behind a separate development capability flag.
2. Include the first reviewed frontier in source selection/preflight.
3. Prevent legacy-tree generation inside that frontier.
4. Fail the whole frontier closed on missing/corrupt object assets.
5. Exercise camera changes, hole switching, cache eviction, cancellation, and
   backend changes.
6. Keep normal visits and GPK1 unchanged.

Gate: no duplicate, missing, floating, or stale trees across repeated loads and
view changes.

### Phase 5 — full Puttom property and per-hole review

1. Compile all required source windows with the campaign precedence above.
2. Generate and review every zone-A tile/hole.
3. Publish zone-B stand masks and reviewed large objects.
4. Retain explicit zone-C scenery, constrained by CHMv2 beyond the raster.
5. Run whole-course registry diff, seam and source residual reports.
6. Capture the complete visual matrix and performance evidence on hardware.

Gate: 18/18 holes pass source, review, visual, and performance gates with 100%
required zone-A coverage.

### Phase 6 — atomic release and default decision

1. Generate source records, object chunks, manifests, descriptors, expected
   hashes, required features, attribution and app constants in one release
   command.
2. Verify the exact URL `?bana=puttom&v2=require` with no fallback.
3. Publish runtime assets and application references atomically.
4. Retain GPK1 fallback and the prior immutable v2 generation.
5. Change a default only after a separately reviewed release decision.

Gate: production fetches the same verified generation tested in CI and rollback
is one manifest/app reference change.

## Acceptance gates

### Acquisition and provenance

- Every source item is authorized, dated, checksummed, and inside the declared
  CRS/bounds, and the pinned STAC item set is unchanged or explicitly re-pinned.
- Every bounded read agrees with the hierarchy census within 1% per window.
- Pulse density and all-return density are both recorded with their
  definitions; no gate is stated against an unlabelled "density".
- Nodata, source gaps, water, and true open ground are distinct states.
- No credential, Authorization header, signed URL, raw COPC, or temporary
  raster exists in a public artifact or log.
- Campaign precedence is deterministic, every output carries its campaign, and
  the 2020 south item contributes no candidate.
- The published manifest carries the laser attribution string and the GDPR
  assessment record.

### Compiler correctness

- Repeated builds from identical inputs are byte-identical.
- Halo/shared-border canopy fields are identical.
- Cross-tile and cross-campaign candidates contain no duplicates.
- Every record validates against the strict object-registry and chunk envelope.
- Every published record has one stable ID, source ID, capture date, confidence,
  accuracy at or above the declared floors, truth zone, placement method, and
  `approved` status.
- Every rejection/exclusion has an auditable reason.
- No sparse or failed input is interpreted as a clearing.
- No exact species is inferred from Laserdata alone; species groups meet the
  Stage 4 rule.

### Spatial and terrain correctness

- All object records use EPSG:3006/RH 2000 and the exact Puttom frame
  fingerprint.
- Zero published candidates lie in water, buildings, maintained hard surfaces,
  or outside their owning tile.
- Surface-overlap conflicts in zone A are reviewed rather than silently erased.
- Runtime tree bases agree with the exact visible v2 terrain within the measured
  tolerance and never float or sink during LOD/morph transitions.
- The seam report at N 7025000 attributes every canopy step to forest, growth,
  leaf state or sensor, with the CHMv2 and NMD comparisons attached; no
  unexplained step remains.

### Truth and review

- 100% of required zone-A extent has approved source coverage.
- 100% of published zone-A objects are individually reviewed.
- Signature and play-affecting trees have independent confirmation or survey
  where crown-centre uncertainty is not sufficient.
- Dense stands are represented as measured canopy/density, not fabricated
  individual LiDAR trees; stand edges along corridors are resolved individually
  where the CHM supports it.
- Registry diffs explicitly list added, matched, moved, and missing candidates.

### Runtime integrity

- Every required object reference is content-addressed and encoded/decoded-hash
  verified.
- `?v2=require` fails before scene installation on missing, corrupt, stale,
  unsupported, unapproved, or frame-mismatched object data.
- Zero legacy course candidates are generated inside active verified v2
  coverage.
- Zero v2 candidates are generated twice across tile seams.
- Cancellation, stale replies, cache eviction, and course navigation release
  object resources without leaks.

### Visual matrix

At minimum capture:

- every tee view;
- holes with trees close to tees, greens, doglegs, water carries, and landing
  zones;
- top-down coverage/debug views;
- free/oblique views along and across the campaign seam;
- eye-height close views of isolated trees and dense stand edges;
- evening, day, dawn, autumn, and fog presets;
- WebGL2 mobile, WebGL2 desktop, and WebGPU desktop.

Review must confirm:

- the forest/open boundary follows evidence rather than the old 3 m Esri cells;
- important individual trees appear in defensible positions and scale;
- dense forest does not become an artificial orchard or sparse random lattice;
- there are no trees on maintained playing surfaces, buildings, roads, or
  water;
- no duplicate populations appear at the v2 frontier;
- no tree floats, sinks, pops excessively, or changes identity with backend;
- nothing visible marks the seam except what the seam report explains;
- unknown species are rendered plausibly without being labelled as measured.

### Performance

Before setting hard budgets, record the Phase 0 baseline and Phase 3 one-tile
cost. The release must then pin and enforce:

- encoded/decoded object bytes per tile and active frontier;
- total instance count by truth zone and representation;
- CPU derivation/instance-build time;
- worker decode and transfer time;
- GPU instance-buffer and geometry memory;
- draw calls and LOD batches;
- boot time and frame-time change on target mobile/desktop hardware;
- cache residency and eviction behaviour.

Any regression over the agreed measured budget blocks release. SwiftShader
screenshots are rendering evidence, not hardware performance evidence.

## Deliverables

The implementation is expected to produce:

- the credential-safe COPC hierarchy census tool and its committed output;
- credential-safe COPC local-stage/range-cache acquisition support;
- full-density Puttom acquisition evidence for both campaigns;
- credential-free reference acquisition (CHMv2 tile, NMD2023 clips) with
  checksums and licences;
- canonical per-campaign HAG/CHM, void-mask and stand-field compiler;
- crown candidate, exclusion, confidence, seam-reconciliation and
  deduplication modules, in Node over PDAL/GDAL rasters, with unit tests;
- the seam report;
- per-hole/zone review overlays and approval records;
- stable registry-diff tooling;
- real Puttom object-registry BVCH chunks;
- a versioned measured-stand payload;
- non-null `layers.objects` references in the Puttom graph;
- shared WebGL2/WebGPU object-tile instancing and lifecycle support;
- a coverage ownership mask and legacy-planter cutover;
- integrity, geospatial, seam, review, visual, and performance tests;
- source attribution and rebuild/change reports.

## Rollback and failure behaviour

- Keep GPK1 and every previously published v2 generation immutable.
- Publish object chunks, descriptor/manifest references, feature requirements,
  and expected hashes as one atomic generation.
- Do not overwrite content-addressed assets.
- If preflight fails before installation, use the complete GPK1 path for normal
  optional v2 visits; `?v2=require` reports the exact blocker.
- Do not fall back per missing object tile inside an installed v2 zone-A
  frontier. Per-tile fallback would create invisible gaps or duplicate trees.
- A rollback changes the selected manifest/app reference, not source assets or
  Git history.
- Keep the legacy tree-cover raster available for regression comparison until
  the v2 object generation has passed a full release cycle.

## Security and operations

- Provider usernames/passwords belong only in local environment variables or CI
  secrets and must never be committed, printed, serialized, or embedded in
  URLs. `.env` is gitignored; keep it that way and keep the variable names the
  acquisition code expects (`LANTMATERIET_USERNAME` / `LANTMATERIET_PASSWORD`
  or `LANTMATERIET_BEARER_TOKEN`, `SKOGSSTYRELSEN_USERNAME` /
  `SKOGSSTYRELSEN_PASSWORD`).
- Rotate any credential that has appeared in a chat, terminal capture, log, or
  screenshot before running acquisition.
- Raw COPC and temporary rasters stay outside the repository and public build;
  the laser terms make the licensee the GDPR controller for the raw cloud.
- Use a dedicated ephemeral work directory with cleanup in `finally`/post-job
  steps.
- Persist only approved derived assets, credential-free source identity,
  checksums, measurements, review evidence, and required attribution.
- New flights (a north re-fly in particular), felling, construction, and course
  changes trigger an offline rebuild and registry diff; they do not mutate
  runtime trees dynamically.
- A scheduled rebuild must never publish automatically merely because a source
  date changed. Review remains a release gate.

## Decisions to record during implementation

The plan fixes the architecture but leaves measured choices to the pilot:

- final CHM resolution and void-handling rule;
- adaptive local-maximum/crown segmentation parameters, starting from the
  declared values;
- source completeness and candidate-confidence thresholds;
- exact zone-A geometry and review owner;
- the seam reconciliation rule for crowns cut at N 7025000;
- horizontal/vertical uncertainty model above the declared floors;
- whether a Skogsstyrelsen county zip (8.6 GB / 24.1 GB) is worth fetching as
  an additional processing check for the north half;
- whether to order the Ythöjdmodell från flygbilder alongside the orthophoto;
- independent orthophoto/survey source for signature trees;
- measured-stand payload and rendering density contract;
- stable cross-campaign matching rule, exercised against a synthetic re-fly;
- object tile size/LOD and active memory budgets;
- performance regression budget;
- whether Python or R enters the toolchain lock;
- date/owner for the default-release decision.

Each decision must be written beside its measurement and test. A parameter
chosen after looking at one attractive screenshot is not a source-quality gate.

## Primary references

Repository:

- [Puttom source manifest](../geo_data/course-v2/puttom/source-manifest.json)
- [Puttom D2 discovery evidence](../geo_data/course-v2/puttom/acquisition/d2-discovery.json)
- [Course digital-twin implementation plan](course-digital-twin-implementation-plan.md)
- [V2 object-registry contract](../packages/course-v2/object-registry.mjs)
- [Canopy window pipelines](../packages/course-geo/acquisition/canopy-window.mjs)
- [Toolchain manifest](../packages/course-geo/toolchain/pixi.toml)
- [Puttom legacy tree-cover producer](../puttombuild/build-treecover.py)
- [Current runtime planter](../apps/golf/src/main.js#L2893)

Lantmäteriet:

- [STAC search used for the item table](https://api.lantmateriet.se/stac-hojd/v1/search?collections=dsm-skoglig-copc&bbox=18.9,63.28,18.98,63.32)
- [Per-item metadata, north](https://dl1.lantmateriet.se/hojd/pub/pointcloud/sls/23f028/m23f028-702_69_info.json)
- [Per-item metadata, south](https://dl1.lantmateriet.se/hojd/pub/pointcloud/sls/26f015/m26f015-702_69_info.json)
- [DTM origin metadata](https://dl1.lantmateriet.se/hojd/pub/grid/mhm/70_6/m702_69_ursprung.json)
- [Laserdata Nedladdning, skog (Geotorget)](https://geotorget.lantmateriet.se/dokument/projects/laserdata-nedladdning-skog-api/released/1/)
- [Product description v1.6](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/pb_laserdata_nedladdning_skog.pdf)
- [Terms of use LM2026/077164](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf)
- [Provision change notice, 2026](https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/uppdatering-angaende-tillhandahallandet-av-laserdata-nedladdning-skog/)
- [Quality description for laser data](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/hojddata/kvalitetsbeskrivning_laserdata.pdf)
- [STAC-höjd API](https://api.lantmateriet.se/stac-hojd/v1/api.html)

Skogsstyrelsen:

- [Download page and ATOM feeds](https://www.skogsstyrelsen.se/laddanergeodata)
- [Scan-area metadata service](https://geodpags.skogsstyrelsen.se/arcgis/rest/services/Geodataportal/GeodataportalVisaSkogligaGrunddataMetadata/MapServer)
- [Tree-height technical specification](https://www.skogsstyrelsen.se/globalassets/sjalvservice/karttjanster/geodatatjanster/teknisk-beskrivning/raster-tradhojd-laserdata-skog---teknisk-beskrivning.pdf)
- [Report 2022-19, point density in national laser scanning](https://www.skogsstyrelsen.se/globalassets/om-oss/rapporter/rapporter-20222021202020192018/rapport-2022-19-okad-punkttathet-vid-nationell-laserskanning.pdf)

Naturvårdsverket:

- [NMD2023 tilläggsskikt](https://geodata.naturvardsverket.se/nedladdning/marktacke/NMD2023/Tillaggsskikt/)

Meta / WRI:

- [CHMv2 on the AWS open data registry](https://registry.opendata.aws/dataforgood-fb-forestsv2/)
- [CHMv2 paper](https://arxiv.org/abs/2603.06382)

Method:

- [lidR book, individual tree detection and segmentation](https://r-lidar.github.io/lidRbook/itd.html)
