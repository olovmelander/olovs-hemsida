# Spellinje: shot planning and clearance

The old caddie projected the selected tee perpendicularly onto the authored
centreline, then measured club carry along that polyline. This produced the
sideways connector and could put the target outside the fairway. A carry is the
distance of one shot, not the sum of legs around a dogleg.

The planner now searches a directed graph of landing areas inside the current
hole's fairway and green polygons. The authored route supplies forward progress.
Each edge represents one straight shot. The cost considers landing clearance,
dispersion relative to the landing area's interior clearance, club distance and
the remaining shots to the green. This
checks the next approach as well as the initial drive. The same planned shots
drive the 3D guide, minimap and target labels. Changing tees or the bag replans.
The normal search keeps central candidates; when it fails, a second search
also covers the fairway edges to look for narrower openings. Candidate geometry
and segment visibility are cached across tee and club changes.

Tree crowns and buildings exclude shots; water and bunkers exclude landings but
can be carried. Terrain is checked against a nominal flight envelope. A blocked
or unavailable route has no aim target and shows an explanatory status. A finite
candidate search can fail to find a route that a human could play: this status
means no route was found, not proof that the hole is impossible.

## What TrackMan documents

TrackMan's [TPS 10.2 feature documentation](https://support.trackmangolf.com/hc/en-us/articles/41226724942363-General-New-Features-in-TPS-10-2)
says its aim adapts to the selected club using Map My Bag. Its Aim Out feature
redirects toward the fairway when an obstacle blocks play, including obstacles
that may be off screen. If it finds no alternative, it keeps the original target.
The [release notes](https://support.trackmangolf.com/hc/en-us/articles/35722568408603--Release-Notes-TPS)
also describe personalized dispersion circles. These pages describe behavior;
they do not disclose the pathfinding algorithm, scoring weights or collision
representation. This implementation does not claim to reproduce those internals.

## How game navigation relates

[Unreal's navigation documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/basic-navigation-in-unreal-engine)
describes a navigation mesh with polygon costs and a search for a low-cost route.
That is useful for characters moving over ground. For golf, use landing regions
as nodes and possible shots as edges, because a ball may fly over water and must
not turn at an arbitrary navigation waypoint. This is the design inference used
here, not a claim about a particular golf game's proprietary code.

[Unreal's projectile prediction API](https://dev.epicgames.com/documentation/unreal-engine/BlueprintAPI/Game/PredictProjectilePath_Advanced)
checks collisions along a gravity-driven flight arc. A future physics-based
planner could validate candidate shots against the game's actual launch, spin,
wind, bounce and roll model. The current caddie uses a conservative planning
envelope and treats tree crowns as blocked in plan; it does not recommend
speculative shots over trees.

## Scope of the guarantee

Clearance is relative to the supplied course surfaces, obstacle bounds and
nominal terrain envelope. It is not a guarantee that a player's real shot lands
in the fairway. Dispersion is a heuristic scoring term, not measured probability;
the display should not imply that an entire ellipse is guaranteed safe. Missing
objects, unmodeled obstacles, wind and actual ball flight remain outside that
guarantee. No unchecked fallback should be labeled playable.

## Validation (2026-09-13)

The browser audit exercised all 108 Upsala tee positions against 143,092 rendered
tree instances. It found 102 playable routes and no invalid displayed segments
or landings. The reported hole 1, 7 and 11 views all have clear routes. Six tee
positions return no recommendation: hole 5 tee 2, hole 6 tees 4–6, hole 7 tee 1,
and hole 17 tee 1 (tee numbers are positions in the six-button selector).
The hole 6 and 17 origins themselves intersect the conservative obstacle bounds;
the other two searches also fail after the denser candidate retry. Resolving
those cases requires reviewing the represented obstacles/tee layout or adding
a validated ball-flight model, rather than bypassing clearance checks.

The audit also checks tee changes, bag edits, toggles and blocked-route status.
The slowest planning call in the final run was 93 ms, including the dense retry;
most subsequent tee changes used cached geometry and visibility and took 1–3 ms.
Evidence is in `output/spellinje-final/audit.json` and the three accompanying
screenshots. Run `BANVY_GPU=1 node tools/check-spellinje.mjs http://127.0.0.1:5173`
against the development server to repeat it. Focused routing/caddie/geometry
tests and `npm --prefix apps/golf run build` passed.

## Validation on Upsala, 2026-09-13

The focused suite passes 60 tests across caddie, routing, rangefinder, GPS frames
and tree bounds. The production build passes. The live WebGPU audit of all 108
tee selections with the default bag finds 102 playable routes, with no failed
landing or segment checks among recommendations. The reported holes 1, 7 and 11
pass from tee selection 2; screenshots are in `output/spellinje-verified/`.

Six selections return no recommendation even after a denser candidate search:

| Hole | Tee selection (1–6, as displayed left to right) | Observed limitation |
| --- | --- | --- |
| 5 | 2 | No connected route found within the bag and clearance constraints |
| 6 | 4, 5, 6 | Tee lies inside a conservative rendered crown footprint plus clearance |
| 7 | 1 | No connected route found within the bag and clearance constraints |
| 17 | 1 | Tee lies inside a conservative rendered crown footprint plus clearance |

These are explicit no-route results, not claims that the real holes are
unplayable. Full diagnostics are in `output/spellinje-verified/audit.json`.
