# Norrfällsvikens Golfklubb — source dossier

> Status: intake record and v2 implementation dossier, first edition, 2026-09-04.
>
> This file records the public evidence found for Norrfällsvikens GK and what
> may safely be concluded from it. It is not an assertion that every linked
> asset may be redistributed, nor that secondary coordinates are surveyed. The
> reusable production workflow is in
> [Course v2 production guide](../v2-course-runbook.md).

Labels are the ones the other dossiers use: **Official** (club, SGF, a
municipality or another responsible public body), **Secondary** (an independent
directory), **Observation** (visible in a cited image), **Inference** (a
conclusion from comparing sources, to be validated before it becomes truth),
**Measured** (computed here, with the method stated).

## 1. Identity

| Field | Value | Evidence |
|---|---|---|
| Public name | Norrfällsvikens Golfklubb (NVGK) | nvgk.se |
| Address | Storsandsvägen 30, 873 97 Mjällom | Official |
| Holes / par | 18 / 73 | Official card |
| Setting | The outer tip of Mjällomshalvön, Kramfors kommun, inside the High Coast world heritage area | Länsstyrelsen; the club's own headline |
| Frame origin | 62.98250 N, 18.53250 E → EPSG:3006 E 678970.625, N 6988556.634 | `nvgkbuild/lib.mjs`; reproduced by PROJ cs2cs and the repo's own Krüger series to under 1 mm |

**The repo's ORIGIN is essentially OSM's own course centre.** Relation 165517
(`leisure=golf_course`, "Norrfällsviken GK") has its centre at 62.982488,
18.532538 — 1.3 m / 1.9 m from the frozen ORIGIN. That is a coincidence worth
knowing about, not a dependency.

## 2. The card — verified unchanged

The current scorecard is still the scan uploaded 2025-07-01
(`nvgk.se/storage/2025/07/IMG_20250701_0001_page-0001.jpg`, linked from
`nvgk.se/scorekort/`). Three tees: **Gul / Röd / Orange**.

**All 144 values in `nvgkbuild/card.json` match it cell for cell**, including
the stroke index and the tee names. Printed totals: UT 2794/2429/2019 par 36;
IN 2837/2501/1998 par 37; TOT 5631/4930/4017 par 73. Every column sums to its
printed total and the index is a valid 1–18 permutation with evens out and odds
in. No card edit is needed.

Course rating and slope, from the club's own SGF sheets ("Banan värderad
2018-07-23", par 73):

| | Gul | Blå | Röd | Orange |
|---|---|---|---|---|
| Herrar CR / slope | 72.5 / 128 | 70.5 / 123 | 68.9 / 121 | — |
| Damer CR / slope | 78.9 / 134 | 76.5 / 129 | 74.6 / 125 | 68.7 / 112 |

**A Blå tee is rated but is not printed on the 2025 card.** Do not add a fourth
column from the rating sheet alone.

## 3. The 4/8 renumbering — now confirmed by the club, and dated

CLAUDE.md has long recorded that the GPS survey and the third-party datasets
number the par-5 west corridor "8" and the par-4 east corridor "4", while the
club's card is the other way round. That is now **confirmed by a club-published
design document**, which also dates it.

The "Projekt Bättre Spelupplevelse" poster
(`nvgk.se/wp-content/uploads/2026/07/NvGK_Projektet_bild.png`, published
2026-07-09) contains a conceptual tee plan by **Johan Benestam, Benestam Golf
Course Design** — "Norrfällsvikens Golfklubb, Mjällom, Sweden — Konceptuell Tee
Plan, PAR 72, HÅL 1 - 18, Utkast 2", dated **2025-03-10**, 1:4000 @ A3. Both the
hole-4 and hole-8 rows of its existing/proposed table carry the comment:

> "Ny röd & orange tee, hål 8 & 4 skiftar nummer, fel längde idag på hål 8 gul
> tee se notering längre ned"

