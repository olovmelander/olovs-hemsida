# Lidingö mapping completeness audit

Geometry preservation: **passed**. This checks retained source vertices against the served pack; it does not establish current completeness or survey accuracy. New Lantmäteriet orthophotos have not been acquired or used by this audit.

110 adopted playing outlines and 14 facility features retain their physical ownership through packing, including interior islands. 562 building footprints and 27 vegetation context polygons retain their source geometry.

## Every-hole review queue

Counts describe adopted outlines, not the actual number present today. Zero does not mean a feature is absent. Par-3 holes need not have a fairway. Every hole still needs a current-image census and alignment review.

| Hole | Par | Greens | Tees | Fairways | Bunkers | Recorded issue / next review |
|---|---|---|---|---|---|---|
| 1 | 3 | 1 | 1 | 0 | 3 | additional-forward-platform-not-adopted |
| 2 | 5 | 1 | 3 | 1 | 1 | Current-image review required |
| 3 | 3 | 1 | 3 | 0 | 1 | Current-image review required |
| 4 | 4 | 1 | 3 | 1 | 2 | Current-image review required |
| 5 | 4 | 1 | 1 | 1 | 2 | Current-image review required |
| 6 | 3 | 1 | 1 | 0 | 1 | Current-image review required |
| 7 | 4 | 1 | 2 | 2 | 4 | Current-image review required |
| 8 | 4 | 1 | 2 | 1 | 3 | Current-image review required |
| 9 | 3 | 1 | 2 | 0 | 1 | Current-image review required |
| 10 | 5 | 1 | 3 | 1 | 5 | Current-image review required |
| 11 | 3 | 1 | 1 | 0 | 3 | Current-image review required |
| 12 | 5 | 1 | 1 | 1 | 2 | Current-image review required |
| 13 | 4 | 1 | 1 | 1 | 0 | western-fragment-rejected-after-overlay; 2025-reported-change-unmapped |
| 14 | 4 | 1 | 1 | 1 | 2 | Current-image review required |
| 15 | 4 | 1 | 3 | 1 | 1 | Current-image review required |
| 16 | 3 | 1 | 3 | 0 | 3 | Current-image review required |
| 17 | 5 | 1 | 3 | 1 | 2 | Current-image review required |
| 18 | 4 | 1 | 2 | 1 | 1 | ambiguous-bare-soil-patch-not-adopted |

Two greens, one tee and three bunkers are unassigned to playing holes. The greens have named practice-facility owners; unassigned context must not be silently reassigned to reach a target count.

## Environment coverage

- Terrain now spans 16,384 m in 277 tiles. The 2,048 m native 1 m window and its canopy remain the highest-detail region.
- Source context has 1020 features over a smaller extent than the terrain world. 19 retained park, pitch and playground polygons lack explicit leisure-feature representation; their tags cannot locate individual equipment or trees.
- 5 roofs have 2021 measurements. Clubhouse and north facility roof coverage remains about 92.3% and 89.7%; other building heights and facades need evidence.
- Canopy is dated 2021-03-23; it provides stand representatives, with zero surveyed individual-tree records. It does not establish forest coverage throughout the expanded world.
- Seven water components still end at the old acquisition crop. A larger terrain mesh alone cannot repair the clipped shoreline.

## Acceptance for the next source pass

For each hole, inspect the current orthophoto with the adopted outlines overlaid, record additions/removals and source date, check ambiguous shadows against laser evidence, and retain unresolved edges as unresolved. Independently check horizontal alignment before assigning accuracy. Rebuild vegetation exclusions after adopting changed surfaces. Review surrounding land cover, shorelines and buildings across the camera-visible environment as well as the course.

Regenerate with `node lidingobuild/mapping/audit-completeness.mjs`; use `--check` to require a current report and preserved runtime geometry. Full feature IDs, evidence classes, bounds and file hashes are in [mapping-completeness.json](mapping-completeness.json).
