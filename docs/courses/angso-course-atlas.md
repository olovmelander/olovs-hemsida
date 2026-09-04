# Ängsö Golfklubb — the complete course atlas

Everything the repository knows about Ängsö GK, feature by feature, with world
coordinates, areas, levels and provenance — measured from the committed data
(`angsobuild/course-model.json`, `sat-shapes.json`, `osm-features.json`,
`heightfields.json`, `tree-cover.json`, `card.json`, `guide-notes.json`, the
v2 contract in `apps/golf/src/engine/v2-angso-config.mjs` and
`geo_data/course-v2/angso/`), not from memory. All coordinates are the pack's
local frame: metres about ORIGIN **59.57390 N, 16.87100 E**, north −z, east +x
(`mPerLat` 111320, `mPerLon` 56375.41). Every number below was recomputed from
the committed JSON on 2026-09-04; `angsobuild/check3d.mjs` passes all gates on
the same data.

## 1. The place, and the two facts the scene must not get wrong

Ängsö Golfklubb sits at **Stora Bodarna**, on a **mainland peninsula in Lake
Mälaren** between Västerås and Enköping. The course is **not on Ängsön**: the
island lies immediately south, across Spånsundet — the island's edge is some
700 m south of the clubhouse, the bridge a little beyond that. And the reserve
next door is **Ängsö naturreservat in Västmanland**, not the Ängsö national
park of the same name, which is an island 100 km east in Roslagen. (Both were
wrong once in the first draft of the page and are called out in its header.)

Mälaren wraps the peninsula on three sides. The played ground is a long, narrow
north–south strip: the hole polylines span **x −421..391, z −1354..781** —
about 2,135 m north–south and 812 m across (the v2 contract measures 2,167 ×
894 m with pads and greens included). Ground under play runs **5.4 to 36.4 m**
above sea level; Mälaren itself is a regulated lake whose real surface is
**0.876 m RH 2000** (laser-flat in the DTM), while the legacy Terrarium
elevation carries the bay at 9.76 m — the ~8.9 m difference is the measured
signature of the pack's vertical datum (§12).

- Course architect: **Åke Hultström**, inaugurated **1985**; the club was
  founded 1979. GolfPass's "Johan Benestam" attribution is wrong — Benestam
  built the **2019 red tees** and the **2021–23 practice area**.
- Par **72** (36 out / 36 in). Par 3s: 3, 9, 12, 15. Par 5s: 5, 7, 10, 18.
- The clubhouse is a Falu-red **courtyard** of three buildings (§8), at about
  (−176, 290); the 18th green finishes on the bench just west of it.

## 2. Where the geometry comes from

Ängsö sits near the satellite end of the repo's provenance spectrum: OSM has
golf mapping for only **4 of 18 holes** (hole ways tagged ref 1–4, with 4
greens, 8 tee pads and 9 bunkers), and the GPS survey covers hole 1 only. So:

| record | covers | used for |
|---|---|---|
| club scorecard 2023 (Scorekort-2023.pdf) | all 18 | all 144+ card values; each drawn line slid to its white-tee length |
| OSM golf ways (ref 1–4) | holes 1–4 | those outlines, with their real hole numbers — they calibrate the banguide registration |
| club banguide (LiveCaddie 649 plates; discs + white route lines) | all 18 | the routing: each disc/flag traced and registered by similarity fit into the world |
| Esri z18 orthoimagery traces (`sat-shapes.json`, traced 2026-08) | 14 holes + everything OSM lacks | greens, fairways, tee pads, bunkers, ponds, centerlines, the driving range |
| AWS Terrarium (z15 core + z12 vista) | everything | the legacy ground and every water level |
| Wayback banguide texts (angsogolf.org 2001–03) | all 18 | the club's own per-hole prose (`guide-notes.json`) |
| Lokala regler 2026 + club news 2023–24 | — | OB/penalty sides, the boar fence, the drop zone, hole-in-one register |

Confidence per hole (from the trace notes): high on 1, 2, 4, 8, 9, 13, 16,
17, 18; medium-high on 7; medium on 3, 5, 6, 10, 11, 12, 14, 15. Every hole's
drawn line measures its card length to **0.03 % worst case** (hole 9), and the
card slide that achieves it moved tee ends by −24.5 to +49.6 m — hole 1's
+49.6 m is the documented lengthening (§3).

