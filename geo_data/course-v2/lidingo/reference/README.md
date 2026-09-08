# Lidingö geographic sources — 2026-09-07

These acquired sources support the provisional Lidingö 3D build. Their source
bytes, bounds and datums are distinct from the still-pending survey controls and
current-course review. See the
[build handoff](../../../../lidingobuild/mapping/NEXT-SESSION.md) for application
state and the [club inventory](../../../../lidingobuild/reference/club-source-assets.json)
for scorecard, banguide, photographs and proposed development plans.

| Source | Acquired data and retained evidence | Authority and limits |
|---|---|---|
| [OpenStreetMap map API](https://api.openstreetmap.org/api/0.6/map?bbox=18.115,59.370,18.145,59.385) | Complete dated extract: 1,100 ways, complete way node lists. [Inventory](osm-inventory.json), [golf WGS84](osm-golf-reference.geojson), [golf EPSG:3006](osm-golf-epsg3006.geojson), [routing](osm-routing-reference.geojson), [two-part boundary](osm-course-boundary.geojson), [projected context](osm-context-epsg3006.geojson). | © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Routes cover holes 1–18, par 70. Original extract: 15 greens including practice, 5 fairways, 19 tees and 13 bunkers. It remains incomplete supplementary geometry. Old Bing/Mapbox/survey tags and revision dates are not independent survey approval. |
| [Municipal 2019 orthophoto WMS](https://karta.lidingo.se/wms?servicename=wms_ortofoto_2019_oppendata&SERVICE=WMS&REQUEST=GetCapabilities) | Acquired 2,502 × 2,848 PNG at requested 0.5 m spacing, with EPSG:3011 worldfile. [Request and checksum](../discovery/municipal-ortho-2019.json), [licence evidence](../mapping/municipal-ortho-2019-licence.json). Local image: `lidingobuild/cache/municipal-ortho-2019/lidingo-2019-0p5m.png`. | **CC0 confirmed in the municipality's primary metadata**, naming this exact WMS: [dataset](https://metadata.lidingo.se/store/3/resource/31), [distribution and licence](https://metadata.lidingo.se/store/3/resource/32), [ortho series](https://metadata.lidingo.se/store/3/resource/20). Exact RDF bytes are retained beside the licence evidence. The 2019 service label identifies the campaign; exact capture date, native GSD and registration accuracy remain unknown. Dormant grass and shadows limit boundary interpretation. |
| Public municipal map, Lantmäteriet orthophoto layer | Normal public `baskarta_extern` WMS layer `theme-lm_orto_025` returned HTTP 200. Separate image/worldfile in `lidingobuild/cache/imagery-public-map/`. [Exact request, bounds, attribution and checksum](../mapping/public-map-ortho.json). | Public map metadata describes 0.25 m imagery; capture date is not established. This is a **separate © Lantmäteriet layer**, without an established measurement, derivative or redistribution grant. It does not inherit the municipal 2019 CC0 licence. Used only as visual corroboration; adopted image-trace vertices retain 2019 source positions. |
| [Lantmäteriet height STAC](https://api.lantmateriet.se/stac-hojd/v1/) — Markhöjdmodell | Item `658_67`: 4,198,401 finite 1 m samples, factor-1 range reads without resampling. [Acquisition](../acquisition/terrain-window.json), [discovery](../acquisition/d2-discovery.json). Local raster: `lidingobuild/cache/terrain-review/terrain-1m.f32`. | EPSG:3006 + RH 2000 (EPSG:5613), compound EPSG:5845; CC BY 4.0, © Lantmäteriet. The base terrain is not a putting-green survey. Observed range −0.0474 to 61.1399 m RH 2000. |
| Lantmäteriet background terrain | Four COG items `658_67`, `658_68`, `659_67`, `659_68`; factor-32 overviews sampled onto a fine-grid-aligned 257 × 257 lattice at 32 m. All 66,049 samples finite. [Sources, windows, checksums and method](../mapping/terrain-vista.json). Local files: `lidingobuild/cache/terrain-vista/terrain-vista.f32` and `terrain-vista.json`. | Same EPSG:5845 datum and CC BY 4.0 attribution. Covers an 8,192 m square for background relief. Source campaigns are dated 2023. Bilinear sampling and item-edge clamping are recorded; no missing-height or sea-fill values substituted. Source seams require visual review. |
| Lantmäteriet water break geometry | Downloaded 548,864-byte `m658_67_brytgeometri.gpkg`, SHA-256 verified. [Access evidence](../discovery/source-access.json), [clipped EPSG:3006 PolygonZ/MultiPolygonZ](../mapping/water-breakgeometry-epsg3006.geojson), [topology and Z review](../mapping/water-breakgeometry-review.json). Raw file: `lidingobuild/cache/water-breakgeometry/658_67.gpkg`. | GEOS intersection without simplification or repair. Five retained source features yield seven parts; source levels remain 0.1, 4.72, 14.05, 22.35 and 26.02 m RH 2000. The coastal feature yields three parts. No interior rings fall within retained portions; original islands outside the clip are counted in the review. Clip edges are not asserted shores. These are [water surfaces flattened in the DTM](https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/markhojdmodell-nedladdning-utokas-med-mer-innehall/), with no bathymetry. |
| Lantmäteriet Laserdata skog | Bounded reads of `21c031-658_67`, captured 2021-03-23, produced canopy, ground and return rasters across 64 windows. [Canopy evidence](../vegetation/canopy-evidence.json), [stand evidence](../vegetation/stand-evidence.json), [workflow](../vegetation/README.md). Local rasters: `lidingobuild/cache/vegetation/`. | Full item advertises 217,740,127 points. The complete 1.35 GB file was not downloaded; bounded reads retain pinned identity and exact decoded node counts. Unknown cells remain explicit. Canopy predates recent course changes; stand instances are not surveyed stems. Buildings, water and playing surfaces are excluded before rendering. |
| [Lantmäteriet imagery STAC](https://api.lantmateriet.se/stac-bild/v1/) — Ortofoto | Latest complete discovered campaign `orto-o2-2025`: two 0.16 m RGBI items captured 2025-05-31. [Item URLs and metadata hashes](../acquisition/d2-discovery.json). | Configured account returned **HTTP 403 for the national imagery data asset**. That download remains unavailable. Separate public map WMS access does not establish access to this asset or its reuse rights. Current authoritative image acquisition remains pending. |

The golf-reference extent is E 677162.470–678148.390,
N 6585834.264–6586998.971. The fine lattice runs from northwest sample centre
E 676676.5, N 6587423.5 to southeast sample centre E 678724.5, N 6585375.5;
all golf-reference vertices clear its edge by over 400 m. This is not a property
boundary. Fine raster SHA-256:
`80ffcd4865daa00f8e2393f43b8fcb1b37e020f968c0656a0189f80dde1de923`.

The vista runs from E 673604.5, N 6590495.5 to E 681796.5, N 6582303.5.
Its raster SHA-256:
`d287f250e20617ffd8f21d33bbcd367f6bd09122653569967851afa3db1692cc`.
The provisional render origin is E 677700.5, N 6586399.5, H −0.05 RH 2000.
The compatibility model shares this horizontal origin and uses absolute RH 2000
heights; the runtime bridge restores the render height origin without a fitted
datum offset. Independent origin and residual controls remain open.

The initial terrain-only compiler retained 85 terrain tiles and one coarse shell:
86 BVCH chunks, 7,803,796 encoded bytes. Its
[compilation evidence](../acquisition/terrain-compile.json) records that stage's
open gates. Later surface, compatibility and graph builds are tracked by the
[handoff](../../../../lidingobuild/mapping/NEXT-SESSION.md).
[Playing surfaces](../../../../lidingobuild/mapping/playing-surfaces.geojson) and
their [review](../../../../lidingobuild/mapping/playing-surfaces-review.json)
preserve the distinction between observed mowing boundaries and survey accuracy.

Rebuild retained geographic inputs from the repository root:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/lidingo/reference/prepare-osm.py
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/lidingo/reference/clip-water-breakgeometry.py
node packages/course-v2/compile-lidingo-terrain.mjs
node --test packages/course-v2/lidingo-ground-graph.node-test.mjs
```

Acquisition uses the configured account where required without serializing credentials:

```powershell
node --env-file=.env packages/course-geo/acquisition/build-terrain-window.mjs --ground lidingo --out lidingobuild/cache/terrain-review
node --env-file=.env geo_data/course-v2/lidingo/reference/acquire-terrain-vista.mjs
node --env-file=.env packages/course-geo/copc-reader/build-lidingo-canopy.mjs
node geo_data/course-v2/lidingo/discovery/discover-stac.mjs
node --env-file=.env geo_data/course-v2/lidingo/discovery/check-source-access.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/lidingo/reference/acquire-municipal-ortho.py
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/lidingo/reference/acquire-municipal-terms.py
```

Raw OSM XML and large images/rasters are ignored working inputs. Exact requests,
source identities and acquired byte hashes remain in compact evidence. Mutable
endpoints can return new bytes: a new download is a new snapshot requiring fresh
checks before replacing pinned geometry or published assets. Remaining source
work includes current imagery access, independent controls and review of 2019
playing surfaces and 2021 canopy against the present course. Club masterplans are
proposals and cannot substitute for as-built data.