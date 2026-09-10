# Clubhouse modelling profile

[clubhouse-model-profile.json](clubhouse-model-profile.json) is a concrete Blender input: ten components, 22 facade openings, four small dormers and two large central crossgables. Dimensions are evidence-informed modelling estimates, with position, floor and height uncertainties recorded. They are not survey measurements.

The local frame is right-handed. Its origin is EPSG:3006 **[679204.032752, 6626167.160651]**. U points northeast along the ridges, at 54.7228° clockwise from grid north; V points northwest toward the driving range. The main entrance faces **−V**, southeast toward the course. Coordinates are `origin + U×axisU + V×axisV`; all vertical values are absolute RH2000 and need the scene's height-origin subtraction exactly once.

| Component | Approximate plan size | Base / eave / ridge RH2000 |
| --- | --- | --- |
| Main walls | 23.8 × 12.3 m | 15.4 / 21.6 / — |
| Main roof | 24.8 × 13.2 m | — / 21.6 / 26.8 m |
| Southwest annex walls | 11.25 × 7.45 m | 15.4 / 20.9 / — |
| Southwest annex roof | 11.2 × 8.3 m | — / 20.9 / 24.2 m |
| Central front/rear crossgables | Each 6.8 m along V, 5.4 m across U | 21.5 / 24.55 / 26.8 m |
| Front balcony | 4.3 × 2.55 m | Deck 21.45 m; rail 1.05 m high |
| Northeast veranda | 2.9 × 12.3 m | 15.45 / 20.5 / 21.5 m |
| Southwest front deck | 11.6 × 5.1 m | Slab centre 18.75 m; finished top 18.84 m |
| Separate terrace pavilion | 10.8 × 5.2 m | 18.5 / 20.55 / 22.2 m |

The source images identify a main block with a lower floor exposed toward the range, a lower southwest annex, a northeast veranda, and a timber balcony shading the course-facing entrance. The rear view shows white bands between floors, two attic windows on the northeast gable, and a small canopy over the lower rear entrance. Both long roof slopes have a large central crossgable flanked by two smaller dormers. The front central crossgable contains balcony doors; the rear has two separate windows.

The small dormers' `centerUV` denotes their **face plane**, not a whole-box centre. Their faces are V −3.3 on the front and V +7.0 on the rear, at approximately 22.65 m RH2000 where they meet the main roof. Extend their 2.6 m depth inward toward the ridge. Crossgable `lengthM` follows its V-oriented ridge; `widthM` is the 5.4 m span across U. Clip or merge intersecting roof surfaces to avoid internal or coplanar faces.

The pavilion corresponds to source building **w296165897**, previously described as a clubhouse shed. The 2018 frontal photographs and 2024 gable photograph show an open hip-roof pavilion with timber posts. Its initial ridge estimate followed the 2021 candidate maximum of 21.9 m. The final structure is 0.30 m higher to clear the displayed terrain while preserving headroom, within the recorded 0.45 m eave/ridge uncertainty. This adjustment is not new roof evidence. Render it once under its own source-building identity, without a duplicate opaque shed.

The [deck clearance review](deck-clearance-review.json) records the terrain-fit adjustment. Native terrain reached 18.758 m beneath the annex terrace and 18.422 m beneath the pavilion in the initial approximately 1 m sampling. The annex slab centre was raised 0.25 m, within the 0.35 m floor uncertainty, and its estimated terrace entrance threshold follows the 18.84 m slab top. Main and rear floor levels remain separate. The runtime terrain is unchanged.

The inherited main footprint is narrower and offset relative to the visible roof. Fitting only points inside that mask would truncate the rear roof and produce misleading proportions. Full-window roof returns instead support two main planes near 39°; their intersection gives V approximately 1.75 m and height approximately 26.82 m RH2000. The proposed roof envelope was checked visually against the 2025-06-14 native orthophoto in `cache/facilities-reference/clubhouse-proposed-roof-envelope.png`. The wall outline is an approximately 0.4–0.6 m inset modelling choice, not a newly measured footprint.

Ground differs by approximately 2.6 m across the building: retained class-2 returns give about 18.13 m on the front apron and 15.51 m behind. Finished floors at 15.6, 18.55 and 21.55 m are plausible estimates matching the photographs. Do not raise the whole building to a single centre-ground height: that would hide the rear lower floor. Clip foundations against the actual terrain.

The profile pins the four official photographs, native orthophoto, inventory, ground and height reports, and derived section/envelope checks by SHA-256. Facade dimensions and colours were inferred visually from the [documented reference pack](web-reference-sources.md); no photograph becomes a texture. Detailed photos date to 2018 and October 2024, so exact changes during the reported 2025 renovation remain uncertain. Optional repeated dark rear-roof panels are described by appearance only; their exact count and equipment type are not asserted.
