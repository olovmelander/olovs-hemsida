# Eight light and atmosphere modes

The eight modes share the same atmospheric sky in Målad and realistic. Each
mode now controls its cloud field, sun, indirect light, reflected colours,
haze, exposure and bloom together. This follows the [r186 upgrade
validation](three-r186-upgrade-status.md) and [shared sky](shared-atmospheric-sky.md)
work. Nothing has been merged to main.

## Visual direction

| Mode | Intended feeling | Main changes |
|---|---|---|
| Kväll | Warm honey light and long shadows | Softer glare, warm horizon, cooler shadow fill and restrained bloom. |
| Dag | Clear Swedish summer daylight | Bright terrain, pale blue sky, white clouds with visible shading and little bloom. |
| Gryning | Pearl and rose over morning haze | Pink cloud light, lavender distance, soft sunlight and gentle contrast. |
| Midnattssol | Luminous northern summer dusk | Preserve the accepted low sun and native sky; increase indirect and reflected light on the course. |
| Blå timmen | Cobalt and lavender after sunset | Sun below the horizon, soft blue fill and a continuous twilight lift that preserves cloud shapes. |
| Oväder | A heavy weather front | Dense low cloud, slate colours, greatly reduced direct sun, cool haze and very little bloom. |
| Dis | Still, luminous mist | Diffuse silver light, slow broad clouds and layered distance with visible wooded ridges. |
| Höst | Amber light and cool autumn air | Golden deciduous foliage, warm reflections, cooler distance and a fuller cloud field. |

Målad retains its painted vegetation, terrain and colour treatment. Its grade
is gentler in twilight and bad weather to keep shadowed ground readable.
The grade excludes the sky using the scene depth on both renderer backends.

## White distant mountains

The original exponential fog approached 100% opacity. Pale fog colours then
replaced the shaded slopes and trees, making distant ridges look white against
a darker sky. Dawn and mist showed this particularly clearly at Veckefjärden
hole 13.

The fog now retains 10–22% of the landscape's shaded colour at maximum haze.
Dawn, daylight, mist and autumn have revised haze colours; dawn and mist also
have gentler distance falloff. This is an artistic transmittance floor for
readable scenery, rather than a simulation of opaque real fog. It preserves
wooded relief and distance layers without removing the weather.

The fog node uses Three's own depth accessor and render-group references,
matching native scene fog. The latter is important when updating a fog shared
by many different materials: ordinary object uniforms left some distant lines
and buildings with inconsistent fog during review. The sky stays fog-free and blends into the
shared horizon haze only near and below the geometric horizon.

## Implementation and Three r186

- `engine/atmosphere-presets.mjs` is the source of all eight authored modes.
- `engine/atmospheric-sky.mjs` retains the native SkyMesh atmosphere and clouds:
  coverage, density, scale, apparent elevation and drift vary by mode. Native
  cloud self-shading and sun-facing bright edges are retained.
- HDR sky radiance is adjusted before tone mapping and bloom. Twilight uses
  a continuous shadow lift, rather than clamping clouds to a flat colour.
- `engine/aerial-perspective.mjs` supplies one reusable TSL fog graph.
- Environment palettes and intensities vary with the mode; the existing two
  reflection maps and shader connections are reused. Water reflects the same
  authored environment palette.
- Preset changes update uniforms rather than replacing the sky, materials or
  node graphs. There is no extra full-screen atmosphere pass or cloud texture.
- The existing reversed-depth far-plane correction remains. `det=1` freezes
  cloud animation for comparison; normal play retains cloud movement.

Sources: [Three SkyMesh](https://threejs.org/docs/pages/SkyMesh.html),
[Three shading language, including fog](https://threejs.org/docs/pages/TSL.html),
[r186 release](https://github.com/mrdoob/three.js/releases/tag/r186).

## Validation

The rendered review uses the actual application on Chrome 152 and the NVIDIA
RTX 3070 Laptop. Captures use fixed cameras, sun state, quality and a frozen
cloud clock; UI overlays are hidden. The previous shared-sky build is kept
separately for the eight-mode comparison, and the build before the fog fix is
kept separately for the hole 13 review.

`tools/check-shared-sky.mjs --audit` checks both styles, all selected presets,
visible course geometry, sky shading, cloud contribution, renderer/depth state,
browser errors and reflection-map reuse. It compares the styles' sky pixels
and checks the relative brightness and colour goals for storm, mist, blue
hour and midnight sun. The preserved midnight sky is nearly clear opposite
the low sun, so the cloud probe also checks its lit hemisphere.

The [visual gallery](graphics/eight-atmospheres-2026-09-13/index.html) compares
all eight modes in both styles and includes the hole 13 fog correction.
The [machine-readable results](graphics/eight-atmospheres-2026-09-13/summary.json)
record every renderer, mode, camera and gate.

| Final rendering run | Checks passed |
|---|---:|
| Desktop WebGPU, both styles, eight modes and previous-build comparison | 118 |
| Desktop WebGL2, both styles, eight modes | 96 |
| Hole 13 fog comparison, both styles plus previous Målad build | 32 |
| Mobile viewport, low quality WebGL2, both styles, eight modes | 96 |
| Ordinary-depth WebGPU, both styles, six representative modes | 67 |
| Puttom automatic LOD, four forced tree tiers, terrain and camera changes | 18 |
| **Total** | **427** |

The mobile run uses a 390 × 844 touch viewport at DPR 2 on this desktop GPU;
it verifies the phone rendering path, not a physical phone's performance.

Measured changes, using the same camera on each side:

| Observation | Before | After |
|---|---:|---:|
| Midnight-sun ground mean, realistic, hole 1 | 26.4/255 | 52.4/255 |
| Storm sky mean | 202.6/255 | 104.7/255 |
| Storm sky near-white area (mean RGB ≥248) | 24.9% | 0% |
| Dawn distant ridge mean, Målad, hole 13 | 192.9/255 | 140.0/255 |
| Mist distant ridge mean, Målad, hole 13 | 213.3/255 | 185.2/255 |

The sky means compare the previous shared-sky build with the new modes. The
ridge means isolate the subsequent fog correction, in a fixed region across
the bay; they are not whole-image exposure measurements. All eight sky-only
views match exactly between Målad and realistic on desktop WebGPU and WebGL2.
The native clouds measurably contribute to every mode, including the lit
hemisphere of the preserved midnight sky. Mode switching allocates at most
two reflection maps. No renderer/browser errors occur in the accepted runs.

The full Vitest suite passes **1,037 tests in 135 files**, with two workers and
a 30-second test deadline while browser checks run. The 49 focused atmosphere,
fog, environment, water, look and camera tests also pass. Application lint and
the production build pass.

These checks establish rendering behaviour and provide images for aesthetic
review; they do not establish subjective perfection or device FPS.
