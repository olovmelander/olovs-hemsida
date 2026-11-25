#!/usr/bin/env node
/* The owner's look at a ground, hole by hole, as a page to click through.

   node tools/course-review-page.mjs --ground <id> --overlays <dir of render-source-overlays.py> [--out <dir>] [--site <url>]
       writes review.html: every hole with the photo and the model side by side, what the checks flag, links
       that open the hole in the app (--site: a local build, to look before publishing), and seven verdicts to give. Progress is kept in the browser; "Save review"
       downloads owner-review-<ground>.json.

   node tools/course-review-page.mjs --ground <id> --import <owner-review-<ground>.json> [--apply]
       checks the saved review against what is published, keeps it as evidence under
       course-workflows/<ground>/evidence/, lists what was marked wrong, and with --apply writes its verdicts as
       the per-hole rows of the release review (course-workflows/<ground>/review.json).

   The page is a local file. Its pictures are crops of the orthophoto and stay in the build's private cache, so it
   is written there and never published; the saved review holds verdicts and words only, and is kept in git.
   A hole marked wrong is the start of an upgrade: change the decision, rebuild, make a new page. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../packages/course-workflow/standard.mjs';
import { applyOwnerReview, ownerReviewErrors, ownerReviewSummary, reviewDocument } from '../packages/course-workflow/owner-review.mjs';
import { fileDigest } from '../packages/course-workflow/io.mjs';
import { groundFacts } from './course-walkthrough.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://olovmelander.github.io/olovs-hemsida/';
const ASK = {
  tees: 'Are the tee decks where the photo shows them?', greens: 'Does the outline follow the putting surface?', fairways: 'Does the fairway follow the mown edge?',
  bunkers: 'Is every bunker there, and on its sand?', water: 'Are the ponds, creeks and their edges right?',
  vegetation: 'Do the woods and the single trees stand where they do? (Best judged in the app.)', infrastructure: 'Paths, bridges, walls and buildings.',
};
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

/** What the page shows and what a saved review is checked against. */
export function reviewMeta(facts, { overlays = null, from = null, site = SITE } = {}) {
  const base = site.endsWith('/') ? site : `${site}/`;
  const picture = (slug, n) => {
    if (!overlays) return null;
    const file = path.join(overlays, `${slug}-h${String(n).padStart(2, '0')}.png`);
    return fs.existsSync(path.join(ROOT, file)) || fs.existsSync(file) ? path.relative(from ?? '.', file).split(path.sep).join('/') : null;
  };
  return {
    groundId: facts.groundId, club: facts.club, groundManifestSha256: facts.generation, categories: CATEGORIES, ask: ASK,
    surfaces: Object.fromEntries(facts.routings.map(r => [r.slug, fs.existsSync(path.join(ROOT, `${r.build}/mapping/playing-surfaces.geojson`)) ? sha(`${r.build}/mapping/playing-surfaces.geojson`) : null])),
    routings: facts.routings.map(r => ({ slug: r.slug, label: r.label, holes: r.holes.map(h => ({
      n: h.n, name: h.name, par: h.par, index: h.index, back: h.back, decks: h.decks, bunkers: h.bunkers, beside: h.water, card: h.card, flags: h.flags,
      picture: picture(r.slug, h.n),
      links: { tee: `${base}?bana=${r.slug}&hal=${h.n}&vy=tee`, green: `${base}?bana=${r.slug}&hal=${h.n}&vy=green`, above: `${base}?bana=${r.slug}&hal=${h.n}&vy=ovan`, map: `${base}?bana=${r.slug}&hal=${h.n}&karta=1` },
    })) })),
  };
}

