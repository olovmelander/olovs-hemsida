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
- Player trees use one approved mesh tier plus Impostors: Hero at high quality,
  and the same catalogue's lighter Full model at low quality, which every phone
  uses (owner request, 24 September). Both are fitted to the same height and
  radius. The drawn tier also bakes the impostors and answers the facility
  clearance test; `?treemesh=hero|full` compares the two. Geographic zones
  select the base tier; zone A/B mesh trees use their own baked impostors below
  the owner-approved 24 px projected whole-tree threshold, with hysteresis,
  dwell and crossfade. Outer-zone trees remain impostors. `?distanthero=0`
  restores geographic-only detail; `16` retains the measured comparison
  threshold. Lite and alternative catalogues belong to isolated studies.
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
- All seven historical public HTML URLs redirect to the app with their course
  and supported view settings. Vite generates these redirects. Root HTML sources
  remain course-pack validation inputs; never copy them over the built redirects.
  See [legacy URL compatibility](docs/legacy-url-compatibility.md).

See [v2 + Ghibli scope](docs/v2-ghibli-only.md),
[tree flight stability](docs/tree-flight-stability.md) and
[repository cleanup](docs/repository-cleanup.md) for the decisions and evidence.

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
- Use the existing camera clamp; do not add a second clamp or snap to terrain.
  Preserve snapped shadow bounds and the renderer's reversed-depth conventions.
  See [the tree LOD measurements](docs/tree-lod-plan.md) for the failure cases.
- Tree shadows must survive zooming out and turning: impostors cast sun-facing
  shadows, crowns cut theirs at the foliage atlas's full resolution, the shadow
  box grows past 1150 m as that box scaled, and out-of-view cells whose shadows
  reach the view keep their trees as impostors. Keep mesh and impostor shadows
  in agreement with `tools/check-tree-shadows.mjs`; see
  [tree shadows when zooming out](docs/tree-shadows-zoom.md).
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
  they change). Under a low sun the water takes that shade only as the eye looks
  down: round shadows seen along the water are bars. Do not darken the calm
  patches from above; they read as more cloud shadows. The ripples, foam and
  calm/gusty patches drift with the one wind. See [the water batch](docs/visual-water-2026-09-25.md),
  [the water road pass](docs/visual-water-road-2026-09-25.md) and
  [the water from above](docs/visual-water-above-2026-09-25.md).
- The glow's threshold is per preset (`glow.mjs`). A low sun's sits just above
  its broad sky, cloud and haze paint (`skyPaintCeiling`), so none of that
  glows. Toward the sun the clouds' thick centres shine past it in the sun
  glow's colour (`painted-sky.mjs`, `skyCloudGlow`), only where there is a glow
  (high quality, before any runtime drop). When a preset's sky colours change,
  keep its threshold above that paint and re-solve its shine (`glow.test.mjs`
  holds both). See [the glow batch](docs/visual-glow-2026-09-25.md).
- Walls darken at their foot where they meet the ground (`building-paint.mjs`):
  each vertex carries the visible ground's height under it (`aGround`, stamped
  at load), and the shader scales the material's own colour, walls only. The
  batch takes the full foot, and its gable and hip slopes a baked ridge (cut
  where the band begins, the gable ends at the same points). The Blender models
  take a lighter, lower foot through `groundModel`, which keeps their colours,
  leaves self-painting materials alone and gives shared geometry its own copy.
  Stamp a new building mesh the same way. See [the buildings batch](docs/visual-buildings-2026-09-25.md).

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
