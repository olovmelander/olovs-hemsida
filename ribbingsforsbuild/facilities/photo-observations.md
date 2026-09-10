# Ribbingsfors facility photo references

Reviewed 2026-09-10. This is a visual observation record for original Blender
geometry. Plan dimensions and positions must come from the georeferenced
orthophoto, not from perspective photographs or the illustrated course guide.

The [machine-readable manifest](photo-reference-manifest.json) records source
URLs, hashes, dates, credits and local paths. Run
`node ribbingsforsbuild/facilities/acquire-photo-references.mjs` to reacquire
the selected originals. Run
`powershell -NoProfile -ExecutionPolicy Bypass -File ribbingsforsbuild/facilities/make-photo-contact-sheets.ps1`
for local review sheets. Photographs and sheets are in gitignored
`reference/photos/`; source pixels are not application textures.

## Evidence and dates

Eight selected official club photographs have WordPress EXIF-derived
`image_meta.created_timestamp` values corresponding to **2024-07-12** and carry
the credit **JENS HENDAR**. They were uploaded on 2024-07-20. The camera timezone
was not independently checked, so only the day is used. The official estate
drone image and two facade images resolve to **2019-05-19** despite their
2024 uploads. These are older exterior references, not newly captured imagery.

No redistribution licence was located for the photographs. Downloaded originals,
contact sheets and close review views remain internal research material under
the source dossier's existing media policy. Architectural shape/color observations
inform original geometry; no photograph is projected onto a model, and no source
logos, people or vehicle registration marks are reproduced.

## Selected reference inventory

