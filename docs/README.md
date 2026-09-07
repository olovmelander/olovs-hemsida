# Golf course documentation

Updated 2026-09-07. Start here when creating a course or improving an existing
one. The current guide combines the v2 architecture with the mapping techniques
tested during the Upsala work.

| Document | Use it for |
|---|---|
| [Course v2 production guide](v2-course-runbook.md) | Ground/course identity, source hierarchy, coordinates, terrain/surface/object compilation, current tool support, publication and release gates. |
| [Course mapping workflow](v2-course-mapping-workflow.md) | Complete object inventory, new-course and existing-course review, source acquisition, QGIS/imagery/survey techniques, guarded adoption, Windows recipes and next-session handoff. |
| [Course model vocabulary](course-model-vocabulary.md) | What model fields actually mean, polygon ownership, tee platforms and markers, evidence-only observations, trees and runtime estimates. |
| [V2 performance recovery](v2-performance-recovery.md) | Current default graphics, first-frame loading behavior, terrain resource reuse and valid performance comparisons. |
| [Upsala mapping handoff](../upsalabuild/mapping/NEXT-SESSION.md) | Latest accepted Upsala checkpoint, exact rebuild/validation commands, local inputs and remaining work. |
| [Upsala mapping inventory](../upsalabuild/mapping/README.md) | Current mapping coverage, review artifacts and category gaps. |

For a new physical ground, read the production guide and create a source and
coverage ledger before compiling. A new routing on an existing ground shares
its terrain and physical objects. For an existing course, review the current
ledger, preserve accepted work and choose the smallest source-backed correction;
rebuild all affected shared routings.

“Perfect” is the intended accuracy and completeness target. Published v2 graphs
currently include provisional frames and migration-derived surface paths; none
yet contains authoritative surface tiles. Use measured residuals, per-feature
provenance and explicit coverage gaps to describe quality.

The following documents explain design decisions or dated implementations.
Their historical status and commands do not override the current guides, code,
schemas or live manifests:

- [Digital twin implementation plan](course-digital-twin-implementation-plan.md)
- [Surface rendering design](puttom-v2-surface-rendering-plan.md)
- [Authoritative surface intake](puttom-authoritative-surface-intake.md)
- [LiDAR tree placement design](puttom-v2-lidar-tree-placement-plan.md)
- [Graphics preview history](v2-graphics-pages-preview.md)
- [Second-course design](second-courses.md)
- [Course source dossiers](courses/)

When work ends, update the affected ground's handoff with the accepted commit,
evidence, reproduction commands and next task. Record unresolved acquisition,
survey, geometry and runtime work separately. Do not rerun expensive acquisition
or replace valid geometry merely because a new session has started.
