# Lidingö Golfklubb: source research and initial intake

Research date: 2026-09-07. This is the club-reference part of the initial intake,
following the [v2 runbook](../v2-course-runbook.md) and
[mapping workflow](../v2-course-mapping-workflow.md). Its factual scorecard can
support the course preview and the provisional 3D model. It does not approve a complete 3D ground or claim
that downloaded photographs, diagrams or architectural proposals are surveys.

The [implementation handoff](../../lidingobuild/mapping/NEXT-SESSION.md) now
records the working 18-hole 3D course: preserved Lantmäteriet 1 m terrain,
90 observed/source surface polygons, measured 2021 canopy stands and source
water levels. Official municipal metadata confirms CC0 for the retained 2019
orthophoto. Current 2025 national imagery access, independent controls and
recent course changes remain unresolved; the original club references below
remain evidence rather than surveyed geometry.

## Retained evidence

The [asset ledger](../../lidingobuild/reference/club-source-assets.json) records
128 retrieved assets: exact URLs, byte counts, SHA-256, response metadata,
retrieval timestamps, parent pages and rights decisions. There are 13 HTML
pages, 109 images and six PDFs, totaling 114,708,515 source bytes. Eighteen
club-linked hole flyover URLs are also indexed; video bytes were not downloaded.

Original bytes and imagery-containing review sheets remain under ignored
`lidingobuild/reference/cache/club-2026-09-07/`. The repository keeps compact
provenance and factual observations. Public viewing access does not establish
image redistribution or permission to derive production geometry. No club,
photographer or architect was contacted during this intake.

