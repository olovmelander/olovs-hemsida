# Handoff — trees on the 3070: LOD transitions and LiDAR placement (2026-09-03, evening)

Stopped at the owner's request, mid-way. This file is the resume point: what
was asked, what is measured, what is built, what is gated and what is not, what
the two background agents were doing, and the order to continue in.

> **2026-09-04, morning:** the LOD half of this handoff is done — resume points
> 3–6 below are complete (commits a3159f3 … f95011a on `claude/tree-lod-phase-1`;
> the plan's status sections carry the numbers). The two placement agents were
> cancelled with the session that started them and were NOT relaunched; their
> partial work is still on `claude/stand-crowns` (one commit) and in the
> `claude/vegetation-data` worktree (uncommitted: a build-canopy extension,
> lattice.json, two small modules). Resume points 7–8 are the placement work.
> Another session is editing this checkout concurrently (an uncommitted caddie
> feature in main.js, menu.js, index.html) and rebuilds `apps/golf/dist`; measure
> from an isolated worktree build, never from the shared dist.
>
> **Later the same morning:** the owner still saw the trees change while moving; the
> answer is commit 20a17f3 — the course corridor keeps its detail by where it is
> (zone A hero within 500 m, full within 900 m; zone B full within 900 m), so
> nothing on the course switches as the camera moves; `?lodpin=` and `?lodreach=`
> tune it. The plan's last status section has the numbers.

## The ask

Three things, on the RTX 3070 Laptop GPU that is now available:

1. The tree LOD switches show: "the trees change too much in the close
   distance when moving the camera".
2. The lower-detail tiers should start further away than 110 / 40 / 14 px.
3. "Perfect placement and height of all trees on the golf course and in the
   surrounding environment", continuing `docs/puttom-v2-lidar-tree-placement-plan.md`
   with best-in-class methods.

## Where things stand, in one table

| stream | state | branch / place |
|---|---|---|
| Phase 0 on hardware (measure) | **done** for boot, tier counts, fingerprint; frame time per view NOT measured (no tool yet) | this file, `docs/specs/boot-gpu-baseline-2026-09-03.json` |
| Crossfade + per-tree tiering (phase 4 machinery) | **built, checkpointed, partly gated** — thresholds unchanged | commit `45e2d78` on `claude/tree-lod-phase-1` |
| Threshold sweep (the "further out" ask) | **not started**; the hooks exist (`?lodpx=`, `V3D.setTreeLodPx`) | — |
| Pop meter and frame-time tools | **not written**; page hooks for them exist | spec in `docs/specs/tree-lod-hardware-harness.md` |
| Stand crowns (every laser apex planted where the laser saw it) | agent in a worktree; **one commit** (the chunk format + touch points) | `claude/stand-crowns`, `.claude/worktrees/agent-ae18740e4e698fe70` |
| Coverage to ±2 km + species prior (data stage) | agent in a worktree; **no commit yet** | `claude/vegetation-data`, `.claude/worktrees/agent-af767e697668ea189` |
| Five reviewed design specs | copied into the repo | `docs/specs/` |

Local `main` is stale (it still points at the initial commit); **`origin/main` is
at 9873e0f**, where another session merged this branch as PRs #8 and #9. That
session was committing to `claude/tree-lod-phase-1` at the same time as this one
(Banvy blueprint, weather and rangefinder modules, the navigation drawer), which
is why the checkpoint below is a separate commit and why line numbers in the
specs are stale by 100–200 lines: **anchor edits by grep string, never by line.**

## Measured today on the 3070 (WebGPU, 1600×900, `?bana=puttom&det=1&v2=require`)

| | before (HEAD ba25f06) | after checkpoint 45e2d78 |
|---|---|---|
| boot, wall | 17.9 s (16.5 s page clock) | 12.6 s |
| first frames after boot | 1102 ms, 22, 2226 ms (pipeline compiles), then ~14 ms | 842 ms, 18, 1802 ms, then ~11.5 ms |
| trees / vista / draws | 79,407 / 57,652 / 56 | same |
| fingerprint (trees, treeInstances, tintNear, tintFar, counts) | 7a1ca7b1… / 972ad223… / 687fb9a0… / 7b3619f8… | **identical** |

The "~14 ms" and "~11.5 ms" are CPU wall times of `frame()` from
`BOOT_PERF.firstFrames`, at the boot view only, and the rAF is vsync-locked in
the harness — they are not GPU frame times. The spec says how to get real ones
(`?gputime=1` + `V3D.gpuTime()` + an uncapped launch); nothing has run yet.

Tier counts per view on the GPU are identical to the SwiftShader numbers in
`docs/tree-lod-plan.md` (5th tee noon 189/1970/8334/2882; 1st tee golden
191/494/8023/4575; 7th overhead 0/306/2124/0), as they must be.

Baselines that were green before any tree change: `npx vitest run` (224 tests,
now 241 with the fade tests), `tools/check-flight.mjs` on the GPU (every hole
inside the gates; pan rate at most 14.5°/s against the 20 gate — this is what
let the gimbal change that was sitting uncommitted in main.js be committed as
0a37b07).

## What the checkpoint commit 45e2d78 contains

Everything in `docs/specs/tree-lod-phase-4-crossfade.md` §2–§4 except the
tools, in one commit rather than the spec's two:

- `apps/golf/src/engine/tree-fade.mjs` + `tree-fade.test.mjs` (17 tests):
  4×4 ordered-Bayer screen-space crossfade as `material.maskNode` (three
  0.185 emits the discard in the colour pass and, through
  `Renderer._getShadowNodes`, in the shadow pass — verified in
  `apps/golf/node_modules/three/src`). Progress quantised to 16 levels in f32
  with a 1/64-level epsilon, drain one level late, reversal placed half a
  level inside its level, epoch rebase below 512 s. `aFade = (t0, code)` per
  instance; codes 0 steady, 1/2 IN, 3/4 OUT; `PAIR` gives the complementary
  code.
- `tree-impostor.mjs`: `createImpostorGeometry` carries `aFade`;
  `createImpostorMaterial({ fade: true })` attaches the mask (tier batches
  only; the far ring never fades). **This file is CRLF in the working tree**
  while main.js is LF — the anchored patch runner had to normalise line
  endings, and any future patch must too.
- `main.js`: tiers decided **per tree** from its own drawn height
  (`treeH = templateHeight × sy × varied`) and the distance to its crown
  centre, hysteresis per tree; 128 m cells only cull (`c.visible`).
  `treeTierMove(s, k, from, to)` handles crossfade, reversal, third-tier
  hop (pending OUT finished at once), frustum exit; `drainTreeFades`,
  `rebaseFadeClock`, `treeTierAudit`. `fadeS` = 0 under `?det=1`
  (deterministic gates render instant switches), 0.3 s otherwise (0.25 LOWQ).
  `?lodpx=hero,full,impostor`, `?gputime=1` (renderer `trackTimestamp`),
  `TREE_LOD.cellMode` (the old per-cell decision from a nominal 12 m tree at
  the cell box — for the pop meter's "before" with the same instrument).
- `V3D` hooks: `treeTiers()` (now also heroPx, hysteresis, force, fadeS,
  frozen, clockDriven, cellMode, switches, fading, updateMs),
  `setTreeLodPx({hero, full, impostor, hysteresis, reset})`, `treeLodPx()`,
  `setTreeFade(s)`, `setTreeFadeClock(t)`, `driveTreeFadeClock(on)`,
  `freezeTreeTiers(on)`, `setTreeLodCellMode(on)`, `treeTierAudit()`,
  `treeTriangles()`, `pixelDelta(threshold)` (in-page frame-to-frame changed
  pixel count over `captureRaw()`), `rendererInfo()`, `frameTimes()`,
  `setFov(f)`, `setShadowRadius(r)`, `quality()` (with `autoQualityDone`),
  `gpuTimingEnabled()`, `gpuTime()` (null unless `?gputime=1`). `settled()`
  also waits for the fade queue unless the clock is driven.

### Gates run on the checkpoint

| gate | result |
|---|---|
| `node tools/lint-app.mjs` | clean |
| `npx vitest run` | 241 passed |
| `BANVY_GPU=1 node tools/boot-profile.mjs … --fingerprint --frames --verbose` | boots, no shader errors, fingerprint identical on every key |
| 12-view strict parity (`tools/parity.mjs`, 0.10/255) vs the previous build under `?lod=4` | **12 of 12 ok** (impostor machinery pixel-identical) |
| same under `?lod=2` | **10 of 12 ok**; view 1 (hole 1 tee golden) mean 0.027/255, 0.065 % > 2 — the known first-shot noise; view 10 (hole 14 green golden) mean **1.37/255, 17.8 % > 2, worst 147** — **NOT explained** |
| `?lod=1`, `?lod=3` strict; automatic-tier views; `check-app` on all courses; vegetation baseline | **not run** |

The view-10 difference under `?lod=2` is the first thing to look at. Candidates:
the v2 stream's tile residency differing between the two boots (`shot.mjs` does
not wait for `loadingTiles === 0`, `world-capture.mjs` does), or something real
in the forced-tier path. Reproduce with the before/after PNGs already on disk:

    node tools/parity.mjs tools/goldens/puttom-v2-before-lod2/_cap-10.png tools/goldens/puttom-v2-after-lod2/_cap-10.png

and re-shoot the after side twice to see whether it is stable. The before sets
for `?lod=1..4` and the automatic tiers are under `tools/goldens/puttom-v2-before*`
(gitignored), captured from the ba25f06 build.

## The five reviewed specs (`docs/specs/`)

Each was written by a design agent, refuted by two adversarial reviewers
(codebase feasibility, measurability/cost) and revised; every review issue is
listed with its disposition at the end of each file. Line numbers in them are
from the tree as it was around 19:00 and are stale.

- `tree-lod-phase-4-crossfade.md` — implemented as above except §3.4/§3.5/§5
  (tools); §6 is the gate order; §2.9 proposes 64 / 24 / 8 px as the sweep's
  starting hypothesis (hero to ~190 m, decimated from ~505 m, impostor from
  ~1.5 km for a 12 m tree at 900 rows), never as a decision.
- `tree-lod-hardware-harness.md` — `tools/frame-time.mjs` and
  `tools/tree-pop-meter.mjs`; the page hooks it needs are in. It measures the
  RTX 3070 adapter as `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU …
  D3D11)`, `timestamp-query` exposed, and the harness rAF at a fixed ~6.1 ms
  cadence without the uncap flags.
- `puttom-stand-crowns.md` — the 40,325 laser-resolved stand-crown apexes as a
  `crowns` / `stand-crown-u8-v1` per-tile rendering payload (never records),
  the residual stand field, the seam rule, `--observed-on 2026-09-02` reuse,
  and why it must land on its own branch (the fingerprint changes by design).
- `puttom-vegetation-coverage-extension.md` — laser trees over the whole
  ±2048 m square on vegetation lattices of their own, CHMv2 canopy field for
  the far ring.
- `puttom-species-prior.md` — SLU Skogskarta stand prior, NMD held-out gate,
  Esri leaf-off colour per crown; laser intensity and crown shape rejected as
  species evidence.

## The two agents

Both were started with `isolation: worktree`, so they work under
`.claude/worktrees/` on their own branches and never touch this checkout. If
the session that started them has ended they are dead; their branches remain.

- **`claude/stand-crowns`** (worktree `agent-ae18740e4e698fe70`): implements
  `puttom-stand-crowns.md` end to end. One commit so far, `ed4c6b5` "the
  stand-crown-u8-v1 chunk format, and every place a layer kind lives"
  (`packages/course-v2/stand-crowns.mjs` + node test, 18 files). It was told to
  compile into `packages/course-geo/toolchain/.cache/acquisition/puttom-vegetation/compile-machine-v3`
  (never over `compile-machine/`), serve its own dist on port 8621, record the
  pre-change vegetation baseline and fingerprint before republishing, and write
  `%TEMP%\claude\reports\stand-crowns-report.md` when done.
- **`claude/vegetation-data`** (worktree `agent-af767e697668ea189`): the DATA
  stage only of the coverage and species specs — laser rasters for the 16×16
  lattice into the cache under `lattice-4096/`, the CHMv2 far-ring canopy
  field under `chmv2-far/`, `fetch-species-prior.mjs` with its evidence — and
  `%TEMP%\claude\reports\vegetation-data-report.md`. No commit yet at the time
  of writing.

Check `git worktree list`, `git log claude/tree-lod-phase-1..claude/stand-crowns`
and the two report files before assuming either finished. Both branches were cut
from `origin/main` (9873e0f), not from this branch, so they do not contain
checkpoint 45e2d78.

## How to resume, in order

1. Fetch and reconcile: `git fetch`; `origin/main` already contains this branch
   up to ba25f06. Decide whether 45e2d78 goes to main through a PR (the branch
   is pushed; the checkpoint commit is one ahead of origin).
2. Build and serve: `cd apps/golf && npx vite build`, then
   `node tools/serve.mjs apps/golf/dist 8620 &`. Everything below is
   `BANVY_GPU=1` (PowerShell: `$env:BANVY_GPU='1'`).
3. Explain the `?lod=2` view-10 difference (above). Then run the rest of §6.2 of
   the crossfade spec: strict under `?lod=1` and `?lod=3`, `treeTierAudit().ok`
   on every view, `node tools/check-app.mjs`, `node tools/vegetation-baseline.mjs
   http://127.0.0.1:8620 --course puttom --label v2`.
4. Write the two tools from `tree-lod-hardware-harness.md` (and the
   `browserArgs({ uncappedFrameRate })` option). Run the pop meter first with
   `V3D.setTreeLodCellMode(true)` and fade 0 (this is "today": the spike must
   show, or the meter is measuring nothing), then per-tree with fade 0 and 0.3.
   Modes A (annulus via `setTreeLodPx({hero: hero×1.25, reset: true})`),
   B (mass, `setTreeLod(3)` then `setTreeLod(0)` with a settled fade between)
   and C (dolly with `freezeTreeTiers`) are in the crossfade spec §5.1–5.2.
5. Frame time in GPU milliseconds per view, then the threshold sweep
   (`?lodpx=…` or `setTreeLodPx`): start at 64/24/8 and keep the largest
   hero/full and smallest impostor whose GPU p95 stays within +1.5 ms of
   110/40/14 at every golden view. Only then change the defaults in
   `TREE_LOD` and record the table in `docs/tree-lod-plan.md`.
6. Look at it: the hero handover at the chosen threshold, and whether the 4×4
   dither shimmers on 60–110 px trees (then `bayer4` → `bayer8`, one function,
   one test). The optional bark normalisation is §2.10.
7. Stand crowns: when the agent's branch is complete and its report is in,
   review the hole-7 overhead and a stand-edge view (25,697 absorbed apexes
   stand at full measured height), then merge after the LOD work — it changes
   the fingerprint by design.
8. Coverage extension and species prior: their data stage from the second
   agent, then the publishing/runtime stages per the two specs, in that order
   (both republish the same ground).

Nothing in this handoff changes the standalone pages, the published ground, the
default visit (v2 stays opt-in per the plan's phase 6 rule) or tree placement.
