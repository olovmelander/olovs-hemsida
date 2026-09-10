# Johannesberg architecture implementation — 2026-09-10

The final Blender scene contains 22 exterior facility models. Both Johannesberg course variants load the same 3,668,672-byte GLB and replace all 22 corresponding source buildings after validation. The asset contains 56,637 triangles, 183 material meshes, and no photographic textures.

- [Blender project](../cache/facilities-model/johannesberg-facilities-v1.blend)
- [Clubhouse in the course](../cache/facilities-model/browser/johannesberg-clubhouse-front.png)
- [Rear elevation](../cache/facilities-model/browser/johannesberg-clubhouse-rear.png)
- [Estate overview](../cache/facilities-model/browser/johannesberg-estate-overview.png)
- [Terrace and entrance close-up](../cache/facilities-model/deck-v5-annex-door.png)
- [Machine-readable validation](integration-validation.json)

The clubhouse includes its lower rear storey, southwest annex, northeast veranda, crossgables, dormers, timber balcony and separate open pavilion. The estate models include the manor, hotel wings, villas, spa, event building, stables, service buildings and range shelters. Footprints, roof forms and distinctive details follow the retained orthophoto, laser and dated facade references; unseen details remain estimates.

All three GPU browser cases passed: 22 authored buildings on the 18-hole course, 22 on the nine-hole course, and all 22 original buildings retained when the model download was deliberately blocked. The checks found no duplicate replacement buildings or application/GPU errors. The source audit verified 78 input/receipt files, all 22 node identities, finite geometry and the coordinate conversion. Ten runtime tests and nine roof-clipping tests passed. Production JavaScript and PWA compilation passed in an isolated output folder; that check omitted copying public data, whose model assets were verified separately.

The terrace correction passed a separate 3,157-point check at spacing no greater than 0.25 m, with zero terrain intersections. Minimum sampled clearance is 6.1 cm at the annex deck and 8.3 cm at the pavilion. The deck boards, entrance threshold and fascia were also checked in close-up. The [clearance receipt](deck-clearance-validation.json) identifies the samples and reviewed images.

The [recorded height adjustments](deck-clearance-review.json) are modelling estimates within the original uncertainty: a 0.25 m rise of the annex slab centre and a 0.30 m rigid rise of the pavilion. They do not change the native terrain or establish new surveyed heights. Historical images and laser returns cannot establish every change following the reported 2025 renovation. Three buildings north of the fine terrain are anchored rigidly to the displayed surroundings.

The existing live Blender project, active scene and selection were preserved. The release project is a separate file; the final architecture scene is `Johannesberg | Facilities architecture 2026-09-10 v5`. No commit or deployment was performed. Reproduction commands and source ledgers are in the [README](README.md).
