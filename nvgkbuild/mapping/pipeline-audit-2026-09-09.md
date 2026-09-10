# Norrfällsviken pipeline audit — 2026-09-09

Scope: read-only audit before Lantmäteriet geometry adoption. Existing modifications on other courses were present and must be retained.

## Baseline verified

- `node nvgkbuild/check3d.mjs`: all gates pass; 90 card cells, maximum length deviation 0.018%, 18 green centers inside rings; 10 waters, 3 streams, 274 near buildings and 7 piers. Passing this gate does **not** establish alignment: it only compares green centers/line lengths for embed currency, not complete surface geometry.
- `node --test packages/course-v2/norrfallsviken-ground-graph.node-test.mjs`: 8/8 pass.

## Authoring contracts and open defects

- `nvgkbuild/lib.mjs` freezes true-north local coordinates at 62.98250 N, 18.53250 E; the model stores `mPerLat:111320`, rounded `mPerLon:50568.51`, east +x, north −z. Convert every EPSG:3006 review point through the existing projection/legacy bridge; merely subtracting EPSG origin would leave a 3.148° rotation error.
- `nvgkbuild/reconcile.mjs` reads `sat-shapes.json`, then swaps **trace/GPS 4↔8 into scorecard numbering**. Reviews should use model/scorecard hole numbers explicitly. The source comments claiming duplicate GPS records are corrupt are superseded by the club's shared-green evidence in CLAUDE.md and `docs/courses/norrfallsviken-source-dossier.md`: 4 and 8 share one complex, currently represented by rings whose centers are 37.3 m apart. Resolve using a reviewed LM outline; retain distinct pin positions if supported.
- Current line starts are extended to reproduce card lengths; all three tee marks per hole are interpolated on these lines. This is not evidence of physical tee platforms or movable colored tee markers. Adopt physical pads and independently evidenced reference anchors without bending surveyed shapes to the scorecard.
- Current tee pads are rotated rectangles from old imagery sketches. `apps/golf/src/engine/tee-pads.mjs` adds synthetic 10.4×8.8 m decks around unsupported marks unless `tees.inferPads:false`; use `preserveTerrain:true` for measured mowing extents. `displayC` is a presentation anchor and carries no implied surveyed color assignment.
- `nvgkbuild/embed.mjs` currently drops tee metadata that shared `packages/course-pack/emit-pack.mjs` preserves (`inferPads`, `status`, `preserveTerrain`, referenced pad IDs, marker source/display fields). Synchronize embed serialization when adopting reviewed tees, or page and app will behave differently.
- The range is constructed in reconcile from `sat-shapes.scenery` as one field, a 6 m wide tee strip and circular target greens. Preserve source line/pad evidence explicitly when replacing this approximation. Infrastructure is copied from OSM; `parse-osm.mjs` misses the golf-course relation 165517 hull because it only tests ways.
- `apps/golf/src/engine/scenery/norrfallsviken.js` supplies clubhouse wall/roof/height/window/terrace style; footprints are in `model.infra.buildings`, while main.js still owns some chapel/marina geometry. Ground photos are needed for facade modeling; orthophotos constrain footprints and roof plan only.
- Woods have no OSM forest polygons here. Published v2 terrain/vegetation already exists: 469 terrain tiles over 7 LODs, 229 stand tiles, measured/derived June-2025 tree evidence. Geometry corrections also change vegetation exclusion masks; a routing-only rebind intentionally preserves the existing tree tiles, so vegetation/played-surface conflicts need browser inspection or a scoped vegetation recompile.
- Source manifest lifecycle prose is stale: it still describes terrain/laser as planned even though published evidence is registered later in the same file. Add acquired imagery provenance accurately and avoid implying control-survey precision.

## Local integration order

1. Write `nvgkbuild/mapping/review-*-2026-09-09.json` and acquired-image evidence with full EPSG:3006 coordinates, source IDs, dates, checksums, bbox/resolution and per-feature uncertainty. Add an adopter invoked from `nvgkbuild/reconcile.mjs` after legacy assembly so regeneration preserves accepted review geometry.
2. `node nvgkbuild/reconcile.mjs`
3. `node nvgkbuild/render-design.mjs`
4. `node nvgkbuild/embed.mjs`
5. `node packages/course-pack/emit-pack.mjs nvgkbuild apps/golf/public/courses/norrfallsviken norrfallsviken`
6. `node packages/course-pack/emit-manifest.mjs --only=norrfallsviken` (scoped mode preserves other courses).
7. Refresh changed source-artifact hashes in `geo_data/course-v2/norrfallsviken/source-manifest.json` **before migration**; migration rejects a model hash that no longer matches its source manifest. Hash normalized text consistently with repository conventions.
8. With the repository's pinned PROJ/pyproj toolchain available: `node packages/course-geo/migrate-legacy.mjs --write --ground norrfallsviken`. Refresh the resulting migration/report artifact hashes and the **Norrfällsviken entry only** of `COURSE_MODEL_SHA256` in `packages/course-geo/acquisition/hole-source-controls.mjs`.
9. `node tools/rebind-v2-routing.mjs --slug norrfallsviken --build nvgkbuild --migration geo_data/course-v2/norrfallsviken/migration/course-model.epsg3006.json` (dry run), then same command with `--write`. It validates current model/pack/migration identity, samples moved routing from published 1 m terrain, refreshes routing and course manifests plus `courses/v2-index.json`, and asserts the complete ground manifest (including terrain/vegetation) remains identical.

## Validation contracts

- `node nvgkbuild/check3d.mjs` and `node geobuild/lint-page.mjs norrfallsviken3d.html`.
- Compare the full decoded page vectors with the emitted pack; the current check3d currency gate will miss stale fairways, bunkers, tees, infrastructure and water rings.
- `node packages/course-geo/check-manifests.mjs`; use targeted output to distinguish unrelated pre-existing course modifications.
- Build the golf app using its package scripts, then `node tools/check-norrfallsviken-v2.mjs apps/golf/dist`. It validates every terrain chunk, finite RH 2000 samples, 96-tile / <8 MiB frontier, canonical root and fallback pack hash.
- `node tools/check-course-v2.mjs --course norrfallsviken <local-app-url>`: assert **v2 actually serves**, no silent GPK1 fallback, routing identity, verified objects/stands and no page errors. Also capture all 18 holes in tee and aerial views plus clubhouse/range/coast closeups.
- `apps/golf/src/engine/v2-norrfallsviken-config.mjs` currently fixes CORE x −540..540, z −756..792 at dx 4 (271×388, 105148 base points; 90534 skipped). If reviewed geometry expands these bounds, recompute via the runtime planner and update the reviewed counts; do not blindly retain or disable the check.
- Hold legacy origin, v2 frame fingerprint, RH 2000 terrain and 20.3432 m legacy datum bridge unchanged unless an independent datum/frame correction is demonstrated.
- Add meaningful acceptance assertions for shared green topology, reviewed pad validity/reference containment, complete pack/embed currency and non-overlapping surface classes. Do not claim precise daily marker placements from overhead imagery.

