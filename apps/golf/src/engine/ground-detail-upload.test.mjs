import { expect, it } from 'vitest';
import { createPackedGroundDetailTexture } from './ground-detail-upload.mjs';

it('preserves RGB detail under zero glint-mask values', () => {
  const texture = createPackedGroundDetailTexture();
  try {
    // These seeded pixels have A=0 but meaningful RGB. A canvas upload turned
    // them into [0,0,0,0], producing spurious sharp relief across smooth clumps.
    const data = texture.image.data;
    expect([...data.slice(20, 24)]).toEqual([42, 53, 10, 0]);
    expect([...data.slice(28, 32)]).toEqual([161, 64, 13, 0]);
    expect([...data.slice(36, 40)]).toEqual([144, 74, 16, 0]);
    expect(texture.premultiplyAlpha).toBe(false);
  } finally { texture.dispose(); }
});
