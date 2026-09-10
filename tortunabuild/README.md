# Tortuna source build

Tortuna is a provisional source-derived course. The source ledger and mapping
input record the remaining survey, current tee/flag and completeness gaps.
Passing the build does not approve those independent gates.

The master input is `mapping/course-input.json`, in EPSG:3006, with a retained
checksum for every input file. The adapter requires all 18 numbered routes,
source green rings and the current sourced scorecard. Missing fairways and tee
platforms remain empty. Tee camera references require explicit source/status
metadata when no platform has been observed. No distance on the card moves a
route, green or reference point.

The terrain source is the retained 4097 × 4097 native Float32 raster at
`cache/terrain/terrain-1m.f32`, checked against the acquisition receipt and an
independent digest in `packages/course-v2/tortuna-ground-graph.mjs`. The frame is
E597400.5/N6614899.5/H16.31, with fingerprint
`37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f`.
Its approval remains pending independent controls.

The committed runtime assets can be served without private source data:

```powershell
npm --prefix apps/golf run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/?bana=tortuna`. Build and validate the application
with `npm --prefix apps/golf run build` and `npm test` from the repository root.

For the course-selection regression, start this checkout on the desired port
and run `node tortunabuild/check-menu.mjs http://localhost:5173/` (adjust the
address to the server). It verifies the served manifest, category and name/city
search, map selection, course boot and in-game menu. Set `CHROME_BIN` if Chrome
is not installed at the standard Windows path. A server started in another
worktree serves that worktree's course list, regardless of the open IDE file.

To regenerate the source model, use Python with pyproj, rasterio, numpy, Pillow
and shapely, and restore the exact acquired cache files named in the receipts.
These raw rasters and photographs are private local inputs; a fresh public
checkout does not contain them. Access credentials are supplied separately.
The acquisition provenance is retained in
`geo_data/course-v2/tortuna/acquisition/source-recovery.json` and the orthophoto
receipts. `reference/acquire-references.mjs` and `acquire-review-crops.py` fetch
references when the relevant sources/access are available; rerunning acquisition
may produce a new dated source and requires a new review.

The hålguide is `guide-notes.json` (per-hole `name`, `note`, `basis`, `rules`),
applied by `build-course.mjs` through its exported `holeNotes()`; in a checkout
without the terrain cache, `node tortunabuild/mapping/apply-guide-notes.mjs --write`
puts the same text into the committed model through the same rule, and
`node tortunabuild/mapping/apply-tee-status.mjs --write` stamps the declared
unresolved tee platforms (holes 6 and 15) the same way. `course.node-test.mjs`
re-derives both and demands equality. A model change then needs emit-pack,
emit-manifest, `update-source-manifest.mjs`, `migrate-legacy.mjs --write --ground
tortuna` (an exact translation, no PROJ needed), `update-source-manifest.mjs`
again, `packages/course-v2/rebind-course-fallback.mjs --ground tortuna --slug
tortuna` and the hash pins in `hole-source-controls.mjs` / `hole-source-inventory.mjs`.

For an unchanged source rebuild, keep the committed observations. Optional
reprojection from the retained review grids uses the following commands from
the repository root. Do not retrace/reacquire as an automatic part of a build:

```powershell
python tortunabuild/mapping/import-osm.py
python tortunabuild/mapping/render-ortho-review.py --kind green
python tortunabuild/mapping/render-ortho-review.py --kind tee
python tortunabuild/mapping/render-ortho-review.py --kind hole
python tortunabuild/mapping/project-front9-traces.py
python tortunabuild/mapping/trace-back9.py
python tortunabuild/prepare-water.py
```

The current ninth tee, facilities and partial front-nine fairways are retained
as separate reviewed vectors with their own source/pixel evidence. The next
review adds explicit replacements in `mapping/improvements-front9.geojson` and
`mapping/improvements-back9.geojson`; original source files stay unchanged.
The assembler checks the exact original identities before applying replacements
or the removal of hole 18's misidentified cart-path tee. Forward-only platforms
do not relocate unresolved historical back-camera references.

`mapping/environment.geojson` retains mapped fields, roads, tracks, paths,
open-watercourse centrelines, railway and explicit power supports. The assembler
subtracts maintained surfaces, water and building footprints from land-use
polygons without buffers, preserving holes by exact partition. Parts of one
field share one display colour. Road widths are full metres; unknown widths
and seasonal materials remain labelled display estimates. No unsupported bridge
decks, railway masts or forest clearing boundaries are inferred.

