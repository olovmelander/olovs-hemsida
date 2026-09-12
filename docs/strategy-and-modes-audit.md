# Strategier och lägen — an audit

**Question asked (2026-09-12):** given a per-handicap statistics table, could the
app offer different strategies and modes while playing a course, and what would
that look like?

**Answer:** yes, and most of the plumbing is already built — the bag, the routed
line, the landing zones, the surface classifier, the hazard walk and the
per-shot HUD all exist and are already gated. What is missing is not rendering
and not geometry. It is **a model of the player**, and this repo has never
carried one. Everything below is about what that costs, where it plugs in, and
the four places where the obvious way to build it is measurably wrong.

Nothing here is implemented. This is an audit.

Every number quoted is printed by `tools/strategy-feasibility.mjs`, which reads
only committed course models — quote the tool, not this file.

```
node tools/strategy-feasibility.mjs                    # all six sections
node tools/strategy-feasibility.mjs reach cost         # or just these
```

---

## 1. What the picture is, and what it is not

The infographic is five player levels (scratch, HCP 10, 20, 30, 40) against
eleven per-round statistics: score, putts, GIR, GIR per 18, fairways hit, and
strokes gained against the PGA Tour split into tee, approach, short game and
putting. Its sources are BreakXGolf for the scoring half and StrokesGain.com
for the SG half; the HCP 30 and 40 columns are that source's own estimates,
which is why they are round numbers.

Three properties of it decide the whole design.

**It describes people, not places.** Every dataset this repo has ever ingested
describes a piece of ground, and the entire review culture — provenance per
ring, a checksum per artifact, a gate that fails when a measurement drifts — is
built around that. This one is different in kind. It cannot be verified against
a course, and it must never be presented in the same voice as a distance.
A rendered yardage is a measurement; a strategy recommendation is a model's
opinion, and the UI has to say so.

**Its two halves are not on the same course.** Scratch shoots 74.6 and loses 7.0
strokes to the PGA Tour, which would put the tour at 67.6 — about three shots
under its actual scoring average. That is not an error in the table: the
scoring half is amateurs on amateur courses from amateur tees, the SG half is a
benchmark measured on tour setups. Use each half for what it measures. Do not
subtract one from the other, and do not derive a score from an SG total.

**Its loudest finding is the product steer.** Approach is the largest loss at
every single level — −2.8 at scratch widening to −20.5 at HCP 40, always bigger
than tee, short game and putting. The table's own summary says it: *det är
toe-to-green-spelet som avgör mest*. A strategy feature that helps a golfer
**stand in a better place for the approach** is aimed at the biggest number on
the sheet. One that reads greens or picks a driver line is not.

---

## 2. What already exists — the seams, named

Far more than expected. The 2026-09-04 "paint the hålguide onto the hole" work
built most of a strategy engine and called it Spellinje.

| What | Where | State |
|---|---|---|
| Player's bag, 14 carries, device-local | `engine/caddie.js` `DEFAULT_BAG`, `normalizeBag`, `parseBag`; editor in `main.js` (`bagDialog`) | Shipped, `banvy-caddie-bag-v1` |
| Club recommendation for a distance | `caddie.js` `recommendClub` — asymmetric, long misses cost 1.3× | Shipped, tested |
| Per-hole route from the *selected tee* | `caddie.js` `playableLine` — par 3s go tee→green, longer holes join the centreline | Shipped |
| Landing and approach zones, distance arcs | `caddie.js` `strategyForHole(hole, teeIndex, bag)` → `{zones, arcs, primary, maxCarry}` | Shipped |
| Guide-text constraints | `caddie.js` `statedMaxCarry` / `statedApproach` — parses "max 200 meter", "100–125 meter kvar" out of the club's own note | Shipped |
| 3D overlay: ribbons, zone ellipses, labels, hazard pulse | `main.js` `buildStrategy`, `strategyEllipse`, `strategyRibbon`, `strategyLabel` | Shipped, toggle `#strategyBtn` |
| Front/centre/back of green from any point | `engine/rangefinder.js` `greenDistances` | Shipped, tested |
| Everything a straight line crosses, with layup and carry | `rangefinder.js` `lineHazards` + `main.js` `kikKindAt` | Shipped, tested |
| Plays-like: slope, live wind, temperature | `rangefinder.js` `playsLike`, `windAlong`; `engine/weather.js` | Shipped, tested |
| Lie at any point | `main.js` `kikLie` → green/bunker/tee/fairway/stig/skog/ruff/vatten | Shipped |
| Surface classification, O(1) inside CORE | `main.js` `classify` over `engine/atlas.js` | Shipped |
| Live position, nearest hole with hysteresis | `caddie.js` `gpsToLocal`, `nearestHole` | Shipped |
| Headless access to all of it | `V3D.caddie()`, `V3D.rangefinder(origin, target)`, `V3D.probeGround` | Shipped |
| Motion and layout gates | `tools/check-strategy-stress.mjs`, `tools/check-caddie-ui.mjs`, `geobuild/check-markers.mjs` | Shipped |

