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
const traces = JSON.parse(fs.readFileSync(path.join(HERE, 'surface-traces.json'), 'utf8'));
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

/* Tee pads are MEASURED decks now (trace-surfaces.mjs): laser-flat ground,
   mown or under a card mark, drawn as oriented boxes. A card mark either
   stands on one of its hole's decks, or the trace file says plainly that no
   deck was measured for it and the app synthesises a pad at the mark. Every
   deck keeps clear of every road ribbon. */
function assertTeeRoadSeparation(course) {
  let pads = 0, onDeck = 0;
  for (const hole of course.holes) {
    for (const pad of hole.tees.pads) {
      pads++;
      for (const road of course.infra.roads) {
        expect(teeRoadClearance(pad.ring, road), `hole ${hole.n} pad at ${pad.c} vs road ${road.id || road.kind}`).toBeGreaterThanOrEqual(0);
      }
    }
    for (const mark of hole.tees.marks) {
      const inside = hole.tees.pads.some(pad => pointInRing(mark.c, pad.ring));
      const deck = traces.decks.find(d => d.hole === hole.n && d.tee === mark.m);
      if (inside) onDeck++;
      else expect(deck?.accepted, `hole ${hole.n} tee ${mark.m}: a mark off every deck must be one the trace measured no deck for`).toBe(false);
    }
  }
  expect(pads).toBeGreaterThanOrEqual(9);
  expect(onDeck).toBe(traces.decks.filter(d => d.accepted).length);
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
      const pad = hole.tees.pads.find(p => pointInRing(hole.tees.marks[1].c, p.ring));
      expect(pad, 'the controlled mark stands on a pad').toBeTruthy();
      const clearance = Math.min(...course.infra.roads.map(road => teeRoadClearance(pad.ring, road)));
      expect(clearance).toBeGreaterThan(9);
    }
  });

  it('keeps every measured deck off every road ribbon and every mark on a deck or declared deckless', () => {
    assertTeeRoadSeparation(model);
    assertTeeRoadSeparation(packedModel);
  });

  it('routes every hole through its own mown corridor to the surveyed green', () => {
    for (const hole of model.holes) {
      const route = traces.routes.find(r => r.hole === hole.n);
      expect(route).toBeTruthy();
      expect(hole.line.at(-1)).toEqual(hole.green.c.map(v => Math.round(v * 10) / 10));
      expect(hole.line[0]).toEqual(hole.tees.marks.find(m => m.m === Math.max(...hole.t)).c);
      /* the traced line measures its longest card tee within 10%, or ends on a measured deck */
      const ratio = hole.lineLen / Math.max(...hole.t);
      if (route.backTee === 'card slide') expect(Math.abs(ratio - 1)).toBeLessThan(0.002);
      else expect(Math.abs(ratio - 1)).toBeLessThan(0.10);
    }
  });
});
