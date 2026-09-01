# Puttom v2 surface rendering remediation plan

> **Status 2026-09-01:** investigation and implementation plan. No rendering
> changes are authorized by this document alone. The current regression should
> be stabilized first, and the replacement path must pass the gates below before
> becoming the default.

### Implementation checkpoint — 2026-09-01

- Phase 0's dual-surface regression is removed: ready v2 terrain now creates
  zero course-surface overlay meshes, and the terrain material no longer
  suppresses the six former overlay-owned classes.
- The committed 30-tile preview surface generation is internally atomic and
  remains pinned to descriptor SHA-256 `e0c0ba27322d7426f50a1c1890788a43914ff6ab573d6f31f6c40158887eff1c`.
  It was not rolled back as part of stabilization.
- Phase 1 foundations are available behind `surfaceDebug=weights`: an unlit
  categorical view of the current normalized `pair-sdf-v1` weights and a
  shader-equivalent `V3D.v2SurfaceProbe(x, z)` diagnostic.
- The exact `?bana=puttom&v2=require` path passes mobile and desktop WebGL2
  software capture with one v2 terrain draw and zero course-surface overlays.
  The local software-WebGPU run timed out before reaching terminal state, so
  WebGPU capture/readback remains an open fail-closed gate rather than accepted
  evidence.
- The final per-class SDF payload, exact EDT compiler, multi-class shader,
  visual matrix, and measured hardware performance gates remain pending.

## Executive decision

Puttom's fairways, semi-rough, fringes, greens, tees, bunkers, and natural
surface classes must be rendered by **one physical v2 terrain mesh and one
terrain material**.

Course-wide surface classes must not be represented by independent meshes laid
above or below the terrain. Instead, the surface compiler will produce one
continuous signed-distance field (SDF) per material class. The terrain shader
will convert those fields into normalized material weights and blend complete
material properties on the terrain itself.

The final division of responsibility is:

```text
canonical surface vectors
        |
        v
resolved 25 cm priority masks (offline compilation only)
        |
        v
per-class signed-distance fields
        |
        v
packed 1 m runtime SDF textures
        |
        v
single v2 terrain shader
        |
        v
normalized material weights + sharp world-space detail
```

This fixes both apparently conflicting requirements:

- surface silhouettes become soft, continuous, and free of one-metre jigsaw
  steps;
- grass, sand, mowing, normal, and roughness detail remain sharp at close range
  because only the low-frequency material weights are softened.

## Observed failures

The reported screenshots show three different defects:

1. Stair-stepped boundaries between rough, fairway, fringe, green, tee, and
   bunker surfaces.
2. Dark holes, long shards, material leaks, and view-dependent gaps.
3. Oily or excessively pale/dark triangular areas and blurred-looking close
   material detail.

These defects are related, but they do not have one common filtering fix. The
first comes from the current surface encoding. The second and third are
regressions caused by enabling a second, non-conforming surface mesh system on
top of v2 terrain.

## Confirmed root causes

### 1. V2 renders two independent ground representations

