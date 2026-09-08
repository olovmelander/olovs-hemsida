# Lidingö Golfklubb — source dossier

The club-reference intake is [`lidingo-source-research.md`](lidingo-source-research.md)
and it still stands: 128 retrieved assets, the official card, the guide sheets,
the dated planning documents and what each of them may and may not be used for.
This is the record of the 2026-09-08 continuation, which is about GEOMETRY and
TERRAIN rather than club references, and about the instruments used to measure
them.

Read it with [the runbook](../v2-course-runbook.md) and
[the mapping workflow](../v2-course-mapping-workflow.md). Nothing here approves
a surveyed digital twin; the chooser still says *Preliminär 3D* and the open
gates are in [the source ledger](../../geo_data/course-v2/lidingo/source-manifest.json).

Sweden's first 18-hole course, playable in 1927, in the club's own words *"en
något kuperad parkbana där fairways ligger inbäddade bland vackra villor och
välskötta skogsdungar"* — a slightly undulating park course whose fairways lie
among villas and well-kept groves. H G MacDonald's routing, rebuilt 2006–2009.

## 1. The GolfTraxx survey, and what it is allowed to be

Lidingö is `18130SW` in the GolfTraxx directory, listed at Trolldalsvägen 2 —
the club's own address. `geo_data/golftraxx_extract.py`, the tool the Puttom and
Norrfällsviken surveys came through, turns its course-map page into the same
90-point FeatureCollection: `geo_data/lidingo_clean.json`.

`lidingobuild/mapping/review-golftraxx-survey.mjs` measures it against two
records it never saw, and gates itself on both.

| question | answer |
|---|---|
| Do the holes with no separate landing target reproduce the card's par 3s? | **1, 3, 6, 9, 11, 16 against 1, 3, 6, 9, 11, 16.** Six of six, no false positive. |
| Does each Green Center land on that hole's observed green? | **18 of 18 on the right hole, 16 strictly inside it**, median 3.27 m from the traced centroid, worst 15.72 m. |
| Is there a systematic offset? | Median dE **+1.56 m**, dN **−0.76 m** — far smaller than the scatter, so this is a scatter result and **no shift is applied to either record**. |
| Do its own route lengths reproduce the card? | **No, and the way it fails is the point.** Every hole but the first measures 0.915–0.919 of its card length, median 0.9165. One yard is 0.9144 m. |

So GolfTraxx laid this course out with the metric card numbers read as YARDS —
the identical defect Ribbingsfors measured in the same provider. **The back-tee
and Tee Target points are therefore derived, not surveyed, and are refused as
tee positions.** The observed pads remain the only tee geometry. What the survey
contributes is a per-hole green-centre anchor and the hole axis. Adopting an
anchor is not adopting geometry.

## 2. One terrain to the horizon

Lidingö rendered 1 m terrain over a 2,048 m window and nothing beyond it: a
fixed frontier with no rings, so the environment stopped at the course.
`packages/course-v2/lidingo-ground-rings.mjs` registers Veckefjärden's topology
— eight tiles per side down to lod 3, each finer ring exactly the middle four
tiles of the coarser one, lod 0 centred on the published window so the 1 m
course tiles are reused byte for byte.

Published: **277 tiles in 7 levels reaching 16,384 m**, 18.0 MB, parent links on
all 276 non-root tiles, heights **−10.16 to 72.72 m RH 2000**. All ten
`check-course-v2` browser gates pass, and so do the other nine courses'.

Three things the acquisition established, each because a gate refused first:

- **The reader and the published ground see the same source.** Level 0 read at
  1 m reproduces all 64 published tiles to 0.005 m, 4,226,703 of 4,227,136
  samples inside one quantum.
- **The coverage band is measured, not assumed.** A reviewed −10 m floor, chosen
  from the course window's own −0.047 m on the assumption that a DTM without
  bathymetry cannot go far below the sea, failed at lod 3 on a real −10.157 m —
  and failed correctly, because the 8 km ring had already reached −3.46 m.
  Markhöjdmodell carries real DEPTH under this water. Per-level extremes are in
  `acquisition/ground-rings.json`.
