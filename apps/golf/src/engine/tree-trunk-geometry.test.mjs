import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHeroTrunkGeometry } from './tree-trunk-geometry.mjs';

/* Geometry fingerprints captured from main.js's unmodified heroTrunk +
   mergeGeos at e228362, with three 0.185.1. These pin the old geometry without
   reproducing its merger in the test. UVs are the only new vertex attribute. */
const LEGACY = [
  {
    species: 'spruce', dimensions: [0.18, 0.42, 3.2],
    position: 'a8c70c45749d1313d1434a91e9e211cbc4740b221510343726f1f23d5fac8330',
    normal: '8898d1e075646567c30d7e742b73fbb131790b0f97c92beb063bd95996d00483',
    min: [-0.7139999866485596, -2.3841858265427618e-8, -0.7139999866485596],
    max: [0.7139999866485596, 3.200000047683716, 0.7139999866485596],
    centre: [0, 1.6000000119209288, 0], radius: 1.7520833598372223,
  },
  {
    species: 'pine', dimensions: [0.22, 0.46, 9],
    position: 'fe992a58c77d1f87a6e3dc1412cb13a12398415df9216851712836a525ef91e4',
    normal: '5cfc88c7755a99ffe019d8f0ce094a3085afdbf7f39fc53ac922145032a2a173',
    min: [-0.7820000052452087, -1.1920929132713809e-8, -0.7820000052452087],
    max: [0.7820000052452087, 9, 0.7820000052452087],
    centre: [0, 4.499999994039536, 0], radius: 4.567441741483704,
  },
  {
    species: 'birch', dimensions: [0.16, 0.30, 7.4],
    position: '8a0ab965f2a606120d02100100ccd097605ab57bbb3012640a4865a4a10e6fe0',
    normal: '3b52060b6639335497d11138e9d71d362be5f6328dc7b3fe1d622e96c7c0bceb',
    min: [-0.5099999904632568, -4.7683716530855236e-8, -0.5099999904632568],
    max: [0.5099999904632568, 7.400000095367432, 0.5099999904632568],
    centre: [0, 3.7000000238418576, 0], radius: 3.7349833008787106,
  },
];
const LEGACY_INDEX = '9ca8150fd08737203f121bb53e293743a87ee79f4f3faf627a5d82894831f7c4';
const fingerprint = attribute => createHash('sha256').update(new Uint8Array(
  attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength,
)).digest('hex');

describe.each(LEGACY)('$species hero trunk', reference => {
  it('preserves the previous geometry buffers, topology, bounds and draw budget', () => {
    const geometry = createHeroTrunkGeometry(...reference.dimensions);
    expect(fingerprint(geometry.getAttribute('position'))).toBe(reference.position);
    expect(fingerprint(geometry.getAttribute('normal'))).toBe(reference.normal);
    expect(fingerprint(geometry.index)).toBe(LEGACY_INDEX);
    expect(geometry.index.array).toBeInstanceOf(Uint32Array);
    expect(geometry.getAttribute('position').count).toBe(66);
    expect(geometry.index.count / 3).toBe(60);
    expect(geometry.groups).toEqual([]);
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    expect(geometry.boundingBox.min.toArray()).toEqual(reference.min);
    expect(geometry.boundingBox.max.toArray()).toEqual(reference.max);
    expect(geometry.boundingSphere.center.toArray()).toEqual(reference.centre);
    expect(geometry.boundingSphere.radius).toBe(reference.radius);
    geometry.dispose();
  });

  it('wraps bark continuously around each side and provides a planar cap mapping', () => {
    const geometry = createHeroTrunkGeometry(...reference.dimensions);
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    const [r0, , h] = reference.dimensions;
    expect(uv.itemSize).toBe(2);
    expect(uv.count).toBe(position.count);
    // Each side's U follows its angle, including separate U=0/1 seam vertices;
    // V rises from the ground to the top. A constant fallback UV cannot pass.
    for (const [start, height] of [[0, 0.6], [26, h]]) {
      for (let row = 0; row < 2; row++) for (let segment = 0; segment <= 12; segment++) {
        const i = start + row * 13 + segment;
        const angle = uv.getX(i) * Math.PI * 2;
        const radius = Math.hypot(position.getX(i), position.getZ(i));
        expect(uv.getX(i)).toBeCloseTo(segment / 12, 6);
        expect(position.getX(i) / radius).toBeCloseTo(Math.sin(angle), 6);
        expect(position.getZ(i) / radius).toBeCloseTo(Math.cos(angle), 6);
        expect(uv.getY(i)).toBe(1 - row);
        expect(uv.getY(i)).toBeCloseTo(position.getY(i) / height, 6);
      }
    }
    // The upward-facing cap maps X/-Z to the texture plane, with its centre
    // at (0.5, 0.5), rather than borrowing the bark's cylindrical seam.
    for (let i = 52; i < uv.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / r0 * 0.5 + 0.5, 6);
      expect(uv.getY(i)).toBeCloseTo(-position.getZ(i) / r0 * 0.5 + 0.5, 6);
    }
    // Every rendered triangle must cover texture area; retaining an attribute
    // of zeroes would silently restore the same constant bark sample.
    for (let i = 0; i < geometry.index.count; i += 3) {
      const a = geometry.index.getX(i), b = geometry.index.getX(i + 1), c = geometry.index.getX(i + 2);
      const area2 = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a))
        - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
      expect(Math.abs(area2)).toBeGreaterThan(0.001);
    }
    geometry.dispose();
  });
});
