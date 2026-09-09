import { Box3, Vector3 } from 'three/webgpu';

/* All three mesh tiers can be reviewed/forced, even when the default tier
   is fixed by course zone. Wind moves crown vertices by at most 0.121 m in
   template space; include 0.16 m before applying the instance scale/yaw. */
export function treeTemplateBounds(geometries) {
  const box = new Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  return box.expandByScalar(0.16);
}

/** Union actual mesh bounds and every orientation of the impostor quad.
 * Called only at boot, using caller-owned temporaries for a large forest. */
export function includeTreeBounds(cellBox, templateBox, atlas, matrix, position, scaleXZ, scaleY,
  scratch = new Box3(), centre = new Vector3()) {
  cellBox.union(scratch.copy(templateBox).applyMatrix4(matrix));
  centre.copy(position);
  centre.y += atlas.centreY * scaleY;
  // Each half axis is <= radius * max(scale); cover the quad's corners too.
  const reach = Math.SQRT2 * atlas.radius * Math.max(scaleXZ, scaleY);
  scratch.min.copy(centre).addScalar(-reach);
  scratch.max.copy(centre).addScalar(reach);
  return cellBox.union(scratch);
}
