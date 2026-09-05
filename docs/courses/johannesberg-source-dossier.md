# Johannesbergs Golf — source dossier

> Compiled 2026-09-04, when the ground was taken to Lantmäteriet 1 m terrain.
> Evidence labels follow the v2 runbook: **DERIVED** is printed by a compiler,
> **REVIEWED** is a human decision with its rationale, **MEASURED** carries its
> own measurement, **INHERITED** is copied from an existing artifact.

The per-hole text and the card were researched on 2026-09-02 and live in
[`johannesbergbuild/card.json`](../../johannesbergbuild/card.json),
[`card-9.json`](../../johannesbergbuild/card-9.json) and
[`guide-notes.json`](../../johannesbergbuild/guide-notes.json). This dossier does
not restate them; it records identity, the spatial frame, and the terrain
provenance that the 2026-09-04 v2 publication established.

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Club/operator | Thanda Johannesbergs Slott AB | club contact page, checked 2026-09-04 |
| Site | <https://johannesbergsgolf.se/> (the estate site <https://www.johannesbergsslott.se/johannesbergs-golf.html> only links to it) | checked 2026-09-04 |
| Address | Johannesbergs Slott 1, 762 95 Gottröra | club contact page |
| Contact | golf@johannesbergsgolf.se, +46 (0)8 124 377 63 | club contact page |
| Architect | Donald Steel, both courses | club "Våra banor" page |
| Opened | 1991 | card.json note |
| Holes on the estate | 27: the 18-hole championship course ("Donald Steel-banan") and a full-length Pay & Play nine | club "Våra banor" page |
| 18-hole card | Par 72 (36/36); five tees Vit/Gul/Blå/Röd/Orange; 6222 / 5759 / 5279 / 4914 / 4124 m | club 2026 hole plans |
| Nine-hole card | Par 34; two tees Gul/Röd; 2259 / 1909 m | see `card-9.json` |
| Competition history | Nordea Tour Future Series 2016; Swedish Women's Tour 2017–18 and 2020 | club "Våra banor" page |

Two identity traps already recorded elsewhere and worth repeating:

- **The big white turreted manor is the HOTEL, not the clubhouse.** The
  clubhouse is the long low Falu-red range west of it. The manor carries no
  golf name, so it correctly falls to the generic buildings pass.
- **The extract also contains Nifsta GK, 2.4 km west.** `parse-osm` takes the
  `leisure=golf_course` polygon containing ORIGIN for exactly this reason.

## 2. Spatial frame

### 2.1 The legacy GPK1 frame — INHERITED

`johannesbergbuild/lib.mjs` and the pack's own GEO block agree:

```text
ORIGIN            59.72733 N, 18.19202 E
metresPerLatitude 111320
metresPerLongitude 111320 * cos(ORIGIN.lat) = 56118.1628…  (header rounds to 56118.16)
frame             local metres about ORIGIN; north -z, east +x
seaLevel          12.5 (a nominal inland floor, not a sea)
```

### 2.2 The canonical EPSG:5845 frame — DERIVED

The pack origin projected to SWEREF 99 TM, reproduced two ways that never
entered each other — PROJ `cs2cs` in the committed migration's
`candidateOrigin`, and the repository's own Krüger series in
[`chmv2/projection.mjs`](../../packages/course-geo/chmv2/projection.mjs). They
agree to a millimetre:

```text
legacy origin      E 679460.879  N 6625364.187
published window   E 678403.5 … 680451.5, N 6624276.5 … 6626324.5  (2048 × 2048 m)
frame origin       E 679427.5  N 6625300.5  h 9.88 m RH 2000
frame fingerprint  3b6db48a9134351129c33ee0e167aa1f5a295f9724f1e3a42ab797a2153209d4
```

`originStatus` is still `pending-control-approval`: no independent control
survey exists, so this is a migration frame, not an approved survey origin.

### 2.3 The bridge into the legacy world

