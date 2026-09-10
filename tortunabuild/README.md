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