Per hole the model already carries par, stroke index, a card length per tee, the
routed centreline, the green ring and centre, fairway rings, bunker rings, tee
pads and card marks, tee/green elevation, and the club's own note. Per course it
carries water rings with measured levels, streams, penalty and OB stake
positions by colour, and the land-cover record.

**So the geometry question is settled.** A strategy engine has everything it
needs to ask "what is at this point" and "what does this shot cross".

---

## 3. What is missing

1. **A player model.** The bag is 14 carry numbers and no spread. There is no
   handicap anywhere in the app; the only `hcp` in the codebase is the *hole's
   stroke index* on the card (§10).
2. **An expected-strokes baseline.** Nothing converts "you are 137 m out in the
   rough" into a number of shots, so nothing can compare two options.
3. **Round state.** The blueprint's gap matrix still reads *Scorecard, handicap,
   stats: Missing*. There is no notion of a round in progress, a score, or
   which shot you are on.
4. **OB as a surface.** `marking[]` is stake positions for rendering, and
   `ob-map-overlay.mjs` deliberately draws map annotations only. A strategy
   engine needs a polygon it can test a point against — OB is the most
   expensive miss in golf and currently the model cannot answer "is this OB".
5. **Pin positions.** Only the green centre and a `pin` that is provisional on
   several courses. Approach strategy without a pin is approach strategy to the
   middle, which is defensible advice but should say so.

---

## 4. Six measurements taken for this audit

### 4.1 The targets are small, and they are measurable

Over 171 holes of ten committed models:

| | p10 | median | p90 |
|---|---|---|---|
| Green area | 281 m² | **421 m²** | 568 m² |
| Green effective radius | 9.5 m | **11.6 m** | 13.4 m |
| Fairway width at the drive | 16.5 m | **27.0 m** | 45.0 m |
| Bunkers per hole | 0 | 2 | 4 |

Per course the spread is real and is a fact about the clubs: Norrfällsviken's
greens run 291 m² against Upsala's 548, and Ribbingsfors' pasture fairways
measure 68 m wide against Norrfällsviken's 21. A strategy engine calibrated on
one of these courses would be wrong on the others.

### 4.2 The closed-form inversion is wrong — do not ship it

The obvious first move is to read dispersion straight off the table: treat
"fairways hit" as one Gaussian crossing a band of the measured width and "GIR"
as a Gaussian inside a disc of the measured radius, and solve for σ.

| level | fairway % | implied lateral σ | GIR % | implied approach σ | σ as share of carry |
|---|---|---|---|---|---|
| Scratch | 56.5 | 17.3 m | 56.8 | 8.9 m | **7.5 %** |
| HCP 10 | 49.3 | 20.3 m | 37.3 | 12.0 m | 9.9 % |
| HCP 20 | 42.8 | 23.9 m | 22.4 | 16.3 m | 13.3 % |
| HCP 30 | 40.0 | 25.7 m | 14.0 | 21.1 m | 16.1 % |
| HCP 40 | 37.0 | 28.0 m | 8.0 | 28.4 m | 20.0 % |

