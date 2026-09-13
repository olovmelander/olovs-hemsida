# Why a course takes half a minute to open, and what to do about it

Measured 2026-09-12 on the SwiftShader harness in this container, on the built
app served by `tools/serve.mjs`. Two tools print every number here — quote them,
not this file:

```sh
node tools/serve.mjs apps/golf/dist 8620 &
node tools/boot-profile.mjs  --course puttom --v2 require   # where the time goes
node tools/boot-requests.mjs --course puttom                # what it costs the network
```

**The harness caveat that applies to every number below:** this container has no
GPU, so anything waiting on one — the first frame, the preflight, PMREM, shader
compile — is inflated and says nothing about a real card. The CPU- and
network-bound figures are representative, and the *ratios* are the point.
`docs/puttom-performance-status.md` records 24.0 s on this same harness in
September; CLAUDE.md records 25–28 s on an RTX 3070. The owner reports "more
than 30 seconds" on real hardware, so the numbers here are not a harness
artefact.

## The measurement

Puttom, the same course, opened two ways:

| | `?v2=require` (**the flagless default**) | `?v2=0` (GPK1 pack) | ratio |
|---|---|---|---|
| Requests to open one course | **1 043** | 33 | **31.6×** |
| Bytes | **37.58 MB** | 1.70 MB | **22.1×** |
| Boot, page clock | **29.6 s** | 13.0 s | 2.3× |
| Trees created | 210 079 | 56 525 | 3.7× |
| Far vista cones | 365 466 | 81 002 | 4.5× |

Of those 1 043 requests, **988 are `.bvch` chunks totalling 36.5 MB**. Everything
else — the app bundle, both fonts, the 483 KB pack, the manifests, one 583 KB
facility GLB — comes to 55 requests and 1.0 MB.

Stage by stage on the v2 boot (33.2 s total on the page clock in that run):

| Stage | s |
|---|---|
| läser terrängdata | 5.18 |
| startar renderaren | 3.12 |
| **bygger terrängen** | **13.31** |
| bygger horisonten | 0.02 |
| lägger fairways och greener | 0.82 |
| fyller vattnet | 0.88 |
| **planterar skogen** | **8.46** |
| sätter ut flaggor | 0.04 |
| ställer ljuset | 1.15 |
| ritar första vyn | 0.02 |

## Three separate problems, and only one of them is compute

### 1. The course is streamed at the wrong granularity

It already streams — that is what the ring quadtree is. It streams **988 files
to open one course**. On localhost a request is nearly free, which is exactly
why this had to be measured rather than felt: on a phone each one is a round
trip, and on GitHub Pages there is no HTTP/3 to pipeline them over a lossy link
(see `docs/` on hosting, and note 37.58 MB per open against GitHub's 100 GB/month
soft limit — about **2 700 course opens a month**).

### 2. Nothing renders until 100 % of the world is built

`renderer.setAnimationLoop` is not called until every stage above has finished
*and* `await terrainV2.settle(60_000)` has confirmed the whole first frontier is
resident. The profiler shows the first frame beginning at **33.4 s**. There is a
progress bar, and it is the only thing the visitor sees.

That means 210 079 trees, 365 466 vista cones, three impostor atlases (1.89 s)
and the PMREM environment (1.85 s) are all built *before the first pixel*. None
of them is needed to answer "has the course opened".

### 3. Work at boot that is a pure function of already-published bytes

The runtime log is explicit:

```
v2 world: 213 ring tiles read for the model in 1929 ms
v2 water levels re-measured: vatten 66.98->66.69, ... (13 lakes)
v2 flat water: 26 flats over 0.48 ha, 24 beyond the model's rings, 472 ms
v2 water beds: 811.4 ha carved to 3.5 m, 995543 samples in 107 ring tiles, 598 ms
```

**213 tile reads to produce 13 numbers.** Every one of those inputs is a
content-addressed, immutable published chunk, so every one of those outputs is
deterministic and could have been computed once, at publish time, by the
publisher that already owns those tiles. This repo bakes everything else at
build time and gates it with a checksum; the v2 runtime is the place where that
rule stopped being followed.

