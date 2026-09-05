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
and the reserve's swamp forest is GREY ALDER first, then birch and rowan
(Länsstyrelsen's own text), so the planter goes birch-dominant inside the reserve
rings — birch being the nearest thing the SPECIES table has to alder. **Two
corrections measured in 2026-09:** the lake's legacy level of 21.59 m is AWS Terrarium
on an unknown datum and the laser DTM reads its surface as a flat **0.280 m RH 2000**
— it is within a metre of the Gulf of Bothnia, which is why there is a lock at all.
And the reserve is TWO polygons totalling 63.11 ha; the half that touches the course
is its EASTERN area, not "Tvillingsta", and the western half at the Moälven mouth
falls outside geobuild's fetch bbox and is not in the model.

**The two landmarks the scene must get right** live in the page's landmark block, both
at surveyed coordinates. Åsmasten — properly "Åsbergsmasten", OSM node 845145336,
height=259 — stands on Åsberget at world (−632, −2007), due north:
guyed body, white radome, aviation lights the dusk bloom picks up. The node sits at
63.3025 N, just OUTSIDE the fetch bbox's 63.300 edge, which is how an unnamed 35 m
works mast in Domsjö once wore its name — if a landmark seems to sit on absurd ground,
check the bbox before trusting the nearest tagged node. **Åsberget is 217 m, not the
241 m this file used to claim** — the 1 m DTM reads 216.01 m at the mast node and
218.50 m as the highest ground within 2.5 km, and sv.wikipedia says 217. The old
number was the same Terrarium bias as the lake: 218.5 + the measured 20.99 m offset
is 239. The mast's 259 m is its own HEIGHT, and Åsberget carries two Teracom masts
(~100 m and ~170 m) where the page builds one body. Själevads kyrka is at
63.292833 N, 18.607361 E → world (−3310, −928): the tall white octagon of 1880 with
its temple portico, and the 1923 crown — copper roof, white bell-storey drum, clock
lantern, copper spire, gilt cross at ~35 m — drawn from photographs (white walls, a
verdigris spire, and a MAIN ROOF THAT IS DARK: this file used to say "NOT a dark roof"
and the photographs disagree, brown in 2024 and grey-green in 2005). From the course
it reads as a white block under a slim dark spire above a dark treeline, and nothing
finer is visible at 3.4 km. It stands in a planter clearing because Kyrkudden is
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

**And a plate has to measure what it says.** They were placed by the arc length
still to run along the hole polyline, to the line's END — but the plate claims the
straight-line distance to the CENTRE of the green, and on a dogleg those diverge:
across the six courses the plates were out by 2.6 m on average, 39 of 252 by over
five metres, and Ängsö's 14th put its "200" where the green is 233 m away. They are
now solved for the POST rather than the centre line, because the post stands 15 m
out to the side and at a dogleg that offset is not perpendicular to the green —
fixing only the centre-line point still left the post itself up to 10 m out.
Worst case is now ~1.2 m, and `check-app` gates it at 2 m by measuring the plate
that was PLANTED (`V3D.plates()`), never by re-deriving where it ought to be.

Two traps that cost time here, both worth knowing:
- **`hyp(a, b)` in `geom.js` takes two POINTS, not two scalars.** Calling it as
  `hyp(dx, dz)` returns NaN, every comparison goes false, and in this case every
  distance plate on all six courses silently disappeared. The new gate is what
  caught it — a count of zero failed loudly where a picture would not have.
- The residual is not the search step: at a polyline vertex the bearing jumps, so
  the post's own distance is discontinuous and no position lands exactly on the
  label. That is why the gate allows 2 m and not 0.5.

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

**And that north is TRUE north, which SWEREF 99 TM's is not.** Every build here is a
flat-earth frame about its own origin, `x = (lon−lon0)·mPerLon`, `z = (lat0−lat)·mPerLat`,
so its −z points at the pole. EPSG:3006 northing points at **grid** north, and the two
differ by the meridian convergence — 1.61° at Ängsö up to 3.52° at Puttom, all of Swedish
golf being east of the 15° central meridian. That is 30 m at 500 m out. The frame's metre
is off too: `mPerLat = 111320` is a sphere of the equatorial radius, which at 63° N runs
0.13% short in latitude and 0.34% in longitude. Bringing any EPSG:3006 product into a page
needs all three terms — `apps/golf/src/engine/geodetic-frame.mjs` derives them from the
frame's own constants, and it is the only place that should. A translation-only bridge is
right at the origin and 45 m wrong at the corner, which is why an origin check passes.

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
- The clubhouse keeps the name-matched bench+terrace machinery at NVGK
  proportions. **Its colours were wrong here until a photograph was looked at:**
  this note used to say "cream walls, red roof". The club's own photograph shows
  the opposite emphasis — **Falu red timber walls with white window frames and
  white corner boards, a dark red-brown roof**, single storey with a gable over
  the west block, a glazed veranda, and a railed terrace standing above the green
  it faces. Aerial imagery gives a roof but never a facade; that one needed a
  picture from the ground.
- Card UI: three tees (Gul/Röd/Orange), not six.
- The planter is pine-led; there are no OSM forest polygons at all, so the
  satellite tree-cover raster is the only planting authority. Länsstyrelsen's
  own reserve text corroborates it: "På hällmarkerna växer knotiga tallar och
  marken täcks av lavar, mossor, ljung och bärris".

### Norrfällsviken on 1 m terrain — the first SEASIDE v2 ground

`?bana=norrfallsviken&v2=1` now renders Lantmäteriet's 1 m Markhöjdmodell out to
a 16 km root: 469 tiles over 7 levels, 256 of them at 1 m over a 4,096 m window,
booting in ~13 s on WebGPU. `norrfallsviken-ground-graph.mjs`,
`norrfallsviken-ground-rings.mjs`, `compile-norrfallsviken-ground-graph.mjs` and
`v2-norrfallsviken-config.mjs` carry the reviewed contract; the runbook's
per-course recipe is what they follow. Full evidence:
[`docs/courses/norrfallsviken-source-dossier.md`](docs/courses/norrfallsviken-source-dossier.md).

Four things this ground taught that no inland course could:

- **The height model has no bathymetry AND no nodata over near-shore water.**
  Markhöjdmodell carries the Gulf of Bothnia as a flattened surface at about
  zero, so a window that is one third sea still passes the every-sample-finite
  gate. All 16,785,409 samples of the course window are finite, −0.841 to
  90.589 m RH 2000. It is nearly free, too: a 257 × 257 tile of one repeated
  value deflates to 142 bytes against 45 kB for a varied one.
- **But it stops tiling the OPEN sea, in two different ways.** The coastal item
  698_68 returns nodata over its outer water, and the 10 km square 697_68 —
  entirely Gulf of Bothnia — is not published at all and answers 404 while all
  eight of its neighbours answer 200. `build-ground-rings` now tolerates an
  unpublished square and fills nodata under an opt-in `seaFill` rule: a
  component is filled only if its boundary is water by MEDIAN, by fraction and
  at the extreme, and it is filled with the median of its own boundary rather
  than a constant. The first rule tried was "no boundary sample above 0.25 m"
  and it failed correctly — the real boundaries reach 0.80 m where a factor-4
  overview averages shore into water. The median is the discriminator that
  cannot be dragged; a missing LAND square fails all three tests at once.
  Only a ground that declares `seaFill` gets any of this.
- **A STAC `capturedAt` is not a campaign.** Both source items advertise
  2018-12-20 over a 2012–2025 range; the per-item `ursprung.json` says 698_67 is
  one 2025-06-05 flight while 698_68 carries a 2012-07-05 rectangle at exactly
  E 680000–682500 / N 6987500–6990000 — which this window clips. Measured, the
  seam steps 0.088 m through water (94% of it) and 0.298 m on land, against
  0.110 m for ordinary terrain a kilometre west, and it stands 644 m east of the
  played ground. Real, recorded, not visible. **Read `ursprung.json`.**
- **The frontier is not the window.** `expectedTileCount` is the level-zero set
  the app installs EAGERLY, and the loader caps it at 8 MiB. All 256 tiles here
  are 13.64 MB, so asking for them fails closed — the reviewed frontier is the
  widest whole-tile rectangle that fits, 8 × 12 tiles and 7.13 MB, with the rest
  of level zero streaming in behind it at the same 1 m. Ängsö's frontier is also
  8 × 12; that is what 8 MiB buys in 256 m tiles, not a copied number.

**This ground's vertical datum offset is 20.3432 m** (median over 31,829 mown
non-water samples, MAD 0.4616). Puttom's is 23.6263 and Veckefjärden's 20.9924 —
copying Puttom's here would be a 3.3 m error. Two notes on measuring it: the
apparent agreement of the two models at the SHORELINE proves nothing, because
`build-heightfields.mjs` pins `seaLevel` to 0 by fiat and the comparison is
circular; and measured over all land instead of played ground the median is
23.99 m and climbs with elevation, which is Terrarium carrying canopy where the
laser DTM is bare earth. Lantmäteriet's own geoid grid gives 23.3480 m of
separation here, so the offset is **not** the geoid and Terrarium is not simply
ellipsoidal — it is a measurement, not a formula.

