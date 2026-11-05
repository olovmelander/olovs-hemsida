/* What a round and a season look like on the sheets. Each function fills one element
   from numbers worked out elsewhere (map-rounds.mjs, map-shots.mjs), and holds no state.

   Numbers are told in words wherever a bar or a line draws them, so nothing depends on
   seeing the drawing, and every drawing has one colour and no legend to learn. */
import { LEAST_SHOTS } from './map-shots.mjs';

const node = (tag, className, text) => {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
};
const number = (value, digits = 1) => value.toLocaleString('sv-SE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const toParText = (value, digits = 0) => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? '±0' : `${rounded > 0 ? '+' : '−'}${number(Math.abs(rounded), digits)}`;
};
export const dateText = date => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const tile = (value, label) => {
  const made = node('div', 'map-tile');
  made.append(node('b', '', value), node('span', '', label));
  return made;
};
const heading = text => node('h3', '', text);

function factRow(name, value) {
  const row = node('li');
  row.append(node('span', '', name), node('b', '', value));
  return row;
}

/* The card as it was: a birdie ringed and a bogey boxed, as a golfer marks a paper one. */
function cardPart(holes, onHole) {
  const part = node('div', 'map-card-part');
  const row = (label, cells, sum, extra = '') => {
    const made = node('div', `map-card-row ${extra}`.trim());
    made.append(node('span', '', label), ...cells, node('span', '', sum));
    return made;
  };
  const cell = (hole, content, kind = '') => {
    const made = node(onHole ? 'button' : 'span', kind);
    const words = hole.picked ? 'struket' : Number.isFinite(hole.strokes) ? `${hole.strokes} slag` : 'inget resultat';
    made.setAttribute('aria-label', `Hål ${hole.n}, par ${hole.par}, ${words}`);
    made.append(content);
    if (onHole) made.onclick = () => onHole(hole.n);
    return made;
  };
  const score = hole => {
    return node('i', '', hole.picked ? '–' : Number.isFinite(hole.strokes) ? String(hole.strokes) : '');
  };
  const kind = hole => (!Number.isFinite(hole.strokes) ? '' : hole.strokes < hole.par ? 'is-under' : hole.strokes > hole.par ? 'is-over' : '');
  const sum = pick => String(holes.reduce((total, hole) => total + (pick(hole) ?? 0), 0) || '');
  part.append(
    row('Hål', holes.map(hole => node('span', '', String(hole.n))), '', 'map-card-head'),
    row('Par', holes.map(hole => node('span', '', String(hole.par))), sum(hole => hole.par)),
    row('Slag', holes.map(hole => cell(hole, score(hole), kind(hole))), sum(hole => hole.strokes), 'map-card-score'),
  );
  return part;
}

/* Every hole of the course has a place on the card, played or not. */
function fullCard(record) {
  const byNumber = new Map(record.holes.map(hole => [hole.n, hole]));
  return Array.from({ length: record.holeCount }, (_, k) => byNumber.get(k + 1) ?? { n: k + 1, par: record.pars?.[k] ?? 0, strokes: null, putts: null, picked: false });
}

