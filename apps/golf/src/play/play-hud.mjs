/* The play mode's screen: the hole and the shot at the top, the club at the
   bottom left, the swing at the bottom right, and nothing else. The detailed
   course's own panels step aside while a game is on (body.pl-on). */

const HIDDEN = ['#courseNav', '#menuToggle', '#card', '#railBackdrop', '#rail', '#leftStack', '#kikGreen', '#kikOut',
  '#note', '#holesContainer', '#mini', '#hint', '#mobileHudBar', '#uiToggle', '#cleanExit', '#tourCard', '#kikTag',
  '#gpsStatus', '#v2TerrainBadge', '#navDrawer'];

const CSS = `
body.pl-on ${HIDDEN.join(',body.pl-on ')},body.pl-on .hole-marker{display:none!important}
body.pl-on canvas{touch-action:none}
.pl-hud{position:fixed;inset:0;z-index:40;pointer-events:none;font-family:Outfit,ui-sans-serif,system-ui,sans-serif;color:var(--ink,#eaf3ec)}
.pl-hud>*{pointer-events:auto}
.pl-glass{background:var(--glass,rgba(9,18,14,.78));backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);border:1px solid var(--edge,rgba(150,220,175,.18));border-radius:16px;box-shadow:0 8px 28px rgba(0,0,0,.28)}
.pl-mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.pl-card{position:absolute;left:max(14px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));display:grid;grid-template-columns:auto 1fr;gap:2px 14px;padding:12px 16px 12px 14px;min-width:220px}
.pl-hole{grid-row:span 2;display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:var(--turf,#5fd07a);color:#0b1a13;font:700 24px/1 'JetBrains Mono',monospace}
.pl-line1{font-weight:600;font-size:15px;align-self:end}
.pl-line2{font-size:13px;color:var(--dim,#9db3a5)}
.pl-line2 b{color:var(--ink,#eaf3ec);font-weight:600}
.pl-shot{position:absolute;left:max(14px,env(safe-area-inset-left));top:calc(max(14px,env(safe-area-inset-top)) + 84px);display:flex;gap:8px;flex-wrap:wrap;max-width:min(420px,calc(100vw - 28px))}
.pl-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;font-size:13px}
.pl-chip b{font-family:'JetBrains Mono',monospace;font-weight:600}
.pl-wind i{display:inline-block;width:16px;height:16px;transform:rotate(var(--deg,0deg));transition:transform .4s}
.pl-wind i::before{content:'';display:block;margin:auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:14px solid var(--water,#4bb4d8)}
.pl-top{position:absolute;right:max(14px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));display:flex;gap:8px}
.pl-btn{min-width:44px;min-height:44px;padding:0 14px;border-radius:12px;font:600 14px Outfit,system-ui,sans-serif;color:inherit;cursor:pointer}
.pl-btn:focus-visible,.pl-pad:focus-visible,.pl-clubs button:focus-visible{outline:2px solid var(--turf,#5fd07a);outline-offset:2px}
.pl-clubs{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));display:flex;align-items:stretch;gap:0;padding:4px}
.pl-clubs button{min-width:44px;min-height:52px;border:0;background:transparent;color:var(--ink,#eaf3ec);font-size:20px;cursor:pointer;border-radius:12px}
.pl-club{display:grid;align-content:center;min-width:120px;padding:0 6px;text-align:center}
.pl-club b{font-size:16px}
.pl-club span{font-size:12px;color:var(--dim,#9db3a5);font-family:'JetBrains Mono',monospace}
.pl-swing{position:absolute;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));display:grid;justify-items:center;gap:8px}
.pl-pad{position:relative;width:86px;height:210px;border-radius:44px;background:var(--glass,rgba(9,18,14,.78));border:1px solid var(--edge,rgba(150,220,175,.18));touch-action:none;cursor:grab;overflow:hidden;backdrop-filter:blur(18px)}
.pl-swing.active .pl-pad{cursor:grabbing;border-color:var(--turf,#5fd07a)}
.pl-pad-fill{position:absolute;left:0;right:0;top:0;height:calc(var(--p,0) * 82%);background:linear-gradient(var(--turf,#5fd07a),#2f9a52);opacity:.85;transition:height .05s}
.pl-swing.over .pl-pad-fill{background:linear-gradient(var(--turf,#5fd07a),var(--amber,#f0a23a))}
.pl-mark{position:absolute;left:14px;right:14px;top:calc(var(--at) * 82%);height:1px;background:rgba(234,243,236,.35)}
.pl-mark.full{height:2px;background:rgba(234,243,236,.8)}
.pl-knob{position:absolute;left:50%;top:calc(6px + var(--p,0) * 82%);width:58px;height:58px;margin-left:-29px;border-radius:50%;background:#f5f8f2;box-shadow:0 3px 10px rgba(0,0,0,.35);transform:translateX(calc(var(--drift,0) * 22px))}
.pl-target{position:absolute;left:6px;right:6px;top:calc(6px + 29px + var(--target,0) * 82% - 1px);height:3px;border-radius:2px;background:var(--amber,#f0a23a);display:none;box-shadow:0 0 6px rgba(240,162,58,.6)}
.pl-swing.has-target .pl-target{display:block}
.pl-meter-target{position:absolute;top:0;bottom:0;left:calc(10% + var(--target,0) * 82%);width:3px;margin-left:-1.5px;background:var(--amber,#f0a23a);display:none}
.pl-swing.has-target .pl-meter-target{display:block}
.pl-line{position:absolute;left:12px;right:12px;top:35px;height:2px;background:var(--amber,#f0a23a);opacity:0}
.pl-swing.active .pl-line{opacity:.9}
.pl-meter,.pl-tap{display:none}
.pl-swing[data-method=tap] .pl-pad{display:none}
.pl-swing[data-method=tap] .pl-meter{display:block;position:relative;width:min(360px,62vw);height:26px;border-radius:13px;background:var(--glass,rgba(9,18,14,.78));border:1px solid var(--edge,rgba(150,220,175,.18));overflow:hidden}
.pl-meter-fill{position:absolute;left:10%;top:0;bottom:0;width:calc(var(--p,0) * 82%);background:linear-gradient(90deg,#2f9a52,var(--turf,#5fd07a))}
.pl-meter-sweet{position:absolute;left:calc(10% - 3px);top:0;bottom:0;width:6px;background:var(--amber,#f0a23a)}
.pl-meter-marker{position:absolute;top:-2px;bottom:-2px;left:calc(10% + var(--m,0) * 82%);width:4px;margin-left:-2px;background:#fff;border-radius:2px}
.pl-swing[data-method=tap] .pl-tap{display:block;min-width:140px;min-height:56px;border-radius:16px;border:0;background:var(--turf,#5fd07a);color:#0b1a13;font:700 18px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-swing.off{opacity:.35;pointer-events:none}
.pl-swing-hint{font-size:12px;color:var(--dim,#9db3a5);text-shadow:0 1px 3px rgba(0,0,0,.6)}
.pl-power{position:absolute;right:calc(max(18px,env(safe-area-inset-right)) + 100px);bottom:calc(max(18px,env(safe-area-inset-bottom)) + 150px);padding:6px 10px;border-radius:10px;font:600 15px 'JetBrains Mono',monospace;opacity:0;transition:opacity .2s}
.pl-power.show{opacity:1}
.pl-banner{position:absolute;left:50%;top:22%;transform:translate(-50%,-8px);padding:12px 22px;border-radius:16px;text-align:center;opacity:0;transition:opacity .35s,transform .35s;pointer-events:none}
.pl-banner.show{opacity:1;transform:translate(-50%,0)}
.pl-banner b{display:block;font-size:24px;font-weight:700}
.pl-banner span{font-size:14px;color:var(--dim,#9db3a5)}
.pl-banner.good b{color:var(--turf,#5fd07a)}
.pl-banner.bad b{color:var(--amber,#f0a23a)}
.pl-fade{position:fixed;inset:0;z-index:41;background:#0b1a13;opacity:0;pointer-events:none;transition:opacity .32s}
.pl-fade.on{opacity:1}
.pl-sheet{position:fixed;inset:0;z-index:42;display:none;place-items:center;background:rgba(5,12,9,.45)}
.pl-sheet.open{display:grid}
.pl-sheet-box{width:min(560px,calc(100vw - 28px));max-height:calc(100vh - 40px);overflow:auto;padding:20px 22px}
.pl-sheet h2{margin:0 0 2px;font-size:28px}
.pl-sheet .pl-sub{color:var(--dim,#9db3a5);margin:0 0 14px}
.pl-table{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:13px;margin:6px 0 14px}
.pl-table th,.pl-table td{padding:6px 4px;text-align:center;border-bottom:1px solid var(--edge,rgba(150,220,175,.18))}
.pl-table th{color:var(--dim,#9db3a5);font-weight:500}
.pl-table td.under{color:var(--turf,#5fd07a)}
.pl-table td.over{color:var(--amber,#f0a23a)}
.pl-actions{display:flex;gap:10px;flex-wrap:wrap}
.pl-actions .pl-btn{flex:1}
.pl-primary{background:var(--turf,#5fd07a);color:#0b1a13;border:0}
.pl-ghost{background:transparent;border:1px solid var(--edge,rgba(150,220,175,.3))}
.pl-menu .pl-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0}
.pl-seg{display:flex;gap:4px;padding:3px;border-radius:12px;background:rgba(0,0,0,.25)}
.pl-seg button{min-height:40px;min-width:64px;border:0;border-radius:9px;background:transparent;color:var(--dim,#9db3a5);font:600 13px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-seg button[aria-pressed=true]{background:var(--turf,#5fd07a);color:#0b1a13}
.pl-help{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);font-size:12px;color:var(--dim,#9db3a5);text-shadow:0 1px 3px rgba(0,0,0,.7);white-space:nowrap}
@media (max-width:640px){
  .pl-card{min-width:0;padding:9px 12px 9px 10px;gap:0 10px}
  .pl-hole{width:40px;height:40px;font-size:20px}
  .pl-shot{top:calc(max(10px,env(safe-area-inset-top)) + 70px)}
  .pl-pad{width:78px;height:180px}
  .pl-club{min-width:96px}
  .pl-help{display:none}
  /* the tap meter and its button stand above the club row */
  .pl-swing[data-method=tap]{left:max(14px,env(safe-area-inset-left));right:max(14px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 74px)}
  .pl-swing[data-method=tap] .pl-meter{width:100%}
  .pl-swing[data-method=tap] .pl-tap{width:100%}
}
@media (prefers-reduced-motion:reduce){.pl-banner,.pl-fade,.pl-wind i{transition:none}}
`;

