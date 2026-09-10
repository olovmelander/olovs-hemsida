# Norrfällsviken: Blender facilities and application geometry

The application uses the measured clubhouse, its cross-gable, the detached
northern pavilion and the range building from this Blender workspace. Registered
solar arrays and the observed terrace and padel surfaces accompany the building
geometry. The practice building keeps its existing fallback because its complete
roof form remains unresolved. The application's 1 m terrain is retained.

The local [Blender file](../cache/facilities-reference/norrfallsviken-facilities.blend)
contains a measured starting model and the evidence needed to develop the
clubhouse and its campus. It was created through the user's Blender bridge on
`127.0.0.1:9876`, in Blender 4.5.9 LTS. The scene is named
**Norrfallsviken | Measured facilities**. Other existing scenes, the active scene,
selection and current file were retained.

Open the file separately or select the scene already present in Blender. The
default camera shows the clubhouse and detached north pavilion. Other cameras
cover the range, whole campus and photographic reference boards.

- [Photo and orthophoto gallery](../cache/facilities-reference/reference-gallery.html)
- [Clubhouse study render](../cache/facilities-reference/clubhouse-study.png)
- [Campus study render](../cache/facilities-reference/campus-study.png)
- [Build record](blender-workspace-validation.json)
- [Independent saved-file audit](blender-workspace-independent-audit-saved.json)

## Included evidence

| Source | Contents | Use |
| --- | --- | --- |
| [2024 LM orthophoto](../mapping/facilities-ortho-reference.json) | Ten georeferenced panels, 0.16 m native sampling; 32 feature records | Roof appearance, solar arrays, range mats and targets, practice green, padel court, terrace, parking and routes |
| [2025 LM laser](../mapping/facilities-height-reference.json) | 190,926 retained campus returns; four supported roof assemblies and an unresolved practice-building roof | Actual roof coordinates, ridge/eave heights and slopes, ground context |
| [Public photographic references](../mapping/facilities-web-reference.json) | Eight photographs and one official visitor-map schematic | Clubhouse glazing, separate pavilion, range openings/cladding, café/shop, padel enclosure and contextual facilities |

The three complete source catalogues are embedded as Blender text blocks. Each
curated photo board has its page URL, original image URL, capture-date confidence
and full reference metadata in custom properties. Photos are packed into the
local working file; they are references, not licensed runtime textures. Three
waterfront/camping photos are explicitly contextual and do not establish that
those buildings belong to the golf club.

The main exterior photograph's 2020-08-19 date is inferred from its filename.
The range photo's 2025-05-28 date has matching public image metadata. Upload dates
are not used as capture dates. Individual unknowns remain in the catalogues.

## Coordinates and model status

One Blender unit is one metre. Coordinates use the measured projected frame:

```text
X = EPSG:3006 easting - 678580
Y = EPSG:3006 northing - 6988405
Z = RH2000 elevation - 32.8
```

The measured main roof ridge is about 38.41 m RH2000, its eaves about 35.3 m,
and its slopes about 27 degrees. The cross-gable, detached pavilion and range
have their own measured planes. Roof-edge extents are inner envelopes of sparse
returns, with approximately 0.5–1 m horizontal uncertainty; plane-fit precision
does not turn these into surveyed wall outlines.

Collection 02 holds measured roof geometry. Collection 03 holds editable initial
wall/glazing interpretations. Its floor thresholds, wall insets and window
divisions are estimates. The clubhouse has the photographed projecting glazed
gable; the detached pavilion is separate. The range has an initial open bay.
These are starting forms, not finished architectural models or surveyed interiors.

Collections 04–06 are initially hidden: enable them to inspect all orthophoto
traces, full-scale georeferenced image planes, and the original classified point
cloud. Collection 09 contains the nine curated photographic/schematic boards.
The terrain is a 2 m laser-ground context mesh with holes wherever nearby ground
support is more than 5 m away. It is separate from the application's 1 m terrain.

Several gaps remain explicit:

- Rear façades, entrance thresholds and exact window/door dimensions lack a survey.
- The detached pavilion's precise function and pale front-screen construction are unconfirmed.
- The current practice building has several shallow measured roof patches; a simple gable is unsupported.
- A southern 2024 construction surface contains a building in the 2025 laser. Its use/ownership is unknown; it is not labelled as golf maintenance.
- The historical 2016 entrance hut is not equated with the current practice building.

The existing OSM and former roof geometry remain in the source comparison.
The runtime replacements use the measured roof assemblies and the clearly
identified initial wall/glazing interpretations; they do not establish a
complete architectural survey or fill the unresolved details above.

## Application integration

The application loads two compact geometry assets:

- [Architecture](../../apps/golf/src/engine/scenery/norrfallsviken-facilities-meshes.json):
  45,611 bytes, exported from the measured Blender workspace. Its four roof
  assemblies replace the old clubhouse and range geometry and add the detached
  northern pavilion. The main clubhouse and cross-gable belong to one building.
- [Site details](../../apps/golf/src/engine/scenery/norrfallsviken-facilities-site.json):
  976 bytes, containing two solar-array polygons, the small ground terrace and
  padel court. The full [site registration record](runtime-site-details.json)
  retains the source pixels, measured roof equations, ground-return statistics,
  registration controls, source hashes and uncertainty.

The architecture export contains building meshes and material colours. Reference
photographs, orthophoto textures, the raw point cloud, modelling terrain,
cameras and lights remain outside these runtime assets. The practice building's
unresolved measured patches stay in Blender as evidence while its existing
application fallback remains active.

Restore the Blender origin to get EPSG:3006/RH2000 coordinates, then use the
application's existing geographic bridge. The site-detail vertices already use
absolute source coordinates:

