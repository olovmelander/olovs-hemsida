import { describe, it, expect } from 'vitest';
import { clubKind, clubAssetKey } from './club-design.mjs';
import { CLUB_ASSETS } from './club-assets.mjs';
import { DEFAULT_BAG } from './caddie.js';

describe('club appearance and legacy bags', () => {
  it('maps every default club to its own exported model', () => {
    expect(DEFAULT_BAG.map(clubAssetKey)).toEqual(DEFAULT_BAG.map(club => club.id));
    for (const club of DEFAULT_BAG) expect(CLUB_ASSETS[clubAssetKey(club)]).toBeDefined();
  });
  it.each([['Trä 5','fairway','wood-5'],['Järn 8','iron','iron-8'],['56°','wedge','sw'],['Putter','putter','putter'],['Hybrid 4','hybrid','hybrid-4']])('recognizes %s in old name/carry records', (name,kind,key) => {
    expect(clubKind({name})).toBe(kind);
    expect(clubAssetKey({name})).toBe(key);
  });
  it('lets an explicit model survive arbitrary custom names', () => {
    expect(clubKind({id:'driver',name:'Min favorit',kind:'wedge'})).toBe('wedge');
    expect(clubAssetKey({id:'custom',name:'Min favorit',kind:'wedge'})).toBe('pw');
  });
  it('uses recognized renamed clubs before their stale IDs', () => {
    expect(clubKind({id:'driver',name:'Putter'})).toBe('putter');
  });
});
