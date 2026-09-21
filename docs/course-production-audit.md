# Course production audit

Manifest structure and declared source metadata; no fresh visual review or binary verification.

| Ground | Layouts | Terrain | Surface tiles | Object tiles | Stand tiles | Frame approval | Hole review |
|---|---:|---|---:|---:|---:|---|---|
| angso | 1 | passed | 0 | 234 | 256 | pending-control-approval | unknown |
| johannesberg | 2 | passed | 0 | 223 | 256 | pending-control-approval | unknown |
| lidingo | 1 | passed | 0 | 0 | 64 | pending-control-approval | unknown |
| norrfallsviken | 1 | passed | 0 | 163 | 229 | pending-control-approval | unknown |
| puttom | 1 | passed | 0 | 251 | 256 | pending-control-approval | unknown |
| ribbingsfors | 1 | passed | 0 | 245 | 254 | pending-control-approval | unknown |
| tortuna | 1 | passed | 0 | 57 | 120 | pending-control-approval | unknown |
| upsala | 2 | passed | 0 | 234 | 256 | pending-control-approval | unknown |
| veckefjarden | 2 | passed | 0 | 236 | 256 | pending-control-approval | unknown |
| visby | 1 | passed | 0 | 116 | 256 | pending-control-approval | unknown |

Tile counts describe representation, not mapping completeness. Zero authoritative surface tiles does not mean no rendered playing surfaces.

## angso

- The source ledger has changed since this ground generation; reconcile it before release.
- canonical-origin: The EPSG:5845 origin is intentionally unset.
- authoritative-assets: Terrain and all playing-ground orthophoto windows are acquired and verified; full source-file checksums, remaining topography and independent control approval are outstanding.
- zone-a-survey: Play-critical microterrain and stable objects lack controlled survey.
- legacy-imagery-rights: Reviewed playing surfaces use Lantmateriet imagery, but retained fairway cuts on holes 12/15, legacy canopy, facilities and other surrounding derivatives still have older Esri/OSM lineage.

## johannesberg

- canonical-origin: The shared EPSG:5845 origin is intentionally unset.
- authoritative-assets: Shared 1 m RH 2000 terrain and 2021 Laserdata Skog are acquired. Authenticated 2025 orthophoto windows support reviewed playing surfaces, explicit tee references, five OB display corridors and estate corrections. Ten tee references, the hole-3 OB corridor and the northern hole-18 continuation beyond the dry bank remain unresolved; daily markers and individual posts are not surveyed. Topografi 10 remains unacquired; the independent canonical-origin gate is unchanged.
- nine-hole-routing: All nine putting surfaces and 15 physical platforms are traced from 2025 orthophotos. Fifteen accepted Yellow/Red mat references have explicitly inferred ownership; Yellow on holes 1, 2 and 6 remains unresolved. Accepted back-tee references update route starts without altering the official card. Club-confirmed colour ownership, remaining back platforms and independent route controls are still required.
- legacy-imagery-rights: Reviewed playing surfaces and estate corrections now use dated Lantmateriet source windows. Some obscured surfaces, surroundings and the legacy fallback canopy remain inherited; the published measured vegetation uses Laserdata Skog.

## lidingo

- The source ledger has changed since this ground generation; reconcile it before release.
- incomplete-playing-geometry: All 18 tee areas have a 2025-05-31 native orthophoto review. Unresolved colour starts, shadowed edges, other playing surfaces and changes after the imagery remain unapproved; individual OB stakes are not surveyed.
- canonical-control-pending: Canonical origin has no independent survey anchors. Proposed local adapter origin is a working coordinate reference, not an approved control frame.
- surface-intake-pending: No playing-surface source has passed authoritative v2 intake. Source OSM geometry and official schematics cannot establish survey authority.
- club-media-rights-pending: No club or Banguider grant for redistribution or geometric derivatives was located. Raw photos, guides and videos are local-only reference.
- vegetation-and-stable-objects-pending: Measured 2021 canopy stands, clipped national water and supplementary OSM facilities are acquired. Contemporary stand boundaries, individual large objects and local residuals remain unapproved.

## norrfallsviken

- The source ledger has changed since this ground generation; reconcile it before release.
- canonical-origin: The EPSG:5845 origin is intentionally unset.
- authoritative-assets: Dated 2024 orthophoto windows are acquired and reviewed for playing surfaces and selected facilities. Existing laser terrain/vegetation remain published. Field controls, obscured features, colour-specific daily tee markers and exact building heights remain unresolved; Topografi 10 has not been acquired.
- zone-a-survey: Play-critical microterrain, dunes and objects lack controlled survey.
- legacy-imagery-rights: Current geometry depends on unapproved Esri and GolfTraxx derivatives.