**The LiDAR vegetation is published here too (2026-09-05), and the sea taught
the exclusions a rule.** Same `ground-vegetation` CI chain; the inventory is
ONE June 2025 Riegl **leaf-on** campaign (`25f014`) covering the AOI
exclusively over three items — the first scan in this chain with no deciduous
under-detection caveat — of which `699_67` lies wholly north of the 4,096 m
window and contributes nothing (build-canopy skips it; the workflow's raster
args follow build-canopy's output, never the inventory, since that run).
Cloud ground vs the published DTM: ~0.00 m medians on land; the only tiles
above 5 cm are pure class-9 water at a uniform +0.12–0.14 m — the Gulf's wave
surface against the DTM's flattened sea, verified by class counts before
being believed. **The first compile rejected 31,734 forest crowns as
`excluded:water`**: the sea ring is the coastline closed offshore, its
southern synthetic edge crosses the peninsula, and even-odd membership
claimed half the land — the renderer never showed it because the engine
applies the Ängsö rule (wet = inside a ring AND at its level) while
`semantic-exclusions` tested membership alone. The fix measures each ring's
water surface from the DTM itself (p05 of published-ground height over the
interior; the laser flattens water) and keeps only cells within 1.5 m of it —
measured, never taken from the model, because legacy models state levels in
the Terrarium datum ~20 m off the sampled RH 2000 ground. After it:
excluded:water 309 (the real shoreline) — 91,417 candidates →
**13,050 machine-reviewed individuals** on 163 object tiles + stand fields on
all 229 covered tiles, closed-canopy cells 149k → 224k (the southern forest
back). In the app: 13,050 + 92,677 stand trees, the legacy lattice cut from
all 229 tiles, bases p95 0.079 m, `speciesSource: 'default'` — right here,
the engine's default IS the pine mix — and **zero legacy-planted trees remain
anywhere on this course**: the window covers the whole tree-cover box, so
every tree standing is measured or stand-field. `check-course-v2` passes on
the ring graph (469 tiles, 7 levels). One CI mechanic worth remembering: a
push to the branch while a run is in flight rejects that run's final evidence
push (non-fast-forward); the chain's outputs survive in the uploaded
artifact, so recover from there rather than re-running an hour of compile.

**Two appearance facts were wrong and are now corrected from photographs.** The
clubhouse roof is a red PANTILE (measured rgb(212,166,170) from the ground and
rgb(190,130,119) overhead, both in flat overcast), not the "dark red-brown" this
file used to claim — the old reading came from a low-light photograph, the same
error that once painted Puttom's lower storey blue. And the chapel is not a
tower-and-cross building: Kramfors kommun's kulturmiljöplan calls it "byggnad
med sadeltak målad i vitt med en **fristående** klockstapel", and its roof is an
orange-red pantile at rgb(177,90,48). main.js drew a dark shingle roof and an
attached tower; it now draws the tile roof and a free-standing bell frame
standing clear of the gable. Nordingrå has four fiskekapell and they are easy to
confuse — a white chapel with a grey shingle roof and a red TRIPOD bell frame is
Bönhamn's, not this one.

**Holes 4 and 8 share ONE green, and the model draws two.** The club's 2026
local rules say so outright ("Hål 4 & 8 delar en gemensam green"), which means
the survey's "4" and "8" landing 1.5 m apart is the real course and not the
survey defect this file used to call it. `course-model.json` carries two
satellite-traced greens 37.3 m apart (344 m² and 224 m²), very likely one
complex read as two lobes. Not fixed — merging them needs a re-trace, not a
guess — and it is the highest-value open fidelity item here.

**The 4/8 renumbering is now confirmed by the club and dated.** Benestam Golf
Course Design's conceptual tee plan of 2025-03-10, published on nvgk.se, carries
"hål 8 & 4 skiftar nummer" on both rows; the July-2025 card already shows the
swap. The same plan says the club's printed 440 m for the par-5 Gul is wrong at
428 m — which is exactly the 12 m by which the plan's existing OUT total falls
short of the card's. The repo keeps the club's card.

**The card has a known expiry.** "Projekt Bättre Spelupplevelse" (announced
2026-07-09, preliminary start September 2026) would give every hole four tees
(55/48/44/40), turn hole 10 from par 5 into par 4 and take the course to par 72.
Nothing here changes for it yet, but a card verified today is not a card
verified forever.

Two smaller things: **OSM has a `leisure=golf_course` relation for this club
(165517) that the build never reads**, because `nvgkbuild/parse-osm.mjs` tests
`leisure === 'golf_course'` on WAYS only — so `courseBoundary` is null although
a free, independent hull exists that corroborates the played bbox on all four
sides. And **Högbonden is not visible from anywhere on this course**: a
line-of-sight test from all 18 tees and greens finds it blocked from every one,
and it sits 2.4 km beyond the vista heightfield's south edge anyway. Ulvön —
the view the club's own text names — is visible from about 15 of those 37
points.

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
  features Puttom lacks and no-op; the blind-hole sighting tower is an open
  polish item.

## Hålguiderna — the per-hole text on all nine courses

Every course's HUD text comes from a `guide-notes.json` beside its build
(`<build>/guide-notes.json`; the nines name theirs in their config's
`guideNotes`, e.g. `johannesbergbuild/guide-notes-9.json`), read by each
`reconcile.mjs` or by `tools/build-nine.mjs`. One record per hole: `name`
(an editorial tagline — no club here names its holes, and the two epithets
Norrfällsviken uses are kept), `note` (the Swedish description the HUD
shows, one to three sentences), `club` (the club's own text verbatim where
one exists) and, where there is no club text, `basis` (which sourced facts
the note was written from). The `source` string at the top says where the
club text was found and what was checked. **The HUD shows `note` before
`shape`** (main.js and all six pages; it was the other way round, which is
why Veckefjärden's card read an English geometry string).

Where the club's text lives is different for every club, and none of it
is on the page you would look at first:

| course | the club's per-hole text | how it was reached |
|---|---|---|
| Puttom | LiveCaddie course 658, embedded on puttom.se/banguide | `tools/livecaddie-holes.mjs 658` |
| Veckefjärden | LiveCaddie 379 (the club's condensed text) + Magasin Veckefjärden 2019 pp. 51–56 (Peter Forsberg's longer text) | the tool; the magazine on Issuu, transcribed |
| Norrfällsviken | the OLD site (offline), Wayback 2015–2025; nvgk.se still says "Kommer snart" | Wayback; the 4/8 renumbering caveat applies |
| Johannesberg | the SPELTIPS paragraph on each 2026 hole plan (Bana-N.jpg) | plain curl; read off the images |
| Ängsö | angsogolf.org 2001–2003 (LiveCaddie 649 today has empty text) | Wayback |
| Upsala | none — sheets on banguider.se carry numbers and labels only | written from sheets, rules, the Kains interview, club news |
| the three nines | none anywhere | written from the routing geometry and the club's course-level prose, and say so |

`tools/hole-geometry.mjs <build>` prints what the model says about every
hole — bend and where, tee/green heights and the DEM profile, bunkers and
water by the PLAYER'S side — and every side, slope and crossing in the notes
was checked against it. Two traps it carries: lib's `right()` pairs with
`alongLine`'s angle, not with `bearing()`, so mixing them reflects sides
(CLAUDE.md's old warning, met again); and a dogleg's direction is the sign
of the heading change — the elbow of a LEFT dogleg lies RIGHT of the
tee–green chord, so a chord-side label is inverted. Where the club and the
model disagree (Johannesberg's 11th "rakt" against a 29° bend; the 18th's
fairway-crossing hazard 9 m off the modelled line; Norrfällsviken's dogleg
distances) the notes say neither. Facts the club states and the model lacks
(Ängsö's brook before the 9th green, Veckefjärden's crossing ditch on 17,
Upsala's 2022 bunker on 8) are kept in the notes: they describe the course,
not the render.

**`geobuild/lint-page.mjs` had never run on Windows.** `execFileSync('npx')`
needs a shell there, and the catch swallowed the EINVAL, so the gate exited
1 with no message — and a `| tail` in the runner hid the exit code. It
spawns with a shell on win32 now and prints the error; the probe that
proves it (an injected undefined identifier) fires.

### Puttom's hålguide — the club's own words, and two things it exposed

`puttombuild/guide-notes.json` is condensed from the club's own per-hole
banguide, which is not on puttom.se at all: `puttom.se/banguide` is an
iframe of the LiveCaddie course guide (course 658), and the text the club
wrote for each hole sits on `course-graphics.php?course=658&hole=N` behind
a JS-rendered page that 403s any plain fetch. `tools/livecaddie-holes.mjs`
drives Chrome through all eighteen and is reusable for any club whose guide
is LiveCaddie — find the id in the iframe src. The verbatim text stays under
`club` beside each condensed `note`, and every bend, rise and side in the
notes was checked against the model's line geometry and the DEM profile
(the 11th's green really is in a hollow: 72.6 m at 80 m out, 68.7 m on the
green). `name` is an editorial tagline; the club names no holes.

**The model's lake names are on the wrong rings.** `reconcile.mjs` calls the
two LARGEST water rings Stor- and Lill-Rössjön, but Wikipedia/SMHI put both
lakes ON the course: Stor-Rössjön (14.4 ha, 63°17′48″N 18°56′31″E) is the
ring the 12th, 15th and 16th play over, Lill-Rössjön (11.3 ha, 63°18′04″N
18°56′02″E) the pond inside the 4th's dogleg. The 121 ha lake 4 km
north-west that carries the name today is something else. The club's
history says "mellan två SMÅ sjöar", which should have been the tell. Not
yet fixed, because the names choose which rings get the wide shore bench.

**The club's card disagrees with the aggregators on two cells.** The
LiveCaddie card (and golfify.io) give hole 11 index 6 and hole 16 index 12;
caddee and golfisverige, which the committed card came from, have them
swapped. The club also lists no 61 tee on holes 3, 4, 11 and 12. Per the
Mellanbanan rule the club's sheet should win, but this one is left for the
owner; the notes state neither claim.

### Puttom's facilities — what OSM never had, and where they came from

The extract has no footway or path, no parking polygon, no bridge and no
building at the club (today's OSM is the same: one parking NODE, a toilets
node), so cart paths, lots and the clubhouse were absent because nothing
supplied them. `puttombuild/sat-traces.json` now carries them, read off z18
Esri tiles with `tools/sat-mosaic.mjs` — a Chrome-composed mosaic with a
labelled metre grid and the model drawn on top, which is what tracing by eye
needs and what `mosaic.py` used to give before this machine lost Python:
the clubhouse block and its west annex, the shop block, the range shelter
(kind `roof`, drawn as a canopy on posts) and range house, three works-yard
sheds and the yard's hardstanding (`surround.yard`), five summer houses,
the main gravel car park and the motorhome lot, the yard and summer-house
service roads, five gravel cart paths the tiles show clearly (1→2, the hub
to the bay and along its north shore, down the 13th, 11→12, 14→15), the
range tee line (mats, dividers, kerb) and its safety net along the road
side of the field, and the cart fleet's row. Each carries a confidence; the
net's HEIGHT is assumed, its line is a thin shadowed line on the tiles.

**The clubhouse was wrong in this file, twice.** The club's photograph of
the 18th green at sunset (puttom.se) shows a modern two-storey building
with a glazed gable and balcony towards the green under a dark roof — not
Falu red under pantile — and the imagery puts it in the large block EAST
of the L-shaped wing that carried the name. The first correction painted
its lower storey blue, because that photograph is blue-hour light on red
paint: the owner's drone photograph of the whole hub (Instagram, from over
the lake looking north) shows Falu red with white trim and white window
frames, a wooden terrace with parasols along the glass end, motorhomes on
the lot west of it, an entrance square with the flagpoles between it and
the road, and a light grey road. **A photograph at golden or blue hour
tells you shape, never colour.** `CLUB_LOOK` grew `lowerWall/lowerHeight`,
`gable`, `glazedGable` and `balcony`; the glazed end is chosen by where the
course is (the mean of the green centres), never by a coordinate.
`SCENERY.buildingLooks[id]` states an outbuilding's colours and whether it
carries window rows, by trace id.

**OSM's road cut the bend, and everything placed against it was wrong.**
The `unclassified` way through the hub runs up to ten metres inside the
real road's curve (measured by drawing the model over the tiles with
`tools/sat-mosaic.mjs`), so the car park sat on the carriageway, the net
stood on its shoulder and the sheds touched it however carefully they were
traced. `sat-traces.json` now carries the road's centreline read off the
tiles and a `hubOverride` box inside which `reconcile` drops every OSM road
and track point (a way that crosses the box comes out as its outside
runs). Traced against THAT road: the annex as two blocks (gabled, not the
flat L), the reception block, the L-shaped "vinkelhus" between the tee
line and the road, the range house whose wall stands on the verge, the
car park east of the road with 2.5–5 m clear of its edge, the motorhome
lot (`vehicles: "motorhome"` — drawn by the scenery batch, no cars), the
entrance square (`cars: false`), and the net five metres off the
centreline on the field side. Gravel roads are pale (`C.hard`), not the
path brown they inherited.

**"A dark road under the grey road" was the path class.** Every road adds
itself to the paths index with a half-width of 4 m, the classifier turns
that into the PATH class, and the class-SDF chunks paint it in path brown
under the 2.2 m pale ribbon — a brown band a metre and a half wider than
the road on either side, and under the wall of any building on the verge.
The class band is now the ribbon's width for non-trunk roads (2.4 m
gravel, 3 m asphalt) and the PATH colour is pale compacted gravel, so
band and ribbon are one surface. Changing either means recompiling the
surface preview. That was half of it: the other half was the ribbon's own
VERGE — 2.2 m each side of a road, coloured as the ground blended toward
gravel and multiplied by the terrain's ambient term, which on the 1 m
ground read as a dark stripe either side of a pale one (road 52 against
grass 78 in evening light, measured). A toned gravel run now has a 0.7 m
shoulder in its own colour and takes no AO. And a lot polygon must not
contain a building: the motorhome ring included the annex and the vans
were parked in it. Measure a suspected overlay by hiding nothing and
sampling boxes on the capture (`measure-png` in the scratch tools):
the first two fixes here moved the number by six, which is how the verge
was found.

**The range end, from two aerial photographs the owner supplied** (Google
Maps user photos): the tee line is a CURVED run of red pavers from a small
red hut at its west end, sweeping round the enclosed block of the range
building and along the open front of that building's long wing — which is
the covered bays, an 18 m roof on posts, and the only roof over any mat.
The enclosed part is an L that HUGS THE ROAD — a 16 × 6.5 m arm along it,
4.5 m off the centreline, and a 6.5 × 15 m arm turning towards the field
at the west end, two gabled ridges at right angles — and the tee arc is
OPEN along its whole length: the owner, who knows the place, had the roof
I had put over its last bays removed. The owner drew that L over a
top-down render; three drafts before it had put the enclosed block across
the arc's end, where it stood on the tee. Two wrong drafts came from
reading the tiles alone: the hut's roof taken for a canopy, then a canopy
invented along the mats. When the owner's word and a photograph read
differently, the owner's word wins; note it and move on.
Read the arc's points off a bare crop (`SAT_PLAIN=1 tools/sat-mosaic.mjs`)
— the overlay hides the pavement it is meant to help you trace. The tee
line renders as one pale hardstanding strip four metres deep with a kerb,
the mats and white dividers standing on it; per-mat quads read as specks
from the clubhouse. An L with two roofs needs its cross wing traced longer
across than along, or the gable rule puts both ridges the same way.
**Near the course the ground paints the roads; the ribbon is for beyond
it.** The owner wanted the roads in the same flat gravel as the lots, and
the ground material already paints a pale PATH band under every road, so
inside its coverage (the v2 surface layer where loaded — `probeAt(x, z)
.inBounds`, since the probe returns an object even outside — else the
boot atlas) a gravel road gets no ribbon at all, and a road that crosses
the edge keeps one point inside so ribbon and band meet. Measured in the
evening top view the road and the square are the same 108 in daylight and
70 against 61 at dusk. Gravel ribbons beyond the coverage have their own
matte material (`makeGravel`); they used to borrow the turf shader, grass
detail and all, and came out brown. **And the corridor road the owner
saw on the banguide, Google Maps and the tiles was in the model as two
thin paths, one starting at the wrong place** — it is one gravel service
road now, from the south-east corner of the entrance square straight
south-south-east past the 18th green to the junction at the bay's
north-west corner, down between the 18th and the 14th past the 15th tee,
and on west-south-west above the bay's south-west arm and south down the
17th's east edge to its tee, where the banguide's 16 marker sits (the
markers are hole MIDPOINTS). Beside the bay it is held 15 m west of the
shore track the tiles show, because the OSM lake ring runs that far west
of the real shore and a road inside the ring stands in carved water. A
road on three references and a path in the model is a trace error, never
a rendering one. And the first reroute left the motorhome lot
instead, read off an 820 m crop where two lines seemed to leave the hub;
a 200 m crop at native resolution showed no road at the lot at all.
**Trace a road at native resolution or not at all** — at 0.4 m per
displayed pixel a mown edge and a gravel road are the same light line.
Three more from the same road: **PATH ranks above FRINGE, FAIRWAY and
SEMI** in `SURFACE_PRIORITY` now, because the mown classes painted over
the road wherever it crossed a fairway (a cart path across a fairway is
gravel on the ground); **a road must keep ten metres off every tee
mark**, the synthesised decks included — the trace script measures the
nearest mark (9.4 m, the 10th's) and the first line ran through the
15th's white tee and the 17th's red one; and **"the small dock in the
water on the 14th" was a footbridge**, generated where a shore path cut
a corner of the OSM lake ring, which is drawn up to 15 m off the real
shore. The two shore paths are GENERATED from that ring, offset six
metres onto land, so they cannot cross the water they follow, and the
trace script counts way-ring crossings (zero) before anything is built.

**Buildings along a road stand square to the road, not to the map.** The
owner drew the four range buildings over a top-down render and every one
of them was turned with the road; traced axis-aligned off the tiles they
had read as dropped at random. Trace them in the road's own frame (a unit
vector along it and one across it, rectangles as centre ± half-extents),
which is what the trace script does for these four.

Two things could not be had: Lantmäteriet's open building footprints
(`stac-vektor` collection `byggnader`, CC-BY) list fine but the kommun zip
on `dl1` answers 403 for this account, and puttom.se refuses plain fetches
(403) — a real browser reads it, and its large images are what to look at.
Footbridges are generic now (a path crossing a water ring or stream gets a
plank deck with rails), but Puttom's imagery shows no bridge on the course
and its streams lie a kilometre north-east, so none is drawn here.

**A pack change re-binds v2.** The v2 root index and course manifest carry
the exact live GPK1 entry (`fallbackV1`) and the surface preview carries
`source.packSha256`; a new pack fails both closed. `publish-ground-rings`
now takes the fallback from the LIVE manifest instead of the previous
root's copy, and the surface preview is recompiled with `--replace`, its
new sha copied into `PUTTOM_PREVIEW_CONFIG.surfaceDescriptorSha256` (a
derived constant: from the tool's output, never typed).

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

### Johannesberg, feature by feature — the trace beyond the holes (2026-09)

`johannesbergbuild/sat-traces.json` is Puttom's `sat-traces.json` for this
ground, and `reconcile.mjs` fuses it the same way (`prov:"trace"`): the manor
forecourt and the golfers' gravel car park, the clubhouse apron, the west farm
track along the pasture and across the heath, six cart paths (three of them
crossing water, so the generic footbridge stands there), the greenkeepers' yard
with its sand pit and topdressing heap (`vegetation.sand` renders as sand), the
range tee line (10–11 bays, hitting WEST, **no net** — the field is open), the
practice bunker, the reed pond west of the 18th's approach, the ditch that
crosses the 18th fairway, three clear-fells, "berget" on the 18th
(`vegetation.rock`, data only — the engine tints rock by slope), and the OB
stakes the club's plans draw on 2 and 18 (`marking`, the Veckefjärden schema,
which embed and emit-pack now carry for every build). Two bunkers the hole
traces missed come from the club's plans: the 7th's greenside (in tree shadow
on the tiles, placed by registering the plan on its tee disc and green) and the
13th's big left-front one (plain on both). The record is §7 of
`docs/courses/johannesberg-source-dossier.md`. Things that bit:

- **Which way a hole plays decides what "left" means.** Holes 1, 2 and 7 play
  SOUTH (z increasing), so a plan's left is world east. The 2nd's OB stakes
  were first put on the wrong side for exactly this reason.
- **Rectangular pale patches are as likely tee pads as bunkers** in a leaf-off
  image where dormant turf is beige; the 1st's two traced "bunkers" sit where
  the plan draws none and the plan's two sit in tree shadow. Same count, ~20 m
  apart, unresolved and written down.
- **The nine is scenery on the eighteen now, and the eighteen on the nine.**
  `reconcile.mjs` reads `johannesberg9build/course-model.json` into
  `scenery`; `tools/build-nine.mjs` drops any parent scenery ring whose centroid
  is within 3 m of one of its own, so the loop cannot double a ring. That
  widened the eighteen's legacy CORE west to x −936 (the nine's greens enter
  `playB`), so the v2 config's `legacyCoreCutout` was re-measured — read it off
  the assertion's own "got" line, never typed.
- **A scenery green by the clubhouse is not always a putting green.** The Ö
  marker took every scenery green within 200 m of the clubhouse, and the
  nine's 9th finishes 47 m from it (as the eighteen's 18th does on the nine's
  own pack). A course may now NAME its practice greens
  (`scenery.practiceGreens`, written by Johannesberg's reconcile, carried by
  build-nine); the engine, the six pages and `apply-markers` believe the list
  where it exists and fall back to the 200 m rule where it does not. The
  migrator classifies the new key as geometry — an unclassified pair fails
  `migrate-legacy` closed, by design.
- **Changing a course model changes its migration, and CI checks both.**
  `check-manifests` hashes `johannesbergbuild/course-model.json` and
  `johannesberg9build/course-model.json`; `check-migration` regenerates the
  EPSG:3006 migration through cs2cs and diffs it. This machine has no PROJ, but
  `pip install pyproj` gives PROJ 9.5.1 and SWEREF 99 TM from WGS 84 is a pure
  Transverse Mercator step, so a 20-line `cs2cs` shim on PATH lets
  `migrate-legacy.mjs --write` run unchanged — verified by the 72 unchanged hole
  fields coming out byte-identical to the committed cs2cs output. Re-record the
  artifact checksums (models first, then the three migration files) and re-pin
  the two migration hashes in `acquisition/hole-source-controls.mjs`.
