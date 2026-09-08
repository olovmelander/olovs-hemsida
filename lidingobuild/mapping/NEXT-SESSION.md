# Lidingö 3D mapping handoff

## Current checkpoint — 2026-09-08

Read [the dated alignment review](../../docs/courses/lidingo-alignment-2025-review.md) before the historical handoff below. Fourteen putting cuts and six par-three approaches now use reviewed May 2025 pixels. GPS, camera and Spelsinne share the exact projected frame and selected-tee route; the canopy raster also supplies forest-floor material. Run `npm run check:lidingo-alignment` for source/pack parity, 90 tee starts, retained model content and both runtime tree populations.

The existing 277-tile ground generation is preserved. The bounded change has a separate runtime placement audit: neither population has a trunk on any green or new approach. Historic stand-input pins were not rewritten to imply recompilation. New raw vegetation compilation must still pass its own source gates. The full source build reapplies the dated cuts; the bounded vector refresh requires no reconstructed raw terrain cache. The four shaded greens and detailed current facilities/equipment remain unapproved.

## Historical handoff — 2026-09-07

The later mapping/placement iteration is documented in the
[mapping README](README.md). It supersedes the first-pass counts below:
**110 playing polygons** (20 greens, 37 tees, 13 fairways, 40 bunkers),
**14 facility surfaces**, six restored golf paths, **29 parking polygons** and
**five measured roof TINs** (7,069 triangles). Two roofs remain explicitly
partial. Updated canopy exclusions have zero independently checked
building/road/path hits. Mapped/measured placement now suppresses procedural
ground cover, reeds and guessed range flags.

The new source inputs are `surface-refinements-2019.json`,
`facility-traces-2019.json`, `facilities.geojson`, `infrastructure.geojson` and
`building-roof-meshes.json`, with separate generator and review files. Rebuild
stands whenever any of the six registered exclusion sources changes. The source
graph, pack and migration hashes from the original checkpoint are historical;
use the current reports and registries. The exact frame and 1 m DTM did not move.

Use `emit-manifest.mjs --only=lidingo` for a bounded pack-index refresh while
another course is being prepared. The shared workspace also contains ongoing
Visby work; preserve its unpublished files and registry changes.

Lidingö now opens as a **provisional 18-hole 3D course** at `?bana=lidingo`.
The default renders all 64 finest Lantmäteriet 1 m tiles and 64 measured canopy
stand tiles. `v2=require` verifies the same graph without silent fallback;
`v2=0` uses the checked 4 m compatibility terrain. The initial source-only map
remains at `?bana=lidingo&view=sources` for comparison.

The chooser and course label say **Preliminär 3D**. This implemented environment
is not a surveyed digital twin. Canonical origin, local accuracy, current surface
changes and individual-object approvals remain open in the
[source ledger](../../geo_data/course-v2/lidingo/source-manifest.json).
Changes are local and uncommitted; no remote deployment was performed. Preserve
concurrent Visby and other workspace work.

## Evidence and implementation

- [Club source dossier](../../docs/courses/lidingo-source-research.md): 128
  retrieved assets, 82 gallery photos, all 18 guide sheets and 18 flyover links,
  the current scorecard, rules and dated planning documents.
- [Geographic acquisition](../../geo_data/course-v2/lidingo/reference/README.md):
  exact endpoints, licences, coordinate systems, rasters and limitations.
- [Playing surfaces](playing-surfaces.geojson) and [review](playing-surfaces-review.json):
  90 valid polygons, with 41 observed CC0 2019 orthophoto traces and 49 retained
  supplementary OSM rings. There are 20 greens (18 associated), 29 tees (at least
  one associated with every hole), 13 fairways covering all 12 par 4/5 holes,
  and 28 bunkers. Two greens and one tee remain unassigned source context.
  The full current tee/bunker inventory is not complete.
