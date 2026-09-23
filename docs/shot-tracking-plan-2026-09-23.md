# Shot tracking, scoring and analytics on the phone — plan, 2026-09-23

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

## Summary — the plan on one page

**What we build.** In GPS mode the golfer taps the club they are about to hit; the
next tap, at the ball, ends that shot. Club, position, distance, lie, elevation and
score follow on their own. On the green one tap at the cup records the putts and
the pin and finishes the hole; each hole's score is confirmed with one tap, never
typed. Penalties are one tap on the last shot, rules-correct for OB (stroke and
distance, or the two-stroke E-5 drop), water, unplayable, provisional ball (with a
3-minute search timer) and mulligans (which the card then marks as not valid for
handicap). Nothing is modal; everything is correctable afterwards on the 3D hole.

**Why it can be the best.** The market (2.1) splits into sensor systems that are
effortless but cost €250–350 plus a subscription (Arccos, Shot Scope, Garmin) and
phone apps that either make the golfer mark every shot or guess from GPS and hand
them an editing job. **Every one is weak on penalties** — none documents E-5 or
mulligans. Banvy starts with things none of them has: 1 m laser terrain, measured
surfaces and water levels on thirteen real courses, and the GPS round tracker
shipped today. That makes lie, elevation, "in the water?" and "fairway hit?" facts
rather than questions.

**What a phone alone can and cannot do.** A web app gets GPS and motion only while
the screen is on and the page visible, on iOS and Android alike (10). So the
default is the owner's own workflow with the screen off between shots — wake at the
ball, tap, pocket — which is also the most battery-friendly design the web allows.
**Fickläge** (pocket mode: black, touch-locked, 3D paused, wake lock) adds
automation: GPS stops, which a prototype found at 94–99 % of ball positions, a
median of 1.6–2.7 m out (7.3), and later motion swings. A stop never becomes a
shot on its own, because a wait for the group ahead is a perfect stop. Hands-free
with the screen off needs a native wrapper or a watch: the plan decides that after
field data (M6).

**What the data becomes.** Club distances as GPS totals normalised to a flat, calm
21 °C, kept beside the bag's carry and never confused with it (7.4). Dispersion as
lateral and distance miss. Strokes gained against the published tour baseline and
labelled amateur approximations (7.7). FIR, GIR, scrambling, putting, penalties by
cause and per-hole history. Insights with their sample sizes. The same view on
phone and desktop (8).

**How it is built.** An event log per round (UUIDv7, append-only, tombstones) in
IndexedDB. Pure engines with tests, like `gps-round.mjs` (6). Sync later: the log
makes it an outbox, recommended on Supabase in Stockholm with email-code sign-in,
after a custom domain, because every github.io project page shares this app's
storage (9). Privacy is designed in: shot points rather than tracks, ~1 m
precision, export and delete.

**In what order** (11): M1 round core and the one-tap rail → M2 smart assist,
pocket mode and the field recorder → M3 the statistics view → M4 field validation
on real rounds → M5 accounts and sync → M6 motion and native → M7 formats and
people. **Six decisions are the owner's** (12): backend, when to go native,
handicap scope (link out to Min Golf; direct submission needs SGF's paid GIT
licence), business model, pins, mulligan default.

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

Four research passes on 23 September 2026 — the market, the web platform, golf
analytics and the Rules, sync and privacy — each from vendors' own pages, help
centres, specifications, engine source code and the governing bodies' texts. The
details sit where they are used (sections 4–10); this is what they add up to.

### 2.1 The market: how the others capture a shot

| Product | What the golfer does per shot | Phone-only automatic? | Penalties | Club distance shown | Price (Sept 2026) |
|---|---|---|---|---|---|
| **Arccos** | nothing with grip sensors or the Air clip (18 Mar 2026: pocket wearable, gyroscope + accelerometer + GPS); edit afterwards — Arccos itself recommends 3–5 min per round | **yes**, iPhone 12+ in a pocket (motion ML), club tagged by hand or by an AI feature in beta | "+1 (drop)" / "+2 (re-hit)" on a shot; a dedicated penalty flow "coming" | 70th percentile, mishits/chips/recovery excluded, normalised to 70 °F, sea level, zero slope, no wind | $199.99/yr; Air $349.99 |
| **18Birdies** | phone in the pocket; after each hole confirm the predicted score and putts, pick a first-putt range | **yes** — GPS "pauses in movement" | "+Penalties" against a stroke | True Distance (recent shots, normalised) | $99.99/yr |
| **Hole19** | tap *Save Shot* at the ball (club and lie suggested); *Intelligence* (Dec 2025) proposes grey "+" markers from GPS stops and "never saves a shot automatically" | **proposals only** | drag the marker to the water, mark it, drag to the drop; no 2-stroke penalties | average of the "most common shot" | $69.99 / $99.99/yr |
| **Shot Scope** | nothing (V5 watch reads RFID club tags within 7–10 cm) or tap an NFC tag to the phone before each shot (CONNEX, phone on a "virtual lock" scan screen); **PinCollect**: press the putt count at the cup — records putts AND the pin, then advances | no | **the best in-round model**: OB/lost, drop, provisional with a search timer, 1- or 2-stroke penalties | P-AVG (trimmed, well-struck) | no subscription; V5 ~$250, CONNEX $99.99 |
| **Garmin** | nothing with a watch (full swings only — "putts are not detected"); CT10 grip sensors add clubs and putts | no | reportedly missing from the app scorecard | all shots averaged | CT10 $299 |
| **Golfshot** | phone: Track → walk → "At my ball" → club → Save; watch: the next swing ends the previous shot, practice swings filtered by the one you walk away from | no | — | 5 "On Target" shots before a distance is set | $79.99/yr |
| **Golf Pad** | tap an NFC tag with the phone in the pocket ("Scanning mode": screen on, dimmed, touches blocked); a Bluetooth button | no | a tag action adds a penalty | — | $29.99–49.99/yr; tags $99–119 |
| **Golf GameBook** | manual score entry; the Nordic social leader (2 M golfers, 70 M rounds); Min Golf login partner | no | manual | — | Gold 199–599 kr |

**The direction of 2026 is reconciling from the score, not asking per shot**: Arccos
*Smart Edit* (Aug 2026) asks only for each hole's score and putts, rebuilds the shots
and clubs, and flags holes where they disagree; 18Birdies predicts score and putts
after each hole; Shot Scope's watch proposes the score to confirm.

### 2.2 Where every one of them falls short — the openings

- **Penalties.** No app documents E-5 or mulligans; most have no drop flow at all.
  A clear, rules-correct, one-tap penalty model (4.4) would be best in class on its
  own.
- **The editing burden.** Reviewers' first complaint after the subscription:
  minutes of fixing per round, phantom shots, missed chips and tap-ins. Arccos
  advises editing at the next tee, never mid-hole — which is where 4.3's one
  question lives.
