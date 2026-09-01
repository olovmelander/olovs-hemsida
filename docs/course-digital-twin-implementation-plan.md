# Course digital twin — terrain, surfaces and real-world objects

> **Status 2026-08-31:** D0–D4 foundations are implemented and the retained
> Puttom pilot now has an interactive, opt-in `?v2=1` preview: 16 verified 1 m
> terrain BVCH tiles and 16 matching migration-surface BVCH tiles replace the
> matching legacy core in one logical terrain draw. The renderer now compiles
> and draws that complete v2 batch offscreen before legacy construction and
> omits 56,169 of Puttom's 123,175 CORE base-grid points behind an 8 m normal/
> detail guard. The bridge into the legacy frame now carries the derived
> meridian convergence and the frame's own scale, which took the pilot's
> disagreement with PROJ from a 21 m median to 1.7 cm. Actual builder omissions, not planned counts, enter the capture
> gate. Any later install failure disables v2 heights, disposes v2 and rebuilds
> the full GPK1 CORE before boot continues. The accepted provider-run evidence remains 58.19%
> visible foreground in forced
> WebGL2 and 58.15% through the WebGPU render-target readback. In this branch a
> single visible-ground sampler now feeds surface construction, water probes,
> camera constraints, ball/interactions and scenery placement after the meshes
> are installed. It selects the verified v2 height only after the preview batch
> and legacy cut both succeed, then falls back to the rendered legacy mesh and
> finally the analytic legacy terrain. A tested `V2TerrainLiveAdapter` now owns
> the retained frontier's validation, one-draw batch lifecycle, two-stage height
> gates, fallback state and telemetry behind the existing flag. One generic,
> tested selection boundary now decides the v2 source per course behind that
> flag: a published graph resolved through `CourseV2ManifestLoader` and refused
> unless its declared v1 fallback is byte-for-byte the live GPK1 pack, then the
> retained pilot, then the explicit GPK1 fallback state. Graph resolution is
> gated on a build-time registry of published slugs — empty today — so no
> visit probes for a root that is not there, and `check-app-build` fails when
> the registry and the built `courses/v2-index.json` disagree in either
> direction, verifying a registered graph offline chunk-by-chunk against the
> live GPK1 index. `?v2=require` fails closed again as once documented: any
> fallback on the required path, terrain preflight and installation included,
> becomes an explicit boot error instead of a silent GPK1 downgrade, and the
> capture harness now proves at runtime that a flagless visit makes zero v2
> requests and loads zero v2 code chunks. The generic
> manifest-driven streaming renderer remains unselected, but no longer for want
> of data: the full aligned Puttom AOI is now acquired, compiled and published
> as a real course/ground graph that the live app resolves and verifies. The
> retained 1,024 m window could not describe the whole course — hole 16 lay
> wholly outside it — so a second 2,049 m window was taken from the same
> authenticated DTM item, and the retained pilot is an exact subgrid of it:
> 1,056,778 of 1,056,784 samples identical, the remaining six tied at one
> centimetre quantum between two compilations with different quantization
> origins. Activating the streaming renderer against that graph is now a
> rendering-evidence question, not an acquisition one. D5 now has
> a strict 14-byte lossless
> surface-grid contract for primary/secondary class IDs, signed boundary
> distance, owning feature, mow fields and material fields. Its first Puttom
> compiler runs the existing GPK1 migration vectors through the same precedence
> raster as the live atlas, preserves shared 1 m seams, hashes every output and
> binds the descriptor to both the terrain descriptor and the verified GPK1
> pack. The four continuous environmental fields are explicitly zero/unmeasured.
> It is **not** surveyed surface truth and remains opt-in. D6 now has a
> canonical object-registry contract with stable IDs, source date, confidence,
> accuracy, review state and zone; published zone-A records reject procedural
> placement and tiers below C. Both new asset kinds pass Node and browser-path
> decoding in the synthetic shared-ground graph. They are format foundations,
> not claims that real surface polygons or object inventories have been
> compiled. A separate authoritative-surface intake now requires an approved
> source manifest, licence, checksum, dates, measured accuracy, canonical frame,
> human review and valid multipolygon topology; it deterministically compiles
> synthetic proof tiles but Puttom correctly fails because those approvals and
> source polygons do not yet exist. The preview loader also no longer retains a
> redundant decoded channel copy, removing about 32.25 MiB of transient Puttom
> startup allocation. The real-app proof is now fail-closed across mobile and
> desktop forced WebGL2 plus desktop WebGPU: it captures an explicit noon/overhead
> view, removes HUD pixels from presentation evidence, analyses distributed
> central image structure and requires a bounded RGBA8 readback of the active
> WebGPU pipeline. Surface IDs are inventoried from each verified tile's union
> of primary and secondary channels, while acceptance requires non-zero class
> coverage reconstructed from the signed distance. Primary shader coverage is
> kept separate so Puttom rough cannot be falsely reported absent. A blank
> SwiftShader swap surface stays recorded as blank and
> can no longer pass because its surrounding UI happens to vary. The capture is
> deterministic software-adapter shader evidence, never hardware performance or
> production approval. Candidate origins remain unapproved, authenticated source rollout
> remains incomplete, and hardware canvas/performance evidence is still a
> release gate. `GPK1` remains the production default. This plan extends,
> rather than reopens, the completed work in `docs/ground-atlas-plan.md`.

## Immediate continuation order

1. Keep the live-adapter boundary, shared height sampler, D5/D6 contracts and
   the Puttom surface migration preview green in CI; normal visits must continue
   to make no v2 request.
2. Obtain and review authoritative Puttom surface polygons (club CAD/GIS,
   maintenance drawing or independently validated field survey), record licence,
   date and accuracy, then replace—not merge with—the migration source.
   **Both remote routes to surface truth are now measured and closed.** The
   1 m DTM cannot resolve this course's bunkers: local relief at all 41 is
   0.429 m median against 0.273 m on ordinary ground, whose 90th percentile
   (0.726 m) passes the bunkers' median, so no threshold separates them. And
   the orthophoto — the source that measures reflectance rather than shape —
   returns HTTP 403 to this account on every asset, because Ortofoto
   Nedladdning is a separate Geotorget order. Two human actions therefore gate
   D5, and no amount of code substitutes for either: place the orthophoto
   order, and ask the club for its drawings. A third account problem sits
   beside them, smaller only because it blocks canopy rather than surface:
   Skogsstyrelsen has answered HTTP 401 to every tree-height probe so far.
   **And "ask the club" is now a much more specific question than it was.**
   LiveCaddie is Mapping Industries AB of Västervik — 25 years of golf mapping
   and 3D modelling, selling mapping-as-a-service plus MiCourse, MiRate and a
   pin-placement system to clubs, federations and course architects, across 738
   courses in 14 countries. Their accuracy is not a dataset we are failing to
   find; it is a commercial relationship that puts surveyors on the property.
   Two of our six clubs are already their customers: the listing carries
   **"Veckefjärdens Golf Club"**, **"Örnsköldsviks Golfklubb Puttom"** and
   **"Puttoms 18 hål"** — the two grounds this project has taken furthest.
   So for those two the surveyed geometry already exists and the club is the
   paying customer, which is standing we do not have. The ask stops being "do
   you have any drawings?" and becomes "you have commissioned course mapping;
   may we have the underlying geometry, or may your supplier release it to us?"
   What that would actually buy is worth stating so nobody over-expects it.
   Their product is 2D polygons, distances and a flyover; flyover relief can
   come from the same national DEM we already hold. On TERRAIN we are probably
   at or above them — 1 m Lantmäteriet DTM in RH 2000, agreeing with the
   retained preview to the centimetre across a million samples. What we would
   gain is precisely the open D5 gap: surveyed green, fairway and bunker
   outlines. That is the "perfectly aligned" part, and nothing else on the
   table supplies it.
   What is NOT a route: harvesting their app or web viewer. That is another
   company's per-club commercial product, and this plan's own tier rules
   forbid dressing someone else's proprietary geometry as an authoritative
   source. The legitimate path runs through the club.
3. Verify authoritative centre/edge/seam probes and approve WebGPU plus
   forced-WebGL2 grazing-angle goldens before any course can use v2 by default.
4. Compile one real Puttom object tile from allowed sources, review every zone-A
   tree/boulder record and verify its base against the shared height sampler.
5. Expand the same measured pipeline to the remaining pilot grounds, then all
   six physical grounds and nine slugs.
6. Flip v2 per course only after geodetic, licence, visual, performance,
   hardware and offline gates all pass; never infer approval from a preview.

The goal is not merely a sharper DEM. Every playable course must become a
measured, versioned digital twin in which terrain, golf surfaces, vegetation,
rock, water, infrastructure and landmarks share one survey-grade coordinate
frame. The active hole must use the same geographic truth in WebGPU and WebGL2;
the backends may differ only in rendering cost, LOD radius and optional effects.

The production scope is all nine course slugs and all six physical grounds:

| physical ground | course slugs using it |
|---|---|
| `angso` | `angso` |
| `norrfallsviken` | `norrfallsviken` |
| `puttom` | `puttom` |
| `upsala` | `upsala`, `upsala-mellanbanan` |
| `johannesberg` | `johannesberg`, `johannesberg-9` |
| `veckefjarden` | `veckefjarden`, `veckefjarden-korthalsbanan` |

Pilots in this plan validate the pipeline only. The project is not complete
until every physical ground has been rebuilt, all nine slugs pass both renderer
paths, and the source/licence register is complete.

Current implementation evidence:

- `packages/course-geo/manifest.mjs` validates provenance, licence state,
  checksums, accuracy tiers, CRS/axis order, canonical-origin approval and the
  exact six-ground/nine-slug inventory.
- `packages/course-v2/authoritative-surface-source.mjs` and its dedicated
  compiler form a replacement-only intake boundary for future reviewed surface
  polygons. Migration, OSM, GolfTraxx, legacy imagery and course-guide sources
  cannot be promoted through it as sole authority.
- `packages/course-geo/frame.mjs` implements the shared national-to-Three.js
  mapping, round trips and immutable frame fingerprint, while refusing every
  origin that has not passed control approval.
- `geo_data/course-v2/source-catalog.json` is the shared product/licence
  register; blocked legacy products cannot be promoted to authoritative use.
- Each physical ground has a checksummed `source-manifest.json`; missing raw
  caches, acquisition dates, permissions and surveys are explicit release
  blockers rather than undocumented assumptions.
- `packages/course-geo/toolchain/pixi.lock` pins GDAL 3.13.3, PROJ 9.8.1 and
  PDAL 2.10.2 across Linux, Windows and macOS. The Swedish geoid grid is fetched
  separately with an exact SHA-256 and PROJ network access disabled.
- All 15 published SWEREF 99 TM control points, axis order, inverse round trip
  and the SWEN17/RH 2000 transformation are executable gates.
- 75,375 legacy coordinate pairs across nine physical-ground/course models
  have deterministic EPSG:3006 migration artifacts and scoped residuals.
- Official `stac-hojd`/`stac-bild` discovery snapshots for `puttom`,
  `norrfallsviken` and `upsala` prove complete 1 m DTM and orthophoto source
  coverage, retain exact multihashes/byte sizes and verify 43 public metadata
  assets. Norrfällsviken's newest LiDAR covers 97.79% of the broad manifest bbox
  and remains an explicit scoped gap rather than hidden by an older point cloud.
- The offline acquisition adapter reads COG ranges, verifies and clips water
  GPKGs, exports Skogsstyrelsen's signed-Int16 1 m/decimetre raster in bounded
  requests, builds ZSTD COGs and records real output hashes, sizes and timings.
  It never serializes credentials.
- `packages/course-v2/` implements canonical, content-addressed course and
  parent-ground manifests plus independently verified shell/tile/routing
  chunks. A synthetic two-course/one-ground graph proves sharing, v1 fallback,
  1 cm uint16 terrain quantization, encoded/decoded SHA-256 verification and
  fail-closed handling of stale, corrupt, oversized and unsupported content.
- Its browser-compatible runtime harness performs bounded Worker
  decompression, transferable-buffer decode, stable priority scheduling,
  per-scope cancellation, stale-reply suppression, verified immutable caching,
  network-first root loading and reference-counted LRU resource recycling.
- The generic browser loader verifies content-addressed course/ground manifests,
  capability-negotiates every referenced asset and requires the v2 fallback to
  exactly match the current GPK1 manifest. HTTP 404 never revives a stale cached
  root. The live app dynamically imports retained v2 payload/renderer code only
  after an explicit URL flag. Normal production visits make no v2 request: its
  bounded dynamic chunks are excluded from initial HTML and the PWA precache.
- `access-preflight.mjs` verifies configured provider access with one 16-byte
  COG range and one 16-by-16 tree-height sample without writing source bytes or
  serializing secrets.
- `plan-hole-source-controls.mjs` proves the complete six-ground/nine-course/
  135-hole inventory and deduplicates its 655 references to 177 aligned source
  windows. `run-hole-source-controls.mjs` executes deterministic shards and
  writes only coordinate-free aggregate evidence. The monthly/manual
  `course-geo-hole-controls.yml` matrix limits provider concurrency to two.
- `d2-authenticated-terrain-probe.json` records the successful Puttom provider
  run: authenticated HTTP 206 range support, a 1 m EPSG:5845 window, 3,739,601
  COG bytes and a 22-resource BVCH pyramid with 1,548,860 encoded bytes, exact
  hashes, RH 2000 statistics and a 10-second processing time. Both source and
  derived terrain bytes remained ephemeral.
