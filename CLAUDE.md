# Banvy development guidance

## Start here

For every new course or upgrade, read the
[course production workflow](docs/course-production-workflow.md). Use its shared
initializer, staged adapters, source and per-hole reviews, and release checks.
The catalogue currently has 13 layouts on 10 grounds using the common 469-tile
terrain/ring contract. Historical course builders are evidence, not templates
for new courses.

The dated development notebook is preserved in
[docs/archive/claude-history-2026-09.md](docs/archive/claude-history-2026-09.md).
Consult the relevant course chapter before changing accepted geometry or
placement. Its old renderer defaults and working practices do not override
this guide or the current production workflow.

## Supported player

- The only player presentation is **v2 terrain + Ghibli styling**, on WebGPU and
  WebGL2. Preserve high/low quality, lighting, seasons and accessibility.
- Missing or unverified v2 terrain reports a boot error. Do not restore a GPK1
  terrain fallback or a style switch. Historical visual flags resolve to the
  supported setup; saved realistic preferences are ignored.
- GPK1 still transports routing, card, placement and compatibility height data.
  Reviewed adapters, class/pair surface representations and diagnostic fixtures
  remain dependencies. Do not remove them merely because their names say legacy.
- Player trees use Hero at high quality and the same catalogue's lighter Full
  model at low quality, which every phone uses (owner request, 24 September),
  plus Impostors. Both are fitted to the same height and radius. At high
  quality band A (90 m from a hole line) draws Hero and band B (to 300 m) Full,
  in the Hero's materials (`TREE_BANDS`, `?treebands=0`). The owner's rule is that
  detail goes by where a tree stands, never by how far the camera is, so never
  add a distance ladder: tree meshes are the frame's largest cost, and a tier by
  place keeps every tree still in flight (`tree-flight.test.mjs` holds it).
  The catalogue is the realistic one (owner request, 4 November; `?treeset=v1`
  is the painted before), and Visby has its own of each, for its coastal pine.
  Low quality
  leaves out its relief, the leaf normals and bark maps (`?treerelief=1`).
  The drawn tier also bakes the impostors and answers the facility
  clearance test; `?treemesh=hero|full` compares the two. Geographic zones
  select the base tier; zone A/B mesh trees use their own baked impostors below
  the owner-approved 48 px projected whole-tree threshold (4 November;
  `?distanthero=24` is the before), with hysteresis,
  dwell and crossfade. Outer-zone trees remain impostors. `?distanthero=0`
  restores geographic-only detail; `16` retains the measured comparison
  threshold. Lite and alternative catalogues belong to isolated studies.
- Measured tree types (owner request, 8 November). A v2 object chunk that
  requires `object-registry-tree-attributes-v1` carries, on every tree record:
  - `subtype`: conifer, broadleaf or null;
  - `typeConfidence`;
  - `play`: `near` (within 90 m of a hole line or practice area) or `woodland`.

  A typed record draws a species of its own type (`speciesForType` in
  `v2-vegetation.mjs`), and an untyped record keeps today's rule. A broadleaf
  call needs a clearly leafless April crown: shaded conifers read as broadleaf
  otherwise (owner species check, 8 November). Low quality
  thins `woodland` records by id at the stand keep share
  (`keepWoodlandRecord`, 0.55). `near` records are always drawn. Johannesberg's
  inner frontier is the first such generation; see
  [its review](geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/README.md)
  and [the tree placement workflow](docs/tree-placement-workflow.md).
- Terrain detail is the same on every device and backend (owner request,
  24 September): native tile grids and a 128-tile budget. The playable course
  -- every hole's tiles, within 80-90 m of each tee-to-green line, and the
  tiles containing them -- refines until it is within one screen pixel of the
  finer surface; ground off the course stops at three (`?offcourse=1` applies
  the course rule everywhere). The pixel is the device's own, up to two per CSS
  pixel as on a high-quality desktop, not the low-quality canvas's. Low quality
  changes only streaming concurrency, caching and a grow-as-needed tile
  texture. `?terrainStride=2` is a comparison, not a phone default. See
  [terrain render optimization](docs/v2-terrain-render-optimization.md).
- Study shader/tree entry points live in `apps/golf/src/studies`. Keep them out
  of the player import graph. Refined/foliage study assets remain available
  locally and are omitted from production builds.
- three.js is r187 (0.187.0). Its PMREMs are mip-mapped cube targets: the
  lighting environment bakes each preset into the displayed cube in place
  (`lighting-environment.mjs`); never copy one PMREM into another, which keeps
  the old preset on five faces and every rough mip (`check-lighting-reuse.mjs`
  gates against a fresh bake). The bare chooser route hides the player HUD
  (`body.hub`), and the menu's shortcut list renders from
  `keyboard-shortcuts.mjs`: add a key there, with its test. See
  [the r187 upgrade](docs/three-r187-upgrade-2026-11-02.md).
