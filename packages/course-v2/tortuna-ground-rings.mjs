/* Tortuna's rings on the standard topology (standard-ground-rings.mjs): 1 m
   over the retained 4,096 m source window, 2 m over the same square, 4 m to
   8 km, and 8 m and coarser to a 16 km root, every level cut from
   Lantmäteriet's Markhöjdmodell.

   Tortuna was published as a 4 km, five-level PYRAMID (341 tiles, root
   4,096 m) by compile-tortuna-ground-graph.mjs before the standard existed.
   Its 1 m level is already the standard's -- sixteen tiles per side centred
   on the frame origin -- and so is its 2 m level, so the ring publish keeps
   all 256 course tiles byte for byte, under the ids they already have, and
   adds the rings outside them. The pyramid compiler refuses to run once the
   rings are live (ground-ring-publication-guard.mjs).

   FRAME_ORIGIN is the centre of the retained lattice in
   tortuna-ground-graph.mjs, which is also the grid-authored pack's own
   origin (E 597400.5, N 6614899.5). The two must not be edited apart. */
import { TORTUNA_GROUND_GRAPH_CONFIG } from './tortuna-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: TORTUNA_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: TORTUNA_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

export const TORTUNA_GROUND_RINGS = standardGroundRings({
  groundId: 'tortuna',
  courseSlugs: ['tortuna'],
  courseModels: {
    /* The club's current scorecard is pinned in the source manifest and
       tortunabuild/course.node-test.mjs gates par and index through the
       published pack; the pyramid published `strokeIndexStatus: 'verified'`
       from the model itself, and the rings keep it. */
    tortuna: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified', accuracyTier: 'unrated' },
  },
  centre: FRAME_ORIGIN,
  /* the pyramid listed each hole's finest tiles within 90 m of its line */
  holeTileBufferMetres: 90,
  /* MEASURED on the retained 4 km window: 16.318 to 54.417 m RH 2000 over
     all 16,785,409 samples (terrain-window.json), whose own reviewed band was
     -5..150. The 16 km square is the Västerås plain east of Mälaren: fields,
     Sagån's valley and the low moraine ridges, nothing near a hundred metres,
     so the same band is wide enough to be no gate on the data and narrow
     enough that a wrong item or a unit slip fails. */
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 150, requireEverySampleFinite: true },
});
