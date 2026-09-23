# Shot tracking, scoring and analytics on the phone — plan, 2026-09-23

*Status: draft — the audit, design and milestones are written; the research sections are marked pending.*

The owner's brief, in their words: *"before taking a shot, the user selects their
club, and upon reaching the ball, they select their next club. This will allow us
to record the club used, GPS coordinates, shot distance, and overall statistics,
while automatically calculating the score for each hole. The UI and UX for this
entry must be best-in-class — requiring minimal effort and absolutely zero
interruption to the user's game. Tracking edge cases like out-of-bounds,
mulligans, and drops must also be highly intuitive."* Then: automate as much as a
phone alone allows (pocket, bag), predict clubs, and turn the data into club
distances, aim, performance, trends and suggestions — on the phone during the
round and on an identical desktop dashboard afterwards.

This document is the audit, the research and the plan. Section 1 says what the
code already has; section 2 what the market and the platform allow (web research
of 23 September 2026, sources at the end); sections 3–10 are the design; section
11 the milestones with the gates that decide when each is done; section 12 the
decisions only the owner can make.

> **Pending:** the one-page summary — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- RESEARCH_SUMMARY -->

---

## 1. Audit — what Banvy already has for this

**Shipped today (2026-09-23): GPS follows the round and the course.** Turning GPS
on anywhere picks the course and the hole the player stands on and moves with
them: the next hole once their green is done and they head for its tee, other
holes only on 90 s of evidence, a hand-picked hole held until they walk 40 m
(`apps/golf/src/engine/gps-round.mjs`, thresholds set by walking simulated rounds
through all thirteen courses' real geometry, `gps-round.test.mjs`). The manifest
carries every course's hole lines (`gps` record, derived from each pack), so a
fix finds its course before any pack is fetched, and a course switch carries GPS
mode across the navigation as a one-shot handoff (`shell/gps-handoff.js`). The
chooser has "Hitta min bana". **This is the hole context every shot needs**: a
shot record without a reliable hole number is worthless, and the round tracker is
now the part that supplies it without a tap.

What the shot-tracking work can stand on, with where it lives:

| Asset | Where | What it gives shot tracking |
|---|---|---|
| Live GPS with accuracy, follow camera, stop control | `main.js` live GPS section | positions at ±accuracy, the watch, the status pill |
| Round-aware hole tracker, course locator | `engine/gps-round.mjs` | hole number per fix, hole-change events (= hole finished) |
| WGS84 → course frame, exact per pack | `engine/caddie.js` `gpsToLocal` | every shot in the same metres as the 3D scene |
| Terrain height everywhere (1 m laser on the v2 grounds) | `terrainH` in `main.js` | elevation change per shot → flat-equivalent distances, stance slope |
| Surface class at any point: fairway, semi, fringe, green, tee, sand, path, forest, heath, wetland, rock… | `engine/surface.js`, `classify`, `kikLie` | the lie of every shot for free → FIR, GIR, sand saves, strokes-gained lie categories |
| Water rings with measured levels (all 13 courses), penalty/OB stakes (Ängsö 17 runs, Veckefjärden 66, Johannesberg 5, Lidingö 3 OB) | pack `water`, `marking`, `outOfBounds` | penalty suggestions when a ball ends in water or near OB |
| Card: par, stroke index, every tee's length | pack `holes[].par/idx/t` | score to par, Stableford with a playing handicap |
| Bag of up to 14 clubs with carries, club recommendation (long misses weighted 1.3×) | `engine/caddie.js` `recommendClub`, bag dialog | the club list and the prior for predictions |
| Plays-like: slope 1 m/m, wind 2.24 %/m s⁻¹ head, 1.12 % tail, 0.135 %/°C, capped at 25 % | `engine/rangefinder.js`, `engine/weather.js` (Open-Meteo, 30 min cache) | the target distance the suggested club must cover; weather per shot |
| Kikaren sheet, green stack, floating tag, mobile HUD | `#kikOut`, `#kikGreen`, `#kikTag` | the one-row resting sheet the shot rail belongs in |
| Strategy layer: landing zones from the club's guide ("max 200 meter") | `strategyForHole` | the intended target of a tee shot → aim/miss statistics |
| Offline PWA: shell precached, packs cache-first, manifest network-first | `vite.config.js`, `_headers` | a round works with no signal |
| Gates culture: unit tests, simulated rounds, browser gates with scripted geolocation | `tools/check-gps-round.mjs`, `tools/check-caddie-ui.mjs` | how every step below gets proved |

What is **missing**, and what the audit found in passing:

- **No round, shot or score model** anywhere; the bag and three preferences are the
  only user data, all in `localStorage`. No IndexedDB, no export, no account, no sync.
- **No wake lock, no haptics, no motion sensors, no stop detection.** GPS runs only
  while the page is visible, and nothing keeps it visible.
- **GPS mode ended on any geolocation error** — one "position unavailable" under
  trees switched it off for the rest of the round. Fixed today (only a refusal ends
  it now); found by the new browser gate.
- **The HUD has one bottom row to spend.** `check-caddie-ui` pins the Kikaren sheet
  to the bottom 40 % above the quick actions, 390 px wide, with nothing
  overlapping. The shot rail must live in that row, not beside it.
- **Handicap is Min Golf's** (the blueprint's decision): compute gross, net and
  Stableford for display from a playing handicap the player enters; link out to
  register the round; never re-implement WHS.
