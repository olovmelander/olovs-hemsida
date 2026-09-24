# Stable trees during fast camera movement

The September 9, 2026 tree fix targets apparent LOD flipping and sparkling tree
edges on both WebGPU and WebGL2. It requires no new Blender assets or URL flag.

The subsequent [distant-colour correction](tree-distant-color.md) preserves
these stability changes while fixing pale canopies and hollow outlines in the
direct rendering path.

## Keep detail tied to the course

**September 24 update:** at the owner's request, low quality -- the profile
every phone gets -- draws the approved catalogue's **Full** model near the
course instead of Hero: 1,620–1,700 triangles a tree against 4,032–4,500.
High quality is unchanged. Both tiers are fitted to the variant's height and
radius, so every tree stands exactly as tall and wide as before; the zones, the
24 px rule, hysteresis, dwell and fades are untouched. The drawn tier also bakes
the impostors, so the 24 px crossfade meets a picture of the same tree, and it
answers the facility clearance test, so a Full crown (which hangs lower than
Hero's) is tested as the crown it is. `?treemesh=hero|full` selects either tier
for comparison. See [the September 24 measurements](#september-24-phones-draw-the-full-model).

**September 23 update:** the owner approved the measured 24 px distant-Hero
exception as the default. Geographic zone A/B trees keep Hero detail nearby
and use their own baked impostors when their projected whole-tree height falls
below the threshold, with 10% hysteresis, six-frame dwell and existing fades.
Outer zones stay impostors. `?distanthero=0` restores the geographic-only policy
described below; `?distanthero=16` retains the conservative comparison.
See the [GPU and motion evidence](performance-distant-hero-review-2026-09-23.md).

The September 21 default was geographic (`lodmode=zone`). The distance is
from any hole's playing line, rasterised once on a 12 m grid; it is **not** the
distance from the camera. The fix preserves that policy and adds a regression
that runs the application's actual tier update through 180 rapid camera
placements, including repeated frustum exits and reentries.

| Distance from a playing line | High quality | Low quality / phone |
| --- | --- | --- |
| Within about 300 m | Hero mesh | Full mesh (Hero until September 24) |
| Farther out | Impostor | Impostor |

Changing the camera position, altitude, zoom or active view does not change a
tree's geographic base tier. Normal visits use zone mode with the 24 px
exception above; only the explicit opt-out keeps detail independent of the camera.

As of September 21, 2026, the app draws only **Hero and Impostor** trees.
Full and Lite are no longer downloaded, instantiated or selected by either
quality profile. (Since September 24 low quality downloads and draws Full in
Hero's place; Lite stays retired.) The authored Hero geometry also supplies the impostor bake.
The standalone asset studies retain access to the older models for comparisons.
`hero=0` cannot downgrade the app's meshes. Review overrides still work:
`lod=1` selects Hero, `lod=4` selects Impostor, and old `lod=2` / `lod=3`
links resolve to Hero. `lodmode=screen` also resolves every mesh request to
Hero. Diagnostic `tier1` / `tier2` counters remain zero, preserving existing
capture formats without allocating their old geometry or instance buffers.

The higher mesh quality costs more triangles, especially on phones: Hero
models have 4,032–4,500 triangles versus 1,620–1,700 for Full and 108–308 for
Lite. The 300 m corridor, tree placement, density rules and frustum culling
are retained. Reduced downloads and allocations do not imply equal GPU cost;
actual phone frame time requires a physical-device measurement.

### September 24: phones draw the Full model

Measured on the built app with WebGL2 at a 412 × 915 phone viewport, low
quality locked, under SwiftShader with the draw calls skipped. That yields
triangle and draw counts and main-thread time, not frame rate. The before is
`?treemesh=hero` on the same build, two runs each.

| Veckefjärden, phone | Hero (before) | Full (now) |
| --- | ---: | ---: |
| Tree triangles, hole 1 tee | 2.35 M | 0.89 M |
| Frame triangles, hole 1 tee | 7.59 M | 6.12 M |
| Frame triangles, hole 9 orbit / overhead | 8.00 / 3.24 M | 7.14 / 2.56 M |
| Flyover, triangles per frame (median, with the shadow map) | 15.0 M | 12.2 M |
| Flyover, peak | 20.2 M | 14.7 M |
| Tree model download | 2,076 kB | 1,251 kB |

Near-tree counts are identical (523 at the 1st tee), and so is placement: the
same tree totals and facility exclusions at Veckefjärden, Ängsö and
Norrfällsviken. Main-thread time does not change, since the draws and instances
are the same. At the 1st tee the terrain (3.73 M) now outweighs the trees.
Visby's gate passes with only Full requests (1,457 kB against 2,586) and the
same 47 near / 846 impostor tee split; at phone size 1.78% of the tee view's
pixels change by more than 8/255, all on the trees
([comparison](graphics/phone-full-trees-2026-09-24/visby-tee-trees-hero-vs-full.png)).

The change moved the source revision, so tints, water, far vista and scatter
were re-baked for all 13 courses; `check-publication.mjs` in the same folder
proves every record kept its content. Physical-phone frame rate remains
unmeasured. Evidence: [graphics/phone-full-trees-2026-09-24](graphics/phone-full-trees-2026-09-24/).

### September 21 verification

- 87 targeted tests pass, including the actual tier update across high/low
  quality, both backend coordinate systems, 180-position flights, screen-mode
  overrides and historical forced Full/Lite requests. Geographic flights have
  no detail switches; retired tier counts remain zero.
- Production build and the app's no-undefined-variable lint pass.
- The real Visby v2 app renders on WebGL2/SwiftShader at 390 × 844 with
  `q=lo&hero=0`. It requests only seven Hero GLBs plus five species atlases.
  The tee view contains 480 Hero trees and 413 impostors; the overhead view
  contains 100 Hero trees. Camera movement causes zero detail switches, slot
  audits pass, no Full/Lite drawables exist, and there are no page errors.
- Authored model/atlas payload falls from 2,753,641 to 2,125,493 bytes for
  the standard catalogue (22.8%), and 3,508,685 to 2,648,453 bytes at Visby
  (24.5%). These are uncompressed asset bytes, excluding the manifest.
- The Visby tee's tree batches submit 2,160,826 triangles, including the
  impostors. This is a workload count, not an FPS measurement. Physical phone
  performance remains unmeasured.

Reproduce with `CHROME=/path/to/chrome node tools/check-hero-impostor.mjs
--course visby --q lo` against `tools/serve.mjs apps/golf/dist 8620`.
Evidence: [report and captures](graphics/hero-impostor-2026-09-21/).

## What caused the apparent switching

1. **A shader branch could read an uninitialised atlas cell.** In Three r185,
   `select(lower, i0, i0.add(1))` could generate `floor(grid)` only inside the
   lower branch, then reuse that variable in the upper branch and the other
   two frames. The lit-material fixture reproduced triangular flashes and
   wrong atlas samples. Adding the selected scalar offset to `i0` outside the
   branch gives every path an initialised cell origin.
2. **The billboard basis abruptly changed near overhead.** The old `view.y >
   0.999` switch changed its reference axis. The new basis is continuous over
   the baked upper hemisphere, including the zenith.
3. **The three baked views were blended at the same UV.** Their image axes
   differed, and instance yaw/nonuniform scale made that mismatch more visible.
   Each billboard point is now projected into each selected bake camera before
   sampling. The billboard also uses the support of the scaled template sphere
   so tall trees are not stretched/squashed by the old horizontal/vertical
   rectangle when viewed overhead.
4. **A hard 50% alpha test made patches blink.** With two equally weighted
   views, a patch present in only one view has exactly 50% coverage. Tiny camera
   movements could discard or reveal the entire patch. The mipmapped coverage
   now feeds the existing four-sample MSAA directly. Empty texels are discarded
   after atlas colour sampling; the existing complementary fade mask is applied
   at the same point. There is no random transparency noise.
5. **Cell bounds used a nominal 14 m tree and an 8 m margin.** Larger crowns,
   nonuniformly scaled trees and tilted billboard corners could still be on
   screen when their cell disappeared. Bounds now include all actual mesh
   templates, scaled wind displacement and every orientation of the billboard.
   Atlas framing also checks all template vertices against its enclosing sphere.

Tree coordinates, species, measured dimensions, populations and course data
remain unchanged. This addresses reproduced tree-edge pixels and atlas flashes;
it does not change the water material or introduce a particle effect.

## September 9 verification (before the two-tier change)

- The full repository suite passes: **571 Vitest tests and 405 Node tests**;
  three pre-existing Node tests are skipped.
- The actual geographic tier-update regression passes for high/low quality,
  WebGL2 depth and WebGPU reversed depth, with **zero detail changes** during
  each 180-placement flight. Culling/reentry still occurs.
- Real Three shaders run in Chromium on both backends. The fixture uses an
  asymmetric, rotated, nonuniformly scaled tree, rather than a round tree that
  could conceal an orientation problem. It checks the old polar boundary,
  the zenith, atlas frame boundaries, lit materials and fade attributes.
- A subpixel pan of a small distant tree compares hard cutout and filtered
  coverage within the corrected material. Its visible-area range fell from
  approximately **9.39% to 6.15%** of mean area on both backends. This measures
  temporal silhouette stability, not FPS or a promise to eliminate all aliasing.
- The production app builds successfully. Visby's matched WebGL2 low-quality
  overhead capture at 600 × 450 is **pixel-identical** before and after. All
  35,044 tree instances, their positions, routing, georeferencing, vegetation
  source and scene population fingerprints match. The actual-bounds culling
  reduces visible cells from 11 to 8 and submitted full trees from 266 to 213
  in this view: 1,061,799 → 1,049,515 total triangles, with 40 draws in both.
  This is a view-specific culling result, not a hardware speed measurement.
- The full Visby WebGL2 flight passes all **12 rapid camera placements with
  zero LOD switches**, live visibility updates and no rendering errors. The
  [before](graphics/tree-flight-2026-09-09/visby-before.json) and
  [after/flight](graphics/tree-flight-2026-09-09/visby-after.json) reports retain
  the camera, quality, per-tier counts, fingerprints and stream diagnostics.
  Both matched captures use the same
  [overhead image](graphics/tree-flight-2026-09-09/h1_top_noon.png), since their
  pixels are identical.

Evidence: [`graphics/tree-flight-2026-09-09/`](graphics/tree-flight-2026-09-09/).
The renderer captures use **SwiftShader software rasterisation**. A physical
phone/desktop performance measurement is still separate from these correctness
checks. The larger conservative cell bounds can retain extra trees near screen
edges; the shader retains six atlas texture reads and moves frame projection
work to the vertices. Tree counts and detail bands are not increased.

Reproduce the small shader proof from the repository root:

```sh
node tools/tree-flight-review.mjs --out /tmp/tree-after --chrome /path/to/chromium
node tools/tree-flight-review.mjs --out /tmp/tree-before --chrome /path/to/chromium --ref 81fbd2c
```

The proof builder selects the historical material only; both runs use the same
fixture. An additional `--backend webgl2` or `--backend webgpu` limits a diagnostic
run. The main application capture tool accepts `--tree-flight` to record live
tier counters across 12 rapid placements without freezing the tree system.

See also the established [geographic LOD policy](tree-lod-plan.md) and Three's
[MSAA alpha-to-coverage documentation](https://threejs.org/docs/pages/Material.html#alphaToCoverage).
