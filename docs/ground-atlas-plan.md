# The ground plan — one terrain, classified per fragment

> **Status 2026-08-29:** G1–G6 are LIVE and atlas is the app's default ground
> path (`?ground=mesh` is the escape hatch); all six courses pass check-app
> through it, on both backends. Executed faster than the phase ladder planned —
> the overlay skip landed in one sweep — so the remaining discipline debt is
> G0/G4's per-course HUMAN approval of the golden matrix (`tools/goldens.mjs`
> captures it, gitignored). G7 (delete the mesh path) waits on that approval;
> G8 (appearance tuning) after. Field notes from the bring-up — the WebGPU
> 8-vertex-buffer limit, coordinates-not-phases in filtered rasters, sand over
> green, the SDF replaying the vertex ramps — live in CLAUDE.md under
> "The ground atlas — live, and what it cost to light up".

Fairways, greens, tees, sand, paths and parking currently render as overlay
meshes laid centimetres above the terrain, held apart by five polygonOffset
tiers, renderOrder 1–8, `meshH` conservative 9-tap sampling and a 6 cm rim
seal. Each layer exists because the previous one wasn't enough, and none of it
can be fully stable across slopes, distance, WebGPU/WebGL2 and phone depth
buffers. The durable fix: ground *material* becomes a per-fragment
classification of the one terrain mesh; only things with real height stay
geometry.

**The acceptance criterion, stated once:** with `?ground=atlas` and every
migrated overlay mesh disabled, the complete course appearance comes from the
terrain material alone, and it is approved against golden screenshots on all
six courses.

## Decisions taken up front (the why is in the phase notes)

1. **The atlas is built at boot, from the pack's existing rings.** No new pack
   stream, fmt:1 untouched, no six-course regeneration, and the atlas can never
   disagree with lie detection or tree exclusion because they share one source.
   A precomputed stream is reconsidered only if boot cost measures over ~300 ms
   on a phone-class device.
2. **Edges are encoded as signed distance, not coverage.** A 1 m ID+coverage
   texel chews the bunker cut (a deliberate ~0.7 m edge) and the chaikin-smooth
   mown lines. SDF interpolation reconstructs crisp antialiased edges well
   below texel size, so one 1 m atlas suffices — no 0.5 m memory bill.
3. **The atlas covers CORE only.** MIDR/FARR keep the plain turf material. The
   E4, railway ballast and every embankment road stay ribbons: per-fragment
   material fixes a path's *width*, but a 4 m grid still cannot hold a road's
   *grade* — the recorded cart-path lesson applies to geometry after the
   material problem is solved.
4. **Procedural classes stay in the shader.** Rough/fescue/heath blends, steep
   till, rock breakthrough, forest floor are fbm-and-slope computations
   (`groundAt`), not polygon truth. Baking them at 1 m loses their
   resolution-independence. The atlas carries polygon-derived classes only;
   the procedural base gets *better* at fragment rate.
5. **`classify()` is the registry.** It already drives colour, tree exclusion
   and the kik lie readout. It gets extracted and formalized, not replaced by
   a parallel system.
6. **Strict pixel parity dies by design, so its successor is built first.**
   Approved golden screenshots per course on the 12-view matrix become the
   gate; the runtime flag keeps both paths A/B-able in one build throughout.
7. **What stays as it is:** water (surface over carved bed), bridges, curbs,
   retaining walls, the greengrid yardage overlay (a transient depth-biased
   overlay is fine), NVGK/Veckefjärden bespoke scenery, and every terrainH
   carve already in place (green pads, tee pads, bunker dishes).

## Phase G0 — goldens and the A/B harness

*Nothing renders differently in this phase.*

- `?ground=mesh|atlas` runtime flag beside `?det=1` (same pattern: read once at
  boot, no special build). Default `mesh` until G7.
- `tools/goldens.mjs`: capture the 12-view matrix (`shot.mjs --seq`, det
  pinned) per course into `tools/goldens/<slug>/`; `tools/parity.mjs` grows a
  perceptual mode (mean/percentile channel tolerance) alongside the strict one.
  Strict stays the gate for anything not being migrated.
