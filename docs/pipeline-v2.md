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

Stages 3 to 5 and the CPU half of stage 8 are one command, which runs the steps below in their one order, stops
at the ring review until the look is recorded, and starts nothing on the GPU:

```sh
node tools/course-rebuild.mjs --ground <ground> --dry-run            # the steps and their commands
node tools/course-rebuild.mjs --ground <ground> [--from <step>] [--to <step>] [--compare <leaf-off photo>]
```

### 0. Preflight

- The tools run: `node tools/course-doctor.mjs --machine` (Node 22 or later; the Python libraries the looking
  tools need, and separately the ones the tracer needs; Blender).
- `node packages/course-workflow/cli.mjs check` passes, and `git status` is clean on a new branch.
- The raw caches named in the ground's handover are on disk. They are never downloaded twice.
- The ground's card is written: `course-workflows/<ground>/ground.json` holds every fact a person chooses for the
  ground (club, place, tees and their colours, search words, poster holes, gallery views), once. Every published
  ground has one.
  `node packages/course-workflow/ground-card.mjs --ground <ground>` then lists every table the ground is missing
  from, and `--rows` prints the rows to paste.

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
| Water, context, infrastructure | `mapping/prepare-osm-context.py`, `<build>/mapping/build-layers.py` |
| Every ring on the photo, worst score first, both photo years | `$PX -e mapping python packages/course-geo/mapping/render-ring-sheets.py --config <build>/mapping/trace-config.json --compare <leaf-off photo>` |
| Record the look | `node packages/course-geo/mapping/ring-review.mjs --build <build> --record --reviewer "<who, on what>"` |
| The same rings blind, for a second reviewer | `render-ring-sheets.py ... --blind`, the `ring-reviewer` agent, then `ring-review.mjs --build <build> --second <verdicts.json>` |
| Answer each of its doubts | redraw the ring, or `ring-review.mjs --resolve id="why it stands"`, or `--fault id="what is wrong, and what will put it right"` |
| One place, large, with a grid and any layer drawn on it | `$PX -e mapping python packages/course-geo/mapping/render-photo-window.py --config <...> --at E N --span 80 --out <picture>` |
| Each hole whole, on the photo | `packages/course-workflow/render-source-overlays.py` (the mapping stage prints its command) |
| The owner's look, hole by hole | `node tools/course-review-page.mjs --ground <ground> --overlays <dir>`, then `--import <saved review> [--apply]` |

**Gate, in numbers:** every tee mark more than 5 m from its card length is explained in the walkthrough, not
warped away, and every deck `deck-ground.mjs` names has been looked at: a deck on its deck slopes under 2% in
the terrain, and one that slopes 5% or more is either off its deck or newer than the terrain. **Gate, by eye:**
every sheet has been looked at, the look is recorded against the exact outlines (`ring-review.json`), and every
tee or green under the score line has a verdict in words. `ring-review.node-test.mjs` fails when an outline
changes after the look. The score finds most doubtful rings and not all: four of Bro Hof's wrong decks scored
well, so look at the whole sheet.

**The second look.** Whoever traced sees what they meant to draw. A second reviewer is given the blind sheets
only (hole order; no scores, no sources, no tee colours) and nothing else: not the decisions, not the first
look. Its doubts are recorded and bind: each is answered by redrawing, by a reason the ring stands, or by
keeping it as a fault that the walkthrough prints. At Bro Hof it found a tee 3 m over a bank that the first look
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
| Terrain before anything is published, then canopy | `course-workflow/bootstrap-terrain.mjs`, `course-v2/vegetation/build-canopy.mjs --ground-document` |
| Pin the inputs, run the six stages, promote | `pin-production.mjs --ground <ground>` (the checksums in `production.json`), `production.mjs --ground <ground> --configure`, `$PX node packages/course-workflow/cli.mjs run --ground <ground> --through validate`, `promote.mjs` |
| Register the ground | paste the card's rows (`ground-card.mjs --ground <ground> --rows`), then `ground-card.mjs --ground <ground> --check` and `node tools/sync-course-registries.mjs --check`. A new club changes the start menu's list and the Sverigekarta's groups: on a served build run `tools/check-chooser-ui.mjs` and `tools/check-lobby-scale.mjs` |
| Scenery: roofs, sand, buildings, species, water, campus | `geobuild/facilities/roof-colours.py`, `<build>/facilities/build_campus.py` on `tools/facility-pipeline/campus_mesh.py` (frames, faces that know which way they look, roofs, the export), `tools/facility-pipeline/*` |
| A building's own axes, eaves and roof levels from the laser, before modelling it | `node tools/facility-pipeline/measure-building.mjs --points <points.json> --context <context.geojson> --building <id>` |
| The campus model as pictures, on the CPU | `blender --background --factory-startup --python tools/facility-pipeline/preview-facility-glb.py -- --manifest <facilities-v1.json> --out <dir>` |
| The map's pictures | `node tools/bake-map-land.mjs` |

