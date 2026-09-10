# Veckefjarden tee placement review

The follow-up corrects 49 reference positions and assigns the exposed roadside
rear platform to H16, correcting its earlier H6 assignment. H6 uses the adjacent
forest-side historical platform. Both club guides corroborate this distinction;
their hashes and the exact orthophoto trace are retained in the current ledger.

All 18 holes have explicit replacement tee inventories: 54 platforms, comprising
47 photographed outlines and 7 unchanged historical outlines. Of 108 numbered
references, 87 have provisional platform associations and 21 remain unresolved.
Twelve associations use historical boundaries. None establishes daily marker
positions or surveyed tee-colour assignments.

The table counts changes since the preceding review at commit `2ade8719`.
Decorative marker fitting does not count as a source-coordinate change.

| Hole | Platforms | Associated references | Unresolved tees | Positions changed |
| --- | ---: | ---: | --- | ---: |
| 1 | 3 | 5 | 40 | 0 |
| 2 | 3 | 5 | 55 | 0 |
| 3 | 1 | 4 | 48, 40 | 0 |
| 4 | 4 | 5 | 61 | 0 |
| 5 | 2 | 4 | 55, 40 | 0 |
| 6 | 3 | 5 | 40 | 2 |
| 7 | 2 | 6 | none | 2 |
| 8 | 3 | 6 | none | 6 |
| 9 | 3 | 5 | 40 | 4 |
| 10 | 4 | 5 | 40 | 5 |
| 11 | 3 | 5 | 40 | 4 |
| 12 | 3 | 6 | none | 4 |
| 13 | 3 | 5 | 40 | 2 |
| 14 | 2 | 0 | 65, 61, 58, 55, 48, 40 | 0 |
| 15 | 2 | 5 | 65 | 5 |
| 16 | 5 | 6 | none | 5 |
| 17 | 4 | 5 | 40 | 5 |
| 18 | 4 | 5 | 40 | 5 |

The largest correction is H11 tee48, moved 20.6305 m to its nominated platform.
H12 tee58 moves about 17.4 m out of the path corridor. H16 tee65 moves off the
junction onto the roadside back deck. H15 gains a photographed short platform;
focused imagery resolves two additional H18 platforms. H5's shaded upper
candidate and H14's obscured boundaries remain open.

[Full coordinate table](../../geo_data/course-v2/veckefjarden/acquisition/tee-coordinate-review.csv)
contains WGS84, EPSG:3006 and local coordinates, previous/current positions,
pad identity, provenance, historical status and boundary clearance. The
[JSON report](../../geo_data/course-v2/veckefjarden/acquisition/tee-coordinate-review.json)
pins the reviewed model and ledger.

Source, packed and actual browser reference coordinates agree exactly. The app
preserves explicit pad identities, disables rectangle inference
on all 18 holes, and fits decorative marker pairs inside the nominated deck.
It leaves the source and camera reference fixed. Six pairs need a display-only
inward shift, at most 0.509 m, within a 1 m limit. Offline checks yield 182
contained marker instances, zero invented pads, no references in mapped water,
and 17 omitted pairs where no platform contains an unresolved reference.
The production-browser audit confirms all 182 marker instances, the selected
camera position and zero page errors; see
[browser evidence](../../geo_data/course-v2/veckefjarden/acquisition/tee-runtime-audit.json).

The independent source-to-model audit passes all 67 current records, checking
1,389 traced vertices, 7 native TIFF hashes, 57 panel hashes, 513 recomputed RGB
sample pixels, 7 corroborating guides and 7 exact historical rings. The current
ledger supersedes 27 earlier individual tee records; their original components
and the first-pass trace-verification snapshot remain available in Git history.

The terrain bridge is a local affine approximation with maximum residual
0.28257 m across these references. Source-to-local coordinate storage contributes
at most 0.00701 m quantization. Neither establishes absolute surveying accuracy:
source accuracy remains unknown and boundary interpretation is 0.4–3 m.

Both course packages and migrations are rebuilt. The short course receives
updated shared scenery; its own routing is unchanged. The update preserves all
277 terrain references and 1,821 crowns, adding 44 excluded stand cells in five
tiles. The shared ground is
`2f0782ee9731e00f985799bf209585339771ae1ff0caa26ca0c44e18398b18b4`.

Verification passed: 33 focused Node tests, 8 Python affine/converter tests,
36 marker/display tests including standalone parity, pack/page/card equality,
scoped source and publication checks, and the Vite production build. The same
publication checks also pass against `apps/golf/dist`. Initial browser attempts
against the development server timed out. The served production build passes
the actual tee-coordinate, marker-containment and camera audit.
The short course passes both standard and GPK1 browser gates. The championship
GPK1 gate passes; the combined harness timed out on its subsequent default
startup. A fresh default startup boots successfully and satisfies the same
277-tile, seven-level, coordinate-bridge, surface-policy and vegetation checks
with zero page errors. Diagnostic evidence is retained in ignored
`geobuild/cache/tee-default-browser*.json`; streaming request cancellations are
recorded separately from page errors.

Run `node geobuild/mapping/check-tee-publication.mjs` for both publications and
`node geobuild/mapping/audit-tee-runtime.mjs --base-url http://127.0.0.1:8631`
against a served production build. See the [runbook](README.md) for rebuild steps.
