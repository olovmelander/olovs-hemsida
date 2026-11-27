import { getCloudState, subscribeCloud } from './cloud.mjs';
import { discardLocalRound, dismissLive, offerLive, reconcileLocalRounds, recordingDevice, remoteRounds, takeLive } from './live-rounds.mjs';
import { MORE_ICON, bindRoundActions, openRoundSheet, removalPending, removeWithUndo, roundsChanged } from './round-actions.mjs';
import { mapUrl } from './router.js';

const node = (tag, text) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  return el;
};
function timeText(at) {
  const when = new Date(at);
  const clock = when.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return when.toDateString() === new Date().toDateString() ? clock : when.toLocaleDateString('sv-SE') + ' ' + clock;
}

export function showLiveRounds(panel, courses) {
  const status = node('p');
  status.setAttribute('role', 'status');
  const cards = node('div');
  panel.append(cards, status);
  let generation = 0, identity, busy = false, signature = null, stale = false, visited = false;
  function revealTransfer() {
    if (location.hash !== '#overlamna' || visited || panel.hidden) return;
    visited = true;
    const target = cards.querySelector('summary') || status;
    if (target === status) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest' });
  }
  async function refresh(force = false) {
    const user = getCloudState().user?.id;
    if (identity !== user) {
      identity = user; generation++; signature = null; cards.replaceChildren(); status.textContent = ''; panel.hidden = true;
    }
    if (!user || busy || document.hidden || panel.parentElement?.closest('[hidden]')) return;
    const request = ++generation;
    try {
      const rows = await remoteRounds();
      if (generation !== request || user !== getCloudState().user?.id || busy) return;
      reconcileLocalRounds(rows);
      if (stale) { stale = false; signature = null; status.textContent = ''; }
      // A round on its way out (its undo showing) changes what is drawn, not what the server holds.
      const next = rows.map(r => [r.course,r.id,r.revision].join('/') + (removalPending(r.course + '/' + r.id) ? '!' : '')).join('|');
      if (!force && next === signature) return;
      signature = next;
      const previous = new Map([...cards.querySelectorAll('details')].map(el => [el.dataset.id, el.open]));
      const focused = cards.contains(document.activeElement) ? document.activeElement : null;
      const focusRow = focused?.closest('details')?.dataset.id;
      const focusTag = focused?.matches('button') ? 'button' : 'summary';
      cards.replaceChildren();
      for (const row of rows) {
        const details = node('details');
        details.dataset.id = row.course + '/' + row.id;
        if (removalPending(details.dataset.id)) continue;
        details.open = previous.get(details.dataset.id) ?? (location.hash === '#overlamna');
        const local = row.device === recordingDevice();
        let localCard;
        try { localCard = JSON.parse(localStorage.getItem('banvy-map-round-v1:' + row.course)); } catch { /* server copy available */ }
        if (local && localCard?.id === row.id && localCard.endedAt) continue;
        const offered = row.status === 'offered';
        const card = row.snapshot.card;
        const name = courses.find(c => c.slug === row.course)?.name ?? row.course;
        const heading = offered ? 'Redo att tas över' : local ? 'Byt enhet' : 'Följ pågående runda';
        const summary = node('summary', heading + ' · ' + name + ' · hål ' + card.playingHole);
        const more = node('button');
        more.type = 'button';
        more.className = 'lr-more';
        more.innerHTML = MORE_ICON;
        more.setAttribute('aria-haspopup', 'dialog');
        more.setAttribute('aria-label', 'Val för rundan på ' + name);
        details.append(summary, more);
        const scores = Object.entries(card.scores).filter(([,s]) => s.picked || Number.isFinite(s.strokes));
        const strokes = scores.reduce((n,[,s]) => n + (s.strokes ?? 0), 0);
        details.append(node('p', scores.length + ' hål förda · ' + strokes + ' slag · Senast synkad ' + timeText(row.updatedAt)));
        if (scores.length) {
          const list = node('ul');
          for (const [hole,s] of scores) list.append(node('li', 'Hål ' + hole + ' · ' + (s.picked ? 'Struket' : s.strokes + ' slag')));
          details.append(list);
        }
        const canOffer = local && !offered && localCard?.id === row.id;
        let primary = null;
        if (canOffer || local || offered) {
          const button = primary = node('button', canOffer ? 'Lämna över rundan' : 'Fortsätt på denna enhet');
          button.type = 'button';
          details.append(node('p', canOffer ? 'Efter överlämningen kan en annan inloggad enhet ta över scorekortet.' :
            'Scorekortet och de loggade slagen följer med.'), button);
          button.onclick = async () => {
            busy = true;
            button.disabled = true;
            status.textContent = 'Synkar rundan…';
            try {
              if (canOffer) {
                await offerLive(row.course, row.id);
                status.textContent = 'Rundan är redo. Öppna Banvy på nästa enhet för att ta över.';
              } else {
                await takeLive(row);
                location.assign(mapUrl(row.course) + '&runda=fortsatt');
              }
            } catch (error) { status.textContent = error.message || 'Försök igen när du har nät.'; }
            finally { busy = false; button.disabled = false; refresh(true); }
          };
        } else details.append(node('p', 'För att byta enhet, välj Lämna över rundan på enheten som för scorekortet.'));
        /* The round's own sheet (round-actions.mjs): its action here, and removing it from the account. */
        const played = scores.length === 1 ? '1 hål förda' : scores.length + ' hål förda';
        const open = () => openRoundSheet({
          title: name,
          detail: heading + ' · hål ' + card.playingHole + ' · ' + played,
          returnFocus: more,
          actions: [
            ...(primary ? [{ label: primary.textContent, run: () => primary.click() }] : []),
            {
              label: 'Ta bort rundan', danger: true,
              note: !local && !offered ? 'Enheten som spelar rundan behåller sitt scorekort' : scores.length ? played + ' tas bort' : 'Inga hål är förda',
              run: () => removeWithUndo({
                key: details.dataset.id,
                message: 'Rundan på ' + name + ' är borttagen',
                hide: roundsChanged,
                restore: roundsChanged,
                commit: async () => {
                  await dismissLive(row);
                  if (local) discardLocalRound(row.course, row.id);
                  roundsChanged();
                },
              }),
            },
          ],
        });
        more.onclick = open;
        bindRoundActions(summary, open);
        cards.append(details);
        if (focusRow === details.dataset.id) (details.querySelector(focusTag) || details.querySelector('summary')).focus({ preventScroll: true });
      }
      const empty = cards.childElementCount === 0;
      panel.hidden = empty && location.hash !== '#overlamna';
      if (empty && !panel.hidden) {
        status.textContent = 'Ingen synkad runda finns att ta över ännu. Öppna rundan på enheten där du spelar.';
      } else if (!empty && previous.size === 0) status.textContent = '';
      revealTransfer();
    } catch {
      if (user === getCloudState().user?.id && !busy && (!panel.hidden || location.hash === '#overlamna')) {
        stale = true;
        panel.hidden = false;
        status.textContent = cards.childElementCount ? 'Visar senast hämtade scorekort. Väntar på nät.' :
          'Anslut till nätet för att byta enhet. Din lokala runda går att spela vidare.';
        revealTransfer();
      }
    }
  }
  subscribeCloud(state => { if (state.ready && state.user?.id !== identity) refresh(true); });
  const refreshNow = () => refresh(true);
  window.addEventListener('online', refreshNow);
  window.addEventListener('banvy-live-changed', refreshNow);
  document.addEventListener('visibilitychange', () => refresh());
  setInterval(() => refresh(), 20000);
  return { refresh };
}
