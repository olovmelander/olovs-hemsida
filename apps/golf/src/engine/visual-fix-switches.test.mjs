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

const GLOW_BEFORE = ['glowthreshold=0', 'cloudglow=0'];

const BUILDING_BEFORE = ['wallbase=0', 'roofridge=0'];
/* the water road pass's (docs/visual-water-road-2026-09-25.md) */
const WATER_ROAD_BEFORE = ['waterroad=0', 'watermirror=0', 'waterrelief=0', 'opensea=0'];
/* the water from above's (docs/visual-water-above-2026-09-25.md) */
const WATER_ABOVE_BEFORE = ['watercloud=0', 'waterlanes=0'];
/* the lights audit's (docs/visual-lights-2026-09-25.md) */
const LIGHTS_BEFORE = ['lights=before'];
/* the clouds batch's (docs/visual-clouds-2026-09-26.md) */
const CLOUDS_BEFORE = ['cloudlight=0', 'cloudstretch=0'];
/* the ground batch's (docs/visual-ground-2026-09-26.md), all but ?reedlakes=0, which moves plantings */
const GROUND_BEFORE = ['groundedges=0', 'stripereach=0', 'hardground=0', 'coverlight=0', 'covershadow=0', 'covercolour=0', 'coverseat=0'];
/* the turf batch's (docs/visual-turf-2026-09-26.md) */
const TURF_BEFORE = ['turfgrain=0', 'groundwear=0', 'bareground=0'];
/* the grass round the ball's (docs/visual-near-grass-2026-09-26.md) */
const NEAR_GRASS_BEFORE = ['neargrass=0'];

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
  it('leave prepared startup eligible for the landscape, air, water, glow, buildings, water road, water from above, lights audit, clouds, ground and turf batches\' befores, the grass round the ball\'s, and all of them together', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      for (const flag of [...LANDSCAPE_BEFORE, ...AIR_BEFORE, ...WATER_BEFORE, ...GLOW_BEFORE, ...BUILDING_BEFORE, ...WATER_ROAD_BEFORE, ...WATER_ABOVE_BEFORE, ...LIGHTS_BEFORE, ...CLOUDS_BEFORE, ...GROUND_BEFORE, ...TURF_BEFORE, ...NEAR_GRASS_BEFORE]) expect(allowed(`?bana=angso&${flag}`)).toBe(true);
      expect(allowed(`?bana=angso&${[...BEFORE, ...LIGHTING_BEFORE, ...LANDSCAPE_BEFORE, ...AIR_BEFORE, ...WATER_BEFORE, ...GLOW_BEFORE, ...BUILDING_BEFORE, ...WATER_ROAD_BEFORE, ...WATER_ABOVE_BEFORE, ...LIGHTS_BEFORE, ...CLOUDS_BEFORE, ...GROUND_BEFORE, ...TURF_BEFORE, ...NEAR_GRASS_BEFORE].join('&')}`)).toBe(true);
    }
  });
  it('plant the reeds live for ?reedlakes=0: the prepared scatter holds the reeds round every lake', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      expect(allowed('?bana=angso&reedlakes=0')).toBe(false);
    }
  });
  it('keep prepared startup for ?surfaceRelief=1, which the painted finish never read', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed]) {
      expect(allowed('?bana=angso&surfaceRelief=1')).toBe(true);
    }
  });
});
