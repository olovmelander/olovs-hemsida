/* The tree pipeline's per-ground configuration: course-workflows/<ground>/trees.json.

   Everything that belongs to one physical ground -- its inner window in
   EPSG:3006, the laser campaign and items, the orthophoto campaigns and their
   dates and sun positions, the published generation the review starts from,
   the play-zone distance, the reference rounds and the type-rule calibration
   -- lives in that file. The stages read nothing ground-specific from code.
   The held-out gate's thresholds are NOT configurable (gate.mjs); a ground
   that publishes without passing it records an owner exception here.

   loadGroundConfig() validates strictly (unknown keys, missing metadata and
   placeholders all fail) and returns a context with absolute paths. Paths in
   the file are repository-relative. Raw source bytes (laser, orthophotos) and
   derived rasters stay in the ignored cache; `--raw`, `--cache` and
   `--review-dir` overrides exist so a reproduction can read one cache and
   write another without touching the first.                                 */
import fs from 'node:fs';
import path from 'node:path';
import { photoDetectProblems } from './photo-detect.mjs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_KIND = 'banvy-tree-pipeline-ground';
export const DETECTORS = Object.freeze(['v2', 'typed', 'refined', 'fused']);
export const configPath = groundId => `course-workflows/${groundId}/trees.json`;

const ID = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = ['$comment', 'schemaVersion', 'kind', 'groundId', 'courseSlugs', 'provider', 'reviewId', 'reviewDir', 'cacheDir', 'geometryDir',
  'window', 'laser', 'orthophotos', 'registration', 'published', 'playZone', 'rounds', 'activeRound', 'typeRule', 'holds', 'review',
  'publication', 'ownerExceptions', 'pendingOwnerApprovals', 'ownerDecisions', 'photoDetect'];

class ConfigProblems {
  constructor() { this.list = []; }
  check(condition, message) { if (!condition) this.list.push(message); return Boolean(condition); }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const placeholder = value => typeof value === 'string' && /\bTODO\b/.test(value);

function keys(p, object, allowed, label) {
  if (!p.check(isObject(object), `${label} must be an object`)) return false;
  for (const key of Object.keys(object)) p.check(allowed.includes(key), `${label}.${key} is not a known setting`);
  return true;
}

function repoPath(p, value, label) {
  return p.check(typeof value === 'string' && value.length > 0 && !placeholder(value) && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'),
    `${label} must be a repository-relative path`);
}

function bbox(p, value, label) {
  return p.check(Array.isArray(value) && value.length === 4 && value.every(finite) && value[0] < value[2] && value[1] < value[3],
    `${label} must be [minE, minN, maxE, maxN]`);
}

/* Every string in the file is checked for TODO placeholders left by --init. */
function placeholders(p, value, label) {
  if (placeholder(value)) p.check(false, `${label} is still a placeholder`);
  else if (Array.isArray(value)) value.forEach((v, i) => placeholders(p, v, `${label}[${i}]`));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) if (!k.startsWith('$')) placeholders(p, v, `${label}.${k}`);
}

