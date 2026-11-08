/* Stage `review`: the material a person and the owner review before
   publication, and the checklist that records what they decided (from the
   Johannesberg pilot's render-spots and type-panels).

   This is a HUMAN REVIEW stage: it never marks a person's or the owner's
   item done. It writes
   - spots: laser-only before/after panels per configured spot (committed:
     review/<spot>.png and review/spots.json) and the same spots over the
     photos (ignored cache: orthophoto pixels are not redistributed);
   - types: the species spot check on the photos (cache): every placed record
     within the play zone of each chosen hole drawn by type over the leaf-off
     colour infrared, and chips of a deterministic sample of its broadleaf
     calls on four photos. In leaf-off colour infrared a conifer crown is red
     and a broadleaf crown is grey-brown branches over the ground;
   - screens: chips of every felling-screened and pole-like crown with its
     current verdict (cache), for felling-review.json and pole-review.json;
   - mix: species-mix.json, the type mix of placed records by play zone and
     per hole, with holes whose broadleaf share near play passes
     review.nearBroadleafShareFlag flagged for the owner;
   - review-checklist.json: automatic items recomputed on every run, person
     and owner items kept as they were marked. Publish needs every item
     done, excepted or not applicable.

   Counts are not enough: Johannesberg's first publication had a plausible
   broadleaf count and still drew birches where spruces stand on hole 1.
   The owner checks the species mix in screenshots of the app on the GPU.  */
import fs from 'node:fs';
import path from 'node:path';
import { photoEvidenceKey, photoLabel } from './crown-evidence.mjs';
import { lineDistance, playGeometry } from './geometry.mjs';
import { Canvas, drawGrid, loadMosaic, loadRaster, renderLayer, toPixel } from './panels.mjs';
import { publishedPopulation } from './published-population.mjs';
import { writeReceipt } from './receipts.mjs';

const PLACED = new Set(['retain', 'adjust', 'add']);
const COLOURS = { retain: [60, 220, 60], adjust: [255, 230, 40], add: [0, 230, 255], hold: [255, 140, 0], remove: [255, 40, 40], merge: [190, 120, 255], 'not-placed': [160, 160, 160] };
const TYPE_COLOUR = { conifer: [255, 60, 220], broadleaf: [255, 230, 40], unknown: [255, 255, 255] };
const monthTag = campaign => photoLabel(campaign).slice(0, 3).toUpperCase();

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function overlayOld(canvas, bbox, mpp, population) {
  for (const s of population.standTrees) { const [x, y] = toPixel(bbox, mpp, s.easting, s.northing); canvas.dot(x, y, 2, [255, 160, 40]); }
  for (const r of population.records) { const [x, y] = toPixel(bbox, mpp, r.easting, r.northing); canvas.circle(x, y, r.radiusMetres / mpp, [70, 160, 255]); canvas.dot(x, y, 2, [70, 160, 255]); }
}

function overlayNew(canvas, bbox, mpp, candidates) {
  for (const t of candidates) {
    const [x, y] = toPixel(bbox, mpp, t.easting, t.northing);
    const colour = COLOURS[t.decision];
    if (['remove', 'merge', 'not-placed'].includes(t.decision)) { canvas.cross(x, y, 5, colour); continue; }
    canvas.circle(x, y, t.radiusMetres / mpp, colour, { alpha: 0.9 });
    if (t.type === 'conifer') canvas.square(x, y, 3, colour); else canvas.dot(x, y, 2.5, colour);
  }
}

