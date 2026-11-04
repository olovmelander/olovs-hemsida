# Load times (4 November 2026)

Owner request: load times and performance, using what three.js r187 offers. This
note covers the first batch, and what the measurements say is left.

The contract stands: the whole course is ready locally before the cover lifts
([complete-course startup](course-startup-implementation.md)), so opening a
half-built world is not an option. Its targets are 8 s cold on a desktop at
50 Mbps, 15 s cold on a phone at 20 Mbps, and a cached reopen in 3 s on a desktop
and 5 s on a phone. They are not met.

## Results

Veckefjärden, RTX 5080, `boot-profile.mjs` and `cached-reopen.mjs`, navigation to
`#boot.done`. The first column is the morning's baseline, the second the build
after the batch. They were taken hours apart, so they are not an interleaved A/B.

| | Before | After | Target |
|---|---:|---:|---:|
| Localhost, high quality | 13.98 s | 8.67 s | |
| Desktop cold, 50 Mbps / 40 ms | 21.5-29.1 s | 13.4-13.8 s | 8 s |
| Phone proxy cold (4x CPU, 20 Mbps / 80 ms, low quality) | 48.6-57.4 s | 40.0-40.8 s | 15 s |
| Cached reopen, high quality | 14.6 s | 8.9 s | 3 s |
| Cached reopen, low quality | 8.8 s | 7.8 s | 5 s |
| Downloaded | 36.3 MB | 29.8 MB | |

The two runtime switches, interleaved on the final build (`ab-boot.mjs`, three
rounds, `warmframe=0&treehoist=0` against the default):

| | Before | After |
|---|---:|---:|
| Localhost | 10.38 s | 9.14 s |
| 50 Mbps | 16.70 s | 14.79 s |

Earlier in the day the same switches measured 11.28 → 10.01 s on localhost, 18.45
→ 15.90 s at 50 Mbps and 46.98 → 45.34 s in the phone proxy. The smaller files and
the CPU fixes have no switch of their own, and show only in the first table.

The phone proxy runs on this GPU, so it says nothing of a real phone's graphics.

## What changed

- **The warm frame** (`warm-pipelines.mjs`). The opening compile covers the scene's
  own materials. The shadow pass and post passes are reached only by a real frame,
  so 42 of the 109 pipelines were built one at a time in the first frame, and the
  GPU took 1.84 s over it. A frame behind the cover now requests them through
  r187's own promises path (`Pipelines.getForRender`), in parallel, and repeats
  until a frame asks for nothing new. There is no list to keep. The first frames
  arrive 72, 13 and 6 ms apart, against 1,037 and 341. `?warmframe=0` is the before.
- **The trees start downloading as the terrain stage begins**, not when the forest
  stage reaches them, which was 10 s into a cold boot at 50 Mbps. `?treehoist=0` is
  the before.
- **The tree files**, 16.6 → 7.4 MB at high quality and 5.2 → 3.7 MB at low:
  - The meshes are `KHR_mesh_quantization` (`tree-glb.mjs`), 19 bytes a vertex
    against 50. three reads it without a decoder, and the loader did not change.
  - The normal atlases are at half size, without the alpha nothing read, and take
    PNG's filters (`tree-png.mjs`), which the writer had off. Portraits and bark
    close-ups at 3 m look the same. That also frees about 21 MB of GPU memory.
  - The colour atlases are byte for byte as they were.
- **Work no longer thrown away**, 0.7 s on this machine:
  - `horizonAO`, twelve terrain samples, ran for every road vertex, and gravel
    never used it.
  - `isFacilityInterior` walked every footprint's edges for each of 155,342 trees.
    `withinRing` rejects by the ring's box first, which cannot change the answer.
    Plantings are identical on all 13 courses.
- **`_headers`** names the realistic catalogues, for a Cloudflare deployment. The
  live site does not read it: see below.

## The host

The live site is GitHub Pages. It gzips JSON, JavaScript and GLB, but not PNG; it
sends `max-age=600` for everything; and it ignores `_headers`. So PNG bytes travel
as they are, and a returning visitor's caching rests on the service worker.

## Where the time is now

A CPU profile of a boot on localhost, by stage, in seconds:

| Stage | Wall | Idle | Script |
|---|---:|---:|---:|
| Reading terrain data | 1.60 | 0.50 | 0.91 |
| Building terrain | 1.92 | 0.60 | 1.17 |
| Fairways and greens | 0.86 | 0.05 | 0.76 |
| Water | 0.83 | 0.02 | 0.73 |
| Forest | 1.24 | 0.03 | 1.05 |
| Flags, light | 0.87 | 0.14 | 0.60 |
| First view (compile) | 1.75 | 0.64 | 1.01 |

There is no single hot spot left. Roads (0.6 s), water-bed carving (0.6 s), the
ground atlas (0.5 s) and TSL's shader builds (0.7 s) are the largest blocks. A
cached reopen does all of this again, so it cannot reach 3 s by trimming.

