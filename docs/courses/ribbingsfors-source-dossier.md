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