- [Course builder](../build-course.mjs) and
  [graph compiler](../../packages/course-v2/compile-lidingo-ground-graph.mjs):
  exact projected model, preserved terrain and water levels, observed surfaces,
  OSM infrastructure, official card, fallback heightfields and immutable graph.
- [Runtime contract](runtime-contract.json) and
  [frontier config](../../apps/golf/src/engine/v2-lidingo-config.mjs): exact
  bridge, bounds, tile counts and legacy CORE omission.
- [WebGPU proof](3d-validation.json), [WebGL2 proof](3d-validation-webgl.json),
  [source-preview proof](app-validation.json) and [surface review](playing-surfaces-review.json).
  Raw state and screenshots live under ignored `lidingobuild/cache/review/`.

The official card is par 70, out 33/in 37. Vit/Gul/Blå/Röd/Orange total
5786/5373/5058/4518/3965 metres. All 90 distances, indices and totals reconcile.
Protected club media stays local; the application distributes factual card
values and source-derived vectors, not the downloaded photos or guide sheets.

The fine raster contains 4,198,401 finite RH 2000 samples from DTM item `658_67`:
2049×2049 at 1 m, northwest sample E676676.5/N6587423.5. Its SHA-256 is
`80ffcd4865daa00f8e2393f43b8fcb1b37e020f968c0656a0189f80dde1de923`.
The provisional render origin is E677700.5/N6586399.5/H−0.05; fingerprint
`8b9f61aba7ef3d78a14219d10ba79ce09322ac947c52a4f1551acc9c4447a7d6`.
The compatibility model uses those exact horizontal offsets and absolute
RH 2000 heights. No fitted geoid or convergence offset is invented.

An 8192 m context square uses 66,049 acquired DTM samples at 32 m from four
Lantmäteriet items. Seven clipped water components retain source RH 2000 levels
0.1, 4.72, 14.05, 22.35 and 26.02 m. Coastal fragments are bounded water meshes;
their acquisition edges do not establish a sea horizon or underwater depths.

Laser campaign `21c031-658_67`, captured 2021-03-23, supplied 11,677,559 interior
non-noise returns through bounded COPC reads. Four 2048² rasters retain canopy,
ground and return counts, including explicit voids. The 64 measured 4 m stand
chunks total 581,057 bytes. Exclusions include playing surfaces, buildings,
roads, paths, range, railway, streams and national water. There are **zero
individual-tree records**; the runtime draws 46,121 stand representatives.
Their species and individual stems are not surveyed.

## Preserve these invariants

- Never extend routes to match scorecard distances. Source vertices and card
  lengths remain separately sourced facts.
- Tee pads are observed polygons with `inferPads:false` and `preserveTerrain:true`.
  Colour starts are nominal camera references on observed platforms;
  `objectPlacement:'mapped-only'` suppresses physical colour markers and inferred
  furniture. Rendered flags are virtual targets, not daily cup locations.
- `infra.terrainPlacement:'measured-only'` bypasses synthetic greens, bunker
  dishes, water beds, water-level remeasurement, clubhouse benches and noise in
  both rendering paths. Water depth-buffer bias does not move its source plane.
- `infra.vegetationPlacement:'measured-only'` suppresses the legacy near/middle
  tree lattice, including fallback. Canopy voids do not acquire invented trees.
- `preserveMappedBoundaries:true` keeps observed polygons. OSM footprints have
  provisional generic heights/widths where tags lack measured dimensions.
- The municipality's 2019 WMS is CC0, confirmed by official distribution
  metadata. The separate public national-imagery WMS has unresolved derivative
  terms/date. The identified 2025 national download still returned 403.
- Raw text snapshot identities are retained by scoped `.gitattributes` entries;
  source-ledger logical text checksums use the repository's LF convention.

## Rebuild and verify

Run from the repository root with retained ignored caches. Reacquisition
commands are in the geographic README. Python needs Pillow, Shapely and pyproj.
The real local interpreter below does not replace vertical/geoid controls.

