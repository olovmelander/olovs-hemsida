# Ängsö clubhouse and facility models

Open the [reference gallery](../cache/facilities-2026-09-10/index.html),
[packed Blender workspace](../cache/facilities-2026-09-10/angso-facility-references.blend),
or [Blender campus preview](../cache/facilities-2026-09-10/blender-campus-preview.png).

The clubhouse and nearby facilities are now modelled in Blender and integrated
into Ängsö's environment. The implementation includes 13 building/roof components
and six site groups: restaurant, reception, annex, courtyard canopies, cart shelter,
kiosk, outbuildings, existing range, terraces, parking, paths and northern yard.
See the [implementation and review record](modeling-review.md),
[current Blender build](model-build-report.json), and
[published asset manifest](../../apps/golf/public/models/angso/facilities-v1.json).

This evidence package retains measured image edges, original laser returns,
photographic details and the club's documents. The packed reference workspace
above remains available separately from the editable architectural model. Hidden
elevations, opening spacing and some small fixtures are estimates. B02's narrow
dark band was rejected as a separate canopy after photo review: its appearance
is consistent with roof shadow and its laser support is sparse. The B01 glazed
rear extension remains modelled. Nearby non-club buildings retain existing
context geometry; unlocated on-course facilities have not been invented.

## Included evidence

| Material | Coverage | Intended use |
| --- | --- | --- |
| Seven georeferenced orthophoto panels | Campus, clubhouse detail, range, northern service context, northern and western neighbours, and broader overview | Building placement, roof plan, parking and circulation |
| 24 observed outlines | 14 campus/service roof or canopy components, four neighbouring roofs, six site surfaces | Individually identified construction references |
| 21 inherited building outlines | Existing source geometry, hidden in Blender by default | Compare the current coarse blocks with newly observed edges |
| 16 curated visual boards | 13 photos, one photo collage, the club's site diagram, one proposal sheet | Elevations, materials, doors, dormers, balconies, functions and relationships |
| Original source documents | Six-page range/bag-store proposal, annual reports and club updates | Dimensions where available, facility identities and change chronology |
| 290,512 laser returns | Campus/range and northern service context, acquired in two bounded windows | Ground and elevated geometry evidence in RH2000 |
| 25 candidate planar supports | Elevated returns inside/beside 14 observed roof/canopy envelopes | Roof studies to review against photographs; 2,627 unique support returns |

The [orthophoto inventory](orthophoto-reference.json),
[photo/document manifest](photo-sources.json), and
[laser evidence](height-reference.json) preserve source links and limitations.
The [orthophoto report](orthophoto-reference.md) records acquisition and tracing.
The [photo report](photo-reference-report.md) describes the most useful views;
the [runtime audit](runtime-audit.md) identifies the current model and export path.
All seven map images and 16 visual boards are packed inside the `.blend`.
The original PDFs, GeoTIFFs, raw laser JSON, world files, contact sheets and rendered
proposal pages are in the local cache alongside the gallery.

## Reconstruction inventory

