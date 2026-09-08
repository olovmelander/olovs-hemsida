# Lidingö measured canopy intake

The actual Lantmäteriet `21c031-658_67` point cloud (capture 2021-03-23) was
read in 64 bounded 256 m windows with 64 m halos. The reader transferred
99,116,447 bytes in 563 range requests. Its complete hierarchy matches the
217,740,127-point LAS header, and every decoded node matches its advertised
point count. The full 1.35 GB asset was not downloaded; its catalogue checksum,
ETag and size are pinned, but a full-asset SHA verification is not claimed.

[`canopy-evidence.json`](canopy-evidence.json) records 11,677,559 non-noise
interior returns across 4,194,304 one-square-metre cells. Pulse density is
1.240/m²; 11.7% of cells remain unmeasured; 59.8% of measured cells have canopy
at least 2 m high. Per-tile cloud-ground comparisons against the retained DTM
are diagnostics from related source families, not independent survey accuracy.

The four raw Float32 rasters and sidecars live under the ignored
`lidingobuild/cache/vegetation/` directory:

- `chm-21c031-658_67`: canopy height above the cloud's own class 2/9 ground.
- `ground-21c031-658_67`: cloud-ground elevation in RH 2000.
- `allReturns-21c031-658_67` and `firstReturns-21c031-658_67`: counted returns.

Each raster is 2,048 × 2,048 at 1 m spacing. Its northwest **pixel edge** is
E 676676.5, N 6587423.5; cells are centred 0.5 m east/south of that edge.
This is the same 2,048 m terrain extent, whose DTM has 2,049 edge-inclusive
**sample centres**. The frame fingerprint comes from the provisional terrain
preview; the approved canonical origin remains a separate control gate.

The stand compiler produces standard `stand-field-u8-v1` chunks at 4 m spacing
for all 64 finest terrain tiles. It applies current playing-surface candidates,
retained OSM context and clipped Lantmäteriet water as exclusion inputs, keeping
polygon holes and documenting exclusion buffers. It removes negative/non-finite
canopy, unknown cloud ground, and cells below the local 0 m RH 2000 vegetation
selection threshold. Negative RH 2000 terrain itself remains valid; this is a
conservative planting rule near the sea. No individual tree records are emitted.

[`stand-evidence.json`](stand-evidence.json) records the actual generation,
input hashes and uncertainties. Its stage is
`lidingobuild/cache/vegetation/stands-stage/layer-index.json`.
`attachLidingoStands(compilation, frame)` verifies all source hashes, frame,
tile bounds, ownership and chunk bytes before returning a compilation with
`tile.layers.stands` and merged resources. A changed surface/water source fails
until the stand compiler is explicitly rerun.

Rebuild and inspect from the repository root:

```powershell
node --env-file=.env packages/course-geo/copc-reader/build-lidingo-canopy.mjs
node packages/course-v2/vegetation/compile-lidingo-stands.mjs
node packages/course-v2/vegetation/review-lidingo-stands.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/lidingo/vegetation/render-stand-source-review.py
```

The first command reacquires measured source windows; the others operate on
retained files. Source review checks every eligible stand-cell centre against
building footprints and road/path centre-line corridors using independent
point-in-polygon/distance calculations. The final 90-polygon playing-surface
generation checked 163,326 eligible cells against 889 protected features,
with no footprint or centre-line hits. Its dated result and exact stage hash are in
[`stand-source-review.json`](stand-source-review.json); rerun it after changing
the stage. The comparison panels remain in the local cache at
`lidingobuild/cache/vegetation/review/stand-source-panels.png`.

Three source panels were inspected: clubhouse/range, western housing/fairways,
and eastern forest/road. Dense canopy follows visible forest, and the mapped
buildings and street corridors remain clear. Final fairway exclusions were
regenerated with the normalized source IDs. A few isolated low-canopy cells
remain outside those mapped surfaces and need current imagery/site review.
The 2019 orthophoto cannot confirm 2021-to-2026 tree changes.
Stand-cell centres and rendered representatives are not surveyed stem positions.

Targeted tests:

```powershell
node --test packages/course-geo/copc-reader/lidingo-canopy.node-test.mjs packages/course-v2/vegetation/lidingo-stand-exclusions.node-test.mjs packages/course-v2/vegetation/lidingo-stand-source-gates.node-test.mjs
```
