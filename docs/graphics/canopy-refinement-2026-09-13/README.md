# Connected painted canopies

Open [the before/after comparison](index.html), [the daytime course capture](angso-contrast-noon.png), or [the Blender study](continuous-canopy.blend).

The approved refinement is integrated into the default Ghibli/Målad catalogue. It targets the fragmented lighting and fine dark leaf outlines that made the crowns look noisy. The previous immutable files and `before-manifest.json` retain the previous geometry for comparison. This working-tree implementation has not been deployed.

## Appearance

- Spruce has staggered, drooping outer boughs, fuller upper shoulders and a slight lean. Its light flows across broader connected foliage volumes.
- Birch has broader lower shoulders, an asymmetric arch and gently hanging outer growth. Branches and foliage share the same deformation.
- All five species have smoother authored canopy normals, retaining a smaller contribution from the original local bough shapes. Pine keeps more local structure so its separate branch platforms remain legible.
- The shared foliage shader uses broader, quieter pigment variation. Transparent-black atlas texels no longer create the same dark fringe when filtered: the shader compensates for the sampled alpha, bounds the recovered pigment and retains a restrained amount of texture variation. Alpha coverage and the leaf silhouettes remain unchanged.
- The close meshes and the distant impostor bake use the same texture-pigment treatment. The atmosphere palettes, recent golden-evening work and grass reflections are retained.
- Following the colour review, all five summer palettes have stronger green midtones and less pale yellow in their highlights. The subsequent contrast adjustment deepens the transition into shaded foliage and concentrates bright pigment on the sun-facing tops. Autumn retains its gold, orange and crimson palette; the lighting adjustment also applies to those colours. No scene-wide exposure or saturation filter was added.
- The direct-light ramp now starts at sun alignment -0.18 instead of -0.5, reducing light wrapped around the crown. Highlights begin at 0.48 instead of 0.25, with a 0.74 maximum contribution to keep the small sunlit areas bright. Under diffuse lighting, the crown response is `normal.y * 0.28 + 0.50`, giving the undersides more depth. These are changes to the shared near/far shader constants; the approved geometry, normals, foliage texture correction and triangle counts are unchanged by this contrast pass.

## Default application integration

`apps/golf/public/models/trees/ghibli-fluffy.json` selects revision `continuous-canopy-2026-09-13`. The standard app loader uses it without a study flag, for all courses and both quality settings. All three mesh levels and the distant impostor use the shared foliage colour function. The existing production build copies these public assets; the service worker revalidates the manifest and caches the immutable, checksum-named models and textures. Existing asset versions remain available for previously cached manifests.

The loader now requests the catalogue with `?v=continuous-canopy-2026-09-13`. This gives the app's model revision its own cache key: the service worker's four-second network timeout previously allowed an older, unversioned catalogue to be selected while the request was pending. Future model revisions must advance both the manifest revision and `GHIBLI_FOLIAGE_REVISION`; the loader test checks that they agree. `V3D.treeCatalogue()` reports the actual loaded revision, look, asset count and byte count for diagnosis.

The reported Norrfällsviken URL was checked with no look, quality or study overrides. A fresh browser loaded the current five-species catalogue (20 assets) at high quality with Målad selected. This confirms the served app path; it does not establish which catalogue was already in the user's existing tab. [The production-build capture](norrfallsviken-release-slow-network.png) shows the same first tee in evening light. An existing tab needs a full refresh to load the updated application code.

The old `publish_foliage.mjs` tool rebuilds the original study, so rerunning it would restore the earlier geometry. For this refinement, the Blender builder below writes the reviewed candidate. Promote that candidate with `Copy-Item -LiteralPath docs/graphics/canopy-refinement-2026-09-13/candidate-manifest.json -Destination apps/golf/public/models/trees/ghibli-fluffy.json`, then run the authored-asset and loader tests before shipping. The candidate is already the app default in this implementation.

## Budget and compatibility

| Species | Close | Full | Reduced |
| --- | ---: | ---: | ---: |
| Scots pine | 4,448 | 1,620 | 280 |
| Norway spruce | 4,500 | 1,700 | 308 |
| Silver birch | 4,500 | 1,700 | 308 |
| Grey alder | 4,032 | 1,700 | 108 |
| Pasture oak | 4,500 | 1,700 | 200 |

Every count is identical to the input model. The 15 GLBs total 2,056,144 bytes, down 452 bytes. The five 512-pixel foliage atlases are unchanged. Geometry is authored in Blender and exported once; there is no new runtime deformation step, texture sample, render pass or tree batch. The shader adds a few arithmetic operations to the existing foliage sample; frame-time performance was not benchmarked.