/** Laser-only before/after spot panels (committed) and photo panels (cache). */
function renderSpots(ctx, candidates) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const m25 = loadMosaic(ctx, ctx.presence.key);
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const committedDir = ctx.reviewFile('review');
  const cacheDir = ctx.paths.reviewPanels;
  fs.mkdirSync(committedDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const index = [];
  const written = [];
  for (const spot of ctx.config.review.spots) {
    const { bbox } = spot;
    const size = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    const mpp = Math.max(0.1, size / 600);
    const population = publishedPopulation(ctx, { bbox: [bbox[0] - 8, bbox[1] - 8, bbox[2] + 8, bbox[3] + 8], groundManifestUrl: ctx.config.published.baselineGroundManifest });
    const local = candidates.filter(t => t.easting >= bbox[0] - 8 && t.easting < bbox[2] + 8 && t.northing >= bbox[1] - 8 && t.northing < bbox[3] + 8);
    const panel = (kind, mosaic, overlay, label) => {
      const c = kind === 'hill' ? renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp }) : renderLayer({ kind, mosaic, bbox, metresPerPixel: mpp });
      overlay(c);
      drawGrid(c, bbox, mpp, 10);
      c.text(4, c.height - 14, label, [255, 255, 255], 2);
      return c;
    };
    const old = panel('hill', null, c => overlayOld(c, bbox, mpp, population), 'BEFORE');
    const neu = panel('hill', null, c => overlayNew(c, bbox, mpp, local), 'AFTER');
    const sheet = new Canvas(old.width * 2 + 6, old.height, [40, 40, 40]);
    sheet.blit(old, 0, 0); sheet.blit(neu, old.width + 6, 0);
    const laserPanel = path.join(committedDir, `${spot.id}.png`);
    fs.writeFileSync(laserPanel, sheet.png());
    const cir = panel('cir', m25, c => overlayNew(c, bbox, mpp, local), `CIR ${ctx.presence.key} CANDIDATE`);
    const rgbOld = panel('rgb', m25, c => overlayOld(c, bbox, mpp, population), `RGB ${ctx.presence.key} BEFORE`);
    const apr = panel('rgb', m21, c => overlayNew(c, bbox, mpp, local), `RGB ${ctx.leafOff.key} ${monthTag(ctx.leafOff)} CANDIDATE`);
    const photo = new Canvas(old.width * 2 + 6, old.height * 2 + 6, [40, 40, 40]);
    photo.blit(rgbOld, 0, 0); photo.blit(cir, old.width + 6, 0); photo.blit(neu, 0, old.height + 6); photo.blit(apr, old.width + 6, old.height + 6);
    const photoPanel = path.join(cacheDir, `${spot.id}-photo.png`);
    fs.writeFileSync(photoPanel, photo.png());
    written.push(laserPanel, photoPanel);
    const count = (list, key) => list.reduce((a, t) => { const k = key(t); a[k] = (a[k] || 0) + 1; return a; }, {});
    const inside = t => t.easting >= bbox[0] && t.easting < bbox[2] && t.northing >= bbox[1] && t.northing < bbox[3];
    index.push({ ...spot, laserPanel: `review/${spot.id}.png`, photoPanelCache: ctx.rel(photoPanel), today: { records: population.records.filter(t => inside(t)).length, standTrees: population.standTrees.filter(inside).length }, candidates: count(local.filter(inside), t => t.decision) });
    console.log(spot.id, JSON.stringify(index.at(-1).today), JSON.stringify(index.at(-1).candidates));
  }
  const spotsPath = path.join(committedDir, 'spots.json');
  fs.writeFileSync(spotsPath, JSON.stringify({ legend: { today: 'blue circle = published individual record at its radius; orange dot = runtime stand tree', candidate: 'green retain, yellow adjust, cyan add, orange hold, red cross remove, purple cross merge, grey cross not placed; square = conifer, dot = broadleaf/unknown; circle = crown radius' }, spots: index }, null, 1) + '\n');
  return [spotsPath, ...written];
}

/** Four photo chips for one crown: leaf-off CIR and RGB, presence RGB and CIR. */
function chipRow(ctx, mosaics, t, k, caption, colour = [255, 230, 40]) {
  const chipMetres = 26, chipMpp = 0.13;
  const box = [t.easting - chipMetres / 2, t.northing - chipMetres / 2, t.easting + chipMetres / 2, t.northing + chipMetres / 2];
  const off = monthTag(ctx.leafOff), on = monthTag(ctx.presence);
  const panels = [['cir', mosaics.leafOff, `${off} CIR`], ['rgb', mosaics.leafOff, `${off} RGB`], ['rgb', mosaics.presence, `${on} RGB`], ['cir', mosaics.presence, `${on} CIR`]].map(([kind, mosaic, label]) => {
    const c = renderLayer({ kind, mosaic, bbox: box, metresPerPixel: chipMpp });
    const [x, y] = toPixel(box, chipMpp, t.easting, t.northing);
    c.circle(x, y, t.radiusMetres / chipMpp, colour, { alpha: 0.8 });
    c.cross(x, y, 3, colour);
    c.text(3, 3, `${k + 1} ${label}`, [255, 255, 255], 1);
    return c;
  });
  const row = new Canvas(panels[0].width * 4 + 9, panels[0].height + 14, [30, 30, 30]);
  panels.forEach((c, i) => row.blit(c, i * (c.width + 3), 0));
  row.text(3, panels[0].height + 3, caption, [230, 230, 230], 1);
  return row;
}

