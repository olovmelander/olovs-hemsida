import woodland from './woodland-tree-tiers.mjs';
import pine from './scots-pine-assets.mjs';
import placementCrowns from './tree-placement-crowns.mjs';
import sprigs from './woodland-sprigs.mjs';

// Only Visby has surveyed coastal pine forms. The species, seeds and size
// records always come from the course's existing catalogue.
export function woodlandTrees(coastal) {
  const { variants, foliage } = coastal ? pine.coastal : pine.inland;
  return { tiers: { ...woodland, tall: variants }, sprigs: { ...sprigs, tall: foliage }, placementCrowns };
}
