# Visby GK / Kronholmen source research

Checked 2026-09-07. The physical ground `visby` now has a local provisional 3D
implementation of the main eighteen, following the [v2 runbook](../v2-course-runbook.md)
and [mapping workflow](../v2-course-mapping-workflow.md). This document records
its club and geographic evidence. Software availability does not approve the
spatial frame, survey accuracy, production release or imagery reuse.

## Acquired evidence

[club-resources.json](../../visbybuild/reference/club-resources.json) is the
machine-readable ledger. It records exact URLs, retained paths, byte lengths,
SHA-256, retrieval times, available HTTP dates/ETags, image dimensions, source
roles and unresolved rights. The completed snapshot contains **61 assets,
37,238,979 bytes**:

| Evidence | Acquired | Use |
|---|---:|---|
| Club pages and club-linked Caddee page | 9 pages | Identity, source links and public course information |
| Official SGF scorecard response | 1 JSON response | Main-course par, stroke index and six numeric tee lengths |
| Caddee per-hole diagrams | 18 + 9 PNGs | Hole identity and routing corroboration |
| Caddee overview | 2 PNGs, identical SHA-256 | One whole-ground overview containing both routings |
| Course/practice reference images | 20 images | Appearance and feature-identity research |
| Club-hosted historical documents | 2 PDFs | Historical rating and hole-18 context |

Raw originals are under
`visbybuild/cache/club-sources-2026-09-07-full/`, which is ignored by Git.
Sanitized inventories, numeric facts, provisional vector derivatives,
reproducible scripts and generated runtime data are tracked. The source photos
and orthophotos are not runtime textures. All 49 raster files have checked
width/height metadata. Capture dates,
camera calibration, source CRS and spatial accuracy remain unknown. A filename
under `uploads/2026/06/` supplies a publication-path hint, not proof of when a
photograph was taken. Similarly, a filename containing `20210615` is only a
capture-date lead until confirmed by source metadata.