```text
EPSG:3006 -> WGS84 latitude/longitude
runtime x = (longitude - 18.53250) * 50568.51
runtime z = (62.98250 - latitude) * 111320
runtime y = RH2000 elevation + 20.3432
```

This preserves the measured roof position, orientation and elevation within
the unchanged legacy scene frame. The 2 m Blender reference ground is never
used as replacement terrain in the application.

The solar arrays are registered from the native 2024 image to the measured
southwest roof plane. The four control residuals give a 0.155 m fit RMSE; this
is a fit diagnostic rather than absolute survey accuracy. Both arrays remain
inside the measured roof face. A maximum 0.241 m clearance adjustment to the
southern array is recorded alongside its original and unconstrained geometry.
The compact export includes a 3.5 cm normal offset to keep the solar surfaces
above the roof.

The small terrace keeps its image coordinates and uses the median of 67
classified ground returns, 32.79 m RH2000, with a 3 cm rendering offset. The
application subdivides this small surface at 0.5 m and raises individual
vertices to at least 4.5 cm above the displayed DTM where needed, preventing
centimetre-scale ground bumps from showing through the paving. The
previous illustrative 0.7 m raised deck is not supported by those measurements.
This small surface does not define the separately interpreted larger pavilion
and cross-gable decks. The padel court retains its observed footprint and uses
32.43 m RH2000 from 565 ground returns, also with a 3 cm rendering offset.

## Reproduction

Run from the repository root with the existing Python review environment.
Acquisition uses the existing local Lantmäteriet credential workflow. Raw photos,
rasters, laser returns and packed Blender files remain in ignored cache.

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/mapping/build-facilities-ortho-reference.py
node nvgkbuild/mapping/acquire-facilities-laser.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/mapping/measure-facilities-heights.py
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/facilities/prepare-source-data.py
& upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/blender_mcp_client.py --script nvgkbuild/facilities/build-blender-workspace.py --timeout 180
& upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/blender_mcp_client.py --script nvgkbuild/facilities/finish-blender-workspace.py --timeout 120
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend --python nvgkbuild/facilities/package-blender-workspace.py
```

The builders refuse to overwrite an existing scene/file on a fresh run. Use a
new scene/output for another version so artist edits remain intact. Source
hashes are verified before construction. The photo-intake report records its
download URLs and the local gallery generator; the native extra southern crop
has its own `acquire-facilities-extra-reference.py` receipt.

The `.blend` is packed and self-contained for local modelling. It is deliberately
outside Git because it includes external photographs with no redistribution
licence established. Reviewed source measurements, modelling scripts and
validation records are retained in the repository.

The final file is a normal Blender document, not only a scene library: it opens
directly on the measured facilities and the clubhouse camera. Independent
saved-file checks verify the roof coordinates/planes, complete classified cloud,
ground topology and upward faces, geographic UVs, packed images, embedded
catalogues and startup scene. Packaging runs in a separate background Blender
process so it does not replace the user's active file or scene.

Regenerate the application assets separately from the reference-workspace build:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background nvgkbuild/cache/facilities-reference/norrfallsviken-facilities.blend --python nvgkbuild/facilities/export-runtime-architecture.py
& geobuild/cache/ortho-venv/Scripts/python.exe nvgkbuild/facilities/build-runtime-site-details.py
```

The architecture exporter writes [its validation receipt](runtime-export-validation.json).
The site builder verifies the local source hashes, validates solar containment,
roof-plane heights, upward face winding and source coordinate bounds, and
enforces a 5,000-byte limit on its compact export. Full provenance remains in
the build directory; the compact site JSON contains only IDs, absolute
EPSG:3006/RH2000 vertices and face indices.

## Application checks

The authored facilities load by default with Norrfällsviken on the development
server, including `http://localhost:5173/?bana=norrfallsviken`. The diagnostic
`buildingGeometry=source` view retains the earlier building geometry. Runtime
replacement is transactional: a failed or cancelled load keeps the existing
building models. `V3D.stats.facilities` reports the four roof assemblies, their
height placement, two replaced building IDs and the material batches.
Trees whose trunks or lower crowns intersect the authored buildings are
excluded from display. Crowns above the roofs and the underlying vegetation
measurements are retained.

```powershell
npx vitest run apps/golf/src/engine/scenery/norrfallsviken-facilities.test.mjs
npm --prefix apps/golf run build
node nvgkbuild/facilities/check-runtime-browser.mjs --gpu
node nvgkbuild/facilities/check-runtime-browser.mjs --gpu --webgl
```

The 21 focused tests verify the coordinate bridge, unchanged measured roof
heights over sloping terrain, outward foundation faces, shared fallback
placement, solar triangulation, linear material colours, crown clearance,
terrace ground clearance and load/disposal behaviour. The production build
passes. The compact geometry renders 1,192
triangles in seven material batches, including foundations and solar arrays.

Both browser backends pass at the ordinary localhost:5173 entry point with the
1 m graph terrain active. Ten views per backend cover the clubhouse, solar
roof, pavilion, campus and range in daylight and evening light. There are no
page errors, console errors or failed requests. The replacement inventory and
retained 12 mats, three targets, court, ditch and practice shed are checked.

- [WebGPU browser report](../cache/facilities-reference/runtime-review/webgpu/report.json)
- [WebGL2 browser report](../cache/facilities-reference/runtime-review/webgl2/report.json)
- [Clubhouse in the application](../cache/facilities-reference/runtime-review/webgpu/clubhouse-east-noon.png)
- [Range in the application](../cache/facilities-reference/runtime-review/webgpu/range-noon.png)
