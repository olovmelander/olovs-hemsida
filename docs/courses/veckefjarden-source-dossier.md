# Veckefjärdens GC — source dossier

> Compiled 2026-09-04, for the move to 1 m Lantmäteriet terrain. Everything
> below was checked on that date against a live source or a committed file, and
> every claim names the thing that proves it. Where a source contradicts the
> repository, both values are stated and neither is quietly adopted.

The machine-readable ledger is
[`source-manifest.json`](../../geo_data/course-v2/veckefjarden/source-manifest.json);
the production workflow is [`v2-course-runbook.md`](../v2-course-runbook.md).
This file is the evidence behind them.

## 1. Identity

| | |
|---|---|
| Club | Veckefjärdens Golfklubb, Golfbanevägen 21, 891 30 Örnsköldsvik |
| Courses | Mästerskapsbanan (18, par 72) and a korthålsbana (9, par 27) |
| Ground id | `veckefjarden` — one physical property, two course slugs |
| Sites | veckefjarden.com (20 pages), klubben.veckefjarden.com (23 pages) |
| Club's own GPS | N 63° 17.315′, E 018° 40.694′ → 63.288583, 18.678233 |

**That published coordinate is a free, independent check on the frame.** Through
`geobuild/lib.mjs`'s ORIGIN it lands at world (236.9, −454.6); the OSM clubhouse
polygon, which never saw it, has its centroid at (233.8, −464.8). **10.7 m
apart** — a fourth confirmation alongside the GPS green centres (2.1–4.5 m), the
card lengths (0.02%) and the compass roses (median 2°).

## 2. The card

### 2.1 The 18-hole card is verified, three ways, 144 cells, zero disagreements

`banguide/guide-card.json` matches, cell for cell:

| source | path | agreement |
|---|---|---|
| The club's own GIT/SGF widget | `prd-sgf-widget-api.azurewebsites.net/api/widget/5bd0113a-…/scorecard` (needs an `Origin: https://veckefjarden.com` header, else HTTP 400) | 144/144 |
| LiveCaddie course 379 | embedded by veckefjarden.com/banguide/ as an iframe; id verified on the live page | 144/144, and `MeasuredLength == DefinedLength` on every cell |
| caddee.se, golfisverige.com | public listings | 144/144 |

Par 36/36/72. Stroke index a valid 1–18 permutation. Totals
**6436 / 6121 / 5804 / 5502 / 4743 / 4043** for tees 65/61/58/55/48/40, and both
club sources print those same six.

So `geobuild/check3d.mjs`'s 144-value gate is confirmed against the club's live
GIT record, by a path that never entered the transcription. Nothing to change.

**Tee names are course-rating labels, not colours.** golfisverige gives the
mapping: Svart 65, Vit 61, Gul 58, Blå 55, Röd 48, Orange 40 — which is exactly
the colour order `emit-manifest.mjs` already carries, so the app's default-yellow
rule lands on 58 correctly.

### 2.2 Two card vintages exist, and they separate cleanly

GolfTraxx, Hole19, 1golf.eu and golflandet.se agree on all 18 pars and all 18
stroke indices but carry an **older** length set. The two are told apart by their
totals alone:

- current: 6436 / 6121 / 5804 / 5502 / 4743 / **4043**
- older: 6498 / 6154 / 5798 / 5492 / 4787 / **4326**