/** Validate a parsed trees.json; returns the list of problems (empty when valid). */
export function validateGroundConfig(config, { groundId = null } = {}) {
  const p = new ConfigProblems();
  if (!keys(p, config, TOP_KEYS, 'config')) return p.list;
  placeholders(p, config, 'config');
  p.check(config.schemaVersion === 1, 'schemaVersion must be 1');
  p.check(config.kind === CONFIG_KIND, `kind must be ${CONFIG_KIND}`);
  p.check(typeof config.groundId === 'string' && ID.test(config.groundId), 'groundId must be a ground id');
  if (groundId) p.check(config.groundId === groundId, `groundId ${config.groundId} does not match the requested ground ${groundId}`);
  p.check(Array.isArray(config.courseSlugs) && config.courseSlugs.length > 0 && config.courseSlugs.every(s => ID.test(s)), 'courseSlugs must list every routing on the ground');
  /* Lantmäteriet only: no Skogsstyrelsen, no photo-derived surface model */
  p.check(config.provider === 'lantmateriet', 'provider must be "lantmateriet" (the pipeline reads Lantmäteriet data only)');
  p.check(typeof config.reviewId === 'string' && /^review-\d{4}-\d{2}-\d{2}$/.test(config.reviewId), 'reviewId must be review-YYYY-MM-DD');
  if (repoPath(p, config.reviewDir, 'reviewDir')) {
    p.check(config.reviewDir.startsWith(`geo_data/course-v2/${config.groundId}/vegetation/`), 'reviewDir must be under geo_data/course-v2/<ground>/vegetation/');
  }
  if (repoPath(p, config.cacheDir, 'cacheDir')) p.check(/(^|\/)cache\//.test(config.cacheDir), 'cacheDir must be an ignored build cache (a path through a cache/ directory)');
  if (config.geometryDir !== undefined) repoPath(p, config.geometryDir, 'geometryDir');

  if (keys(p, config.window, ['inner', 'note', 'haloMetres', 'chmCellMetres'], 'window')) {
    const w = config.window.inner;
    if (keys(p, w, ['minEasting', 'minNorthing', 'maxEasting', 'maxNorthing'], 'window.inner')) {
      p.check([w.minEasting, w.minNorthing, w.maxEasting, w.maxNorthing].every(finite) && w.minEasting < w.maxEasting && w.minNorthing < w.maxNorthing,
        'window.inner must be finite EPSG:3006 bounds with min < max');
    }
    p.check(finite(config.window.haloMetres) && config.window.haloMetres >= 0, 'window.haloMetres must be >= 0');
    p.check(finite(config.window.chmCellMetres) && config.window.chmCellMetres > 0, 'window.chmCellMetres must be > 0');
  }

  if (keys(p, config.laser, ['campaigns', 'items', 'label', 'campaign', 'capturedOn', 'leafState', 'note'], 'laser')) {
    repoPath(p, config.laser.campaigns, 'laser.campaigns');
    p.check(Array.isArray(config.laser.items) && config.laser.items.length > 0 && config.laser.items.every(i => typeof i === 'string'), 'laser.items must list the pinned COPC item ids');
    p.check(typeof config.laser.label === 'string' && config.laser.label.length > 0, 'laser.label must name the campaign, date and leaf state');
    p.check(typeof config.laser.campaign === 'string' && config.laser.campaign.length > 0, 'laser.campaign must be the scan area id');
    p.check(DATE.test(config.laser.capturedOn || ''), 'laser.capturedOn must be YYYY-MM-DD');
    p.check(['leaf-off', 'leaf-on', 'mixed'].includes(config.laser.leafState), 'laser.leafState must be leaf-off, leaf-on or mixed');
  }

  if (keys(p, config.orthophotos, ['stacSearchBboxWgs84', 'items', 'campaigns', 'leafOff', 'presence', 'notFetched'], 'orthophotos')) {
    const o = config.orthophotos;
    p.check(Array.isArray(o.stacSearchBboxWgs84) && o.stacSearchBboxWgs84.length === 4 && o.stacSearchBboxWgs84.every(finite), 'orthophotos.stacSearchBboxWgs84 must be [west, south, east, north]');
    p.check(Array.isArray(o.items) && o.items.length > 0, 'orthophotos.items must list the 2.5 km item keys');
    const campaigns = Array.isArray(o.campaigns) ? o.campaigns : [];
    p.check(campaigns.length > 0, 'orthophotos.campaigns must list at least one campaign');
    const seen = new Set();
    campaigns.forEach((c, i) => {
      const label = `orthophotos.campaigns[${i}]`;
      if (!keys(p, c, ['key', 'collection', 'suffix', 'date', 'season', 'sun'], label)) return;
      p.check(typeof c.key === 'string' && /^[A-Za-z0-9]+$/.test(c.key) && !seen.has(c.key), `${label}.key must be a unique word`);
      seen.add(c.key);
      p.check(typeof c.collection === 'string' && /^orto-/.test(c.collection), `${label}.collection must be a Lantmäteriet orthophoto collection (orto-*)`);
      p.check(typeof c.suffix === 'string' && c.suffix.length > 0, `${label}.suffix must be the item suffix`);
      p.check(DATE.test(c.date || ''), `${label}.date must be YYYY-MM-DD`);
      p.check(['leaf-on', 'leaf-off'].includes(c.season), `${label}.season must be leaf-on or leaf-off`);
      p.check(isObject(c.sun) && finite(c.sun.azimuthDegrees) && finite(c.sun.elevationDegrees) && c.sun.elevationDegrees > 0,
        `${label}.sun must give the flight's sun azimuth and elevation in degrees`);
    });
    const leafOff = campaigns.find(c => c.key === o.leafOff);
    p.check(Boolean(leafOff), 'orthophotos.leafOff must name a campaign (the leaf-off photo nearest the laser date)');
    if (leafOff) p.check(leafOff.season === 'leaf-off', 'orthophotos.leafOff must be a leaf-off campaign');
    const presence = campaigns.find(c => c.key === o.presence);
    p.check(Boolean(presence), 'orthophotos.presence must name a campaign (the newest leaf-on photo)');
    if (leafOff && presence) {
      p.check(o.presence !== o.leafOff, 'orthophotos.presence and orthophotos.leafOff must be different campaigns (the felling screen compares them)');
      p.check(leafOff.date.slice(0, 7) !== presence.date.slice(0, 7), 'orthophotos.presence and orthophotos.leafOff must be from different months (per-crown evidence is keyed by the month and year of each photo)');
    }
  }

  if (keys(p, config.registration, ['pairs'], 'registration')) {
    p.check(Array.isArray(config.registration.pairs) && config.registration.pairs.length > 0 &&
      config.registration.pairs.every(x => typeof x === 'string' && /^[A-Za-z0-9]+(:[a-z]+)?@[A-Za-z0-9]+(:[a-z]+)?$/.test(x)),
    'registration.pairs must be moving[:band]@reference[:band] strings');
  }

  if (keys(p, config.published, ['publicDir', 'baselineGroundManifest', 'baselineNote', 'lineage'], 'published')) {
    repoPath(p, config.published.publicDir, 'published.publicDir');
    p.check(typeof config.published.baselineGroundManifest === 'string' && config.published.baselineGroundManifest.startsWith(`grounds/${config.groundId}/ground-v2-`),
      'published.baselineGroundManifest must pin the ground generation the review starts from (grounds/<ground>/ground-v2-<sha>.json)');
    if (config.published.lineage !== null && config.published.lineage !== undefined) {
      if (keys(p, config.published.lineage, ['groundManifest', 'label'], 'published.lineage')) {
        p.check(typeof config.published.lineage.groundManifest === 'string' && config.published.lineage.groundManifest.startsWith(`grounds/${config.groundId}/`), 'published.lineage.groundManifest must be a ground manifest URL');
        p.check(typeof config.published.lineage.label === 'string' && config.published.lineage.label.length > 0, 'published.lineage.label must name the earlier generation');
      }
    }
  }

  if (keys(p, config.playZone, ['nearMetres', 'note'], 'playZone')) {
    p.check(finite(config.playZone.nearMetres) && config.playZone.nearMetres > 0, 'playZone.nearMetres must be > 0 (the app zone A is 90 m)');
  }

  const rounds = Array.isArray(config.rounds) ? config.rounds : [];
  p.check(rounds.length > 0, 'rounds must declare at least one reference round');
  const roundIds = [];
  rounds.forEach((r, i) => {
    const label = `rounds[${i}]`;
    if (!keys(p, r, ['id', 'sampleSuffix', 'detector', 'startFrom', 'methodName', 'comparedAs', 'roles', 'evaluationRole', 'note'], label)) return;
    p.check(typeof r.id === 'string' && ID.test(r.id) && !roundIds.includes(r.id), `${label}.id must be a unique id`);
    p.check(typeof r.sampleSuffix === 'string' && /^(-[a-z0-9]+)?$/.test(r.sampleSuffix) && !rounds.slice(0, i).some(o => o.sampleSuffix === r.sampleSuffix),
      `${label}.sampleSuffix must be '' or -<word>, unique per round`);
    p.check(DETECTORS.includes(r.detector), `${label}.detector must be one of ${DETECTORS.join(', ')}`);
    if (r.startFrom !== undefined && r.startFrom !== null) {
      p.check(roundIds.includes(r.startFrom), `${label}.startFrom must name an earlier round`);
      const from = rounds.find(o => o.id === r.startFrom);
      if (from && r.detector === 'fused') p.check(from.detector === 'refined', `${label}.startFrom must be a refined round (a fused round keeps its laser lock and adds the photo crown detector)`);
      else if (from && r.detector === 'refined') p.check(from.detector === 'typed', `${label}.startFrom must be a typed round (a refined round keeps its typed settings and searches only the recovery)`);
      else if (from) p.check(from.detector === 'v2', `${label}.startFrom must be a v2 round (its lock seeds the typed descent)`);
    }
    p.check(typeof r.methodName === 'string' && r.methodName.length > 0, `${label}.methodName must name the round's detector in its benchmark`);
    p.check(Array.isArray(r.roles) && r.roles.includes('calibration') && r.roles.includes(r.evaluationRole), `${label}.roles must include calibration and the evaluation role`);
    p.check(typeof r.evaluationRole === 'string' && r.evaluationRole !== 'calibration', `${label}.evaluationRole must be a held-out role`);
    roundIds.push(r.id);
  });
  p.check(roundIds.includes(config.activeRound), 'activeRound must name a declared round');
  for (const problem of photoDetectProblems(config)) p.check(false, problem);
  for (const r of rounds.filter(o => o.detector === 'fused')) p.check(Boolean(config.photoDetect?.rounds?.includes(r.id)), `round ${r.id} is fused: photoDetect.rounds must name it`);

  if (keys(p, config.typeRule, ['round', 'broadleafMaximumAprilShare', 'unknownBelowConfidence', 'note'], 'typeRule')) {
    const t = config.typeRule;
    p.check(rounds.some(r => r.id === t.round), 'typeRule.round must name the declared round whose reference crowns calibrate the type rule');
    p.check(finite(t.broadleafMaximumAprilShare) && t.broadleafMaximumAprilShare > 0 && t.broadleafMaximumAprilShare < 1,
      'typeRule.broadleafMaximumAprilShare must be in (0, 1): a broadleaf call needs a clearly leafless leaf-off crown');
    p.check(finite(t.unknownBelowConfidence) && t.unknownBelowConfidence >= 0.5 && t.unknownBelowConfidence < 1, 'typeRule.unknownBelowConfidence must be in [0.5, 1)');
  }

  if (keys(p, config.holds, ['poleLike', 'note'], 'holds')) {
    const pole = config.holds.poleLike;
    if (pole !== null && keys(p, pole, ['maximumRadiusMetres', 'minimumHeightMetres'], 'holds.poleLike')) {
      p.check(finite(pole.maximumRadiusMetres) && pole.maximumRadiusMetres > 0 && finite(pole.minimumHeightMetres) && pole.minimumHeightMetres > 0,
        'holds.poleLike needs maximumRadiusMetres and minimumHeightMetres (null switches the hold off, recorded as such)');
    }
  }

  if (keys(p, config.review, ['spots', 'typePanels', 'typePanelSample', 'nearBroadleafShareFlag'], 'review')) {
    const r = config.review;
    p.check(Array.isArray(r.spots), 'review.spots must list the review spots');
    (r.spots || []).forEach((s, i) => {
      if (keys(p, s, ['id', 'title', 'bbox'], `review.spots[${i}]`)) {
        p.check(typeof s.id === 'string' && ID.test(s.id), `review.spots[${i}].id must be an id`);
        bbox(p, s.bbox, `review.spots[${i}].bbox`);
      }
    });
    p.check(Array.isArray(r.typePanels) && r.typePanels.every(t => isObject(t) && typeof t.course === 'string' && Array.isArray(t.holes) && t.holes.every(Number.isInteger)),
      'review.typePanels must list { course, holes } for the species spot check');
    p.check(Number.isInteger(r.typePanelSample) && r.typePanelSample > 0, 'review.typePanelSample must be a positive integer');
    p.check(finite(r.nearBroadleafShareFlag) && r.nearBroadleafShareFlag > 0 && r.nearBroadleafShareFlag < 1, 'review.nearBroadleafShareFlag must be in (0, 1)');
  }

  if (keys(p, config.publication, ['scope', 'observedOn', 'stagingRoot', 'compileOut', 'reviewStatement'], 'publication')) {
    const pub = config.publication;
    bbox(p, pub.scope, 'publication.scope');
    p.check(DATE.test(pub.observedOn || ''), 'publication.observedOn must be YYYY-MM-DD');
    if (repoPath(p, pub.stagingRoot, 'publication.stagingRoot')) {
      p.check(path.posix.normalize(pub.stagingRoot) !== path.posix.normalize(config.published?.publicDir || 'apps/golf/public') && !pub.stagingRoot.startsWith('apps/'),
        'publication.stagingRoot must be a staging copy, never the live public root');
    }
    repoPath(p, pub.compileOut, 'publication.compileOut');
    p.check(typeof pub.reviewStatement === 'string' && pub.reviewStatement.length > 20, 'publication.reviewStatement must state the review');
  }

  const exceptions = config.ownerExceptions ?? [];
  p.check(Array.isArray(exceptions), 'ownerExceptions must be a list (empty when none)');
  (Array.isArray(exceptions) ? exceptions : []).forEach((x, i) => {
    const label = `ownerExceptions[${i}]`;
    if (!keys(p, x, ['gate', 'round', 'decidedOn', 'decidedBy', 'benchmark', 'measured', 'decision', 'record'], label)) return;
    p.check(x.gate === 'held-out-precision-recall', `${label}.gate must be held-out-precision-recall`);
    p.check(roundIds.includes(x.round), `${label}.round must name a declared round`);
    p.check(DATE.test(x.decidedOn || ''), `${label}.decidedOn must be YYYY-MM-DD`);
    p.check(x.decidedBy === 'owner', `${label}.decidedBy must be "owner": only the owner can accept a failed gate`);
    p.check(isObject(x.benchmark) && typeof x.benchmark.path === 'string' && /^[a-f0-9]{64}$/.test(x.benchmark.sha256 || ''), `${label}.benchmark must pin the scored benchmark file and its SHA-256`);
    p.check(isObject(x.measured) && finite(x.measured.precision) && finite(x.measured.recall), `${label}.measured must restate the failed precision and recall`);
    p.check(typeof x.decision === 'string' && x.decision.length > 40, `${label}.decision must state the owner's decision and its reason`);
    repoPath(p, x.record, `${label}.record`);
  });
  /* a round staged for the owner before he has decided: never an exception */
  const pending = config.pendingOwnerApprovals ?? [];
  p.check(Array.isArray(pending), 'pendingOwnerApprovals must be a list (empty when none)');
  (Array.isArray(pending) ? pending : []).forEach((x, i) => {
    const label = `pendingOwnerApprovals[${i}]`;
    if (!keys(p, x, ['gate', 'round', 'status', 'recordedOn', 'recordedBy', 'benchmark', 'measured', 'comparison', 'statement', 'record'], label)) return;
    p.check(x.gate === 'held-out-precision-recall', `${label}.gate must be held-out-precision-recall`);
    p.check(roundIds.includes(x.round), `${label}.round must name a declared round`);
    p.check(x.status === 'pending-owner-approval', `${label}.status must be pending-owner-approval: it records that the owner has NOT decided`);
    p.check(typeof x.recordedBy === 'string' && x.recordedBy !== 'owner', `${label}.recordedBy names who staged it (not the owner; his decision goes in ownerExceptions)`);
    p.check(DATE.test(x.recordedOn || ''), `${label}.recordedOn must be YYYY-MM-DD`);
    p.check(isObject(x.benchmark) && typeof x.benchmark.path === 'string' && /^[a-f0-9]{64}$/.test(x.benchmark.sha256 || ''), `${label}.benchmark must pin the scored benchmark file and its SHA-256`);
    p.check(isObject(x.measured) && finite(x.measured.precision) && finite(x.measured.recall), `${label}.measured must restate the failed precision and recall`);
    p.check(typeof x.statement === 'string' && x.statement.length > 40, `${label}.statement must say what is pending and why`);
    repoPath(p, x.record, `${label}.record`);
  });
  if (config.ownerDecisions !== undefined) {
    p.check(Array.isArray(config.ownerDecisions) && config.ownerDecisions.every(d => isObject(d) && DATE.test(d.decidedOn || '') && typeof d.decision === 'string'),
      'ownerDecisions must list { decidedOn, decision, record }');
  }
  return p.list;
}

export function readGroundConfig(root, groundId) {
  const file = path.join(root, configPath(groundId));
  if (!fs.existsSync(file)) throw new Error(`no tree pipeline config for ${groundId}: create ${configPath(groundId)} (node tools/tree-pipeline.mjs --init --ground ${groundId})`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function haloWindow(config) {
  const { inner: w, haloMetres: h } = config.window;
  return Object.freeze({ minEasting: w.minEasting - h, minNorthing: w.minNorthing - h, maxEasting: w.maxEasting + h, maxNorthing: w.maxNorthing + h });
}

/** The CHM lattice over the halo window: cell edges on the window bounds. */
export function chmGrid(config) {
  const window = haloWindow(config);
  const cell = config.window.chmCellMetres;
  return Object.freeze({
    minEasting: window.minEasting,
    maxNorthing: window.maxNorthing,
    width: Math.round((window.maxEasting - window.minEasting) / cell),
    height: Math.round((window.maxNorthing - window.minNorthing) / cell),
    sampleSpacingMetres: cell,
  });
}

/**
 * A validated context: the config, absolute paths and the round helpers.
 * overrides: { cache, raw, reviewDir, round } (absolute or repo-relative).
 */
export function createContext(root, config, overrides = {}) {
  const problems = validateGroundConfig(config, { groundId: config?.groundId });
  if (problems.length) throw new Error(`course-workflows/${config?.groundId}/trees.json is not valid:\n  - ${problems.join('\n  - ')}`);
  const abs = value => path.resolve(root, value);
  const cacheDir = abs(overrides.cache ?? config.cacheDir);
  const rawDir = abs(overrides.raw ?? overrides.cache ?? config.cacheDir);
  const reviewDir = abs(overrides.reviewDir ?? config.reviewDir);
  const paths = Object.freeze({
    reviewDir, cacheDir, rawDir,
    copc: path.join(rawDir, 'copc'),
    ortho: path.join(rawDir, 'ortho'),
    rasters: path.join(cacheDir, 'rasters'),
    candidates: path.join(cacheDir, 'candidates'),
    referencePanels: path.join(cacheDir, 'reference-panels'),
    reviewPanels: path.join(cacheDir, 'review-panels'),
    typePanels: path.join(cacheDir, 'type-panels'),
    publicDir: abs(config.published.publicDir),
    geometryDir: abs(config.geometryDir ?? `geo_data/course-v2/${config.groundId}`),
  });
  const roundId = overrides.round ?? config.activeRound;
  const roundOf = id => {
    const round = config.rounds.find(r => r.id === id);
    if (!round) throw new Error(`round ${id} is not declared in trees.json (rounds: ${config.rounds.map(r => r.id).join(', ')})`);
    return round;
  };
  const round = roundOf(roundId);
  const ortho = key => {
    const campaign = config.orthophotos.campaigns.find(c => c.key === key);
    if (!campaign) throw new Error(`orthophoto campaign ${key} is not configured`);
    return campaign;
  };
  return Object.freeze({
    root, config, groundId: config.groundId, paths,
    reviewDate: config.reviewId.replace(/^review-/, ''),
    innerWindow: config.window.inner,
    haloWindow: haloWindow(config),
    chmGrid: chmGrid(config),
    round,
    roundOf,
    leafOff: ortho(config.orthophotos.leafOff),
    presence: ortho(config.orthophotos.presence),
    ortho,
    /** `${stem}${round.sampleSuffix}.${extension}` for the active (or a named) round. */
    sampleFile: (stem, extension = 'json', id = roundId) => `${stem}${roundOf(id).sampleSuffix}.${extension}`,
    reviewFile: name => path.join(reviewDir, name),
    /** a repository-relative, forward-slash path for evidence */
    rel: file => path.relative(root, file).replaceAll('\\', '/'),
  });
}

/** Read, validate and contextualise course-workflows/<ground>/trees.json. */
export function loadGroundConfig(root, groundId, overrides = {}) {
  const config = readGroundConfig(root, groundId);
  const problems = validateGroundConfig(config, { groundId });
  if (problems.length) throw new Error(`${configPath(groundId)} is not valid:\n  - ${problems.join('\n  - ')}`);
  return createContext(root, config, overrides);
}

/** A starting config for a new ground: every ground-specific value is a TODO that fails validation until filled in. */
export function configTemplate(groundId) {
  return {
    $comment: 'Tree pipeline config (docs/tree-placement-workflow.md, .claude/agents/tree-placement.md). Replace every TODO; validation fails until none is left.',
    schemaVersion: 1,
    kind: CONFIG_KIND,
    groundId,
    courseSlugs: ['TODO every routing slug on this ground'],
    provider: 'lantmateriet',
    reviewId: 'review-TODO-YYYY-MM-DD',
    reviewDir: `geo_data/course-v2/${groundId}/vegetation/review-TODO-YYYY-MM-DD`,
    cacheDir: `${groundId}build/cache/trees-TODO-YYYY-MM-DD`,
    window: { inner: { minEasting: 'TODO', minNorthing: 'TODO', maxEasting: 'TODO', maxNorthing: 'TODO' }, note: 'TODO the reviewed frontier (align to finest tile edges)', haloMetres: 60, chmCellMetres: 0.5 },
    laser: { campaigns: `geo_data/course-v2/${groundId}/acquisition/laser-campaigns.json`, items: ['TODO COPC item ids covering the halo window'], label: 'TODO <scan area> <YYYY-MM-DD> <leaf state>', campaign: 'TODO', capturedOn: 'TODO', leafState: 'TODO' },
    orthophotos: {
      stacSearchBboxWgs84: ['TODO', 'TODO', 'TODO', 'TODO'],
      items: ['TODO 2.5 km item keys, e.g. 66225_6775_25'],
      campaigns: [
        { key: 'TODO', collection: 'orto-TODO', suffix: 'TODO', date: 'TODO', season: 'leaf-off', sun: { azimuthDegrees: 'TODO', elevationDegrees: 'TODO' } },
        { key: 'TODO', collection: 'orto-TODO', suffix: 'TODO', date: 'TODO', season: 'leaf-on', sun: { azimuthDegrees: 'TODO', elevationDegrees: 'TODO' } },
      ],
      leafOff: 'TODO the leaf-off campaign nearest the laser date',
      presence: 'TODO the newest leaf-on campaign',
    },
    registration: { pairs: ['TODO:nir@laser'] },
    published: { publicDir: 'apps/golf/public', baselineGroundManifest: `grounds/${groundId}/ground-v2-TODO.json`, lineage: null },
    playZone: { nearMetres: 90, note: 'the app zone A (LEGACY_ZONE_A_METRES) from every hole line and practice area of every routing' },
    rounds: [{ id: 'r1', sampleSuffix: '', detector: 'typed', startFrom: null, methodName: 'r1-detector', roles: ['calibration', 'evaluation'], evaluationRole: 'evaluation' }],
    activeRound: 'r1',
    typeRule: { round: 'r1', broadleafMaximumAprilShare: 0.2, unknownBelowConfidence: 0.6 },
    holds: { poleLike: { maximumRadiusMetres: 1, minimumHeightMetres: 5 } },
    review: { spots: [], typePanels: [{ course: 'TODO', holes: [1] }], typePanelSample: 12, nearBroadleafShareFlag: 0.3 },
    publication: { scope: ['TODO', 'TODO', 'TODO', 'TODO'], observedOn: 'TODO', stagingRoot: `output/course-workflow/${groundId}/staging-public`, compileOut: `output/course-workflow/${groundId}/reviewed-compile`, reviewStatement: 'TODO the review statement (pinned again in production.json)' },
    ownerExceptions: [],
    pendingOwnerApprovals: [],
    ownerDecisions: [],
  };
}