The grid's north is **2.757° off** the pack's true north here — 48 m at a
kilometre — and the frame metre differs by a few parts in ten thousand. Both
terms are DERIVED from the two frames' declared constants and are exact:

```text
rotation 2.757472°   scaleX 0.997510   scaleZ 0.999219   pointScale 0.999995
```

The vertical term cannot be derived and is **MEASURED**: see §3.3.

## 3. Terrain provenance

### 3.1 Source — Lantmäteriet Markhöjdmodell, 1 m

The course straddles E 680000, so **two** 10 km items supply it:

| Item | Captured | Data checksum (SHA-256) | Bytes |
|---|---|---|---|
| `662_67` | 2021-04-17 | `903595f07858f02a9ed3162aedbb15d239436fecf76831a56161353eb2402ff2` | 316 420 657 |
| `662_68` | 2023-05-16 (range 2021-04-17 … 2025-06-13) | `09e2d304f7d8778c9c1e1a099d4ab0733860a218ebaccfded2e167a6675a2632` | 287 007 740 |

Read at **overview factor 1**, so every published sample is a source pixel
copied exactly — no resampling is involved. Acquisition evidence, with ETags
and the exact pixel window, is in
[`acquisition/terrain-window.json`](../../geo_data/course-v2/johannesberg/acquisition/terrain-window.json).
STAC discovery (DTM, Laserdata Skog and orto-o2-2025 each covering the AOI
100 %) is in
[`acquisition/d2-discovery.json`](../../geo_data/course-v2/johannesberg/acquisition/d2-discovery.json).

### 3.2 The two vintages leave no seam — MEASURED

A four-year capture gap meeting inside a golf course is exactly the kind of
thing that shows up as a straight line on the ground, so it was measured rather
than assumed. Across the boundary at E 680000, the first difference between
adjacent sample columns over all 2049 rows:

| Columns | mean \|Δh\| | median | max |
|---|---|---|---|
| **across the seam** | **0.075 m** | 0.048 m | 0.579 m |
| control, 4 columns west | 0.082 m | 0.051 m | 0.759 m |
| control, 5 columns east | 0.085 m | 0.057 m | 0.680 m |

The step across the item boundary is **smaller** than the terrain's own local
roughness either side of it. There is nothing to reconcile.

### 3.3 The legacy vertical datum — MEASURED, and read it carefully

`tools/measure-vertical-datum.mjs --ground johannesberg`, written for this work
and now serving other grounds too. Legacy Terrarium minus published RH 2000,
sampled on mown ground (greens, fairways, tee pads) with every sample inside a
water ring discarded:

```text
median 5.6676 m over 38,543 samples   MAD 1.7211 m
by class: tees 4.55 (n 1,787) · fairways 5.70 (n 34,741) · greens 6.06 (n 2,015)
whole overlap on a 16 m grid: 4.83 m  (corroboration; it did not enter the number)
```

**The spread is not misregistration.** A ±40 m rigid-shift sweep of the legacy
sample point, run against four bridge variants — the derived bridge, its
mirror, the reversed rotation and no rotation at all — moves the MAD by under
0.25 m in every case and puts the "best" shift at the sweep edge. A flat
objective like that means the legacy field carries too little terrain detail to
register against a laser DTM at all. So 1.72 m is a coarse global model
genuinely disagreeing with a laser DTM about the shape of gently rolling
Uppland parkland, and the 5.67 m figure is **a datum step, not a claim that the
two surfaces agree anywhere to a metre**.

Puttom's offset is 23.6263 m and Veckefjärden's 20.9924 m. Copying either here
would be a 15–18 m error. Re-measure per ground; the geoid runs from roughly 17
to 37 m across Sweden.

### 3.4 What is published

