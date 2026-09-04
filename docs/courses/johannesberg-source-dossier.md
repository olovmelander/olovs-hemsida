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

The frontier replaces 180,532 of the legacy CORE's 215,272 base points (83.9 %).
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
| Nine-hole course (`johannesberg-9`) | shares this ground and this terrain window, but is **not yet published as a v2 course**; `emitGroundGraph` takes one course per call |
| Vegetation | published: 2,417 measured crowns + a 64-tile stand field. Leaf-off, so conservative on deciduous; see §4 |
| Ortho / Topografi 10 | discovered and covered, not acquired; no product terms approved for redistribution |
| Hole 12 | the tee end is under spruce in every image; the card slide resolves it to within 26 m of the banguide's own disc. See CLAUDE.md before re-tracing |