The v2 terrain already renders surface classes in its terrain shader. The
current branch additionally enables six vector overlay batches when v2 is
ready in [`main.js`](../apps/golf/src/main.js#L2233).

The overlays are triangulated independently in
[`surfaceMesh()`](../apps/golf/src/main.js#L2106). Their topology does not share
the one-metre terrain grid or its fixed triangle diagonals. Sampling terrain
height only at overlay vertices therefore cannot make the planar overlay
triangles conform to the terrain triangles between those vertices.

### 2. Every overlay boundary is forced through the terrain

At [`main.js:2131`](../apps/golf/src/main.js#L2131), overlay boundary vertices
are deliberately placed 0.06 m below the terrain while interior vertices are
lifted 0.018-0.086 m above it. A triangle spanning a negative and positive
height difference necessarily contains an intersection contour. This directly
creates terrain-visible cracks, gashes, and irregular holes.

`polygonOffset` and `renderOrder` cannot repair this. Polygon offset changes a
fragment's depth after interpolation; it does not change geometry, make two
tessellations conform, or repair their normals.

### 3. The CPU height sampler does not match rendered v2 terrain

The v2 CPU sampler in
[`v2-puttom-preview.mjs`](../apps/golf/src/engine/v2-puttom-preview.mjs#L302)
uses bilinear interpolation across each grid cell. The renderer uses two fixed
triangles per cell in
[`terrain-grid-topology.mjs`](../packages/course-v2/runtime/terrain-grid-topology.mjs#L54).

Consequently, an overlay vertex sampled at an arbitrary point can already be
above or below the visible piecewise-planar terrain before its small lift is
applied. Terrain parent/fine morphing can create another mismatch because the
renderer may blend heights while the CPU sampler returns only the fine value.

### 4. Actual overlay topology is malformed or under-subdivided

A read-only reproduction of the current Puttom overlay builder found:

- 175 generated overlay polygons;
- approximately 456,500 vertices and 848,700 triangles;
- 14 overlays still exceeding their requested maximum edge after the hard
  five-pass subdivision cap;
- hole 6 fairway edges reaching 5.49 m despite a requested 3.6 m maximum;
- hole 10 fairway edges reaching 4.63 m despite a requested 3.6 m maximum;
- a real self-intersection in the generated hole 10 semi/collar polygon after
  `offsetRing()` and Chaikin smoothing.

The affected code is
[`subdivide()`](../apps/golf/src/main.js#L2022),
[`chaikin()`](../apps/golf/src/main.js#L2092), and
[`offsetRing()`](../apps/golf/src/main.js#L2162). Three.js delegates shape
triangulation to Earcut. Earcut assumes valid non-self-crossing input and warns
that invalid input can create overlaps, gaps, or triangles outside the polygon.

### 5. The base shader deliberately exposes rough beneath overlay failures

Six classes are marked as vector-owned in
[`material.js`](../apps/golf/src/engine/material.js#L20). The v2 shader then
suppresses those classes from the terrain atlas in
[`material.js`](../apps/golf/src/engine/material.js#L298).

At fairway/semi and green/fringe boundaries, both encoded classes can be
suppressed. The fallback then becomes rough. Every overlay intersection or
coverage mismatch therefore reveals a dark, incorrect under-material rather
than a compatible base surface.

### 6. Overlay and atlas boundaries have different authorities

The overlay path modifies rings with `offsetRing()` and Chaikin smoothing. The
atlas path scanline-fills the raw rings and creates padded bands using rounded
segment dilation in [`atlas.js`](../apps/golf/src/engine/atlas.js#L188).

Those outlines cannot be identical. Even a perfectly height-conforming overlay
would leave residual atlas teeth or gaps because the shader and geometry are
covering different two-dimensional regions.

### 7. Overlay lighting magnifies the geometry defects

Overlays calculate their own vertex normals and per-vertex ambient occlusion
from their lifted/tucked geometry. The v2 terrain uses its authoritative packed
terrain normals and a different material path. The overlay rim and conservative
bunker sampling therefore produce false slopes, specular changes, and broad
pale/dark triangular bands.

### 8. The remaining jigsaw is encoded in the current atlas representation

The current atlas stores:

- two nearest-filtered material IDs;
- one linearly filtered signed distance associated with that ordered pair.

Across the assembled 1281 x 1537 Puttom atlas there are 49,854 adjacent-grid
SDF sign crossings. At 14,714 of them (29.5%), the ordered primary/secondary
material pair also changes. The shader therefore interpolates a continuous
number while discontinuously changing what that number means. Three-way
junctions cannot be represented correctly by one pair and one distance.

The 25 cm compiler experiment does not retain a 25 cm field. It computes a
finer boundary raster, then samples it back into the same one-metre pair/SDF
payload in
[`surface-compiler-node.mjs`](../packages/course-v2/surface-compiler-node.mjs#L204).
It can improve a distance estimate but cannot solve the representation's
topology.

## Options considered

| Option | Result | Decision |
| --- | --- | --- |
| More subdivision, lift, skirts, or polygon offset | Still uses two unrelated surfaces; cannot match terrain morphing or normals | Reject |
| Blur or linearly filter class IDs | Produces invalid intermediate IDs or muddy edges without fixing junctions | Reject |
| Full 25 cm multi-class atlas | Excellent resolution but hundreds of MiB for all classes | Reject |
| Vector-clip and remesh every terrain tile | Exact geometry but high implementation, stitching, LOD, and streaming complexity | Do not choose for surface appearance |
| Exact vector distance in every fragment | Resolution-independent but complex and expensive for the current WebGL2/WebGPU path | Reserve as a later fallback |
| Per-class SDFs blended in the single terrain material | Continuous boundaries, correct multiway junctions, bounded memory, no geometry intersections | **Choose** |

## Final surface representation

### Occupying classes

Puttom currently contains ten occupying classes:

- rough;
- semi;
- fairway;
- fringe;
- green;
- tee;
- sand;
- gravel;
- wetland;
- forest.

The payload will explicitly store the nine non-rough SDFs. Because the resolved
regions are mutually exclusive, rough can be reconstructed as the complement:

```text
sdfRough = -max(sdfSemi, sdfFairway, ..., sdfForest)
```

The descriptor/header must carry the ordered mapping between channels and the
surface registry. The implementation must not rely on hard-coded accidental ID
ordering.

### Distance encoding

- One SNORM8-equivalent byte per non-rough class.
- Positive values mean inside the resolved class; negative values mean outside.
- Clamp to +/-4 m.
- An eight-metre encoded range provides a distance step of approximately
  3.15 cm, which is comfortably below the visible edge tolerance.
- Saturated interiors compress well because most of a course tile is far from
  a class boundary.

### Auxiliary fields

Puttom needs:

- owner/hole ID as U8;
- mowing/route coordinate as U16.

The provisional surface payload currently contains unmeasured fields that are
zero for Puttom. A new explicit payload feature/version should omit them; their
bytes must not be silently reinterpreted under the old schema.

The resulting payload is 12 bytes/sample:

```text
9 x SDF U8 + owner U8 + mow coordinate U16 = 12 bytes
```

Across the 30 overlapping 257 x 257 surface chunks, this is approximately
22.68 MiB decoded, below the existing 32 MiB active loader budget.

## Compiler design

### 1. Validate and resolve topology

Before distance generation:

- validate closed, simple rings;
- preserve explicit holes and multipolygons;
- report self-intersections, duplicate vertices, zero-length edges, invalid
  hole nesting, and out-of-frontier coordinates;
- apply the surface priority table once to produce mutually exclusive final
  class regions;
- use one world-coordinate origin for all tiles.

Do not create fragile angle-bisector offset polygons for padded surface bands.
Resolve pads and line widths through the deterministic raster/geometry
classifier, or through a robust polygon offset/boolean implementation whose
output is validated before use.

### 2. Use 25 cm only as the offline source mask

Generate the resolved priority partition at 0.25 m. This moves the source
classification uncertainty below the final visual tolerance without imposing
the memory cost of a full 25 cm runtime atlas.

### 3. Replace chamfer distance with exact Euclidean distance

The current axial/diagonal chamfer propagation has directional bias. For each
class, calculate inside and outside transforms using the separable exact
Euclidean distance transform described by Felzenszwalb and Huttenlocher, then
take the signed square root and clamp it to +/-4 m.

Process one class and one terrain tile at a time with a halo at least as wide as
the clamp: 4 m, or 16 source pixels at 25 cm. Since all farther values saturate,
the halo is sufficient to produce byte-identical values at shared tile borders
without retaining the roughly 180-210 MiB global supersampled working set.

### 4. Emit compiler diagnostics

Each compilation should be able to export debug artifacts for selected tiles:

- resolved class image;
- one image per SDF channel;
- reconstructed normalized weights;
- weight-sum error image;
- shared-border difference image;
- topology error report;
- class sample counts and memory statistics.

These are compiler evidence, not published runtime assets.

## Runtime terrain shader

### Packed textures

The nine SDF channels fit into:

- one RGBA8 texture;
- a second RGBA8 texture;
- one R8 texture.

Route/ring/owner fields remain in a separate packed field texture. Approximate
surface GPU cost is:

- 16.90 MiB for the nine SDF channels;
- 7.51 MiB for auxiliary RGBA fields;
- 24.41 MiB total surface GPU memory.

This is about 13 MiB more than the present atlas, but it removes six overlay
draw batches and approximately 849,000 overlay triangles.

### Weight reconstruction

For each class `i`:

```text
edgeWidth_i = max(physicalTransitionWidth_i, screenSpaceAA_i)
rawWeight_i = smoothstep(-edgeWidth_i, edgeWidth_i, sdf_i)
weight_i = rawWeight_i / max(sum(rawWeights), epsilon)
```

Requirements:

- no class IDs are interpolated;
- all active weights are normalized to sum to one;
- rough is a real participating weight, not a fallback revealed by a missing
  overlay;
- physical transition widths are specified in metres and tuned per class pair,
  initially in the approximate 0.15-0.45 m range;
- `fwidth` or the equivalent screen derivative widens the transition only when
  required to antialias a subpixel edge;
- no cross-shaped blur kernel is applied to the final class fields.

### Complete material blending

The normalized weights blend complete material parameters:

- base colour;
- macro colour variation;
- mowing direction/strength;
- bump/normal strength;
- roughness and gloss response;
- turf, sand, wetland, forest, and hard-surface metadata.

The terrain's authoritative normal remains the geometric normal everywhere.
Per-material bump detail perturbs that shared normal; materials do not create
new geometry normals.

### Preserve close-range sharpness

The SDF atlas controls only *which* material is visible. It must never contain
pre-blurred final grass or sand colour.

High-frequency material detail remains independently sampled in world XZ:

- repeatable grass blade/clump detail;
- mowing bands;
- sand grain/rake normal detail;
- macro colour breakup;
- hard-surface noise.

Use mipmaps for minification and anisotropic filtering at grazing angles. Tune
the detail texture frequency and contrast independently of edge softness.

## Staged implementation

### Phase 0 - stabilize the regression

Goal: remove holes, shards, and lighting glitches before building the new
representation.

1. Restore the v2 condition in `main.js` so vector surface overlays are not
   created when the v2 atlas is active.
2. Remove `VECTOR_OVERLAY`, the style-row ownership flag, and v2 underlay
   suppression from `material.js`.
3. Restore the prior surface descriptor and its exact old chunk set together
   if rolling back the current boundary-oversampling experiment.
4. Preserve unrelated work:
   - the approved summer palette;
   - tee marker/default-tee changes;
   - descriptor-integrity verification;
   - line-ending protections;
   - the corrected v2 half-cell UV alignment.
5. Confirm that `?v2=require` uses one terrain surface and has no holes or
   overlay-driven lighting seams. The older one-metre jigsaw is acceptable only
   as this phase's temporary known limitation.

The worktree currently contains deleted old surface chunks and untracked
replacement chunks. Descriptor, hashes, and chunks must be restored or
published as one atomic set; never mix generations.

### Phase 1 - establish diagnostic evidence

1. Capture the current broken views and stabilized baseline.
2. Add a debug shader mode showing normalized material weights without lighting
   or scenery.
3. Add fixed world-space surface probes and compiler-reference crops.
4. Extend the current visibility-oriented capture proof with surface-edge
   correctness checks.

### Phase 2 - prototype the representation without publishing it

1. Generate true per-class SDF data into a temporary build location.
2. Implement the single-terrain SDF blending shader behind a development flag.
3. Compare 1 m runtime SDFs with local 0.5 m and 0.25 m reference crops around
   holes 6, 7, 10, 16, 17, and 18.
4. Verify WebGL2 mobile, WebGL2 desktop, and WebGPU desktop before changing the
   public surface schema.

A quick pair-expanded SDF can be used only to prove shader mechanics. It is not
production data because the current pair payload cannot reconstruct true
per-class distance at multiway junctions.

### Phase 3 - introduce the final payload and loader

1. Add a new, explicit surface-SDF payload feature/version.
2. Store the ordered class-channel palette in validated metadata.
3. Implement per-tile exact EDT compilation with a 4 m halo.
4. Verify shared-border byte equality before chunk encoding.
5. Update the web loader, atlas assembly, byte accounting, and rejection paths.
6. Keep old-schema decoding only where a real compatibility requirement exists;
   never treat old bytes as the new schema implicitly.

### Phase 4 - complete the terrain material

1. Replace primary/secondary ID selection with the nine continuous SDF
   channels.
2. Reconstruct rough and normalized weights.
3. Blend all style and physical material parameters.
4. Remove v2 course-wide surface overlay creation and shader suppression code,
   not merely hide it behind depth settings.
5. Align any remaining CPU height-sensitive consumers with the renderer's
   fixed triangle interpolation and define their behaviour during terrain
   morphing.

### Phase 5 - material and edge tuning

1. Tune physical transition widths by surface pair.
2. Tune grass/sand detail independently at eye height and grazing angles.
3. Verify that evening, day, dawn, autumn, and fog presets do not reveal
   unphysical seams.
4. Keep the accepted full-summer rough palette unless a separately reviewed
   colour change is requested.

### Phase 6 - release atomically

1. Run unit, loader, compiler, integrity, WebGL2, WebGPU, performance, and visual
   gates.
2. Generate chunks, descriptor, manifest references, and expected hashes in one
   release command.
3. Verify the exact URL:

   ```text
   ?bana=puttom&v2=require
   ```

4. Confirm no fallback and no descriptor-integrity mismatch.
5. Do not make the new path the default until every acceptance gate below
   passes.

## Acceptance gates

### Compiler and data correctness

- All input rings are valid or fail with actionable diagnostics.
- Every sample is classified; no NaN, infinity, or uninitialized value exists.
- Reconstructed weights sum to `1 +/- 1/255`.
- Class priority is deterministic at overlaps and multiway junctions.
- Shared tile/gutter bytes are identical.
- Descriptor and chunk hashes verify.
- Decoded surface assets remain below 23 MiB target and 32 MiB hard limit.
- Surface GPU allocation remains below 25 MiB target.

### Geometry correctness

- Zero v2 fairway, semi, fringe, green, tee, or bunker overlay meshes.
- Zero depth-biased course-surface tiers.
- No terrain-coloured holes inside a high-confidence classified interior.
- No z-fighting, view-dependent cracks, long shards, or false overlay slopes.
- Boundary contour error is no more than approximately 0.25 m against the
  25 cm compiler reference, with a preferred 0.15 m target on reviewed crops.

### Visual matrix

At minimum, capture holes 6, 7, 10, 16, 17, and 18 in:

- tee view;
- green view;
- free/oblique view;
- top-down view;
- very close grazing view across at least one boundary junction.

Exercise evening, day, dawn, autumn, and fog lighting. The broader automated
smoke pass should visit every hole.

The review must confirm:

- continuous natural outlines without one-metre stair steps;
- stable three-way fairway/semi/rough and green/fringe/rough junctions;
- sharp close grass and sand detail;
- no material leaks or black underlay;
- no broad triangular lighting discontinuities;
- stable distance/minification behaviour without shimmer.

### Backend and performance

- WebGL2 mobile passes.
- WebGL2 desktop passes.
- WebGPU desktop and capture readback pass.
- The terrain remains one course-surface draw path.
- Median frame time does not regress more than the agreed measured budget from
  the stabilized baseline; investigate any regression over 10%.
- No shader compilation warning, texture-limit violation, or backend-specific
  filtering difference is accepted.

## Contingency: sparse high-resolution boundary pages

The one-metre per-class SDF is the planned production representation because a
linearly filtered distance field reconstructs a sub-texel zero contour. If the
close-range acceptance matrix still shows curvature error above 0.25 m, add a
sparse refinement tier rather than increasing the full atlas resolution.

The measured +/-1 m Puttom boundary band is approximately 53,000 square
metres, far smaller than the complete surface window. A sparse 0.25 or 0.5 m
boundary-page system can therefore refine only pages touching a boundary.

That contingency requires:

- a page table compatible with WebGL2 and WebGPU;
- deterministic gutters and seam tests;
- fallback to the full one-metre SDF outside resident pages;
- camera-aware streaming and bounded residency;
- the same normalized-weight shader contract.

It must be attempted only if the simpler one-metre per-class representation
fails the measured visual gate. A full-course 0.25/0.5 m multi-class atlas is
not acceptable.

## Non-goals

- Do not modify the terrain elevation to solve a material boundary.
- Do not soften final grass or sand colour to hide a classification edge.
- Do not use transparent decals for complete fairways, greens, tees, or
  bunkers.
- Do not linearly filter numeric class IDs.
- Do not accept a screenshot merely because it contains non-black terrain.
- Do not publish provisional migrated vectors as surveyed authoritative
  surfaces; this rendering plan does not change their provenance.

## Primary references

- [Three.js Material: polygon offset](https://threejs.org/docs/pages/Material.html#polygonOffset)
- [Mapbox Earcut robustness and invalid polygon behaviour](https://github.com/mapbox/earcut#robustness)
- [Unreal Engine landscape weight blending](https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine)
- [Valve: Improved Alpha-Tested Magnification for Vector Textures and Special Effects](https://cdn.fastly.steamstatic.com/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf)
- [Felzenszwalb and Huttenlocher: Distance Transforms of Sampled Functions](https://www.cs.cornell.edu/dph/papers/dt.pdf)
- [Felzenszwalb reference distance-transform implementation](https://cs.brown.edu/people/pfelzens/dt/index.html)
- [Three.js Texture filtering and anisotropy](https://threejs.org/docs/pages/Texture.html)
- [OGC Simple Feature Access](https://www.ogc.org/standards/sfa/)