85 tiles over 4 levels; **64 of them are the 1 m level-zero frontier**
(4.38 MiB encoded, inside the loader's reviewed 8 MiB budget). RH 2000 range
9.88–44.87 m, every one of 4,198,401 samples finite.

The frontier replaces 219,736 of the legacy CORE's 261,280 base points (84.1 %;
it was 180,532 of 215,272 until 2026-09-05, when the nine's greens entered the
eighteen's scenery and CORE grew west from x −612 to −936 — §7).
The 2048 m window is centred on the played ground of **both** courses, which
keeps every hole corridor 110–231 m clear of its edge. The driving range's far
tip (it runs 213 m beyond the last hole) falls outside and renders from legacy
MID — a REVIEWED trade-off: covering it would need either 128 level-zero tiles
(~8.8 MiB, past the frontier budget) or a re-centring that would cut the
southern holes' margin from 110 m to 36 m. Play was chosen over the practice
ground. The practice green is inside the frontier.

## 4. Vegetation — measured, and what the measurement is worth

Laserdata Skog covers the AOI 100 % as **one** campaign, `21C039`, ALS80-HP,
flown **2021-04-17 leaf-off**, 1.2 pulses/m² declared and 2.5–2.6 all
returns/m² measured. Items `21c039-662_67` and `21c039-662_68` meet at E 680000
inside the course, but they are the same campaign, so unlike Puttom there is no
vintage seam to reconcile. `662_67` is a 5 km **half-tile** whose COPC cube does
not span its header extent — the documented reason node selection must follow
the extent rule and not the cube.

Published: **2,417 measured individual crowns** (machine-reviewed, v1 rules) and
a **64-tile 4 m stand field** (260,786 measured cells, 47,397 closed canopy).
Every tree base samples the published terrain to within 1 mm, and there are
**zero legacy trees left inside the coverage** — one population, not two.

**The canopy build independently validates the terrain.** The point cloud's own
class-2/9 ground minus the published DTM has a median of **0.00 m on every one
of the 64 tiles**.

### The forest got thinner, and that is the correction

`tools/audit-canopy-sources.mjs` (written for this, generic over grounds)
compares three independent statements inside the published window:

| source | canopy fraction |
|---|---|
| Lantmäteriet laser, leaf-off | **17.6 %** |
| Meta/WRI CHMv2, optical ML (tile `1200312031`) | 27.9 % |
| the legacy Esri raster the GPK1 planter obeyed | 43.9 % |

A leaf-off scan under-detects deciduous crowns, so the drop had to be tested
rather than accepted. The discriminating statistic is not the fraction but the
**laser height where the satellite claims canopy and the laser does not**
(106,626 cells): median **0.00 m**, p75 0.00 m, p90 0.36 m. A crown that a scan
merely thinned still returns branch height; a distribution piled at zero is open
ground. So the legacy raster was over-detecting and planting trees on ground
that is genuinely open — which matches the old render standing pines on mown
fairway.

Read CHMv2 as calibration, not truth: it compresses height and smears crowns
outward, so it reads high. It brackets the answer (17.6 % … 27.9 %) rather than
settling it, and its 1.6× margin over the laser is consistent with **some**
real deciduous under-detection. The honest statement is that the published
vegetation is conservative and much closer to truth than what it replaced —
not that it is complete.

## 5. Banguide and media

- **Hole plans, 2026**: `https://johannesbergsgolf.se/wp-content/uploads/2026/03/Bana-{1..18}-731x1030.jpg`,
  plus a `Banguide` overview. Confirmed present 2026-09-04. Their SPELTIPS
  paragraph is the club's only per-hole text and is kept verbatim under `club`
  in `guide-notes.json`.
- **The card has two versions in circulation.** The 2026 plans, and the older
  **rated** lengths (vit 6234, röd 4962, orange 4085) that every published
  CR/slope figure is keyed to. They reconcile exactly as a re-teeing: vit −1 on
  hole 9, −11 on hole 16, and röd/orange merged onto one pad on 18. The 2026
  card is used because geometry must match where the pads are today.
- **No slope or course rating is published by the club.** What circulates comes
  from aggregators keyed to the superseded lengths and is contradicted on two
  tees by a third source. `card.json`'s `slope` block records the conflict and
  rates it LOW-to-MEDIUM confidence. Do not publish a rating without the club
  or the SGF/GIT register.
- **Photo rights.** Reference photographs stay in the gitignored cache and are
  never committed — they are the club's copyright and some contain identifiable
  people.

## 6. Open items

| Item | State |
|---|---|
| Canonical origin | `pending-control-approval`; no independent control survey |
| Played surfaces | satellite traces routed by the 2026 banguide, `prov:"synth"`/trace — not surveyed, so `surfacePolicy` stays `legacy-ground-atlas` |
| Nine-hole course (`johannesberg-9`) | shares this ground and this terrain window; published as a v2 course on 2026-09-05 (`rebind-course-fallback.mjs --add-slug`, one ground manifest for both courses) with its own measured legacy CORE cutout. Its greens and tees did not enter the vegetation exclusions (no ring spec, so only the eighteen's model was merged) |
| Vegetation | published: 2,417 measured crowns + a 64-tile stand field. Leaf-off, so conservative on deciduous; see §4 |
| Ortho / Topografi 10 | discovered and covered, not acquired; no product terms approved for redistribution |
| Hole 12 | the tee end is under spruce in every image; the card slide resolves it to within 26 m of the banguide's own disc. See CLAUDE.md before re-tracing |
| The nine's shapes | three greens (2, 7, 8) measured off the tiles (`prov:"sat"`), four more (3, 4, 5, 6) and one bunker read off the 1 m laser hillshade (`prov:"laser"`, §7.9–7.10); two greens (1, 9), every fairway and every tee pad remain synthesised. A dated, leafed-on ortho would finish the fairways |
| Hole 1's two bunkers | the trace puts them 12–30 m short and WEST of the green centre; the club's Bana-1 plan draws them at the green's LEFT edge, which for a hole playing south is east. Same count, ~20 m apart; not resolved at 0.3 m/px — see §7.2 |
| The felled knoll north of the nine | OSM forest; the imagery shows it clear-felled to scattered seed pines; the 2021 leaf-off LiDAR predates the felling, so the v2 vegetation may still stand a full forest on it. Carried as a `surround.clearfells` ring with that caveat |

## 7. The course, feature by feature (2026-09-05)

A second pass over the whole property, made for one question: is everything the
ground carries in the model, and does each thing come from a source that can be
named? Sources: the same Esri z18 tiles the holes were traced from (an early-spring
leaf-off capture, ~0.30 m/px, read on bare `SAT_PLAIN=1` crops at 90–260 m
upscaled to 900 px, off a labelled metre grid, so a coordinate is good to about
±3 m), the club's eighteen 2026 hole plans, and the OSM extract re-fetched on
2026-09-05 (**unchanged since August: OSM still maps two greens, no bunker, no
parking, no cart path here**). What the tiles show and OSM lacks is in
[`johannesbergbuild/sat-traces.json`](../../johannesbergbuild/sat-traces.json),
which `reconcile.mjs` fuses with `prov:"trace"`; each entry carries its own
confidence and the reading it was made from.

### 7.1 Counts, before and after

| feature | before | after | source of the difference |
|---|---|---|---|
| bunkers on the eighteen | 27 | 27 | +3 from the plans (the 7th's greenside, the 13th's big left-front, the 11th's right), −3 refused where the plan draws none AND the laser DTM shows no pit (17th, 16th's fairway, 18th's rock) — §7.10 |
| water bodies | 11 | 12 | the reed pond west of the 18th's approach, 1,565 m², level 14.3 m |
| ditches/streams | 4 | 5 | the ditch that crosses the 18th fairway between its two ponds |
| buildings | 305 | 307 | a ~10 m slender structure by the old stable; the range's ball shelter |
| parking lots | 0 | 3 | the manor forecourt (asphalt, ~22 × 88 m), the golfers' gravel car park (~30 × 42 m, 12 cars in the image), the clubhouse apron |
| tracks | 31 | 32 | the west farm/service track: pasture fence → heath → 11th tee, 830 m |
| cart paths | 4 | 10 | six walking lines, two of them crossing water (18th causeway, 17→18 bridge) and one the 3rd's bridge |
| sand rings | 0 | 2 | the sand/gravel pit south of the works yard; the topdressing heap |
| rock | 0 | 1 | "berget" on the 18th |
| wetland | 2 | 3 | the marshy field corner north of the 4th |
| clear-fells | 0 | 3 | east of the 7th green (~300 × 160 m); south-east beyond it; the felled knoll north of the nine |
| works yard | none | one | the greenkeepers' compound around the barn and grey hall |
| OB stakes | 0 | 29 in 2 runs | the club's Bana-18 and Bana-2 plans draw them |
| range tee line | none | 10–11 bays | the row of dividers on the tiles; **no net** — the field is open |
| practice bunker | none | one | between the tee line and the car park |
| scenery from the nine | none | 9 greens, 6 fairway rings, 18 tee pads | `johannesberg9build/course-model.json`, carried symmetrically |

### 7.2 The holes — what the plans and the tiles agree on

Every hole's bunker count was compared against its plan; twelve were also checked
on bare 160 m green crops. The card and the drawn lengths are the gates already in
`check3d` and are not restated.

| hole | par | m | bunkers | water in play | notes |
|---|---|---|---|---|---|
| 1 | 4 | 273 | 2 | pond right at 81–106 m (w539915578) | bunkers: count agrees with the plan, side does not — see §6 |
| 2 | 4 | 344 | 1 | two ponds the approach threads between; OB stakes left (east) | plays SOUTH; the plan's left is world east |
| 3 | 5 | 492 | 2 | the long pond; the bridge at (325, −203) is "bron" of the SPELTIPS | two greenside bunkers confirmed on the tiles |
| 4 | 4 | 431 | 4 | — | two fairway, two greenside, all on the tiles |
| 5 | 4 | 393 | 1 | — | one left-front bunker; a gravel waste area beside the fairway at 150 m |
| 6 | 3 | 190 | 2 | — | "dold svacka" — the hollow between the copse and the green |
| 7 | 5 | 469 | **1** | — | **added**: the plan's one greenside bunker, far-left (south-east) corner, in tree shadow on the tiles |
| 8 | 4 | 355 | 2 | — | fairway bunker at 240 m and left-front greenside, both on the tiles |
| 9 | 3 | 172 | 1 | — | raised green, one right-front bunker |
| 10 | 4 | 411 | 1 | — | drops 16 m tee to green, the biggest fall on the course |
| 11 | 4 | 344 | **2** | pond left of the tees (w539915586) | angled green; the plan's right bunker **added** by registration (the same registration lands the plan's left one within 4 m of the traced one) |
| 12 | 4 | 374 | 1 | — | over the copse; one left greenside bunker; the bell |
| 13 | 3 | 154 | **1** | — | **added**: the ~20 × 18 m left-front bunker with a juniper clump in its NW lobe; the kiosk stands 40 m behind the green |
| 14 | 4 | 355 | 0 | the small dark hollow right of the fairway at 46 m | the plan shows no bunker; the green is a mounded plateau |
| 15 | 4 | 381 | 2 | — | "spikrakt"; two greenside bunkers |
| 16 | 5 | 441 | **3** | — | over the pasture; three greenside bunkers as the plan draws; the traced fourth, 100 m short, refused (no plan, no pit) |
| 17 | 3 | 168 | **0** | pond right of the green (w539915585) | "grässlänten ner mot vattnet"; the traced bunker refused (the plan draws none, the laser shows no pit) |
| 18 | 5 | 475 | **1** | ponds either side at 190 m, the crossing ditch, OB left; "berget" at 130–190 m short of the green | the second traced bunker (−196, −409) was the pale patch on the rock: not on the plan, no pit in the laser — refused |

### 7.3 The clubhouse hub

- **Buildings**: the manor complex is fully footprinted in OSM (the hotel, its two
  wings, Karolinerhuset, the two villas); the clubhouse (`klubbhus`, w296165896,
  35 × 25 m, Falu red under orange-red tile) is the long low range west of it, with
  a small red shed at its south-east corner (w296165897). The old stable
  (w296165892, 63 × 42 m) stands east of the practice green. Two things OSM has not
  got: a slender ~10 m structure on the open ground south of the stable at
  (−50, −752), read from a 17 m shadow where the trees throw 12 (use unknown — a
  small tower or chimney; the height is inferred), and the range's ball shelter.
- **Parking**: the manor forecourt is a wide asphalt lot with marked bays along the
  access road, cars along its east edge in the image; the golfers' gravel car park
  sits between that road and the practice green, two rows of cars; the clubhouse
  apron east of the clubhouse holds three vehicles. All three are new to the model.
- **Practice ground**: the putting green (övningsgreen, 660 m², already traced), the
  practice bunker north-west of it, and the range: a mown field of 3.0 ha hit
  WEST from a tee line along its east edge — 10–11 bays ~5 m apart on a pale
  hardstanding strip, the range hut (OSM w378922988) at its north end and the ball
  shelter at its south end. There is **no safety net** on the tiles: the field is
  open ground with the felled knoll behind it, so `nets` is empty on purpose.
- **The greenkeepers' yard** east of the hub: the black-roofed barn (w296165907,
  61 × 26 m), the grey hall (w296165889), stored material and white bags along the
  north edge, a topdressing heap beside the barn, and a sand/gravel pit 100 m
  south with raw excavation faces (~60 × 45 m). A large rectangular fenced
  paddock west of the hall (x −16..135, z −718..−651) is left as it reads — grazed
  ground, not yard.

### 7.4 Water, ditches and bridges

Twelve water bodies: Uttran (61.6 ha, the big lake north-east — the course never
touches it), Hävsjön and Rotsjön far outside, seven OSM ponds on the course, the
long OSM ring w539915580 that is really three things — the west pond of the
18th, the brown canal along the farmland edge, and the ditch running south along
the pasture to the 17th — and the reed pond added here. Four OSM waterways plus
the added ditch across the 18th fairway. Three crossings are now paths, so the
engine's generic footbridge stands where a path crosses water: the 18th's
causeway at (−197, −580), the 17→18 bridge over the west ditch at (−175, −359),
and the 3rd's bridge. A fourth culvert links the two reed ponds at (−228, −606)
and is not modelled — its direction could not be read.

### 7.5 Roads, tracks and paths

OSM carries the public roads (Uppsalavägen 1.4 km north, the Johannesberg access
road from it, Stora Åkerbyvägen through Gottröra to the south-west), 31 tracks
and 4 paths — most of the hub's service roads are among the tracks. Added: the
830 m west track along the pasture fence and across the heath (a pale gravel
line on every crop), and six cart paths. Cart paths on the corridors themselves
were NOT traced: the fairways are mown to the tee and the golfers walk the turf.

### 7.6 The land around

- **Farmland** (63 OSM polygons) on three sides: the huge field north of the 2nd
  and 3rd with its rock-islet copses, the pasture west of the 16th ("kohagen" of
  the SPELTIPS), the fields of Gottröra. A marshy triangle at the corner of the
  north field where two farm tracks meet is added as wetland.
- **The heath** ("heden", 14th SPELTIPS): the interior between holes 14, 15, 16
  and 6 is dry pale grassland over rock, with junipers and scattered pines and
  bare-rock patches. It is rough in the model, and the tree-cover raster gives it
  its scattered trees; no polygon describes it and none is needed.
- **Forest**: nine OSM forest polygons and one wood, dense spruce east and south.
  The LiDAR generation (§4) supplies the trees on the v2 ground. Two clear-fells
  east and south-east of the 7th are new; the felled knoll north of the nine is
  the third, with the caveat in §6.
- **Rock**: the 18th's "berg" — a bare grey outcrop with pines at (−180, −455), east
  of the fairway. It is data (`vegetation.rock`); the engine tints rock only by
  slope, so it does not yet render as rock.
- **Villages and farms**: Gottröra / Stora Åkerby south-west with its OSM houses;
  a horse-training oval at (−700, 310); the homestead in the forest at (900, 200);
  84 far buildings.

### 7.7 What the club's plans add that the tiles cannot

The 2026 plans carry fairway distance markers at **200 (white), 150 (yellow), 125
(blue) and 100 m (red)** to the green's centre and flag colours for pin position
(red short, yellow middle, white long) — a 125 m blue marker the engine's plate
set does not know. Both are recorded here and not modelled.

### 7.8 Method notes worth keeping

- **Which way a hole plays decides what "left" means.** Holes 1, 2 and 7 play
  SOUTH (z increasing), so the plan's left is world east. The first reading of
  the 2nd's OB stakes put them on the wrong side of the hole for that reason.
- **A plan registered on two anchors locates a bunker to ~15 m; the tiles to ~3.**
  The 13th's bunker came out 30 m off by registration and exact on the tiles;
  the 7th's is in tree shadow, so registration is all there is and it says so.
- **Rectangular pale patches are as likely tee pads as bunkers** at 0.3 m/px in a
  leaf-off image where dormant turf is beige. The 1st's two "bunkers" are the
  case in point.
- **The imagery's date is unknown and it matters twice**: the felled knoll (after
  the 2021 LiDAR) and the reed pond (which OSM never had) both depend on it.

