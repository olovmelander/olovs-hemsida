# Ängsö Golfklubb: walkthrough

Ängsö Golfklubb's eighteen lies on the peninsula north of Ängsö in Mälaren, east of Västerås: Åke Hultström's course
of 1985, among oaks, ponds and brooks, with five tees on every hole. It was built in September 2026 with its own builder
from Lantmäteriet's April 2025 photo ([the orthophoto alignment](angso-orthophoto-alignment.md),
[the tee alignment](angso-tee-alignment.md), [the course atlas](angso-course-atlas.md)), and on 27 November 2026 it was
brought under the looks of [pipeline v2](../pipeline-v2.md): its outlines exported for the ring sheets, four photo years,
the laser under every deck, a blind second look, and a decision file for every tee colour.

<!-- generated:summary -->
## What is there

|  | Ängsö |
| --- | --- |
| Holes and par | 18, par 72 |
| Tees on the card | Vit 6,289 m, Gul 5,850 m, Blå 5,200 m, Röd 4,521 m, Ora 3,597 m |
| Greens, tee decks, fairways, bunkers | 18, 52, 18, 33 |
| Waste areas | none |
| Tee marks against the card | 90 marks, median 0.1 m, 75 within 5 m, worst 19.9 m (hole 14, Vit) |
| Outlines looked at ring by ring | 2026-11-27: 144 rings, 0 redrawn |
| A second, blind look at them | 2026-11-27: 15 doubts, 13 stand, 2 kept as faults; 5 it could not judge |
| Tee decks on level ground in the terrain | 37 of 52 measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2020-02-24 to 2021-04-10, photo 2025-04-24, laser 2021-03-20), 14 lakes and ponds, 17 creeks and ditches, 0 bridges. Generation `0327367adaf0`.
- **The ground's age:** where the course is newer than the terrain under it, by what was measured. Ängsö 1 (1 bunker built or reshaped since the 2019-07-14 photo, 1 deck not on level ground); Ängsö 6 (1 bunker built or reshaped since the 2019-07-14 photo, 2 decks not on level ground). Tee decks only: Ängsö 2 (1), Ängsö 7 (2), Ängsö 8 (2), Ängsö 11 (1), Ängsö 12 (1), Ängsö 13 (1), Ängsö 14 (1), Ängsö 15 (1), Ängsö 18 (2). A deck that is not level is newer than the terrain or off its deck; both photo years say which. The older photo cannot say for 12 bunkers in shade.
- **Sand:** the 2025-04-24 photo was read round every hole against the model's 33 bunkers and waste areas: 3 of them hold little sand or have sand outside their line, and 69 areas of bright sand are not in the model, 69 of those on nothing the map holds. Each has a verdict; 2 are kept as a fault.
- **Trees:** automatic (234 object tiles, 256 stand tiles); not placed one by one.
- **Buildings:** 142 mapped, 131 with a roof colour measured on the photo; an authored campus of 19 parts (B01, B03, B04, B04a, S06, B05, B06, B07, B08, B09, B10, B11, B12, B13, S07, S01, S02, S04, S05), 84,653 triangles.
- **Quality gate:** 0 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: facilities-v1: triangle count 84653 exceeds advisory budget 80000.
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `canonical-origin`, `authoritative-assets`, `legacy-imagery-rights`.
- **Faults the second look and the sand audit found, kept until they can be put right:**
  - `angso-tee-18-4`: Rebuilt in 2019 (a deck under construction on 2019-07-14); today's ring covers the west half of the deck and the bank beside it, and the terrain under it slopes 17.5%. Redraw the ring on the deck from the 2025 photo at full scale (lm-review-back9-tees.json), rebuild, and measure it again with deck-ground.mjs.
  - `angso-tee-12-1`: A path crosses the ring's north-west end on 2019-07-14 and runs past it on 2025-04-24, and the terrain under the ring slopes 11.1%: the ring takes in the path and the brook's bank as well as the deck. Redraw it on the deck east of the path from the 2025 photo at full scale (lm-review-back9-tees.json), rebuild, and measure it again with deck-ground.mjs.
  - `sand-006`: A bunker of 38 m2 by a green east of hole 1's tees that belongs to no hole: a practice green and its bunker, on both photo years. The model has no practice green or bunker at all (scenery.greens and scenery.bunkers are empty). Add the practice area to the model's scenery from the 2025 photo, then rebuild the ground's surfaces.
  - `sand-068`: A kidney-shaped bunker of 81 m2 by the clubhouse, 72 m from the 18th green, on both photo years: the practice bunker. Not in the model, which has no practice bunker. Add it to the model's scenery from the 2025 photo, then rebuild the ground's surfaces.
