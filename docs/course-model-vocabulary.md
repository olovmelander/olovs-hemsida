# Course geometry and runtime vocabulary

Use the [v2 course runbook](v2-course-runbook.md) for the complete acquisition,
review, build and release workflow. This companion describes the data the
current implementation consumes, checked against the code on 2026-09-07. It
distinguishes recorded geography, migration inputs and rendering estimates so
that adding a field does not accidentally make an unsupported accuracy claim.

## Two contracts: the legacy model and the v2 ground graph

`<build>/course-model.json` remains the source for a course's legacy page
`GEODATA` and the GPK1 pack's `vec` stream. The page and pack must agree; use the
pack checks in the runbook after rebuilding. The fields below describe that
model, which the [app](../apps/golf/src/main.js) still uses for routing, materials
and objects alongside v2 terrain. Updating this JSON alone does not publish a
new v2 terrain, vegetation or surface generation.

V2 separates the **physical ground** from its **playable courses**. A ground
owns terrain, surfaces, object and stand tiles in one spatial frame; each course
owns its routing and card and references that ground. Resolve the current
[v2 index](../apps/golf/public/courses/v2-index.json), course manifest and ground
manifest instead of copying a historical hash from a document. The
[manifest validators](../packages/course-v2/schema.mjs) and
[asset-graph verifier](../packages/course-v2/graph-node.mjs) define that contract.
Only layers actually referenced and loaded by the graph are v2 runtime layers.
A class supported by the schema is not proof that its geometry has been mapped,
published or given a renderer.

