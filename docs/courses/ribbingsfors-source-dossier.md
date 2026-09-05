# Ribbingsfors Golf & Kultur — source dossier

> Status: acquisition and implementation dossier, first edition, 2026-09-04.
>
> This file records public evidence found for Ribbingsfors Golf & Kultur and
> the decisions that may safely be made from it. It is not an assertion that
> every linked asset may be redistributed, nor that secondary map coordinates
> are surveyed. The reusable production workflow is defined in
> [Course v2 production guide](../v2-course-runbook.md).

## 1. Purpose and evidence labels

This dossier is the course-specific intake record for a Ribbingsfors
implementation. It exists so that a prototype value, a visual observation and
an approved production measurement cannot be confused later.

The labels used below mean:

| Label | Meaning |
|---|---|
| Official | Published by the club, Svenska Golfförbundet, a municipality or another responsible public body. |
| GIT-derived | Presented by a service that says the current operational data comes from the Swedish Golf Federation's Golfens IT-system. |
| Secondary | Published by an independent directory or banguide provider and not approved by the club for this project. |
| Observation | A feature visible in a cited image, video or map; it is not a survey measurement. |
| Inference | A conclusion obtained by comparing sources. It must be validated before becoming production truth. |
| Production-authoritative | Licensed, georeferenced and reviewed evidence that has passed the source and spatial gates in the v2 production guide. |

No public source found during this review supplies surveyed tee, green, bunker,
fairway, road, water or tree geometry. None of the secondary coordinates in
this file are production-authoritative.

## 2. Identity

### 2.1 Official facts

| Field | Value | Evidence |
|---|---|---|
| Public name | Ribbingsfors Golf & Kultur | Club website and SGF |
| Club number | 740 | SGF club list |
| Abbreviation | RG&K | SGF club list |
| Golf district | Västergötlands GDF | SGF club list |
| SGF admission date | 2012-02-17 | SGF club list |
| Organisation form | Golfbolag | SGF 2026 club/course list |
| Operator named on contact page | BARTOLOMEUS AKTIEBOLAG | Official contact page |
| Physical course | 9 holes | Club and SGF |
| Played as | 9 holes, or the same nine twice for 18 | Course card structure and public guides |
| Par | 36 for nine; 72 when played twice | Club and GIT-derived guide |
| Course type | Park and pasture course in a manor environment | Official club description |
| Setting | Gullspång municipality, beside Lake Skagern | Official club description |
| Opened/completed | 1991 | Official club description |
| Architect | Janne Lundvall | Official club description |
| Hole names | No individual names found; holes are identified as 1–9 | Official banguide and reviewed public guides |

Primary links:

- Official home: https://ribbingsforsgk.se/
- Official club description: https://ribbingsforsgk.se/klubben/
- Official contact page: https://ribbingsforsgk.se/kontakt/
- SGF club identity PDF:
  https://cdn.strife.app/UQdeLF4HBvVOtMCv-_lnphXfhAIX1-W4DjwOMv-g-wU/raw%3At/fn%3AR29sZmtsdWJiYXIgb2NoIEdvbGZib2xhZyBpIFN2ZXJpZ2UgaSBib2tzdGF2c29yZG5pbmcucGRm%3At/aHR0cHM6Ly91cGxvYWRzLnN0cmlmZS5hcHAvU0dGVC8zZWIwN2M3NS1mM2UyLTQzZjAtOTNhMS04YTk5M2Q3MTIwMGQvb3JpZ2luYWwucGRm.pdf
- SGF 2026 club/course list:
  https://cdn.strife.app/7nOAmLagvELRcdvtqx5ukNwCdQGBlR2nnqLDPpDeXpY/raw%3At/fn%3AMjAyNjA0MjQgU0dGIE1heHRhayBwZXIgZ29sZmtsdWJiLnBkZg%3At/aHR0cHM6Ly91cGxvYWRzLnN0cmlmZS5hcHAvQ0xVQi81MjM2YzMzOC04NTAyLTQxOGEtOTA0MC1mODJlOGI4OGIxZTIvb3JpZ2luYWwucGRm.pdf

### 2.2 Address and contacts

| Field | Published value |
|---|---|
| Visiting address | Trädgårdsmästarbostaden, 547 92 Gullspång |
| Postal address | Storgatan 15, 547 30 Gullspång |
| General email | info@ribbingsforsgk.se |
| Additional published email | hulestad@brandbergs.se |
| Main telephone | 0551-212 25 |
| Thorsten | 076-830 00 91 |
| Karin | 076-110 04 50 |

Source: https://ribbingsforsgk.se/kontakt/

Contact details are operational data and may change. Confirm them immediately
before seeking source files or media permission.

### 2.3 Currentness snapshot

The following dates were visible through the official WordPress API when
checked on 2026-09-04:

| Record | Published | Modified |
|---|---:|---:|
| Club page | 2024-06-26 | 2026-07-26 |
| Guest page | — | 2026-08-30 |
| Banguide page | — | 2025-07-04 |
| Contact page | — | 2024-07-20 |

The Svensk Golf course directory said its GIT data was updated on 2026-09-03:

https://www.svenskgolf.se/golfguiden/ribbingsfors-golf-kultur/

These are page/data freshness indicators, not survey capture dates.

## 3. Routing and scorecard

### 3.1 Facts that can be accepted now

- The physical routing has holes 1–9.
- The par sequence is 4, 3, 4, 4, 5, 4, 4, 3, 5.
- The nine-hole par is 36.
- An 18-hole round repeats the same physical routing.
- The official club page publishes these nine-hole tee totals:

| Tee | Official total |
|---|---:|
| White | 3,110 m |
| Yellow | 2,966 m |
| Red | 2,525 m |

Official source: https://ribbingsforsgk.se/klubben/

The club page reviewed did not publish a current hole-by-hole scorecard.

### 3.2 Secondary hole-by-hole card

Caddee currently publishes the following values. Its page explicitly says
Ribbingsfors is not connected to Caddee and that Caddee cannot guarantee the
graphics are completely accurate.

Source: https://www.caddee.se/klubb/ribbingsfors-golf-kultur

| Hole | Par | First-loop SI | Orange | Red | Yellow | White | Secondary description |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 4 | 11 | 244 | 292 | 333 | 343 | Dogleg left after a large fairway bunker |
| 2 | 3 | 13 | 88 | 133 | 157 | 175 | Short hole diagonally over water |
| 3 | 4 | 1 | 232 | 278 | 332 | 362 | Narrow and difficult |
| 4 | 4 | 7 | 206 | 262 | 312 | 331 | Dogleg left around a grove/fairway bunker |
| 5 | 5 | 5 | 322 | 408 | 441 | 465 | Long, with several ponds |
| 6 | 4 | 9 | 190 | 278 | 338 | 387 | Strong dogleg right; pond in a depression |
| 7 | 4 | 3 | 241 | 305 | 359 | 370 | Long; described as the second-hardest hole |
| 8 | 3 | 17 | 88 | 121 | 137 | 175 | Short hole |
| 9 | 5 | 15 | 322 | 394 | 469 | 502 | Dogleg right; large pond in a depression |

The listed first-loop stroke indexes are the odd indexes. Caddee presents the
second pass as holes 10–18 with the corresponding even indexes.

### 3.3 Conflict analysis

The per-hole sums are:

| Tee | Caddee row sum | Official club total | Difference |
|---|---:|---:|---:|
| White | 3,110 m | 3,110 m | 0 m |
| Yellow | 2,878 m | 2,966 m | -88 m |
| Red | 2,471 m | 2,525 m | -54 m |
| Orange | 1,933 m | Not published | — |

Caddee's own embedded 18-hole totals are exactly twice its hole rows: white
6,220 m, yellow 5,756 m, red 4,942 m and orange 3,866 m. Therefore:

- white happens to agree with the official total;
- yellow and red do not agree with the official totals;
- orange has no matching official total in the club page reviewed;
- no redistribution or club-approval status converts the secondary rows into
  an official card.

The Golf i Sverige page currently mirrors the same per-hole rows and therefore
is not an independent confirmation:

https://www.golfisverige.com/klubb/ribbingsfors-golf-kultur/

### 3.4 Chosen provisional production policy

The current development implementation deliberately uses a mixed provisional
card. It is not an official hole-by-hole card:

| Hole | White, Caddee-equivalent | Yellow, GolfTraxx | Red, GolfTraxx |
|---:|---:|---:|---:|
| 1 | 343 | 350 | 308 |
| 2 | 175 | 168 | 140 |
| 3 | 362 | 330 | 280 |
| 4 | 331 | 338 | 277 |
| 5 | 465 | 466 | 411 |
| 6 | 387 | 334 | 276 |
| 7 | 370 | 365 | 307 |
| 8 | 175 | 135 | 120 |
| 9 | 502 | 480 | 406 |
| **Nine-hole sum** | **3,110** | **2,966** | **2,525** |

The white rows are equivalent to the Caddee rows in section 3.2. The yellow
and red rows are transcribed from the public GolfTraxx scorecard and interpreted
as metres even though that page labels them as yards. That interpretation is
consistent with the service's demonstrated unit problem and makes the two row
sums equal the official club totals. A matching sum is useful corroboration;
it does **not** make GolfTraxx, its individual rows or its units official.

Until the club supplies a dated current GIT/club scorecard:

1. Encode the course identity, physical hole order and par sequence as
   verified facts, and keep the official nine-hole tee totals in source
   metadata.
