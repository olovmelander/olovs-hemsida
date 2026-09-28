# Sparkling crowns, 28 September

**Owner request, 28 September:**

> "When we are having hi quality mode on desktop there are a lot of sparkling
> particles as we move the camera around, i do not know what these sparkling
> particles is and we need to audit, investigate and find what they are and how
> we can remove them."

**What they are: the tree crowns.** Each mesh crown is a cloud of leaf cards
cut out of its species' leaf atlas by an alpha test at 0.5. MSAA smooths the
edge of a triangle, never a cut inside one, so every pixel of a crown's edge
and of every gap in it was all leaf or all sky. Against the bright evening sky
a move of a fraction of a pixel opened and closed those gaps a whole pixel at
a time, and bright points flashed on and off across every crown: the sparkling
particles. The impostors, the trees far off, have been cut through the MSAA
samples since 9 September ([tree flight stability](tree-flight-stability.md));
the mesh crowns never were. Bloom and the grass round the ball are not it, and
the water's glints are its sparkle by design (below).

**The fix: the crowns' cut goes through the samples too.** The same cut now
chooses how many of each pixel's four MSAA samples a leaf covers, as the
impostors' does, centred on 0.5 so a crown keeps its area.
- In the app, toward the evening sun from Ängsö's first tee, the strongest
  flashes fell by three quarters (52 a frame to 12) and two-sample ones by half;
  over Puttom's forest from the 12th's orbit, flips of every strength fell by a
  third and more.
- On all five species in isolation, whole-pixel flips of the crowns' silhouette
  fell from 193 a camera step to 5-6, on WebGL2 and WebGPU alike.
- The crowns keep their area and their colour within 0.1%.

**`?crowncoverage=0`** is the before. It is drawn, not prepared: it keeps the
prepared startup data eligible, so an A/B pair differs only in the cut.

This follows [the September 9 sparkle](tree-sparkle.md), where a bright solar
disc flashed through gaps in foliage and was removed. The gaps themselves stayed.

## Why the crowns sparkled

- **The cut.** `ghibli-foliage-material.mjs` set `alphaTest = 0.5` and
  `alphaToCoverage = false` on the crown cards. A fragment was kept whole or
  dropped whole. 4x MSAA gave every triangle edge five levels of coverage and
  every cut edge two.
- **The sky behind.** At golden hour, the default light, the sky beside the
  sun is peach at 0.48 of linear luminance and a crown's shaded leaves 0.08. A
  gap opening is a jump of 150-170/255 on the screen.
- **The motion.** Any movement of the camera slides every sub-pixel gap and
  edge across the pixel grid. On 10 September the camera's breathing drift did
  this at rest; it was made opt-in (`main.js`, `?breath=1`), with the note that
  4x MSAA could not hold the twinkle. It could not because of the cut: MSAA
  never saw it.
- **Why the desktop's high quality.** Both qualities draw the same crown
  material under the same geographic rule and the same 24 px distant-Hero
  threshold. High quality draws the Hero model, 4,032-4,500 triangles a tree
  against the Full model's 1,620-1,700 at low quality: more card edges to flip.
  Low quality was not measured here.

## How it was found

The full app renders in this container on WebGL2 under SwiftShader (640 × 400,
about 12 s a frame). The probe took over the app's frame loop, stepped it by
hand and crept the camera 0.12 m and 0.04° a frame, the glitter meter's own
creep (`tools/glitter-meter.mjs`), with clocks pinned (`det=1`). Each frame it
read back the picture, the scene's linear colour and the bloom's own high-pass
target.

**The view.** Ängsö, hole 1, the tee view, golden hour, high quality. The sun
stands 12.5° up, 26° right of the view: the lit sky behind the crowns is at its
brightest, and the Hero crowns stand against it at 20-150 pixels tall.

**The measure.** The glitter meter's flip: a pixel whose display luminance
jumps by more than 40/255 from one frame to the next while its eight neighbours
move by less than 10 on average. With 4x MSAA one sample of a crown against
that sky is already a step of about 42, so each flip is also split by strength:
over 80/255 is two samples or more, over 120/255 a whole pixel turning over.

