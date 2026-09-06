/* A pond/lake/sea mesh is a flat sheet: separating its front and back faces
   submits an empty second pass. Keep DoubleSide visibility with one draw.
   Masked water combines sheets at different elevations in one geometry;
   retain its existing pass ordering until that case is separately verified. */
export function configureWaterRenderPasses(material, { mask = null } = {}) {
  material.forceSinglePass = mask === null;
  return material;
}
