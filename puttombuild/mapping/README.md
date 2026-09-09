# Puttom orthophoto alignment

`lm-ortho-discovery.json` records a fresh official STAC catalogue search. The
latest complete campaign on 2026-09-09 is `orto-u2-2024`, captured 2024-06-27:
four 0.16 m RGBI GeoTIFFs, in EPSG:3006. The course crosses both source seams at
E 697500 and N 7025000. Acquisition reads bounded windows and records hashes;
source pixels stay in `puttombuild/cache/`, which Git ignores.

Replay the committed native windows from the repository root:

```sh
python -m pip install -r puttombuild/mapping/requirements.txt
python puttombuild/mapping/lm_ortho.py --probe-only
python puttombuild/mapping/lm_ortho.py
```

Set `LANTMATERIET_USERNAME` and `LANTMATERIET_PASSWORD`, or
`LANTMATERIET_BEARER_TOKEN`, in the process environment before running acquisition.
The Python entrypoint reuses `visbybuild/mapping/lm_ortho.py` for strict source URL
checks, real HTTP 206 TIFF probes, georeference validation and authenticated COG
window reads. It requires NumPy and Rasterio. `--only context-0-0,hole-01-green`
selects named windows; existing matching raster/ledger hashes are reused.

`discover-lm-ortho.mjs` and `lm-ortho-plan.mjs` prepare a **new** intake. The plan
was built from the earlier course model, so regenerating it from the revised
model changes request bounds and hashes. Preserve the committed plan when
replaying accepted traces. Run `reconcile.mjs --baseline` and pass that baseline
to the planner's exported function if preparing the original model again.

The adopted changes and open issues are described in
[`docs/puttom-orthophoto-alignment.md`](../../docs/puttom-orthophoto-alignment.md).
`npm run check:puttom-mapping` verifies the source-coordinate contract and pack.
With the app served locally, `BANVY_GPU=1 node puttombuild/check-runtime.mjs
http://127.0.0.1:8746` checks the default and fallback renderer.

The default plan includes all eighteen tee and green areas, plus nine continuous
context windows covering every hole and the facilities with 120 m of surrounding
context. `--full-aoi` adds coverage of the much larger discovery area (20 km²).
Each `<window>.tif` has a matching JSON ledger with native pixel-edge bounds,
dimensions, GDAL affine transform, source captures, valid fraction and SHA-256.
`acquisition.json` records the selected plan hash, actual byte access and each
completed window. Each window is at most 16 million pixels.

Puttom's existing model uses true north in a local geographic frame. Review
geometry must invert its declared origin and metres-per-degree constants, then
project into EPSG:3006. Adding local x/z directly to a projected origin introduces
a roughly 3.5-degree rotation error. Pixel bounds refer to edges; pixel centres
are `E=minE+(column+0.5)*resolution`, `N=maxN-(row+0.5)*resolution`.
The pixel spacing does not establish positional accuracy, tee identity or current
conditions. The image date and the 2023/2026 laser dates are separate evidence.

```sh
node --test puttombuild/mapping/lm-ortho-plan.node-test.mjs
python -m unittest discover -s puttombuild/mapping -p test_lm_ortho.py
```