function writeSheets(rows, file) {
  const written = [];
  const half = Math.ceil(rows.length / 2);
  for (const [part, list] of [[1, rows.slice(0, half)], [2, rows.slice(half)]]) {
    if (!list.length) continue;
    const sheet = new Canvas(list[0].width, list.reduce((a, r) => a + r.height + 4, 0), [20, 20, 20]);
    let y = 0;
    for (const r of list) { sheet.blit(r, 0, y); y += r.height + 4; }
    const out = file.replace(/\.png$/, `-${part}.png`);
    fs.writeFileSync(out, sheet.png());
    written.push(out);
  }
  return written;
}

/** The species spot check on the photos (cache only). */
function renderTypePanels(ctx, candidates) {
  const { groundCourses } = playGeometry(ctx);
  const placed = candidates.filter(t => PLACED.has(t.decision));
  const mosaics = { leafOff: loadMosaic(ctx, ctx.leafOff.key), presence: loadMosaic(ctx, ctx.presence.key) };
  const outDir = ctx.paths.typePanels;
  fs.mkdirSync(outDir, { recursive: true });
  const leafOffKey = photoEvidenceKey(ctx.leafOff);
  const reach = ctx.config.playZone.nearMetres;
  const report = [];
  const written = [];
  for (const { course: slug, holes } of ctx.config.review.typePanels) {
    const course = groundCourses.find(c => c.slug === slug || c.courseId === slug) || groundCourses[0];
    for (const number of holes) {
      const hole = (course.geometry.holes || []).find(h => h.n === number || h.number === number || h.hole === number);
      if (!hole) throw new Error(`hole ${number} not found in ${slug}`);
      const near = placed.filter(t => lineDistance(t.easting, t.northing, hole.line) <= reach);
      const counts = near.reduce((a, t) => { a[t.type] = (a[t.type] || 0) + 1; return a; }, {});
      const es = hole.line.map(p => p[0]), ns = hole.line.map(p => p[1]);
      const bbox = [Math.min(...es) - reach - 5, Math.min(...ns) - reach - 5, Math.max(...es) + reach + 5, Math.max(...ns) + reach + 5];
      const mpp = Math.max(0.25, Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 1100);
      const overview = renderLayer({ kind: 'cir', mosaic: mosaics.leafOff, bbox, metresPerPixel: mpp });
      for (let i = 1; i < hole.line.length; i++) {
        const [x0, y0] = toPixel(bbox, mpp, ...hole.line[i - 1]), [x1, y1] = toPixel(bbox, mpp, ...hole.line[i]);
        overview.line(x0, y0, x1, y1, [0, 255, 255]);
      }
      for (const t of near) {
        const [x, y] = toPixel(bbox, mpp, t.easting, t.northing);
        const colour = TYPE_COLOUR[t.type] || TYPE_COLOUR.unknown;
        if (t.type === 'conifer') overview.square(x, y, 2, colour); else overview.circle(x, y, 3, colour, { thickness: 2 });
      }
      drawGrid(overview, bbox, mpp, 50);
      overview.text(4, overview.height - 14, `HOLE ${number} ${monthTag(ctx.leafOff)} ${ctx.leafOff.key} CIR  MAGENTA SQUARE CONIFER  YELLOW RING BROADLEAF  WHITE UNKNOWN`, [255, 255, 255], 2);
      const overviewPath = path.join(outDir, `${slug}-hole${number}-overview.png`);
      fs.writeFileSync(overviewPath, overview.png());
      written.push(overviewPath);
      const broad = near.filter(t => t.type === 'broadleaf').sort((a, b) => hash(a.id) - hash(b.id)).slice(0, ctx.config.review.typePanelSample);
      const rows = broad.map((t, k) => {
        report.push({ course: slug, hole: number, n: k + 1, id: t.id, easting: t.easting, northing: t.northing, height: t.objectHeightMetres, radius: t.radiusMetres, leafOffVegetatedShare: t.evidence?.[leafOffKey]?.vegetatedShare, firstCanopyShare: t.evidence?.laser?.firstCanopyShare, groundShare: t.evidence?.laser?.groundShare, typeConfidence: t.typeConfidence, decision: t.decision, source: t.source, verdict: null });
        return chipRow(ctx, mosaics, t, k, `${k + 1} ${t.id} H${t.objectHeightMetres} R${t.radiusMetres} ${monthTag(ctx.leafOff)}VEG ${t.evidence?.[leafOffKey]?.vegetatedShare} CONF ${t.typeConfidence} ${t.decision}`);
      });
      written.push(...writeSheets(rows, path.join(outDir, `${slug}-hole${number}-broadleaf.png`)));
      console.log(`${slug} hole ${number}: ${near.length} placed within ${reach} m`, JSON.stringify(counts), `sampled ${broad.length} broadleaf`);
    }
  }
  const samplePath = path.join(outDir, 'type-sample.json');
  fs.writeFileSync(samplePath, JSON.stringify({ note: 'fill each verdict (broadleaf | conifer | not-tree | unclear) from the chips, then record the tally in review-checklist.json (species-spot-check-photos)', sample: report }, null, 1) + '\n');
  return [samplePath, ...written];
}