In the EXISTING columns hole 4 = 366 m par 4 and hole 8 = 428 m par 5; in the
PROPOSED columns they are swapped. The club's July-2025 card already shows the
swapped assignment. The plan's map, drawn with the new numbering, puts hole 4 on
the **western** corridor and hole 8 on the **eastern** one, converging on the
same green complex — which is exactly the swap `nvgkbuild/reconcile.mjs` asserts
by centreline length rather than assuming.

**The designer says the club's own printed length is wrong.** The plan measures
the par-5 Gul at 428 m where the card prints 440 m, and both rows note "fel
längde idag på hål 8 gul tee". That 12 m is precisely the amount by which the
plan's existing OUT total (2782) falls short of the card's printed OUT (2794);
every other existing value matches, and the IN totals are equal. This repo keeps
the club's card, because the card is what the club publishes — but the
discrepancy is now sourced rather than unknown.

## 4. Holes 4 and 8 share one green — the model does not

The club's 2026 local rules (`Lokala-Regler-NvGK-2026.pdf`, 2026-07-21) state:

> "Hål 4 & 8 delar en gemensam green på vilken det finns vattenspridare
> installerade i mitten av greenytan."

This resolves an old note. CLAUDE.md records that the GPS survey's "4" and "8"
"share one green to 1.5 m" and treats it as a survey defect. **It is not a
defect — it is the real course.**

`nvgkbuild/course-model.json` currently carries **two separate greens**, traced
from satellite (`prov: "sat"`), 37.3 m apart, of 344 m² and 224 m². That is very
likely one green complex read as two lobes. **This is the highest-value open
fidelity item on this course** and is not fixed here, because merging them
needs a re-trace against imagery rather than a guess at an outline.

Other hole-specific facts from the same local rules, all Official:

- only **red** penalty areas exist on the course today;
- hole 6's red penalty area is **left, "mot havet"**, and the footpath left of
  the fairway is the course boundary — spelförbud on the path and everything
  below it toward the sea;
- hole 17 has a red penalty area left of the fairway and behind the green, with
  its own **drop zone**;
- internal OB between 8 and 4, and between 18 and 9, in force only when playing
  4 resp. 18; internal OB from the tee on hole 15;
- the constructed path between 1 and 9 is an integral part of the course;
- rocks fast in the ground and bedrock outcrops on closely mown areas are GUR,
  and anthills are no-play zones.

## 5. There is still no club hole guide

`nvgk.se` carries no banguide. The homepage's "Vår Bana" block ends in a button
reading **"Se banan (Kommer Snart)"** whose anchor has an empty `href` — a dead
placeholder. The site is 30 pages and 12 posts; `/banguide/`, `/banan/`,
`/halguide/`, `/bankarta/` and the rest all 404, and `/scorekort/banan/`
("Golfbanan") is an empty Divi container that has been empty for the whole
~11 months the Internet Archive has crawled it. `/hal-1/` and `/hal-17/` return
200 but are WordPress **attachment** permalinks for two photos.

No external hole-guide provider is linked anywhere: "banguide", "hålguide",
"livecaddie", "caddee", "golfisverige", "hole19" all score zero across the 41
pages. Unlike Puttom (LiveCaddie 658) and Veckefjärden (LiveCaddie 379), there
is nothing to harvest.

**So `nvgkbuild/guide-notes.json` must keep sourcing its per-hole text from the
Wayback capture of the old `norrfallsvikensgk.com`, and its note saying so is
current rather than stale.**

## 6. "Projekt Bättre Spelupplevelse" — the course is about to change

Announced 2026-07-09 as "den största uppdateringen av vår bana sedan den
byggdes", with a preliminary start of **September 2026**. Published scope: four
tees on every hole (55, 48, 44, 40), better transport routes between holes, a
new accessible toilet, and an upgraded, part-asphalted range. Funded by
Allmänna Arvsfonden (2 806 400 kr) with Kramfors Kommun (550 000) and the club
(151 600).

Per the Benestam plan, the consequences for the card would be:

- tee naming becomes **Gul/55, Blå/48, Röd/44, Orange/40** — today's Röd becomes
  Blå and a new Röd is inserted;
- **hole 10 goes from par 5 to par 4** (480 → 325 m off Gul), taking par 73 → 72;
- totals 5619/4930/4930/4014 → 5464/4769/4434/4040.