Published shot tracking puts tour lateral dispersion near 3.5 % of carry and
mid-handicap play at 6–9 %. **Every row is about twice that.** The reason is
structural, not a bad constant: a fairway is a two-dimensional shape of varying
width, and a one-dimensional crossing of a fixed band is not the same question.
The approach column is more plausible (8.9 m at scratch is close to published
figures) because a green really is compact enough for the disc idealisation.

### 4.3 The forward simulation is the right instrument — and it over-predicts

Sampling the shot in two dimensions on the real holes, with published
dispersion and a seeded LCG:

| level | simulated fairway % | table | diff | water % | bunker % |
|---|---|---|---|---|---|
| Scratch | 69.7 | 56.5 | **+13.2** | 0.4 | 0.4 |
| HCP 10 | 63.9 | 49.3 | **+14.6** | 0.5 | 0.3 |
| HCP 20 | 53.9 | 42.8 | +11.1 | 1.1 | 0.1 |
| HCP 30 | 44.7 | 40.0 | +4.7 | 1.5 | 0.0 |
| HCP 40 | 34.1 | 37.0 | −2.9 | 1.7 | 0.0 |

A pure Gaussian aimed perfectly down the middle hits too many fairways. What it
lacks is the tail: the topped drive, the block, the snap hook. Real "fairways
hit" includes those and a Gaussian does not. **A strategy engine built on a
Gaussian will be systematically too aggressive**, because it under-prices
disaster — which is exactly the error a strategy feature exists to prevent.

### 4.4 Calibrating the constant fails, and the failure is informative

Solving for the spread that reproduces the table:

| level | target | assumed | calibrated | ratio | σ |
|---|---|---|---|---|---|
| Scratch | 56.5 % | 3.5 % | 6.1 % | 1.76 | 14.1 m |
| HCP 10 | 49.3 % | 5.0 % | 8.5 % | 1.71 | 17.5 m |
| HCP 20 | 42.8 % | 7.0 % | 10.5 % | 1.50 | 18.9 m |
| HCP 30 | 40.0 % | 9.0 % | 10.6 % | 1.18 | 17.0 m |
| HCP 40 | 37.0 % | 11.0 % | **9.2 %** | 0.84 | **12.9 m** |

The spread stops growing and then **shrinks**. A HCP 40 cannot be straighter
than a HCP 20. A one-parameter dispersion model therefore cannot be calibrated
across the handicap range on real geometry, and no amount of retuning fixes it.

### 4.5 Why: for a short hitter the binding constraint is reach, not accuracy

| carry | holes | centreline on mown fairway |
|---|---|---|
| 120 m | 129 | **32.6 %** |
| 140 m | 129 | 48.8 % |
| 160 m | 129 | 65.1 % |
| 180 m | 128 | 71.9 % |
| 200 m | 128 | **78.1 %** |
| 230 m | 127 | 77.2 % |

The median fairway **starts 140 m from the tee** (p10 30 m, p90 200 m) and ends
21 m short of the green. So a HCP 40 carrying 140 m lands where mown fairway
exists on fewer than half of these holes: their fairway rate is capped by where
the club mows, not by how straight they hit it.

These fairway rings are traced mown turf, not synthesised corridors. Over all
171 holes: 54 carry an orthophoto provenance
string (33 `lm-orthophoto`, 21 `reviewed-lm-orthophoto`), 28 are OSM, 17 are
dated-orthophoto trace or retirement, 9 are classified Esri imagery, 4 are
satellite, and the remaining 54 — all of Visby, Lidingö and Tortuna — are the
reviewed intakes of the three `mapped-only` builds. Just 5 holes in the whole
set are plan-drawn or carry no provenance at all. So this is a property of the
ground, not of a drawing.

**This is the single most useful thing the audit found**, and the infographic
says the same thing in words: *Högre handicap = längre till green*. It changes
what the feature should say. Telling a HCP 30 to "hit the fairway" is advice
about a target they cannot reach. Telling them *where their two shots put them*
and *which side of the green leaves the easier third* is advice about the game
they are playing.

