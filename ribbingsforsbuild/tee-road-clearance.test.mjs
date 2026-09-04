import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inflateStream, readPack } from '../packages/course-pack/lib.mjs';
import { teeRoadClearance } from './tee-road-clearance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const controlDocument = JSON.parse(fs.readFileSync(path.join(HERE, 'tee-controls.json'), 'utf8'));
const pack = readPack(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/ribbingsfors/pack.bin')));
const packedModel = JSON.parse(inflateStream(pack.sv).toString('utf8'));

function pointInRing([x, z], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index], b = ring[previous];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function assertTeeRoadSeparation(course) {
  let pads = 0;
  for (const hole of course.holes) for (let index = 0; index < hole.tees.pads.length; index++) {
    pads++;
    const pad = hole.tees.pads[index];
    const marker = hole.tees.marks[index];
    expect(pointInRing(marker.c, pad.ring), `hole ${hole.n} tee ${marker.m} marker`).toBe(true);
    for (const road of course.infra.roads) {
      expect(
        teeRoadClearance(pad.ring, road),
        `hole ${hole.n} tee ${marker.m} vs road ${road.id || road.kind}`,
      ).toBeGreaterThanOrEqual(0);
    }
  }
  expect(pads).toBe(27);
}

describe('Ribbingsfors tee controls', () => {
  it('pins the hole-9 yellow deck to the DTM-resolved bench clear of the asphalt', () => {
    expect(controlDocument).toMatchObject({
      horizontalCrs: 'EPSG:3006',
      controls: [{
        hole: 9,
        teeMetres: 480,
        centre: { easting: 449556.6, northing: 6536126.3 },
        pad: { lengthMetres: 6, widthMetres: 4 },
      }],
    });
    for (const course of [model, packedModel]) {
      const hole = course.holes.find(item => item.n === 9);
      expect(hole.t).toEqual([502, 480, 406]);
      expect(hole.tees.marks.map(item => item.m)).toEqual([502, 480, 406]);
      expect(hole.tees.marks[1].c).toEqual([581.1, -101.8]);
      const clearance = Math.min(...course.infra.roads.map(road =>
        teeRoadClearance(hole.tees.pads[1].ring, road)));
      expect(clearance).toBeGreaterThan(9);
    }
  });

  it('keeps every source-model and packed tee marker inside turf and off every road ribbon', () => {
    assertTeeRoadSeparation(model);
    assertTeeRoadSeparation(packedModel);
  });
});

