# The grass grown on the GPU (3 November 2026)

Owner request: a realistic, dense mat of rough grass reaching 50 m and more
from the tee, without the triangle look or shimmer, as in EA Sports PGA Tour /
PGA Tour 2K25.

The grass round the ball (`near-grass.mjs`) was one instanced draw of
camera-anchored rings. All of its 458k blade slots were built in the vertex
stage every frame, clump search and class-field reads included, whether in view
or not, at about 1 ms. The rough faded out by about 28 m.

## What it does (`engine/gpu-grass.mjs`)

WebGPU at high quality with the tour turf. After Ghost of Tsushima's
procedural grass (GDC 2021):

- **A compute pass grows the blades**:
  - five nested square rings round the eye, 0.1 m cells near the eye doubling
    each ring out to an 80 m half-width, anchored to world cells;
  - 16 candidates a cell, 800k threads a frame;
  - each blade is placed by a hash of its ring, cell and number, and pulled
    into a Voronoi clump whose height, lean, dryness and tone it shares.
- **What survives** a blade must:
  - fall in its own ring;
  - survive the ring's thinning toward its edge, to a quarter, the next ring's
    density (dying blades shrink rather than pop);
  - stand in the view frustum;
  - stand on ground that grows grass (the rings' own ground grid: no water, no
    shore);
  - stand on a class that grows it (the exact class fields).
- **Colour:** the ground's own at the root, through the same functions and
  terms the ground and the rings use.
- **Sway:** reckoned in the compute pass on the one wind. The pass reads the
  eye from its own uniform, since a dispatch has no camera.
- **Two indirect draws, no CPU work:** survivors are appended with an atomic
  counter into five `vec4` storage buffers (near and far slots in one buffer,
  six storage bindings in all). The counter is each draw's instance count,
  clamped to capacity by a one-thread pass.
  - The two inner rings draw as quadratic-Bézier strips of four segments, the
    outer three of two.
- **LOD and shimmer:**
  - each ring's blades are 1.55 times wider than the ring's inside it;
  - no blade is narrower than 1.3 px;
  - a blade seen edge-on turns toward the eye;
  - beyond 12-45 m a blade's normal leans to the ground's and its gloss goes,
    so far blades read as the sward.
- **Reach:** the rough grows real blades whole to 31 m and gone by 62 m. The
  semi, heath and wetland reach 40-60 m.
- **The mown turf** (fairway, tee, collar, green) grows short blades (1-2.6 cm)
  laid along each hole's mowing, the passes alternating, within 6-7.5 m, at a
  third of the density. At full density out to 15 m they flickered.
  `?grassmown=0` grows none.

The rings stay exactly as they were for WebGL2, low quality and phones.
`?grass=rings` is the before on WebGPU.

## Evidence (RTX 5080, 1920 x 1080; tools in `tools/goldens/gfx/`, local)

- **GPU cost**, Veckefjärden 13 tee, three interleaved rounds, vsync lifted
  (`ab-time.mjs`): no grass 9.10 ms; the rings 10.13 ms (+1.03); the GPU grass
  9.30 ms (+0.20). Between 31k (near) and 26-31k (far) blades survive in the
  Veckefjärden tee views.
- **Shimmer**: with reduced motion (the wind held still) and the temporal AA,
  the mean frame-to-frame difference over the ground, frames 7 apart
  (`flicker.mjs`), Veckefjärden 13 tee:

  | | all | 8-30 m band | near band |
  |---|---|---|---|
  | rings | 0.494 | 0.286 | 0.482 |
  | GPU grass | 0.528 | 0.391 | 0.325 |
  | GPU grass, `?grassmown=0` | 0.383 | 0.309 | 0.175 |

  The far band is noisy from the clouds' drift. The spatial measure (1080p
  against a 4K render scaled down, `det=1`) reads 1.81 for the rings and 2.39
  for the GPU grass. It rises with any fine detail resolved, and the GPU grass
  draws twice the ground.
- **Pictures:**
  - Veckefjärden 10 and 13 tees: the rough band beside the tee matches the
    rings', and blades continue far past the path.
  - From 300 m up it is hidden (above 70 m nothing is dispatched), and the
    Puttom 5 green view is clean.

## Known limits

- The near rough's blades read a little shorter than the rings' at 6-10 m.
- Atomic append order changes from frame to frame. That is harmless for drawing,
  but the blades' order in the buffers is not stable.
- WebGPU only by design. A WebGL2 visit draws the rings.
