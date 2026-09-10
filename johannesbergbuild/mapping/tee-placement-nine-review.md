# Johannesberg nine-hole tee reference review

The [placement ledger](tee-placement-nine-review.json) assigns 15 nominal tee
references to the centres of visible hitting mats in the 14 June 2025 native
Lantmäteriet images. The existing 15 platform boundaries are preserved. These
are **inferred colour assignments**, not surveyed daily marker positions.

The club's [current course guide](https://johannesbergsgolf.se/vara-banor/banguide/)
was checked on 9 September 2026; it publishes the main course's 18 hole sheets.
No nine-hole colour map was found there or through the club's course page.
The [published nine-hole scorecard](https://www.golfisverige.com/klubb/johannesberg-golfklubb/)
confirms Yellow and Red length columns. Colour ownership below combines that
order with visible mat locations, their hole corridors and back/front separation.
Scorecard distances were not used to generate coordinates or move platforms.

| Hole | Yellow reference | Red reference | Evidence and limit |
|---|---|---|---|
| 1 | Unresolved | Pad 1 | Visible mat is approximately 260 m from the green; Red is 261 m. A possible back mat beneath canopy is not established. |
| 2 | Unresolved | Pad 1 | Visible west-facing mat is approximately 233 m along the retained corridor; Red is 234 m. Other mats in the shared cluster cannot establish Yellow ownership. |
| 3 | Pad 2 | Pad 1 | Two separate mats support approximately 247 m and 207 m routes, consistent with the 248/208 m order. |
| 4 | Pad 1 | Pad 2 | Back/front mats lie approximately 127/95 m directly from the green, consistent with 126/94 m. |
| 5 | Pad 1 | Pad 2 | Two east-facing mats have approximately 31 m back/front separation, matching the colour-length difference. Shared use near hole 2 remains unconfirmed. |
| 6 | Unresolved | Pad 1 | One visible mat supports approximately 282 m through the retained first dogleg; Red is 284 m. No separate back platform is established. |
| 7 | Pad 1 | Pad 2 | Two visible mats lie approximately 161/134 m from the green, agreeing with their back/front order. |
| 8 | Pad 1 | Pad 2 | Two mat bases have approximately 49 m separation in remaining distance, consistent with Yellow/Red order. |
| 9 | Pad 1 | Pad 2 | Southern back mat and northern forward mat lie approximately 162/105 m from the green, consistent with 163/104 m. |

Pad numbers in this table and the stable IDs are one-based; ledger `padIndex`
values are zero-based. Every accepted coordinate is a manually selected source
pixel transformed through EPSG:3006 into the existing local frame. The ledger
pins each source image and existing pad geometry. No nearest-platform snapping
is used. Yellow on holes 1, 2 and 6 remains a nominal unresolved reference and
must not produce a physical marker pair or a synthetic platform.

All 15 reference centres are inside their declared platforms, with at least
0.927 m edge clearance. Running the shared pair renderer on the proposed
references produces 15 pairs / 30 balls, with minimum ball-centre clearance
0.183 m and no inter-colour overlap. Geometry hashes match the current model.
These checks establish containment and consistent rendering, not absolute
geographic accuracy or club-confirmed colour ownership.

The private visual review contact sheet is
`johannesbergbuild/cache/tee-nine-review/contact.png`; individual full-resolution
annotated panels and the retrieved club pages are retained beside it. Raw
orthophotos remain in the existing ignored acquisition cache.
