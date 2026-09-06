# Continue Upsala mapping in Codex / VS Code

Saved 2026-09-06. Repository: `C:\Users\olov_\repos\olovs-hemsida`.
Branch: `codex/upsala-ground-mapping`.

## Start here

Open this repository in VS Code, select this branch, and give Codex this prompt:

> Read upsalabuild/mapping/NEXT-SESSION.md, README.md, scope.json and the latest
> validation report. Inspect the working tree and fetch origin/main. Continue the
> highest-priority unresolved mapping work using recorded evidence. Main is the
> source of truth for conflicts. Preserve existing user changes, route/card
> references and terrain. Do not invent hidden geometry or claim a complete
> survey. Rebuild both courses, validate, update this handoff and commit completed
> improvements. Ask only when a missing fact actually prevents progress.

First run `git status --short --branch`, `git fetch origin main`,
`git rev-list --left-right --count origin/main...HEAD`, and
`git log -6 --oneline`. At this checkpoint the branch contains `origin/main`
`002c91c`. Merge `727b82f` kept main's complete terrain implementation and tests
when resolving conflicts. Commit `5187128` fixes Windows rebuild/review tooling.
Mapping checkpoint `f440974` contains the continued surface/tee work. Final
validation and documentation commits are in this branch's log. No push or
deployment was performed during this continuation.

## Current state

- Stora: 53 physical tee records, comprising 48 newly traced outlines, 3 earlier
  image traces and 2 provisional originals. The last four traces add H12's middle
  platform, correct H14's forward and H15's lower platforms, and replace H18's
  two guessed rear rectangles with one continuous observed platform.
- Provisional originals remain at H13 and upper H15. H8/9/11/12/13/14/15/18 still
  have partial census status. Mellan has 23 own platforms, with H8 partial.
- All 14 Stora par4/5 fairways have image-reviewed boundaries: 12 added here,
  plus earlier H13/15. H4 has two polygons separated by the visible water crossing.
- All 18 Stora green sites were visually reviewed. H16 was corrected to remove
  overlap with a bunker; H17 was already corrected. The other OSM outlines were
  retained. Smaller differences have not been accepted as corrections.
- Both course models and packs, the standalone page, GIS export, migration,
  routing references and checksum registries have been refreshed. Routes, daily
  marker references, scorecards, terrain and vegetation were preserved.
- 444 building footprints and 4,181 published crown candidates remain. Crowns
  are derived observations; individual species and the full small-object census
  remain unverified. `completeSurvey` is deliberately false.

The open [tee sheet](stora-tee-review.svg) now shows the current 53 records.
[Overview](overview.svg) shows the shared ground. The
[continuation comparison](stora-followup-review.svg) isolates this session's
12 fairways, one green and four tee corrections. PNG versions are also saved.
[Validation](validation-continuation-2026-09-06.md) records the checks and limits.
Earlier validation documents describe historical checkpoints, not today's counts.

## Highest-value next work

1. **Resolve the remaining tees with better evidence.** Inspect H13's forward
   original, upper H15, the omitted/shadowed H11 site and Mellan H8. Extend the
   source window beyond existing pads where necessary: a crop around current
   geometry cannot prove that additional pads do not exist. Historical leaf-off
   images helped H12/14/15/18, but do not establish current hidden boundaries.
   Record any additional complete census evidence for H8/9/12 separately from
   individual outline acceptance.
2. **Review par3 mowing corridors.** Stora H2/H6/H14 still have coarse generated
   fairway polygons; H10 has none. Determine dated material/edge evidence before
   replacing or retiring them. Review small differences on the retained greens
   against closer imagery without moving existing pin/card references.
3. **Trace infrastructure in focused windows.** Nine 520 m context panels showed
   generally plausible corridors, corner cutting and omitted wooded links. No
   new roads/trails were accepted. Work from visible centreline/width evidence
   with exact original-source assertions. Keep the three reviewed bridge decks
   and their approach connectivity intact. Hidden drainage needs stronger evidence
   than a terrain depression.
4. **Complete the other categories incrementally.** `scope.json` retains every
   requested category. Small equipment, building heights/use, rough/field/tall
   grass boundaries, drainage and individual species need appropriate records,
   dated imagery or field observations. A plausible rendered object is not proof.

## Evidence and tools

Accepted source files:

- `stora-surfaces-2025.json`: 12 fairways and H16 green; original shapes, manual
  pixel traces, exact projected panel extents and source hashes. Boundary
  interpretation uncertainty is 3 m for fairways, 4 m for H5 and 1 m for the green.
