# Tee site review, 2026-09-07

Two missing physical platforms were accepted: Stora H11's long rear platform
(340.5 m² in the app's local frame) and Mellan H8's northern platform (64.0 m²).
Existing accepted outlines, route/card references and terrain were retained.
Stora now has 54 pads after integration; Mellan has 24. Both site censuses remain
partial, and Stora H13 and upper H15 still have provisional originals.

## Evidence and geographic limits

Twenty new exports cover four expanded site windows in the municipal services
labelled 2015, 2017, 2018, 2020 and 2023. Windows are 220 m wide at H11, 160 m at
H13 and 140 m at H15 and Mellan H8. Close review panels retain their exact
EPSG:3006 extent, image hash and source hashes. Source years identify archive
services; exact flight dates and absolute source accuracy are unknown. The
0.1 m export spacing is not a claim of native resolution or survey accuracy.

- **H11 rear:** the previous 75 m crop around the accepted forward pad excluded
  the long rear platform. Its boundary combines the visible 2023 west/north
  edge, 2025 east lobe and the 2017 southern edge, with **3 m interpretation
  uncertainty** covering remaining shadow interpolation and seasonal variation.
  The 1 m laser terrain supports the platform: 172 core samples, 1.40% drainage
  slope and 0.023 m residual RMSE. These are planarity measurements, not absolute
  geographic accuracy.
- **Mellan H8 north:** the 2015 service clearly exposes the platform beside the
  path junction. Its visible edges persist in 2024 and 2025. The accepted trace
  has **2.5 m interpretation uncertainty**. Thirteen core terrain samples give
  0.47% slope and 0.006 m residual RMSE. This resolves the recorded
  `mellan-8-middle-path` candidate; the east-road and north-corridor candidates
  remain unadopted.
- **H13 forward and upper H15:** different sun directions and leaf conditions
  still leave key perimeter segments hidden. H15's possible connected mowing
  turf does not establish a physical terrace division. No replacement was
  invented. Approximate field-review targets, original geometry assertions and
  precise reasons are in [the outcomes record](tee-sites-review-2026-09-07.json).
- **Mellan H8 existing southern ring:** wider turf is suggested by the archive,
  but its current eastern/southern perimeter remains obscured. The accepted
  existing ring was retained. The maintained oval near Stora H6's green is
  unclassified; there is no evidence here to turn it into an active tee.

The public sources are the [municipal orthophoto directory](https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto?f=pjson),
[2015 ImageServer](https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/ortofoto2015/ImageServer),
[2017 ImageServer](https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/ortofoto2017/ImageServer),
and [2023 MapServer](https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto/Ortofoto_2023_1800/MapServer).
Exact export URLs, EPSG:3006 extents and downloaded hashes are in the JSON
evidence. Raw imagery stays in ignored `cache/tee-review-2026-09-07/`; public
viewing access does not establish permission to redistribute the images.

## Source integration

- [Stora evidence](stora-tees-review-2026-09-07.json): apply with
  `applyReviewedTeeSurfaces` immediately after the 2026-09-06 follow-up, before
  the tee-distance diagnostic loop. Every earlier pad must match verbatim.
- [Mellan evidence](mellan-tees-review-2026-09-07.json): call
  `mergeMellanTeeReview20260907(baseEvidence, review)` from
  `tools/apply-mellan-tee-review-2026-09-07.mjs`. Both the Stora model's Mellan
  scenery integration and `tools/build-nine.mjs` must consume that same merged
  evidence. It retains all 23 earlier accepted features and their archive,
  adds the northern platform, and resolves the matching old candidate.
- [Stora terrain](stora-tee-terrain-review-2026-09-07.json) and
  [Mellan terrain](mellan-tee-terrain-review-2026-09-07.json) are evidence only.
  Their source coordinates must not enter the runtime model.

The focused four-test suite checks unchanged original geometry, source mismatch
rejection, both existing application paths and independent reproduction of every
pixel trace within 5 mm. Full rebuild, shared-ground duplicate checks, pack
validation and browser review remain part of the enclosing integration.

To reacquire all five archive years on this machine:

```powershell
upsalabuild/cache/review-venv/Scripts/python.exe geobuild/acquire-tee-review-2026-09-07.py
```

Compare new response hashes with the committed evidence. Changed imagery needs a
new review. Reuse the recorded panel extents with `render-mapping-review.py` for
an exact comparison; do not quietly reapply old pixel traces to changed rasters.
