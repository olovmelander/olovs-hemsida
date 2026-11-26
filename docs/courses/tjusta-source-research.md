# Tjusta Golfklubb: source research and intake

Research date: 2026-11-26. This dossier records the sources gathered for **Tjusta Golfklubb**
(`groundId: "tjusta"`, one 18-hole routing `tjusta`, par 72) at Tjusta Gård, 195 96 Rosersberg, Sigtuna
municipality, south-east of Arlanda. Raw Lantmäteriet photos and laser, and the club's and third parties'
media, stay in the ignored `tjustabuild/cache/`. Only checksummed ledgers, factual card data and vector
derivatives are committed.

## 1. Where the course is, and what is not Tjusta

- The clubhouse is the red barn with the gambrel roof at Tjusta Gård (about E 669,115 N 6,611,345, SWEREF 99
  TM; 59.6060 N, 17.9971 E). The club's own photographs show it from the 18th green and across the farm pond,
  and 18Birdies places the club at 59.60692 N, 17.99712 E, by the car park.
- OpenStreetMap draws the course as way 171945030, misspelt "Tjulsta Golfklubb" (its website tag is
  tjustagolf.se). That outline also takes in a separate, heavily bunkered golf facility south of Tjusta, with a
  white clubhouse near E 669,600 N 6,610,370 and holes running south and west from it. It is not Tjusta's
  (Tjusta has one 18-hole course; its holes are bounded by farmland, the other facility by forest), and
  nothing here names it. Its features are not used. Hole19's page for Tjusta also shows an aerial photo of
  that clubhouse among Tjusta's pictures, so third-party pictures are not trusted for routing.
- Kyssinge (Golfstar) is 4.5 km further south (59.550 N, 18.038 E), Arlandastad 6.5 km west.

## 2. Frame and terrain (stage 2)

- **Frame:** one 4,096 m LOD0 square centred on E 669,130.5, N 6,611,250.5 (`tjusta-ground-graph.mjs`,
  `tjusta-ground-rings.mjs`), the middle of the box round the 18 holes and the practice ground: about 1.2 km
  of margin north and south and 1.4 km east and west. All seven rings read the same four 10 km DTM items:
  660_66, 660_67, 661_66, 661_67 (the square crosses E 670,000 and N 6,610,000). The first frame was centred on
  OSM's course outline, 645 m further south, because that outline also takes in the southern facility; it was
  moved before anything was built on it.
- **Terrain:** `build-ground-rings.mjs --ground tjusta` (2026-11-26): seven levels, LOD0 9.7-62.7 m RH 2000,
  every sample finite. The record's date (2025-06-14) is the mosaic's newest patch; the items' flights run
  from 2021-03-23 to 2025-06-14.
- **Laser:** one leaf-off campaign, 21c038 (2021-04-17), four COPC tiles, 55.2 M points, 1.48-2.24
  returns/m². Pinned without Skogsstyrelsen's scan-area layer.
- **Water:** 29 break-geometry polygons in the square, 11.4-30.0 m RH 2000: the farm pond on 18, the west pond (10, 12),
  the pond by the 11th green, the small pond between the 7th and 14th greens, the ponds west of the wide field
  and the long wetland south of it.

## 3. Photographs

- **Leaf-on, for tracing:** `orto-o2-2025`, 2025-06-14 07:14-07:20 UTC, native 0.16 m RGBI: six windows of about
  1 × 1.15 km and one 0.32 m overview (`tjustabuild/run-ortho-intake.mjs`).
- **Leaf-off, the second year:** `orto-o2-2021`, 2021-04-18, one 0.32 m overview. In April the mown turf is
  green against dry ground: the fairways, tee decks and greens stand out, which is what the routing was read
  from.
- **A third and a fourth year** (`run-ortho-intake.mjs --only 2023,2019`): `orto-o2-2023`, 2023-05-10, 0.25 m, and
  `orto-o2-2019`, 2019-07-20, 0.25 m, both over the course's box. May 2023 is the year the outlines were settled
  on: every putting surface is one even colour against its collar, the mown fairways are striped, and the sun
  stands differently from 2025. It showed the 4th hole's yellow tee deck (built after the laser, in shade in 2025)
  and that the sand-bright strip by the 18th tees is a 2.5 m trench. 2019 added nothing the others did not show.

## 4. The card

The club publishes **no hole-by-hole card and no hole map**. What it publishes:

- the SGF slope tables (`slopekalkylator`, PDFs of 2023-03 and a poster of 2026-04): Tjusta GK, **par 72** for
  men and women, rated **2020-08-01**; Gul CR 71.2 / slope 127 (men) and 77.3 / 142 (women), Röd 66.9 / 117 and
  71.9 / 130. The tables' handicap bands reconcile with par 72 and not with par 71 (at par 71, index 0.3 would
  give playing handicap 1, not the printed 0);
- the local rules (2023, valid from 2025): out of bounds left of the road on 1, left of the service road on 6,
  left of the road on 7, right of the field on 11, right of the ditch and field on 13; a coffee break after 9;
