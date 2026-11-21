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

/* What fits a thumb-sized row. */
const shortName = name => name.replace(/^Lobwedge$/, 'Lob');

export function createClubWheel(element, { onChoose, onLock, onSlip = () => {} }) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const list = element.querySelector('[data-wheel-list]');
  let clubs = [], rows = [], centre = -1, settleTimer = 0, painting = false, touched = false;
  let hold = null, lastScroll = 0, releaseTimer = 0;
  /* The club the wheel was last sent to. A smooth turn takes a moment to start, and a
     second rest in that moment must be measured against where the wheel is going, not
     where it still stands: arriving on the next tee turned it toward a wedge for the
     green just played, the new hole then asked for the driver, found the wheel still on
     the driver, did nothing, and the turn landed on the wedge. */
  let heading = -1, snapTop = null;

  const count = () => clubs.length;
  const indexOf = id => clubs.findIndex(club => club.id === id);
  const centreRow = () => Math.max(0, Math.min(rows.length - 1, Math.round(list.scrollTop / ROW_PIXELS)));
  const clubAt = row => clubs[row % count()];
  const selectedIndex = () => heading !== -1 && !touched ? heading : centreRow() % count();
  const current = () => clubs[selectedIndex()] ?? null;

  function markSelection() {
    if (!count()) return;
    /* Only the middle copy is exposed to assistive technology. A programmatic
       turn selects its destination even while the other rows pass the band. */
    const now = count() + selectedIndex();
    if (now === centre) return;
    rows[centre]?.setAttribute('aria-selected', 'false');
    rows[now].setAttribute('aria-selected', 'true');
    list.setAttribute('aria-activedescendant', rows[now].id);
    centre = now;
    if (touched) navigator.vibrate?.(5);
  }

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
    markSelection();
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
    /* Mobile browsers can deliver the tail of a native fling after scrollTo.
       Keep an explicit target in its band until the next user gesture. */
    if (snapTop != null) {
      if (list.scrollTop !== snapTop) list.scrollTo({ top: snapTop, behavior: 'instant' });
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (hold) return;
      recentre();
      if (!touched) {
        /* A turn the wheel made by itself, cut short: a frame over SETTLE_MS (a slow
           phone, or the camera's flight to a new hole) lands here mid-turn, and
           recentre() has just stopped it where it stood. It finishes the trip. */
        if (heading !== -1 && count() && centreRow() % count() !== heading) show(heading, false);
        return;
      }
      touched = false;
      heading = -1;
      onChoose(clubAt(centreRow()));
    }, SETTLE_MS);
  }, { passive: true });

  /* The shortest way round to a club. */
  function show(index, smooth = true) {
    if (index < 0 || !count()) return;
    clearTimeout(settleTimer);
    clearTimeout(releaseTimer);
    touched = false;
    const from = centreRow();
    const middle = index + count();
    const animate = smooth && !reducedMotion;
    const target = animate
      ? [index, middle, middle + count()].reduce((best, row) => Math.abs(row - from) < Math.abs(best - from) ? row : best)
      : middle;
    heading = index;
    snapTop = animate ? null : target * ROW_PIXELS;
    list.scrollTo({ top: target * ROW_PIXELS, behavior: animate ? 'smooth' : 'instant' });
    markSelection();
    paintSoon();
  }

  const stopHold = () => {
    if (!hold) return;
    const pending = hold.pending;
    clearTimeout(hold.timer);
    rows[hold.row]?.classList.remove('is-held');
    hold = null;
    element.classList.remove('is-holding');
    if (pending != null) show(indexOf(pending), false);
    return pending;
  };
  /* A finger that left without moving the wheel leaves it free to rest again. */
  const letGo = () => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      if (performance.now() - lastScroll > SETTLE_MS) touched = false;
    }, SETTLE_MS * 2);
  };
  const beginTurn = () => {
    clearTimeout(releaseTimer);
    touched = true;
    heading = -1;
    snapTop = null;
  };

  list.addEventListener('pointerdown', event => {
    if (hold) return;
    const target = event.target.closest('[data-club]');
    beginTurn();
    if (!target) { letGo(); return; }
    const row = rows.indexOf(target);
    const club = clubAt(row);
    hold = {
      row, club, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      timer: setTimeout(() => {
        const superseded = stopHold() != null;
        if (!superseded) show(indexOf(club.id), false);
        navigator.vibrate?.([14, 40, 26]);
        onLock(club, { superseded });
      }, HOLD_MS),
    };
    /* Nothing moves under a finger that is holding: the club it is on fills where it
       stands, and comes to the centre once it is chosen. */
    element.classList.add('is-holding');
    target.classList.add('is-held');
  });
  list.addEventListener('pointermove', event => {
    if (hold && hold.pointer === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > MOVE_SLOP_PIXELS) {
      onSlip('moved');
      stopHold();
      letGo();
    }
  });
  /* Let go before the lock: however long it was, that is a choice and no more. */
  list.addEventListener('pointerup', event => {
    if (!hold) { letGo(); return; }
    if (event.pointerId !== hold.pointer) return;
    const club = hold.club;
    onSlip('released');
    if (stopHold() != null) return;
    show(indexOf(club.id));
    onChoose(club);
  });
  /* The browser has taken the touch for a scroll, which is a spin and not a hold. */
  list.addEventListener('pointercancel', event => {
    if (hold && event.pointerId !== hold.pointer) return;
    stopHold();
    letGo();
  });
  list.addEventListener('contextmenu', event => event.preventDefault());
  list.addEventListener('wheel', beginTurn, { passive: true });

  list.addEventListener('keydown', event => {
    if (!count() || hold) return;
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step) {
      event.preventDefault();
      const next = (selectedIndex() + step + count()) % count();
      show(next);
      onChoose(clubs[next]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onLock(current());
    }
  });

  return {
    /* Clubs with their lengths, in the bag's order. Keeps the place by club. */
    setClubs(next) {
      const held = current()?.id;
      clubs = next;
      const copies = Array.from({ length: COPIES }, () => clubs).flat();
      list.replaceChildren(...copies.map((club, k) => {
        const row = document.createElement('div');
        row.className = 'map-wheel-row';
        row.dataset.club = club.id;
        row.id = `map-wheel-${k}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        /* The bag once to a screen reader: the copies are only for the turning. */
        if (k < clubs.length || k >= clubs.length * 2) row.setAttribute('aria-hidden', 'true');
        const name = document.createElement('b'), length = document.createElement('small');
        name.textContent = shortName(club.name);
        length.textContent = club.carry ? `${club.carry} m` : '';
        row.append(name, length);
        return row;
      }));
      rows = [...list.children];
      centre = -1;
      heading = count() ? Math.max(0, indexOf(held)) : -1;
      snapTop = null;
      list.scrollTop = (Math.max(0, heading) + count()) * ROW_PIXELS;
      paintSoon();
    },
    /* A new target takes ownership of the wheel even during the previous flick.
       While a club is held, keep the finger's club in place until release. */
    rest(id, { reclaim = false } = {}) {
      const index = indexOf(id);
      if (index < 0) return;
      if (hold) {
        if (reclaim || hold.pending != null) hold.pending = id;
      } else if (reclaim) show(index, false);
      else if (!touched && selectedIndex() !== index) show(index);
    },
    current,
    /* The dot stays on the suggestion, wherever the wheel is turned to. */
    suggest(id) {
      for (const row of rows) row.classList.toggle('is-suggested', row.dataset.club === id);
    },
    setLocked(locked) { element.classList.toggle('is-locked', locked); },
    refresh: paintSoon,
  };
}
