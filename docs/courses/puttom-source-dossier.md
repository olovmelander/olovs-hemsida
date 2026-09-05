# Örnsköldsviks Golfklubb Puttom — source dossier

> Compiled 2026-09-05. Everything here is either a source that was read on
> that date and is quoted, or a measurement made in this repository and
> reproducible from a command in it. Where a source and this repository
> disagreed, the disagreement is stated rather than resolved silently.

The machine-readable ledgers are
[`source-manifest.json`](../../geo_data/course-v2/puttom/source-manifest.json)
(the v2 ground), [`course-model.json`](../../puttombuild/course-model.json)
(the course as the app draws it) and, new with this dossier,
[`laser-features.json`](../../puttombuild/laser-features.json) — what the
1 m laser ground says about the course and nothing else does, written by
[`laser-features.mjs`](../../puttombuild/laser-features.mjs).

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Club | Örnsköldsviks Golfklubb Puttom | puttom.se |
| Founded | 1967, nine holes (today's 1–4 and 14–18); the second nine 1975 on land given by MoDo | [puttom.se/om-klubben](https://puttom.se/om-klubben) |
| Architect | Nils Sköld | `puttombuild/card.json` |
| Address | Ovansjö 232, 891 95 Arnäsvall | puttom.se/kontakt |
| Phone | 0660-254001 | puttom.se/kontakt |
| Staff (2026) | Petter Hägglund, klubbchef/pro; Malin Gidlöf, kansli och shop; Ingemar Strandberg, banchef | puttom.se/kontakt |
| Course | 18 holes, par 72 (36/36), "skogs- och parkbana som sträcker sig runt Lill-Rössjön och Stor-Rössjön", laid out as a four-leaf clover returning to the clubhouse after 4, 9, 13 and 18 | puttom.se/om-klubben |
| Facilities | restaurant with course view (08.00–20.30 in season, chef Osman), shop and reception, driving range, practice area (putting green, chipping area, inspelsgreen), two Trackman simulators in "Golfhallen", cart hire (350/400 kr), one 11 kW type-2 charging point | puttom.se; OSM node 10742266094 |
| Guest fee 2026 | 550 kr adult, 450 kr low season (23/5–7/6); partner clubs Härnösand, Norrfällsviken, Sollefteå, Veckefjärden, Bjurholm, Umeå, Norrmjöle, Sörfors | puttom.se/greenfee |
| Slug / ground id | `puttom` / `puttom` | this repository |
| OSM | way 237392514 `leisure=golf_course`, "Örnsköldsviks Golfklubb Puttom", `golf:par=72` | OSM 2026-09-05 |

## 2. The frame and the ground

The legacy frame is ORIGIN 63.29920 N, 18.94130 E (`puttombuild/lib.mjs`),
north −z, east +x, `mPerLat` 111320 and `mPerLon` 50019.58. Its bridge to
EPSG:3006 is derived by `geodetic-frame.mjs` from those constants: rotation
+3.5221° (meridian convergence 3.94° east of the central meridian), scaleX
0.997252, scaleZ 0.998609, origin E 697498.022 / N 7024997.739. The
vertical datum step between the pack's Terrarium heights and RH 2000 is the
measured **23.6263 m** (`v2-puttom-preview.mjs`).

The v2 ground is Lantmäteriet's Markhöjdmodell at 1 m over a 2048 m
window (E 696404.5–698452.5, N 7023802.5–7025850.5, item 702_69) inside a
16 km ring graph of 277 tiles in seven levels; all 4,198,401 course-window
samples are finite, 26.12–103.22 m RH 2000. Two Laserdata Skog campaigns
meet at N 7025000 (June 2023 north, June 2026 south) and the published
vegetation is 3,502 machine-reviewed individual crowns (median height
12.6 m, p90 18.1 m, tallest 30.2 m) plus stand fields on all 64 tiles,
from 44,961 candidates (zone A 2,026, B 5,422, C 37,513). See
[`puttom-v2-lidar-tree-placement-plan.md`](../puttom-v2-lidar-tree-placement-plan.md).

### 2.1 The laser corrects the pack's heights on one hole

`laser-features.mjs` samples the published tiles through the app's own
bridge at every tee and green centre. Seventeen greens agree with the pack's
Terrarium heights within ±0.9 m (median −0.13). **The 7th does not: the
pack's green stands 7.12 m above the laser ground.** Terrarium carries
canopy, and the 7th's green sits under the forest edge. The hole's Terrarium
profile (90 → 100 → 84 m along the line, oscillating by ten metres) is
trees; the laser profile is a 4 m hump — tee 53.3, a dip to 50.8 at 310 m
out, the crest 55.6 at 185 m, 51.2 at 60 m, green 53.7 m RH 2000 — which
is the "över toppen på kullen" the club describes. The displayed tee/green
heights and rises therefore now come from the laser for all 18 holes
(`elevSrc: "laser"`, the Terrarium pair kept under `elevTerrarium`).

| hole | laser tee (legacy m) | laser green | rise | Terrarium rise |
|---|---|---|---|---|
| 1 | 68.1 | 71.4 | +3.3 | +2.2 |
| 2 | 73.8 | 67.7 | −6.2 | −6.7 |
| 3 | 67.5 | 63.4 | −4.1 | −4.3 |
| 4 | 65.2 | 66.5 | +1.3 | +1.0 |
| 5 | 71.3 | 74.9 | +3.6 | +4.3 |
| 6 | 78.0 | 78.2 | +0.1 | +0.4 |
| 7 | 77.0 | 77.3 | +0.3 | **−5.9** |
| 8 | 76.7 | 74.2 | −2.5 | −2.9 |
| 9 | 75.4 | 65.7 | −9.7 | −10.0 |
| 10 | 68.6 | 67.8 | −0.8 | −1.1 |
| 11 | 66.1 | 67.8 | +1.7 | +2.6 |
| 12 | 64.9 | 65.6 | +0.8 | −0.5 |
| 13 | 67.4 | 63.9 | −3.5 | −2.9 |
| 14 | 63.3 | 65.9 | +2.6 | +2.8 |
| 15 | 64.0 | 66.0 | +2.0 | +2.0 |
| 16 | 62.8 | 78.9 | +16.1 | +12.8 |
| 17 | 74.3 | 77.0 | +2.7 | +2.3 |
| 18 | 77.2 | 65.8 | −11.5 | −12.1 |

The 16th climbs 16.1 m, not 12.8: the biggest rise on the course is three
metres bigger than the card page used to say.

## 3. The card

`puttombuild/card.json`: par 72, four tees named by metres (Vit 61, Gul 57,
Röd 48, Orange 41), 6,050 / 5,600 / 5,010 / 4,170 m, rating 2018-07-25
(men Vit 73.1/146, Gul 71.3/142, Röd 67.3/134; women Gul 77.6/142, Röd
72.7/131, Orange 67.4/121). `check3d` gates all 108 par/index/tee values and
every drawn line to its card length (worst 0.015 %, the 12th).

Two things stand against it, unchanged from the guide-notes' caveat: the
club's LiveCaddie card gives hole 11 index 6 and hole 16 index 12 (the
committed card, from caddee.se and golfisverige.com, has them swapped), and
the club's card lists no 61 tee on 3, 4, 11 and 12. **The club's own hole
plans contradict the second point on 11**: plan 11 draws a 61 tee 75 m
behind the 57, which is exactly the 72.7 m the card slide puts the back tee
behind the mapped pad. The plans draw a 61 marker on every hole.

