import { LessDepth, LessEqualDepth } from 'three/webgpu';

/* A pond/lake/sea mesh is a flat sheet: separating its front and back faces
   submits an empty second pass. Keep DoubleSide visibility with one draw.
   Masked water combines sheets at different elevations in one geometry;
   retain its existing pass ordering until that case is separately verified. */
export function configureWaterRenderPasses(material, { mask = null } = {}) {
  material.forceSinglePass = mask === null;
  return material;
}

export const MEASURED_WATER_CLEARANCE_METRES = 0.06;

/* Measured sheets already have a world-space clearance above the DTM. An
   additional depth-space nudge can pull the ocean through foreground land.
   Even constant units are not a distance in metres: fixed depth loses
   precision at range, and float depth bias uses the triangle's largest
   depth exponent, not the fragment's. Long ocean triangles are especially
   vulnerable when they cross the near plane. Keep normal terrain occlusion
   for these sheets; retain the existing carved-lake policy elsewhere. */
export function configureWaterDepth(material, { measuredOnly = false, depthSign = -1 } = {}) {
  material.depthTest = true;
  // At long range a shallow buffer can quantize land and water to the same
  // value. Terrain wins that tie; a later transparent sheet must not flood it.
  // Three reverses this comparison together with the camera's depth direction.
  material.depthFunc = measuredOnly ? LessDepth : LessEqualDepth;
  material.polygonOffset = !measuredOnly;
  material.polygonOffsetFactor = measuredOnly ? 0 : depthSign;
  material.polygonOffsetUnits = measuredOnly ? 0 : depthSign * 2;
  return material;
}