- `terrain-pyramid.mjs` and `terrain-compiler-node.mjs` build overlapping 1 cm
  quantized LOD tiles with a shared height origin, conservative geometric
  error, verified seams, a rectangular coarse shell, content-addressed BVCH
  resources and CPU height fallback.
- `terrain-render-data.mjs`, `terrain-grid-topology.mjs` and the app's isolated
  `v2-terrain-batch.mjs`/`v2-terrain-runtime.mjs` implement Worker-side packed
  GPU data, shared topology, partial texture-array uploads, instanced one-draw
  regular-tile rendering, parent geomorph, bounded skirts, frustum/SSE streaming
  and finest-ready CPU height parity for both renderer backends. The retained
  fixed-frontier adapter is now selected only for the visually approved Puttom
  opt-in path; generic manifest-driven selection remains blocked on real public
  manifests, shell/hierarchy assets and the remaining release gates.
- `pnpm check:geo-sources` is the reproducible gate. D0 telemetry and D1
  independent control/origin approval remain open.

## Outcome and non-negotiable rules

The finished system must provide:

1. Lantmäteriet's 1 m national ground model as the default terrain source.
2. Survey patches for greens, tees, bunker lips and other places where 1 m is
   insufficient.
3. Exact SWEREF 99 TM positions and RH 2000 heights throughout the build.
4. Per-hole streamed terrain and surface tiles instead of one monolithic course
   mesh built synchronously at boot.
5. Data-derived trees, scrub, rocks and stable objects throughout the course
   property and a 100 m playing-area buffer.
6. Procedural placement only in distant scenery where individual position is
   neither measurable nor visible.
7. Real golf-surface boundaries and a first-class material pipeline for greens,
   fringe, fairway, semi-rough, rough, sand, paths, rock and forest floor.
8. One data model, one TSL material family and one tile-selection policy shared
   by WebGPU and the WebGL2 backend.
9. Measured provenance, acquisition date, uncertainty and licence for every
   derived layer.
10. A reversible migration: `GPK1` remains a known-good fallback until v2 is
    approved on every course.

The following shortcuts are explicitly prohibited:

- Do not replace the current 4 m `HF0` with one whole-course 1 m array. A 4 m to
  1 m change is approximately 16 times as many samples over the same area.
- Do not warp authoritative terrain to fit uncertain OSM or hand-traced data.
- Do not claim that a canopy-derived crown centre is an exact tree-stem survey.
- Do not invent a large tree, bush, boulder or terrain feature inside the
  playing-area truth zone.
- Do not drape an orthophoto over the rendered ground. Imagery is measurement
  input, not the final material.
- Do not create separate WebGPU and WebGL2 course data.
- Do not let source acquisition or GIS processing occur in the browser.

## Current baseline and the precision that is lost

The six existing build pipelines all follow approximately the same route:

1. `*/fetch-dem.mjs` downloads AWS/Mapzen Terrarium tiles.
2. `*/build-heightfields.mjs` resamples the course to `HF0` at 4 m and the
   surroundings to `HF1` at 32 m.
3. `packages/course-pack/emit-pack.mjs` writes one `GPK1` containing `HF0`,
   `HF1` and the course vectors.
4. `apps/golf/src/main.js` decodes both fields and constructs 4 m, 12 m and
   36/48 m terrain meshes on the client.
5. Selected feature cells are locally refined, but their elevations are still
   interpolated from the 4 m source field.

The current local frame uses metres-per-degree approximations around a WGS84
origin. Because most layers pass through the same approximation, they remain
internally coherent, but distance, scale and vertical datum are not expressed
as survey-grade metadata.

The current scenery is visually informed but not object-accurate:

- Trees are candidates on a deterministic 5–8 m lattice, accepted by OSM
  woodland, a satellite canopy raster, noise and exclusion rules.
- Bushes, stones, tufts and stumps are primarily placed from deterministic
  hashes, noise and slope.
- Far forest is a low-cost stand-in population.
- `*/fetch-sat.mjs` currently caches Esri World Imagery for canopy
  classification, and some older traces cite Google satellite screenshots.

Those decisions made a convincing scene possible from sparse data, but they are
not a measured digital twin. They also make candidate scanning and procedural
classification a material part of boot CPU time.

The live ground atlas in `apps/golf/src/engine/atlas.js` is the correct rendering
direction: one terrain mesh classified per fragment. During migration it stays
live as the compatibility path. The v2 compiler eventually precomputes the same
semantic fields so boot no longer rasterizes an entire course.

## Accuracy tiers: truth must not be overstated

Every terrain patch, surface and object carries one of these accuracy tiers.
The tier controls UI/debug labelling, validation tolerances and whether manual
approval is mandatory.

| tier | meaning | initial release target |
|---|---|---|
| A — survey | independent RTK, total station or controlled drone survey | stable feature position <= 0.10 m; surveyed green vertical residual <= 0.05 m |
| B — authoritative remote | Lantmäteriet DTM/ortho/LiDAR or equivalent, independently checked | terrain vertical RMSE <= 0.15 m; planimetric feature residual <= 0.50 m |
| C — derived | canopy, imagery or model-derived object with measured confidence | source-dependent error recorded; manual review in playing zone |
| D — area truth | boundary, density and height are known; individual instances are representative | allowed outside the playing zone only |
| E — procedural | visual fill without a measured individual position | distant scenery only |

These are release targets, not assumed source specifications. They are verified
with independent checkpoints. If the source metadata or field measurements do
not support a target, the asset is downgraded rather than relabelled as exact.

## Source hierarchy

### Terrain and height

Priority, highest first:

1. Approved local survey patch tied to SWEREF 99/RH 2000.
2. Lantmäteriet Markhöjdmodell, 1 m.
3. A custom DTM derived from a newer Lantmäteriet point cloud after explicit
   ground-class and control-point QA.
4. Current Terrarium data only as a migration or outage fallback.

Lantmäteriet's 1 m product is nationwide, uses SWEREF 99 TM and RH 2000, and
carries source method, acquisition date and uncertainty metadata. The 2026
delivery uses 10 x 10 km COG assets and provides water-flattening break
geometry. Access is free but authenticated and governed by product-specific
high-value-dataset terms; it must not be labelled CC0 without confirming the
specific product terms.

Raw `Laserdata Nedladdning, skog` is useful for recency checks, classification,
surface modelling and difficult local QA. Its typical 1–2 points/m2 does not by
itself promise a better bare-earth model than the finished national 1 m DTM.

### Golf surfaces and planimetric features

Priority, highest first:

1. Club CAD/GIS/as-built survey and current maintenance drawings.
2. Controlled local survey.
3. Digitisation from the latest suitable Lantmäteriet RGB/IR orthophoto.
4. Lantmäteriet Topografi 10 for general infrastructure, hydrology and land
   cover.
5. OSM as a supplementary feature source.
6. Existing registered club guides and traces, with their measured confidence.

OSM coverage is highly uneven among the current courses. It is never the sole
authority for a green or fairway merely because a polygon exists. Its ODbL
attribution and share-alike implications must remain isolated and explicit in
the source register.

### Trees, woodland and scrub

Use these together rather than treating any one as a stem survey:

- Skogsstyrelsen's 1 x 1 m tree-height raster.
- Lantmäteriet point returns and DTM.
- Latest leaf-on and leaf-off RGB/IR orthophotos when available.
- Club forestry plans and known tree work.
- Controlled drone LiDAR/photogrammetry or field survey for important trees.

The compiler derives a canopy height model, crown candidates, crown diameter,
height and confidence. Crown segmentation can estimate an individual tree, but
the trunk base under a dense or asymmetric crown remains derived until it is
surveyed. Trees that affect the line of play, a signature view, safety or
collision must be manually approved or moved to tier A.

Scrub is normally represented as a measured polygon carrying height, density
and vegetation type. A truly isolated bush may be an individual object. The
system must not pretend to know every seasonal plant as a permanent point.

### Hills, rock, outcrops and boulders

- Hills, ridges, depressions and continuous exposed bedrock belong to the
  terrain mesh, not scenery placed above it.
- DTM slope, curvature, ruggedness and local prominence provide geometric
  candidates.
- RGB/IR imagery provides surface-class evidence.
- SGU geology and soil-depth data provide broad supporting context, not an
  object-level outline.
- Large exposed boulders may be detected from LiDAR/imagery and manually
  approved.
- Boulders hidden under canopy require field or dense local survey.

### Built objects and course furniture

Topografi 10, OSM and current club data seed buildings, roads, paths, bridges,
piers, fences and power infrastructure. Club or field inventory supplies signs,
benches, lights, ball washers, tee markers and other course furniture. Stable,
play-visible objects are stored in the same registry as natural objects.

### Licence and provenance gate

Every source asset and every derived output needs:

- provider and product;
- immutable source identifier or URL;
- source checksum;
- acquisition and publication dates;
- coordinate and vertical reference systems;
- stated source accuracy;
- licence identifier and required attribution;
- redistribution/derivative-data decision;
- processing toolchain version;
- human reviewer and approval date where applicable.

Existing Esri-derived canopy and Google-referenced traces are not silently
promoted into the new authoritative layer. They may be used as migration
comparison material only until their production use is explicitly licensed or
the layer is re-derived from approved sources.

## Canonical spatial model

The build's canonical compound CRS is EPSG:5845, SWEREF 99 TM + RH 2000.
Runtime values remain small local floats:

```text
worldX = easting - originEasting
worldZ = originNorthing - northing
worldY = heightRH2000 - originHeightRH2000
```

Each physical ground owns exactly one origin. Child courses share it. The
origin, EPSG code and vertical datum are immutable after the first approved v2
release because changing them would move every object identifier and patch.

GNSS ellipsoid heights are converted through the current official
SWEN17_RH2000 geoid model before entering the master. Phone altitudes are not
accepted as elevation control. GDAL/PROJ and PDAL do all transformations in the
offline compiler; the browser never transforms national source datasets.

Migration of current local vectors is a one-time operation:

1. Invert the current course-local conversion to recover source longitude and
   latitude.
2. Transform that coordinate to EPSG:5845 with PROJ.
3. Store the converted geometry and its legacy provenance.
4. Compare independent anchors before approving it.
5. Never repeatedly round-trip converted coordinates through WGS84.

## Master data model

The source-of-truth directory should be introduced without deleting the six
legacy pipelines:

```text
geo_data/course-v2/
  <ground-id>/
    source-manifest.json
    control-points.geojson
    course-boundary.geojson
    surface-overrides.geojson
    object-overrides.geojson
    survey/
      <survey-id>/metadata.yml
      <survey assets>
```

Large licensed/raw files remain outside git and are reacquired by checksum from
the source manifest. Small, reviewed vectors and metadata are committed.

The normalized build database contains these logical layers:

| layer | representation |
|---|---|
| `terrain_master` | 1 m float DTM plus survey patches and validity mask |
| `terrain_breaklines` | water, walls, bunker lips, banks, road grades |
| `surface_polygons` | golf and non-golf material polygons with priority |
| `surface_fields` | edge distance, mow direction, moisture, wear, rock exposure |
| `canopy` | height, crown cover, density, confidence, date |
| `objects` | stable natural and built object registry |
| `hydrology` | water polygons, level, shore type, streams and culverts |
| `provenance` | source-to-output lineage and licences |

### Stable object schema

At minimum, each object record contains:

```json
{
  "id": "upsala-h07-tree-0042",
  "groundId": "upsala",
  "class": "tree",
  "subtype": "pine",
  "easting": 654321.42,
  "northing": 6642123.18,
  "heightRH2000": 24.82,
  "objectHeight": 18.4,
  "radius": 3.6,
  "heading": 1.47,
  "sourceId": "lm-laser-2025-06-18",
  "capturedAt": "2025-06-18",
  "accuracyTier": "C",
  "horizontalAccuracy": 0.45,
  "verticalAccuracy": 0.60,
  "confidence": 0.91,
  "reviewStatus": "approved"
}
```

IDs are stable across rebuilds. Automated redetection proposes adds, updates and
removals as a reviewable diff; it does not silently renumber the whole forest.

## Terrain compiler and LOD

### Source preparation

For each physical ground:

1. Query STAC by the course boundary plus the required horizon buffer.
2. Read COG windows rather than downloading or decoding unnecessary national
   coverage.
3. Retrieve source metadata, water break geometry and the newest relevant
   point-cloud/orthophoto assets.
4. Transform and clip all layers in EPSG:5845.
5. Apply nodata and water handling explicitly.
6. Register survey patches from independent control points.
7. Resolve overlaps by source priority; do not average surfaces blindly.
8. Generate slope, aspect, curvature, ruggedness and hydrology QA products.

Survey patches meet the national DTM through a controlled transition band. The
compiler first measures horizontal and vertical bias at the patch boundary,
rejects an unexplained residual, then blends only the correction needed to
avoid a seam. It does not rubber-sheet the surrounding course.

### Runtime terrain hierarchy

Initial target hierarchy:

| detail | source spacing | intended use |
|---|---:|---|
| survey patch | 0.10–0.25 m | approved green, tee, bunker lip, retaining feature |
| hole | 1 m | active hole and 80–100 m buffer |
| course | 2–4 m | other holes and property |
| near surround | 8–16 m | nearby landscape |
| horizon | 32 m | distant silhouette |

The compiler records maximum geometric error for every tile. Runtime selection
uses projected error and camera importance, not distance alone. The active hole
and the next likely hole receive priority. Overlapping holes reference shared
tiles; data is not duplicated per hole.

Use approximately 128 x 128 m tiles for a regular 1 m source. Survey patches use
smaller tiles so their vertex/index ranges remain bounded. The compiler may emit
a regular quantized grid or constrained indexed geometry when a true breakline
or locally refined topology requires it. Every tile includes:

