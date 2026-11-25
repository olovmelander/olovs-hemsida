/* THE OWNER'S LOOK, hole by hole.

   The release review asks that a person has looked at every hole in seven categories (standard.mjs CATEGORIES).
   No ground has ever had that: it was a form nobody could fill in at a sitting. tools/course-review-page.mjs
   makes it a page the owner clicks through, hole by hole, with the photo and the model side by side; this module
   is what the page and the tools share:

   - reviewDocument: what the page saves (also embedded in the page, so the same code is tested here);
   - ownerReviewErrors: whether a saved review is of what is published, by whom, and complete enough to use;
   - applyOwnerReview: the saved review as rows of the release review, with the saved file as their evidence.

   A hole the owner marks wrong is not hidden: its row stays unreviewed and carries their note, and the import
   lists it as work to do. Nothing here approves a ground; it records what a person saw. */
import { CATEGORIES } from './standard.mjs';

export const OWNER_VERDICTS = Object.freeze(['right', 'wrong', 'absent']);
const MUST_EXIST = Object.freeze(['tees', 'greens']);

/* Kept free of imports and closures: the review page embeds this function's own text. */
export function reviewDocument(meta, state, savedAt) {
  const holes = [];
  for (const routing of meta.routings) for (const hole of routing.holes) {
    const entry = state.holes[routing.slug + '/' + hole.n] || {};
    const categories = {};
    for (const category of meta.categories) {
      const verdict = (entry.cats || {})[category] || null;
      categories[category] = { status: verdict, note: ((entry.notes || {})[category] || '').trim() };
    }
    holes.push({ slug: routing.slug, hole: hole.n, categories: categories, note: (entry.note || '').trim() });
  }
  return { schemaVersion: 1, kind: 'owner-hole-review', groundId: meta.groundId, groundManifestSha256: meta.groundManifestSha256,
    surfaces: meta.surfaces, reviewer: (state.reviewer || '').trim(), savedAt: savedAt, holes: holes };
}

/** How far a saved review has come: holes with all seven categories decided, and every "wrong" in it. */
export function ownerReviewSummary(doc) {
  const decided = doc.holes.filter(h => CATEGORIES.every(c => OWNER_VERDICTS.includes(h.categories?.[c]?.status)));
  const wrong = doc.holes.flatMap(h => CATEGORIES.filter(c => h.categories?.[c]?.status === 'wrong').map(c => ({ slug: h.slug, hole: h.hole, category: c, note: h.categories[c].note || h.note })));
  return { holes: doc.holes.length, decided: decided.length, complete: decided.length === doc.holes.length, wrong };
}

/** Why a saved review cannot be used for this ground as published (an empty list when it can). */
export function ownerReviewErrors(doc, { groundId, groundManifestSha256, routings, surfaces = {} }) {
  const errors = [];
  if (doc?.schemaVersion !== 1 || doc.kind !== 'owner-hole-review' || doc.groundId !== groundId) return ['this is not an owner review of this ground'];
  if (doc.groundManifestSha256 !== groundManifestSha256) errors.push('the review is of another generation of the ground than the one published: look again on a fresh page');
  for (const [slug, sha] of Object.entries(surfaces)) if (sha && doc.surfaces?.[slug] !== sha) errors.push(`${slug}: the outlines changed since the page was made`);
  if (typeof doc.reviewer !== 'string' || doc.reviewer.length < 2) errors.push('the review does not say who looked');
  if (!Number.isFinite(Date.parse(doc.savedAt)) || Date.parse(doc.savedAt) > Date.now() + 60000) errors.push('the review needs the time it was saved');
  const expected = new Set(routings.flatMap(r => Array.from({ length: r.holes }, (_, i) => `${r.slug}/${i + 1}`))), seen = new Set();
  for (const hole of Array.isArray(doc.holes) ? doc.holes : []) {
    const key = `${hole.slug}/${hole.hole}`;
    if (!expected.has(key) || seen.has(key)) { errors.push(`${key}: not a hole of this ground, or twice`); continue; }
    seen.add(key);
    for (const category of CATEGORIES) {
      const c = hole.categories?.[category];
      if (!c || (c.status !== null && !OWNER_VERDICTS.includes(c.status))) { errors.push(`${key} ${category}: no verdict the page offers`); continue; }
      if (c.status === 'absent' && MUST_EXIST.includes(category)) errors.push(`${key}: a hole has ${category}; "none here" is not an answer`);
      if (c.status === 'wrong' && !(c.note || hole.note)) errors.push(`${key} ${category}: marked wrong without saying what is wrong`);
    }
  }
  for (const key of expected) if (!seen.has(key)) errors.push(`${key}: missing from the review`);
  return errors;
}

/** The release review with the owner's verdicts as its per-hole rows; `evidence` is the saved review as { path, sha256 }. */
export function applyOwnerReview(review, doc, evidence) {
  const next = structuredClone(review), rows = new Map(next.holes.map(h => [`${h.slug}/${h.hole}`, h]));
  let reviewed = 0, open = 0;
  for (const hole of doc.holes) {
    const row = rows.get(`${hole.slug}/${hole.hole}`);
    if (!row) continue;
    for (const category of CATEGORIES) {
      const c = hole.categories[category], said = c.note || hole.note;
      if (c.status === 'right') { row.categories[category] = { status: 'reviewed', notes: `${doc.reviewer}: as on the photo${said ? `. ${said}` : ''}.`, evidence: [evidence] }; reviewed++; }
      else if (c.status === 'absent') { row.categories[category] = { status: 'not-applicable', notes: `${doc.reviewer}: none on this hole${said ? `. ${said}` : ''}.`, evidence: [evidence] }; reviewed++; }
      else if (c.status === 'wrong') { row.categories[category] = { status: 'unknown', notes: `${doc.reviewer}: wrong. ${said}`, evidence: [evidence] }; open++; }
    }
  }
  return { review: next, reviewed, open };
}
