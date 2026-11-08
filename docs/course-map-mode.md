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
  club wheel, the height strip, the views, and the buttons GPS, Hålet, Score and Meny.
  Score shows how the round stands (`Score +2`). Yellow is what is chosen, green what is
  on or locked. On the green the strip goes and the numbers say "På green".
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
- **Min vy** (owner request, 5 November): the first person view. The camera stands 1.8 m
  above the ground at the player, or the tee, facing the green, with a 52° lens. The
  relief is drawn at its true height here, whatever Höjdskala says, since a gentle rise
  raised twice is a wall. The carry arcs and contours go, since they heap up on the horizon,
  and the air starts 700 m out. One finger turns the head, two zoom, as binoculars do, and
  a tap still measures. The round button faces the green again.
- **Quick views** (owner request, 5 November): Hela hålet, Bakom, Ovanifrån and Green,
  in a row with Banan, above the buttons where the thumb already is. The first three frame the same thing, from the ball or the tee to the
  green with play up the screen, at three leans: the map, the golfer's eye and straight
  down. They keep following the player, the choice is remembered, and a tap brings back
  a view a finger has moved. One and two fingers work as before.
- **Measuring.** A tap sets the point, a drag on it moves it, its × clears it.
- **The club wheel** stands under the numbers, always: see [the club wheel](club-wheel.md).
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
| Each lake out to its own shore | The simulator's reach, read once per ground by the same bake |
| Everything else on the ground | The pack and, where a course has one, its surroundings record |
| Where each tree stands, its size and species | `planV2Vegetation`, on the same stand and object tiles, with main.js's rules |
| How each tree looks | The player's own impostors, baked by `tools/bake-map-trees.mjs` |
| Forest away from the camera | Canopy stamped from those impostors, masked by the stands (1 m tiles) or the ground's forest picture (coarser) |
| Colours | Read off the simulator's summer light |

