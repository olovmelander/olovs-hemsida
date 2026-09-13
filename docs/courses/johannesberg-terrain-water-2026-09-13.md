# Johannesberg terrain and water correction — 2026-09-13

Branch: `codex/johannesberg-terrain-water-fix`, based on main
`97fa9284ef45fe40a7607c725b08245203859f33`.

## False water across fields

The water detector reads the resident 8 m terrain ring, which stores heights in
8 cm increments. Its 3 cm neighbour tolerance broke gently sloping fields into
separate, exactly level terraces. Each terrace could then pass the minimum-area
and component-level lake tests. These false lakes supplied water sheets, blue
ground tint, vegetation exclusions and carved beds, so the fields looked wet
and their water boundaries looked coarse.

Johannesberg's two courses now opt into joining neighbouring height bins before
checking the whole component's level fraction. A small Float32 rounding allowance
prevents a decoded 8 cm step from failing the comparison. The component criterion
remains 70% of samples within 5 cm of the median. The raster carries the actual
height quantization from its source tiles; this is not inferred from horizontal
spacing.

The setting is explicitly per ground. A trial applying broader joins to every
ground failed the existing Själevadsfjärden control because lake/floodplain
connectivity differs there. Other grounds retain their established detection
policy. The distant-water audit now uses the same per-course setting as runtime.

The published Johannesberg ring reproduces 2,722 false uncovered-water cells
(17.4208 ha) within legacy coordinates x ±1,100 m and z ±1,200 m. After correction
there are zero inferred water cells in that window. Tests separately confirm
terrain-detected water inside Uttran and Hävsjön and water-bed coverage in every
mapped water polygon, including Rotsjön and all course ponds. Mapped polygons
remain authoritative even when the detector does not independently classify
them as a flat component.

## Grey service yard

The large grey area beside the service buildings corresponds to the existing
traced works yard in `johannesbergbuild/sat-traces.json`. Its boundary was only
painted into the 6 m terrain tint; the surface atlas treated it as surrounding
ground. The shared surface extractor now assigns this existing polygon the
same generic gravel display as untagged parking. The one-metre atlas supplies
its material and boundary, including its concave grass margin. The fallback
ground colour uses the gravel palette too.

This does not remove real hardstanding, redraw the yard, claim a newly surveyed
material, or move buildings. Source terrain chunks and course geometry are
unchanged. Both WebGPU and WebGL2 consume the same surface ownership and water
field. No extra terrain tiles, water raster cells or overlay draw calls are
introduced.

## Verification

- 66 tests pass across the nine focused terrain, water, surface and prepared-cache
  test files, including regression tests using the published Johannesberg tiles.
- Production build passes.
- `check-app-build.mjs` and `check-renderer-build.mjs` pass.
- The distant-water audit checks the 16,384 m extent for all 13 course entries
  over 10 grounds, including the retained Själevadsfjärden controls.
- The existing source-revision hash includes the changed engine modules and
  config. Previously prepared water/tint assets cannot match the new runtime
  identity and reinstall the old masks; runtime recomputes them.

Visual verification remains open: local Chromium could not start because this
execution environment denied its socket operation, and the connected browser
could not access the local preview (`ERR_BLOCKED_BY_CLIENT`). No successful
before/after browser captures or device frame-rate measurements are claimed.

For the visual review, open Johannesberg and Johannesberg 9 with `v2=require`
and forced WebGL2 (`gl=1`), then check the service yard and fields west of holes
1–4 while orbiting and zooming. Repeat on WebGPU. The service yard should remain
hardstanding with a crisp material boundary; the surrounding fields should be
dry. `V3D.probeGround(x,z)`, `V3D.waterBedAt(x,z)` and `V3D.groundSample(x,z)`
provide the corresponding runtime diagnostics.
