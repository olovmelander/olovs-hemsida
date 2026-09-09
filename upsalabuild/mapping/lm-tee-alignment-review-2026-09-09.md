# Upsala tee alignment — 9 September 2026

The rebuilt Stora and Mellan courses now use **83 corrected tee navigation
positions**, associated with physical platforms visible in authenticated
Lantmäteriet orthophotos captured **14 June 2025**. This corrects the coordinates
used by tee selection, the tee camera, and the rangefinder origin.

| Course | Physical platforms reviewed | Navigation positions moved |
| --- | ---: | ---: |
| Stora, 18 holes | 54 | 60 |
| Mellan, 9 holes | 24 | 23 |

[View the vector comparison](lm-tee-reference-changes-2026-09-09.svg).
Native before/after image panels remain in ignored `upsalabuild/cache/lm-tees/`
and `upsalabuild/cache/lm-tee-review/`.

## What was wrong

The physical pad polygons generally match the imagery. Older nominal tee
coordinates were interpolated along hole routes from scorecard distances.
This missed lateral platforms and put camera/rangefinder origins in rough,
beside paths, and beneath trees. Before this pass, 98 of 153 nominal references
were outside all mapped same-hole pads. The worst was approximately 95.5 m away.

The original pixel-to-course conversion was checked independently on 1,027
historical trace vertices; maximum numerical discrepancy was 1.33 mm. Runtime
pad inference is disabled for both courses. Translating the whole ground or
adding new rectangles beneath these old references would therefore be wrong.

## Accepted correction

The three review ledgers explicitly associate **126 references** with observed
platforms. Each association records its original coordinates, exact target ring,
source identity and maximum allowed movement. The helper places the reference
at least 1 m inside that chosen ring, retaining any position already satisfying
that clearance. This moved 83 positions, by at most **35.96 m**. There are now
**128 references on mapped pads**, compared with 55 before the correction.

Only nine route starts that originally coincided with their back-tee reference
followed the corrected position: Stora H1, H5, H7, H8, H9, H11, H12, H16 and H18.
Later route vertices and every scorecard value are unchanged. The longest
resulting difference between drawn route and card distance is 1.652% on H18.
The page gate checks the original 0.5% length tolerance, explicit bounded start
correction and unchanged later vertices; it does not stretch a route to recover
the old card-fitted endpoint.

All 78 physical pad footprints were retained. Stora H13's forward rectangle and
H15's upper rectangle remain provisional: canopy prevents a defensible complete
new boundary. H7/H9 also retain recorded shadow-edge uncertainty. **27 reference
decisions remain unresolved and unchanged; 25 of these are off-pad.** Several
are forward positions on short grass without a separate visible platform.
Other associations cannot be established under canopy. They were not moved
back onto unrelated platforms.

These are inferred navigation positions on reviewed platforms. Daily marker
locations, tee-colour assignments, present-day mowing and absolute survey
accuracy remain unverified.

## Evidence and rebuilding

- Decisions: [Stora front nine](lm-tee-review-front9-2026-09-09.json),
  [Stora back nine](lm-tee-review-back9-2026-09-09.json),
  [Mellan](lm-tee-review-mellan-2026-09-09.json).
- [Independent validation](lm-tee-alignment-validation-2026-09-09.json): all 27
  native source hashes and grids pass; every accepted association has at least
  1.004 m interior clearance and respects its movement bound. All retained
  references, card values, physical surfaces, scenery and later route vertices
  are unchanged. All 302 protected terrain/heightfield files are byte-identical.
- `lm-tee-acquire.py` records separate native tee windows in the four
  `geo_data/course-v2/upsala/reference/lm-tee-*-2026-09-09.json` ledgers. It uses
  the model's exact local frame, EPSG:3006 georeferences and explicit raster masks.
- `apply-upsala-lm-tee-references.mjs` validates the whole batch before mutation.
  Stora applies it after physical source mapping; Mellan selects its ledger
  through `reviewedTeeReferences` in `mellanbanan.json`.

Rebuild through `tools/refresh-upsala-mapping.mjs` with the existing pyproj
environment, then run `verify-lm-tee-alignment.py` and
`node upsalabuild/mapping/update-lm-manifest.mjs`. The independent validator
uses pinned pre-pass snapshots in ignored cache; retain these with the imagery.
The rebuild refreshes both models, packs, migrations, routing references,
standalone page and geographic export.

Validation for this pass: 32 focused tests and 11 relevant Node tests pass;
both canonical migrations, standalone geometry/card checks, pack/page identity,
all 12 pack/card checks, app/page lint and the production build pass.

The [runtime validation](lm-tee-runtime-validation-2026-09-09.json) passes in
both required-v2 and GPK1 modes for both courses. All **306 actual tee-button
selections** place the camera and rangefinder at the rebuilt reference, with
zero measured horizontal discrepancy. All **252 reviewed-platform selections**
sample tee surface and lie inside their designated pad. The 54 checks of retained
references preserve their original positions. Physical pad rings/counts remain
exact, and the served packs match both public and production-build hashes.
No browser errors were recorded. Ten screenshots across five viewpoints were
visually inspected; hardware ANGLE/D3D11 was used, without a performance claim.
