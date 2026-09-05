# The imagery toolkit

Tools for reading a golf course off dated aerial imagery and the 1 m laser terrain,
and for measuring how well any such reading agrees with what is already surveyed.
They were written for the Veckefjärden mapping pass of 2026-09-05 and run on any
build whose model carries a frame.

Every tool here reads the same four environment switches:

| variable | what it selects | default |
|---|---|---|
| `BUILD` | which build directory's `course-model.json` supplies the frame | `geobuild` |
| `SAT_REL` | which dated Esri Wayback release to sample | the live mosaic |
| `GPS` | a survey FeatureCollection in `geo_data/` | Veckefjärden's for geobuild, else the model's own green centres |
| `BANVY_CHROME` | the Chromium binary | this container's Playwright build |

`lib.mjs` is the shared half and is not run directly: the frame, the survey, the
model, ring geometry, IoU, Douglas-Peucker, a convex hull, a Moore boundary trace,
and the two Chromium helpers that decode JPEG tiles and render overlays. Node has
no JPEG decoder, which is why a browser is in the loop at all.

## wayback.mjs — which capture you are actually looking at

```
node geobuild/imagery/wayback.mjs releases
node geobuild/imagery/wayback.mjs census 32 -460
SAT_REL=27982 node geobuild/imagery/wayback.mjs fetch
SAT_REL=27982 node geobuild/imagery/wayback.mjs fetch 27982 -1000 -1350 500 400
```

Esri's live World Imagery is a mosaic of several capture dates stitched together.
Over Veckefjärden it is a leaf-on 2025 capture in the north and a leaf-off date in
the south, with the 1st's green under its winter cover. Any statement of the form
"the imagery is autumn" is therefore a claim about one tile, not about a course.

`census` settles it by hashing the same tile across every release and printing only
the ones whose bytes change. Four distinct captures exist over the 16th green;
release `27982` of 2025-04-24 is the one leaf-on capture covering the whole course.
A release only stores the tiles that changed in it and answers 404 elsewhere, so a
missing tile is normal and the imagery "at" a release is the latest release at or
before it that has that tile.

`fetch` caches and decodes a box, defaulting to the played ground with a margin
derived from the model. Tiles land in `<build>/cache/sat18[-<release>]/`, gitignored.

## crops.mjs — the eyes

```
SAT_REL=27982 node geobuild/imagery/crops.mjs sheet greens.png [sizeM] [ppm]
SAT_REL=27982 node geobuild/imagery/crops.mjs green 13 h13.png [size] [ppm] [--model] [--enhance]
SAT_REL=27982 node geobuild/imagery/crops.mjs evidence ev.png 13 17 9 16
SAT_REL=27982 node geobuild/imagery/crops.mjs object club.png 234 -465 200 [ppm]
```

The tiles are orthorectified, so a coordinate read off a gridded crop is already a
world coordinate. There is no registration step and no registration error. That is
the whole reason these crops are trustworthy where a screenshot trace is not: the
four buildings read off a Google Maps screenshot were 8 to 13 m out and up to twice
their true size, and `object` is what showed it.

- **sheet** puts all eighteen greens on one image with the model drawn over each.
  Use it first, to see which holes are worth a closer look.
- **green** is one green with a labelled 10 m grid. `--model` overlays what is
  stored, `--enhance` stretches contrast for a flat capture.
- **evidence** renders three panels per hole: imagery, 1.5 m-smoothed brightness,
  and 1 m laser roughness. Use it to ask whether an edge exists in ANY source
  before writing a tracer for it.
- **object** draws buildings, roads, parking, water, greens and bunkers over the
  imagery, for checking placed geometry rather than mown surfaces.

Colours are constant across all four: cyan a surveyed green, orange a plan-traced
green, yellow bunkers, white buildings and tee pads, red a traced building, and a
magenta cross at the surveyed green centre.

## green-tracers.mjs — six methods, each scoring itself

```
SAT_REL=27982 node geobuild/imagery/green-tracers.mjs all
SAT_REL=27982 node geobuild/imagery/green-tracers.mjs blob --write greens.json
SAT_REL=27982 F=0.6 WR=1 node geobuild/imagery/green-tracers.mjs fusion
```

Twelve of Veckefjärden's greens are surveyed in OpenStreetMap, so any tracer can be
scored against ground truth it never saw. That is what this file is for. It exists
as the evidence for NOT tracing greens here, and re-running it is only worthwhile
when a genuinely new source arrives.

| method | what it does | median IoU vs the 12 surveyed greens |
|---|---|---|
| `firststep` | the first significant brightness step outward from the centre | 0.65 |
| `plan` | the club plan's own green fill, bunker-registered, aligned | 0.64 |
| `blob` | component round the centre in smoothed brightness | 0.54 |
| `fusion` | blob with the roughness z-score folded in | 0.48 |
| `roughness` | region-grow on 1 m laser roughness | 0.46 |
| `polar` | rays from the centre, edge at the LARGEST brightness step | 0.44 |

