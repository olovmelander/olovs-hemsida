/* The CHMv2 reader is the general COG reader; it grew Float32 samples, the
   floating-point predictor and overview levels when the Lantmäteriet DTM
   needed them, and lives in ../cog/. Kept here so the CHMv2 tools and their
   tests keep their import path. */
export { openCog, parseTiffHeader, httpRange, basicAuthorization } from '../cog/cog-reader.mjs';
