# Veckefjarden orthophoto alignment, 2026-09-09

The course now applies 82 explicit review decisions from Lantmateriet's
`orto-u2-2024` campaign, photographed on 27 June 2024. Live catalogue discovery
found this to be the newest complete campaign for the course. Sixteen retained
RGBI crops cover the 2049 m playing-ground square at native 0.16 m resolution.
The actual COG affines and source pixels were checked. No fitted translation,
rotation or scale was applied to the photography or terrain.

## Adopted changes

`lm-ortho-review.json` is the rebuild input. It records the original geometry
hash, reviewed source pixels, exact panel affine, local-coordinate rings,
source/image hashes and interpretation uncertainty for each decision.

| Decisions | Count | Result |
| --- | ---: | --- |
| Greens | 16 | Full observed putting boundaries replace plan/OSM outlines; H2 and H10 retained pending clearer edges. |
| Bunker records | 30 | Sand boundaries corrected, including a missing H15 greenside bunker; shared H12/H13 and H16/H18 identities use the same physical outline. |
| Individual tee pads | 27 | Photographed platform boundaries corrected on H8–13 and H15–18. |
| Tee inventories | 6 | H1–6 synthetic/misassociated inventories replaced by 16 photographed platforms and one explicitly retained historical H6 OSM platform. |
| Fairways | 3 | H9, H11 and H13 mowing boundaries corrected. |

There are 92 source-traced rings and one historical retained ring across the
82 decisions. Twenty-eight tee reference associations on H1–6 are provisional
associations with photographed platforms. Existing references inside their
nominated platform stay fixed; exterior references move to its nearest edge
with a small inward offset. In particular, H6's fifth reference moves out of
the pond onto its photographed forward platform. These are camera/reference
positions, not a claim to know daily tee-marker locations. Official scorecard
values remain separate from measured routing lengths. The course no longer
moves those reviewed starts to force agreement with the card.

The app and standalone viewer preserve mapped boundaries and the existing
terrain beneath reviewed platforms. H1–6 suppress automatic rectangle creation
under unresolved references without claiming complete platform inventories.
Championship scenery is rebuilt into the short course. Both published course
graphs share one ground. Terrain, its frame and all 277 terrain references are
unchanged. The vegetation update adds 888 excluded stand cells in 18 tiles;
1,821 individual crowns are preserved, with no crown centres intersecting the
accepted playing surfaces.

## Limits that remain open

- H2's green/approach join and H10's shaded green boundary were not replaced.
- H1–6 references left unresolved are respectively: 6; 4; 5/6; 2; 4/6; 6.
  Across all 18 holes, 80 of 108 numbered references lack an independently
  resolved photographed-platform association. This includes unchanged older
  references on H7–18; their pad edits do not certify marker associations.
- H6 retains one shadow-obscured OSM platform with its historical provenance
  and 3 m interpretation uncertainty. It is not counted as a source trace.
- Other fairways, shaded platforms, indistinct apron boundaries and extra
  platforms without a reliable hole association retain their previous geometry.
  Detailed decisions are in the component decision/limit JSON files.
- This pass does not certify every short-course surface, shoreline, path,
  building, vegetation boundary or hidden object. The short course receives
  updated shared scenery; its own routing remains unchanged.
- Native pixel spacing is not absolute survey accuracy. Source absolute
  accuracy remains unknown; adopted boundary interpretation uncertainty is
  0.4–3 m. A perfectly surveyed alignment is not established by this review.

## Evidence and checks

`geo_data/course-v2/veckefjarden/acquisition/ortho-alignment-audit.json` independently
checks all 82 decisions against the actual rebuilt model, 1,369 source vertices,
7 contributing native TIFF hashes, 48 panel hashes and 432 recomputed RGB sample
values. The maximum centimetre-storage quantization error is 0.00701 m. This
small numerical residual does not measure the interpretation or source accuracy.

The full acquired square contains 16 TIFFs; only seven contribute to adopted
traces. `ortho-grid-verification.json` checks all acquisition windows, including
80 exact provider-to-crop RGBI samples. Raw photography, plain/overlay review
panels and contact sheets remain in ignored `geobuild/cache/` directories.

Verification completed: 32 focused Node tests, 5 Python affine/coverage tests,
source-manifest validation for Veckefjarden, scoped migration consistency,
pack/page/card equality, and browser acceptance of both course slugs through
their default v2 and explicit GPK1 paths. The global source-manifest check also
reported unrelated in-progress Angso/Johannesberg checksum mismatches.
The Vite production build succeeds. The repository-wide built-asset gate is
blocked by Johannesberg's in-progress GPK1/v2 fallback mismatch; Veckefjarden's
packaged graphs are checked separately.

The first vegetation application is retained in
`vegetation/lm-ortho-exclusion-initial.json` under the ground data directory;
`lm-ortho-exclusion-review.json` records the final publication after metadata
line endings were normalized. The latter adds no further cells.

## Rebuild

Use the checked-in canonical ledger for routine rebuilds. Re-running pixel
conversion requires the original pre-review model (the independent audit pins
its Git revision), not a newly rebuilt model used as a fresh baseline.

```powershell
node geobuild/reconcile.mjs
node tools/build-nine.mjs geobuild/korthalsbanan.json
node geobuild/embed.mjs
node geobuild/check3d.mjs
node packages/course-pack/emit-pack.mjs geobuild apps/golf/public/courses/veckefjarden veckefjarden
node packages/course-pack/emit-pack.mjs veckefjardenkortbuild apps/golf/public/courses/veckefjarden-korthalsbanan veckefjarden-korthalsbanan
node packages/course-pack/emit-manifest.mjs --only=veckefjarden
node packages/course-pack/emit-manifest.mjs --only=veckefjarden-korthalsbanan
node geobuild/mapping/refresh-ortho-sources.mjs
$env:COURSE_GEO_PYPROJ_PYTHON=(Resolve-Path geobuild/cache/ortho-venv/Scripts/python.exe).Path
node packages/course-geo/migrate-legacy.mjs --ground veckefjarden --write
node geobuild/mapping/refresh-ortho-sources.mjs
node tools/rebind-v2-routing.mjs --slug veckefjarden --build geobuild --migration geo_data/course-v2/veckefjarden/migration/course-model.epsg3006.json --write
node tools/rebind-v2-routing.mjs --slug veckefjarden-korthalsbanan --build veckefjardenkortbuild --migration geo_data/course-v2/veckefjarden/migration/short-course-model.epsg3006.json --write
node geobuild/mapping/refresh-ortho-vegetation.mjs
node geobuild/mapping/refresh-ortho-vegetation.mjs --write
```

The vegetation publisher validates both models, packs, migrations and routings,
then writes immutable resources before replacing the shared root. Do not run
the original terrain compiler for these vector-only edits.