const STYLE = `
:root{--bg:#f6f5f1;--panel:#fff;--ink:#1d2320;--soft:#5d6661;--line:#d9d8d1;--accent:#1f6f4a;--right:#1f6f4a;--wrong:#b3261e;--absent:#6b6f76;--flag:#8a5a00;--flagbg:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#141815;--panel:#1d2320;--ink:#e9ece8;--soft:#9aa39d;--line:#343c37;--accent:#6fcf9a;--right:#6fcf9a;--wrong:#ff8a80;--absent:#a3a8ae;--flag:#ffd27a;--flagbg:#3a2f12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
header h1{font-size:17px;margin:0;flex:1 1 220px}header input{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);width:190px}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:6px 12px}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--panel);font-weight:600}button:disabled{opacity:.45;cursor:default}
.layout{display:grid;grid-template-columns:230px 1fr;min-height:calc(100vh - 54px)}nav{border-right:1px solid var(--line);padding:10px;overflow:auto;max-height:calc(100vh - 54px);position:sticky;top:54px}
nav h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);margin:12px 6px 6px}nav button{display:flex;gap:8px;width:100%;text-align:left;border:0;background:none;padding:5px 6px}
nav button[aria-current=true]{background:var(--bg);outline:2px solid var(--accent)}nav .dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--soft);margin-top:5px;flex:none}
nav .done .dot{background:var(--right);border-color:var(--right)}nav .part .dot{border-color:var(--accent)}nav .bad .dot{background:var(--wrong);border-color:var(--wrong)}
main{padding:16px 20px 60px;max-width:1180px}h2.hole{margin:0 0 4px;font-size:22px}.facts{color:var(--soft);margin:0 0 10px}.facts a{color:var(--accent)}
.flags{background:var(--flagbg);color:var(--flag);border-radius:6px;padding:8px 12px;margin:0 0 12px}.flags b{font-weight:600}
figure{margin:0 0 14px}figure img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block;background:#000}figcaption{color:var(--soft);font-size:13px;margin-top:4px}
.none{border:1px dashed var(--line);border-radius:6px;padding:28px;color:var(--soft);text-align:center}
.cat{display:grid;grid-template-columns:150px 1fr auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.cat b{text-transform:capitalize}.cat small{color:var(--soft)}
.cat .choice{display:flex;gap:6px}.cat .choice button[aria-pressed=true].right{background:var(--right);border-color:var(--right);color:var(--panel)}
.cat .choice button[aria-pressed=true].wrong{background:var(--wrong);border-color:var(--wrong);color:var(--panel)}.cat .choice button[aria-pressed=true].absent{background:var(--absent);border-color:var(--absent);color:var(--panel)}
.cat input{grid-column:2 / 4;font:inherit;padding:6px 8px;border:1px solid var(--wrong);border-radius:6px;background:var(--bg);color:var(--ink)}
textarea{width:100%;min-height:54px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);margin-top:10px}
.go{display:flex;gap:10px;margin-top:14px;align-items:center}.go span{color:var(--soft);font-size:13px}
@media (max-width:820px){.layout{grid-template-columns:1fr}nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line)}.cat{grid-template-columns:1fr}.cat input{grid-column:1}}
`;

