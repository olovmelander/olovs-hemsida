# Tortuna's driving range, measured

The range rendered flat before this pass. Its seventeen hitting mats, three
target areas, practice bunker and paths were all traced and painted into the
terrain atlas as ground colour, `scenery.rangeFacilities` was `null`, and
nothing stood up. The shelter hut was already a Blender-authored GLB; the range
around it was a picture of a range.

Everything below is measured off the retained 2026 native orthophoto
(`o66150_5975_25_mr26`, `orto-n2-2026`, captured **2026-05-02T13:09:09Z**, read
at 0.32 m). Where the imagery does not resolve something it is named as
unresolved rather than filled in.

## What the club says about its own range

The 2024 member survey, published 2025, is explicit that this is a project in
progress:

> Målet för denna säsong var att slutföra arbetet på rangen med **jordmassorna**
> och göra klart **målområdena** på rangen. Dessvärre har projektet dragit ut på
> tiden... I och med att **ytan på rangen inte är gräsbetäckt**, var vi tvungna
> att återinföra våra gamla bollar.

That is why the landing field is drawn bare. It is also why the club's two drone
photographs are used for appearance only and never for what stands where: both
were uploaded in **March/April 2023** and show the range as it was BEFORE the
rebuild. A photograph three years older than the capture cannot say what is on
the ground today.

## The three measurements

**The mats: 22, at 2.88 m, not 17 at 3.57 m.** They do not separate on any
absolute colour cut — measured over the retained rings, their excess green sits
at the surrounding strip's own 75th percentile, and a ±4 m offset search
improves the score by 0.24, which is nothing. What separates a mat is LOCAL: it
is greener than the two metres around it, whether it lies on pale gravel or on
grass. Drawn over the imagery, the retained seventeen rings drift progressively
off the mats and end a full mat to the side. The re-trace is a display revision;
the source rings stay in the pack.

**The ball-stop net: 10 posts, 9.01 m apart, 9.77 m high over 79.3 m.** The net
is a continuous mesh, so its shadow is a broad band and the posts inside it do
NOT separate by darkness — they separate by WIDTH, which is what an oriented
matched filter along the solar bearing finds. Height is each post's own shadow
length times tan(elevation), plus the ground rise the shadow runs over.

The solar geometry is independent of everything measured with it: it comes from
the source item's own STAC capture instant through NOAA's algorithm. Its check
is that the computed shadow bearing, **45.06°**, reproduces the dominant
dark-line bearing measured separately in the pixels, **46.0°**. Two records that
never entered each other, agreeing to a degree.

The ground correction is not cosmetic: the field falls about 3 m over the 15 m
the shadows run, so the uncorrected height would read 11.96 m against 9.77.
MAD 1.13 m, range 5.45–11.6 — the short end is the last post, where the run is
clipped. Post diameter, mesh gauge and any top cable are not resolved at 0.32 m
and are drawn as display estimates.

**The unfinished landing field: 9,762 m².** Grown from a seed inside the scraped
area on cuts measured against the range's own surroundings, boundary simplified
at 1.5 m. The ring is simple (checked: zero self-intersections) and its shoelace
area matches the raster's 9,606 m² to 1.6%.

## How it reaches the render

`apps/golf/src/engine/scenery/tortuna-range.mjs` + `tortuna-range-site.json`,
wired through `tortuna.js` as `applySurfaceAppearance` / `renderCourtyard` /
`customMappedKinds`, following Norrfällsviken's range exactly.

**The pack is deliberately untouched.** The mats are a display revision of
outlines already in it, and the net reaches the engine because
`applySurfaceAppearance` returns a revised scenery carrying `rangeFacilities` —
so no model edit, no re-emit, no EPSG:3006 migration, and none of the three
checksum registries move. (`migrate-legacy` does run without PROJ on this
grid-authored ground, so the model route is open if this geometry ever needs to
be survey rather than display. It is not blocked; it is not needed.)

Two additive edits in `main.js` support it: a ball-stop net no longer requires a
mapped BAY LINE, because a range can have one without the other — Tortuna's tee
line is separate mats on grass, with no strip to trace — and the post pitch is a
measurement where a course has one (`RF.netPostPitch ?? 12`). Measured inert
elsewhere: Puttom is the only course with nets, and it has bays too.

## Running it

    node tortunabuild/range/trace-mats.mjs          # mats, by local green contrast
    node tortunabuild/range/trace-net.mjs           # net posts, from their own shadows
    node tortunabuild/range/trace-earthworks.mjs    # the unfinished field
    node tortunabuild/range/build-site.mjs          # -> scenery/tortuna-range-site.json
    node tortunabuild/range/range-crop.mjs <name> <cE> <cN> <size> [scale] [--plain]
    node tortunabuild/range/shoot-range.mjs         # four engine views
    node tortunabuild/range/export-blender-input.mjs
    <blender>/python.exe tortunabuild/blender/mcp_client.py --exec tortunabuild/blender/build_range.py

`range-crop.mjs` writes a receipt beside every crop; pixel to world is affine,
so anything traced on one needs no registration. The Blender scene is a CHECK on
proportions away from the engine's own shading, not a source of runtime
geometry — the app draws the range procedurally so every piece follows the 1 m
terrain, which a GLB anchored at one point cannot do across 80 m of falling
ground.

## Three things that cost time, and the rule each leaves

- **A threshold measured on the same narrow window it is applied to is a
  feedback loop.** Tightening the mat corridor from ±6 m to ±3.5 m raised its
  own p90 cut, because the tighter the corridor the larger the share of it that
  is mat — and the detector began rejecting the objects it was meant to find,
  21 where 23 stood. Measure the cut on a WIDE band, test membership on a narrow
  one.
- **A tessellation strategy is chosen by the size of the thing.** Adaptive
  subdivision with a centroid fan is right for a 1.75 m mat and threw past
  60,000 faces on a hectare; uniform subdivision is bounded but splits tiny
  boundary triangles as hard as huge interior ones, and at 30,464 faces its
  interior triangles were still 9 m across — a flat triangle spanning 9 m of
  falling ground dips under the terrain, and the ground came through as a grid
  of square holes. A grid clipped to the ring is 1,732 triangles and reproduces
  the ring's area exactly. Sutherland–Hodgman clips against a CONVEX window, so
  the cell is the window and the traced ring is the subject; the other way round
  returns nothing at all, silently.
- **`V3D.stats` is a curated snapshot, not the live stats object.** The net drew
  correctly for an hour while `rangeNets` read null, because that key was not in
  the snapshot's field list; the scene inventory said `range-net` was there all
  along. `rangeNets` and `rangeFacilities` are exposed now so a gate can assert
  them.

## Open

- The mats' corner geometry is 4-5 pixels across and is not resolved; each is
  drawn as a square of the measured median area, turned to the local run of the
  line.
- The earthworks boundary is a working edge and moves with the work. Its western
  tail, by the buildings, is the materials/works area and is traced as one
  surface with the field.
- The three target areas keep the pack's own outlines and the generic surface
  pass draws them. No distance sign, flag or bay divider is drawn: none is
  resolved in the 2026 capture, and the photographs that show range furniture
  predate the rebuild.
- Holes 6 and 15 have no observed tee platform and the model does not DECLARE
  them unresolved, so `check-app` fails closed on them. Pre-existing, in
  `build-course.mjs`, not touched here.
