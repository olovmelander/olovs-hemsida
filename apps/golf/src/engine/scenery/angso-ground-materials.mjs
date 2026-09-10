import { Color, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, positionWorld, texture } from 'three/tsl';

/* The same fix Veckefjärden's authored campus needed, and for the same reason:
   a Blender sheet lit for Blender reads as pale cream under this engine's sun.
   Ängsö's export gives the campus gravel a linear .40/.39/.34 and the range
   apron .47/.39/.30 -- squarely in the .30-.60 band that file already records
   as too bright -- and MEASURED in a day-lit frame they render at luminance
   203 and 205 against the course's own fairway turf at 115. A paved surface
   that is nearly twice the ground around it is the flat white slab in the
   screenshot, not a car park.

   The target is not invented here either. Veckefjärden's paving was reviewed
   and accepted, and photographed the same way it renders at 127-136. So each
   colour below is Ängsö's OWN reviewed hue -- the gravel stays faintly warm,
   the range apron sandier, exactly as its orthophoto review set them -- scaled
   in LINEAR light to its Veckefjärden counterpart's luminance. Hue is the
   Blender author's measurement and is kept; value is what was wrong.

   Composition is not surveyed; these are display colours. */
export const ANGSO_GROUND_SURFACES = Object.freeze({
  campus_gravel: { profileId: 'warm-grey-campus-gravel', colorSrgb: 0x64635c },
  range_paving: { profileId: 'sandy-grey-range-apron', colorSrgb: 0x635b50 },
  terrace_paving: { profileId: 'grey-terrace-paving', colorSrgb: 0x6c6d67 },
});

/* Blender writes every material as "ANG MODEL 4 | <name>"; the sheet number
   moves whenever the file is re-exported, so match on the name itself. */
const profileName = material => (material?.name || '').replace(/^ANG MODEL\s*\d*\s*\|\s*/, '');

/** Retone the authored hardstanding, and only that. Keyed on a `site` group so
 * a material an author later reuses on a wall is untouched, and the grain is
 * the course's own gravel grain, so the surface has tooth instead of reading
 * as one flat plate. Returns what it applied, for the acceptance record. */
export function applyAngsoGroundMaterials(root, detailTexture) {
  const applied = [], originals = new Set(), materials = new Map();
  for (const group of root.children ?? []) {
    if (group.userData?.kind !== 'site') continue;
    group.traverse(mesh => {
      if (!mesh.isMesh) return;
      const name = profileName(mesh.material);
      const spec = ANGSO_GROUND_SURFACES[name];
      if (!spec) return;
      const original = mesh.material;
      originals.add(original);
      /* Roughness and metalness stay the author's: the value was wrong, the
         shading was not. Side is kept so a one-sided plate stays one-sided. */
      const key = `${spec.profileId}/${original.side}/${original.roughness}`;
      let material = materials.get(key);
      if (!material) {
        material = new MeshStandardNodeMaterial({
          color: new Color(spec.colorSrgb), roughness: original.roughness, metalness: original.metalness,
          side: original.side, transparent: false, opacity: 1,
        });
        material.name = `Angso ${spec.profileId}`;
        if (detailTexture) {
          // The same packed grain and world scale as the course's gravel roads.
          const grain = texture(detailTexture, positionWorld.xz.mul(.31)).g.sub(.5);
          material.colorNode = color(spec.colorSrgb).mul(grain.mul(.20).add(1));
        }
        materials.set(key, material);
      }
      mesh.material = material;
      applied.push({ facilityId: group.userData.facilityId ?? group.name, profileId: spec.profileId,
        sourceProfile: name, colorSrgb: '#' + spec.colorSrgb.toString(16).padStart(6, '0'),
        roughness: original.roughness, detail: !!detailTexture });
    });
  }
  /* An imported material may also serve trim elsewhere. Dispose only those no
     mesh still references, leaving shared architectural materials intact. */
  root.traverse(mesh => {
    if (mesh.isMesh) for (const material of [mesh.material].flat()) originals.delete(material);
  });
  for (const material of originals) material.dispose();
  return applied;
}