The surroundings use a separate wider OSM intake in
`mapping/environment-context-extra.geojson`. Original source IDs remain unique;
complete buildings are retained and woodland polygons are clipped to the native
terrain with holes preserved. The source receipt and omitted features remain
separate from the first intake.

Measured canopy now spans 2,560 by 3,072 metres (120 native tile owners), extending
512 metres west/east and 256 metres north/south beyond the original field. The
four original rasters remain unchanged inside four separate expanded rasters.
`acquire-expanded-canopy.mjs` acquires only the 60 added tiles with bounded COPC
reads and resumable checkpoints. The stand compiler checks both original and
expanded identities and compares original overlap bytes before publication.
This changes neither the 4,096-metre terrain nor its smaller course preview.
Measured-only courses also skip the procedural distant-tree fallback.

Six buildings, including the clubhouse, use dated laser roof surfaces in
`mapping/building-roof-meshes.json`. Heights remain absolute RH2000 elevations;
unsupported regions stay omitted. Source ground footprints remain unchanged.
Twelve separately observed roof envelopes exclude older canopy. These are not
replacement ground footprints or a present-day architectural survey.

To reproduce these reviewed derivations from their exact retained inputs:

```powershell
python tortunabuild/mapping/trace-improvements-front9.py
python tortunabuild/mapping/trace-improvements-back9.py
python tortunabuild/mapping/adopt-environment.py
python tortunabuild/mapping/trace-building-observations.py
python tortunabuild/build-building-evidence.py
python tortunabuild/review-building-roofs.py
python tortunabuild/mapping/test-assemble-input.py
```

The expanded context importer is
`python tortunabuild/mapping/import-environment-context-extra.py`; it requires
the retained supplementary XML and its source receipt. Acquisition is an explicit
step, separate from an unchanged-source rebuild. Expanded canopy acquisition uses
existing provider credentials supplied through the environment; never commit
credentials or raw provider files.

With the exact native terrain and canopy caches restored, build in this order:

```powershell
python tortunabuild/mapping/assemble-input.py
node tortunabuild/build-course.mjs
node packages/course-v2/compile-tortuna-ground-graph.mjs --terrain-only
node geo_data/course-v2/tortuna/vegetation/compile-stands.mjs
node tortunabuild/update-source-manifest.mjs
node packages/course-pack/emit-pack.mjs tortunabuild apps/golf/public/courses/tortuna tortuna
node packages/course-pack/emit-manifest.mjs
node tortunabuild/build-overview.mjs
node packages/course-v2/compile-tortuna-ground-graph.mjs --out apps/golf/public
node tortunabuild/check-native-terrain.mjs
npm run check:tortuna
```

After the build, verify the wider surroundings and retain elevated captures:

```powershell
node tortunabuild/check-environment.mjs --base http://localhost:5173/ --out tortunabuild/cache/environment-review
```

The check confirms all 341 terrain tiles and 120 stand owners, exact served asset
hashes, measured trees beyond the old field, building/path inventories and the
absence of generated vista trees. Software screenshots are not a device-speed
benchmark.

The model adapter writes the compatibility model, card, heightfields and exact
projected routing model. Both compatibility heightfields subsample the retained
DTM; the v2 graph retains every native sample and all 341 tiles. Parent links
connect all 340 non-root tiles to their existing containing parents without
changing any payload, bounds or shell.

The graph defaults to `cache/graph-stage`. After source-ledger hashes and local
checks are refreshed, `--out apps/golf/public` writes the content-addressed
assets, updates Tortuna's local root entry and generates its runtime config.
It rejects any replacement of already published Tortuna terrain or frame.
This does not deploy the application.

```powershell
npm test
npm --prefix apps/golf run build
node packages/course-v2/check-app-build.mjs
node packages/course-v2/check-renderer-build.mjs
```

The native checker compares 36 source tee/green references against the published
terrain using the runtime asset loader and sampler. A residual within 0.005 m
demonstrates 1 cm encoding consistency; it is not independent positional
accuracy. The ordinary tests verify the committed terrain chunks without
requiring private source caches.

Raw national imagery, cloud rasters and reference photographs stay under the
ignored cache. The app receives derived semantic geometry and measured terrain,
never a ground orthophoto texture. Range targets retain their own facility
identity; an explicitly recorded turf interpretation uses the shared terrain
atlas and is not a putting-practice location.

See [runtime review](../docs/courses/tortuna-runtime-review.md) for retained
browser evidence and limitations. Green outlines exist for all 18 holes; fairway
outlines remain partial. There are 22 observed platforms, with none resolved for
holes 6 and 15; only forward pads are observed for holes 4 and 12. Coloured
markers and daily flag locations are unverified. Independent
horizontal/vertical controls, 2021 canopy currentness, complete facilities,
boundaries and native-device performance remain open work. Source-derived
camera references and virtual targets are explicitly labelled in the model.