### 7.9 The nine — measured where the tiles allow, and why that is only a third of it

`johannesbergbuild/trace-nine.mjs` classifies the z18 tiles rather than reading
them by eye: ExG (2G−R−B), brightness and saturation thresholds sampled on the
eighteen's already-traced greens, fairways, bunkers and rough
(`cache/sample.mjs`), connected components, an outer pixel contour simplified to
0.6 m, and ACCEPTANCE BY RULE — a green is a compact disc (Polsby–Popper ≥ 0.6)
of 200–600 m² within 20 m of the routed end; a bunker is 15–120 m² of sand
within 60 m of an accepted green or 45 m of the routed end, not at a tee and not
within 20 m of anything the eighteen's model calls gravel or a building. Every
candidate stays in `nine-sat-shapes.json` with `accepted` and the numbers that
decided it; `tools/build-nine.mjs` adopts only the accepted ones and re-ends the
route on the measured green centre before the card slide, so every length still
measures the card.

| hole | result | numbers |
|---|---|---|
| 2 | green ACCEPTED | 418 m², 13.3 m from the routed end, compactness 0.81 — the peninsula green in the pond, unmistakable on the zoom crop |
| 7 | green ACCEPTED | 236 m², 12.2 m, compactness 0.63 — the round green by the pond's south arm |
| 8 | green ACCEPTED | 331 m², 9.8 m, compactness 0.87 — the round green at the lake's west shore |
| 5 | green refused; one bunker accepted | the routed end lands in a copse; the only vivid patch is a 0.56 sliver. The 22 m² bunker at (−295, −786) is plain sand on the tiles |
| 9 | green refused; one bunker accepted | the vivid component (1,226 m²) is green + fairway, compactness 0.17. The 32 m² bunker at (−271, −763) is the sand the eighteen's trace had assigned to its 18th |
| 1, 3, 4, 6 | nothing found | no vivid component within 20 m of the routed end |

