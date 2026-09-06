# V2 terrain settling and shadow stability

Prepared 2026-09-06 against main
[`2976a4ff1d26abbac27751c8a613cd91c81186f0`](https://github.com/olovmelander/olovs-hemsida/commit/2976a4ff1d26abbac27751c8a613cd91c81186f0).
Validated implementation checkpoint:
[`6002140f3b82d83383685f969cd2ea0f17775515`](https://github.com/olovmelander/olovs-hemsida/commit/6002140f3b82d83383685f969cd2ea0f17775515),
tree `f3bdd4ca6c05736f82b243432209c4d5f6305661`.
Exact source and built-asset hashes are recorded in the
[validation evidence](graphics/v2-terrain-shadow-stability-check.json).

## Changes

Every terrain batch now advances each tick. Previously an accumulating `||=`
could skip later calls once an earlier batch reported an unfinished morph.
The aggregate still reports whether any batch is morphing, while each batch's
actual instance parameters reach its final shape.

Terrain attributes now use their explicit dirty flags instead of
`DynamicDrawUsage`. Origins, scale and morph parameters are compared in Float32
precision, matching the values sent to the GPU. Changed buffers upload normally;
settled buffers keep their versions. This also removes the two temporary arrays
per rendered tile per tick. Topology, transforms, texture contents, buffer sizes
and allocation counts are preserved. These batching correctness and upload fixes
apply to the shared v2 runtime.

With active v2 and `graphics=1`, terrain shadow invalidation follows a render
revision that changes with texture payloads, instance parameters or draw counts.
This catches the final zero-morph buffer even when a slow frame skips the old
240 + 80 ms timer window. The decision reads the revision after visibility has
synced, including a frontier change later than the frame's initial terrain tick.
Graph and retained-frontier v2 terrain use the same rule.

The preview also finishes scene changes with one settled shadow refresh. It waits
until the renderer has consumed the preceding request; a paused capture cannot
discard the follow-up. New changes coalesce into the existing per-frame shadow
request. Sun movement, tree uploads/fades and flights retain their invalidation,
and ordinary resting frames still use the existing 60-frame fallback. The
disabled graphics path retains its timer policy.

The change preserves shadow map dimensions, filtering, fitted sizes, texel snap,
normal bias, lighting, camera routes, course packs, mapped objects and fixed
geographic tree detail zones. It adds no shader, texture, geometry or render
target. It does add necessary refreshes when the old cache would have retained
an incomplete view, so unchanged FPS cannot be inferred from the code.

## Regression and render-work validation

399 Vitest tests pass, including 15 new cases. They exercise real terrain buffers
and the application's actual shadow function: independent batch timing, Float32
dirty tracking, payload replacement without a count change, reordered instances,
empty frontiers, layer replacement, long frames, graph/pilot paths, disabled
behavior, sun/tree/fade/flight invalidation and pending render requests.
The production Pages build, app lint, app isolation and all seven source manifests
pass.

The reproducible work check runs both revisions' actual terrain classes and
shadow functions, plus the installed Three r185 `Attributes` manager with observed
backend callbacks. It uses a synthetic 16-tile fixture and excludes allocations.
It is not a full-course GPU or timing benchmark.

| Scenario | Shadow requests before → after | Attribute updates before → after |
| --- | ---: | ---: |
| 23 frames, 16 ms apart, including a 240 ms morph | 20 → 17 | 46 → 15 |
| Slow frame sequence: 0, 120, 1000, 1016, 1032 ms | 2 → 4 | 10 → 2 |
| 60 settled frames after warm-up | 1 → 1 | 120 → 0 |
| Same-count payload replacement, then 23 frames | 20 → 2 | 46 → 0 |

The slow-frame baseline leaves its shadow behind the final terrain state; the
candidate refreshes the final shape and its settled follow-up. All scenarios
end with matching terrain/geometry fingerprints, instance-buffer sizes and
texture capacities. Attribute counts cover one manager visit per instance buffer
per frame; actual render passes can revisit attributes. They are observed manager
callbacks, not measured GPU transfers, driver timings or FPS. The payload-change
case still uploads its changed terrain texture; the zero counts there refer only
to unchanged instance attributes.

Reproduce:

```sh
node tools/check-terrain-shadow-work.mjs \
  --baseline 2976a4ff1d26abbac27751c8a613cd91c81186f0 \
  --out /tmp/terrain-shadow-work.json
node tools/check-camera-stability.mjs --root apps/golf/dist \
  --out /tmp/terrain-shadow-browser --check-shadow-cache
```

## Built-app comparison

Both exact builds completed the same bounded Uppsala H1 overhead/noon visit in
Chromium using SwiftShader WebGL2 fallback: 384 × 288 actual drawing buffer,
DPR 1, locked low quality, `graphics=1`, deterministic shader clocks and fixed
tree zones. Each visit first captured ordinary cached shadows, then temporarily
enabled the existing shadow auto-update for a fresh reference and restored
cached mode. Resolution, quality, camera and terrain stayed fixed throughout.

| Observation | Baseline → candidate |
| --- | ---: |
| Cached image versus fresh reference, changed pixels | 349 → 0 |
| Ordinary resting draw calls | 93 → 93 |
| Ordinary resting triangles | 1,153,299 → 1,153,299 |
| Renderer-tracked resource bytes | 311,711,567 → 311,711,567 |

The candidate's ordinary cached PNG is also byte-identical to the baseline's
fresh reference. Course/routing/tree/tint fingerprints, camera/lens, resident
terrain inventory, visible tree tiers and renderer memory counters match.
The candidate reaches zero morph in all drawn tiles, records the current shadow
revision with no settled refresh pending, and its live buffer versions remain
unchanged between cached and fresh captures. Both visits have zero reported
page/shader/request errors; the baseline's overall image check remains failed
because it reproduces the bug. These counters do not measure total app memory
or prove unchanged FPS.

An intermediate local implementation that tracked terrain revisions alone still
produced the 349-pixel mismatch despite settled terrain buffers. Its failed result
is preserved in the evidence. The final one-frame follow-up closes this observed
cache discrepancy; no claim is made that the original wall-clock window was its
only cause.

## Device acceptance

[Open the Uppsala v2 preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&q=lo&hal=1&vy=tee&ljus=dag).
Review terrain and shadows after loading, moving and stopping. Repeat for Puttom's
forest and Veckefjarden's water.

Real desktop WebGPU and phone WebGL2 performance remains unmeasured. Compare
median/p95/p99 frame times, moving-camera hitches, startup and total memory on
the same course data, quality, lighting, camera trajectory and actual drawing
buffer. Use `qualitylock=1` for a controlled pair, then separately confirm normal
automatic fallback does not lower resolution. Phone touch/pinch and flyover
takeover from the preceding camera pass still require real-device review.
The graphics preview remains opt-in pending those checks.
