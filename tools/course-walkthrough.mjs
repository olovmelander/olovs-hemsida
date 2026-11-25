#!/usr/bin/env node
/* A ground's walkthrough, and the catalogue's status table, written from the build's own records.

   node tools/course-walkthrough.mjs --ground <id>            write docs/courses/<id>-walkthrough.md
   node tools/course-walkthrough.mjs --ground <id> --check    fail when its generated parts are stale
   node tools/course-walkthrough.mjs --ground <id> --pictures the first pictures to take, as commands (prints only)
   node tools/course-walkthrough.mjs --catalogue [--check]    the status table in docs/pipeline-v2.md

   A walkthrough is the document a course is accepted on, and the list an upgrade starts from. Its numbers
   went stale once already (Bro Hof, the night it was published), so every number in it is generated: the
   parts between `<!-- generated:NAME -->` markers come from the published catalogue, the course models, the
   card, the trace report, the ring review, the quality gate, the tree review and the release records. What
   only a person can say (what is known not to be right, what to look at, how each fault was found) is
   written by hand around them and is kept on every run. A new file starts with prompts where that writing
   goes; --check fails while a prompt is left. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGround, loadGround } from '../packages/course-workflow/audit.mjs';
import { checkGroundQuality } from './check-course-quality.mjs';
import { secondLookSummary } from '../packages/course-geo/mapping/ring-review.mjs';
import { DECK_OFF_PLANE_LINE } from '../packages/course-geo/mapping/deck-ground.mjs';
import { sandAuditSummary } from '../packages/course-geo/mapping/sand-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://olovmelander.github.io/olovs-hemsida/';
const PROMPT = '_To write:';
const TREE_GATE = 0.9, CARD_FLAG_METRES = 5, WATER_REACH_METRES = 30, CREEK_REACH_METRES = 15;

const exists = p => fs.existsSync(path.join(ROOT, p));
const json = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const maybe = p => (exists(p) ? json(p) : null);
const sum = list => list.reduce((a, b) => a + b, 0);
const number = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const metres = v => `${(Math.round(v * 10) / 10).toFixed(1)} m`;

/* ---------------------------------------------------------------- geometry */

const segmentGap = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
const inside = (p, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};
const box = points => points.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
const along = (line, step) => {
  const out = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  if (line.length) out.push(line.at(-1));
  return out;
};
/** Whether any of `points` lies within `reach` metres of a closed ring (or inside it) or of an open line. */
function reaches(points, shape, reach, closed) {
  const b = shape.box;
  const close = points.filter(p => p[0] >= b[0] - reach && p[0] <= b[2] + reach && p[1] >= b[1] - reach && p[1] <= b[3] + reach);
  if (!close.length) return false;
  const last = closed ? shape.points.length : shape.points.length - 1;
  return close.some(p => (closed && inside(p, shape.points))
    || Array.from({ length: last }, (_, i) => i).some(i => segmentGap(p, shape.points[i], shape.points[(i + 1) % shape.points.length]) <= reach));
}

/* ------------------------------------------------------------------- facts */

