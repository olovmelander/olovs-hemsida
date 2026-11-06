import { Color } from 'three/webgpu';
import { uniform } from 'three/tsl';

export const paintedDirect = uniform(.9);
export const paintedSeason = uniform(0);
export const paintedTurfStrength = uniform(1);
export const paintedGrassSheen = uniform(0);
/* how wet the ground lies: the storm's 1 and the mist's 0.6 dampen sheltered hollows (ground-material-core.mjs) */
export const paintedWet = uniform(0);
export const GROUND_WETNESS = Object.freeze({ storm: 1, mist: 0.6 });
/* how much snow lies: on the ground, the conifers' tops and the lakes (engine/snow.mjs), 0 to 1 */
export const paintedSnow = uniform(0);
export const paintedWaterShallow = uniform(new Color(0x47999f));
export const paintedWaterDeep = uniform(new Color(0x245d80));
export const paintedWaterLight = uniform(1);
export const paintedWaterSparkle = uniform(.65);

// Uniform-only changes: no material rebuild, extra pass, atlas or geometry.
export function setPaintedWorldLighting(p, name) {
  paintedDirect.value = p.foliage?.direct ?? .9;
  /* autumn's ochre on the grass: the autumn light's, or Nu's pale grass from the first frosts to spring (light-now.mjs `straw`) */
  paintedSeason.value = p.straw ?? (name === 'host' ? 1 : 0);
  paintedTurfStrength.value = p.groundStrength ?? 1;
  paintedGrassSheen.value = p.grassSheen ?? 0;
  paintedWet.value = GROUND_WETNESS[name] ?? 0;
  paintedSnow.value = p.snow ?? 0;
  if (p.water) {
    paintedWaterShallow.value.setHex(p.water[0]);
    paintedWaterDeep.value.setHex(p.water[1]);
  }
  paintedWaterLight.value = p.waterLight ?? 1;
  paintedWaterSparkle.value = p.sparkle ?? .65;
}
