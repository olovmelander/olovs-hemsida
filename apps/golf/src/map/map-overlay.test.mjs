import { describe, expect, it } from 'vitest';
import { createOverlay } from './map-overlay.mjs';

const origin = [105, 250], target = [185, 250], corner = [260, 150], green = [360, 150];
const hole = {
  line: [[90, 300], [90, 150], green],
  green: { c: green, ring: [[350, 140], [370, 140], [370, 160], [350, 160]] },
  pin: green,
};

function draw(guidance, options = {}) {
  let path = [], dash = [];
  const strokes = [], labels = [], texts = [];
  const ctx = {
    setTransform() {}, clearRect() {}, closePath() {}, fill() {}, ellipse() {}, arc() {}, roundRect() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    setLineDash(pattern) { dash = pattern; },
    stroke() { strokes.push({ path: [...path], dash, colour: this.strokeStyle }); },
    measureText(text) { return { width: text.length * 8 }; },
    fillText(text, x, y) { labels.push(text); texts.push({ text, x, y }); },
  };
  const overlay = createOverlay({ getContext: () => ctx });
  overlay.resize(412, 915, 1);
  overlay.draw({
    camera: { project: (x, y, z) => ({ x, y: z }) }, ground: () => 0,
    mode: 'hole', hole, origin: [90, 300], carryArcs: false, guidance, ...options,
  });
  const primary = strokes.filter(s => s.colour === '#ffd23f' && s.path.length);
  const later = strokes.filter(s => s.dash.length && s.colour.startsWith('rgba(255,210,63,'));
  return { primary, later, labels, texts };
}

const plan = {
  mode: 'auto', origin, target, reading: { distance: 80 },
  legs: [{ from: origin, point: target }, { from: target, point: corner }, { from: corner, point: green }],
};
const ends = ({ path }) => [path[0], path.at(-1)];

describe('active shot overlay', () => {
  it('draws the active shot from its accepted origin and each later stroke through its own landing', () => {
    const { primary, later, labels } = draw(plan);
    expect(primary.map(ends)).toEqual([[origin, target]]);
    expect(later.map(ends)).toEqual([[target, corner], [corner, green]]);
    expect(labels).toEqual(['80 m']);
  });

  it('points the selected club arc at the active target, independent of the mapped dogleg', () => {
    const { primary } = draw(plan, { clubArc: { carry: 40 } });
    const arc = primary.find(stroke => stroke.path.length === 13);
    expect(arc.path[6][0]).toBeCloseTo(origin[0] + 40);
    expect(arc.path[6][1]).toBeCloseTo(origin[1]);
  });

  it('measures a tap immediately when there is no validated continuation', () => {
    const { primary, later, labels } = draw({ ...plan, mode: 'manual', legs: [] });
    expect(primary.map(ends)).toEqual([[origin, target]]);
    expect(later).toEqual([]);
    expect(labels).toEqual(['80 m']);
  });

  it('shows no directional guidance when no landing is available', () => {
    const { primary, later, labels } = draw({ ...plan, target: null, legs: [], reading: null }, { clubArc: { carry: 140 } });
    expect(primary).toEqual([]);
    expect(later).toEqual([]);
    expect(labels).toEqual([]);
  });

  it('keeps the immediate shot visible at eye level, including when the ball projects behind the camera', () => {
    const { primary, later, labels } = draw(plan, {
      atEye: true,
      camera: { project: (x, y, z) => ({ x: x > origin[0] ? x : NaN, y: z }) },
    });
    expect(primary).toHaveLength(1);
    expect(primary[0].path.length).toBeGreaterThan(1);
    expect(primary[0].path.at(-1)).toEqual(target);
    expect(later).toEqual([]);
    expect(labels).toEqual([]);
  });
});

describe('hazard pills', () => {
  /* The line of play runs on screen from the tee (90, 300) toward the pin (360, 150). */
  const sand = (x, z) => [[x - 6, z - 5], [x + 6, z - 5], [x + 6, z + 5], [x - 6, z + 5]];
  const bunker = (x, z, side) => ({ kind: 'bunker', at: [x, z], outline: sand(x, z), front: 95, carry: 108, side });
  const pillOf = hazard => draw(null, { hazards: [hazard] }).texts.find(({ text }) => text === '95–108 m');

  it('stands a bunker\'s distances beside its sand, on the side away from the line, never on the sand', () => {
    const right = pillOf(bunker(300, 260, 'höger'));
    expect(right.x).toBeGreaterThan(306);
    expect(Math.abs(right.y - 0.5 - 260)).toBeLessThan(1);
    const left = pillOf(bunker(120, 200, 'vänster'));
    expect(left.x).toBeLessThan(114);
  });

  it('takes the side from the screen, so a turned map keeps the pill off the sand', () => {
    /* Called right of play, yet drawn left of the line on this screen. */
    expect(pillOf(bunker(120, 200, 'höger')).x).toBeLessThan(114);
  });

  it('stands the pill above a bunker on the line', () => {
    expect(pillOf(bunker(200, 237, 'mitt')).y).toBeLessThan(232);
  });

  it('keeps a hazard without an outline on its middle', () => {
    const water = pillOf({ kind: 'water', at: [250, 240], front: 95, carry: 108, side: 'höger' });
    expect(water.x).toBe(250);
  });
});
