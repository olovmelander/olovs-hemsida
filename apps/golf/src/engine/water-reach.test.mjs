import { describe, expect, it } from 'vitest';
import { waterReach, traceMaskOutline, refineNearShore, refineReachedWaterBeds, growFlatWaterMask, shoreWetness, SHORE_DAMP, WATER_REACH } from './water-reach.mjs';
import { carveTerrainTile } from './v2-water-bed.mjs';

const area = ring => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
const inRing = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/* a lake whose laser surface is flat at 10.00 out to radius 60, in a bowl rising 0.1 m/m */
const bowl = (x, z) => { const r = Math.hypot(x, z); return r <= 60 ? 10 : 10 + (r - 60) * 0.1; };
/* the traced ring: an octagon well inside the real shore, as an extract's sketch is */
const octagon = Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * 52, Math.sin(i / 8 * Math.PI * 2) * 52]);

describe('the water the ground holds', () => {
  it('runs past a sketched ring to the shore the ground draws', () => {
    const reach = waterReach({ ring: octagon, level: 10.06, heightAt: bowl });
    expect(reach.stats.outsideWetSquareMetres).toBeGreaterThan(1500);
    /* every wet node lies inside the true shore (radius 60 plus the 0.14 m the level and
       tolerance reach up the bank: 61.4 m), and the wet edge is the shore to a node */
    let worstOutside = 0, wetAt58 = 0, total58 = 0;
    for (let r = 0; r < reach.rows; r++) for (let c = 0; c < reach.cols; c++) {
      const x = reach.x0 + c * reach.cell, z = reach.z0 + r * reach.cell, d = Math.hypot(x, z);
      if (reach.wet[r * reach.cols + c]) worstOutside = Math.max(worstOutside, d - 61.4);
      if (Math.abs(d - 58) < reach.cell / 2) { total58++; wetAt58 += reach.wet[r * reach.cols + c]; }
    }
    expect(worstOutside).toBeLessThanOrEqual(1e-9);
    expect(wetAt58).toBe(total58);
    /* the sheet's outline holds the ring and runs under the bank, never far up it */
    for (const p of octagon) expect(inRing(p[0], p[1], reach.outline)).toBe(true);
    for (const [x, z] of reach.outline) {
      const d = Math.hypot(x, z);
      expect(d).toBeGreaterThan(61);
      expect(d).toBeLessThan(61.4 + (WATER_REACH.tuckNodes + 1) * reach.cell);
    }
    /* the bank distance: none at the shore, metres inside it */
    expect(reach.bankAt(64, 0)).toBe(0);
    expect(reach.bankAt(50, 0)).toBeGreaterThan(9);
    expect(reach.bankAt(50, 0)).toBeLessThan(13);
  });

  it('never crosses a ridge into a basin of its own, nor runs past its reach', () => {
    /* a ridge at radius 70, and beyond it a hollow lower than the lake */
    const ground = (x, z) => { const r = Math.hypot(x, z); return r <= 60 ? 10 : r < 70 ? 10 + (r - 60) * 0.2 : r < 74 ? 12 : 9; };
    const reach = waterReach({ ring: octagon, level: 10.06, heightAt: ground });
    for (let r = 0; r < reach.rows; r++) for (let c = 0; c < reach.cols; c++) {
      const x = reach.x0 + c * reach.cell, z = reach.z0 + r * reach.cell;
      if (Math.hypot(x, z) > 72) expect(reach.wet[r * reach.cols + c]).toBe(0);
    }
    /* flat low ground all round: the water stops at its reach, and fades there */
    const flat = waterReach({ ring: octagon, level: 10.06, heightAt: () => 10 });
    expect(flat.stats.farthestOutsideMetres).toBeLessThanOrEqual(WATER_REACH.reachMetres + flat.cell);
  });

  it('holds to the laser\'s own surface when the level stands above it', () => {
    /* a level lifted 0.25 m clear of the surface would flood the gentle bank to 2.5 m more */
    const lifted = waterReach({ ring: octagon, level: 10.25, heightAt: bowl });
    const capped = waterReach({ ring: octagon, level: 10.25, surface: 10, heightAt: bowl });
    expect(capped.ceiling).toBeCloseTo(10 + WATER_REACH.wetToleranceMetres, 9);
    /* given no surface (a pond too small for the plate), it reads its own inside's lower quartile */
    expect(lifted.ceiling).toBeCloseTo(10 + WATER_REACH.wetToleranceMetres, 9);
    expect(lifted.stats.outsideWetSquareMetres).toBe(capped.stats.outsideWetSquareMetres);
  });

  it('stops at a cut where the lake runs on as another sheet, without fading there', () => {
    /* the lake's surface runs on east past the ring, and the flat sheet draws it beyond x = 55 */
    const ground = (x, z) => (x > 40 ? 10 : bowl(x, z));
    const reach = waterReach({ ring: octagon, level: 10.06, heightAt: ground, otherWater: x => x > 55 });
    for (let r = 0; r < reach.rows; r++) for (let c = 0; c < reach.cols; c++) {
      if (reach.x0 + c * reach.cell > 55.5) expect(reach.wet[r * reach.cols + c]).toBe(0);
    }
    /* the water just inside the cut is far from any bank: no fade toward the other sheet */
    expect(reach.bankAt(52, 0)).toBeGreaterThan(8);
    expect(reach.ownsAt(70, 0)).toBe(false);
    for (const [x] of reach.outline) expect(x).toBeLessThan(57);
  });

  it('leaves an island dry and the bed off it', () => {
    const ground = (x, z) => (Math.hypot(x - 20, z) < 8 ? 11 : bowl(x, z));
    const reach = waterReach({ ring: octagon, level: 10.06, heightAt: ground });
    expect(reach.wetAt(20, 0)).toBe(0);
    expect(reach.bankAt(20, 0)).toBe(0);
    expect(reach.wetAt(-20, 0)).toBe(1);
  });
});

