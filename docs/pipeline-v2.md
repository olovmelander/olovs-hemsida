# A golf course, start to finish (pipeline v2)

How a course is built or improved here: the order of the work, the tool for each step, and the gate each step
has to pass before the next one starts. The [course production workflow](course-production-workflow.md) says
what a course must prove; this says how to get there without finding the faults last.

It was first written from Bro Hof Slott (two 18-hole routings on one new ground, November 2026), which went from
mapping to live in one evening, and found five real faults late, all of them by looking at a picture. The
process below exists so that the next course finds them at the stage that made them. Nothing in it is specific
to one course: a new ground needs its own configuration and decision files, and no new compiler, tracer or
loader.

- **Building a new ground:** follow the stages in order.
- **Improving a published ground:** start at [its walkthrough](#the-walkthrough), then use
  [the upgrade table](#improving-a-published-course).

## The rules

1. **Measured before drawn, and judgement kept as data.** Outlines come from the photo, heights from the laser,
   lengths from the card. What a person decided lives in a decision file with its reason, so a tool can be run
   again. A wrong outline is fixed by changing a decision and tracing again, never by editing a result.
2. **Every stage ends at a gate.** A gate is a check that fails, or a look that is recorded. A score nobody
   reads is not a gate: the tracer scored thirteen wrong tee decks low, and the number sat in a report.
3. **Pictures come early.** The photo under every ring after tracing; the first pictures of the course before
   any bake; the phone map before merging. A fault found by a picture becomes a check before the work goes on.
4. **One bake.** Any edit under `apps/golf/src/engine`, `apps/golf/src/loader` or `packages/course-v2` turns off
   every course's prepared data until all of them are baked again. Finish the engine edits, look, then bake once.
5. **What CI runs, run first, in a clean checkout.** This machine has private caches CI does not, so a check
   that passes here can still fail there.
6. **Say what is not right.** A course is accepted on its walkthrough, whose numbers are generated and whose
   list of known faults is written by hand. An empty list is not believable.
7. **One heavy job at a time, and the GPU is the owner's.** Run CPU work alone and at low priority
   (`node --test --test-concurrency=1`, `vitest --maxWorkers=2`). Ask before anything that opens a browser or
   uses the GPU, and batch it into one sitting.

## The sittings

Bro Hof was done in one evening against a shutdown at 03:00. The trees were cut short, missed their gate and
used up their unseen sample. Plan a ground as four sittings instead:

| Sitting | Stages | Machine | Ends when |
| --- | --- | --- | --- |
| 1. Sources and outlines | 0 to 3 | CPU | every ring has been looked at and the look is recorded |
| 2. A first course | 4 to 6 | CPU, then a short GPU look | the first pictures are clean, with automatic trees |
| 3. Trees | 7 | CPU, half a day or more | the benchmark is scored, and the owner has decided if it missed |
| 4. Release | 8 and 9 | one GPU sitting | four green pipelines and a look at the live site |

Sitting 3 can come after a first release: a ground is complete with automatic trees, and placed trees are an
upgrade. Never start the tree pipeline with a deadline in the same sitting.

## The stages

Commands run from the repository root. `PX` is
`pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen`; Python steps add `-e mapping`.

### 0. Preflight

- The tools run: `node --version` (22 or later), `$PX -e mapping python -c "import scipy.ndimage, rasterio, shapely"`,
  Blender in `--background`.
- `node packages/course-workflow/cli.mjs check` passes, and `git status` is clean on a new branch.
- The raw caches named in the ground's handover are on disk. They are never downloaded twice.

**Gate:** every line above. If a tool fails to load for a reason that is the machine's (on 25 November 2026
Windows Smart App Control began blocking a NumPy library the tracer needs), stop and tell the owner. Do not work
round a security control.

### 1. Sources

Club pages and card, OpenStreetMap, orthophoto windows, laser. Take **two photo years**: the newest leaf-on
photo for tracing, and a leaf-off one, which shows tee decks under crowns and anything rebuilt between the two.

| Do | Tool |
| --- | --- |
| Club sources, card, OSM, photo windows, dense laser by the buildings | `packages/course-geo/intake/*` |
| Check the card: sums, stroke indexes, a second source | `intake/verify-scorecard.mjs` |
| Write the dossier and the source manifest | `docs/courses/<ground>-source-research.md`, `geo_data/course-v2/<ground>/source-manifest.json` |

**Gate:** `node packages/course-geo/check-manifests.mjs` passes; the card's totals agree with its holes; every
source has a date, a licence and a checksum; club and guide images are marked reference only.

### 2. Ground

One frame per physical ground, and the standard 469-tile terrain.

| Do | Tool |
| --- | --- |
| Frame, ring spec, terrain rings | `packages/course-v2/<ground>-ground-{graph,rings}.mjs`, `ground-rings-registry.mjs` |

**Gate:** 469 tiles, edge difference 0, laser against terrain median 0.00 m. Write down the date of the laser
and of the photo: where the ground was rebuilt between them (a filled pond, a new tee, a building site), the
terrain is the older truth and the walkthrough has to say so.

### 3. Outlines

Greens, tees, fairways, bunkers and waste areas are traced from decisions. Each routing has a `decisions.json`
(hole lines, tee decks by name, a seed per green, any ring a reviewer drew); the ground has `sand-decisions.json`
and `layer-decisions.json` (practice areas, walls, bridges, plates, cart rows). Each entry says why.

| Do | Tool |
| --- | --- |
| Trace | `$PX -e mapping python packages/course-geo/mapping/trace-course-surfaces.py --config <build>/mapping/trace-config.json --cache <build>/cache/mapping` |
| Water, context, infrastructure | `mapping/prepare-osm-context.py`, `<build>/mapping/build-layers.py` |
| Every ring on the photo, worst score first, both photo years | `$PX -e mapping python packages/course-geo/mapping/render-ring-sheets.py --config <build>/mapping/trace-config.json --compare <leaf-off photo>` |
| Record the look | `node packages/course-geo/mapping/ring-review.mjs --build <build> --record --reviewer "<who, on what>"` |
| Each hole whole, on the photo | `packages/course-workflow/render-source-overlays.py` (the mapping stage prints its command) |

**Gate, in numbers:** every tee mark more than 5 m from its card length is explained in the walkthrough, not
warped away. **Gate, by eye:** every sheet has been looked at, the look is recorded against the exact outlines
(`ring-review.json`), and every tee or green under the score line has a verdict in words.
`ring-review.node-test.mjs` fails when an outline changes after the look. The score finds most doubtful rings
and not all: four of Bro Hof's wrong decks scored well, so look at the whole sheet.

A guide plate or a club drawing names things and gives their order. It never places them: check each claim on
the photo.

### 4. Model

| Do | Tool |
| --- | --- |
| Compile each routing | `node packages/course-geo/mapping/compile-grid-course.mjs --config <build>/mapping/course-input.json` |
| Inventory the models in the source records | `$PX node packages/course-geo/inventory-models.mjs --ground <ground>` |

**Gate:** the build's own tests (copy `brohofbuild/course.node-test.mjs`: dry, sane in size, clear of each
other, lengths against the card); `inventory-models.mjs --check`.