- local quantization origin and scale;
- min/max height and bounds;
- geometric-error value;
- skirt or stitch metadata;
- compact normals;
- source and accuracy summary;
- content checksum.

LOD seams must use shared boundary samples plus geomorphing or tucked overlap.
A visible vertical skirt remains a last-resort crack guard, not the primary
transition surface.

## Surface truth and material system

Better geometry does not automatically make a beautiful golf course. Surface
truth and appearance are an equal workstream.

### Surface classes

The current `SURFACE` registry remains the semantic authority and expands only
through reviewed identifiers. Required production classes include:

- green, fringe/collar, tee;
- fairway, semi-rough, rough and native/heath;
- bunker sand, beach/shore sand and dirt;
- gravel, asphalt, path and road;
- exposed rock, moss/lichen rock and scree;
- forest floor, wetland, reeds and mud;
- water and constructed drainage features.

### Precomputed surface tile

The v2 compiler produces a per-hole/tile surface atlas. Material boundaries may
be 0.25–0.50 m even where geometry is 1 m. IDs are lossless and
nearest-filtered; continuous fields are linearly filtered. The logical channels
are:

- primary and secondary surface IDs;
- signed distance to the class boundary;
- owning hole/feature ID;
- mow coordinate and direction;
- moisture/wetness;
- wear/divot intensity;
- rock or soil exposure;
- vegetation density.

The exact packing is decided by a measured memory/quality spike. Identifier and
distance data must not use a lossy texture codec. Visual colour/normal detail
textures may use KTX2/Basis after backend validation.

### Appearance target

Orthophoto colours and captured shadows are not rendered. Each class uses a
multi-scale, world-space PBR treatment:

- **Green:** short dense micro-normal, restrained macro variation, subtle mow
  direction and readable survey contours without height exaggeration.
- **Fringe/collar:** physically and visually continuous transition around the
  green, not an overlay rim.
- **Fairway:** natural directional mowing, broad colour variation, soft
  semi-rough transition and no repeating hard bands.
- **Tee:** dense cut turf, measured pad geometry, directional mowing and subtle
  wear/divots.
- **Rough/native:** broader variation, density-driven near grass and no uniform
  carpet effect.
- **Bunker:** true dish/lip geometry, fine sand normal, subtle rake direction
  and damp edge response.
- **Rock:** triplanar detail to avoid UV stretching, with data-driven moss and
  lichen coverage.
- **Forest floor:** litter/needle/soil response tied to real canopy rather than
  a generic dark green fill.

Stochastic rotations and multi-scale taps suppress texture repetition. Detail
fades with screen footprint. The active-hole class, edges and base material are
the same in both backends; only optional near geometry and tap count may scale.

### Relationship to the live atlas

During migration:

1. Live atlas remains the default for v1 packs.
2. V2 surface tiles decode into the same shader-facing semantic fields.
3. `makeGround()` receives an adapter, not a second material implementation.
4. Existing analytic `classify()` remains available for debug probes and v1.
5. Once all courses pass, course-wide boot rasterization becomes the v1-only
   compatibility path and can later be removed with `GPK1`.

### Implemented Puttom migration preview (not a release approval)

The current pilot adds a separate `surface-preview.json` beside the terrain
preview. It contains 16 content-addressed surface BVCH tiles aligned to the
same 1,025 x 1,025 sample frontier. The compiler uses the current GPK1 vectors
only to reproduce the already-visible legacy atlas semantics; it does not infer
new boundaries from imagery and it does not label the result as field data.

- The descriptor is pinned by SHA-256 in the app and also pins the terrain
  descriptor hash, frame fingerprint and verified Puttom GPK1 pack hash.
- The preview only loads with `?bana=puttom&v2=1`. A missing, modified,
  mismatched or non-seam-identical surface tile aborts the entire v2 preview and
  retains the normal GPK1 terrain/material path.
- The material adapter uses the decoded surface tiles instead of the boot-time
  atlas only inside the replaced v2 terrain rectangle. Legacy course rendering
  and gameplay classification retain their existing atlas/analytic fallbacks.
- Moisture, wear, exposure and vegetation-density fields are present in the
  binary contract but set to zero and declared unmeasured. They must not be
  populated procedurally merely to make the terrain look more detailed.
- The PWA caches the descriptor network-first and the hash-named surface tiles
  cache-first only after the opt-in request. Neither the decoder nor surface
  material adapter is part of install-time precache.

This preview is a wiring, integrity and performance proof. Replacing it with
authoritative surfaces requires the source/licence/evidence gates in this plan,
fresh descriptor hashes and backend visual validation.

## Vegetation and object compiler

### Truth zones

| zone | area | placement policy |
|---|---|---|
| A | all playing corridors plus 80–100 m; club facilities and landmarks | data-derived individual objects; important objects manually approved or surveyed; no procedural large objects |
| B | rest of the physical course property | measured canopy/area truth; reviewed individual large objects; deterministic representative small vegetation allowed |
| C | distant surroundings and horizon | source-constrained procedural or clustered scenery allowed |

### Individual-tree extraction

Offline processing:

1. Build canopy height as surface/returns minus the approved DTM.
2. Remove buildings and known structures.
3. Detect local maxima appropriate to canopy height and crown scale.
4. Segment crowns with watershed/region growing plus RGB/IR evidence.
5. Estimate crown centre, base candidate, height and diameter.
6. Derive a conservative species group only when evidence supports it.
7. Intersect with cleared, mown, water, power-line and building exclusion data.
8. Diff against the previous object registry.
9. Require per-hole human review in zone A.
10. Survey signature and play-affecting trees when derived uncertainty is too
    high.

Species is an appearance attribute with confidence, not a fabricated botanical
claim. An unknown deciduous or conifer asset is better than a confidently wrong
pine.

### Scrub, reeds and small cover

Low vegetation is segmented from height and RGB/IR evidence into polygons with
height, density and class. Runtime populates those polygons deterministically
from the committed record, not from a whole-course candidate scan. Solitary,
important bushes are individual records. Reed beds follow measured wetland and
shore masks; small blades remain instanced visual detail inside those masks.

### Rock and boulder extraction

Candidates combine terrain ruggedness, surface residuals, orthophoto texture
and vegetation absence. The compiler distinguishes:

- continuous outcrop: terrain surface class;
- ledge/wall: terrain breakline or explicit geometry;
- exposed boulder: reviewed object instance;
- uncertain canopy-covered candidate: excluded until surveyed.

### Runtime object representation

Object transforms are prepared offline and grouped by asset family and LOD.
Runtime does not scan the course to decide where an object might stand.

- Use `InstancedMesh` or `BatchedMesh` for backend-common near geometry.
- Keep transforms tile-local for precision and cheap eviction.
- Use several authored variants per species/class; choose the variant from the
  stable object ID so rebuilds do not shuffle appearance.
- Store collision/safety proxies separately from visual LOD.
- WebGPU may retain individual geometry farther away and use render bundles.
- WebGL2 may switch earlier to clusters or impostors.
- Zone A positions, dimensions and collision remain identical.

## V2 distribution and caching

Do not put all new streams into one indivisible file. Static hosting, PWA
offline support, cancellation and parent-ground sharing are simpler with a
small content-addressed asset graph.

Proposed logical layout:

```text
courses/
  index.json
  <slug>/
    course-v2.json          card, hole routing, asset references
grounds/
  <ground-id>/
    ground-v2.json          origin, CRS, provenance summary, tile index
    shell-<hash>.bin        coarse first-visible terrain
    terrain/<tile>-<hash>.bin
    surfaces/<tile>-<hash>.bin
    objects/<tile>-<hash>.bin
```

The exact public paths may change during the format spike, but these contracts
must hold:

- a child course references its parent's ground assets;
- the coarse shell is independently fetchable;
- active-hole assets are independently fetchable and cancellable;
- every immutable asset is content-hashed and cache-forever;
- root manifests remain fresh/revalidated;
- each chunk verifies size, checksum, schema and bounds before decoding;
- v1 manifest entries remain loadable during migration.

The manifest records `courseFormat` and `groundFormat` separately. Course
vectors can evolve without forcing a copy of a shared ground. A format-v2
loader must fail closed on an unsupported required feature and fall back to the
explicit v1 entry, never reinterpret unknown bytes as `GPK1`.

Height and geometry chunks use lossless quantization with error recorded per
tile. Meshopt may be adopted for indexed irregular geometry only after its
decode, bundle-size and both-backend performance beat the simpler quantized
format. Do not choose a codec from compression ratio alone.

### Loader state machine

1. Fetch fresh root manifest.
2. Resolve course and parent ground.
3. Fetch and display the coarse shell.
4. Fetch active-hole terrain and its surface/object tiles in priority order.
5. Start interaction as soon as shell, collision height and critical hole data
   are ready.
6. Refine visible tiles without blocking input.
7. Predict and prefetch the next hole at low priority.
8. Abort stale requests and recycle tile/object allocations after a course or
   hole switch.
9. Persist immutable chunks in Cache Storage/IndexedDB within a measured quota.

Decoding and mesh preparation occur in a Web Worker with transferable buffers.
The main thread only installs prepared resources within a bounded per-frame
upload budget.

## Renderer architecture: one truth, two profiles

The app already imports `three/webgpu` and constructs `WebGPURenderer`, allowing
WebGPU or its WebGL2 backend. Keep that architecture.

Backend-common path:

- same tile selector and geometric-error policy;
- same quantized height/mesh data;
- same CPU height sampler for camera, placement and probes;
- same surface IDs, SDF boundaries and TSL material graph;
- same zone-A object transforms and collision;
- same exposure/colour-space contract;
- interleaved/packed attributes kept inside WebGPU vertex-buffer limits.

WebGPU high profile may add:

- longer high-detail radius;
- more near grass and small objects;
- render bundles for static tile groups;
- measured compute work for derived normals/culling if it beats offline data.

WebGL2 mobile profile may use:

- earlier terrain/object LOD transitions outside the active hole;
- fewer optional near blades and tiny cover objects;
- precomputed normals rather than compute;
- no mobile bloom, lower MSAA/shadow cadence and adaptive pixel ratio;
- clustered trees/impostors at shorter distance.

WebGL2 may not use lower geographic truth for the active hole. If a device
cannot draw the agreed active-hole topology, reduce effects and peripheral
content before degrading its source terrain.

## Performance budgets

Budgets are release gates on named reference devices and a controlled network
profile. The first implementation phase records the exact device/browser list.

| metric | initial gate |
|---|---:|
| cold course shell visible, mid-tier Android WebGL2 on controlled 4G | <= 3.0 s p75 |
| active hole fully refined after cold open | <= 5.0 s p75 |
| cached course interactive | <= 1.5 s p75 |
| cached hole switch | <= 250 ms to visible correct terrain |
| uncached hole switch | <= 500 ms to shell, <= 1.5 s to refinement |
| terrain/object main-thread long task | none > 50 ms |
| WebGPU reference desktop frame time | <= 16.7 ms p95 in normal play view |
| WebGL2 reference mobile frame time | <= 22 ms p95; never sustained below 30 fps |
| active mobile decoded terrain + surface + object working set | <= 64 MB target |
| terrain draw calls | <= 8 target after batching |

Network byte, decoded heap, GPU memory, upload time, tile count, object count,
draw calls and shader compilation are recorded per phase through `window.V3D`
telemetry. A course may not pass because its average is good while one hole
still takes minutes.

## Validation and release gates

### Geodetic and terrain gates

- CRS, axis order and vertical datum are present and correct.
- At least 20 independent checkpoints per physical ground, distributed over
  tees, fairways, greens, hazards and facilities where possible.
- Tier-B terrain vertical RMSE <= 0.15 m or the source is explicitly downgraded.
- Tier-A survey residuals meet their signed survey specification.
- Water surfaces are planar at their approved RH 2000 level.
- No green or tee is submerged.
- Cross-sections along every hole and around every green are emitted for review.
- Survey patch and tile seams remain below 0.02 m in the highest shared LOD.
- No NaN, nodata spike, inverted triangle or unbounded slope reaches a pack.

### Surface gates

- Green, fringe, fairway, tee and bunker centre probes hit their intended class.
- SDF-reconstructed boundaries match approved vectors within 0.25 m for
  high-resolution surfaces.
- No sand-over-green, path-through-green or duplicate priority ambiguity.
- Bunker lips and green contours use real source topology where available and
  are not double-sculpted by legacy `terrainH` shaping.
- Mow coordinates remain stable across tile seams.
- Named grazing-angle and long-view goldens are approved for every course.

### Object gates

- No zone-A large object is tier E/procedural.
- No tree, bush, stone or furniture object intersects green, tee, fairway,
  bunker, water, building or path contrary to its approved record.
- Signature/play-affecting trees and boulders have a manual approval or tier-A
  survey.
- Tree base height uses the same approved terrain sampler as the visible mesh.
- Canopy coverage, height distribution and treeline silhouette match the source
  QA rasters.
- Registry diffs list adds, moves, resizes and removals for human approval.
- Source age is visible; a recent felling or renovation cannot be hidden by an
  old raster without a warning.

### Renderer and application gates

For every one of the nine slugs:

- default backend boot;
- forced WebGL2 boot with `?gl=1`;
- low, balanced and high quality profiles where supported;
- identical CPU height probes and zone-A object transforms;
- surface-class probes agree;
- no shader/backend error;
- approved golden views and perceptual diffs;
- frame-time and memory budgets;
- course switch, hole switch, abort and cache tests;
- PWA offline reopen after the required course assets have been cached.

Extend, do not replace, the existing gates in:

