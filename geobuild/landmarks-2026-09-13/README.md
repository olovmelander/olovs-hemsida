# Veckefjärden: Själevads kyrka and Paradiskullen K90

Built in Blender 4.5.9 LTS through the user's running Blender MCP bridge at
127.0.0.1:9876 on 2026-09-13. These are photo-referenced exterior reconstructions.
The mapped plans and application terrain anchor them geographically; building
heights, hidden details, the inrun profile, and the judges' tower position are
estimates. They are not photogrammetry or survey-grade replicas.

## Deliverables

- [Editable Blender project](veckefjarden-landmarks.blend): named architectural
  components and separate collections for each landmark, arranged side by side.
- [Church preview](sjalevads-kyrka-preview.png).
- [Inrun preview](paradiskullen-preview.png).
- [Entire ski-jump preview](paradiskullen-full-preview.png).
- Runtime assets and checksummed inventory in
  `apps/golf/public/models/veckefjarden/{sjalevads-kyrka-v1.glb,paradiskullen-k90-v1.glb,landmarks-v1.json}`.

The church has an octagonal nave, four tetrastyle porticos, stepped granite
entrances, Doric capitals, pediments and cornices, divided arched windows,
clerestory, standing-seam copper roofs, eight belfry faces, four clocks,
alternating circular lights, pointed gables, patinated spire, and gilt cross.
The brown main roof and greener spire follow the 2024 aerial photograph.

The jump includes the boarded start house, smooth inrun transition, ski runners,
timber parapets, steel trestles with cross bracing, switchback stairs, timing
platform, lamps, mapped green landing and outrun, distance lines, side barriers,
three-storey judges' tower, lattice floodlights, and the two railway bridge spans.
Railway spans interpolate between their mapped ends, so the tracks cross above
the outrun instead of sagging into it with the terrain.

## References

Photos were inspected as modeling references. Third-party pixels are not included
in the Blender project or GLB materials. Downloaded reference photographs stay
in the ignored `geobuild/cache/landmarks-2026-09-13/` directory.

| Source | Use | Rights / limitations |
| --- | --- | --- |
| [David Castor, Själevads kyrka, 9 July 2024](https://commons.wikimedia.org/wiki/File:Sj%C3%A4levads_kyrka_2024.jpg) | Overall proportions, octagon, roof colour, windows, porticos, tower | CC0; aerial exterior, no measured height |
| [Svenska kyrkan: Själevads kyrka](https://www.svenskakyrkan.se/ornskoldsvikssodra/sjalevad/sjalevads-kyrka) | Front entrance photograph and building identity | Reference only |
| [Riksantikvarieämbetet building record via Kringla](https://www.kringla.nu/kringla/objekt?referens=raa/bbr/21400000549791) | Four columned porticos, roof and tower construction, clock/window arrangement | Architectural description; not dimensional drawings |
| [Jenny Karlsson, Varvsberget, 16 November 2023](https://jennys-utflykter.se/2023/11/16/varvsberget/) | Start house, inrun, support frames, stairs, downward view of landing | Copyright Jenny Karlsson; reference only |
| [IF Friska Viljor: Om oss](https://www.fvbacke.se/om-oss) | Confirms Paradiskullen's main K90 and separate smaller hills | Primary operator; no dimension survey |
| User-supplied front photograph, 2026-09-13 conversation | Judges' tower, green landing, lines, barriers, floodlights, railway crossing | Reference supplied by user; date of photograph unknown |
| Existing OpenStreetMap extracts in `geobuild/surroundings.json` and Veckefjärden's course pack | Church, inrun, landing and railway plan coordinates | © OpenStreetMap contributors, ODbL; original course data unchanged |

## Placement and scope

The engine uses its existing legacy local horizontal frame, with current rendered
terrain heights. Blender exports metres with Z up converted to glTF Y up; models
are rotated once before export and translated once at runtime.

| Landmark | Source | Runtime anchor (x, z), metres | Geometry estimates |
| --- | --- | --- | --- |
| Själevads kyrka | `w104048726` | `(-3278.4, -905.3)` | Nave apothem 17 m; cross at 42.45 m above anchor; church axis approximately 5° |
| Paradiskullen inrun | `w70606159` | `(1303.65, -493.1)` | Mapped inrun 86.31 m; 35° straight section blending into an 11° takeoff; lift fitted to terrain |
| Landing and outrun | `w370784603` | Same as inrun | Separate mapped boundary; 227 m long; sampled terrain |
| Railway bridge | `w75298818`, `w75298820` | Same as inrun | Mapped endpoints; interpolated deck elevation, estimated structural thickness |

The change is shared by `veckefjarden` and `veckefjarden-korthalsbanan`.
The old custom Själevad model at `(-3310, -928)` duplicated the mapped church
roughly 40 m away and is removed. The mapped church remains the sole fallback
if its GLB fails to load. Örnsköldsviks kyrka (`w108651042`) is a different
building and is retained. The separate small ski-jump complex is also retained.

The main inrun was additionally present as the far-building box
`[1344.8, -506, 43.2, 3.1, -0.3, 0]`. That exact box is suppressed only after the
jump GLB loads, together with its procedural inrun and the two old railway spans.
Tree crowns intersecting the loaded jump corridor are excluded from rendering.

## Rebuild and verification

With the application running on port 5173 and the Blender bridge on 9876:

```powershell
$env:BANVY_GPU='1'
node geobuild/landmarks-2026-09-13/sample-terrain.mjs
geobuild/cache/ortho-venv/Scripts/python.exe geobuild/facilities/blender_mcp.py --script geobuild/landmarks-2026-09-13/build_models.py --timeout 600
geobuild/cache/ortho-venv/Scripts/python.exe geobuild/facilities/blender_mcp.py --script geobuild/landmarks-2026-09-13/frame_project.py
npx vitest run apps/golf/src/engine/scenery/veckefjarden-landmarks.test.mjs
npm --prefix apps/golf run build
node tools/check-veckefjarden-landmarks.mjs
```

`terrain-samples.json` records the actual heights used by this reconstruction.
Re-sample and rebuild together when terrain or mapping changes. The builder
replaces only its own named scene and checks that all pre-existing scenes keep
the same objects. GLBs merge parts by material to bound draw calls while the
native project retains editable parts. Runtime checks validate asset size,
SHA-256, mesh/triangle counts, finite positions, bounds, node names and anchors.
An individual failed asset leaves its legacy representation available.

The focused tests also cover both course packs, corrupted or missing assets,
navigation during parsing, exact legacy replacements, and tree clearances.
Browser screenshots and diagnostics are written to `output/veckefjarden-landmarks-final/`.

Verified: 11 focused tests; production build; both Veckefjärden courses in
WebGPU and the championship course in WebGL2, with both assets loaded and no
browser errors. The two assets total 5,117,388 bytes, 95,557 triangles and 27
material batches. In-app views supplement the Blender previews because they
also expose source duplicates, vegetation and ground-contact errors.
