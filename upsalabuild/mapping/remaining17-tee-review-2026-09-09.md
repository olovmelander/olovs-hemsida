# Uppsala: the remaining 17 tee references

All seventeen previously unresolved navigation references now have explicit
source reviews. **Sixteen positions moved; Stora H15 tee 62 was confirmed without
movement.** Both course models, packs, standalone data, EPSG:3006 migrations and
geographic exports have been rebuilt. The largest correction is 54.910 m on
Mellan H6 Orange.

The course now has **136 references associated with observed platforms and 17
references supported by reviewed visible tee or fairway sites**. These are
navigation placements. Six use approximate guide-identified fairway entrances,
with 12–15 m interpretation allowances; they are not exact marker coordinates.

## What changed

| References | Source and decision |
| --- | --- |
| Stora H4/5/7/8/11/12/13/15, tee 42 | Adopted published 18Birdies coordinates after checking each point on native June 2025 imagery. The source calls this column 43; all 18 distances match the current 42 card within whole-yard rounding. Each chosen point is on the current fairway polygon. |
| Stora H3, tee 42 | Rejected the published point on the pond-side collar. The club guide identifies the nearby fairway head; placed the navigation reference on visible mown turf, 12.293 m from that source point. Explicit 15 m interpretation allowance. |
| Stora H13, tees 51/47 | Moved both references 3.504 m from the canopy edge to visible tee turf, corroborated by the 2017 archive. The guide establishes the platform identity. Its complete boundary remains provisional. |
| Stora H15, tee 62 | Confirmed the existing point inside exposed tee turf using native 2025 and leaf-off 2020 imagery. Its complete platform boundary remains provisional. |
| Mellan H2/3/4/6/8, Orange | The club-linked guides identify the rear fairway mowing entrances. Native 0.16 m imagery establishes the visible turf; the five approximate positions move 18.477/22.576/11.658/54.910/52.844 m respectively. Interpretation allowances are 12/12/12/15/12 m. No published Orange GPS points were found in the checked sources. |

[Download the seventeen coordinates](remaining17-tee-coordinates-2026-09-09.csv)
in longitude/latitude, EPSG:3006 and the local course frame, with movements,
coordinate basis and interpretation allowances.

## Accuracy and preservation

Eight Stora references retain independently published coordinates to rounding
precision. The source reports uncertified data and no capture date or absolute
accuracy; the ledger assigns a 5 m working interpretation allowance. The three
visible tee-interior references use a 1 m interpretation allowance. These values
are review allowances, not statistical confidence bounds or measured survey
accuracy. Daily marker positions remain unverified for all references.

The yellow/green support polygons in the review panels describe conservative
visible turf interiors. They are evidence only and are never emitted as tee
platforms. **All 56 Stora and 24 Mellan physical platforms, fairway outlines,
routes, scorecard distances and earlier 136 accepted references are unchanged.**
The H13 forward and H15 upper outlines still need fuller boundary evidence.

## Evidence and validation

- [Combined Stora decisions](lm-tee-site-review-stora-2026-09-09.json)
- [Combined Mellan decisions](lm-tee-site-review-mellan-2026-09-09.json)
- [Published Stora point source review](lm-tee-point-sources-stora-2026-09-09.md)
- [Visible tee-interior evidence](lm-tee-visible-interior-stora-2026-09-09.json)
- [Mellan Orange source evidence](lm-mellan-orange-remaining-2026-09-09.json)
- [Independent Python validation](lm-remaining17-validation-2026-09-09.json)
- [Source-to-consumer coordinate contract](tee-site-coordinate-contract-2026-09-09.json)
- [Browser verification](lm-remaining17-runtime-2026-09-09.json)

Independent Python/pyproj/Shapely validation passes all seventeen references,
source hashes, pixel transforms, containment, bounded movements and unchanged
model content. All 302 protected terrain/heightfield files are byte-identical.
The coordinate contract checks both models, packs, GPS, camera/rangefinder,
standalone vectors and geographic exports. All 64 focused tests, the twelve
pack checks, page/app lint and production build passed.

Actual browser selection passes all **306 app selections** across both courses
in required-v2 and GPK1 modes, plus **108 Stora standalone selections**, with no
browser errors. The app checks all 272 earlier platform selections and all 34
new site selections, including camera/rangefinder agreement. Twelve app captures
and five standalone captures are hashed in the reports. The app used an isolated
production preview so concurrent builds could not replace its assets.

Regenerate with `tools/refresh-upsala-mapping.mjs`; it applies the earlier
platform phases first, then these complete guarded site ledgers, and runs the
coordinate gate. Run `verify-remaining-tee-sites.py` with the acquired sources
and pinned pre-site baselines present to reproduce the independent validation
and coordinate CSV. Raw source images and browser captures stay in ignored cache.
Earlier dated reports remain historical snapshots.
