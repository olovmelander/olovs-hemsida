/* ===========================================================================
   Statistik: everything the rounds and the club wheel have measured.

   Read like a launch monitor's session report: one headline number with recent
   form deltas across the KPIs, a light coach briefing, latest-round spotlight,
   then the full story -- rolling trend (score or Stableford), where strokes go
   and where they're lost, tee impact, greens & scrambling, GIR putting split,
   real club distances (with one-tap bag sync), hole-by-hole averages, and
   every round with its scorecard.

   All counting lives in stats-model.mjs from the light map's own records, so
   a round finished on the course is here the moment the page opens (and syncs
   across devices through Cloudflare D1 when signed in).
   =========================================================================== */
import { groupCourses, layoutLabel } from './course-clubs.mjs';
import '../styles/hub.css';
import '../styles/stats.css';
import { parseBag } from '../engine/caddie.js';
import { clubAssetKey, clubIcon } from '../engine/club-design.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseHistory, shotReviewText } from '../map/map-shots.mjs';
import { puttCoverage, puttCoverageText, scoreName } from '../map/map-score.mjs';
import { BAG_KEY, MAP_KEYS, readText } from './settings-store.mjs';
import { getCloudState, signInWithGoogle, subscribeCloud } from './cloud.mjs';
import { reliveUrl } from './router.js';
import { exampleData, inkOn, kindOf, PERIODS, playerStats, SCORE_KINDS } from './stats-model.mjs';

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
const GOOGLE_MARK = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21.8 12.23c0-.72-.06-1.41-.18-2.07H12v3.92h5.5a4.7 4.7 0 0 1-2.04 3.09v2.57h3.3c1.93-1.78 3.04-4.4 3.04-7.51z"/><path fill="currentColor" opacity=".82" d="M12 22c2.76 0 5.07-.91 6.76-2.46l-3.3-2.57c-.91.61-2.08.98-3.46.98-2.66 0-4.91-1.8-5.72-4.21H2.87v2.65A10.2 10.2 0 0 0 12 22z"/><path fill="currentColor" opacity=".68" d="M6.28 13.74a6.12 6.12 0 0 1 0-3.48V7.61H2.87a10.2 10.2 0 0 0 0 8.78l3.41-2.65z"/><path fill="currentColor" opacity=".92" d="M12 6.05c1.5 0 2.85.52 3.91 1.53l2.93-2.93C17.06 2.99 14.76 2 12 2A10.2 10.2 0 0 0 2.87 7.61l3.41 2.65C7.09 7.85 9.34 6.05 12 6.05z"/></svg>';
const TONE_ICON = {
  good: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 16 6-6 4 4 6-7"/><path d="M15 7h5v5"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.4"/></svg>',
};