2. Label the entire mixed-source card, every affected distance and the
   unconfirmed stroke indexes as secondary/provisional in data and visibly in
   the UI. A source note hidden only in repository files is not sufficient.
3. Do not present orange as an official available tee solely from Caddee.
4. Do not treat the exact yellow/red sums as club approval, or silently adjust
   an individual row if another total later appears.
5. Before release, replace all provisional rows, indexes, provenance labels
   and dependent tests together—atomically—with one card supplied or
   confirmed by the club. Record its edition date and permission; do not mix a
   newly official row with the remaining provisional rows.

## 4. Official banguide assets

### 4.1 Pages and media

- Official banguide page:
  https://ribbingsforsgk.se/banguide/
- WordPress page API:
  https://ribbingsforsgk.se/wp-json/wp/v2/pages?slug=banguide&_embed
- Official course overview illustration, uploaded 2025-05-19, 2560 × 1802:
  https://ribbingsforsgk.se/wp-content/uploads/2025/05/banguideribbingsforsgolfokultur1-1-1-scaled.jpg
- Overview media metadata:
  https://ribbingsforsgk.se/wp-json/wp/v2/media/255
- Official banguide video, uploaded 2025-07-04, 1920 × 1080, about 72 seconds:
  https://ribbingsforsgk.se/wp-content/uploads/2025/07/Banguide-60fps.mp4
- Banguide video media metadata:
  https://ribbingsforsgk.se/wp-json/wp/v2/media/580
- Official alternate course overview video, uploaded 2025-07-04,
  1920 × 1080, about 69 seconds:
  https://ribbingsforsgk.se/wp-content/uploads/2025/07/Banoversikt-60fps.mp4
- Alternate video media metadata:
  https://ribbingsforsgk.se/wp-json/wp/v2/media/581

The official overview visibly includes all nine holes, clubhouse, driving
range, practice area, roads, water, bunkers and major tree masses. It is an
illustrated guide, not a metric plan. It is not conventionally north-up; use
the north arrow drawn on the source when comparing it with geographic data.

### 4.2 Hole sponsors visible on the official guide

| Hole | Sponsor |
|---:|---|
| 1 | Värmlands Säby Gård |
| 2 | Partex Marking Systems AB |
| 3 | BriQ Hotell i Hova |
| 4 | Lyrestads Gjuteri AB |
| 5 | Isac Brandberg AB |
| 6 | Gullspång Invest |
| 7 | Moelven Vänerply AB |
| 8 | Gordons Projekt AB |
| 9 | Ditt företag? |

Sponsor marks should not be reproduced as application content without separate
permission. They can help identify which source card edition was reviewed.

## 5. Official site photo inventory

These are high-resolution official-site course and facility references,
uploaded on 2024-07-20:

| Subject observed | Direct URL |
|---|---|
| Range through a mature oak | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1627_fullres-scaled.jpg |
| Driving-range bays | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1645_fullres-1-scaled.jpg |
| Practice green, pond and estate buildings | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1648_fullres-scaled.jpg |
| Golfer/practice green/clubhouse context | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1662_fullres-scaled.jpg |
| Clubhouse and restaurant terrace | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1673_fullres-scaled.jpg |
| Hole 1–9 directional sign | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1676_fullres-scaled.jpg |
| Tee and fairway | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1745_fullres-scaled.jpg |
| Broad tee/fairway view | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1768_fullres-1-1-scaled.jpg |
| Kraka-sten bench/net landmark | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1866_fullres.jpg |
| Broad fairway | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1868_fullres-scaled.jpg |
| Fairway, green and bunker | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1871_fullres-1.jpg |
| Gravel path and pasture fence | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1880_fullres-scaled.jpg |
| Clubhouse and terrace | https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1924_fullres-scaled.jpg |

Complete official WordPress media catalogue:

https://ribbingsforsgk.se/wp-json/wp/v2/media?per_page=100

Most images in this campaign whose metadata survived WordPress processing
carry the EXIF credit JENS HENDAR and identify a Canon EOS 5D Mark IV. A blank
credit on a derived file is not evidence that it is uncredited or freely
licensed.

The clubhouse photographs support these observations for modelling reference:

- an elongated, simple one-and-a-half-storey timber building;
- pale warm-yellow vertical timber boarding;
- light grey or off-white corner boards, window surrounds and bargeboards;
- grey-painted multipane windows and doors;
- a low-pitched red/orange clay-tile gable roof with dark gutters;
- a brick chimney;
- a timber restaurant terrace on the long facade;
- gravel around the building.

These are visual observations, not architectural measurements.

### 5.1 Media rights policy

No explicit reuse licence was found for the official illustration, photographs
or videos. Public web access does not grant permission to copy them into the
repository, redistribute them with the application, train derivative texture
assets from them, or remove credits.

Until written permission is obtained:

- use the files only as internal research and visual-QA references;
- store source URLs, capture dates and visible/embedded credits in provenance;
- do not commit downloaded copies to the distributable application;
- do not publish crops, textures, thumbnails or video frames;
- request permission from Bartolomeus AB/the club and clarify whether the
  photographer or another party retains separate rights.

## 6. Secondary illustrated guides

Caddee's graphics show tee colours, water, bunkers, out-of-bounds and landmark
distance arcs. They are useful for corroboration but are both unverified for
this course and protected third-party graphics.

- Overview:
  https://caddee-prod-media.s3.amazonaws.com/course-images/eeb3b31e-3418-4577-af1c-e26584e1613f/overview-normal_web_Bn6GY9w.png
- Hole 1:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/881c9cdb-5c42-487b-8f59-f7be4d372b53/hole-normal_web_ffikRH2.png
- Hole 2:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/7538465c-431a-4887-b4d7-7055f5fa79ca/hole-normal_web_7qJ8bt7.png
- Hole 3:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/067d3d3e-dae0-404d-8a77-2c02be9e5d6e/hole-normal_web_phvcKeZ.png
- Hole 4:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/c4c30ee0-9339-4572-8f14-829d15e496ed/hole-normal_web_rIS3MeW.png
- Hole 5:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/45bdbfe3-8b81-429c-9846-6c8276fea709/hole-normal_web_fqhRymP.png
- Hole 6:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/7b3649f5-f491-436d-99ca-1942de8325c0/hole-normal_web_sdPr1Wy.png
- Hole 7:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/d27b81f1-1f9b-470d-b826-715fe88e2d8d/hole-normal_web_6HE0Km6.png
- Hole 8:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/f75f3ce4-cf82-46c3-a28d-9e9a03b09c72/hole-normal_web_ONVEA8O.png
- Hole 9:
  https://caddee-prod-media.s3.amazonaws.com/hole-images/cac668c3-ecf3-459c-82a9-9c7418e3fb99/hole-normal_web_3kHtjbK.png
- Caddee terms:
  https://www.caddee.se/anvandarvillkor

Caddee identifies Hamilton Design AB/Caddee in its copyright footer. Its terms
do not provide a project reuse grant. Do not ship, trace verbatim or derive
application art from these images without written permission.

Golf i Sverige also serves generated banguide images and a GIT-hosted gallery,
but no reuse licence was found:

https://www.golfisverige.com/klubb/ribbingsfors-golf-kultur/

Use that page as a comparison reference only.

## 7. Location and geometry seeds

### 7.1 Clubhouse point

Golf i Sverige publishes this WGS84 coordinate:

- latitude 58.9649569
- longitude 14.1212497

Source:

https://www.golfisverige.com/klubb/ribbingsfors-golf-kultur/

Another directory publishes approximately 58.9649287, 14.1211042, while an
older low-precision directory publishes 58.9641, 14.1226. The first coordinate
is the best public clubhouse POI seed found, but it is not an independently
controlled origin. Transform it through the pinned production CRS pipeline
only for discovery/preview; do not approve the ground frame from it.

### 7.2 OpenStreetMap

OpenStreetMap contained, when queried on 2026-09-04:

- node 2375951505, named Ribbingsfors Golf & Kultur;
- way 779352687, tagged as a golf course;
- nearby building footprints, roads and water;
- no detailed golf tee, fairway, green or bunker features.

Links:

- Boundary way: https://www.openstreetmap.org/way/779352687
- Area map: https://www.openstreetmap.org/#map=16/58.962/14.118

Observed boundary envelope:

- minimum latitude: 58.9569687
- maximum latitude: 58.9650786
- minimum longitude: 14.1076902
- maximum longitude: 14.1258203
- 57 boundary vertices

The Overpass response reported the data timestamp
2026-06-01T08:52:28Z. OSM is supporting evidence under ODbL, not played-surface
authority. Preserve attribution and assess share-alike obligations before
publishing an OSM-derived database.

### 7.3 GolfTraxx low-confidence seeds

GolfTraxx exposes apparent tee, route-target and green positions. The decimal
precision printed by the service is not evidence of positional accuracy.

Source pages:

- Scorecard:
  https://golftraxx.com/scorecard?course_name=Ribbingsfors+Golfklubb&fulladdress=Tr%C3%A4dg%C3%A5rdsm%C3%A4starbostaden+Gullsp%C3%A5ng+SW&static=true&zipcode=58592SW
- Full layout:
  https://golftraxx.com/full-layout?coursename=Ribbingsfors%20Golfklubb&zipcode=58592SW&city=Gullsp%C3%A5ng&state=SW&static=true