**What each thing contributes**, per frame step over the whole frame (the mean
of four; each switched off in the same boot, two boots):

| Condition | Flips | Over 80 | Over 120 |
| --- | ---: | ---: | ---: |
| As is | 296-304 | 98-103 | 54-56 |
| Bloom strength 0 | 301 | 104 | 59 |
| Grass round the ball hidden | 295 | 94 | 51 |
| Every tree hidden | 109 | 0.5 | 0 |
| Hero crowns hidden | 273 | 15 | **0.2** |
| Impostors hidden | 287 | 133 | 71 |
| **Crowns cut through the samples** | 258 | **50** | **12** |

- **The strongest flashes are the Hero crowns' cut alone.** With the crowns
  hidden, flips over 120/255 fall from 54-56 a frame to 0.2. What is left behind
  them (impostors, trunks, the sky) moves by parts of a pixel.
- **The bloom is not it.** Its strength at 0 changes nothing. Its high pass, read
  back each frame, takes only the thick cloud centres beside the sun in this
  view: no tree, no grass, no water. It runs at half resolution on a 2 × 2
  average; worked through its five blur levels, a lone pixel needs a linear
  luminance of about 15 before its halo shows. Crowns are unlit paint (0.45 at
  most at golden hour) and the grass stays under 0.5.
- **The grass round the ball is not it.** Hidden, nothing changes. Its blade
  tips do change from frame to frame, by less than a flip.
- **Nine in ten of the bright isolated points are trees** (the glitter meter's
  still-picture count: 1,180 in a frame, 112 with every tree hidden): sky seen
  through gaps and between narrow crowns.
- **The cut through the samples** leaves a quarter of the strongest flashes and
  half of the two-sample ones; the silhouette still moves, by parts of a pixel.
  (A runtime switch in the same boot, before the change was built.)

**The fix in the built app**, as the player now draws it, against
`?crowncoverage=0` in separate boots of the same view:

| View, per frame | Build | Flips | Over 80 | Over 120 | Summed strength |
| --- | --- | ---: | ---: | ---: | ---: |
| Ängsö 1st tee, toward the low sun: crowns against the sky | before | 291 | 98 | 52 | 22,800 |
| | now | 253 | 48 | **12** | 16,700 |
| Puttom 12th, from the orbit: crowns against grass and water | before | 746 | 91 | 2.8 | 44,000 |
| | now | 483 | **32** | 1.3 | 26,200 |

Summed strength is the flips' luminance jumps added up (/255), a frame's worth
of flicker. Pictures: [Ängsö](graphics/tree-sparkle-2026-09-28/angso-tee.jpg)
and [Puttom](graphics/tree-sparkle-2026-09-28/puttom-12-orbit.jpg), one step's
flips ringed by strength (magenta a whole pixel, orange two samples, cyan one)
before and now, and the nearest crowns magnified over two frames. No page
error in any of the four boots.

## The change

**`msaa-coverage.mjs`**, new:
- `coverOpaqueBackdrop(material)`: alpha to coverage, with the blend the
  impostors already used. Alpha selects the samples; RGB replaces each covered
  sample; an opaque backdrop keeps its alpha. Written as alpha, coverage would
  leave the resolved frame translucent at every edge, and the output transform
  would draw dark hollow outlines. Moved from `tree-impostor.mjs`, which now
  imports it: the impostors are cut as before.
- `centredCoverageCut(alpha, cut)`: the alpha test that centres the samples'
  ramp on the hard cut. three turns alpha into coverage over one pixel's change
  of alpha *above* the test (`NodeMaterial`: smoothstep from the test to the
  test plus `fwidth`), which would draw a crown half a pixel inside its hard
  cut: the tee view's nearest conifer lost 3.3% of its area that way, and more
  sky showed through. Lowered by half that change, the ramp straddles 0.5, and
  the crown keeps its area (0.4% there).