**Why the rest is not traced.** The nine's putting surfaces read ExG 90–110 on
this capture against 120–130 on the eighteen's — cut later, or less irrigated —
and six of them do not separate from their surrounds at all; the fairways read
ExG 32–39 against 24 for the rough, a difference the classifier over-segments
into corridors twice their real width. The classifier's fairway rings are in the
file as `accepted:false` evidence. This is the leaf-off imagery's limit, not the
method's: a leafed-on, dated orthophoto (Lantmäteriet's `orto-o2-2025`, already
discovered covering the AOI) would run through the same tool and finish the nine.

### 7.10 Every ring against the 1 m laser terrain

`johannesbergbuild/terrain-check.mjs` decodes the 64 published one-metre tiles
through the loader's own reader, assembles the 2048 m window in EPSG:3006, and
measures every ring of both courses — taken from the committed cs2cs migration,
so the frame conversion is not this tool's — against a surface that never entered
any trace. Three shapes are looked for: a green or tee pad is a **plateau** (mean
inside minus a 4–10 m collar, and a small std inside), a bunker is a **pit** (a
2–6 m rim minus the inside), and open water is **flat** in a laser DTM (std
inside, banks rising over 3–10 m). For each feature the tool also finds the
shift, in 1 m steps to ±8 m, that maximises its signal; only maxima inside the
search window count, and their median is the horizontal offset between the traces
and the laser terrain. `terrain-check.json` holds every number;
`cache/terrain-check/greens-sheet.png` is the 27 greens at 4× on the hillshade.

