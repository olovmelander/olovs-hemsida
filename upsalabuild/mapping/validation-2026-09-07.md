# Upsala accuracy review — 7 September 2026

This checkpoint adds two missing physical tee platforms, Stora H8's Sahara
bunker, a reviewed practice path and municipal infrastructure observations to
the shared Upsala ground. It preserves accepted earlier geometry and records
the remaining evidence gaps. **This is not a complete survey.**

Stora now has **54 tee records: 52 imagery outlines and two provisional originals**.
Mellan has **24 platforms**. The archive-assisted additions are Stora H11 rear
and Mellan H8 north; source service years remain distinct from capture dates.
The new **85.98 m² Sahara bunker** is supported by paired 2024/2025 imagery and
[club documentation](https://upsalagk.se/news/brev-fran-ordforanden/). Three coarse
par3 fairway classifications at H2/H6/H14 were retired; no replacement mowing
class was invented.

The **116.240 m² practice path** replaces the complete obsolete `w438967934`
strip. Its municipal RTK central edges, digitised northern edges and interpreted
joins have separate provenance and uncertainty. Exact polygons and holes survive
the atlas and legacy mesh paths. Physical material and height remain unknown.

The [municipal primary map](https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer)
contributes four new drainage lines, 19 fence/hedge/wall boundary lines and one
bridge footprint. Nine ditch observations corroborate existing corridors without
adding duplicate geometry. Drainage and boundary lines remain geographic records;
unknown width/depth/height does not cause guessed water, terrain carving or fence
extrusions. The four bridge decks use their mapped horizontal footprints with
explicit vertical rendering estimates.

The separate municipal GeoJSON contains **231 observations**, including 148 open
road edges and 50 tree points. It does not imply 231 new rendered objects or a
unique tree census. Fifty tree records distinguish broadleaf/conifer only.
The current merged ground GIS contains **5,851 records**, including references,
context and 4,181 crown candidates. Buildings retain 444 footprints.

## Checks

| Check | Result |
|---|---|
| Full test suite | **509 Vitest + 322 Node = 831 passed**, zero failures/skips |
| Guarded source adoption | Original records, frames, source identities and projected/local agreement checked before mutation |
| Exact surfaces | Concave path polygon, interior exclusions, vegetation precedence and mesh triangle area verified |
| Shared courses | New Mellan H8 ring occurs exactly once in both models and retains its archive qualifier |
| Page/card/currency | Pass; **1,236,944 bytes / 1207.95 KiB**, within 1220 KiB allowance |
| Packs | Page/pack identity passes; all 10 course packs pass |
| Migration and manifests | Upsala's two canonical migrations and all source manifests pass |
| Lint and builds | App/page lint, production/v2 isolation and renderer build pass |
| Legacy browsers | Both courses pass; luminance 0.376 / 0.399 |
| Required-v2 browser | Both courses pass; all four final views settled with no application errors |
| Review map | Desktop/mobile interactions, feature inspection and source toggles pass; zero external requests |
| Acquisition preservation | Help makes no requests; a nonempty source cache is refused before downloads |

The final v2 views are Stora H8 green, H11 top and H1 top, plus Mellan H8 top.
All final captures were visually inspected. Sahara has no overlap with any of
the 4,181 crown candidates or 228 OSM tree points; the nearest crown is 26.188 m
from its sand boundary (radius 3.785 m), so no tree retirement was justified.

Source coordinates remain outside runtime geometry. Independent reproduction of
the path vertices differs by at most **1.30 mm**; this checks transformation, not
source accuracy. Route/card/pin/tee-marker references, building footprints,
continuous streams, water, vegetation, both heightfields and tree-cover files are
preserved. Regeneration also restores original UTF-8 names where the earlier
generated records contained replacement characters.

The [height comparison](municipal-ground-height-check-2026-09-07.md) samples 250
eligible municipal ground points against the exact published 1 m DTM. Median
DTM-minus-source difference is **+0.062671 m**, RMSE **0.225224 m**, and p95 absolute
difference **0.438682 m**. Forty-two points are outside fine coverage. Twelve
differences above 0.5 m lie northeast of the playing area. No terrain shift or
refitting was applied. Source registration dates are not survey dates.

## Browser evidence and limits

The initial simultaneous required-v2 runs timed out waiting for scene boot at
240 seconds, without application errors. They are retained alongside the final
sequential runs, which use a 600-second startup allowance. The checks use
WebGL2/SwiftShader, required-v2 mode, `q=lo`, `graphics=1`, 960×600. They verify
correctness, not hardware performance. Final view records include camera,
terrain state, visible tile IDs and capture hashes. Warnings are separate from
application failures. App/page lint emits the existing Windows Node DEP0190
deprecation warning but exits successfully with no undefined symbols.

The machine-readable [validation record](validation-2026-09-07.json) retains
source/model/pack hashes, check-log hashes and browser evidence. Raw photographs,
orthophotos and browser images remain in ignored local cache. The interactive
[source reviewer](source-review.html), [overview](overview.svg),
[tee sheet](stora-tee-review.svg) and [par3/Sahara comparison](stora-par3-sahara-review.svg)
are saved in the repository.

Main was fetched again and remains `002c91c`; this branch already contains it.
The terrain implementation and tests still match main exactly. No push or
deployment was performed. See [NEXT-SESSION.md](NEXT-SESSION.md) for continuing
with parking/path topology, southern bridge approaches, tree identity, hidden
tees, measured object dimensions and the unresolved 2026 service-house footprint.