**`ghibli-foliage-material.mjs`**: the crown cards take both, behind a
`coverage` option, on by default. `coverage: false` builds main's material
exactly.

**Unchanged:**
- the shadow pass: it copies `alphaTest` (still 0.5) and cuts with the cards'
  own `maskShadowNode`, and never reads alpha to coverage;
- the impostor bake: it draws the crowns with its own materials;
- the crossfade's dither (`treeFadeMask`), the back-light, the colours;
- low quality: the Full crowns take the same cut.

A target with one sample has no samples to share: three turns alpha to
coverage off there and draws the fragment whole, from half a pixel of alpha
outside the hard cut. Only harness read-backs render that way.

`main.js` passes `coverage: CROWN_COVERAGE_ON` to the drawn crowns;
`?crowncoverage=0` is the before, listed with the display-only switches that
keep prepared startup eligible (`prepared-ground-tint.mjs`).

## What it costs

Per crown fragment: one `fwidth`, alpha to coverage, and a blend that replaces
the colour and keeps the backdrop's alpha. No draw call, pass or texture is
added. Nothing was timed on a GPU.

## Evidence

**Unit tests** (`crown-coverage.test.mjs`):
- the crown cards are cut through the samples, and `coverage: false` is main's
  hard cut; the alpha test stays 0.5 and the shadow keeps its cut; a crown
  without cards has nothing to cut;
- under the blend, each covered sample takes the fragment's colour and an
  opaque backdrop stays opaque, at every alpha;
- the centred ramp keeps a linear edge's area within 0.2%, and three's own ramp
  draws it half a pixel inside;
- the pinned three still ramps from the test to the test plus `fwidth`, which
  the centring assumes;
- the wiring in `main.js`, and the impostors' use of the shared helper.

`visual-fix-switches.test.mjs` keeps `?crowncoverage=0` display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/tree-sparkle-2026-09-28/check-isolated.mjs),
[page](graphics/tree-sparkle-2026-09-28/isolated.html),
[result](graphics/tree-sparkle-2026-09-28/isolated-check.json)). The player's
own Hero trees, all five species, crown depth baked and lit as golden hour
lights them, stand in rows from 60 m to 480 m (20 to 150 pixels tall) against
the app's measured golden-hour sky, and are drawn through 4x MSAA. Main's
material is generated from git at `f05006e8`. The camera pans in twelve steps of
0.015°, about a seventh of a pixel. Each frame is read back linear, in colour and
as a mask (black crowns on white, exactly 1 - coverage).

| Per step | WebGL2, before | WebGL2, now | WebGPU, before | WebGPU, now |
| --- | ---: | ---: | ---: | ---: |
| Whole-pixel flips of the silhouette | 193 | 6.3 | 194 | 4.8 |
| Area the silhouette sweeps (pixels) | 369 | 369 | 368 | 370 |
| Flashes over 120/255 | 103 | 7.3 | 105 | 7.6 |
| Flashes over 80/255 | 177 | 83 | 179 | 87 |
| All flips over 40/255 | 308 | 301 | 305 | 301 |

- **The before is main's**, value for value, in every frame, colour and mask.
- **The same motion, in parts of a pixel.** The silhouette sweeps the same
  area either way; it now does so a sample at a time.
- **The crowns keep their area** (-0.1%) **and colour** (the mean over the
  pixels they cover within 0.1%).
- **The frame stays opaque**: no pixel's alpha falls under 1.
- **It compiles and draws the same on both backends**, with no page or
  console error.

**App boot**
([`check-boot.mjs`](graphics/tree-sparkle-2026-09-28/check-boot.mjs),
[result](graphics/tree-sparkle-2026-09-28/boot-check.json)). The re-baked app
boots five ways on WebGL2 in SwiftShader.
- Each boot compiles every material in the scene; no page or console error
  occurs in any, so no crown shader failed to compile.
- The tree tier audit passes in each, and every prepared startup path replays.
- The impostors are cut through the samples in every boot, as before.

