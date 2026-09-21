# Visby main-course bunker audit — 21 September 2026

Hole 3 was missing its southern fairway bunker and represented the approach bunker with only a small fragment. Its rebuilt model and runtime pack now contain all five observed bunkers.

The audit inspected all 18 main-course holes against native 0.16 m public Lantmäteriet WMS windows and the retained Caddee hole plans. The dated ledger is `visbybuild/mapping/bunker-review-2026-09-21.json`: exact image request grids, response hashes, native-pixel contours, previous polygons, ownership decisions and per-hole observations. Guide diagrams establish identity and topology only, never coordinates. Raw source images stay in ignored local cache and are not uploaded or shipped.

## Adopted changes

- Add 14 omitted physical sand areas on holes 2, 3, 4, 8, 9, 10, 11, 15 and 17.
- Replace eight incomplete or inaccurate contours on holes 3, 7, 8, 10, 14, 16 and 17.
- Remove two false bunker polygons over visible turf on holes 13 and 15.
- Assign 18 existing scenery bunkers to their main-course holes without moving their boundaries.
- Preserve three enclosed grass islands on holes 8, 10 and 14 through source geometry, migration, GPK1 packing, surface atlas, fallback meshes, classification and rangefinder queries.

The main-course hole inventory is now 81 bunkers; 15 other scenery contours remain. Total mapped sand polygons change from 84 to 96. Ownership totals do not duplicate neighbouring shared hazards shown in a hole guide.

| Hole | Before ownership | After ownership |
|---|---:|---:|
| 1 | 2 | 2 |
| 2 | 3 | 4 |
| 3 | 4 | 5 |
| 4 | 3 | 4 |
| 5 | 2 | 2 |
| 6 | 4 | 6 |
| 7 | 3 | 4 |
| 8 | 1 | 7 |
| 9 | 4 | 5 |
| 10 | 2 | 5 |
| 11 | 2 | 6 |
| 12 | 1 | 4 |
| 13 | 2 | 3 |
| 14 | 3 | 5 |
| 15 | 2 | 6 |
| 16 | 4 | 4 |
| 17 | 3 | 5 |
| 18 | 4 | 4 |

The latest bunker ledger runs after every historical geometry overlay, preventing regeneration from restoring superseded contours. Thirteen stand chunks add 321 exclusion flags (10 cells with eligible canopy); canopy measurements, all 3,040 individual crown records and terrain bytes remain intact. Tee references, greens, routes, water and other course models are unchanged. Stale optional prepared-render and startup pointers are invalidated by the pack publisher, so old cached geometry is not reused.

## Verification

- 58 Visby Node tests pass, including ordered regeneration, source-to-pack coordinate preservation and actual atlas samples at all five H3 bunkers and the three grass islands.
- Six shared surface-feature tests pass; production Vite build succeeds.
- Canonical polygons are valid, contain their grass islands, and have no bunker/bunker or own-green overlaps above 1 m².
- Visby source-manifest hashes, published graph, native terrain preservation, coastal-water checks and the 18-hole source-control plan pass.
- Final H3 source-image overlay inspected. Browser rendering could not be checked: local socket creation is denied and the environment rejects escalated execution. No fresh 3D screenshot or GPU performance claim.
- Repository-wide manifest/build gates require the other courses, which are absent from this isolated sparse checkout. Their content and index entries are unchanged.

## Remaining uncertainty

The mutable public WMS does not identify capture date or independent registration accuracy. Trace interpretation uncertainty is approximately 1 m. Canopy-obscured edges on holes 1, 5 and 16 remain unchanged; new traces on holes 8 and 16 follow visible sand only. The separate nine-hole course, practice inventory and unverified earthworks are outside this 18-hole audit. This is a source-image correction, not a survey.

## Reproduction

Acquire local review windows with `python visbybuild/mapping/acquire-bunker-review.py` (Pillow and NumPy). A later WMS response may differ; compare hashes before treating it as the reviewed image. Apply the dated overlays using `node visbybuild/mapping/apply-reviewed-facilities.mjs --write`; apply stand exclusions with `node visbybuild/mapping/orthophoto-vegetation.mjs --bunker-audit --write`. Rebuild the Visby pack, bounded catalog entry and migration, refresh the source manifest and source-control hashes, then rebind Visby's v2 routing to the new pack. Run `npm run check:visby` in a complete checkout.
