# Course v2 production guide — the PUTTOM standard

> Status: working standard, first consolidated edition, 2026-09-04.
>
> Puttom is the reference implementation for the spatial, tile, provenance,
> runtime and validation framework. It is not yet the authority for every data
> layer: its 1 m terrain and LiDAR vegetation are implemented, but its canonical
> origin is still marked provisional, its played-surface vectors are migrated
> rather than surveyed, its zone-A tree approval was automated rather than
> human, and v2 remains opt-in. A new course must reproduce the framework and
> close its own evidence gates; it must not copy Puttom's provisional values.

This is the practical guide for recreating an existing course or building a new
one to the same standard as PUTTOM v2. It brings together the workflow that was
previously spread across code, manifests, implementation plans and handoff
notes. Use it as the production checklist and update it whenever a generic
compiler command, schema or gate changes.

The deeper design rationale remains in
[`course-digital-twin-implementation-plan.md`](course-digital-twin-implementation-plan.md).
Surface encoding decisions are in
[`puttom-v2-surface-rendering-plan.md`](puttom-v2-surface-rendering-plan.md), and
the measured tree workflow is in
[`puttom-v2-lidar-tree-placement-plan.md`](puttom-v2-lidar-tree-placement-plan.md).
Where this guide and executable code disagree, the schemas, validators and
published manifests win; fix this guide in the same change.

## 1. What “the PUTTOM v2 standard” means

The standard is a chain of evidence, not a particular look or a copied set of
constants.

| Concern | Required outcome |
|---|---|
| Spatial truth | All master data uses SWEREF 99 TM + RH 2000 (`EPSG:5845`), with explicit axis order, source CRS, accuracy and one immutable origin per physical ground. |
| Terrain | Lantmäteriet 1 m Markhöjdmodell is the base; approved survey patches may supersede it locally. Regular 1 m course tiles share exact edge samples and are surrounded by aligned coarser rings from the same height source. |
| Golf surfaces | Reviewed polygons describe greens, fringes, tees, fairways, semi-rough, bunkers and other materials. They compile to the same tile lattice with lossless class IDs and a signed-distance boundary field. |
| Roads and hard surfaces | Roads, paths, parking, asphalt, gravel and dirt are measured/digitized continuous features with provenance. They are surface or breakline geometry, not decorative meshes laid approximately over the ground. |
| Water | Water rings and levels are explicit. The DTM is treated as the water surface, never as bathymetry. Water, shore, islands, streams, culverts and render-time bed treatment are checked together. |
| Trees and vegetation | Individual positions come from survey or data-derived crown evidence; dense forest uses measured stand fields. Every base samples the exact published terrain. Procedural large objects are forbidden in the playing truth zone. |
| Stable objects | Buildings, bridges, fences, signs, lights, furniture, boulders and drainage objects have stable IDs, source/date/accuracy/review fields and tile ownership. |
| Distribution | Course and ground are separate, chunks are immutable and content-addressed, a coarse shell loads independently, and every payload is verified before use. |
| Runtime | WebGPU and WebGL2 use the same geography, height sampler, surface semantics and zone-A transforms. Unsupported, partial or hash-invalid v2 data fails closed to the declared v1 fallback. |
| Validation | Geometry, provenance, visuals, both render backends, caching, offline reopen and named hardware budgets pass per course and per hole. Human visual inspection is mandatory because self-consistency tests cannot prove resemblance to the real course. |

The non-negotiable rules are:

1. Never warp trusted terrain to fit an uncertain trace.
2. Never infer authority from resolution. A 1 m raster can still be old,
   misregistered, unlicensed or unsuitable for the feature being claimed.
3. Never call a crown centre a surveyed stem, an orthophoto trace a survey, or
   a visual fill object a measured object.
4. Never use phone altitude as a height control.
5. Never perform national-data acquisition or GIS processing in the browser.
6. Never ship raw orthophoto as the rendered ground material. It is measurement
   input; the output is the semantic material system.
7. Never create a separate geographic truth set for WebGPU and WebGL2.
8. Never overwrite the only working generation. Publish atomically and retain
   an exact manifest reference for rollback.

## 2. The Puttom reference, stated accurately

These numbers describe the current implementation and are useful as a sanity
shape. They are not constants for another course.

| Layer | Puttom reference state |
|---|---|
| Finest terrain | 2,048 × 2,048 m; 8 × 8 tiles; 1 m sample spacing; 256 m tile span; 257 × 257 samples per tile; 1 cm height quantization. |
| World terrain | Seven levels at 1, 2, 4, 8, 16, 32 and 64 m; 277 tiles total; 16,384 m root extent; the 1 m level is reused byte-for-byte. |
| Terrain identity | 64 finest tiles, 4,227,136 compared samples, exact against the retained preview at the recorded checkpoint. |
| Surface preview | 30 of the 64 finest tiles, on the 1 m lattice; `class-sdf-v1`; derived from the current GPK1 vectors; explicitly “migrerade ytor (ej inmätta)”. It is a separate preview descriptor and is not attached as an authoritative surface layer in the current ground graph. |
| Vegetation | 3,502 `derived-lidar` individual records plus 64 measured 4 m stand-field tiles; 64 object tiles; stable base heights from the published terrain. The current generation used versioned machine review by owner decision, not per-object human review. |
| Runtime | v2 is selected explicitly with `?bana=puttom&v2=1`; `v2=require` turns any fallback into a hard test failure. GPK1 remains the default production path. |
| Frame status | Runtime assets carry an `EPSG:5845` frame and fingerprint, but the source manifest still records zero independent origin anchors and `pending-control-approval`. Treat it as a migration frame, not an approved survey origin. |

The authoritative current graph is reached through
[`apps/golf/public/courses/v2-index.json`](../apps/golf/public/courses/v2-index.json).
Do not paste content hashes from this document: resolve the live root, course
manifest and ground manifest because each publication creates new names.

## 3. Vocabulary and ownership

- A **ground** is one physical property and one immutable spatial frame. It owns
  terrain, surfaces, objects, stands and source provenance.
- A **course** is a playable routing/card on a ground. It owns hole order, par,
  stroke index and line geometry, and references the ground. Several courses
  may share one ground without duplicating terrain.
- A **source asset** is acquired evidence: a COG, COPC item, GeoPackage, survey
  file, club document or other registered input.
- A **derived artifact** is a reproducible output with a source chain, checksum
  and toolchain identity.
- A **tile** is the unit of compile, verification, streaming, ownership and
  eviction. A hole references overlapping tiles; terrain is not duplicated per
  hole.
- A **truth zone** controls which placement methods are allowed:

| Zone | Extent | Policy |
|---|---|---|
| A | Played corridors plus an approved 80–100 m buffer, facilities, landmarks and signature sightlines | Surveyed or approved data-derived large objects only; no procedural large-object records. Dense unresolved canopy may be a measured stand field. |
| B | Remaining course property | Measured area/stand truth; reviewed large individuals; source-constrained representative small vegetation may be used. |
| C | Distant surroundings and horizon | Source-constrained clusters or procedural scenery are allowed because individual placement is neither measurable nor gameplay-visible. |

Puttom currently approximates zone A as 90 m and zone B as 300 m from a hole
line. That was sufficient to exercise the compiler, but a production course
should derive the zones from approved playing-area geometry, landing zones,
sightlines, facilities and safety constraints.

## 4. Source hierarchy and where to obtain the data

The central product and licence register is
[`geo_data/course-v2/source-catalog.json`](../geo_data/course-v2/source-catalog.json).
Every ground has its own source and artifact ledger at
`geo_data/course-v2/<ground-id>/source-manifest.json`, validated by
[`source-manifest.schema.json`](../packages/course-geo/source-manifest.schema.json).
The table below is the acquisition route, not a substitute for recording the
exact terms supplied with an order. The external routes were last checked on
2026-09-04 and must be rechecked when a new ground starts.

