# Course digital twin — terrain, surfaces and real-world objects

> **Status 2026-08-31:** D0–D4 foundations are implemented and the retained
> Puttom pilot now has an interactive, opt-in `?v2=1` preview: 16 verified 1 m
> terrain BVCH tiles and 16 matching migration-surface BVCH tiles replace the
> matching legacy core in one logical terrain draw. The renderer now compiles
> and draws that complete v2 batch offscreen before legacy construction and
> omits 63,504 of Puttom's 123,175 CORE base-grid points behind an 8 m normal/
> detail guard. Actual builder omissions, not planned counts, enter the capture
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
- [ ] Compile laser-derived vegetation/object candidates only for per-hole
  windows that pass the local density and coordinate-bounds gates; use
  Markhöjdmodell, tree height and orthophoto fallback elsewhere.
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
  backend compile/draw preflight: 63,504 of 123,175 Puttom CORE base points
  (51.56%) are omitted behind an 8 m guard. The reviewed post-normalisation CORE
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
- [ ] Generic manifest-driven streaming-renderer activation. The graph now
  resolves in the live app (root, course and ground manifests verified, exact
  live-GPK1 fallback identity), but selection deliberately keeps rendering on
  the frontier that passed the adapter contract. Activation needs the probe's
  correctness result plus shell/active-hole timings from real hardware and the
  same three-backend capture proof.
- [x] Height-sensitive camera, water, ball/interactions, surface and object
  placement migrated to the visible-ground sampler in the live app path.
- [ ] Removal of full-course synchronous terrain mesh construction for v2.

Gate: terrain accuracy/seam checks pass and the shell/active-hole performance
budgets are met on the pilot grounds.

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