const JUMP_SECTIONS = [
  { id: 'st-overview', label: 'Översikt' },
  { id: 'st-game', label: 'Spel' },
  { id: 'st-clubs', label: 'Klubbor' },
  { id: 'st-holes', label: 'Hål' },
  { id: 'st-rounds', label: 'Rundor' },
];

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
function drawTrend(host, rows, { metric = 'score', selectedRound, onPoint, onPickRound = null } = {}) {
  const isPoints = metric === 'points';
  const list = isPoints ? rows.filter(r => Number.isFinite(r.points)) : rows;
  if (!list.length) {
    host.innerHTML = '<p class="st-muted">Inga rundor med Stableford-poäng i det här urvalet.</p>';
    return;
  }
  const card = host.closest('.st-card');
  const tip = tipFor(card);
  const W = Math.max(280, host.clientWidth), H = W < 520 ? 210 : 250;
  const pad = { l: 44, r: 62, t: 22, b: 30 };
  const valOf = row => (isPoints ? row.points : row.perEighteen);
  const rollOf = row => (isPoints ? row.rollingPoints : row.rolling);
  const values = list.map(valOf);
  const rolls = list.map(rollOf).filter(Number.isFinite);
  let lo = isPoints ? Math.min(36, ...values, ...rolls) : Math.min(0, ...values, ...rolls);
  let hi = isPoints ? Math.max(36, ...values, ...rolls) : Math.max(0, ...values, ...rolls);
  if (hi - lo < 4) { hi += 2; lo -= 2; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const x = i => pad.l + (list.length === 1 ? plotW / 2 : (i * plotW) / (list.length - 1));
  const y = v => pad.t + ((hi - v) / (hi - lo)) * plotH;
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const bestVal = isPoints ? Math.max(...values) : Math.min(...values);
  const bestIndex = values.indexOf(bestVal);
  const last = list.length - 1;
  const line = list.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(valOf(row)).toFixed(1)}`).join('');
  const rollLine = list.length >= 3 && list.every(row => Number.isFinite(rollOf(row)))
    ? list.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(rollOf(row)).toFixed(1)}`).join('')
    : '';
  const area = `${line}L${x(last).toFixed(1)} ${pad.t + plotH}L${x(0).toFixed(1)} ${pad.t + plotH}Z`;
  const labelDates = list.length > 1 ? [0, last, ...(list.length > 6 ? [Math.round(last / 2)] : [])] : [0];
  const refValue = isPoints ? 36 : 0;
  const fmtTick = v => (isPoints ? `${v} p` : (v === 0 ? 'Par' : signedInt(v)));
  const fmtVal = v => (isPoints ? `${Math.round(v)} p` : signed(v));

  host.innerHTML = `<svg class="st-svg" id="statsTrendChart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img"
      aria-label="${isPoints ? 'Stableford-poäng per runda' : 'Resultat per 18 hål mot par'}, ${list.length} rundor. Senaste ${fmtVal(values[last])}, ${isPoints ? 'högsta' : 'lägsta'} ${fmtVal(values[bestIndex])}. Piltangenterna går runda för runda, Enter öppnar scorekortet.">
    <defs><linearGradient id="stWash" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5fd07a" stop-opacity=".15"/><stop offset="1" stop-color="#5fd07a" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(v => `<line class="${v === refValue ? 'st-zero' : 'st-grid'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="st-axis" x="${pad.l - 10}" y="${y(v) + 4}" text-anchor="end">${fmtTick(v)}</text>`).join('')}
    ${labelDates.map(i => `<text class="st-axis" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 && list.length > 1 ? 'start' : i === last && list.length > 1 ? 'end' : 'middle'}">${esc(dateText(list[i].date))}</text>`).join('')}
    <path d="${area}" fill="url(#stWash)"/>
    <path class="st-line" d="${line}"/>
    ${rollLine ? `<path class="st-avg-line" d="${rollLine}"/>` : ''}
    ${list.map((row, i) => `<circle class="st-dot${i === last ? ' is-last' : ''}${i === bestIndex ? ' is-best' : ''}" cx="${x(i)}" cy="${y(valOf(row))}" r="${i === last ? 5.5 : 4}"/>`).join('')}
    <text class="st-end" x="${x(last) + 10}" y="${y(values[last]) + 5}">${fmtVal(values[last])}</text>
    ${bestIndex !== last && list.length > 2 ? `<text class="st-best" x="${x(bestIndex)}" y="${Math.min(H - 22, y(values[bestIndex]) + 22)}" text-anchor="middle">${isPoints ? 'Högst' : 'Lägst'} ${fmtVal(values[bestIndex])}</text>` : ''}
    <line class="st-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + plotH}" visibility="hidden"/>
    <rect class="st-hit" x="${pad.l - 12}" y="0" width="${plotW + 24}" height="${H}"/>
  </svg>`;
  const svg = host.querySelector('svg'), cross = svg.querySelector('.st-cross');
  const selected = list.findIndex(row => `${row.course}|${row.id}` === selectedRound);
  let at = selected < 0 ? last : selected;
  let touchPoint = null;
  const point = i => {
    at = Math.max(0, Math.min(last, i));
    const row = list[at];
    onPoint?.(row);
    const roll = rollOf(row);
    cross.setAttribute('x1', x(at)); cross.setAttribute('x2', x(at)); cross.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.st-dot').forEach((dot, k) => dot.classList.toggle('is-on', k === at));
    const hostBox = host.getBoundingClientRect(), cardBox = card.getBoundingClientRect();
    const headline = isPoints ? `${row.points} poäng` : `${signed(row.perEighteen)} per 18 hål`;
    const rollNote = list.length >= 3 && Number.isFinite(roll)
      ? `5-rundors snitt ${isPoints ? `${dec(roll, 1)} p` : signed(roll)}`
      : null;
    tip.show([
      [headline],
      [`${row.courseName ?? row.course} · ${dateText(row.date)}`],
      [`${row.strokes} slag på ${row.holes} hål (${signedInt(row.toPar)})${!isPoints && row.points !== null ? ` · ${row.points} p` : ''}`],
      ...(rollNote ? [[rollNote]] : []),
      ...(onPickRound ? [[touchPoint === at ? 'Tryck igen för scorekort' : 'Öppna scorekort med klick eller Enter']] : []),
    ], hostBox.left - cardBox.left + x(at), hostBox.top - cardBox.top + y(valOf(row)));
  };
  const clear = () => { cross.setAttribute('visibility', 'hidden'); svg.querySelectorAll('.st-dot').forEach(dot => dot.classList.remove('is-on')); tip.hide(); };
  const nearestTo = e => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    let nearest = 0;
    list.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i; });
    return nearest;
  };
  svg.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') point(nearestTo(e)); });
  svg.addEventListener('click', e => {
    const idx = nearestTo(e);
    const inspect = e.pointerType === 'touch' && idx !== touchPoint;
    touchPoint = e.pointerType === 'touch' ? idx : null;
    svg.focus({ preventScroll: true });
    point(idx);
    if (!inspect) onPickRound?.(list[idx]);
  });
  svg.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') clear(); });
  svg.addEventListener('focus', () => point(at));
  svg.addEventListener('blur', () => { touchPoint = null; clear(); });
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); point(at + (e.key === 'ArrowLeft' ? -1 : 1)); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickRound?.(list[at]); }
  });
}

/* ------------------------------------------------- a whole split in parts */
function segmentedBar(parts, { label, tall = true, unit = 'hål' }) {
  const total = parts.reduce((s, p) => s + p.count, 0);
  return `<div class="st-seg${tall ? ' is-tall' : ''}" role="group" aria-label="${esc(label)}">
    ${parts.filter(p => p.count > 0).map(p => {
      const share = p.count / total;
      return `<span class="st-part" role="img" tabindex="0" style="flex-grow:${p.count};background:${p.colour};color:${inkOn(p.colour)}" data-label="${esc(p.label)}" data-count="${p.count}" data-share="${Math.round(share * 100)}"
        aria-label="${esc(`${p.label}: ${p.count} ${unit}, ${Math.round(share * 100)} procent`)}"><em>${Math.round(share * 100)}\u00a0%</em></span>`;
    }).join('')}
  </div>
  <ul class="st-legend">${parts.map(p => `<li><i style="background:${p.colour}"></i>${esc(p.label)} <b>${p.count}</b></li>`).join('')}</ul>`;
}
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
      tip.show([[`${part.dataset.count} ${seg.dataset.unit || 'hål'}`], [`${part.dataset.label} · ${part.dataset.share}\u00a0%`]], box.left - cardBox.left + box.width / 2, box.top - cardBox.top);
    };
    for (const part of seg.querySelectorAll('.st-part')) hoverOrTap(part, () => show(part), () => tip.hide());
  }
}
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
  const sc = f.scoring || {};
  const hasScoring = sc.hit !== null || sc.left !== null || sc.right !== null;
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
  </div>
  ${hasScoring ? `<div class="st-subgrid-3" aria-label="Snitt mot par efter utslag">
    <div><span>Vänster</span><b>${sc.left !== null ? signed(sc.left, 2) : '–'}</b></div>
    <div class="is-accent"><span>Fairway</span><b>${sc.hit !== null ? signed(sc.hit, 2) : '–'}</b></div>
    <div><span>Höger</span><b>${sc.right !== null ? signed(sc.right, 2) : '–'}</b></div>
  </div>` : ''}`;
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
      ? [`${Math.round(s.typical)} m typisk GPS-total`, club.name, `Spridning ${Math.round(s.shortest)}–${Math.round(s.reach)} m · längsta ${Math.round(s.longest)} m`,
        `${s.shots} slag${s.known ? '' : ' (för få för en säker längd)'}${club.carry ? ` · bagens carry ${club.carry} m` : ''}`]
      : [club.carry ? `${club.carry} m angiven carry` : 'Inga slag', club.name, 'Inga uppmätta slag än'];
    items.push(`<li class="gap-row${s?.known ? '' : ' is-thin'}" tabindex="0" data-club="${esc(club.id)}" data-tip="${esc(JSON.stringify(tipLines))}"
      aria-label="${esc(`${club.name}: ${s ? `typisk GPS-total ${Math.round(s.typical)} meter, spridning ${Math.round(s.shortest)} till ${Math.round(s.reach)}, längsta ${Math.round(s.longest)}, ${s.shots} slag` : 'inga uppmätta slag'}${club.carry ? `, bagens carry ${club.carry} meter` : ''}`)}">
      <span class="gr-icon" aria-hidden="true">${clubIcon(clubAssetKey(club))}</span>
      <span class="gr-name">${esc(club.name)}<small>${s ? `${s.shots} slag` : 'inga slag än'}</small></span>
      <span class="gr-track" aria-hidden="true">
        ${ticks.slice(1).map(v => `<i class="gr-tick" style="left:${at(v)}"></i>`).join('')}
        ${s ? `<i class="gr-range" style="left:${at(s.shortest)};width:calc(${at(s.reach - s.shortest)} + 2px)"></i>` : ''}
        ${club.carry ? `<i class="gr-carry" style="left:${at(club.carry)}"></i>` : ''}
        ${s ? `<i class="gr-typ" style="left:${at(s.typical)}"></i>` : ''}
      </span>
      <span class="gr-val">${s ? `<b>${Math.round(s.typical)}</b><small> m</small>` : `<span class="gr-none">–</span>`}</span>
    </li>`);
  });
  return `<ol class="gap-rows">${items.join('')}</ol>
    <div class="gap-axis" aria-hidden="true"><span class="gr-icon"></span><span class="gr-name"></span><span class="gr-track">${ticks.map(v => `<i style="left:${at(v)}">${v}</i>`).join('')}</span><span class="gr-val">m</span></div>`;
}

