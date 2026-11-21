import { describe, expect, it } from 'vitest';
import { shotUndo } from './map-shot-undo.mjs';

describe('undoing a shot', () => {
  it('reverses its log changes and calculated fields while preserving other score entries and later events', () => {
    const first = { outcome: 'open' }, closed = { outcome: 'played' }, next = {}, later = {};
    const undo = shotUndo([first]);
    undo.capture([closed, next]);
    const scores = { 1: { putts: 2 }, 2: { strokes: 6 } };
    undo.score(scores, 1, { fairway: 'hit' }, true);
    scores[1].fairway = 'hit';
    undo.score(scores, 1, { strokes: 5 }, false);
    scores[1].strokes = 5;
    expect(undo.restore([closed, next, later], scores)).toEqual([first, later]);
    expect(scores).toEqual({ 1: { putts: 2, strokes: 5 }, 2: { strokes: 6 } });
  });

  it('keeps a manual confirmation of the same score and restores other derived fields', () => {
    const old = {}, logged = {}, scores = { 3: { putts: 1 } };
    const undo = shotUndo([old]);
    undo.capture([logged]);
    const score = { strokes: 5, putts: 2, logged: true };
    undo.score(scores, 3, score, true);
    Object.assign(scores[3], score);
    undo.score(scores, 3, { strokes: 5, logged: false }, false);
    Object.assign(scores[3], { strokes: 5, logged: false });
    expect(undo.restore([logged], scores)).toEqual([old]);
    expect(scores).toEqual({ 3: { strokes: 5, putts: 1, logged: false } });
  });

  it('reverses removal of zero putts, and leaves a replaced stroke alone', () => {
    const stroke = {}, putter = {}, changed = {}, edited = {};
    const removed = shotUndo([stroke, putter]);
    removed.capture([stroke]);
    expect(removed.restore([stroke], {})).toEqual([stroke, putter]);
    const replaced = shotUndo([stroke]);
    replaced.capture([changed]);
    const current = [edited];
    expect(replaced.restore(current, {})).toBe(current);
  });
});
