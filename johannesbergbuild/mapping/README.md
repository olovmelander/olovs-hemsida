# Johannesberg orthophoto alignment

The 2026-09-09 update uses Lantmateriet's latest complete `orto-o2-2025`
campaign. Mosaic-source intersections identify **2025-06-14** for every acquired
review window. RGBI source resolution is 0.16 m; full-hole context is 0.32 m and
the shared-ground overview is 0.8 m. Images stay in the ignored local cache.

Both course models now consume explicit reviewed geometry on every rebuild:

- `lm-review-front9.json`: holes 1–9 on the eighteen.
- `lm-review-back9.json`: putting surfaces and bunkers on holes 10–18.
- `lm-review-back9-turf.json`: fairways and physical tee platforms on holes 10–18.
- `lm-review-nine.json`: all nine holes of the Pay & Play course.
- `lm-review-estate.json`: practice green, range shelter and two paths.

The four playing ledgers contain 110 accepted feature operations; the estate
ledger adds four. All 27 putting surfaces were traced. The rebuilt eighteen has
21 fairway rings, 46 physical/inherited tee rings and 26 bunkers; the nine has
nine fairway/apron rings, 15 observed tee platforms and one bunker. Three false
bunker polygons were removed. The largest correction is the nine's fifth
putting surface: its polygon centroid moves about 51 m from the inherited
placeholder. The 18-hole scorecard remains exact; corrected nine-hole routes
are allowed to differ from scorecard lengths instead of shifting photographed
geometry to force a match.

Tee marks retain their inherited reference in `c`. A separate `displayC` places
the app marker and tee camera safely inside the nearest mapped physical
platform. Runtime copies retain the original as `referenceC`. These positions
are explicitly provisional and do not identify permanent tee colours or daily
marker locations. No tee platform is invented to cover an old marker.

Each operation pins the original geometry, source bytes, capture date, pixel
coordinates and interpretation uncertainty. `apply-ortho-review.mjs` validates
all operations before changing a cloned model. The exact polygons reach both
the standalone page and app pack; boundary smoothing, expanded sand polygons
and inferred extra tee pads are disabled for reviewed surfaces. Explicit
scenery ownership prevents old nine-hole surfaces from reappearing after a
large correction.

`lm-alignment-validation.json` checks the real rebuilt models against the
source decisions, source hashes, pixel transforms, containment and reciprocal
scenery. Its sub-centimetre projection/rounding residual measures the conversion
of the selected image vertices, **not absolute positional accuracy**. Manual
interpretation uncertainties, typically 1–3 m, remain in the ledgers.

The published vegetation audit found no individual tree centres inside the
reviewed turf. Four 4 m stand cells visibly on clear 2025 turf were excluded by
changing exactly four flag bytes across three chunks. All 2,417 measured trees,
all other stand measurements, terrain and the shared coordinate frame remain
unchanged. `lm-review-stand-exclusions.json` pins those decisions and the
reference publication report verifies the bounded change.

Remaining limits are explicit: official tee-colour positions and some platform
ownership cannot be established from these photographs; hole 10's obscured
back tees and hole 1's obscured bunker remain inherited. The nine's fairways
include identifiable mown approach/apron envelopes where the exact fairway to
semi-rough mowing transition is unclear. Its holes 1 and 5 intentionally share a
43.75 m² mown connector. The distant estate, shadowed objects and independent
survey controls are not claimed complete. Photos from June 2025 cannot verify
subsequent changes.

## Rebuild

Run from the repository root, preserving the listed order so both courses see
the other's final surfaces:

```powershell
node johannesbergbuild/reconcile.mjs
node tools/build-nine.mjs johannesbergbuild/nio.json
node johannesbergbuild/reconcile.mjs
node tools/build-nine.mjs johannesbergbuild/nio.json
node johannesbergbuild/render-design.mjs
node johannesbergbuild/embed.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe johannesbergbuild/mapping/validate-alignment.py
node packages/course-pack/emit-pack.mjs johannesbergbuild apps/golf/public/courses/johannesberg johannesberg
node packages/course-pack/emit-pack.mjs johannesberg9build apps/golf/public/courses/johannesberg-9 johannesberg-9
node packages/course-pack/emit-manifest.mjs
node johannesbergbuild/mapping/update-source-manifest.mjs
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path upsalabuild/cache/review-venv/Scripts/python.exe).Path
node packages/course-geo/migrate-legacy.mjs --write --ground johannesberg
node johannesbergbuild/mapping/update-source-manifest.mjs
node johannesbergbuild/mapping/pin-registries.mjs
node tools/rebind-v2-routing.mjs --slug johannesberg --build johannesbergbuild --migration geo_data/course-v2/johannesberg/migration/course-model.epsg3006.json --write
```

The v2 routing rebinder preserves the current terrain/vegetation graph and
updates only Johannesberg's root entry and fallback pack identity. The nine
continues to use its existing v1 runtime registration. Acquisition and private
review reproduction are documented in `lm-ortho-2026-09-09.md`.

```powershell
node --test johannesbergbuild/mapping/*.node-test.mjs packages/course-geo/migration.node-test.mjs
npx vitest run apps/golf/src/engine/tee-display-anchor.test.mjs
node johannesbergbuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/johannesberg/pack.bin johannesberg3d.html johannesbergbuild
node tools/check-packs.mjs
node packages/course-geo/check-manifests.mjs
node packages/course-geo/migrate-legacy.mjs --check --ground johannesberg
```

The source validator needs the private acquisition cache, Python with pyproj
and Shapely, and Node. It reads exact baseline models from pinned Git commit
`7aac4d4495e78d9321889273b34ad6d1bb12290a`; `--baseline-dir` also accepts archived
`eighteen.json` and `nine.json` after verifying their original hashes.

Final verification on 2026-09-09 passed the 21 mapping/migration tests, 13 tee
display-anchor tests, standalone geometry/pack equality, all 12 app pack/card
checks, migration currency and the production build. Browser checks passed for
both courses, including all 108 displayed tee markers on tee turf. Johannesberg's
default v2 view also passed terrain/frame and measured vegetation checks, with
64 one-metre terrain tiles rendered in one draw. Local browser captures are in
the ignored `johannesbergbuild/cache/lm-app-proof/` directory.

Attribution: Ortofoto Nedladdning © Lantmateriet, bearbetad information,
CC BY 4.0. Product terms and source identities are retained in the acquisition
evidence. Raw imagery is not included in the application.