## 4. Where each thing comes from

| source | date read | used for |
|---|---|---|
| OpenStreetMap, raw map API bbox 18.905,63.283,18.975,63.318 (`fetch-osm.mjs`) | 2026-09-05, identical to the committed extract | 20 greens, 22 fairways (two new: see §6), 32 tee pads, 41 bunkers, 19 hole ways, the range, 13 lakes, 3 streams, forest/wetland/farmland, 36 roads, 8 tracks, 23 + 18 buildings, Botniabanan, the E4 |
| GolfTraxx survey `geo_data/puttom_clean.json` (id 89195SW) | committed | green centres (2.8–11.9 m from the OSM ring centroids) and back tees |
| the club's card | committed, twice confirmed | every displayed number |
| `sat-traces.json`, Esri World Imagery z18 (0.27 m/px) | committed 2026-09-02 | the hub: 17 buildings, 5 lots, the access road and hub override box, 4 cart paths, 3 service tracks, the works yard, the range's tee arc and net, the cart row |
| LiveCaddie course 658 (`courses.livecaddie.com/course-graphics.php?course=658&hole=N`) | 2026-09-05 | 18 drawn hole plans (702 × 1053 px, files 711182–711199): every tee's position relative to the hole, bunkers, paths, ditches, penalty lines, green depths; the hole text (already condensed in `guide-notes.json`) |
| puttom.se/lokala-regler, 2026 | 2026-09-05 | out of bounds and red penalty areas by hole, the four bridges, two drop zones, the pump house, the bell posts, the distance stakes, the robot mowers |
| sv.wikipedia Insjöfakta (SMHI/SVAR) | 2026-09-05 | the name, register id, area and SVAR height of 12 of the 13 lakes |
| Lantmäteriet Markhöjdmodell 1 m, as published in the app | committed | levels, heights, ditches, water plates (§5, §7) |