| Reference | Feature and evidence | Evidence limits and interpretation |
| --- | --- | --- |
| B01–B02 | Main restaurant roof, northwest strip/extension and terrace. Courtyard and parking-side photos show red timber, white joinery, dormers, entrance balcony/porch and rear glazing. | Separate roof intersections, wall bases, exact window spacing and rear extension construction. The current aerial shows dark northwest roofing and terracotta southeast roofing; older photos show a different condition. |
| B03 | Detached reception/kansli wing, identified as A on the club diagram. | Hidden elevation, opening positions, chimney and floor threshold details. |
| B04/B04a | Lodging and changing-room annex. Club diagram I plus the 2024 annex update establish function. Photos show a white lower facade, separate doors, upper red timber, dormers, rooflights and a timber balcony/stair at the south gable. | Small extension connection, concealed elevations and dimensions at ground walls. |
| B05–B06 | Two courtyard roof/canopy structures. | Whether all sides are open, supports, cladding, use and construction heights. Small laser envelopes can include returns from adjacent tall roofs. |
| B07 | Golf-cart shelter north of the restaurant, identified as H on the diagram. | Bay count, roof framing, open sides and charging equipment. |
| B08/S05 | Kiosk/toilets with nearby terrace, identified as G. | Rear elevation, sanitary doors, wash-up fittings and terrace supports. |
| B09–B11 | Small south courtyard building, long eastern outbuilding and small roof near the putting-green path. | Functions remain unconfirmed; do not assign toilet, bag-store or maintenance use from proximity alone. |
| B12/S04 | Existing April 2025 range shelter and hitting strip, with ground-level mat reference. | Bay supports, machine enclosure, nets, mat dimensions and current changes. |
| S01–S03/S06 | Parking/hardstanding, putting green and restaurant terrace. Club sources also document camper pitches and EV charging. | Kerbs, paving joins, gradients, electrical posts, signs and fixture positions. The site diagram is schematic and does not locate posts to survey accuracy. |
| B13 | Large northern roof with yard/equipment context. | Maintenance use is plausible but unverified. Facades and club ownership/use need evidence. |
| N01–N04 and contextual outlines | Nearby northern and western buildings. | Neighbours are context; their inclusion does not establish club ownership. |
| Documented course facilities | On-course toilets at holes 5 and 15; club/ball washing between clubhouse and putting green. | Exact footprints and current exterior photos remain missing. These locations have not been invented in Blender. |