/* The page's own script. It is written as a function and embedded by its text; META is the embedded data. */
function page(META, reviewDocumentOf) {
  var KEY = 'banvy-owner-review:' + META.groundId + ':' + META.groundManifestSha256;
  var state = { reviewer: '', holes: {} };
  try { state = JSON.parse(localStorage.getItem(KEY)) || state; } catch (error) { /* a fresh review */ }
  var order = [];
  META.routings.forEach(function (r) { r.holes.forEach(function (h) { order.push({ r: r, h: h, key: r.slug + '/' + h.n }); }); });
  var at = 0;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, text) { var node = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); }); if (text !== undefined) node.textContent = text; return node; };
  var entry = function (key) { return state.holes[key] || (state.holes[key] = { cats: {}, notes: {}, note: '' }); };
  var keep = function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) { /* private window: the review lives until the tab closes */ } };
  var status = function (key) {
    var cats = (state.holes[key] || {}).cats || {}, decided = META.categories.filter(function (c) { return cats[c]; });
    if (decided.some(function (c) { return cats[c] === 'wrong'; })) return 'bad';
    return decided.length === META.categories.length ? 'done' : decided.length ? 'part' : '';
  };
  function list() {
    var nav = $('holes'); nav.textContent = '';
    META.routings.forEach(function (r) {
      nav.appendChild(el('h2', {}, r.label));
      order.forEach(function (item, i) {
        if (item.r !== r) return;
        var b = el('button', { class: status(item.key), 'aria-current': String(i === at) });
        b.appendChild(el('span', { class: 'dot' })); b.appendChild(el('span', {}, item.h.n + '  ' + (item.h.name || '')));
        b.onclick = function () { at = i; draw(); };
        nav.appendChild(b);
      });
    });
    var done = order.filter(function (item) { var s = status(item.key); return s === 'done' || s === 'bad'; }).length;
    $('progress').textContent = done + ' of ' + order.length + ' holes';
    $('save').disabled = !(state.reviewer || '').trim();
  }
  function draw() {
    var item = order[at], h = item.h, e = entry(item.key), main = $('hole'); main.textContent = '';
    main.appendChild(el('h2', { class: 'hole' }, item.r.label + ' · hole ' + h.n + (h.name ? ' · ' + h.name : '')));
    var facts = el('p', { class: 'facts' }, 'Par ' + h.par + (h.index ? ', index ' + h.index : '') + (h.back ? ', ' + h.back + ' m from the back tee' : '') + '. ' + h.decks + ' tee decks, ' + h.bunkers + ' bunkers'
      + (h.beside.length ? ', beside it: ' + h.beside.join(', ') : '') + (h.card !== null ? '. Tee marks within ' + h.card.toFixed(1) + ' m of the card' : '') + '. Open in the app: ');
    ['tee', 'green', 'above', 'map'].forEach(function (view, i) { if (i) facts.appendChild(document.createTextNode(' · ')); facts.appendChild(el('a', { href: h.links[view], target: '_blank', rel: 'noopener' }, view)); });
    main.appendChild(facts);
    if (h.flags.length) { var flags = el('p', { class: 'flags' }); flags.appendChild(el('b', {}, 'The checks flag: ')); flags.appendChild(document.createTextNode(h.flags.join('; '))); main.appendChild(flags); }
    if (h.picture) {
      var figure = el('figure'), link = el('a', { href: h.picture, target: '_blank', rel: 'noopener' });
      link.appendChild(el('img', { src: h.picture, alt: 'Hole ' + h.n + ': the photo, and the photo with the model drawn on it' }));
      figure.appendChild(link); figure.appendChild(el('figcaption', {}, 'Left: the photo. Right: the same photo with the model drawn on it. Click for full size.'));
      main.appendChild(figure);
    } else main.appendChild(el('p', { class: 'none' }, 'No overlay picture for this hole: judge it in the app.'));
    META.categories.forEach(function (c) {
      var row = el('div', { class: 'cat' }), label = el('div'); label.appendChild(el('b', {}, c));
      row.appendChild(label); row.appendChild(el('small', {}, META.ask[c]));
      var choice = el('div', { class: 'choice' });
      [['right', 'Right'], ['wrong', 'Wrong'], ['absent', 'None here']].forEach(function (v) {
        if (v[0] === 'absent' && (c === 'tees' || c === 'greens')) return;
        var b = el('button', { class: v[0], 'aria-pressed': String(e.cats[c] === v[0]) }, v[1]);
        b.onclick = function () { e.cats[c] = e.cats[c] === v[0] ? null : v[0]; keep(); draw(); };
        choice.appendChild(b);
      });
      row.appendChild(choice);
      if (e.cats[c] === 'wrong') {
        var what = el('input', { placeholder: 'What is wrong with the ' + c + '?', value: e.notes[c] || '' });
        what.oninput = function () { e.notes[c] = what.value; keep(); };
        row.appendChild(what);
      }
      main.appendChild(row);
    });
    var note = el('textarea', { placeholder: 'Anything else about this hole' }); note.value = e.note || '';
    note.oninput = function () { e.note = note.value; keep(); };
    main.appendChild(note);
    var go = el('div', { class: 'go' }), all = el('button', { class: 'primary' }, 'The rest is right, next'), next = el('button', {}, 'Next'), back = el('button', {}, 'Back');
    all.onclick = function () { META.categories.forEach(function (c) { if (!e.cats[c]) e.cats[c] = 'right'; }); keep(); step(1); };
    next.onclick = function () { step(1); }; back.onclick = function () { step(-1); };
    go.appendChild(back); go.appendChild(all); go.appendChild(next); go.appendChild(el('span', {}, 'Keys: left and right arrows move, Enter marks the rest right.'));
    main.appendChild(go);
    list();
  }
  function step(by) { at = Math.max(0, Math.min(order.length - 1, at + by)); draw(); window.scrollTo(0, 0); }
  $('reviewer').value = state.reviewer || '';
  $('reviewer').oninput = function () { state.reviewer = $('reviewer').value; keep(); list(); };
  $('save').onclick = function () {
    var doc = reviewDocumentOf(META, state, new Date().toISOString());
    var link = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1) + '\n'], { type: 'application/json' })), download: 'owner-review-' + META.groundId + '.json' });
    document.body.appendChild(link); link.click(); link.remove();
  };
  document.addEventListener('keydown', function (event) {
    if (/INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'Enter') { var e = entry(order[at].key); META.categories.forEach(function (c) { if (!e.cats[c]) e.cats[c] = 'right'; }); keep(); step(1); }
  });
  draw();
}