The card itself is triple-checked: the per-hole metres reproduce the printed
UT 3112 and totals 6289 (Vit) / 5850 (Gul) exactly, confirmed against
caddee.se and golfisverige.com. **Hole 1 has three white values in
circulation** (355 in the 2020 card and LiveCaddie, 386 on the club's 2023
card, 396 on caddee.se); 386 is used because it is the one that makes the
printed totals add up — the hole was lengthened between the 2020 and 2023
cards, so an old tee pad ~31 m forward of the back tee is expected on the
ground.

## 3. The card

Five tees — Vit, Gul, Blå, Röd, Orange. Totals **6289 / 5850 / 5200 / 4521 /
3597 m**.

| hål | par | hcp | Vit | Gul | Blå | Röd | Ora |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 10 | 386 | 350 | 319 | 270 | 238 |
| 2 | 4 | 6 | 348 | 331 | 282 | 253 | 221 |
| 3 | 3 | 8 | 179 | 171 | 122 | 119 | 92 |
| 4 | 4 | 2 | 337 | 315 | 305 | 236 | 208 |
| 5 | 5 | 18 | 493 | 456 | 400 | 339 | 293 |
| 6 | 4 | 16 | 337 | 317 | 308 | 272 | 201 |
| 7 | 5 | 4 | 545 | 525 | 445 | 384 | 321 |
| 8 | 4 | 14 | 344 | 331 | 285 | 257 | 195 |
| 9 | 3 | 12 | 143 | 122 | 114 | 95 | 55 |
| 10 | 5 | 1 | 527 | 514 | 438 | 386 | 326 |
| 11 | 4 | 17 | 340 | 294 | 284 | 233 | 189 |
| 12 | 3 | 9 | 169 | 160 | 136 | 135 | 65 |
| 13 | 4 | 5 | 426 | 370 | 351 | 305 | 249 |
| 14 | 4 | 11 | 350 | 338 | 292 | 261 | 188 |
| 15 | 3 | 7 | 172 | 145 | 134 | 85 | 63 |
| 16 | 4 | 13 | 338 | 327 | 292 | 269 | 194 |
| 17 | 4 | 3 | 358 | 339 | 308 | 274 | 214 |
| 18 | 5 | 15 | 497 | 445 | 385 | 348 | 285 |

Rating ("Banan värderad 2023-05-03", 8 tee sets, deliberately asymmetric —
men have no Orange rating, women no Vit; the gaps are genuinely unpublished,
recorded null, never cross-filled):

| | Vit | Gul | Blå | Röd | Orange |
|---|---|---|---|---|---|
| Herrar CR/slope | 73.0 / 133 | 70.9 / 128 | 67.7 / 121 | 64.2 / 116 | — |
| Damer CR/slope | — | 77.0 / 130 | 73.0 / 123 | 68.9 / 114 | 63.3 / 101 |

Three independent lineages agree digit for digit (the club's own 2023 PDFs,
slope.no, Hole19's embedded tee JSON). GolfPass alone publishes a uniformly
higher set — the signature of a pre-WHS rating — and is not adopted.

## 4. The eighteen holes

Per-hole record: card row, drawn-line length (all within 0.03 % of the card),
tee/green elevation from the DEM, green centre + area + provenance, fairway
area, bunkers, tee pads, and the club's own words (verbatim Swedish in
`guide-notes.json`; condensed here). "Walk" is green-centre to the next back
tee. Pins sit at green centres. Green areas run 402–723 m² (median 584).

**Hål 1 · par 4 · hcp 10 · "Lätt öppning"** — Tee (−56, 339) at 16.7 m playing
almost due north-down to green (−146, 710) at 10.8 m (−5.9 m). OSM-mapped
(way ref=1). Broad fairway (0.59 ha); a long drive up the left opens the
green, which slopes right-to-left and is guarded by **four bunkers** (69 m² at
(−78, 582) mid-fairway; 73/42/66 m² clustered round the green). 2 traced tee
pads; the +49.6 m card slide records the hole's 2023 lengthening. Walk to
2nd tee: 71 m.