## The fixes, in impact order

### A. Bake what is a pure function of published bytes
Water levels, flat-water components, and the bed-carve field are derived from
tiles whose sha256 is already in the ground manifest. Compute them in
`publish-ground-rings` / the vegetation publisher, ship them as a small record
beside the manifest, and verify at load the way every other artifact is verified.
**Removes most of the 213-tile model read and ~3 s of boot**, and removes the
reason to touch those tiles before rendering at all.
*Effort: medium. Risk: low — it is a build-time move of existing deterministic code, and a gate can assert the baked values equal the runtime ones.*

### B. One first-light bundle instead of ~200 chunk requests
Precompute, per ground, a single file holding exactly the tiles the opening view
needs: the coarse ring levels plus the played surfaces. One request instead of
hundreds; the fine chunks keep streaming behind it as the camera moves. The
chunks are content-addressed, so the bundle is a concatenation plus an index and
the runtime still verifies each chunk's hash — no trust is given up.
**This is the real answer to "can we stream from a server".** It is a
build-pipeline change, not a server.
*Effort: medium-high. Risk: low — additive; the per-chunk path stays as the fallback.*

### C. Render before the world is finished
Split the straight line. First frame after: renderer + the coarse terrain
frontier + played surfaces + water. Everything else after the loop is running,
in yielded slices — the forest (8.46 s), the vista cones (2.38 s), the impostor
atlases (1.89 s), ground cover (1.12 s), reeds (0.91 s), and the PMREM upgrade.
`shouldYieldWork` / `yieldWork` already exist in main.js for exactly this.
Also: stop awaiting `terrainV2.settle(60_000)` before the first frame — settle
is what the *stream* is for.
**Perceived open time falls from 33 s to roughly the terrain stage alone.**
*Effort: medium. Risk: medium — boot ordering is load-bearing, and the golden views must be re-approved once, because they will legitimately differ during the fill-in.*

### D. Boot the fast ground, upgrade behind the frame
GPK1 opens the same course in 1.70 MB and 33 requests. Render that first, then
bring the 1 m ground up behind the running frame and hand over. The app already
carries both paths and a *spatial* edge blend (`v2-terrain-transition.mjs`); what
does not exist is the *temporal* handover.
**Opens in single-digit seconds on every course, and the 1 m ground becomes an
upgrade the visitor watches arrive rather than a gate they wait behind.**
*Effort: high. Risk: medium — two ground sources live at once. Do it after C, which makes it much easier.*

### E. The host
Cloudflare gives HTTP/3 — which matters far more at 1 043 requests than at 33 —
Brotli (measured: 228 KB, 22.5 % off the shell), and `_headers` actually being
honoured so `immutable` applies. With a Worker, range requests into one bundle
replace the 9 550 published chunk files entirely. **Note Cloudflare Pages' free
tier caps at 20 000 files and the repo publishes 9 973 today.**

### F. Make the budget a gate
`tools/boot-requests.mjs` exists now. A course open should fail CI above a
declared request and byte budget, the way the card and the pack are gated.
1 043 requests should never have shipped silently, and only a gate stops the
next one.

## What "streaming from a server" would and would not buy

It would not fix this on its own, because the app already streams. What a server
adds is **fewer, larger, smarter responses** — a bundle, range requests, HTTP/3,
and edge caching that actually honours `immutable`. The compute problems (B, C,
D) are in the client's boot ordering and would survive any host change.

The one thing a server genuinely unlocks that nothing else does: serving the
first-light bundle *composed per request* for the camera's actual starting
position, rather than a fixed per-ground bundle. That is a real option, and it
is not where I would start.

## The order I would do it in

1. **F** — the gate, first, so every later step is measured. Half a day.
2. **A** — bake the deterministic water work. Removes ~3 s and most of the model read.
3. **C** — render early. The biggest perceived win, and it needs no new data format.
4. **B** — the first-light bundle. The biggest real win on a phone.
5. **E** — move hosts, with the file-count caveat.
6. **D** — the GPK1-first handover, only if 1–5 leave it short.

Steps 1–3 need no change to any published artifact, no re-publish and no
re-migration, which is why they come first.
