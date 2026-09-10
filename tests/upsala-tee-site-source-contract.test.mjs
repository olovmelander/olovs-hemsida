import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { checkUpsalaSiteEvidence } from '../tools/check-upsala-tee-coordinates.mjs';

describe('Upsala evidence-only site coordinate contract', () => {
  const review = JSON.parse(fs.readFileSync(new URL('../upsalabuild/mapping/lm-tee-visible-interior-stora-2026-09-09.json', import.meta.url)));
  const fixture = () => { const copy = structuredClone(review); return { model: copy.frame,
    review: copy, record: copy.holes[0], decision: copy.holes[0].decisions[0] }; };

  it('checks actual visible-turf trace pixels and the reviewed point through independent nonlinear projection', () => {
    const context = fixture(), result = checkUpsalaSiteEvidence(context);
    expect(result.supportVertices).toBe(context.decision.supportRing.length);
    expect(result.clearanceMetres).toBeGreaterThanOrEqual(1);
    expect(result.maximumProjectionErrorMetres).toBeLessThan(0.005);
    expect(result.maximumPixelRoundtripErrorMetres).toBeLessThan(0.005);
    expect(context.decision.fullPlatformBoundaryVerified).toBe(false);
  });

  it.each([
    ['wrong panel hole', c => { c.decision.supportEvidence.panel.hole++; }, /panel hole identity/],
    ['old crop header offset', c => { c.decision.supportEvidence.pixelRing[0][1] += 30; }, /pixel-to-EPSG transform/],
    ['swapped source grid axes', c => { c.decision.supportEvidence.epsg3006Ring[0].reverse(); }, /pixel-to-EPSG transform/],
    ['wrong local northing sign', c => { c.decision.supportRing[0][1] *= -1; c.decision.supportEvidence.localRing[0][1] *= -1; }, /EPSG-to-local source/],
    ['altered source point', c => { c.decision.positionEvidence.epsg3006[0] += 1; }, /pixel-to-EPSG transform/],
    ['latitude-longitude reversal', c => { c.decision.positionEvidence.wgs84LongitudeLatitude.reverse(); }, /WGS84 coordinate order/],
    ['unrelated native image', c => { c.decision.supportEvidence.panel.source.sha256 = '0'.repeat(64); }, /native source differs/],
    ['invented source identity', c => { c.decision.sourceIds.push('not-a-reviewed-source'); }, /unresolved site source identity/],
    ['wrong reported support clearance', c => { c.decision.positionEvidence.minimumSupportClearanceMetres += 1; }, /reported support clearance/],
  ])('rejects %s', (_name, mutate, error) => {
    const context = fixture(); mutate(context);
    expect(() => checkUpsalaSiteEvidence(context)).toThrow(error);
  });
});

describe('published forward-site point lineage', () => {
  const review = JSON.parse(fs.readFileSync(new URL('../upsalabuild/mapping/lm-tee-points-stora-2026-09-09.json', import.meta.url)));
  const fixture = () => {
    const copy = structuredClone(review), record = copy.holes[0], decision = record.decisions[0];
    const source = copy.sources.find(s => s.extractedProfilePath), published = decision.positionEvidence;
    const holes = Array.from({ length: 18 }, () => ({ teeGeoPoints: [], teeYardages: [] })), tees = [];
    holes[record.hole - 1].teeGeoPoints[published.publishedTeeIndex] = {
      longitude: published.publishedSourceWgs84LongitudeLatitude[0], latitude: published.publishedSourceWgs84LongitudeLatitude[1] };
    holes[record.hole - 1].teeYardages[published.publishedTeeIndex] = record.originalDistances[decision.markIndex] / 0.9144;
    tees[published.publishedTeeIndex] = { name: published.publishedTeeName };
    return { model: copy.frame, review: copy, record, decision, publishedSources: { [source.id]: { profile: { club: { holes, tees } } } } };
  };

  it('keeps the independently declared source point separate from H3’s approximate visible-turf point', () => {
    const context = fixture(), result = checkUpsalaSiteEvidence(context);
    expect(result.publishedPointVerifiedAgainstCachedSource).toBe(true);
    expect(context.decision.positionEvidence.offsetFromPublishedMetres).toBeGreaterThan(12);
    expect(context.decision.coordinateBasis).not.toBe('published-coordinate');
  });

  it.each([
    ['wrong published hole', c => { c.decision.positionEvidence.publishedFeaturePath = 'props.profile.club.holes[0].teeGeoPoints[16]'; }, /published site point identity/],
    ['wrong published projection', c => { c.decision.positionEvidence.publishedSourceEpsg3006[1] += 8; }, /published site EPSG-to-local/],
    ['incorrect source offset', c => { c.decision.positionEvidence.offsetFromPublishedMetres = 0; }, /published site offset/],
    ['claiming the approximate point is the published coordinate', c => { c.decision.coordinateBasis = 'published-coordinate-corroborated-by-native-imagery'; }, /published coordinate was moved/],
    ['a different point in the cached primary source', c => {
      Object.values(c.publishedSources)[0].profile.club.holes[c.record.hole - 1].teeGeoPoints[c.decision.positionEvidence.publishedTeeIndex].longitude += 0.001;
    }, /point differs from hashed source/],
    ['a mismatched published scorecard association', c => {
      Object.values(c.publishedSources)[0].profile.club.holes[c.record.hole - 1].teeYardages[c.decision.positionEvidence.publishedTeeIndex] += 20;
    }, /published tee scorecard association/],
  ])('rejects %s', (_name, mutate, error) => {
    const context = fixture(); mutate(context);
    expect(() => checkUpsalaSiteEvidence(context)).toThrow(error);
  });
});
