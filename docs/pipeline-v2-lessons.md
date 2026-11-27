# What building the courses taught (pipeline v2)

The lessons behind [the pipeline](pipeline-v2.md), kept apart from it so that the path stays short. Read the review
first: it says where the time went and what is still heavier than it earns. Then the lessons, which are in the
order they were learnt; each names the ground that taught it.

## The review of 27 November 2026

After Bro Hof (24 November), Tjusta (26 November) and a night on which six sessions improved six grounds at
once, the owner asked what had been learnt, and for a pipeline that makes a course accurately without being more
than it needs to be. The nine sessions' transcripts were read for what was run, how often and for how long.

**Where the time went** (minutes that could be timed; work sent to the background is undercounted):

| What | Runs | Minutes | What it bought |
| --- | --- | --- | --- |
| `gh`: opening pull requests and waiting for their pipelines | 110 | 258 | nothing to cut: a pull request's checks take 4 minutes, the Cloudflare deploy on main 10 to 16 |
| The GPU pass and single bakes | 66 | 180 | every course baked again each time main moved under an engine change |
| The six stages | 18 | 87 | at Tjusta one stage, the automatic trees, is 34.5 of 35.1 minutes |
| Tracing | 71 | 80 | the loop that makes a course right |
| Pictures on the GPU and in the browser | 130 | 68 | every fault that was found late was found here |
| Ring sheets, and 11 blind looks by an agent | 46 | 33 | the looks, taken whole each time an outline moved |

**What found the faults.** The owner, playing and looking: five of that night's six tasks began with something
the owner had seen, told in a sentence, twice with a screenshot. Pictures. The card's lengths against the tees. A third and a fourth photo year. The terrain under
the decks. The blind second look, for decks and for what was built after the laser. The sand audit, for rings
drawn by hand. What found nothing is under "heavier than it earns" below.

**What was changed that day,** each with its test:

1. The six stages watch the modules they import (71 files, where they watched 1,038).
2. A look is kept ring by ring and photo by photo; a trace again asks for a look at the rings that moved, and the
   answers given to a second reviewer's doubts stay with their rings.
3. `course-rebuild.mjs` runs from the ground's card, so it serves the tracing loop of a new ground and the looks
   and follow-up steps of the eight grounds with their own builders; it pins the roof colours after a promotion.
   The second, unused plan of the same steps (`production.mjs --bake-promoted`) is gone.
4. The GPU pass takes a free port by itself.
5. A new ground's canopy rasters are bound to its finest tiles.

A second round the same day asked what a new club still costs. Tjusta took some fifteen hours of work: six on its
outlines and on teaching the tracer what its ground needed (tan sand, fairways from the holes' lines, a routing
from guide plates: learnt once), then registration, bakes and merging. Its session wrote 37 scripts outside the
repository, as Bro Hof's had; one of them pasted the card's rows into ten files by anchor strings. So:

6. `ground-card.mjs --apply` adds a ground's rows to every table it is missing from, at the table's end, and
   never changes one that is there.
7. `tools/course-rehearsal.mjs` is the rehearsal as one command, about two minutes, with the four things each
   session met again built in; a test holds its steps to the workflow files.
8. One layer builder for every ground (`packages/course-geo/mapping/build-layers.py`). Bro Hof's and Tjusta's
   were copies of 250 lines that had drifted apart; the one gives both grounds' three layer files byte for byte.
9. The first pictures name where to stand to see the practice ground, which no hole's view shows.

**What is still heavier than it earns.** Each of these is the owner's to decide, and none was done:

1. **The release review has never been passed, and cannot be.** Twelve grounds hold 168 release gates, all
   pending, and 1,764 verdicts by hole and category, all unknown; no ground has a set of timings. One of the 14
   gates is independent survey control, which will not exist. Its fingerprint of a candidate holds every file of
   the app on the eight grounds that were adopted, so any commit voids it. Both new grounds came in on the owner's recorded
   acceptance, which is read once, when the ground first merges. What is real is the walkthrough with its faults
   and the owner's word. Proposed: make those two the release, keep the checks of structure, sources and every
   byte, and retire the per-hole review records, the page that fills them and the half of `release.mjs` that
   reads them.
2. **A new ground, and any edit to one ground's scenery module, bakes every course.** The prepared data is held to
   one hash of the engine, the loader, `course-v2` and `main.js`, and each ground's own modules and the tables
   that register them are in it. Proposed: a revision per course that leaves out the other grounds' own modules,
   with the registries read as data: one engine change and one last bake of everything, after which a new ground
   or a colour fix bakes itself only, and most of the baking when sessions merge goes away.
3. **A ground's facts are still written twice.** The card now adds its rows to the tables, but a fact changed
   later is changed in both. Proposed: the build tools read the card, and the start menu's tables are generated
   from the cards into one file.
