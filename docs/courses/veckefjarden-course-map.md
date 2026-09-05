# Veckefjärdens GC — the course, feature by feature

> Compiled 2026-09-05. This is the inventory of everything the model knows about the
> place, by category, with where each thing came from, how it was checked, and what is
> still missing. The evidence for the ground itself is in
> [`veckefjarden-source-dossier.md`](veckefjarden-source-dossier.md); this file is about
> what stands on it. Counts are read from `geobuild/course-model.json` as committed.

## 1. The two records that changed everything this pass

Until now the course had two authorities: OpenStreetMap where it mapped (12 of 18 holes)
and the club's hole plans where it did not, the plans being registered to the world by a
tee-and-pin similarity that the blind test put at 5–6 m. Two more records were brought
in, and both are orthorectified — a tile's coordinates are its georeference, so neither
needs registering to anything:

- **Lantmäteriet's 1 m laser terrain**, already published for this ground as the 64
  level-0 tiles the app serves (`apps/golf/public/grounds/veckefjarden/terrain`, RH 2000),
  decoded and sampled in the pack's own frame through `legacyGridBridge`. The sampler
  agrees with the model's own tee and green heights to within a metre at all 36 points.
  In hillshade it shows every bunker as a dish, every tee as a plateau, every green as a
  graded surface, every ditch as a valley and every cart path as a ribbon.
- **Esri World Imagery at z18** (0.268 m/px), 638 tiles over the course, decoded through
  Chromium (Node has no JPEG decoder). A single autumn date: sand is pale grey, mown turf
  green, the range and the fjärd's silt margins brown. The 12 OSM greens land on the
  green blobs; the 32 OSM bunkers land on the pale patches.

`geobuild/dtm-lib.mjs` reads both; `geobuild/derive-dtm-features.mjs` derives
`geobuild/dtm-features.json` from them, and `reconcile.mjs` folds it in. Order:
`reconcile → apply-shapes → reconcile → derive-dtm-features → reconcile`.

**The calibration is the OSM bunkers.** Sand in the imagery (R > 105, R ≥ 0.85 G, from
the 21 OSM bunkers with a clear dish: inside ≈ rgb 140/147/124 against turf 63/113/60)
over a dish in the DTM (rim minus floor ≥ 0.15 m) reproduces the 32 surveyed bunkers
to 1–2 m by centroid and confirms every one of them: 29 with a clear dish, 3 (13-1,
18-0, 18-3) as flat sand. A rule that finds what the survey found is allowed to find
what the survey missed.

## 2. What was wrong, hole by hole, and what was done

### Bunkers

| bunker set | before | measured | now |
|---|---|---|---|
| 32 OSM outlines | as drawn | dish 0.14–0.69 m, sand 0.5–0.93 | kept as drawn |
| 20 plan-traced (holes 1–5, 7) | registered by tee and pin | 13 of 20 stood on ground with **no dish** (−0.4…+0.13 m), 12–30 m from the real sand | replaced by 19 sand-over-dish outlines; the plan readings re-anchored land **0.6–10.9 m** from them |
| 3 guide-placed (13, 15, 18) | "approxFraction" along the hole | 13's was 7.8 m off a real bunker, 18's 19 m, **15's is on ground with no dish at all** | 13 and 18 replaced by the real outlines; 15's dropped |
| the 5th bunker of the 3rd | read off the plan at (−146, 78) | nothing within 63 m | replaced by the sand at (−38, −100) that the plan's count called for |

**The plan registration had a compounding bug.** `apply-shapes.mjs` anchored the pin on
`h.pin`, which `reconcile` sets to the traced green's own centroid once a trace exists;
every re-run therefore registered each plan against the previous run's reading and the
green walked away from the survey by the reader's offset each time. Hole 3 had reached
19.4 m, hole 5 18.8 m, hole 7 11.4 m — against 2.1–4.5 m for every OSM green. The anchor
is now the surveyed green centre read straight from `geo_data/`, and the shrunk green
ring is re-centred on it (the shape is the reader's, the position the survey's). The
blind test on 13 and 17 reads 5.8 and 5.0 m from the survey.

### Tees

The laser terrain shows the real decks. Under 17 of the 31 synthesised pads there is a
flat plateau (5 × 5 m spread < 0.10 m, 40–390 m²), and 12 of those replace their
rectangle (holes 1, 4, 5, 7, 10, 11, 13, 14; the others share a deck already adopted).
The 2nd, 3rd and 5th back tees stand on no plateau at all: their marks sit on sloping
ground (spread 0.6–1.7 m over the pad), which means the slid back-tee point on those
holes is not on prepared ground and the real championship tee lies elsewhere — an open
item, stated in §5. The OSM pads on holes 1, 3, 4 and 5 are 6–8 m² boxes, a mapper's
symbol rather than the deck.