/* ---------------------------------------------------------- hole by hole */
function holeChart(holes) {
  if (!holes.length) return '<p class="st-muted">Par saknas för de sparade hålen.</p>';
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
      const marked = h === worst || (h === best && best !== worst);
      const label = marked ? `<em style="bottom:${up ? `calc(${(share * 100).toFixed(1)}% + 4px)` : '4px'}">${signed(h.toPar, 1)}</em>` : '';
      return `<button type="button" class="shb-col" data-tip="${esc(JSON.stringify([`Hål ${h.n} · ${signed(h.toPar, 2)}`, `Par ${h.par} · snitt ${dec(h.average, 2)} · bästa ${h.best}`, `${h.rounds} ${h.rounds === 1 ? 'runda' : 'rundor'}${h.putts !== null ? ` · ${dec(h.putts, 1)} puttar` : ''}${h.fairway !== null ? ` · fairway ${Math.round(h.fairway * 100)}\u00a0%` : ''}`]))}"
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
  const scoreOf = n => holes.find(hole => hole.n === n);
  const count = record.holeCount ?? record.pars?.length ?? Math.max(0, ...holes.map(h => h.n));
  const pars = Array.from({ length: count }, (_, i) => scoreOf(i + 1)?.par ?? record.pars?.[i]);
  const half = pars.length > 9 ? [[1, 9], [10, pars.length]] : [[1, pars.length]];
  const cell = n => {
    const hole = scoreOf(n);
    if (!hole) return '<td class="sc-none">·</td>';
    if (hole.picked || !Number.isFinite(hole.strokes)) return '<td class="sc-none" title="Struket">–</td>';
    const par = pars[n - 1];
    if (!Number.isFinite(par)) return `<td>${hole.strokes}</td>`;
    const kind = kindOf(hole.strokes, par);
    return `<td><span class="sc-score sc-${kind.key}" style="--k:${kind.colour}" title="${esc(kind.label)}">${hole.strokes}</span></td>`;
  };
  const sumOf = (from, to, key) => {
    let total = 0, any = false;
    for (let n = from; n <= to; n++) {
      if (key === 'par') {
        if (!Number.isFinite(pars[n - 1])) return '–';
        total += pars[n - 1]; any = true; continue;
      }
      const hole = scoreOf(n);
      if (hole && !hole.picked && Number.isFinite(hole[key])) { total += hole[key]; any = true; }
    }
    return any ? total : '–';
  };
  return half.map(([from, to]) => {
    const ns = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    const putts = puttCoverage(holes.filter(h => h.n >= from && h.n <= to));
    const puttSum = putts.total === null ? '–' : putts.recorded < putts.holes ? `${putts.total}*` : putts.total;
    const sumLabel = half.length > 1 ? (from === 1 ? 'Ut' : 'In') : 'Tot';
    return `<table class="sc-table"><thead><tr><th scope="row">Hål</th>${ns.map(n => `<th scope="col">${n}</th>`).join('')}<th>${sumLabel}</th></tr></thead>
      <tbody><tr class="sc-par-row"><th scope="row">Par</th>${ns.map(n => `<td>${pars[n - 1] ?? '–'}</td>`).join('')}<td>${sumOf(from, to, 'par')}</td></tr>
      <tr><th scope="row">Slag</th>${ns.map(cell).join('')}<td class="sc-sum">${sumOf(from, to, 'strokes')}</td></tr>
      <tr class="sc-putts"><th scope="row">Puttar</th>${ns.map(n => { const h = scoreOf(n); return `<td>${h && !h.picked && Number.isFinite(h.putts) ? h.putts : '–'}</td>`; }).join('')}<td title="${esc(puttCoverageText(putts))}">${puttSum}</td></tr></tbody></table>${putts.recorded && putts.recorded < putts.holes ? `<p class="st-muted">* ${esc(puttCoverageText(putts))}</p>` : ''}`;
  }).join('');
}

function deltaBadge(value, { unit = '', digits = 1, higherIsBetter = true, threshold = 0.01 } = {}) {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < threshold) return '';
  const good = higherIsBetter ? value > 0 : value < 0;
  const formatted = digits === 0
    ? `${value > 0 ? '+' : '−'}${Math.round(Math.abs(value))}${unit}`
    : `${signed(value, digits)}${unit}`;
  return `<span class="st-tile-delta ${good ? 'is-good' : 'is-bad'}" title="Senaste 5 mot rundorna före">${formatted}</span>`;
}

/* =============================================================== the page */
export function buildStats({ courses, onBack, onPlay, onCourse = null, onRound, onLeaveExample, onFiltersOpen, onFiltersClose }) {
  const el = document.createElement('div');
  el.id = 'stats';
  el.className = 'hub-screen';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'statsTitle');
  const defaultView = () => ({ period: 'all', course: 'all', example: false, trendMetric: 'score', trendRound: null, roundId: null, view: {} });
  const state = defaultView();
  const changed = () => el.dispatchEvent(new Event('stats-view-change', { bubbles: true }));
  const poster = slug => (courses.some(c => c.slug === slug) ? `${BASE}courses/${slug}/hero-1.webp` : '');
  const backdropUrl = slug => (courses.some(c => c.slug === slug) ? `${BASE}courses/${slug}/backdrop.webp` : '');

  el.innerHTML = `
    <header class="set-top st-top">
      <div class="hub-top set-top-in">
        <button class="hub-back" type="button" data-back aria-label="Tillbaka">${BACK}<span>Tillbaka</span></button>
        <div class="st-heading">
          <h1 class="set-title" id="statsTitle" tabindex="-1">Statistik</h1>
          <span class="st-sub" data-sub></span>
        </div>
        <button class="st-filter-toggle" type="button" id="statsFilters" data-filter-toggle aria-haspopup="dialog" aria-expanded="false" aria-controls="st-filter-dialog" hidden>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 6h3m4 0h9M2 14h9m4 0h3"/><circle cx="7" cy="6" r="2"/><circle cx="13" cy="14" r="2"/></svg>
          Filter<span data-filter-count hidden></span>
        </button>
      </div>
      <div class="st-toolbar" hidden>
        <div data-inline-filters>
          <div class="st-filters" role="group" aria-label="Urval">
            <div class="st-period"><span id="st-period-label" class="st-field-label">Period</span>
              <div class="seg" role="radiogroup" aria-labelledby="st-period-label">${PERIODS.map(p => `<label class="seg-opt"><input type="radio" name="st-period" value="${p.key}"><span>${p.label}</span></label>`).join('')}</div>
            </div>
            <label class="st-course-field"><span class="st-field-label">Bana</span>
              <span class="st-select"><select data-course></select></span>
            </label>
          </div>
        </div>
        <nav class="st-jump st-tabs" aria-label="Statistikavsnitt" hidden>${JUMP_SECTIONS.map(s => `<button type="button" data-jump="${s.id}" aria-controls="${s.id}">${s.label}</button>`).join('')}</nav>
      </div>
    </header>
    <div class="set-inner st-inner" data-body></div>
    <dialog class="st-filter-dialog" id="st-filter-dialog" data-filter-dialog aria-labelledby="st-filter-title">
      <div class="st-filter-head"><h2 id="st-filter-title">Filtrera statistik</h2><button class="st-reset" type="button" data-filter-reset>Återställ</button></div>
      <div data-sheet-filters></div>
      <button class="set-primary" type="button" data-filter-close>Visa statistik</button>
    </dialog>`;
  const body = el.querySelector('[data-body]');
  const header = el.querySelector('.st-top');
  const toolbar = header.querySelector('.st-toolbar');
  const nav = header.querySelector('.st-tabs');
  const jumpButtons = [...nav.querySelectorAll('[data-jump]')];
  const filters = el.querySelector('.st-filters');
  const courseSelect = filters.querySelector('[data-course]');
  const toggle = header.querySelector('[data-filter-toggle]');
  const dialog = el.querySelector('[data-filter-dialog]');
  const reset = dialog.querySelector('[data-filter-reset]');
  const compact = matchMedia('(max-width: 767px), (orientation: landscape) and (max-width: 960px) and (max-height: 500px)');
  el.querySelector('[data-back]').addEventListener('click', onBack);

  function setFiltersOpen(open) {
    if (open && !toggle.hidden && compact.matches) {
      if (!dialog.open) dialog.showModal();
      toggle.setAttribute('aria-expanded', 'true');
      filters.querySelector(':checked')?.focus({ preventScroll: true });
    } else if (dialog.open) dialog.close();
  }
  el.setFiltersOpen = setFiltersOpen;
  const closeFilters = () => onFiltersClose ? onFiltersClose() : setFiltersOpen(false);
  function placeFilters() {
    if (!compact.matches && dialog.open) closeFilters();
    el.querySelector(compact.matches ? '[data-sheet-filters]' : '[data-inline-filters]').append(filters);
  }
  placeFilters();
  compact.addEventListener('change', placeFilters);
  toggle.onclick = () => onFiltersOpen ? onFiltersOpen() : setFiltersOpen(true);
  dialog.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeFilters(); });
  dialog.querySelector('[data-filter-close]').onclick = closeFilters;
  dialog.onclick = event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeFilters();
  };
  filters.onchange = event => {
    if (event.target === courseSelect) state.course = courseSelect.value;
    else if (event.target.name === 'st-period') state.period = event.target.value;
    else return;
    applyFilters();
  };
  function applyFilters() {
    state.roundId = null;
    el.scrollTop = 0;
    render();
    changed();
  }
  function resetFilters() {
    state.period = 'all';
    state.course = 'all';
    applyFilters();
  }
  reset.onclick = resetFilters;

  function read() {
    if (state.example) {
      const bag = parseBag(null);
      return courses.some(course => course.holes === 18 && course.status !== 'mapping')
        ? { ...exampleData({ courses, bag }), bag } : { rounds: [], shots: [], bag };
    }
    return {
      rounds: parseRounds(readText(storage(), MAP_KEYS.rounds, null)),
      shots: parseHistory(readText(storage(), MAP_KEYS.shots, null)),
      bag: parseBag(readText(storage(), BAG_KEY, null)),
    };
  }

  /* ---------------------------------------------------------- empty */
  function renderEmpty() {
    const cloud = getCloudState();
    el.querySelector('[data-sub]').textContent = '';
    toolbar.hidden = toggle.hidden = nav.hidden = true;
    if (dialog.open) dialog.close();
    const cloudCta = cloud.available && !cloud.user
      ? (cloud.google
        ? `<button class="st-ghost st-google-cta" type="button" data-cloud-signin>${GOOGLE_MARK}<span>Hämta rundor med Google</span></button>`
        : `<a class="st-ghost" id="statsAccount" href="#installningar/konto">Logga in för att hämta rundor</a>`)
      : '';
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
          <p>Allt här räknas fram ur dina rundor i Lätt 3D: resultat och utveckling, fairways, greener, räddningar och puttar, och hur långt varje klubba verkligen går.</p>
          <ol class="st-steps">
            <li><b>1</b><span><strong>Öppna en bana i Lätt 3D</strong> när du står på första tee.</span></li>
            <li><b>2</b><span><strong>Starta rundan</strong> och för score hål för hål.</span></li>
            <li><b>3</b><span>Välj klubba och tryck på <strong>Logga slag</strong> när du står vid bollen.</span></li>
          </ol>
          <div class="st-empty-actions">
            <button class="set-primary" type="button" id="statsPlay" data-play>Spela i Lätt 3D</button>
            ${courses.some(c => c.holes === 18 && c.status !== 'mapping') ? '<button class="st-ghost" type="button" data-example>Visa ett exempel</button>' : ''}
            ${cloudCta}
          </div>
        </div>
      </section>`;
    body.querySelector('[data-play]').addEventListener('click', () => onPlay());
    body.querySelector('[data-example]')?.addEventListener('click', () => { state.example = true; render(); changed(); });
    body.querySelector('[data-cloud-signin]')?.addEventListener('click', () => signInWithGoogle(`${location.pathname}${location.search}#statistik`));
  }

  // The page is one scrolling dashboard. Keep the section marker on the
  // current heading even when a long chart fills the space between headings.
  let sectionFrame = 0, endSection = null, previousScrollTop = 0;
  function updateSection() {
    sectionFrame = 0;
    if (el.hidden || nav.hidden) return;
    if (el.scrollTop < previousScrollTop) endSection = null;
    previousScrollTop = el.scrollTop;
    const visible = jumpButtons.filter(button => !button.hidden);
    const top = header.getBoundingClientRect().bottom + 10;
    let current = visible[0];
    for (const button of visible) {
      const section = body.querySelector('#' + button.dataset.jump);
      if (section && section.getBoundingClientRect().top <= top) current = button;
    }
    // Several short sections can share the same final scroll position.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
      current = endSection || (el.scrollTop > 0 ? visible.at(-1) : current);
    }
    for (const button of visible) button.setAttribute('aria-current', String(button === current));
  }
  function scheduleSection() {
    if (!sectionFrame) sectionFrame = requestAnimationFrame(updateSection);
  }
  el.addEventListener('scroll', scheduleSection, { passive: true });
  nav.onclick = event => {
    const button = event.target.closest('[data-jump]');
    const target = button && body.querySelector('#' + button.dataset.jump);
    if (!target) return;
    const remainingScroll = el.scrollHeight - el.clientHeight - el.scrollTop;
    endSection = target.getBoundingClientRect().top - header.getBoundingClientRect().bottom >= remainingScroll - 2 ? button : null;
    target.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    scheduleSection();
    changed();
  };
  if ('ResizeObserver' in window) new ResizeObserver(() => {
    if (header.offsetHeight) el.style.setProperty('--st-header-height', header.offsetHeight + 'px');
    scheduleSection();
  }).observe(header);

  function openRoundCard(course, id) {
    const key = `${course}|${id}`;
    const details = body.querySelector(`details.st-round[data-round-key="${CSS.escape(key)}"]`);
    if (!details) return false;
    endSection = null;
    details.open = true;
    const summary = details.querySelector('summary');
    summary.focus({ preventScroll: true });
    summary.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    details.classList.remove('is-flash');
    void details.offsetWidth;
    details.classList.add('is-flash');
    return true;
  }

  /* ------------------------------------------------------------ full */
  function renderStats(data) {
    const all = playerStats({ ...data, courses });
    const stat = state.period === 'all' && state.course === 'all' ? all :
      playerStats({ ...data, courses, filter: { period: state.period, course: state.course } });
    const sub = el.querySelector('[data-sub]');
    const period = PERIODS.find(p => p.key === state.period);
    const siblingNames = new Map();
    for (const club of groupCourses(courses)) {
      if (club.courses.length > 1) {
        for (const layout of club.courses) siblingNames.set(layout.slug, `${club.name} · ${layoutLabel(layout)}`);
      }
    }
    const courseLabel = (slug, fallback) => siblingNames.get(slug) || fallback || slug;
    const selectedCourse = all.playedCourses.find(c => c.slug === state.course);
    const applied = [state.period !== 'all' && period?.label, state.course !== 'all' && courseLabel(state.course, selectedCourse?.name)].filter(Boolean);
    const historyLabel = `${all.history.length} ${all.history.length === 1 ? 'sparad runda' : 'sparade rundor'} · ${all.playedCourses.length} ${all.playedCourses.length === 1 ? 'bana' : 'banor'}`;
    sub.textContent = [state.example && 'Exempel', ...applied].filter(Boolean).join(' · ') || historyLabel;
    sub.title = sub.textContent;
    sub.classList.toggle('is-example', state.example);
    const options = [...all.playedCourses];
    if (state.course !== 'all' && !selectedCourse) options.push({ slug: state.course, name: state.course });
    const optionMarkup = '<option value="all">Alla banor</option>' + options.map(c => `<option value="${esc(c.slug)}">${esc(courseLabel(c.slug, c.name))}</option>`).join('');
    if (optionMarkup !== lastOptions) { courseSelect.innerHTML = optionMarkup; lastOptions = optionMarkup; }
    courseSelect.value = state.course;
    for (const input of filters.querySelectorAll('input')) input.checked = input.value === state.period;
    const count = toggle.querySelector('[data-filter-count]');
    count.hidden = applied.length === 0;
    count.textContent = String(applied.length);
    toggle.setAttribute('aria-label', applied.length ? 'Filter, ' + applied.join(', ') : 'Filter');
    toggle.hidden = false;
    reset.disabled = !applied.length;
    const tableToggle = key => `<button class="st-view" type="button" id="statsView-${key}" data-view="${key}" aria-pressed="${state.view[key] === 'table'}">${state.view[key] === 'table' ? `${CHART}<span>Diagram</span>` : `${TABLE}<span>Tabell</span>`}</button>`;
    const showTable = key => state.view[key] === 'table';

    if (!stat.history.length && !stat.shotCount) {
      showSections([]);
      body.innerHTML = `<div class="st-card st-none"><h2>Ingen spelhistorik i det här urvalet</h2><p>Välj en längre period eller alla banor.</p><button class="st-ghost" type="button" data-reset>Visa allt</button></div>`;
      body.querySelector('[data-reset]').addEventListener('click', resetFilters);
      return;
    }

    const trendRows = stat.trend.filter(row => Number.isFinite(row.perEighteen));
    const hasPoints = trendRows.some(row => Number.isFinite(row.points));
    const hasPointsTrend = trendRows.filter(row => Number.isFinite(row.points)).length >= 2;
    if (state.trendMetric === 'points' && !hasPointsTrend) state.trendMetric = 'score';

    /* Sparkline oriented identically to Utveckling: higher over-par is up, lower/better is down. */
    const spark = trendRows.slice(-12).map(row => row.perEighteen);
    const sparkLo = spark.length ? Math.min(...spark) : 0;
    const sparkHi = spark.length ? Math.max(...spark) : 1;
    const sparkSpan = sparkHi - sparkLo || 1;
    const sparkY = v => 4 + ((sparkHi - v) / sparkSpan) * 32;
    const sparkPath = spark.length >= 2
      ? spark.map((v, i) => `${i ? 'L' : 'M'}${((i / (spark.length - 1)) * 120).toFixed(1)} ${sparkY(v).toFixed(1)}`).join('')
      : '';

    const delta = stat.delta;
    const td = stat.tileDeltas;
    const tiles = [
      ['Rundor med score', String(stat.rounds), `${stat.holes} hål med score`, ''],
      stat.best && ['Bästa per 18 hål', signed(stat.best.perEighteen), `${stat.best.strokes} slag på ${stat.best.holes} hål · ${stat.best.courseName ?? stat.best.course}`, ''],
      stat.fairways.tried && ['Fairwayträff', `${pct(stat.fairways.hit, stat.fairways.tried)} %`, `${stat.fairways.hit} av ${stat.fairways.tried} förda`,
        deltaBadge(td.fairways !== null ? td.fairways * 100 : null, { unit: ' %', digits: 0, higherIsBetter: true, threshold: 1 })],
      stat.greens.tried && ['Greener i regulation', `${pct(stat.greens.hit, stat.greens.tried)} %`, `${stat.greens.hit} av ${stat.greens.tried} förda`,
        deltaBadge(td.greens !== null ? td.greens * 100 : null, { unit: ' %', digits: 0, higherIsBetter: true, threshold: 1 })],
      stat.putts.holes && ['Puttar per green', dec(stat.putts.perGreen, 2), `${stat.putts.holes} av ${stat.holes} hål med puttar`,
        deltaBadge(td.putts, { digits: 2, higherIsBetter: false, threshold: 0.03 })],
      stat.points !== null && ['Stableford', dec(stat.points, 1), 'poäng per runda', deltaBadge(td.points, { unit: ' p', digits: 1, higherIsBetter: true, threshold: 0.5 })],
    ].filter(Boolean);

    const kindsTotal = stat.distribution.reduce((s, d) => s + d.count, 0);
    const filteredBg = state.course !== 'all' ? backdropUrl(state.course) : '';

    /* Stroke cost breakdown (per 18 holes). */
    const sc = stat.strokeCosts;
    const costItems = [
      { key: 'doubles', label: 'Dubbelbogey+', value: sc.doubles.perEighteen, note: `${sc.doubles.holes} hål` },
      { key: 'threePutts', label: 'Treputtar', value: sc.threePutts.perEighteen, note: `${sc.threePutts.holes} hål` },
      { key: 'penalties', label: 'Pliktslag', value: sc.penalties.perEighteen, note: `${sc.penalties.total} på ${sc.penalties.holes} loggade hål` },
    ].filter(c => c.value !== null);
    const topCost = costItems.reduce((top, c) => (!top || c.value > top.value ? c : top), null);

    const latest = stat.history.at(-1);
    const rows = new Map(stat.trend.map(row => [`${row.course}|${row.id}`, row]));
    const bagNames = new Map(data.bag.map(club => [club.id, club.name]));
    const clubName = id => bagNames.get(id) || id;
    const roundRow = record => rows.get(`${record.course}|${record.id}`);
    const shotCountText = shots => `${shots.length} loggade slag`;
    const scoreMeta = row => `${row.holes < row.of ? `${row.holes} av ${row.of}` : row.holes} hål med score · ${puttCoverageText(row.putts)}`;
    const canReplay = ({record, shots}) => courses.some(c => c.slug === record.course) && shots.some(s => Array.isArray(s.from));
    const replayLink = (session, placement) => canReplay(session)
      ? `<a class="st-view" id="replay-${placement}-${esc(session.record.course)}-${esc(session.record.id)}" href="${import.meta.env.BASE_URL}${reliveUrl(session.record.course, state.example ? `exempel-${session.record.id}` : session.record.id)}">Återupplev i 3D →</a>` : '';
    const latestRow = latest && roundRow(latest.record);
    const versusPrevious = latestRow ? stat.latest?.vsAverage : null;
    const lastHole = latestRow?.singleHole;
    const holeResult = lastHole && Number.isFinite(lastHole.par) ? scoreName(lastHole.strokes, lastHole.par) : null;
    const shortCard = !stat.best;
    const showSummary = !shortCard || stat.rounds > 1 || !latestRow;
    const overviewInsights = shortCard ? stat.insights.filter(item => item.key !== 'coverage') : stat.insights;
    const showTrend = trendRows.length >= 2;
    const showDistribution = kindsTotal >= 2;
    const courseNameOf = record => courseLabel(record.course, record.courseName || all.playedCourses.find(c => c.slug === record.course)?.name);
    const insightCard = item => `<article class="st-insight is-${item.tone}"><div class="si-head"><span class="si-icon" aria-hidden="true">${TONE_ICON[item.tone]}</span><h3>${esc(item.title)}</h3></div><p>${esc(item.text)}</p></article>`;
    const jumps = JUMP_SECTIONS.filter(s => stat.rounds || s.id === 'st-overview' || s.id === 'st-clubs' || (s.id === 'st-rounds' && stat.sessions.length));

    const scramble = stat.greens.scrambling;
    const scramblePct = scramble.opportunities ? pct(scramble.saved, scramble.opportunities) : '–';

    body.innerHTML = `
      ${state.example ? `<div class="st-banner" role="note"><span><b>Exempel.</b> Så här ser statistiken ut efter 16 rundor. Det är inte dina siffror.</span><button class="st-ghost" type="button" data-hide-example>Dölj exemplet</button></div>` : ''}
      <section class="st-leading" id="st-overview" aria-label="Översikt">
        ${latest ? `<article class="st-card st-latest${lastHole ? ' is-single-hole' : ''}" aria-label="Senaste rundan">
          <div class="sl-main"><span class="sl-thumb" style="${poster(latest.record.course) ? `background-image:url('${poster(latest.record.course)}')` : ''}" aria-hidden="true"></span>
            <div class="sl-info"><span class="sl-kicker">Senaste rundan · ${esc(dateText(latest.record.date, true))}</span>
              <h2 class="sl-course">${esc(courseNameOf(latest.record))}</h2>
              <p class="sl-meta">${lastHole ? `Hål ${esc(lastHole.n)}${Number.isFinite(lastHole.par) ? ` · par ${lastHole.par}` : ''}<br>` : ''}${latestRow ? esc(scoreMeta(latestRow)) : `Ingen hålscore · ${shotCountText(latest.shots)}`}</p></div></div>
          ${lastHole ? `<div class="sl-facts" role="group" aria-label="Resultat för hål ${esc(lastHole.n)}">
            <div class="sl-fact sl-strokes"><p class="sl-reading"><b>${latestRow.strokes}</b> slag</p><p class="sl-fact-label">${esc(holeResult ?? 'Par saknas')}</p></div>
            ${latestRow.points != null ? `<div class="sl-fact sl-points"><p class="sl-reading"><b>${latestRow.points}</b> poäng</p><p class="sl-fact-label">Stableford</p></div>` : ''}
          </div>` : latestRow ? `<div class="sl-score"><b>${latestRow.strokes}</b><div class="sl-score-sub"><span>${latestRow.toPar == null ? 'slag · par saknas' : `slag · ${signedInt(latestRow.toPar)} mot par`}</span>
              ${latestRow.points !== null ? `<span class="sl-points">${latestRow.points} poäng · Stableford</span>` : ''}
              ${versusPrevious != null ? `<em class="sl-cmp">${Math.abs(versusPrevious) < 0.3 ? 'I nivå med tidigare snitt' : `${dec(Math.abs(versusPrevious))} slag ${versusPrevious < 0 ? 'bättre' : 'över snittet'} per 18 hål`}</em>` : ''}</div></div>` : ''}
          <div class="sl-actions"><button type="button" class="st-view" id="statsLatest-${esc(latest.record.course)}-${esc(latest.record.id)}" data-jump-round="${esc(`${latest.record.course}|${latest.record.id}`)}">${latestRow ? 'Öppna scorekort' : 'Öppna rundan'}</button>
            <button type="button" class="st-view" data-share-round="${esc(`${latest.record.course}|${latest.record.id}`)}">Dela bild</button>${replayLink(latest, 'latest')}</div>
        </article>` : `<article class="st-card st-latest"><div class="sl-info"><h2 class="sl-course">Dina loggade slag</h2><p class="sl-meta">${stat.shotCount} loggade · ${stat.shotsMeasured} GPS-uppmätta</p></div></article>`}
        ${overviewInsights.length ? `<section class="st-insights" aria-labelledby="stHowH"><h2 class="st-h2" id="stHowH">Så spelar du</h2>${insightCard(overviewInsights[0])}</section>` : ''}
      </section>
      ${stat.rounds ? `

      ${showSummary ? `<section class="st-hero-row" aria-label="Resultat">
        <div class="st-card st-hero${filteredBg ? ' is-course-bg' : ''}"${filteredBg ? ` style="--hero-bg:url('${filteredBg}')"` : ''}>
          <p class="st-label">${shortCard ? 'Slag på hål med score' : 'Snitt mot par, per 18 hål'}</p>
          <p class="st-hero-figure">${shortCard ? stat.strokes : signed(stat.average)}</p>
          ${delta !== null ? `<p class="st-delta ${delta < 0 ? 'is-good' : 'is-bad'}">${delta < 0 ? TONE_ICON.good : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 8 6 6 4-4 6 7"/><path d="M15 17h5v-5"/></svg>'}<span><b>${signed(delta)}</b> de ${Math.min(5, trendRows.length)} senaste mot rundorna före</span></p>` : `<p class="st-delta">${shortCard ? `${stat.holes} hål i ${stat.rounds} ${stat.rounds === 1 ? 'runda' : 'rundor'}` : `${trendRows.length} ${trendRows.length === 1 ? 'runda' : 'rundor'} med minst 9 hål med score`}</p>`}
          ${sparkPath ? `<svg class="st-spark" viewBox="-4 0 128 40" aria-hidden="true"><path d="${sparkPath}" fill="none" stroke="rgba(160,230,185,.5)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="120" cy="${sparkY(spark.at(-1)).toFixed(1)}" r="4" fill="#5fd07a" stroke="#0f1d16" stroke-width="2"/></svg>` : ''}
        </div>
        <dl class="st-tiles">${tiles.map(([label, value, note, badge]) => `<div class="st-card st-tile"><dt>${label}</dt><dd>${esc(value)}</dd><dd class="st-tile-foot"><span class="st-tile-note">${esc(note)}</span>${badge}</dd></div>`).join('')}</dl>
      </section>` : ''}

      ${overviewInsights.length > 1 ? `<details class="st-more-insights"><summary>Fler insikter (${overviewInsights.length - 1})</summary><div class="st-insight-grid">${overviewInsights.slice(1).map(insightCard).join('')}</div></details>` : ''}

      ${showTrend || showDistribution ? `<section class="st-grid-2">
        ${showTrend ? `<div class="st-card st-chart" data-card="trend">
          <header class="st-card-head">
            <div>
              <h2>Utveckling</h2>
              <p>${state.trendMetric === 'points' ? 'Stableford-poäng, runda för runda' : 'Resultat mot par per 18 hål, runda för runda'}</p>
            </div>
            <div class="st-head-actions">
              ${hasPointsTrend && !showTable('trend') ? `<div class="st-mini-seg" role="group" aria-label="Mått">
                <button type="button" id="statsTrendScore" data-trend-metric="score" aria-pressed="${state.trendMetric === 'score'}">Mot par</button>
                <button type="button" id="statsTrendPoints" data-trend-metric="points" aria-pressed="${state.trendMetric === 'points'}">Poäng</button>
              </div>` : ''}
              ${tableToggle('trend')}
            </div>
          </header>
          ${showTable('trend') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Datum</th><th>Bana</th><th>Slag</th><th>Hål</th><th>Mot par</th><th>Per 18</th>${hasPoints ? '<th>Poäng</th>' : ''}</tr></thead><tbody>
            ${[...trendRows].reverse().map(row => `<tr><td>${esc(dateText(row.date))}</td><td>${esc(row.courseName ?? row.course)}</td><td>${row.strokes}</td><td>${row.holes}</td><td>${signedInt(row.toPar)}</td><td>${signed(row.perEighteen)}</td>${hasPoints ? `<td>${row.points ?? '–'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
            : `${trendRows.length >= 3 ? '<ul class="st-legend st-trend-legend"><li><i class="lg-solid"></i>Runda</li><li><i class="lg-dash"></i>5-rundors snitt</li></ul>' : ''}<div class="st-plot" data-plot="trend"></div>`}
        </div>` : ''}
        ${showDistribution ? `<div class="st-card st-chart" data-card="dist">
          <header class="st-card-head"><div><h2>Var slagen hamnar</h2><p>Alla ${kindsTotal} spelade hål, från eagle till dubbelbogey</p></div>${tableToggle('dist')}</header>
          ${showTable('dist') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Resultat</th><th>Hål</th><th>Andel</th></tr></thead><tbody>${stat.distribution.map(d => `<tr><td>${esc(d.label)}</td><td>${d.count}</td><td>${pct(d.count, kindsTotal)}\u00a0%</td></tr>`).join('')}</tbody></table></div>`
            : segmentedBar(stat.distribution, { label: 'Fördelning av resultat per hål' })}
          <div class="st-pars">${stat.byPar.filter(p => p.holes).map(p => `<div><span>Par ${p.par}</span><b>${signed(p.toPar, 2)}</b><small>snitt ${dec(p.average, 2)} · ${p.holes} hål</small></div>`).join('')}</div>
          ${!shortCard && costItems.length ? `<div class="st-costs" aria-label="Var slagen kostar per 18 hål">
            <p class="st-costs-title">Tappade slag per 18 hål</p>
            <div class="st-costs-grid">${costItems.map(c => `<div class="${topCost && c.key === topCost.key && c.value >= 1 ? 'is-top' : ''}"><span>${c.label}</span><b>${c.value > 0.05 ? `+${dec(c.value, 1)}` : '0,0'}</b><small>${c.note}</small></div>`).join('')}</div>
          </div>` : ''}
        </div>` : ''}
      </section>` : ''}

      <section class="st-grid-3" id="st-game">
        ${!stat.fairways.tried && !stat.putts.holes && !stat.penalties ? `<div class="st-card st-game-empty"><h2 class="st-h2">Spelstatistik</h2><p class="st-muted">Fyll i puttar och fairwayträff på scorekortet för att följa ditt spel.</p></div>` : ''}
        ${stat.fairways.tried ? `<div class="st-card">
          <header class="st-card-head"><div><h2>Från tee</h2><p>Par 4 och 5, ${stat.fairways.tried} utslag</p></div></header>
          ${fairwayFigure(stat.fairways)}
        </div>` : ''}
        ${stat.greens.tried || stat.penalties ? `<div class="st-card">
          <header class="st-card-head"><div><h2>Greener &amp; närspel</h2><p>Träffade greener och räddade par vid miss</p></div></header>
          ${stat.greens.tried ? `<div class="st-meter-figure"><b>${pct(stat.greens.hit, stat.greens.tried)}<small>${stat.greens.tried ? '%' : ''}</small></b><span>GIR · ${stat.greens.tried ? `${stat.greens.hit} av ${stat.greens.tried} förda hål` : 'par eller puttar saknas'}</span></div>
          <div class="st-meter" role="img" aria-label="${pct(stat.greens.hit, stat.greens.tried)} procent greener i regulation"><i style="width:${pct(stat.greens.hit, stat.greens.tried) === '–' ? 0 : pct(stat.greens.hit, stat.greens.tried)}%"></i></div>
          ` : ''}
          ${scramble.opportunities ? `<div class="st-scramble">
            <div class="st-meter-figure is-sub"><b>${scramblePct}<small>${scramblePct === '–' ? '' : '%'}</small></b><span>Räddningar · ${scramble.saved} av ${scramble.opportunities} missade</span></div>
            <div class="st-meter is-blue" role="img" aria-label="${scramblePct} procent räddade par vid missad green"><i style="width:${scramblePct === '–' ? 0 : scramblePct}%"></i></div>
          </div>
          ` : ''}
          ${stat.penalties ? `<p class="st-muted st-gap-top">${stat.penalties} pliktslag i de loggade slagen</p>` : ''}
        </div>` : ''}
        ${stat.putts.holes ? `<div class="st-card" data-card="putts">
          <header class="st-card-head"><div><h2>Puttning</h2><p>${stat.putts.holes} av ${stat.holes} hål med puttar förda</p></div></header>
          <div class="st-meter-figure"><b>${stat.putts.perGreen !== null ? dec(stat.putts.perGreen, 2) : '–'}</b><span>puttar per green</span></div>
          ${stat.putts.holes ? segmentedBar([
            { label: 'En putt eller färre', count: stat.putts.one, colour: SCORE_KINDS[1].colour },
            { label: 'Två puttar', count: stat.putts.two, colour: SCORE_KINDS[2].colour },
            { label: 'Tre eller fler', count: stat.putts.three, colour: SCORE_KINDS[3].colour },
          ], { label: 'Puttar per green', tall: false }) : ''}
          ${stat.putts.onGir !== null || stat.putts.missedGir !== null ? `<div class="st-subgrid-2" aria-label="Puttar på GIR mot missad green">
            <div><span>På GIR</span><b>${stat.putts.onGir !== null ? dec(stat.putts.onGir, 2) : '–'}</b><small>${stat.putts.onGirHoles} hål</small></div>
            <div><span>Missad green</span><b>${stat.putts.missedGir !== null ? dec(stat.putts.missedGir, 2) : '–'}</b><small>${stat.putts.missedGirHoles} hål</small></div>
          </div>` : ''}
        </div>` : ''}
      </section>

      ` : '<p class="st-card st-none">Inga hål med score i urvalet. Spara en hålscore i Lätt 3D för att se resultat och utveckling.</p>'}

      <section class="st-card st-clubs" id="st-clubs" data-card="clubs" aria-labelledby="stClubsH">
        <header class="st-card-head">
          <div><h2 id="stClubsH">Klubbor</h2><p>${stat.shotsMeasured
            ? `${stat.shotsMeasured} GPS-uppmätta slag. Totallängden inkluderar rull. Bagens carry är din angivna längd i luften.`
            : all.shotsMeasured ? 'Inga GPS-uppmätta slag i urvalet.' : 'Klubblängder visas när GPS har mätt avståndet mellan två loggade slag.'}</p></div>
          <div class="st-head-actions">${stat.shotsMeasured ? tableToggle('clubs') : '<a class="st-view" id="statsBag" href="#installningar/bag">Se carry i Min bag</a>'}</div>
        </header>
        ${!stat.shotsMeasured ? '' : showTable('clubs') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Klubba</th><th>Slag</th><th>Typisk GPS-total</th><th>Spridning</th><th>Längsta</th><th>Bagens carry</th></tr></thead><tbody>
          ${stat.clubs.filter(c => !c.putter).map(c => `<tr><td>${esc(c.name)}</td><td>${c.stat?.shots ?? 0}</td><td>${c.stat ? `${Math.round(c.stat.typical)} m` : '–'}</td><td>${c.stat ? `${Math.round(c.stat.shortest)}–${Math.round(c.stat.reach)} m` : '–'}</td><td>${c.stat ? `${Math.round(c.stat.longest)} m` : '–'}</td><td>${c.carry ? `${c.carry} m` : '–'}</td></tr>`).join('')}</tbody></table></div>`
          : `<ul class="st-legend gap-legend"><li><i class="lg-range"></i>Spridning</li><li><i class="lg-typ"></i>Typisk GPS-total</li><li><i class="lg-carry"></i>Bagens carry</li></ul>${clubRows(stat.clubs)}`}
      </section>

      ${stat.rounds ? `<section class="st-card st-holes" id="st-holes" data-card="holes" aria-labelledby="stHolesH">
        <header class="st-card-head"><div><h2 id="stHolesH">Hål för hål</h2><p>${stat.byHoleNumber ? `Ditt snitt mot par på varje hål, ${esc(all.playedCourses.find(c => c.slug === state.course)?.name ?? '')}` : 'Välj en bana för att se vilka hål som kostar mest'}</p></div>${stat.byHoleNumber ? tableToggle('holes') : ''}</header>
        ${!stat.byHoleNumber ? `<div class="st-pick">${all.playedCourses.map(c => `<button type="button" class="st-ghost" data-pick-course="${esc(c.slug)}">${esc(courseLabel(c.slug, c.name))}</button>`).join('')}</div>`
          : showTable('holes') ? `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Hål</th><th>Par</th><th>Snitt</th><th>Mot par</th><th>Bästa</th><th>Puttar</th><th>Fairway</th><th>Rundor</th></tr></thead><tbody>
            ${stat.byHoleNumber.map(h => `<tr><td>${h.n}</td><td>${h.par}</td><td>${dec(h.average, 2)}</td><td>${signed(h.toPar, 2)}</td><td>${h.best}</td><td>${h.putts !== null ? dec(h.putts, 1) : '–'}</td><td>${h.fairway !== null ? `${Math.round(h.fairway * 100)}\u00a0%` : '–'}</td><td>${h.rounds}</td></tr>`).join('')}</tbody></table></div>`
          : holeChart(stat.byHoleNumber)}
        ${stat.byHoleNumber && onCourse && courses.some(c => c.slug === state.course) ? `<div class="st-holes-foot">
          <button type="button" class="st-ghost" id="statsPlayCourse" data-play-course="${esc(state.course)}">Spela ${esc(courses.find(c => c.slug === state.course).name)} <span aria-hidden="true">→</span></button>
        </div>` : ''}
      </section>

      ` : ''}
      ${stat.sessions.length ? `<section class="st-split" id="st-rounds">
        <div class="st-card">
          <header class="st-card-head"><div><h2>Banor</h2><p>Där du har spelat</p></div></header>
          <ul class="st-courses">${stat.courses.map(c => `<li>
            ${state.course === 'all' ? `<button type="button" class="sc-pick" data-pick-course="${esc(c.slug)}" aria-label="Visa statistik för ${esc(courseLabel(c.slug, c.name))}"></button>` : ''}
            <span class="sc-thumb" style="${poster(c.slug) ? `background-image:url('${poster(c.slug)}')` : ''}" aria-hidden="true"></span>
            <span class="sc-name"><b>${esc(courseLabel(c.slug, c.name))}</b><small>${c.rounds ? `${c.rounds} ${c.rounds === 1 ? 'sparad runda' : 'sparade rundor'}` : 'Endast slaglogg'} · senast ${esc(dateText(c.last))}</small>${c.best ? `<small>Bästa · ${c.best.strokes} slag på ${c.best.holes} hål · ${signed(c.best.perEighteen)} per 18</small>` : ''}</span>
            <span class="sc-num"><small>Snitt / 18</small><b>${c.average !== null ? signed(c.average) : '–'}</b></span>
          </li>`).join('')}</ul>
        </div>
        <div class="st-card st-rounds">
          <header class="st-card-head"><div><h2>Rundor</h2><p>Öppna en runda för scorekort och loggade slag</p></div></header>
          <div class="st-round-list">${[...stat.sessions].reverse().map(session => {
            const {record, shots} = session;
            const date = record.date || record.endedAt;
            const row = roundRow(record);
            const reviews = shots.map(shot => ({ shot, text: shotReviewText(shot, clubName) })).filter(r => r.text);
            return `<details class="st-round" data-round-key="${esc(`${record.course}|${record.id}`)}">
              <summary id="statsRound-${esc(record.course)}-${esc(record.id)}">
                <span class="sr-date"><b>${esc(String(new Date(date).getDate()))}</b><small>${esc(new Date(date).toLocaleDateString('sv-SE', { month: 'short' }).replace('.', ''))}</small></span>
                <span class="sr-name"><b>${esc(courseNameOf(record))}</b><small>${row ? esc(scoreMeta(row)) : `${session.saved ? 'Ingen hålscore' : 'Endast slaglogg'} · ${shotCountText(shots)}`}${row?.points != null ? ` · ${row.points} p` : ''}</small></span>
                ${row ? `<span class="sr-score"><b>${row.strokes}</b><small>${row.toPar == null ? 'Par saknas' : signedInt(row.toPar)}</small></span>` : '<span></span>'}
              </summary>
              <div class="sr-card">${row || record.holes?.length ? scorecard(record) : '<p class="st-muted">Ingen hålscore sparad.</p>'}
                ${reviews.length ? `<h3>Planerat och spelat</h3><ol class="sr-reviews">${reviews.map(({shot, text}) => `<li><b>Hål ${esc(shot.hole)} · ${esc(clubName(shot.club))}</b> ${esc(text)}</li>`).join('')}</ol>` : ''}
                <div class="sr-actions">
                  ${session.saved ? `<button type="button" class="st-ghost sr-share" data-share-round="${esc(`${record.course}|${record.id}`)}">Dela rundan som bild</button>` : ''}
                  ${onCourse && courses.some(c => c.slug === record.course) ? `<button type="button" class="st-ghost" id="statsPlay-${esc(record.course)}-${esc(record.id)}" data-play-course="${esc(record.course)}">Spela banan igen →</button>` : ''}
                  ${replayLink(session, 'card')}
                </div>
              </div>
            </details>`;
          }).join('')}</div>
        </div>
      </section>` : ''}`;

    showSections(jumps);
    body.querySelector('[data-hide-example]')?.addEventListener('click', () => {
      if (onLeaveExample && new URLSearchParams(location.hash.split('?')[1]).get('exempel') === '1') onLeaveExample();
      else { state.example = false; render(); changed(); }
    });
    for (const btn of body.querySelectorAll('[data-trend-metric]')) {
      btn.addEventListener('click', () => {
        if (state.trendMetric === btn.dataset.trendMetric) return;
        state.trendMetric = btn.dataset.trendMetric;
        const y = el.scrollTop;
        render();
        el.scrollTop = y;
        changed();
      });
    }
    for (const btn of body.querySelectorAll('[data-view]')) {
      btn.addEventListener('click', () => {
        state.view[btn.dataset.view] = state.view[btn.dataset.view] === 'table' ? 'chart' : 'table';
        const y = el.scrollTop;
        render();
        el.scrollTop = y;
        body.querySelector(`[data-view="${btn.dataset.view}"]`)?.focus({ preventScroll: true });
        changed();
      });
    }
    const visitRound = (course, id) => onRound ? onRound(course, id, state.example) : openRoundCard(course, id);
    for (const summary of body.querySelectorAll('.st-round > summary')) {
      summary.addEventListener('click', event => {
        if (summary.parentElement.open || !onRound) return;
        event.preventDefault();
        summary.focus({ preventScroll: true });
        const [course, id] = summary.parentElement.dataset.roundKey.split('|');
        visitRound(course, id);
      });
    }
    for (const btn of body.querySelectorAll('[data-jump-round]')) {
      btn.addEventListener('click', () => {
        const [course, id] = btn.dataset.jumpRound.split('|');
        btn.focus({ preventScroll: true });
        visitRound(course, id);
      });
    }

    const plot = body.querySelector('[data-plot="trend"]');
    const draw = () => {
      if (plot && plot.isConnected && trendRows.length) {
        drawTrend(plot, trendRows, {
          metric: state.trendMetric, selectedRound: state.trendRound,
          onPoint: row => { state.trendRound = `${row.course}|${row.id}`; },
          onPickRound: row => visitRound(row.course, row.id),
        });
      }
      fitSegments(body);
    };
    draw();
    bindSegments(body);
    bindClubs(body);
    for (const btn of body.querySelectorAll('[data-share-round]')) btn.addEventListener('click', async () => {
      const [course, id] = btn.dataset.shareRound.split('|');
      const record = data.rounds.find(r => r.course === course && String(r.id) === id);
      if (!record) return;
      const courseName = courseNameOf(record);
      const options = { courseName, example: state.example, shots: data.shots, poster: poster(record.course),
        text: `${courseName}, ${dateText(record.date, true)}` };
      const original = btn.textContent;
      btn.disabled = true;
      try {
        const { shareRoundCard } = await import('./round-card.mjs');
        const result = await shareRoundCard(record, options);
        btn.textContent = result === 'saved' ? 'Bilden är sparad' : result === 'failed' ? 'Kunde inte skapa bild' : original;
      } catch {
        btn.textContent = 'Kunde inte skapa bild';
      } finally {
        btn.disabled = false;
      }
    });
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
    for (const btn of body.querySelectorAll('[data-play-course]')) btn.addEventListener('click', () => onCourse?.(btn.dataset.playCourse));
    for (const btn of body.querySelectorAll('[data-pick-course]')) btn.addEventListener('click', () => {
      state.course = btn.dataset.pickCourse;
      state.roundId = null;
      render();
      changed();
      (body.querySelector('[data-card="holes"]') || body.querySelector('#st-clubs'))?.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' });
    });
    observe(draw);
  }

  function showSections(sections) {
    if (endSection && !sections.some(section => section.id === endSection.dataset.jump)) endSection = null;
    toolbar.hidden = false;
    nav.hidden = !sections.length;
    for (const button of jumpButtons) button.hidden = !sections.some(s => s.id === button.dataset.jump);
    scheduleSection();
  }

  function bindClubs(root) {
    const card = root.querySelector('[data-card="clubs"]');
    const rows = card?.querySelectorAll('.gap-row');
    if (!rows?.length) return;
    const tip = tipFor(card);
    for (const row of rows) {
      const show = () => {
        const box = row.querySelector('.gr-track').getBoundingClientRect(), cardBox = card.getBoundingClientRect();
        tip.show(JSON.parse(row.dataset.tip).map(text => [text]), box.left - cardBox.left + box.width / 2, box.top - cardBox.top);
      };
      hoverOrTap(row, show, () => tip.hide());
    }
  }

  let observer = null, redraw = null, frame = 0, lastOptions = '';
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

  const openedRounds = () => [...body.querySelectorAll('.st-round[open]')].map(item => item.dataset.roundKey);
  body.addEventListener('toggle', event => {
    if (event.target.matches('.st-round')) changed();
  }, true);
  function render(opened) {
    // A directly linked scorecard may arrive after the first account sync.
    // Open it once when it appears; later refreshes respect a manual collapse.
    const key = state.roundId == null ? null : `${state.course}|${state.roundId}`;
    const matched = key ? `.st-round[data-round-key="${CSS.escape(key)}"]` : null;
    const pendingRound = matched && opened === undefined && !body.querySelector(matched);
    opened ??= openedRounds();
    const focusId = body.contains(document.activeElement) ? document.activeElement.id : '';
    const data = read();
    if (!data.rounds.length && !data.shots.length && !state.example) renderEmpty();
    else renderStats(data);
    if (matched) {
      if (pendingRound && body.querySelector(matched)) {
        opened.push(key);
        if (!el.hidden) el.revealCourse();
      } else if (!body.querySelector(matched)) {
        const note = document.createElement('p');
        note.className = 'st-card st-muted';
        note.setAttribute('role', 'status');
        note.textContent = 'Rundan finns inte i din sparade historik.';
        body.prepend(note);
      }
    }
    for (const key of opened) {
      const item = body.querySelector(`.st-round[data-round-key="${CSS.escape(key)}"]`);
      if (item) item.open = true;
    }
    if (focusId) body.querySelector('#' + CSS.escape(focusId))?.focus({ preventScroll: true });
    if (!REDUCED) {
      body.classList.remove('is-entering');
      void body.offsetWidth;
      body.classList.add('is-entering');
    }
  }

  el.snapshot = () => ({ ...state, view: { ...state.view }, opened: openedRounds(), endSection: endSection?.dataset.jump ?? null, owner: getCloudState().user?.id ?? null });
  el.restore = saved => {
    const base = defaultView();
    const sameOwner = saved && saved.owner === (getCloudState().user?.id ?? null);
    if (sameOwner) {
      base.period = PERIODS.find(period => period.key === saved.period)?.key ?? base.period;
      base.course = saved.course || base.course;
      base.roundId = saved.roundId ?? null;
      base.example = saved.example === true;
      base.trendRound = typeof saved.trendRound === 'string' ? saved.trendRound : null;
      base.trendMetric = saved.trendMetric === 'points' ? 'points' : 'score';
      base.view = { ...saved.view };
    }
    Object.assign(state, base);
    previousScrollTop = 0;
    endSection = sameOwner ? jumpButtons.find(button => button.dataset.jump === saved.endSection) ?? null : null;
    render(sameOwner && Array.isArray(saved.opened) ? saved.opened : []);
  };
  el.refresh = () => render();
  addEventListener('banvy-account-changed', event => {
    if (event.detail?.cacheReplaced || event.detail?.previousUserId) {
      el.restore(null);
      changed();
    }
  });
  addEventListener('banvy-sync-changed', event => { if (!event.detail?.accountChanged) render(); });
  subscribeCloud(() => {
    const data = read();
    if (!data.rounds.length && !data.shots.length && !state.example) render();
  });
  el.showCourse = (slug, roundId = null, example = false) => {
    Object.assign(state, defaultView(), { course: slug, roundId, example });
    endSection = null;
    render(roundId == null ? [] : [`${slug}|${roundId}`]);
  };
  el.revealCourse = () => {
    requestAnimationFrame(() => {
      if (state.roundId != null) {
        if (!openRoundCard(state.course, state.roundId)) el.scrollTop = 0;
        return;
      }
      body.querySelector('[data-card="holes"]')?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  };
  render();
  return el;
}