- **Pins.** Proximity and putting statistics need the hole position; every app
  improvises (a pin button, PinCollect, a first-putt range).
- **Battery.** About 40 % of a phone per round for Arccos; 25–55 % of a watch for
  Golfshot's auto tracking.
- **No one has the ground.** Arccos normalises distances to zero slope with its own
  course data; nobody shows the golfer the slope, the lie and the shot on a
  measured 3D course. Banvy's 1 m laser terrain, surface classes and water levels
  (section 1) make lie, elevation and penalty detection facts instead of guesses.

### 2.3 What the platform allows

The web delivers GPS and motion **only while the page is visible**, on iOS and
Android alike, with no standard planned; Wake Lock works in iOS home-screen apps
from 18.4; iOS has no vibration API; background sync is Chromium-only. So: *wake at
the ball* is the default, pocket mode is opt-in and battery-costly, and a native
wrapper or a watch is the only way to hands-free tracking with the screen off.
Section 10 has the matrix and the native path.

### 2.4 What the numbers and the Rules require

GPS measures total distance (carry needs the golfer or a launch monitor); club
averages are medians or percentiles over full swings only; strokes gained has a
published tour baseline but no public amateur one; the Rules give each penalty an
exact count (18.2, E-5, 17, 19, 18.3), a mulligan is not a Rule and voids a round
for handicap in Sweden, and Min Golf accepts scores from third parties only
through SGF's paid GIT licence. Sections 4.4, 4.6, 7.4 and 7.7 carry the details.

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

- **Tapped at the cup, after holing out** — Shot Scope's PinCollect pattern: one tap
  records the putts, **records the pin** (the golfer is standing at it; the same
  fix-averaging as 7.1) and **finishes the hole**. The score appears in the sheet
  head (`Hål 5 · 4 slag · par`). The day's pin is what proximity, putting and
  strokes gained need (2.2), and it arrives without a pin button.
- `I hål` is a chip-in or a holed shot from off the green (0 putts). Putts are
  strokes on the green only; a putter from the fringe is a shot, as the Tour
  counts it.
- The approach shot ends where the golfer first **stopped on the green** (the ball),
  not where they walked on and not at the hole — the stop detector gives that
  point; without a stop, it is left open rather than guessed.
- Walking off to the next tee without tapping is allowed: the round tracker moves
  on, and the next tee's rail starts with one question chip, `Puttar på 5:an? 1 · 2 · 3`,
  which disappears when the next club is tapped (the hole stays open for review).
- **The score is the one number checked every hole** — the 2026 lesson of Arccos
  Smart Edit and 18Birdies (2.1): the finished hole's chip shows the score the shots
  add up to, `Hål 5: 4 ✓`, with `−`/`+` beside it. Correcting the number never
  rewrites the shots; it marks the hole *shots and score disagree* for the review,
  so the scorecard is always what the golfer says and the statistics never invent
  a shot to match it.

### 4.4 Penalties, drops, mulligans, provisional balls

Every correction is on the **last shot's chip** — tap it and the row turns into:

```
│ Slag 2 · Järn 6 · 148 m                                         │
│ [OB · slå om +1] [OB · droppa +2] [Vatten +1] [Ospelbar +1]      │
│ [Mulligan] [Provisorisk] [Byt klubba] [Ta bort]                  │
```

| Situation | Rule (2023) | One tap | Counting | Club statistics |
|---|---|---|---|---|
| Out of bounds, or lost after a 3-minute search | Rule 18.2, stroke and distance | `OB · slå om +1` | +1; a drive OB makes the next tee shot the 3rd stroke; the next shot starts where the golfer next taps (back at the spot) | shot excluded |
| The same, where the club allows the local rule | Model Local Rule E-5 (not after a provisional, in a penalty area, or for an unplayable ball) | `OB · droppa +2` | +2; a drive OB makes the next shot the 4th; next shot from the drop | excluded |
| Penalty area, red or yellow | Rule 17 | `Vatten +1` | +1; a drive into water, dropped, makes the next shot the 3rd | excluded (the ball's rest point is unknown) |
| Unplayable | Rule 19 | `Ospelbar +1`; from a bunker, dropped back outside it, `+2` | +1 (+2) | the shot's own distance kept — it ended where it ended |
| Provisional ball | Rule 18.3 | `Provisorisk` | the provisional tee shot is the 3rd stroke; if the original is found in bounds within 3 minutes the provisional's strokes do not count — a **3-minute search timer** appears on the chip when the golfer reaches the area (Shot Scope's idea; Rule 18.2's limit), and the one question, "Hittade du bollen? Ja / Nej", is asked once after the hole | the lost one excluded |
| Mulligan | not in the Rules — a replayed shot is stroke and distance under 18.1 | `Mulligan` | the shot does not count, and **the round is marked as not valid for handicap** (SGF handicap rule 2.1: a round where a Rule was knowingly ignored cannot count) | excluded |
| Free relief (cart path, ground under repair, embedded ball) | Rule 16 | nothing | the next shot simply starts at the drop (from a bunker, dropping outside costs 1) | unaffected |

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
  chip is not in the way of anyone playing by the Rules — and a round that used one
  says, on its card, that it cannot be registered for handicap.
- **E-5 in Sweden**: SGF's handicap rules let a casual round count when the player
  used E-5 even where the club has not adopted it; a secondary source says SGF's
  rules committee advises clubs *not* to adopt it (not confirmed in an SGF
  document). The chip is shown on every course; the course's own local rules, where
  the repo has transcribed them (Veckefjärden, Visby, Tortuna, Lidingö), can later
  say whether it applies.

### 4.5 Pocket and bag — two modes, because the web allows exactly two

Section 10 has the limit in full: **a web page gets no GPS, and no motion events,
while it is hidden or the screen is locked — on iOS and on Android, with no
standard planned.** So there are two honest ways to carry the phone, and the owner's
workflow is already the better of them:

**Wake at the ball — the default.** The screen goes off between shots, as it would
anyway. At the ball the golfer wakes the phone and taps the club. On becoming
visible the app restarts the watch for a *fresh* fix (no cached position), and the
tap is **accepted at once** — the chip shows `Järn 6 · söker GPS…` and the shot's
position fills in from the first fix under ±10 m, usually within seconds; the golfer
never waits. Nothing is tracked on the walk (there is nothing to track), the hole
tracker picks up on the first fix, and the 3D scene renders only while it is looked
at. This is also the platform research's own conclusion: *screen off between shots,
wake to mark* is the most battery-friendly design a web app can have.

**Fickläge — pocket mode, for automation, opt-in.**

- A full-black overlay (OLED pixels off) and — the part that matters most for the
  battery — **the 3D render loop paused**: no WebGL/WebGPU frames at all while the
  overlay is up.
- The Screen Wake Lock held and re-requested on every `visibilitychange` (both
  engines release it when the page hides); the first request needs a tap, and on
  iOS it works in a home-screen app only from iOS 18.4.
- Every touch swallowed except a deliberate long press on a lock glyph (there is no
  proximity sensor on the web to do it for us); the hole number and the distance to
  the green in large dim type for a glance.
- GPS and the stop detector run; with the motion permission (asked from the same
  tap that switches Fickläge on — iOS requires a user gesture, and Chrome is moving
  the same way) the swing detector (7.5) listens. A stop with a swing becomes a shot
  with the predicted club; a stop without one is a candidate only if the golfer then
  walked 30 m or more.
- **Taking the phone out is the review**: `2 slag registrerade · Järn 7 142 m ·
  Wedge 64 m — stämmer?`, each club one tap to change.
- **Battery, honestly**: a screen-on web page for a 4-hour round is estimated at
  30–60 % (not measured; Arccos's native app, screen mostly off, reports about 40 %).
  A black overlay is what Google Maps' power-saving mode uses (3 %/h against 8 %/h
  with its light interface, on a Pixel). So pocket mode shows its measured drain per
  hole after two holes, and M4 measures it on real phones before it is recommended.

**In the bag on a trolley**, stops are the trolley's, parked a few metres from the
ball; rounds tagged as bag-mode keep their distances out of club statistics unless
confirmed shot by shot.

**Haptics**: Android can buzz on a tap (`navigator.vibrate`, after a gesture); iOS
has no vibration API at all — only a real tap on an `<input type="checkbox" switch>`
(Safari 17.4+) produces a haptic, and script cannot fire one, so an auto-detected
shot cannot buzz on iOS. The club chips can be built as such switches to get the
tap haptic on iPhone; to be verified on a device before it is relied on.

**Precise location can be switched off by the user** (iOS "Exakt plats"; Chrome on
Android offers approximate-only sharing since May 2026). Repeated fixes worse than
±100 m mean exactly that, and the rail says so — `Exakt plats är avstängd ·
slå på den för slagmätning` — rather than recording shots at kilometre precision.

### 4.6 The scorecard and formats

- Per hole, all derived, with the PGA TOUR's definitions: **fairway** (tee shot at
  rest on THIS hole's fairway, par 4/5 only; the first cut is a miss), **green in
  regulation** (on the putting surface in par − 2 strokes or fewer; the fringe is
  not the green), putts (strokes on the green only), penalties by cause, sand save
  (up and down from a greenside bunker), scrambling (par or better after a missed
  GIR).
- Formats in the golfer's own words, the ones Swedish golf uses: **Slagspel**
  (gross, to par), **Poängbogey** (Stableford: max(0, 2 + par + s − gross) per
  hole), **Slaggolf** (capped at par + 5) and net. They need the golfer's strokes
  per hole, s = ⌊PH/18⌋ + (1 if hålindex ≤ PH mod 18), from their *justerad
  spelhandicap* PH — which they either type in (Min Golf shows it) or the app
  computes as round(exakt handicap × Slope/113 + CR − par) at Sweden's 100 %
  allowance, when the course's slope table is in the data (Visby's is; the rest
  need it added). Net double bogey (par + 2 + s) is shown as the handicap-counting
  score.
