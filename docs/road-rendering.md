# Road surface rendering

The shared renderer uses the terrain surface atlas for near-course roads,
access tracks and paths. Opaque road ribbons are drawn only outside that
coverage. Major asphalt roads retain lane markings through a transparent
overlay. Fallback ribbons follow the ground at each vertex with 3 cm of
rendering separation.

`road-surface.mjs` provides the material policy used by both terrain compilation
and fallback rendering. Explicit source materials take precedence. Untagged
local roads use the existing generic gravel display; they no longer acquire an
asphalt overlay. This extraction preserves the terrain compiler's previous
classification, so existing course packs do not need regeneration.

`road-material.mjs` reads vertex colours once. The previous material enabled
`vertexColors` and also read the colour attribute in `colorNode`; Three's node
material multiplied them together, making grey surfaces almost black. Asphalt
and gravel now use matte finishes and restrained grain.

Coverage splitting samples long source segments and clips their transitions,
including segments that cross the whole atlas without a source vertex inside.
Legacy special infrastructure still supports its previous grading behavior;
measured-only terrain retains its existing placement rules.

## Verification

Run the focused regression suite:

```powershell
npx vitest run apps/golf/src/engine/road-surface.test.mjs apps/golf/src/engine/road-draping.test.mjs apps/golf/src/engine/surface-features.test.mjs apps/golf/src/engine/paved-path-surfaces.test.mjs
```

The tests exercise the actual renderer's road collection and geometry builder,
coverage ownership, terrain placement, and material agreement across all 13
shipped course packs.

Reproduce local-road and main-road captures, with evening and midday lighting:

```powershell
$env:BANVY_GPU = '1'
node tools/check-road-rendering.mjs http://127.0.0.1:5173 output/roads veckefjarden,upsala,angso webgpu
```

The final argument also accepts `webgl2`. The harness saves screenshots and an
`audit.json`, and rejects runtime/shader errors, double-applied vertex colour,
opaque lane overlays, and road placement errors above 2 mm.

On 2026-09-13, the focused suite passed 30 tests. WebGPU captures on
Veckefjarden, Upsala and Angso had no page errors; sampled road geometry's
maximum placement error was 0.27 mm. The Veckefjarden before/after captures in
`output/roads-before` and `output/roads-after` show the black strips beside the
two red buildings replaced by the continuous terrain road surface.

## Parking and paved areas

Parking, path and asphalt atlas classes now use linear albedo once in all
three terrain material paths (legacy atlas, v2 pair SDF, v2 class SDF). The
previous squaring made asphalt parking almost black even after the road
ribbons were corrected. Natural ground retains its established colour response.
The `gravel` palette entry sets a subdued grey shared by the atlas, road
fallbacks, parking and paved facility aprons; it is separate from the older
`hard` tint still used in mixed natural ground.

Parking uses the same surface-ownership rule as other legacy overlays, so
requesting mesh mode cannot put another parking layer over active v2 terrain.
Fallback parking and hard facility footprints use the matte paving material.
Authored parking replacements continue to own their footprints.

The parking regression tests exercise the actual parking batch, including
terrain ownership, authored replacements, explicit asphalt and generic gravel.
The shared pack audit checks parking classification as well as roads on all
13 courses. The combined focused suite passed 54 tests on 2026-09-13.

```powershell
node tools/check-parking-rendering.mjs http://127.0.0.1:5173 output/parking upsala,tortuna,veckefjarden webgpu ghibli
```

The capture tool also accepts `webgl2` and `real`. Before captures are saved
in `output/parking-before`; final captures and runtime diagnostics are saved
in `output/parking-final`.
