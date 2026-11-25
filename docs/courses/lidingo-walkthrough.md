# Lidingö Golfklubb: walkthrough

The club's 18-hole park course at Sticklinge on Lidingö, par 70, built in September 2026 by its own builder
([lidingobuild](../../lidingobuild)) on Lantmäteriet's 1 m terrain, with outlines from the municipality's 2019
photo, Lantmäteriet's photo of 31 May 2025 and OpenStreetMap. Sources and rights are in the
[source dossier](lidingo-source-research.md) and the [clubhouse record](lidingo-clubhouse-appearance.md); any
upgrade follows [pipeline v2](../pipeline-v2.md) and starts from this page.

<!-- generated:summary -->
## What is there

|  | Sticklinge · Lidingö |
| --- | --- |
| Holes and par | 18, par 70 |
| Tees on the card | Vit 5,786 m, Gul 5,373 m, Blå 5,058 m, Röd 4,518 m, Orange 3,965 m |
| Greens, tee decks, fairways, bunkers | 18, 54, 13, 38 |
| Waste areas | none |
| Tee marks against the card | not measured |
| Outlines looked at ring by ring | no record |
| A second, blind look at them | none |
| Tee decks on level ground in the terrain | not measured |
| Posters, prepared data, scorecard | 5, 3 of 3 (its water is kept live, by design), yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2021-03-23 to 2025-05-31, photo 2025-05-31, laser 2021-03-23), 7 lakes and ponds, 7 creeks and ditches, 0 bridges. Generation `f7a0d942d5e9`.
- **Trees:** automatic (0 object tiles, 64 stand tiles); not placed one by one.
- **Buildings:** 562 mapped, 553 with a roof colour measured on the photo; an authored campus of 21 parts (clubhouse-restaurant, clubhouse-pavilion, clubhouse-annex, courtyard, clubhouse-green-kerb-and-rope, clubhouse-courtyard-entrance, range-west-barn, range-east-barn, range-side-small-shed, south-practice-small-building, range-north-covered-bays, range-south-covered-bays, range-north-ball-hut, range-south-shelter-end-hut, range-north-open-mats, range-south-open-mats, range-west-safety-net, range-road-safety-net, upper-parking-central-markings, cafe-9, toilet-15), 82,276 triangles.
- **Quality gate:** 4 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: facilities-v1: material "LID MODEL | f1f0e9_0.8_0_1" linear luminance 0.8690 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error); facilities-v1: material "LID MODEL | f4f2eb_0.6_0_1" linear luminance 0.8874 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error); facilities-v1: material "LID MODEL | f4f2eb_0.8_0_1" linear luminance 0.8874 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error); facilities-v1: material "LID MODEL | f4f2eb_0.55_0_1" linear luminance 0.8874 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error); facilities-v1: triangle count 82276 exceeds advisory budget 80000.
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `incomplete-playing-geometry`, `canonical-control-pending`, `surface-intake-pending`, `club-media-rights-pending`.
<!-- /generated:summary -->

## What is known not to be right

This list was drawn from the repository's records on 25 November 2026; nobody has looked at the course again for it.

- **Its outlines have never been checked ring by ring.** The ground was built before the shared tracer, so it has
  no decision files, no ring sheets, no second look and no deck or sand measurement, and its tee marks were never
  measured against the card (`tools/course-doctor.mjs`: "known"). Its reviews are the builder's own machine
  reviews of September. Fix: a `trace-config.json` and decisions for this ground, then stage 3 of pipeline v2.
- **Four campus whites are brighter than the glow's ceiling** (quality gate, 4 errors): three materials in
  `f4f2eb`, the clubhouse model's `TRIM` (`lidingobuild/facilities/model-clubhouse.py`), at 0.887, and one in
  `f1f0e9`, which no model script names, at 0.869, against 0.82. Fix: dim them and export the model again, a
  change the owner has to see (pipeline v2, "Not done yet").
- **The campus is over its triangle budget:** 82,276 against an advisory 80,000 (quality gate, warning). It was
  78,148 on 10 September (`lidingobuild/facilities/README.md`), and the range barns gained about 4,200 when they
  were rebuilt on 9 November. The records do not say what to trim.
- **Two bunker rings may hold no sand.** The first reading of the May 2025 photo found vegetation (NDVI over 0.25)
  on all of hole 16's west bunker and 98.5% of hole 15's (`lidingobuild/mapping/ortho-2025-review.md`). Both
  rings are still in the model, and no record says anyone looked. Fix: look at the 2025 crop, or a sand audit.
- **Four greens keep their older outlines:** 3, 4, 15 and 18, the ones the list of reviewed greens leaves out,
  lay in shade on the 2025 photo (`lidingobuild/mapping/alignment-integration-2026-09-10.json`). The tee edges
  on 5 and 8 are under tree shadow too and were drawn as the visible turf only (tee review, 9 September).