- Match play and friends' cards are milestone 7.
- The round ends itself after the last hole's putts, or after 8 h idle; "Avsluta
  runda" in the sheet body.
- **Min Golf**: the app links out to register the round. Submitting it directly
  needs SGF's commercial GIT API licence — no open API exists; 2026 prices are
  60,375 SEK to start and 48,300 SEK a year for login + handicap registration, and
  casual-round submission only after SGF's GIT team has verified the integration.
  A business decision (section 12), not an engineering one. A Swedish handicap
  round also needs 9+ holes and a marker who attests it, registered before
  midnight — the card can show exactly what Min Golf will ask for.

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
event), makes sync a set union of event IDs (9.2), and keeps every correction
auditable.

```json
{
  "round": "01a0cd49-57b8-7c3e-…", "v": 1,
  "course": { "slug": "puttom", "pack": "2e07d11db74e…", "tee": { "index": 0, "name": "Vit" } },
  "format": { "kind": "stroke", "playingHandicap": 18, "mulligans": false },
  "events": [
    { "id": "01a0cd49-57b8-7f01-…", "t": 1790150531000, "type": "shot", "hole": 1, "club": "driver",
      "at": { "lat": 63.30146, "lon": 18.93973, "acc": 4, "x": -78.6, "z": -251.5, "y": 68.1, "lie": "tee", "fixes": 5 },
      "source": "tap" },
    { "id": "01a0cd4b-f3b0-7…", "t": 1790150702000, "type": "shot", "hole": 1, "club": "iron-7",
      "at": { "…": "…", "lie": "fairway" }, "source": "tap", "suggested": "iron-7" },
    { "id": "01a0cd4d-4b70-7…", "t": 1790150790000, "type": "penalty", "hole": 1, "after": "01a0cd4b-f3b0-7…", "kind": "water", "strokes": 1 },
    { "id": "01a0cd4f-04d8-7…", "t": 1790150903000, "type": "green", "hole": 1, "at": { "…": "…" }, "source": "stop" },
    { "id": "01a0cd50-aab8-7…", "t": 1790151011000, "type": "putts", "hole": 1, "n": 2 },
    { "id": "01a0cd50-cde0-7…", "t": 1790151020000, "type": "undo", "target": "01a0cd4d-4b70-7…" }
  ]
}
```

- **IDs are UUIDv7** (RFC 9562) generated on the device: the first 48 bits are the
  time in milliseconds, so they sort by time, and the rest is random, so records
  made offline on two phones never collide and sync needs no CRDT (section 9). The
  sketch is Puttom's 1st from the back tee, at the tee mark's real coordinates
  (the pack's frame, the laser's height) on the morning of this plan.
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

What a fix is worth: GPS.gov puts smartphones at about 4.9 m under open sky; a 2026
field study of Android-reported accuracy found medians of 3.8 m standing and 6.8 m
walking; under trees it is worse, and dual-frequency receivers help less than their
marketing. The number the browser reports is not one thing either — the spec says
95 % confidence, Chrome passes through Android's 68 % (one sigma), Apple does not
say — so the app treats `accuracy` as roughly one sigma and plans for 2–5 m. The
error also drifts over seconds, so a tap never takes the last fix alone:

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
  a flat, calm day, and that is the number the bag should learn. Arccos does the
  same normalisation (70 °F, sea level, zero slope, no wind) from its own course
  data; what Banvy adds is that the slope comes from 1 m laser terrain the golfer
  can *see* the shot drawn on, and the lie from measured surfaces — an advantage in
  trust, not only in arithmetic.
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

- **GPS measures TOTAL distance — carry plus roll — and the bag holds CARRY.** They
  are different numbers and both are kept: the measured total says where the ball
  *finishes* (what an approach to a pin or a layup short of a hazard needs); the
  carry says what it *clears* (what water in front of a green needs). Roll varies
  with the ground, so gapping between clubs is judged on carry, which only a launch
  monitor or the golfer can supply.
