# Upsala ground mapping: reviewed 2024–2025 evidence

This pass improves the shared Stora/Mellanbanan environment. It is not a complete
survey of every object, species or current mowing boundary. `ground-map.geojson`
is an RFC 7946 longitude/latitude GIS export, including the
published LiDAR crown candidates. Its source IDs, dates, inferred status and
unknown accuracy fields remain attached to each feature. Repeated geometry shared
between the two routings is merged, not counted as another object.

Start the next Codex/VS Code session with [NEXT-SESSION.md](NEXT-SESSION.md).
The [latest validation](validation-2026-09-07.md) and
[continued mapping comparison](stora-followup-review.svg) cover the current checkpoint.

## Review added on 7 September 2026

- Added the archive-reviewed rear Stora H11 tee and northern Mellan H8 tee;
  current totals are **54** and **24**. H13 and upper H15 remain provisional.
- Added H8's **85.98 m? Sahara bunker**, supported by paired 2024/2025 imagery
  and club documentation. Removed three unsupported par3 fairway classifications.
- Replaced one coarse practice-area service strip with **116.240 m?** of reviewed
  path polygon, preserving municipal edges and explicitly qualified joins.
- Added four drainage observations, 19 fence/hedge/wall lines and one bridge.
  Drainage and boundary records do not invent water, carving or vertical props.
- Saved **231 municipal observations**: 148 open road edges, 50 surveyed tree
  positions, 13 ditches, 19 boundaries and one bridge. These are source records,
  including corroborations/context, not 231 additional physical objects in 3D.
- Compared 250 municipal ground heights with the published 1 m terrain: median
  difference +0.063 m, RMSE 0.225 m. Another 42 points are outside 1 m coverage.
  Terrain was not shifted or refitted.

See [tee evidence](tee-sites-review-2026-09-07.md),
[par3/Sahara review](par3-sahara-review-2026-09-07.md),
[path review](practice-path-review-2026-09-07.md),
[municipal observations](municipal-objects-2026-09-07.geojson), and
[height comparison](municipal-ground-height-check-2026-09-07.md).
Registration dates, archive-service years and actual capture dates remain distinct.
No exact botanical species are inferred from broadleaf/conifer labels.

## Changes adopted

| Feature | Previous model | Reviewed result |
|---|---|---|
| Buildings | 414 OSM footprints | 444: retain401, replace13 with15 measured components, add28 measured footprints |
| Source bunkers | 55 of86 survived reconciliation | All86 tracked; two reclassified as practice bunkers, one grass-covered sand outline retired with evidence; five additional range bunkers |
| Stora16 bunker | 298m² including grass | 167m² sand outline; shaded northeast edge remains approximate |
| Stora17 green | Synthetic410m² oval | Dated orthophoto outline, approximately584m² |
| Stora8 tees | Incorrect rectangle | Two visible physical tee surfaces; actual terrain preserved |
| Stora9 upper tee | Pad over road/rough | Visible2025 platform; southern edge limited by shadow |
| Stora tees, all 18 sites | 38 platform entries, mostly approximate rectangles | 54 physical-platform entries: 49 new image outlines, three retained earlier traces and two provisional originals |
| Mellan6 green | Inferred ellipse | OSM w221192642, which contains its existing provisional pin |
| Other eight Mellan greens | Inferred ellipses and endpoints | Visible 2025 outlines, checked against2024; centres are polygon centroids, not surveyed flags |
| Mellan tees | 45 generated pad entries | 24 visible physical platforms; no inferred colour assignment or terrain flattening; hole8 review remains partial |
| All 14 Stora par4/5 fairways | Generated corridors | Dated mowing outlines: H13/15 earlier, 12 more in this continuation; H4 split at water |
| Stora16 green | Coarse outline overlapping sand | 2025 turf boundary, with 1m interpretation uncertainty; existing pin retained |
| Six Mellan par4/5 fairways | Straight generated strips | Seven observed polygons, preserving hole8's cart-path gap and hole6's dogleg |
| Practice area | No practice surfaces | Four greens, four range platforms, six target footprints, five range bunkers and one interior island |
| Individual range mats | No individual observations | 30 visible mat footprints: eight west, ten middle, twelve east |
| Practice bunkers | Two older outlines assigned to Stora holes | Updated 2025 sand boundaries in the practice area |
| Bridges and approaches | Generic path/water intersections | Four bridge decks: three imagery reviews plus one municipal southern crossing; heights and the new approaches remain unmeasured |
| Parking | Five OSM areas | Two additional visible parking areas; canopy-hidden continuation remains unresolved |
| Ponds | OSM outlines | Six reviewed DTM plate outlines; original levels retained |
| Small mapped objects | Tagged OSM nodes discarded | 228 tree points, two gates, three fountains, one mast and one flagpole retained in GIS data |

