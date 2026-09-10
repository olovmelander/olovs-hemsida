# Puttom orthophoto alignment — 9 September 2026

The current model incorporates visible boundaries interpreted from Lantmäteriet's
27 June 2024 RGBI campaign. A fresh official catalogue query confirmed this as
the newest complete 16 cm campaign over Puttom. All 45 planned native windows
were acquired with 100% valid pixels. Full TIFF source identities, bounded-crop
hashes, native grids and access evidence are recorded in
[`orthophoto-review.json`](../geo_data/course-v2/puttom/acquisition/orthophoto-review.json).

The tee follow-up also acquired 18 matching native windows from the 2022
campaign. The western tiles were photographed on 3 July at approximately
07:37 UTC; the eastern tiles on 24 June at approximately 11:31 UTC. Their
different lighting resolves several platforms hidden in the 2024 afternoon
images. Each adopted observation keeps its actual source year and timestamp;
the 2022 evidence is checked against the 2024 image and the club's numbered
hole plan. The separate acquisition record is
[`tee-2022-review.json`](../geo_data/course-v2/puttom/acquisition/tee-2022-review.json).

The adoption ledger is
[`mapping/orthophoto-review.json`](../puttombuild/mapping/orthophoto-review.json).
Its summary and the independent
[`alignment-audit.json`](../puttombuild/mapping/alignment-audit.json) state the
current counts and unresolved coverage. The review includes 16 greens, 34 bunker
boundaries, 18 fairway rings and three corrected bunker assignments between holes.
It adopts 27 platform outlines and identifies 57 of the 72 numbered tee references;
13 of those references have visible interiors but unreviewed platform edges.
The remaining 15 references retain an explicit unresolved status.
This follow-up moves 18 references by more than 5 cm and supports 29 additional
numbered references. The largest corrections are hole 14 tee 48 (58.52 m, onto
the platform beyond the bridge) and hole 16 tee 48 (32.05 m, onto its separate
square platform). Hole 6 tee 61 moves 18.44 m out of the trees onto its platform.
Hole 16's route start also now matches its tee 61 reference, correcting a
10.04 m disagreement between the route and camera.
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

Decorative tee-marker pairs fit the connected cross-section of the platform
containing their reference. Reviewed references retain the identity of their
own platform through the pack and standalone page. Narrow platforms constrain
the pair width, including the small hole 12 forward mat; the marker sphere's
footprint must also clear the edge. A reference without a containing platform
does not generate an unsupported physical pair. Where necessary, the display
pair can move up to 1 m inward within that same platform to clear the sphere
footprint. Camera coordinates stay at their recorded source position.

Hole 14 has a known scorecard conflict: the retained 2018 card says 405 m for
tee 48, while the current LiveCaddie card linked by the
[club's course guide](https://puttom.se/banguide/) says 350 m. The forward
platform is identified from the numbered plan and orthophotos; its coordinates
are not shifted to make the older printed distance fit. This update preserves
the existing card metadata and records that conflict separately.

The 277 terrain tiles, coordinate origin, laser tree data and stand fields retain
their existing generation. Imagery is from 2024, whereas laser campaigns span
2023 and 2026; vegetation is not relocated to an older photograph.

## Remaining uncertainty

Greens 3 and 15 remain obscured by tree shadows. Several fairway edges and tee
platforms are also hidden or indistinct; each deferred boundary is retained with
its previous lineage. The audit inventories all 72 tee references and records
which ones are inside mapped platforms, freshly identified or still unresolved.
The canonical origin and independent survey controls remain unapproved.

The 15 unresolved numbered references are tee 41 on holes 2, 4, 6, 7, 8, 9,
10, 13, 14, 15, 16, 17 and 18; tee 61 on hole 11; and tee 48 on hole 15.
These need an identifiable numbered station or field observation before their
placement can be certified. Several are forward starts on grass without a
distinct permanent platform.

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

Final validation passed on 9 September 2026:

- All 25 mapping tests, the independent alignment audit and the standalone
  page checks passed. All 1,954 adopted coordinates reproduce the recorded
  source pixels exactly; the maximum runtime projection discrepancy is 9.20 cm.
  This is a software conversion measurement, not a survey accuracy claim.
- Browser checks passed with the terrain preview enabled and disabled.
  All 72 selected tee cameras preserve the model positions, and all 110
  decorative marker spheres fit their own platforms. The smallest measured
  marker-centre clearance is 16.12 cm for a 15 cm sphere radius.
- Source-manifest validation, all three frozen-world checks and all 30 focused
  preview/marker tests passed. The review page loaded both image years and
  switched holes without browser errors.

The checked compatibility pack SHA-256 is
`2e07d11db74efe05ad92959bd6b7acae97cb8f55e8b526ca8058315ee6077475`.
The browser results are in `puttombuild/cache/runtime-review/report.json`.

Raw TIFFs and review PNGs stay in ignored `puttombuild/cache/`; they are not in
the runtime pack or Git. The native source overlay exporter is
`puttombuild/mapping/review_export.py`. With the image cache present, generate an
interactive local comparison using `make-review-page.mjs`; its output is
`puttombuild/cache/orthophoto-review.html`.

For the tee-specific comparison, run `make-tee-review-page.mjs`. Its local
output, `puttombuild/cache/tee-placement-review.html`, compares this follow-up
against the preceding model on both image years. The coordinate inventory is
[`tee-coordinates.csv`](../puttombuild/mapping/tee-coordinates.csv), with native
EPSG:3006 and geographic positions, source dates and placement status for all
72 references. The machine-readable checks are in
[`tee-coordinate-report.json`](../puttombuild/mapping/tee-coordinate-report.json).

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
node puttombuild/mapping/tee-coordinate-report.mjs
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