Do not edit a watched file while the six stages run: the runner refuses a build whose inputs moved under it.

**Gate:** `node tools/check-course-quality.mjs --ground <ground>` has no errors, and each warning is explained;
`pnpm exec vitest run apps/golf` passes, which includes the test that every kind and list in the new pack is
known to the phone map (`MAP_KNOWS` in `map-course.mjs`) and the test that no mapped surface is both painted by
the ground and laid as a sheet (`mapped-surface-once.test.mjs`); `node tools/lint-app.mjs` is clean; and
`node tools/audit-water-levels.mjs --course <slugs> --check` names no water body near play that stands unlike
every accepted pond, or each one it names has been looked at.

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
| Final six stages and promotion | `cli.mjs run`, `promote.mjs` |
| Files no published generation names | `promote.mjs --ground <ground> --prune` lists them; `--apply` removes them. The generation before stays whole, as the rollback. |
| Map pictures, roof colours | `tools/bake-map-land.mjs`, `roof-colours.py` |
| Every course's prepared water, tints, vista and scatter, then the boots | `BANVY_GPU=1 node tools/gpu-pass.mjs` (one sitting; `--dry-run` shows the order) |
| Posters, then the catalogue row and scorecard | `tools/make-posters.mjs --candidates` then `--write`; `packages/course-pack/emit-manifest.mjs --only=<slug>` |
| The walkthrough | `node tools/course-walkthrough.mjs --ground <ground>`, then write its hand parts |
| Release | `cli.mjs release`, or the owner's recorded acceptance: `acceptance.mjs --ground <ground>` prints what is open, and `--record --accepted-on <date> --basis "<what the owner was asked and answered>" --reasons <file>` writes the record, refusing one that leaves an open item out |

