# Johannesberg facilities: architecture and references

Prepared **2026-09-10**. The completed exterior architecture contains **22 Blender models** covering the clubhouse, terrace pavilion, named estate buildings and nearby facilities. Both `johannesberg` and `johannesberg-9` load these models and replace the corresponding generic source-building geometry. Dimensions and facade details are reconstructed from pinned evidence with explicit uncertainty; they are not surveyed construction drawings.

- [Open the completed Blender project](../cache/facilities-model/johannesberg-facilities-v1.blend).
- [View the clubhouse in the course](../cache/facilities-model/browser/johannesberg-clubhouse-front.png) or [the estate overview](../cache/facilities-model/browser/johannesberg-estate-overview.png).
- [Inspect the public model manifest](../../apps/golf/public/models/johannesberg/facilities-v1.json).
- [Read the implementation review and final validation](implementation-review.md). Both course variants and the blocked-download fallback passed; the final deck check found no intersections across 3,157 samples.

The original reference project and gallery remain available:

- [Open the searchable reference gallery](../cache/facilities-reference/index.html).
- [Open the Blender project](../cache/facilities-reference/johannesberg-facilities-reference-2026-09-10.blend).
- [View the Blender site plan](../cache/facilities-reference/blender-site-plan.png) or [photo boards](../cache/facilities-reference/blender-photo-board.png).

The Blender bridge on `127.0.0.1:9876` was verified with Blender 4.5.9 LTS. A separate scene, **Johannesberg | Facilities reference 2026-09-10**, was added without changing the existing Tortuna scene, object transforms, selection or current file. Select the Johannesberg scene in the live Blender scene selector, or open the saved project separately. Its 24 images are packed into the file.

## Evidence collected

| Evidence | Coverage | Use |
| --- | --- | --- |
| Lantmäteriet orthophoto, 2025-06-14 | 620 × 420 m hub at native 0.16 m/pixel; 22 exact building crops | Roof appearance, location, orientation and surroundings |
| Complete range context | Additional 0.8 m/pixel crop from the existing overview | Range field and approach context outside the native hub |
| 20 selected exterior photos | Clubhouse front, opposite gable, rear, terrace, range, hotel and annexes | Visible architectural detail, with capture-date evidence |
| Three map documents/renders | Official labelled estate map, parking map, PDF page raster | Building names and role associations |
| Lantmäteriet laser, 2021-04-17 | Bounded extraction across all 22 buildings; 40,266 retained reference vertices | Historical surface and adjacent-ground evidence |
| Site inventory | 22 buildings plus 22 practice, range, parking, access and terrace features | Stable identifiers, source joins, dimensions and unresolved details |

