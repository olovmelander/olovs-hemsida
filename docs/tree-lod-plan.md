# Trees by distance — the LOD plan for the planted forest

Status: phases 1 and 2 built (see "Status" at the end); phase 0 on hardware and phase 3 open. Written 2026-09-03 after the Puttom v2
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
