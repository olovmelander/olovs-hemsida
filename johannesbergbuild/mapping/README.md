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
- `lm-review-tee-platforms.json`: four additional photographed platforms on
  main-course holes 2, 4, 6 and 7.
- `tee-placement-review.json` and `tee-placement-nine-review.json`: explicit
  colour references, nominated surfaces and unresolved references.
- `ob-placement-review.json`: five reviewed main-course OB display corridors.

The original four playing ledgers contain 110 accepted feature operations;
the estate ledger adds four and the tee follow-up adds four platforms. All 27
putting surfaces were traced. The rebuilt eighteen has
21 fairway rings, 50 physical/inherited tee rings and 26 bunkers; the nine has
nine fairway/apron rings, 15 observed tee platforms and one bunker. Three false
bunker polygons were removed. The largest correction is the nine's fifth
putting surface: its polygon centroid moves about 51 m from the inherited
placeholder. The 18-hole scorecard remains exact; corrected nine-hole routes
are allowed to differ from scorecard lengths instead of shifting photographed
geometry to force a match.

Accepted tee `c` values now come from explicit placement ledgers. Their inherited
coordinates remain in `orthophotoReference.originalReference.c`; the old
nearest-platform `displayC` anchors are removed. Stable pad IDs associate each
platform reference with its reviewed surface. Across both courses, 98 references
are accepted: 88 on physical platforms, eight on fairway and two inside bounded
mown-ground review areas. The two mown-ground areas constrain placement and do
not add raised tee platforms. Main-course associations use the club guide and
orthophoto topology; the nine's 15 Yellow/Red associations remain explicitly
inferred from visible mats, corridor association and published colour order.

Ten references remain unresolved and produce no physical marker pair: white on
main-course hole 8; white, blue and red on hole 10; red and orange on hole 16;
blue on hole 18; and Yellow on nine-hole holes 1, 2 and 6. Their original nominal
coordinates remain available without snapping to another colour's platform.
Accepted back-tee references update route starts and tee elevations; official
card lengths remain unchanged. The camera and distance calculations use the
same accepted reference.

The renderer places 196 illustrative marker balls inside the nominated
surfaces, separating colours that share a reference. Its constrained offsets
do not alter `c`, routing or measured distances. The checks require at least
0.15 m ball-centre clearance from the surface edge and 0.35 m separation between
colours. Daily marker positions remain unverified.

White OB display corridors on main-course holes 2, 4, 10, 16 and 18 now follow
landscape features supported by the club hole plans and dated orthophotos.
The five retained corridors produce 101 posts using illustrative 12 m spacing
with posts at line corners. Hole 18 stops at the last reviewed dry-bank vertex;
its northern continuation across the open-water junction remains unresolved
and is not drawn. Neither the
individual post positions nor surveyed legal-boundary vertices are established.
Hole 3 remains unpublished: a supplemental native image did not resolve a
unique boundary through the changed or shaded vegetation. No new nine-hole OB
rule or corridor is inferred. The acquisition is recorded in
`ob-orthophoto-acquisition.json`; the accepted and unresolved decisions remain
together in `ob-placement-review.json`.

Post visibility checks actual water-polygon containment before comparing the
terrain and water levels. A nearby pond returned by the spatial grid must not
hide a post on a separate dry bank, as happened on hole 2.

Each operation pins the original geometry, source bytes, capture date, pixel
coordinates and interpretation uncertainty. `apply-ortho-review.mjs` validates
all operations before changing a cloned model. The exact polygons reach both
the standalone page and app pack; boundary smoothing, expanded sand polygons
and inferred extra tee pads are disabled for reviewed surfaces. Explicit
scenery ownership prevents old nine-hole surfaces from reappearing after a
large correction.

`lm-alignment-validation.json` checks the real rebuilt models against the
source decisions, source hashes, pixel transforms, accepted and unresolved tee
references, actual rendered marker balls, OB display policy and reciprocal
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
npx vitest run apps/golf/src/engine/reviewed-tee-marker-placement.test.mjs apps/golf/src/engine/tee-marker-placement.test.mjs
npx vitest run apps/golf/src/engine/boundary-marker-placement.test.mjs
node johannesbergbuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/johannesberg/pack.bin johannesberg3d.html johannesbergbuild
node tools/check-packs.mjs
node packages/course-geo/check-manifests.mjs
node packages/course-geo/migrate-legacy.mjs --check --ground johannesberg
```

With the rebuilt app served locally, run the focused GPU placement check:

```powershell
$env:BANVY_GPU = '1'
node tools/check-johannesberg-placement.mjs http://127.0.0.1:8647
```

It checks the actual 196 tee-marker balls across both courses and the 101
illustrative white posts shown in each estate view. Unresolved references must
remain suppressed. A browser result is established by this run, not inferred
from the model's centre-point checks.

The source validator needs the private acquisition cache, Python with pyproj
and Shapely, and Node. It reads exact baseline models from pinned Git commit
`7aac4d4495e78d9321889273b34ad6d1bb12290a`; `--baseline-dir` also accepts archived
`eighteen.json` and `nine.json` after verifying their original hashes.

The current validation gates cover all 108 source references, the 98 accepted
marker pairs and ten suppressed unresolved references, along with standalone
geometry/pack equality, migration currency and shared scenery. Consult the
generated validation report for the actual model hashes and results; an earlier
check of tee centres alone does not validate the two rendered balls. Browser
checks also cover both course registrations and the main course's default v2
terrain/frame and measured vegetation. Local browser captures remain in the
ignored `johannesbergbuild/cache/placement-browser/` directory; the earlier
surface captures remain in `cache/lm-app-proof/`.

The current implementation passed 24 mapping/migration tests, 43 marker/seam
tests and three boundary-marker tests. Standalone/pack byte parity, Johannesberg
migration currency and the production build also passed. The final browser run
verified all 196 GPU marker spheres and 101 white posts in each estate view,
including surface containment, colour separation and terrain anchoring. Both
course views had no page errors. The main course also passed the default-v2
and legacy opt-out checks, including all 64 metre tiles and the terrain cut.
The focused report and seven captures are in `cache/placement-browser/`.

Review JSON files retain their exact dated bytes through `.gitattributes`;
automatic newline conversion would invalidate the source hashes. The full
repository manifest check currently flags unrelated Norrfällsviken model/source
checksums while the Johannesberg manifest and migration checks pass.

Attribution: Ortofoto Nedladdning © Lantmateriet, bearbetad information,
CC BY 4.0. Product terms and source identities are retained in the acquisition
evidence. Raw imagery is not included in the application.
