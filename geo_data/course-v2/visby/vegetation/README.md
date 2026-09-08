# Visby measured vegetation and water evidence

The vegetation layer uses bounded reads of Lantmäteriet's 2024 laser campaign
`24e002`, with measured canopy fractions and heights at 4 m. It contains no
surveyed individual trees or species assignments. Runtime stand representatives
are a rendering policy, and their bases are sampled from the same terrain chunks
used by the course.

## Sources and coordinate contract

`build-canopy.mjs` pins the two COPC items `24e002-636_68` and
`24e002-637_68` to the sizes, SHA-256 values, point counts and extents recorded in
`../acquisition/d2-discovery.json`. Their STAC capture range is 2024-02-03 through
2024-04-28; this range does not establish the acquisition date of every return.
The source licence is CC BY 4.0, with Lantmäteriet attribution. Credentials remain
local and do not appear in evidence files.

All geometry uses SWEREF 99 TM, EPSG:3006, ordered `[easting, northing]`.
Vertical values use RH2000, EPSG:5613. The compound source CRS is EPSG:5845.
The retained terrain sample extent is
`[685700.5, 6368903.5, 689796.5, 6372999.5]`. The frame origin is
E687748.5, N6370951.5, H0.10, fingerprint
`d7631b5ee1a936044fc4f03d7ee13971438b65653cc23a4dd9676b563123f511`.
World Y is absolute RH2000 minus 0.10 m.

The raw terrain is 4097 by 4097 at 1 m, SHA-256
`deb6ce495470335a7778da55485ca63ec46386bdfd2bdf9d0a8ddf90a4e4e898`.
Canopy rasters contain 2048 by 2048 cells at 2 m over the same 4096 m square.
The canopy origin is a pixel edge; canopy cell centres are offset 1 m east and
1 m south of that origin. The terrain origin is a sample location. Those
different conventions are intentional.

## Canopy derivation

The acquisition uses 256 m processing tiles with a 64 m halo. The two source
extents are intersected before reading and use separate node caches. Half-open
source bounds prevent duplicate returns at N6370000. COPC hierarchy counts,
decoded node counts and retained checkpoint hashes are checked. Published
whole-file SHA-256 values identify the source assets; bounded reads do not
independently verify a whole-file hash. Response ETags and transfer totals are
retained in `canopy-evidence.json`.

Ground is the cell mean of LAS classes 2 and 9, with bounded nearest-ground
filling (60 m maximum) and a 3 by 3 smoothing kernel. Canopy is the highest
non-noise return above bilinearly interpolated local ground, capped at 40 m.
Classes 7 and 18 are excluded. Unknown cells remain unknown. The retained
Float32 rasters and their grid sidecars are in `visbybuild/cache/vegetation/`.

The completed bounded read contains 25,367,231 non-noise returns, including
17,797,783 first returns and 15,965,770 ground returns. Of 4,194,304 cells,
2,430,202 have measurements and 1,764,102 are void, largely over the sea. A void
is not interpreted as a measured absence of trees. See `canopy-evidence.json`
for exact per-tile values, output hashes and transfer accounting.

`compile-stands.mjs` aggregates these measurements into standard
`stand-field-u8-v1` chunks at 4 m and a 2 m canopy threshold. Playing surfaces,
buildings, roads, paths and water constrain eligibility. Polygon holes remain
holes. Source buffers are recorded by feature kind in `stand-evidence.json`.
A separate 4 m display guard protects jittered runtime representatives; it is
not an assertion about the physical width of any source feature. Actual runtime
placement review found seven incursions without that guard, and one with a
2 m guard. The 4 m guard cleared all retained source footprints in the reviewed
temporary build. Invalid canopy, unknown ground and cloud-ground below 0 m
RH2000 are also excluded conservatively from vegetation. Negative elevations
remain valid terrain.