The tee *names* survive the re-measurement (old lengths ÷100 give 65/61/58/55/48
/**43**), so only the shortest tee genuinely moved forward — 43 → 40. Classify any
future source with one comparison instead of re-deriving this.

### 2.3 Course rating and slope — data the repo does not hold at all

From the club's own GIT widget (`slopeInformation`), and corroborated by
swegolf.se's slope calculator, which carries exactly today's six tees:

| tee | men slope / CR | women slope / CR |
|---|---|---|
| 65 | 144 / 75.5 | not rated |
| 61 | 141 / 73.9 | not rated |
| 58 | 138 / 72.2 | 145 / 78.4 |
| 55 | 135 / 70.7 | 141 / 76.6 |
| 48 | 128 / 67.0 | 131 / 72.1 |
| 40 | not rated | 121 / 67.4 |

The zeros are meaningful — 65 and 61 are unrated for women, 40 for men — so an
import must not treat 0 as a rating.

### 2.4 The korthålsbanan's card is wrong in the repo, and now fixable

The club publishes **no** card for it: its booking system lists exactly one
course (`.../widget/club/c74e3d49-…/courses` returns a single entry), and the
prose says only "nio hål … mellan 60 till 120 meter".

CLAUDE.md records the shipped card as unverified because neither tee column
reproduces its printed total (Gul 932/936, Röd 770/776). The cause is now known:
**the committed Gul and Röd cells are GolfPass's yards read as metres** — an
exact cell-for-cell match — which is why they fall 4 m and 6 m short. Hole19
carries a Gul column summing to **exactly the printed 936** and a genuine,
non-trivial stroke index **2, 7, 8, 1, 4, 9, 5, 6, 3**, which directly
contradicts the note that the only index found was hole order.

Left unchanged here, deliberately: replacing a card is a card decision, and the
club's own "60 till 120 meter" still disagrees with any 136 m first hole.

## 3. The banguide — three club voices, and the repo holds the shortest

1. **LiveCaddie 379**, embedded on /banguide/. This is what
   `geobuild/guide-notes.json` stores under `club`.
2. **The club's own page text**, 18 Swedish paragraphs on /banguide/ itself —
   longer, newer and far more geometric than LiveCaddie's. **16 of the 18 do not
   appear anywhere in the repository.**
3. **Magasin Veckefjärden 2019**, already partly captured as `club2019`.

Voice 2 is the largest single find of this pass, and it states checkable facts
the notes do not: a **two-plateau 1st green**; bunkers left and a ditch right on
the 3rd, its green sloping left into a bunker; bunker right, ditch left on the
4th; on the 7th "en bunker sveper sig runt greenens vänstersida och en annan
vaktar den främre delen"; water right on the 9th; "en stor kulle på höger sida"
guarding the 10th green; water left and OB right on the 11th; the 13th a dogleg
right round a wood, played as close to the fairway bunker as a fade allows;
"de många bunkrarna som omringar green" on the 16th; water left and bunker right
on the 17th; the 18th "ett långt par 5 i motlut" with the brook on the second
and a dike before the approach.

Every one of those is testable with `tools/hole-geometry.mjs`, and several are
exactly the side-and-slope claims CLAUDE.md warns get reflected. **They have not
been folded into `guide-notes.json` yet** — that wants the geometry check first.

**Hole names**: the club names none. It uses one epithet, "Veckefjärdens
signaturhål", for the 14th. Each hole instead carries a named **hålsponsor**, and
all 18 match `geobuild/course-model.json`'s `sp` field exactly, in order — an
independent confirmation that the repo's hole numbering is the club's.

## 4. What the club's own rules say, and where the model disagrees

From *Lokala regler och tävlingsvillkor 2025* (PDF linked from /banguide/):

- **"Från och med 2022 har Veckefjärdens GC endast röda pliktområden. Alla dammar
  och diken är definierade som röda pliktområden."** The shipped model carries
  **three yellow marking runs** (hole 14 and two on hole 6), assigned by a
  generic carry rule at `geobuild/reconcile.mjs:456`, not from the club. Those
  three runs are the wrong colour against the club's current rules. The rule
  serves other builds too, so the fix is a per-course override.
- The distance plates are **200 white / 150 yellow / 100 red, to the green's
  midpoint** — which independently backs the repo's plate invariant and its 2 m
  gate. Worth citing in the plate gate's header.
- The OB list names holes 2, 3, 4, 5, 10 and 11, including a boundary against
  the korthålsbanan on 3, 4 and 5. The model's white runs are on 2, 10, 10, 11
  and 13. The 13th may be the property line (white follows the boundary), but
  **the 3/4/5 boundary between this ground's two courses is a real gap.**

## 5. Photographs — what the place looks like, and what may ship

`geobuild/cache/find-photos.mjs` renders the club's site in Chrome and lists the
large images it actually loads; it works on this machine and found 30+ across
eight pages. Looking at them overturned three things the repo stated as fact.

| subject | what the repo said | what the photographs show |
|---|---|---|
| Clubhouse walls | cream render | **pale yellow painted vertical timber**, white trim and corner boards |
| Clubhouse roof | dark red | **dark grey sheet metal** (corroborated from above by the orthoimagery) |
| Riprap collar | warm beige-grey `0xa8a49a` | angular blasted rubble, **neutral-to-cool grey** |
| Själevads kyrka roof | "NOT a dark roof" | the main roof **is** dark (brown in 2024, grey-green in 2005) |

The clubhouse divergence is a **second, unlogged phase-4 merge casualty** of
exactly the class CLAUDE.md documents for the forest, the riprap, the clearings
and `FARR`: `veckefjarden3d.html` had it right (wall `0xd9c58a`, roof `0x6f7276`,
8.6 m, three window rows) and the app took the shared engine's defaults instead.
Both are corrected in `src/engine/scenery/veckefjarden.js` in this change.

Also confirmed: the granite collar is a continuous apron ringing the whole
peninsula; the fjärd's shore is a **four-band** structure rather than one pale
silt margin; the 1939 lock is photographed and identifiable; and the facilities
are a 22-room on-site hotel, outdoor blue padel courts, a flagpole-lined range
with some covered bays, two practice greens, two short-game areas and the
korthålsbana.

**Rights.** Every veckefjarden.com and hotellveckefjarden.com image is
all-rights-reserved with no grant of any kind, EXIF stripped: **reference only,
never shipped.** The only lawfully shippable photographs found are on Wikimedia
Commons — a 2009 public-domain photograph of the course itself, and CC0/PD
photographs of the church. Downloaded reference images stay in the gitignored
cache. Heroes remain the app's own renders, per the posters rule.

## 6. Geodesy — the frame, and four things measured against it

### 6.1 The frame

`geobuild/lib.mjs` ORIGIN 63.28450 N, 18.67350 E → **E 684183.801986,
N 7022564.696685** (PROJ cs2cs, reproduced by the repo's own Krüger series).

The pack frame is TRUE north; EPSG:3006 is GRID north. `legacyGridBridge` derives
the difference from the frame's own constants alone: **rotation +3.282265°**,
scaleX 0.99731484, scaleZ 0.99867326, point scale 1.00001548. Bridging hole 1's
first line vertex gives 684218.349 / 7022843.198 against the independent cs2cs
migration's 684218.344 / 7022843.198 — **5 mm apart**.

A translation-only bridge would be **43.1 m RMSE and 82.6 m at worst** over the
playing geometry. The rotation is not optional.

### 6.2 The vertical datum step — MEASURED

35,533 samples on a 2 m grid inside the greens, fairways and tee pads of both
courses, every sample inside a water ring discarded, legacy minus RH 2000:

| set | n | median | MAD |
|---|---:|---:|---:|
| **all played ground** | **35,533** | **20.9924** | **0.2392** |
| championship fairways | 28,842 | 20.9709 | 0.2224 |
| championship greens | 2,115 | 20.7465 | 0.1988 |
| korthålsbanan fairways | 3,759 | 21.2667 | 0.1730 |
| korthålsbanan greens | 806 | 21.0821 | 0.2322 |

Puttom's is 23.6263 m. Copying it here would be a 2.6 m error, which is the whole
reason CLAUDE.md says the number is wrong everywhere else.

### 6.3 The lake is at sea level, not 21.59 m

The laser DTM reads water as a flat plate (p05 = p95 to the centimetre).
Sampling 40 interior points per body:

| body | legacy level | **DTM RH 2000** | offset |
|---|---:|---:|---:|
| **Veckefjärden (the lake)** | 21.59 | **0.280** | −21.31 |
| w158063826 | 23.17 | 2.410 | −20.76 |
| w158063825 | 23.29 | 2.400 | −20.89 |
| w158063823 | 28.99 | 7.710 | −21.28 |
| w158063824 | 34.60 | 13.270 | −21.33 |
| w158063819 | 35.87 | 14.510 | −21.36 |
| w158063821 | 33.25 | 12.120 | −21.13 |
| w158063822 | 32.44 | 11.280 | −21.16 |
| w158063818 | 36.54 | 15.676 | −20.86 |
| w158063820 | 31.91 | 10.788 | −21.12 |
| **w23033143 (Hörnsjön)** | 107.06 | 80.600 | **−26.46** |

Veckefjärden the lake sits **within a metre of the Gulf of Bothnia**, which is
exactly why there is a lock at its outlet. Confirmed independently: Lantmäteriet's
own break-geometry polygon for the lake carries a Z on all 1,339 of its vertices,
median 0.280. Hörnsjön is a genuine outlier — its legacy level is ~5 m off the
pattern — and is corrected by construction once levels come from the DTM.

### 6.4 Åsberget is 217 m, not 241

The DTM reads **216.01 m** at the mast node and **218.50 m** as the highest
ground within 2.5 km; Swedish Wikipedia says 217 m. CLAUDE.md's 241 m is the same
Terrarium bias: 218.5 + 20.9 ≈ 239. OSM node 845145336 (`Åsbergsmasten`,
height=259) is verified live and matches CLAUDE.md's world (−632, −2007) — but
the **mast** is 259 m tall on a 217 m hill, and Åsberget carries **two** Teracom
masts (~100 m and ~170 m per sv.wikipedia), where the repo builds one 246 m body.

## 7. Other geodata, checked

- **OSM has not moved.** The live bbox returns byte-for-byte the same golf set as
  the committed `geobuild/osm-features.json`: greens 22, fairways 21, tees 53,
  bunkers 32, hole ways 11, driving range 1 — set difference zero in both
  directions. Holes 1–5 and 7 are still unmapped.
- **OSM gained three fairway multipolygon relations** (r20948903/4/5, created
  2026-06-08) that `parse-osm.mjs` silently drops, because it walks relations only
  for water and forest. 4,198 m² near green 15, 3,895 m² near green 6, 898 m²
  near green 12.
- **The reserve is two polygons, 63.11 ha**, and the model has one (30.12 ha).
  The western half sits at the Moälven mouth by Själevad, outside geobuild's
  fetch bbox (which starts at lon 18.640), so it was never fetched. Both are in
  OSM (w43043599, w43043598) and in Naturvårdsverket's open WFS.
- **The reserve's forest is grey alder first**, then birch and rowan, with bird
  cherry, maple and ash — Länsstyrelsen's own text. The planter's birch-dominant
  rule is directionally right; the engine has no alder species, which is now
  stated in the scenery module rather than implied.
- **Lantmäteriet Topografi 10 is not entitled** for this account: every
  `stac-vektor` asset for Örnsköldsvik answers HTTP 403 while `/hojd/` assets
  answer 200/206 in the same session. Product entitlement, not authentication.
- **The DTM break-geometry GeoPackage is a ready hydrography upgrade** the
  account can already read: 58 water polygons in the 10 km tile, 13 within 2 km
  of the course, each carrying its own RH 2000 level per vertex. The fjärd's
  outline is 1,339 points at 6.36 m median segment against the model's 378 at
  15.94 m, and it carries two small islands the model's single ring lacks.

## 8. What was built

| stage | result |
|---|---|
| DTM item | `dtm-cog` **702_68**, EPSG:5845, 274,998,450 bytes, captured 2020-06-18 → 2024-06-27, stated 0.3 m plan / 0.1 m height |
| Window | 2049 × 2049 at 1 m, `-projwin 682885 7024027 684934 7021978`, **zero nodata**, 0.164–151.461 m RH 2000 |
| Origin | reviewed, balanced on the played ground: **E 683909.5, N 7023002.5** — 376 m of margin east/west and 206 m north/south, against 24 m if the aligner's floor-padding chose it |
| Course graph | 85 tiles, 4 levels, 86 unique chunks — one ground manifest, **two course manifests** |
| World rings | **277 tiles across 7 levels to a 16,384 m root**, 9 DTM items, 96 MB over 205 range requests in 18.2 s |
| Ring lod 0 | reused byte-for-byte; 4,226,934 of 4,227,136 samples within quantum, max difference **0.005 m** |
| Runtime | `?v2=require` boots clean on WebGPU: *1 M TERRÄNG · HELA VÄRLDEN · 277 tiles i 7 nivåer till 16 km* |

**The bridge is confirmed by an independent measurement.** The v2 ground sits
within **−0.89 … +0.23 m** of the GPK1 ground at all eighteen green centres,
median −0.19 m. A wrong rotation would show tens of metres on sloping ground; a
wrong datum offset would show a constant multi-metre bias. The residual is a 1 m
laser DTM against a 4 m-resampled Terrarium, plus the green pads the legacy
sculpt lays on top.

## 9. Open, and why

> **2026-09-05.** Several of the items below were applied in the course-map pass
> ([`veckefjarden-course-map.md`](veckefjarden-course-map.md)): the three yellow
> runs are red, the OB runs follow the club's list, the three fairway relations and
> the western reserve polygon are in the model, the club's 18 paragraphs are in
> `guide-notes.json` under `clubWeb`, and the plan-traced holes were re-anchored on
> the surveyed green centres after a compounding registration bug was found. Bunkers,
> ditches and tee decks were read off the 1 m terrain and the z18 imagery. Still open
> from this list: the water levels, the CR/slope table, the korthålsbanan card, the
> vegetation species hook, and the control approval.

- **Vegetation.** Two Laserdata Skog campaigns cover the whole AOI with **no
  seam** — `26f015-702_68` flown **2026-06-01 → 2026-06-21** (159.9 M points,
  0.566 m spacing, 831 MB) and `20f015-702_68` from 2020 as the check. Not run:
  `packages/course-geo/copc-reader/build-canopy.mjs` is broken in the working
  tree (line 272 reads `groundFile`, an identifier a concurrent edit deleted),
  and the compile/publish chain beside it is being edited by another session.
  **Before it is run, the v2 vegetation runtime needs a species hook** — it
  chooses species from a hardcoded pine-led hash and offers none, so publishing
  Veckefjärden's woods today would erase the alder/birch rule this course exports
  and plant High Coast pine on an Ångermanland lake shore. That is the same
  merge-casualty shape as the forest, the riprap and `FARR`, and no gate would
  catch it: `vegetation-baseline.mjs` prints the species split without asserting
  on it.
- **Water levels from the DTM.** Measured and tabled above, not yet adopted:
  changing them means re-running `reconcile → embed → emit-pack → emit-manifest`
  and re-binding the graph's `fallbackV1`, which is a pack change and belongs in
  its own commit.
- **The three yellow marking runs**, the 3/4/5 OB boundary, the three dropped
  fairway relations, the second reserve polygon, the CR/slope table, the club's
  18 newer hole paragraphs, and the korthålsbanan card — all evidenced above,
  none applied.
- **The frame is still `pending-control-approval`.** Everything here is measured
  against Lantmäteriet's product, not against independent control points, so the
  origin remains a migration frame exactly as Puttom's and Ribbingsfors' do.
- **Surfaces are the legacy traces.** `surfacePolicy: 'legacy-ground-atlas'`;
  no authoritative surface layer is claimed.
