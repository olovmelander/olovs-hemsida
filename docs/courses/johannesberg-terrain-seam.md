# Johannesberg terrain seam — 2026-09-09

The rotated edge of the 2,048 m detailed terrain window had triangular holes.
The old join removed each entire legacy triangle whose centre was inside the
window, including the part of a crossing triangle outside it. A vertical skirt
could not cover those missing horizontal wedges. Different ground materials
also drew a dark square at the same boundary.

The join now subtracts the exact rectangle in its own grid coordinates and
retains the exterior pieces. New boundary vertices follow the measured one-metre
edge samples. Material attributes, shared vertex buffers and triangle winding
are preserved. A corner regression test ensures triangulation retains the
intermediate edge samples when a triangle crosses two rectangle sides.

For Johannesberg, the legacy surroundings approach the measured boundary over
72 m, and both sides use the same ground material and tint. This changes the
display transition outside the measured window; no source terrain chunks,
orthophoto traces, course geometry or coordinate frame were changed.

The browser harness reads the actual rendered CORE/MID triangle indices, rather
than relying on a height lookup that can succeed over a missing triangle.

| Check | Before | After |
| --- | ---: | ---: |
| Missing coverage at 20,580 exterior samples | 3,603 | 0 |
| Boundary-height samples with a real mesh edge | Not measured | 4,096 / 4,096 |
| Maximum boundary-height difference | Not measured | Less than 0.1 mm |
| Views captured | 16 | 16 |

Height comparison interpolates actual boundary segments and allows 0.2 mm for
Float32 coordinate rounding. This is a rendering-continuity measurement, not
survey accuracy. Coverage sampling is complemented by unit tests for exterior
area conservation, winding, corners and interior removal.

The 27 focused clipping, transition, cutout and live-adapter tests pass, as do
the harness self-tests, production build and published-asset build checks.
Default v2 and explicit legacy browser checks pass for Johannesberg and for
Ribbingsfors, which exercises the shared clipping code with an unrotated frame.
Local screenshots and detailed JSON/geometry evidence are in the ignored
`johannesbergbuild/cache/terrain-seam-before/` and `terrain-seam-final/` directories.

```powershell
npx vitest run apps/golf/src/engine/v2-legacy-clip.test.mjs apps/golf/src/engine/v2-terrain-transition.test.mjs apps/golf/src/engine/v2-legacy-cutout.test.mjs apps/golf/src/engine/v2-terrain-live-adapter.test.mjs
node tools/check-terrain-seam.mjs --self-test
npm --prefix apps/golf run build
node packages/course-v2/check-app-build.mjs
# Serve apps/golf/dist on 8647 before the browser checks.
$env:BANVY_GPU = '1'
node tools/check-terrain-seam.mjs http://127.0.0.1:8647 --out johannesbergbuild/cache/terrain-seam-final
node tools/check-course-v2.mjs http://127.0.0.1:8647 --course johannesberg
node tools/check-course-v2.mjs http://127.0.0.1:8647 --course ribbingsfors
```
