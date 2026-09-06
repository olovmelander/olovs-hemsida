# Upsala Stora tee validation — 2026-09-06

Geometry checkpoint `e228362e69bde55d07306bce17e84b90cd98d940` adopts source checkpoint `cc0e97bb34c861387635327689e9cbaa07481e4f`. This is technical validation and bounded visual review of tee mapping in the current Stora and Mellan environments. It is an **incomplete site survey**, with explicit provisional and shadowed sites.

Stora now has **53 physical-pad records: 44 new accepted traces, 3 previously reviewed rings retained, and 6 provisional rings retained**. Mellan has **23 own pads** and receives all **44 new Stora rings exactly once** as shared scenery. Daily markers, tee colours, routes and card distances are not inferred from deck geometry.

Review the [tee map PNG](stora-tee-review.png) or [vector SVG](stora-tee-review.svg). [runtime-validation-stora-tees.json](runtime-validation-stora-tees.json) preserves exact counts, source and pack hashes, per-ring comparisons, cameras and capture digests. Earlier validation files remain historical records.

The same geometry tree is published in GitHub commit `1f0397323475b3db9056c4fa666860a6e6558b40`; the source tree is published in `d7e1fe6e240d88684c49d691951d0feb902eacfc`. The comparison SVG and PNG regenerate with identical SHA-256 digests.

## Automated checks

| Check | Result | Local evidence under `upsalabuild/cache/` |
|---|---|---|
| Unit suite | **398 Vitest + 321 Node = 719 passed**, zero failures | `stora-full-tests.log` |
| Standalone geometry/card/data | Passed | `stora-check3d.log` |
| Pack/page byte identity | Passed | `stora-check-pack.log` |
| All-course packs | All 10 packs match cards, hashes and manifests | `stora-check-packs.log` |
| Source manifests | All 7 physical grounds and 10 course slugs pass; existing source-approval gaps remain explicit | `stora-geo-manifests.log` |
| Canonical migration | 7 reports, 10 converted models and 10 course slugs verified | `stora-migration-check.log` |
| App/page lint and production build | Passed | `stora-lint-app.log`, `stora-lint-page.log`, `stora-app-build.log` |

The standalone page is **1,219,443 bytes / 1190.8623 KiB**, below the existing **1220 KiB** budget. This checkpoint does not raise that budget. The GIS export contains **5,826 records**, including references, context and derived crowns; it is **not a unique surveyed-object census**.

## Legacy browser gate

The bounded run covered Stora and Mellan only and exited **1**. Exactly two checks failed: `frame is a picture`, at luminance **0.036 for each course**. These remain recorded as failures, consistent with the known container software-renderer limitation.

All **53 Stora and 23 Mellan physical tee-platform interior material probes passed**, along with the other logged card, material, HUD, object and submerged-object checks. Neither course produced a page error. Evidence: `stora-legacy-browser.log`. This does not claim an all-ten-course browser rerun.

## Required-v2 browser review

Both courses loaded their current pack bytes, matching the rebuilt public and production copies. Stora booted in **24.230 s** and Mellan in **33.089 s**, each in required-v2 mode with WebGL2 and 1 m terrain. Both loaded **4,181 crown records**.

| Course | Numbered pad rings | New Stora rings | App / HTTP / other request failures | Cancelled requests |
|---|---|---|---|---|
| Stora | All 53 match the current model exactly | All 44 match exactly once in numbered holes | 0 / 0 / 0 | 5 `net::ERR_ABORTED` |
| Mellan | All 23 match the current model exactly | All 44 match exactly once in shared scenery | 0 / 0 / 0 | 5 `net::ERR_ABORTED` |

Cancelled requests are retained separately from HTTP or other request failures. Runtime terrain reports **zero failed tiles** in both courses. Source and ground manifest hashes remain unchanged. Mellan was a boot smoke and still had **10 terrain tiles streaming when closed**; its final view is not claimed to be fully settled.

| Capture | Visible boundary vertices | Settled terrain | Camera position → target, local metres |
|---|---|---|---|
| `hole-02-rear-kidney-tee.png` | 21 / 21 | 6 selected/rendered, 0 loading/failed | `[321.2, 111.4, 19.2]` → `[321.2, 23.4, 18.2]` |
| `hole-07-tee-complex.png` | 53 / 53 | 9 selected/rendered, 0 loading/failed | `[-295.7, 207.3, 387.9]` → `[-295.7, 32.3, 386.9]` |

Both captures were inspected. They use `q=lo`, the container software renderer and direct free-camera views. **The selected card/HUD remains hole 1**, even though the camera inspects H2 or H7. Surface-atlas sampling can make rendered edges look stepped; exact source/runtime coordinate equality is checked independently. Capture files and raw logs are local review evidence, **not retained in git**; their names, SHA-256 digests and cameras are retained in the JSON artifact.

## Geographic limits

The six provisional old pad records remain at H13, H14, H15 and H18. H8/H9 retain three earlier reviewed rings with their existing uncertainty. Hidden portions of several tee complexes remain unresolved, including incomplete rear/intermediate sites at H11/H12. These are not filled with guessed outlines.

Absolute source accuracy, many small objects and concealed drainage remain unverified. **Individual species are unverified**: crown records are derived candidates, and rendered species are visual priors. Tee colours and daily marker locations are also unverified. Imagery pixel spacing is not survey accuracy. See [scope.json](scope.json) and the [mapping runbook](README.md) for the remaining full-site mapping work.

## Integration with newer main

Main advanced to `a9c2d441c86542f1179edd6d08c0a3a0d25b5011` during publication. Its Ängsö lake/sea fixes were merged into the reviewed mapping branch. Shared indexes retain both the latest Ängsö and current Upsala/Mellan entries; the merged app, documentation, report and registry changes were compared with both parents. Upsala model and pack bytes remain identical.

After integration, all-course pack checks, source manifests, canonical migration, app lint and production build pass again. The default unit run passes 398 Vitest and 319 Node tests, with two adapter tests skipped because Python PROJ was not selected. Running that adapter suite explicitly passes all three tests, including both skipped cases: all 719 distinct tests are covered and pass. The JSON records the separate logs. Browser captures above remain evidence from the preceding geometry checkpoint; this integration adds the inherited main terrain-tint changes.