Practice greens and bunkers use the surface atlas. Polygon interior exclusions remain
holes. The 30 mats are individually traced. Material-uncertain targets and mixed range
platforms use exact footprint meshes. `infra.preserveMappedBoundaries=true` preserves
the recorded rings through surface collection, terrain compilation and both renderers:
no shoreline/mowing contour smoothing, second Chaikin pass or bunker expansion. This
preserves the accepted geometry; it does not improve the source's unknown absolute
accuracy. Both routings carry the same physical shared-ground surfaces.

The mapped-object policy uses explicit OSM tower/pole points and the seven non-tree
object points. It suppresses generated physical tee markers, directional/distance
signs, cars, parking heater posts, residential houses and unsupported clubhouse props.
Provisional tee references remain available to the HUD and cameras. Visible bridge
footprints are mapped; their vertical dimensions and the generic object dimensions
remain rendering estimates. The228 OSM tree points are not planted again on top of
the LiDAR crown population.

## Stora tee-platform review

The [18-hole comparison sheet](stora-tee-review.png) ([SVG](stora-tee-review.svg))
shows original, newly traced and retained outlines at equal metre scales with
north up. Each panel has its own scale. The
[latest validation record](validation-2026-09-07.md) covers the rebuilt
54-platform model and both course environments; earlier validation files retain
their historical checkpoint results.

All 18 Stora tee sites were reviewed against the georeferenced 2025 orthophotos,
the same areas in 2024 and the published 1 m terrain. The three source files
`stora-tees-01-06-2025.json`, `stora-tees-07-12-2025.json` and
`stora-tees-13-18-2025.json` contain 44 accepted new platform outlines, original
geometry and route/card values, source dates and hashes, uncertainty and rejected
or unresolved candidates. The follow-up in `stora-tees-followup-2026-09-06.json` adds four archive-assisted
traces crosschecked against 2025. The wider 2026-09-07 review adds H11 rear from the 2017 archive service, again checked against 2025. The guarded application produces 54 platform
entries: 52 image outlines, including the three previously reviewed Stora8/9
surfaces, and two retained provisional originals on H13 and upper H15. H12 gains
its omitted middle platform; H14 and lower H15 replace guessed rectangles; H18
replaces two guessed rectangles with one continuous rear platform. Exact flight
dates for the 2020/2023 municipal archive services are unknown.

The corrections include hole7's two old platform centres, which were 44.5 m and
56.5 m from the corresponding observed platforms. Hole13's two rear rectangles
become one visible elongated deck. Hole14 and hole17 also have continuous turf
platforms that were represented by separate rectangles. Missing forward platforms
on holes 16, 17 and 18 are included. Hole15's unsupported short-tee rectangle is
retired because the imagery shows continuous fairway at that location; its card
reference remains unchanged.

Eight holes retain partial review status: 8, 9, 11, 12, 13, 14, 15 and 18.
Holes8/9 explicitly preserve the three prior image traces without treating them
as a complete census. Hole11 still has a shadow-limited omission; H12 gains a visible middle pad but
retains partial census status. Two original guessed footprints remain explicitly
provisional on H13 and upper H15, where the available images do not establish a
defensible complete boundary. Canopy-hidden
edges are not closed by fitting a shape to the card marker. All accepted turf
tops preserve the existing terrain; daily marker colours, positions, routing and
scorecard distances remain unchanged. Reviewing every tee site does not certify
that every physical tee surface or current marker has been mapped.