- `packages/course-pack/lib.test.mjs`;
- `apps/golf/src/loader/pack.test.mjs`;
- `tools/check-packs.mjs`;
- `tools/check-app.mjs`;
- `tools/check-pwa.mjs`;
- `tools/goldens.mjs`.

### Licence gate

No v2 asset is published unless its provenance chain ends in an approved
redistribution decision. The visible app has a data-licence/attribution panel
capable of naming Lantmäteriet, OSM and any course-specific provider as the
displayed assets require.

## Implementation phases

Each phase has a deliverable and a stop gate. A later phase does not hide a
failed earlier one.

### D0 — freeze baselines and inventory truth

Deliverables:

- Capture current v1 boot, network, memory, vertex, object and frame telemetry
  for all nine slugs and both backends.
- Freeze the approved ground-atlas golden matrix.
- Generate a source/licence inventory for every committed elevation, imagery,
  trace, canopy, surface and object layer.
- Record the reference desktop, Android/WebGL2 and WebGPU devices.
- Mark current Esri/Google-derived outputs as migration-only pending licence or
  replacement.

Gate: baseline report is complete and reproducible; existing tests remain green.

### D1 — common geospatial core and canonical CRS

Deliverables:

- [x] Add a shared offline geospatial package instead of copying logic into six
  build directories.
- [x] Pin GDAL, PROJ and PDAL in a reproducible tool environment.
- [x] Add source-manifest validation and checksum handling.
- [ ] Establish the immutable EPSG:5845 origin for all six physical grounds.
  Horizontal candidates exist; independent controls and RH 2000 heights are
  still required before approval.
- [x] Convert current course vectors and emit a migration residual report.
- [x] Add coordinate/datum unit tests and known control transformations.

Gate: every legacy control anchor transforms within its declared tolerance;
round-trip and axis-order tests pass.

### D2 — authoritative acquisition spike

Use three deliberately different grounds:

- `puttom`: comparatively rich OSM golf geometry;
- `norrfallsviken`: sparse OSM golf geometry;
- `upsala`: parent ground shared by two course slugs.

Deliverables:

- [x] STAC access and credential-safe COG window reader for Markhöjdmodell.
- [x] Checksummed water break-geometry download/clip ingest.
- [x] Laserdata/metadata and latest orthophoto discovery.
- [x] Bounded Skogsstyrelsen tree-height export/COG ingest implementation.
- [x] Public metadata checksums, source sizes and discovery timings for all
  three pilots.
- [x] Run the first authenticated DTM window and persist its real source range,
  compressed size, checksum, RH 2000 statistics and processing time. Puttom is
  the bounded first proof; full pilot AOIs are intentionally not retained yet.
- [x] Prove Laserdata Skog authorization and COPC random access without a full
  download: STAC selects `dsm-skoglig-copc`, the first 589 bytes match COPC
  1.0/LAS 1.4, the point-record format is allowed and `Content-Range` matches
  the advertised source size. No point-cloud bytes enter an artifact.
- [x] Stream and classify the first bounded Puttom COPC window, recording only
  aggregate class/density/height statistics. The playable hole-1 focus proves a
  local coverage gap and correctly emits no laser-derived runtime asset.
- [x] Build the all-course per-hole Laserdata/tree-height control inventory and
  authenticated runner: 135 holes, 177 shared exact 256 m windows, live COPC
  discovery, local density/classification gates, exact 1 m tree-height
  size/CRS/geotransform/value gates, deterministic sharding and coordinate-free
  evidence. Monthly/manual Actions automation is present; its first full
  provider run is still pending.
- [x] Geomorphometry from the compiled height model — slope, ruggedness,
  priority-flood depression filling, local relief and a closed-depression
  candidate detector — with a reproducible offline probe over the published
  Puttom LOD0 tiles (`analyse-puttom-derivatives.mjs`). **It settles a
  question that was about to be assumed:** a 1 m DTM cannot find this course's
  bunkers. Measured over all 41 OSM bunker positions against 256 control
  points on the same played ground, local relief is 0.429 m median at bunkers
  versus 0.273 m at ordinary ground — a real shift, but the control's 90th
  percentile (0.726 m) passes the bunkers' median and nearly reaches their
  deepest (0.817 m). The detector's 28 strongest depressions match none of the
  41 within 12 m; median nearest distance 148 m. No depth threshold can
  isolate them, so DTM-derived bunker geometry is not a path to surface truth
  here, and surface boundaries need a source that measures reflectance rather
  than shape. The derivatives remain useful for terrain QA and as D6
  rock/outcrop input.
- [ ] Compile laser-derived vegetation/object candidates only for per-hole
  windows that pass the local density and coordinate-bounds gates; use
  Markhöjdmodell, tree height and orthophoto fallback elsewhere.
- [x] Bounded authenticated orthophoto window reader plus the measurement the
  DTM result made necessary: `ortho-window.mjs` clips one RGBI window from the
  discovered campaign through `/vsicurl`, refuses any asset that is not a
  checked Lantmäteriet image, enforces a megapixel budget (the full Puttom AOI
  at 16 cm is 785 Mpx / 3.1 GiB decoded, which is precisely why imagery is an
  offline source) and may resample when the question is about metres-scale
  boundaries. `measure-ortho-separability.mjs` then derives NDVI and asks
  whether reflectance separates recorded greens, fairways and bunkers from
  ordinary course ground, using the same separability statistic as the DTM
  probe so the two answers are directly comparable. Only statistics leave the
  runner: the window and every derived raster stay there, because Ortofoto
  Nedladdning carries special access and GDPR terms and a derivative needs its
  own redistribution decision.
- [ ] **DEFERRED BY DECISION (owner, this session): the orthophoto order is
  not being placed for now.** Nothing depends on it — OSM's greens were
  measured against the GPS survey at 2.1 m median once the frames are made
  parallel, which is well inside what the render can express. The CI step
  stays in place and keeps reporting `blocked` cheaply, so the day the order
  lands the measurement runs with no further work. Details of the block below.
- [ ] **BLOCKED, and not by code: this account cannot read the orthophoto.**
  The first authenticated run returned HTTP 403 on all four `orto-u2-2024`
  assets, using the same credentials that read Markhöjdmodell successfully
  seconds earlier in the same job. Ortofoto Nedladdning is ordered and legally
  reviewed separately at Geotorget, so an account can hold complete image
  metadata — extent, resolution, capture dates, which is exactly what the
  discovery snapshot recorded — and still be refused every pixel. The
  discovery report was already honest about this: it lists `sha256: null` for
  every image asset while terrain assets carry real checksums. Nothing in the
  pipeline can grant this; someone must place the order. Until then the
  surface question stays open, because the DTM has now been measured and
  cannot answer it.
  **Checked again, and the licence is not the obstacle.** The imagery STAC
  catalogue answers unauthenticated, lists 731 collections, and every one of
  them — `orto-u2-2024` included — is **CC-BY-4.0**. Thirteen campaigns cover
  this AOI, 1958 to 2024. The collection carries no alternative access link:
  `dl1.lantmateriet.se` is the only channel, and it answers **401 with no
  credentials and 403 with ours**. So the data is openly licensed and the
  DELIVERY is what is gated, which is a different sentence from the one this
  plan had been carrying.
  Two things follow. The 401/403 split is now reported separately rather than
  sharing a `forbidden` flag, because one is a missing secret on our side and
  the other is an unplaced order — and sending someone to Geotorget to fix a
  secrets problem wastes a week. And after the order lands, derived rasters
  could be committed with attribution rather than statistics only; the
  retention caution stays for GDPR, which applies to high-resolution aerial
  imagery whatever the copyright terms say.
  **And the "legal review" this plan kept asserting is real — now checked
  rather than repeated.** It had been travelling on one unverified contract
  field whose own `termsVersion` read "current terms must be captured when
  access is approved", while its Laserdata sibling carried a real document and
  a real version. Lantmäteriet's product page states it directly: *"Produkten
  är avgiftsfri"* and *"Din användning kommer att prövas juridiskt i enlighet
  med dataskyddsförordningen och du behöver godkänna särskilda
  användningsvillkor."*
  So the order costs nothing, and what is reviewed is the intended USE, under
  data protection law — not copyright, which is CC-BY-4.0 and open. That is
  coherent: 0.16 m aerial imagery can show people, vehicles and private ground.
  It also means the reviewable question is ours to answer plainly — deriving
  vegetation indices over a golf course to classify turf and sand, publishing
  statistics and a rendering of the course — and it is the account holder who
  must declare it, which is the one place in this whole chain where the
  project owner's approval is the thing that actually moves it.
- [x] **Canopy from the one source this account can actually read.** With the
  bare-earth DTM measured and unable to resolve golf surfaces, the orthophoto
  refused and Skogsstyrelsen's tree-height raster answering 401, Laserdata Skog
  is the remaining authorized record of what stands ON the ground — 2 items,
  full AOI coverage, 1.1 pts/m². `canopy-window.mjs` builds a bounded PDAL
  pipeline that rasterises canopy height directly from one 512 m COPC window
  via `filters.hag_nn`, so the height is measured against the ground returns in
  the SAME cloud and inherits no registration error from a second product.
  `measure-canopy-agreement.mjs` then asks the same question in the same
  statistic as the DTM and orthophoto probes, so all three answers are
  comparable: does the point cloud separate canopy from open ground, and where
  does it agree with the satellite tree-cover raster the planter currently
  obeys?
  Three deliberate choices, each because the alternative fails quietly:
  - **No `filters.head` cap.** Truncating a point stream is harmless for
    statistics and punches holes in a raster that nothing downstream can tell
    from real clearings, so an over-dense window is refused instead.
  - **The tree-cover decoder is copied verbatim from `check-treecover.mjs`**,
    not rewritten from the writer's `bitorder="little"`. One transposition
    would mirror the forest, and a mirrored control set looks exactly like a
    real disagreement.
  - **The threshold is declared before the measurement** (2 m, the conventional
    canopy line). The best-scoring threshold is reported too, labelled
    `fitted`, because a number chosen after seeing the data is weaker evidence.
  - **The window is placed for sample adequacy, from the raster alone.** A
    window on the course centre is 90% mown ground — measured offline at 122
    tree probes against 1166 open, which determines the open side beautifully
    and the forest barely at all. The centre is therefore swept and scored by
    the SMALLER of the two probe counts, giving 942 against 948. That cannot
    bias the comparison: at selection time not one LiDAR byte has been read, so
    the score comes from a record that knows nothing about the values being
    compared, and if anything it makes the test harder, because a balanced
    window is one with a clean forest/open boundary running through it — where
    a frame error between the two records would show most.
    The sweep hit its own search bound at ±400 m, which is the trap the routing
    sweep fell into; widening to ±600 m converges at 510 m and the answer stops
    moving. `searchConverged` is computed and reported, so a clipped search can
    never read as an optimum.
  Direction of evidence is stated in the report: the LiDAR is authenticated and
  self-referenced, the satellite raster is a LEGACY derived artifact and is the
  side under test. The frame bridge between them is the migration model's own
  `candidateOrigin`, whose status is `horizontal-seed-only-pending-independent-control`
  — so a few metres of any disagreement may be the origin rather than the trees,
  and the report carries that status rather than hiding it.
- [ ] **First canopy run: no verdict, because the instrument under-sampled.**
  The pipeline read the cloud and produced a canopy raster, and the raster came
  back **98.7% nodata** — 881 cells of about 65,000 over a 512 m window at 2 m.
  Of 1,890 usable probes, 1,761 found no canopy height, leaving 108 tree and 21
  open. It did print an agreement (0.713 balanced at the declared 2 m
  threshold) and that number is **not recorded as a finding**: on 21 open
  probes it is nearly noise, and printing it beside the DTM and orthophoto
  results would put a measurement and an artefact in the same table.
  The run was still worth having, because it showed the output could not
  explain itself — nothing distinguished a thin point stream from a missing
  ground class from a filter eating everything. Two changes follow:
  - the pipeline reports its own middle (`filters.stats` before the writer:
    points reaching it, the classification histogram, the height-above-ground
    range), and the driver reports the raster's valid-cell fraction rather than
    just its valid-cell count;
  - a run below 50% canopy coverage or 60 probes per class now **refuses to
    publish an agreement** and writes the diagnostics instead, exiting
    non-zero. A thin result that reads like a finding is worse than a loud gap.
  One likely contributor is already fixed: `writers.gdal` was given a 2 m
  radius where PDAL's own default is `resolution × √2`, so cell corners were
  unreachable and nodata was being punched into ground that had been surveyed.
  **Second and third runs found the cause, and it was the reader.** Counting on
  both sides of `hag_nn`: 358 points came OUT OF THE READER for a 512 × 512 m
  window, the filters dropped 73 of them (water and unclassified, correctly),
  and 285 reached the writer with sensible heights. So 0.08% of the advertised
  1.7 pts/m² ever arrived. Ground points existed (81 of class 2) and `hag_nn`
  worked on what it was given; the window simply came back nearly empty.
  The one structural difference from the sibling statistics pipeline — same
  reader configuration — is that it runs `--stream` and this could not, because
  `hag_nn` must see the ground returns before it can measure anything above
  them. So the read is now a separate streamed pass to a local file and the
  derivation runs against that, which also leaves the second pass with no
  credentials in it at all.
  A third finding from the same run, about diagnostics rather than canopy:
  `classificationCounts` had been reporting `{}` because the parser read only
  PDAL's packed `"value/count"` form while this build emits `{value, count}`.
  An empty histogram read as "no classification data" when it meant "the parser
  did not understand it" — the worst thing a diagnostic can do, and the reason
  the first instrumented run could not finish the diagnosis.
  **The fourth run read nothing at all, and the cause was neither the reader
  nor the cloud.** Both new steps died in ONE SECOND in CI run 59 with
  `PDAL bounded COPC stream failed: The value of "timeout" is out of range. It
  must be an unsigned integer. Received 419999.963211`. The bounded driver
  computes its per-command budget as a deadline minus a float clock, and
  `spawnSync` rejects a non-integer `timeout` outright — so the process never
  started and the RangeError arrived wearing the COPC stream's error message.
  `runGeoCommand` floors the budget now, which is the right place for it: a
  budget is a budget whichever caller computed it, and no call site can
  reintroduce this. There is a regression test on both halves — a fractional
  budget must run, and a fractional budget must still expire. **So the canopy
  and intensity verdicts are still outstanding and no measurement of either has
  been made**; what run 59 proved is only that the account still reads
  Markhöjdmodell and Laserdata Skog and still gets 403 on every orthophoto
  asset.
