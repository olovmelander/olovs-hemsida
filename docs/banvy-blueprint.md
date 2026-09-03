# Banvy Blueprint — what would make Banvy the best golf course experience on a phone

Product research, 2 September 2026; status updated 3 September. Published as a page at
<https://claude.ai/code/artifact/f98348e8-0de1-4163-8c30-1b2138343946>; this file is
the same content in Markdown so it lives with the code.

Nine real courses on real ground, the clubs' own hole guides, offline, no download.
That is a base nobody in the caddie-app or simulator world has. This is what they
have that we lack, sorted by what it would take.

Benchmarked: Trackman VG3 & Range, GSPro, E6 Connect, FSX Play, Golfzon, Toptracer,
Creative Golf · EA Sports PGA Tour, PGA Tour 2K25, WGT · 18Birdies, Arccos, Garmin,
GolfLogix, Golfshot, PuttView, GameBook, Hole19 · Min Golf, Caddee, LiveCaddie,
GreenBird, Sweetspot, Golfapedia. Everything below is from the vendors' own pages,
help centres or manuals, read on 2 September 2026; sources are numbered at the end.

## The verdict

**Banvy's edge**

- Real terrain heights on every metre of the course. Every caddie app fakes
  elevation from a few points.
- The club's own text on every hole, sourced and checked, in the language the
  golfer speaks.
- A live 3D scene in the browser. Golfapedia's 33,600 flyovers are canned; ours can
  answer a tap.

**Where we are behind**

- Strategy is still words: the hålguide's aim lines and landing zones are not yet
  drawn on the hole.
- Nothing personal: no scorecard, club distances, strategy or round recap.
- No pins and no live sun. Wind and temperature reach Kikaren now, nothing else.

**First moves**

- **Done 3 Sept:** Kikaren is a full caddie: tap anywhere, plays-like with live
  wind, carries, layups.
- Paint the hålguide onto the hole: aim lines, landing zones, distance arcs.
- Live sun, wind and weather. Then the broadcast flyover with narration.

## What the app does today, seen from the outside

Per-hole cameras (Tee, Green, Fritt, Ovan), five light presets, Flygtur and
Bansafari, Kikaren, Greengrid, Skyltar, distance plates, a minimap, a card with tee
choice, the Swedish hålguide, elevation facts, photo, clean and kiosk modes, deep
links and offline install. Since this research Kikaren has become a full
rangefinder (shipped 3 September): front, centre and back of the green from the
ball, tap anywhere, a long press to move the ball, every hazard on the line with
its layup and carry, and plays-like with live wind and temperature. Greengrid
already computes mean and maximum green slope with moving fall-line markers. A broadcast-style hole flight is in progress in the
working tree.

The panel in the screenshot mixes three kinds of control in one card: camera modes,
tools that need a further tap, and navigation. Skyltar is a toggle drawn as a
primary button. The facts block ends with "Ritad 465 m · kortet 465 m", which is a
pipeline check, not something a golfer needs. Those are the cheapest fixes in this
document and they are listed near the end.

## What the benchmarks actually have

### Simulators: the HUD is a caddie, and the settings are the course

**Trackman Virtual Golf 3** added a lie indicator with side and up/downhill degrees,
a green grid with a colour heatmap and directional dots, aimed putting guides and
contour lines, and settings for time of day, fog and cloud during the round; the
sun moves across the sky at an accelerated pace, water has physics, audio is 3D,
and the ground shows divots and pitch marks [1][2]. Course play lets you choose
easy, medium or hard pin placements, tees, turf firmness, wind, stimp, gimme
distance or auto two-putt, and mulligans; tournaments lock those and feed a
Trackman Handicap [3][4]. "Sunday Setups" bundle the official final-round hole
locations and tee placements of a real tour event [5]. TPS 10 shows "My bag" on
shot analysis and lets coaches carry player libraries between locations [6].