## 5. Water — thirteen rings, twelve named

OSM tags no lake here by name. `reconcile.mjs` used to call the two LARGEST
rings Stor- and Lill-Rössjön; both are four kilometres from the course.
`laser-features.mjs` now names each ring by a Wikipedia/SVAR coordinate that
must fall **inside** it (the tool throws otherwise). Levels are the laser's
median over the ring, in RH 2000; the pack keeps its Terrarium-derived levels
because its own terrain is Terrarium.

| OSM way | name | area (ha) | laser level RH 2000 | SVAR "höjd" | pack level (legacy) | lake treatment |
|---|---|---|---|---|---|---|
| w25201041 | **Högbysjön** | 120.9 | outside the laser window | 42.1 | 66.98 | yes |
| w158585147 | **Ovansjösjön** | 43.5 | 27.33 | 27 | 51.51 | yes |
| w158585145 | Norrtjärnen | 20.1 | outside | — | 67.59 | no |
| w185976257 | **Stor-Rössjön** | 13.7 | **39.10** | 39 | 62.81 | yes |
| w227300000 | **Lill-Rössjön** | 11.0 | **37.26** | 38 | 60.74 | yes |
| w169411536 | Tävrasjön | 10.2 | outside | — | 50.31 | no |
| w227299997 | Kroktjärnen | 10.0 | outside | — | 52.00 | no |
| w185976255 | Långtjärnen | 9.4 | outside | — | 77.84 | no |
| w185976262 | Trättjärnen | 5.9 | 26.18 | — | 49.66 | no |
| w227299999 | Hjältatjärnen | 5.2 | outside | — | 52.60 | no |
| w237206745 | Bursjötjärnen | 5.2 | outside | — | 43.80 | no |
| w237206743 | Görtjärnen | 1.8 | outside | — | 66.92 | no |
| w237392499 | (unnamed tarn, an inner of the forest multipolygon) | 1.1 | outside | — | 70.35 | no |

The two Rössjön lakes are the ones the course stands on: Stor-Rössjön is the
ring the 12th, 13th, 14th and 15th play over and the 16th tees beside;
Lill-Rössjön sits inside the 4th's dogleg. Both are lakes to the engine now
(the wide shore bench, the finer water mesh), together with the two big far
lakes; the tarns stay ponds. All lake outflows run to Idbyån (local name
Landsjöån), 1.9 km to the sea. Lomsjön (63.2994 N, 18.9694 E) is in the
register but not in the OSM extract.

**How good is the OSM shoreline?** The laser flattens water, so the
connected flat plate at the lake's level is the true water extent.
Stor-Rössjön's plate is 13.86 ha against the ring's 13.69 (Wikipedia 14.4);
ring vertices lie a median 3.0 m from the laser edge, p90 8.3 m, worst
14.9 m at (−57, 120) by the 14th's inlet. Lill-Rössjön: plate 10.77 ha, ring
11.00, median 2.8 m — but its **south tip is drawn 34–46 m past the water**
(vertices at (−400, 53), (−379, 48), (−419, 41)): reed marsh mapped as
lake. Left as OSM draws it; the ring is the shape authority.

