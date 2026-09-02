# Taking the next course to 1 m v2 terrain

Puttom is the only course on the v2 pilot. This is what it took, ordered so the
next one costs a fraction of it, and honest about which parts are still
Puttom-shaped code rather than a pipeline.

Read `docs/course-digital-twin-implementation-plan.md` for *why* the format is
what it is. This file is only the *how*, plus the traps that cost real time.

## What is already generic, and what is not

Audited from the code rather than from memory. Anything in the second column
has to be written or generalised before a second course can run.

| concern | generic today | Puttom-shaped today |
|---|---|---|
| frame bridge (convergence, scale, datum) | `engine/geodetic-frame.mjs` | — |
| fail-closed live adapter | `engine/v2-terrain-live-adapter.mjs` | — |
| legacy CORE cutout planner | `engine/v2-legacy-cutout.mjs` | — |
| chunk format, decode, integrity | `packages/course-v2/` runtime | — |
| water level re-measurement | `main.js`, keys off `TERRAIN_PREVIEW` | — |
| tee-pad inference, atlas, surface classes | engine | — |
| **the per-course constants** | — | `engine/v2-puttom-preview.mjs` (53 refs) |
| **ground-graph config + compiler** | — | `puttom-ground-graph.mjs`, `compile-puttom-ground-graph.mjs` |
| **surface preview compiler** | — | `compile-puttom-surface-preview.mjs` |
| **build gate** | — | `check-app-build.mjs` imports the Puttom config |
| **capture harness** | — | `capture-puttom-app-preview.mjs` |
| **source selection registry** | — | `v2-terrain-select.mjs` imports the Puttom config |
| **CI** | — | `course-geo-access.yml` (47 refs) |

So the second course is not a data exercise. **The first real task is turning
`PUTTOM_PREVIEW_CONFIG` into a per-course record and threading a slug through
the six files that import it.** Doing that while adding the second course is
the cheapest moment: two examples is when the shape of the abstraction is
actually visible, and one is not.

## The per-course constants, and where each comes from

`PUTTOM_PREVIEW_CONFIG` has seventeen fields. They are not all the same kind of
thing, and treating them as one list is how a wrong one slips through.

**Derived — compute, never type.** `frameFingerprint`, `expectedBoundsEpsg5845`,
`descriptorSha256`, `surfaceDescriptorSha256`. Every one is an output of the
compile. If you hand-edit one you have broken the only check that would have
caught a bad build.

**Reviewed — a human decides, a gate pins it.** `expectedTileCount`,
`expectedSurfaceTileCount`, `surfaceWindowEpsg3006`, `legacyCoreCutout`,
`previewLatticeOffset`, `expectedCompile`. These state intent, so they are
written down and asserted. They also go stale silently — a stale
`previewLatticeOffset` cost four red CI runs; see the traps below.

**Measured — from the ground, per course, no exceptions.**
`legacyFrame.verticalDatumOffsetMetres`. Terrarium behaves ellipsoidal and
Markhöjdmodellen is RH 2000 orthometric, so the two disagree by the geoid
height: **23.6263 m at Puttom**, median over 5,319 samples of mown ground,
MAD 0.2432 m. The geoid runs from about 17 m in the far north to 36 m in the
south-west, so **this number is wrong everywhere else**. `v2-vertical-datum.test.mjs`
gates it at |median| < 0.10 m on mown ground; copy the test per course.

**Inherited — from the existing legacy build.** `slug`, `label`,
`packOriginWgs84`, `legacyOriginEpsg3006`, `legacyFrame` lat/lon/metres.

## The order

1. **Pick the AOI and let the compiler round it.** `alignTerrainGridExtent`
   expands the required bounds to power-of-two tile counts; you do not choose
   the window, you choose what must be inside it. Puttom's CORE contract gives
   the required extent and the result was 8×8 tiles at 256 m = 2,048 m.
2. **Compile the full-AOI ground graph in CI**, where the credentials are. The
   preview is then *derived from the graph* by `derive-preview-from-graph.mjs`
   rather than extracted separately — that is what made the widening make the
   repository smaller (1.68 MB → 0.73 MB) instead of larger.
3. **Measure the vertical datum offset** against the legacy DEM on mown ground.
   Not forest: Terrarium carries treetops there.
4. **Compile the surface preview** over the played window. It does not need the
   terrain's extent — see the budget trap below.
5. **Wire the constants, run the gates**, in this order because each is cheap
   relative to the next: unit tests → `check-app-build` → `check-app` →
   `check-basepath` → the CI capture (WebGL2 + WebGPU).
6. **Look at the course.** Every gate above compares the model with itself.

## Targets a healthy course hits

From Puttom, so treat them as the shape of the answer rather than a spec.

| | Puttom |
|---|---|
| preview identity vs a fresh compile | 4,227,136 / 4,227,136 exact, max diff 0 m |
| played features on v2 ground | 18/18 greens, 41/41 bunkers, 72/72 runtime tee pads, 53/53 centre-line vertices |
| CORE base points omitted | 118,987 / 123,175 = 96.6% |
| v2 draw calls | 1 |
| centre-line agreement with the legacy DEM | median −0.40 … +0.56 m on 17 of 18 holes |
| water bodies with a dry bed | 0–7%, matching the GPK1 baseline |

That centre-line row is the one worth reading twice. **Seventeen holes agreed
and the eighteenth was 16.61 m out** — the legacy Terrarium field, not v2. A
course-wide median hides that completely, so compare per hole.

## The traps, each of which cost real time

