# Unbranded club atelier

Fourteen original golf-club meshes authored in Blender 4.5 through the user's local Blender MCP bridge, then exported as glTF for the production **Min bag** editor. Open the app, choose a course, open the menu, and select **Min bag**.

The reference photos guide silhouette, material, and construction details. These are visual interpretations, not manufacturer CAD or exact engineering replicas. No manufacturer logos, shields, product names, brand lettering, or purchased meshes are included in the models or player interface. Irons carry their club number, 5–9.

## References and design decisions

| Family | Visual reference | Authored interpretation |
| --- | --- | --- |
| Irons 5–9 | [D9 Forged review and multi-angle photographs](https://pluggedingolf.com/wilson-d9-forged-irons-review/) | Compact sloping toe, polished perimeter, recessed cavity, diagonal brushed muscle, scored face, chrome shaft. Individual lofts and lengths. |
| PW, GW, SW, LW | [Requested ZM wedge gallery](https://www.scandigolf.se/products/wilson-staff-model-wedge-zm-ht) | Rounded toe, thin upper blade, continuous lower muscle, machined shoulder, fine milling, cambered sole and blended heel. Loft markings on the back and sole. |
| Driver | [Dynapower Max Plus](https://www.dormy.com/sv/varumarken/wilson/dynapower-max-plus-02006a0b9) | Broad dark crown, integrated curved face, stepped sole panels, brushed angular facets, low rear weight, black graphite shaft. |
| Woods 3 and 5 | [Requested fairway reference](https://www.nordicagolf.se/wilson-dynapwr-max-fairway), [manufacturer photos](https://nz.wilson.com/products/dynapwr-max-fairway-wood) | Shallower D-shaped heads with their own face heights, blended heel sockets and fitted sole facets. |
| Hybrid 4 | [DYNAPWR hybrid manufacturer photographs](https://nz.wilson.com/products/dynapwr-hybrid) | Compact crown, extended lower toe, curved steel face, fitted silver sole facets and solid rear pad. Number 4 and 22° heel stamps. |
| Putter | [Requested CS22](https://www.nordicagolf.se/wilson-staff-model-putter-cs22), [manufacturer gallery](https://au.wilson.com/products/staff-model-cs22-putter-right-hand-34) and the user's four supplied photos | Centre-shaft half-moon mallet, sculpted U-shaped channel, three alignment lines, milled steel face and shoulders, paired recessed sole weights. |

Downloaded reference photographs are kept in ignored `tools/blender-clubs/references/`. They are research material and are not served by the application. `acquire-references.mjs` records their source URLs and fetches the selected photographs; the runtime needs no external image service or HDR download.

## Files and reproduction

- `unbranded-clubs.blend`: editable scene containing just the club collection. The bridge script restores the user's previous active scene.
- `model-audit.json`: per-model vertex/face counts, byte sizes, and SHA-256 digests.
- `apps/golf/public/models/clubs/`: individual models with content hashes in their filenames and an authoring catalogue.
- `apps/golf/src/engine/club-assets.mjs`: generated runtime catalogue.
- `apps/golf/src/ui/bag-editor.mjs`, `bag-editor.css`, `club-viewer.mjs`: production editor and lazy studio viewer.

From the repository root, with Blender MCP listening on port 9876:

```powershell
node tools/blender-clubs/acquire-references.mjs
node tools/blender-clubs/build.mjs
node tools/blender-clubs/audit-assets.mjs --prune
$env:BANVY_GPU='1'
node tools/check-clubs.mjs
```

The `.blend` is saved with `bpy.data.libraries.write` so unrelated scenes are not copied. glTF exports use both selection and the active-scene restriction. Geometry is authored in metres, with the club head at the origin. Exports use glTF's Y-up convention. The viewer supplies studio reflections and interactive turntable animation.

## Interaction and storage

Drag or touch to orbit, wheel or pinch to zoom. The focused canvas also accepts arrow keys and +/−. Head and full-club views, face and sole views, reset angle, and rotation toggle are available. Automatic rotation starts disabled for reduced-motion preferences. Closing the dialog or hiding the tab stops its render loop. Models load on selection and cache for offline reuse.

The editor has two parts over one draft: the carry list and the club page (model, carry stepper, name, type, remove). A desktop shows them side by side. A phone (≤ 720 px) opens on the list and shows a club as its own page, with back, previous/next and the Android back gesture; the model downloads only when a club page is opened. Carries are edited in the list (Enter moves to the next club) or with the page's ±5 m stepper. Bars under each name show the carry ladder, and a note appears on a duplicated distance or a gap over 25 m. Nothing reaches the caddie until **Spara ändringar**; closing with changes asks first, and removing a club or restoring the default bag can be undone. The list icons (`clubIcon` in `apps/golf/src/engine/club-design.mjs`) are drawn per model key in `currentColor` only: woods and the putter at address with a solid crown over a light face, shrinking from driver to hybrid; irons and wedges face-on, the toe rising with loft from the 5-iron to the lob wedge and the wedges rounding it off. The type picker uses one representative per kind. `node tools/check-clubs.mjs` exercises these flows and writes `bag-desktop.png`, `bag-mobile.png` and `bag-mobile-club.png`.

## Iron refinement

`iron_geometry.py` rebuilds the irons with a single closed head and swept hosel, a rolled perimeter, an angular lower cavity muscle, a satin face, and 13 flush scorelines. Club numbers appear on the toe of the sole and inside the cavity. Irons 5–7 have fitted sole slots; 8–9 have plain soles. The **Träffyta** view follows each face's loft; **Sula** looks beneath the rounded sole. The silhouettes follow the face, back, toe and sole photographs in the original review, plus the [manufacturer product photograph hosted by GolfOnline](https://static.golfonline.co.uk/media/img/wg1p026001_6_d9_forged_iron_flat.png).

The second proportion pass replaces the upper, rounded insert with the reference's lower angular mass and a narrow diagonal return. The rear rim has a modeled cross-section that rolls into the cavity. The rear sole edge rises in the face coordinate system so it sits with the front edge once loft is applied; intermediate rings create sole camber. Reference landmarks are adjusted for foreshortening instead of applying the pictured tilt again in 3D. The face has a wider polished toe margin, and the hosel blends into the heel at each iron's lie angle.

Loft, lie, nominal length and offset targets follow [TGW's published D9 Forged specifications](https://www.tgw.com/golf-guide/wilson-d9-forged-irons-review/):

| Iron | Loft | Lie | Nominal length | Offset |
| --- | --- | --- | --- | --- |
| 5 | 24.5° | 61° | 38.25 in | 3.378 mm |
| 6 | 27.5° | 61.5° | 37.75 in | 2.972 mm |
| 7 | 30.5° | 62° | 37.25 in | 2.540 mm |
| 8 | 34.5° | 63° | 36.75 in | 2.134 mm |
| 9 | 39° | 63.5° | 36.25 in | 1.702 mm |

Blade width, face height, sole camber and cavity dimensions remain photo-derived estimates, not manufacturer measurements. The geometry audit records the generated angles and estimated dimensions. `iron-refinement/proportions-before.png` and `sole-before.png` preserve the previous iteration; the numbered back/sole captures show the current meshes. The 7 iron also has face, heel, toe and address captures. Iron lighting uses a turned studio environment to keep the face grooves legible while retaining polished rim reflections.

Use `node tools/blender-clubs/build.mjs --irons` to update just these five exports. The wrapper restores the active Blender scene even if the build raises an error. `iron-refinement/geometry-audit.json` checks that each main head is one closed component. To capture all five numbered irons from multiple angles, start `node tools/check-clubs.mjs --serve`, then run `node tools/blender-clubs/check-irons.mjs`. Captures and the browser report are in `iron-refinement/`.

### Heel and hosel

The hosel now has a 33 mm straight barrel sharing the shaft axis. The shaft line sits over the heel. `hosel_geometry.py` opens the last few millimetres of the heel and lofts directly from that boundary into the round barrel, sharing vertices with the head. A quintic transition and gradual section rotation avoid an overlapping tube or raised root on the face. The blade's slopes carry into the transition with softened edge radii. Surface normals on the curved neck keep reflections continuous while the blade retains its planar shading. The centerline and cross-section meet the straight barrel with continuous tangent and curvature. The cavity, face details, numbers and loft/lie progression are retained.

The iron's plain black ferrule starts at the same 5.2 mm radius as the hosel and tapers to the steel shaft. The previous oversize collar and raised silver band are removed. The build checks the stitched head is closed, the barrel rings are circular and on the shaft axis, and the transition tangent aligns with the barrel. These results are included under `hosel` in the geometry audit.

Run `node tools/blender-clubs/check-irons.mjs --hosel` against the review server for higher-resolution captures and neutral-shading surface checks in `hosel-refinement/`. This folder also contains the previous back, face and address views for comparison. The dimensions of this authored transition are visual estimates from the reference photographs.

### Driver and fairway heads

`wood_geometry.py` builds the driver, 3-wood and 5-wood from separate depth profiles. The broad driver crown and low fairway crowns flow into curved striking faces with shared mesh boundaries. The heel sockets are joined into the closed shells. The face loft is part of the geometry, and the scorelines sit flush on the curved faces.

The sole uses broad dark fields, shallow sculpted shoulders, angular brushed facets, fine seams, small red insets and low rear weight plates. These replace the earlier round shells, raised tubular rails and circular rear weights. The driver crown finish is assigned directly to the shell to avoid intersecting surface layers. Only club numbers and loft are stamped; no brand names, shields or product labels are exported.

The driver head is approximately 122 × 107 mm with a 50 mm face; the 3-wood is about 102 × 82 mm with a 29 mm face. The 5-wood is slightly smaller. These proportions and the generated volume are visual authoring estimates. The geometry audit records them alongside the closed-component checks. The viewer fits each preset to the actual geometry and uses darker studio lighting to make the curved faces legible.

Run `node tools/blender-clubs/build.mjs --woods` to update these three models through Blender MCP. Other model files and the iron audit are retained. Start the review fixture, then run `node tools/blender-clubs/check-woods.mjs` for sole, face, crown, toe, full-club and mobile captures. `wood-refinement/browser-audit.json` also records checks that the heads and full clubs fit inside the camera frame. `before-driver.png` and `before-wood-3.png` preserve the preceding designs.

### Hybrid 4

The hybrid has a dedicated 90 × 64 mm head profile and a 32 mm face, with a fuller lower toe and a compact crown. These dimensions are photo-derived estimates. Its 22° loft, 59° lie and 40.25-inch nominal length follow [Wilson's 2025 product catalogue](https://storage.googleapis.com/amer-gc-storage/wilson/golf/catalogs/2025_WilsonGolf_Product_Catalog-NAM.pdf). The manufacturer's gallery depicts the 2-hybrid; the authored 4-hybrid adapts that visual design to the 4-hybrid's angles and length.

The connected face, blended heel socket and fitted sole surfaces use the same construction as the refined woods. The hybrid adds a brushed central field, slim silver facets, a solid rear pad with fine shoulder details, and 4 / 22° markings. It has seven central scorelines and five pairs of light end marks. The viewer applies the matching studio lighting and frames the smaller head independently.

Run `node tools/blender-clubs/build.mjs --hybrid` to rebuild only this asset, retaining the other thirteen models and their audits. With the review server running, `node tools/blender-clubs/check-woods.mjs --hybrid` captures seven views and checks camera framing in `hybrid-refinement/`. The `before-` captures preserve the earlier model. `geometry-audit.json` verifies that the main head is one closed component.

### Wedges

`wedge_geometry.py` rebuilds PW, GW, SW and LW from the five photographs in the [requested Scandigolf gallery](https://www.scandigolf.se/products/wilson-staff-model-wedge-zm-ht). Despite the legacy `-ht` URL, the current product data and gallery show a standard ZM 52/08 wedge with a polished toe margin, rather than the full-face high-toe model. The authored heads follow those pictured contours and details. The existing bag lofts remain 44°, 50°, 56° and 60°; the 44° model is a visual adaptation, not a claimed retail ZM specification.

The new heads have one closed body flowing from a thin upper blade into a sculpted lower muscle, a narrow polished shoulder and a rounded sole. The satin rear has slight camber and a fine curved milling band. Each face has a fitted blasted field, subtle milling and 14–15 flush scorelines. The heel shares its boundary with the hosel, whose straight barrel aligns with the steel shaft and plain satin-black ferrule. Loft numerals are fitted to both the back and the sole, with small nominal bounce markings on the sole. No shields, logos or product lettering are included.

Contours, 85–86 mm blade widths, 55–58 mm face heights, 64° lie, nominal lengths and bounce treatments are authoring estimates from the photos. The build validates the generated loft and lie, the single closed head component, and the alignment of the hosel and shaft. Surface details are fitted within 0.045 mm of the main skin. The viewer follows each wedge's loft in **Träffyta**, has a dedicated back angle and steel lighting, and fits the actual geometry in head and full-club presets.

Run `node tools/blender-clubs/acquire-references.mjs --wedges` to fetch the research photos, and `node tools/blender-clubs/build.mjs --wedges` to rebuild only the four wedges through Blender MCP. The other ten exports are retained. With the review fixture running, `node tools/blender-clubs/check-wedges.mjs` captures all four backs, faces, soles and full clubs, plus SW toe/address/mobile and neutral-shading surface views. `wedge-refinement/geometry-audit.json` records geometry checks; `browser-audit.json` verifies framing and browser errors. The `before-` images preserve the preceding designs.

### Centre-shaft putter

`putter_geometry.py` follows the CS22 in the user's four supplied photographs and [Wilson's product gallery](https://au.wilson.com/products/staff-model-cs22-putter-right-hand-34). The centre-shaft mount, 3.5° loft, 71° lie and chosen 34-inch nominal length follow [Wilson's 2025 catalogue](https://storage.googleapis.com/amer-gc-storage/wilson/golf/catalogs/2025_WilsonGolf_Product_Catalog-NAM.pdf). The approximately 104 × 61 mm footprint, 24 mm face height, rear slope, channel and edge radii are authored estimates from the photographs.

The head is a closed half-moon solid with a broad face bar, machined U-shaped shoulders, a recessed channel and a slim rounded rear rim. The channel floor approaches the rim at the back. A short flared centre socket is united into the head and aligns directly with the straight steel shaft. The putter has a separate flat-front rubber grip, with no iron-style hosel or ferrule. Three fitted black alignment lines run along the channel; the centre line is wider. The face and shoulders carry fine geometric milling. Two machined sole recesses contain flat satin weights with small hexagonal sockets. The head, shaft and grip carry no manufacturer or product text.

Putter-specific viewer angles show the top and channel in the default view, the milled face in **Träffyta**, and the weights in **Sula**. Softer steel lighting balances the face and recessed floor. Head and full-club presets fit the actual vertices, including the short centre socket, on desktop and mobile.

Run `node tools/blender-clubs/acquire-references.mjs --putter` to fetch the four manufacturer photographs, then `node tools/blender-clubs/build.mjs --putter` to rebuild only the putter through Blender MCP. With the review fixture running, `node tools/blender-clubs/check-putter.mjs --clay` captures hero, face, sole, address, toe, full-club and mobile views plus neutral shading. `putter-refinement/geometry-audit.json` checks the closed connected head; `browser-audit.json` records framing checks and browser errors. The `before-` images preserve the previous model, and `catalogue-before.json` permits comparison with the thirteen retained clubs.

Existing name/carry bags still load. The model selector supports custom names. The default bag now includes a putter; its carry is fixed at zero and excluded from carry recommendations and shot planning. Existing custom bags are not automatically expanded: **Lägg till** offers a putter when one is missing. Saving preserves model choices and distances; closing or Escape cancels unsaved changes.

`browser-audit.json` and the PNGs record the production markup in a lightweight browser fixture. The browser check exercises every asset, rotation, zoom presets, edit/save/cancel, model selection, reset, and a 390 px mobile layout. Unit tests cover appearance mapping, old bags, and keeping putters out of carry recommendations.
