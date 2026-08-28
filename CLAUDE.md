# Veckefjärdens GC — Mästerskapsbanan in 3D

Two pages render this course, from two different ideas of where it is.

**`veckefjarden3d.html` is the current one.** It puts the course on the ground it
actually stands on: real elevation, OpenStreetMap's surveyed outlines, the club's GPS
survey, and the official guide, reconciled by `geobuild/` and baked into the page. It
is the one to work on. See "The georeferenced page" below.

**`veckefjardensgc.html` is the older one**, and everything in this file from "The two
protected invariants" down to "Editing this file safely" is about it. It draws the same
course in an arbitrary local frame fitted from the guide, which is the root of every
alignment problem its notes describe. It still runs, its checks still pass, and its
`HOLES` prose and hole names were carried into the new page — but new work does not
belong in it.

One self-contained page each. No build step, no dependencies to install.

## The georeferenced page — `veckefjarden3d.html` + `geobuild/`

Open it in a browser; `file://` is fine. It fetches three.js 0.185.1 from unpkg and two
faces from Google Fonts, so it needs a connection. It runs on the WebGPU build, which
also drives its whole node-material pipeline on a WebGL2 backend, and the header says
which one it got. Boot builds terrain → surfaces → water → forest → light, about two
seconds on a real GPU.

### Where the geometry comes from

Four independent records, fused by `geobuild/reconcile.mjs`:

| source | covers | used for |
|---|---|---|
| OpenStreetMap | 12 of 18 championship holes, the 9-hole short course, the shoreline | every outline it has: greens, fairways, 53 tee pads, 32 bunkers, forest, paths, buildings |
| the club's GPS survey (`geo_data/`) | all 18 holes, 5 points each | green centres and back tees, and all the geometry on the six holes OSM never mapped |
| the banguide | all 18 | the card, verbatim; bunkers OSM lacks; hole names and prose |
| AWS Terrarium elevation | everything | the ground, and every water level |

They agree where they overlap, and each check involves data that never entered the
thing it checks: GPS green centres land 2.1–4.5 m from the OSM outlines; the drawn
lines measure their card length to 0.02%; the elevation model reproduces the guide's
printed "Spelas 28 m uppför" to a mean of 2.8 m over the 13 holes that print one; and
every hole points the way its plan's compass rose says, median 2°.

**Holes 1–5 and 7 are not in OSM.** Their greens, fairways and bunkers are instead
read off the club's own hole plans — which are drawn on aerial photography, making
them geodata nobody had digitised. Each plan is registered to the world by its two
known anchors (the back-tee disc and the pin), a similarity transform that the plans'
own compass roses corroborate to a few degrees. The reading and the mathematics are
split across `plan-shapes.json` (pixel outlines, read by eye at 4× zoom) and
`apply-shapes.mjs` (registration + gates). Holes 13 and 17 were traced **blind** and
compared against their OSM survey to measure the whole chain: green centres land
5–6 m off, areas within ±15% after a bias correction that was itself measured on
that pair (the reader traces the green complex at ~2.1× the putting surface, so
traced greens shrink toward their centroid by 1/√2.1). These carry `prov:"plan"`;
anything still synthesised carries `prov:"synth"` and is hatched in `design.svg`.

**The trees come from the same plans.** `build-treecover.py` classifies each plan's
orthophoto (per-plan calibrated darkness + a canopy post-pass that tells shadowed
conifer, sunlit crowns and the blue-dark shore band apart from dark mottled rough) into
`tree-cover.json`, a 3 m raster the page's planter reads where OSM drew no forest. The
club's overview map was tried first and rejected — it is warped 40–70 m locally and
calls 42% of known mown turf forest. Don't go back to it. `check-treecover.mjs` holds the
labelled probe set — places on the plans a person looked at and named — and exits non-zero
if verified forest stops being forest or the open-ground residual grows past its accepted
five, all of them corridor-adjacent ground the planter's own distance guard suppresses.

**The card-length fit is a statement about the tee, not a fudge.** Every line came out
3–10% short of its card. Rather than stretch surveyed geometry, the tee end slides back
along its own axis until the polyline measures what the club prints — which is where a
back tee is by definition. The slide is 3–31 m and lands within 3–18 m of a mapped tee
pad on most holes, so it is finding real tees.

