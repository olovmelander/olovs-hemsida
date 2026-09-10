# Combined local application — 10 September 2026

The `olovs-hemsida` checkout serves the combined application at
<http://localhost:5173/>. It contains 13 courses and 198 holes, with all 13
courses registered for their published V2 terrain. The application is also
packaged in `apps/golf/dist` by the normal Vite production build.

## Included work

- Preserved the main checkout's current course mapping, tee and boundary
  reviews, coastal water, camera, caddie, lighting and tree rendering changes.
- Integrated the current Tortuna checkout, including its uncommitted course
  improvements, source/build tools, expanded measured canopy, building and
  surrounding feature data, pack, terrain graph, menu entries and rendering
  support. Its 341 terrain tiles and 120 stand owners remain published.
- Integrated completed Lidingö review from `40cf4de4`: 14 green outlines,
  six approaches, the additional hole 13 bunker and canopy appearance data.
  Preserved the newer tees, OB, buildings, water, routing and all 277 terrain
  tiles. Nine stand chunks were regenerated against the adopted boundaries;
  current tree placement has no conflicts with those maintained surfaces.
  Exact preservation and source identities are recorded in
  [`alignment-integration-2026-09-10.json`](../lidingobuild/mapping/alignment-integration-2026-09-10.json).
- Integrated Johannesberg 9 terrain/scenery support from the completed
  `715bf8e8` work, rebinding it to the current pack and shared ground. The
  parent course's routing and hole metadata remain unchanged.

Other worktrees were audited. Historical snapshots and acquisition or
stand-format experiments without completed runtime integration were not
promoted into the application. No remote deployment was performed.

## Starting the combined version

From the normal repository root:

```powershell
npm --prefix apps/golf install   # first time, or after dependency changes
npm run dev
```

Vite now explicitly uses port 5173 with `strictPort: true`. An occupied port
produces an error instead of silently opening another copy on a different
port. Tortuna's current verification commands also default to 5173.

## Validation

- `npm test`: 758 Vitest tests and 439 Node tests passed. Two optional Python
  PROJ adapter tests were skipped because that adapter was not selected.
- `npm --prefix apps/golf run build`: passed.
- `node packages/course-v2/check-app-build.mjs`: passed; the packaged
  terrain, surface previews, graph identities, fallback packs and PWA caching
  rules were verified for all 13 courses.
- `node packages/course-v2/check-renderer-build.mjs`: passed.
- The live course chooser on 5173 lists all 13 courses. Each course completed
  a fresh browser boot with its expected hole count, ready V2 renderer,
  loaded vegetation and no page errors or failed local asset requests.
  These checks used low quality, a fixed clock and the default WebGPU path;
  they are loading/integration checks rather than a frame-rate benchmark.

Browser evidence is retained locally in
`tortunabuild/cache/integrated-release/report.json` and the adjacent captures.
Original overwritten files, integration plans and full validation logs are
backed up under
`C:/Users/olov_/AppData/Local/Temp/banvy-integration-20260910`.

The full checks also identified preexisting stale bookkeeping: Puttom's
coverage test still counted 29 tee pads instead of the current 34, and seven
source-control hashes lagged the current source ledgers. Those expectations
were updated after verifying the current geometry and source identities;
complete coverage and strict checksum checks remain enforced.
