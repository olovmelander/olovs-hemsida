# One supported presentation: v2 + Ghibli

The player always uses verified v2 terrain and the painted/Ghibli appearance.
Both WebGPU and its WebGL2 fallback remain supported, as do high/low quality,
lighting presets, seasons, accessibility and the existing tree quality tiers.

## Behavior

- The top-bar and navigation-drawer style switches are removed.
- Ghibli is a compile-time constant. Saved realistic preferences are ignored.
  Historical visual flags are removed from links without losing course, hole,
  camera, tee, lighting, backend, quality or diagnostic settings.
- Every course must resolve its published v2 graph and a reviewed adapter.
  Puttom retains its verified v2 preview adapter for initial terrain resources.
  Graph, tile, vegetation and terrain installation failures report a boot error
  with retry guidance; they cannot rebuild the course using GPK1 terrain.
- Authored Ghibli tree assets are required. Their quality tiers and procedural
  helpers remain internal, but there is no procedural-tree mode.
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
The realistic shader utility in material.js remains for isolated historical
fixtures; the production player always passes the Ghibli look.

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
