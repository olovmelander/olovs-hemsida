# The map mode

Every course as a light 3D map for a real round on a phone, beside the detailed
course. `?bana=<slug>&karta=1`, optionally `&hal=<n>` and `&vy=bana`.

**Phones open it by default** (owner request, 4 November). A plain course link, with
only `bana` and perhaps `hal`, opens the map on a phone, by the player's own test for
one: a touch-first screen with a short side of 768 px or less. Tablets, computers
and any link that says more (a shared view, a harness's `det=1`, a bookmark with its
camera) open the detailed course. `karta=1` is the map on any device and `karta=0`
the detailed course on a phone, and `karta=0` stays when a phone changes course
there. See `shell/map-default.mjs`. A course card's pill and Meny's "Detaljerad 3D"
offer the other mode, and the player's menu links to the map.

The strip under the map is the whole hole, tee to green along its line. The player
stands on it in blue, once within 150 m of the line. They walk along it at first, then
hold a fifth of the way across (`stripX`): what is behind them closes up to the left
and dims, and what is ahead spreads out to fill the rest, on a height scale of its own.
So a player can always see where they are, and the shot in hand is always the largest
thing on the strip; on a plain whole-hole strip the last 60 m of a 400 m hole, the
approach, would be a sliver at the edge. A measured point stands on it in yellow. Its
words give the climb from where the ball is, straight to the green, as the numbers do.

## The screen

What a player reaches for during a round is one thumb away; what is set once lives in
Meny (owner request, 4 November). This was drawn from the three apps the owner named:
front, middle and back numbers, a keypad around par and shot measuring are common to
them; swiping between holes is Caddee's on the watch, and the fairway and green figures
are Golf i Sverige's and GameBook's. What they do not have, as far as their listings
say, is the green in 3D with its fall drawn on it.

- **Always on screen:** the hole in the header, the three distances, the wind, the
  height strip, and the buttons GPS, Hålet, Score and Meny. Score shows how the round
  stands (`Score +2`).
- **Header.** ‹ and › or a sideways swipe change hole. A tap opens Hålet.
- **Hålet:** the hole's tip, the hazards ahead in words with their side, reach and
  carry, and every hole a tap away.
- **The distances are a button.** A tap opens the green close to, along the line it is
  played, under the simulator's own Greengrid (owner request, 4 November): the 1 m
  wireframe in its heat colours, pulses gliding down the fall line in contour-tier
  ripples, and rings round the pin, with the mean and steepest slope in the header and
  the colours where the strip was. `map-greengrid.mjs` holds main.js's numbers, and
  `map.test.mjs` compares them with main.js's text. On Veckefjärden's 3rd both read a
  mean of 6.1% (steepest 11.7% here, 13.0% there). Three things differ: the lines are cut
  in a shader, a pixel or so wide; a shade lies under them, since the map's greens are
  painted paler than the simulator's lit turf; and a pulse is never under 2.6 CSS px wide, since the
  simulator's are under a pixel from here. The pulses run at about 30 frames a second
  for a minute after the last touch, then hold; reduced motion holds them still. It is
  the only part of the map that draws on its own. It reads the ground, not today's
  speed or pin.
- **Back to the shot:** the round button appears as soon as the view has left it, and
  returns to the player or the hole. Without it a panned map had no way back.
- **Measuring.** A tap sets the point, a drag on it moves it, its × clears it.
- **Mät slag**, with a player on the course: a tap at the ball, and the distance counts
  up on the walk until the next tap.
- **Score** is a row of keys around par, a row of putts and, on a par 4 or 5, the
  fairway. Green in regulation follows from the strokes and putts. When a player moves
  on to the next hole mid-round with none entered, the map asks for the one left behind
  above the strip, in one tap, and lets it go after 40 s.
- **Meny** holds Ljus (and Nu in its picker), the tee, the height, the layers, saving
  the course, the detailed 3D and all courses.
