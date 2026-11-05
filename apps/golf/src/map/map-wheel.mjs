/* The club wheel: the map's one control that is always under the thumb.

   It is the browser's own scrolling with snap points, so a flick has a phone's real
   momentum and costs the map no frames. The bag is laid out three times over and the
   wheel is brought back to the middle copy whenever it settles, so it turns for ever,
   with the putter next to the driver. Everything a player does with it is one of three
   things: spin it, tap a club, or hold a club to lock the shot there. It rests on the
   suggested club by itself until a finger chooses otherwise, and a dot stays on the
   suggestion so the choice is never lost. See docs/club-wheel.md. */
export const HOLD_MS = 900;
const ROW_PIXELS = 50, MOVE_SLOP_PIXELS = 8, SETTLE_MS = 110, COPIES = 3, PAINT_REACH = 5;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* What fits a thumb-sized row. */
const shortName = name => name.replace(/^Lobwedge$/, 'Lob');

export function createClubWheel(element, { onChoose, onLock }) {
  const list = element.querySelector('[data-wheel-list]');
  let clubs = [], rows = [], centre = -1, settleTimer = 0, painting = false, touched = false;
  let hold = null, lastScroll = 0;

  const count = () => clubs.length;
  const indexOf = id => clubs.findIndex(club => club.id === id);
  const centreRow = () => Math.max(0, Math.min(rows.length - 1, Math.round(list.scrollTop / ROW_PIXELS)));
  const clubAt = row => clubs[row % count()];

  function paint() {
    painting = false;
    const top = list.scrollTop / ROW_PIXELS;
    const first = Math.max(0, Math.floor(top) - PAINT_REACH), last = Math.min(rows.length - 1, Math.ceil(top) + PAINT_REACH);
    for (let k = first; k <= last; k++) {
      const row = rows[k], offset = k - top, away = Math.abs(offset);
      row.style.opacity = String(Math.max(0.3, 1 - away * 0.2));
      row.style.transform = reducedMotion
        ? `scale(${(1 - Math.min(away, 2) * 0.05).toFixed(3)})`
        : `perspective(190px) rotateX(${(-offset * 16).toFixed(1)}deg) scale(${(1 - Math.min(away, 2) * 0.05).toFixed(3)})`;
    }
    const now = centreRow();
    if (now === centre) return;
    rows[centre]?.setAttribute('aria-selected', 'false');
    rows[now]?.setAttribute('aria-selected', 'true');
    centre = now;
    /* A click of the wheel under the thumb, where the phone can. */
    if (touched) navigator.vibrate?.(5);
  }
  const paintSoon = () => {
    if (painting) return;
    painting = true;
    requestAnimationFrame(paint);
  };

  /* Back to the middle copy, which looks exactly the same: this is what makes it turn
     for ever. Only ever at rest, or a flick would stop dead. */
  function recentre() {
    const row = centreRow(), middle = (row % count()) + count();
    if (row !== middle) list.scrollTop = middle * ROW_PIXELS;
  }

  /* Only a finger's spin is a choice: the wheel also moves by itself. */
  list.addEventListener('scroll', () => {
    lastScroll = performance.now();
    paintSoon();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (hold) return;
      recentre();
      if (!touched) return;
      touched = false;
      onChoose(clubAt(centreRow()));
    }, SETTLE_MS);
  }, { passive: true });

  /* The shortest way round to a club. */
  function show(index, smooth = true) {
    if (index < 0 || !count()) return;
    const from = centreRow();
    const target = [index, index + count(), index + count() * 2]
      .reduce((best, row) => (Math.abs(row - from) < Math.abs(best - from) ? row : best));
    list.scrollTo({ top: target * ROW_PIXELS, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
    paintSoon();
  }

  const stopHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    rows[hold.row]?.classList.remove('is-held');
    hold = null;
    element.classList.remove('is-holding');
  };
  /* A finger that left without moving the wheel leaves it free to rest again. */
  const letGo = () => setTimeout(() => {
    if (performance.now() - lastScroll > SETTLE_MS) touched = false;
  }, SETTLE_MS * 2);

  list.addEventListener('pointerdown', event => {
    const target = event.target.closest('[data-club]');
    touched = true;
    if (!target) { letGo(); return; }
    const row = rows.indexOf(target);
    stopHold();
    hold = {
      row, x: event.clientX, y: event.clientY,
      timer: setTimeout(() => {
        const club = clubAt(hold.row);
        stopHold();
        touched = false;
        show(indexOf(club.id), false);
        navigator.vibrate?.([14, 40, 26]);
        onLock(club);
      }, HOLD_MS),
    };
    /* Nothing moves under a finger that is holding: the club it is on fills where it
       stands, and comes to the centre once it is chosen. */
    element.classList.add('is-holding');
    target.classList.add('is-held');
  });
  list.addEventListener('pointermove', event => {
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOVE_SLOP_PIXELS) {
      stopHold();
      letGo();
    }
  });
  /* Let go before the lock: however long it was, that is a choice and no more. */
  list.addEventListener('pointerup', () => {
    if (!hold) { letGo(); return; }
    const club = clubAt(hold.row);
    stopHold();
    touched = false;
    show(indexOf(club.id));
    onChoose(club);
  });
  /* The browser has taken the touch for a scroll, which is a spin and not a hold. */
  list.addEventListener('pointercancel', () => {
    stopHold();
    letGo();
  });
  list.addEventListener('contextmenu', event => event.preventDefault());
  list.addEventListener('wheel', () => { touched = true; }, { passive: true });

  list.addEventListener('keydown', event => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step) {
      event.preventDefault();
      const next = (centreRow() + step + count()) % count();
      show(next);
      onChoose(clubs[next]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onLock(clubAt(centreRow()));
    }
  });

  return {
    /* Clubs with their lengths, in the bag's order. Keeps the place by club. */
    setClubs(next) {
      const held = count() ? clubAt(centreRow())?.id : null;
      clubs = next;
      const copies = Array.from({ length: COPIES }, () => clubs).flat();
      list.replaceChildren(...copies.map(club => {
        const row = document.createElement('div');
        row.className = 'map-wheel-row';
        row.dataset.club = club.id;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        const name = document.createElement('b'), length = document.createElement('small');
        name.textContent = shortName(club.name);
        length.textContent = club.carry ? `${club.carry} m` : '';
        row.append(name, length);
        return row;
      }));
      rows = [...list.children];
      centre = -1;
      list.scrollTop = (Math.max(0, indexOf(held)) + count()) * ROW_PIXELS;
      paintSoon();
    },
    /* Where the wheel rests when no finger has said otherwise. */
    rest(id) {
      const index = indexOf(id);
      if (!hold && !touched && index !== centreRow() % count()) show(index);
    },
    current: () => (count() ? clubAt(centreRow()) : null),
    /* The dot stays on the suggestion, wherever the wheel is turned to. */
    suggest(id) {
      for (const row of rows) row.classList.toggle('is-suggested', row.dataset.club === id);
    },
    setLocked(locked) { element.classList.toggle('is-locked', locked); },
    refresh: paintSoon,
  };
}