The [official estate map](https://www.johannesbergsslott.se/uploads/1/3/2/7/132774402/karta_jsb_2.pdf) distinguishes the golf clubhouse from the manor and named hotel buildings. The [photo ledger](web-reference-sources.json) records original URLs, publisher pages, hashes, dimensions, capture-date evidence, credits and facility associations. The [web review](web-reference-sources.md) describes the useful views and historical limitations.

Downloaded images, source rasters, point data and Blender projects remain in the ignored cache. Web images are reference-only: redistribution and runtime-texture rights have not been established. The published architecture uses procedural geometry and materials; reference photos and the orthophoto review ground are excluded from the runtime GLB.

## Clubhouse evidence and reconstruction

The clubhouse is **building 131 / `w296165896` / `johannesberg-clubhouse`**. Its inherited footprint box is 33.89 × 11.27 m at 54.72° from grid north, but this is only a comparison/selection envelope. The [clubhouse profile](clubhouse-model-profile.json) and [modelling brief](clubhouse-model-profile.md) resolve the main roof, lower southwest annex, exposed rear floor, crossgables, dormers, balcony and northeast veranda using the full laser window and native roof image. The supported roof extends beyond the inherited mask; walls are estimated separately inside it. The manor is the separate building 127.

Prioritize the high-resolution front views `club-media-4558-original` and `club-media-3970-original`, then the opposite gable `club-media-6642-original` and elevated rear `club-media-6713-original`. Together they show the main gable, central balcony/cross gable, dormers, lower annex, terrace pavilion, side entrance and lower rear storey on sloping ground. The rear view also shows the range huts, mats and parking.

The architecture keeps separate lower and upper floor levels to represent the sloping site. Its roof forms use the 2021 point evidence checked against the 2025 roof image; opening sizes, spacing and decorative details retain explicit modelling estimates. The separate source building `w296165897` is rendered as the open terrace pavilion identified in the facade photographs.

The [deck clearance review](deck-clearance-review.json) records small adjustments within those estimates: the annex terrace slab centre rose 0.25 m with its local entrance threshold, and the pavilion rose rigidly 0.30 m to preserve headroom. These changes clear the displayed ground; they do not alter the native terrain or establish newly measured floor or roof heights.

The detailed front photographs are dated 2018 by publisher camera metadata; the rear/gable pair is dated October 2024. Both predate the reported 2025 renovation. The August 2026 terrace photograph helps with recent surroundings but does not establish the full current facade. Capture dates are kept separate from upload and HTTP modification dates.

## Estate evidence and remaining uncertainty

The [site inventory](site-inventory.json) and [inventory notes](site-inventory.md) link each building to its native crop, footprint geometry, roof observation, role evidence and height report. Use `sourceBuildingId` to join evidence; role names alone are not unique or always confirmed.

The [estate profiles](estate-model-profiles.json) describe the named buildings, service structures and shelters, including evidence-backed distinctive features and estimated dimensions. Current service-building roles, the tower identity/height, exact range bay count and unseen facades retain their recorded uncertainties. The original reference scene still shows the terrace as a location cross; the completed architecture adds the separately documented estimated deck and pavilion.

In the original reference scene, only the small range shelter (306) has an explicitly reviewed roof-edge outline, shown cyan with its existing 1 m uncertainty. Other building outlines are amber inherited context. Green lines represent site features; each retains its individual evidence status. Roof edges are not wall footprints.

## Coordinates, heights and runtime replacement

One unit is one metre. Both Blender projects use `X = easting − 679200`, `Y = northing − 6626160`, `Z = RH2000 − 16`. Horizontal source coordinates are EPSG:3006. The original reference image plane uses a chosen flat plan datum at RH2000 16 m, not terrain or a floor elevation. The architecture review scene instead includes orthophoto context draped over a class-2 ground estimate; this context is excluded from export. Grid north points up in the plan camera.

In the original reference project, the laser collection is hidden by default. Enable **07 Laser evidence - vertices only**, select its mesh and enter Edit Mode to inspect points. `source_classification` preserves class 1 unclassified surfaces and class 2 ground. Class 1 can include vegetation. The [height review](roof-height-evidence.md) keeps measured eaves, ridge and pitch unresolved; percentiles or surrounding-ground medians are not surveyed building heights. The architecture profiles make separate, explicit modelling estimates from that evidence and the photographs.

The publisher projects EPSG:3006 vertices through WGS84 into the established course horizontal frame and retains RH2000 vertex heights. With fine terrain active, **19 buildings use `worldY = RH2000 + 5.6676`**, matching the [Johannesberg runtime bridge](../../apps/golf/src/engine/v2-johannesberg-config.mjs). **Three buildings beyond the northern fine-terrain coverage use terrain anchors**: the runtime applies one rigid vertical shift from the recorded building ground anchor to the displayed terrain, preserving their authored dimensions and relative heights. When fine terrain is inactive, the loader uses terrain anchoring for all buildings. A simple axis swap or exporting Blender Z directly would misplace the models.

The [facilities loader](../../apps/golf/src/engine/scenery/johannesberg-facilities.mjs) loads asynchronously. It verifies the manifest, asset and complete set of source-building matches before installing the new geometry and hiding the generic replacements together. Until that succeeds, the existing buildings remain visible. A failed, blocked or invalid asset retains the complete fallback; it cannot leave a partially replaced estate.

## Rebuild and verify the architecture

The [compiled specification](architecture-spec.json) pins the clubhouse/estate profiles, ground evidence, inventory and geometry helpers. [Build](model-build-report.json), [background export](model-export-validation.json), [publish](model-publish-validation.json) and [browser acceptance](../cache/facilities-model/browser/report.json) receipts identify the generated artifacts and checks. Consult the final receipts for the latest results; the commands below do not assert that a newer build has already passed them.

From the repository root, with the retained cache and Python review environment present:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/compile-model-spec.py
```

Create a small invocation script at `johannesbergbuild/cache/facilities-model/build-next.py` using an **unused** architecture version. Replace the repository path as needed:

```python
import runpy
runpy.run_path(r"C:\Users\olov_\repos\olovs-hemsida\johannesbergbuild\facilities\build_architecture.py")["build"]("v-next")
```

Send that file to the live Blender MCP bridge. Architecture uses `--script`; the helper's `--spec` option is reserved for rebuilding the original reference scene.

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/blender_mcp_client.py --script johannesbergbuild/cache/facilities-model/build-next.py --port 9876 --timeout 900
```

The builder creates a separate versioned scene and library while preserving the existing Blender project. It refuses to overwrite that version's scene or library. The `model-build-report.json` receipt records the exact library path. Open that library in a separate background Blender process to validate, render, export, and write the normally openable release project:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe' --background johannesbergbuild/cache/facilities-model/johannesberg-facilities-v-next-library.blend --python-exit-code 1 --python johannesbergbuild/facilities/render-export-architecture.py
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/publish-model-assets.py
```

The background exporter refreshes the fixed release file `johannesberg-facilities-v1.blend`; versioned libraries retain earlier iterations. The publisher writes the course-frame GLB and `facilities-v1.json` under `apps/golf/public/models/johannesberg/`. Review source/profile changes before regenerating assets.

Run the focused runtime tests, then build and serve the app:

```powershell
npx vitest run apps/golf/src/engine/scenery/johannesberg-facilities.test.mjs
npm --prefix apps/golf run build
npm --prefix apps/golf run preview -- --host 127.0.0.1 --port 8689
```

With that preview server running, use a separate terminal for the real GPU acceptance check:

```powershell
$env:BANVY_GPU = '1'
node tools/check-johannesberg-facilities.mjs http://127.0.0.1:8689
```

The default three cases cover the 18-hole course, the nine-hole course, and an intentionally blocked GLB. They check all 22 replacements or fallbacks and capture course views for visual review. Do not substitute `--primary-only` for the full release check.

Recheck retained evidence and exported positions with `upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/verify-model-sources.py`. The concave roof clipping tests run independently with `blender --background --factory-startup --python-exit-code 1 --python johannesbergbuild/facilities/test-roof-clip.py`.

## Reference-pack validation and reproduction

The [input validation](reference-pack-validation.json) verifies source hashes, image dimensions, map scale and all 22 height joins. The [Blender export receipt](blender-reference-validation.json) records preservation of the live project and the intermediate library export. The [final reopen validation](blender-reopen-validation.json) records the final project hash, all 24 decoded packed images, map bounds/UVs, source attributes and all 40,266 laser coordinates (maximum storage error below 0.00002 m). Site and photo-board renders were visually inspected for orientation and legibility.

The [gallery check](gallery-validation.json) passed in isolated headless Chrome: all images decoded, 54 local links resolved, building-ID and clubhouse searches worked, and clearing the filter restored all entries. Re-run it with `node johannesbergbuild/facilities/verify-reference-gallery.mjs`.

With the downloaded cache present, regenerate the gallery and specification from the repository root:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/prepare-reference-pack.py
```

For a new Blender export, choose a new scene name and output filename in a copied specification to preserve previous work, then use:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/facilities/blender_mcp_client.py --spec johannesbergbuild/facilities/blender-reference-spec.json
```

The builder intentionally refuses to overwrite an existing scene or file. It exports a library first, preserving the live Blender project. Convert that export into a normally openable project and render it in a separate process:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe' --background johannesbergbuild/cache/facilities-reference/johannesberg-facilities-reference-2026-09-10.blend --python-exit-code 1 --python johannesbergbuild/facilities/verify-blender-reference.py -- johannesbergbuild/facilities/blender-reference-spec.json --finalize
```

Use the same command with `--check-only` instead of `--finalize` to verify the saved project again. Update paths for a versioned specification/output. The acquisition receipts in the panel and photo ledgers, plus the laser acquisition/analysis scripts in this directory, retain the upstream provenance.