export function renderRound(element, { record, summary, clubName, onHole = null }) {
  const { totals, kinds, clubs, longest, bestHole, missing, penalties, logged } = summary;
  const parts = [];
  const hero = node('div', 'map-hero');
  hero.append(node('b', '', totals.strokes ? String(totals.strokes) : '–'));
  const heroWords = node('span');
  heroWords.append(node('strong', '', totals.strokes ? toParText(totals.toPar) : ''), node('small', '', [totals.points === null ? null : `${totals.points} poäng`, missing ? `${summary.played} av ${summary.of} hål` : `${summary.of} hål`].filter(Boolean).join(' · ')));
  hero.append(heroWords);
  parts.push(hero, node('p', 'map-round-when', [dateText(record.date), record.tee ? `tee ${record.tee}` : null].filter(Boolean).join(' · ')));
  const tiles = node('div', 'map-tiles');
  tiles.append(
    tile(totals.greensTried ? String(totals.putts) : '–', 'Puttar'),
    tile(totals.fairwaysTried ? `${totals.fairways}/${totals.fairwaysTried}` : '–', 'Fairway'),
    tile(totals.greensTried ? `${totals.greens}/${totals.greensTried}` : '–', 'GIR'),
  );
  parts.push(tiles);
  if (kinds.length) parts.push(node('p', 'map-round-kinds', kinds.map(kind => `${kind.count} ${kind.label.toLowerCase()}`).join(' · ')));
  const cardHoles = fullCard(record);
  const card = node('div', 'map-card');
  card.append(cardPart(cardHoles.slice(0, 9), onHole));
  if (cardHoles.length > 9) card.append(cardPart(cardHoles.slice(9), onHole));
  parts.push(card);
  if (missing && onHole) parts.push(node('p', 'map-shots-hint', 'Saknas ett resultat? Tryck på hålet.'));
  const highlights = node('ul', 'map-facts');
  if (bestHole) highlights.append(factRow(`Bästa hålet`, `${bestHole.name} på ${bestHole.n}`));
  if (longest) highlights.append(factRow('Längsta slaget', `${clubName(longest.club)} ${Math.round(longest.metres)} m`));
  if (logged) highlights.append(factRow('Slag loggade', String(logged)));
  if (penalties) highlights.append(factRow('Plikt', String(penalties)));
  if (highlights.children.length) parts.push(highlights);
  if (clubs.length) {
    parts.push(heading('Dagens klubbor'));
    const list = node('ul', 'map-facts');
    list.append(...clubs.map(club => factRow(`${clubName(club.club)}${club.shots > 1 ? ` · ${club.shots} slag` : ''}`, `${Math.round(club.typical)} m`)));
    parts.push(list);
  }
  element.replaceChildren(...parts);
}

/* One colour on one axis: the player's own lengths, from nothing to their longest. */
export function renderClubs(element, { clubs, stats }) {
  const known = clubs.map(club => stats.get(club.id)).filter(stat => stat?.known);
  const furthest = Math.max(1, ...known.map(stat => stat.longest));
  const share = value => Math.min(1, value / furthest);
  const rows = clubs.map(club => {
    const own = stats.get(club.id), row = node('li');
    row.classList.toggle('is-bag', !own?.known);
    const length = own?.known ? Math.round(own.typical) : club.carry;
    row.append(node('span', '', club.name), node('b', '', `${length} m`));
    if (own?.known) {
      const spread = node('div', 'map-spread');
      spread.setAttribute('aria-hidden', 'true');
      spread.style.setProperty('--from', share(own.shortest).toFixed(3));
      spread.style.setProperty('--to', share(own.reach).toFixed(3));
      spread.style.setProperty('--at', share(own.typical).toFixed(3));
      spread.append(node('i'), node('u'));
      row.append(spread, node('small', '', `Oftast ${Math.round(own.shortest)}–${Math.round(own.reach)} m`), node('small', '', `${own.shots} slag`));
      row.setAttribute('aria-label', `${club.name}, vanligtvis ${length} meter, oftast ${Math.round(own.shortest)} till ${Math.round(own.reach)} meter, ${own.shots} slag`);
    } else if (own) row.append(node('small', 'map-clubs-wide', `${own.shots} av ${LEAST_SHOTS} slag`));
    return row;
  });
  element.replaceChildren(...rows);
}

export function renderHoleHistory(element, { history, clubName }) {
  const rows = [
    factRow('Snitt', `${number(history.average)} (${toParText(history.toPar, 1)})`),
    factRow('Bästa', String(history.best)),
  ];
  if (history.teeClub) rows.push(factRow('Utslag', [clubName(history.teeClub), history.teeLength === null ? null : `${Math.round(history.teeLength)} m`].filter(Boolean).join(', ')));
  if (history.fairway) rows.push(factRow('Fairway', [`${history.fairway.hit} av ${history.fairway.of}`, history.fairway.miss ? `missar ${history.fairway.miss}` : null].filter(Boolean).join(', ')));
  if (history.putts !== null) rows.push(factRow('Puttar', number(history.putts)));
  if (history.penalties) rows.push(factRow('Plikt', `${history.penalties} på ${history.rounds} rundor`));
  element.replaceChildren(...rows);
}

