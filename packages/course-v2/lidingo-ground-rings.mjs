/* Lidingö's rings on the standard topology (standard-ground-rings.mjs): 1 m
   over the central 4,096 m, then 2, 4 and 8 m rings and the 16, 32 and 64 m
   shell to a 16 km root, every level cut from Lantmäteriet's Markhöjdmodell.
   The retained EPSG:3006 sample lattice of lidingo-ground-graph.mjs is the
   middle of the 1 m level (columns and rows 4-11), so the published course
   tiles stay byte-identical and the surrounding windows are measured, never
   extrapolated. */
import { LIDINGO_GROUND_GRAPH_CONFIG as CORE } from './lidingo-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

export const LIDINGO_GROUND_RINGS = standardGroundRings({
  groundId: 'lidingo',
  courseSlugs: ['lidingo'],
  courseModels: { lidingo: { migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified' } },
  terrainSourceIds: ['terrain-lm-1m'],
  centre: { easting: CORE.originEasting + 1024, northing: CORE.originNorthing - 1024 },
  /* The retained 8 km vista measures 0.05-67.07 m RH 2000. This wider
     plausibility band allows the expanded Stockholm/Täby surroundings.
     Acquisition 34319473678 measured -10.157..72.725 m on LOD3; retain those
     source depressions rather than clamping them to sea level. No sea fill:
     missing samples must be investigated, never painted as water. */
  coverageGate: { minimumHeightRH2000: -20, maximumHeightRH2000: 150, requireEverySampleFinite: true },
});
