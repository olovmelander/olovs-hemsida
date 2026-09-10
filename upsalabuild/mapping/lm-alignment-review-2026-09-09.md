# Upsala orthophoto alignment update — 9 September 2026

**Latest tee checkpoint:** all seventeen previously unresolved navigation
references have explicit source reviews: **16 moved and Stora H15 tee 62 was
confirmed without movement**. The current total is **136 platform-associated
references plus 17 reviewed tee/fairway-site references**. Read the
[remaining seventeen review](remaining17-tee-review-2026-09-09.md) first.
Six fairway entries are approximate, with 12–15 m interpretation allowances;
complete H13 forward and H15 upper platform boundaries remain provisional.
Daily marker positions remain unverified.

Final verification passes all 306 main-app selections across both courses in
required-v2 and GPK1 modes: 272 earlier platform checks and 34 site checks.
The standalone passes all 108 Stora selections, and all 64 focused tests pass.
Both browser proofs report no errors. The
[permanent coordinate gate](tee-site-coordinate-contract-2026-09-09.json)
checks the accepted source decisions through the published consumers.

**Historical coordinate follow-up:** the standalone camera's 7 m setback was
fixed, missing Stora H6/H18 platforms were added, and eleven further references
were corrected. See the [earlier coordinate follow-up](lm-tee-coordinate-followup-2026-09-09.md).

**Historical initial tee pass:** 83 tee-selection coordinates were aligned
with the photographed platforms (60 Stora, 23 Mellan). Nine corresponding
Stora route starts followed the corrected positions. At that stage all 78 pad
outlines were retained and 27 uncertain reference decisions remained unchanged.
See the [tee alignment review](lm-tee-alignment-review-2026-09-09.md) and
[before/after reference sheet](lm-tee-reference-changes-2026-09-09.svg).
The green/bunker report below records an earlier pass; its original counts,
unchanged-route and unchanged-marker statements apply to that historical stage.

Both Stora banan and Mellanbanan now use the accepted boundary corrections from
authenticated Lantmäteriet imagery captured **14 June 2025**. The live catalogue
still identifies that campaign as the newest covering this ground.

The review checked all **27 greens** and corrected **four green boundaries and
eight bunker footprints**. One corrected bunker combines two older OSM records
into the single connected sand surface visible in the photograph. The other
23 green boundaries were retained with their existing provenance and limitations.

[View the before/after boundary sheet](lm-boundary-changes-2026-09-09.svg).
It contains only vector differences; source photographs remain in ignored cache.

| Surface | Accepted correction |
| --- | --- |
| Stora H1 bunker | Restore the missing east/south sand lobe. |
| Stora H2 bunker | Restore the east lobe and remove the false southern grass strip. |
| Stora H3 west bunker | Join two old polygons across the visible sand neck; retain both source identities in active/retired provenance. |
| Stora H7, two bunkers | Restore the northern sand cap and the smaller oval's visible perimeter. |
| Stora H10 northeast bunker | Remove the grass crescent included by the old southern outline. |
| Stora H11 north bunker | Remove the old pointed extension beyond the rounded sand end. |
| Stora H14 green and south bunker | Follow the putting-turf edge and sand perimeter, excluding the darker collar. |
| Stora H15 green | Remove the unsupported angular southern extension and follow the rounded putting surface. |
| Stora H18 green | Restore the rounded northern putting-surface end. |
| Mellan H6 green | Replace the misplaced OSM outline: 704.88 → 491.77 m², polygon centroid shifted 5.08 m. Exclude the northeast apron. |

Mellan H6 was also checked against the retained municipal 2024 source. A first
candidate that included the darker northeast apron was rejected and preserved
as rejected evidence. The existing nominal green reference remains inside the
accepted putting surface, 2.10 m from its boundary.

## Reproducibility and source coverage

The [acquisition runbook](lm-ortho-2026-09-09.md) covers the 27 native 0.16 m
green/bunker windows and the complete 0.8 m ground overview. All 28 rasters have
verified hashes, pixel grids and full valid-pixel coverage. Mosaic source-image
polygons establish the capture day for each native window. The overview also
contains some April 2025 imagery outside those windows.