/* The rounds' score against par as one line. Its numbers are the list under it. */
function trendLine(line) {
  const box = node('div', 'map-trend');
  const values = line.map(point => point.toPar);
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = Math.max(1, high - low);
  const place = (value, k) => [line.length > 1 ? k / (line.length - 1) : 1, 1 - (value - low) / span];
  const points = values.map(place);
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', points.map(([x, y], k) => `${k ? 'L' : 'M'}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`).join(' '));
  const par = document.createElementNS(namespace, 'line');
  const parY = (1 - (0 - low) / span) * 100;
  for (const [key, value] of [['x1', 0], ['x2', 100], ['y1', parY], ['y2', parY]]) par.setAttribute(key, String(value));
  svg.append(par, path);
  const [lastX, lastY] = points.at(-1);
  const end = node('i');
  end.style.left = `${lastX * 100}%`;
  end.style.top = `${lastY * 100}%`;
  const parMark = node('b', '', 'Par');
  parMark.style.top = `${parY}%`;
  box.append(svg, parMark, end);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `Över par per 18 hål, senaste ${values.length} rundorna: från ${toParText(values[0])} till ${toParText(values.at(-1))}`);
  return box;
}

const percent = value => `${Math.round(value * 100)} %`;
const LEAST_LINE_ROUNDS = 3;

export function renderRounds(element, { rounds, trend, onOpen }) {
  const parts = [];
  if (!rounds.length) {
    element.replaceChildren(node('p', 'map-note', 'När du avslutar en runda hamnar den här, med kortet och dagens klubbor.'));
    return;
  }
  if (trend) {
    const { recent, before, line } = trend;
    const tiles = node('div', 'map-tiles');
    const compared = (earlier, words) => (earlier ? `${words}, före ${earlier}` : words);
    tiles.append(
      tile(toParText(recent.toPar), compared(before && toParText(before.toPar), 'Mot par')),
      tile(recent.putts === null ? '–' : number(recent.putts * 18, 0), compared(before?.putts && number(before.putts * 18, 0), 'Puttar')),
      tile(recent.greens === null ? '–' : percent(recent.greens), compared(before?.greens && percent(before.greens), 'GIR')),
    );
    parts.push(heading(`Senaste ${recent.rounds === 1 ? 'rundan' : `${recent.rounds} rundorna`}`), tiles);
    if (line.length >= LEAST_LINE_ROUNDS) {
      parts.push(heading('Mot par per 18 hål'), trendLine(line));
      parts.push(node('p', 'map-trend-ends', `Från ${toParText(line[0].toPar)} till ${toParText(line.at(-1).toPar)}`));
    }
  }
  parts.push(heading('Alla rundor'));
  const list = node('ul', 'map-round-list');
  list.append(...[...rounds].reverse().map(record => {
    const item = node('li'), button = node('button', 'map-round-row');
    const title = node('span');
    title.append(node('b', '', record.courseName), node('small', '', [dateText(record.date), `${record.holes.length} hål`].join(' · ')));
    const score = node('span', 'map-round-score');
    score.append(node('b', '', record.totals.strokes ? String(record.totals.strokes) : '–'), node('small', '', record.totals.strokes ? toParText(record.totals.toPar) : ''));
    button.append(title, score);
    button.setAttribute('aria-label', `${record.courseName}, ${dateText(record.date)}, ${record.totals.strokes} slag`);
    button.onclick = () => onOpen(record);
    item.append(button);
    return item;
  }));
  parts.push(list);
  element.replaceChildren(...parts);
}
