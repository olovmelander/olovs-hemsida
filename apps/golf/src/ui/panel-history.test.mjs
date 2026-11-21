import { describe, expect, it } from 'vitest';
import { createPanelHistory } from './panel-history.mjs';

function session() {
  const entries = [{ away: true }, { unrelated: 5 }];
  let index = 1, destination = null;
  const seen = [];
  const history = {
    get state() { return entries[index]; },
    pushState(state) { entries.splice(++index, Infinity, structuredClone(state)); },
    replaceState(state) { entries[index] = structuredClone(state); },
    go(offset) { destination = index + offset; },
  };
  const options = { history, key: 'banvyMapPanels', course: 'puttom', render: path => seen.push(path.map(panel => panel.name)) };
  const panels = createPanelHistory(options);
  const traverse = steps => {
    index = steps === undefined ? destination : index + steps;
    destination = null;
    panels.restore(history.state);
  };
  return { panels, traverse, entries, history, seen, options };
}
const menu = { name: 'menu', tab: 'spel' }, light = { name: 'light' };

describe('in-map panel history', () => {
  it('returns to the same menu tab with Back and reopens its child with Forward', () => {
    const { panels, traverse, history, entries } = session();
    panels.open(menu);
    panels.update({ tab: 'karta' });
    panels.open(light);
    traverse(-1);
    expect(panels.current).toEqual({ name: 'menu', tab: 'karta' });
    traverse(1);
    expect(panels.current).toEqual(light);
    panels.close();
    expect(panels.current).toBeUndefined();
    traverse();
    expect(history.state).toEqual({ unrelated: 5 });
    expect(entries.at(-1).unrelated).toBe(5);
    traverse(-1);
    expect(history.state).toEqual({ away: true });
  });

  it('processes a quick tap after closing the camera on the correct browser entry', () => {
    const { panels, traverse, entries, seen } = session();
    panels.open({ name: 'camera' });
    panels.back();
    panels.open({ name: 'hole' });
    traverse();
    expect(seen).toEqual([['camera'], [], ['hole']]);
    expect(entries.length).toBe(3);
    traverse(-1);
    expect(panels.current).toBeUndefined();
  });

  it('replaces a completed action and restores the saved panel after a reload', () => {
    const { panels, entries, history, options } = session();
    panels.open({ name: 'score', opener: '[data-score]' });
    panels.open({ name: 'round', round: 'abc', opener: '[data-end-round]' }, { replace: true });
    expect(entries.length).toBe(3);
    const reloaded = createPanelHistory(options);
    reloaded.restore(history.state);
    expect(reloaded.current).toEqual({ name: 'round', round: 'abc', opener: '[data-score]' });
    const another = createPanelHistory({ ...options, course: 'another' });
    another.restore(history.state);
    expect(another.current).toBeUndefined();
  });

  it('supports Back and close when an embedded browser denies history writes', () => {
    const seen = [];
    const panels = createPanelHistory({
      history: { pushState() { throw Error('restricted'); } }, key: 'banvyMapPanels', course: 'test', render: path => seen.push(path.length),
    });
    panels.open(menu);
    panels.open(light);
    panels.back();
    panels.close();
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});
