/* Reviewed finest-terrain windows, keyed by physical ground.

   Each entry restates the lattice the ground's compile config declares rather
   than importing every field from it, so acquisition and compilation are two
   independent statements of the reviewed window. A drift between them is
   caught by the compile driver, which reads this raster and asserts its own
   width, height and origin -- not by both ends moving together in silence. */
import { ANGSO_GROUND_GRAPH_CONFIG } from '../../course-v2/angso-ground-graph.mjs';
import { JOHANNESBERG_GROUND_GRAPH_CONFIG } from '../../course-v2/johannesberg-ground-graph.mjs';
import { NORRFALLSVIKEN_GROUND_GRAPH_CONFIG } from '../../course-v2/norrfallsviken-ground-graph.mjs';
import { UPSALA_GROUND_GRAPH_CONFIG } from '../../course-v2/upsala-ground-graph.mjs';

export const TERRAIN_WINDOW_SPECS = Object.freeze({
  angso: Object.freeze({
    sourceItemIds: ANGSO_GROUND_GRAPH_CONFIG.sourceItemIds,
    sampleSpacingMetres: 1,
    /* Sixteen tiles per side: the largest window here, and the smallest
       square that reaches both ends of a 2,167 m long course. */
    width: 4097,
    height: 4097,
    originEasting: 603617.5,
    originNorthing: 6607769.5,
    pixelEdgeWindow: ANGSO_GROUND_GRAPH_CONFIG.pixelEdgeWindow,
    plausibleHeightRangeRH2000: ANGSO_GROUND_GRAPH_CONFIG.plausibleHeightRangeRH2000,
  }),
  johannesberg: Object.freeze({
    sourceItemIds: JOHANNESBERG_GROUND_GRAPH_CONFIG.sourceItemIds,
    sampleSpacingMetres: 1,
    width: 2049,
    height: 2049,
    originEasting: 678403.5,
    originNorthing: 6626324.5,
    pixelEdgeWindow: JOHANNESBERG_GROUND_GRAPH_CONFIG.pixelEdgeWindow,
    plausibleHeightRangeRH2000: JOHANNESBERG_GROUND_GRAPH_CONFIG.plausibleHeightRangeRH2000,
  }),
  norrfallsviken: Object.freeze({
    /* The first SEASIDE window, and the second to cross a source seam:
       3,084 m of its width come from 698_67 and 1,012 m from 698_68, the
       coastal 7.5 km item. Both were captured in the same campaign, so the
       seam is one of file boundaries only. About a third of this window is
       the Gulf of Bothnia, which the height model carries as a flattened
       surface near zero rather than as nodata. */
    sourceItemIds: NORRFALLSVIKEN_GROUND_GRAPH_CONFIG.sourceItemIds,
    sampleSpacingMetres: 1,
    width: 4097,
    height: 4097,
    originEasting: 676915.5,
    originNorthing: 6989999.5,
    pixelEdgeWindow: NORRFALLSVIKEN_GROUND_GRAPH_CONFIG.pixelEdgeWindow,
    plausibleHeightRangeRH2000: NORRFALLSVIKEN_GROUND_GRAPH_CONFIG.plausibleHeightRangeRH2000,
  }),
  upsala: Object.freeze({
    /* The first window here that crosses a source seam: 880 m of it come from
       663_63 and 1,168 m from 663_64. Both are read at factor 1, so the seam
       is one of provenance and not of geometry. */
    sourceItemIds: UPSALA_GROUND_GRAPH_CONFIG.sourceItemIds,
    sampleSpacingMetres: 1,
    width: 2049,
    height: 2049,
    originEasting: 639119.5,
    originNorthing: 6637169.5,
    pixelEdgeWindow: UPSALA_GROUND_GRAPH_CONFIG.pixelEdgeWindow,
    plausibleHeightRangeRH2000: UPSALA_GROUND_GRAPH_CONFIG.plausibleHeightRangeRH2000,
  }),
});
