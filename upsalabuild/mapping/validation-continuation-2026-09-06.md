# Upsala continuation validation — 2026-09-06

Mapping checkpoint `f440974` contains the continued review, both regenerated
courses and the [next-session handoff](NEXT-SESSION.md). Main `002c91c` was merged
in `727b82f`; conflicting terrain implementation/tests use main's exact versions.
Windows rebuild/review fixes are in `5187128`. No push or deployment was performed.

The continuation adopts **12 Stora fairways, H16's green and four tee outlines**.
H4's fairway preserves its water gap, and H16's green no longer overlaps the
adjacent bunker. Stora has **53 tee records: 51 image outlines and two provisional
originals**, on H13 and upper H15. Mellan retains 23 own platforms and carries the
same shared-ground corrections. Routes, scorecards, daily marker references,
terrain and vegetation remain unchanged.

The current [tee sheet](stora-tee-review.svg), [overview](overview.svg) and
[continuation comparison](stora-followup-review.svg) are saved in SVG and PNG.
The tee sheet checks its displayed geometry against the current model.
[validation-continuation-2026-09-06.json](validation-continuation-2026-09-06.json)
retains source/model/pack hashes, check-log hashes, browser fingerprints, cameras,
terrain state and capture hashes. Raw imagery, browser images and logs remain in
the ignored local cache.

## Validation results

| Check | Result |
|---|---|
| Full suite | **481 Vitest + 322 Node = 803 passed**, zero failures or skips |
| Source geometry | 18 new rings pass the independent survey tool's simple-polygon validator; trace vertices reproduce through the independent projection within 5 mm |
| Guarded adoption | Stale originals and wrong frames rejected; all 48 new Stora tee rings and every new fairway/green ring occur once in both course environments |
| Standalone geometry, currency and card | Pass; **1,230,408 bytes / 1201.57 KiB**, below the existing 1220 KiB budget |
| Pack/page byte identity | Pass |
| All-course packs | All 10 pass |
| Canonical migration | All 7 reports, 10 models and 10 slugs verified with explicit pyproj backend |
| Source manifests | Pass; existing source approval/coverage gaps remain explicit |
| App/page lint and production/v2 builds | Pass |
| Repeated refresh | Both model files, both packs, routing root and comparison geometry reproduce identically |
| Legacy browser, Stora and Mellan | Pass; frame luminance 0.376 / 0.399, including all tee-material probes |
| Required-v2 browser | Both courses pass; final captured views have no loading or failed terrain tiles |

The GIS export contains **5,827 records**, including 444 buildings and 4,181 crown
candidates. This includes references, context and derived observations; it is not
a unique surveyed-object census.

Required-v2 views are Stora H4 top, H12 tee, H16 green and H18 top; Mellan H1 green
and H8 top. They use WebGL2, required-v2 mode, `q=lo`, `graphics=1`, 960×600 and
software SwiftShader. They test correctness, not hardware performance. Browser
warnings such as cancelled terrain requests, blocked service-worker registration
and WebGPU-to-WebGL2 fallback are retained separately from failures in the JSON.
The earlier software-browser brightness failure and unsettled Mellan boot are
historical results; this checkpoint reruns both with passing final evidence.

## Source review and limits

The 2025 Lantmäteriet raster hashes match the branch's recorded source tiles; the
flight-year image was inspected. Greens and fairways were reviewed against 2024
and 2025 imagery. Twelve additional fairways use 3 m interpretation uncertainty
(4 m at H5), and the H16 green uses 1 m. All fourteen Stora par4/5 fairways now
have reviewed outlines, including the earlier H13/15 work.

The municipal archive services labelled 2020 and 2023 provide clearer leaf-off
views of some tees. Exact flight dates are unknown. Four accepted traces were
crosschecked against 2025: H12 middle, H14 forward, H15 lower and H18 rear. Their
2–2.5 m uncertainty includes historical/obscured-edge interpretation. All have
complete native 1 m interior terrain samples. Full-ring slopes are 0.45%, 3.01%,
0.44% and 1.91%; detrended height RMSE is 0.017, 0.020, 0.013 and 0.032 m.
These are planarity diagnostics, not absolute survey accuracy or independent
proof of material. The measurements are saved in
[stora-tees-followup-terrain-2026-09-06.json](stora-tees-followup-terrain-2026-09-06.json).

All eighteen Stora greens were visually reviewed; remaining small differences in
retained OSM outlines were not accepted as corrections. Nine infrastructure
context panels were inspected, with no additional road/trail features accepted.
Eight Stora tee sites and Mellan H8 remain partial. H13 and upper H15 retain
provisional originals. Par3 H2/H6/H14 mowing corridors, small equipment, hidden
drainage, road/trail widths and missing links, building heights/use, individual
species and seasonal land-cover edges remain unresolved. See [scope.json](scope.json)
and [NEXT-SESSION.md](NEXT-SESSION.md). **`completeSurvey` remains false.**