## puttom

- canonical-origin: The EPSG:5845 origin is intentionally unset.
- authoritative-assets: Authenticated orthophoto access and 45 fully valid native RGBI windows are now recorded. Remaining source acquisitions, interpretation gaps and independent geometry controls require their own evidence; this intake does not approve unrelated source or survey gates.
- zone-a-survey: Play-critical microterrain and objects lack controlled survey.
- legacy-imagery-rights: Reviewed features now retain Lantmäteriet orthophoto lineage and attribution. Unreviewed Esri, GolfTraxx and other legacy derivatives remain in the composite and retain their existing production-rights gate.

## ribbingsfors

- canonical-origin: The exact EPSG:3006 source-frame origin is recorded, but the EPSG:5845 canonical origin remains intentionally unset.
- authoritative-playing-surfaces: Greens, tees, fairways and bunkers are guide-constrained synthetic geometry rather than licensed orthophoto or survey measurements.
- current-course-card: Official sources confirm nine holes and par 36, but no current authoritative per-hole scorecard was captured.
- vegetation-recency: The 2023 Laserdata Skog canopy has been processed, but protected-tree records date from 2005/2008 and no current imagery or field review confirms individual high-value trees.
- reference-rights: GolfTraxx coordinate rights are unverified and club/Caddee guide material is retained only as paraphrased reference notes.

## tortuna

- The source ledger has changed since this ground generation; reconcile it before release.
- current-routing-review: The current card is resolved as par 71 and hole 9 as the short par 3. Current coloured tee locations and the complete physical tee census remain unverified; displaced/occluded reference starts remain provisional.
- canonical-control-pending: Independent horizontal and RH 2000 controls are not yet acquired.
- surface-intake-pending: All 18 greens and additional played/facility surfaces are observed candidates from May 2026 national imagery. Shadows, rough transitions, omitted tees and human acceptance remain unresolved.
- media-rights-review: Original club/Caddee/GolfTraxx media remains private reference evidence. National provider terms and attribution are retained; private imagery is measurement input. No implicit production reuse grant is inferred for historical third-party reference geometry.
- vegetation-current-review: April 2021 laser canopy is measured area evidence with explicit voids. May 2026 semantic exclusions remove mapped playing/facility areas but do not prove current tree identity, botanical species, clearing completeness or individual stem positions.

## upsala

- canonical-origin: The shared EPSG:5845 origin is intentionally unset.
- authoritative-assets: Terrain and bounded authenticated orthophoto windows are acquired and verified. Surface review is partial and independent source/control approval remains outstanding; acquisition does not establish surveyed geometry.
- zone-a-survey: Both courses' play-critical microterrain and objects lack controlled survey.
- legacy-imagery-rights: Current surface and canopy derivatives depend on unapproved Esri imagery use.

## veckefjarden

- canonical-origin: The shared EPSG:5845 origin and RH 2000 lake benchmark are unset.
- authoritative-assets: Native bounded 2024 orthophotos are acquired and reviewed vectors are applied. Controlled survey and complete replacement of remaining legacy surfaces, marker associations and environment boundaries are still pending.
- zone-a-survey: Play-critical terrain, rock and objects lack controlled survey.
- legacy-imagery-rights: Current traces depend on unapproved Esri, GolfTraxx and club-guide derivatives.

## visby

- The source ledger has changed since this ground generation; reconcile it before release.
- hole-routing-unresolved: All 18 main-course identities have provisional source-derived routes. Independent contemporary routing review and coordinate controls remain pending; ambiguous OSM ref2 records are not used as authority.
- playing-surfaces-incomplete: Main-course greens, representative physical tees, fairways and observed bunkers are implemented. All tee platforms, current mowing edges, fringes and the separate nine remain incompletely reviewed.
- canonical-origin-unapproved: A fixed software frame at the measured terrain midpoint is now used consistently. No independent survey anchors approve its canonical status.
- current-ortho-access: Authenticated 2026 imagery access is verified and 68 review windows acquired. A dated playing-boundary pass is adopted with CC BY 4.0 attribution; remaining boundaries and independent registration still need review.
- media-derivative-rights: Club/Caddee images and municipal orthophoto have no verified production derivative/distribution grant.
- vegetation-and-objects: 2024 measured canopy, national water with preserved islands and OSM context are implemented. Individual trees, present-day change and building dimensions remain unapproved.
- playable-runtime-pending: A local provisional compatibility pack and measured v2 graph are implemented; complete independent human, named device and all-season visual acceptance remains pending.