### Ditches and trenches

OSM has 12 streams and the river; the club's own words name ditches OSM never drew
("ett dike längs den högra" on the 3rd, "till vänster ett dike" on the 4th, "diket
60 meter kvar" on the 8th, "andra diket" on the 10th, the 17th's crossing ditch, "diket
vid inspelet" on the 18th). A directional valley filter on the DTM, sampled along every
playing line, finds where a linear valley crosses it; each crossing is traced along its
bottom by least-cost path on the black top-hat and trimmed where the depth gives out.
Adopted on a valley score ≥ 0.4 and a mean depth ≥ 0.3 m, or on the club's word:

| hole | crosses at | depth | the club |
|---|---|---|---|
| 1 | along the right, 145 m | 0.55 m | "till höger mellan klippgräns och anlagd väg" — the roadside ditch |
| 2 | 421 m to green | 0.34 m | — (foot of the 48 m descent) |
| 3 | 277 m | 0.35 m | — |
| 3 | along the right, 100 m | 0.21 m | "ett dike längs den högra" |
| 5 | 428 m | 0.32 m | — |
| 6 | 375 m | 0.73 m | the deepest on the course, 42 m off the tee |
| 9 | 302 m | 0.53 m | — |
| 10 | 366 m | 0.59 m | one of the two the club counts |
| 16 | 153 m | 0.52 m | — |
| 17 | 70 m and 31 m | 0.43 / 0.34 m | the crossing ditch the club states and the model lacked |
| 4 | 22 m | 0.32 m | "till vänster ett dike" — a 99 m valley crossing the line just short of the green, score 0.35, admitted on the club's word |
| 18 | along, right of the second shot | 0.19 m | "bäcken gör sig påmind på andraslaget" — the 16th's crossing ditch continued 110 m south-east along the laser valley to within 60 m of the line; it never crosses |

Thirteen now. The 10th's "first ditch" is the 366 m crossing already in the table, and
the 8th has no ditch in the club's text at all (an earlier note here invented one). The
18th's "diket vid inspelet" is the OSM stream beside the approach pond, 14 m from where
the valley filter peaks. All thirteen carve the terrain and are staked red, which is
what the club's rules say every ditch is.

**A re-run of `derive-dtm-features` must not believe its own earlier output.** The
model folds `dtm-features.json` in on every reconcile, so on the second run the
crossing filter found every ditch "already in OSM" (it compared against all streams,
its own included) and the deck finder found no synth pad left to look under: 9 ditches
and 12 decks silently gone, on the documented chain order too. Both tests now skip
`prov:"dtm"`; a deck found on an earlier run is re-measured, never inherited.

### Greens

The 12 OSM outlines are 2.1–4.5 m from the surveyed centres and are kept. The six plan
greens are now centred on the survey; their shapes remain the plan reader's. An attempt
to re-trace them from the imagery (region-growing on colour and texture from the GPS
centre) reached IoU 0.33–0.80 against the OSM greens and was **not** adopted — a putting
green and its fairway are not separable in 0.27 m autumn imagery by colour (green R 62–77
against fairway 65–87) or by texture (2.3 against 3.0). The club's "two plateaus" on the
1st is in the notes, not the geometry.

**The second attempt (later the same day) tried five more ways and measured each on
the 12 surveyed greens.** Esri's Wayback service holds every past release of World
Imagery, and release 27982 (2025-04-24) is ONE leaf-on capture over the whole course
— the live mosaic is a patchwork whose southern tiles are a leaf-off date with the
1st's green under its winter cover (`geobuild/cache/sat18-27982`, fetched by the
scratch tool with `SAT_REL=27982`). On that capture every green reads as a paler
disc by eye at 3 px/m, and still nothing traces it:

| method | median IoU vs the 12 OSM greens |
|---|---|
| polar edge from the GPS centre (largest brightness step) | 0.36 — locks on the apron edge, 2× the area |
| first significant step outward | 0.44 |
| 1 m DTM roughness region-grow (greens ARE the smoothest surface: 0.014–0.025 vs 0.024–0.044 in the collar, on all 12) | 0.53 |
| the club plan's own green fill, bunker-registered | raw 0.51, aligned 0.64 — the plan draws fairway green too |
| 1.5 m-smoothed brightness blob | 0.54 |
| brightness + roughness fusion | 0.55 |