Note that these URLs also contain postal code 58592 rather than the official
visiting-address postal code 547 92.

#### Tee and route-target seeds

All pairs are latitude, longitude in apparent WGS84:

| Hole | “Tips” tee seed | Route-target seed |
|---:|---|---|
| 1 | 58.96464317046395, 14.12101951063689 | 58.962635201790484, 14.12187513531264 |
| 2 | 58.961407576350055, 14.123948022059931 | 58.961407576350055, 14.123948022059931 |
| 3 | 58.959834856709435, 14.123285040146083 | 58.95800088214033, 14.121498688942165 |
| 4 | 58.957342275607445, 14.120382413698325 | 58.959379597003554, 14.120956406427512 |
| 5 | 58.95994227448194, 14.117662177523211 | 58.95981226783557, 14.11395536466463 |
| 6 | 58.95917792742799, 14.10851803540667 | 58.96055821112653, 14.111463100905022 |
| 7 | 58.95984572151205, 14.112176092268571 | 58.96057873058898, 14.115904362799272 |
| 8 | 58.961825252428774, 14.118889200532529 | 58.961825252428774, 14.118889200532529 |
| 9 | 58.96182712742663, 14.12289861131451 | 58.96281732060102, 14.119572672136043 |

For the par-three holes, the source uses the tee point itself as the route
target.

#### Green seeds

All pairs are latitude, longitude in apparent WGS84:

| Hole | Centre | Front | Back |
|---:|---|---|---|
| 1 | 58.9621948215, 14.1232184689 | 58.9622406808, 14.123063377 | 58.9621531112, 14.1233869718 |
| 2 | 58.9602459544, 14.1224991606 | 58.9603429931, 14.1226283829 | 58.9601502987, 14.122404807 |
| 3 | 58.9573854872, 14.1210502915 | 58.9575046708, 14.1211446451 | 58.957280135, 14.1209613023 |
| 4 | 58.9598831374, 14.1199554739 | 58.9598169781, 14.1200659208 | 58.9599313171, 14.1198423449 |
| 5 | 58.95912084, 14.1104841177 | 58.9591528797, 14.1106428443 | 58.9590901835, 14.1103280733 |
| 6 | 58.9604718566, 14.1127849767 | 58.9604748485, 14.1126191561 | 58.9604660988, 14.1129481152 |
| 7 | 58.9605186537, 14.1177331761 | 58.9605202625, 14.1174573849 | 58.9605073639, 14.1179553232 |
| 8 | 58.9616594063, 14.1210210881 | 58.9616720762, 14.1208338098 | 58.9616453536, 14.1211922732 |
| 9 | 58.9647873447, 14.1196151343 | 58.9647253321, 14.1196048818 | 58.964835529, 14.1196253869 |

#### Demonstrated unit problem

Distances measured through GolfTraxx's route target are systematically about
0.9144 times the page/card values:

| Hole | Route length calculated from coordinates | Page/card value | Ratio |
|---:|---:|---:|---:|
| 1 | 319.9 m | 350 | about 0.914 |
| 2 | 153.6 m | 168 | about 0.914 |
| 3 | 301.3 m | 330 | about 0.913 |
| 4 | 309.1 m | 338 | about 0.915 |
| 5 | 426.4 m | 466 | about 0.915 |
| 6 | 304.6 m | 334 | about 0.912 |
| 7 | 333.8 m | 365 | about 0.915 |
| 8 | 123.6 m | 135 | about 0.916 |
| 9 | 439.3 m | 480 | about 0.915 |

The common factor is the yard-to-metre conversion 0.9144. The evidence strongly
suggests a unit interpretation error in the source. This is an inference from
the source data, not a claim about the club's measurements.

Production policy:

- never use these seeds as control points;
- never use the derived route lengths as official card distances;
- use them only to locate likely features in licensed contemporary ortho;
- record any later accepted feature from the ortho/survey source, not from
  GolfTraxx;
- discard a seed when it disagrees with the official guide, ortho, terrain or
  field evidence.

### 7.4 Hole 9 yellow-tee correction in the provisional build

Blindly interpolating the provisional 480 m row along the extended GolfTraxx
route placed the yellow tee centre at local `[612.4, -87.5]`, only 2.20 m from
the centreline of OSM asphalt way `w1135143747`. The visible road is 6.4 m wide,
and 62.9% of the generated 12 x 6 m tee pad overlapped it. This was a compiler
error, not a frame-bridge error.

The authenticated Lantmateriet 1 m DTM resolves a small, flat constructed
bench close to the original GolfTraxx discovery seed. The provisional build
now records its crown at EPSG:3006 E 449,556.6 / N 6,536,126.3 (local
`[581.1, -101.8]`) in
[`tee-controls.json`](../../ribbingsforsbuild/tee-controls.json). A route-aligned
6 x 4 m candidate pad has about 9.4 m clearance beyond the rendered asphalt
edge. The official/Caddee hole-9 illustration independently corroborates three
separate tee decks, but it is non-metric artwork and was not traced.

This is a safer provisional spatial control, not production authority. The
480 m value remains card metadata and is not claimed to be a surveyed geometric
distance from this point. Licensed orthophoto or a club/survey tee outline must
replace the candidate. The compiler and committed-pack regression test now
reject every tee polygon that intersects a rendered road ribbon.

## 8. Official local-rule constraints

Official page:

https://ribbingsforsgk.se/klubben/lokala-regler/

The reviewed 2025 local rules provide these spatial/gameplay constraints:

| Hole/area | Constraint | Implementation consequence |
|---|---|---|
| 3, right side | White stakes define out of bounds only while playing hole 3 | Do not turn this into a universal property boundary for other holes |
| 9, right side | White stakes define out of bounds only while playing hole 9 | Store hole-context ownership on the rule geometry |
| 6, 7 and 8 road corridor | The road defines out of bounds on or beyond it | Road edge and rule edge need separate reviewed geometry if they do not coincide |
| 8, right side | Road-side out of bounds | Validate the right-side relationship against playing direction |
| 3, 5, 6 and 7, left side | Red penalty areas are defined on one side and extend indefinitely | Preserve open/single-sided rule semantics; do not close them arbitrarily from guide artwork |
| Course-wide | Red/yellow stakes or plates identify penalty areas | Marker objects may corroborate, but do not replace water/rule polygons |

The page heading and sentence around the road rule are not perfectly
consistent: a heading refers to holes 6 and 7 while the explanatory sentence
includes holes 6, 7 and 8. Confirm the intended current wording with the club
before release.

Other rules mention drainage trenches and exposed rock on closely mown areas.
These can affect relief/gameplay semantics, but the public rules do not locate
each instance.

## 9. Facilities and site features

The GIT-derived Svensk Golf page, updated 2026-09-03, lists:

- driving range;
- practice area;
- practice green;
- short course;
- pull-cart and golf-cart rental;
- clubhouse;
- changing room and shower;
- club rental;
- café and restaurant;
- caravan/RV pitch with electricity;
- lodging/cottage.

Source:

https://www.svenskgolf.se/golfguiden/ribbingsfors-golf-kultur/

Official pages additionally state:

- no advance tee-time booking; a ball-chute queue is used;
- a chipping green and putting green are available;
- RV/caravan parking is advertised at 150 SEK/day including electricity and
  shower;
- the on-site restaurant is Gerdas;
- the range introduced card/app payment for 2026.

Sources:

- Guest information: https://ribbingsforsgk.se/gast/
- Range: https://ribbingsforsgk.se/rangen-2/
- Food and drink: https://ribbingsforsgk.se/mat-dryck/

Prices, opening status, payment arrangements and services are mutable
operational facts. They should not be hard-coded into a static course build
without a displayed source date.

Directions published through the GIT-derived guide:

- from Gullspång, drive approximately 3 km through Skagersvik and turn left;
- from Hova/E20, drive toward Gullspång for approximately 15 km, exit toward
  Skagersvik and turn right before it; the course is signposted.

## 10. Landscape and cultural context

The Gullspång municipal LIS plan describes the Ribbingsfors manor setting as
two open landscape rooms, with the golf course west of the manor and meadow to
the east, between the winding road and the Lilla Skagern/Noret shoreline. It
also records wooded edges/road vegetation, nearby Natura 2000 interests, key
biotopes, high-nature-value pasture and deciduous woodland, and heritage
protection in the manor environment.

Municipal source:

https://gullspang.se/download/18.7c50c52218d2a6086062167a/1706094072845/LIS%20Gullsp%C3%A5ng%20Antagandehandling%20Laga%20kraft.pdf

The Västra Götaland cultural heritage page describes an estate with about 20
buildings, including the manor, two wings, gardener's house, ice cellar,
brewery and agricultural buildings:

https://www.vgregion.se/f/kulturforvaltningen/natur-och-kulturarv/platser--landskap/underverk-i-vastra-gotaland/ribbingsfors-herrgard-gullspangs-kommun/

These sources are authoritative context for asset selection and landscape
character. They are not current geometry for individual buildings, trees or
playing surfaces.

## 11. Rights and provenance register

