# Tee playing positions and Kikaren

The app uses a playing position centred across the width of an associated tee
pad, at the reference's existing station along the hole. A single long pad can
therefore hold several tees without their positions collapsing to its centroid.

`deriveTeePlayingPositions` runs after display anchors, bearings and pad inference,
before the app builds tee furniture or initialises the camera and UI. Runtime
`mark.c` is the common origin for the selected-tee infographic, minimap, tee view,
shot planning and Kikaren. `mark.referenceC` preserves the original mapped point;
`mark.playingPosition` records the input anchor, associated pad, sideways movement
and edge clearance. Published packs, routing, pad polygons and scorecard lengths
are unchanged. The surface compiler does not apply playing-position adjustments.

The adjustment uses only the connected transverse section of the pad containing
the original runtime point. An explicit `sourcePadId` takes precedence. Without
one, exactly one containing pad is required. Unresolved guide references, non-pad
references, ambiguous overlaps, outside points, insufficient clearance and shifts
over six metres retain their references for review. The adjustment must not reduce
edge clearance or move the tee forwards or backwards along its bearing.

This improves alignment with the app's graphical pads. It does not establish
survey accuracy, a verified tee-colour association or today's physical marker
positions. Existing orthophoto evidence and its uncertainty remain unchanged.

## Veckefjärden check, 13 September 2026

On hole 1, the 312 m option (tee 58) stays on `lm-h01-rear-long`:

| Measure | Original reference | Playing position |
| --- | ---: | ---: |
| Local x | 51.397503 | 48.658188 |
| Local z | -254.043796 | -253.823705 |
| Nearest pad edge | 0.664 m | 3.398 m |
| Distance from decorative marker-pair midpoint | 1.067 m | 0 m |

The playing point moves 2.748 m sideways. Across the course, 87 of 108 playing
positions are adjusted; points less than one metre from a pad edge fall from 73
to 9. Seventeen references remain outside all mapped pads and need individual
review. For example, hole 1's 210 m option is about 40.6 m from the nearest mapped
pad boundary; moving it to that pad would be an unsupported reassignment.

## Camera and line origin

Tee view sits six metres behind the playing position along its forward aim.
Kikaren starts at the playing position's x/z and the shared visible-ground height,
with no eye-height lift. Its target endpoint also meets the ground. The existing
arc between those endpoints remains. GPS and manually placed balls continue to
provide their own measurement origins.

## Verification

`node tools/audit-tee-pad-centering.mjs` writes `output/tee-pad-audit.json`, covering
all 1,008 references in the 13 published course packs, including before/after
clearance, source coordinates, retained-position reasons and marker alignment.

Geometry tests cover concave pads, shared pads, explicit and ambiguous pad
associations, retained unresolved references, preserved source geometry and all
published packs. Kikaren tests execute the app's drawing function and inspect
the actual line vertices on uphill, downhill and level shots. The Upsala
source-to-consumer contract keeps its source/projection checks and verifies camera
and rangefinder consumers against runtime playing positions.
