# Tortuna refinement review — 2026-09-09

This records the surface/facility refinement pass. The subsequent
[surroundings expansion](tortuna-environment-expansion.md) retains these playing
features and roofs while extending measured vegetation and mapped context.
The identities and counts below describe this earlier pass.

This pass refines the provisional Tortuna course on
`codex/tortuna-golf-course-v2`, following the v2 source workflow. It replaces
44 reviewed surface outlines, adds five observed forward tee platforms and
hole 6's green apron, and removes a cart path incorrectly classified as a tee
at hole 18. The original source traces remain retained with explicit
replacement/removal records and checksums.

The model now contains 87 playing polygons: 18 greens, 22 tee platforms,
32 bunkers and 15 fairway or apron polygons. The 18-hole, par-71 current card
and short par-3 ninth remain intact. Only a virtual target is placed inside
each green; daily flags and coloured tee markers are not surveyed.

| Feature | Result and source limits |
| --- | --- |
| Clubhouse and surrounding buildings | 147 OSM footprints plus the observed range shelter; six buildings now render 4,737 measured roof triangles instead of generic roofs. |
| Roof evidence | April 2021 laser returns, independently traced May 2026 roof envelopes; 12 envelopes exclude older canopy. Source ground footprints remain unchanged. |
| Roads, tracks and trails | 27 road segments, 21 tracks and 15 paths, including six newly traced path segments. Full widths and explicit surface materials reach both classification and rendering. Unknown dimensions remain estimates. |
| Fields and other land use | 40 mapped source polygons become 161 exact compatibility pieces after excluding maintained surfaces, water and building footprints. Parts of one field share one display colour. Seasonal crops are generic appearance. |
| Drainage | Five open-watercourse centrelines retained as context. Channel banks, trench profiles and water heights are not invented. All 56 existing national water polygons retain their source geometry and levels. |
| Railway and power | 11 railway segments, two power lines and 11 explicitly mapped supports. No additional railway masts, unverified bridge decks or towers at arbitrary line bends. |
| Forest and rough | The same measured 2021 canopy fields, updated with reviewed playing, path and roof exclusions. No invented stems or current clearing claims; an unsupported clearing polygon was rejected during review. |
| Practice facilities | Existing range, shelter, practice green, bunker, targets, parking and observed paths remain available. This pass does not claim a complete small-object inventory. |

The clubhouse roof mesh covers 99.47% of its observed roof envelope; 96% of
502 selected interior first returns have local planar support. These are
source correspondence checks, not an independent architectural survey.
Source roof heights remain absolute RH2000. Walls descend to the terrain only
along supported perimeter segments. Six low, small or complicated roof
candidates remain withheld. Rendered roofs retain source noise near some edges;
façades, windows, terraces and other architectural details still need refinement.

The native terrain is unchanged: all 16,785,409 samples, 341 terrain tiles,
340 parent links, full 4,096 m extent and original shell remain retained. The
36 runtime source-reference checks show a maximum encoding residual of
0.002852 m, below the 0.005 m tolerance. This is encoding consistency, not
independent horizontal or vertical accuracy.

The model identity is
`0c8c249c5f782465278613508fd7d988fba55810f2f57c4946118826c69d809f`.
The projected routing model identity is
`b7112036c579b75fd324d794d7ea194a269e829b65e75f18a951be9d296c8693`.
The original terrain frame remains
`37b54e5fe18ad889e656639aa7fb4c5166899875029c72d6d624694b319c287f`.

Validation covers guarded source assembly, geometry and roof adoption, canopy
exclusions, all course packs, source manifests, the hole-source planner,
production build, application isolation and renderer compilation. Full test
execution encountered CPU-load timeouts; the affected cases passed on a focused
rerun with a longer timeout. No source assertions were disabled. The Windows
inline-helper comparison now ignores Git/editor line-ending differences.

Desktop software WebGL2 captures cover hole 1's tee, hole 9's green and
clubhouse, and overhead views of holes 12 and 17. The phone-size check exercises
automatic WebGL2 fallback. These prove sampled rendering/layout behaviour,
not native-device performance or WebGPU support. Reports and exact artifact
identities are retained in
[refinement evidence](../../tortunabuild/mapping/refinement-evidence.json).
The earlier desktop browser attempt was interrupted before boot; the retained
desktop report records the completed rerun.

Remaining work includes complete fairway/rough transitions, tee platforms on
holes 6 and 15, back platforms on holes 4 and 12, current tee-colour associations,
shadowed boundaries, architectural detail, small facilities and objects,
tree changes since 2021, independent controls and human source review.
`localhost:5174` serves this worktree; a server started in a different checkout
has that checkout's course assets.

See the [source ledger](../../geo_data/course-v2/tortuna/source-manifest.json),
[assembly review](../../tortunabuild/mapping/assembly-review.json),
[building review](../../tortunabuild/mapping/building-roof-review.json),
[environment review](../../tortunabuild/mapping/environment-review.json) and
[rebuild instructions](../../tortunabuild/README.md).