| Source | Intended project use | Rights status and restriction |
|---|---|---|
| Official club text/pages | Identity, card totals, facilities and rule evidence | Facts may be recorded with citation; do not reproduce substantial copyrighted text |
| Official club banguide image | Internal visual cross-check | No reuse licence found; do not bundle, crop, trace as art or redistribute without permission |
| Official club videos | Internal routing and visual cross-check | No reuse licence found; do not bundle or publish frames without permission |
| Official club photographs | Internal visual reference and QA | No reuse licence found; most reviewed EXIF credits say JENS HENDAR; request rights explicitly |
| SGF PDFs and GIT-derived directory | Club identity/current operational corroboration | Cite facts; do not assume downloadable media or database redistribution rights |
| Caddee scorecard text | Temporary secondary card reference | Non-connected/unverified course; not release authority |
| Caddee map graphics | Visual cross-check only | Hamilton Design AB/Caddee copyright; no reuse grant found |
| Golf i Sverige maps/gallery | Visual comparison only | No reuse licence found; do not redistribute |
| GolfTraxx coordinates | Low-confidence discovery seed only | Database reuse terms unclear and source contains a demonstrated unit problem |
| OpenStreetMap | Supporting roads/buildings/boundary evidence | ODbL attribution required; assess derived-database share-alike obligations |
| Municipal and regional heritage documents | Environmental/context evidence | Cite and paraphrase; not a licence for unrelated embedded imagery |
| Lantmäteriet/club/survey inputs to be acquired | Production geometry | Record the exact order, terms, checksums, capture dates, CRS and derivative/distribution decision in the source manifest |

No linked public image should enter an application asset directory merely
because it can be downloaded.

## 12. Production acquisition and validation policy

The next geometry work should follow the shared v2 guide:

1. Register a Ribbingsfors ground distinct from its playable course/routing.
2. Obtain licensed Lantmäteriet Markhöjdmodell 1 m in EPSG:5845 for terrain.
3. Obtain contemporary orthophoto, Laserdata Skog, water break geometry and
   Topografi 10 for the complete ground and validation buffer.
4. Obtain a current official GIT scorecard and any club CAD/GIS, irrigation,
   drainage, green, tee, road, building or course-management layers.
5. Obtain at least 20 distributed independent control/check points before
   approving the canonical EPSG:5845 origin.
6. Digitise played surfaces from licensed contemporary evidence. Use the
   official banguide, photos, video and rules only as corroboration.
7. Resolve road-side out-of-bounds and single-sided penalty areas as explicit
   rule features separate from visual water/road materials.
8. Derive tree candidates and stand fields from pinned LiDAR campaigns, then
   manually review zone A against ortho and course imagery.
9. Preserve all public-source uncertainty and rights decisions in the ground
   source manifest.

## 13. Release blockers

A prototype may proceed with visibly provisional data. A public release that
claims PUTTOM v2 standard is blocked until every applicable item is closed.

### Identity and card

- [ ] The club confirms the public course name, nine-hole routing and current
      operational status.
- [ ] A dated current official/GIT scorecard supplies every active tee,
      per-hole length, par and stroke index.
- [ ] The yellow and red total conflicts documented in section 3 are resolved
      by the official card, not by arithmetic adjustment.
- [ ] The status of the orange tee is confirmed.
- [ ] The repeated-nine mapping for holes 10–18 and its stroke indexes are
      confirmed.

### Rights

- [ ] Written permission identifies whether the club banguide may be retained,
      traced, adapted, displayed or redistributed.
- [ ] Written permission identifies whether the official videos or frames may
      be retained or displayed.
- [ ] Written permission identifies which official photographs may be used,
      permitted derivatives, required credit and the actual rights holder.
- [ ] Caddee, Golf i Sverige and GolfTraxx assets are absent from release
      payloads unless a separate written licence has been obtained.
- [ ] OSM attribution and any database share-alike implications are reviewed
      and implemented if OSM-derived features remain.
- [ ] Every Lantmäteriet, survey and club-supplied source has an exact licence
      and redistribution/derivative decision in the source manifest.

### Spatial authority

- [ ] The ground's canonical EPSG:5845 frame is approved from independent
      controls; the public clubhouse point is not the sole anchor.
- [ ] Licensed 1 m DTM covers the entire aligned terrain grid without padding
      or nodata.
- [ ] Current orthophoto and LiDAR campaign dates and seams are recorded.
- [ ] Tee, green, fairway, fringe, bunker, water, road/path and building
      geometry has production-authoritative provenance.
- [ ] GolfTraxx seeds have been replaced by accepted geometry and do not
      survive as authoritative coordinates.
- [ ] Every hole has a reviewed line, tee set, green centre and playing
      corridor.
- [ ] Trees and stable objects in zone A have approved positions and no
      procedural large-object records.

### Course-specific rules and visuals

- [ ] The club resolves the road-rule wording for holes 6, 7 and 8.
- [ ] Hole-context out-of-bounds for holes 3 and 9 is encoded and tested.
- [ ] Single-sided red penalty areas left of holes 3, 5, 6 and 7 are confirmed,
      encoded without invented closures and tested.
- [ ] Course overview, every hole, clubhouse/range/practice facilities and
      signature manor/shoreline views pass human comparison against permitted
      source references.
- [ ] Environmental and heritage-sensitive areas are represented without
      inventing access, clearing or structures.

### Technical publication

- [ ] Terrain, surfaces, water, vegetation, roads and objects use the shared
      1 m lattice and one visible-ground sampler.
- [ ] All source, artifact, course and ground manifests pass validation.
- [ ] WebGPU and WebGL2 render the same geography and hole semantics.
- [ ] Course switching, base-path hosting, PWA caching, fallback and rollback
      pass.
- [ ] Performance passes the named-device budgets in the v2 production guide.
- [ ] The exact prior generation is retained and rollback is tested.
- [ ] The default/public enablement is an explicit release decision after
      evidence review.

## 14. Immediate requests to the club

One concise request can close several blockers. Ask for:

1. the current dated GIT/club scorecard for all tee colours;
2. any current course CAD/GIS, irrigation/drainage or green/tee survey data,
   with CRS and vertical datum;
3. confirmation of the local-rule wording around the road at holes 6–8;
4. permission terms for the 2025 banguide illustration and videos;
5. permission terms and required credit for the 2024 Jens Hendar photo set;
6. any known renovations after the dates of the public imagery;
7. a staff reviewer for hole-by-hole geometry and signature objects.

Until those answers arrive, the implementation should clearly describe itself
as a geospatially derived prototype, not a club-approved digital twin.

## 15. The surroundings survey — everything around the course, mapped (2026-09-05)

A dedicated pass mapped the landscape the course sits in: the lake, the
ditches, the woods, the manor, the villages, the roads and rails, the
protected trees and the working yard. Its committed inputs are
`ribbingsforsbuild/osm-surroundings.json` (a wide OSM parse) and
`ribbingsforsbuild/surroundings-traces.json` (read-by-eye Esri z17/z18
traces with per-feature confidence); `ribbingsforsbuild/apply-surroundings.mjs`
merges both into the course model idempotently and re-gates the result. All
of it is compatibility-build (GPK1) material under the same provisional
labels as section 3 — nothing here claims production survey authority.

### 15.1 Lake Skagern — level, extent and two corrections

- **The lake level is 69.3 m (RH 2000), not OSM's `ele=66.9`.** The break
  geometry says 69.3; the committed vista heightfield reads a laser-flat
  69.35 over the open basin at [4000,-3000] and [3000,-4000]. The OSM tag is
  wrong or on another datum and was rejected.
- The model carries **one Skagern ring** (§18). Its OSM half is the shoreline
  chained from three runs (gaps of 26–66 m from members outside the extract),
  closed offshore through the keep-box corner, with the far-north-east corner
  cut along the measured diagonal x−z=7600 where the blind closure had swept
  in 0.7 km² of 70.6–73.6 m land. Gate: ≥95 % of interior vista samples
  within 0.75 m of 69.35 — measured 99.0 %, worst 1.32 m (32 m cells
  averaging shore into water).
- The first build kept that OSM ring **and** the two break-geometry lake
  polygons at the same level, "by design". That was wrong — three coplanar
  sheets z-fight, the break polygons' straight item-edge chord drew a foam
  line across open water, and OSM's over-reach carved laser land into water.
  §18 records the correction: the three are united into one ring on a raster,
  the laser shoreline winning wherever the item draws one.
- **Two islets inside the ring are documented simplifications**: the Noret
  arm's reed islet (centroid laser height 69.96 m, 0.66 m above the lake,
  edges at the waterline) and a far islet at ~2.6 km. The engine's carve
  drowns land inside a ring; a keyhole cut would draw a bench line across
  open water, so the low islets stay under.
- North of the Skagersvik strait the water drops to ~67.5 m — that is
  **Gullspångsälven below the Skagern outlet, a different water body**, and
  the interior gate is what keeps the lake ring from ever swallowing it.

### 15.2 The drainage story — ditches and ponds as one system

The local rules mention drainage trenches; the imagery shows where they are.
Traced (confidence medium, widths 1.2–1.5 m):

