# Ängsö tee alignment — 9 September 2026

The tee review connects the club-linked colour groups to the mown ground visible
in Lantmäteriet's 24 April 2025 orthophotos. It corrects representative tee-selection
coordinates, restores two previously omitted physical platforms and treats the
orange references as fairway starts. These are reviewed game references, not a
survey of the club's current daily tee markers.

The rebuilt course contains **84 accepted references**: 65 on platforms and 19
on fairway turf, with **52 physical platforms**. Six references remain explicitly
unresolved. The [independent coordinate audit](../../angsobuild/mapping/tee-coordinate-audit.json)
passes for every native anchor, platform vertex, packed reference and routing
point. The maximum native-anchor/model discrepancy is **0.000746 m**; this is
numerical conversion fidelity, not field accuracy. The runtime's linear frame
bridge differs by at most **0.144351 m** across the tee geometry, below one native
image pixel.

All 84 rendered marker pairs fit their assigned turf, with no coincident colour
references. All 90 references retain their evidence in the pack. Unresolved
references keep their original camera coordinates and draw no colour pair.
The app and standalone viewer share marker fitting and camera targeting. Three
inferred red penalty stakes that intersected hole 17's yellow/blue platforms
were excluded, with the omissions recorded in the marking ledger and guarded
by the 3D check.

Every accepted coordinate is authored in absolute native source-image pixels.
The matching source `geoTransform` maps it to EPSG:3006; the existing course-frame
conversion then supplies the model coordinates. Display crop offsets are not
coordinate corrections. The 0.16 m pixel spacing describes image sampling and
does not mean a marker location has been surveyed to 0.16 m accuracy.

The review compares colour groups and their order against paths, crossings,
ditches, ponds, tree groups and the start of the fairway. It then selects a
representative point on the matching visible turf. A nearest platform, a fitted
image transformation or a scorecard-length match is insufficient evidence for
a colour association. Shared platforms retain separate representative points
when the guide distinguishes their order. Fairway references do not generate
raised pads.