Review decisions, original shapes, pixel traces, georeferences, source hashes,
accepted local/EPSG:3006 geometry and interpretation uncertainty are retained in
the [front-nine](lm-review-front9-2026-09-09.json),
[back-nine](lm-review-back9-2026-09-09.json) and
[Mellan](lm-review-mellan-2026-09-09.json) ledgers.

The additional outlying Stora bunker panels were inspected at 40 m extent:
`w438982472`, `w438982466`, `w438981595`, `w438981577`, `w438981578`,
`w438981590` and `w438979729`. Their footprints were retained. Some visible
edges differ by roughly 1–2 m; canopy or diffuse transitions limit other edges.
These are qualified retained boundaries, not a claim of exact agreement.
The H13 east bunker already exists as `w438982472` under H14 ownership; it was
not duplicated. Mellan shared-bunker checks likewise found existing source
records, with some small boundary differences remaining.

The full-source `imagery-lm-ortho` lifecycle remains `planned` because complete
remote TIFFs have not been downloaded and hashed in full. This does **not** mean
access is pending: the separately checksummed bounded acquisition is successful
and supplies the adopted vectors. A crop hash is not substituted for a whole
remote TIFF hash.

## Integration and verification

`apply-upsala-lm-surfaces.mjs` validates the complete batch before mutation and
rejects changed source geometry, duplicate ownership and invalid source records.
The shared Mellan helper updates H6 once in the parent's source association and
rendered scenery. The nine-hole builder consumes the same ring and compact
evidence. Pixel and national-grid source arrays stay outside runtime vectors.

Both course models, packs, canonical migrations, routing references, source
registries, standalone page and geographic export were rebuilt. The updated
physical surfaces appear exactly once in each course view, including the H3
sand connection. Existing terrain, vegetation, heightfields, card values,
routes, green references and daily tee-marker references are unchanged.

The [independent geometry validation](lm-review-validation-2026-09-09.json)
passes for all 12 accepted features and 407 vertices. Maximum transformation
roundtrip difference is 0.665 mm, consistent with the stored local rounding.
There are no green/bunker overlaps before or after these corrections.
That numerical agreement does not establish absolute source accuracy.

The [before/after frame audit](lm-alignment-after-2026-09-09.json) verifies 407
published assets and unchanged terrain/vegetation reference sets. The existing
affine rendering bridge differs from nonlinear projection by at most 0.051 m on
Stora's played vertices and 0.195 m on Mellan's. No fitted whole-course shift was
applied. Boundary interpretation uncertainty remains substantially larger.

Validation completed:

- 21 focused Upsala tests and 14 relevant Node tests pass. The full Vitest run
  passes 576 tests and encounters one unrelated Lidingö water-asset size failure.
- Upsala source-manifest validation, both migrations, standalone geometry/card checks and
  pack/page identity pass; all 12 pack/card checks pass.
- App/page lint and the standalone v2 renderer build pass.
- The broader manifest test still expects 12 course slugs while the existing
  registry contains 13. The Lidingö source file differs only by checkout line
  endings from its checked-in bytes. Neither failure is introduced by this work.
- The global app-isolation gate stops on the separately changing Puttom surface
  preview/frame binding. The Upsala graph preservation checks pass independently.
- A later global source-manifest run encounters an unrelated Johannesberg
  `nio.json` checksum mismatch during other ongoing edits. Upsala's 27 registered
  artifact checksums still pass.

Both GPK1 browser checks pass, including the 144/63 scorecard values, green/sand
atlas probes and 54/24 physical tee platforms. Required-v2 checks also pass for
both slugs with no page errors, exact accepted ring identities, the old H3
split-ring geometry absent and the visible connection classified as sand.
The served pack hashes match the rebuilt source and production copies.
Stora H3/H14 and Mellan H6 were captured after terrain streaming settled and
visually inspected. These checks use WebGL2 through hardware ANGLE/D3D11 and
do not constitute a performance benchmark. See the
[runtime validation record](lm-runtime-validation-2026-09-09.json).

This update improves visible playing-surface alignment. Obscured tee boundaries,
some sand edges, daily marker positions, 2026 construction, infrastructure and
independent survey control remain separate work. The 2025 photographs cannot
certify every object or establish perfect present-day alignment.
