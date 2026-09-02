import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRingHeightSampler, createTileFrustumTester, graphCoversHorizon } from './v2-graph-terrain.mjs';

/* ------------------------------------------------------ the frustum test

   The camera that found the bug: 900 m above a lake 2.7 km north of an 8 km
   tile, looking straight down. Plane by plane the tile is never wholly
   outside, so three's own test passes it and the planner keeps 32 m ground
   next to the 1 m course. */
function downwardCamera({ x, y, z }) {
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 1.5, 22000);
  camera.coordinateSystem = 2001; /* WebGPU: z clipped to [0, 1] */
  camera.position.set(x, y, z);
  camera.lookAt(x - 40, 0, z - 60);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

describe('the tile frustum test', () => {
  const matrix = downwardCamera({ x: -2758, y: 967, z: -2534 });
  const intersects = createTileFrustumTester(matrix, { coordinateSystem: 2001 });
  const min = new THREE.Vector3(), max = new THREE.Vector3();

  it('rejects the 8 km tile that the plane test alone accepts', () => {
    const plain = new THREE.Frustum().setFromProjectionMatrix(matrix, 2001, false);
    const box = new THREE.Box3(min.set(-8261.5, 23.5, 171.2), max.set(-69.5, 161.7, 8363.2));
    expect(plain.intersectsBox(box)).toBe(true);
    expect(intersects(box.min, box.max)).toBe(false);
  });

  it('keeps the ground under the camera', () => {
    expect(intersects(min.set(-3000, 20, -2800), max.set(-2500, 120, -2300))).toBe(true);
  });

  it('keeps a neighbour the pyramid clips and drops the quadrant beside it', () => {
    /* 900 m up with a 48 degree field the footprint at ground is about
       670 m wide east-west: a tile starting 340 m west is still in view,
       the 4 km quadrant starting 1.4 km west is not */
    expect(intersects(min.set(-3600, 20, -2600), max.set(-3100, 120, -2100))).toBe(true);
    expect(intersects(min.set(-8261.5, 24.6, -3924.8), max.set(-4165.5, 171.8, 171.2))).toBe(false);
  });

  it('rejects a tile the pyramid never reaches, even one that is tall', () => {
    expect(intersects(min.set(2000, 0, 2000), max.set(6000, 400, 6000))).toBe(false);
  });
});

/* ------------------------------------------------------ the ring sampler */
describe('the ring height sampler', () => {
  const grid = (spacing, size, heightOffsetMetres, value) => ({
    width: size, height: size, sampleSpacingMetres: spacing, heightOffsetMetres, heightScaleMetres: 0.01, noDataValue: 65535,
  });
  const payloadOf = (size, quantized) => {
    const payload = new Uint8Array(size * size * 2);
    for (let i = 0; i < size * size; i++) { payload[i * 2] = quantized & 0xff; payload[i * 2 + 1] = quantized >> 8; }
    return payload;
  };
  const legacyOrigin = { easting: 1000, northing: 2000 };
  const sampler = createRingHeightSampler({
    levels: [
      { lod: 1, tiles: [{ id: 'l1/0/0', bounds: { minEasting: 1000, maxEasting: 1008, minNorthing: 1992, maxNorthing: 2000 }, grid: grid(2, 5, 40), payload: payloadOf(5, 100) }] },
      { lod: 2, tiles: [{ id: 'l2/0/0', bounds: { minEasting: 984, maxEasting: 1016, minNorthing: 1984, maxNorthing: 2016 }, grid: grid(4, 9, 30), payload: payloadOf(9, 100) }] },
    ],
    legacyOrigin,
    verticalDatumOffsetMetres: 20,
  });
  it('answers from the finest ring covering a point, on the legacy datum', () => {
    expect(sampler.sample(4, 4)).toBeCloseTo(40 + 1 + 20, 6);
    expect(sampler.sample(-8, -8)).toBeCloseTo(30 + 1 + 20, 6);
    expect(sampler.inspect(4, 4).tileId).toBe('l1/0/0');
    expect(Number.isNaN(sampler.sample(100, 100))).toBe(true);
  });
});

describe('graphCoversHorizon', () => {
  it('needs a ground twice the preview and explicit parents', () => {
    const preview = { minEasting: 0, maxEasting: 2048, minNorthing: 0, maxNorthing: 2048 };
    const wide = { bounds: { minEasting: -8000, maxEasting: 8000, minNorthing: -8000, maxNorthing: 8000 }, tiles: [{ parentId: null }] };
    expect(graphCoversHorizon(wide, preview)).toBe(true);
    expect(graphCoversHorizon({ ...wide, tiles: [{}] }, preview)).toBe(false);
    expect(graphCoversHorizon({ ...wide, bounds: preview }, preview)).toBe(false);
  });
});