| set | n | what the laser says |
|---|---|---|
| OSM water rings in the window | 9 | 8 of 9 flat (std ≤ 0.15 m; median 0.04), all 9 banked (+0.25…+0.84 m); best shift median **(+1 E, 0 N)** — OSM's ponds sit on the laser's water to a metre |
| the traced reed pond | 1 | flat to 0.19 m (reeds), banked +0.52 m, best shift (+4, −1) |
| the eighteen's bunkers | 27 | median depth 0.20 m, 18 read as pits; best shift median **(+2 E, −3 N)** over the 20 with an interior maximum |
| the eighteen's greens | 18 | median raise 0.17 m, 10 raised, std median 0.29 m; best shift medians (+2, −4) by raise and (+3, −2) by flatness |
| the eighteen's tee pads | 44 | std median 0.25 m |
| the nine's imagery greens (2, 7, 8) | 3 | std **0.04 m** inside all three — the flattest ground on the estate, which is what a putting surface is |
| the nine's laser greens (3–6) | 4 | 5 and 6 raised (+1.21, +0.58 m); 3 and 4 read level or bowled — 4 is a plateau inside a rim, which this statistic reads as negative |

**Two findings.** First, the OSM-mapped water is registered to the laser within a
metre while everything traced from the Esri tiles sits a consistent **2–3 m west
and 2–4 m north** of its laser feature (bunkers n = 20, greens by two statistics,
the reed pond): a ~3.5 m offset between the imagery's georeference and
Lantmäteriet's, on this ground. It is recorded and NOT applied — the medians are
good to about a metre and a correction belongs with a control survey (§6). Second,
three traced bunkers that no plan draws also show no pit (17th; the 16th's fairway
one; the 18th's on the rock) and were refused (`sat-traces.json` →
`refusedBunkers`), while the 10th's traced bunker, which the plan also omits,
reads as a 0.24 m pit and stays. Two independent records against one trace; one
record each way and the trace stands.

Model water levels sit a median **4.19 m** above the laser's water surfaces — the
Terrarium datum step (§3.3), consistent with the tees' 4.55 m and not a defect of
the rings.

### 7.11 The club's own record, hole by hole

`johannesbergbuild/guide-inventory.json` is what the eighteen 2026 plans draw,
read on 2026-09-05: bunkers with the player's side, water, OB runs with the
metres they cover, the fairway plate colours (200 white, 150 yellow, **125 blue**,
100 red), the flag colours, and the objects the plans mark that the model does not
carry — the bell on the 12th, the sighting posts on the 12th and 16th, the
**sighting tower at the 16th tee** ("Avstånd över pinnen från tornet: 140 meter"),
the flagpoles the 18th aims at. Each row says what the model has beside it, so a
disagreement is one line, not a search.
