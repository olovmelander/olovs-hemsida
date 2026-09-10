# Ängsö orthophoto alignment, 2026-09-09

Ängsö's 18-hole course now uses accepted outlines from Lantmäteriet's native
0.16 m RGBI orthophotos, captured on **2025-04-24**. The update covers all putting
surfaces, physical tee platforms and visible sand inventories, 16 fairways and
eight nearby pond shorelines. Published source-image seam polygons establish the
capture date. The fourth image band is near infrared, not transparency.

The reviewed geometry is in
[`orthophoto-review.json`](../../angsobuild/mapping/orthophoto-review.json).
[`alignment-report.json`](../../angsobuild/mapping/alignment-report.json) records
the independent numerical audit, exact input hashes, per-hole changes, source
checks and comparison-image paths. The audit records the exact current model SHA-256.

| Feature class | Previous rings | Reviewed rings now | Retained, unreviewed rings |
|---|---:|---:|---:|
| Putting surfaces | 18 | 18 | 0 |
| Fairways | 19 | 16 | 2 |
| Physical tee platforms | 64 | 52 | 0 |
| Sand bunkers | 48 | 33 | 0 |
| Water | 14 | 8 | 6 |

Complete reviewed inventories replace the earlier class within each hole. This
removes duplicate or unsupported sand and tee geometry and adds three visible
bunkers previously absent on hole 13. Green area-centroids moved a median
**6.019 m**, with a maximum **15.475 m** on hole 7; hole 5 moved **11.460 m**.
These describe changes from the old model, not errors against survey controls.

Every accepted pixel vertex was checked independently against the emitted model:
native pixel edges map through their EPSG:3006 affine, while model points map
through the frozen local-frame inverse to WGS84 and then through PROJ to
EPSG:3006. Across **127 polygons and 2,537 vertices including closing vertices**,
the maximum discrepancy is **0.000746 m**, or **0.004663 native pixels**. This
measures numerical implementation fidelity. Neither that residual nor the
0.16 m image resolution establishes absolute surveying accuracy or the accuracy
of a manually interpreted boundary.

The frozen frame retains origin latitude 59.5739, longitude 16.871,
111320 metres per latitude degree and the stored 56375.41 metres per longitude
degree. Its axes are east `+x` and true north `-z`; the native image is aligned
to the EPSG:3006 grid. Projection handles their convergence. No translation,
rotation or scale was fitted to make old outlines coincide with the imagery.
Continuous pixel coordinates address edges; raster sample centres are at
`column + 0.5, row + 0.5`.

All reviewed polygons are simple, closed and within their recorded image bounds.
Every green reference and routing endpoint lies in its accepted putting surface.
All 18 source TIFF hashes and affine grids pass. Native comparison overlays are
in the ignored `angsobuild/cache/lm-ortho/alignment-review/` directory: dashed red
shows the baseline, green putting surfaces, yellow fairways, cyan tees, pink sand,
blue water and white retained fairways. The complete contact sheets were inspected;
holes 5 and 7 also received an independent native green-overlay check.

Tee references received a separate guide-to-orthophoto review. Read
[the tee alignment record](angso-tee-alignment.md) for the accepted native-pixel
anchors, explicitly unresolved colours and complete coordinate/runtime checks.
All physical pads preserve measured terrain. Orange tees use existing fairway
turf; that association does not invent a raised platform. Distinct colours sharing
a platform retain distinct representative positions. Scorecard lengths remain
metadata; source geometry is not stretched to reproduce those lengths.

Fairways **12 and 15 retain their old outlines** because the spring imagery does
not establish their cut boundaries confidently. Shadows and dormant turf also
limit some interpreted margins. The capture does not establish subsequent course
changes, current marker positions or water levels. All 14 measured water levels
remain unchanged. Vegetation, infrastructure geometry, streams, coast and scenery
also compare unchanged against the baseline; this work does not certify their
alignment. The retained `malaren-1` shoreline has an existing self-intersection
near E604225.112, N6603678.661, outside the reviewed pond set.

The original surface validation run passed seven Node consumer tests, five Ängsö v2
configuration tests, the 3D checks and exact page/pack agreement, including 126
scorecard values. A live WebGPU capture booted in 24.711 seconds, recorded zero
errors and passed eight viewpoints. Its evidence is
`angsobuild/shots/lm-ortho-2026-09-09/world-capture.json`. The normal production
build encountered Windows `EPERM` on the shared `apps/golf/dist/grounds` output;
an isolated production JS/CSS build passed with public-directory copying disabled.
The global source check passed Ängsö's source artifacts and reported one unrelated
Johannesberg validation-file hash mismatch.

Reproduce acquisition from the repository root using the existing ignored Python
environment. The pinned plan must be retained; `--replan` creates different review
windows. Credentials come from the existing `LANTMATERIET_*` configuration and
are never recorded in the evidence files.

```powershell
node angsobuild/mapping/lm-ortho-discover.mjs
upsalabuild/cache/review-venv/Scripts/python.exe angsobuild/mapping/lm-ortho-acquire.py
upsalabuild/cache/review-venv/Scripts/python.exe angsobuild/mapping/lm-ortho-capture.py
upsalabuild/cache/review-venv/Scripts/python.exe angsobuild/mapping/lm-ortho-verify.py
```

Rebuild from the accepted review fragments and existing terrain:

```powershell
node angsobuild/mapping/combine-orthophoto-review.mjs
node angsobuild/reconcile.mjs
node angsobuild/build-marking.mjs
node angsobuild/reconcile.mjs
node angsobuild/embed.mjs
node angsobuild/render-design.mjs
node packages/course-pack/emit-pack.mjs angsobuild apps/golf/public/courses/angso
node packages/course-pack/emit-manifest.mjs --only=angso
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path upsalabuild/cache/review-venv/Scripts/python.exe).Path
node angsobuild/mapping/update-source-manifest.mjs
node packages/course-geo/migrate-legacy.mjs --write --ground angso
node tools/rebind-v2-routing.mjs --slug angso --build angsobuild --migration geo_data/course-v2/angso/migration/course-model.epsg3006.json --write
node angsobuild/mapping/update-source-manifest.mjs
```

Reproduce the independent audit and comparison overlays with the pinned ignored
baseline model still present. `--no-overlays` recomputes metrics while reusing the
existing overlay ledger.

```powershell
upsalabuild/cache/review-venv/Scripts/python.exe angsobuild/mapping/review-alignment.py
node angsobuild/mapping/update-source-manifest.mjs
node angsobuild/mapping/tee-coordinate-audit.mjs --write
node angsobuild/mapping/update-source-manifest.mjs
node --test angsobuild/mapping/reviewed-orthophoto.node-test.mjs
node angsobuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/angso/pack.bin angso3d.html angsobuild
```
