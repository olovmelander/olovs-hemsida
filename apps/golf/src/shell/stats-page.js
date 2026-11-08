/* ===========================================================================
   Statistik: everything the rounds and the club wheel have measured.

   The owner asked for it on 7 November: statistics, history, how you play and
   the clubs, "amazing visually and from a UI and UX perspective". Read like a
   launch monitor's session report: one headline number, the readings beside
   it, then the story -- the trend, where the strokes go, how the tee shots,
   greens and putts went, what each club really carries, the courses and every
   round with its card.

   All of it is counted by stats-model.mjs from the light map's own records, so
   a round finished on the course is here the moment the page opens. With no
   rounds yet the page says how they are made, and can show an example that is
   labelled as one and never stored.

   The charts follow the dataviz rules: thin marks, one headline figure, labels
   only where they say something (the newest and the best), a crosshair and a
   readout on hover and on the keyboard, and a table behind every chart.
   =========================================================================== */
import '../styles/hub.css';
import '../styles/stats.css';
import { parseBag } from '../engine/caddie.js';
import { clubAssetKey, clubIcon } from '../engine/club-design.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseHistory } from '../map/map-shots.mjs';
import { BAG_KEY, MAP_KEYS, readText } from './settings-store.mjs';
import { reliveUrl } from './router.js';
import { exampleData, kindOf, PERIODS, playerStats, SCORE_KINDS } from './stats-model.mjs';

const BASE = import.meta.env.BASE_URL;
const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Swedish numbers: a decimal comma, a real minus sign, ± at nothing. */
const dec = (value, digits = 1) => value.toFixed(digits).replace('.', ',');
const signed = (value, digits = 1) => (Math.abs(value) < 0.5 * 10 ** -digits ? '±0' : `${value > 0 ? '+' : '−'}${dec(Math.abs(value), digits)}`);
const signedInt = value => (value === 0 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`);
const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}` : '–');
const thisYear = new Date().getFullYear();
function dateText(date, long = false) {
  const day = new Date(date);
  if (!Number.isFinite(day.getTime())) return '';
  const opts = { day: 'numeric', month: long ? 'long' : 'short', ...(day.getFullYear() !== thisYear ? { year: 'numeric' } : {}) };
  return day.toLocaleDateString('sv-SE', opts).replace('.', '');
}

const BACK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const TABLE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></svg>';
const CHART = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="m5 15 4-5 4 3 6-7"/></svg>';
const TONE_ICON = {
  good: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 6-6 4 4 6-7"/><path d="M15 7h5v5"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.4"/></svg>',
};

/* ------------------------------------------------------------ the readout
   One tooltip per chart card: the value leads, the label follows. */