function routingFacts(row, quality) {
  const model = json(`${row.build}/course-model.json`);
  const trace = maybe(`${row.build}/mapping/trace-report.json`);
  const surfaces = maybe(`${row.build}/mapping/playing-surfaces.geojson`);
  const review = maybe(`${row.build}/mapping/ring-review.json`);
  const deckGround = maybe(`${row.build}/mapping/deck-ground.json`);
  const second = secondLookSummary(review?.second);
  const holeOf = id => { const m = /-(?:tee|bunker)-(\d+)-\d+$|-green-(\d+)$/.exec(id); return m ? Number(m[1] ?? m[2]) : null; };
  const routes = new Map((trace?.rows ?? []).filter(r => r.kind === 'route').map(r => [r.hole, r.cardResidual]));
  const lakes = (model.water ?? []).filter(w => !w.stream && w.ring?.length >= 3).map(w => ({ points: w.ring, box: box(w.ring) }));
  const creeks = [...(model.streams ?? []), ...(model.water ?? []).filter(w => w.stream)].filter(s => s.line?.length >= 2)
    .map(s => ({ points: s.line, box: box(s.line) }));
  const wastes = (model.scenery?.mappedFeatures ?? []).filter(f => f.kind === 'waste_sand' && f.rings?.[0]?.length >= 3).map(f => ({ points: f.rings[0], box: box(f.rings[0]) }));
  const marks = [];
  const holes = model.holes.map(hole => {
    const played = [...along(hole.line ?? [], 5), ...(hole.green?.ring ?? [])];
    const residual = routes.get(hole.n) ?? null;
    const worst = residual ? Object.entries(residual).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] : null;
    if (residual) for (const [tee, v] of Object.entries(residual)) marks.push({ hole: hole.n, tee, metres: v });
    const flags = [
      ...(worst && Math.abs(worst[1]) > CARD_FLAG_METRES ? [`${worst[0]} tee ${worst[1] > 0 ? '+' : ''}${worst[1]} m against the card`] : []),
      ...quality.filter(line => line.startsWith(`${row.slug} h${hole.n}:`)).map(line => line.slice(line.indexOf(':') + 2)),
      ...(deckGround?.off ?? []).filter(deck => deck.hole === hole.n)
        .map(deck => `${deck.tees.join('/') || 'unused'} deck not on level ground in the terrain (${deck.slope}% slope${deck.offPlane > DECK_OFF_PLANE_LINE ? `, ${deck.offPlane} m off a plane` : ''})`),
      ...(second?.faults ?? []).filter(fault => holeOf(fault.id) === hole.n).map(fault => `second look: \`${fault.id}\` is a fault`),
    ];
    return {
      n: hole.n, name: hole.name ?? '', par: hole.par, index: hole.idx ?? null, back: hole.t?.[0] ?? null,
      decks: Array.isArray(hole.tees) ? 0 : hole.tees?.pads?.length ?? 0, bunkers: hole.bunkers?.length ?? 0,
      water: [...(lakes.some(l => reaches(played, l, WATER_REACH_METRES, true)) ? ['water'] : []),
        ...(creeks.some(c => reaches(played, c, CREEK_REACH_METRES, false)) ? ['creek'] : []),
        ...(wastes.some(w => reaches(played, w, CREEK_REACH_METRES, true)) ? ['waste'] : [])],
      card: worst ? Math.abs(worst[1]) : null, flags,
    };
  });
  // Only a build traced with the shared tracer has outlines that are the model's own. An older build's file of the same
  // name is an intermediate of its own builder, and can be months behind what is published: count the model there.
  const count = kind => (surfaces && trace ? surfaces.features.filter(f => f.properties.kind === kind) : null);
  const waste = count('waste_sand') ?? (model.scenery?.mappedFeatures ?? []).filter(f => f.kind === 'waste_sand').map(f => ({ geometry: { coordinates: f.rings } }));
  const abs = marks.map(m => Math.abs(m.metres)).sort((a, b) => a - b);
  const worstMark = marks.slice().sort((a, b) => Math.abs(b.metres) - Math.abs(a.metres))[0] ?? null;
  return {
    slug: row.slug, name: row.name, label: row.tag || row.name, build: row.build, par: row.par, teeNames: row.tees.names, posters: row.photos ?? 0,
    prepared: ['preparedWater', 'preparedTint', 'preparedVista', 'preparedScatter'].filter(k => row[k]).length, scorecard: !!row.scorecard,
    preparedOf: row.preparedWaterUnsupported ? 3 : 4, // a course that keeps its measured water path has no water record to bake
    lengths: row.tees.names.map((_, i) => sum(model.holes.map(h => h.t?.[i] ?? 0))),
    greens: count('green')?.length ?? holes.length, decks: count('tee')?.length ?? sum(holes.map(h => h.decks)),
    fairways: count('fairway')?.length ?? sum(model.holes.map(h => h.fairway?.rings?.length ?? (h.fairway ? 1 : 0))),
    bunkers: count('bunker')?.length ?? sum(holes.map(h => h.bunkers)),
    wasteAreas: waste.length, wasteIslands: sum(waste.map(f => Math.max(0, f.geometry.coordinates.length - 1))),
    card: abs.length ? { marks: abs.length, median: abs[abs.length >> 1], within: abs.filter(v => v <= CARD_FLAG_METRES).length, worst: worstMark } : null,
    traced: trace ? { on: trace.provenance?.imagery?.captured ?? trace.provenance?.captured ?? null } : null,
    review, second, deckGround, holes, model,
  };
}

