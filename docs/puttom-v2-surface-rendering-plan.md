# Puttom v2 surface rendering remediation plan

> **Status 2026-09-02 (evening):** implemented. The `?v2=` path draws Puttom's
> surfaces from the per-class representation described here (`class-sdf-v1`),
> and every acceptance gate below that has an instrument passes on both
> backends on real hardware. GPK1 remains the app's default terrain; this plan
> changed only what the v2 path draws its surfaces from. What is still open is
> listed in the checkpoint, and it is review, not construction.

## Checkpoint

| item | state | evidence |
|---|---|---|
| Dual-surface regression removed (Phase 0) | **done** in `28f75d0` | `shouldRenderLegacySurfaceOverlays()`; `VECTOR_OVERLAY` and the v2 class suppression gone from `material.js`; unit tests pin both |
| Exact EDT + `surface-sdf-u8-v1` payload (Phase 3) | **done** | `packages/course-v2/distance-transform.mjs` (Felzenszwalb–Huttenlocher, brute-force tested; window+halo proven byte-identical to global), `surface-sdf-grid.mjs`, schema + JSON Schema + both verifiers + graph validator; `surface-sdf.node-test.mjs` |
| Compiler stage (`representation: 'class-sdf-v1'`) | **done** | `surface-compiler-node.mjs`: 25 cm resolved mask, per-tile EDT with 17 px / 164 px halos, route + unclamped ring + owner; palette derived from the mask; the authoritative compiler inherits it |
| Puttom chunks | **published** | 30 tiles, 9 channels `[1,2,3,4,5,6,8,11,14]`, 22.68 MiB decoded / 1.11 MiB encoded, descriptor `9b219bada2f21574456ead3bb8c5f28c32b9cd9a13f9a33adccf9dbc0ace5535`, `samplingFrame: legacy-bridge` |
| Runtime stitcher + per-class material (Phase 4) | **done** | `v2-surface-preview-atlas.mjs` (RGBA8 SDF textures, mipmapped; route/ring fields; owner CPU-only; shader-equivalent probe), `createClassSdfDecorator` in `material.js` (constants per class, no style-texture fetches, 6 samplers) |
| Instruments (Phase 1 remainder) | **done** | `tools/v2-surface-audit.mjs`: representation/overlay/draw gates, ring transects through `V3D.v2SurfaceProbe`, the visual matrix, and GPU pixel readback vs probe in the weights view; `V3D.project` added for it |
| Compiler draws what the app draws | **done** | the app's boot-time ring smoothing and synthesised tee pads now live in `engine/ring-smoothing.mjs` and `engine/tee-pads.mjs` and the compiler applies both — measured green error fell 0.283 → 0.062 m |
| Gates on real hardware (RTX 3070 Laptop, `BANVY_GPU=1`) | **pass, both backends** | transects 242/248 measured: mean **0.053 m**, p90 0.125 m, max 0.175 m (green 0.062/0.225, tee 0.064/0.175, bunker 0.082/0.175 after its 0.5 m pad); rough at a green/tee edge ≤ 0.015; raw-sum error ≤ 0.012; pixel-vs-probe **1981/1981** (WebGPU) and **1982/1982** (WebGL2) confident probes agree; boot 27 s / 35 s; median 35 / 37 fps at 1440×900 |
| Visual matrix | **captured**, review pending | `geobuild/shots/v2-surface/{webgpu,webgl2}/` — holes 6, 7, 10, 16, 17, 18 × tee/green/fritt/ovan/grazing × dag/kvall (gitignored); the six weights views |
| SwiftShader CI capture (mobile + desktop WebGL2, software WebGPU) | WebGL2 mobile + desktop **pass** with the new `surfaceRepresentation === 'class-sdf-v1'` assertion; the software-WebGPU case cannot initialise on this Windows Chrome (`webgpu-desktop initialized webgl2/webgl2` — no Vulkan/SwiftShader adapter here, the same environment gap as before, now a clean failure instead of a timeout) | `capture-puttom-app-preview.mjs`; CI's Linux Chrome carries the software adapter. Hardware WebGPU is proven by the audit row above |
| Phase 5 tuning (per-class widths, detail at grazing angles, five presets) | widths table shipped; review pending | `SURFACE_TRANSITION_WIDTH_METRES` in `surface.js`; the kvall matrix is captured, gryning/host/dis are not yet |
| Hardware performance table (three device classes) | one device measured | see above; a laptop iGPU and a phone are still owed |

### What the instruments found that the design had wrong

- **Rough as `−max(sdf_i)` draws a rough seam along every cut edge.** Both
  distances are zero on a green/fairway boundary, so the distance complement
  gave rough a third of the weight there. Rough is the complement of the class
  **weights**, `max(0, 1 − Σ raw_i)`, normalised by `max(1, Σ raw_i)`. Caught
  by the first unit transect; would have been a visible line on every green.
