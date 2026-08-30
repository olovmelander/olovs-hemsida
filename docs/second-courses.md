# The second nines — Upsala Mellanbanan and Johannesberg's Donald Steel 9

Two clubs in this repo have a course we do not render. Upsala GK has three
(Stora banan 18, **Mellanbanan** 9, and a Lilla pay-and-play nine); Johannesberg
has 27, an eighteen and a **full-length nine**, both by Donald Steel. This is
what has been established, what remains, and the one decision that shapes it.

## Established, and checked rather than assumed

**Both cards are verified.** This project's rule is that a card is verified
*before* geometry is fitted to it, not after, and both pass the same three tests
a nine-hole card can be held to:

| | par | index | tee columns vs printed totals |
|---|---|---|---|
| Mellanbanan | 35 ✓ | odd 1–17, no repeats ✓ | all **five** reproduce exactly ✓ |
| Johannesberg 9 | 34 ✓ | odd 1–17, no repeats ✓ | both reproduce exactly ✓ |

A nine rated over eighteen must carry the odd indexes 1–17; a transcription slip
almost always breaks that permutation, so it is a real check. Cards are committed
at `upsalabuild/card-mellanbanan.json` and `johannesbergbuild/card-9.json`, each
carrying its own verification note.

**Neither nine is in OpenStreetMap.** Upsala's extract holds seventeen greens and
the Stora banan consumes sixteen; Johannesberg's whole extract holds two greens
and no fairways, tees or bunkers at all. So both nines must be **traced from
orthoimagery**, exactly as Norrfällsviken's whole course and Johannesberg's
eighteen already were. This is the well-trodden path here, not new ground.

**Both are located, and the terrain already exists.** Mellanbanan lies EAST of
the road running through the property, opposite the Stora banan, around
`x 550..1100, z -350..250`. Johannesberg's nine lies WEST and NORTH-WEST of the
manor, around `x -800..-250, z -900..-450`. Both fall comfortably inside their
build's committed 4 m heightfield (Upsala `x -1500..1948`, Johannesberg
`x -1500..1500`), so **no DEM or satellite refetch is needed** — the ground they
stand on is already modelled. `tools/course-overview.mjs` renders either property
with the course we already have drawn over it, which is how they were found.

## The decision that shapes everything downstream

A nine "in the same environment" can mean two things, and they are not close:

1. **A separate course slug** — `upsala-mellanbanan`, `johannesberg-9` — with its
   own pack, its own card, its own manifest entry, sharing the environment
   (heightfields, surroundings, trees, clubhouse) with its parent.
2. **Extra holes on the existing course**, so one course carries 27.

**Take (1).** The manifest architecture already boots any course by slug, the
pack format already carries a course's holes and card, and the chooser already
lists whatever the manifest holds — so a second nine is a new row, not a new
system. Option (2) would break the eighteen-hole assumptions the card UI, the
hole strip, the minimap and `check3d` all rest on, and would make "hole 7" mean
two different things on one course.

What (1) still costs, and it is not nothing: everything downstream assumes
eighteen. `check-app` asserts `holes.length === 18`; the hole strip renders a
fixed eighteen buttons; `emit-manifest`'s display table is keyed per course. All
three want a hole count read from the card rather than hard-coded — which is a
small, contained change, and worth doing carefully because six shipped courses
run through the same code.

## What remains, in order

1. **Trace each nine** off z18 imagery: nine greens, nine fairways, tee pads,
   bunkers and centrelines per course. `tools/course-overview.mjs --cx --cz`
   already produces the georeferenced frames; a tile's coordinates ARE its
   georeference, so a trace made on one needs no registration.
2. **Assign hole numbers from the club's banguide**, not by guessing the routing.
   The method that worked at Upsala is recorded in CLAUDE.md: detect the banguide
   flags, convert each flagpole foot to a world point, and RANSAC a similarity
   against the traced green centroids.
3. **Slide each hole to its card length**, the same rule the six courses use.
4. **Reconcile → pack → manifest → app**, with the hole count made dynamic.
5. **Gates**: card value-for-value through the app, greens and tees dry, tee
   markers on tee grass, plates measuring their own label — all of which already
   exist and simply need to stop assuming eighteen.

## One thing to watch

The two nines share their ground with their parent course's *environment* but not
its *play*. The atlas, the planter and the scatter all read `HOLES`, so a nine
rendered alone will mow only its own corridors — the parent's fairways will read
as rough unless its shapes are carried into the pack as scenery. That is what
`M.scenery.fairways` is already for, and it is the right home: on Mellanbanan's
card the Stora banan is scenery, and vice versa.

