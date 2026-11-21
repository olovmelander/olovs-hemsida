/* Panels share their viewer's URL. Each opened layer gets one browser history entry,
   so a device Back gesture and the sheet's Back button travel the same path. */
export function createPanelHistory({ history, key, course, render }) {
  let path = [], awaitingPop = false, localOnly = false;
  const queued = [];
  const read = state => state?.[key]?.course === course && Array.isArray(state[key].path) ? state[key].path : [];
  const display = next => {
    const previous = path;
    path = next;
    render(path, previous);
  };
  const run = action => {
    if (awaitingPop) queued.push(action);
    else action();
  };
  function write(next, method) {
    if (localOnly) return;
    try { history[method]({ ...history.state, [key]: { course, path: next } }, ''); }
    catch { localOnly = true; } // Embedded viewers can restrict the History API.
  }
  function retreat(count) {
    const steps = Math.min(count, path.length);
    if (!steps) return;
    if (!localOnly) {
      awaitingPop = true;
      try { history.go(-steps); }
      catch { localOnly = true; awaitingPop = false; }
    }
    display(path.slice(0, path.length - steps));
  }
  return {
    get current() { return path.at(-1); },
    open(panel, { replace = false } = {}) {
      run(() => {
        const replacing = replace && path.length > 0;
        // Completing a score replaces that panel with the round summary. Going
        // back still belongs to the control that originally opened the score.
        const next = replacing ? [...path.slice(0, -1), { ...panel, opener: path.at(-1).opener }] : [...path, panel];
        write(next, replacing ? 'replaceState' : 'pushState');
        display(next);
      });
    },
    update(fields) {
      if (!path.length) return;
      run(() => {
        if (!path.length) return;
        path = [...path.slice(0, -1), { ...path.at(-1), ...fields }];
        write(path, 'replaceState');
      });
    },
    back() { run(() => retreat(1)); },
    close() { run(() => retreat(path.length)); },
    restore(state) {
      const next = read(state);
      // Clicks render immediately. The matching native pop only completes the
      // traversal; an intervening tap can now push onto the actual destination.
      const alreadyShown = awaitingPop && JSON.stringify(next) === JSON.stringify(path);
      awaitingPop = false;
      if (!alreadyShown) display(next);
      while (!awaitingPop && queued.length) queued.shift()();
    },
  };
}
