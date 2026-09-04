# Upsala Golfklubb — source dossier

> Compiled 2026-09-04, alongside taking this ground to the 1 m v2 terrain.
> Everything here is either a source that was read on that date and is quoted,
> or a measurement made in this repository and reproducible from a command in
> it. Where a source and this repository disagreed, the disagreement is stated
> rather than resolved silently.

The machine-readable ledger is
[`source-manifest.json`](../../geo_data/course-v2/upsala/source-manifest.json);
the reviewed lattice is
[`upsala-ground-graph.mjs`](../../packages/course-v2/upsala-ground-graph.mjs);
the live runtime contract is
[`v2-upsala-config.mjs`](../../apps/golf/src/engine/v2-upsala-config.mjs).

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Club | Upsala Golfklubb (UGK) | club site |
| Founded | 1937, by golfers within Uppsala Rotary Club | [club history](https://upsalagk.se/klubben/historik/) |
| Address | Håmö Gård, 755 92 Uppsala | club site |
| Phone / e-mail | 018-46 01 20 / info@upsalagk.se | club site |
| Courses | Stora banan (18), Mellanbanan (9), Lilla banan (9) — 36 holes | club site |
| Ground id here | `upsala` | this repository |
| Course slugs here | `upsala`, `upsala-mellanbanan` | this repository |

### 1.1 The history, and one correction it forces

The club's own history page is unusually complete, and it settles the
attributions:

- 1937: founded. An agreement with Kungl. Upplands Regemente the same autumn
  gave the club land on the regiment's training ground at Södra Norby.
- 1938: a **nine-hole course designed by Professor Gregor Paulsson**, the club's
  first chairman, comes into play. The club played in Hågadalen until the early
  1960s; live ammunition and golf did not combine.
- 1962: **Håmö Gård is bought.** "Tillträde skedde den 14 mars 1962, flaggan
  hissades och 'tillträdesbollar' slogs ut i snön."
- 1964: **Paulsson's eighteen** opens, built in-house. Formally inaugurated
  28 August 1965.
- 1978: **Mellanbanan**, nine holes, **by Nils O. Nyberg and Einar Jansson**.
- 2001: the third nine, **Lilla banan, by Peter Nordwall**.
- 2007–2010: **Stora banan rebuilt by the Canadian architect Bob Kains.** The
  first phase of "Masterplan 2008" (holes 11–18) opened for play in spring 2009;
  the whole course reopened 21 May 2010 and was inaugurated 12 June 2010.

**The correction.** `upsalabuild/card-mellanbanan.json` says of Mellanbanan
"Course by Peter Nordwall, in play 2001". That is Lilla banan's architect and
Lilla banan's year. Mellanbanan is Nyberg and Jansson, 1978, on the club's own
account. The note is wrong and is not used by any gate; it should be corrected
when that file is next touched. Nothing geometric depends on it.

## 2. Cards

### 2.1 Stora banan — verified, unchanged

Par 72 (36/36). Six tees, named by nominal length in metres: 62 Svart (men
only), 59 Vit, 56 Gul, 51 Blå, 47 Röd, 42 Orange (women only). Par 3s are 2, 6,
10 and 14; par 5s are 5, 8, 12 and 16.

`upsalabuild/card.json` was re-checked hole by hole on 2026-09-04 against
[golfisverige.com](https://www.golfisverige.com/klubb/upsala-golfklubb/) and
agrees on **all 144 values**, with printed totals 6192 / 5888 / 5565 / 5118 /
4722 / 4222. `upsalabuild/check3d.mjs` gates the same 144 values at every build
and reports zero mismatches.

### 2.2 Course rating and slope — read, not yet carried

From [slope.no](https://slope.no/sv/baner/upsala-golfklubb/), 2026-09-04. The
club's own slope page publishes the same table as images, which is why this is
the citable form. **These numbers are not in the repository**; nothing renders
them yet, and they are recorded here so that adding them later is transcription
rather than research.

| Tee | Men CR / slope | Women CR / slope |
|---|---|---|
| 62 | 74.5 / 140 | — |
| 59 | 72.5 / 139 | 78.2 / 145 |
| 56 | 71.3 / 135 | 76.4 / 142 |
| 51 | 69.5 / 130 | 74.4 / 135 |
| 47 | 67.2 / 125 | 71.3 / 130 |
| 42 | — | 68.6 / 124 |

### 2.3 Mellanbanan — verified, with a known open question

Par 35 over the nine, par 70 played as eighteen. Five tees. The tee lengths in
`upsalabuild/card-mellanbanan.json` were re-checked against golfisverige and
agree, printed Out totals 2601 / 2499 / 2307 / 2115 / 1814.

The **stroke index is still the open question** and is marked `unverified` in
the published course manifest. Two columns are in circulation and both are valid
odd 1–17 permutations, so no arithmetic check can separate them: golfisverige
publishes 13, 9, 3, 15, 11, 1, 17, 5, 7, and the club's own per-hole banguide
sheets disagree with it on all nine holes. This repository carries the club's,
which is the right choice — but transcribed is not the same claim as gated.

### 2.4 Lilla banan — recorded, not modelled

The third nine is **not in this repository** in any form. Its card was read on
2026-09-04 and is recorded here so that a later build starts from a source
rather than from a search:

Par 31 over the nine (62 as eighteen), two tees. Röd 1406 / Gul 1633 out;
2812 / 3266 as eighteen. Per hole (Röd / Gul / par / index):
106/127/3/13, 223/243/4/9, 269/286/4/3, 102/113/3/11, 217/240/4/17,
102/117/3/1, 89/114/3/7, 230/294/4/5, 68/99/3/15.

It is described by the club as pay-and-play with no handicap requirement, open
year-round when frost-free, and it is handicap-qualifying. Its position on the
property has not been established here; whether it falls inside the reviewed
2,048 m v2 window is **unknown and must be measured before it is claimed**.

## 3. Banguide and per-hole text

The club's banguide is 18 image sheets hosted on **banguider.se** and embedded
on upsalagk.se, uploaded 2025-11-01. They carry the card, carry and approach
distances, green depths and printed labels (PLIKTOMRÅDE, INTERN O/B, DIKE,
START/SLUT KULLAR) — **and no prose**. banguider.se answered HTTP 526 to a
plain fetch on 2026-09-04; the sheets were read in an earlier research pass and
what they contain is recorded in `upsalabuild/guide-notes.json`'s own `source`
field, per hole under `basis`.

Because the club publishes no per-hole text, the HUD notes were WRITTEN from
sourced facts and say so: the sheets, the club's Lokala regler 2026, the 2025
Bob Kains interview on the Stora banan page, club news 2022–2023, and Svensk
Golf's 2021 course visit. That arrangement is unchanged by this work.

Two facts worth keeping from the 2026-09-04 pass:

- Kains names the **3rd** his own best hole — "the view from the tee, the
  challenge of the water, the curving wall along the lake and the design of the
  green complex" — which is what makes it the signature hole in the notes.
- Svensk Golf's visit (2021, score 69/100) calls the course parkland with a few
  wooded holes, singles out the 3rd and the approach on the 7th, and describes
  the greenside bunkers as "ganska djupa".

## 4. Photographs

**No photograph from any of these sources has been copied into this
repository.** The club publishes course photography on upsalagk.se and its
Facebook page; none of it carries a documented reuse grant, and the same is
true of the banguide artwork on banguider.se and of the aggregators' pages. The
chooser's four hero images for this course are application-rendered stills made
by `tools/make-posters.mjs`, which is the standing rule here: a plain picture of
the real thing, rendered from the model, beats a beautiful picture nobody
licensed.

The one image-derived thing in the build is the satellite trace set
(`upsalabuild/sat-shapes.json`), read off Esri World Imagery. Its rights remain
a **release-blocking blocker** in the source manifest (`legacy-imagery-rights`)
and this work did not change that: the routing and turf outlines still descend
from it. Re-deriving them from the licensed Lantmäteriet orthophoto is the exit.

## 5. Location and geometry

| Item | Value |
|---|---|
| Club POI (golfisverige) | 59.841732933975 N, 17.504601723669 E |
| the same, projected | E 640345.5, N 6636438.5 (EPSG:3006) |
| the same, in the pack frame | x 202, z −293 — inside the reviewed v2 window |
| Pack frame origin | 59.839 N, 17.4952 E → E 639830.271, N 6636114.391 |
| Reviewed v2 frame origin | E 640143.5, N 6636145.5, 13.28 m RH 2000 |
| Played extent, both courses | E 639299.8–640986.3, N 6635567.4–6636723.6 |

The played extent is the union of every coordinate the two committed EPSG:3006
migrations carry for their holes: 1,686 m east–west and 1,156 m north–south.
The two courses stand **side by side**, Stora banan west and Mellanbanan east,
which is what makes 2,048 m the tight fit it is here (180 m clear east and
west, 446 m north and south).

### 5.1 The frame, measured

The pack's frame is the old flat-earth one about 59.839 N, 17.4952 E. Measured
against the same points projected through PROJ into SWEREF 99 TM, over the
403 hole-line and green-ring vertices the committed migration carries:

| Measurement | Value |
|---|---|
| rotation (meridian convergence, 2.5° east of the central meridian) | **2.1577°** |
| frame scale, east / north | 0.997659212 / 0.999356507 |
| best-fit isotropic similarity residual | 0.31 m mean, 0.62 m max |
| error of a translation-only bridge | **24.6 m** at the far end of the property |

The runtime bridge derives the rotation and both scales from the two frames'
own declared constants, so they are exact rather than fitted. The residual
above is what remains because a flat-earth frame is not a similarity of a
transverse Mercator one, and it is below the DTM's own 0.3 m stated plan
uncertainty.

## 6. Terrain: what changed on 2026-09-04

### 6.1 Source

Lantmäteriet **Markhöjdmodell Nedladdning** (`dtm-cog`), 1 m, CC-BY-4.0, in
EPSG:3006 + RH 2000. Håmö straddles easting 640000, so this is the first ground
here backed by **two** 10 km items:

| Item | SHA-256 of the full COG | Captured |
|---|---|---|
| `663_63` (west) | `95655f47fc991c4adb6a97458d3f75cf3ec2a82d85da29ee15b360afda4641a8` | 2023-04-27 |
| `663_64` (east) | `8d0107f4aa85d02200ecf91547813e93499571b995a293bdbe1b80509e34541e` | 2023-04-26 |

Both are read at factor 1 — every published sample is a source pixel copied
exactly — so the seam is one of provenance, not of geometry.

### 6.2 The AWS Terrarium field it replaced

`tools/measure-vertical-datum.mjs --ground upsala`, over 61,123 samples of mown
ground on a 2 m grid across both courses with every water ring excluded:

| | before | after |
|---|---|---|
| median legacy − RH 2000 | **6.7514 m** | **0.0001 m** |
| median absolute deviation | **1.9188 m** | **0.0239 m** |
| range | 0.07 – 15.00 m | −1.08 – +1.31 m |
| best registration shift | (−12, −12), at the sweep's own boundary | **(0, 0)** |

The 1.92 m spread is the reason this ground's pack was **re-grounded** rather
than vertically bridged. A single median offset is the right model for a datum
step — Veckefjärden's is 20.9924 m with a 0.2392 m MAD — but Terrarium's SHAPE
over this parkland is wrong as well as its datum, and correcting by the median
would still have left this course's ponds between 2.8 m below their own bed and
5.3 m above their own surface.

So `upsalabuild/build-heightfields.mjs` now cuts HF0 and HF1 from the laser DTM,
sampled **through the same derived bridge the runtime uses**, and the pack, the
standalone page and the published v2 ground carry one field in RH 2000. The
vertical bridge is consequently zero, and the table above is the proof.

Only vertical fields moved. A field-by-field diff of `course-model.json`
against the previous build shows **exactly 79 changed leaves**: 24 water
levels, 18 × 3 hole elevations and the water floor. No hole line, green ring,
tee pad, bunker or fairway moved by a millimetre, so every horizontal gate —
hole length, marker placement, the design SVG — still measures what it
measured.

### 6.3 Water, and what it proved

A laser DTM treats a water surface as a flat plate. Every OSM water ring on
this ground was measured from the **inside**, and the spread is recorded beside
the level:

- 21 of 22 rings had ≥ 12 interior samples; the worst standard deviation is
  **0.45 m** and the median ring is under 0.15 m.
- Levels moved 4–12 m: the pond by the 11th/12th from a Terrarium 21.19 m to a
  measured 17.22 m, the high pond on the 16th from 43.46 m to 34.42 m.
- `build-heightfields.mjs` now **fails** if any ring spreads more than 1.5 m,
  because a ring that is not flat in a model that flattens water is a
  misregistered ring and the level under it is a guess.

That flatness is also an independent check on the horizontal registration of
the whole OSM-derived model, and it passed before anything was rebuilt.

### 6.4 What was published

| Layer | Result |
|---|---|
| Finest lattice | 2,048 × 2,048 m, sample-centre bounds E 639119.5–641167.5 / N 6635121.5–6637169.5; 8 × 8 tiles, 257 × 257 samples, 1 m |
| Height range in the window | 13.286 – 54.385 m RH 2000, every sample finite |
| Frame | `EPSG:5845`, origin E 640143.5, N 6636145.5, 13.28 m; fingerprint `628d86e3e5bf35bd79500173488c31a31fe101c06d1acad56033d089d2846d86` |
| Ring graph | 7 levels, **277 tiles** (64/64/64/64/16/4/1), 16,384 m root, 0.82 – 68.15 m RH 2000 |
| Level-zero reuse | The ring reader reproduced the published 1 m tiles over all 4,227,136 samples, worst difference 0.005 m — half a quantum |
| Courses | Both slugs on one ground manifest, one terrain, two routings |

### 6.5 Reproduction

```powershell
node --env-file=.env packages/course-geo/acquisition/build-terrain-window.mjs --ground upsala
node --env-file=.env upsalabuild/fetch-dem-lm.mjs
node upsalabuild/build-heightfields.mjs
node upsalabuild/reconcile.mjs
node upsalabuild/embed.mjs
node upsalabuild/check3d.mjs
node tools/build-nine.mjs upsalabuild/mellanbanan.json
node packages/course-pack/emit-pack.mjs upsalabuild apps/golf/public/courses/upsala upsala
node packages/course-pack/emit-pack.mjs upsalamellanbuild apps/golf/public/courses/upsala-mellanbanan upsala-mellanbanan
node packages/course-pack/emit-manifest.mjs
node tools/measure-vertical-datum.mjs --ground upsala --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/upsala-terrain-window/terrain-1m.f32
node packages/course-geo/migrate-without-proj.mjs --ground upsala --model upsalamellanbuild/course-model.json --reference geo_data/course-v2/upsala/migration/course-model.epsg3006.json --out geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json
node packages/course-v2/compile-upsala-ground-graph.mjs --terrain-f32 packages/course-geo/toolchain/.cache/acquisition/upsala-terrain-window/terrain-1m.f32 --out apps/golf/public
node --env-file=.env packages/course-geo/acquisition/build-ground-rings.mjs --ground upsala
node packages/course-v2/publish-ground-rings.mjs --ground upsala --slug upsala,upsala-mellanbanan
```

Gates: `node packages/course-geo/check-manifests.mjs`, `npx vitest run`,
`node upsalabuild/check3d.mjs`, `node geobuild/lint-page.mjs upsala3d.html`,
`node packages/course-pack/check-pack.mjs apps/golf/public/courses/upsala/pack.bin upsala3d.html upsalabuild`,
and, against a served build,
`BANVY_GPU=1 node tools/check-upsala-v2.mjs`.

## 7. The Mellanbanan routing, and which record it is

Two records of this nine exist here and they are not the same:

- `upsalabuild/mellanbanan-model.json` — the **banguide trace**, registered to
  three OSM pond centres. Its EPSG:3006 form is the committed
  `migration/mellanbanan-model.epsg3006.json`.
- `upsalamellanbuild/course-model.json` — the nine the app actually **ships**,
  built by `tools/build-nine.mjs` from published GPS hole routes with each tee
  slid to the card's Vit length.

They agree on seven holes and disagree by up to **164 m on holes 7 and 8** —
the two the trace itself flagged as drawn under canopy. The v2 course manifest
therefore claims tiles for the SHIPPED routing, whose EPSG:3006 form is the new
`migration/mellanbanan-course-model.epsg3006.json`.

That file was produced by `packages/course-geo/migrate-without-proj.mjs`,
because PROJ is not installed on the machine this was done on. The driver
refuses to write anything until it has re-projected the committed cs2cs
migration's own source model and reproduced it: on this ground it agrees to
**1.343 mm over all 12,925 coordinates**, against a 5 mm tolerance. It should
be regenerated through `migrate-legacy.mjs` when the pinned toolchain is
available; the two should then differ by less than that.

## 8. What is still open

Ranked by what would change the most.

1. **Playing surfaces are not surveyed.** Greens and bunkers are OSM outlines,
   the routing is the club's banguide read off Esri imagery, and lengths come
   from the card. That is a tier-D fusion, and the published graph carries
   **zero v2 surface tiles** rather than dressing it up as one.
2. **Esri imagery rights** (`legacy-imagery-rights`) remain release-blocking
   for exactly that reason. The exit is the licensed Lantmäteriet orthophoto,
   whose 2025 O2 16 cm RGBI campaign is already discovered and complete over
   this AOI but not yet acquired.
3. **No independent control.** The canonical origin is still
   `pending-control-approval`; no RH 2000-tied checkpoints exist for this
   ground.
4. **No vegetation from LiDAR.** The two Laserdata Skog COPC items over this
   ground (`21c037-663_63`, `21c037-663_64`, captured 2021-03-19, ~1 GB each)
   are discovered and reachable but not read. Until they are, the trees come
   from the Esri-classified `tree-cover.json`, which shares blocker 2.
5. **Skogsstyrelsen access is denied** (HTTP 401 for the configured account on
   2026-09-04), so the supporting tree-height raster is unavailable. It is
   supporting evidence only.
6. **Mellanbanan's stroke index** is the club's sheet, transcribed but not
   gated (§2.3).
7. **Lilla banan is not modelled** (§2.4).
