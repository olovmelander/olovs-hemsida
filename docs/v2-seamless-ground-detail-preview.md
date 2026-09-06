# V2 seamless ground detail preview

Prepared 2026-09-06 against published main
[`ce3597883a6c7495fc8204c23acac82413f197b7`](https://github.com/olovmelander/olovs-hemsida/commit/ce3597883a6c7495fc8204c23acac82413f197b7).
Validated implementation checkpoint:
[`dc5d630d7c4065e3d8b9d575734899e106b6440e`](https://github.com/olovmelander/olovs-hemsida/commit/dc5d630d7c4065e3d8b9d575734899e106b6440e),
tree `04344053b64ea8287ec4e5c80d02efd3d8a36b48`.

## Change and scope

The existing packed DETAIL texture repeats across the ground. Its smooth clump
and broad-variation fields previously ended at unrelated noise values, leaving
straight tonal divisions at texture boundaries. The broad ground variation
repeats approximately every 118 m, so those seams could cross a substantial part
of a fairway or the surroundings.

With active v2 and `graphics=1`, those two fields now close continuously around
an integer noise lattice. Cached lattice values and interpolation coordinates
replace repeated calculations during texture construction. The same octave
counts and weights are retained; mean and contrast are calibrated against the
original quantized texture, within sub-byte tolerance. The fine-blade red channel
and glint alpha are byte-identical. This changes an appearance texture, not any
mapped ground class, outline, terrain height or object placement.

The single 512 × 512 RGBA CanvasTexture, mipmaps, filtering and anisotropy remain
the same, as do all material shaders. The shared smooth fields also feed gravel,
bushes, tufts, clouds and polished roughness. Both ordinary phone quality and
desktop quality receive the opt-in change; no higher tree tier is required.
`graphics=0` and visits without the flag retain the original texture bytes.

## Validation and rendering resources

359 Vitest tests pass, including original-byte parity, fixed R/A channels,
mean/contrast/clipping bounds and wrap continuity. App lint, production Pages
build, v2 app isolation and all seven physical-ground source manifests pass.
The source diff preserves course packs, mapped objects, terrain, camera code,
quality settings, tree populations and fixed geographic detail zones.

The [texture/material check](graphics/detail-texture-check.json) passes ten
software-rendered cases: actual v2 class-SDF ground material on uniform rough,
close/grazing views, three fixed camera offsets, and separate G/B diagnostics.
The reviewed close view loses its straight light/dark division. The same shader
programs are reused, with identical draw counts and resource measurements.

| Fixture resource | Before | After |
| --- | ---: | ---: |
| Drawing buffer | 256 × 192 | 256 × 192 |
| Draw calls, including output quad | 2 | 2 |
| Triangles, including output quad | 3 | 3 |
| Tracked texture resources | 6 | 6 |
| Tracked texture bytes | 1,988,608 | 1,988,608 |
| Attribute / index bytes | 132 / 12 | 132 / 12 |

Mean authored-byte wrap differences across both axes fall from 49.23 to 1.64
for clumps, and 55.92 to 0.036 for broad variation. Within-tile variation remains
similar. Canvas alpha premultiplication introduces existing RGB quantization;
the report separately measures actual Canvas readback and CPU reconstructions
of nine mip levels; these are not GPU mip readbacks.
The actual source's boundary differences also return below its ordinary
within-tile differences. No new clipping is introduced.

## CPU construction measurements

[Raw CPU results and both runs](graphics/detail-bake-benchmark.json) are retained.
The final run uses 21 warmed measurements per path, with rotating/reversed order
on a Linux Xeon container. It compares independent original equations, the
disabled helper, and the seamless helper using equally reused output buffers.

| DETAIL pixel bake | Median | p95 | p99 |
| --- | ---: | ---: | ---: |
| Original equations | 53.82 ms | 75.49 ms | 81.56 ms |
| Helper, graphics disabled | 47.37 ms | 59.67 ms | 73.03 ms |
| Seamless helper | 45.69 ms | 63.57 ms | 71.46 ms |

The earlier two-path run measured 54.09 → 40.93 ms at the median, but its p95
was 59.51 → 60.58 ms. Individual tail timings vary; the later run adds the
disabled path to check ordinary-visit startup work. Neither run establishes
device-wide performance. These measurements exclude canvas upload, GPU mip
generation, total startup, camera frames and peak memory. The new helper uses
170,496 bytes of temporary typed lattice/interpolation tables during the bake;
they are not retained or uploaded.

Reproduce the scoped checks with:

```sh
node tools/benchmark-detail-bake.mjs --out /tmp/detail-bake.json
node tools/check-detail-texture.mjs --out /tmp/detail-texture
```

## Course review and hardware checks

The [Uppsala capture record](graphics/v2-detail-visual-check.json) records a
successful matched before/after view: hole 1 from above at noon, low quality,
384 × 288 drawing buffer, DPR 1, automatic WebGL2 fallback and locked quality.
Both captures pass without errors. All 12 data/request fingerprints, the camera,
terrain visibility and geographic tree detail contract match. The observed
frame has 93 draws and 1,153,299 triangles on both builds. This is one accepted
software visual comparison, not a hardware or moving-camera benchmark. Review
found continuous ground and restrained texture changes with the same mapped
objects, paths, bunkers and water outlines.

[Open the ordinary-quality Uppsala preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&q=lo&hal=1&vy=tee&ljus=dag).
Use `graphics=0` at identical quality and resolution for the established
appearance. For comparing exact old/new revisions of this pass, keep
`graphics=1` on both builds so earlier graphics improvements remain enabled.

Physical desktop WebGPU and phone WebGL2 measurements remain open. Check
median/p95/p99 frame times, moving-camera hitches, total startup and memory at
identical course data, lighting, camera trajectories and actual drawing-buffer
dimensions. Verify automatic quality fallback has not lowered resolution.
Review Uppsala visually, Puttom's forest and Veckefjarden's water. The preview
stays opt-in until the same-or-better performance requirement is accepted.

## Recommended next pass

Camera stability is the next concrete candidate: refresh the camera's current
matrices before terrain/tree visibility work, and let a user's gesture interrupt
a preset transition. That work needs separate moving-camera checks, with fixed
geographic tree detail zones and unchanged settled views. It is not included
in this texture pass.
