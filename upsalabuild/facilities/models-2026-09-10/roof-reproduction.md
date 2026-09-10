# Roof evidence reproduction

The reviewed model inputs are `roof-measurements.json`, `roof-facets.json` and `range-roof-observation.json`. The scripts here preserve the fitting and manual interpretation recipe that was originally run in the ignored `roof-study` cache. This source preservation did not rerun or change the final model inputs.

Use Python with NumPy, Shapely 2.x, pyproj and Pillow. The local interpreter used for this review is `upsalabuild/cache/review-venv/Scripts/python.exe`. Review overlays use `C:/Windows/Fonts/arial.ttf`; on another operating system replace that font path. Geometric fitting is independent of the font.

The scripts resolve paths from their own location. Before reproducing, restore the ignored native imagery, point CSV and terrain cache from the corresponding reference acquisition records. Verify the source hashes in `reference-2026-09-10/orthophoto-manifest.json` and `lidar-roof-evidence.json`. In particular, the laser point CSV is `upsalabuild/cache/facilities-reference-2026-09-10/lidar/clubhouse-central-2021.csv.gz`, SHA-256 `e33c4c3ad63300ef1f6cc7cec5877d55ab194e87a49e47a7c86e56becdce917c`.

Run the following stages in order from the repository root. The compilation and closure stages overwrite the derived JSON inputs; reproduce in an isolated checkout when comparing against an accepted export.

```powershell
$roofPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
$roofRecipe = 'upsalabuild/facilities/models-2026-09-10'
& $roofPython "$roofRecipe/fit-roof-planes.py"
& $roofPython "$roofRecipe/fit-auxiliary-roof-planes.py"
& $roofPython "$roofRecipe/compile-roof-measurements.py"
& $roofPython "$roofRecipe/close-clubhouse-roof.py"
& $roofPython "$roofRecipe/compile-range-roof.py"
& $roofPython "$roofRecipe/derive-roof-facets.py"
```

1. `fit-roof-planes.py` selects source LAS class 1 points inside B01, buffered inward 0.4 m. Deterministic RANSAC uses seed 9401, 1,800 trials per plane and a 0.13 m vertical residual threshold, followed by least-squares refitting. It writes the eight reviewed plane clusters and an overlay to the ignored cache. The native clubhouse crop is exactly `(281, 500, 1063, 1375)` in the campus PNG; its EPSG:3006 transform is `[639784.96, 0.16, 0, 6636460, 0, -0.16]`.
2. `fit-auxiliary-roof-planes.py` selects B02/B04/B05/B06/B07 with a 0.35 m inward buffer, seed 904, 1,300 trials and the same 0.13 m threshold. B07 has too few returns for a stable plane. Both fit stages preserve source class 1; assigning roof meaning is the documented visual review.
3. `compile-roof-measurements.py` converts the source points through exact EPSG:3006 → WGS84 → declared course XZ. It refits the planes in the course frame and combines them with the manually reviewed roof domains. The four clubhouse ridge endpoint pixel pairs are `[[357,262],[309,418]]`, `[[189,376],[309,418]]`, `[[339,485],[392,566]]` and `[[282,468],[383,418]]`; corresponding widths are 13.8, 13.6, 13.8 and 7.9 m. Endpoints are projected onto the fitted plane intersection. B04's main roof is explicitly limited to 8.6 m across so the steep main roof does not extend over its lower rear roof. Dormer sizes remain estimates.
4. `close-clubhouse-roof.py` compares the municipal outlines with the original roof domains. It adds the B01 northwest low roof, the central connector and four narrow edge continuations; it also closes four B04 residual strips. The low northwest roof is a 39-return plane with approximately 0.058 m RMS and a dark roof finish. The 24-return central connector has approximately 0.290 m RMS and is explicitly a coarser local approximation. B06 already has full outline coverage. Run this stage before adding B08, whose observed roof outline is intentionally distinct from its ground-outline reference.
5. `compile-range-roof.py` reads the two native B08 roof outlines in `range-roof-observation.json`. The local DTM datum is approximately 25.0336895 m RH2000. Main-roof corner offsets are `[4.2, 4.2, 3.2, 3.2]` m; rear-roof offsets are `[4.45, 4.45, 4.2, 4.2]` m. Least squares fits a shallow plane to each slightly irregular quadrilateral. These heights and slope directions are explicit modelling assumptions, with 1 m vertical allowance, zero laser supports and null measured residual. The native roof boundaries have 0.7 m interpretation allowance. Existing source-traced range mat coordinates are unaffected.
6. `derive-roof-facets.py` constructs each gable from the minimum of its two planes and retains the maximum roof surface where component domains overlap. It splits and triangulates the visible polygons, checks area coverage and overlap, and verifies the height envelope. The accepted geometry contains 22 components, 33 visible parts and 101 triangles. The report timestamp may differ on a later run; compare the geometry and source hashes rather than expecting a byte-identical report.

The original laser epoch is March–April 2021; the orthophoto is 14 June 2025. The June 2026 club drone photograph supports the visible form. Source agreement supports interpreted modelling and does not establish surveyed as-built dimensions. Municipal Z was not used for roof heights, and the DTM supplies contextual ground elevations rather than finished floors.