| Resource | Retrieved coverage | Use and limit |
|---|---|---|
| [Club course description](https://www.lidingogk.se/banan/) | Official HTML | Identity and general course character. |
| [Current scorecard and rules page](https://www.lidingogk.se/banan/slope-lokala-regler-aeven-scorekort/) | HTML, scorecard image, two slope PDFs, 2026 rules PDF | Official numeric card; no tee coordinates. |
| [Club's new guide](https://www.lidingogk.se/banan/nya-banguiden/) and [embedded guide](https://banguider.se/lidingo-golfklubb/18-halsbanan) | 18 hole WEBPs, 1146 × 3638 pixels each, and a 1958 × 2403 overview PNG | Routing and feature corroboration. The guide credits Greenbird Golf; no georeferencing, capture date or reuse grant is supplied. |
| [Flyovers](https://www.lidingogk.se/banan/flyover/) | 18 YouTube references, explicitly titled 2023 | Ground-level and aerial appearance before later documented changes. Playback has not been reviewed hole by hole. |
| [Main photo gallery](https://www.lidingogk.se/banan/bildgalleri/) | 49 distinct original images | Mixed historical/current photography, not an acquisition-year dataset. |
| [2026 photo gallery](https://www.lidingogk.se/banan/bildgalleri/bildgalleri-2026/) | 33 distinct original images | Current appearance candidates; individual viewpoints and capture dates need review. |
| [Historical routing](https://www.lidingogk.se/banan/banstraeckning-historiskt/) | Four images covering 1927/1936, 1939/1965, 1978/1985, 2009 | Explains historical routes; do not adopt as current geometry. |
| [Course council](https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/) | HTML, photograph, two dated planning PDFs | Separates reported completed works from proposals. |
| [September 2024 report](https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/information-2024-09-17/) | HTML and photograph | Dated course-change evidence. |
| [Practice areas](https://www.lidingogk.se/trana/rangen-ovningsomraden/) | HTML, photograph, architectural concept PDF | Facility identity and a proposal to compare with completed work. |
| [2026 maintenance report](https://www.lidingogk.se/banan/banchefen-informerar-2026/) | HTML | Dated maintenance context and range-net construction. |
| [Webcam page](https://www.lidingogk.se/banan/webbkamera/) | HTML | Describes the putting green and hole-4 green looking toward the clubhouse. The embedded video is a viewing reference, not a survey. |

The live HTML galleries contain more images than the search-engine text
snapshots showed. Counts above come from retained source HTML and successful
downloads, not search snippets. The
[validation report](../../lidingobuild/reference/club-evidence-validation.json)
records actual image dimensions and available EXIF date fields. EXIF `DateTime`
can mean editing time; it is not promoted to a verified capture date.

## Course identity and card decision

The club describes an 18-hole, grass-tee, wooded park course with par 70, divided
33 out and 37 in. It opened for 18-hole play in 1927; the present club formed in
1933. The club reports substantial reconstruction in 2006–2009.
[Official course description](https://www.lidingogk.se/banan/).

The [machine-readable card](../../lidingobuild/reference/club-scorecard.json)
contains all 18 pars, stroke indexes and 90 tee distances, visually transcribed
from the [official current card image](https://www.lidingogk.se/media/4kcbkotc/scorekort-2025.jpg).
Its filename says 2025; the enclosing club page presents it as current alongside
2026 local rules. Do not rename its edition to a surveyed 2026 card.

| Tee | Out, m | In, m | Total, m |
|---|---:|---:|---:|
| Vit | 2569 | 3217 | 5786 |
| Gul | 2397 | 2976 | 5373 |
| Blå | 2221 | 2837 | 5058 |
| Röd | 2041 | 2477 | 4518 |
| Orange | 1775 | 2190 | 3965 |

All printed front/back/total distances and pars were checked. Stroke indexes
form exactly the permutation 1–18. A visual comparison of all 18 guide headers
found that every shared distance, par and index agrees. The guide depicts orange
only on holes 1–9; orange lengths for 10–18 are present on the official scorecard
but orange positions are absent from those guide diagrams. Keep the published
card facts, and leave those positions unresolved. Numeric lengths do not prove
that a dedicated pad exists.
[Interactive guide](https://banguider.se/lidingo-golfklubb/18-halsbanan).

The slope PDFs are named 2023 and internally say the course was rated
2016-04-12. Men's CR/slope values are white 71.9/134, yellow 69.6/129,
blue 68.2/126, red 65.5/119. Women's values are yellow 75.6/131,
blue 74.0/128, red 70.2/120. Neither document supplies an orange rating.
[Men's slope PDF](https://www.lidingogk.se/media/ja3famzb/nya-slopen-herrar-2023.pdf),
[women's slope PDF](https://www.lidingogk.se/media/y50p3jos/nya-slopen-damer-2023.pdf).

## Dated drawings and source conflicts

The [December 2024 masterplan, version 11](https://www.lidingogk.se/media/2g3lyjer/lidingoe-golfklubb-masterplan-11-fastighetsgraens-20241217.pdf)
is expressly a conceptual masterplan by Johan Benestam. It overlays an aerial
image and includes a property outline, greens, tees, waterways, bunkers, trees,
paths and practice areas. Its table of existing lengths dated 2024-12-17 agrees
with all five official scorecard totals and per-hole lengths. The PDF contains
no detected GeoPDF CRS/viewport/measurement keys. An aerial background and a
property outline do not supply an approved georeferenced boundary. Planned
features cannot be silently treated as completed course objects.

The [2025-03-26 development schedule](https://www.lidingogk.se/media/mkoncf03/banutvecklingsplan-lgk-2025-03-26.pdf)
contains proposed future bunkers, tree planting, rear-nine shorter tees, pond
expansions and other projects. Its planned dates are not completion evidence.
For example, its tree count for the first phase is about 13, while the later
course-council page reports about 15 planted. Retain this difference; neither
number identifies individual stems. The schedule lists rear-nine orange-tee
work for 2026 conditional on the front-nine results. Therefore rear-nine card
lengths, proposed pads and constructed pads remain distinct evidence classes.

The [practice-area concept dated 2023-04-21](https://www.lidingogk.se/media/trnbyitl/liding%C3%B6-golfklubb-konceptuell-plan-%C3%B6vningsomr%C3%A5det-20230421-ravinen.pdf)
is draft 6, at 1:500 on A3. It explicitly allows field adjustments and calls for
the architect's setting-out approval. It has conflicting text labels for green
and site areas. Use the as-built facility and current measurements to settle
boundaries; do not resolve those inconsistencies by choosing the larger value.

## Changes that matter to mapping

The [September 2024 report](https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/information-2024-09-17/)
records a new hole-17 green bunker and mowing-contour work, especially holes
10–13 and 16, plus drainage work near greens 3, 10 and 16. It describes orange
tee development as starting with the front nine. Thus the 2023 flyovers predate
several features relevant to a present-day model.

The [course-council page](https://www.lidingogk.se/klubben/kommitteer-sektioner/banraadet/)
reports the new upper-parking practice area opening on 2025-05-17, a left
green bunker on hole 13, approximately 15 trees planted between 17 and 18, new
orange tees on 6/7/8, and ditch renovation. Its 2026 section reports improved
path ends and drainage on several holes, but describes other works in future
tense: changes near 5/8 and right of 9 green, widening the path from 18, and
safety nets near 4 and the kiosk by 10. Check completion separately for each
site, particularly where an old plan and recent imagery disagree.

The [2026 maintenance page](https://www.lidingogk.se/banan/banchefen-informerar-2026/)
mentions range truss posts and new netting being installed during spring.
The [practice-area page](https://www.lidingogk.se/trana/rangen-ovningsomraden/)
identifies practice greens around the clubhouse, south of the range, at old
green 17, and beside the upper parking area. It gives inconsistent approximate
range-bay totals (about 35, versus 14 north plus 18 south); do not instantiate a
precise bay count from that paragraph alone.

The [local rules approved 2026-03-16](https://www.lidingogk.se/media/tl1nt1n3/lidingoe-gk-lokala-regler-2026-03-16.pdf)
identify road-defined out of bounds at Kyttingevägen right of green 2 and left
along 11, and Trolldalsvägen behind greens 12/14 and left along 15. They also
identify staked young trees as no-play zones. These facts help review road and
tree semantics; they do not give surveyed lines or individual tree positions.

## Next mapping work and acceptance gates

1. Align current licensed orthophoto and municipal/base mapping with the
   independent canonical frame; establish usable controls and residuals before
   tracing. This club-reference intake has no approved survey control points.
2. Compare all 18 played routes against the current guide and images; prioritize
   orange tee identity, hole-13 and hole-17 bunkers, changed mowing contours,
   17/18 plantings, practice grounds, range nets, path ends and renovated ditches.
3. Keep proposed masterplan geometry in an observation layer. Acquire licensed
   as-built GIS/CAD or reviewed current imagery for actual surface adoption.
   Confirm completion of 2026 work individually; publication year is insufficient.
4. Acquire/check terrain, orthophoto, water breaks and vegetation through the
   authoritative geodata adapters. The accompanying ground source manifest owns
   those acquisition results; club photos do not fill missing survey layers.
5. Keep per-category gaps visible. Buildings, bridges, signs, fences, drainage,
   paths and individual trees need dated geometric evidence, dimensions and
   object identity; do not populate every hole with stock objects.
6. Finish per-hole source/model comparisons and independent human visual review
   before claiming the v2 course release gates are met. A card/route preview is
   retained comparison view; the implemented 3D model remains explicitly provisional.

## Reproduction and verification

```powershell
node lidingobuild/reference/acquire-club.mjs
& 'upsalabuild/cache/review-venv/Scripts/python.exe' lidingobuild/reference/verify-club.py
git diff --check
```

The acquisition script reuses and verifies retained bytes for this fixed dated
snapshot. An update should use a new dated snapshot, preserving the old evidence
and its ledger. The verifier requires Pillow; the example reuses the existing
local review environment. It checks all 128 hashes/byte counts, 18 guide headers,
18 hole-labeled flyover links, all card totals and the index permutation.
These are structural checks and a machine visual transcription review, not
independent human approval, survey validation or image reuse permission.