- Which shots count, from how the apps golfers trust do it: full swings only — no
  penalty, mulligan or recovery shot (Broadie's rule: starting 30+ yards out and
  travelling under 40 % of the way or finishing 15°+ off line), no chip or partial
  inside ~45 m of the green, no punch-out, nothing marked as a layup, nothing
  low-confidence (7.1). Arccos drops mishits and abnormally long shots too; Shot
  Scope's P-AVG trims ~10 % at both ends; Stagner's Arccos studies report medians;
  Broadie uses the 75th percentile for drives.
- Per club, from those shots (flat-equivalent totals, 7.2): centre m = median,
  spread s = 1.4826·MAD (floored at 5 % of m), n shots; the median's own
  uncertainty ≈ 1.25·s/√n is shown beside it, and below ~10 shots the number says
  it is provisional. Until a club has history, the prior is the bag's carry plus a
  roll prior by club type (driver ~+8 %, woods ~+6 %, hybrids and irons ~+3 %,
  wedges ~+1 %, refitted per golfer as totals arrive):
  m̂ = (n·m + k·prior)/(n + k), k = 3.
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

What the web gives: `devicemotion` at 60 Hz (rotation rate and acceleration),
after a permission asked from a tap, **only while the page is visible** — so only in
pocket mode with the screen held on (that events keep flowing in a pocket is an
inference from the specs, to be proved in M4). 60 Hz is coarse for a swing that
lasts about a second from the top to impact, but a swing is also the largest,
fastest rotation a pocketed phone ever sees, which is what makes it detectable.

The rule M6 starts from, every threshold to be fitted on recorded rounds (7.6):

- a **swing** is a peak of angular speed |ω| far above walking (walking is a
  periodic ~2 Hz pattern at much lower |ω|), preceded by at least a second of near
  stillness (the address) and followed by a follow-through decay;
- **practice swings** are common, so of several swings at one stop the shot is the
  **last swing before the golfer walks away** (25 m or more);
- **fusion**: stop ∧ swing → shot (high confidence); stop without swing → only a
  candidate (4.5); swing without stop → ignored unless GPS was lost;
- the detector's worth is measured, not asserted: precision and recall against the
  taps of recorded rounds, reported per phone model and per carry position (front
  pocket, back pocket, bag).

What the market and the literature say the thresholds are near, to start from:

- **It works commercially**: Arccos detects shots from an iPhone 12+ in a pocket,
  and its Air clip from gyroscope + accelerometer + GPS alone (reviewers: 99 % of
  shots detected, 60–90 % of clubs right). Placement matters — Arccos asks for the
  lead-side front pocket and rules out the back pocket, the bag, a cart or a jacket
  for Air.
- **A pocketed phone's swing** peaks at about 6 rad/s (~340°/s) about the
  gyroscope's y-axis (patent US11071902B2, which also calibrates on 3 full swings,
  3 chips and 3 putts, and treats putts as low-amplitude with little z rotation);
  pelvis rotation peaks at 415 ± 33°/s in tour players' downswings, slower in
  amateurs.
- **Timing** (Kim 2020, 200 Hz IMUs incl. one at the waist): backswing
  1.16 ± 0.23 s, downswing 0.32 ± 0.05 s, follow-through 0.67 ± 0.12 s — so 60 Hz
  gives ~19 samples across a downswing, enough to find its peak, not to shape it.
- **Practice swings** are handled everywhere the same way we plan to: one shot per
  "grouping session", the swing the golfer walks away from (Golfshot; the Microsoft
  wrist patent US10097961B2).
- A per-golfer **calibration** — three practice swings with the phone where it will
  ride — is the cheap way to adapt a threshold that varies with swing speed and
  pocket, and it is what the patent does.

### 7.6 The field recorder — the data every automatic rule is tuned on

An opt-in **"Spela in rådata"** in pocket mode records every GPS fix (lat, lon,
accuracy, speed, heading, time), motion features at 10 Hz (peak angular speed and
peak acceleration per 100 ms) and every tap, exported as one JSON file per round.
The owner plays rounds with it; the traces become fixtures in the test suite with
the taps as ground truth. **Nothing tuned on simulations alone ships as automatic**
— the same rule this repo holds for pixels ("if the reference cannot reproduce
itself, nothing measured against it means anything").

### 7.7 Strokes gained

**The formula** (Broadie 2011): SG(shot) = J(d₀, c₀) − J(d₁, c₁) − 1 − penalties,
where J is the average strokes to hole out from distance d in lie c, and a holed
ball has J = 0. With the penalty term, each hole's shots sum to J(tee) − score —
Broadie's own example scores a drive out of bounds and replayed at −2.

**Lies and categories.** Broadie's lies are tee, fairway, rough, sand, recovery and
green; the surface classifier maps onto them directly (fringe → fairway, which is
Broadie-consistent since he has no fringe; semi, rough, heath, path → rough; forest,
wetland, rock → recovery, plus his automatic rule: a shot from 30+ yards that
travels under 40 % of the way, or finishes 15°+ off the line, is recovery). The
PGA TOUR categories: **off the tee** (drives on par 4/5), **approach** (from more
than 30 yards ≈ 27 m from the green's edge, par-3 tee shots included), **around
the green** (within 30 yards, not on it), **putting** (on the green). Distance from
the tee is measured along the hole — the hole line the pack already has — and
straight to the hole everywhere else.

**Baselines.** Only the tour's is published in full:

| Yards (m) | Tee | Fairway | Rough | Sand | Recovery |
|---|---|---|---|---|---|
| 20 (18) | – | 2.40 | 2.59 | 2.53 | 3.51 |
| 50 (46) | – | 2.66 | 2.87 | 2.92 | 3.79 |
| 100 (91) | 2.92 | 2.80 | 3.02 | 3.23 | 3.80 |
| 140 (128) | 2.97 | 2.91 | 3.15 | 3.22 | 3.80 |
| 200 (183) | 3.12 | 3.19 | 3.42 | 3.55 | 3.87 |
| 300 (274) | 3.71 | 3.78 | 3.90 | 4.04 | 4.20 |
| 400 (366) | 3.99 | 4.11 | 4.30 | 4.69 | 4.75 |
| 500 (457) | 4.41 | 4.50 | 4.77 | 5.40 | 5.22 |

*PGA TOUR, ShotLink 2003–10, 8 million shots (Broadie 2011, Table 9; the full table
runs 10–600 yards). Putting, in feet (m): 2 (0.6) 1.01 · 4 (1.2) 1.14 · 6 (1.8) 1.34
· 8 (2.4) 1.50 · 10 (3.0) 1.61 · 15 (4.6) 1.78 · 20 (6.1) 1.87 · 30 (9.1) 1.98 ·
60 (18.3) 2.21 · 90 (27.4) 2.36 — tour players hole half from 8 ft and average two
putts from 33 ft.*

There are **no published amateur tables** (Broadie "ran out of pages"), and the
apps' handicap baselines are proprietary (Arccos: a scratch baseline from 314,000
rounds; Shot Scope: scratch and 5–25 handicaps from 80 million shots). What is
published anchors an approximation: Broadie 2008 (makes half from 8.2 ft for pros,
5.8 / 5.1 / 3.8 ft for the 70–83 / 84–97 / 98–120 scoring bands; two putts on
average from 30 / 25 / 19 / 12 ft; sand saves 50 / 26 / 17 / 7 %; strokes lost to
scratch per round 4.0 / 15.5 / 31.0, of which putting 0.8 / 2.3 / 5.1), the tee
fits (tour J = 2.38 + 0.0041·d; a 90-shooter J = 2.79 + 0.0066·d, d in yards), and
Shot Scope's putts holed by handicap (0–6 ft: 92.8 % scratch → 82.5 % at 25). So:

- ship the **tour baseline as published** and **scratch / hcp 10 / hcp 20
  baselines fitted to those anchors**, labelled "Banvy-uppskattning" with their
  sources in the app — honest about being an approximation;
- replace the approximation with **our own baseline** once golfers have opted in to
  contributing rounds (9.5: consent, not contract) — Swedish amateurs on real,
  measured ground, which nobody else has;
- **pins decide the precision.** Without the day's hole position, the green centre
  stands in with ± half the green's depth, and putting SG is GPS-limited (±4 m on a
  10 m first putt is most of the putt) — so putting shows putts per hole against the
  expectation for the approach's proximity band until a pin is set (section 12).

