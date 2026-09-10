# Visby tee placement and coordinate review, 9 September 2026

The main eighteen now has **59 physical tee platforms**, with **28 numbered
camera references corrected** using native 10 April 2026 orthophotos and the
club-linked Caddee guide. Eleven missing platforms were added and one outline
replaced. Seventy-five of the 108 numbered platform associations are now
corroborated; 33 remain explicitly unresolved at their previous coordinates.
Daily tee markers have not been surveyed.

| Hole | Accepted correction |
| --- | --- |
| 2 | Add rear 63 platform; correct 63, 59 and 51 references |
| 5 | Add the 55 platform across the path; correct 55 and 51 |
| 6 | Add rear 63 platform; correct 63 and 59 |
| 10 | Add rear 63/59 and front 46/41 platforms; correct all six references. The largest correction is 66.80 m |
| 11 | Add rear 63 and front 41 platforms; reconcile all six numbered references |
| 14 | Replace the connected middle turf outline, add three visible platforms and correct 55/51/46/41. Tee 41 previously lay in a bunker |
| 17 | Add the forward platform beyond the road and correct 59/55/51/46/41 |
| 16 and 18 | Corroborate eight existing assignments without moving their coordinates |

The four rear routing starts on holes 2, 6, 10 and 11 follow their corrected
63 references. All subsequent route vertices, greens, bunkers, fairways,
scorecard values, terrain and vegetation remain unchanged. Platform inventory
and numbered association are separate: an observed rectangle does not by
itself identify a tee number.

## Coordinate defect and verification

The authoring frame remains EPSG:3006, with local coordinates
`x = E - 687748.5`, `z = 6370951.5 - N`, and RH 2000 heights. Native image
coordinates use their recorded pixel-edge affine transforms. No global
translation, rotation, terrain warp or extra half-pixel offset was applied.

The app's GPS converter previously treated these projected grid axes as flat
latitude/longitude offsets. Across 108 independent PROJ controls this produced
23.33 m RMS error and a 46.14 m maximum. `gpsToLocal` now recognizes the exact
registered projected frame and projects incoming WGS84 fixes into SWEREF 99 TM
before subtracting the origin. The same correction applies to the registered
Lidingö and Ribbingsfors grid frames; legacy frame conversion is retained.

Screenshot review also caught an independent par-three strategy bug: a lateral
tee first joined the rear tee's centreline, inflating the displayed Green
distance and club recommendation. Hole 14/41 showed 117 m despite a direct
93.08 m shot. Par-three strategy now measures directly from the selected tee
to the green target; par-four/five routing keeps its existing dogleg behavior.

The [coordinate audit](tee-coordinate-audit-2026-09-09.json) verifies all 108
references through authoring, canonical migration, pack and runtime terrain.
Model-to-pack and routing disagreement is zero; canonical millimetre rounding
is below 0.000557 m. Independent synthetic GPS controls agree within
0.000674 m. These are software conversion residuals, not claims about phone GPS
or surveyed absolute accuracy.

All **842 protected graph assets** retain their bytes, including **469 terrain,
256 stand and 116 object tile references**. Both fallback height streams also
remain identical. Tee elevations are resampled from the existing published
terrain; stored one-decimal heights differ by at most 0.05 m. Independent
[GEOS checks](tee-polygon-validation-2026-09-09.json) find valid accepted rings
and no intersection with mapped water, greens or bunkers.

## Source evidence and remaining uncertainty

The [front-nine review](lm-tee-review-front9-2026-09-09.json),
[back-nine review](lm-tee-review-back9-2026-09-09.json) and
[back-nine follow-up](lm-tee-back9-followup-2026-09-09.json) retain raster hashes,
native transforms, guide URLs and hashes, source pixels, old/new coordinates,
platform identities and interpretation uncertainty. The national imagery is
measurement input, retained in the ignored cache. It is not bundled with the app.

Hole 12 still has an explicitly approximate fairway start and no fabricated tee
polygon. Connected mowing and canopy obscure some forward platforms. On holes
13 and 14, the guide's separate rear tee groups conflict with equal 59/55
distances in the structured scorecard. Hole 15's across-path platform requires
further number identification. These gaps remain visible in the audit and in
future image-review plans, including unresolved points that already lie on turf.

## Rebuilding and checking

[reviewed-tee-alignment.mjs](reviewed-tee-alignment.mjs) applies the
[guarded adoption ledger](tee-alignment-review-2026-09-09.json) after the earlier
facility and orthophoto reviews. Both the full generator and the cache-independent
adopter use it. Source hashes, previous geometry, native pixels, assigned-pad
membership and unresolved-coordinate retention are checked before publication.
Reapplication is idempotent. Rebuilding cannot slide shorter tees using card
offsets after a rear reference changes.

```powershell
node visbybuild/mapping/apply-reviewed-facilities.mjs --write
node packages/course-pack/emit-pack.mjs visbybuild apps/golf/public/courses/visby visby
node packages/course-pack/emit-manifest.mjs
node visbybuild/update-source-manifest.mjs
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path 'upsalabuild/cache/review-venv/Scripts/python.exe').Path
node packages/course-geo/migrate-legacy.mjs --ground visby --write
node visbybuild/update-source-manifest.mjs
node tools/rebind-v2-routing.mjs --slug visby --build visbybuild --migration geo_data/course-v2/visby/migration/course-model.epsg3006.json --write
node visbybuild/mapping/tee-coordinate-audit-2026-09-09.mjs --write
npm run check:visby
```

After an intentional model change, refresh only Visby's pinned model and
migration hashes in `hole-source-inventory.mjs` and `hole-source-controls.mjs`.
Do not rebuild the terrain graph for tee edits. The runtime browser harness is
[tee-runtime-review-2026-09-09.mjs](tee-runtime-review-2026-09-09.mjs); it exercises
all six tee controls on all eighteen holes in V2 and GPK, checks actual camera,
card and rangefinder state, and injects independently projected synthetic fixes
through the real GPS callback. Run against a fresh app build.

Validation at this checkpoint: all 54 Visby Node tests, 15 GPS/caddie tests and
nine projection/routing tests pass. Visby's source manifest verifies all 48
artifacts, and its per-ground control plan verifies 18 holes and 30 source
windows. Coastal-water checks protect all 1,472 played points and ten source
islands. The isolated production build passes.

The [WebGL2 browser report](tee-runtime-review-2026-09-09.json) and
[WebGPU browser report](tee-runtime-review-2026-09-09-webgpu.json) each pass all
216 tee selections and 216 synthetic GPS fixes across V2/GPK: 432 selections
and 432 fixes in total, with zero page errors. All 120 par-three strategy
checks measure the direct selected-tee-to-green distance with zero residual.
Both reports bind the final model, served pack and application module hashes.
Sampled screenshots were inspected for the corrected starts on holes 10, 11,
14 and 17; hole 14/41 now visibly reads “Green · 93 m” with the 94 m card intact.

Repository-wide checks are not all green: the global manifest gate reports
concurrent checksum drift in Ängsö, Johannesberg, Norrfällsviken and Puttom.
The full test run was stopped after reporting failures in the Upsala review,
Lidingö water asset, legacy-course migration and Puttom pilot tests. These are
outside the Visby changes. The remaining Visby-specific checks were run
directly after the global gate stopped the combined command.