**Nothing in this repo should be changed for it yet.** It is a proposal with a
start date, not a played course. But a card verified today has a known
expiry, and that is worth recording before someone re-verifies in a year and
concludes the repo is wrong.

## 7. Geodata

### 7.1 OSM — still no golf, but there IS a boundary the build ignores

A live fetch of the committed bbox returns 4,606 nodes / 463 ways / 16
relations, and the only golf-tagged elements remain the clubhouse building and
**relation 165517**, `leisure=golf_course`, "Norrfällsviken GK", last edited
2017-04-21. Feature counts are otherwise unchanged from the committed extract
(buildings 274, piers 7, basins 4, coastline ways 4, reserves 4, beaches 3).

**`nvgkbuild/parse-osm.mjs` tests `t.leisure === 'golf_course'` on WAYS only and
never inspects relations**, so `osm-features.json` carries
`"courseBoundary": null` although OSM has one. Projected to EPSG:3006 the ring
spans E 678570.972–679390.210, N 6987902.521–6989205.221 and contains the
model's played bbox on all four sides to within a metre or two — an independent
corroboration of the course window that has been sitting unused. CLAUDE.md's own
rule that "`leisure=golf_course` is the best hull there is" applies here and is
not being followed. Open item.

### 7.2 The GPS survey

`geo_data/norrfallsviken_clean.json` is exactly 90 Point features, five per hole
for all 18, with no elevation. Extent E 678580.158–679347.176, N
6987930.655–6989202.197 (767.0 × 1271.5 m).

### 7.3 Terrain — acquired, and what its provenance really says

Four `dtm-cog` items cover the AOI, but **the whole played course lies inside a
single one, 698_67**, whose `ursprung.json` records ONE flight over the entire
10 km square: **2025-06-05, Luftburen laserskanning**. Every played sample is
one campaign.

**The STAC metadata hides a real vintage boundary.** Both 698_67 and 698_68
advertise `capturedAt` 2018-12-20 over a 2012–2025 range, which reads as one
campaign. The per-item `ursprung.json` says otherwise: 698_68 carries a
**2012-07-05** rectangle at exactly E 680000–682500 / N 6987500–6990000. The
acquired window clips it.

Measured in the retained raster rather than assumed:

| where | mean column step | max |
|---|---|---|
| across the 2012/2025 boundary, water rows (94%) | 0.0881 m | 0.311 m |
| across it, land rows (6%) | 0.2980 m | 0.514 m |
| ordinary 2025 terrain at E 678000 | 0.1095 m | 2.182 m |

The boundary stands **643.9 m east of the easternmost played point**, out past
the shoreline, and on land it steps less than ordinary terrain roughness does.
It is recorded because it is real, not because it is visible. **Never take a
STAC `capturedAt` for a campaign.**

Other layers: `dsm-skoglig-copc` has 3 items, all 2025-06-05, `avg_pt_spacing`
0.5362 m against a STAC `pointDensityPerSquareMetre` of 1.9 — the three-numbers
trap CLAUDE.md warns about. The newest orthophoto is `orto-u2-2024` at 0.16 m
RGBI, covering 0.909 of the AOI; completeness needs 2012 fallback. The
discovery's 2.21% newest-LiDAR gap is a single 532 × 804 m rectangle at
E 680000–680532 / N 6990000–6990804 — **open sea, north-east of the cape, and
irrelevant to this course.**

Lantmäteriet's `/pub/` metadata is open; `/data/` assets stay credentialed (401
without auth). Access was verified working on 2026-09-04, so CLAUDE.md's note
about a 401 on 2026-09-02 is stale.

## 8. Setting and landmarks