- **No sea fill has ever had anything to justify.** Every sample of every level
  reads finite and all nine 10 km squares are published, unlike Norrfällsviken.
  The rule stays declared as a guard that fails closed, described as one.

Two contract traps, both of which failed loudly rather than quietly rendering a
smaller world. **A frontier is not a graph**: `expectedBoundsEpsg5845` was the
course window, the graph resolved with all 277 tiles and was then refused with
*"published graph bounds do not match the reviewed lidingo extraction"*. And the
ring adapter wanted `legacyOriginEpsg3006`, which a grid-authored pack does not
have — Lidingö is the first ring-graph ground of that kind. Rather than write
the origin down twice, `gridOriginFor(config)` in the frontier-config registry
is now the single rule both the frontier loader and main.js ask.

**A session without a Lantmäteriet account can measure this ground but cannot
rebuild the model on it.** `lidingobuild/mapping/rebuild-terrain-raster.mjs`
measures the distinction: the 64 published level-0 tiles cover the acquired 1 m
window completely — 4,198,401 of 4,198,401 samples, none missing — so the
terrain's shape is fully recoverable from the repository, and its BYTES are not,
because the tiles are quantised at 0.01 m. `sourceFloat32Sha256` is the contract
saying which bytes `course-model.json` was built on, so the tool refuses rather
than writing a near-miss.

## 3. The orthophoto, and why the old one was costing fidelity

The Lidingö stad 2019 orthophoto is CC0, re-acquires byte-identical to its
pinned snapshot, and remains the licensed record. It is also a LEAF-OFF spring
capture, and that costs real fidelity.

**Lantmäteriet's national Ortofoto is served through the Min karta WMS with no
key**, at **0.16 m native**, CC BY 4.0 with attribution
(*Datakälla Lantmäteriets Min karta; ©Lantmäteriet; bearbetad; CC BY 4.0*).
Over this course it is a single flight of **2025-05-31**, read from the
service's own `Ortofoto_0.16_fs` seam layer, which labels the two frames here
10:27:11 and 10:27:15 +02 — the date is READ, not inferred from a product name.
Leaf-on, and newer than every course change the club records: the hole-17 green
bunker (2024), the hole-13 left green bunker and the orange tees on 6/7/8
(2025), and the upper-parking practice area that opened 2025-05-17, two weeks
before the flight. `lidingobuild/mapping/acquire-lm-ortho.py` takes the whole
1,197 × 1,373 m window in **six** GetMap calls; bulk tiling of an e-service
backend is a question about service usage rather than about the licence, and
this does not need to test it. The pixels stay in the ignored cache; what this
repository publishes is derived vector geometry carrying that attribution.

**And Lidingö stad published a 2018 capture that nothing here knew about.**
Probing the servicename pattern finds 2012, 2018 and 2019 and nothing else;
2018 is LEAF-ON full summer, on the same service and under the same CC0
dedication — the cleanest grant over this course, since it permits deriving
geometry, publishing the vectors and redistributing the imagery outright.
**The municipal service's native spacing is about 0.16 m, not the 0.5 m at
which it had always been sampled**, so both municipal frames were being read at
a third of their resolution.

Measured like for like on one 0.25 m analysis grid, inside rings mapped without
reference to any of them:

| capture | licence | sand−turf luminance gap | recovered | median | accepted away from any mapped bunker |
|---|---|---:|---|---:|---:|
| **Lantmäteriet 0.16 m, 2025-05-31, leaf-on** | CC BY 4.0 | **+53.5** | 34 of 40 | **0.9 m** | **37** |
| Lidingö stad 0.16 m, 2018, leaf-on | **CC0** | −16.7 | **35 of 40** | 1.4 m | 170 |
| Lidingö stad 0.16 m, 2019, leaf-off | CC0 | +1.5 | 11 of 40 | 1.1 m | 58 |
| Lidingö stad 0.5 m, 2019, leaf-off | CC0 | +2.9 | 13 of 40 | 1.2 m | 63 |
| Esri z18 0.30 m, 2025-05-19, leaf-on | Esri MLA | −25.9 | 30 of 40 | 1.6 m | 78 |

