# Stand crowns: plant every laser-resolved canopy apex at its measured position (stand-crown-u8-v1) — revision 2 after adversarial review

## Summary
Publish the 40,325 laser-resolved stand-crown apexes (stand candidates with apex ≥ 3 m, one per 1 m cell, both campaigns) as a new per-tile rendering payload, `crowns` / `stand-crown-u8-v1` (6 bytes a crown: cell column/row, apex height, Voronoi-extent radius, prominence over the extent's outer ring, flags), and plant each at its measured position and height, leaving the 4 m stand field to the ~7–8 % of canopy no apex explains. The revision folds all 18 review issues: the crown generation is compiled with the previous generation's `--observed-on 2026-09-02` because `observedOn` enters every record's rounded confidence (three approved individuals sit at exactly 0.600) and the block rule is `changed === moved === added === missing === 0` proved by a compiler test that compiles the same rasters with the crown pass on and off; the residual-field union is built as an Int32Array of crown ids with −1 for unclaimed cells, never a boolean, because `tileStandField` tests `>= 0`; a cross-campaign seam rule drops the older campaign's apex for any pair under 3 m (measured minimum exactly 2.0 m, 25 pairs < 3 m); `chooseSpecies` receives `shoreDistanceAt(x, z)`; candidate keys fall back to the apex when the centroid is null; the header's grid is derived from the tile bounds and refused above 256 cells; `check-crowns.mjs` rasterises exclusions from the course model and uses strict `d < 2` and `|h − chm| ≤ 0.125 + 1e-6`; the in-app proof is a new `V3D.v2Crowns()` export matched against planted instances, not an accounting identity; `vegetation-baseline` reads its expected counts from the generated `vegetation-evidence.json` (written by a new tool, not copied) and byte gates that can fail (≤ 760 KB visit, ≤ 300 KB stands, ≤ 280 KB crowns); every table is labelled with the population it counts (re-run 41,240 / written 40,708 / published 40,325); main.js edits are anchored by identifier because the working tree is +196/−69 against HEAD; and the whole change lands on its own branch after the LOD branch merges, since the boot fingerprint changes by design and the LOD series is gated on it being identical. Deploy consequence stated: a client whose precached assets predate the feature refuses the new ground until its assets update (fallback under ?v2=1, boot error under ?v2=require), the same shape as the stand-field rollout.

## Files
- packages/course-v2/stand-crowns.mjs
- packages/course-v2/stand-crowns.node-test.mjs
- packages/course-v2/schema.mjs
- packages/course-v2/schemas/chunk-header-v2.schema.json
- packages/course-v2/schemas/ground-v2.schema.json
- packages/course-v2/schemas/common-v2.schema.json
- packages/course-v2/chunk-node.mjs
- packages/course-v2/runtime/decode-web.mjs
- packages/course-v2/runtime/manifest-loader.mjs
- packages/course-v2/graph-node.mjs
- packages/course-v2/emit-ground-graph-node.mjs
- packages/course-v2/prune-generations.mjs
- packages/course-v2/publish-ground-rings.mjs
- packages/course-v2/check-app-build.mjs
- packages/course-v2/course-v2.node-test.mjs
- packages/course-v2/puttom-vegetation-freeze.node-test.mjs
- packages/course-v2/vegetation/crown-detect.mjs
- packages/course-v2/vegetation/stand-fields.mjs
- packages/course-v2/vegetation/compile-vegetation.mjs
- packages/course-v2/vegetation/compile-vegetation.node-test.mjs
- packages/course-v2/vegetation/vegetation.node-test.mjs
- packages/course-v2/vegetation/publish-vegetation.mjs
- packages/course-v2/vegetation/publish-vegetation.node-test.mjs
- packages/course-v2/vegetation/render-review.mjs
- tools/check-crowns.mjs
- tools/write-vegetation-evidence.mjs
- tools/vegetation-baseline.mjs
- tools/check-app.mjs
- apps/golf/src/engine/v2-vegetation.mjs
- apps/golf/src/engine/v2-vegetation.test.mjs
- apps/golf/src/engine/v2-graph-source.mjs
- apps/golf/src/engine/v2-graph-source.test.mjs
- apps/golf/src/engine/v2-terrain-select.mjs
- apps/golf/src/engine/v2-terrain-select.test.mjs
- apps/golf/src/main.js
- apps/golf/vite.config.js
- apps/golf/public/_headers
- package.json
- geo_data/course-v2/puttom/vegetation/vegetation-evidence.json
- geo_data/course-v2/puttom/vegetation/phase4-vegetation.json
- apps/golf/public/courses/v2-index.json
- apps/golf/public/courses/puttom/course-v2-<sha>.json
- apps/golf/public/grounds/puttom/ground-v2-<sha>.json
- apps/golf/public/grounds/puttom/crowns/*.bvch
- apps/golf/public/grounds/puttom/stands/*.bvch
- docs/puttom-v2-lidar-tree-placement-plan.md
- CLAUDE.md

## Risks
- The boot fingerprint changes by design (instances AND the reasons key set, boot-profile.mjs 73); landing this inside the LOD series would break every commit's placement gate, so it must go on its own branch after the LOD merge with pre/post fingerprints and re-captured six-view goldens in one commit.
- Records are byte-identical ONLY if --observed-on equals the published generation's 2026-09-02: observedOn enters every record's rounded confidence via the recency term, ~1.5% of 3,502 values flip per day and three approved individuals sit at exactly 0.600; the CLI block rule exists to catch this, and a future re-fly must declare a registry change explicitly.
- 25,697 published crowns are absorbed apexes with no Dalponte segment; their Voronoi extents (p50 3.9 m) are inferred from neighbour spacing and they are drawn at full measured height inside what was a taller neighbour's segment -- a closed stand may read denser or more regular than the imagery, and only the RTX 3070 view of hole 7 and a stand edge can judge it.
- The residual stand field's planting falls from 56,241 to a measured 2,850-3,867 and the visible forest inside coverage from ~59.7k to ~46.7k stems while canopy area is preserved; the forest WILL look different, and that is the point, but it must be looked at, not only gated.
- The residual union must be an Int32Array of crown ids with -1 for unclaimed cells; tileStandField tests >= 0, so any boolean or 0/1 encoding silently empties the field and the crowns and stand trees are both planted (the visit would be ~991 KB and a 1 MB gate would pass it) -- the stands byte gate (<= 300 KB) and the standTrees range gate are what catch it.
- A seam crown is detected once per campaign; without the compile-time seam rule 25 pairs at 2.0-3.0 m are planted twice and a `<= 2 m` spacing gate passes them at zero margin.
- The 6-byte cell-index layout addresses at most 256 cells per axis; a finer CHM or a larger tile needs stand-crown-*-v2, and the validator refuses rather than wraps -- but a 512 m tile at 2 m cells is accepted and would silently halve crown precision, so the encoder must be handed the real cellMetres.
- Deployed clients whose precached assets predate stand-crown-u8-v1 refuse the entire new ground (GPK1 fallback under ?v2=1, boot error under ?v2=require) until their service worker updates; opt-in path only, same shape as the stand-field rollout, but it must be stated in the checkpoint.
- 64 additional chunk fetches per v2 visit at maxConcurrent 6; the wait-for-chunk-load span is recorded and gated at 1.5x + 200 ms of the pre-change value, but the pre-change value on the RTX 3070 has not been measured yet.
- Windows CRLF: geo_data JSON, the new evidence file and crown-layers.json must be LF; check-manifests reports false mismatches on a CRLF checkout, and git stash pop re-CRLFs untracked JSON.
- The byte and residual figures (215,280 B crowns, 264,217 B stands, ~707 KB visit, 2,850-3,867 residual trees) come from two independent re-runs of the compile chain, not from the compile that will actually publish; the gates are set with margin and the compile's evidence is the number of record.
- vegetation-evidence.json has never been generated by a tool; the new writer must reproduce the hand-assembled key set exactly or the freeze test throws on compile.review.

## Open questions
- Should absorbed apexes (bit 6, 25,697 crowns) be drawn at full measured height, or damped toward the surrounding canopy given they sit inside a taller neighbour's Dalponte segment? The spec draws them at measured height; the owner judges a closed stand on the RTX 3070 before merging.
- Should the crown payload be bundled into the stands chunk (one fetch per tile instead of two) rather than a separate content-addressed `crowns` layer? Separate layers keep a residual-field change and a crown change independently addressable; bundling saves 64 fetches per visit. The spec keeps them separate and gates the fetch span.
- LOWQ rule: keep every crown within 300 m of a hole line and thin the rest by hash (spec), or thin low-prominence crowns everywhere? Nothing has been measured on a phone either way.
- Is the prominence byte worth its ~18-45 KB deflated? It exists for review overlays and a future silhouette-preserving LOWQ rule; the spec keeps it and defines it over the extent's outer ring.
- Should stand candidate keys move to the apex for ALL stand crowns (cleaner, changes 15,011 keys and the candidates.json sort order) or only when the centroid is null (minimal, spec)? Records and approvals are unaffected either way.
- If a future compile needs a new observedOn (a re-fly), should the recency term be dropped from records or frozen per campaign? Either is a declared registry change and is out of scope here.
- Species for crowns stays by hash; the NMD2023 species prior remains deferred (~6 GB to reach Puttom) and is the next honest step toward best-in-class placement.
- Should the residual field's minimumFraction (0.15) be lowered now that it only holds the 2-5 m layer, or should its 4 m planting be retired for cells under 0.15 residual fraction? Decide after looking at the residual on hardware.

## Evidence
- Working tree vs HEAD 0a37b07: `git status` shows ` M apps/golf/src/main.js` (+196/-69; 8,280 lines vs 8,153), plus CLAUDE.md, apps/golf/index.html, tools/check-flight.mjs modified; every other cited file is at HEAD. Working-tree identifiers: `WHY_V2_STAND = 6` at 3558, `treeWhy[t.species].push(t.kind === 'individual'` at 3711, `const LEGACY_TREE_REASONS` at 3719, `v2Objects: () => ({` at 8136, `graphStandTiles:` at 8148, `span('v2 vegetation: wait for chunk load'` at 2122, `V2_VEGETATION_LOADING` gate at 198-199, `midrEdgeFade` at 1539/3663/4208, `LOWQ` at 1131-1132, `SHORE` at 3417, `distToLineIndexed as distToLine` import at 55. HEAD: 3556 / 3709 / 3717 / 8009 / 8021 / 2120.
- compile-vegetation.mjs (HEAD): VEGETATION_COMPILER_VERSION = 2 (41); machineReviewDecision 58-70; provisionalZone 90-100; candidateKey 147-149 rounds crown.centroid; clip/fill/detection/exclusions 253-257 (`rasterizeExclusions(filled, exclusionFeatures)`); `captureAgeYears = (Date.parse(observedOn) - Date.parse(item.captureEnd)) / (365.25 * 86400e3)` at 265; individualExtents Int32Array fill(-1) at 267; zone/confidence evaluated at crown.centroid 268-276; candidates.sort by key 337; eligibility 340-350; individualExtents set 368-374; records take `confidence: draft.candidate.confidence` at 384; compileStandChunks called with `extentLabels: campaign.individualExtents` 388-394; evidence 403-429; writeCompilation 462-493; CLI 495-537 with `--observed-on` defaulting to today (500).
- crown-detect.mjs: CROWN_PARAMETERS 18-33 (window min 3 m, maximumCrownRadiusMetres 10); maxima detection skips NaN neighbours 60-80; growCrowns skips an already-labelled apex 102-103; classifyCrowns 239-268; crownConfidence recency `clamp(1 - captureAgeYears / 10)` weight 0.5 of 9, composite `round(sum / weight)` to 3 decimals 295-301; crownExtents 315-401 with the stand early return 355-357, BFS over the detection raster, nearest-apex test at 386, extentLabels written at 367.
- registry-identity.mjs registryDiff 97-115: `changed` fields `['objectHeightMetres','radiusMetres','confidence','truthZone','sourceId','capturedAt','subtype','placementMethod']` at 111. object-compiler.mjs FIELD_ORDER 15-20; assignRecordsToTiles 86-99.
- stand-fields.mjs tileStandField 107-175: `if (extentLabels && extentLabels[index] >= 0) continue;` at 154; standField seam rule (majority side) 25-31; mergeTileStandFields 178-203 first-measured-wins.
- candidates.json scan (44,961 entries, read-only): 40,708 stand / 3,705 individual / 548 excluded; 25,697 keys end in `/null/null` = 25,697 null centroids; individuals with confidence === 0.600: 3 (and 101 below 0.6); published set (stand, apex >= 3 m): 40,325 (383 dropped) in 64 lod-0 tiles, min 10, max 1,033; published byZone as written A 1,203 / B 4,457 / C 34,665; no apex pair < 2 m; cross-campaign minimum exactly 2.0 m, 25 pairs < 3 m, 35 < 4 m; same-campaign minimum sqrt(10) = 3.162 m, 0 pairs < 3 m.
- compile-machine/evidence.json line 4: `"observedOn": "2026-09-02"`; registry.json 3,502 records (first: tree-puttom-000001, confidence 0.667, capturedAt 2026-06-21); identity.json {matched 0, moved 0, added 3502, missing 0}. laser-campaigns.json captureEnd: 26f015-702_69 2026-06-21, 23f028-702_69 2023-06-07, 20f015 2020-08-10 (superseded).
- v2-vegetation.mjs: V2_VEGETATION_VERSION = 1 (26); STAND_PLANTING 30-37; loadV2Vegetation 87-145 with maxConcurrent = 6 (92), jobs 99-102, decode 121-126; createCoverage 148 (`tile.objects || tile.stands`); `function chooseSpecies(r, shoreDistance)` 196-199; planV2Vegetation 205-299, individuals call `chooseSpecies(r, shoreDistanceAt(x, z))` at 233, stand trees at 273, skips only on `!Number.isFinite(y)` at 225/266, lowQuality hash thinning at 254.
- phase4-vegetation.json v2-require run: trees 79,407 = forestRing 12,879 + satellite 6,766 + shore 19 + v2Individual 3,502 + v2Stand 56,241 (legacy outside coverage 19,664); legacyInsideCoverage 0; planned standTrees 56,241, cellsSkipped 193,061, baseMismatch p95 0 / max 0.001; loaded 64/64 tiles, 725,074 bytes; draws 39; gpk1 run 54,601 trees. Plan checkpoint lines 157-158 still say 92,681 / 32,938 (pre-midrEdgeFade; CLAUDE.md 1959-1961).
- Published graph: v2-index.json -> courses/puttom/course-v2-0d6eef4e2f5fd2a2ce0220d9e780a592ded9e4d9ea533a14b63b27672d378866.json -> grounds/puttom/ground-v2-03ede20e...json: 277 tiles, 64 lod-0 all with objects and stands, requiredFeatures [chunk-envelope-v2, object-registry-json-v1, stand-field-u8-v1, terrain-grid-u16-v1], summary {}, l0/0/0 bounds 696404.5..696660.5 E / 7025594.5..7025850.5 N (the raster origin 696404.5/7025850.5 coincides). Prior ground a25ff2b3 retained; git history of grounds/puttom: 5a16738, a6d812c, 0cd44d2, 2acf243.
- Compile cache listing: chm/ground/firstReturns/allReturns f32 (16,777,216 B each) + json per campaign, chmv2-1200130303.f32/json, compile/, compile-harness/, compile-machine/ (candidates.json, evidence.json, identity.json, layers.json, objects/, registry-diff.json, registry.json, stand-fields.json, stand-layers.json, stands/). No exclusion raster. semantic-exclusions.mjs exports rasterizeExclusions (105) and courseExclusionFeatures (160); geo_data/course-v2/puttom/migration/course-model.epsg3006.json exists.
- vegetation-evidence.json keys: schemaVersion, groundId, observedOn (2026-09-02), state, note, inputs, compile (observedOn 2026-09-02, identity {matched 0, added 3502}, records {tiles 64, records 3502, encodedBytes 176823}, stands {cellMetres 4, tiles 64, encodedBytes 548251, ...}, review 'machine review v1, ...'), candidateSummary, harness, publish (rootSha256, courseManifestSha256, groundManifestSha256, previous...). Only readers: puttom-vegetation-freeze.node-test.mjs (73) and the plan (117).
- Freeze test structure: test 1 lines 36-51 (64 finest, >= 60 stands, >= 48 objects, feature checks, lod>0 empty), test 2 lines 53-70 (walk ['terrain','surface','objects','stands'], verifyAssetGraph, chunks >= 64+64+1+1), test 3 lines 72-90 (compile.review /^machine review v1/, records > 3000, stands.tiles >= 60, seam, >= 2 ground manifests).
- Build: apps/golf/dist/assets contains decode-web-C7QxAdd9.js and v2-vegetation-DFlbuUyo.js only (no stand-field-*.js); vite.config.js globIgnores 81-96 lists assets/stand-field-*.js; check-app-build.mjs precache list 286-299 (decode-web-, surface-grid-, surface-sdf-grid-, ... never stand-field-), static-closure walk 228-236, required _headers rules 313-318 (preview.json, surface-preview.json, terrain, surface), tile-layer walk 379. _headers 60-76 has objects but no stands rule.
- boot-profile.mjs 60-79: fingerprint = sha256 of JSON.stringify(trees.holes ?? total) + species + reasons + zones, plus treeInstances hash and tint hashes; a new reason key changes `trees`. tree-lod-plan.md 208-211 ('must hash identically before and after'), 275 ('identical to the baseline on every axis'), six-view table 345-357; puttom-performance-status.md 38-39 ('fingerprint identical on every commit'); branch claude/tree-lod-phase-1 is 29 commits ahead of main (git log main..HEAD).
- vegetation-baseline.mjs: SLUG/LABEL flags 30-36, modes gpk1 (`&det=1`) and v2-require (`&det=1&v2=require`) at 74, report 93-107 (stats, legacyTrees, v2Objects, perf, v2), gates 109-124 (count-agnostic: individuals > 0 && standTrees > 0), shots 127-149, output phase4-vegetation.json 154-172. check-app.mjs 230-237 gates `!(veg.reasons.v2Individual > 0) && !(veg.reasons.v2Stand > 0)`.
- Graph/loader/schema touch points verified: schema.mjs V2_SUPPORTED_FEATURES 9-17 (sorted), ASSET_KINDS 23, tile layers exactKeys 264 + loop 266, chunk exactKeys 329-333, owner list 342, stand-field branch 466-500, json branch 501, standField-only rule 533; chunk-header-v2.schema.json kind enum 14, payloadFormat enum 26, standField property 28, stand-field variant 162-180, `"standField": false` at 158/196/215/234/257; ground-v2.schema.json layers 45-68 (stands nullable, not required); common-v2.schema.json 57; chunk-node.mjs dispatch 93 and deflate-raw level 9 at 32-38; decode-web.mjs 136; graph-node.mjs loop 174-186; emit-ground-graph-node.mjs layerReferences 48-56, requiredFeatures derived at 218 (ground) and 255 (course), writeGroundGraphFiles 352; manifest-loader.mjs assetReferences 30-38, assertManifestGraph 41-55; prune-generations.mjs 39/59 (usage line 9: --slug, --also, --apply); publish-ground-rings.mjs 106-108; v2-graph-source.mjs summary 53-76; v2-terrain-select.mjs 34; course-v2.node-test.mjs 198-206; package.json test line 6.
- publish-vegetation.mjs: assembleVegetationGraph 28-105 (objectLayers/standLayers 36-37, layers 60-65, supplied check 68-73), CLI 108-170 refuses HARNESS review (120-123), reads layers.json/stand-layers.json 142-147, LF-normalises source-manifest 149-152, prints a JSON report 160-169. publish-vegetation.node-test.mjs 14-90 attaches a stand layer. synthetic-fixture.mjs ground bounds 650000..650256 (278-284). stand-field.mjs exports 17-24, standFieldHeaderSection 39-54, encode 61, decode 79, inspect 104; stand-field.node-test.mjs exists.
- render-review.mjs 1-20 usage (--ground --rasters --candidates [--out]); 107-113 draws individuals as circles and stand crowns as amber dots at candidate.centroid (null for 25,697). tree-lod-ab.mjs exists (tools/), boots ?bana=puttom&det=1&v2=require&lod=3 and shoots hole 14 golden / hole 5 noon in tiers 3 and 4.
- Plan: 'stand crowns are never records' at docs/puttom-v2-lidar-tree-placement-plan.md 133; Truth zones 1092-1120; Phase 4 opt-in 1294-1306; Acceptance gates 1332+ incl. 'Cross-tile and cross-campaign candidates contain no duplicates' (1352). .gitattributes: *.bvch binary; geo_data/**/*.json and apps/golf/public/grounds/puttom/*.json text eol=lf.
- Reviewer-measured figures adopted (not re-run here): crown payload with §2.2 prominence 215,280 B deflated for 40,280 crowns (decoded 241,680); residual stand field 264,217 B (today's reproduces as 547,958 vs 548,251 published); residual planting 3,867 vs this study's 2,850; ~1.5% of records flip confidence by 0.001 per day of observedOn shift (3,529 of 3,705 composites reproduced exactly). Revision 1's 188,836 B was encoded with candidates.json prominence (apex height for zero-cell crowns).

---

# Stand crowns — implementation specification (revision 2)

Read-only design study; nothing below has been applied. This revision folds the 18 adversarial-review issues; §10 is the ledger that says, issue by issue, what changed and where the review itself was wrong.

## 0. Where this lands, and how the anchors are to be read

**Branch (review issue 15).** NOT on `claude/tree-lod-phase-1`. That branch's every commit is gated on `tools/boot-profile.mjs --fingerprint` hashing identically (`docs/tree-lod-plan.md` 208–211: "Placement is untouched … must hash identically before and after"; `docs/puttom-performance-status.md` 38–39: "fingerprint identical on every commit"), and this change alters the population by design — `boot-profile.mjs` line 73 hashes `JSON.stringify(trees.reasons)` too, so even the new `v2Crown` reason key changes the fingerprint on its own. Land the crown generation on its own branch `claude/stand-crowns`, cut from `main` after the LOD branch merges (or from `main` now, rebased later), with: the pre-change fingerprint and `vegetation-baseline` run recorded in the commit that changes the generation, the post-change fingerprint beside it, the six-view LOD goldens re-captured and `tools/tree-lod-ab.mjs` re-run in the same commit. The LOD branch's placement claim stays untouched.

**Line anchors (issue 4).** All line numbers below are HEAD `0a37b07`, which is the working tree for every cited file EXCEPT `apps/golf/src/main.js` (modified, +196/−69, 8,280 lines against HEAD's 8,153), `CLAUDE.md`, `apps/golf/index.html` and `tools/check-flight.mjs`. main.js edits are therefore anchored by identifier only; today's working-tree positions are given in brackets as a courtesy and must be re-grepped before editing. Working tree: `WHY_V2_STAND = 6` [3558], `treeWhy[t.species].push(t.kind === 'individual'` [3711], `const LEGACY_TREE_REASONS` [3719], `v2Objects: () => ({` [8136], `graphStandTiles:` [8148], `span('v2 vegetation: wait for chunk load'` [2122], `const V2_VEGETATION_LOADING` [198–199]. HEAD: 3556 / 3709 / 3717 / 8009 / 8021 / 2120 / 196–197.

**Shell (issue 10).** This machine's primary shell is PowerShell 5.1; every command block below is written for **Git Bash** (available) and the two environment-variable lines are given in PowerShell form as well.

## 1. What is true today (verified at HEAD 0a37b07)

- `packages/course-v2/vegetation/compile-vegetation.mjs`: `VEGETATION_COMPILER_VERSION = 2` (41); `MACHINE_REVIEW_RULES` (49–57) and `machineReviewDecision` (58–70: `not-individual`, `confidence < 0.6`, height < 3, radius < 1, zone-A prominence/compactness); `candidateKey` (147–149) rounds the CENTROID; `provisionalZone` (90–100); `captureAgeYears = (Date.parse(observedOn) − Date.parse(item.captureEnd)) / (365.25·86400e3)` at **265**; the campaign loop evaluates `provisionalZone` and `crownConfidence` at `crown.centroid` (268–276); candidates are sorted by key (337); eligibility (340–350); `individualExtents` is an `Int32Array(...).fill(−1)` set to the crown id for record individuals only (267, 368–374); records take `confidence: draft.candidate.confidence` (384); `compileStandChunks` is called with `extentLabels: campaign.individualExtents` (388–394); evidence (403–429); `writeCompilation` (462–493); CLI (495–537, `--observed-on` defaults to today at 500).
- `crown-detect.mjs`: `CROWN_PARAMETERS` (18–33, window ≥ 3 m, `maximumCrownRadiusMetres` 10); maxima skip NaN neighbours (60–80); `growCrowns` skips an apex whose cell is already labelled (102–103); `classifyCrowns` (239–268); `crownConfidence` recency `clamp(1 − age/10)` weight 0.5 of 9, composite rounded to 3 decimals (295–301); `crownExtents` (315–401) — stand crowns take the early return at 355–357, individuals BFS over the DETECTION raster with the nearest-apex Voronoi test over ALL maxima (386), labelling `extentLabels` (367).
- `registry-identity.mjs` `registryDiff` (97–115): `changed` compares `objectHeightMetres, radiusMetres, confidence, truthZone, sourceId, capturedAt, subtype, placementMethod` (111).
- `stand-fields.mjs` `tileStandField` (107–175): a cell is claimed when `extentLabels[index] >= 0` (**154**); `mergeTileStandFields` (178–203) first-measured-wins; `standField` (25–31) resolves seam cells by majority side.
- `object-compiler.mjs` `FIELD_ORDER` (15–20) and `assignRecordsToTiles` (86–99).
- Runtime `apps/golf/src/engine/v2-vegetation.mjs`: `V2_VEGETATION_VERSION = 1` (26); `STAND_PLANTING` (30–37); `loadV2Vegetation` (87–145, `maxConcurrent = 6` at 92, jobs 99–102, decode 121–126); `createCoverage` (148, `tile.objects || tile.stands`); `chooseSpecies(r, shoreDistance)` (**196–199**); `planV2Vegetation` (205–299: individuals 221–238 with `chooseSpecies(r, shoreDistanceAt(x, z))` at 233, field loop 239–281, skip only on `!Number.isFinite(y)` at 225/266, `lowQuality` thinning at 254).
- main.js (identifiers): `V2_VEGETATION_LOADING` gates on `objectTiles + standTiles`; the plan is built with `groundHeightAt: terrainH`, `shoreDistanceAt: SHORE`, `lowQuality: LOWQ`; instances are pushed after `lap('legacy tree lattice')`; `legacyTreeExport` counts `legacyInsideCoverage` with `W[k] < WHY_V2_INDIVIDUAL` and exports instances rounded `toFixed(2)`/`toFixed(3)`; the LOD table uses `W[k] >= WHY_V2_INDIVIDUAL ? 1 : …` for measured size; `V3D.perf()` returns `BOOT_PERF.spans` (`span()` at 100–103); `distToLine` is `distToLineIndexed(x, z, line, cutoff)` from `engine/ring-index.mjs` (main.js 55).
- Published generation: root → `courses/puttom/course-v2-0d6eef4e….json` → `grounds/puttom/ground-v2-03ede20e….json`: 277 tiles, 64 lod-0 (256 m, bounds on .5), all 64 with `objects` and `stands`, `requiredFeatures` `[chunk-envelope-v2, object-registry-json-v1, stand-field-u8-v1, terrain-grid-u16-v1]`, `summary` empty. Compile cache `packages/course-geo/toolchain/.cache/acquisition/puttom-vegetation/`: chm/ground/firstReturns/allReturns f32+json per campaign, chmv2, and `compile-machine/` (candidates.json, evidence.json with `observedOn 2026-09-02`, registry.json 3,502 records e.g. `confidence 0.667`, identity.json `{matched 0, moved 0, added 3502, missing 0}`, layers.json, stand-layers.json, objects/, stands/). **No exclusion raster is cached** (issue 17).
- `geo_data/course-v2/puttom/vegetation/phase4-vegetation.json` (the branch's committed v2 run): `v2-require` trees **79,407** = forestRing 12,879 + satellite 6,766 + shore 19 (legacy outside coverage **19,664**) + v2Individual 3,502 + v2Stand 56,241; `legacyInsideCoverage 0`; loaded bytes **725,074**; draws 39 on the pre-LOD engine (56 at boot on the LOD branch, the established fact). The plan checkpoint's "92,681 trees / 32,938 legacy outside" predates `midrEdgeFade` (CLAUDE.md 1959–1961; main.js `midrEdgeFade` [1539, 3663, 4208]).
- `vegetation-evidence.json` is a HAND-ASSEMBLED document (keys `schemaVersion, groundId, observedOn, state, note, inputs, compile, candidateSummary, harness, publish`), read only by `puttom-vegetation-freeze.node-test.mjs` (73); nothing in the repo writes it (issue 6).
- Build: `apps/golf/dist/assets` contains `decode-web-*.js` and `v2-vegetation-*.js` and **no `stand-field-*.js`** — Rollup hoists the codec into `decode-web` (issue 7). `check-app-build.mjs` walks the flagless static closure (228–236), lists precache names (286–299, no `stand-field-`), requires four `_headers` rules (313–318), and walks tile layers `['terrain','surface','objects','stands']` (379). `_headers` (60–76) has `objects` but **no `stands` rule**.

## 2. Data: what a stand crown is, measured — every table names its population

Three populations appear in this document and are never mixed (issue 18):

| label | count | what it is |
|---|---|---|
| **re-run** | 41,240 (26,655 S / 14,585 N) | stand crowns from re-running the compiler's detection on the cached rasters, BEFORE exclusion |
| **written** | 40,708 (26,441 S / 14,267 N) | `representation === 'stand'` in `compile-machine/candidates.json` (after exclusion; 3,705 individual, 548 excluded, 44,961 total) |
| **published** | 40,325 | written stand crowns with `apex.heightMetres ≥ 3` (383 dropped); 64 tiles, min 10, p50 ~720, max 1,033 (`l0/6/4`); by `truthZone` as written A 1,203 / B 4,457 / C 34,665 — wrong for the null-centroid crowns, see below |
| **published after the seam rule** | ≈ 40,300 | published minus cross-campaign duplicates (§2.3); the compile records the exact number |

**Zero-cell crowns.** 25,697 written stand crowns have `centroid {null,null}`, `radiusMetres 0` and key `<campaign>/null/null` (verified: 25,697 null keys), because `growCrowns` skips an apex already labelled by a taller neighbour. `provisionalZone` was evaluated at the null centroid, so all 25,697 fell to zone C. By apex on the re-run population: A 1,516 + 1,712, B 6,443 + 6,273, C 18,696 + 6,600 (S + N). Apex heights (written stand): p5/p50/p95/max 4.85 / 12.73 / 20.85 / 31.9 m. Apex coordinates are integer metres; raster origin 696404.5 / 7025850.5, 2048 × 2048, which coincides with tile `l0/0/0`'s `minEasting/maxNorthing`, so 1 m cell centres of the raster ARE the lod-0 tiles' cell centres.

### 2.1 Extent rule (decision)

Run the individuals' extension for stand crowns too: BFS from the apex over the DETECTION raster (as `crownExtents` does), cells ≥ max(2 m, 0.2 × apex), ≤ apex, not excluded, within 10 m, and nearer to this apex than to any other maximum (the line-386 Voronoi test over ALL maxima). Measured on the re-run population (both campaigns, compiler's own functions):

| campaign | stand crowns (re-run) | zero-cell | extent radius p5/p50/p95 | zero-cell extent p50 | canopy cells ≥ 2 m | residual after all extents | field trees today → after |
|---|---|---|---|---|---|---|---|
| 26f015 (S, 2026) | 26,655 | 16,857 | 2.33 / 4.15 / 8.31 m | 3.87 m | 1,436,012 | 101,012 (7.0 %), p50 4.7 m | 35,888 → 1,778 |
| 23f028 (N, 2023) | 14,585 | 8,820 | 2.19 / 4.26 / 8.44 m | 3.99 m | 839,620 | 60,467 (7.2 %), p50 3.6 m | 20,036 → 1,072 |

"Today" 55,924 reproduces the 56,241 actually planted to 0.6 %, so the "after" figure of 2,850 is trustworthy AS A METHOD; the reviewer's independent re-run of the same method landed at 3,867 (7.9 % / 8.4 % residual), the difference being which crowns are published. State the expectation as a range, **1,500–6,000**, and record the measured number (issue 14). Extent radius / height p50 0.35 against today's allometry 0.32–0.34, so the stands keep their look. Individuals' extents are unchanged by extending stand crowns (the nearest-apex test already used every maximum), so the 3,502 records are byte-identical — §5 proves it rather than asserts it.

### 2.2 Prominence for the payload (changed from revision 1)

Prominence = apex height (the `filled`, unsmoothed value at the apex cell, i.e. `crown.apex.heightMetres`) − mean of the `filled` heights of the extent's **outer ring**: every on-raster, non-NaN cell that is a 4-neighbour of an extent cell and not itself in this crown's extent. This is uniform for a one-cell extent (its four neighbours) and needs no special case. Clamp at 0. The candidate's `prominenceMetres` stays as review evidence (it equals the apex height for the 25,697 zero-cell crowns, which is why revision 1's 188,836 B payload figure was low-entropy — §3.2).

### 2.3 Seam rule (issue 12)

Each raster is clipped to its own `projBbox` (compile-vegetation.mjs 253; south 7020000–7025000, north 7025000–7030000) and maxima detection skips NaN neighbours, so a crown straddling N 7025000 yields an apex on BOTH sides. Measured over the published population plus record individuals: same-campaign minimum apex spacing √10 = 3.16 m (window ≥ 3 m), cross-campaign minimum exactly **2.000 m**, 0 pairs < 2 m, **25 pairs < 3 m**, 35 < 4 m (the reviewer counted 22 and 31 on a slightly different population; the compile records its own number). Rule, applied at compile time before tiling:

1. Record individuals are never dropped (they are the registry).
2. A stand crown within **3 m** (strict `d < 3`, the detection floor) of a record individual from the OTHER campaign is dropped.
3. For a cross-campaign pair of stand crowns with `d < 3`, keep the **newer** campaign's apex (26f015, 2026); drop the older.
4. Every dropped crown's extent is STILL removed from the residual field (the canopy is explained either way).
5. Evidence `stands.crowns.seamDuplicatesDropped`; `check-crowns` gates cross-campaign pairs `< 3 m === 0`. This satisfies the plan's own compiler gate "cross-tile and cross-campaign candidates contain no duplicates" (`docs/puttom-v2-lidar-tree-placement-plan.md` 1352).

### 2.4 Candidate key and zone fixes (issue 9, and the zone bug)

`candidateKey(campaignId, crown)` (147–149) → when `crown.centroid.easting === null`, key by the apex: `${campaignId}/${crown.apex.easting}/${crown.apex.northing}` (integers). Individuals always have a centroid, so record approvals by key are unaffected; only stand candidate keys change, and the compiler asserts every key is unique (throw on a duplicate — apex cells are unique per campaign). `provisionalZone` is evaluated at the apex when the centroid is null (lines 268–270 use `crown.centroid`; use `crown.apex` as the fallback), which makes `truthZone` right for the 25,697 and changes the reported stand zone counts (A ~1,200 → ~3,200) without touching any record.

## 3. The chunk format: `crowns` / `stand-crown-u8-v1`

New module `packages/course-v2/stand-crowns.mjs`, mirroring `stand-field.mjs` (constants 17–24, `standFieldHeaderSection` 39–54, `encodeStandField` 61, `decodeStandField` 79, `inspectStandFieldPayload` 104), plus `packages/course-v2/stand-crowns.node-test.mjs` (added to `package.json`'s test script, line 6, beside `stand-field.node-test.mjs`).

Exports:
```
STAND_CROWN_FORMAT = STAND_CROWN_FEATURE = 'stand-crown-u8-v1'
STAND_CROWN_BYTES = 6
STAND_CROWN_HEIGHT_SCALE_METRES = 0.25, STAND_CROWN_RADIUS_SCALE_METRES = 0.1, STAND_CROWN_PROMINENCE_SCALE_METRES = 0.25
STAND_CROWN_MAX_CELLS = 256
CROWN_FLAG_NORTH = 1, CROWN_FLAG_RASTER_EDGE = 2, CROWN_FLAG_TOO_SMALL = 4, CROWN_FLAG_NOT_COMPACT = 8,
CROWN_FLAG_NOT_PROMINENT = 16, CROWN_FLAG_CROWNS_TOUCH = 32, CROWN_FLAG_ABSORBED = 64   (bit 7 reserved, must be 0)
standCrownGrid(bounds, cellMetres) -> { columns, rows }      // derived, see below
standCrownsHeaderSection({ bounds, cellMetres, count })
encodeStandCrowns({ bounds, cellMetres, crowns: [{ column, row, heightMetres, radiusMetres, prominenceMetres, flags }] }) -> { standCrowns, payload }
decodeStandCrowns(payload, standCrowns) -> { count, columns, rows, cellMetres, column: Uint8Array, row: Uint8Array, height: Float32Array, radius: Float32Array, prominence: Float32Array, flags: Uint8Array }
inspectStandCrownPayload(payload, header) -> { crowns, northCampaign, absorbed, meanHeightMetres, meanRadiusMetres }
```

**Grid derived from the tile (issue 10).** `standCrownGrid(bounds, cellMetres)`: `columns = (maxEasting − minEasting) / cellMetres`, `rows = (maxNorthing − minNorthing) / cellMetres`; both must be within 1e-9 of an integer and **≤ 256**, else throw (`RangeError: stand-crown-u8-v1 addresses at most 256 cells per axis; use a coarser cellMetres or a v2 format`). The encoder computes the header's `columns/rows` this way from the tile bounds it is given; the validator and `inspectStandCrownPayload` recompute them from `header.bounds` and `header.standCrowns.cellMetres` and refuse a header whose `columns/rows` differ. Puttom's lod-0 tiles are 256 m at 1 m (exactly 256); the synthetic fixture's are 256 m (`synthetic-fixture.mjs` 278–284) — the test must also cover a 512 m tile at 1 m (refused) and a 512 m tile at 2 m (accepted).

Header section `standCrowns` (exact keys):
```
{ count, cellMetres: 1, columns, rows, bytesPerCrown: 6, positionEncoding: 'cell-centre-u8',
  heightScaleMetres: 0.25, radiusScaleMetres: 0.1, prominenceScaleMetres: 0.25,
  extentRule: 'voronoi-apex-0.2-v1', prominenceRule: 'apex-minus-outer-ring-v1',
  representation: 'measured-canopy-apex', rowOrder: 'north-to-south', columnOrder: 'west-to-east', standCrownVersion: 1 }
```
Record, 6 bytes, sorted by (row, column) strictly increasing (which also proves uniqueness):
```
byte 0  column  u8   easting  = bounds.minEasting  + (column + 0.5)·cellMetres
byte 1  row     u8   northing = bounds.maxNorthing − (row + 0.5)·cellMetres
byte 2  height  u8   apex height (filled, unsmoothed), 0.25 m steps; published only if ≥ 12 (3 m); max 63.75 m (apex max 31.9)
byte 3  radius  u8   max(Voronoi extent radius, Dalponte equivalent radius), 0.1 m steps, ≥ 5 (0.5 m); ≤ 10 m by construction
byte 4  prominence u8  §2.2, 0.25 m steps, clamped 0..255
byte 5  flags   bit0 north campaign · bit1 touches-raster-edge · bit2 too-small · bit3 not-compact · bit4 not-prominent · bit5 crowns-touch · bit6 absorbed (zero Dalponte cells) · bit7 reserved 0
```
`decodedBytes = count × 6`. `inspectStandCrownPayload` throws on: count mismatch; column ≥ columns or row ≥ rows; non-increasing order; height < 12; radius < 5; reserved bit set; header grid ≠ derived grid.

**Why it cannot be a record:** no id, reviewStatus, placementMethod, sourceId, accuracy or confidence (`FIELD_ORDER`, object-compiler.mjs 15–20); the schema forbids `records` on this format; `registry-identity.mjs` never sees crowns; `machineReviewDecision` still rejects `not-individual`. Evidence lists them under `stands.crowns` with `records: 0`.

### 3.1 Touch points (every place `stand-field-u8-v1` / `stands` lives; mirror each)

- `packages/course-v2/schema.mjs`: `V2_SUPPORTED_FEATURES` 9–17 insert `'stand-crown-u8-v1'` before `'stand-field-u8-v1'` (sorted); `ASSET_KINDS` 23 add `'crowns'`; tile layers `exactKeys` 264 and loop 266 add `'crowns'`; chunk-header `exactKeys` 329–333 add `'standCrowns'`; ground-owner list 342 add `'crowns'`; new `else if (value.payloadFormat === 'stand-crown-u8-v1')` branch after the stand-field branch (466–500): kind `crowns`, section keys exactly as above, `integer(count, 0, 65535)`, `cellMetres` finite 0.25..256, `columns/rows` integer 1..256 AND equal to the derived grid from `value.bounds`, scales exact, `decodedBytes === count·6`, `requiredFeatures` includes the feature, forbid `grid/surfaceGrid/surfaceSdf/standField/records`; json branch 501 add `'crowns'` to "must use its binary payload"; mirror of 533: `standCrowns` allowed only for its format.
- `packages/course-v2/schemas/chunk-header-v2.schema.json`: kind enum (14), payloadFormat enum (26), `standCrowns` property beside `standField` (28), a new variant modelled on 162–180, and `"standCrowns": false` in each other variant (the five blocks carrying `"standField": false` at 158, 196, 215, 234, 257, plus the stand-field variant itself). `ground-v2.schema.json` 45–68: add `crowns` (nullable assetReference, not required — older manifests omit it). `common-v2.schema.json` 57 kind enum.
- `chunk-node.mjs` 93 dispatch + import; `runtime/decode-web.mjs` 136 dispatch + import.
- `graph-node.mjs` 174 loop add `'crowns'` with a `validateCrownChunk(chunk, tile, label)` beside the stands test at 182–185 (kind, payloadFormat, `inspection`, `header.id === tile.id`).
- `emit-ground-graph-node.mjs` `layerReferences` 51 add `'crowns'` (the ground's `requiredFeatures` at 218 and the course's at 255 derive from it — this is what makes the new feature REQUIRED by the manifest, §7).
- `runtime/manifest-loader.mjs` 35–36 add `if (tile.layers.crowns) references.push(tile.layers.crowns)`; `prune-generations.mjs` 39 and 59 add `'crowns'`; `publish-ground-rings.mjs` 106–108: `if (published.layers.crowns !== undefined) layers.crowns = published.layers.crowns;` and the resources loop add `'crowns'`; `check-app-build.mjs` 379 add `'crowns'`.
- `apps/golf/src/engine/v2-graph-source.mjs` 53–76: `crownTiles`, `encodedCrownBytes` in `summary`; `v2-graph-source.test.mjs` 54–56 pattern. `v2-terrain-select.mjs` 34: `objectTiles + standTiles + crownTiles`; `v2-terrain-select.test.mjs` 195–205 add a `{ summary: { crownTiles: 2 } }` case in both branches. main.js `V2_VEGETATION_LOADING`: add `+ (summary?.crownTiles || 0)`; `v2Objects` gains `graphCrownTiles`, `graphEncodedStandBytes`, `graphEncodedCrownBytes` (anchor `graphStandTiles:`).
- `course-v2.node-test.mjs` 198–206 feature list.
- `apps/golf/vite.config.js` 95: add `'assets/stand-crowns-*.js'` **as a defensive line only** (issue 7): the built app emits no `stand-field-*.js` today because `v2-vegetation.mjs` imports `decode-web.mjs` statically and Rollup hoists the codec into `decode-web-*.js`, already ignored; `stand-crowns.mjs` imported the same way lands in the same place. The gate that proves the decoder stays behind the v2 dynamic import is `node packages/course-v2/check-app-build.mjs` after `vite build` (static-closure walk, 228–236). Add `'stand-field-'` and `'stand-crowns-'` to the precache name list at 286–299 for completeness; they match nothing today and that is fine.
- `apps/golf/public/_headers`: after the `objects` rule (72–73) add `/grounds/*/stands/*.bvch` and `/grounds/*/crowns/*.bvch`, both `Cache-Control: public, max-age=31536000, immutable` (the stands rule is missing today; note in the commit that this changes hosting behaviour for existing stand chunks, harmlessly). `check-app-build.mjs` 313–318: add both to the required-rule list.
- `package.json` test script (line 6): add `packages/course-v2/stand-crowns.node-test.mjs`.

### 3.2 Sizes (issue 13)

Revision 1's "188,836 B deflated" was encoded with `candidates.json`'s `prominenceMetres`, which equals the apex height for the 25,697 zero-cell crowns — low entropy. The reviewer re-ran the chain with the §2.2 prominence and the final extents: 40,280 crowns, decoded 241,680 B, **deflate-raw level 9 (as `chunk-node.mjs` 32–38) 215,280 B**, 64 tiles, max 1,033 per tile, ~724 B of header each → **≈ 266 KB encoded**. The residual stand field re-encoded through `tileStandField/encodeStandField/writeChunk` measured **264,217 B** (today's 548,251 reproduces as 547,958 by the same method). Net vegetation per v2 visit ≈ 176,823 + 264,217 + 266,480 ≈ **707 KB against 725,074 B today** — the visit gets SMALLER. These are working estimates until the compile writes the real numbers into `stands.crowns.encodedBytes` and `stands.encodedBytes`; the gates in §7 are set from them so that they can fail: `loaded.bytes ≤ 760,000`, `graph encodedStandBytes ≤ 300,000`, `graph encodedCrownBytes ≤ 280,000`. (If the residual rule were silently not applied the visit would be ~991 KB — a 1 MB gate would pass it, which is why the 1 MB gate is gone.) The hidden cost is **64 more chunk fetches per visit** at `maxConcurrent 6`: record `V3D.perf().spans` entry `'v2 vegetation: wait for chunk load'` before and after on the RTX 3070 (via `boot-profile --frames`, which prints spans) and gate it in the baseline at ≤ 1.5 × the pre-change value + 200 ms. Delta-coding the sorted cell index (mean gap ~63 cells) would cut roughly a third and is deferred to a `stand-crown-*-v2` format.

## 4. The compiler

`compile-vegetation.mjs`: bump `VEGETATION_COMPILER_VERSION` to 3; `MACHINE_REVIEW_RULES` stays v1 (approval untouched). New option `publishStandCrowns = true` on `compileVegetation` (the test turns it off, §4.7).

1. **`crown-detect.mjs`**: new `standCrownExtents(detection, heights, crowns, maxima, { extentFraction, minimumHeightMetres, maximumRadiusMetres, excludeMask, ownership })` — the identical BFS to `crownExtents` 358–389 run for `representation === 'stand'` crowns into a SEPARATE `Int32Array standExtentLabels` (never into the individuals' raster), returning per crown `{ crownId, extentCells, extentRadiusMetres, radiusMetres: max(extentRadius, equivalentRadius), extentProminenceMetres }` with prominence per §2.2 computed over `heights` (the filled raster). Factor the BFS body into a shared helper so the two functions cannot drift; `crownExtents`' behaviour and output for individuals are unchanged (a test asserts the individuals' `extentLabels` raster is byte-identical with and without the stand pass). `deriveCrownCandidates` (409–422) returns `standExtentLabels` and `standExtents`.
2. **Campaign loop (268–307)**: key and zone fallbacks per §2.4; a crown is a `publishedCrown` when `representation === 'stand'` (post-exclusion) and `apex.heightMetres ≥ 3`; keep `campaignFields[].standExtentLabels` and `crownsById` (319).
3. **Seam rule (§2.3)** across `campaignFields`, after eligibility (records known): bucket record centroids and published apexes by 4 m cell, drop per the four rules, collect `seamDuplicatesDropped` with the pairs (apex, other, distance) into evidence.
4. **Residual rule (issue 2 — corrected).** The labels handed to `compileStandChunks` (388–394) are a NEW `Int32Array(n).fill(−1)` per campaign:
   ```
   for (i) {
     if (individualExtents[i] >= 0) labels[i] = individualExtents[i];
     else if (standExtentLabels[i] >= 0 && publishedCrownIds.has(standExtentLabels[i])) labels[i] = standExtentLabels[i];
     // else stays -1: unclaimed, and still canopy for the field
   }
   ```
   (`tileStandField` line 154 treats `>= 0` as claimed, so a boolean union would claim EVERY cell and empty the field — the residual would plant 0, not ~2,850.) `publishedCrownIds` includes seam-dropped crowns (their cells are explained, §2.3 rule 4) and excludes unpublished ones (apex < 3 m or excluded), whose cells stay in the field. Unit test: an unclaimed cell stays −1 and counts as canopy; a published crown's cell is skipped; an unpublished crown's cell is not.
5. **`compileStandCrownChunks({ groundId, tiles, crowns })`** (new, in `stand-fields.mjs` or a sibling `stand-crown-chunks.mjs`): assign each crown by apex to the lod-0 tile whose bounds contain it (`assignRecordsToTiles` pattern, object-compiler.mjs 86–99; throw on any outside); `column = round(apex.easting − bounds.minEasting − 0.5)`, `row = round(bounds.maxNorthing − apex.northing − 0.5)` (assert the round-trip reproduces the apex exactly — the raster origin coincides with `l0/0/0`); sort by (row, column); `encodeStandCrowns`; `writeChunk` with header `{ schemaVersion: 2, id: tile.id, kind: 'crowns', owner: { type: 'ground', id: groundId }, bounds: tile.bounds, payloadFormat: 'stand-crown-u8-v1', requiredFeatures: ['chunk-envelope-v2', 'stand-crown-u8-v1'], standCrowns }`; `assetReferenceForChunk(chunk, { kind: 'crowns', directory: \`grounds/${groundId}/crowns\` })`; inspect. No chunk for a tile with zero crowns (all 64 have ≥ 10 today).
6. **Evidence** (403–429): `stands.crowns = { tiles, count, encodedBytes, decodedBytes, byCampaign, byZoneApex, absorbed, droppedBelow3m, seamDuplicatesDropped, extentRadiusP50, prominenceP50, records: 0, note: 'rendering payload of measured canopy apexes; not registry records' }`; `candidates.byZone` now reflects the apex fallback.
7. **`writeCompilation`** (462–493): `crowns/<sha>.bvch` + `crown-layers.json` (tile id → reference); candidates gain `extentRadiusMetres`, `extentProminenceMetres`, `published: true|false`, `seamDropped: true|false`.
8. **`--previous` block rule (issues 1/11).** When `--previous` is given, the CLI refuses to write (exit 1, message naming the counts) unless `diff.changed === 0 && diff.moved === 0 && identity.added === 0 && identity.missing === 0` — or `--allow-registry-change` is passed for a declared registry change. State the rule in the file header: **byte-identity of records is claimable only when `observedOn` equals the previous compile's**, because `captureAgeYears` (265) → recency (weight 0.5/9) → `confidence` rounded to 3 decimals is written into every record (384) and compared by `registryDiff` (111); one day shifts every composite by −1.52e-5, flipping ~1.5 % of the 3,502 rounded values, and three approved individuals sit at exactly 0.600 against the 0.6 threshold (verified: 3). If a new `observedOn` is ever wanted, drop or freeze the recency term as a separate, declared registry change.
9. **Tests.** `compile-vegetation.node-test.mjs` (168–178 pattern): (a) compile the synthetic rasters twice with the same `observedOn`, `publishStandCrowns` true and false → `registryDiff(a.records, b.records)` has `changed/moved/added/removed` all empty AND `a.compiled.chunks[i].reference.sha256 === b.compiled.chunks[i].reference.sha256` for every object chunk (byte-identity, not equality of summaries); (b) every crown chunk round-trips through `readChunk` and `inspectStandCrownPayload`; (c) a synthetic stand crown's extent equals its Voronoi cells and its prominence equals apex − mean(outer ring); (d) `crown-layers.json` written; (e) residual labels per item 4; (f) a synthetic seam pair at 2 m drops the older campaign's crown and both extents leave the field; (g) duplicate candidate keys throw, and a null-centroid crown is keyed by its apex. `vegetation.node-test.mjs` (crownExtents tests 145–210): stand extents never claim an individual's cell; the individuals' raster is unchanged by the stand pass.

`publish-vegetation.mjs`: `assembleVegetationGraph` (28–105) grows `crownLayers = {}`; tile layers (60–65) add `crowns: crownLayers[tile.id] ?? (replaceExistingLayers ? null : tile.layers.crowns ?? null)`; supplied-check loop (69) add `'crowns'`; CLI (142–147) read `crown-layers.json` / `crowns/`; report (158–159) `crownTiles`; and the CLI writes its stdout report to `<compileDir>/publish-report.json` as well (used by §6's evidence tool). `publish-vegetation.node-test.mjs` (14–90 pattern) attaches a crown layer and re-verifies.

## 5. The runtime

`apps/golf/src/engine/v2-vegetation.mjs` (`V2_VEGETATION_VERSION` → 2):

- `loadV2Vegetation` (99–102): add `if (tile.layers.crowns) jobs.push({ tile, kind: 'crowns', reference: tile.layers.crowns })`; decode branch (121–126): `entry.crowns = decodeStandCrowns(verified.payload, verified.header.standCrowns)` (the `entry` initialiser gains `crowns: null`); `counts` add `referencedCrownTiles`, `crowns` (sum of `count`).
- `createCoverage` (149): `tile.objects || tile.stands || tile.crowns`.
- `planV2Vegetation`: new options `holeDistanceAt = () => Infinity`, `crownPlanting = { drawFloorRadius: 1.2, lowQualityKeepMetres: 300 }`. Before the field loop, for each crown k of `tile.crowns`: `easting = bounds.minEasting + (column[k] + 0.5)·cellMetres`, `northing = bounds.maxNorthing − (row[k] + 0.5)·cellMetres`; `[x, z] = mapper.toWorld(easting, northing)`; `y = groundHeightAt(x, z)` (non-finite → `crownsDropped++`, continue); `ce = round(easting), cn = round(northing)`; if `lowQuality && holeDistanceAt(x, z) >= 300 && hash01(ce, cn, 7) > planting.lowQualityKeep` → `lowQualityThinned++`, continue; push `{ x, y, z, height: height[k], radius: max(radius[k], 1.2) /* draw floor, not a data change */, rotation: hash01(ce, cn, 21)·2π, species: chooseSpecies(hash01(ce, cn, 22), shoreDistanceAt(x, z)), kind: 'crown', id: null }` — **`shoreDistanceAt(x, z)`, the value, exactly as lines 233 and 273 do** (issue 3; passing the function makes `shoreDistance < 28` false forever and silently kills shore birch for 40k crowns). Record into the plan's crown table: `crownX/crownY/crownZ: Float32Array`, `crownHeight/crownRadius: Float32Array`, `crownSpecies: Int8Array`, `crownPlanted: Uint8Array` (1 planted, 0 thinned/dropped), sized `counts.crowns`. Stats add `crowns`, `crownsDropped`, `lowQualityThinned`. The field loop is unchanged and now plants the residual.
- LOWQ expectation (unmeasured, stated as such): ≈ 15,944 zone-A/B crowns within 300 m of a hole line kept + 0.55 × ~24,400 ≈ 29.4k on a phone.
- **main.js** (by identifier): `const WHY_FOREST_RING = 1, …, WHY_V2_STAND = 6;` → append `, WHY_V2_CROWN = 7`; `const LEGACY_TREE_REASONS = [...]` → append `'v2Crown'`; the push `treeWhy[t.species].push(t.kind === 'individual' ? WHY_V2_INDIVIDUAL : WHY_V2_STAND)` → `… : t.kind === 'crown' ? WHY_V2_CROWN : WHY_V2_STAND`; the `planV2Vegetation(...)` call gains `holeDistanceAt: (x, z) => { let b = Infinity; for (const h of HOLES) b = Math.min(b, distToLine(x, z, h.line, 320)); return b; }` (`distToLineIndexed` with a cutoff; exact below it, which is all a `< 300` test needs); `V2_VEGETATION_LOADING` and `v2Objects` per §3.1. `legacyInsideCoverage` (`W[k] < WHY_V2_INDIVIDUAL`) and the LOD size rule (`W[k] >= WHY_V2_INDIVIDUAL ? 1 : …`) remain correct for 7 without edits. No LOD change: crowns are ordinary instances in the (species, part, tier) meshes.
- **New export `V3D.v2Crowns({ every = 1 } = {})`** beside `v2Objects` (issue 16): returns `{ count, planted, rows: [[x2, z2, heightScale3, species, planted]] }` for every `every`-th crown, where `x2 = +x.toFixed(2)`, `z2 = +z.toFixed(2)`, `heightScale3 = +(height / SPECIES[species].templateHeight).toFixed(3)` — the SAME roundings `legacyTreeExport` applies to instances, so a planted crown's row string-matches its instance exactly.
- `v2-vegetation.test.mjs`: fixture (23–44 pattern) adds a `crowns` chunk to tile B with three crowns, one within 28 m of a fixture shore; assert one instance per crown at the decoded cell centre, `height`/`radius` from the payload (radius floored at 1.2), `kind: 'crown'`, `id: null`, `species === birch` for the shore crown when its hash draws < 0.7 (construct the position so it does), determinism across two plans, `lowQuality` never plants more and `crowns === planted + lowQualityThinned + crownsDropped`.

## 6. Evidence and the freeze test (issue 6)

New `tools/write-vegetation-evidence.mjs --slug puttom --compile <dir> [--previous-course <url> --previous-ground <url>]`: builds `geo_data/course-v2/<slug>/vegetation/vegetation-evidence.json` by MERGING, keeping the committed file's key set (`schemaVersion, groundId, observedOn, state, note, inputs, compile, candidateSummary, harness, publish`): `compile` ← the compiler's `evidence.json` verbatim; `observedOn` ← `compile.observedOn`; `inputs` ← the paths as today (candidates file with its size, rasters directory, canopy evidence); `candidateSummary` ← recomputed from `candidates.json` with the same aggregation the current file shows (open it and match its keys); `publish` ← sha256 of the live `courses/v2-index.json`, the root entry's `manifest.sha256`, the course's `groundManifest.sha256`, plus the `previous*` urls passed in; `harness` ← path of the latest `phase4-vegetation.json`; written with LF. A plain `cp` of the compiler's evidence would drop `compile.review` and the freeze test would throw.

`packages/course-v2/puttom-vegetation-freeze.node-test.mjs`: test 1 (36–51) add `withCrowns.length === 64`, `requiredFeatures.includes('stand-crown-u8-v1')`, crowns on lod-0 only; test 2 (65–69) loop add `'crowns'`, `verification.chunks >= 64·3 + 2`; test 3 (72–76) add `evidence.compile.stands.crowns.count > 40000`, `.records === 0`, `.seamDuplicatesDropped >= 0`, `evidence.compile.records.records === evidence.compile.identity.matched + evidence.compile.identity.added`, `evidence.compile.identity.missing === 0`, and for THIS generation `evidence.compile.identity.matched === 3502 && added === 0` (the file says it is "the place to change when the next generation is published").

## 7. Gates

**Before the change (issue 14)** — on the branch head this lands on, record: `node tools/vegetation-baseline.mjs http://127.0.0.1:8620 --course puttom --label v2 --shots` and `BANVY_GPU=1 node tools/boot-profile.mjs --fingerprint --frames`; keep both outputs in the commit. Every expectation below is derived from that run, not from this document. Today's committed run: trees 79,407; legacy reasons forestRing 12,879 / satellite 6,766 / shore 19 / scrubRing 0; `v2Stand` 56,241; bytes 725,074.