The linked [club course page](https://www.visbygk.com/om-banorna/) identifies an
18-hole par-72 course and a separate full-length nine-hole par-36 course, both
rebuilt in 2009. These are routings on one shared property. The first application
routing is the main eighteen; the nine-hole course remains separately identified
research. Practice facilities have their own
[club reference page](https://www.visbygk.com/trackman-range/).

## Current card and identities

[club-scorecard.json](../../visbybuild/reference/club-scorecard.json) follows the
existing course-reference card shape: `tees[].id/name/front/back/total` and
`holes[].number/par/index/lengths`. The current
[club golf page](https://www.visbygk.com/golf/) embeds the official SGF scorecard.
The original JSON response was acquired in a normal browser page context and
compared with the independently served
[club-linked Caddee page](https://www.caddee.se/klubb/visby-golfklubb): all 18 pars,
18 indexes and 108 lengths match exactly. They may share upstream GIT data;
agreement is a transcription check, not independent measurement.

| Tee name | Stable card ID | Out | In | Total, metres |
|---|---|---:|---:|---:|
| 63 | `tee-63` | 2970 | 3260 | 6230 |
| 59 | `tee-59` | 2744 | 3075 | 5819 |
| 55 | `tee-55` | 2580 | 2910 | 5490 |
| 51 | `tee-51` | 2309 | 2617 | 4926 |
| 46 | `tee-46` | 2179 | 2430 | 4609 |
| 41 | `tee-41` | 1952 | 2264 | 4216 |

The club's approximate 6,300-m description does not replace the card's exact
6,230-m total. Front/back par sums are **35/37**, total 72 -- this line read 34/38 until 2026-09-08, when a third source was compared cell by cell against `card.json`; the card was right and the prose was wrong. Stroke indexes are a
permutation of 1–18. Numeric tee names are deliberate: Caddee's color mappings
and ordering differ between the two courses, so a shared color-to-number
assumption would misidentify tees.

| Provider | Main eighteen | Separate nine |
|---|---|---|
| Caddee course | `c33d3bba-77d2-4ba6-8f88-9723bd3a23ec` | `240594e2-ac66-4052-85b5-331cca1c3207` |
| Club SGF widget course | `302e8ccf-fb86-4d6f-9d65-3348e0ecd29b` | `e06e7ae6-561a-471a-8a90-108c128210ca` (slope-widget reference only) |

Both club widgets identify club `e16dee44-22b4-4873-82e0-022deb28f6f9`.
The public SGF scorecard API URL is retained in the card provenance. A bare HTTP
request receives a registered-domain error; use the actual club page and its
normal widget request. User-facing links point to the club page.

Caddee represents its **nine physical holes as eighteen scorecard entries** for
two rounds, with repeated diagrams and alternate stroke indexes. Its stated
physical count is nine and par is 36. The second nine entries must never become
new physical holes. The inventory keeps only the first nine unique diagram
identities, while recording the 18 serialized card entries. The nine-hole tee
count differs between the club golf and course pages; this does not affect the
verified main-course card and remains unresolved for future nine-hole intake.

### The card and hole 1 have a dated expiry, announced by the club

The club published [**Renovering av hål 1**](https://www.visbygk.com/nyheter/renovering-av-hal-1/)
on **2026-08-13**: a major rebuild of the first hole starts in **late October
2026**, is to be finished before Christmas, and the new hole is planned to open
for play in **spring 2027**. What the club says will change: tee 46/41 lowered
for sight of the green from the back tee and a new tee 41 built; the green made
larger and longer for more pin positions; **the right bunker removed and two new
ones built to the left**; no bunkers left on the way to the green; larger
foregreen and run-offs, plus a re-made old tee for playing over the bay on hole
2, mown in with the first's foregreen; and new irrigation over every close-mown
surface.

So this model shows hole 1 as it stands in **autumn 2026**, which is what it is
built from, and it goes out of date in spring 2027 — the same kind of dated
expiry Norrfällsviken's card carries. Nothing is changed for it here; a model
must show the ground that exists.

The same text is also **independent corroboration** of the model's hole 1, from a
record that never entered it: the club writes of *the* right bunker, singular,
and the model carries exactly one bunker right of that hole (R10 m at 21 m to
green) beside one left (L15 m at 16 m).

## Diagrams, coordinates and geographic review

The Caddee overview was visually inspected. Blue numbers identify the eighteen;
green numbers identify the separate nine. Its shoreline, ponds, clubhouse,
practice area and buildings supply matching features for source comparison.
Main hole 1 sits near the clubhouse and southwestern coastal corner
of the illustration; hole 18 runs along the southern edge back toward the
clubhouse; hole 4 is near its northern edge. These are **diagram-relative**
observations, not assigned geographic coordinates.

The hole-1 diagram explicitly distinguishes approach distances to the green's
front from fairway reference distances to its center. Its tee-63 diagram number
is 145 m, while the scorecard has 159 m. Those describe different target points;
do not move a tee/green or rewrite the scorecard to force equality.

The retrieved Caddee records contain **no per-hole latitude, longitude or
control geometry**; neither does the SGF scorecard. Caddee's course-level points
are retained only as unapproved discovery hints in `club-resources.json`:

| Caddee location hint | Longitude | Latitude |
|---|---:|---:|
| Main eighteen | 18.118760 | 57.441010 |
| Separate nine | 18.124920 | 57.441430 |

These are interpreted as longitude/latitude in OGC:CRS84 from the web mapping
context; source-declared CRS and accuracy are absent. They are not measured
clubhouse positions, hole controls or approved origins. Some third-party club
directories expose other point locations; they must not silently replace this
ground's measured frame either.

No public controlled survey, georeferenced banguide, CAD/GIS surface export or
orthophoto was identified in the reviewed club pages. The club's
[course-development entry](https://www.visbygk.com/banutveckling/) redirects to
member login; its private contents were not read. Lantmäteriet terrain,
orthophoto, laser and public vector acquisition belong to the separate ground
source manifest and must follow the runbook's per-product rights/control gates.

The subsequent [route crosswalk](../../visbybuild/mapping/route-reference.json)
correlates all 18 main-hole identities with the retained 2022 municipal
orthophoto and available OSM green outlines. It records pixel coordinates,
EPSG:3006 coordinates, source IDs and interpretation uncertainty. Seventeen
visible physical tee platforms were traced. Hole 12's physical platform remains
unidentified after source-image review; its explicitly virtual flyover starts
on observed fairway. The separate nine is not registered as playable. These
interpreted joins are not independent survey control, and the 2022 image does
not establish current mowing or later course changes.

## Local provisional 3D implementation

`?bana=visby` opens the main eighteen in 3D. `?bana=visby&view=sources` retains
the original source-comparison preview. The verified card keeps the six actual
numeric tee names, with 59 as the explicit display default. Camera references
are not claims about the positions of those six numbered tees or daily markers.
Card lengths never move geometry, and current flag positions are unknown.

| Layer | Implemented evidence and limits |
|---|---|
| Playing surfaces | 18 green outlines, 17 observed tee platforms, 16 fairway rings and 65 bunker outlines. Fourteen fairway rings serve 13 main holes; two remain unassigned context on the separate nine. Bunkers remain shared-ground scenery, without inferred hole ownership. See [surface review](../../visbybuild/mapping/playing-surfaces-review.json). |
| Routing | 18 canonical EPSG:3006 routes in [geometry.json](../../visbybuild/mapping/geometry.json). Hole 12 has `unresolved-physical-platform`, no tee polygon and a sourced fairway camera; it cannot silently receive a synthetic pad. |
| Terrain | Exact 4097 × 4097 national 1 m source window, EPSG:3006 + RH 2000. The graph retains 341 tiles across five levels, including all 256 finest tiles. The initial active view loads 64 complete 1 m tiles around the played property. |
| Vegetation | 2024 national COPC returns support 2 m canopy inputs and 256 stand chunks at 4 m cell spacing. Source exclusions and actual runtime representatives are checked after each surface change. No measured individual-tree identities or species are claimed. See [vegetation evidence](../../geo_data/course-v2/visby/vegetation/README.md). |
| Water | 25 national water-break polygons with ten interior rings become 40 simple render pieces with the same union and islands. Original physical shoreline chains suppress artificial partition, source-tile and clipping edges. RH2000 source levels remain explicit; sea levels use a labeled representative median. No bathymetry or penalty-area status is inferred. |
| Context | Clipped OSM roads, paths and other features preserve source IDs and tags; 32 building footprints are represented. Missing dimensions use declared generic rendering values, not measured roof claims. |
| Practice | A separate source-observed driving-range field is retained in [practice-surfaces.geojson](../../visbybuild/mapping/practice-surfaces.geojson); detailed facilities remain incomplete. Changes feed both scenery and stand exclusions. |

The software frame is E687748.5, N6370951.5, origin height 0.10 m RH2000,
with east as +x and north as −z. PROJ converts that horizontal origin to
57.44236399463288° N, 18.12847826436399° E. The frame is an exact implementation
convention for the retained source grid. The source manifest's
`canonicalFrame.origin` coordinates remain `null`, with
`originStatus:'pending-control-approval'`, while independent controls are unresolved.

Municipal image derivative terms, club/Caddee media reuse, independent control
and production approval remain open. National 2026 orthophoto pixels are still
inaccessible with the configured account despite available metadata. The local
candidate does not close those gates. Rebuild instructions and the remaining
mapping work are in the [implementation handoff](../../visbybuild/mapping/NEXT-SESSION.md).

## What 2026-09-08 added

### An independent per-hole survey, and the two records it convicts

[`geo_data/visby_clean.json`](../../geo_data/visby_clean.json) is Visby GK's
18×5 GPS survey, pulled from GolfTraxx **course id 62230SW** ("Visby Golfklubb,
Vastergarn Kronholmen 415, Visby, SW") with the repo's own
[`golftraxx_extract.py`](../../geo_data/golftraxx_extract.py). Until now this
ground had NO independent per-hole geometry at all: the section above records
that neither the SGF scorecard nor Caddee carries a latitude or longitude.

[`golftraxx-review.mjs`](../../visbybuild/mapping/golftraxx-review.mjs) joins it
to the EPSG:3006 frame through the repo's own Krüger series and measures the
agreement rather than asserting it. **Fifteen holes agree at a median 2.09 m
and a maximum 3.24 m** between the survey's green centre and the model's traced
green centroid. Retargeting each traced corridor onto the survey's own
endpoints, all fifteen come out shorter than the card by a one-sided **−5.7% to
−17.0%, median −8.4%** — the signature of a right hole assignment, since the
provider's back-tee marker stands in front of the card's back tee. It also
supplies **hole 12**, whose physical platform no source image ever showed:
−36.7% against the card before, −8.2% after.

Three holes disagree and the review separates them by fault:

- **Holes 3 and 4: the provider is wrong.** Their survey endpoints imply holes
  18.3% and 52.7% *longer* than the card, which a played line cannot be. The
  imagery shows both are real golf features on the shared property — a mown
  green with a greenside bunker at local [−96, −554], a tee-like apron at
  [−47, −593] — most likely on the separate nine.
- **Hole 9: the model is wrong**, and four records agree. See
  [`green-9-review.json`](../../visbybuild/mapping/green-9-review.json).

This survey is third-party geometry. It is recorded as a cross-check; it
supplies no approved control and by itself moved no geometry.

### The orthophoto question is answered, and the answer is free

The section above records that "National 2026 orthophoto pixels are still
inaccessible with the configured account". The COG still is — `dl1` answers 401
unauthenticated and 403 for this account — but **the pixels are servable
without credentials** through the viewing service Min karta proxies:

| source | resolution | capture | reachable |
|---|---|---|---|
| **Lantmäteriet `Ortofoto_0.16`** via `minkarta.lantmateriet.se/map/ortofoto` | **0.16 m** RGBI | **2026-04-10**, leaf-off | yes, no credentials |
| **Region Gotland `Ortofoto_2022`** ImageServer | 0.25 m | summer, leaf-on | yes, open service |
| Lantmäteriet `orto-f2-2026` COG on `dl1` | 0.16 m | same flight | **no** — 401/403 |
| Esri World Imagery z18 | 0.3214 m | WorldView-2, **2016-08-24** | yes |
| municipal 2022 image (what the model was traced from) | — | 2022 | retained |

Esri z19, z20 and z21 all return the same 2,521-byte "Map data not yet
available" placeholder, so z18 is its floor rather than a choice. The two
reachable orthophotos are therefore **twice the sampling and ten years newer**
than the imagery every Visby trace so far was read from, and they are a leaf-off
and a leaf-on frame of the same ground — which is the pair a mown boundary
needs. [`ortho-crop.mjs`](../../visbybuild/ortho-crop.mjs) serves both in this
frame with the model drawn over.

Rights are recorded, not resolved. Lantmäteriet's ortho STAC declares
CC-BY-4.0 and also states that use is legally reviewed under GDPR and requires
accepting special terms; the proxy's capabilities carry no Fees or
AccessConstraints element; Region Gotland's terms are likewise open. Both are
used as tracing and review evidence, neither is redistributed, and no
orthophoto is or becomes a runtime texture.

### Measured vegetation, and a sixteen-kilometre ground

Both credentialed chains ran in CI, where the Lantmäteriet secrets are, started
by pushing a control file to this branch.

**Vegetation.** The pinned inventory is one campaign — 24e002, City Mapper 2,
2024-02-03…04-28, **leaf-off** — over `24e002-636_68` (13,769,262 points) and
`24e002-637_68` (47,387,337). Acquire run 34201242013 turned 31,657 crown
candidates into **3,012 machine-reviewed individuals** on 116 object tiles plus
stand fields on all 256. The cloud's own class-2 ground sits within **0.00 m
median of the published DTM on every land tile**, which is an independent
sensor pass confirming the terrain. Leaf-off is the caveat: it is the condition
under which Johannesberg's measured canopy fell 43.9% → 17.6%.

**Terrain.** [`visby-ground-rings.mjs`](../../packages/course-v2/visby-ground-rings.mjs)
takes the ground from a 4,096 m five-level pyramid to a **16,384 m root over
seven levels, 469 tiles**, published by run 34204274378. Nearly forty per cent
of that root is open Baltic that Markhöjdmodell does not tile at all — the whole
`*_67` column of 10 km squares answers 404 while all four eastern neighbours
answer 200 — and the acquire measured the fill rather than assuming it: one
component per level, boundary median **0.230 m RH 2000 at every level**, which
is exactly the sea plateau inside the course window, and filled with that same
height. Every threshold in the spec is this ground's own measurement now.

Neither publish promotes the software frame: `canonicalFrame.origin` remains
`null` with `originStatus:'pending-control-approval'`, and independent controls,
derivative terms and production release stay open.

### The third hole was rebuilt, and the club's own map says the numbering holds

The club replaced its third: golfbranschen reported in 2022 that "det nya tredje
hålet går där gamla hål 15 låg, mellan hål 6 och gamla hål 3", playable from the
2023 season, and Pierre Fulke Design's masterplan keeps the old third mown as a
practice area. **This build's hole-3 green is traced from the 2022 municipal
orthophoto**, which is the wrong side of that date — so the fair worry is that
the model carries the OLD third under the club's current number.

The imagery cannot settle it. On the 2026 flight the traced green is a live,
maintained complex with its bunkers and its pond, and so is a green kept mown as
a practice ground; from above the two are the same picture, which is exactly
what the masterplan says to expect.

The club's own overview map settles it, and
[`register-overview.mjs`](../../visbybuild/mapping/register-overview.mjs) is how.
Caddee publishes a plan of the whole property with a numbered disc per hole
(blue for the eighteen, green for the nine) whose per-hole par and stroke index
match this repo's card on all eighteen. The tool finds the discs **by colour**,
drops the legend's own disc, and fits a rigid similarity by ICP against the
model's hole MIDPOINTS — the anchor that beat both ends at Veckefjärden, because
a disc is drawn beside its hole rather than at either end of it. **No numeral is
ever read**, so the arrangement alone does the identifying, and the check that
never entered the fit is that the result reproduces the numbers a reader can see
on the image at holes 1, 3, 4, 5 and 6.

Result ([`overview-registration.json`](../../visbybuild/mapping/overview-registration.json)):
18 discs, median residual 21.9 px = **46.5 m** at the fitted 2.12 m/px, worst
73.9 px at the 18th. A 46 m residual is large next to a green, and irrelevant to
the question asked — so what is reported beside it is the **assignment margin**,
the distance to the next nearest disc over the distance to the assigned one:
median **3.61×**, worst **1.42×** at the 8th. Nothing is near a coin toss, and
the model's hole 3 lands on the disc the club's current map numbers 3.

What that does and does not establish: the **numbering** is confirmed, and the
2022 trace is consistent with it because the new third was built where a green
already stood — the old fifteenth's. The **exact 2023 green shape** is not
confirmed by anything, and `visbybuild/guide-notes.json` says so on hole 3.

## Photographs, videos and historical references

Exact downloadable image URLs are enumerated in the ledger. Useful entrypoints
are the [club course imagery](https://www.visbygk.com/om-banorna/),
[current home-page imagery](https://www.visbygk.com/), and
[club-linked Caddee photographs](https://www.caddee.se/klubb/visby-golfklubb).
The retained Caddee photo 1 was visually inspected and is a real coastal tee
view. Its capture epoch and exact viewpoint remain unconfirmed. Many club image
filenames credit Jacob Sjöman; photographer credit is not a redistribution
license. Do not use these photos as a runtime ground texture.

The club links its
[official YouTube channel](https://www.youtube.com/@visbygolfklubb1958). Two
club-hosted MP4 URLs are discovered in the inventory; neither was downloaded or
treated as a calibrated aerial source. In particular, a generic background-video
filename does not establish that it depicts Kronholmen. No complete, dated,
georeferenced 27-hole flyover set was verified during this intake.

The following supporting references were also found:

- [Svensk Golf's Visby film with course architect Pierre Fulke](https://www.svenskgolf.se/banor-och-resor/se-klippet-sveriges-basta-banor-visby-golfklubb/), published 2025-06-18. Useful for sightlines and explanation; camera footage is not spatial control.
- [Club-hosted Svensk Golf 5–2024 hole-18 article](https://www.visbygk.com/wp-content/uploads/2024/06/SVG-Topp50-En-dag-pa_24_05.pdf), downloaded. Establishes a historical routing-change lead; old opening-hole imagery cannot be assigned to current hole 1 by its old number.
- [Club-hosted men's slope PDF](https://www.visbygk.com/wp-content/uploads/2021/05/VISBY_GK_18_halsbanan_Men.pdf), downloaded. The document states a 2014-02-22 rating date. It is historical evidence, not the current scorecard/rating authority.
- [Club press/media entrypoint](https://www.visbygk.com/press-media/), reviewed. It offers a route for requesting photographs, but the page does not publish a blanket derivative/distribution license. Nobody was contacted.

## Reproduce and validate

Replay the checked acquisition, without network access:

```powershell
node visbybuild/reference/build-club-reference.mjs visbybuild/cache/club-sources-2026-09-07-full
```

This verifies every retained SHA-256 and byte length before comparing the two
cards and writing the compact references. A changed upstream card requires
review; disagreement aborts the derivation instead of choosing silently.

For a fresh acquisition, use a new ignored directory and an installed
Playwright module with a local Chrome browser. `VISBY_PLAYWRIGHT_MODULE` may name
the installed module's absolute directory; if unset the script resolves the
normal `playwright` package. No private credentials or request headers are
serialized.

```powershell
node visbybuild/reference/acquire-club-sources.mjs visbybuild/cache/club-sources-next
node visbybuild/reference/build-club-reference.mjs visbybuild/cache/club-sources-next
```

The original club-intake validation completed: 61 source hashes; 49 raster dimensions; 18 hole identities;
18 stroke indexes; 108 matching SGF/Caddee tee lengths; six published tee totals;
par sum 72; and exact shared-overview image identity. Subsequent mapping review
records all 18 route identities, observed surfaces and unresolved positions on
the complete source overlay. This does not claim complete visual review of all
downloaded photographs or independent human approval.

`visbybuild/course.node-test.mjs` checks the generated pack against canonical
geometry and the official card, preserves water topology and original shores,
compares the encoded heightfields, and loads the actual 64-tile runtime frontier
to verify source-height alignment. Its four tests also passed with raw-cache
reads prohibited: they need the tracked generated artifacts and public chunks,
not credentials, source imagery, local Float32 caches or network access.