## 6. The played surfaces

| class | count | source | notes |
|---|---|---|---|
| greens | 18 + 2 practice | OSM | 227 (17th, the smallest) to 513 m² (18th), median 361 |
| fairways | 22 rings | OSM | two new this pass: the 3rd's apron collar (relation 20948172, an outer way with no tags of its own, 1,401 m², whose inner is a bunker) and the 244 m² landing strip beside the 12th green (w1527461199, under the old 300 m² floor) |
| tee pads | 29 mapped | OSM | plus a synthesised 10.4 × 8.8 m deck under every card mark no pad covers (`tee-pads.mjs`) |
| bunkers | 40 on holes + 1 practice | OSM | 17–153 m²; the 153 m² one beside the inspelsgreen was assigned to the 14th as a fairway bunker 29 m from its tee and is `scenery.bunkers` now |
| driving range | 21,130 m² | OSM | tee arc of 7 bays at 3 m pitch (traced), net 10 m (assumed height) |

## 7. Ditches, bridges and what stands in the water

OSM has no ditch on the course; the three `waterway=stream` ways in the
extract lie a kilometre north-east and west. The laser has them: a 9 m box
residual finds linear depressions, and 53 components of 20 m or more lie
within 40 m of a hole line. The 20 that cross a hole or run within twelve
metres of one, and are not a road's own drain, ship as `streams` of kind
`ditch` (1 m wide, 0.55–0.7 m carve), 1,477 m in all. The crossings the
rules and plans name, measured along each line:

| hole | ditch on the laser | what the club says |
|---|---|---|
| 1 | tvärdike 20 m left of the line at (−164 … −140, −355 … −370), 0.78 m deep, 117 m from the back tee; culverted under the fairway (no dip on the line) | plan 1: dashed ditch across the start of the fairway; rules: red penalty area "till höger från tvärdiket fram till green" |
| 6 | 0.58 m hollow 27 m wide at 327 m to green (by the tee); a 395 m ditch along the right side 9 m off the line | plan 6: none drawn; rules: penalty left at the green |
| 7 | crossings at 316–332 m (before the tee shot) and 57 m to green (0.29 m) | plan 7: dashed ditches at both places |
| 8 | 0.40 m, 5 m wide at 243–248 m to green | rules: "broar på hål 8"; plan 8: bridge on the path at the 41 tee |
| 10 | **0.65 m at 76 m to green** | rules: bridge; club text "tvärdike 75 meter från green" |
| 11 | crossings 290–329 m to green (0.35 m), a 115 m ditch running NE from the 10th's crossing | plan 11: dashed line right of the 61 tee |
| 12 | 0.36 m at 21 m to green (the shore-path drain, kept out of the streams) | — |
| 13 | none on the line; the inlet ditch runs along the shore path (145,116)–(121,182) | rules: bridge; plan 13: bridge over the inlet mid-hole |
| 14 | 0.26 m at 449 m to green (the inlet by the back tee) | plan 14: dashed inlet after the 61/57 tees; rules: drop zone "vid pumphuset innan diket" |
| 16 | **0.34 m at 70 m to green**; a N–S ditch at x ≈ −245 … −259 from z 536 to 685, 0.86 m deep | plan 16: dashed ditch before the second fairway; rules: OB left "ner mot diket" |
| 17 | **0.58 m at 313 m to green** (87 m from the tee); a 163 m ditch along the left side, 24–28 m off the line | plan 17: dashed ditch after the 48 tee; red line along the left ditch |
| 18 | **0.35 m, 9 m wide at 56 m to green** | rules: bridge; plan 18: water-filled tvärdike with a bridge at its left end; club text "gå över bron före green" |

