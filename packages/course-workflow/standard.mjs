/* Offline production policy. This does not enter the player bundle. */
export const STANDARD = 'banvy-course-production-v1';
export const STAGES = ['sources', 'terrain', 'mapping', 'vegetation', 'assemble', 'validate'];
export const CATEGORIES = ['tees', 'greens', 'fairways', 'bunkers', 'water', 'vegetation', 'infrastructure'];
export const GATES = ['sources', 'coordinates', 'terrain', 'routing', 'surfaces', 'vegetation', 'reproducibility',
  'infrastructure', 'webgpu', 'webgl2', 'mobile', 'performance', 'offline', 'rollback'];
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA = /^[a-f0-9]{64}$/;
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const nonempty = v => typeof v === 'string' && v.trim().length > 0;
export function relativePath(v) {
  return nonempty(v) && !v.includes('\\') && !v.includes('\0') && !v.includes(':') &&
    !v.startsWith('/') && v.split('/').every(p => p && p !== '.' && p !== '..' && p !== '.git');
}
export function exactKeys(value, keys, label, errors) {
  if (!isObject(value)) { errors.push(`${label}: expected an object`); return false; }
  for (const k of Object.keys(value)) if (!keys.includes(k)) errors.push(`${label}.${k}: unknown field`);
  return true;
}
export function validateWorkflow(w) {
  const e = [];
  if (!exactKeys(w, ['schemaVersion', 'standard', 'groundId', 'name', 'courses', 'sourceManifest',
    'publicRoot', 'reviewFile', 'watch', 'stages', 'performance', 'releasePolicy'], 'workflow', e)) return e;
  if (w.schemaVersion !== 1 || w.standard !== STANDARD) e.push('workflow: unsupported version/standard');
  if (!ID.test(w.groundId || '')) e.push('groundId: expected kebab-case');
  if (!nonempty(w.name)) e.push('name: required');
  if (!['required', 'advisory'].includes(w.releasePolicy)) e.push('releasePolicy: expected required or advisory');
  for (const k of ['sourceManifest', 'publicRoot', 'reviewFile']) if (!relativePath(w[k])) e.push(`${k}: expected a safe repository-relative path`);
  if (!Array.isArray(w.courses) || !w.courses.length) e.push('courses: at least one routing required');
  const slugs = new Set();
  for (const [i, c] of (Array.isArray(w.courses) ? w.courses : []).entries()) {
    if (!exactKeys(c, ['slug', 'holes'], `courses[${i}]`, e)) continue;
    if (!ID.test(c.slug || '') || slugs.has(c.slug)) e.push(`courses[${i}]: invalid or duplicate slug`);
    slugs.add(c.slug);
    if (!Number.isInteger(c.holes) || c.holes < 1 || c.holes > 36) e.push(`courses[${i}].holes: expected 1..36`);
  }
  function paths(v, at, required = false) {
    if (!Array.isArray(v) || (required && !v.length) || v.some(p => !relativePath(p)) || new Set(v).size !== v.length) e.push(`${at}: expected unique relative paths${required ? ' (nonempty)' : ''}`);
  }
  paths(w.watch, 'watch', true);
  if (exactKeys(w.stages, STAGES, 'stages', e)) for (const stage of STAGES) {
    const s = w.stages[stage];
    if (!exactKeys(s, ['command', 'inputs', 'outputs'], `stages.${stage}`, e)) continue;
    if (s.command !== null && (!Array.isArray(s.command) || s.command.length < 2 ||
      !['node', 'python', 'python3', 'pixi', 'pnpm'].includes(s.command[0]) ||
      s.command.some(v => typeof v !== 'string' || v.includes('\0')))) e.push(`${stage}.command: expected null or an argument array beginning with node/python/python3/pixi/pnpm`);
    paths(s.inputs, `${stage}.inputs`, s.command !== null);
    paths(s.outputs, `${stage}.outputs`, s.command !== null);
    if (s.command && Array.isArray(s.outputs) && s.outputs.some(p => typeof p === 'string' && (p === 'apps/golf/public' || p.startsWith('apps/golf/public/')))) e.push(`${stage}: write candidate assets to staging, not apps/golf/public`);
  }
  if (exactKeys(w.performance, ['maxRegressionPercent', 'maxColdLoadMs', 'maxFrameP95Ms'], 'performance', e)) {
    for (const k of ['maxRegressionPercent', 'maxColdLoadMs']) if (!Number.isFinite(w.performance[k]) || w.performance[k] < (k === 'maxColdLoadMs' ? 1 : 0)) e.push(`performance.${k}: invalid budget`);
    if (exactKeys(w.performance.maxFrameP95Ms, ['webgpu', 'webgl2', 'mobile'], 'performance.maxFrameP95Ms', e)) for (const k of ['webgpu', 'webgl2', 'mobile']) {
      if (!Number.isFinite(w.performance.maxFrameP95Ms[k]) || w.performance.maxFrameP95Ms[k] <= 0) e.push(`performance.maxFrameP95Ms.${k}: positive budget required`);
    }
  }
  return e;
}
export function assertWorkflow(w) {
  const errors = validateWorkflow(w);
  if (errors.length) throw new Error(errors.join('\n'));
  return w;
}
export function workflowTemplate({ groundId, name, courses, sourceManifest, publicRoot, releasePolicy = 'required' }) {
  return assertWorkflow({ schemaVersion: 1, standard: STANDARD, groundId, name, courses,
    releasePolicy, sourceManifest: sourceManifest || `course-workflows/${groundId}/source-manifest.json`,
    publicRoot: publicRoot || `output/course-workflow/${groundId}/public`,
    reviewFile: `course-workflows/${groundId}/review.json`,
    watch: ['apps/golf/src', 'packages/course-v2', 'packages/course-pack', 'packages/course-geo', 'packages/course-workflow', 'pnpm-lock.yaml'],
    stages: Object.fromEntries(STAGES.map(s => [s, { command: null, inputs: [], outputs: [] }])),
    performance: { maxRegressionPercent: 10, maxColdLoadMs: 10000,
      maxFrameP95Ms: { webgpu: 20, webgl2: 33.4, mobile: 33.4 } },
  });
}
export function reviewTemplate(w, candidateDigest = null) {
  return { schemaVersion: 1, standard: STANDARD, groundId: w.groundId, candidateDigest,
    gates: Object.fromEntries(GATES.map(g => [g, { status: 'pending', reviewer: null, reviewedAt: null, notes: '', evidence: [] }])),
    holes: w.courses.flatMap(c => Array.from({ length: c.holes }, (_, i) => ({ slug: c.slug, hole: i + 1,
      categories: Object.fromEntries(CATEGORIES.map(k => [k, { status: 'unknown', notes: '', evidence: [] }])) }))),
    performance: [],
  };
}
