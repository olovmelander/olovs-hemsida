# Prepared startup on the RTX 3070

Status: interleaved desktop harness prepared; accepted hardware results pending
exclusive GPU access. No SwiftShader number is presented as desktop startup.

The comparison uses the PR #89 application build, WebGPU on the NVIDIA adapter,
high quality, golden lighting, 1920 × 1080 at DPR 1, charger connected and
`qualitylock=1` without `det=1`. CPU and network are unthrottled on localhost.
Each run launches a fresh Chrome process/context, blocks service workers and
disables the HTTP cache; OS file and driver caches persist across runs.

Four variants separate the two prepared-construction changes:

| Variant | Vista preparation | Scatter preparation | Query |
|---|---|---|---|
| before | off | off | `prepvista=0&prepscatter=0` |
| after | on | on | default |
| vista | on | off | `prepscatter=0` |
| scatter | off | on | `prepvista=0` |

The order is before, after, vista, scatter, scatter, vista, after, before,
before, after, vista, scatter: three fresh starts per condition, with the
middle block reversed. The tool saves every startup mark/span, first-frame
timestamp, ready marker, browser wall time, adapter, transfer count and exact
world fingerprint. Every fingerprint must equal the first run's. Hardware
timing remains pending until the idle and competing-browser guards pass.

```powershell
$env:BANVY_GPU='1'
node tools/startup-ab.mjs --base http://127.0.0.1:8648 --course veckefjarden --out tools/reference/rtx3070/startup
```

Serve the same production build throughout. Do not run this alongside another
benchmark, browser session, bake or CPU test suite. Report medians and individual
run ranges, and distinguish first scene submission/GPU readiness from the
later ready marker. Runtime spans attribute the vista/reeds/cover/edge savings;
wall-time changes alone are insufficient to assign them to one prepared loop.

The separate expected-results PR will use the completed startup evidence.
