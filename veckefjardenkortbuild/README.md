# veckefjardenkortbuild — Veckefjärdens GC, korthålsbanan

Nine par 3s beside the Mästerskapsbanan, on the same ground. Built by
`tools/build-nine.mjs` from `geobuild/korthalsbanan.json`; the terrain, the
fjärd, the woods, the marking and the surroundings are `geobuild`'s, reused
verbatim, and the eighteen is carried in `scenery` so its mown turf still reads
as mown from here.

    node tools/build-nine.mjs geobuild/korthalsbanan.json
    node packages/course-pack/emit-pack.mjs veckefjardenkortbuild \
         apps/golf/public/courses/veckefjarden-korthalsbanan veckefjarden-korthalsbanan
    node packages/course-pack/emit-manifest.mjs

## This is the one course here whose card is NOT verified

Read `geobuild/card-korthalsbanan.json` before trusting a number in it. This
repo's rule is that a card is verified *before* geometry is fitted to it, and
this one does not pass:

- the nine pars sum to the printed 27 ✓
- **but neither tee column reproduces its printed total**: the Gul cells sum to
  932 against a printed 936, and Röd to 770 against a printed 776
- the club's own prose says the holes are 60–120 m, which **contradicts** Gul
  hole 1 at 136 m
- there is **no published stroke index**. The only index column found runs
  1,2,3,4,5,6,7,8,9 — exactly the hole order, so almost certainly a scrape
  artifact rather than the club's index. `hcp` is therefore `null` on every hole
  and the card UI prints the par alone. A korthålsbana is commonly unrated, so
  an absent index is the expected state, not a hole in the research.

One thing does argue for the per-hole cells being internally consistent: after
each hole is slid to its card length, the nine slides are **−13.4 to −17.4 m** —
a 4 m spread across nine holes. That is what a uniform offset between the
published route start and the Gul marker looks like, and a set of wrong cells
would not produce it. It does not explain the 4 m and 6 m shortfall in the
totals, which stays unexplained.

## Everything else

The routing is published GPS routes forming a compact loop: walks 19–69 m,
median 37, closing green 9 → tee 1 in 34 m, and clearing the Mästerskapsbanan
by 33 m. No green or tee is under water — which matters here more than
elsewhere, because this ground is a regulated lake at 21.59 m and Veckefjärden
has a history of flooding its own greens.

Greens, fairways and tee pads are synthesised and marked `prov:"synth"`.

**The schema is the older one.** Veckefjärden's model calls its water level
`lakeLevel` and carries penalty `marking` and the `surround` traces; this course
inherits all of it. `emit-pack` decides which schema it is by asking the MODEL
for `lakeLevel` rather than by testing the directory name — the name test would
have quietly emptied this course's marking and silt shallows and left its water
level undefined.
