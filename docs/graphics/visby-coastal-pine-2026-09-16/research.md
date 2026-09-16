# Visby GK coastal Scots pine

Research and modelling: 16 September 2026.

The requested species is **Pinus sylvestris**, Scots pine / tall. The sources
reviewed do not identify a special named cultivar at Visby GK. The model captures
the coastal growth form visible in the club's photographs. Wind shaping is a
visual interpretation, not a verified diagnosis of an individual tree.

## Photo references

The primary source is [Visby GK: Banorna](https://www.visbygk.com/om-banorna/).
Five original images from that page are retained in `reference/` for design
research. The image filenames credit Jacob Sjöman. These photographs are reference
material; they are not included in the website or used as textures.

| Photograph | Useful evidence |
| --- | --- |
| [465: coastal pines](https://www.visbygk.com/wp-content/uploads/2021/04/465_VisbyGK_JacobSjoman_16BITS_V1-copy-scaled.jpg) | Principal reference supplied by the user: leaning main trunk, low fork, sweeping exposed branches, asymmetric flattened crown, upward sprays and dark weathered bark. Trees at right show multiple leaders. |
| [692: course aerial](https://www.visbygk.com/wp-content/uploads/2021/04/692_VisbyGK_JacobSjoman_16BITS_V1-copy.jpg) | More upright inland trees and denser woodland; the club has a range of growth forms. |
| [410: coastal green](https://www.visbygk.com/wp-content/uploads/2021/04/410_VisbyGK_JacobSjoman_16BITS_V2-copy.jpg) | Open sea exposure and short coastal turf; environmental context. |
| [256: course gallery](https://www.visbygk.com/wp-content/uploads/2021/04/256_VisbyGK_JacobSjoman_16BITS_V2-copy-scaled.jpg) | Additional retained course context. |
| [567: course gallery](https://www.visbygk.com/wp-content/uploads/2021/04/567_VisbyGK_JacobSjoman_16BITS_V1-copy.jpg) | Additional retained course context. |

[NC State Extension's species account](https://plants.ces.ncsu.edu/plants/pinus-sylvestris/)
describes an open, irregular mature crown, short blue-green needles in pairs,
and warmer orange-brown upper bark. The model uses subdued grey-brown lower bark,
ochre upper branches and the project's existing painted pine needle atlas.

## Model and course integration

`visby-coastal-pines.blend` contains three editable mesh variants with packed
foliage texture: wind leaning, forked coastal, and sheltered upright. The builder
is `tools/blender-tree-study/visby_pine.py`; launch it through the existing MCP
client with `start_visby_worker.py`. The background worker preserves the live
Blender scene. Close/middle/distant tiers stay within 4500/1700/420 triangles.

`ghibli-visby.json` selects these pine meshes only when the painted tree loader
receives `courseSlug: 'visby'`. The other four species retain the existing assets.
The renderer places the variants at its existing Visby pine roots and retains
measured height/crown scaling, terrain contact and deterministic variant choice.
The model's proportions are artistic estimates from photos, not field measurements.
The exact photographed specimen has not been geolocated, so this is a course-wide
pine appearance update, not a claim that a specific tree was surveyed.

## Validation

- Eleven focused loader, bounds and tier-capacity tests passed.
- Production application and service worker compiled successfully. The proof
  build serves public assets separately; its missing font/favicon precache glob
  warnings are expected for that build configuration.
- Production Chromium checks passed with desktop WebGPU and mobile WebGL2.
  The loader fetched 26 verified assets and selected the Visby revision.
- A comparison against the original catalogue preserved all **51,127** root
  positions, orientations and species assignments, including **37,978** pines.
- Close, middle and distant camera checks passed the renderer's tier audit.
- Both versioned catalogues and all 26 Visby mesh/atlas files loaded offline
  with the same checksums. The foliage manifest cache now retains four entries
  so Visby and the standard catalogue can coexist.

See `blender-build-report.json`, `runtime-validation.json`, `cache-validation.json`
and the `production-*.png` screenshots. The initial browser harness had an
unrelated missing favicon on its synthetic cache-test page; that harness was
corrected and the checks rerun successfully.