- **"A pair blends over the wider of its two widths" has to be computed.** With
  green at 0.16 m and fairway at 0.25 m, the green faded before the fairway
  rose and a 1.6 % rough sliver appeared in between. The shader now finds the
  two largest distances per fragment and gives each class the width of the
  class it actually meets (rough's width when nothing else is within a metre).
- **The compiler was rasterising rings the app never draws.** `main.js` smooths
  green, fairway and tee rings at boot and synthesises a pad under every
  unmapped tee marker; the pack on disk has neither. Greens measured 0.28 m
  off until the two steps became shared modules the compiler applies too.
- **The debug view must not be tone-mapped or fogged**, or its pixels cannot
  be classified; and calibrating class colours from the frame must first
  reject pixels that do not resemble the authored colour, or forest — mostly
  under tree crowns — "measures" as tree-green and claims every rough probe
  under a tree.

## Executive decision

Puttom's fairways, semi-rough, fringes, greens, tees, bunkers and natural
surface classes are rendered by **one physical v2 terrain mesh and one terrain
material**. No course-wide surface class is ever represented by an independent
mesh above or below the terrain.

The surface compiler produces one continuous signed-distance field (SDF) per
material class. The terrain shader converts those fields into normalized
material weights and blends complete material properties on the terrain itself.

```text
canonical surface vectors (migration today, surveyed later — same stage)
        |
        v
resolved 25 cm priority partition (offline only, never shipped)
        |
        v
per-class exact Euclidean SDFs, clamped ±4 m
        |
        v
packed 1 m runtime SDF textures on the terrain tile lattice
        |
        v
single v2 terrain shader
        |
        v
normalized material weights + sharp world-space detail
```

This satisfies both requirements at once, because they act on different
frequencies: silhouettes become continuous and free of one-metre jigsaw steps
because a linearly filtered distance field reconstructs a sub-texel zero
contour; grass, sand, mowing, normal and roughness detail stay sharp at close
range because only the low-frequency *weights* are softened, and detail is
sampled independently in world space.

**Scope boundary.** This plan changes the v2 surface stage only. The GPK1
courses' 1 m boot-built atlas (`atlas.js`, `makeGround`) keeps the pair-SDF
representation; nothing here touches the six standalone pages.

## Observed failures

The reported screenshots showed three distinct defects:

1. Stair-stepped boundaries between rough, fairway, fringe, green, tee and
   bunker.
2. Dark holes, long shards, material leaks and view-dependent gaps.
3. Oily or excessively pale/dark triangular areas and blurred close detail.

They had no single filtering fix. The first is the surface **encoding**
(root cause 8, still live). The second and third were the regression of
enabling a second, non-conforming surface mesh system on top of v2 terrain
(root causes 1–7, removed by Phase 0 and recorded here so they are not
reintroduced).

## Root causes

### 1–7: the overlay regression (removed in Phase 0)

1. **Two independent ground representations.** The v2 shader already drew the
   surface classes; the branch additionally enabled six vector overlay batches
   when v2 was ready. The overlays were triangulated independently in
   [`surfaceMesh()`](../apps/golf/src/main.js#L2112) and shared neither the
   1 m terrain grid nor its fixed diagonals, so sampling terrain height at
   overlay vertices could not make planar overlay triangles conform to the
   terrain triangles between them.
2. **Every overlay boundary was forced through the terrain.** Boundary vertices
   were placed 0.06 m below the terrain and interior vertices 0.018–0.086 m
   above it; a triangle spanning that sign change necessarily contains an
   intersection contour. `polygonOffset` and `renderOrder` change a fragment's
   depth after interpolation and cannot make two tessellations conform.
3. **The CPU height sampler does not match rendered v2 terrain.** The sampler in
   [`v2-puttom-preview.mjs`](../apps/golf/src/engine/v2-puttom-preview.mjs#L302)
   is bilinear; the renderer draws two fixed triangles per cell
   ([`terrain-grid-topology.mjs`](../packages/course-v2/runtime/terrain-grid-topology.mjs#L54))
   and morphs tile heights over 240 ms (`v2-terrain-batch.mjs`), which the
   sampler never sees. This is no longer a *surface* problem — see Phase 4.5
   for the residual.
4. **Overlay topology was malformed or under-subdivided.** A read-only
   reproduction found 175 overlay polygons, ~456,500 vertices, ~848,700
   triangles, 14 overlays over their requested maximum edge after the five-pass
   subdivision cap (hole 6 at 5.49 m and hole 10 at 4.63 m against 3.6 m), and a
   self-intersection in hole 10's semi/collar polygon after `offsetRing()` and
   Chaikin smoothing. Earcut assumes simple input.
5. **The base shader exposed rough beneath overlay failures.** Six classes were
   suppressed from the terrain atlas as "vector-owned"; at fairway/semi and
   green/fringe boundaries both encoded classes could be suppressed and the
   fallback was rough, so every overlay gap revealed a dark under-material.
6. **Overlay and atlas boundaries had different authorities** — `offsetRing()`
   + Chaikin against scanline fill + rounded segment dilation
   ([`atlas.js`](../apps/golf/src/engine/atlas.js#L188)). Two-dimensional
   regions that cannot be identical leave teeth even with perfect heights.
7. **Overlay lighting magnified the geometry defects.** Own vertex normals and
   per-vertex AO on lifted/tucked geometry against the terrain's packed
   octahedral normals produced false slopes and broad pale/dark bands.

### 8. The remaining jigsaw is the pair/SDF encoding (live)

The current payload (`surface-grid-u8-i16-le-v1`, 14 bytes/sample) stores two
nearest-filtered material IDs and **one** linearly filtered signed distance
whose meaning depends on that ordered pair. Where the pair changes between
adjacent texels the shader interpolates a continuous number while
discontinuously changing what it means.

Measured 2026-09-02 on the 1281 × 1537 window (`rasterizeGroundAtlas` at 1 m
over `surfaceWindowEpsg3006`, translation bridge, migration vectors):

| measure | value |
|---|---|
| adjacent-texel SDF sign crossings | 49,205 |
| …of which the ordered pair also changes | 14,562 = **29.6%** |
| texels with ≥ 3 classes in their 3 × 3 neighbourhood | 1,730 = 0.09% |
| texels with ≥ 4 classes in their 3 × 3 neighbourhood | 23 |

The two rows below the pair-change line are the important ones: true multiway
junctions are rare, yet the pair flips at nearly a third of all crossings.
**The dominant failure is the nested band structure, not junctions.** A green
complex is green → fringe (3.2 m pad) → fairway → semi (4.5 m pad) → rough:
five classes inside the 8 m distance clamp. From inside a 3.2 m fringe band the
"nearest other class" flips from green to fairway mid-band, so the pair, and
with it the meaning of the distance, flips along a line where nothing visible
happens. A single (pair, distance) sample cannot represent concentric bands
narrower than twice its clamp, and cannot represent a junction at all.

The 25 cm compiler experiment
([`surface-compiler-node.mjs`](../packages/course-v2/surface-compiler-node.mjs#L204))
improves the *distance estimate* by computing the boundary raster at 25 cm, but
it samples straight back into the same pair payload. It cannot fix the
representation's topology, which is why it was retained rather than rolled
back: it is strictly better data in a still-wrong shape.

## Options considered

| option | result | decision |
|---|---|---|
| More subdivision, lift, skirts or polygon offset | Two unrelated surfaces remain; cannot match terrain morphing or normals | Reject |
| Blur or linearly filter class IDs | Invalid intermediate IDs or muddy edges; junctions unfixed | Reject |
| Full 25 cm multi-class atlas | Excellent resolution, hundreds of MiB for all classes | Reject |
| Vector-clip and remesh every terrain tile | Exact geometry; high stitching, LOD and streaming complexity | Not for appearance |
| Exact vector distance per fragment | Resolution-independent; complex and expensive on WebGL2/WebGPU | Reserve as later fallback |
| Top-K (id, distance) per texel with an id-matched 4-tap gather | Fixes ID filtering and halves memory (K = 3 covers 99.9% of texels), but 4 fetches per field, a bespoke filter on both backends, no mipmaps, and K = 3 still fails the 23 four-way texels | Reject while the per-class set fits the budget |
| Per-class SDFs blended in the single terrain material | Continuous boundaries, correct junctions and nested bands, bounded memory, mipmappable, no geometry intersections | **Choose** |

## Final surface representation

### Classes and the channel palette

Puttom's window contains ten occupying classes (measured, texel counts of the
1 m window): forest 1,165,620 · rough 615,578 · fairway 113,859 · semi 35,630 ·
gravel 14,328 · fringe 8,765 · green 7,729 · tee 4,662 · sand 2,507 ·
wetland 219.

The payload stores the **non-rough** classes as SDF channels. Because the
resolved regions partition the plane, rough is what no class claims — and it
must be taken as the complement of the class **weights**, not of the
distances:

```text
raw_i     = smoothstep(-w_i, w_i, sdf_i)          for every stored channel
roughRaw  = max(0, 1 - Σ raw_i)
weight_k  = raw_k / max(1, Σ raw_i)               for channels and rough alike
```

`-max(sdf_i)` looks equivalent and is not: on the boundary between two mown
classes both distances are zero, so a distance complement hands rough a third
of every green edge. The weight complement is zero there and rises only where
every class has genuinely faded. (Measured; see the checkpoint.)

The channel palette is **per course and lives in the descriptor** as an
ordered list of surface registry IDs. The registry has 17 classes; a course may
carry up to 16 non-rough channels (four RGBA textures). Puttom uses nine.
Nothing in the shader or loader may assume Puttom's order or count: the TSL
material is built from the palette at decoration time, the same way
`createV2GroundMaterialDecorator` is already handed the atlas. This is what
keeps the format course-agnostic before the runbook's
`PUTTOM_PREVIEW_CONFIG` generalisation lands.

### Distance encoding

- One UNORM8 byte per non-rough class: `byte = round((clamp(d, −4, 4) + 4) / 8 · 255)`.
- Positive inside the resolved class, negative outside.
- An 8 m range over 255 steps is 3.14 cm per step, comfortably below the
  visible edge tolerance.
- Saturated interiors dominate: measured per class, the ±4 m non-saturated
  band is 9.0% of texels for rough, 5.9% semi, 4.5% forest, 4.3% fairway,
  2.5% gravel, 2.0% fringe, ≤ 0.7% for green, tee, sand and wetland. Deflate
  compresses the rest to almost nothing; GPU memory does not, which is why the
  GPU figure below is the one that matters.
- **Invariant, gated:** at every texel exactly one class is non-negative (rough
  counted through its complement). This is what "mutually exclusive after
  priority resolution" means in bytes, and it is cheap to check.

### Auxiliary fields — explicit, because the current draft is ambiguous

The present shader reads **two** mowing coordinates, chosen per class by
`MOW_SOURCE` in `material.js`: a **route distance** for fairway and semi
(stored at 0.25 m steps, sentinel 255 = no route) and a **ring distance** for
green and fringe — the distance to the green's own edge, **unclamped**, so the
rings run all the way to the middle of a 30 m green. CLAUDE.md records the
regression that clamping this caused ("the greens had lost their mow rings in
the middle"). A ±4 m green SDF would recreate it, so the ring coordinate cannot
be derived from the clamped SDF channel and must be stored.

| field | type | encoding | filter | notes |
|---|---|---|---|---|
| route distance | U8 | 0.25 m steps, 0–63.5 m, 255 = no route | linear, **no mips** (the sentinel must survive) | as today (`fields.g`) |
| ring distance | U8 | 0.16 m steps, 0–40.6 m | linear, no mips | as today (`fields.a`); unclamped distance to the owning green/fringe edge |
| owner | U8 | hole number 1–18, 0 = none | **nearest**, or not uploaded | today it sits in the *linearly filtered* fields texture (`fieldData[+2]`) — a filtered ID, which this plan forbids. The shader never reads it; keep it CPU-side for probes unless a shader use appears |

Owner is the **hole number**, not a feature ID: authoritative intake carries
stable object names in the descriptor, and a U8 owner is not where they go.

The provisional payload's unmeasured fields (mow direction, moisture, wear,
exposure, vegetation density — all zero for Puttom) are **omitted** from the
new format. Their bytes must never be reinterpreted under the old schema.

### Payload and byte accounting

```text
9 × SDF U8 + route U8 + ring U8 + owner U8 = 12 bytes/sample
```

| quantity | value |
|---|---|
| decoded, 30 × 257 × 257 samples × 12 B | 23,777,640 B = **22.68 MiB** (budget: 23 MiB target, 32 MiB hard limit in `v2-surface-preview-loader.mjs` and the compiler) |
| GPU, 1281 × 1537 = 1,968,897 texels: 9 SDF bytes | 16.90 MiB |
| GPU, fields RGBA8 (route, ring, spare, spare) | 7.51 MiB (RG8 would be 3.76 MiB; choose after the sampler count below) |
| GPU total | **24.41 MiB** against today's 11.27 MiB (RG ids + RGBA fields) |

About 13 MiB more GPU memory than the present atlas, in exchange for removing
six overlay draws and ~849,000 overlay triangles — and for a representation
that is correct.

### No-data and window edges

- Outside the 30-tile window the material falls back exactly as today
  (`inBounds` → the terrain's procedural rough). Nothing changes.
- A no-data sample inside the window (`SURFACE_NO_DATA_ID` today) encodes as
  all SDF channels saturated negative — i.e. rough — and route 255. There is no
  separate no-data byte to filter.

## Frame contract

Two frames meet in the v2 path and the plan must say which one the raster is
in, because the material currently knows it only from a comment.

- The terrain tiles are EPSG:3006 grid-north DTM, brought into the app's
  legacy world by the bridge (`applyV2BridgeTransform`, convergence 3.52° at
  Puttom, `geodetic-frame.mjs`).
- The **migration** surface raster is rasterised from the pack's own legacy
  vectors on the terrain tile lattice **translated** into the legacy frame
  (`worldBounds()` in `surface-compiler-node.mjs`), and sampled at the
  **legacy** world position (`positionWorld.xz`). Measured: 14 of 18 green
  centres land on green addressed this way, 3 of 18 through the bridge.
- The **authoritative** compiler (`authoritative-surface-compiler-node.mjs`)
  uses a zero bridge: canonical EPSG:3006 coordinates on the same lattice.

The new descriptor therefore carries `samplingFrame: "legacy-bridge" |
"canonical"` and the material chooses its sampling coordinate from it. The
raster lattice is the terrain tile lattice in both cases; only the coordinate
the fragment presents differs. The 3.52° rotation between the lattice and the
terrain triangles is irrelevant to appearance (both are ground) and is not an
alignment error.

One compiler stage serves both sources. `compileAuthoritativeSurfaceAssets`
already calls `compileSurfacePreviewAssets`; the per-class stage replaces that
function's payload step, so surveyed polygons get the new format for free and
the migration/authoritative split stays exactly where it is (provenance, not
geometry).

## Compiler design

### 1. Validate and resolve topology

Before distance generation:

- validate closed, simple rings; preserve explicit holes and multipolygons
  (`fillPolygon` already even/odd fills them);
- report self-intersections, duplicate vertices, zero-length edges, invalid
  hole nesting and out-of-frontier coordinates, with the feature and hole
  named;
- apply `SURFACE_PRIORITY` once to produce mutually exclusive class regions;
- use one world-coordinate origin for all tiles.

Do not build angle-bisector offset polygons for padded bands. Pads (`semi`
4.5 m, `fringe` 3.2 m / 2.2 m, `sand` 0.5 m) resolve through the rounded
segment dilation the raster already uses, or through a robust polygon
offset/boolean whose output is validated before use.

### 2. 25 cm is the offline source mask only

Rasterise the resolved partition at 0.25 m. That puts the classification
uncertainty below the visual tolerance without a 25 cm runtime atlas.

### 3. Exact Euclidean distance, not chamfer

`buildBoundaryField` in `atlas.js` is a two-pass 3 × 3 chamfer (1, √2), which is
directionally biased and, by design, propagates only within a class. Replace it
for the per-class fields with the separable exact EDT of Felzenszwalb and
Huttenlocher, computed on the 25 cm mask for each class as two transforms —
distance to the nearest *outside* pixel and to the nearest *inside* pixel —
and combined as

```text
sdf = sqrt(dOut²) − sqrt(dIn²)      (in source pixels, then × 0.25 m)
```

so the zero contour lies on the pixel **edge** between opposing pixel centres,
where linear interpolation puts it, rather than half a pixel inside. The
magnitude is overstated by at most half a source pixel (12.5 cm) immediately at
the edge and exact beyond it. Clamp to ±4 m, quantise to the byte.

Process one class and one terrain tile at a time with a halo at least as wide
as the clamp: 4 m = 16 source pixels. Everything farther saturates, so the halo
is sufficient for **byte-identical values on shared tile borders** without the
180–210 MiB global supersampled working set. Byte identity on the shared
border row/column is asserted before encoding, as the atlas stitcher already
asserts it at load.

### 4. Compiler diagnostics

Each compilation can export, for selected tiles:

- the resolved class image (this is also the reference for the pixel gate);
- one image per SDF channel;
- reconstructed normalized weights and the argmax class image;
- the mutual-exclusivity violation image (must be empty);
- the shared-border difference image (must be empty);
- the topology report;
- class sample counts, saturation fractions and byte statistics.

These are compiler evidence, not published runtime assets.

## Runtime terrain shader

### Textures, filtering and the sampler budget

| texture | content | filter | mipmaps |
|---|---|---|---|
| SDF A, B, C (RGBA8, RGBA8, R8 for nine channels) | class distances | linear | **yes**, trilinear — an averaged distance is still a distance, and this is the property the ID textures never had; it is what stops boundary shimmer under minification |
| fields (RG8 or RGBA8) | route, ring | linear | no (route sentinel 255 must survive) |
| owner (R8) | hole id | nearest | no — and only if a shader consumer exists |
| terrain height/normal `DataArrayTexture` | as today | as today | — |
| `DETAIL` (and any sand normal) | as today | as today | as today |

Style rows (colour, shade, meta, mow coefficients per class) become **uniform
arrays** (TSL `uniformArray`, 17 × 4 vec4) rather than the 32 × 4 style
texture: the present decorator does ~12 style fetches per fragment for two
classes; ten classes through a texture would be ~40. Through uniforms the
per-class blend is a short loop of multiply-adds and costs no sampler.

WebGL2 guarantees only 16 fragment sampler units, and three.js takes one per
shadow-casting light. After this change the terrain material uses: terrain
array (1) + `DETAIL` (1) + SDF (3) + fields (1) = 6, plus shadow. **Gate it:**
`check-app-build` reads the compiled material's sampler count and fails above
12, leaving headroom for a sand normal and environment maps. NPOT mipmaps are
legal on both backends; verify on both, because "Vertex buffer count" was the
last silent WebGPU-only limit and this is the next one.

### Weight reconstruction

For each channel `i` in the palette, plus rough by weight complement:

```text
meets_i    = width of the class i is blending against:   (found per fragment
             the runner-up for the leading class,          from the two largest
             the leader for every other class,             distances)
             rough's width when the runner-up is > 1 m away
w_i        = max(physicalTransitionWidth_i, meets_i, k · fwidth(sdf_i))
raw_i      = smoothstep(−w_i, +w_i, sdf_i)
roughRaw   = max(0, 1 − Σ raw_i)
weight_k   = raw_k / max(1, Σ raw_i)
```

- No class IDs are interpolated anywhere.
- Weights sum to one; rough participates as a real weight, never as a
  fallback revealed by a missing overlay.
- Transition widths are per **class**, in metres (`SURFACE_TRANSITION_WIDTH_METRES`
  in `surface.js`, 0.16–0.45 m), and a pair blends over the wider of its two
  on BOTH sides — computed, because with asymmetric widths one class fades
  before the other rises and the sliver between reads as rough. The CPU probe
  applies the identical rule, so probe and shader cannot disagree.
- `fwidth` widens the transition only when a subpixel edge needs antialiasing.
- No cross-shaped or other blur kernel is applied to the final fields.
- Mowing is not blended by parameter: each class's band is evaluated on its
  own coordinate source and the stripe intensity is cross-faded by weight, so
  two cuts never average into a third phase.

### Complete material blending

The normalized weights blend complete material parameters: base colour, macro
variation, bump/normal strength, roughness and gloss response, and the sand /
hard-surface / wetland / forest metadata. **Mow phase is not blended**: it is
taken from the argmax class's coordinate source (ring for green/fringe, route
for fairway/semi, world diagonal for tees) and faded by that class's strength,
exactly as today, because two classes' cuts are different cuts.

The terrain's geometric normal is authoritative everywhere. Per-material bump
detail perturbs that shared normal; materials do not create geometry normals.

### Preserve close-range sharpness

The SDF atlas controls only *which* material is visible and must never contain
pre-blurred final colour. High-frequency detail is sampled independently in
world XZ — grass blade/clump detail, mowing bands, sand grain/rake normal,
macro colour breakup, hard-surface noise — with mipmaps for minification and
anisotropic filtering at grazing angles, and its frequency and contrast are
tuned independently of edge softness.

## Diagnostics contract

The gates below are only as good as the instruments that measure them, so the
instruments are part of the deliverable:

- `?surfaceDebug=weights` renders the **N-class** normalized weights through an
  unlit categorical palette (already exists for the pair representation;
  extend to the palette).
- `V3D.v2SurfaceProbe(x, z)` returns per-class weights computed by the **same
  arithmetic as the shader** (same clamp, same bilinear on the same bytes,
  same widths). Its representation field becomes `class-sdf-v1`.
- The compiler's resolved class image for the same tiles is the reference.
- **Transect tool:** walk a line across a named boundary at 5 cm steps through
  the probe, find where argmax flips, and compare against the 25 cm reference
  contour. This is the instrument for the 0.25 m / 0.15 m contour gate.
- **Pixel-side confirmation:** the capture harness renders the weights view
  from a fixed camera and reads back the pixel under each probe's projected
  position. Today `surfaceEvidencePassed` is data-side only (class counts
  present in `state.v2.surface.classes`); this adds the check that the GPU
  drew what the CPU probe says.

## Staged implementation

### Phase 0 — stabilize the regression — DONE (`28f75d0`)

What shipped: `shouldRenderLegacySurfaceOverlays({groundMode, v2Active})`
gates overlay creation and is true only for `mesh` mode without v2;
`VECTOR_OVERLAY`, the style-row ownership flag and the v2 underlay suppression
are removed from `material.js`; `material-style-data.test.mjs` and
`surface-render-policy.test.mjs` pin both; the capture harness asserts
`courseSurfaceOverlayMeshes === 0` and `stats.surfaceOverlays === 0`. The
boundary-oversampled descriptor `e0c0ba27…` was retained as one atomic set.
Preserved unrelated work: the approved summer palette, tee marker / default
tee, descriptor-integrity verification, line-ending protections, the corrected
v2 half-cell UV alignment.

The one-metre jigsaw is this phase's known limitation.

### Phase 1 — diagnostic evidence — PARTLY DONE

Done: the weights debug mode; the shader-equivalent probe. Remaining:

1. Capture and keep the stabilized baseline for the visual matrix views
   (`tools/goldens.mjs`; approval stays human).
2. The transect tool and the compiler-reference crops for holes 6, 7, 10, 16,
   17 and 18.
3. The pixel-side probe readback in the capture harness.

### Phase 2 — prototype without publishing

1. Generate per-class SDF data into a temporary build location.
2. Implement the palette-driven blending shader behind a development flag,
   with style uniforms replacing the style texture.
3. Compare 1 m runtime SDFs against 0.5 m and 0.25 m reference crops around
   holes 6, 7, 10, 16, 17 and 18 with the transect tool.
4. Verify WebGL2 mobile, WebGL2 desktop and WebGPU desktop before touching the
   public surface schema; record the sampler count on each.

A pair-expanded SDF may be used only to prove shader mechanics. It is not
production data: the pair payload cannot reconstruct per-class distance at
nested bands or junctions.

### Phase 3 — the payload and loader

1. Add a new explicit payload format, e.g. `surface-sdf-u8-v1`, with its own
   `requiredFeatures` entry; **never** reinterpret `surface-grid-u8-i16-le-v1`
   bytes.
2. Store the ordered channel palette and `samplingFrame` in validated
   descriptor metadata.
3. Per-tile exact EDT with the 4 m halo; assert shared-border byte equality
   before encoding.
4. Touch points, enumerated so none is discovered at runtime (eleven files
   reference the current format string):
   - `packages/course-v2/schema.mjs` and `schemas/chunk-header-v2.schema.json`
     — the payloadFormat branch, `bytesPerSample`, `decodedBytes = w·h·12`;
   - `surface-grid.mjs` → a new encoder module; `surface-compiler-node.mjs`
     (`tilePayload`, the 32 MiB assertion); `authoritative-surface-compiler-node.mjs`
     inherits;
   - `chunk-node.mjs`, `graph-node.mjs`, `runtime/decode-web.mjs`, the chunk
     worker, `synthetic-fixture.mjs` + `check-synthetic.mjs`;
   - `apps/golf/src/engine/v2-surface-preview-atlas.mjs` (hard-codes 14 bytes
     and the RG id texture; becomes the SDF stitcher and the probe),
     `v2-surface-preview-loader.mjs` (budget), `v2-puttom-preview.mjs`
     (`surfaceDescriptorSha256`, `inspectSurfacePayload`, the required-class
     inventory), `material.js` (`createV2GroundMaterialDecorator`);
   - `capture-puttom-app-preview.mjs`, `check-app-build.mjs`, `main.js`
     (`V3D.v2SurfaceProbe`).
5. Keep old-schema decoding only where a real compatibility requirement
   exists. If none does, delete it; a decoder nobody exercises is where the old
   bytes get reinterpreted.

### Phase 4 — the terrain material

1. Replace primary/secondary selection with the palette's SDF channels.
2. Reconstruct rough and the normalized weights; argmax once per fragment.
3. Blend all style and physical parameters from uniforms; mow phase from the
   argmax class only.
4. Delete the v2 course-wide overlay creation and any residual suppression code
   rather than hiding it behind depth settings — `surfaceMesh`, `subdivide`,
   `chaikin`, `offsetRing` stay only while the GPK1 `mesh` path needs them.
5. **Height consumers, measured before touched.** With the overlays gone the
   remaining height-sensitive consumers are the water planes, tee markers,
   flags, scatter and the camera clamp, all through the single visible-ground
   sampler. Measure the maximum bilinear-vs-triangle discrepancy across the
   window first; if it is under 2 cm, document it and leave the sampler alone.
   Only if a visible consumer needs it, align the sampler with the fixed
   diagonals and define its value during the 240 ms morph.

### Phase 5 — material and edge tuning

1. Tune per-class transition widths, reviewed at the six holes.
2. Tune grass/sand detail independently at eye height and grazing angles.
3. Verify evening, day, dawn, autumn and fog presets show no unphysical seams.
4. Keep the accepted full-summer rough palette unless a separately reviewed
   colour change is requested.

### Phase 6 — atomic release

1. Run unit, loader, compiler, integrity, WebGL2, WebGPU, performance and
   visual gates.
2. Generate chunks, descriptor, manifest references and expected hashes in one
   release command; update `surfaceDescriptorSha256` from its output, never by
   hand (the runbook's "derived, never typed" rule).
3. Verify `?bana=puttom&v2=require` end to end: no fallback, no
   descriptor-integrity mismatch, one terrain draw, zero overlays.
4. The new format becomes the v2 path's surface format only when every gate
   below passes. GPK1 stays the app default in any case.

## Acceptance gates

Each gate names the instrument that measures it. A gate with no instrument is
a wish.

### Compiler and data correctness

| gate | instrument |
|---|---|
| all input rings valid, or failure with the feature and hole named | topology report |
| every sample classified; no NaN, infinity or uninitialized byte | encoder assertions |
| exactly one non-negative class per texel (rough via complement) | mutual-exclusivity image, empty |
| shared tile/gutter bytes identical | shared-border image, empty; stitcher assertion at load |
| descriptor and chunk hashes verify | existing integrity path |
| decoded assets ≤ 23 MiB target, < 32 MiB hard limit | compiler stats + loader budget |
| surface GPU allocation ≤ 25 MiB | `renderer.info.memory.textures` delta in the capture |
| fragment sampler count ≤ 12 on WebGL2 | `check-app-build` |

### Geometry and boundary correctness

| gate | instrument |
|---|---|
| zero v2 fairway/semi/fringe/green/tee/bunker overlay meshes; zero depth-biased course tiers | capture: `courseSurfaceOverlayMeshes === 0`, `stats.surfaceOverlays === 0` |
| no terrain-coloured holes inside a high-confidence classified interior | pixel-side probe vs compiler class image, ≥ 99.5% agreement at probes ≥ 1 m from any boundary |
| no z-fighting, view-dependent cracks, long shards or false overlay slopes | visual matrix review |
| boundary contour error ≤ 0.25 m against the 25 cm reference, 0.15 m target on reviewed crops | transect tool through `V3D.v2SurfaceProbe`, then pixel-side confirmation |
| CPU probe and GPU pixel agree | pixel-side probe, argmax class identical at every probe |

### Visual matrix

Capture holes 6, 7, 10, 16, 17 and 18 from tee, green, free/oblique, top-down,
and a very close grazing view across at least one boundary junction, under
evening, day, dawn, autumn and fog. The automated smoke pass visits every hole.
The review confirms: continuous outlines without one-metre steps; stable
green/fringe/fairway/semi/rough nests and fairway/semi/rough junctions; sharp
close grass and sand detail; no leaks or black underlay; no broad triangular
lighting discontinuities; stable minification without shimmer (the SDF mips
are what make this passable; if it fails, that is the first thing to check).

### Backend and performance

- WebGL2 mobile, WebGL2 desktop and WebGPU desktop captures pass, including
  the WebGPU readback that is currently open.
- The terrain remains one course-surface draw path.
- **Hardware performance is a human measurement with a procedure**, because
  every capture is SwiftShader (`performanceEvidence: false`). On at least one
  integrated-GPU laptop, one Android phone and one desktop GPU, with `?det=1`,
  record median frame time over the six matrix views before and after; the
  table goes into this document's checkpoint. Investigate any regression over
  10%; the agreed budget is set from the stabilized baseline on the same
  devices.
- No shader compilation warning, texture-limit violation or backend-specific
  filtering difference is accepted.

## Contingency: sparse high-resolution boundary pages

The 1 m per-class SDF is the production representation because a linearly
filtered distance field reconstructs a sub-texel zero contour. If the
close-range matrix still shows curvature error above 0.25 m, add a sparse
refinement tier rather than raising the full atlas resolution.

Measured 2026-09-02: 89,663 of 1,968,897 texels (4.6%) have a different class
within one texel — the ±1 m boundary band is under a twentieth of the window.
A 0.25 or 0.5 m boundary-page system refines only pages touching a boundary,
and needs: a page table compatible with WebGL2 and WebGPU; deterministic
gutters and seam tests; fallback to the full 1 m SDF outside resident pages;
camera-aware streaming with bounded residency; and the same normalized-weight
shader contract. It is attempted only if the simpler representation fails the
measured gate. A full-course 0.25/0.5 m multi-class atlas is not acceptable.

## Non-goals

- Do not modify terrain elevation to solve a material boundary.
- Do not soften final grass or sand colour to hide a classification edge.
- Do not use transparent decals for complete fairways, greens, tees or bunkers.
- Do not linearly filter any numeric ID — class or owner.
- Do not bake a course's channel order into the shader or loader.
- Do not change the terrain tile lattice or the 30-tile surface window.
- Do not touch the GPK1 courses' atlas path or the standalone pages.
- Do not accept a screenshot merely because it contains non-black terrain.
- Do not publish provisional migrated vectors as surveyed authoritative
  surfaces; this plan changes their rendering, not their provenance.

## Primary references

- [Felzenszwalb and Huttenlocher: Distance Transforms of Sampled Functions](https://www.cs.cornell.edu/dph/papers/dt.pdf)
- [Felzenszwalb reference distance-transform implementation](https://cs.brown.edu/people/pfelzens/dt/index.html)
- [Valve: Improved Alpha-Tested Magnification for Vector Textures and Special Effects](https://cdn.fastly.steamstatic.com/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf)
- [Unreal Engine landscape weight blending](https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine)
- [Three.js Material: polygon offset](https://threejs.org/docs/pages/Material.html#polygonOffset)
- [Three.js Texture filtering and anisotropy](https://threejs.org/docs/pages/Texture.html)
- [WebGL 2.0 specification — implementation-dependent limits (`MAX_TEXTURE_IMAGE_UNITS` ≥ 16)](https://registry.khronos.org/webgl/specs/latest/2.0/)
- [Mapbox Earcut robustness and invalid polygon behaviour](https://github.com/mapbox/earcut#robustness)
- [OGC Simple Feature Access](https://www.ogc.org/standards/sfa/)
- `docs/v2-course-runbook.md` — derived / reviewed / measured constants, and why `surfaceDescriptorSha256` is never typed by hand
- `docs/puttom-authoritative-surface-intake.md` — the source this format must also serve
