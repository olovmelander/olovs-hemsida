import { DEFAULT_BAG, MAX_BAG_CLUBS, normalizeBag } from '../engine/caddie.js';
import { clubAssetKey, clubKind, clubIcon, CLUB_KINDS } from '../engine/club-design.mjs';
import './bag-editor.css';

/* Min bag edits one draft in two places: the carry list and the club page
   (3D model, name, type, carry). A desktop shows both; a phone shows the list
   first and opens a club as its own page, so the model loads only when asked
   for. Nothing reaches the caddie until Save, and closing asks before
   discarding changes. */

export const MIN_CARRY = 20, MAX_CARRY = 350;
const MIN_CLUBS = 2;
const WOODS = new Set(['driver', 'fairway', 'hybrid']);
const CHEVRON = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const isPutter = club => clubKind(club) === 'putter';
export const carryOk = club => isPutter(club) || (Number(club.carry) >= MIN_CARRY && Number(club.carry) <= MAX_CARRY);

/** Steps to the next 5 m in the pressed direction: 147 → 150 → 155. */
export function stepCarry(value, direction) {
  const carry = Math.round(Number(value)), base = carry > 0 ? carry : 100;
  const next = direction > 0 ? Math.floor(base / 5) * 5 + 5 : Math.ceil(base / 5) * 5 - 5;
  return Math.min(MAX_CARRY, Math.max(MIN_CARRY, next));
}

/** Carry gaps worth a second look: a duplicated distance or a hole in the bag. */
export function gapNotes(clubs) {
  const notes = new Map();
  const ladder = clubs.filter(club => !isPutter(club) && carryOk(club)).sort((a, b) => b.carry - a.carry);
  for (let i = 1; i < ladder.length; i++) {
    const longer = ladder[i - 1], club = ladder[i], gap = Math.round(longer.carry - club.carry);
    if (gap === 0) notes.set(club.id, `Samma carry som ${longer.name}`);
    else if (gap < 5) notes.set(club.id, `Bara ${gap} m kortare än ${longer.name}`);
    else if (gap > 25) notes.set(club.id, `${gap} m lucka efter ${longer.name}`);
  }
  return notes;
}