- **The nine's shapes are measured where the capture allows, by rule.**
  `johannesbergbuild/trace-nine.mjs` classifies the z18 tiles (ExG, brightness,
  saturation thresholds sampled on the eighteen's traced features), contours
  the components and ACCEPTS by rule — a green is a compact disc within 20 m of
  the routed end, a bunker is sand near a green or the routed end and away
  from anything the model calls gravel; `build-nine` adopts only accepted
  shapes (cfg.shapes) and re-ends the route on the measured centre before the
  card slide. Three greens and two bunkers passed; the leaf-off capture cannot
  separate fairway from semi (ExG 32–39 against 24) and six greens are dormant
  and invisible in it, so the rest stays synthesised and the file keeps every
  refused candidate as evidence. A leafed-on dated ortho through the same tool
  is what finishes it; by-eye tracing of this image would only add noise.
- **Every ring is now measured against the 1 m laser terrain**
  (`johannesbergbuild/terrain-check.mjs`, ~10 min: the water rings' shift
  search is the cost). A green is a plateau, a bunker a pit, open water flat;
  the shift that maximises each signal, medianed over interior maxima, is the
  offset between the traces and the laser. OSM's ponds sit on the laser to a
  metre; everything traced from the Esri tiles sits **2–3 m west and 2–4 m
  north** of its laser feature (bunkers n = 20, greens by two statistics, the
  reed pond). Recorded in the dossier (§7.10), not applied — that correction
  belongs with a control survey. Two independent records against one trace
  refuse it: three traced bunkers no plan draws and no pit confirms are gone
  (`sat-traces.json` → `refusedBunkers`); one the plan omits but the laser
  reads as a 0.24 m pit stays.
- **The laser hillshade locates what a leaf-off image cannot.** Four of the
  nine's greens (3–6) and one bunker are read off the hillshade
  (`cache/hs-crop.mjs`, a 10 m legacy grid at 10 px/m) into
  `nine-laser-shapes.json`, `prov:"laser"`, centres ±5 m; build-nine takes them
  where no imagery green was accepted (`cfg.laserShapes`). The 5th's green is the
  mound 33 m east of its routed end — where a 271 m hole from its tee lands — and
  the sand hollow on the mound's west side is its bunker, not the 9th's.
- **`guide-inventory.json` is what the club's eighteen plans draw**, hole by
  hole, with the model's own count beside it; `docs/course-model-vocabulary.md`
  is every model field the engine reads and what each costs when missing.
- **A new pack silently unbinds the v2 ground.** The root index and course
  manifest pin the live GPK1 entry (`fallbackV1`), so after emit-pack the
  flagless visit fell back to GPK1 and `check-course-v2` failed five gates
  with no error line — the fallback is by design silent. Fixing the CORE
  contract alone changed nothing; the pack hash was the cause.
  `packages/course-v2/rebind-live-fallback.mjs <groundId>` re-emits the
  course manifest and root against the live pack from the PUBLISHED chunks
  (no LiDAR artifacts, no PROJ), then rebuild and run `check-app-build` and
  `check-course-v2`. Order for any course with a v2 ground: reconcile →
  embed → emit-pack → emit-manifest → rebind → build → gates.
- **This container's SwiftShader renders every course black** (`frame is a
  picture (lum 0.035)` on untouched Ängsö too), so the pixel gates say nothing
  here; the data gates, the pack byte-identity and the unit suite are what
  proved the change. Look at it on a real GPU before trusting the render.
- `render-design.mjs` wrote a bare `&` in the SVG title, so every viewer
  stopped at line 701 and drew the layout up to the first error only. Fixed.

## The second courses — three clubs here have a course we were not rendering

Upsala GK has three courses, Johannesberg has 27 holes, and Veckefjärden has a
korthålsbana beside the Mästerskapsbanan. All three are now built, all three by
one tool — `tools/build-nine.mjs` — because they are one method:

    a verified card  +  published GPS hole routes  +  the parent's environment

| course | slug | par | tees | parent |
|---|---|---|---|---|
| Mellanbanan | `upsala-mellanbanan` | 35 | 5 | `upsalabuild` |
| Johannesberg niohålsbanan | `johannesberg-9` | 34 | 2 | `johannesbergbuild` |
| Veckefjärden korthålsbanan | `veckefjarden-korthalsbanan` | 27 | 2 | `geobuild` |

    node tools/build-nine.mjs johannesbergbuild/nio.json     # or upsalabuild/mellanbanan.json,
    node packages/course-pack/emit-pack.mjs <build> apps/golf/public/courses/<slug> <slug>
    node packages/course-pack/emit-manifest.mjs

**A second course shares its parent's GROUND but not its PLAY.** Terrain, water,
woods, roads, buildings and the clubhouse are reused verbatim; the parent's own
holes are carried into `scenery` so its mown turf still reads as mown from the
nine, and the relationship is symmetric. `heightfields.json` and `tree-cover.json`
are copied rather than shared, because a pack is self-contained by design.

**Published routes are third-party geometry, and are believed only as far as
something that never entered them agrees.** Each of these was measured after the
fact: Johannesberg's nine landed inside the box predicted from its aerial months
earlier and **closes** (green 9 → tee 1 in 26 m, walks 16–95 m); Mellanbanan
agrees with the independent banguide trace on seven of nine holes and disagrees
on exactly the two that trace had flagged as drawn under canopy; and after the
card slide the synthesised back tees land 1–23 m and 5–42 m from published tee
points the slide never used. Route endpoints stay provisional — they are **not**
surveyed green centres and are never relabelled as such.

**A one-sided, consistent length offset is evidence the hole assignment is
right.** Every Mellanbanan route runs 13–23 m longer than its card, and every
korthålsbana route 13.4–17.4 m. A uniform offset is what a real route start
behind the marker looks like; a wrong assignment scatters.

**A long walk is not automatically a bad routing.** Mellanbanan's walks are
median 106 m against a real course's 20–80, which reads as broken — until you
see that the banguide trace and the GPS routing, which disagree about where two
whole holes are, produce the *same* profile. The transfers belong to the course.

**The permutation test proves a column is well-formed, never that it is the
club's** — and this bit twice. Mellanbanan's stroke index has two series in
circulation, both valid odd 1–17 permutations, disagreeing on all nine holes. It
was settled by reading the club's own per-hole sheets, which are images on
banguider.se: hole 8 is **"Par 4 · Index 1 / 2"** and hole 6 **"Par 5 · Index
3 / 4"**, both matching this repo's card on the index and on all five tee
lengths. A later research pass credited the *other* series to the club and had
the attribution inverted. Go to the club's sheet; do not weigh aggregators.

**Veckefjärden's korthålsbana ships with an UNVERIFIED card and says so** — the
only one here that fails the repo's own rule. Pars sum to the printed 27, but
neither tee column reproduces its printed total (Gul 932/936, Röd 770/776), and
no stroke index is published: the only column found runs 1,2,3,4,5,6,7,8,9,
which is the hole order and so is a scrape artifact. `hcp` is `null` on every
hole and `drawCard` prints the par alone — **nothing was invented to fill the
column**, because a korthålsbana is commonly unrated and an absent index is the
expected state, not a gap.

Two de-duplications this needed, both of the same shape as the `hut` coordinate:

- **`emit-pack` asks the MODEL which schema it is** (`model.lakeLevel !==
  undefined`), not the directory name. The korthålsbana is built on Veckefjärden's
  older model in its own directory, and the old `buildDir === 'geobuild'` test
  would have silently emptied its marking and silt shallows and left its water
  level undefined. Verified inert: geobuild's pack is byte-identical after it.
- **`check-app` reads slug→build out of the manifest**, which now carries
  `build`. It kept a private copy that no rule can derive (`norrfallsviken` from
  `nvgkbuild`, `veckefjarden` from `geobuild`) and that went stale in silence on
  every new course — it had never learned `upsala-mellanbanan`.

Open on all three: **no bunkers** (nothing published shows where they are — a
gap in the sources, not a claim the courses have none), greens/fairways/tee pads
synthesised and marked `prov:"synth"`, and **no posters yet**, so their chooser
cards show the gradient until `make-posters.mjs --candidates` is run.

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

**Phase 5 (the shell)**: `src/shell/` and `src/styles/shell.css`. The course
chooser is a full-bleed poster grid built from the HUD's own tokens — one product,
not a second visual world — and it is an **overlay over a live course**, which is
deliberate: the engine's boot stays a straight line (the re-entrant `loadCourse`
is the persistent-renderer phase's work), and a bare visit shows a real place
rendering behind the choice. Picking a course navigates; that IS v1 switching.
Card posters come from `/courses/<slug>/hero-1.png`, set only once the image has
actually loaded so a course without one shows the gradient rather than a gap.

`src/shell/router.js` is the load-bearing half. **Every historical URL still
resolves to the same view**: the six page names map to their course and the whole
grammar carries through — `hal vy ljus tee skylt ren kiosk q gl`. `gl=1` and
`q=lo` are tested explicitly because an audit found them missing from a plan that
claimed the grammar was preserved verbatim. The redirect fires BEFORE the pack is
fetched; redirecting after a 400 KB download would work and still be wrong.
`tools/serve.mjs` grew the `.html` fallback the host will provide, so the legacy
half is exercised for real. Gates: `router.test.mjs` (the mapping, no browser) and
`tools/check-links.mjs` — twelve URL shapes, half legacy, asserting hole, camera,
light, tee, markers and clean mode. All twelve pass.

**The 14th's difference was never the water.** The fjärd surface, silt margins and
shallows are byte-identical between the two engines — measured, 0.00/255 over an
800x80 patch of deep water. What the phase-4 merge dropped was the island green's
**granite riprap collar**: the boulders at its waterline, the berm of dumped stone
under them, and the waterline band painted stone-grey rather than bleached sand.
Eleven of the club's own photographs put that collar there (commit a3afff0), and
the tell it left behind was a dead palette entry — `C.riprap` defined in the
engine and read by nothing.

It is restored as a scenery-module export, the same mechanism as the species rule:
`armour = { hole, rise, paint, colour }` names the HOLE, not a coordinate, because
the green centre is already in the pack. Draws went 175 → 176, the count the
original commit states. A `reedbed` export restores the fjärd's reed box and the
reserve's west-shore density; reeds went 6020 → 7646, exactly the page's count.

**Measure like with like, or do not measure.** Two shots of the SAME page through
two different `shot.mjs` paths (`--seq` versus single `--hole/--cam`) differ by
1.89/255 — larger than the residual being chased. Comparing across paths made the
fix look like a regression (5.01) when like-for-like it was 3.31, and after the
reeds 3.14, of which ~1.9 is that harness noise. Always shoot both sides the same way.

**The vista clearing, and the far ring behind it.** Chasing the last known merge
casualty — the app punching Norrfällsviken's chapel clearing into Veckefjärden's
horizon instead of its own two (Kyrkudden, so Själevads kyrka stays visible across
the fjärd, and the works yard at Åsmasten's foot) — turned up two more things.

First, that hardcoded coordinate was **latent in four other standalone pages**,
the same way `const hut = [-359, 229]` was: puttom, angso, upsala and
johannesberg all carried Norrfällsviken's chapel green. It is inert wherever the
point falls inside the tree-cover raster's box, because the far scatter only runs
outside it — but at **Upsala it falls outside, and fires**, biting a bald patch
out of Håmö's far treeline. Measured on `stats.vista`: Upsala +11 cones at `q=lo`
(so ~22 at full quality), Ängsö +2 where the grid jitter crosses the cover edge,
Puttom and Johannesberg exactly 0. All six pages now agree with the app
cone-for-cone. It is a `clearings` export; Norrfällsviken keeps its own in a
module of its own, with a note saying plainly that it is currently inert there.

Second, and much larger: **`FARR` is course truth and the merge flattened it.**
Veckefjärden's far ring is `z0:-6000, z1:2520` — deliberately asymmetric, reaching
6 km north to put Åsberget and the hills on the horizon the course looks at, and
stopping 2.5 km south rather than spend a quarter of the ring on ground FogExp2
has already taken. The app had Norrfällsviken's symmetric ±5400. That is 27% more
ring: it accounted for **6868 of the 6903-cone gap** between app and page, next to
about 35 for the clearings. It also moved the horizon geometry, since `FARR` bounds
the vista terrain mesh as well. Restored as a `farRing` export; the vista
heightfield reaches z −6592…6016, so both edges stand on real elevation either way
and this is a framing choice rather than a data limit.

### The pages got the app's `?det=1`, and only then could parity be measured

Verifying the above ran straight into the harness. Pinning the app's clock while
the page's ran live made parity look WORSE (0.062 → 0.138), which is how the gap
was found: **`det=1` existed only in the app.** The page's sky noise and flag
cloth run off a live clock, so a page differs from ITSELF, run to run, by
0.068/255 and 0.71% of pixels — fourteen times the pixel gate. The gate was
unmeasurable on exactly the views a golfer looks at, and every differing pixel sat
above y=450: sky and horizon, never ground.

All six pages now carry the same switch (three anchored sites each: the TSL `time`
import renamed, the `DET` const after the import block, and the flag cloth's own
JS clock). Absent `?det=1` nothing changes. With it:

| comparison | mean | pixels >2 |
|---|---|---|
| page vs itself, unpinned | 0.0676/255 | 0.707% |
| page vs itself, pinned | **0.0000/255** | **0.000%** |
| page vs app, pinned | 0.0003/255 | 0.003% |

Bit-identical against itself, and the app inside the gate with a 15× margin. The
lesson is the sharper form of "measure like with like": **if the reference cannot
reproduce itself, nothing measured against it means anything.** Build the pin into
both sides before trusting any number.

**The id collision worth remembering.** The chooser was first built as `#rail` —
and the HUD's own control panel is `<div class="panel" id="rail">`. A fullscreen
overlay's CSS was therefore being applied to the Vy/Ljus rail on every course.
The symptom the gate reported was tiny (a chooser open when it should be shut);
the cause would have wrecked the HUD everywhere. **When adding an element to a
page this old, grep the id first** — `#chooser` now.

### The ground atlas — live, and what it cost to light up

`docs/ground-atlas-plan.md` (G0–G8) is being executed and the atlas is the app's
DEFAULT ground path: `src/engine/surface.js` (registry + classifier), `atlas.js`
(1 m boot-built raster: ids, SDF, route distance — ~350 ms per course), and
`material.js` (`makeGround`, one material classifying per fragment). In atlas
mode every mown/sand/parking overlay is skipped (draws 143 → ~31) and
`?ground=mesh` is the escape hatch, scheduled to die in G7. The bare route now
boots `src/hub.js` — a chooser with no three.js — and only `?bana=`/legacy URLs
enter the player (`src/entry.js`); `tools/check-links.mjs` proves both halves.
`tools/goldens.mjs` captures the 12-view matrix per course (gitignored;
approval stays human). `check-app` gates atlas presence and green/bunker
interior probes per course. Lessons that cost real time:

- **WebGPU allows 8 vertex buffers, and the terrain was at exactly 8.** Adding
  a ninth attribute (`aAO`) made every terrain pipeline fail validation and the
  whole ground silently vanished — the "white world" was the sky gradient where
  terrain should be, on WebGPU only (WebGL2 allows 16). The six ground channels
  now share ONE InterleavedBuffer (`groundChannels()` in main.js); shaders read
  attributes by name and never noticed. Grep the console for
  "Vertex buffer count" before blaming a material.
- **Store coordinates in filtered rasters, never phases.** A wrapped mow-phase
  byte tears at every 2π seam under linear filtering, and a 1.5 m green stripe
  cannot live in a 1 m raster at all. The atlas stores the SDF and a 0.25 m
  route-distance byte; the shader rebuilds phase per fragment (greens/collars
  ring their own edge via the SDF — which is also exactly the old overlays'
  `-ringSD × k`). Same lesson as the page's "mow stripes must be per pixel".
- **Sand outranks green in `SURFACE_PRIORITY`** because the overlay stack drew
  sand above everything and Ängsö's 9th has a bunker ring overlapping its green
  trace. Priority parity with the page, locked by a test.
- **Binary class weights un-smoothed the vertex world.** `classifyAt` feeds
  `groundAt`, whose forest/wet weights tint CORE vertices; returning 1/0 put a
  hard 4 m stair where the analytic faded over six metres. The atlas's own SDF
  replays the ramps (`edgeRamp`), and dLine/hole come from the exact Float32
  fields, not the quantized texture bytes.
- **A bunker's centroid can lie outside its own ring** (Upsala's 3rd, a 22-point
  crescent) — probe interiors with a scanline-span midpoint, not a centroid.
- **`vertexColors: true` multiplies your `colorNode` by the vertex colour, and
  this engine reads that attribute itself as well.** NodeMaterial does
  `colorNode = colorNode.mul(vertexColor())`, so `makeTurf`, `makeSand` and every
  overlay tier have always rendered the vertex colour SQUARED — the palette is
  tuned to that and it must be matched, not "fixed". It only bit when the atlas
  arrived, because the atlas's colour comes from the style texture while the
  implicit multiply still used the TERRAIN vertex under it: `groundAt`
  deliberately paints no sand on the mesh, so every bunker was
  `C.sand × turf-green` — olive, and the reason bunkers stopped looking like
  sand. `makeGround` therefore sets `vertexColors: false` and squares the
  blended colour itself, so each region squares its OWN colour. Verified against
  `?ground=mesh`, which is what the appearance is being compared to.
- **The pair field is NOT a distance field, and filtering it as one drew a ring
  round every bunker.** The atlas stores one signed distance per texel, signed by
  which of that texel's TWO classes has priority — so it describes ONE edge, the
  edge of that pair, and the pair changes across the raster. Two neighbouring
  texels deep inside the same fairway read **−8** (the nearest other class is the
  bunker, which outranks fairway) and **+8** (it is the semi, which does not).
  Both are true, both render fairway on their own, and both describe eight metres
  of untouched grass — but `texF` is LinearFilter, the interpolation between them
  sweeps the whole way through zero, the transition smoothstep sees a crossing,
  and the shader paints the pair's higher-priority class at full strength. That
  was the stair-stepped pale ring about eight metres out from every bunker, on
  every course, in the boot atlas AND in the v2 pair material. The wedges are
  triangular because at a staircase corner one texel of the bilinear 2×2 is the
  odd one out. `?ground=mesh` never had it, which is the tell: the overlays drew
  sand as geometry. Fixed by a guard, not by a new field — a filtered value only
  means something while the fragment could genuinely lie inside the blend its
  NEAREST texel names, so past 1.3–2.5 m (never tighter than the pixel footprint,
  or a distant edge loses the wide screen-space ramp that antialiases it) the
  texel's own sign is the whole answer. The nearest value costs one tap and no
  second texture: sampling exactly at a texel centre makes the bilinear weights
  (1,0,0,0). Where two texels genuinely disagree the weight becomes a hard
  one-texel step between two texels that render the SAME class, which is
  invisible by construction. `tests/atlas-probe.test.js` runs the material's own
  sampling on the CPU over a synthetic bunker: 84 fragments painted a class that
  is not there, 30 of them sand, and none do now.
- **Removing it exposed the same fault in the mow coordinate.** `mowK` came from
  the PRIMARY id, and deep inside a fairway the primary is the bunker — whose
  coefficients are all zero. So every bunker sat in a five-metre patch of
  fairway with no mow stripes, bounded by that same watershed; it was only ever
  hidden under the sand wedges. The band is now computed for both ids and
  CROSS-FADED as a band, never as coefficients or phases: a fairway's route
  frequency averaged with a bunker's zero is a chirp, and two averaged phases
  draw a third cut neither class has. This is the rule the class-SDF material
  already states, now honoured by the pair material too.