## Which banguide is which — settled by the cards, not by eye

The two banguides were supplied without labels, and guessing from the drawings
would have been a coin toss. The cards settle it decisively:

| | shortest hole | longest hole |
|---|---|---|
| Mellanbanan | **h5**, 73–109 m | h6, 455 m |
| Johannesberg 9 | **h4**, 94–126 m | h8, 399 m |

In the detailed banguide, hole 5 is a short stub while hole 4 is one of the
longest lines on the sheet. Johannesberg's hole 4 is its *shortest* hole, so that
sheet cannot be Johannesberg's. It is **Mellanbanan** — and the rest agrees:
holes 3 and 6 are drawn as the two long lines, and they are its two par 5s.
The small low-resolution sheet is therefore **Johannesberg's nine**.

## The imagery is harder here than at Veckefjärden, and that changed the plan

`tools/trace-turf.mjs` classifies mown turf from orthoimagery on the criteria
build-treecover.py arrived at — bright, green AND SMOOTH, with smoothness the
thing that separates turf from canopy. It does not work off the shelf at these
two clubs, and the reason is worth recording before anyone retunes it blindly:

- **Different zooms are different captures.** At Johannesberg, z17/z18 is an
  early-spring flight with dormant, pale grass: the classifier called 73% of the
  frame turf because a bare field and a fairway are the same colour in March.
  z16 is a summer capture and separates properly by colour — but it is 1.2 m/px,
  where the texture threshold (tuned at 0.30 m/px) fires on everything and calls
  58% of the frame trees. The threshold has to scale with resolution.
- So a working classifier here needs a labelled probe set per club, the way
  `check-treecover.mjs` holds one for Veckefjärden. That is a sub-project.

**The plan therefore follows the method this repo already used at Johannesberg's
eighteen: the banguide is the routing authority and the imagery is the
georeference.** Register each banguide to the world through features visible in
both (ponds, the manor, road junctions), read the nine centrelines off it,
generate greens/fairways/tees around them marked `prov:"synth"`, and let the
card-length slide fix the lengths. Nothing is invented that the club has not
drawn; what is inferred is marked as inferred.

## Done so far

- Both cards verified and committed.
- Both courses located; terrain already covered by the committed heightfields.
- `tools/course-overview.mjs` — a club's whole property with the known course
  drawn over it, `--cx/--cz` to zoom, and the frame's exact pixel→world affine
  written beside it so a trace needs no registration.
- `tools/trace-turf.mjs` — the classifier, with the calibration caveat above.
- **The hole count is no longer hard-coded.** `NHOLES` in main.js drives the hole
  strip, the wraparound to the next tee, the goHole clamp and the tour; check-app
  asserts the card's own length. emit-manifest already read it from the card.

## GolfTraxx checked, and it is the documented dead end

CLAUDE.md records that the GolfTraxx pull returns hole 1 only for Ängsö, Upsala
and Johannesberg. That was checked here rather than assumed, because the club has
THREE directory entries and one of them is promising:

    Upsala Golfklubb, 9 Hålsbanan    75591SW
    Upsala Golfklubb, Nya            75591SW
    Upsala Golfklubb, Gamla          58592SW

The nine's layout page returns **six markers, every one of them at the clubhouse
coordinate** (59.8414, 17.4956). An entry exists; a survey does not. Johannesberg
is not in the Swedish directory at all. So there is no GPS anchor for either
nine, exactly as recorded — worth re-checking once because the entry name looked
like a survey, worth never checking again now that it is written down.

## Where Mellanbanan actually is, in metres

Read off a 100 m world grid laid over the imagery (`--grid`), the nine's ground
runs roughly **x 250…1000, z −750…−50** — north-east and east of the clubhouse,
between the Stora banan's northern cluster and the road, with its own pond at
about **x 860…950, z −260…−200**. The Stora banan does not touch this ground.

## What is still missing, stated plainly

Everything above is verifiable. What is NOT yet possible to do honestly is assign
the nine holes' routing. From 0.6 m imagery the mown corridors are visible but
which corridor is hole 1 and which way it plays is not, and the supplied banguide
sheets are too small to register reliably against the ground — the detailed one
has no unambiguous control points, and Johannesberg's is low resolution.

