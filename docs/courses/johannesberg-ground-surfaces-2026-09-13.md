# Johannesberg ground surfaces — 2026-09-13

Follow-up to PR #60. The false field water was fixed, but the screenshots
showed different defects: a solid blue-grey outcrop beside hole 18, blue
patches on the wooded slopes near hole 17, and a grey sheet over the estate
service buildings.

## Source comparison

Three georeferenced windows were read from Lantmäteriet's public
`Ortofoto_0.16` viewing mosaic in EPSG:3006. The source URLs, exact image
dimensions, bounds, SHA-256 hashes, traced pixel vertices and derived legacy
coordinates are in `johannesbergbuild/mapping/ground-surface-review.json`.
Raw imagery remains in the ignored cache and is not an app texture.

The mosaic's exact capture date is **unverified**. It is not assumed to be
the 2025-06-14 date established for the separate September 9 RGBI acquisition.
The selected image vertices were converted using PROJ/pyproj, the build's
actual longitude scale and its declared origin; no fitted shift or rotation
was applied. The maximum projection/rounding residual over 175 vertices and
controls is 0.000694 m. This is internal consistency, not survey accuracy;
manual delineation uncertainty is approximately 1.5 m and larger in shade.

The photographs contradict the inherited fills:

- The 16,829 m² yard polygon includes substantial grass, rocky vegetation
  and buildings. Gravel follows access lanes and small aprons, with an
  unpaved island inside the northern junction.
- The 1,240.5 m² hole-18 rock polygon mostly covers a tree island. Three
  visible exposures total 78.0 m²; canopy is not an observed rock surface.
- Visible rock faces near hole 17 are local exposures, not broad blue washes
  across the wooded slopes. Four traced exposures total 321.2 m².

The published Lantmäteriet 1 m Markhöjdmodell already supplies this terrain.
Its slopes corroborate relief but do not identify mineral versus vegetated
ground. Heights, terrain chunks, datum bridge and water geometry are retained.

## Applied correction

The Johannesberg scenery module applies a versioned source review to both
published course packs before the atlas, tint and vegetation consumers run.
The inherited pack remains the pinned migration baseline. A changed baseline
or coordinate frame is rejected rather than silently overwritten.

The broad yard fill is retired. Three gravel polygons total 3,145.0 m²,
including surfaced ground outside the old fill; their concave edges and the
unpaved interior island are retained. On the actual one-metre atlas, 13,780
of the old yard's 16,559 gravel cells return to natural ground. Existing
roads, building footprints, sand deposits and all playing surfaces stay intact.

Seven observed rock polygons replace the broad hole-18 fill. Both near and
far ground stop inferring exposed rock from slope alone for Johannesberg.
The two looks use neutral mineral display pigments instead of the shared
painted mode's blue rock colour. These are display colours, not a claim that
an orthophoto's exposure directly measures albedo. Other courses retain their
existing palettes and slope rules.

The review JSON participates in the source revision hash, invalidating old
prepared tint identities when its geometry changes. The default atlas renders
the gravel without additional overlay draws or a larger terrain allocation.

## Verification

- 75 focused tests pass across 11 files, including the actual eighteen- and
  nine-hole packs, source controls, polygon validity, the excluded island,
  baseline guards and the earlier false-water regressions.
- `python johannesbergbuild/mapping/check-ground-surface-review.py` verifies
  all three source image hashes and PROJ coordinate conversions. `--fetch`
  can retrieve the pinned public windows but refuses changed mosaic bytes.
- The production player build passes.
- `tools/check-johannesberg-ground-surfaces.mjs` runs the built WebGL2 app,
  verifies ten source control points against its atlas and the published
  terrain, and captures holes 17–18 and the yard on both courses. Its focused
  GitHub workflow stores only app screenshots and the runtime report.

Local Chromium startup was blocked in the workspace. Browser results are
established by the workflow run, not by the build or CPU tests above.
