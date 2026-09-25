/* The visual bug fixes of 24 September each keep their before behind a URL
   switch, for A/B on the owner's GPU and phone. None of them changes prepared
   startup data, so each must keep it eligible: an A/B that silently fell back to
   the live preparation would compare boot paths, not the fix. */
import { describe, expect, it } from 'vitest';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';
import { preparedWaterAllowed } from './prepared-water.mjs';
import { preparedVistaAllowed } from './prepared-vista.mjs';
import { preparedScatterAllowed } from './prepared-scatter.mjs';

const BEFORE = ['detailupload=canvas', 'mowfade=iso', 'localheight=0', 'coverglow=always', 'pondfetch=lake',
  'waternormal=legacy', 'dither=0', 'bloomknee=hard', 'skyhaze=raw', 'skyorder=first', 'furnitureshadow=0'];

const LIGHTING_BEFORE = ['shadowtint=0', 'sunglow=0', 'hazewarm=0', 'crowndepth=0', 'backlight=0'];

const LANDSCAPE_BEFORE = ['standtint=0', 'surfacegloss=0', 'surfaceedges=0', 'groundrelief=0'];

const AIR_BEFORE = ['onewind=0', 'cloudshadows=0', 'valleymist=0'];

const WATER_BEFORE = ['nordicwater=0', 'waterwind=0'];

describe('the visual fixes\' before switches', () => {
  it('leave every prepared startup path eligible, alone and all together', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      for (const flag of BEFORE) expect(allowed(`?bana=angso&${flag}`)).toBe(true);
      expect(allowed(`?bana=angso&${BEFORE.join('&')}`)).toBe(true);
    }
  });
  it('leave prepared startup eligible for the lighting batch\'s befores too', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      for (const flag of LIGHTING_BEFORE) expect(allowed(`?bana=angso&${flag}`)).toBe(true);
      expect(allowed(`?bana=angso&${[...BEFORE, ...LIGHTING_BEFORE].join('&')}`)).toBe(true);
    }
  });
  it('leave prepared startup eligible for the landscape, air and water batches\' befores, and all of them together', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      for (const flag of [...LANDSCAPE_BEFORE, ...AIR_BEFORE, ...WATER_BEFORE]) expect(allowed(`?bana=angso&${flag}`)).toBe(true);
      expect(allowed(`?bana=angso&${[...BEFORE, ...LIGHTING_BEFORE, ...LANDSCAPE_BEFORE, ...AIR_BEFORE, ...WATER_BEFORE].join('&')}`)).toBe(true);
    }
  });
});