- The bare route is the start menu (`hub.js`, 7 November): Detaljerad 3D, Lätt 3D,
  Spela, Statistik and Inställningar as cards, with the course list for a mode at `#3d`,
  `#karta` or `#spela`, `#statistik` and `#installningar`. A launch says its mode in the URL
  (`settings-store.mjs launchUrl`). Settings reach the detailed course only as
  the URL grammar or storage keys it already reads, never by editing `main.js`.
  Statistik counts the map's own records (`stats-model.mjs`). Both modes use the
  posters from `tools/make-posters.mjs`, which also writes each course's
  `backdrop.webp`. Run `tools/check-chooser-ui.mjs` after any change there. See
  [the start menu](docs/start-menu.md). A course card opens the course's own page
  (`course-sheet.js`): tee, start hole, handicap or light, then the round; the map
  begins it at `runda=1`. The detailed course's drawer (`menu.js`) is three tabs that
  click the panel's own buttons; keep its `open` class and API, which `main.js`
  reads. See [the UI audit of 8 November](docs/ui-audit-2026-11-08.md).
- Spela (`?spela=1`, 8 November) plays the detailed course as a game, and Återupplev
  (`?aterupplev=<round>`) replays a round the map recorded. Both live in
  `apps/golf/src/play`, outside the hashed folders: `main.js` hands them one handle at
  its end and calls their `update`, and they own the camera while a game is on. Grow the
  game there, never in `main.js`. Played rounds keep their own key
  (`banvy-play-rounds-v1`) and never reach the map's records or the club statistics.
  Every build publishes the golfer models for it (loaded only when a game starts,
  never precached). Its tour-game layer (tempo, a game controller, shot types and
  shaping, the lie %, the green's read, sound, replay and flyover) is in its own
  modules there. The physics records what a listener hears (`events`), and the sound
  plays those, so a new ground reaction needs an event as well. It takes the other
  modes' best without touching `main.js`:
  - the lights through `window.V3D` (`chooseLight`, `nu()`, `winter()`), which set
    the day's conditions (`conditions.mjs`: wet, firm or snowy turf, the air's
    temperature, gusts);
  - the course guide, the hole map (`hole-map.mjs`), the rangefinder's green and
    hazards, and a tapped target;
  - the map's handicap rules (`map/map-score.mjs`);
  - a free view on the course's own orbit controls (`ownsCamera` false).

  Its screen is a broadcast layout in the course's language (`play-hud.mjs`). See
  [Spela and Återupplev](docs/play-mode.md).
- All seven historical public HTML URLs redirect to the app with their course
  and supported view settings. Vite generates these redirects. Root HTML sources
  remain course-pack validation inputs; never copy them over the built redirects.
  See [legacy URL compatibility](docs/legacy-url-compatibility.md).

See [v2 + Ghibli scope](docs/v2-ghibli-only.md),
[tree flight stability](docs/tree-flight-stability.md) and
[repository cleanup](docs/repository-cleanup.md) for the decisions and evidence.

## The map mode

Phones open a plain course link as a light 3D map for a real round (owner request,
4 November; `shell/map-default.mjs`, and `karta=0` is the detailed course there).
`?bana=<slug>&karta=1` opens it anywhere. It is a separate small program in
`apps/golf/src/map` with no three.js. It reads the same 1 m tiles and plants the same
trees as the simulator, takes its nine lights from the same presets, and draws the
trees as the player's own impostors, so rerun
`tools/bake-map-trees.mjs` when a tree catalogue changes. Trees stand twelve times the
camera's distance, at most 12 km, 9 km from Min vy (owner request, 8 November), and past
the 1 m tiles it plants a far wood from its forest picture, drawn from the measured trees
(`map-far-forest.mjs`, off houses and roads); `?treereach=before` and `?farforest=0` are
the befores. Never import `engine/scenery/*`
there (it brings three.js), and keep its work out of the folders the source revision
hashes. Run `tools/check-map-field.mjs` on more than one course. Nothing that is supposed to be
on the ground may be left off the map (owner request, 4 November): a new feature in a pack
needs painting too. The map's water and forest beyond the outlines are one picture each per
ground, and its lakes reach their ground's shores from the same bake (`map-shores.mjs`);
rerun `tools/bake-map-land.mjs` when terrain, stands or a pack are republished or
`water-reach.mjs`/`water-plate-level.mjs` change (`map-shores.test.mjs` says so), and paint
no outline whose inside the ground does not bear out (Norrfällsviken's sea ring). The
land cover's WATER class is a colour verdict: never paint from it. See
[the map mode](docs/course-map-mode.md).

## Course data and sources

- Use one approved coordinate/height frame per physical ground. Multiple
  routings share that ground. Never copy another course's datum offset or approval.
- Preserve source dates, licences, checksums, uncertainty and independent
  controls. A higher resolution or plausible screenshot is not survey evidence.
- Keep accepted tee/green/bunker/water geometry and tree placements tied to their
  source records. Read the ground's dossier and checks before editing them.
- Rebuilds must update content-addressed assets and their references coherently,
  including GPK1 compatibility hashes. Use the workflow's staging and receipts;
  do not hand-edit derived hashes, weaken a gate or invent a passing report.
- Imagery used for tracing is not automatically licensed for redistribution.
  Preserve the source register's restrictions and keep private caches private.
- Place a ground's trees with the tree pipeline (`tools/tree-pipeline.mjs`,
  configured in `course-workflows/<ground>/trees.json`) and its agent
  (`.claude/agents/tree-placement.md`); see
  [the tree placement workflow](docs/tree-placement-workflow.md).

