# The map mode

Every course as a light 3D map for a real round on a phone, beside the detailed
course. `?bana=<slug>&karta=1`, optionally `&hal=<n>` and `&vy=bana`.

**Phones open it by default** (owner request, 4 November). A plain course link, with
only `bana` and perhaps `hal`, opens the map on a phone, by the player's own test for
one: a touch-first screen with a short side of 768 px or less. Tablets, computers
and any link that says more (a shared view, a harness's `det=1`, a bookmark with its
camera) open the detailed course. `karta=1` is the map on any device and `karta=0`
the detailed course on a phone, and `karta=0` stays when a phone changes course
there. See `shell/map-default.mjs`. A course card's pill and the map's 3D button
offer the other mode, and the player's menu links to the map.

The map is a separate program: `apps/golf/src/map`, about 180 KB of script, with no
three.js and nothing from `main.js`. It draws one frame when something changes and
then stops, so an idle map costs nothing.

## The same world

The map copies no course data and has no bake of its own for terrain.

| What | Where it comes from |
| --- | --- |
| Heights | The published v2 terrain tiles, down to the 1 m core, verified by the same code as the player |
| Holes, greens, tees, fairways, bunkers, water | The GPK1 pack |
| Where each tree stands, its size and species | `planV2Vegetation`, on the same stand and object tiles, with main.js's rules |
| How each tree looks | The player's own impostors, baked by `tools/bake-map-trees.mjs` |
| Forest away from the camera | Canopy stamped from those impostors, masked by the stands (1 m tiles) or the land cover (coarser) |
| Colours | Read off the simulator's summer light |

A republished course reaches the map by itself. A changed tree catalogue does not:
**rerun `tools/bake-map-trees.mjs`**, on the owner's GPU against a dev server.

Keep out of `apps/golf/src/engine`, `loader` and `packages/course-v2`: those are what
`courseSourceRevision` hashes, so an edit there turns the player's prepared startup
data off until the next bake. Importing from them is fine, except `engine/scenery/*`,
which pull in three.js. The three species rules the map needs are copied into
`map-trees.mjs`, and `map.test.mjs` compares them with the originals. The frames in
`map-frames.mjs` are a copy on the same terms.

## How it stays light

- **Every 1 m sample reaches the screen through the pixel, not the mesh.** Each tile
  bakes its slope and local relief into one texture, and heights are read per pixel
  for the contours. The mesh only carries the silhouette, at most every 2 m, so a
  hole is about 150,000 triangles and an overview 33,000.
- **A view reads only what it can show.** Tiles are chosen by how large a sample
  lands on screen. An overview uses no 1 m tiles; a hole uses the 5-10 under it.
  A missing child is drawn as its parent's quadrant, so the ground never opens.
- **A tree is two triangles.** The 3 or 5 species' atlases are about 175 KB each.
- **A slow device steps itself down** (`QUALITY_STEPS`): far trees first, then
  sharpness. The step is remembered. `?mapquality=0..3` pins one. Proven on slowed
  frames on this GPU, where it fell through all three steps; no real phone has
  triggered it.

## Light and surfaces

- One sun, south-west at about 40°, so shadows fall one way. A weaker fill turns with
  the map, from the top left of the screen, so slopes read from any direction.
- Tree and building shadows are their pictures laid along the sun's rays. Stencil
  lets a pixel darken once, so a wood's shadows join instead of stacking up.
- Level ground keeps its painted colour exactly; light only departs from it.
- A small mask says what each surface is (water, mown turf, sand) for its own finish.
- Mowing stripes are concentric strokes about the hole's line, so they bend with it.
- Fairway outlines are softened for drawing only. No distance reads a painted edge.

## What a golfer can trust

Distances are horizontal, measured in the map's world (EPSG:3006 metres) from the
played tee's own position, or the player. Three limits are the data's:

- **No course has been checked on the ground.** Every hole's `accuracyTier` is
  `unrated` or `D`. Placement is proven against the laser survey: every layout's
  greens land on nearly level ground, and dropping the frame's rotation makes that
  worse (`map-frames.test.mjs`). That is not the same as standing on a green.
- **Distances go to the green, not the flag.** Nothing knows today's pin.
- **The korthålsbana's greens are placeholders:** all nine share one 26 m shape. The
  map detects a layout like this (`greensAreGeneric`), marks its front and back
  numbers with ≈ and says so. A second layout like it fails `map-frames.test.mjs`.

## Offline

"Spara" keeps a course's tiles and tree pictures in the map's own cache,
`banvy-map-offline-v1`. Not the shared `banvy-v2-graph`: that holds 256 entries, and
the player's streaming could push a saved course out mid-round.

## Checks

```sh
pnpm exec vitest run apps/golf/src/map
node packages/course-v2/check-app-build.mjs
node tools/serve.mjs apps/golf/dist 8620
BANVY_GPU=1 node tools/check-map-field.mjs --url http://localhost:8620/ --slug visby
BANVY_GPU=1 node tools/map-gallery.mjs --label a --url http://localhost:8620/
BANVY_GPU=1 node tools/map-timing.mjs --url http://localhost:8620/
```

`check-map-field` walks a hole on fake GPS, measures, changes hole, loses the graphics
context and reopens with no signal. It found the worst bug so far: tapping the next
hole with GPS on, from close in, left every point behind the camera and blanked the
map. Run it on more than one course: it took Visby's holes to show that.

The timing tool is the phone proxy of `docs/load-times-2026-11-04.md` (4x CPU, 20 Mbps,
80 ms) on this GPU. On Veckefjärden, 4 November: first picture 2.8 s cold and 1.8 s on
reopen with nothing downloaded, all 1 m ground at 4.1 s and 3.0 s, against 40 s and
8 s for the player. It says nothing of a phone's graphics. **No real phone has run the
map yet**, and its frame rate and battery use are unmeasured.
