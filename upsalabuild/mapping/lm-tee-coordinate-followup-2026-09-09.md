# Uppsala tee coordinates and camera follow-up — 9 September 2026

Historical checkpoint: the [remaining seventeen references were subsequently
reviewed](remaining17-tee-review-2026-09-09.md), with sixteen corrections and one
confirmation. Six of those placements remain explicitly approximate.

This follow-up fixes a remaining **7 m camera offset in the standalone page**,
adds the missing **Stora H6 and H18 forward platforms**, and corrects **eleven
more tee-reference positions**. Both Stora and Mellanbanan are rebuilt.

The earlier 83-reference pass did not fully resolve placement. Its app browser
checks were valid for that snapshot, but the standalone page still used an old
camera implementation, and two visible physical platforms were absent.

## Corrections

| Location | Correction and evidence |
| --- | --- |
| Standalone `upsala3d.html` | Removed the 7 m setback from the selected tee coordinate. It placed 63 of the 91 previously associated Stora tee views outside their pads. The camera now stands at the selected coordinate and aims along the remaining route, matching the app. |
| Stora H6, tees 51/47/42 | Added the fourth platform across the path. The club's guide establishes the site identity; native June 2025 imagery and a georeferenced 2017 archive establish the outline. Area 73.673 m²; boundary interpretation uncertainty 2.5 m. Corrected the earlier wrong association of tee 51 to the third platform. |
| Stora H18, tees 51/47/42 | Added the fourth, round forward platform, identified in the club's guide and fully visible in native June 2025 imagery. Area 79.997 m²; boundary interpretation uncertainty 1 m. |
| Mellan H6, White/Yellow/Blue | Published tee coordinates establish the rear two platform associations. Place White/Yellow on P0 and Blue on P1, retaining their source-supported separation. |
| Mellan H8, Blue/Red | Published coordinates, the native image and the archive identify the northern platform P1. Move both references inside that platform. |
| Course-selection map | Moved the Uppsala club marker approximately 2 km southwest to the mapped club building `w221193965`: 59.8415076° N, 17.4955179° E. This is a navigation anchor derived from the building polygon, not a surveyed entrance. |

The ground now contains **56 Stora and 24 Mellan physical platforms**. Each
appears once in either course view, including shared scenery. There are **136
explicitly supported platform associations** among the 153 selectable tee
references. All have at least 1 m clearance inside their designated polygon.
This follow-up moves eleven references by at most 30.334 m; all original
physical pads, routes, card values and unrelated playing surfaces are preserved.

## Coordinate enforcement

`tools/check-upsala-tee-coordinates.mjs` checks the complete chain from ordered
source decisions to both models, packs, standalone vectors, EPSG:3006
migrations, v2 routing/fallback assets and WGS84 GeoJSON. It also checks the real
camera and default rangefinder implementations, GPS roundtrips and the landing
map marker. The refresh command runs this gate after rebuilding the exports.

[The coordinate contract report](tee-coordinate-contract-2026-09-09.json)
records millimetre-level migration agreement and sub-millimetre geographic
rounding agreement. The approximate runtime bridge differs from nonlinear
projection by at most 0.048 m on Stora and 0.187 m on Mellan. These numerical
checks establish consistent coordinate handling, not independent survey accuracy.

[Independent Python validation](lm-tee-followup-validation-2026-09-09.json)
checks all 27 native imagery windows, the two new polygon traces, published
Mellan point identities and all eleven corrections. It verifies 125 earlier
platform targets unchanged and the one superseded H6 target explicitly replaced.
All 302 protected terrain/heightfield files are byte-identical.

## Completed validation

[Browser verification](lm-tee-followup-runtime-2026-09-09.json) passed all **306
app selections** across Stora and Mellanbanan in both required-v2 and GPK1 modes,
plus **108 standalone selections**. The app camera and rangefinder agree with
the selected coordinates; all 272 selections with reviewed platform associations
land inside their assigned pads and sample the tee surface. All 96 associated
standalone camera positions also fall inside their pads. The 17 unresolved
references are checked for preservation only.

The report records current model/pack/page hashes and 15 browser captures.
The local review server's missing favicon is stubbed; course assets load normally.
Focused tests, the permanent coordinate gate, independent Python validation,
pack/standalone identity, all twelve pack checks, page/app lint and the production
build passed. Regression cases reject the former 7 m camera setback, reversed
coordinate axes, stale exports and wrong published-source identities.

## Remaining limits

Seventeen references still lack precise geographic confirmation. Nine Stora
tee-42 sites are shown on fairways in the club's guides, so absence of a separate
pad is expected: H3, H4, H5, H7, H8, H11, H12, H13 and H15. The illustrations do
not verify exact marker coordinates. Three references use the still-provisional
H13 forward and H15 upper sites under canopy. Five Mellan Orange references
(H2/H3/H4/H6/H8) have no published tee-coordinate record in the available source.
Those coordinates remain explicitly unverified rather than being moved to an
unrelated platform. Daily marker positions and present-day mowing are also
unverified.

## Source ledgers and regeneration

- [Two physical platform additions](lm-stora-tee-platform-followup-2026-09-09.json)
- [Stora reference follow-up](lm-tee-followup-stora-2026-09-09.json)
- [Mellan reference follow-up](lm-tee-followup-mellan-2026-09-09.json)
- [Published Mellan coordinate evidence](lm-mellan-published-tee-evidence-2026-09-09.json)
- [Guide and imagery findings](lm-tee-forward-sites-front9-2026-09-09.md)

Apply the historical review, then the physical additions, then the follow-up
references. Do not combine overlapping review phases into one helper call.
`tools/refresh-upsala-mapping.mjs` performs this sequence and the coordinate gate.
Run `verify-lm-tee-followup.py` for independent validation, then
`node upsalabuild/mapping/update-lm-manifest.mjs` to register the evidence hashes.
The previous alignment reports remain historical snapshots.