export function reviewPage(meta) {
  const data = JSON.stringify(meta).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${meta.club ?? meta.groundId}: hole review</title><style>${STYLE}</style></head>
<body>
<header><h1>${meta.club ?? meta.groundId}: hole by hole</h1><span id="progress"></span>
<input id="reviewer" placeholder="Your name" aria-label="Your name"><button id="save" class="primary" disabled>Save review</button></header>
<div class="layout"><nav id="holes" aria-label="Holes"></nav><main id="hole"></main></div>
<script>
(${page.toString()})(${data}, ${reviewDocument.toString()});
</script>
</body></html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: course-review-page.mjs --ground <id> --overlays <dir> [--out <dir>]  |  --ground <id> --import <file> [--apply]');
  const facts = groundFacts(groundId);
  if (flag('import')) {
    const doc = JSON.parse(fs.readFileSync(flag('import'), 'utf8')), meta = reviewMeta(facts);
    const errors = ownerReviewErrors(doc, { groundId, groundManifestSha256: facts.generation, routings: facts.routings.map(r => ({ slug: r.slug, holes: r.holes.length })), surfaces: meta.surfaces });
    const summary = ownerReviewSummary(doc);
    if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
    const evidence = `course-workflows/${groundId}/evidence/owner-review-${doc.savedAt.slice(0, 10)}.json`;
    fs.mkdirSync(path.dirname(path.join(ROOT, evidence)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, evidence), `${JSON.stringify(doc, null, 1)}\n`);
    let applied = null;
    if (argv.includes('--apply')) {
      const file = `course-workflows/${groundId}/review.json`, done = applyOwnerReview(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')), doc, { path: evidence, sha256: fileDigest(ROOT, evidence) });
      fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(done.review, null, 2)}\n`);
      applied = { file, rowsReviewed: done.reviewed, rowsStillOpen: done.open };
    }
    console.log(JSON.stringify({ groundId, reviewer: doc.reviewer, evidence, ...summary, applied }, null, 1));
  } else {
    const overlays = flag('overlays');
    if (!overlays) throw new Error('--overlays <dir>: the pictures render-source-overlays.py wrote for this generation');
    const out = flag('out') ?? `${facts.routings[0].build}/cache/owner-review`;
    fs.mkdirSync(path.join(ROOT, out), { recursive: true });
    const meta = reviewMeta(facts, { overlays, from: out, site: flag('site') ?? SITE });
    fs.writeFileSync(path.join(ROOT, out, 'review.html'), reviewPage(meta));
    const pictures = meta.routings.flatMap(r => r.holes).filter(h => h.picture).length, holes = meta.routings.flatMap(r => r.holes).length;
    console.log(`${path.join(out, 'review.html')}: ${holes} holes, ${pictures} with a picture. Open it in a browser; it is private and stays on this machine.`);
  }
}
