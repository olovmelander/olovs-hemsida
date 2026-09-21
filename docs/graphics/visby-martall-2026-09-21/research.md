# Visby GK — martallar / Vindpinad tall

Reference study and model revision, 21 September 2026.

## Decision: retain the previous version

The user also reviewed a
[separate colour revision](../visby-martall-original-colours-2026-09-21/index.html)
and then chose to keep the old trees. Both proposals are archived. All images
and validation results in this folder describe the darker proposal.

The user declined this proposal and asked to keep the existing old trees.
The active Visby catalogue has been restored to `visby-coastal-pine-2026-09-16`,
including its three variants, original needle atlas and `tall` palette.
The new models, Blender study and before/after comparisons are retained as an
archived proposal. The builder now writes only `candidate-catalogue.json`; it
does not replace the active course catalogue. Validation results below describe
the archived proposal when it was tested, not the current course selection.

## Evidence

Region Gotland's [local vocabulary](https://gotland.se/trafik-gator-och-parker/parker-och-allmanna-platser/arets-happening)
defines **martall** as **vindpinad tall**. This is a growth form, not a separate
species or cultivar. The working species remains Scots pine, *Pinus sylvestris*.
[NC State Extension](https://plants.ces.ncsu.edu/plants/pinus-sylvestris/)
describes the mature irregular crown, short blue-green paired needles and warmer
upper bark. Those species traits inform the material; the photographs guide shape.

| Reference | Observations used in the models | Provenance |
| --- | --- | --- |
| [Visby GK / Jacob Sjöman, 465](https://www.visbygk.com/wp-content/uploads/2021/04/465_VisbyGK_JacobSjoman_16BITS_V1-copy-scaled.jpg) | Low fork in a thick leaning trunk; asymmetric canopy; long lower leeward arm; exposed branching beneath dense terminal sprays; uneven upper edge. Right-hand trees have several leaders. | Primary course reference supplied by the user, also in the club's [course gallery](https://www.visbygk.com/om-banorna/). Local full-resolution copy retained. |
| [User thumbnail 1](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRhEReYuWDfnnGeRpmXuYXmVkvOOmZxtymjweSDpdF1chtkNvZdJnRCA32P&s=10) | Low, swept flag shape; almost horizontal lower wood; foliage concentrated at the ends. | Supplied Google thumbnail. Original author/location not verified; habit reference only. |
| [User thumbnail 2](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ7UceGKy1m8_lWgANAF_KdHNInrgIE_hMlRlkk2CCpWXyiADN8PDumzuc&s=10) | Twisting trunk, uneven forks, open crown windows, grey fissured bark and bare hooked twigs. | Supplied Google thumbnail. Original author/location not verified; structure reference only. |
| [User thumbnail 3](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSqOp_mqixvDmDcwprYGgHM2c5fu2VVU293-LKOwjonkQ&s=10) | Multiple slender crooked leaders, dark foliage, windswept top, varied neighbouring silhouettes. | Supplied Google thumbnail. Original author/location not verified; variation reference only. |

The previous study's [five club photographs](../visby-coastal-pine-2026-09-16/research.md)
provide wider course context, including more upright trees. Reference photographs
are research material, not shipped textures. Backlighting in 465 and sunset in
thumbnail 3 make direct colour sampling unreliable. The selected palette is an
artistic daylight interpretation: dark grey-green shadows, muted green body,
restrained olive tips; charcoal-grey lower wood and subdued ochre upper bark.

## Model decisions

- **Vindpinad tall:** principal hero, low fork and long leeward arm from photo 465.
- **Krokig flerstammig martall:** twisted base and three unequal leaders, with clear
  sky openings between branches.
- **Låg kustmartall:** lower, strongly swept crown with a different trunk path and
  needle fans clustered toward the leeward tips.
- **Öppen skärmtall:** taller, more open umbrella habit for visual variety.

Each has an independent branch skeleton. Secondary forks, hooked dead twigs,
irregular trunk sections and root flare enrich the close model. Needle fans reach
upward and leeward; smaller offset fans break the large round clumps of the older
models. No locations or dimensions of photographed specimens are inferred as
survey data. Existing course roots, dimensions and yaw remain the placement source.

`martall_geometry.py` defines the authored skeletons and bounded meshes;
`visby_pine.py` exports the catalogue and editable Blender scene. The build is
launched through Blender MCP using `start_visby_worker.py` in an isolated Blender
worker. The live scene is preserved. Hero/Full/Lite budgets remain 4500/1700/420
triangles. Production uses Hero geometry and derives its impostors from those same
meshes. The Full/Lite exports remain available to the study loader.

The Visby catalogue selects the `martall` foliage palette for both the close mesh
and its impostors. Other courses continue using their existing pine palette.

## Review artifacts

- `index.html`: saved before/after review with close, middle and distant views,
  a movable divider, full-image buttons and side-by-side mode.
- `previous-catalogue.json` and `candidate-catalogue.json`: frozen before/after
  catalogue snapshots. Keep their SHA-addressed assets when cleaning old models.
- `comparison-manifest.json`: paired image hashes and exact camera parameters.
  Both sides use the same app build, viewport, daylight and deterministic weather.
  Keep this dated review when creating later revisions; create another dated
  directory rather than replacing this comparison with a different candidate.
- `visby-coastal-pines.blend`: editable four-tree study, packed needle atlas and
  four packed photographs in the hidden References collection.
- `blender-four-variants.png`: collection at a common scale.
- `variant-0.png` through `variant-3.png`: individual front views.
- `hero-reverse.png`: hero from the opposite side.
- `blender-build-report.json`: exact asset hashes, geometry budgets and dimensions.
- `blender-validation.json`: native scene, ground-contact and packed-reference checks.
- `runtime-validation.json`: browser checks and production captures.

## Validation results

- 28 focused tests passed across catalogue loading, geometry bounds, tier capacity,
  impostors and the painted palette. All twelve exported meshes passed checksum,
  finite-coordinate, UV, triangle-budget and ground-contact checks.
- All four Hero models remain at 4,500 triangles each. Full exports are at 1,700;
  Lite exports are below 420. Production loads four pine Heroes plus the four
  unchanged other species and five atlases (13 files).
- The compiled app passed desktop WebGPU and mobile WebGL2 checks with no browser
  errors. Close, middle and distant views passed the tree-tier audit.
- All **51,119** root positions, yaw values and species assignments matched the
  previous catalogue in the current course build. The count is from this build,
  rather than the older September 16 report.
- Both versioned catalogues and all 29 Visby study mesh/atlas assets reopened
  offline with identical checksums. The production impostors use the martall palette.
- Native Blender verification found four crowns, four trunks, four packed source
  photographs and grounded trunk meshes. The previous live Blender scene survived
  appending the study.

The build's public-assets copy is disabled for the local browser harness; its
font/icon precache-glob warnings are expected. Runtime files are served from
`apps/golf/public`. This is a local integration and review, not a deployment.

Rebuild the original vector needle atlas with `node tools/blender-tree-study/make_martall_atlas.mjs`,
then run `node tools/blender-flag/blender-bridge.mjs tools/blender-tree-study/start_visby_worker.py`.
Append the completed study to live Blender: `node tools/blender-flag/blender-bridge.mjs tools/blender-tree-study/load_visby_study.py`.
