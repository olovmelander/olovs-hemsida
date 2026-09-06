# V2 performance recovery and default graphics

Prepared 2026-09-06 after the owner reported slower frames, startup, light/season
switches and a black canvas after the loading screen. The owner then explicitly
requested merging this work and making the improved graphics the default.

- Baseline: `798836684ac39f2587cfd189309b10cc330b817f`.
- Validated source checkpoint: `9ca4a00790f83f8d1ba082016e21b553ba238624`.
- Source tree: `34453c3193ab3d0760ec86cc58d723e742ea2b11`.
- Measurements: [performance recovery evidence](graphics/v2-performance-recovery.json).

## Changes

Ready v2 terrain now uses the improved graphics by default. `graphics=0` retains
the explicit comparison path. Course packs, mapped objects, geographic tree
detail zones, camera paths, quality selection, resolution, shadow-map sizes and
PMREM filtering/resolution are unchanged.

Lighting changes formerly replaced `scene.environment`, invalidating Three's
cached scene node builders even on a reflection-cache hit. The new controller
keeps that texture identity stable, renders the unchanged gradient into a
reusable staging PMREM, and uses the public texture-copy API to update the
displayed map. The baker's geometry, material and uniforms are reused too.
There is no additional steady-state draw, shader sampling or texture upload.

The cache now retains only the displayed preset. Switching back to another
preset rebakes the small environment and copies it; it no longer reconstructs
scene shaders. At most two reflection targets are owned. This tradeoff needs
real-device GPU checks, especially rapid alternation between two presets.

The loading cover now waits for the first submitted scene to finish on WebGPU
or WebGL2, then a presentation opportunity. WebGL2 uses an asynchronous fence,
not a blocking `gl.finish()`. A stalled or lost GPU reports failure under the
cover. This removes the premature blank-canvas exposure; it does not pretend
that hiding the cover earlier made startup faster.

Repeated immutable terrain plans bypass resource validation and buffer
reconstruction; settled batches skip their tile loop. New resources, morphs,
rewound review clocks and morph-duration changes still update correctly.
Geographic and forced tree tiers skip unused per-tree distance calculations.
The FPS counter uses the actual frame interval; camera movement still uses its
existing bounded time step.

## Available measurements

The isolated WebGL2 test uses SwiftShader, seven objects, 160×120 pixels, DPR1,
MSAA4 and the same materials/palettes on both revisions. It captures nine views
across all five presets, including repeated selections.

| Observed work | Before | After |
| --- | ---: | ---: |
| Scene node builds across eight switches | 16 | 0 |
| All node builds across those switches | 23 | 0 |
| PMREM bakes including startup | 8 | 9 |
| Differing pixels in nine matched images | — | 0 |
| Final renderer-accounted bytes, isolated scene | 25,539,657 | 25,552,035 |

The 12,378 additional retained bytes keep the baker reusable. These are renderer
counters, not total app/browser memory. GPU targets stop being reallocated on
switches; the candidate allocated two over the whole sequence.

The CPU-only terrain benchmark uses the actual revision classes with 277 frozen
synthetic 3×3 resources, a 320-slot capacity, six warmup batches and 30 alternating
A/B batches of 200 settled tick-plus-sync iterations. Median CPU time per
iteration was **0.181 → 0.040 ms**, with identical final buffers. This measures
one component; it is not a scene frame-time or FPS measurement. The report's
p95 describes batch means, not slow scene frames.

The Uppsala baseline dismissed the loading cover at frame **0**. The candidate
kept it until frame **10**, after GPU completion: submitted at 32,369.0 ms, GPU
ready at 32,759.4 ms, cover released at 32,774.4 ms in that software run. Absolute
software startup timings are not phone/desktop hardware evidence.

Matched full Uppsala runs passed at 384×288, DPR1, low quality locked, geographic
tree zones and WebGL2. The default noon view, autumn switch and return to noon
are pixel-identical to the baseline. Model, routing, tree instances, tint rasters,
terrain inventory, camera and lens fingerprints match. Resting work remains
93 draws and 1,153,299 triangles. Before switching, retaining the baker adds
12,378 renderer-accounted bytes. After switching, avoiding scene reconstruction
also avoids the baseline's growth in attribute allocations:

| Full Uppsala renderer-accounted memory | Before | After |
| --- | ---: | ---: |
| Initial noon view | 309,533,072 B | 309,545,450 B |
| Switch to autumn | 403,690,625 B | 318,982,634 B |
| Return to noon | 488,453,761 B | 318,982,634 B |

The baseline's attribute bytes grow from 177,392,555 to 346,918,827 over those
two switches. Candidate attribute bytes remain at 177,392,555. These are Three's
resource counters, not a physical-device VRAM or total-browser-memory reading.

Earlier attempts used the invalid URL camera alias `vy=top`, booted an unintended
orbit view, and timed out during settle/capture. Both revisions were rerun using
the app's actual `vy=ovan` alias. Those failed attempts remain recorded in the
evidence; their timings/images are not used as the matched comparison.

405 tests, the Pages production build, app lint, v2 build isolation and source
manifest validation passed. The existing terrain/shadow work checks preserve
final buffers and shadow correctness.

## Remaining device checks

Desktop WebGPU and physical phone WebGL2 remain separate open checks. Compare
median/p95/p99 frame times, camera-motion hitches, startup to the first useful
view and total memory. Include first and repeated day/autumn switches, plus
rapid two-preset alternation. Use Uppsala for appearance, Puttom for forest load
and Veckefjarden for water. Match camera paths, lighting, course data and actual
drawing-buffer dimensions; `qualitylock=1` prevents automatic resolution changes
during the comparison. Software rasterization does not establish real-device FPS.

Reproduce the local checks with:

```sh
node tools/check-lighting-reuse.mjs --baseline 798836684ac39f2587cfd189309b10cc330b817f --out /tmp/lighting
node tools/check-terrain-idle-work.mjs --baseline 798836684ac39f2587cfd189309b10cc330b817f --out /tmp/terrain-idle.json
node tools/check-camera-stability.mjs --root apps/golf/dist --out /tmp/app-default --graphics-default --preset-switches
```