## Rendering and performance verification

- Code tests and a successful build establish behavior, not appearance. Inspect
  visual changes on the owner's GPU. SwiftShader is useful for isolated shader
  and browser checks, but full courses have rendered black in this container.
- Use `BANVY_GPU=1` for the existing real-device harnesses. Compare the same
  backend, quality, viewport, lighting and `det=1` pin. Before screenshots, wait
  for terrain `loadingTiles === 0` and two more frames; `shot.mjs --seq` alone
  does not guarantee this.
- Use interleaved A/B frame timing. Another browser on the same GPU can distort
  results. Keep phone checks separate; an emulator does not establish phone FPS.
- Preserve explicit dirty-range buffer uploads, on-demand shadow updates and
  instanced furniture. Do not mark manually managed attributes DynamicDrawUsage
  without checking the pinned Three implementation and measuring upload traffic.
- Load times (see [the first batch](docs/load-times-2026-11-04.md)): the opening's
  shadow and post pipelines are built in parallel by a frame behind the cover
  (`warm-pipelines.mjs`, `?warmframe=0`), and the trees start downloading as the
  terrain stage begins (`?treehoist=0`). The realistic catalogues' meshes are
  `KHR_mesh_quantization` (`tree-glb.mjs`). Any engine edit turns the prepared
  data off until the next bake, so compare boots on one build, in both orders,
  and put a new before switch on `preparedTintAllowed`'s display-only list. The
  live host is GitHub Pages: PNG is not gzipped, `_headers` is ignored, and a
  returning visitor's caching is the service worker's.
- Use the existing camera clamp; do not add a second clamp or snap to terrain.
  Preserve snapped shadow bounds and the renderer's reversed-depth conventions.
  See [the tree LOD measurements](docs/tree-lod-plan.md) for the failure cases.
- Tree shadows must survive zooming out and turning: impostors cast sun-facing
  shadows, crowns cut theirs at the foliage atlas's full resolution, the shadow
  box grows past 1150 m as that box scaled, and out-of-view cells whose shadows
  reach the view keep their trees as impostors. Keep mesh and impostor shadows
  in agreement with `tools/check-tree-shadows.mjs`; see
  [tree shadows when zooming out](docs/tree-shadows-zoom.md).
- Cut every cutout through the MSAA samples (`msaa-coverage.mjs`): the mesh
  crowns' leaf cards as the impostors. A hard alpha test keeps or drops whole
  pixels, which MSAA does not smooth, so every crown's gaps and edges sparkled
  against the sky as the camera moved. The crowns' cut is centred on 0.5
  (`centredCoverageCut`) so a crown keeps its area, keeps the blend that leaves
  an opaque backdrop opaque (`coverOpaqueBackdrop`), and leaves the shadow
  pass its own cut. `?crowncoverage=0` is the before. See
  [the sparkling crowns](docs/tree-sparkle-2026-09-28.md).
- The sky draws after the opaque world (render order 0.5). Keep opaque world
  objects at order 0 and writing depth, and overlays at 1 and up;
  `sky-draw-order.test.mjs` checks every order in `main.js`. In instanced
  materials, three applies the instance matrix before `positionNode` and the
  fragment read `positionLocal`: use `positionGeometry` for a height up the
  template. Upload packed data textures directly, never through a 2D canvas.
  See [the visual fixes of 24 September](docs/visual-fixes-2026-09-24.md).
