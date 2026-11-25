#!/usr/bin/env node
/* The owner's look at the species sample, as a page to click through, and the truth a species rule is held to.

   node tools/tree-pipeline/species-check-page.mjs --ground <id> [--agent <labels.json>]
       writes species-check.html in the tree cache's species folder: each sample tree on its three panels and a
       button for each species. The agent's blind labels, if given, are kept in the page but hidden until the
       owner has answered a tree, so the owner's look stays blind too. Progress is kept in the browser; "Save"
       downloads species-check-<ground>.json.

   node tools/tree-pipeline/species-check-page.mjs --ground <id> --import <saved.json> [--agent <labels.json>]
       writes species-truth.json to the review folder: for every sample tree the owner's species where they gave
       one, else the agent's (marked so), with the role the sample gave it. That file is what species rules are
       scored against: tools/tree-pipeline/species-evaluation.mjs.

   The page holds crops of the photos, so it stays in the private cache and is never published. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SPECIES = Object.freeze(['pine', 'spruce', 'larch', 'birch', 'oak', 'alder', 'aspen', 'maple', 'lime', 'ash', 'beech', 'willow', 'other-broadleaf', 'other-conifer', 'unknown']);
const CONIFERS = new Set(['pine', 'spruce', 'larch', 'other-conifer']);
export const typeOf = species => (species === 'unknown' || !species ? 'unknown' : CONIFERS.has(species) ? 'conifer' : 'broadleaf');
const sha = text => createHash('sha256').update(text).digest('hex');

/** The truth for each sample tree: the owner's word over the agent's; neither is an unknown with no source. */
export function speciesTruth(sample, owner, agent) {
  const rows = sample.sample.map(s => {
    const o = owner?.labels?.[s.sampleId], a = agent?.labels?.[s.sampleId];
    const chosen = o && o.species ? { species: o.species, source: 'owner', note: o.note ?? '' } : a ? { species: a.species, source: 'agent', confidence: a.confidence ?? null, note: a.reason ?? '' } : { species: 'unknown', source: null };
    if (!SPECIES.includes(chosen.species)) throw new Error(`${s.sampleId}: ${chosen.species} is not a species the check offers`);
    return { sampleId: s.sampleId, treeId: s.treeId, role: s.role, easting: s.easting, northing: s.northing, type: typeOf(chosen.species), ...chosen,
      ...(o && a ? { agentAgreed: o.species === a.species } : {}) };
  });
  const both = rows.filter(r => r.agentAgreed !== undefined);
  return { schemaVersion: 1, kind: 'species-truth', groundId: sample.groundId, sampleSha256: sha(JSON.stringify(sample.sample)),
    owner: owner ? { reviewer: owner.reviewer, savedAt: owner.savedAt, answered: rows.filter(r => r.source === 'owner').length } : null,
    agent: agent ? { reviewer: agent.reviewer, reviewedOn: agent.reviewedOn, answered: Object.keys(agent.labels ?? {}).length } : null,
    agreement: both.length ? { trees: both.length, sameSpecies: both.filter(r => r.agentAgreed).length } : null, trees: rows };
}