**Hål 2 · par 4 · hcp 6 · "Fint golfhål"** — (−156, 781) → green (186, 751),
12.7 → 6.6 m: the **lowest green on the course and its closest point to
Mälaren**, playing east along the property's south edge, bending left
downhill. OSM-mapped (ref=2). Best angle from the right — but OB right; the
green slopes toward the water behind and left. Two bunkers (55 m² by the
green, 84 m² up the fairway). Pond t1 (1,203 m², level 6.5 m — the lowest
water on the course) sits at (181, 714) just left of the green approach.
Walk: 64 m.

**Hål 3 · par 3 · hcp 8 · "Två klubbor i motvind"** — (173, 688) → (11, 612),
6.7 → 9.1 m, playing WNW back up the hill: the longest par 3 (179 m Vit).
The hill and the copse right cause the trouble; one bunker (38 m²) guards
front-left. **15 hole-in-ones** in the club register. Routing from OSM ref=3;
green is a satellite trace. Walk: 76 m.

**Hål 4 · par 4 · hcp 2 · "Vattnet vid green"** — (34, 539) → green (94, 222),
11.3 → 16.3 m uphill, a dogleg left; fully OSM-mapped (ref=4) and the
best-surveyed hole (4 traced tee pads). Drive right to see the green. **Two
ponds guard left of the green** — the OSM pair w1415933884 (1,051 m², level
16.97) at (70, 275) and w1415933883 (735 m², 16.52) at (71, 223) — with a
93 m² bunker right. The mound between 4 and 5 was dug away in 2023–24 (club
news). Walk: 117 m.

**Hål 5 · par 5 · hcp 18 · "Det röda huset"** — (207, 191) → green (350, 620),
level at 11.7 m both ends, swinging left; index 18 despite its 493 m. The
club's own aiming line is **the little red house on the horizon**; the
black-and-white stakes toward the 6th are OB from here (and immovable
obstructions from the 6th — the 5/6 stake rule in Lokala regler). One 44 m²
bunker at (354, 601) by the green. The approach looks narrower than it is.
Not in OSM; routed from the banguide, traced from satellite. Walk: 60 m.

**Hål 6 · par 4 · hcp 16 · "Dammen i kröken"** — (391, 576) → (320, 297),
12.7 → 10.5 m, a **sharp dogleg right** — the easternmost hole. The long
drive down the right meets **pond t2 in the crook** (957 m², level 8.3 m, at
(318, 389)) and the **boar fence** (vildsvinsstängsel), which is OB; the wise
line is left. Three bunkers guard the green right (151 + 181 + 48 m²). Walk:
44 m.

**Hål 7 · par 5 · hcp 4 · "Banans längsta"** — (323, 253) → green (256, −246),
10.7 → 17.0 m: **545 m, the longest hole**, a dogleg right climbing to the
green. Drive centre/left; OB at the boar fence lurks right. The green is
deeper than it looks. Two bunkers (143 m² at (266, −209) by the green, 82 m²
at (194, 86) mid-hole). Traced pixel-by-pixel from the banguide's white route
line (registration corroborated by the OSM holes). Walk: 189 m.

**Hål 8 · par 4 · hcp 14 · "Rakt fram"** — (120, −377) → (62, −40), flat at
~19 m. Straight is the right line; long hitters can push right to open the
green. **The ditch on the right that the club documents is not in the model**
(kept in the notes; it describes the course, not the render). Two bunkers
left (121 m² in the fairway, 125 m² by the green). Walk: 126 m.

**Hål 9 · par 3 · hcp 12 · "Vinden ovanför träden"** — (−6, 66) → (−46, 204),
flat at 17.7 m, 143 m: well-bunkered (72 + 103 m² short of the green), with
**the brook in front of the green missing from the model** (documented by the
club — the alders beside it were cleared 2023–24). The wind above the trees
is always different — take one more club. **The course's hole-in-one hole: 47
aces since 2004.** The kiosk waits at the 10th. Walk: 109 m.

**Hål 10 · par 5 · hcp 1 · "Index 1"** — (−155, 197) → green (−44, −308),
15.8 → 22.8 m: index 1, climbing north through the forest from beside the
clubhouse/caravan area — **the only hole with no water anywhere near**. Long
hitters reach the green edge in two via the left; the mound right of the
green bounces balls away. One 141 m² bunker at (−67, −295). Walk: 69 m.