function treeFacts(groundId) {
  const config = maybe(`course-workflows/${groundId}/trees.json`);
  if (!config) return null;
  const summary = maybe(`${config.reviewDir}/candidates-summary.json`);
  const score = maybe(`${config.reviewDir}/pipeline/benchmark-score.json`)?.result?.evaluation ?? null;
  return {
    reviewId: config.reviewId, reviewDir: config.reviewDir, placed: summary?.candidates?.placedTrees ?? null,
    held: summary?.candidates?.byDecision?.hold ?? null, before: summary?.today?.total ?? null, score,
    gate: score ? score.precision >= TREE_GATE && score.recall >= TREE_GATE : null,
  };
}

export function groundFacts(groundId) {
  const graph = loadGround(ROOT, groundId), audit = inspectGround(ROOT, groundId);
  const index = json('apps/golf/public/courses/index.json').courses;
  const report = checkGroundQuality({ groundId, publicRoot: path.join(ROOT, 'apps/golf/public') });
  const quality = [...report.errors.map(e => `${e} (error)`), ...report.warnings];
  const routings = graph.courses.map(c => index.find(row => row.slug === c.slug)).sort((a, b) => index.indexOf(a) - index.indexOf(b))
    .map(row => routingFacts(row, quality));
  const model = routings[0].model;
  // The sand audit is the ground's, kept in the build that holds its trace configuration; its faults go on their holes.
  const sandBuild = routings.map(x => x.build).find(build => exists(`${build}/mapping/sand-audit.json`));
  const sand = sandBuild ? sandAuditSummary(json(`${sandBuild}/mapping/sand-audit.json`)) : null;
  for (const fault of sand?.faults ?? []) routings.find(x => x.slug === fault.slug)?.holes.find(h => h.n === fault.hole)?.flags.push(`sand audit: \`${fault.id}\` is a fault`);
  const workflow = maybe(`course-workflows/${groundId}/workflow.json`), acceptance = maybe(`course-workflows/${groundId}/owner-acceptance.json`);
  const facilities = maybe(`apps/golf/public/models/${groundId}/facilities-v1.json`);
  const roofs = maybe(`geobuild/facilities/roof-colours/${groundId}.json`);
  const source = name => audit.sources.find(s => s.roles.includes(name) && s.capturedAt)?.capturedAt ?? null;
  // A terrain model is a mosaic: its one date is its newest patch, and the ground under a given hole may be years older.
  const flown = (maybe(`geo_data/course-v2/${groundId}/acquisition/d2-discovery.json`)?.terrain?.items ?? []).filter(item => item.captureStart && item.captureEnd);
  const day = (list, pick) => list.map(text => text.slice(0, 10)).sort().at(pick);
  const kinds = {};
  for (const b of model.infra?.bulkheads ?? []) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
  return {
    groundId, club: routings[0] && index.find(row => row.slug === routings[0].slug).club, routings,
    generation: graph.courses[0].groundManifest.sha256, tiles: graph.ground.tiles.length, layers: audit.layers,
    captured: { terrain: source('terrain'), imagery: source('imagery'), canopy: source('canopy'),
      terrainFlights: flown.length ? [day(flown.map(item => item.captureStart), 0), day(flown.map(item => item.captureEnd), -1)] : null },
    lakes: (model.water ?? []).filter(w => !w.stream).length, streams: (model.streams ?? []).length,
    bridges: (model.infra?.bridges ?? []).length, bulkheads: kinds, buildings: (model.infra?.buildings ?? []).length,
    cartRows: (model.scenery?.cartParks ?? []).length + (model.scenery?.cartPark ? 1 : 0),
    carts: sum([model.scenery?.cartPark, ...(model.scenery?.cartParks ?? [])].filter(Boolean).map(row => row.count ?? 0)),
    roofs: roofs ? { measured: roofs.buildings.filter(b => b.roof).length } : null,
    facilities: facilities ? { parts: facilities.facilities.map(f => f.id), bytes: facilities.asset.bytes,
      triangles: sum(facilities.facilities.map(f => f.triangles ?? 0)) || facilities.triangles || report.summary?.facilities?.triangles || null } : null,
    sand, trees: treeFacts(groundId), quality: { errors: report.errors.length, warnings: report.warnings.length, unplaced: quality.filter(line => !/ h\d+:/.test(line)) },
    release: { policy: workflow?.releasePolicy ?? null, acceptance, blockers: audit.blockers.filter(b => b.severity === 'release-blocking'), frame: audit.frameStatus },
    walkthrough: exists(`docs/courses/${groundId}-walkthrough.md`),
  };
}