function page(META) {
  var KEY = 'banvy-species-check:' + META.groundId + ':' + META.sampleSha;
  var state = { reviewer: '', labels: {} };
  try { state = JSON.parse(localStorage.getItem(KEY)) || state; } catch (e) { /* fresh */ }
  var at = 0, $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, text) { var n = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); if (text !== undefined) n.textContent = text; return n; };
  var keep = function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private window */ } };
  function draw() {
    var s = META.sample[at], main = $('tree'), mine = state.labels[s.sampleId] || {};
    main.textContent = '';
    main.appendChild(el('h2', {}, s.sampleId + '  (' + (at + 1) + ' of ' + META.sample.length + '), ' + Math.round(s.heightMetres) + ' m tall'));
    main.appendChild(el('img', { src: s.panel, alt: s.sampleId + ': summer, summer infrared, leafless' }));
    main.appendChild(el('p', { class: 'hint' }, 'Left: June, natural colour. Middle: June, infrared (leaves glow red; conifers darker). Right: April, leafless. The tree is in the yellow circle.'));
    var row = el('div', { class: 'choices' });
    META.species.forEach(function (sp) {
      var b = el('button', { 'aria-pressed': String(mine.species === sp) }, sp);
      b.onclick = function () { state.labels[s.sampleId] = { species: sp, note: (state.labels[s.sampleId] || {}).note || '' }; keep(); draw(); };
      row.appendChild(b);
    });
    main.appendChild(row);
    var note = el('input', { placeholder: 'A note (optional)', value: mine.note || '' });
    note.oninput = function () { state.labels[s.sampleId] = Object.assign(state.labels[s.sampleId] || {}, { note: note.value }); keep(); };
    main.appendChild(note);
    if (mine.species && META.agent[s.sampleId]) main.appendChild(el('p', { class: 'agent' }, 'The blind agent said: ' + META.agent[s.sampleId].species + ' (' + META.agent[s.sampleId].confidence + '): ' + META.agent[s.sampleId].reason));
    var go = el('div', { class: 'go' }), back = el('button', {}, 'Back'), next = el('button', { class: 'primary' }, 'Next');
    back.onclick = function () { at = Math.max(0, at - 1); draw(); }; next.onclick = function () { at = Math.min(META.sample.length - 1, at + 1); draw(); };
    go.appendChild(back); go.appendChild(next); main.appendChild(go);
    var done = META.sample.filter(function (x) { return state.labels[x.sampleId] && state.labels[x.sampleId].species; }).length;
    $('progress').textContent = done + ' of ' + META.sample.length + ' trees';
    $('save').disabled = !(state.reviewer || '').trim();
  }
  $('reviewer').value = state.reviewer || '';
  $('reviewer').oninput = function () { state.reviewer = $('reviewer').value; keep(); draw(); };
  $('save').onclick = function () {
    var doc = { schemaVersion: 1, kind: 'owner-species-check', groundId: META.groundId, sampleSha256: META.sampleSha, reviewer: (state.reviewer || '').trim(), savedAt: new Date().toISOString(), labels: state.labels };
    var a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' })), download: 'species-check-' + META.groundId + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
  };
  document.addEventListener('keydown', function (e) { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight') { at = Math.min(META.sample.length - 1, at + 1); draw(); } if (e.key === 'ArrowLeft') { at = Math.max(0, at - 1); draw(); } });
  draw();
}

const STYLE = `:root{--bg:#f6f5f1;--panel:#fff;--ink:#1d2320;--soft:#5d6661;--line:#d9d8d1;--accent:#1f6f4a}
@media (prefers-color-scheme:dark){:root{--bg:#141815;--panel:#1d2320;--ink:#e9ece8;--soft:#9aa39d;--line:#343c37;--accent:#6fcf9a}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}header{display:flex;gap:12px;align-items:center;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1}main{padding:16px;max-width:1100px}img{width:100%;height:auto;border-radius:6px}.hint,.agent{color:var(--soft)}
button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);cursor:pointer}button[aria-pressed=true],button.primary{background:var(--accent);color:var(--panel);border-color:var(--accent)}
.choices{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}input{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;width:100%;max-width:520px;background:var(--panel);color:var(--ink)}.go{display:flex;gap:8px;margin-top:12px}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: species-check-page.mjs --ground <id> [--agent <labels.json>] [--import <saved.json>]');
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, `course-workflows/${groundId}/trees.json`), 'utf8'));
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, config.reviewDir, 'species-sample.json'), 'utf8'));
  const agent = flag('agent') ? JSON.parse(fs.readFileSync(flag('agent'), 'utf8')) : null;
  if (argv.includes('--agent-only')) {
    // Until the owner has looked: the agent's blind labels alone, every one marked as the agent's.
    if (!agent) throw new Error('--agent-only needs --agent <labels.json>');
    const truth = speciesTruth(sample, null, agent);
    fs.writeFileSync(path.join(ROOT, config.reviewDir, 'species-truth.json'), `${JSON.stringify(truth, null, 1)}\n`);
    console.log(JSON.stringify({ agent: truth.agent, trees: truth.trees.length, unknown: truth.trees.filter(t => t.species === 'unknown').length }, null, 1));
  } else if (flag('import')) {
    const owner = JSON.parse(fs.readFileSync(flag('import'), 'utf8'));
    if (owner.kind !== 'owner-species-check' || owner.groundId !== groundId) throw new Error('not a species check of this ground');
    if (owner.sampleSha256 !== sha(JSON.stringify(sample.sample))) throw new Error('the check was made on another sample');
    const truth = speciesTruth(sample, owner, agent);
    fs.writeFileSync(path.join(ROOT, config.reviewDir, 'species-truth.json'), `${JSON.stringify(truth, null, 1)}\n`);
    console.log(JSON.stringify({ owner: truth.owner, agent: truth.agent, agreement: truth.agreement }, null, 1));
  } else {
    const folder = path.join(ROOT, config.cacheDir, 'species');
    const meta = { groundId, sampleSha: sha(JSON.stringify(sample.sample)), species: SPECIES,
      sample: sample.sample.map(s => ({ sampleId: s.sampleId, heightMetres: s.heightMetres, panel: `sample/${s.sampleId}.jpg` })),
      agent: Object.fromEntries(Object.entries(agent?.labels ?? {}).map(([id, l]) => [id, { species: l.species, confidence: l.confidence, reason: l.reason }])) };
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${groundId}: tree species</title><style>${STYLE}</style></head>
<body><header><h1>${groundId}: which species is each tree?</h1><span id="progress"></span><input id="reviewer" placeholder="Your name" style="width:180px"><button id="save" class="primary" disabled>Save</button></header>
<main id="tree"></main><script>(${page.toString()})(${JSON.stringify(meta).replace(/</g, '\\u003c')});</script></body></html>\n`;
    fs.writeFileSync(path.join(folder, 'species-check.html'), html);
    console.log(`${path.relative(ROOT, path.join(folder, 'species-check.html'))}: ${meta.sample.length} trees. Open it in a browser; it is private and stays on this machine.`);
  }
}