- Fairways are carried per hole (`holes[].fairway.rings`, on every course that has
  par 4s) *and* in the surface classifier. "Fairway hit" should be the rest point
  inside THIS hole's rings: the classifier alone says "fairway", not whose, and a
  drive onto the neighbouring hole's fairway is a miss.

---

## 2. Research — the market, the platform, the rules

> **Pending:** competitors, web-platform limits, analytics methodology and rules — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- RESEARCH_SECTIONS -->

---

## 3. What "best in class" means here — the principles

1. **One tap per shot, and it is the tap the golfer would make anyway** — the club.
   Distance, lie, hole, score and statistics are consequences, never questions.
2. **Nothing modal while playing.** No dialog, no confirmation, no required field.
   Every correction is available and none is demanded; the round is always
   reviewable afterwards.
3. **Predict, then get out of the way.** The likely club is already under the
   thumb; a penalty the course data makes likely is offered as a pre-selected chip
   that disappears if the golfer plays on.
4. **Glove-sized and thumb-reachable.** Targets ≥ 48 px, the rail in the bottom
   quarter, readable in sun (contrast), usable one-handed.
5. **Honest numbers.** Penalties, mulligans, partial and chip shots never pollute a
   club's distance; every average shows its sample size; a statistic with too few
   shots says so.
6. **Offline and local-first.** A round is complete on the phone with no signal;
   sync is later and never loses a shot.
7. **Privacy by design.** Store shot points, not a continuous track, unless the
   golfer switches a recorder on; everything exportable and deletable.
8. **Measured.** Every automatic rule is tuned on simulated rounds and then on
   recorded field traces, and gated like the rest of this repo.

---

## 4. The on-course experience

### 4.1 States

| State | What shows | How you get there |
|---|---|---|
| GPS off | The course as today | — |
| GPS on, no round | Kikaren from your position; the shot rail offers "Slå första slaget" with the predicted club | GPS-läge / Hitta min bana |
| Round on | The shot rail, the running score in the sheet head ("+2 efter 6") | the first club tap starts it; nothing else to set up |
| Pocket mode | A black, touch-locked screen with the hole and the distance to the green in large dim type; GPS and detectors run | "Fickläge" on the sheet — one tap, remembered for the round (the web has no proximity sensor to switch it on by itself) |
| Review | The hole or the round as a timeline of shots drawn on the 3D hole | tap the score, or at the round's end |

A round needs no setup screen. It starts on the first shot with the course, the tee
on screen (yellow by default), the date, and the format the golfer last used.
Playing handicap and format live in the sheet's body for whoever wants them.

### 4.2 The shot rail — one tap per shot

In GPS mode the Kikaren sheet's resting row becomes the rail:

```
┌───────────────────────────────────────────────────────────────┐
│ Slag 2 · 152 m kvar (spelas 158)                              │
│  [ Järn 5 ]   [■ Järn 6 ■]   [ Järn 7 ]   [ ⋯ ]                │
└───────────────────────────────────────────────────────────────┘
```

- **It replaces a card that is already there.** Measured in GPS mode on a 390×844
  phone (Ängsö, 5th tee): the sheet's head sits at 607 px with the plays-like line
  and a club card ("Driver · 210 m carry · Green är utom räckhåll… · Ändra") under
  it, the quick actions at 747–788 px and the hole strip at 792–836 px. The layout
  gate lets the sheet start as high as 506 px, so a 48 px chip row in place of the
  passive card fits with room to spare — the rail turns the recommendation the
  golfer already sees into the action they take.
- **The middle chip is the prediction** (section 7.4), flanked by the next longer and
  shorter club; `⋯` opens the whole bag as a grid. Three chips cover the choice most
  of the time; the whole bag is one more tap.
- **Tapping a club means "I am hitting this, from here".** The position is the
  average of the fixes of the last few seconds while standing still (7.1); the lie
  is read from the surface under it; the chip confirms with a tick (and a 10 ms
  vibration on Android) and becomes the shot chip: `Slag 2 · Järn 6 ✓ · ångra` for
  five seconds, then `Järn 6 · 148 m →`, the live distance growing as the golfer
  walks to the ball.
- **The next tap ends the previous shot.** Its distance is frozen from where it was
  hit to where the next is hit. That is the owner's workflow, and it needs no "I
  am at my ball" step because choosing the next club *is* that step.
