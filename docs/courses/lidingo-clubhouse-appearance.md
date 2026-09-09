# Lidingö clubhouse appearance

The measured-roof branch previously bypassed all clubhouse details, leaving
the complex as grey walls and dark roof triangles. The Lidingö scenery module
now adds a facade interpretation from public exterior photographs.

## References

Reviewed 2026-09-09:

- [Lidingö GK's July 2024 Vikingaskeppet report](https://www.lidingogk.se/nyheter/vikingaskeppet-6-7-juli/): courtyard overview, paired blue awnings, white restaurant facade and lower pavilion.
- [Club photo gallery](https://www.lidingogk.se/banan/bildgalleri/): white veranda, dark window frames and the relationship between the two buildings.
- [Lidingö Golfrestaurang exterior photographs](https://venuu.se/lokaler/lidingo-golfrestaurang): reception glazing, balcony apron, thin dark rail, white supports and facade clock.

No photograph pixels are bundled with the app. No private orthophoto crops,
decryption keys, credentials or new private-image observations are included.

## Rendered interpretation

| Source footprint | Appearance |
| --- | --- |
| `way/32262183` | Warm white restaurant/reception, dark roof, inset two-storey courtyard facade, paired blue awnings, framed glazing, white panelled balcony, rail, supports and clock |
| `way/32262176` | White lower courtyard pavilion, charcoal roof, glazed north/east elevations, white veranda posts and rail |
| `way/32262169` | Matching white south wing, charcoal roof and framed windows |

Window spacing, facade depth, awning dimensions and balcony/clock placement are
visual estimates. The south wing's glazing pattern is a stylistic continuation;
the references do not establish every elevation. These details do not establish
survey accuracy, exact current use, or current mapping completeness.

The restaurant's source outline includes low front surfaces at about
33.50–33.69 m RH2000. They must not be treated as its upper-storey eave.
The facade is inset 4.2 m from the outer courtyard line, beneath retained higher
roof support. Its estimated balcony deck uses 33.55 m RH2000. The paired awnings
stop before the eastern stepped roof triangles to avoid intersecting that mesh.
The window/facade builder samples actual retained triangles; absent roof support
does not become a new roof or filled interior wall perimeter.

All five source roof TINs, their 7,069 rendered triangles, original footprints,
unsupported regions, terrain, exclusion polygons and data checksums are retained.
The appearance does not smooth or replace the dated laser roof. The existing
roof reconstruction remains visibly uneven in places, especially around the
restaurant's eastern roof step and rooftop structures. A full architectural
replica still needs a separate roof review and better elevation references.

## Cost and validation

The three buildings add 2,748 triangles (454 + 904 + 1,390) to the existing static
building batch. There are no added draw calls, textures, remote downloads,
transparent materials or per-frame facade updates. `V3D.stats.clubhouseDetails`
reports each building's emitted parts and triangle count.

Validation for this change:

- Full Vitest run: 543 tests passed; targeted facade/roof tests also cover source preservation, unsupported roof handling, finite/nondegenerate geometry, the three-ID scope and a 3,000-triangle budget.
- Production Vite/PWA build passed.
- Lidingö mapping audit and all course source-manifest checks passed.
- Offline depth-buffered geometry renders inspected from the courtyard and overview cameras. These use the actual emitted triangles and retained 4 m compatibility terrain, with neutral ground and simple lighting; they are not app screenshots or 1 m runtime-terrain validation.
- Live WebGL/WebGPU and phone visual review remains pending: local Chromium could not start in this environment and the supported cloud browser blocked the loopback preview URL.

For the in-app review, load Lidingö in daylight, inspect the clubhouse from the
courtyard and an elevated southeast view, and check window/terrain contact on
the 1 m terrain. Confirm the facade parts in `V3D.stats.clubhouseDetails`; the
existing roof and source-data gates must still pass. Do not mark this as exact
architectural reproduction based only on the automated checks.