The club's [camper diagram](https://angsogolfklubb.com/gast/husvagn-husbil/)
distinguishes restaurant, reception, changing rooms, kiosk, carts, range and
putting green. The [annex update](https://angsogolfklubb.com/2024/02/05/ordforandes-nyhetsbrev-v-5-2024/)
confirms shared lodging/changing use. The [charging page](https://angsogolfklubb.com/laddstolpar/)
documents seven charging posts serving 14 spaces. These documents establish uses;
the orthophoto supplies metric image geometry.

## Dates and measurement limits

The Lantmäteriet orthophotos were captured **24 April 2025**. Six detail panels
retain native **0.16 m** pixel spacing; the overview uses **0.8 m** sampling.
Each has EPSG:3006 GeoTIFF metadata, PNG, world file, CRS file and checksums.
Source access uses bounded range requests; the full remote TIFFs were not
downloaded or independently hashed in full. Pixel spacing is not an absolute
positional accuracy claim. Roof relief displacement, overhang and shadow mean
image edges can differ from wall footprints; edge uncertainty is recorded per
feature where estimated.

Laser capture is the **8 March–1 April 2021 campaign**, with nominal timestamp
20 March, not the later publication date. The original LAS classes are retained;
class 1 means unclassified, class 2 ground, and class 7 noise. Roof fitting excludes
noise and selects elevated first returns. A bare-earth terrain model cannot
measure roof heights. Ground fits are surrounding terrain, not finished floors;
planar hulls show sampled support rather than surveyed eaves. Sparse points,
neighbouring roof returns and changes since 2021 limit interpretation. Read the
[height report](height-reference.md) before using its candidate ridges.

The six-page [range and bag-store drawing set](https://angsogolfklubb.com/wp-content/uploads/2024/10/Oversikt-range-utslag-och-bagrum.pdf)
is marked **FÖRSLAGSHANDLING** and dated September/October 2024. It describes a
proposed ten-bay range and separate bag store. The club's
[December 2025 announcement](https://angsogolfklubb.com/2025/12/04/beviljat-stod-fran-arvsfonden/)
planned a project start in autumn 2026. No completion evidence was established.
Keep proposed structures separate from the existing April 2025 condition.

Photograph capture dates remain unknown where unsupported; upload paths and
filenames are not treated as camera dates. Eighteen discovered images explicitly
associated with AI generation were excluded from architectural evidence. Web
photos are local modelling references with no established redistribution grant;
they are not runtime texture assets. Source attribution for imagery and laser is
retained: Lantmäteriet, bearbetad information, CC BY 4.0.

## Blender coordinates and use

The live Blender bridge on `127.0.0.1:9876` creates the scene
`Angso | Facility references 2026-09-10`. Select it from the scene selector,
or open the separate `.blend` from the link above. Use Material Preview or Rendered
shading for image planes. Named cameras cover the campus, clubhouse, range,
neighbouring areas and photo boards. The source catalogs are also packed as Blender
text blocks. Choose an object to inspect its source URL and evidence properties.

Units are metres: **X east, Y grid north, Z up**. Reference origin:
**E 605530, N 6605140 (EPSG:3006), H 8 m RH2000**. Laser Z equals RH2000 minus 8 m.
The image planes sit at an arbitrary flat display datum; their Z offsets are not
measured ground heights. Disable the map-plane collection before inspecting the
hidden laser and elevated-support collections, since some physical points fall
below the image plane. Original returns are vertex-only meshes grouped by LAS
class; select one and enter Edit Mode to inspect its vertices.

The original reference scene retains its empty authoring collection. Finished
architecture lives in the separate scene/file recorded in `model-build-report.json`.
Roof, wall, trim, glass, balcony and terrace pieces remain independently editable.
The app export batches components per facility/material; reference images,
diagram planes and laser points are excluded from its GLB.

The website's legacy frame uses true north and a different origin. Convert an
absolute point via the projection, rather than applying a simple translation:

```python
from pyproj import Transformer
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
lon, lat = inverse.transform(605530 + blender_x, 6605140 + blender_y)
course_x = (lon - 16.87100) * 56375.41
course_z = (59.57390 - lat) * 111320
course_y_rh2000 = blender_z + 8.0
```

The runtime v2 bridge handles its own terrain origin. Ängsö's legacy vertical datum
offset is 0 m; avoid copying offsets from other clubs. The runtime audit records
the integration hooks and exact inherited building IDs used for replacement.

## Reproduction and validation

Run the acquisition/curation scripts documented in the photo and ortho reports,
then the laser acquisition and height preparation. Existing local credentials are
read without logging them. Raw references stay under ignored `angsobuild/cache/`;
scripts, traced coordinates and source records are tracked.

```powershell
$facilityPython = 'geobuild/cache/ortho-venv/Scripts/python.exe'
& $facilityPython angsobuild/facilities/prepare-reference-pack.py
& $facilityPython angsobuild/facilities/blender_mcp_client.py --script angsobuild/facilities/build_blender_reference.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background angsobuild/cache/facilities-2026-09-10/angso-facility-references.blend --python angsobuild/facilities/package-blender-reference.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background angsobuild/cache/facilities-2026-09-10/angso-facility-references.blend --python angsobuild/facilities/audit_blender_reference.py
& $facilityPython angsobuild/facilities/audit-reference-pack.py
```

The builder preserves existing live scenes, object transforms, selection, active
scene and current file. It writes a separate scene library and refuses to overwrite
an existing output or scene; choose a new name/path in the specification for a new
revision. The background reopen renders reviews and checks the saved library,
independently of the live session. Results are recorded in
[build report](blender-build-report.json), [saved-file audit](blender-file-audit.json),
and [source audit](reference-audit.json). These verify data handling, not survey
accuracy or architectural completeness.

The saved document passed its independent reopen: 23 packed images, all 290,512
laser vertices and 25 support surfaces were verified. Coordinate storage differed
by at most 0.000061 m from the input references. All 82 gallery file links resolve.
The [orthophoto validation](orthophoto-validation.json) additionally checks exact
RGB equality across all 11,488,987 acquired pixels, source hashes, validity masks,
world files and observed trace coordinates.
