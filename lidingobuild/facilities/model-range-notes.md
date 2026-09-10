# Lidingö range facility appearance model

`model-range.py` authors 13 facility groups through the production Blender context. It creates geometry and materials only; it neither connects to Blender nor changes application files itself. Every coordinate uses X east, Y north, Z RH2000 minus 25 m, with horizontal origin E 677700.5, N 6586399.5. Source image pixels remain in the ignored cache and are not included in the exported model.

The two barns retain the existing roof-derived architectural envelopes and exact source footprints: **west range barn `way/26408210`**, **east range-road barn `way/26408211`**. Their neutral walls and generic repeated glazing are replaced by red timber, dark metal roofs, restrained siding relief, gutters, service doors and sparse upper windows. The road-facing west side and south gable of the east barn use the Commons 2020 photograph; its low east facade uses the 2026 practice-green photograph. These images support red boarding, few openings and differing facade heights. Door/window dimensions and unphotographed elevations remain display estimates; room uses are not assigned from historical B2/B3/B4 labels. The asymmetrical retained roof heights are deliberately preserved.

The source-footprint sheds `way/221846983` and `way/40895787` receive restrained muted timber walls and dark roofs. Neither has supported roof measurements. Their heights, facade details and roof interpretation are cautious aerial appearance estimates. The southern structure is not relabeled as a toilet or kiosk; ownership and use remain unverified.

## Actual image tracing

The new canopy and hut outlines in [authored-layout.json](authored-layout.json) are traced roof corners in the original **31 May 2025, 0.16 m/pixel** orthophotos. They replace the earlier inventory's broad search rectangles for these authored objects. The JSON pins each source image by SHA-256 and keeps every pixel vertex, coordinate transform and interpretation note.

| Feature | Source crop | Geometry basis | Display estimates |
| --- | --- | --- | --- |
| North covered tees | `range-north-detail-lm-2025` | Four visible light roof corners | 3.05 m front eave, 0.42 m rear rise, four covered bays |
| South covered tees | `range-south-detail-lm-2025` | Four visible dark roof corners | 3.10 m front eave, 0.35 m rear rise, ten covered bays |
| North ball/service hut | `range-north-detail-lm-2025` | Separate small roof north of apron | Red hut appearance corroborated by club photo; 2.50 m eave, 0.30 m roof rise |
| South shelter end enclosure | `range-south-detail-lm-2025` | Separate projecting roof at east end | Muted red service enclosure, 2.75 m eave; function unconfirmed |
| Exposed mats | North/south crops | 8 north and 10 south visible mat centres traced individually | Mat dimensions, trays and divider proportions from club photo |
| Upper parking central double bank | `upper-parking-detail-lm-2025` | Four visible paint-bank corners | 14 divisions per side regularized between endpoints |

Roof-edge interpretation uncertainty is approximately 0.3–0.7 m; relief displacement can separate roofs from wall footprints. Covered bay counts cannot be established from the aerial image and are explicitly authored estimates. Mats hidden by trees are omitted. Pale low dividers represent the photograph's sign-board form without copying sponsor advertisements. A dispenser cabinet inside the north hut doorway, blue bin and barrel planter are small photo-informed approximations; exact machine type and fixture positions are unverified.

## Nets, terrain and integration

The west range net follows retained OSM `way/52583080`, with its northern endpoint adjusted to the visible west edge of the new canopy so the old line does not pierce the roof. The road-side net is a separate approximate visual trace following the range side of the road and the west side of the west barn. Heights of 11.5 m west and 15 m road-side, intermediate poles and sparse silver truss details are display estimates supported by the pole/net photographs. Thin geometric strands preserve visibility; there are no opaque net planes. Strand spacing is deliberately coarser than real net weave to keep the model efficient.

Existing paving polygons stay unchanged. Parking paint follows the terrain and the visible 2025 central bank; it adds no cars or speculative stall markings under southern trees. A small surface-height offset prevents paint and mat z-fighting.

All parents carry an evidence record. Only actual source **building** IDs are passed to `ctx.facility(..., source_ids, ...)`, allowing the application to replace the correct old structures. New huts, canopies, mats, nets and paint use an empty building-ID list. Net envelopes and paint set `exclude_vegetation=False`; roofs and hardstanding mat groups use explicit physical footprints. Café 9 between holes 9/10 and the toilet at tee 15 were subsequently located from course-guide context and 2025 orthophotos: their separate ancillary module supplies `cafe-9` and `toilet-15`, with evidence in [ancillary-location-review.json](ancillary-location-review.json). They are outside this range module; its original `deliberatelyUnlocated` return field records that module's earlier scope and does not describe final whole-package coverage. Historical B2/B3/B4 use assignments remain unconfirmed.

The CPU build audit validates finite coordinates, face indices, positive dimensions, terrain coverage, unique facility IDs and the sub-50,000 range-triangle budget. It is an implementation check, not a geometry survey. Its local report is `lidingobuild/cache/facilities-reference-2026-09-10/range-authoring-validation.json`. The production builder uses the exact retained 1 m terrain; the isolated CPU audit uses the reference terrain mesh only to verify geometry construction without accessing live Blender.

References: [orthophoto provenance](orthophoto-reference.md), [photo evidence](web-reference.md), [club range photograph](https://www.lidingogk.se/trana/rangen-ovningsomraden/), [club gallery](https://www.lidingogk.se/banan/bildgalleri/).