- **One `import()` with a ternary preloads the UNION of both branches.** The
  bare route was still fetching all of three.js, because
  `import(bare ? './hub.js' : './main.js')` is one call site and the bundler
  attaches one dependency list to it. Two separate call sites give two lists.
  The dev server hid this completely — it is a BUILD-only failure, so measure
  the bare route by counting requests against `dist/`, never against Vite.

### The posters have to be the courses

The chooser briefly shipped six generated photoreal images as its course cards.
They are beautiful and they are not these places: pictures of courses that do not
exist, under the names of six real, operating Swedish golf clubs. The quickest
tell is `veckefjarden.png`, which puts a flag reading **16** on what is meant to
be the island 14th, over a green matching nothing in the club's own survey.

A visitor reading a card headed VECKEFJÄRDENS GOLFKLUBB takes the picture above
it as that club. That is the whole problem, and it is not a matter of taste:
shipping those images tells six real businesses' customers something untrue about
those businesses. The rail's own source comment had it right and had stopped
being true — *"the stills are rendered by the shot harness, so they are pictures
of the thing itself and cannot fall out of date with it."* Every hero is a real
still again; the generated set is kept under `docs/concept-art/` with a README
saying what it is. **A plain picture of the real thing beats a beautiful picture
of a different thing.** If a course deserves a better poster the fix is a better
camera, not a different course.

**The nine-hole courses needed different recipes, and said so.** Fifteen
candidates for the three second courses, judged at 400x225 like the rest, turned
up two things that are about the courses and not about the tool. The `top`+`noon`
framing that works on the eighteens **blows their ponds to flat white** — at card
size that reads as a rendering fault rather than a photograph, so none of the
three ships it. And at ground level under an evening sun these forest corridors
go too dark to read small: orbit does the work. All eight shipped frames are
`golden`, and `POSTERS` in `tools/make-posters.mjs` records which framing each one
is, so a re-shoot a year from now is the same picture.

Korthålsbanan's pick is the one worth remembering: its 3rd is the **only** framing
on the nine that shows the fjärd, and a Veckefjärden course whose card hides the
fjärd is selling itself as a forest course. Mellanbanan ships **two** posters, not
four — its ground-level framings were genuinely weak, and two good pictures beat
three with a poor one. The card cycles however many exist, so shipping fewer is a
choice the shell already supports.

**A front door that counts is a front door that stays true.** The chooser's header
read *"sex unika svenska golfbanor"* while nine cards were on screen, and every
filter count was a literal that had been wrong since the day a course was added.
They are derived from `courses` now. The same omission left the three nines with
no category and no editorial line, so Mellanbanan's card carried a bare club name
where every other card describes itself. **When a list grows, grep for the number
that describes it** — nobody edits a string that is not obviously code.

**Judge a poster at the size it is shown.** Six candidate cameras per course,
composited at the card's own 400×225 on the chooser's ground, changed two picks
that looked settled at full size. Veckefjärden's island green is the signature
hole and now renders its restored granite collar — but at card size it is half
blown-out sky and water, so the poster is the hero fairway instead. And it caught
a real gap: Norrfällsviken is *seaside* and every candidate was a pond in the
woods, until it was re-shot down hole 5 to put the Bothnian horizon behind two
greens. Ängsö's fresh re-renders lost to the original and it kept it — a
re-render is not automatically an improvement.

`tools/make-posters.mjs` builds what ships: 800 px wide (2× the card) in WebP,
because full-size stills on the front door are the first thing a phone downloads
and the brief names Android and iOS before desktop. Its header carries the
measured table rather than a claim — the resize is nearly free (0.43–0.48
mean/255), essentially all loss is the codec, and **WebP beat JPEG on both axes
at the same quality number**, so there was no reason to ship the JPEG. What is
not claimed is that the difference is invisible. (It replaced the original
`make-posters.py`, carrying that measurement over verbatim: the encoding is now
done by the Chrome the harnesses already drive, so no Python and no image
library is needed — this machine has neither.)

**Four posters a course, and the card cycles them.** `--candidates` boots each
course ONCE, shoots eight framings — the signature hole from all four cameras,
then two more holes in different light — and writes a contact sheet at the card's
own 400×225 on the chooser's ground; `--write` promotes the picks in `CHOSEN`.
The signature holes are the clubs' own words out of each build's
`guide-notes.json`, not a guess: Norrfällsviken's 12th is "Banans signaturhål",
Johannesberg's 18th is the only plan carrying the "Signaturhål" laurel, Upsala's
3rd is marked SIGNATURE HOLE, Puttom's 12th plays over a bay of Stor-Rössjön,
Ängsö's 15th is the water hole with the only drop zone, Veckefjärden's 14th is
the island green.

**A signature hole is not always the identity, and the contact sheet is how you
find that out.** Norrfällsviken is a *seaside* club whose signature 12th shows no
sea at all, so at rest its card said "another forest course". Its coastal holes
were found by measuring — green 6 is 133 m from the sea ring, the closest on the
course, which is also the hole the club's own text singles out for *havsvinden* —
and hole 6 leads the card now, with the 12th second. The `--extra` flag exists
for exactly this: shoot named framings alongside the standard eight and keep what
is already captured.

The card keeps hero-1 as the `.shot` background and crossfades the rest above it,
so a course with one poster is untouched and needs no slideshow. Three costs are
deliberately controlled: the extras load only once a card has been on screen
(a phone showing two cards fetches two cards' worth), they load **on idle and one
at a time** so they never compete with the six posters actually being looked at,
and `prefers-reduced-motion` gets the resting poster and no fetches at all —
decoration is exactly what that preference is about. Measured on the built app:
**the chooser is usable at 542 kB and 117 ms**, with the remaining ~840 kB of
gallery trickling in behind it. `photos` in the manifest is COUNTED from the
committed files, like `bytes` and `sha256`, so a course that loses a poster stops
advertising it instead of cycling to a 404.

One more thing found in the same pass and left in place with a note: `map.js`
draws tiles from **OpenStreetMap's own servers**, which are donated infrastructure
whose usage policy rules out being the tile source for an app with real traffic.
Fine at this scale; needs a provider before the app is public.

### The site is live on GitHub Pages, and the app had to learn it is not at `/`

`https://olovmelander.github.io/olovs-hemsida/` — deployed by
`.github/workflows/pages.yml` **from `main`**, which is the thing to remember:
work sitting on a feature branch is not published, however green its gates are.

Two things are published, differently. The app is a Vite build, so it is BUILT;
the seven standalone pages are self-contained (verified: zero same-origin
fetches between them) and are copied as REAL FILES beside it. That last choice is
forced — GitHub Pages has no rewrite rules, so the `_redirects` trick that maps
those names into the app on Cloudflare cannot work here. Serving the actual
pages is better anyway: whoever bookmarked one gets what they bookmarked.

**A project site is served from `/<repo>/`, not `/`, and that breaks things
silently.** Vite rewrites the tags in `index.html` and every asset it processes,
which is exactly what makes the remainder dangerous — nothing errors, it just
resolves to the host's root, which is somebody else's site. `base` is
`BANVY_BASE` (one config, both hosts) and everything that builds a URL at
runtime reads `import.meta.env.BASE_URL`. What was actually wrong:

- the web app manifest's `start_url` and `scope` were `/`. An **installed** app
  would have opened github.io's root instead of Banvy — a bug that only appears
  after someone installs it.
- the service worker's `runtimeCaching` patterns were anchored `^/courses/`,
  which under a subpath never matches: offline would have stopped working with
  no error anywhere. They are unanchored and `sameOrigin`-guarded now. Note they
  are **serialised into sw.js**, so they cannot close over a base constant —
  they have to be written so they never need to know the base.
- `fonts.css` is copied verbatim out of `public/`, so Vite rewrote the `<link>`
  pointing AT it and not one url INSIDE it. Every face 404s and the page renders
  in a fallback font with nothing in the console. The urls are relative now —
  and `tools/vendor-fonts.mjs`, which regenerates that file and would have
  silently undone the fix on its next run, emits relative urls too. **A
  generator that disagrees with the fix will quietly restore the bug**, the same
  trap as the checker that agreed with the left/right normal.
- `legacyTarget` returned `'/?bana=…'`, and `packUrl` was baked absolute into
  the committed manifest. The manifest is data; data does not get to know where
  the site is mounted, so `packUrl` is relative and the loader prefixes its base.

`tools/check-basepath.mjs` is the gate, and it exists because **none of that is
findable by reading the source** — it builds for a base, assembles the site the
way the workflow does, serves it AT that path and drives it. Its sharpest
assertion is `document.fonts.check('12px Outfit')`: the fonts failed while every
other check passed, because a fallback font is not an error.

**Taking another course to 1 m v2 terrain**: `docs/v2-course-runbook.md` is the
per-course recipe — what is generic and what is still Puttom-shaped code, which
constants are derived vs reviewed vs MEASURED (the vertical datum offset is
23.6263 m at Puttom and is wrong everywhere else), the order to run things in,
the targets a healthy course hits, and the traps. Read it before starting the
second course, because the first real task there is not data: it is turning
`PUTTOM_PREVIEW_CONFIG` into a per-course record and threading a slug through
the six files that import it.

### Veckefjärden on 1 m terrain — one ground, two courses, and four measurements

`?bana=veckefjarden&v2=require` boots *1 M TERRÄNG · HELA VÄRLDEN · 277 tiles i
7 nivåer till 16 km*, and so does the korthålsbanan. The full record is
`docs/courses/veckefjarden-source-dossier.md`; the short version:

- **One ground, two courses.** `veckefjarden` and `veckefjarden-korthalsbanan`
  share one terrain, one frame and one ground manifest. That last part is a
  gate, not a nicety: `verifyAssetGraph` refuses "a ground referenced with
  conflicting manifests", and publishing the two slugs in separate runs produced
  exactly that — the artifact registration rewrites the source manifest between
  runs, so two otherwise identical ground manifests got different
  `sourceManifestSha256`. `publish-ground-rings` takes `--slug a,b` now and
  emits every course of a ground against one hash.
- **The origin is REVIEWED, not aligned.** `alignTerrainGridExtent` centres its
  power-of-two padding with a floor, so an odd tile deficit lands entirely east
  and south; anchored on the DTM item it left 24 m of clearance south of the
  18th while wasting 479 m east. Centred on the played ground instead:
  E 683909.5 / N 7023002.5, 376 m of margin east/west and 206 m north/south, and
  the whole 2048 m window still inside one 10 km item (702_68).
- **The bridge is derived; only the datum step is measured.** `legacyGridBridge`
  takes the frame's own constants and gives rotation +3.282265°, scaleX
  0.99731484, scaleZ 0.99867326 — reproducing the independent cs2cs migration to
  5 mm. A translation-only bridge would be 43.1 m RMSE and 82.6 m at worst.
  `verticalDatumOffsetMetres` is **20.9924 m**, median over 35,533 played-ground
  samples, MAD 0.2392. Puttom's 23.6263 would be a 2.6 m error here.
- **The proof that all of it is right** is a number neither side of the bridge
  could fake: the v2 ground sits within **−0.89…+0.23 m** of the GPK1 ground at
  all eighteen green centres, median −0.19. A wrong rotation shows tens of metres
  on slope; a wrong datum offset shows a constant bias.
- **A frontier is not a graph.** `descriptor.bounds` used to advertise the
  GRAPH's extent, which is fine while a ground has no rings and wrong the moment
  it does: `graphCoversHorizon` compared 16,384 m against 16,384 m, decided the
  frontier already reached the horizon, and the streaming ring renderer never
  took over. The descriptor advertises the level-zero window now, and configs
  may carry `expectedFrontierBoundsEpsg5845` beside `expectedBoundsEpsg5845`.
- **`GROUND_RINGS` and `V2_GRAPH_FRONTIER_CONFIGS` are registries now**
  (`packages/course-v2/ground-rings-registry.mjs`,
  `apps/golf/src/engine/v2-frontier-configs.mjs`), not one-entry literals in two
  files each. Registering a slug in `V2_PUBLISHED_GRAPH_SLUGS` only lets the app
  RESOLVE a graph; the frontier registry is the narrower gate that lets it
  RENDER one.
- **The LiDAR vegetation is PUBLISHED (2026-09-04), and it went through CI.**
  The Lantmäteriet credentials live as repository secrets, so the credentialed
  chain runs in `.github/workflows/veckefjarden-vegetation.yml` — started by a
  push touching `geo_data/course-v2/veckefjarden/vegetation/RUN` (this
  session's GitHub App holds contents:write but not actions:write;
  workflow_dispatch stays for humans). Acquire mode commits the census, the
  canopy evidence and the review overlays to the branch for the eyeball;
  publish mode repeats the same chain with the same `observed_on` and emits
  the generation for BOTH slugs against one ground manifest. The record:
  22.07M points read (3.4 all returns/m²), cloud ground within
  −0.165…+0.19 m of the published DTM over all 64 tiles (medians), 21,293
  crown candidates → **1,821 machine-reviewed individuals** + stand fields on
  all 64 tiles; the merged exclusions rejected candidates on greens (11),
  tees (11), fairways (92), practice (42) and water (154). In the app both
  slugs plant 1,821 + ~28,000 stand trees at full quality, bases p95 0 m,
  `speciesSource: 'course'` (alder/birch in the reserve), zero legacy trees
  inside coverage — `vegetation-baseline --label v2` all green. Two lessons:
  the review overlays number the MERGED holes, so the korthålsbana's crops
  overwrite championship 1–9 (`hole-0N.png` is whichever wrote last); and the
  korthålsbana's `legacyCoreCutout` had silently inherited the PARENT's
  numbers — its own CORE starts 72 m east (green rings travel through
  scenery, westmost fairway lines do not) — which only the ring-graph
  fallback path asserts, so on any boot where the rings cannot serve the
  terrain rolled back to GPK1 and the fresh vegetation stood on Terrarium
  ground (baseMismatch p95 12.76 m, the forest-canopy signature). The
  korthålsbana carries its own measured cutout now. The v2 vegetation runtime
  takes the course's own
  `species()` rule (`planV2Vegetation`'s `species` option, passed from main.js
  with `ringSD`/`RES` closed over, never imported — the runtime must stay out
  of the flagless closure), reports `speciesSource` beside the plan, and
  `vegetation-baseline.mjs` GATES it against the scenery registry itself, so a
  dropped hook can no longer pass. `publish-vegetation.mjs` re-emits every
  root course of a ground in one run and asserts one ground manifest hash
  (the publish-ground-rings lesson; a one-slug run stranded the korthålsbana
  on the pre-vegetation ground). `compile-vegetation.mjs` and
  `render-review.mjs` merge EVERY migration model the registry's
  `courseModels` declares — with only the parent's model, the korthålsbana's
  greens and tees were missing from the exclusion mask (trees on putting
  surfaces that every numeric gate passes); merged, this ground reads 27
  holes, 27 green rings, 115 tee pads, and Upsala's two-course ground got the
  same fix for free. `veckefjarden-korthalsbanan` is aliased to Veckefjärden's
  scenery module (one ground, one reserve, one horizon; `armour` names hole
  14 and correctly no-ops on a nine-hole pack). The campaign inventory is
  pinned (`acquisition/laser-campaigns.json`, registered in the source
  manifest): the active scan is ONE June 2026 campaign at 3.119 returns/m²
  covering the whole 15.56 km² AOI exclusively — **zero seams**, simpler than
  Puttom.
- **A vegetation publish must not strip the ring quadtree's parent links —
  and the gate agreed with the bug.** `assembleVegetationGraph` rebuilt each
  tile entry field by field and dropped `parentId` on every ground it
  published. The tile manager reads the explicit parent link (levels share no
  index lattice), so both this ground's and Upsala's ring worlds refused to
  serve and every boot silently downgraded to the fixed frontier — which was
  the exact shape `check-course-v2` asserted, so the gate passed BECAUSE the
  world was broken, the same trap as the checker that agreed with the
  left/right normal. The repair republished both grounds from the CI compile
  artifacts against the pre-vegetation root: every superseded manifest stays
  on disk content-addressed, so the rollback was one `git checkout` of
  `v2-index.json` and the byte-identical chunks were reused in place. Three
  assertions came out of it: the publisher carries `parentId` through
  (locked in its unit test, which also proves no parent is INVENTED — the
  verifier rightly refuses a parent that does not contain its child), the
  Puttom freeze test counts 276 parent links on the published ground, and
  `check-course-v2` grew the branch that would have caught it — a config
  declaring `ringGraph` FAILS unless `kind === 'graph'` actually serves,
  with the frontier tile/draw/CORE-cutout assertions applying only where no
  ring graph is claimed.

**And the gate is only as honest as the server under it.** `tools/serve.mjs`
used to stream every file with neither `Content-Length` nor `Content-Encoding`
— a shape almost no real host produces — and that cost two live failures in one
day. First an absent `Content-Length` was read as a declared **zero**
(`Number(null)` is 0 and `Number.isFinite(0)` is true), refusing every v2 chunk.
Then **GitHub Pages turned out to gzip `.bvch`**, declaring the *compressed*
length — 81628 against an expected 81751 — so the published pilot fell back to
GPK1 while every gate here passed. The data was never wrong: pulled from the
live site the chunk is 81751 bytes and its sha256 equals its own filename. Only
the header comparison failed, and `fetch()` decodes transparently, so a
content-encoded length can never be compared with a decoded expectation.

Both were invisible locally because the local server behaved like no host. It
now always sends a length and gzips when asked, and the difference is
measurable: with the old loader against it the pilot reports
`{status:"fallback", reason:"load-failed", tiles:0}`, with the fix
`{status:"ready", tiles:64}`. **Do not reason about what a host ought to do —
ask it**, and point the harness at something shaped like the real one.

### The v2 surfaces are per-class distance fields

`docs/puttom-v2-surface-rendering-plan.md` is implemented: under `?v2=` Puttom's
surfaces come from `surface-sdf-u8-v1` chunks — one exact Euclidean signed
distance per non-rough class (`packages/course-v2/distance-transform.mjs`,
`surface-sdf-grid.mjs`), compiled from a 25 cm resolved mask per tile with a
halo as wide as the clamp, so shared borders are byte-identical — and the
terrain material (`createClassSdfDecorator` in `material.js`) turns them into
normalized weights that blend complete material rows baked as constants. No id
is ever sampled. The pair representation is still decodable and the six GPK1
courses' boot atlas is untouched. `tools/v2-surface-audit.mjs` is the
instrument: `BANVY_GPU=1 node tools/v2-surface-audit.mjs --backend webgpu`
boots the built app on the real adapter, gates representation / overlays /
draws, walks probe transects across every green, tee and bunker edge, shoots
the visual matrix, and reads the GPU's own pixels back in the weights view to
compare with the CPU probe. On the RTX 3070 both backends pass: contour error
mean 0.053 m, max 0.175 m; 1981/1981 pixels agree.

Four things it caught, each of which read as correct on paper:

- **Rough as `−max(sdf_i)` is a seam.** On a green/fairway edge both distances
  are zero, so the distance complement gives rough a third of the weight along
  every cut edge. Rough is `max(0, 1 − Σ raw_i)` — the complement of the
  WEIGHTS — normalised by `max(1, Σ raw_i)`.
- **Asymmetric widths leave a rough sliver.** Green at 0.16 m and fairway at
  0.25 m: the green fades before the fairway has risen. Each class must blend
  over the width of the class it actually meets, found per fragment from the
  two largest distances (`SURFACE_TRANSITION_WIDTH_METRES` in `surface.js`;
  the probe applies the identical rule).
- **The compiler must draw the rings the app draws.** `main.js` smooths green,
  fairway and tee rings at boot and synthesises a pad under every unmapped tee
  marker, and the pack on disk has neither — greens measured 0.28 m off until
  both steps moved into `engine/ring-smoothing.mjs` and `engine/tee-pads.mjs`,
  which `buildGroundSurfaceFeatures({smoothEdges, inferTeePads})` applies for a
  compiler and never for the runtime, whose holes are already smoothed in place.
- **A categorical debug view must not be tone-mapped or fogged**, or its
  pixels cannot be classified; and calibrating colours from the frame must
  first reject pixels unlike the authored colour, or forest — mostly under
  tree crowns — measures as tree-green and claims every rough probe under a
  tree. The palette is hand-spaced now (`surfaceDebugColour`): the golden-ratio
  walk put rough and forest twenty degrees apart.

Two harness notes: `check-app-build` reads `_headers` with line endings
normalised, because a Windows checkout hands it over as CRLF and every rule
was "missing"; and a new chunk name needs adding to `vite.config.js`'s
`globIgnores` or the PWA precaches it and the same gate fails.

### Phase 6 groundwork — the hosting rules, and one that is load-bearing

`apps/golf/public/_headers` and `_redirects` ship with the build, so the hosting
rules travel with the thing they describe rather than living in a dashboard.

**The pack is fetched by CONTENT, not by name.** `loadCourse` appends
`?v=<sha256 prefix>` to the pack URL. This is not an optimisation, it is what
makes caching a pack safe at all: a pack file keeps one path forever, the runtime
verifies its bytes against the manifest's hash, so a CDN handing back yesterday's
pack under today's manifest does not degrade quietly — **it throws, and the course
refuses to open.** With the hash in the URL, changed bytes are a changed URL and
no cached copy is ever the wrong one, which is why packs can then be `immutable`.
The manifest is the one file that must stay fresh, and is `no-cache`.

**There is deliberately no `/*` catch-all** in `_redirects`. The app has no path
routes — a course is `?bana=`, the view is the rest of the query — so the only
non-file paths are the six legacy page names, and those are **rewrites (200), not
redirects**, because the router reads the page name out of the URL and a 301
would strip exactly that. A catch-all would serve HTML in place of a missing
pack, which then fails on its GPK1 magic instead of on an honest 404.
`tools/serve.mjs` makes the same two choices, so the local server and the host
agree and `check-links.mjs` is testing the real rule.

### What the island 14th taught about the atlas

Four things went wrong on one hole, and three of them were the atlas quietly
dropping something the analytic classifier used to supply. Worth reading together
because they are the same shape of bug.

**The greens had lost their mow rings in the middle.** A green is mown in rings
from its edge inward, and the atlas took that coordinate from the SDF — which is
clamped to ±8 m so edges stay crisp. Greens run 20–30 m across, so the whole
middle saturated at 8 and the rings stopped: a flat disc with a banded rim. The
field texture's spare fourth channel now carries the same chamfer distance
UNCLAMPED, 0.16 m over 0–40 m. Coarser than the SDF and it does not matter,
because a mow ring is 1.5 m wide. Locked by a unit test.

**And they were glossy.** The overlays never shaded from the terrain's `SHADE`
table — they carried their own literals — so driving everything from `SHADE` gave
greens gloss 0.54 where the mown overlay used 0.42, which reads washed-out and
plasticky under sun. `SHADE_OVERRIDE` in material.js restores the overlay's own
numbers. It lives there and NOT in `SHADE`, which also shades every terrain
vertex and the whole mesh path.

**A tree stood on the island green.** Every scatter loop rejects a candidate
whose `fair` exceeds ~0.05, and the analytic classifier supplied that by fading a
fairway apron to 13 m round a green and 7 m round a tee. The atlas cannot do it:
its SDF measures the distance to the ADJACENT class, and a green is ringed by its
collar, so out in the rough it reads FRINGE and knows nothing about the green
behind it. `classify()` in main.js now adds the apron from the green and tee
rings themselves — exact, and only those two walk rings, so it is a small
fraction of the old classifier's work. On the island 14th, where the green IS the
island, losing it had put a tree on the putting surface.

**The shoreline was a polygon and the riprap was a necklace.** Surveyed water
rings run in straight segments — around the 14th they averaged 15 m and reached
48 m — and the visible waterline is where `terrainH` crosses the water level,
which that ring carves. `smoothShore()` splits the long segments to 3 m and runs
three light averaging passes, but ONLY near the played ground: this ring is
walked for every terrain sample, so densifying the whole fjärd would be paid for
on water nobody sees. Median segment by the island: 15.1 m → 3.14 m. The silt
shallows needed it more than the water did (12 points, 64 m median, one segment
of 427 m). The riprap was sampling a single jittered LINE and then discarding
most of it on a narrow height window; it now walks across the shore normal as
well as along it, which is what makes it read as a dumped apron rather than
scattered boulders. **What remains faceted is the 4 m terrain grid**, the same
limit the bunker dishes hit — see the ground plan.

### A tee marker has to stand on a tee

Measured across the six courses, only **24–63% of tee markers had any prepared
ground under them** — the rest were a pair of coloured balls in the rough, and
`?vy=tee` opened the hole standing there. The cause is a data gap, not a
placement bug: each card carries three to six tees while the surveys mapped one
or two pads a hole. Veckefjärden scored best (63%) purely because its pipeline
already synthesises a pad per card tee and marks it `prov:"synth"`.

The app now makes that same inference for every course, once, before anything
reads `h.tees.pads`: a mark no mapped pad covers gets a 10.4 × 8.8 m deck at the
mark, squared to the hole's bearing (Veckefjärden's own synth-pad proportions).
Everything downstream then follows for free — `TI` benches it level in
`terrainH`, the atlas rasterises it as `SURFACE.TEE`, the marker lands on mown
grass. **All 522 markers on all six courses now stand on tee grass**, gated in
`check-app` by probing the ATLAS at each marker rather than trusting the model.

