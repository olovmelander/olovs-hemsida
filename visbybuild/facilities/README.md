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

The runtime contains 18 groups: fourteen structures, three mat rows on their
artificial-turf strips and the eastern safety net. These include all seven
inherited club-area buildings, five additional roofs found in the April 2026
aerials, the concrete lighthouse, and the small red shoreline shed. The
clubhouse group includes both terraces and their furniture. Twenty-five
surrounding buildings remain source context rather than being labeled as
club-owned facilities.

The driving range is read in detail. [trace-range-layout.py](trace-range-layout.py)
detects the individual hitting mats on the `range-firing-line` panel as the
periodic darkness minima along the three traced strip lines, refined to the
centroid of the dark pixels in a 2 m window, and writes
[range-layout.json](range-layout.json): 7 mats on the west row between the
road and the studio, 19 along the curved central strip and 6 east of the
covered bays, each with its centre, its row tangent and its shot direction
toward the field; the eastern net as 17 poles at the traced base vertices;
and the two range roofs with their photo-informed heights. The club's own
notices settle the two things the aerial cannot: the 2024 rebuild moved every
hitting place four metres forward and built six new uncovered places between
the road and the studio (2024-02-21), and there are ten fixed Trackman screens,
four of them under cover (2024-03-27). The 2024 construction photograph shows
the covered bays under ONE slope, high toward the field, and the studio
photographs show two broad sectional-door openings with white inner walls --
so `model_range.py` draws the eastern shelter as a monopitch over four bays
with their terminals, the studio (`way/530655627`) as an enclosed building
with two raised doors toward the field, every detected mat on its tray with
rubber tees, six terminals on the west row counted from the road end, and the
net on 9 m timber poles.

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
unconfirmed facility uses remain estimates. Mat centres are measured on the
2026 panel; mat size (1.5 m), tray, tee and terminal details, the 9 m net
height and which six open places carry the fixed screens are interpretations
of the photographs and notices. The western net along the road, which the
Codex session had begun reading as eleven pole marks on the `range-practice`
panel, was never written down and is not modelled. Tree crowns contaminate
some laser cells, so their maxima are not used as roof heights. This is an
exterior visual reconstruction, not a measured architectural survey.

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
& upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/trace-range-layout.py
& upsalabuild/cache/review-venv/Scripts/python.exe geobuild/facilities/blender_mcp.py --script visbybuild/facilities/build_blender_scene.py --timeout 180
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background visbybuild/facilities/output/visby-facilities.blend --python-exit-code 1 --python visbybuild/facilities/export_and_render.py
node visbybuild/facilities/check-facility-asset.mjs
npm --prefix apps/golf run build
```

The builder only refreshes its own named generated scene; select another scene
before rebuilding if Visby is currently active. It also runs unchanged in
background Blender (`blender.exe --background --python .../build_blender_scene.py`),
which is how the 2026-09-10 range pass was built while the live bridge was
busy with another course. Background export reopens the
saved project and checks finite geometry, source groups and exclusion of photo
textures, then renders the review cameras. See
[build receipt](blender-build-report.json), [Blender validation](blender-validation.json)
and [reference validation](reference/validation.json) for actual results.

The browser audit in `check-facility-runtime.mjs` exercises the actual GLB loader,
matching source replacements, height placement and failure fallback. It produces
fixed camera views for comparison and is separate from geometric resemblance
or a physical-device performance assessment.
