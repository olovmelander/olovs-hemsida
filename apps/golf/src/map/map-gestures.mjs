/* One finger moves the map, two zoom, turn and lean it; a tap measures. */
const TAP_SLOP = 10, TAP_MILLISECONDS = 320, DOUBLE_TAP_MILLISECONDS = 280;

const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const span = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function attachGestures(element, handlers) {
  const pointers = new Map();
  let start = null, moved = false, lastTap = 0, pair = null, tapTimer = 0;
  const localPoint = event => {
    const box = element.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  function down(event) {
    element.setPointerCapture(event.pointerId);
    const point = localPoint(event);
    pointers.set(event.pointerId, { ...point, button: event.button });
    handlers.onTouched?.();
    if (pointers.size === 1) {
      start = { ...point, time: performance.now() };
      moved = false;
      handlers.onPress?.(point);
    } else {
      moved = true;
      pair = null;
    }
  }

  function move(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const point = localPoint(event);
    if (pointers.size === 1) {
      if (start && Math.hypot(point.x - start.x, point.y - start.y) > TAP_SLOP) moved = true;
      if (moved) {
        if (pointer.button === 2) handlers.onTurn?.((point.x - pointer.x) * 0.005, (point.y - pointer.y) * 0.004);
        else handlers.onPan?.(pointer, point);
      }
      pointer.x = point.x; pointer.y = point.y;
      return;
    }
    pointer.x = point.x; pointer.y = point.y;
    const [a, b] = [...pointers.values()];
    const now = { centre: middle(a, b), span: span(a, b), angle: angle(a, b) };
    if (pair) {
      const zoom = pair.span / Math.max(now.span, 1);
      let turn = now.angle - pair.angle;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      const lift = now.centre.y - pair.centre.y;
      /* Both fingers moving up or down together is a lean, not a pinch. */
      const leaning = Math.abs(lift) > 1.2 && Math.abs(zoom - 1) < 0.02 && Math.abs(turn) < 0.02;
      handlers.onTwoFingers?.({ centre: now.centre, from: pair.centre, zoom, turn, lean: leaning ? lift * 0.005 : 0 });
    }
    pair = now;
  }

  function up(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    pair = null;
    if (pointers.size || !start) return;
    const point = localPoint(event);
    const time = performance.now();
    if (!moved && time - start.time < TAP_MILLISECONDS) {
      if (time - lastTap < DOUBLE_TAP_MILLISECONDS) {
        clearTimeout(tapTimer);
        lastTap = 0;
        handlers.onDoubleTap?.(point);
      } else {
        lastTap = time;
        /* A tap has to wait out a possible second tap, or every zoom-in would
           also move the measuring point. */
        tapTimer = setTimeout(() => handlers.onTap?.(point), DOUBLE_TAP_MILLISECONDS);
      }
    }
    start = null;
  }

  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', up);
  element.addEventListener('contextmenu', event => event.preventDefault());
  element.addEventListener('wheel', event => {
    event.preventDefault();
    handlers.onTouched?.();
    const point = localPoint(event);
    handlers.onTwoFingers?.({ centre: point, from: point, zoom: Math.exp(event.deltaY * 0.0012), turn: 0, lean: 0 });
  }, { passive: false });
}
