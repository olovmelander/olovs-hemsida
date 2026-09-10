import { Color, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, positionWorld, texture } from 'three/tsl';

// Display colours reviewed against the 2024 campus/range orthophotos. These
// sRGB literals are converted to linear once, like the surrounding course.
// The Blender sheets used linear grey values of .30-.60, which read as pale
// cream under the course lighting. Surface composition is not surveyed.
const PARKING = Object.freeze({ profileId: 'weathered-grey-hardstanding', colorSrgb: 0x62635e, roughness: .97 });
const SURFACES = Object.freeze({
  S01: { profileId: 'grey-ground-paving', colorSrgb: 0x6b6d68, roughness: .93 },
  S04: PARKING, S05: PARKING, S06: PARKING,
  S07: { profileId: 'dark-grey-island-fill', colorSrgb: 0x585b56, roughness: .97 },
  S08: { profileId: 'grey-range-apron', colorSrgb: 0x575d5e, roughness: .96 },
});

export function applyFacilityGroundMaterials(root, detailTexture) {
  const applied = [], originals = new Set(), materials = new Map();
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.groundContact !== true) return;
    const featureId = mesh.userData.facilityId;
    const spec = SURFACES[featureId];
    if (!spec) return;
    const original = mesh.material;
    originals.add(original);
    const key = `${spec.profileId}/${original.side}`;
    let material = materials.get(key);
    if (!material) {
      material = new MeshStandardNodeMaterial({
        color: new Color(spec.colorSrgb), roughness: spec.roughness, metalness: 0,
        side: original.side, transparent: false, opacity: 1,
      });
      material.name = `Veckefjarden ${spec.profileId}`;
      if (detailTexture) {
        // The same packed grain and world scale as the course's gravel roads.
        const grain = texture(detailTexture, positionWorld.xz.mul(.31)).g.sub(.5);
        material.colorNode = color(spec.colorSrgb).mul(grain.mul(.20).add(1));
      }
      materials.set(key, material);
    }
    mesh.material = material;
    applied.push({ featureId, profileId: spec.profileId,
      colorSrgb: '#' + spec.colorSrgb.toString(16).padStart(6, '0'),
      roughness: spec.roughness, detail: !!detailTexture });
  });
  // Some imported materials also serve foundations/trim. Dispose only those
  // replaced everywhere, leaving shared architectural materials intact.
  root.traverse(mesh => {
    if (mesh.isMesh) for (const material of [mesh.material].flat()) originals.delete(material);
  });
  for (const material of originals) material.dispose();
  return applied;
}
