# Ängsö facilities: photographs and documentary references

Retrieved 2026-09-10. The stable machine-readable inventory is [photo-sources.json](photo-sources.json). It contains 16 curated visual references, source URLs, local originals, dimensions, hashes, observations, known gaps, and chronology. Four discovery contact sheets retain the wider review; two curated sheets show the useful modeling references.

## What is established

The strongest combination is the tourism-board courtyard photograph, the club's drone overview, its accommodation exterior collage, the restaurant entrance photo, and the labeled camper-site diagram. Together they distinguish the long restaurant building, detached reception/kansli wing, and lodging/changing annex. The annex has a white lower facade with separate doors, red upper timber facade, dormers and rooflights, and an external timber balcony/stair at its south gable. The restaurant has a central white balcony/porch, dormers, and a long glazed rear extension.

The [club's camper page](https://angsogolfklubb.com/gast/husvagn-husbil/) identifies kiosk/toilets, cart shelter, putting green, range, parking and 18 camper spaces. Its downloaded map is a **schematic site diagram**: use it for functions and relationships, not metric footprints. The club documents 12 camper spaces on grass and six on gravel; the [charging page](https://angsogolfklubb.com/laddstolpar/) documents seven charging posts serving 14 spaces.

The [2024 annex update](https://angsogolfklubb.com/2024/02/05/ordforandes-nyhetsbrev-v-5-2024/) confirms lodging and changing rooms share the annex. The [2020 annual report](https://media.angsogolfklubb.com/2021/03/Arsmoteshandlingar-2020.pdf) records cart carport, kiosk/toilet terrace, notice board and ball-wash roof work. The [club blog](https://angsogolfklubb.com/blogg/) identifies on-course toilets at holes 5 and 15 and water/club washing between clubhouse and putting green; their detailed positions and facades remain gaps.

## Proposal drawings are available

The six-page [range/bag-store proposal](https://angsogolfklubb.com/wp-content/uploads/2024/10/Oversikt-range-utslag-och-bagrum.pdf) supplies site plans, floor plans, roof plans, sections and elevations. It is explicitly **FÖRSLAGSHANDLING**, dated 2024-09-27 / 2024-10-10, and says it is not a construction drawing. The proposed range has ten covered bays across 41.430 × 6.000 m with a 9° roof; the bag store is 6.600 × 4.730 m with a 22° roof. The material schedule specifies red vertical timber, red standing-seam metal roofing and white trim.

The [December 2025 announcement](https://angsogolfklubb.com/2025/12/04/beviljat-stod-fran-arvsfonden/) planned project start for autumn 2026. These drawings support a separate proposed-facilities collection; they do not prove anything was built. Rendered PDF pages and the original PDF are cached.

## Controls and remaining gaps

- Roof footprints, heights, pitches and absolute placement must come from controlled ortho/laser measurements. Ground photos are perspective evidence.
- Older parking-side photos show an orange restaurant roof; the later drone and current orthophoto show a dark rear roof face. The material/change date is unresolved. Preserve the newer visible roof condition.
- Courtyard trees obscure windows; concealed/back walls, kiosk rear, carport bay count, range machine details and small ancillary-building functions need better photos or a site survey.
- Current interior photographs do not provide floor plans or exact room coordinates.
- The club media contains images explicitly named after image-generation tools. Eighteen discovered generated candidates are excluded from geometry evidence, with exact URLs retained in the manifest. Stock-looking, promotional, food and unrelated course images are also excluded from the curated selection.
- No open license was established for these photos. They are local modeling references, not runtime textures or cleared promotional assets. Credits and EXIF metadata are retained where present. Upload dates, filenames and EXIF modification dates are not asserted as original capture dates.

## Reproduction

Run `node angsobuild/facilities/acquire-photo-references.mjs`, then `node angsobuild/facilities/download-photo-candidates.mjs`. Run `build-photo-contact-sheet.py` with the repository's Pillow-enabled Python to inspect candidates. `curate-photo-references.mjs` writes the final manifest using inspected source files; `render-curated-photos.py` checks raster dimensions and renders the final contact sheets. Supplemental original files and public media-search responses remain in the cache with source URLs; the PDF render uses PyMuPDF installed only under that cache.
