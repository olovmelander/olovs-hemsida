# Prepared startup on the RTX 3070

Status: 24 desktop starts completed on the RTX 3070: 12 literal-query and 12
independently controlled vista/scatter starts. All world fingerprints match.

The comparison uses the PR #89 application build, WebGPU on the NVIDIA adapter,
high quality, golden lighting, 1920 × 1080 at DPR 1, charger connected and
`qualitylock=1` without `det=1`. CPU and network are unthrottled on localhost.
Each run launches a fresh Chrome process/context, blocks service workers and
disables the HTTP cache; OS file and driver caches persist across runs.

Four labels describe the intended prepared-construction conditions:

| Variant | Vista preparation | Scatter preparation | Query |
|---|---|---|---|
| before | off | off | `prepvista=0&prepscatter=0` |
| after | on | on | default |
| vista | on | off | `prepscatter=0` |
| scatter | off | on | `prepvista=0` |

**Merged-control coupling:** PR #89's `preparedTintAllowed` does not whitelist
either preparation switch. Vista delegates to it; scatter additionally delegates
to vista's own enable check. Consequently either disable switch also disables
prepared tint/water and the other forest preparation. The literal-query arm
records this existing behavior; the table describes isolated conditions only
for the `--control assets` arm below. Do not attribute the whole literal-URL
startup delta to one forest loop.

The isolated arm keeps the normal URL unchanged and aborts only the requested
vista/scatter binary fetches. Fresh contexts prevent an old cached asset from
escaping that control. The ordinary verified loader falls back to procedural
construction; tint/water remain eligible. Every blocked URL and actual prepared
state is recorded, and the same exact world-fingerprint assertion applies.

The order is before, after, vista, scatter, scatter, vista, after, before,
before, after, vista, scatter: three fresh starts per condition, with the
middle block reversed. The tool saves every startup mark/span, first-frame
timestamp, ready marker, browser wall time, adapter, transfer count and exact
world fingerprint. Every fingerprint must equal the first run's. Hardware
timing is accepted only when the idle and competing-browser guards pass.

## Literal-query results

RTX 3070 Laptop, driver 572.47, Chrome 153.0.8010.53; three runs per URL.
The merged default enables tint, water, vista and all three scatter sections.
All three disabled-query forms actually disable all of them. Every completed
run has the same exact world fingerprint: 155,342 trees, 378,417 vista trees,
2,962 reeds and 16,010 ground-cover tufts.

| URL suffix | Pre-first-frame marker, median (range), s | First scene submitted, s | First scene GPU ready, s | Ready marker, s |
|---|---:|---:|---:|---:|
| `prepvista=0&prepscatter=0` | 15.22 (15.19–15.26) | 15.98 | 16.99 | 17.00 |
| none (merged default) | 12.10 (11.97–12.24) | 12.88 | 13.86 | 13.87 |
| `prepscatter=0` | 15.24 (15.24–15.37) | 16.04 | 17.03 | 17.04 |
| `prepvista=0` | 15.74 (15.16–16.18) | 16.51 | 17.53 | 17.54 |

Times in this table are elapsed from engine start (`V3D.perf()`); `totalMs`
is set before the first frame, so it is not a presented-frame timestamp.
From navigation, the median ready marker is 17.14 → 14.03 s for the combined
disabled URL versus default. The combined-query saving is 3.12 s at the
pre-first-frame marker, but it includes prepared tint and water and cannot
be assigned to vista/scatter alone. OS file caches and driver caches remain
warm across fresh-browser runs; this does not represent a cold OS boot.

[Raw literal-query results](graphics/performance-startup-rtx3070-2026-09-23/literal.json)
include all timestamps, spans, transfers, prepared-state flags and fingerprints.

## Independently controlled preparation

All 12 runs kept the normal URL, prepared tint and prepared water. The recorded
vista flag and scatter sections matched the intended conditions in every run;
only the selected binary downloads were blocked. Medians of three runs:

| Prepared forest data | Pre-first-frame marker, median (range), s | First scene submitted, s | First scene GPU ready, s | Ready marker, s |
|---|---:|---:|---:|---:|
| Neither | 13.67 (13.03–13.77) | 14.43 | 15.48 | 15.49 |
| Both | 12.11 (12.02–12.25) | 12.91 | 13.89 | 13.90 |
| Vista only | 12.77 (12.57–12.92) | 13.54 | 14.53 | 14.53 |
| Scatter only | 12.67 (12.44–12.74) | 13.44 | 14.44 | 14.45 |

The isolated combined change is 1.55 s at the pre-first-frame marker and
1.59 s at the ready marker. The measured construction loops explain about
1.11 s; the total marker also varies with the other startup stages, downloads
and compilation, so do not treat their difference as extra forest work saved.
Three starts per condition establish observed ranges, not a precise confidence
interval or cold-driver performance.

| Construction span | Neither prepared, median ms | Both prepared, median ms |
|---|---:|---:|
| Far vista cones | 825.1 | 275.7 |
| Reed lattice | 185.1 | 3.0 |
| Ground-cover lattice | 349.7 | 22.9 |
| Ground-cover edge tufts | 69.8 | 19.6 |

These are actual replay savings with the same planting, not estimates from a
software GPU. The `vista only` and `scatter only` arms reproduce the corresponding
fast loops independently. [Raw isolated results](graphics/performance-startup-rtx3070-2026-09-23/isolated.json)
retain the individual blocked URLs and every observed prepared-state flag.

```powershell
$env:BANVY_GPU='1'
node tools/startup-ab.mjs --base http://127.0.0.1:8648 --course veckefjarden --out tools/reference/rtx3070/startup
node tools/startup-ab.mjs --base http://127.0.0.1:8648 --course veckefjarden --control assets --out tools/reference/rtx3070/startup-isolated
```

Serve the same production build throughout. Do not run this alongside another
benchmark, browser session, bake or CPU test suite. Report medians and individual
run ranges, and distinguish first scene submission/GPU readiness from the
later ready marker. Runtime spans attribute the vista/reeds/cover/edge savings;
wall-time changes alone are insufficient to assign them to one prepared loop.

The separate expected-results PR uses these matched measurements. Actual phone,
throttled-network and cached-reopen measurements remain separate work.
