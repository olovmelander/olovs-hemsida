# Stora forward tee point sources, 9 September 2026

Independent published coordinates resolve eight remaining tee-42 navigation
references: H4, H5, H7, H8, H11, H12, H13 and H15. Each published point was
projected directly into the exact course frame and visually checked against
native Lantmäteriet imagery captured 14 June 2025. No fitted image shift,
scorecard interpolation or nearest-platform selection was used.

The [18Birdies public course page](https://18birdies.com/golf-courses/club/7cf64a10-86ac-11e4-8c28-020000005b00/upsala-golfklubb)
includes coordinates in its rendered page data:
`Course.props.profile.club.holes[hole-1].teeGeoPoints[16]`.
Its forward column is named **43**. All 18 corresponding yardages convert to
the current **42** card values within 0.414 m, consistent with whole-yard
rounding; the club's rating certificate also used 43 for this column.
The male/female coordinate pairs are identical. This establishes the column
identity, not playing eligibility or daily marker positions.

The source reports revision 20, layout revision 591567093, and
`dataCertified: false`. It supplies no point acquisition date or absolute
accuracy. Eighty of its 90 rear-five tee references fall inside independently
observed same-hole platforms; the remaining outliers show why every target
needed separate imagery review. This is a consistency check, not a surveyed
error estimate.

| Hole | Chosen local coordinate [x, z] | Move from previous reference | Basis |
| --- | --- | ---: | --- |
| 3 | [397.945, -3.552] | 10.897 m | Approximate visible fairway head |
| 4 | [237.730, 126.879] | 14.499 m | Published coordinate |
| 5 | [115.764, 192.728] | 10.881 m | Published coordinate |
| 7 | [-350.342, 288.456] | 11.335 m | Published coordinate |
| 8 | [-407.347, -121.101] | 7.952 m | Published coordinate |
| 11 | [158.819, -568.113] | 8.885 m | Published coordinate |
| 12 | [-164.771, -546.522] | 9.279 m | Published coordinate |
| 13 | [-296.032, -287.614] | 7.854 m | Published coordinate |
| 15 | [-210.595, -195.959] | 13.572 m | Published coordinate |

H3 requires a different interpretation. The published point falls on the dry
pond-side collar in the municipal 2017 and 2023 images and the native 2025
image. It is rejected as an exact fairway placement. The club's guide identifies
tee 42 at the nearby fairway head. The proposed navigation point sits on that
visible grass, **12.293 m from the published point**. It is an approximation,
with a 15 m working interpretation allowance. The other eight use a 5 m working
interpretation allowance. These allowances are neither statistical confidence
bounds nor certified absolute geographic accuracy.

All nine chosen positions fall inside the current same-hole fairway polygons.
Their conservative image support polygons provide 1.312–3.055 m of interior
clearance. Support polygons are evidence only: they do not add rendered tee
pads or alter fairway boundaries.

The [decision ledger](lm-tee-points-stora-2026-09-09.json) records source URLs,
SHA-256 hashes, public feature paths, original tee objects, exact pixel grids,
WGS84/EPSG:3006/local coordinates and the H3 offset. The public HTML SHA-256 is
`11627a0104d5cc5ee1e20fbee7ea9668ccb6ff4b257c38ffa33c6389eb105945`.
Raw sources and annotated panels remain in ignored
`upsalabuild/cache/lm-fairway-tee-points-2026-09-09/`.

Other checked public sources did not provide individual tee coordinates in
their page data: [Hole19](https://www.hole19golf.com/courses/upsala-golfklubb-stora)
provided course location and scorecard data; [Caddee](https://www.caddee.se/klubb/upsala-golfklubb)
provided course locations, hole illustrations and tee distances; the
[Golf i Sverige widget](https://www.golfisverige.com/klubb/upsala-golfklubb/maps/widget_7da77b93-958d-45aa-8f9b-6dcd191ff621.html)
provided raster hole illustrations. Their downloaded responses are retained in
the same cache. None of those illustration pixels were transformed into
runtime coordinates.

The additional cached public-page SHA-256 hashes are:

- Hole19: `959d1af0bf9406a2b47745db35b217a97cb1c8f37c5907e0caec843e89122d7d`.
- Caddee: `c82aec15fc06d9305f26e3b436bdac532da17194c9f9123be39e2ed5bc4cc351`.
- Golf i Sverige club page: `40a15368e8dcc10e50c7a809291a66933cd1306cfdfb59c2a06ca9aca00a8e22`.
