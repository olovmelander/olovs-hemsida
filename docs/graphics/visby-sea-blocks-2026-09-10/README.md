# Visby: the square shapes in the sea (2026-09-10)

The owner's phone (WebGL2, performance mode) showed dark rectangles hugging
Kronholmen's whole coast in a 32 m staircase, with lighter open sea beyond.

Reproduced headless on the built app, SwiftShader WebGL2, `?bana=visby&v2=require
&det=1&q=lo&gl=1`, camera 1,000 m straight above (−450, 450), 600 × 800.

| file | what it shows |
|---|---|
| `before-normal.png` | the blocks as shipped |
| `before-water-hidden.png` | `V3D.setWaterVisible(false)`: the laser plate under the sea survives the coastal terrain mask only inside the mask's own shore margin (a 32 m cell diagonal), as a staircase of brown cells; beyond it the plate is gone and the sky shows |
| `before-terrain-red.png` | `V3D.v2WorldMaterial({colour:[1,0,0], unlit:true, fog:false})`: every dark block is exactly the sea sheet blended over a surviving red cell |
| `after-normal.png` | `waterSheetIsOpaque`: a sheet with no bed drawn under it is opaque, so the sea no longer paints whatever is behind it |

The cause was never the mask being wrong: both probe points were inside the
masked zone by the CPU field. The sea sheet was 62–97 % transparent (the ramp
that lets a carved lake bed read through the shallows) and Visby, a
measured-only ground, never carves a bed and never draws one (`showBed` false)
— so the sheet showed khaki plate in the margin cells and pale sky past them.

## The hairline along the tile edge (same day, second pass)

`after-normal.png` still carried a one-pixel line of terrain in the sea. The
first reading here put it "down the middle of tile l0/5/9 at x −640" -- that
was a camera-orientation error (the overhead view is rotated 180°; calibrated
on the hole-1 disc it lies on the tile edge x −256). It is a TILE SKIRT: the
vertical quad hanging 1.5 m below every tile edge, seen edge-on from 1,000 m
up. Proved by elimination on experimental builds of the same view: it stays
with the mask's coverage texel test removed and with the geomorph removed,
goes with the skirts removed (`skirts-only-nomask.png` shows the whole 256 m
skirt grid as hairlines) and goes with the mask's height ceiling raised to 5 m
-- so the fragments carried a height between 0.28 and 5 m over a plate at
0.23. That is the varying being interpolated at the PIXEL CENTRE, which for an
edge-on sliver lies outside the triangle: an extrapolated height. The mask now
reads a centroid-sampled world position (`vCoastalMaskWorld`), which stays
inside the covered samples, and `after-centroid-normal.png` /
`after-centroid-terrain-red.png` are the same view with the line gone.

Also corrected the same day: CLAUDE.md used to say the `carveWaterBeds` path
runs unconditionally under v2 on Visby; it is gated off for measured-only
grounds and the file now says so.