### Running the pipeline

    node geobuild/vendor.mjs          # cache the CDN for the screenshot harness
    node geobuild/fetch-osm.mjs       # api.openstreetmap.org/api/0.6/map, not Overpass
    node geobuild/fetch-dem.mjs       # Terrarium z15 core + z12 vista
    node geobuild/parse-osm.mjs       # -> osm-features.json
    node geobuild/build-heightfields.mjs   # -> heightfields.json, and the water levels
    node geobuild/reconcile.mjs       # -> course-model.json, and the agreement report
    node geobuild/apply-shapes.mjs    # plan-traced shapes -> traced-holes.json (needs reconcile's frame)
    node geobuild/reconcile.mjs       # second pass folds the traces in
    python3 geobuild/build-treecover.py    # hole-plan imagery -> tree-cover.json (the forest raster)
    node geobuild/check-treecover.mjs # raster vs the labelled imagery probes; exits non-zero
    node geobuild/render-design.mjs   # -> design.svg, the layout to review before 3D
    node geobuild/embed.mjs           # bake it into the page
    node geobuild/check3d.mjs         # exits non-zero on a regression
    node geobuild/shot.mjs veckefjarden3d.html out.png --hole 14 --cam tee

Caches live in `geobuild/cache/` and are gitignored; the reconciled JSON is committed.

### What check3d protects, and what it only measures

It **exits non-zero** on six things, because each is a claim the page makes about a real
course that would be false if it broke: the card is the club's card (144 values exact);
every hole measures its card length to 0.5%; every OSM-sourced green still sits within
6 m of its OSM outline; no green or tee is under water; the heightfield the page decodes
is the one geobuild encoded; and the page's embedded data is the current model.

Everything else it prints — elevation and bearing agreement, corridor separation, bunker
provenance — is a measurement, not a gate. A checker that fails on targets is a checker
people switch off.

### Things that took a while to find

- **`normalMap` needs UVs and tangents.** These meshes are built from world coordinates
  and carry neither, so the turf silently had no relief at all. `bumpMap` differentiates
  the sampled value in screen space and needs nothing.
- **Detail written as a multiplier around 1 cancels itself.** Three taps averaging 0.5
  each, applied as `col * (0.82 + micro*0.4)`, came to a half-percent modulation. Centre
  it on zero first.
- **Texture scale is most of whether a texture exists.** At a 1.5 m tile the turf
  detail averaged to flat grey past ten metres, which is where a golfer is looking.
- **Mow stripes must be per pixel.** Baked into vertices 4 m apart they beat against
  their own sampling. The mesh carries a mow coordinate; the shader computes the band.
- **`OrbitControls.maxPolarAngle` forbids the camera from sitting below its target**,
  which threw it 30 m into the air on the 1st tee — a hole that climbs 26 m. Clamp the
  camera against the terrain each frame instead.
- **Every carve must be continuous through its own edge.** The first bunker profile
  dropped 0.32 m crossing inside and rose 0.34 m just outside; on a 4 m grid that
  two-thirds-metre cliff tore into jagged flaps around every bunker. Same for shorelines.
- **A skirt at a level-of-detail seam is a vertical wall**, and a vertical wall a
  kilometre off catches a low sun and draws a bright line across the hills that reads as
  a road cut. Tuck each coarse level under the finer one instead.
- **A 4 m grid cannot hold a 2 m cart path.** Painted into the terrain the path network
  bled to 20 m of brown and read as dry riverbeds. Paths are ribbons.
- **Overpass resets on large geometry responses here**; the raw OSM map API does not.
- **Chromium cannot complete a TLS handshake through this environment's proxy**, so
  `shot.mjs` replays the CDN from `geobuild/cache/vendor` via `page.route()`. curl works,
  which is how the cache gets filled.
- **Under software rendering the page draws about twice a second**, so a 1.5 s camera
  tween is still in its second frame when the shutter opens. `setCam(mode, true)` moves
  instantly; the harness uses it.

## Running the older page

Open `veckefjardensgc.html` in a browser. It works from `file://`; a server is only
nicer for repeated reloads (`python3 -m http.server 8000`). It fetches three.js r185
from unpkg and three faces from Google Fonts at runtime, so it needs a connection.

First load takes a few seconds: terrain → water → ~1900 trees → detail, then "ready".

## The two protected invariants

`node banguide/check.mjs` measures the page against the official course guide and
**exits non-zero** if either of these regresses. Run it after any change to `HOLES`,
the routing, or the terrain.

`node banguide/geomcheck.mjs` is the other half. Counting features is not checking them, so
this one asks whether they are on the side the guide draws them, on top of each other, or on
top of a tee. Both take an optional path, so a candidate can be checked before it is installed.

1. **Card data** — par, handicap index and all six tee distances for all 18 holes match
   the club's published guide exactly. 144 values, currently zero mismatches.
2. **Drawn hole lengths** — each `h.line` polyline measures its own back-tee distance to
   within 0.13%. Geometry work must preserve this.

Everything else the check prints is a target being worked toward, not a guarantee.

