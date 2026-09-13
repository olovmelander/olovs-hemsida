# Witness-inspired world palette

The final direction is vibrant: deep grass greens, gold and orange foliage, red autumn accents, blue water, warm sand and cool stone. The palette covers Ghibli / Målad mode across all eight atmosphere presets. Open [the interactive comparison](index.html) to compare actual application screenshots by course and atmosphere.

## Research

Sources read and reference images inspected on 13 September 2026:

- [Fletcher Studio: Designing Video Game Environments](https://www.fletcher.studio/blog/2017/5/26/the-witness-designing-video-game-environments). The landscape architects describe distinct biomes, planting palettes and seasonal contrasts, including the scarlet autumn forest. Our interpretation is to give each area a coherent dominant colour, with evergreen woodland supporting the warmer deciduous accents.
- [Luis Antonio: Agricultural Area and Birch Forest](https://www.artofluis.com/3d-work/the-art-of-the-witness/agricultural-area-and-birch-forest/). The artist discusses simplifying realistic tree forms and making foliage readable without excessive noise. His final birch/path image has dark green tree masses, light trunks and strong yellow ground vegetation. We use broad shadow/midtone/highlight pigments on the existing fluffy crowns.
- [Luis Antonio: Forest & Beach](https://www.artofluis.com/3d-work/the-art-of-the-witness/forest-and-beach/). The dense forest uses modular assets and deliberate openings. Its images show how darker foreground vegetation frames warm, bright clearings. That value separation informed the deeper turf and evergreen shadows.
- [Luis Antonio: Clouds](https://www.artofluis.com/3d-work/the-art-of-the-witness/clouds/). Japanese animation backgrounds influenced their foliage and sky. The coast/foam paintover shows saturated blue above warm sand and cool grey rocks. Our sky uses distinct blue and cloud pigments, and our water has teal shallows and blue depths.
- [Luis Antonio: The Hub](https://www.artofluis.com/3d-work/the-art-of-the-witness/soon-the-hub/). The artist describes experimenting with more saturated building colours to help differentiation and removing meaningless surface noise. Our procedural building palette uses Falu red, ochre, cream, clay and slate within the existing Swedish building types.
- [WIRED's autumn screenshot](https://www.wired.com/2016/01/the-witness-review/) and [the JeuxActu trailer screenshots](https://www.jeuxactu.com/the-witness-gameplay-trailer-ps4-playstation-experience-96594.htm) supplied additional visual reference: luminous gold, orange and red masses against dark trunks and cooler surroundings.

The supplied [IGN Shady Trees page](https://www.ign.com/wikis/the-witness/Shady_Trees) could not be fetched. The sources above supplied the artwork and primary artist commentary used for this pass. The linked [GDC talk](https://www.gdcvault.com/play/1020552/The-Art-of-The) is further viewing; its session description was read, not the full video.

The hex values are original authored pigments chosen for this renderer, not an official or extracted Witness palette. Reference images were inspected separately; game art was not incorporated into application assets.

## Implemented colour relationships

| Element | Direction |
| --- | --- |
| Mown ground | Deep green fairways, cooler putting greens, warmer rough; preserve mowing and surface boundaries |
| Woodland | Dark blue-green spruce/pine, bright yellow-green birch, distinct alder and oak greens |
| Autumn | Gold/amber birch, orange/copper/crimson oak, mostly green/gold alder; conifers stay evergreen |
| Sand and paths | Warm golden cream bunkers, neutral grey gravel/asphalt |
| Scenery | Cool granite; warmer trunks, cut wood, Falu red, ochre and cream walls |
| Water | Teal shallows, deeper blue body, quieter lake foam, atmosphere-dependent brightness and sparkle |
| Sky | Blue sky and cream cloud pigments kept distinct; broad procedural cloud shapes |

| Mode | Colour and lighting |
| --- | --- |
| Day | Strong greens, blue sky, warm sand, clear shadows |
| Evening | Honey light with cooler woodland shade |
| Dawn | Rose/pearl light and lavender-blue distance |
| Midnight sun | Apricot light with a violet-blue sky and visible ground |
| Blue hour | Cobalt/indigo, diffuse foliage, reduced water glare |
| Storm | Slate clouds, cool greens, low directional contrast |
| Mist | Silver light, softer distance, retained foreground colour |
| Autumn | Gold, orange and crimson against dark evergreens and a cooler sky |

## Rendering and scope

- The shared palette is in `apps/golf/src/engine/painted-world-palette.mjs`. Mesh crowns and every impostor ring use the same seasonal hue families and lighting uniforms. Per-tree hue selection uses the existing seed; no new vertex data is required.
- Painted terrain now consumes linear pigments once. The former extra RGB multiplication and global saturation/contrast boost are removed from the painted path. Grass was subsequently deepened in response to the pale first pass.
- Dag has its own 0.85 turf gain and reduced ambient fill. That adjustment resets to 1 in the other modes, preserving the accepted Höst palette. Daytime water glare is reduced for elevated views.
- Near and distant terrain use the same classifier/tint palette. Prepared ground tint identities include the source revision, so a production build rejects an older palette's cached tint and computes the current one.
- The painted sky uses four noise octaves in the existing sky draw. The natural look retains the physical SkyMesh shader. No sky textures or extra render passes are added.
- Existing model geometry, LOD budgets, tree positions, terrain geometry and course markings are retained. Building pigments cover procedural building types; authored scenery receives the shared lighting. This is a world colour pass, not a rebuild of every individual building texture or the HUD.
- The natural look retains its base palette. Autumn remains the existing Höst atmosphere selection.

## Reproduce the visual checks

Start the app on port 5173, then run:

```powershell
node tools/blender-tree-study/check_foliage_atmospheres.mjs final puttom
node tools/blender-tree-study/check_foliage_atmospheres.mjs final upsala --tiers
node tools/blender-tree-study/check_foliage_atmospheres.mjs final angso
node tools/blender-tree-study/check_foliage_atmospheres.mjs low upsala --low
node tools/blender-tree-study/check_foliage_atmospheres.mjs natural upsala --natural
node tools/blender-tree-study/make_palette_review.mjs
```

Each run writes screenshots and a JSON report with backend, camera, tree inventory and per-mode LOD audits. The low-quality run uses a 390 × 844 desktop browser viewport; it is not a physical-phone performance measurement. `before` captures predate this colour pass; `after` captures are the earlier pale iteration; `final` captures show the revised vibrant palette.

The tests exercise preset switching without reallocating sky/water objects, restoration from autumn to summer, diffuse-light behaviour, surface colour separation and deciduous colour families. Existing tree/LOD, atmosphere and material tests accompany the browser checks. See `validation-summary.json` for the completed checks.
