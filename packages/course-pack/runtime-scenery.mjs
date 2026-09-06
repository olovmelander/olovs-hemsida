/* Keep the full review history in source models and GIS exports. The live pack
 * needs each physical surface once, plus its identity/material/source reference;
 * sourceFeatures duplicates those same rings solely to retain review provenance.
 * Both Upsala emitters call this projection so byte identity stays enforceable.
 * Other grounds retain their existing serialized schema and key order.
 */
export function runtimeScenery(model) {
  const scenery = model.scenery;
  if (model.infra?.objectPlacement !== 'mapped-only' || !scenery) return scenery;
  const { sourceFeatures, retiredSourceFeatures, ...rendered } = scenery;
  if (scenery.mappedFeatures) rendered.mappedFeatures = scenery.mappedFeatures.map(feature =>
    Object.fromEntries(['id', 'kind', 'rings', 'material', 'parentFacilityId',
      'prov', 'sourceId', 'sourceSha256', 'observedYear', 'notSurveyed']
      .filter(key => feature[key] !== undefined).map(key => [key, feature[key]])));
  return rendered;
}
