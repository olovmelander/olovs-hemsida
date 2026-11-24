# A new course, start to finish (pipeline v2)

The [course production workflow](course-production-workflow.md) says what a course must prove. This is how the
first course built entirely with the shared tools got there: Bro Hof Slott, two 18-hole routings on one new
ground, November 2026. Nothing below is specific to it. A new ground needs its own configuration and decision
files, and no new compiler, tracer or loader.

Every heavy step runs alone (`node --test --test-concurrency=1`, `vitest --maxWorkers=2`). Anything that opens a
browser or uses the GPU is the owner's to start.

## The order

| # | Step | Tool | Writes |
| --- | --- | --- | --- |
| 1 | Club sources, card, OSM, orthophoto windows, dense laser by the buildings | `packages/course-geo/intake/*` | `<build>/cache` (private), `<build>/reference/club-scorecard.json` |
| 2 | Frame, ring spec, terrain acquisition | `packages/course-v2/<ground>-ground-{graph,rings}.mjs`, `ground-rings-registry.mjs` | 469-tile terrain cache, `acquisition/ground-rings.json` |
| 3 | Trace greens, tees, fairways, bunkers, waste areas | `mapping/trace-course-surfaces.py` (`turf_tracing.py`) | `playing-surfaces.geojson`, `trace-report.json` |
| 4 | Clean OSM context, water, infrastructure | `mapping/prepare-osm-context.py`, `<build>/mapping/build-layers.py` | the other GeoJSON layers |
| 5 | Compile each routing | `mapping/compile-grid-course.mjs` | `course-model.json`, `heightfields.json` |
| 6 | Terrain before anything is published | `course-workflow/bootstrap-terrain.mjs` | a ground document under `output/` |
| 7 | Canopy and stands | `course-v2/vegetation/build-canopy.mjs --ground-document` | canopy evidence |
| 8 | Inventory the models, pin the inputs, run the six stages | `course-geo/inventory-models.mjs`, `production.mjs --configure`, `cli.mjs run --through validate` | source records, a validated candidate under `output/` |
| 9 | Merge the candidate | `course-workflow/promote.mjs` | `apps/golf/public` |
| 10 | Register the ground | `sync-course-registries.mjs`, `v2-frontier-configs.mjs`, the shell's course lists | source tables |
| 11 | Roof colours, campus | `geobuild/facilities/roof-colours.py`, `<build>/facilities/build_campus.py`, `tools/facility-pipeline/*` | the scenery module's data, `models/<ground>/` |
| 12 | Trees one by one | `tools/tree-pipeline.mjs` and its agent | reviewed candidates, then step 8 again |
| 13 | The map's pictures | `tools/bake-map-land.mjs` | `models/map-land/` |
| 14 | Prepared water, tints, vista, scatter; posters | `tools/gpu-pass.mjs`, `tools/make-posters.mjs` (GPU: ask first) | `apps/golf/public` |
| 15 | Quality gates | `check-course-quality.mjs`, `render-source-overlays.py`, `pnpm test`, the browser checks | reports |
| 16 | Release | `course release`, or an owner's recorded acceptance (`course-workflow/acceptance.mjs`) | `owner-acceptance.json` |

```sh
PX="pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen"

$PX -e mapping python packages/course-geo/mapping/trace-course-surfaces.py --config <build>/mapping/trace-config.json --cache <build>/cache/mapping
$PX -e mapping python packages/course-geo/mapping/prepare-osm-context.py --config <build>/mapping/context-config.json
$PX -e mapping python <build>/mapping/build-layers.py
node packages/course-geo/mapping/compile-grid-course.mjs --config <build>/mapping/course-input.json

node packages/course-workflow/bootstrap-terrain.mjs --ground <ground> --origin-height <RH 2000>
$PX node packages/course-geo/inventory-models.mjs --ground <ground>
node packages/course-workflow/production.mjs --ground <ground> --configure
$PX node packages/course-workflow/cli.mjs run --ground <ground> --through validate
node packages/course-workflow/promote.mjs --ground <ground> --dry-run
node packages/course-workflow/promote.mjs --ground <ground>
node tools/bake-map-land.mjs
node tools/sync-course-registries.mjs --check
node tools/check-course-quality.mjs --ground <ground>
```