/* ------------------------------------------------------------------ blocks */

const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const link = (text, slug, query) => `[${text}](${SITE}?bana=${slug}&${query})`;

function summaryBlock(f) {
  const r = f.routings, each = fn => r.map(fn);
  const rows = [
    ['Holes and par', ...each(x => `${x.holes.length}, par ${x.par}`)],
    ['Tees on the card', ...each(x => x.teeNames.map((name, i) => `${name} ${number(x.lengths[i])} m`).join(', '))],
    ['Greens, tee decks, fairways, bunkers', ...each(x => `${x.greens}, ${x.decks}, ${x.fairways}, ${x.bunkers}`)],
    ['Waste areas', ...each(x => (x.wasteAreas ? `${x.wasteAreas}, with ${x.wasteIslands} grass islands` : 'none'))],
    ['Tee marks against the card', ...each(x => (x.card
      ? `${x.card.marks} marks, median ${metres(x.card.median)}, ${x.card.within} within ${CARD_FLAG_METRES} m, worst ${metres(Math.abs(x.card.worst.metres))} (hole ${x.card.worst.hole}, ${x.card.worst.tee})`
      : 'not measured'))],
    ['Outlines looked at ring by ring', ...each(x => (x.review ? `${x.review.reviewedOn}: ${number(sum(Object.values(x.review.rings)))} rings, ${x.review.redrawn.length} redrawn` : 'no record'))],
    ['A second, blind look at them', ...each(x => (x.second
      ? `${x.second.reviewedOn}: ${x.second.doubts} doubts, ${x.second.stand.length} stand, ${x.second.faults.length} kept as faults; ${x.second.cannotTell} it could not judge`
      : 'none'))],
    ['Tee decks on level ground in the terrain', ...each(x => (x.deckGround ? `${x.deckGround.level} of ${x.deckGround.measured} measured` : 'not measured'))],
    ['Posters, prepared data, scorecard', ...each(x => `${x.posters}, ${x.prepared} of ${x.preparedOf}${x.preparedOf === 3 ? ' (its water is kept live, by design)' : ''}, ${x.scorecard ? 'yes' : 'no'}`)],
  ];
  const walls = Object.entries(f.bulkheads).map(([kind, n]) => `${n} ${kind}`).join(' and ');
  const t = f.trees, a = f.release.acceptance;
  const lines = [
    `- **Ground:** ${f.tiles} terrain tiles (terrain ${f.captured.terrainFlights ? `a mosaic of flights from ${f.captured.terrainFlights[0]} to ${f.captured.terrainFlights[1]}` : f.captured.terrain ?? 'undated'}, photo ${f.captured.imagery ?? 'undated'}, laser ${f.captured.canopy ?? 'undated'}), `
      + `${f.lakes} lakes and ponds, ${f.streams} creeks and ditches, ${f.bridges} bridges${walls ? `, water edges: ${walls}` : ''}. Generation \`${f.generation.slice(0, 12)}\`.`,
    t ? `- **Trees:** ${t.placed != null ? `${number(t.placed)} placed one by one` : 'placed one by one'} (${t.reviewId})`
      + (t.score ? `; on unseen trees precision ${t.score.precision.toFixed(3)}, recall ${t.score.recall.toFixed(3)}, F1 ${t.score.f1.toFixed(3)}: the ${TREE_GATE * 100}% gate is ${t.gate ? 'met' : '**missed**'}` : '')
      + (t.held != null ? `; ${number(t.held)} doubtful trees held back` : '') + `. [Review](../../${t.reviewDir}/README.md).`
      : `- **Trees:** automatic (${number(f.layers.objects)} object tiles, ${number(f.layers.stands)} stand tiles); not placed one by one.`,
    `- **Buildings:** ${number(f.buildings)} mapped`
      + (f.roofs ? `, ${number(f.roofs.measured)} with a roof colour measured on the photo` : '')
      + (f.facilities ? `; an authored campus of ${f.facilities.parts.length} parts (${f.facilities.parts.join(', ')})${f.facilities.triangles ? `, ${number(f.facilities.triangles)} triangles` : ''}` : '')
      + (f.carts ? `; ${f.carts} golf carts in ${f.cartRows} rows` : '') + '.',
    `- **Quality gate:** ${f.quality.errors} errors, ${f.quality.warnings} warnings (\`tools/check-course-quality.mjs\`); each is on its hole below.`
      + (f.quality.unplaced.length ? ` Not tied to a hole: ${f.quality.unplaced.join('; ')}.` : ''),
    a ? `- **Release:** on the owner's acceptance of ${a.acceptedOn}, with ${Object.keys(a.open).length} items open:\n${Object.entries(a.open).map(([id, why]) => `  - \`${id}\`: ${why}`).join('\n')}`
      : `- **Release:** policy \`${f.release.policy ?? 'none'}\`, frame \`${f.release.frame}\`${f.release.blockers.length ? `, open: ${f.release.blockers.map(b => `\`${b.id}\``).join(', ')}` : ''}.`,
  ];
  if (f.sand) {
    lines.splice(1, 0, `- **Sand:** the ${f.sand.captured ?? 'tracing'} photo was read round every hole against the model's ${number(f.sand.modelled)} bunkers and waste areas: `
      + `${f.sand.ringsNamed} of them hold little sand or have sand outside their line, and ${f.sand.areas} areas of bright sand are not in the model, ${f.sand.onNothingMapped} of those on nothing the map holds. `
      + (f.sand.open.length ? `**${f.sand.open.length} have no verdict yet.**` : `Each has a verdict; ${f.sand.faults.length} ${f.sand.faults.length === 1 ? 'is' : 'are'} kept as a fault.`));
  }
  const faults = [...r.flatMap(x => x.second?.faults ?? []), ...(f.sand?.faults ?? [])].map(fault => `  - \`${fault.id}\`: ${fault.fault}`);
  if (faults.length) lines.push(`- **Faults the second look and the sand audit found, kept until they can be put right:**\n${faults.join('\n')}`);
  return `## What is there\n\n${table(['', ...each(x => x.label)], rows)}\n\n${lines.join('\n')}`;
}