`geobuild/tee-platform-survey.mjs` measures the published terrain beneath a
candidate polygon. It reports drainage slope separately from residual planarity,
using both the full interior and a 2 m inner core where enough samples exist.
Edge and exterior comparisons expose shoulders and surrounding relief. A sloping
but planar surface is different from a bowl or uneven ground; none of those
measurements alone identifies the material or establishes its boundary. The tool
records missing samples, source hashes and the selected frame, never changes
terrain or geometry, and never automatically adopts a candidate. Its build and
ground arguments make the same measurement usable on other published grounds.

## Source records and runtime data

The files in this directory retain original source geometry, rejected candidates,
source dates, hashes, interpretation uncertainty and review decisions. The complete
course models retain source-feature identities and retirement history, and the GIS
export carries the applicable provenance for active features. Original EPSG:3006
and image-pixel evidence stays outside local model geometry. `ground-mapping.mjs`
uses explicit evidence-field whitelists and checks the finished model for any key
ending in `3006`, after all mapping integrations.

`packages/course-pack/runtime-scenery.mjs` is shared by pack generation and the
standalone embedder. Its runtime scenery omits duplicate review-only
`sourceFeatures`/`retiredSourceFeatures` and keeps each mapped facility's geometry,
identity, material and compact source reference. Full review records remain in
the source models and mapping files. This separation keeps the transport bounded
without dropping a physical surface or making a retired outline active again.

Woodland context is packed losslessly from the source run-length grid into
`row-major-2bit-lsb-base64-v1`: four cells per byte, with classes 0 unresolved,
1 conifer-dominant and 2 broadleaf-dominant. The source runs, grid georeference and
source metadata remain available; the sampler reads either encoding identically.
This changes storage only. It neither moves crown candidates nor establishes
individual tree species. The declared raster CRS and four-value extent remain
metadata interpreted by the woodland sampler, not local vector coordinates.

## Sources and limits

