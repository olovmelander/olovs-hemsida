# Norrfallsviken orthophoto alignment — 2026-09-09

The local app pack and standalone page now consume a reviewed Lantmateriet geometry pass. This is a substantial alignment update, not a claim that every feature has surveyed or current-day precision.

## Source and coordinates

Live STAC discovery found **orto-u2-2024** to be the newest published coverage of the reviewed course. All 23 acquired windows use imagery captured **2024-06-27**, with 0.16 m native RGBI pixels; the overview is 0.8 m. The source-image mosaic confirms that date throughout the review. Acquisition, transforms, source hashes, source-pixel traces and verification reports are retained under `geo_data/course-v2/norrfallsviken/reference/` and `nvgkbuild/mapping/`. Raw imagery remains in the ignored local cache.

Every accepted trace passes through EPSG:3006 and the existing frozen local frame. There is no fitted image shift and no stretching to match scorecard distances. Millimetre conversion consistency measures the transformation, not the positional accuracy of a photograph. See [the acquisition record](../../nvgkbuild/mapping/lm-ortho-2026-09-09.md).

## Changes in the local build

| Area | Implemented |
|---|---|
| Putting surfaces | All 18 hole records retraced. Holes 4 and 8 now share one continuous putting surface, with separate lobe references. The former hole-8 green over woodland is removed. Daily cup locations remain illustrative. |
| Tee platforms | 32 visible physical platforms retraced, preserving measured terrain. Synthetic rectangles around unsupported card references are disabled. |
| Tee markers | Explicit platform references, separate marker colours, platform containment and forward camera bearings. Unsupported colour associations produce no physical markers. Invalid inherited Orange references in the hole-14/17 ponds retain separate dry navigation anchors. |
| Fairways | 17 visible mown corridors retraced; the short hole 14 has no new fairway polygon. Mowing transitions, drought and shadows leave approximately 1–3 m interpretation uncertainty in places. |
| Bunkers | Four clearly visible missing bunkers added beside greens 1, 11, 15 and 16. |
| Water | Pond outlines near holes 14 and 17 corrected. Existing sea level and other water bodies retained. |
| Range | Curved field boundary, practice green, hardstanding, twelve individually traced mats and three target surfaces. Removed synthetic circular target greens and inferred range flags. |
| Buildings/facilities | Two missing sheds, blue sports court, access path and drainage centreline added. Clubhouse has two roof sections, solar-panel footprints and terrace geometry. Walls retain the OSM ground footprint; roof heights, windows and railing details are display estimates. |
| Coast and surroundings | Storsanden and adjoining coastal windows inspected. Existing broad beach, coastline, road and trail mapping retained where it agrees; these were not all individually retraced. The OSM course-boundary multipolygon parser now retains its outer boundary and island. |
| Trees/forest | Existing 2025 laser terrain, 13,050 individual tree records and measured forest stand fields preserved. Eight turf/vegetation overlap candidates were visually reviewed and retained as real canopy/edge uncertainty. No tree-centre or plantable-cell-centre conflict was found on reviewed greens or tee platforms. |

The four review files contain **101 feature records** (including the shared green in both hole records). The source model retains their identities and evidence. The published app and standalone page contain identical compressed vector and heightfield streams.

## Remaining precision limits

- Photography from June 2024 cannot establish whether proposed 2026 tee works are now built. It also cannot establish today's movable markers, tee-colour ownership, daily cups or hidden objects.
- Hole 7's visible rear platform lies about 143 m from its green, while the later scorecard publishes 110/91/72 m. Its colour ownership remains unresolved; the physical deck is mapped without inventing marker positions. Forward references on other holes are unresolved where the source does not establish their platforms. Hole 5's two nearby platforms do not prove the 63 m shorter Red/Orange location.
- Other rear/forward platform associations remain explicitly interpreted. Scorecard differences are reported, with the largest current Yellow route difference about 12.7% on hole 16. Image geometry is not distorted to hide that discrepancy.
- Fairway-edge rough fingers beneath canopy need closer control. Forest species, dense-stand representative tree positions and facade details are render interpretations. Exact roof height, drainage depth and obscured trail continuations require other measurements.
- The canonical-origin independent-control gate remains pending. This update does not certify survey accuracy or exhaustive estate completeness.

## Validation

- 23 source windows: raster/RGB hashes, exact grids, valid masks, PNG/TIFF equality, capture-date coverage and 75 overlapping native-window pairs passed.
- 101 review records across 57 panels: independent PROJ/Shapely validity, affine reproduction, source coverage, adoption within 3 mm, green/bunker separation, shared-green identity and nominated-platform containment passed.
- Model/runtime tests cover coordinate rejection, absence of invented decks, marker containment and colour separation, direction of play, shared green, boundary-island migration and finite clubhouse/facility meshes.
- All 90 official par/index/tee values remain unchanged. The pack and page streams match byte for byte; the standalone module passes `no-undef`.
- Eight existing Norrfallsviken graph tests passed. All 469 terrain chunks, routing and fallback pack verify end to end; frame and ground-manifest hashes are unchanged.
- Production Vite build passed. Browser checks passed for exact loaded green/platform rings, tee references, custom clubhouse, twelve mats, marker count and ready v2 terrain, without page errors. Eight views were captured under `nvgkbuild/cache/lm-browser/`.

## Rebuild and inspect

Run the four `build-*-review.py` authoring scripts only when intentionally regenerating their source-pixel ledgers. Normal publication:

```powershell
node nvgkbuild/reconcile.mjs
node --test nvgkbuild/mapping/orthophoto-review.node-test.mjs
node nvgkbuild/embed.mjs
node packages/course-pack/emit-pack.mjs nvgkbuild apps/golf/public/courses/norrfallsviken norrfallsviken
node packages/course-pack/emit-manifest.mjs --only=norrfallsviken
node nvgkbuild/mapping/update-source-manifest.mjs
$env:COURSE_GEO_PYPROJ_PYTHON=(Resolve-Path 'upsalabuild/cache/review-venv/Scripts/python.exe').Path
node packages/course-geo/migrate-legacy.mjs --write --ground norrfallsviken
node tools/rebind-v2-routing.mjs --slug norrfallsviken --build nvgkbuild --migration geo_data/course-v2/norrfallsviken/migration/course-model.epsg3006.json --write
node nvgkbuild/mapping/update-source-manifest.mjs
```

If the model changes, also refresh its Norrfallsviken checksum in `packages/course-geo/acquisition/hole-source-controls.mjs`. Run `verify-orthophoto-review.py` with all four review files, `audit-vegetation.mjs`, `check3d.mjs`, `check-pack.mjs` and `check-norrfallsviken-v2.mjs` before publication. `check-browser.mjs <local-app-url>` captures the rendered course. No remote deployment was performed.