- `stora-tees-followup-2026-09-06.json`: four archive-assisted outlines, complete
  prior pad arrays and explicit retain/retire decisions. Uncertainty is 2–2.5 m.
  Years 2020/2023 identify municipal archive services; exact flight dates are
  unknown. All four were visually crosschecked against the 2025 product.
- `stora-tees-followup-terrain-2026-09-06.json`: evidence-only 1 m terrain
  measurements, separating drainage slope from residual planarity. Terrain and
  absolute source accuracy were not changed or inferred.

Local source rasters and browser captures are in the **ignored**
`upsalabuild/cache/review-2026-09-06/`. They remain on this machine but are not in
Git. `lm-latest/` contains the 2025 product (flight-year image inspected),
`municipal-2024/` the comparison imagery, and `tees-source-2020/` /
`tees-source-2023/` the historical windows. Every retained source record contains
the request URL, raster hash and georeference. Reacquire if absent and compare
hashes; a changed response requires a new review, not silently reusing old traces.

The municipal directory is
`https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto?f=pjson`.
Historical services are `ortofoto2020/ImageServer/exportImage` and
`Ortofoto_2023_1800/MapServer/export`. Their exact export requests are preserved
in the follow-up evidence; JSON export responses contain the raster `href`.

`geobuild/render-mapping-review.py` renders georeferenced raw/overlay pairs from
acquisition request records and verifies source hashes. Use `--panels report.json`
for identical comparison extents and `--evidence FILE` to inspect candidates.
It only writes beneath a cache directory. Its infrastructure mode covers the
fixed nine-panel Upsala context window, not an exhaustive whole-ground census.
`geobuild/render-tee-review.py --followup FILE` checks displayed current rings
against the model; `geobuild/render-stora-followup.py` produces the extra vector
comparison. Full acquisition examples are in [README.md](README.md).

## Rebuild on this Windows machine

Node dependencies are installed. A local ignored Python 3.12 environment exists
at `upsalabuild/cache/review-venv/` with pyproj, Pillow, numpy and matplotlib.
If absent, create an environment with those packages; `python` currently resolves
to a nonworking Windows app alias on this machine. The installed uv helper is
under `%TEMP%\upsala-mapping-tools`. No application dependency was added for it.

From the repository root, in PowerShell:

```powershell
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path upsalabuild/cache/review-venv/Scripts/python.exe).Path
node tools/refresh-upsala-mapping.mjs --python $env:COURSE_GEO_PYPROJ_PYTHON
npm test
node upsalabuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/upsala/pack.bin upsala3d.html upsalabuild
node tools/check-packs.mjs
node packages/course-geo/migrate-legacy.mjs --check --ground upsala
node packages/course-geo/check-manifests.mjs
node tools/lint-app.mjs
node geobuild/lint-page.mjs upsala3d.html
node packages/course-v2/check-app-build.mjs
node packages/course-v2/check-renderer-build.mjs
```

Check each exit code. The refresh driver stops on failure; do not hand-edit
generated packs, migration coordinates or registry hashes to bypass a failure.
On another platform use the documented PROJ toolchain or an explicit pyproj
interpreter. Projection agreement is not a survey-accuracy certificate.

For browser checks, first build as above, then run
`node tools/serve.mjs apps/golf/dist 8620` in a separate terminal. Chrome is at
`C:/Program Files/Google/Chrome/Application/chrome.exe`.

```powershell
$env:BANVY_GPU = '1'
node tools/check-app.mjs http://127.0.0.1:8620 --only=upsala,upsala-mellanbanan
node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --out upsalabuild/cache/next-v2-stora --course upsala --backend webgl2 --auto-fallback --q lo --graphics 1 --views 4:top:noon,16:green:noon --timeout 240 --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --out upsalabuild/cache/next-v2-mellan --course upsala-mellanbanan --backend webgl2 --auto-fallback --q lo --graphics 1 --views 1:green:noon,8:top:noon --timeout 240 --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

Use `--graphics 1`: the existing review tool's `default` assertion does not match
the new main default. Required-v2 captures use software WebGL2 for correctness;
they are not performance measurements. Allow terrain to settle and inspect the
images. Keep logs/captures in cache, preserve their hashes/cameras in the next
validation record, and record failures honestly.

Before finishing, update `scope.json`, the comparison sheets and validation,
inspect `git diff --check` / `git status`, and commit the completed source and
generated changes. Keep raw imagery out of Git. Do not push or deploy unless the
user asks. If main advanced, integrate it using main's versions for conflicts,
then reapply only compatible, evidence-backed branch changes and validate again.