A negative gap means the distributions overlap and no threshold on luminance
alone exists; both leaf-on captures with a negative gap still recover most
bunkers, because the laser hollow carries them. **2018 has the best recall and
by far the worst precision** — 170 accepted candidates away from any mapped
bunker against the Lantmäteriet frame's 37 — because its whole image is
brighter and hazier (turf luminance p50 139 against 83), so sand does not stand
out from turf even where it is plainly sand to the eye. The Lantmäteriet frame
wins on precision, on positional agreement and on recency; 2018 is the best
CC0 instrument and corroborates it.

**Re-sampling the 2019 frame at its native 0.16 m changed nothing: 11 of 40
against 13 of 40 at 0.5 m.** That refutes the plausible hypothesis that the
0.5 m export was what made it weak. Its problem is the SEASON — dormant turf as
bright as sand — and no amount of resolution fixes a capture taken in the wrong
month. Every colour threshold is measured on its own capture and sits midway in
that capture's own gap; none is copied between captures.

**The 2025 Lantmäteriet capture is now THE photo record for this ground.** The
owner's instruction, and the numbers above are the same answer: 2018 buys one
extra bunker (35 against 34) for three times the false accepts (208 accepted
components against 71) and half a metre of positional agreement. The older
captures keep exactly one job, and it is a job only they can do — **dating**. A
feature absent in 2018 and 2019 and present in 2025 was built between them,
which is how the club's reported works are told from its proposals. Everything
photo-derived from here is read off 2025-05-31 and says so in its own record;
`lidingobuild/mapping/lm2025.py` is the one reader, so four surface classes
cannot each calibrate a different rule on the same pixels and then disagree
about what the photograph says.

## 4. A centroid taken about the EPSG:3006 origin is not a centroid

The finding that cost the most and explains the most.

`geobuild/lib.mjs`'s `centroid()` summed the shoelace terms about the coordinate
origin. On a course's own local metres that is harmless, and every build here
until now used it that way. Lidingö's mapping polygons are in raw EPSG:3006,
where a bunker's cross products are each about 4.6 × 10¹² and their sum is about
−90: the answer is the ninth significant figure of a double.

| kind | median error | worst | centroids outside their own bbox |
|---|---:|---:|---|
| fairway | 0.31 m | 1.02 m | 0 of 13 |
| green | 2.83 m | 9.15 m | 0 of 20 |
| tee pad | 6.45 m | 31.05 m | 15 of 37 |
| **bunker** | **20.60 m** | **149.98 m** | **36 of 40** |

The error scales with 1/area, so the smaller the feature the worse it gets. The
sum is taken about the ring's first vertex now — algebraically identical, and
the difference between a centroid and a fiction.

What it was hiding: the bunker detector scored itself on how many of the 40
mapped bunkers it recovered, against centroids a median 20 m from the bunkers.
It reported 8 of 40, and a working rule was twice retuned to chase that. What it
changed that had already been written down: the survey's green agreement was
reported as a median 5.25 m and is 3.27 m. **The ring geometry and the model are
not affected** — the raw formula computes AREA correctly, because the area's
cancellation is benign where the centroid's is catastrophic, and the model
copies ring vertices.

## 5. Bunkers, and a blind spot with a date on it

The rule is Ribbingsfors' and Ängsö's: sand in the imagery over a hollow in the
published 1 m laser. Sand alone finds gravel paths and dry rough; a hollow alone
finds every ditch and tee terrace.

**The imagery is 2025 and the laser is 2021, so a bunker built between them has
sand and no dish and the rule cannot see it by construction.** Hole 13 is the
proof, and it is a three-way agreement: the club's course council reports
building a left green bunker there, the model carries no bunker on the hole at
all, and the 2025 capture reads 33 m² of sand at luminance 190, 22 m from the
surveyed green centre, with a hollow of essentially zero. In 2021 that ground
was still flat. The laser is not disagreeing; it is older.