**Hål 11 · par 4 · hcp 17 · "Sex bunkrar"** — (22, −330) → (92, −653),
21.8 → 18.8 m, a gentle dogleg right with **six bunkers, the most on the
course** (30/39/23/27/22/25 m², strung from (35, −590) to (92, −615) across
the elbow and green approach). Tempting to cut over the rough right; safest
left of the first bunker. Then **the longest walk on the course — 287 m to
the 12th tee**, north past the property's high ground. 

**Hål 12 · par 3 · hcp 9 · "En klubba längre"** — (−70, −890) → (−199, −1000),
24.9 → 26.8 m, playing NW in the far north. The green is half-hidden by the
hill left — the distance deceives, take one club more. One 72 m² bunker
front-left. **The brook crossing the hole is missing from the model** (club
documents it). 23 hole-in-ones. Walk: 74 m.

**Hål 13 · par 4 · hcp 5 · "Längsta par 4"** — (−125, −1007) → (−371, −1354),
flat at ~28 m: 426 m dead straight NNW to **the northernmost green on the
property**, forest tight left, the brook right (also unmodelled). Drive left
for the best angle into a green bunkered both sides (94 + 52 m²). Walk:
108 m.

**Hål 14 · par 4 · hcp 11 · "Vänstra greenhalvan"** — (−421, −1258) →
(−242, −1028), 25.6 → 27.8 m: a **dogleg left round the wood** — the line runs
SSE down the western corridor (bearing 167°) for ~215 m, then swings east
(96°) along a 20–25 m approach. (The trace's own prose says "dogleg right",
but the heading change is −71° = left; that is the chord-side inversion
CLAUDE.md warns about, and the club's "vänster" agrees with the geometry.)
Stay right off the tee to see the green; aim at the left half — the right is
narrow, hidden by the hill, with a 124 m² bunker front-right. Walk: 57 m.

**Hål 15 · par 3 · hcp 7 · "Över vattnet"** — (−228, −973) → (−384, −902),
24.3 → 27.7 m: **the water hole and the signature framing** — pond t3
(1,318 m², level 22.6 m) fills the ground between tee and green at
(−345, −900). Club, wind, carry. One 47 m² bunker right of the green — and
**the course's only drop zone** if it goes wrong (Lokala regler). White-stake
OB shared with 16 along the boundary. 21 hole-in-ones. Walk: 67 m.

**Hål 16 · par 4 · hcp 13 · "Rakt fram från tee"** — (−416, −843) →
(−161, −704), 31.5 → 25.7 m: from **the highest tee on the course** the hole
runs due east then swings hard right (south) downhill. OB (white stakes) left
of tee and fairway, the boar fence right; straight is the wise line — right
finds trees. Bunkers before the green (64 + 86 m²) are harmless with enough
club. The only hole traced with two fairway rings (the elbow). Walk: 98 m.

**Hål 17 · par 4 · hcp 3 · "Vatten hela vänstersidan"** — (−254, −674) →
(−269, −322), 24.4 → 26.5 m, straight south down a long tree-walled corridor:
**an "endless" red penalty area runs the whole left side** (Lokala regler),
forest right. Keep the drive right. The green is hard to hit, sloping
right-to-left and away — take one club less and let it run up. Ponds t6
(190 m², 24.8 m) by the tee end, t4/t5 (296 + 169 m², 25.5/27.0 m) at
(−253, −343)/(−264, −368) by the green; one 58 m² bunker at (−264, −302).
The club cleared the right side in 2023–24. Walk: 215 m south to the 18th
tee.

**Hål 18 · par 5 · hcp 15 · "Över enen"** — (−382, −138) → green (−294, 340),
28.9 → 19.3 m: an easy closing hole falling 9.6 m — **the biggest drop on the
course** — bending right to finish just west of the clubhouse and car park.
**Two ponds sit mid-fairway at second-shot length**: t7 (238 m², 17.5 m) at
(−296, 115) and t8 (233 m², 15.9 m) at (−284, 147). Going for it in two means
carrying **the juniper (enen)**; the back half of the green slopes away. One
146 m² OSM-surveyed bunker at (−318, 167) beside the ponds. Walk back to the
1st tee: 238 m past the clubhouse.

Walks overall: median 98 m, longest 287 m (11→12), then 238 m (18→1) and
215 m (17→18); shortest 44 m (6→7).

## 5. Water — every body, level by level

Mälaren aside, **14 closed water bodies and 3 waterways** are in the model.
Each pond carries its own measured level read off the terrain around it, so
they render as pools, not craters (levels 6.5 to 42.2 m across the model).
Six rings are OSM-surveyed, eight (t1–t8) are satellite traces made per hole.

| id | where | area | level | serves |
|---|---|---|---|---|
| w307899187 | the Mälaren bay west/north of the peninsula (ring spans z −77 to −11,645) | 32 ha (partial ring) | 9.76 (Terrarium; really 0.876 RH 2000) | the lake itself; `isLake` |
| w1508749365 | (−2082, −791), 2.2 km NW | 4.9 ha | 21.67 | off-course lake |
| w519749977 | (−2282, −2511), 3.4 km NW | 1.2 ha | 42.24 | off-course lake (highest water in the model) |
| w1511512726 | (−1928, −1983), 2.8 km NW | 1.0 ha | 32.67 | off-course lake |
| w1415933884 | (70, 275) | 1,051 m² | 16.97 | hole 4, left-of-green pond (OSM) |
| w1415933883 | (71, 223) | 735 m² | 16.52 | hole 4, left-of-green pond (OSM) |
| t1 | (181, 714) | 1,203 m² | 6.50 | holes 2/3 — the lowest pond |
| t2 | (318, 389) | 957 m² | 8.30 | hole 6 — "dammen i kröken" |
| t3 | (−345, −900) | 1,318 m² | 22.60 | hole 15 — the carry pond, largest on the course |
| t4 | (−253, −343) | 296 m² | 25.50 | hole 17, by the green |
| t5 | (−264, −368) | 169 m² | 27.00 | hole 17, by the green |
| t6 | (−261, −643) | 190 m² | 24.80 | holes 16/17, by 17's tee |
| t7 | (−296, 115) | 238 m² | 17.50 | hole 18, mid-fairway |
| t8 | (−284, 147) | 233 m² | 15.90 | hole 18, mid-fairway |

The three waterways are all off-course: a 446 m ditch running SE from
(122, 1339) toward the shore, and two long farm ditches east of the course
(1.46 km from (1906, −496) to (1107, 123); 795 m from (620, −196) to
(1067, 147)).

**Model `seaLevel` is 6** — with no `isSea` ring, reconcile derives the
"nothing below water" floor as the lowest pond level minus 0.5 m (t1's 6.5).
The heightfield stage, which sees only OSM's water, records 8.76. The page
lays its Mälaren sheet at 6 m; where the DEM dips below it around the shore,
the lake reads through.

**Three watercourses the club documents are deliberately absent** from the
model (no imagery or OSM evidence to trace): the brook in front of the 9th
green, the ditch right of the 8th, and the brook crossing the 12th (the 13th's
"bäcken till höger" is the same north-course system). They are kept in the
hole notes because they describe the course, not the render.

## 6. Sand, greens, fairways — the playing surfaces in sum

- **Greens**: 18, total 10,138 m² (1.01 ha), 402–723 m² apiece, median 584.
  Three are OSM-surveyed (holes 1, 2, 4 — OSM has a fourth green ring the
  reconcile never matched to a hole), fifteen are satellite traces; every
  surveyed centre sits inside its traced ring (check3d gate, 0 outside).
- **Fairways**: 18 traced sets, 15.1 ha in total, from 0.13 ha (the 15th's
  water carry) to 2.01 ha (the 10th). Hole 16 alone carries two rings (its
  elbow).
- **Bunkers**: **34**, totalling 2,638 m² — 9 from OSM (holes 1–4 and the
  18th's big 146 m²), 25 traced from z18 imagery. Largest 181 m² (hole 6),
  smallest 22 m² (hole 11's cluster). Distribution: H1 ×4, H2 ×2, H3 ×1,
  H4 ×1, H5 ×1, H6 ×3, H7 ×2, H8 ×2, H9 ×2, H10 ×1, H11 ×6, H12 ×1, H13 ×2,
  H14 ×1, H15 ×1, H16 ×2, H17 ×1, H18 ×1.
- **Tee grounds**: 46 traced/mapped pads (2–4 per hole; 8 of them
  OSM-surveyed on holes 1–4), and **90 tee marks** (5 colours × 18) placed by
  the card slide along each hole's own axis. Marks a mapped pad does not
  cover get the app's inferred 10.4 × 8.8 m deck squared to the hole's
  bearing, so every marker stands on tee grass (the all-courses `check-app`
  gate). Back-tee slides land within 0.1–49.6 m of a traced pad
  (`teePadDist`); the two largest — hole 1's 49.6 m and hole 5's 15.3 m — are
  the documented lengthening and a banguide-routed hole respectively.

## 7. The practice ground

- **Driving range**: a 3.8 ha traced ring centred (−229, 498), immediately
  south of the clubhouse. **OSM maps no golf=driving_range at Ängsö — this
  trace (52 points, off z18 imagery) is the only record of it**
  (`sat-shapes.json` scenery note). The page plants its target flags in it;
  the range tee end is derived as the ring vertex nearest the clubhouse
  stepped 12 % toward the centroid (the "walk from the clubhouse" rule that
  replaced the copied `hut` literal).
- The **practice area is 2021–23 Benestam work**, and the club's putting
  green/practice features beyond the range ring are not separately modelled
  (`scenery.greens` is empty — a known gap, not a claim the club has none).
- The OSM `leisure=golf_course` polygon here covers only **4.0 ha and does
  not contain ORIGIN** — a partial mapping (compare Johannesberg, where the
  boundary bounds the whole property). The course hull therefore comes from
  the played geometry, not from OSM.

## 8. The clubhouse, and every other building

**The clubhouse is not one building but a courtyard** — OSM carries three
footprints all named "Ängsö GK Klubbhus": **546 m²** at (−176, 290), 165 m² at
(−150, 296) and 123 m² at (−173, 313). The club's photograph shows exactly
that: a yard of red timber ranges with the golf trolleys parked in the middle.
The engine draws the largest as the clubhouse — Falu-red panel walls
(0x8b3a2c), white window frames and corner boards, **terracotta pantile roof**
(0xc0552c, the bright orange of a Mälardalen farm, deliberately not the dark
roof of the northern clubs), a storey and a half (5.0 m) with dormers, window
rows at 1.4/3.6 m, a white-railed balcony and terrace — while the other two
come through the generic pass as the outbuildings they are
(`apps/golf/src/engine/scenery/angso.js`).

142 buildings sit in the near model, 39 more as far oriented boxes (`farB`).
The named/typed ones:

- **Västerås Camping Ängsö** — restaurant building, 441 m² at (−663, 650),
  the heart of the campsite on the south-west shore; around it the model has
  its **three piers** ((−589..−615, 782..807), (−918..−887, 886..945),
  (−994, 935..967)), **two sand beaches** (w234712892 at (−900, 870),
  w715529792 at (−407, 850)) and the caravan ground the hole-10 note
  mentions.
- **Grindtorp** — a 109 m² house at (−579, 559) with garage and outbuilding,
  between the camping and the course.
- A farmstead cluster at (−650..−780, 1700..1780): four farm buildings
  (up to 1,603 m²), houses, and a barn at (−781, 391) with house beside it.
- Summer-house rows at (1386..1541, 1507..1660) on the eastern shore, houses
  at (908..948, 934..966), and six residential buildings 1.7 km west across
  the bay at (−1679..−1755, −826..−1459).
- Kinds across the 142: 110 untyped, 20 house, 6 residential, 4 farm, 1 barn,
  1 garage.

**Parking**: two OSM lots, both at the campsite end — 744 m² at (−332, 1266)
and 543 m² at (−230, 970). The club's own car park by the clubhouse has no
OSM polygon; the 18th-green "bench west of the clubhouse and car park" in the
hole notes records where it is.

## 9. Roads, tracks and paths

- **16 road ways**: a tertiary chain (the access road from the north down the
  peninsula, 13 ways — the largest 66 points) and 3 unclassified ways serving
  the camping and farms. No road on the model carries a name; none is lit.
- **44 tracks totalling 9.5 km** — the farm and forest track net, including
  what serves as cart-path routing around the course.
- **7 paths totalling 3.9 km**.
- No railway, no power corridors (`power.lines/towers/poles` all empty) —
  the quietest infrastructure model of the six courses.

## 10. Forest, vegetation and ground cover

- **Forest**: 28 polygons; the 16 near the course total **117.3 ha**, the
  largest being 37.3 ha east at (681, 1400), 29.4 ha at (569, −950) east of
  the northern holes, 24.2 ha at (−1027, 542) across the western bay, and the
  5.5 ha stand at (−27, −259) that holes 10/11 thread through. Hole 13 has
  "skogen tätt till vänster"; hole 17 a full tree wall right.
- **Wood** (smaller OSM wood): 3 polys, 7.5 ha, mostly the 7.15 ha at
  (−29, 1712) south by the farmland.
- **Scrub**: 13 polys, 8.7 ha, nearly all along the eastern shore strip
  (821..1464 east) plus small patches at (327, −1004) and (450, −1080) near
  the north holes.
- **Wetland**: 8 polys, 65.6 ha — big reed/marsh fields on the east shore
  (23.9 + 19.9 + 9.6 ha), the 2.7 ha at (−3, 1132) south of the course,
  three small patches along the camping shore, and an 8.5 ha marsh across
  the west bay at (−1318, 707).
- **Rock**: 5 polys — one real 1.7 ha bluff at (−1398, 2517) on Ängsön's
  shore; four tiny distant skerries (the reserve islands' outcrops).
- **Tree-cover raster** (`tree-cover.json`): Esri z17 imagery classified at
  3 m cells over x/z −1200..1203 — 801 × 801 cells, legend {0 unknown, 2
  open, 3 trees}, **39.2 % canopy** (251,610 of 641,601 cells ≈ 226 ha within
  the box). Self-calibrated: turf from the model's own rings, water masked by
  its rings, canopy thresholds from the dark+textured remainder. The planter
  obeys it in both directions (satellite canopy plants; satellite open ground
  thins the OSM polygons).
- Landuse rings that tint the surroundings: **15 farmland** (largest 201 ha
  east at (952, −1100) and 34.2 ha at (290, −1306) — the open field world the
  northern holes look out on), **8 farmyard**, **12 residential**.

## 11. Reserves, shores and the wider landscape

- **Sundängens naturreservat** — centred (−1151, 356), directly across the
  western bay from the course; the one reserve polygon in the near world.
- Four more reserve polygons far out in Mälaren: **Amundsgrund**
  (−17,376, −2,030), **Kattskär** (−18,481, −1,281), **Västra Holmen**
  (−17,357, −635) — the archipelago 17 km west — and **Veckholms prästholme**
  30 km ESE.
- The vista heightfield (32 m grid, 20.4 × 19.0 km about the origin) carries
  the whole Mälaren basin; decoded it spans −284.9..287.5 m, but **both
  extremes sit in open water** ((−3616, 1856) and (−5984, 4992)) — Terrarium
  noise over the lake, not land. The near field (4 m grid, 3.0 × 3.3 km,
  x −1500..1500, z −1600..1712) spans −52.5..48.1 m with the same caveat
  (its −52.5 sits at (−372, 944), off the south shore); the played window is
  5.4..36.4 m.
- Ängsön itself, with Ängsö slott and its church, lies south across
  Spånsundet; the island edge enters the near field's southern rows and the
  vista carries the rest.

## 12. Marking and local rules, as modelled and as published

From Lokala regler 2026 (captured in `guide-notes.json`'s source):

- **The boar fence (vildsvinsstängslet) is OB right of 6, 7, 16 and 17** —
  the one hazard that shapes four holes at once.
- **The 5/6 stakes are OB from 5 and immovable obstructions from 6.**
- **White-stake OB is shared by 15 and 16** along the west boundary.
- **The drop zone on 15** is the course's only one.
- **The red penalty area left of 17 is "endless"** — it runs the hole's whole
  length.
- Hole-in-one register: 47 aces on 9, 23 on 12, 21 on 15, 15 on 3 — a nice
  independent corroboration that the four par 3s are where the model says.

## 13. Ängsö on 1 m terrain — the v2 ground

Ängsö is the **fourth real v2 configuration and the one that cost the
frontier its square** (`v2-angso-config.mjs`): the course is 2,167 m long, so
level zero is **sixteen tiles per side (256 tiles over a 4,096 m window)**,
four times Veckefjärden's. The reviewed frontier preloads an 8 × 12 sub-
rectangle (96 tiles, 6.45 MB, 76.9 % of the 8 MiB budget — columns 4–11, rows
2–13), keeping 577 m of metre ground east/west of the played geometry and
452 m north/south — the Mälaren shore, the reserve edge and the near scenery.
The published **ring graph is 7 levels, 469 tiles to a 16,384 m root** (256 /
64 / 64 / 64 / 16 / 4 / 1), every tile but the root carrying its parent link;
level 1 spans the same 4,096 m as level 0 at 2 m. Served by the streaming
ring adapter: one draw call, no legacy CORE (its cutout is **null by
decision** — nothing to cut when the graph covers the horizon).

- Canonical origin E 605665.5 / N 6605721.5 (0.4 m from the played centroid);
  the legacy origin projects to E 605689.962 / N 6605447.157.
- Bridge: `wgs84-legacy-frame` — meridian convergence (~1.61° at Ängsö), the
  frame's own metre, and the **measured vertical datum step 9.1166 m**
  (median over 41,636 mown samples, MAD 1.8463 m). The MAD is eight times
  Veckefjärden's because Terrarium genuinely disagrees with the laser about
  the *shape* of this low-relief shore — the strongest argument for the laser
  ground. One independent corroboration: Mälaren's DTM-flat 0.876 m against
  the pack's 9.76 m ring differs by 8.884 m, 0.23 m from the mown median.
- **Surfaces stay legacy** (`surfacePolicy: 'legacy-ground-atlas'`): with 14
  holes on satellite traces and no survey, no v2 surface layer is claimed.
- The horizontal migration is seeded but **not control-approved**
  (`residual-report.json`: status blocked-pending-independent-control,
  0 anchors promoted).

**LiDAR vegetation is in flight, not published.** The pinned campaign
inventory (`laser-campaigns.json`, 2026-09-04) holds **one campaign, 21c036
(item 660_60): flown 2021-03-08..04-01 — March, leaf-off** (the Johannesberg
caveat applies to this parkland's deciduous crowns), 3,000 m flight height,
1.2 declared pulses/m², 224 M points, covering the whole AOI exclusively —
zero seams. The COPC hierarchy census is complete (33 windows, no point bytes
read) and the state is **canopy-rasters-built** (`canopy-evidence.json`,
ground from the cloud's own class 2/9 returns, 32 m halo). What remains is
the crown census, machine review, exclusion masks and publish — the
Veckefjärden/Upsala chain.

## 14. In the app

Manifest entry: slug `angso`, "Ängsö GK / Ängsö Golfklubb", boot line
"Stora Bodarna · Mälaren", pack 337,981 bytes (sha-pinned), **default tee
Gul (index 1)** by the yellow-swatch rule, tee colours
Vit/Gul/Blå/Röd/Ora, `hideFrom: 5`. **Four hero posters** (`hero-1..4.webp`);
the 15th — the water hole with the only drop zone — is the recorded signature
hole, and the card kept its original poster after re-renders lost to it.
The Phase-0 parity record was made on this course: the pack renders
pixel-identical to the embedded page (12 views, mean 0.0000/255), and
`apps/golf/public/courses/angso/` carries the pack, the v2 ground manifest and
the routing chunks.

## 15. Known gaps — stated, not papered over

1. **Three club-documented watercourses are unmodelled**: the 9th's brook,
   the 8th's ditch, the 12th/13th brook. Highest-value fidelity items on the
   course proper; each needs imagery or survey evidence to trace, not a
   guess.
2. **No Mälaren ring in the near model** — the lake is a partial OSM ring
   north-west plus the page's 6 m sheet; the south shore by the camping has
   beaches and piers but no water polygon, and `coast.chains` is empty. The
   v2 laser ground reads the real 0.876 m surface and will eventually
   supersede this.
3. **The old tee pad ~31 m forward on hole 1** implied by the 2020 card is
   expected on the ground but not traced.
4. **`scenery.greens` is empty** — the practice putting greens are not
   modelled (the range is).
5. **The OSM golf_course polygon is partial** (4 ha, excludes ORIGIN) — no
   authoritative property hull exists here.
6. **Bunker orientation/shape beyond the trace** is only as good as z18
   imagery; and the trace notes' prose is not always as reliable as the
   geometry (hole 14's note says "dogleg right" where the line and the club
   both say left — the chord-side inversion documented in CLAUDE.md).
7. **v2 vegetation unpublished**; leaf-off 2021 scan will under-detect
   deciduous crowns when it lands — audit against the satellite raster the
   way Johannesberg was.
8. **The card has a wired-in expiry**: hole 1's three circulating lengths
   mean third-party sites still serve 355/396; the model asserts the club's
   2023 card only.