## Decisions are data

A tracer that can be re-run needs its judgement outside its code. Each routing has a `decisions.json`: the hole's
line and its source, tee platforms by name, a seed per green and any ring a reviewer drew instead. The ground has
`sand-decisions.json` (which bright blobs are bunkers, which are waste areas, what is neither) and
`layer-decisions.json` (practice areas, walls, bridges, plates). Each entry says why. `trace-report.json` records
every residual. A wrong outline is fixed by changing a decision and tracing again, never by editing a GeoJSON.

## What each step learned

Each of these cost time at Bro Hof and is now in the tools.

- **The photo is the truth for outlines, the laser for heights.** Four bands at 0.16 m, one June exposure, traced
  greens to a 0.64 m mean of the best independent outline. OSM is a seed, not a measurement.
- **Card lengths check the tees; they do not move them.** Of 162 marks 150 fall within 5 m of the card and the
  median residual is 0.1 m. The outliers are written down, not warped away.
- **A tiling cuts what crosses it.** Windows are 500 m with a 300 m margin, and a shape that touches its margin is
  an error.
- **A plate is a drawing.** A hole guide gives order, names and intent (stacked stone, boulders). It gives no
  position. Every plate claim was checked on the photo, and one ("timber bulkheads") was wrong.
- **One sand or two is a measurement.** Both routings' bunkers read 220 ± 4 of 255 in one exposure, so there is one
  sand. The waste areas read about half that and became their own ground class.
- **A new ground has no baseline.** `baselineGround: null` with `firstGenerationPolicy:
  'initial-source-compilation'` is the only way through, and the terrain has to exist before the canopy does.
- **Look at every deck, not at a sample.** Seven Stadium tees kept rough OSM sketches or platforms from before the 2021
  rebuild, and a low contrast score was the only sign. Score each ring against the photo and look at the worst.
- **The laser can be older than the ground.** Castle 18's pond was partly filled after the flight, so two decks stood in
  water. `check-course-quality` now names a tee on ground at a water's own level.
- **A ground flown with its ponds full needs `deferWaterBedToWorld`** in its scenery module. The frontier's early carve
  lowers the ground before the level is read, and the ponds then stand well inside their own walls. No CPU check
  shows it; the first GPU picture did.
- **Take pictures before the bakes.** Any engine edit after them means baking every course again.
- **A class drawn by the ground must not also be drawn as a sheet.** The waste areas carried both, and the sheet won with
  distance.
- **Trees second, on a published first generation.** The reviewed candidates need the machine-v1 generation as
  `baselineGround`, or every tile outside their window loses its trees.
- **Line endings are part of a checksum.** Records written with CRLF broke their own pins. Everything is LF.
- **Published JSON is canonical.** `v2-index.json` has no final newline; `promote.mjs` writes it that way.
- **The engine's source hash covers every course.** Any engine edit turns off every ground's prepared tints until
  one re-bake. Make all engine edits first, then bake once.
- **Campus models start from the laser.** Roof breaks, cornice and dome were tabulated along the building's own
  axes first. Photographs then gave the façade's order, and what no source shows is listed as estimated
  ([Bro Hof's README](../brohofbuild/facilities/README.md)).
- **One loader for every new campus.** `scenery/campus-facilities.mjs` takes the manifest and GLB whole or not at
  all. A scenery module states its frame and the buildings that must be replaced, and nothing else.

## What a new ground still writes by hand

- its frame and ring spec (two short files), and a row in `v2-frontier-configs.mjs`;
- `decisions.json`, `sand-decisions.json`, `layer-decisions.json` and `<build>/mapping/build-layers.py`;
- a scenery module: roof colours, the sand's colour if measured, stated buildings, species, the water's carve, the campus;
- `trees.json` for the tree pipeline;
- the shell's rows: `course-places.mjs`, `map.js`, `rail.js`, `make-posters.mjs`.

`sync-course-registries.mjs --check` fails when one of the tables that must agree does not.