The compiler records the exact bytes of every exclusion input, terrain staging
index and canopy raster. Publication attachment fails if those inputs change.
`surface-stage.geojson` is an explicitly temporary input selected only with
`--preliminary-surfaces`; the default is `playing-surfaces.geojson`. A final
surface change requires a new stand compile and review.

`build-practice-surfaces.py` adds a separate observed driving-range footprint in
`visbybuild/mapping/practice-surfaces.geojson`. The 18,586.375 m² polygon uses the
retained 2022 source pixels and excludes the adjacent practice fairway. Its
eastern edge detours around two visible trees. This file is a required,
hash-checked stand input. The resulting 1 m practice buffer plus the separate
4 m display guard clears isolated height returns within the field without
asserting whether those returns represent range structures or vegetation.
`practice-surface-evidence.json` links the source image, projected footprint and
review overlay.

## Water and context geometry

`clip-water.py` retains the authenticated national water break GeoPackages,
verified against `../reference/lm-retained-assets.json`, and clips them to the
terrain extent. `../mapping/water-breakgeometry-epsg3006.geojson` is the canonical
output: 25 features, 10 interior rings and two sea components. Inland Z values
are constant. Source sea Z varies, so `heightRH2000` is explicitly a
representative median (0.23 m), while the complete source-derived XYZ vertices
and Z ranges remain available. No bathymetry, present water level, water depth
or golf penalty-area status is inferred.

Sea association uses declared offshore points, corroborated against the retained
orthophoto. The source classification alone does not distinguish sea from ponds.
The canonical `properties.shoreline.lines` contains XYZ boundary chains with
segments on the AOI and source-item rectangles removed, including the N6370000
source seam. These are source water-boundary observations, not a surveyed
present-day tidal shore.

`decompose-water.py` partitions canonical polygons along interior rings for the
current simple-polygon runtime format. Its 40 compatibility pieces preserve
the exact union and all dry islands: the greatest measured symmetric difference
is 3.33e-9 m². `water-compatibility-validation.json` retains per-parent checks.
Each piece carries `parentWaterId`, canonical shoreline lines and artificial
cut segments so partition edges need not create shoreline effects. The canonical
geometry remains the source authority.

`clip-context.py` clips OSM geometry rather than discarding a whole crossing
road. `../mapping/osm-context-epsg3006.geojson` contains 124 fragments from 122
source features, with source IDs, tags and geometry hashes. Four source features
were changed by clipping. Artificial clip boundaries are not physical features.

## Reproduction and review

Run from the repository root. The Python environment requires NumPy, Shapely,
Pillow and Matplotlib. The existing local review environment is shown below.

```powershell
node --env-file=.env geo_data/course-v2/visby/vegetation/build-canopy.mjs
upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/vegetation/clip-water.py
upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/vegetation/decompose-water.py
upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/vegetation/clip-context.py
upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/vegetation/build-practice-surfaces.py
node geo_data/course-v2/visby/vegetation/compile-stands.mjs
node geo_data/course-v2/visby/vegetation/review-stands.mjs
upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/vegetation/render-review.py
```

`review-stands.mjs` independently checks every eligible cell centre and every
actual deterministic runtime stand representative against source polygon
interiors and road/path corridors. It samples exact staged terrain chunks for
representative bases and compares them with the retained unquantized 1 m DTM.
The permitted difference is 6 mm, covering the terrain's centimetre quantization.
`stand-source-review.json` records the exact reviewed layer-index hash, placement
counts, exclusions and greatest base-height difference.

The review panels are local-only at
`visbybuild/cache/vegetation/review/stand-source-panels.png`. Three scenes compare
2024 canopy with the retained 2022 Region Gotland orthophoto. The final build
followed the visible forest pattern and kept roads and buildings clear while
preserving the dry pond islands. These different vintages cannot establish changes since acquisition or
current individual-tree positions. Exact final compilation/review counts belong
to the JSON evidence, rather than being copied into a second numerical ledger.

These commands stage resources and evidence. `attachVisbyStands(compilation,
frame)` returns the checked composition for the Visby publisher and does not
write a runtime root or source manifest itself.