- **Forgot to tap?** The stop detector (7.3) saw the golfer stand still at the ball.
  A shot tapped at the next ball finds the unlogged stop between and inserts it as
  a ghost shot with the predicted club (`Järn 7?`), confirmed in review or on its
  own when the golfer does nothing. A forgotten tap costs a question later, never a
  wrong distance now.

### 4.3 On the green — one tap for all the putts

When the fix is on the green (inside the ring plus the collar), the rail becomes:

```
│ På green · 8 m till mitten                                    │
│  [ 1 putt ]  [■ 2 puttar ■]  [ 3 ]  [ 4+ ]  [ I hål ]          │
```

- One tap records the putts **and finishes the hole**: the score appears in the
  sheet head (`Hål 5 · 4 slag · par`), the hole's shots are complete.
- `I hål` is a chip-in or a holed shot from off the green (0 putts).
- The approach shot ends where the golfer first **stopped on the green** (the ball),
  not where they walked on and not at the hole — the stop detector gives that
  point; without a stop, the tap position.
- Walking off to the next tee without tapping is allowed: the round tracker moves
  on, and the next tee's rail starts with one question chip, `Puttar på 5:an? 1 · 2 · 3`,
  which disappears when the next club is tapped (the hole stays open for review).

### 4.4 Penalties, drops, mulligans, provisional balls

Every correction is on the **last shot's chip** — tap it and the row turns into:

```
│ Slag 2 · Järn 6 · 148 m                                         │
│ [OB · slå om +1] [OB · droppa +2] [Vatten +1] [Ospelbar +1]      │
│ [Mulligan] [Provisorisk] [Byt klubba] [Ta bort]                  │
```

| Situation | Rule (2023) | One tap | Counting | Club statistics |
|---|---|---|---|---|
| Out of bounds / lost, replay | Rule 18.1 stroke and distance | `OB · slå om +1` | +1; the next shot starts where the golfer next taps (back at the spot) | shot excluded |
| Out of bounds / lost, local rule | Model Local Rule E-5 | `OB · droppa +2` | +2; next shot from the drop | excluded |
| Penalty area (red/yellow) | Rule 17 | `Vatten +1` | +1; next shot from the drop | excluded (the ball's rest point is unknown) |
| Unplayable | Rule 19 | `Ospelbar +1` | +1 | the shot's own distance kept, it ended where it ended |
| Provisional | Rule 18.3 | `Provisorisk` | both balls kept until "Hittade du bollen? Ja / Nej" (the only question, asked once, after the hole) | the lost one excluded |
| Mulligan | not in the Rules (casual) | `Mulligan` | the shot does not count | excluded |
| Free relief (cart path, GUR) | Rule 16 | nothing | the next shot simply starts at the drop | unaffected |

Three things make this *intuitive* rather than a menu:

- **The course suggests the penalty.** If the next tap is within 10 m of the
  previous shot's spot, the rail asks the one thing that is ambiguous —
  `Slår om? OB/borta +1 · Mulligan · Provisorisk` — pre-selecting OB. If the ball's
  path from the last spot runs into a water ring and the golfer's next tap is within
  15 m of that ring's edge, `Vatten +1?` is pre-selected; near a white OB line,
  `OB · droppa +2?`. Each chip vanishes when the golfer plays on without it.
- **Drops need nothing.** The next shot starts where the golfer taps; a drop is just
  a new position. The penalty stroke is the only thing to record.
- **Mulligans are a round setting** ("Mulligans tillåtna"), off by default, so the
  chip is not in the way of anyone playing by the Rules.

### 4.5 Pocket and bag

Section 2 says the limit plainly: a web page gets **no GPS while it is hidden or
the screen is locked**. So pocket mode keeps the page visible and costs as little
as a lit screen can:

- **Fickläge**: a full-black overlay (OLED pixels off), the Screen Wake Lock held,
  every touch swallowed except a deliberate long press on a lock glyph; the hole
  number and the distance to the green in large dim type for a glance.
- GPS and the stop detector keep running; with permission, the motion detector
  (7.5) listens for swings. Each stop with a swing becomes a shot with the predicted
  club; each stop without one is kept only if the golfer walked 30 m+ afterwards.
- **Taking the phone out is the review**: the rail shows `2 slag registrerade · Järn 7
  142 m · Wedge 64 m — stämmer?` with each club editable by one tap.
- **In the bag on a trolley**, stops are the trolley's, parked a few metres from the
  ball; distances from bag-mode rounds are tagged lower-confidence and weighted down
  in club statistics.
- Honest battery: section 2's numbers; the round screen tells the golfer the drain
  per hole after two holes.

### 4.6 The scorecard and formats

- Per hole: strokes, putts, penalties, fairway (tee shot finishing on fairway on
  par 4/5), green in regulation, sand save, up-and-down — all derived.
- Formats: **Slag** (gross, to par), **Netto** and **Poäng** (Stableford) from a
  playing handicap the golfer enters once ("Spelhandicap", from Min Golf); strokes
  received by stroke index; net double bogey shown as the handicap-counting score.
  Match play and friends' cards are milestone 6.
- The round ends itself after the last hole's putts, or after 8 h idle; "Avsluta
  runda" in the sheet body. A link to register the round in Min Golf.

### 4.7 Review — the round on the real ground

Every hole replays as its shots drawn on the 3D terrain: arcs from spot to spot in
the club's colour, penalties marked, the ghost shots dashed. Dragging a shot's end
point corrects it (snapped to the surface the golfer drops it on), a tap changes the
club. The round recap can fly the shots as the broadcast flyover the blueprint plans
(Tier 2) — the one thing no caddie app can show, because none has the ground.

---

## 5. Data model — an event log, folded into a round

The source of truth is an **append-only log of events per round**; the round, its
scores and every statistic are a fold of it. That makes undo trivial (an `undo`
event), makes sync a set union of event IDs (7.8), and keeps every correction
auditable.

```json
{
  "round": "01J8Z5W3Q4…", "v": 1,
  "course": { "slug": "puttom", "pack": "2e07d11db74e…", "tee": { "index": 1, "name": "Gul" } },
  "format": { "kind": "stroke", "playingHandicap": 18, "mulligans": false },
  "events": [
    { "id": "01J8Z5W4…", "t": 1727078531000, "type": "shot", "hole": 1, "club": "driver",
      "at": { "lat": 63.29870, "lon": 18.93960, "acc": 4, "x": -78.6, "z": -251.5, "y": 61.2, "lie": "tee", "fixes": 5 },
      "source": "tap" },
    { "id": "01J8Z5X9…", "t": 1727078702000, "type": "shot", "hole": 1, "club": "iron-7",
      "at": { "…": "…", "lie": "fairway" }, "source": "tap", "suggested": "iron-7" },
    { "id": "01J8Z60A…", "t": 1727078790000, "type": "penalty", "hole": 1, "after": "01J8Z5X9…", "kind": "water", "strokes": 1 },
    { "id": "01J8Z61B…", "t": 1727078903000, "type": "green", "hole": 1, "at": { "…": "…" }, "source": "stop" },
    { "id": "01J8Z62C…", "t": 1727079011000, "type": "putts", "hole": 1, "n": 2 },
    { "id": "01J8Z63D…", "t": 1727079020000, "type": "undo", "target": "01J8Z60A…" }
  ]
}
```

- **IDs are UUIDv7** (RFC 9562; ULIDs in the sketch above are the same idea)
  generated on the device: sortable by time, unique across devices, so records made
  offline on two phones never collide and sync needs no CRDT (section 9).
- **Positions keep both frames**: WGS84 (what GPS said, for sync and re-projection,
  rounded to 5 decimals ≈ 1 m — finer is noise and more personal data than the
  statistics need) and the course's local x/z/y (what the scene and the statistics
  use), plus the accuracy and how many fixes were averaged.