### 5. A first course

With automatic trees, so that everything else can be looked at.

| Do | Tool |
| --- | --- |
| Terrain before anything is published, then canopy | `course-workflow/bootstrap-terrain.mjs`, `course-v2/vegetation/build-canopy.mjs --ground-document` |
| Pin the inputs, run the six stages, promote | `production.mjs --ground <ground> --configure`, `$PX node packages/course-workflow/cli.mjs run --ground <ground> --through validate`, `promote.mjs` |
| Register the ground | see [what a ground writes by hand](#what-a-ground-writes-by-hand); `node tools/sync-course-registries.mjs --check` |
| Scenery: roofs, sand, buildings, species, water, campus | `geobuild/facilities/roof-colours.py`, `<build>/facilities/build_campus.py`, `tools/facility-pipeline/*` |
| The map's pictures | `node tools/bake-map-land.mjs` |

Do not edit a watched file while the six stages run: the runner refuses a build whose inputs moved under it.

**Gate:** `node tools/check-course-quality.mjs --ground <ground>` has no errors, and each warning is explained;
`pnpm exec vitest run apps/golf` passes, which includes the test that every kind and list in the new pack is
known to the phone map (`MAP_KNOWS` in `map-course.mjs`); `node tools/lint-app.mjs` is clean.

### 6. The first look

A short GPU sitting, before any bake. Ask first.

```sh
node tools/course-walkthrough.mjs --ground <ground> --pictures     # prints the commands; it starts nothing
```

It chooses the views from the ground's own records, each for a fault it can show: the first tee (trees and
species), the last green (the buildings), holes with water (levels against banks, walls and tees), short holes
whole, waste areas (colour at a distance), every flagged hole, low quality, a low sun, winter, and the phone map
of the same holes. Look at every picture. For each fault: fix it, add the check that would have found it, and
put a row in the walkthrough's fault table.

