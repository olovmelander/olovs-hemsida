# Puttom production geometry interpretation

`model-plan.json` contains 25 volumes and accounts for all 17 inherited campus
building IDs exactly once. Run `prepare-model-plan.py` from the facilities folder
with the repository's orthophoto Python environment to reproduce it. The script
validates ID coverage, nondegenerate wall rings and plausible vertical order,
then writes the four-panel plan review to the ignored reference cache.

Coordinates are original EPSG:3006 east/north and RH2000 heights. Blender uses
origin E697365, N7025190, H44. Each volume has unit U along its ridge/length and
unit V perpendicular left. Wall and roof rings use corners (-U,-V), (+U,-V),
(+U,+V), (-U,+V). Length/width describe walls; roofLength/roofWidth include
overhang. A shed rises toward V+ by default. groundCornerH and minGroundH let
foundations continue below the surrounding sloped terrain.

The main clubhouse's model roof centre is approximately 4.04 m west and 0.63 m
north of the apparent orthophoto roof centre. This follows the measured ridge,
not an image registration shift. The source orthophoto remains untouched. The
main roof has a 20.6 by 13.1 m envelope, ridge H53.613 and regularized eaves H50.0.
The glazed south gable is U+, with windows returning along the last 4.5 m of
both long walls. Its photographed entrance facade faces V+ (east). Blue-grey
exposed base, white glazing frames, unequal upper/lower windows and a modest
door canopy distinguish it from the earlier block.

The shallow lower west roof uses only valid plane 2 at approximately 16 degrees;
the taller 29-degree plane in its search envelope is the main roof. The narrow
cross connector has no reliable separate laser surface. Its low gable is an
explicit photo estimate. Both connect to the long, separately measured west
wing. Connected wall faces should be omitted where volumes meet.

The range building uses two approximately 18-degree gables meeting at their
measured ridge intersection. Their rectangular volumes deliberately overlap;
the plan provides the final clipped surfaces in `roofSurfacePolygonsENH`,
`exteriorWallPolygonsENH` and `exteriorRoofSegmentsENH`. Both ridges terminate at
the measured junction. The concave inner corner uses an upper envelope/valley;
the convex outside corner uses a lower envelope/hip. The northwest quadrant
belongs to the north-running arm and southeast to the east-running arm. A union
of complete gable prisms incorrectly raises the outer corner by up to 1.1 m
against original laser support and creates two false exterior gables.

These triangles replace the complete rectangular roof geometry. Wall quads
remove edges inside the other arm and follow the same finished roof heights;
fascia segments retain only the outer roof perimeter. Validation checks that
roof triangles cover the complete union once, exposed wall lengths equal the
union perimeter, and finished roof heights agree with the original plane-support
hull samples. Ground hitting mats and paving retain their orthophoto positions.

Härbre's dominant steep roof supports give a 7.6 m roof span and 6.7 m wall span.
One extreme support corner was excluded. Its door/clock gable is U- (southwest),
and the small photographed side shelter is on V+ (northwest). The shelter roof
is an estimate; a sparse low laser plane southeast of the building belongs to a
different feature. Use horizontal logs, projecting corner joints, an upper double
window and the small door canopy from the official photographs.

The three maintenance roofs use original supporting planes. The small southeast
attachment's query plane belongs to the main hall and is excluded. That little
shelter, the dark north-courtyard roof, some neighbouring canopies and details
hidden by vegetation retain explicit estimates. Nearby western buildings have
descriptive names only; their function and club ownership are unverified.

Two unmatched inherited sheds (`trace-shed-c`, `trace-shed-d`) remain at their
existing approximate locations with restrained geometry. They are not silently
matched to unrelated newly observed roofs. Individual roof/canopy observations
are not a certified count of occupied buildings.

Public photographs guide geometry and colour only; their pixels are not runtime
textures. Official orthophoto and laser attribution: Lantmäteriet, processed,
CC BY 4.0. The evidence combines 2023 laser, 2024 orthophoto and dated photos;
the finished asset is an interpreted environment model, not a surveyed drawing.