- photographs: the clubhouse, the farm pond and reeds on 18, the range, the putting green.

Hole by hole (`tjustabuild/reference/club-scorecard.json`, verified by `verify-scorecard.mjs`):

| Source | Par | Tees | Notes |
| --- | --- | --- | --- |
| **Golf i Sverige** (golfisverige.com, scorecard and hole plates) and **Caddee** (caddee.se), read 2026-11-26 | 72 | Gul 5,878 m and Röd 4,959 m, per hole | agree cell for cell; **the card used** |
| Hole19 | 72 | Röd per hole (5,011 m); Gul 5,906 m total | differs on 16 of 18 indexes and on Röd 4, 6 and 16 (`club-scorecard-hole19.json`) |
| All Square, GolfPass, 18Birdies | 71 | Vit 6,064, Gul 5,833, Röd 4,905 m per hole | the older layout: 16 a par 4 at 350/290 m (`club-scorecard-par71.json`) |

Two guide publishers agreeing cell for cell outweigh one user-maintained card, and Golf i Sverige's plates
print each hole's lengths beside its drawing. A first draft took Hole19's card and derived Gul 16 from its
total (423 m); that was replaced when the guide publishers were found, and nothing is derived now.

**Open for the club or the owner:** a printed card from the club, to confirm the guide publishers' index.

## 5. Mapping (stage 3, 2026-11-26)

OSM has the course's outline, 19 greens, 6 tees, 8 fairways and 4 bunkers traced from Bing (about 2012), and
no `golf=hole` ways. The routing (`tjustabuild/mapping/decisions.json`, written by `make-decisions.mjs`) was
first read on both photos: every green a component of the turf model and every tee a level deck of the 1 m
terrain, both from the tracer's own detectors, ordered by the card's lengths, the local rules, the coffee
break after 9 and the club's photo of 18. The first look and a blind second look then doubted many tees, and
Golf i Sverige's 18 hole plates were found (photos of each hole with the yellow tee and the flag drawn on).
`packages/course-geo/mapping/register-guide-plates.py` finds each plate's photograph on the 2025 photo (masked
normalised cross-correlation over rotation and scale, the scale bounded by the card's length against the
drawn tee-to-flag distance) and reads both marks in SWEREF 99 TM (`tjustabuild/mapping/guide-plates.json`).
They confirmed 1, 2, 3, 5-8, 13, 14 and 17, and moved four things: 9 and 16 had been swapped; 10 tees from a
clearing south of the row house, not the farm yard; 15 tees from the north arm of the deck whose lower part is
8's; and 4, 11 and 18 tee from the deck next to the one first chosen. In short:

- 1 east from the car park, 2 north over Kimstavägen to the north corner, 3 a par 3 back south-east, 4 round a
  dogleg to the green by the road, 5 south down the long fairway by the wetland;
- 6 a par 3 to the green by the service road, 7 south down the meadow, 8 west across the wide field, 9 north up
  the west corridor to the ringed green south of the black barn;
- 10 west from the clearing round the north of the west pond, 11 south down the strip by the ditch and field,
  12 a par 3 over the west pond's edge, 13 east-south-east along the ditch, 14 east across the wide field;
- 15 north-west out of the field from 8's deck, 16 north up the middle corridor, 17 a par 3 to the round green
  east of the 1st fairway, 18 round the farm pond to the barn.

The plates are drawings and never place an outline: they say which deck and which green, and the photo and the
laser say where they lie.

Two changes to the shared tools were needed, both data-driven and neutral for Bro Hof:

- the turf model trains on the decisions' own hole lines when OSM has no hole ways (`decision_lines` in
  `trace-course-surfaces.py`);
- the sand rule became numbers (`SAND_BANDS`, `sand_spec` in `turf_tracing.py`), and a ground with sand of
  another colour states its own, measured, in its `trace-config.json` (`sand`). Tjusta's raked sand is tan,
  not white: brightness 137-169, NDVI −0.20 to −0.25, warmth 18-26 against turf at 98-110 and +0.08 to +0.24.
  The audit (`audit-sand.py`) reads the same bands.

Sand: 14 raked bunkers kept of the tracer's bunker candidates (`sand-decisions.json` says what the rest are); no
waste areas. One, in the 7th fairway, is trimmed of a bare patch on its lip (`trimMetres`).

**Fairways.** The first trace learned "fairway" from OSM's six outlines of 2012 and drew fragments; the second
read the April 2021 photo alone. Neither held. The fairways are now taught from the holes' own lines
(`training: "decision-lines"`: the 7 m either side of a par 4's or 5's line, against the ground 26 to 55 m from
every line), on three photo years with a model each (2025, 2023, 2021; the fairway is what they agree on), with
the drought photo's vegetation line lowered (`ndviAbove: 0`) and the mown ground shared out to the nearest hole
line within 55 m. **The models are fitted to convergence** (`fit: "settled"`): in the tracer's fixed 900 steps
they never settled, and three hole lines moved 2 m took a quarter off the 18th fairway. 36 pieces, 18.0 ha.