**A reviewed constant goes stale in silence, and its test can agree with it.**
`previewLatticeOffset` still described the retired 1,024 m pilot after the
widening, and four CI runs died on it. Its unit test asserted
`aligned.originEasting + offset.column * span === 696916.5` — a literal
restating what the offset computes, so it checked the constant against itself
and stayed green. It now compares against the committed preview's own bounds.
**Any test for a reviewed constant must compare it with something that never
entered it.**

**A gate is only as honest as the server under it.** `tools/serve.mjs` sent
neither `Content-Length` nor `Content-Encoding`, a shape almost no host
produces. Two live failures hid behind that: an absent length read as a
declared *zero*, then GitHub Pages **gzipping `.bvch`** and declaring the
compressed length (81,628 against 81,751), which failed the whole pilot closed
on the published site while every local gate passed. Do not reason about what a
host ought to do — ask it.

**The surface layer does not need the terrain layer's extent.** All 64 tiles of
1 m surface decode to ~56 MiB against a 32 MiB active budget, and three fifths
of it would describe rough. Cover the played ground plus a margin — Puttom uses
30 of 64 tiles. Expect that to fail closed in several places at once: four
separate files had each encoded "surface count == terrain count".

**The DTM over water is the water SURFACE.** Laser does not penetrate, so there
is no bathymetry anywhere in this data and the "ground" inside a lake ring is
the surface itself. Two consequences. Water levels measured against the legacy
DEM are invalidated by better ground — Puttom had a lake render as brown bed
because v2 put it 16 cm above its own water plane. And placing the plane
exactly on the measured value makes it coplanar with the bed drawn beneath it,
which z-fights. Lifting the plane 0.25 m was the first answer and it was not
enough: the water shader reads depth as level minus ground, so a whole lake
25 cm deep renders as silt bottom from any oblique view, and the two surfaces
still meet at the horizon. **The bed is now carved at boot**
(`engine/v2-water-bed.mjs`): the flat-water pass and the model's rings give a
water mask on the 4 m ring, a distance transform gives each cell its distance
to the shore, and every sample standing on the water's surface is lowered to
level minus min(3.5, 0.15 + 0.12·d) — a rendering choice, stated as one, and
the published tiles are untouched. The same field rewrites the CPU ring
sampler in place and every tile the GPU decodes (`transformDecoded` on the
runtime), so what is measured is what is drawn. Puttom: 811 ha, 995k samples
in 107 ring tiles, 3 s on the main thread. Banks and islands a loose ring
encloses are left alone (only samples within 0.5 m of the level are carved).
The ring graph makes this possible: the rings are resident before the model,
so the levels, the flats and the beds are all known before any GPU decode.

**Terrarium is not a fallback you can trust locally.** Puttom's 7th renders
20.3 m of relief and 36.5 m of climb on GPK1 against 6.0 m and 8.5 m on the 1 m
ground. Canopy does not explain it — the centre line carries 1% canopy within
15 m and the correlation across 1,533 samples is r = −0.019. Why Terrarium
spikes there is **not established**. Expect at least one such hole per course
and find it by comparing per hole, not per course.

**A phone can be stuck in low quality without saying so.** The fps sampler
writes `banvy-quality: lo` to localStorage after one slow ten-second window,
and it is read back forever. The v2 boot decodes 64 tiles and is exactly the
kind of thing that trips it. The badge is the tell: "2 m mesh" means
`!IS_GPU && LOWQ`, and the canvas is then rendering at devicePixelRatio 1 and
being upscaled — on a 2.625 DPR phone that is a 2.6× blow-up of the whole
scene, which reads as "the icons are blurry".

**When the GPK1 pack changes, v2 must be re-bound.** The root index and the
course manifest carry the exact live pack entry, and the surface preview
carries the pack's sha; both refuse a new pack. After `emit-pack` and
`emit-manifest`: `compile-puttom-surface-preview.mjs --replace` (copy the
printed `surfaceDescriptorSha256` into the config), then
`publish-ground-rings.mjs --ground puttom` (it reads the live manifest),
then prune, build and `check-app-build`.

## What is still open

- **Nothing is generalised yet.** The table at the top is the work.
- **Ortophoto** is unauthorised: all four assets return 403, `authorized: false`.
- **Canopy and LiDAR intensity** exit non-zero in CI as non-gating measurements.
- **No hardware performance evidence.** Every capture is SwiftShader:
  `performanceEvidence: false`, `sampledFps: 0`. Rendering is proven; speed is not.
- **GPK1 remains the default** and must until the release gates pass.

## Taking the course to the horizon — the ring graph

The pilot window is a 2 km square and the legacy Terrarium rings around it
disagree with it by metres; the seam showed. The published graph is now a
ring graph and the app draws nothing else under `?v2=`:

    node --env-file=.env packages/course-geo/acquisition/build-ground-rings.mjs --ground puttom
    node packages/course-v2/publish-ground-rings.mjs --ground puttom
    node packages/course-v2/prune-generations.mjs --slug puttom --also courses/puttom/course-v2-<previous>.json --apply
    cd apps/golf && npx vite build && cd ../.. && node packages/course-v2/check-app-build.mjs
    BANVY_GPU=1 node tools/world-capture.mjs http://127.0.0.1:8620 --course puttom

The ring specification is `packages/course-v2/puttom-ground-rings.mjs`: per
level a spacing, a tile count per side, a quantisation step and a source.
Every origin must be a whole number of the finer level's tile spans from
that level's origin, AND every finer ring must be made of whole coarser
tiles (eight tiles wide, centred, is the shape that satisfies both), or the
compiler refuses it; the coarsest level must be one tile, which becomes the
shell. A coarser tile half inside a finer ring opens a hole the size of its
other half when the runtime refines it. Per course the things to set are the
frame origin (the levels are centred on it) and the coverage band the
builder gates heights against. The 1 m level is asserted against the
published course tiles, so a second course needs its pilot published first.
