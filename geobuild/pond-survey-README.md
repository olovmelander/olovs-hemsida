# Generic pond survey CLI

The CLI reads a selected course model and that course's published 1 m EPSG:3006 / RH 2000 terrain. It writes candidate evidence only. It does not modify or approve model geometry.

```bash
node pond-survey.mjs --repo /path/to/olovs-hemsida --build upsalabuild --ground upsala --out /tmp/upsala-pond-review
BUILD=puttombuild GROUND=puttom node pond-survey.mjs --repo /path/to/olovs-hemsida --out /tmp/puttom-pond-review
node --test pond-survey.node-test.mjs
```

Optional `--ids w35415031,w439104660` limits the selected bodies. `--out` is a file prefix: outputs are `.json` (full diagnostics/provenance) and `.epsg3006.geojson` (candidate polygons). Geometry is projected GeoJSON in metres, not longitude/latitude; it carries an explicit CRS member.

Each body's level is measured from its own finite terrain samples. Original model levels are preserved as legacy-datum metadata and are not used as an RH 2000 threshold. No fixed fjord level or course-specific geometry is inherited. Source/model/manifest/tile checksums are recorded and checked. Invalid 1 m grids, inconsistent shared samples and remote BUILD/GROUND combinations fail.

The flood uses four-connectivity without morphological opening. All outer components and interior islands survive. Exact raster boundary area is checked against occupied cells; only collinear boundary vertices are removed. The full contour is a pixel-cell boundary, not a claim of sub-metre shoreline accuracy. It requires dated orthophoto and topology review before any adoption. Vegetated lobes that lie outside a strict height band remain unresolved by this technique; removing morphology alone does not solve that material/height ambiguity.

Incomplete terrain coverage, NoData, weak plate evidence and floods reaching the search boundary produce level/diagnostic records rather than replacement geometry. A flat surface can still be vegetation, a dry hollow, prepared ground or artefacts: `automaticAdoption` is always false.

Validation completed on Upsala (4 selected bodies, 4 raw candidates) and Puttom (13 bodies, 2 raw candidates; others explicitly outside/partial/insufficient coverage). No candidate was adopted. Four pure invariant tests cover islands, a one-cell connecting neck, source-independent levels and NoData rejection.
