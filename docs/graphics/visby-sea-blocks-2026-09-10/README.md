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

Not addressed here: a one-pixel terrain sliver down the middle of tile
l0/5/9 (x −640, z 384 → the shore), present before and after, visible only
from straight above under SwiftShader; and the data-level fact that the
`carveWaterBeds` path is gated off for measured-only grounds, which CLAUDE.md
used to state the other way round and now states correctly.