- **Norrfällsvikens kapell** — OSM way 185982798, a 9.04 × 7.81 m rectangle at
  62.972070 N, 18.521602 E, long axis at bearing 88.3°. In the repo's frame:
  local (−551, 1159), 1.28 km at bearing 205.4°. Riksantikvarieämbetet records
  byggnad 21400000448215, "Nybyggnad – Kyrkan i sin helhet", **1649**; Kramfors
  kommun's kulturmiljöplan says **1646**. The build year is genuinely disputed;
  the repo says 1649 with the majority of sources.
  **Appearance (Official + Observation):** "byggnad med sadeltak målad i vitt med
  en fristående klockstapel", standing in an open position on the height above
  the water. The roof is an **orange-red pantile**, measured rgb(177,90,48)
  against walls at rgb(225,225,225). Built by Gävle fishermen; one of four
  fiskekapell in Nordingrå (Barsta 1665, Fjällsvik, Norrfällsviken, Bönhamn
  1659) — **they are easy to confuse, and a travel blog's white chapel with a
  grey shingle roof and a red tripod bell frame is Bönhamn, not this one.**
- **The fiskeläge** — over 350 years old, riksintresse Y 29. "Byggnaderna har
  locklistpanel målat i rött med vita snickerier. Spröjsade fönster och
  sadeltak." Marina node 1855273511 at 62.974746, 18.521995; five fixed piers
  and one floating.
- **Reserves** — four within ~3 km. Only two touch the course: **Storsands**
  (44 m from hole 12's centreline, 71 m from hole 13's) — "sanddyner med gles
  tallskog", sand dunes under sparse pine — and **Norrfällsvikens**. Both are
  marked "Naturreservat, Världsarv". Reserve vegetation in Länsstyrelsen's own
  words: "På hällmarkerna växer knotiga tallar och marken täcks av lavar,
  mossor, ljung och bärris" — gnarled pine on rock, lichen, moss, heather and
  bilberry. **This corroborates the pine-led planter.**
- **Klapperstensfält** — the boulder fields are a defining feature and the club
  names them: "Hin Håles Åkrar". The bedrock is **Nordingrågranit**, "en
  kraftigt röd, grovkristallig granit av rapakivityp", ~1 550 million years old.
- **Land uplift** — 8–9 mm/yr depending on the source; the boulder fields are
  still emerging from the sea.
- **The horizon, tested rather than assumed.** A terrain-only line-of-sight test
  from all 18 tees, all 18 greens and the origin (37 points, 1.7 m eye height,
  refraction k=0.13) finds **Södra Ulvön visible from about 15 of the 37
  points** over open water — and Ulvön is the view the club itself names.
  **Högbonden is NOT visible from a single one of the 37 points**, and it also
  sits 2.4 km beyond the south edge of the committed vista heightfield, so no
  terrain for it is loaded at all. Mjältön (Sweden's highest island, OSM node
  1283889058, surveyed 236 m) is visible; the committed vista field reads
  249.2 m for it because Terrarium z12 at ~38 m/px smears the summit.
- **Sea level** — the nearest SMHI gauge (Skagsudde 2, ~30 km NNE) gives, over
  147,463 hours in RH 2000, mean +5.3 cm, median +4.8 cm, p05 −27.9 cm.
  **There are no tides in the Bothnian Sea**; the Baltic oscillates instead.
  Treating the sea as 0 RH 2000 is right to within a few centimetres.

## 9. Facilities

Driving range (open around the clock in season, clubs to borrow), putting green,
övningsområde with närspel, an övningsbunker, Café 19:e Hålet with a golf shop,
a conference room, and cart hire at 450 kr/round. **No korthålsbana or par-3
course exists** — do not infer one.

## 10. Open items, worst first

1. **Holes 4 and 8 share one green in reality and two in the model.** Needs a
   re-trace of the shared complex against z18 imagery (§4).
2. **The OSM `leisure=golf_course` relation is not read**, because
   `parse-osm.mjs` inspects ways only (§7.1). It is a free, independent hull.
3. **The card has a known expiry**: Projekt Bättre Spelupplevelse would take the
   course to par 72 with four tees (§6).
4. The club's printed 440 m for the par-5 Gul is disputed by its own designer at
   428 m (§3).
5. A rated **Blå** tee exists but is unpublished on the card (§2).
6. Zone-A survey, the canonical origin and the Esri/GolfTraxx imagery rights
   remain the manifest's standing release blockers.
