import { sortLayouts } from './club-sort.mjs';
import { layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { ICONS } from './icons.js';
import { MODES, courseSessions, offlineCourses, sessionBadge, sessionPosition } from './settings-store.mjs';

const SIGNATURE_HOLES = {
  'bro-hof-stadium': { poster: 1, description: 'Ö-green på hål 17' },
  'bro-hof-castle': { poster: 2, description: 'Sandmarkerna på hål 4' },
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function createClubPicker({ onSelect, onDismiss }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'clubPicker';
  dialog.setAttribute('aria-labelledby', 'clubPickerTitle');
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); onDismiss(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close]')) onDismiss();
    const row = event.target.closest('[data-layout]');
    if (row) onSelect(row.dataset.layout);
  });

  return {
    isOpen: () => dialog.open,
    close: () => { if (dialog.open) dialog.close(); },
    open(group, mode, focusSlug, sort = {}) {
      let storage = null;
      try { storage = localStorage; } catch { /* private browsing */ }
      const sessions = courseSessions(storage, group.courses).filter(session => session.mode === mode);
      const kept = mode === 'map' ? offlineCourses(storage) : [];
      const city = COURSE_LOCATIONS[group.cover.slug]?.city;
      const layouts = sortLayouts(group.courses, sort.order, sort.recentSlug);
      dialog.innerHTML = `
        <section class="club-picker-panel">
          <header>
            <div><p class="club-place">${esc([city, MODES[mode].label].filter(Boolean).join(' · '))}</p>
              <h2 id="clubPickerTitle">${esc(group.name)}</h2></div>
            <button type="button" class="club-close" data-close aria-label="Tillbaka">${ICONS.close(19)}</button>
          </header>
          <h3>Välj bana</h3>
          <ul>${layouts.map(course => {
            const signature = SIGNATURE_HOLES[course.slug];
            const picture = course.photos ? `courses/${course.slug}/hero-${signature?.poster || 1}.webp` : course.overviewUrl;
            const states = [];
            const session = sessions.find(s => s.course.slug === course.slug);
            if (session) states.push(sessionBadge(session), sessionPosition(session));
            if (kept.includes(course.slug)) states.push('Tidigare nedladdad');
            if (course.status === 'mapping') states.push('Under kartläggning');
            if (course.status === 'provisional') states.push('Preliminär 3D');
            return `<li><button type="button" data-layout="${esc(course.slug)}">
              ${picture ? `<img src="${esc(import.meta.env.BASE_URL + picture)}" alt="" width="84" height="70">` : ''}
              <span class="club-layout-copy"><strong>${esc(layoutLabel(course))}</strong>
                <span>${course.holes} hål · Par ${course.par} · ${course.tees.names.length} tees</span>
                ${signature ? `<span>${signature.description}</span>` : ''}
                ${states.length ? `<small>${esc(states.join(' · '))}</small>` : ''}
              </span>${ICONS.chevronRight(18)}</button></li>`;
          }).join('')}</ul>
        </section>`;
      if (!dialog.open) dialog.showModal();
      const focus = focusSlug && dialog.querySelector(`[data-layout="${CSS.escape(focusSlug)}"]`);
      (focus || dialog.querySelector('[data-layout]'))?.focus({ preventScroll: true });
    },
  };
}
