# Veckefjärdens GC — Mästerskapsbanan in 3D

One self-contained page, `veckefjardensgc.html`, that renders the championship course
in three.js. No build step, no dependencies to install. Everything — geometry, terrain,
shaders, UI — is in that one file.

## Running it

Open the file in a browser. It works from `file://`; a server is only nicer for repeated
reloads (`python3 -m http.server 8000`). It fetches three.js r185 from unpkg and three
faces from Google Fonts at runtime, so it needs a connection.

First load takes a few seconds: terrain → water → ~1900 trees → detail, then "ready".

## The two protected invariants

`node banguide/check.mjs` measures the page against the official course guide and
**exits non-zero** if either of these regresses. Run it after any change to `HOLES`,
the routing, or the terrain.

1. **Card data** — par, handicap index and all six tee distances for all 18 holes match
   the club's published guide exactly. 144 values, currently zero mismatches.
2. **Drawn hole lengths** — each `h.line` polyline measures its own back-tee distance to
   within 0.13%. Geometry work must preserve this.

Everything else the check prints is a target being worked toward, not a guarantee.

## Reference data

- `banguide/guide-card.json` — the card, transcribed from the official guide.
- `banguide/guide-inventory.json` — per-hole features read off the 18 guide plans:
  bunkers (with `approxFraction` 0 at the back tee, 1 at the green), water, marked
  penalty/OB runs with their real colour, green shape, treelines, and `guideBearingDeg`.
  `null` bearing where the rose was unreadable (hole 11) or absent (hole 13).
  Confidence is medium throughout — these came from phone screenshots of a dark site.

## Where the alignment work stands

The card is right and the hole lengths are right. The map is approximate. Current gaps,
worst first:

1. **Water is not modelled.** `STREAMS` and `WOODS` are empty, `PONDS` has one entry.
   The guide draws 56 water features. Holes 6 and 18 are literally named after a ditch
   and a brook that do not exist in the geometry.
2. **No penalty or boundary marking.** The guide has 63 marked runs (29 red, 19 yellow,
   15 white). The app has two bare `ob:'left'`/`'right'` strings.
3. **Routing is fixed at the clubhouse, still loose in the middle.** Holes 15–18 and 1 were
   re-anchored (phase 02): the closing walks went from 574/348/272 m to 77/80/87 m. What
   remains is the middle of the round — 7→8 is 172 m, 11→12 is 167 m, 5→6 is 162 m.
   Median is 90 m against a real-course 20–80 m.
4. **Corridors drift off the club's own map.** Mean 73% of centre-line samples land on
   mown turf in the embedded land-cover raster; 6 of 18 green centres are off turf.
   Some of this is honest — the southern fairways are genuinely narrow and the corridor
   width is a flat 24/26 m. Hole 4 at 43% is a real outlier.
5. **Bearings are good.** Hole 17 was 139° off its rose and was turned in phase 02; it now
   sits 6° off. 15 of 16 readable roses agree, mean error 9°. Only hole 7 remains at 39°,
   which is inside the reading error of a small dark rose.
6. **Missing guide furniture** — distance markers, "Next Tee", per-hole compass.

Phase 02 (routing and orientation) is done. The suggested next step is the water and the
penalty marking — gaps 1 and 2 — which is where the app starts to look like the guide.
`banguide/guide-inventory.json` already holds every feature, so this is data entry plus
rendering rather than research.

**Re-anchoring holes.** `solve.mjs` in the phase-02 work treated each hole as a rigid body
(translate + rotate about its midpoint), which preserves shape and card length exactly, and
scored candidate arrangements on four independent sources: the land-cover raster, the walk
distances a real course must have, the guide compass roses, and the overview marker
positions. Two lessons if you do it again: weight the walks heavily or the turf term wins
and leaves 130 m walks; and let the neighbouring hole move a little — freeing hole 15 by
39 m lifted 17 from 69% to 92% on turf and 18 from 76% to 87%.

## Things that will bite you

**Bearings.** North is **−z**, east is +x. A compass bearing is `atan2(dx, -dz)`, which is
what the page's own `bearingName` does. Using `atan2(dx, dz)` reflects every angle and
looks plausible — it produced a confident, wrong conclusion once already.

**Colour management (r185).** Three separate rules, and they disagree with each other on
purpose:
- Vertex colours go through `s2l()`/`L()` into raw `Float32Array` attributes. r185 reads
  those as linear working space, so this is already correct. **Do not "fix" it** — removing
  the conversion makes the turf too bright.
- Material colours from `Color(hex)` are converted by r185 automatically. Never add
  `convertSRGBToLinear()` on top; that darkens by ~2.8×.
- The water `ShaderMaterial` writes `gl_FragColor` with no tone-mapping or colour-space
  stage, and mixes its uniforms with sRGB-authored literals. Its uniforms are therefore
  built with `setHex(hex, LinearSRGBColorSpace)` to stay raw. Routing it through the
  standard output chunks washes the fjord out to near-white — that was tried.

**Module scope is strict mode.** The script is `type="module"`, so an implicit global
(assigning without `let`/`const`) throws instead of silently working.

**`turfStd` is the only live turf material.** `turfMat` is defined and never called — dead
code. `turfStd` reads `surf` plus the four per-vertex channels `aDet`/`aBmp`/`aGls`/`aStr`.
Gloss arrives through `roughnessFactor` because `specularStrength` has no meaning in the
standard BRDF; a `#include <specularmap_fragment>` replace silently matches nothing there.

**Surface ids** (the `surf` attribute, consumed by `turfStd`'s roughness table):
0 fescue · 1 first cut · 2 fairway · 3 green · 4 fringe · 5 tee · 6 sand · 7 cart path ·
8 hardpan · 9 pine straw · 10 wet shore.

## Editing this file safely

It is one ~188 KB file with some very long lines, and it has been destroyed once by blind
regex edits. What works:

- Never `sed`/regex blind. Use an anchored patch that **asserts its anchor matches exactly
  once** and aborts otherwise, applied to a copy first.
- Verify by rendering, not by reading. Load it headlessly, wait for `#boot.done`, then read
  the drawing buffer with `gl.readPixels` — mean luminance and percentage of near-black
  pixels catch a black screen that a screenshot glance can miss. Playwright and Chromium
  are usually available; serve over http or use `file://`.
- Static-check before trusting a change: extract the module body and run eslint `no-undef`
  in `sourceType: module`. That is how the nine identifiers deleted from the init block
  were found, and it would have caught the breakage immediately.
- Commit before large edits. `git log` on this branch has a checkpoint of the corrupted
  state for reference.