For shared grounds, such as Upsala Stora and Mellanbanan, a physical footprint
must appear once in each rendered course view. It changes ownership between
played surfaces and sibling-course scenery; it must not become two overlapping
surfaces. See [Upsala's shared-ground integration](../upsalabuild/ground-mapping.mjs)
and the [nine-hole model builder](../tools/build-nine.mjs).

## Coordinates and evidence boundaries

The legacy frame uses `origin {lat, lon}`, `mPerLat` and `mPerLon`, with local
metres `[x,z]`: east is `+x`, north is `-z`. Preserve the exact existing frame
when updating a course. Legacy metres-per-degree coordinates are not identical
to SWEREF grid offsets; the app's
[geodetic bridge](../apps/golf/src/engine/geodetic-frame.mjs) handles their scale
and orientation difference.

Canonical v2 geography uses SWEREF 99 TM horizontal coordinates (`EPSG:3006`)
and RH 2000 heights (`EPSG:5613`), together `EPSG:5845`. A routing point is
`[easting,northing,heightRH2000]`. The
[canonical frame functions](../packages/course-geo/frame.mjs) define the world
conversion and require approved origins for the approval-gated path. A
provisional migration origin does not become surveyed by passing an integrity
test. `seaLevel` (historically `lakeLevel` in an older model) is a water/rendering
parameter, not a replacement for the height datum.

Keep source geometries, pixel traces, raster extents, old shapes used by
assertions and detailed survey attributes in the build's evidence directory.
Copy only accepted **local geometry** and an explicit metadata whitelist into
the legacy model. The [migration collector](../packages/course-geo/migration.mjs)
walks nested numeric pairs: pairs beneath a recognized geometry key may be
treated as local coordinates, and unclassified pairs fail. An EPSG ring nested
inside `evidence` can therefore be transformed a second time. A harmless-looking
spread such as `{ ...reviewRecord }` is not a safe metadata boundary.

[Upsala's municipal importer](../tools/apply-upsala-municipal-objects.mjs) shows
the pattern: assert the source frame and original geometry, validate every
decision before applying changes, copy a whitelist, retain source hashes and
the evidence path, and leave source-coordinate arrays behind. The final
`3006`-suffix key scan in `ground-mapping.mjs` is an additional guard, not a
general guarantee that every nested array is safe.

## Played holes: `holes[]`

| Field | Current meaning and use |
|---|---|
| `n`, `par`, `idx`, `t[]` | Hole number, par, stroke index and card distances per tee. Card distances do not measure the shape or daily position of a physical tee. |
| `line[]` | Routed centreline used by the camera, flyover, distance displays and play bounds. Its endpoints are routing references, not automatically surveyed pad or green centres. |
| `pin` | Flag/cup position. Keep a provisional position labelled as such; a green outline does not identify today's cup. |
| `green.ring`, `green.c` | Putting-surface boundary and centre used by the surface atlas, fringe, placement exclusions and height probes. A planimetric trace does not establish green contours. |
| `fairway.rings[]` | Separate fairway polygons. Preserve genuine gaps and splits; a par 3 does not require an invented fairway corridor. |
| `tees.pads[].ring` | Physical teeing-ground footprints. Several card tees may share a pad, and a pad may currently have no marker on it. |
| `tees.pads[].preserveTerrain` | With `true`, skips the legacy tee flattening treatment and pad smoothing. Use for reviewed mowing footprints whose surface elevation was not measured independently. |
| `tees.inferPads` | With `false`, disables automatic synthetic decks at uncovered nominal markers. Adopt this for a ground whose physical tee inventory is being mapped explicitly. |
| `tees.marks[] {c,b,m}` | Nominal card-tee references used by routing/UI and, under the legacy object policy, marker-pair rendering. Bearings are derived from the route. These are distinct from measured daily marker positions. |
| `bunkers[].ring` | Exposed sand outline used by the atlas and visual probes. It does not establish sand depth, bunker floor shape, rakes or drainage. |
| `elev {tee,green,rise}` | Card elevation summary. |
| `tiers`, `name`, `note`, `shape` | Card/display descriptions. Legacy terrain treatments can also use `tiers`; do not add tiers as decoration to an unmeasured green. |

The [tee helper](../apps/golf/src/engine/tee-pads.mjs) retains the old synthetic
deck fallback for models that have not opted out. Synthetic pads carry
`prov: 'synth'`. The [reviewed tee importer](../tools/apply-reviewed-tee-surfaces.mjs)
keeps accepted outlines and unresolved retained originals distinct. Its polygon
centroid is explicitly not a tee-marker measurement.

`infra.preserveMappedBoundaries: true` keeps adopted boundaries intact through
[mown-edge and shore smoothing](../apps/golf/src/engine/ring-smoothing.mjs), uses
exact boundary handling in the surface meshes and removes the historical
0.5 m sand expansion in the shared surface extractor. It does not certify
height accuracy or turn generated fringes and semi-rough collars into mapped
features. The atlas still derives a 3.2 m green fringe, 2.2 m tee fringe and
4.5 m fairway semi-rough band from their owner polygons. Review those separately
when claiming measured mowing classes.

## Water and drainage

`water[] {ring,level,isLake,isSea,area}` supplies water footprints and surface
levels. Lake/sea flags select shore and coastline treatments; `area` is used
for ordering. A terrain water plate is evidence of a surface level, never
bathymetry. Preserve islands and check the representation supports their holes
before adopting a more complex shoreline.

`streams[] {line,w}` participates in existing channel/water rendering and
terrain treatments. Adding an uncertain ditch here can carve a channel and
create implied water. The new `infra.drainage[] {id,kind,line,...}` records a
mapped centreline with `widthM`, `depthM` and `waterPermanence` still unknown;
it is currently GIS/model evidence, with **no automatic channel carving or new
water body**. Duplicate survey observations can corroborate an existing stream
without replacing its continuous geometry. Follow the municipal importer rather
than importing every line as another stream.

`marking[] {c,pts}` supplies penalty/OB stake positions by colour (`r`, `y`,
`w`); submerged stakes can be dropped by the renderer. Local-rule text or a
penalty-area boundary alone does not establish the position of every stake.

## Infrastructure: `infra`

| Field | Current meaning and use |
|---|---|
| `buildings[] {ring,h,kind,name,amenity,id}` | Footprints and building attributes. Clubhouse tags/names select clubhouse styling; `kind: 'roof'` represents a canopy. Source footprint accuracy does not establish roof height, materials or use. |
| `roads[] {line,kind,surface,lanes,oneway,name}` | Road ribbons and atlas bands; the existing renderer uses class-based widths. Trunk roads may receive edge markings. |
| `tracks[]`, `paths[] {line,kind,surface}` | Centreline ribbons and surface bands, also with class-based widths. A surveyed road-edge polyline is a boundary, not a centreline ready to place here. |
| `parking[] {ring,surface,cars,vehicles}` | Parking footprints. Explicit asphalt/paved tags select asphalt; the fallback is gravel. Legacy cars are suppressed by `cars: false` or the mapped object policy; `vehicles: 'motorhome'` is an authored facility cue. |
| `bridges[] {id,ring,line,...}` | Confirmed deck footprints and end axes. Both imagery-reviewed and municipal survey sources are supported by the current footprint renderer. |
| `drainage[] {id,kind,line,...}` | Surveyed ditch observations; no extra terrain or water treatment while dimensions remain unknown. |
| `barriers[] {id,kind,line,...}` | Recorded fence, hedge, wall, screen and retaining-wall lines. Current municipal records are available in the model/GIS; unknown height, width, material and species do not cause 3D extrusions. |
| `mappedPoints[] {id,c,tags,...}` | Explicit point identities. The current selector renders fountain, gate, mast and flagpole types; it does not render every OSM point type or duplicate tree points. |
| `landuse[] {ring,kind}` | Fields, gardens and other land-use tints and placement constraints. |
| `power {lines,towers,poles}`, `railway[]`, `piers[]`, `basins[]`, `reserves[]`, `farB[]` | Surrounding infrastructure. With mapped object placement, support points must be explicit towers/poles; a bend in a power line is not a new tower. |

`infra.bridgePlacement: 'mapped-only'` disables bridges inferred from path/water
intersections. Mapped decks use their supplied horizontal polygon and axis;
their current renderer samples the visible terrain at deck ends/approaches and
uses estimated thickness and neutral material. Unknown rails remain
undetailed. A surveyed deck outline is therefore precise horizontal evidence,
not a complete as-built bridge model. Review the approach connections too.

`infra.objectPlacement: 'mapped-only'` suppresses several historical inferred
objects, including nominal tee-marker pairs, automatic parking cars, decorative
furniture and inferred residential buildings. It also selects the explicit
point-object and power-support paths. It is not a blanket promise that every
authored facility, building dimension or distant vegetation instance is
measured: inspect the active renderer and the evidence for each object class.
Nominal tee references remain usable by the camera and HUD.

## Scenery and exact facility polygons: `scenery`

| Field | Current meaning and use |
|---|---|
| `greens[]`, `fairways[]`, `tees[]`, `grass[]`, `range[]` | Ground outside the selected routing, such as a sibling course or practice area. The shared extractor assigns GREEN, FAIRWAY, TEE, SEMI and FAIRWAY respectively. Greens/range also affect play bounds. |
| `practiceGreens[]` | Named practice greens for the practice marker; otherwise a legacy proximity heuristic may select nearby scenery greens. |
| `bunkers[]` | Scenery/practice sand polygons. |
| `mappedFeatures[]` | Individually identified facility surfaces/objects with exact polygon rings; see below. |
| `rangeFacilities {bays,bayPitch,nets,netHeight}` | Authored range layout for mats/dividers/kerb and net structures. Dimensions require their own evidence. Do not leave inferred facilities duplicating individually mapped equipment. |
| `cartPark {line,count}` | Authored cart fleet layout; its existence/count is not implied by a parking polygon. |
| `sourceFeatures[]`, `retiredSourceFeatures[]` | Build/review ownership and provenance records. These do not independently add a second visible copy of the surface. |
| `woodlandContext` | Compact coarse leaf-type raster used as a rendering prior, described below. |

A `mappedFeatures` item carries `id`, `kind`, `rings`, material and compact
provenance. `rings` is **one complete polygon**: `[outerRing, holeRing, ...]`.
Do not flatten holes into independent filled rings; an island inside a practice
green must remain excluded from turf in both the legacy atlas and v2 surface
compilation. Separate disconnected polygons need separate feature records or a
compiler representation that explicitly supports them.

The [shared surface extractor](../apps/golf/src/engine/surface-features.mjs)
and the app's facility renderer currently use these mapped feature semantics:

| `kind` | Surface/object handling |
|---|---|
| `practice_green` | GREEN, including interior exclusions. |
| `range_bunker`, `practice_bunker` | SAND, including interior exclusions. |
| `range_tee_pad` | TEE in the atlas when `material: 'unverified-turf-surface'`; hardstanding/mat platforms follow their separate renderer treatment. |
| `range_mat` | Individual exact mat footprint; a small renderer lift is an estimate of separation, not measured mat thickness. |
| `range_target_surface` | Mapped target surface; does not imply target height, flags or other equipment. |
| `paved_path` | Exact hard-surface polygon. Only `material: 'asphalt'` selects ASPHALT. An unknown material uses the generic gravel-coloured display; the name does not prove asphalt or gravel composition. |

For a path reconstructed from municipal edges, establish connected boundaries,
review the closing ends against imagery and preserve any islands. Retire or
correct the corresponding old centreline only after asserting its exact old
geometry; otherwise both representations paint the ground. The
[Upsala practice-path importer](../tools/apply-upsala-practice-path.mjs) is the
current example. Do not convert an arbitrary set of nearby road edges into a
filled polygon automatically.

## Vegetation: areas, crowns, stems and species are different evidence

Legacy `veg.forest[]`, `wood[]` and `scrub[]` supply ground classes and planter
constraints; `wetland[]` supplies wet ground, and `sand[]` supplies sand. Contrary
to older versions of this document, `veg.rock[]` is recognized as ROCK by the
shared surface extractor, although slope shading is another independent visual
effect. `cover` is the satellite tree-cover raster used by the GPK1 planter.
These area sources do not describe a surveyed individual-tree population.

V2 individual trees use the
[object registry](../packages/course-v2/object-registry.mjs) and
[vegetation object compiler](../packages/course-v2/vegetation/object-compiler.mjs),
with stable identity, projected position, terrain-sampled base height,
height/radius, source, accuracy, review status, truth zone and placement method.
`derived-lidar` positions are crown centres, not surveyed stems. Heading can be
deterministic rendering variation rather than a measurement. Dense forest uses
stand fields; do not count stand fill as additional surveyed individual trees.

Municipal tree points remain separate observations until the correspondence to
existing crowns has been reviewed. A nearby point may be the same tree, a
different tree or a record from another date. Do not append them to the crown
population or move a crown to its nearest point without identity evidence.
Broadleaf/conifer labels are group observations, not botanical species.

[Woodland context](../apps/golf/src/engine/woodland-context.mjs) uses coarse
conifer-dominant/broadleaf-dominant/unresolved cells to choose a plausible visual
family while preserving the tree placement and species status. It does not
establish the species of a particular tree. The current strict object registry
does not accept the `speciesPrior`/`speciesBasis` fields described in older
implementation proposals; consult the executable validator before adding them.

The registry currently also requires a valid capture date and finite dimensions,
base height and accuracy values. A municipal database registration date is not
a capture date. Keep incomplete observations in the evidence/GIS layer until
the missing facts or a reviewed schema extension exist; do not fill required
fields with invented measurements merely to pass validation.

## Surroundings and course-specific appearance

`surround.clearfells[]`, `yard`, `hayfields` and `shallows[]` describe clear-fells,
yards, fields and silt margins. Some legacy clear-fell vegetation and stumps are
procedural rendering choices. These fields are absent on many courses.

`engine/scenery/<slug>.js` provides appearance rules such as `clubhouse`,
`species`, `armour`, `reedbed`, `clearings`, `farRing` and `buildingLooks`.
Treat colour, storey/roof estimates and a planter mix separately from measured
geography. For example, [Upsala's module](../apps/golf/src/engine/scenery/upsala.js)
styles the clubhouse; the accepted footprint comes from the build data.

## Provenance is not unused data

Keep source IDs, hashes, acquisition and observation dates, accuracy meaning,
review decisions and unresolved limitations even when a shader does not read
them. `prov` is not universally ignored: tee smoothing checks `prov: 'synth'`,
and parking rendering has an exact-boundary branch for imagery-reviewed data.
Other fields such as `notes`, `conf`, `lineSrc`, `teeSlide`, `teePadDist` and
`card.provisional` can remain build/review metadata without directly generating
a mesh. Verify each consumer before changing their meaning.

A source's stated precision, a trace's interpretation uncertainty and the
whole application's absolute accuracy are different quantities. Record them
separately, keep unknown values unknown, and use the runbook's evidence,
topology, browser and backend checks before accepting a more detailed model.
