# Puttom orthophoto alignment — 9 September 2026

The current model incorporates visible boundaries interpreted from Lantmäteriet's
27 June 2024 RGBI campaign. A fresh official catalogue query confirmed this as
the newest complete 16 cm campaign over Puttom. All 45 planned native windows
were acquired with 100% valid pixels. Full TIFF source identities, bounded-crop
hashes, native grids and access evidence are recorded in
[`orthophoto-review.json`](../geo_data/course-v2/puttom/acquisition/orthophoto-review.json).

The adoption ledger is
[`mapping/orthophoto-review.json`](../puttombuild/mapping/orthophoto-review.json).
Its summary and the independent
[`alignment-audit.json`](../puttombuild/mapping/alignment-audit.json) state the
current counts and unresolved coverage. The review includes 16 greens, 34 bunker
boundaries, 18 fairway rings and three corrected bunker assignments between holes.
It adopts 21 platform outlines and identifies 28 of the 72 numbered tee references;
six of those references have visible interiors but unreviewed platform edges.
Physical tee platforms and numbered virtual camera references are separately
recorded; these references are not observations of movable daily tee markers.
Where a numbered platform has a visible interior but obscured edges, a reviewed
camera reference can be adopted without claiming that its boundary is verified.

## Alignment and resulting behaviour

Traces retain native pixel coordinates and the real image affine. EPSG:3006
coordinates pass through the inverse SWEREF projection into Puttom's unchanged
legacy authoring frame. No fitted whole-course shift is applied. The existing
runtime bridge accounts for grid convergence and the legacy frame's scale.
The audit compares every adopted vertex and reference against the source pixels,
then measures the remaining software bridge discrepancy separately. These checks
establish coordinate preservation, not independently measured absolute accuracy.

Image-derived outlines retain their vertices in the renderer. The app no longer
rounds these outlines, inflates the sand edge, or synthesises rectangular tee pads
under unresolved scorecard-derived camera positions. Scorecard values remain
unchanged; measured route lengths are allowed to differ from printed card lengths.
Updated tee and green heights are sampled from the existing published 1 m terrain.
Routing and surface assets are regenerated against the new compatibility pack.

The 277 terrain tiles, coordinate origin, laser tree data and stand fields retain
their existing generation. Imagery is from 2024, whereas laser campaigns span
2023 and 2026; vegetation is not relocated to an older photograph.

## Remaining uncertainty

Greens 3 and 15 remain obscured by tree shadows. Several fairway edges and tee
platforms are also hidden or indistinct; each deferred boundary is retained with
its previous lineage. The audit inventories all 72 tee references and records
which ones are inside mapped platforms, freshly identified or still unresolved.
The canonical origin and independent survey controls remain unapproved.

[`review-water.json`](../puttombuild/mapping/review-water.json) is a candidate
**open-water** mask, not an adopted lake shoreline. It excludes reed beds and
some occluded banks. In the current renderer, replacing the lake ring would also
change water-height sampling, bed carving and wetness classification. A separate
visible-water and hydrological-boundary model is needed before adopting this mask.
Current lake geometry and levels are therefore retained.

Buildings, paths, unreviewed features and retained legacy references have not
become image-verified merely because their surroundings were inspected.
The clubhouse outline extends approximately 4–6 m into the courtyard relative
to the visible roof; adjacent annex/reception outlines and part of the range
building also differ from visible roofs. Roof edges, overhangs and shadows do
not establish ground wall footprints. These observations are retained in
`review-infrastructure.json`; building geometry remains unresolved. No defensible
path correction was established in the final clubhouse-area inspection.

## Reproduce and inspect

Raw TIFFs and review PNGs stay in ignored `puttombuild/cache/`; they are not in
the runtime pack or Git. The native source overlay exporter is
`puttombuild/mapping/review_export.py`. With the image cache present, generate an
interactive local comparison using `make-review-page.mjs`; its output is
`puttombuild/cache/orthophoto-review.html`.

The accepted ledger rebuilds without source rasters. To regenerate all derived
course data, run these commands from the repository root. The migration requires
a Python interpreter with pyproj; set `COURSE_GEO_PYPROJ_PYTHON` to that executable.

```text
node puttombuild/reconcile.mjs
node puttombuild/embed.mjs
node packages/course-pack/emit-pack.mjs puttombuild apps/golf/public/courses/puttom
node packages/course-pack/emit-manifest.mjs
node puttombuild/update-source-manifest.mjs
node packages/course-geo/migrate-legacy.mjs --ground puttom --write
node puttombuild/update-source-manifest.mjs
node tools/rebind-v2-routing.mjs --slug puttom --build puttombuild --migration geo_data/course-v2/puttom/migration/course-model.epsg3006.json --write
node packages/course-v2/compile-puttom-surface-preview.mjs --replace
node puttombuild/mapping/audit-alignment.mjs
node puttombuild/update-source-manifest.mjs
npm run check:puttom-mapping
```

Bind `PUTTOM_PREVIEW_CONFIG.surfaceDescriptorSha256` to the compiler's reported
hash after a surface rebuild. The compiler's descriptor and the app's pinned
hash must match. Rebuild the app and run the Puttom browser gate before publishing.

To revise source traces, first run `reconcile.mjs --baseline`, which writes an
ignored baseline without altering the current model. After inspecting each
fragment's source pixels, run `build-orthophoto-review.mjs`; it verifies every
referenced TIFF and sidecar. The adopted ledger pins the exact baseline model
hash so later OSM changes cannot silently reuse stale replacement indices.

For a comparison that includes whole-hole fairways, export the revised geometry
on the original review grids before generating the page:

```text
python puttombuild/mapping/review_export.py --out puttombuild/cache/lm-ortho-after --crop-reference puttombuild/cache/lm-ortho-review/review-index.json
node puttombuild/mapping/make-review-page.mjs
```

Attribution: Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.
