import { CircleGeometry, CylinderGeometry, Uint32BufferAttribute } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The existing hero trunk: a twelve-segment shaft, root flare and top cap.
 * Keep each primitive's UVs so the bark material can wrap around the trunk.
 * The crown merger in main.js deliberately only carries positions/normals;
 * using it here discarded the bark coordinates, leaving a constant sample.
 * Vertex order, normals, triangles and dimensions stay identical to that mesh.
 */
export function createHeroTrunkGeometry(r0, r1, h) {
  const shaft = new CylinderGeometry(r0, r1, h, 12, 1, true);
  shaft.translate(0, h / 2, 0);
  const flare = new CylinderGeometry(r1, r1 * 1.7, 0.6, 12, 1, true);
  flare.translate(0, 0.3, 0);
  const cap = new CircleGeometry(r0, 12);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, h, 0);

  const geometry = mergeGeometries([flare, shaft, cap]);
  flare.dispose(); shaft.dispose(); cap.dispose();
  if (!geometry) throw new Error('Hero trunk primitives could not be merged');
  // The previous merger always used Uint32 indices; preserve that buffer too.
  geometry.setIndex(new Uint32BufferAttribute(geometry.index.array, 1));
  return geometry;
}
