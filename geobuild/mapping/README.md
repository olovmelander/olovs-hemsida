# Veckefjarden orthophoto alignment, 2026-09-09

The current course applies 71 explicit review records from Lantmateriet's
`orto-u2-2024` campaign, photographed on 27 June 2024. Catalogue discovery found
this to be the newest complete campaign. Sixteen native 0.16 m RGBI crops cover
the 2049 m playing-ground square. Actual raster affines and pixels were checked;
no fitted shift, rotation or scale was applied to the imagery.

The [tee placement review](tee-alignment-review-2026-09-09.md) lists changes and
unresolved references for every hole. All 108 numbered references are exported
in [JSON](../../geo_data/course-v2/veckefjarden/acquisition/tee-coordinate-review.json)
and [CSV](../../geo_data/course-v2/veckefjarden/acquisition/tee-coordinate-review.csv)
with local coordinates, WGS84, EPSG:3006, provenance and association status.

The [facility reference pack](../facilities/README.md), prepared on 10 September,
combines native orthophotos, reviewed building outlines and exterior photographs
in a separate Blender scene for clubhouse and facility modeling.

## Current adoption

| Review records | Count | Result |
| --- | ---: | --- |
| Greens | 16 | Observed putting boundaries; H2 and H10 remain unresolved. |
| Bunkers | 30 | Corrected sand outlines, including the missing H15 bunker. |
| Tee inventories | 18 | 54 platforms: 47 photographed and 7 historical outlines. |
| Fairways | 7 | H1, H2, H3, H5, H9, H11 and H13 mowing boundaries. |

The tee follow-up changes 49 positions relative to commit `2ade8719`, by at most
20.6305 m. Of 108 references, 87 have provisional platform associations: 75 use
photographed outlines and 12 use historical outlines. Twenty-one remain
unresolved. None establishes daily marker locations or surveyed tee colours.

Joint H6/H16 guide review corrects an earlier assignment: the exposed roadside
rear rectangle belongs to H16. H6 uses the adjacent forest-side historical
platform, partly hidden by trees. The photographed rectangle transfers unchanged.

Every championship hole disables inferred tee rectangles. The app and standalone
viewer preserve explicit pad identity and fit decorative pairs inside that deck,
keeping source/camera coordinates fixed. Display-only inward adjustments are
limited to 1 m. All 182 rendered marker instances pass containment; 17 unresolved
references outside known platforms have no decorative pair.

Both packages are rebuilt. The short course receives updated shared scenery;
its own routing stays unchanged. This follow-up adds 44 excluded stand cells in
five tiles, preserving all 1,821 crowns and all 277 terrain references. Official
card values remain separate from geometric routing lengths.

**H5, 2026-09-19.** The 5th carried two OSM fairways that are the short
course's 4th and 5th (w284933769/70, 29-51 m clear of its line), because
reconcile gave an OSM fairway to any hole whose line its centroid lay within
70 m of; its own 400 m of striped turf rendered as rough. Reconcile now also
requires the hole's line to run through the polygon (true of all 15
championship fairways OSM maps, false of all four short-course strips), and
the 5th's fairway is traced off one 0.16 m panel (`ortho-reviewed-05-fairway.json`,
11,265 m², 58 vertices, 2 m uncertainty). Its record carries a
`baselineReassignment`: the audit still verifies the pinned Git baseline (the
short-course strips) by its hash, while the apply step pins the club-plan
reading reconcile now hands the review.

**H1-H3, 2026-09-19.** The last three holes still drawn from the club-plan
reading, which is an envelope of the corridor rather than the mowing: 1.2x,
1.3x and 2.3x the traced area. On the 1st it reached past the two fairway
bunkers into the rough before the forest, so they read as mid-fairway where the
banguide draws them on its edge. `ortho-reviewed-01-03-fairways.json` traces
all three off 0.16 m panels (6,880, 9,859 and 6,841 m²; 2 m uncertainty); the
2nd's south-east edge follows the mowing stripes where fairway and first cut
share a colour. The eight OSM fairways (H6, H8, H10, H12, H15-H18) were checked
against the same imagery and follow the mowing; they are not re-traced.

