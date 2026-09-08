# Lidingö placement audit

The renderer was placing unobserved ground clutter despite Lidingö's explicit
`mapped-only` object and `measured-only` vegetation policies. The narrow renderer
fix now suppresses those populations and inferred range target flags. It retains
the measured canopy stand representatives and the source terrain/water planes.

The [browser audit](placement-audit.json) is a reproducible check of the source
application at the recorded URL and source hashes. It was rerun after the
facility/model rebuild and road correction in the normal application build; the report records
the actual reviewed generation. Repeat it after further changes.

| Population | Before the fix | After the fix |
|---|---:|---:|
| Procedural grass tufts | 21,501 | 0 |
| Procedural bushes | 3,859 | 0 |
| Procedural stones | 955 | 0 |
| Procedural reeds | 35 | 0 |
| Procedural stumps | 0 | 0 |
| Inferred parked cars | 0 | 0 |
| Canopy stand representatives | 46,121 | 46,115 |

The updated facility/parking exclusions remove six stand representatives. The
placement-policy fix itself preserves the measured stand population; the
26,350 removed grass/bush/stone/reed instances were procedural clutter.

The ground-cover block previously used random placement and terrain slope to add
rocks and bushes. The reed block selected the first lake level and combined it
with a proximity field covering every water body. Neither operation establishes
observed objects. Their noise-driven placement is now disabled for measured-only
vegetation; mapped-only also disables ground clutter. The default range block
previously chose a tee end from the clubhouse and range polygon, then placed
flags at fixed distances with alternating offsets. Mapped-only now bypasses this
block; the runtime reports zero inferred range targets.

The before/after hole 12 and 18 screenshots are under
`lidingobuild/cache/placement-audit/`. Both views were inspected. The removed
stones and tufts had appeared beside maintained surfaces; no corresponding
source objects had been acquired. The remaining flags are the explicitly stated
virtual green targets, not a claim about today's cup positions.

The later facility review also exposed floating road ramps. The road builder
still applied its legacy 17-sample centreline average, artificial crown and
optional minimum bridge level to measured terrain. Measured-only roads now
sample their own terrain position for every centre, edge and shoulder vertex,
with only a 0.03 m display offset. The legacy grading branch remains unchanged.
Three tests exercise the actual mesh builder over a sharp valley and side slope,
including a deliberately excessive bridge floor. `V3D.roadDraping()` checks the
Float32 vertices submitted by the real course against their ground samples;
the browser audit requires every ribbon to remain within 2 mm of the display
offset. This is a rendering precision allowance, not geographic accuracy.

## Source geometry defects found

- The original OSM context conversion classified all 28 closed parking ways as
  lines. The course builder accepted polygon parking only, so it rendered no
  parking surfaces. [OSM parking semantics](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking)
  define a drawn parking area independently of an additional `area=yes` tag.
  [Normalization](normalize-infrastructure.py) now wraps the exact closed rings
  as polygons, while excluding explicit `area=no` and open lines. Original
  reference files remain unchanged.
- Six `golf=path` lines reside in the golf reference, rather than the context
  reference imported by the builder. All six exact lines are retained in the
  [normalized infrastructure](infrastructure.geojson).
- Two coarse club parking areas intersect the observed facility inventory:
  `way/32428960` and `way/221846968`. Those whole source records are retired from
  the rendering intake in favour of the observed 2019 parking footprints.
  [The review](infrastructure-review.json) records every intersecting facility,
  covered area and unresolved source remainder. The operation does not generate
  sliver polygons or assert that the unmatched remainder is absent.
- The source has 562 building polygons. All already retain polygon geometry;
  there is no corresponding closed-line building defect. In the audited baseline,
  561 used a generic five-metre height and one used an unverified 40-metre OSM tag.
  Source-derived building height evidence and the clubhouse's physical appearance
  require their separate review; the initial red/white building materials are
  generic renderer choices.

The normalization emits 26 parking polygons and six path lines, all valid, with
zero moved or synthesized vertices. It preserves source tags and identities.
Neighbouring parking is geographic context, without an assertion of club
ownership or visitor access. Path widths remain renderer estimates: no retained
context highway feature has an explicit width tag.

## Facility contract for the current renderer

`scenery.mappedFeatures` accepts `{id, kind, rings}` in exact local projected
coordinates, including interior rings. This is the appropriate route for observed
surfaces. Suitable existing kinds include `practice_green`, `practice_bunker`,
`range_bunker`, `range_tee_pad`, `range_mat`, `range_target_surface` and `paved_path`.
For turf platforms, `material: 'unverified-turf-surface'` keeps the intended atlas
classification. Generic hardstanding may retain an explicitly unverified material.
An individual mat or target should be present only when its own boundary is observed.

`scenery.rangeFacilities` is a different contract: it resamples a bay line and
creates standard-sized mats, kerbs and dividers. Its net lines generate poles at
12-metre spacing and default to ten-metre height. A traced platform alone is not
enough evidence for these objects. Likewise, `cartPark` creates a fleet along a
line and parking `vehicles: 'motorhome'` creates occupancy; neither is justified
by a bare parking footprint. Lidingö should leave these inventories absent until
their individual placements and dimensions have evidence.

Observed bridges can use `infra.bridges` with exact `ring` and `line` end axis.
The current renderer estimates deck elevation from approach terrain and records
its nominal thickness; this schema must not be interpreted as measured clearance.
No bridges were required by this audit. Water remains the separately acquired
LM PolygonZ geometry, with source levels and unknown bathymetry preserved.

The 2021 canopy model describes stand density/height, not individual stems.
Its 46,115 current representatives remain; source-covered terrain has zero
legacy tree leakage. Facility changes require refreshed stand exclusions before
the graph is republished. Buildings, water and maintained surfaces should not
acquire trees merely because a source footprint was omitted from the exclusion
inputs.

## Reproduce

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/mapping/normalize-infrastructure.py
$env:BANVY_GPU = '1'
node lidingobuild/mapping/placement-audit.mjs http://127.0.0.1:8634
```

Serve the latest application build first. The browser check fails on any
unobserved ground-cover count, inferred range target, inferred parking occupancy,
lost measured stand population or browser exception. Its scope is rendering and
source preservation, not independent survey approval or current-condition accuracy.