- `municipal-buildings.json`: Uppsala municipality's public
  [building FeatureServer](https://kartportal.uppsala.se/mapping/rest/services/iOpenData/OpenData_Byggnader/FeatureServer/1).
  Adopt only confirmed existing footprints with recorded RTK/total-station methods
  and complete replacement families. Preserve original EPSG:3006 source geometry
  here, outside the runtime model. Survey day and absolute horizontal accuracy
  were not supplied; edit timestamps are not capture dates. Heights remain unchanged
  or unknown. The clubhouse stays OSM because its municipal status/method are unknown.
- `facilities.json` and `surface-corrections.epsg3006.geojson`: manual visible-boundary
  traces from [municipal Ortofoto2024](https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/Ortofoto_2024/MapServer)
  and Lantmäteriet2025 imagery through the municipality's advertised public WMS.
  The [public webmap](https://kartportal.uppsala.se/portal/sharing/rest/content/items/efc08fa6a37d4e1dbd468327958acd02?f=pjson)
  advertises the service. Its flight-year layer showed2025 across the reviewed area.
  Municipal native pixel spacing is0.08m, LM0.16m; most tracing exports are0.25m.
  Pixel spacing and coordinate-transform precision do not establish positional accuracy.
- `ponds.json`, `terrain-decisions.json`, `bunker16.json`: published2023 terrain,
  reviewed against2024 imagery. These corrections were not cross-checked against2025.
  Accepted ponds: w35415024, w35415025, w221190914, w306287289, w438967946, w438964102.
  Four larger automatic shoreline changes were rejected because they removed visible
  lobes/channels or confused vegetation. All three proposed new ditches were rejected.
- The existing 1m terrain, 4,181 LiDAR crown candidates and64 stand tiles remain
  the published ground. The crown source campaigns were flown in spring2021;
  the pond-review terrain is2023. Crown locations are not surveyed stem positions.
- `woodland-leaf-type-context.json` and `woodland-source.json`: Naturvårdsverket
  NMD2023 v2.0, CC0,10m woodland dominance context. Small patches and10m edges are
  excluded. It informs a visual broadleaf/conifer prior only within independent
  canopy placement. Individual species stay unknown; the birch mesh is a broadleaf
  proxy. The newer v2.1 national download could not be spatially extracted by bounded
  HTTP ranges and its equivalence at Upsala is unverified. Coarse context is also
  attached to exported crown candidates without changing their locations.
- Other roads, trails, fields, forest and waterways retain OSM provenance.
  Missing objects, bridge/culvert identity, drainage beneath canopy, exact tree species,
  daily tee markers, small equipment, remaining fairway/rough edges and seasonal
  high-grass boundaries still require better source evidence or field observations.
  The Lilla/practice area's complete routing and object inventory are not certified.

Raw source imagery is not redistributed: public accessibility alone does not settle
redistribution rights. This directory records traced geometry, attribution and hashes.
The existing source manifest's unresolved production/source gates remain unresolved.

## Reproduce

Run from the repository root after installing the repository's Node dependencies.
The existing published ground graph, build inputs and Git commit
`8498cedb8e9cc22467f42e175491072400b3938f` must be available locally. The overview
renderer needs an installed Python with numpy and matplotlib. The rebuild performs
no downloads, dependency installation, commit, push or deployment; it stops at the
first failed step, leaving earlier outputs available for inspection.

After editing accepted evidence, use the complete driver:

```sh
node tools/refresh-upsala-mapping.mjs --help
node tools/refresh-upsala-mapping.mjs
```

Projection uses real PROJ through `cs2cs` on `PATH`; use the repository's pinned
toolchain for the normal environment. An installed Python PROJ binding is an
explicit alternative when the command-line executable is unavailable:

```sh
COURSE_GEO_PYPROJ_PYTHON=/path/to/python3 \
  node tools/refresh-upsala-mapping.mjs --python /path/to/python3
```

`--python` selects the overview renderer; its default is
`CODEX_PRIMARY_RUNTIME_PYTHON` when set, otherwise `python3`.
`COURSE_GEO_PYPROJ_PYTHON` separately selects projection. The Python used in that example must have pyproj, numpy and
matplotlib. The adapter uses authority axis order (`always_xy=False`) with
`PROJ_NETWORK=OFF`; it does not impersonate a `cs2cs` executable. The residual
report identifies the projection implementation, and `horizontalProjectionBackend()`
in `packages/course-geo/proj.mjs` exposes the installed pyproj/PROJ versions.

The driver verifies the original committed cs2cs model, migration and generator
lineage by their byte hashes, then rebuilds both current models, the design,
standalone embed and packs. It invokes
`packages/course-geo/migrate-legacy.mjs --write --ground upsala` to project the
current geometry and regenerate Upsala's canonical residual report plus its entry
in the combined report. These outputs use the following source/output pairs:

| Current course | Source model | Output under `geo_data/course-v2/upsala/migration/` |
|---|---|---|
| Stora | `upsalabuild/course-model.json` | `course-model.epsg3006.json` |
| Mellanbanan | `upsalamellanbuild/course-model.json` | `mellanbanan-course-model.epsg3006.json` |

The manifest's `shipped-middle-course-model` explicitly supersedes
`legacy-middle-model` for migration. The historical
`upsalabuild/mellanbanan-model.json` and its artifact records remain as history;
they are not the shipped nine or an additional current migration input. Output
bindings and duplicate names are checked before generation.

The routing rebinder samples moved endpoints from the published 1 m terrain and
refreshes their streaming tile priorities while asserting that the ground and
vegetation manifest remain identical. Source pins are refreshed before migration;
the final source-manifest update covers exactly six registered artifacts: the
two current models, OSM features, the two migrations and the residual report.
The driver updates only the two Upsala entries in each of `COURSE_MODEL_SHA256`
and `LEGACY_COURSE_MODEL_SOURCES`, refusing changed registry structure or concurrent
edits. It then exports the deduplicated geographic map and renders `overview.svg`
and `overview.png`, followed by `stora-tee-review.svg` / PNG and
`stora-followup-review.svg` / PNG.
The tee comparison reads the three accepted source files plus the follow-up,
preserves their exact vertices and checks every displayed ring against the model. Test expectations and source approvals require their own review.

Check reproducibility after the rebuild with the same selected projection backend:

```sh
node packages/course-geo/migrate-legacy.mjs --check --ground upsala
node packages/course-geo/check-manifests.mjs
```

With Python projection selected, prefix the migration check with
`COURSE_GEO_PYPROJ_PYTHON=/path/to/python3` as above. Check mode recomputes every
coordinate and report statistic and requires byte identity while retaining the
recorded generation implementation. The standard CI check continues to use cs2cs.
Frame residuals and projection agreement are diagnostics, not independent survey
accuracy. A Krüger migration from `migrate-without-proj.mjs` is not the canonical
output of this rebuild.

### Additional source review

Acquisition outputs and large raw rasters belong in the ignored cache. Every request
is recorded with URL, extent and SHA256. These commands acquire or score evidence;
review their results before changing the accepted mapping files:

```sh
python geobuild/imagery/acquire-upsala.py --provider municipal-2024 --resolution .25 --output-dir upsalabuild/cache/ortho2024
python geobuild/imagery/acquire-upsala.py --provider lm-latest --resolution .25 --output-dir upsalabuild/cache/ortho-latest
python geobuild/imagery/acquire-upsala.py --provider buildings --output-dir upsalabuild/cache/buildings
BUILD=upsalabuild RASTER_MANIFEST=upsalabuild/cache/raster-manifest.json node geobuild/imagery/green-tracers.mjs all
node geobuild/pond-survey.mjs --build upsalabuild --ground upsala --out upsalabuild/cache/pond-review
node geobuild/tee-platform-survey.mjs --build upsalabuild --ground upsala --evidence upsalabuild/mapping/stora-tees-01-06-2025.json --out upsalabuild/cache/stora-tees-01-06-terrain.json
```

Repeat the tee survey with the `07-12` and `13-18` source files to measure their
accepted candidates. Omitting `--evidence` measures the current model's platform
entries, which is useful for comparison before adoption. Review the dated imagery
alongside these measurements; small residuals are evidence of planarity, not a
claim of independent geographic accuracy or complete material coverage.

`geobuild/imagery/source.mjs` documents the raster manifest. In the historical
municipal2024 benchmark, 16 then-unchanged OSM reference greens scored
median/minimum IoU: firststep0.86/0.72,
blob0.84/0.58, fusion0.83/0.64, polar0.58/0.47, roughness0.55/0.16.
These are agreement scores against OSM with model-derived seeds, not independent
survey accuracy. No automatic tracer replaced those16 reference outlines. The
Veckefjärden plan method now refuses other builds without matching registrations.

The portable pond survey preserves islands, narrow connections and all components;
it emits review candidates only. It was also exercised on Puttom. The GIS exporter
likewise resolves Puttom's own frame and published crown objects.

`scope.json` preserves every requested mapping category and its unresolved coverage.
The GeoJSON's `metadata.featureCounts` gives the current inventory; shared geometry
is deduplicated, and historical retired outlines are not counted as active objects.
Remaining review includes road/trail widths and missing links, concealed drainage
and crossing structures, unresolved Stora tee edges and omitted shadowed platforms,
remaining small Stora green-edge differences and par3 mowing corridors, partial Mellan8 tee coverage, small equipment,
building heights and cottage use, individual species,
rough/field classifications and seasonal tall grass. Default rendering or a coarse
land-cover prior does not complete any of those categories.

Validation includes canonical migration checks, source-manifest checks, check3d,
byte-identity check-pack, all-course check-packs,
the unit suite, app/page lint, production build and v2 app/renderer checks.
`tests/upsala-mapping.test.mjs` independently exercises island exclusion, source
bunker retention, preservation of terrain under tees, and rejection of absolute
source coordinates accidentally entering the local-coordinate migration.
