# Ribbingsfors facilities runtime audit

Audited 2026-09-10. Read-only application/source audit; Blender was not contacted. No applicable `AGENTS.md` was found in the repository or checked ancestor directories. The files created by this audit are reference exports only.

## Current rendering and gaps

`apps/golf/src/engine/scenery/ribbingsfors.js` exports only a clubhouse appearance specification: pale yellow timber, red-orange gable roof, one window row and terrace. There is no Ribbingsfors authored architecture loader or asset. The shared procedural building renderer uses `b.h` before the clubhouse default, so the present clubhouse wall estimate is **4.2 m**, despite its appearance module specifying 3.8 m. Window counts, exact facade arrangement, chimney and deck arrangement are generic.

The retained model has 44 near-building records, of which 11 are course facilities: clubhouse, supposed northern annex, six farm roofs east of the clubhouse, and three maintenance sheds southwest of hole 5. All are provisional flat footprint/height estimates, without measured eaves or ridge surfaces. Manor house and wings are absent from both `infra.buildings` and `infra.farB`; the manor exists only as a residential precinct/vegetation exclusion polygon. The new orthophoto review must establish missing roofs and whether the supposed annex is a real structure or shadow.

| Legacy feature | Runtime center (x,z), metres | Approximate legacy plan, metres | Ground anchor RH2000, m |
|---|---|---|---:|
| Clubhouse | 479, -456.5 | 17 × 8.5 | 77.230 |
| Supposed annex, needs new-image review | 478.7, -464.5 | 15 × 9 | 76.858 |
| Farm roof 0 | 729.9, -493.8 | 36.9 × 19 | 80.681 |
| Farm roof 1 | 752, -469.6 | 26.6 × 7.8 | 80.020 |
| Farm roof 2 | 715.3, -476.4 | 10.8 × 14.2 | 79.655 |
| Farm roof 3 | 718.9, -463.9 | 24.5 × 7 | 80.808 |
| Farm roof 4 | 758.6, -458.9 | 19.4 × 10.7 | 78.310 |
| Farm roof 5 | 714.4, -456.4 | 30.6 × 22.5 | 80.702 |
| Maintenance hall | -352, 160 | 15 × 28 | 81.590 |
| Maintenance shed 1 | -361, 196 | 8 × 18 | 80.650 |
| Maintenance shed 2 | -350, 228 | 9 × 13 | 80.630 |

Ground varies substantially around some footprints. The clubhouse corners span 76.353–77.294 m RH2000, so a flat floor needs a foundation that reaches the terrain. Ground elevations describe the land surface, **not roof height**.

The owner-corrected driving range is the pasture **east of hole 1**, approximately 40,163 m², bounded by runtime x504–715/z−432…−172. The previous strip between holes 9 and 1 was a hayfield misidentified as a range. Do not restore `range.sourceRing`: it is explicitly deprecated history. Both runtime `rangeTee` and `rangeFacilities` are null. A raw bench candidate `[600.5,-446.2]` in `practice-traces.json` was rejected in reviewed `surroundings-traces.json`, because the pasture was too uniformly flat to isolate a tee platform.

The engine presently infers target flags from whichever range edge is nearest the clubhouse. It draws no mat strip or range net while `rangeFacilities` is null. The code comment claiming measured Ribbingsfors bays at the south end is stale. The retained putting green is a circular approximation around `[510.4,-451.3]`, radius 13.9 m, with ground 77.775 m RH2000. Its detected area was 604 m², but this does not make the circle a measured boundary. The coarse gravel parking polygon is centered `[708.5,-418]`, ground 79.755 m.

## Coordinate and terrain contract

- Source horizontal CRS: EPSG:3006. Height datum: RH2000.
- Frozen origin: **E448975.5, N6536024.5**.
- Runtime: `x = E - 448975.5`, `z = 6536024.5 - N`, `y = heightRH2000`.
- Blender: `X = E - 448975.5`, `Y = N - 6536024.5`, `Z = heightRH2000`.
- Runtime-to-Blender: `[x, z, H] → [x, -z, H]`; default Blender glTF Y-up export naturally produces runtime `[x,H,z]`.
- No horizontal rotation, fitted scale or height-datum correction belongs here. The stored canonical origin height 69.14 m is **not** subtracted from authored elevations.

The distinction is explicit in `apps/golf/src/engine/v2-graph-frontier.mjs::identityBridge`: terrain tile vertices internally store `H - originHeight`, but the terrain group's bridge has `translateY = originHeight` and `verticalDatumOffsetMetres = 0`. The scene therefore receives `H`. `v2-puttom-preview.mjs::bridgeTerrainResources` likewise adds that bridge translation to `heightOffsetWorld`. An orthophoto manifest copied from the internal v2 tile frame must not apply the subtraction to independently authored facilities.

`ribbingsforsbuild/laser-lib.mjs::loadTerrain()` decodes the published 64 level-0 terrain tiles at 1 m. `hAt(x,z)` bilinearly samples authoritative terrain in absolute RH2000. These tiles span local ±1024 m, with a finite-interpolation limit at the last row/column. `cache/terrain-fine.bin` is also 2049 × 2049 little-endian float32 at 1 m; its pixel centers run E447951.5…449999.5 and N6537048.5…6535000.5. `heightfields.json.hf0` is a coarser, quantized 4 m compatibility field and was not used for the new exports.

`reference/facility-ground.json` contains two 1 m source-ground grids and per-building anchors. See `reference/ground-sampling.md` for compact access examples. `reference/legacy-facilities.json` retains source rings, Blender XY rings, dimensions, bounds, ground samples, facility context and source hashes. Regenerate with `node ribbingsforsbuild/facilities/export-legacy-facilities.mjs`; no source model or application files are mutated.

## Reusable Blender and later runtime integration

The closest complete workflow is `visbybuild/facilities/build_blender_scene.py`, `model_primitives.py`, and `export_and_render.py`: separate generated scene, material-batched editable geometry, packed reference panels on source terrain, per-facility parent nodes, source IDs and separate architecture-only GLB export. It preserves unrelated scenes. The `angsobuild`, `puttombuild`, `lidingobuild` and `nvgkbuild` workspaces also contain source-ground/orthophoto packaging and independent saved-file audits.

For any later application integration, the existing hook is `SCENERY.loadFacilities(context)` in `apps/golf/src/main.js`. Context supplies Three.js, scene, source buildings, parking, terrain sampler, terrain mode and datum offset. A successful loader returns `report`, `replacedBuildingIds`, optional `facilityFootprints` and `dispose`; only validated replacement IDs are skipped in the generic building batch. Failure retains the source approximation. `loadFacilitiesBeforeSurfaces = true` supports corrected footprint exclusions before parking and vegetation are emitted. `replacesRangeFacilities` suppresses the generic traced mats/net pass; it does **not** suppress the independent inferred target flag pass, which needs explicit consideration if authored targets are added.

The Visby GLB manifest/loader is a suitable reference for this exact grid frame: validate course identity/origin/axes, hash and byte count, static geometry, per-facility parent/source identity, finite bounds and ground placement; apply height bridge exactly once. Lidingö/Puttom examples additionally support corrected footprints, range replacement, disposal and vegetation exclusion. Norrfällsviken demonstrates a mesh-JSON path, but its legacy horizontal bridge must not be copied into Ribbingsfors.

Changing the *runtime range polygon* also changes play bounds and therefore the retained CORE cutout contract in `v2-ribbingsfors-config.mjs`; this requires corresponding ground-frontier verification. Creating Blender references/models does not require changing that runtime contract.