## Rebuilding the course furniture

The generators live in `banguide/` and read the page rather than assuming things about it:
`lib.mjs` parses `HOLES`, the land-cover raster and the page's own lateral normal out of the
target. Each generator takes `[target.html] out.json`; each apply script takes
`in.html out.html data.json` and finds what it rewrites by counting brackets, never by regex.

    node banguide/solve-routing.mjs 2,3 220000 7 solved.json   # only when a hole must move
    node banguide/apply-lines.mjs   cand.html  moved.html solved.json
    node banguide/gen-water.mjs     cand.html  water.json
    node banguide/gen-ob.mjs        cand.html  ob.json
    node banguide/apply-water.mjs   cand.html  next.html  water.json ob.json
    node banguide/gen-bunkers.mjs   next.html  bunkers.json
    node banguide/apply-bunkers.mjs next.html  final.html bunkers.json

Order matters: re-anchoring comes first because water, out-of-bounds and bunkers are all keyed
to where the holes are; then bunkers dodge water, so the water has to be in the file before they
are generated. `gen-water` writes the guide's side onto every left/right feature as `s`, and
geomcheck's water-side test reads that — so the built geometry is checked against the
guide's own words rather than against the generator's arithmetic.

## Reference data

- `banguide/guide-card.json` — the card, transcribed from the official guide.
- `banguide/guide-markers.json` — where the club's own overview map puts each hole, in world
  metres. The overview plots a numbered disc per hole, and those discs sit on the hole
  **midpoints**: mean 46 m from the midpoint, against 185 m and 190 m from the tee and the
  green. That makes them the strongest anchor we have for where a hole belongs — better than
  the compass roses, which were read off dark screenshots. Regenerate with
  `python3 banguide/register-map.py <overview.jpg>`, which fits a scale-and-translate from map
  pixels to world metres by matching turf masks, then reports water and forest agreement as
  checks that never entered the fit (water lands at 0.92, so the fit is sound).
- `banguide/guide-inventory.json` — per-hole features read off the 18 guide plans:
  bunkers (with `approxFraction` 0 at the back tee, 1 at the green), water, marked
  penalty/OB runs with their real colour, green shape, treelines, and `guideBearingDeg`.
  `null` bearing where the rose was unreadable (hole 11) or absent (hole 13).
  Confidence is medium throughout — these came from phone screenshots of a dark site.

## Where the alignment work stands

The card is right, the hole lengths are right, and every feature that has a side is now on
it. The map is still approximate. What `geomcheck` fails on, worst first:

1. **Holes overlap.** 12 and 13 run 1 m apart, 17 and 18 about the same, 16 and 17 at 3 m.
   Three greens sit inside another hole's corridor — green 16 is only 3 m off hole 17's
   centre line. `solve-routing.mjs` fixes these the way it fixed 2 and 3; it just has not
   been run on them yet.

   **2 and 3 are done.** They crossed at [-413, 713] — 78% down the par 5 and 18% off the
   3rd tee, so the drive at the 3rd flew over the 2nd's approach. Hole 3 was turned +18.9°
   and shifted 22 m, which put its midpoint 13 m from the club's marker (was 23 m), cut its
   error against the compass rose from 27° to 8°, and opened the pair from 2 m to 56 m.
   Hole 2 barely moved: 5 m and half a degree. Four solver runs with different free
   variables all landed on +17 to +21° for hole 3, so the number is not a fluke of one fit.
2. **Water is a set of craters.** `terrainH` floods each feature to an absolute `-wd` and
   `buildWater` writes every surface vertex at `y=0`, so a pond on a hillside is a pit
   with a sheet of water at sea level laid across it. Each feature needs a local water
   level read off the terrain around it, and its own surface height.
3. **Four tees stand in water**, and one does not play its card distance: the page walks a
   wet tee pad sideways onto dry ground but the card length is measured from where the pad
   was meant to be.
4. **Two water features are nearer another hole than the one they are tagged to.** The
   green de-collision pass pushes them further than it needs to.
5. **Corridors drift off the club's own map.** Mean 72.5% of centre-line samples land on
   mown turf; 6 of 18 green centres are off it. Phase 05 measured whether refitting helps:
   twelve of eighteen holes want no change and a full refit moves mean F1 only 0.493 →
   0.539, so most of the residual is the raster being coarse and the four par 3s having no
   corridor to fit. Hole 16 at 62%, with 16% of its corridor in forest, is the one genuine
   outlier. **If you sweep this again**: assign each turf cell to its nearest hole first, or
   the fit hits the search bounds on every axis and asks for 80 m corridors shifted 34 m.