**`tools/vegetation-baseline.mjs`** (gates at 111–124; issue 8): read expectations from `geo_data/course-v2/${SLUG}/vegetation/vegetation-evidence.json` — `EXPECT.records = compile.records.records`, `EXPECT.crowns = compile.stands.crowns?.count ?? 0` — and byte budgets from a per-course table in the tool, `BYTE_BUDGET = { puttom: { vegetation: 760_000, stands: 300_000, crowns: 280_000 } }` (a course without an entry gets no byte gate and says so). Gates:
- `loaded.loadedTiles >= max(referencedObjectTiles, referencedStandTiles, referencedCrownTiles)`;
- `planned.individuals === EXPECT.records`;
- `planned.crowns + planned.lowQualityThinned + planned.crownsDropped === loaded.crowns` (holds at any quality because thinned crowns are counted; issue 16), `planned.crownsDropped === 0`, and `planned.lowQualityThinned === 0` — if the last fails the machine was auto-detected as constrained (`LOWQ` from `deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4`, main.js [1129–1132]); re-run with `&q=hi` added to the v2 mode's search;
- `planned.standTrees` in `[1500, 6000]` (measured range 2,850–3,867), reported with its value;
- **position gate**: `V3D.v2Crowns({ every: 5 })` rows with `planted === 1` each string-match an instance from `V3D.legacyTrees({ instances: true })` with `why === 7` on `(x2, z2)`, with equal `heightScale3` and `species`; and the count of `why === 7` instances `=== planned.crowns`;
- `report.trees.reasons.forestRing/satellite/shore/scrubRing` EXACTLY equal the pre-change run's (the coverage is the same 64 tiles, so the lattice cut-out is unchanged — this is the placement-invariance gate for the legacy population);
- `report.trees.reasons.v2Individual === EXPECT.records`, `v2Crown === planned.crowns`, `v2Stand === planned.standTrees`;
- `legacyInsideCoverage === 0`; base p95 ≤ 0.5 unchanged;
- `loaded.bytes ≤ BYTE_BUDGET.vegetation`, `objects.graphEncodedStandBytes ≤ BYTE_BUDGET.stands`, `graphEncodedCrownBytes ≤ BYTE_BUDGET.crowns`;
- the `'v2 vegetation: wait for chunk load'` span from `V3D.perf().spans` ≤ 1.5 × pre-change + 200 ms (real GPU runs only; recorded always).
Expected total ≈ 19,664 + 3,502 + ~40,300 + 2,850–3,900 ≈ **66.3k–67.4k trees** (was 79,407); draws unchanged from the pre-change run.

