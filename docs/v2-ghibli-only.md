# One supported presentation: v2 + Ghibli

The player always uses verified v2 terrain and the painted/Ghibli appearance.
Both WebGPU and its WebGL2 fallback remain supported, as do high/low quality,
lighting presets, seasons, accessibility and Hero + Impostor trees.

## Behavior

- The top-bar and navigation-drawer style switches are removed.
- Ghibli is the fixed player presentation. Saved realistic preferences are ignored.
  Historical visual flags are removed from links without losing course, hole,
  camera, tee, lighting, backend, quality or diagnostic settings.
- Every course must resolve its published v2 graph and a reviewed adapter.
  Puttom retains its verified v2 preview adapter for initial terrain resources.
  Graph, tile, vegetation and terrain installation failures report a boot error
  with retry guidance; they cannot rebuild the course using GPK1 terrain.
- Authored Ghibli tree assets are required. The player loads only Hero meshes
  and uses them to bake distant impostors. Full/Lite and alternative catalogues
  belong to isolated tree studies.
- Legacy played-surface overlays and the old turf/sand shaders in main.js are
  removed. Small authored surfaces use the painted material. The unused sand
  normal texture is no longer baked during startup.
- The build checks catalogue/graph/adapter coverage for every selectable course.
  Startup acceptance and tint baking target Ghibli on both device backends.

## Retained internal dependencies

GPK1 still transports routing, card information, placement and compatibility
height data; removing those files would break v2. The reviewed adapters and
surface-atlas representations likewise remain part of the v2 data contract.
Historical standalone pages and isolated material fixtures are not player
modes. This change does not alter surveyed geometry, course packs or manifests.
The production `material.js` always supplies painted shading. Historical
realistic finishes live in `src/studies/ground-material.mjs`; the two entry
points share surface classification and resource ownership through
`ground-material-core.mjs`, without importing study shaders into the player.

No turf-relief enhancement or geometric grass is introduced here. Prepared
sidecars continue to follow source-revision checks and regenerate in the runtime
when stale, as with other engine changes. No FPS gain is claimed from source
removal alone.

## Validation

Run the look-mode, routing and terrain-selection unit tests, the app tests,
`node tools/lint-app.mjs`, the production build and
`node packages/course-v2/check-app-build.mjs`.

On a GPU-equipped machine, `tools/check-course-v2.mjs` compares ordinary links
and historical opt-out links with a saved realistic preference: both must serve
verified v2 and report the painted look, with no style controls. Use
`tools/check-startup-gpu-courses.mjs` for all courses on WebGL2 low quality and
WebGPU high quality. Real-device appearance/FPS and offline acceptance remain
separate from source and build checks.

Implementation checks passed: all 961 app tests across 128 files (the two
source-fixture suites were rerun after restoring their sparse-checkout inputs),
app lint, syntax checks for changed JavaScript, the production build, and the
v2 build verifier for all 13 published courses. These checks do not establish
rendered appearance or hardware performance.

The Ribbingsfors browser gate also passed under SwiftShader for both ordinary
and historical opt-out links with a saved realistic preference: verified ring
terrain, painted style, no style controls, and published vegetation loaded.
This is behavioral evidence only; no appearance or FPS claim is made.

Merge validation against main `53ea008` retained Hero + Impostor trees and the
Visby bunker audit. The one conflict was in the removed legacy overlay block;
v2 bunker outlines and grass-island exclusions remain intact. All 991 app
tests and four Visby bunker tests passed, along with lint, the production
build and verification of all 13 published course graphs.

## Focused cleanup after the visual-mode merge

Starting from main `408a208`, the player no longer constructs procedural crowns,
trunks or a bark texture that its mandatory authored trees immediately replace.
Tree placement scales, authored normals/UVs, wind, seasonal tinting, geographic
Hero/Impostor policy and diagnostic tier slot numbering are preserved.

Fixed Ghibli branches now directly select their existing palette, atmosphere,
water and scenery values. Removed code also includes parking-overlay rendering,
unused fairway/semi-rough shade callbacks, the retired overlay-selection helper
an unused terrain-fallback state constructor, and the orphaned procedural crown
depth helper. GPK1 transport, reviewed
adapters, exact/pair surface representations and quality/backend controls remain.

`src/studies/tree-loader.mjs` owns alternative catalogues and Full/Lite loading.
The production loader requires painted foliage and only fetches Hero meshes.
Both loaders share verified GLB/atlas decoding; there is no duplicated decoder.
Study pages and historical relief fixtures use the explicit study entry points.

The production bundle module inventory excludes both study modules and the
retired procedural bark/trunk/crown helpers. Across all emitted JavaScript,
the cleanup removes 9,743 bytes minified (about 3.8 KB with gzip level 9).
This is a modest download reduction; eliminating discarded startup work and
making the supported path easier to maintain are the main benefits. It does
not establish a hardware FPS improvement.

Cleanup validation: 979 app tests across 128 files, four Visby bunker tests,
JavaScript lint, the production build and all 13 published-graph checks passed.
A deterministic Ribbingsfors WebGL2/low-quality boot matched the pre-cleanup
placement, matrix, tint and impostor fingerprints exactly, including when
opened through historical style flags. The Visby browser check passed Hero-only
asset requests, empty Full/Lite drawable tiers and single-owner tree slots in
both tee and overhead views, including the former downgrade request. These
browser checks used SwiftShader; hardware appearance and frame timing remain
unmeasured.

The historical DETAIL fixture also renders its full ten-view matrix with the
isolated realistic material. Its server now includes the required shared
material and bunker helpers, and its Three.js version gate checks the app's
pinned dependency instead of the superseded r185 literal.
