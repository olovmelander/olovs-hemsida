/* Confidence-traced practice surfaces are display additions over retained 1 m
 * terrain. Source inspection keeps the original pack geometry and materials. */
import layout from './lidingo-practice-surfaces.json' with { type: 'json' };
import { ringSD } from '../geom.js';

export function createPracticeSurfaceFeatures(source = layout) {
  if (source.schemaVersion !== 1 || source.groundId !== 'lidingo' || source.frame.horizontalCrs !== 'EPSG:3006'
    || source.frame.originEpsg3006[0] !== 677700.5 || source.frame.originEpsg3006[1] !== 6586399.5) {
    throw new Error('Lidingo practice surface frame mismatch');
  }
  return source.features.map(feature => ({
    id: feature.id, kind: feature.kind,
    rings: feature.ringsEpsg3006.map(ring => ring.map(([e, n]) => [e - 677700.5, 6586399.5 - n])),
    sourceId: feature.sourceImageId, sourceSha256: feature.sourceSha256, sourceEpoch: feature.sourceEpoch,
    sourceLayoutSha256: source.sourceLayout.sha256, evidence: feature.evidence,
    interpretationUncertaintyMetres: feature.uncertaintyMetres, reviewStatus: feature.status,
    interiorProbeLocal: [...feature.interiorProbeLocal],
    displayOnly: true, notSurveyed: true, preserveTerrain: true,
  }));
}

export function isPracticeSurfaceInterior(features, x, z, margin = .2) {
  return features.some(feature => Math.max(ringSD(x, z, feature.rings[0]),
    ...feature.rings.slice(1).map(ring => -ringSD(x, z, ring))) <= margin);
}