**`tools/check-app.mjs`** (236): `!(veg.reasons.v2Crown > 0)` on the plain path.

**`tools/check-crowns.mjs`** (new, offline, exits non-zero; issues 5, 12, 17). Inputs `--ground puttom --rasters $C` and either `--compile <dir>` (crown-layers.json + crowns/) or `--published` (walk root → course → ground). It: decodes every crown chunk through `readChunk`/`inspectStandCrownPayload`; maps each cell to `(easting, northing)`; picks the campaign raster by bit0 and asserts the flag agrees with the seam side (`northing > 7025000` ⇔ north); reads the RAW cached CHM at `column = floor(easting − originEasting)`, `row = floor(originNorthing − northing)` and asserts `|height − chm| ≤ 0.125 + 1e-6` for 100 % of non-NaN cells (NaN = a filled void; count them, ≤ 1 %); **rasterises exclusions itself** with `courseExclusionFeatures(geometry)` and `rasterizeExclusions(raster, features)` from `vegetation/semantic-exclusions.mjs` over `geo_data/course-v2/puttom/migration/course-model.epsg3006.json` (deterministic, seconds; the cache holds no exclusion raster) and asserts `mask[apexIndex] === 0`; asserts no two crowns ground-wide with strict `d < 2` (today's minimum is exactly 2.000 m across campaigns and √10 within, so `<= 2` would fail on day one) and no cross-campaign pair with `d < 3` (the seam rule), printing the measured minima in its messages; asserts `count === evidence.compile.stands.crowns.count`; asserts the header grid equals the derived grid.

**`render-review.mjs`** (107–113 draws stand crowns at the CENTROID — null for 25,697, so none is drawn today) grows `--crowns <crown-layers.json|compile dir>`: amber circles at extent radius centred on each decoded apex, whole ground at 2 m and hole crops at 1 m; the existing centroid dots stay for candidates. Review material, not proof.

**Build gates**: `pnpm test` (vitest + the node tests incl. the new module and the freeze test), `cd apps/golf && npx vite build`, `node packages/course-v2/check-app-build.mjs` (closure walk, precache list, `_headers` rules incl. the two new ones, tile-layer walk incl. `crowns`).

## 8. Publishing (exact sequence — Git Bash; PowerShell forms where they differ)

```
C=packages/course-geo/toolchain/.cache/acquisition/puttom-vegetation          # PowerShell: $C='packages/…/puttom-vegetation'
node packages/course-v2/vegetation/compile-vegetation.mjs --ground puttom --observed-on 2026-09-02 \
  --out $C/compile-machine-v3 --machine-review --previous $C/compile-machine/registry.json \
  --raster 26f015-702_69=$C/chm-26f015-702-69.f32:$C/chm-26f015-702-69.json \
  --raster 23f028-702_69=$C/chm-23f028-702-69.f32:$C/chm-23f028-702-69.json
#   --observed-on is the PUBLISHED generation's date (compile-machine/evidence.json line 4), reused on purpose so every
#   record's rounded confidence is unchanged; expect identity matched 3502 / added 0 / missing 0, diff changed 0 / moved 0
#   (the CLI refuses to write otherwise), records 3502, stands.crowns.count ≈ 40,300, seamDuplicatesDropped ≈ 25
cmp <(ls $C/compile-machine/objects | sort) <(ls $C/compile-machine-v3/objects | sort)   # identical content-addressed object chunks
node tools/check-crowns.mjs --ground puttom --rasters $C --compile $C/compile-machine-v3
node packages/course-v2/vegetation/render-review.mjs --ground puttom --rasters $C --candidates $C/compile-machine-v3/candidates.json --crowns $C/compile-machine-v3/crown-layers.json
node packages/course-v2/vegetation/publish-vegetation.mjs --ground puttom --slug puttom --compile $C/compile-machine-v3
#   writes new ground/course manifests + root (emit-ground-graph-node writeGroundGraphFiles, line 352); object and unchanged
#   chunks land on their old content-addressed names; publish-report.json lands in the compile dir
node packages/course-v2/prune-generations.mjs --slug puttom --also courses/puttom/course-v2-0d6eef4e2f5fd2a2ce0220d9e780a592ded9e4d9ea533a14b63b27672d378866.json
#   dry run first; then --apply; keeps the prior generation for rollback (the freeze test asserts ≥ 2 ground manifests)
node tools/write-vegetation-evidence.mjs --slug puttom --compile $C/compile-machine-v3 \
  --previous-course courses/puttom/course-v2-0d6eef4e….json --previous-ground grounds/puttom/ground-v2-03ede20e….json
node packages/course-geo/check-manifests.mjs      # CRLF trap: geo_data/**/*.json is eol=lf in .gitattributes; on a CRLF checkout trust CI or `git add --renormalize`
pnpm test && node --test packages/course-v2/puttom-vegetation-freeze.node-test.mjs
(cd apps/golf && npx vite build) && node packages/course-v2/check-app-build.mjs
node tools/serve.mjs apps/golf/dist 8620 &                                   # PowerShell: Start-Process node -ArgumentList 'tools/serve.mjs','apps/golf/dist','8620'
BANVY_GPU=1 node tools/vegetation-baseline.mjs http://127.0.0.1:8620 --course puttom --label v2 --shots     # PowerShell: $env:BANVY_GPU='1'; node tools/vegetation-baseline.mjs …
node tools/check-app.mjs
BANVY_GPU=1 node tools/boot-profile.mjs --fingerprint --frames               # record the post-change fingerprint beside the pre-change one
node tools/tree-lod-ab.mjs 8620 crowns && <re-capture the six-view goldens per docs/tree-lod-plan.md>
```
**Deploy consequence (issue 18).** `emit-ground-graph-node` derives the ground's and course's `requiredFeatures` from every layer reference (218, 255) and `assertManifestGraph` (manifest-loader.mjs 41–55) checks them against `V2_SUPPORTED_FEATURES`; the manifest is `no-cache` while assets are immutable and service-worker-precached. A deployed client whose assets predate `stand-crown-u8-v1` therefore refuses the whole new ground — fallback to GPK1 under `?v2=1`, boot error under `?v2=require` — until its assets update. This is the opt-in path only and the same shape as the stand-field rollout; say so in the checkpoint and the commit.

## 9. The visual claim, and what proves it

- **Moves:** every one of the 56,241 hashed stand trees disappears; ≈ 40,300 crowns appear at measured apexes with measured heights and Voronoi extents; ~2,850–3,900 hashed residual trees remain only where no apex explains the canopy. Canopy coverage is preserved by construction; stem count is not a claim (closed stands hold 600–1,200 stems/ha; the laser resolves ~180/ha of dominant tops).
- **Stays:** 3,502 identical records (identical object chunk names), the 19,664 legacy trees outside coverage (identical reason counts), vista impostors, everything else.
- **Proof (gates):** `check-crowns.mjs` (data ↔ raster, exclusions, spacing, seam); the compiler test (records byte-identical with the crown pass on/off); the baseline's position gate (each sampled crown has an instance at its decoded cell, with its payload height and species) plus the legacy-reason equality and the accounting identity; the freeze test.
- **Review material (not proof):** the `--crowns` overlay, the hole-7 top view with trees hidden/shown (`V3D.setMeshesVisible`), and a stand-edge eye view on the RTX 3070 — the owner must look at a closed stand before merging, because 25,697 absorbed apexes now stand at full measured height inside what was one taller neighbour's segment.
- Docs: CLAUDE.md's Puttom vegetation section and the plan's checkpoint (docs/puttom-v2-lidar-tree-placement-plan.md 23–222) gain the labelled numbers, the `observedOn` reuse rule, the seam rule, the deploy consequence and the pre/post fingerprints; the plan's "stand crowns are never records" (133) stays true and now names the payload; the checkpoint's stale "92,681 trees / 32,938 legacy outside" (157–158) is corrected to the committed 79,407 / 19,664.

## 10. Review ledger — what each issue changed

| # | verdict | where |
|---|---|---|
| 1, 11 | accepted; `--observed-on 2026-09-02` reused, block rule `changed === moved === added === missing === 0` enforced by the CLI, byte-identity test on object chunk sha256s; 3 individuals at exactly 0.600 verified | §4.8, §4.9a, §8 |
| 2 | accepted; Int32Array of crown ids, −1 unclaimed; unit test | §4.4 |
| 3 | accepted; `shoreDistanceAt(x, z)`; shore-birch test | §5 |
| 4 | accepted; main.js anchored by identifier, commit stated | §0 |
| 5 | accepted; strict `d < 2`, `≤ 0.125 + 1e-6`, minima printed | §7 |
| 6 | accepted; `tools/write-vegetation-evidence.mjs` merges, freeze test derived from it | §6 |
| 7 | **review partly wrong on the failure mode**: no `stand-field-*.js` exists in dist and the precache list never named it, so the stated failure cannot occur; the line is kept as defensive and the real gate is the closure walk | §3.1 |
| 8 | accepted; expectations from evidence, byte budgets per course | §7 |
| 9 | accepted; apex key when the centroid is null, uniqueness asserted | §2.4 |
| 10 | accepted; Git Bash labelled + PowerShell forms; grid derived and refused > 256 | §0, §3, §8 |
| 12 | accepted; seam rule; measured 25 pairs < 3 m on the published population (review counted 22 on a different one) | §2.3, §4.3 |
| 13 | accepted; sizes restated from the reviewer's re-run (215,280 B / 264,217 B / ~707 KB), revision 1's 188,836 explained (candidates' prominence), gates that can fail, fetch-span gate | §3.2, §7 |
| 14 | accepted; 79,407 / 19,664 baseline, expectations derived from a pre-change run, residual as a range | §1, §7 |
| 15 | accepted; own branch after the LOD merge, fingerprints and goldens re-captured together | §0 |
| 16 | accepted; `V3D.v2Crowns()` position gate, identity restated with the thinned count | §5, §7 |
| 17 | accepted; exclusions rasterised from the course model | §7 |
| 18 | accepted; deploy consequence stated; every table labelled by population | §2, §8 |