- **Nothing is ever hard-deleted in the log**: an `undo` or a deleted shot is a
  tombstone event, because an offline device that never sees a delete would
  resurrect the record on its next sync.
- **Derived, never stored**: distance, score, FIR/GIR, strokes gained. A better rule
  later re-computes every old round.
- **Continuous tracks are opt-in** (the field recorder, 7.6), stored separately and
  deletable on their own.
- Storage: IndexedDB (one store for events keyed by round, one for folded round
  summaries), `navigator.storage.persist()` requested at the first round, JSON
  export/import of any round or everything.

---

## 6. The engines — pure modules with tests, like `gps-round.mjs`

| Module | Does | Tested by |
|---|---|---|
| `engine/round.mjs` | fold events → holes, shots with from/to, penalties, putts, score, formats | unit tests for every rule in 4.4, property tests (undo of any event restores the fold) |
| `engine/shot-geometry.mjs` | shot distance, flat-equivalent distance (elevation), lateral miss vs target line, lie at rest | fixtures on real packs |
| `engine/stops.mjs` | GPS stop/walk segmentation, ball-position candidates | the simulated rounds of `gps-round.test.mjs` extended, then field traces |
| `engine/swing-detect.mjs` | IMU swing events from `devicemotion` features | synthetic traces, then recorded ones |
| `engine/club-model.mjs` | per-club distance distributions, predictions, suggestions | synthetic histories, calibration checks |
| `engine/strokes-gained.mjs` | expected strokes by lie and distance, SG per shot and category | published baseline checks |
| `engine/insights.mjs` | the sentences on the dashboard | fixture rounds → expected insights |

## 7. Algorithms

### 7.1 A position worth recording

A single fix is ±3–8 m and its error drifts over seconds, so a tap never takes
the last fix alone:

- take the fixes of the last 10 s with accuracy ≤ 20 m whose spread is ≤ 6 m (the
  golfer is standing); the shot position is their accuracy-weighted mean
  (weights 1/acc²), recorded with how many fixes it took and an uncertainty floored
  at half the best accuracy (GPS error is correlated; √n is too optimistic);
- tapped while walking (speed > 1 m/s over 5 s): the position is **provisional**
  and is replaced by the next stop within 60 s and 40 m — the golfer tapped on the
  way up to the ball;
- nothing better than ±20 m: the shot is recorded, its distance flagged
  low-confidence and kept out of club statistics until corrected in review.

### 7.2 Shot geometry — distance that means the same thing everywhere

- **Distance**: horizontal |to − from| in the course frame (exact per pack, the same
  metres as the scene).
- **Elevation**: dh from the terrain (1 m laser on every v2 ground).
- **Flat-equivalent distance** = distance + dh (the same one-metre-per-metre rule
  plays-like already uses), then taken back to 21 °C and still air with the
  weather reading of that minute (`rangefinder.js` coefficients). A 7-iron that
  went 135 m up a 10 m slope into a 4 m/s wind is a 7-iron that goes about 157 m on
  a flat, calm day, and that is the number the bag should learn. **No caddie app has
  the ground to do this**; it is Banvy's first unfair advantage in statistics.
