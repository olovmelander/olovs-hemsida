# Authored clubhouse facilities

`model-clubhouse.py` implements `build(ctx)` for the production Blender facility
scene. It uses the existing `model-reference.json` geometry in metres with
X east, Y north and Z = RH2000 − 25 m. It does not read the live Blender scene,
alter source observations or embed reference photo pixels.

The three retained building footprint rings and existing roof/wall shells remain
the structural baseline. Restaurant facade details, low-building glazing,
veranda and terrace details are authored geometry. The roof measurements remain
2021 evidence; the additional architecture is a photo-informed appearance model.

## Implemented appearance

| Facility | Authoring |
| --- | --- |
| Restaurant/reception | Round columns with collars, physically framed reception and upper glazing, door handles, panelled balcony with curved end returns and rail, timber floor/soffit, two blue retractable awnings with rollers and folding arms, clock, lanterns and side circular window. Roof details include panel seams, service-room door/seams/ladder, ventilator grills and housings, connecting duct, chimney courses/flashing and downpipes. |
| Lower pavilion | White vertical siding and corners, terrain-following base, courtyard windows/doors/clock, east-facing glazed veranda with posts, rail, deck and broad stair. The course-facing window rhythm is separate from the courtyard facade. Sparse reverse-side windows remain appearance estimates. |
| South annex | White siding, modest windows/doors and a small projecting glazed porch with entrance steps. |
| Courtyard terrace | Three timber levels, individual board relief, dark retaining skirt and supports, glass panels in dark balustrade frames, inter-level stairs/rails, west access stair and a small set of separate table/chair appearance props. |
| Courtyard edges | Retained putting-green kerb plus rope/stakes; west perimeter wall with an open entrance and two white pillars with dark bases/caps and plain circular plaques. |

The photo evidence is indexed in [web-reference.json](web-reference.json).
The strongest references are the July 2024 clubhouse aerials, Venuu reception,
balcony and terrace photos, the pavilion gallery photo and Holger Ellgaard's
2020 entrance/facade images. No photograph or protected club emblem is copied
into a material. The entrance plaques use simple unlettered geometry.

## Measurements and estimates

The baseline building rings and roof plate positions come from the retained
model-reference export. Restaurant balcony height follows its retained 33.55 m
RH2000 display datum. Terrace levels retain 33.55, 32.50 and 31.45 m RH2000.
Terrain sampling uses the root context's published 1 m ground data.

Facade frames, aperture sizes, siding width, columns, awning mechanism, rooftop
equipment details, veranda/porch dimensions, stair sections, furniture placement
and entrance gap/height are visual estimates. Exact historical B2/B3/B4 labels
are not assigned to the pavilion or annex without footprint corroboration.
The 2024 aerial determines the pavilion veranda's course-facing east elevation;
the older display's north-side veranda placement is replaced.

Furniture is sparse display dressing derived from visible terrace use, not an
assertion of permanent table/chair count or an occupied event. Green and road
polygons are not retraced by this module. Root integration owns terrain surfaces,
remaining site facilities, export and runtime placement.

The terrace facility ID is exactly `courtyard` for replacement of the previous
runtime terrace. The green kerb/rope parent disables vegetation exclusion so its
reference footprint does not erase the putting green. Pavilion and annex
vegetation-exclusion outlines insert only their actual veranda, porch and stair
extents into the relevant original facade edge. These authored outlines are
labelled as such; source rings in the model reference remain unchanged. They do
not use broad building bounding boxes.

## Verification

An independent CPU invocation using the exact production context's terrain data
completed with 42,092 authored triangles and 43,857 total triangles including
retained structural meshes. Every coordinate was finite, every triangle index
was in range and no degenerate triangle was found. The geometry is batched by
material, with transparent glass separated from opaque geometry.

Blender scene previews and exported GLB/runtime verification are performed by the
root integration. These checks establish a usable authored model, not a survey
of unphotographed elevations or independent confirmation of all 2026 site changes.