**Greens.** The turf model's green component runs to the collar's outer edge, the strongest edge on the dry 2025
photo, and the edge search begun there stayed there: every green came out 20 to 100% too large (the 3rd was drawn
at 427 m2 and is 213), which neither look saw at sheet scale. With the contrast of the photo stretched the putting
surface, its collar and the rough stand apart. Six greens (2, 4, 5, 9, 11, 14) are now traced from a start 2.5 m
inside the component (`greenInsetMetres`), and twelve are ovals or a closed curve fitted on the photo, each with
what it was read from in `decisions.json`: 6.3 ha became 0.63 ha of putting surface in all. Two limits remain.
On the 2025 photo each surface ends in a pale band a metre wide, its last mowing pass, which May 2023 shows to be
putting surface; a ring may lie on either edge of it, so **a green's edge is good to about a metre**. And the
**10th green's front** has no rim on any year: its mown tongue runs on as the approach, and its east side lies in
the wood's shadow on all four. It is drawn by hand, its front set where the 2021 leaf-off photo turns from green
to dormant turf, and may be 3 m out.

### The checks at the end of stage 3 (2026-11-26)

- **Tee marks against the card:** median residual 0.1 m over 36 marks; four over 5 m, each measured, not fitted:
  18 Röd −13.7 m (the plate draws no red tee; the deck used is the laser's level mown rectangle beside the plate's
  line), 4 Röd −8.9 m (no red box shows on any photo year; the level platform ahead of the yellow deck),
  18 Gul −6.3 m (the mown rectangle with a tee marker, where the plate puts the tee), 11 Gul +6.4 m (the plate's
  bend, drawn four fifths as wide; a round's tracks would settle the line).
- **Decks:** 33 of 36 measured decks are level in the laser. 4 Gul (6.3%) is the back deck built after the laser
  was flown, drawn on the May 2023 photo; 10 Röd (6%) is a round mown platform drawn on the photo; 18 Gul is drawn
  on the photo, level but 0.13 m off a plane (the April 2021 photo shows only its north-east half mown: it was
  lengthened since).
- **The ground's age:** six bunkers (7 ×2, 11, 13 ×2, 16) are sand on the 2025 photo and turf on the April 2021
  photo, and lie in no bowl in the terrain: they were built after the laser was flown, and are drawn as flat sand.
  So was the 4th hole's yellow tee deck.
- **Sand audit:** every bright area outside the model has a verdict (field strips, ditch banks, the farm yards,
  roofs, gravel, a sand heap by the path west of the wide field); no missed bunker.
- **Ring review:** every ring looked at on four photo years, the greens also on the stretched photo, and recorded
  against the exact outlines; a blind second look (`.claude/agents/ring-reviewer.md`), taken again each time
  the outlines changed, and every one of its doubts answered (`tjustabuild/mapping/ring-review.json`). The
  walkthrough prints the faults that stand.

## 6. Into the app (stages 5 and 6, 2026-11-26)

- **Production:** `course-workflows/tjusta/production.json`, a first generation compiled from the source terrain
  (no baseline), automatic trees, and the land cover as a sidecar. The six stages pass through validate; the
  candidate is promoted (the catalogue's sixteenth course). The quality gate has no error and no warning, and the
  water audit finds every pond near play standing as the accepted ponds do.
- **Land cover:** `tjustabuild/landcover.json`, Lantmäteriet's 0.5 m orthophoto through the Min karta WMS at
  4 m, classed per 12 m cell out to 6.4 km and fitted on the ground's own published stand fields (trees 88%, open
  ground 81%). Its water rule needs 2,000 labelled cells and the ponds give 523, so it finds no far lake; the lakes
  are drawn from the laser's level ground, never from this record.
- **Roofs:** 205 of 216 mapped roofs take their colour from the 2025 orthophoto
  (`geobuild/facilities/roof-colours/tjusta.json`); the photo and the footprints agree without a shift.
- **The scenery module** (`apps/golf/src/engine/scenery/tjusta.js`): tan sand measured in the bunkers, the ponds'
  beds carved with the world, species by place, and the clubhouse as the club's photographs show it, a nearly
  windowless falu-red barn.
- **The first look:** 24 pictures of the detailed course and two of the phone map on the GPU, before any bake
  (`tools/goldens/gfx/tjusta-look*`, not in git). One fault: the clubhouse was drawn with forty windows.

The walkthrough ([tjusta-walkthrough.md](tjusta-walkthrough.md)) carries what is known not to be right.

### Open for the club or the owner

1. **The routing.** Confirmed by golfisverige.com's plates on 16 holes and by eye on the two par 3s whose plates
   do not register; no club source. A club map, or the owner's rounds extract (`tools/rounds-evidence.mjs`),
   would settle it.
2. **The red tees on 4 and 18,** which no plate draws.
3. **The 10th green's front,** which no photo shows (see Greens above): a walk round it, or a round's putts.
4. **The card:** a printed card from the club, to confirm the guide publishers' index.
