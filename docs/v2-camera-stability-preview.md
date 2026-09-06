# V2 camera stability preview

Prepared 2026-09-06 against published main
[`8a864d5830adfccd0dde49e7518b6c89fd2227d7`](https://github.com/olovmelander/olovs-hemsida/commit/8a864d5830adfccd0dde49e7518b6c89fd2227d7).
Validated implementation checkpoint:
[`e90209e48eddcbb25b16409c1432dfb3ce4bbaa1`](https://github.com/olovmelander/olovs-hemsida/commit/e90209e48eddcbb25b16409c1432dfb3ce4bbaa1),
tree `37b0b27c25c10faf6775813953a370b5508949e7`.

## Change and scope

With active v2 and `graphics=1`, camera motion now finishes before terrain and
tree visibility are selected. Previously the frame selected visibility, then
advanced its transition, flight or controls, so rendering could look in a
different direction from the visibility calculation. The graph terrain adapter
already refreshes the camera matrices; placing it after motion lets trees reuse
that same current pose. The nongraph path explicitly refreshes its camera before
testing tree cells.

An accepted OrbitControls drag, pan, pinch or wheel gesture now cancels an
automatic camera transition. It also releases a flight or tour without starting
a return animation or changing the current position, target or lens. The next
named view restores the normal player lens after a flight takeover. Explicit
tour/flight exit retains its existing return behavior, and instant/reduced-motion
views remain immediate.

These are preview changes. Without `graphics=1` or active v2, the established
frame ordering and input behavior remain. The change does not alter damping,
camera presets, flyover paths/speeds, terrain, course packs, mapped objects,
tree populations, or fixed geographic tree detail zones. It adds no material,
shader, texture, geometry or render pass.

## Frame and input validation

384 Vitest tests pass, including 25 camera tests. The production Pages build,
app lint, v2 app isolation and all seven physical-ground source manifests pass.

The frame tests execute the application's actual frame functions with installed
Three.js cameras, OrbitControls, the existing ground clamp and the real graph
adapter update. Rendering, storage and unrelated UI operations are observed or
stubbed. They demonstrate the previous one-frame visibility delay and verify
the corrected current pose under classic WebGL2, reversed WebGL2 and reversed
WebGPU projection conventions. These are CPU correctness tests, not hardware
backend benchmarks.

| Frame contract | Result |
| --- | --- |
| Tween, flight and clamped control pose matches visibility | Pass |
| Current flight lens and hole reach the terrain planner | Pass |
| Active graph, nongraph and inactive-graph matrix handling | Pass |
| One terrain tick, visibility update and render per frame | Pass |
| Actual drawing-buffer height reaches the planner | Pass |
| Fixed/deterministic fade clocks and settled-frame counting | Pass |
| Resting camera poses and disabled ordering retained | Pass |

The existing terrain morph tick stays before the ground clamp. Fade clocks and
frame bookkeeping stay together with tree updates, preserving the two-rendered-
frame `settled()` contract. Shadow invalidation remains after visibility and tree
uploads. The active graph reuses its existing matrix refresh; the nongraph preview
adds one explicit camera-matrix refresh, without a scene render or allocation.

Eight gesture tests drive the installed OrbitControls event handlers; seven
additional tests execute the actual application camera functions. They cover
mouse, touch/pinch and wheel ordering, disabled controls/actions, inactive and
programmatic camera changes, flight/tour cleanup, current-lens preservation,
later named-view restoration, explicit exits and immediate views. The single
gesture listener runs only on accepted input and adds no per-frame callback.

## Built-app review

The [browser evidence](graphics/v2-camera-stability-check.json) records matched
Uppsala H1 overhead/noon settings and exact build identities. Both builds used
SwiftShader through automatic WebGL2 fallback, a 384 × 288 drawing buffer, DPR 1,
locked low quality, deterministic shader clocks and fixed tree zones. Course,
routing, tree-instance and tint fingerprints match, as do the camera/lens,
resident terrain inventory and renderer memory counters. Automatic quality
fallback did not lower the captured resolution or settings.

| Built-app observation | Baseline → candidate |
| --- | --- |
| Resting draw calls, sampled after each screenshot | 93 → 93 |
| Resting triangles, sampled after each screenshot | 1,153,299 → 1,153,299 |
| Renderer-tracked resource bytes | 311,711,567 → 311,711,567 |
| Original cached-shadow image parity | Failed: 349 of 110,592 pixels differ |
| Separate refreshed-shadow image parity | Pass: byte-identical PNGs |
| Browser mouse-drag and wheel takeover | Both candidate checks passed |
| Browser flight touch, tour pinch and later instant-view check | Incomplete: 180-second whole-scene deadline |

The baseline's earlier sample included a shadow refresh (118 draws and
2,088,689 triangles); comparing that with the candidate's resting frame would
misstate a transient difference as savings. The table uses the matched resting
samples. These counters do not measure FPS or total application memory.

Visual review found the changed pixels localized to shading near the right
edge, with a mean absolute channel difference of 0.0495 on a 0–255 scale. Source
review found that the terrain's wall-clock shadow invalidation window can expire
between slow software-rendered frames, leaving a cached shadow from an earlier
morph state. The original harness did not synchronize a fresh shadow.

A separate bounded diagnostic used the same builds and settings, enabled the
existing shadow auto-update after settling, waited two completed frames, captured
and restored cached mode. The resulting baseline and candidate PNGs are
byte-identical, with all data, camera, terrain, buffer and resource invariants
matching. Both diagnostic captures included a shadow pass (118 draws and
2,088,689 triangles). This supports cached shadow history as the source of the
original discrepancy; it does not measure production resting performance or
change the application's shadow policy. Reproduce with `--fresh-shadow` on both
runs of `tools/check-camera-stability.mjs`.

The original comparison remains recorded as failed. The candidate's original
overall browser run also remains failed because it reached its deadline during
the first CDP touch sequence.
Touch/pinch and lens handoff have source-level test coverage; that does not
replace a completed browser or physical-phone check. No lower-quality retry was
used to obtain a pass. This is partial software correctness evidence, with the
preview still opt-in for further visual and hardware review.

## Review and remaining performance checks

[Open the Uppsala camera preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&q=lo&hal=1&vy=tee&ljus=dag).
Switch between named views and drag or pinch during the transition; try taking
control of a flyover too. The view should stay where you take over and respond
to the gesture. For an exact old/new comparison, keep `graphics=1` on both
revisions so earlier appearance improvements remain enabled.

Real desktop WebGPU and phone WebGL2 performance remain unmeasured. Compare
median/p95/p99 frame times, moving-camera hitches, startup and total memory at
identical course data, quality, lighting, camera trajectories and actual drawing-
buffer dimensions. Check automatic quality fallback separately to ensure it has
not silently lowered resolution. Review Uppsala visually, Puttom's forest load
and Veckefjarden's water. Corrected moving visibility can legitimately change
which objects enter a frame, so a changed transient draw count is not itself an
FPS result. The preview remains opt-in pending hardware acceptance.
