import { coursePreview } from './course-previews.mjs';
import './styles/course-preview.css';

const meta = coursePreview(new URLSearchParams(location.search).get('bana'));
const base = import.meta.env.BASE_URL;
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.createElement('main');
root.id = 'courseIntake';
document.body.classList.add('course-intake');
document.documentElement.classList.add('course-intake');
document.body.append(root);
root.innerHTML = `<a class="intake-back" href="${base}">← Alla golfbanor</a><p role="status">Laddar bankartan…</p>`;

try {
  if (new URLSearchParams(location.search).get('v2') === 'require') {
    if (['lidingo', 'visby'].includes(meta.slug)) throw new Error(`${meta.name}: den här adressen visar källkartan. Ta bort view=sources ur adressen för att öppna den preliminära 3D-banan.`);
    document.title = `${meta.name} — 3D-banan är under arbete | Banvy`;
    throw new Error(`${meta.name}: 3D-banan är ännu inte publicerad. Öppna bankartan utan v2=require för att se kartläggningen.`);
  }
  const response = await fetch(`${base}${meta.previewUrl}`);
  if (!response.ok) throw new Error(`Underlaget kunde inte hämtas (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== meta.previewSha256) throw new Error('Underlaget har ändrats. Ladda om sidan för att hämta den nya versionen.');
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.slug !== meta.slug || data.playable !== false || data.state !== 'mapping-in-progress') throw new Error('Underlaget har fel kursidentitet eller status.');
  render(data);
} catch (error) {
  let message = root.querySelector('[role="status"]');
  if (!message) { message = document.createElement('p'); message.setAttribute('role', 'status'); root.append(message); }
  message.textContent = error.message;
}

function render(data) {
  document.title = `${data.name} — Bankarta under kartläggning | Banvy`;
  const { card, bounds: b } = data;
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const hasRoute = hole => Array.isArray(hole.route) && hole.route.length >= 2 && hole.route.every(validPoint);
  const mappedHoles = card.holes.filter(hasRoute);
  const hasBounds = b && ['west', 'east', 'south', 'north'].every(key => Number.isFinite(b[key])) && b.east > b.west && b.north > b.south;
  const features = data.features ?? [];
  const counts = Object.fromEntries(['green', 'tee', 'fairway', 'bunker'].map(kind => [kind, data.counts?.[kind] ?? features.filter(f => f.kind === kind).length]));
  const source = data.sources?.find(s => s.id === 'club-scorecard') ?? data.sources?.[0];
  const acquiredOn = source?.acquiredOn ?? source?.acquiredAt ?? data.acquiredOn;
  const acquiredDate = typeof acquiredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(acquiredOn) ? new Date(`${acquiredOn}T12:00:00Z`) : null;
  const sourceDate = acquiredDate && Number.isFinite(acquiredDate.getTime()) ? `, avläst ${acquiredDate.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : '';
  const sourceLabel = source?.label ?? `${data.name}: publicerat scorekort`;
  const cardAttribution = source?.url ? `<p class="intake-attribution">Källa: <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel)}</a>${esc(sourceDate)}.</p>` : '';
  const routingProgress = mappedHoles.length === card.holes.length
    ? `Klubbens scorekort och alla ${card.holes.length} hålrutter finns med.`
    : `Klubbens scorekort finns med. ${mappedHoles.length} av ${card.holes.length} hål har en preliminär rutt på kartan.`;
  const margin = 45;
  const project = ([e, n]) => [e - b.west + margin, b.north - n + margin];
  const coords = points => points.map(p => project(p).map(n => n.toFixed(2)).join(',')).join(' ');
  const full = hasBounds ? [0, 0, b.east - b.west + margin * 2, b.north - b.south + margin * 2] : null;
  const colors = { green: '#79c797', tee: '#bcddaf', fairway: '#477953', bunker: '#dccb9d', driving_range: '#345943', golf_course: 'none' };
  const surfaces = hasBounds ? features.filter(f => ['Polygon', 'MultiPolygon'].includes(f.geometry.type) && colors[f.kind]).map(f => {
    const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    const d = polygons.flatMap(rings => rings.map(ring => `M${coords(ring).replaceAll(' ', ' L')} Z`)).join(' ');
    return `<path d="${d}" fill="${colors[f.kind]}"${f.kind === 'golf_course' ? ' stroke="#769485" stroke-width="2" stroke-dasharray="8 6"' : ''} fill-rule="evenodd"/>`;
  }).join('') : '';
  const routes = hasBounds ? mappedHoles.map(h => {
    const [x, y] = project(h.route[0]);
    return `<g class="intake-route" data-hole="${h.n}" role="button" tabindex="0" aria-label="Visa hål ${h.n}"><polyline class="route-hit" points="${coords(h.route)}"/><polyline class="route-line" points="${coords(h.route)}"/><circle cx="${x}" cy="${y}" r="14"/><text x="${x}" y="${y + 4}">${h.n}</text></g>`;
  }).join('') : '';
  root.innerHTML = `
    <header class="intake-header"><a class="intake-back" href="${base}">← Alla golfbanor</a><a class="intake-brand" href="${base}">Ban<i>v</i>y</a></header>
    <div class="intake-heading"><div><span class="intake-eyebrow">${esc(meta.tag ?? data.name)}</span><h1>${esc(data.name)}</h1><p>${card.holes.length} hål · Par ${card.par} · ${card.teeNames.length} tees</p></div><span class="intake-status">Under kartläggning</span></div>
    <p class="intake-intro">${['lidingo', 'visby'].includes(meta.slug)
      ? `Här finns det ursprungliga källunderlaget. <a href="${base}?bana=${esc(meta.slug)}">Öppna den preliminära 3D-banan</a>. Kartans ytor och hålrutter är preliminära.`
      : 'Upptäck klubbens scorekort och en första bankarta. 3D-banan är under arbete; kartans ytor och hålrutter är preliminära.'}</p>
    <div class="intake-layout">
      <section class="intake-map-panel" aria-label="Preliminär bankarta">
        ${hasBounds ? `<div class="intake-map-tools"><button id="intakeOverview" type="button">Visa hela banan</button><label><input id="intakeSurfaces" type="checkbox" checked> Kartlagda ytor</label><span>N ↑</span></div>
        <svg id="intakeMap" viewBox="${full.join(' ')}" aria-label="Preliminär bankarta med ${mappedHoles.length} hålrutter"><g id="intakeSurfaceLayer">${surfaces}</g>${routes}</svg>` : '<p class="intake-map-unavailable">Bankartan är ännu inte tillgänglig. Utforska klubbens scorekort nedan.</p>'}
        ${mappedHoles.length < card.holes.length ? '<p class="intake-attribution">Hålrutter saknas för delar av banan. Du kan fortfarande välja varje hål och se dess scorekort.</p>' : ''}
        <div class="intake-map-key"><span><i style="background:#79c797"></i>Green</span><span><i style="background:#477953"></i>Fairway</span><span><i style="background:#bcddaf"></i>Tee</span><span><i style="background:#dccb9d"></i>Bunker</span></div>
        <p class="intake-attribution">Preliminära rutter och ytor: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>. Saknade ytor visas inte.</p>
      </section>
      <aside class="intake-sidebar"><section class="intake-hole-panel"><span class="intake-eyebrow">Välj hål</span><div class="intake-hole-buttons">${card.holes.map(h => `<button type="button" data-hole="${h.n}" aria-pressed="false">${h.n}</button>`).join('')}</div><div id="intakeHole" aria-live="polite"></div></section>
      <section class="intake-progress"><h2>Arbetet med banan</h2><p>${routingProgress} Kartunderlaget innehåller ${counts.green} greener, ${counts.tee} tee-ytor, ${counts.fairway} fairways och ${counts.bunker} bunkrar.</p><p>${esc(data.progressNote ?? 'Ytorna behöver kompletteras och granskas mot aktuellt underlag från klubben.')}</p></section>
      <section class="intake-resources"><h2>Utforska hos klubben</h2>${(data.resources ?? []).map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)} <span aria-hidden="true">↗</span></a>`).join('')}</section></aside>
    </div>
    <section class="intake-card"><h2>Klubbens scorekort</h2><p>Hållängder i meter enligt klubbens publicerade scorekort. Välj ett hål för att visa dess uppgifter och tillgängliga rutt.</p><div class="intake-table-scroll"><table><caption>${esc(data.name)} · ${card.holes.length} hål · meter</caption><thead><tr><th scope="col">Hål</th><th scope="col">Par</th><th scope="col">Index</th>${card.teeNames.map(n => `<th scope="col">${esc(n)}</th>`).join('')}</tr></thead><tbody>${card.holes.map(h => `<tr data-card-hole="${h.n}"><th scope="row"><button type="button" data-hole="${h.n}">${h.n}</button></th><td>${h.par}</td><td>${h.hcp ?? '—'}</td>${h.t.map(n => `<td>${n ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Totalt</th><td>${card.par}</td><td>—</td>${card.teeTotals.map(n => `<td>${n ?? '—'}</td>`).join('')}</tr></tfoot></table></div>${cardAttribution}</section>`;
  const svg = root.querySelector('#intakeMap');
  function selectHole(n, zoom = true) {
    const h = card.holes.find(h => h.n === n);
    if (!h) return;
    root.querySelectorAll('[data-hole]').forEach(el => {
      el.classList.toggle('selected', Number(el.dataset.hole) === n);
      if (el.tagName.toLowerCase() === 'button') el.setAttribute('aria-pressed', String(Number(el.dataset.hole) === n));
    });
    root.querySelectorAll('[data-card-hole]').forEach(el => el.classList.toggle('selected', Number(el.dataset.cardHole) === n));
    const routeAvailable = Boolean(svg) && hasRoute(h);
    root.querySelector('#intakeHole').innerHTML = `<h2>Hål ${n} <span>Par ${h.par} · Index ${h.hcp ?? '—'}</span></h2><dl class="intake-tee-lengths">${card.teeNames.map((name, i) => `<div><dt>${esc(name)}</dt><dd>${h.t[i] ?? '—'} <small>m</small></dd></div>`).join('')}</dl><p>${routeAvailable ? 'Rutten visar hålets riktning. Tee-markeringarnas och flaggans exakta lägen är ännu inte fastställda.' : 'En geografisk rutt för det här hålet är ännu inte tillgänglig. Längderna kommer från klubbens scorekort.'}</p>`;
    if (zoom && routeAvailable) {
      const points = h.route.map(project), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const minX = Math.min(...xs) - 75, minY = Math.min(...ys) - 75;
      svg.setAttribute('viewBox', [minX, minY, Math.max(...xs) - minX + 75, Math.max(...ys) - minY + 75].join(' '));
    } else if (zoom && svg) {
      svg.setAttribute('viewBox', full.join(' '));
    }
    const url = new URL(location.href); url.searchParams.set('hal', String(n)); history.replaceState(null, '', url);
  }
  root.querySelectorAll('[data-hole]').forEach(el => {
    el.addEventListener('click', () => selectHole(Number(el.dataset.hole)));
    if (el.tagName.toLowerCase() === 'g') el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectHole(Number(el.dataset.hole)); }
    });
  });
  if (svg) {
    root.querySelector('#intakeOverview').onclick = () => svg.setAttribute('viewBox', full.join(' '));
    root.querySelector('#intakeSurfaces').onchange = e => root.querySelector('#intakeSurfaceLayer').setAttribute('visibility', e.target.checked ? 'visible' : 'hidden');
  }
  const initial = Number(new URLSearchParams(location.search).get('hal'));
  selectHole(card.holes.some(h => h.n === initial) ? initial : 1, false);
}
