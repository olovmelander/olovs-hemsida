# Visby source-image mapping pass, 9 September 2026

The 10 April 2026 Lantmäteriet flight now drives actual course geometry. This
pass uses 68 registered RGB extracts at their native 0.16 m pixel spacing,
including all 18 green and tee windows and a 30-tile environment mosaic.
Source raster and JPEG hashes, transforms and capture times are retained.
The acquired imagery is outside git and the application bundle.

| Layer | Adopted change | Remaining work |
| --- | --- | --- |
| Greens | Re-traced holes 3 and 9; hole 9's virtual target moved to the northern putting surface | Independent edge review for the other greens, collars and practice surfaces |
| Tees | Replaced H3 rear platform, added middle and forward platforms; 48 total physical pads | H12 platforms unresolved; other numbered associations and daily markers remain provisional |
| Fairways | Re-traced H3 southern corridor, separating it from the forward tee and water channel | Remaining mowing boundaries and fringe widths |
| Bunkers | 64 accepted native-pixel contours replace 45 old contours; 84 areas total, 19 net additions | Canopy, shadow, grass-island and ambiguous bare-ground cases retained for manual review |
| Trees and forest | 71 eligible canopy cells suppressed near revised turf/sand edges across 21 stand tiles; all 3,040 crown records retained | Full 2026 crown-change and forest-edge review; no surveyed stem or individual species claims |
| Buildings | 31 of 32 footprint overlays inspected; source-observed roof-colour families on 16 buildings | Wall footprints, additions and roof geometry/heights; aerial roof displacement is not a wall survey |

## Evidence and uncertainty

`orthophoto-review-2026.json` stores each accepted native pixel ring, source
hashes, prior contours to replace and deferred cases. Green/tee outlines were
traced manually. Bunker proposals used seeded GrabCut on the native pixels,
then visual source-overlay review; colour alone did not decide acceptance.
Grass islands and obscured sand connections were deferred rather than filled.
H3's faint fairway edge carries 3 m interpretation uncertainty; the sharper
traces generally carry 1 m. Pixel spacing is not positional accuracy.

Lantmäteriet attribution and CC BY 4.0 derivative terms are recorded in the
review. Caddee diagrams support numbered platform identity, never coordinate
scaling. No new daily flag or marker positions are asserted. Independent
survey control is still absent, so this is not a claim of perfect mapping.

`building-roof-review-2026.json` changes daylight roof-colour families only.
The checked vegetation field has no usable interior roof-height samples;
building heights remain explicitly generic. Roof colours are rendering
approximations, not calibrated material reflectance or facade observations.

## Reproduction and checks

`apply-reviewed-facilities.mjs --write` and the full course generator both apply
the dated orthophoto overlay after the historical source overlays. Reapplying
it must be idempotent. Rebuild the compatibility pack, source ledger and EPSG
migration, then run `tools/rebind-v2-routing.mjs` with the Visby build and
migration. The routing tool now respects native EPSG:3006 offsets: only two
moved endpoints need new samples from the published 1 m terrain.

Run `node visbybuild/mapping/orthophoto-vegetation.mjs --write` after rebinding.
It changes only stand exclusion bits. A cell half diagonal protects against
representative-tree jitter across the reviewed boundary. All fraction/height
channels, campaign flags, individual crown objects and terrain assets remain
unchanged. Its report records old/new chunks and the exact source-review hash.
Refresh `check-coastal-water.mjs --write` after changing the graph.

Validation includes `npm run check:visby`, routing regression tests, the app
build and `packages/course-v2/check-app-build.mjs`. Independent polygon checks
found valid rings and no bunker/bunker or bunker/green intersections over
1 square metre. These checks do not replace a WebGPU camera review. The cloud
browser in this session exposed neither WebGPU nor WebGL2, so no new GPU
acceptance screenshot is claimed. The depth-occlusion fix remains in PR #27.
