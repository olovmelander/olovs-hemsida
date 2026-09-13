# Water at the outer terrain ring

The straight blue-to-dark edge at Veckefjärden was the edge of the inferred
water mask. `V2GraphTerrainAdapter.detectFlatWater()` always sampled LOD 2:
4 m samples covering 8,192 m. Terrain continued to 16,384 m, so the remainder
of Själevadsfjärden had neither a water sheet nor a water bed/tint.

The adapter now chooses the finest loaded ring whose bounds cover the whole
terrain footprint. On the current catalog this is LOD 3, with 8 m samples.
The raster remains 2,049 × 2,049, avoiding a fourfold increase in its storage.
The same result drives water sheets, terrain tint, vegetation exclusion and
bed carving across the former boundary. Mapped bodies retain their polygon
geometry and measured levels, and overlapping inferred water takes that level.

The minimum inferred lake area remains 4,800 m² rather than growing with the
sample spacing. The existing height/level checks remain in place; missing
height samples cannot qualify a cell as flat water. Inferred shorelines now
use the 8 m survey ring. Small mapped course ponds still use their own geometry.

This is shared by all courses that infer water from terrain. Lidingö, Visby
and Tortuna use `terrainPlacement: measured-only` and retain their separate
mapped-water handling. Norrfällsviken retains its connected-ocean exclusion.
No course packs, source terrain, or water materials are rebuilt by this change.

Validation:

- 53 Vitest checks covering flat water, ring selection, beds, mapped water and
  coastal terrain masks; 13 Node checks covering continuous/coastal water.
- `node tools/audit-distant-water.mjs`: all 13 catalog entries / 10 grounds
  have complete 16,384 m coverage at the existing raster allocation size.
  Actual Själevadsfjärden probes cross the former boundary and reach its
  western section; a dry-land control remains dry.
- Before/after images in `output/distant-water-before` and
  `output/distant-water-after` reproduce the reported Veckefjärden view.
- WebGPU browser checks pass for both Veckefjärden courses, Ängsö, Lidingö
  and Norrfällsviken. Veckefjärden also passes in WebGL2. Final production
  checks are in `output/distant-water-production` and
  `output/distant-water-webgl`; the live-development Ängsö run was repeated
  against production after a development hot reload interrupted it.
- `npm --prefix apps/golf run build` passes.

Browser reproduction (PowerShell, with a server running):

```powershell
$env:BANVY_GPU='1'
node tools/check-distant-water.mjs output/distant-water veckefjarden,veckefjarden-korthalsbanan,angso,lidingo,norrfallsviken
```

Set `BANVY_BASE_URL` to use a production preview. Pass `webgl2` as the fourth
argument to check the fallback renderer. Each run records screenshots,
coverage bounds, water sheets and browser errors. `V3D.flatWater()` also
exposes mask dimensions and bounds for inspecting the running application.