What is inferred is the *pad*; what is not inferred is *where the tee is*, which
the card's own length already fixed. Back-tee marks sit 8–18 m from the mapped
pads on five of six courses, which is the documented card-slide behaviour.

**And the app opens on the yellow tee**, on every course, because that is the tee
most members actually play — a bare visit used to start on the back tee, which on
Upsala and Veckefjärden is a championship 6192 m and 6436 m against 5565 m
and 5804 m off the yellow. Which index that is differs per
course (first at Norrfällsviken, second on the five-tee cards, third on the two
six-tee ones), so it is DATA: `emit-manifest` derives `tees.def` from the colour
`0xf0c93a` in each course's own swatch table, and the app reads
`CMETA.tees.def ?? 0`. **By colour, never by name** — Upsala and Veckefjärden name
their tees by course rating ('56', '58'), so a name match would have silently left
exactly those two on the back tee. `check-app` gates it against the manifest's
colours rather than against `def`, so the gate and the generator cannot agree with
each other while both are wrong. A course with no yellow throws at generation
instead of falling back, because the fallback would be a guess.

`syncURL` omits `tee=` at the default rather than at index 0, so a shared link
still round-trips; every historical `?tee=N` link is untouched, N being an
absolute column. The **standalone pages still open on their back tee** — they are
hotfix-only — so a parity run comparing app against page must now pass the same
`?tee=` to both sides. Same rule as everywhere else here: measure like with like.

### The bansafari is a broadcast flyover, and it is measured

`initHoleFlight` in main.js builds one continuous drone shot per hole as a
table of stations every 3 m -- position, look point, lens -- and the frame
loop only walks it (`flightStep` + `applyFlightCamera`). The shape is the PGA
Tour hole flyover: a slow push-off from behind the tee, a climb to a cruise
that scales with the hole, a descent into the approach with the pin held
in frame, a 180° sweep round the green ending on the reverse angle, a hold,
and then -- no cut -- a TRAVEL SHOT to the next tee: the camera leaves along
the sweep's heading, flies a straight-then-arc route that arrives behind the
next tee heading down the hole, and settles into that hole's push-off with the
springs carried across, so the whole tour is one take. The card fades out for
the travel and back in as the route lines up. `tools/check-flight.mjs` gates
it (clearance, pan rate, jolt, pitch band, duration) by asking the page to
SIMULATE each hole offline through `V3D.flightSim` -- holes 2-18 WITH the
travel shot in front of them -- and can fly a hole live or run the tour
through its first transition. Things it took the measurements to find:

- **Nothing turned the camera.** OrbitControls' `update()` is what orients the
  camera and it is skipped while flying; the old flight had no `lookAt`, so it
  slid along its spline staring in one fixed direction. The look curve it
  built was dead code. Flight orientation is an explicit `lookAt` now.
- **The ground under the flight is an envelope, and the trees are the planted
  ones.** The highest terrain across a 24 m swath plus the tallest crown top
  in the planted population (`treeTopGrid`, a 10 m cell max over `trees`),
  slope-limited to a 12° climb, then filtered. A class lookup
  (`classify().forest`) misses most of what the planter stood up from the
  satellite raster and the v2 registry -- the first version flew through the
  crowns behind the 12th at Puttom while reporting 19 m of clearance.
- **The sweep keeps its pitch and gives up its radius.** Climbing over the
  canopy at a fixed radius put the camera 44 m over a par-3 green looking
  straight down at a disc with no horizon. Pitch to the pin is 26° at the
  design radius, steepens to at most 33°, and past that the arc widens
  (to 85 m); the sweep's speed is an angular rate so a wide arc pans no
  faster than a tight one. The frame centre aims 7-11° above the pin so the
  horizon stays inside the top of frame.
- **A level sweep below a crown it did not know about is a pop.** The floor
  used to be applied after the filter, so one station's lift became a 6 m
  jump in half a second (hole 6, 148 m/s²). The floor is applied against the
  slope-limited envelope BEFORE the filter now; the smooth-max after it is a
  safety net that should not fire, and the gate's jolt limit is what proves it.
- **Measure the sim at full precision.** Rounding the track's timestamps to
  milliseconds put 2% jitter on every velocity and 70 m/s² of fake jolt on
  every hole, which hid the real one.
- Speed is a function of distance integrated once into a time table, so the
  shot has one velocity profile and no seam at the green. Position and look
  point pass through critically damped springs with different time constants
  (0.28 s airframe, 0.85 s gimbal). A hole's own shot takes 25-36 s; with the
  travel shot in front of it 32-55 s, so the tour runs about 14 min. (The
  speeds were raised twice at the owner's request after viewing, about a
  third in all; `FL` holds every number and the gate is what says each
  raise was safe. The gimbal pan now peaks at 19.9°/s against the gate's 20,
  so any further speed has to come from cruise and travel, not from the pan.)
- **The next tee is usually IN FRONT of the last green, not behind it.** A
  route to a line-up point behind the tee therefore has to turn round, and a
  single Hermite curve to it folded into a hairpin (a 155° reversal in one
  station). The last leg is a turning circle tangent to the hole's axis at
  the line-up point, on the green's side, reached along its tangent.
- **Smooth the gimbal in pan and tilt, never the look point in space.** A
  look point damped in x, y, z cuts the chord when its target swings round
  the camera; on the 180° swing out of a reverse angle that chord passes
  through the camera's own footprint -- pitch 78°, 990°/s. And a blend
  between two look points must be angular about the camera for the same
  reason, with its arc branch chosen once per blend and held (the shorter
  arc changes sides between adjacent stations when the bearings are near
  opposite), and tracked only while the blend is active.
- **On the travel shot the gimbal is a rate-limited tracker** (`swingRate`
  18°/s, `tiltRate` 10°/s) from the heading it held over the last green to
  the route ahead, and it hands over to the hole's own look only once it has
  converged. A blend on distance or time stacked its own swing on the arc's
  rotation and reached 34°/s; a hand-over at a fixed station jumped. Because
  only the gimbal rate is visible, the turning arc itself may be flown at
  28°/s of heading change (`panMaxTransit`), which is what keeps the travel
  legs to 9-21 s. Speed is also capped by path curvature everywhere and the
  cap propagated at 2.5 m/s², so the drone brakes into a bend, never in it.
- The route point the travel shot looks at is pushed out to a fixed
  110 m so a bend can never put it under the camera, and the travel height
  is 30 m over the crown-inclusive envelope: 42 m put the camera 80 m above
  the ground it was looking at and pitched it to 47°.
- The progress label reads `GREENSVEP`, not `GREEN 360°`, because the sweep
  is 180°. The standalone pages still carry the old flight; they are hotfix-only.

### Kikaren is a rangefinder, and its numbers have tests

The first item of `docs/banvy-blueprint.md`. The ball starts on the current
tee; a long press (or "Mät härifrån") moves it, a tap measures to the tapped
point. The card always shows front, centre and back of the green from the
ball (the first and last metres inside the green ring along the ray through
its centre), what the straight line to the green crosses, and the layups
that leave 100 and 150 m. For a tapped point it adds the climb, the lie, every
hazard the shot crosses with the layup that stays short and the carry that
clears it, and the plays-like number with its parts. The arithmetic is
`engine/rangefinder.js` and is the GPS apps' published one, in metric: a
metre per metre of rise, 2.24% of the shot per m/s of headwind and 1.12% per
m/s of tailwind (1% and 0.5% per mph), 0.135% per °C off 21 °C, the wind
term capped at a quarter of the shot. `engine/weather.js` fetches the live
reading from Open-Meteo (no key, CORS open), one per course, cached half an
hour in localStorage, stale-but-shown when offline. Two conventions worth
restating because they are easy to reflect: a compass bearing is
`atan2(dx, -dz)`, and Open-Meteo's wind direction is where the wind blows
FROM, so headwind = speed · cos(windFrom − bearing). `V3D.rangefinder(origin,
target)` returns the same numbers with no DOM, which is how the harness
checked that the tee-to-centre distance on Puttom's 12th is the card's 110 m
and that the line crosses the lake from 23 to 84 m.

### The clubhouses, and what a photograph is for

**Two of six were not being drawn as clubhouses at all.** The buildings pass
matched `/golfklubb/i`, which finds "Veckefjärdens golfklubb" and "Klubbhus
Norrfällsvikens Golfklubb" but NOT "Ängsö GK Klubbhus" or Johannesberg's plain
"klubbhus" — so those two rendered as ordinary grey 3.4 m houses with a generic
roof and none of the clubhouse treatment. It now matches `amenity=clubhouse` or
`golfklubb|klubbhus`, the same pattern the marker layer already used, and takes
only the LARGEST match per course: Ängsö tags three separate structures with that
name and its sheds are not clubhouses. Still kept separate from `CLUB`, which
shapes terrain — widening that would move ground on shipped courses.

