import { describe, expect, it } from 'vitest';
import { PIN_GROUP_PX, groupMiddle, groupPins, separatingZoom } from './pin-groups.mjs';

const ids = groups => groups.map(group => group.map(point => point.id));
/* what the map draws: a group at its middle, a pin alone where it stands */
const drawn = groups => groups.map(group => (group.length === 1 ? group[0] : groupMiddle(group)));
const touching = marks => marks.some((a, i) => marks.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) <= PIN_GROUP_PX));

describe('the Sverigekarta\'s pin groups', () => {
  it('draws pins that would touch as one group, through any chain of them, the most important first', () => {
    const points = [{ id: 'bro-hof', x: 100, y: 100 }, { id: 'lidingo', x: 125, y: 100 }, { id: 'visby', x: 400, y: 600 },
      { id: 'upsala', x: 100, y: 140 }, { id: 'johannesberg', x: 160, y: 100 }];
    /* Johannesberg is 60 px from Bro Hof but 35 px from Lidingö: left alone it would stand on the group */
    expect(ids(groupPins(points))).toEqual([['bro-hof', 'lidingo', 'upsala', 'johannesberg'], ['visby']]);
  });

  it('leaves no pin standing on a group\'s member, as a seed-centred grouping did at Örnsköldsvik', () => {
    /* Norrfällsviken first; Veckefjärden 40 px from it; Puttom 9 px from Veckefjärden but 49 px from Norrfällsviken */
    const points = [{ id: 'norrfallsviken', x: 0, y: 0 }, { id: 'veckefjarden', x: 40, y: 0 }, { id: 'puttom', x: 49, y: 0 }];
    expect(ids(groupPins(points))).toEqual([['norrfallsviken', 'veckefjarden', 'puttom']]);
  });

  it('joins a pin that stands clear of a group\'s members but on its count', () => {
    /* a and b are 40 px apart, so a group drawn at (20, 0); c is 45 px from each, 40 px from the count */
    const points = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 20, y: 40 }];
    expect(ids(groupPins(points, 42))).toEqual([['a', 'b', 'c']]);
    expect(touching(drawn(groupPins(points, 42)))).toBe(false);
  });

  it('keeps every pin exactly once, and leaves pins that stand clear alone', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ id: i, x: (i % 10) * 70 + (i % 3) * 9, y: Math.floor(i / 10) * 37 }));
    const groups = groupPins(points);
    expect(groups.flat().map(point => point.id).sort((a, b) => a - b)).toEqual(points.map(point => point.id));
    expect(touching(drawn(groups))).toBe(false);
    expect(groupPins(points, 10).every(group => group.length === 1)).toBe(true);
  });

  it('finds the zoom at which a grouped club gets its own pin', () => {
    /* web mercator doubles the pixels each zoom */
    const project = (point, zoom) => ({ x: point.x * 2 ** zoom, y: point.y * 2 ** zoom });
    const target = { x: 10, y: 10 };
    expect(separatingZoom(target, [{ x: 10.5, y: 10 }], project, { from: 5, to: 14 })).toBe(7);
    expect(separatingZoom(target, [{ x: 20, y: 10 }], project, { from: 5, to: 14 })).toBe(5);
    expect(separatingZoom(target, [{ x: 10, y: 10 }], project, { from: 5, to: 14 })).toBe(14);
  });
});
