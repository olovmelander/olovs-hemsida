import * as THREE from 'three/webgpu';
import { float, positionWorld, texture, vec2 } from 'three/tsl';

/* Surface-only laser data beneath verified sea is redundant visible geometry.
   Keep all CPU heights and mesh data; remove only covered low fragments. The
   shore inset and exact offshore cells are established by buildCoastalWater.
   No filtering/mipmaps may expand this mask onto dry land. */
export function createCoastalTerrainMask(field) {
  if (!field?.terrainCoverage?.some(value => value !== 0)) return null;
  const bytes = Uint8Array.from(field.terrainCoverage, value => value ? 255 : 0);
  const map = new THREE.DataTexture(bytes, field.width, field.height, THREE.RedFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const uv = vec2(positionWorld.x.sub(field.bounds.x0).div(field.width * field.spacing),
    positionWorld.z.sub(field.bounds.z0).div(field.height * field.spacing));
  const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThan(1))
    .and(uv.y.greaterThanEqual(0)).and(uv.y.lessThan(1));
  const covered = inside.and(texture(map, uv).r.greaterThan(0.5))
    .and(positionWorld.y.lessThanEqual(float(field.maximumCoveredTerrainHeight)));
  const apply = material => {
      const keep = covered.not();
      material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
      return material;
  };
  return { map, bytes: bytes.byteLength, apply,
    wrap(decorator) {
      const wrapped = (material, context) => { decorator(material, context); return apply(material); };
      const authority = Object.getOwnPropertyDescriptor(decorator, 'v2SurfaceAuthority');
      if (authority) Object.defineProperty(wrapped, 'v2SurfaceAuthority', authority);
      return wrapped;
    },
  };
}
