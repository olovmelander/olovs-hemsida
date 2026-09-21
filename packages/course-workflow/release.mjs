import fs from 'node:fs';
import { verifyAssetGraph } from '../course-v2/graph-node.mjs';
import { readPack, inflateStream } from '../course-pack/lib.mjs';
import { candidate, inspectGround } from './audit.mjs';
import { CATEGORIES, GATES, STANDARD, SHA, nonempty, exactKeys } from './standard.mjs';
import { readJson, fileDigest, safePath, digest } from './io.mjs';
import { plan } from './runner.mjs';

export function reviewErrors(root, w, review, candidateDigest) {
  const errors = [];
  if (!exactKeys(review, ['schemaVersion', 'standard', 'groundId', 'candidateDigest', 'gates', 'holes', 'performance'], 'review', errors)) return errors;
  if (review.schemaVersion !== 1 || review.standard !== STANDARD || review.groundId !== w.groundId) errors.push('review identity/version mismatch');
  if (!SHA.test(review.candidateDigest || '') || review.candidateDigest !== candidateDigest) errors.push('review is missing or stale for this candidate');
  function evidence(refs, at) {
    if (!Array.isArray(refs) || !refs.length) { errors.push(`${at}: hashed evidence required`); return; }
    for (const ref of refs) {
      if (!exactKeys(ref, ['path', 'sha256'], `${at}.evidence`, errors)) continue;
      try {
        if (!SHA.test(ref.sha256 || '') || fileDigest(root, ref.path) !== ref.sha256) errors.push(`${at}: missing or changed evidence ${ref.path}`);
      } catch (e) { errors.push(`${at}: ${e.message}`); }
    }
  }
  if (exactKeys(review.gates, GATES, 'gates', errors)) for (const name of GATES) {
    const g = review.gates[name];
    if (!exactKeys(g, ['status', 'reviewer', 'reviewedAt', 'notes', 'evidence'], `gate.${name}`, errors)) continue;
    if (g.status !== 'passed') errors.push(`gate.${name}: ${g.status || 'unknown'}`);
    if (!nonempty(g.reviewer) || !nonempty(g.notes)) errors.push(`gate.${name}: reviewer and review explanation required`);
    const time = Date.parse(g.reviewedAt);
    if (!nonempty(g.reviewedAt) || !Number.isFinite(time) || time > Date.now() + 60000) errors.push(`gate.${name}: valid review timestamp required`);
    evidence(g.evidence, `gate.${name}`);
  }
  const expected = new Set(w.courses.flatMap(c => Array.from({ length: c.holes }, (_, i) => `${c.slug}/${i + 1}`)));
  const seen = new Set();
  if (!Array.isArray(review.holes)) errors.push('holes: complete per-routing/per-hole review required');
  for (const h of Array.isArray(review.holes) ? review.holes : []) {
    if (!exactKeys(h, ['slug', 'hole', 'categories'], 'hole', errors)) continue;
    const key = `${h.slug}/${h.hole}`;
    if (!expected.has(key) || seen.has(key)) errors.push(`${key}: unknown or duplicate review row`);
    seen.add(key);
    if (!exactKeys(h.categories, CATEGORIES, key, errors)) continue;
    for (const category of CATEGORIES) {
      const c = h.categories[category];
      if (!exactKeys(c, ['status', 'notes', 'evidence'], `${key}.${category}`, errors)) continue;
      if (!['reviewed', 'not-applicable'].includes(c.status)) errors.push(`${key}.${category}: ${c.status || 'unknown'}`);
      if (c.status === 'not-applicable' && ['tees', 'greens'].includes(category)) errors.push(`${key}.${category}: cannot be marked not-applicable`);
      if (!nonempty(c.notes)) errors.push(`${key}.${category}: findings or absence rationale required`);
      evidence(c.evidence, `${key}.${category}`);
    }
  }
  for (const key of expected) if (!seen.has(key)) errors.push(`${key}: missing review row`);
  // Three comparable runs per target. Medians avoid one unusually fast run
  // passing a regression, and absolute budgets also apply to new grounds.
  if (!Array.isArray(review.performance)) errors.push('performance: measurements required');
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const target of ['webgpu', 'webgl2', 'mobile']) {
    const matches = (Array.isArray(review.performance) ? review.performance : []).filter(m => m?.target === target);
    if (matches.length !== 1) { errors.push(`performance.${target}: exactly one measurement set required`); continue; }
    const m = matches[0];
    exactKeys(m, ['target', 'device', 'scenario', 'baselineDigest', 'candidateDigest', 'runs', 'evidence'], `performance.${target}`, errors);
    if (!nonempty(m.device) || !nonempty(m.scenario) || !SHA.test(m.baselineDigest || '') || m.candidateDigest !== candidateDigest) errors.push(`performance.${target}: identify device, matched scenario and both builds`);
    evidence(m.evidence, `performance.${target}`);
    if (!Array.isArray(m.runs) || m.runs.length < 3) { errors.push(`performance.${target}: at least three runs required`); continue; }
    let valid = true;
    for (const run of m.runs) {
      if (!exactKeys(run, ['baseline', 'candidate'], `performance.${target}.run`, errors)) { valid = false; continue; }
      for (const side of ['baseline', 'candidate']) {
        if (!exactKeys(run[side], ['coldLoadMs', 'frameP95Ms'], `performance.${target}.${side}`, errors)) { valid = false; continue; }
        for (const k of ['coldLoadMs', 'frameP95Ms']) if (!Number.isFinite(run[side][k]) || run[side][k] <= 0) valid = false;
      }
    }
    if (!valid) { errors.push(`performance.${target}: all timings must be finite and positive`); continue; }
    for (const metric of ['coldLoadMs', 'frameP95Ms']) {
      const before = median(m.runs.map(r => r.baseline[metric]));
      const after = median(m.runs.map(r => r.candidate[metric]));
      const ceiling = metric === 'coldLoadMs' ? w.performance.maxColdLoadMs : w.performance.maxFrameP95Ms[target];
      if (after > ceiling || after > before * (1 + w.performance.maxRegressionPercent / 100)) errors.push(`performance.${target}.${metric}: exceeds the absolute or regression budget`);
    }
  }
  return errors;
}
export function verifyCandidateBytes(root, w, graph, publicRoot) {
  const resources = new Map();
  const add = ref => {
    if (!resources.has(ref.url)) resources.set(ref.url, fs.readFileSync(safePath(root, `${publicRoot}/${ref.url}`)));
  };
  graph.entries.forEach(e => add(e.manifest));
  graph.courses.forEach(c => { add(c.groundManifest); add(c.routing); });
  add(graph.ground.shell);
  for (const t of graph.ground.tiles) for (const ref of Object.values(t.layers)) if (ref) add(ref);
  const verified = verifyAssetGraph({ root: { ...graph.index, courses: graph.entries }, resources });
  for (const c of graph.courses) {
    const ref = c.fallbackV1;
    const bytes = fs.readFileSync(safePath(root, `${publicRoot}/${ref.packUrl}`));
    if (bytes.length !== ref.bytes || digest(bytes) !== ref.sha256) throw new Error(`${c.slug}: fallback pack size/hash mismatch`);
    const pack = readPack(bytes);
    if (pack.header.slug !== c.slug) throw new Error(`${c.slug}: wrong fallback course identity`);
    inflateStream(pack.s0); inflateStream(pack.s1); JSON.parse(inflateStream(pack.sv));
  }
  function sidecars(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.url === 'string' && SHA.test(value.sha256 || '') && Number.isSafeInteger(value.bytes)) {
      const bytes = fs.readFileSync(safePath(root, `${publicRoot}/${value.url}`));
      if (bytes.length !== value.bytes || digest(bytes) !== value.sha256) throw new Error(`player sidecar size/hash mismatch: ${value.url}`);
    }
    for (const child of Object.values(value)) sidecars(child);
  }
  graph.playerEntries.forEach(sidecars);
  return verified;
}
export function releaseCheck(root, w, { publicRoot = w.publicRoot, verifyBytes = true } = {}) {
  const errors = [];
  let candidateDigest = null, byteVerification = null;
  try {
    const graph = candidate(root, w, { publicRoot });
    candidateDigest = graph.candidateDigest;
    for (const step of plan(root, w, { publicRoot })) if (step.status !== 'current') errors.push(`build.${step.stage}: ${step.status}; ${step.reason}`);
    const audit = inspectGround(root, w.groundId, { publicRoot, sourceManifest: w.sourceManifest });
    errors.push(...audit.errors);
    if (audit.frameStatus !== 'approved') errors.push('canonical frame has not passed independent control approval');
    if (!audit.sourceSnapshotMatches) errors.push('source manifest changed since ground publication');
    for (const b of audit.blockers) if (b.severity === 'release-blocking') errors.push(`source blocker: ${b.id}`);
    for (const role of ['terrain', 'imagery', 'canopy']) if (!audit.sources.some(s => s.roles.includes(role) && ['acquired', 'approved'].includes(s.lifecycle))) errors.push(`missing acquired ${role} source metadata`);
    const source = readJson(root, w.sourceManifest);
    for (const a of source.artifacts) if (fileDigest(root, a.path) !== a.sha256) errors.push(`source artifact changed: ${a.path}`);
    if (source.canonicalFrame.originStatus === 'approved') for (const k of ['easting', 'northing', 'heightRH2000']) {
      if (source.canonicalFrame.origin[k] !== graph.ground.frame.origin[k]) errors.push(`approved frame ${k} differs from published frame`);
    }
    let review;
    try { review = readJson(root, w.reviewFile); }
    catch (e) { errors.push(`release review unavailable: ${e.message}`); }
    if (review) errors.push(...reviewErrors(root, w, review, candidateDigest));
    // Cheap evidence failures precede the expensive full graph decode.
    if (!errors.length && verifyBytes) byteVerification = verifyCandidateBytes(root, w, graph, publicRoot);
  } catch (e) { errors.push(e.message); }
  return { schemaVersion: 1, standard: STANDARD, groundId: w.groundId, candidateDigest,
    ready: errors.length === 0 && verifyBytes, reviewReady: errors.length === 0,
    byteVerification: byteVerification || 'not-run', errors };
}