- [ ] **The thin read is upstream of the canopy pipeline, and an earlier claim
  in this plan was wrong.** With the timeout floored, run 60 completed the
  canopy measurement and the sufficiency gate did its job: `measured: false`,
  `blocked: insufficient-canopy-coverage`, canopy coverage 2.64%, and full
  diagnostics — `pointsFromReader: 358`, `pointsReachingWriter: 285`,
  classification 214/81/63 for unclassified/ground/water, heights above ground
  0–25.25 m, mean 8.68. **Exactly the 358 the single-pipeline version read**, so
  splitting the read out did not change it and the two-pass design was not the
  cause.
  What settles the direction is the sibling statistics step in the same run.
  This plan said it was "dense enough to pass a 10%-of-advertised gate". It is
  not: it reads **52 points over a 256 × 256 m window** at an advertised
  1.1 pts/m², its own density gate returns `usable: false`, and the step passes
  only because that is a warning rather than an error. So **both pipelines read
  about 0.07% of the advertised density with identical reader configuration** —
  0.0014 pts/m², which is the order a COPC octree ROOT NODE holds for a whole
  tile, not what a bounded window of a 1.1–1.7 pts/m² cloud should return.
  Two readings tell a sparse file from a truncated read, and both are now taken
  before the window and reported as `delivery`: the COPC **header**, which says
  how many points the file itself claims and over what extent, and an
  HTTP **Range** probe, which says whether partial requests work at all. A
  reader that cannot range-request can only ever see the root page however
  small a window it asks for. Neither probe retains a byte of the cloud and
  neither can carry a credential into the report — asserted in the tests.
  Until those two numbers are in hand, "Laserdata Skog is authorized and covers
  the whole AOI" is a statement about entitlement, not about delivery.
- [ ] **The one surface route left that needs no permission: LiDAR intensity
  as a pseudo-NIR band.** With a club relationship ruled out, the ledger is:
  shape exhausted, Esri RGB measured and useless, orthophoto behind an order,
  Skogsstyrelsen 401. What remains is a dimension of a source we are ALREADY
  entitled to — Laserdata Skog is flown at **1064 nm**, which is the near
  infrared the orthophoto's NDVI would have used, and healthy turf reflects
  far more there than dry sand. `surfaceIntensityPipeline` rasterises
  Intensity as a 2 m mean from ground returns only (below 0.5 m above ground,
  so a crown cannot stand in for the turf beneath it), and
  `measure-surface-intensity.mjs` compares greens, fairways and bunkers
  against a mown control in the same statistic as every other probe.
  Its window is centred on the played ground by rule — the surfaces under test
  ARE the course, so unlike the canopy window there is nothing to choose and no
  room to fit anything.
  Two caveats travel in the report rather than being discovered later:
  intensity is not radiometrically calibrated between flight lines, so only
  relative comparisons within one window mean anything; and Laserdata Skog is
  a FOREST product whose intensity handling is tuned for canopy, not turf. No
  verdict is claimed until CI runs it.
- [x] **With a club relationship ruled out, the height model was re-asked
  properly — and it closes the shape route for good.** The committed probe had
  tested BUNKERS ONLY, against the same forest-contaminated lattice as the
  orthophoto script (39% here), and its verdict was then quoted as if it
  covered surfaces generally. Re-run against a control restricted to mown
  ground, and extended to greens and fairways by the statistic that suits them
  — a green is a graded PLATFORM, so smoothness, not depth; local relief is an
  annulus measure built for depressions and correctly reads ~0 over a flat
  green:

  | class | ruggedness median | mown control median | control p10 | control p90 | separable |
  |---|---:|---:|---:|---:|---|
  | greens | 0.032 | 0.049 | 0.000 | 0.118 | no |
  | fairways | 0.050 | 0.049 | 0.000 | 0.118 | no |
  | bunkers | 0.087 | 0.049 | 0.000 | 0.118 | no |

  Every direction is physically right — greens smoothest, bunkers roughest —
  and none separates. Greens really are flatter at the median, but mown course
  ground has a flat tail of its own (control p10 is 0.000), so no threshold
  isolates them. The bunker relief verdict also SURVIVES the clean control
  (0.429 against 0.186, control p90 0.590), so that finding was robust; it was
  simply narrower than it had been quoted as.
  The practical consequence: shape is exhausted. No amount of cleverness with
  the 1 m DTM will produce surface outlines, and the plan should stop leaving
  that door ajar.
- [x] **Asked whether another imagery source could start the work now, and
  measured it rather than guessed: Esri World Imagery cannot do this job.**
  It is already in this repo as the canopy authority for all six courses, it
  is orthorectified, free, needs no credentials, and at this latitude z18 is
  0.268 m/px — close to Lantmäteriet's 0.16 m. But it is **RGB only**, so NDVI
  is impossible; the visible-band substitutes (GLI, ExG) and plain brightness
  were all tried against a forest-free control over the played extent:

  | index | bunkers | greens | fairways | control median | control p90 |
  |---|---:|---:|---:|---:|---:|
  | GLI | 0.162 | 0.179 | 0.226 | 0.183 | 0.509 |
  | ExG | 0.229 | 0.255 | 0.327 | 0.260 | 0.818 |
  | brightness | 82.3 | 83.0 | 73.3 | 71.3 | 106.7 |

  Nothing separates. The ordering is at least physical — fairways greenest,
  bunkers least green, bunkers brightest — so the indices measure something
  real; the signal just never beats ordinary course ground, whose p90 sits far
  past every reference median. A 0.27 m JPEG mosaic of mixed capture dates and
  uncontrolled radiometry is the likely reason, and it is worth noting that
  Lantmäteriet says the same of its own product: *"det inte är möjligt att
  göra korrekta radiometriska mätningar i ett ortofoto"*. So the authoritative
  route is a relative comparison too — but on one radiometrically corrected
  campaign rather than a mosaic.
  Esri stays what it already is, a coarse forest/open call over 3 m cells. It
  is not a surface source, and the plan's tier rules would forbid marking it
  one regardless.
- [x] **That experiment found two defects in the committed orthophoto
  measurement, both of which would only have surfaced after the order landed.**
  - A fairway carries `rings`, PLURAL — it can be split by a road or a stand
    of trees — while a green carries `ring`. The script read `fairway.ring`,
    found **zero fairways on all eighteen holes**, and an empty reference set
    makes `separabilitySummary` throw. The measurement would have crashed on
    its first authorised run. It looked healthy only because the entitlement
    check returned early every time — the same shape as the Skogsstyrelsen 401
    the workflow absorbed for weeks.
  - The control lattice was **45.3% forest**, measured against the committed
    tree-cover raster. Conifer is the greenest thing for miles, so a green
    compared against that control would have read "not separable" for entirely
    the wrong reason. The control is now restricted to open ground, and the
    report carries how many points were rejected and by what rule.
  An empty group is now reported as `unmeasured` with its sample counts rather
  than throwing, because that is a gap in the recorded model and not a
  property of the imagery. `main()` is guarded so the module can be imported,
  which is why the fairway bug could finally get a test: nothing could import
  this file before.
- [ ] **A second source is refused, and it has been refused all along:
  Skogsstyrelsen answers HTTP 401 to the configured tree-height account.**
  Every per-hole-controls run has logged it; the workflow simply never failed
  on it, because it requests `both` providers and Lantmäteriet alone was
  enough to proceed with `effective=laser`. It surfaced only when Lantmäteriet
  was briefly unreachable in the same run and no provider passed — which is
  the fail-closed path working, on a red herring. So the tree-height half of
  the canopy plan has produced no authenticated data at all, and the run that
  finally exposed it was a network blip.
  Two things came out of that. A denial is now labelled `denied` and printed
  as `DENIED` rather than sharing a line with weather, because one is an order
  to place and the other is a run to repeat. And `fetch failed` — undici's
  single phrase for DNS, TLS, a reset socket and a refused connection alike —
  is unwrapped through its `cause` chain, since a log that cannot tell an
  outage from a lost entitlement invites blaming whatever commit happened to
  be under it.
- [ ] Run authenticated tree-height and remaining DTM/break windows for all
  three pilots and persist their real compressed/decoded sizes and timings.
- [ ] Produce side-by-side residuals against current Terrarium, tree cover and
  vectors after the authenticated height/canopy windows exist.

Discovery evidence on 2026-08-30 (whole manifest AOIs, not runtime payloads):

| ground | DTM coverage | newest LiDAR | primary ortho | DTM Float32 upper bound | ortho RGBA upper bound |
|---|---:|---:|---|---:|---:|
| `puttom` | 100% | 100% | U2 2024, 16 cm RGBI | 76.7 MiB | 2.92 GiB |
| `norrfallsviken` | 100% | 97.79% | U2 2024, 16 cm RGBI + explicit older edge fill | 73.9 MiB | 2.82 GiB |
| `upsala` | 100% | 100% | O2 2025, 16 cm RGBI | 110.5 MiB | 4.21 GiB |

Authenticated Puttom DTM evidence on 2026-08-30:

| window | source | source bytes | output | output bytes | elapsed | RH 2000 range |
|---|---|---:|---|---:|---:|---:|
| 1,024 x 1,024 m span, 1,025 x 1,025 samples | `dtm-cog` item `702_69` | 276,884,943 | EPSG:5845 ZSTD COG | 3,739,601 | 10 s | 37.242–70.536 m |

The same authenticated run compiled the COG into three LOD levels: 21 regular
terrain chunks plus one dedicated shell, one regular root, 1,548,860 encoded
bytes versus 2,906,156 decoded bytes, and an 84,259-byte first-visible shell.
All quantized seams passed with a shared 37.24 m offset and 1 cm height scale.

Authenticated Puttom Laserdata Skog evidence on 2026-08-30:

| window | retained points | advertised-density ratio | RH 2000 range | classes | disposition |
|---|---:|---:|---:|---|---|
| 256 x 256 m playable hole-1 focus | 52 | 0.000721 | 37.20–63.15 m | unclassified 20, ground 30, water 2 | coverage-gap fallback; no derived asset |

The observed X/Y bounds also remain inside the requested EPSG:3006 window,
which distinguishes a genuine sparse source window from a coordinate-order or
PDAL-bounds error. Raw COPC bytes retained after the job: zero.

The orthophoto numbers make the architectural decision measurable: imagery is
an offline source for per-hole classification/digitisation, never a monolithic
runtime texture. DTM windows are similarly compiled into the D4 tile hierarchy.

Gate: the sources cover the required extents, terms are recorded, vertical
datum is confirmed and measured data supports the proposed format budgets.
The discovery portion plus bounded authenticated DTM and COPC access paths pass.
The full D2 gate remains blocked on per-hole COPC coverage/asset rollout,
remaining pilot/tree-height windows, Norrfällsviken LiDAR
scoping and independent residual/control work.

### D3 — v2 asset graph, codecs and worker loader

Deliverables:

- [x] Versioned root/ground/course manifests and strict JSON Schemas.
- [x] Bounded binary envelope plus independently fetchable, checksummed
  shell/tile/routing chunks, proven with a synthetic graph.
- [x] Worker decode, cancellation, priority queue and resource-recycling
  harness. Production renderer installation remains gated on a real pilot.
- Parent-ground sharing for the three secondary courses. The contract and
  synthetic sharing gate pass; the first REAL course/ground manifest pair is
  now published for `puttom`, and the remaining grounds follow the same
  emitter. Sharing itself is still only proven synthetically, because no
  secondary slug has a compiled parent ground yet.
- [x] Cache strategy for immutable chunks and fresh manifests: verified bytes
  enter Cache Storage only after Worker acceptance, while the root is
  network-first with validated offline fallback. Service-worker route exposure
  waits until v2 public assets exist.
- [x] V1 fallback in the same application build. The exact fallback reference
  is mandatory in the schema and compared against the live GPK1 index before
  selection — now enforced at runtime by the generic selection boundary
  (`v2-terrain-select.mjs`/`v2-graph-source.mjs`) and offline by
  `check-app-build`'s registry/root gate. `?v2=1` falls back explicitly;
  `?v2=require` fails closed. The
  actual v2 terrain renderer remains a D4 deliverable.

Gate: a synthetic and one real course stream progressively on both backends;
corrupt, stale and aborted chunks are handled deterministically.

### D4 — terrain compiler and runtime tile manager

Deliverables:

- [x] Deterministic aligned-master LOD pyramid and conservative per-tile
  geometric-error metadata. National-source rollout remains gated per ground.
- [x] Content-addressed BVCH compiler with a separate bounded whole-ground
  shell, regular LOD chunks and ground-manifest tile fields.
- [x] Source-grid AOI alignment to independent power-of-two tile counts and
  inclusive `N * 256 + 1` sample windows, preventing irregular all-course
  extents from exploding the number of mobile root tiles.
