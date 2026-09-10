# Johannesberg facilities: web photograph references

Collected on 2026-09-10 for the private Blender reference pack. The [source manifest](web-reference-sources.json) selects **20 exterior photographs and three map documents/renders**, with public source URLs, retrieval timestamps, SHA-256 hashes, pixel dimensions, identified views, capture-date evidence, and limitations. Selected files total approximately 20.9 MB. Originals and page/API evidence are retained under the ignored `johannesbergbuild/cache/facilities-reference/web/` directory.

The strongest clubhouse set is three complementary elevations: the detailed front/right-gable photograph, the opposite gable from hole 9, and the elevated rear view from the hotel. Use these with the orthophoto footprint and roof-height evidence; the photographs themselves are uncalibrated perspective views.

| Reference ID | Capture-date evidence | Useful modelling information |
| --- | --- | --- |
| `club-media-4558-original` | Publisher metadata: 2018-09-19 | 5333 × 3000 front/right-gable detail: red vertical timber, tiled roof, dormers, balcony, white window trim, entrances, side porch and terrace. |
| `club-media-3970-original` | Publisher metadata: 2018-09-19 | 5333 × 3000 complete front elevation with terrace pavilion, flagpoles, practice ground and approach paths. |
| `club-media-6642-original` | Publisher metadata: 2024-10-30 | 4000 × 1800 opposite gable and terrace pavilion from hole 9. The central building is clear; strong peripheral depth blur limits other details. |
| `club-media-6713-original` | Publisher metadata: 2024-10-30 | 4000 × 3000 elevated rear view: lower-storey doors/windows, range mat line, two small red range structures, practice bunker, parking and lamps. |
| `club-news-20260808` | Publisher metadata: 2026-08-08 | Recent terrace pavers/deck, wood-slat chairs/tables and red estate buildings across the lane. A person obscures much of the centre. |
| `club-media-5983-original` | Capture unknown; published March 2025 | Open range mats, dividers, benches and apron. Useful low-resolution detail; the photo does not establish every bay or structure. |
| `dji-0003`, `dji-0004` | Unknown | Complementary oblique estate aerials, roof shapes, courtyard arrangement, entrances, terraces and parking. |
| `dji-0011`, `20210617-p1022081-hdr-enhanced` | Unknown | Main hotel/manor entrance facade and column portico from two angles. |
| `stra-flygeln-1`, `v-stra-flygeln-2` | Unknown | Officially named east/west hotel-wing facade photographs. |
| `jbs-54_orig` | Unknown | Official Karolinerhuset facade: square tower, front veranda, roof and dormers. |
| `jbs-flygbild-spa-1080` | Unknown | Large event building, adjoining spa annex/pool area, and nearby red-roof villas from above. |
| `img-3042` | Unknown | One red-roof Slottsvilla facade; east/west identity remains unresolved in this photograph. |

The remaining selected photographs provide wider estate context, a course-facing hotel view, portico detail, and the driving-range field. `selected-contact-sheet.jpg` in the cache gives an overview of all 20 selections.

## Building names and scope

The red golf clubhouse is inventory facility `johannesberg-clubhouse`, source building `w296165896`. Its adjoining terrace is `johannesberg-clubhouse-terrace`. The hotel manor, hotel restaurant/reception and other estate buildings are separate facilities. Current restaurant references are on the [official golf restaurant page](https://johannesbergsgolf.se/restaurang/) and the [associated hotel's golf page](https://www.johannesbergsslott.se/johannesbergs-golf.html); precise internal room arrangements are outside this exterior reference pack.

The [official labelled estate map](https://www.johannesbergsslott.se/uploads/1/3/2/7/132774402/karta_jsb_2.pdf) identifies the hotel main building, east/west wings, Karolinerhuset, east/west Slottsvillor, Johannesbergs Villan, Johannesbergs Flygel and a private residence. In particular, **Johannesbergs Flygel** is the large event building; the map labels **Johannesbergs Villan** at its adjoining lower spa/gym/pool section. Use the map and the separate orthophoto inventory to resolve each footprint. `estate-map-page-1.png` is a faithful raster of the map's single PDF page. The [official parking page](https://www.johannesbergsslott.se/parkering.html) supplies the related annotated aerial parking image.

Facility IDs for named hotel buildings match the site-inventory vocabulary. Group/context IDs such as `johannesberg-driving-range`, `johannesberg-range-sheds` and `johannesberg-parking` describe visible areas; they do not assert a surveyed building identity. The two Slottsvilla IDs on `img-3042` are alternative candidates, not a claim that both buildings appear in the photo. The range's small red lean-to may contain dispensing or storage equipment, but no retrieved label establishes its function. The other range hut and the large red estate buildings also need inventory matching before assigning functions.

## Dates and detail limits

Capture dates for the dated golf photographs come from the public publisher's WordPress `image_meta.created_timestamp`; the source API responses are pinned in the manifest. Camera clocks and time zones were not independently checked. Upload dates and HTTP `Last-Modified` dates are recorded separately and are not treated as capture dates. Photographs without capture metadata remain undated, including those whose filenames resemble dates.

The detailed 2018 clubhouse photographs and October 2024 rear/gable photographs predate the reported 2025 clubhouse/restaurant renovation. The August 2026 terrace photograph contributes recent surroundings and furnishing evidence, but it does not establish the complete current clubhouse facade. No unseen wall, measured window spacing or current interior layout should be invented from these references.

The 2026 terrace photo's larger public original is also retained and hashed in its `originalAsset` record. That original is sideways and lacks orientation metadata; a viewer needs a 90-degree clockwise rotation. The primary selected publisher-scaled image is already upright, so it can be used directly on a Blender reference board.

## Source handling

All selected photographs came from the [official golf club](https://johannesbergsgolf.se/), the [official hotel gallery](https://www.johannesbergsslott.se/galleri.html), or [official named-building sections](https://www.johannesbergsslott.se/konferera-i-eget-hus.html). Public WordPress attachment metadata exposed unscaled 5333-pixel clubhouse originals and the 4000-pixel October 2024 photographs. Where such an original was available, it was preferred over duplicate thumbnails.

The Carlotto Persson credit/copyright embedded in publisher metadata is preserved. Reuse or redistribution permission has not been established for these images; all are marked **reference-only**, and none is designated as a model texture or public runtime asset. The original bytes remain unchanged. The labelled contact sheet and PDF page raster are clearly marked derivatives for inspection.

AI-labelled Firefly/Gemini homepage artwork, Unsplash stock golf photos, unrelated landscapes, interior-only photographs and redundant scaled copies were excluded from the selected exterior set. Public source-page HTML and API responses are retained for provenance. No account, private photo archive or contact with a third party was used.

All 23 selected files were checked for existence and SHA-256 integrity; the dimensions of every selected raster matched its manifest entry. The web intake is complete, with remaining date, identity and visibility gaps explicitly recorded in the manifest.