**Gate:** the rehearsal. In a clean worktree of the commit to be pushed (`git worktree add ../rehearsal HEAD`),
with no private caches, run what CI runs: `node packages/course-workflow/cli.mjs check-new --base-ref $(git
rev-parse origin/main)`, `node packages/course-geo/check-manifests.mjs`, `$PX test-acquisition`,
`$PX plan-hole-controls`, `$PX check-migration`, `pnpm test`, the build, `node tools/check-prepared-startup.mjs`
and `node tools/course-walkthrough.mjs --ground <ground> --check`. Open the pull request only when all of it
and the GPU pass have finished.

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
<url> --ground <ground>` is written to do that walk (it opens a browser, so ask first); it has not yet been run
against a live site. Then update the walkthrough and the memory.

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
| Trees of the wrong kind | **a picture only**; then the ground's species rule and its test | 6 |
| Trees placed worse than they should be | the held-out benchmark | 7 |
| Prepared data that no longer matches the code | `check-prepared-startup.mjs`, `check-prepared-water.mjs` | 8 |
| A shader over the varying limit, a console error at start | `check-gpu-clean-boot.mjs` (in the GPU pass) | 8 |
| A check that needs a private file | the rehearsal in a clean worktree | 8 |
| A walkthrough that has gone stale | its test | always |

The three rows marked "a picture only" are the gaps. Until a check exists for each, the first look is the gate.

## What a ground writes by hand

- its card, first: `course-workflows/<ground>/ground.json`. The rows marked (card) below are printed from it and
  held to it by a test; write the fact in the card and paste the row;
- its frame and ring spec (`packages/course-v2/<ground>-ground-{graph,rings}.mjs`, a row in
  `ground-rings-registry.mjs`), its entry in `EXPECTED_GROUNDS` (`packages/course-geo/manifest.mjs`), and its
  runtime contract (`apps/golf/src/engine/v2-<ground>-config.mjs`, `v2-frontier-configs.mjs`,
  `v2-terrain-select.mjs`);
- `decisions.json` per routing, `sand-decisions.json`, `layer-decisions.json` and `<build>/mapping/build-layers.py`;
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
  then a photograph for the order of the façade, and a list of what was estimated. A mapped footprint can lie a
  degree off its roof: fit a line through the ridge's own returns and read every level again in that frame. A
  dark roof returns little, and its shadow on a morning photo looks like a lean-to: the ground returns under it
  say which (Tjusta's barn).
- **Rewriting one catalogue row must keep its baked records** (`emit-manifest.mjs --only`).
- **A heredoc with an apostrophe breaks in Git Bash.** Write scripts as files.
- **A terrain model has many dates.** It is a mosaic, and its record's date is its newest patch. What tells the
  age of the ground under a hole is the ground itself: a deck that is not level, a bunker with no bowl.
- **A deck that is not level in the terrain is off its deck or newer than the terrain, and the heights alone cannot
  say which.** Castle 7's decks were first sorted as off their decks, because the terrain has level platforms
  beside them. Both photo years showed the hole had been rebuilt, bunkers and all: the platforms were the old
  decks. Look at both years, and at whether the hole's other features changed, before redrawing anything. Where
  a hole was not rebuilt and a deck is hidden under crowns, draw it as the laser platform.
- **Importing a tool runs it.** The gallery and poster tools start a browser at their top level, so a table in
  one is read from its text (`literalOf` in `ground-card.mjs`), never by importing the file.
- **A relative output path is the tool's to resolve.** Blender resolves one against the drive, pathlib against
  nothing: resolve `--out` before using it.
- **A sheet at 5 px a metre cannot see a green's collar.** Tjusta's greens passed two recorded looks while every
  one was 20 to 100% too large. Stretch the photo's contrast and look at each green alone; hold a spring photo
  beside the summer one.
- **A model that has not settled looks like a model.** Tjusta's fairway fit printed plausible accuracies on every
  run and a different fairway each time a line moved. When an outline changes and its evidence did not, fit again
  from another sample before believing either.
- **With no club map, a guide's hole plates are the routing's witness.** They are drawings: registered on the photo
  they say which deck and which green, never where an edge lies, and a par 3's plate rarely registers.
- **A ground needs its land cover before its map.** Without `sidecars.landcover` everything past the 1 m core is
  forest by rule; the map's forest-picture test says so, and it is the only thing that does.
- **The six stages take the whole app as their input.** One line changed under `apps/golf/src` is 40 minutes of
  stages again, and an edit while they run loses the run. Batch the app's edits between runs: register the
  terrain config before the first run, and take the first pictures before the second.
- **A new club is a change to the start menu.** Tjusta, the twelfth club, stayed in Bro Hof's group on the
  Sverigekarta a step longer than any club before it, and showed that opening a group lost the keyboard under
  reduced motion. Only the Cloudflare pipeline's journeys saw it, after the merge.

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
- The owner's review page has not been used by the owner, and `check-live-course.mjs` has not been run: both
  open a browser.
- The second look has been taken once, by an agent. Its "no doubt" on bunkers is weak: a white line on white
  sand hides a line drawn a metre inside the edge.
- Real rounds have not been read yet: `rounds-evidence.mjs` is tested on made-up shots only, because the extract
  from the players' data is the owner's to make. A phone's fix is good to a few metres, so it names a place only
  on several shots that agree.
- Only Bro Hof's source data is on the build machine (4.8 GB); nothing is backed up, and the other ten grounds
  have no raw photos or laser there at all, so tracing one of them again starts with fetching its sources.
- No ground has been looked at on a real phone as part of this process, and none has passed the full release
  review: Bro Hof came in on the owner's recorded acceptance.
- `tools/check-map-field.mjs` and two start-menu checks failed on 24 November for reasons older than Bro Hof;
  they have not been run again since.
- Ten of the eleven grounds have no walkthrough.