- [ ] Survey-patch and breakline support.
- [x] CPU height sampler with finest-resident-to-shell fallback. The retained
  Puttom preview and legacy renderer now expose one visible-ground sampler to
  camera, water, ball/interactions, surface and object consumers; the generic
  live v2 adapter must preserve this exact interface when activated.
- [x] Compile-time shared-edge overlap and quantized seam verification plus the
  even-sample geomorph contract.
- [x] Backend-neutral screen-space-error selection, hysteresis, active-hole
  override, stable request priority and coherent shell/parent resident fallback
  with explicit WebGPU/WebGL2 desktop/mobile budgets.
- [x] Renderer-neutral streaming controller that connects selection to verified
  scheduling, cancellation, reprioritisation, bounded resource residency and
  exponential retry backoff.
- [x] Backend-common Three.js r185 tile batch, shared grid/index topology,
  portable RGBA8x2 height/parent/normal atlas, partial layer uploads, bounded skirts,
  parent geomorph and isolated stream/runtime integration.
- [x] Credential-safe retained-preview/capture pipeline. Its descriptor is
  structurally forced to remain provisional; source COG/XYZ/BVCH bytes cannot
  enter the screenshot artifact.
- [x] Retained-pilot forced-WebGL2 visual proof: 16 verified real BVCH tiles,
  one logical terrain draw and 58.19% visible foreground in the accepted PNG.
- [x] Retained-pilot WebGPU pixel proof through RGBA8 render-target readback:
  16 verified real BVCH tiles, one logical terrain draw and 58.15% visible
  foreground. The SwiftShader canvas compositor remains blank; hardware-device
  canvas presentation and performance evidence remain separate gates.
- [x] Real-app visual/semantic capture policy requires mobile and desktop
  forced-WebGL2 plus desktop WebGPU, an explicit noon/overhead camera, 16 bound
  provisional surface tiles with rough/fairway/green/tee/sand classes and a
  renderer-only image. Class IDs use the verified primary/secondary union, while
  acceptance uses non-zero signed/current coverage rather than the primary-only
  material histogram. WebGPU is accepted only from a bounded active-pipeline
  RGBA8 readback. Three r185's exact 256-byte WebGPU row padding is removed
  before PNG encoding; every other buffer layout, missing/blank frame or browser
  error fails CI. The report retains only bounded raw/tight/encoded byte counts
  and the padding decision, never the raw pixel buffer.
- [x] Construction-time retained-pilot legacy cutout after complete surface and
  backend compile/draw preflight: 56,169 of 123,175 Puttom CORE base points
  (45.60%) are omitted behind an 8 m guard, planned on the legacy rectangle
  inscribed in the rotated v2 footprint. The reviewed post-normalisation CORE
  is pinned to `[-648,648] × [-756,756]`, 4 m and 325 × 379 points, while any
  post-decision failure rebuilds the complete
  GPK1 CORE from GPK1 heights. All three real-app captures require actual builder
  telemetry rather than planned counts.
- [x] Fail-closed fixed-frontier live adapter selection behind the existing v2
  flag after both visual paths passed. It owns validation, batch lifecycle,
  construction/visible-height gates, fallback and telemetry for the retained
  Puttom pilot.
- [x] Generic, fail-closed v2 source selection boundary behind the existing
  flag: registry-gated `CourseV2ManifestLoader` graph resolution with exact
  live-GPK1 fallback identity, restored `?v2=require` fail-closed semantics,
  a runtime no-request proof for flagless visits, and a build gate that keeps
  the published-slug registry and the built v2 root in lockstep.
- [x] Real published course/ground graph for the first ground. The aligned
  full-course Puttom AOI — 8 x 8 tiles, 2,049 x 2,049 samples at 1 m from the
  same authenticated Lantmäteriet DTM item — compiles to 85 terrain chunks
  plus a bounded shell, and its emitted root/course/ground manifests and
  routing chunk are published and resolved by the live app. Every sample is
  real source (4,198,401 of 4,198,401 finite, declared nodata, 26.12-103.22 m
  RH 2000), and all 1,056,784 retained-preview samples agree with the fresh
  compilation on the shared 1 cm lattice: 1,056,778 exactly equal and 6 tied
  at one quantum, from two independent windows with different quantization
  origins. The frame remains the provisional convention, not a D1 approval.
- [x] Streaming-runtime probe: `?v2stream=1` runs the manifest-driven runtime
  against the published graph inside the real app, after boot and into a
  detached scene, recording time-to-first-resident, time-to-active-hole,
  resident tiles, draw calls and request stats, plus a height-parity
  comparison against the verified pilot sampler. It renders nothing and
  selects nothing; a timeout is reported as a timeout rather than as an empty
  stream. **What it found immediately: the streaming path had never worked in
  a build.** Every unit test injects its own loader, so the decode Worker was
  never exercised; in the built app it was constructed through an alias, which
  a bundler does not recognise as a worker, so the entry was emitted verbatim
  (earlier, inlined as a base64 data URL) with an import that resolved to a
  file that was never built. The worker died on load and every decode job hung
  forever with nothing thrown. Fixed by using the literal construction a
  bundler detects, and gated in `check-app-build`, which now requires a real
  bundled worker chunk with no unresolved imports. A second finding is about
  measurement itself: a software rasteriser cannot complete the probe at any
  deadline, because one `update()` uploading a 257x257 texture array can block
  for minutes there — so streaming timings must come from hardware.
  **A third finding, from the probe's own flag:** reading `?v2stream=1`
  through a helper exported by the probe module made `main.js` a static
  importer of it, so the bundler put a v2 chunk in front of every ordinary
  course visitor. Every per-chunk build assertion still passed; only the
  runtime no-request proof failed, and it failed twenty minutes into CI with
  an otherwise green report. The helper now lives beside `v2RequestMode` in
  the selection module the player already loads, and `check-app-build` gained
  the build-time form of that proof: it walks the static-import closure of the
  entry AND of the routes the entry dynamically enters, and fails if any
  `v2-`/`chunk-worker-` chunk is reachable from it, or if a marker literal
  from a dynamic-only module has been inlined into it. Both branches were
  verified by reintroducing the regression and watching them fire. The
  isolation list no longer demands a separate chunk for the probe summariser:
  it has one importer, so where the bundler puts it is the bundler's business
  and only its absence from the flagless closure is ours.
- [ ] Generic manifest-driven streaming-renderer activation. The graph now
  resolves in the live app (root, course and ground manifests verified, exact
  live-GPK1 fallback identity), but selection deliberately keeps rendering on
  the frontier that passed the adapter contract. Activation needs the probe's
  correctness result plus shell/active-hole timings from real hardware and the
  same three-backend capture proof.
- [x] Height-sensitive camera, water, ball/interactions, surface and object
  placement migrated to the visible-ground sampler in the live app path.