Those are the tool's own numbers at its default settings, printed by the run above.
A hand sweep of thresholds finds better cells for some methods; the defaults are what
reproduces, so the defaults are what is quoted.

Read the best score carefully before treating it as a near miss. The first-step
tracer's areas are a median 1.1 times the surveyed ones and range from 0.8 to 2.4,
so it gets the size right on average and the shape wrong hole by hole. That is the
signature of every method here: the imagery shows the green COMPLEX, not the putting
surface, and no threshold separates the two. The laser agrees that greens are the
smoothest ground on the course, on all twelve, but only by about half again over
their collars, which degenerates to a few tiny patches on some holes. A blind
eye-trace of the 13th on the leaf-on capture ran east to west where the survey runs
north to south.

Thresholds are tunable through `F` for the blob fraction, `WR` for the roughness
weight and `THR` for the first-step size.

## plan-register.mjs — the club's plans, put where they belong

```
node geobuild/imagery/plan-register.mjs
node geobuild/imagery/plan-register.mjs --write plan-reg.json
```

The club's hole plans are drawn on aerial photography, which makes them geodata that
nobody had digitised. Registering them needs two anchors, and the pair originally
used was the back-tee disc and the drawn flag. The flag marks the PIN, not the
green's centre, so the plan sat 5 to 16 m out at the green end.

This tool finds pale sand blobs on the plan near the green, matches them one to one
against bunkers the laser and imagery measured, and fits a weighted least-squares
similarity on those pairs with the tee and pin kept at low weight. The pin-end error
falls to 2 to 8 m. It also traces the plan's own saturated-green fill and scores it,
which is the `plan` row of the table above; the fill overshoots because the plan
draws approach turf in the same green.

The plans are decoded from JPEG on first use into `geobuild/cache/plans/`.

## treecover-vs-imagery.mjs — where the forest raster disagrees

```
SAT_REL=27982 node geobuild/imagery/treecover-vs-imagery.mjs
SAT_REL=27982 node geobuild/imagery/treecover-vs-imagery.mjs disagree.png 6
```

Counting how much canopy a raster claims says nothing about whether it is right, so
this paints the two disagreement classes over the course: red where the raster says
trees and a crude leaf-on read says open, cyan the other way round.

Read the crude read as the weaker of the two. It misses sunlit crowns and takes tree
shadows on rough for canopy, which are exactly the two lessons `build-treecover.py`
already learned. On Veckefjärden the disagreements scatter rather than cluster, so
the committed raster stands. The actual gate on that raster is
`geobuild/check-treecover.mjs`, which fails when a verified forest probe stops
reading as forest.

## The two laser tools beside this directory

`geobuild/laser-water.mjs` reads shorelines. Laser does not penetrate water, so
every water body appears in the height model as a dead flat plate; finding the plate
gives the level and the outline in one measurement. Its report names every place the
surveyed shore and the laser shore disagree by more than fifteen metres, which is
the list worth acting on.

`geobuild/derive-dtm-features.mjs` finds bunkers, ditches and tee decks. A bunker is
sand in the imagery over a dish in the terrain, calibrated to reproduce all 32
surveyed bunkers. A ditch is a valley crossing a playing line, traced along its
bottom by least-cost path. A deck is a flat plateau under a card tee mark. It must
run in chain position, because it needs the plan traces to have landed first:

```
node geobuild/reconcile.mjs
node geobuild/apply-shapes.mjs
node geobuild/reconcile.mjs
node geobuild/derive-dtm-features.mjs
node geobuild/reconcile.mjs
```

Both are still shaped around Veckefjärden's paths, survey and water level. The
method is not: `loadTerrain(slug)` in `geobuild/dtm-lib.mjs` already takes any
ground with published 1 m tiles, and taking the rest across means parametrising the
build directory, the frame and the lake level the way the tools in this directory do.

## Rules these tools were written to enforce

- **Calibrate on what the survey has, then trust the rule where it does not.** Every
  threshold here was fitted on surveyed features and only then applied to unmapped
  ones. A tracer that cannot state its agreement with ground truth is a guess.
- **Two orthorectified records arbitrate.** The laser terrain and the z18 imagery
  carry no registration error, so where they disagree with a traced or drawn source,
  they are right.
- **Anchor a registration on something the registration cannot move.** An earlier
  version of the plan pipeline anchored on a value the pipeline itself rewrote, and
  two holes walked 19 m from the survey over successive runs.
- **Anything that folds its own output back into its input must know its own
  provenance.** Re-running the feature deriver on a model that already carried its
  results silently dropped nine ditches and twelve tee decks, because the crossing
  filter counted its own ditches as pre-existing.
- **A picture is a check, not decoration.** Every numeric result above was looked at
  on a crop before it was believed, and two of them died there.
