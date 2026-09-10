# Lidingö facilities: Blender models and application integration

Implemented 10 September 2026. The Lidingö environment loads the authored
facilities automatically. Open `http://localhost:5173/?bana=lidingo` and reload
an existing tab to load the new scenery code.

The editable deliverable is
[lidingo-facilities-authored-r2.blend](../cache/facilities-model-2026-09-10/lidingo-facilities-authored-r2.blend).
Its model scene contains individual architectural parts and evidence notes;
the separate runtime scene contains consolidated meshes. Six cameras cover the
clubhouse, courtyard, two range views, Café 9 and the toilet beside hole 15.
The [packed reference workspace](REFERENCE-WORKSPACE.md) remains available for
comparison with photos, orthophotos and the original roof observations.

## Implemented scope

| Area | Authored geometry |
| --- | --- |
| Restaurant/reception | Framed glazing, round columns, panelled balcony, paired blue awnings with arms, siding, roof equipment, chimney, gutters and entrances. |
| Pavilion and annex | White facades, course-facing veranda, glazing, railings, porch and steps. |
| Courtyard | Three timber terrace levels, glass balustrades, stairs, tables/chairs, green kerb/rope, entrance wall and pillars. |
| Range buildings | Two red timber barns using retained roof envelopes, plus two small source-footprint buildings. |
| Practice facilities | Two covered tee structures, two traced service huts, exposed and covered mats, dividers and two open net runs. |
| Parking | Terrain-following paint for the visible central double bank. Existing paving remains the surface. |
| Café 9 and toilet 15 | Detached structures placed from matching course-guide context and traced 2025 roof outlines; restrained estimated elevations. |
| Practice ground surfaces | Three additional practice greens and four practice bunkers traced from native aerial imagery, rendered through the existing terrain material pipeline. |

There are **21 facility groups**, with 78,148 triangles in 191 material batches
and a 6,192,028-byte GLB, including seven replacements for buildings in
the source pack. Group count includes terraces, net runs and mat groups; it is
not a building count. The [coverage inventory](implementation-coverage.md)
maps the broader reference inventory to authored geometry and existing site
surfaces. Detailed decisions are in
[clubhouse notes](model-clubhouse-notes.md), [range notes](model-range-notes.md)
and [ancillary notes](model-ancillary-notes.md).

The seven added practice surfaces are separate terrain features, outside the
GLB group count. Their [trace layout](practice-surface-layout.json) retains
source pixel coordinates, transforms and boundary uncertainty; the
[publication audit](practice-surface-validation.json) checks the compact
vectors bundled with the application. Both the ground material and vegetation
exclusions use those rings. Source inspection keeps the original surface data.

The 2025 aerial imagery controls layout; retained roof-derived envelopes
control the five main buildings. Facade dimensions, concealed elevations, roof
interpretations for unmeasured huts, net heights and hidden bay/support counts
are appearance estimates. This is an exterior model, not a building survey.
The precise state of later 2026 site changes is not established by May 2025
imagery. Evidence and uncertainty are recorded per facility in the manifest.

## Runtime behavior

[facilities-v1.json](../../apps/golf/public/models/lidingo/facilities-v1.json)
points to a GLB whose filename is its full SHA-256. The
[loader](../../apps/golf/src/engine/scenery/lidingo-facilities.mjs) validates the
coordinate frame, byte count, digest, facility identities and geometry before
attaching anything. Successful loading suppresses the seven old building
instances and prior procedural courtyard/range details. Failed or cancelled
loading leaves the procedural fallback available without a partially replaced
site. Footprints are installed before vegetation is generated.

`?bana=lidingo&buildingGeometry=source` retains the original five measured roof
meshes and their 7,069 triangles. Original source geometry and observations
remain unchanged. `?bana=lidingo&gl=1` selects the WebGL2 renderer.

The GLB uses `X=east−677700.5`, `Y=RH2000`, `Z=6586399.5−north`.
Blender uses `X=east−677700.5`, `Y=north−6586399.5`, `Z=RH2000−25`.
The exporter bakes the 25 m vertical origin exactly once before glTF axis
conversion. Terrain anchors use the published 1 m grid; the preview terrain is
sampled at 4 m and excluded from export.

Only geometry and procedural materials ship. Reference photos, orthophoto
pixels, preview terrain, cameras and lights are excluded from the GLB.
HTTP rules revalidate the manifest and cache the immutable GLB; service-worker
rules use NetworkFirst for the manifest and CacheFirst for its addressed GLB.

## Verification and review

- [Production export](production-validation.json): exact model/asset paths,
  hashes, triangle counts, material batches and renders.
- [Independent asset audit](production-independent-audit.json): real GLTF
  parsing, preserved source hashes, geometry budget, bounds, terrain placement,
  roof envelope comparison and duplicate-facility fallback.
- [Browser report](environment-validation.json): production WebGPU, WebGL2,
  source geometry and deliberate asset-failure checks.
- [Courtyard screenshot](../cache/facilities-model-2026-09-10/courtyard-environment.png)
  and [range screenshot](../cache/facilities-model-2026-09-10/range-environment.png).

The focused Vitest suite exercises the loader and the actual shipping GLB.
Browser verification checks replacement suppression, source roof preservation,
terrain placement, practice-surface materials and nine rendered viewpoints. The application production build
also validates the generated asset/caching configuration.

## Reproduction

Run from the repository root with the existing Python environment and Blender
4.5. The source modules are `model-clubhouse.py`, `model-range.py` and
`model-ancillary.py`; they share the context in `build-production-model.py`.

```powershell
node lidingobuild/facilities/prepare-production-inputs.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/blender_mcp_client.py --script lidingobuild/facilities/build-production-model.py --timeout 180
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background lidingobuild/cache/facilities-model-2026-09-10/lidingo-authored-r2.library.blend --threads 4 --python-exit-code 1 --python lidingobuild/facilities/export-production-model.py
node lidingobuild/facilities/audit-production-model.mjs
node lidingobuild/facilities/publish-practice-surfaces.mjs
npm --prefix apps/golf run build
node lidingobuild/facilities/check-environment.mjs http://127.0.0.1:8767/
```

The final command expects the production preview server on port 8767.
The builder preserves existing live Blender scenes, active scene and file, and
refuses to overwrite its scene/library; choose a new revision name for another
build. The exporter requires an explicit trailing
`-- --replace-manifest-sha256 <current-manifest-sha256>` when replacing an
existing manifest. It saves the old manifest in the ignored cache and checks
that it has not changed during export before atomically replacing it.

Reference acquisition and provenance are documented in
[orthophoto-reference.md](orthophoto-reference.md),
[web-reference.md](web-reference.md),
[ancillary-location-review.json](ancillary-location-review.json) and
[REFERENCE-WORKSPACE.md](REFERENCE-WORKSPACE.md).