- Containment, optional and separate: `reversedDepthBuffer` may go in **only
  after verifying** (a) three 0.185 supports it on both backends, (b) the
  WebGL2 fallback has `EXT_clip_control` on the devices that matter, (c)
  polygonOffset tier signs still separate under reversed z. Do NOT remove the
  6 cm rim seal or the conservative sampling — the seal is a grazing-gap fix
  (same lesson as the LoD skirts), and both are deleted for free in G7.

Gate: goldens exist for all six courses; strict parity of the flag-off path
against them is clean.

## Phase G1 — the surface registry

- Extract to `src/engine/surface.js`: the `SURFACE.*` id table (ROUGH, SEMI,
  FAIRWAY, FRINGE, GREEN, TEE, SAND, PATH, ASPHALT, GRAVEL, DIRT, ROCK, MUD,
  WETLAND, …), an explicit overlap-priority table, and `classify(x,z)` moved
  verbatim with its spatial indexes injected. Every current consumer —
  `groundAt`, the planter's exclusions, `kikMeasure`'s lie, `wetAt` — imports
  it. `shadeFair`/`shadeGreen` remain thin per-hole decorators over it.
- Vitest locks current behaviour numerically: priority resolution where
  classes overlap, the bunker cut edge width, the fringe/fairway band falloffs,
  a fixed set of probe points per course sampled from the committed packs.

Gate: strict pixel parity on all six courses (this phase moves code, not
pixels), tests green.

## Phase G2 — the atlas

Built at boot, CORE-aligned (CORE is 4 m-gridded, playB+150 m; ~2.5×2 km on the
largest course → ~2500×2000 texels at 1 m).

- **Two textures, because ids and fields need different filtering:**
  - `ATLAS_ID` (RG8, **nearest**): primary surface id, secondary surface id.
    Ids must never interpolate.
  - `ATLAS_F` (RGBA8, **linear**): signed distance to the primary/secondary
    boundary quantized over ±8 m; mow coordinate (distance along the owning
    hole line, the field `aMow` carries today — smooth, interpolates fine);
    owning-hole/feature index; one spare channel.
- **Rasterization:** fill rings per class into offscreen canvases in priority
  order (fast), then a two-pass chamfer distance transform on typed arrays for
  the SDF (milliseconds at this size). Pure functions live beside the codec in
  `src/engine/`, unit-testable in node against synthetic rings.
- **Gate — the probe harness, not eyeballs:** for every course, (a) primary
  class at all check-app probe points and N random CORE points equals
  `classify()`'s primary; (b) reconstructed edge positions on transects across
  a green edge, a fringe band and a bunker cut land within 0.25 m of the
  analytic `ringSD` zero. This runs in vitest, headless, before any shader
  exists.

## Phase G3 — the ground material

- `makeGround()` extends `makeTurf()` (same file, same TSL idioms): inside
  atlas bounds, sample `ATLAS_ID`/`ATLAS_F` at `positionWorld.xz`, smoothstep
  the SDF over its own `fwidth` for the primary↔secondary blend, and drive
  what the four vertex channels drive today — detail scale, bump, gloss, mow
  anisotropy — from the `SHADE` table indexed by id (uniform arrays / select
  chains, branchless). Sand and hard surfaces reuse the existing `DETAIL` and
  `SANDN` taps from `makeSand`/`makeAsphalt`; palette `C` unchanged. Outside
  bounds (and on MIDR/FARR) the node graph falls back to the current vertex
  path, so one material serves all three terrain levels.
- **AO moves to its own channel.** Overlays bake `col × horizonAO` into vertex
  colour today; the atlas path needs AO separately so class colour can be
  multiplied by it per fragment. `buildTerrain` writes a new `aAO` float
  attribute (horizon AO is low-frequency; 4 m vertices hold it fine) and the
  vertex-colour path keeps working unchanged.
- Mow bands, band anti-aliasing (`fwidth` fade), sheen, SSS: reused verbatim —
  they are already per-pixel and already correct; only the *inputs* change
  from vertex channels to atlas-decoded values.

Gate: `?ground=atlas` with overlays still present renders without artifacts
(the atlas classes underdraw the overlays, so this is visually near-identical);
frame time measured on both backends and on SwiftShader against the mesh path.