6. **The middle of the round still walks a long way.** The closing holes were re-anchored in
   phase 02 and the walks there went from 574/348/272 m to 77/80/87 m, but 7→8 is 172 m,
   11→12 is 167 m and 5→6 is 162 m. Median 90 m against a real course's 20–80.
7. **Bunker angles are all zero.** The guide gives no orientation, so every bunker is
   axis-aligned. Cosmetic, but it is the most obvious tell that the set is generated.
8. **Hole 7 reads 39° off its rose.** That is inside the reading error of a small dark
   rose, and every other readable rose now agrees — hole 17 was 139° out and was turned in
   phase 02, and sits 6° off now.

All six phases of the alignment plan are done: 02 routing and orientation, 03 water, 04
penalty marking, 05 bunkers, 06 guide furniture. Water is 49 of 56 — the seven skipped are
ones the fjord already provides. Marking is 64 runs against the guide's 63, bunkers 53 of 53.

Suggested next step is the routing solver with an anti-overlap term, because items 1, 5 and 6
are all that same solver, and moving a hole invalidates the water and bunkers around it. Do
it before the water elevation work or the 49 water features get rebuilt twice.

**The fairway plates are distance-to-green markers, not pin positions** — red 100 m,
yellow 150 m, white 200 m. An early reading of the guide took them for pins, which would
have put the flag in the wrong place on all eighteen holes.

**UI changes need measuring, not eyeballing.** The compass rose in the card header cost
58 px and silently wrapped the hole line onto two rows. Measure `.c-meta` height against
its line-height at 1280, 900 and 420 px before and after any card change.

**Green pads and water.** `terrainH` lays a green pad and the water block runs after it, so
a green inside a water area used to be flooded over: the 14th, the island green the course
is known for, sat 5 m under the fjord and the 6th at 0.12 m. Green pads now damp the flood
by how much pad is present, so the water still floods around an island green while the
putting surface stays dry. Probe it with `sampleH` at each green centre — anything under
about 1 m is submerged.

**Water and marking.** `PONDS` and `STREAMS` are generated from
`banguide/guide-inventory.json`, not hand-placed, and both feed terrain shaping that was
already in the file (`streamAt` carves, `waterDepth` floods, `waterSD` benches).
`wetAt` bakes them into a 4 m mask at startup because it is called over a million times
while the water surface builds. Red and yellow marking traces the margins of the water it
marks, so a line can never drift away from its hazard; white follows the property
boundary. If you regenerate, keep the three safety rules that took three passes to get
right: clear the playing corridor, never sit on a green, and de-collide **globally** —
per-hole guards cannot see that hole 17's lake is sitting on the 8th green.

**Re-anchoring holes.** `solve.mjs` in the phase-02 work treated each hole as a rigid body
(translate + rotate about its midpoint), which preserves shape and card length exactly, and
scored candidate arrangements on four independent sources: the land-cover raster, the walk
distances a real course must have, the guide compass roses, and the overview marker
positions. Two lessons if you do it again: weight the walks heavily or the turf term wins
and leaves 130 m walks; and let the neighbouring hole move a little — freeing hole 15 by
39 m lifted 17 from 69% to 92% on turf and 18 from 76% to 87%.

## Things that will bite you

**check.mjs's turf percentage is a coarse instrument.** It samples the 6 m land-cover raster,
which is itself a lossy trace of the club's map. Turning hole 3 dropped its reported turf from
71% to 51%, which reads like a serious regression — but sampling the club's map directly, at its
own 1.5 m per pixel, the same move goes 73% → 71% while the share of the corridor crossing
woodland falls 11% → 4%. Use the raster to compare two options; go back to the map image before
believing a single number. And when reading colours off the map, dilate the mask for the blue
hole markers before classifying: their antialiased rim reads as water, which invented a pond in
the middle of hole 3.

**Bearings.** North is **−z**, east is +x. A compass bearing is `atan2(dx, -dz)`, which is
what the page's own `bearingName` does. Using `atan2(dx, dz)` reflects every angle and
looks plausible — it produced a confident, wrong conclusion once already.

**Left and right**, which is a different thing from the bearing. `alongLine` returns an angle
`b` for which **forward is `(sin b, cos b)`**. North being −z, the player's right hand is
`(-Fz, Fx)` = **`(-cos b, sin b)`**. The page used `(cos b, -sin b)` and called it the
right-hand normal; that is the *left* vector, and it quietly mirrored 51 bunkers, 33 water
features and every sided out-of-bounds run. Fixed — but note how it survived so long: the
checker had the same formula hardcoded, so it agreed with the bug, and then agreed just as
readily with the fix. Anything that judges a side must read the normal out of the target file
(`banguide/lib.mjs` does) instead of restating it.

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