`tools/clubhouse-refs.mjs` builds the reference: it converts each clubhouse
centroid to lat/lon through the model's own frame, pulls Esri tiles around it,
and draws the OSM footprint on top. Because the tiles are orthorectified the
overlay is a real check on the footprint, not decoration. **z19 has no coverage
in Sweden — z18 is the usable maximum.** It found that Ängsö's footprint covers
only part of a longer NW–SE building.

**Each clubhouse now carries its own look**, as a `clubhouse` export in
`src/engine/scenery/<slug>.js` — the same mechanism as `species`, `armour` and
`clearings`, and for the same reason: it is a fact about one place. The engine's
defaults are Veckefjärden's (cream render, dark red roof, three window rows),
because that is the building the clubhouse code was written from; every other
course overrides them from photographs:

| course | walls | roof | storeys |
|---|---|---|---|
| Veckefjärden | **pale yellow timber**, white trim | **dark grey sheet metal** | 3 (the old school) |
| Norrfällsviken | falurött, white trim | dark red-brown | 1, glazed veranda + terrace |
| Puttom | Falu red, white trim, a glazed gable end (the "blue lower storey" in the sunset photo was the blue hour) | dark grey, gabled | 2, window wall, balcony and terrace facing the 18th green |
| Ängsö | falurött, white trim | **terracotta pantile** | 1½, dormers, a red COURTYARD |
| Upsala | **cream render** | orange-brown tile | 1 tall, run of gables |
| Johannesberg | falurött, white trim | orange-red tile | 1½ |

Two of those needed care. **Ängsö is not one building but a courtyard** — OSM
carries three footprints all named "Ängsö GK Klubbhus" (546/165/123 m²) and the
photograph shows exactly that; the largest is drawn as the clubhouse and the
others come through the generic pass as the outbuildings they are. And at
**Johannesberg the big white turreted manor is the HOTEL, not the clubhouse** —
the clubhouse is the long low red range west of it. The manor carries no golf
name, so it correctly falls to the generic pass; that is the right outcome and
should not be "fixed".

**Aerial imagery gives a roof; it never gives a facade.** Roof shape, ridge
direction, roof colour, terrace and surroundings are all readable from above and
are verifiable. Wall colour, materials, storeys and glazing are not, and guessing
them invents an appearance for a real business — the same error as the fabricated
posters. `geobuild/cache/find-photos.mjs` renders a club's site in Chrome and
lists the large images it actually loads, which a plain fetch misses entirely
(most of these sites are JS-rendered). That is how Norrfällsviken's facade was
established. It does not always work: Upsala, Ängsö and Puttom publish course
photography rather than pictures of their buildings. Downloaded reference photos
stay in the gitignored cache and are never committed — they are other people's
copyright, and some contain identifiable people.

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

## One terrain to the horizon — the ring graph (Puttom, `?v2=`)

The fixed-frontier pilot put 64 one-metre tiles inside the legacy 12 m and
36 m Terrarium rings, and where the two met, heights disagreed by metres: a
dark band, a gap and a lit skirt ran diagonally across hole 14. The fix is
one source everywhere: `packages/course-v2/terrain-rings.mjs` compiles
nested rings — the same 64 course tiles, then 2 m to 1.5 km, 4 m to 3 km,
8 m to 6 km and 16/32/64 m to a 16 km root — into one quadtree with
**explicit `parentId`s** (levels do not share an index lattice, so the tile
manager reads the parent link instead of deriving it). Every seam is a
same-source level seam, sealed by the batch's geomorph and skirts.

- **Data**: `packages/course-geo/acquisition/build-ground-rings.mjs` reads
  the rings from Lantmäteriet's `dtm-cog` items (10 km squares, Float32,
  deflate, predictor 3, overviews at 2–32×) with the Node COG reader in
  `packages/course-geo/cog/` over authenticated range requests: 68 MB, 15 s
  for all seven levels. The 1 m ring reproduces the CI extraction to half a
  quantum; the 2 m ring is subsampled from 1 m so its samples coincide with
  the course tiles; coarser rings read the overviews, which Lantmäteriet
  AVERAGED (measured), resampled bilinearly. An item may end its overview
  chain early (the coast item has no 32×); fall back to the finest coarser
  one. `publish-ground-rings.mjs` reuses the published course tiles byte
  for byte (asserting they decode to what it compiled, tolerating the
  one-quantum rounding ties a text dump leaves) and carries their surface,
  object and stand layers; `prune-generations.mjs` retires old generations
  but keeps everything the preview DESCRIPTORS reference — a one-off script
  that walked only the manifests deleted the 30 surface chunks beside them.
- **Runtime**: `engine/v2-graph-terrain.mjs` drives the manifest-driven
  streaming runtime in the pilot's bridge (frame origin = legacy origin,
  height = −datum offset, the group rotated and scaled), keeps every ring
  decoded on the CPU for construction heights, and main.js builds NO legacy
  CORE, MID or FAR in that mode. Rough is tinted by two rasters baked from
  the legacy classifiers (`groundAt` to 1.5 km at 6 m, the vista rule to
  6 km at 24 m), sampled by the class-SDF material.
- **The stream controller starved the boot.** Once a tile's children were
  drawn the plan stopped asking for it, the controller released it, the
  next plan requested it again, the pool answered at once, and that
  promise chain never let a timer fire — 100 s of "plan" on every stack
  sample and no error anywhere. `plan.retainTileIds` keeps the ancestor path
  of every desired tile; the controller test with an instant loader is the
  gate. Diagnose a silent boot with `Debugger.pause` over CDP, not with
  `page.evaluate`, which cannot run while the thread is busy.
- **Rings must be whole coarser tiles.** The first cut used six-wide rings
  (3, 6, 12 km); a coarse tile at a ring's edge was half covered by finer
  tiles, the planner replaced it by the children it had, and the other half
  was drawn by nothing: sky through the ground in tile-shaped plates with
  trees and lakes floating over the gap — the "bright rectangles" in every
  report. Every ring is eight tiles wide now (2, 4, 8, 16 km) and both the
  compiler and the tile manager refuse a parent with children other than
  four or none.
- **Test a tile's visibility in the lattice's space, and not by planes
  alone.** Rotating an 8 km box into the legacy frame inflates it by
  ~500 m, so a coarse parent passed while its children failed and 32 m
  ground was drawn beside the 1 m course; and a plane-by-plane test never
  excludes a large box beside a narrow pyramid. `createTileFrustumTester`
  works in lattice space and clips the frustum to the tile's height slab.
- **Water levels are measured against the world, before the model.** The
  rings are read on the main thread right after selection (0.5 s) so every
  lake, not only those under the course window, gets its level from the
  ground it is drawn on; lakes past the window used to keep Terrarium levels
  metres off, hid under the DTM or floated, and the far scatter planted
  cones on them. The extract also cuts lake polygons at its bounding box:
  `engine/v2-flat-water.mjs` finds laser-flat water in the 4 m ring (26
  flats, 24 unknown to the pack, 558 ha), tints it, keeps trees off it and
  lays a masked sheet where no ring does. The water material carries a
  depth bias so distant sheets stop fighting the bed.
- **The laser's lake is a plate, so the bed is carved at boot.** With the
  ground inside every lake being the surface itself, the sheet stood 25 cm
  over the bed and the shader's depth term painted whole lakes as silt from
  any oblique view — brown Stor-Rössjön — while from straight above the
  same sheet was blue. `engine/v2-water-bed.mjs` lowers every sample on the
  water to level minus a shore-distance profile (0.15 m at the edge, 3.5 m
  deep), rewriting the CPU ring sampler in place and every tile the GPU
  decodes through the runtime's `transformDecoded` hook: 811 ha, 3 s. Only
  samples within 0.5 m of the level are touched, so banks and islands a
  loose ring encloses stand. The published tiles never change; this is a
  rendering choice and is documented as one.
- **A clear fragment still writes depth.** The flat-water sheet is one quad
  per component over its whole box, transparent where its mask is zero —
  and it hid the ring sheet under it: standing 15 cm above the ring's level
  it wrote depth through its clear part, the ring sheet failed the test,
  and the lake by the 12th showed its freshly carved bed as brown ground
  while `pick` reported water. The masked sheet writes no depth and meets
  a modelled body at that body's own level.
- **How the plates were found**, for next time: hide things (`V3D.
  setMeshesVisible`, `setWaterVisible`), force the world material unlit
  and single-coloured (`V3D.v2WorldMaterial`), and look straight down
  (`V3D.placeCamera`). Sky through unlit ground is a hole; nothing else is.
- **Every raster edge is a square drawn on the ground.** With one terrain
  to the horizon, four boundaries that used to hide under the legacy ring
  seams became visible as straight lines around the course, found by
  probing `V3D.probeGround` along a transect and by an unlit, fog-free
  top-down: the surface window's FOREST class was a flat near-black inside
  its 30 tiles against the tinted forest floor outside (the surroundings'
  classes now take the tint too — `TINTED_CLASSES` in material.js); the
  satellite cover raster's edge, where the imagery's thinning stopped and
  the rings' closed floor began (`coverEdgeFade`, 240 m, for both the
  floor and the planter); the near tint's edge at 1536 m (the far raster
  now restates the near one box-averaged inside that box, and the shader
  crossfades each layer over its last 300/600 m); and the planted trees
  ending at MIDR where the cones began (`midrEdgeFade`, a 350 m band the
  planter thins by and the cones fill by its complement; legacy trees
  92,254 → 79,399). None of these was a data edge — each was a rule
  changing along a line.
- **The forest floor is moss, and the shade is the shadows' job.** Measured
  in the overhead of the 7th with the trees hidden, the floor rendered at
  45% of the rough's luminance beside it in both lights — a near-black
  olive (36,39,20) — and the edge against mown turf shouted. `C.forest` is
  moss-and-bilberry 0x5c6b3c now, `groundAt` goes 0.75 of the way to it
  instead of 0.85, and the classifier's forest ramp is 12 m instead of 8:
  floor-only 64–66% of the rough, with the crowns 76–84%. Re-measure with
  `floor-measure.mjs`'s method (fixed boxes in a deterministic view, trees
  hidden and shown) before retuning; a palette judged with the trees on is
  judged through their shadows.
- Measured on the RTX 3070: 277 tiles in 7 levels, 129 tiles in one draw at
  the first frontier, boot 25–28 s, 42 tiles from the 14th tee.
  `tools/world-capture.mjs` gates the views where the seam lived.
- **"The terrain flips to another terrain for a split second" was the render
  rule.** A desired tile that is not resident is drawn as its nearest
  resident ancestor, and every resident tile under that ancestor is dropped
  for the frame — so a refined quad with a child outside the frustum showed
  three fine siblings, and the moment the camera turned and the fourth came
  into view for the first time, the three fell to the coarse parent until it
  arrived, and back. The planner now wants a refined quad's out-of-view
  children too (requested last, retained once resident), and the stream
  controller keeps a tile the plan stops wanting for a 1.5 s grace
  (`releaseGraceMilliseconds`, `?tilegrace=0` is the before) instead of
  releasing it on the next plan and drawing its parent while it loads again.
  `tools/goldens/tile-flips.mjs` counts both under the owner's own inputs
  (`V3D.v2Plan`). Two gate rules came with it: the on-demand shadow map must
  follow the fade queue whoever drives the clock (a crossfade uploads
  nothing — the dither runs on a uniform), and a strict capture must wait out
  the 240 ms morph after the stream reads idle, or a build that kept a tile
  resident differs from one that morphs it in by a morph and nothing else.

## The trees by place — the LOD, and the two harness rules it taught

`docs/tree-lod-plan.md` is the plan and carries every measurement. **The
rule, the owner's (2026-09-05): a tree on or around the course never changes
its detail with distance.** `TREE_LOD.lodMode = 'zone'` (the default) gives
every tree its tier from where it STANDS — the corridor raster's three bands
round the hole lines, A within 90 m → hero, B within 300 m → full, C within
700 m → decimated, beyond → octahedral impostor (a phone one tier coarser in
every band) — fixed for the life of the visit, so no camera motion ever
switches, fades or dithers a tree. Frustum culling per cell stays, instant
and margined. The screen-size machinery is all still there as
`?lodmode=screen`: tiers from the pixels a tree's own height projects to,
corridor floors, hysteresis, a six-frame dwell, and the 0.3 s screen-space
Bayer crossfade drawn by both tiers with complementary masks
(`engine/tree-fade.mjs`, honoured by the shadow pass through
`material.maskNode`; under `?det=1` the fade is 0). It is the before for
every measurement and the mode the pop meter measures switching in — it
boots with `lodmode=screen` itself. The golden views changed at the zone
commit by design; compare builds in screen mode when the question is
"did anything else change". **A conifer's tip is a leader, never a ball**:
the pine template carried an icosahedron of radius 1.5 m on its tip that
read as a birch crown glued on a pine, and the decimated tier lacked it, so
the tip also changed shape between tiers; it is five whorls tapering to a
point in every tier now (`tools/goldens/pine-look.mjs` frames one hero pine
for a before/after). A template change moves the fingerprint's
`treeInstances` hash — measured trees rescale to keep their laser height —
while `trees`, the positions, stays; read the two apart. Measured on the RTX 3070 with
`tools/tree-pop-meter.mjs` in screen mode: a dolly that used to change a
hundred 16x16 blocks by 18-34/255 in one frame never moves a block's mean by
more than 2.5/255. Two things the meter taught, both in its header:

- **`shot.mjs --seq` does not wait for the terrain stream.** A tile landing
  between two builds' shots read as an 18%-of-pixels difference on the
  14th that no shader change had made; with `loadingTiles === 0` and two
  more frames the builds were identical. Any before/after picture of a
  `?v2=` course needs that settle.
- **An instant reset from a settled camera flips every tree parked in a
  hysteresis band**, not only the switch under test; start every measured
  event from a hysteresis-free state (a reset at the same thresholds).

## Shadows, depth, the camera's footing and the frame at rest — five rules