Colour-only sand is therefore REPORTED as `sandWithoutHollow` — 49 patches, six
of them within 45 m of a green — and never adopted on its own. The second record
for one of these is the club's own dated statement that a bunker was built
there, read hole by hole.

**Both bunkers the club reports building are now DATED, by
`date-course-changes.py`.** A club document says something was built; three
orthophotos spanning 2018–2025 say whether the ground shows it and between which
two captures it appeared. Sand is read against mown turf 12 m away *in the same
frame*, because each capture is exposed differently and "bright" means nothing
on its own.

| site | 2018 | 2019 | 2025-05-31 | verdict |
|---|---:|---:|---:|---|
| hole 13 green bunker | −12.6 | −7.5 | **+83.7** | built between 2019 and 2025-05-31 |
| hole 17 green bunker | +6.4 | +0.7 | **+86.5** | built between 2019 and 2025-05-31 |

(luminance above that frame's own turf reference.)

Both match the club's own dated statements, and hole 17's settles a question the
older records could not: **its existing ring is the September 2024 bunker**, not
a dead one. It reads turf in 2018 and 2019 and sand in 2025 because it did not
exist when either older record was made, and it sits in no laser dish because
the laser is 2021. Four records agree in each case.

**Hole 15's ring is the phantom**: mown turf on 2018, on 2019 and on 2025, and
no dish in the laser — four records, three of them able to see a bunker there,
and none of them does.

A site is read at the model's OWN ring centroid where one exists, never at a
coordinate typed into the tool. The first draft guessed hole 17's and sampled
thirty metres of fairway, which read as no sand in every capture and would have
been written down as a refusal of the club's own statement.

## 6. Greens cannot be traced here either, and now it is measured five ways

This repository has refused traced greens once and accepted them once, and the
difference was the photograph. At Veckefjärden six methods on a 0.27 m autumn
frame reached a median IoU of 0.65 against the surveyed outlines and none was
adopted. At Ribbingsfors a leaf-off capture made mown turf vivid against dormant
pasture and all nine passed. Lidingö's frame is finer than either at 0.16 m, so
the question was open, and `lidingobuild/mapping/trace-2025-greens.py` asks it
five ways at once. Every method is scored against the **11 OSM green rings that
carry a hole** — geometry nobody read off this capture.

| method | grew on | scored | median IoU | median area ratio |
|---|---:|---:|---:|---:|
| colourgrow — region growth on excess green | 0/18 | 0 | — | — |
| firststep — per ray, the first sustained fall | 18/18 | 11 | 0.294 | 3.41 |
| largeststep — per ray, the steepest fall | 18/18 | 11 | 0.365 | 2.73 |
| roughness — growth on 1 m laser roughness | 2/18 | 2 | **0.603** | **0.786** |
| fusion — colour and smoothness together | 0/18 | 0 | — | — |

**Mown turf is one colour in this frame.** Excess green does not stop at a
green's edge: region growth from the GPS centre reaches 1,300–2,900 m² at a
compactness of 0.08–0.23, against real greens of 246–921 m², because the collar
and the approach are the same colour as the putting surface in late May. The two
polar methods do produce a ring on every hole, and both produce the wrong one —
2.7 to 3.4 times the surveyed area, which is the same "the imagery shows the
green COMPLEX and not the putting surface" that Veckefjärden measured.

The interesting residual is **roughness**. It is the only signal whose answer is
the RIGHT SIZE (0.786 of the surveyed area against the polar methods' 2.7–3.4×)
and it scores best where it works — but it forms a compact component on only two
of eighteen holes at the thresholds tried, so it is a lead and not a method. A
green really is the smoothest turf on a course; a 1 m laser over a 25 m green is
about 600 samples, and that is evidently not enough to bound it. A finer laser
would be the thing to try, not a newer photograph.

So the green rings stay as they are: 13 unchanged OSM rings and 7 traced off the
2019 frame. The bar this was measured against — median IoU ≥ 0.75 and a region
on at least 16 of 18 holes — is in the tool, and so is the refusal.

## 7. Vegetation

The bespoke stand pipeline produced 4 m stand fields and **zero individual
trees**. `record-laser-campaigns.mjs` needs no credential and no point byte, so
the campaign inventory could be pinned from a bare checkout, and pinning it is
all the generic chain needed — the ring spec's `courseModels` entry supplies the
rest.

One campaign covers the AOI exclusively: **`21c031-658_67`, captured
2021-03-23**, 217,740,127 points at 2.156 returns/m², no seam. Skogsstyrelsen
calls it Terrain Mapper Omdrev 2 and LEAF-OFF. The cloud's own class-2 ground
sits within 0.00 m of the published DTM on 63 of the 64 finest tiles — a
different sensor pass agreeing to a centimetre, and the line to read before any
other.

Two traps closed around the publish:

- **`compile-lidingo-ground-graph.mjs` would have deleted the generation
  silently.** It attaches the bespoke stands and emits the whole graph, so
  re-running it after the generic publish would produce a stands-only, ring-less
  graph — a 16 km world and thousands of measured trees gone, with every numeric
  gate still passing because the graph it produced is internally consistent. It
  refuses once a generation is live and names what to run instead.
- **`semantic-exclusions` never read `scenery.practiceGreens`**, and Lidingö is
  the ground that keeps all three of its practice greens there with
  `scenery.greens` empty — so the exclusion set knew about none of them and the
  planter was free to stand a tree on a putting surface.

Crown yield is **11.5 individuals per canopy hectare against 39–48** on
comparable grounds. That is pulse density, not leaf state: measured here, the
leaf-off canopy and the leaf-on imagery agree, so Johannesberg's deciduous
under-detection does not transfer to this ground and must not be cited for it.

## 8. Appearance

`apps/golf/src/engine/scenery/lidingo.js`. Without a module a course silently
takes the engine's defaults, and the defaults are Veckefjärden's old school —
cream render, dark red roof, three window rows. Lidingö's clubhouse is none of
those: a long, low, **white** modern pavilion under an almost flat **near-black**
roof, standing on a bank above the 18th green with a terrace and steps down to
it and two flagpoles on the lawn. One storey, so one window row.

Read off two photographs from different points on the 18th in the club's 2026
gallery, corroborated in flat daylight by a historical photograph on the club's
history page where the same low pale flat-roofed block with its entrance canopy
stands behind the subjects. Those frames establish the SHAPE and the
pale-against-dark contrast. Both modern ones are golden hour, and this
repository has already painted a clubhouse's storey blue by reading colour out
of evening light, so the wall is a neutral off-white and the roof a near-black
grey rather than a measured tint. A flat-light photograph would let both be
measured properly; there is not one yet. No downloaded photograph is committed —
they stay in the ignored cache, and one contains identifiable people.

The species rule raises the deciduous share on the club's own description and
its photographs, and on nothing else.

## 9. What is open

- **The played surfaces are two records that disagree and the file does not say
  which is authoritative**: 11 OSM green rings of 2011–2016 vintage at a median
  544 m² against 7 hand traces on the 2019 ortho at a median 412 m².
- **Green 9's ring is the one the laser refuses** — interior roughness 0.0313
  against a collar of 0.0308, where the other 17 run 1.82–3.86.
- **Seven holes carry one observed tee pad for five card tees**, and the card
  mark is placed at the pad's centroid rather than at the point inside it
  nearest the card distance.
- **Hole 13's bunker is measured and not yet in the model.**
- **The forest floor has no ground class**, so measured canopy is painted as
  mown-green rough.
- **The six par 3s carry no fairway and no semi at all.**
- Current national imagery at 0.16 m is now obtainable, so the refusals in §5
  that were caused by the 2019 capture deserve re-running rather than quoting.
