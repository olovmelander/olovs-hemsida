/* Bro Hof Slott Golf Club standard 7-LOD ring topology (standard-ground-rings.mjs).
 *
 * One shared 469-tile / 16,384 m ground serving both Robert Trent Jones Jr.
 * championship routings: The Stadium Course (`bro-hof-stadium`) and The Castle
 * Course (`bro-hof-castle`). All 7 levels (1 m .. 64 m) touch exactly four
 * Lantmäteriet 10 km DTM COGs: 659_64, 659_65, 660_64, 660_65.
 *
 * FRAME_ORIGIN is the centre of the 4,096 m LOD0 lattice (E 649094.5, N 6598568.5)
 * and matches bro-hof-ground-graph.mjs exactly. */
import { BRO_HOF_GROUND_GRAPH_CONFIG } from './bro-hof-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: BRO_HOF_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: BRO_HOF_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

export const BRO_HOF_GROUND_RINGS = standardGroundRings({
  groundId: 'bro-hof',
  courseSlugs: ['bro-hof-stadium', 'bro-hof-castle'],
  courseModels: {
    'bro-hof-stadium': {
      migration: 'bro-hof-stadium.epsg3006.json',
      strokeIndexStatus: 'verified',
      accuracyTier: 'unrated',
    },
    'bro-hof-castle': {
      migration: 'bro-hof-castle.epsg3006.json',
      strokeIndexStatus: 'verified',
      accuracyTier: 'unrated',
    },
  },
  centre: FRAME_ORIGIN,
  holeTileBufferMetres: 90,
  terrainSourceIds: ['terrain-lm-1m'],
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 150, requireEverySampleFinite: true },
  notes: 'Shared Bro Hof Slott estate (Stadium + Castle + Puttingbanan + Lake Mälaren shore); crosses E=650,000 and N=6,600,000 DTM item boundaries.',
});