describe('the traced outline', () => {
  it('is the outer boundary of the largest piece, with its holes left out', () => {
    const cols = 30, rows = 30, mask = new Uint8Array(cols * rows);
    for (let r = 5; r < 25; r++) for (let c = 5; c < 25; c++) mask[r * cols + c] = 1;
    mask[15 * cols + 15] = 0;   /* a hole */
    mask[2 * cols + 2] = 1;     /* a speck elsewhere */
    const outline = traceMaskOutline(mask, cols, rows, 0, 0, 1);
    /* nodes 5..24 inclusive, cut midway to the next: 4.5..24.5, with its corners chamfered */
    expect(Math.abs(area(outline))).toBeCloseTo(20 * 20 - 4 * 0.125, 6);
    for (const [x, z] of outline) {
      expect(x).toBeGreaterThanOrEqual(4.5); expect(x).toBeLessThanOrEqual(24.5);
      expect(z).toBeGreaterThanOrEqual(4.5); expect(z).toBeLessThanOrEqual(24.5);
    }
  });
});

describe('the sheet near the bank', () => {
  it('is split fine where it meets the bank, conforming and the same way round', () => {
    const verts = [[0, 0], [40, 0], [40, 40], [0, 40]], faces = [[0, 1, 2], [0, 2, 3]];
    const bankAt = x => Math.max(0, x - 0);   /* the bank along x = 0 */
    const { V, F } = refineNearShore(verts, faces, bankAt, { maxEdge: 2, within: 6 });
    const signed = ([a, b, c]) => (V[b][0] - V[a][0]) * (V[c][1] - V[a][1]) - (V[b][1] - V[a][1]) * (V[c][0] - V[a][0]);
    const sign = Math.sign(signed(faces[0].map(i => i)));
    let total = 0;
    for (const f of F) { expect(Math.sign(signed(f))).toBe(sign); total += Math.abs(signed(f)) / 2; }
    expect(total).toBeCloseTo(1600, 6);
    /* conforming: every edge is shared by at most two faces, and no vertex lies inside another face's edge */
    const uses = new Map();
    for (const [a, b, c] of F) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
    for (const n of uses.values()) expect(n).toBeLessThanOrEqual(2);
    const onEdge = (p, a, b) => {
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      return Math.abs(cross) < 1e-9 && dot > 1e-9 && dot < len2 - 1e-9;
    };
    for (const [key] of uses) {
      const [p, q] = key.split('_').map(Number);
      for (let v = 0; v < V.length; v++) if (v !== p && v !== q) expect(onEdge(V[v], V[p], V[q])).toBe(false);
    }
    /* fine at the bank, coarse across the open water */
    const near = F.filter(f => f.some(i => V[i][0] < 0.5));
    expect(near.length).toBeGreaterThan(10);
    for (const f of near) for (let k = 0; k < 3; k++) {
      const a = V[f[k]], b = V[f[(k + 1) % 3]];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(F.length).toBeLessThan(2000);
  });
});

describe('the bed under the water the ground holds', () => {
  const reach = waterReach({ ring: octagon, level: 10.06, heightAt: bowl });
  const broad = { shoreDepthMetres: 0.15, depthPerMetre: 0.12, maximumDepthMetres: 3.5,
    x0: -200, z0: -200, width: 50, height: 50, spacing: 8,
    inWater: () => true, nearWater: () => true, depthAt: () => 2, levelAt: () => 99 };
  const field = refineReachedWaterBeds(broad, [reach], (x, z) => [x, z]);

  it('deepens from the bank by the broad profile, and owns the bank', () => {
    expect(field.reachedBodies).toBe(1);
    expect(field.levelAt(55, 0)).toBe(10.06);
    expect(field.depthAt(55, 0)).toBeCloseTo(Math.min(3.5, 0.15 + 0.12 * reach.bankAt(55, 0)), 6);
    /* open water far from any bank is the broad field's */
    expect(field.levelAt(0, 0)).toBe(99);
    expect(field.depthAt(0, 0)).toBe(2);
    /* on the bank, inside the lattice: no depth, not near water, whatever the broad field said */
    expect(field.nearWater(66, 0)).toBe(false);
    expect(field.depthAt(66, 0)).toBe(0);
    /* outside every lattice: the broad field answers */
    expect(field.levelAt(500, 500)).toBe(99);
    expect(field.toleranceAt(55, 0)).toBeCloseTo(reach.ceiling - reach.level, 9);
  });

  it('is carved where it says, and never above its ceiling', () => {
    /* one 1 m tile, legacy origin at 0, across the shore: the plate at 10.00 and the bank above */
    const width = 40, height = 1, scale = 0.01, offset = 9;
    const payload = new Uint8Array(width * height * 2);
    const heights = Array.from({ length: width }, (_, i) => bowl(40 + i, 0));
    heights.forEach((h, i) => { const q = Math.round((h - offset) / scale); payload[i * 2] = q & 0xff; payload[i * 2 + 1] = q >> 8; });
    const tile = { bounds: { minEasting: 40, maxEasting: 80, minNorthing: 0, maxNorthing: 0 },
      grid: { width, height, sampleSpacingMetres: 1, heightOffsetMetres: offset, heightScaleMetres: scale }, payload };
    carveTerrainTile(tile, field, { legacyOrigin: { easting: 0, northing: 0 }, verticalDatumOffsetMetres: 0 });
    const after = Array.from({ length: width }, (_, i) => offset + (payload[i * 2] | payload[i * 2 + 1] << 8) * scale);
    for (let i = 0; i < width; i++) {
      if (heights[i] > reach.ceiling + 1e-6) expect(after[i]).toBeCloseTo(heights[i], 6);
      else if (40 + i >= 54 && 40 + i < 58) expect(after[i]).toBeLessThan(heights[i]);
    }
  });
});

describe('the bank beside the water', () => {
  it('is damp by height above the water, and the shallows show their bed', () => {
    const reach = waterReach({ ring: octagon, level: 10.06, heightAt: bowl });
    const at = x => shoreWetness([reach], x, 0, bowl(x, 0));
    expect(at(55)).toEqual({ under: 1, damp: 0 });
    /* 0.1 m above the ceiling, then 0.36 m, then clear of the band */
    expect(at(62.4).damp).toBeGreaterThan(at(65).damp);
    expect(at(65).damp).toBeGreaterThan(0);
    expect(at(68)).toBeNull();
    expect(shoreWetness([reach], 500, 500, 0)).toBeNull();
    expect(SHORE_DAMP.darken).toBeLessThan(0.5);
  });
});

describe('the far lakes grown under their banks', () => {
  it('grows a lake the model does not know by one cell, and no other', () => {
    const width = 8, height = 6, mask = new Uint8Array(width * height), label = new Int32Array(width * height);
    /* lake 1 (unknown) at columns 1-2, lake 2 (continues a mapped one) at column 6 */
    for (let r = 2; r < 4; r++) { mask[r * width + 1] = mask[r * width + 2] = 1; label[r * width + 1] = label[r * width + 2] = 1; mask[r * width + 6] = 1; label[r * width + 6] = 2; }
    const components = [{ id: 1, knownCells: 0 }, { id: 2, knownCells: 30 }];
    const { bytes, grown } = growFlatWaterMask({ mask, label, width, height, components, blocked: (c, r) => c === 0 && r === 2 });
    expect(bytes[2 * width + 3]).toBe(255);
    expect(bytes[1 * width + 1]).toBe(255);
    expect(bytes[2 * width + 0]).toBe(0);   /* blocked */
    expect(bytes[2 * width + 5]).toBe(0);   /* beside the mapped lake's continuation */
    expect(bytes[2 * width + 7]).toBe(0);
    expect(grown).toBe(4 * 4 - 4 - 1);
  });
});