**GSPro** runs eight players in stroke, scramble, stableford, match, best ball and
alternate shot, plus online tours, and has 2,500 community courses built from LiDAR
with the OPCD toolset [7]. Its in-game UI is the clearest statement of what a golfer
wants on screen: distance to pin, elevation difference with arrows, wind speed with
a rotating arrow and cardinal direction, hole, par and hole distance, a mini-map
with a rangefinder target, current lie and lie angles, automated aim points with
distances, a club selector with a recommendation, replay cameras (follow, player,
landing), a putting grid and a breakline assist stick [8][9]. Its settings give the
vocabulary: gimme distance, green firmness in five steps, stimp, wind from calm to
gusty [10]. A community course takes 40 to 100 hours in QGIS, Inkscape, Blender and
Unity, and GreenKeeper attaches OB, hazards, tees, pins and the scorecard [11]. Our
pipeline does that from public data with gates, which is the thing to say out loud.

**E6 Connect** sells "LiDAR mapped" courses "accurate within centimeters", elevation
and atmospheric control, mini-games (closest to the pin, long drive, 301, a
demolition range) and league and tournament tools for venues [12]. **FSX Play**
lets you drop the ball anywhere on the course from the mini-map, and runs
closest-to-pin, long drive, skills challenges, leagues and Pinseeker events
[13][14]. **Golfzon** adds an LED putting guide and mini-maps that show impact
points by club distance, on a plate that tilts to the real lie [15]. **Toptracer**
Range is worth copying for its game design: Warm Up, My Practice, Toptracer30
(thirty on-course situations), Closest to Pin, Long Drive, Points Game, Driving and
Approach Challenges, plus a "what's in my bag" club-distance view [16][17].
**Creative Golf** ships a "Floating Grid" for reading greens and mini-golf modes for
families [18].

### Games: presentation is the product

**EA Sports PGA Tour** opens every hole with a flyover and tips-based commentary,
builds its greens from ShotLink pin sheets and yardage books, and gives the player
twenty shot types [19][20]. **PGA Tour 2K25** leads with EvoSwing, a course
designer, cross-platform societies and a "view and navigate the course" mode [21].
**WGT** proved a browser can carry a real-course golf game with head-to-head play
and country clubs [22]. The PGA TOUR's own broadcasts now fly Unreal Engine virtual
holes and let fans follow every shot in TOURCast [23][24]. The lesson for Banvy is
not physics; it is the hole intro: number, par, length, index, wind, an elevation
profile, the line of play, and a voice that tells you what the club's guide says.

### Caddie apps: distances, then strategy, then your own numbers

The table stakes are front, centre and back of the green, distances to every
hazard, tap-to-measure, and a plays-like number. 18Birdies publishes the arithmetic
it uses: about 1% per mph into the wind and 0.5% per mph with it, about 1.5% per
20 °F off a 70 ° baseline, about 1.2% per 1,000 ft of altitude, and one metre per
metre of elevation change [25][26]. **Arccos** tracks every shot automatically,
computes "smart" club distances that drop mishits, gives strokes gained by category,
and recommends a club and a precise target per shot [27]. **Garmin's** Virtual
Caddie needs five rounds of your shot data, then uses elevation, wind and the hole
layout to pick a club and an aim; Green View lets you drag the pin to today's
position [28][29]. **GolfLogix** sells 3D flyovers, tap-anywhere distances adjusted
for slope, approach heat maps of green slope and speed, and putt lines from any
spot [30]. **Golfshot** has an AR view, a voice assistant and automatic strokes
gained [31]. **PuttView** scans a real green with an iPhone's LiDAR in under thirty
seconds and overlays contour lines, slope arrows and the ideal line [32]. **Golf
GameBook** covers the social layer: live leaderboards, twenty formats, and a
tournament manager clubs pay for [33].

### The Swedish ecosystem: what clubs buy and what golfers already carry

**Min Golf** is the federation's app: book and pay tee times, register handicap
rounds against your Golf-ID, register arrival [34][35]. **Caddee** (240+ courses)
syncs handicap and booked rounds from GIT, measures with a finger ("TouchDistance"),
and sells clubs graphical course presentations for print, web and signage [36].
**LiveCaddie**, whose embedded guide Puttom and Veckefjärden use, offers 3D GPS,
flyovers, live scoring and live tracking of players on the course, and the
club-side pin sheet ("Flaggplacering") we saw in its embed [37][38]. **GreenBird**
makes the hole sheets on banguider.se for 50+ clubs, digital and print, and pitches
itself on price [39]. **Sweetspot** runs bookings, payments and dynamic pricing for
clubs and ranges [40]. **Golfapedia** offers "drone-style 3D flyovers" of 33,600
courses free in the browser, from generic data and with no club text [41]. On club
sites the guide is still mostly static: Bjurholm publishes photos, a nickname per
hole, tips with plus and minus, and sponsor logos between holes [42]; Wiredaholm a
360° virtual tour of the holes and clubhouse [43]; and a Leading Courses review of
Ängsö complains that "banguiden var mycket missvisande mot dolda hål" [44]. Blind
holes are exactly what a real-terrain 3D view answers, so that complaint is our
pitch.