<!-- /generated:summary -->

## What is known not to be right

- **Holes 5 and 14 read long against the card, every colour alike.** On 5 each tee is 11 to 16 m longer than its card,
  on 14 15 to 20 m. The decks stand in the card's order on all four photo years and each holds its colour, so the tees
  are not what is long: the drawn hole lines are. Hole 14's turns its dogleg square (177 m south, then two bends) where
  the club's measured line cuts the corner, and hole 5's runs five legs round its dogleg. Their marks were left as
  September placed them (`kept` in `angsobuild/mapping/tee-decisions.json`). What would fix it: redraw the two lines
  along the line a player takes, then let the decisions stand each colour at its card length.
- **Three colours still have no deck.** Hole 8's Vit and Gul stand under the conifer canopy north of deck 1 on all four
  photo years, and hole 9's Vit (143 m) lies behind the reviewed deck, which ends at 137 m. They stay September's
  unresolved virtual points and draw no tee markers. What would fix it: read the laser for a level platform at their
  card lengths (`deck-ground.mjs --around`), or the rounds (`tools/rounds-evidence.mjs`), whose extract is the owner's.
- **Fifteen tee decks are not level in the terrain** (`deck-ground.json`; Bro Hof's decks mostly slope under 2%):
  - newer than the terrain: hole 1's Vit (deck 1, the new back tee, 4.4%, built on ground felled after the laser of
    2021-03-20);
  - the ring is off its deck, and both are kept as faults by the second look: 12-1 (Blå/Röd, 11.1%: the ring takes in a
    path and the brook's bank) and 18-4 (Röd, 17.5%: the ring covers the west half of the deck and its bank);
  - unsorted: 02-1 (Vit/Gul, 3.1%), 06-1 (Röd, 9.9%), 06-3 (Vit, 18.9%), 07-2 (Gul, 15.6%), 07-3 (Vit, 5.8%), 08-1 (no
    colour, 6.6%), 08-2 (Blå, 3.9%), 11-3 (Vit, 2.5%), 13-3 (Vit, 2.1%), 14-2 (Blå, 5.8%), 15-2 (Gul/Blå, 2%), 18-1 (Vit,
    12.6%). 06-2, 06-3 and 07-2 lie under crowns that the second look could not see through.

  Ängsö's decks keep the measured ground (`preserveTerrain`), so a ring that takes in a bank is drawn as a tilted tee.
  What would fix it: redraw each ring that is off its deck in its review fragment (`lm-review-back9-tees.json` for 12-1 and 18-4)
  from the 2025 photo at full scale (both need the pinned photo windows, which `lm-ortho-acquire.py` fetches again:
  their pixels reproduce exactly, their TIFF containers do not, see below), and reshape the ground under a deck that is
  newer than the terrain, which is a new ground generation and a bake.
- **Six marks stand at the end of a deck too short for their card:** hole 1 Blå +9.6 m (the south end of the long strip),
  6 Röd +6.3 m, 13 Vit -5.2 m, 9 Blå +5.0 m, 8 Blå +4.8 m and 6 Blå +4.5 m. Each deck is the one the photos and the card
  agree on; the club's marker is somewhere on it.
- **Every tee position is a representative one.** A colour stands where its card length falls on its deck, or on the
  fairway for the 16 orange tees and hole 10's red; nobody has seen where the club sets its markers on a given day.
- **The old builder's source check cannot be run again as it was.** `combine-orthophoto-review.mjs` checks the 19 pinned
  photo windows by the checksum of their TIFF files. Fetched again on 27 November with the pinned plan, every window's
  pixels match September's (all 19 RGB previews are byte for byte the pinned `rgbSha256`), and every TIFF differs, because
  the GDAL that writes them is newer. The tee decisions are applied after the review for that reason, and never through
  the combiner. The September tee evidence (`angsobuild/cache/tee-placement`) is not on this machine either.
- **The boar fence right of holes 6 and 16 is barely staked.** Its white stakes were placed at the woodland edge of a
  tree-cover raster (`build-marking.mjs`), and that edge runs across both holes' play: in Spela 209 of 2,386 good shots
  onto the 6th's own fairway or green and 248 of 1,114 on the 16th were out of bounds (`tools/out-of-bounds-shots.mjs`,
  which came to the quality gate from Veckefjärden on 27 November). `reconcile.mjs` now takes out the fewest white
  segments that leave no good shot out: 64 of 334, 40 of the 6th's fence and all 24 of the 16th's right fence. Every
  other white run stands, the white-and-black stakes between the 5th and 6th among them. What would fix it: trace the
  fence itself from the photo (it shows as a line through the wood) and draw its stakes there.
