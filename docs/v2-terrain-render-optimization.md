# Terrain render optimization — 9 September 2026

This implements the P0 ring-terrain item in the [graphics improvement guide](v2-graphics-improvement-guide.md). It needs no Blender or new assets. The aim is less GPU terrain work with the finest available course surface preserved. It is a performance foundation for subsequent material and lighting improvements, not a new visual style.

Visby's subsequent phone report is investigated in [the WebGL2 coastal depth follow-up](visby-webgl-water-distance.md). Native-terrain captures also reproduce distant water breakup: the sea sheet competes with the laser water surface independently of grid simplification. The follow-up masks redundant underwater terrain in verified sea interiors. Low-quality framebuffer resolution is a separate source of landscape softness.

**24 September update:** the reduced grid is no longer a phone default. Every device and backend draws native grids; see [below](#24-september-phones-draw-the-desktop-terrain). The sections after it describe the 9 September pilot, which `?terrainStride=2` still reproduces.

## 24 September: phones draw the desktop terrain

The owner asked for the 1 m terrain on phones as well. Terrain detail no longer depends on quality, device or backend ([`terrain-detail.mjs`](../apps/golf/src/engine/terrain-detail.mjs)):

- Every tile is drawn at its native grid. A coarser level is drawn only while it stays within **one pixel** of the finer surface on screen, and the frontier may hold **128 tiles**.
- Before, low quality on WebGL2 drew refinable levels at half density within 1.5 px and capped the frontier at 56 tiles; low quality on WebGPU capped it at 56; WebGL2 desktops accepted 1.5 px. High-quality WebGPU is unchanged.
- The active hole's tiles are still always 1 m, and CPU heights still come from the 1 m source and rings.
- Low quality keeps its own streaming: two concurrent requests, a smaller cache of unused tiles and a tile texture that grows with the frontier in groups of eight, the path the reduced grid already used. The desktop reserves all 128 native layers up front, 67.6 MB on the CPU and again on the GPU, which would be most of the [96 MiB pilot phone texture budget](v2-graphics-improvement-guide.md#8-performance-budgets-and-quality-tiers); the phone runs below reached 25–34 MB, most of it grown by the construction-time plan.

The reduced grid did not make phone views lighter. The planner adds each simplified parent's measured error to its budget and refines it into full-density children, so close views drew more tiles, and the parents it kept stayed above one pixel. Veckefjärden at 412 × 915, WebGL2, low quality locked, draw calls skipped under SwiftShader (counts, not frame rate):

| Veckefjärden, phone | Before | Now |
| --- | ---: | ---: |
| 1st tee: tiles (1 m) / terrain triangles | 28 (20) / 3.73 M | 28 (19) / 3.73 M |
| 9th orbit: tiles (1 m, half density) | 40 (30, 3) | 32 (20, 0) |
| 9th orbit: terrain triangles / largest error | 5.03 M / 1.54 px | 4.26 M / 1.07 px |
| 14th tee: tiles (1 m, half density) | 28 (11, 7) | 25 (11, 0) |
| 14th tee: terrain triangles / largest error | 3.03 M / 1.67 px | 3.33 M / 0.97 px |
| Flyovers 1 / 9: terrain triangles per frame, median | 4.33 / 5.26 M | 4.13 / 3.86 M |
| Flyovers 1 / 9: peak | 5.29 / 5.99 M | 4.79 / 4.79 M |
| Flyovers 1 / 9: largest error per frame, median (p90) | 1.59 (2.53) / 1.46 (1.70) px | 1.02 (1.14) / 1.06 (1.14) px |
| Tile texture reserved | 17–28 MB | 25–34 MB |

The largest error is taken over the drawn tiles that have finer children; a leaf is already the finest data at its place, such as the 1 m tile under a tee camera. The overhead view draws the same six 1 m tiles either way. Where the reduced grid drew more 1 m tiles (the 9th orbit, the 9th flyover), it was refining around its own half-density parents; the new frontier's 2 m tiles there stay within a pixel of the 1 m surface. One pixel allows 15% hysteresis, hence the 1.14 px.

A 1920 × 1080 desktop at one pixel draws 46–59 of its 70–79 tiles at 1 m in the same tee and orbit views; it sees more ground across its wider screen, and selects the same levels at the same pixel error. One pixel is measured in the pixels the canvas draws: low quality renders at device pixel ratio 1, so a phone refines as a desktop of the same CSS height does. Physical-phone frame rate and memory remain unmeasured, and the WebGPU phone path was not run here. Evidence: [graphics/phone-terrain-1m-2026-09-24](graphics/phone-terrain-1m-2026-09-24/).

## Policy

The parent-linked graph adapter now consumes `renderStride`. Low-quality WebGL2 already requested stride 2; that request now reaches the runtime. High-quality WebGL2 and WebGPU keep stride 1 by default. `terrainStride=1` or `terrainStride=2` provides a reversible comparison on either backend.

Only tiles with four finer children are eligible for a 257 × 257 to 129 × 129 render grid. Every leaf stays full resolution, including leaves in distant rings. Shell and unsupported small grids keep their original geometry. Existing active-hole requirements, quality budgets and geographic selection remain in force.

The simplifier measures the maximum difference from the original triangulated mesh at every source vertex and adds it to the tile's source error for screen-space selection. Both triangulations share aligned diagonals, so these vertices bound the surface difference. The planner can recover finer children when the added error matters. This remains subject to the existing tile budget; it is not a promise that every distant tile meets a hard screen-error ceiling.

## Height and transition correctness

- Full source payloads and CPU height queries remain at their original resolution. The source manifests, terrain chunks, routing, surface masks and object coordinates are not rewritten.
- Kept render vertices retain their source normals and fine world heights. Existing edge skirts remain present.
- Children wait for their already-requested parent resource and reconstruct morph targets from that parent's actual rendered triangles. They do not start another transport. A real-data regression found a 0.76 m mismatch when an Upsala coarse child reconstructed its parent only from its own samples; the implementation now uses the actual parent.
- If a parent lies below the child's encoded height offset, both packed height channels shift by whole quantization steps. This preserves the fine world heights and prevents negative targets from wrapping or clipping. An unrepresentable range fails explicitly.
- Native and reduced grids use separate shared batches. Compact batches grow in groups of eight, preserve existing morph clocks during growth, and dispose an unused grid batch. The combined rendered tile count remains bounded. A mixed frontier can require two regular terrain draws instead of one.

Source resources remain available alongside the derived render views. Reduced texture storage per tile is not a claim of lower total CPU memory or download size. Capacity depends on camera history, and allocations/upload spikes need device measurement.

## Work reduction

| One terrain tile, including skirts | Native | Reduced | Reduction |
| --- | ---: | ---: | ---: |
| Grid samples | 257 × 257 | 129 × 129 | 74.8% |
| Triangles | 133,120 | 33,792 | 74.6% |
| Packed height/normal bytes | 528,392 | 133,128 | 74.8% |

The final Upsala H1 tee capture at 320 × 240 rendered 23 native and 11 reduced tiles: 3,433,472 streamed-terrain triangles. Rendering those same 34 tiles natively would require 4,526,080 triangles (24.1% fewer with the optimized grids). This is arithmetic for the same selected tiles, not a separately captured native-policy baseline.

![Upsala H1 tee, low WebGL2, optimized terrain](graphics/terrain-stride-2-upsala-tee-2026-09-09.png)

These are exact per-tile counts, not whole-scene or frame-rate gains. Preserving leaves intentionally limits savings in close course views. An overhead view containing only native leaves saves no terrain triangles.

## Validation

The regression coverage includes unchanged CPU heights, fine vertex heights and normals, triangle interpolation, error budgets, shared edges, below-offset parent targets, parent/child transitions against published Upsala/Lidingö/Visby tiles, out-of-order loading, mixed grid budgets, batch disposal and morph-preserving growth. Runtime tests exercise both backend profiles; browser captures are separate shader/rendering evidence.

The final source passes **533 Vitest tests and 404 Node tests**, with three Node skips. The production build, all 11 published-graph build isolation checks and the renderer proof build pass. Full-app Upsala H1 tee captures pass on both WebGL2 and WebGPU at 320 × 240. The isolated native/mixed-grid proof also passes on both backends.

Validation results and capture provenance are recorded in [the evidence summary](graphics/terrain-render-optimization-2026-09-09.json). Software rendering establishes correctness and submitted workload only. It does not establish phone or older-desktop FPS.

## Reproduce and release checks

Install the root dependencies and the separately documented COPC reader dependencies for the full Node suite:

```sh
pnpm install --frozen-lockfile
npm install --prefix packages/course-geo/copc-reader
pnpm exec vitest run --maxWorkers=2 --testTimeout=30000
pnpm test
pnpm --filter @banvy/golf exec vite build --emptyOutDir
node packages/course-v2/check-app-build.mjs
node packages/course-v2/check-renderer-build.mjs
```

The explicit Vitest timeout is useful on a CPU shared with SwiftShader. The normal repository test command keeps its original timeout.

Capture matched cameras with the same viewport, backend, quality, graphics setting and device pixel ratio:

```sh
node tools/v2-graphics-review.mjs --root apps/golf/dist --course upsala --backend webgl2 --q lo --graphics 1 --terrain-stride 1 --views 1:tee:noon,1:top:noon --width 640 --height 480 --out /tmp/terrain-native
node tools/v2-graphics-review.mjs --root apps/golf/dist --course upsala --backend webgl2 --q lo --graphics 1 --terrain-stride 2 --views 1:tee:noon,1:top:noon --width 640 --height 480 --out /tmp/terrain-reduced
```

Use `--backend webgpu` for WebGPU and `--auto-fallback` for its automatic WebGL2 fallback. A current Chromium executable may be supplied with `--chrome`. The standalone `v2-terrain-proof.html?terrainStride=2` also exercises native and reduced grids together; append `&gl=1` to force WebGL2.

The general graphics harness's `--compare` requires identical terrain inventories, so it intentionally rejects a stride comparison. Compare its mapping fingerprints, cameras, buffer dimensions and terrain stream statistics directly. Mesh dimensions and morph payload identities are expected to change. Use `terrain.stream.triangles` and batch capacities; whole-renderer frame counters can include an intermittent shadow refresh.

Before promoting the pilot, inspect tee, green, overhead and moving-camera transitions in Upsala, Lidingö and coastal Visby on an actual phone and an older desktop. Check water, tree and grass contacts and mixed-grid boundaries. Measure median/p95/p99 frame time and memory during view changes. Keep WebGPU's default native policy until its device evidence supports a change. No hardware speedup or deployment is claimed by this branch.
