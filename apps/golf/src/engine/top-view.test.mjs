import fs from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { topView } from './top-view.mjs';
import { alongLine } from './geom.js';

/* The claim is about a PICTURE, so it is checked by projecting through a real
   three.js camera placed exactly as setCam places it -- never by re-deriving the
   basis the assertion is meant to test. NDC y = -1 is the bottom of the screen. */
function shoot(hole, aspect) {
  const view = topView(hole, { aspect });
  const camera = new PerspectiveCamera(48, aspect, 1, 14000);
  camera.position.set(view.position.x, view.height, view.position.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(new Vector3(view.aim.x, 0, view.aim.z));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const ndc = ([x, z]) => { const v = new Vector3(x, 0, z).project(camera); return [v.x, v.y]; };
  return { view, points: hole.line.map(ndc), tee: ndc(hole.line[0]), green: ndc(hole.line.at(-1)) };
}
const straight = { line: [[0, 0], [0, -300]], pin: [0, -300] };
/* plays due EAST, which north-up used to lay across the frame */
const eastward = { line: [[0, 0], [300, 0]], pin: [300, 0] };
const dogleg = { line: [[0, 0], [0, -200], [120, -330]], pin: [120, -330] };

describe('the Ovan frame', () => {
  for (const [name, aspect] of [['a desktop 16:9', 16 / 9], ['a phone held upright', 0.58]]) {
    it(`puts the tee low and the green high on ${name}, whichever way the hole plays`, () => {
      for (const hole of [straight, eastward, dogleg]) {
        const { tee, green } = shoot(hole, aspect);
        expect(Math.abs(tee[0])).toBeLessThanOrEqual(1);        // the tee is on screen
        expect(tee[1]).toBeGreaterThanOrEqual(-1);
        expect(tee[1]).toBeLessThan(-1 / 3);                    // in the lowest third
        expect(green[1]).toBeGreaterThan(tee[1]);               // the hole plays UP the frame
      }
    });
    it(`fits the whole hole on ${name}`, () => {
      for (const hole of [straight, eastward, dogleg])
        for (const [x, y] of shoot(hole, aspect).points) {
          expect(Math.abs(x)).toBeLessThanOrEqual(1);
          expect(Math.abs(y)).toBeLessThanOrEqual(1);
        }
    });
  }

  it('turns with the hole rather than with the compass', () => {
    /* the same hole rotated is the same picture: north-up could not say that */
    const frames = [0, 90, 180, 270].map(deg => {
      const a = deg * Math.PI / 180, L = 300;
      const hole = { line: [[0, 0], [Math.sin(a) * L, Math.cos(a) * L]], pin: [0, 0] };
      return shoot(hole, 16 / 9);
    });
    for (const f of frames) {
      expect(f.tee[1]).toBeCloseTo(frames[0].tee[1], 3);
      expect(f.green[1]).toBeCloseTo(frames[0].green[1], 3);
    }
  });

  it('is a plan view, not a tilted one', () => {
    const { view } = shoot(straight, 16 / 9);
    const nudge = Math.hypot(view.position.x - view.aim.x, view.position.z - view.aim.z);
    expect(Math.atan2(nudge, view.height) * 180 / Math.PI).toBeLessThan(0.1);
  });

  it('respects the height bounds a short hole and a long one hit', () => {
    expect(topView({ line: [[0, 0], [0, -90]], pin: [0, -90] }, { aspect: 16 / 9 }).height)
      .toBeGreaterThanOrEqual(170);
    expect(topView({ line: [[0, 0], [0, -4000]], pin: [0, -4000] }, { aspect: 16 / 9 }).height)
      .toBeLessThanOrEqual(900);
  });

  it('frames every hole of every committed course, on both screen shapes', () => {
    const builds = ['geobuild', 'nvgkbuild', 'puttombuild', 'angsobuild', 'upsalabuild',
      'johannesbergbuild', 'ribbingsforsbuild', 'visbybuild', 'tortunabuild', 'lidingobuild'];
    let holes = 0;
    for (const build of builds) {
      const path = `${build}/course-model.json`;
      if (!fs.existsSync(path)) continue;
      for (const hole of JSON.parse(fs.readFileSync(path, 'utf8')).holes) {
        if (!hole.line || hole.line.length < 2) continue;
        holes++;
        for (const aspect of [16 / 9, 0.58]) {
          const { tee, green, points } = shoot(hole, aspect);
          for (const [x, y] of points) {
            expect(Math.abs(x), `${build} hole ${hole.n} at aspect ${aspect}`).toBeLessThanOrEqual(1);
            expect(Math.abs(y), `${build} hole ${hole.n} at aspect ${aspect}`).toBeLessThanOrEqual(1);
          }
          expect(tee[1], `${build} hole ${hole.n} tee below centre`).toBeLessThan(0);
          expect(green[1], `${build} hole ${hole.n} green above tee`).toBeGreaterThan(tee[1]);
        }
      }
    }
    expect(holes).toBe(171);
  });
});
