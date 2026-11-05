/* The hole changes on the next tee, and nowhere else. */
import { describe, expect, it } from 'vitest';
import { createTeeWatch, distanceToTee, nextHole, TEE_DWELL_MS, TEE_REACH_METRES } from './map-follow.mjs';

/* Holes in a row, each 400 m long, with its tees side by side and its next tee 60 m
   past its green. */
const square = (x, z, half) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
const holes = Array.from({ length: 18 }, (_, i) => {
  const x = i * 500;
  return {
    n: i + 1,
    tees: [{ point: [x, 0] }, { point: [x, -30] }],
    teePads: [square(x, 0, 4)],
    green: { ring: square(x + 400, 0, 15) },
  };
});
const teeOf = number => [(number - 1) * 500, 0];
const SETTLED = TEE_DWELL_MS + 1;

function watcher(defaults = {}) {
  const watch = createTeeWatch();
  return { watch, at: (point, now, extra = {}) => watch.update({ point, accuracy: 5, now, holes, shown: 3, playing: 3, ...defaults, ...extra }) };
}

describe('the next tee', () => {
  it('counts on to the next hole, and round to the first', () => {
    expect(nextHole(3, 18)).toBe(4);
    expect(nextHole(18, 18)).toBe(1);
    expect(nextHole(9, 9)).toBe(1);
  });

  it('measures to any colour of tee, and is nil on the pad', () => {
    expect(distanceToTee([1500, 2], holes[0])).toBeGreaterThan(1000);
    expect(distanceToTee([0, -30], holes[0])).toBe(0);
    expect(distanceToTee([2, 2], holes[0])).toBe(0);
    expect(distanceToTee([20, 0], holes[0])).toBeCloseTo(16);
  });

  it('changes hole once the player has stood on it, and not before', () => {
    const { at } = watcher();
    expect(at(teeOf(4), 0)).toBeNull();
    expect(at(teeOf(4), TEE_DWELL_MS - 1)).toBeNull();
    expect(at(teeOf(4), SETTLED)).toBe(4);
  });

  it('knows it is waiting, so a still player with no fixes is not forgotten', () => {
    const { watch, at } = watcher();
    expect(watch.waiting).toBe(false);
    at(teeOf(4), 0);
    expect(watch.waiting).toBe(true);
    expect(watch.candidate).toBe(4);
  });

  it('counts a player who has walked on through as never having stood there', () => {
    const { at } = watcher();
    at(teeOf(4), 0);
    expect(at([1600, 300], 5000)).toBeNull();
    expect(at(teeOf(4), 6000)).toBeNull();
    expect(at(teeOf(4), SETTLED)).toBeNull();
    expect(at(teeOf(4), 6000 + SETTLED)).toBe(4);
  });

  it('ignores every other hole\'s tee, however long the player stands there', () => {
    const { at } = watcher();
    for (const number of [1, 2, 6, 9, 18]) {
      at(teeOf(number), 0);
      expect(at(teeOf(number), SETTLED), `tee ${number}`).toBeNull();
    }
  });

  it('catches up at the tee after one that went by unseen', () => {
    const { at } = watcher();
    at(teeOf(5), 0);
    expect(at(teeOf(5), SETTLED)).toBe(5);
  });

  it('prefers the next hole when two tees stand together', () => {
    const together = holes.map(hole => (hole.n === 5 ? { ...hole, tees: [{ point: [1508, 0] }], teePads: [] } : hole));
    const { at } = watcher({ holes: together });
    at(teeOf(4), 0);
    expect(at(teeOf(4), SETTLED)).toBe(4);
  });

  it('stays put on a tee two holes share, until the first of them has been played', () => {
    /* As Lidingö's: the 3rd's tee is also the 5th's, and the 4th's lies elsewhere. */
    const shared = holes.map(hole => (hole.n === 5 ? { ...hole, tees: [{ point: teeOf(3) }], teePads: [] } : hole));
    const { at } = watcher({ holes: shared });
    at(teeOf(3), 0);
    expect(at(teeOf(3), SETTLED)).toBeNull();
    expect(at(teeOf(3), SETTLED * 4)).toBeNull();
    /* Played, and missed the 4th's tee: back on the shared one it counts. */
    at([1200, 0], SETTLED * 5);
    at(teeOf(3), SETTLED * 6);
    expect(at(teeOf(3), SETTLED * 8)).toBe(5);
  });

  it('does not count the tee of the hole already on screen', () => {
    const { at } = watcher();
    at(teeOf(3), 0);
    expect(at(teeOf(3), SETTLED)).toBeNull();
  });

  it('wraps from the last hole to the first', () => {
    const { at } = watcher({ shown: 18, playing: 18 });
    at(teeOf(1), 0);
    expect(at(teeOf(1), SETTLED)).toBe(1);
  });

  it('stands on the first tee of a round from any hole, until the card has begun', () => {
    const { at } = watcher({ shown: 7, playing: 7, fresh: true });
    at(teeOf(1), 0);
    expect(at(teeOf(1), SETTLED)).toBe(1);
    const begun = watcher({ shown: 7, playing: 7, fresh: false });
    begun.at(teeOf(1), 0);
    expect(begun.at(teeOf(1), SETTLED)).toBeNull();
  });

  it('holds off while the player is still on the green beside it', () => {
    const beside = holes.map(hole => (hole.n === 4 ? { ...hole, tees: [{ point: [1425, 0] }], teePads: [] } : hole));
    const { at } = watcher({ holes: beside });
    at([1413, 0], 0);
    expect(at([1413, 0], SETTLED)).toBeNull();
  });

  it('still changes on a tee that touches the last green', () => {
    const touching = holes.map(hole => (hole.n === 4 ? { ...hole, tees: [{ point: [1417, 0] }], teePads: [] } : hole));
    const { at } = watcher({ holes: touching });
    at([1417, 0], 0);
    expect(at([1417, 0], SETTLED)).toBe(4);
  });

  it('will not trust a fix too loose to tell one tee from another', () => {
    const { at } = watcher({ accuracy: 35 });
    at(teeOf(4), 0);
    expect(at(teeOf(4), SETTLED)).toBeNull();
  });

  it('follows a player looking ahead: the next tee of the hole played still counts', () => {
    const { at } = watcher({ shown: 12, playing: 3 });
    at(teeOf(4), 0);
    expect(at(teeOf(4), SETTLED)).toBe(4);
  });

  it('follows a hole chosen by hand: the tee after that one counts as well', () => {
    const { at } = watcher({ shown: 7, playing: 3 });
    at(teeOf(8), 0);
    expect(at(teeOf(8), SETTLED)).toBe(8);
  });

  it('never takes back a hole chosen by hand, until the player has left that tee', () => {
    const { watch, at } = watcher();
    at(teeOf(4), 0);
    expect(at(teeOf(4), SETTLED)).toBe(4);
    /* The map went to hole 4, and the player went back to 3. */
    watch.manual();
    at(teeOf(4), SETTLED + 1);
    expect(at(teeOf(4), SETTLED * 3)).toBeNull();
    expect(at([1600, 300], SETTLED * 3 + 1)).toBeNull();
    at(teeOf(4), SETTLED * 3 + 2);
    expect(at(teeOf(4), SETTLED * 5)).toBe(4);
  });

  it('reaches as far as it says', () => {
    const { at } = watcher();
    const edge = [teeOf(4)[0] + 4 + TEE_REACH_METRES - 0.5, 0];
    at(edge, 0);
    expect(at(edge, SETTLED)).toBe(4);
    const past = [teeOf(4)[0] + 4 + TEE_REACH_METRES + 0.5, 0];
    const second = watcher();
    second.at(past, 0);
    expect(second.at(past, SETTLED)).toBeNull();
  });
});
