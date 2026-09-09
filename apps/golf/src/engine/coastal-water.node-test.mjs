import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoastalWater } from './coastal-water.mjs';

const box = (x0, z0, x1, z1) => ({ x0, z0, x1, z1 });
const ring = (x0,z0,x1,z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const options = { bounds: box(-100,-100,100,100), sourceBounds: box(-20,-20,20,20),
  bodies: [{ isSea: true, ring: ring(-20,-20,0,20) }], seaLevel: 0.23, spacing: 2 };

test('terrain coverage stays inside emitted offshore water and inset mapped sea, protecting shore and islands', () => {
  const field = buildCoastalWater({ ...options, heightAt: (x,z) => x < 0 ? 0.24 : 2 });
  const covered = (x,z) => field.terrainCoverage[Math.floor((z + 100) / 2) * field.width + Math.floor((x + 100) / 2)] === 1;
  assert.equal(covered(-80, 0), true);
  assert.equal(covered(-10, 0), true);
  assert.equal(covered(-1, 0), false, 'mapped shoreline remains terrain');
  assert.equal(covered(10, 0), false, 'mapped dry land remains terrain');
  assert.equal(covered(80, 0), false, 'offshore high land remains terrain');
  assert.equal(field.maximumCoveredTerrainHeight, 0.28);
  for (let row=0; row<field.height; row++) for (let col=0; col<field.width; col++) {
    if (!field.terrainCoverage[row*field.width+col]) continue;
    for (const dz of [0.01, 1, 1.99]) for (const dx of [0.01, 1, 1.99]) {
      assert.equal(field.isSeaAt(-100+col*2+dx,-100+row*2+dz),true);
    }
  }
  const island = buildCoastalWater({ ...options,
    bodies: [ring(-20,-20,-5,20),ring(5,-20,20,20),ring(-5,-20,5,-5),ring(-5,5,5,20)].map(ring=>({isSea:true,ring})),
    heightAt:()=>null });
  for (let z=-4; z<5; z++) for (let x=-4; x<5; x++) {
    assert.equal(island.terrainCoverage[Math.floor((z+100)/2)*island.width+Math.floor((x+100)/2)],0);
  }
});

test('mapped low dry land stays dry; a disconnected level inland depression is not sea', () => {
  const field = buildCoastalWater({ ...options,
    heightAt: (x,z) => x < 0 || (x > 40 && x < 70 && Math.abs(z) < 20) ? 0.24 : 2 });
  assert.equal(field.isSeaAt(-10,0), true);
  assert.equal(field.isSeaAt(-80,0), true);
  assert.equal(field.isSeaAt(10,0), false);
  assert.equal(field.isSeaAt(50,0), false);
  assert.ok(field.quads < field.cells / 10, 'ocean rows are merged to keep geometry small');
  for (let i = 0; i < field.positions.length; i += 12) {
    const x0 = field.positions[i], z0 = field.positions[i+2], x1 = field.positions[i+3], z1 = field.positions[i+8];
    assert.ok(!(x0 < 20 && x1 > -20 && z0 < 20 && z1 > -20), 'no ocean quad overlaps the mapped source window');
  }
});

test('source island interiors and unsampled surroundings cannot be flooded', () => {
  // Partition around a real island instead of silently losing an inner ring.
  const bodies = [ring(-20,-20,-5,20),ring(5,-20,20,20),ring(-5,-20,5,-5),ring(-5,5,5,20)]
    .map(ring => ({ isSea: true, ring }));
  const field = buildCoastalWater({ ...options, bodies, heightAt: () => null });
  assert.equal(field.isSeaAt(0,0), false);
  assert.equal(field.isSeaAt(-10,0), true);
  assert.equal(field.cells, 0);
  assert.equal(field.positions.length, 0);
});

test('finite high terrain at a cell edge excludes that cell even when its centre is low', () => {
  const field = buildCoastalWater({ ...options, heightAt: (x,z) => x === -50 && z === 0 ? 4 : 0.24 });
  assert.equal(field.isSeaAt(-49,1), false);
  assert.equal(field.isSeaAt(-70,1), true);
});

test('without mapped sea, flat terrain and lakes never acquire an ocean', () => {
  const field = buildCoastalWater({ ...options, bodies: [{ isSea:false,ring:ring(-20,-20,20,20) }], heightAt:()=>0 });
  assert.equal(field.cells, 0);
  assert.equal(field.isSeaAt(-50,0), false);
  assert.throws(() => buildCoastalWater({ ...options, spacing: 0, heightAt:()=>0 }), /spacing/);
});
