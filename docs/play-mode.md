# Spela and Återupplev (8 November)

The owner asked for a game mode in which the courses are played the way a golf
video game plays them. They also asked for a mode that replays the real rounds
recorded with the map's club wheel: the same shots and clubs, on the detailed
course. Their plan had three phases:

1. One hole playable end to end: physics, putting, swing and scoring.
2. Feel: sound, the ball's trace, replays, the celebration and difficulty levels.
3. Social: a ghost of your best round, challenges and shared cards.

Phase 1 is built, and so is Återupplev. Some of phase 2 came with it: the
ball's trace, the celebration after a par or better, and three difficulty levels.

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
  club is mapped to a launch family by its id, its name or, failing both, its carry.
- **The lie:** takes speed, spin and accuracy off the shot. Out of the rough the
  ball comes slower and with less spin, forest and sand cost more, and a path
  is slightly hard.
- **Planned power:** each shot's planned power is the share of a full swing that
  reaches the target, found by bisection over flat shots. The swing pad shows it
  as an amber line to pull to, and the aid's preview uses it.
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
  follows the pull.
- **Tryck** (the accessible one, and Space): tap to start the meter, tap again
  to set the power, then tap a third time as the marker passes the line. Nothing
  needs a steady drag.
- **Aiming:** drag on the course, or press ← and →. Shift turns 0.2° at a time.
- **Other keys:** ↑ and ↓ change the club, O is the overview, Esc is the menu.
  Space or a tap speeds up a flight four times and skips a pause.
- While a game is on, the course's own shortcuts stay out of it.

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

- **Unit tests:** `pnpm exec vitest run apps/golf/src/play`. They cover the
  flight's calibration, the bounce and roll by surface, the cup, putting break,
  trees, water and out of bounds; the bag mapping and planned power; the rules
  and the card's storage; and the relive model, including the frame conversion.
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
- **The card art:** `node tools/make-play-art.mjs <server>` re-shoots it.

## Still open

- **Phase 2:** sound, replays and a thicker tracer. The trace is a one-pixel
  line, and the ball has a halo.
- **Phase 3:** a ghost of the best round, challenges and shared cards.
- **The real rough's lie:** sitting down or sitting up. Wind gusts.
- **A real phone:** its frame rate in a game has not been measured. Only an
  emulated phone was used.
- **Re-tuning:** the game's feel (swing sensitivity, the camera's timing) has
  not been tried by the owner. Tune it from their first round.
