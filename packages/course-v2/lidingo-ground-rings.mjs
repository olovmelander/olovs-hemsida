/* Continuous Lidingö terrain on the retained EPSG:3006 sample lattice.
 * Each finer window covers whole parent tiles. LOD0 stays byte-identical;
 * the surrounding 4/8/16 km windows come from Markhöjdmodell, not extrapolation.
 */
import { LIDINGO_GROUND_GRAPH_CONFIG as CORE } from './lidingo-ground-graph.mjs';

const centre = { easting: CORE.originEasting + 1024, northing: CORE.originNorthing - 1024 };
const level = (lod, spacing, side, halfSpan, scale, factor, subsample = 1) => Object.freeze({
  lod, sampleSpacingMetres: spacing, tilesPerSide: side, heightScaleMetres: scale,
  originEasting: centre.easting - halfSpan, originNorthing: centre.northing + halfSpan,
  source: Object.freeze({ kind: lod === 0 ? 'published-and-dtm' : 'dtm', factor, subsample }),
});

export const LIDINGO_GROUND_RINGS = Object.freeze({
  groundId: 'lidingo', courseSlugs: Object.freeze(['lidingo']),
  courseModels: Object.freeze({ lidingo: Object.freeze({
    migration: 'course-model.epsg3006.json', strokeIndexStatus: 'verified',
  }) }),
  terrainSourceIds: Object.freeze(['terrain-lm-1m']),
  tileSegments: 256,
  dtm: Object.freeze({ collection: 'dtm-cog', itemMetres: 10000,
    hrefTemplate: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif' }),
  levels: Object.freeze([
    level(0, 1, 8, 1024, 0.01, 1),
    level(1, 2, 8, 2048, 0.02, 1, 2),
    level(2, 4, 8, 4096, 0.04, 4),
    level(3, 8, 8, 8192, 0.08, 8),
    level(4, 16, 4, 8192, 0.16, 16),
    level(5, 32, 2, 8192, 0.16, 32),
    level(6, 64, 1, 8192, 0.16, 32, 2),
  ]),
  // The retained 8 km vista measures 0.05–67.07 m RH2000. This wider
  // plausibility band allows the expanded Stockholm/Täby surroundings.
  // No sea fill: missing samples must be investigated, never painted as water.
  coverageGate: Object.freeze({ minimumHeightRH2000: -5,
    maximumHeightRH2000: 150, requireEverySampleFinite: true }),
});