function holesBlock(f) {
  const parts = f.routings.map(x => {
    const rows = x.holes.map(h => [h.n, h.name, h.par, h.index ?? '', h.back != null ? `${h.back} m` : '', h.decks, h.bunkers, h.water.join(', '),
      h.card != null ? metres(h.card) : '', h.flags.join('; '),
      `${link('tee', x.slug, `hal=${h.n}&vy=tee`)} · ${link('green', x.slug, `hal=${h.n}&vy=green`)} · ${link('map', x.slug, `hal=${h.n}&karta=1`)}`]);
    return `### ${x.label}\n\n${table(['Hole', 'Name', 'Par', 'Index', 'Back tee', 'Decks', 'Bunkers', 'Beside it', 'Card', 'To look at', 'Open'], rows)}`;
  });
  return `## Hole by hole\n\n"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;\nan empty cell is no promise that the hole is right.\n\n${parts.join('\n\n')}`;
}

function checksBlock(f) {
  const slugs = f.routings.map(x => x.slug), first = f.routings[0];
  const views = f.routings.flatMap(x => [`${x.slug}:1:tee:dag`, `${x.slug}:${x.holes.length}:green:kvall`]).join(',');
  return `## Checking it yourself

\`\`\`sh
node tools/check-course-quality.mjs --ground ${f.groundId}          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground ${f.groundId} --check    # this page against the records
node tools/course-walkthrough.mjs --ground ${f.groundId} --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=${first.slug}&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc ${views}
BANVY_GPU=1 node tools/gpu-pass.mjs --only ${slugs.join(',')} --from boot-hi
\`\`\`

The GPU and browser lines are the owner's to start (in PowerShell: \`$env:BANVY_GPU=1\` first).`;
}

/* THE FIRST PICTURES. Five of Bro Hof's faults were found by a picture and by no check: ponds standing low inside
   their walls, tees under water, waste sand greying with distance, every broadleaf a birch, and ground missing from
   the phone map. So the first pictures are chosen from the ground's own records, each for a fault it can show, and
   they are taken BEFORE the bakes: an engine fix after a bake means baking every course again. */