**Gate:** a round of pictures with nothing new in it.

### 7. Trees

Their own sitting: [the tree placement workflow](tree-placement-workflow.md) and its agent. The placed trees
are built on the promoted first generation (`baselineGround` in `production.json`), or every tile outside their
window loses its trees.

**Gate:** 90% precision and recall on trees the detector never saw. If it is missed, score the automatic trees
on the same sample and put both scores in front of the owner; the gate is never loosened and no exception is
written into it. An unseen sample can be used once.

### 8. Release build

| Do | Tool |
| --- | --- |
| Final six stages and promotion; prune files no published generation names | `cli.mjs run`, `promote.mjs` |
| Map pictures, roof colours | `tools/bake-map-land.mjs`, `roof-colours.py` |
| Every course's prepared water, tints, vista and scatter, then the boots | `BANVY_GPU=1 node tools/gpu-pass.mjs` (one sitting; `--dry-run` shows the order) |
| Posters, then the catalogue row and scorecard | `tools/make-posters.mjs --candidates` then `--write`; `packages/course-pack/emit-manifest.mjs --only=<slug>` |
| The walkthrough | `node tools/course-walkthrough.mjs --ground <ground>`, then write its hand parts |
| Release | `cli.mjs release`, or the owner's recorded acceptance (`course-workflow/acceptance.mjs`) |

**Gate:** the rehearsal. In a clean worktree of the commit to be pushed (`git worktree add ../rehearsal HEAD`),
with no private caches, run what CI runs: `node packages/course-workflow/cli.mjs check-new --base-ref $(git
rev-parse origin/main)`, `node packages/course-geo/check-manifests.mjs`, `$PX test-acquisition`,
`$PX plan-hole-controls`, `$PX check-migration`, `pnpm test`, the build, `node tools/check-prepared-startup.mjs`
and `node tools/course-walkthrough.mjs --ground <ground> --check`. Open the pull request only when all of it
and the GPU pass have finished.

### 9. Ship

Sync with main first; if the engine moved there, bake again before merging. Merge when CI is green, watch the
four pipelines on main (course production, course geo, pages, cloudflare), then look at the live site: both
modes on each new routing and on one old course, with no console errors. Then update the walkthrough and the
memory.

## The walkthrough

`docs/courses/<ground>-walkthrough.md` is the page a course is accepted on, and the list every later upgrade
starts from.

```sh
node tools/course-walkthrough.mjs --ground <ground>            # writes it, or refreshes its generated parts
node tools/course-walkthrough.mjs --ground <ground> --check    # fails when it is stale or a prompt is left
```

- **Generated, never typed:** what is there (holes, card lengths, ring counts, the tee marks against the card,
  the ring review, trees and their score, buildings, the quality gate, what the release left open), a row for
  every hole with what the checks flag and links that open it, and the commands to check it.
- **Written by hand:** what is known not to be right, what is worth looking at, how each fault was found and
  what holds it now, the owner's decisions, and the befores. A new file comes with prompts where these go.
- **Held by a test:** `course-walkthrough.node-test.mjs` fails when a generated part falls behind its records.

