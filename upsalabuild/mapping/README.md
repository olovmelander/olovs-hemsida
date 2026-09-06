# Upsala ground mapping: reviewed 2024–2025 evidence

This pass improves the shared Stora/Mellanbanan environment. It is not a complete
survey of every object, species or current mowing boundary. `ground-map.geojson`
is an RFC 7946 longitude/latitude GIS export, including the
published LiDAR crown candidates. Its source IDs, dates, inferred status and
unknown accuracy fields remain attached to each feature. Repeated geometry shared
between the two routings is merged, not counted as another object.

## Changes adopted

| Feature | Previous model | Reviewed result |
|---|---|---|
| Buildings | 414 OSM footprints | 444: retain401, replace13 with15 measured components, add28 measured footprints |
| Source bunkers | 55 of86 survived reconciliation | All86 tracked; two reclassified as practice bunkers, one grass-covered sand outline retired with evidence; five additional range bunkers |
| Stora16 bunker | 298m² including grass | 167m² sand outline; shaded northeast edge remains approximate |
| Stora17 green | Synthetic410m² oval | Dated orthophoto outline, approximately584m² |
| Stora8 tees | Incorrect rectangle | Two visible physical tee surfaces; actual terrain preserved |
| Stora9 upper tee | Pad over road/rough | Visible2025 platform; southern edge limited by shadow |
| Mellan6 green | Inferred ellipse | OSM w221192642, which contains its existing provisional pin |
| Other eight Mellan greens | Inferred ellipses and endpoints | Visible 2025 outlines, checked against2024; centres are polygon centroids, not surveyed flags |
| Mellan tees | 45 generated pad entries | 23 visible physical platforms; no inferred colour assignment or terrain flattening; hole8 review remains partial |
| Stora13/15 fairways | Generated corridors | Dated mowing outlines, with 2–2.5m interpretation uncertainty |
| Six Mellan par4/5 fairways | Straight generated strips | Seven observed polygons, preserving hole8's cart-path gap and hole6's dogleg |
| Practice area | No practice surfaces | Four greens, four range platforms, six target footprints, five range bunkers and one interior island |
| Individual range mats | No individual observations | 30 visible mat footprints: eight west, ten middle, twelve east |
| Practice bunkers | Two older outlines assigned to Stora holes | Updated 2025 sand boundaries in the practice area |
| Bridges and approaches | Generic path/water intersections | Three visible bridge decks; one centreline moved3.5m and its approach reconnected |
| Parking | Five OSM areas | Two additional visible parking areas; canopy-hidden continuation remains unresolved |
| Ponds | OSM outlines | Six reviewed DTM plate outlines; original levels retained |
| Small mapped objects | Tagged OSM nodes discarded | 228 tree points, two gates, three fountains, one mast and one flagpole retained in GIS data |

Practice greens and bunkers use the surface atlas. Polygon interior exclusions remain
holes. The30 mats are individually traced. Material-uncertain targets and mixed range
platforms use exact footprint meshes. The source-boundary policy disables contour
smoothing and sand expansion for this ground, including the compiler and standalone
page. Both routings carry the same physical shared-ground surfaces.

The mapped-object policy uses explicit OSM tower/pole points and the seven non-tree
object points. It suppresses generated physical tee markers, directional/distance
signs, cars, parking heater posts, residential houses and unsupported clubhouse props.
Provisional tee references remain available to the HUD and cameras. Visible bridge
footprints are mapped; their vertical dimensions and the generic object dimensions
remain rendering estimates. The228 OSM tree points are not planted again on top of
the LiDAR crown population.

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

Run from the repository root. Acquisition outputs and large raw rasters belong in
the ignored cache. Every request is recorded with URL, extent and SHA256.

```sh
python geobuild/imagery/acquire-upsala.py --provider municipal-2024 --resolution .25 --output-dir upsalabuild/cache/ortho2024
python geobuild/imagery/acquire-upsala.py --provider lm-latest --resolution .25 --output-dir upsalabuild/cache/ortho-latest
python geobuild/imagery/acquire-upsala.py --provider buildings --output-dir upsalabuild/cache/buildings
BUILD=upsalabuild RASTER_MANIFEST=upsalabuild/cache/raster-manifest.json node geobuild/imagery/green-tracers.mjs all
node geobuild/pond-survey.mjs --build upsalabuild --ground upsala --out upsalabuild/cache/pond-review
node upsalabuild/reconcile.mjs
node tools/build-nine.mjs upsalabuild/mellanbanan.json
node upsalabuild/render-design.mjs
node upsalabuild/embed.mjs
node geobuild/export-ground-map.mjs --build upsalabuild --also-build upsalamellanbuild --out upsalabuild/mapping/ground-map.geojson
```

`imagery/source.mjs` documents the raster manifest. On municipal2024 imagery the
16 unchanged OSM reference greens score median/minimum IoU: firststep0.86/0.72,
blob0.84/0.58, fusion0.83/0.64, polar0.58/0.47, roughness0.55/0.16.
These are agreement scores against OSM with model-derived seeds, not independent
survey accuracy. No automatic tracer replaced those16 reference outlines. The
Veckefjärden plan method now refuses other builds without matching registrations.

The portable pond survey preserves islands, narrow connections and all components;
it emits review candidates only. It was also exercised on Puttom. The GIS exporter
likewise resolves Puttom's own frame and published crown objects.

After editing accepted evidence, run `node tools/refresh-upsala-mapping.mjs`.
It rebuilds both models, packs, routing bindings, migrations, checksum registries
and review-map exports. The migration reference is the original committed cs2cs
model/migration pair, with both byte hashes verified before writing. The routing
rebinder samples moved endpoints from the published1m terrain and refreshes their
streaming tile priorities while asserting that the ground and vegetation manifest
remain identical. The control inventory follows the actual shipped Mellanbanan
model. The driver deliberately does not change test expectations or source approvals.

`scope.json` preserves every requested mapping category and its unresolved coverage.
The GeoJSON's `metadata.featureCounts` gives the current inventory; shared geometry
is deduplicated, and historical retired outlines are not counted as active objects.

Validation includes check3d, byte-identity check-pack, all-course check-packs,
the unit suite, app/page lint, production build and v2 app/renderer checks.
`tests/upsala-mapping.test.mjs` independently exercises island exclusion, source
bunker retention, preservation of terrain under tees, and rejection of absolute
source coordinates accidentally entering the local-coordinate migration.