| Layer | Preferred source and acquisition | Use and cautions |
|---|---|---|
| Control, greens and other microterrain | Club-owned as-built CAD/GIS, RTK GNSS, total-station survey, or controlled drone LiDAR/photogrammetry. Obtain directly from the club or its survey contractor with an explicit derivative/distribution grant. | Highest authority. Request `EPSG:3006`; heights must be RH 2000 (`EPSG:5613`) or include enough metadata to transform them. Keep equipment, method, control network, capture date and signed accuracy report. |
| Base terrain | [Lantmäteriet Markhöjdmodell Nedladdning](https://geotorget.lantmateriet.se/dokument/projects/markhoejdmodell-nedladdning/released/1/). Order free API access in Geotorget/API Portal; the API is found as `STAC-hojd`. | Primary 1 m DTM, delivered as 10 × 10 km COG items in SWEREF 99 TM + RH 2000. Read bounded windows. Record STAC item, dates, ETag/checksum, declared 0.3 m plan/0.1 m height uncertainty and licence/attribution. |
| Water break geometry | The break-geometry asset associated with Markhöjdmodell/Laserdata orders. | GeoPackage geometry identifies flattened water. Verify the advertised multihash, clip to the AOI and keep islands/holes. It does not provide bathymetry. |
| Orthophoto | [Lantmäteriet Ortofoto Nedladdning](https://geotorget.lantmateriet.se/dokument/projects/ortofoto-nedladdning/released/2025.02/). Order access and query `STAC-bild`. | RGB/IR measurement input for surface boundaries, forest edges, recent change and objects. Select the newest suitable campaign, retaining an explicit older gap-fill if needed. Access includes legal/GDPR and special-terms review. Do not ship a draped photo texture by default. |
| Roads, buildings, general hydrology and land cover | [Lantmäteriet Topografi 10 Nedladdning, vektor](https://geotorget.lantmateriet.se/dokument/projects/topografi-10-nedladdning-vektor/released/2026.05/). Order a one-off extraction or subscription. | Supporting geometry for infrastructure, shorelines and land cover. Check local recency and planimetric fit; it does not know the golf course's maintained edge as well as the club does. |
| Individual-tree and canopy evidence | [Lantmäteriet Laserdata Nedladdning, skog](https://geotorget.lantmateriet.se/dokument/projects/laserdata-nedladdning-skog-api/released/1/). Order API access; discovery is also through `STAC-hojd`. | COPC/LAZ in `EPSG:5845`, useful for canopy, returns, capture recency and difficult terrain QA. Typical density cannot resolve every stem. Pin all intersecting campaigns and their seams; never silently adopt a re-flight. |
| Supporting tree-height raster | [Skogsstyrelsen account/order page](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/anvandarkonto/) and [download overview](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/ladda-ner-geodata/). | The repository adapter expects the 1 m signed-Int16, decimetre product. It derives from the same Laserdata Skog family and is supporting evidence, not an independent individual-tree survey. Record scan vintage. |
| Independent canopy cross-check | Meta/WRI Canopy Height Maps v2 COGs from the public Data for Good bucket, as used by [`build-chmv2-window.mjs`](../packages/course-geo/chmv2/build-chmv2-window.mjs). | Optical, independent-sensor check for canopy presence, height bias, seams and clear-fells. Do not replace the newer local laser just because the optical model disagrees. Record object URL, ETag, size and licence attribution. |
| Supplementary map features | [OpenStreetMap](https://www.openstreetmap.org/copyright), acquired as a dated extract or bounded Overpass result. | Useful for cross-checking roads, paths, water, buildings and sometimes golf geometry. ODbL lineage and attribution must remain explicit. OSM alone never upgrades a green, fairway or tee to authoritative. |
| Routing and card | Current club scorecard, course guide and maintenance material, supplied or explicitly licensed by the club. | Good authority for par, tee names, lengths and intended routing. A diagram without coordinates is corroboration, not a spatial survey. Record edition/publication date. |
| Geology/context | SGU geology/soil-depth and other public contextual layers. | Broad context for rock/soil appearance only. Do not derive individual boulder outlines from regional geology. |
| Existing Banvy model | GPK1, legacy course model, Terrarium, old traces, GolfTraxx and imagery-derived rasters already inventoried in the ground manifest. | Migration and regression comparison only unless the source rights and accuracy are independently approved. Esri/Google-derived traces and GolfTraxx coordinates are not production authority in v2. |

Recheck provider access, current terms and product version at the start of a new
ground. The manifest must record provider/product, immutable ID or URL,
checksum or an explicit reason why one is unavailable, acquisition and capture
dates, CRS, stated accuracy, licence, redistribution decision, toolchain,
reviewer and review date. Credentials and authorization headers are never
serialized.

### Accuracy labels

Accuracy is a statement backed by evidence, not a source nickname.

| Tier | Meaning | Initial release target |
|---|---|---|
| A | Independent controlled survey | Stable feature position ≤ 0.10 m; surveyed green vertical residual ≤ 0.05 m. |
| B | Authoritative remote data, independently checked | Terrain vertical RMSE ≤ 0.15 m; planimetric feature residual ≤ 0.50 m. |
| C | Derived object/feature with measured confidence | Source-dependent uncertainty recorded; manual review in zone A. |
| D | Area truth | Boundary, height and density known, but individual instances representative; normally outside zone A. |
| E | Procedural visual fill | Distant scenery only. |

If independent checks do not meet the target, downgrade the asset. Do not relax
the meaning of the tier.

## 5. Canonical coordinates and the tile contract

### 5.1 Spatial frame

The canonical compound CRS is `EPSG:5845`:

- horizontal: SWEREF 99 TM, `EPSG:3006`, metres;
- vertical: RH 2000, `EPSG:5613`, metres;
- coordinate order in master vectors: `[easting, northing]`;
- object and terrain heights: absolute `heightRH2000`.

The renderer uses small, ground-local floats:

```text
worldX = easting - originEasting
worldZ = originNorthing - northing
worldY = heightRH2000 - originHeightRH2000
```

One physical ground has one origin, shared by every child course. After the
first approved v2 release, the origin is immutable: changing it moves every
tile, object and patch and changes the frame fingerprint. Convert ellipsoidal
GNSS heights through the pinned `SWEN17_RH2000` PROJ grid. Do transformations
offline and never repeatedly round-trip approved coordinates through WGS84.

The legacy GPK1 bridge is a migration adapter only. Its grid convergence,
scale, translation and vertical offset are course-specific. Puttom's measured
legacy-to-RH-2000 vertical offset is 23.6263 m; copying it to another ground is
a serious error because geoid separation changes across Sweden.

### 5.2 Finest terrain tiles

The current production-shaped terrain contract is:

- source/sample spacing: 1 m;
- `tileSegments: 256`, so a regular tile spans 256 × 256 m;
- 257 × 257 height samples, including the east and south shared edges;
- adjacent tiles must carry byte-equivalent shared boundary samples;
- sample coordinates and `gdal_translate -projwin` pixel edges differ by half
  a sample; preserve this distinction;
- `terrain-grid-u16-le-v1` payload in a BVCH v2 envelope;
- bounded per-tile integer quantization with a recorded offset/scale; Puttom
  uses a 0.01 m scale at LOD0 and has 0.005 m maximum quantization error;
- no-data value, min/max RH 2000 height, geometric error, bounds, decoded size,
  encoded and decoded hashes in the contract;
- tile IDs `l<lod>/<column>/<row>` and absolute `EPSG:3006` bounds;
- terrain, surface, objects and stands attach as separate layers to the same
  logical tile.

`alignTerrainGridExtent()` in
[`terrain-compiler-node.mjs`](../packages/course-v2/terrain-compiler-node.mjs)
expands required bounds to the tile lattice. Choose what the AOI must contain;
let the compiler align it. Do not type a width and then distort the course to
fit it.

### 5.3 Coarser world rings

The world must remain one height source to the horizon. Puttom's reference ring
shape is defined in
[`puttom-ground-rings.mjs`](../packages/course-v2/puttom-ground-rings.mjs):

| LOD | Spacing | Tiles/side | Extent | Height quantum |
|---:|---:|---:|---:|---:|
| 0 | 1 m | 8 | 2,048 m | 0.01 m |
| 1 | 2 m | 8 | 4,096 m | 0.02 m |
| 2 | 4 m | 8 | 8,192 m | 0.04 m |
| 3 | 8 m | 8 | 16,384 m | 0.08 m |
| 4 | 16 m | 4 | 16,384 m | 0.16 m |
| 5 | 32 m | 2 | 16,384 m | 0.16 m |
| 6 | 64 m | 1 | 16,384 m | 0.16 m |

A new ground may require a different finest rectangle or horizon radius, but
it must preserve these topology rules:

1. Every origin is an integer number of finer tile spans from the finer origin.
2. A finer ring is made from complete coarser tiles. A coarser tile may be
   wholly covered or wholly visible, never half covered.
3. The coarsest level is one root tile and supplies the shell.
4. LOD0 is compared with the already approved/published 1 m tiles and then
   reused byte-for-byte.
5. Shared samples coincide; geometric error is measured and stored per tile.
6. Every sample is finite and inside a reviewed, ground-specific plausible
   height band. This catches the zero/nodata padding that GDAL can otherwise
   create when a requested window leaves a source item.

Do not cargo-cult Puttom's 8-wide rings. That shape fixed Puttom's half-covered
coarse-tile holes; derive and test the topology for the new extent.

### 5.4 Surface tiles

Surface tiles use the terrain's 1 m lattice and tile IDs but may cover only the
played ground plus a reviewed margin. Puttom uses a 5 × 6 subset because
decoding surface data for all 64 tiles would exceed the 32 MiB active surface
budget while mostly encoding rough. Do not coarsen the played-surface grid to
save empty bytes.

The compiler rasterizes reviewed vector boundaries on a 0.25 m offline mask
(`boundaryOversample: 4` for a 1 m output) and calculates exact Euclidean signed
distance. The current `class-sdf-v1` representation supplies exact per-class
distance channels. Class identifiers are nearest-filtered and lossless;
continuous fields are linearly filtered. See
[`surface-grid.mjs`](../packages/course-v2/surface-grid.mjs) and
[`surface-sdf-grid.mjs`](../packages/course-v2/surface-sdf-grid.mjs).

Required semantic classes include rough, semi-rough, fairway, fringe, green,
tee, bunker sand, path, forest floor, heath, shore sand, wetland, rock,
asphalt, gravel, dirt and mud. Water is a hydrology layer rather than a turf
paint. Priority/topology must prevent sand-over-green, paths through greens and
ambiguous overlaps.

### 5.5 Objects and stand fields

Every published object record has a stable ID and the fields enforced by
[`object-registry.mjs`](../packages/course-v2/object-registry.mjs): class,
subtype, easting, northing, RH 2000 base height, object height, radius, heading,
source, capture time, accuracy, confidence, review status, truth zone and
placement method. Current classes are `tree`, `boulder`, `building-detail`,
`bush`, `course-furniture`, `drainage`, `fence`, `light` and `sign`.

Dense canopy is not thousands of fake surveyed stems. A `stand-field-u8-v1`
tile stores measured canopy fraction, mean/p95 height, campaign and
measured/excluded flags on a 4 m field. Representative render instances are
derived from the field and are not object-registry claims.

## 6. Tools and repository layout

### 6.1 Reproducible toolchain

Run from the repository root. Install the root JavaScript dependencies and the
offline COPC reader separately:

```powershell
pnpm install
npm install --prefix packages/course-geo/copc-reader
```

Install Pixi 0.78.0 from its official checksummed release, then verify the
pinned native environment:

```powershell
pnpm geo:toolchain:verify
pnpm geo:controls
```

[`packages/course-geo/toolchain/pixi.toml`](../packages/course-geo/toolchain/pixi.toml)
and its lock pin GDAL 3.13.3, PROJ 9.8.1 and PDAL 2.10.2. Always use
`--frozen`. The first verification fetches the exact checksummed
`se_lantmateriet_SWEN17_RH2000.tif`; PROJ network use is then disabled so a
missing datum grid cannot be silently substituted.

Provider credentials are process secrets:

```powershell
$env:LANTMATERIET_USERNAME = '<user>'
$env:LANTMATERIET_PASSWORD = '<password>'
$env:SKOGSSTYRELSEN_USERNAME = '<user>'
$env:SKOGSSTYRELSEN_PASSWORD = '<password>'
```

`LANTMATERIET_BEARER_TOKEN` may replace the Lantmäteriet user/password pair.
This repository may keep those values in its ignored root `.env`; invoke Node
readers with `node --env-file=.env ...` as shown below. Never commit secrets,
authenticated URLs, headers or logs containing them.

### 6.2 What is committed

```text
geo_data/course-v2/
  source-catalog.json
  <ground-id>/
    source-manifest.json
    migration/
      course-model.epsg3006.json
      residual-report.json
    acquisition/
      d2-discovery.json
      laser-campaigns.json
      copc-hierarchy-census.json
      ground-rings.json
    vegetation/
      canopy-evidence.json
      chmv2-window.json
      chmv2-crosscheck.json
      vegetation-evidence.json
    control-points.geojson              # when acquired
    course-boundary.geojson             # reviewed source vector
    surface-overrides.geojson           # reviewed source vector
    object-overrides.geojson            # reviewed source vector
    survey/<survey-id>/metadata.yml      # small metadata; raw assets by policy

apps/golf/public/
  courses/v2-index.json
  courses/<slug>/course-v2-<sha>.json
  courses/<slug>/routing/<sha>.bvch
  grounds/<ground-id>/ground-v2-<sha>.json
  grounds/<ground-id>/{terrain,surface,objects,stands}/<sha>.bvch
```

Large COG, COPC, raw Float32 rasters and licensed imagery remain under the
ignored `packages/course-geo/toolchain/.cache/acquisition/` tree or another
explicit external working directory. Commit compact evidence, approved vectors
and checksums—not provider source bulk.

## 7. End-to-end workflow

Each stage has an output and a gate. Do not continue by changing an expected
hash or count until the upstream difference is understood and reviewed.

### Stage 0 — decide ground/course identity and generalize the code path

1. Choose a lowercase kebab-case `groundId` for the physical property and one
   or more course `slug`s.
2. Confirm whether a new routing shares an existing ground. Shared grounds get
   another course manifest, not another terrain copy.
3. Inventory the legacy model, scorecard, imagery, survey material and every
   intended authoritative source.
4. Add `geo_data/course-v2/<ground-id>/source-manifest.json`, initially with
   explicit blockers and `null` values rather than invented metadata. Copy the
   shape of a nearby manifest, not its coordinates, checksums or approvals.
5. If the ground is to use the current acquisition commands, add it to the
   supported-ground registry in
   [`acquisition/pilots.mjs`](../packages/course-geo/acquisition/pilots.mjs).
6. Generalize the Puttom-only seams listed in section 9 before attempting to
   publish the new ground. The second course must produce a per-course config,
   not a renamed `PUTTOM_PREVIEW_CONFIG` copy scattered through the app.

Gate:

```powershell
pnpm check:geo-sources
```

### Stage 1 — freeze the existing course

Before changing geography, capture the version being replaced:

- GPK1 bytes/hash and current course manifest;
- hole count, par, stroke index, tee rows and default tee;
- terrain heights and cross-sections per hole;
- water levels and rings;
- surface and object counts;
- legacy tree population and reasons;
- 12 standard visual views plus course-specific signature views;
- boot, draw, triangle, memory and frame-time measurements on named hardware.

Build and serve the app in separate terminals:

```powershell
pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8620
```

Then capture the standard images and, where applicable, the vegetation state:

```powershell
node tools/goldens.mjs http://127.0.0.1:8620 --course <slug> --out-dir tools/goldens
node tools/vegetation-baseline.mjs http://127.0.0.1:8620 --course <slug> --label phase0 --shots
```

Goldens are approval candidates. A human must inspect and approve them before
they become a regression baseline.

### Stage 2 — migrate legacy vectors without promoting them

The migration tool deterministically finds known coordinate-bearing fields,
inverts the legacy local frame to WGS84 and projects them to `EPSG:3006`. Any
new unclassified numeric pair fails closed.

```powershell
pnpm geo:migrate
pnpm check:geo-migration
```

Outputs go under `geo_data/course-v2/<ground-id>/migration/`. They remain
`migration-only-pending-independent-control`; legacy scalar heights retain an
unknown datum. The best-fit residual report is a diagnostic for scale/rotation
mistakes, not permission to rubber-sheet authoritative data.

### Stage 3 — establish independent control and approve the frame

This is the point at which a candidate migration frame becomes a ground frame.

1. Obtain at least 20 independent checkpoints distributed across tees,
   fairways, greens, hazards, roads/facilities and the ground perimeter.
2. Record method, equipment, surveyor, date, control network, CRS and stated
   uncertainty. Transform ellipsoidal heights with the pinned geoid grid.
3. Compare horizontal residuals, RH 2000 residuals, rotation and scale both
   course-wide and per hole. A course-wide median may hide one bad hole.
4. Select an origin near the ground centre on the aligned sample lattice and a
   stable RH 2000 origin height. Do not choose it to make old data look close.
5. Update the source manifest's canonical frame status and control artifacts
   only after named human approval.
6. Recompute and pin the frame fingerprint. All terrain, surfaces and objects
   must declare that same fingerprint.
7. Separately measure any legacy vertical bridge on mown, non-water ground.
   This keeps GPK1 aligned during migration but does not alter RH 2000 truth.

Release gate: tier-B terrain vertical RMSE ≤ 0.15 m or the layer is downgraded;
tier-A patches meet their survey specification. Puttom has not yet completed
this stage, which is why its frame remains provisional.

### Stage 4 — define AOI, truth zones and aligned windows

1. Build the required course bounds from all played geometry, facilities and a
   reviewed zone-A margin of 80–100 m.
2. Include the complete physical property for zone B and define the horizon
   requirement for zone C.
3. Densify WGS84 bbox edges before projecting them; projecting only two corners
   is not a safe projected extent.
4. Feed required bounds and the source lattice anchor to
   `alignTerrainGridExtent()` with 1 m spacing and 256 segments.
5. Review the resulting sample-centre origin, tile counts and pixel-edge
   `projwin`. Store expectations as reviewed configuration.
6. Define the surface window independently: all played polygons plus at least a
   32 m review margin, snapped to complete LOD0 tiles.
7. Define ring levels so partial coarse coverage cannot occur.
8. Define plausible RH 2000 bands from local evidence; never reuse Puttom's
   `-5..400` horizon or `10..200` course gate blindly.

### Stage 5 — discover and acquire authoritative source windows

Public discovery is separate from credentialed reads:

```powershell
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen discover-pilots -- --ground <ground-id>
node packages/course-geo/acquisition/check-discovery.mjs
node packages/course-geo/acquisition/access-preflight.mjs --ground <ground-id>
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen acquire-pilot -- --ground <ground-id> --write-evidence
```

The Pixi discovery task includes `--write`. It records exact DTM, orthophoto
and laser item selection, coverage, campaign dates, CRS, size and public
metadata checksums. Acquisition uses range reads and bounded windows; successful
access proves entitlement, not accuracy or release readiness.

For every physical ground, also plan and run per-hole 256 m control windows:

```powershell
pnpm geo:plan-hole-controls
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen run-hole-controls -- --ground <ground-id> --providers both --output <outside-repo>/hole-source-evidence.json
```

A missing provider window selects a documented DTM/orthophoto/manual-review
path. It does not lower a density or coverage threshold until the data passes.

Before every laser-derived rebuild and release, re-pin or check campaign drift:

```powershell
node packages/course-geo/acquisition/record-laser-campaigns.mjs --ground <ground-id> --check
```

If it reports a new/removed/changed campaign, review it and deliberately run
`--write`. A re-flight can mean new trees, felled stands and different seams;
it is a data revision, not a routine cache refresh.

### Stage 6 — compile the 1 m terrain and the world rings

#### 6.1 Course-level 1 m terrain

Create a ground config containing derived/reviewed values equivalent to
[`puttom-ground-graph.mjs`](../packages/course-v2/puttom-ground-graph.mjs):

- ground and course IDs;
- selected source item(s) and precedence;
- required bounds and aligned lattice;
- 1 m spacing and 256 tile segments;
- hole buffer;
- ground-specific finite/nodata/plausibility gates;
- expected pyramid shape, derived from a reviewed compile;
- regression identity gate against the approved previous generation.

Use GDAL to cut a COG on the exact pixel-edge window, inspect it and emit a
row-major XYZ stream. The current Puttom CI implementation is the copyable
command sequence in
[`course-geo-access.yml`](../.github/workflows/course-geo-access.yml), but the
coordinates and item are course data and must come from the new config.

The compiler must reject:

- the wrong STAC item or campaign precedence;
- a raster without compound SWEREF 99/RH 2000 metadata;
- the wrong dimensions, geotransform, sample order or source lattice;
- a missing declared no-data value;
- any non-finite sample or value outside the reviewed height band;
- broken shared edges, unexpected tile counts or changed quantization;
- a previous approved preview/graph difference beyond its explicit revision
  policy.

The generic compile primitives are
[`terrain-compiler-node.mjs`](../packages/course-v2/terrain-compiler-node.mjs),
[`terrain-pyramid.mjs`](../packages/course-v2/terrain-pyramid.mjs) and
[`emit-ground-graph-node.mjs`](../packages/course-v2/emit-ground-graph-node.mjs).
The current command-line driver is Puttom-specific and must be parameterized or
paired with a reviewed driver for the new ground.

#### 6.2 Nested rings and shell

After the finest ground is published and visually checked, acquire and publish
the surrounding levels:

```powershell
node --env-file=.env packages/course-geo/acquisition/build-ground-rings.mjs --ground <ground-id>
node packages/course-v2/publish-ground-rings.mjs --ground <ground-id> --slug <slug>
```

Both commands currently register only Puttom; add a per-ground ring spec before
using them. LOD0 must compare with and reuse every published 1 m terrain tile.
The evidence file records exact DTM items, ETags, sizes, overview behavior,
bytes read, raster hashes and sample statistics. Capture the edge of every ring
and the horizon; an internally valid hierarchy can still reveal holes if the
runtime selection contract is wrong.

### Stage 7 — build routing and authoritative surfaces

#### 7.1 Routing and tees

Verify hole order, par, stroke index, tee names/colours, measured tee points,
green centres/pins and centre lines against current club material. Store routing
in canonical coordinates and sample route heights from the exact ground
generation. Tee pads are polygons; a slid centre-line start is not an adequate
tee location.

Every centre-line vertex and tee/green probe must lie on the intended terrain
frontier. Compare the new terrain with the legacy field per hole. Puttom found
a 16.61 m legacy error on hole 7 that a course-wide median would have hidden.

#### 7.2 Authoritative surface intake

Request the fields listed in
[`puttom-authoritative-surface-intake.md`](puttom-authoritative-surface-intake.md),
but use the target ground's ID and frame. Normalize the approved data to
[`authoritative-surface-source-v1.schema.json`](../packages/course-v2/schemas/authoritative-surface-source-v1.schema.json):

- source ID and SHA-256;
- ground ID and canonical frame fingerprint;
- `replaceMigration: true`;
- approved reviewer/date/notes;
- one stable feature ID and owner ID per MultiPolygon;
- class, hole number, accuracy tier/error and approval status;
- closed `[easting,northing]` rings within the terrain frontier.

Run a fail-closed preflight before compiling. Today the CLI wrapper is
Puttom-specific:

```powershell
pnpm course-v2:puttom-surface-preflight -- --source <reviewed-source.json> --require-ready
```

The evaluator and compiler library are generic
([`authoritative-surface-preflight.mjs`](../packages/course-v2/authoritative-surface-preflight.mjs)
and
[`authoritative-surface-compiler-node.mjs`](../packages/course-v2/authoritative-surface-compiler-node.mjs)),
but a generic CLI and graph publisher do not yet exist. Add them before the
second course. Production surfaces attach atomically to `tiles[].layers.surface`;
they do not coexist with the migration preview over the same ground.

Compiler/review requirements:

1. Repair or reject self-intersections, open rings, wrong winding, duplicates
   and ambiguous priority before rasterization.
2. Preserve stable feature ownership across tiles.
3. Rasterize boundaries at 0.25 m, derive exact Euclidean distances, and emit
   the 1 m class/SDF payload.
4. Leave moisture, wear, exposure, vegetation density and mow fields explicitly
   unmeasured/zero until evidence exists. Do not add noise and label it data.
5. Probe the centre and boundary transects of every green, fringe, tee,
   fairway, bunker, road/path and relevant non-golf class.
6. Check tile seams and named grazing-angle views.
7. Use the same semantics/material graph in both render backends.

`compile-puttom-surface-preview.mjs --replace` exists only to regenerate
Puttom's migration comparison from the exact live GPK1 pack. It is not the
workflow for an authoritative new course.

### Stage 8 — water, roads, buildings and stable objects

#### 8.1 Hydrology

1. Ingest verified water break geometry and supporting Topografi 10/club
   hydrology.
2. Split distinct bodies, preserve islands and assign an approved RH 2000 level
   or a measured profile for flowing water.
3. Compare rings with ortho and terrain. Report invalid rings, shore conflicts,
   culverts and streams explicitly.
4. Remember that a laser DTM over water is normally the water surface. Do not
   claim lake-bed depth from it.
5. The current runtime carves a rendering bed from shore distance while leaving
   published DTM bytes untouched. That derived bed is a visual treatment and
   must feed both CPU and GPU samplers consistently.
6. Probe every green and tee pad against every water body. No played surface
   may be submerged.

Puttom's boot-time bed rule lowers only near-level water samples by
`min(3.5, 0.15 + 0.12 × shoreDistance)` metres. Reuse the algorithm only after
reviewing it against the new shore geometry; do not interpret those depths as
surveyed bathymetry.

#### 8.2 Roads and continuous built features

Use club/as-built data first, Topografi 10 second and OSM as corroboration.
Convert road/path centrelines plus measured or reviewed widths into polygons;
use breaklines/terrain patches where a road grade, curb, retaining wall or
bridge changes geometry. Asphalt, gravel, dirt and path are surface classes.
Bridge decks, curbs, walls and rails are explicit geometry. Painted markings
may remain a small rendering layer tied to the surveyed road geometry.

Current Puttom road/path geometry still originates largely in the migrated
course model and semantic exclusion adapter. There is no general authoritative
road/building importer yet, so this is a required compiler task for a new
course claiming full parity.

#### 8.3 Object inventory

Build one registry for stable natural and built objects. Sources include survey,
club inventory, Topografi 10, reviewed ortho digitization and LiDAR. Every
record must validate, be inside its owning tile and carry the real placement
method. Use terrain/breaklines for continuous rock, walls and ridges; the
object registry is for individual boulders/details.

Before publishing:

- generate a diff against the previous registry;
- review adds, moves, resizes and missing objects;
- check exclusions against surfaces, water, buildings, roads, paths and power
  corridors;
- require survey or explicit review for play-affecting/signature objects;
- sample the same terrain generation used by the renderer;
- verify the required attribution is reachable from the ground manifest.

### Stage 9 — derive and publish vegetation

The implemented Puttom sequence is reusable once the ground is registered.

1. **Pin campaigns.** Run `record-laser-campaigns.mjs --check`; deliberately
   `--write` after reviewing drift.
2. **Census COPC hierarchy.** This reads headers and hierarchy pages, not point
   bytes:

   ```powershell
   node --env-file=.env packages/course-geo/acquisition/run-copc-census.mjs --ground <ground-id> --write --full
   ```

3. **Build 1 m canopy rasters.** The custom reader is used because the Puttom
   COPC files subdivide hierarchy keys over their header extent rather than the
   nominal cube, which caused PDAL spatial pruning to read the wrong nodes:

   ```powershell
   node --env-file=.env packages/course-geo/copc-reader/build-canopy.mjs --ground <ground-id> --out <outside-repo>/vegetation
   ```

   It derives class 2/9 ground, height above ground, canopy height, return
   counts, voids and cloud-ground-minus-published-DTM statistics per campaign.

4. **Compile candidates, objects and stands.** Supply every active campaign
   raster and the previous registry so harmless rebuilds retain IDs:

   ```text
   node packages/course-v2/vegetation/compile-vegetation.mjs
     --ground <ground-id>
     --out <outside-repo>/vegetation/compile
     --raster <campaign-id>=<chm.f32>:<chm.json> [...]
     --approvals <approved-candidate-keys.json>
      --previous <previous-registry.json>
   ```

   On Windows, pass `--raster` paths relative to the repository for now. The
   current `<id>=<raster>:<sidecar>` parser treats the colon in an absolute
   drive-letter path such as `C:\...` as its separator.

   The compiler detects height-adaptive maxima, grows crown regions, separates
   resolvable individuals from stands, applies semantic exclusions, samples
   terrain bases, preserves IDs and emits candidate/evidence/diff plus BVCH
   object and stand layers. LiDAR-derived crown centres use at least 1.5 m
   horizontal and vertical uncertainty floors unless stronger evidence changes
   the placement method.

5. **Render review overlays.** Produce a whole-ground overview and one 1 m crop
   per hole:

   ```powershell
   node packages/course-v2/vegetation/render-review.mjs --ground <ground-id> --rasters <outside-repo>/vegetation --candidates <outside-repo>/vegetation/compile/candidates.json
   ```

   Review canopy, candidate centres/radii, stands, exclusions, voids, campaign
   seams, scan dates and signature sightlines. A nice render is not proof that
   the crown belongs there.

6. **Cross-check with independent optical canopy.** Build the CHMv2 window on
   the same 1 m grid, then compare per campaign, tile, seam and published
   individual:

   ```powershell
   node packages/course-geo/chmv2/build-chmv2-window.mjs --ground <ground-id> --out <outside-repo>/vegetation
   node packages/course-v2/vegetation/run-chmv2-crosscheck.mjs --ground <ground-id> --compile <outside-repo>/vegetation/compile
   ```

7. **Publish only approved output.** The publisher refuses the
   `--approve-all-individuals` harness result:

   ```powershell
   node packages/course-v2/vegetation/publish-vegetation.mjs --ground <ground-id> --slug <slug> --compile <outside-repo>/vegetation/compile
   ```

8. **Measure the ownership switch.** There must be zero legacy trees inside the
   published object/stand coverage and no duplicate population:

   ```powershell
   node tools/vegetation-baseline.mjs http://127.0.0.1:8620 --course <slug> --label v2 --shots
   ```

Prefer a human approvals file for zone A. `--machine-review` is a versioned,
auditable alternative implemented after an explicit Puttom owner decision; it
does not satisfy the original per-object human-review target and must be stated
as such in evidence. `--approve-all-individuals` is only a pipeline harness and
must never publish.

### Stage 10 — wire runtime selection without a Puttom copy

Before a second course can boot v2, replace the single exported
`PUTTOM_PREVIEW_CONFIG` with a registry keyed by course/ground. Split fields by
their real authority:

- **derived:** frame fingerprint, descriptor hashes and bounds from compiler
  output;
- **reviewed:** expected tile counts, surface window, lattice offsets, legacy
  cutout and compile shape;
- **measured:** legacy vertical-datum bridge and validation tolerances;
- **inherited:** slug, label, pack origin and legacy frame constants.

Never hand-edit a derived hash to make a gate green. Bind reviewed values to an
independent artifact; a test that recomputes its expectation from the value it
is testing proves nothing.

Runtime requirements:

1. Resolve fresh `courses/v2-index.json`, course manifest and parent ground.
2. Verify manifest/chunk size, encoded hash, decoded hash, schema, required
   features, owner and bounds.
3. Display the shell, then prioritize active-hole terrain/surface/object tiles.
4. Use one visible-ground sampler for terrain construction, camera, water,
   routing, objects and probes.
5. Keep v2 loading dynamic so a plain GPK1 visit does not download it.
6. `?v2=1` may report and use the declared v1 fallback; `?v2=require` must fail
   the test if any v2 requirement cannot be served.
7. Cancel stale fetch/decode/upload work on hole/course switches and evict
   resources through the common pool.
8. Keep zone-A coordinates, dimensions, collisions and surface IDs identical
   on WebGPU and WebGL2. Scale effects and peripheral LOD before geographic
   truth.

### Stage 11 — publish atomically and retain rollback

Use [`emit-ground-graph-node.mjs`](../packages/course-v2/emit-ground-graph-node.mjs)
for publication. A publication writes immutable chunks first, then a new
ground manifest, course manifest and root reference. Never mutate an existing
hash-named chunk.

Record before/after root, course and ground hashes and the exact previous
course-manifest URL. Verify the new graph through the same decoder the browser
uses. Build and test before pruning anything.

After approval, inspect pruning as a dry run, retain at least the active and
named rollback generations, then apply the exact reviewed set:

```powershell
node packages/course-v2/prune-generations.mjs --slug <slug> --also courses/<slug>/course-v2-<rollback-sha>.json
node packages/course-v2/prune-generations.mjs --slug <slug> --also courses/<slug>/course-v2-<rollback-sha>.json --apply
```

The pruner also protects the retained terrain/surface preview descriptors. Do
not use a filesystem wildcard or manual deletion in place of its reference
closure.

## 8. Validation and release checklist

### 8.1 Cheap gates first

Run fast/schema gates before browser and hardware captures:

```powershell
pnpm check:geo-sources
pnpm check:geo-migration
pnpm test
pnpm check:course-v2
pnpm check:course-v2-renderer
pnpm --filter @banvy/golf build
pnpm check:course-v2-app
```

Then exercise the real app:

```powershell
node tools/check-app.mjs
node tools/check-basepath.mjs
node tools/check-pwa.mjs
node tools/world-capture.mjs http://127.0.0.1:8620 --course <slug>
```

Set `BANVY_GPU=1` for capture tools when real GPU evidence is required. Without
it, Chromium may use SwiftShader; that proves rendering logic but not hardware
performance. Run both default/WebGPU-preferred and forced WebGL2 (`?gl=1`), and
low, balanced and high profiles where supported.

### 8.2 Geodetic and terrain acceptance

- CRS, axis order, unit, origin, vertical datum and fingerprint are explicit.
- At least 20 independent controls cover the ground.
- Tier-B and tier-A residual targets are met or the accuracy tier is downgraded.
- Every source sample is finite; no padded zero plane, spike, NaN, inverted
  triangle or unbounded slope is published.
- Highest-LOD tile/patch seams are below 0.02 m.
- Per-hole centre-line and green cross-sections are reviewed.
- The 1 m terrain level is exactly the approved course generation; coarser
  rings have no crack, plate, cliff or source seam.
- Water is planar at its approved level and no green or tee pad is submerged.

### 8.3 Surface acceptance

- Green, fringe, fairway, tee and bunker centre probes hit the intended class.
- Roads/paths and non-golf classes are probed where they meet play.
- SDF-reconstructed high-resolution boundaries match approved vectors within
  0.25 m.
- No overlap-priority ambiguity, sand-over-green or path-through-green remains.
- Mow direction/coordinates, when measured, are stable across tile seams.
- Bunker lips and green contours are not sculpted twice by legacy shaping.
- Named close, grazing-angle and long views pass on both backends.

### 8.4 Object and vegetation acceptance

- No zone-A large object is tier E or a procedural registry record.
- Every published object is approved and has a source/date/uncertainty.
- No unintended intersection with green, tee, fairway, bunker, water,
  building, road or path survives.
- Signature/play-affecting objects have survey or explicit review.
- Every base matches the visible terrain within tolerance.
- Canopy cover, height distribution and treeline silhouette match the QA
  rasters; seams and source age are visible in evidence.
- Registry diffs are reviewed; missing old objects are not silently treated as
  felled.
- Legacy/object/stand ownership is exclusive inside the v2 coverage.

### 8.5 Runtime, cache and performance acceptance

- Plain GPK1 visit remains unchanged until the default switch is approved.
- `v2=require` reaches a ready graph with no page/shader/decode error and no
  loading tiles after settle.
- Course and hole switch, cancellation, fallback and rollback are tested.
- Base-path hosting resolves every manifest and hash-named chunk.
- A course opened through the installed PWA reopens offline; a never-opened
  course fails with a clear message.
- Visual goldens are approved rather than merely generated.
- Performance is recorded on named browser/device/GPU builds, not inferred
  from SwiftShader.

Initial budgets from the programme plan are: shell visible ≤ 3.0 s p75 on the
chosen mid-tier Android/4G profile, active hole refined ≤ 5.0 s p75, cached
course interactive ≤ 1.5 s p75, no terrain/object main-thread task > 50 ms,
desktop WebGPU ≤ 16.7 ms p95, mobile WebGL2 ≤ 22 ms p95 and never sustained
below 30 fps, active mobile decoded terrain+surface+objects ≤ 64 MiB, terrain
draw calls ≤ 8. Record network bytes, decoded heap, GPU bytes, uploads, tiles,
objects, draws and shader compilation per hole.

### 8.6 Definition of done for one ground

A ground may be called “PUTTOM v2 standard” only when all boxes are true:

- [ ] Ground/course identity and sharing model are approved.
- [ ] Source manifest passes with exact source, licence and checksum evidence.
- [ ] Canonical origin is approved from independent controls.
- [ ] 1 m terrain AOI and aligned rings pass geodetic, coverage, seam and
      per-hole visual gates.
- [ ] Routing, tees and card are current and source-backed.
- [ ] Authoritative surface polygons replace migration surfaces atomically.
- [ ] Water, roads, paths, buildings and stable objects have explicit ownership
      and source lineage.
- [ ] Zone-A individual objects are reviewed; measured stand coverage is
      separated from representative rendering.
- [ ] Root, course, ground and all chunks pass content/schema verification.
- [ ] WebGPU, WebGL2, PWA, base-path, switching and fallback pass.
- [ ] Human visual review covers every hole and course-specific signature views.
- [ ] Named hardware meets the performance budget or has an approved,
      documented profile change that preserves active-hole truth.
- [ ] Previous generation is retained and rollback is tested.
- [ ] The v2 default switch is a separate, explicit release decision.

## 9. Generalization status after course two

Ribbingsfors is now the second real ground using the graph, terrain and
vegetation contracts. It proved the reusable fixed-frontier path, but several
production entry points remain ground-specific. This table distinguishes what
the second implementation actually generalized from the work still required.

| Concern | Reused or implemented | Remaining work |
|---|---|---|
| Frame bridge | Ribbingsfors has a reviewed static config and exact EPSG:3006/RH 2000 identity bridge in [`v2-ribbingsfors-config.mjs`](../apps/golf/src/engine/v2-ribbingsfors-config.mjs). | Consolidate all ground configs, including Puttom's fitted legacy bridge, behind one registry/schema. |
| Chunk, manifest, terrain and runtime primitives | `packages/course-v2/` schemas, codecs, emitter, sampler, manager and renderer now pass against two real graph publications. | Preserve the common contracts and add every new ground as an independent fixture, never by weakening counts or hashes. |
| Source manifests and migration | Ribbingsfors is registered, migrated and included in the seven-ground/ten-course validation report. | Extend geometry-key review whenever another legacy schema differs and replace provisional migrations with approved source geometry. |
| Discovery/acquisition | The acquisition ground list, CLIs, tests and CI matrix now include Ribbingsfors; the historical pilot list remains deliberately separate. | Move remaining workflow-specific ground literals into one validated production registry. |
| Terrain graph | Generic compiler/emitter primitives | Replace `puttom-ground-graph.mjs` and `compile-puttom-ground-graph.mjs` with config-driven ground commands. |
| World rings | Generic ring compiler; Ribbingsfors publishes four LODs over its 2,048 m extent. | `build-ground-rings.mjs` and `publish-ground-rings.mjs` still map only Puttom's horizon hierarchy. Add a validated ground ring registry and a Ribbingsfors same-source horizon before default enablement. |
| Surfaces | Generic source validator/compiler library; the live adapter has an explicit, fail-closed zero-v2-surface policy bound to the verified GPK atlas. | Acquire authoritative Ribbingsfors boundaries, add the generic preflight/publisher and replace the compatibility atlas with reviewed v2 surface tiles. Do not base new authority on `compile-puttom-surface-preview.mjs`. |
| Vegetation | Canopy/compiler/publisher selection now resolves the active ground through the published root; Ribbingsfors' object and stand layers render live. | Replace provisional line-distance truth zones with approved geometry and complete zone-A human review. |
| Roads/buildings/non-tree objects | Strict registry contract and legacy rendering | Build an authoritative vector/object normalization and publication driver. |
| Runtime selection | The generic graph resolver plus fixed-frontier loader can activate a reviewed non-Puttom graph; required mode verifies 64 Ribbingsfors chunks and fails closed. | Replace the remaining direct `PUTTOM_PREVIEW_CONFIG` paths in selection/build checks with the consolidated ground registry. |
| Capture and CI | Shared browser tools plus [`check-ribbingsfors-v2.mjs`](../tools/check-ribbingsfors-v2.mjs) test both flagless and required paths. | Parameterize the ground-specific browser proof and finish generalizing Puttom-named capture/build tooling. |

The abstraction now has two real configurations behind it. Continue replacing
ground literals only when the shared contract is exercised by both; moving a
Puttom literal into a generically named module is not generalization.

## 10. Failure patterns worth keeping visible

- **A constant can be stale while its test is green.** Puttom's retired preview
  offset was tested against a literal derived from itself. Compare reviewed
  values with an independent committed artifact.
- **A valid GDAL window can contain fake ground.** `-projwin` may pad outside a
  source item while preserving the requested shape and transform. Require
  declared nodata, every sample finite and a reviewed height band.
- **A course average hides bad holes.** Puttom's hole 7 legacy terrain was
  16.61 m wrong while 17 holes agreed. Report each hole.
- **Terrain and surface extents serve different costs.** Keep 1 m boundary
  quality and omit irrelevant surface tiles instead of coarsening the surface.
- **DTM water is not a lake bed.** Coplanar water flickers and a shallow fake
  bed looks like silt. Keep render-depth treatment explicit and non-surveyed.
- **A ring can enclose banks and islands.** Carve only samples close to the
  measured water level and preserve polygon holes.
- **COPC hierarchy behavior must be measured.** Puttom's item subdivision
  differed from the nominal cube; node counts and bounded reads are gates.
- **Campaign seams are data.** Pin both sides, dates and precedence; compare the
  seam rather than smoothing unexplained differences away.
- **Exclusion adapters can flatten nested geometry incorrectly.** A Puttom
  driving-range ring-list bug planted six trees. Overlay review caught what
  schema tests did not.
- **Host behavior is part of integrity.** A local server omitted headers and
  GitHub Pages compressed `.bvch`, exposing length/hash assumptions. Test the
  built app under its real base path and host semantics.
- **Phone quality state persists.** A slow boot can store low-quality mode and
  make later captures look inexplicably blurry. Record quality, DPR and backend.
- **SwiftShader is not hardware evidence.** Record the actual adapter and GPU
  timing support.
- **A new GPK1 changes bindings.** Recompile migration-only surface comparison,
  rebind fallback hashes, republish the graph and rerun build/base-path gates.
- **Windows line endings affect recorded hashes.** Hash normalized LF where the
  manifest contract says LF; compare committed blobs before assuming source
  drift.

### Coastal grounds — what Norrfällsviken added

The first seaside ground broke four assumptions that every inland course had
quietly satisfied. Read these before starting a course that touches the sea.

- **The height model carries near-shore water as a flattened surface, not as
  nodata and never as bathymetry.** A window that is one third sea can still
  pass every-sample-finite, and it costs almost nothing: a 257 × 257 tile of one
  repeated value deflates to 142 bytes against 45 kB for a varied one. Do not
  budget sea tiles as if they were land.
- **But the national model stops tiling the OPEN sea, in two ways, and both
  need an explicit decision.** An item can return nodata over its outer water,
  and a 10 km square that is entirely sea may not be published at all — it
  answers 404 while its neighbours answer 200, which is a statement about the
  sea and not about the account. Relaxing the coverage gate is the wrong fix,
  because that gate is what catches a wrong item or a half-covered ring. The
  answer is an opt-in per-ground `seaFill`: a connected nodata component is
  filled only if its boundary is water by MEDIAN, by fraction and at the
  extreme, and it is filled with the median of its OWN boundary rather than a
  constant. **Set those thresholds from the boundaries the data actually has,
  not by raising a number until the build passes** — the first rule tried here
  ("no boundary sample above 0.25 m") failed correctly, because a factor-4
  overview averages shore into water and real boundaries reach 0.80 m. The
  median is the discriminator that cannot be dragged by a few mixed pixels, and
  a missing LAND square fails all three tests at once.
- **A STAC `capturedAt` is not a campaign.** Two items advertising the same
  date and range can have entirely different flight vintages inside them; only
  the per-item `ursprung.json` says which ground came from when. Read it, and
  measure the seam in the retained raster rather than assuming it is or is not
  visible — state where it falls relative to the played ground.
- **Zone-A minimality is about what the window must CONTAIN, not about the golf
  course alone.** A compact course on a cape can need four times the level-zero
  tiles because the chapel, the harbour and the shoreline are the things it is
  looked at across. Say so in the contract and check it both ways: the chosen
  size must hold that set, and half of it must genuinely fail. Copying another
  ground's minimality rule — "the smallest square holding every PLAYED point" —
  would have rejected a correct window here.

Also generic, and not coastal at all: **the frontier is not the window.**
`expectedTileCount` is the level-zero set the app installs eagerly and the
loader caps it at 8 MiB, so a large finest window must declare a reviewed
sub-rectangle and let the rest of level zero stream in behind it at the same
resolution. Two grounds have now independently landed on 8 × 12 tiles; that is
what the budget buys in 256 m tiles, not a number to copy.

## 11. The short checklist for starting the next course

1. Add/validate the ground source manifest and choose ground/course identity.
2. Freeze the legacy model, screenshots, tree/object state and performance.
3. Migrate vectors to `EPSG:3006`, leaving them explicitly provisional.
4. Obtain club/survey surface and control data, licences and at least 20
   independent checkpoints.
5. Approve one `EPSG:5845` frame and derive all windows from it.
6. Discover and acquire bounded Lantmäteriet DTM, water, ortho, Topografi 10
   and laser sources; pin checksums, dates and campaign seams.
7. Compile/verify 1 m terrain, then aligned same-source rings and shell.
8. Normalize and compile routing, played surfaces, water, roads and objects.
9. Derive LiDAR individuals/stands, review zone A, cross-check canopy and
   publish stable registries.
10. Wire the ground through the per-course registry, publish content-addressed
    manifests, run every gate and inspect every hole on both backends.
11. Retain/test rollback; switch the default only by an explicit release
    decision.

That sequence is the reusable PUTTOM framework: source truth first, one
canonical metre-based frame, one shared tile lattice, independently reviewable
layers, one visible-ground sampler, content-addressed publication and evidence
at every boundary.

## 12. Worked implementation: Ribbingsfors (2026-09-04)

Ribbingsfors is the first second-course application of this workflow. It is a
useful reproducible implementation, but it is **not release-ready spatial
authority**. The detailed source and rights record is
[`courses/ribbingsfors-source-dossier.md`](courses/ribbingsfors-source-dossier.md);
the machine-readable ledger is
[`source-manifest.json`](../geo_data/course-v2/ribbingsfors/source-manifest.json).

### 12.1 Reproduction commands and retained artifacts

Run from the repository root. Authenticated readers load the existing `.env`;
credentials and authorization headers must never enter an artifact or log.

```powershell
node packages/course-geo/acquisition/discover-pilots.mjs --ground ribbingsfors --write --observed-on 2026-09-04
node packages/course-geo/acquisition/record-laser-campaigns.mjs --ground ribbingsfors --write --observed-on 2026-09-04
node --env-file=.env packages/course-geo/copc-reader/build-canopy.mjs --ground ribbingsfors --out packages/course-geo/toolchain/.cache/vegetation/ribbingsfors --observed-on 2026-09-04
node --env-file=.env ribbingsforsbuild/build-course.mjs
node packages/course-pack/emit-pack.mjs ribbingsforsbuild apps/golf/public/courses/ribbingsfors ribbingsfors
node packages/course-pack/emit-manifest.mjs
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen node packages/course-geo/migrate-legacy.mjs --write --ground ribbingsfors
node packages/course-v2/compile-ribbingsfors-ground-graph.mjs --terrain-f32 ribbingsforsbuild/cache/terrain-fine.bin --out apps/golf/public
node packages/course-v2/vegetation/compile-vegetation.mjs --ground ribbingsfors --out packages/course-geo/toolchain/.cache/vegetation/ribbingsfors-compile --raster 23b028-653_44=packages/course-geo/toolchain/.cache/vegetation/ribbingsfors/chm-23b028-653-44.f32:packages/course-geo/toolchain/.cache/vegetation/ribbingsfors/chm-23b028-653-44.json --machine-review --observed-on 2026-09-04
node packages/course-v2/vegetation/publish-vegetation.mjs --ground ribbingsfors --slug ribbingsfors --compile packages/course-geo/toolchain/.cache/vegetation/ribbingsfors-compile --public apps/golf/public
```

The exact checked-in evidence is
[`d2-discovery.json`](../geo_data/course-v2/ribbingsfors/acquisition/d2-discovery.json),
[`laser-campaigns.json`](../geo_data/course-v2/ribbingsfors/acquisition/laser-campaigns.json),
[`canopy-evidence.json`](../geo_data/course-v2/ribbingsfors/vegetation/canopy-evidence.json),
the normalized
[`EPSG:3006 migration`](../geo_data/course-v2/ribbingsfors/migration/course-model.epsg3006.json)
and its
[`residual report`](../geo_data/course-v2/ribbingsfors/migration/residual-report.json).
The generated GPK1 inputs live under
[`ribbingsforsbuild`](../ribbingsforsbuild), and the current content-addressed
graph is resolved through
[`courses/v2-index.json`](../apps/golf/public/courses/v2-index.json). Large COG,
Float32 and COPC-derived working files remain in ignored cache directories;
their identities belong in the source manifest and evidence, not in Git.

### 12.2 Spatial and vegetation result

| Item | Implemented result |
|---|---|
| Frame | `EPSG:5845`; origin E 448,975.5, N 6,536,024.5, H 69.14 m; fingerprint `5d616311e246c109899b52223af5ed4a68f372f9b923787d6c0354b33b2c968f`. The origin still awaits independent control approval. |
| Finest lattice | 2,048 × 2,048 m, sample-centre bounds E 447,951.5–449,999.5 / N 6,535,000.5–6,537,048.5; 8 × 8 tiles, 256 m per tile, 257 × 257 samples, 1 m spacing. |
| Terrain graph | 85 tiles: 64 at 1 m, 16 at 2 m, four at 4 m and one at 8 m. Height range in the retained DTM window is 69.1475–103.3791 m RH 2000. |
| Hole 9 yellow tee | The route/card interpolation that crossed asphalt was replaced by an explicit provisional DTM-bench control at E 449,556.6 / N 6,536,126.3. Its complete 6 x 4 m pad clears the visible road edge by about 9.4 m; the compiler now rejects any tee/road overlap. |
| Laser measurement | Campaign `23b028-653_44`, captured 2023-03-16 through 2023-04-16; 14,271,395 point observations including halos, 4,194,304 cells, 22.5% void cells and 41.3% canopy among measured cells in the acquisition evidence. |
| Published vegetation | 2,293 machine-approved derived individuals in 60 object tiles plus 64 measured 4 m stand-field tiles. Truth zones remain provisional line-distance zones and there has been no per-object human review. |

The terrain came from Lantmäteriet Markhöjdmodell item `653_44`: full COG
SHA-256 `f94d6bae09f5730281db1fa081bf1da689e7b48fc335f41c3e68b2ab4efeb283`;
the retained 2,049 × 2,049 window is
`c992f541f854aa745742ef3429e15f931cb6459145945c1a1f68897273af44ad`.
The associated full water break-geometry asset is
`934ff9014973043d72f2e6f582ea6f4d6c8d8287831c8f7a1da284d04bee99ce`.
The Laserdata Skog COPC is
`3db848c0ca4048329e922056b4d16f1460eaf26030158e4c5c704ffd2ccb6fe7`;
its derived 1 m CHM is
`b3900122ff465817d78891b72f206738ce25440804f26e37aec4db4a682fdd93`.
The 12 clipped water rings inform the compatibility model but do not supply
bathymetry or authoritative golf-surface boundaries.

### 12.3 Runtime state and release gates

The graph is published and Ribbingsfors now has a reviewed, ground-specific
fixed-frontier runtime contract. With `?bana=ribbingsfors&v2=1` or
`?bana=ribbingsfors&v2=require`, the app fetches and verifies all 64 finest
terrain chunks, renders the 1 m frontier as one batched draw, applies the exact
EPSG:3006/RH 2000 identity bridge and cuts the corresponding GPK1 CORE only
after GPU preflight succeeds. Required mode fails closed on any byte, hash,
header, frame, footprint, atlas or cutout mismatch; it does not silently serve
the 4 m compatibility heightfield.

The published graph intentionally contains zero v2 surface tiles because no
authoritative playing-surface source has passed intake. This is not treated as
implicit rough. A narrow `legacy-ground-atlas` policy requires the complete
live 1 m GPK atlas to be the material decorator's exact authority before the
terrain transaction can activate. It now receives the same 513 x 513 near and
far procedural ground-tint contract as Puttom's class-SDF material, so rough,
forest, heath, wetland and shore retain the shared v2 appearance rather than
collapsing to flat `C.rough`; this visual parity does not promote the provisional
atlas to authoritative v2 surface data. The v2 vegetation transaction then replaces
legacy planting within its 64 measured coverage tiles. The ordinary flagless
path remains the tested GPK1 compatibility path; default v2 enablement is still
a separate release decision.

The remaining release gates are material:

- The configured Lantmäteriet account returned HTTP 403 for the selected 2024
  K2 orthophoto. Greens, tees, fairways, bunkers, paths and route controls are
  therefore guide-constrained/provisional rather than accepted contemporary
  ortho or survey geometry; the graph currently has no authoritative surface
  layer.
- White hole rows are Caddee-equivalent. Yellow and red rows come from a public
  GolfTraxx card interpreted as metres despite its yards label; their sums
  match the club's official totals, but the rows and stroke indexes are not
  official. They must be visibly marked provisional and replaced atomically
  from a dated club/GIT card.
- GolfTraxx coordinate reuse rights are unverified. Official banguide artwork,
  video and club photographs also have no documented reuse grant, so none of
  those pixels may be bundled merely because they were public to view.
- Club/survey control, authoritative playing-surface polygons, zone-A object
  review and a surveyed clubhouse footprint are still missing. The current
  clubhouse rectangle is a provisional landmark at the public POI.
- No official photograph has been copied into the course pack. The manifest
  records three original application-rendered heroes (holes 9, 2 and 5), made
  with the reproducible poster recipes in `tools/make-posters.mjs`; they contain
  no official-site, Caddee or GolfTraxx pixels.

Ribbingsfors may remain selectable as a clearly marked prototype while these
gates are open. Default/public v2 enablement is a separate decision after the
club card, rights, orthophoto or survey geometry, visible marking and human
visual review are complete.

## 13. Worked implementation: Upsala (2026-09-04)

Upsala Golfklubb at Håmö gård is the ground that separates a **datum step**
from a **bad height field**, and the first here whose window crosses a source
seam. Its full source and rights record is
[`courses/upsala-source-dossier.md`](courses/upsala-source-dossier.md); the
ledger is
[`source-manifest.json`](../geo_data/course-v2/upsala/source-manifest.json).

### 13.1 What is new here, and is generic

- **A window may span several source items.** Håmö straddles easting 640000, so
  the reviewed 2,048 m lattice is mosaicked from Markhöjdmodell `663_63` and
  `663_64`. `build-terrain-window.mjs` already handled a list; this is the first
  ground to exercise it, and it asserts that the items the window touches are
  exactly the reviewed ones. Both are read at factor 1, so the seam is one of
  provenance and not of geometry — say that in the config rather than leaving a
  reader to wonder.
- **A pack can be RE-GROUNDED instead of vertically bridged.**
  `tools/measure-vertical-datum.mjs` reports a median AND a median absolute
  deviation, and the MAD is the decision. Veckefjärden's 20.9924 m carries a
  0.2392 m MAD: that is a datum, and one number bridges it. Upsala's 6.7514 m
  carried a **1.9188 m MAD over a 0–15 m range**: that is a wrong SHAPE as well
  as a wrong datum, and one number cannot bridge it — applying the median still
  left this course's ponds between 2.8 m below their bed and 5.3 m above their
  surface. The fix is to cut the compatibility heightfields from the same laser
  DTM as the published tiles, **sampled through the derived bridge the runtime
  uses**, so the vertical term becomes exactly zero and re-running the
  measurement proves it: 0.0001 m median, 0.0239 m MAD, best registration shift
  (0, 0). Prefer this wherever the MAD is large; it costs a pack rebuild and no
  horizontal change at all.
- **A vertical-only rebuild is verifiable as such.** Diff the rebuilt model
  against the previous one field by field and expect to name every changed
  leaf. Upsala's came to exactly 79: 24 water levels, 54 hole elevations and
  the water floor. Nothing horizontal moved, so every gate that measures
  horizontal geometry still means what it meant.
- **Water levels measured from INSIDE the ring are simultaneously a level and a
  registration check.** A laser DTM flattens water, so a well-registered ring
  encloses samples with a few centimetres of spread. Upsala's 21 measurable
  rings spread 0.01–0.45 m. `build-heightfields.mjs` now fails above 1.5 m,
  because a ring that is not flat is misregistered and the level under it is a
  guess.
- **A machine without PROJ can still migrate a model, if it proves itself
  first.** `packages/course-geo/migrate-without-proj.mjs` re-projects a
  committed cs2cs migration's own source model with the repository's Krüger
  series and refuses to write anything unless it reproduces it within 5 mm. On
  Upsala it agreed to **1.343 mm over all 12,925 coordinates**. Use it only as
  a substitute, and regenerate through `migrate-legacy.mjs` when the pinned
  toolchain is available.
- **Measure the legacy CORE cutout by making the frontier serve.** The contract
  is only asserted on the frontier-only path, and a ground with a published ring
  graph never takes it — but the adapter is CONSTRUCTED before that choice, so a
  `null` contract is a boot error. Point the config's
  `expectedBoundsEpsg5845` at the pre-ring generation, put a deliberately wrong
  contract in, and boot: the assertion prints what it actually got. Restore
  both afterwards.

### 13.2 Result

| Item | Implemented result |
|---|---|
| Frame | `EPSG:5845`; origin E 640,143.5, N 6,636,145.5, H 13.28 m; fingerprint `628d86e3e5bf35bd79500173488c31a31fe101c06d1acad56033d089d2846d86`. The origin still awaits independent control approval. |
| Finest lattice | 2,048 × 2,048 m, sample-centre bounds E 639,119.5–641,167.5 / N 6,635,121.5–6,637,169.5; 8 × 8 tiles, 257 × 257 samples, 1 m. Height range 13.286–54.385 m RH 2000, every sample finite. |
| Margin | 180.3 m west, 181.2 m east, 445.9 m north and south — the tightest of any ground here, because two courses stand side by side across 1,686 m. |
| Ring graph | 7 levels, 277 tiles (64/64/64/64/16/4/1) to a 16,384 m root, 0.82–68.15 m RH 2000. Level zero reproduces the published 1 m tiles over all 4,227,136 samples to within half a quantum. |
| Courses | Two on one ground: `upsala` (18, stroke index verified) and `upsala-mellanbanan` (9, stroke index club-sourced but not gated). |
| Vertical bridge | **0 m, measured.** See 13.1. |
| Runtime | `?bana=upsala&v2=require` and the same for Mellanbanan render the ring graph as the only terrain: 277 tiles, 1 m mesh, one draw call, no legacy CORE/MID/FAR. `tools/check-upsala-v2.mjs` is the browser proof; 20 gates, both courses, both paths. |

### 13.3 Release gates still open

The same four this ground started with, minus the terrain half of one:

- **Playing surfaces are not surveyed.** OSM greens and bunkers, a banguide
  routing read off Esri imagery, and the card's own lengths. The published graph
  carries zero v2 surface tiles rather than presenting that as an intake.
- **Esri imagery rights** remain release-blocking for exactly that reason. The
  licensed 2025 orthophoto over this AOI is discovered and complete but not
  acquired.
- **No independent control**, so the canonical origin stays provisional.
- **No LiDAR vegetation.** Both Laserdata Skog items over this ground are
  discovered and reachable; until they are read, the trees come from the
  Esri-classified cover raster and share the rights blocker.

Default v2 enablement for this ground is a separate decision, as for every
other.

## 14. Worked implementation: Ängsö (2026-09-04)

Ängsö Golfklubb at Stora Bodarna is the ground that separated two things every
earlier course had let coincide: **the metre window a course needs** and **the
metre window a visitor preloads**. Everything else here is the established
path — legacy GPK1 pack kept in its own frame, published 1 m terrain, nested
rings to a 16 km root, a `wgs84-legacy-frame` bridge with a measured vertical
step. It is **not release-ready spatial authority**; §14.4 says why.

### 14.1 Reproduction commands

Run from the repository root. Authenticated readers load the existing `.env`;
credentials and authorization headers must never enter an artifact or log.

```powershell
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen discover-pilots -- --ground angso --observed-on 2026-09-04
node --env-file=.env packages/course-geo/acquisition/build-terrain-window.mjs --ground angso
node tools/measure-vertical-datum.mjs --ground angso --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/angso-terrain-window/terrain-1m.f32
node packages/course-v2/compile-angso-ground-graph.mjs --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/angso-terrain-window/terrain-1m.f32 --out apps/golf/public
node --env-file=.env packages/course-geo/acquisition/build-ground-rings.mjs --ground angso
node packages/course-v2/publish-ground-rings.mjs --ground angso --slug angso
node --env-file=.env packages/course-geo/acquisition/record-laser-campaigns.mjs --ground angso --write --observed-on 2026-09-04
node --env-file=.env packages/course-geo/acquisition/run-copc-census.mjs --ground angso --write --full
node --env-file=.env packages/course-geo/copc-reader/build-canopy.mjs --ground angso --out packages/course-geo/toolchain/.cache/vegetation/angso --observed-on 2026-09-04
```

The committed evidence is
[`d2-discovery.json`](../geo_data/course-v2/angso/acquisition/d2-discovery.json),
[`terrain-window.json`](../geo_data/course-v2/angso/acquisition/terrain-window.json),
[`ground-rings.json`](../geo_data/course-v2/angso/acquisition/ground-rings.json),
[`laser-campaigns.json`](../geo_data/course-v2/angso/acquisition/laser-campaigns.json),
[`copc-hierarchy-census.json`](../geo_data/course-v2/angso/acquisition/copc-hierarchy-census.json)
and
[`canopy-evidence.json`](../geo_data/course-v2/angso/vegetation/canopy-evidence.json).

### 14.2 The result

| Item | Implemented result |
|---|---|
| Frame | `EPSG:5845`; origin E 605,665.5, N 6,605,721.5, H −1.75 m; fingerprint `bfc6a0f04badb8e31cd874bc28e58ed679dd591164d8cb9a96ca9a96209b9318`. The origin still awaits independent control approval. |
| Finest lattice | 4,096 × 4,096 m, sample-centre bounds E 603,617.5–607,713.5 / N 6,603,673.5–6,607,769.5; 16 × 16 tiles, 4,097 × 4,097 samples, 1 m spacing. |
| Vertical bridge | **0 m, measured** (2026-09-05): the pack is re-grounded from the published graph — see §14.4. Before: 9.1166 m with a 1.8463 m MAD. |
| Source | One Markhöjdmodell item, `660_60`, COG SHA-256 `4fc8d1a8…790fd`, captured 2020-02-24 to 2021-04-10. The retained window is `7ce336cb…33b64a`: 16,785,409 samples, every one finite, −1.747 to 40.109 m RH 2000. |
| Ring graph | 469 tiles over seven levels to a 16,384 m root, `{0:256, 1:64, 2:64, 3:64, 4:16, 5:4, 6:1}`, from nine DTM items. Level 0 reproduces the 256 published course tiles to within one 1 cm quantum on 16,908,500 of 16,908,544 samples. |
| Laser | One campaign, `21c036-660_60`, flown 2021-03-08 to 2021-04-01, 224,178,995 points, 2.093 returns/m² measured over the AOI. Leaf-off. |
| Canopy | 61,035,865 points read over the 256 course tiles: 2.34 returns/m², 15.6% void, 27.2% canopy of measured cells. The cloud's own ground returns agree with the published DTM to a per-tile median of 0.00 m. |
| Runtime | `?bana=angso&v2=1` verifies the graph and renders 469 tiles in ONE draw at 1 m mesh resolution, zero failed tiles, no page errors. |

### 14.3 The three things this ground taught

**A frontier is not the same thing as a metre window.** Ängsö's played ground
is 894 × 2,167 m. Both the frontier contract and the ring topology want a
SQUARE tile count, so 2,048 m — which does not reach the 12th to the 16th —
fails and 4,096 m is the next legal size: 256 level-zero tiles, 16,845,330
encoded bytes, **200.8% of the 8 MiB a visitor may download before the first
frame**. The fix is not a bigger budget. `assertReviewedGraph` now chooses the
level-zero set **by the reviewed frontier bounds** and checks its shape from
those bounds rather than from the tile count — `columns × rows`, not
`√count × √count`. Ängsö preloads columns 4–11 and rows 2–13: 96 tiles,
6,453,395 bytes, 76.9% of the budget, 577 m of metre ground east and west of
the played geometry and 452 m north and south. Every earlier ground selects
its whole level zero at column 0, row 0 through the same code with no branch,
and Ribbingsfors' ten browser gates pass unchanged. Beyond the rectangle the
ground is not missing: the streaming ring renderer draws every published
level-zero tile, and construction heights fall through to level 1, which on
this ground spans the same 4,096 m at 2 m — finer than the 4 m legacy field.

**A null contract is a fact, not a gap.** `V2TerrainLiveAdapter` refused to
CONSTRUCT without a reviewed `legacyCoreCutout`. A ground served by the
streaming ring adapter builds no legacy CORE at all, so it has no cut to
review and cannot measure one — the contract is read off a runtime CORE grid
that path never constructs. The refusal moved from construction time to the
point of use: `prepare()` now refuses to cut without a contract, which is
where refusing belongs, and a ground that does serve through the fixed
frontier is unaffected. The alternative was to invent numbers for a field this
ground never reads, which is the failure the whole provenance ledger exists to
prevent.

**A single vertical offset can be inadmissible, and the MAD is what says so.**
Ängsö's measured legacy-to-RH-2000 step is 9.1166 m with a MAD of **1.8463 m**
— eight times Veckefjärden's 0.2392 m — and it is not registration: the best
rigid shift of the legacy sample point is 12 m and buys 0.1676 m. Mälaren
corroborates the median (the DTM reads the lake's surface in the course's own
bay as a laser-flat 0.876 m against a legacy 9.76 m, a difference of 8.884 m,
0.23 m from the mown-ground median) — but the legacy pack's other water rings
disagree with the DTM by **−3.66 m to +6.10 m**, so no single number can carry
them. On this ground that is survivable only because the ring adapter measures
every water level against the world before the model; on a ground served by
the frontier alone it would not be. The permanent fix is Upsala's: re-ground
the legacy heightfields from the laser DTM in RH 2000, moving nothing
horizontally. That is Ängsö's largest open item.

### 14.4 Open blockers

- **No independent control.** The canonical origin is a compiler-chosen
  provisional frame; `canonicalFrame.origin` stays null in the source manifest.
  *Exit:* 20+ RTK/total-station checkpoints across tees, greens, hazards and
  the perimeter, transformed through the pinned geoid grid, then named human
  approval.
- **No authoritative playing surfaces.** Four of eighteen holes carry an OSM
  hole way; the rest are Esri satellite traces slid to their card length. The
  published graph therefore carries ZERO v2 surface tiles rather than
  presenting a migration as an intake, and `surfacePolicy` is
  `legacy-ground-atlas`. *Exit:* club/as-built GIS, or the licensed 2025
  orthophoto (campaign `orto-o2-2025`, 0.16 m, twelve items, discovered and
  complete but **not acquired**) through the authoritative-surface intake.
- **Esri imagery rights** remain release-blocking for exactly that reason, and
  the committed `tree-cover.json` shares it.
- ~~**The legacy heightfields are still Terrarium**~~ — **re-grounded on
  2026-09-05.** `angsobuild/build-heightfields.mjs` cuts HF0 and HF1 from the
  PUBLISHED ring graph through the derived bridge (a machine with no
  Lantmäteriet credential needs no fresh read: the 256 course tiles reproduce
  the acquired window to a quantum, and the rings reach further than the
  page's far ring ever does); the datum re-measures at **0.0008 m, MAD
  0.0221 m, best shift (0, 0)**, exactly 69 model leaves changed and none
  horizontal. The same pass gave Mälaren its shore (`laser-water.mjs`: the
  laser-flat plate at the regulated level, four rings, a bed sunk under every
  lake cell so one sheet covers flight strips 0.24 m apart) and the reed belt
  the imagery shows, the brooks and dikes the club's texts name
  (`laser-streams.json`, incised channels off the 1 m ground), and the stakes
  of Lokala regler 2026 (`build-marking.mjs`). `verticalDatumOffsetMetres` is
  0 in the config with its evidence.
- **Vegetation is derived, leaf-off, and NOT published — the compiler
  refused it.** The canopy rasters are built (61 M points over the 256 course
  tiles) and the campaign is pinned, but `compile-vegetation` stops on

  > tile l0/4/13 registry is invalid: objects.records[13].heightRH2000 lies
  > outside the declared chunk bounds

  and that refusal is correct. Tile `l0/4/13` is the Mälaren shoreline, height
  bounds 0.76–11.56 m; its western neighbour `l0/3/13` is open water, min and
  max both 0.76 m — a perfectly flat plane, which is what a laser DTM over a
  lake is. A crown base outside that band is a tree standing on the water: a
  March leaf-off flight over a lake returns from the surface, and a ground
  classifier can place them below the flattened plane. The fix is a semantic
  exclusion driven by a water level that can be trusted — which on this ground
  means re-grounding the legacy heightfields FIRST, because the model's own
  water rings are Terrarium and disagree with the DTM by −3.66 to +6.10 m.
  Sequence it after the re-grounding, not before. Note also that the canopy
  raster is sized from `ground.bounds`, which for a ring-published ground is
  the 16 km ROOT: 16,384² cells, 1 GB per layer, and a compile that ran for an
  hour at 5 GB resident before reaching that gate. Both tools should take the
  course window. Zone-A approval, when it happens, will be versioned machine
  review rather than per-object human review, and must say so.
- **The flight is leaf-off** (March/April), which under-detects deciduous
  crowns; on a course with birch and oak that is a systematic bias, not noise,
  and it must be stated wherever a crown count is quoted.
- **The club's own current card was not obtained from the club.** All 126 card
  cells (par, index and five tee columns over eighteen holes) are gated exactly
  by `angsobuild/check3d.mjs`, and hole 1 has three lengths in circulation
  (355 / 386 / 396) of which only 386 makes the printed totals add up — but the
  source is an aggregator transcription, not a dated club sheet.

Default/public v2 enablement for this ground is a separate decision, as for
every other.
