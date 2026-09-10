# Ängsö facilities: runtime audit

Read-only audit, 2026-09-10. No repository or ancestor `AGENTS.md` was found. This report describes the current working-tree source model and renderer; source polygons are inherited OSM or aerial traces, not surveyed building boundaries.

## Existing campus and nearby structures

`angsobuild/course-model.json` carries 142 building footprints and 39 simplified distant buildings. Every listed campus building has `h: null`; therefore no measured building height is encoded. Coordinates below are the existing legacy XZ frame, in metres, with east +X and south +Z. Centers are the mean of the four footprint corners.

| Source ID | Existing identity | Center X, Z | Existing geometry and limitation |
| --- | --- | --- | --- |
| `w516709523` | Ängsö GK Klubbhus, largest footprint | -175.525, 289.55 | Four-corner main block, approximately 33.5 × 16.3 m; only this footprint receives the special generic clubhouse treatment. |
| `w516709524` | Ängsö GK Klubbhus, east courtyard wing | -149.55, 296.25 | Four-corner block, approximately 17.7 × 9.3 m; generic outbuilding rendering. |
| `w516709525` | Ängsö GK Klubbhus, south courtyard wing | -172.8, 312.6 | Four-corner block, approximately 17.4 × 7.0 m; generic outbuilding rendering. |
| `w516709522` | Unnamed small building south of courtyard | -146.8, 331.4 | Four-corner block, approximately 10.8 × 5.0 m; function needs photo evidence. |
| `w516709521` | Unnamed small building southeast of courtyard | -81.525, 359.95 | Four-corner block, approximately 6.2 × 5.2 m; function needs photo evidence. |
| `w517780252` | Unnamed long structure in northern course context | -48.5, -689.075 | Four-corner block, approximately 41.7 × 14.0 m; likely service-context candidate, ownership/function unverified. |

Campus parking consists of `trace-parking-main` (X -235..-202, Z 196..305), `trace-parking-south` (X -230..-200, Z 308..349), and `trace-caravans` (X -200..-149, Z 197..264; grass, motorhome display). These are explicitly `prov: trace`; the two car-park polygons claim asphalt. The main access road is `w1026847411`, and campus service tracks include `w859328391`, `w859328392`, and `w1026847410`. Review their boundaries and surface materials against the new orthophoto.

The driving-range polygon comes from `sat-shapes.json` through `reconcile.mjs`, not an OSM range record. A range polygon does not establish the geometry or location of its shelter, mats, nets, ball machine, practice bunkers, signs, or furniture. These need explicit inventory entries from the reference review. Distant residences and farm footprints are scenery context and should not be labelled club facilities without evidence.

## Current visual limitations

`apps/golf/src/engine/scenery/angso.js` exports generic clubhouse parameters: red wall `0x8b3a2c`, terracotta roof `0xc0552c`, wall height 5 m, window rows 1.4/3.6 m, terrace enabled. Its comments mention dormers and a balcony, but the Ängsö module does not author their geometry. The generic renderer chooses window repetition, roof form, and terrace treatment. The two other named clubhouse footprints use the generic building pass, with default height 3.4 m; small buildings below 45 m² default to 2.6 m. Thus the current view cannot establish roof ridge/eave heights, accurate doors/window spacing, roof intersections, courtyard circulation, or the actual uses of annexes.

The module's custom `build()` draws the distant castle, church, and an 18th-hole juniper. There is currently no Ängsö `loadFacilities`, `renderClubhouse`, authored mesh package, or GLB integration. The only explicit building appearance override is the distant hole-5 aiming landmark `w215457959`.

## Frames and ground

- Legacy model: WGS84 origin latitude 59.57390, longitude 16.87100; `mPerLat=111320`; `mPerLon=111320*cos(latitude)` (serialized pack approximately 56375.41). X=(lon−16.87100)×mPerLon; Z=(59.57390−lat)×111320. Source: `angsobuild/lib.mjs`.
- The v2 terrain grid is EPSG:3006 / RH2000 (compound EPSG:5845), with canonical origin E 605665.5, N 6605721.5, H −1.75. The projected legacy origin is E 605689.962, N 6605447.157. Source: `apps/golf/src/engine/v2-angso-config.mjs`.
- Grid north and true north differ by roughly 1.61°. Use the existing `legacyGridBridge(config.legacyFrame).toLegacy(E−605689.962, 6605447.157−N)` for runtime placement. A translation alone is incorrect. For offline exact conversion use pyproj EPSG:3006→4326 followed by the legacy equations.
- The legacy terrain was rebuilt from the laser DTM. Its vertical datum offset is **0 m**; runtime Y is RH2000 height. Do not copy a height correction from another course.
- The reference workspace can use Blender X=E−605530, Y=N−6605140, Z=RH2000−an explicitly recorded vertical origin. Blender +Y is grid north. glTF's Y-up conversion alone does not perform the projection bridge. Record the Blender origin and ensure exported model placement uses the correct bridge exactly once.
- Native 1 m DTM evidence is `geo_data/course-v2/angso/acquisition/terrain-window.json`, a 4097² Float32 north-up grid with first center E603617.5/N6607769.5, raster in `packages/course-geo/toolchain/.cache/acquisition/angso-terrain-window/terrain-1m.f32`. It measures ground, not roofs. The published `apps/golf/public/grounds/angso` graph supplies runtime construction terrain.

## Integration path after reference review

1. Preserve the source-model footprints and IDs. Model each roof assembly and ancillary facility in named Blender collections, retaining explicit observed/inherited/estimated provenance. Roof-height evidence must retain RH2000 values and its capture date.
2. Keep ortho boards, source photos, laser returns, and reference ground in the Blender workspace; export only display architecture for runtime. Cache files under `angsobuild/cache/` are ignored by Git.
3. Use the existing authored-facility hook in `apps/golf/src/main.js:1742`, which receives Three.js, scene, `terrainH`, course identity, datum, base URL, and abort signal. It installs before the generic building pass (`main.js:5942`). A successful load supplies exact `replacedBuildingIds`; a failure must retain the generic buildings.
4. Two existing approaches are available: a GLB asset under `apps/golf/public/models/angso/` via `loadFacilities`, or Blender-exported triangle data through an optional Vite chunk and `renderClubhouse` (Upsala example). Norrfallsviken's `loadFacilities` shows explicit geographic conversion, absolute RH2000 roofs, per-edge foundation sampling, resource disposal, and successful-load-only suppression. Avoid importing another course's identity, offsets, or replacement IDs.
5. Confirm scale and footprint overlays in the source view, then inspect from courtyard, parking, range and hole 1/18. Check no duplicate source blocks, no floating foundations, sane shadows/materials in the WebGPU view, and graceful source fallback. Test coordinate transformation, replacement identity, and failure/disposal only when adding runtime integration.

Reference files inspected: `angsobuild/{course-model.json,lib.mjs,lib-v2.mjs,dtm.mjs,reconcile.mjs}`, `apps/golf/src/main.js`, `apps/golf/src/engine/{geodetic-frame.mjs,v2-angso-config.mjs,scenery/angso.js,scenery/norrfallsviken-facilities.mjs,scenery/upsala-architecture.mjs,scenery/upsala.js}`, acquisition manifests, and `.gitignore`. No runtime code, geometry, packages, or Blender state were changed by this audit.
