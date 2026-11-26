# The sea's own shore, 27 November

**Owner report, 27 November (Visby, hole 1, Kväll):** "in the water you can see some square shapes", and "the
jigsaw pattern close to the water", with two screenshots: a staircase of darker rectangles in the bay north of the
first green, seen from above, and a sawtooth along the shore with a brown band behind it, seen from a low eye.

`?seashore=0` is the before of everything below. It moves the near tint's colours on Visby, so like any switch that
is not display-only it turns the prepared tint off when it is used.

## What was wrong

Both faults came from the sea inside Visby's mapped window: the 4,096 m square where the sea is drawn from
Lantmäteriet's surveyed polygons, rather than from the laser.

- **The squares were the water's reflection finding the ground under the sea.** The laser carries the Baltic as a
  flat plate at 0.23 m, and the sheet stands 6 cm above it. The terrain mask removed that plate in the coastal
  extension's 32 m cells. Inside the window it removed it only in cells more than a cell's diagonal (45 m) from
  every shore, so along the whole coast a band of cells kept the plate. The screen-space reflection
  (`water-reflection.mjs`) marches through the opaque world's depth, and it found the plate under the sheet in
  every kept cell and laid its dark colour over the sky's reflection. That drew a 32 m staircase of darker water
  along the coast, and pale rectangles in the far water to the north. With `?waterreflect=0` all of it was gone,
  which is how it was found. Only the temporal-AA path reflects (high quality, desktop), so phones never showed it.
- **The jigsaw was the laser's own coast.** Lantmäteriet flattens the sea in its terrain model on a 1 m raster, so
  the coast in the heights is a staircase: at the 1st hole's west shore the ground reads 0.23 m, then 0.64 m one
  metre inland (`terrainH`, 27 November). The sea sheet is opaque on a measured-only ground (see
  `water-render-policy.mjs`), so its waterline was wherever the sheet cut that step. The terrain's triangles draw
  that cut as a sawtooth, a metre a tooth near the eye and several at the coarser levels. On the land side was a
  pale rim, and on the water side turquoise shallows and white foam.

## The changes

**The sea's shore field** (`engine/coastal-water.mjs` `buildSeaShoreField`, `SEA_SHORE`). This is the signed
distance to the mapped sea's shore over the window, built from the same polygons the sheets draw: positive into
the sea, negative onto the land. Each texel is 3 m, and the field is one byte a texel (a quarter metre a step,
plus or minus 32 m). The rings are filled by scanline, and two exact distance transforms measure each side. The
window's own edge is not a shore, and neither is a cut between two pieces of the partitioned sea. Within three
texels of the coast each texel takes its exact distance to the sea's source shoreline. A centre-sampled raster
puts the coast up to half a texel off, and the fade and the mask are read there. It is read bilinearly, so every
line drawn from it is a curve, not a cell.

**No plate under the sea** (`engine/coastal-terrain-mask.mjs`). Inside the window the mask reads the field
instead of the 32 m cells. The plate is removed wherever the sea lies more than 4.5 m past its shore, so what is
left is a strip under the sheet's faded edge, with a curved border. The reflection has nothing under the sheet to
find. Outside the window the extension's cells are unchanged.

**The waterline, soft** (`engine/water-shading.mjs`). Inside the window the sea sheet comes in from nothing over its
first 3 m from the mapped shore, read per pixel from the field. Over that strip the plate shows, and the terrain's
step lies under water that is still mostly clear. The sheet is drawn with the transparent water for this, and is
whole everywhere else. The shallows, foam and bank terms also take the field's per-pixel distance instead of the
sheet's per-vertex `aShore`. On the sea's long triangles that interpolation had drawn a lighter triangle into the
shallows. Beyond the window the sheet is opaque as before.

**The bank, damp** (`main.js`, the near tint). Ground within 6 m of the window's sea and under half a metre above
the sheet takes the lakes' damp bank (`SHORE_DAMP`, 7 November), and the plate under the faded edge takes their
shallows' silt. So the laser's step is drawn between two wet colours, not turquoise against a pale rim.

## What it costs

- **Boot:** the field is about 1.87 million texels and takes about 200 ms on the owner's desktop, measured in Node
  while other sessions were loading the CPU. At 2 m texels it was about 310 ms. It is built only on a ground with a
  measured coastal sea, which today is Visby alone.
- **Memory:** 1.9 MB for the texture.
- **Per pixel:** one more texture read in the terrain's mask and one in the sea's material. Frame time was not
  measured.

## Evidence

Pictures (`docs/graphics/sea-shore-2026-11-27/`) were taken on WebGPU at high quality, with the evening light the
owner used, before (`?seashore=0`) and after, on the same build:

- `high-south`: above the first hole looking north along the west coast. The 32 m staircase down the whole coast is
  gone.
- `south-mid`: the south shore toward the lighthouse, the owner's second view. The sawtooth, the pale rim and the
  grey grid in the water behind the lighthouse are gone.
- `close-west`: the west shore from 10 m. The waterline comes in over the damp bank.
- `fritt`: the hole's own free view. The pale rectangles in the far water to the north are gone.

Low quality and WebGL2 draw the same shore (looked at on `south-mid`, not kept).

Unit tests: `coastal-water-shore.test.mjs` covers the field's distances on both sides, the window's edge, an
island cut out of a partitioned sea, and that the plate margin lies wholly past the fade. `water-road.test.mjs`
holds the sea material's wiring.

## Not established

- **Phones.** The fade and the damp band are drawn the same on low quality and WebGL2, but no phone has been
  looked at.
- **The seam where the window meets the extension.** Outside the window the extension's shallows still come from
  its 32 m cells, so the straight colour seam recorded on 7 November is still there, about 2 km from the nearest
  hole.
- **The shore beyond the window** is still the extension's cells grown under the bank (7 November), with no fade.
- **Norrfällsviken and Lidingö** have seas of their own kinds (the continuous ocean, and the source-water coverage),
  and are untouched by this change.

## Reproduce

```sh
pnpm exec vitest run apps/golf/src/engine/coastal-water-shore.test.mjs apps/golf/src/engine/coastal-terrain-mask.test.mjs apps/golf/src/engine/water-road.test.mjs
pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8641
# then compare ?bana=visby&hal=1&vy=fritt&ljus=kvall with and without &seashore=0, and with &waterreflect=0
```