**Four tee marks stood in Stor-Rössjön.** A card-length mark is placed
along the hole line, and on 12, 14 and 15 the line crosses a bay: the 12th's
Orange (60 m) was 22.4 m inside the ring on the laser's water plate, the
14th's Röd (405 m) 6.4 m, the 15th's Röd and Orange (135 m) 17.5 m, and the
16th's Vit grazed the ring by 1.1 m. The club's plans put every one of those
tees on the shore to the player's right: the 41 east of the shore path at the
12th's bay, the 48 on the fairway side of the 14th's inlet, the 48/41 on the
strip between the 15th's bay and the service road. `reconcile.mjs` now
slides a wet mark right, square to the line, to the point with the best
clearance from both the ring and the nearest path or road, never across a
road (a walking path may lie between a tee and its water). Results, checked
on the z18 imagery with the marks drawn (`tools/sat-mosaic.mjs` draws them
now):

| hole | mark | slid | now | off the ring | off the nearest way | to green centre (card) |
|---|---|---|---|---|---|---|
| 12 | 60 | 40 m R | (218, 322) | 13.9 m | 9.8 m (shore path) | 69 m (60) |
| 14 | 405 | 24 m R | (−36, −68) | 14.2 m | 9.6 m (shore path) | 404 m (405) |
| 15 | 135 ×2 | 33 m R | (−163, 404) | 3.6 m | 5.4 m (service road) | 140 m (135) |
| 16 | 289 | 10 m off the shore | (−52, 542) | 8.9 m | — | 272 m (289) |

`laser-features.json` records both where the card put each mark and where
it stands now, so the defect stays measurable.

## 8. The eighteen holes

Distances are the card's four tees; "laser" is the RH 2000 profile from
`laser-features.mjs`; sides are the player's; bunkers and bends from
`tools/hole-geometry.mjs`; the rest from the club's plans and 2026 rules.

1. **Par 4, index 15, 320/305/270/235.** Straight, +3.3 m, from the tee
   beside the range up to a green at the lake's north end. Two bunkers left
   (16 m at 20 m to green, 22 m at 74 m). The tvärdike crosses 117 m from
   the back tee; red penalty area right of it to the green, OB right
   towards the range. Cart path along the left. Green depth 22 m (plan).
2. **Par 4, index 5, 326/310/280/225.** Straight, −6.2 m, the fairway
   sloping left and flattening 90 m out; one bunker front-left. OB behind
   the green (the E4 side); red penalty right from tee to green. A small
   practice green sits left of the 48 tee on the plan. Green 23 m.
3. **Par 3, index 17, 137/135/120/120.** −4.1 m to a green ringed by three
   bunkers (13 m left at 15 m, 3 m left at 25 m, 13 m right at 13 m) and
   the apron collar that OSM draws as a multipolygon. OB behind towards the
   road. One of the flattest greens, 30 m deep.
4. **Par 5, index 3, 465/445/380/315.** Dogleg right (42°) around
   Lill-Rössjön on the inside, back towards the clubhouse; +1.3 m. Bunkers:
   19 m left at 220 m, 11 m left at 30 m, then 12 m right and 12 m left at
   the green. Red penalty along the lake right; OB behind the green towards
   the road. The plan draws a small pond by the 48 tee that OSM has not got,
   and a 150 m stake. Green 23 m.
5. **Par 3, index 11, 175/160/130/130.** Uphill +3.6 m to a green tilting
   hard left-to-right; bunkers 10 m and 14 m right, 11 m left. First of the
   1975 nine. Green 29 m.
6. **Par 4, index 7, 350/320/285/245.** Slight dogleg left, level. Fairway
   leans right to 80 m out; bunkers 8 m right and 11 m left at the green.
   Penalty left at and behind the green. A 395 m ditch runs along the right
   9 m off the line and a broad hollow crosses at the tee.
7. **Par 4, index 1, 360/355/295/195.** Blind drive over the crest
   (laser: 4 m hump, crest at 185 m out), then down to a green with bunkers
   14 m and 7 m right. Ditches before the tee and 57 m short of the green.
   Red penalty left "från tee förbi tee 48 fram till kullen innan tee 41".
   Green 28 m.
8. **Par 4, index 13, 346/340/275/210.** Over the brow and down, −2.5 m,
   no bunkers, a green sloping hard back-to-front. Bridge on the path at
   ~100 m from the tee over the 0.4 m ditch. Green 27 m.