export function pictureList(facts) {
  const views = [];
  for (const x of facts.routings) {
    const add = (hole, vy, why) => { if (!views.some(v => v.slug === x.slug && v.hole === hole && v.vy === vy)) views.push({ slug: x.slug, hole, vy, why }); };
    const spread = (list, most) => list.filter((_, i) => list.length <= most || Math.floor(i * most / list.length) !== Math.floor((i - 1) * most / list.length));
    add(1, 'tee', 'the first thing a player sees: trees, species, the tee deck under the markers');
    add(x.holes.length, 'green', 'the last green, which is usually by the buildings');
    for (const h of spread(x.holes.filter(h => h.water.some(k => k !== 'waste')), 5)) add(h.n, 'fritt', 'water against its banks, walls and tees');
    for (const h of spread(x.holes.filter(h => h.water.includes('waste')), 3)) add(h.n, 'fritt', 'waste sand: its colour at a distance, its islands on the map');
    for (const h of spread(x.holes.filter(h => h.par === 3), 3)) add(h.n, 'tee', 'a short hole whole, from its tee');
    for (const h of x.holes.filter(h => h.flags.length).slice(0, 4)) add(h.n, 'green', `flagged: ${h.flags[0]}`);
  }
  return views;
}

export function picturePlan(facts, base = 'http://127.0.0.1:8641') {
  const views = pictureList(facts), adhoc = (list, light) => list.map(v => `${v.slug}:${v.hole}:${v.vy}:${light}`).join(',');
  const gallery = (label, list, light, extra = '') => `BANVY_GPU=1 node tools/gfx-gallery.mjs --base ${base} --label ${facts.groundId}-${label} --adhoc ${adhoc(list, light)}${extra}`;
  const one = facts.routings.map(x => views.find(v => v.slug === x.slug && v.vy === 'fritt') ?? views.find(v => v.slug === x.slug));
  return [
    `# The first pictures of ${facts.groundId}: take them before any bake, and look at every one.`,
    '# Build and serve first:  pnpm --filter @banvy/golf build  &&  node tools/serve.mjs apps/golf/dist 8641',
    '# The owner starts anything on the GPU. In PowerShell set $env:BANVY_GPU=1 and drop the prefix.',
    '', '# 1. Every view below, in daylight at high quality:',
    ...views.map(v => `#    ${v.slug} hole ${v.hole} (${v.vy}): ${v.why}`),
    gallery('look', views, 'dag'),
    '', '# 2. What every phone draws (low quality), and a low sun for shadows and glow:',
    gallery('look-lo', one, 'dag', ' --quality lo'),
    gallery('look-kvall', one, 'kvall'),
    '', '# 3. Winter: snow on roofs and the campus, bare broadleaves, frozen lakes:',
    gallery('look-vinter', one, 'vinter'),
    '', '# 4. The phone map, at phone width (412 px). Is anything on the ground not painted? Are islands cut?',
    ...[...new Set(views.filter(v => v.vy !== 'tee').map(v => `#    ${base}/?bana=${v.slug}&hal=${v.hole}&karta=1`))],
    '', `# Pictures land in tools/goldens/gfx/${facts.groundId}-look*/ (ignored by git).`,
  ].join('\n');
}

export const blocks = facts => new Map([['summary', summaryBlock(facts)], ['holes', holesBlock(facts)], ['checks', checksBlock(facts)]]);
const wrap = (name, body) => `<!-- generated:${name} -->\n${body}\n<!-- /generated:${name} -->`;
const pattern = name => new RegExp(`<!-- generated:${name} -->[\\s\\S]*?<!-- /generated:${name} -->`);

export function scaffold(facts) {
  const b = blocks(facts);
  return `# ${facts.club ?? facts.groundId}: walkthrough

${PROMPT} two sentences on what this ground is, with links to its source dossier and to [pipeline v2](../pipeline-v2.md)._

${wrap('summary', b.get('summary'))}

## What is known not to be right

${PROMPT} every fault you know of and did not fix, the evidence for it, and what would fix it. An empty list is not believable._

## Worth looking at

${PROMPT} the holes and places that show the ground at its best, and the ones most likely to be wrong._

${wrap('holes', b.get('holes'))}

## How each fault was found

${PROMPT} a row for every fault found while building: what it was, what found it (a check, a picture, the owner), at
which stage, and what holds it now. A fault a picture found is a check still to be written._

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |

## Decisions

${PROMPT} what the owner decided, with dates, and what is still theirs to decide._

${wrap('checks', b.get('checks'))}

## Befores

${PROMPT} the switches and the kept generation that show this ground as it was._
`;
}