Guessing it would produce invented geometry on a real club's course, which is the
same class of error as the fabricated posters and is not worth doing for the sake
of momentum. **What unblocks it is a per-hole banguide** — the club's own hole
pages or PDF, which show each hole individually with its distances and shape.
With that plus the frames this tooling already produces, the nine holes can be
placed the way Johannesberg's eighteen were: the banguide routes, the imagery
georeferences, the card fixes the lengths.

## The banguide was on the web after all, and it changed the card

`banguider.se/upsala-golfklubb/mellanbanan` carries the club's own guide: an
overview plus **nine per-hole sheets**, each with par, stroke index, five tee
lengths, carry distances and a compass rose. The overview is the same sheet
supplied by hand, which confirms the card-based identification independently.

**REGISTERED, AND THE FIT IS CHECKED BY A POINT THAT DID NOT ENTER IT.** The
drawing is an aerial with its surroundings masked out, so it cannot be matched by
its edges — but the ponds inside it are in OpenStreetMap with world coordinates
this build already holds. Three pond centres give a similarity of
**0.7693 m per pixel, rotation 1.23°** — i.e. the sheet is north-up, which is
what a course map should be; a fit coming out at 40° would have meant the pairing
was wrong. Residuals are **3.8, 10.3 and 7.1 m** over more than a kilometre of
drawing. Two points suffice to solve it, so the third is free evidence.

**AND IT CAUGHT A BAD CARD.** The per-hole sheets confirm the lengths exactly —
all five tee values on holes 1, 7 and 8, and the pars on all nine. But the STROKE
INDEX disagrees on **all nine holes**:

| hole | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| the club | 9 | 7 | 5 | 11 | 17 | 3 | 15 | **1** | 13 |
| golfisverige | 13 | 9 | 3 | 15 | 11 | **1** | 17 | 5 | 7 |

The aggregator's column is a perfectly valid odd 1–17 permutation and passes
every arithmetic check this project runs. **That is the lesson: the permutation
test proves a column is well-formed, not that it is the club's.** The club's own
guide is authoritative and the card now carries its values — hole 8 is Index 1/2,
the hardest, and is also the hole the club calls its signature.

Remaining for Mellanbanan: the nine hole lines are read off the overview and six
of nine land at 0.84–0.94 of their card length, which is expected because the
numbered disc sits at the tee ground rather than the back marker and the card
slide is what resolves it. Holes 7 and 8 are misread badly enough to redo from
their own sheets, which show tee and green unambiguously and carry a compass rose
per hole.

## Mellanbanan is built and gated

`?bana=upsala-mellanbanan` — par 35, five tees, a 1–9 hole strip. Verified
through the app: **63 card values over 9 holes, 0 mismatches; 45/45 tee markers
on tee grass; every green centre probe hits its green; 31 distance plates; no
page errors.**

Two things that cost time and are worth not repeating:

- **`h.elev` is an object `{tee, green, rise}`**, not a number. Setting it to 0
  threw on `h.elev.rise.toFixed` before boot finished, from `drawCard`.
- **The heightfield is not plain little-endian pairs.** It is deflate-raw, then
  two byte planes, then zigzag deltas against a Paeth-style predictor. Reading it
  naively produced a perfectly flat course at 21 m — a wrong decode that does not
  throw, which is the dangerous kind. `apps/golf/src/engine/codec.js` `decodeHF`
  is the definition; invert that, do not re-derive it.

## Johannesberg's nine — the blocker, precisely

The club confirms it: a full-length Pay & Play nine by Donald Steel, one par 5,
open year-round. Its ground is visible west and north-west of the manor with its
own ponds. What does not exist anywhere reachable is a **routing**:

- The club's own `vara-banor/banguide/` carries per-hole sheets `Bana-1` …
  `Bana-18` — the eighteen only. Its "9 håls banan" section is prose with no map,
  no scorecard and no hole-by-hole guide.
- `banguider.se` has Upsala's three courses but no Johannesberg at all.
- GolfTraxx does not list Johannesberg in its Swedish directory.
- mScorecard has a page but returns 403.

So the nine's card lengths are from an aggregator and **its stroke index should be
treated as unverified** — at Mellanbanan the same class of source disagreed with
the club on all nine holes while still passing every arithmetic check.

What unblocks it: any per-hole guide for the nine, or a scan of the club's
scorecard, or simply confirmation of which corridor is hole 1 and which way it
plays. The registration method is built and proven — three ponds were enough at
Upsala, and Johannesberg's nine has ponds of its own.