function tipFor(card) {
  let tip = card.querySelector('.st-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'st-tip'; tip.setAttribute('role', 'status'); card.append(tip); }
  return {
    show(lines, x, y) {
      tip.replaceChildren(...lines.map(([text, strong], i) => {
        const line = document.createElement(i === 0 || strong ? 'b' : 'span');
        line.textContent = text;
        return line;
      }));
      tip.classList.add('is-on');
      const box = card.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(8, Math.min(box.width - w - 8, x - w / 2));
      const top = y - h - 14 < 4 ? y + 18 : y - h - 14;
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    hide() { tip.classList.remove('is-on'); },
  };
}

/* ------------------------------------------------------ the score trend */
function niceStep(range) {
  for (const step of [1, 2, 5, 10, 20, 50]) if (range / step <= 5) return step;
  return 100;
}
function drawTrend(host, rows) {
  const card = host.closest('.st-card');
  const tip = tipFor(card);
  const W = Math.max(280, host.clientWidth), H = W < 520 ? 210 : 250;
  const pad = { l: 44, r: 58, t: 22, b: 30 };
  const values = rows.map(row => row.perEighteen);
  let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  if (hi - lo < 4) { hi += 2; lo -= 2; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const x = i => pad.l + (rows.length === 1 ? plotW / 2 : (i * plotW) / (rows.length - 1));
  const y = v => pad.t + ((hi - v) / (hi - lo)) * plotH;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const bestIndex = values.indexOf(Math.min(...values));
  const last = rows.length - 1;
  const line = rows.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(row.perEighteen).toFixed(1)}`).join('');
  const area = `${line}L${x(last).toFixed(1)} ${pad.t + plotH}L${x(0).toFixed(1)} ${pad.t + plotH}Z`;
  const labelDates = rows.length > 1 ? [0, last, ...(rows.length > 6 ? [Math.round(last / 2)] : [])] : [0];
  host.innerHTML = `<svg class="st-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img"
      aria-label="Resultat per 18 hål mot par, ${rows.length} rundor. Senaste ${signed(values[last])}, bästa ${signed(values[bestIndex])}. Piltangenterna går runda för runda.">
    <defs><linearGradient id="stWash" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5fd07a" stop-opacity=".16"/><stop offset="1" stop-color="#5fd07a" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(v => `<line class="${v === 0 ? 'st-zero' : 'st-grid'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="st-axis" x="${pad.l - 10}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? 'Par' : signedInt(v)}</text>`).join('')}
    ${labelDates.map(i => `<text class="st-axis" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 && rows.length > 1 ? 'start' : i === last && rows.length > 1 ? 'end' : 'middle'}">${esc(dateText(rows[i].date))}</text>`).join('')}
    <path d="${area}" fill="url(#stWash)"/>
    <path class="st-line" d="${line}"/>
    ${rows.map((row, i) => `<circle class="st-dot${i === last ? ' is-last' : ''}${i === bestIndex ? ' is-best' : ''}" cx="${x(i)}" cy="${y(row.perEighteen)}" r="${i === last ? 5.5 : 4}"/>`).join('')}
    <text class="st-end" x="${x(last) + 10}" y="${y(values[last]) + 5}">${signed(values[last])}</text>
    ${bestIndex !== last && rows.length > 2 ? `<text class="st-best" x="${x(bestIndex)}" y="${y(values[bestIndex]) + 22}" text-anchor="middle">Bästa ${signed(values[bestIndex])}</text>` : ''}
    <line class="st-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + plotH}" visibility="hidden"/>
    <rect class="st-hit" x="${pad.l - 12}" y="0" width="${plotW + 24}" height="${H}"/>
  </svg>`;
  const svg = host.querySelector('svg'), cross = svg.querySelector('.st-cross');
  let at = last;
  const point = i => {
    at = Math.max(0, Math.min(last, i));
    const row = rows[at];
    cross.setAttribute('x1', x(at)); cross.setAttribute('x2', x(at)); cross.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.st-dot').forEach((dot, k) => dot.classList.toggle('is-on', k === at));
    const hostBox = host.getBoundingClientRect(), cardBox = card.getBoundingClientRect();
    tip.show([[`${signed(row.perEighteen)} per 18 hål`], [`${row.courseName ?? row.course} · ${dateText(row.date)}`],
      [`${row.strokes} slag på ${row.holes} hål (${signedInt(row.toPar)})${row.points !== null ? ` · ${row.points} poäng` : ''}`]],
      hostBox.left - cardBox.left + x(at), hostBox.top - cardBox.top + y(row.perEighteen));
  };
  const clear = () => { cross.setAttribute('visibility', 'hidden'); svg.querySelectorAll('.st-dot').forEach(dot => dot.classList.remove('is-on')); tip.hide(); };
  const nearestTo = e => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    let nearest = 0;
    rows.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i; });
    return nearest;
  };
  /* the crosshair follows a mouse; a finger taps a round, so a swipe past the chart scrolls */
  svg.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') point(nearestTo(e)); });
  svg.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') point(nearestTo(e)); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') clear(); });
  svg.addEventListener('focus', () => point(at));
  svg.addEventListener('blur', clear);
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); point(at + (e.key === 'ArrowLeft' ? -1 : 1)); }
  });
}

/* ------------------------------------------------- a whole split in parts */
function segmentedBar(parts, { label, tall = true, unit = 'hål' }) {
  const total = parts.reduce((s, p) => s + p.count, 0);
  return `<div class="st-seg${tall ? ' is-tall' : ''}" role="group" aria-label="${esc(label)}">
    ${parts.filter(p => p.count > 0).map(p => {
      const share = p.count / total;
      return `<span class="st-part" tabindex="0" style="flex-grow:${p.count};background:${p.colour}" data-label="${esc(p.label)}" data-count="${p.count}" data-share="${Math.round(share * 100)}"
        aria-label="${esc(`${p.label}: ${p.count} ${unit}, ${Math.round(share * 100)} procent`)}"><em>${Math.round(share * 100)} %</em></span>`;
    }).join('')}
  </div>
  <ul class="st-legend">${parts.map(p => `<li><i style="background:${p.colour}"></i>${esc(p.label)} <b>${p.count}</b></li>`).join('')}</ul>`;
}
/* a label prints inside its block only where it fits */
function fitSegments(root) {
  for (const part of root.querySelectorAll('.st-part')) {
    const em = part.querySelector('em');
    if (em) em.hidden = em.scrollWidth + 14 > part.clientWidth;
  }
}
function bindSegments(root) {
  for (const seg of root.querySelectorAll('.st-seg')) {
    const card = seg.closest('.st-card'), tip = tipFor(card);
    const show = part => {
      const box = part.getBoundingClientRect(), cardBox = card.getBoundingClientRect();
      tip.show([[`${part.dataset.count} ${seg.dataset.unit || 'hål'}`], [`${part.dataset.label} · ${part.dataset.share} %`]], box.left - cardBox.left + box.width / 2, box.top - cardBox.top);
    };
    for (const part of seg.querySelectorAll('.st-part')) hoverOrTap(part, () => show(part), () => tip.hide());
  }
}
/* A mouse resting on a mark is a question; a finger landing on one is usually
   a scroll, so on touch the readout comes with a tap and goes with the next. */
function hoverOrTap(mark, show, hide) {
  mark.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(); });
  mark.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  mark.addEventListener('click', () => (mark.classList.toggle('is-tipped') ? show() : hide()));
  mark.addEventListener('focus', () => { if (mark.matches(':focus-visible')) show(); });
  mark.addEventListener('blur', () => { mark.classList.remove('is-tipped'); hide(); });
}

/* --------------------------------------------- the fairway, from the tee */
function fairwayFigure(f) {
  const left = pct(f.left, f.tried), hit = pct(f.hit, f.tried), right = pct(f.right, f.tried);
  return `<div class="st-fairway" role="img" aria-label="Fairway från tee: ${hit} procent träff, ${left} procent vänster, ${right} procent höger, av ${f.tried} hål.">
    <div class="sf-side"><b>${left}<small>%</small></b><span>Vänster</span><em>${f.left} hål</em></div>
    <div class="sf-strip"><svg viewBox="0 0 120 180" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="sfMow" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4fb86a"/><stop offset="1" stop-color="#2f8a4a"/></linearGradient>
      <pattern id="sfStripe" width="120" height="30" patternUnits="userSpaceOnUse"><rect width="120" height="15" fill="rgba(255,255,255,.07)"/></pattern></defs>
      <path d="M38 180 C 30 120, 34 60, 46 0 L 74 0 C 86 60, 90 120, 82 180 Z" fill="url(#sfMow)"/>
      <path d="M38 180 C 30 120, 34 60, 46 0 L 74 0 C 86 60, 90 120, 82 180 Z" fill="url(#sfStripe)"/>
      <circle cx="60" cy="168" r="4" fill="#fff"/>
    </svg><div class="sf-hit"><b>${hit}<small>%</small></b><span>Träff</span></div></div>
    <div class="sf-side"><b>${right}<small>%</small></b><span>Höger</span><em>${f.right} hål</em></div>
  </div>`;
}

/* ------------------------------------------------------------ the clubs */
function clubRows(clubs) {
  const rows = clubs.filter(club => !club.putter);
  const top = Math.max(50, ...rows.map(club => Math.max(club.carry || 0, club.stat?.longest || 0)));
  const scaleMax = Math.ceil((top * 1.04) / 50) * 50;
  const at = value => `${((100 * value) / scaleMax).toFixed(2)}%`;
  const ordered = [...rows].sort((a, b) => (b.stat?.typical ?? b.carry ?? 0) - (a.stat?.typical ?? a.carry ?? 0));
  const ticks = [];
  for (let v = 0; v <= scaleMax; v += 50) ticks.push(v);
  const items = [];
  ordered.forEach((club, i) => {
    const s = club.stat;
    const prev = ordered[i - 1];
    if (prev?.stat?.known && s?.known) {
      const gap = Math.round(prev.stat.typical - s.typical);
      if (gap > 25 || gap < 5) items.push(`<li class="gap-note${gap > 25 ? ' is-wide' : ''}" aria-hidden="true"><span>${gap > 25 ? `${gap} m lucka` : `bara ${gap} m isär`}</span></li>`);
    }
    const tipLines = s
      ? [`${Math.round(s.typical)} m typiskt`, club.name, `Spridning ${Math.round(s.shortest)}–${Math.round(s.reach)} m · längsta ${Math.round(s.longest)} m`,
        `${s.shots} slag${s.known ? '' : ' (för få för en säker längd)'}${club.carry ? ` · bagens carry ${club.carry} m` : ''}`]
      : [club.carry ? `${club.carry} m i bagen` : 'Inga slag', club.name, 'Inga uppmätta slag än'];
    items.push(`<li class="gap-row${s?.known ? '' : ' is-thin'}" tabindex="0" data-club="${esc(club.id)}" data-tip="${esc(JSON.stringify(tipLines))}"
      aria-label="${esc(`${club.name}: ${s ? `typiskt ${Math.round(s.typical)} meter, spridning ${Math.round(s.shortest)} till ${Math.round(s.reach)}, längsta ${Math.round(s.longest)}, ${s.shots} slag` : 'inga uppmätta slag'}${club.carry ? `, bagens carry ${club.carry} meter` : ''}`)}">
      <span class="gr-icon" aria-hidden="true">${clubIcon(clubAssetKey(club))}</span>
      <span class="gr-name">${esc(club.name)}<small>${s ? `${s.shots} slag` : 'inga slag än'}</small></span>
      <span class="gr-track" aria-hidden="true">
        ${ticks.slice(1).map(v => `<i class="gr-tick" style="left:${at(v)}"></i>`).join('')}
        ${s ? `<i class="gr-range" style="left:${at(s.shortest)};width:calc(${at(s.reach - s.shortest)} + 2px)"></i>` : ''}
        ${club.carry ? `<i class="gr-carry" style="left:${at(club.carry)}"></i>` : ''}
        ${s ? `<i class="gr-typ" style="left:${at(s.typical)}"></i>` : ''}
      </span>
      <span class="gr-val">${s ? `<b>${Math.round(s.typical)}</b><small> m</small>` : `<span class="gr-none">${club.carry ? `${club.carry} m` : '–'}</span>`}</span>
    </li>`);
  });
  return `<ol class="gap-rows">${items.join('')}</ol>
    <div class="gap-axis" aria-hidden="true"><span class="gr-icon"></span><span class="gr-name"></span><span class="gr-track">${ticks.map(v => `<i style="left:${at(v)}">${v}</i>`).join('')}</span><span class="gr-val">m</span></div>`;
}

/* ---------------------------------------------------------- hole by hole
   Each hole's average against its par, from a par line: up is over par,
   down under. Only the costliest and the kindest hole carry a label. */
function holeChart(holes) {
  /* one scale for both sides: the plot's height is shared out by the longest bar
     each way, so a course played mostly over par does not keep an empty half */
  const maxUp = Math.max(0, ...holes.map(h => h.toPar)), maxDown = Math.max(0, ...holes.map(h => -h.toPar));
  const span = Math.max(0.5, maxUp + maxDown);
  const upShare = Math.max(0.12, maxUp / span), downShare = Math.max(0.06, maxDown / span);
  const reachOf = v => (v >= 0 ? Math.max(maxUp, 0.25) : Math.max(maxDown, 0.25));
  const worst = holes.reduce((a, b) => (b.toPar > a.toPar ? b : a));
  const best = holes.reduce((a, b) => (b.toPar < a.toPar ? b : a));
  const colour = v => (v > 0.05 ? SCORE_KINDS[3].colour : v < -0.05 ? SCORE_KINDS[1].colour : SCORE_KINDS[2].colour);
  return `<div class="shb" role="img" style="--up:${upShare.toFixed(3)};--down:${downShare.toFixed(3)}" aria-label="${esc(`Snitt mot par per hål. Dyrast: hål ${worst.n}, ${signed(worst.toPar, 2)}. Snällast: hål ${best.n}, ${signed(best.toPar, 2)}.`)}">
    <div class="shb-plot">${holes.map(h => {
      const share = Math.min(1, Math.abs(h.toPar) / reachOf(h.toPar));
      const up = h.toPar >= 0;
      /* the costliest hole's label rides on its bar; the kindest's sits on the par line */
      const marked = h === worst || (h === best && best !== worst);
      const label = marked ? `<em style="bottom:${up ? `calc(${(share * 100).toFixed(1)}% + 4px)` : '4px'}">${signed(h.toPar, 1)}</em>` : '';
      return `<button type="button" class="shb-col" data-tip="${esc(JSON.stringify([`Hål ${h.n} · ${signed(h.toPar, 2)}`, `Par ${h.par} · snitt ${dec(h.average, 2)} · bästa ${h.best}`, `${h.rounds} ${h.rounds === 1 ? 'runda' : 'rundor'}${h.putts !== null ? ` · ${dec(h.putts, 1)} puttar` : ''}${h.fairway !== null ? ` · fairway ${Math.round(h.fairway * 100)} %` : ''}`]))}"
        aria-label="${esc(`Hål ${h.n}, par ${h.par}: ${signed(h.toPar, 2)} i snitt`)}">
        <span class="shb-half is-up">${up ? `<i style="height:${(share * 100).toFixed(1)}%;background:${colour(h.toPar)}"></i>` : ''}${label}</span>
        <span class="shb-half is-down">${!up ? `<i style="height:${(share * 100).toFixed(1)}%;background:${colour(h.toPar)}"></i>` : ''}</span>
        <span class="shb-n">${h.n}</span><span class="shb-par">${h.par}</span>
      </button>`;
    }).join('')}</div>
    <div class="shb-axis" aria-hidden="true"><span>Hål</span><span>Par</span></div>
  </div>`;
}

/* --------------------------------------------------------- a round's card */
function scorecard(record) {
  const holes = record.holes;
  const pars = record.pars || holes.map(hole => hole.par);
  const scoreOf = n => holes.find(hole => hole.n === n);
  const half = pars.length > 9 ? [[1, 9], [10, pars.length]] : [[1, pars.length]];
  const cell = n => {
    const hole = scoreOf(n);
    if (!hole) return '<td class="sc-none">·</td>';
    if (hole.picked || !Number.isFinite(hole.strokes)) return '<td class="sc-none" title="Struket">–</td>';
    const kind = kindOf(hole.strokes, hole.par);
    return `<td><span class="sc-score sc-${kind.key}" style="--k:${kind.colour}" title="${esc(kind.label)}">${hole.strokes}</span></td>`;
  };
  const sumOf = (from, to, key) => {
    let total = 0, any = false;
    for (let n = from; n <= to; n++) {
      if (key === 'par') { total += pars[n - 1]; any = true; continue; }
      const hole = scoreOf(n);
      if (hole && !hole.picked && Number.isFinite(hole[key])) { total += hole[key]; any = true; }
    }
    return any ? total : '–';
  };
  return half.map(([from, to]) => {
    const ns = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    const sumLabel = half.length > 1 ? (from === 1 ? 'Ut' : 'In') : 'Tot';
    return `<table class="sc-table"><thead><tr><th scope="row">Hål</th>${ns.map(n => `<th scope="col">${n}</th>`).join('')}<th>${sumLabel}</th></tr></thead>
      <tbody><tr class="sc-par-row"><th scope="row">Par</th>${ns.map(n => `<td>${pars[n - 1]}</td>`).join('')}<td>${sumOf(from, to, 'par')}</td></tr>
      <tr><th scope="row">Slag</th>${ns.map(cell).join('')}<td class="sc-sum">${sumOf(from, to, 'strokes')}</td></tr>
      <tr class="sc-putts"><th scope="row">Puttar</th>${ns.map(n => { const h = scoreOf(n); return `<td>${h && Number.isFinite(h.putts) ? h.putts : ''}</td>`; }).join('')}<td>${sumOf(from, to, 'putts')}</td></tr></tbody></table>`;
  }).join('');
}

/* =============================================================== the page */
export function buildStats({ courses, onBack, onPlay, onCourse = null }) {
  const el = document.createElement('div');
  el.id = 'stats';
  el.className = 'hub-screen';
  el.setAttribute('aria-labelledby', 'statsTitle');
  const state = { period: 'all', course: 'all', example: false, view: {} };
  const poster = slug => (courses.some(c => c.slug === slug) ? `${BASE}courses/${slug}/hero-1.webp` : '');

  el.innerHTML = `
    <header class="set-top">
      <div class="hub-top set-top-in">
        <button class="hub-back" type="button" data-back aria-label="Tillbaka">${BACK}<span>Tillbaka</span></button>
        <h1 class="set-title" id="statsTitle" tabindex="-1">Statistik</h1>
        <span class="st-sub" data-sub></span>
      </div>
    </header>
    <div class="set-inner st-inner" data-body></div>`;
  const body = el.querySelector('[data-body]');
  el.querySelector('[data-back]').addEventListener('click', () => onBack());

  function read() {
    if (state.example) {
      const bag = parseBag(null);
      return { ...exampleData({ courses, bag }), bag };
    }
    return {
      rounds: parseRounds(readText(storage(), MAP_KEYS.rounds, null)),
      shots: parseHistory(readText(storage(), MAP_KEYS.shots, null)),
      bag: parseBag(readText(storage(), BAG_KEY, null)),
    };
  }

  /* ---------------------------------------------------------- empty */
  function renderEmpty() {
    el.querySelector('[data-sub]').textContent = '';
    body.innerHTML = `
      <section class="st-empty">
        <div class="st-empty-art" aria-hidden="true">
          <svg viewBox="0 0 320 220">
            <defs><linearGradient id="seGlow" x1="0" x2="1"><stop offset="0" stop-color="#5fd07a" stop-opacity=".0"/><stop offset=".5" stop-color="#5fd07a" stop-opacity=".9"/><stop offset="1" stop-color="#8ef0a4"/></linearGradient></defs>
            <rect x="18" y="20" width="284" height="180" rx="22" fill="rgba(255,255,255,.03)" stroke="rgba(160,230,185,.18)"/>
            ${[0, 1, 2, 3].map(i => `<line x1="44" x2="276" y1="${62 + i * 34}" y2="${62 + i * 34}" stroke="rgba(160,230,185,.1)"/>`).join('')}
            <path class="se-line" d="M44 150 C 80 140, 96 118, 128 124 S 180 92, 206 96 S 250 64, 276 58" fill="none" stroke="url(#seGlow)" stroke-width="3" stroke-linecap="round"/>
            <circle cx="276" cy="58" r="7" fill="#8ef0a4" stroke="#0b1a12" stroke-width="3"/>
            ${[[60, 44, '#5096ea'], [92, 44, '#6b736e'], [124, 44, '#e26a32'], [156, 44, '#6b736e']].map(([cx, cy, c]) => `<circle cx="${cx}" cy="${cy}" r="9" fill="${c}"/>`).join('')}
          </svg>
        </div>
        <div class="st-empty-text">
          <p class="home-eyebrow">Statistik</p>
          <h2>Din statistik börjar på banan</h2>
          <p>Allt här räknas fram ur dina rundor i Lätt 3D: resultat och utveckling, fairways, greener och puttar, och hur långt varje klubba verkligen går.</p>
          <ol class="st-steps">
            <li><b>1</b><span><strong>Öppna en bana i Lätt 3D</strong> när du står på första tee.</span></li>
            <li><b>2</b><span><strong>Starta rundan</strong> och för score hål för hål.</span></li>
            <li><b>3</b><span><strong>Håll klubban i hjulet</strong> vid bollen, så mäts varje slag.</span></li>
          </ol>
          <div class="st-empty-actions">
            <button class="set-primary" type="button" data-play>Spela i Lätt 3D</button>
            <button class="st-ghost" type="button" data-example>Visa ett exempel</button>
          </div>
        </div>
      </section>`;
    body.querySelector('[data-play]').addEventListener('click', () => onPlay());
    body.querySelector('[data-example]').addEventListener('click', () => { state.example = true; render(); });
  }

  /* ------------------------------------------------------------ full */
  function renderStats(data) {
    const stat = playerStats({ ...data, filter: { period: state.period, course: state.course } });
    const all = playerStats({ ...data });
    const sub = el.querySelector('[data-sub]');
    sub.textContent = state.example ? 'Exempel' : `${all.rounds} ${all.rounds === 1 ? 'runda' : 'rundor'} · ${all.playedCourses.length} ${all.playedCourses.length === 1 ? 'bana' : 'banor'}`;
    sub.classList.toggle('is-example', state.example);
    const courseOptions = all.playedCourses.map(c => `<option value="${esc(c.slug)}"${c.slug === state.course ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const tableToggle = key => `<button class="st-view" type="button" data-view="${key}" aria-pressed="${state.view[key] === 'table'}">${state.view[key] === 'table' ? `${CHART}<span>Diagram</span>` : `${TABLE}<span>Tabell</span>`}</button>`;
    const showTable = key => state.view[key] === 'table';

    if (!stat.rounds) {
      body.innerHTML = `${filters(courseOptions)}<div class="st-card st-none"><h2>Inga rundor i det här urvalet</h2><p>Välj en längre period eller alla banor.</p><button class="st-ghost" type="button" data-reset>Visa allt</button></div>`;
      bindFilters();
      body.querySelector('[data-reset]').addEventListener('click', () => { state.period = 'all'; state.course = 'all'; render(); });
      return;
    }

    const trendRows = stat.trend.filter(row => Number.isFinite(row.perEighteen));
    const spark = trendRows.slice(-12).map(row => row.perEighteen);
    const sparkPath = (() => {
      if (spark.length < 2) return '';
      const lo = Math.min(...spark), hi = Math.max(...spark), span = hi - lo || 1;
      return spark.map((v, i) => `${i ? 'L' : 'M'}${((i / (spark.length - 1)) * 120).toFixed(1)} ${(4 + ((v - lo) / span) * 32).toFixed(1)}`).join('');
    })();
    const delta = stat.delta;
    const tiles = [
      ['Rundor', String(stat.rounds), `${stat.holes} hål`],
      ['Bästa runda', stat.best ? signed(stat.best.perEighteen) : '–', stat.best ? `${stat.best.strokes} slag · ${stat.best.courseName ?? ''}` : ''],
      ['Fairwayträff', stat.fairways.tried ? `${pct(stat.fairways.hit, stat.fairways.tried)} %` : '–', `${stat.fairways.hit} av ${stat.fairways.tried}`],
      ['Greener i regulation', stat.greens.tried ? `${pct(stat.greens.hit, stat.greens.tried)} %` : '–', `${stat.greens.hit} av ${stat.greens.tried}`],
      ['Puttar per green', stat.putts.perGreen !== null ? dec(stat.putts.perGreen, 2) : '–', stat.putts.perGreen !== null ? `${dec(stat.putts.perGreen * 18, 1)} per runda` : ''],
      ['Stableford', stat.points !== null ? dec(stat.points, 1) : '–', stat.points !== null ? 'poäng per runda' : 'kräver handicap'],
    ];
    const kindsTotal = stat.distribution.reduce((s, d) => s + d.count, 0);

    body.innerHTML = `
      ${state.example ? `<div class="st-banner" role="note"><span><b>Exempel.</b> Så här ser statistiken ut efter 16 rundor. Det är inte dina siffror.</span><button class="st-ghost" type="button" data-hide-example>Dölj exemplet</button></div>` : ''}
      ${filters(courseOptions)}

      <section class="st-hero-row" aria-label="Översikt">
        <div class="st-card st-hero">
          <p class="st-label">Snitt mot par, per 18 hål</p>
          <p class="st-hero-figure">${signed(stat.average)}</p>
          ${delta !== null ? `<p class="st-delta ${delta < 0 ? 'is-good' : 'is-bad'}">${delta < 0 ? TONE_ICON.good : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 8 6 6 4-4 6 7"/><path d="M15 17h5v-5"/></svg>'}<span><b>${signed(delta)}</b> de ${Math.min(5, stat.rounds)} senaste mot rundorna före</span></p>` : '<p class="st-delta">Fler rundor ger en riktning.</p>'}
          ${sparkPath ? `<svg class="st-spark" viewBox="-4 0 128 40" aria-hidden="true"><path d="${sparkPath}" fill="none" stroke="rgba(160,230,185,.45)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="120" cy="${(4 + ((spark.at(-1) - Math.min(...spark)) / ((Math.max(...spark) - Math.min(...spark)) || 1)) * 32).toFixed(1)}" r="4" fill="#5fd07a" stroke="#0f1d16" stroke-width="2"/></svg>` : ''}
        </div>
        <dl class="st-tiles">${tiles.map(([label, value, note]) => `<div class="st-card st-tile"><dt>${label}</dt><dd>${esc(value)}</dd><span>${esc(note)}</span></div>`).join('')}</dl>
      </section>

      ${stat.insights.length ? `<section class="st-insights" aria-labelledby="stHowH"><h2 class="st-h2" id="stHowH">Så spelar du</h2>
        <div class="st-insight-grid">${stat.insights.map(item => `<article class="st-card st-insight is-${item.tone}"><span class="si-icon" aria-hidden="true">${TONE_ICON[item.tone]}</span><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`).join('')}</div></section>` : ''}

      <section class="st-grid-2">
        <div class="st-card st-chart" data-card="trend">
          <header class="st-card-head"><div><h2>Utveckling</h2><p>Resultat mot par per 18 hål, runda för runda</p></div>${tableToggle('trend')}</header>
          ${showTable('trend') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Datum</th><th>Bana</th><th>Slag</th><th>Hål</th><th>Mot par</th><th>Per 18</th></tr></thead><tbody>
            ${[...trendRows].reverse().map(row => `<tr><td>${esc(dateText(row.date))}</td><td>${esc(row.courseName ?? row.course)}</td><td>${row.strokes}</td><td>${row.holes}</td><td>${signedInt(row.toPar)}</td><td>${signed(row.perEighteen)}</td></tr>`).join('')}</tbody></table></div>`
            : '<div class="st-plot" data-plot="trend"></div>'}
        </div>
        <div class="st-card st-chart" data-card="dist">
          <header class="st-card-head"><div><h2>Var slagen hamnar</h2><p>Alla ${kindsTotal} spelade hål, från eagle till dubbelbogey</p></div>${tableToggle('dist')}</header>
          ${showTable('dist') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Resultat</th><th>Hål</th><th>Andel</th></tr></thead><tbody>${stat.distribution.map(d => `<tr><td>${esc(d.label)}</td><td>${d.count}</td><td>${pct(d.count, kindsTotal)} %</td></tr>`).join('')}</tbody></table></div>`
            : segmentedBar(stat.distribution, { label: 'Fördelning av resultat per hål' })}
          <div class="st-pars">${stat.byPar.filter(p => p.holes).map(p => `<div><span>Par ${p.par}</span><b>${signed(p.toPar, 2)}</b><small>snitt ${dec(p.average, 2)} · ${p.holes} hål</small></div>`).join('')}</div>
        </div>
      </section>

      <section class="st-grid-3">
        <div class="st-card">
          <header class="st-card-head"><div><h2>Från tee</h2><p>Par 4 och 5, ${stat.fairways.tried} utslag</p></div></header>
          ${stat.fairways.tried ? fairwayFigure(stat.fairways) : '<p class="st-muted">Inga fairways förda än.</p>'}
        </div>
        <div class="st-card">
          <header class="st-card-head"><div><h2>Greener</h2><p>På green med två puttar kvar till par</p></div></header>
          <div class="st-meter-figure"><b>${pct(stat.greens.hit, stat.greens.tried)}<small>%</small></b><span>${stat.greens.hit} av ${stat.greens.tried} hål</span></div>
          <div class="st-meter" role="img" aria-label="${pct(stat.greens.hit, stat.greens.tried)} procent greener i regulation"><i style="width:${pct(stat.greens.hit, stat.greens.tried) === '–' ? 0 : pct(stat.greens.hit, stat.greens.tried)}%"></i></div>
          <p class="st-muted st-gap-top">${stat.penalties ? `${stat.penalties} pliktslag i de loggade slagen` : 'Inga pliktslag i de loggade slagen'}</p>
        </div>
        <div class="st-card" data-card="putts">
          <header class="st-card-head"><div><h2>Puttning</h2><p>${stat.putts.holes} greener med puttar förda</p></div></header>
          <div class="st-meter-figure"><b>${stat.putts.perGreen !== null ? dec(stat.putts.perGreen, 2) : '–'}</b><span>puttar per green</span></div>
          ${stat.putts.holes ? segmentedBar([
            { label: 'En putt eller färre', count: stat.putts.one, colour: SCORE_KINDS[1].colour },
            { label: 'Två puttar', count: stat.putts.two, colour: SCORE_KINDS[2].colour },
            { label: 'Tre eller fler', count: stat.putts.three, colour: SCORE_KINDS[3].colour },
          ], { label: 'Puttar per green', tall: false }) : ''}
        </div>
      </section>

      <section class="st-card st-clubs" data-card="clubs" aria-labelledby="stClubsH">
        <header class="st-card-head"><div><h2 id="stClubsH">Klubbor</h2><p>Hur långt varje klubba går, så som du faktiskt slår den. ${stat.shotsMeasured} uppmätta slag.</p></div>${tableToggle('clubs')}</header>
        ${showTable('clubs') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Klubba</th><th>Slag</th><th>Typisk</th><th>Spridning</th><th>Längsta</th><th>Bagens carry</th></tr></thead><tbody>
          ${stat.clubs.filter(c => !c.putter).map(c => `<tr><td>${esc(c.name)}</td><td>${c.stat?.shots ?? 0}</td><td>${c.stat ? `${Math.round(c.stat.typical)} m` : '–'}</td><td>${c.stat ? `${Math.round(c.stat.shortest)}–${Math.round(c.stat.reach)} m` : '–'}</td><td>${c.stat ? `${Math.round(c.stat.longest)} m` : '–'}</td><td>${c.carry ? `${c.carry} m` : '–'}</td></tr>`).join('')}</tbody></table></div>`
          : `<ul class="st-legend gap-legend"><li><i class="lg-range"></i>Spridning</li><li><i class="lg-typ"></i>Typisk längd</li><li><i class="lg-carry"></i>Bagens carry</li></ul>${clubRows(stat.clubs)}`}
      </section>

      <section class="st-card st-holes" data-card="holes" aria-labelledby="stHolesH">
        <header class="st-card-head"><div><h2 id="stHolesH">Hål för hål</h2><p>${stat.byHoleNumber ? `Ditt snitt mot par på varje hål, ${esc(all.playedCourses.find(c => c.slug === state.course)?.name ?? '')}` : 'Välj en bana för att se vilka hål som kostar mest'}</p></div>${stat.byHoleNumber ? tableToggle('holes') : ''}</header>
        ${!stat.byHoleNumber ? `<div class="st-pick">${all.playedCourses.map(c => `<button type="button" class="st-ghost" data-pick-course="${esc(c.slug)}">${esc(c.name)}</button>`).join('')}</div>`
          : showTable('holes') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Hål</th><th>Par</th><th>Snitt</th><th>Mot par</th><th>Bästa</th><th>Puttar</th><th>Fairway</th><th>Rundor</th></tr></thead><tbody>
            ${stat.byHoleNumber.map(h => `<tr><td>${h.n}</td><td>${h.par}</td><td>${dec(h.average, 2)}</td><td>${signed(h.toPar, 2)}</td><td>${h.best}</td><td>${h.putts !== null ? dec(h.putts, 1) : '–'}</td><td>${h.fairway !== null ? `${Math.round(h.fairway * 100)} %` : '–'}</td><td>${h.rounds}</td></tr>`).join('')}</tbody></table></div>`
          : holeChart(stat.byHoleNumber)}
        ${stat.byHoleNumber && onCourse && courses.some(c => c.slug === state.course) ? `<div class="st-holes-foot">
          <button type="button" class="st-ghost" data-play-course="${esc(state.course)}">Spela ${esc(courses.find(c => c.slug === state.course).name)} <span aria-hidden="true">→</span></button>
        </div>` : ''}
      </section>

      <section class="st-split">
        <div class="st-card">
          <header class="st-card-head"><div><h2>Banor</h2><p>Där du har spelat</p></div></header>
          <ul class="st-courses">${stat.courses.map(c => `<li>
            ${state.course === 'all' ? `<button type="button" class="sc-pick" data-pick-course="${esc(c.slug)}" aria-label="${esc(c.name)}: hål för hål"></button>` : ''}
            <span class="sc-thumb" style="${poster(c.slug) ? `background-image:url('${poster(c.slug)}')` : ''}" aria-hidden="true"></span>
            <span class="sc-name"><b>${esc(c.name)}</b><small>${c.rounds} ${c.rounds === 1 ? 'runda' : 'rundor'} · senast ${esc(dateText(c.last))}</small></span>
            <span class="sc-num"><small>Snitt</small><b>${c.average !== null ? signed(c.average) : '–'}</b></span>
            <span class="sc-num"><small>Bästa</small><b>${c.best ? `${c.best.strokes}` : '–'}</b></span>
          </li>`).join('')}</ul>
        </div>
        <div class="st-card st-rounds">
          <header class="st-card-head"><div><h2>Rundor</h2><p>Tryck på en runda för dess scorekort</p></div></header>
          <div class="st-round-list">${[...stat.trend].reverse().map(row => {
            const record = data.rounds.find(r => r.id === row.id && r.course === row.course);
            return `<details class="st-round">
              <summary>
                <span class="sr-date"><b>${esc(String(new Date(row.date).getDate()))}</b><small>${esc(new Date(row.date).toLocaleDateString('sv-SE', { month: 'short' }).replace('.', ''))}</small></span>
                <span class="sr-name"><b>${esc(row.courseName ?? row.course)}</b><small>${row.holes} hål${row.points !== null ? ` · ${row.points} p` : ''} · ${row.putts} puttar</small></span>
                <span class="sr-score"><b>${row.strokes}</b><small class="${row.toPar < 0 ? 'is-under' : row.toPar > 0 ? 'is-over' : ''}">${signedInt(row.toPar)}</small></span>
              </summary>
              <div class="sr-card">${record ? `${scorecard(record)}<div class="sr-actions">
                <button type="button" class="st-ghost sr-share" data-share-round="${esc(`${record.course}|${record.id}`)}">Dela rundan som bild</button>
                ${onCourse && courses.some(c => c.slug === record.course) ? `<button type="button" class="st-ghost" data-play-course="${esc(record.course)}">Spela banan igen <span aria-hidden="true">→</span></button>` : ''}
                ${courses.some(c => c.slug === record.course) && (state.example || data.shots.some(s => s.course === record.course && s.round === record.id && Array.isArray(s.from)))
                  ? `<a class="st-ghost" href="${import.meta.env.BASE_URL}${reliveUrl(record.course, state.example ? `exempel-${record.id}` : record.id)}">Återupplev i 3D <span aria-hidden="true">→</span></a>` : ''}
              </div>` : ''}</div>
            </details>`;
          }).join('')}</div>
        </div>
      </section>`;

    bindFilters();
    body.querySelector('[data-hide-example]')?.addEventListener('click', () => { state.example = false; render(); });
    for (const btn of body.querySelectorAll('[data-view]')) {
      btn.addEventListener('click', () => {
        state.view[btn.dataset.view] = state.view[btn.dataset.view] === 'table' ? 'chart' : 'table';
        const y = el.scrollTop;
        render();
        el.scrollTop = y;
        body.querySelector(`[data-view="${btn.dataset.view}"]`)?.focus();
      });
    }
    const plot = body.querySelector('[data-plot="trend"]');
    const draw = () => {
      if (plot && plot.isConnected && trendRows.length) drawTrend(plot, trendRows);
      fitSegments(body);
    };
    draw();
    bindSegments(body);
    bindClubs(body);
    /* a round, shared as its picture (round-card.mjs) */
    for (const btn of body.querySelectorAll('[data-share-round]')) btn.addEventListener('click', async () => {
      const [course, id] = btn.dataset.shareRound.split('|');
      const record = data.rounds.find(r => r.course === course && String(r.id) === id);
      if (!record) return;
      btn.disabled = true;
      const { shareRoundCard } = await import('./round-card.mjs');
      const done = await shareRoundCard(record, { poster: poster(record.course), text: `${record.courseName ?? record.course}, ${dateText(record.date, true)}` });
      btn.disabled = false;
      btn.textContent = done === 'saved' ? 'Bilden är sparad' : done === 'failed' ? 'Bilden gick inte att göra' : 'Dela rundan som bild';
    });
    /* the hole chart's readouts, and a course picked from its own card */
    const holesCard = body.querySelector('[data-card="holes"]');
    if (holesCard) {
      const tip = tipFor(holesCard);
      for (const col of holesCard.querySelectorAll('.shb-col')) {
        hoverOrTap(col, () => {
          const box = col.getBoundingClientRect(), cardBox = holesCard.getBoundingClientRect();
          tip.show(JSON.parse(col.dataset.tip).map(text => [text]), box.left - cardBox.left + box.width / 2, box.top - cardBox.top + 20);
        }, () => tip.hide());
      }
    }
    /* the course in view, played next: its own page, where the round is set up */
    for (const btn of body.querySelectorAll('[data-play-course]')) btn.addEventListener('click', () => onCourse?.(btn.dataset.playCourse));
    /* a course picked from the holes card or from Banor: that course, hole by hole */
    for (const btn of body.querySelectorAll('[data-pick-course]')) btn.addEventListener('click', () => {
      state.course = btn.dataset.pickCourse;
      render();
      body.querySelector('[data-card="holes"]')?.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    });
    observe(draw);
  }

  function filters(courseOptions) {
    return `<div class="st-filters" role="group" aria-label="Urval">
      <div class="seg" role="radiogroup" aria-label="Period">${PERIODS.map(p => `<label class="seg-opt"><input type="radio" name="st-period" value="${p.key}"${p.key === state.period ? ' checked' : ''}><span>${p.label}</span></label>`).join('')}</div>
      <label class="st-select"><span class="st-sr">Bana</span><select data-course><option value="all">Alla banor</option>${courseOptions}</select></label>
    </div>`;
  }
  function bindFilters() {
    for (const input of body.querySelectorAll('input[name="st-period"]')) input.addEventListener('change', () => { state.period = input.value; render(true); });
    body.querySelector('[data-course]')?.addEventListener('change', e => { state.course = e.target.value; render(true); });
  }
  function bindClubs(root) {
    const card = root.querySelector('[data-card="clubs"]');
    if (!card) return;
    const tip = tipFor(card);
    for (const row of card.querySelectorAll('.gap-row')) {
      const show = () => {
        const box = row.querySelector('.gr-track').getBoundingClientRect(), cardBox = card.getBoundingClientRect();
        tip.show(JSON.parse(row.dataset.tip).map(text => [text]), box.left - cardBox.left + box.width / 2, box.top - cardBox.top);
      };
      hoverOrTap(row, show, () => tip.hide());
    }
  }

  /* redraw the plot when the page changes width; one observer for the page */
  let observer = null, redraw = null, frame = 0;
  function observe(fn) {
    redraw = fn;
    if (observer || !('ResizeObserver' in window)) return;
    let width = body.clientWidth;
    observer = new window.ResizeObserver(() => {
      if (Math.abs(body.clientWidth - width) < 2) return;
      width = body.clientWidth;
      window.cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => redraw?.());
    });
    observer.observe(body);
  }

  function render(keepFocus = false) {
    const focusName = keepFocus ? document.activeElement?.name || (document.activeElement?.matches?.('[data-course]') ? 'course' : null) : null;
    const data = read();
    if (!data.rounds.length && !state.example) renderEmpty();
    else renderStats(data);
    if (!REDUCED) {
      body.classList.remove('is-entering');
      void body.offsetWidth; /* restart the entrance */
      body.classList.add('is-entering');
    }
    if (focusName === 'st-period') body.querySelector(`input[name="st-period"][value="${state.period}"]`)?.focus();
    if (focusName === 'course') body.querySelector('[data-course]')?.focus();
  }

  el.refresh = () => render();
  /* #statistik/<course>, from the course's page: that course, hole by hole */
  el.showCourse = slug => {
    state.example = false;
    if (courses.some(c => c.slug === slug)) state.course = slug;
    render();
  };
  el.revealCourse = () => {
    const holes = body.querySelector('[data-card="holes"]');
    if (holes) requestAnimationFrame(() => holes.scrollIntoView({ block: 'start', behavior: 'auto' }));
  };
  render();
  return el;
}