## The 2026 review — tees, fairways, forest (2026-09-10)

Every hole carried its four card tees on ONE point, fifteen fairway strips
covered eighteen holes (several beside the mown corridor), and the stand field
planted the April 2021 laser canopy on ground the 2026 orthophoto shows felled.
All three are measured now, in plain Node (this machine has no Python), from the
2026-05-02 national orthophoto, the 1 m laser terrain and the club's Caddee
hole plans. The chain and its instruments:

    node tortunabuild/ortho-crop.mjs <name> <cx> <cz> <size> [--plain] [--metres 0.16]   # Min karta WMS crops, model overlaid
    node tortunabuild/trace-fairways.mjs          # -> mapping/fairways-2026.geojson + cache/review/fairway-NN.png
    node tortunabuild/trace-tees.mjs              # -> mapping/tee-candidates-2026.geojson + cache/review/tees-NN.png
    node tortunabuild/trace-canopy-changes.mjs    # -> mapping/canopy-changes-2026.geojson + cache/review/canopy-changes.png
    node tortunabuild/mapping/apply-review-2026.mjs --write   # decisions -> playing-surfaces + course-input (+ review-2026.json)
    node tortunabuild/build-course.mjs
    node tortunabuild/terrain-check.mjs           # every ring against the laser -> mapping/terrain-check-2026.json
    node tortunabuild/trace-pins.mjs              # the flag on 2026-05-02 -> mapping/pins-2026.json (refused on all 18)

`lib/png.mjs`, `lib/imagery.mjs`, `lib/rasters.mjs` and `lib/tiff4.mjs` are the
pure-Node PNG codec, mosaic accessor, raster morphology and terrain/canopy/RGBI
readers those tools share. `mapping/tee-decisions-2026.json` is the per-hole
decision with its evidence; `apply-review-2026.mjs` replaces
`assemble-input.py` for exactly the two things the review changes (surfaces and
tee references) and leaves everything else in `course-input.json` untouched,
refreshing its checksum ledger.

- **Tees.** A colour stands on the observed 2026 platform where one exists
  (22), on a laser-flat mown deck at the card distance where the terrain and
  the image show one (the 1st's forward tee, the 15th's back tee), and
  otherwise on a card-derived 14 x 7 m platform: the card's metres to the green
  walked back along the route, moved onto the middle of the mown corridor,
  walked forward out of any water, and set on the levellest 14 x 7 m the laser
  offers within 6 m along and 4 m across (18 of them, flagged
  `card-derived-platform-reference` on every mark they carry). Each mark names
  its platform (`sourcePadId`), `reviewedTeeMarks()` in `build-course.mjs`
  stamps Lidingö's reviewed-marker schema, and the engine draws the colour
  pairs only for marks it can place on a named platform
  (`tee-marker-visibility.mjs` accepts the derived kind). Holes 6 and 15 no
  longer declare an unresolved platform.
- **Fairways.** The mown score `ExG/6 - textureSD/4 - (B/G - 0.93)*30` over a
  4 m box, calibrated on the traced fairways against the rough
  (`cache/calib3.mjs`), passes 81% of fairway and 12.5% of rough at 0.5 -- and
  ONE threshold is the whole mown estate, not the fairway. So each hole's level
  is the 60th percentile of the score in its own corridor, the region is grown
  from the line down a ladder of deltas and kept at the loosest level with a
  fairway's width, regularised by an 8 m blur and clipped to a design
  half-width (24 m par 4/5, 16 m par 3), because in May neither colour nor NIR
  separates fairway from mown rough (NDVI 0.24 against 0.23,
  `cache/calib-nir.mjs`). 23 rings over all 18 holes.
- **Forest.** 6 polygons, 5.29 ha, where 2021 laser canopy of 3 m or more is
  unambiguously open in 2026 (median brightness >= 88 and under 10% of samples
  darker than 70 over a 4 m cell; intact forest reads 47-75 and 22-97%,
  `cache/fell-calib.mjs`) are `override` exclusions for the stand compiler and
  `surround.clearfells` for the runtime. Nothing is added from the image: the
  laser is the measured record and the newer picture may only remove. The 2026
  fairways and tee pads exclude canopy as well.
- **Greens and bunkers** were not retraced: `terrain-check.mjs` finds 27 of
  the 32 traced bunkers over a laser dish at the traced position (median depth
  0.33 m) with a median best shift of (0, 0) m, and every green a plateau
  0.26 m above its collar -- Lantmäteriet's orthophoto is rectified on the same
  height model, so the traces sit on the laser. Five bunkers show no dish and
  are listed; the 13th's fifth reads its dish 5 m away.