**Dispersion references** for the dashboard: Broadie measured drive direction
spread at 4.0° for tour pros and 5.4°, 6.4° and 8.1° for low, mid and high
handicaps (4° is 14 yards at 200); amateur patterns on short shots run about three
times longer than wide, and misses are mostly short (41 % of scratch players' shots
from 100 yards finish 1–9 yards short). Lateral and distance error are reported
separately, never as one radius.

---

## 8. Analytics and the dashboard

One responsive view, the same code on phone and desktop (a `?statistik` view of
the app, reachable from the chooser and the in-game menu), in four tabs:

- **Rundor** — every round with score, to par, putts, FIR, GIR, penalties; tap for
  the scorecard and the 3D replay (4.7).
- **Klubbor** — per club: median total (flat-equivalent and as measured) with its
  uncertainty, the 25–75 % range, longest, sample size, lateral miss and distance
  miss separately (mean, spread, left/right and short/long shares, direction spread
  in degrees beside Broadie's handicap references), a dispersion ellipse drawn on a
  neutral range; the bag's carry beside the measured total. The one bag correction
  the data can make safely: **a measured total SHORTER than the bag's carry** means
  the carry is optimistic (a ball cannot finish shorter than it flew, plugged and
  uphill lies aside) — *"Järn 7 slutar på 131 m i snitt (18 slag) men bagen säger
  140 m carry. Sänka?"* Carry itself stays the golfer's number or a launch
  monitor's.
- **Spel** — strokes gained by category (7.7) against a chosen baseline (tour as
  published; scratch / hcp 10 / hcp 20 as Banvy's labelled approximation), FIR, GIR,
  scrambling, sand saves, putts per GIR, three-putt avoidance, penalties by cause,
  scoring by par type, per-hole history on each course ("Hål 7: höger i 4 av 5
  rundor — vatten där").
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

Checked on 23 September 2026 against Safari 26.x/27.0 and Chrome 152/153, several
points in the engines' own source rather than only their documentation:

| Capability | iOS (Safari / home-screen web app) | Android (Chrome / installed PWA) | Native wrapper (+ watch) |
|---|---|---|---|
| GPS, screen on and page visible | yes, ~1 Hz | yes (high accuracy every 500 ms) | yes |
| GPS with the screen locked or the app in the background | **no** | **no** | **yes** |
| A web standard for background location | none planned (WebKit request closed "later", Nov 2025) | none | — |
| Screen Wake Lock | Safari 16.4+; home-screen apps only from iOS 18.4 | Chrome 84+ | native |
| Motion sensors | `devicemotion` 60 Hz after `requestPermission()` from a tap; stops when hidden | `devicemotion` 60 Hz; Generic Sensor API capped at 60 Hz; stops when hidden | native rates; Apple Watch accelerometer up to 800 Hz |
| Vibration | none (a switch-checkbox haptic on real taps only) | yes, after a gesture | native haptics |
| Storage | IndexedDB up to 60 % of disk; `persist()` by heuristic; a home-screen app's store is separate from Safari's | up to 60 % of disk; `persist()`; Storage Buckets | native database |
| Background Sync / Periodic Sync | no / no | yes / yes (installed) | native |
| Web Push | home-screen apps only (16.4+), never silent | yes, never silent | incl. silent push |

**What the app does with that, per milestone:**

- **M1–M4 stay on the web.** The wake-at-the-ball flow (4.5) works fully inside
  these limits; pocket mode works while the screen is on; sync runs when the app is
  open. The web app is the product until the field numbers say otherwise.
- **The wrapper decision (M6) is a battery-and-capture decision.** A Capacitor shell
  gets what the web cannot: on iOS, background location for a round the golfer
  started, with *While Using* permission plus the location background mode and
  `CLBackgroundActivitySession` (Apple names tracking "the precise path taken during
  a hike or fitness workout" as a valid use; no *Always* permission needed); on
  Android, a location foreground service with its notification, again without the
  restricted background-location permission. Plugins: the community
  `background-geolocation` (free, documented only to Capacitor 7) or Transistorsoft's
  (Capacitor 8, motion-aware GPS duty-cycling, paid licence for release builds). App
  Review would judge it against 4.2 ("more than a repackaged website"), 2.5.4, 5.1.5
  and 2.4.2 (battery) — a real risk to plan for, not a formality.
- **The watch is where "zero interruption" is fully solved.** Apple Watch gives
  batched accelerometer data at 800 Hz during a HealthKit workout (Apple's own WWDC23
  example was a golf swing); Wear OS Health Services has a golf exercise type with
  built-in shot counting (`GolfShotEvent`). Both need native apps; both are the path
  Arccos and Garmin prove golfers accept. After M6, not before.
- **Battery rules for every milestone:** render the 3D scene only while it is looked
  at (the render loop already pauses in pocket mode, and iOS Low Power Mode throttles
  frames to 30 fps anyway), a black UI outdoors where auto-brightness runs high
  (dark UI on OLED saves 39–47 % at full brightness, only 3–9 % at 30–50 %), and no
  GPS duty-cycling tricks — the web can only start or stop `watchPosition`.

---

## 11. Milestones and gates

Each milestone ends in gates that fail loudly, in this repo's manner: unit tests
for the rules, a browser gate with scripted geolocation for the wiring, and — from
M2 on — recorded field rounds for anything automatic. Estimates are engineering
weeks for one person who knows the codebase.

| # | Milestone | Delivers | Done when (gates) | Est. |
|---|---|---|---|---|
| **M0** | **GPS follows the round** — *shipped 2026-09-23* | course + hole auto-selection, handoff, "Hitta min bana", GPS survives signal loss | `gps-round.test.mjs` simulated rounds on 13 courses; `check-gps-round.mjs` | done |
| **M1** | **Round core** | `engine/round.mjs` event fold; IndexedDB store; the shot rail (club tap, wake-at-the-ball fresh-fix capture, putts tapped at the cup with the pin, the per-hole score confirmation, last-shot chip: OB ×2, water, unplayable ±bunker, mulligan with the handicap flag, provisional with the search timer, change club, delete, undo); score in the sheet head; hole and round end; scorecard with Slagspel/Poängbogey/Slaggolf; JSON export/import | unit tests for every row of the 4.4 table and every format; undo-restores-fold property test; `check-shot-rail.mjs`: a scripted 18-hole round by geolocation and taps produces the expected scorecard, zero dialogs, no overlap with `#kikGreen`/`#gpsStatus`/HUD at 390×844 and 1440×900, `check-caddie-ui` still green | 2–3 |
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
3. **Handicap scope.** Recommendation: keep the blueprint's line — gross, net,
   Poängbogey and Slaggolf computed for display from a justerad spelhandicap the
   golfer enters (or the app computes where a slope table exists), a link out to
   register the round in Min Golf, no WHS re-implementation. Submitting rounds
   straight into Min Golf is possible only with SGF's commercial GIT API licence
   (60,375 SEK to start and 48,300 SEK a year in 2026, integration verified by SGF);
   worth it only if handicap registration becomes a reason people choose the app.
4. **Business model.** The market's shape (2.1): sensor systems at €250–350 plus
   $100–200 a year (Arccos, Garmin) or without a subscription (Shot Scope), phone
   apps at $30–100 a year (Golf Pad, Hole19, Golfshot, 18Birdies), GameBook at
   199–599 kr. A free on-course core (GPS, one-tap tracking, scorecard, club
   distances) with a paid tier for strokes gained, insights and multi-device sync
   fits that shape; reviewers' first complaint is the subscription, so what is free
   matters as much as what is paid. Nothing in M1–M4 depends on the choice.
5. **Pins.** Strokes gained, putting and proximity are only as good as the hole
   position. A "flagga idag" drag-the-pin on the green (golfer) or a pin sheet
   (club portal) turns the green-centre approximation into a measurement; the
   blueprint already lists pins as the first thing a club would pay for.
6. **Mulligans and casual formats** — default off, one switch per round (4.4); say
   if the default should differ.

---

## Sources

All read on 23 September 2026. Where a vendor's help page refused automated
access, the claim came from a search snippet and is marked as uncertain in the
text; prices and free-tier limits change often and should be re-checked at M5.

**In this repository**
- `apps/golf/src/engine/gps-round.mjs`, `gps-round.test.mjs` — the round tracker and its simulated rounds
- `tools/sim-stop-detector.mjs` — the stop-detection measurement in 7.3
- `tools/check-gps-round.mjs`, `tools/check-caddie-ui.mjs` — the browser gates
- `apps/golf/src/engine/caddie.js`, `rangefinder.js`, `weather.js`, `surface.js` — bag, plays-like, weather, surfaces
- `docs/banvy-blueprint.md` — the product blueprint this plan extends (Tier 4, "GPS mode")

**Market and competitors**
- Arccos: [Air launch](https://www.arccosgolf.com/blogs/community/introducing-arccos-air-no-phone-no-sensors-just-golf) · [Air](https://www.arccosgolf.com/pages/arccos-air) · [members FAQ](https://www.arccosgolf.com/pages/arccos-members-frequently-asked-questions) · [Link Pro vs Air](https://support.arccosgolf.com/hc/en-us/articles/52635615927572-Link-Pro-vs-Arccos-AIR) · [Smart Club Selection](https://support.arccosgolf.com/hc/en-us/articles/46185274264724-What-is-Smart-club-selection) · [where to place Air](https://support.arccosgolf.com/hc/en-us/articles/47278024291220-Where-should-I-place-Arccos-Air-during-a-round) · [where to keep the phone](https://support.arccosgolf.com/hc/en-us/articles/35180496920212-Where-Do-I-keep-my-phone-for-shot-detection) · [missed shots](https://support.arccosgolf.com/hc/en-us/articles/360036195212-Why-is-my-phone-missing-shots) · [will Arccos detect all shots](https://support.arccosgolf.com/hc/en-us/articles/35106058736660-Will-Arccos-detect-all-my-shots) · [editing a round](https://support.arccosgolf.com/hc/en-us/articles/360054190652-Will-I-need-to-edit-my-round) · [Smart Edit](https://support.arccosgolf.com/hc/en-us/articles/49286798786580-What-is-Smart-Edit) · [Smart Edit launch](https://www.arccosgolf.com/blogs/community/smart-edit-is-here-the-scorecard-that-edits-itself) · [Smart Putt Detection](https://support.arccosgolf.com/hc/en-us/articles/360038324351-What-is-Smart-Putt-Detection) · [pin locations with Air](https://support.arccosgolf.com/hc/en-us/articles/46185858480404-Setting-Pin-Locations-with-Arccos-Air-Step-by-Step-Guide) · [hole switching](https://support.arccosgolf.com/hc/en-us/articles/360052865132-Why-is-Arccos-not-automatically-switching-holes) · [club assignment](https://support.arccosgolf.com/hc/en-us/articles/12825013864596-Why-Is-Arccos-Assigning-a-Different-Club-to-My-Shot) · [penalty strokes](https://support.arccosgolf.com/hc/en-us/articles/360037871951-How-do-I-add-a-penalty-stroke) · [Smart Distance](https://support.arccosgolf.com/hc/en-us/articles/360036475132-What-is-Smart-Distance-Smart-Range-and-Longest) · [smart club distances](https://www.arccosgolf.com/pages/smart-club-distances) · [battery](https://support.arccosgolf.com/hc/en-us/articles/360036799151-How-much-battery-will-Arccos-use-on-my-phone) · [2026 app update (Golf.com)](https://golf.com/gear/arccos-new-app-update-2026/) · [Air review (Plugged In Golf)](https://pluggedingolf.com/arccos-air-shot-tracker-review/) · [Air review (Breaking Eighty)](https://breakingeighty.com/arccos-air-review) · [Arccos review (Breaking Eighty)](https://breakingeighty.com/arccos-caddie-review) · [Golf Monthly on sensorless tracking](https://www.golfmonthly.com/news/the-day-of-sensorless-shot-tracking-has-finally-arrived)
- Shot Scope: [V5 penalties](https://v5support.shotscope.com/hc/en-us/articles/23432914588049-How-to-Record-Penalties-While-Playing-a-Round-on-Your-V5-Watch) · [V5 score entry](https://v5support.shotscope.com/hc/en-us/articles/23432861956753-How-the-Score-Entry-Feature-Works-on-V5) · [off-green putts and PinCollect](https://v5support.shotscope.com/hc/en-us/articles/23424480802577-Should-I-Include-Off-Green-Putts-in-My-PinCollect-Press) · [P-AVG](https://v5support.shotscope.com/hc/en-us/articles/23425490591889-What-Is-P-AVG-Performance-Average-Distance) · [CONNEX scanning](https://connexsupport.shotscope.com/hc/en-us/articles/17271200937105-How-do-I-scan-a-shot-on-CONNEX) · [CONNEX phone lock](https://connexsupport.shotscope.com/hc/en-us/articles/17271672927633-Can-I-lock-my-phone-when-using-Connex) · [V5 review](https://breakingeighty.com/shot-scope-v5-review) · [CONNEX review](https://pluggedingolf.com/shot-scope-connex-review/) · [6 Benchmarks launch](https://www.firstcallgolf.com/industry-news/release/2026-05-19/shot-scope-simplifies-game-improvement-with-launch-of-the-shot-scope-6-benchmarks-for-success-to-mobile-app-and-dashboard) · [strokes gained](https://shotscope.com/blog/practice-green/stats-and-data/what-is-strokes-gained/) · [putting make % by handicap](https://shotscope.com/blog/practice-green/stats-and-data/putting-make-percentages-by-handicap-how-do-you-compare/)
- Garmin: [AutoShot (Approach S62 manual)](https://www8.garmin.com/manuals-apac/webhelp/approachs62/EN-SG/GUID-4F30D64E-C2F9-4A8B-A011-D1C59AD56386-5832.html) · [CT10 manual](https://www8.garmin.com/manuals/webhelp/approachct10/EN-US/GUID-3DEC1B0D-480C-4907-9B07-B962BCE47C40.html) · [CT10 review](https://breakingeighty.com/garmin-ct10-sensors-review) · [strokes gained](https://www.garmin.com/en-GB/garmin-technology/golf-science/garmingolfapp/strokes-gained/) · [penalty strokes forum thread](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-golf-ios/329167/penalty-strokes-on-score-card)
- Golfshot: [Auto Shot Tracking](https://golfshot.com/auto-shot-tracking-golf-app) · [tracking shots](https://shotzoom.zendesk.com/hc/en-us/articles/360000944613-How-do-I-track-shots) · [practice swings](https://shotzoom.zendesk.com/hc/en-us/articles/360063096553-What-if-Auto-Shot-Tracking-records-practice-swings) · [Auto Putt devices](https://shotzoom.zendesk.com/hc/en-us/articles/40618400429207-What-devices-are-supported-with-Auto-Putt-Tracking) · [Auto Accuracy](https://shotzoom.zendesk.com/hc/en-us/articles/1500002845182-What-is-Shot-Tracking-Auto-Accuracy) · [Smart Club Distances](https://shotzoom.zendesk.com/hc/en-us/articles/360061291014-What-are-Smart-Club-Distances) · [battery](https://shotzoom.zendesk.com/hc/en-us/articles/1500002823962-How-much-battery-does-Auto-Shot-Tracking-use)
- 18Birdies: [Smart Tracking](https://help.18birdies.com/article/734-smart-tracking-automatic-shot-tracking-with-18birdies) · [with Apple Watch](https://help.18birdies.com/article/747-smart-tracking-with-apple-watch) · [how shot detection works](https://help.18birdies.com/article/722-how-shot-detection-works-in-18birdies) · [plays-like](https://18birdies.com/clubhouse/play/plays-like-distances-your-virtual-caddie-best-golf-gps-app)
- Hole19: [auto shot detection](https://help.hole19golf.com/hc/en-us/articles/26053870684444-How-Auto-Shot-Detection-Works-Intelligence) · [shot tracker](https://help.hole19golf.com/hc/en-us/articles/25036534122012-How-to-Use-the-Shot-Tracker-Premium) · [tiers](https://help.hole19golf.com/hc/en-us/articles/26051600319516-Intelligence-Premium-Free-What-s-the-difference) · [strokes gained](https://help.hole19golf.com/hc/en-us/articles/28901742653084-What-is-Strokes-Gained-and-how-does-it-work-Intelligence) · [club statistics](https://help.hole19golf.com/hc/en-us/articles/360021011620-Club-Statistics-Premium) · [auto change hole](https://help.hole19golf.com/hc/en-us/articles/360002180474-Auto-Change-Hole-Premium) · [Intelligence tier](https://www.hole19golf.com/the-19th-hole/hole19-intelligence-tier)
- Golf GameBook and Sweden: [Golf GameBook](https://www.golfgamebook.com/) · [App Store (SE)](https://apps.apple.com/se/app/golf-gamebook-scorecard-gps/id409307935) · [Svensk Golf partner article](https://www.svenskgolf.se/partner/gor-dig-redo-for-golfsasongen-med-golf-gamebook/) · [Så funkar Min Golf](https://golf.se/spela-golf/sa-funkar-min-golf) · [GIT API licence models](https://klubb.golf.se/administration/git-och-it/licensmodeller-for-git-api)
- Others: [TheGrint](https://apps.apple.com/us/app/thegrint-golf-handicap/id532085262) · [Golf Pad TAGS](https://golfpadgps.com/tags) · [Golf Pad Click](https://golfpadgps.com/click) · [Golf Pad screen-on scanning](https://support.golfpadgps.com/support/solutions/articles/57-why-does-the-screen-stay-on-when-golf-pad-tags-are-enabled-) · [Golf Pad tag actions](https://support.golfpadgps.com/support/solutions/articles/6000194326-how-to-assign-a-custom-action-like-adding-penalty-or-marking-flag-for-tags-) · [SwingU strokes gained](https://help.swingu.com/article/477-how-to-track-a-round-using-swingu-strokes-gained)
- Motion research: [US11071902B2](https://patents.google.com/patent/US11071902B2/en) · [US10097961B2](https://patents.google.com/patent/US10097961B2/en) · [Kim 2020, swing phases (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7472298/) · [pelvis rotation (Ann Rehabil Med 2018)](https://www.e-arm.org/journal/view.php?doi=10.5535%2Farm.2018.42.5.713)

**Web platform**
- Geolocation: [W3C Geolocation](https://www.w3.org/TR/geolocation/) · [WebKit bug 193946](https://bugs.webkit.org/show_bug.cgi?id=193946) · [Apple forums: suspension](https://developer.apple.com/forums/thread/777860) · [Chromium: geolocation in the background](https://issues.chromium.org/issues/41186218) · [W3C issue 74, background geolocation](https://github.com/w3c/geolocation-api/issues/74) · [Android Location accuracy](https://developer.android.com/reference/android/location/Location) · [Chrome approximate location](https://www.privacyguides.org/news/2026/05/07/chrome-for-android-now-supports-approximate-location/) · [GPS.gov accuracy](https://www.gps.gov/gps-accuracy) · [2026 field study of Android accuracy](https://arxiv.org/html/2603.26706)
- Wake lock, motion, haptics: [Safari 18.4 features](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) · [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545) · [Chrome Wake Lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock) · [DeviceMotionEvent.requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static) · [W3C Generic Sensor](https://www.w3.org/TR/generic-sensor/) · [W3C DeviceOrientation](https://w3c.github.io/deviceorientation/) · [Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate) · [ios-haptics](https://github.com/tijnjh/ios-haptics) · [Web NFC](https://developer.chrome.com/docs/capabilities/nfc)
- Storage, sync, push: [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) · [persistent storage](https://web.dev/articles/persistent-storage) · [Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync) · [Background Synchronization (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) · [Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Safari 27.0 features](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)
- Native and watches: [iOS background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) · [CLBackgroundActivitySession](https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession-3mzv3) · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Android background location](https://developer.android.com/develop/sensors-and-location/location/background) · [capacitor-community/background-geolocation](https://github.com/capacitor-community/background-geolocation) · [Transistorsoft background geolocation](https://github.com/transistorsoft/capacitor-background-geolocation) · [WWDC23 Core Motion notes](https://wwdcnotes.com/documentation/wwdc23-10179-whats-new-in-core-motion/) · [Wear OS GolfShotEvent](https://developer.android.com/reference/kotlin/androidx/health/services/client/data/GolfShotEvent)
- Battery: [Google Maps power saving (Android Police)](https://www.androidpolice.com/google-maps-power-saving-mode/) · [Purdue dark-mode study](https://www.purdue.edu/newsroom/releases/2021/Q3/dark-mode-may-not-save-your-phones-battery-life-as-much-as-you-think,-but-there-are-a-few-silver-linings.html)

**Golf analytics, Rules and handicap**
- Strokes gained: [Broadie 2011, strokes gained (PGA)](https://columbia.edu/~mnb2/broadie/Assets/strokes_gained_pga_broadie_20110408.pdf) · [Broadie, putts gained](http://www.columbia.edu/~mnb2/broadie/Assets/putting_strokes_gained_20110113.pdf) · [Broadie 2008, Golfmetrics](http://www.columbia.edu/~mnb2/broadie/Assets/broadie_wscg_v_200804.pdf) · [Every Shot Counts](http://everyshotcounts.com/248-2/) · [Arccos on strokes gained](https://www.arccosgolf.com/blogs/community/understanding-strokes-gained) · [Shot Scope on strokes gained](https://shotscope.com/blog/practice-green/stats-and-data/understanding-strokes-gained/) · [GolfWRX on tour SG stats](https://golfwrx.com/381340/the-tours-new-strokes-gained-stats-what-do-they-mean-and-how-can-you-use-them/)
- Distances and dispersion: [Lou Stagner, iron distances](https://newsletter.loustagnergolf.com/p/how-far-do-golfers-really-hit-their-irons) · [Lou Stagner, approaches short](https://newsletter.loustagnergolf.com/p/approach-shots-coming-up-short) · [FlightScope on gapping](https://flightscope.com/blogs/blogs/master-the-carry-distance-gapping-between-your-clubs) · [Golf.com on gapping](https://golf.com/gear/irons/what-you-need-know-gapping-iron-set/) · [Garmin forum: averaging](https://forums.garmin.com/outdoor-recreation/golf/f/approach-s70/405937/is-average-distance-from-the-last-20-rounds-or-all-time) · [Compleat Golfer, scratch stats](https://www.compleatgolfer.com/golf/scratch-golfer-stats-that-will-shock-you/)
- Stat definitions: [PGA TOUR stats](https://www.pgatour.com/stats/detail/103) · [GIR definition](https://www.golfplaza.com/en/glossary-term/green-in-regulation-gir/)
- Rules: [R&A Rule 18](https://www.randa.org/en/rog/the-rules-of-golf/rule-18) (and Rules 14, 16, 17, 19) · [Committee Procedures 8 (Model Local Rules)](https://www.randa.org/en/rog/committee-procedures/8) · [bogeytime.se on OB](https://bogeytime.se/golfregler/out-of-bounds/)
- Handicap in Sweden: [SGF handicapregler](https://golf.se/regler-handicap/handicapregler) · [vanliga handicapfrågor](https://golf.se/regler-handicap/handicapregler/vanliga-handicapfragor) · [spel- och tävlingsformer](https://golf.se/spela-golf/spel--och-tavlingsformer)

**Sync, accounts and privacy**
- Backends: [Supabase pricing](https://supabase.com/pricing) · [regions](https://supabase.com/docs/guides/platform/regions) · [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) · [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum) · [GDPR](https://supabase.com/docs/guides/security/gdpr-compliance) · [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [passkeys beta](https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta) · [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) · [Firestore locations](https://firebase.google.com/docs/firestore/locations) · [Firebase privacy](https://firebase.google.com/support/privacy) · [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 EU jurisdiction](https://developers.cloudflare.com/changelog/post/2025-11-05-d1-jurisdiction/) · [PocketBase](https://github.com/pocketbase/pocketbase) · [Appwrite pricing](https://appwrite.io/blog/post/appwrite-pricing-update) · [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata) · [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- Sync libraries: [RxDB Supabase replication](https://rxdb.info/replication-supabase.html) · [PowerSync pricing](https://powersync.com/pricing) · [Dexie Cloud pricing](https://dexie.org/cloud/pricing) · [Zero offline](https://zero.rocicorp.dev/docs/offline) · [ElectricSQL 1.0](https://electric.ax/blog/2025/03/17/electricsql-1.0-released)
- iOS and origins: [WWDC23, web apps](https://developer.apple.com/videos/play/wwdc2023/10120/) · [WebAuthn RP ID](https://web.dev/articles/webauthn-rp-id) · [GitHub Pages shared origin](https://github.com/orgs/community/discussions/60479)
- Privacy: [GDPR Art. 4](https://gdpr-info.eu/art-4-gdpr/) · [EDPB 2/2019, Art. 6(1)(b)](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf) · [EDPB 04/2020, location data](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-042020-use-location-data-and-contact-tracing_en) · [LEK (SFS 2022:482)](https://data.riksdagen.se/dokument/sfs-2022-482.text) · [IMY: when a DPIA is required](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/konsekvensbedomning/nar-ska-en-konsekvensbedomning-genomforas/) · [IMY: processor agreements](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/) · [Arccos privacy policy](https://www.arccosgolf.com/pages/privacy-policy) · [Hole19 rights](https://www.hole19golf.com/terms/your-rights-and-preferences) · [Caddee integritetspolicy](https://www.caddee.se/integritetspolicy) · [OnTag integritetspolicy](https://www.ontagscorekort.se/integritetspolicy/)
