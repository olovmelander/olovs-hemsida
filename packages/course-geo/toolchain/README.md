# Course geospatial compiler toolchain

This Pixi workspace is the reproducible native GIS environment for course-v2
builds. It is never shipped to the browser. The lock covers Linux x86-64,
Windows x86-64, Intel macOS and Apple Silicon macOS.

Pinned direct tools:

- GDAL 3.13.3;
- PROJ 9.8.1;
- PDAL 2.10.2;
- Pixi 0.78.0 as the lock/install client.

`pixi.lock` pins every transitive conda-forge artifact and checksum. Always use
`--frozen`; updating the lock is a reviewed toolchain change, not an automatic
side effect of running a build.

## First run

Install Pixi 0.78.0 using its official, checksummed release, then run from the
repository root:

```sh
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen verify
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen test-controls
```

The first command downloads only the 2,317,290-byte Swedish
`se_lantmateriet_SWEN17_RH2000.tif` grid from the PROJ CDN. The downloader
requires the exact SHA-256 and size recorded in `grid-source.json`. Subsequent
runs reuse the verified local cache. PROJ network access is disabled while GIS
commands run, so a missing grid cannot be silently substituted at build time.

## Legacy migration

```sh
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen migrate-legacy
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen check-migration
```

The first command deterministically converts all inventoried current model
coordinate pairs to absolute EPSG:3006 values and regenerates scoped residual
reports. The second performs the same calculation without writing and fails if
any committed output is missing or stale.

The generated origins are horizontal migration seeds only. No command promotes
them into `canonicalFrame.origin`: independent ground controls and an
authoritative RH 2000 height are still mandatory.

## D2 authoritative acquisition

Public discovery and metadata verification for the three pilots is separate
from authenticated data acquisition:

```sh
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen discover-pilots
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen check-discovery
```

Discovery queries Lantmäteriet's official `stac-hojd` and `stac-bild`
catalogues, projects densified AOI edges into EPSG:3006, verifies advertised
metadata checksums and records exact COG/COPC ids, capture dates, CRS, coverage
and byte sizes. Orthophoto selection keeps the newest campaign as primary and
records any older gap-fill explicitly; it never silently downgrades the whole
course to an older campaign.

Large source and clipped files are written only beneath the ignored
`toolchain/.cache/acquisition/` directory. COPC point bytes are range-streamed
through PDAL and are not retained. To run the authenticated 1 m terrain,
Laserdata Skog, water-break and tree-height windows, first order the free product access from
the providers and set credentials in the process environment. Use
[Lantmäteriet's Markhöjdmodell order](https://geotorget.lantmateriet.se/geodataprodukter/markhojdmodell-nedladdning-api)
and [Lantmäteriet's Laserdata Skog order](https://geotorget.lantmateriet.se/geodataprodukter/laserdata-nedladdning-skog-api)
and [Skogsstyrelsen's raster-account form](https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/anvandarkonto/);
the general Skogsstyrelsen statistics API account is not the tree-height raster
account.

```sh
export LANTMATERIET_USERNAME='...'
export LANTMATERIET_PASSWORD='...'
export SKOGSSTYRELSEN_USERNAME='...'
export SKOGSSTYRELSEN_PASSWORD='...'

node packages/course-geo/acquisition/access-preflight.mjs --ground puttom

# Check only Lantmäteriet while Skogsstyrelsen access is still pending.
node packages/course-geo/acquisition/access-preflight.mjs \
  --ground puttom --provider lantmateriet --json

pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen \
  acquire-pilot -- --ground puttom --write-evidence

# Independently exercise only the bounded COPC stream/statistics path.
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen \
  acquire-pilot -- --ground puttom --laser-only
```

`LANTMATERIET_BEARER_TOKEN` can replace the Lantmäteriet username/password
pair. The preflight reads only a 16-byte COG range, the 589-byte COPC 1.0
header and one 16-by-16 tree-height sample, rejects redirects/full-body
responses and never writes source data.
Secret values, authorization headers and provider passwords are never
serialized. A successful preflight proves access, not source accuracy or
canonical-origin approval. The COG reader uses `/vsicurl/` range access, writes
a ZSTD COG window, decodes statistics for a real memory/timing measurement, verifies each
downloaded water GPKG against the STAC SHA-256 multihash, and clips the geometry
to the AOI. The tree-height adapter splits the 1 m signed-Int16/decimetre raster
into bounded ArcGIS exports before building one checksummed COG.
The Laserdata Skog adapter selects the newest COPC item that contains a bounded
256 x 256 m pilot window, caps the read at one million points and retains only
height/classification/return aggregates. Its Basic/Bearer header is supplied to
PDAL over stdin and removed with the temporary metadata directory.

An acquisition is still a candidate. It cannot approve the canonical origin or
replace an independent control survey.

## Control discrepancy found during implementation

Lantmateriet's 2025 “Svenska transformationer i PROJ” PDF prints RH 2000 height
`16.993` m for its example input. On 2026-08-30, Lantmateriet's live coordinate
service returned `16.923` m, which agrees with the checksummed official PROJ
grid (`16.9225` m before service rounding). The test uses the live-service/grid
consensus and records the printed PDF value separately; its tolerance was not
widened to hide the 7 cm discrepancy.
