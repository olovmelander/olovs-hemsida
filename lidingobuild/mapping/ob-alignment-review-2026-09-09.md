# Lidingö road-boundary alignment

The [review](ob-alignment-review-2026-09-09.json) contains five observed asphalt-edge runs from Lantmäteriet orthophotos captured on **31 May 2025**, at native **0.16 m** spacing. The current catalog was checked on 9 September 2026. These runs support **60 illustrative white display posts over 621.08 m**. Physical stake positions were not established.

The [club's current local rules](https://www.lidingogk.se/media/tl1nt1n3/lidingoe-gk-lokala-regler-2026-03-16.pdf), approved 16 March 2026, identify the paved roads as OB boundaries in the listed locations. The course-side asphalt edge supplies the geometry; golf-property outlines and road centreline offsets are not used.

| Hole | Rule location | Observed edge | Display posts | Traced length |
|---|---|---|---:|---:|
| 2 | Kyttingevägen, right of green | East/northeast edge of visible road bend | 7 | 61.61 m |
| 11 | Kyttingevägen, left of hole | East edge alongside tees and green | 16 | 172.99 m |
| 12 | Trolldalsvägen, behind green | West edge | 6 | 55.37 m |
| 14 | Trolldalsvägen, behind green | West edge | 6 | 49.98 m |
| 15 | Trolldalsvägen, left of hole | East edge beside tees and fairway | 25 | 281.13 m |

Tree crowns obscure the northern continuation of the hole-2 run and the northern road section toward hole 15's green. Those sections are omitted. The other 13 holes remain unresolved for white stakes, plates and painted lines; missing records do not establish absence. Temporary 2026 rules and boundary changes after the imagery date are also unverified.

Display posts are sampled along the traced edge at intervals no greater than 12 m. Their spacing and the renderer's standard stake dimensions are illustrative. Every runtime record retains `physicalPostPositionsObserved: false`, its source window, capture date, rule reference and interpretation uncertainty (1–2 m). No terrain is modified.

`applyObAlignmentReview(model, review)` in [reviewed-ob-alignment.mjs](reviewed-ob-alignment.mjs) returns a cloned model with these `marking` entries. It preserves unrelated markers and course geometry, rejects source-frame drift, and can be reapplied without duplicates. Integration belongs after the course model is assembled and before pack publication. The local rules source ID is `club-local-rules-2026`.

Validation: all five source TIFF checksums matched, all source overlays were visually inspected, and four Node tests passed. Tests cover native pixel-to-EPSG placement, distance along curved edges, endpoint preservation, omitted canopy geometry, idempotency and malformed evidence. The review is a machine visual interpretation, not a survey or a complete physical-marker census.

```powershell
node --test lidingobuild/mapping/reviewed-ob-alignment.node-test.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/mapping/review-ob-alignment.py
```

The second command verifies retained source bytes and recreates overlays under ignored `lidingobuild/cache/ob-alignment-2025/`. Raw imagery remains local.
