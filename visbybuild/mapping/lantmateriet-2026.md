# Visby authenticated orthophoto intake

The existing ground already uses 1 m Markhöjdmodell and 2024 Laserdata Skog.
The new work targets the four discovered RGBI images from 10 April 2026. The
previous authenticated attempt returned 403; downloading these sources must
be checked again after the account's orthophoto entitlement changes.

## Acquisition

`lm-ortho-plan.mjs` creates 22 bounded review windows: every tee area, the
third and ninth greens, range/practice facilities, and clubhouse/finish. It
records 40 of the current 108 camera references outside observed tee turf.
H12 receives a wider search window because its current point is explicitly a
virtual start. Window bounds are not inferred tee locations.

The windows use the imagery's native 0.16 m pixel lattice in EPSG:3006. They
cover about 35 megapixels in total, with a 16 megapixel limit per window.
The 1 m terrain and its local origin are not resampled or moved.

```sh
node visbybuild/mapping/lm-ortho-plan.mjs
python visbybuild/mapping/lm_ortho.py --plan visbybuild/cache/lm-ortho/plan.json --probe-only
python visbybuild/mapping/lm_ortho.py --plan visbybuild/cache/lm-ortho/plan.json
```

Python acquisition requires `rasterio==1.4.3` and `numpy==2.3.5`. It consumes
the established LANTMATERIET_USERNAME/PASSWORD environment variables, or
LANTMATERIET_BEARER_TOKEN. The GitHub workflow uses the existing repository
secrets and can also be started manually. No credentials enter the plan,
source URLs, reports or repository.

An HTTP success status is insufficient: the access check requires a 16-byte
TIFF header, HTTP 206, a matching Content-Range and the pinned asset size. An
empty HTTP 200 gateway response does not count as imagery. The reader checks
source CRS, bounds, resolution, dimensions and four channels against discovery,
then verifies the actual output transform. It refuses blank image windows.
Repeat reads reuse a local crop only when its request and file hashes match.

`--only hole-12-tees,hole-09-green` limits a local intake. Each window has a
separate raster and evidence record. The final `acquisition.json` records
success, denial or partial failure independently from the old source manifest.
A denial exits nonzero and cannot silently replace the accepted geography.

Raw images and locally rendered overlays stay under `visbybuild/cache/`.
GitHub exports only the plan and aggregate acquisition metadata, then deletes
the runner's images. It does not publish imagery or move playing surfaces.
A workstation with the same account can reproduce the exact windows for
source-image review and digitisation.

## Adoption order

1. Resolve H12's physical start and numbered platforms from imagery and the
   club guide together. Revisit H3 against the post-rebuild image.
2. Separate H9's putting surface from its approach. Preserve the current ring
   until the source supports a defensible replacement.
3. Check the remaining tee associations, practice facilities and current edges.
4. Apply accepted vectors through the existing authoring overlays, regenerate
   packs/migration and run Visby's source, coastal-water and runtime gates.

The 2026 imagery and 2024 laser/terrain have different epochs. Pixel spacing
is not positional survey accuracy, and imagery alone cannot establish daily
markers, species, bunker depth or hidden equipment.
