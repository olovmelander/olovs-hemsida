# Visby / Kronholmen facilities

The Blender project reconstructs the clubhouse's separate gabled wings, dormers,
glazed restaurant and conservatory, paved terraces, lighthouse station, range
shelters and service buildings from aerial and ground references. It replaces
the generic clubhouse in the local golf app. The source reference kit also
includes the surrounding buildings so further modeling stays in the same frame.

## Open and review

- [Blender workspace](output/visby-facilities-workspace.blend): editable architecture,
  packed aerial/photo references, terrain, source footprint outlines and cameras.
- [Clubhouse render](output/clubhouse-seaward.png), [lighthouse render](output/lighthouse.png),
  [roof plan](output/roof-plan.png), [range](output/range.png), [service yard](output/service-yard.png).
- [Matched app views with before/after slider](../cache/facilities-runtime/index.html).
- [Runtime GLB](../../apps/golf/public/models/visby/facilities-v1.glb) and
  [placement manifest](../../apps/golf/public/models/visby/facilities-v1.json).
- [Reference guide](reference/README.md), [numbered inventory](reference/inventory.md)
  and [photographic research](reference/photos/photo-research.md).

Blender MCP on `127.0.0.1:9876` authored a separate scene named
`Visby | Kronholmen facilities`. The existing active scene, its objects and the
current file were preserved. Select the Visby scene in Blender or open the
workspace file to inspect it. Local source images and generated Blender/renders
are ignored by Git; the modeling scripts, manifests and runtime asset are retained.

## Coverage and evidence

The runtime contains 18 groups: fourteen structures, three open firing strips
and the range safety net. These include all seven inherited club-area buildings,
five additional roofs found in the April 2026 aerials, the concrete lighthouse,
and the small red shoreline shed. The clubhouse group includes both terraces
and their furniture. Twenty-five surrounding buildings remain source context
rather than being labeled as club-owned facilities.

The kit contains fifteen native orthophoto panels at 0.16 m per pixel from
Lantmäteriet's flight on **10 April 2026**. Exact affine transforms, parent windows,
world files, projection files, hashes and attribution are recorded in
[orthophoto-manifest.json](reference/orthophoto-manifest.json). The reference audit
compares every exported PNG directly with its source raster window.

The photographic bundle contains 56 retained assets with URLs, hashes and
annotations. The most useful are the club's aerial photograph, Johannes Helje's
April 2023 west-facade and lighthouse photographs, and the C.H.A.B 2016 heritage
survey of the station. The survey provides historical plans/elevations; it is
cross-checked against modern photographs rather than treated as current geometry.

Primary source pages:

- [Visby GK visitor information and aerial](https://www.visbygk.com/besoka-kronholmen/)
- [Visby GK Fyrhuset photographs](https://www.visbygk.com/fyrhuset/)
- [April 2023 clubhouse and lighthouse photo report](https://semesterisverige.nu/semester-i-sverige/fyrhuset-visby-gk-kronholmen/)
- [C.H.A.B station survey, 2016](https://www.chab.se/wp-content/uploads/2016/12/forundersokningKronholmen.pdf)
- [Svenska Fyrsällskapet: Skansudde](https://fyr.org/wiki/index.php/Skansudde)

The 1 m national terrain establishes ground support in RH2000. The 2024 laser
data supplies supporting building-height envelopes, not fitted roof planes.
The main clubhouse envelope supports approximately 6.5–6.9 m above ground.
The lighthouse's published **10.4 m is its total height**, with its shaft and
lantern proportioned from the ground photographs.

Roof outlines and visible architectural character are source-based. Eaves,
some roof heights, hidden doors/windows, furniture details, net height and
unconfirmed facility uses remain estimates. The net is modeled at an estimated
6 m; the three firing strips do not assert an individual mat count. Tree crowns
contaminate some laser cells, so their maxima are not used as roof heights.
This is an exterior visual reconstruction, not a measured architectural survey.

## Coordinate and runtime contract

Blender uses X east, Y north, Z absolute RH2000 metres, with horizontal origin
E687748.5, N6370951.5 in EPSG:3006. glTF export converts this to X east, Y up,
Z south. The app applies its actual terrain height bridge once. No scale fitting,
scorecard-distance adjustment or common flat base is used.

Each exported root identifies exactly one source building, landmark or traced
feature. Only a successfully validated complete asset suppresses the corresponding
generic buildings and lighthouse. A missing, invalid or failed asset preserves
the fallback scenery. Reference imagery, terrain, source curves, cameras and
lights are excluded from the public GLB. Materials are procedural colors, so
the runtime does not redistribute the reference photographs.

Foundations extend to sampled terrain around each structure. New building
footprints also prevent vegetation inside those structures; firing/net reference
bounds do not clear surrounding vegetation.

## Reproduce and validate

The existing source acquisition scripts restore imagery and prepare the reference
inventory. The model builder requires the pinned `terrain-1m.f32` source and
the reference kit. With Blender MCP running, from the repository root:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/acquire-reference.py
& upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/prepare-reference.py
& upsalabuild/cache/review-venv/Scripts/python.exe geobuild/facilities/blender_mcp.py --script visbybuild/facilities/build_blender_scene.py --timeout 180
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background visbybuild/facilities/output/visby-facilities.blend --python-exit-code 1 --python visbybuild/facilities/export_and_render.py
node visbybuild/facilities/check-facility-asset.mjs
npm --prefix apps/golf run build
```

The builder only refreshes its own named generated scene; select another scene
before rebuilding if Visby is currently active. Background export reopens the
saved project and checks finite geometry, source groups and exclusion of photo
textures, then renders the review cameras. See
[build receipt](blender-build-report.json), [Blender validation](blender-validation.json)
and [reference validation](reference/validation.json) for actual results.

The browser audit in `check-facility-runtime.mjs` exercises the actual GLB loader,
matching source replacements, height placement and failure fallback. It produces
fixed camera views for comparison and is separate from geometric resemblance
or a physical-device performance assessment.