- **A lost tab** comes back to the same hole, with the GPS on if it was and the
  permission stands, for six hours.
- Sheets rest above the buttons, so the map stays in view, and go when pulled down.

The map is a separate program: `apps/golf/src/map`, about 180 KB of script, with no
three.js and nothing from `main.js`. It draws one frame when something changes and
then stops, so an idle map costs nothing.

## The same world

The map copies no course data and has no bake of its own for terrain.

| What | Where it comes from |
| --- | --- |
| Heights | The published v2 terrain tiles, down to the 1 m core, verified by the same code as the player |
| Holes, greens, tees, fairways, bunkers, surveyed water | The GPK1 pack |
| Water past the outlines, and forest | One small picture per ground, baked by `tools/bake-map-land.mjs` |
| Everything else on the ground | The pack and, where a course has one, its surroundings record |
| Where each tree stands, its size and species | `planV2Vegetation`, on the same stand and object tiles, with main.js's rules |
| How each tree looks | The player's own impostors, baked by `tools/bake-map-trees.mjs` |
| Forest away from the camera | Canopy stamped from those impostors, masked by the stands (1 m tiles) or the ground's forest picture (coarser) |
| Colours | Read off the simulator's summer light |

A republished course reaches the map by itself, but for two things. A changed tree
catalogue needs **`tools/bake-map-trees.mjs`**, on the owner's GPU against a dev
server. Republished terrain or stands need **`tools/bake-map-land.mjs`**, which needs
no GPU; `map.test.mjs` fails until it has run.

## What is on the map

The owner's rule (4 November): nothing that is supposed to be there may be left out. An
audit of every pack against the painter found the map was missing a great deal, and two
things were wrong, so `map-course.mjs` now carries all of this:

- **Water.** Pack outlines stop at their extract's box, so the sea at Norrfällsviken and
  Visby ended in straight lines with land behind them, and lakes further out were not
  there. `bake-map-land.mjs` runs the simulator's own detector (`engine/v2-flat-water.mjs`,
  water is level to 5 cm, land is not) over each ground's 8 m ring, and closes the seams
  an old shoreline leaves in the laser's sea. The record's WATER class is never used: it
  is a colour verdict on imagery.
- **Land drawn as sea.** Norrfällsviken's sea ring closes across the land south of the
  course, 428 ha of forest up to 40 m high. The rule is main.js's: wet is inside a ring
  and at its level. The bake finds any outline with over 4% of its area above its water
  (that one, of every ring on every layout), lists it in the record's `dry`, and the
  picture takes its place. `hazardsAhead` keeps the ring: the coast it traces is true,
  and no hole's line reaches the part that is not.
- **Forest.** The laser's stands cover the 1 m core and stop. Inside it the forest picture
  is the laser's canopy at every zoom, so a wood no longer changes as a tile refines.
  Outside it is the land cover, which imagery can get badly wrong: at Norrfällsviken a
  whole rectangle of forest is classed as water. Water or unknown cells the ground does
  not bear out take main.js's land rule, forest unless mapped as open. Cells the laser
  did not measure on a 1 m tile take the land cover: 0.8% of Visby's played tiles were
  forest, most of the rest is water. They get a painted canopy, not 3D trees: the
  simulator plants none there either.
- **The surroundings record** (Veckefjärden and its korthålsbana): 7,690 houses, roads,
  railways, lakes, the harbour, pitches, ski slopes and lifts.
- **The rest:** far buildings, railways, power lines and masts, piers, basins, bridges,
  ditches, fences and hedges, hayfields, yards, clear-fells, a lake's silt margin (inside
  it only), pitches, the range's mats, nets and targets, the cart park, practice greens
  and bunkers, terraces, roofs, and two more kinds of land use. Penalty and out-of-bounds
  stakes stand where the simulator stands them; Lidingö's reviewed OB lines are dashed.