### Outside golf: how 3D and cinematic UX is done now

Google Maps Immersive View puts a single "Time & Weather" slider on the scene [45].
Apple Maps Flyover is being rebuilt on Gaussian splatting for iOS 27 [46]. Strava's
Flyover, built on FATMAP's terrain, renders a 3D video recap of any activity with a
moving dot, and its one gap, no export or share, is what users complain about
[47][48]. WebXR in 2026 works in Chrome on Android, in the Quest browser with
passthrough AR, and in Safari on Vision Pro for VR, but iPhone Safari still exposes
no WebXR, so an AR "stand on the tee" mode on iPhone must be built from device
orientation and the camera, not WebXR [49][50].

## Gap matrix

Has = shipped and comparable. Partial = a version exists but is a step behind the
benchmark. Data = buildable but needs data the pipeline does not carry today.

| Feature | Simulators | Games | Caddie apps | Club guides | Banvy today |
|---|---|---|---|---|---|
| Real terrain, whole course | LiDAR-built, hand-finished | Licensed courses | Points only | Drawings | **Has** — 2 m DEM everywhere, 1 m LiDAR on Puttom |
| Club-authored hole text | No | Commentary scripts | Rare | Yes, static | **Has** — all nine courses, sourced |
| Distance to pin, front, centre, back | Yes | Yes | Yes, table stakes | Printed | **Has** — Kikaren, from the ball, along the ray through the centre |
| Tap anywhere: distance, carry, layup | Mini-map rangefinder | Aim marker | Yes | Caddee TouchDistance | **Has** — tap for the target, long press for the ball |
| Plays-like (slope, wind, temperature) | Elevation arrows, wind | Wind meter | Yes, published formulas | No | **Has** — slope, live wind, temperature |
| Live weather, wind, sun | Simulated | Simulated | Live feeds | No | Partial — live wind and temperature in Kikaren; no live sun |
| Daily pin positions | Easy/medium/hard, Sunday Setups | Pin sheets | Drag the pin | LiveCaddie Flaggplacering | Data — needs a club feed or editor |
| Green reading: heatmap, arrows, contours | VG3 grid + heatmap | Putt preview | GolfLogix, PuttView | Green books | Partial — Greengrid on a 2 m DEM |
| Strategy: aim lines, landing zones | Auto aim points | Caddie tips | Arccos, Garmin targets | Tips text | Missing — the text exists, unpainted |
| Lie and stance indicator | Degrees, plate tilt | Yes | No | No | Partial — Kikaren names the lie |
| Hole flyover with graphics and voice | Intro cams | Yes, the signature | GolfLogix flyover | Drone video | Partial — flight in progress, no graphics or voice |
| Time of day and season | Progressive sun, fog, cloud | Yes | No | No | Partial — five presets, no live clock |
| Scorecard, handicap, stats | Virtual handicap | Career | WHS, strokes gained | Min Golf | Missing |
| Club distances, your bag | My bag | Bag | Smart distances | No | Missing |
| Play a shot on the course | The product | The product | No | No | Missing |
| Games: closest to pin, challenges | Yes, many | Yes | Formats | No | Missing |
| Multiplayer, leaderboards, sharing | Online tours | Societies | Live leaderboards | No | Missing — deep links only |
| Video or clip export | Replays | Replays | Strava Flyover, no export | Drone video | Partial — PNG photo mode |
| AR on the tee, VR fly-through | No | No | Golfshot AR, PuttView | No | Missing — WebXR limits on iPhone |
| Booking and club services | Venue tools | No | Min Golf, Sweetspot | Links | Missing — a link would do |
| Offline, no install, deep links | No | No | Partly | No | **Has** |

