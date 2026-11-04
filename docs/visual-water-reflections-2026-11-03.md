# Water that mirrors its shores (3 November 2026)

Owner request: a calm pond should mirror the trees, banks, buildings and hills
round it. Until now a lake reflected only the painted sky, the sun's road and a
dark far-shore band (`nordic-water.mjs` `waterTreeLine`), so no pond showed the
wood standing on its bank. That was the biggest remaining "fake" look.

## What it does

`engine/water-reflection.mjs` is a screen-space reflection traced by the
water's own material (`water-shading.mjs`), not a post pass. The water is the
only surface that mirrors. It knows its ripple normal, its Fresnel and the
analytic reflection it falls back to.

- **The copy.** When the first water sheet of the scene pass draws, three's
  `ViewportTextureNode` copies the opaque world's colour (half float) and depth
  (float under the reversed buffer). The copy is gated (`GatedSceneCopy`) to
  the scene pass's own single-sample target, the temporal AA's. It never copies
  a bake, the impostor atlas or the runtime drop's direct draw.
- **The march.** Each water pixel marches its reflected ray in world metres:
  - 32 geometric steps from 0.25 m, growing by 1.28, about 2.4 km in all,
    interpolated in clip space;
  - the start is jittered per pixel and frame (interleaved gradient noise), so
    the coarse far steps average out under the TAA;
  - the first step behind the depth buffer, within the step's depth plus a
    thickness, is bisected to the crossing.
- **Far land and sky.** A ray that leaves the march still on screen reads the
  pixel its direction vanishes to, if the world there is far (distant hills,
  the sky and its clouds). Past two kilometres the reflection's parallax is
  negligible.
- **The ripple.** The ray is reflected off a calmer surface than the chop's:
  0.42 of the wave slope near, 0.12 far.
- **Fades.** The found reflection fades out toward the screen's edges, most at
  the top where reflected rays leave, and over the last stretch of the march.
  Where nothing is found, the water keeps exactly the reflection it had before.
- **The mix.** What is found replaces the sky reflection by its weight. There
  the water mirrors 0.92 of its Fresnel rather than the painted sky's 0.42.
- **The sun's road stays on top.**
  - A calm ray's hit stands in front of the sky's sun glow, as the far-shore
    band did. The ripples' steeper facets still mirror some of the bright sky
    round a low sun, so 40% of the glow (`glowOver`) lies over what is found.
  - Over everything found, the sun-road dabs are added afterwards, unchanged.
  - With all of the glow kept over the hits (tried first), the fjärd at golden
    hour washed peach and lost the wood. With none, the glitter path dimmed.

## Where it runs

High quality with the temporal AA only: the copy needs the scene pass's
single-sample target. MSAA (`?aa=msaa`, `det=1` harnesses, low quality, phones)
and the runtime drop keep the before. `?waterreflect=0` is the before at high
quality. Use `--query aa=traa` to see it in `det=1` captures.

## Evidence (RTX 5080, 1920 x 1080)

- **Pictures** (`tools/goldens/gfx/view-probe.mjs`, its `w<eye>` mode on the
  bank of the nearest lake; local, ignored):
  - Puttom 1: the lake beyond the birches mirrors their trunks and crowns.
  - Ängsö 3: the pond mirrors its far-bank trees, stakes and clouds at noon,
    golden hour and blue hour.
  - Johannesberg 1: the pond mirrors its wood.
  - Veckefjärden 14 green: the fjärd shows the far wood's image below its shore
    in place of the flat band, with the sun's road intact.
  - From 500 m up the lakes stay water, with nothing at the screen's edges.
  - WebGL2 matches WebGPU.
- **Cost.** Interleaved A/B, two rounds, vsync lifted, `fps=0`
  (`tools/goldens/gfx/ab-time.mjs`): Johannesberg 1 with the pond across half
  the screen, 6.70 ms before and 7.10 ms after (+0.4 ms).
  - On the build that ships (4 November): Johannesberg 1, 4.90 ms before and
    5.30 ms after (+0.4 ms again).
  - Veckefjärden 13 tee is the other way round: 8.07 ms before and 7.77 ms
    after (-0.3 ms) in three rounds with the before timed first, and 8.15 and
    7.80 ms in two rounds with it timed last. The cause is not known.
  - The timestamp sum (`V3D.gpuTime`) under-reads with the reflection on. The
    copy ends and restarts the scene's render pass, and only the second half
    keeps its queries. Time this feature by frame intervals, not by that sum.
- **Boots.** 52 clean boots (13 courses, both backends, hi and lo, `aa=traa`).
- **Tests.** `water-reflection.test.mjs`: the march's reach and jitter, the
  gate, the formats, the wiring and the order (the reflection before the mix,
  the road after).

## Known limits

- Like every screen-space reflection, it can only mirror what is on screen.
  The underside of a crown, or a bank behind the camera, falls back to the
  painted reflection, and the fade hides the seam.
- Opaque sea sheets (Norrfällsviken's ocean, the measured seas) draw in the
  opaque queue at render order 5, so the copy taken there misses what draws
  later: bridge decks at order 7.
- The TAA reprojects a water pixel by the water surface's own motion, not its
  reflected image's. In motion the neighbourhood clamp holds the difference to
  a short trail.
