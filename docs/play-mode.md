# Spela and Återupplev (8 November)

The owner asked for a game mode in which the courses are played the way a golf
video game plays them. They also asked for a mode that replays the real rounds
recorded with the map's club wheel: the same shots and clubs, on the detailed
course. Their plan had three phases:

1. One hole playable end to end: physics, putting, swing and scoring.
2. Feel: sound, the ball's trace, replays, the celebration and difficulty levels.
3. Social: a ghost of your best round, challenges and shared cards.

Phase 1 is built, and so is Återupplev. Phase 2 followed the same day, after
the owner asked what would bring the game closer to PGA Tour 2K25:

- the swing's tempo, a game controller and the swing's numbers after each shot;
- shot types and shaping;
- reading aids: the spread, "plays like" and the green's slope;
- lies: a lie %, slopes and plugged balls;
- sound, a thick tracer, an instant replay and the hole's flyover;
- partial swings that match the shot.

The section [The tour-game layer](#the-tour-game-layer) describes them.

The owner then asked for the best features and UX of the course's other modes
in the game, made to work for it: the lights, the course guide, and the rest.
They also asked for a screen that is visually stunning and right for a game and
for a replay. [From the other modes](#from-the-other-modes) and
[The screen](#the-screen) describe them.

## Where it starts

- **The start menu:** a third mode card, **Spela** (key 3). Statistik and
  Inställningar are now keys 4 and 5. The card's picture comes from the game
  itself (`tools/make-play-art.mjs`).
- **The course list and course page:** Spela is a mode beside Detaljerad 3D and
  Lätt 3D (`MODES.play` in `shell/settings-store.mjs`). The course page adds a
  choice of golfer (Kvinna or Man) to the tee, start hole and light, and its
  button reads "Till första tee".
- **The map's menu:** a "Spela banan" link.
- **A kept round:** "Återupplev i 3D", both on the map's round sheet and on a
  round's card in Statistik. It is offered only when the round has shots with
  positions.

The links:

| What | URL |
| --- | --- |
| Spela | `?bana=<slug>&karta=0&spela=1[&golfare=female\|male][&tee=n][&hal=n][&ljus=…]` |
| Återupplev | `?bana=<slug>&karta=0&aterupplev=<round id>[&golfare=…]` |

`karta=0` is always present, because on a phone a plain course link opens the map.
`launchUrl(slug, 'play', …)` builds the Spela link, and `playUrl`/`reliveUrl`
in `shell/router.js` build the short forms.

## How it fits the detailed course

All of it lives in `apps/golf/src/play`, outside the folders that the source
revision hashes. `main.js` has one hook, at its end. When `?spela=1` or
`?aterupplev=` is in the link, the hook imports `play/play-mode.mjs` and hands it
a handle: the scene, camera, controls and renderer, the holes, the drawn ground
(`renderedGroundH`), the lies (`kikLie`, `classify`), the cups, the trees, the
white stakes and out-of-bounds lines, the wind (`AIR`), the bag, and a few
switches. In return, the frame loop calls the game's `update(dt)`, and while
`ownsCamera` is true it skips the orbit controls and the ground clamp. The play
camera keeps itself above the ground.

The game can therefore grow without touching `main.js`, the engine or the loader
again. Every change to those expires the prepared startup data until the next
bake.

Adding the hook did expire it, so this change re-bakes the water, the ground
tints, and the far vista and scatter through the existing publishers. While a
game is on, the course's own aids step aside: the strategy overlay and Kikaren
(`quietCourse`, which leaves the player's saved preferences alone), and every
panel of the course's screen (`body.pl-on`).

The golfer models (`experiments/golfer/assets`) are now published in every
build, at `models/golfer/`. A player downloads one only when a game starts, and
the service worker never precaches them. The character studio and the lab's own
course mount (`?golfer=1`) stay lab-only. `tools/blender-golfer/check_isolation.mjs`
holds this contract.

## The ball (`ball-physics.mjs`)

These are pure functions on plain arrays. The whole shot is simulated the moment
the club meets the ball and then played back in real time, so:

- the camera knows where the ball lands;
- the aid can show the shot ahead;
- the same swing always gives the same shot, since every stroke has its own seed.

**Flight:**

- **Integration:** RK4 at 240 Hz, with gravity, drag and the spin's lift
  (Magnus). The spin decays with a 24 s time constant.
- **Wind:** follows a log profile over short grass, so the wind near the ground
  is weaker than the 10 m value.
- **Calibration:** on PGA Tour TrackMan averages. Carries come out at about
  240 m for the driver (251 m measured), 157 m for the 7-iron (157 m) and 128 m
  for the pitching wedge (124 m).
- **Coefficients:** drag is `.225 + .25 S` and lift is `.36 S^.3`, where S is
  the spin factor.

**The player's own distances:** each club's full-swing ball speed is solved so
that its flat, windless carry equals the carry in the player's bag
(`speedForCarry`). The game's clubs and the real club statistics therefore agree.

**Ground:** each surface has its own restitution, friction, backspin bite and
rolling resistance (`SURFACES`):

- **Green:** rolls at about 10 on the stimpmeter. Wedges check and can draw back.
- **Sand:** stops the ball where it lands.
- **Water:** keeps the ball.
- **Paths:** let it run.

A rolling ball follows the real slopes of the drawn ground, at 5/7 g for a
rolling sphere.

**The cup** (108 mm across) takes a ball whose centre passes over it slowly
enough. The faster the ball, the closer to the middle it must be, and above
about 1.6 m/s it lips out.

**Trees:** each is a trunk and a crown (`play-world.mjs`, built from the course's
own plantings).
- The trunk turns the ball back.
- The crown slows the ball and scatters it, with a chance per metre of meeting
  a branch.

## The shot (`shot-model.mjs`)

- **The bag:** the game uses the player's own bag (`banvy-caddie-bag-v1`). Each
  club is mapped to a launch family as the bag editor reads it (`clubKind`: the
  kind the player chose, then the name, then the id). An iron's number and a
  wedge's loft come from the name before the id, and a club nothing names is
  placed by its carry. Until 9 November the id came first, the kind was ignored
  and "6-järn" went unread, so a 110 m "7-järn" played as a pitching wedge.
- **Changing club** starts the new club's full swing (`setupForClub`). A punch,
  and the shape, height and spin, are kept where the club can play them. A chip,
  pitch or flop stays only from one wedge to another. A short-game number in the
  HUD names its type ("Chip · 30 m").
- **The lie:** takes speed, spin and accuracy off the shot. Out of the rough the
  ball comes slower and with less spin, forest and sand cost more, and a path
  is slightly hard. A ball on its own tee marker is teed up, again after a ball
  out of bounds from it, whatever the drawn ground under the marker reads.
  Until 9 November Ängsö's 1st tee read as rough, and every drive there flew
  15% short.
- **Planned power** (`planPower`): the share of a full swing a shot is planned
  at. The swing pad shows it as an amber line to pull to, and the aid's preview
  and landing ring use it.
  - A full swing or a punch **flies to the target**: it lands at the distance
    less the roll a full one has on that ground, then runs on. The roll allowed
    for is at most a tenth of the distance (4-15 m), since a wood or a punch runs
    40 m and more on the flat model green. Every club's ring stands by the target,
    a longer club's a few metres shorter because it runs further. A long club
    swung softly runs on past the target, as it would.
  - The short game is played to run, so a chip, pitch or bump and run is planned
    by its whole run (`powerFor`).
  - `powerFor` takes the strongest swing whose run reaches the distance. A softly
    swung long club comes out low with little spin and skids a long way, so a
    plain bisection could settle on a skid.
  - Until 9 November every shot was planned by its whole run, with that
    bisection. A 6-iron to a 140 m pin was planned at 42%, landing 36 m out,
    while the 7-iron flew 130 m at 94%. The ring jumped short as the club got
    longer.
- **The swing's errors:**
  - the face sets where the ball starts;
  - the path sets how it curves;
  - both grow with club length, the lie, the difficulty and a forced swing past 100%.
- **Putts:** a putt's meter is a distance on a flat green, rounded up to the
  next length past the hole: 3, 5, 8, 12, 16, 20, 25, 30 or 40 m.

**Difficulty** (Meny → Svårighet, kept in `banvy-play-settings-v1`):

| Level | Share of the swing's error | The aid |
| --- | --- | --- |
| Lätt | 35% | The whole flight and its landing, with the wind; the whole roll of a putt |
| Normal | 75% | The landing without the wind; the first 40% of a putt's roll (its start line) |
| Svår | 120% | Nothing |

## The swing (`swing-input.mjs`)

- **Dra** (the default): press on the pad, pull straight down for the backswing
  (how far is the power), then push straight back up through the start line to
  strike. Drifting sideways on the way up opens or closes the face and bends the
  path. Letting go before the strike cancels the swing. The golfer's backswing
  follows the pull. The swing is timed (see Tempo below).
- **Tryck** (the accessible one, and Space): tap to start the meter, tap again
  to set the power, then tap a third time as the marker passes the line. Nothing
  needs a steady drag.
- **A game controller:** the right stick swings as the pad is dragged (see
  below).
- **Aiming:** drag on the course, or press ← and →. Shift turns 0.2° at a time.
- **Other keys:** ↑ and ↓ change the club, O is the overview, Esc is the menu.
  T, Q E, W S and Z C set up the shot, and R is the replay. Space or a tap
  speeds up a flight four times and skips a pause.
- While a game is on, the course's own shortcuts stay out of it.

## The tour-game layer

### Tempo (`swing-input.mjs` `tempoOf`)

The drag and the controller's stick time the backswing (from the touch to the
top) and the downswing (from the top to the strike).

| Backswing : downswing | Verdict | What it does |
| --- | --- | --- |
| 2.6-3.8 : 1 (tour tempo is about 3 : 1) | Perfekt tempo | The drift's error is halved |
| 2.2-2.6 or 3.8-4.4 : 1 | Bra tempo | 80% of the error |
| under 2.2 : 1 | För långsamt genom bollen | Up to 16% shorter, the face open and the path out-to-in (a slice) |
| over 4.4 : 1 | För snabbt från toppen | The face closed and the path in-to-out (a pull or hook) |

A backswing hurried for its size (under 0.28-0.6 s) also spreads the miss
("Stressad baksving").

The verdict shows by the pad at the strike. The golfer's downswing on screen
follows the player's own pace (`golfer.rate`). The tap meter is not timed.

### A game controller (`gamepad-input.mjs`)

The Gamepad API's standard mapping. The browser reports a controller only after
one of its buttons is pressed on the page, and a banner then says it is
connected and the help line changes.

| Control | What it does |
| --- | --- |
| Right stick | The swing: pull back, then push through |
| Left stick | Aims |
| LB / RB | The club |
| X | The shot type |
| D-pad ← → | Shape (draw to fade) |
| D-pad ↑ ↓ | Height |
| LT / RT | Spin |
| A | Tap meter; speeds a flight on; skips a flyover |
| B | Back; closes a sheet |
| Y | Overview |
| Back | Replay |
| Start | Menu |

On a sheet, the D-pad moves between its buttons and A presses one. A pure
strike rumbles. Letting the stick go to the middle cancels a swing.

### The shot's setup (`shot-model.mjs`)

The shot is set up from the button beside the club ("Slag") or with the keys.
Each new shot starts from the caddie's choice.

**Types** scale the club's full launch:

| Type | Clubs | Speed | Launch | Spin | Swing |
| --- | --- | --- | --- | --- | --- |
| Full | all | 1 | 1 | 1 | the club's |
| Punch | irons, hybrids, wedges | .92 | .7 | .85 | the club's |
| Pitch | wedges | .76 | 1.1 | 1.02 | short game |
| Chip | wedges | .32 | .72 | .6 | short game |
| Flopp | GW, SW, LW | .56 | 1.6 | 1.12 | short game |
| Bump & run | 7-9 irons | .23 | .5 | .3 | short game |

With the default bag:
- a punch with the 7-iron carries 116 m and runs to 146 m (a full one: 140/154);
- the PW's chip runs about 28 m and the LW's 10 m;
- the LW's flop lands about where it stops.

Full wedge shots now take the iron swing, and the short game takes the chip
swing (`swingFor`).

**Shape:** Stor draw, Draw, Rak, Fade or Stor fade. Each step tilts the spin
axis by 3.5° for a wedge up to 7° for the driver. A draw comes out a little
lower with less spin, and a fade the opposite. The start line is opened
(`shapeAim`, solved once on flat ground and remembered), so the shot still lands
on the aim line: a big draw with the driver starts 5° right. Only full shots and
punches are shaped.

**Height:** Låg, Normal or Hög (launch ×.78 or ×1.18). **Spin:** Toppspinn
(×.55), Normal or Bakspinn (×1.3).

**The caddie** (`suggestShot`):
- the putter on the green;
- within 40 m and outside sand, the chip that reaches with the least loft;
- within 95 m, a pitch;
- otherwise the shortest club that carries the distance as it plays (with the
  lie % counted in).

### Reading the shot

- **The spread:** an ellipse round the landing marker (Lätt and Normal). It is
  two more simulated shots with a typical miss each way (a third of the pad's
  width), and a depth from the strike's pace.
- **Spelas som:** the pin's distance with the rise and the wind along it
  (`playsLike` from the rangefinder). Lätt plans its power line on it.
- **The club's distance** (beside its name, `clubReach`): how far it goes at full
  power from this lie, as the shot is set up: a full swing's carry, another type's
  whole run. It is reckoned like Spelas som (flat ground, still, standard air), so
  the two compare like with like, and with the same shot model as the planned
  power and the landing marker. From a clean fairway lie a stock full swing is
  the bag's own carry. The rough, sand, a lie's quality and a low, high or spun
  shot change it, and hovering the number says so. (Until 9 November it showed
  the bag's carry from every lie: a 7-iron read 145 m from the rough, where it
  carries about 126.)
- **For putts:** "Uppför 24 cm · som 10 m". A rise of h on the green adds
  (5/7) h / 0.06 of flat green (`puttPlaysLike`).
- **The green's read** (`green-read.mjs`): within 30 m of the cup, arrows lie on
  the green every 0.9 m round the line and drift slowly downhill. They are faster
  and warmer (pale blue to amber to red) where the green is steeper, and still
  under reduced motion. They read the same drawn heights the ball rolls on.

### The lie

- **The lie %** (`lieQuality`, seeded per stroke so a replay is the same):
  - fairway, tee and green are 100%;
  - the rough is 93% (sitting up), 88% or 76% (sitting down, with less spin and
    more error);
  - the forest is 76% or 67%;
  - sand is 84% or 78%.
- **Slopes** (`slopeLie`):
  - uphill adds 0.85° of launch a degree;
  - a ball above the feet starts left and hooks, and below them the opposite;
  - every degree spreads the miss.
  The lie chip says so ("uppför 3°, boll över fötterna").
- **Plugged:** a steep, fast first landing in sand can bury the ball where it
  lands (`plugged` in the physics). The next shot is then at 56%, with little
  spin.

### Presentation

- **Sound** (`play-audio.mjs`): made on the spot with Web Audio, with no files.
  - the strike, by club and lie, brighter when pure;
  - the swing's whoosh, timed to impact;
  - each bounce by its surface, from the physics' recorded `events`;
  - a trunk's knock and the leaves;
  - the cup's rattle and plunk, and a splash;
  - a putt's roll, the wind by its speed, and a chime for par or better.

  It starts on the first touch or key, pauses while the tab is hidden, and the
  menu turns it off (Ljud).
- **The tracer** (`ribbon-tracer.mjs`): a ribbon about five pixels wide at any
  distance, turned to the eye each frame, soft at its edges and fading toward the
  tee. Återupplev draws it too.
- **The shot's numbers:** after each shot, a card with the tempo's verdict and
  ratio, the club, type, power, face and path. Then carry, total, ball speed,
  launch, spin, apex and how far offline. A putt's card shows its length, speed
  and how long it played. On a phone it hides after 4.5 s.
- **Instant replay** (Repris, R, Back on a controller, and "Se sista slaget
  igen" on a holed hole's card):
  - the golfer swings again at the old spot, filmed face on;
  - the flight is followed from the side as it climbs, then from beyond the
    landing;
  - a putt is seen from low behind the cup.
- **The hole's flyover** (`flyover.mjs`): before each hole's first shot, the
  camera flies from behind the tee along the hole's line and settles over the
  green looking at the flag. It takes 3.6-9 s and is skipped by a tap, Space or A.
  It is off under reduced motion, and in the menu (Hålöverflygning).
- **Partial swings:** a tap-meter swing, a replay or a harness plays the
  backswing to its power before the downswing (`swingFrom`). A drag or a stick
  holds it there. Either way the downswing starts from the matching point, so
  a chip or a putt is a short stroke.

## From the other modes

None of this touches `main.js`. The lights are chosen through `window.V3D`
(`chooseLight`, `nu()` for Nu's choice and weather, `winter()` for snow). The
camera's free view hands the camera to the course's own orbit controls by
letting `ownsCamera` go false.

- **The lights** (the detailed course's Visning tab): all eleven, Nu first, as
  their own skies in the menu's Ljus tab, and L steps through them.
- **The day's conditions** (`conditions.mjs`): each light plays as it looks.

  | Light | Ground | Air without a reading |
  | --- | --- | --- |
  | Oväder | wet (the ground finish's `GROUND_WETNESS` 1) | 12 °C, gustier |
  | Dis | wet (0.6) | 10 °C |
  | Gryning | dew (0.3) | 11 °C |
  | Sommar | firm and fast | 24 °C |
  | Vinter | snow: the ball stops almost where it lands, and it is orange | −3 °C |

  - **Wet turf:** the bounce and the run are lower, a ball plugs in sand more
    often, and the greens are slower. The putt meter stays in metres on today's
    green (`greenRoll`), and "spelas" counts the slower pace.
  - **The air:** its temperature sets its density (`airDensity`), so cold air
    carries a ball less far. "Spelas som" counts it too, as the rangefinder
    does. Under Nu the temperature is the real reading; otherwise it is the
    light's own.
  - **The wind:** it is the course's own air, which follows the real weather and
    a storm's gale. Each stroke meets a gust drawn for it (`strokeWind`, seeded),
    so the aid shows the mean and the shot can be caught by a gust. The stats
    strip says what it met.
- **The course guide (Banguide):**
  - each hole's name, index and note during the flyover, as its lower third;
  - in the scorebug, which opens the guide's page (G);
  - in Återupplev too.
- **The hole map** (`hole-map.mjs`, the Minikarta made for a game):
  - the hole turned to run up the map, drawn from the lies and heights the ball
    plays on, shaded by their relief, with the course's trees and white stakes;
  - over it the ball, the aim, the landing spread, the pin, the hole's shots
    and the ball's flight as it flies;
  - a tap aims there (M makes it bigger or smaller).
- **The rangefinder** (Kikaren):
  - the green's back, middle and front (`greenDistances`);
  - the water and bunkers on the line to where the shot is going
    (`lineHazards`: "Vatten · kort om 128 · bär 146 m");
  - a tapped point on the course or the map becomes a **target**. The aim turns
    to it, the caddie hands over the club for it, the power line plans for it,
    and the panel says how far it plays. Backspace or × clears it.
- **Handicap** (the map's own rules, `map/map-score.mjs`):
  - the course page now offers the handicap for Spela too;
  - strokes given show as dots by the hole's name;
  - the card counts Stableford points;
  - the hole card shows the round's fairway hits, green hits, putts and points.
- **The camera's views** (V or Y cycles them): behind the ball, the overview,
  the green (over it for a putt or a chip, from short of it otherwise) and a free
  look round on the course's own orbit controls.
- **Ren vy** (H): only the course, for a picture.

## The screen

A broadcast's layout, drawn in the detailed course's language: its glass, small
spaced capitals for labels, JetBrains Mono for every number, and turf green,
amber and water blue (`play-hud.mjs`).

- **Top left, the scorebug:**
  - the hole number on turf green;
  - par, length and index, and the hole's name with the guide's way in;
  - the stroke and the round so far (to par, or points with a handicap).
- **Under it, the distance panel:**
  - the pin's distance in large figures, and how it plays;
  - the green's back, middle and front, as the rangefinder's ladder;
  - a target, and the hazards on the line.
- **Top right:**
  - the buttons;
  - the conditions card: a wind dial turned to the aim (up is with you), the lie
    with its % on a bar and the slope, and the weather and the ground;
  - the hole map.
- **Bottom:**
  - the club and the shot's setup on the left, and the swing on the right;
  - after a shot, its numbers between them as one strip (the tempo's verdict,
    carry, total, ball speed, launch, spin, apex, side and the wind it met).
- **The flyover and the replays are letterboxed**, with a lower third:
  - the hole and the guide's note;
  - or, for a replay, the stroke and what it did, under a "● Repris" bug.
- **The hole card** after a hole:
  - the score's name large, green under par and amber over it;
  - tiles for the total, points, fairway hits, green hits and putts;
  - the scorecard, nine holes to a row with their sums, birdies circled and
    bogeys boxed.
- **The menu** in three tabs, as the course's drawer: Spelet, Ljus, Scorekort.
- **Återupplev** shares it:
  - the scorebug with the course guide, and the distance panel;
  - the hole map with the round's own shots on it;
  - a lower third per stroke (club, length, from and to);
  - a "● Återupplev · <date>" bug;
  - a transport bar with the hole's strokes as a timeline (a putt is square).
- **On a phone:**
  - the scorebug, panels and map shrink, the map starts small, and the buttons
    are icons;
  - the strip stands above the club;
  - the swing pad steps aside between shots.

## The camera (`play-camera.mjs`)

- **At address:** behind the ball, looking down the aim. On a portrait screen it
  stands further back and a little toward the golfer, so she stays in frame.
- **In flight:** the broadcast shot. The eye holds behind the golfer and rises a
  little while the ball climbs, then hands over to a view from beside the landing
  spot. The landing is known before the ball leaves the club.
- **At rest:** it settles behind the ball, looking at the hole.
- **Always:** every pose is critically damped and kept above the drawn ground.
- **The ball:** grows with distance so it stays a dot, with a soft halo in flight.

## The rules (`play-rules.mjs`)

- **Out of bounds:** decided from where the stroke was played. A ball is out when
  the line to it crosses the white stakes or out-of-bounds lines an odd number of
  times, or when it leaves the course's own ground. Penalty: stroke and distance.
- **Penalty areas (water):** one penalty stroke and lateral relief. The drop is
  within two club lengths of where the ball crossed in, no nearer the hole and on
  dry ground; it falls back further along the line back from the hole.
- **Tap-ins:** a ball resting within 45 cm on the green is tapped in. The tap-in
  counts as a stroke.
- **Picking up:** a hole is picked up at par + 5.
- **The card:** strokes, putts and penalties, with the score's name (birdie, par,
  dubbelbogey…). After each hole a sheet shows the card so far.
- **Kept apart:** played rounds are stored under their own key,
  `banvy-play-rounds-v1` (the newest 100). They never share a key with the
  rounds and shots the map records, so a game can never reach the real club
  statistics. The tests hold this.

## Återupplev (`relive-model.mjs`, `relive.mjs`)

**What the map stores:** every locked shot, in the map's ground frame (metres
east and south of the ground's origin). Each shot has its `from` and `to`, club,
lies and outcome.

**From the map's frame to the course's:** `createMapFrame(groundId,
frame).toPack` carries each position into the detailed course's frame. That is
a translation on the grid-authored grounds, plus the legacy grid bridge's
rotation of up to 3.28° on the older ones.

**Measured shots:** each starts and ends exactly where the phone locked it. The
flight between is the club's own, solved for the measured distance and laid
onto the line the ball travelled, keeping a third of its curve.

**Putts:** the map counts putts but does not position them. Återupplev rolls
them from the first putt's spot to the cup, in as many putts as were counted,
and says so on screen ("Puttarna är räknade, inte inmätta").

**Playback:**
- Out of bounds and penalty areas are shown as such.
- Holes play in the order they were played.
- A hole without any located shot is skipped.
- **Controls:** pause (Space), next and previous shot (→ and ←), next hole (N),
  and three speeds (1×, 2× and 0.5×).

Nothing is written: a relived round changes no record and no statistic.

**Statistik's example:** its sixteen rounds can be watched too
(`?aterupplev=exempel-<id>`, from a round's card when the example is shown).
Their shots have a club and a length but no place, so `exampleRound` lays each
hole onto the real course:
- from the real tee, each shot along the hole's own line, its length scaled to
  the hole's real length;
- a missed fairway goes to the side the card says;
- the last full shot finishes on the green near the pin: closer after one putt,
  a lag's length after two.

The example is rebuilt from the same catalog and seed Statistik drew it from, so
it plays the same every time. The screen says it is an example
("Exempel · Återupplev").

## Checks

- **Unit tests:** `pnpm exec vitest run apps/golf/src/play`. They cover:
  - the flight's calibration, the bounce and roll by surface, the cup, putting
    break, trees, water and out of bounds;
  - the recorded sound events and plugged lies;
  - the bag mapping and planned power;
  - the rules and the card's storage;
  - the relive model, including the frame conversion;
  - `shot-setup.test.mjs`: tempo, the timed drag and stick, the controller's
    reading, shot types and swings, shaping that lands on the aim, height, chips
    and flops, the caddie, the lie %, slopes, plugged sand, putts' rise, the
    flyover's path and the green's arrows;
  - `conditions.test.mjs`: wet, firm and snowy ground, the air's temperature,
    today's putt meter, gusts, the hole map's frame, handicap strokes,
    Stableford points and the round's figures.
- **The start menu:** `tools/check-chooser-ui.mjs` now expects five cards
  (Detaljerad 3D, Lätt 3D, Spela, Statistik, Inställningar), all whole on screen
  at every size it tests. On a phone the hero's numbers give way, and the lead
  gives way when Fortsätt stands in its place.
- **Launch links:** `shell/settings-store.test.mjs` pins the Spela link.
- **In the course, on the owner's GPU:** the harnesses in
  `output/golfer-build/play-check` (local, ignored) drove whole holes on Puttom:
  - with both golfers, a drive, an approach, a chip and putts, holed and scored;
  - a pulled 3-wood into Puttom 3's lake, shown with its penalty and drop;
  - the drag swing and the tap meter on a 390 × 844 phone;
  - Återupplev of a recorded two-hole round, with no console errors.

  For the other modes' features and the screen (`modes.mjs`, `tour.mjs` at
  1440 × 900 and 390 × 844, `example.mjs`):
  - the lights from the menu (Oväder's wet turf, Vinter's snow and orange ball);
  - the course guide in the flyover and the scorebug;
  - the hole map with a tapped target;
  - the green view and the free view;
  - the clean view;
  - every state of the screen on both sizes;
  - the hole card with points.

  For the tour-game layer (`feel.mjs`, `padphone.mjs`, `tapchip.mjs`,
  `holeout.mjs`):
  - the flyover, the setup panel, a drawn drive at a 3 : 1 tempo, the stats
    card, the replay and the green's read on Puttom 1;
  - a stubbed standard controller on a phone: A skipped the flyover, RB and the
    D-pad set up the shot, and the stick swung;
  - a tap-meter putt;
  - a hole holed for par, then its holing putt replayed from the card;
  - Statistik's example round in Återupplev with the new tracer.

  None had a console error.
- **The card art:** `node tools/make-play-art.mjs <server>` re-shoots it.

## Still open

- **Phase 3:** a ghost of the best round, challenges and shared cards.
- **Not yet built:** wind gusts; a tempo guide on the pad; and an animation per
  shot type beyond the chip swing (a flop's open stance, a punch's held finish).
- **Sound:** has been heard only through the code; its levels want the owner's
  ears.
- **A physical controller:** only a stubbed one has been tried.
- **A real phone:** its frame rate in a game has not been measured. Only an
  emulated phone was used.
- **Re-tuning:** the game's feel (swing sensitivity, the camera's timing) has
  not been tried by the owner. Tune it from their first round.