## The roadmap, in the order I would build it

Each item says what we already have, what to add, and whether the data exists.
Impact is for a golfer standing on the tee or planning a round; effort is
engineering weeks for one person who knows the codebase.

### Tier 1 — The caddie in your pocket

Closes the gap to every GPS app on the one thing they are used for, and does it
with better numbers than they have, because we have the ground.

- **Kikaren becomes a full rangefinder** (tap anywhere, from anywhere). Let the
  tapped point be either the ball or the target. Show front, centre and back of the
  green, the carry over every bunker and water edge along the line, the layup left
  to the next hazard, and the plays-like number. We already march the terrain for
  climb and carry; add the 18Birdies-style wind and temperature terms once live
  weather exists. Glove-sized numbers, one at a time, GSPro's layout: distance big,
  elevation with an arrow, wind with an arrow.
  *Shipped 3 September 2026 · Impact: high · Data: have it.* The arithmetic lives
  in `apps/golf/src/engine/rangefinder.js` with tests, the reading comes from
  Open-Meteo through `engine/weather.js`, and the harness confirmed the tee-to-centre
  distance on Puttom's 12th is the card's 110 m with the lake crossing from 23 to
  84 m. Still open: wind is the station reading at the course, not per hole, and
  there is no out-of-bounds data.
- **Paint the hålguide onto the hole** (aim lines, landing zones, arcs). The notes
  now say things like "sikta över tallen mot höger sida av fairway, slå max 200
  meter" and "lägg upp för ett inspel 100–125 meter kvar". Draw them: a recommended
  line, a landing zone at the stated distance, distance arcs from each tee like
  Johannesberg's plans, and the hazard the text warns about pulsing once when the
  hole loads. GSPro's automated aim points and Garmin's target are the same idea
  without the club's words. A small per-hole JSON (line, zones, hazard ids) is
  enough; a first pass can be derived from `tools/hole-geometry.mjs`.
  *Impact: high · Effort: 3 wk · Data: notes + geometry*
- **Live sun, wind and weather** (a "Nu" preset). A sixth light preset that puts
  the sun where it is now for this course's latitude, and a weather feed for wind
  speed and direction, temperature and cloud. Trackman's progressive time of day
  and Google's time-and-weather slider are the reference; a one-line "Nu: 4 m/s SV,
  14 °C, sol i väst" under the hole header is the payoff, and it feeds plays-like.
  Open-Meteo is free and needs no key; the PWA can cache the last reading.
  *Impact: high · Effort: 1–2 wk · Data: public API*