4. **Eight grounds have no one command.** A republish with an own builder is a chain typed by hand (a dozen steps
   at Veckefjärden). Proposed: each such ground's card lists its builder's commands, and `course-rebuild.mjs`
   runs them between `review` and `roofs`.
5. **The tree stage scans its whole raster once for every tree.** One loop in
   `packages/course-v2/vegetation/compile-vegetation.mjs`, where the stand field leaves out the crowns that became
   records, is 72% of Tjusta's stage: 9,184 records, each a pass over 268 million cells. One pass for all of a
   campaign's records gives the same 357 files, byte for byte, in 7.8 minutes where the stage took 27.1 (both run
   on 27 November, the second with the loop replaced in memory and the file left as it is). It is not in this
   change: the file lies under `packages/course-v2`, which the prepared data's revision hashes whole, so the edit
   would turn off every course's prepared data until a bake. Make it with the next engine change. A revision that
   holds a tree compiler the player never loads is the stages' old watch again, and item 2 would cure it.
6. **Tjusta's canopy** covers the 16 km ground. Rebuilt bound to the core at its tree sitting, its cache falls
   from 16 GB to 1, and what is left of its tree stage after item 5 (the passes that go with the number of cells)
   should fall to about a sixteenth (not measured).
7. **Tools built ahead of their use:** the owner's review page (never opened by the owner, who reviews by playing)
   and `rounds-evidence.mjs` (run on made-up shots only). Keep the second only if the extract will be made.
8. **A new ground still copies some 500 lines of another ground's scripts.** After the layer builder these are
   left, each a copy with names changed: `acquire-water-breaklines.mjs` (100 lines, 31 differing, its clip box the
   ground's own core), `run-ortho-intake.mjs`, the build's `course.node-test.mjs` (150 lines) and the helpers at
   the head of `make-decisions.mjs` (a deck, a ring, an oval). Proposed: share each as the layer builder was
   shared, proving it on the grounds that have it.
9. **A new ground's frame is three modules of derived numbers** (its lattice, its rings, its runtime contract:
   85 lines) and four registry rows, all following from its centre and its names. Proposed: a scaffold that
   writes them, proved by writing Tjusta's and Bro Hof's again. They are engine code, so they come with the
   bake a new ground brings anyway, until item 2.
10. **A new ground starts from Bro Hof's tracing defaults and meets Tjusta's faults again.** The switches that
    cured them are opt-in. Proposed: a starting `trace-config.json` with them on, each with when to turn it off.
11. **The Cloudflare journeys have no runner on Windows.** Each session started the Worker by hand. Proposed: a
    Node runner beside the shell script, and a step in the rehearsal.

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
- **A gate that is wider than what it guards is paid for every day.** The six stages watched the whole app (1,038
  files) and run 68 modules, one of them the app's: a start-menu edit expired every stage. At Tjusta the stages
  were run ten times, and the tree stage alone takes 35 minutes there. They now watch what they import. Before widening a
  watch, a hash or a "look again", ask what it guards, and guard that.
- **A raster as large as the world is mostly nothing.** Tjusta's canopy was written over the 16 km ground, of which
  only the 4 km core is read: 16 GB for 1, and the same trees. `build-canopy.mjs` binds a new ground's rasters to
  its finest tiles. When a step takes ten times what it took on the last ground, find out why before the next run.
- **Sessions in parallel share one machine.** On 27 November six sessions worked on six grounds at once, each in
  its own worktree. The GPU pass served every checkout on port 8641, and its server check asked only whether
  something answered there. A second pass would have baked and booted the first one's build. A pass now takes a
  free port by itself. Whichever pull request with an engine change merges second bakes again on the merged
  main: that, and not the port, is what cost the night its hours.
- **A tool nobody runs is not the process.** In the six sessions after `course-rebuild.mjs` was written it was run
  4 times, and its steps by hand some 300 times: it could not start before a production profile existed, which is after the outlines,
  and it did not know the eight grounds with their own builders, where four of the five sessions worked. It now
  runs from the card. When a step is being typed by hand again and again, the tool is missing a case.
- **The practice ground is part of the course, and is looked at like one.** Tjusta's putting green came out with its
  collar, its chipping apron as a piece of the 1st fairway, its short-game area as rough and its tee line as a green
  strip, and no check saw any of it: the owner did, from the 1st tee. Draw each practice surface on the photo
  (`layer-decisions.json`), keep the fairway model out of the ones it is not (`fairwayExclude`), and give a range its
  tee line as a `range_bay_line`, which the compiler turns into the bays the engine and the phone map draw.
- **A new club is a change to the start menu.** Tjusta, the twelfth club, stayed in Bro Hof's group on the
  Sverigekarta a step longer than any club before it, and showed that opening a group lost the keyboard under
  reduced motion. Only the Cloudflare pipeline's journeys saw it, after the merge.