/** Chips of every felling-screened and pole-like crown (cache only). */
function renderScreens(ctx) {
  const mosaics = { leafOff: loadMosaic(ctx, ctx.leafOff.key), presence: loadMosaic(ctx, ctx.presence.key) };
  const outDir = ctx.paths.reviewPanels;
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [name, file, colour] of [['felling', 'felling-screen.json', [255, 80, 80]], ['poles', 'pole-screen.json', [80, 200, 255]]]) {
    const source = path.join(ctx.paths.candidates, file);
    if (!fs.existsSync(source)) continue;
    const screened = JSON.parse(fs.readFileSync(source, 'utf8')).sort((a, b) => (a.verdict === 'unreviewed' ? 0 : 1) - (b.verdict === 'unreviewed' ? 0 : 1) || a.key.localeCompare(b.key));
    for (let start = 0; start < screened.length; start += 12) {
      const page = screened.slice(start, start + 12);
      const rows = page.map((t, k) => chipRow(ctx, mosaics, { ...t, radiusMetres: t.radiusMetres || 2 }, start + k, `${start + k + 1} ${t.key} H${t.heightMetres} R${t.radiusMetres} VERDICT ${String(t.verdict).toUpperCase()}`, colour));
      written.push(...writeSheets(rows, path.join(outDir, `screens-${name}-${String(start / 12 + 1).padStart(2, '0')}.png`)));
    }
    console.log(`${name}: ${screened.length} screened, ${screened.filter(t => t.verdict === 'unreviewed').length} unreviewed`);
  }
  return written;
}

/** The type mix of placed records by play zone and per hole. */
export function speciesMix(ctx, candidates, holes) {
  const placed = candidates.filter(t => PLACED.has(t.decision));
  const tally = list => {
    const out = { conifer: 0, broadleaf: 0, unknown: 0, total: list.length };
    for (const t of list) out[t.type in out ? t.type : 'unknown']++;
    out.broadleafShare = list.length ? Math.round((1000 * out.broadleaf) / list.length) / 1000 : 0;
    return out;
  };
  const flag = ctx.config.review.nearBroadleafShareFlag;
  const byZone = { near: tally(placed.filter(t => t.play === 'near')), woodland: tally(placed.filter(t => t.play === 'woodland')) };
  const byHole = holes.map(({ slug, number, line }) => ({ course: slug, hole: number, ...tally(placed.filter(t => lineDistance(t.easting, t.northing, line) <= ctx.config.playZone.nearMetres)) }));
  const flagged = byHole.filter(h => h.total >= 10 && h.broadleafShare > flag).map(h => `${h.course} hole ${h.hole}: ${h.broadleaf} of ${h.total} near-play records typed broadleaf (${Math.round(100 * h.broadleafShare)}%)`);
  return {
    schemaVersion: 1, kind: 'tree-species-mix', groundId: ctx.groundId, reviewId: ctx.config.reviewId,
    note: `placed records by type; unknown records and the stand field take the runtime's own mix (the course rule or the engine's conifer-led background), so counts are not what the player draws: the owner checks screenshots. Holes with at least 10 near-play records and a broadleaf share above ${flag} are flagged.`,
    byZone, byHole, flagged,
  };
}

