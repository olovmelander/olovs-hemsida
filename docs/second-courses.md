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