- **Orange is unresolved on holes 10-18.** Its nine starts there are camera positions on identified turf, with no
  marker drawn (`lidingobuild/mapping/tee-native-alignment-review-2026-09-09.md`). The record does not claim the
  tees are absent; the club's 2025 schedule lists rear-nine orange tees for 2026. Fix: a newer photo.
- **Out of bounds is partial.** Six road edges, about 503 m, on 2, 11, 12, 14 and 15 are drawn as map lines. The
  stakes on 1, 2, 5 and 6 and the fence behind green 10 could not be made out on the photo and are not placed
  (`lidingobuild/mapping/ob-placement-review.md`).
- **The trees are not placed one by one.** Stand representatives (46,115 in the September audit) from the laser
  of 23 March 2021 fill 64 stand tiles, the central 2 km. Where they meet the far cones the density steps, and
  nobody measured it (notebook, 10 September). The club reports about 15 trees planted between 17 and 18 since.
  Fix: the tree pipeline, never run here (doctor: "todo"); the ground has no `laser-campaigns.json`, and its own
  stand compiler asserts 64 tiles (notebook, 11 September).
- **No grass round the ball, ground cover or reeds.** Its vegetation is measured-only, so the engine plants
  nothing it did not measure (`docs/visual-near-grass-2026-09-26.md`, `docs/visual-ground-2026-09-26.md`).
- **Every house is a guess above its footprint.** The pack calls each of the 562 buildings `house`, and 561 had a
  generic 5 m height in the September audit (`lidingobuild/mapping/placement-audit.md`), so the house kit types
  them by size, shape and land use. All 554 kit houses stand within 800 m of a hole and take every part:
  1,330,566 triangles at high quality, timed only on the RTX 5080 (`docs/visual-houses-2026-11-08.md`).
- **Parts of the campus are estimated:** façade sizes, hidden elevations, the huts' roofs, net heights and the
  count of bays and supports (`lidingobuild/facilities/README.md`). It follows the May 2025 photo; the club
  reported new range netting for spring 2026.
- **The completeness report is stale.** `node lidingobuild/mapping/audit-completeness.mjs --check` fails: it
  counts 129 playing outlines, and the committed report says 128 and gives hole 13 no bunker. Fix: regenerate it.
- **A WebGPU warning,** "Draw with a vertex count of 0", is logged here (`docs/visual-houses-2026-11-08.md`,
  8 November). The records do not say what draws it or what would fix it.
- **Never done:** the owner's hole-by-hole look (0 of 126 verdicts, doctor), any of the 14 release gates
  (`course-workflows/lidingo/review.json`), independent ground control, and the club's leave to use its guide and
  photos (the open release items above; their exit gates are in `geo_data/course-v2/lidingo/source-manifest.json`).

## Worth looking at

The records name no best holes. The most work is behind hole 1 from the clubhouse with the two red range barns
(rebuilt from the owner's photograph on 9 November), the clubhouse courtyard and its three terrace levels, Café 9,
and the sea with Bogesundslandet beyond it; the posters use holes 2, 16 and 18, and why was not recorded. Most
likely to be wrong: the bunkers on 15 and 16, the greens on 3, 4, 15 and 18, the tees on 5 and 8, Orange on the
back nine, hole 13 (a bunker added on 10 September, a fairway fragment rejected), hole 18 (a bare-soil patch not
adopted, new planting towards 17) and the line where the measured stands end.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Sticklinge · Lidingö

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Nedför från klubbhuset | 3 | 14 | 162 m | 2 | 3 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=1&karta=1) |
| 2 | Ner mot dammen | 5 | 6 | 498 m | 5 | 1 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=2&karta=1) |
| 3 | Två dammar till vänster | 3 | 10 | 196 m | 3 | 1 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=3&karta=1) |
| 4 | Upp mot klubbhuset | 4 | 4 | 395 m | 4 | 2 | creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=4&karta=1) |
| 5 | Runt udden | 4 | 18 | 262 m | 2 | 2 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=5&karta=1) |
| 6 | Nedför med dammen till höger | 3 | 8 | 188 m | 4 | 1 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=6&karta=1) |
| 7 | Kortets näst svåraste | 4 | 2 | 351 m | 3 | 4 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=7&karta=1) |
| 8 | Ropa fore | 4 | 12 | 356 m | 4 | 3 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=8&karta=1) |
| 9 | Ner till Café 9:an | 3 | 16 | 161 m | 3 | 1 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=9&karta=1) |
| 10 | Över krönet | 5 | 7 | 492 m | 3 | 5 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=10&karta=1) |
| 11 | Över svackan | 3 | 17 | 134 m | 2 | 3 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=11&karta=1) |
| 12 | Vänster genom skogen | 5 | 3 | 470 m | 2 | 2 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=12&karta=1) |
| 13 | Upp till den upphöjda greenen | 4 | 11 | 343 m | 3 | 1 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=13&karta=1) |
| 14 | Tio meter nedför | 4 | 15 | 325 m | 2 | 2 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=14&karta=1) |
| 15 | Index ett längs Trolldalsvägen | 4 | 1 | 377 m | 3 | 1 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=15&karta=1) |
| 16 | Korthålet vid dammen | 3 | 9 | 194 m | 3 | 3 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=16&karta=1) |
| 17 | Längs diket | 5 | 13 | 449 m | 3 | 2 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=17&karta=1) |
| 18 | Nedför mot klubbhuset | 4 | 5 | 433 m | 3 | 1 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=lidingo&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