Candidates, by what they would need:
- **A snapshot of the built world for reopens** is the only route to 3-5 s. It is
  a large change, since most of the state lives in `main.js`.
- **Workers** for the terrain carving and ground atlas. Water depth is exact data,
  so this needs its own proof.
- **KTX2 textures** would cut GPU memory and upload further. They need an encoder
  in the build, which is a new dependency and the owner's call.
- **Fewer pipelines.** The 25 s run below suggests compile matters more on a first
  ever visit than these numbers show.

## The frame

Timing every GPU pass (local: `tools/goldens/gfx/perf/pass-timing.mjs`, timestamp
queries and a counter on every draw) gives Puttom 5 green at about 12 ms:

- **The post passes**, GTAO, temporal AA, bloom, god rays and sharpen, are under
  1 ms together. The temporal AA is 3.7 ms cheaper than MSAA.
- **The scene pass is about 90% of the frame.**
- **Of its 20 million triangles, trees are 15 million**, and over a quarter of
  that is trunks. Terrain is 3.5 million. Nearly 2,800 trees drew at Hero, about
  5,000 triangles each.

Drawing every tree in the Full model takes the frame from 11.95 to 7.05 ms there,
and from 9.20 to 5.95 ms at Puttom 1 tee. The owner's rule (5 September, see
[the tree LOD plan](tree-lod-plan.md)) is that detail goes by where a tree stands,
never by how far the camera is, so a distance ladder is out. The rule's own first
form is the answer: **band A (90 m from a hole line) stays Hero and band B (to
300 m) draws Full**, fixed for the visit (`TREE_BANDS`, `?treebands=0`). It shares
the Hero's materials, so it adds no pipeline. High quality only; low quality
already draws Full, and the painted trees are unchanged.

Interleaved, two rounds, the GPU idle:

| View | Before | After | |
|---|---:|---:|---:|
| Puttom 5 green | 11.85 ms | 9.70 ms | -18% |
| Puttom 1 tee | 9.40 ms | 7.00 ms | -26% |
| Veckefjärden 13 tee | 8.70 ms | 7.65 ms | -12% |

A boot costs about 0.05 s more, and 1.1 MB. `tree-flight.test.mjs` holds that no
tree changes tier in flight with it on. The gallery's worst views differ in up to
9% of pixels, at leaf level, in trees past 90 m from any hole.

What each part of the scene costs a frame, switched off and on inside one running
page (local: `tools/goldens/gfx/perf/toggle-cost.mjs`), which drifting load on the
machine falls on alike. Puttom 5 green, with the bands on:

| Part | Instances | Triangles | ms a frame |
|---|---:|---:|---:|
| Hero trees (band A) | 2,338 | 6.3 M | 3.6 |
| Full trees (band B) | 3,320 | 3.2 M | 1.4 |
| Terrain | 26 tiles | 3.5 M | 1.0 |
| Lake mist | 3 | 0.2 M | 0.4 |
| Far forest (vista) | 596,718 | 1.2 M | 0.2 |
| Tree impostors | 51,614 | 0.1 M | 0.2 |

Impostors are very cheap. `?distanthero=` takes only 16 and 24 as thresholds, and
any other value turns the 24 px rule off, which is the before. So a frame near 15
ms at `distanthero=48` is every corridor tree at Hero, and shows what the rule saves.

**For the owner to decide:** the threshold itself. A local build taking 32 and 48
as real values gave, with another GPU app running, so as a direction only:

| View | 24 px (approved) | 32 px | 48 px |
|---|---:|---:|---:|
| Puttom 5 green | 11.85 ms | 9.65 ms | 6.95 ms |
| Puttom 1 tee | 12.30 ms | 6.55 ms | 6.60 ms |
| Veckefjärden 13 tee | 8.45 ms | 7.45 ms | 8.50 ms |

It is the one place detail goes by distance, and the owner approved 24 px after
seeing it, so it has not been changed. A higher value needs clean timing and a look
at the crossfade in motion. The review values are not in the build.

## Measuring

- Every engine edit changes the source revision and turns the prepared data off
  until the next bake, so an edited build is slower than what ships. A/B on one
  build is fair. To profile the real path use a pinned build (local:
  `tools/goldens/gfx/perf/vite.prof.config.mjs`).
- Add a new before switch to `preparedTintAllowed`'s display-only list, or the A/B
  turns the prepared data off on one side.
- Check that the machine is quiet. The last baseline of the day ran with the GPU at
  10-20% and 40 unrelated Python processes, and its numbers were thrown away.
- Run both orders. A first run right after a rebuild measured 25 s where three
  repeats gave 18 s, and the gain looked like 9 s where it was 2.6 s. That run was
  never repeated, and the likely cause is a cold driver shader cache, which a real
  first visit would also have.