- **Never `setUsage(DynamicDrawUsage)` on an attribute you update yourself.**
  three's WebGPU `Attributes.update` re-uploads any attribute with that usage
  **whole, every frame, whether or not it changed**. The tree tiers' instance
  matrices, their fade attribute and the impostor slots carried it, and at
  rest that was 38.9 MB and 15.5 ms of `writeBuffer` a frame for nothing —
  two thirds of the main thread — while the tiers already uploaded their
  dirty ranges through `needsUpdate` (`flushRanges`). "The water glitches
  and jitters" was that: the water is the only thing that moves when the
  camera is still, and a frame that alternates between two and three refresh
  periods judders exactly there. `tools/goldens/write-buffer.mjs` names the
  buffers written each frame; `tools/frame-at-rest.mjs` (cap off, one thing
  hidden at a time, the rAF interval and the main thread's longest block) and
  `tools/scene-census.mjs` (the draw list by kind) measure the rest. Another
  browser rendering on the same GPU inflates every timing run, so trust
  interleaved A/B and the CPU block, never one run's absolute number. Two
  more things came out of the same measurement: the shadow map renders **on
  demand** (`shadowRest`: the sun's snapped box, a tree upload or fade, a
  terrain tile or morph, a flight, or once a second; `?shadowrest=0` is the
  before), and the course furniture is **instanced** (`instancedFurniture`:
  markers, poles, cups, plates, posts — 288 objects became seven). Build a
  new piece of furniture as an instance of a kind, never as a Mesh per hole.
- **The camera is never snapped to the ground.** The per-frame clamp that keeps
  it out of the terrain is `engine/camera-clamp.mjs`, and it eases to eye
  height, reads the ground up to four metres ahead along the camera's own
  motion so a bank is climbed at a steady rate before it arrives, and gives
  back only what it lifted when the ground falls away, at a glide of at most
  1.5 m/s. The snap it replaced
  (`if (y < ground + 1.7) y = ground + 1.7`) kicked the view on every bump of
  the 1 m heightfield — 5.6 cm steps under a pan and 48 cm under an orbit at
  the 5th tee, 73 cm at the 14th — which is what "terrain jitter" was at a
  tee. `tools/clamp-rest.mjs` proves it does nothing at rest on the twelve
  golden views (height, lift account and pixels all unchanged over sixty
  frames), so the goldens stay comparable; its unit tests hold the ramp, the
  floor, the give-back and the distance cap. Do not put a second clamp beside
  it, and do not read the ground further ahead in time without a distance cap:
  an orbit's tangent is ten metres off its circle 28 m out, and read a hill
  there the camera climbed 1.4 m in one frame.
- **The shadow map moves in whole texels of itself.** `placeSun` fits the sun's
  box to one of five fixed sizes and snaps its centre to the map's texel grid in
  the light's view space, so a pan never re-samples the world by a fraction of a
  texel (that was the swim). Do not re-fit it continuously again, and do not
  scale the fit without scaling `normalBias`. `?shadowsnap=0` is the before.
- **The depth buffer is reversed and float on WebGPU** (`?rdepth=0` for the classic
  one). Every `polygonOffset` takes its sign from `DEPTH_SIGN`, never a literal;
  every CPU frustum passes `camera.reversedDepth` to `setFromProjectionMatrix`;
  and anything that pins itself to the far plane with z = w (three's SkyMesh
  did) must use z = 0 there, because three also reverses its whole render list
  under reversed depth, renderOrder included. The tree LOD plan's last section
  has the measurements and the three failures that taught each rule.

## Puttom vegetation — the LiDAR tree plan, Phase 0 and the compiler core

`docs/puttom-v2-lidar-tree-placement-plan.md` is the plan; its checkpoint
section says what has landed. The facts that took probing to establish:

- **The two Laserdata Skog scans abut through the course.** North of
  N 7025000 is a June 2023 CityMapper-2 scan, south of it a June 2026 scan
  delivered 2026-08-25; the legacy origin is 2 m south of the line and the
  published v2 ground straddles it. There is no overlap band to reconcile —
  nothing may be blended across the line. `record-laser-campaigns.mjs --check`
  fails when the catalogue drifts (a north re-fly is expected: Västernorrland
  is in the 2026 scan plan), so a change is adopted on purpose.
- **"Density" is three numbers.** The STAC `pc:density` field is the average
  point SPACING in metres; `punkttathet` is the declared 1–2 pulses/m²; the
  public `_info.json` gives 2.8–3.2 all returns per m². Say which one a gate
  uses. The two campaigns' intensity scales differ by 16×; never compare
  intensity across the seam unnormalised.
- **Skogsstyrelsen's tree height is the same laser data reprocessed**, so it
  checks our processing, not the source. Its ImageServer answers 403 with the
  account in `.env`; its county zips are open, CC0 and 8.6 / 24 GB.
- **Lantmäteriet access is an account matter.** `dl1.lantmateriet.se`
  answered 401 for the DTM as well as the COPC on 2026-09-02 with the pair in
  `.env`, while the STAC API accepted it; `access-preflight.mjs` reports
  `denied`. `run-copc-census.mjs` (header + COPC VLR + hierarchy pages, no
  point bytes) is the first thing to run once that is fixed.
- **The planter now remembers why each tree stands there** (`treeWhy`:
  forest ring, scrub ring, satellite raster, shore belt) with no placement
  change; `V3D.legacyTrees()` exports the population and
  `tools/vegetation-baseline.mjs` freezes it with tee-view captures. Puttom on
  `?v2=require`: 67,568 trees, 36 draws. `V3D.v2Objects()` and
  `V2_OBJECT_LAYER_GATE` make "no object renderer yet" fail closed.
- **Windows checkouts break the manifest gate.** git converts committed LF
  JSON to CRLF, so `check-manifests.mjs` reports checksum mismatches on files
  nobody touched; the HEAD blobs hash to the recorded values and CI passes.
  New evidence files are written with LF.
- **Dalponte's 45% core is not the drip line.** On synthetic crowns the grown
  segment's radius is ~0.7 of the visible crown; `crownExtents` recovers the
  extent for individuals with a Voronoi constraint so neighbours never share
  a cell. Heights are read from the unsmoothed copy; the smoothed copy only
  finds maxima, and its apex can sit a cell off — records carry the
  height-weighted centroid.
- **Lantmäteriet's half-tile COPC items do not subdivide the COPC cube.**
  Each axis is subdivided over the HEADER extent (Y over the 5 km half, Z over
  the point heights); only X coincides with the cube. Verified node by node
  on all three Puttom items (`packages/course-geo/copc-reader/verify-octree-convention.mjs`).
  PDAL prunes by the cube and therefore reads the wrong nodes on these files —
  that was the "52 points in a 256 m window" mystery. The Node reader in
  `copc-reader/` (own `npm install`; `copc` + `laz-perf` WASM, never in the
  workspace lockfile) selects nodes by the extent rule and holds every decoded
  node to the hierarchy's point count exactly.
- **Real numbers, 2026-09-02.** The whole 2 × 2 km published ground read in
  74 s (146 MB), cloud ground within a decimetre of the published DTM on both
  campaigns, and `compile-vegetation` derived 44,961 crown candidates in 36 s
  (3,710 individuals, 685 of them in provisional zone A). Rasters and the
  43 MB candidates file stay in `packages/course-geo/toolchain/.cache/`;
  `geo_data/course-v2/puttom/vegetation/*.json` is what is committed. Git
  `stash pop` re-checks out untracked JSON with CRLF on Windows and silently
  breaks its recorded hash — normalise to LF before trusting a mismatch.
- **The generation is published and the app plants it (2026-09-02).**
  `compile-vegetation.mjs --machine-review` approves individuals by versioned
  rules (no human review, by owner decision); `publish-vegetation.mjs` attaches
  the object registries and the new `stands` chunk kind (`stand-field-u8-v1`,
  4 m cells of canopy fraction and heights) to the ground graph and re-emits
  the manifests; `engine/v2-vegetation.mjs` loads them fail-closed under a v2
  flag, plants 3,502 measured individuals and ~56,000 stand trees from the
  field, and the lattice is cut out of every tile the generation owns.
  `tools/vegetation-baseline.mjs --label v2` is the gate (zero legacy trees
  inside coverage, bases on the visible ground, all tiles loaded); 725 KB per
  v2 visit, 36 draws. **Look at the overhead before publishing**: a list of
  rings passed as one ring rasterises nothing, and six trees stood on the
  driving range while every numeric gate passed.
- **The independent check is CHMv2, read in Node.** `packages/course-geo/chmv2/`
  holds a range-request COG reader, a transverse Mercator series (tested
  against the PROJ numbers already in `geo_data/`), `build-chmv2-window.mjs`
  (samples the optical tile onto the campaign rasters' own grid) and the
  cross-check runner in `packages/course-v2/vegetation/`. Read its evidence
  as calibration, not error: CHMv2 compresses height (slope 0.46) and smears
  crowns outward, so per-tile kappa is meaningless in homogeneous tiles; the
  seam attribution and the per-campaign bias are the numbers that matter.
  NMD2023 zips are per-entry deflate around stripped PackBits TIFFs, with
  the species layers' directory at the end: ~2 GB per layer to reach Puttom.

## Johannesberg on 1 m terrain — the GDAL-free acquisition, and a datum that is only a datum

`?bana=johannesberg&v2=require` boots the reviewed fixed frontier: 64 one-metre
tiles in one draw, replacing 83.9% of the legacy CORE. The full record is
`docs/courses/johannesberg-source-dossier.md`. What is worth carrying forward:

- **The whole 1 m acquisition runs in plain Node.** This machine has no pixi,
  GDAL, PROJ or PDAL, and it did not need them.
  `packages/course-geo/acquisition/build-terrain-window.mjs` reads the
  Markhöjdmodell window with the COG reader that already serves the ring
  builder — authenticated HTTP range requests, **overview factor 1**, so every
  published sample is a source pixel copied exactly and it cannot disagree with
  a `gdal_translate -projwin`. 2049 × 2049 samples in 1.9 s over 25 requests.
  `discover-ground.mjs` is the same idea for STAC discovery: the search is
  public and takes WGS 84, and the only thing `discover-pilots.mjs` needs PROJ
  for is the AOI bbox, so it projects with the repo's own Krüger series **and
  says so in the evidence**. PROJ stays the authority; no published coordinate
  comes from that file.
- **A window is DERIVED from the played ground, never typed.** The lattice is
  the smallest power-of-two 256 m window holding every played point of BOTH
  courses on the ground with the reviewed 100 m margin, centred on it and
  snapped to the source sample lattice — and the compile driver re-derives it
  from the migration geometry and makes `alignTerrainGridExtent` reproduce it
  before it will compile. If the aligner returns a bigger tile count than you
  expect, it is the lattice PHASE, not the size: the same required bounds span
  nine tiles at one anchor and eight at another.
- **CORE is not the holes.** It is `playB ± 150 m` snapped to 36, and `playB`
  takes `scenery.greens` and `scenery.range` too. At Johannesberg the driving
  range reaches 213 m beyond the last hole, so CORE is 2268 m in z while the
  frontier is 2048 — and covering the range as well would need 128 tiles
  (~8.8 MiB, past the loader's 8 MiB budget) or a re-centring that cuts the
  SOUTHERN holes from 110 m of margin to 36. Play beat the practice ground;
  the range's last 36 m renders from legacy MID, and it is written down.
- **Two DTM vintages met inside the course and left no seam.** The course
  straddles E 680000, where item 662_67 (2021) meets 662_68 (2023, in a
  2021–2025 range). Measured rather than assumed: the across-seam first
  difference is mean 0.075 m against 0.082 and 0.085 for control columns
  either side — *smaller* than the terrain's own roughness. Measure the seam;
  do not reconcile what does not differ.
- **A measured datum offset can be honest and still not mean the surfaces
  agree.** `tools/measure-vertical-datum.mjs` gives Johannesberg 5.6676 m over
  38,543 mown samples — but MAD 1.72 m, seven times Puttom's 0.24. The tell
  that this is NOT misregistration: a ±40 m rigid-shift sweep against four
  bridge variants (derived, mirrored, reversed rotation, none at all) moves the
  spread by under 0.25 m and puts the best shift at the sweep edge. A flat
  objective means the legacy Terrarium field has too little terrain detail to
  register against a laser DTM. So the number is a datum step and is documented
  as one. **Always sweep before believing an offset** — a large MAD is the
  question, not the answer.
- **The frontier learned a second bridge.** `v2-graph-frontier.mjs` was
  identity-only (Ribbingsfors' pack is authored in the grid frame). A legacy
  flat-earth pack needs the convergence rotation — 2.757° here, 48 m at a
  kilometre — so `bridgeMode: 'wgs84-legacy-frame'` builds `legacyGridBridge`,
  bakes only the TRANSLATION into the tiles, hands the rotation to the group
  matrix that `main.js` already applied generically, and gives the CORE cutout
  the INSCRIBED legacy rectangle. The frontier's square-tile assertion now
  derives its side from the reviewed tile count instead of a literal 8.
- **`tools/check-course-v2.mjs` gates every course in the frontier registry**,
  not one course each. It boots each slug twice — flagless must reach the
  reviewed v2 frontier (v2 is the default there, see below), `?v2=0` must stay
  pure GPK1 — and asserts the tile count, the bridge the config declares and
  the exact CORE omission it reviewed, all read from that course's own
  contract. Vegetation is optional and must be absent rather than half-loaded
  where a ground has no LiDAR generation yet.

### v2 is the DEFAULT for every course that has one (2026-09)

A flagless visit now serves the v2 ground on every course with a reviewed
live contract — the eight slugs in `V2_GRAPH_FRONTIER_CONFIGS` plus the
retained Puttom pilot — and stays pure GPK1, zero v2 requests, on every
course without one (`johannesberg-9` today). The decision lives in ONE
place, `selectV2TerrainSource`: an absent `?v2=` resolves to opt-in exactly
when the app could actually RENDER that slug's v2 ground (the frontier
registry, or the pilot), never merely because a graph is published for
resolution. The default behaves like `?v2=1` — a failed source falls back to
GPK1 silently — so a broken v2 ground can never stop a visitor's course from
opening; `?v2=require` still fails closed and `?v2=0` is the explicit
opt-out everywhere (the selection carries `defaulted` so gates can tell the
two apart). What that moved in the harnesses: the runtime no-request proof
(`capture-puttom-app-preview.mjs`) and the per-ground acceptance tools prove
purity on `?v2=0` now, and every gate written against the GPK1 path —
`check-app`, `check-links`, `check-flight`, `check-pwa`, `check-basepath`,
`check-caddie-ui`, `check-strategy-stress`, `goldens`, `boot-profile
--v2 off`, `vegetation-baseline`'s gpk1 mode — pins `&v2=0` so it keeps
measuring what it always measured. Two consequences to remember: any
page-vs-app parity run must pass `?v2=0` to the app (the standalone pages
have no v2), and a poster re-shoot (`make-posters.mjs`, deliberately
unpinned) will now photograph the v2 ground, which is what visitors see.

**And a phone defaults to performance mode.** `LOWQ` is the app's one
performance switch (tree tiers, instance counts, pixel ratio, the lighter
v2 submit path all key off it), and the old memory/core sniff never caught
a flagship phone. `phoneDevice` in main.js now detects the FORM, by
capability and never by user agent: primary pointer coarse with no hover
AND the screen's short side ≤ 768 px (the mobile HUD sheets' own
breakpoint). Precedence, each browser-verified on the built app: an
explicit `?q=` always wins, `det=1` stays device-blind so goldens never
depend on the machine, and desktops are untouched. `V3D.quality()` reports
`phone` beside `lowq` so a harness can tell the sniffs apart.

### Johannesberg's vegetation — and the audit that says a thinner forest is the right one

2,417 LiDAR-measured crowns plus a 64-tile 4 m stand field now replace the
satellite scatter inside the 2 km window; zero legacy trees survive inside the
coverage and every base samples the published terrain to a millimetre. Two
things worth carrying:

- **A canopy build validates the terrain for free.** The point cloud's own
  class-2/9 ground minus the published DTM came out at a median of **0.00 m on
  every one of the 64 tiles** — an independent confirmation, from a different
  sensor pass, that the compiled terrain is where it says it is. Read that line
  in `build-canopy.mjs`'s output before anything else; a non-zero median there
  means the terrain is wrong, not the trees.
- **When measured vegetation thins a forest, prove which source is wrong.**
  Johannesberg's scan is 2021-04-17 **leaf-off**, which under-detects deciduous
  crowns, and canopy fell from the legacy raster's 43.9% to 17.6%. That is
  either a correction or a loss and a render cannot tell you which.
  `tools/audit-canopy-sources.mjs` settles it, and the deciding statistic is
  NOT the fraction: it is the **laser height where the satellite claims canopy
  and the laser does not** — median 0.00 m, p90 0.36 m over 106,626 cells. A
  crown a scan merely thinned still returns branch height; a distribution piled
  at zero is open ground, so the satellite was over-detecting and the old
  render really was standing pines on mown fairway. Meta/WRI CHMv2 (27.9%)
  brackets rather than settles, because it smears crowns outward and reads
  high — calibration, not truth, exactly as the Puttom work found.
- **The CHMv2 tile id is a zoom-10 quadkey**, so it is computed, not looked up:
  the standard slippy-tile quadkey of the ground's lat/lon reproduces Puttom's
  known `1200130303` exactly and gives Johannesberg `1200312031`.
- `run-chmv2-crosscheck.mjs` is still Puttom-shaped: it requires a campaign
  seam in NORTHING. Johannesberg has one campaign and an item seam in EASTING,
  so it throws "the campaign inventory carries no seam northing" — that is the
  tool not applying, not the data being wrong.
- **Two decoding traps cost real time here, both self-inflicted.** The legacy
  `tree-cover.json` is **two bits per cell** (`np.packbits` over `unpackbits
  count=2`, little bitorder), so reading it a byte per cell reports plausible
  nonsense; and its legend is `{0 unknown, 2 open, 3 trees}`, so `value >= 1`
  counts OPEN ground as canopy. The COPC census likewise stores
  `estimatedPoints`, not `points` — probing the wrong field manufactured a
  clean row of zeros that looked exactly like missing LiDAR. Check a decoder
  against a known-good total before believing a surprising zero.

## Upsala GK on the 1 m terrain — the ground that separates a datum from a shape

`docs/courses/upsala-source-dossier.md` is the record; runbook §13 is the
method. Håmö gård now renders from Lantmäteriet's laser DTM everywhere — the
published v2 ring graph, the GPK1 pack and `upsala3d.html` — and getting there
turned up things worth keeping:

- **A vertical datum offset is only a datum if its MAD is small.**
  `tools/measure-vertical-datum.mjs` prints a median AND a median absolute
  deviation. Veckefjärden's 20.9924 m carries 0.2392 m: one number bridges it.
  Upsala's measured 6.7514 m carried **1.9188 m over a 0–15 m range**, because
  Terrarium's SHAPE over this parkland is wrong as well as its datum — applying
  the median would have left the course's ponds between 2.8 m below their own
  bed and 5.3 m above their own surface. So the pack was **re-grounded**: HF0
  and HF1 are cut from the same laser DTM as the published tiles, sampled
  THROUGH the derived bridge the runtime uses. The vertical bridge is then
  exactly 0, and re-running the measurement is the proof — 0.0001 m median,
  0.0239 m MAD, best registration shift (0, 0), where before it ran to the
  sweep's own boundary.
- **A vertical-only rebuild should be provable as one.** Diff the rebuilt model
  field by field and name every changed leaf. Upsala's came to exactly 79: 24
  water levels, 54 hole elevations and the water floor. Nothing horizontal
  moved, so the card, the hole lengths, the markers and the design SVG all
  still mean what they meant — and `check3d`, `check-pack` and `lint-page` pass
  untouched.
- **A water ring measured from the INSIDE is a level and a registration check
  at once.** A laser DTM flattens water, so a well-registered ring encloses
  samples a few centimetres apart. All 21 measurable rings here spread
  0.01–0.45 m, which confirmed the OSM model's registration before anything was
  rebuilt. `build-heightfields.mjs` now fails above 1.5 m.
- **The legacy frame here is the grid rotated 2.1577°** (the convergence 2.5°
  east of the central meridian) **and scaled by 0.99766 / 0.99936.** A
  translation-only bridge is 24.6 m wrong at the far end of the property; the
  best-fit similarity still leaves 0.31 m mean / 0.62 m max, because a
  flat-earth frame is not a similarity of a transverse Mercator one. The
  runtime derives the rotation and both scales from the two frames' own
  constants, so they are exact.
- **This is the first window here that crosses a source seam.** The course
  straddles easting 640000, so the 2,048 m lattice is mosaicked from
  Markhöjdmodell `663_63` and `663_64`. Both are read at factor 1, so the seam
  is one of provenance and not of geometry — and the source manifest carries
  the two items as two SOURCES with two checksums, because a manifest entry has
  room for one.
- **A machine without PROJ can still migrate, if it proves itself first.**
  `packages/course-geo/migrate-without-proj.mjs` re-projects a committed cs2cs
  migration's own source model with the repo's Krüger series and writes nothing
  unless it reproduces it within 5 mm; on Upsala it agreed to 1.343 mm over all
  12,925 coordinates. It exists because the shipped Mellanbanan nine had no
  EPSG:3006 form and the committed one is of the **banguide trace**, which
  disagrees with the shipped GPS routing by up to 164 m on holes 7 and 8 —
  exactly the two that trace had flagged as drawn under canopy.
- **Measure a legacy CORE cutout by making the frontier serve.** The contract is
  only asserted on the frontier-only path, which a ground with a ring graph
  never takes — but the adapter is CONSTRUCTED before that choice, so `null` is
  a boot error, not a no-op. Point the config's `expectedBoundsEpsg5845` at the
  pre-ring generation, put a deliberately wrong contract in, and boot: the
  assertion prints what it actually got.
- **The club's own history corrects this repo.** `card-mellanbanan.json` credits
  Mellanbanan to Peter Nordwall in 2001. That is *Lilla banan*. Mellanbanan is
  **Nils O. Nyberg and Einar Jansson, 1978**; Paulsson designed both the 1938
  nine at Södra Norby and the 1964 eighteen at Håmö, and Bob Kains rebuilt the
  eighteen in 2007–2010. Lilla banan's card (par 31, Röd 1406 / Gul 1633) is in
  the dossier; the course is not modelled and its position on the property has
  not been measured.
- **The LiDAR vegetation is published here too (2026-09-04), through the same
  CI chain — now the `ground-vegetation` workflow.** The Veckefjärden workflow
  was generalized rather than copied: a push touching any
  `geo_data/course-v2/<ground>/vegetation/RUN` derives its ground from the
  path, reads the raster arguments from that ground's own pinned campaign
  inventory, and runs acquire or publish per the RUN file. Upsala's record:
  one campaign (`21c037`, **March 2021 — leaf-off**, the Johannesberg caveat
  applies to this parkland's deciduous crowns) across the two items either
  side of easting 640000, 14.68M points at 2.2–2.4 all returns/m², and the
  cloud's own class-2 ground within **−0.003…+0.023 m median of the published
  DTM on all 72 tiles** — an independent sensor pass confirming the
  re-grounded pack exactly where Terrarium's shape had been wrong by metres.
  24,496 crown candidates → **4,181 machine-reviewed individuals**
  (largest rejections: not-individual 18,391, radius 10,899, confidence
  7,545) + stand fields on all 64 tiles, 58 object tiles; the merged
  two-course exclusions rejected candidates on farmland (175), fairways
  (371), roads/paths (318), water (34), tees (16) and exactly one green.
  Both slugs plant the same generation against one ground manifest — 4,181
  individuals + 20,952 stand trees, the legacy lattice cut from all 64
  tiles, bases p95 0 m — with `speciesSource: 'default'`: Upsala's scenery
  module exports no `species` rule, and the gate asserts exactly that, not
  merely "something planted".
  Its publish is also the one that surfaced the `parentId` strip recorded in
  the Veckefjärden section: the mellanbanan booted to the frontier fallback,
  whose inherited parent-course cutout contract then failed loudly — the
  korthålsbana's disease again, so `UPSALA_MELLANBANAN_V2_CONFIG` now
  carries its own measured cutout (478 × 343 cells at x0 −576, 156,368 of
  163,954 base points omitted), read the runbook way off the assertion's
  own "got" line.

## Ängsö re-grounded on the laser — and what the published graph is good for

`docs/courses/angso-course-atlas.md` is the complete inventory of this course
(every hole, pond, stake, ditch, building and rule, with provenance); its §16
records the 2026-09-05 pass. The lessons that generalise:

- **A machine with no Lantmäteriet credential can still re-ground a pack.**
  The published ring graph IS the laser DTM: the 256 course tiles reproduce
  the acquired 1 m window to a quantum (`terrain-1m.f32` synthesised from
  them re-measures the datum to 0.2 mm of the recorded 9.1166), and the rings
  reach 16 km — further than any page's far ring. `packages/course-v2/
  published-ground-lookup.mjs` answers heights from the finest level under a
  point; `angsobuild/build-heightfields.mjs` cuts HF0/HF1 from it through the
  derived bridge. Datum 9.1166 m / MAD 1.85 → 0.0008 m / MAD 0.022, best
  shift (0, 0), 69 model leaves changed and none horizontal. A pack cut from
  the graph and the streamed ground are then one field BY CONSTRUCTION.
- **A rebuilt pack must be re-bound, and the publisher is not the only way.**
  `rebind-course-fallback.mjs` re-emits the course manifest against the live
  GPK1 entry from the published tiles alone, asserting the ground manifest
  comes out byte-identical; `publish-ground-rings` needs the ring cache,
  which a credential-less machine cannot rebuild. The previous course
  manifest stays on disk as every publish leaves it.
- **Mälaren has no OSM ring where the course meets it, and the one it has is
  not where the notes said.** w307899187 is a NORTH-EASTERN bay clipped at
  the extract edge and drawn through reeds (0.75–2.4 m in the DTM); the
  ground west of the peninsula is 14–35 m high. The lake is read off the
  laser plate instead (`angsobuild/laser-water.mjs`): flat to 0.03 m between
  4 m neighbours, within 0.2 m of the regulated level, and ≥ 100 ha or within
  60 m of such a component — a flight-strip seam splits the plate into
  components 0.1–0.2 m apart, and 18 flat fields at the same height do not
  touch the lake and are refused. **Trace the shore inside a clip that stays
  clear of the carved terrain**: a ring's edge raises a bank in `terrainH`,
  so a clip edge inside the MID mesh draws a ridge across the lake. And
  **sink a bed under the plate in the heightfields**: a sheet at the level
  over a plate at the level flickers, and strips 0.2 m high poke through as
  dry flats. Islands are counted (421 in the far field, none inside HF0) and
  a ring that encloses one is keyholed with a slit kept out of the carved
  box, because a slit inside it reads as a shoreline to `ringSD`.
- **Classify holes by containment, never by winding.** The first tracer
  called the 15 ha island the lake and dropped the lake, because "water on
  the left" flips meaning in a z-south frame. Depth of nesting is
  orientation-free.
- **The wide brown belt at the shore was OSM farmland painted over reeds.**
  The page applies a landuse crop tone AFTER the wetland tint, so a farmland
  ring drawn to the open water paints the vass belt as ploughed soil. The
  reed belt is now traced from the laser (shore ground within 0.9 m of the
  level, ≤ 120 m from open water) into `vegetation.wetland`, and any landuse
  ring with ≥ 3 % of its cells under lake or reeds is re-traced without them.
  Confirm with the imagery before retuning a tint: `tools/sat-mosaic.mjs`
  runs on Linux now (`BANVY_CHROME`), and the z18 tiles showed the belt.
- **The laser sees the ditches the imagery cannot.** A brook under alders is
  an incised channel in bare-earth data: the minimum of height-minus-15 m-mean
  across ±8 m sections every 2 m along waypoints picked off a residual map,
  kept where the residual is below −0.2 m for ≥ 20 m. That rule is also what
  makes culverts honest — the 8th's dike vanishes for 50 m under its fairway
  and again under the 7th's approach, the 12th's brook under the 12th — and
  it told a dry dike beside the 10th from a brook (the club: the one hole
  with no water nearby). Ten lines, 1,611 m, all three watercourses the club
  documents and the model lacked. The engine draws a `stream` as a carved wet
  cut with no water ribbon; that is the next engine item, not a data one.
- **Marking from a rulebook is a stated rule, not a survey.** Lokala regler
  gives sides and colours; `build-marking.mjs` places red round each pond
  and along the 17th's left, white at the WOODLAND EDGE (walk out from the
  fairway edge until the tree-cover raster reads canopy — a fence returns
  nothing to a laser) where OB or the boar fence is named, never inside 12 m
  of the centreline; each run is checked to lie on the player's side at three
  stations. The pages and `emit-pack` dropped `marking` for every newer-schema
  build; both carry it now.
- **The migration's reference must be the model cs2cs read.** After a
  re-ground the current model no longer matches the committed migration's
  coordinate count; `migrate-without-proj --reference-source` takes the
  historical text (`git show <sha>:path`), admitted only if it hashes to what
  the reference recorded. The cs2cs file is kept beside the Krüger one.
- **Hole 14's trace note said "dogleg right"; its own line turns −71°.** The
  chord-side inversion again — corrected in `sat-shapes.json`.
- **The 5th's "little red house" is findable**: of every building within 12°
  of the last leg, one stands on the axis (OSM 215457959, 792 m, across the
  bay); the 18th's juniper is the one lone dark tree on the fairway's right
  edge in the z18 tiles at (−253, 109); Ängsö slott's terrain line of sight
  from the clubhouse is clear over the lake. All three are in
  `scenery/angso.js` with their basis; the campsite piers got boats for free
  the moment there was water under them.
## Ribbingsfors — `ribbingsforsbuild/` (no standalone page; app-only)

Ribbingsfors Golf & Kultur: 9 holes, par 36 (played twice for 18/72), a park
and pasture course in the Ribbingsfors manor environment beside Lake Skagern,
Gullspång. The first course authored DIRECTLY in the grid frame — local metres
ARE EPSG:3006 minus the origin E448975.5 N6536024.5, so there is no
convergence rotation and no flat-earth scale error anywhere in this build (and
`tools/sat-mosaic.mjs` therefore cannot serve it; `ribbingsforsbuild/sat-crop.mjs`
is its exact-per-point replacement). Everything about sources and rights is in
[`docs/courses/ribbingsfors-source-dossier.md`](docs/courses/ribbingsfors-source-dossier.md)
— read §3 before touching the card (the per-hole rows are PROVISIONAL, only
the three nine-hole tee totals are official) and §15 for the surroundings
survey. The v2 1 m ground is published and default; `tools/check-ribbingsfors-v2.mjs`
is its browser gate.

### Where the geometry comes from

| source | used for |
|---|---|
| official club totals (Vit 3110 / Gul 2966 / Röd 2525) | the card gate; per-hole rows are secondary and marked so |
| Lantmäteriet Markhöjdmodell 1 m item 653_44 | the ground (HF0/HF1) and the twelve break-geometry water polygons WITH per-ring levels |
| Laserdata skog 2023 CHM | the 4 m tree-cover raster (3 m canopy threshold) |
| GolfTraxx seeds (yards mislabelled as metres — measured, ratio 0.9144) | provisional routing only, card-length-extended back tees |
| OSM wide extract + Esri z17/z18 traces + Länsstyrelsen protected trees (CC0) | the whole surroundings model below |

### The pipeline

    node ribbingsforsbuild/build-course.mjs        # needs pixi/GDAL + acquisition caches
    node ribbingsforsbuild/fetch-osm-wide.mjs      # wide surroundings extract (no GDAL from here on)
    node ribbingsforsbuild/parse-osm-wide.mjs      # -> osm-surroundings.json
    node ribbingsforsbuild/detect-sand.mjs         # measure bunkers from z18 sand pixels -> cache/sand-candidates.json + review crops
    node ribbingsforsbuild/apply-sat-shapes.mjs    # accepted bunkers (sat-shapes.json) replace the guide-formula set
    node ribbingsforsbuild/apply-surroundings.mjs  # merge + gates; IDEMPOTENT, run after every build-course
    node packages/course-pack/emit-pack.mjs ribbingsforsbuild apps/golf/public/courses/ribbingsfors ribbingsfors
    node packages/course-pack/emit-manifest.mjs
    node packages/course-v2/refresh-fallback-v1.mjs ribbingsfors   # or the v2 graph fails closed
    node packages/course-geo/migrate-legacy.mjs --write --ground ribbingsfors
    node ribbingsforsbuild/sat-crop.mjs <name> <cx> <cz> <size> [z] [--plain]  # tracing/verification crops

**A pack re-emit is not done until `refresh-fallback-v1` has run** — the v2
root index and course manifest pin the exact GPK1 bytes, and the runtime
refuses v2 selection on a mismatch, silently downgrading every flagless visit.
The migration model and the source manifest's artifact checksums must move in
the same commit (`pnpm test` fails loudly on both, and
`hole-source-controls.mjs` pins the EPSG:3006 model hash a third time).

### Ground truth the surroundings model encodes

- **Skagern's level is 69.3 m RH 2000; OSM's `ele=66.9` is wrong** (the vista
  DTM reads a laser-flat 69.35 over the open basin). The big lake ring is OSM
  shoreline closed offshore, gated by DTM sampling (99.0% of interior samples
  laser-flat; a measured diagonal cut keeps a far corner of 70–73 m land
  out). North of the Skagersvik strait the water at ~67.5 m is
  Gullspångsälven BELOW the lake's outlet — never let the ring swallow it.
- **The ditches are one system**: eastern boundary ditch → hole-2 pond
  (77.7 m) → road culvert → the two crossings at green 1 → hole-9 pond
  (72.0 m) → lake. The four synthetic guide-crossing streams are replaced by
  these traces; the gradient is the check.
- **The range the guide interpretation placed was in the lake.** The real one
  sits between holes 9 and 1 with its bays at the south end and a mature oak
  in the field. Satellite traces carry per-feature confidence in
  `surroundings-traces.json`; the ±8 m reading error is stated there.
- **The played surfaces are survey-anchored, not to be hand-retraced (§16).**
  The nine green centres ARE the GolfTraxx *Green Center* survey points to
  0.0 m — only the route lengths carried the yards bug, not the green points —
  and they land on the real greens in z18 imagery. **The bunkers are MEASURED
  (§17)**: `detect-sand.mjs` classifies sand per pixel (calibrated with
  `--find` on 19 known bunkers — sand is rgb ~183–214/170–193/136–161, and the
  dry-grass confuser fails on G−R > −6) and places 18 accepted bunkers at their
  pixel centroids; five guide-listed bunkers resolved to plain grass and were
  DROPPED, not guessed (listed in sat-shapes.json). Eyeballed coordinates were
  7–20 m off the measured centroids — never hand-place a bunker here. This is a leaf-off
  park-and-pasture course where greens/bunkers barely out-contrast grass, so an
  eyeball retrace at ±4 m would degrade survey-good geometry. Green OUTLINES
  stay synthetic ellipses; their POSITIONS are survey-grade. Real surface
  precision needs the ortho (now open CC-BY), the DTM-bench tee method extended
  to all 27 tees, or club data — never a lower-confidence trace. `sat-crop.mjs`
  grew a 50 m grid and green/tee/bunker overlays for that future comparison.
- **86 of 88 protected trees (the "Ribbingsfors ekhage" oaks, CC0) are
  laser-confirmed** and drawn as individual crowns sized from circumference.
  The confirmation is FROZEN in apply-surroundings.mjs: re-measuring against
  the re-burned raster flips the oak standing in the parking lot.
- **Skagersvik has almost no OSM buildings**, so 482 street-aligned houses
  are synthesized inside its residential rings (the Ås precedent). The reedy
  bays' wetland rings double as `surround.shallows`. Two low islets inside
  water rings are documented as drowned (the engine's carve floors a ring's
  interior; the Noret islet crests 0.66 m above the lake).

### Traps

- **A lazy regex over OSM XML attributes self-closing nodes' tags to the
  wrong node.** `<node .../>` followed by `([\s\S]*?)<\/node>` swallows the
  NEXT tagged node — this misattributed "peak Sörhult" to a node 3 km away
  during the first inventory scan and cost an hour of sign-error chasing.
  parse-osm-wide.mjs's alternation `(\/>|>...<\/node>)` is the correct form;
  the projection was never wrong.
- **Clip, don't just filter.** A kept-whole way reached ±39 km (power line)
  and the Skagern shoreline ran 9 km past the vista; everything in
  osm-surroundings.json is clipped to the 4.6 km keep box.
- The break-geometry water stops at the ITEM edge (E450000 = local x 1025);
  the straight chord an overlay shows there is two same-level rings meeting,
  not a defect.