## Phase G4 — slice 1: mown surfaces

Flag on skips `surfaceMesh()` for fairway/semi/fringe/green/tee (and the
scenery greens/range turf).

- Bring-up on **NVGK hole 1**; then **Veckefjärden immediately second**, not
  last — it is the OLD-format course with the most course-specific ground
  truth, and it is the course that already proved a shared engine silently
  drops local truth. Then the remaining four.
- Per-course approval by eye against the mesh-path goldens (perceptual diff to
  focus the eye, human sign-off to accept); the approved atlas renders become
  the new goldens for that course. Named views that must be inspected:
  Veckefjärden's island 14th (the phone-photo hole), a green edge at grazing
  angle, a fairway at 300 m.
- `tools/check-app.mjs` grows: boot every course with `?ground=atlas`,
  luminance floor, and a readPixels hue-class probe at green/fairway/rough
  sample points.

## Phase G5 — sand

Bunker dishes are already carved in `terrainH`; the atlas supplies the sand
class and the rake normal per fragment. The entire crease problem —
conservative 9-tap sampling, green gashes through lips — ceases to exist
because there is no overlay to poke through. This is the phase where the SDF
encoding earns its keep: the cut edge must read as cut. Same per-course
approval loop.

## Phase G6 — paths, parking, gravel (inside CORE)

Cart paths and tracks rasterize from their polylines with width (they are in
`classify`'s path index already); parking aprons and gravel from their rings.
Ground-level only: any ribbon that grades, crowns or embanks (the E4, the
railway, bridge approaches) is out of scope permanently, per decision 3.
Painted road markings stay with their ribbons.

## Phase G7 — teardown and default flip

- Per migrated class: stop building its `surfaceMesh`. When the last one goes:
  delete `nudged()`'s overlay tiers, `chaikin`/`subdivide`/`triangulate`
  overlay machinery, `meshH`'s conservative sampling and the rim seal —
  all made dead by G4–G6, none touched before this.
- Default flips to atlas; `?ground=mesh` survives exactly one release as the
  escape hatch, then the mesh path is deleted (a permanent dual path is two
  engines, which is how the Veckefjärden forest bug happened).
- Goldens re-frozen on the atlas renders; CLAUDE.md's overlay lore rewritten
  to describe the atlas; the greengrid keeps its depth-biased overlay.

## Phase G8 — appearance tuning (only now)

With depth artifacts gone, the remaining "scattered" look is authored noise,
tuned per class in one place (`SHADE` + the makeGround taps): calmer fairway
macro variation with mow direction dominant; rough varied but broader and
slower; bump fading with distance (already in place — retune, don't add);
sand/gravel/dirt/rock getting distinct roughness and normal behaviour. Every
tuning change re-gates against the goldens with the perceptual diff, so tuning
cannot smuggle in a regression.

## Risks, named

| risk | mitigation | measured by |
|---|---|---|
| edge quality at 1 m texels | SDF encoding; nearest-filtered ids | G2 transect probe (±0.25 m), 14th-green golden |
| mobile GPU memory (~15 MB for both textures at 2500×2000) | one course loaded at a time; RG8+RGBA8, no mips on ID | boot telemetry on a phone |
| shader cost of per-fragment select | branchless mix chains; SHADE as uniform arrays | frame-time gate in G3 on both backends |
| boot cost of rasterization | canvas fills + chamfer are ms-scale; do it during the existing boot ticks | boot timing, 300 ms budget |
| the two paths diverging during migration | one flag, one build, A/B goldens every phase | check-app runs both paths until G7 |
| reversed-z breaking the un-migrated tiers | it's optional containment, gated on backend verification | G0 checklist |

## Order of work, restated as one line each

G0 goldens+flag → G1 registry extraction (no pixels move) → G2 atlas+probe
gate (no shader yet) → G3 material (overlays still on) → G4 mown surfaces,
NVGK 1 then Veckefjärden then all → G5 sand → G6 paths/parking → G7 delete the
old world → G8 tune. Each phase lands independently, gates before the next,
and never deletes what a later phase still stands on.