The faults the records describe as found while this ground was built, what found each, and what holds it now.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| A wrong sign on the water's depth bias, and silt drawn on measured water | comparing WebGPU with WebGL2 | the first 3D build, 7 September | `lidingobuild/check-runtime.mjs` on both backends (a browser check) |
| 26,350 tufts, bushes, stones and reeds planted on a ground that states mapped-only and measured-only | the browser placement audit | the September mapping iteration | `lidingobuild/mapping/placement-audit.mjs` (a browser check) |
| Road ramps floating over the terrain | the facility review | the same | three tests on the road mesh, and `V3D.roadDraping()` in the audit |
| No parking drawn: 28 closed parking ways read as lines | the placement audit | the same | `normalize-infrastructure.py` and its review record |
| The laser roofs drawn as the visible roofs looked "like a broken tent" | the records do not say | by 9 September | the display model, then the Blender campus of 10 September |
| 90 tee references on 34 points, every tee marker hidden, a deck tied to the wrong hole | the tee review on the 31 May 2025 photo | 9 September | `reviewed-tee-alignment.node-test.mjs` and `tee-runtime-audit.mjs` |
| A start that failed: Windows had changed the last newline of the content-addressed surrounding-water file | the browser check of that review | 9 September | Git line-ending rules and a test of the shipped file's identity |
| The sea as flickering bands of land and water, and a bright rectangle on it | the owner's phone (WebGL2) | 10 September, in use | the terrain mask under the measured sea (`lidingo-environment-water.mjs`) and its weld test |
| Tan squares among the far tiles: the far tint stopped at 6,144 m of 8,192 | the owner's phone | 10 September, in use | the fix (`GROUND_TINT_FAR` reaches the graph's bounds); the records name no test |
| The fallback badge gave no cause on a phone | the owner's phone | 10 September, in use | the badge prints its cause and `loadRings` asks once more; the records name no test |
| No far trees: Bogesundslandet a green plate to the horizon | the records do not say | 10 September | the far ring stands on the land-cover record (`vegetation-render-policy.test.mjs`) |
| `apply-reviewed-surfaces.mjs` wrote a provenance sentence over each reviewed hole's note | the records do not say | the hole guides | `lidingobuild/course.node-test.mjs` derives the notes again and demands equality |
| Four campus whites over the glow's ceiling | the quality gate | after publication; the records give no date | nothing yet: the 4 errors stand |

## Decisions

The records attribute three decisions that reach this ground to the owner, all in
[the houses](../visual-houses-2026-11-08.md); `CLAUDE.md` records none for Lidingö by name.

- 8 November 2026: the house kit and the photo's roof colours on "all the courses except Johannesberg", which
  brought them to Lidingö.
- 8 November 2026, the same evening ("Do 3-5!"): low quality takes the kit's flat windows and doors on every
  house. At Lidingö that is 122,834 part triangles against 1,330,566.
- 9 November 2026: "improve the two red buildings next to hole one in Lidingö golf", in Blender, from the owner's
  reference photograph. The two range barns were rebuilt.

The owner's phone report of 10 September led to the sea and horizon fixes; the notebook records it as a report,
not a decision. Still the owner's to decide or do: the four whites (dim them or accept them); whether a grass
clump is "inferred vegetation" on a measured-only ground (the notebook calls it the owner's call); a tree round;
the 3 built files that no published generation names (doctor); a look through all 18 holes; and whether to trace
this ground again under pipeline v2.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground lidingo          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground lidingo --check    # this page against the records
node tools/course-walkthrough.mjs --ground lidingo --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=lidingo&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc lidingo:1:tee:dag,lidingo:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only lidingo --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- `?bana=lidingo&buildingGeometry=source` draws the five measured roof meshes (7,069 triangles) instead of the
  campus (`lidingobuild/facilities/README.md`).
- `?houses=before`, `?roofs=palette` and `?houseparts=all` are the house kit's befores, on every course.
- `?bana=lidingo&view=sources` is the first source-only map (the handoff of 7 September names it).
- Kept generations: eleven ground manifests are on disk in `apps/golf/public/grounds/lidingo/`, the current
  `f7a0d942d5e9` among them. No record names one as the before. The receipt of 10 September
  (`lidingobuild/mapping/alignment-integration-2026-09-10.json`) names `ground-v2-3550a885….json` as its
  baseline.