- **The practice area is missing.** The sand audit found two bunkers that belong to no hole, on both photo years: a 38 m2
  bunker by a practice green east of hole 1's tees (`sand-006`) and an 81 m2 practice bunker by the clubhouse (`sand-068`).
  The model has no practice green or bunker at all (`scenery.greens` and `scenery.bunkers` are empty). What would fix it:
  add the practice area to the model's scenery from the 2025 photo, then rebuild the ground's surfaces. The audit reads
  Ängsö's own tan sand (`sand` in `angsobuild/mapping/trace-config.json`, measured on the 33 bunkers); on the April photo
  gravel, roofs and dormant ground share its colour, so it also named 67 areas that are not sand, each with its verdict.
- **`angso-bunker-01-2`:** a small pale patch touches its south-west edge on the 2025 photo, beside what look like people;
  the second look could not tell a missed piece of sand from a golf cart, and the 2019 photo shows nothing there.
- **The trees are automatic,** the campus model is 84,653 triangles against an advisory 80,000, and the release is advisory
  with its frame pending control approval and the legacy imagery's rights open.

## Worth looking at

- **Hole 1 from Vit and from Gul** ([Vit](https://banvy.olovmelander.workers.dev/?bana=angso&hal=1&vy=tee&tee=1),
  [Gul](https://banvy.olovmelander.workers.dev/?bana=angso&hal=1&vy=tee&tee=2)): the owner's report. Vit stands on
  the new back deck in the felled ground at 386 m; Gul and Blå share the long strip east of the path.
- **Hole 10 from Blå and from Röd** (`tee=3`, `tee=4`): Blå on the small deck 90 m up the hole, which carried Röd
  until tonight; Röd on the fairway at 386 m.
- **Holes 13, 17 and 18 from Ora** (`tee=5`): the orange tees moved 20 to 34 m forward to their card lengths.
- **Holes 5 and 14:** the lines that read long, and the most likely place for the next fault.
- **Decks 12-1 and 18-4,** and the twelve unsorted decks above: a tee drawn on a bank shows as a tilted tee.
- **The greens:** all 18 sit on the putting surface inside the collar on both spring photos (2023, 2025), September's
  hand tracing at its best.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Ängsö

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Lätt öppning | 4 | 10 | 386 m | 3 | 4 | creek | 9.6 m | Blå tee +9.6 m against the card; Vit deck not on level ground in the terrain (4.4% slope, 0.22 m off a plane); sand audit: `sand-006` is a fault; `angso-bunker-01-4` was 14% grass on the 2019-07-14 photo: built or reshaped since | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=1&karta=1) |
| 2 | Fint golfhål | 4 | 6 | 348 m | 3 | 2 | water, creek | 0.2 m | Vit/Gul deck not on level ground in the terrain (3.1% slope, 0.13 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=2&karta=1) |
| 3 | Två klubbor i motvind | 3 | 8 | 179 m | 2 | 1 | water | 0.2 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=3&karta=1) |
| 4 | Vattnet vid green | 4 | 2 | 337 m | 2 | 1 | creek | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=4&karta=1) |
| 5 | Det röda huset | 5 | 18 | 493 m | 3 | 0 |  | 16.4 m | Röd tee +16.4 m against the card | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=5&karta=1) |
| 6 | Dammen i kröken | 4 | 16 | 337 m | 3 | 3 | water | 6.3 m | Röd tee +6.3 m against the card; Röd deck not on level ground in the terrain (9.9% slope, 0.11 m off a plane); Vit deck not on level ground in the terrain (18.9% slope, 0.09 m off a plane); `angso-bunker-06-2` was 18% grass on the 2019-07-14 photo: built or reshaped since | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=6&karta=1) |
| 7 | Banans längsta | 5 | 4 | 545 m | 4 | 2 | creek | 3.6 m | Gul deck not on level ground in the terrain (15.6% slope); Vit deck not on level ground in the terrain (5.8% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=7&karta=1) |
| 8 | Rakt fram | 4 | 14 | 344 m | 3 | 1 | creek | 9.7 m | Vit tee +9.7 m against the card; unused deck not on level ground in the terrain (6.6% slope); Blå deck not on level ground in the terrain (3.9% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=8&karta=1) |
| 9 | Vinden ovanför träden | 3 | 12 | 143 m | 2 | 2 | creek | 5.0 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=9&karta=1) |
| 10 | Index 1 | 5 | 1 | 527 m | 2 | 1 | creek | 0.2 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=10&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=10&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=10&karta=1) |
| 11 | Sex bunkrar | 4 | 17 | 340 m | 3 | 6 |  | 0.2 m | Vit deck not on level ground in the terrain (2.5% slope, 0.13 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=11&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=11&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=11&karta=1) |
| 12 | En klubba längre | 3 | 9 | 169 m | 2 | 1 | creek | 0.7 m | Blå/Röd deck not on level ground in the terrain (11.1% slope); second look: `angso-tee-12-1` is a fault | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=12&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=12&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=12&karta=1) |
| 13 | Längsta par 4 | 4 | 5 | 426 m | 3 | 3 | creek | 5.2 m | Vit tee -5.2 m against the card; Vit deck not on level ground in the terrain (2.1% slope, 0.12 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=13&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=13&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=13&karta=1) |
| 14 | Vänstra greenhalvan | 4 | 11 | 350 m | 3 | 1 |  | 19.9 m | Vit tee +19.9 m against the card; Blå deck not on level ground in the terrain (5.8% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=14&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=14&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=14&karta=1) |
| 15 | Över vattnet | 3 | 7 | 172 m | 3 | 1 | water | 0.0 m | Gul/Blå deck not on level ground in the terrain (2% slope, 0.11 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=15&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=15&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=15&karta=1) |
| 16 | Rakt fram från tee | 4 | 13 | 338 m | 3 | 2 | water | 1.0 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=16&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=16&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=16&karta=1) |
| 17 | Vatten hela vänstersidan | 4 | 3 | 358 m | 4 | 1 | water, creek | 2.6 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=17&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=17&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=17&karta=1) |
| 18 | Över enen | 5 | 15 | 497 m | 4 | 1 | water, creek | 0.8 m | Vit deck not on level ground in the terrain (12.6% slope, 0.14 m off a plane); Röd deck not on level ground in the terrain (17.5% slope); second look: `angso-tee-18-4` is a fault; sand audit: `sand-068` is a fault | [tee](https://banvy.olovmelander.workers.dev/?bana=angso&hal=18&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=angso&hal=18&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=angso&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| Hole 1's Vit and Gul stood on the path where the old guide drew them, on no deck; the hole was lengthened between the 2021 and 2023 photos | the owner ("some tees feel a bit off, for example on the 1 hole"), then the card measure and four photo years | 3 | `tee-decisions.json`, its test (`tee-decisions.node-test.mjs`) and the card column above |
| Hole 10's Röd stood on Blå's deck (53 m from its card); Blå had no deck; Ora was 84 m from its card | the card measure (`remaining()`, as the tracer measures) | 3 | the card column above |
| 42 of 90 marks more than 5 m from their card length, most at a deck's centre or a schematic's fairway point | the card measure | 3 | the card column above (75 of 90 within 5 m now; the rest are listed) |
| Holes 5 and 14 long by the same amount for every colour | the card measure, then the photos | 3 | this page; not fixed |
| 15 tee decks not level in the terrain, two of them rings taking in a bank | `deck-ground.mjs` on the laser, then both photo years and the blind second look | 3 | `deck-ground.json` and its test; the two kept as faults in `ring-review.json` |
| Eleven forward decks rebuilt in 2019 and two decks on hole 1 built after the laser | the 2019 summer photo beside the 2025 one (the second look found the eleven unprompted) | 3 | `ring-review.json` (each answered) |
| White stakes of the boar fence across holes 6 and 16: good shots onto their own ground called out of bounds in Spela | `out-of-bounds-shots.mjs` in the quality gate, merged from main the same night | 5 | the quality gate; `reconcile.mjs` refuses a model in which a good shot is out |
| No practice green or bunker in the model, though both stand on every photo year | `audit-sand.py` with Ängsö's measured sand | 3 | `sand-audit.json` (kept as faults `sand-006`, `sand-068`) |
| The sand audit named all 33 bunkers with Bro Hof's white-sand bands | the audit's own count, then the sand measured on the 2025 photo | 3 | `sand` in `trace-config.json` |
| The catalogue row lost its startup and prepared records when the pack changed | the walkthrough's summary (prepared data 0 of 4) | 5 | `build-startup-packs.mjs` and the bakes; `check-prepared-startup.mjs` |
| The map's land and the measured roofs were tied to the old pack | `map-shores.test.mjs` and `house-kit.test.mjs` | 5 | those tests |

## Decisions

- **27 November 2026:** the owner asked for Ängsö to be improved with pipeline v2 ("some tees feel a bit off, for example
  on the 1 hole"), and for the night's work to go on without questions. Everything below was decided by the agent on
  the evidence named, and is the owner's to overturn.
- **The tee rule** (`make-tee-decisions.mjs`): a colour's deck comes from the evidence (September's review, or the card
  with four photo years and the laser where they disagree), its place on the deck from the card, measured as the shared
  tracer measures; a tee with no deck stands on the fairway at its card length. Decks never move.
- **Kept as September placed them:** holes 5 and 14 (their lines are long), hole 8's Vit and Gul and hole 9's Vit.
- **Still the owner's:** whether hole 1's Blå belongs at the south end of the long strip (9.6 m short of its card) or on
  ground that is not a deck; whether hole 8's Blå is the small deck 2 (the card) or deck 1 (September's reading of the
  schematic); the lines of holes 5 and 14; the fifteen decks.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground angso          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground angso --check    # this page against the records
node tools/course-walkthrough.mjs --ground angso --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=angso&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc angso:1:tee:dag,angso:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only angso --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- **September's tees:** remove `angsobuild/mapping/tee-decisions.json` and run the chain in
  [the orthophoto alignment](angso-orthophoto-alignment.md) from `node angsobuild/reconcile.mjs`: the model goes back
  to the review of 9 September byte for byte (checked on 27 November before any change).
- **The pack before:** `apps/golf/public/courses/angso/pack.bin` sha256 `778f8b2933599fbf…` (481,863 bytes) is in git at main `35df3651`; its
  course manifest and routing chunk stay beside the new ones until `promote.mjs --ground angso --prune`.
- **The ground** is unchanged: generation `0327367adaf0`, the same terrain, trees and campus.
