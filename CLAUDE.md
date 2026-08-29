# Two courses in 3D — Veckefjärdens GC and Norrfällsvikens GK

This repo renders two real golf courses as self-contained WebGPU/TSL pages.
**`norrfallsviken3d.html` + `nvgkbuild/`** is the newer build — see "The
Norrfällsviken page" near the end of this file. Everything in between is about
Veckefjärden, whose page donated the entire engine.

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

**The trees come from satellite imagery, and the imagery is the authority.**
`fetch-sat.mjs` caches Esri World Imagery tiles (z17, ~0.54 m/px, orthorectified — a
tile's coordinates ARE its georeference, no registration error at all) and
`build-treecover.py` classifies them into `tree-cover.json`, the 3 m raster the page's
planter obeys in BOTH directions: satellite canopy plants where nothing was surveyed,
and satellite open ground thins an OSM forest polygon to scattered singles — the
polygons hold real canopy on only ~70% of their area, which is why the render used to
carry more forest than the course. Two earlier sources are superseded: the club's
overview map (warped 40–70 m, called mown turf forest) and the hole-plan classification
(5–6 m registration error, gaps between corridors). Classifier lessons that took
iterations: mown turf is bright, green AND SMOOTH (sunlit autumn canopy is bright and
green but violently textured); a tree's long shadow on grass is dark but still
decisively green and dead smooth. `check-treecover.mjs` holds the labelled probe set —
now verified against the satellite, which is NEWER than the plans (two probes moved
where stands have grown or been felled since) — and exits non-zero if verified forest
stops being forest or the open residual grows past its accepted five.

**The surroundings are data too.** Everything around the course comes from the same OSM
extract the course does — the E4 as its paired 2+1 one-way roadbeds with a median-wire
ribbon and shader-painted edge lines, the branch railway with its catenary masts, two
130 kV corridors tower-by-surveyed-tower (their cleared lanes cut through the planter),
parking lots with instanced cars, piers, 275 near building footprints plus the distant
town as oriented boxes, landuse rings that tint fields/gardens/industry and police the
scatter — plus `geobuild/surroundings-traces.json`, features read off a georeferenced
satellite screenshot (registration RMS 6.6 m) for the few things OSM lacks: the
clear-fells (planted at 6% with stumps), the machinery yard, the Ås hayfields, the
unmapped south parking lot, and the silt shallows that keep the fjärd's pale margins.
Ås village has no OSM footprints at all, so houses are synthesized inside its
residential rings, each aligned to its street. Ground truth that shapes the rendering:
Veckefjärden is a REGULATED FRESHWATER LAKE behind a 1939 lock — its wide pale margins
are silt bottom under water (drawn by letting the bed read through, never as dry mud),
and the reserve's Tvillingsta half is grey-alder swamp forest, so the planter goes
birch-dominant inside the reserve rings.

**The two landmarks the scene must get right** live in the page's landmark block, both
at surveyed coordinates. Åsmasten — properly "Åsbergsmasten", OSM node 845145336,
height=259 — stands on Åsberget's 241 m summit at world (−632, −2007), due north:
guyed body, white radome, aviation lights the dusk bloom picks up. The node sits at
63.3025 N, just OUTSIDE the fetch bbox's 63.300 edge, which is how an unnamed 35 m
works mast in Domsjö once wore its name — if a landmark seems to sit on absurd ground,
check the bbox before trusting the nearest tagged node. Själevads kyrka is at
63.292833 N, 18.607361 E → world (−3310, −928): the tall white octagon of 1880 with
its temple portico, and the 1923 crown — copper roof, white bell-storey drum, clock
lantern, copper spire, gilt cross at ~35 m — drawn from photographs (white and
verdigris green, NOT a dark roof), in a planter clearing because Kyrkudden is
churchyard, not forest (the peninsula is outside the OSM extract, so the vista
scatter would otherwise bury it). The clubhouse ("the old school") has its own
levelled bench and mown-lawn apron in `CLUB` — the terrain around it must read as
fresh green turf, never scrub.

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
    node geobuild/fetch-sat.mjs       # Esri World Imagery z17 tiles (orthorectified canopy truth)
    python3 geobuild/build-treecover.py    # satellite -> tree-cover.json (the forest raster)
    node geobuild/check-treecover.mjs # raster vs the labelled imagery probes; exits non-zero
    node geobuild/render-design.mjs   # -> design.svg, the layout to review before 3D
    node geobuild/embed.mjs           # bake it into the page
    node geobuild/check3d.mjs         # exits non-zero on a regression
    node geobuild/lint-page.mjs       # eslint no-undef over the page's module body
    node geobuild/shot.mjs veckefjarden3d.html geobuild/shots/out.png --hole 14 --cam tee

Caches live in `geobuild/cache/` and are gitignored; the reconciled JSON is committed.
The screenshot harness needs `npm install` once (playwright-core, pinned in
package.json) and a Chromium whose path `shot.mjs` states at the top — adjust it
outside this environment. The pages themselves still have no dependencies.

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

## The Norrfällsviken page — `norrfallsviken3d.html` + `nvgkbuild/`

Norrfällsvikens GK: 18 holes, par 73, on the Mjällom cape in Höga Kusten —
"en skogsbana med linkskaraktär som ligger seaside", in the club's own words.
The page is a port of veckefjarden3d.html (same TSL engine, boot, HUD, features,
disciplines), so every Veckefjärden lesson above about materials, colour
management, meshH/nudged/chaikin and editing safety applies verbatim. Its own
frame: ORIGIN {62.98250 N, 18.53250 E}, frozen in `nvgkbuild/lib.mjs`, which
re-exports geobuild's generic geometry/codec so the pipelines cannot drift.

### Where this course's geometry comes from

**OSM has NO golf mapping here** — one clubhouse polygon and nothing else. The
fusion is therefore different from Veckefjärden's:

| source | used for |
|---|---|
| the club's 2025 scorecard (nvgk.se/scorekort) | all 144 card values, verbatim; twice-confirmed by independent aggregator datasets |
| the club's GPS survey (`geo_data/norrfallsviken_clean.json`, 18×5 pts) | green centres, back tees |
| Esri z18 orthoimagery traces (`nvgkbuild/sat-shapes.json`) | every outline: greens, fairways, tee pads, ponds, centerlines — no registration error, a tile's coordinates ARE its georeference |
| OSM | the coastline (the course's eastern edge), the perched lake, the marsh, beaches, 274 buildings, marina piers+basins, roads, reserves |
| AWS Terrarium | the ground — INCLUDING real Gulf-of-Bothnia bathymetry (clamped to −6/−8 m; the sea surface is 0 by definition, never "measured" off shore pixels) |

**The 4/8 numbering swap.** The club renumbered at some point: the GPS survey and
every third-party dataset call the par-5 west corridor "8" and the par-4 east
corridor "4"; the club's own card is the other way round. The survey also recorded
the west corridor twice and lost the east corridor entirely (its "4" and "8" share
one green to 1.5 m). `reconcile.mjs` renumbers to the card and asserts the swap by
centerline length instead of assuming it.

### Running the pipeline

    node nvgkbuild/fetch-osm.mjs
    node nvgkbuild/fetch-dem.mjs
    node nvgkbuild/fetch-sat.mjs           # z17 tree-cover frame + z18 tracing frame
    node nvgkbuild/parse-osm.mjs           # course hull comes from the GPS survey
    node nvgkbuild/build-heightfields.mjs
    node nvgkbuild/reconcile.mjs           # needs sat-shapes.json (the traces)
    node nvgkbuild/render-design.mjs       # -> design.svg, review before 3D
    node nvgkbuild/embed.mjs
    node nvgkbuild/check3d.mjs             # exits non-zero on a regression
    node geobuild/lint-page.mjs norrfallsviken3d.html
    node geobuild/shot.mjs norrfallsviken3d.html out.png

`mosaic.py overview|crop` stitches georeferenced views from the tile cache for
tracing: pixel→world is affine, so a trace made on a crop needs no registration.

### What differs from the Veckefjärden engine

- `GEO.seaLevel` (0) replaces `GEO.lakeLevel`. The SEA is a ring like every other
  water body: the OSM coastline chains merged and closed offshore by reconcile,
  isLake/isSea true, so shore benches, wet-sand bands and shallows all just work.
  The 13th's lake is a perched pond at its measured 29.5 m, NOT isLake.
- Landmarks: Norrfällsvikens kapell (1649) built bespoke on its OSM footprint
  (skipped in the generic buildings pass), boats moored along the marina piers.
  The High Coast horizon — Mjältön, Ulvöarna, Högbonden — is real terrain in the
  z12 vista heightfield and needs no modelling.
- The clubhouse keeps the /golfklubb/ name-matched bench+terrace machinery at
  NVGK proportions (cream walls, red roof, terrace facing east to the greens).
- Card UI: three tees (Gul/Röd/Orange), not six.
- The planter is pine-led; there are no OSM forest polygons at all, so the
  satellite tree-cover raster is the only planting authority.

## The Puttom page — `puttom3d.html` + `puttombuild/`

Örnsköldsviks Golfklubb Puttom: 18 holes, par 72, an inland forest-and-parkland
course that threads between two lakes at Arnäsvall, north-east of Örnsköldsvik
(the town near Veckefjärden). Nils Sköld, 1967. The page is the same engine as
the other two; its own frame is ORIGIN {63.29920 N, 18.94130 E}, frozen in
`puttombuild/lib.mjs`.

### Where the GPS survey came from — the GolfTraxx pull

Puttom's per-hole survey was pulled from GolfTraxx, the way the user's other
surveys were, and the method is now a committed, reusable tool:
`geo_data/golftraxx_extract.py`. Every course in GolfTraxx's directory has an
id shaped as its postal code + country (Abbekås 27456SW, Norrfällsviken
28931SW, **Puttom = Örnsköldsviks Golf, Ovansjö 232, Arnäsvall 891 95 =
89195SW**); find it in the paginated country listing
`golftraxx.com/courses-by-state?state=SW`, where each row prints the id in a
cell. The course-map page
`golftraxx.com/full-layout?coursename=<name>&zipcode=<id>&city=&state=SW` then
renders the survey inline as Google-Maps markers (no API, no auth) — five points
per hole, Tee Target + Green Center/Front/Back + TheTipsTee Back Reach — which
the extractor turns into the same clean FeatureCollection as the other files in
`geo_data/`. **It is verified exact**: re-extracting 28931SW reproduces
`norrfallsviken_clean.json` to 0.000 m across all 90 points, which is how the
Puttom pull was validated before committing. The four par 3s the card names
(3, 5, 12, 15) fall exactly on the survey's `tee==target` holes — an independent
cross-check that the extraction and the card agree.

### Where the geometry comes from

Puttom is **fully mapped in OpenStreetMap** (20 greens, 21 fairways, 32 tees,
41 bunkers, 19 hole lines, a driving range, 13 water bodies, the E4, a railway),
so the fusion is Veckefjärden's kind, not Norrfällsviken's — OSM polygons are
the shapes, the GPS survey is the per-hole anchor (no OSM golf feature here
carries a hole ref, so `reconcile.mjs` matches each unref'd polygon to its hole
by the surveyed green centre — all 18 land within 12 m), and the card is the
length each hole line is slid to.

| source | used for |
|---|---|
| the club's card (twice-confirmed by caddee.se + golfisverige.com) | all card values; four tees Vit/Gul/Röd/Orange (61/57/48/41) |
| the GolfTraxx GPS survey (`geo_data/puttom_clean.json`) | the per-hole anchor: green centres and back tees |
| OpenStreetMap | every shape — greens, fairways, tees, bunkers, hole lines, the two lakes, wetlands, forest, farmland, roads, buildings |
| AWS Terrarium | the ground (no sea here — the course sits 43–102 m up among several perched lakes) |

### Running the pipeline

    node puttombuild/fetch-osm.mjs
    node puttombuild/fetch-dem.mjs
    node puttombuild/fetch-sat.mjs           # only for the tree-cover raster; shapes come from OSM
    node puttombuild/parse-osm.mjs
    node puttombuild/build-heightfields.mjs
    node puttombuild/reconcile.mjs           # OSM polygons + GPS anchor + card
    python3 puttombuild/build-treecover.py
    node puttombuild/render-design.mjs
    node puttombuild/embed.mjs
    node puttombuild/check3d.mjs
    node geobuild/lint-page.mjs puttom3d.html

### What differs from the other builds

- No sea: `seaLevel` is just a "nothing below water" floor from the lowest lake;
  the two dominant lakes (**Stor-Rössjön** NW, **Lill-Rössjön** south-central —
  named from the club's history, since OSM tags neither) get the wide shore
  bench, the rest render as ponds at their own measured levels.
- Four tees, not three or six; `check3d` counts tee columns dynamically.
- The routing is a **four-leaf clover** returning to the clubhouse after holes
  4, 9, 13 and 18; holes 7 and 8 are blind (a reviewer wants a semaphore); hole
  12 is a short par 3 over a bay of Stor-Rössjön. These are in `guide-notes.json`.
- The NVGK-specific landmarks (chapel, marina boats, far sea) all guard on
  features Puttom lacks and no-op; a bespoke clubhouse and the blind-hole
  sighting tower are open polish items.

## More courses — `angso3d`, `upsala3d`, `johannesberg3d` (+ their `*build/`)

Three more Swedish clubs, built on the same engine and the same disciplines. What
differs between them is only WHERE THE GEOMETRY COMES FROM, and by now that has
settled into a spectrum worth stating plainly, because each new course lands
somewhere on it and the pipeline choice follows:

| course | OSM golf data | GPS survey | so the geometry is |
|---|---|---|---|
| Veckefjärden | 12 of 18 holes | full club survey | OSM + club plans |
| Puttom | everything | full (GolfTraxx) | OSM shapes, GPS anchors them |
| Upsala | 17 greens, 86 bunkers, no hole lines | hole 1 only | OSM shapes, satellite supplies the ROUTING |
| Ängsö | 4 of 18 holes (numbered!) | hole 1 only | mostly satellite, 4 holes calibrate it |
| Norrfällsviken | nothing | full club survey | satellite traces, GPS anchors them |
| Johannesberg | property outline + 2 greens | none at all | satellite traces, banguide routes them |

**The GolfTraxx pull only works where GolfTraxx has the data.** `geo_data/golftraxx_extract.py`
is exact where it applies (see the Puttom section), but Ängsö, Upsala and
Johannesberg return **hole 1 only** — and Johannesberg is not in their Swedish
directory at all. Check before planning around it. Two traps in that directory:
ids are NOT unique per course (Ängsö shares 73126SW with Köping; Upsala's three
entries share two ids), so `coursename` disambiguates and the returned
coordinates are what confirm you got the right club.

**Linking a banguide to the ground.** With no GPS, the club's own banguide is the
routing authority and the satellite is the georeference. The strongest method a
tracing agent found — worth reusing — was to detect all 18 red flags in the
banguide, convert each flag-pole foot to a world point, and RANSAC-fit a
similarity against the OSM green centroids: at Upsala 16 of 17 matched at mean
residual 1.5 m, which then made every hole assignment certain.

**Cards are verified before use, not after.** Every card here was checked to
reproduce the club's own printed per-tee totals and to carry a 1-18 index
permutation before any geometry was fitted to it. That caught real things:
Ängsö's hole 1 has THREE values in circulation (355 / 386 / 396) and only 386
makes the printed totals add up — the hole was lengthened between the 2020 and
2023 cards, so expect an old tee pad ~31 m forward of the back tee. Johannesberg
has two whole card versions, the rated lengths and the 2026 banguide, differing
in exactly four cells; they reconcile as a re-teeing, and the 2026 one is used
because geometry must match where the pads are today.

### Things these three taught the pipeline

- **A relation fetch drags in far-away ways.** Mälaren's multipolygon brought a
  `golf=water_hazard` from a club 43 km east and stretched Ängsö's course hull
  across half the province. Golf ways and relation rings are now distance-filtered.
- **An extract can hold more than one club.** Johannesberg's also contains Nifsta
  GK 2.4 km west, and `parse-osm` kept whichever parsed last — handing the course
  its neighbour's boundary. It now takes the polygon containing ORIGIN.
- **`leisure=golf_course` is the best hull there is.** Where OSM has one it bounds
  the whole property; at Johannesberg two greens would have implied a 100 m course.
- **Submersion must be tested LOCALLY.** A flat "nothing below sea level" floor is
  meaningless inland: Ängsö carries water from 6.5 to 42 m, and Terrarium reads
  the Mälaren bay ~3 m ABOVE the course ground beside it (DEM bias on a flat
  shore), which failed three perfectly dry greens and tees. A point is wet only if
  it is inside a water ring AND below THAT ring's level; the flat floor is kept
  only where there is a real sea at one level. The floor itself is derived in
  reconcile from every water body the model knows, traced ponds included — the
  heightfield stage only sees OSM's.

### Ängsö — two facts the render must respect

The club is **not on Ängsön**: it sits on the mainland peninsula immediately north
of the island, across Spånsundet, the island edge some 700 m south of the
clubhouse. And its neighbour is **Ängsö naturreservat** in Västmanland, not the
Ängsö national park of the same name, which is an island 100 km east in Roslagen.
Both were wrong in the first draft of the page.

### Johannesberg — the hole the imagery could not show

Every hole traced except one, and hole 12 is worth reading before touching it. Its
green is certain (the banguide's flagpole converts within 5 m of a vivid green with
the matching front-left bunker), but the banguide draws the TEE END into ground that
is dense spruce in the satellite AND in the club's own aerial — no clearing exists at
either resolution. The registration is not at fault: greens 10, 11, 12 and 14 all land
within 5 m. The tracer took the only constructed feature at the corridor's west end,
a rimmed platform at (91, 488), which makes the hole 269 m against a card 374 m.

**The card slide resolved it, and the resolution is the interesting part.** Sliding the
tee 99.7 m back along its own axis — three times any other hole here — lands it at
(−7.6, 473), which is **26 m from the banguide's own hole-12 disc**. Two independent
records that never entered each other therefore agree: the club prints 374 m, and the
club draws its tee within 26 m of where 374 m puts it. The back tee is a chute cut into
the spruce that 0.3 m/px orthoimagery cannot resolve, and the traced platform is a
forward tee. So a slide far outside the usual band is not automatically a bad trace —
check it against the banguide disc before re-tracing.

**Its dry ground is real.** The rough east and south of the first tee renders as straw
rather than green, which reads at first glance like the heath band mis-firing on an
Uppland clay course. The satellite says otherwise: that ground genuinely is pale dry
grass, and the nearest farmland polygon is 238 m away. Measure the imagery before
retuning shading — this one nearly got "fixed" into being wrong.

## Banvy — the unified app (working name), and the course pack

The six pages are being consolidated into one application, per the audited plan
(phases 0–9; the six pages keep building and passing their gates until parity is
proven). **Phase 0 is done and its claim is strong**: a course's embedded data can
become a fetched binary pack with zero rendering change.

- `packages/course-pack/` — the fmt:1 pack (`GPK1` magic, JSON header, three raw
  deflate streams: HF0, HF1, VEC). `emit-pack.mjs <build> <out>` writes it from the
  committed build JSON — its vec shape is copied verbatim from the builds'
  embed.mjs (the five newer builds are byte-identical there; geobuild is refused
  until the Phase-4 merge). `check-pack.mjs` gates: streams byte-identical to the
  page's embedded base64, metadata equal, card values exact from the pack's own
  decode path.
- `tools/make-pack-page.mjs` — anchored patch turning a page copy's GEODATA block
  into a pack fetch; `--det` pins the two clocks (the TSL `time` uniform and the
  flag-cloth `now/1000`) because **nothing animated can be screenshot-compared
  without pinning its clocks** — that determinism hook is what makes parity a gate
  instead of a vibe.
- `tools/serve.mjs` (localhost static server — Chromium cannot TLS through the
  proxy, so http is served, never fetched) and `tools/parity.mjs` (strict pixel
  gate: mean ≤ 0.10/255, ≤ 0.05% of pixels off by > 2).
- `geobuild/shot.mjs` grew two additive modes: an `http://127.0.0.1` target (the
  route interceptor lets localhost through) and `--seq "hole:cam:preset,…"` —
  twelve views for one boot, which is what makes a parity matrix affordable.

Phase-0 result, for the record: Ängsö's pack renders **pixel-identical** to the
embedded page across 3 holes × 2 cams × 2 presets — mean difference 0.0000/255,
worst channel delta 0, all 12 pairs. The committed pack lives at
`apps/golf/public/courses/angso/pack.bin`.

**Phase 1**: `apps/golf/` is a Vite 8 app (pnpm workspace at the repo root);
three.js 0.185.1 resolves through the bundler (importmap and unpkg preloads gone)
and both faces are self-hosted (`tools/vendor-fonts.mjs` →
`apps/golf/public/fonts/`): the built app makes **zero third-party requests**.
The built `dist/`, served by `tools/serve.mjs`, rendered pixel-identical to the
original page on the same 12-view matrix — measured with the app's `fonts.css`
emptied, because the harness has always stubbed Google Fonts to the fallback face
and the app ships real Outfit: **a parity gate must compare like with like, and
the first FAIL you see may be the new build being MORE faithful, not less** (all
12 "failures" were HUD glyphs; the scene was identical). Lint:
`tools/lint-app.mjs` runs the pages' no-undef gate over real files. Build:
`cd apps/golf && npx vite build` (~1 s).

**Phase 2 (in progress)**: the app is **hand-maintained source** now.
`tools/extract-engine.mjs` writes to `tools/reference/` — extract a hotfixed page
there and diff to see what must be mirrored; it must never again write into
`src/`. The pages are **hotfix-only** from here: new features land in the app.
Determinism became `?det=1` at runtime (the TSL `time` pin + the flag-cloth
clock), so parity stays testable with no special build. Seams split so far, each
verbatim with zero logic edits, each verified pixel-identical after the move:
`src/engine/geom.js` (the seventeen pure helpers, TAU→fbm — geobuild's formulas,
now importable), `src/engine/codec.js` (inflate + decodeHF), `src/loader/pack.js`
(the fmt:1 fetch). The palette section is NOT cleanly splittable — s2l/L/C/SHADE
are pure but sit in the same section as `classify`/`groundAt`, which close over
the spatial index; cutting inside a section needs more care than cutting at one.
Unit tests: `pnpm test` — vitest over geobuild/lib.mjs invariants (the
left/right reflection, alongLine's extrapolation band, the codec round-trip and
its idempotence) and the pack byte layout. Packs exist for all five newer
courses under `apps/golf/public/courses/<slug>/`, each gated by check-pack
(byte-identical to its page) and by the phase-0 parity method.

**Phase 3 (manifest)**: `courses/index.json` — written by
`packages/course-pack/emit-manifest.mjs` — is the pipelines' contract with the
app. Computed fields come from card.json and the committed pack (par, tee count,
bytes, sha256 — the loader re-hashes the pack at runtime and refuses a mismatch);
the display strings the pages used to hard-code (tee names/colours, header
strings, the per-course tee-hiding breakpoint) live in the generator's table,
absorbed verbatim from the six pages' headers. The app boots ANY manifest course
via `?bana=<slug>` (default = first entry, angso, until the phase-5 rail);
`TEE_NAMES`/`TEE_COLS`/titles/photo-prefix/`hdsub` are all manifest reads, and
the tee-hiding `nth-child` rule is injected per course at boot because a 6-tee
card needs room a 3-tee card never uses. The gate is `tools/check-app.mjs`:
boots every manifest course through the whole path (manifest → integrity hash →
pack → decode → HUD) and asserts each build's card value-for-value THROUGH THE
APP, the tee row, headers, deep-link cleanliness, and a luminance floor. All
five pass — including the 3-tee and 6-tee HUD extremes (upsala has six tees,
so the extremes exist before the Veckefjärden merge). Harness note: a plain
`page.screenshot()` times out under SwiftShader — pass `timeout: 300000`.

**Phase 4 (the Veckefjärden merge)**: all six courses now boot in the app. The
schema gap was far smaller than feared — the engine already reads `marking`,
`surround` and `isSea` defensively, so the merge is a MAPPING, not a rewrite.
`emit-pack` grew one `OLD` branch: carry `sp`, the real 31 marking runs and the
real surround traces, and translate `lakeLevel` → `seaLevel`, because the
engine's `seaLevel` means *the level water sits at* and for a regulated lake
behind a 1939 lock that is 21.59 m, not zero. The sea machinery keys off
`water[].isSea`, which no Veckefjärden ring carries, so it correctly no-ops.

Three things worth keeping:
- **The card lives in `banguide/`.** Veckefjärden has no `card.json`; its card is
  `banguide/guide-card.json`, an OBJECT keyed by hole where the newer builds
  hold an array. `readCard()` in course-pack adapts both. This is a real
  dependency of the pipeline on the legacy directory, not just of its data.
- **`check-pack` states which of two things it proved.** Byte-identity to the
  page is the gate for the five newer courses. Veckefjärden's page omits `isSea`
  where the new format writes `false`, so rather than wart the format for a page
  scheduled for retirement, the gate falls back to DEEP EQUALITY after applying
  exactly that one declared migration — and *says so in its output*. A check that
  quietly weakens itself is worse than no check.
- **The submersion probe found something real, and it was not the 14th.** The
  island green is dry. Puttom's hole 16 is the finding: its slid back-tee point
  lies 1.1 m inside a traced shoreline (well within that shoreline's own
  uncertainty on a 2 m DEM) while its tee pad sits 14.7 m clear on dry ground.
  So the gate probes greens at their centre — strictly, that is what the 14th
  exists for — and tees at their PAD, the prepared ground a player stands on,
  while still *reporting* the graze every run. Note that each build's own
  `check3d` never tested tees against local rings at all: only greens.

Per-course bespoke scenery now lives in `src/engine/scenery/<slug>.js`, loaded
lazily by slug and handed the caller's vertex batch (`tri`/`quad`/`pole`), so a
horizon of hand-drawn landmarks is still one draw call and a course without a
module downloads nothing. Only Veckefjärden's are extracted; NVGK's chapel and
boats still sit inline behind their guards, working — **moving working code for
symmetry is how a refactor becomes a regression**. The cut boundary matters: the
first attempt swept up the batch's mesh assembly, which belongs to the caller.

### The parity gate caught what every other gate passed

Veckefjärden's card, submersion, tee row and header all passed while its **forest
was wrong**, and only the pixel comparison against its own standalone page found
it. The cause is the thing the merge does on purpose: the app runs the NEWER
engine, and the two pages are not one engine — Veckefjärden's differs by ~411
lines, among them its planter. So the app was planting Norrfällsviken's High
Coast pine country on an Ångermanland lake shore.

That is not a cosmetic difference. CLAUDE.md's own ground truth says the
reserve's Tvillingsta half is **grey-alder swamp forest**, which is why the
planter goes birch-dominant inside the reserve rings, with spruce and pine above
~46 m. Rendering it as pine says something untrue about the place.

The fix generalises the scenery module: it may export `species({r,x,z,h,ringSD,
RES})` as well as `build(ctx)`, and it is resolved ONCE early — the planter runs
long before any landmark does. The engine's default stays the pine mix; a course
whose woods are genuinely another kind of woods says so.

**The lesson for the phases still to come**: a merge onto a shared engine silently
drops whatever course-specific truth lived in the engine it left. Data gates
cannot see that — they check the data, which was fine. Only a picture of the
place, compared against a picture of the same place, can.

## Skyltar — the marker layer, on all six pages

`geobuild/apply-markers.mjs` patches every page; `geobuild/check-markers.mjs` measures
the result and exits non-zero. One anchored patch serves all six because the minimap
block, the rail markup and the sign furniture are byte-identical across them — 15
substitutions, each asserting its anchor matches exactly once.

**Numbers sit at the hole's MIDPOINT**, which is not a style choice:
`banguide/guide-markers.json` measured the discs on the club's own overview map at a
mean 46 m from the midpoint against 185 m and 190 m from the tee and the green. That is
also where `render-design.mjs` has always put them. Facilities get a **letter, not a
pictogram** — under about sixteen displayed pixels a pictogram is a blob and a letter is
still a letter: **K** klubbhus, **R** drivingrange, **Ö** övningsgreen, with the browser's
own tooltip naming them because a 360 px canvas has no room for a teckenförklaring.

**One state drives two surfaces.** `skyState` (0 off · 1 numbers · 2 numbers +
faciliteter) blits the minimap layers and gates a sprite group in the scene, so the map
and the world can never disagree. It is declared beside `RMOTION` rather than in the
minimap section for a concrete reason: `setPreset` calls `syncURL` from line ~1214, long
before the minimap builds, and a `const` read in its temporal dead zone throws. `skyMax`
drops to 1 on a course with no facility data, so the cycle never promises an empty layer.

**The sprites answer to camera height, not to the view's name** — `smoothstep` over
110–220 m above ground. Ovan is a real camera 330 m up where a 2.6 m flag is sub-pixel
and nothing says which hole is which; at eye level the card already names it and a
number over the fairway is litter. Tying it to height means Flygtur (22–38 m) and the
Bansafari stay clean without either knowing the layer exists. `takePhoto` hides the
group outright — `setClean` only hides DOM, so an overlay would otherwise be in the
photograph.

### What the de-collision actually had to handle

Sliding every crowded disc toward its own tee — the obvious rule — **fails on four of
the six courses**. It cannot separate a same-direction parallel pair (Johannesberg 6/7),
and where two holes share a loop hub it drives them *together* (Ängsö gains a 1/4
collision that did not exist). So each offender moves along its own centreline in
whichever direction buys the most room, greedily, worst-first, clamped to f ∈ [0.12,
0.88]; a disc that cannot improve is marked stuck and the rest carry on. Never sideways:
a number that has left its corridor is worse than one that grazes a neighbour.

**Facilities de-collide on the map only.** Veckefjärden's putting green stands 64 m from
its clubhouse — fourteen pixels here, one square inside the other. They are pushed apart
in canvas space and the world sprites stay put, because at 0.223 px/m the same nudge
would carry the K marker seventy metres off its own roof. The crowding belongs to the
map, not to the ground.

**Two facts that set every size.** The 360 px backing store displays at 172 CSS px
(0.48×), so a 30 px disc reads 14 px and its numeral about 6 — which is why `#mini` grows
to 232 px at ≥1200 px viewports and stays as it was below, where the hole strip is
already within 100 px of the panel. And a two-digit numeral at the single-digit size
crosses the rim, so 10–18 draw smaller — the same 0.5-ish font/disc ratio
`render-design.mjs` uses.

`check-markers.mjs` reads the marker table's **canvas** positions (not world ones
re-projected, which would not test what is drawn) and gates: no pair closer than the
disc radius, every disc still on its own line, every marker fully on the canvas,
the toggle cycling correctly, sprites at zero opacity at eye level and full in Ovan,
and the HUD not overlapping itself at 1440/1280/1100/1000/900/420 px — plus the open
phone sheet clearing the top of the screen, since the rail grew a row. It runs with the
webfont stubbed out, so every measurement is taken in the fallback face on purpose.

### The bug the range data uncovered

The range's target flags marched away from `const hut = [...]`, a coordinate written
into each page by hand — and **five of the six carried Norrfällsvikens** `[-359, 229]`,
a leftover from the port. It was invisible while those courses had no range polygon to
plant flags in; the moment Ängsö and Johannesberg gained traced ranges the flags landed
in the wrong field entirely (at Ängsö, 5 of 6 were culled by the ring test and the
survivor stood in a corner instead of down the shot line).

The tee end is derivable and no longer written down: **it is the end of the range you
walk to from the clubhouse**, which is where the bays are at every club there is. The
page finds the ring vertex nearest the clubhouse and steps 12% in toward the centroid;
the old literal survives only as the fallback for a course whose clubhouse is not in the
data. That line is the one thing not identical across the six pages, so `apply-markers`
matches it with an **asserted** regex — one match or nothing is written — rather than the
verbatim text it uses for the other fifteen substitutions.

### Marker data, per course

The anchors come from the models, so three courses needed pipeline work first:
Ängsö's clubhouse was being swallowed by a blanket `if (t.golf)` branch in its
`parse-osm` (a golf-tagged *building* now falls through to the buildings bucket, as
nvgk already did), and its driving range — which OSM lacks — was traced off z18
imagery. Puttom has no OSM clubhouse footprint at all, so its 157 m² one is a committed
satellite trace, and `reconcile` stopped hardcoding `scenery.greens: []` over two real
practice greens. Johannesberg's clubhouse was in the model all along under the name
`klubbhus`; the page's `/golfklubb/i` matcher simply never looked for it, which is why
the marker lookup matches `amenity==='clubhouse'` or `/golfklubb|klubbhus/i` — and is
kept SEPARATE from the `CLUB` const, because `CLUB` shapes terrain and widening it
would move ground on three shipped courses.
