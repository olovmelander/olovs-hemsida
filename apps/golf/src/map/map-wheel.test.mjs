import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClubWheel, HOLD_MS } from './map-wheel.mjs';

const bag = ['driver', 'iron', 'wedge', 'putter'].map((id, i) => ({ id, name: id, carry: 180 - 60 * i }));

function element() {
  const classes = new Set();
  return {
    dataset: {}, style: {}, attributes: {}, children: [],
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name),
    },
    closest() { return this; },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
  };
}

function setup() {
  const handlers = new Map(), list = element();
  const emit = (type, values) => handlers.get(type)({ preventDefault() {}, pointerId: 1, ...values });
  list.addEventListener = (type, callback) => handlers.set(type, callback);
  // An animated scroll can still be on the previous row when a second input arrives.
  list.scrollTo = ({ top, behavior }) => {
    if (behavior === 'instant') {
      list.scrollTop = top;
      emit('scroll');
    }
  };
  const onChoose = vi.fn(), onLock = vi.fn();
  const wheel = createClubWheel({ ...element(), querySelector: () => list }, { onChoose, onLock });
  wheel.setClubs(bag);
  const heldIron = () => emit('pointerdown', { target: list.children[bag.length + 1], clientX: 5, clientY: 5 });
  const selected = () => list.children.find(row => row.id === list.attributes['aria-activedescendant']);
  return { wheel, list, emit, onChoose, onLock, heldIron, selected };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: element });
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 16));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('a club wheel following a new target', () => {
  it('takes over a flick before it settles and ignores further momentum', () => {
    const { wheel, list, emit, onChoose, onLock, selected } = setup();
    emit('wheel');
    list.scrollTop += 50;
    emit('scroll');
    wheel.suggest('wedge');
    wheel.rest('wedge', { reclaim: true });
    expect(list.scrollTop).toBe((bag.length + 2) * 50);
    expect(selected().dataset.club).toBe('wedge');
    expect(selected().classList.contains('is-suggested')).toBe(true);
    list.scrollTop += 50;
    emit('scroll');
    vi.advanceTimersByTime(250);
    expect(wheel.current().id).toBe('wedge');
    expect(list.scrollTop).toBe((bag.length + 2) * 50);
    expect(onChoose).not.toHaveBeenCalled();
    expect(onLock).not.toHaveBeenCalled();
  });

  it('uses the logical destination for actions as soon as an automatic turn starts', () => {
    const { wheel, selected, emit, onLock } = setup();
    wheel.rest('iron');
    expect(wheel.current().id).toBe('iron');
    expect(selected().attributes['aria-selected']).toBe('true');
    expect(selected().dataset.club).toBe('iron');
    emit('keydown', { key: 'Enter' });
    expect(onLock).toHaveBeenCalledWith(bag[1]);
    emit('keydown', { key: 'ArrowDown' });
    expect(wheel.current().id).toBe('wedge');
  });

  it('releases an older short press to the latest target without selecting the old club', () => {
    const { wheel, heldIron, list, emit, onChoose } = setup();
    heldIron();
    const before = list.scrollTop;
    wheel.rest('putter', { reclaim: true });
    wheel.rest('wedge');
    expect(list.scrollTop).toBe(before);
    emit('pointerup');
    expect(wheel.current().id).toBe('wedge');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('locks only the held club when a new target arrives during its hold', () => {
    const { wheel, heldIron, onLock, onChoose } = setup();
    heldIron();
    wheel.rest('wedge', { reclaim: true });
    vi.advanceTimersByTime(HOLD_MS);
    expect(onLock).toHaveBeenCalledExactlyOnceWith(bag[1], { superseded: true });
    expect(wheel.current().id).toBe('wedge');
    expect(onChoose).not.toHaveBeenCalled();
  });
});
