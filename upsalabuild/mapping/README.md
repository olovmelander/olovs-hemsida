# Upsala ground mapping: reviewed 2024–2025 evidence

This pass improves the shared Stora/Mellanbanan environment. It is not a complete
survey of every object, species or current mowing boundary. `ground-map.geojson`
is an RFC 7946 longitude/latitude GIS export of **5,790 features**, including the
published LiDAR crown candidates. Its source IDs, dates, inferred status and
unknown accuracy fields remain attached to each feature. Repeated geometry shared
between the two routings is merged, not counted as another object.

## Changes adopted

| Feature | Previous model | Reviewed result |
|---|---|---|
| Buildings | 414 OSM footprints | 444: retain401, replace13 with15 measured components, add28 measured footprints |
| Source bunkers | 55 of86 survived reconciliation | All86 retained, plus5 mapped range bunkers |
| Stora16 bunker | 298m² including grass | 167m² sand outline; shaded northeast edge remains approximate |
| Stora17 green | Synthetic410m² oval | Dated orthophoto outline, approximately584m² |
| Stora8 tees | Incorrect rectangle | Two visible physical tee surfaces; actual terrain preserved |
| Stora9 upper tee | Pad over road/rough | Visible2025 platform; southern edge limited by shadow |
| Mellan6 green | Inferred ellipse | OSM w221192642, which contains its existing provisional pin |
| Practice area | No practice surfaces | Four greens, four range platforms, six target footprints, five range bunkers and one interior island |
| Ponds | OSM outlines | Six reviewed DTM plate outlines; original levels retained |
| Small mapped objects | Tagged OSM nodes discarded | 228 tree points, two gates, three fountains, one mast and one flagpole retained in GIS data |

Practice greens and bunkers use the surface atlas. Their polygon interiors remain
holes. Material-uncertain targets and mixed range platforms use exact terrain-following
footprint meshes without invented mat subdivisions, target flags or net poles.
The aggregate platforms do not establish individual equipment locations. Tagged
OSM points are mapped evidence; this pass does not invent individual 3D assets for them.

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
  the published ground. Crown locations are not surveyed stem positions. Species
  defaults are rendering assumptions, not identified individual species.
- Existing roads, trails, parking, fields, forest and waterways retain OSM provenance.
  Missing objects, bridge/culvert identity, drainage beneath canopy, exact tree species,
  daily tee markers, small equipment, most fairway/rough edges and remaining inferred
  Mellanbanan shapes still require better source evidence or field observations.
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

After model changes re-emit both packs and their index, then use
`tools/rebind-v2-fallback.mjs --slug upsala,upsala-mellanbanan`. Re-migrate using
the previous source model and its committed EPSG:3006 reference, then re-pin the
source manifest and control registries. Do not compile away the existing ground
or vegetation graph. The control inventory now follows the actual shipped
Mellanbanan model rather than its retired guide-only predecessor.

Validation includes check3d, byte-identity check-pack, all-course check-packs,
the unit suite, app/page lint, production build and v2 app/renderer checks.
`tests/upsala-mapping.test.mjs` independently exercises island exclusion, source
bunker retention, preservation of terrain under tees, and rejection of absolute
source coordinates accidentally entering the local-coordinate migration.