Per-tree placement and height/radius fitting retain their existing contract. Each reduced model is fitted to its species' close-model bounds by the existing loader. The original Blender scene was preserved; the study is saved as a separate scene with packed foliage textures. Blender's preview material approximates the app's daytime material; the screenshots are the actual application render.

## Checks

- 40 tests across six files pass: authored Ghibli assets, tree impostors, tree fade, tier capacity, tree bounds and painted palette. The loader test also checks that every refined crown normal remains finite and unit length after tier fitting.
- Actual WebGPU application captures cover Ängsö in day, evening, autumn and blue hour; all four forced tree tiers on Ängsö; Upsala in low quality under day, evening, autumn and storm; and Puttom in day and evening. The tree-tier and nonblank-render checks pass with no reported console/page errors.
- The forced impostor capture deliberately places the far-distance billboard at close range to inspect its coverage. It is a diagnostic view, not the normal near-tree presentation.
- The application and existing study entries compile successfully. The compile-only configuration omits the large public course archive, retaining its existing chunk-size and public-asset glob warnings.
- Low quality was checked at 390 × 844 in a desktop browser, not on a physical phone.

`blender-validation.json` records the authoring counts. The runtime reports and `validation-summary.json` record the application checks. `candidate-*` captures isolate the first geometry/normal pass; `softened-*` also include the foliage-edge correction. `final-*` captures use the local default catalogue without request overrides.

The `angso-colour-*` captures record the initial richer-palette pass with the same camera in day, evening and autumn. `before-colour-palette.txt` and `before-colour-material.txt` preserve the state before that adjustment. The Blender preview reads its pigments from the application palette.

`colour-validation-summary.json` records the final colour checks: seven WebGPU captures across high-quality Ängsö and low-quality Upsala, including blue hour, storm and mist. All tree-tier audits pass, the comparison camera and tree triangle/batch counts match, and no runtime errors were reported. The same 40 tests and compile-only application build pass again after the colour change. All six atmosphere/comparison combinations and the comparison slider were checked in Chrome.

The current comparison opens on `angso-colour-*` versus `angso-contrast-*` to isolate the later contrast correction. Choose **Full canopy improvement** to compare the original trees with the current result. `before-contrast-material.txt` preserves the preceding shader. The Blender preview has the same adjusted direct-light ramps.

`contrast-validation-summary.json` records nine WebGPU atmosphere captures covering all eight modes across high-quality Ängsö and low-quality Upsala, plus all four forced tree tiers. The same 40 tests and compile-only application build pass after the contrast change. The comparison cameras, triangle counts and tree batches match. `contrast-pixel-diagnostic.json` is a small foreground-birch luminance diagnostic, not a whole-scene quality score.

## Final release checks

- 60 tests pass across eight files, covering the foliage assets/loader, look preferences, impostors, fades, bounds, tier capacity, atmosphere palette and grass/material controls.
- The application and study entries compile after the loader change. The release check serves the compiled application plus public assets directly from disk, avoiding a duplicate copy of the course archive.
- `foliage-release-validation.json` records the real generated service worker returning an older unversioned catalogue after its four-second timeout. The revision-specific request then loads the approved trees despite a 6.5-second network delay. A subsequent visit interrupts only the catalogue connection; the app still loads the approved revision and all 20 immutable model/texture assets from cache, with no model network requests and no runtime errors. This is a foliage-cache check, not a claim that the entire course was tested offline.
- The Norrfällsviken production checks use the normal first-tee evening URL without look, quality or study overrides. All tree audits pass. The development URL was also checked in a fresh browser.
- No geometry, textures or triangle counts changed during the colour, contrast or cache corrections. The refined catalogue matches the saved approved candidate. Git's staging area remains untouched; these changes are not committed or pushed.

Re-run the production cache check after compiling to a separate directory:

```powershell
node tools/blender-tree-study/check_foliage_release.mjs <compiled-build-directory>
```

## Reproduce

From the repository root, with Blender MCP on port 9876:

```powershell
node tools/blender-tree-study/bl.mjs tools/blender-tree-study/refine_canopy_volumes.py 60000
node tools/blender-tree-study/bl.mjs tools/blender-tree-study/present_canopy_refinement.py 20000
```

The builder reads the saved input manifest and writes a candidate without replacing the app manifest. To capture that candidate in an isolated browser session, with the app on port 5173:

```powershell
node tools/blender-tree-study/check_foliage_atmospheres.mjs candidate angso --modes=noon,golden,host --initial=dag --manifest=docs/graphics/canopy-refinement-2026-09-13/candidate-manifest.json --out=docs/graphics/canopy-refinement-2026-09-13
```

Omit `--manifest` to check the current app catalogue. Add `--tiers` to inspect the four tree tiers, or `--low` to check the low-quality viewport.
