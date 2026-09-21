import { DEFAULT_BAG, MAX_BAG_CLUBS, normalizeBag } from '../engine/caddie.js';
import { clubKind, clubIcon, CLUB_KINDS } from '../engine/club-design.mjs';
import './bag-editor.css';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function createBagEditor({ getBag, onSave }) {
  const dialog = document.getElementById('bagDialog'), form = document.getElementById('bagForm');
  const list = document.getElementById('bagList'), count = document.getElementById('bagCount'), add = document.getElementById('bagAddBtn');
  const host = document.getElementById('clubCanvas'), status = document.getElementById('clubStatus');
  const title = document.getElementById('clubName'), family = document.getElementById('clubFamily'), carry = document.getElementById('clubCarry');
  const kindSelect = document.getElementById('clubKind'), spin = document.getElementById('clubSpin');
  let selectedId, viewer, viewerPromise, lastAsset = '', loadVersion = 0, mode = 'head';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let spinning = !reducedMotion.matches;
  spin.setAttribute('aria-pressed', String(spinning));
  kindSelect.innerHTML = Object.entries(CLUB_KINDS).map(([key,label]) => `<option value="${key}">${label}</option>`).join('');
  function draft() {
    return [...list.querySelectorAll('.bag-row')].map(row => ({
      id: row.dataset.clubId, name: row.querySelector('.bag-name').value,
      carry: row.querySelector('.bag-distance').value, ...(row.dataset.kind ? {kind:row.dataset.kind} : {}),
    }));
  }
  function onStatus(state) {
    host.dataset.state = state;
    status.hidden = state === 'ready';
    status.textContent = state === 'error' ? '3D-vyn kunde inte laddas. Dina avstånd går fortfarande att ändra.' : 'Laddar din klubba…';
    document.getElementById('clubRetry').hidden = state !== 'error';
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
      viewer.setActive(dialog.open); viewer.setSpinning(spinning); viewer.setMode(mode);
      await viewer.select(club);
    } catch { if (version === loadVersion) onStatus('error'); }
  }
  function select(id, force = false) {
    const clubs = draft(), club = clubs.find(c => c.id === id) || clubs[0];
    if (!club) return;
    selectedId = club.id;
    const kind = clubKind(club);
    for (const row of list.children) {
      const selected = row.dataset.clubId === selectedId;
      row.classList.toggle('selected', selected);
      row.querySelector('.bag-preview').setAttribute('aria-pressed',String(selected));
    }
    title.textContent = club.name || 'Din klubba';
    family.textContent = `${CLUB_KINDS[kind]} · ${kind === 'driver' || kind === 'fairway' || kind === 'hybrid' ? 'Grafit & stål' : 'Borstat & polerat stål'}`;
    carry.textContent = kind === 'putter' ? 'På greenen' : `${club.carry || '—'} m carry`;
    kindSelect.value = kind;
    const key = `${club.id}|${club.name}|${kind}`;
    if (force || key !== lastAsset) { lastAsset = key; showClub(club); }
  }
  function sync() {
    const clubs = draft();
    count.innerHTML = `<b>${clubs.length}</b> / ${MAX_BAG_CLUBS} klubbor`;
    count.classList.toggle('limit',clubs.length >= MAX_BAG_CLUBS);
    add.disabled = clubs.length >= MAX_BAG_CLUBS;
    add.textContent = add.disabled ? 'Bagen är full' : '+ Lägg till';
    for (const row of list.children) {
      const club = clubs.find(c => c.id === row.dataset.clubId), kind = clubKind(club);
      const distance = row.querySelector('.bag-distance');
      if (kind === 'putter') { distance.value = '0'; distance.disabled = true; }
      else { if (distance.disabled) distance.value = '100'; distance.disabled = false; }
      row.classList.toggle('is-putter',kind === 'putter');
      const preview = row.querySelector('.bag-preview');
      preview.innerHTML = clubIcon(kind);
      preview.setAttribute('aria-label',`Visa ${club.name} i 3D`);
      distance.setAttribute('aria-label',`Carry för ${club.name} i meter`);
      row.querySelector('.bag-remove').disabled = clubs.length <= 2;
    }
    select(selectedId);
  }
  function render(value) {
    list.innerHTML = normalizeBag(value).map((club,i) => `<div class="bag-row" data-club-id="${escape(club.id)}" data-kind="${escape(club.kind || '')}">
      <button class="bag-preview" type="button" aria-pressed="false" aria-label="Visa ${escape(club.name)} i 3D">${clubIcon(clubKind(club))}</button>
      <input class="bag-name" value="${escape(club.name)}" maxlength="24" aria-label="Klubba ${i+1}" required>
      <span class="bag-carry"><input class="bag-distance" type="number" inputmode="numeric" min="20" max="350" value="${club.carry}" required><span>m</span></span>
      <button class="bag-remove" type="button" aria-label="Ta bort ${escape(club.name)}" title="Ta bort">×</button>
      </div>`).join('');
    sync();
  }
  function open() {
    if (dialog.open) return;
    selectedId ||= getBag().find(club => clubKind(club) === 'iron')?.id;
    dialog.showModal(); render(getBag()); viewer?.setActive(true);
    list.querySelector('.selected .bag-preview')?.focus({preventScroll:true});
  }
  document.getElementById('bagBtn').onclick = open;
  document.getElementById('bagResetBtn').onclick = () => render(DEFAULT_BAG);
  add.onclick = () => {
    const clubs = draft(); if (clubs.length >= MAX_BAG_CLUBS) return;
    const id = `custom-${Date.now().toString(36)}`;
    const noPutter = !clubs.some(c => clubKind(c) === 'putter');
    clubs.push({id, name:noPutter ? 'Putter' : 'Ny klubba', carry:noPutter ? 0 : 100});
    selectedId = id; render(clubs);
    const input = list.lastElementChild.querySelector('.bag-name'); input.focus(); input.select(); input.scrollIntoView({block:'nearest'});
  };
  list.addEventListener('click', event => {
    const row = event.target.closest('.bag-row'); if (!row) return;
    if (event.target.closest('.bag-remove')) {
      const clubs = draft(); if (clubs.length <= 2) return;
      render(clubs.filter(c => c.id !== row.dataset.clubId));
      list.querySelector('.selected .bag-preview')?.focus({preventScroll:true});
    } else {
      select(row.dataset.clubId);
      if (event.target.closest('.bag-preview') && matchMedia('(max-width:720px)').matches) {
        dialog.querySelector('.bag-workspace').scrollTo({top:0,behavior:reducedMotion.matches ? 'instant' : 'smooth'});
      }
    }
  });
  list.addEventListener('focusin', event => { const row = event.target.closest('.bag-row'); if(row) select(row.dataset.clubId); });
  list.addEventListener('input',sync);
  kindSelect.onchange = () => {
    const row = [...list.children].find(r => r.dataset.clubId === selectedId);
    if (row) { row.dataset.kind = kindSelect.value; sync(); }
  };
  document.getElementById('clubRetry').onclick = () => select(selectedId,true);
  spin.onclick = () => { spinning = !spinning; spin.setAttribute('aria-pressed',String(spinning)); viewer?.setSpinning(spinning); };
  reducedMotion.addEventListener('change', event => { if (event.matches) { spinning=false; spin.setAttribute('aria-pressed','false'); viewer?.setSpinning(false); } });
  for (const button of dialog.querySelectorAll('[data-club-mode]')) button.onclick = () => {
    for (const sibling of dialog.querySelectorAll('[data-club-mode]')) sibling.setAttribute('aria-pressed',String(sibling === button));
    mode = button.dataset.clubMode; viewer?.setMode(mode);
  };
  for (const button of dialog.querySelectorAll('[data-club-pose]')) button.onclick = () => {
    if (button.dataset.clubPose !== 'hero' && mode !== 'head') {
      mode = 'head'; viewer?.setMode(mode);
      for (const toggle of dialog.querySelectorAll('[data-club-mode]')) toggle.setAttribute('aria-pressed',String(toggle.dataset.clubMode === mode));
    }
    viewer?.pose(button.dataset.clubPose);
  };
  form.addEventListener('submit', event => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault(); onSave(normalizeBag(draft()).sort((a,b) => b.carry-a.carry)); dialog.close('save');
  });
  dialog.addEventListener('click',event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close('cancel');
  });
  dialog.addEventListener('close',() => viewer?.setActive(false));
  return { open };
}