```powershell
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path 'upsalabuild/cache/review-venv/Scripts/python.exe').Path
& $env:COURSE_GEO_PYPROJ_PYTHON lidingobuild/mapping/build-playing-surfaces.py
node packages/course-v2/compile-lidingo-terrain.mjs
node lidingobuild/build-course.mjs
node lidingobuild/update-source-manifest.mjs
node packages/course-geo/migrate-legacy.mjs --write --ground lidingo
node packages/course-pack/emit-pack.mjs lidingobuild apps/golf/public/courses/lidingo lidingo
node packages/course-pack/emit-manifest.mjs --only=lidingo
node packages/course-v2/vegetation/compile-lidingo-stands.mjs
node packages/course-v2/vegetation/review-lidingo-stands.mjs
node lidingobuild/update-source-manifest.mjs --runtime-validated
node packages/course-v2/compile-lidingo-ground-graph.mjs
npm run build --prefix apps/golf
npm run check:lidingo
npm run check:geo-sources
npm run check:course-v2-app
```

For changed geometry, inspect and update the pinned model/migration hashes in
`hole-source-controls.mjs` and `hole-source-inventory.mjs`, and compare the
produced CORE with `v2-lidingo-config.mjs`. Never bypass stale-source gates.
The graph rejects stands built against changed source bytes. Keep the initial
staging report separate from the later published graph report.
`--runtime-validated` records the completed software gate, not survey approval.

```powershell
node tools/serve.mjs apps/golf/dist 8634
# In another terminal:
$env:BANVY_GPU = '1'
node tools/check-app.mjs http://127.0.0.1:8634 --only=lidingo
node tools/check-course-v2.mjs http://127.0.0.1:8634 --course lidingo
node lidingobuild/check-runtime.mjs http://127.0.0.1:8634
node lidingobuild/check-runtime.mjs http://127.0.0.1:8634 --gl
node tools/check-lidingo-intake.mjs http://127.0.0.1:8634/
npm test
git diff --check
```

At the original checkpoint the full suite passed 509 Vitest and 360 Node cases,
with two configured skips. These are historical baseline results. The later
iteration's validation and concurrent Visby build limitation are recorded in the
[mapping README](README.md#validation-scope-for-this-iteration).
The following browser paragraph describes the original checkpoint:
Both browser backends pass
13 measured-source checks against the final graph: 100 true terrain probes
(maximum error 0.00480 m), seven unchanged water levels, no carved beds,
64 stand tiles, zero individual records and zero legacy vegetation leakage.
Card, tee-platform, source-preview mobile/offline and graph integrity checks
also passed. Daylight overview and hole 7/12/18 views were inspected. A depth-bias
sign error and synthetic silt appearance found during backend comparison were
corrected; both backends now display the same source-preserving water surface.

The global source-control planner includes Lidingö's 18 holes across 25 unique
control windows and 86 hole/window references. Repository totals are 162 holes,
220 windows and 797 references; Visby remains explicitly pending. Planned
windows do not establish completed independent survey controls.

## Next evidence work

1. Acquire current licensed imagery or club as-built GIS and independent
   EPSG:3006/RH 2000 controls. Measure residuals and approve the permanent origin.
2. Check recent changes: hole 13's 2025 bunker, hole 17's 2024 bunker, mowing
   on 10–13/16, orange tees, 17/18 planting, practice greens, range nets and
   drainage. The rear hole-10 tee differs in the newer undated public image.
3. Complete tee/bunker inventories and reviewed zone-A objects. Fairway 13 is
   a conservative central patch; the par-3 hole-16 approach has no reliable
   fairway edge in 2019 and has not been invented.
4. Review present canopy against the 2021 scan. Obtain real observations before
   publishing individual trees, signs, fences or bridges.
5. Complete controlled surface intake and human per-hole visual approval before
   attaching authoritative surface tiles or closing the five remaining gates.