- [ ] Removal of full-course synchronous terrain mesh construction for v2.
  **Scoped, and the blocker is not where it looks.** The legacy builder is one
  function, `buildTerrain`, run three times at boot for three complementary
  tiers: CORE at 4 m over the play area, MID at 12 m over the rest of the GPK1
  fine field, and the FAR vista ring at 36 m. Only CORE is cut today, and only
  by the retained pilot's 1024 m frontier — 56,169 of 123,175 base points, the
  frontier's axis-aligned inscribed rectangle once the frame bridge rotates it.
  In v2 mode the app still constructs roughly 208,700 legacy base points
  synchronously, so the cutout is about 21% of the whole.
  What makes the rest hard is not the builder. It is that **the v2 frontier is
  smaller than CORE**: 1024 × 1024 m against 1296 × 1512 m, so the surviving
  48% of CORE is real ground that nothing else draws. The data to replace it
  already exists and was verified against the committed manifest — the
  published 85-chunk graph covers the whole legacy CORE with margins of
  445.5/306.5/96.8/439.2 m west/east/north/south, because
  `puttomRequiredBoundsEpsg3006()` derives its AOI from the cutout contract's
  own `expectedCoreGrid`. What does not exist is a renderer that will draw it:
  the generic streaming path above is gated, and its activation needs timings
  a software rasteriser cannot produce. So this deliverable is downstream of
  hardware, not of more code in `main.js`.
  Three specifics found while scoping, none of them recorded before:
  - **Almost nothing reads the legacy mesh.** Water, scatter, roads, buildings,
    camera, interactions and the overlays all read the height *sampler*, which
    is fed by a `Float32Array` `buildTerrain` leaves behind rather than by the
    `BufferGeometry`. The genuine mesh readers are the index cut, the adapter's
    activation contract, and shadow casting.
  - **Terrain shadow casting would be lost.** The legacy CORE mesh sets both
    `castShadow` and `receiveShadow`; the v2 batch sets only `receiveShadow`.
    The cutout hides this today because the surviving CORE annulus still casts.
  - **MID's hole is punched under CORE, not under the v2 frontier.** Widening
    the cutout to all of CORE leaves an annulus with no rendered ground, and
    the tuck-under that would seal that seam does not exist (`skirt()` is dead
    code; the v2 batch's skirts only seal its own sub-grid cut).
  The atlas rasterisation and the detail mask are full-course synchronous boot
  work too, but they are not mesh construction and are not v2-specific, so they
  are deliberately outside this checkbox rather than quietly inside it.

Gate: terrain accuracy/seam checks pass and the shell/active-hole performance
budgets are met on the pilot grounds.

### How good the terrain actually is, measured

Asked directly: hills, hollows, slope, heights, depths. Three separate answers,
because the data, the shipped product and the render grid are not the same
thing.

**Heights and landform: good.** Lantmäteriet's Markhöjdmodell at 1 m declares
0.1 m vertical and 0.3 m horizontal uncertainty (tier B) — and the source
manifest already says the right thing about it, that these are
*source-advertised uncertainty, not independent course residuals*. Nobody has
checked it against controls on these courses. Tee-to-green rises run −12.9 m
to +12.5 m, which are plausible course numbers.

**But that is not what ships.** The default GPK1 pages carry AWS Terrarium
heights, stored at 4 m and **quantised to 0.1 m steps**. Compared against the
1 m DTM resampled to the same 4 m grid, so the comparison is fair:

| | slope median | slope p90 | curvature median | curvature p99 |
|---|---:|---:|---:|---:|
| legacy Terrarium @4 m | 12.37% | 37.79% | 0.150 m | 0.750 m |
| Lantmäteriet 1 m @4 m | 7.71% | 22.36% | 0.150 m | 1.245 m |

Legacy is **noisier everywhere and flatter at the extremes** — its fine texture
is largely quantisation and resampling artefact, while the genuine sharp
features of the real ground (banks, ditch edges, breaks) are missing from it.
A 0.1 m step on a 4 m grid is a 2.5% slope artefact on its own, which is most
of that inflated median.

**And the binding constraint is the render grid, not the data.** CORE samples
at 4 m whatever the source:

| feature | median size | samples at 4 m | at 1 m |
|---|---:|---:|---:|
| green | 32.8 m | 8.2 | 33 |
| bunker | 11.0 m | **2.7** | 11 |
| smallest bunker | 7.2 m | **1.8** | 7 |

A bunker spanning 2.7 terrain samples cannot have a lip, a floor and a back
wall; it can only be a dimple. Green contouring — breaks of 0.2–0.5 m over
5–15 m — needs several samples per break and gets eight across the whole
green. Resampling the 1 m data to 4 m also *raises* measured median curvature
from 0.055 m to 0.150 m, which is aliasing: the coarse mesh inventing
roughness it cannot resolve.

So, ranked honestly: elevation and landform are good, slope is currently
overstated by legacy noise, and hollows, swales, green contour and bunker
depth are effectively absent — not because the data lacks them, but because
the pipeline discards them twice, once by shipping Terrarium and once by
meshing at 4 m.

**The largest single lever for terrain realism is therefore the CORE grid, not
the data source.** Taking the play corridor from 4 m to 1–2 m is what makes a
bunker a bunker. It is also the change that the terrain-mesh work in D4 has to
account for, and it interacts with the memory budget the tile manager exists
to hold.

### The largest alignment error in the system is a 3.5° frame rotation

Found while measuring whether OSM greens are accurate enough to skip the
orthophoto. They are — but the measurement turned up something bigger.

**Two frames are in use and they are not parallel.**

- The **legacy frame** every page and every build directory uses is a
  flat-earth approximation about `originWgs84`: `x = (lon − lon0)·mPerLon`,
  `z = (lat0 − lat)·mPerLat`. That is aligned to **true north**.
- The **v2 frame** is EPSG:5845/3006: `worldX = easting − originEasting`,
  `worldZ = originNorthing − northing`. That is aligned to **grid north**.

SWEREF 99 TM has its central meridian at 15° E, so grid north and true north
diverge by the meridian convergence γ ≈ (λ − 15°)·sin φ. Sweden's golf is east
of 15°, so every ground here is affected:

| ground | γ | displacement @500 m | @700 m | @1000 m |
|---|---:|---:|---:|---:|
| Ängsö | 1.61° | 14.1 m | 19.7 m | 28.1 m |
| Upsala | 2.16° | 18.8 m | 26.4 m | 37.7 m |
| Johannesberg | 2.76° | 24.1 m | 33.7 m | 48.2 m |
| Norrfällsviken | 3.14° | 27.5 m | 38.4 m | 54.9 m |
| Veckefjärden | 3.28° | 28.6 m | 40.1 m | 57.2 m |
| Puttom | 3.52° | 30.8 m | 43.1 m | 61.5 m |

**Measured, not derived from the formula alone.** Fitting a rotation between
the GolfTraxx GPS survey and the migration model's EPSG:3006 greens at Puttom
gives **3.47°** against a predicted 3.52° — agreement to 0.05°. And the
residual after removing it collapses from a 24.1 m median to **2.1 m median,
5.2 m max**. Two independent records that never entered each other agree to
two metres once the frames are made parallel.

So the underlying data is good. OSM's greens are fine. What is wrong is the
join: **`alignTerrainPreviewToLegacyFrame` bridges v2 into the legacy world
with `translateX/translateY/translateZ` and no rotation**, and the string
"convergence" appears nowhere in the repository.

**Confirmed a second time, on terrain rather than greens, and it corrects the
sign.** Sampling the published v2 grid through the shipped translation-only
bridge and through rotated variants, scored against the legacy heights with
the datum offset removed:

| bridge | spread (MAD) | p90 |
|---|---:|---:|
| 0° — as shipped | 1.85 m | 13.64 m |
| +3.47° | 2.91 m | 14.58 m |
| **−3.47°** | **0.83 m** | **12.97 m** |

The correct rotation is **−3.47°**, not +3.47° as first written here — the
magnitude matched the greens measurement but the sign did not, and only the
A/B against terrain settled it. It more than halves the disagreement, and the
0.83 m that remains is the genuine Terrarium-versus-1 m-DTM difference. Two
completely independent records — a GPS survey against OSM greens, and legacy
terrain against the v2 grid — give the same magnitude.

Scope, stated carefully so this is not read as worse than it is: the shipped
GPK1 pages are entirely in the legacy frame and are self-consistent — the
legacy model agrees with the GPS survey to a 4.9 m median, which is OSM's own
tracing error, not a frame error. The rotation bites where the two frames
meet, which today is the opt-in `?v2=1` terrain path on Puttom — and it IS
manifesting there, by the table above. It is exactly what "must work with GPS"
depends on, and what would break the moment v2 becomes the default in D8.
**Until it is fixed the pilot should not be shown as a preview of the new
terrain**, because what it shows is the defect. *(Fixed — the next section
records what shipped and what it measures.)*

Two consequences worth writing down before anyone designs the fix:

- A translation-only bridge cannot be made correct by choosing a better
  origin. The error is a rotation about the origin; it is zero at the origin
  and grows linearly outward, which is why an origin check would pass and a
  corner would still be 40 m out.
- There are two repairs and an earlier draft of this section was unfair to the
  smaller one. **Rotating the bridge is a real fix, not a cosmetic one:** the
  legacy frame is a documented flat-earth transform about a known origin, it
  already agrees with the GPS survey to a 4.9 m median, and over a 1.4 km
  course its own scale error is negligible. Landing v2 data correctly inside it
  makes the world self-consistent and GPS-addressable. **Reprojecting
  everything into EPSG:3006** is the geodetically cleaner end state and is
  what D1's open origin item is really about, but it is a refactor of six
  shipped pages and all their committed data. Do the rotation first; treat the
  reprojection as a separate decision about which frame is canonical.
- The rotation must be **derived, not fitted**. Meridian convergence is
  computable from the frame's own origin; the measured −3.47° is then a CHECK
  on that derivation rather than the source of it. A constant tuned to make one
  course look right would silently be wrong on the other five, which sit at
  1.61° to 3.52°. *(Done — see the next section. The derivation also found a
  second term this note missed: the legacy frame's own metre-per-degree is
  0.13–0.34% short of the ellipsoid's, worth another 1.6 m at the corner.)*

### The frame rotation is fixed, and it was bigger than the fit said

`apps/golf/src/engine/geodetic-frame.mjs` now derives the whole transform from
the frames' own declared constants and nothing else. Three terms, each one
computable, none of them tuned:

| term | what it is | Puttom | closes |
|---|---|---:|---:|
| meridian convergence γ | grid north → true north | 3.522145° | 45.2 → 1.6 m |
| frame scale | the pack's metre is not the ellipsoid's | 0.99725 x, 0.99861 z | 1.6 → 0.09 m |
| point scale k | grid metres → ground metres | 1.0000777 | (inside the scale) |

**The second term is the part that needed thinking about, so it is written out
in the module.** The legacy frame uses a sphere of the equatorial radius, so at
63° N its metre-per-degree runs 0.13% short in latitude and 0.34% short in
longitude. Every green, tee and hole line in a pack was written through those
same constants, and so is the conversion a GPS fix takes to enter that world —
the compression is self-consistent INSIDE the frame and cancels. It is visible
only to something arriving by another route, which is exactly what an EPSG:3006
tile is. Matching it completes the change of frame; it does not make the legacy
frame metric-true, and that remains the reason D1's origin question is open.

**Derived, not fitted, and then checked four ways.** Each check uses data that
never entered the derivation:

1. **Against the projection itself.** A Krüger forward EPSG:3006, validated in
   the test to 0.24 µm against the one PROJ-produced point the repo already
   held, differentiated numerically for the grid bearing of true north:
   **0.0001 arcsec** from the analytic series.
2. **Against 4,275 PROJ-projected course coordinates**, the committed
   `geo_data/course-v2/*/migration/` playing geometry — the sharpest available
   statement of what the bridge is worth, and now a gate
   (`geodetic-frame.migration.test.mjs`):

   | ground | pairs | translation only, p50 / max | derived bridge, p50 / max |
   |---|---:|---:|---:|
   | Puttom | 772 | 21.41 / 47.41 m | **0.017 / 0.091 m** |
   | Ängsö | 677 | 17.14 / 40.42 m | 0.025 / 0.141 m |
   | Veckefjärden | 823 | 40.19 / 80.45 m | 0.035 / 0.283 m |
   | Norrfällsviken | 661 | 20.32 / 37.42 m | 0.011 / 0.057 m |
   | Upsala | 693 | 15.40 / 23.95 m | 0.014 / 0.051 m |
   | Johannesberg | 649 | 22.25 / 47.34 m | 0.016 / 0.078 m |

3. **Against a fit nobody had read.** Those same migration directories already
   carried a similarity fitted over the same geometry, and its rotation column
   is the convergence: −3.5262° at Puttom against a derived 3.5221°, and every
   other ground within 86 arcsec. **It was already measured and committed while
   the rotation was still being written up here as an open question — nobody
   had read that column.**
4. **Against the legacy terrain**, sampled through the shipped bridge on the
   played ground — greens, fairways and tee pads, where both products describe
   the same mown surface:

   | bridge | MAD | p90 |
   |---|---:|---:|
   | translation only | 0.745 m | 2.33 m |
   | derived | **0.243 m** | **0.895 m** |

5. **Against the GPS survey, end to end**, since "must work with GPS" is what
   this is for. Taking GolfTraxx's 18 surveyed green centres through the pack's
   own flat-earth rule into the world: 13 of 18 land on `SURFACE.GREEN` in the
   surface atlas, and the survey sits a median 4.94 m (max 11.93 m) from the
   model's own green centres — the documented OSM tracing error, and unchanged
   by the bridge, correctly, because both sides of that comparison are legacy
   vectors. What the bridge does change is how many surveyed greens have v2
   terrain under them at all: **13 → 15 of 18**, because the rotation moved the
   pilot footprint onto the course rather than 20 m off it.

**Why check 3 is 86 arcsec off and check 1 is 0.0001, tested rather than
asserted.** The first guess — that the fit recovers γ at the geometry's
centroid rather than at the origin — is WRONG: moving to the centroid changes γ
by two arcseconds. The actual cause is that the committed fit has ONE scale
where the truth has two. Feeding the same coordinates through the derived
bridge alone and re-fitting a uniform-scale similarity reproduces the committed
rotation to 5–25 arcsec, so the offset is the fit's, not the derivation's. This
is also why the derived bridge beats that fit by an order of magnitude on
residual (Puttom 0.017 m median against its 0.26 m RMSE): it carries the
anisotropy the similarity cannot express.

**The sign, settled.** An earlier note in this plan recorded "−3.47°" and read
as a contradiction of the +3.52° predicted by the formula. It was not: γ is
**+3.522145°** (grid north stands that far east of true north at Puttom), and
the three.js group that draws the v2 tiles therefore rotates by **−γ**. Same
fact, two frames. The 0.05° gap to the old 3.47° was the DEM fit's own
resolution — the MAD curve is flat to ±0.5° — which is the whole argument for
deriving rather than fitting.

**What it touched, and what it deliberately did not.**

- `alignTerrainPreviewToLegacyFrame` keeps the tiles on their own axis-aligned
  grid and puts rotation and scale in the bridge, so the sampler and the tile
  lattice keep working in grid space where they are still rectangles. Only the
  two surfaces that face the legacy world convert: `sample()`, and the render
  group's matrix.
- The group's matrix is composed as **scale after rotation**, which a Group's
  own `T·R·S` cannot express once the scale is anisotropic.
- The legacy CORE cutout now plans against the INSCRIBED legacy rectangle,
  because a rotated footprint has no axis-aligned corners and the legacy
  builder can only omit a rectangle. The reviewed contract went **63,504 →
  56,169** skipped base points: the rotation overhang handed back to GPK1, not
  a smaller pilot. Verified live in Chromium — `skippedBasePoints: 56169`,
  `removedTriangles: 28133`, one draw call, 16 tiles.
- The surface atlas is **left alone**, and finding out why is the second
  lesson of this stage — see below.
- The streaming probe stays wholly in the grid frame. It compares v2 against
  v2, and crossing the bridge on one side only is precisely how a 3.5° rotation
  would read as a terrain mismatch.
- GPK1 remains the default and no pack, page or committed model changed. The
  six standalone pages are single-frame and were never affected.

**The two v2 artefacts are not in the same frame, and the obvious change was
wrong.** The first version of this work also ran the bridge backwards in the
shader before the atlas lookup, on the reasoning that the atlas is v2 and v2 is
EPSG:3006. It is not. `compile-puttom-surface-preview.mjs` reads the GPK1
pack's own `model.holes` — LEGACY vectors — and rasterises them onto the tile
lattice with a translation and nothing else. So a green sits in that raster at
its legacy coordinate, and the correct lookup is the legacy world position,
unbridged. Measured on the 18 green centres and 41 bunkers the pack carries:

| atlas addressed by | greens on green | bunkers on sand |
|---|---:|---:|
| legacy world position | **14 / 18** | **36 / 41** |
| through the bridge | 3 / 18 | 7 / 41 |

The terrain tiles are grid-north DTM and must be bridged; the surface atlas is
legacy vectors and must not be. Bridging both would have moved the paint with
the ground and looked entirely plausible — greens still on greens — while
putting every green 20 m from the ground it belongs to, which is the defect
this whole stage exists to remove. **Being v2 is not the same as being in the
v2 frame.**

Two consequences, both small and both stated rather than hidden. The atlas
rectangle is axis-aligned in legacy numbers while the mesh footprint is now
rotated, so **2.95% of the drawn v2 area — a band at the frontier corners,
none of it on the course — falls outside the atlas and paints rough**. And
176 of the 1241 played-geometry vertices sit outside that rectangle, but that
is the 1024 m pilot being smaller than the course and is unchanged by this
work. The clean fix for both is to compile the surface raster in the grid
frame like the terrain, which costs a recompile and new asset hashes; it
belongs with the streaming surface chunks, which will be grid-frame anyway.

**One hour lost to a name.** The decorator declared `const cos, sin` for the
inverse rotation, forty lines above a `sin(phase)` that is a **TSL import** in
the same function. The material failed to build with `sin is not a function`,
the adapter fell back closed exactly as designed, and the only symptom the
capture harness reported was a minified `u is not a function`. Fail-closed
worked; the diagnosis came from re-running an unminified build in Chromium and
reading the console. Shadowing an imported node-graph builtin with a scalar is
invisible to `no-undef`.

**What this does not do**, stated so the next stage is not planned against a
fix that is smaller than it sounds:

- It does not make the legacy frame metric-true. The frame is still a sphere of
  the equatorial radius, still 0.13–0.34% off the ellipsoid, and everything in
  it is still self-consistent about being so. Whether that frame stays canonical
  is D1's open origin question, and this bridge does not answer it.
- It does not widen the pilot. 16 tiles over 1024 m is unchanged, and after the
  rotation the axis-aligned share of CORE it can omit is 45.60% rather than
  51.56%.
- It does not improve the terrain that ships. GPK1 still carries Terrarium at
  4 m, and for the default page the ranked levers above are unchanged: **the
  CORE grid from 4 m to 1–2 m is still the largest one**, because a bunker
  spanning 2.7 samples is a dimple whatever frame it is in.

  What HAS changed is what the opt-in pilot is worth, and it is more than this
  plan credited it with. The 16 tiles render at 1 m, and now that they are in
  the right place the rotated footprint contains **15 of Puttom's 18 greens,
  37 of 41 bunkers, 24 of 29 tee pads and 86.8% of the hole centre lines**. So
  the 4 m constraint is a statement about the DEFAULT page, not about the data
  path: inside `?v2=1` most of this course already meshes at 1 m, which is 11
  samples across a median bunker instead of 2.7. The remaining lever for the
  pilot is coverage, not resolution.

  **And what the 1 m data actually finds there is worth stating, because it is
  less than "1 m" suggests.** Sampling the same OSM rings at 1 m steps through
  both terrains — rim mean minus floor minimum, on the raw heightfields before
  any runtime carving:

  | feature | legacy Terrarium @4 m | Lantmäteriet @1 m |
  |---|---:|---:|
  | bunker, median relief | 0.24 m | **0.37 m** |
  | green, median spread | 0.68 m | **0.42 m** |

  The bunkers gain 54% and the greens LOSE 38%, and both go the right way: a
  bunker is a real hollow that a coarse noisy grid cannot hold, while a green
  is not a hollow at all, so the larger legacy number there is its documented
  0.1 m quantisation rather than contour. **But a median bunker still reads
  0.37 m deep at 1 m, and a real bunker is not 0.37 m deep.** Either the OSM
  bunker rings do not sit where the sand does, or a bare-earth DTM smooths a
  sand hollow, or both — so "the pilot resolves bunker depth" is not a claim
  this supports yet. It is a measurement, not a gate.
- It does not touch the six standalone pages, which are single-frame and were
  never affected.

**Local acceptance, stated for exactly what it covers.** The interactive
capture harness passes both WebGL2 cases on the rotated build — mobile and
desktop, each with `surfaceEvidencePassed`, `legacyCoreCutoutPassed`,
`liveAdapterPassed` and `selectionPassed` all true, the badge reading
*16 verifierade tiles · WebGL2 · 1 m höjd · 1 m mesh*, and the adapter
reporting `skippedBasePoints: 56169`, `emittedBasePoints: 67006`,
`removedTriangles: 28133`, one draw call over 16 tiles. The **WebGPU case is
unverified locally**: SwiftShader's Vulkan path does not finish a boot inside
480 s in this container, and did not before this change either — the WebGL2
boot alone takes 39.9 s here. That case is CI's to prove, which is what the
provider-access workflow does, and the top-level `requiredCasesPassed` stays
false locally because of it. A harness that cannot run a backend is not
evidence that the backend works.

### The visual target is not the data target

Stated by the project owner, and it reframes what the surface work is FOR:
*"I do not need the textures to look exactly like in real life, I want it more
to look like a good AAA golf game."*

**The orthophoto was never a texture source, and it is worth saying plainly
because the plan reads as if it were.** The renderer loads no imagery at all —
verified: no `TextureLoader`, no image files, no photo textures anywhere in the
ground path. Ground is shaded from surface-class IDs and a palette. What the
orthophoto buys is BOUNDARIES: where the green stops and the collar starts,
where the bunker lip is. Appearance was always procedural.

So the bar on boundaries drops from *survey-grade and authoritative* to *plays
and reads right* — and boundaries at that standard already exist. Puttom is
fully mapped in OSM (20 greens, 21 fairways, 41 bunkers); the other five have
satellite traces anchored by GPS surveys. **The D5 acquisition problem is not
a blocker for the stated visual goal.** The orthophoto order is still worth
placing, because it is free and it sharpens edges, but nothing should wait on
it, and the tier discipline stays for the truth claims the pages make — not
for how good they look.

What actually separates this renderer from a good golf game, measured from the
code rather than guessed:

| gap | now | AAA reference |
|---|---|---|
| shadow resolution | **1.60 m per texel** — one cascade over 3,280 m at 2048² | 3–4 cascades, 0.02–0.05 m near the camera |
| near-field turf | shader only: bump map, blade-scale speckle, mow stripes | instanced blades or shell layers in the first 10–20 m |
| contact occlusion | baked per-vertex horizon AO only | screen-space AO at bunker lips, trunks, collars |
| tone/fog/materials | ACES, per-surface roughness, seasonal fog presets | already reasonable |

The first row is the big one. Golf is played looking at ground two to thirty
metres away, and at 1.6 m per shadow texel the flag casts nothing, the bunker
lip casts nothing, and there is no contact shadow under the ball. That single
number is most of the distance between "tech demo" and "game".

**One trap before touching any of it:** the parity harness compares pixels, and
every golden and parity gate in this repo would fail the moment shadows or
turf change. That is the gate working, not breaking — but the goldens must be
re-approved deliberately, by a human looking at pictures, rather than
regenerated to make a red gate green.

### D5 — v2 surface compiler and material parity

Deliverables:

- [ ] Reviewed surface polygons in canonical coordinates.
- [x] Fail-closed authoritative surface intake with source-manifest/licence/
  checksum/date/accuracy/review/frame gates, strict polygon topology and
  deterministic synthetic seam proof. No real Puttom source has passed it.
- [x] Puttom authoritative-surface preflight/report that exposes the exact
  origin, terrain-frame, source, licence and human-review blockers without
  promoting the retained migration preview.
- [x] Fixed, lossless ID/SDF/field BVCH contract, encoder, decoder, strict
  bounds/nodata validation and browser parity. Real-ground compilation remains.
- [x] Shader adapter into the existing `makeGround()` material family for the
  retained migration preview; authoritative activation remains gated.
- [ ] Green, fringe, fairway, tee, rough, bunker, path, rock and forest-floor
  appearance pass.
- [ ] Per-hole material and grazing-angle goldens.
- [ ] Legacy procedural shaping disabled wherever authoritative survey geometry
  supplies the real surface.

Gate: surface probes, edges and goldens pass on both backends without exceeding
the shader/frame budgets.

### D6 — object registry and course digital-twin scenery

Deliverables:

- [ ] Canopy/tree, scrub, rock/boulder and built-object compiler.
- [x] Canonical published-object schema with stable IDs, source, capture date,
  confidence, accuracy and review metadata. Real registry-diff production is
  still pending.
- [ ] Per-hole object-review overlay/editor.
- [x] Decoder/graph enforcement of reviewed records and the no-procedural,
  tier-A/B/C rule in truth zone A. Human source review remains a release gate.
- [ ] Backend-common instancing/batching and LOD assets.
- [ ] Runtime candidate scanning removed for v2 course/property objects.

Gate: all zone-A objects are data-derived and reviewed; visual/object and
performance checks pass on the three pilot grounds.

### D7 — survey programme and all-course rollout

Deliverables:

- Survey procurement/field specification for greens, tees, bunker lips,
  signature trees, major rocks and control points.
- Ingest and approve available surveys.
- Run D1–D6 for `angso`, `johannesberg` and `veckefjarden` after the pilots.
- Rebuild all six parent grounds and all nine course entries.
- Human per-hole review matrix for terrain, surfaces and objects.
- Publish source dates and accuracy tiers in debug/data-info UI.

Gate: all nine slugs meet geospatial, visual, backend, performance, PWA and
licence gates. No course remains on v1 by accident.

### D8 — default flip and legacy retirement

Deliverables:

- V2 becomes default after one release with explicit v1 escape hatch.
- Compare field telemetry and error reporting before deleting fallback.
- Remove duplicated DEM/satellite/tree-cover runtime work only after the final
  v1-supported release.
- Archive migration reports and preserve source provenance.
- Update `README.md`, `CLAUDE.md` and operational build instructions.

Gate: one stable release, no unexplained backend/course regression and an
approved rollback record. Only then remove `GPK1` and the runtime course-wide
procedural truth path.

## Suggested work-package order

The first implementation pull requests should be small and reversible:

1. Source/provenance schema and six ground manifests. **Implemented:** the
   build-time contract and gate are live; authoritative acquisitions and their
   release-blocking metadata remain open.
2. Pinned geospatial tool environment and EPSG:5845 transformation tests.
   **Implemented:** cross-platform lock, Swedish grid verification, official
   controls and deterministic horizontal migration are live; canonical origin
   approval remains intentionally blocked.
3. One Lantmäteriet COG acquisition/clip comparison, with no runtime change.
   **In progress:** official assets, contracts, coverage and metadata are
   checksummed for all three pilots, the reader/clipper is implemented and a
   real authenticated 1,024 m Puttom window passes the COG/CRS/hash/timing
   proof. Remaining pilot/tree-height windows and comparison residuals remain.
4. V2 manifest/chunk schema plus synthetic codec tests. **Implemented:** strict
   content-addressed root/course/ground contracts, bounded `BVCH` framing,
   deterministic uint16 terrain quantization, parent sharing and v1 fallback
   pass 14 synthetic integrity/semantic tests. Production `GPK1` is untouched.
5. Worker priority/cancellation/cache harness. **Implemented:** Web Crypto and
   bounded native decompression, transferable buffers, stable priorities,
   shared-request deduplication, scope cancellation, corrupt-cache recovery,
   network-first root handling and LRU recycling pass 12 runtime tests.
6. One coarse-shell and one active-hole terrain spike behind a URL flag.
   **Renderer foundation implemented:** immutable shell/LOD chunks, compact
   Worker GPU preparation, shared-topology instanced rendering and stream
   integration are deterministic. The secrets-backed real-pilot capture path is
   implemented and only exports screenshots/backend status. Forced WebGL2 is
   accepted; WebGPU render-target pixels are also accepted with matching
   terrain coverage. Hardware canvas presentation and device measurements remain
   activation evidence.
7. CPU height-sampler parity tests. **Implemented in the app path:** v2 preview,
   rendered legacy mesh and analytic fallback are deterministic, and the shared
   result now drives camera/water/ball/interactions/surface/object consumers.
8. Surface-tile adapter into the existing ground material. **Migration path
   implemented:** fixed lossless packing, strict Node/browser decoding, Puttom
   compilation and material adaptation pass. The authoritative intake/compiler
   boundary is also implemented, but no real reviewed polygon source has passed
   its release gates.
9. Object registry schema and one reviewed tree/boulder tile. **Synthetic
   contract implemented:** source/review/accuracy metadata and zone-A policy
   pass end-to-end; a real reviewed tile remains.
10. Pilot-ground end-to-end integration.

No pull request should combine a new source, codec, renderer path and appearance
retune without separately measurable gates. Data truth, distribution,
rendering and art direction need independent diffs.

## Operational update cycle

The digital twin is dated, not timeless. For each source refresh:

1. Query acquisition metadata and compare checksums.
2. Rebuild changed normalized layers only.
3. Produce terrain, surface and object diffs.
4. Flag large elevation changes, felling, new canopy, bunker/green renovation
   and building changes.
5. Require human review for zone-A changes.
6. Emit only changed content-addressed chunks.
7. Run all gates for affected ground and child course slugs.

This makes a course renovation or felling a small, auditable update rather than
a manual rewrite of one enormous pack.

## External references

- Lantmäteriet Markhöjdmodell:
  <https://geotorget.lantmateriet.se/dokument/projects/markhoejdmodell-nedladdning/released/1/>
- Lantmäteriet height/LiDAR STAC API:
  <https://api.lantmateriet.se/stac-hojd/v1/>
- Lantmäteriet orthophoto STAC API:
  <https://api.lantmateriet.se/stac-bild/v1/>
- Lantmäteriet high-value-dataset terms, CC BY 4.0:
  <https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder.pdf>
- Lantmäteriet Laserdata skog terms, CC BY 4.0:
  <https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf>
- Lantmäteriet 2026 COG/break-geometry update:
  <https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/markhojdmodell-nedladdning-utokas-med-mer-innehall/>
- Lantmäteriet Laserdata Skog:
  <https://geotorget.lantmateriet.se/dokument/projects/laserdata-nedladdning-skog-api/released/1/>
- Lantmäteriet orthophoto:
  <https://geotorget.lantmateriet.se/dokument/projects/ortofoto-nedladdning/released/2025.02/>
- Skogsstyrelsen tree-height REST technical specification:
  <https://www.skogsstyrelsen.se/globalassets/sjalvservice/karttjanster/geodatatjanster/teknisk-beskrivning/raster-tradhojd-laserdata-skog---teknisk-beskrivning.pdf>
- Skogsstyrelsen geodata terms, CC0 unless otherwise noted:
  <https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/>
- Lantmäteriet Topografi 10:
  <https://geotorget.lantmateriet.se/dokument/projects/topografi-10-nedladdning-vektor/released/2026.05/>
- Lantmäteriet Swepos Network RTK:
  <https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/swepos-natverks-rtk/>
- Lantmäteriet coordinate transformations and SWEN17_RH2000:
  <https://www.lantmateriet.se/en/geodata/gps-geodesy-and-swepos/transformations/>
- Lantmäteriet SWEREF 99 TM projection controls:
  <https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Tvadimensionella-system/SWEREF-99-projektioner/contentassets/kontrollpunkter_sweref99tm.pdf>
- Lantmäteriet Swedish transformations in PROJ:
  <https://www.lantmateriet.se/globalassets/geodata/gps-och-geodetisk-matning/svenska-transformationer-i-proj-web.pdf>
- PROJ releases:
  <https://proj.org/en/stable/download.html>
- GDAL releases:
  <https://gdal.org/en/stable/download.html>
- PDAL releases:
  <https://github.com/PDAL/PDAL/releases>
- Pixi lock-file guarantees:
  <https://pixi.prefix.dev/latest/workspace/lock_file/>
- Skogsstyrelsen tree-height raster:
  <https://www.skogsstyrelsen.se/globalassets/sjalvservice/karttjanster/geodatatjanster/teknisk-beskrivning/raster-tradhojd-laserdata-skog---teknisk-beskrivning.pdf>
- SGU open-data licence:
  <https://www.sgu.se/produkter-och-tjanster/geologiska-data/om-geologiska-data/licensvillkor/>
- OpenStreetMap licence:
  <https://www.openstreetmap.org/copyright>
- Three.js `WebGPURenderer`:
  <https://threejs.org/docs/pages/WebGPURenderer.html>
- Three.js `BatchedMesh`:
  <https://threejs.org/docs/pages/BatchedMesh.html>

## Definition of done

This plan is done only when a player can open any course and receive, quickly:

- the correct measured landform;
- the correct green, fairway, tee, bunker and material boundaries;
- visually rich but source-honest ground materials;
- real treelines, vegetation structure, rocks and stable objects in the playing
  environment;
- identical active-hole geographic truth in WebGPU and WebGL2;
- explicit source date, accuracy and licence;
- verified performance on the agreed desktop and mobile devices.

Anything less is an intermediate phase, not completion.