The source evidence is stored in
[tee-source-evidence.json](../../angsobuild/mapping/tee-source-evidence.json).
The [current club website](https://angsogolfklubb.com/) links to
[LiveCaddie course 649](https://courses.livecaddie.com/course-graphics.php?course=649&lang=sv-SE&embedded&hole=1).
Its coloured hole schematics are useful for grouping and landmarks, but their
2024 asset-upload date does not establish when the drawing was updated. The
underlying hole records are dated 2020, and hole 1's white/yellow distances differ
from the [current club-linked scorecard](https://angsogolfklubb.com/wp-content/uploads/2025/02/Scorekort-2023.pdf).

The front-nine review is recorded in
[tee-placement-front9.json](../../angsobuild/mapping/tee-placement-front9.json).
Notable decisions are:

| Hole | Decision | Evidence and limits |
| --- | --- | --- |
| 1 | Blue uses the retained narrow strip beside the path; red uses the isolated forward oval; orange uses the fairway. White and yellow remain unresolved. | The club's [2021 meeting papers](https://media.angsogolfklubb.com/2021/03/Arsmoteshandlingar-2020.pdf) record investigation of moving the rear tees, and the later card differs from the older guide. The isolated northeast platform is visible, but the changed colour layout is not established. |
| 2 | Restore the small blue platform between the rear white/yellow strip and the red oval. | Both the guide's three-platform sequence and the oval south of the path are visible. Tree shadows make parts of its boundary less certain. |
| 3 | White/yellow share the large platform beside the pond; blue/red share the separate forward platform. | The pond, path and intervening open turf distinguish the groups. |
| 4 | White/yellow/blue use the continuous rear strip; red uses the oval beyond the path crossing. | The long strip, diagonal crossing and front oval correspond to the guide. |
| 5 | The three platforms correspond to white, yellow and blue. Red is on the mown fairway-entry apron beyond the diagonal crossing. | The club's [2023 earthworks description](https://angsogolfklubb.com/2023/10/25/gravarbete-pa-5an/) independently distinguishes blue from white/yellow and red. A separate defensible red-pad perimeter is absent in the orthophoto, so the red reference remains unraised fairway turf. |
| 6 | White uses the rear patch, yellow/blue share the middle patch, and red uses the isolated forward patch before the ditch. | The path and transverse ditch establish the sequence despite the schematic drawing a more continuous rear group. |
| 7 | Restore the red oval beside the rear fairway lobe. | It lies ahead of the isolated blue platform and behind the first left fairway bunker, outside the earlier narrow tee-review crop. |
| 8 | Blue and red are matched using the curved path, intermediate unmarked oval and forward path crossing. White and yellow remain unresolved. | Dense conifer canopy hides the guide's rear white/yellow strip. The intervening unmarked platform remains in the physical inventory without an invented colour association. |
| 9 | Yellow/blue share the rear traced strip; red uses the forward oval. White remains unresolved. | The club's [2023 path-work description](https://angsogolfklubb.com/2023/10/20/arbete-pa-nian/) explicitly identifies the shared yellow/blue tee. The separate rear white location is obscured; the club's 2024 tree-clearing account supports the area, not an exact position. |

The [back-nine review](../../angsobuild/mapping/tee-placement-back9.json) places
44 references using the native platforms, paths and ponds. Hole 17 yellow now
uses its matched platform; orange on holes 12/15 uses visible short turf but
retains the limitation that those fairway boundaries are older.

The remaining front-nine cases are hole 1 white/yellow, hole 8 white/yellow and
hole 9 white. Hole 10 blue is the remaining back-nine case. In particular, the
default yellow selections on holes 1 and 8 cannot be claimed as orthophoto-verified.
Unresolved records have `pixel: null`; their diagnostic `candidatePixel` values
must not be consumed as corrected coordinates. A current club-confirmed plan or
georeferenced field observation identifying the colour groups would resolve these
gaps more reliably than further interpolation of the schematic.

Confidence describes the strength of the static guide-to-turf correspondence.
High confidence means the platform and surrounding landmarks agree clearly;
medium confidence retains a specific limitation such as shadowed edges, schematic
generalisation or an unraised turf reference. Neither classification certifies
current daily-marker placement.

The native front-nine review panels are generated by
[tee-placement-front9-review.py](../../angsobuild/mapping/tee-placement-front9-review.py)
into `angsobuild/cache/tee-placement/front9-review/`. Each crop has a matching JSON
record with its absolute source box. Cyan outlines are retained platforms, orange
outlines are newly reviewed platforms, coloured dots are accepted representative
references, and grey crosses prefixed with `?` are unresolved candidates. Bright
panels change display brightness only; geometry always uses the original pixels.

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe angsobuild/mapping/tee-placement-front9-review.py
node --test angsobuild/mapping/reviewed-orthophoto.node-test.mjs
node angsobuild/mapping/tee-coordinate-audit.mjs --write
node node_modules/vitest/vitest.mjs run apps/golf/src/engine/tee-marker-placement.test.mjs apps/golf/src/engine/v2-angso-config.test.mjs
$env:BANVY_GPU = '1'
node angsobuild/mapping/tee-browser-audit.mjs
```

The front-nine native panels were visually inspected after placement. All
accepted platform references lie within their assigned polygons, including the
two restored pads. All front-nine fairway references lie within the reviewed
fairway geometry. The generated audit and runtime checks cover the integrated
course and record the final conversion, attachment and render results.

The final validation includes nine consumer tests, 41 runtime/configuration tests,
exact page/pack agreement and all 3D checks. A live WebGPU review captures all 18
yellow tee views plus orange on holes 5 and 17 through the actual tee selector.
Its report and screenshots are in `angsobuild/shots/tee-review-2026-09-09/`;
`tee-browser-audit.json` records the loaded pack hash, 168 marker instances,
exact selected camera/reference agreement, frame state and browser errors.

All 20 final browser views passed with zero browser errors; WebGPU boot took
26.005 seconds. The final run used an isolated preview at port 8629 with live
reload disabled after concurrent workspace edits interrupted the shared server.
The current model/pack hashes and all gates are recorded in the browser report.