const CHECK_ITEMS = Object.freeze([
  { id: 'reference-frozen', who: 'auto', question: 'The round\'s reference sample is frozen and its lock matches (who interpreted it is recorded in the lock).' },
  { id: 'held-out-gate', who: 'auto', question: 'The 90% held-out gate passed, or the owner recorded an exception pinning this benchmark in trees.json.' },
  { id: 'felling-screen-reviewed', who: 'auto', question: 'Every felling-screened crown has a verdict in felling-review.json.' },
  { id: 'felled-list-confirmed', who: 'owner', question: 'The owner confirmed the trees decided felled or not a tree since the laser (removals and not placed).' },
  { id: 'pole-like-reviewed', who: 'auto', question: 'Every pole-like crown (holds.poleLike) has a verdict in pole-review.json, or the hold is switched off and recorded as such.' },
  { id: 'species-spot-check-photos', who: 'person', question: 'The broadleaf calls near play were checked on the leaf-off and presence photos (type-panels chips); tally of verdicts recorded in the note.' },
  { id: 'species-mix-flags', who: 'auto', question: 'No hole is flagged for a high broadleaf share near play (species-mix.json), or the owner accepted each flag.' },
  { id: 'species-mix-screenshots', who: 'owner', question: 'The owner compared before/after screenshots of the app on the GPU (holes near play) and the species mix reads right.' },
  { id: 'runtime-cost-measured', who: 'owner', question: 'Frame times before/after were measured on the owner\'s GPU (interleaved runs, high and low quality) and accepted.' },
]);

/** Merge the automatic items into an existing checklist, keeping every person/owner mark. */
export function mergeChecklist(existing, auto) {
  const previous = new Map((existing?.items || []).map(item => [item.id, item]));
  return CHECK_ITEMS.map(item => {
    if (item.who === 'auto') return { ...item, ...auto[item.id] };
    const kept = previous.get(item.id);
    return kept && kept.who === item.who ? { ...item, status: kept.status, by: kept.by ?? null, on: kept.on ?? null, evidence: kept.evidence ?? null, note: kept.note ?? null }
      : { ...item, status: 'open', by: null, on: null, evidence: null, note: null };
  });
}

/** Items that block publication: anything not done / excepted / not applicable, and person or owner marks without who and when. */
export function openItems(checklist) {
  return checklist.items.filter(item => !['done', 'excepted', 'not-applicable'].includes(item.status) || (item.who !== 'auto' && item.status === 'done' && !(item.by && item.on)));
}

