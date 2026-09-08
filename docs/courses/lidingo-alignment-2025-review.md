# Lidingö alignment review — 8 September 2026

The course mixed an exact SWEREF 99 TM model with a latitude/longitude approximation in GPS, selected-tee views with old route endpoints, and contemporary canopy with older woodland-only floor materials. This pass repairs those mismatches and adopts manually reviewed putting and approach boundaries from the retained 31 May 2025 orthophoto.

## Changes visible in Banvy

- GPS now projects WGS84 into EPSG:3006 before subtracting Lidingö's exact local origin. Fixed independent PROJ controls agree within 0.001 m; this is a software transform check, not GPS or survey accuracy.
- The selected tee, camera, Spelsinne route and highlighted mini-map route share one playable path. Par threes go directly to the visible green target. Dogleg waypoints remain on longer holes. All 90 starts are inside observed tee platforms; two nominal starts received decimetre rounding repairs.
- Fourteen putting outlines now follow interpreted 2025 putting cuts: holes **1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16 and 17**. Visible targets move to an interior centroid of each revised cut. The largest target corrections are hole 9 (8.81 m) and hole 12 (7.69 m).
- Six visible mown approach footprints on holes **1, 3, 6, 9, 11 and 16** now appear as semi-rough in the atlas, legacy overlays and mini-map. Their combined observed footprint is approximately 0.84 ha. This display class does not establish mowing height or fairway grade. Unmown gaps remain rough.
- The existing dated canopy raster now supplies the Lidingö forest-floor material beyond coarse woodland polygons. Maintained and hard surfaces retain priority; the mask does not invent individual stems.

The observed green/tee polygons retain terrain heights and boundaries. Official scorecard distances, source routes, fairways, bunkers, ponds, coastline, roofs, paths and other infrastructure retain their pre-review geometry. The entire 277-tile ground graph remains byte-identical, including its seven terrain levels, 64 object registries and 64 stand fields. Existing coastline and terrain cover the broader environment, beyond the course window.

The routing rebinder now understands exact projected model frames, so it can refresh Lidingö's pack reference without applying a second degree-based transformation. Current source routing is unchanged; interactive selected-tee paths are derived at runtime.

## Evidence and reproducibility

[Putting outlines, before and after](../../lidingobuild/mapping/putting-cut-review-2025.jpg) show the previous boundary in orange and the adopted cut in cyan. [Mown approach review](../../lidingobuild/mapping/approach-cut-review-2025.jpg) shows the six observed footprints.

Geometry is stored with original boundaries, source pixel vertices, crop transforms, source image identity and interpretation uncertainty in:

- `lidingobuild/mapping/putting-cuts-2025.json`
- `lidingobuild/mapping/approaches-2025.geojson`
- `lidingobuild/mapping/alignment-validation-2025.json`

The source image is the previously acquired EPSG:3006 0.16 m mosaic, SHA-256 `bcec0932c68497b690fe1020e3426ca2596519ebf5875eb3a65ed0c120660c2e`. Source: [Lantmäteriet Min karta](https://www.lantmateriet.se/sv/kartor/vara-karttjanster/min-karta/), © Lantmäteriet, adapted, CC BY 4.0. Acquisition, capture-date evidence and licence attribution are retained in the review records. The earlier rejected automated green detector remains rejected; these are separate manual image interpretations.

Reapply the accepted vectors without reconstructing or impersonating a missing raw terrain cache:

```sh
python lidingobuild/mapping/apply-putting-cuts.py
node lidingobuild/refresh-reviewed-geometry.mjs
node lidingobuild/update-source-manifest.mjs
COURSE_GEO_PYPROJ_PYTHON=python node packages/course-geo/migrate-legacy.mjs --write --ground lidingo
node packages/course-pack/emit-pack.mjs lidingobuild apps/golf/public/courses/lidingo lidingo
node packages/course-pack/emit-manifest.mjs --only=lidingo
node tools/rebind-v2-routing.mjs --slug lidingo --build lidingobuild --migration geo_data/course-v2/lidingo/migration/course-model.epsg3006.json --write
npm run check:lidingo-alignment
npm run check:lidingo
```

The bounded adapter also runs after a full source-model build. If accepted geometry changes again, refresh the two **Lidingö-only** model hashes in the hole-source registries, review and regenerate the dated alignment report with `--write`, and refresh the ledger. Do not blindly update retained acquisition or vegetation-input checksums. Recreate the image overlays with `python lidingobuild/mapping/render-putting-review.py --publish` after restoring the exact ortho cache.

## Verification and remaining uncertainty

The automated alignment audit verifies all 90 selected starts and endpoints, source-to-pack geometry parity, preserved non-reviewed model content, zero revised putting-cut overlaps with mapped sand, and unchanged ground identity. Full and reduced-detail vegetation plans contain **45,081** and **30,646** trees respectively, including **2,544 measured individual candidates**. Neither plan places a trunk on an adopted approach or any green. This is a runtime placement check; it does not establish surveyed stem positions, species, or every crown's clearance.

Production build, focused engine tests, routing-rebuild tests and the Lidingö source/graph suite pass. The suite's original-raw-terrain comparison is skipped because that ignored acquisition cache is absent; published terrain chunks remain hash-verified. The cloud browser could not open the local preview (`ERR_BLOCKED_BY_CLIENT`), so this pass has **no interactive 3D visual sign-off or device-performance measurement**.

Putting boundaries on **3, 4, 15 and 18** remain under review because shadows prevent a confident contemporary edge. The adopted image traces have a stated **2 m interpretation uncertainty**, with independent registration accuracy unknown. Daily tee colours and flags remain display references. Detailed clubhouse architecture, equipment inventory, exact individual trees, remaining bunker/fairway changes and later facility alterations still require contemporary observations; their existing evidence-backed geometry has been retained. This is a substantial alignment correction, not a claim that every asset has received a fresh survey.
