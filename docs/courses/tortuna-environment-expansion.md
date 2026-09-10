# Tortuna surroundings expansion — 2026-09-09

The measured surroundings extend 512 metres farther west and east, and 256
metres farther north and south. Canopy coverage grows from 1,536 × 2,560 metres
to 2,560 × 3,072 metres: 3.93 to 7.86 km² and 60 to 120 native tile owners.
This is a wider source-derived environment within the existing terrain.

Sixty additional 256-metre windows were acquired from the same April 2021
Lantmäteriet COPC asset. Bounded reads transferred 64,354,436 bytes. Each window
uses the original 64-metre processing halo and canopy algorithm. Four separate
expanded rasters preserve every original overlapping byte, including unknown
cells. The new field retains 1,128,397 unknown canopy cells; these are not
classified as cleared ground. The cloud ground raster supports canopy heights
and does not replace the native terrain.

The independent acquisition checks are retained in
[expanded canopy review](../../geo_data/course-v2/tortuna/vegetation/expanded-canopy-review.json).
The stand compiler separately checks the fixed old and new raster identities,
lattices, exact overlap bytes, source exclusions and native tile ownership.
Roads, buildings, playing surfaces and observed roof envelopes exclude canopy.

A separate wider OSM extract adds surrounding buildings, roads, tracks, fields,
woodland and drainage context. It excludes IDs already present in the original
raw source. Building footprints stay complete; a footprint crossing the terrain
edge is withheld. Woodland now supports clipped polygons and holes, with exact
partition checks. Partition and acquisition edges do not represent physical
boundaries. Maintained playing surfaces, water and buildings remain excluded
from surrounding land-use colour.

The runtime now contains 309 buildings including the range shelter, 41 road
segments, 48 tracks, 26 paths, 10 drainage/watercourse segments and 13 railway
segments. This adds 161 buildings and 52 transport segments. The 86 land-use
polygons become 341 exact compatibility pieces after maintained-area exclusions;
these pieces are not separate fields. A sub-square-metre partition sliver was
merged with its adjacent piece without removing area or filling a hole.

The measured-only rendering policy now also applies to distant vegetation.
This prevents generic distant-tree cones from filling areas without measured
canopy. Mapped power-line voltage reaches the runtime model, and allotment
ground colour stays consistent between near and distant terrain.

The 4,096-metre native terrain, its 341 tiles, shell, 340 parent links and
coordinate frame remain fixed. The smaller course preview stays unchanged so
the renderer continues to select the full terrain graph. Existing hole geometry,
water levels, facilities and six measured roof surfaces remain intact.

[Expansion evidence](../../tortunabuild/mapping/environment-expansion-evidence.json)
records before/after inventories, immutable geometry comparisons and published
asset identities. [Rebuild and browser checks](../../tortunabuild/README.md)
describe how to reproduce the derived assets. Raw national data and reference
images remain in the private cache.

The [browser report](../../tortunabuild/mapping/browser/environment-expansion/report.json)
verifies 462 terrain/shell/stand chunks and the active 341-tile world. It counts
24,278 representative tree instances, including 11,322 outside the original
canopy window, with none outside the expanded window and no generated distant
trees. This is a display-instance count, not a surveyed tree census. Both wide
views rendered without reported browser errors or terrain gaps. At their
950–1,000-metre camera altitude, the finite terrain's square boundary and strong
fog remain visible. These software-rendered captures establish coverage and
rendering behaviour, not native-device performance.

Validation passed: 591 Vitest tests in 87 files, 423 Node tests with three
expected skips, 11 Python assembly tests, the production build, application and
renderer checks, all source manifests, and the 198-hole source planner. The 36
native terrain controls retain a maximum encoding difference of 0.002852 m;
this is encoding consistency rather than independent positional accuracy.

April 2021 tree currentness, partial fairways, unresolved tee platforms, coloured
markers, architectural details and independent survey controls remain open as
described in the [course refinement review](tortuna-refinement-review.md).