export async function run(ctx, options) {
  const fullPath = path.join(ctx.paths.candidates, 'candidates-full.json');
  const candidates = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const only = options.only ? options.only.split(',') : ['spots', 'types', 'screens', 'mix'];
  const written = [];
  if (only.includes('spots')) written.push(...renderSpots(ctx, candidates));
  if (only.includes('types')) written.push(...renderTypePanels(ctx, candidates));
  if (only.includes('screens')) written.push(...renderScreens(ctx));
  const { groundCourses } = playGeometry(ctx);
  const holes = groundCourses.flatMap(c => (c.geometry.holes || []).filter(h => Array.isArray(h.line) && h.line.length >= 2).map(h => ({ slug: c.slug, number: h.n ?? h.number ?? h.hole, line: h.line })));
  const mix = speciesMix(ctx, candidates, holes);
  const mixPath = ctx.reviewFile('species-mix.json');
  if (only.includes('mix')) { fs.writeFileSync(mixPath, JSON.stringify(mix, null, 1) + '\n'); written.push(mixPath); }
  /* the checklist's automatic items */
  const { gateReport } = await import('./benchmark.mjs');
  const summary = JSON.parse(fs.readFileSync(ctx.reviewFile('candidates-summary.json'), 'utf8'));
  const lockPath = ctx.reviewFile(ctx.sampleFile('reference-lock'));
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : null;
  let gate = null;
  try { gate = gateReport(ctx); } catch (error) { gate = { error: error.message }; }
  const unreviewedFelling = summary.fellingScreen?.byVerdict?.unreviewed ?? 0;
  const pole = summary.poleScreen;
  const today = new Date().toISOString().slice(0, 10);
  const auto = {
    'reference-frozen': lock ? { status: 'done', by: lock.interpreter, on: lock.frozenAt.slice(0, 10), evidence: ctx.rel(lockPath) } : { status: 'open', note: 'no reference lock' },
    'held-out-gate': gate?.gate ? (gate.gate.status === 'PASS' ? { status: 'done', on: today, evidence: gate.benchmark.path, note: `P ${gate.gate.measured.precision} R ${gate.gate.measured.recall}` }
      : gate.verdict.allowed ? { status: 'excepted', by: 'owner', on: gate.verdict.ownerException.decidedOn, evidence: gate.verdict.ownerException.record, note: gate.verdict.note }
        : { status: 'open', note: gate.verdict.note }) : { status: 'open', note: gate?.error || 'no benchmark' },
    'felling-screen-reviewed': unreviewedFelling ? { status: 'open', note: `${unreviewedFelling} screened crowns unreviewed` } : { status: 'done', on: today, evidence: ctx.rel(ctx.reviewFile('felling-review.json')), note: JSON.stringify(summary.fellingScreen?.byVerdict ?? {}) },
    'pole-like-reviewed': !ctx.config.holds.poleLike ? { status: 'not-applicable', note: `holds.poleLike is switched off in trees.json: ${ctx.config.holds.note || 'no reason recorded'}` }
      : (pole?.byVerdict?.unreviewed ?? 0) ? { status: 'open', note: `${pole.byVerdict.unreviewed} pole-like crowns unreviewed` } : { status: 'done', on: today, evidence: ctx.rel(ctx.reviewFile('pole-review.json')), note: JSON.stringify(pole?.byVerdict ?? {}) },
    'species-mix-flags': mix.flagged.length ? { status: 'open', note: `flagged for the owner: ${mix.flagged.join('; ')}` } : { status: 'done', on: today, evidence: ctx.rel(mixPath), note: `near play: ${mix.byZone.near.conifer} conifer, ${mix.byZone.near.broadleaf} broadleaf, ${mix.byZone.near.unknown} unknown` },
  };
  const checklistPath = ctx.reviewFile('review-checklist.json');
  const existing = fs.existsSync(checklistPath) ? JSON.parse(fs.readFileSync(checklistPath, 'utf8')) : null;
  /* an owner's acceptance of the flags is kept: the flag item stays done once the owner marked it */
  const previousFlags = existing?.items?.find(i => i.id === 'species-mix-flags');
  if (auto['species-mix-flags'].status === 'open' && previousFlags?.status === 'excepted' && previousFlags.by === 'owner' && previousFlags.note?.includes(mix.flagged.join('; '))) auto['species-mix-flags'] = previousFlags;
  const checklist = {
    schemaVersion: 1, kind: 'tree-review-checklist', groundId: ctx.groundId, reviewId: ctx.config.reviewId, round: ctx.round.id,
    howToMark: 'person and owner items: set status to done (with by, on and evidence or a note) or not-applicable with a reason; only the owner marks owner items. Automatic items are recomputed on every review run.',
    items: mergeChecklist(existing, auto),
  };
  fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2) + '\n');
  writeReceipt(ctx, 'review', { inputs: [fullPath, ctx.reviewFile('candidates.csv')], outputs: [...written, checklistPath], options: { only }, result: { flagged: mix.flagged, open: openItems(checklist).map(i => i.id) } });
  const open = openItems(checklist);
  if (open.length) {
    return { status: 'stop', message: `review material written (${written.length} files; photo panels in ${ctx.rel(ctx.paths.cacheDir)}).
OPEN ITEMS in ${ctx.rel(checklistPath)}:
${open.map(i => `  - [${i.who}] ${i.id}: ${i.question}${i.note ? ` (${i.note})` : ''}`).join('\n')}
Stop here: a person reviews the chips and panels; the owner marks the owner items. Then rerun --stage review and --stage publish.` };
  }
  return { status: 'done', message: `review complete: every checklist item is closed (${ctx.rel(checklistPath)})` };
}