Left out on purpose: nature reserves, which are lines on a register and not on the
ground; the 456 mapped trees at Uppsala, whose stands the laser already has; and small
street furniture. `stroke(holes, rough)` still lays rough over a mapped field where a
hole is played: that is the course, not a loss. `?land=0` is the before for the water and
forest pictures.

The pictures add about 150-230 KB a ground and 16 MB each of decoded memory on the phone.

Keep out of `apps/golf/src/engine`, `loader` and `packages/course-v2`: those are what
`courseSourceRevision` hashes, so an edit there turns the player's prepared startup
data off until the next bake. Importing from them is fine, except `engine/scenery/*`,
which pull in three.js. The three species rules the map needs are copied into
`map-trees.mjs`, and `map.test.mjs` compares them with the originals. The frames in
`map-frames.mjs` are a copy on the same terms.

## How it stays light

- **Every 1 m sample reaches the screen through the pixel, not the mesh.** Each tile
  bakes its slope and local relief into one texture, and heights are read per pixel
  for the contours. The mesh only carries the silhouette, at most every 2 m, so a
  hole is about 150,000 triangles and an overview 33,000.
- **A view reads only what it can show.** Tiles are chosen by how large a sample
  lands on screen. An overview uses no 1 m tiles; a hole uses the 5-10 under it.
  A missing child is drawn as its parent's quadrant, so the ground never opens.
- **A tree is two triangles.** The 3 or 5 species' atlases are about 175 KB each.
- **A slow device steps itself down** (`QUALITY_STEPS`): far trees first, then
  sharpness. The step is remembered. `?mapquality=0..3` pins one. Proven on slowed
  frames on this GPU, where it fell through all three steps.

## Light and surfaces

- One sun at a time, so shadows fall one way. A weaker fill turns with the map, from
  the top left of the screen, so slopes read from any direction.
- Tree and building shadows are their pictures laid along the sun's rays. Stencil
  lets a pixel darken once, so a wood's shadows join instead of stacking up.
- Level ground keeps its painted colour exactly; light only departs from it.
- A small mask says what each surface is, for its own finish: red water, green mown
  turf, blue sand and white forest. Forest is the three at once because a filtered
  blend of two pure colours still splits back into its two classes.
- Water's depth comes from a wide mip of that mask: shallows by the shore, deep beyond.
- Mowing stripes are concentric strokes about the hole's line, so they bend with it.
- Fairway outlines are softened for drawing only. No distance reads a painted edge.

## On the course

- **Hazard distances** (`hazardsAhead`): the five nearest ahead of the ball, on the map
  where they are, as reach and carry. Bunkers side by side count as one, and only those
  within 45 m of the hole's line. Water the line crosses has a carry; water beside it
  only a reach, and none at all within 30 m of the player. Meny turns them off.
- **Wind** is the player's own reading (`engine/weather.js`): an arrow that turns with
  the map, and the plays-like numbers take the head wind and the temperature, as the
  simulator's Kikaren does. A reading over three hours old is not used.
- **The scorecard** (`map-score.mjs`, the Score button) keeps strokes, putts and the
  fairway per hole on the phone, per course, until "Ny runda". With a playing handicap it adds up
  Stableford, strokes falling by the holes' indexes. A card without indexes, as the
  korthålsbana's, has no points. It is a personal card, not a registered round: that
  stays with Min Golf. One player for now.

## The lights

`map-light.mjs` builds the map's lights from the simulator's nine presets, so their
sun, sky, haze, water and clouds are its own and follow any change to them. Only each
light's share of direct sun and its exposure are set there, because the map's lighting
is a simpler sum. Sommar is the neutral: its ground colours are the painted ones
exactly, every other light is measured against it, and only part of a light's colour
reaches the ground, or a low sun turns the grass to olive. Höst turns the broadleaves
by the simulator's `AUTUMN_FOLIAGE` ramps and the forest in stands.

