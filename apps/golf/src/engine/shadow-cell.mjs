/* Where the snapped shadow box stands, as whole texels of the shadow map in the
   light's own basis (right, up, and the sun direction d).

   The box is placed from these integers and not from the float target alone:
   OrbitControls re-clamps its target every update, which flips the last bits
   of world-scale coordinates (±1e-13 m), and a light moved by that much still
   counts as moved. Keyed on the cell, the light stays bit-identical at rest,
   so the on-demand shadow pass is skipped as intended. `iw` quantises the
   depth along the sun in the same texel; the 200..2400 m near/far range has
   far more slack than one texel. */
export function shadowSnapCell(t, right, up, d, texel) {
  const u = t.x * right.x + t.y * right.y + t.z * right.z;
  const v = t.x * up.x + t.y * up.y + t.z * up.z;
  const w = t.x * d.x + t.y * d.y + t.z * d.z;
  const iu = Math.round(u / texel), iv = Math.round(v / texel), iw = Math.round(w / texel);
  return { iu, iv, iw, ox: iu * texel - u, oy: iv * texel - v };
}

/* True when the placement described by (basis version, texel, cell) is the one
   already applied, and records it otherwise. */
export function sameShadowCell(state, version, texel, cell) {
  if (state.version === version && state.texel === texel && state.iu === cell.iu && state.iv === cell.iv && state.iw === cell.iw) return true;
  state.version = version; state.texel = texel; state.iu = cell.iu; state.iv = cell.iv; state.iw = cell.iw;
  return false;
}