| Boot | Drawn crown materials | Their cut |
| --- | ---: | --- |
| Ängsö, Kväll, the tee view, high quality (Hero) | 5 | through the samples, centred on 0.5; the shadow keeps its cut |
| Ängsö, Kväll, the tee view, low quality (Full) | 5 | the same |
| Ängsö, Kväll, `?crowncoverage=0` | 5 | the hard cut, main's; prepared startup still replays |
| Puttom, Kväll, the 12th from the orbit | 3 | through the samples |
| Visby, Kväll, the tee view (measured vegetation, water on the runtime path) | 5 | through the samples |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `382c996d`: water (10
courses; Visby, Tortuna and Lidingö keep their runtime water path), tints (26),
far vista (26) and scatter (26).
[`check-publication.mjs`](graphics/tree-sparkle-2026-09-28/check-publication.mjs)
compares against main at `f05006e8`
([result](graphics/tree-sparkle-2026-09-28/publication-identity.json)): every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/tree-sparkle-2026-09-28/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,525 Vitest tests and 482 Node
tests, with 3 environment skips. One Node test
(`geo_data/course-v2/visby/vegetation/compile-stands.node-test.mjs`) needs
`packages/course-geo/copc-reader`'s own locked dependencies (`npm ci` there),
which the root install does not fetch. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Other candidates, audited

A code audit of everything that can put small, bright, view-dependent points
into the picture, at golden hour. Its luminances are worked from the materials'
own formulas and the presets, not rendered, except where a batch measured them:

- **Glossy man-made materials** can bloom into dots where a view contains
  them. At their mirror angle the estimates run from about 10 (metal roofs) and
  24-54 (parked cars' paint and roofs) to several hundred (the facility glass
  in the building models, cars' windows), and the fountain spray's tiny caps
  higher still: all far over golden hour's threshold of 0.70. They are few and
  local; none was in the measured view.
- **The greens' sheen toward a low sun** reaches about 1.0 (the glow batch
  measured 1.02 at its brightest), and a tree's shadow cuts it into flecks.
  three's shadow filter (r186 PCF) turns its five taps per pixel by a noise
  fixed to the screen, so the edge of every shadow carries a grain that slides
  as the camera moves. It stayed under the flip in the measured view. If a
  sparkle remains on the greens under trees, looking toward the sun, it is
  this.
- **The water's road** sparkles by design; at golden hour the bloom adds about
  0.005 to a glint.
- **The far forest** (impostors and the far vista) still moves by samples when
  the camera does: 4x MSAA is as fine as the cut can be. Temporal
  anti-aliasing was tried on 10 September and did worse.

## Not established

- **Pictures on the owner's GPU.** Judge the crowns against `?crowncoverage=0`,
  moving the camera slowly:
  - the tee view at golden hour, toward the sun, with a stand of Hero trees
    against the sky;
  - Puttom's 12th from the orbit, across the lake;
  - noon, whose white clouds are brightest behind trees.
- **Frame time**, on the desktop and the phone. Nothing was timed.
- **Low quality.** The phones' Full crowns take the same cut; their sparkle
  was not measured.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering. The isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/tree-sparkle-2026-09-28/check-isolated.mjs
node docs/graphics/tree-sparkle-2026-09-28/check-boot.mjs          # after the re-bake
node docs/graphics/tree-sparkle-2026-09-28/check-publication.mjs   # after the re-bake
# the same on the owner's adapter
BANVY_GPU=1 node docs/graphics/tree-sparkle-2026-09-28/check-isolated.mjs
node tools/serve.mjs apps/golf/dist 8627    # keep serving
BANVY_GPU=1 node tools/glitter-meter.mjs http://127.0.0.1:8627 --view 12:orbit:golden --conds "as is" --query crowncoverage=0
BANVY_GPU=1 node tools/glitter-meter.mjs http://127.0.0.1:8627 --view 12:orbit:golden --conds "as is"
```

In a container without Chrome, point `BANVY_CHROME_PATH` at a Chromium.
