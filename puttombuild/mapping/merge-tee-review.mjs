/* Amend numbered references without retracing an already reviewed platform or
 * silently replacing earlier evidence. All final geometry is still validated
 * by the native-pixel importer. */
export function mergeReviewedHole(previous, incoming) {
  if (previous.n !== incoming.n) throw new Error('Tee review hole mismatch');
  const hole = structuredClone(previous);
  const replaceReference = (key, amendment, nextId) => {
    const prior = [];
    for (const tee of hole.tees ?? []) if (Object.hasOwn(tee.cameraReferencesPixels ?? {}, key)) {
      prior.push({ teeKey: key, reviewId: tee.id, sourceKey: tee.sourceKey, pointPixels: tee.cameraReferencesPixels[key] });
    }
    for (const ref of hole.cameraReferences ?? []) if (ref.teeKey === key) {
      prior.push({ teeKey: key, reviewId: ref.id, sourceKey: ref.sourceKey, pointPixels: ref.pointPixels });
    }
    if (!prior.length) return;
    if (amendment.supersedes !== true || !amendment.reviewNotes?.trim()) {
      throw new Error(`Hole ${hole.n} ${key} already reviewed; explicit supersession and reason required`);
    }
    for (const tee of hole.tees ?? []) if (tee.cameraReferencesPixels) delete tee.cameraReferencesPixels[key];
    hole.cameraReferences = (hole.cameraReferences ?? []).filter(ref => ref.teeKey !== key);
    (hole.supersededTeeReferences ??= []).push(...prior.map(ref => ({ ...ref, nextReviewId: nextId, reason: amendment.reviewNotes })));
  };
  for (const tee of incoming.tees ?? []) {
    if ((hole.tees ?? []).some(t => t.id === tee.id ||
      (tee.replaceIndex !== undefined && t.replaceIndex === tee.replaceIndex))) {
      throw new Error(`Hole ${hole.n} platform already traced; amend its references or explicitly review its boundary replacement`);
    }
    for (const key of Object.keys(tee.cameraReferencesPixels ?? {})) replaceReference(key, tee, tee.id);
    (hole.tees ??= []).push(structuredClone(tee));
  }
  for (const ref of incoming.cameraReferences ?? []) {
    replaceReference(ref.teeKey, ref, ref.id);
    (hole.cameraReferences ??= []).push(structuredClone(ref));
  }
  for (const amendment of incoming.teeReferenceAdditions ?? []) {
    const tee = (hole.tees ?? []).find(t => t.id === amendment.platformReviewId);
    if (!tee || !amendment.numberedSourceAssetId || !amendment.reviewNotes?.trim() ||
      (tee.numberedSourceAssetId && tee.numberedSourceAssetId !== amendment.numberedSourceAssetId)) {
      throw new Error(`Hole ${hole.n} tee reference addition lacks an existing platform and matching numbered evidence`);
    }
    const refs = amendment.cameraReferencesPixels;
    if (!refs || !Object.keys(refs).length) throw new Error('Tee reference addition is empty');
    for (const key of Object.keys(refs)) {
      // Reconfirmation may repeat an unchanged reference on this same source
      // platform. A changed position still needs explicit supersession.
      if (JSON.stringify(tee.cameraReferencesPixels?.[key]) === JSON.stringify(refs[key])) continue;
      replaceReference(key, amendment, tee.id);
    }
    tee.numberedSourceAssetId = amendment.numberedSourceAssetId;
    Object.assign(tee.cameraReferencesPixels ??= {}, structuredClone(refs));
    (tee.referenceReviewNotes ??= []).push(amendment.reviewNotes);
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (['n', 'tees', 'cameraReferences', 'teeReferenceAdditions'].includes(key)) continue;
    if (Array.isArray(value)) hole[key] = [...(hole[key] ?? []), ...structuredClone(value)];
    else if (hole[key] !== undefined) throw new Error(`Conflicting hole ${hole.n} ${key}`);
    else hole[key] = structuredClone(value);
  }
  return hole;
}