- Lighting is tuned per preset in `painted-world-palette.mjs`: shadows keep a
  sky-coloured share of the sun (the light's shadow node, so every receiver
  agrees), the haze and the sky's horizon band share the sun glow's lobe, and
  crowns bake their depth into vertex colours at load and glow at the edge
  against a low sun. Keep per-pixel work off crowns (reckon per vertex), and
  keep impostors in agreement with the meshes (`IMPOSTOR_BACK_EDGE`, and the
  bake's vertex colours). See [the lighting batch](docs/visual-lighting-2026-09-25.md).
- Sommar (`?ljus=sommar`) is the cloudless summer day, a ninth light beside
  Dag. A sky has no clouds only at cloud density 0 (coverage 0 alone still
  paints some), and a light without a `cloudShadow` casts none. Keep every
  other light's values when tuning it (`check-isolated.mjs` compares them with
  main's). See [the summer day](docs/visual-summer-2026-09-25.md).
- Vinter (`?ljus=vinter`) and Nu (`?ljus=nu`) join the nine (owner request,
  6 November). Winter is drawn from one uniform (`paintedSnow`, `snow.mjs`):
  - snow on the ground's finish, the conifers' crown tops (meshes and
    impostors alike), roofs and lakes, never the sea;
  - the broadleaves' crowns are not drawn, and their impostors are re-baked in
    place from the wood (`bakeImpostorAtlas` `into`/`bare`) at a frame after the
    boot, never inside a compile;
  - the grass, tussocks, bushes and lake life hide under it.

  Nu (`light-now.mjs`, pure) chooses one of the ten lights from the real sun
  (`solar.mjs`, shared with the map), the season and Open-Meteo's weather now.
  The weather is never read under `det=1` or webdriver. `?klocka=` and
  `V3D.setNuClock`/`setNuWeather` fix the moment and the sky. `?snow=0` is the
  before. The map keeps its own Vinter. See
  [the winter and Nu](docs/visual-winter-2026-11-06.md).
- A light may lay a glaze on the land (`glaze` in `painted-world-palette.mjs`):
  the aerial perspective's fog step gives a share of every fogged colour to the
  glaze's tint at its own brightness, and gives way over bright colours, so lamps
  keep theirs. The storm brings its gale into the visible air (`lightWind` in
  `one-wind.mjs`), never into the Kikaren's live reading. Keep the blue hour's
  sky brighter than its land. `?lights=before` is each audited light as it was.
  See [the nine lights](docs/visual-lights-2026-09-25.md).
- Trees take slow stand-scale colour washes from position (`stand-tint.mjs`),
  near and far. The ground finish reads each surface's `SHADE` gloss, and draws
  bunker lips and path edges from the exact class fields. The ground tint's
  alpha carries baked relief (`ground-relief.mjs`: horizon occlusion, crests,
  wood edges, 128 = open); its RGB is the ground's colour and stays unchanged
  unless the colour rules change. See [the landscape batch](docs/visual-landscape-2026-09-25.md).
- One air carries the wind (`one-wind.mjs`): the plants' sway, the sky's cloud
  drift and the cloud shadows follow the flags' target wind; reduced motion
  holds them still, while the flags keep answering the wind. Cloud shadows
  (`cloud-shadow.mjs`) take the sun away through its colour and its shadow node,
  keeping the sky-lit tint (sun x mix(tint, 1, shadow x cloud)); painted crowns
  and impostors take the same per-vertex share (`sunlit`) and dim as open ground
  does. Valley mist is part of the haze, per vertex (`aerial-perspective.mjs`).
  See [the air batch](docs/visual-air-2026-09-25.md).
- The water's colour lives in `water-shading.mjs` (its sheets' passes, depth
  and masks in `main.js`). The sun's road is its dabs at every distance
  (`water-road.mjs`), in the sun's colour, brightened toward grazing by
  Schlick's reflectance (never dimmed) and cut by the clouds' shadows only
  under a high sun. Do not trade the far dabs for a smooth glow again: past
  800 m they are steady, and the glow read as a smear. (That expectation in
  `nordic-water.mjs` is the `?waterroad=0` before; keep its `slopeSpread` in
  step with `water-normal-texture.mjs`.) The reflection takes the sky's own sun
  glow, mirrored more inside its lobe, and a lake's dark far-shore band, read
  off a calmer surface; sea sheets are drawn as open sea, without it. From
  above the body shows the ripples' relief, ruffled in a gusty patch and glassy
  in a calm one, and keeps in a cloud's shade the share level ground keeps
  (`water-above.mjs`, reckoned from the ground's own lights; keep it in step if
  they change). With the clouds' shadows drawn out along a low sun's light the
  body takes that shade at every angle; with round ones (`?cloudstretch=0`) only
  as the eye looks down, since round shadows seen along the water are bars. The
  road keeps its rule under long shadows too. Do not darken the calm
  patches from above; they read as more cloud shadows. The ripples, foam and
  calm/gusty patches drift with the one wind. See [the water batch](docs/visual-water-2026-09-25.md),
  [the water road pass](docs/visual-water-road-2026-09-25.md) and
  [the water from above](docs/visual-water-above-2026-09-25.md).
