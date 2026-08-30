# upsalamellanbuild — Upsala GK Mellanbanan

A build directory that shares its GROUND with `upsalabuild` and differs only in
which holes are played. `heightfields.json` and `tree-cover.json` are copies of
the Stora banan's: it is the same terrain and the same woods, and a pack is
self-contained by design, so each course carries its own copy rather than
inventing a shared-asset mechanism the format does not have.

What is generated, and from what:

- `card.json` — the club's card. Lengths cross-checked hole by hole against the
  club's per-hole banguide; the stroke index comes from that banguide and NOT
  from the aggregator, which disagrees on all nine (see the card's own note).
- `course-model.json` — written by `upsalabuild/reconcile-mellanbanan.mjs` from
  `upsalabuild/mellanbanan-traced.json` plus the Stora banan's environment. The
  eighteen is carried in `scenery` so its mown ground still reads as mown.

Regenerate with:

    node upsalabuild/trace-mellanbanan.mjs        # banguide -> world, via OSM ponds
    node upsalabuild/reconcile-mellanbanan.mjs    # -> mellanbanan-model.json
    cp upsalabuild/mellanbanan-model.json upsalamellanbuild/course-model.json
    node packages/course-pack/emit-pack.mjs upsalamellanbuild apps/golf/public/courses/upsala-mellanbanan upsala-mellanbanan

The routing is PROVISIONAL: it is the club's own drawing registered through three
OSM ponds to 3.8/10.3/7.1 m, with each hole set to its exact card length. Greens,
fairways and tee pads are synthesised around those lines and marked prov:"synth".