- **Aim**: the intended line is from the shot's origin to its target — the strategy
  landing point for a tee shot on a par 4/5 (the hålguide's "max 200 m" included),
  the green centre (or pin) for an approach. The miss is split into *lateral*
  (signed, right positive — with the right-hand normal `(-cos b, sin b)` of
  `alongLine`'s angle, CLAUDE.md's standing trap) and *long/short*.
- **Lie at rest**: the surface class under the next shot's origin; the lie of the
  shot itself is the class under its own origin.

### 7.3 Stops — where the ball was, without a tap

- A **stop**: over a sliding 16 s window, at least 80 % of the fixes lie within 8 m
  of the window's median AND the medians of its first and second halves are under
  5 m apart; consecutive still windows whose medians are within 12 m extend one stop;
  stops shorter than 16 s are dropped, and stops 30 s apart within 12 m merge.
- A stop is a **ball candidate** when it is within 80 m of the current hole's
  corridor, is not the tee, lasts under 10 minutes, and is followed by a walk of
  25 m or more. Of several stops around one ball, the last before the walk-off wins
  (golfers circle the ball).
- On the green, the **first stop inside the green zone** after the last full shot is
  the approach's rest point.
- **Measured before planning on it.** `tools/sim-stop-detector.mjs` runs exactly
  this rule over 52 simulated rounds (the thirteen courses × 4, walked at 1.3 m/s
  with a fix every 2 s, one shot in seven missed by 35 m, 40 s at each ball):

  | GPS error model | tee/ball/green positions recovered (within 8 m) | position error, median / p90 | other stops per hole |
  |---|---|---|---|
  | 4 m, white | 94.3 % | 1.6 m / 3.2 m | 0.55 |
  | 4 m, drifting (10 s memory, like a phone) | 99.0 % | 2.7 m / 5.1 m | 1.74 |
  | drifting + the group waiting mid-walk on 30 % of shots | 99.4 % | 2.7 m / 5.0 m | 2.13 (0.32 of them the waits) |

  Two lessons came out of it. The first version ("every fix within 7 m") found
  38 % of the stops under white noise and split long ones under drift; and without
  the half-window displacement test, a golfer *walking* at 1.3 m/s looked still to a
  16 s window three times per hole. The second lesson is the design rule: **a stop
  is never a shot on its own.** A wait for the group ahead is a perfect stop. It
  becomes a shot only with a tap, a swing (7.5), or the golfer's one-tap
  confirmation — and the ~2 extra stops per hole are why.

### 7.4 Club prediction — the golfer's own numbers, not a table

- Per club, from the golfer's own full shots (flat-equivalent distances): centre
  m = median, spread s = 1.4826·MAD (floored at 5 % of m), n shots. Blended with
  the bag's carry as a prior until the club has history:
  m̂ = (n·m + k·carry)/(n + k), k = 3.
- Target d* = the plays-like distance to the target the strategy layer already
  computes (the green or pin for an approach; the hålguide's landing distance or the
  layup for a tee shot). Lie factors from rough, sand and recovery start as priors
  (0.92, 0.85, 0.70) and are re-fitted per golfer once they have shots from those
  lies.
- Score per club: P(c) ∝ exp(−(d* − f_lie·m̂_c)² / 2ŝ_c²) × habit(c | situation), where
  *habit* is the smoothed share of this golfer choosing c in the same situation (tee
  of a par 4/5, approach band, lie) — which is how it learns that someone always
  lays up with a 3-wood on a tight par 4.
- The middle chip is the top club, its neighbours by distance either side. Every tap
  stores what was suggested, so the model has its own metric — agreement with the
  golfer's choice — targeted at ≥ 70 % after five rounds, and shown in the dashboard
  so a bad model is visible.

### 7.5 Swings from the phone's motion sensors (beta)

> **Pending:** swing detection from motion sensors — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- SWING -->

### 7.6 The field recorder — the data every automatic rule is tuned on

An opt-in **"Spela in rådata"** in pocket mode records every GPS fix (lat, lon,
accuracy, speed, heading, time), motion features at 10 Hz (peak angular speed and
peak acceleration per 100 ms) and every tap, exported as one JSON file per round.
The owner plays rounds with it; the traces become fixtures in the test suite with
the taps as ground truth. **Nothing tuned on simulations alone ships as automatic**
— the same rule this repo holds for pixels ("if the reference cannot reproduce
itself, nothing measured against it means anything").

### 7.7 Strokes gained

> **Pending:** strokes-gained baselines — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- SG -->

---

## 8. Analytics and the dashboard

One responsive view, the same code on phone and desktop (a `?statistik` view of
the app, reachable from the chooser and the in-game menu), in four tabs:

- **Rundor** — every round with score, to par, putts, FIR, GIR, penalties; tap for
  the scorecard and the 3D replay (4.7).
- **Klubbor** — per club: median distance (flat-equivalent and as measured), the
  25–75 % range, longest, sample size, lateral miss (mean and spread, left/right
  share), a dispersion ellipse drawn on a neutral range; the bag's carry beside the
  measured one with **"Uppdatera bagen"** when they differ by more than the spread.
- **Spel** — strokes gained by category (off the tee, approach, around the green,
  putting) against a chosen baseline (scratch / hcp 10 / hcp 20), scoring by par
  type, penalty sources, putts by first-putt distance, per-hole history on each
  course ("Hål 7: höger i 4 av 5 rundor — vatten där").
- **Trender** — rolling 5-round averages of the above, with the sample shown.

**Insights** are rules over those numbers, each with a threshold and a minimum sample,
written as one sentence and one suggestion: *"Din järn 7 går 138 m (18 slag) — bagen
säger 145. Uppdatera?"*, *"Tre av fyra driver-missar går höger; sikta på vänster
fairwaykant på hål 3 och 11"*, *"Du förlorar 1,4 slag per runda på inspel 100–150 m
jämfört med hcp 10"*. Every insight links to the shots behind it.

The desktop is not a second product: it is the same view with room for two columns
and the 3D replay beside the table. "Identical" is a property of one codebase,
checked by the browser gate at 1440 px and 390 px.

---

## 9. Sync, accounts and privacy

### 9.1 First: the app needs its own origin

**Every GitHub Pages project on `olovmelander.github.io` shares one browser origin
— and therefore one IndexedDB and one localStorage** — with every other project
page served from that user site. GitHub has said it has no plans to change this.
Today that is harmless (a bag and three preferences); with people's rounds and
positions in storage it is not. A custom domain (Cloudflare, which the repo's
`_headers` and `_redirects` already target, or any registrar) is the first task of
M5 and a precondition for storing shots under anything but a developer's own use.
It also gives passkeys a clean relying-party ID (`github.io` is a public suffix, so
the RP ID would otherwise be `olovmelander.github.io`).

### 9.2 The data model is the sync design

Because every shot and correction is an **immutable event with a device-generated
UUIDv7**, two devices can never write the same record, so sync is:

- the phone keeps an **outbox** of unsent events in IndexedDB and pushes them as
  idempotent upserts whenever it is online and the app is open (Background Sync
  exists only in Chromium; on iOS, sync runs on open and on coming back online);
- each device **pulls** events newer than its last checkpoint (a server-set
  `updated_at`), and folds;
- **the same round edited on two devices** merges as a union of events; the few
  mutable round fields (format, playing handicap, notes) are per-field
  last-writer-wins with history kept; derived numbers (club distances, strokes
  gained) are recomputed on each device, never synced;
- the desktop shows "väntar på telefonen" for a round whose phone has not synced.

No CRDT library is needed for this shape (Automerge and Yjs earn their keep only for
live multi-player scorecards, milestone 7 at the earliest), and several "sync
engines" do not fit it: Zero 1.0 rejects writes while offline, Replicache is in
maintenance, ElectricSQL syncs reads only. RxDB's free Supabase replicator or
PowerSync are the options if the hand-written outbox ever becomes the bottleneck.

### 9.3 Backend options (researched 23 September 2026)

| Option | Start → scale cost | EU residency and DPA | Fit here |
|---|---|---|---|
| **Supabase**, `eu-north-1` (Stockholm) | $0 (500 MB, 50k MAU; pauses after a week idle) → Pro $25/mo | Stockholm region; DPA with SCCs, accepted with the terms | **Recommended**: Postgres with row-level security (`user_id = auth.uid()`), email-code auth; no offline layer — ours is the outbox |
| Supabase + PowerSync | + $49/mo | as above | the upgrade path if sync grows complex |
| Cloudflare Workers + D1 (`jurisdiction eu`) | $0 → $5/mo | EU jurisdiction; DPA by default | cheapest at scale, but auth is ours to build |
| PocketBase on an EU VPS | ~€5.5/mo + operations | fully ours | simplest self-hosted; we run backups and upgrades |
| Firebase / Firestore | $0 → pay as you go | Firestore in Stockholm, but **Firebase Auth runs only in US data centres** | best built-in offline cache, weaker residency story |
| Google Drive `appDataFolder` | $0 (the user's own 15 GB) | data never touches us | attractive "use my own cloud" option, but browser tokens expire hourly with no refresh and need a tap — poor in an iOS home-screen app |
| Dexie Cloud | $0 → €0.12/user/month | hosted in Azure US East (EU needs a €3,495 self-host licence) | prototype only |
| Appwrite Cloud | $0 → $25/mo | Frankfurt | pauses after 7 days without console activity — hostile to a hobby-scale live app |

Volume, estimated: ~90 shots × ~250 bytes ≈ 25 KB per round, so 1,000 golfers ×
40 rounds is about 1 GB a year — past Supabase's free tier within a season at that
scale, comfortably inside Pro.

### 9.4 Accounts

- **Six-digit email codes, not magic links.** On iOS a home-screen app's storage is
  separate from Safari's, so a link tapped in Mail signs the golfer in to Safari,
  not to the app. Supabase supports codes (`{{ .Token }}` in the template) and needs
  our own SMTP beyond two emails an hour.
- OAuth popups fail in iOS standalone mode; any Google/Apple sign-in uses redirects.
  Sign in with Apple on the web needs the $99/yr developer programme and a secret
  rotated every six months. Passkeys work on iOS 16+ but are beta in Supabase
  (May 2026): a later addition, not the first.
- `navigator.storage.persist()` at the first round (Safari 17+); an installed
  home-screen app is exempt from Safari's 7-day deletion of site data, but deleting
  the app still loses anything unsynced — the round screen says so until the first
  sync.

### 9.5 Privacy (GDPR, Sweden) — designed in, not added on

- **Shot coordinates are personal data** (GDPR Art. 4(1) names location data; the
  EDPB calls it notoriously hard to anonymise). Not a special category, but "highly
  personal" in the DPIA guidelines.
- **Lawful basis**: storing and syncing a golfer's own rounds is *contract* (Art.
  6(1)(b)) — it is the service they asked for. The OS location prompt is not GDPR
  consent. Anything beyond that — analytics, sharing, using golfers' shots to improve
  course maps — needs its own consent or a documented legitimate-interest test.
- **No cookie banner for the app's own storage**: LEK 9 kap. 28 § exempts storage
  necessary for a service the user explicitly asked for; analytics storage would not
  be exempt.
- **Minimise by construction**: a position is stored only on a shot tap or a
  confirmed stop, only inside the course, at ~1 m precision; no background track
  unless the field recorder is on; "Ta bort GPS från gamla rundor" keeps the
  statistics and drops the coordinates.
- **Rights**: one-tap export (JSON, CSV, GPX) for portability; account deletion
  cascades to every server row within a month; dormant accounts purged after a
  stated period (a Swedish peer keeps two years after the last round).
- **Processors**: accept each provider's DPA (IMY: Art. 28 needs one in writing),
  list sub-processors in the privacy notice, and write the short DPIA — a golf app
  likely meets one of IMY's nine criteria (location), two trigger a mandatory one,
  and the document is cheap either way.
- What peers disclose: Arccos stores precise GPS until deletion and may store data
  in the US; Hole19 promises access within a month and deletion within 30 days;
  Caddee keeps location only as long as needed and shares it de-identified; OnTag
  processes in the EU/EEA. EU-only processing is a differentiator worth stating.

*(Analysis, not legal advice; prices and limits change often — Appwrite's changed
twice in 2026. Re-check at M5.)*

---

## 10. Platform strategy — what the web can do, and when to wrap it

> **Pending:** the platform capability matrix — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- PLATFORM -->

---

## 11. Milestones and gates

Each milestone ends in gates that fail loudly, in this repo's manner: unit tests
for the rules, a browser gate with scripted geolocation for the wiring, and — from
M2 on — recorded field rounds for anything automatic. Estimates are engineering
weeks for one person who knows the codebase.

| # | Milestone | Delivers | Done when (gates) | Est. |
|---|---|---|---|---|
| **M0** | **GPS follows the round** — *shipped 2026-09-23* | course + hole auto-selection, handoff, "Hitta min bana", GPS survives signal loss | `gps-round.test.mjs` simulated rounds on 13 courses; `check-gps-round.mjs` | done |
| **M1** | **Round core** | `engine/round.mjs` event fold; IndexedDB store; the shot rail (club tap, putts, last-shot chip: OB ×2, water, unplayable, mulligan, provisional, change club, delete, undo); score in the sheet head; hole and round end; scorecard; JSON export/import | unit tests for every row of the 4.4 table and every format; undo-restores-fold property test; `check-shot-rail.mjs`: a scripted 18-hole round by geolocation and taps produces the expected scorecard, zero dialogs, no overlap with `#kikGreen`/`#gpsStatus`/HUD at 390×844 and 1440×900, `check-caddie-ui` still green | 2–3 |
| **M2** | **Smart assist** | tap averaging and provisional positions (7.1); stop detector and ghost shots for forgotten taps (7.3); penalty suggestions from water rings, OB stakes and re-hits (4.4); club model v1 (7.4); Screen Wake Lock + Fickläge; battery readout; the field recorder (7.6) | simulated rounds with forgotten taps recover ≥ 95 % of shots within 5 m; suggestion-agreement metric computed on fixtures; pocket-mode touch lock proven by a gate that taps it; no regression in M1 gates | 2–3 |
| **M3** | **Statistics** | `?statistik` view (Rundor, Klubbor, Spel, Trender) on phone and desktop from one code path; flat-equivalent club distances and dispersion; strokes gained v1 with selectable baseline; insights v1; per-hole 3D replay of shots | fixture rounds → exact expected numbers; layout gates at 390 and 1440 px; the view makes no third-party request | 2–3 |
| **M4** | **Field validation** (runs alongside M2–M3) | the owner plays 3–5 rounds with the recorder and a laser rangefinder for spot checks | published in this document: distance error vs laser (target median ≤ 4 m), stop recall/precision, taps per hole, battery per round; detector thresholds re-fitted on the traces and the traces committed as fixtures | 1 + rounds |
| **M5** | **Accounts and sync** | a custom domain first (9.1); the chosen backend (section 12), event-log outbox sync (9.2), email-code accounts (9.4), the privacy notice, export (JSON/CSV/GPX) and delete-everything (9.5) | two-device merge tests (offline edits on both, then sync), delete-account test, EU residency verified, no location data leaves the device before consent | 2–4 |
| **M6** | **Automation beyond the browser** | motion swing detection (beta, 7.5) tuned on M4 traces; a Capacitor wrapper spike for background GPS and motion with the screen off; watch-companion feasibility | detection precision/recall on recorded traces at the targets set by M4; battery per round in background mode measured | 3–4 |
| **M7** | **Formats and people** | Stableford/net polish, match play, playing partners' cards (manual), round sharing (image/link), Min Golf link-out, pin-of-the-day input | format unit tests; share output checked | 2–3 |

**The metrics that define "best in class"**, measured from M4 on and kept in this
document: taps per hole ≤ strokes + 1; shots captured ≥ 99 % with taps and ≥ 85 %
in pocket mode; median distance error ≤ 4 m against a laser; zero wrong hole
switches per round and a new hole picked up at its tee in under 10 s; zero modal
dialogs during play; battery per 18 holes (target ≤ 25 % in foreground GPS mode
with the screen dimmed, to be measured, not assumed).

---

## 12. Decisions for the owner

None of these block M1–M3, which are local-first by design. They block M5–M7.

1. **Sync backend and accounts** — recommendation: **Supabase in Stockholm
   (`eu-north-1`) with a hand-written event outbox and six-digit email codes**,
   free to start and $25/mo once people depend on it; Cloudflare D1 if cost at scale
   matters more than building auth; a "use my own Google Drive" option later for
   those who want to hold their own data. Before any of it: **a custom domain**
   (9.1), because every github.io project page shares this app's storage.
2. **When to wrap the app natively.** A Capacitor shell is the only way to keep GPS
   and motion running with the screen off (section 10). It also means App Store and
   Play review, a developer account, and a second release pipeline. Recommendation:
   decide after M4, with the field numbers for battery and pocket-mode capture in
   hand — if foreground pocket mode captures ≥ 85 % of shots at acceptable battery,
   the wrapper can wait.
3. **Handicap scope.** Recommendation: keep the blueprint's line — gross, net and
   Stableford computed for display from a playing handicap the golfer enters, a
   link out to register the round in Min Golf, no WHS re-implementation.
4. **Business model.** Free on-course core (GPS, one-tap tracking, scorecard, club
   distances) and a paid tier for strokes gained, insights and multi-device sync is
   the market's shape (section 2); nothing in M1–M4 depends on the choice.
5. **Pins.** Strokes gained, putting and proximity are only as good as the hole
   position. A "flagga idag" drag-the-pin on the green (golfer) or a pin sheet
   (club portal) turns the green-centre approximation into a measurement; the
   blueprint already lists pins as the first thing a club would pay for.
6. **Mulligans and casual formats** — default off, one switch per round (4.4); say
   if the default should differ.

---

## Sources

> **Pending:** the source list — being completed from the web research of 23 September 2026 in the next revision of this file. <!-- SOURCES -->