- **Flags.** `trace-pins.mjs` looks for the flagstick inside every eroded green
  on the 0.16 m capture and refuses all 18 (no compact dark blob, or a runner-up
  within 10 brightness of the darkest); the pin stays the green centre and the
  record says so.

## Every tree is a measured crown now, or a stand cell that says so (2026-09-10)

The published ground carried stand fields only: every tree on the course was a
representative placement inside a 4 m canopy cell, never a measured stem. It
carries an object layer now -- **2,383 individual crowns** on 57 finest tiles,
positions and heights from the April 2021 laser canopy, each one checked
against the 2026-05-02 orthophoto -- and the stand fields under the canopy
window are recompiled with those crowns' cells taken out, so nothing is
planted twice. The chain, all in Node and all without credentials once the
pinned canopy rasters are in `tortunabuild/cache/canopy/` (the CI artifact of
the `tortuna-canopy-water` workflow):

    node geo_data/course-v2/tortuna/vegetation/compile-objects.mjs --machine-review   # crowns, the versioned rules
    node tortunabuild/ortho-crowns.mjs                                                 # every maximum against the 2026 imagery
    node geo_data/course-v2/tortuna/vegetation/compile-objects.mjs --approvals tortunabuild/cache/vegetation/ortho-approvals.json
    node tortunabuild/update-source-manifest.mjs
    node packages/course-v2/vegetation/publish-vegetation.mjs --ground tortuna --compile tortunabuild/cache/vegetation/objects-stage
    npm run check:tortuna && node tools/check-course-v2.mjs http://127.0.0.1:8620 --course tortuna

- **The laser is the record; the imagery arbitrates.** 20,337 crown maxima in
  the 60-tile window; 2,973 separate as individuals, 2,507 pass the machine
  rules. The orthophoto (0.32 m, PNG through the Min karta WMS, the same cuts
  `trace-canopy-changes.mjs` calibrated on this frame) reads 88% of all maxima
  as canopy still standing, 6% as open ground -- the traced clear-fells, cell
  for cell, plus 426 single crowns outside them that are gone -- and 6% as
  unclear (a May capture: birch half in leaf). **109 machine-approved crowns
  were refused** because the ground under them is open in 2026, and every one
  of the 426 imagery-absent crowns is an override disc for the stand compile,
  so a felled tree is planted neither as a record nor as a stand tree.
- **A promotion needs two records.** 12 maxima the rules held back (touching
  a neighbour, not prominent in a leaf-off scan) stand as distinct crowns on
  open ground in the imagery -- the annulus round them 25 brighter than the
  disc -- AND read green. The green cut exists because the first promoted
  crown was a shed roof by the railway: measured on this frame, 2,207 confirmed
  crowns read excess green p10 1 / p50 7 and 73 maxima on roof envelopes read
  p50 -2 / p75 0. `compile-vegetation` accepts `{ key, promote: true }` in an
  approvals file for exactly this; a promoted record keeps the laser's height
  and radius, and a stand maximum with no radius (its cells all went to its
  neighbour) can never be promoted, whatever the picture shows.
- **Trees the laser never measured stay unmodelled, and the census says why.**
  Dark green compact blobs on played ground outside every crown and its shadow
  capsule (bearing 45.06°, 1.3 x height) number 1,480 -- and drawn over the
  imagery they are the gaps between shadows inside closed forest and dark
  rough beside greens, not stems. Recorded in `ortho-crown-review.json` as
  NOT ADOPTED so the same rule is not tried again; a tree only the imagery
  shows needs its crown AND its own shadow on open turf, with a height from
  the shadow against the solar position.
- **The expanded-window stand tiles are carried, not recompiled.** The 60
  tiles beyond the canopy window come from rasters this checkout does not
  hold, so `compile-objects` copies their published chunks byte for byte into
  the stage from the ground manifest that published them
  (`STAND_SOURCE_GROUND`); the publisher replaces every vegetation layer it is
  not handed, which is how the first publish silently dropped them. The node
  test counts 120.
- **Order matters twice.** `update-source-manifest` before `publish`, or the
  ground manifest pins a ledger hash the ledger no longer has; and a publish
  that re-emits with a new ledger hash leaves the superseded manifests on
  disk, untracked -- remove the ones the root no longer references before
  committing, and never a tracked one.

What is still not measured: species (the runtime's default mix), the stems
inside closed canopy (stand cells, by design), and any tree planted since
April 2021.
