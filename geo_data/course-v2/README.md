# Course v2 geospatial source registry

This directory is the non-runtime foundation of the course digital-twin
pipeline. It does not change the current GPK1 packs. Every physical ground has
one source manifest, while child courses share the same ground, coordinate
origin and source coverage.

The manifests are JSON rather than free-form YAML so validation and checksums
stay deterministic without adding a parser to the legacy application. The JSON
Schema files live in `packages/course-geo/`; semantic rules that JSON Schema
cannot express are enforced by the Node validator.

Run the gate from the repository root:

```sh
pnpm check:geo-sources
```

The gate verifies:

- exactly six physical grounds and all nine course slugs;
- the immutable EPSG:5845 / EPSG:3006 / EPSG:5613 contract and axis order;
- known product and licence records for every source;
- explicit lifecycle, intended use, accuracy tier and replacement for every
  migration-only source;
- SHA-256 for every committed source asset and migration artifact;
- no authoritative source without an approved licence, checksum and acquisition
  date;
- no unapproved canonical origin masquerading as a coordinate.

`packages/course-geo/frame.mjs` is the only v2 mapping from approved national
coordinates to Three.js positions. It refuses pending origins, fixes east to
`+x`, north to `-z` and RH 2000 height to `+y`, and fingerprints the
millimetre-rounded frame contract so an origin cannot drift silently.

The first D1 migration is also reproducible. The Pixi workspace under
`packages/course-geo/toolchain/` pins GDAL, PROJ and PDAL for Linux, Windows and
macOS. It verifies all 15 official SWEREF 99 TM projection controls, coordinate
axis order, inverse round trips and the checksummed SWEN17_RH2000 grid before a
migration may run.

Run or verify the current horizontal migration from the repository root:

```sh
pnpm geo:migrate
pnpm check:geo-migration
```

`migration-residual-report.json` summarizes all six candidate origins and all
nine slugs. Each ground's `migration/` directory contains its converted
EPSG:3006 vector model and scoped residual report. “Playing geometry”, “within
5 km” and the entire legacy inventory are reported separately so distant OSM
features do not conceal the alignment quality around actual holes.

Every candidate remains explicitly unapproved. Legacy WGS84-like origins are
not independent controls, and legacy scalar heights have no persisted vertical
datum. The manifest's canonical EPSG:5845 origin therefore stays null until a
distributed control survey and authoritative RH 2000 terrain pass the gate.

Raw licensed or large assets remain outside git. Once acquired, their immutable
identifier, dates, CRS, checksum, accuracy and licence decision must be entered
before any compiler can treat them as authoritative.

## D2 pilot evidence

`norrfallsviken`, `puttom` and `upsala` now contain a checksummed
`acquisition/d2-discovery.json`. The snapshots use the live official STAC
catalogues and record:

- 1 m EPSG:5845/RH 2000 terrain coverage and water-break assets;
- newest useful Laserdata skog COPC coverage;
- the newest 16 cm RGBI orthophoto campaign, with explicit older gap-fill only
  where a broad AOI edge requires it;
- provider checksums, source byte sizes and independently downloaded/hashed
  public metadata;
- whole-AOI decoded upper bounds, which demonstrate why orthophoto is an
  offline measurement source and why runtime output must be per-hole tiles;
- the remaining authenticated-access and independent-control gates.

Run `node packages/course-geo/acquisition/check-discovery.mjs` to validate the
committed snapshots without network access. Refreshing them is an intentional,
reviewable network operation through the pinned Pixi `discover-pilots` task.