1. **The eastern boundary ditch** winds north through the rough east of
   hole 3 / west of the forest edge (the banguide's "diken utmed
   korridoren") into the hole-2 pond at 77.7 m.
2. From that pond the water passes **under the road at a visible culvert**
   and runs west as the **green-1 ditch**, wrapping green 1's north side —
   the banguide's two ditches near green 1 — into the hole-9 pond at 72.0 m.
3. A short **outlet channel** leaves that pond west toward the shore.

The gradient (hole 3 ≈ 80 m → pond 77.7 → pond 72.0 → lake 69.3) makes the
system coherent. These traced runs replace the four synthetic guide-crossing
streams of the first build; a short traced connector joins the two hole-4
tee ponds ("damm och bäck formar utslaget").

### 15.3 The Ribbingsfors ekhage — 86 protected trees drawn as themselves

Länsstyrelsen's CC0 inventory (section 7 reference data) holds 88 records
within 250 m, most labelled "Ribbingsfors ekhage": 70 oaks (one 569 cm
giant), 7 ash, 4 elm, 3 lime, 2 beech, 1 chestnut, 1 aspen/poplar.
Reconciled against the 2023 laser canopy raster (a ≥3 m return within 4 m),
**86 of 88 confirmed** and now stand in the model as individual crowns sized
from trunk circumference. The two unconfirmed (elm 368 cm at the farmyard,
oak 336 cm west of hole 8 — object ids 9267 and 15731) stay evidence-only:
a missing return is a review signal, not proof of felling. The measurement
is frozen in `apply-surroundings.mjs` because the script's own open burns
would otherwise flip records on rerun (a mature oak stands inside the traced
parking lot).

### 15.4 The satellite corrections and traces

- **The provisional driving range lay on open lake water.** The guide
  interpretation in build-course.mjs put its 285 m ellipse at local
  [15..234, −456..−256] — dark water in every image. The real practice
  ground is the mown block between the hole-9 and hole-1 corridors south of
  the clubhouse (bays at its south end, the photographed mature oak standing
  in the field at [478,−288]); replaced, confidence medium.
- **Practice greens**: two mown circles by the clubhouse, at [516,−450]
  (r≈10) and [542,−427] (r≈12) — now `scenery.greens`.
- **Parking**: the real gravel lot with visible car rows at [694..726,
  −442..−394], beside the road east of the clubhouse.
- **Greenkeeping yard** south-west of hole 5: machine hall (15×28 m), two
  sheds, hardstanding with machinery — `surround.yard` plus three building
  footprints.
- **Walls**: two straight boundary lines with bank/stone-wall character
  (north of hole 8; behind green 3 with its track), confidence low/medium.
- **Jetties**: one west of green 9, one bathing jetty on the manor shore.
- **Clear-fell**: one large regenerating felling between the yard and the
  southern spruce block, planted by the engine at 6 % with stumps.
- **The manor precinct** is ringed as residential landuse so the planter and
  scatter keep off the estate lawns; the kitchen-garden enclosure at
  [478..502, −550..−533] is inside it. The manor operates as
  https://ribbingsforsherrgard.se/ (Ribbingsfors Herrgård).

### 15.5 The wider OSM landscape

From the wide extract (ODbL, bbox 14.090–14.160 × 58.948–58.985, clipped to
a 4.6 km keep box, projected with the repo's Krüger series — sub-mm at the
frame origin):

- **7 forest and 4 wetland rings** (the reedy bays double as
  `surround.shallows`, so their beds read a few decimetres down rather than
  the 5.5 m lake carve), 1 scrub, 7 farmland and 24 other landuse rings;
- **91 roads, 63 tracks, 21 paths**, and the disused **Otterbäcksbanan /
  Torvedsbanan railway** (3 runs, `usage=tourism` — the rail-bike line whose
  hire point is the "Gullspång dressinuthyrning" POI);
- **225 buildings** (37 near incl. the provisional clubhouse and yard sheds;
  the rest as far boxes) and **482 synthesized village houses** inside the
  OSM residential rings of Skagersvik and the Gullspång edge, street-aligned
  — the Ås precedent, since OSM maps almost no house there;
- the **power corridor** with 44 towers, 2 piers, 5 OSM parking areas;
- **16 places** as POIs: Skagersvik (village), Väggetorp (hamlet), the
  Ribbingsfors farm node, eight isolated dwellings, the Sörhult peak with
  survey point (across the lake), a communication mast and a chimney.

### 15.6 Still unlocated, still open

- **"Kraka-sten"** — the club's own photo set names a bench/net landmark by
  that name (section 5); no public source locates the stone, and 0.3 m/px
  imagery cannot. Ask the club where it stands.
- Local rules mention **exposed rock on closely mown areas**; individual
  stones are below imagery resolution and await the orthophoto or a site
  visit.
- The eastern boundary ditch south of hole 3, the forest drainage grids in
  the south-west peatland, and any fences are visible but not yet traced
  feature-by-feature.
- Everything in this section remains subject to the release blockers of
  section 13; the Esri-derived traces are migration-only under a blocked
  redistribution licence (see the source manifest).

## 16. Imagery verification of the played surfaces (2026-09-05)

With no licensed orthophoto yet available, the played surfaces were checked
against **Esri World Imagery z18** (the same migration-only, blocked-licence
source as §15's traces) to decide whether they can be improved by eye now.
The crops and the per-green overlays are produced by
`ribbingsforsbuild/sat-crop.mjs`, which for this pass grew a finer grid
(50 m on ≤300 m windows) and draws the model's greens, tee pads and bunkers
on top so model and imagery can be compared directly. Tiles stay in the
gitignored cache; nothing is redistributed.

**The finding is that the surfaces should NOT be hand-retraced now.** Two
measured reasons:

1. **The green centres are already survey points, not guesses.** The model's
   nine green centres reproduce the GolfTraxx *Green Center* survey coordinates
   to 0.0 m (verified through the frame). Only the GolfTraxx route *lengths*
   ever carried the yards-as-metres error (§7.3); the green-centre points did
   not. Against the imagery these centres land on the real putting surfaces on
   holes 4, 5, 7, 8 and 9, and within reading error on 1, 2 and 6; hole 3 is
   the one where the centre looks ~15 m from the most distinct mown oval, and
   even there the survey point is inside the green complex.

2. **The bunkers are guide-formula-placed and land on real sand more often
   than not.** They are positioned by `fromGreen` distance × side offset from
   the centreline (`build-course.mjs`), and against the imagery they sit on the
   actual bright-sand bunkers on holes 4, 5, 7, 8 and 9. The clear soft spots
   are **holes 3 and 6**, where two or three of the guide ellipses fall on
   rough or grass hollows rather than the visible sand.

What this course denies a tracer is contrast: it is a **park-and-pasture
course photographed leaf-off in early spring**, so greens differ from fairway
by a shade, bunkers are small, and grass hollows read like sand. Reading a ring
vertex off z18 against a 50 m grid is ±4 m at best, and on this ground the
distinction between a mown green and its apron, or a bunker and a hollow, is
often below that. A wholesale retrace would therefore replace survey-grade
green centres and mostly-correct bunkers with differently-imprecise eyeball
geometry — the exact failure the repo warns against ("measure the imagery
before believing"; "a plain picture of the real thing beats a beautiful
picture of a different thing"). The green **outlines** remain synthetic
ellipses, but their **positions** are survey-anchored, which is what a distance
or a routing actually depends on.

**So the identifiable, evidence-backed soft spots are narrow:** the bunker
placement on holes 3 and 6, and hole 3's green-centre-versus-surface offset.
These are left for the licensed orthophoto or the club's own data rather than
"corrected" into new uncertainty — the imagery does not resolve where hole 3's
bunkers actually are with enough confidence to move them safely.

**What genuinely raises precision from here, in order, is unchanged from §12
and needs data this pass could not obtain by eye:**

1. The licensed Lantmäteriet orthophoto — now **open data, CC-BY 4.0** since
   Feb 2025 on the same Geotorget/dl1 channel and account the DTM already uses
   (`imagery-lm-ortho` in the source manifest). One 0.16–0.25 m window replaces
   the synthetic green/fairway/bunker outlines, the Esri traces and the tee
   interpolation at once, and clears most of §13.
2. Extending the hole-9 **DTM-bench tee method** (`tee-controls.json`, plane
   RMSE 0.136 m) to all 27 tees — the terrain we already have, no new licence.
3. The neighbouring **break-geometry items** (653_45, 654_44, 654_45) for the
   laser-surveyed Skagern waterline with real island holes, retiring the OSM
   ring and the two documented drowned-islet simplifications.
4. The club's current **GIT scorecard and any GIS/drainage plan** (§14) — the
   only source that makes the per-hole card rows and the ditch runs
   authoritative rather than provisional.

The reusable outcome of this pass is the tracing tooling itself
(`sat-crop.mjs`'s grid and surface overlays), so that when the orthophoto or a
club layer does arrive, the traced comparison is one command away.

## 17. The bunkers are measured now, not placed by formula (2026-09-05)

§16 said the played surfaces should not be hand-retraced, and stood by the
guide-formula bunkers because they landed on real sand on most holes. Sand,
though, is the one surface that can be **measured** in the imagery rather than
read by eye — bright, low-saturation, warm pixels against grass — so the
bunkers were re-derived from pixels instead:

`ribbingsforsbuild/detect-sand.mjs` composes the Esri z18 tiles over the whole
course at native resolution (4096 × 3328 px, 0.309 m/px), classifies sand per
pixel, grows 4-connected components and converts each one's centroid, area and
covariance axes to frame metres through the exact tile → WGS84 → EPSG:3006 →
local mapping. Positions therefore carry the imagery's own orthorectification
error (a few metres) plus classification edges — **not a reading error**, which
`--find` measured at 7–20 m for the coordinates read by eye in §16.

**Calibration was measured, not assumed.** `--find` searched the brightest 5×5
patch within 18 m of 19 hypothesised bunkers: sand reads rgb 183–214 /
170–193 / 136–161 (min channel ≥136, R−B 42–54, G−R −9…−22). The confusers
each fail one test — the dry-grass mound at [533,−409] reads 166,162,127 with
G−R −4 (too grey, too dark), the yard roof 192,195,181 has G>R, the white
house roof 222,219,208 has R−B 14. So the classifier is `min ≥ 132, spread ≤ 75,
R−B ≥ 30, G−R ≤ −6`, plus geometric exclusions (water, buildings, parking, the
yard, 7 m of any road) and a played-ground gate (within 75 m of a hole line or
green, 8–700 m²).

**Result: 32 candidates on the played ground; 21 accepted, 11 rejected, all
listed in `sat-shapes.json`.** The rejects are pale dry rough along the hole-4
tree clump, a farmland patch east of the boundary ditch, worn tee ground and
the greenkeeping yard's hardstanding — visible as such on the review crops the
tool writes. The 18 accepted bunkers (two split components merged at green 5)
replace the 24 guide-formula ellipses through `apply-sat-shapes.mjs`, drawn as
ellipses at the pixel centroid with the covariance axes.

What the measurement says against the guide:

| finding | holes |
|---|---|
| guide bunker confirmed on sand, now at its measured position | 1, 2 (×2), 3 (×1), 4 (×2), 5 (greenside), 6 (×3), 7 (×4), 8 (north), 9 (×3) |
| guide bunker where the imagery shows plain grass — **dropped, not guessed** | 3 (second greenside), 5 (fairway right at 215/245 m), 7 (third at 190 m), 8 (south greenside), 9 (fairway "right" and the shaded left greenside) |
| side disagreement | hole 9's fairway pair are BOTH left of the line (the guide had one right); hole 1's dogleg bunker lies 8 m west of the provisional line, i.e. on the player's right heading south, where the guide says left — either the guide's side or the provisional line is off |

The dropped entries stay listed under `unresolvedGuideBunkers` with what the
pixels read there, so the decision is reviewable. Two are genuinely uncertain
rather than absent — hole 9's left greenside patch reads 152,141,117 (shaded
sand or shadow) and hole 8's south side 171,169,134 (grey; a path or worn
grass) — and the licensed orthophoto or a site visit settles them. The
`guide-notes.json` prose still describes the course as the guide states it
("bunkrar på båda sidor" at green 8); the render shows what the imagery
resolves.

Order in the pipeline: `build-course.mjs → apply-sat-shapes.mjs →
apply-surroundings.mjs` (the surroundings pass burns bunker rings open in the
tree-cover raster, so it runs last). Every measured bunker is gated ≥9 m from
its own green centre, so a pale collar can never pass as sand.

## 18. The lake as it is drawn — one ring, and a bed under the frontier (2026-09-05)

The owner's phone screenshots of the published app showed Skagern as a pale
sand plate over almost its whole area, blue only in a near band, with a
sawtooth edge between the two and green islets standing out of the "sand".
Two separate defects, one in the data and one in the engine, both measured
before anything was changed (`V3D.waterBedAt`, `V3D.waterSheets`,
`V3D.probeGround` over a 300 m grid of the ring's interior).

### 18.1 The engine: a fixed frontier carved no lake bed

Ribbingsfors serves the **fixed 64-tile frontier**, not the streaming ring
graph, and the v2 lake-bed carve (`engine/v2-water-bed.mjs`) ran only for
the ring adapter, after its 4 m ring had found the flat water. Inside the
frontier the ground under Skagern was therefore the laser's own water
surface — Markhöjdmodell does not penetrate water — at 69.34 m, under a sheet
the boot had re-measured up to 69.6 m: 0.26 m of "depth", which the water
shader reads as pale silt bottom showing through thin water. Beyond the
frontier the GPK1 terrain builder's carve (`terrainH`: 5.5 m over a 55 m
ramp) gave the lake its depth, which is why the far water was blue and the
near water was sand. Measured: ground 69.34 at (−400,−300), (−100,−300),
(200,−600), (500,−900); 64.09 beyond the window.

The fix carves the frontier's tiles **as they decode**, in
`loadPublishedGraphTerrainFrontier`, from the model's rings (there is no
flat-water raster to detect here) and the traced silt shallows (capped at
0.28 m, the legacy rule). It had to happen there and not after boot for a
reason that took a probe to find: **every frontier tile is encoded with its
own minimum height as its quantisation floor**, and over a lake that minimum
IS the lake — a carve clamped at q = 0 landed at 69.14 m, still only 0.48 m
under the sheet. `carveDecodedTerrainTile` therefore **re-floors** a lake
tile: lowers its offset to hold the deepest bed asked of it (plus 0.5 m),
shifts every finite sample by the same count (checked against the uint16
range and the nodata value), then carves against the new offset. The verified
bytes are never touched; the render resource is built from the carved copy so
the CPU sampler and the GPU texels agree. The profile is the legacy carve's
(0.15 m at the shore, 0.1 m per metre, 5.5 m maximum) so the bed is continuous
where the frontier hands over to the legacy MID: 63.80 inside, 63.84 outside.

Result on the same probe grid: bed 5.5 m deep 200 m off the shore, shoaling
to 2.2 m and 2.8 m near the banks, 85.3 ha carved, 770,753 samples in 32 tiles,
26 of them re-floored, 4,024 shallow cells; the Skagern sheet's mean vertex
depth went from 0.95 m to 2.33 m. The re-measured level also came down, from
69.6 to **69.34 m**: the 30th-percentile rule now samples carved shore cells,
and the sheet sits where the laser says the water is instead of a quarter
metre up the bank. The eleven ponds inside the window are carved the same
way (their re-measured levels dropped from +0.26 to +0.08–0.13 m over the
committed values).

### 18.2 The data: three polygons for one lake

`model.water` carried the OSM Skagern ring and the two break-geometry lake
arms at the same level, overlapping over 19,348 of the lake's 8 m cells. Three
sheets at 69.59/69.6 m z-fight — that was the sawtooth — and the break
polygons' straight clip edge at the item boundary (local x 1024.5) put a foam
line and a shallow-colour band across open water. Measured against the DTM,
the OSM ring also **over-reaches**: of the 12.3 ha inside the item that only
OSM called water, 7.4 ha stands 0.5–7 m above the lake, and a few cells at
the far north are the Gullspångsälven at 66.75 m below the outlet.

`ribbingsforsbuild/lake-union.mjs` unites them on a 2 m raster:

    water = breakGeometry
          | (osm & outside item 653_44)
          | (osm & inside the item & DTM within 0.35 m of 69.35)

so the laser shoreline is the lake's wherever the laser drew one, OSM fills
only what the break data cannot see, and land the OSM ring wrongly encloses is
refused. The boundary is traced from the cell lattice (each water cell's four
edges, right turn at saddles) and simplified with a tolerance that grows with
distance from the played ground (1 m within 300 m, 2.5 m to 1 km, 6 m to
2 km, 12 m beyond), which is the point budget the slimmed OSM ring had. The
result is **one ring of 1,879 points, 655.2 ha**, plus a 1 ha fragment at the
Skagersvik strait that laser-flat OSM water leaves disconnected. Gate in
`apply-surroundings.mjs`: every break-geometry shoreline vertex within 1.4 km
of the origin must lie within 3 m of the union at the median, 12 m at the
90th — measured 0.90 m / 7.44 m over 547 vertices. The two arms stay in the
model under `sourceWater.breakLakes` (a key the pack never carries) so the
script is idempotent; a rerun is byte-identical.

Browser gate: `tools/check-ribbingsfors-v2.mjs` now asserts one lake ring,
a bed ≥4.5 m under the sheet at (−100,−300), a bed that shoals toward the
shore, a sheet whose mean vertex depth exceeds 1.5 m, and the same carve on
the GPK1 path.

What is NOT changed: the +0.25 m clearance rule in the level re-measure is
still generic engine behaviour (it exists for uncarved beds and both v2
paths now carve); the far basin beyond the frontier still carves through the
legacy `terrainH`; and the two low islets stay drowned. A licensed
orthophoto or the neighbouring break-geometry items would let the far
shoreline be laser too (§13, blocker 3).

## 19. The played surfaces, read by rule off the imagery and the laser (2026-09-05)

§16 concluded that the played surfaces should not be hand-retraced, and that
stands: a hand trace at ±4 m would have degraded survey-grade centres. What
the same imagery DOES support is classification by rule, and a second look at
it showed why: the Esri z18 capture is leaf-off spring, on which every mown
surface is vivid green against dormant brown pasture, and each green shows as
a darker, finer patch inside a lighter collar. Measured (`cache/dev/calibrate.mjs`):
excess green 2G−R−B reads 98–118 at the nine surveyed green centres, p90 59 on
the rough 70–130 m off the course; the laser plane residual is 0.007–0.016 m
on the greens against a median 0.036 m on the rough. Two orthorectified
records, no registration step, and the only question each feature answers is
whether they agree at a place. `ribbingsforsbuild/trace-surfaces.mjs` writes
`surface-traces.json` and a review sheet per hole (`cache/review/hole-N.png`,
looked at); `apply-surface-traces.mjs` folds it in.

### 19.1 Greens — the collar-bounded patch around the survey point

A green is grown from its GPS centre on 0.5 m box-smoothed colour: excess
green within a drop of the green's own 4 m core and brightness under the core
plus a cap (the collar is brighter), opened, the component holding the centre,
holes filled. A green's approach can be exactly as green as its putting
surface, so the loosest reading leaks down the fairway and fails compactness,
while the tightest readings erode the green's own edge; the rule therefore
takes six readings from loose to tight and keeps the **largest that stays
compact** (180–800 m², solidity ≥ 0.85, centroid within 6 m of the survey
point). All nine pass. The centres stay the survey points.

| hole | m² | solidity | centroid shift m | reading | laser roughness m |
|---|---|---|---|---|---|
| 1 | 406 | 0.983 | 0.9 | D | 0.007 |
| 2 | 513 | 0.88 | 2.2 | B | 0.007 |
| 3 | 471 | 0.94 | 2.6 | D | 0.006 |
| 4 | 321 | 0.861 | 3.2 | B | 0.005 |
| 5 | 605 | 0.954 | 2.6 | B | 0.011 |
| 6 | 286 | 0.955 | 1.2 | E | 0.005 |
| 7 | 497 | 0.97 | 2.4 | B | 0.007 |
| 8 | 216 | 0.88 | 2.8 | B | 0.01 |
| 9 | 462 | 0.884 | 1.3 | E | 0.006 |

### 19.2 Tee decks and routing

A deck is laser-flat ground (5 × 5 m spread under 0.12 m) that is mown or
lies within 12 m of a card mark — the 8th's tees are flat to 6 cm under their
marks and dormant brown in this capture — 50–600 m², drawn as the oriented box
of its cells, not within 60 m of the hole's green and not on another hole's
mown ground. The reviewed DTM-bench control for the 9th's Gul tee
(`tee-controls.json`) is honoured as it stands.

The provisional routing (GolfTraxx seeds, §3) ran through woods on holes 5
and 6 and over pasture on 8, which is why 12 of 27 card marks read as rough.
The mown corridor IS the routing: a least-cost path over a 2 m grid from the
back tee (its measured deck where one exists, else the card mark) to the
surveyed green centre — cheapest down the middle of the hole's own mown
ground, dearer on another hole's turf, dear off the mown mask, prohibitive on
water — simplified to its bends. Ownership of mown ground and routing depend
on each other and are solved twice. Card marks stand at the card distance
from the green along the line and snap onto a deck within 25 m; two card tees
more than 25 m apart on the card may not share one deck. Where no deck fixes
the back tee the line slides to the card length as every build here does.

| hole | card back | traced line m | back tee | bends | marks |
|---|---|---|---|---|---|
| 1 | 350 | 349.7 | measured deck | 1 | 350 on deck, 343 on deck, 308 on deck |
| 2 | 175 | 159.3 | measured deck | 2 | 175 on deck, 168 on deck, 140 on deck |
| 3 | 362 | 362 | card slide | 2 | 362 at card, 330 at card, 280 on deck |
| 4 | 338 | 340.4 | measured deck | 3 | 338 on deck, 331 on deck, 277 on deck |
| 5 | 466 | 464.2 | measured deck | 4 | 466 on deck, 465 on deck, 411 at card |
| 6 | 387 | 387 | card slide | 3 | 387 at card, 334 at card, 276 on deck |
| 7 | 370 | 370 | card slide | 3 | 370 at card, 365 at card, 307 on deck |
| 8 | 175 | 175 | card slide | 0 | 175 at card, 135 on deck, 120 on deck |
| 9 | 502 | 502 | card slide | 5 | 502 at card, 480 on deck, 406 on deck |

| hole | tee | deck m² | box m | mown share | mark moved m |
|---|---|---|---|---|---|
| 1 | 350 | 211 | 20.2 × 10.5 | 0.86 | 0.3 |
| 1 | 343 | 173 | 16.6 × 10.4 | 1 | 5.3 |
| 1 | 308 | 66 | 11 × 6 | 1 | 18.1 |
| 2 | 175 | 424 | 28.1 × 15.1 | 0.91 | 18.4 |
| 2 | 168 | 421 | 28 × 15.1 | 0.88 | 11.4 |
| 2 | 140 | 189 | 17.1 × 11.1 | 1 | 17.1 |
| 3 | 280 | 670 | 35.4 × 18.9 | 0.58 | 6.7 |
| 4 | 338 | 635 | 44.9 × 14.1 | 0.96 | 2.4 |
| 4 | 331 | 259 | 25.1 × 10.3 | 0.98 | 4.3 |
| 4 | 277 | 188 | 19 × 9.9 | 1 | 22.9 |
| 5 | 466 | 348 | 22.9 × 15.2 | 0.39 | 4 |
| 5 | 465 | 343 | 22.3 × 15.4 | 0.39 | 3.5 |
| 6 | 276 | 138 | 14.4 × 9.6 | 1 | 21 |
| 7 | 307 | 149 | 15.2 × 9.8 | 1 | 5.3 |
| 8 | 135 | 184 | 18 × 10.2 | 0.17 | 6.3 |
| 8 | 120 | 86 | 13.9 × 6.2 | 0.34 | 4.1 |
| 9 | 480 | 24 | 6 × 4 | 1 | 0 |
| 9 | 406 | 87 | 12.6 × 6.9 | 1 | 9.1 |

A mark without a deck keeps its card point and the app synthesises a pad
there, as on every other course. `tee-road-clearance.test.mjs` now states
this contract: every measured deck clears every road ribbon; every mark is on
a deck or declared deckless by the trace; every line ends on the surveyed
green and starts at the back mark.

### 19.3 Fairways

The mown mask (excess green > 70, brightness 60–150) opened 1 m and closed
3 m, water, buildings and car parks removed, each cell assigned to the hole
whose traced line, green (−10 m) or tee mark (−8 m) is nearest within 60 m,
holes under 200 m² filled (bunkers and greens are drawn above). Where two
holes' turf is contiguous the boundary between them is a nearest-line split,
which is invisible in the render because both sides are fairway. The unmown
strip inside the 9th's dogleg and the copses in the 6th come out as the
holes in the rings they are.

### 19.4 Ditches, re-laid on the laser

Each satellite-traced ditch (§15.2) is walked vertex to vertex by least-cost
path along the black top-hat of the 1 m terrain (13 m closing) and kept where
the channel reads ≥ 0.10 m deep, gaps under 6 m bridged. The runs are the
open channel; the gaps are culverts — the green-1 ditch breaks under the
road and again under the approach, exactly where §15.2 put the pipes.

| ditch | traced m | laser m | open runs | mean depth m |
|---|---|---|---|---|
| eastern boundary ditch | 410 | 365 | 3 | 0.21 / 0.39 / 0.53 |
| green 1 ditch | 404 | 307 | 5 | 0.11 / 0.47 / 0.5 / 0.7 / 0.92 |
| hole 9 pond outlet | 23 | 18 | 1 | 0.2 |
| hole-4 pond connector | 22 | 20 | 1 | 0.53 |

The valley score sampled every metre along each traced route (across-depth
minus along-slope over eight directions) then finds the crossings the traces
missed, snapped and trimmed the same way:

| hole | m from green | mean depth m | valley score |
|---|---|---|---|
| 3 | 119 | 0.66 | 0.56 |
| 6 | 333 | 0.44 | 0.48 |

### 19.5 What this did not change, and what it cannot

Bunkers stay as §17 measured them; the water as §18 built it; the trees are
the published LiDAR generation. The routes are traced, not surveyed: a hole's
length is what its corridor measures, and the card's per-hole rows remain
provisional (§3). The shapes' residual error is the imagery's own
orthorectification plus the 0.5 m lattice, i.e. one to two metres — the
licensed orthophoto would halve it and settle the two dormant decks on 8.

One consequence for the app: the legacy CORE grid is `playB ± 150 m` snapped
to 36 m, and the traced routes end where the corridors end rather than at the
GolfTraxx seeds' far corners, so CORE shrank from 316 × 298 to 307 × 289 cells
(x −468…756, z −612…540) and the reviewed `legacyCoreCutout` contract in
`v2-ribbingsfors-config.mjs` was re-measured off the assertion's own "got"
line (85,183 of 88,723 base points omitted, was 90,520 of 94,168).


## 20. Three second opinions: the laser under the bunkers, a dated second capture, and the roofs (2026-09-05)

Everything in §17–§19 was measured from ONE orthoimage and ONE laser model,
each doing the job it is best at. This section asks each of them to check the
other's work, and asks a second, independently captured image to check both.
Nothing here is a new source: it is the same three records, cross-examined.

### 20.1 Every measured bunker stands over a laser dish

`ribbingsforsbuild/laser-bunkers.mjs` measures three things for each of the 18
sand-classified bunkers, none of which entered its placement:

- **dish** — the median height of a 1.5–5 m band outside the ring minus the
  median inside it;
- **shift** — the offset in ±8 m at which that dish is deepest (an optimum ON
  the search edge has not converged and is flagged as such);
- **top-hat** — the deepest black-top-hat cell (13 m closing) inside the ring,
  the ditch tracer's own instrument.

**All 18 stand over a hollow.** Sixteen read a dish at their sand position
(0.11–0.41 m, floors 0.16–0.76 m); the 3rd's greenside and the 5th's greenside
read slightly negative there and find their dish 5.1 m and 4.5 m away. That is
the answer to the question §17 could not ask: sand in the imagery over a dish
in the laser is what a bunker is, and this course has no exceptions.

**And the disagreement is the imagery's registration.** The median |shift| is
3.2 m, median (+2, −1) m — the same few metres the trace file states as its
own error. Where the search converged inside the box and the dish gained at
least 5 cm, the ring is re-centred onto it: **10 of 18 moved, by 1–5 m**. A
bunker IS its hollow; the sand centroid is a picture of it taken from orbit.

`apply-sat-shapes.mjs` now uses the laser position where one was measured and
**throws** if a sand patch ever reads `no dish` — the loud gate for the claim
this section makes.

The other direction is just as useful. The five guide-listed bunkers §17
dropped for want of sand were placed by the guide formula on the traced routes
and tested for a dish within ±12 m: four (the 1st at 193 m, the 5th's pair at
215 and 245 m, the 9th's at 18 m) find **neither sand nor a dish** — they are
not there, and the guide's own arithmetic put them nowhere in particular. Two
(the 8th's south greenside, the 9th's left at 72 m) sit near a 0.29–0.30 m
hollow but carry no sand; recorded, not adopted.

Finally, every hollow ≥ 0.30 m deep and 12–250 m² on open played ground that
no bunker, pond, ditch or road claims is listed — 36 of them, **none
sand-coloured**. They are grass hollows: the ground of a pasture course.

### 20.2 A second capture, four years and one season away

Esri Wayback keeps every World Imagery release since 2014. Hashing the
course-centre z18 tile across all 196 of them finds **three distinct images
over Ribbingsfors**, and Esri's own metadata layer dates them: the live layer
and the 2024/2025 releases carry one **2023-04-28** WorldView-2 capture
(leaf-off — the image everything was traced from), and release 57965
(2023-02-23) carries a **2019-06-02** WorldView-2 capture. Leaf-on, June, four
years earlier, and independently orthorectified.

`ribbingsforsbuild/wayback-greens.mjs` runs both checks it allows.

**The greens: refused, and the refusal is the finding.** The grower of
`green-grower.mjs` — split out of `trace-surfaces.mjs` for this, so the rule
run on the second image is literally the rule that made the traces — refuses
all nine. Every reading runs to 2,000–4,000 m² against traced outlines of
216–605 m². That is not registration: in June the approach and the fairway are
as green as the putting surface, and the bright collar the April capture draws
around every green is simply absent. **This course's greens are traceable in
leaf-off imagery and not in leaf-on**, and the six readings per hole are kept
in `wayback-greens.json` so nobody spends the afternoon again.

**The bunkers: 16 of 18 in both captures, a median 2.4 m apart.** Sand is sand
in any season, so `detect-sand`'s own rule was integrated over a 14 m disc at
each measured bunker in each image. Sixteen carry sand in both; the centroids
disagree by a median **2.4 m**, worst 5.4 m. That is an estimate of the
imagery's positional accuracy that no single capture can produce, and it lands
where the laser said it would (§20.1's 3.2 m median shift). Two read no sand
in 2019 — the 5th's greenside and the 8th's greenside, which are precisely the
two the laser found least convincing (the weakest dish, and §17's only
`medium` confidence). Either they were built after 2019 or they are shallow
and grassed at the edges; both readings are recorded and neither is resolved.

### 20.3 The clubhouse was on the lawn

The clubhouse footprint was a 30 × 10 m rectangle laid on the public POI's own
bearing, explicitly provisional. Measured against the imagery — everything
within 30 m of the POI whose excess green is at most 25, which excludes grass
at 60–110 and the gravel track at 40–90 — that ground is one 419 m² block, and
the block is **two buildings and their yard**: a pale roof running WNW–ESE from
about (471, −459) to (487, −454), and a dark roof on the same alignment 8 m
north of it. The old rectangle lay across both and out over the lawn, 8.5 m
from the block's centre and 63° across its axis.

Both footprints now live in `surroundings-traces.json` (the clubhouse as the
pale-roofed building, the dark one as `ribbingsfors-clubhouse-annex`) and
`apply-surroundings.mjs` replaces the placeholder with them — the same way it
already replaces `build-course.mjs`'s provisional driving range, and for the
same reason: that file needs the acquisition caches to run, so it must not be
the only place a measured number lives. The rectangles are read off the roofs
at 0.31 m/px, so the DIMENSIONS carry a metre or two of edge error; the
positions and the alignment are measured.

**The greenkeeping yard could not be re-measured, and that is a fact about the
imagery.** `trace-buildings.mjs` classifies roofs the way the tree-cover work
classifies turf — low excess green, mid-tone or dark, and SMOOTH at metre
scale — and it finds the yard's sheet roofs at excess green 16 and its gravel
hardstanding at 14–17. There is no separation to be had: the components it
accepts there are the yard surface, not its buildings (one runs to 6,751 m²).
The three sheds keep their by-eye trace and its stated ±8 m. A licensed
orthophoto, or any capture with a shadow long enough to measure, settles it.

### 20.4 Six more ditches the traces never saw

While the top-hat was loaded, the same rule that re-laid the traced ditches
(§19.4) was run over the whole played ground: elongated top-hat components
≥ 0.25 m deep, ≥ 40 m long unless they reach a water ring, clear of the roads
and of the ditches already drawn. Six survive review — two draining to Skagern
below the 9th, two crossing the 8th, one between the two ponds by the 6th, and
one along the 4th. They ship as `streams` of the same kind, with their depth
and length in the provenance string; the review sheets are in the gitignored
cache.

## 21. The practice ground and the manor farm, measured (2026-09-05)

Everything played was measured by §17–§20; everything *beside* the play was
still read by eye at ±8 m, and it showed. This section closes that.

### 21.1 The range field

The eye-traced range ring lay **31.8 m** from the field it stood for and
claimed 10,166 m² against a real 6,541 — half of it on mown turf. The field
itself is the least ambiguous thing in the whole capture: a driving range is
not mown to fairway height, so in the 2023-04-28 leaf-off image it is dormant
ground at **excess green 15–17 and brightness 121**, against **53–109 and
89–103** for every turf beside it. That is a wider separation than any other
surface pair on this course — wider than sand against grass. Classified per
pixel, largest component, holes filled, outline simplified to 2 m: **6,541 m²
over x 387–435, z −386…−226**, a 48 × 160 m strip between the 1st and the 9th,
exactly where the club's own overview prints DRIVING RANGE.

**The bays are at the far end from the clubhouse, and the laser says so.** The
engine's generic rule — "the tee is the end of the range you walk to from the
clubhouse", the rule that replaced six pages' hardcoded coordinate — gives the
NORTH end here. A tee line is a built, level platform, so each end was searched
for laser-flat benches (the 5 × 5 m spread the tee-deck rule uses): the south
end carries **1,362 of 4,324 cells flat to 0.12 m against the north end's
223**, and the largest mown bench among them is 262 m² at (384.9, −226.2). The
club's own range photographs put the bays at the south end too, so two records
that never entered each other agree. The model therefore carries
`scenery.rangeTee`, and `main.js` prefers a course's measured tee over its own
rule — the same shape as `scenery.practiceGreens` at Johannesberg.

Two things the imagery does NOT show: any tee line at 0.31 m/px (the bench is a
laser finding, not a picture), and any tree inside the field — so the traced
"mature oak standing in the field" is dropped rather than moved.

### 21.2 The practice greens: one measured, one refused

Both were synthetic circles from an eye trace. The test is what a built putting
green has and pasture does not — an interior greener than its own 3–8 m collar,
and laser flatness — with the **nine surveyed greens measured the same way as
the calibration**: contrast 3–45 (median 18), spread 0.11–0.37 m (median 0.18).

| | ExG inside | collar | contrast | laser spread | grower | verdict |
|---|---|---|---|---|---|---|
| beside the clubhouse | 109 | 78 | **31** | 0.17 m | accepts 604 m², solidity 0.965 | measured, kept |
| south-east of it | 54 | 47 | **7** | 0.37 m | refuses | **dropped** |

The second circle sits on a track, below every surveyed green on both tests. A
scan of the whole clubhouse quarter for green-like discs (contrast ≥ 18,
ExG ≥ 95, spread ≤ 0.37) finds no second green anywhere near it, so it is
dropped rather than moved — the same treatment as the five guide bunkers that
resolved to no sand (§17).

### 21.3 The manor farm: colour and shape are not enough, a hard edge is

The manor precinct rendered empty: OSM has no footprints there and the model
carried none. The roof rule of §20.3 (low excess green, mid-tone or dark,
smooth) proposed seven components — and **four of them were patches of dry
grass between the trees**. What separates a roof from dry grass is the
boundary: the median |brightness step| across a 3 m span at the box edge reads
**19–25 on real roofs and 6–11 on every grass patch**, with the measured
clubhouse scoring 25 as the positive control.

And a component found by colour is only ever HALF a roof, because the shaded
pitch merges with the building's own cast shadow. Each accepted box is
therefore grown — width, depth and centre searched — to the rectangle where
that edge step peaks (44–76 against the seed's 19–26). Six farm buildings are
adopted, 153–701 m², all in the estate group 230–280 m east of the clubhouse.

The ortho leans a roof away from nadir (the Johannesberg finding), so these
outlines are the roof AS SEEN and overstate the footprint; the provenance says
so. The greenkeeping yard is still refused for the reason §20.3 gives — its
sheet roofs read excess green 16 against gravel at 14–17 — and its three sheds
keep their by-eye trace.
