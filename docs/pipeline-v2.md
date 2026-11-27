# A golf course, start to finish (pipeline v2)

How a course is built or improved here: the order of the work, the tool for each step, and the gate each step
has to pass before the next one starts. The [course production workflow](course-production-workflow.md) says
what a course must prove; this says how to get there without finding the faults last.

It was first written from Bro Hof Slott (two 18-hole routings on one new ground, November 2026), which went from
mapping to live in one evening, and found five real faults late, all of them by looking at a picture. The
process below exists so that the next course finds them at the stage that made them. Nothing in it is specific
to one course: a new ground needs its own configuration and decision files, and no new compiler, tracer or
loader.

- **Starting any sitting:** `node tools/course-doctor.mjs --ground <ground>` reads every record of the ground and
  sorts what it finds: broken, to do, the owner's, known faults, holding. Without `--ground` it lists every ground
  in a line each, and `--machine` says whether this machine can run each part of the pipeline today.
  `--private` lists the private source data each ground was built from, which only the machine that fetched it
  holds: that is the list to back up.
- **Building a new ground:** follow the stages in order.
- **Improving a published ground:** start at [its walkthrough](#the-walkthrough), then use
  [the upgrade table](#improving-a-published-course).

## The short path

All of it for a new ground, a line a stage. Everything further down says what a line does and why its gate is there.

```sh
node tools/course-doctor.mjs --machine                          # 0    can this machine trace, look and build today?
#  write the card (course-workflows/<ground>/ground.json), fetch the sources, set the frame       1, 2
node tools/course-rebuild.mjs --ground <ground> --to review     # 3    trace, measure decks and sand, draw the rings that need a look
#  look; record; the blind sheets to the second reviewer; answer its doubts; fix a decision and run the line again
node packages/course-workflow/ground-card.mjs --ground <ground> --apply   # 5  its rows into the ten tables that name a ground
node tools/course-rebuild.mjs --ground <ground> --from layers   # 4, 5 model, six stages, promote, roofs, quality gate, map, walkthrough
node tools/course-walkthrough.mjs --ground <ground> --pictures  # 6    the first pictures, before any bake
BANVY_GPU=1 node tools/gpu-pass.mjs [--only <slugs>]            # 8    one bake
node tools/course-rehearsal.mjs --ground <ground>               # 8    what CI runs, in a clean worktree of the commit
#  the pull request, the four pipelines on main, the live site                                    9
```

An upgrade is the same with `--from <step>`: change the one decision, and run from the step that reads it. The
loop of stage 3 (a decision, a trace, a look) is where a course is made right, and it is short on purpose: a look
is kept ring by ring, so a trace again asks for a look at the rings that moved and at no others.

## The rules

1. **Measured before drawn, and judgement kept as data.** Outlines come from the photo, heights from the laser,
   lengths from the card. What a person decided lives in a decision file with its reason, so a tool can be run
   again. A wrong outline is fixed by changing a decision and tracing again, never by editing a result.
2. **Every stage ends at a gate.** A gate is a check that fails, or a look that is recorded. A score nobody
   reads is not a gate: the tracer scored thirteen wrong tee decks low, and the number sat in a report.
3. **Pictures come early.** The photo under every ring after tracing; the first pictures of the course before
   any bake; the phone map before merging. A fault found by a picture becomes a check before the work goes on.
4. **One bake, and only of what changed.** Each course's prepared data answers to a source revision of its own
   (`tools/course-source-revision.mjs`, 27 November 2026). An edit to engine code every course runs turns off every
   course's prepared data until all are baked again. An edit to one ground's own modules (its scenery module and
   what only it imports, its terrain contract) turns off that ground's. A new ground bakes itself. Code no player
   loads (the tree compilers, the ground specs) bakes nothing. Finish the edits, look, then bake once, with
   `gpu-pass.mjs --only <slugs>` when the change was a ground's own.
5. **What CI runs, run first, in a clean checkout.** This machine has private caches CI does not, so a check
   that passes here can still fail there.
6. **Say what is not right.** A course is accepted on its walkthrough, whose numbers are generated and whose
   list of known faults is written by hand. An empty list is not believable.
7. **One GPU pass at a time on the machine.** The owner lifted the quiet rule on 26 November 2026: CPU and GPU may
   run at full speed, and a GPU sitting needs no asking first. What remains is the order and the neighbours:
   pictures before the bake, one bake when the engine edits are finished, and never two passes at once (each
   takes a port of its own, but they share one GPU, and a second one distorts the first one's boots).
8. **The owner's eye is a source.** Five of the six tasks of the night of 27 November began with a fault the
   owner had seen while playing or looking, told in a sentence and twice with a screenshot: good shots ruled out
   of bounds, a tee that felt off, squares in the water, rough where the range's apron is. Find the place
   (`V3D.setView`, a top-down picture, the before switches), put the fault in the walkthrough's table with how
   it was found, fix it at the stage that made it, and add the check that would have found it. That loop is
   the acceptance that happens.

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

Stages 3 to 5 and the CPU half of stage 8 are one command, which runs the steps below in their one order, stops
at the ring review until the look is recorded, and starts nothing on the GPU:

```sh
node tools/course-rebuild.mjs --ground <ground> --dry-run            # the steps and their commands
node tools/course-rebuild.mjs --ground <ground> [--from <step>] [--to <step>] [--compare <leaf-off photo>]
```

A ground has the steps it has files for. A new one traces from its card alone (`--to review`), long before it has
a production profile; an older one with its own builder has the looks at its exported outlines and the steps
that follow a republished pack (`roofs`, the quality gate, the map's pictures, the walkthrough), with its own
builder's commands between them, which its walkthrough lists.

### 0. Preflight

- The tools run: `node tools/course-doctor.mjs --machine` (Node 22 or later; the Python libraries the looking
  tools need, and separately the ones the tracer needs; Blender).
- `node packages/course-workflow/cli.mjs check` passes, and `git status` is clean on a new branch.
- The raw caches named in the ground's handover are on disk. They are never downloaded twice.
- The ground's card is written: `course-workflows/<ground>/ground.json` holds every fact a person chooses for the
  ground (club, place, tees and their colours, search words, poster holes, gallery views), once. Every published
  ground has one.
  `node packages/course-workflow/ground-card.mjs --ground <ground>` then lists every table the ground is missing
  from, and `--apply` adds its rows to them at stage 5 (`--rows` prints them).

**Gate:** every line above. If a tool fails to load for a reason that is the machine's, stop and tell the owner.
Do not work round a security control. On 25 November 2026 Windows Smart App Control began refusing conda-forge's
NumPy and SciPy extension modules, which stopped the tracer. The owner chose to try the official PyPI builds of
the same versions, which it accepts, so on Windows the mapping environment now takes its Python libraries from
PyPI (`packages/course-geo/toolchain/README.md`); the tracer reproduced the published outlines byte for byte.
The first import after a fresh install can be refused once while the verdict arrives: run it again.

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
terrain is the older truth and the walkthrough has to say so. A terrain model is a mosaic of flights: the one
date in its source record is its newest patch (Bro Hof's said June 2025; the ground under Castle 7 and 18 was
flown in 2020-21). The walkthrough prints the flights' range from the discovery record; believe that.

### 3. Outlines

Greens, tees, fairways, bunkers and waste areas are traced from decisions. Each routing has a `decisions.json`
(hole lines, tee decks by name, a seed per green, any ring a reviewer drew); the ground has `sand-decisions.json`
and `layer-decisions.json` (practice areas, walls, bridges, plates, cart rows). Each entry says why.

| Do | Tool |
| --- | --- |
| Where no club map gives the routing: put a guide's hole plates on the photo and read each plate's tee and flag in SWEREF 99 TM | `$PX -e mapping python packages/course-geo/mapping/register-guide-plates.py --config <build>/mapping/trace-config.json --plates '<dir>/h{hole:02d}.webp' --out <build>/mapping/guide-plates.json` |
| Check that the decision files can be traced (every card tee has a deck, every OSM id exists, nothing leaves the box) | `node packages/course-geo/mapping/check-decisions.mjs --config <build>/mapping/trace-config.json` |
| Trace | `$PX -e mapping python packages/course-geo/mapping/trace-course-surfaces.py --config <build>/mapping/trace-config.json --cache <build>/cache/mapping` |
| Measure the terrain under every tee deck | `node packages/course-geo/mapping/deck-ground.mjs --config <build>/mapping/trace-config.json --record` (`--around <ring id>` prints the heights round one) |
| Read the photo round every hole against the model's sand, both ways | `$PX -e mapping python packages/course-geo/mapping/audit-sand.py --config <build>/mapping/trace-config.json --compare <leaf-off photo>` |
| Say what each thing it named is | `node packages/course-geo/mapping/sand-audit.mjs --build <build> --verdict id="what it is"` or `--fault id="what is wrong, and what will put it right"` |
| Water, facilities, infrastructure, from the ground's `layer-decisions.json` | `mapping/prepare-osm-context.py`, then `$PX -e mapping python packages/course-geo/mapping/build-layers.py --config <build>/mapping/trace-config.json` (one builder for every ground: a ground brings decisions, not a script) |
| Which rings need a look: the new ones and the ones that moved | `node packages/course-geo/mapping/ring-review.mjs --build <build>` (it prints the command that draws them) |
| Those rings on the photo, both photo years; every ring, worst score first, the first time | `$PX -e mapping python packages/course-geo/mapping/render-ring-sheets.py --config <build>/mapping/trace-config.json --compare <leaf-off photo> [--only <ring id>,...]` |
| Record the look | `node packages/course-geo/mapping/ring-review.mjs --build <build> --record --reviewer "<who, on what>"` |
| The same rings blind, for a second reviewer | `render-ring-sheets.py ... --blind [--only ...]`, the `ring-reviewer` agent, then `ring-review.mjs --build <build> --second <verdicts.json>` |
| Answer each of its doubts | redraw the ring, or `ring-review.mjs --resolve id="why it stands"`, or `--fault id="what is wrong, and what will put it right"` |
| One place, large, with a grid and any layer drawn on it | `$PX -e mapping python packages/course-geo/mapping/render-photo-window.py --config <...> --at E N --span 80 --out <picture>` |
| Each hole whole, on the photo | `packages/course-workflow/render-source-overlays.py` (the mapping stage prints its command) |
| The owner's look, hole by hole | `node tools/course-review-page.mjs --ground <ground> --overlays <dir>`, then `--import <saved review> [--apply]` |

**Gate, in numbers:** every tee mark more than 5 m from its card length is explained in the walkthrough, not
warped away, and every deck `deck-ground.mjs` names has been looked at: a deck on its deck slopes under 2% in
the terrain, and one that slopes 5% or more is either off its deck or newer than the terrain. **Gate, by eye:**
every ring has been looked at as it is now, the look is recorded ring by ring (`ring-review.json`), and every
tee or green under the score line has a verdict in words. `ring-review.node-test.mjs` fails when a ring is new or
has moved since it was looked at. The score finds most doubtful rings and not all: four of Bro Hof's wrong decks
scored well, so look at the whole sheet.

**A look holds for a ring until that ring changes.** The record keeps where each ring lay and how large it was
(its centre, its box, its area and the length of its edge), and a look holds while none of them moves by more
than 0.3 m, or half a metre of edge, or half a square metre or half a percent of area: a trace again shifts a
ring by a centimetre, which no look can see, and a bite of a metre out of a green does not pass. The record
keeps what the look saw until the ring is looked at again, so small shifts add up against it. So a new
trace asks for a look at the rings that are new or moved and at no others, and `ring-review.mjs` prints the
command that draws exactly those. Until 27 November 2026 the record was one hash of the whole outline file:
moving one of Tjusta's greens by 0.9 m voided the look at all 104 rings and dropped the second look with every
answer given to it, so the sheets were drawn 14 times there and the blind look taken 7 times. A look that has
to be repeated whole is recorded without being taken. A look is also of a ring on a photo: outlines traced again
on another photo are looked at whole, however little they moved.

**The second look.** Whoever traced sees what they meant to draw. A second reviewer is given the blind sheets
only (hole order; no scores, no sources, no tee colours) and nothing else: not the decisions, not the first
look. Its doubts are recorded and bind: each is answered by redrawing, by a reason the ring stands, or by
keeping it as a fault that the walkthrough prints. An answer stays with its ring: when the outlines are traced
again, the second reviewer is shown the rings that moved (the doctor lists them), an open doubt on a redrawn
ring goes with the line it doubted, and nothing said of a ring that stayed where it was is asked for twice.
At Bro Hof it found a tee 3 m over a bank that the first look
had passed, found the two known offset tees again unprompted, and showed that five bunkers were newer than the
terrain. What it cannot judge (shade, crowns) it lists; measure those against the terrain.

**What has no line.** A look at every ring cannot see what was never drawn. `audit-sand.py` finds the bright sand
round every hole with the tracer's own measure and compares it with the model both ways: sand that no bunker or
waste area holds (each with what the map has there: a road, a roof, a shore, or nothing), and rings that hold
little sand or have sand outside their line. Every ring it names and every area on nothing mapped needs a
verdict from someone who looked at its sheet; a missed bunker or a ring on something that is not sand is kept
as a fault. At Bro Hof no bunker was missing; the three rings it named were exactly the three drawn by hand,
and one of those (a "waste area" on Castle 15) turned out to be dark bare ground. It shares the tracer's blind
spots: sand in deep shade, and sand that is not bright.

**The ground's age.** The terrain's record gives one date for a mosaic of flights, so the age of the ground under a
hole is measured instead, three ways. `deck-ground.mjs` names the tee decks that are not level and the bunkers
that lie in no bowl (all but two of Bro Hof's 102 measured bunkers lie 0.25 m or more under the ground round
them). `audit-sand.py --compare <older photo> --compare-captured <date>` reads every bunker on the older photo,
with that photo's own sand and turf levels, and names the ones that were grass then. The walkthrough prints
the signs by hole. A hole with several is one that was rebuilt after the terrain was flown: trust its outlines
from the newer photo, and expect its heights to be wrong. Bare soil reads as sand on a photo, so a bunker on what
was a building site shows only in the terrain; shade hides the rest, and the record says for which.

**The owner's look.** The review page is a local file with every hole's photo and model side by side, what the
checks flag, links into the app and seven verdicts a hole. It keeps its place in the browser and saves one
JSON file; `--import` checks it against what is published and keeps it as evidence, and `--apply` writes its
verdicts as the per-hole rows of the release review. A hole marked wrong stays open with the owner's words.
The page holds crops of the photo, so it lives in the build's private cache and is never published.

A guide plate or a club drawing names things and gives their order. It never places them: check each claim on
the photo.

**When the club has no map.** Tjusta's club publishes no hole map and OSM has no hole ways. A routing read from
the photos alone was right on ten holes and wrong on the rest: two holes swapped, and five tees on the wrong
deck, most of which both looks had doubted. golfisverige.com's hole plates are aerial photos with the yellow tee
and the flag drawn on. `register-guide-plates.py` finds each plate's photo on the orthophoto, with its scale
bounded by the card's length against the drawn tee-to-flag distance (left free, a plate finds a chance peak at a
third of its scale), and reads both marks. A fit whose marks leave the course is rejected; a par 3's plate shows
little but turf and usually is, so read it by eye or fit it on two greens it shows. A plate's drawn line also
gives a hole's bends.

**What the tracer reads from the ground's own configuration.** A ground's sand may not be Bro Hof's white marble:
`sand` in `trace-config.json` states its colour bands, measured on its own photo (Tjusta's raked sand is tan), and
`audit-sand.py` reads the same bands. The fairways have five switches under `fairways`, each for a fault Tjusta
showed; a ground that sets none is traced as Bro Hof was:

- `training: "decision-lines"`: the turf model learns "fairway" from OSM's fairway outlines. Where those are few or
  old (Tjusta had six, of 2012) it learns that every other hole's fairway is rough and draws fragments. Taught
  from the holes' own lines instead, the 7 m either side of a par 4's or 5's line is fairway and the ground 26 to
  55 m from every line is rough (`skipHoles` names a line that carries over trees).
- `flights`: one model per photo year, and the fairway is what they agree on (the geometric mean of their
  verdicts). No single flight separated Tjusta's fairways from its semi-rough: pale in the June 2025 drought,
  striped in April 2021. One model over all the flights' features did not settle and is not offered.
- `ndviAbove`: the vegetation line. A drought photo's fairway reads NDVI 0.03 to 0.16; the default 0.12 threw
  half of it away before the model saw it.
- `holeReachMetres`: mown ground is shared out to the hole whose line is nearest, and to none beyond that reach.
  Without it a connected piece has one owner, and holes side by side in open ground are one piece (Tjusta's 1st
  took ten hectares; four holes got nothing).
- `fit: "settled"`: fits each fairway model to convergence. The turf model's fixed 900 steps are enough where the
  classes stand apart, as on a ground's verified outlines; fairway against rough from hole lines they never settle
  (the loss bounced between 0.5 and 1.3, the model's fairway accuracy between 0.61 and 0.92), and three hole lines
  moved 2 m took a quarter off Tjusta's 18th fairway. Settled, three samples of the same labels disagree on 0.9%
  of the ground. **A fairway that changes when nothing about it did is this fault: look for it.**

A routing's `greenOpenMetres` (in its decisions) trims its greens: the model's green component follows a mowing
line or an apron out of the putting surface as a spike, and an opening of that radius takes it off. Its
`greenInsetMetres` and `greenReachMetres` start each model-traced green that far inside its component and stop the
edge search short of where it began: the component runs to the collar's outer edge, the strongest edge on a dry
summer's photo, and a search begun there stays there. Tjusta's greens came out 20 to 100% too large that way (the
3rd was drawn at 427 m2 and is 213), and neither look saw it at sheet scale: the second reviewer named only
"spurs". **Look at every green on the photo with its contrast stretched** (2nd to 98th percentile of the window):
the putting surface, its collar and the rough then stand apart, and a spring photo shows the surface as one even
colour. A green whose rim a shadow or an approach hides is drawn by hand as an oval or a closed curve, with what
it was read from. A kept bunker's `trimMetres` (in the sand decisions) takes a bare patch off its lip the same way.

**A third and a fourth photo year are cheap, and each showed something.** Tjusta's May 2023 photo showed the 4th
hole's yellow tee deck, built after the laser was flown and in shade on the tracing photo, and that a sand-bright
strip by the 18th tees is a 2.5 m trench and not a tee. Fetch them when a tee or a fairway will not settle.

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
| Terrain before anything is published, then canopy | `course-workflow/bootstrap-terrain.mjs`, `packages/course-geo/copc-reader/build-canopy.mjs --ground-document <bootstrap ground.json>` (the rasters are bound to the finest tiles: 4,096 cells a side, never the 16 km world) |
| Pin the inputs, run the six stages, promote | `pin-production.mjs --ground <ground>` (the checksums in `production.json`), `production.mjs --ground <ground> --configure`, `$PX node packages/course-workflow/cli.mjs run --ground <ground> --through validate`, `promote.mjs` |
| Register the ground | the rebuild's `register` step, after `promote`, runs all of this with no hand step, the phone map's frame (`MAP_GROUND_FRAMES`) among the tables. `ground-card.mjs --ground <ground> --apply` adds the card's row to every table the ground is missing from (ten files; it adds at a table's end, never changes a row, and waits with the scenery registry until the scenery module is written), then `ground-card.mjs --ground <ground> --check` and `node tools/sync-course-registries.mjs --check`. A new club changes the start menu's list and the Sverigekarta's groups: on a served build run `tools/check-chooser-ui.mjs` and `tools/check-lobby-scale.mjs` |
| Scenery: roofs, sand, buildings, species, water, campus | `geobuild/facilities/roof-colours.py`, `<build>/facilities/build_campus.py` on `tools/facility-pipeline/campus_mesh.py` (frames, faces that know which way they look, roofs, the export), `tools/facility-pipeline/*` |
| A building's own axes, eaves and roof levels from the laser, before modelling it | `node tools/facility-pipeline/measure-building.mjs --points <points.json> --context <context.geojson> --building <id>` |
| The campus model as pictures, on the CPU | `blender --background --factory-startup --python tools/facility-pipeline/preview-facility-glb.py -- --manifest <facilities-v1.json> --out <dir>` |
| Lätt 3D: the map's pictures and its copy of the club's own buildings | `node tools/bake-map-land.mjs`, `node tools/bake-map-buildings.mjs` (the rebuild's `map-land` and `map-buildings` steps; the doctor says when either is behind) |

The six stages watch the code they run and nothing else: the stage adapter and the runner with every module they
import (68 modules, one of them the app's), the two lockfiles and the ground's profile. The app may be edited
while they run, and an edit to it expires no stage. Do not edit one of those modules or a stage's input while
they run: the runner refuses a build whose inputs moved under it. `workflow.json` names the two entry points;
their imports are followed each time (`codeInventory` in `packages/course-workflow/io.mjs`).

**Gate:** `node tools/check-course-quality.mjs --ground <ground>` has no errors, and each warning is explained;
`pnpm exec vitest run apps/golf` passes, which includes the test that every kind and list in the new pack is
known to the phone map (`MAP_KNOWS` in `map-course.mjs`) and the test that no mapped surface is both painted by
the ground and laid as a sheet (`mapped-surface-once.test.mjs`); `node tools/lint-app.mjs` is clean; and
`node tools/audit-water-levels.mjs --course <slugs> --check` names no water body near play that stands unlike
every accepted pond, or each one it names has been looked at.

**Both modes, one source** (the owner, 27 November 2026). Detaljerad 3D is for the desktop and may spend the
GPU; Lätt 3D is the phone's, for a round with GPS, and stays light. A ground is built once: its terrain, outlines,
trees, water, roof colours and club buildings are the same records in both, and Lätt 3D draws its own lighter
copy of each. Its copies are baked: the land pictures (`bake-map-land.mjs`) and the club's own buildings
(`bake-map-buildings.mjs`), both in the rebuild after `promote`, and its frame of a new ground is reviewed into
`MAP_GROUND_FRAMES` (`apps/golf/src/map/map-frames.mjs`). `course-doctor.mjs` reads all three for a ground and
says which is missing or behind. Never give one mode a fact the other reads differently: change the record, then
bake.

### 6. The first look

A short GPU sitting, before any bake.

```sh
node tools/course-walkthrough.mjs --ground <ground> --pictures     # prints the commands; it starts nothing
```

It chooses the views from the ground's own records, each for a fault it can show: the first tee (trees and
species), the last green (the buildings), holes with water (levels against banks, walls and tees), short holes
whole, waste areas (colour at a distance), every flagged hole, low quality, a low sun, winter, the phone map
of the same holes, and the practice ground from above, which no hole's view shows (the plan prints where to
stand). Look at every picture. For each fault: fix it, add the check that would have found it, and
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
| Final six stages and promotion | `cli.mjs run`, `promote.mjs` |
| Files no published generation names | `promote.mjs --ground <ground> --prune` lists them; `--apply` removes them. The generation before stays whole, as the rollback. |
| Map pictures, the map's club buildings, roof colours | `tools/bake-map-land.mjs`, `tools/bake-map-buildings.mjs`, `roof-colours.py` (both modes read the roof colours) |
| Every course's prepared water, tints, vista and scatter, then the boots | `BANVY_GPU=1 node tools/gpu-pass.mjs` (one sitting; `--dry-run` shows the order; it takes the first free port by itself and says which, so a pass beside another session's never serves or bakes the other checkout's build) |
| Posters, then the catalogue row and scorecard | `tools/make-posters.mjs --candidates` then `--write`; `packages/course-pack/emit-manifest.mjs --only=<slug>` |
| The walkthrough | `node tools/course-walkthrough.mjs --ground <ground>`, then write its hand parts |
| Release | `cli.mjs release`, or the owner's recorded acceptance: `acceptance.mjs --ground <ground>` prints what is open, and `--record --accepted-on <date> --basis "<what the owner was asked and answered>" --reasons <file>` writes the record, refusing one that leaves an open item out |

**Gate:** the rehearsal, which is one command: `node tools/course-rehearsal.mjs --ground <ground>`. It makes a
clean worktree of the commit to be pushed, with no private caches, and runs there what the pull request's two
pipelines run (the manifests, the controls, the acquisition tests, the whole suite, the renderer proof, the build
and its prepared data, the migration check, the workflow checks, `check-new` against main) and the walkthrough's
check; about two minutes. `--dry-run` lists the steps and the three commands it leaves out, with why. A test
holds its list to the workflow files. Commit first: uncommitted changes are not in it. Open the pull request
only when it and the GPU pass have finished.

**The Cloudflare deploy has a gate no pull request runs:** the browser journeys of
`tools/check-release-journeys.sh` (the start menu, the lobby at a hundred clubs, a round on the map, a played
round, the hand-over). They run on main after the merge, and a failure stops the deploy: the course is then on
GitHub Pages and not on Cloudflare. Run them before the pull request, against a local Worker (the script as it is
on Linux; on Windows start `wrangler dev --local` as the script does, build with `BANVY_BASE=/` from PowerShell,
since Git Bash rewrites `/`, and run each `tools/check-<journey>.mjs` against it).

### 9. Ship

Sync with main first; if the engine moved there, bake again before merging. Merge when CI is green, watch the
four pipelines on main (course production, course geo, pages, cloudflare), then look at the live site: both
modes on each new routing and on one old course, with no console errors. `tools/check-live-course.mjs --base
<url> --ground <ground>` does that walk in a browser (first run on both hosts on 27 November 2026, for
Veckefjärden and Bro Hof). Then update the walkthrough and the memory.

Other sessions merge too. Each time main moves with a change to engine code every course runs, a branch that
holds baked data is merged with main and baked again, so decide who merges first and tell the others (27 November: six sessions, main moved
up to three times under each, and the GPU pass was run for some three hours in all, when one revision still held every course). A branch that changes one ground's pack or one
ground's own modules bakes that ground only (`--only`), and merges `index.json` course by course.

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
| A water edge, wall, bridge, plate or cart row | `layer-decisions.json` | `course-rebuild.mjs --from layers`, then as above | that ground |
| The card (lengths, par, index, a new tee) | `card.json` and the scorecard reference | stage 4, the six stages, promote, `emit-manifest.mjs --only` | that ground |
| A newer photo | stage 1 for the window | all of stage 3, with a full ring review | that ground |
| Newer terrain or laser | stage 2 | everything after it | that ground |
| Trees | a new round in `trees.json`, on a new unseen sample | stage 7, the six stages, promote, map pictures | that ground |
| A building or the campus model | `build_campus.py`, `publish-facility-glb.mjs`, `validate-facility-glb.mjs` | the campus test, then `bake-map-buildings.mjs` for Lätt 3D's copy (`map-club-buildings.test.mjs` fails until it runs) | none for the model alone |
| Colours, species, stated buildings, a ground's own switches | the ground's scenery module | the first look | that ground (its module is in its own revision, and in no other's) |
| A rule every course runs (how water stands, how the ground is drawn) | the engine | the first look, on more than one ground | **every course** |
| Something missing on the phone map | `map-course.mjs`, `map-paint.mjs`, `MAP_KNOWS` | the map tests, a look at phone width | none |
| A tee or a green that nobody could settle from the photos | ask the rounds: `tools/rounds-evidence.mjs --ground <ground> --shots <extract>` says where golfers tee off and putt (the extract is the owner's to make; the tool's header has the query) | then the row above for an outline | that ground |

After any of them: the quality gate, the walkthrough (`--check`), a first look at the holes that changed, and
the rehearsal. A ground built with its own older builder keeps that builder for small fixes; its walkthrough,
the quality gate and the map test work on it as they are. The looks work on it too (Ängsö, 27 November 2026):
`packages/course-geo/mapping/export-model-surfaces.mjs --build <build> --migration <its migration record> --slug <slug>`
writes its published outlines and tee marks in EPSG:3006 as `playing-surfaces.geojson`, marked as an export (it is
not a trace, and the ground stays "own builder"); a `trace-config.json` without decisions points the ring sheets, the
deck check and the sand audit at its photos and terrain, and the ring review, the second look and the walkthrough's
card column read it as they read a traced ground. A tee or outline is then fixed in the builder's own records, which
is where a fault found this way is put right; at Ängsö that was a decision file read after the review
(`angsobuild/mapping/tee-decisions.json`, [its walkthrough](courses/angso-walkthrough.md)).

## What catches what

Each row is a fault that happened, and what stands in its way now.

| Fault | Caught by | Stage |
| --- | --- | --- |
| An outline off the photo (an old OSM sketch, a deck since rebuilt) | ring sheets and the recorded review | 3 |
| A tee far from its card length | the card column of the walkthrough and the trace report | 3 |
| A decision file that cannot be traced (a card tee without a deck, an OSM id that is gone) | `check-decisions.mjs` | 3 |
| A tee ring off its deck under crowns, where neither photo shows the edge | `deck-ground.mjs`: the terrain under it is not level | 3 |
| A deck or bunker built after the terrain was flown | `deck-ground.mjs` for decks; for bunkers the second look's two photo years only | 3 |
| What the person who traced cannot see in their own work | the blind second look, whose doubts bind | 3 |
| A hole rebuilt after the terrain was flown, which the terrain's one date hides | the ground's age: bunkers without a bowl (`deck-ground.mjs`) and bunkers that were grass on the older photo (`audit-sand.py --compare`) | 3 |
| A bunker that was never drawn; a ring drawn by hand on ground that is not sand | `audit-sand.py`: each area and ring it names needs a verdict | 3 |
| Nobody knowing which of a dozen records is behind | `course-doctor.mjs`: every record of a ground, read once | always |
| A table that does not name a new ground, or names it differently | `ground-card.mjs --check` and its test | 0, 5 |
| A tee or green in water, a tee on ground at a water's own level | the build's tests; `check-course-quality.mjs` | 4, 5 |
| Ground in a pack that the phone map does not paint | `MAP_KNOWS` and its test on every pack | 5 |
| Tables that must agree and do not (frames, grounds, roofs) | `sync-course-registries.mjs --check` | 5 |
| A campus model that is too bright, too heavy or not what its manifest says | `validate-facility-glb.mjs`, the campus loader's tests | 5 |
| A pond whose outline misses its basin, or that stands at the height of its bank | `audit-water-levels.mjs --check`: the lines every accepted pond keeps (`tools/water-line.mjs`) | 5 |
| White stakes drawn across a hole's play, so Spela calls a ball on its own fairway or green out (Veckefjärden's 2nd, 3rd, 5th, 12th and 14th, found playing) | the quality gate, item 8: every tee shot and approach onto the hole's own ground replayed against the stakes (`tools/out-of-bounds-shots.mjs`) | 5 |
| Ponds standing low inside their banks because the engine read its level from carved ground | **a picture only** (the first look); `deferWaterBedToWorld` is the fix | 6 |
| A mapped surface painted by the ground and laid as a sheet as well | `mapped-surface-once.test.mjs`, on every published course | 5 |
| A surface wrong at a distance for another reason | **a picture only** | 6 |
| The water's reflection finding ground under an opaque sheet (Visby's 32 m squares, 27 November) | **a picture only**; compare `?waterreflect=0` | 6 |
| Trees of the wrong kind | **a picture only**; then the ground's species rule and its test | 6 |
| Trees placed worse than they should be | the held-out benchmark | 7 |
| Prepared data that no longer matches the code | `check-prepared-startup.mjs`, `check-prepared-water.mjs` | 8 |
| A shader over the varying limit, a console error at start | `check-gpu-clean-boot.mjs` (in the GPU pass) | 8 |
| A check that needs a private file | the rehearsal in a clean worktree | 8 |
| A walkthrough that has gone stale | its test | always |

The three rows marked "a picture only" are the gaps. Until a check exists for each, the first look is the gate.

## What a ground writes by hand

- its card, first: `course-workflows/<ground>/ground.json`. The rows marked (card) below are printed from it and
  held to it by a test; write the fact in the card and add the row with `--apply`;
- its frame and ring spec (`packages/course-v2/<ground>-ground-{graph,rings}.mjs`, a row in
  `ground-rings-registry.mjs`), its entry in `EXPECTED_GROUNDS` (`packages/course-geo/manifest.mjs`), and its
  runtime contract (`apps/golf/src/engine/v2-<ground>-config.mjs`, `v2-frontier-configs.mjs`,
  `v2-terrain-select.mjs`);
- `decisions.json` per routing, `sand-decisions.json` and `layer-decisions.json` (data only: the tracer and the layer builder are shared);
- its rows in `packages/course-pack/emit-manifest.mjs` (name, club, tees and their colours) (card);
- a scenery module (`apps/golf/src/engine/scenery/<ground>.js`, registered in `scenery/index.js` (card)). Go through
  this list for every ground:
  - `houseKit` and `roofColours`;
  - the sand's colour, if measured on the photo;
  - buildings the kit would guess wrong (`houseKitBuildings`) and the clubhouse fallback;
  - `species`: which broadleaves and conifers grow there, or every typed broadleaf is drawn a birch;
  - `deferWaterBedToWorld`, when the ground was flown with its ponds full;
  - the campus, if it has one;
- `course-workflows/<ground>/trees.json` for the tree pipeline;
- the start menu's rows (card): `shell/course-places.mjs` (place, and `HOST_CLUB` for a second routing),
  `shell/course-clubs.mjs` (the club and each layout's label), `shell/club-picker.js` (signature hole and its
  poster), `shell/club-search.mjs` (label, search words, the describing line);
- `tools/make-posters.mjs` (which holes, which framings), and a view or two in `tools/gfx-gallery.mjs` and
  `tools/map-gallery.mjs` (card).

`sync-course-registries.mjs --check` writes or checks the tables that only repeat the frontier registry, and
`ground-card.mjs --check` the ones a person fills in. The card does not generate the tables: other work edits
them, and the app's bundles may not import from the workflow. It is the one place a fact is written first.

## Lessons kept

They are on their own page, with the review of 27 November 2026 that measured where the time of nine sessions
went, what found the faults, what was changed and what is still heavier than it earns:
[what building the courses taught](pipeline-v2-lessons.md). Read it before a first ground, and its review before
adding a gate, a record or a tool.

## Where every ground stands

Written by `node tools/course-walkthrough.mjs --catalogue`; a test fails when it falls behind.

<!-- generated:catalogue -->
| Ground | Holes | Outlines | Ring review | Trees | Quality gate | Walkthrough | Release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `angso` | 18 | own builder | recorded | automatic | 0 errors, 1 warnings | [yes](courses/angso-walkthrough.md) | advisory, 3 open |
| `bro-hof` | 18 + 18 | decisions as data | recorded | one by one (review-2026-11-24) | 0 errors, 1 warnings | [yes](courses/bro-hof-walkthrough.md) | owner acceptance, 4 open |
| `johannesberg` | 18 + 9 | own builder | no record | one by one (review-2026-11-08) | 1 errors, 0 warnings | none | advisory, 4 open |
| `lidingo` | 18 | own builder | no record | automatic | 4 errors, 1 warnings | [yes](courses/lidingo-walkthrough.md) | advisory, 4 open |
| `norrfallsviken` | 18 | own builder | no record | one by one (review-2026-11-09) | 0 errors, 0 warnings | none | advisory, 3 open |
| `puttom` | 18 | own builder | no record | automatic | 1 errors, 0 warnings | [yes](courses/puttom-walkthrough.md) | advisory, 3 open |
| `ribbingsfors` | 9 | own builder | no record | automatic | 1 errors, 1 warnings | [yes](courses/ribbingsfors-walkthrough.md) | advisory, 3 open |
| `tjusta` | 18 | decisions as data | recorded | automatic | 0 errors, 0 warnings | [yes](courses/tjusta-walkthrough.md) | owner acceptance, 5 open |
| `tortuna` | 18 | own builder | no record | automatic | 0 errors, 0 warnings | none | advisory, 3 open |
| `upsala` | 18 + 9 | decisions as data | recorded | automatic | 0 errors, 0 warnings | [yes](courses/upsala-walkthrough.md) | advisory, 3 open |
| `veckefjarden` | 18 + 9 | own builder | no record | automatic | 3 errors, 1 warnings | [yes](courses/veckefjarden-walkthrough.md) | advisory, 3 open |
| `visby` | 18 | own builder | no record | automatic | 1 errors, 0 warnings | [yes](courses/visby-walkthrough.md) | advisory, 7 open |
<!-- /generated:catalogue -->

"Outlines: own builder" means the ground was built before the shared tracer, so it has no decision files and no
ring sheets. A quality-gate error on an older ground is a fault to fix or to explain in a walkthrough, and is
the best place to start improving it.

## Not done yet

- The two interim checks are weaker than they should be. The water lines are drawn from the 99 ponds that were
  accepted, not derived, and the audit reckons each level itself, so it cannot see the engine getting a level
  wrong. The drawn-once test lifts the sheet rule out of `main.js` as text. Both want the engine's own rules in
  a module a check can call: an engine edit, and so a bake of every course. Do it with the next engine change.
- The stake check (quality gate item 8, 27 November) names three holes on two other grounds where Spela calls good
  shots out: Ångsö 6 and 16 (a white run that zigzags across the hole, up to eleven crossings) and Johannesberg 16
  (its own white run crosses its fairway). They are errors in those grounds' gates until their stakes are redrawn.
  Spela's rule counts crossings of open lines, so a stake line must run unbroken past the play it borders.
- The water lines name two ponds on published grounds. Upsala's by the 4th (the outline misses its basin by 0.33 m)
  was looked at on 27 November: it is a creek drawn as a pond, partly off its channel, and its walkthrough keeps it
  as a fault for the layers step. Johannesberg 11 (it stands at the height of its bank) has not been looked at yet.
- The tracer does not stop on a low score by itself; the recorded review is what holds it.
- The deck check names a deck that is not on level ground; it cannot tell a ring off its deck from a deck newer
  than the terrain. The ground's age is read from three signs (a deck not level, a bunker without a bowl, a
  bunker that was grass on the older photo); a hole rebuilt without moving a tee or a bunker shows none of them.
  Nothing puts the ground right where it is older than the course: a new tee is drawn on the old slope and a new
  bunker as flat sand. That takes reshaping the terrain under them, which is a new ground generation and a bake.
- Every ground has a card and a test holds each to its tables, but the tables do not read the cards yet: a fact
  is still written twice. The ten older grounds' cards were derived from the tables (`ground-card.mjs --derive`),
  so they say that the reason for a position or a poster hole was not recorded.
- The tracer writes `start: "extracted-sand"` on a sand ring that was drawn by hand; the sand audit is what finds
  those today. The sand audit does not see sand in shade.
- Five older grounds fail the quality gate on white campus materials brighter than the glow's ceiling (Lidingö 4,
  Veckefjärden 2, Puttom, Ribbingsfors and Visby 1 each; six of the nine are above the glow's own threshold of
  0.86, three between 0.82 and 0.86). It is not a patch: each model's checksum is pinned in its ground's own
  validation records (for Veckefjärden in a tree review's input lock as well), so a dimmer white means rebuilding
  the model with that ground's builder and validating it again, and it changes how the clubhouse looks. The
  owner's to decide, ground by ground: rebuild, or accept the model as it was looked at and say so in its
  walkthrough.
- The owner's review page has not been used by the owner (see the review of 27 November).
- The second look has been taken on six routings, each time by an agent. Its "no doubt" on bunkers is weak: a white line on white
  sand hides a line drawn a metre inside the edge.
- Real rounds have not been read yet: `rounds-evidence.mjs` is tested on made-up shots only, because the extract
  from the players' data is the owner's to make. A phone's fix is good to a few metres, so it names a place only
  on several shots that agree.
- Four grounds' source data is on the build machine (Tjusta 18 GB, Bro Hof 4.9, Ängsö 1.4, Visby 0.9;
  `course-doctor.mjs --private` lists it). Nothing is backed up, and the other eight have none in the main
  checkout, so tracing one of them again starts with fetching its sources.
- No ground has been looked at on a real phone as part of this process, and none has passed the full release
  review: Bro Hof came in on the owner's recorded acceptance.
- `tools/check-map-field.mjs` and two start-menu checks failed on 24 November for reasons older than Bro Hof;
  they have not been run again since.
- Three of the twelve grounds have no walkthrough (Johannesberg, Norrfällsviken, Tortuna).
