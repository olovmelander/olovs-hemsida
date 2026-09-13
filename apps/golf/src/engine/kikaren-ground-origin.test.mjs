import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('function kikDraw('), end = main.indexOf('\n}', start);
const drawSource = main.slice(start, end + 2);

describe('Kikaren application geometry', () => {
  it.each([['uphill', .22], ['downhill', -.17], ['level', 0]])('anchors both arc ends to visible ground on %s shots', (_label, slope) => {
    const scene = new THREE.Scene();
    const terrainH = (x, z) => 30 + x * .015 + z * slope;
    const state = { scene, terrainH, kikGroup: null,
      THREE: { ...THREE, LineBasicNodeMaterial: THREE.LineBasicMaterial, MeshBasicNodeMaterial: THREE.MeshBasicMaterial },
      kikErase: () => { if (state.kikGroup) scene.remove(state.kikGroup); } };
    runInNewContext(drawSource, state);
    // Re-selection must replace the previous line and use the new tee origin.
    for (const origin of [[48.658187517, -253.823704516], [33.224859227, -191.046601059]]) {
      const target = [61.25, -45.75];
      state.kikDraw({ origin, fromTee: true, fromGps: false,
        shot: { target, dist: Math.hypot(target[0] - origin[0], target[1] - origin[1]), hazards: [] } });
      const arcs = [];
      scene.traverse(o => { if (o.name === 'kikaren-shot') arcs.push(o); });
      expect(arcs).toHaveLength(1);
      const p = arcs[0].geometry.attributes.position;
      for (const [index, coordinate] of [[0, origin], [p.count - 1, target]]) {
        expect(p.getX(index)).toBeCloseTo(coordinate[0], 4);
        expect(p.getZ(index)).toBeCloseTo(coordinate[1], 4);
        expect(p.getY(index)).toBeCloseTo(terrainH(...coordinate), 4);
      }
      expect(p.getY(15)).toBeGreaterThan((terrainH(...origin) + terrainH(...target)) / 2);
    }
  });
});
