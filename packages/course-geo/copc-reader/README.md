# copc-reader — Laserdata Skog windows in Node

Offline-only. Reads bounded windows of Lantmäteriet's Laserdata Skog COPC items
over authenticated range requests and builds the canopy rasters the vegetation
compiler consumes. It exists because the pinned Pixi toolchain (PDAL) is not on
every machine, and because PDAL's spatial pruning reads the wrong nodes on these
files anyway (below).

This folder is deliberately **not** a pnpm workspace package: it carries the only
third-party dependency in the offline pipeline (`copc` + `laz-perf`, WASM) and
installs on its own, so the root lockfile and the browser build never see it:

    npm install --prefix packages/course-geo/copc-reader

Tools, in plan order:

- `verify-octree-convention.mjs` — decodes nodes at every depth of each item and
  reports which subdivision the hierarchy keys follow.
- `build-canopy.mjs --ground puttom --out <dir>` — per finest tile: read the
  window from the owning campaign, ground from the cloud's own class 2/9
  returns, height above ground, 1 m canopy height model and return counts;
  compares cloud ground with the published DTM tiles; writes raw Float32
  rasters + JSON sidecars to `--out` (outside the committed tree) and a small
  evidence file under `geo_data/course-v2/<ground>/vegetation/`.

The finding worth knowing: **these items do not subdivide the COPC cube.** Each
axis is subdivided over the header's data extent (Y over the 5 km half-tile, Z
over the point heights); only X coincides with the cube because the data is
10 km wide. Every decoded node's point count equals the hierarchy's, so reads
are exact at node granularity, which is the equivalence gate the plan asks for.