- The water ends where the ground rises out of it (owner request, 7 November;
  `water-reach.mjs`). Each lake is read off its uncarved ground at boot: its
  sheet's outline runs under the bank so the terrain draws the waterline, the
  sheet fades in over its first 2.5 m from that bank (`WATER_SHORE_FADE`), the
  strip the ring left dry is carved as water, and the near tint darkens the bank
  by height. The ring stays the hazard and every other reader's water; a reach
  never rises above the laser's own surface plus 8 cm, never floods water another
  sheet draws, and never lowers a bank. Far lakes grow one mask cell under their
  banks, and Visby's coast one 32 m cell, masked by height. Puttom's lakes stand
  at the laser's surface plus the measured-water 6 cm (`LASER_PLATE_COURSES`).
  Since 8 November one rule stands every lake, pond and waterhole (`water-level.mjs`
  `shoreLevel`, the boot and the map's bake alike): the shore at which the water over
  the laser's ground covers its traced outline best, never below the laser's surface,
  a large flat measured lake within 10 cm of it, an outline that misses its basin at
  its own ground. Ditches and streams take water in their cut channels
  (`stream-water.mjs`; Tortuna's stay centrelines). `tools/audit-water-levels.mjs`
  measures every course on the CPU. `?waterlevel=before` and `?ditches=0`; see
  [one way to stand the water](docs/visual-water-levels-2026-11-08.md).
  `?waterreach=0`, `?shorefade=0`, `?shoredamp=0` and `?waterlevel=before` are the
  befores. See [the water's shores](docs/visual-water-shores-2026-11-07.md).
- The glow's threshold is per preset (`glow.mjs`). A low sun's sits just above
  its broad sky, cloud and haze paint (`skyPaintCeiling`), so none of that
  glows. Toward the sun the clouds' thick centres shine past it in the sun
  glow's colour (`painted-sky.mjs`, `skyCloudGlow`), only where there is a glow
  (high quality, before any runtime drop). When a preset's sky colours change,
  keep its threshold above that paint and re-solve its shine (`glow.test.mjs`
  holds both). See [the glow batch](docs/visual-glow-2026-09-25.md).
- The painted sky lights its clouds by the sun (`painted-sky.mjs` `sunLit`, at
  each light's `skyCloudSun` share): tops and sunward flanks take the lit paint,
  bases and far flanks the light's `skyCloudBase`, and toward the sun a lining
  lies inside each cloud's edge. Near the sun they keep their lit paint, so the
  glow's shine still crosses its threshold, and no cloud is ever brighter than
  its lit paint. A low sun draws the clouds' shadows out along its light
  (`cloud-shadow.mjs` `stretch`, 3.5 times at golden hour) over each light's
  own cover. The pattern takes the air's drift in its own frame and wraps it
  there, so the air must not wrap a stretched drift (`period` is Infinity;
  `one-wind.mjs` leaves an unbounded period unwrapped, since 0 x Infinity is NaN).
  Keep the tests' CPU reading of the pattern in step with the shader's.
  `?cloudlight=0` and `?cloudstretch=0` are the befores. See [the clouds batch](docs/visual-clouds-2026-09-26.md).
- The ground's class edges are measured across each edge
  (`ground-material-core.mjs`): the width is `fwidth` of each class's own field,
  never wider than the whole footprint nor `EDGE_REACH_METRES` (3 m, inside the
  fields' 4 m reach). So no class lends its colour to ground past its field's
  reach, and the contact line, bank, rake, lip and path edges fade by the same
  pixel. The mowing passes fade out before their lateral byte's 31.75 m. Hard
  ground (paths, roads, gravel, soil, rock, mud) stands at 0 mm under the
  contact line and takes no turf finish. The ground cover (`ground-cover.mjs`):
  - blades are lit by `seenBladeNormal()`, their tilt up and their facing turned
    to the seen side, so keep their normals on the front face;
  - every cover population receives shadows;
  - colours read the detail texture at `COVER_TUNED_SHARE` and take the rough's
    grass strength and autumn;
  - stones and bushes sit on the lowest ground under their rim;
  - reeds stand at the first lake's level by any water, as before, and also
    where the ground lies at a lake's or pond's own level beside it
    (`reedWaterAt`); that rule moves plantings, so change it only with a re-bake.

  `?groundedges=0`, `?stripereach=0`, `?hardground=0`, `?coverlight=0`,
  `?covershadow=0`, `?covercolour=0` and `?coverseat=0` are drawn befores;
  `?reedlakes=0` plants live. See [the ground batch](docs/visual-ground-2026-09-26.md).
- The ground reads the detail texture four times a pixel: the class-SDF ground's
  shared taps (`ground-material-core.mjs`) serve the range's wobble, a pass's
  wander, the clumps and the finish's three blotches (`paintedGround` takes
  them as `taps`). Add a detail read to one of those taps' channels before
  adding a tap. Every class but the rough's paint takes the clumps at its
  `SHADE` bump (a fairway about 2.5%), and mown turf 2.5 times the broad blotch,
  centred on its channel's mean (`DETAIL_BROAD_MEAN`), so its tone holds.
  - Tees are scarred where the near clumps crest highest.
  - The ground 1-4 m round greens and tees (the mow-ring field) is worn paler
    in patches where the clumps are thinnest.
  - Sheltered ground (the baked relief) lies damp at each light's
    `GROUND_WETNESS` (storm 1, mist 0.6).
  - Rock, soil and mud mottle in soft blotches (the far tap about
    `DETAIL_CLUMP_MEAN`), and their drawn edges fray with the clumps; the
    ball's lie keeps the mapped line. Keep speckle off bare ground: the
    clumps' 0.4 m half read as noise.

  `?turfgrain=0`, `?groundwear=0` and `?bareground=0` are drawn befores. See
  [the turf batch](docs/visual-turf-2026-09-26.md).
- The grass round the ball (`near-grass.mjs`) grows blades round the eye in
  every low view, in one instanced draw of nested rings; each ring thins to a
  quarter at its edge, where the next ring's density takes over. What grows,
  and how tall, comes from the ground's exact class fields (a little over each
  cut; nothing on greens, sand, paths, hard ground, the forest floor, the shore
  or water, with `wetAt`'s 0.3 m margin). A blade takes its root's colour
  through the ground's own functions and terms (`groundClassColour`,
  `groundTintColour`, `applyGroundRelief`, the clumps, grain, damp, blotches
  and gloss): keep them in step when the ground's colour rules change. Its
  ground grid round the eye wraps toroidally; keep its indices exact (integer
  division, a remainder brought back into range), since a float floor left a
  two-metre strip bare every 94 m. It fades out at 330 blade lengths, hides
  above 40 m and sways on the one wind. `?neargrass=0` is the drawn before.
  See [the grass round the ball](docs/visual-near-grass-2026-09-26.md).
- Walls darken at their foot where they meet the ground (`building-paint.mjs`):
  each vertex carries the visible ground's height under it (`aGround`, stamped
  at load), and the shader scales the material's own colour, walls only. The
  batch takes the full foot, and its gable and hip slopes a baked ridge (cut
  where the band begins, the gable ends at the same points). The Blender models
  take a lighter, lower foot through `groundModel`, which keeps their colours,
  leaves self-painting materials alone and gives shared geometry its own copy.
  Stamp a new building mesh the same way. See [the buildings batch](docs/visual-buildings-2026-09-25.md).

- Three techniques come from serenity-blocks (same three/TSL stack): the sun's
  shadow is read through a fixed grid of compares (`sun-shadow.mjs`, nine taps
  high, four low, spaced to the Vogel disc's second moment), since three's
  noise-turned PCF leaves grain without TAA; the haze's depth is per channel
  (`aerial-perspective.mjs` `SPECTRAL_HAZE`, red 0.7, green 1, blue 1.45), green
  as tuned, offsets per vertex, mist grey, and the water's far shore takes the
  same haze; and pollen and down drift on the one air round the eye
  (`air-motes.mjs`, render order 3, held still under reduced motion, each
  light's air in `AIR_MOTES.presets`); and god rays through the trees
  (`god-rays.mjs`, three's GodraysNode on the scene pass's depth and the sun's
  shadow map, high quality only): forward scatter from each pixel's own ray,
  cut past 45-85% of the shadow box's half-width to the sun's glow, each light's
  strength in `GOD_RAYS.presets` (none in storm, mist, blue hour, and then not
  run), joined to the output only once the shadow map exists. `?shadowgrid=0`,
  `?hazespectrum=0` and `?godrays=0` are the befores. The motes are off since
  3 November (owner request: no particles); `?airmotes=1` draws them. In TSL never multiply a node by a JavaScript
  number with `*` (it compiles to `NaN` and blanks the WebGPU frame); prove a
  new shader in an isolated scene on both backends. See
  [the serenity ports](docs/visual-serenity-ports-2026-11-02.md).

- On the owner's RTX 5080 (2–3 November; see [the night on the RTX 5080](docs/visual-night-2026-11-02.md)):
  - **One compileAsync at a time.** r187 keeps a call's progress in the
    renderer's one `_precompilationState`. The opening scene compiles in a
    single call (`prepare-opening-gpu.mjs`); two calls in flight broke every
    WebGPU boot.
  - **Vertex outputs ≤ 15.** WebGPU allows 16, so pack varyings into `vec4`s
    (the impostor's frames and UVs, the blades' wind sheen in their blotch
    varying). `tools/check-gpu-clean-boot.mjs` boots every course on both
    backends (`--quality hi|lo`) and fails on any console error or a vertex
    stage over 15.
  - **WebGL2 compile and disposal.** `webgl-compile-guard.mjs` keeps a
    pipeline destroyed mid-compile from hanging `compileAsync`. A grown-out
    terrain batch is disposed `RETIRE_TICKS` later, never at once.
  - **Frame cap.** At most 60 renders a second (`frame-pacer.mjs`, the menu's
    Bildfrekvens). `?fps=0` lifts it, `det=1` stays uncapped and timing tools
    pass `fps=0`.
  - **The painted canopy** (`ghibli-foliage-material.mjs` `CANOPY`,
    `crown-puffs.mjs`), on the painted catalogues only (`?treeset=v1`):
    - banded crown tones whose edges, never the colour, move with openness,
      clumps and tree;
    - puff normals baked at load, which the impostor bake inherits;
    - `softLift` keeps the overcast lights' crowns dark.
    The bands are reckoned per pixel on meshes from per-vertex noise: per
    vertex, a few hero pine and spruce vertices came out unbounded toward a
    low sun and the glow drew them as green orbs in the trees (3 November).
    `?canopy=0`, `?puffs=0` and `?canopybands=vertex` are the befores.
  - **Painted props** come from rebuildable `tools/blender-props/*.py` scripts
    run through the Blender MCP. Each is a hash-named GLB in `models/props/`
    with its JSON record, loaded by `loadPaintedProp` with the authored
    buildings' checks and drawn as two instanced meshes with a tinted body.
    `?props=0` is the boxes. Swans (`swans.mjs`) glide closed-form loops
    planned from the water outlines, inset off the shore and over open water;
    they cast no shadow, since the sun's map is redrawn on demand.
  - **More befores:** `?sandbowl=0`, `?windsheen=0`, `?waterbank=0`,
    `?cirrus=0`, `?birds=0`, `?butterflies=0`, `?leafflutter=0`,
    `?covershapes=0`, `?teemarkers=before`, `?labelcap=0`, `?camarc=0`,
    `?leaves=0`, `?rain=0`, `?swans=0`, `?herons=0`, `?lilies=0` and
    `?lakemist=0` (the lakes' own sheets, merged, as three mist layers at
    order 7). The meadow flowers are off since 3 November (owner: they do not
    fit the environments); `?flowers=1` draws them.
  - **Contact shadows** (`contact-ao.mjs`): three's GTAO on the scene pass's
    depth (r187 reads the reversed buffer; normals rebuilt from depth), at half
    resolution, box-blurred, and only past a contact threshold so flat walls
    and lawns stay clean. Joined to the colour before the bloom and the god
    rays add theirs; high quality only. `?ao=0` is the before.
    `?tonecurve=filmic` is an opt-in A/B.
  - **The tour turf** (3 November, owner request: grass like EA Sports PGA
    Tour 2K25; see [the tour turf](docs/visual-turf-tour-2026-11-03.md)):
    `turf-detail.mjs` makes a seeded, tileable blade, pebble and grain texture
    at load; `turf-look.mjs` lays each class's channel over its colour, the
    mown blades along each hole's mowing, and bumps the terrain normal by it,
    faded by the pixel's footprint. Stripes are stronger and swap with where
    you stand. One per-class tour grade (`TURF_LOOK.grade`) is taken by both
    the ground and the blades round the ball: keep them in step. The rough's
    blades are finer and denser at high quality, and tussocks are clumps of
    fine blades. `?turf=painted` is the whole before.
  - **The rough's grass** (3 November, owner request: dense, no triangles,
    no noise; after research into AAA grass, chiefly Ghost of Tsushima's GDC
    2021 talk): the blades round the ball are curved, tapered strips grown in
    Voronoi clumps (`NEAR_GRASS_TOUR`: per-clump height, lean, dryness and
    tone, blades pulled toward the clump), turned toward the eye when seen
    edge-on, rounded across their width, and wider in each outer ring (fewer
    but wider, so none is sub-pixel). The grain's screen-derivative bump is off
    (`?turfbump=1`; it was 6x the ground's aliasing). The Blender grass cards
    and shell mat (`grass-cards.mjs`, `grass-shells.mjs`) are kept behind
    `?grasscards=1` and `?grassmat=1`: both alias (alpha cut), and cards read
    as crosses from above. Measure aliasing as 1080p against a 4K render scaled
    down (`tools/goldens/gfx/alias.mjs`, local).
  - **Temporal AA** (`temporal-aa.mjs`, 3 November): three's TRAANode in place
    of the scene pass's MSAA at high quality, then AMD's RCAS sharpen
    (`SharpenNode`, `?sharpen=0..2`). The velocity MRT is the WORLD-STATIC one
    (each pixel's world position through this and the last frame's
    unjittered view-projection), since three's own reads the raw geometry
    position and is wrong for everything placed in a shader (terrain tiles,
    grass rings, impostors); objects moved by their matrices (the swans) take
    three's `velocity` through their `mrtNode`. Update the matrices once a
    frame before the pipeline (`renderActivePipeline`). Low quality, phones
    and `det=1` keep MSAA; `?aa=traa` forces it, `?aa=msaa` is the before.
    It needs MSAA off (three), and a per-material velocity output can push a
    fragment stage past 16 inputs (the first trial crashed the blades): keep
    the velocity in the MRT, not in the materials.
  - **Water from above** (3 November): ring terrain tiles are quantised from
    their own lowest height, which over a lake is the water surface, so the
    bed carve must re-base a tile below its floor (`carveDecodedTerrainTile`,
    used by the ring path now as by the fixed frontier) or the bed stays a hand
    under the sheet and the lake reads as brown silt from above. The CPU
    sampler is rebuilt after carving.
  - **Water that mirrors its shores** (3 November; see [the water
    reflections](docs/visual-water-reflections-2026-11-03.md)): the water's own
    material marches its reflected ray through a copy of the opaque world's
    depth and reads the trees, banks and hills it finds
    (`water-reflection.mjs`). The copy is gated to the scene pass's
    single-sample target, so it runs only with the temporal AA; MSAA, `det=1`
    and the runtime drop keep the before. What it finds replaces the painted
    sky's reflection by its weight, under 40% of the sky's sun glow, and the
    sun's road is still added last. The copy splits the scene's render pass, so
    `V3D.gpuTime` under-reads with it on: time it by frame intervals.
    `?waterreflect=0` is the before.
  - **Realistic trees** (3 November, the default since the 4th; `?treeset=v1`
    is the painted before; see [the
    realistic trees](docs/visual-trees-realistic-2026-11-03.md)): the five
    species grown in Blender (`tools/blender-tree-study/realistic/`, its own
    scene `BanvyTreesV2`, data API only), three variants a species, crowns of
    leaf clusters (puffs of sprig cards; the spruce's sprays laid along its
    branches), every variant fitted to the painted template's height and
    radius, at about the painted hero budget. The crowns read the atlas's own
    leaf colours without the painted bands, and the impostor bake cuts their
    mask at mip 0, as the mesh shadow does, in 128 px frames. Rebuild the meshes
    by running `realistic_trees.py` through the MCP, then `pack_catalogue.mjs`.
    The sprigs are modelled in 3D and rendered on the CPU (`sprig_atlas.py`,
    `pack_sprigs.mjs`) into colour and normal/light-through atlases, and the
    crowns light each leaf by its own normal (`leafNormal`, a screen-derivative
    frame; `?leafnormals=0`), and the bark the same way (`bark_atlas.py`,
    `pack_bark.mjs`, UVs on the trunks, `barkSurface`; `?bark=0`). The tree
    harnesses take `--treeset v1` for the before. The two catalogues plant the
    same trees, so `treeset` is display-only for the prepared data.
    - **Visby's coastal pine** (`kust` in `realistic_trees.py`, its wood in
      `coastal_wood`, its sprig `coastal_sprig`, `pack_coastal.mjs`,
      `realistic-visby.json`): the three growth forms the owner kept in
      September, in their boxes and with the `tall` palette. The owner declined
      two darker, more windswept proposals then, so keep to these forms. Its
      cards stand upright and its pads are thick: laid flat they read as leaf
      plates, and thin pads fail the low-sun shadow proof. Its crown's underside
      answers the facility test, so check the plantings if it moves. Its proof
      is `check-tree-shadows --course visby --species 1` (species 0 is the
      spruce). The tree builds need no open scene: they run in
      `blender --background --factory-startup`.
    - **The spruce's crest** (`crest` in `realistic_trees.py`, 4 November): the
      stem narrows to a point, the top limbs sweep up, the sprays shrink toward
      the tip and upright shoots stand round the leader. Ended at a third of its
      width the stem stood above the foliage as a sawn-off pole.
  - **Trees culled on the GPU, `?treecull=gpu`** (3 November; opt-in until
    measured; see [the GPU tree cull](docs/tree-gpu-cull-2026-11-03.md)):
    - A compute pass per hero tier frustum-culls each drawn tree into a copy
      drawn by indirect draws (`tree-gpu-cull.mjs`).
    - The tier's own meshes draw the shadows, on a layer only the sun's shadow
      camera sees.
    - Its instance buffers are storage buffers, and keep their class when the
      tier grows.
  - **The grass grown on the GPU** (3 November; see [the GPU
    grass](docs/visual-gpu-grass-2026-11-03.md)):
    - On WebGPU at high quality, a compute pass grows the blades on nested
      world-anchored rings round the eye, culls them, colours them from the
      ground's own functions and appends the survivors by an atomic counter.
    - Two indirect draws (Bézier strips, four and two segments) draw them
      (`gpu-grass.mjs`), with the rough real out to about 60 m.
    - A compute dispatch has no camera: pass the eye in a uniform, never
      `cameraPosition`.
    - The rings (`near-grass.mjs`) stay unchanged for WebGL2, low quality and
      phones. `?grass=rings` is the before; `?grassmown=0` drops the short
      mown blades, the main source of flicker.
    - About 0.2 ms against the rings' 1 ms.
  - **Power lines** (3 November): towers are a Blender-built lattice pylon
    (`tools/blender-props/pylon.py`, `PYLON_ASSET`, its three phases on its
    insulators), crossarms turned square to the line, wires and lift cables
    as ribbons of their real width faded by coverage below a pixel
    (`wires.mjs`). Course lines run to the far ring, not a fixed box.
    `?power=before` and `?wires=lines` are the befores. Blender scripts must
    build in their own scene with the data API: the shared file holds other
    work, and `clear()` in `parked_car.py` deletes every mesh in it.
  - **Draped surfaces at a distance** (3 November): roads, paths, tracks,
    lots and ballast (`nudged()` in `main.js`) move their DEPTH, never their
    pixels, toward the eye by the terrain's error allowance there
    (`drape-depth.mjs`: 6 px of height, by how steeply the eye looks down,
    beyond 60-200 m, at most 6% of the distance), through `vertexNode`, so
    lighting, shadows, fog and the TAA's reprojection keep the true position.
    Without it the coarser far terrain buried the roads. `?drape=before`.
  - **Graphics review on the GPU.** Use `tools/gfx-gallery.mjs` (1080p,
    vsync-locked, GPU ms from timestamp queries; `--lights`, `--compare`).
  - **LF line endings.** This checkout sets `core.autocrlf=false` so the
    working tree is LF, as the source-text tests and the source revision
    hash expect.

## Build and focused checks

Use Node 22+ and the locked dependencies. Run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @banvy/golf build
node tools/lint-app.mjs
pnpm exec vitest run apps/golf
node packages/course-v2/check-app-build.mjs
pnpm check:course-workflow
```

Run `pnpm test` for the complete Vitest and Node suite, plus the relevant course,
source or browser checks for the change. Link/deployment changes use
`tools/check-legacy-links.mjs`, `tools/check-links.mjs` and
`tools/check-basepath.mjs`; these cover different boundaries.

Keep useful source records and review evidence. Reproducible builds and local
reports belong in their ignored output directories. Do not rewrite repository
history as part of ordinary cleanup. In a shared checkout, inspect existing
changes and stage only paths belonging to your task.
