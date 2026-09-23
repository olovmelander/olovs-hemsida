import { describe, expect, it } from 'vitest';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { MAX_CARRY, MIN_CARRY, carryOk, gapNotes, stepCarry } from './bag-editor.mjs';

describe('bag editor', () => {
  it('steps carry to the next five metres and stays within the valid range', () => {
    expect(stepCarry(147, 1)).toBe(150);
    expect(stepCarry(150, 1)).toBe(155);
    expect(stepCarry(147, -1)).toBe(145);
    expect(stepCarry(150, -1)).toBe(145);
    expect(stepCarry('', 1)).toBe(105);
    expect(stepCarry(MAX_CARRY, 1)).toBe(MAX_CARRY);
    expect(stepCarry(MIN_CARRY, -1)).toBe(MIN_CARRY);
  });

  it('accepts a putter without carry and rejects other clubs outside 20–350 m', () => {
    expect(carryOk({ name: 'Putter', carry: 0 })).toBe(true);
    expect(carryOk({ name: 'Järn 7', carry: '140' })).toBe(true);
    expect(carryOk({ name: 'Järn 7', carry: '' })).toBe(false);
    expect(carryOk({ name: 'Järn 7', carry: 19 })).toBe(false);
    expect(carryOk({ name: 'Driver', carry: 351 })).toBe(false);
  });

  it('flags only duplicated distances and large holes, never the default bag', () => {
    expect(gapNotes(DEFAULT_BAG).size).toBe(0);
    const notes = gapNotes([
      { id: 'driver', name: 'Driver', carry: 230 },
      { id: 'iron-5', name: 'Järn 5', carry: 170 },
      { id: 'iron-6', name: 'Järn 6', carry: '170' },
      { id: 'iron-7', name: 'Järn 7', carry: 167 },
      { id: 'putter', name: 'Putter', carry: 0 },
    ]);
    expect(notes.get('iron-5')).toBe('60 m lucka efter Driver');
    expect(notes.get('iron-6')).toBe('Samma carry som Järn 5');
    expect(notes.get('iron-7')).toBe('Bara 3 m kortare än Järn 6');
    expect(notes.has('driver')).toBe(false);
    expect(notes.has('putter')).toBe(false);
  });
});