The run re-applied every reviewed surface to the current 14,084-crown
generation, which had never received them: 107 reviewed areas, 19 stand tiles,
1,567 cells excluded, 41 canopy cells removed, no crown moved.

## Evidence and limits

`lm-ortho-review.json` pins original geometry, source pixels, panel affines,
image hashes and interpretation uncertainty. The assembler reproduces it from
eleven component ledgers. Tee inventories supersede 27 earlier individual tee
records. Earlier evidence and first-pass trace verification remain in Git history.

The independent source-to-model audit passes all 71 records: 1,612 traced
vertices, 7 native TIFF hashes, 61 panel hashes, 549 RGB sample pixels,
7 corroborating guides and 7 exact historical rings. The production-browser
audit confirms all 108 coordinates, selected camera position, marker count and
zero page errors. The production build and scoped publication checks pass.

Historical outlines on H6/H7/H9/H11/H14 retain original provenance and at least
3 m uncertainty. H5's shaded upper candidate is not traced. H2/H10 greens, other
fairways, indistinct aprons, short-course surfaces and environment boundaries
are not all independently certified. See the detailed review for unresolved tees.

Pixel spacing is not absolute survey accuracy. Source accuracy remains unknown;
interpretation uncertainty is 0.4–3 m. Coordinate storage adds at most 0.00701 m
quantization. The runtime terrain bridge is a local affine approximation with
maximum residual 0.28257 m across the 108 references. These measures are distinct.

## Rebuild

Routine rebuilds use the checked-in ledger. After changing components, assemble
with `--write`. Pixel conversion must use the original pre-review model at
`7aac4d4495e78d9321889273b34ad6d1bb12290a`, not an already reviewed model.
Run `refresh-ortho-vegetation --write` ONCE per change: a second run is a
no-op and overwrites the exclusion report with one. `emit-manifest` drops the
ground's `startup` bundle and the baked tint/water sidecars; the chain restores
`startup` (plain Node), the sidecars need `tools/bake-ground-tints.mjs` and
`tools/bake-water.mjs` against a served build.

```powershell
node geobuild/mapping/assemble-ortho-review.mjs
node geobuild/reconcile.mjs
node tools/build-nine.mjs geobuild/korthalsbanan.json
node geobuild/embed.mjs
node geobuild/check3d.mjs
geobuild/cache/ortho-venv/Scripts/python.exe geobuild/mapping/audit-ortho-alignment.py
geobuild/cache/ortho-venv/Scripts/python.exe geobuild/mapping/export-tee-coordinates.py --before-ref 2ade8719
node packages/course-pack/emit-pack.mjs geobuild apps/golf/public/courses/veckefjarden veckefjarden
node packages/course-pack/emit-pack.mjs veckefjardenkortbuild apps/golf/public/courses/veckefjarden-korthalsbanan veckefjarden-korthalsbanan
node packages/course-pack/emit-manifest.mjs --only=veckefjarden
node packages/course-pack/emit-manifest.mjs --only=veckefjarden-korthalsbanan
node geobuild/mapping/refresh-ortho-sources.mjs
$env:COURSE_GEO_PYPROJ_PYTHON=(Resolve-Path geobuild/cache/ortho-venv/Scripts/python.exe).Path
node packages/course-geo/migrate-legacy.mjs --ground veckefjarden --write
node geobuild/mapping/refresh-ortho-sources.mjs
node tools/rebind-v2-routing.mjs --slug veckefjarden --build geobuild --migration geo_data/course-v2/veckefjarden/migration/course-model.epsg3006.json --write
node tools/rebind-v2-routing.mjs --slug veckefjarden-korthalsbanan --build veckefjardenkortbuild --migration geo_data/course-v2/veckefjarden/migration/short-course-model.epsg3006.json --write
node geobuild/mapping/refresh-ortho-vegetation.mjs --write
node tools/build-startup-packs.mjs
node geobuild/mapping/check-tee-publication.mjs
```

Run `audit-tee-runtime.mjs --base-url URL` against the served app for browser
coordinates and marker instances. On the development machine, set
`$env:BANVY_GPU='1'` for its hardware adapter. Default software rendering can
take several minutes under concurrent workloads.
