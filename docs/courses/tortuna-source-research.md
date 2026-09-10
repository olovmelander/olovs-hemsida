# Tortuna Golfklubb source research

Observed 2026-09-09. This intake follows the [v2 runbook](../v2-course-runbook.md).
The retained evidence supports a new implementation from current source data;
it does not certify survey accuracy or make legacy routing current.

The [source ledger](../../tortunabuild/reference/source-assets.json) records 111
downloaded assets with exact URLs, hashes, bytes and retrieval timestamps:
24 HTML pages (including all 18 GolfTraxx hole pages), 18 full Caddee hole maps,
one course overview, three official PDFs and 65 club image URLs. The latter
include responsive size variants and some logos, not 65 independent views.
Original media stays in ignored `tortunabuild/cache/reference/`.
Public viewing does not establish redistribution or production geometry rights.
No club or photographer was contacted.

The [acquisition script](../../tortunabuild/reference/acquire-references.mjs)
can repeat the intake; a repeat may retrieve changed web content and must be
reviewed as a new source generation.

## Current card and conflicts

The club's [course page](https://tortunagk.se/spela-golf/banan/) embeds Caddee
with `data-caddee="11454"`. The
[live Caddee page](https://www.caddee.se/klubb/tortuna-golfklubb) supplies 18 pars,
stroke indexes and four named tee distances. All numeric fields are retained
in [scorecard.json](../../tortunabuild/reference/scorecard.json). Its edition
date is unstated. Caddee warns that the club is not affiliated and that the
guide graphics may not be completely current.

| Tee | Out, m | In, m | Total, m |
|---|---:|---:|---:|
| Gul | 2510 | 2900 | 5410 |
| Blå | 2250 | 2640 | 4890 |
| Röd | 2030 | 2395 | 4425 |
| Orange | 1940 | 2120 | 4060 |

Par is **71 (35 out, 36 in)**. The official
[men's slope PDF](https://tortunagk.se/wp-content/uploads/2026/08/TORTUNA_GK_Course_Men-2.pdf)
and [women's slope PDF](https://tortunagk.se/wp-content/uploads/2026/08/TORTUNA_GK_Course_Women-orange.pdf)
independently confirm 71; both state a rating date of 2019-08-15. Their August
2026 upload directories do not establish a new 2026 course measurement.

Hole 9 is now par 3, Gul/Blå 105 m and Röd/Orange 95 m. GolfTraxx retains a
par-4 hole and a remote historical back tee, so that tee cannot define the
current hole. The downloaded Caddee hole-9 diagram depicts the short hole;
its 95/84 annotations measure to the front of the green, not the card's centre.
The original bytes remain a comparison reference, not a georeferenced map.

GolfiSverige swaps the hole-5 Gul/Röd distances and therefore yields different
totals. The adopted live Caddee data gives **Gul 140 m, Röd 125 m**; the Caddee
test page and GolfTraxx's old 153/136-yard card corroborate that ordering.
Published distances cannot locate coloured tee markers or justify sliding
geometry to make a route match a nominal length.

## GolfTraxx coordinates

[routing-golftraxx.json](../../tortunabuild/reference/routing-golftraxx.json)
records 18 sets of WGS84 coordinates in explicit **longitude, latitude** order,
linked to individually checksummed hole pages. Each contains the source's
`TheTipsTee Back`, landing target, and green front, centre and back. Capture
date and accuracy are unknown; use remains provisional reference only.

`ttlatitude`/`ttlongitude` is a landing target, **not the tee position**. The
source's `TheTipsTee Back` extra supplies the tee reference. Three green points
do not define the green's boundary. Current maintained outlines must be traced
from licensed national imagery with explicit uncertainty and separate source
IDs. GolfTraxx hole 9 must use a newly observed current tee before playable
routing is assembled. No surveyed current coloured tee census was obtained.

## Photographic and feature evidence

The official [facilities page](https://tortunagk.se/anlaggningen/) supplies the
wide clubhouse photograph retained as `club-photo-17.jpeg`. It shows the yellow
building with white window trim, dark reddish-brown roof, terraces and the pond
behind the nearby green. `club-photo-65.jpg`, from the
[September 2025 maintenance notice](https://tortunagk.se/hosterbjudande-2025/),
shows that green and the clubhouse at closer range. Image capture dates and
camera coordinates remain unknown. The [bistro page](https://tortunagk.se/anlaggningen/golfbistron/)
identifies the restaurant's view as hole 9, corroborating the relationship.
Building height, roof dimensions and footprint must come from separate measured
or digitized evidence; these photos do not establish those dimensions.

The club's current [2026 local rules](https://tortunagk.se/wp-content/uploads/2026/04/Lokala-Regler-2026-1.pdf)
identify internal out of bounds between holes 12/18 applying on hole 12,
wildlife fencing around much of holes 1–9, an exception beside hole 6, drop zones
on holes 1/9, and a prohibited-play penalty area beside holes 15/16. They also
identify stone walls and placed stone groups as course features. These are
feature identities and relationships, not coordinates; the precise linework
and marker positions still need mapping. Rules mention green/white beginner
tee plates, but supply no complete positions or distances for an additional
playable tee set.

The September 2025 notice announces drainage and aeration work on greens.
Neither a maintenance notice nor the upload date of a photograph proves an
outline has changed. Preserve the measured terrain and keep changes layer-specific.

## Evidence limits

The card is traceable to the club's embedded service and current official slope
documents. The source points, guide diagrams and photos are corroboration.
National orthophoto, laser data and the 1 m height model are handled by the
separate acquisition ledger. Independent spatial controls, current tee-marker
positions, obscured boundaries, dimensions of objects, source-specific rights
and human visual review remain distinct gates. A successful runtime build is
not evidence that those gates have closed.

The September 9 continuation acquired four May 2, 2026 national orthophoto
items through existing authorized access, including private 0.32 m review
windows and native 0.16 m crops. It recovered the checksummed native 1 m terrain,
2021 canopy rasters and national 3D water clip. The
[source manifest updater](../../tortunabuild/update-source-manifest.mjs) keeps
provider whole-source identities separate from bounded acquisition hashes and
adds generated model/stand artifacts only when they exist. Graph-dependent
runtime reports stay outside that ledger to avoid circular content identities.

[Back-nine observations](../../tortunabuild/mapping/surfaces-back9.geojson)
contain nine greens, eleven visible tee platforms, nine fairway/approach strips
and twenty-three bunkers with exact crop pixel coordinates and projected bounds.
These were interpreted from national imagery, not generated from card lengths
or guide drawings. H11/H16 green shadows and dry spring fairway transitions have
explicit uncertainty. H12/H15 tee platforms remain unresolved in this trace set.
All nine GolfTraxx green references fall inside these observed green rings, but
the H13 and H16 old tee points are respectively 20.86 m and 9.57 m from the
nearest observed platform. This is source disagreement, not permission to slide
terrain or assert a current coloured tee location.

A [separate front-nine review](../../tortunabuild/mapping/front9-independent-review.json)
checked the original 24 front-nine polygons against all nine green/tee crops.
No gross hole association or coordinate-frame error was found. H3/H4/H5/H8
shadow closures and the incomplete tee census remain qualified. This comparison
is an agent review of an exact recorded source hash, not mandatory human signoff.