Every light is a set of shader values, so switching is instant and draws one frame.
Tree shadows are cast from no lower than about 20°: the ground under them is taken as
level, and a longer shadow would lie across hills it cannot follow.

**Hills throw shadows** when the sun stands under about 30° (`map-horizon.mjs`). Each
tile keeps a 33 x 33 picture of what stands between it and the sun, walked out through
the height data and reckoned once for each sun, one or two tiles a frame. A high sun
pays nothing, and neither does a still map. Swedish courses are too gentle to throw much
under a true evening sun (about 1% of the picture on three courses), so these shadows
are cast at `SHADOW_REACH` times the relief, which took that to 12-45%. No sun casts
them lower than an evening's, or a dawn drowns the course. `?hillshade=0` is the before.

**Vinter** is the map's own tenth light: the simulator has no winter. Snow settles over
everything, leaving the course just visible under it, broadleaves go bare to a trunk
and a scatter of twigs, conifers carry snow on what faces the sky, and lakes freeze
(the sea does not: `frozenWater`). In Nu the season follows the date: bare from
November to May, snow from about December to March, longer the further north. That is
what the season usually is, not today's weather.

**Nu** is the real sun over the course: NOAA's solar equations, held to the almanac in
`map-light.test.mjs`. Its height chooses the sky between the named lights and the date
chooses the season. It refreshes once a minute, and only draws if the sun has moved.
`?ljus=<key>` and `?nu=1` open a light; `V3DMap.setClock(date)` stands at any moment.

## What a golfer can trust

Distances are horizontal, measured in the map's world (EPSG:3006 metres) from the
played tee's own position, or the player. Three limits are the data's:

- **No course has been checked on the ground.** Every hole's `accuracyTier` is
  `unrated` or `D`. Placement is proven against the laser survey: every layout's
  greens land on nearly level ground, and dropping the frame's rotation makes that
  worse (`map-frames.test.mjs`). That is not the same as standing on a green.
- **Distances go to the green, not the flag.** Nothing knows today's pin.
- **The korthålsbana's greens are placeholders:** all nine share one 26 m shape. The
  map detects a layout like this (`greensAreGeneric`), marks its front and back
  numbers with ≈ and says so. A second layout like it fails `map-frames.test.mjs`.

## Offline

"Spara" keeps a course's tiles and its tree, water and forest pictures in the map's own cache,
`banvy-map-offline-v1`. Not the shared `banvy-v2-graph`: that holds 256 entries, and
the player's streaming could push a saved course out mid-round.

## Checks

```sh
pnpm exec vitest run apps/golf/src/map
node packages/course-v2/check-app-build.mjs
node tools/serve.mjs apps/golf/dist 8620
BANVY_GPU=1 node tools/check-map-field.mjs --url http://localhost:8620/ --slug visby
BANVY_GPU=1 node tools/map-gallery.mjs --label a --url http://localhost:8620/
BANVY_GPU=1 node tools/map-timing.mjs --url http://localhost:8620/
```

`check-map-field` walks a hole on fake GPS, measures, drags the point, opens every sheet,
pans away and back, reads a green, enters a score, changes hole, loses the graphics
context and reopens with no signal. It found the worst bug so far: tapping the next
hole with GPS on, from close in, left every point behind the camera and blanked the
map. Run it on more than one course: it took Visby's holes to show that.

The timing tool is the phone proxy of `docs/load-times-2026-11-04.md` (4x CPU, 20 Mbps,
80 ms) on this GPU. On Veckefjärden, 4 November, with the land pictures and the
surroundings record in: first picture 3.8 s cold and 2.9 s on reopen with nothing
downloaded, all 1 m ground at 5.4 s and 4.3 s, against 40 s and 8 s for the player. That
is over a second more than before them, and which part costs what has not been split
out. It says nothing of a phone's graphics.

On a real phone the owner reports it "very snappy" (4 November, model not recorded).
That is the only evidence so far: frame rate and battery use are unmeasured.
