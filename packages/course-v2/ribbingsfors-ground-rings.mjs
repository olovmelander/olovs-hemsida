/* Ribbingsfors' rings on the standard topology (standard-ground-rings.mjs):
   1 m over the central 4,096 m -- the nine, the manor, Skagersvik and the
   near shore of Skagern -- then 2, 4 and 8 m rings and the 16, 32 and 64 m
   shell to a 16 km root, every level cut from Lantmäteriet's Markhöjdmodell.

   Until 2026-09-11 this ground was a FIXED FRONTIER: the 64 published 1 m
   tiles of the reviewed 2,048 m window inside a legacy world cut from the
   same laser item, with a 72 m height blend at the edge. Those 64 tiles sit
   in the middle of the standard's sixteen-wide level (columns and rows 4-11)
   and are carried across byte for byte.

   FRAME_ORIGIN is the centre of the reviewed window in
   ribbingsfors-ground-graph.mjs, which is also the grid-authored pack's own
   origin (E 448975.5, N 6536024.5). The two must not be edited apart.

   The published window came from item 653_44 alone; the rings reach the
   neighbouring squares. Skagern's open basin west of the course reads as a
   laser-flat plate at 69.35 m RH 2000 and is tiled -- it is an inland lake,
   not open sea -- so no sea fill is declared and every sample must be finite. */
import { RIBBINGSFORS_GROUND_GRAPH_CONFIG } from './ribbingsfors-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: RIBBINGSFORS_GROUND_GRAPH_CONFIG.originEasting + 1024,
  northing: RIBBINGSFORS_GROUND_GRAPH_CONFIG.originNorthing - 1024,
});

export const RIBBINGSFORS_GROUND_RINGS = standardGroundRings({
  groundId: 'ribbingsfors',
  courseSlugs: ['ribbingsfors'],
  courseModels: {
    /* Only the three nine-hole tee totals are official; the per-hole rows are
       provisional (dossier §3), which the fixed-frontier compiler published
       as `strokeIndexStatus: 'unverified'` at accuracy tier D. The rings keep
       both. */
    ribbingsfors: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'unverified', accuracyTier: 'D' },
  },
  centre: FRAME_ORIGIN,
  /* The course stands 63-80 m RH 2000 beside Skagern at 69.3 m; the 16 km
     square reaches Gullspångsälven's valley below the lake's outlet at ~67 m
     and the Tiveden edge to the south-east, whose ridges here stay well under
     two hundred metres. The band is deliberately wide -- it is a gate on a
     wrong item, a nodata plane or a unit slip, not on the terrain -- and the
     acquire run's own per-level extremes replace this note. */
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 300, requireEverySampleFinite: true },
});
