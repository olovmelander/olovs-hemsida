# Lidingö out-of-bounds placement — 9 September 2026

Six visible asphalt-edge segments, totalling about 503 m, are now traced from
Lantmäteriet's 31 May 2025 orthophotos at their native 0.16 m pixel spacing.
They are shown as dashed **OB (karta)** annotations on the course minimap.
Each segment carries a club rule reference, source image checksum, source pixel
coordinates, EPSG:3006 coordinates and estimated interpretation uncertainty.
The annotation does not imply painted lines or a row of physical stakes.

The [club's current rules, approved 16 March 2026](https://www.lidingogk.se/media/tl1nt1n3/lidingoe-gk-lokala-regler-2026-03-16.pdf),
identify the paved roads forming OB at the holes below. They also identify white
stakes, plates and lines as boundary markers. The road edges were traced from
pixels; generic rendered road widths and OSM road centre lines were not used.

| Hole | Observed boundary | Adopted length | Remaining extent |
|---|---|---:|---|
| 2 | Course-side edge of Kyttingevägen, right of green | 83.6 m | Other boundary markers remain unresolved |
| 11 | Eastern edge of Kyttingevägen alongside the green and middle of the hole | 115.0 m | Shaded continuation toward the tees |
| 12 | Western edge of Trolldalsvägen behind green | 48.6 m | No complete enclosing OB boundary inferred |
| 14 | Western edge of Trolldalsvägen behind green | 41.6 m | Path junctions and further extents omitted |
| 15 | Eastern edge of Trolldalsvägen left of the hole, two segments | 214.3 m | Trees, shadows and path junctions interrupt the trace |

The club's [September 2024 boundary explanation](https://www.lidingogk.se/nyheter/maanadens-regelfraaga-september-2024/)
identifies stakes mainly on holes 1, 2, 5 and 6, and confirms the boundary fence
behind green 10. Native crops of these areas were inspected. Individual white
stakes and the precise hole-10 fence alignment could not be distinguished with
enough confidence from other small objects, vegetation and shadows. These
remain explicit unresolved records. **No physical white stakes were invented.**
The older article is supplementary context; the current rules take precedence.

The image interpretation uncertainty is estimated at 0.8 m for the clearer edges
and 1.0 m for hole 11. These are partial visible segments, not a surveyed or
complete boundary. Imagery from May 2025 does not establish today's marker
positions or later changes.

## Reproduce and verify

The authoring ledger is [ob-placement-review.json](ob-placement-review.json).
[apply-ob-placement.mjs](apply-ob-placement.mjs) validates provenance, pixel
transforms and boundary types before applying all records atomically. It keeps
virtual boundary lines separate from individually observed stake points.
Unresolved observations never acquire generated coordinates. Terrain and water
heights are untouched.

```powershell
node --test lidingobuild/mapping/ob-placement.node-test.mjs
& 'upsalabuild/cache/review-venv/Scripts/python.exe' lidingobuild/mapping/render-ob-review.py
```

The four tests cover source-coordinate preservation, zero generated stakes,
rejection before mutation, idempotent application and preservation of unrelated
markings. The overlay renderer verifies all 57 source-pixel transforms and the
source PNG checksums, then writes six local inspection panels under ignored
`lidingobuild/cache/ob-review/`. All six panels were visually reviewed; the first
hole-2 vertex was withdrawn where foliage obscured the road edge.