export function createPlayHud({ onMenu, onClub, onOverview }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('div'); root.className = 'pl-hud';
  root.innerHTML = `
    <div class="pl-card pl-glass" role="group" aria-label="Hålet">
      <span class="pl-hole" data-hole>1</span><span class="pl-line1" data-line1></span><span class="pl-line2" data-line2></span>
    </div>
    <div class="pl-shot" aria-live="polite">
      <span class="pl-chip pl-glass" data-to>Till hål <b>–</b></span>
      <span class="pl-chip pl-glass" data-lie>Tee</span>
      <span class="pl-chip pl-glass pl-wind" data-wind title="Vinden mot slagriktningen"><i></i><b>–</b></span>
    </div>
    <div class="pl-top">
      <button class="pl-btn pl-glass" data-overview type="button" aria-pressed="false" title="Översikt (O)">Översikt</button>
      <button class="pl-btn pl-glass" data-menu type="button" aria-label="Meny">☰</button>
    </div>
    <div class="pl-clubs pl-glass" role="group" aria-label="Klubba">
      <button type="button" data-club="-1" aria-label="Längre klubba">‹</button>
      <div class="pl-club"><b data-club-name>–</b><span data-club-carry></span></div>
      <button type="button" data-club="1" aria-label="Kortare klubba">›</button>
    </div>
    <div class="pl-power pl-glass" data-power></div>
    <div class="pl-banner pl-glass" data-banner role="status"><b></b><span></span></div>
    <div class="pl-help">Sikta: dra i banan eller ← → · Klubba: ↑ ↓ · Översikt: O</div>`;
  document.body.append(root);
  const fade = document.createElement('div'); fade.className = 'pl-fade'; document.body.append(fade);
  const sheet = document.createElement('div'); sheet.className = 'pl-sheet';
  sheet.innerHTML = `<div class="pl-sheet-box pl-glass" role="dialog" aria-modal="true"></div>`;
  document.body.append(sheet);
  const q = s => root.querySelector(s);
  root.querySelector('[data-menu]').onclick = onMenu;
  root.querySelector('[data-overview]').onclick = onOverview;
  for (const b of root.querySelectorAll('[data-club]')) b.onclick = () => onClub(Number(b.dataset.club));
  let bannerTimer = 0;
  return {
    root, sheet,
    hole({ n, par, length, strokes, name }) {
      q('[data-hole]').textContent = n;
      q('[data-line1]').textContent = `Par ${par} · ${length} m`;
      q('[data-line2]').innerHTML = `Slag <b>${strokes + 1}</b>${name ? ` · ${name}` : ''}`;
    },
    shot({ toPin, lie, windMs, windDeg, windLabel }) {
      q('[data-to]').innerHTML = `Till hål <b>${toPin < 10 ? toPin.toFixed(1) : Math.round(toPin)} m</b>`;
      q('[data-lie]').textContent = lie;
      const wind = q('[data-wind]');
      wind.style.setProperty('--deg', `${windDeg}deg`);
      wind.querySelector('b').textContent = windMs > .2 ? `${windMs.toFixed(1)} m/s` : 'Stilla';
      wind.title = windLabel;
    },
    club({ name, carry, putt, range }) {
      q('[data-club-name]').textContent = name;
      q('[data-club-carry]').textContent = putt ? `max ${range} m` : `${Math.round(carry)} m`;
    },
    power(text) { const el = q('[data-power]'); el.textContent = text || ''; el.classList.toggle('show', Boolean(text)); },
    banner(title, sub = '', tone = '', ms = 2600) {
      const el = q('[data-banner]');
      el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub;
      el.className = `pl-banner pl-glass show ${tone}`;
      clearTimeout(bannerTimer);
      if (ms > 0) bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
    },
    hideBanner() { q('[data-banner]').classList.remove('show'); },
    overview(on) { q('[data-overview]').setAttribute('aria-pressed', String(on)); },
    fade(on) { fade.classList.toggle('on', on); },
    openSheet(html) { sheet.querySelector('.pl-sheet-box').innerHTML = html; sheet.classList.add('open'); return sheet.querySelector('.pl-sheet-box'); },
    closeSheet() { sheet.classList.remove('open'); },
    get sheetOpen() { return sheet.classList.contains('open'); },
    dispose() { root.remove(); fade.remove(); sheet.remove(); style.remove(); },
  };
}

/** The card so far: holes in playing order, strokes coloured against par. */
export function scorecardHtml(round, holes) {
  const played = round.order.filter(n => round.holes[n]?.holed || round.holes[n]?.picked);
  if (!played.length) return '<p class="pl-sub">Inga hål spelade ännu.</p>';
  const cells = played.map(n => {
    const card = round.holes[n], par = holes[n - 1].par, diff = card.strokes - par;
    return { n, par, strokes: card.picked ? '–' : card.strokes, cls: card.picked ? '' : diff < 0 ? 'under' : diff > 0 ? 'over' : '' };
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 9) {
    const part = cells.slice(i, i + 9);
    rows.push(`<table class="pl-table"><tr><th>Hål</th>${part.map(c => `<th>${c.n}</th>`).join('')}</tr>
      <tr><th>Par</th>${part.map(c => `<td>${c.par}</td>`).join('')}</tr>
      <tr><th>Slag</th>${part.map(c => `<td class="${c.cls}">${c.strokes}</td>`).join('')}</tr></table>`);
  }
  return rows.join('');
}