- **Pin positions** (today's flag, or the three standard ones). LiveCaddie's
  Flaggplacering is the club-facing version; Garmin's drag-the-pin is the golfer's.
  Start with front, middle and back pins per green from the green outline,
  selectable in the card and driving every distance; then a tiny club editor (or a
  pin-sheet import) for the real daily position. This is also the first feature a
  club would pay for.
  *Impact: medium · Effort: 1 wk + editor · Data: green rings now, club feed later*

### Tier 2 — The broadcast

EA's hole intro is the thing people remember. We have the flight; it needs the
graphics and the voice, and it needs to leave the app as a clip.

- **Finish the hole flight as a TV intro.** A banner in the corner during the
  push-off (hål, par, längd from the chosen tee, index), an elevation profile that
  fills as the drone climbs, the wind arrow, and the recommended line drawn in as
  the camera passes it. End on the reverse angle with the hålguide's first sentence
  on screen. The flight already exists; this is the graphics layer.
  *Impact: high · Effort: 2 wk · Data: have it*
- **Narration** (the hålguide read aloud). Every hole has one to three Swedish
  sentences now. Record them once with a real voice per course (nine courses, 135
  holes, an afternoon in a studio), fall back to the browser's speech synthesis, and
  play them over the flight and Bansafari. Golf Course Flyovers sells clubs exactly
  this: drone video, voice-over, yardage graphics, music.
  *Impact: medium · Effort: 1 wk + recording · Data: notes*
- **Share a clip, not a screenshot.** Strava's Flyover is loved and its lack of
  export is the top complaint. Record the hole flight on device to a short vertical
  video (MediaRecorder from the canvas, WebCodecs where available) with the banner
  burned in and a deep link in the caption. Photo mode gets a framing grid, a
  watermark with the club name and the same share sheet. This is how the app
  spreads: one clip of the island 14th in a group chat.
  *Impact: high · Effort: 2–3 wk · Data: none*
- **Course "setups" and the Sunday setup.** Trackman bundles a real event's pins
  and tees; we can bundle a course's competition setup (tee, pins, start hole) as
  one shareable link, and a club can publish "veckans banuppställning". It costs
  nothing once pins exist.
  *Impact: low–medium · Effort: days · Data: pins*

### Tier 3 — Play it

The step from guide to game. Not a swing simulator: a planner that lands a ball on
real ground, and the games the ranges have shown people actually play.

- **Your bag** (club distances, once). Toptracer's "what's in my bag" and Arccos's
  smart distances: nine clubs, a carry each, editable, stored on device. Everything
  below reads from it, and the caddie can say "det är en järnsjua" instead of a
  number.
  *Impact: medium · Effort: 1 wk · Data: user*
- **Shot planner with dispersion.** Pick a club, drag the aim, and see the
  dispersion ellipse land on the real hole: what fraction is in the water, the
  bunker, the rough, and the expected distance left. Arccos and DECADE-style
  strategy built on our terrain and surface classes, no ball physics needed, a
  simple carry-and-roll model per surface is enough. Then "spela hålet": one shot
  after another from where the ellipse's centre landed, a score at the end, and a
  strokes-lost note per hole. Extends naturally into closest-to-the-pin on the four
  par 3s and a nine-hole "approach challenge".
  *Impact: high · Effort: 4–6 wk · Data: have it (bag needed)*
- **Green reading that admits its resolution.** Upgrade Greengrid to the VG3 look,
  a heatmap and fall-line arrows with contour lines, and a "putt from here" that
  draws the break. Then be honest: a 2 m DEM cannot resolve a green, and the 1 m
  LiDAR on Puttom only barely can. The path to real green reading is either the
  club's green books or a PuttView-style phone LiDAR scan per green, stored as a
  20 cm raster. Do the visuals now, label them "terrängmodell", and design the
  raster slot for later.
  *Impact: medium · Effort: 2 wk · Data: needs cm greens*
- **Leaderboards and challenges.** Async and light: closest-to-pin scores per
  hole, a weekly challenge per course, a friend link. No accounts beyond a name and
  a device key to begin with; Golf GameBook and Toptracer show how much play that
  alone generates.
  *Impact: medium · Effort: 3 wk + backend · Data: needs a backend*

### Tier 4 — On the course, and for the club

Where the app leaves the sofa. Both of these turn Banvy from a showcase into
something used every week.

- **GPS mode** (the phone on the course). With geolocation the tapped point
  becomes your position, the Kikaren numbers update as you walk, and the camera can
  follow. Add a scorecard with the game formats people play here (slag, poäng,
  matchspel) and a round recap flown as a Flyover. Handicap stays with Min Golf:
  link out to register the round rather than reimplement WHS.
  *Impact: high · Effort: 4 wk · Data: device GPS*
- **Club portal** (the business model). GreenBird, Caddee and LiveCaddie all sell
  the same three things to clubs: an editable guide, pin sheets, and sponsor
  placements. We can offer a better guide than any of them, with a small editor for
  notes, pins, banstatus and a "Boka starttid" link to Min Golf or Sweetspot.
  Sponsors per hole, if the club wants them, go in a slot that the guide text never
  shares.
  *Impact: high (revenue) · Effort: 4–6 wk · Data: club input*

### Tier 5 — Frontier

Worth prototyping, not worth blocking on.

- **AI caddie that knows the course.** A chat that answers "vad ska jag slå här?"
  from the hålguide, the geometry and your bag, in Swedish, with the answer drawn on
  the hole. 18Birdies and Arccos market "AI caddie"; ours would be the only one
  grounded in the club's own text.
  *Impact: medium · Effort: 2 wk · Data: have it*
- **AR on the tee, VR over the course.** A "stand here" mode that uses the phone's
  orientation and camera to show the hole's line and distances over the real view
  works on iPhone without WebXR; the full WebXR AR path is Android-only today, and
  VR fly-throughs work in the Quest and Vision Pro browsers. Prototype the
  orientation mode first.
  *Impact: medium · Effort: 3 wk · Data: have it*

## UX fixes visible in one screenshot

None of these need research. They are what a design pass on the panel would change
first.

- **Group by what it does.** Vy and Ljus are modes, Flygtur and Bansafari are tours,
  Kikaren and Greengrid are tools that expect a tap, Skyltar is a toggle, Välj bana
  is navigation. Five groups with five labels, and the tools say what they want:
  "Kikaren · tryck på banan".
- **A hole header, always.** The panel never says which hole you are on. Put
  "Hål 4 · Par 5 · 465 m · Index 3" at the top in the tee's colour, and make
  "Spelas 1 m uppför" part of it. GSPro and every caddie app lead with this line.
- **Hide the pipeline.** "Ritad 465 m · kortet 465 m" is a gate, not a fact; keep it
  behind a debug flag. Elevation "ö.h." can stay, it is real and nobody else shows it.
- **Bottom sheet, not a floating card.** On a phone the controls belong in a sheet
  that rises from the bottom in two heights, thumb-reachable, with the scene visible
  above it. The centred card covers the fairway you are reading about.
- **State that looks like state.** Toggles (Skyltar, Greengrid, Kikaren) get a
  switch or a filled dot; actions (Flygtur, Bansafari) get an arrow. Right now the
  active toggle reads as the primary call to action.
- **Quality you can see.** The low-quality fallback renders at device pixel ratio 1
  and reads as blur on a phone; show a one-line badge with a tap to retry at full
  quality instead of remembering the downgrade forever.

## What the data allows, honestly

Every recommendation above was checked against what the pipeline carries.
Tap-anywhere distances, plays-like, aim lines, landing zones, the flight graphics,
the planner and GPS mode all run on what exists: 2 m elevation everywhere, 1 m
LiDAR on Puttom, OSM and satellite surfaces, the clubs' cards and texts. Three
things need data we do not have. Daily pin positions need a club feed or an editor.
Green reading at putting resolution needs centimetre greens, which means green
books or per-green phone scans. Wind and weather need a live feed, which is the
easiest of the three. Nothing here needs a launch monitor, and nothing needs the
physics of a simulator: a planner that lands an ellipse on real ground is a
different, and for a course guide a better, product than a swing game.

## Sources

1. [Trackman Help Center: Virtual Golf 3](https://support.trackmangolf.com/hc/en-us/articles/29476947436059-Courses-Introducing-Virtual-Golf-3)
2. [Golf Business News: Trackman rolls out Virtual Golf 3](https://golfbusinessnews.com/news/practice-range-and-teaching/trackman-rolls-out-virtual-golf-3/)
3. [Playing Trackman simulated courses (settings)](https://shopindoorgolf.com/blogs/helpful-articles-videos/playing-trackman-simulated-courses)
4. [Trackman Tournament and Virtual Handicap](https://support.trackmangolf.com/hc/en-us/articles/18785826324251-Trackman-Tournament-Trackman-Virtual-Handicap)
5. [Trackman: Sunday Setups](https://www.trackman.com/blog/golf/a-new-way-to-play-sunday-setups)
6. [Trackman: Virtual Golf 3 and TPS 10](https://www.trackman.com/blog/golf/virtual-golf-3-and-tps-10)
7. [GSPro features](https://gsprogolf.com/features)
8. [GSPro knowledge base: in-game user interface](https://gspro.gitbook.io/gspro-knowledge-base/in-game-information/in-game-user-interface)
9. [GSPro knowledge base: visual settings](https://gspro.gitbook.io/gspro-knowledge-base/settings-main-menu/visual-settings-settings)
10. [GSPro knowledge base: local match setup](https://gspro.gitbook.io/gspro-knowledge-base/local-match-main-menu/local-match-setup)
11. [The Perfect Lie: building GSPro courses (OPCD)](https://www.theperfectlie.net/articles/guides/building-gspro-courses)
12. [TruGolf: E6 Connect](http://trugolf.com/software/e6-connect/)
13. [Foresight: FSX Play user manual](https://support.foresightsports.com/fsx-play-user-manual)
14. [Foresight: FSX Play support](https://support.foresightsports.com/support/software/fsx-play)
15. [Golfzon: TwoVision NX](https://www.golfzongolf.com/global/user/simulator/two-vision-nx.do)
16. [Toptracer: game modes on Toptracer Range](https://help.toptracer.com/article/64-game-modes-on-toptracer-range)
17. [Toptracer Range app](https://play.google.com/store/apps/details?id=com.toptracer.community)
18. [Creative Golf](https://creativegolf.com/)
19. [EA Sports PGA Tour features](https://www.ea.com/games/ea-sports-pga-tour/features)
20. [EA Sports PGA Tour and ShotLink](https://mp1st.com/news/ea-sports-pga-tour-introduces-shotlink-system-to-the-game)
21. [PGA Tour 2K25](https://pgatour.2k.com/2k25/)
22. [WGT Golf](https://www.wgt.com/)
23. [SVG: PGA TOUR's Unreal Engine virtual hole flyovers](https://www.sportsvideo.org/2023/03/10/live-from-the-players-championship-pga-tour-embraces-cloud-for-all-access-unreal-engine-drives-next-gen-virtual-hole-flyovers/)
24. [TOURCast](https://en.wikipedia.org/wiki/TOURCast)
25. [18Birdies: Plays Like distances](https://help.18birdies.com/article/645-plays-like-distances)
26. [18Birdies: slope, wind, rain and temperature](https://18birdies.com/clubhouse/play/how-to-factor-in-slope-wind-rain-and-temperature)
27. [Arccos Caddie](https://www.arccosgolf.com/pages/arccos-caddie)
28. [Garmin Approach S62: Virtual Caddie](https://www8.garmin.com/manuals/webhelp/GUID-7681996C-530F-4C69-80C4-3CD20D82746C/EN-US/GUID-5E518C03-FDA0-429D-A733-BC90CEB96B41.html)
29. [Garmin Approach S62: PlaysLike distance](https://www8.garmin.com/manuals/webhelp/GUID-7681996C-530F-4C69-80C4-3CD20D82746C/EN-US/GUID-4D16CAF9-F14F-44D0-8860-B5BEF6DB9F72.html)
30. [GolfLogix](https://www.golflogix.com/)
31. [Golfshot features](https://golfshot.com/features)
32. [PuttView app](https://www.puttview.com/products/app/)
33. [Golf GameBook](https://golfgamebook.com/)
34. [Svenska Golfförbundet: Så funkar Min Golf](https://golf.se/spela-golf/sa-funkar-min-golf)
35. [Min Golf app](https://apps.apple.com/se/app/min-golf/id6476378347)
36. [Caddee](https://www.caddee.se/)
37. [LiveCaddie](https://livecaddie.com/)
38. [LiveCaddie course guide embed (Puttom)](https://courses.livecaddie.com/course-info.php?course=658&lang=sv-SE&embedded)
39. [GreenBird Golf](https://www.greenbird.golf/)
40. [Sweetspot](https://sweetspot.io/)
41. [Golfapedia](https://www.golfapedia.org/)
42. [Bjurholms GK banguide](https://www.bjurholmsgk.se/banguide)
43. [Wiredaholm interaktiv banguide](https://wiredaholm.se/golf/banguide/)
44. [Leading Courses: Ängsö GK reviews](https://www.leadingcourses.com/sv/clubs/europa+sverige+v%C3%A4stmanland/%C3%A4ngs%C3%B6-golfklubb)
45. [Google Maps Immersive View: Time & Weather](https://www.androidcentral.com/apps-software/how-use-google-maps-immersive-view)
46. [Apple Maps Flyover and Gaussian splatting](https://radiancefields.com/apple-maps-flyover-is-getting-a-gaussian-splatting-upgrade)
47. [DC Rainmaker: Strava Flyover hands-on](https://www.dcrainmaker.com/2023/11/launches-activity-flyover.html)
48. [TechCrunch: Strava launches Flyover](https://techcrunch.com/2023/11/15/strava-launches-flyover-an-aerial-3d-video-recap-of-every-outdoor-activity-you-do/)
49. [WebXR on iOS in 2026](https://xrdoctors.pro/blog/webxr-on-ios-what-actually-works)
50. [WebXR browser support in 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)