9. **Par 5, index 9, 488/465/405/325.** Dogleg left, −9.7 m down to the
   clubhouse; one bunker 10 m right at the green (the plan shows two more
   greenside and a practice bunker left). OB right towards the car park.
   Green 36 m, the largest by the plan.
10. **Par 4, index 2, 428/365/330/265.** Dogleg right; fairway bunkers 9 m
    and 18 m left of the drive (330–369 m out), the tvärdike at 76 m with
    its bridge, one bunker 9 m right at a green sloping from the back.
    OB left along the range/practice fence. Green 26 m.
11. **Par 4, index 12, 380/305/265/265.** Straight, +1.7 m, into a green
    in a hollow (laser: 49.2 m at 80 m out, 44.3 m on the green). Bunkers
    12 m right at 17 m, 13 m left at 13 m, 2 m right at 74 m, and one by the
    61 tee. Red penalty left from the fairway bunker to behind the green.
    Bell post on the green. Green 29 m.
12. **Par 3, index 18, 122/110/95/60.** The signature par 3 over the bay
    of Stor-Rössjön (the line is over water from 34 to 99 m out of 122),
    one bunker 13 m right. The 41 tee stands east of the shore path. Green
    26 m.
13. **Par 5, index 8, 470/460/385/300.** An 89° dogleg left round the
    lake, −3.5 m; bunkers 17 m right at 99 m, 10 m right at 42 m, 9 m left
    and 16 m right at the green. Bridge over the inlet mid-hole. Green 28 m.
14. **Par 5, index 10, 466/465/405/330.** From a point on the lake shore
    over the inlet, up over the crest (laser 46.6 m at 166 m out) and down
    to a small flat green, +2.6 m; bunkers 16 m left and 10 m right. Red
    penalty along the lake left; drop zone at the pump house before the
    ditch ("gamla tee 48"). Green 21 m.
15. **Par 3, index 14, 180/165/135/135.** Over the reedy south-west arm of
    the lake (water from 27 to 123 m out), +2.0 m, no bunkers, a convex
    green 22 m deep. Drop zone in front of tee 48; the 48/41 tee stands
    between the bay and the service road.
16. **Par 4, index 6, 289/280/250/210.** Dogleg right and uphill 16.1 m
    over the hollow with the ditch 70 m short; bunkers 3 m right and 13 m
    left at the green. OB the whole left side down to the ditch; bell post.
    Green 19 m.
17. **Par 4, index 4, 400/385/335/275.** Down then up 160 m of climb to the
    smallest green (227 m²) with four bunkers (11 m right, 13 m left at the
    front; 10 m left and 11 m right at 30 m). Cross ditch 87 m from the tee;
    ditch and red line along the left. Green 20 m.
18. **Par 4, index 16, 348/335/310/210.** Blind drive, then −11.5 m down
    to the clubhouse over the water-filled tvärdike 56 m short (bridge at
    its left end); bunkers 16 m right and 15 m left. Red penalty left from
    the hill to the ditch. Cart path along the right. Green 24 m.

Walks between holes (`hole-geometry.mjs`): 20–105 m, the long ones 4→5
(223 m, across the hub) and 11→12 (105 m, along the bay).

## 9. The hub

Everything here is `sat-traces.json` (z18, confidence medium unless noted),
checked on 2026-09-05 against a fresh mosaic
(`tools/goldens/puttom-sat/hub.png`) and the laser hillshade:

| feature | footprint | notes |
|---|---|---|
| Klubbhus | 19.5 × 28.6 m at (−120, −202) | two storeys, Falu red, white trim, glazed gable and balcony to the 18th green, dark grey gabled roof (`scenery/puttom.js`) |
| annex, small flat block, reception block | 10.5 × 13, 6 × 12, 15.5 × 10.4 m | west and north of the clubhouse |
| entrance square with flagpoles | polygon at (−100, −216) | gravel, no cars |
| motorhome lot | 19 × 51 m at (−147, −190) | the mosaic shows seven vans on it |
| cart strip | 7 × 21 m south of the annex | seven carts in a row (`cartPark`) |
| main car park + apron | gravel polygons east of the access road | high confidence |
| range building, L-shaped (vinkelhus + arm), range hut, range shed | 16 × 6.5, 6.5 × 15, 12 × 8, 8 × 7 m | the covered bays are the 18 m wing; the tee arc is open |
| works yard: long shed, machine hall, small shed, hardstanding | 14 × 30, 21 × 19, 9 × 11 m; yard 70 × 105 m | north-east of the range |
| five summer houses and two sheds | 6–14 m | west of the lot by Lill-Rössjön; "trace-house-red" (13 × 14 m) has a red roof |
| toilets | OSM node 6991528111 at (−129, −221) | inside the clubhouse block |
| charging point | OSM node 10742266094 at (−88, −254) | on the square, customers only |
| place name | "Puttomslandet", isolated dwelling, OSM node at (−73, −212) | |

Two things in the rules are not located: the **juniorstuga** (OB along the
fence "ner mot juniorstugan", new 2026) and the **pumphus** by the 14th's
ditch. The practice complex south of the clubhouse — a putting green
(421 m²), the inspelsgreen (672 m²) with its bunker, and the chipping area —
is in the model as two `scenery.greens` and one `scenery.bunkers`.

## 10. Roads, tracks and paths

- **E4** (`trunk`, `int_ref=E 04`, 100 km/h, `hazard=moose` on eight ways)
  passes 1.6 km north-west; **Botniabanan** (electrified, 250 km/h,
  `start_date=2010-08-30`) runs 1.6 km north in tunnel and on bridges, with
  railway milestones 17–21 in the extract. Two 2+1 link ways and a bus stop
  pair at Ovansjö (−1,350, −740).
- The **access road** is traced (OSM's `unclassified` way cut the bend by
  ten metres and is dropped inside the hub box); it continues as a gravel
  service road to the summer houses, a branch into the works yard, and the
  **corridor road** south past the 18th green, between the 18th and 14th,
  round the bay's south-west arm and down the 17th's east edge.
- Four gravel **cart paths** are traced (1→2, the bay's east shore, 11→12,
  the bay's north shore); the plans draw paths along 1, 2, 3, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 17 and 18 that are not in the model.
- **Arnäsleden**, the municipality's marked hiking route (OSM relation
  10316583, `network=rwn`), comes up the west shore of Stor-Rössjön on track
  w747191422 and ends at the club's access road at (−166, −210), then
  continues on the road past Ovansjö. The 15th's forward tee stands between
  that track and the bay.
- OSM's road network around: `unclassified` gravel roads through Ovansjö,
  Sörbrynge and Tävra, `tertiary` 1058/1062 (Y-roads) to the north-east,
  eleven `service` ways at farms.

## 11. Vegetation, fields and the land

- **Forest**: OSM's 1,149 ha multipolygon east and south (with the tarns as
  inners), a 95 ha block north of the hub, 96 ha west; the 2 m
  satellite raster (`tree-cover.json`) and, on v2, the LiDAR generation
  (§2) are the planting authorities. Thirteen `natural=tree` nodes along
  holes 1 and 2 in OSM are single surveyed trees that the LiDAR covers.
- **Farmland**: eight OSM polygons, 2–98 ha — the Ovansjö fields west
  (−553, −605 and −359, −1101), the Tävra fields east (1,064, −1,248), the
  98 ha of Västerbursjö south-west.
- **Wetlands**: five `wetland=swamp` polygons in OSM, two within the model's
  reach (6 ha at (1,037, 188), 5 ha at (104, 1,302)), the levels 78.3 and
  102.4 m Terrarium.
- **Hamlets** (OSM `place`): Ovansjö (−808, −1,287), Tävra (1,223,
  −1,497), Hjälta (226, −1,920), Sörbrynge (−1,767, −571), Västerbursjö
  (−1,591, 1,693), Kroken and Hjältabacken (isolated dwellings).
