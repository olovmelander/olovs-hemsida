# Trees by distance — the LOD plan for the planted forest

Status: phases 1-4 built and measured on the RTX 3070; the desktop tiers at 64 / 24 / 8 px and the course corridor floored at its detail (see the status sections at the end). Written 2026-09-03 after the Puttom v2
boot work; the frame-rate survey it answers is in the session notes and
summarised in "Where the frame goes" below.

## Where the frame goes

Every tree in the scene is the same object at every distance. The planter
puts down ~92,700 trees at Puttom (3,502 LiDAR individuals, ~56,000 stand
trees from the measured field, ~33,000 lattice trees outside the v2
coverage), and each is one of three templates built from three.js
primitives in `main.js` (`SPECIES`):

| species | crown | trunk | triangles |
|---|---|---|---|
| spruce | 7 cones × 12 segments | 9-segment cylinder | 204 |
| pine | 4 cones + an icosahedron | | 212 |
| birch | 5 icosahedra (detail 1) | | 436 |

They are drawn as six `InstancedMesh`es (crown + trunk per species). All
six cast shadows, so the whole population is drawn a second time into the
2048² shadow map; both passes run the GPU wind sway on every vertex; and
`frustumCulled` is per mesh, whose bounding sphere is the whole course, so
nothing is ever culled. Roughly 20–25 million triangles for the trees per
frame, doubled by the shadow pass. Beyond the planted middle ring (MIDR,
±1.3 km) the far cones take over: 57,652 five-sided cones, one draw, no
shadows — a silhouette, which is right for 3 km and wrong for 400 m.

The terrain, by comparison, is 29–42 tiles of 133k triangles per view and
one draw. The trees are the frame.

## How the industry does it

The same four ideas turn up in every open-world renderer that has to draw
a forest, and they are older than any one engine:

