import * as THREE from 'three/webgpu';
import { float, modelWorldMatrix, positionLocal, select, texture, vec2 } from 'three/tsl';
import { SEA_SHORE } from './coastal-water.mjs';

/* Surface-only laser data beneath verified sea is redundant visible geometry.
   Keep all CPU heights and mesh data; remove only covered low fragments. The
   shore inset and exact offshore cells are established by buildCoastalWater.
   No filtering/mipmaps may expand this mask onto dry land.

   With a sea shore field (coastal-water.mjs buildSeaShoreField) the mapped window
   is read from it instead of the 32 m cells: the plate goes wherever the sea lies
   SEA_SHORE.plateMargin past its shore, bilinear, so what is left of it is a strip
   under the sheet's faded edge with a curved border, never a staircase of cells
   for the water's reflection to find. */
export function createShoreTexture(shore) {
  const map = new THREE.DataTexture(shore.bytes, shore.width, shore.height, THREE.RedFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}

/* metres into the sea at a world xz from the shore texture, and whether the point lies in its window */
export function shoreDistanceNode(shore, map, xz) {
  const uv = vec2(xz.x.sub(shore.x0).div(shore.sizeX), xz.y.sub(shore.z0).div(shore.sizeZ));
  const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThan(1)).and(uv.y.greaterThanEqual(0)).and(uv.y.lessThan(1));
  return { metres: texture(map, uv).r.mul(255 / 4).sub(32), inside };
}

export function createCoastalTerrainMask(field, { shore = null } = {}) {
  if (!field?.terrainCoverage?.some(value => value !== 0)) return null;
  const bytes = Uint8Array.from(field.terrainCoverage, value => value ? 255 : 0);
  const map = new THREE.DataTexture(bytes, field.width, field.height, THREE.RedFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  /* The world position the mask reads is CENTROID-sampled, and that is not
     decoration. A tile's skirt is a vertical quad hanging from its edge; seen
     from above it is edge-on, and a rasteriser still lights the odd pixel
     along it. The default varying is evaluated at the PIXEL CENTRE, which for
     a sliver lies outside the triangle, so the interpolated height is an
     extrapolation -- metres above a plate that is 0.23 m -- and the height
     test below lets the fragment through. That drew a hairline of terrain
     along every tile edge over the masked sea, from any camera high enough:
     measured on Visby from 1,000 m up, a 256 m grid of them, gone with the
     skirts and gone with a 5 m ceiling. Centroid sampling evaluates the
     varying inside the covered samples, so a skirt fragment's height stays
     between the plate and the skirt's foot, where the test discards it. */
  const world = modelWorldMatrix.mul(positionLocal).xyz.toVarying('vCoastalMaskWorld')
    .setInterpolation('perspective', 'centroid');
  const uv = vec2(world.x.sub(field.bounds.x0).div(field.width * field.spacing),
    world.z.sub(field.bounds.z0).div(field.height * field.spacing));
  const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThan(1))
    .and(uv.y.greaterThanEqual(0)).and(uv.y.lessThan(1));
  let cellCovered = inside.and(texture(map, uv).r.greaterThan(0.5));
  let shoreMap = null;
  if (shore) {
    shoreMap = createShoreTexture(shore);
    const sea = shoreDistanceNode(shore, shoreMap, world.xz);
    cellCovered = select(sea.inside, sea.metres.greaterThan(SEA_SHORE.plateMargin), cellCovered);
  }
  const covered = cellCovered.and(world.y.lessThanEqual(float(field.maximumCoveredTerrainHeight)));
  const apply = material => {
      const keep = covered.not();
      material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
      return material;
  };
  return { map, shoreMap, bytes: bytes.byteLength + (shore ? shore.bytes.byteLength : 0), apply,
    wrap(decorator) {
      const wrapped = (material, context) => { decorator(material, context); return apply(material); };
      const authority = Object.getOwnPropertyDescriptor(decorator, 'v2SurfaceAuthority');
      if (authority) Object.defineProperty(wrapped, 'v2SurfaceAuthority', authority);
      return wrapped;
    },
  };
}