A blind eye-trace of the 13th on the leaf-on image put its oval east–west; the survey
runs north–south. So the six plan greens keep their plan shape on the survey centre,
and that is written down as the limit of what exists: a survey or a leafed-on image
at better than 0.27 m is what finishes them. One thing did improve on the way:
registering each plan on its DTM-measured bunkers instead of the drawn flag cuts the
pin-end registration error from 5–16 m to 2–8 m (the flag is drawn where the pin was,
not at the green's centre).

### Marking

- **All penalty areas are red.** The generic rule painted a carry yellow; the club
  abolished yellow in 2022 ("endast röda pliktområden"). The three yellow runs (14 and two
  on 6) are red now, from `course-rules.json`.
- **Out of bounds follows the club's list, not the guide's guess.** The 2025 local rules
  name the OB stretches on holes 1, 2, 3, 4, 5, 10, 11, 12, 13 and 16, with what they
  divide the hole from. `reconcile` derives each run: along the named side, snapped to the
  property polygon where it runs within reach, otherwise half way to the named neighbour
  (the range, the korthålsbana, the practice green), otherwise at the edge of the rough;
  behind or around a green as an arc past the collar. 15 runs, 355 stakes, each carrying
  the club's sentence it came from. The old set had white on 2, 10, 11 and 13 only.

### Water

All 14 ponds measured against the laser plate inside their OSM rings: 10 are dead flat
(p05 = p95) at 0.1–0.3 m from the model's level, which confirms both the outlines and the
Terrarium levels; Hörnsjön alone sits 5.5 m too high (the dossier's finding, left, since
its GPK1 shore is Terrarium too). The fjärd's ring is where the plate says it is.

**The shorelines are the laser's now** (`geobuild/laser-water.mjs` →
`laser-water.json`, folded in by reconcile as `prov:"laser"`). The fjärd is one flat
plate at 0.280 m RH 2000 across the whole DTM window, 116.9 ha, no flight-strip seam.
Its boundary, traced at 2 m vertices within 300 m of a hole line and 6 m beyond, replaces
the OSM ring inside the window and is spliced onto the OSM ring on the window edge
(2044 vertices, no self-intersection, area 196.3 ha against OSM's 196.26). Near the
course the OSM shore was a median 2.0 m off, p95 8.6 m; two places were really wrong: by
the 3rd OSM cut a 200 m chord across a convex shore and drew land 17 m into the water,
and by the 15th's piers a 45 m × 8 m mole carrying the path stands 0.7–1.1 m above the
water and OSM ends 17 m short of it. The island 14th is NOT an island at water level —
the laser draws OSM's neck, tighter. Every pond inside the window has a plate (≥ 88 % of
its interior within ±0.075 m) and its ring is the plate's outline; the 12th's pond is a
dumbbell the laser splits into two lobes (1054 + 480 m²), carried as two bodies. Levels
stay the heightfields' — the laser plate in legacy metres lands 0.1–0.4 m from them and
the Terrarium terrain the GPK1 water sits on is what those levels were measured from —
with the laser reading kept as `levelLaser` beside each; Hörnsjön's is 101.59 against
the model's 107.06.

## 3. The inventory, by category