- **A LOD chain per tree, chosen by screen size.** SpeedTree's export is
  the reference shape: LOD0 full detail up close, LOD1 at ~50% of the
  triangles, LOD2 at ~25%, and a final billboard LOD — "a very simple mesh
  made of pictures of the tree rendered from different views", where the
  engine drops the views that do not face the camera
  ([SpeedTree docs](https://docs.speedtree.com/doku.php?id=overview_level-ofdetail),
  [Unity's tree LOD](https://docs.unity3d.com/6000.2/Documentation/Manual/terrain-Tree-LOD.html)).
  Unreal switches on screen size rather than metres, so a tall tree and a
  shrub change LOD at the same apparent size
  ([foliage mode](https://dev.epicgames.com/documentation/en-us/unreal-engine/foliage-mode-in-unreal-engine)).
- **Octahedral impostors for the distant ones.** Ryan Brucks's technique,
  popularised by Fortnite and since shipped as an Unreal plugin: the tree
  is rendered from the vertices of an octahedron (or a hemi-octahedron,
  when nobody looks up from below) into one atlas, and at run time a quad
  picks the three nearest views by an octahedral mapping of the view
  vector and blends them — a dozen polygons that reads as a tree from any
  angle ([overview](https://www.moddb.com/news/ue5-update-the-foliage-is-improved),
  [Amplify Impostors](https://80.lv/articles/new-optimization-solution-amplify-impostors)).
  Microsoft Flight Simulator's forests are the same idea at planetary
  scale. In three.js it has been done at scale: a 200k-tree forest on a
  3 km terrain, mobile-viable, with full meshes near, meshoptimizer-
  simplified meshes in the middle and octahedral impostors past 100 units,
  16×16 views in a 2048² atlas with albedo/alpha and depth/normal bakes so
  the impostors are lit and composited by depth
  ([three.js forum](https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735),
  [agargaro/octahedral-impostor](https://github.com/agargaro/octahedral-impostor), MIT).
- **Shadows from the cheap representation, and none from the far one.**
  Proxy meshes cast the shadow while the detailed mesh is only seen
  ([Epic's proxy-shadow tip](https://dev.epicgames.com/community/learning/knowledge-base/ZG87/unreal-engine-tip-shadow-optimization-proxy-shadows)),
  and the last one or two LODs do not cast at all
  ([notes on UE5 foliage](https://medium.com/@shinsoj/notes-on-foliage-in-unreal-5-3522b6eb159f)).
  Cascaded shadow maps put the resolution near the viewer for the same
  reason ([NVIDIA CSM](https://developer.download.nvidia.com/SDK/10/opengl/src/cascaded_shadow_maps/doc/cascaded_shadow_maps.pdf)).
- **Instances in cells, culled and switched per cell.** Unreal's foliage is
  hierarchical instanced static meshes: many instances per draw, culled
  and LOD-switched by cluster; distant clusters can merge into one mesh
  (HLOD) ([foliage mode](https://dev.epicgames.com/documentation/en-us/unreal-engine/foliage-mode-in-unreal-engine)).
  Horizon Zero Dawn places its vegetation on the GPU around the player
  and renders it through the same LOD/impostor discipline
  ([Guerrilla, GDC 2017](https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn),
  [GDC 2018 vegetation talk](https://www.gdcvault.com/play/1025530/Between-Tech-and-Art-The)).
  Ghost of Tsushima's wind is a per-plant rig driven by local wind speed,
  with noise layered on the leaves — and it is the near plants that get
  it ([PlayStation Blog](https://blog.playstation.com/2021/01/12/how-stunning-visual-effects-bring-ghost-of-tsushima-to-life/)).

Nanite (UE5) is the exception that proves the rule: it removes LOD
authoring by streaming triangles at pixel resolution, but "classic low-poly
trees with masked branches" can cost more under it than without
([StraySpark](https://www.strayspark.studio/blog/nanite-foliage-ue5-complete-guide)),
and it needs a GPU-driven rasteriser we do not have in a browser. The LOD
chain plus impostors is the right answer here.

## What three.js 0.185 gives us

`THREE.BatchedMesh` is the piece that makes this cheap to build:

- many instances, several geometries, **one draw** (multi-draw on WebGL2,
  indirect on WebGPU — `RenderObject.js` handles `isBatchedMesh` on the
  WebGPU renderer we run);
- `setGeometryIdAt(instance, geometryId)` switches one instance's geometry
  in place — that IS per-instance LOD, with no re-upload of the instance;
- `setVisibleAt(instance, bool)` per instance;
- `perObjectFrustumCulled` (default on): per-instance frustum culling on
  the CPU, which the `InstancedMesh`es never had.

So the LOD chain per species becomes one `BatchedMesh` holding LOD0, LOD1
and LOD2 geometry with every tree an instance, plus one `BatchedMesh` of
impostor quads with its own material. Six draws, as today. `setColorAt`
carries per-instance tint (the birch season colour, the vertex-colour
variance the templates bake now). On WebGL2 without `WEBGL_multi_draw`
BatchedMesh falls back to one draw per instance, which is unusable; the
extension is universal on desktop and modern mobile, but it must be tested
at boot (`renderer.extensions.has`) with the current `InstancedMesh` path
kept as the fallback — measure phones before believing either.

## The tiers

Distances are for a 12 m tree at the default 48° fov on a 1080-row
viewport; the switch is on projected height, so a 20 m pine changes later
and a 6 m birch sooner. Hysteresis of 10% on every boundary, evaluated per
128 m cell, so a static camera never flickers and a moving one re-tiers a
few cells a frame.

| tier | projected height | distance (12 m tree) | representation | triangles | shadow | wind |
|---|---|---|---|---|---|---|
| 0 hero | > 110 px | 0 – ~120 m | new: dense crown + alpha-tested needle/leaf cards, 16-seg trunk with bark bump | 1,500–3,000 | casts | full, cards flutter |
| 1 | 40–110 px | ~120 – 330 m | today's templates | 204–436 | casts | full |
| 2 | 14–40 px | ~330 – 950 m | decimated: 2 cones (6 seg) + 5-seg trunk, or meshoptimizer-simplified LOD1 | 30–60 | casts (it IS the shadow proxy) | none |
| 3 impostor | < 14 px | ~950 m – MIDR edge, and the whole far ring | octahedral impostor quad | 2 | none | none |

Expected triangles in a tee view (counts from the Puttom population and
the current view distribution): ~400 hero × 2,500 = 1.0 M; ~3,000 tier-1 ×
250 = 0.75 M; ~15,000 tier-2 × 45 = 0.7 M; ~75,000 impostors × 2 =
0.15 M; shadow pass over tiers 0–2 ≈ +1.5 M. About 4 M against ~46 M today,
with per-instance frustum culling on top — while the trees a golfer stands
next to get better, not worse. The far cones (57,652 × 10 triangles, drawn
as silhouettes at 400 m in overhead views) are replaced by impostors from
the same atlas, so the horizon improves for free.

**The hero tier is the point of the exercise**, and it is where the art
goes. The 3,502 LiDAR individuals already carry a measured height and
crown radius; inside 120 m the template is drawn at that size with a
richer crown: the cone stack keeps the silhouette, and 20–40 alpha-tested
cards (crossed quads with a procedural needle-cluster or leaf-spray alpha
baked into a `canvasTex` at boot, like `DETAIL`) hang off it so the edge
breaks up the way a real crown does. Normals on the cards point out from
the crown axis, not along the quad, so the back-lit term still glows.
Trunks get a bark bump and real roots flare. Budget: 2,500 triangles, one
alpha-tested material per species. Alpha test, never alpha blend — sorting
92k crowns is not a thing.

## The impostor bake

At boot, once per species, from the very templates the meshes use, so the
impostor and the mesh agree on shape and colour by construction:

- hemi-octahedron (views from the horizon up; the camera clamps 1.7 m
  above ground and the flight never looks up at a crown), 8 × 8 = 64
  views at 96 px → a 768² atlas per species, two of them: albedo + alpha,
  and normal + depth (depth for parallax and for the impostor's own
  shadow-map footprint if we ever want one). ~10 MB GPU for all three.
- rendered with the same `MeshStandardNodeMaterial` and env map as the
  meshes, under a fixed neutral light, so the atlas is albedo-like; the
  impostor material relights from the baked normal so dusk and noon read
  the same as the meshes.
- 96 px per view is 6× the projected height at which an impostor appears
  (14 px), so the atlas is never magnified.
- the run-time shader: the view vector in the instance's frame (yaw is a
  per-instance rotation, so it is applied to the view vector, not baked),
  octahedral mapping to the three nearest views, weighted blend of their
  albedo and normal, alpha test at 0.5, depth offset from the depth bake.
  This is Brucks's shader; the three.js library above is the reference
  implementation to read, and its bake tool (albedo/normal/depth, hemi
  option, `spritesPerSide`, `textureSize`) is the shape of ours, but it
  targets `WebGLRenderer`; ours has to be TSL on the WebGPU renderer, so
  it is written here, not imported.

The far ring's impostors use the same atlas at a coarser lattice than the
cones today, because a picture of a tree can stand further apart than a
cone and still read as forest.

## Shadows

- Tiers 0 and 1 cast with their own geometry; tier 2 casts with its own,
  which is the proxy-mesh practice — the mid-distance shadow of a 50-
  triangle tree is indistinguishable from the 250-triangle one at that
  size. Impostors do not cast. The shadow camera already fits the view
  (`placeSun`, 260–1150 m), so most casters are tier 2.
- The terrain's own `castShadow` on the whole instanced frontier (forced
  every frame in `#afterSync`) is the other half of the shadow cost and is
  a separate change: cast only from tiles inside the shadow radius, and
  measure whether hill self-shadow is visible at all on 43–102 m ground.

## Wind

Sway stays a GPU vertex term, but tier 2 geometry carries a zero sway
weight attribute (`aSway`), so the mid distance is still; hero cards get an
extra flutter term on their own attribute. No CPU work per frame, as now.

## Transitions

Tier switches happen at 14–40 px projected height, where a pop is a few
pixels. First version: hard switch with hysteresis. If it shows, a
screen-door crossfade (per-instance alpha via `setColorAt`, dithered in
the fragment shader, 0.25 s) is the standard fix — at the cost of drawing
both tiers during the fade, which the three.js forest above chose not to
pay. Decide by looking, not in advance.

## What must not change

- **Where a tree stands.** Placement is untouched: `trees[]`, `treeWhy[]`,
  `V3D.legacyTrees()`, the vegetation baseline and `boot-profile
  --fingerprint` must hash identically before and after. The LOD system
  is a change of representation, never of population.
- **The species rule, the seasons, the reserve's birches** — all upstream
  of instancing; they choose the template, not the tier.
- Boot time: the bake is three offscreen renders of ~64 views each, well
  under a second on a GPU; the BatchedMesh fill replaces the six
  `setMatrixAt` loops it exists in today.

## Phases, each measured

0. **Instrument.** `boot-profile --frames` grows `renderer.info.render
   .triangles` and draw calls per view, plus per-tier instance counts from
   `V3D.stats`; a golden set of six views (tee 1, tee 12, tee 14, Ovan,
   flight cruise over 7, the chooser poster) captured with the vegetation
   baseline tool. Run once on the RTX 3070 with `BANVY_GPU=1` to record
   frame time and triangle counts before anything changes — the survey's
   numbers are from reading code, and the plan should start from
   measurements.
1. **BatchedMesh with two tiers.** Today's templates as tier 1, a decimated
   tier 2, cells with hysteresis, per-instance culling, `aSway` on tier 2,
   `WEBGL_multi_draw` probe with the `InstancedMesh` fallback. Fingerprint
   identical; triangles per view and frame time measured; pictures compared
   against the goldens. This alone should take the tree cost down by most
   of an order of magnitude and is the safest change.
2. **Impostors.** The bake, the TSL impostor material, the impostor batch
   for tier 3, and the far ring re-planted from the atlas instead of cones.
   Gate: the overhead and flight views against the goldens, and a probe
   that reads back the impostor's alpha coverage against the mesh's at the
   switch distance so the silhouette does not shrink at the hand-over.
3. **The hero tier.** Cards, bark, roots, the measured individuals drawn at
   their measured size. Gate: the tee views, judged by eye on hardware —
   this tier exists to be looked at.
4. **Polish.** Crossfade if the switch shows; LOWQ moves every boundary in
   (impostors from ~250 m on a phone); the terrain shadow radius.

Phases 1 and 2 are mechanical and can be built and gated blind on the
SwiftShader harness (fingerprint, triangle counts, goldens); phase 3 needs
eyes on a real screen.

## Status — 2026-09-03

Phases 1 and 2 are built on `claude/tree-lod-phase-1`; phase 0's hardware
measurement is still owed (no GPU machine that day). Two things changed
from the plan above on contact with the engine, and are worth reading
before touching the code:

- **Not BatchedMesh.** On the WebGPU backend a `BatchedMesh` is one draw
  command per instance inside the pass (`WebGPUBackend.js`, the loop over
  `_multiDrawCounts`), and on WebGL2 it needs `WEBGL_multi_draw`; neither
  is "one draw" for 90,000 trees on our primary backend. The container is
  one `InstancedMesh` per (species, part, tier) -- twelve draws -- and a
  tree moves between tiers by a swap-remove in one tier's slot list and an
  append in the other's, matrices copied from a table built once at boot.
  Cells of 128 m decide the tier from the projected height of a nominal
  12 m tree, with 10% hysteresis on every boundary, and a cell outside the
  frustum is in no tier at all: per-cell culling took 83% of the population
  out of the tee view before a tier saved a triangle.
- **The impostors are lit, not baked.** Each species' atlas is two render
  targets -- albedo + coverage, and tree-frame normal + crown mask -- and
  the billboard is a `MeshStandardNodeMaterial` with `colorNode` and
  `normalNode` from the blended frames, so the season tint, the back-lit
  glow and every light preset apply to impostors and meshes alike. The far
  ring's cones are the same impostors from the same atlases.

Measured from the first tee under SwiftShader, same world every time
(`boot-profile --fingerprint` identical to the baseline on every axis):

| | baseline | phase 1 | phase 2 |
|---|---|---|---|
| triangles per frame | 48.8 M | 11.2 M | 10.2 M |
| trees in the frame | 79,407 | 13,609 | 13,609 |
| by tier (full / decimated / impostor) | 79,407 / – / – | 488 / 13,121 / – | 488 / 7,763 / 5,358 |
| far ring | 57,652 cones × 10 tris | same | 57,652 impostors × 2 tris |
| draws | 266 | 278 | 283 |
| boot (page clock) | 24.4 s | 24.4 s | 26.9 s (atlas bake 1.2 s) |

The remaining 10 M triangles are the terrain (29–42 tiles of 133k, drawn
twice with its shadow pass), the ground cover and the buildings; the trees
are now about a million.

Two traps met on the way:

- **A plain number times a TSL node is `NaN`** in JavaScript, and the
  builder writes that `NaN` into the shader as a literal; the vertex shader
  failed with `'NaN': undeclared identifier`. Wrap the number: `float(n)
  .mul(node)`. The verbose profiler run (`--verbose`) is what showed it;
  a plain run reports only "no page errors", because a shader that fails
  to link is a console error, not an exception.
- **`InstancedMesh` and a custom `positionNode` both run** (`NodeMaterial
  .setupPosition` applies the instance matrix first, then assigns the
  position node), so an impostor batch is a plain `Mesh` over an
  `InstancedBufferGeometry` whose instanced attributes the material reads
  by name, as the terrain batch does -- no instance matrix, no surprise.

### The impostors, measured against the meshes they stand in for

The first six-view comparison failed on the impostor views, and the pixel
gate was right: the impostors were upside down, full of holes, green in the
trunk and, against a low sun, 37% too bright. Each had a different cause,
and each is now held by a measurement rather than a look.

- **Upside down.** three's WebGL backend places a render target's viewport
  from the BOTTOM and samples a render-target texture with v flipped
  (`TextureNode.setupUV`); WebGPU does neither. A frame put in place by
  `renderTarget.viewport` therefore lands in a different row per backend,
  and the flip put every trunk above its crown. Frames are placed by the
  PROJECTION now -- an NDC scale-and-offset both backends agree on -- and
  read back with v flipped; `frameNdcOffset` and `frameUv` are held to
  each other by a unit test. Verified by reading the atlas back
  (`V3D.treeAtlas`): the horizon frame's base row is its widest.
- **Holes.** An alpha test over an unfiltered 96 px frame drawn at a fifth
  of its size samples a random texel; the atlases are mipmapped, and since
  clear texels are black at zero coverage the chain is premultiplied by
  construction and the draw divides it back out.
- **Green trunks.** An opaque NodeMaterial forces its output alpha to 1
  (`NodeBuilder.isOpaque`), so the crown mask baked into the normal
  atlas's alpha was 1 everywhere and every trunk took the crown tint. The
  bake materials use NoBlending, which is the one path that writes the
  four channels as computed.
- **Too bright at golden hour, right at noon.** The atlas normal is
  correct: it is the crown's mean face normal, and the CPU's projected-area
  mean over the same template agrees to 0.03 per axis. The error is that
  lighting the MEAN normal is not the mean of lighting the facets. A
  crown's sideways facets cancel in the average, what is left leans up,
  and under an evening sky an up-leaning normal collects light the facets
  never did; at noon the sun is overhead and the mean is honest, which is
  why that view passed. Ablation under `?impdbg=lit` (each term switched
  at run time): the atlas normal 100/122/72 on the far hill against the
  mesh tier's 73/100/56, a normal facing the camera 66/96/50, straight up
  121/134/87, no back-light 95/114/68 -- the direction, not the glow. The
  lighting normal is bent toward the viewer by `IMPOSTOR_BEND` = 0.5,
  swept as a uniform: 0.5 is within 2% of the mesh on the hill and 3% on
  the noon treeline, 0.7 already 6% dark at noon. A calibration, stated
  as one.

The six-view comparison against the baseline (full meshes everywhere,
cones beyond the middle ring), perceptual gate 2.5/255, all views
`--seq` through the same harness:

| view | phase 1 | phase 2 as first built | phase 2 now |
|---|---|---|---|
| 1st tee, golden | 0.06 | – | 0.32 |
| 12th tee, golden | – | – | 0.28 |
| 14th green, golden (the far hill) | 2.15 | 1.63 | **1.46** |
| 7th, top, noon | – | – | 0.00 |
| 5th tee, noon (the treeline) | 0.00 | **2.76 FAIL** | **0.003** |
| 18th green, golden | – | – | 0.85 |

What remains in the 14th's number is the impostors' silhouettes against
the meshes', not their light.

Two harness lessons from the same afternoon:

- **A SwiftShader frame can outlast any fixed wait.** After a uniform or a
  tier change a shot taken 1.5 s later showed the PREVIOUS state, and two
  ablations that "did nothing" had simply not been rendered yet.
  `V3D.frame()` is a monotonic counter; wait for it to advance by two.
- **The debug view is tone-mapped whatever the material says**
  (`toneMapped` is not read by node materials), and ACES turns any dot
  product above 0.3 white. Show a scalar in bands, not in grey.

### Phase 3 — the hero tier

The plan's cards were built and taken out again the same day. Forty
alpha-tested quads with a drawn needle sprig, pine tuft or birch twig, hung
on the crown's rim, do break the silhouette -- and on these trees that is
the wrong thing to do: the crowns are clean flat-shaded cones and blobs, and
a photographic sprig on a facet reads as debris stuck to the tree, not as
foliage. The owner saw it in the first side-by-side and said so. **The
detail a low-poly tree can take is more of what it is made of**, so the
hero tier is the same crown grown at a finer subdivision -- the same cones
and blobs, the same noise, 24-segment cones with height segments and
level-2 icosahedra against 12-segment cones and level-1 -- which makes a
near tree rounder and more organic while it stays unmistakably the tree it
becomes at 120 m. With it, a 12-segment trunk with a bark bump from a
fissure field (the same field colours it, so bump and colour agree) and a
root flare. `?lod=` now counts 1 hero, 2 full, 3 decimated, 4 impostor,
and the tier update is a generic walk across the three boundaries (110 /
40 / 14 px, 200 / 60 / 22 on a phone) with the 10% band on each.

**Measured.** Fingerprint identical to the baseline on every axis; draws
50 -> 56 (the six hero parts); vitest, check-app on all nine courses and the
vegetation baseline pass. Tier counts, frame-settled (`tools/tree-tiers-at
.mjs`), hero / full / decimated / impostor:

| view | hero | full | decimated | impostor |
|---|---|---|---|---|
| 5th tee, noon | 189 | 1,970 | 8,334 | 2,882 |
| 1st tee, golden | 191 | 494 | 8,023 | 4,575 |
| 7th, overhead | 0 | 306 | 2,124 | 0 |

The overhead row is the second thing this phase found: the tier distance
was measured in the ground plane alone, so from 330 m straight up a cell
under the camera counted as one metre away and drew its hero tier at 31
projected pixels. The diff against the previous build was exactly the trees
under the camera. The distance is to the cell's box now, height included,
which also makes the flyover cheaper.

**Boot.** The atlas fix had quietly cost 4.4 s: three regenerates a
mipmapped render target's chain after every render into it, and the bake
renders 64 frames a pass. Generated once at the end of each pass the bake
is 1.65 s (was 5.67 s) and the boot 28.1 s on the harness, against 26.9 s
for phase 2 and 24.0 s before the tree work; the hero tier itself is a tenth
of a second of it.

The six-view comparison against the baseline no longer fits the hero tier's
views: the tee views (1st, 12th, 18th) now differ by 1.9–3.3/255 because
the trees the camera stands beside ARE different, on purpose. That gate
holds for tiers 2–4, which it still measures on the far views; tier 1 is
judged by eye, as the plan said it would be.

Open: phase 0 on hardware, where this tier must be judged; the dithered
crossfade if the 14-pixel switch shows; and the terrain's own shadow
casting, which is now the larger half of the shadow pass.

## Status — 2026-09-04: phase 4 on the RTX 3070

Phase 0 finally ran on hardware (an RTX 3070 Laptop, WebGPU, Chrome 152),
and the owner's complaint from that first look — "the trees change too
much in the close distance when moving the camera" — became phase 4: the
crossfade the plan's Transitions section reserved, plus a change the plan
did not foresee. `docs/specs/tree-lod-phase-4-crossfade.md` is the
reviewed design; this is what was built and what it measured.

**The switch is per tree now, not per cell.** Phases 1–3 decided a cell's
tier from a nominal 12 m tree at the cell's box, so 100–400 trees changed
in one frame whenever the camera crossed a boundary — that block changing
at once was most of what the owner saw. Every tree is tiered from the
pixels its OWN drawn height projects to at its own distance (crown centre,
height included), with the 10% band per tree; the 128 m cells only cull.
The update walks every tree in a visible cell each frame (13k–30k trees)
and costs well under a millisecond (`updateMs`, below).

**A switch is a crossfade** (`engine/tree-fade.mjs`). For 0.3 s a tree is
drawn by both its old and its new tier, and a 4×4 ordered-Bayer mask in
screen space gives every pixel to exactly one of them: at level L of 16
the pixels whose Bayer index is below L show the new tier, the rest the
old, so no pixel is ever blended or drawn twice and every pixel flips
exactly once. The mask is `material.maskNode`, which three 0.185 honours
in the colour pass and, through `Renderer._getShadowNodes`, in the shadow
pass, so a fading tree's shadow dithers with it. The per-instance
`aFade = (start time, code)` attribute is a fifth vertex buffer at most
against WebGPU's eight. Progress is quantised to sixteen levels computed
in f32 by the shader and by a CPU twin (unit-tested to the ULP), with a
1/64-level epsilon, a drain one level after the fade ends, a reversal that
restarts half a level inside its level, and a clock rebased every 512 s.
Under `?det=1` the fade is 0, so every deterministic gate renders instant
switches and yesterday's pictures.

**Measured — the switch itself** (`tools/tree-pop-meter.mjs`, which drives
the fade clock level by level and counts, in the page, the pixels that
moved by more than 24/255 between two readbacks; 1600×900):

| Mode A, the hero boundary pushed out a quarter | instant pop | first fade frame | worst level | whole faded event | drain frame |
|---|---|---|---|---|---|
| 5th tee, noon | 1,279 px | 0 | 93 (7%) | 1,279 | 0 |
| 1st tee, golden | 143 | 0 | 14 (10%) | 143 | 0 |
| 14th green, golden | 302 | 0 | 18 (6%) | 302 | 0 |
| 13th tee, golden | 650 | 0 | 51 (8%) | 650 | 0 |
| Mode B, every visible tree to the decimated tier and back (13,375 fades at once) | 84,619 | 0 | 5,841 (7%) | 84,618 | 0 |

The first frame of a fade is the frame before it, the last is the frame
after, the sixteen levels between them each move about a sixteenth, and
the whole event changes exactly the pixels the instant switch changed.
The slot audit (every drawn slot belongs to one tree as its in or out
entry) passes after the mass fade.

**Measured — what a walk sees.** A dolly of 60 m in 0.25 m steps along
three tee shots, each step measured twice: with the tiers frozen (camera
motion, discarded) and then after the update with the clock stepped
1/60 s, so the number is what tiering alone changed. Three builds of the
same tree through one instrument (`--cell` reproduces the per-cell
decision), and the metric that matters is the mean change over 16×16
blocks — a popping crown moves its blocks by its whole step, a dither
level by a sixteenth:

| | per cell, no fade (phases 1–3) | per tree, no fade | per tree, 0.3 s fade |
|---|---|---|---|
| 5th tee: worst block mean | 17.9/255 | 34.8/255 | **2.0/255** |
| blocks over 6/255 in one frame | 108 | 11 | **0** |
| 1st tee: worst block mean | 34.2/255 | 28.8/255 | **2.5/255** |
| blocks over 6/255 in one frame | 53 | 8 | **0** |
| 13th tee: worst block mean | 13.1/255 | 23.6/255 | **2.0/255** |
| blocks over 6/255 in one frame | 11 | 14 | **0** |
| frames that switched trees (of 240) | 1–4 | 36–112 | 36–112 |

Per-tree switching alone makes each pop small in area (eleven blocks
instead of a hundred) but not in strength — a near tree still changes in
one frame; the fade is what takes the strength out. With both, no frame on
any of the three walks changes any block's mean by more than 2.5/255.

**Gates.** Fingerprint identical on every placement key (trees,
treeInstances, tintNear, tintFar, counts, draws 56); vitest 241 (17 new
for the fade twins); lint; the 12 golden views under `?lod=4` strict
against the previous build (0.10/255) all 12 identical; under `?lod=2`,
10 of 12 identical and the two that were not turned out to be the shot
harness — `shot.mjs --seq` does not wait for the terrain stream, and a
tile landing between the two builds' shots read as a 1.4/255, 18%-of-
pixels difference on the 14th; shot with the stream idle the old and new
builds are identical there (0.0001/255) with trees shown or hidden, at
golden hour and at noon. Two harness rules came out of it and are in the
meter: every event starts from a hysteresis-free state (an instant reset
from a settled camera also flips every tree parked in a band — 19,700
pixels on the 14th that were never the switch under test), and a settle
waits for `loadingTiles === 0` plus two frames.

**Boot on the 3070**: 12.6–17 s wall for `?bana=puttom&det=1&v2=require`
(the range is this machine's other jobs), against 24–28 s on SwiftShader.

**The threshold sweep, and the new defaults.** `tools/frame-time.mjs` boots
with `?gputime=1` and Chrome's frame-rate cap off, so a requestAnimationFrame
interval is a frame time; the six golden views and a 300 m tee-shot walk at
1920×1080, 300 frames each, one boot per setting. The CPU column is the
frame time (the loop is CPU-bound on this machine at 270–570 draws); the
GPU timestamp column varied 4× between otherwise identical runs and is not
reported. Runs with another session's harness on the same GPU read 2–3×
slower and were discarded; these are the clean rows, median / p95 ms:

| view | 110 / 40 / 14 | 80 / 30 / 10 | **64 / 24 / 8** | 48 / 18 / 6 |
|---|---|---|---|---|
| 1st tee, golden | 7.6 / 8.3 | 8.0 / 8.6 | 8.1 / 9.1 | 8.8 / 12.2 |
| 12th tee, golden | 9.2 / 9.8 | 9.9 / 10.5 | 9.9 / 11.2 | 10.0 / 11.3 |
| 14th tee, golden | 8.8 / 9.2 | 9.3 / 10.0 | 9.5 / 10.4 | 9.3 / 9.9 |
| 7th, overhead, noon | 7.5 / 8.1 | 7.6 / 8.3 | 8.2 / 9.2 | 7.0 / 7.6 |
| 12th orbit, golden (the poster) | 9.3 / 9.9 | 9.6 / 10.6 | 10.0 / 11.4 | 10.1 / 11.1 |
| 5th tee, noon | 8.1 / 8.7 | 8.1 / 8.7 | 8.4 / 9.8 | 8.4 / 9.0 |
| walk, 1st tee → green, 1 m a frame | 6.0 / 7.4 | 6.2 / 7.6 | 6.5 / 8.3 | 8.4 / 11.1 |
| triangles, 1st tee | 13.2 M | 13.8 M | 14.4 M | 15.6 M |
| tiers at the 1st tee (hero / full / decimated / impostor) | 93 / 378 / 8,142 / 4,670 | 139 / 1,066 / 10,124 / 1,954 | 191 / 2,276 / 9,627 / 1,189 | 281 / 5,241 / 7,143 / 618 |

Every setting runs above 100 fps on every static view. 64 / 24 / 8 costs at
most a millisecond a frame over the plan's 110 / 40 / 14 and is the desktop
default now: a 12 m tree at 1080 rows is drawn as the hero crown to ~230 m
(was 130), as the full template to ~600 m (was 360) and decimated to the
middle ring's edge, so inside the planted ring the impostor tier only
appears from the overhead. 48 / 18 / 6 costs another millisecond on the tee
views and 40% on the walk for a change no eye sees — at eighteen pixels a
six-segment cone and a twelve-segment one are the same tree — and stays
available through `?lodpx=48,18,6`. The phone thresholds (200 / 60 / 22) are
untouched until a phone is measured. The walk's cost at the far settings was
the tier upload: a swap-remove touches one slot at each end of a tier and
one range from the lowest to the highest slot re-uploaded the whole tier;
the flush now uploads the slots that moved, as runs.

**Gates on the isolated build** (the working checkout is shared with another
session, so the gates ran on a worktree of this branch's HEAD served beside
the previous build): `tools/lod-strict-gate.mjs` — the twelve golden views
under `?lod=2` and under `?lod=4` against the previous build, all 24
identical at 0.0000/255; fingerprint identical on every key; vitest 273
(the 40 files of this tree; `vitest.config.mjs` now excludes the agent
worktrees under `.claude/`, whose copies have no node_modules); lint clean.

**Open.** Judge the hero handover by eye at 64 px (the optional bark
normalisation of the spec's §2.10 is not applied); whether the 4×4 dither
reads as shimmer on a 60–110 px tree on a real screen (the fallback is
`bayer8`, one function and one test); the phone thresholds; the terrain's
own shadow casting, still the larger half of the shadow pass.

**The owner's verdict, and the corridor floors (2026-09-04, later).** The
owner looked at phase 4 and said the trees still changed too much when
moving around; the course should be stable with its detailed trees. The
instruments were right and the rule was wrong: screen-size LOD is right for
a forest and wrong for the trees a golfer is looking at, because as the
camera moves every tree at the boundary distance dissolves into its next
tier, and however soft each dissolve is, the course never stops changing.

So the corridor keeps its detail by where it is, not by how big it is on
screen. A 12 m corridor raster is stamped from the hole lines at boot (the
zones `legacyTreeExport` reports: A within 90 m of a hole line, B within
300 m — 5,036 and 18,084 trees at Puttom), each tree carries its zone, and
the update applies a floor: zone A is never below the hero crown within
500 m of the camera and never below the full template within 900 m; zone B
never below the full template within 900 m; beyond the reaches, and beyond
the property, screen size decides as before. At the reaches a 12 m tree is
29 and 16 px, where the hero crown is the full template and the full
template is the decimated one, so what still switches does not show. The
reaches carry the same 10% band as the pixel boundaries. `?lodpin=a,b`,
`?lodreach=hero,full` and `V3D.setTreeLodPin` override; a forced `?lod=`
tier ignores the floors, so the strict gates keep their meaning. A phone
floors zone A at the full template within 250 m and leaves zone B alone.

Measured on the isolated build (`--query lodpin=4,4` is the same build with
the floors off):

| | floors off | floors, no reach | **floors, reach 500 / 900 m** |
|---|---|---|---|
| 1st tee: triangles, tiers | 14.40 M, 191 / 2,276 / 9,627 / 1,189 | 16.37 M, 918 / 4,409 / 7,270 / 686 | 16.17 M, 737 / 4,590 / 7,270 / 686 |
| 12th tee | 22.04 M, 592 / 1,311 / 16,833 / 6,506 | 29.75 M, 3,676 / 8,213 / 10,262 / 3,091 | 23.96 M, 1,048 / 4,240 / 14,143 / 5,811 |
| 14th tee | 17.48 M | 22.09 M | 20.33 M |
| 7th overhead | 3.97 M | 5.09 M | 5.09 M |
| 12th orbit | 18.64 M | 26.59 M | 20.48 M |
| 5th tee | 15.84 M | 17.44 M | 17.41 M |
| dolly, worst 16×16 block-mean change, 5th / 1st / 13th | 2.0 / 2.5 / 2.0 /255 | 0.8 / 0.5 / 0.4 | **0.8 / 0.5 / 0.5** |
| dolly, trees switched in 240 frames | 228 / 128 / 40 | 30 / 8 / 0 | 52 / 141 / 210 (all beyond the reaches) |

A floor with no reach held 3,676 hero trees in the 12th tee's view — the
corridors of five holes across the lake at 400–800 m — and a third more
triangles; the reaches keep the cost to 9–16% on the tee views (about half
a millisecond of GPU at 1080p) and 28% on the overhead, which is small in
absolute terms. Frame-time rows for this change could not be taken cleanly:
another session was loading the machine and even the floors-off control read
50% slower than the morning's rows; the triangle counts are exact and the
GPU cost is read from them. Fingerprint identical.

## Shadow swimming and the depth buffer (2026-09-04, afternoon)

The owner's next two complaints were the shadows shifting and flickering as
the camera pans, and the terrain "jittering" under motion. Both were measured
before they were touched, on the isolated build of this branch.

**The shadow map moved with the camera in fractions of its own texel.**
`placeSun` re-fitted the sun's orthographic box to the view every frame: its
centre followed the orbit target continuously, so the map's texel grid slid
across the world by sub-texel amounts as the camera panned and the soft PCF
turned that into a shimmer along every shadow edge; and its half-size
re-fitted in 14 m steps, each of which changed the texel size and re-sampled
the whole map. Two rules now (`placeSun`): the box is one of five fixed sizes
(260 / 400 / 600 / 850 / 1150 m half-size) chosen with hysteresis, so a
re-fit is rare; and it moves only in whole texels of its map, measured in the
light's view space, so from one frame to the next the map samples the same
world points. With the sun fixed the shadow camera's rotation is constant and
the rounding is exact; `apps/golf/src/engine/shadow-snap.test.mjs` holds the
basis to three's own `LightShadow.updateMatrices` camera to 1e-9 and proves a
one-texel pan leaves the grid where it was. The normal bias scales with the
fit (0.22 at 260 m, capped at 2.5×), a texel's worth of push whatever the
size. `?shadowsnap=0` and `V3D.setShadowSnap` switch the snap off for a
before/after; `V3D.shadowFit()` reports the fit, the texel and how far the
box was moved to land on one.

**Measured.** A static camera with the snap toggled shows the sub-texel drift
for what it is on this renderer: the box moves 0.27–0.53 texels and no pixel
changes by more than 24/255, the worst 16×16 block by 7–14/255 — a soft
shimmer, not a crawl, which is why a whole-frame pixel count cannot see it
and the pop meter's Mode S measures the far ground under the horizon (rows
42–55 %, where a 0.1 m step is sub-pixel parallax but a shadow's swim is not)
at a 6/255 threshold, snapped and unsnapped in one boot:

| dolly, 120 steps of 0.1 m, far-ground band | snapped, median / p95 | unsnapped, median / p95 |
|---|---|---|
| 5th tee, noon (fit 400 m, texel 0.39 m) | 7.48 % / 8.43 % | 7.81 % / 8.74 % |
| 1st tee, golden (fit 400 m) | 7.68 % / 8.93 % | 7.79 % / **12.67 %** |
| 13th tee, golden (fit 600 m, texel 0.59 m) | 8.31 % / 9.28 % | 8.36 % / 9.35 % |

The medians are mostly ground texture under sub-pixel motion and move 1–4 %;
the unsnapped 1st tee's p95 is the swim's signature — the frames where the
drifting grid crossed a texel boundary and every long evening shadow shifted
at once — and the snap removes it. Judge the rest by eye: the shimmer that is
left on a panning shadow edge is the PCF's own bilinear taps moving over a
fixed grid, which cascaded maps would not change either.

**The terrain "jitter" was the depth buffer, and the WebGPU path runs
reversed depth now.** The camera runs from 1 m to 14 km; a 24-bit fixed-point
depth buffer keeps about half a metre at 3 km, so everything that lies on the
terrain flickers against it as the camera moves. The renderer now boots
three's `reversedDepthBuffer` on WebGPU (`?rdepth=0` switches it off; the
WebGL2 fallback keeps the classic buffer), which the backend backs with
`depth32float`: near-uniform precision to the horizon. Three things had to
follow it, each found by measurement rather than by reading: three passes
`polygonOffset` through unchanged and in reversed depth "toward the camera"
is the other sign, so every nudge in the engine takes `DEPTH_SIGN` from the
renderer's state; this engine's two CPU frustums (`updateTreeTiers`,
`createTileFrustumTester`) pass the camera's depth direction to
`Frustum.setFromProjectionMatrix`, or their near and far planes swap and the
world is culled to sky; and three's `SkyMesh` pins itself to the far plane
with z = w, the NEAR plane in reversed depth, while three reverses its whole
render list under reversed depth — renderOrder included — so the sky drew
last and over everything; it takes z = 0 now. Gated: `check-app` on all nine
courses (the green and bunker probes are what a sunken overlay would fail),
the twelve views reversed against classic within the perceptual gate and
eleven of them within the strict one — the 13th tee's far ground, which
used to flicker, is the view that differs (0.6 % of its pixels) — fingerprint
identical, vitest 276. Two things to know: three's render-list reversal also
inverts the order transparent surfaces are composited in, which the twelve
views did not show and a lake seen through marking might; and any new
`polygonOffset` site must use `DEPTH_SIGN`, never a literal sign.

## The terrain jitter that was the camera (2026-09-04, evening)

"There is still a little terrain jitter." With the depth buffer and the shadow
map settled, the question was what still moves in the picture when the camera
moves, and the answer had to be measured rather than guessed, because every
guess so far (precision, level swaps, the geomorph, shadows, the ground cover)
had been measured away.

**The ground does not shimmer.** `tools/goldens/flicker-map.mjs` is the new
instrument: over a slow walk or pan (5 cm a frame, so parallax past twenty
metres is under a pixel) it tracks every pixel's luma difference frame to frame
and counts SIGN FLIPS — honest motion changes a pixel monotonically for a few
frames, flicker alternates — then draws the flip rate and the mean difference
per 16 × 16 block beside the last frame. At rest under `det=1` it reads exactly
zero everywhere, which is the noise floor a pinned clock buys. Under motion at
the 5th and 1st tees the turf is blank in both maps; the flips sit on the
bottom edge of the frame, where a 5 cm step is several pixels of real motion,
and along tree and marker edges. Hiding every instanced mesh moves the ground
band's flip rate by six to twelve hundredths of a percent — the cover is not
it either. Ground-band flip rates: 1.6–1.8 % at the 5th, 0.8–1.1 % at the 1st,
all of it at the feet.

**The camera bobbed, and the bob was the clamp.** The frame loop kept the
camera out of the terrain with a snap — `if (y < ground + 1.7) y = ground +
1.7`, every frame — and `tools/goldens/camera-bob2.mjs` drove the owner's own
inputs through OrbitControls at three tees while reading the camera's height
at full precision (`V3D.camExact`; `camInfo` rounds to 0.1 m, which is why an
earlier probe saw nothing). At eye height a 3 cm step moves the ground ten
metres out by three pixels. Measured, snap clamp, 1600 × 900, 60 Hz:

| tee, input | camera climb | per-frame step p95 / max | frames that stepped | picture change, stepped vs flat frames |
|---|---|---|---|---|
| 1st, right-drag pan 600 px | none (2.4 m up, ground never reaches it) | 0 / 0 | 0 of 189 | — |
| 5th, right-drag pan 600 px | 1.45 m | 2.8 / 5.6 cm | 77 of 189 | 17.2 % vs 14.1 % |
| 5th, left-drag orbit 300 px | 9.1 m | 26 / 48 cm | 79 of 159 | 56 % vs 15 % |
| 14th, right-drag pan 600 px | 0.25 m | 0.2 / 9.1 cm | 9 of 189 | 12 % vs 38 % |
| 14th, left-drag orbit 300 px | 9.0 m | 39 / 73 cm | 32 of 159 | 43 % vs 50 % |

A driven sideways pan at the 5th that followed the ground the way the clamp
does changed 10.6 % of the picture below the horizon on its stepped frames
against 6.2 % on its flat ones; the same pan at a level height, 7.6 %
throughout. The tee bank rises under the orbit circle, so an orbit at the 5th
or 14th climbs nine metres in steps the size of a footstool — and the snap
never gives that height back, so a small orbit at an uphill tee left the camera
in the air, which is the complaint the old `maxPolarAngle` note describes from
the other side.

**The clamp is a module now, with three rules and a floor**
(`apps/golf/src/engine/camera-clamp.mjs`, seven unit tests):

- eye height is eased toward (time constant 0.12 s), so a bump is a ramp a few
  frames long, never a step;
- the ground is read up to four metres AHEAD along the camera's own motion, at
  a sixth to two thirds of a second, and a rise there sets a climb RATE — the
  rise over the time the nearer horizon takes to reach it — so a bank is
  climbed at a steady speed before it arrives. Two things this had to learn:
  an ease toward the ground ahead takes a fixed share of the whole rise in its
  first frame, more of a kick than the snap; and the extrapolation is a
  straight line while an orbit is an arc — read 28 m out at orbit speed it saw
  a hill off the 14th's circle and climbed 1.4 m in one frame, hence the
  distance cap;
- what the ground lifted, the ground gives back, eased and never faster than
  a glide of 1.5 m/s, and only that: the clamp keeps an account of its own
  lift, so a camera the user raised is never lowered and an orbit down the
  bank comes back to eye height. The glide limit is the third lesson: after
  nine metres of bank the ground along the 14th's orbit circle falls away by
  metres, and an ease alone repaid 1.3 m of it in one frame — a bigger jolt
  than the snap, which never descends at all;
- the hard floor is 1.15 m, the height below which the near plane's lower edge
  (1.0 m plane, 48° lens: at most 1.095 m below the camera on level ground)
  would cut the turf, and it is the only thing left that can move the camera in
  one step.

`flyTo` resets the account, so a placed camera starts clean; the flight resets
it every frame it runs. Measured on the same inputs, with the jerk — the
change in vertical velocity between frames, which is what a jolt is — beside
the step size, and the snap clamp simulated on the very same path:

| input | clamp | step p95 / max | jerk p95 / max | frames jerking > 1 cm |
|---|---|---|---|---|
| 5th tee, right-drag pan | snap, same path | 2.6 / 6.1 cm | 1.20 / 4.49 cm | 14 |
| | eased | 2.4 / 3.9 cm | 0.42 / 1.08 cm | 2 |
| 5th tee, left-drag orbit | snap, same path | 20.8 / 48.5 cm | 17.5 / 47.4 cm | 74 |
| | eased | 20.0 / 25.5 cm | 10.7 / 19.0 cm | 85 |
| 14th tee, right-drag pan | snap, same path | 0.2 / 9.6 cm | 0.12 / 7.72 cm | 5 |
| | eased | 0.4 / 4.3 cm | 0.16 / 1.65 cm | 3 |
| 14th tee, left-drag orbit | snap, same path | 40.6 / 68.2 cm | 18.7 / 43.0 cm | 31 |
| | eased | 38.2 / 53.8 cm | 15.4 / 27.3 cm | 51 |

The climb itself is the ground's own slope and stays — an orbit that crosses
a 9 m bank in 120 frames must rise 7.5 cm a frame on average, and the eased
clamp spreads exactly that over more frames (85 against 74 at the 5th with a
jerk over a centimetre) — but the worst step and the worst jerk halve at the
5th and fall by a fifth and a third at the 14th, and on the pans, where the
rise is gentle, the jolts are gone or a quarter of what they were. Before the
glide limit the 14th's orbit was WORSE than the snap (a 1.3 m frame), which is
the row that made the give-back a glide.

**Gates.** Fingerprint identical (`7a1ca7b1… / 972ad223… / 687fb9a0… /
7b3619f8…`); `tools/clamp-rest.mjs` holds all twelve golden views still for
sixty frames after placement — height unchanged to the last digit, lift
account zero, no pixel off by more than 2/255 (the worst view moves one pixel
by one level) — so the goldens are comparable across the change without a
second build; `check-app` green on all nine courses; vitest green. Two harness
hooks came with it: `V3D.captureRaw` (the drawing buffer as bytes, for an
in-page metric that must not pay for a PNG each frame) and `V3D.groundClamp()`
(the lift account and the constants). `V3D.setShadows` was dropped: toggling
`sun.castShadow` at run time changes no pixel on this renderer, and a switch
that does nothing is worse than none.

**Judge the rest by eye.** An orbit at the 5th still climbs the bank — it has
to — but as a slope, not a staircase, and it comes back down. If a jolt is
still felt on a pan, `V3D.groundClamp().lift` says whether the clamp was
acting at all; if it was not, the motion is OrbitControls' own.

## "Mainly the water glitches and jitters" — the frame at rest (2026-09-04, night)

With the camera settled the owner's complaint moved to the water. The water
was measured first and cleared; what the water was showing was the frame
loop, because at rest the water is the only thing in the picture that moves.

**The water itself.** `tools/goldens/water-flicker.mjs` is the flicker map
masked to the water (the mask is whatever changes when the water is hidden),
with two probe gains in the shader — `V3D.water({glint, chop})` turns the sun
glint and the fine 4 m chop off — and a still, walk, pan and orbit mode.
Under the live clock at rest the water's flip rate is 0.01–0.12 % (the 12th
tee's bay, the 14th's): the waves move smoothly and nothing sparkles, and the
glint and the chop make no difference. Under a 5 cm step the water flickers
LESS than the rest of the frame. Under the owner's own speeds (0.5 m or 0.5°
a frame) it churns two to three times as much as the rest — 8–20 % against
2–6 % — and switching the glint and the chop off takes a fifth of that away;
the remainder is the world-anchored ripple field passing under the pixels at
thirty metres a second, which is what a lake does when you run past it. A
frame-by-frame crop (`water-crops.mjs`) shows the same: a fine speckle on
the body, a bright line where the far shore's edge crawls under the orbit.
Nothing discrete, nothing to fix in the shader.

**The frame loop was the jitter.** `tools/goldens/frame-pacing.mjs` boots
the app as the owner sees it (live clock, HUD on, vsync) and records every
rAF interval: at the 12th tee at rest, median 30 ms with frames from 20 to
55 ms, and 15 ms during a drag that turned the view away. A water animation
advanced on a clock that uneven judders; the still ground cannot show it.
With the frame-rate cap off the frame's raw cost was 9.9 ms (p95 11), and a
CDP profile at rest put 35 % of the main thread in WebGPU `writeBuffer`
alone: three writes a uniform buffer per object per pass, and the scene
census (`V3D.census`, `tools/scene-census.mjs`) counted **477 visible objects
and 611 draws a frame** — 396 of them untagged standard meshes: 144 tee-marker
balls, 82 plates, 100 posts, 36 cups and cloths, each its own Mesh, most of
them shadow casters and so paid for twice. On a 165 Hz display a 10 ms frame
with its GPU tail lands on the third refresh, sometimes the fourth; on 60 Hz
it sits on the edge of one and drops to two. Either way the cadence
alternates, and the water is where the eye sees it.

**And the object count was not the fat.** Instancing the furniture cut the
draws from 611 to 163 and the frame at rest by three milliseconds, and the
profile still put two thirds of the main thread in `writeBuffer` — on both
builds. `tools/goldens/write-buffer.mjs` wraps the WebGPU queue's method in
the page and names the buffers: **38.9 MB a frame, 15.5 ms, at rest** — three
buffers of 64 bytes a slot written whole six times a frame and three of
8 bytes a slot seven times, whose slot counts are the three species' tree
tiers. The tiers were idle (moves and switches constant, nothing fading) and
`flushRanges` returns before touching an attribute with no dirty slot; the
uploads were three's. Its WebGPU `Attributes.update` re-uploads any attribute
whose usage is `DynamicDrawUsage` **every frame, whole, whatever changed**
(`renderers/common/Attributes.js`: `data.version < attribute.version ||
attribute.usage === DynamicDrawUsage`), and the tiers' instance matrices,
their fade attribute and the impostor slots all carried that flag from the
days when it meant "will change" rather than "upload every frame". They upload
their dirty ranges through `needsUpdate` already, so the flag only cost. With
it gone: 0.11 MB and 0.21 ms a frame.

Three changes then, each measured in one boot by the bisection tool
(`tools/frame-at-rest.mjs`, cap off, which hides one thing at a time and
reads the interval and the main thread's longest block):

- **No `DynamicDrawUsage` on the tier attributes** (main.js, `tree-fade.mjs`,
  `tree-impostor.mjs`). The terrain batch keeps its flag: its attributes are
  4 KB and its `tick` bumps `needsUpdate` itself.
- **The shadow map renders on demand.** three's default re-rendered the
  2048² map every frame — a pass over ten million triangles and a third of
  the frame's draws for a picture that did not change. `shadowRest` in the
  frame loop sets `sun.shadow.needsUpdate` only when something that casts
  has moved: the sun or its snapped box (placeSun), a tree tier uploading or
  a fade still draining, the terrain's tile set changing and the 240 ms morph
  after it, a flight — and once a second regardless, so anything not on the
  list catches up within a second. The flag cloths wave but never cast, so
  at rest nothing fires. `?shadowrest=0` is the before; `V3D.shadowRest()`
  reports how many frames rendered it and why the last one did. Measured
  interleaved against the before at the 12th tee on the final build: 8.3 →
  6.8 ms a frame, p95 10.5–14.6 → 8.5 ms, the shadow pass thirteen draws
  once the furniture is instanced.
- **The furniture is instanced.** Tee markers (one InstancedMesh, the tee
  colour on the instance — a white material times it is the colour the
  material used to carry), pin poles, cups, the distance plates (one draw per
  colour, so the emissive stays exact) and their posts: 288 objects became
  seven. The census at the 12th tee reads 140 objects and 163 draws at rest
  (611 before). The twelve golden views are pixel-identical against the
  build before it (`lod-strict-gate --lod 0`: worst view 0.0026/255 mean,
  0.006 % of pixels off by more than 2), and `clamp-rest` holds all twelve
  still.

**Where the frame at rest stands.** The 12th tee, live clock, HUD on, cap
off, a quiet GPU: 9.9 ms a frame with the re-uploads and every-frame shadows
and 477 objects; 6.8 ms now (p95 8.5), of which the trees are most, and the
per-frame buffer traffic is 0.11 MB where it was 38.9. On a 60 Hz display
that is one refresh with room to spare, on 165 Hz two; the cadence no longer
alternates, and the water's animation gets an even clock.

**What the numbers are worth.** Another browser rendering this app on the
same GPU — the other session's, or the owner's own — inflated every timing
run here by two to three times while it was busy, and the bisection's
absolute level moved from 10 to 27 ms between runs for that reason alone.
Interleaved A/B runs (`ab-builds.mjs`, old and new builds booted in turn)
and the CPU block per frame are what to trust; a single run's absolute
number is not. Check the GPU's 3D engine per process before measuring
(`Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage'`).

**A trap that cost a gate run.** The run-coalesced tier uploads
(`flushRanges`, the per-tier dirty lists) from the morning had never been
committed: they lived only in the shared checkout, and every commit since
was staged from the isolated worktree's copy of main.js, which still had the
old lo/hi ranges. The every-frame re-upload hid that completely — three
uploaded everything regardless — and the moment the flag came off, the
committed tier code's lost flushes showed as stale trees in nine of twelve
views, while the one-line "did a tier upload this frame" check threw on the
old tier records at boot. The hunks are in the index now (`git apply
--cached` of exactly the tier region), the worktree copy is built from the
staged file, and the rule for staging from a worktree is: diff the two
copies of main.js first and account for every hunk that is neither the other
session's nor already committed.

## "The terrain flips to another terrain for a split second" (2026-09-05)

The owner's two frames at the 12th green in Höst: the same view, one with the
ground shaded and the shore drawn as the fine 1 m terrain, one as its coarser
parent — different shading, a different waterline — for a frame or two while
the camera moves. `tools/goldens/tile-flips.mjs` reads the stream's plan every
frame under the owner's own inputs (`V3D.v2Plan`: desired, rendered, requested,
retained, ready, loading) and counts the frames where a desired tile is not
rendered and the tiles that leave the rendered set and come back within
ninety frames. Under a left-drag orbit at that view: 77–126 tiles back within
ninety frames, most of them "back after 1 frame", at the frames where "8
desired tiles not rendered, 2 loading".

Two mechanisms, both in `packages/course-v2/runtime`:

- **A tile the plan stopped wanting was released on the next plan** and had to
  be leased and uploaded again when the camera wanted it back, its coarse
  parent standing in meanwhile (the stream controller kept nothing it did not
  want). It now waits out a grace (`releaseGraceMilliseconds`, 1.5 s, at most
  `maximumRetainedTiles` = 48 waiting at once, the longest-unwanted going
  first) and stays resident: the plan sees it and never asks for it again.
  `?tilegrace=0` is the before. Tests: retained through the grace and drawn on
  the first plan back with no request; released after it; the cap.
- **The render rule stands a parent in for its WHOLE quad when any visible
  child is missing** (`renderTileIds`: a desired tile that is not resident
  becomes its nearest resident ancestor, and every resident tile under that
  ancestor is dropped). A refined quad with a child outside the frustum has
  three fine siblings on screen; the moment the camera turns and the fourth
  comes into view for the first time, the three drop to the parent until it
  arrives, and back. That is the flip the owner photographed, and the grace
  does nothing for it — the fourth had never been loaded. The planner now
  wants a refined quad's out-of-view children too, requested behind
  everything the camera can see and retained once they arrive, so a turn
  reveals a resident tile and never a hole in the quad. Test: three visible
  children resident render as three, the fourth is retained and requested
  last, and with it resident a turn renders four.

Measured with the probe at the 12th green in Höst, the same three moves
(a left-drag orbit, a right-drag pan, the orbit back):

| build | tiles back within 90 frames | frames with a desired tile not rendered |
|---|---|---|
| grace off (the before) | 0 / 0 / 126 | 0 / 0 / 13 |
| grace on, no prefetch | 0 / 0 / 77 | 0 / 0 / 10 |
| grace on + sibling prefetch | 0 / 0 / 0 | 2 / 0 / 4 |

The frames that remain are tiles the camera has genuinely never seen,
arriving for the first time, which morph in from the parent as they always
did; nothing on screen falls back to a coarser level any more.

**Two things the gates caught on the way.** The pop meter failed its switch
frame on the new build and passed with `?shadowrest=0`: a crossfade changes
the dither every frame with no upload at all (the clock is a uniform), so the
on-demand shadow map must follow the fade queue — and the check had been
switched off under a driven clock, which is how the meter runs. And the
strict gate's settle captured two frames after the stream read idle, inside
the 240 ms a fresh tile morphs from its parent: a build that kept the tile
resident draws it morphed at once, so the 14th green differed by a morph and
nothing else. The settle waits 350 ms past idle now.

## The trees in flight, and the owner's rule: detail by place, never by distance (2026-09-05)

"The trees are still glitching, I think it has to do with the LOD." Measured
under the bansafari's own flight (`tools/goldens/tree-flicker.mjs`, live
clock, the 5th at noon and the 12th in Höst, six seconds in): the picture's
flip rate is 17–20 % with the trees and 4–8 % without them, and it does not
move when the crossfade is switched off, the impostor tier is switched off,
the hysteresis is widened to 0.35 or the corridor floors are removed — so
what the pixels see is the forest's own facets sweeping under a fast camera,
not any one LOD mechanism. (That probe's flip numbers are also inflated by
its own readback: it captures at seven frames a second while the flight
advances on the wall clock, so `flight-frames.mjs` was written to step the
simulated track one sixtieth of a second per captured frame with the fade
clock driven; see below.) What the LOD does contribute is the switch rate:
55–100 tier switches a second in flight, zero of them reversals (a counter
added for it), each a 0.3 s dithered crossfade somewhere in the forest, and
a six-frame dwell cut that only where the camera slowed.

Then the owner stated the rule that makes the question moot: **no tree on or
around the course may change its detail with distance. Detail is set by
where the tree stands — full on the course and its close surroundings,
lower the further from the course.** `TREE_LOD.lodMode = 'zone'` is that:
the corridor raster stamps three bands round every hole line — A within 90 m,
B within 300 m, C within 700 m — and a tree's tier is its band, hero / full /
decimated / impostor (a phone takes one tier coarser in every band), fixed
for the life of the visit. The screen-size tiers, floors, hysteresis and
dwell are all still there as `?lodmode=screen`, the before for every
measurement and the mode the pop meter measures switching in. Frustum
culling per cell is unchanged and instant, and the crossfade machinery idles
except at boot.

**Measured frame by frame** (`flight-frames.mjs`: the simulated track
stepped at 1/60 s a captured frame under `det=1`, the fade clock driven from
the same counter, 180 frames from three seconds into the 5th's flight at
noon): zone mode makes **0 tier switches a second** against 14 in screen
mode over the same frames, and the two modes show the same 719 event blocks
(a 16 × 16 block whose mean changed by more than 20/255 between consecutive
frames), 4 a frame, at the same frames and places (the 12th in Höst: 0
against 8 switches a second, 676 event blocks in both) — the crop of the biggest
is a hero birch and two spruces ten metres from the camera whose
silhouettes move a few pixels a frame as the drone passes, honest motion
and nothing else. With the trees hidden, 5 event blocks in 180 frames. So
under a deterministic flight nothing in the trees pops in either mode; what
zone mode removes is the switching itself, which the live flight had at
55–100 crossfades a second.

Two consequences, both intended: the golden views change at this commit
(what a tree is drawn as no longer depends on how far the camera stands from
it), so the strict gate against the previous head is run in screen mode to
prove that mode untouched and the zone mode is judged by eye and by cost; and
the cost is the corridors' hero trees whatever the view — measured below.

**What is left.** The remaining draw list at rest — the trees (27 draws, the
bulk of the GPU work), 18 hole signs with their two-sided faces, the sprites
and the water's thirteen sheets — is what the frame costs now, and the trees
are the owner's stability floors, not fat. If the cadence still judders on
the owner's display the next step is the trees' hero tier at rest, measured
the same way.
