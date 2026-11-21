/* Keep one hole's obstacle data in the planning worker. If GPS or a drag outruns
   a search, only the newest request gets a turn and only its result is shown. */
export function createGuidancePlanner({ loadGeometry, createWorker, onChange }) {
  let active = null;

  function clear() {
    const old = active;
    active = null;
    old?.abort.abort();
    old?.worker?.terminate();
  }

  function send(hole) {
    if (!hole.ready || hole.busy || !hole.request) return;
    hole.busy = true;
    hole.sent = hole.request;
    hole.worker.postMessage({ type: 'plan', id: hole.id, ...hole.request });
  }

  function fail(hole, error) {
    if (hole !== active) return;
    hole.worker?.terminate();
    hole.worker = null;
    hole.ready = false;
    hole.failedAt = Date.now();
    hole.result = null;
    console.warn('Slagplanering:', error.message);
    onChange();
  }

  async function open(hole) {
    try {
      const geometry = await loadGeometry(hole.key, hole.abort.signal);
      if (hole !== active) return;
      const worker = createWorker();
      hole.worker = worker;
      worker.onmessage = ({ data }) => {
        if (hole !== active) return;
        if (data.type === 'ready') {
          hole.ready = true;
          send(hole);
        } else if (data.type === 'result') {
          hole.busy = false;
          if (hole.id !== data.id) {
            // A continuous walk can outpace a slow first search. Keep a complete
            // nearby GPS result visible, at its own origin, while checking the next fix.
            if (canRetain(hole.sent, hole.request) && data.result.shots.length) {
              hole.result = data.result;
              onChange();
            }
            send(hole);
            return;
          }
          hole.result = data.result;
          onChange();
        } else if (data.type === 'error') fail(hole, new Error(data.message));
      };
      worker.onerror = error => fail(hole, error);
      worker.postMessage({ type: 'open', geometry });
    } catch (error) { fail(hole, error); }
  }

  function canRetain(a, b) {
    return a && b && !a.target && !b.target && !a.preview && !b.preview &&
      a.config === b.config && a.tee === b.tee && Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1]) <= 6;
  }

  const samePoint = (a, b) => a === b || (a && b && a[0] === b[0] && a[1] === b[1]);
  return {
    clear,
    retry() { if (active?.failedAt) { clear(); onChange(); } },
    read(key, request) {
      if (active?.key !== key || (active.failedAt && Date.now() - active.failedAt >= 15000)) {
        clear();
        active = { key, abort: new AbortController(), id: 0, config: 0 };
        open(active);
      }
      const old = active.request;
      const configChanged = !old || old.bag !== request.bag || old.weather !== request.weather || old.carryBag !== request.carryBag;
      if (configChanged || old.tee !== request.tee || old.preview !== request.preview || !samePoint(old.origin, request.origin) || !samePoint(old.target, request.target)) {
        active.id++;
        if (configChanged) active.config++;
        active.request = { ...request, config: active.config };
        const last = active.result;
        if (!last?.shots.length || !canRetain({ ...old, origin: last.origin }, active.request)) active.result = null;
        send(active);
      }
      return active.result ?? { status: active.failedAt ? 'unavailable' : 'loading', shots: [] };
    },
  };
}