| category | count | source | checked against |
|---|---|---|---|
| holes | 18 + 9 | card (144 values, three club sources), GPS survey, OSM hole ways | every line measures its card to 0.02% |
| greens | 12 OSM + 6 plan; 10 scenery (9 korthålsbana + practice) | OSM, plans, survey | survey centres 2.1–4.5 m (OSM); plan greens re-centred |
| fairways | 19 OSM rings + 3 OSM relations + 4 plan + 1 synth; 5 scenery | OSM (incl. r20948903/4/5, dropped until now), plans | imagery |
| tee pads | 45 OSM + 12 DTM decks + 31 synthesised; 8 scenery | OSM, laser terrain | flatness/step on the DTM |
| tee marks | 108 (6 per hole) | card lengths along the line | app gates every mark on tee turf |
| bunkers | 52: 32 OSM + 20 DTM | OSM; imagery × terrain | §1 |
| ditches | 11 (DTM) + 12 OSM streams + the Moälven | laser terrain; OSM | the club's text |
| ponds and the lake | 15 | OSM | laser plate |
| silt shallows | 2 | satellite trace | — |
| penalty marking | 46 red runs, 470 stakes | derived from every water ring and stream near a corridor | club: red only |
| out of bounds | 15 white runs, 355 stakes | derived from the club's 2025 rules | side and offset per run |
| property boundary | 77-point ring | OSM `leisure=golf_course` | — |
| forest | 20 polygons + 1 wood + 1 wetland | OSM | tree-cover raster from imagery (the planter's authority) |
| reserves | 3 (Hörnsjön; Veckefjärden east **and west**) | OSM | the western half (w43043598) was outside the fetch bbox until now |
| roads | 78 (E4 as paired roadbeds, Golfbanevägen, Åsvägen…) | OSM | — |
| tracks and paths | 15 + 69 | OSM | ribbons, not painted |
| railway | 31 segments, catenary masts | OSM | — |
| power | 11 lines, 36 towers, 12 poles (two 130 kV corridors) | OSM | — |
| buildings | 344 near (340 OSM + 4 satellite-traced) + 884 far boxes | OSM, traces | OSM gained 65 footprints 1.3 km south since the last extract |
| clubhouse | the old school: pale yellow timber, dark grey sheet roof, 3 rows | OSM footprint, photographs | dossier §5 |
| hotel | Hotell Veckefjärden, OSM node at (246, −422) inside the clubhouse cluster | OSM | not yet named on a footprint |
| parking | 6 OSM lots + 1 traced (south of the entrance loop) | OSM, trace | — |
| piers | 5 | OSM | — |
| landuse | 70 rings (residential, farmland, industrial, allotments) | OSM | — |
| hayfields, clear-fells, machinery yard | 1, 2, 1 | satellite traces (RMS 6.6 m) | — |
| driving range | 1 polygon (OSM) | OSM | imagery: an unmown meadow on the capture date, a hut at the tee end |
| landmarks | Åsbergsmasten, Själevads kyrka, the 14th's granite collar, reed beds | surveyed coordinates, photographs | dossier |
| rules | OB, red PAs, 5 bridges, 2 drainage ditches, GUR, obstructions | the club's 2025 PDF, transcribed | `course-rules.json` |
| hole text | 18 × (`note`, `club`, `club2019`, `clubWeb`, sponsor) | LiveCaddie, magazine 2019, the club's page | sponsors match `sp` 18/18 |

## 4. How to look at it

The imagery tools of the second pass live in `geobuild/imagery/` (usage in each header
and in CLAUDE.md): `wayback.mjs` fetches a dated capture, `crops.mjs` renders the
tracing crops every finding above was read from (`sheet` all greens, `green` one at
8 px/m, `evidence` imagery | smoothed brightness | laser roughness, `object` buildings
and lots), `green-tracers.mjs` re-runs the six methods and prints their IoU,
`plan-register.mjs` registers the plans on their bunkers, and
`treecover-vs-imagery.mjs` paints where the raster and a leaf-on read disagree.
`geobuild/laser-water.mjs` is the shoreline reader.

- `node geobuild/derive-dtm-features.mjs` prints every match (plan bunker → real
  bunker, with the distance), every drop, every ditch with its metres-to-green.
- The review pictures used here were two-panel crops — hillshade left, imagery right,
  the model over both — at 2–6 px/m; the scripts are scratch tooling and the pictures
  are not committed (the imagery is Esri's). The overview is
  `veckefjarden3d-design.png`'s job; `render-design.mjs` still draws the layout.
- `tools/hole-geometry.mjs geobuild` prints what the model says about each hole.

## 5. Still open

- **The 2nd, 3rd and 5th back tees** stand on unprepared ground in the DTM. The card
  slide puts them there; the real championship decks are not where the survey's back
  tee plus the slide says. Needs the decks found and the lines re-ended on them.
- **The range**: tee line, bays, nets and target greens are not in the model. The
  imagery caught the field unmown and shows no mats; the club's own site speaks of a
  flagpole-lined range with covered bays. A photograph is needed, as at Puttom.
- **The padel courts and the hotel** are not drawn as what they are (the hotel is a
  plain building in the clubhouse cluster; the courts are not in OSM). The four
  buildings read off the screenshot ARE re-read on the z18 orthoimagery now (the two
  south of the E4 underpass and the two in the machinery yard were 8–13 m out and up to
  twice their size; one was shadowed material, now a 15 × 25 m shed) — every OSM
  footprint and parking lot at the clubhouse sits on the imagery exactly.
- **Cart paths**: OSM's 69 paths are what the model has. The laser terrain shows more
  (the ribbons are clear in hillshade) and the imagery shows them too; they are not
  traced yet. The five bridges the club names (6, 8, 10, 11, 16/17) exist only where a
  mapped path crosses a modelled water line.
- **Plan greens** keep the reader's shape. Six methods on two images and the laser
  terrain all cap at IoU 0.5–0.65 against the survey (see §2, Greens). Only a survey or
  a better image fixes that.
- **Hörnsjön's outline** is outside the DTM window and stays OSM; four far ponds too.
- **The v2 vegetation exclusions** were compiled on the pre-correction greens; the
  three greens that moved 11–19 m were not masked where they really are. Real crowns do
  not stand on real greens, so the risk is small, but the next vegetation publish should
  use this geometry.
- **Water levels from the DTM** (Hörnsjön −5.5 m) remain unapplied, per the dossier.