| ID | Subject and modelling use | Evidence |
|---|---|---|
| `club-127` | Clubhouse east gable, side entrance, terrace end, roof and chimney | [Official original 5I8A1673](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1673_fullres.jpg) |
| `club-136` | Clubhouse south terrace facade, west gable, railings, awnings, stairs | [Official original 5I8A1924](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1924_fullres.jpg) |
| `club-128` | Clubhouse gable and nearby practice-green context | [Official original 5I8A1662](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1662_fullres.jpg) |
| `club-132` | Driving-range mat line, masonry bay dividers, red shed, bench and trees | [Official original 5I8A1645](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1645_fullres-1.jpg) |
| `club-124` | Range from another angle through mature oak branches | [Official original 5I8A1627](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1627_fullres.jpg) |
| `club-130` | Practice putting surface, reed-edged pond and farm buildings | [Official original 5I8A1648](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1648_fullres.jpg) |
| `club-139` | Small white 1–9 direction sign on pale timber wall | [Official original 5I8A1676](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1676_fullres.jpg) |
| `club-140` | Gravel/grass path and light post-and-wire pasture fence | [Official original 5I8A1880](https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1880_fullres.jpg) |
| `club-255` | Illustrated course topology; marked clubhouse, range, practice area | [Official course overview](https://ribbingsforsgk.se/wp-content/uploads/2025/05/banguideribbingsforsgolfokultur1-1-1.jpg) |
| `estate-61` | Drone panorama: estate group, clubhouse, lake, paths and lakeside building | [Official 2019 drone image](https://ribbingsforsherrgard.se/wp-content/uploads/2024/07/dji-0066-pano.jpg) |
| `estate-69` | Manor side/rear, yellow walls, red small outbuilding, stone terrace | [Official estate image](https://ribbingsforsherrgard.se/wp-content/uploads/2024/08/img1269.jpg) |
| `estate-43` | Manor front facade, symmetric openings, porch and shallow roof silhouette | [Official estate facade](https://ribbingsforsherrgard.se/wp-content/uploads/2024/07/img1140.jpg) |
| `regional-aerial` | Reverse aerial from lake: three-building manor group, boathouse and jetty | [Naturkartan place page](https://www.naturkartan.se/sv/vastra-gotalands-lan/ribbingsfors-golf-kultur) |
| `vgr-manor-veranda` | Detailed manor veranda/balcony joinery; pale surrounds with red window sashes | [VGR conservation page](https://www.vgregion.se/f/kulturforvaltningen/natur-och-kulturarv/platser--landskap/underverk-i-vastra-gotaland/ribbingsfors-herrgard-gullspangs-kommun/) |
| `museum-granary` | Old granary/agricultural museum; source URL retained, download HTTP 409 | [Museum operator page](https://www.hembygd.se/amneharad/page/31889) |

The selected package contains 14 downloaded image references (including one
illustrated overview), plus the unavailable museum photograph URL. The manor
site's unrelated interior photographs and stock activity imagery were excluded
after contact-sheet inspection.

## Clubhouse: high-confidence visible details

`club-127` and `club-136` show opposite gables around the same long terrace facade.
Cardinal labels below follow the orthophoto alignment supplied to the Blender
builder; the photographs alone do not establish north.

- The building is an elongated rectangle with a simple symmetrical gable roof.
  A single tall ground-floor wall includes an attic knee wall below the eaves.
  Pale warm-yellow vertical board-and-batten siding continues into both gables.
- Corner boards, window surrounds and bargeboards are pale grey. Window frames
  and muntins are grey; the dark glazing should remain darker than the trim.
- The red/orange tiled roof is weathered and mottled with grey/green patches.
  Model a subdued clay roof, dark gutters and downpipes, pale projecting fascia,
  and a red brick chimney with a flat cap. Aerial/antenna, satellite dish and
  small roof vents are visible but secondary at course-view distances.
- The terrace facade has **three small horizontal two-pane upper lights** below
  the eaves. Tall multipane ground-floor glazing flanks the entrance, with a
  partly obscured central opening. Umbrellas prevent a definitive measured
  elevation drawing of every opening.
- The east gable in `club-127` has a tall upper two-sash multipane window,
  a lower glazed door towards the terrace side, and a smaller lower window
  towards the other side. The entrance has a small concrete threshold.
- The west gable in `club-136` has upper and lower rectangular multipane
  windows and a distinctive **small circular window** towards the terrace side.
- The timber restaurant terrace runs along the south facade and extends around
  the west end. Its weathered grey balustrade uses repeated **X bracing**, square
  posts and horizontal rails. Broad short stairs open through the front railing.
  The deck sits low at one end but is visibly raised over the lawn elsewhere.
- Two retractable pale awnings with thin muted stripes sit over the long-facade
  ground-floor glazing. Furniture includes pale grey chairs/tables, a large pale
  umbrella, a smaller green umbrella, and folded umbrellas. Their photographed
  positions are movable context, not fixed architectural measurements.
- Gravel borders the east/terrace access area; a stone/concrete foundation strip,
  planters and small bins are visible. A small timber-covered fixture with tap
  stands on the lawn before the west half of the terrace.

### Clubhouse implementation assumptions

`model_clubhouse.py` consumes the traced orthophoto roof outline. Its walls are
inset 0.36 m from the roof edge as an architectural estimate. Eaves are 4.55 m and
ridge 6.95 m above the model's foundation datum; these heights are **not surveyed**.
The foundation uses a single median corner/centre terrain level plus 0.14 m,
with its lower face below the minimum sampled ground. Terrace depth 3.20 m,
west return 2.05 m, furniture sizes and spacing are also estimates. The north
facade remains plain because it has no adequate close photographic evidence.
The former inferred north annex is excluded by the updated orthophoto review.

## Range and practice ground

`club-132` provides strong evidence for an **open mat line**, not a continuous
covered range building. Green rectangular hitting mats occupy a pale square-paver
strip along a light gravel lane. Short grey **masonry-block dividers with flat
brown coping** separate the bays. At least seven divider faces are clearly
visible; additional separators near the shed are partly obscured, so this image
alone does not establish an exact bay count. These are physical low walls, not
advertising panels.

At one end stands a small red vertical-timber **gable-roofed shed**, with white
bargeboards/base trim and an open side/front containing diagonal timber lattice.
A dark wooden picnic table stands beyond the other visible end. The range field
has a small white distance marker reading 50 in this view. No tall net fence or
continuous bay canopy is visible in the selected images. Absence from one angle
does not rule out equipment outside the frame.

Mature oaks border and overhang the facility. `club-124` is taken through an oak
in the foreground; it does **not** establish that an oak stands inside the range
landing field. The range photographs are useful for equipment type and materials,
but they do not independently locate the tee line or prove the direction of play.

`club-130` shows a low-cut practice surface with small practice flags, a reed-edged
pond immediately beside it, and two substantial farm/estate buildings in the
background. Their upper walls are dark red timber; their lower walls appear
warm ochre masonry with repeated small openings. A light track passes between
the practice ground and the buildings. This scene must be spatially matched to
the orthophoto before assigning either building a particular use.

The [official club description](https://ribbingsforsgk.se/klubben/) confirms a
driving range, chipping/putting facilities, restaurant and motorhome/caravan
facilities. It does not provide their measured footprints or heights.

## Manor and nearby facilities

The [VGR conservation description](https://www.vgregion.se/f/kulturforvaltningen/natur-och-kulturarv/platser--landskap/underverk-i-vastra-gotaland/ribbingsfors-herrgard-gullspangs-kommun/)
states that the manor comprises a principal house, two wings and ancillary garden
buildings, with most farm buildings farther east. The principal house has two
full storeys, a basement and attic; the wings have one-and-a-half storeys. It
identifies broad pale-yellow vertical boarding, pale-grey joinery and **slate
roofs** on the principal house and wings, with metal over the frontispieces and
verandas. Its page was last updated 2021-07-15, not a photographic capture date.

The estate photographs corroborate the two-storey yellow principal house,
symmetrical rectangular windows, central triangular pediment and broad ornate
veranda/balcony. The close VGR image shows red/brown window sashes inside pale
surrounds: avoid making all manor joinery one colour. This architecture is
distinct from the simpler clubhouse and its red clay roof. The 2019 drone and
undated reverse aerial also show a small red lakeside building with pale window
surrounds and a nearby narrow jetty; their exact construction and present-day
condition require closer evidence.

The [museum operator](https://www.hembygd.se/amneharad/page/31889) places its
agricultural museum in the estate's old granary. The linked image storage returned
HTTP 409 when fetched; its exterior is not treated as downloaded visual proof.

## Remaining evidence gaps

- Measured clubhouse elevations, rear facade and precise terrace/stair extents.
- Exact range mat/divider count, shelter dimensions, tee-line position and heading.
- Current capture dates and close exteriors for estate wings, service buildings,
  maintenance yard, museum/granary, lakeside structures and caravan utility points.
- Whether any visible 2019/2024 movable facility equipment has since changed.

These gaps should remain visible in modelling metadata. They do not prevent a
useful, reviewable model of the observed clubhouse and range equipment.