A tile that fails is asked for again after 15 s, since signal comes and goes on a golf
course. A republished course reaches the map by itself, but for a few things. A changed tree
catalogue needs **`tools/bake-map-trees.mjs`**, on the owner's GPU against a dev
server. Republished terrain or stands need **`tools/bake-map-land.mjs`**, which needs
no GPU; `map.test.mjs` fails until it has run. So does a republished pack, or any change to the
simulator's reach (`engine/water-reach.mjs`, `engine/water-plate-level.mjs`):
`map-shores.test.mjs` compares the record with all three.

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
- **Lakes to their shores** (7 November, owner request: no straight, sharp lines on the
  water). A traced lake is a sketch inside the real shore: Puttom's outlines run 30-90 m
  between points, and the laser's ground stays flat at the lake's level 2-10 m past them.
  The simulator draws each lake out to where its ground rises above it
  (`engine/water-reach.mjs`), and the map paints the same reach: the same lakes (not the
  sea, a reviewed pond's exact shore or a measured-only ground), the same re-measured level
  (Puttom's laser plates), the same lattice, on the 1 m tiles. A lake's whole shore is more
  ground than a view streams, 0.5-4 MB of 2 m tiles a course beyond the holes' own, so
  `bake-map-land.mjs` reads it once per ground (`tools/map-shores-bake.mjs`): a sheet of
  each lake's wet ground and the dry bank beside it, about 3-20 KB a ground. The map paints
  the wet ground as water under the course's surfaces, softened as the ground's other water
  is, and takes that 8 m picture's water off the bank, where its filtering reached a few
  metres up the slope. A lake drawn to its shore loses the pale rim its outline had, which
  lay on the bank in the outline's straight lines. The outline stays every other reader's
  water: hazards, carries and the frozen lake. `?waterreach=0` is the before. Where the
  simulator's flat-water sheet already draws a cut lake running on, the map's reach floods
  it too, since the map has no terrain to hide the 8 m picture's edge.
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
forest pictures, `?waterreach=0` for the lakes' shores.

The pictures add about 150-230 KB a ground and 16 MB each of decoded memory on the phone.
The shores' sheet adds 3-20 KB and at most 7.4 MB decoded (Veckefjärden's, 1024 x 1804).

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
- **The forest loads apart from the ground** (owner request, 5 November: trees went
  missing round a hole when zooming out). The stands and objects of a 1 m tile are about
  7 KB against its ground's 50, so a wide view fetches only those for tiles the 1 m ground
  has not reached, plants them on the coarser ground in memory, and keeps them for the
  visit (`store.forest`). Tiles outside a saved course's holes are not saved, so offline a
  wood there stays painted.
- **Trees stand about as far as the air lets the ground be seen** (owner request,
  8 November: the woods ended a kilometre or two out). That is twelve times the camera's
  distance, at most 12 km, and 9 km from Min vy; they thin evenly when the budget of
  40,000 runs short (`shareTrees`). Past the reach the painted canopy takes over.
  `?treereach=before` is the old 2.4 times, 6 km and 3 km with the old budgets, and no
  far wood.
- **The far wood** (`map-far-forest.mjs`). The 1 m tiles' stands stop at a 4 km square
  (2 km at Lidingö), and the ground runs to 16 km. Past them the map plants the ground's
  own forest picture, as the simulator dresses its far ring
  (`engine/far-ring-calibration.mjs`): one tree a 10 m cell for 1,800 m, then one a 15 m
  cell, each a tree of the measured population on the 1 m tiles (its species, height and
  crown), grown to cover the stems it stands for (at most 2.2 times, never above the
  tallest measured tree). None stands on a far house, road or railway. Cells of 512 m are
  culled with the view, planted on the main thread for at most 3 ms a frame (a cell takes
  about 0.5 ms here, 2-4 ms with the CPU slowed four times), planted again when finer
  ground arrives under them, and given back farthest first past 300,000 trees. The
  picture is read as the bake packs it (palette, two bits, no row filters), inflated off
  the main thread; a picture written otherwise leaves the canopy painted.
  `?farforest=0` is the before.
- **A tree is two triangles.** The 3 or 5 species' atlases are about 175 KB each.
- **A slow device steps itself down** (`QUALITY_STEPS`): far trees first, then
  sharpness. Each step draws fewer trees and stands them less far (40,000 at full reach,
  then 20,000 at 60%, 6,000 at 40% and 3,000 at 25%). The step is remembered.
  `?mapquality=0..3` pins one. Proven on slowed frames on this GPU, where it fell
  through all three steps.

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

- **The hole follows the player** (`map-follow.mjs`, owner request, 5 November): it
  changes when the player stands on the next tee in order of play, within 14 m of any
  colour's tee for 20 s. Those 20 s are what tell standing from walking through.
  `map.test.mjs` stands on every tee of every next hole on all 13 layouts. Nothing else
  moves it, which ended the nearest line's jumps to a neighbouring fairway. It waits for a
  fix better than ±20 m, while the green being played is nearer than the tee (some tees
  touch the last green), and until the player has been off the tee of the hole being
  played (some holes share one: Lidingö's 2nd and 4th, 15th and 17th). A tee stood on while
  a sheet or the green is open is kept and taken when that closes.

  Three things keep one missed tee from leaving the map behind for the round: the tee
  after next counts too; the first good fix of a session finds the hole by the nearest
  line, so a map opened mid-round lands on it; and so does the first good fix after a gap
  of over a minute, which is a locked phone, but only up to four holes forward and never
  over a hole chosen by hand. The first tee counts from any hole until the first change,
  so a round can start from where the map happened to be.

  A hole chosen by hand stays chosen until the player has left that tee, and the tee after
  the hole on screen counts as well as the ones after the hole last played, so a player
  can look ahead or skip a hole. The tee played is never detected: it is the player's own
  choice in Meny. A hole is asked for its score when the tee is reached, not on a tap of ›
  with the GPS on, which only looks ahead.
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

**Vinter** is the map's own tenth light, kept as it was when the simulator took a winter of its own
([the winter and Nu](visual-winter-2026-11-06.md)). Snow settles over
everything, leaving the course just visible under it, broadleaves go bare to a trunk
and a scatter of twigs, conifers carry snow on what faces the sky, and lakes freeze
(the sea does not: `frozenWater`). In Nu the season follows the date: bare from
November to May, snow from about December to March, longer the further north. That is
what the season usually is, not today's weather.

**Nu** is the real sun over the course: NOAA's solar equations, held to the almanac in
`map-light.test.mjs`. Its height chooses the sky between the named lights and the date
chooses the season. It refreshes once a minute, and only draws if the sun has moved.
`?ljus=<key>` and `?nu=1` open a light; `V3DMap.setClock(date)` stands at any moment.

## A round from start to end

Owner request, 5 November: the map should carry a round from the first tap to the last.

- **Start.** A plain link on a phone opens the start card: the course, its length from the
  tee, Tee, Spelhandicap and Starta rundan, all filled in from last time, so a returning
  player needs one tap. That tap also starts the GPS, which is what lets the phone ask for
  the position. Tee colour stays the player's own choice. Bara titta leaves the map open
  and is not asked again for six hours. A link with `hal`, a round under way or a GPS
  resuming skips the card.
- **Finding the course.** On a phone the chooser has a pin in its search field. It sorts the
  courses by distance and leads with the nearest, and does so by itself where the position
  is already allowed. The places live in `shell/course-places.mjs`, apart from Leaflet.
- **End.** The summary opens when the last score goes in, off the last green with up to three
  holes blank, or from Avsluta rundan on the card. A round begun on the 10th is not over on
  the 18th. Nine holes done on an 18-hole course offer Avsluta beside the score. The summary
  holds the score, putts, fairways, GIR, the card, the best hole, the longest shot, the
  day's clubs and every hole shot by shot, and it can be shared as text. A hole on it can
  still be put right.
  The GPS and the awake screen stop with the round. A lock within 30 minutes plays on, and
  a later one starts the next round, so two rounds of a day never run together.
- **Kept.** `map-rounds.mjs` copies each round to `banvy-map-rounds-v1`, with every hole's
  par, so an old round reads without its course. A round left to expire is kept too. The
  shots stay in the shot log under the same round id. An old round can be taken out with two
  taps, and its shots go with it, or a club's lengths would still count them.

## Over time

- **Mina rundor** sets the last five rounds against the ones before, draws the score
  against par per 18 holes, so a nine sits beside a full round, and lists every round.
- **Mina klubbor** draws each club's spread on one axis for the whole bag: the bar is where
  its earnest shots end up, without the one in ten that flew furthest, and the tick is its
  typical length. The words beside it say the same.
- **Så brukar du spela hålet** in Hålet appears from two rounds: average, best, usual tee
  club and length, fairway and usual miss, putts and penalties.

## For the sun, the hand and the eyes

Meny → Visning. Each choice is kept, and until one is made the phone's settings decide.

- **Solläge** is black on white. A dark panel in direct sun only mirrors the sky, and white
  is what a phone can make brightest. Numbers grow, the column widens, map lines and labels
  are drawn 1.3 times as heavy, and the ground takes a little more contrast. Every colour in
  `course-map.css` is a token, so both looks share one set of rules.
  `prefers-contrast: more` turns it on by default.
- **Större text** enlarges sheets, prompts and notes by 18%. A large iOS text size turns it
  on by default, read through the `-apple-system-body` font keyword.
- **Hjulet till vänster** moves the column, and the framing leaves its room on that side.
- **Screen readers.** The distances and wind are read in words, the wheel is one bag and not
  three copies, a hidden button stands in for the hold, sheets are dialogs that take the
  focus and give it back, and the card marks a birdie with a ring and a bogey with a box, as
  a paper card does, so colour never says it alone.
- Nothing a finger must hit on a sheet is under 44 px.

## The HUD on every phone

A phone's height says little. A notch and a home bar take over 90 px from a screen that
looks tall, and the first measurement found the flag under the header and the wheel in the
height strip on a 390 x 844 iPhone, the most common size there is. So nothing assumes a
height any more (`fitLayout` in `map-session.js`, on every resize and display change):

- The column is measured against what is left above the strip, and gives way a step at a
  time: five wheel rows, three, a tighter column with the walking length beside the wheel,
  and last the height strip, as on a phone on its side.
- Where a note would still reach the column, the note and the distance reading stand beside
  it, since the wheel is in use just then, and the way-back button moves to the free corner.
  A question (score, putts, same spot) keeps the full width and lies over the wheel: it is
  answered first, and its keys need the room. The way-back button waits until it has been.
- The framing reads the header and foot off the screen, with room for the strip and one note
  under the shot in hand, so a passing note never lies on the player's own dot.

`tools/check-map-hud.mjs` drives every state on ten screens, with and without a notch, in
each display setting. Run it after any change to the HUD. Build at the root path first:
`check-basepath` leaves a build the map cannot boot from there.

## The test round's log

`map-diary.mjs` keeps a short log on the phone for a round played to test the map: position
quality once a minute, locks, slips, waits, hole changes, sheets and battery. It never holds
a position. Meny → Spara provrundans logg hands it over. See [the test round](provrunda.md).

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
BANVY_GPU=1 node tools/check-map-hud.mjs --url http://localhost:8620/
BANVY_GPU=1 node tools/map-gallery.mjs --label a --url http://localhost:8620/
BANVY_GPU=1 node tools/map-timing.mjs --url http://localhost:8620/
```

`check-map-field` walks a hole on fake GPS, measures, drags the point, opens every sheet,
pans away and back, reads a green, enters a score, changes hole, loses the graphics
context and reopens with no signal. It found the worst bug so far: tapping the next
hole with GPS on, from close in, left every point behind the camera and blanked the
map. Run it on more than one course: it took Visby's holes to show that.

The timing tool is the phone proxy of `docs/load-times-2026-11-04.md` (4x CPU, 20 Mbps,
80 ms) on this GPU. On Veckefjärden, 5 November: first picture 4.0 s cold and 2.5 s on
reopen with nothing downloaded, all 1 m ground at 5.5 s and 3.7 s, against 40 s and 8 s
for the player. Before the land pictures and the surroundings record those were 2.4, 1.5,
3.3 and 2.5 s. High-quality canvas smoothing of the land pictures cost about a second of
that, so they are drawn with the plain kind. It says nothing of a phone's graphics.

On a real phone the owner reports it "very snappy" (4 November, model not recorded).
That is the only evidence so far: frame rate and battery use are unmeasured.
