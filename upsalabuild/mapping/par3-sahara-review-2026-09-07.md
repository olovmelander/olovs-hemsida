# Stora par3 corridors and the missing Sahara bunker

Reviewed on 7 September 2026. Accepted decisions are in
[stora-par3-sahara-review-2026-09-07.json](stora-par3-sahara-review-2026-09-07.json).
The [vector comparison](stora-par3-sahara-review.svg) contains no source photography.

| Hole | Decision | Evidence and practical effect |
|---|---|---|
| 2 | Retire the 2,653.20 m² coarse fairway polygon | Both 2024 and 2025 show the polygon crossing a paved path, rock and heterogeneous vegetation. Its outline does not represent a visible continuous fairway. |
| 6 | Retire the 5,703.69 m² coarse fairway polygon | Both years show a path crossing the polygon and heterogeneous grass between the tees and green. The maintained oval east of the green remains a separate classification question. |
| 14 | Retire the 1,151.00 m² coarse fairway polygon | The old polygon encloses tree canopies, heterogeneous grass and part of a bunker. Neither reviewed product supports its boundary as fairway. |
| 8 | Add the missing 85.98 m² Sahara bunker | Exposed sand is visible in both products. The 2025 sand edge supplies the accepted 30-vertex outline; estimated boundary interpretation uncertainty is 1 m. |

Retiring a polygon withdraws an unsupported fairway classification. It does not
establish an exact rough type, mowing height or replacement vegetation boundary.
The existing default ground and separately mapped objects remain. Hole 10 already
has no fairway polygon and is unchanged. Accepted par4/5 fairways and earlier
green, tee, pond and bunker corrections remain intact.

## Sources and geographic reproducibility

The Lantmäteriet 2025 orthophoto is served through the advertised Uppsala municipal
WMS. The comparison product is the municipality's 2024 orthophoto. Each decision
retains the relevant full source request URL, SHA-256 digest, EPSG:3006 extent,
export dimensions, native resolution and original acquisition timestamp. The
source rasters were reacquired on 6 September 2026 and verified by the review
renderer on 7 September. Source photographs remain only in the ignored cache.
Product years do not establish exact flight dates or absolute horizontal accuracy.

The club's [23 November 2022 letter](https://upsalagk.se/news/brev-fran-ordforanden/)
identifies the new Sahara bunker left of the eighth green, replacing a removed
tree. This confirms identity and historical construction; the two georeferenced
orthophotos determine the observed position and sand outline. The news article
does not provide survey coordinates.

The raw/overlay image pairs are in
`upsalabuild/cache/review-2026-09-07/surface-review/source-2025/` and
`source-2024/`. Each panel is 720 × 720 pixels with a 44-pixel title header.
The trace records exact source-panel pixels. EPSG:3006 coordinates are transformed
through pyproj into the model's declared latitude/longitude frame, with local
vertices rounded to 1 mm. No fitted registration is applied. A separate JavaScript
projection reproduces each trace and observation within 5 mm; this checks the
conversion, not absolute geographic accuracy.

The red Sahara outline was visually checked against both dated products in
`candidate-2025/h08-green.png` and `candidate-2024/h08-green.png`. Sand is exposed
around its complete perimeter. No bunker depth, rake position or grass-collar
boundary is inferred. The focus here does not constitute a full bunker census.
The already reviewed hole 16 correction was retained.

## Integration and validation

Apply `applyReviewedStoraPar3Sahara` from
`tools/apply-reviewed-stora-par3-sahara.mjs` after the existing Stora surface pass
in `upsalabuild/ground-mapping.mjs`. Pass the accepted JSON above, then use the
normal shared-ground rebuild so Mellan receives the same ground geometry.
The helper checks all original shapes, the H8 original empty bunker census,
accepted statuses and both dated source records before mutating anything.
Only local rings and whitelisted metadata enter the runtime model; source-frame
geometry stays in the evidence file.

Five focused tests in `tests/upsala-par3-sahara.test.mjs` pass. They check complete
batch rejection on stale evidence, preservation of all unrelated model data,
independent source-coordinate reproduction, no recreated retired fairway, exact
Sahara rendering without smoothing and no source-coordinate leakage. The root
integration validation must also run the repository, pack, migration and browser
checks on both rebuilt course models.

Regenerate the photograph-free sheet with:

```powershell
upsalabuild/cache/review-venv/Scripts/python.exe geobuild/render-stora-par3-sahara.py
```

Future review should use a wider window for the maintained oval east of H6 green
and establish whether it is a forward tee, an approach or another maintained
surface. Do not assign it a material from shape alone. More recent dated imagery
or field observations are still needed to assert the state in September 2026.