export function merge(text, generated) {
  let out = text;
  for (const [name, body] of generated) {
    if (!pattern(name).test(out)) throw new Error(`the walkthrough has no generated:${name} part; add its markers`);
    out = out.replace(pattern(name), () => wrap(name, body));
  }
  return out;
}

/* --------------------------------------------------------------- catalogue */

export function catalogueTable() {
  const v2 = json('apps/golf/public/courses/v2-index.json').courses, index = json('apps/golf/public/courses/index.json').courses;
  const grounds = [...new Set(v2.map(c => c.groundId))].sort();
  const rows = grounds.map(groundId => {
    const slugs = v2.filter(c => c.groundId === groundId).map(c => c.slug);
    const builds = slugs.map(slug => index.find(row => row.slug === slug));
    const report = checkGroundQuality({ groundId, publicRoot: path.join(ROOT, 'apps/golf/public') });
    const source = json(`geo_data/course-v2/${groundId}/source-manifest.json`);
    const workflow = maybe(`course-workflows/${groundId}/workflow.json`), trees = maybe(`course-workflows/${groundId}/trees.json`);
    const open = source.blockers.filter(b => b.severity === 'release-blocking').length;
    return [`\`${groundId}\``, builds.map(b => `${b.holes}`).join(' + '),
      builds.every(b => exists(`${b.build}/mapping/trace-report.json`)) ? 'decisions as data' : 'own builder',
      builds.every(b => exists(`${b.build}/mapping/ring-review.json`)) ? 'recorded' : 'no record',
      trees ? `one by one (${trees.reviewId})` : 'automatic',
      `${report.errors.length} errors, ${report.warnings.length} warnings`,
      exists(`docs/courses/${groundId}-walkthrough.md`) ? `[yes](courses/${groundId}-walkthrough.md)` : 'none',
      (acceptance => (acceptance ? `owner acceptance, ${Object.keys(acceptance.open).length} open` : `${workflow?.releasePolicy ?? 'none'}, ${open} open`))(maybe(`course-workflows/${groundId}/owner-acceptance.json`))];
  });
  return table(['Ground', 'Holes', 'Outlines', 'Ring review', 'Trees', 'Quality gate', 'Walkthrough', 'Release'], rows);
}

/* --------------------------------------------------------------------- cli */

function run(argv) {
  const flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const check = argv.includes('--check');
  const stale = [];
  const settle = (file, next, what) => {
    const before = exists(file) ? fs.readFileSync(path.join(ROOT, file), 'utf8') : null;
    if (before === next) return;
    if (check) stale.push(`${file}: ${what} is stale; run this tool without --check`);
    else { fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true }); fs.writeFileSync(path.join(ROOT, file), next); console.log(`wrote ${file}`); }
  };
  if (argv.includes('--catalogue')) {
    const file = 'docs/pipeline-v2.md';
    settle(file, merge(fs.readFileSync(path.join(ROOT, file), 'utf8'), new Map([['catalogue', catalogueTable()]])), 'the catalogue table');
  }
  const groundId = flag('ground');
  if (groundId && argv.includes('--pictures')) { console.log(picturePlan(groundFacts(groundId), flag('base') ?? undefined)); return stale; }
  if (groundId) {
    const file = `docs/courses/${groundId}-walkthrough.md`, facts = groundFacts(groundId);
    const next = exists(file) ? merge(fs.readFileSync(path.join(ROOT, file), 'utf8'), blocks(facts)) : scaffold(facts);
    settle(file, next, 'a generated part');
    if (check && next.includes(PROMPT)) stale.push(`${file}: a "${PROMPT}" prompt is still to be written`);
    else if (next.includes(PROMPT)) console.log(`${file}: write the parts marked "${PROMPT}"`);
  }
  if (!groundId && !argv.includes('--catalogue')) throw new Error('usage: course-walkthrough.mjs --ground <id> [--check] | --catalogue [--check]');
  if (stale.length) { console.error(stale.join('\n')); process.exitCode = 1; }
  return stale;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
