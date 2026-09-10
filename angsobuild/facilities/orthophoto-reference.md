Ängsö facility orthophoto reference, prepared 10 September 2026.

The live Lantmäteriet STAC catalog still selects **orto-o2-2025** as the latest complete campaign covering Ängsö. Native RGBI spacing is **0.16 m**; imagery was captured **24 April 2025**. The product supplies orthophotos rectified in the ground plane. Source: [Lantmäteriet Ortofoto Nedladdning](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ortofoto-nedladdning/).

`orthophoto-reference.json` supplies seven georeferenced PNG/GeoTIFF panels, source URLs and hashes, 24 interpreted roof/surface rings, and 21 separately marked existing model polygons. The images themselves remain in `angsobuild/cache/facilities-2026-09-10/ortho/`. Each PNG has a pixel-centre `.pgw` worldfile and EPSG:3006 `.prj`. A `*-review.png` and matching `*-overlay.png` show the cyan interpretation without changing source pixels.

| Panel | Sampling | Contents |
| --- | --- | --- |
| facility-overview | 0.80 m, averaged | Campus, RV parking, whole range and neighbouring land |
| campus-native | 0.16 m | All visible campus roofs, kiosk, cart shelter, parking, putting and covered range tee |
| clubhouse-detail | 0.16 m | Restaurant, reception, changing/lodging annex, two courtyard canopies |
| range-native | 0.16 m | Range shelter, hitting strip, target circles and range extent |
| northern-service-native | 0.16 m | Large equipment-yard roof approximately 1 km north of clubhouse |
| northern-neighbours-native | 0.16 m | Four neighbouring roofs; ownership and use unconfirmed |
| western-hole18-context | 0.16 m | Hole 18, ponds and campus road alignment context |

Blender origin is **E605530, N6605140** in SWEREF99 TM (EPSG:3006), with X east, Y north and Z up, in metres. Therefore `X=E-605530`, `Y=N-6605140`. Image-edge coordinates map as `E=minE+x*pixelSizeM`, `N=maxN-y*pixelSizeM`. Pixel centres add 0.5 to integer column and row. The legacy runtime frame is separately recorded and requires the full EPSG:3006→WGS84 transform; do not merely swap axes.

Fourteen B-series rings describe visible campus/service roofs or canopies, including separate B04a annex-end roof; four N-series rings describe neighbouring roofs. Six S-series rings describe parking hardstanding, putting turf, range hitting strip and provisional terrace edges. Roof shapes are **image envelopes, not surveyed wall footprints**. In particular, B01 has a complex southwest roof junction, B02 is a narrow northwest strip, B04 includes a small east projection, and B08 is partly shadowed. Heights and wall bases are intentionally absent from these rings. See `height-reference.json` for separately dated candidate laser support.

Function matching uses the club's current [motorhome page](https://angsogolfklubb.com/gast/husvagn-husbil/) site diagram, saved by the photo-reference task as `club-motorhomes--angso-gk-stallplatskarta-nytt-format-scaled.jpg`: B restaurant, A reception/office, I changing rooms, G kiosk/toilets, H golf carts, E driving range and F putting green. The site diagram is schematic and was **not** used to measure coordinates. Club publications establish lodging in the changing-room annex. Unlabelled roofs remain unassigned; proximity does not establish club ownership.

The April 2025 orthophoto predates the club's December 2025 announcement of a new golf studio and covered range tees. This set supports the observed 2025 condition, not a verified September 2026 as-built model. See `photo-reference-report.md` for dated evidence and current-state gaps. Pixel spacing does not establish absolute positional accuracy; elevated roofs can appear offset from their walls. Roof pitch, facade openings, hidden joints, overhangs and structural details require photographs or measured support.

Reproduce from repository root:

```powershell
node angsobuild/facilities/recheck-orthophoto.mjs
geobuild/cache/ortho-venv/Scripts/python.exe angsobuild/facilities/prepare-orthophoto.py
```

The existing ignored `.env` or `LANTMATERIET_*` environment variables supply authenticated access; credentials are not written to references. The importer verifies HTTP range access, source EPSG grid and resolution, RGBI band interpretation, complete masks and PNG/GeoTIFF RGB equality. `--offline` regenerates interpretation from an already acquired complete local set without network calls. Editing or regenerating the JSON changes its checksum; rerun the dependent height/reference-pack assembly afterwards.

Attribution: Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0. Existing model context is separately sourced from the repository's mapped/OSM geometry and remains unreviewed.