### 4.6 It is affordable, on a heavy hole

An aim search on Ängsö's 1st — par 4, 383 m, and carrying 14 water rings of
3,629 points between them, which is the kind of geometry that makes a raw ring
test expensive — using raw ring tests:

| grid | samples each | shots | ms |
|---|---|---|---|
| 21 | 200 | 4,200 | **40** |
| 41 | 400 | 16,400 | 155 |
| 81 | 800 | 64,800 | 604 |

40 ms for a 21-point search, once per hole change — the same cadence
`buildStrategy()` already runs at. And this is an upper bound: the engine
answers the same question from the atlas in O(1) inside CORE, where this walks
every ring edge. **Do it on hole change, never per frame.**

---

## 5. "Läge" is being asked to mean three different things

This is the main conceptual finding. Untangling them is what makes the feature
designable; conflating them is how it becomes a settings screen nobody uses.

**A. Who is playing — the profile.** One handicap, or a measured bag plus a
spread. Set once, persists, changes every number in the app. This is the player
model §3 says is missing.

**B. How they want to play this shot — the stance.** Säker · Normal · Offensiv.
Same player, same hole, different appetite for the water on the right. This is
*not* a different model; it is a different weighting inside one objective
function, and it belongs next to the shot, not in settings.

**C. What the app is doing — the session mode.** Utforska (today's behaviour),
Runda (a scorecard and a position), Träning (one hole, repeated), Visning
(kiosk, already exists). This decides which HUD surfaces are present and
whether anything is being recorded.

They are independent: a HCP 20 can play offensively in a practice session. Build
them as three values, not one enum, and only B needs to be reachable in one tap
from the course.

---

## 6. Proposed architecture

The rule the repo already follows: arithmetic is a pure module with a test, the
renderer reads it, the HUD renders it, a gate measures the result. Five new
pure modules and no new rendering system.

```
engine/player-profile.js   handicap or measured numbers -> {carry[], lateral, distance, shortGame, putting}
                           persisted 'banvy-player-profile-v1', try/catch like the bag
engine/dispersion.js       seeded sampler; Gaussian core + an explicit miss tail (§4.3)
engine/expected-strokes.js E[strokes | lie, distance] with a CITED source, shifted per profile
engine/shot-planner.js     aim search over classifyAt -> {aim, outcomes{}, expected, alternatives[]}
engine/round.js            session state: hole, strokes, ball, stance; no DOM
```

Existing code changes shape only at its edges:

- `strategyForHole(hole, teeIndex, bag)` → `strategyForHole(hole, teeIndex, profile)`.
  The bag becomes one field of the profile; the return grows `outcomes` and
  `expected` beside the existing `zones` and `arcs`. Every current caller and
  `V3D.caddie()` keep their shape.
- `buildStrategy()` gains one more ellipse. `strategyEllipse` already draws an
  along/across ellipse on the terrain from a zone's two radii — a dispersion
  ellipse *is* that, with radii from the profile instead of constants.
- Kikaren's sheet gains one row: expected strokes for the tapped target, and the
  stance control. It is already the shot-level surface and already re-renders
  only what changed (`kikSwap`).
- `kikKindAt` gains `'ob'` once OB is a polygon, and `lineHazards` carries it
  through unchanged.

---

## 7. What each mode would actually show

| | Profile | Stance | What changes on screen |
|---|---|---|---|
| **Utforska** (today) | ignored | — | Nothing. This must stay exactly as it is; it is the course-viewer product. |
| **Min nivå** | HCP | Normal | The Spellinje landing zone becomes *your* dispersion ellipse, not a fixed 16×24 m. The label reads "68 % fairway · 4 % vatten" instead of a club name. |
| **Säker** | HCP | Säker | Water and OB weighted 3–4× their stroke cost. On a hole with trouble the aim moves to the safe side and the club shortens; on a clean hole it does not move at all — and *that* is the honest answer. |
| **Offensiv** | HCP | Offensiv | Penalty weights near their true stroke cost. Shows the line a good round is made on and what it risks. |
| **Runda** | HCP | per shot | A scorecard, the ball where you left it, the next shot planned from there, and a per-hole recap at the end: strokes lost by category, in the infographic's own four buckets. |
| **Träning** | HCP | any | One hole, replayed. "Where does my ball actually finish", and the closest-to-pin and approach games the ranges have proved people play. |

The recap is where the infographic pays off as a *product* and not just as
calibration: a golfer who has never seen a strokes-gained breakdown of their own
round gets one, in Swedish, against a table they can place themselves in.

---

## 8. Data the feature needs and the repo does not have

| Need | Status | How to get it honestly |
|---|---|---|
| The player's handicap | Nothing | Ask once. Do **not** reimplement WHS — the blueprint's own decision is to link out to Min Golf for handicap registration, and that is right. |
| Dispersion per handicap | The table, uncalibrated | Forward-simulate and fit per §4.3–4.5, with a miss tail. Store the fit as committed evidence with the course set it was fitted on. |
| Expected strokes by lie and distance | Nothing | A cited published baseline (Broadie's tables are the standard). Do not invent coefficients; an uncited table here is the same error as an unsourced club colour. |
| OB as testable polygons | Stake positions only | Derivable from `marking[]` colour `w` plus the property boundary, the way Veckefjärden's OB runs were derived. A real piece of pipeline work. |
| Pin positions | Green centre; `pin` provisional | Front/middle/back from the green ring is cheap and honest; a club feed is the real answer and is already Tier 1 of the blueprint. |
| Green contours for putting | 1 m DTM at best | **Do not build putting strategy.** The repo has already measured that greens cannot be resolved at this scale. The table shows putting is the *smallest* loss at every level anyway. |

---

## 9. Gates this feature would have to pass

The acceptance gate writes itself, and it is a good one:

> **Simulate every one of the ten committed courses at each of the five levels
> and reproduce the infographic's fairways-hit and GIR columns within two
> percentage points — with a dispersion model whose spread increases
> monotonically with handicap.**

§4.4 shows the naive model fails that today, which means the gate has teeth
before a line of feature code is written. Two rules from CLAUDE.md apply
directly. *Write the probe that makes a new gate FAIL before believing it
passes* — feed it the §4.4 numbers and watch it reject them. And guard against
circularity: the geometry must not be fitted to the same table it is checked
against, so fit on a subset of courses and check on the rest.

Beyond that:

- **Unit tests** beside `rangefinder.test.mjs` and `caddie.test.mjs` for every
  arithmetic function. Same house style.
- **`?det=1` must stay bit-identical.** The sampler has to be seeded — the repo
  already has `lcg` in `geobuild/lib.mjs` and the feasibility tool uses it. An
  unseeded `Math.random()` in a dispersion ellipse breaks parity on every
  golden view.
- **`check-strategy-stress.mjs`** already measures the live animation path of
  this exact layer; extend it rather than writing a second one.
- **`check-caddie-ui.mjs`** measures the phone layout at 390×844, and
  `check-markers.mjs` gates the rail at six widths including *the open rail
  sheet clears the top of a 420 px phone*. Adding a rail row has a measured
  cost and can fail a gate — see §10.
- **`check-app-build.mjs`**: no static import that changes the chunk graph.

---

## 10. Traps specific to this repo

1. **`hcp` already means the hole's stroke index.** `card.json` carries
   `hcp: 10` per hole and `course-model.json` carries the same value as `idx`.
   A player handicap field called `hcp` will collide with card code in both
   directions. Call it `playerHandicap` and never abbreviate it.
2. **The rail is full.** Kameravy, Ljus, Turer, Verktyg, Visning — and the sheet
   is already gated against overflowing a 420 px phone. The stance control
   belongs in the Kikaren sheet (shot-level, already open when you are choosing
   a shot), not as a sixth rail group.
3. **New URL keys must enter `VIEW_KEYS`** in `shell/router.js`, and the
   router's rule is absolute: every historical URL still resolves to the same
   view. A `?lage=` that changes what an old link shows is a regression.
4. **A recommendation is a model and must be labelled as one.** This repo
   refuses to print a green outline as a measured contour or a roof colour read
   from a dark photograph. "Sikta 8 m vänster" is a far stronger claim than
   either. It needs a visibly different voice from the distances — the same
   separation the docs keep between recorded geography and rendering estimates.
5. **Do not contradict the club's own hålguide.** There is precedent:
   where the club's text and the model disagree, the notes say neither. If the
   club writes *sikta höger om bunkern* and the planner says left, show the
   club's words and the planner's number as two things, and never overwrite
   `hole.note` — Lidingö's `apply-reviewed-surfaces.mjs` did exactly that once
   and had to be unwound.
6. **`localStorage` reads must be wrapped.** The bag and the Spellinje
   preference both already `try/catch`; private browsing throws.
7. **Course-to-course variation is large** (§4.1). A constant tuned on
   Veckefjärden is wrong at Norrfällsviken by a factor on green size and at
   Ribbingsfors by a factor of three on fairway width.

---

## 11. A staged plan

Each stage is shippable and each is honest on its own.

**Stage 1 — the profile and the ellipse.** One dialog beside *Min bag*: a
handicap, or the bag plus a spread. The Spellinje landing zone becomes the
player's own dispersion ellipse with an honest label ("64 % fairway"). No
advice, no aim change — just *this is your shot pattern on this hole*. Reuses
`strategyEllipse` and `strategyForHole` almost unchanged. **Small.**

**Stage 2 — the stance and the aim search.** Säker/Normal/Offensiv in the
Kikaren sheet; `shot-planner.js` moves the aim point; the overlay animates to
it. Needs the expected-strokes table and OB. **Medium**, and the first stage
where the app gives advice — so it is the stage the labelling rule in §10.4
must be settled at.

**Stage 3 — the approach, which is where the strokes are.** Expected strokes
for the tapped target in Kikaren, and "which side of this green leaves the
easier next shot". Aimed straight at the biggest column on the sheet. **Medium.**

**Stage 4 — Runda.** Session state, a scorecard, the ball carried between shots,
and a per-hole recap in the table's own four buckets. Closes the gap matrix's
last *Missing* in the caddie tier. **Large**, mostly UI and state.

**Stage 5 — the table as a gate.** The calibration harness of §9 as CI, plus the
"vad kostar det dig" screen that places the golfer's own round against the five
columns. **Medium**, and it makes every earlier stage falsifiable.

---

## 12. What I would do first, and it is not in the list

**Tell people which tee to play from.** It needs no new model, no dispersion, no
expected strokes and no OB: the card already carries every tee's length per hole
and the manifest carries every tee's name and colour. A handicap plus a driver
carry is enough to say *this course plays 5,804 m from the tee you are standing
on and 4,743 m from the next one forward*. The infographic is precisely the
evidence for why that matters: it is the difference between the 22 % GIR row and
something a HCP 30 can reach in regulation at all.

Veckefjärden's own six columns are 6436 / 6121 / 5804 / 5502 / 4743 / 4043 m,
and the app opens on the third — so a HCP 30 is started on 5,804 m of golf by
default. The card knows 4,743 m exists; nothing in the app has ever mentioned it.

It is one dialog and one line in the card, it is the highest-value change on
this page per hour of work, and it is the only one where the table can be quoted
directly rather than calibrated. One caveat it must respect: Veckefjärden and
Upsala name their tees by course rating ('58', '48'), not by colour, so the copy
has to read the manifest's names and never hard-code "Gul" or "Röd". The stage-1 dispersion ellipse is the next
thing, because it shows the player something true about themselves without the
app yet claiming to know better than they do.

---

## Appendix — the tool

`tools/strategy-feasibility.mjs` exports `HANDICAP_TABLE` (the infographic,
transcribed with its sources), `ASSUMED` (the only quantities that are neither
measured here nor from the image, named as such), and the six measurement
sections as functions, so a later implementation can import the transcription
rather than retyping it. It reads committed models only, it never writes, and
it needs no network, credentials or browser.
