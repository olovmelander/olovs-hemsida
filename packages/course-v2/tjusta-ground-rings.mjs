/* Tjusta Golfklubb standard 7-LOD ring topology (standard-ground-rings.mjs).
 *
 * One 469-tile / 16,384 m ground for the club's single 18-hole routing
 * (`tjusta`). All 7 levels (1 m .. 64 m) touch exactly four Lantmäteriet 10 km
 * DTM COGs: 660_66, 660_67, 661_66, 661_67.
 *
 * FRAME_ORIGIN is the centre of the 4,096 m LOD0 lattice (E 669130.5, N 6611250.5)
 * and matches tjusta-ground-graph.mjs exactly. */
import { TJUSTA_GROUND_GRAPH_CONFIG } from './tjusta-ground-graph.mjs';
import { standardGroundRings } from './standard-ground-rings.mjs';

const FRAME_ORIGIN = Object.freeze({
  easting: TJUSTA_GROUND_GRAPH_CONFIG.originEasting + 2048,
  northing: TJUSTA_GROUND_GRAPH_CONFIG.originNorthing - 2048,
});

export const TJUSTA_GROUND_RINGS = standardGroundRings({
  groundId: 'tjusta',
  courseSlugs: ['tjusta'],
  courseModels: {
    tjusta: {
      migration: 'course-model.epsg3006.json',
      strokeIndexStatus: 'unverified',
      accuracyTier: 'unrated',
    },
  },
  centre: FRAME_ORIGIN,
  holeTileBufferMetres: 90,
  terrainSourceIds: ['terrain-lm-1m'],
  coverageGate: { minimumHeightRH2000: -5, maximumHeightRH2000: 150, requireEverySampleFinite: true },
  notes: 'Tjusta Gård, Rosersberg (Sigtuna), south-east of Arlanda; crosses E=670,000 and N=6,610,000 DTM item boundaries.',
});