[Bro Hof's](courses/bro-hof-walkthrough.md) is the first. Its fault table is the reason for most gates above.

## Improving a published course

Generate the ground's walkthrough first if it has none; it works on every published ground. Then:

| What is wrong or new | Change | Run again | Bake |
| --- | --- | --- | --- |
| A tee, green, bunker or fairway outline | its `decisions.json` | stages 3, 4, the six stages, promote, map pictures | that ground: `gpu-pass.mjs --only <slugs>` |
| A water edge, wall, bridge, plate or cart row | `layer-decisions.json` | `build-layers.py`, then as above | that ground |
| The card (lengths, par, index, a new tee) | `card.json` and the scorecard reference | stage 4, the six stages, promote, `emit-manifest.mjs --only` | that ground |
| A newer photo | stage 1 for the window | all of stage 3, with a full ring review | that ground |
| Newer terrain or laser | stage 2 | everything after it | that ground |
| Trees | a new round in `trees.json`, on a new unseen sample | stage 7, the six stages, promote, map pictures | that ground |
| A building or the campus model | `build_campus.py`, `publish-facility-glb.mjs`, `validate-facility-glb.mjs` | the campus test | none for the model alone |
| Colours, species, water rule, stated buildings | the ground's scenery module | the first look | **every course** (it is engine code) |
| Something missing on the phone map | `map-course.mjs`, `map-paint.mjs`, `MAP_KNOWS` | the map tests, a look at phone width | none |

After any of them: the quality gate, the walkthrough (`--check`), a first look at the holes that changed, and
the rehearsal. A ground built with its own older builder keeps that builder for small fixes; its walkthrough,
the quality gate and the map test work on it as they are. The ring sheets need a `trace-config.json`, which
only the grounds traced from decisions have.

## What catches what

Each row is a fault that happened, and what stands in its way now.

| Fault | Caught by | Stage |
| --- | --- | --- |
| An outline off the photo (an old OSM sketch, a deck since rebuilt) | ring sheets and the recorded review | 3 |
| A tee far from its card length | the card column of the walkthrough and the trace report | 3 |
| A tee or green in water, a tee on ground at a water's own level | the build's tests; `check-course-quality.mjs` | 4, 5 |
| Ground in a pack that the phone map does not paint | `MAP_KNOWS` and its test on every pack | 5 |
| Tables that must agree and do not (frames, grounds, roofs) | `sync-course-registries.mjs --check` | 5 |
| A campus model that is too bright, too heavy or not what its manifest says | `validate-facility-glb.mjs`, the campus loader's tests | 5 |
| Ponds standing low inside their banks | **a picture only** (the first look); `deferWaterBedToWorld` is the fix | 6 |
| A surface drawn twice, or wrong at a distance | **a picture only** | 6 |
| Trees of the wrong kind | **a picture only**; then the ground's species rule and its test | 6 |
| Trees placed worse than they should be | the held-out benchmark | 7 |
| Prepared data that no longer matches the code | `check-prepared-startup.mjs`, `check-prepared-water.mjs` | 8 |
| A shader over the varying limit, a console error at start | `check-gpu-clean-boot.mjs` (in the GPU pass) | 8 |
| A check that needs a private file | the rehearsal in a clean worktree | 8 |
| A walkthrough that has gone stale | its test | always |

The three rows marked "a picture only" are the gaps. Until a check exists for each, the first look is the gate.

## What a ground writes by hand

- its frame and ring spec (`packages/course-v2/<ground>-ground-{graph,rings}.mjs`, a row in
  `ground-rings-registry.mjs`), its entry in `EXPECTED_GROUNDS` (`packages/course-geo/manifest.mjs`), and its
  runtime contract (`apps/golf/src/engine/v2-<ground>-config.mjs`, `v2-frontier-configs.mjs`,
  `v2-terrain-select.mjs`);
- `decisions.json` per routing, `sand-decisions.json`, `layer-decisions.json` and `<build>/mapping/build-layers.py`;
- its rows in `packages/course-pack/emit-manifest.mjs` (name, club, tees and their colours);
- a scenery module (`apps/golf/src/engine/scenery/<ground>.js`, registered in `scenery/index.js`). Go through
  this list for every ground:
  - `houseKit` and `roofColours`;
  - the sand's colour, if measured on the photo;
  - buildings the kit would guess wrong (`houseKitBuildings`) and the clubhouse fallback;
  - `species`: which broadleaves and conifers grow there, or every typed broadleaf is drawn a birch;
  - `deferWaterBedToWorld`, when the ground was flown with its ponds full;
  - the campus, if it has one;
- `course-workflows/<ground>/trees.json` for the tree pipeline;
- the start menu's rows: `shell/course-places.mjs` (place, and `HOST_CLUB` for a second routing),
  `shell/course-clubs.mjs` (the club and each layout's label), `shell/club-picker.js` (signature hole and its
  poster), `shell/rail.js` (label, search words, description);
- `tools/make-posters.mjs` (which holes, which framings), and a view or two in `tools/gfx-gallery.mjs` and
  `tools/map-gallery.mjs`.

`sync-course-registries.mjs --check` writes or checks the tables that only repeat the frontier registry.

## Lessons kept

- **The photo is the truth for outlines, the laser for heights.** Four bands at 0.16 m traced Bro Hof's greens to a
  0.64 m mean of the best independent outline. OSM is a seed, not a measurement.
- **Card lengths check the tees; they do not move them.** 152 of Bro Hof's 162 marks fall within 5 m of the card.
  The rest are written down.
- **A tiling cuts what crosses it.** Trace in 500 m windows with a 300 m margin; a shape that touches its margin
  is an error.
- **One sand or two is a measurement.** Read the raked sand's brightness in one exposure across both routings.
  A waste area is its own ground class, and must not also be drawn as a sheet over it.
- **The laser can be older than the ground,** and a ground flown with full ponds needs its water read before any
  bed is carved.
- **A new ground has no baseline;** placed trees need the first generation as theirs.
- **Line endings are part of a checksum,** and published JSON is canonical (`v2-index.json` has no final newline).
- **A campus model starts from the laser:** roof breaks and cornices tabulated along the building's own axes,
  then a photograph for the order of the façade, and a list of what was estimated.
- **Rewriting one catalogue row must keep its baked records** (`emit-manifest.mjs --only`).
- **A heredoc with an apostrophe breaks in Git Bash.** Write scripts as files.

## Where every ground stands

Written by `node tools/course-walkthrough.mjs --catalogue`; a test fails when it falls behind.

<!-- generated:catalogue -->
| Ground | Holes | Outlines | Ring review | Trees | Quality gate | Walkthrough | Release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `angso` | 18 | own builder | no record | automatic | 0 errors, 1 warnings | none | advisory, 3 open |
| `bro-hof` | 18 + 18 | decisions as data | recorded | one by one (review-2026-11-24) | 0 errors, 1 warnings | [yes](courses/bro-hof-walkthrough.md) | owner acceptance, 4 open |
| `johannesberg` | 18 + 9 | own builder | no record | one by one (review-2026-11-08) | 0 errors, 0 warnings | none | advisory, 4 open |
| `lidingo` | 18 | own builder | no record | automatic | 4 errors, 1 warnings | none | advisory, 4 open |
| `norrfallsviken` | 18 | own builder | no record | one by one (review-2026-11-09) | 0 errors, 0 warnings | none | advisory, 3 open |
| `puttom` | 18 | own builder | no record | automatic | 1 errors, 0 warnings | none | advisory, 3 open |
| `ribbingsfors` | 9 | own builder | no record | automatic | 1 errors, 1 warnings | none | advisory, 3 open |
| `tortuna` | 18 | own builder | no record | automatic | 0 errors, 0 warnings | none | advisory, 3 open |
| `upsala` | 18 + 9 | own builder | no record | automatic | 0 errors, 0 warnings | none | advisory, 3 open |
| `veckefjarden` | 18 + 9 | own builder | no record | automatic | 3 errors, 1 warnings | none | advisory, 3 open |
| `visby` | 18 | own builder | no record | automatic | 1 errors, 0 warnings | none | advisory, 7 open |
<!-- /generated:catalogue -->

"Outlines: own builder" means the ground was built before the shared tracer, so it has no decision files and no
ring sheets. A quality-gate error on an older ground is a fault to fix or to explain in a walkthrough, and is
the best place to start improving it.

## Not done yet

- A CPU check for water standing inside its outline, and one for a surface drawn twice.
- The tracer does not stop on a low score by itself; the recorded review is what holds it.
- No ground has been looked at on a real phone as part of this process, and none has passed the full release
  review: Bro Hof came in on the owner's recorded acceptance.
- `tools/check-map-field.mjs` and two start-menu checks failed on 24 November for reasons older than Bro Hof;
  they have not been run again since.
- Ten of the eleven grounds have no walkthrough.
