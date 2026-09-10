# Puttom facility photographs

Collected and visually reviewed 2026-09-10. The [machine-readable manifest](web-reference.json) pins **25 photographs, 33.9 MB**, with original URLs, landing pages, local paths, pixel sizes, SHA-256 hashes, date evidence, rights and observations. Originals are in `puttombuild/cache/facilities-reference-2026-09-10/photos/`; downloaded page snapshots are in the adjacent `html/` directory.

The strongest discovery is the club's [Flygbilder 2014 album](https://www.flickr.com/photos/puttom/albums/72157682928372255/): twelve oblique aerial photographs around the clubhouse, range and parking, captured on **14 June 2014**. The filenames and Flickr `dateTaken` agree. These complement current orthophoto footprints and ground photos; the 2014 practice surfaces and movable equipment need comparison with newer evidence.

## Start with these photographs

| Reference ID | What it resolves |
|---|---|
| `clubhouse-2018` | Main entrance facade, two levels of windows, white trim, door canopies, brick chimney and fenced terrace. |
| `flickr-34163073056` | Nearly frontal view of the tall glazed clubhouse gable and its white grid; attached low annex and caravan area. |
| `flickr-34163074006` | Clubhouse side extension, raised blue-grey base, long annex connection and separate small building beside access curve. |
| `flickr-34163072946` | Side roof construction, courtyard, Härbre, complete range/shop outline and maintenance group. |
| `flickr-34163073026` | Reverse angle of L-shaped range/shop, paved inner court, curved hitting arc and separate end hut. |
| `harbre-2018`, `winter-sign` | Härbre log construction, clock, double upper window, blue-green chevron door, little gable canopy and side shelter. |
| `range-2025` | Ball dispenser, red vertical siding, bay paving, small hut, rope posts and net construction. |
| `range-2026` | Current-era mats, trays, paving and distant maintenance buildings. Shows missing left-side net sections at that date. |

Use [the original clubhouse and Härbre article](https://puttom.se/nyheter/puttom-soker-restaurator/) to verify identity. Its 2 March 2018 publication date is **not** a known exposure date. Other official media with dated upload folders likewise retain an unknown capture date unless independently supported.

## Architectural corrections supported by the images

The clubhouse has a tall glazed gable, and the glazing returns around its corners. The long entrance facade otherwise has small horizontal upper windows and taller lower windows. The opposite long side has a lower roof extension, with a raised blue-grey base visible in the aerials. A narrow low wing links to a long red annex beside the caravan pitches. These shapes need separate volumes. The roof appears brown-grey, with tile-like texture in the entrance photograph; the exact material and neutral colour remain unverified. See [entrance photo source](https://puttom.se/nyheter/puttom-soker-restaurator/) and [side aerial](https://www.flickr.com/photos/puttom/34163074006/).

Härbret is a substantial red **horizontal-log** structure with exposed corner joints, a gabled roof, clock and upper double window. Its visible door canopy and side shelter are distinctive. Historical refreshment use is established, but [the club moved that service into the restaurant in June 2020](https://puttom.se/nyheter/nu-flyttar-harbret-in-i-restaurangen/); the building's appearance does not establish current kiosk operation.

The range/shop is L-shaped with intersecting gable roofs. Its open hitting arc uses green mats on pink and pale paving, with blue posts and white rope behind the mats. A metal ball dispenser sits outside red timber siding. There is a small separate hut at the far end of the arc. The club's [range opening notice from April 2026](https://puttom.se/nyheter/driving-range-%C3%A4r-%C3%B6ppen/) records collapsed left-side net poles and a toilet in the machine hall through the rightmost glass door. Later pole work means the net in older photos is not a complete present-day survey.

## Facilities that need identity confirmation

The [2026 junior programme](https://www.puttom.se/juniorer) explicitly names overnight rooms in **Björnakojan and Juniorstugan**. It does not identify their footprints. The five-cottage guide found at `oggk.se` belongs to a different club and was excluded. Nearby houses should remain unnamed until there is site-level evidence.

[Golfhallen](https://puttom.se/golfhallen/) has two Trackman simulator bays, shown in the downloaded interior image. This does not establish which exterior building contains them. The [local rules](https://puttom.se/lokala-regler/) identify the pump house near hole 14's ditch; no close exterior photo was confidently matched to it.

The maintenance group is visible in the oblique aerials. [Maskinhall 930622](https://www.flickr.com/photos/puttom/40308800582/) is a photograph of construction on **22 June 1993**, supported by its title and the photographed print's date stamp. Flickr's February 2018 `dateTaken` records the reproduction, not the construction. Keep it as historical structural evidence until matched to a present footprint.

## Reacquisition and limits

Run `node puttombuild/facilities/refresh-web-reference.mjs` from the repository root. Existing bytes are verified; missing images download only when they match their pinned hashes. Changed provider images require review.

Every image was inspected. The Flickr originals carry license code 0 (all rights reserved); no production reuse license was established for the website/directory images. This collection is local modelling reference material, with `productionTextureApproved: false` throughout. It contains no measured elevations, surveyed facade dimensions or verified 2026 close views of every building.