- **The land**: the course lies 62–79 m (legacy datum; 39–55 m RH 2000)
  between the two lakes; the highest ground in the course window is 132.8 m
  (legacy) at (204, 1,444) south of the 17th. The vista heightfield reaches
  228 m; the hills a golfer sees are 177 m at 4.4 km NE (bearing 50°),
  175 m at 4.8 km (35°), 167 m at 6.9 km N (342°), 172 m at 7.4 km NW (306°)
  and the 218 m summit at 10.4 km NW (319°). No OSM `natural=peak` node
  names any of them within the extract.
- **Stones**: the rules treat "jordfasta stenar och berg i dagen" on mown
  ground as ground under repair; none is mapped in any source, and the
  laser's residual finds no boulder-scale features inside the fairways.

## 12. Course furniture the rules describe

From the 2026 local rules: **red penalty areas only** since 2022; the
"infinite" ones on 1 (right), 2 (right), 6 (left at the green), 7 (left),
11 (left), 16 (left), 18 (left); **bridges** on 8, 10, 13 and 18, inside
their penalty areas; **drop zones** on 14 (at the pump house) and 15 (in
front of tee 48); **bell posts** (klockstolpe) on the blind holes; **150 m
stakes** (yellow-black) and **distance discs** 200 (white), 150 (yellow),
100 (red) to the green centre — which the app's plates already draw;
**robot mowers** with their own rule; blue-banded young trees as ground
under repair. The engine draws the plates and the greens' flags; the bridges
come from paths crossing streams (the ditch streams now make that possible
where a path is traced), and bell posts, drop zones, stakes and mowers are
not modelled.

## 13. What this pass changed, and what the gates say

- `puttombuild/laser-features.mjs` + `.json`: the laser record (§2.1, §5, §7).
- `reconcile.mjs`: names and lake treatment from the record; laser
  elevations; ditches as streams; the shore slide; the practice bunker.
  `parse-osm.mjs`: the fairway floor 200 m² and golf multipolygons.
- The pack was re-emitted (465,853 bytes, sha 5d95e9df…), the surface
  preview recompiled (6 of 30 tiles changed; descriptor sha 9e06cde5…), and
  the v2 course manifest and root re-bound by the new
  `packages/course-v2/rebind-fallback.mjs` — the ground manifest came out
  byte-identical (03ede20e…) and the routing chunk unchanged.
- The EPSG:3006 migration was regenerated with `migrate-without-proj.mjs`
  (Krüger series vs cs2cs: worst 1.4 mm over 3,564 coordinates; it now
  writes `candidateOrigin`) and re-pinned in `hole-source-controls.mjs`;
  the source manifest's artifact checksums re-recorded.
- Gates: `check3d` all pass; `lint-page` clean; `check-pack` byte-identical
  to the page; `pnpm test` 305 vitest + 294 node tests pass;
  `check-app-build` passes. `tools/check-app.mjs --only=puttom` against the
  built app passes every assertion but one — card through the app, atlas,
  green and bunker probes, all 72 tee markers on tee grass and square to
  the line, 83 plates, nothing submerged, tee row, default tee, headers,
  deep link — and fails "frame is a picture (lum 0.037)". That gate fails
  identically on untouched Ängsö in this container (lum 0.035): the
  session's Chromium renders the WebGPU frame black under software
  rendering, so the picture gate is unmeasured here, not failed by this
  change. `check-course-v2.mjs` does not apply to Puttom (no frontier
  registry entry; the pilot is gated by `check-app-build` and CI's
  `capture-puttom-app-preview.mjs`).

## 14. Open

- The 12th's, 14th's and 15th's forward tees are placed by rule from the
  plans and imagery (medium confidence, ±5 m); a GPS fix on each pad would
  settle them.
- Lill-Rössjön's OSM ring runs 34–46 m past the water at its south tip.
- The pump house, the junior cabin, the bell posts and the drop zones are
  described but not located.
- The plans' cart paths on fourteen holes are not traced.
- The 4th's small pond by the 48 tee (plan 4) is in no source but the plan.
- The card's two disputed index cells (11 and 16) remain the owner's call.
- The Krüger-series migration should be re-run through cs2cs when the pixi
  toolchain is available; the two should differ by under the tolerance the
  file prints.