export function createBagEditor({ getBag, onSave }) {
  const $ = id => document.getElementById(id);
  const dialog = $('bagDialog'), form = $('bagForm'), shell = dialog.querySelector('.bag-shell');
  const inventory = dialog.querySelector('.bag-inventory'), detail = $('bagDetail'), list = $('bagList');
  const summary = $('bagCount'), add = $('bagAddBtn'), save = $('bagSaveBtn'), error = $('bagError'), live = $('bagLive');
  const undoBar = $('bagUndo'), confirmBox = $('bagConfirm');
  const host = $('clubCanvas'), status = $('clubStatus'), retry = $('clubRetry'), hint = $('clubHint');
  const title = $('clubName'), family = $('clubFamily'), position = $('clubPos');
  const stepper = $('clubStepper'), carryInput = $('clubCarryInput'), putterNote = $('clubPutterNote');
  const nameInput = $('clubNameInput'), kinds = $('clubKind'), remove = $('clubRemove'), spin = $('clubSpin');
  const steps = [...dialog.querySelectorAll('[data-club-step]')];
  const compact = matchMedia('(max-width:720px)'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let clubs = [], baseline = '', selectedId, view = 'list', nameBefore = '', closing = false, keptDraft = null;
  let viewer, viewerPromise, shownAsset = '', loadVersion = 0, loadTimer = 0, mode = 'head';
  let spinning = !reducedMotion.matches, undo = null, undoTimer = 0, pressedOutside = false, escaped = false;
  spin.setAttribute('aria-pressed', String(spinning));
  kinds.querySelector('.club-kind-list').innerHTML = Object.entries(CLUB_KINDS).map(([key, label]) =>
    `<label class="club-kind"><input type="radio" name="clubKind" value="${key}"><span>${clubIcon(key)}${label}</span></label>`).join('');

  const byId = id => clubs.find(club => club.id === id);
  const selected = () => byId(selectedId);
  const rowOf = id => [...list.children].find(row => row.dataset.clubId === id);
  const snapshot = value => JSON.stringify(value.map(club =>
    [club.id, String(club.name).trim(), isPutter(club) ? 0 : Number(club.carry), club.kind || '']));
  const dirty = () => snapshot(clubs) !== baseline;
  const studioVisible = () => dialog.open && (!compact.matches || view === 'club');
  const say = message => { live.textContent = message; };

  function keepInView(row) {
    if (!row) return;
    const box = inventory.getBoundingClientRect(), rect = row.getBoundingClientRect();
    if (rect.top < box.top + 8 || rect.bottom > box.bottom - 8) inventory.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
  }

  function onStatus(state) {
    host.dataset.state = state;
    status.hidden = state === 'ready';
    status.textContent = state === 'error' ? '3D-vyn kunde inte laddas. Dina avstånd går fortfarande att ändra.' : 'Laddar din klubba…';
    retry.hidden = state !== 'error';
  }
  async function showClub(club) {
    const version = ++loadVersion;
    try {
      if (!viewerPromise) {
        onStatus('loading');
        viewerPromise = import('./club-viewer.mjs').then(m => m.createClubViewer(host,onStatus)).catch(error => { viewerPromise = null; throw error; });
      }
      viewer = await viewerPromise;
      if (version !== loadVersion) return;
      viewer.setActive(studioVisible()); viewer.setSpinning(spinning); viewer.setMode(mode);
      await viewer.select(club);
    } catch { if (version === loadVersion) onStatus('error'); }
  }
  /** The model follows the selection only while the studio can be seen. */
  function loadModel({ force = false, delay = 0 } = {}) {
    clearTimeout(loadTimer);
    const club = selected();
    if (!club || !studioVisible()) return;
    const key = clubAssetKey(club);
    if (!force && key === shownAsset) return;
    const run = () => { shownAsset = key; showClub({ ...club }); };
    if (delay) loadTimer = setTimeout(run, delay); else run();
  }

  function showSelected() {
    const club = selected();
    if (!club) return;
    const kind = clubKind(club), putter = kind === 'putter', index = clubs.indexOf(club);
    title.textContent = club.name.trim() || 'Din klubba';
    family.textContent = `${CLUB_KINDS[kind]} · ${WOODS.has(kind) ? 'Grafit & stål' : 'Borstat & polerat stål'}`;
    position.textContent = `${index + 1} / ${clubs.length}`;
    steps[0].disabled = index <= 0; steps[1].disabled = index >= clubs.length - 1;
    stepper.hidden = putter; putterNote.hidden = !putter; carryInput.disabled = putter;
    stepper.classList.toggle('invalid', !carryOk(club));
    carryInput.setAttribute('aria-invalid', String(!carryOk(club)));
    if (document.activeElement !== carryInput) carryInput.value = putter ? '' : club.carry;
    if (document.activeElement !== nameInput) nameInput.value = club.name;
    for (const radio of kinds.querySelectorAll('input')) radio.checked = radio.value === kind;
    remove.disabled = clubs.length <= MIN_CLUBS;
    host.querySelector('canvas')?.setAttribute('aria-label', `${club.name} i 3D. Dra eller använd piltangenterna för att rotera. Plus och minus zoomar.`);
  }
  /** Updates every row in place, so a field being typed in keeps its caret. */
  function refresh() {
    const carries = clubs.filter(club => !isPutter(club) && carryOk(club)).map(club => Number(club.carry));
    const longest = Math.max(1, ...carries), notes = gapNotes(clubs);
    for (const row of list.children) {
      const club = byId(row.dataset.clubId), kind = clubKind(club), putter = kind === 'putter', ok = carryOk(club);
      const input = row.querySelector('.bag-distance'), icon = row.querySelector('.bag-icon'), note = notes.get(club.id) || '';
      const preview = row.querySelector('.bag-preview');
      row.classList.toggle('selected', club.id === selectedId);
      row.classList.toggle('is-putter', putter);
      row.classList.toggle('invalid', !ok);
      row.style.setProperty('--carry', putter ? 0 : Math.min(1, (Number(club.carry) || 0) / longest).toFixed(3));
      const art = clubAssetKey(club);
      if (icon.dataset.art !== art) { icon.dataset.art = art; icon.innerHTML = clubIcon(art); }
      row.querySelector('.bag-name').textContent = club.name;
      row.querySelector('.bag-gap').textContent = note;
      preview.setAttribute('aria-current', String(club.id === selectedId));
      preview.setAttribute('aria-label', `${club.name}${note ? `, ${note.toLowerCase()}` : ''}. Visa i 3D och redigera`);
      input.disabled = putter;
      if (document.activeElement !== input) input.value = putter ? '0' : club.carry;
      input.setAttribute('aria-label', `Carry för ${club.name} i meter`);
      input.setAttribute('aria-invalid', String(!ok));
    }
    summary.innerHTML = `<b>${clubs.length}</b> av ${MAX_BAG_CLUBS} klubbor${carries.length ? ` · ${Math.min(...carries)}–${Math.max(...carries)} m` : ''}`;
    summary.classList.toggle('full', clubs.length >= MAX_BAG_CLUBS);
    add.disabled = clubs.length >= MAX_BAG_CLUBS;
    add.querySelector('span').textContent = add.disabled ? `Bagen är full · max ${MAX_BAG_CLUBS} klubbor` : 'Lägg till klubba';
    const changed = dirty();
    save.textContent = changed ? 'Spara ändringar' : 'Klar';
    save.classList.toggle('dirty', changed);
    if (!error.hidden && clubs.every(carryOk)) error.hidden = true;
    showSelected();
  }
  function renderList() {
    list.innerHTML = clubs.map(club => `<li class="bag-row" data-club-id="${escape(club.id)}">
      <button class="bag-preview" type="button"><span class="bag-icon"></span><span class="bag-label"><span class="bag-name"></span><span class="bag-meter" aria-hidden="true"><i></i></span><span class="bag-gap"></span></span></button>
      <span class="bag-carry"><input class="bag-distance" type="number" inputmode="numeric" enterkeyhint="next" min="${MIN_CARRY}" max="${MAX_CARRY}" step="1"><span class="bag-unit" aria-hidden="true">m</span><span class="bag-green">På green</span></span>
      <span class="bag-chevron" aria-hidden="true">${CHEVRON}</span></li>`).join('');
    refresh();
  }
  function select(id, { delay = 0 } = {}) {
    if (!byId(id)) return;
    selectedId = id; refresh(); loadModel({ delay });
  }

  function applyView() {
    const phone = compact.matches;
    if (!phone) view = 'list';
    dialog.dataset.view = view;
    inventory.inert = phone && view === 'club';
    detail.inert = phone && view !== 'club';
    viewer?.setActive(studioVisible());
  }
  function setView(next, { focus = true } = {}) {
    view = next; applyView();
    if (next === 'club') {
      detail.scrollTop = 0; loadModel();
      if (focus) $('clubBack').focus({ preventScroll: true });
    } else {
      const row = rowOf(selectedId);
      keepInView(row);
      if (focus) row?.querySelector('.bag-preview').focus({ preventScroll: true });
    }
  }

  function load(value) {
    clubs = normalizeBag(value).map(club => ({ ...club }));
    if (!byId(selectedId)) selectedId = clubs.find(club => clubKind(club) === 'iron')?.id || clubs[0].id;
  }
  function open() {
    if (dialog.open) return;
    baseline = snapshot(normalizeBag(getBag()));
    // A draft left by a close we could not intercept (a repeated back gesture) is kept.
    if (keptDraft) { ({ clubs, selectedId } = keptDraft); keptDraft = null; }
    else load(getBag());
    view = 'list'; error.hidden = true; confirmBox.hidden = true; shell.inert = false; hideUndo();
    renderList();
    dialog.showModal(); applyView(); loadModel();
    if (compact.matches) { inventory.scrollTop = 0; $('bagTitle').focus({ preventScroll: true }); }
    else { const row = rowOf(selectedId); keepInView(row); row?.querySelector('.bag-preview').focus({ preventScroll: true }); }
    if (dirty()) say('Dina osparade ändringar finns kvar.');
  }
  function close() { closing = true; dialog.close(); }
  function commit() {
    if (document.activeElement === nameInput) nameInput.blur();
    const invalid = clubs.find(club => !carryOk(club));
    if (invalid) {
      error.textContent = `Ange carry för ${invalid.name} mellan ${MIN_CARRY} och ${MAX_CARRY} m.`; error.hidden = false;
      const onPage = invalid.id === selectedId && compact.matches && view === 'club';
      if (!onPage) { selectedId = invalid.id; refresh(); if (view === 'club') setView('list', { focus: false }); }
      const input = onPage ? carryInput : rowOf(invalid.id).querySelector('.bag-distance');
      if (!onPage) keepInView(input.closest('.bag-row'));
      input.focus({ preventScroll: !onPage }); input.select();
      return;
    }
    if (!clubs.some(club => !isPutter(club))) { error.textContent = 'Bagen behöver minst en klubba med carry.'; error.hidden = false; return; }
    if (dirty()) onSave(normalizeBag(clubs).sort((a,b) => b.carry-a.carry));
    close();
  }
  function requestClose() {
    if (!dirty()) return close();
    confirmBox.hidden = false; shell.inert = true; $('bagConfirmSaveBtn').focus();
  }
  function keepEditing() { confirmBox.hidden = true; shell.inert = false; $('bagCloseBtn').focus({ preventScroll: true }); }
  function goBack() {
    if (!confirmBox.hidden) keepEditing();
    else if (compact.matches && view === 'club') setView('list');
    else requestClose();
  }

  function offerUndo(message, restore) {
    clearTimeout(undoTimer); undo = restore;
    undoBar.querySelector('span').textContent = message; undoBar.hidden = false; say(message);
    undoTimer = setTimeout(hideUndo, 8000);
  }
  function hideUndo() { clearTimeout(undoTimer); undo = null; undoBar.hidden = true; }

  $('bagBtn').onclick = open;
  $('bagCloseBtn').onclick = requestClose;
  $('clubBack').onclick = () => setView('list');
  $('bagDiscardBtn').onclick = () => { keptDraft = null; close(); };
  $('bagConfirmSaveBtn').onclick = () => { confirmBox.hidden = true; shell.inert = false; commit(); };
  confirmBox.addEventListener('click', event => { if (event.target === confirmBox) keepEditing(); });
  $('bagUndoBtn').onclick = () => { const restore = undo; hideUndo(); restore?.(); say('Ångrat.'); };
  form.addEventListener('submit', event => { event.preventDefault(); commit(); });

  list.addEventListener('click', event => {
    const row = event.target.closest('.bag-row'), carry = event.target.closest('.bag-carry');
    if (!row) return;
    // Around the carry field (its unit) edits the carry; a putter row opens anywhere.
    if (carry && !row.classList.contains('is-putter')) {
      if (!event.target.matches('.bag-distance')) carry.querySelector('.bag-distance').focus();
      return;
    }
    select(row.dataset.clubId);
    if (compact.matches) setView('club');
  });
  // Tabbing down the carries shows each club, without fetching every model on the way.
  list.addEventListener('focusin', event => {
    const row = event.target.closest('.bag-row');
    if (row && row.dataset.clubId !== selectedId) select(row.dataset.clubId, { delay: 250 });
  });
  list.addEventListener('input', event => {
    const input = event.target.closest('.bag-distance');
    if (!input) return;
    byId(input.closest('.bag-row').dataset.clubId).carry = input.value; refresh();
  });
  carryInput.addEventListener('input', () => { selected().carry = carryInput.value; refresh(); });
  stepper.addEventListener('click', event => {
    const button = event.target.closest('[data-carry-step]'), club = selected();
    if (!button || !club) return;
    club.carry = stepCarry(club.carry, Number(button.dataset.carryStep));
    carryInput.value = club.carry; refresh();
  });
  nameInput.addEventListener('focus', () => { nameBefore = selected()?.name || ''; });
  nameInput.addEventListener('input', () => {
    const club = selected(); club.name = nameInput.value;
    if (!isPutter(club) && !Number(club.carry)) club.carry = 100;
    // A rename can change the model (Järn 7 → Järn 5); wait for the typing.
    refresh(); loadModel({ delay: 350 });
  });
  nameInput.addEventListener('blur', () => {
    const club = selected();
    if (!club) return;
    club.name = nameInput.value.trim() || nameBefore.trim() || 'Klubba';
    nameInput.value = club.name; refresh();
  });
  kinds.addEventListener('change', event => {
    const club = selected();
    if (!club) return;
    club.kind = event.target.value;
    if (club.kind === 'putter') club.carry = 0; else if (!Number(club.carry)) club.carry = 100;
    refresh(); loadModel();
  });
  for (const button of steps) button.onclick = () => {
    const next = clubs[clubs.indexOf(selected()) + Number(button.dataset.clubStep)];
    if (!next) return;
    select(next.id);
    if (button.disabled) steps.find(other => other !== button).focus({ preventScroll: true });
  };
  add.onclick = () => {
    if (clubs.length >= MAX_BAG_CLUBS) return;
    const needsPutter = !clubs.some(isPutter);
    const club = { id: `custom-${Date.now().toString(36)}`, name: needsPutter ? 'Putter' : 'Ny klubba', carry: needsPutter ? 0 : 100 };
    // A new club takes its place on the carry ladder rather than the bottom.
    const at = needsPutter ? -1 : clubs.findIndex(other => isPutter(other) || Number(other.carry) < club.carry);
    clubs.splice(at < 0 ? clubs.length : at, 0, club);
    selectedId = club.id; renderList(); say(`${club.name} har lagts till.`);
    if (compact.matches) setView('club', { focus: false });
    else { keepInView(rowOf(club.id)); loadModel(); }
    nameInput.focus({ preventScroll: compact.matches }); nameInput.select();
  };
  remove.onclick = () => {
    if (clubs.length <= MIN_CLUBS) return;
    const index = clubs.indexOf(selected()), [club] = clubs.splice(index, 1);
    selectedId = (clubs[index] || clubs[index - 1]).id; renderList();
    offerUndo(`${club.name} är borttagen`, () => {
      clubs.splice(Math.min(index, clubs.length), 0, club); selectedId = club.id; renderList(); loadModel();
    });
    if (compact.matches) setView('list');
    else { loadModel(); rowOf(selectedId)?.querySelector('.bag-preview').focus(); }
  };
  $('bagResetBtn').onclick = () => {
    const before = clubs.map(club => ({ ...club })), beforeId = selectedId;
    load(DEFAULT_BAG); renderList(); loadModel();
    offerUndo('Standardbagen är återställd', () => { clubs = before; selectedId = beforeId; renderList(); loadModel(); });
  };

  dialog.addEventListener('keydown', event => {
    // The course's shortcuts (arrows, n/p/h/m, Escape) stay behind the editor.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault(); goBack();
      escaped = true; setTimeout(() => { escaped = false; });
      return;
    }
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return;
    // Enter would submit through the first button; in the list it moves to the next carry.
    event.preventDefault();
    if (event.target.classList.contains('bag-distance')) {
      const inputs = [...list.querySelectorAll('.bag-distance:not(:disabled)')], next = inputs[inputs.indexOf(event.target) + 1];
      if (next) { keepInView(next.closest('.bag-row')); next.focus({ preventScroll: true }); next.select(); }
      else event.target.blur();
    } else if (event.target.type !== 'radio') event.target.blur();
  });
  // The Android back gesture arrives as a cancel; Escape was handled above.
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!escaped) goBack(); });
  const outside = event => {
    const r = dialog.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  };
  dialog.addEventListener('pointerdown', event => { pressedOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => {
    if (pressedOutside && event.target === dialog && outside(event)) requestClose();
    pressedOutside = false;
  });
  dialog.addEventListener('close', () => {
    if (!closing && dirty()) keptDraft = { clubs: clubs.map(club => ({ ...club })), selectedId };
    closing = false; clearTimeout(loadTimer); hideUndo(); viewer?.setActive(false);
  });
  compact.addEventListener('change', () => { if (dialog.open) { applyView(); loadModel(); } });

  host.addEventListener('pointerdown', () => hint.classList.add('used'), { once: true });
  retry.onclick = () => loadModel({ force: true });
  spin.onclick = () => { spinning = !spinning; spin.setAttribute('aria-pressed',String(spinning)); viewer?.setSpinning(spinning); };
  reducedMotion.addEventListener('change', event => { if (event.matches) { spinning=false; spin.setAttribute('aria-pressed','false'); viewer?.setSpinning(false); } });
  function setMode(value) {
    mode = value; viewer?.setMode(mode);
    // The whole club reaches the foot of the canvas, where the hint sits.
    host.closest('.club-studio').dataset.mode = mode;
    for (const toggle of dialog.querySelectorAll('[data-club-mode]')) toggle.setAttribute('aria-pressed',String(toggle.dataset.clubMode === mode));
  }
  for (const button of dialog.querySelectorAll('[data-club-mode]')) button.onclick = () => setMode(button.dataset.clubMode);
  for (const button of dialog.querySelectorAll('[data-club-pose]')) button.onclick = () => {
    if (button.dataset.clubPose !== 'hero' && mode !== 'head') setMode('head');
    viewer?.pose(button.dataset.clubPose);
  };
  return { open };
}
