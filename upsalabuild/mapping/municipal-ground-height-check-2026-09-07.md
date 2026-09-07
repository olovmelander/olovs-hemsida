# Municipal ground-height comparison, 7 September 2026

The published 1 m Upsala terrain was compared with 292 public municipal
ground-height records. **250 have complete 1 m interpolation coverage.** Their
median difference is **+0.063 m**, RMSE **0.225 m**, and 95th-percentile absolute
difference **0.439 m**. Positive differences mean the published DTM is higher.
All large residuals remain in those statistics; no offset or terrain edit was made.

The complete sanitised [JSON report](municipal-ground-height-check-2026-09-07.json)
retains each included and excluded record, source provenance, exact published
terrain identities, source accuracy attributes, grouped metrics and outliers.
The [geographic residual plot](municipal-ground-height-check.svg) shows the
clustered point distribution and the finest terrain coverage. No source
photography is embedded in the plot.

| Registration year | Source records | Compared | Outside 1 m coverage | Median difference, m | RMSE, m | p95 absolute, m |
|---|---:|---:|---:|---:|---:|---:|
| 2017 | 33 | 27 | 6 | +0.040 | 0.232 | 0.498 |
| 2019 | 16 | 16 | 0 | +0.082 | 0.143 | 0.249 |
| 2020 | 41 | 41 | 0 | +0.072 | 0.123 | 0.219 |
| 2024 | 72 | 72 | 0 | +0.102 | 0.252 | 0.519 |
| 2025 | 111 | 75 | 36 | +0.055 | 0.275 | 0.620 |
| 2026 | 19 | 19 | 0 | +0.031 | 0.045 | 0.083 |
| All | 292 | 250 | 42 | +0.063 | 0.225 | 0.439 |

**REGDATE is a database creation/registration date, not a measurement date.**
The 2026 row does not prove 2026 survey acquisition or terrain stability. The
provider does not expose a separate measurement date in these records.

## Sources and eligibility

The municipal
[ground-height layer](https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer/6292?f=pjson)
describes geodetically measured ground heights. Its source geometry uses
EPSG:3011 (SWEREF 99 18 00). The public query requests and returns EPSG:3006
coordinates, so those returned eastings/northings are sampled directly against
the published ground. No manual CRS shift or datum conversion was applied.

All 292 records satisfy the reviewed source criteria: existing status,
not fitted, network RTK for both horizontal and vertical position, original
height datum RH2000 and positive finite source accuracy attributes. The fields
advertise 0.025 m horizontal and 0.04 m vertical accuracy; those values are
provider attributes, not an independently verified accuracy certificate.
Metadata code meanings are checked before accepting the records.

The raw municipal metadata and query remain in ignored
`upsalabuild/cache/review-2026-09-07/source-inventory/`. The helper verifies their
exact byte lengths and SHA-256 hashes against `municipal-downloads.json` before
processing. Query SHA-256 is
`a1efa8d5bbde114e8b936054ba0a00f395957b226ec1618c97a0f5a4b6f1a141`;
metadata SHA-256 is
`0d3f500e0d382bd44a718c1ab8cade24f7497c1a2b1db87fa7a1fab12cdc074b`.
The report omits editor names, usernames, comments and unrelated municipal fields.

The terrain is the exact immutable manifest/chunks reached through the app's
published Upsala course reference. The helper verifies the course and ground
manifest hashes, terrain chunk hashes and decoded payload identities, tile/ground
ownership, horizontal bounds, 1 m sample spacing and RH2000 frame. It uses the
repository's `sampleTerrainTile` and requires all four interpolation corners to
be finite. No coarser level is substituted. Eight finest-level tiles supply the
250 accepted comparisons; all 42 exclusions are outside their full 1 m coverage.

The current acquisition records identify Lantmäteriet Markhöjdmodell source items
663_63 and 663_64, captured on 27 and 26 April 2023 respectively. Their records and
checksums are included as acquisition context, separately from the exact
published-terrain manifest and chunk hashes used for the comparison.

## Outliers and geographic limits

There are **12 absolute residuals greater than 0.5 m**, from **−1.056 m** to
**+1.025 m**. All lie within the EPSG:3006 cell
`[640500, 6636500, 640750, 6636750]`, northeast of the playing area. The largest
negative difference is municipal object 1514028 at
`E 640650.709587, N 6636598.791246`; the largest positive is object 1444935 at
`E 640667.862444, N 6636602.735565`.

A focused 2025 orthophoto review of
`[640520, 6636520, 640720, 6636720]` shows housing, gardens, woodland edges and
visible earthworks in that area. This supplies geographic context and a plausible
reason to investigate changed ground or surface mismatch; it does **not** establish
the cause or date of any residual. The context pair and full georeference are in
`upsalabuild/cache/review-2026-09-07/ground-height-context/`.

The point distribution is concentrated around the clubhouse, approach roads and
nearby residential ground. It provides useful independent-source evidence that
the published terrain's datum is broadly consistent with the municipal heights.
It does not certify every fairway, bunker floor, tee platform or green. Residuals
combine source uncertainty, interpolation, possible surface mismatch and changes
between unknown observation epochs. Production-control approval remains separate.

## Repeat and continue

```powershell
node geobuild/check-upsala-ground-heights.mjs --source-dir upsalabuild/cache/review-2026-09-07/source-inventory --out upsalabuild/mapping/municipal-ground-height-check-2026-09-07.json
upsalabuild/cache/review-venv/Scripts/python.exe geobuild/render-upsala-ground-height-check.py
npx vitest run tests/upsala-ground-heights.test.mjs
```

The four focused tests cover source eligibility and sanitisation, registration
semantics, complete-response and domain checks, corrupted published assets,
bilinear interpolation, missing corner data and rejection of coarser terrain.
They pass. Rerun the diagnostic after a course-reference rebuild so the report
records the current manifest chain; unchanged terrain must reproduce the metrics.
No network request or terrain/model mutation is performed by the comparison tool.

For further accuracy work, obtain ground controls on the playing surfaces with
known observation dates, known physical surface, independent horizontal/vertical
accuracy and confirmed RH2000 datum. Investigate the twelve existing outliers in
their own contexts before considering any local terrain change. Do not fit a
global offset from these clustered residuals.
